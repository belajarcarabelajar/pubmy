# Learning ledger: pubmy web inline CSS (2026-11-09)

Plan: none (one coupled change, checklist in the session). Session: `pubmy-web-inline-css`.

## Mistake log

| # | What happened | Cost | Caught by |
|---|---|---|---|
| 1 | I tried to tell the page's state apart from absolute pixel colors in the screen recording (background and text color of the unstyled frame). The recorder shifts colors (the teal button read (10,72,77) where the CSS says (15,92,99)), so none of it could be used. | About six tool calls, no effect on the fix | The advisor said to leave colors out; the palette check showed the offset |
| 2 | I read contact-sheet tile numbers as original frame numbers. `drawtext` `%{n}` after `select` counts the selected frames. | One wrong reading of which frame was the flash | Cross-checking against the per-frame timestamps from the diff pass |
| 3 | I polled a background run with `sleep 45` plus `tail`. | One blocked call | The harness; the rule already exists in `~/CLAUDE.md` |

## Candidate rules

| Rule | Minimum signal | 30-day | Verdict |
|---|---|---|---|
| WHEN reading a screen recording to learn what a page did → DO decide from frame timestamps, phase durations compared with timers in the code, and layout, NOT from absolute pixel colors | yes | yes | KEEP (judgement) → MEMORY.md M18 |
| WHEN a hide-until-ready rule must cover the first paint → DO put it inline in the document head, NOT in the external stylesheet it would wait for | yes | yes | KEEP (mechanical): the check landed as `first-paint.test.ts`, so no `MEMORY.md` row |
| WHEN polling a background job → DO wait for its notification | yes | no | NO-OP: already in `~/CLAUDE.md` |

## Environment improvements

- Information access: the recording carries no console or network data, so why `main.js` missed the 1.5 s timer once stays unexplained until the owner reloads with DevTools open. Not a file change.
- None kept otherwise.
