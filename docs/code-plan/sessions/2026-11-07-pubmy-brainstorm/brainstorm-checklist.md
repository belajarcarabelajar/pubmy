# Brainstorm checklist: konversi apa pun ke EPUB (Kindle)

Skill path used: `/home/belajarcarabelajar/vivera/Super Ultra Code Plan Implementation.md` (first in fallback chain).
Classification: Architectural (new project, no existing flow).
Session started 2026-11-07. Brainstorm only: no plan, code, repo, worktree, or branch.

## Session checklist (parent-owned)

- [x] S1 Skills loaded: sucp-rules + sucp-brainstorm via Skill tool (evidence: both Skill calls returned "Launching skill", 2026-11-07)
- [x] S2 Local toolchain probed (evidence: `command -v` loop: ebook-convert, pandoc, soffice, ocrmypdf, epubcheck, java, marker, docling MISSING; markitdown ~/.local/bin; tesseract 5.5.4-1 via pacman)
- [x] S3 Grounding wave dispatched (evidence: 7 Agent calls G1-G7 launched async, manifest below)
- [x] S4 G1 local repos (evidence: no EPUB writer in ~/Proyek; reusable OCR `didline/packages/ocr/src/didline_ocr/__init__.py:129` pdf_to_markdown, parent read the line; pdftoppm + mdbook present)
- [x] S5 G2 vivera install surface (evidence: `vivera/scripts/install/targets.sh:15-27` target dirs, `docs/guide/getting-started-quick-start-2.md:40-45` no harness load verified; parent read both)
- [x] S6 G3 Kindle facts (evidence: amazon.com nodeId G5WYD9SAF7PGXRNA + G7NECT4B4ZWHQ8WV, seen 2026-11-07: EPUB accepted, MOBI gone, web 200 MB, email 25 files / 50 MB; e999 tied to epubcheck errors, github harvard-edge/cs249r_book#1148; no public API, SMTP only)
- [x] S7 G4 harness skill dirs (evidence: vendor docs fetched 2026-11-07: ~/.claude/skills (Claude Code), ~/.agents/skills (Codex, Cursor, OpenCode), ~/.gemini/config/skills (Antigravity); load not yet tested on this machine)
- [x] S8 G5 engines (evidence: particula.tech 2026-09-24, themenonlab 2026-03-26, KCC README: Docling MIT for PDF, pandoc Office/HTML/MD, calibre MOBI/AZW3, KCC comics, ocrmypdf scanned, epubcheck validate; Marker weights restricted)
- [x] S9 G6 hosting (evidence: CF Containers need Workers Paid $5, R2 lifecycle removal "within 24 hours"; Cloud Run free tier, no image size limit, timeout 300-3600 s (docs 2026-10-30/11-02); Vercel 4.5 MB body limit; CF proxy 100 MB on Free. Parent adds: box /data ~587 MB free (memory project-box-disk-render) and tunnel traffic does not wake the box (AGENTS.md 7.3))
- [x] S10 G7 market/legal (evidence: Send to Kindle already converts PDF/DOCX/EPUB free; CloudConvert/Zamzar/Convertio keep files ~24 h with daily caps (snippets only); UU PDP 27/2022 enforceable since 2024-10-17; refuse DRM)
- [x] S11 Grill round 1 (evidence: AskUserQuestion answered 4/4, recorded verbatim in Grill log)
- [x] S10a G8 browser PDF/OCR (evidence: unpdf MIT, pdf.js 6.4.299, extractTextItems with font/x/y, inspectPages flags scanned pages; MuPDF.js AGPL; tesseract.js Apache-2.0 ~7 MB eng; pandoc-wasm README: binary output as Blob in result.files, npm GPL-2.0+; EPUB output likely, untested; all fetched 2026-11-07)
- [x] S10b G9 MOBI/comics/epubcheck (evidence: foliate-js mobi.js MIT reader, repack not turnkey, DRM via PalmDoc encryption field; CBZ fixed-layout recipe deckle#20; libarchive.js 2.0.2 for CBR (2024, license unconfirmed); @likecoin/epubcheck-ts 0.7.0 BSD-3, browser+Node, 95.9% valid/invalid agreement vs Java 5.4.0; fetched 2026-11-07)
- [x] S12 Grill rounds until frontier empty (evidence: rounds 1-5 answered via AskUserQuestion, 20 answers recorded verbatim; A-D all In)
- [x] S13 Intent Lock drafted (evidence: draft `2026-11-07-pubmy-intent-lock.md` in this folder; Mermaid rendered by mmdc exit 0, 251751-byte SVG; shown in chat)
- [x] S14 Intent approval gate (evidence: AskUserQuestion header Intent answered "Approve, save in pubmy (Recommended)")
- [x] S15 Intent Lock saved (evidence: ~/Proyek/pubmy/docs/code-plan/intent-locks/2026-11-07-pubmy-intent-lock.md, cp exit 0)
- [x] S16 graphify: ~/Proyek/pubmy is not a git repo and has no graphify-out/graph.json, so `graphify update .` and vivera `graphify:sync` were skipped (recorded 2026-11-07)

## Grounding manifest

| Chunk | Surface | Scope | Expected output | Verification |
|---|---|---|---|---|
| G1 | local repos | `rg -il epub ~/Proyek` (no node_modules), dawnbook, didline | reusable code with file:line | parent reads cited lines |
| G2 | vivera install | `~/vivera/install.sh`, skill targets | harness dirs + file:line | parent reads cited lines |
| G3 | Kindle docs | amazon.com Send to Kindle pages | formats, size limits, EPUB rules | source URL + date |
| G4 | harness docs | vendor docs of 5 harnesses | skill dir + format per harness | source URL + date |
| G5 | engines | calibre, pandoc, marker/docling etc. | engine per input format | source URL + date |
| G6 | hosting | CF Containers, Fly, box, Vercel etc. | cost, limits, fit | source URL + date |
| G7 | market/legal | existing converters, DRM, copyright | gap + constraints | source URL + date |

## Grill log

### Round 1 (2026-11-07), answers verbatim
- Audience: "Public from day one" (Human-locked; agent recommended Personal first)
- Formats: "PDF digital, PDF scanned (OCR), Docs and web, MOBI/AZW3 and comics" (Human-locked)
- Skill runs: "On local machine (Recommended)" (Human-locked)
- Delivery: "Download/file only" (Human-locked; no Send-to-Kindle email in v1)

### Round 2 (2026-11-07), answers verbatim
- Hosting: "cloudflare worker versi free plan" (free text; conflicts with server-side engines, see note)
- Access: "Anonymous + Turnstile (Recommended)" (Human-locked)
- File size: "50 MB per file (Recommended)" (Human-locked)
- Retention: "3 min after conversion (Recommended)" (Human-locked)
- Note (parent, evidence): Workers Free = 10 ms CPU/request, 128 MB memory per isolate, request body 100 MB on Free zone (developers.cloudflare.com/workers/platform/limits, updated 2026-10-29). calibre/pandoc native/Docling cannot run there. pandoc 3.9 ships an official WASM build that runs in the browser (pandoc.org/app; discourse.haskell.org 2026-02-05, ~16 MB). Hosting answer restated and re-asked once.

### Round 2b (2026-11-07), answers verbatim
- Hosting: "Convert in browser (Recommended)" (Human-locked: Worker Free serves static page, conversion client-side)
- Repo: "One public repo, MIT (Recommended)" (Human-locked)
- UI language: "Indonesian + English (Recommended)" (Human-locked)
- Follow-up research dispatched: G8 browser PDF/OCR + pandoc wasm EPUB output; G9 browser MOBI/comics/epubcheck.
- Repo name (free text, mid-turn): "rename repo to: pubman", corrected to "pubmy maksudnya" → Human-locked: `pubmy`

### Round 3 (2026-11-07), answers verbatim
- Skill engine: "Shared core, Bun + WASM (Recommended)" (Human-locked)
- Turnstile: "Drop Turnstile (Recommended)" (Human-locked; supersedes round 2 Access)
- Retention: "Clear from memory at 3 min (Recommended)" (Human-locked; supersedes round 2 meaning)
- Domain: "pubmy.belajarcarabelajar.com (Recommended)" (Human-locked)

### Round 4 (2026-11-07), answers verbatim
- MOBI/AZW3: "Full support in v1" (Human-locked; agent recommended beta label)
- OCR lang: "Indonesian + English (Recommended)" (Human-locked)
- Folder mode: "Recursive, mirror, skip done (Recommended)" (Human-locked)
- Acceptance: "epubcheck + your real Kindle (Recommended)" (Human-locked)

### Round 5 (2026-11-07), answers verbatim
- Test device: "Paperwhite 10th gen" (Human-locked)
- Fixtures: "Public-domain + generated (Recommended)" (Human-locked)
- Install: "Manual copy in README" (Human-locked; agent recommended installer)
- Analytics: "CF Web Analytics only (Recommended)" (Human-locked)
- Frontier after round 5: empty (remaining choices recorded as Agent-default assumptions in the lock).

## Phase 3: design (user said "Continue" after the Intent gate, 2026-11-07) (+10 items)

- [x] S17 Probe gate (evidence: answered "Run spike + git init (Recommended)")
- [x] S18 git init (evidence: `git init -b main` + .gitignore, `git status` exit 0)
- [x] S19 P1 pandoc.wasm (evidence: parent re-ran `epubcheck.js out.epub` exit 0; `stat` pandoc.wasm 58,580,800 B > 25 MiB Workers asset limit; pandoc-wasm 1.1.0 GPL-2.0-or-later; subagent control with PNG removed exit 1)
- [x] S20 P2 MOBI repack (evidence: parent re-ran `bun test core.test.ts` exit 0, 4 pass; epubcheck-ts exit 0 on the 4 outputs; 2 stale pre-fix outputs moved to scratch)
- [x] S21 P3 OCR (evidence: p3-ocr-speed/run-warm-page.log `exit=0`, tesseract.js 7.0.0, mean 1.90 s/page, CER 0-0.07% clean, 0.23-0.42% degraded; peak RSS 197,960 kB; ind 1,194,182 B + eng 2,952,873 B compressed, core wasm 2,862,266 B)
- [x] S22 P4 (evidence: inspectPages scanned textLength 0 / imageCoverage 1 in pdf-layout.out.txt:66; reading order partly correct; headings 11.96 vs body 10.91 so 1.2 rule fails; parent decoded libarchive test RAR4 + RAR5 fixtures, `bun src/cbr-probe.ts` exit 0, entries listed and extracted (cbr-rar-probe.out.txt); libarchive COPYING = BSD-2 style, wrapper MIT)
- [x] S23 Spike report (evidence: docs/code-plan/spikes/2026-11-07-pubmy-core/REPORT.md, Mermaid rendered by mmdc exit 0)
- [x] S24 Approaches + matrix (evidence: A1 4.4 / A3 3.4 / A2 2.8 shown; answered "A1 adapter + own packager (Recommended)")
- [ ] S25 Design sections approved and spec written + committed (finish line: commit sha)
- [ ] S26 Spec gate answered (header Spec)

### Design gate answers (2026-11-07), verbatim
- Section 1 architecture: "A1 adapter + own packager (Recommended)" (Human-locked)
- Doc reader: "Small permissive readers (Recommended)" (Human-locked; pandoc.wasm dropped: 58,580,800 B > 25 MiB, GPL)
- Section 2: "Approve section 2 (Recommended)" (Human-locked)
- Invalid EPUB: "Refuse, show errors (Recommended)" (Human-locked)
- Section 3: "Approve section 3 (Recommended)" (Human-locked)
