# pubmy

pubmy turns your documents, ebooks, and comics into EPUB files that Kindle accepts. It comes in two forms:

- **Website** at [pubmy.belajarcarabelajar.com](https://pubmy.belajarcarabelajar.com): drop up to 10 files (50 MB each), preview each EPUB in the page, and download one EPUB per file.
- **Agent skill and CLI**: give your coding agent (Claude Code, Codex, Cursor, OpenCode, Antigravity) a folder, and it converts every supported file in it, keeping the folder layout.

Every EPUB is EPUB 3 with a table of contents, and is checked with an EPUB validator before it is written.

## Supported formats

| Input | Extensions | Notes |
|---|---|---|
| PDF with text | `.pdf` | Columns and headings are detected from the text layout. Running headers, footers and page numbers are removed. Figures are kept as images, and a table printed sideways is rebuilt as a table |
| Scanned PDF | `.pdf` | Read with OCR in Indonesian and English (`ind+eng`) |
| Word processor and text documents | `.docx`, `.odt`, `.rtf`, `.html`, `.htm`, `.md`, `.txt` | Headings become chapters |
| Kindle ebooks without DRM | `.mobi`, `.azw3` | Files with DRM are refused (see DRM policy) |
| Comics | `.cbz`, `.cbr` | Fixed layout, one image per page; right-to-left page order for manga |

## Privacy

- **Website:** conversion runs inside your own browser. Your files are not uploaded to any server. Each EPUB stays in the browser tab's memory and is wiped 3 minutes after it is ready; a countdown shows the time left. An open preview closes at the same moment.
- **CLI:** it writes only to `<folder>/pubmy-epub/` and to the OCR cache in `~/.cache/pubmy`. It never changes, moves, or deletes your source files, and never uploads them. The first scanned PDF downloads the OCR language data (about 7 MB) into that cache; no file content is sent with it.

## Install the skill

Requires [Bun](https://bun.sh) 1.4 or newer (`bun --version`).

First get the repository (needs [Git](https://git-scm.com); without Git, use **Code > Download ZIP** on GitHub and unzip it):

```bash
git clone https://github.com/belajarcarabelajar/pubmy.git
cd pubmy
```

Then copy the `skills/pubmy` folder into your harness's skills folder. The folder is self-contained (about 25 MB, most of it the OCR engine in `scripts/`) and needs no `bun install`.

| Harness | Skills folder |
|---|---|
| Claude Code | `~/.claude/skills` |
| Codex | `~/.agents/skills` |
| Cursor | `~/.agents/skills` |
| OpenCode | `~/.agents/skills` |
| Antigravity | `~/.gemini/config/skills` |

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

### Per-project install

To load the skill only inside one project, copy it into that project's folder instead of your home folder. The project paths come from each vendor's documentation (read 2026-11-07); only the home-folder install above was tested.

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

To update, copy the folder again. Then ask your agent, for example: "convert the folder ~/Books to EPUB for my Kindle" or "ubah semua file di folder ini ke EPUB".

### Verified on

Checked on 2026-11-07 (Arch Linux) by copying `skills/pubmy` into the folder named above and asking each tool whether the skill is available. A harness counts as verified only when it quoted the skill's own description.

| Harness | Skill listed |
|---|---|
| Claude Code | verified (`~/.claude/skills`) |
| OpenCode | verified (reads `~/.claude/skills`; `opencode run`) |
| Antigravity CLI (`agy`) | verified (`~/.gemini/config/skills`; `agy -p`) |
| Codex | not verified (not installed on the test machine) |
| Cursor | not verified (not installed on the test machine) |

OpenCode reads both `~/.claude/skills` and `~/.agents/skills`; copy the skill into only one of them to avoid a duplicate entry.

## CLI usage

```bash
bun skills/pubmy/scripts/pubmy.js <folder> [--force] [--rtl]
```

- Every supported file under `<folder>` is converted into `<folder>/pubmy-epub/`, mirroring the subfolders: `<folder>/sub/book.pdf` becomes `<folder>/pubmy-epub/sub/book.pdf.epub`.
- A file is skipped when its EPUB already exists and is newer than the source, so a rerun only converts new or changed files.
- `--force` reconverts every file.
- `--rtl` uses right-to-left page order for comics (manga).
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

Each component keeps its own copyright and licence text, published with its package.

## Licence

pubmy is released under the [MIT License](LICENSE).
