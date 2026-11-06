import { pages } from "./pages";

const dir = import.meta.dir;
pages.forEach(async (text, i) => {
  const n = i + 1;
  const body = text
    .split("\n\n")
    .map((p) => (p.endsWith(".") ? `<p>${p}</p>` : n && p.startsWith("Bab") ? `<h1>${p}</h1>` : `<h2>${p}</h2>`))
    .join("\n");
  // A5 is 559x794 CSS px at 96 dpi; the screenshot scale factor 2.0833 lifts it to 200 dpi.
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#fff;color:#111}
body{width:559px;height:794px;box-sizing:border-box;padding:40px 44px;font-family:"DejaVu Serif",serif;font-size:13.5px;line-height:1.45}
h1{font-size:20px;margin:0 0 12px}h2{font-size:15.5px;margin:12px 0 6px}p{margin:0 0 7px;text-align:justify}
</style></head><body>${body}</body></html>`;
  await Bun.write(`${dir}/page${n}.html`, html);
  await Bun.write(`${dir}/page${n}.txt`, text + "\n");
  console.log(`page${n}: ${text.split(/\s+/).length} words`);
});
