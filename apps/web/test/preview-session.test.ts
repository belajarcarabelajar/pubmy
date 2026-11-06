import { describe, expect, test } from "bun:test";
import { pack } from "@pubmy/core/browser";
import { startCountdown, type CountdownItem } from "../src/countdown.ts";
import type { EpubLoader } from "../src/epub-loader.ts";
import { createPreview, type Reader } from "../src/preview-session.ts";

const RETENTION = 180_000;

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

const EPUB_BYTES = pack({
  meta: { title: "Lifecycle", creators: [], language: "en", modified: "2026-11-07T00:00:00Z" },
  chapters: [{ href: "ch001.xhtml", title: "One", body: "<p>One</p>" }],
  assets: [],
  toc: [],
  layout: "reflow",
  direction: "ltr",
});

/**
 * Stands in for foliate at the renderer boundary: it makes a blob URL for the section it shows
 * and revokes it in destroy(), as foliate's loader does. hold() keeps the next mount pending.
 */
function fakeReader() {
  const s = { created: [] as string[], revoked: [] as string[], loaders: [] as EpubLoader[], destroyed: 0 };
  let gate: Promise<void> | null = null;
  let release = () => {};
  const mount = async (loader: EpubLoader): Promise<Reader> => {
    s.loaders.push(loader);
    if (gate) await gate;
    const blob = loader.loadBlob("OEBPS/ch001.xhtml");
    const url = blob ? URL.createObjectURL(blob) : null;
    if (url) s.created.push(url);
    return {
      destroy() {
        s.destroyed++;
        if (url) {
          URL.revokeObjectURL(url);
          s.revoked.push(url);
        }
      },
    };
  };
  const hold = () => {
    gate = new Promise<void>((r) => (release = r));
  };
  return { s, mount, hold, release: () => release() };
}

function setup() {
  const clock = fakeClock();
  const reader = fakeReader();
  const closes: number[] = [];
  const preview = createPreview({ mount: reader.mount, onClose: () => closes.push(clock.now()) });
  const row = (): CountdownItem => {
    const item: CountdownItem = { url: "blob:download", epub: EPUB_BYTES.slice(), remaining: 0, expired: false };
    startCountdown(item, { ms: RETENTION, now: clock.now, setTimer: clock.setTimer, revoke: () => {}, onTick: preview.onTick });
    return item;
  };
  return { clock, reader, closes, preview, row };
}

describe("createPreview", () => {
  test("at expiry the open preview closes", async () => {
    const { clock, closes, preview, row } = setup();
    const item = row();
    expect(await preview.open(item)).toBe(true);
    clock.advance(RETENTION - 1);
    expect(preview.current).toBe(item);
    clock.advance(1);
    expect(preview.current).toBeNull();
    expect(closes).toEqual([RETENTION]);
  });

  test("at expiry the reader is destroyed, revoking every blob URL it made", async () => {
    const { clock, reader, preview, row } = setup();
    await preview.open(row());
    expect(reader.s.created.length).toBe(1);
    clock.advance(RETENTION);
    expect(reader.s.destroyed).toBe(1);
    expect(reader.s.revoked).toEqual(reader.s.created);
  });

  test("at expiry the preview's copy of the bytes is dropped", async () => {
    const { clock, reader, preview, row } = setup();
    await preview.open(row());
    const loader = reader.s.loaders[0]!;
    expect(loader.loadText("META-INF/container.xml")).not.toBeNull();
    clock.advance(RETENTION);
    expect(loader.loadText("META-INF/container.xml")).toBeNull();
  });

  test("an expired row does not open", async () => {
    const { clock, reader, preview, row } = setup();
    const item = row();
    clock.advance(RETENTION);
    expect(await preview.open(item)).toBe(false);
    expect(reader.s.loaders).toEqual([]);
    expect(preview.current).toBeNull();
  });

  test("another row's expiry leaves the open preview alone", async () => {
    const { clock, closes, reader, preview, row } = setup();
    row();
    clock.advance(60_000);
    const later = row();
    await preview.open(later);
    clock.advance(RETENTION - 60_000);
    expect(preview.current).toBe(later);
    expect(reader.s.destroyed).toBe(0);
    expect(closes).toEqual([]);
  });

  test("a row that expires while the reader mounts is closed once mounting ends", async () => {
    const { clock, reader, preview, row } = setup();
    const item = row();
    reader.hold();
    const opening = preview.open(item);
    clock.advance(RETENTION);
    reader.release();
    expect(await opening).toBe(false);
    expect(reader.s.destroyed).toBe(1);
    expect(reader.s.revoked).toEqual(reader.s.created);
    expect(preview.current).toBeNull();
  });

  test("closing by hand destroys the reader once, and the later expiry adds nothing", async () => {
    const { clock, closes, reader, preview, row } = setup();
    await preview.open(row());
    preview.close();
    clock.advance(RETENTION);
    expect(reader.s.destroyed).toBe(1);
    expect(closes).toEqual([0]);
  });
});
