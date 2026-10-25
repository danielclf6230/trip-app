import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  platform: { type: "string" },
  url: { type: "string" },
  "s3-key": { type: "string" },
  signature: { type: "string" },
  notes: { type: "string", default: "" },
} });

const android = values.platform === "android";
if ((!android && !/^(windows|darwin)-(x86_64|aarch64|i686)$/.test(values.platform || ""))
  || Boolean(values.url) === Boolean(values["s3-key"]) || (!android && !values.signature)) {
  throw new Error("Usage: npm run desktop:update:manifest -- --platform android --s3-key releases/VERSION/app.apk [--notes 'Release notes']. Desktop platforms also require --signature FILE. Use either --s3-key or --url.");
}
const config = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
let source;
if (values["s3-key"]) {
  const key = values["s3-key"];
  if (!key.startsWith(`releases/${config.version}/`) || !/^releases\/\d+\.\d+\.\d+\/[^/\\]+$/.test(key)
    || /[\r\n\x00]/.test(key)) throw new Error("Use releases/CURRENT_VERSION/FILENAME as the S3 key.");
  const suffix = android ? ".apk" : values.platform.startsWith("windows") ? ".exe" : ".app.tar.gz";
  if (!key.endsWith(suffix)) throw new Error(`This platform needs a ${suffix} file.`);
  source = { s3Key: key };
} else {
  const url = new URL(values.url);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Use an HTTPS URL without embedded credentials.");
  source = { url: url.href };
}
if (android) {
  const manifest = { version: config.version, ...source, notes: values.notes };
  await writeFile(new URL("../../backend/android-update.json", import.meta.url), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Prepared Android update ${config.version}. Deploy backend/android-update.json after uploading and testing the release-signed APK.`);
  process.exit(0);
}
const path = new URL("../../backend/desktop-updates.json", import.meta.url);
const previous = JSON.parse(await readFile(path, "utf8"));
const signature = (await readFile(values.signature, "utf8")).trim();
if (!signature) throw new Error("The signature file is empty.");
// Never advertise an old platform installer as a newer version.
const release = previous?.version === config.version ? previous : {
  version: config.version,
  notes: "",
  pub_date: new Date().toISOString(),
  platforms: {},
};
release.notes = values.notes || release.notes;
release.platforms[values.platform] = { ...source, signature };
await writeFile(path, `${JSON.stringify(release, null, 2)}\n`);
console.log(`Prepared ${values.platform} update ${config.version}. Deploy backend/desktop-updates.json after uploading and testing the signed installer.`);
