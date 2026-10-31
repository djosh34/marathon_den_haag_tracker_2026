import * as maplibregl from './vendor/maplibre-gl.mjs';
import data from './data.js';

const COLORS = { open: '#1e9e4a', soon: '#e8a200', closed: '#d62828', done: '#8a8f8c' };
const SOON_MS = 30 * 60e3;

// Where a closure stands at time `now`: its state and the next change.
function status(c, now) {
  const close = Date.parse(c.close), open = Date.parse(c.open);
  if (now < close) return { state: close - now < SOON_MS ? 'soon' : 'open', next: close, text: 'closes in' };
  if (now < open) return { state: 'closed', next: open, text: 'opens in' };
  return { state: 'done', next: Infinity, text: 'reopened' };
}

function left(ms) {
  const m = Math.ceil(ms / 60e3);
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60}m` : `${m}m`;
}

const hhmm = (iso) => iso.slice(11, 16);
const clockFmt = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' });

// Waits until the service worker controls the page, so the big map file is downloaded only once.
async function serviceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  const reg = await navigator.serviceWorker.register('sw.js').catch(() => null);
  if (!reg) return;
  const banner = document.getElementById('update');
  const offer = (sw) => {
    banner.hidden = false;
    banner.onclick = () => sw.postMessage('skipWaiting');
  };
  if (hadController) {
    if (reg.waiting) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw.addEventListener('statechange', () => sw.state === 'installed' && offer(sw));
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
    reg.update().catch(() => {});
    return;
  }
  const sw = reg.installing || reg.waiting || reg.active;
  await new Promise((resolve) => {
    navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
    sw?.addEventListener('statechange', () => sw.state === 'redundant' && resolve());
  });
}

// Serves the whole .pmtiles file from memory, so no HTTP range requests are needed.
class BufferSource {
  constructor(key, buf) { this.key = key; this.buf = buf; }
  getKey() { return this.key; }
  async getBytes(offset, length) { return { data: this.buf.slice(offset, offset + length) }; }
}

async function start() {
  await serviceWorker();
  const base = new URL('.', location.href).href;
  const [buf, layers, worker] = await Promise.all([
    fetch('map/hague.pmtiles').then((r) => r.arrayBuffer()),
    fetch('map/layers.json').then((r) => r.json()),
    fetch('vendor/maplibre-gl-worker.mjs').then((r) => r.blob()),
  ]);
  // WebKit fetches worker scripts past the service worker, so hand MapLibre a blob of the cached copy.
  maplibregl.setWorkerUrl(URL.createObjectURL(new Blob([worker], { type: 'text/javascript' })));
  const protocol = new pmtiles.Protocol();
  protocol.add(new pmtiles.PMTiles(new BufferSource('hague', buf)));
  maplibregl.addProtocol('pmtiles', protocol.tile);

  const line = (coords, props = {}) => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } });
  const closureFeatures = (now) => ({
    type: 'FeatureCollection',
    features: data.closures.map((c) => line(c.line, { state: status(c, now).state })),
  });
  const round = { 'line-join': 'round', 'line-cap': 'round' };

  // The course layers are part of the initial style, so they draw with the first frame.
  const bounds = data.routes.marathon.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds());
  const map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      glyphs: base + 'map/fonts/{fontstack}/{range}.pbf',
      sprite: base + 'map/sprites/light',
      sources: {
        protomaps: { type: 'vector', url: 'pmtiles://hague', attribution: '© OpenStreetMap, Protomaps' },
        '10k': { type: 'geojson', data: line(data.routes['10k']) },
        '5k': { type: 'geojson', data: line(data.routes['5k']) },
        marathon: { type: 'geojson', data: line(data.routes.marathon) },
        closures: { type: 'geojson', data: closureFeatures(Date.now()) },
      },
      layers: [
        ...layers,
        { id: '10k', type: 'line', source: '10k', paint: { 'line-color': '#7a4fb5', 'line-width': 2.5, 'line-dasharray': [2, 1.5] } },
        { id: '5k', type: 'line', source: '5k', paint: { 'line-color': '#2b7bb9', 'line-width': 2.5, 'line-dasharray': [0.5, 1.5] } },
        { id: 'marathon-casing', type: 'line', source: 'marathon', layout: round, paint: { 'line-color': '#fff', 'line-width': 8 } },
        { id: 'marathon', type: 'line', source: 'marathon', layout: round, paint: { 'line-color': '#ef6a1a', 'line-width': 5 } },
        { id: 'closures', type: 'line', source: 'closures', layout: round, paint: {
          'line-color': ['match', ['get', 'state'], 'open', COLORS.open, 'soon', COLORS.soon, 'closed', COLORS.closed, COLORS.done],
          'line-width': 5,
        } },
      ],
    },
    bounds,
    fitBoundsOptions: { padding: 24 },
    maxBounds: [[4.05, 51.93], [4.45, 52.18]],
    attributionControl: { compact: true },
  });
  document.getElementById('loading').remove();
  map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }));
  map.on('load', () => update());

  const rows = document.getElementById('rows');
  const items = data.closures.map((c) => {
    const badge = document.createElement('div');
    badge.className = 'badge';
    const marker = new maplibregl.Marker({ element: badge }).setLngLat(c.label).addTo(map);
    const li = document.createElement('li');
    li.innerHTML = `<span class="num">${c.n}</span><span class="streets"></span><span class="left"></span><span class="sub"></span>`;
    li.querySelector('.streets').textContent = c.streets;
    li.onclick = () => map.flyTo({ center: c.label, zoom: 14 });
    badge.onclick = (e) => {
      e.stopPropagation();
      for (const it of items) it.li.classList.toggle('hl', it.li === li);
      li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    return { c, badge, marker, li };
  });

  function update() {
    const now = Date.now();
    document.getElementById('clock').textContent = clockFmt.format(now);
    map.getSource('closures')?.setData(closureFeatures(now));
    const sorted = items.map((it) => ({ ...it, st: status(it.c, now) })).sort((a, b) => a.st.next - b.st.next || a.c.n - b.c.n);
    for (const { c, badge, li, st } of sorted) {
      const color = COLORS[st.state];
      const t = st.state === 'done' ? '✓' : left(st.next - now);
      badge.textContent = `${c.n} · ${t}`;
      badge.style.background = color;
      li.querySelector('.num').style.background = color;
      li.querySelector('.left').textContent = st.state === 'done' ? '' : t;
      li.querySelector('.left').style.color = color;
      li.querySelector('.sub').textContent = `closed ${hhmm(c.close)}–${hhmm(c.open)} · ${st.text}${st.state === 'done' ? '' : ' ' + t}`;
      rows.appendChild(li);
    }
  }
  update();
  setInterval(update, 30e3);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && update());
}

start();
