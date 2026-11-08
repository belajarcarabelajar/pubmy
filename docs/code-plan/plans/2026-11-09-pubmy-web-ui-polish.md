---
schema: ultra-plan/v1
plan_id: 2026-11-09-pubmy-web-ui-polish
status: Draft
version: 1
runner_contract: true
defaults:
  retry_transient_max: 1
  step_timeout_s: 180
  on_precondition_fail: stop-task-continue-independent
  allow_loose_skip_if: []
  require_impacts: true
  allow_no_impacts: []
  require_traceability: true
  retry_if: any
tasks:
  - id: T1
    depends_on: []
    impacts: ["build.ts fills empty data-i18n elements by regex over index.html - bun test apps/web/test/build-output.test.ts", "id/en key parity and required keys - bun test apps/web/test/i18n.test.ts", "CSP and headers stay valid with inline SVG and a favicon - bun test apps/web/test/headers.test.ts"]
    files: { create: [apps/web/public/icon.svg, apps/web/test/theme.test.ts], modify: [apps/web/index.html, apps/web/src/i18n.ts, apps/web/test/i18n.test.ts, apps/web/test/build-output.test.ts], test: [] }
    idempotency_key: "T1:identity-dropzone-theme"
    skip_if: "bun test apps/web/test/theme.test.ts"
    verify_exit: 0
    run:
      - cmd: "bun test apps/web/test/theme.test.ts"
        expect_exit: 1
        retry: 0
      - cmd: "bun test apps/web/test/theme.test.ts apps/web/test/i18n.test.ts apps/web/test/build-output.test.ts apps/web/test/headers.test.ts"
        expect_exit: 0
        retry: 1
        timeout_s: 300
  - id: T2
    depends_on: [T1]
    impacts: ["main.ts builds the RowView passed to renderRow - bun run typecheck", "focus restoration and aria-labels asserted per control - bun test apps/web/test/row.test.ts"]
    files: { create: [apps/web/test/row-progress.test.ts], modify: [apps/web/src/row.ts], test: [apps/web/test/row.test.ts] }
    idempotency_key: "T2:row-progress-badge-hierarchy"
    skip_if: "bun test apps/web/test/row-progress.test.ts"
    verify_exit: 0
    run:
      - cmd: "bun test apps/web/test/row-progress.test.ts"
        expect_exit: 1
        retry: 0
      - cmd: "bun test apps/web/test/row-progress.test.ts apps/web/test/row.test.ts"
        expect_exit: 0
        retry: 1
  - id: T3
    depends_on: []
    impacts: ["main.ts imports the batch helpers in T4 - bun run typecheck", "fflate 0.8 is already a dependency of apps/web, no new package - rg fflate apps/web/package.json"]
    files: { create: [apps/web/src/batch.ts, apps/web/test/batch.test.ts], modify: [], test: [] }
    idempotency_key: "T3:batch-zip-view"
    skip_if: "bun test apps/web/test/batch.test.ts"
    verify_exit: 0
    run:
      - cmd: "bun test apps/web/test/batch.test.ts"
        expect_exit: 1
        retry: 0
      - cmd: "bun test apps/web/test/batch.test.ts"
        expect_exit: 0
        retry: 1
  - id: T4
    depends_on: [T1, T2, T3]
    impacts: ["the whole page bundle still builds and ships the new files - bun test apps/web/test/build-output.test.ts", "asset check of dist - bun run --cwd apps/web check:assets"]
    files: { create: [apps/web/test/wiring.test.ts], modify: [apps/web/src/main.ts], test: [] }
    idempotency_key: "T4:wire-progress-batch"
    skip_if: "bun test apps/web/test/wiring.test.ts"
    verify_exit: 0
    run:
      - cmd: "bun test apps/web/test/wiring.test.ts"
        expect_exit: 1
        retry: 0
      - cmd: "bun run typecheck"
        expect_exit: 0
        retry: 0
      - cmd: "bun test apps/web/test"
        expect_exit: 0
        retry: 1
        timeout_s: 300
---
# pubmy web UI polish Implementation Plan

> For agentic workers: REQUIRED EXECUTION METHOD: delegated task execution. Steps use checkbox syntax.

