import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export function signPhotoUrl(s3, bucket, key) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 });
}

const types = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) { cb(types[file.mimetype] ? null : new Error('Choose a JPEG, PNG, WebP, or GIF image.'), Boolean(types[file.mimetype])); }
});

export function photoRouter(pool, getTripAccess) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    const tripId = Number(req.query.tripId);
    if (!Number.isSafeInteger(tripId) || tripId < 1) return res.status(400).json({ error: 'Choose a valid trip.' });
    try {
      if (!await getTripAccess(req.user.id, tripId)) return res.status(403).json({ error: 'You cannot access this trip.' });
      req.tripId = tripId;
      next();
    } catch (error) { next(error); }
  });
  router.get('/', async (req, res, next) => {
    try {
      const [photos] = await pool.execute('SELECT id, s3_key FROM trip_tools_photos WHERE trip_id = ?', [req.tripId]);
      res.set('Cache-Control', 'no-store');
      if (!photos.length) return res.json({ photos: [] });
      const { AWS_REGION, S3_BUCKET } = process.env;
      if (!AWS_REGION || !S3_BUCKET) return res.status(503).json({ error: 'Photo storage is not configured.' });
      const s3 = new S3Client({ region: AWS_REGION });
      const signedPhotos = await Promise.all(photos.map(async photo => ({
        id: photo.id, url: await signPhotoUrl(s3, S3_BUCKET, photo.s3_key),
      })));
      res.json({ photos: signedPhotos });
    } catch (error) { next(error); }
  });
  router.post('/', (req, res, next) => {
    upload.single('image')(req, res, error => {
      if (error) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Images must be 10 MB or smaller.' : error.message });
      next();
    });
  }, async (req, res, next) => {
    if (!req.file) return res.status(400).json({ error: 'Choose an image.' });
    const { AWS_REGION, S3_BUCKET } = process.env;
    if (!AWS_REGION || !S3_BUCKET) return res.status(503).json({ error: 'Photo storage is not configured. Set AWS_REGION, S3_BUCKET, and AWS credentials on the backend.' });
    const s3 = new S3Client({ region: AWS_REGION });
    const id = crypto.randomUUID();
    const key = `trip-tools/${req.tripId}/${id}.${types[req.file.mimetype]}`;
    const url = `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`;
    let uploaded = false;
    try {
      await s3.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: req.file.buffer, ContentType: req.file.mimetype }));
      uploaded = true;
      const signedUrl = await signPhotoUrl(s3, S3_BUCKET, key);
      await pool.execute('INSERT INTO trip_tools_photos (id, trip_id, uploaded_by, s3_key, url, content_type, size_bytes) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, req.tripId, req.user.id, key, url, req.file.mimetype, req.file.size]);
      res.set('Cache-Control', 'no-store');
      res.status(201).json({ photo: { id, url: signedUrl } });
    } catch (error) {
      if (uploaded) await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key })).catch(console.error);
      next(error);
    }
  });
  return router;
}
