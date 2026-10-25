import test from "node:test";
import assert from "node:assert/strict";
import { createServerReadiness } from "./serverReadiness.js";

function fixture(fetchHealth) {
  let clock = 1;
  const wait = createServerReadiness("https://example.com/", {
    fetchHealth,
    now: () => clock,
    pause: async ms => { clock += ms; },
    timeoutMs: 100,
    retryDelayMs: 10,
    cacheMs: 20,
  });
  return { wait, advance: ms => { clock += ms; } };
}

const ready = () => Response.json({ ok: true, db: true });

test("cold start retries gateway errors, HTML, a disconnected database, and network failures", async () => {
  const responses = [
    () => new Response("Starting", { status: 503 }),
    () => new Response("<html>Starting</html>"),
    () => Response.json({ ok: true, db: false }),
    () => { throw new TypeError("fetch failed"); },
    ready,
  ];
  let calls = 0;
  const { wait } = fixture(async (url, options) => {
    assert.equal(url, "https://example.com/health");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.method, undefined);
    assert.equal(options.body, undefined);
    return responses[calls++]();
  });
  await wait();
  assert.equal(calls, 5);
});

test("simultaneous callers share wake-up and cached readiness expires", async () => {
  let calls = 0;
  const { wait, advance } = fixture(async () => { calls += 1; return ready(); });
  const first = wait();
  assert.equal(wait(), first);
  await Promise.all([first, wait()]);
  await wait();
  assert.equal(calls, 1);
  advance(21);
  await wait();
  assert.equal(calls, 2);
});

test("an unavailable server times out and a later submission can retry", async () => {
  let available = false;
  let calls = 0;
  const { wait } = fixture(async () => {
    calls += 1;
    return available ? ready() : new Response("Unavailable", { status: 503 });
  });
  await assert.rejects(wait(), /taking longer than expected/);
  assert.equal(calls, 10);
  available = true;
  await wait();
  assert.equal(calls, 11);
});

test("a hanging health request is aborted within the wake-up deadline", async () => {
  const wait = createServerReadiness("https://example.com", {
    timeoutMs: 30,
    probeTimeoutMs: 10,
    retryDelayMs: 5,
    fetchHealth: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  });
  // AbortSignal.timeout uses an unreferenced timer in Node.
  const keepRunning = setTimeout(() => {}, 1000);
  try { await assert.rejects(wait(), /taking longer than expected/); }
  finally { clearTimeout(keepRunning); }
});
