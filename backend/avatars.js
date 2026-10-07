import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
export async function avatarUrlForDisplay(value) {
  if (!value || value.startsWith('data:')) return value;
  const { S3_BUCKET, AWS_REGION } = process.env;
  if (!S3_BUCKET || !AWS_REGION) return value;
  let url;
  try { url = new URL(value); } catch { return value; }
  if (![`${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com`, `${S3_BUCKET}.s3.amazonaws.com`].includes(url.hostname)) return value;
  const s3 = new S3Client({ region: AWS_REGION });
  try { return await getSignedUrl(s3, new GetObjectCommand({ Bucket: S3_BUCKET, Key: decodeURIComponent(url.pathname.slice(1)) }), { expiresIn: 3600 }); }
  finally { s3.destroy(); }
}