**Goal:** Give the pubmy web page a recognisable look and a clearer upload and queue flow (items 1 to 4 and 6 of the owner-approved review of 2026-11-09), without touching conversion code.

**Architecture:** The page is one HTML file with an authored `<style>` block (shipped as `style.css` by `build.ts`), a small i18n table, a pure row renderer (`row.ts`) and a DOM glue file (`main.ts`). T1 owns `index.html` and `i18n.ts` (theme, identity, drop zone, batch bar markup, every new string). T2 changes only `row.ts`. T3 adds a pure `batch.ts` (zip of ready EPUBs, batch bar visibility). T4 wires them in `main.ts`.

**Tech Stack:** Bun 1.4.4 (`bun:test`, linkedom for DOM tests), TypeScript, fflate 0.8 (already in `apps/web`), no UI framework.

**Active Project Profile:** repo `/home/belajarcarabelajar/Proyek/pubmy`, `main` clean at `02cf578`. Bun monorepo (`packages/core`, `apps/cli`, `apps/web`). Verified from files read: `apps/web/index.html`, `build.ts`, `src/{main,row,i18n,queue}.ts`, `public/_headers`, `test/{row,i18n,build-output}.test.ts`, `assets/icon.svg`. Commands: `bun run typecheck`, `bun test <file>` through `colab-test -C ~/Proyek/pubmy -- <cmd>` (A47), build `bun run --cwd apps/web build`.

**Protected Boundaries:** `packages/core` (conversion), `skills/pubmy/scripts/*` (generated), the live deploy (out of scope, no deploy here), `apps/web/vendor/foliate`.

**Spec:** none (Bounded path); decisions recorded below.

**Scope:** (1) identity: favicon and logo from `assets/icon.svg`, accent colour from the icon, short headline; (2) privacy line as a badge; (3) drop zone with icon, format chips, limits as secondary text; (4) queue rows: real `<progress>` bar, status badges, Download as the only filled button; (6) "Download all" (ZIP) and "Clear all".

**Non-Goals:** dark mode, overflow menu or new countdown wording, refusals shown inside rows, Send to Kindle hint, e2e or browser tests (A42), any change to conversion, queue limits or retention (180 s).

**Visual Map:**

```mermaid
flowchart TD
    accTitle: pubmy web UI polish task map
    accDescr: Theme and identity (T1) and the batch helpers (T3) start in parallel; the row renderer (T2) needs T1's strings; the main.ts wiring (T4) waits for all three, then verification and the pull request.
    G0{{"Design approval"}} --> T1["T1 theme, identity, drop zone, strings"]
    G0 --> T3["T3 batch.ts: zip and bar visibility"]
    T1 --> T2["T2 row.ts: progress, badge, hierarchy"]
    T1 --> T4["T4 main.ts wiring"]
    T2 --> T4
    T3 --> T4
    T4 --> V["Verify: typecheck, bun test apps/web/test, build"]
    V --> D(["Done: PR, debt sweep"])
```

**Reasoning Lenses:** intent (owner wants a better look now, short turns), investigative (CSS, build regex and CSP read), user-centered and accessibility (touch targets, focus, live regions kept), systems (state flows main.ts to row.ts), test-first, verification.

