// Pure conversion step: no fs, no wasm loading. The pandoc `convert` function is
// injected so the same module runs in the browser (fetch-loaded wasm) and in Bun.

export type PandocFiles = Record<string, string | Blob>;

export type PandocConvert = (
  options: Record<string, unknown>,
  stdin: string | null,
  files: PandocFiles,
) => Promise<{ stdout: string; stderr: string; warnings: unknown[]; files: PandocFiles }>;

export interface HtmlToEpubInput {
  html: string;
  title: string;
  lang: string;
  // Resources the HTML references by relative path, e.g. { "img.png": Blob }.
  resources: Record<string, Blob>;
}

export interface HtmlToEpubResult {
  epub: Uint8Array;
  stderr: string;
  warnings: unknown[];
}

const OUTPUT = "out.epub";

export async function htmlToEpub(
  convert: PandocConvert,
  input: HtmlToEpubInput,
): Promise<HtmlToEpubResult> {
  const result = await convert(
    {
      from: "html",
      to: "epub3",
      standalone: true,
      "output-file": OUTPUT,
      "input-files": ["input.html"],
      metadata: { title: input.title, lang: input.lang },
    },
    null,
    { "input.html": input.html, ...input.resources },
  );
  const out = result.files[OUTPUT];
  if (!(out instanceof Blob)) {
    throw new Error(`pandoc produced no ${OUTPUT}; stderr: ${result.stderr}`);
  }
  return {
    epub: new Uint8Array(await out.arrayBuffer()),
    stderr: result.stderr,
    warnings: result.warnings,
  };
}
