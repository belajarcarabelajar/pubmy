# pubmy

pubmy turns your documents, ebooks, and comics into EPUB files that Kindle accepts. It comes in two forms:

- **Website** at [pubmy.belajarcarabelajar.com](https://pubmy.belajarcarabelajar.com): drop up to 10 files (50 MB each) and download one EPUB per file.
- **Agent skill and CLI**: give your coding agent (Claude Code, Codex, Cursor, OpenCode, Antigravity) a folder, and it converts every supported file in it, keeping the folder layout.

Every EPUB is EPUB 3 with a table of contents, and is checked with an EPUB validator before it is written.

## Supported formats

| Input | Extensions | Notes |
|---|---|---|
| PDF with text | `.pdf` | Columns and headings are detected from the text layout |
| Scanned PDF | `.pdf` | Read with OCR in Indonesian and English (`ind+eng`) |
| Word processor and text documents | `.docx`, `.odt`, `.rtf`, `.html`, `.htm`, `.md`, `.txt` | Headings become chapters |
| Kindle ebooks without DRM | `.mobi`, `.azw3` | Files with DRM are refused (see DRM policy) |
| Comics | `.cbz`, `.cbr` | Fixed layout, one image per page; right-to-left page order for manga |

## Privacy

- **Website:** conversion runs inside your own browser. Your files are not uploaded to any server. Each EPUB stays in the browser tab's memory and is wiped 3 minutes after it is ready; a countdown shows the time left.
- **CLI:** it writes only to `<folder>/pubmy-epub/` and to the OCR cache in `~/.cache/pubmy`. It never changes, moves, or deletes your source files, and never uploads them. The first scanned PDF downloads the OCR language data (about 7 MB) into that cache; no file content is sent with it.

## Install the skill

Requires [Bun](https://bun.sh) 1.4 or newer (`bun --version`).

Copy the `skills/pubmy` folder of this repository into your harness's skills folder. The folder is self-contained (about 25 MB, most of it the OCR engine in `scripts/`) and needs no `bun install`.

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

To update, copy the folder again. Then ask your agent, for example: "convert the folder ~/Books to EPUB for my Kindle" or "ubah semua file di folder ini ke EPUB".

### Verified on

| Harness | Skill listed and run |
|---|---|
| Claude Code | not verified |
| Codex | not verified |
| Cursor | not verified |
| OpenCode | not verified |
| Antigravity | not verified |

## CLI usage

```bash
bun skills/pubmy/scripts/pubmy.js <folder> [--force] [--rtl]
```

- Every supported file under `<folder>` is converted into `<folder>/pubmy-epub/`, mirroring the subfolders: `<folder>/sub/book.pdf` becomes `<folder>/pubmy-epub/sub/book.pdf.epub`.
- A file is skipped when its EPUB already exists and is newer than the source, so a rerun only converts new or changed files.
- `--force` reconverts every file.
- `--rtl` uses right-to-left page order for comics (manga).
- It prints one row per file: `converted`, `skipped`, `unsupported`, or `failed <CODE>`.

| Exit code | Meaning |
|---|---|
| 0 | Every file was converted, skipped, or is not a supported format |
| 1 | At least one file failed |
| 2 | Usage error: no folder given, the path is not a folder, or an unknown flag |

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
| foliate-js | MOBI/AZW3 reading | MIT |

Each component keeps its own copyright and licence text, published with its package.

## Licence

pubmy is released under the [MIT License](LICENSE).
