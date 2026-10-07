import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { z } from 'zod';
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
    let requestedItem;
    try { requestedItem = z.object({ id: z.string().min(1).max(100), text: z.string().trim().min(1).max(240), checked: z.boolean(), price: z.number().min(0).max(1000000000) }).parse(JSON.parse(req.body.item)); }
    catch { return res.status(400).json({ error: 'Choose a valid shopping item.' }); }
    const s3 = new S3Client({ region: AWS_REGION });
    const connection = await pool.getConnection();
    let uploaded = false;
    let existing = null;
    let key;
    try {
      await connection.beginTransaction();
      const [trips] = await connection.execute('SELECT trip_data FROM trip_tools_trips WHERE id = ? FOR UPDATE', [req.tripId]);
      if (!trips.length) throw new Error('Trip not found.');
      const trip = typeof trips[0].trip_data === 'string' ? JSON.parse(trips[0].trip_data) : trips[0].trip_data;
      let item = trip.shopping.find(item => item.id === requestedItem.id);
      if (!item) {
        if (req.body.create !== 'true') { await connection.rollback(); return res.status(409).json({ error: 'This item is not saved yet. Please wait for it to save and try again.' }); }
        if (trip.shopping.length >= 500) { await connection.rollback(); return res.status(400).json({ error: 'The shopping list is full.' }); }
        item = requestedItem;
        trip.shopping.push(item);
      }
      if (item.photoId) {
        const [photos] = await connection.execute('SELECT id, s3_key FROM trip_tools_photos WHERE id = ? AND trip_id = ?', [item.photoId, req.tripId]);
        if (!trip.shopping.some(other => other.id !== item.id && other.photoId === item.photoId)) existing = photos[0] || null;
      }
      const id = existing?.id || crypto.randomUUID();
      key = existing?.s3_key || `trip-tools/${req.tripId}/${id}.${types[req.file.mimetype]}`;
      const url = `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`;
      await s3.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: req.file.buffer, ContentType: req.file.mimetype, CacheControl: 'private, max-age=0, must-revalidate' }));
      uploaded = true;
      // A signed response override also prevents browsers showing the previous image after replacement.
      const signedUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: S3_BUCKET, Key: key, ResponseCacheControl: 'no-store', ResponseContentDisposition: `inline; filename="${crypto.randomUUID()}"` }), { expiresIn: 3600 });
      if (existing) await connection.execute('UPDATE trip_tools_photos SET content_type = ?, size_bytes = ?, uploaded_by = ? WHERE id = ? AND trip_id = ?', [req.file.mimetype, req.file.size, req.user.id, id, req.tripId]);
      else await connection.execute('INSERT INTO trip_tools_photos (id, trip_id, uploaded_by, s3_key, url, content_type, size_bytes) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, req.tripId, req.user.id, key, url, req.file.mimetype, req.file.size]);
      item.photoId = id;
      await connection.execute('UPDATE trip_tools_trips SET trip_data = ? WHERE id = ?', [JSON.stringify(trip), req.tripId]);
      await connection.commit();
      res.set('Cache-Control', 'no-store');
      res.status(201).json({ photo: { id, url: signedUrl } });
    } catch (error) {
      await connection.rollback();
      if (uploaded && !existing) await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key })).catch(console.error);
      next(error);
    } finally { connection.release(); s3.destroy(); }
  });
  router.delete('/shopping/:itemId', async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute('SELECT trip_data FROM trip_tools_trips WHERE id = ? FOR UPDATE', [req.tripId]);
      if (!rows.length) throw new Error('Trip not found.');
      const trip = typeof rows[0].trip_data === 'string' ? JSON.parse(rows[0].trip_data) : rows[0].trip_data;
      const item = trip.shopping.find(item => item.id === req.params.itemId);
      const photoIds = [...new Set([item?.photoId, req.body?.photoId].filter(value => typeof value === 'string'))];
      trip.shopping = trip.shopping.filter(item => item.id !== req.params.itemId);
      for (const photoId of photoIds) {
        if (trip.shopping.some(item => item.photoId === photoId)) continue;
        const [photos] = await connection.execute('SELECT s3_key FROM trip_tools_photos WHERE id = ? AND trip_id = ?', [photoId, req.tripId]);
        if (!photos.length) continue;
        const { AWS_REGION, S3_BUCKET } = process.env;
        if (!AWS_REGION || !S3_BUCKET) throw new Error('Photo storage is not configured.');
        const s3 = new S3Client({ region: AWS_REGION });
        try { await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: photos[0].s3_key })); }
        finally { s3.destroy(); }
        await connection.execute('DELETE FROM trip_tools_photos WHERE id = ? AND trip_id = ?', [photoId, req.tripId]);
      }
      await connection.execute('UPDATE trip_tools_trips SET trip_data = ? WHERE id = ?', [JSON.stringify(trip), req.tripId]);
      await connection.commit();
      res.json({ ok: true });
    } catch (error) { await connection.rollback(); next(error); }
    finally { connection.release(); }
  });
  return router;
}
