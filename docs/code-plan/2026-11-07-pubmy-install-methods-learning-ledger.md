# Learning ledger: pubmy install methods (2026-11-07)

Plan: `docs/code-plan/plans/2026-11-07-pubmy-install-methods.md`. Session: `pubmy-install-methods`, PR #14.

## Mistake log

| # | What happened | Cost | Caught by |
|---|---|---|---|
| 1 | `scripts/readme-install.test.ts` found section ends with `^(#+) ` but tracked only fences of the wanted language, so the `# Claude Code` comment in the bash block ended the section before the PowerShell block. Linux and macOS passed because the bash block comes first. | One red Windows CI run, one fix commit | CI `install (windows-latest)` |
| 2 | The plan named the Cursor CLI `cursor-agent` before reading the vendor page; the documented binary is `agent` (`cursor-agent` is a second symlink). | One plan edit | Reading cursor.com/docs/cli/installation |
| 3 | The skills CLI docs page lists global paths (`~/.codex/skills`, `~/.cursor/skills`, `~/.gemini/antigravity/skills`) that the CLI does not use; it wrote `~/.agents/skills` for all four. | None, measured before documenting | Temp-HOME install per agent |
| 4 | A `worktree add` with the path in a shell variable was refused by `worktree-guard.py`; AGENTS A44 already says path literal. | One retry | Hook |
| 5 | A throwaway probe built a function from source text with `new Function` and broke on TypeScript syntax; copying the function with `sed` worked. | One call | Exit code |

## Candidate rules

| Rule | Minimum signal | 30-day | Verdict |
|---|---|---|---|
| WHEN a test extracts per-OS blocks (bash, PowerShell) from Markdown → DO assert the blocks for every language on every OS and track every fence, NOT only the language the current OS runs (the Windows-only parser bug reached CI) | yes | yes | KEEP (judgement) → MEMORY.md M10 |
| WHEN documenting where a third-party installer writes files → DO measure it with a temporary HOME per target, NOT copy the vendor's docs table (skills CLI docs disagreed with the CLI) | yes | yes | KEEP (judgement) → MEMORY.md M11 |
| Cursor binary name | no (one-off fact, now in the plan) | no | NO-OP |
| Variable path refused by worktree guard | no (A44 already covers it) | n/a | NO-OP |
| `new Function` probe | no | no | NO-OP |

## Environment improvements

- None kept. The repository has no `evals/scenarios/`, so no scenario follow-up applies.
