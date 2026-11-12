const FRAME_WAIT_MS = 2000;
const IDLE_TIMEOUT_MS = 1000;

/**
 * Yields to the event loop with a message, not a timer: browsers throttle
 * timers in background tabs but still deliver messages.
 */
export function yieldTask(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(null);
    } catch {
      resolve();
    }
  });
}

/** Resolves with the result of `start`, or `null` on rejection or after `limitMs`. */
export function within<T>(start: () => T | PromiseLike<T>, limitMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), limitMs);
    const settle = (value: T | null) => {
      clearTimeout(timer);
      resolve(value);
    };
    void Promise.resolve()
      .then(start)
      .then(settle, () => settle(null));
  });
}

function whenIdle(run: () => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
  } else {
    setTimeout(run, 0);
  }
}

/**
 * Runs `run` once, after the next paint and in idle time. Animation frames do
 * not fire in a hidden tab, so the frame wait is skipped there and bounded
 * everywhere else.
 */
export function afterPaint(run: () => void): void {
  let started = false;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  const start = () => {
    if (started) return;
    started = true;
    clearTimeout(fallback);
    whenIdle(run);
  };
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  if (hidden || typeof requestAnimationFrame !== 'function') {
    start();
    return;
  }
  fallback = setTimeout(start, FRAME_WAIT_MS);
  requestAnimationFrame(() => requestAnimationFrame(start));
}
