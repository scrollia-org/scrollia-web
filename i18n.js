/* Scrollia · i18n — strings externalized in lang/*.json.
   Default to the first supported browser language, falling back to Spanish. */

const SUPPORTED = ["es", "en", "fr", "de", "pt", "it", "zh"];
const DEFAULT = "es";
const HTML_LANG = { zh: "zh-Hans" };

const select = document.querySelector(".nav__lang");

let current = {};
let currentLang = DEFAULT;

async function loadStrings(lang) {
  const base = document.documentElement.dataset.i18nBase || "lang";
  const res = await fetch(`${base}/${lang}.json`);
  if (!res.ok) throw new Error(`i18n: no se pudo cargar ${base}/${lang}.json`);
  return res.json();
}

function t(key) {
  const value = key.split(".").reduce((o, k) => o?.[k], current);
  return typeof value === "string" ? value : null;
}

function applyStrings() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const value = t(el.dataset.i18n);
    if (value !== null) el.innerHTML = value;
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const value = t(el.dataset.i18nAria);
    if (value !== null) el.setAttribute("aria-label", value);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const value = t(el.dataset.i18nPlaceholder);
    if (value !== null) el.placeholder = value;
  });
  /* Pages with their own title (such as a work page) omit these keys and manage it themselves. */
  const { i18nTitle, i18nDescription } = document.documentElement.dataset;
  const title = i18nTitle && t(i18nTitle);
  if (title) document.title = title;
  const description = i18nDescription && t(i18nDescription);
  if (description) document.querySelector('meta[name="description"]').content = description;
}

async function setLang(lang) {
  const target = SUPPORTED.includes(lang) ? lang : DEFAULT;
  current = await loadStrings(target);
  currentLang = HTML_LANG[target] ?? target;
  applyStrings();
  document.documentElement.lang = currentLang;
  if (select) select.value = target;
  try { localStorage.setItem("scrollia-lang", target); } catch (_) {}
  document.dispatchEvent(new CustomEvent("scrollia:lang", { detail: { lang: currentLang } }));
}

window.scrolliaI18n = {
  refresh: applyStrings,
  t,
  lang: () => currentLang,
  supported: SUPPORTED,
};

select?.addEventListener("change", () => setLang(select.value));

const initial = (() => {
  try {
    const saved = localStorage.getItem("scrollia-lang");
    if (saved) return saved;
  } catch (_) {}
  const browser = (navigator.languages?.length ? navigator.languages : [navigator.language || DEFAULT])
    .map((tag) => tag.split("-")[0]);
  return browser.find((lang) => SUPPORTED.includes(lang)) ?? DEFAULT;
})();

setLang(initial);
