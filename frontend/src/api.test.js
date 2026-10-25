import test from "node:test";
import assert from "node:assert/strict";
import { login, register } from "./api.js";

test("authentication waits for readiness, preserves credential errors, and never retries writes", async t => {
  const calls = [];
  let mode = "success";
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/health")) return Response.json({ ok: true, db: true });
    assert.ok(options.signal instanceof AbortSignal);
    if (mode === "credentials") return Response.json({ message: "Invalid credentials" }, { status: 401 });
    if (mode === "rate-limit") return Response.json({ message: "Too many attempts" }, { status: 429 });
    if (mode === "network") throw new TypeError("fetch failed");
    if (mode === "html") return new Response("<html>Starting</html>");
    if (mode === "null") return Response.json(null);
    return Response.json({ id: 1, name: "Traveler", token: "test-token" });
  });

  assert.equal((await login("Traveler", "password")).token, "test-token");
  assert.ok(calls[0].url.endsWith("/health"));
  assert.ok(calls[1].url.endsWith("/api/auth/login"));
  assert.deepEqual(JSON.parse(calls[1].options.body), { name: "Traveler", password: "password" });
  for (const [failure, message, status] of [
    ["credentials", /Invalid credentials/, 401],
    ["rate-limit", /Too many attempts/, 429],
    ["network", /Check your connection/, undefined],
    ["html", /unexpected sign-in response/, undefined],
    ["null", /unexpected sign-in response/, undefined],
  ]) {
    mode = failure;
    const before = calls.length;
    await assert.rejects(login("Traveler", "password"), error => {
      assert.match(error.message, message);
      assert.equal(error.status, status);
      return true;
    });
    assert.equal(calls.length, before + 1, "failed login POST must not be replayed");
  }
  mode = "success";
  assert.equal((await register("Traveler", "password", "INVITE01")).token, "test-token");
  assert.ok(calls.at(-1).url.endsWith("/api/auth/register"));
  assert.equal(JSON.parse(calls.at(-1).options.body).inviteCode, "INVITE01");
});
