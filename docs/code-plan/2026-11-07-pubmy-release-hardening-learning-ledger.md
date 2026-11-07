# Learning ledger: pubmy release hardening (2026-11-07)

Plan: `docs/code-plan/plans/2026-11-07-pubmy-release-hardening.md`. Session: `pubmy-release-hardening`, PR #16.

## Mistake log

| # | What happened | Cost | Caught by |
|---|---|---|---|
| 1 | `plan-closeout.mjs --readiness` ran its `skip_if` tests in the session worktree on the external disk, which has no `node_modules`; T1, T4 and T6 failed on imports and the verdict read NOT-READY. The reviewer hit the same and reported a blocking finding. | One disputed review finding, two extra readiness runs | Parent re-run with `--cwd` on an NVMe worktree with `node_modules` |
| 2 | The install-methods session claimed its worktree with an env prefix (`VIVERA_WORKTREE_ROOT=... bun scripts/pr-registry.mjs claim`), so `plan-cost.mjs` counted 0 transcripts for that plan. | Plan cost recorded as n/a | `plan-cost.mjs` caveat line |
| 3 | The install-methods plan's T6 `run[]` checked `codex --version` and `agent --version`, tools installed for one verification; after the owner removed them the closeout runner failed T6 with exit 127. | One plan amendment | Closeout runner |

## Candidate rules

| Rule | Minimum signal | 30-day | Verdict |
|---|---|---|---|
| WHEN running `plan-closeout.mjs --readiness` (or briefing a reviewer to) for a pubmy plan → DO pass `--cwd` to a worktree that has `node_modules` (a detached NVMe worktree after `bun install --frozen-lockfile`), NOT the session worktree on the external disk (imports fail and tasks read OPEN) | yes | yes | KEEP (judgement) → MEMORY.md M12 |
| WHEN a task's `run[]` proves a temporary tool install → DO prove the lasting deliverable (the doc or test it produced), NOT `<tool> --version` of a tool that may be removed later | yes | yes | KEEP (judgement) → MEMORY.md M13 |
| Env prefix on `pr-registry.mjs claim` hides the plan from `plan-cost` | yes | yes | NO-OP here: belongs to vivera's tooling, reported as a follow-up candidate |

## Environment improvements

- None kept.
