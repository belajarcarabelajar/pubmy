import { describe, expect, test } from "bun:test";
import { formatClock, startCountdown, type CountdownItem } from "../src/countdown.ts";

/** Fake clock: timers fire only when the test advances time. */
function fakeClock() {
  let t = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.push({ at: t + ms, fn, id });
      return () => {
        timers = timers.filter((x) => x.id !== id);
      };
    },
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const due = timers[0];
        if (!due || due.at > end) break;
        timers.shift();
        t = due.at;
        due.fn();
      }
      t = end;
    },
  };
}

const item = (url: string): CountdownItem => ({ url, remaining: 0, expired: false });

describe("startCountdown", () => {
  test("at 180 s it revokes each item's URL exactly once", () => {
    const clock = fakeClock();
    const revoked: string[] = [];
    const revoke = (u: string) => revoked.push(u);
    const a = item("blob:a");
    const b = item("blob:b");
    startCountdown(a, { ms: 180_000, now: clock.now, setTimer: clock.setTimer, revoke });
    startCountdown(b, { ms: 180_000, now: clock.now, setTimer: clock.setTimer, revoke });
    clock.advance(179_999);
    expect(revoked).toEqual([]);
    clock.advance(1);
    expect(revoked.sort()).toEqual(["blob:a", "blob:b"]);
    clock.advance(600_000);
    expect(revoked.length).toBe(2);
  });

  test("at 0 the item is marked expired and loses its URL", () => {
    const clock = fakeClock();
    const a = item("blob:a");
    startCountdown(a, { ms: 180_000, now: clock.now, setTimer: clock.setTimer, revoke: () => {} });
    clock.advance(180_000);
    expect(a.expired).toBe(true);
    expect(a.url).toBeUndefined();
    expect(a.remaining).toBe(0);
  });

  test("remaining time follows the clock and onTick sees it", () => {
    const clock = fakeClock();
    const a = item("blob:a");
    const ticks: number[] = [];
    startCountdown(a, { ms: 180_000, now: clock.now, setTimer: clock.setTimer, revoke: () => {}, onTick: (it) => ticks.push(it.remaining) });
    expect(a.remaining).toBe(180_000);
    clock.advance(61_000);
    expect(a.remaining).toBe(119_000);
    expect(ticks.at(-1)).toBe(119_000);
  });

  test("a throttled timer still expires on the wall-clock deadline", () => {
    const clock = fakeClock();
    const revoked: string[] = [];
    const a = item("blob:a");
    // Background tabs fire timers late: every timer here lands 100 s after it was asked for.
    const lazy = (fn: () => void, _ms: number) => clock.setTimer(fn, 100_000);
    startCountdown(a, { ms: 180_000, now: clock.now, setTimer: lazy, revoke: (u) => revoked.push(u) });
    clock.advance(200_000);
    expect(revoked).toEqual(["blob:a"]);
  });

  test("stop() revokes immediately and once, and no timer revokes again", () => {
    const clock = fakeClock();
    const revoked: string[] = [];
    const a = item("blob:a");
    const stop = startCountdown(a, { ms: 180_000, now: clock.now, setTimer: clock.setTimer, revoke: (u) => revoked.push(u) });
    clock.advance(5_000);
    stop();
    clock.advance(300_000);
    expect(revoked).toEqual(["blob:a"]);
  });
});

describe("formatClock", () => {
  test("shows mm:ss rounded up to the whole second", () => {
    expect(formatClock(180_000)).toBe("03:00");
    expect(formatClock(119_001)).toBe("02:00");
    expect(formatClock(9_000)).toBe("00:09");
    expect(formatClock(0)).toBe("00:00");
  });
});
