/* Scrollia · full catalog. Search, language, genre and sorting use GET /books,
   like the app filter; languages come from GET /site and genres with counts
   from GET /categories. The URL stores all state (?q=…&lang=…&genre=…&sort=…&page=…)
   so it can be shared; page changes add history entries for Back navigation. */

import { API, t, plural, endonym, displayName, element, bookCard } from "./api.js";

const PAGE_SIZE = 24; // Multiple of common grid columns (4/6); avoids a short last row looking final
const DEBOUNCE = 250;

const form = document.querySelector(".browse__filters");
const input = form.querySelector('input[type="search"]');
const langSelect = form.querySelector('select[name="lang"]');
const genreSelect = form.querySelector('select[name="genre"]');
const sortSelect = document.querySelector('.browse__sort select');
const countLine = document.querySelector(".browse__count");
const shelf = document.querySelector(".shelf");
const pager = document.querySelector(".pager");
const empty = document.querySelector(".browse__empty");
const emptyMessage = empty.querySelector(".shelf__message");
const failure = document.querySelector(".shelf__error");

const params = new URLSearchParams(location.search);
const initialLang = params.get("lang");
let query = params.get("q") ?? "";
// One language at a time, as in the app; use the first from an old multi-language link
let langs = new Set(initialLang && initialLang !== "all" ? initialLang.split(",").filter(Boolean).slice(0, 1) : []);
let followUi = initialLang === null;
let availableLangs = [];
let initialized = false;
let page = pageFrom(params);
let genre = params.get("genre") ?? "";
const SORTS = ["popular", "title", "author", "added"];
let sort = SORTS.includes(params.get("sort")) ? params.get("sort") : "popular";
let total = null;
let controller = null;
let genreController = null;

input.value = query;
sortSelect.value = sort;

function pageFrom(search) {
  const n = Number.parseInt(search.get("page") ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function preferredUiLang() {
  try {
    return (localStorage.getItem("scrollia-lang") || navigator.language || "es").slice(0, 2);
  } catch (_) {
    return (navigator.language || "es").slice(0, 2);
  }
}

function sameLangs(a, b) {
  return a.size === b.size && [...a].every((lang) => b.has(lang));
}

function syncChecks() {
  langSelect.value = langs.size ? [...langs][0] : "";
}

function applyUiDefault(lang) {
  if (!followUi || !availableLangs.length) return false;
  const next = availableLangs.includes(lang) ? new Set([lang]) : new Set();
  if (sameLangs(langs, next)) return false;
  langs = next;
  if (initialized) page = 1;
  syncChecks();
  syncUrl();
  return true;
}

/* Gutenberg uses titles such as "Moby Dick; Or, The Whale" or "The Odyssey:
   Rendered into English Prose…"; cards and covers use the short title, while
   the work page shows the full one. */
const shortTitle = (title) => title.split(/[;:]\s/)[0];

/* /books promotes the edition in the requested language: language and cover
   belong to that edition. The card title prefers work.titles in the UI
   language so a Chinese-only work still reads clearly in Spanish. */
function toWork(result) {
  const edition = result.editions.find((e) => e.id === result.id) ?? result.editions[0];
  const ui = preferredUiLang();
  const label = result.titles?.[ui] ?? result.title;
  return {
    id: result.edition_ids?.[0] ?? result.id,
    title: shortTitle(label),
    titleLang: result.titles?.[ui] ? ui : edition.languages[0],
    author: result.authors[0] ? displayName(result.authors[0].name) : "",
    language: edition.languages[0],
    cover: result.formats["image/jpeg"],
  };
}

function url() {
  const search = new URLSearchParams({ page, page_size: PAGE_SIZE });
  if (query.trim()) search.set("search", query.trim());
  if (langs.size) search.set("languages", [...langs].join(","));
  if (genre) search.set("topic", genre);
  if (sort !== "popular") search.set("sort", sort);
  return `${API}/books?${search}`;
}

function pageHref(n) {
  const search = new URLSearchParams();
  if (query.trim()) search.set("q", query.trim());
  if (!followUi) search.set("lang", langs.size ? [...langs].join(",") : "all");
  if (genre) search.set("genre", genre);
  if (sort !== "popular") search.set("sort", sort);
  if (n > 1) search.set("page", n);
  return search.size ? `?${search}` : location.pathname;
}

function syncUrl(push = false) {
  history[push ? "pushState" : "replaceState"](null, "", pageHref(page));
}

function showLoading() {
  failure.hidden = true;
  empty.hidden = true;
  pager.hidden = true;
  shelf.hidden = false;
  countLine.textContent = t("catalog.loading", "Cargando catálogo…");
  shelf.setAttribute("aria-busy", "true");
  shelf.replaceChildren(...Array.from({ length: PAGE_SIZE }, () => {
    const placeholder = element("div", "book book--placeholder");
    placeholder.append(element("span", "cover-placeholder"));
    return placeholder;
  }));
}

const lastPage = () => Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE));

