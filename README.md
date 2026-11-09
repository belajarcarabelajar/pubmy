# pubmy

pubmy turns your documents, ebooks, and comics into EPUB files that Kindle accepts. It comes in two forms:

- **Website** at [pubmy.belajarcarabelajar.com](https://pubmy.belajarcarabelajar.com): drop up to 10 files (50 MB each), preview each EPUB in the page, and download one EPUB per file, or every ready file at once with Download all (ZIP). A file you drop that is already an EPUB (.epub) is not converted: it opens in the reader so you can read it.
- **Agent skill and CLI**: give your coding agent (Claude Code, Codex, Cursor, OpenCode, Antigravity) a folder, and it converts every supported file in it, keeping the folder layout.

Every EPUB is EPUB 3 with a table of contents, and is checked with an EPUB validator before it is written.

## Supported formats

| Input | Extensions | Notes |
|---|---|---|
| PDF with text | `.pdf` | Columns and headings are detected from the text layout. Running headers, footers and page numbers are removed. Without a PDF outline, an unnumbered heading set smaller than the numbered ones stays inside its chapter and is listed under it in the table of contents. Figures are kept as images, and a table printed sideways is rebuilt as a table. Formulas and line diagrams are kept as pictures of their area of the page, so they look exactly as printed |
| Scanned PDF | `.pdf` | Read with OCR in Indonesian and English (`ind+eng`) |
| Word processor and text documents | `.docx`, `.odt`, `.rtf`, `.html`, `.htm`, `.md`, `.txt` | Headings become chapters |
| Kindle ebooks without DRM | `.mobi`, `.azw3` | Files with DRM are refused (see DRM policy) |
| Comics | `.cbz`, `.cbr` | Fixed layout, one image per page; right-to-left page order for manga |

## Privacy

- **Website:** conversion runs inside your own browser. Your files are not uploaded to any server. Each EPUB stays in the browser tab's memory and is wiped 3 minutes after it is ready; a countdown shows the time left. An open preview closes at the same moment. An EPUB you open follows the same 3 minute rule, except that its countdown stops while its reader is open and starts again when you close it. In a check on 2026-11-09 in Chromium 156, none of six ways a book can run a script (inline, packaged file, SVG, `onerror`, `javascript:` link, meta refresh) ran under the page's Content Security Policy.
- **CLI:** it writes only to `<folder>/pubmy-epub/` and to the OCR cache in `~/.cache/pubmy`. It never changes, moves, or deletes your source files, and never uploads them. The OCR language data (Indonesian and English, about 4 MB) ships inside the skill, pinned by checksum, so scanned PDFs need no download. The first PDF with formulas or line diagrams downloads a drawing library (about 15 MB, checked against a fixed checksum); no file content is sent with it. Without it (offline), formulas stay as text and the report says so.

## Install the skill

Requires [Bun](https://bun.sh) 1.4 or newer (`bun --version`). The skill folder is self-contained (about 25 MB, most of it the OCR engine in `scripts/`) and needs no `bun install`. Pick one method below; installing the same skill twice makes some harnesses list it twice.

| Harness | Skills folder |
|---|---|
| Claude Code | `~/.claude/skills` |
| Codex | `~/.agents/skills` |
| Cursor | `~/.agents/skills` |
| OpenCode | `~/.agents/skills` |
| Antigravity | `~/.gemini/config/skills` |

### One command

**Any harness, with the [skills CLI](https://github.com/vercel-labs/skills)** (needs [Node.js](https://nodejs.org) 22.20 or newer):

```bash
npx skills add belajarcarabelajar/pubmy --skill pubmy -g
```

It asks which harnesses to install for. To skip the question, name them with `-a`, for example `-a claude-code -a codex`. Measured on 2026-11-07, `-g` installs to these folders:

| `-a` value | Folder |
|---|---|
| `claude-code` | `~/.claude/skills/pubmy` |
| `codex`, `cursor`, `opencode`, `antigravity` | `~/.agents/skills/pubmy` |

Antigravity CLI (`agy`) does not read `~/.agents/skills` (checked on 2026-11-07: a skill placed there was missing from its skill list, while one in `~/.gemini/config/skills` was listed). For Antigravity, use the ZIP or the copy method below.

**Claude Code, as a plugin** (Claude Code 2.1.275 or newer), inside a session:

```text
/plugin install pubmy --marketplace belajarcarabelajar/pubmy
```

Or from a shell:

```bash
claude plugin marketplace add belajarcarabelajar/pubmy
claude plugin install pubmy@pubmy
```

As a plugin the skill is named `pubmy:pubmy`. Update it with `claude plugin update pubmy@pubmy`.

### Download the ZIP

No Git or Node.js needed. Download [pubmy-skill.zip](https://github.com/belajarcarabelajar/pubmy/releases/latest/download/pubmy-skill.zip) from the latest release and unzip it into your harness's skills folder; it holds one folder, `pubmy`. The commands below use the Claude Code folder; swap in the folder from the table above for another harness.

Linux or macOS:

```bash
curl -fsSLo /tmp/pubmy-skill.zip https://github.com/belajarcarabelajar/pubmy/releases/latest/download/pubmy-skill.zip
mkdir -p ~/.claude/skills && unzip -oq /tmp/pubmy-skill.zip -d ~/.claude/skills
```

Windows (PowerShell):

```powershell
Invoke-WebRequest https://github.com/belajarcarabelajar/pubmy/releases/latest/download/pubmy-skill.zip -OutFile "$env:TEMP\pubmy-skill.zip"
New-Item -ItemType Directory -Force "$HOME\.claude\skills" | Out-Null; Expand-Archive -Force "$env:TEMP\pubmy-skill.zip" "$HOME\.claude\skills"
```

### From a clone

Get the repository (needs [Git](https://git-scm.com)):

```bash
git clone https://github.com/belajarcarabelajar/pubmy.git
cd pubmy
```

Then copy the `skills/pubmy` folder into your harness's skills folder. Copy only the line for the harness you use.

Linux or macOS (bash), run from the repository root:

```bash
# Claude Code
mkdir -p ~/.claude/skills && cp -R skills/pubmy ~/.claude/skills/
# Codex, Cursor, OpenCode
mkdir -p ~/.agents/skills && cp -R skills/pubmy ~/.agents/skills/
# Antigravity
mkdir -p ~/.gemini/config/skills && cp -R skills/pubmy ~/.gemini/config/skills/
```

Windows (PowerShell), run from the repository root:

```powershell
# Claude Code
New-Item -ItemType Directory -Force "$HOME\.claude\skills" | Out-Null; Copy-Item -Recurse -Force skills\pubmy "$HOME\.claude\skills\"
# Codex, Cursor, OpenCode
New-Item -ItemType Directory -Force "$HOME\.agents\skills" | Out-Null; Copy-Item -Recurse -Force skills\pubmy "$HOME\.agents\skills\"
# Antigravity
New-Item -ItemType Directory -Force "$HOME\.gemini\config\skills" | Out-Null; Copy-Item -Recurse -Force skills\pubmy "$HOME\.gemini\config\skills\"
```

To update, `git pull` and copy the folder again. Then ask your agent, for example: "convert the folder ~/Books to EPUB for my Kindle" or "ubah semua file di folder ini ke EPUB".

### Per-project install

To load the skill only inside one project, copy it into that project's folder instead of your home folder. The project paths come from each vendor's documentation (read 2026-11-07). The blocks below are run by `scripts/readme-install.test.ts` on Linux, macOS and Windows (CI `install-check`).

| Harness | Project skills folder |
|---|---|
| Claude Code | `<project>/.claude/skills` |
| Codex, Cursor, OpenCode, Antigravity | `<project>/.agents/skills` |

```bash
# run from the pubmy repository root; replace /path/to/project
mkdir -p /path/to/project/.claude/skills && cp -R skills/pubmy /path/to/project/.claude/skills/
mkdir -p /path/to/project/.agents/skills && cp -R skills/pubmy /path/to/project/.agents/skills/
```

```powershell
# run from the pubmy repository root; replace C:\path\to\project
New-Item -ItemType Directory -Force "C:\path\to\project\.claude\skills" | Out-Null; Copy-Item -Recurse -Force skills\pubmy "C:\path\to\project\.claude\skills\"
New-Item -ItemType Directory -Force "C:\path\to\project\.agents\skills" | Out-Null; Copy-Item -Recurse -Force skills\pubmy "C:\path\to\project\.agents\skills\"
```

Copy only the line for the harness you use: OpenCode reads both folders and would list the skill twice. If the project is a Git repository, add the copied folder to its `.gitignore` so the 25 MB bundle is not committed.

### Verified on

Checked on 2026-11-07 (Arch Linux) by copying `skills/pubmy` into the folder named above and asking each tool whether the skill is available. A harness counts as verified only when it quoted the skill's own description.

| Harness | Skill listed |
|---|---|
| Claude Code | verified (`~/.claude/skills`) |
| OpenCode | verified (reads `~/.claude/skills`; `opencode run`) |
| Antigravity CLI (`agy`) | verified (`~/.gemini/config/skills`; `agy -p`) |
| Codex | not verified (no signed-in account on the test machine) |
| Cursor | not verified (no signed-in account on the test machine) |

OpenCode reads both `~/.claude/skills` and `~/.agents/skills`; copy the skill into only one of them to avoid a duplicate entry.

Each install method is also checked on its own:

| Method | How it is checked |
|---|---|
| Copy, per-project and uninstall blocks (bash, PowerShell) | `scripts/readme-install.test.ts` runs the blocks above in a temporary home or project folder, checks that `SKILL.md` landed in each folder, and converts a file with the home-folder copy; CI runs it on Ubuntu, macOS and Windows for every pull request (`install-check` workflow, green on 2026-11-07) |
| skills CLI | CI installs with `npx skills add` and removes with `npx skills remove` on all three systems |
| Claude Code plugin | `claude plugin validate .` and `scripts/plugin-manifest.test.ts`, which installs the plugin into a temporary Claude Code config folder (Arch Linux, 2026-11-07) |
| Release ZIP | `scripts/pack-skill.test.ts` unzips the packed file and converts a file with it; every release runs `scripts/release-check.ts` on the ZIP before publishing, and the README download block runs in `scripts/readme-install.test.ts` against a locally served copy |
| Developer setup | CI runs `bun install`, `bun run typecheck`, the CLI tests, and the release-check, workflow, packing and plugin manifest tests |

## Uninstall

Remove the skill the same way you installed it. Your converted EPUBs and source files are not touched. The OCR cache in `~/.cache/pubmy` can be deleted too.

### Installed with the skills CLI

```bash
npx skills remove pubmy -g
```

### Installed as a Claude Code plugin

```bash
claude plugin uninstall pubmy@pubmy
claude plugin marketplace remove pubmy
```

### Remove a copied skill

For the ZIP and copy methods. Each line removes the folder for one harness; a folder that does not exist is skipped.

Linux or macOS (bash):

```bash
# Claude Code
rm -rf ~/.claude/skills/pubmy
# Codex, Cursor, OpenCode
rm -rf ~/.agents/skills/pubmy
# Antigravity
rm -rf ~/.gemini/config/skills/pubmy
```

Windows (PowerShell):

```powershell
# Claude Code
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "$HOME\.claude\skills\pubmy"
# Codex, Cursor, OpenCode
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "$HOME\.agents\skills\pubmy"
# Antigravity
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "$HOME\.gemini\config\skills\pubmy"
```

For a per-project install, delete `<project>/.claude/skills/pubmy` or `<project>/.agents/skills/pubmy`.

## CLI usage

```bash
bun skills/pubmy/scripts/pubmy.js <folder> [--force] [--rtl]
```

- Every supported file under `<folder>` is converted into `<folder>/pubmy-epub/`, mirroring the subfolders: `<folder>/sub/book.pdf` becomes `<folder>/pubmy-epub/sub/book.pdf.epub`.
- A file is skipped when its EPUB already exists and is not older than the source, so a rerun only converts new or changed files. Each EPUB takes the modification time of its source, and is written to a temporary file first, so an interrupted write never leaves a broken EPUB behind.
- `--force` reconverts every file.
- `--rtl` uses right-to-left page order for comics (manga) and reconverts every file, as `--force` does.
- It prints one row per file: `converted`, `skipped`, `unsupported`, or `failed <CODE>`.
- Symlinks that resolve outside `<folder>` are skipped, and an output whose path inside `pubmy-epub/` is a symlink fails with `WRITE_FAILED`.

| Exit code | Meaning |
|---|---|
| 0 | Every file was converted, skipped, or is not a supported format |
| 1 | At least one file failed |
| 2 | Usage error: no folder given, the path is not a folder, an unknown flag, or `<folder>/pubmy-epub` exists but is not a real folder |

## Send to Kindle

pubmy does not send anything to Amazon. Move the EPUBs to your Kindle library yourself with Send to Kindle:

- **Web:** upload files of 200 MB or smaller at Send to Kindle for Web ([Amazon help](https://www.amazon.com/gp/help/customer/display.html?nodeId=G5WYD9SAF7PGXRNA)).
- **Email:** send up to 25 attachments in one email, 50 MB or less in total, to your Send to Kindle address ([Amazon help](https://www.amazon.com/gp/help/customer/display.html?nodeId=G7NECT4B4ZWHQ8WV)).

## DRM policy

pubmy converts only files you are free to convert. A MOBI or AZW3 file with DRM is refused with the code `DRM` and is never decrypted. pubmy does not include, call, or recommend any DRM removal tool, and the agent skill is told never to retry or work around a DRM refusal.

## Developer setup

For changing pubmy itself. Requires Bun 1.4.4 (the version pinned in `package.json`) and Git.

```bash
git clone https://github.com/belajarcarabelajar/pubmy.git
cd pubmy
bun install
bun run typecheck
bun test apps/cli/test/cli.test.ts
```

| Folder | What it is |
|---|---|
| `packages/core` | Format detection, the readers for each format, and the EPUB writer, shared by the CLI and the website |
| `apps/cli` | The CLI; `bun run --cwd apps/cli build` rebuilds the skill bundle in `skills/pubmy/scripts/` |
| `apps/web` | The website; `bun run --cwd apps/web build` writes `apps/web/dist`, `bun run --cwd apps/web check:assets` checks it |
| `skills/pubmy` | The agent skill; `scripts/` is generated, never edit it by hand |
| `fixtures` | Generators for test files; downloaded fixtures go to `fixtures/out/` (not committed) |

- Run one test file at a time, for example `bun test packages/core/test/docx.test.ts`; the scanned-PDF tests take minutes.
- `bun scripts/epubcheck-java.ts` cross-checks the EPUBs in `fixtures/out/epub/` with the Java EPUBCheck (needs Java).
- `bun scripts/pack-skill.ts` writes `dist/pubmy-skill.zip`, the file attached to each release. Pushing a tag `v*` builds and publishes it (`.github/workflows/release-skill.yml`).
- To release, first set `version` in `.claude-plugin/plugin.json` to the new number in a pull request, then push the tag `v<version>` on `main`. The release job runs `bun scripts/release-check.ts <tag> dist/pubmy-skill.zip` and stops when the tag does not match that version (plugin users stay on the old version until it changes) or when the packed skill cannot convert a file. If it stops after the tag is pushed, nothing is published: delete the tag (`git push origin :refs/tags/v<version>` and `git tag -d v<version>`), fix the cause in a pull request, then push the tag again.

## THIRD-PARTY-LICENSES

pubmy bundles or loads these components:

| Component | Used for | Licence |
|---|---|---|
| mammoth | DOCX reading | BSD-2-Clause |
| markdown-it | Markdown reading | MIT |
| fflate | ZIP reading and writing (EPUB, CBZ, DOCX, ODT) | MIT |
| linkedom | DOM in Bun for the MOBI/AZW3 reader | ISC |
| unpdf | PDF reading | MIT |
| pdf.js (inside unpdf) | PDF parsing | Apache-2.0 |
| tesseract.js | OCR for scanned PDFs | Apache-2.0 |
| @likecoin/epubcheck-ts | EPUB validation | BSD-3-Clause |
| libarchive.js | CBR (RAR) reading | MIT |
| libarchive (inside libarchive.js) | Archive decoding | BSD-2-Clause |
| foliate-js | MOBI/AZW3 reading; EPUB preview on the website | MIT |
| @napi-rs/canvas (Skia) | CLI only: drawing formula and diagram areas, downloaded on first use | MIT |

Each component keeps its own copyright and licence text, published with its package.

## Licence

pubmy is released under the [MIT License](LICENSE).
