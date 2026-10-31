import * as maplibregl from './vendor/maplibre-gl.mjs';
import data from './data.js';

// Open chunks are shaded by minutes until they close: signage blue far off, orange when close.
const RAMP = [[0, '#ff5a00'], [30, '#ffb000'], [90, '#3d8bd9'], [240, '#1c4e8a']];
const TAPE = '#e30613', GONE = '#9aa0a6';

// Where a closure stands at time `now`: its state and the next change.
function status(c, now) {
  const close = Date.parse(c.close), open = Date.parse(c.open);
  if (now < close) return { state: 'open', next: close, text: 'closes in', mins: (close - now) / 60e3 };
  if (now < open) return { state: 'closed', next: open, text: 'opens in', mins: (open - now) / 60e3 };
  return { state: 'done', next: Infinity, text: 'reopened', mins: 0 };
}

function rampColor(mins) {
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const j = RAMP.findIndex(([m]) => mins <= m);
  if (j === -1) return RAMP.at(-1)[1];
  if (j === 0) return RAMP[0][1];
  const [[m0, c0], [m1, c1]] = [RAMP[j - 1], RAMP[j]];
  const t = (mins - m0) / (m1 - m0), a = hex(c0), b = hex(c1);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
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
  const chunks = (now) => ({
    type: 'FeatureCollection',
    features: data.closures.map((c, i) => {
      const st = status(c, now);
      return line(c.line, { i, state: st.state, mins: st.mins });
    }),
  });
  const round = { 'line-join': 'round', 'line-cap': 'round' };
  const state = (s) => ['==', ['get', 'state'], s];
  const other = { 'line-color': '#8a7bb0', 'line-width': 2, 'line-dasharray': [2.5, 1.5] };

  // The course layers are part of the initial style, so they draw with the first frame.
  const bounds = data.routes.marathon.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds());
  const map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      glyphs: base + 'map/fonts/{fontstack}/{range}.pbf',
      sprite: base + 'map/sprites/grayscale',
      sources: {
        protomaps: { type: 'vector', url: 'pmtiles://hague', attribution: '© OpenStreetMap, Protomaps' },
        '10k': { type: 'geojson', data: line(data.routes['10k']) },
        '5k': { type: 'geojson', data: line(data.routes['5k']) },
        marathon: { type: 'geojson', data: line(data.routes.marathon) },
        chunks: { type: 'geojson', data: chunks(Date.now()) },
      },
      layers: [
        ...layers,
        { id: '10k', type: 'line', source: '10k', paint: other },
        { id: '5k', type: 'line', source: '5k', paint: other },
        { id: 'casing', type: 'line', source: 'marathon', layout: round, paint: { 'line-color': '#fff', 'line-width': 11 } },
        { id: 'open', type: 'line', source: 'chunks', filter: state('open'), layout: round, paint: {
          'line-color': ['interpolate', ['linear'], ['get', 'mins'], ...RAMP.flat()], 'line-width': 6,
        } },
        { id: 'done', type: 'line', source: 'chunks', filter: state('done'), layout: round,
          paint: { 'line-color': GONE, 'line-width': 4 } },
        { id: 'closed', type: 'line', source: 'chunks', filter: state('closed'), paint: { 'line-color': TAPE, 'line-width': 7 } },
        { id: 'closed-stripes', type: 'line', source: 'chunks', filter: state('closed'),
          paint: { 'line-color': '#fff', 'line-width': 7, 'line-dasharray': [1, 1] } },
      ],
    },
    bounds,
    fitBoundsOptions: { padding: { top: 60, right: 30, bottom: 100, left: 30 } },
    maxBounds: [[4.05, 51.93], [4.45, 52.18]],
    attributionControl: { compact: true },
  });
  document.getElementById('loading').remove();
  map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }));
  map.on('load', () => update());

  const sheet = document.getElementById('sheet');
  const handle = document.getElementById('handle');
  const expand = (open) => {
    sheet.classList.toggle('collapsed', !open);
    handle.setAttribute('aria-expanded', open);
  };
  handle.onclick = () => expand(sheet.classList.contains('collapsed'));

  const rows = document.getElementById('rows');
  const items = data.closures.map((c) => {
    const badge = document.createElement('div');
    badge.className = 'badge';
    new maplibregl.Marker({ element: badge }).setLngLat(c.label).addTo(map);
    const li = document.createElement('li');
    li.innerHTML = '<span class="swatch"></span><span class="streets"></span><span class="left"></span><span class="when"></span>';
    li.querySelector('.streets').textContent = c.streets;
    li.querySelector('.when').textContent = `Closed ${hhmm(c.close)} to ${hhmm(c.open)}`;
    li.onclick = () => {
      expand(false);
      map.flyTo({ center: c.label, zoom: 14, padding: { bottom: 80 } });
    };
    return { c, badge, li };
  });

  for (const id of ['open', 'done', 'closed']) {
    map.on('click', id, (e) => {
      const { li } = items[e.features[0].properties.i];
      expand(true);
      for (const it of items) it.li.classList.toggle('flash', it.li === li);
      li.scrollIntoView({ block: 'center' });
    });
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
  }

  function update() {
    const now = Date.now();
    document.getElementById('clock').textContent = clockFmt.format(now);
    map.getSource('chunks')?.setData(chunks(now));
    const sorted = items.map((it) => ({ ...it, st: status(it.c, now) })).sort((a, b) => a.st.next - b.st.next || a.c.n - b.c.n);
    for (const { c, badge, li, st } of sorted) {
      const t = left(st.next - now);
      badge.hidden = st.state !== 'closed';
      badge.textContent = t;
      const swatch = li.querySelector('.swatch');
      swatch.classList.toggle('tape', st.state === 'closed');
      swatch.style.background = st.state === 'open' ? rampColor(st.mins) : st.state === 'done' ? GONE : '';
      li.classList.toggle('done', st.state === 'done');
      li.querySelector('.left').innerHTML = st.state === 'done' ? '<small>reopened</small>' : `<small>${st.text}</small>${t}`;
      rows.appendChild(li);
    }
    const closed = sorted.filter((it) => it.st.state === 'closed').length;
    const upcoming = sorted.find((it) => it.st.state !== 'done');
    document.getElementById('summary').textContent =
      closed ? `${closed} of ${items.length} roads closed` : upcoming ? 'All roads open' : 'All roads reopened';
    document.getElementById('next').textContent = upcoming
      ? `Next: ${upcoming.c.streets.split(' / ')[0]} ${upcoming.st.text} ${left(upcoming.st.next - now)}`
      : 'The marathon is over. Drive safe.';
  }
  update();
  setInterval(update, 30e3);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && update());
}

start();
