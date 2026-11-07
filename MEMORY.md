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
