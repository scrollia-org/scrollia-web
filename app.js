/* Scrollia · site theme and reader preview.
   The head script sets the initial theme before paint to avoid a flash.
   Preference: auto | light | dark | amoled (default auto). data-theme is the
   resolved surface; data-theme-pref is what the user chose. The nav button
   opens a menu (same four options as the Android dialog), not a blind cycle. */

const root = document.documentElement;
const themePicker = document.querySelector(".theme-picker");
const themeButton = themePicker?.querySelector(".nav__theme");
const themeMenu = themePicker?.querySelector(".theme-menu");
const themeOptions = themeMenu ? [...themeMenu.querySelectorAll("[data-theme-option]")] : [];
const systemDark = matchMedia("(prefers-color-scheme: dark)");

const THEME_PREFS = ["auto", "light", "dark", "amoled"];
const THEME_ARIA = {
  auto: "nav.themeAuto",
  light: "nav.themeLight",
  dark: "nav.themeDark",
  amoled: "nav.themeAmoled",
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

function setThemeMenuOpen(open) {
  if (!themeButton || !themeMenu) return;
  themeMenu.hidden = !open;
  themeButton.setAttribute("aria-expanded", String(open));
}

function applyThemePreference(pref) {
  root.dataset.themePref = pref;
  root.dataset.theme = resolveTheme(pref);
  themeOptions.forEach((option) => {
    const selected = option.dataset.themeOption === pref;
    option.setAttribute("aria-selected", String(selected));
  });
  if (themeButton) {
    themeButton.dataset.i18nAria = THEME_ARIA[pref];
    window.scrolliaI18n?.refresh();
  }
}

function chooseTheme(pref) {
  try { localStorage.setItem("scrollia-theme", pref); } catch (_) {}
  applyThemePreference(pref);
  setThemeMenuOpen(false);
  themeButton?.focus();
}

if (themeButton && themeMenu) {
  themeButton.addEventListener("click", () => {
    setThemeMenuOpen(themeMenu.hidden);
  });

  themeOptions.forEach((option) => {
    option.addEventListener("click", () => chooseTheme(option.dataset.themeOption));
  });

  document.addEventListener("click", (event) => {
    if (!themeMenu.hidden && !themePicker.contains(event.target)) {
      setThemeMenuOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !themeMenu.hidden) {
      setThemeMenuOpen(false);
      themeButton.focus();
    }
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
