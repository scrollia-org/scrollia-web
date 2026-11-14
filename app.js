/* Scrollia · site theme and reader preview.
   The head script sets the initial theme before paint to avoid a flash. */

const root = document.documentElement;
const themeButton = document.querySelector(".nav__theme");
const systemDark = matchMedia("(prefers-color-scheme: dark)");

function savedTheme() {
  try { return localStorage.getItem("scrollia-theme"); } catch (_) { return null; }
}

function applyTheme(theme) {
  root.dataset.theme = theme;
  const dark = theme === "dark" || theme === "amoled";
  themeButton.dataset.i18nAria = dark ? "nav.themeToLight" : "nav.themeToDark";
  window.scrolliaI18n?.refresh();
}

themeButton.addEventListener("click", () => {
  const next = root.dataset.theme === "light" ? "dark" : "light";
  try { localStorage.setItem("scrollia-theme", next); } catch (_) {}
  applyTheme(next);
});

systemDark.addEventListener("change", (event) => {
  if (!savedTheme()) applyTheme(event.matches ? "dark" : "light");
});

applyTheme(root.dataset.theme);

/* Reading themes: the preview itself is the control. */
const readerDemo = document.querySelector(".reader-demo");
const options = readerDemo?.querySelectorAll("[data-reader-option]") ?? [];

options.forEach((option) => {
  option.addEventListener("click", () => {
    readerDemo.dataset.readerTheme = option.dataset.readerOption;
    options.forEach((o) => o.setAttribute("aria-checked", String(o === option)));
  });
});
