/* Scrollia · web reader. Opens the API's EPUB as one continuous page.
   Only size and theme are adjustable; the rest matches the app reader:
   Literata, 1.7 line height, 65ch, start alignment and continuous scrolling. */

import { API, t, percent, readingProgress, saveReadingProgress, FINISHED } from "./api.js";
import { openBook, renderSection, tableOfContents, BookError } from "./epub.js";

const params = new URLSearchParams(location.search);
const workId = Number(params.get("work"));
const editionId = Number(params.get("edition") ?? params.get("work"));

const root = document.documentElement;
const bar = document.querySelector(".reading__bar");
const back = bar.querySelector("a");
const titleLine = bar.querySelector(".reading__title");
const positionLine = bar.querySelector(".reading__position");
const progressFill = document.querySelector(".reading__progress span");
const main = document.querySelector(".reading__main");
const state = main.querySelector(".reading__state");
const stateMessage = state.querySelector(".shelf__message");
const retry = state.querySelector("button");
const article = main.querySelector(".reading__book");
const contentsButton = bar.querySelector('[data-sheet="contents"]');
const [previousButton, nextButton] = bar.querySelectorAll("[data-chapter]");
const contents = document.getElementById("contents");
const tocList = contents.querySelector(".toc");
const note = document.getElementById("note");
const noteMark = note.querySelector(".note__mark");
const noteBody = note.querySelector(".note__body");
const settings = document.getElementById("settings");
const sizeRange = settings.querySelector(".size__range");
const sizeValue = settings.querySelector(".size__value");
const swatches = settings.querySelectorAll("[data-reader-option]");
const systemDark = matchMedia("(prefers-color-scheme: dark)");

/* Height below the toolbar for the position indicator; matches scroll-margin-top. */
const LINE = 72;
const LEAF = "p,h1,h2,h3,h4,h5,h6,li,pre,dt,dd,figcaption,tr";

history.scrollRestoration = "manual";

let book = null;
let blocks = [];
let starts = [];
let weights = [];
let total = 1;
let toc = [];
let current = 0;
let failure = null;

function stored(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}

function store(key, value) {
  try { localStorage.setItem(key, value); } catch (_) {}
}

/* ---------- appearance: one theme decision shared with the site ---------- */

function applyReaderTheme(theme) {
  root.dataset.readerTheme = theme;
  root.dataset.theme = theme === "night" ? "dark" : theme === "amoled" ? "amoled" : "light";
  swatches.forEach((s) => s.setAttribute("aria-checked", String(s.dataset.readerOption === theme)));
}

swatches.forEach((swatch) => {
  swatch.addEventListener("click", () => {
    const theme = swatch.dataset.readerOption;
    const siteTheme = theme === "night" ? "dark" : theme === "amoled" ? "amoled" : "light";
    store("scrollia-theme", siteTheme);
    if (theme === "paper" || theme === "sepia") store("scrollia-reader-theme", theme);
    applyReaderTheme(theme);
  });
});

systemDark.addEventListener("change", (event) => {
  if (stored("scrollia-theme")) return;
  applyReaderTheme(event.matches ? "night" : stored("scrollia-reader-theme") === "sepia" ? "sepia" : "paper");
});

applyReaderTheme(root.dataset.readerTheme);

/* ---------- size: the text behind the sheet is the preview ---------- */

function showSize() {
  sizeValue.textContent = percent(sizeRange.value / 100);
}

function applySize(value, keepPlace) {
  const anchor = keepPlace ? blocks[current] : null;
  const before = anchor?.getBoundingClientRect().top;
  sizeRange.value = value;
  for (const el of [article, noteBody]) el.style.setProperty("--reader-scale", value / 100);
  showSize();
  if (anchor) scrollBy({ top: anchor.getBoundingClientRect().top - before, behavior: "instant" });
}

sizeRange.addEventListener("input", () => {
  applySize(Number(sizeRange.value), true);
  store("scrollia-reader-size", sizeRange.value);
});

applySize(Number(stored("scrollia-reader-size")) || 100, false);

/* ---------- sheets: contents and settings ---------- */

document.querySelectorAll("[data-sheet]").forEach((button) => {
  button.addEventListener("click", () => {
    const sheet = document.getElementById(button.dataset.sheet);
    sheet.showModal();
    if (sheet === contents) tocList.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "center" });
  });
});

document.querySelectorAll(".sheet").forEach((sheet) => {
  sheet.querySelector("[data-close]").addEventListener("click", () => sheet.close());
  sheet.addEventListener("click", (event) => {
    if (event.target !== sheet) return;
    const r = sheet.getBoundingClientRect();
    const outside = event.clientX < r.left || event.clientX > r.right
      || event.clientY < r.top || event.clientY > r.bottom;
    if (outside) sheet.close();
  });
});

/* An unpainted section (content-visibility) has neither a jump target nor its
   real height. Paint all sections through the destination once, let the browser
   remember their heights (contain-intrinsic-size: auto), then restore their mode. */
