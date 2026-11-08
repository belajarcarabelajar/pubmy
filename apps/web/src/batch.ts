import { type AsyncZippable, zip } from "fflate";

export interface ZipEntry {
  name: string;
  epub: Uint8Array;
}

/** `a.epub` taken a second time becomes `a (2).epub`; the number goes before the last extension. */
function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** ZIP of the given EPUBs, stored without compression (EPUBs are already zip files), built off the main thread. */
export function zipEpubs(entries: ZipEntry[]): Promise<Uint8Array> {
  const taken = new Set<string>();
  const files: AsyncZippable = {};
  for (const entry of entries) {
    const name = uniqueName(entry.name, taken);
    taken.add(name);
    files[name] = [entry.epub, { level: 0 }];
  }
  return new Promise((resolve, reject) => {
    zip(files, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

/** Which batch buttons show: Download all from 2 ready rows, Clear all from 1 row of any kind. */
export function batchView(rows: number, ready: number): { downloadAll: boolean; clearAll: boolean } {
  return { downloadAll: ready >= 2, clearAll: rows >= 1 };
}

export interface BatchBar {
  batch: HTMLElement;
  downloadAll: HTMLButtonElement;
  clearAll: HTMLButtonElement;
  choose: HTMLButtonElement;
}

/** Shows the bar and its buttons from the row counts. A batch button that had focus and now hides hands focus to Choose, because a browser drops focus from a hidden control. */
export function applyBatchBar(doc: Document, bar: BatchBar, rows: number, ready: number): void {
  const view = batchView(rows, ready);
  const focusedBtn = [bar.downloadAll, bar.clearAll].find((b) => b === doc.activeElement);
  bar.batch.hidden = !view.downloadAll && !view.clearAll;
  bar.downloadAll.hidden = !view.downloadAll;
  bar.clearAll.hidden = !view.clearAll;
  if (focusedBtn?.hidden) bar.choose.focus();
}
