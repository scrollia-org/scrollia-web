// Regenerate sitemap.xml from a live Scrollia API (dev / web-only clone).
// Production deploys use `python3 -m pipeline.sitemap` from the monorepo
// (scripts/deploy-prod.sh) so the file always matches scrollia.db.
// Development tool (not in sw.js PRECACHE).
//
//   API=http://127.0.0.1:8000 node tools/sitemap.mjs
//
// Writes apps/scrollia-web/sitemap.xml with home, catalog, FAQ, privacy,
// and one URL per work id from GET /books (paginated).

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const api = (process.env.API || "http://127.0.0.1:8000").replace(/\/$/, "");
const site = (process.env.SITE || "https://scrollia.org").replace(/\/$/, "");
const today = new Date().toISOString().slice(0, 10);

async function allWorkIds() {
  const ids = [];
  let page = 1;
  for (;;) {
    const url = `${api}/books?page=${page}&page_size=50`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
    const data = await res.json();
    for (const book of data.results ?? []) {
      if (book?.id != null) ids.push(Number(book.id));
    }
    if (!data.next) break;
    page += 1;
  }
  return [...new Set(ids)].sort((a, b) => a - b);
}

function escape(url) {
  return url.replace(/&/g, "&amp;");
}

function urlEntry(loc, { lastmod = today, changefreq = "weekly", priority = "0.8" } = {}) {
  return `  <url>
    <loc>${escape(loc)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

const ids = await allWorkIds();
const parts = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  urlEntry(`${site}/`, { changefreq: "weekly", priority: "1.0" }),
  urlEntry(`${site}/catalog.html`, { changefreq: "daily", priority: "0.9" }),
  urlEntry(`${site}/faq/`, { changefreq: "monthly", priority: "0.5" }),
  urlEntry(`${site}/privacy/`, { changefreq: "monthly", priority: "0.3" }),
  urlEntry(`${site}/llms.txt`, { changefreq: "monthly", priority: "0.2" }),
  ...ids.map((id) => urlEntry(`${site}/book.html?id=${id}`, { changefreq: "weekly", priority: "0.8" })),
  "</urlset>",
  "",
];

const out = join(root, "sitemap.xml");
writeFileSync(out, parts.join("\n"));
console.log(`Wrote ${out} (${ids.length} works from ${api})`);
