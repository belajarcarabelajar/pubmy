import MarkdownIt from "markdown-it";
import { MAX_BYTES, MAX_FILES, RETENTION_MS } from "../src/limits.ts";

/** The values support pages quote from code, keyed by their {{NAME}} token. */
export function siteTokens(version: string): Record<string, string> {
  return {
    MAX_FILES: String(MAX_FILES),
    MAX_MB: String(MAX_BYTES / 1024 / 1024),
    RETENTION_MIN: String(RETENTION_MS / 60000),
    VERSION: version,
  };
}

// Ids the page layout already uses; a heading slug must not take one.
const LAYOUT_IDS = ["content", "lang", "lang-label"];

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

md.core.ruler.push("heading_ids", (state) => {
  const used = new Set<string>(LAYOUT_IDS);
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.type !== "heading_open") continue;
    const text = (tokens[i + 1]?.children ?? []).filter((c) => c.type === "text" || c.type === "code_inline").map((c) => c.content).join("");
    const base = slug(text) || "section";
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    tokens[i]!.attrSet("id", id);
  }
});

md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  if (String(tokens[idx]!.attrGet("href") ?? "").startsWith("https://")) tokens[idx]!.attrSet("rel", "noopener");
  return self.renderToken(tokens, idx, options);
};
md.renderer.rules.table_open = (tokens, idx, options, _env, self) => '<div class="table-wrap">' + self.renderToken(tokens, idx, options);
md.renderer.rules.table_close = (tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options) + "</div>";

/** Markdown content of a support page to HTML, with every {{NAME}} token replaced first. */
export function renderContent(src: string, tokens: Record<string, string>): string {
  const filled = src.replace(/\{\{([^}]*)\}\}/g, (_, raw: string) => {
    const name = raw.trim();
    if (!Object.hasOwn(tokens, name)) throw new Error(`renderContent: unknown token {{${name}}}`);
    return tokens[name]!;
  });
  return md.render(filled);
}
