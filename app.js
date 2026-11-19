/* Scrollia · site theme and reader preview.
   The head script sets the initial theme before paint to avoid a flash.
   Preference: auto | light | dark | amoled (default auto). data-theme is the
   resolved surface; data-theme-pref is what the user chose. */

const root = document.documentElement;
const themeButton = document.querySelector(".nav__theme");
const systemDark = matchMedia("(prefers-color-scheme: dark)");

const THEME_PREFS = ["auto", "light", "dark", "amoled"];
const THEME_NEXT_ARIA = {
  auto: "nav.themeToLight",
  light: "nav.themeToDark",
  dark: "nav.themeToAmoled",
  amoled: "nav.themeToAuto",
};

function savedTheme() {
  try { return localStorage.getItem("scrollia-theme"); } catch (_) { return null; }
}

function themePreference() {
  const saved = savedTheme();
  return THEME_PREFS.includes(saved) ? saved : "auto";
}

function resolveTheme(pref) {
  if (pref === "auto") return systemDark.matches ? "dark" : "light";
  return pref;
}

function applyThemePreference(pref) {
  root.dataset.themePref = pref;
  root.dataset.theme = resolveTheme(pref);
  if (themeButton) {
    themeButton.dataset.i18nAria = THEME_NEXT_ARIA[pref];
    window.scrolliaI18n?.refresh();
  }
}

if (themeButton) {
  themeButton.addEventListener("click", () => {
    const current = themePreference();
    const next = THEME_PREFS[(THEME_PREFS.indexOf(current) + 1) % THEME_PREFS.length];
    try { localStorage.setItem("scrollia-theme", next); } catch (_) {}
    applyThemePreference(next);
  });
}

systemDark.addEventListener("change", () => {
  if (themePreference() === "auto") applyThemePreference("auto");
});

applyThemePreference(themePreference());

/* Reading themes: the preview itself is the control. */
const readerDemo = document.querySelector(".reader-demo");
const options = readerDemo?.querySelectorAll("[data-reader-option]") ?? [];

options.forEach((option) => {
  option.addEventListener("click", () => {
    readerDemo.dataset.readerTheme = option.dataset.readerOption;
    options.forEach((o) => o.setAttribute("aria-checked", String(o === option)));
  });
});
