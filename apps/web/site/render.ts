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

type Tokens = ReturnType<typeof md.parse>;

/** The plain text of the inline token after an opening token: text and code, without the Markdown marks. */
function plainText(tokens: Tokens, i: number): string {
  return (tokens[i + 1]?.children ?? []).filter((c) => c.type === "text" || c.type === "code_inline").map((c) => c.content).join("");
}

md.core.ruler.push("heading_ids", (state) => {
  const used = new Set<string>(LAYOUT_IDS);
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.type !== "heading_open") continue;
    const base = slug(plainText(tokens, i)) || "section";
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    tokens[i]!.attrSet("id", id);
  }
});

// A phone shows a table with a header row as one block per row, each cell under its column name (SITE_CSS).
// That CSS sets display:block on table, tbody, tr and td, which can drop the table semantics for a screen
// reader, so every element of a stacked table also gets its ARIA role.
const STACK_ROLES: Record<string, string> = {
  thead_open: "rowgroup",
  tbody_open: "rowgroup",
  tr_open: "row",
  th_open: "columnheader",
  td_open: "cell",
};
md.core.ruler.push("table_labels", (state) => {
  const tokens = state.tokens;
  let table: Tokens[number] | undefined;
  let heads: string[] = [];
  let inHead = false;
  let stacked = false;
  let col = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.type === "table_open") [table, heads, stacked] = [tok, [], false];
    else if (tok.type === "table_close") stacked = false;
    else if (tok.type === "thead_open") {
      inHead = true;
      stacked = true;
      table?.attrJoin("class", "stack");
      table?.attrSet("role", "table");
    } else if (tok.type === "thead_close") inHead = false;
    else if (tok.type === "tr_open") col = 0;
    else if (tok.type === "th_open" && inHead) heads.push(plainText(tokens, i));
    else if (tok.type === "td_open" && heads.length) tok.attrSet("data-label", heads[col++] ?? "");
    const role = stacked ? STACK_ROLES[tok.type] : undefined;
    if (role) tok.attrSet("role", role);
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