function renderCount() {
  if (total == null) {
    countLine.textContent = "";
    return;
  }
  const where = lastPage() > 1
    ? " · " + t("browse.pageOf", "{page} / {pages}").replace("{page}", page).replace("{pages}", lastPage())
    : "";
  countLine.textContent = plural("catalog.works", total) + where;
}

/* Show every page when there are at most seven; otherwise show the first,
   last and current page's neighbors, with «…» filling the gaps. */
function pageList(current, last) {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);
  const near = current <= 4 ? [2, 3, 4, 5] : current >= last - 3 ? [last - 4, last - 3, last - 2, last - 1]
    : [current - 1, current, current + 1];
  const pages = [...new Set([1, ...near, last])].sort((a, b) => a - b);
  return pages.flatMap((n, i) => (i && n - pages[i - 1] > 1 ? [null, n] : [n]));
}

function pagerLink(n, label, className, rel) {
  const link = element("a", className, label);
  link.href = pageHref(n);
  link.dataset.page = n;
  if (rel) link.rel = rel;
  return link;
}

/* Keep Previous and Next in place even when disabled so page numbers do not move. */
function renderPager() {
  const last = lastPage();
  pager.hidden = !total || last < 2;
  if (pager.hidden) return;
  const step = (n, key, fallback, rel) => {
    if (n < 1 || n > last) {
      const off = element("span", "pager__step", t(key, fallback));
      off.setAttribute("aria-disabled", "true");
      return off;
    }
    return pagerLink(n, t(key, fallback), "pager__step", rel);
  };
  const list = element("ol", "pager__pages");
  list.append(...pageList(page, last).map((n) => {
    const item = element("li");
    if (n === null) {
      item.className = "pager__gap";
      item.textContent = "…";
      item.setAttribute("aria-hidden", "true");
      return item;
    }
    const link = pagerLink(n, String(n), "pager__page");
    link.setAttribute("aria-label", t("browse.page", "{n}").replace("{n}", n));
    if (n === page) link.setAttribute("aria-current", "page");
    item.append(link);
    return item;
  }));
  pager.replaceChildren(
    step(page - 1, "browse.prev", "Anterior", "prev"),
    list,
    step(page + 1, "browse.next", "Siguiente", "next"),
  );
}

function renderEmpty() {
  emptyMessage.textContent = t("browse.empty", "{query}").replace("{query}", query.trim());
}

