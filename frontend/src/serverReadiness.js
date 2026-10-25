// Share an in-flight wake-up between the login page and form submission.
export function createServerReadiness(base, {
  fetchHealth = (...args) => fetch(...args),
  now = () => Date.now(),
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
  timeoutMs = 120000,
  probeTimeoutMs = 15000,
  retryDelayMs = 3000,
  cacheMs = 15000,
} = {}) {
  let pending;
  let readyUntil = 0;

  return function ensureServerReady() {
    if (now() < readyUntil) return Promise.resolve();
    if (pending) return pending;
    pending = (async () => {
      const deadline = now() + timeoutMs;
      while (now() < deadline) {
        try {
          const response = await fetchHealth(`${base.replace(/\/$/, "")}/health`, {
            cache: "no-store",
            signal: AbortSignal.timeout(Math.max(1, Math.min(probeTimeoutMs, deadline - now()))),
          });
          const health = response.ok ? await response.json() : null;
          if (health?.ok === true && health?.db === true) {
            readyUntil = now() + cacheMs;
            return;
          }
        } catch { /* Cold starts can return HTML, gateway errors, or time out. */ }
        const remaining = deadline - now();
        if (remaining > 0) await pause(Math.min(retryDelayMs, remaining));
      }
      throw new Error("The server is taking longer than expected to connect. Please try again shortly.");
    })().finally(() => { pending = null; });
    return pending;
  };
}
