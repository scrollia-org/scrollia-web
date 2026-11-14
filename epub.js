/* Scrollia · dependency-free remote EPUB reader using byte ranges.
   An EPUB is a ZIP: request the central directory at the end, then only the
   book's XHTML. Images load as they approach the viewport: Monte Cristo's
   illustrated EPUB is 82 MB, while its text is 1.2 MB. */

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const TAIL = 22 + 0xffff; // End of central directory plus maximum comment size
const SLACK = 1024; // A local header's extra field can exceed the central header's
const GAP = 64 * 1024; // Entries closer than this share one request

export class BookError extends Error {
  constructor(kind) {
    super(kind);
    this.kind = kind; // "notFound" | "offline" | "error"
  }
}

class RemoteZip {
  constructor(url) {
    this.url = url;
    this.entries = new Map();
    this.whole = null;
  }

  async get(range) {
    const res = await fetch(this.url, { headers: { Range: range } }).catch(() => {
      throw new BookError("offline");
    });
    if (res.status === 404) throw new BookError("notFound");
    if (!res.ok) throw new BookError("error");
    const buf = new Uint8Array(await res.arrayBuffer());
    if (res.status === 200) {
      this.whole = buf;
      return { buf, start: 0 };
    }
    const match = res.headers.get("Content-Range")?.match(/bytes (\d+)-/);
    if (!match) throw new BookError("error");
    return { buf, start: Number(match[1]) };
  }

  async bytes(start, end) {
    if (this.whole) return this.whole.subarray(start, end);
    return (await this.get(`bytes=${start}-${end - 1}`)).buf;
  }

  async open() {
    const { buf, start } = await this.get(`bytes=-${TAIL}`);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let at = buf.length - 22;
    while (at >= 0 && view.getUint32(at, true) !== EOCD) at--;
    if (at < 0) throw new BookError("error");

    const count = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 12, true);
    const offset = view.getUint32(at + 16, true);
    const dir = offset >= start
      ? buf.subarray(offset - start, offset - start + size)
      : await this.bytes(offset, offset + size);

    const d = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
    const utf8 = new TextDecoder();
    let p = 0;
    for (let i = 0; i < count && d.getUint32(p, true) === CENTRAL; i++) {
      const nameLength = d.getUint16(p + 28, true);
      const extraLength = d.getUint16(p + 30, true);
      const commentLength = d.getUint16(p + 32, true);
      const name = utf8.decode(dir.subarray(p + 46, p + 46 + nameLength));
      this.entries.set(name, {
        name,
        method: d.getUint16(p + 10, true),
        compressed: d.getUint32(p + 20, true),
        offset: d.getUint32(p + 42, true),
        span: 30 + nameLength + extraLength + d.getUint32(p + 20, true) + SLACK,
      });
      p += 46 + nameLength + extraLength + commentLength;
    }
  }

  has(name) {
    return this.entries.has(name);
  }

  /* Read several entries by combining contiguous ones into a single request. */
  async readMany(names) {
    const wanted = names.map((n) => this.entries.get(n)).filter(Boolean)
      .sort((a, b) => a.offset - b.offset);
    const groups = [];
    for (const entry of wanted) {
      const last = groups.at(-1);
      if (last && entry.offset <= last.end + GAP) {
        last.items.push(entry);
        last.end = Math.max(last.end, entry.offset + entry.span);
      } else {
        groups.push({ start: entry.offset, end: entry.offset + entry.span, items: [entry] });
      }
    }

    const out = new Map();
    for (const group of groups) {
      const buf = await this.bytes(group.start, group.end);
      for (const entry of group.items) {
        out.set(entry.name, await this.extract(entry, buf, group.start));
      }
    }
    return out;
  }

  async read(name) {
    return (await this.readMany([name])).get(name);
  }

  async extract(entry, buf, start) {
    let o = entry.offset - start;
    let view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (view.getUint32(o, true) !== LOCAL) throw new BookError("error");
    const dataStart = o + 30 + view.getUint16(o + 26, true) + view.getUint16(o + 28, true);
    let data = buf.subarray(dataStart, dataStart + entry.compressed);
    if (data.length < entry.compressed) {
      const from = entry.offset + (dataStart - o);
      data = await this.bytes(from, from + entry.compressed);
    }
    if (entry.method === 0) return data;
    if (entry.method !== 8) throw new BookError("error");
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
}

/* ---------- OPF, table of contents and XHTML ---------- */

const DC = "http://purl.org/dc/elements/1.1/";
const RTL = ["ar", "he", "fa", "ur", "yi"];

function parse(bytes, type = "application/xhtml+xml") {
  const text = new TextDecoder().decode(bytes);
  const doc = new DOMParser().parseFromString(text, type);
  if (type !== "text/html" && doc.getElementsByTagName("parsererror").length) {
    return parse(bytes, "text/html");
  }
  return doc;
}

