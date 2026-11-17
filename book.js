/* Scrollia · work page. Cover, metadata, synopsis and editions come from
   the API (GET /works/{id}); the page has no hardcoded book data.
   It shows one edition in the reader's language, with a selector to change it. */

import {
  API, t, uiLang, plural, percent, endonym, languageName, element, fill, inLang,
  readingProgress, readerUrl, FINISHED, displayName, bookCover, authorLabel, isAnonymous,
} from "./api.js";

const SOURCES = { gutenberg: "Project Gutenberg", standardebooks: "Standard Ebooks" };
/* Scrollia editions (source "scrollia") link to their source text. */
const HOSTS = { "standardebooks.org": "Standard Ebooks", "www.gutenberg.org": "Project Gutenberg" };
const LICENSES = { "CC BY-SA 4.0": "https://creativecommons.org/licenses/by-sa/4.0/" };

const main = document.querySelector(".work");
const head = main.querySelector(".work__head");
const coverBox = main.querySelector(".work__cover");
const langLine = main.querySelector(".work__lang");
const titleLine = main.querySelector(".work__title");
const authorLine = main.querySelector(".work__author");
const metaLine = main.querySelector(".work__meta");
const picker = main.querySelector(".work__pick");
const select = picker.querySelector("select");
const actions = main.querySelector(".work__actions");
const editionLine = main.querySelector(".work__edition");
const synopsis = main.querySelector(".work__synopsis");
const synopsisMark = main.querySelector(".work__mark");
const note = main.querySelector(".work__note");
const text = main.querySelector(".work__text");
const attribution = main.querySelector(".work__attribution");
const state = main.querySelector(".work__state");
const stateMessage = state.querySelector(".shelf__message");
const retry = state.querySelector("button");

const params = new URLSearchParams(location.search);
const id = Number(params.get("id"));
const linkedLang = params.get("lang"); // Edition requested by a card (?lang=fr)
let linkedId = null; // An edition id in ?id= opens its work with that edition

let work = null;
let chosenId = null; // Edition selected manually in the language selector
let failure = null; // "notFound" | "error"

const baseLang = (tag) => tag.split("-")[0];

function link(label, href) {
  const a = element("a", null, label);
  a.href = href;
  a.rel = "noopener";
  return a;
}

function bce(n) {
  return t("work.bce", "{n} a. C.").replace("{n}", n);
}

function year(n) {
  return n < 0 ? bce(-n) : String(n);
}

function lifeYears(person) {
  const birth = person?.birth_year;
  const death = person?.death_year;
  if (birth == null && death == null) return "";
  if (birth < 0 && death < 0) return bce(`${-birth}–${-death}`);
  return `${birth == null ? "?" : year(birth)}–${death == null ? "?" : year(death)}`;
}

/* AI-generated text marker: a line sparkle and «IA»; the full explanation is
   available in the title and to screen readers. */
const SVG = "http://www.w3.org/2000/svg";
function aiIcon() {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "ai-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", "M11 4c.7 5.2 2.8 7.3 8 8-5.2.7-7.3 2.8-8 8-.7-5.2-2.8-7.3-8-8 5.2-.7 7.3-2.8 8-8zM19 2.5v4M17 4.5h4");
  svg.append(path);
  return svg;
}

/* The same line icons as the landing benefits: open book and download. */
const ICONS = {
  read: ["M12 6.5C10.5 5.3 8.3 4.75 4 4.75v13c4.3 0 6.5.55 8 1.75 1.5-1.2 3.7-1.75 8-1.75v-13c-4.3 0-6.5.55-8 1.75z", "M12 6.5v13"],
  download: ["M12 4v11", "m7.5 10.5 4.5 4.5 4.5-4.5", "M5 19.25h14"],
  share: ["M8.2 10.9l7.6-4.3M8.2 13.1l7.6 4.3", "M18 2.75a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM6 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM18 16.25a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z"],
};

