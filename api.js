/* Scrollia · utilities shared by pages that read the API. */

export const API = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? "http://127.0.0.1:8000"
  : document.querySelector('meta[name="scrollia-api"]').content;

/* Every page imports this module, so offline reading (sw.js) is registered here. */
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

export function t(key, fallback) {
  return window.scrolliaI18n?.t(key) ?? fallback;
}

export function uiLang() {
  return window.scrolliaI18n?.lang() ?? document.documentElement.lang;
}

/* Plural key (`works.one`, `works.other`…) with {n} already formatted. */
export function plural(key, n) {
  const lang = uiLang();
  const form = new Intl.PluralRules(lang).select(n);
  const template = t(`${key}.${form}`, null) ?? t(`${key}.other`, "{n}");
  return template.replace("{n}", new Intl.NumberFormat(lang).format(n));
}

/* "34 %" in Spanish and French, "34%" in English: each language's convention. */
export function percent(fraction) {
  return new Intl.NumberFormat(uiLang(), { style: "percent", maximumFractionDigits: 0 }).format(fraction);
}

/* Above this threshold a book is finished: it leaves "Continue reading" and
   starts over when opened again. */
export const FINISHED = 0.99;

/* Reading position for an edition: { work, block, fraction, at }, plus
   { title, author, language, cover } to render it offline. */
export function readingProgress(edition) {
  try {
    return JSON.parse(localStorage.getItem(`scrollia-progress:${edition}`));
  } catch (_) {
    return null;
  }
}

export function saveReadingProgress(edition, progress) {
  try {
    localStorage.setItem(`scrollia-progress:${edition}`, JSON.stringify(progress));
  } catch (_) {}
}

/* Books in progress, most recent first. */
export function readingList() {
  const prefix = "scrollia-progress:";
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const progress = JSON.parse(localStorage.getItem(key));
      if (progress?.title) out.push({ edition: Number(key.slice(prefix.length)), ...progress });
    }
  } catch (_) {}
  return out.sort((a, b) => b.at - a.at);
}

export function readerUrl(work, edition) {
  return `read.html?work=${work}&edition=${edition}`;
}

/* A language's name in that language: "Español", "English". */
export function endonym(code) {
  try {
    const name = new Intl.DisplayNames([code], { type: "language" }).of(code);
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch (_) {
    return code;
  }
}

/* A language's name in the interface language: "inglés", "English". */
export function languageName(code) {
  try {
    return new Intl.DisplayNames([uiLang()], { type: "language" }).of(code);
  } catch (_) {
    return code;
  }
}

export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/* Fill a translated template ("Texto de {source}…") with DOM nodes without
   passing API data through innerHTML. */
export function fill(template, values) {
  const out = document.createDocumentFragment();
  template.split(/(\{\w+\})/).forEach((part) => {
    const key = part.match(/^\{(\w+)\}$/)?.[1];
    const value = key ? values[key] : null;
    if (value == null) out.append(part);
    else out.append(value);
  });
  return out;
}

/* Names arrive as "Surname, Given name[, title]" (catalog order):
   "Pardo Bazán, Emilia, condesa de" is displayed as "Emilia Pardo Bazán". */
export function displayName(name) {
  if (isAnonymous(name)) return authorLabel(name);
  const parts = name.split(", ");
  return parts.length >= 2 ? `${parts[1]} ${parts[0]}` : name;
}

/* Works without an author arrive as "Anonymous" (the `anonymous` person in
   the content store, or Gutenberg's author): display it in the interface language. */
export const isAnonymous = (name) => /^anonymous$/i.test(name?.trim() ?? "");

export function authorLabel(name) {
  return isAnonymous(name) ? t("work.anonymous", "Anónimo") : name;
}

function textCover({ title, author, language }) {
  const fallback = element("span", "cover-frame__placeholder cover--text");
  fallback.setAttribute("aria-hidden", "true");
  fallback.append(element("span", "cover__title", title || "Scrollia"));
  if (author) fallback.append(element("span", "cover__author", authorLabel(author)));
  return language ? inLang(fallback, language) : fallback;
}

/* The typographic cover holds the space while the image loads and remains as
   a fallback if both the publisher cover and the original artwork fail. */
export function bookCover(work, className, lazy) {
  const frame = element("span", `cover-frame ${className}`.trim());
  frame.append(textCover(work));

  const img = element("img", "cover-frame__image");
  img.crossOrigin = "anonymous";
  img.alt = "";
  img.width = 1200;
  img.height = 1800;
  img.decoding = "async";
  if (lazy) img.loading = "lazy";
  img.addEventListener("load", () => frame.classList.add("is-loaded"));
  img.addEventListener("error", () => {
    if (work.originalCover && !img.dataset.fallbackUsed) {
      img.dataset.fallbackUsed = "true";
      img.src = work.originalCover;
    } else {
      img.remove();
    }
  });
  frame.append(img);
  if (work.cover || work.originalCover) {
    if (!work.cover) img.dataset.fallbackUsed = "true";
    img.src = work.cover || work.originalCover;
  } else {
    img.remove();
  }
  return frame;
}

/* Book card: the whole card links to the work page, providing one large target.
   `work` = { id, title, author, language, cover, originalCover?, titleLang? }.
   titleLang is the UI label language when it differs from the book language. */
export function bookCard(work) {
  const titleLang = work.titleLang || work.language;
  const link = element("a", "book");
  link.href = `book.html?id=${work.id}${work.editionLang ? `&lang=${work.editionLang}` : ""}`;
  link.append(bookCover({ ...work, language: titleLang }, "book__cover", true));
  link.append(inLang(element("p", "book__lang", endonym(work.language)), work.language));
  link.append(inLang(element("h3", "book__title", work.title), titleLang));
  if (work.author) {
    const author = element("p", "book__author", authorLabel(work.author));
    link.append(isAnonymous(work.author) ? author : inLang(author, work.language));
  }
  return link;
}

/* Mark a node with the book's language so typography and direction match the text. */
export function inLang(node, lang) {
  node.lang = lang;
  node.dir = "auto";
  return node;
}