**Acceptance Criteria:**
- [x] AC-1: `index.html` links a favicon (`icon.svg`) and the build ships `icon.svg`; the accent is the icon's teal `#0f5c63`. (evidence: `bun test apps/web/test/build-output.test.ts` exit 0)
- [x] AC-2: every text and background colour pair in the authored CSS tokens is at least 4.5:1 (WCAG AA), and focus outlines at least 3:1. (evidence: `bun test apps/web/test/theme.test.ts` exit 0)
- [x] AC-3: the privacy line is a badge with a lock icon, and the new strings exist in id and en with parity. (evidence: `bun test apps/web/test/i18n.test.ts` exit 0)
- [x] AC-4: the drop zone shows an icon and format chips; the hint strings `drop-hint` and `drop-hint-touch` stay as they are (limits stay in the hint, `id="drop-hint"` stays the text-bearing element); the chip set matches the `accept` attribute (aliases and archive types excluded, listed in the test); the build still fills `data-i18n` elements without erasing the icon (the label sits in its own span). (evidence: `bun test apps/web/test/theme.test.ts apps/web/test/build-output.test.ts` exit 0)
- [x] AC-5: a converting row has a `<progress class="bar">` with its value, each status has a `.badge` with an `aria-hidden` glyph, and Download is the only filled control; every control keeps its file-named `aria-label` and focus restoration. (evidence: `bun test apps/web/test/row-progress.test.ts apps/web/test/row.test.ts` exit 0)
- [x] AC-6: `zipEpubs` resolves to a ZIP of the given EPUBs with unique entry names; `batchView` shows Download all from 2 ready rows and Clear all from 1 row. (evidence: `bun test apps/web/test/batch.test.ts` exit 0)
- [x] AC-7: every element id that `main.ts` reads exists in `index.html`; `main.ts` wires progress, Download all (blob URL revoked after use) and Clear all, with a live-region announcement; typecheck and the whole `apps/web/test` folder pass. (evidence: `bun test apps/web/test/wiring.test.ts` exit 0, `bun run typecheck` exit 0, `bun test apps/web/test` exit 0)

**Traceability:**

| AC | Task | Check | Evidence |
|---|---|---|---|
| AC-1 | T1 | `bun test apps/web/test/build-output.test.ts` | exit 0 |
| AC-2 | T1 | `bun test apps/web/test/theme.test.ts` | exit 0 |
| AC-3 | T1 | `bun test apps/web/test/i18n.test.ts` | exit 0 |
| AC-4 | T1 | `bun test apps/web/test/theme.test.ts apps/web/test/build-output.test.ts` | exit 0 |
| AC-5 | T2 | `bun test apps/web/test/row-progress.test.ts apps/web/test/row.test.ts` | exit 0 |
| AC-6 | T3 | `bun test apps/web/test/batch.test.ts` | exit 0 |
| AC-7 | T4 | `bun test apps/web/test/wiring.test.ts`, `bun run typecheck`, `bun test apps/web/test` | exit 0 |

**Assumptions & Open Questions:**
- Owner approved items 1 to 4 and 6 ("agreed, do it now", 2026-11-09). Items 5, 7, 8, 9, 10 are not in scope.
- Assumption (my judgment): the accent is the icon's teal, so the page matches the logo; a different brand colour is a one-line token change.
- Assumption (my judgment): "Download all" is a stored (level 0) ZIP named `pubmy-epub.zip`, because EPUBs are already compressed. It uses fflate's async `zip` (off the main thread; `worker-src 'self' blob:` allows its worker), not `zipSync`.
- Measured before design (colab-test ct2, exit 0): `bun test` of a missing test file exits 1, so the four new test files make every `skip_if` fail on `main`.
- Correction to the review: failed conversions already show their reason inside the row (`statusText` in `main.ts`); only queue refusals (limit, size) use the separate red list. `document.title` is already localised; only the meta description is static.
- `applyLang` sets `textContent` on `[data-i18n]` elements, so an icon must be a sibling of the labelled span, never a child.

**Dependencies & Impact:** `row.test.ts` asserts aria-labels and the clock text, and `i18n.test.ts` asserts required keys; both stay green. `build.ts` pulls only `<style>` and empty `data-i18n` elements from `index.html`.

**Risks & Rollback:** visual only; rollback = revert the PR. Risk: the build regex mishandles the new markup (caught by `build-output.test.ts`); focus loss when rows re-render (caught by `row.test.ts`). Download all holds the EPUBs plus the ZIP in memory at once (up to about 10 x 50 MB input, EPUBs are usually smaller); the async zip keeps the page responsive, and the 180 s retention window already bounds how long the bytes live.

**Security & Compatibility:** no new network use; the favicon and inline SVG are covered by `img-src 'self' data:`; no inline `style=""` attributes (a `<progress>` element needs none).

**Operations & Rollout:** PR, CI, merge by owner, deploy only on explicit request.

**CI/Review Gate:** parent diff audit and an independent reviewer before the PR.

**Documentation:** none (README has no UI description to update; checked by `rg -n -i 'drop zone|queue' README.md` at T4).

**Definition of Done:** AC-1..AC-7 checked with evidence, typecheck exit 0, `bun test apps/web/test` exit 0, build exit 0, PR opened, debt sweep run.

