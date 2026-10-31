// Every file of the build is cached at install and served from the cache only, so the site works offline.
// Each build gets a new version; open pages show a "tap to update" banner that activates it.
import { self } from '$app/service-worker';
import { immutable, assets, prerendered } from '$app/manifest';
import { version } from '$app/env';

const CACHE = `cache-${version}`;
const paths = ['', ...[...immutable, ...assets, ...prerendered].map((f) => f.path)];
const FILES = [...new Set(paths.map((p) => new URL(p.replace(/^\//, ''), self.registration.scope).href))];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => e.data === 'skipWaiting' && self.skipWaiting());

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith((async () => {
    const cached = await (await caches.open(CACHE)).match(e.request, { ignoreSearch: true });
    return cached ?? fetch(e.request);
  })());
});