function goTo(node, showBar = true) {
  const sections = [...article.children];
  const shown = sections.slice(0, sections.indexOf(node.closest(".reading__book > section")) + 1);
  shown.forEach((s) => { s.style.contentVisibility = "visible"; });
  node.scrollIntoView({ block: "start", behavior: "instant" });
  lastY = scrollY;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    shown.forEach((s) => s.style.removeProperty("content-visibility"));
  }));
  if (showBar) bar.classList.remove("is-hidden");
}

/* ---------- position in the book ---------- */

/* Reading blocks: paragraphs, headings, verse and standalone illustrations.
   Each is weighted by character count, so percentages reflect text rather than
   page height, which changes with font size and images that have not loaded. */
function indexBlocks() {
  const candidates = article.querySelectorAll(`${LEAF},div,blockquote,img`);
  blocks = [...candidates].filter((el) => {
    if (el.matches(LEAF)) return !el.querySelector(LEAF);
    if (el.localName === "img") return !el.parentElement.closest(LEAF);
    return [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.data.trim());
  });
  starts = [];
  weights = [];
  let sum = 0;
  blocks.forEach((el, i) => {
    el.dataset.i = i;
    const weight = el.matches(LEAF)
      ? el.textContent.length
      : el.localName === "img"
        ? 200
        : [...el.childNodes].reduce((n, c) => n + (c.nodeType === Node.TEXT_NODE ? c.data.length : 0), 0);
    starts.push(sum);
    weights.push(weight);
    sum += weight;
  });
  total = Math.max(1, sum);
}

function blockOf(node) {
  const own = node.closest("[data-i]") ?? node.querySelector("[data-i]");
  if (own) return Number(own.dataset.i);
  let lo = 0;
  let hi = blocks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (node.compareDocumentPosition(blocks[mid]) & Node.DOCUMENT_POSITION_FOLLOWING) hi = mid;
    else lo = mid + 1;
  }
  return Math.min(lo, blocks.length - 1);
}

function anchorAt() {
  const box = article.getBoundingClientRect();
  const x = box.left + box.width / 2;
  for (let y = LINE; y < innerHeight; y += 12) {
    const hit = document.elementFromPoint(x, y)?.closest("[data-i]");
    if (hit && article.contains(hit)) return Number(hit.dataset.i);
  }
  return current;
}

function fraction() {
  if (scrollY + innerHeight >= document.documentElement.scrollHeight - 2) return 1;
  const r = blocks[current]?.getBoundingClientRect();
  if (!r) return 0;
  const within = r.height ? Math.min(1, Math.max(0, (LINE - r.top) / r.height)) : 0;
  return (starts[current] + within * weights[current]) / total;
}

function chapterAt(i) {
  let found = null;
  for (const entry of toc) {
    if (entry.block <= i) found = entry;
    else break;
  }
  return found;
}

/* Previous and Next traverse the cleaned table of contents: catalog EPUB
   entries are chapters (plus parts in Moby Dick and Don Quixote). */
function chapterStep(step) {
  if (step > 0) {
    const atEnd = scrollY + innerHeight >= document.documentElement.scrollHeight - 2;
    return atEnd ? null : toc.find((entry) => entry.block > current) ?? null;
  }
  const chapter = chapterAt(current);
  if (!chapter) return null;
  return toc.findLast((entry) => entry.block < chapter.block) ?? null;
}

function moveChapter(step, showBar) {
  const entry = chapterStep(step);
  if (entry) goTo(entry.target, showBar);
}

function showPosition() {
  const done = fraction();
  progressFill.style.inlineSize = `${done * 100}%`;
  previousButton.disabled = !chapterStep(-1);
  nextButton.disabled = !chapterStep(1);
  const chapter = chapterAt(current);
  positionLine.replaceChildren();
  if (chapter) {
    const label = document.createElement("span");
    label.className = "reading__chapter";
    label.textContent = chapter.label;
    label.lang = article.lang;
    positionLine.append(label, " · ");
  }
  positionLine.append(percent(done));
  tocList.querySelectorAll("a").forEach((a) => {
    if (a.entry === chapter) a.setAttribute("aria-current", "true");
    else a.removeAttribute("aria-current");
  });
  return done;
}

let saveTimer = 0;

function save() {
  clearTimeout(saveTimer);
  if (!book || !blocks.length) return;
  saveReadingProgress(editionId, {
    work: workId || editionId,
    block: current,
    fraction: fraction(),
    at: Date.now(),
    title: book.title,
    author: book.author,
    language: book.language,
    cover: readingProgress(editionId)?.cover,
  });
}

let lastY = scrollY;
let ticking = false;

addEventListener("scroll", () => {
  const y = scrollY;
  if (Math.abs(y - lastY) > 6) {
    bar.classList.toggle("is-hidden", y > lastY && y > LINE);
    lastY = y;
  }
  if (ticking || !blocks.length) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    current = anchorAt();
    showPosition();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  });
}, { passive: true });

addEventListener("pagehide", save);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") save();
});

/* ---------- notes: open in a sheet without losing the page ---------- */

let noteTarget = null;

