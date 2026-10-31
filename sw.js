// Bump VERSION to ship an update. Every file is cached at install and served from the cache only.
const VERSION = 'v5';
const FONTS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'].flatMap((f) =>
  ['0-255', '256-511', '8192-8447'].map((r) => `map/fonts/${f}/${r}.pbf`));
const FILES = [
  './', 'index.html', 'style.css', 'app.js', 'data.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png',
  'vendor/maplibre-gl.mjs', 'vendor/maplibre-gl-worker.mjs', 'vendor/maplibre-gl.css', 'vendor/pmtiles.js',
  'map/hague.pmtiles', 'map/layers.json',
  'map/sprites/grayscale.json', 'map/sprites/grayscale.png', 'map/sprites/grayscale@2x.json', 'map/sprites/grayscale@2x.png',
  'fonts/overpass-latin.woff2',
  ...FONTS,
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', (e) => e.data === 'skipWaiting' && self.skipWaiting());

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.open(VERSION)
    .then((c) => c.match(e.request, { ignoreSearch: true }))
    .then((r) => r || fetch(e.request)));
});
