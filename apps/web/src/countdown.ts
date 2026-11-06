/** A ready row while its download link lives (the retention window). */
export interface CountdownItem {
  url?: string;
  /** Milliseconds left, 0 once expired. */
  remaining: number;
  expired: boolean;
}

export interface CountdownOptions {
  ms: number;
  now(): number;
  /** Schedules fn once after about `ms`; returns a cancel function. */
  setTimer(fn: () => void, ms: number): () => void;
  revoke(url: string): void;
  onTick?(item: CountdownItem): void;
}

/**
 * Counts down to a wall-clock deadline, so a throttled background tab still expires on time.
 * At 0, or when the returned stop() is called, the URL is revoked exactly once.
 */
export function startCountdown(item: CountdownItem, o: CountdownOptions): () => void {
  const deadline = o.now() + o.ms;
  let cancel: (() => void) | null = null;
  let done = false;

  const expire = () => {
    if (done) return;
    done = true;
    cancel?.();
    cancel = null;
    if (item.url) o.revoke(item.url);
    item.url = undefined;
    item.remaining = 0;
    item.expired = true;
    o.onTick?.(item);
  };

  const tick = () => {
    if (done) return;
    item.remaining = Math.max(0, deadline - o.now());
    if (item.remaining === 0) return expire();
    o.onTick?.(item);
    // Wake on the next whole-second boundary so mm:ss changes in step with the clock.
    cancel = o.setTimer(tick, item.remaining % 1000 || 1000);
  };

  tick();
  return expire;
}

/** mm:ss, rounded up so the display reaches 00:00 only at expiry. */
export function formatClock(ms: number): string {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}
