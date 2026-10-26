import test from "node:test";
import assert from "node:assert/strict";
import { getUser, setUser, logout, getRememberedLogin, rememberLogin } from "./auth.js";
import { loadTrips } from "./api.js";

function installStorage(t) {
  for (const key of ["localStorage", "sessionStorage"]) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: storage() });
    t.after(() => { if (original) Object.defineProperty(globalThis, key, original); else delete globalThis[key]; });
  }
}

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key), clear: () => values.clear() };
}

test("remembered logins persist across sessions; signing out removes the token and preserves only the saved name", t => {
  installStorage(t);
  setUser({ name: "Daniel", token: "test-token" }, true);
  rememberLogin("Daniel", true);
  sessionStorage.clear();
  assert.equal(getUser().token, "test-token");
  logout();
  assert.equal(getUser(), null);
  assert.deepEqual(getRememberedLogin(), { name: "Daniel", remember: true });
  rememberLogin("Daniel", false);
  assert.deepEqual(getRememberedLogin(), { name: "", remember: false });
});

test("unremembered logins and profile updates remain session-only, including API authorization", async t => {
  installStorage(t);
  setUser({ name: "Daniel", token: "old-token" }, true);
  setUser({ name: "Daniel", token: "session-token" }, false);
  setUser({ ...getUser(), avatarUrl: "avatar" });
  assert.equal(localStorage.getItem("user"), null);
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer session-token");
    return Response.json({ trips: [] });
  });
  await loadTrips();
  sessionStorage.clear();
  assert.equal(getUser(), null);
});

test("expired remembered sessions return to login instead of redirecting in a loop", async t => {
  installStorage(t);
  const { isAuthed } = await import("./auth.js");
  const token = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 1 })).toString("base64url")}.signature`;
  setUser({ name: "Daniel", token }, true);
  assert.equal(isAuthed(), false);
});
