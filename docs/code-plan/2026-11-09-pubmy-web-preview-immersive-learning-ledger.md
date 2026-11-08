# Learning ledger: pubmy web preview reading (2026-11-09)

Plan: `docs/code-plan/plans/2026-11-09-pubmy-web-preview-immersive.md`. Session: `pubmy-web-preview-immersive`.

## Mistake log

| # | What happened | Cost | Caught by |
|---|---|---|---|
| 1 | The owner said the preview had no way to hide the sidebar. The list already had a toggle that worked; the real problems were the default at tablet width, the plain text button and no full screen. | None, because I measured first and told the owner | Real-browser repro before the design |
| 2 | The design, plan and tests asked for fullscreen on the `<dialog>`. Chromium rejects it ("Dialog elements are invalid"); the tests only read `main.ts` as text, so they asserted the wrong call. | One fix, tests rewritten, one more build and browser run | The browser harness, with a wrapper that logged the rejection |
| 3 | A drawer left open when the preview closed showed again, with its dark layer, while the next book was loading, because only the reader sets the list state after it loads. | One fix with two browser checks | Independent reviewer (F1) |
| 4 | The pressed Full screen state was invisible and three wiring tests stayed green under a regression (`&&` to `||`, a commented-out call, a constant `aria-pressed`). | A style rule and three tighter tests | Independent reviewer (F3, F4) |
| 5 | My own harness first failed on a keyboard step (focus sat inside the book's frame) and on comparing the fullscreen element's id (the frame has none). | Two harness fixes, no product change | Reading the failure detail before touching the product |

## Candidate rules

| Rule | Minimum signal | 30-day | Verdict |
|---|---|---|---|
| WHEN a design calls a browser API on a specific element → DO call it once in the real browser and read the result before writing the tests | yes | yes | KEEP (judgement) → MEMORY.md M17 |
| WHEN a text test pins an implementation line → DO make it an exact-line match, not substring checks | yes | partly | NO-OP: covered by the mutation habit and P1 |
| WHEN the owner says a feature is missing → DO measure the live page first | yes | partly | NO-OP: already M14 (read the real code before listing what is missing) |

## Environment improvements

- None kept. `colab-test` fell back to `ct2` once; the browser harness ran locally with `HEAVY_LOCAL`.
