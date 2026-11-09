# Glossary

- **Book model:** the format-neutral book every adapter produces and the packager consumes.
- **Adapter:** the reader for one format family that turns an input file into a Book model.
- **Packager:** the single module that writes EPUB 3 from a Book model and applies the Kindle fixes.
- **Kindle fixes:** output rules that avoid Send to Kindle rejection (e999): NCX alongside nav, and XHTML cleaned of control characters, `--` inside comments, and unclosed void tags.
- **Scanned page:** a PDF page with no text layer and full image coverage, routed to OCR.
- **Retention window:** the 3 minutes a converted or opened EPUB stays in the browser tab's memory (a converted one also stays downloadable) before it is wiped.
- **Opened EPUB:** an EPUB the visitor dropped on the website with the `.epub` extension. It is read in the page and is not converted; its row has no Download link.
- **Reading hold:** the retention window of an opened EPUB stops while its reader is open and starts again, in full, when the reader closes.
