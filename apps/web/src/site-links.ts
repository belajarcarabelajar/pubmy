import type { Lang } from "./i18n.ts";

/** Points every site header and footer link at its page in the chosen language. */
export function applySiteLinks(root: ParentNode, lang: Lang): void {
  for (const a of root.querySelectorAll<HTMLElement>("[data-href-id]")) {
    const href = a.getAttribute(`data-href-${lang}`);
    if (href) a.setAttribute("href", href);
  }
}
