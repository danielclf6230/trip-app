import { readFile, writeFile, mkdir, readdir, rename } from "node:fs/promises";
import { createHash, createPublicKey, verify } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const statePath = join(root, "frontend/src-tauri/target/windows-cloud-release.json");
const manifestPath = join(root, "backend/desktop-updates.json");
const loadJson = async path => JSON.parse(await readFile(path, "utf8"));

export function cargoAppVersions(cargo, lock) {
  return {
    cargo: cargo.replace(/\r\n/g, "\n").match(/\[package\][\s\S]*?\nversion = "([^"]+)"/)?.[1],
    lock: lock.replace(/\r\n/g, "\n").match(/name = "trip-tools"\nversion = "([^"]+)"/)?.[1],
  };
}

export function verifyUpdaterSignature(bytes, encodedSignature, encodedPublicKey, version) {
  const publicLines = Buffer.from(encodedPublicKey.trim(), "base64").toString("utf8").trim().split(/\r?\n/);
  const lines = Buffer.from(encodedSignature.trim(), "base64").toString("utf8").trim().split(/\r?\n/);
  if (publicLines.length !== 2 || lines.length !== 4 || !lines[2].startsWith("trusted comment: ")) {
    throw new Error("Invalid updater key or signature format.");
  }
  const pub = Buffer.from(publicLines[1], "base64");
  const signature = Buffer.from(lines[1], "base64");
  if (pub.length !== 42 || signature.length !== 74 || !pub.subarray(2, 10).equals(signature.subarray(2, 10))) {
    throw new Error("Updater signature does not match the configured Windows key.");
  }
  const algorithm = signature.subarray(0, 2).toString();
  if (!["ED", "Ed"].includes(algorithm)) throw new Error("Unknown updater signature algorithm.");
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), pub.subarray(10)]),
    format: "der", type: "spki",
  });
  const message = algorithm === "ED" ? createHash("blake2b512").update(bytes).digest() : bytes;
  const comment = lines[2].slice("trusted comment: ".length);
  if (!verify(null, message, key, signature.subarray(10))
    || !verify(null, Buffer.concat([signature.subarray(10), Buffer.from(comment)]), key, Buffer.from(lines[3], "base64"))) {
    throw new Error("Updater signature verification failed.");
  }
  if (!comment.split("\t").includes(`version:${version}`)) throw new Error("Signature is not bound to this release version.");
}

export function mergeWindowsRelease(previous, release) {
  if (!/^\d+\.\d+\.\d+$/.test(release.version) || !release.signature
    || !release.s3Key.startsWith(`releases/${release.version}/`) || !release.s3Key.endsWith(".exe")) {
    throw new Error("Invalid Windows release metadata.");
  }
  const manifest = previous?.version === release.version ? structuredClone(previous) : {
    version: release.version, notes: "Trip Tools app improvements", pub_date: new Date().toISOString(), platforms: {},
  };
  manifest.platforms["windows-x86_64"] = { s3Key: release.s3Key, signature: release.signature };
  return manifest;
}

async function configuration() {
  const config = await loadJson(join(root, "frontend/src-tauri/tauri.conf.json"));
  if (!/^\d+\.\d+\.\d+$/.test(config.version) || config.version !== process.env.EXPECTED_VERSION) {
    throw new Error("Requested version must exactly match the committed app version.");
  }
  const cargo = await readFile(join(root, "frontend/src-tauri/Cargo.toml"), "utf8");
  const lock = await readFile(join(root, "frontend/src-tauri/Cargo.lock"), "utf8");
  const versions = cargoAppVersions(cargo, lock);
  if (versions.cargo !== config.version || versions.lock !== config.version) throw new Error("JSON, TOML, and Cargo.lock app versions must match.");
  const windows = await loadJson(join(root, "frontend/src-tauri/tauri.windows.conf.json"));
  return { version: config.version, publicKey: windows.plugins.updater.pubkey };
}

async function verifyKey() {
  const config = await configuration();
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) throw new Error("Add the WINDOWS_UPDATER_PRIVATE_KEY Actions secret first.");
  await mkdir(dirname(statePath), { recursive: true });
  const probe = join(dirname(statePath), "windows-signing-check.txt");
  await writeFile(probe, "Trip Tools Windows updater signing check");
  const result = spawnSync(process.execPath, [
    join(root, "frontend/node_modules/@tauri-apps/cli/tauri.js"),
    "signer", "sign", probe, "--app-version", config.version,
  ], { cwd: join(root, "frontend"), env: process.env, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    // Signer diagnostics are deliberately not echoed: never risk logging a key.
    throw new Error("Could not use the Windows private key. Check its Actions secret and password.");
  }
  verifyUpdaterSignature(await readFile(probe), await readFile(`${probe}.sig`, "utf8"), config.publicKey, config.version);
  console.log("Windows private key matches the public key used by existing Windows installations.");
}

