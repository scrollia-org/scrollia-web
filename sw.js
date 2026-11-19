/* Scrollia · offline reading. Network first, always: online content stays fresh.
   Offline, serve the last visited web pages, work pages and catalogs, and above
   all opened books. The reader requests stable EPUB byte ranges; each chunk is
   cached with its range so a book opened once can be reopened offline. */

const VERSION = "scrollia-v4";
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;

const PRECACHE = [
  "./",
  "index.html", "catalog.html", "book.html", "read.html", "privacy/",
  "styles.css", "tokens.css", "fonts.css",
  "assets/fonts/OFL-1.1.txt", "assets/fonts/FONT-NOTICES.txt",
  "i18n.js", "app.js", "api.js", "catalog.js", "continue.js", "browse.js",
  "book.js", "read.js", "epub.js",
  "lang/es.json", "lang/en.json", "lang/fr.json", "lang/de.json", "lang/pt.json", "lang/zh.json",
  "assets/fonts/fraunces-medium.woff2", "assets/fonts/fraunces-medium-italic.woff2",
  "assets/fonts/fraunces-semibold.woff2", "assets/fonts/inter-regular.woff2",
  "assets/fonts/inter-medium.woff2", "assets/fonts/literata-regular.woff2",
  "assets/fonts/literata-italic.woff2", "assets/fonts/literata-medium.woff2",
  "assets/icons/favicon.svg", "assets/icons/favicon-32.png", "assets/icons/apple-touch-icon.png",
  "site.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (!key.startsWith(VERSION)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

/* Cache API cannot store 206 responses: cache each chunk as 200 under a
   range-specific URL, then return the 206 response requested by the reader. */
function rangeKey(request) {
  const url = new URL(request.url);
  url.searchParams.set("scrollia-range", request.headers.get("Range"));
  return url.href;
}

/* A book caches chunks from one file version only. When an edition changes,
   delete old chunks before storing new ones, or offline reading could mix one
   version's index with another's text. Version by modification date and size;
   Last-Modified is exposed cross-origin by the API, while ETag is not. */
async function keepOneVersion(cache, request, response) {
  const book = request.url.split("?")[0];
  const marker = `${book}?scrollia-version`;
  const version = `${response.headers.get("Last-Modified") ?? ""}|${(response.headers.get("Content-Range") ?? "").split("/")[1] ?? ""}`;
  const stored = await cache.match(marker);
  if (stored && (await stored.text()) === version) return;
  for (const old of await cache.keys()) {
    if (old.url.startsWith(`${book}?scrollia-range=`)) await cache.delete(old);
  }
  await cache.put(marker, new Response(version));
}

/* The reader requests several chunks concurrently: save them sequentially so
   one chunk's cleanup cannot delete another newly saved chunk of the same version. */
let writes = Promise.resolve();

async function epubRange(request) {
  const cache = await caches.open(DATA);
  const key = rangeKey(request);
  try {
    const response = await fetch(request);
    if (response.status === 206) {
      const body = await response.clone().arrayBuffer();
      const write = writes.then(async () => {
        await keepOneVersion(cache, request, response);
        await cache.put(key, new Response(body, {
          headers: {
            "Content-Type": response.headers.get("Content-Type") ?? "application/epub+zip",
            "Content-Range": response.headers.get("Content-Range") ?? "",
          },
        }));
      });
      writes = write.catch(() => {});
      await write;
    }
    return response;
  } catch (error) {
    const cached = await cache.match(key);
    if (!cached) throw error;
    return new Response(cached.body, {
      status: 206,
      headers: {
        "Content-Type": cached.headers.get("Content-Type"),
        "Content-Range": cached.headers.get("Content-Range"),
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Content-Range",
      },
    });
  }
}

/* Cache local files without query strings: book.html?id=1342 and ?id=2000 are
   the same file, while styles.css?v=2 is styles.css under another cache key. */
async function networkFirst(request, cacheName, ignoreSearch) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(ignoreSearch ? request.url.split("?")[0] : request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch });
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(DATA);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin) {
    event.respondWith(networkFirst(request, SHELL, true));
    return;
  }
  if (url.pathname.startsWith("/download/") && request.headers.has("Range")) {
    event.respondWith(epubRange(request));
  } else if (/\/(covers\/\d+|works\/\d+\/cover)\.jpg$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  } else if (/^\/(site|books|works\/\d+)$/.test(url.pathname)) {
    event.respondWith(networkFirst(request, DATA, false));
  }
});
