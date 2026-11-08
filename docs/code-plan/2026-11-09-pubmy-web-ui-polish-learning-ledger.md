# Learning ledger: pubmy web UI polish (2026-11-09)

Plan: `docs/code-plan/plans/2026-11-09-pubmy-web-ui-polish.md`. Session: `pubmy-web-ui-polish`, PR #17.

## Mistake log

| # | What happened | Cost | Caught by |
|---|---|---|---|
| 1 | The UI review said failures show as a red list with no next step and that the page title is static. Both were written from `index.html` and `i18n.ts` alone; `main.ts` already shows a failure reason inside the row (`statusText`) and sets `document.title` (`applyLang`). | One correction to the owner and a plan assumption | Reading `main.ts` while designing |
| 2 | The first plan draft gave T2 and T4 a `skip_if` that already exited 0 on `main` (the existing `row.test.ts`, `bun run typecheck`), so the closeout runner would have marked both done before any work. T4 also had no failing first step. | Plan rewritten with two new test files | Advisor consult before the Design gate |
| 3 | The T1 contract styled `.batch[hidden]` but not `button[hidden]`; `button{display:inline-flex}` beats the browser's `[hidden]` rule, so Download all could not hide. | One extra RED and GREEN pass in T4 | Parent, while wiring `refreshBatch` |
| 4 | The wiring test for the ZIP revoke used `/pubmy-epub\.zip[\s\S]*revokeObjectURL/` over the whole file and matched the existing `startRetention` call, so it passed with the new revoke deleted. | One test tightened | Independent reviewer (R2) |
| 5 | The row's CSS class came from the queue status, which `main.ts` leaves at "ready" after expiry, so an expired row got the green "ready" badge while its text said "Deleted". The test even asserted the wrong class. | One fix and test change | Independent reviewer (R1) |

## Candidate rules

| Rule | Minimum signal | 30-day | Verdict |
|---|---|---|---|
| WHEN listing what a page lacks (missing error text, static title, no progress) → DO read the glue code that fills the page (`main.ts`) before writing the list, NOT infer from the static HTML and the string table | yes | yes | KEEP (judgement) → MEMORY.md M14 |
| WHEN a plan task edits a file that already has a green test → DO give its `skip_if` and first RED step a NEW test file, because a missing test file exits non-zero, NOT the existing green test or `typecheck` (they pass on the base and the task reads done) | yes | yes | KEEP (judgement) → MEMORY.md M15 |
| WHEN JS toggles `hidden` on an element whose CSS sets `display` → DO add a `[hidden]{display:none}` rule | yes | yes | NO-OP: mechanical, the check landed (`theme.test.ts`, "a hidden button stays hidden") |
| WHEN a text-based wiring test orders two snippets with `[\s\S]*` → DO anchor on the new call and prove it red by deleting the line | yes | partly | NO-OP: covered by P1 and the mutation habit already in the repo rules |
| Row class and status text from different sources (mistake 5) | yes | no | NO-OP: the case is now a test (`row-progress.test.ts`) |

## Environment improvements

- None kept. `colab-test` fell back to the Simular box twice (80 to 85 s instead of 8 to 24 s); the overflow path worked as documented.
