/* Carrel's service worker: keeps the app and your study sets on the phone for when the PC is out of reach.
   App files and course data: the network first (so a change on the PC shows up at once), the saved copy when offline.
   Lecture PDFs: the saved copy first (they do not change), saved the first time you open one.
   The live API (progress sync, Claude, Canvas, Outlook) is never cached. */
'use strict';
const SHELL = 'carrel-shell-v2';
const SLIDES = 'carrel-slides-v1';
const MAX_SLIDES = 80;
const KEEP_API = ['/api/vault', '/api/notes', '/api/note', '/api/newdecks'];

self.addEventListener('install', (e) => {
  // the page and everything it loads, read from index.html so the list never goes stale
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    const res = await fetch('./', { cache: 'no-store' });
    const html = await res.clone().text();
    await cache.put('./', res);
    const urls = [...html.matchAll(/(?:src|href)="([^"#:]+?)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('data:'));
    urls.push('manifest.webmanifest', 'data/slidetext.js', 'vendor/pdfjs/pdf.worker.min.js');
    await Promise.all(urls.map((u) => cache.add(u).catch(() => null)));
    // what the stylesheets pull in: @import-ed sheets (the design tokens), KaTeX's fonts and the typefaces
    for (const css of urls.filter((u) => u.endsWith('.css'))) {
      try {
        const t = await (await fetch(css)).text();
        const base = css.slice(0, css.lastIndexOf('/') + 1);
        const deps = [...t.matchAll(/@import\s+(?:url\()?["']([^"']+)["']/g), ...t.matchAll(/url\(["']?([^"')]+\.woff2)["']?\)/g)].map((m) => base + m[1]);
        await Promise.all(deps.map((u) => cache.add(u).catch(() => null)));
      } catch (err) { /* offline at install: they are saved as they are used */ }
    }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (![SHELL, SLIDES].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const path = url.pathname;
  if (path.startsWith('/vault/')) return e.respondWith(slide(req));
  if (path.startsWith('/api/')) {
    if (KEEP_API.includes(path)) e.respondWith(networkFirst(req, SHELL));
    return; // everything else on the API is live only
  }
  if (req.mode === 'navigate') return e.respondWith(networkFirst(new Request('./'), SHELL));
  e.respondWith(networkFirst(req, SHELL));
});

async function networkFirst(req, name) {
  const cache = await caches.open(name);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok && res.status === 200) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    return new Response('Offline, and not saved on this device yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

async function slide(req) {
  const cache = await caches.open(SLIDES);
  const key = new Request(req.url.split('#')[0]);
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.status === 200) {
    await cache.put(key, res.clone());
    const keys = await cache.keys();
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_SLIDES))) await cache.delete(old);
  }
  return res;
}