function icon(name) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/* Button with a leading icon; the text has its own span so it can be updated. */
function action(tag, kind, name, label) {
  const el = element(tag, `btn btn--${kind}`);
  el.append(icon(name), element("span", null, label));
  return el;
}

function aiMark(label) {
  const mark = element("span", "ai-mark");
  mark.title = label;
  const short = element("span", null, t("work.aiShort", "IA"));
  short.setAttribute("aria-hidden", "true");
  mark.append(aiIcon(), short, element("span", "visually-hidden", label));
  return mark;
}

function joined(parts) {
  const out = document.createDocumentFragment();
  parts.filter(Boolean).forEach((part, i) => {
    if (i) out.append(" · ");
    out.append(part);
  });
  return out;
}

/* Prefer the interface language, then the first browser language with an
   edition, then the primary edition. Browser languages ranked ahead of the
   interface language but unsupported by the interface come first: with an
   Italian browser and an English interface, an Italian edition opens in Italian. */
function preferredEdition() {
  const ui = baseLang(uiLang());
  const supported = window.scrolliaI18n?.supported ?? [];
  const browser = (navigator.languages ?? []).map(baseLang);
  const at = browser.indexOf(ui);
  const before = (at < 0 ? browser : browser.slice(0, at)).filter((lang) => !supported.includes(lang));
  const wanted = [...before, ui, ...browser];
  for (const lang of wanted) {
    const edition = work.editions.find((e) => e.language === lang);
    if (edition) return edition;
  }
  return work.editions[0];
}

/* Edition used by Read and Download: the selector choice, then the card that
   led here, then the edition being read, then the reader's language. */
function selectedEdition() {
  return work.editions.find((e) => e.id === chosenId)
    ?? work.editions.find((e) => e.id === linkedId)
    ?? work.editions.find((e) => e.language === linkedLang)
    ?? lastReading()?.edition
    ?? preferredEdition();
}

/* UI label: work.titles[ui] → edition in the UI language → canonical title.
   Edition / EPUB titles stay on the language selector and the reader. */
function displayTitle() {
  const ui = baseLang(uiLang());
  if (work.titles?.[ui]) return { text: work.titles[ui], lang: ui };
  const edition = preferredEdition();
  return edition.language === ui
    ? { text: edition.title, lang: edition.language }
    : { text: work.title, lang: work.editions[0].language };
}

function chosenSynopsis() {
  const all = work.descriptions?.length ? work.descriptions : work.description ? [work.description] : [];
  const want = baseLang(uiLang());
  return all.find((d) => d.lang === want)
    ?? all.find((d) => d.lang === work.description?.lang)
    ?? all[0]
    ?? null;
}

function renderHead() {
  const primary = work.editions[0];
  const edition = selectedEdition();
  const title = displayTitle();
  // Scrollia's own editions have their own cover: the work's art with the
  // edition's title, so it changes with the book language.
  const own = Boolean(edition.origin);
  const cover = bookCover({
    cover: own ? edition.formats["image/jpeg"] : work.cover,
    originalCover: own ? work.cover : primary.formats["image/jpeg"],
    title: own ? edition.title : title.text,
    author: work.author,
    language: own ? edition.language : title.lang,
  }, "work__image", false);
  coverBox.replaceChildren(cover);

  const several = work.editions.length > 1;
  langLine.hidden = several;
  langLine.textContent = endonym(primary.language);
  inLang(titleLine, edition.language).textContent = edition.title;

  const life = lifeYears(primary.authors?.[0]);
  authorLine.replaceChildren(...(work.author ? [authorLabel(work.author)] : []),
    ...(work.author && life ? [" ", element("span", "work__life", `(${life})`)] : []));
  authorLine.hidden = !work.author;

  const pages = edition.page_count ?? work.page_count;
  metaLine.replaceChildren(joined([
    work.year != null && year(work.year),
    pages && plural("work.pages", pages),
  ]));

  renderPicker(edition);

  const progress = readingProgress(edition.id);
  const read = action("a", "primary", "read", inProgress(progress)
    ? t("work.continue", "{percent}").replace("{percent}", percent(progress.fraction))
    : t("work.read", "Leer"));
  read.href = readerUrl(work.id, edition.id);

  const download = action("a", "secondary", "download", t("work.download", "Descargar EPUB"));
  download.href = edition.formats["application/epub+zip"];
  actions.replaceChildren(read, download, shareButton(edition));

  editionLine.replaceChildren(editionCredit(edition));
}

