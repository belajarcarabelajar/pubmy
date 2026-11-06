---
name: pubmy
description: Convert a folder or files (PDF, scanned PDF, DOCX, ODT, RTF, HTML, Markdown, TXT, MOBI, AZW3, CBZ, CBR) to EPUB for Kindle, offline. Use for "convert to EPUB", "make this Kindle-ready", "ubah ke EPUB", "konversi ke EPUB", "jadikan EPUB untuk Kindle".
---

# pubmy: folder to EPUB for Kindle

pubmy converts every supported file under a folder into an EPUB that Send to Kindle accepts. It runs locally with Bun. Nothing is uploaded.

## 1. Check Bun

Run `bun --version`. pubmy needs Bun 1.4 or newer.

If the command is missing or the version is older, stop and tell the user how to install Bun, then do nothing else:

- Linux or macOS: `curl -fsSL https://bun.sh/install | bash`
- Windows (PowerShell): `powershell -c "irm bun.sh/install.ps1 | iex"`
- Upgrade an existing install: `bun upgrade`

## 2. Run

```bash
bun <skill-dir>/scripts/pubmy.js <folder> [--force] [--rtl]
```

- `<skill-dir>` is the folder that holds this `SKILL.md`.
- `<folder>` is the folder the user named. Pass a folder, not a single file; for one file, pass the folder that contains it.
- `--force` reconverts files whose EPUB is already newer than the source. Use it only when the user asks.
- `--rtl` sets right-to-left page order for comics (manga). Use it only when the user asks.

Output goes to `<folder>/pubmy-epub/` with the same subfolders, for example `<folder>/sub/book.pdf` becomes `<folder>/pubmy-epub/sub/book.pdf.epub`. A rerun skips files already converted. Scanned PDFs are read with OCR (Indonesian and English); the OCR data is cached in `~/.cache/pubmy`.

## 3. Report

pubmy prints one row per file with a status: `converted`, `skipped`, `unsupported`, or `failed <CODE>`. Summarise it for the user as a short table: counts per status, then every failed file with its code, then where the EPUBs are.

| Exit code | Meaning | What to tell the user |
|---|---|---|
| 0 | Every file converted, skipped, or was not a supported format | Done; point to `<folder>/pubmy-epub/` |
| 1 | At least one file failed | List the failed files and their codes; the rest were converted |
| 2 | Usage error (no folder, not a folder, unknown flag) | Fix the command and run it once more |

## Rules

- A file reported `failed DRM` is protected by DRM. Tell the user pubmy does not convert DRM-protected books. Never retry it, never look for a DRM removal tool, never try another converter on it, and never suggest a workaround.
- Never upload, email, or send any input or output file anywhere. To get the EPUBs onto a Kindle, point the user to Send to Kindle (web upload up to 200 MB per file, or email up to 50 MB and 25 files) and let them do it.
- Do not edit, move, or delete the user's source files. pubmy only writes inside `<folder>/pubmy-epub/` and `~/.cache/pubmy`.
- Do not retry a failed run with different flags unless the user asks.
