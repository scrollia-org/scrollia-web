/* Scrollia · live catalog. Counts, languages, shelf and hero covers come from
   the API (GET /site): curating the catalog requires no web changes. */

import { API, t, uiLang, plural, element, bookCard, bookCover } from "./api.js";

const SHELF_SIZE = 12;
const HERO_SIZE = 3;

const hero = document.querySelector(".hero");
const heroCovers = document.querySelector(".hero__covers");
const shelf = document.querySelector(".shelf");
const shelfError = document.querySelector(".shelf__error");
const countLine = document.querySelector(".catalog__count");

let site = null;

/* Alternate languages by popularity so the selection reflects catalog variety
   even when one language dominates the most-read list. */
function interleave(works, languages) {
  const queues = new Map(languages.map((lang) => [lang, []]));
  works.forEach((w) => {
    if (!queues.has(w.language)) queues.set(w.language, []);
    queues.get(w.language).push(w);
  });
  const out = [];
  while (out.length < works.length) {
    for (const queue of queues.values()) {
      if (queue.length) out.push(queue.shift());
    }
  }
  return out;
}

function renderCount() {
  const template = t("catalog.count", null);
  if (!site || !template) return;
  const lang = uiLang();
  const codes = Object.keys(site.languages);
  let languages;
  if (codes.length <= 4) {
    const names = new Intl.DisplayNames([lang], { type: "language" });
    languages = new Intl.ListFormat(lang, { type: "conjunction" }).format(codes.map((c) => names.of(c)));
  } else {
    languages = t("catalog.languagesMany", "{n}").replace("{n}", new Intl.NumberFormat(lang).format(codes.length));
  }
  countLine.textContent = template
    .replace("{works}", plural("catalog.works", site.works))
    .replace("{languages}", languages);
  countLine.hidden = false;
}

function showLoading() {
  shelfError.hidden = true;
  shelf.hidden = false;
  countLine.textContent = t("catalog.loading", "Cargando catálogo…");
  countLine.hidden = false;
  shelf.setAttribute("aria-busy", "true");
  shelf.replaceChildren(...Array.from({ length: SHELF_SIZE }, () => {
    const placeholder = element("div", "book book--placeholder");
    placeholder.append(element("span", "cover-placeholder"));
    return placeholder;
  }));
}

function showError() {
  shelf.hidden = true;
  shelf.setAttribute("aria-busy", "false");
  shelfError.hidden = false;
  countLine.hidden = true;
  hero.classList.add("hero--plain");
}

function edition(work, lang) {
  return {
    ...work,
    title: work.titles[lang].split(/[;:]\s/)[0],
    language: lang,
    original_cover: work.covers?.[lang] ?? work.original_cover,
  };
}

/* With an edition in the interface language, its card uses that title, language
   and cover, matching the linked work page. */
function inUiLanguage(work) {
  const lang = uiLang().split("-")[0];
  return work.titles?.[lang] ? edition(work, lang) : work;
}

function render() {
  const books = interleave(site.featured, Object.keys(site.languages)).map(inUiLanguage).map((work) => ({
    ...work,
    originalCover: work.cover,
    cover: work.original_cover ?? work.cover,
  }));
  shelf.replaceChildren(...books.slice(0, SHELF_SIZE).map(bookCard));
  shelf.setAttribute("aria-busy", "false");
  // The taller center cover belongs to the first book.
  const fan = books.slice(0, HERO_SIZE);
  if (fan.length === 3) fan.unshift(fan.splice(1, 1)[0]);
  heroCovers.replaceChildren(...fan.map((w) => bookCover(w, "", false)));
  hero.classList.remove("hero--plain");
  renderCount();
}

async function load() {
  showLoading();
  try {
    const res = await fetch(`${API}/site?limit=100`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    site = await res.json();
    if (!site.featured?.length) throw new Error("empty catalog");
    render();
  } catch (_) {
    showError();
  }
}

shelfError.querySelector("button").addEventListener("click", load);
document.addEventListener("scrollia:lang", () => {
  if (site) render();
});

load();
