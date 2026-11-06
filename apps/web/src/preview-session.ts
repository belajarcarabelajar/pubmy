import type { CountdownItem } from "./countdown.ts";
import { createEpubLoader, type EpubLoader } from "./epub-loader.ts";

/** The reader in the preview dialog: foliate's book and renderer in the page, a stand-in in tests. */
export interface Reader {
  /** Stops rendering and revokes every blob URL the reader made. */
  destroy(): void;
}

export interface PreviewOptions {
  /** Builds the reader over the loader and shows the first page. */
  mount(loader: EpubLoader): Promise<Reader>;
  /** Runs once each time an open preview ends, however it ends. */
  onClose(): void;
}

export interface Preview {
  /** The row whose EPUB is open, or null. */
  readonly current: CountdownItem | null;
  /** Opens a ready row. False when the row has expired, also when it expires or is closed while the reader mounts. */
  open(item: CountdownItem): Promise<boolean>;
  /** Give to the row's countdown as onTick: closes the preview when the row it shows expires. */
  onTick(item: CountdownItem): void;
  close(): void;
}

interface Session {
  item: CountdownItem;
  loader: EpubLoader;
  reader: Reader | null;
}

/**
 * One preview at a time, inside the retention window: when its row expires, the reader is
 * destroyed and the unzipped copy of the EPUB is dropped, just as the download link is revoked.
 */
export function createPreview(o: PreviewOptions): Preview {
  let session: Session | null = null;

  const end = (s: Session) => {
    s.loader.close();
    s.reader?.destroy();
  };

  const close = () => {
    const s = session;
    if (!s) return;
    session = null;
    try {
      end(s);
    } finally {
      o.onClose();
    }
  };

  return {
    get current() {
      return session?.item ?? null;
    },
    async open(item) {
      // The dialog shows one book; a new one replaces the old without closing the dialog.
      if (session) end(session);
      session = null;
      if (item.expired || !item.epub) return false;
      const s: Session = { item, loader: createEpubLoader(item.epub), reader: null };
      session = s;
      let reader: Reader;
      try {
        reader = await o.mount(s.loader);
      } catch (e) {
        if (session !== s) return false;
        close();
        throw e;
      }
      if (session !== s) {
        reader.destroy();
        return false;
      }
      s.reader = reader;
      return true;
    },
    onTick(item) {
      if (item.expired && session?.item === item) close();
    },
    close,
  };
}
