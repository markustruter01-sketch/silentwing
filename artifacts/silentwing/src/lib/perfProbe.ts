// ─── Startup / freeze diagnostic probe (TEMPORARY) ────────────────────────────
//
// Streams timing marks to the vite dev server (POST __perfprobe) so a frozen
// tab can be diagnosed from the server log: the last mark that arrives is the
// section that was entered right before the main thread blocked.
//
// Fire-and-forget with keepalive so marks survive even if the page hangs
// immediately after. No-ops in production builds.

const ENABLED = import.meta.env.DEV;
const t0 = performance.now();

function post(payload: Record<string, unknown>): void {
  if (!ENABLED) return;
  try {
    const url = `${import.meta.env.BASE_URL}__perfprobe`;
    const body = JSON.stringify({ t: Math.round(performance.now() - t0), ...payload });
    // sendBeacon queues even when the main thread is about to block
    if (!navigator.sendBeacon?.(url, body)) {
      fetch(url, { method: 'POST', body, keepalive: true }).catch(() => {});
    }
  } catch { /* never break the app */ }
}

/** Record entering a section. */
export function mark(name: string): void {
  post({ mark: name });
}

/** Record a completed section with duration in ms. */
export function span(name: string, durMs: number): void {
  post({ span: name, ms: Math.round(durMs * 10) / 10 });
}

// Long-task observer: reports any main-thread block > 50 ms with its duration.
if (ENABLED && typeof PerformanceObserver !== 'undefined') {
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        post({ longtask: Math.round(e.duration), at: Math.round(e.startTime) });
      }
    });
    po.observe({ entryTypes: ['longtask'] });
  } catch { /* longtask not supported */ }
}

// Heartbeat for the first 30 s — when the freeze starts, heartbeats stop,
// bracketing the freeze onset between the last two timestamps.
if (ENABLED) {
  let beats = 0;
  const hb = setInterval(() => {
    post({ heartbeat: ++beats });
    if (beats >= 30) clearInterval(hb);
  }, 1000);
  window.addEventListener('error', (e) => post({ error: String(e.message).slice(0, 300) }));
  window.addEventListener('unhandledrejection', (e) =>
    post({ rejection: String((e as PromiseRejectionEvent).reason).slice(0, 300) }));
}
