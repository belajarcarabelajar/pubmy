import { describe, expect, test } from "bun:test";
import { startCountdown, type CountdownItem } from "../src/countdown.ts";

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

/** One countdown on a fresh fake clock, with every revoke and every tick recorded. */
function start(it: CountdownItem) {
  const clock = fakeClock();
  const revoked: string[] = [];
  const ticks: number[] = [];
  const countdown = startCountdown(it, {
    ms: 180_000,
    now: clock.now,
    setTimer: clock.setTimer,
    revoke: (u) => revoked.push(u),
    onTick: (x) => ticks.push(x.remaining),
  });
  return { clock, revoked, ticks, countdown };
}

const item = (url: string): CountdownItem => ({ url, remaining: 0, expired: false });

describe("Countdown.pause", () => {
  test("after pause ten minutes of time do not expire the item and remaining holds", () => {
    const a = item("blob:a");
    const { clock, countdown } = start(a);
    clock.advance(61_000);
    expect(a.remaining).toBe(119_000);
    countdown.pause();
    clock.advance(600_000);
    expect(a.expired).toBe(false);
    expect(a.url).toBe("blob:a");
    expect(a.remaining).toBe(119_000);
  });

  test("pause fires no onTick and no revoke", () => {
    const a = item("blob:a");
    const { clock, countdown, revoked, ticks } = start(a);
    clock.advance(61_000);
    const before = ticks.length;
    countdown.pause();
    expect(ticks.length).toBe(before);
    clock.advance(600_000);
    expect(ticks.length).toBe(before);
    expect(revoked).toEqual([]);
  });

  test("pausing one millisecond before the deadline still stops the expiry", () => {
    const a = item("blob:a");
    const { clock, countdown, revoked } = start(a);
    clock.advance(179_999);
    countdown.pause();
    clock.advance(1);
    expect(a.expired).toBe(false);
    clock.advance(600_000);
    expect(a.expired).toBe(false);
    expect(revoked).toEqual([]);
  });

  test("extend after pause gives a full window, expiring exactly 180 s later", () => {
    const a = item("blob:a");
    const { clock, countdown, revoked, ticks } = start(a);
    clock.advance(61_000);
    countdown.pause();
    clock.advance(600_000);
    const before = ticks.length;
    countdown.extend();
    expect(a.remaining).toBe(180_000);
    expect(ticks.length).toBe(before + 1);
    clock.advance(179_999);
    expect(a.expired).toBe(false);
    expect(a.url).toBe("blob:a");
    expect(revoked).toEqual([]);
    clock.advance(1);
    expect(a.expired).toBe(true);
    expect(a.url).toBeUndefined();
    expect(a.remaining).toBe(0);
    expect(revoked).toEqual(["blob:a"]);
  });

  test("the stop function while paused expires at once and revokes once", () => {
    const a: CountdownItem = { url: "blob:a", epub: new Uint8Array([1, 2, 3]), remaining: 0, expired: false };
    const { clock, countdown, revoked, ticks } = start(a);
    clock.advance(61_000);
    countdown.pause();
    const before = ticks.length;
    countdown();
    expect(a).toMatchObject({ expired: true, remaining: 0, url: undefined, epub: undefined });
    expect(revoked).toEqual(["blob:a"]);
    expect(ticks.length).toBe(before + 1);
    expect(ticks.at(-1)).toBe(0);
    clock.advance(600_000);
    countdown.extend();
    clock.advance(600_000);
    expect(revoked).toEqual(["blob:a"]);
    expect(ticks.length).toBe(before + 1);
  });

  test("pause after expiry does nothing, and extend after it still brings nothing back", () => {
    const a = item("blob:a");
    const { clock, countdown, revoked, ticks } = start(a);
    clock.advance(180_000);
    expect(a.expired).toBe(true);
    const before = ticks.length;
    countdown.pause();
    countdown.extend();
    clock.advance(600_000);
    expect(a).toMatchObject({ expired: true, remaining: 0, url: undefined });
    expect(revoked).toEqual(["blob:a"]);
    expect(ticks.length).toBe(before);
  });

  test("pause twice then extend still gives one full window", () => {
    const a = item("blob:a");
    const { clock, countdown, revoked } = start(a);
    clock.advance(61_000);
    countdown.pause();
    countdown.pause();
    clock.advance(600_000);
    countdown.extend();
    expect(a.remaining).toBe(180_000);
    clock.advance(179_999);
    expect(a.expired).toBe(false);
    clock.advance(1);
    expect(a.expired).toBe(true);
    expect(revoked).toEqual(["blob:a"]);
  });

  test("an item with no url pauses, extends and expires without error and without a revoke", () => {
    const a: CountdownItem = { remaining: 0, expired: false };
    const { clock, countdown, revoked } = start(a);
    clock.advance(5_000);
    countdown.pause();
    clock.advance(600_000);
    expect(a.expired).toBe(false);
    expect(a.remaining).toBe(175_000);
    countdown.extend();
    expect(a.remaining).toBe(180_000);
    clock.advance(180_000);
    expect(a.expired).toBe(true);
    expect(a.remaining).toBe(0);
    expect(revoked).toEqual([]);
  });
});