async function load({ focusFirst = false } = {}) {
  controller?.abort();
  controller = new AbortController();
  showLoading();

  try {
    const res = await fetch(url(), { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    total = data.count;
    // An old link or shorter catalog can point beyond the last page: use the last one
    if (!data.results.length && total && page > lastPage()) {
      page = lastPage();
      syncUrl();
      return load({ focusFirst });
    }
    const cards = data.results.map(toWork).map(bookCard);
    shelf.replaceChildren(...cards);
    shelf.setAttribute("aria-busy", "false");
    shelf.hidden = !total;
    empty.hidden = total > 0;
    if (!total) renderEmpty();
    renderCount();
    renderPager();
    if (focusFirst) cards[0]?.focus({ preventScroll: true });
  } catch (error) {
    if (error.name === "AbortError") return;
    shelf.hidden = true;
    pager.hidden = true;
    failure.hidden = false;
    total = null;
    renderCount();
  }
}

/* Changing pages opens another shelf: scroll back to the results and move
   focus to the first card for keyboard users. */
function goTo(n) {
  if (n === page) return;
  page = n;
  syncUrl(true);
  countLine.scrollIntoView({ block: "start" });
  load({ focusFirst: true });
}

function option(value, label, lang) {
  const node = element("option", null, label);
  node.value = value;
  if (lang) node.lang = lang;
  return node;
}

/* Language and genre use native selects: with twelve languages and around ten
   genres, rows of buttons filled the header before the first book. */
function renderLanguages() {
  langSelect.replaceChildren(
    option("", t("browse.allLanguages", "Todos los idiomas")),
    ...availableLangs.map((code) => option(code, endonym(code), code)),
  );
  syncChecks();
}

async function loadLanguages() {
  try {
    const res = await fetch(`${API}/site?limit=1`);
    if (!res.ok) return;
    availableLangs = Object.keys((await res.json()).languages ?? {});
    if (availableLangs.length < 2) return;
    renderLanguages();
    langSelect.hidden = false;
  } catch (_) {}
}

/* Show genres with works for the current language and search, with counts
   ("Fiction (7)"), as in the app; keep the selected genre at zero so it can be cleared. */
let genreCounts = [];

function renderGenres() {
  const shown = genreCounts.filter((g) => g.count > 0 || g.category === genre);
  genreSelect.hidden = !shown.length;
  genreSelect.replaceChildren(
    option("", t("browse.allGenres", "Todos los géneros")),
    ...shown.map((g) => option(g.category, `${t(`genres.${g.category}`, g.category)} (${g.count})`)),
  );
  genreSelect.value = genre;
}

async function loadGenres() {
  genreController?.abort();
  genreController = new AbortController();
  const search = new URLSearchParams();
  if (query.trim()) search.set("search", query.trim());
  if (langs.size) search.set("languages", [...langs].join(","));
  try {
    const res = await fetch(`${API}/categories?${search}`, { signal: genreController.signal });
    if (!res.ok) return;
    genreCounts = await res.json();
    renderGenres();
  } catch (_) {}
}

/* Searching or changing language also changes each genre count. */
function refilter() {
  page = 1;
  syncUrl();
  load();
  loadGenres();
}

let timer = 0;
input.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    query = input.value;
    refilter();
  }, DEBOUNCE);
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  clearTimeout(timer);
  query = input.value;
  refilter();
});

langSelect.addEventListener("change", () => {
  followUi = false;
  langs = new Set(langSelect.value ? [langSelect.value] : []);
  refilter();
});

genreSelect.addEventListener("change", () => {
  genre = genreSelect.value;
  page = 1;
  syncUrl();
  load();
});

sortSelect.addEventListener("change", () => {
  sort = sortSelect.value;
  page = 1;
  syncUrl();
  load();
});

/* Links retain their URLs for opening another tab or copying; a normal click
   changes pages without reloading. */
pager.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-page]");
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  goTo(Number(link.dataset.page));
});

window.addEventListener("popstate", () => {
  const n = pageFrom(new URLSearchParams(location.search));
  if (n === page) return;
  page = n;
  load();
});

failure.querySelector("button").addEventListener("click", () => load());
empty.querySelector("button").addEventListener("click", () => {
  input.value = query = "";
  genre = "";
  refilter();
  input.focus();
});

document.addEventListener("scrollia:lang", (event) => {
  renderCount();
  renderPager();
  if (availableLangs.length > 1) renderLanguages();
  if (genreCounts.length) renderGenres();
  if (!empty.hidden) renderEmpty();
  const lang = (event.detail?.lang ?? "").split("-")[0];
  if (initialized && applyUiDefault(lang)) {
    load();
    loadGenres();
  }
});

async function init() {
  await loadLanguages();
  applyUiDefault(preferredUiLang());
  syncChecks();
  initialized = true;
  load();
  loadGenres();
}

init();
