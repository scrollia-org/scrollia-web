/* Scrollia · "Continue reading". Books in progress come from this browser's
   saved positions, so the rail renders offline. The section is absent when empty. */

import { API, percent, element, inLang, readingList, readingProgress, saveReadingProgress, readerUrl, FINISHED, bookCover } from "./api.js";

const MAX = 10;

const section = document.querySelector(".continue");
const rail = section.querySelector(".continue__rail");

/* If a cover is unavailable offline, title and author fill its space. */
function cover(entry) {
  return bookCover({
    cover: entry.cover || `${API}/covers/${entry.edition}.jpg`,
    title: entry.title,
    author: entry.author,
    language: entry.language,
  }, "continue__cover", false);
}

function card(entry) {
  const link = element("a", "continue__book");
  link.href = readerUrl(entry.work, entry.edition);
  link.append(cover(entry));

  const line = element("span", "continue__progress");
  const fill = element("span");
  fill.style.inlineSize = `${entry.fraction * 100}%`;
  line.append(fill);
  link.append(line);

  link.append(element("span", "continue__percent", percent(entry.fraction)));
  link.append(inLang(element("span", "continue__title", entry.title), entry.language));
  if (entry.author) link.append(inLang(element("span", "continue__author", entry.author), entry.language));

  const item = element("li");
  item.append(link);
  return item;
}

function render() {
  const reading = readingList().filter((r) => r.fraction < FINISHED).slice(0, MAX);
  section.hidden = !reading.length;
  rail.replaceChildren(...reading.map(card));
}

let refreshing = false;

async function refresh() {
  if (refreshing) return;
  const reading = readingList().filter((r) => r.fraction < FINISHED).slice(0, MAX);
  if (!reading.length) return;
  refreshing = true;
  try {
    const res = await fetch(`${API}/books?ids=${reading.map((entry) => entry.edition).join(",")}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const covers = new Map();
    for (const book of data.results) {
      covers.set(book.id, book.formats?.["image/jpeg"]);
      for (const edition of book.editions ?? []) {
        covers.set(edition.id, edition.formats?.["image/jpeg"]);
      }
    }
    for (const entry of reading) {
      const cover = covers.get(entry.edition);
      const latest = readingProgress(entry.edition);
      if (!cover || !latest || latest.cover === cover) continue;
      saveReadingProgress(entry.edition, { ...latest, cover });
    }
    render();
  } catch (_) {
    // Keep the last saved cover available offline.
  } finally {
    refreshing = false;
  }
}

document.addEventListener("scrollia:lang", render);
addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  render();
  refresh();
});

render();
refresh();
