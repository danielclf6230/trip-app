import { readFile } from "node:fs/promises";
import { Router } from "express";
import { S3Client, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export function validateReleaseSource(artifact, version) {
  if (artifact.s3Key !== undefined) {
    if (artifact.url !== undefined || typeof artifact.s3Key !== "string"
      || !artifact.s3Key.startsWith(`releases/${version}/`)
      || !/^releases\/\d+\.\d+\.\d+\/[^/\\]+$/.test(artifact.s3Key)
      || /[\r\n\x00]/.test(artifact.s3Key)) {
      throw new Error("Use one release object under releases/VERSION/FILENAME.");
    }
    return;
  }
  const url = new URL(artifact.url);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Update downloads must use HTTPS without embedded credentials.");
  }
}

export async function signReleaseDownload(key, {
  bucket = process.env.S3_BUCKET,
  region = process.env.AWS_REGION,
  s3,
} = {}) {
  if (!bucket || !region) throw new Error("Release storage is not configured.");
  const client = s3 || new S3Client({ region });
  try {
    // Do not offer a release until its uploaded file actually exists.
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const filename = key.split("/").pop().replace(/[^a-zA-Z0-9._ -]/g, "_");
    return await getSignedUrl(client, new GetObjectCommand({
      Bucket: bucket, Key: key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    }), { expiresIn: 3600 });
  } finally {
    if (!s3) client.destroy();
  }
}

async function resolveArtifact(artifact, signDownload) {
  const { s3Key, ...publicArtifact } = artifact;
  return s3Key === undefined ? publicArtifact : { ...publicArtifact, url: await signDownload(s3Key) };
}

export function validateDesktopRelease(release) {
  if (!release || !/^\d+\.\d+\.\d+$/.test(release.version)
    || !release.platforms || !Object.keys(release.platforms).length) {
    throw new Error("A release needs a version and at least one platform.");
  }
  for (const [platform, artifact] of Object.entries(release.platforms)) {
    if (!/^(windows|darwin)-(x86_64|aarch64|i686)$/.test(platform)
      || typeof artifact.signature !== "string" || !artifact.signature.trim()) {
      throw new Error("Invalid desktop platform or missing signature.");
    }
    validateReleaseSource(artifact, release.version);
    if (artifact.s3Key && !artifact.s3Key.endsWith(platform.startsWith("windows") ? ".exe" : ".app.tar.gz")) {
      throw new Error("The desktop artifact type does not match its platform.");
    }
  }
  return release;
}

export function validateAndroidRelease(release) {
  if (!release || !/^\d+\.\d+\.\d+$/.test(release.version)) {
    throw new Error("An Android release needs a version.");
  }
  validateReleaseSource(release, release.version);
  if (release.s3Key && !release.s3Key.endsWith(".apk")) throw new Error("Android updates require an APK.");
  return release;
}

export function desktopUpdatesRouter(
  manifestPath = new URL("./desktop-updates.json", import.meta.url),
  androidManifestPath = new URL("./android-update.json", import.meta.url),
  { signDownload = signReleaseDownload } = {},
) {
  const router = Router();
  router.get("/android.json", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const release = JSON.parse(await readFile(androidManifestPath, "utf8"));
      if (release === null) return res.status(204).end();
      validateAndroidRelease(release);
      return res.json(await resolveArtifact(release, signDownload));
    } catch {
      return res.status(503).json({ error: "Android update information is unavailable." });
    }
  });
  router.get("/latest.json", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const release = JSON.parse(await readFile(manifestPath, "utf8"));
      if (release === null) return res.status(204).end();
      validateDesktopRelease(release);
      if (req.query.target && req.query.arch
        && !release.platforms[`${req.query.target}-${req.query.arch}`]) {
        return res.status(204).end();
      }
      const platforms = Object.fromEntries(await Promise.all(Object.entries(release.platforms)
        .filter(([platform]) => !req.query.target || !req.query.arch || platform === `${req.query.target}-${req.query.arch}`)
        .map(async ([platform, artifact]) => [platform, await resolveArtifact(artifact, signDownload)])));
      return res.json({ ...release, platforms });
    } catch {
      return res.status(503).json({ error: "Desktop update information is unavailable." });
    }
  });
  return router;
}