/* A selector with each language's own name takes one line even for twenty
   editions. Choosing one changes the title and the Read and Download targets.
   The original comes first; the rest are sorted by name. */
function renderPicker(selected) {
  picker.hidden = work.editions.length < 2;
  if (picker.hidden) return;
  const [original, ...others] = work.editions;
  others.sort((a, b) => endonym(a.language).localeCompare(endonym(b.language), uiLang()));
  select.replaceChildren(...[original, ...others].map((edition) => {
    const option = inLang(element("option", null, endonym(edition.language)), edition.language);
    option.value = edition.id;
    option.selected = edition.id === selected.id;
    return option;
  }));
}

select.addEventListener("change", () => {
  chosenId = Number(select.value);
  renderHead();
  history.replaceState(null, "", shareUrl(selectedEdition()));
});

/* An edition link identifies the work and language, never Gutenberg or the EPUB.
   Opening it shows the same edition, and copying the address bar shares it too. */
function shareUrl(edition) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("id", work.id);
  url.searchParams.set("lang", edition.language);
  return url.href;
}

function shareText(edition) {
  const text = work.author && !isAnonymous(work.author)
    ? t("work.shareText", "«{title}», de {author}, gratis en Scrollia").replace("{author}", work.author)
    : t("work.shareTextAnonymous", "«{title}», gratis en Scrollia");
  return text.replace("{title}", edition.title);
}

/* Use the system share sheet on mobile and supported browsers; otherwise copy
   the link and confirm it in the button itself. */
