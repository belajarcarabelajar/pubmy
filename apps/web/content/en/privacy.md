Your files never leave your browser. This page explains what happens to your files on the pubmy website, and in its agent skill and CLI.

## On the website

Conversion runs inside your own browser. Your files are not uploaded to any server.

- Each EPUB stays in the browser tab's memory and is wiped {{RETENTION_MIN}} minutes after it is ready. A countdown shows the time left, so press Download EPUB before it runs out.
- An open preview closes at the same moment.
- An EPUB you open to read follows the same {{RETENTION_MIN}} minute rule. The difference: its countdown stops while its reader is open and starts again when you close it.

How to use the converter is in the [Guide](/en/guide/).

## What your browser stores

pubmy's own code stores one thing in your browser: your language choice, in localStorage under the key `pubmy.lang`. pubmy's own code sets no cookies.

The OCR library (tesseract.js) that reads scanned PDFs is set not to save its Indonesian and English language data in your browser's storage, so it loads that data from pubmy again each time OCR starts. Like any website, your browser may still keep the site's own files, such as scripts and that language data, in its normal download cache. Your files and their text are never stored.

## Scripts inside books

The preview and the reader show a book's content on the converter page, and a book can carry scripts. In a check on 2026-11-09 in Chromium 156, none of six ways a book can run a script ran under the converter page's Content Security Policy. The six ways: inline script, a script file packaged in the book, SVG, `onerror`, a `javascript:` link, and meta refresh.

## The agent skill and CLI

The skill and the CLI run on your own computer.

- They write only to `<folder>/pubmy-epub/` and to the OCR cache in `~/.cache/pubmy`.
- They never change, move, delete, or upload your source files.
- The OCR language data (Indonesian and English, about 4 MB) ships inside the skill, pinned by checksum, so scanned PDFs need no download.
- The first PDF with formulas or line diagrams downloads a drawing library (about 15 MB, checked against a fixed checksum). No file content is sent with it. Without it, for example when offline, formulas stay as text and the report says so.

How to install and use the skill is on the [Skill and CLI](/en/cli/) page.
