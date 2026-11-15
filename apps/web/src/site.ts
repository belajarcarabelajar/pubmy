// The only script on support pages. Following the language switch remembers the choice under the key the converter
// page reads, so the converter opens in the same language. Blocked storage must never stop the navigation.
const link = document.querySelector<HTMLAnchorElement>("a#lang[hreflang]");
link?.addEventListener("click", () => {
  const lang = link.getAttribute("hreflang");
  if (lang !== "id" && lang !== "en") return;
  try {
    localStorage.setItem("pubmy.lang", lang);
  } catch {
    // The link still navigates; the converter then falls back to the browser language.
  }
});

export {};
