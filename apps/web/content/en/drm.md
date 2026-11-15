pubmy converts only files you are free to convert. A MOBI or AZW3 ebook with DRM is refused and is never decrypted. The same goes for an EPUB with DRM: pubmy does not open it. pubmy does not include, call, or recommend any DRM removal tool.

## What happens to a file with DRM

On the website, the file does not become a result. Its row shows a message:

- For a MOBI or AZW3: "This file is DRM-protected, so it cannot be converted."
- For an EPUB you open to read: "This EPUB is DRM-protected, so it cannot be opened."

In the [CLI](/en/cli/), the file is listed in the report with the code `DRM` and no EPUB is written. The agent skill is told never to retry or work around a DRM refusal.

## Why

DRM is a lock that limits who may open a file. pubmy works only with files you are free to convert, so a locked file is left as it is: pubmy does not unlock it and does not help you unlock it.

## What you can do instead

- Use a copy without DRM. Many bookstores sell DRM-free EPUBs, and many public-domain libraries offer them.
- If you already have a DRM-free EPUB, it does not need converting. You can open it in pubmy to read it, or send it straight to your Kindle.
- See [Formats](/en/formats/) for the files pubmy can convert, and the [FAQ in the Guide](/en/guide/#faq) for other questions.
