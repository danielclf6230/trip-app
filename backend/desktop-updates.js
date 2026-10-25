import { readFile } from "node:fs/promises";
import { Router } from "express";

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
    const url = new URL(artifact.url);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("Update downloads must use HTTPS without embedded credentials.");
    }
  }
  return release;
}

export function validateAndroidRelease(release) {
  if (!release || !/^\d+\.\d+\.\d+$/.test(release.version)) {
    throw new Error("An Android release needs a version.");
  }
  const url = new URL(release.url);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Android downloads must use HTTPS without embedded credentials.");
  }
  return release;
}

export function desktopUpdatesRouter(
  manifestPath = new URL("./desktop-updates.json", import.meta.url),
  androidManifestPath = new URL("./android-update.json", import.meta.url),
) {
  const router = Router();
  router.get("/android.json", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const release = JSON.parse(await readFile(androidManifestPath, "utf8"));
      if (release === null) return res.status(204).end();
      return res.json(validateAndroidRelease(release));
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
      return res.json(release);
    } catch {
      return res.status(503).json({ error: "Desktop update information is unavailable." });
    }
  });
  return router;
}
