<p align="center">
  <img src="assets/icons/icon-192.png" alt="Scrollia icon" width="128">
</p>

# Scrollia Web

A free, multilingual web library and EPUB reader for public-domain classics.

Scrollia is named for the **scroll**, the form that carried the written word for millennia before the printed book.

## Features

- A curated catalog powered by the Scrollia API, with no hardcoded titles or catalog counts
- Work pages with edition and language selection
- An in-browser EPUB reader that fetches only the content being read through HTTP byte ranges
- Continue-reading progress stored locally in the browser
- Offline access to visited pages and opened books
- English, Spanish, French, German, Portuguese, and Chinese interfaces
- Responsive layouts, dark mode, and self-hosted fonts
- No framework, package install, analytics, ads, or build step

## Local development

Clone the repository and serve its root with any static HTTP server:

```bash
git clone https://github.com/scrollia-org/scrollia-web.git
cd scrollia-web
python3 -m http.server 8080
```

Open <http://localhost:8080>. On `localhost` and `127.0.0.1`, the client expects a compatible Scrollia API at `http://127.0.0.1:8000`; other deployments use the `scrollia-api` meta tag in each HTML page.

The API must support cross-origin requests and EPUB byte ranges, including `Range` request headers and exposed `Content-Range` response headers.

## Content and API

- `GET /site` supplies catalog counts, languages, and the landing-page shelf.
- `GET /books` supplies the searchable catalog.
- `GET /works/{id}` supplies each work page.
- `GET /download/{id}.epub` supplies the reader's EPUB.

Curating content must not require changing the web client. Do not hardcode catalog titles, language counts, or work counts.

## Offline support

Every new runtime file (HTML, JavaScript, CSS, translation, font, or image) must also be added to `PRECACHE` in `sw.js`, or it will not be available offline. Files under `tools/` are development-only and are not precached.

The service worker uses a network-first strategy. EPUB chunks are cached by byte range and file version so an opened book remains readable offline.

## Screenshots

The dependency-free screenshot tool requires Node.js 22 or newer and Firefox:

```bash
node tools/screenshot.mjs http://localhost:8080 /tmp/scrollia-home
```

Set `LANGS="it, en"` to simulate browser language preferences, `FULL=1` for a full-page capture, or `W` and `H` for the viewport size.

## License

The web client is licensed under the [MIT License](LICENSE). Use, modification,
redistribution, and commercial use are permitted, provided that the copyright
and license notices are retained.

```text
Copyright (c) 2026 Oscar A. Virguez
```

The bundled fonts retain their SIL Open Font License; see [FONT-NOTICES.txt](assets/fonts/FONT-NOTICES.txt) and [OFL-1.1.txt](assets/fonts/OFL-1.1.txt). Book texts, edition metadata, and cover artwork are served by the API and are not part of this repository.
