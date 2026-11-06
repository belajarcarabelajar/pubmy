# Glossary

- **Book model:** the format-neutral book every adapter produces and the packager consumes.
- **Adapter:** the reader for one format family that turns an input file into a Book model.
- **Packager:** the single module that writes EPUB 3 from a Book model and applies the Kindle fixes.
- **Kindle fixes:** output rules that avoid Send to Kindle rejection (e999): NCX alongside nav, and XHTML cleaned of control characters, `--` inside comments, and unclosed void tags.
- **Scanned page:** a PDF page with no text layer and full image coverage, routed to OCR.
- **Retention window:** the 3 minutes a converted EPUB stays downloadable in the browser tab before it is revoked.
