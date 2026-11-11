# Learning ledger: pubmy UI review fixes (2026-11-09)

Plan: `docs/code-plan/plans/2026-11-09-pubmy-ui-review-fixes.md`. Session: `pubmy-ui-review-fixes`, PR #22, plan issue #19.

## Mistake log

| # | What happened | Cost | Caught by |
|---|---|---|---|
| 1 | The triage said "monospace everywhere" was already fixed. It never existed; the claim came from memory, not from the CSS or its history. | One correction to the owner | Own re-check against the live CSS and `git log` |
| 2 | The triage named faux bold, only on the cover, as the cause of the doubled words. The pdf.js items showed page 2's running header drawn twice at the same spot (an overprint), and the leaked `Halaman : N dari N` rows sat just below the 10 percent band. | Plan assumptions rewritten, owner told | Probe scripts that dumped the items before T4 |
| 3 | The first header rule worked on a whole top and bottom zone by position and repetition. It also deleted per-page data rows near the page edge. | One review round, the rule narrowed to continue a block the band rule already found, RED and GREEN shown again | Independent reviewer (R1, P1) |
| 4 | Running the CLI from the worktree to compare before and after: `apps/cli/node_modules/@pubmy/core` resolves into the main checkout through the symlinked `node_modules`, so both runs used the old core and looked identical. | Several runs and a switch to absolute-path imports and scratch copies | The two outputs being byte-identical |
| 5 | After a context compaction I drafted the PR body from the summary. Five items were not backed by any log: a run count, the chapter count, the nav title count, a source line number and the sample table-of-contents order. | One re-measure with a script on both EPUBs and a body rewrite, before the PR was opened | Cross-checking each figure against the logs before opening the PR |
| 6 | The plan's forbidden-word list contained "EPUB" while the taglines must say "EPUB 3". | One docs commit | Own read of the plan against the copy |
| 7 | T3 (preview dialog) overlapped CSS lines a live peer session owned; it was dropped and deferred (A30). | Review point C stayed open until PR #20 merged | Plan review against `ListAgents` and the peer's diff |
| 8 | `git worktree add` with a `$R` path was refused by `worktree-guard`; `staid` stopped at its turn limit without a report. | One call each | Hook message; missing report (A14, A23 cover both) |

## Candidate rules

| Rule | Minimum signal | 30-day | Verdict |
|---|---|---|---|
| WHEN proving a `packages/core` change by running the CLI from a `wt-new` worktree → DO import the worktree's own `packages/core/src` by absolute path in a scratch script (or run through `colab-test`), NOT `bun apps/cli/src/main.ts` there (it loads the main checkout's core) | yes | yes | KEEP (judgement) → MEMORY.md M21 |
| WHEN a PDF rule deletes text by position and repetition → DO anchor it to a block the existing band rule detected, require a letter, and add a keep-test for a per-page data row near the edge, NOT a zone-wide rule | yes | yes | KEEP (judgement) → MEMORY.md M22 |
| WHEN a converted PDF shows doubled or leaked text → DO dump the pdf.js items of that page and read them before naming a cause, NOT guess from the output | yes | yes | KEEP (judgement) → MEMORY.md M23 |
| WHEN writing the evidence tables of a PR body or a ledger after a context compaction → DO take every figure from a log or a script run in this session, NOT from the summary | yes | yes | KEEP (judgement) → MEMORY.md M24 |
| WHEN a review claim says a feature "already was fixed" → DO quote `file:line` or `git log -S` | yes | yes | NO-OP: covered by A9 and M14 |
| WHEN a review round narrows a rule → DO rewrite the plan's AC text before ticking it | yes | partly | NO-OP: covered by the evidence-scope audit in `sucp-verify-deliver` |
| WHEN a plan's forbidden words clash with required copy (mistake 6) | yes | no | NO-OP: one-off, fixed in the plan |
| WHEN a task overlaps a live peer session's files (mistake 7), `$var` worktree path and `staid` turn limit (mistake 8) | yes | yes | NO-OP: A30, A14 and A23 already say it |

No `evals/scenarios/` in this repository, so no scenario proposals. All four kept rules are judgement rules: no fixed pattern detects them.

## Environment improvements

- None kept. Promotion candidate, not asked: M18 recurs in every repo whose worktrees come from `wt-new` (the symlinked `node_modules` is documented in `~/AGENTS.md` section 1, the workspace-package resolution is not). It stays in this repository unless the owner asks for a `Promote` question.

## Carry-forward

- Rules M21 to M24 are in `MEMORY.md` under "Task Group: UI review fixes". They were written when the highest ID on `origin/main` was M17; by the rebase on 2026-11-12 main had added M18 to M20, so these four were renumbered from M18 to M21 to M21 to M24.
