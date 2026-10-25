import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { desktopUpdatesRouter } from "./desktop-updates.js";

test("update endpoint handles no release, signed releases, unsupported platforms, and bad manifests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trip-updates-"));
  const manifest = join(directory, "latest.json");
  const app = express();
  app.use("/desktop-updates", desktopUpdatesRouter(manifest, manifest));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/desktop-updates/latest.json`;
  try {
    await writeFile(manifest, "null");
    let response = await fetch(endpoint);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await fetch(endpoint.replace("latest.json", "android.json"))).status, 204);
    const apk = { version: "1.0.4", url: "https://downloads.example.com/app.apk", notes: "New release" };
    await writeFile(manifest, JSON.stringify(apk));
    response = await fetch(endpoint.replace("latest.json", "android.json"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), apk);
    await writeFile(manifest, JSON.stringify({ ...apk, url: "javascript:alert(1)" }));
    assert.equal((await fetch(endpoint.replace("latest.json", "android.json"))).status, 503);
    const release = { version: "1.0.4", platforms: {
      "windows-x86_64": { url: "https://downloads.example.com/setup.exe", signature: "signed-artifact" },
    } };
    await writeFile(manifest, JSON.stringify(release));
    response = await fetch(`${endpoint}?target=windows&arch=x86_64`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), release);
    assert.equal((await fetch(`${endpoint}?target=darwin&arch=aarch64`)).status, 204);
    release.platforms["windows-x86_64"].url = "http://insecure.example.com/setup.exe";
    await writeFile(manifest, JSON.stringify(release));
    assert.equal((await fetch(endpoint)).status, 503);
    release.platforms["windows-x86_64"].url = "https://downloads.example.com/setup.exe";
    release.platforms["windows-x86_64"].signature = "";
    await writeFile(manifest, JSON.stringify(release));
    assert.equal((await fetch(endpoint)).status, 503);
    await writeFile(manifest, "broken JSON");
    assert.equal((await fetch(endpoint)).status, 503);
    await rm(manifest);
    assert.equal((await fetch(endpoint)).status, 503);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
