// Every file of the build is cached at install and served from the cache only, so the site works offline.
// Each build gets a new version; open pages show a "tap to update" banner that activates it.
import { self } from '$app/service-worker';
import { immutable, assets, prerendered } from '$app/manifest';
import { version } from '$app/env';

const CACHE = `cache-${version}`;
const FILES = ['', ...[...immutable, ...assets, ...prerendered].map((f) => f.path)]
  .map((p) => new URL(p.replace(/^\//, ''), self.registration.scope).href);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([...new Set(FILES)].map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', (e) => e.data === 'skipWaiting' && self.skipWaiting());

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.open(CACHE)
    .then((c) => c.match(e.request, { ignoreSearch: true }))
    .then((r) => r || fetch(e.request)));
});
