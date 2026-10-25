import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { desktopUpdatesRouter, signReleaseDownload } from "./desktop-updates.js";
import { S3Client } from "@aws-sdk/client-s3";

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

test("private releases receive fresh HTTPS links, reject non-release objects, and hide unavailable files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trip-s3-updates-"));
  const manifest = join(directory, "latest.json");
  const signedKeys = [];
  let unavailable = false;
  const app = express();
  app.use("/updates", desktopUpdatesRouter(manifest, manifest, { signDownload: async key => {
    if (unavailable) throw new Error("Missing S3 object");
    signedKeys.push(key);
    return `https://private-bucket.s3.amazonaws.com/${key}?signature=${signedKeys.length}`;
  } }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/updates`;
  try {
    const apk = { version: "1.0.5", s3Key: "releases/1.0.5/Trip-Tools.apk", notes: "New release" };
    await writeFile(manifest, JSON.stringify(apk));
    let response = await fetch(`${base}/android.json`);
    assert.equal(response.status, 200);
    const first = await response.json();
    assert.match(first.url, /^https:/);
    assert.equal(first.s3Key, undefined);
    assert.equal(first.version, "1.0.5");
    const second = await (await fetch(`${base}/android.json`)).json();
    assert.notEqual(first.url, second.url);
    for (const key of ["trip-tools/5/photo.apk", "releases/1.0.4/old.apk", "releases/1.0.5/../photo.apk", "releases/1.0.5/wrong.exe"]) {
      await writeFile(manifest, JSON.stringify({ ...apk, s3Key: key }));
      assert.equal((await fetch(`${base}/android.json`)).status, 503);
    }
    assert.equal(signedKeys.length, 2);
    await writeFile(manifest, JSON.stringify(apk));
    unavailable = true;
    assert.equal((await fetch(`${base}/android.json`)).status, 503);
    unavailable = false;
    const windows = { s3Key: "releases/1.0.5/setup.exe", signature: "desktop-signature" };
    await writeFile(manifest, JSON.stringify({ version: "1.0.5", platforms: {
      "windows-x86_64": windows,
      "darwin-aarch64": { s3Key: "releases/1.0.5/Trip.app.tar.gz", signature: "mac-signature" },
    } }));
    response = await fetch(`${base}/latest.json?target=windows&arch=x86_64`);
    assert.equal(response.status, 200);
    const desktop = await response.json();
    assert.deepEqual(Object.keys(desktop.platforms), ["windows-x86_64"]);
    assert.equal(desktop.platforms["windows-x86_64"].signature, windows.signature);
    assert.equal(desktop.platforms["windows-x86_64"].s3Key, undefined);
    assert.equal(signedKeys.at(-1), windows.s3Key);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("S3 downloads check existence and get a one-hour attachment URL", async () => {
  const client = new S3Client({ region: "us-east-2", credentials: { accessKeyId: "TESTACCESSKEY", secretAccessKey: "offline-test-secret" } });
  const operations = [];
  client.send = async command => { operations.push(command.input); return {}; };
  const options = { bucket: "private-release-bucket", region: "us-east-2", s3: client };
  try {
    const url = new URL(await signReleaseDownload("releases/1.0.5/Trip-Tools.apk", options));
    assert.deepEqual(operations, [{ Bucket: options.bucket, Key: "releases/1.0.5/Trip-Tools.apk" }]);
    assert.equal(url.searchParams.get("X-Amz-Expires"), "3600");
    assert.equal(url.searchParams.get("response-content-disposition"), 'attachment; filename="Trip-Tools.apk"');
    client.send = async () => { throw new Error("Missing object"); };
    await assert.rejects(signReleaseDownload("releases/1.0.5/missing.apk", options), /Missing object/);
  } finally { client.destroy(); }
});
