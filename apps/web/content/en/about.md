pubmy turns your documents, ebooks, and comics into EPUB files that Kindle accepts. Every EPUB is EPUB 3 with a table of contents, and is checked with an EPUB validator before it is written.

## Two ways to use pubmy

### Website

On the [converter page](/), drop up to {{MAX_FILES}} files ({{MAX_MB}} MB each) or press Choose files. Check the result with Preview, then press Download EPUB for one file or Download all (ZIP) for every ready file. A file that is already an EPUB is not converted: it opens in the reader with Read, so you can read it right away. Everything runs in your browser (see [Privacy](/en/privacy/)).

### Agent skill and CLI

Give your coding agent (Claude Code, Codex, Cursor, OpenCode, Antigravity) a folder, and it converts every supported file in it, keeping the folder layout. How to install it is on the [Skill and CLI](/en/cli/) page.

## Open source

pubmy is released under the MIT License. The source is on GitHub: [github.com/belajarcarabelajar/pubmy](https://github.com/belajarcarabelajar/pubmy).

## Third-party software

The EPUB preview on the website uses foliate-js (MIT). Its licence text ships with the site: [/licenses/foliate-js.txt](/licenses/foliate-js.txt). foliate-js also reads MOBI and AZW3 files.

Other major components pubmy uses:

- unpdf: PDF reading, with pdf.js inside (MIT; pdf.js Apache-2.0)
- tesseract.js: OCR for scanned PDFs (Apache-2.0)
- mammoth: DOCX reading (BSD-2-Clause)
- markdown-it: Markdown reading (MIT)
- libarchive.js: CBR comic reading (MIT)
- fflate: ZIP reading and writing, for example EPUB, CBZ, DOCX, and ODT (MIT)
- @likecoin/epubcheck-ts: EPUB validation (BSD-3-Clause)

Each component keeps its own copyright and licence text, published with its package.

## Feedback

Found a problem or have a suggestion? [Report it on GitHub Issues](https://github.com/belajarcarabelajar/pubmy/issues).

## Version

Current website version: {{VERSION}}. What changed in each version is on the [Releases](/en/releases/) page and on [GitHub Releases](https://github.com/belajarcarabelajar/pubmy/releases).
