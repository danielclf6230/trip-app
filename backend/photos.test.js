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
