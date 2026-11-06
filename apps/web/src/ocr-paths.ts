/**
 * Same-origin URLs for loadOcrBrowser. They must be absolute: tesseract.js starts its worker from a
 * blob: URL, where relative importScripts and fetch paths do not resolve.
 */
export function ocrPaths(base: string): { workerPath: string; corePath: string; langPath: string } {
  const at = (p: string) => new URL(p, base).href;
  return { workerPath: at("tesseract/worker.min.js"), corePath: at("tesseract/"), langPath: at("tesseract/lang") };
}
