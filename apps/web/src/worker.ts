import { createJobRunner, type FromWorker, type ToWorker } from "./job.ts";

export type { FromWorker, ToWorker } from "./job.ts";

interface WorkerScope {
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  postMessage(m: FromWorker, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

const run = createJobRunner({
  // The core and its adapters load on the first file, as a separate chunk, so the page itself stays small.
  importCore: () => import("@pubmy/core/browser"),
  base: self.location.href,
  post: (m, transfer) => scope.postMessage(m, transfer),
});

scope.onmessage = (e) => void run(e.data);