async function prepare() {
  const config = await configuration();
  const directory = join(root, "frontend/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis");
  const names = (await readdir(directory)).filter(name => name.endsWith(".exe"));
  if (names.length !== 1) throw new Error("Expected exactly one newly built NSIS installer.");
  const installer = join(directory, names[0]);
  const bytes = await readFile(installer);
  if (bytes.subarray(0, 2).toString() !== "MZ") throw new Error("The output is not a Windows executable.");
  const signature = (await readFile(`${installer}.sig`, "utf8")).trim();
  verifyUpdaterSignature(bytes, signature, config.publicKey, config.version);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  // Content-addressed filenames keep retries from replacing an earlier installer.
  const s3Key = `releases/${config.version}/Trip-Tools-windows-x86_64-${sha256}.exe`;
  await writeFile(statePath, JSON.stringify({ version: config.version, installer, signature, sha256, s3Key }, null, 2));
  console.log(`Verified signed Windows installer ${config.version}.`);
}

async function upload() {
  const config = await configuration();
  const release = await loadJson(statePath);
  if (release.version !== config.version) throw new Error("The built installer belongs to a different release.");
  const bytes = await readFile(release.installer);
  verifyUpdaterSignature(bytes, release.signature, config.publicKey, release.version);
  if (createHash("sha256").update(bytes).digest("hex") !== release.sha256) throw new Error("Installer changed after verification.");
  const require = createRequire(new URL("../../backend/package.json", import.meta.url));
  const { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
  const bucket = process.env.S3_BUCKET;
  if (!bucket || !process.env.AWS_REGION) throw new Error("Release bucket/region must be configured.");
  const client = new S3Client({ region: process.env.AWS_REGION });
  try {
    try {
      await client.send(new PutObjectCommand({
        Bucket: bucket, Key: release.s3Key, Body: bytes,
        ContentType: "application/vnd.microsoft.portable-executable", IfNoneMatch: "*",
        Metadata: { version: release.version, sha256: release.sha256 },
      }));
    } catch (error) {
      if (error.$metadata?.httpStatusCode !== 412) throw error;
    }
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: release.s3Key }));
    if (head.ContentLength !== bytes.length || head.Metadata?.sha256 !== release.sha256) throw new Error("S3 upload verification failed.");
    const downloaded = await client.send(new GetObjectCommand({ Bucket: bucket, Key: release.s3Key, Range: "bytes=0-63" }));
    if (!Buffer.from(await downloaded.Body.transformToByteArray()).equals(bytes.subarray(0, 64))) throw new Error("S3 download verification failed.");
    console.log(`Windows ${release.version} installer uploaded and verified.`);
  } finally { client.destroy(); }
}

async function writeManifest() {
  const config = await configuration();
  const release = await loadJson(statePath);
  if (config.version !== release.version) throw new Error("Main moved to another version; do not publish this older build.");
  const previous = await loadJson(manifestPath);
  const manifest = mergeWindowsRelease(previous, release);
  await writeFile(`${manifestPath}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(`${manifestPath}.tmp`, manifestPath);
  console.log("Prepared Windows update entry, preserving same-version Mac entries.");
}

async function verifyLive() {
  const release = await loadJson(statePath);
  const base = process.env.UPDATE_SERVER_URL || "https://tools-backend-v3um.onrender.com";
  if (new URL(base).protocol !== "https:") throw new Error("The update server must use HTTPS.");
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    try {
      const response = await fetch(`${base}/desktop-updates/latest.json?target=windows&arch=x86_64`, { signal: AbortSignal.timeout(20000) });
      if (response.ok && response.status !== 204) {
        const manifest = await response.json();
        const artifact = manifest.platforms?.["windows-x86_64"];
        if (manifest.version === release.version && artifact?.signature === release.signature) {
          const download = await fetch(artifact.url, { headers: { Range: "bytes=0-63" }, signal: AbortSignal.timeout(20000) });
          const bytes = Buffer.from(await download.arrayBuffer());
          if (download.status !== 206 || !bytes.equals((await readFile(release.installer)).subarray(0, 64))) throw new Error("Live installer download verification failed.");
          console.log(`Windows ${release.version} update is live and its installer download works.`);
          if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY,
            `## Windows ${release.version}\n\nInstaller signed, uploaded to private S3, and verified through the live update endpoint.\n\nDownload the installer from this run's **Windows installer** artifact. Existing updater-enabled x64 Windows apps can detect this release.\n`, { flag: "a" });
          return;
        }
      }
    } catch { /* A redeploy or cold start can temporarily interrupt the endpoint. */ }
    console.log(`Waiting for Render deployment (${attempt}/40)…`);
    if (attempt < 40) await new Promise(resolve => setTimeout(resolve, 15000));
  }
  throw new Error("Installer uploaded and manifest pushed, but the live update was not verified. Check Render's deployment; do not report the update as live yet.");
}

async function main() {
  const commands = { validate: configuration, "verify-key": verifyKey, prepare, upload, manifest: writeManifest, "verify-live": verifyLive };
  const command = commands[process.argv[2]];
  if (!command) throw new Error("Expected validate, verify-key, prepare, upload, manifest, or verify-live.");
  await command();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