**Plan Status & Version:** Draft, v1.

**Reproducibility:** Bun 1.4.4; tests run through `colab-test` (A47), local fallback targeted (A12).

**Test Reliability:** DOM tests use linkedom, no browser; colour tokens are parsed from `index.html`, so they cannot drift from the shipped CSS.

**Privacy & Data Governance:** no user data; the page still uploads nothing.

**Dependencies & Supply Chain:** no new package.

**UX States:** empty (drop zone only), waiting, converting (progress), ready, failed, expired (Deleted), refused, batch bar hidden below its thresholds.

**Persistent State & Artifact Storage:** none; ZIP blob URL is revoked right after the click.

**Entity & Sourcing Verification:** WCAG 2.2 AA contrast ratios (4.5:1 text, 3:1 non-text) computed in the test from the CSS values; icon colour read from `assets/icon.svg` (`#0f5c63`).

**Verification:** `bun run typecheck`; `bun test apps/web/test`; `bun run --cwd apps/web build`.

## Global Constraints

- No em dash in new copy or code comments.
- Git is parent-only; subagents edit files and run tests only.
- No e2e or browser runs unless the owner asks (A42).
- Commit messages conventional, no attribution lines.

## Session checklist

- [x] Plan validated (`ultra-plan-runner.mjs` exit 0, Validation: OK) and Design approved (owner, 2026-11-09)
- [x] Worktree claimed: `/mnt/belajarcarabelajar/pubmy-wt/pubmy-web-ui-polish`, branch `2026-11-09-pubmy-web-ui-polish/pubmy-web-ui-polish`
- [x] T1: RED `bun test apps/web/test/theme.test.ts` exit 1 (16 fail); GREEN four test files exit 0 (56 pass, 1 skip), typecheck exit 0 (commit d28f1f1)
- [x] T3: RED exit 1 (module missing); GREEN `bun test apps/web/test/batch.test.ts` exit 0 (7 pass); three mutations each failed one test (commit fd175f8)
- [x] T2: RED exit 1 (10 fail, 3 pass); GREEN row-progress + row tests exit 0 (20 pass), typecheck exit 0 (commit 497ef52)
- [x] T4: RED `bun test apps/web/test/wiring.test.ts` exit 1 (4 fail, 1 pass), `theme.test.ts` hidden-button case exit 1 (1 fail); GREEN `bun run typecheck` exit 0, `bun test apps/web/test` exit 0 (142 pass, 1 skip, 0 fail); added `button[hidden]{display:none}` because `button{display:inline-flex}` overrode `hidden`
- [x] Parent diff audit and independent review: reviewer `staid` verdict `correct` (no P0/P1; `colab-test -- bun test apps/web/test` exit 0, 142 pass); P2 R1 (expired row painted green), P2 R2 (revoke test vacuous), P3 R3 (focus loss), P3 R4 (progress read twice) fixed test-first: RED exit 1 (3 fail; R2 proven by deleting the revoke line in a scratch copy), GREEN `bun run typecheck` exit 0, `bun test apps/web/test` exit 0 (143 pass, 1 skip, 0 fail); `check-copy-rules.mjs --diff origin/main` exit 0; `bun run --cwd apps/web build` exit 0
- [ ] PR opened
- [ ] Debt sweep

## Task T1: theme, identity, drop zone, strings