/* ZIP path for `href`, relative to the `from` file. */
function resolve(from, href) {
  const url = new URL(href, `https://epub/${from}`);
  return { path: decodeURIComponent(url.pathname.slice(1)), hash: decodeURIComponent(url.hash.slice(1)) };
}

const clean = (s) => s.replace(/\s+/g, " ").trim();

function navEntries(doc, from) {
  const navs = [...doc.getElementsByTagName("nav")];
  const nav = navs.find((n) => /\btoc\b/.test(n.getAttribute("epub:type") ?? "")) ?? navs[0];
  if (!nav) return [];
  return [...nav.getElementsByTagName("a")].map((a) => {
    let depth = 0;
    for (let n = a.parentElement; n && n !== nav; n = n.parentElement) {
      if (n.localName === "ol" || n.localName === "ul") depth++;
    }
    return { label: clean(a.textContent), ...resolve(from, a.getAttribute("href") ?? ""), depth: depth - 1 };
  });
}

function ncxEntries(doc, from) {
  return [...doc.getElementsByTagName("navPoint")].map((point) => {
    let depth = 0;
    for (let n = point.parentElement; n?.localName === "navPoint"; n = n.parentElement) depth++;
    const label = point.getElementsByTagName("text")[0]?.textContent ?? "";
    const src = point.getElementsByTagName("content")[0]?.getAttribute("src") ?? "";
    return { label: clean(label), ...resolve(from, src), depth };
  });
}

export async function openBook(url) {
  const zip = new RemoteZip(url);
  await zip.open();

  const container = parse(await zip.read("META-INF/container.xml"), "application/xml");
  const opfPath = container.getElementsByTagName("rootfile")[0]?.getAttribute("full-path");
  if (!opfPath || !zip.has(opfPath)) throw new BookError("error");
  const opf = parse(await zip.read(opfPath), "application/xml");

  const manifest = new Map();
  for (const item of opf.getElementsByTagName("item")) {
    manifest.set(item.getAttribute("id"), {
      path: resolve(opfPath, item.getAttribute("href")).path,
      type: item.getAttribute("media-type") ?? "",
      properties: item.getAttribute("properties") ?? "",
    });
  }

  const spineNode = opf.getElementsByTagName("spine")[0];
  const spine = [...opf.getElementsByTagName("itemref")]
    .filter((ref) => ref.getAttribute("linear") !== "no")
    .map((ref) => manifest.get(ref.getAttribute("idref")))
    .filter((item) => item && /html/.test(item.type) && !/\bnav\b/.test(item.properties));

  const navItem = [...manifest.values()].find((i) => /\bnav\b/.test(i.properties));
  const ncxItem = manifest.get(spineNode?.getAttribute("toc"));
  const tocPath = navItem?.path ?? ncxItem?.path;

  const files = await zip.readMany([...spine.map((i) => i.path), tocPath].filter(Boolean));
  const sections = spine
    .filter((item) => files.has(item.path))
    .map((item) => ({ path: item.path, doc: parse(files.get(item.path)) }));

  let toc = [];
  if (navItem && files.has(navItem.path)) toc = navEntries(parse(files.get(navItem.path)), navItem.path);
  else if (ncxItem && files.has(ncxItem.path)) toc = ncxEntries(parse(files.get(ncxItem.path), "application/xml"), ncxItem.path);

  const language = opf.getElementsByTagNameNS(DC, "language")[0]?.textContent.trim() ?? "";
  const rtl = spineNode?.getAttribute("page-progression-direction") === "rtl"
    || RTL.includes(language.split("-")[0]);

  return {
    title: clean(opf.getElementsByTagNameNS(DC, "title")[0]?.textContent ?? ""),
    author: clean(opf.getElementsByTagNameNS(DC, "creator")[0]?.textContent ?? ""),
    language,
    dir: rtl ? "rtl" : "ltr",
    sections,
    toc,
    has: (path) => zip.has(path),
    image: async (path) => {
      const type = [...manifest.values()].find((i) => i.path === path)?.type ?? "";
      return URL.createObjectURL(new Blob([await zip.read(path)], { type }));
    },
  };
}

/* ---------- Book XHTML → page DOM ---------- */

/* Keep structure and emphasis only; no EPUB classes, styles or scripts: the
   reader controls typography, not each edition. Footnote references (Gutenberg:
   class="fnanchor"; Standard Ebooks: epub:type="noteref") and their return
   links retain only the reference mark. */
const KEEP = new Set(`p h1 h2 h3 h4 h5 h6 hgroup blockquote ul ol li dl dt dd table thead tbody
  tfoot tr td th caption pre hr br figure figcaption a i em b strong small sup sub
  cite abbr q code s del ins u mark ruby rt rp img var dfn bdi bdo time`.split(/\s+/));
const BLOCKS = new Set("div section article aside header footer main center".split(" "));
const DROP = new Set(`head script style link meta title svg math nav iframe object embed
  form input button select textarea audio video source template noscript`.split(/\s+/));