function shareButton(edition) {
  const button = action("button", "secondary", "share", t("work.share", "Compartir"));
  button.type = "button";
  const text = button.querySelector("span");
  text.setAttribute("aria-live", "polite");
  const label = text.textContent;
  let restore = null;
  const say = (message) => {
    text.textContent = message;
    clearTimeout(restore);
    restore = setTimeout(() => { text.textContent = label; }, 2500);
  };
  button.addEventListener("click", async () => {
    const data = { title: edition.title, text: shareText(edition), url: shareUrl(edition) };
    if (navigator.share && navigator.canShare?.(data) !== false) {
      try {
        await navigator.share(data);
        return;
      } catch (error) {
        if (error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(data.url);
      say(t("work.shareCopied", "Enlace copiado"));
    } catch (_) {
      window.prompt(t("work.shareCopy", "Copia este enlace"), data.url);
    }
  });
  return button;
}

const aiTranslated = (edition) => Boolean(edition.process) && edition.process !== "human";
const unreviewedAi = (edition) => aiTranslated(edition) && !edition.human_reviewed;

function sourceName(edition) {
  if (SOURCES[edition.source]) return SOURCES[edition.source];
  const host = edition.source_url ? new URL(edition.source_url).hostname : "";
  return HOSTS[host] ?? (host || edition.source);
}

/* Consider a book in progress once it rounds to 1%: never show "Continue reading · 0%". */
const inProgress = (p) => Boolean(p?.at) && p.fraction >= 0.005 && p.fraction < FINISHED;

/* The edition most recently read in this browser, if any. */
function lastReading() {
  return work.editions
    .map((edition) => ({ edition, progress: readingProgress(edition.id) }))
    .filter((r) => inProgress(r.progress))
    .sort((a, b) => b.progress.at - a.progress.at)[0] ?? null;
}

function renderSynopsis() {
  const chosen = chosenSynopsis();
  synopsis.hidden = !chosen;
  if (!chosen) return;

  const want = baseLang(uiLang());
  note.hidden = chosen.lang === want;
  note.textContent = t("work.synopsisIn", "{language}").replace("{language}", languageName(chosen.lang));

  inLang(text, chosen.lang).replaceChildren(
    ...chosen.text.split(/\n{2,}/).map((paragraph) => element("p", null, paragraph)),
  );

  const own = chosen.origin === "scrollia";
  const ai = own && chosen.process !== "human";
  synopsisMark.replaceChildren(...(ai ? [aiMark(t("work.synopsisAi", "Sinopsis redactada con IA"))] : []));
  attribution.hidden = own;
  if (own) return;
  const license = LICENSES[chosen.license] ? link(chosen.license, LICENSES[chosen.license]) : chosen.license;
  const host = chosen.url ? new URL(chosen.url).hostname : "";
  const sourceName = host.endsWith("wikipedia.org") ? "Wikipedia" : host;
  attribution.replaceChildren(fill(t("work.attribution", "{source} · {license}"), {
    source: chosen.url ? link(sourceName, chosen.url) : sourceName,
    license,
  }));
}

/* Where the reading text comes from: translator (or "AI translation") and
   a linked source. */
function editionCredit(edition) {
  const translators = edition.translators.map((p) => displayName(p.name));
  const source = sourceName(edition);
  const ai = unreviewedAi(edition) ? t("work.aiUnreviewed", "Traducción con IA, aún sin revisión humana")
    : aiTranslated(edition) ? t("work.aiTranslation", "Traducción con IA") : null;
  const credit = joined([
    ai ?? (translators.length && t("work.translatedBy", "{names}").replace(
      "{names}", new Intl.ListFormat(uiLang(), { type: "conjunction" }).format(translators))),
    fill(t("work.source", "Fuente: {source}"), {
      source: edition.source_url ? link(source, edition.source_url) : source,
    }),
  ]);
  if (ai) credit.prepend(aiIcon());
  return credit;
}

function renderMeta() {
  const title = displayTitle().text;
  document.title = work.author ? `${title} — ${authorLabel(work.author)} · Scrollia` : `${title} · Scrollia`;
  const summary = chosenSynopsis()?.text ?? "";
  document.querySelector('meta[name="description"]').content =
    summary.length > 160 ? `${summary.slice(0, 157).trimEnd()}…` : summary;
}

const loading = main.querySelector(".work__loading");

function renderState() {
  loading.hidden = true;
  head.hidden = true;
  synopsis.hidden = true;
  state.hidden = false;
  stateMessage.textContent = failure === "notFound"
    ? t("work.notFound", "No encontramos esta obra en el catálogo.")
    : t("work.error", "No pudimos cargar esta obra ahora mismo.");
  retry.hidden = failure === "notFound";
}

function render() {
  if (failure) return renderState();
  if (!work) return;
  loading.hidden = true;
  state.hidden = true;
  head.hidden = false;
  renderHead();
  renderSynopsis();
  renderMeta();
}

async function load() {
  failure = null;
  main.setAttribute("aria-busy", "true");
  loading.hidden = false;
  state.hidden = true;
  head.hidden = false;
  try {
    if (!Number.isInteger(id) || id <= 0) {
      failure = "notFound";
    } else {
      const res = await fetch(`${API}/works/${id}`);
      if (res.status === 404) failure = "notFound";
      else if (!res.ok) throw new Error(`HTTP ${res.status}`);
      else {
        work = await res.json();
        if (work.id !== id) linkedId = id;
      }
    }
  } catch (_) {
    failure = "error";
  }
  main.setAttribute("aria-busy", "false");
  render();
}

retry.addEventListener("click", load);
document.addEventListener("scrollia:lang", render);

load();