**Files:** Create `apps/web/public/icon.svg` (copy of `assets/icon.svg`), `apps/web/test/theme.test.ts`; Modify `apps/web/index.html`, `apps/web/src/i18n.ts`, `apps/web/test/i18n.test.ts`, `apps/web/test/build-output.test.ts`.
**Interfaces (the contract T2 and T4 rely on, so T1 owns all CSS and markup):**
- CSS custom properties on `:root`: `--accent` (`#0f5c63`), `--bg`, `--surface`, `--text`, `--muted`, `--border`, `--ok`, `--err`.
- Class names T1 styles and T2 emits: `li .badge` (coloured by the row class `li.waiting|converting|ready|failed|deleted`), `.badge-icon` (the glyph, `aria-hidden`), `progress.bar`, `.row-actions button.ghost` (lighter weight than `.btn`), `.chip`, `.chips`, `.batch` (the batch bar).
- Markup ids T4 reads: `batch` (bar, `hidden` by default), `download-all`, `clear-all`.
- New i18n keys (id and en): `download-all`, `clear-all`. The `privacy` text stays. The ZIP file name `pubmy-epub.zip` is fixed in code, not a string.
- `drop-hint` and `drop-hint-touch` keep their current text; `id="drop-hint"` stays the text-bearing element (`aria-labelledby` and `main.ts` depend on it).
**Behavior & Acceptance:** AC-1 to AC-4. Header shows the logo beside the title; the privacy line is a badge (lock SVG, label in its own `data-i18n` span); the drop zone has an upload icon and format chips (static text).
**Edge Cases:** `build.ts` fills only empty `<tag data-i18n></tag>`, and `applyLang` sets `textContent`, so every labelled element is empty in source and icons are siblings. No inline `style=""`.
**Deliberate Shortcuts:** None.
**Test Data & Determinism:** `theme.test.ts` reads `index.html`, extracts the custom properties, computes relative luminance and asserts text pairs at least 4.5:1 and the focus outline at least 3:1; it also asserts the chip set equals the `accept` extensions, excluding the aliases `markdown`, `htm`, `azw` and the types `zip`, `rar`, `epub` (listed in the test).

## Task T2: row progress, badge, hierarchy

**Files:** Create `apps/web/test/row-progress.test.ts`; Modify `apps/web/src/row.ts`; existing `apps/web/test/row.test.ts` must stay green unchanged.
**Interfaces:** `RowView` gains `progress?: number` (0 to 1). Output uses only the class names T1 pinned: `<progress class="bar">` while `status === "converting"` (with `value` and `max="1"` when progress > 0, indeterminate otherwise); a `<span class="badge">` holding a `<span class="badge-icon" aria-hidden="true">` glyph (waiting "o", converting "~", ready "+", failed "x", deleted "-") plus the status text; Download stays `.btn`, the other actions stay `ghost`. No CSS is edited here.
**Behavior & Acceptance:** AC-5. Existing aria-labels, `data-action` names, clock text and focus-restoration contract unchanged.
**Edge Cases:** progress 0 renders an indeterminate bar; expired rows keep no clock and no extend.
**Deliberate Shortcuts:** None.
**Test Data & Determinism:** linkedom document, as in `row.test.ts`.

## Task T3: batch helpers

**Files:** Create `apps/web/src/batch.ts`, `apps/web/test/batch.test.ts`.
**Interfaces:** `zipEpubs(entries: { name: string; epub: Uint8Array }[]): Promise<Uint8Array>` (fflate async `zip`, level 0, duplicate names get ` (2)` before the extension); `batchView(rows: number, ready: number): { downloadAll: boolean; clearAll: boolean }`.
**Behavior & Acceptance:** AC-6.
**Edge Cases:** empty list resolves to a valid empty ZIP; two files named `a.epub` become `a.epub` and `a (2).epub`.
**Deliberate Shortcuts:** None.
**Test Data & Determinism:** `unzipSync` round trip on small byte arrays.

## Task T4: wire progress and batch actions

**Files:** Create `apps/web/test/wiring.test.ts`; Modify `apps/web/src/main.ts`.
**Interfaces:** `render` passes `progress` to the view; `refreshBatch()` shows or hides `#batch` from `batchView`; Download all builds the ZIP (`pubmy-epub.zip`) from rows whose `ready` is set and not expired, clicks a temporary link and revokes the URL; Clear all calls `removeRow` for every row.
**Behavior & Acceptance:** AC-7. Each batch action announces through `announce`; focus returns to the Choose button after Clear all.
**Edge Cases:** a row expiring while the ZIP is built is skipped; the bar refreshes on every `onChange`, expiry and removal.
**Deliberate Shortcuts:** the DOM glue in `main.ts` is not exercised in a browser (A42); `wiring.test.ts` is the RED step and asserts that every `$("id")` and `getElementById` id in `main.ts` exists in `index.html`, and that `main.ts` references `pubmy-epub.zip`.
**Test Data & Determinism:** text of `main.ts` and `index.html`, no build.
