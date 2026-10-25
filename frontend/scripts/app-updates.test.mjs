import test from "node:test";
import assert from "node:assert/strict";
import { findAndroidUpdate } from "../src/appUpdates.js";

test("APK checks offer newer versions numerically and prevent downgrades", () => {
  const release = { version: "1.0.10", url: "https://downloads.example.com/app.apk" };
  assert.equal(findAndroidUpdate("1.0.9", release), release);
  assert.equal(findAndroidUpdate("1.0.10", release), null);
  assert.equal(findAndroidUpdate("1.1.0", release), null);
  assert.equal(findAndroidUpdate("2.0.0", release), null);
  assert.throws(() => findAndroidUpdate("1.0.9", { ...release, url: "http://insecure.example.com/app.apk" }));
  assert.throws(() => findAndroidUpdate("1.0.9", { ...release, url: "javascript:alert(1)" }));
  assert.throws(() => findAndroidUpdate("1.0.9", { ...release, version: "broken" }));
});
