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

test('photo creation attaches to an item and replacement reuses its object and record', async () => {
  const { default: express } = await import('express');
  const { photoRouter } = await import('./photos.js');
  const names = ['AWS_REGION', 'S3_BUCKET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];
  const previous = names.map(name => process.env[name]);
  Object.assign(process.env, { AWS_REGION: 'us-east-2', S3_BUCKET: 'test-trip-bucket', AWS_ACCESS_KEY_ID: 'TESTKEY', AWS_SECRET_ACCESS_KEY: 'offline-test-secret' });
  const send = S3Client.prototype.send;
  const writes = [];
  S3Client.prototype.send = async command => { writes.push(command.input.Key); return {}; };
  let data = { shopping: [] };
  let record;
  let inserts = 0;
  let updates = 0;
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {},
    execute: async (sql, params) => {
      if (sql.startsWith('SELECT trip_data')) return [[{ trip_data: JSON.stringify(data) }]];
      if (sql.startsWith('SELECT id, s3_key')) return [[record]];
      if (sql.startsWith('INSERT INTO trip_tools_photos')) { inserts++; record = { id: params[0], s3_key: params[3] }; }
      if (sql.startsWith('UPDATE trip_tools_photos')) updates++;
      if (sql.startsWith('UPDATE trip_tools_trips')) data = JSON.parse(params[0]);
      return [{}];
    },
  };
  const app = express();
  app.use((req, _res, next) => { req.user = { id: 1 }; next(); });
  app.use('/photos', photoRouter({ getConnection: async () => connection }, async () => true));
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const item = { id: 'one', text: 'Camera', checked: false, price: 0 };
    const upload = async create => {
      const body = new FormData();
      body.append('item', JSON.stringify(item)); body.append('create', String(create));
      body.append('image', new Blob(['photo'], { type: 'image/png' }), 'photo.png');
      return fetch(`http://127.0.0.1:${server.address().port}/photos?tripId=5`, { method: 'POST', body });
    };
    assert.equal((await upload(false)).status, 409);
    assert.equal(writes.length, 0);
    const first = await upload(true);
    assert.equal(first.status, 201);
    const created = await first.json();
    assert.equal(data.shopping[0].photoId, created.photo.id);
    const second = await upload(false);
    assert.equal(second.status, 201);
    assert.equal((await second.json()).photo.id, created.photo.id);
    assert.equal(writes[0], writes[1]);
    assert.equal(inserts, 1);
    assert.equal(updates, 1);
    assert.equal(data.shopping.length, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
    S3Client.prototype.send = send;
    names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; });
  }
});
