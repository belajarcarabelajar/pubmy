# pubmy memory

Lessons from working sessions, as `WHEN <situation> → DO <action>, NOT <anti-pattern>` rules. Newest group last.

## Task Group: pubmy v1 (plan 2026-11-07-pubmy-v1)

| # | Rule |
|---|---|
| M1 | WHEN changing a dependency while parallel agents test through `colab-test` (it runs `bun install --frozen-lockfile`) → DO update `package.json` and `bun.lock` together (`bun install`) and commit both before telling the agents, NOT edit `package.json` first (every agent run in between failed with "lockfile had changes, but lockfile is frozen"). |
| M2 | WHEN a script or fixture outside `packages/*` and `apps/*` imports an npm package → DO declare it in the root `devDependencies` (the isolated linker only links a workspace's own deps), NOT rely on the package being declared by `packages/core` (`fixtures/make-*.ts` could not resolve fflate, pdf-lib or @napi-rs/canvas). |
| M3 | WHEN judging whether an EPUB is valid for Kindle → DO keep the Java EPUBCheck cross-check (`bun scripts/epubcheck-java.ts`, on Colab), NOT trust epubcheck-ts alone (it passed 17 RSC-005 errors in Gutenberg #28885 MOBI6 output that Java rejected). |
| M4 | WHEN a library decides browser vs Node by sniffing `typeof document` → DO load it before any linkedom DOM globals exist or hide `document` while importing it, NOT assume a Bun process stays global-free (a MOBI conversion made tesseract.js take the browser path and every later scan failed with "window is not defined"). |
| M5 | WHEN checking the live headers of pubmy.belajarcarabelajar.com → DO remember the zone transform rules run after the Worker (`csp-fallback` replaces CSP for hosts not on its list; `security-headers-baseline` sets Referrer-Policy), NOT read `apps/web/public/_headers` as what clients get. pubmy was added to the csp-fallback list on 2026-11-07; backup in `~/cloudflare/backups/zone-ae649c02-response-headers-20261107-pubmy.json`. |

## Task Group: preview and PDF precision (plan 2026-11-07-pubmy-preview)

| # | Rule |
|---|---|
| M6 | WHEN declaring an adapter's output good → DO convert at least one real-world file of that format and count its defects (running-header leaks, fragment chapter titles, missing figures or tables against the source), NOT rely on synthetic fixtures alone (v1 passed every gate, and the owner's first NIH manuscript showed 22 header leaks, split headings, dropped figures and a lost sideways table). |
| M7 | WHEN choosing an EPUB construct for Kindle (SVG, tables, images, fonts) → DO check Amazon's Kindle Publishing Guidelines first (https://kindlegen.s3.amazonaws.com/AmazonKindlePublishingGuidelines.pdf), NOT pick what EPUB 3 allows (11.4.11: `<svg>` with `<text>` is not supported; 11.4: transparency is flattened to white; 11.5.1 prefers HTML tables over table images). |

## Task Group: formulas and diagrams as crops (session 2026-11-07-pubmy-formulas)

| # | Rule |
|---|---|
| M8 | WHEN measuring rendered output (formula crops, figures, previews) → DO open a sample of the PNGs from each real file, NOT trust counts, sizes and EPUBCheck alone (107 OpenStax crops and EPUBCheck 0/0 looked done; viewing them showed inline crops with tall fences and sums cutting into the lines above and below). |
| M9 | WHEN a throwaway harness feeds a file to pdf.js → DO pass `new Uint8Array(readFileSync(p))` as the CLI does, NOT the Buffer `readFileSync` returns (pdf.js refuses a Buffer, and pdfAdapter reports READ_FAILED, which looked like a regression on arXiv and the NIH sample). |

## Task Group: install methods (plan 2026-11-07-pubmy-install-methods)

| # | Rule |
|---|---|
| M10 | WHEN a test extracts per-OS blocks (bash, PowerShell) from Markdown → DO track every code fence and assert the blocks of every language on every OS, NOT only the language the current OS runs (a `# comment` in the bash block ended the section, and only the Windows CI leg saw it). |
| M11 | WHEN documenting where a third-party installer writes files → DO install once per target with a temporary HOME and read the result, NOT copy the vendor's docs table (the skills CLI docs listed `~/.codex/skills`, `~/.cursor/skills`; the CLI wrote `~/.agents/skills`). |

## Task Group: release hardening (plan 2026-11-07-pubmy-release-hardening)

| # | Rule |
|---|---|
| M12 | WHEN running `plan-closeout.mjs --readiness` (or briefing a reviewer to) for a pubmy plan → DO pass `--cwd` to a worktree that has `node_modules` (a detached NVMe worktree after `bun install --frozen-lockfile`), NOT the session worktree on the external disk (its `skip_if` tests fail on imports and tasks read OPEN; a reviewer reported a false blocker from it). |
| M13 | WHEN a plan task's `run[]` proves a tool installed only for a verification → DO prove the lasting deliverable (the README row or test it produced), NOT `<tool> --version` (the owner later removed Codex and Cursor and the closeout runner failed T6 with exit 127). |

## Task Group: web UI polish (plan 2026-11-09-pubmy-web-ui-polish)

| # | Rule |
|---|---|
| M14 | WHEN listing what a page lacks (missing error text, static title, no progress) → DO read the glue code that fills the page (`apps/web/src/main.ts`) before writing the list, NOT infer from `index.html` and the `i18n.ts` table (a review claimed failures had no in-row reason and the title was static; `statusText` and `applyLang` already covered both). |
| M15 | WHEN a plan task edits a file that already has a green test → DO give its `skip_if` and first RED step a NEW test file (a missing file exits non-zero), NOT the existing test or `bun run typecheck` (both pass on `main`, so the closeout runner reads the task as done before any work). |

## Task Group: web overflow menu (plan 2026-11-09-pubmy-web-overflow-menu)

| # | Rule |
|---|---|
| M16 | WHEN a browser-only bug is intermittent (a popover closing right after it opens) → DO log the state each handler sees (event order, `scrollY`, which events fired) and repeat the real-browser run at least 5 times before and after each fix attempt, NOT trust unit or text-test greens (the first fix recorded the opening position in `toggle`, which the browser skips when the menu closes in the same task; it was green in unit tests and still failed 2 of 5 runs). |

## Task Group: web preview reading (plan 2026-11-09-pubmy-web-preview-immersive)

| # | Rule |
|---|---|
| M17 | WHEN a design calls a browser API on a specific element (fullscreen on the preview dialog) → DO call it once in the real browser and read the promise result before writing the tests, NOT assume it works because the method exists (`dialog.requestFullscreen()` exists and rejects with "Dialog elements are invalid"; a text test pinned the wrong call and the `typeof` guard hid nothing). |