function openNote(link, target) {
  const block = target.closest("li, p, dd, div");
  if (!block || block === article || block.contains(link) || block.textContent.length > 4000) return false;
  const copy = block.cloneNode(true);
  const back = link.id ? `, a[href="#${CSS.escape(link.id)}"]` : "";
  copy.querySelectorAll(`[data-backlink]${back}`).forEach((el) => el.remove());
  for (const el of [copy, ...copy.querySelectorAll("[id], [data-i]")]) {
    el.removeAttribute("id");
    el.removeAttribute("data-i");
  }
  noteMark.textContent = link.textContent.replace(/[[\]()]/g, "").trim();
  noteBody.lang = block.closest("[lang]")?.lang ?? article.lang;
  noteBody.replaceChildren(...copy.childNodes);
  noteTarget = target;
  note.showModal();
  return true;
}

note.querySelector(".note__go").addEventListener("click", () => {
  note.close();
  goTo(noteTarget);
});

/* Internal book links: footnote references open the sheet; others jump to their target. */
function follow(event) {
  const link = event.target.closest("a[href]");
  if (!link?.getAttribute("href").startsWith("#")) return link;
  event.preventDefault();
  const target = document.getElementById(link.getAttribute("href").slice(1));
  if (!target || !article.contains(target)) return link;
  if (note.open) note.close();
  if (link.hasAttribute("data-noteref") && openNote(link, target)) return link;
  goTo(target);
  return link;
}

noteBody.addEventListener("click", follow);

/* Tapping the text toggles the toolbar, as in the app. */
article.addEventListener("click", (event) => {
  if (follow(event) || !getSelection().isCollapsed) return;
  bar.classList.toggle("is-hidden");
});

/* ---------- chapters: toolbar and keyboard arrows ---------- */

previousButton.addEventListener("click", () => moveChapter(-1, true));
nextButton.addEventListener("click", () => moveChapter(1, true));

document.addEventListener("keydown", (event) => {
  const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
  if (!step || !blocks.length || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (document.querySelector("dialog[open]") || event.target.closest("input, textarea, select, [contenteditable]")) return;
  event.preventDefault();
  moveChapter(step, false);
});

/* ---------- images: fetch sequentially as they approach ---------- */

let queue = Promise.resolve();
const images = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const img = entry.target;
    images.unobserve(img);
    queue = queue
      .then(() => book.image(img.dataset.src))
      .then((url) => { img.src = url; })
      .catch(() => img.remove());
  }
}, { rootMargin: "100% 0px" });

/* ---------- loading and states ---------- */

function renderToc() {
  tocList.replaceChildren(...toc.map((entry) => {
    const item = document.createElement("li");
    item.style.setProperty("--depth", entry.depth);
    const a = document.createElement("a");
    a.href = `#${entry.target.id}`;
    a.textContent = entry.label;
    a.lang = article.lang;
    a.entry = entry;
    a.addEventListener("click", (event) => {
      event.preventDefault();
      contents.close();
      goTo(entry.target);
    });
    item.append(a);
    return item;
  }));
  contentsButton.disabled = !toc.length;
}

function renderState() {
  state.hidden = !failure;
  if (!failure) return;
  stateMessage.dataset.i18n = { notFound: "reader.notFound", offline: "reader.offline" }[failure] ?? "reader.error";
  stateMessage.textContent = t(stateMessage.dataset.i18n, stateMessage.textContent);
  retry.hidden = failure === "notFound";
}

async function load() {
  failure = null;
  state.hidden = false;
  retry.hidden = true;
  stateMessage.dataset.i18n = "reader.loading";
  stateMessage.textContent = t("reader.loading", "…");
  main.setAttribute("aria-busy", "true");
  back.href = workId || editionId ? `book.html?id=${workId || editionId}` : "catalog.html";

  try {
    if (!Number.isInteger(editionId) || editionId <= 0) throw new BookError("notFound");
    book = await openBook(`${API}/download/${editionId}.epub`);
    if (!book.sections.length) throw new BookError("error");
  } catch (error) {
    failure = error instanceof BookError ? error.kind : "error";
    book = null;
  }

  main.setAttribute("aria-busy", "false");
  renderState();
  if (!book) return;

  article.lang = book.language;
  article.dir = book.dir;
  article.replaceChildren(...book.sections.map((_, i) => renderSection(book, i, (img, src) => {
    img.dataset.src = src;
    images.observe(img);
  })));
  article.hidden = false;
  titleLine.textContent = book.title;
  titleLine.lang = book.language;
  document.title = `${book.title} · Scrollia`;

  indexBlocks();
  toc = tableOfContents(book, article).map((entry) => ({ ...entry, block: blockOf(entry.target) }));
  toc.sort((a, b) => a.block - b.block);
  renderToc();

  const saved = readingProgress(editionId);
  current = saved?.fraction < FINISHED ? Math.min(saved.block, blocks.length - 1) : 0;
  if (current > 0) goTo(blocks[current], false);
  showPosition();
}

retry.addEventListener("click", load);
document.addEventListener("scrollia:lang", () => {
  showSize();
  if (book) showPosition();
  if (failure) renderState();
});

load();
