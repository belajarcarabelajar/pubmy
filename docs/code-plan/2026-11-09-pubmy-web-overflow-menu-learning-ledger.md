# Learning ledger: pubmy web overflow menu (2026-11-09)

Plan: `docs/code-plan/plans/2026-11-09-pubmy-web-overflow-menu.md`. Session: `pubmy-web-overflow-menu`, PR #18.

## Mistake log

| # | What happened | Cost | Caught by |
|---|---|---|---|
| 1 | The menu closed right after opening in 2 of 5 light-320 browser runs. The first fix stored the opening scroll position in the `toggle` handler. When the menu closes in the same task the browser fires only `toggle:closed`, so the position stayed 0 and the guard still closed the menu. Unit and text tests were green. | One extra fix, one extra build and browser matrix | Repeated real-browser runs, then an event log that included `scrollY` |
| 2 | `:popover-open` is an invalid selector where the Popover API is missing, so `closeMenus` would throw on every scroll and resize; `.menu` was `position:fixed` without the open state, so it would show as a loose box over the row. The plan claimed it renders inline and still works, but only the click handler was tested. | Two small fixes, test first | Independent reviewer (F1) |
| 3 | The scroll test only checked that identifier names appeared in the function body, so flipping `<` to `>=` kept it green. | The guard became a pure function with boundary tests | Independent reviewer (F2) |
| 4 | The browser matrix output was piped through `rg`, so the harness exit code was never captured and the PR text had to say so. | A caveat in the evidence | Parent, at the stop-hook check |

## Candidate rules

| Rule | Minimum signal | 30-day | Verdict |
|---|---|---|---|
| WHEN a browser-only bug is intermittent → DO log handler state and repeat the real-browser run at least 5 times before and after each fix | yes | yes | KEEP (judgement) → MEMORY.md M16 |
| WHEN a test checks a guard only by the names in its text → DO move the condition into a pure function with boundary tests | yes | partly | NO-OP: covered by the existing mutation habit and P1 |
| WHEN a CSS rule uses a state selector newer than the supported browsers → DO keep the layout properties inside that rule | yes | no | NO-OP: the case is now a test (`theme-dark.test.ts`) |
| Piping the harness through `rg` hides its exit code (mistake 4) | yes | yes | NO-OP: covered by A2 |

## Environment improvements

- None kept. `colab-test` ran each suite in 8 to 25 s; the browser harness ran locally (it needs the built bundle and Chromium on this machine) with `HEAVY_LOCAL`.