/* Remove Gutenberg headers and licenses (the work page credits the source)
   and print-edition page numbers: they interrupt continuous reading. */
function isBoilerplate(el) {
  const id = el.getAttribute("id") ?? "";
  const cls = el.getAttribute("class") ?? "";
  return /^pg-(header|footer)$/.test(id)
    || /\b(pg-boilerplate|x-ebookmaker-pageno|pagenum|pageno)\b/.test(cls);
}

/* Gutenberg image drop caps: expose their letter as text, not a decorative image. */
function isDropCap(el) {
  const alt = (el.getAttribute("alt") ?? "").trim();
  return alt.length === 1 && el.closest?.("p") != null;
}

/* Black-line engravings on transparency (Standard Ebooks vocabulary, also used
   by Scrollia editions) are inverted in dark themes. */
function isLineArt(el, src) {
  const marks = `${el.getAttribute("epub:type") ?? ""} ${el.getAttribute("class") ?? ""}`;
  return src.endsWith(".svg") || /black-on-transparent/.test(marks);
}

/* Standard Ebooks verse indentation (<span class="i1">…</span>) is the only
   EPUB class retained because it shapes the poem. */
function verseIndent(el) {
  return /^i([1-9])$/.exec((el.getAttribute("class") ?? "").trim())?.[1];
}

export function renderSection(book, index, onImage) {
  const { path, doc } = book.sections[index];
  const indexOf = new Map(book.sections.map((s, i) => [s.path, i]));
  const anchor = (i, id) => (id ? `s${i}-${id}` : `s${i}`);

  function convert(node, out) {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        out.append(child.data);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const name = child.localName.toLowerCase();
      if (DROP.has(name) || isBoilerplate(child)) continue;

      if (name === "img") {
        if (isDropCap(child)) {
          out.append(child.getAttribute("alt").trim());
          continue;
        }
        const src = resolve(path, child.getAttribute("src") ?? "").path;
        if (!book.has(src)) continue;
        const img = document.createElement("img");
        img.alt = child.getAttribute("alt") ?? "";
        img.decoding = "async";
        if (isLineArt(child, src)) img.dataset.lineArt = "";
        onImage(img, src);
        out.append(img);
        continue;
      }

      const indent = name === "span" ? verseIndent(child) : undefined;
      if (indent) {
        const span = document.createElement("span");
        span.dataset.indent = indent;
        convert(child, span);
        out.append(span);
        continue;
      }

      let tag = KEEP.has(name) ? name : BLOCKS.has(name) ? "div" : null;
      const href = name === "a" ? child.getAttribute("href") : null;
      if (tag === "a" && !href) tag = "span";
      if (!tag) {
        convert(child, out);
        continue;
      }

      const el = document.createElement(tag);
      const id = child.getAttribute("id");
      if (id) el.id = anchor(index, id);
      const lang = child.getAttribute("xml:lang") ?? child.getAttribute("lang");
      if (lang) el.lang = lang;
      const dir = child.getAttribute("dir");
      if (dir === "rtl" || dir === "ltr") el.dir = dir;
      for (const attr of ["colspan", "rowspan"]) {
        if (child.hasAttribute(attr)) el.setAttribute(attr, child.getAttribute(attr));
      }

      if (tag === "a") {
        const role = ["epub:type", "role", "class"].map((a) => child.getAttribute(a) ?? "").join(" ");
        if (/\b(noteref|fnanchor)\b/.test(role)) el.dataset.noteref = "";
        if (/\bbacklink\b/.test(role)) el.dataset.backlink = "";
        if (/^(https?:|mailto:)/i.test(href)) {
          el.href = href;
          el.rel = "noopener";
          el.target = "_blank";
        } else {
          const target = resolve(path, href);
          const i = indexOf.get(target.path);
          if (i != null) el.href = `#${anchor(i, target.hash)}`;
        }
      }

      convert(child, el);
      out.append(el);
    }
  }

  const section = document.createElement("section");
  section.id = anchor(index);
  convert(doc.body ?? doc.documentElement, section);
  return section;
}

/* Clean table of contents: omit entries targeting removed content (licenses,
   page numbers such as "{68}") and repeated destinations. */
export function tableOfContents(book, root) {
  const indexOf = new Map(book.sections.map((s, i) => [s.path, i]));
  const seen = new Set();
  const out = [];
  for (const entry of book.toc) {
    const i = indexOf.get(entry.path);
    if (i == null || !entry.label || /^[[{(]?\s*(pg?\.?\s*)?\d+\s*[\]})]?$/i.test(entry.label)) continue;
    const id = entry.hash ? `s${i}-${entry.hash}` : `s${i}`;
    const target = root.ownerDocument.getElementById(id);
    if (!target || !root.contains(target) || seen.has(id)) continue;
    seen.add(id);
    out.push({ label: entry.label, target, depth: Math.max(0, entry.depth) });
  }
  return out;
}
