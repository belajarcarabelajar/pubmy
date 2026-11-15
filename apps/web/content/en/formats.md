Every file you convert with pubmy becomes an EPUB 3 with a table of contents. Before you get it, the EPUB is checked with an EPUB validator. An EPUB that fails the check is withheld. This page lists the files you can put in and what you get back.

## Supported formats

| Input | Extensions | What you get |
|---|---|---|
| PDF with text | `.pdf` | Columns and headings are detected from the text layout. Running headers, footers and page numbers are removed. When the PDF has no outline, an unnumbered heading set smaller than the numbered ones stays inside its chapter and is listed under it in the table of contents. Figures are kept as images, and a table printed sideways is rebuilt as a table. Formulas and line diagrams are kept as pictures of their area of the page, so they look exactly as printed. |
| Scanned PDF | `.pdf` | The text is read with OCR in Indonesian and English. |
| Word processor and text documents | `.docx`, `.odt`, `.rtf`, `.html`, `.htm`, `.md`, `.txt` | Headings in the document become chapters. |
| Kindle ebooks without DRM | `.mobi`, `.azw3` | Converted to EPUB. Files with DRM are refused, see the [DRM policy](/en/drm/). |
| Comics | `.cbz`, `.cbr` | Fixed layout, one image per page. Right-to-left page order for manga is available in the [CLI](/en/cli/) with the `--rtl` option. |

## EPUB files

A `.epub` file you drop is not converted. It opens in the reader so you can read it right away.

- Its row shows "Ready to read" and has a **Read** button, but no **Download EPUB** button.
- Like a converted file, an EPUB you open is cleared from memory after {{RETENTION_MIN}} minutes. The countdown stops while its reader is open. The [Privacy](/en/privacy/) page explains the details.
- An EPUB with DRM cannot be opened, see the [DRM policy](/en/drm/).

## Limits

These limits apply on the website:

- The queue holds up to {{MAX_FILES}} files, and each file can be up to {{MAX_MB}} MB. A file over these limits is refused and does not enter the queue.
- A password-protected PDF or Office document cannot be converted.
- A comic archive that contains no images cannot be converted, and neither can an archive that is too large once unpacked.
- Empty files and files in an unsupported format cannot be converted.
- Reading a PDF needs a browser that is not too old. If you see a message about that, try a current Chrome, Firefox, or Safari.

The [Guide](/en/guide/) walks through the converter step by step.
