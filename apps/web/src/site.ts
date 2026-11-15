// The only script on support pages. The converter page reads the language from the key pubmy.lang, so this script
// stores it when a visitor leaves a support page for the converter: the language switch stores the language it
// switches to, and any link to the converter ("/") stores the page's own language. Blocked storage must never stop
// the navigation.
const remember = (lang: string | null) => {
  if (lang !== "id" && lang !== "en") return;
  try {
    localStorage.setItem("pubmy.lang", lang);
  } catch {
    // The link still navigates; the converter then falls back to the browser language.
  }
};

document.addEventListener("click", (e) => {
  const link = (e.target as Element | null)?.closest?.("a");
  if (!link) return;
  if (link.id === "lang" && link.hasAttribute("hreflang")) remember(link.getAttribute("hreflang"));
  else if (link.getAttribute("href") === "/") remember(document.documentElement.lang);
});

export {};
