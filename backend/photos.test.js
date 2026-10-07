import test from 'node:test';
import assert from 'node:assert/strict';
import { S3Client } from '@aws-sdk/client-s3';
import { signPhotoUrl } from './photos.js';

test('private photos receive expiring signed read URLs for the configured bucket and key', async () => {
  const s3 = new S3Client({ region: 'us-east-2', credentials: { accessKeyId: 'TESTACCESSKEY', secretAccessKey: 'test-secret-for-offline-signing' } });
  try {
    const url = new URL(await signPhotoUrl(s3, 'trip-tools-daniel-2026', 'trip-tools/5/photo.jpg'));
    assert.equal(url.hostname, 'trip-tools-daniel-2026.s3.us-east-2.amazonaws.com');
    assert.equal(url.pathname, '/trip-tools/5/photo.jpg');
    assert.equal(url.searchParams.get('X-Amz-Expires'), '3600');
    assert.equal(url.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
    assert.ok(url.searchParams.get('X-Amz-Signature'));
    assert.equal(url.searchParams.get('x-id'), 'GetObject');
  } finally { s3.destroy(); }
});

test('deleting a shopping item removes its scoped S3 photo and database record', async () => {
  const { default: express } = await import('express');
  const { photoRouter } = await import('./photos.js');
  const previousSend = S3Client.prototype.send;
  const previousRegion = process.env.AWS_REGION;
  const previousBucket = process.env.S3_BUCKET;
  process.env.AWS_REGION = 'us-east-2';
  process.env.S3_BUCKET = 'test-trip-bucket';
  const operations = [];
  let stored;
  let fail = false;
  S3Client.prototype.send = async function(command) {
    if (fail) throw new Error('S3 unavailable');
    operations.push(['s3', command.input]);
    return {};
  };
  const connection = {
    beginTransaction: async () => {}, commit: async () => operations.push(['commit']),
    rollback: async () => operations.push(['rollback']), release() {},
    execute: async (sql, params) => {
      if (sql.startsWith('SELECT trip_data')) return [[{ trip_data: { shopping: [{ id: 'item1', photoId: 'photo1' }, { id: 'item2' }] } }]];
      if (sql.startsWith('SELECT s3_key')) { assert.deepEqual(params, ['photo1', 5]); return [[{ s3_key: 'trip-tools/5/photo.jpg' }]]; }
      if (sql.startsWith('DELETE')) operations.push(['delete-record', params]);
      if (sql.startsWith('UPDATE')) stored = JSON.parse(params[0]);
      return [{}];
    },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 1 }; next(); });
  app.use('/photos', photoRouter({ getConnection: async () => connection }, async (_user, trip) => trip === 5));
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/photos/shopping/item1`;
    assert.equal((await fetch(`${base}?tripId=6`, { method: 'DELETE' })).status, 403);
    assert.equal(operations.length, 0);
    assert.equal((await fetch(`${base}?tripId=5`, { method: 'DELETE' })).status, 200);
    assert.equal(operations[0][1].Key, 'trip-tools/5/photo.jpg');
    assert.equal(operations[0][1].Bucket, 'test-trip-bucket');
    assert.deepEqual(stored.shopping, [{ id: 'item2' }]);
    assert.ok(operations.some(op => op[0] === 'delete-record'));
    operations.length = 0;
    fail = true;
    assert.equal((await fetch(`${base}?tripId=5`, { method: 'DELETE' })).status, 500);
    assert.deepEqual(operations, [['rollback']]);
  } finally {
    await new Promise(resolve => server.close(resolve));
    S3Client.prototype.send = previousSend;
    if (previousRegion === undefined) delete process.env.AWS_REGION; else process.env.AWS_REGION = previousRegion;
    if (previousBucket === undefined) delete process.env.S3_BUCKET; else process.env.S3_BUCKET = previousBucket;
  }
});
