# Learning ledger: 2026-11-16-pubmy-site-pages

| # | What happened | Cost | Rule candidate | Minimum-signal | 30-day | Verdict |
|---|---|---|---|---|---|---|
| L1 | The plan claimed the site stores only `pubmy.lang`, from a grep of `apps/web/src` | caught by the privacy writer before commit; plan assumption corrected | check the libraries too (M25) | yes: the next privacy or README edit would repeat it | yes | KEEP (M25) |
| L2 | `impacts` for the header move searched `id="lang"`; `wiring.test.ts` and `epub-open-wiring.test.ts` pinned the bare names | two unplanned test edits during T2 and T4 | grep the bare name (M26) | yes | yes | KEEP (M26) |
| L3 | T4 imported `site/layout.ts` into `i18n.ts`; the converter `main.js` grew from 21,898 to 30,661 bytes | one extra task (T5) | none: `site-polish.test.ts` now fails on it | no: the test is the guard | n/a | DROP (mechanical guard) |
| L4 | First screenshot round came after T3, not after T1 | the phone header wrap and squeezed table needed a fifth task | none: screenshots were opt-in and caught it in the same session | no | n/a | DROP |
| L5 | MEMORY.md M1 tells agents to run through `colab-test`, which refuses this repo since 2026-11-14 | none this session (plan used `HEAVY_LOCAL`) | covered by `~/AGENTS.md` A47 | no | n/a | DROP (global rule already current) |
