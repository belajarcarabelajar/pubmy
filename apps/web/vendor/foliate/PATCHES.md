# Local patches to the vendored foliate-js

Keep these when the vendored files are refreshed from upstream. Each patch is marked `pubmy patch` in the source.

## paginator.js, `View.render`: no render before the section has a body

- **Symptom:** a page error `TypeError: Cannot destructure property 'style' of 't' as it is null` from `columnize`, in about 1 of 5 opens of a large real EPUB (the book still opened). Measured on 36 opens: 8 errors.
- **Cause:** the paginator's `ResizeObserver` and its attribute changes call `Paginator.render()` as soon as the view exists. At that moment the chapter iframe is still `readyState: "loading"`: its document and `<html>` exist but `<body>` does not, so `columnize` hands `null` to `setStylesImportant`.
- **Patch:** `View.render(layout)` returns when `this.document?.body` is missing. Nothing is lost: the iframe's `load` handler (`View.load`) renders again with a fresh layout once the body exists.
- **Pinned by:** `apps/web/test/foliate-patch.test.ts` (text) and the browser error counts recorded in `docs/code-plan/plans/2026-11-09-pubmy-epub-opener.md` (task F8).
