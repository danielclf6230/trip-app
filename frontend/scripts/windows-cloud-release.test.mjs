import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, createHash, sign } from "node:crypto";
import { verifyUpdaterSignature, mergeWindowsRelease } from "./windows-cloud-release.mjs";

function signedFixture(version = "1.0.7") {
  const pair = generateKeyPairSync("ed25519");
  const id = randomBytes(8);
  const key = pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const publicKey = Buffer.from(`untrusted comment: test key\n${Buffer.concat([Buffer.from("Ed"), id, key]).toString("base64")}\n`).toString("base64");
  const bytes = Buffer.from("MZ test Windows installer");
  const signature = sign(null, createHash("blake2b512").update(bytes).digest(), pair.privateKey);
  const comment = `timestamp:1\tfile:setup.exe\tversion:${version}`;
  const globalSignature = sign(null, Buffer.concat([signature, Buffer.from(comment)]), pair.privateKey);
  const envelope = ["untrusted comment: test signature", Buffer.concat([Buffer.from("ED"), id, signature]).toString("base64"),
    `trusted comment: ${comment}`, globalSignature.toString("base64")].join("\n");
  return { bytes, signature: Buffer.from(envelope).toString("base64"), publicKey };
}

test("accepts a version-bound Windows signature and rejects modified installers, keys, versions and comments", () => {
  const fixture = signedFixture();
  assert.doesNotThrow(() => verifyUpdaterSignature(fixture.bytes, fixture.signature, fixture.publicKey, "1.0.7"));
  assert.throws(() => verifyUpdaterSignature(Buffer.from("changed installer"), fixture.signature, fixture.publicKey, "1.0.7"));
  assert.throws(() => verifyUpdaterSignature(fixture.bytes, fixture.signature, signedFixture().publicKey, "1.0.7"));
  assert.throws(() => verifyUpdaterSignature(fixture.bytes, fixture.signature, fixture.publicKey, "1.0.8"));
  const tampered = Buffer.from(Buffer.from(fixture.signature, "base64").toString().replace("timestamp:1", "timestamp:2")).toString("base64");
  assert.throws(() => verifyUpdaterSignature(fixture.bytes, tampered, fixture.publicKey, "1.0.7"));
  assert.throws(() => verifyUpdaterSignature(fixture.bytes, "malformed", fixture.publicKey, "1.0.7"));
});

test("publishing Windows preserves same-version Mac releases without mutating the previous manifest", () => {
  const mac = { s3Key: "releases/1.0.7/Trip-Tools.app.tar.gz", signature: "mac-signature" };
  const previous = { version: "1.0.7", notes: "Shared improvements", platforms: { "darwin-aarch64": mac } };
  const windows = { version: "1.0.7", s3Key: "releases/1.0.7/setup.exe", signature: "windows-signature" };
  const result = mergeWindowsRelease(previous, windows);
  assert.deepEqual(result.platforms["darwin-aarch64"], mac);
  assert.equal(result.platforms["windows-x86_64"].signature, windows.signature);
  assert.equal(result.notes, previous.notes);
  assert.equal(previous.platforms["windows-x86_64"], undefined);
  assert.deepEqual(Object.keys(mergeWindowsRelease({ ...previous, version: "1.0.6" }, windows).platforms), ["windows-x86_64"]);
  assert.throws(() => mergeWindowsRelease(previous, { ...windows, s3Key: "releases/1.0.6/old.exe" }));
});
