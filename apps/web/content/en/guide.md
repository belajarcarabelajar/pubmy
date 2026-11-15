pubmy turns documents, e-books and comics into EPUB 3 that passes Send to Kindle. Everything runs in your browser, so no file is uploaded. Every EPUB has a table of contents and is checked with an EPUB validator before you get it. A file that is already an EPUB is not converted: you can read it right in the page.

## How to convert

1. **Choose files.** Click Choose files, or drop files on the [Convert](/) page. Up to {{MAX_FILES}} files, {{MAX_MB}} MB each. The supported formats are listed on the [Formats](/en/formats/) page.
2. **Wait for the conversion.** Each file shows up as a row in the queue. While it converts, the row shows a progress bar. Once the status says Ready, click Preview to look inside the EPUB in the page before you download it.
3. **Download.** Click Download EPUB on that file's row. When several files are ready, Download all (ZIP) downloads every ready file at once in one ZIP.

## Send to Kindle

pubmy does not send anything to Amazon. Send the EPUB yourself with Amazon's Send to Kindle: by email to your Send to Kindle address, with Send to Kindle for Web, or with the app. EPUBs from pubmy are made to pass the Send to Kindle check.

## Time limit

Results are kept only in the browser tab's memory. {{RETENTION_MIN}} minutes after an EPUB is ready, it is wiped from memory and its row changes to Deleted. An open preview closes at the same moment.

The time left shows on the file's row, as "Cleared from memory in" followed by a countdown. Need more time? Open the three-dot button (More actions) on that row and choose Extend: the countdown starts again from {{RETENTION_MIN}} minutes.

## Reading an EPUB

When you add an .epub file, it is not converted. pubmy opens it in the reader on this page. Its row says Ready to read and has a Read button, with no download button. The first EPUB of each drop opens by itself when no reader is open yet. A DRM-protected EPUB cannot be opened.

The {{RETENTION_MIN}} minute limit also applies to an EPUB you open, but its countdown stops while its reader is open. When you close the reader, the countdown starts again from the beginning.

## FAQ

### Is pubmy free?

Yes. The website is free to use, and its code is open source under the MIT License on [GitHub](https://github.com/belajarcarabelajar/pubmy). More on the [About](/en/about/) page.

### Are my files uploaded?

No. Conversion runs in your own browser, and your files are not sent to any server. The details are on the [Privacy](/en/privacy/) page.

### Why did my file fail or get refused?

The reason is written on the file's row. Possible reasons:

- The file is DRM-protected.
- The PDF or Office document is password-protected.
- The file is over {{MAX_MB}} MB, or the queue is already full ({{MAX_FILES}} files).
- The file format is not supported. Check the [Formats](/en/formats/) page.
- The file is empty or could not be read.
- The browser is too old to read PDFs. Try a current Chrome, Firefox, or Safari.
- The converted EPUB did not pass the validator, so it was withheld.

If you think the file should work, [report the problem on GitHub](https://github.com/belajarcarabelajar/pubmy/issues).

### Can scanned PDFs be converted?

Yes. Scanned PDFs are read with OCR in Indonesian and English.

### What about files with DRM?

A MOBI or AZW3 file with DRM is refused and never decrypted. Read why on the [DRM](/en/drm/) page.

### Can I use it on a phone?

Yes. Tap Choose files to pick your files. Drag and drop is for computers only. On a phone or tablet the limits are the same: up to {{MAX_FILES}} files, {{MAX_MB}} MB each.
