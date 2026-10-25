import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  platform: { type: "string" },
  url: { type: "string" },
  signature: { type: "string" },
  notes: { type: "string", default: "" },
} });

const android = values.platform === "android";
if ((!android && !/^(windows|darwin)-(x86_64|aarch64|i686)$/.test(values.platform || ""))
  || !values.url || (!android && !values.signature)) {
  throw new Error("Usage: npm run desktop:update:manifest -- --platform windows-x86_64 --url https://host/installer.exe --signature path/to/installer.exe.sig [--notes 'Release notes']");
}
const url = new URL(values.url);
if (url.protocol !== "https:" || url.username || url.password) {
  throw new Error("Use a permanent HTTPS download URL without embedded credentials.");
}
const config = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
if (android) {
  const manifest = { version: config.version, url: url.href, notes: values.notes };
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
release.platforms[values.platform] = { url: url.href, signature };
await writeFile(path, `${JSON.stringify(release, null, 2)}\n`);
console.log(`Prepared ${values.platform} update ${config.version}. Deploy backend/desktop-updates.json after uploading and testing the signed installer.`);
