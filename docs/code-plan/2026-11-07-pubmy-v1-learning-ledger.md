# Session learning ledger: pubmy v1 (2026-11-07)

## Mistake log (raw)

| # | What happened | Evidence | Cost |
|---|---|---|---|
| L1 | Parent edited `package.json` before `bun install` finished; parallel agents' `colab-test` runs failed on the frozen lockfile. | T3, T8, T10, T11 reports ("lockfile had changes, but lockfile is frozen") | 4 agents fell back to local runs or waited |
| L2 | `fixtures/` sat outside the workspaces; fixture makers could not resolve npm packages. | T3, T4, T5, T6, T9 reports; fixed in `e818504` | several agents wrote their own zip writers |
| L3 | `gh pr merge --match-head-commit b6ed3fb6` failed (needs the full SHA); the chained `pr-registry state merged` still ran, so the registry said merged for about a minute before the real merge. | chat log 2026-11-07, merge `df95512` | registry briefly wrong; the registry refused the revert |
| L4 | `cmd \| rg pattern < /dev/null` searched the working directory instead of the pipe (a known AGENTS.md A43 trap, repeated). | PR body attribution check, rerun with a file | one misleading scan, caught and redone |
| L5 | `sucp-verify-deliver` was loaded only after PR #1 merged, so the `Close plan` gate was not asked before the final merge; a closeout PR became necessary. | session order | one extra PR |
| L6 | The live CSP was replaced by a zone rule (`csp-fallback`) that nobody looked at before deploying. | live header test exit 1, zone ruleset read | one shared-zone edit after deploy |
| L7 | epubcheck-ts accepted RSC-005 errors that Java EPUBCheck rejects. | T13 run 5, fixed in `0e47746` | caught by the planned cross-check |
| L8 | linkedom DOM globals leaked into later conversions and broke OCR. | bundle test, fixed in `e17a5fe` | one debugger round |
| L9 | The v1 PDF gates used synthetic PDFs and one arXiv paper with no running headers, so the owner's first real paper (an NIH author manuscript) exposed five defects: header/footer leaks, cut paragraphs, split headings, dropped figures, a lost sideways table. | owner report 2026-11-07, `nihms496502.pdf` measured against its EPUB | a follow-up session |
| L10 | The first plan for sideways tables (SVG with `<text>`) was picked before reading Amazon's Kindle Publishing Guidelines, which say `<svg>` with `<text>` is not supported (11.4.11). | research report, owner re-asked | one extra owner question; caught before code |

## Candidate rules (both gates: minimum signal, 30-day horizon)

| Rule | Gates | Class | Destination |
|---|---|---|---|
| M1 lockfile with package.json before signalling agents | pass / pass | judgement | `MEMORY.md` M1 |
| M2 root devDependencies for scripts and fixtures | pass / pass | mechanical | `MEMORY.md` M2 |
| M3 keep the Java EPUBCheck cross-check | pass / pass | judgement | `MEMORY.md` M3 |
| M4 libraries that sniff `document` vs linkedom globals | pass / pass | judgement | `MEMORY.md` M4, code follow-up (scope the globals) |
| M5 zone header rules override Worker headers | pass / pass | judgement, cross-repo | `MEMORY.md` M5; promotion to `~/AGENTS.md` 4.x asked separately |
| L3 merge with the full SHA and record `merged` only after `gh pr view` says MERGED | pass / pass | mechanical, cross-repo | follow-up for vivera `pr-registry.mjs` (other repository: backlog) |
| L4, L5 | existing rules (A43; sucp phase router) were already right; the miss was execution | no-op | none |
| L9 measure each adapter on at least one real-world file with counted defects (header leaks, fragment chapters, missing assets), not only synthetic fixtures | pass / pass | judgement | `MEMORY.md` M6 |
| L10 check Amazon's Kindle Publishing Guidelines before choosing an EPUB construct for Kindle | pass / pass | judgement | `MEMORY.md` M7 |

## Environment improvements

- Recheck the meaning of "verified" in the vivera pr-registry: it accepted `state merged` without checking GitHub. Backlog for vivera.
