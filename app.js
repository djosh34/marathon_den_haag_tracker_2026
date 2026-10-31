import * as maplibregl from './vendor/maplibre-gl.mjs';
import data from './data.js';

// Open chunks are shaded by minutes until they close: signage blue far off, orange when close.
const RAMP = [[0, '#ff5a00'], [30, '#ffb000'], [90, '#3d8bd9'], [240, '#1c4e8a']];
const CLOSED = '#e30613', GONE = '#9aa0a6';

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
const raceDay = (hm) => Date.parse(`2026-11-01T${hm}:00+01:00`);
const MARATHON = 42.195, RANGE = '#ff5a00';

// The runner settings, saved on the phone. Finish times are kept after the start and in order.
function loadRunner() {
  const r = { start: '10:15', from: '14:00', to: '14:30', ...JSON.parse(localStorage.getItem('runner') || '{}') };
  if (r.from <= r.start) r.from = r.start;
  if (r.to < r.from) r.to = r.from;
  return r;
}

// Where the runner can be at `now`, in km, at an even pace between the fastest and slowest finish.
function runnerRange(r, now) {
  const s = raceDay(r.start), f1 = raceDay(r.from), f2 = raceDay(r.to);
  const km = (f) => Math.min(Math.max((now - s) / Math.max(f - s, 60e3), 0), 1) * MARATHON;
  return { s, f1, f2, back: km(f2), front: km(f1) };
}

const pace = (ms) => {
  const sec = Math.round(ms / 1e3 / MARATHON);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};
const kmText = (k) => k.toFixed(1);
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
  const chunks = { type: 'FeatureCollection', features: data.closures.map((c, i) => line(c.line, { i })) };
  // One layer per chunk with constant paint: changing it redraws at once, without re-processing tiles
  // in the worker (after which WebKit does not always repaint).
  const chunkIds = data.closures.map((c, i) => `chunk-${i}`);
  const paint = (c, now) => {
    const st = status(c, now);
    return {
      'line-color': { open: rampColor(st.mins), closed: CLOSED, done: GONE }[st.state],
      'line-width': { open: 4, closed: 4.5, done: 3 }[st.state],
    };
  };
  const round = { 'line-join': 'round', 'line-cap': 'round' };

  // The runner range is a gradient along the course, so moving it is a paint change only.
  let mode = localStorage.getItem('mode') === 'runner' ? 'runner' : 'roads';
  let runner = loadRunner();
  const seen = (m) => ({ visibility: m === mode ? 'visible' : 'none' });
  const gradient = (color, now) => {
    const { back, front } = runnerRange(runner, now);
    const clear = 'rgba(0,0,0,0)';
    if (front - back < 0.01) return ['step', ['line-progress'], clear, 0.5, clear];
    return ['step', ['line-progress'], clear, back / MARATHON, color, front / MARATHON, clear];
  };

  // Km markers along the course, scaled so the GPX length matches the official distance.
  const pts = data.routes.marathon;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    cum.push(cum[i - 1] + Math.hypot((b[1] - a[1]) * 111.2, (b[0] - a[0]) * 111.2 * Math.cos(52.05 * Math.PI / 180)));
  }
  const at = (k) => {
    const d = (k * cum.at(-1)) / MARATHON;
    const i = cum.findIndex((c) => c >= d);
    const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1]);
    return [0, 1].map((j) => pts[i - 1][j] + (pts[i][j] - pts[i - 1][j]) * t);
  };
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
        marathon: { type: 'geojson', data: line(data.routes.marathon), lineMetrics: true },
        chunks: { type: 'geojson', data: chunks },
      },
      layers: [
        ...layers,
        { id: '10k', type: 'line', source: '10k', layout: seen('roads'), paint: other },
        { id: '5k', type: 'line', source: '5k', layout: seen('roads'), paint: other },
        { id: 'casing', type: 'line', source: 'marathon', layout: round, paint: { 'line-color': '#fff', 'line-width': 7 } },
        ...data.closures.map((c, i) => ({
          id: chunkIds[i], type: 'line', source: 'chunks', filter: ['==', ['get', 'i'], i],
          layout: { ...round, ...seen('roads') }, paint: paint(c, Date.now()),
        })),
        { id: 'course', type: 'line', source: 'marathon', layout: { ...round, ...seen('runner') }, paint: { 'line-color': '#1d2226', 'line-width': 2.5 } },
        { id: 'range-casing', type: 'line', source: 'marathon', layout: { ...round, ...seen('runner') },
          paint: { 'line-width': 12, 'line-gradient': gradient('#fff', Date.now()) } },
        { id: 'range', type: 'line', source: 'marathon', layout: { ...round, ...seen('runner') },
          paint: { 'line-width': 7, 'line-gradient': gradient(RANGE, Date.now()) } },
      ],
    },
    bounds,
    fitBoundsOptions: { padding: { top: 60, right: 30, bottom: 100, left: 30 } },
    maxBounds: [[4.05, 51.93], [4.45, 52.18]],
    attributionControl: { compact: true },
  });
  document.getElementById('loading').remove();
  const geo = new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true });
  map.addControl(geo);
  // MapLibre shows no dot outside the map area and says nothing, so say why.
  const toast = document.getElementById('toast');
  let toastTimer;
  const say = (text) => {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 7000);
  };
  toast.onclick = () => { toast.hidden = true; };
  geo.on('outofmaxbounds', (e) => {
    const c = e.coords;
    const km = c && Math.min(...data.routes.marathon.map(([lon, lat]) =>
      Math.hypot((lat - c.latitude) * 111.2, (lon - c.longitude) * 111.2 * Math.cos(52.05 * Math.PI / 180))));
    say(`You are ${km ? `${Math.round(km)} km` : 'too far'} from the course, outside the offline map. Your location shows once you are in The Hague.`);
  });
  geo.on('error', (e) => say(e.code === 1
    ? 'Location is blocked. Allow it in Settings, Privacy and Security, Location Services, Safari Websites.'
    : 'Could not find your location. Try again in a moment.'));
  let loaded = false;
  map.on('load', () => { loaded = true; setMode(mode); });

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

  for (let k = 2.5; k < MARATHON; k += 2.5) {
    const el = document.createElement('div');
    el.className = k % 10 ? 'km' : 'km major';
    el.textContent = k;
    new maplibregl.Marker({ element: el }).setLngLat(at(k)).addTo(map);
  }

  // Roads or runner view. Both use the same clock and time travel.
  const modeButtons = document.querySelectorAll('#mode button');
  const setMode = (m) => {
    mode = m;
    localStorage.setItem('mode', m);
    document.body.classList.toggle('runner', m === 'runner');
    for (const b of modeButtons) b.setAttribute('aria-pressed', b.dataset.mode === m);
    if (loaded) {
      for (const id of ['10k', '5k', ...chunkIds]) map.setLayoutProperty(id, 'visibility', seen('roads').visibility);
      for (const id of ['course', 'range-casing', 'range']) map.setLayoutProperty(id, 'visibility', seen('runner').visibility);
    }
    update();
  };
  for (const b of modeButtons) b.onclick = () => setMode(b.dataset.mode);

  const form = document.getElementById('settings');
  // Selects with our own labels, so the times are 24h whatever the phone's locale.
  const times = [];
  for (let m = 7 * 60; m <= 18 * 60; m += 5) times.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  for (const k of ['start', 'from', 'to']) {
    const opts = [...new Set([...times, runner[k]])].sort();
    form.elements[k].innerHTML = opts.map((t) => `<option>${t}</option>`).join('');
    form.elements[k].value = runner[k];
  }
  form.oninput = () => {
    if ([...form.elements].some((el) => el.name && !el.value)) return;
    localStorage.setItem('runner', JSON.stringify({ start: form.elements.start.value, from: form.elements.from.value, to: form.elements.to.value }));
    runner = loadRunner();
    update();
  };
  form.onsubmit = (e) => e.preventDefault();

  map.on('click', chunkIds, (e) => {
    const { li } = items[e.features[0].properties.i];
    expand(true);
    for (const it of items) it.li.classList.toggle('flash', it.li === li);
    li.scrollIntoView({ block: 'center' });
  });

  // Time travel: when `travel` is set, the whole page shows that moment instead of now.
  let travel = null;
  const clock = document.getElementById('clock');
  const panel = document.getElementById('travel');
  const slider = document.getElementById('slider');
  const [dayStart, dayEnd] = [Date.parse('2026-11-01T09:00:00+01:00'), Date.parse('2026-11-01T16:00:00+01:00')];
  slider.min = dayStart; slider.max = dayEnd; slider.step = 60e3;
  const setTravel = (t) => {
    travel = t;
    document.body.classList.toggle('travelling', t !== null);
    panel.hidden = t === null;
    clock.setAttribute('aria-expanded', t !== null);
    if (t !== null) slider.value = t;
    update();
  };
  clock.onclick = () => setTravel(travel === null ? Math.min(Math.max(Date.now(), dayStart), dayEnd) : null);
  slider.oninput = () => setTravel(Number(slider.value));
  document.getElementById('live').onclick = () => setTravel(null);

  function update() {
    const now = travel ?? Date.now();
    clock.textContent = clockFmt.format(now);
    if (loaded) {
      data.closures.forEach((c, i) => {
        for (const [k, v] of Object.entries(paint(c, now))) map.setPaintProperty(chunkIds[i], k, v);
      });
      map.setPaintProperty('range-casing', 'line-gradient', gradient('#fff', now));
      map.setPaintProperty('range', 'line-gradient', gradient(RANGE, now));
    }
    if (mode === 'runner') return updateRunner(now);
    const sorted = items.map((it) => ({ ...it, st: status(it.c, now) })).sort((a, b) => a.st.next - b.st.next || a.c.n - b.c.n);
    for (const { c, badge, li, st } of sorted) {
      const t = left(st.next - now);
      badge.hidden = st.state !== 'closed';
      badge.textContent = t;
      const swatch = li.querySelector('.swatch');
      swatch.style.background = { open: rampColor(st.mins), closed: CLOSED, done: GONE }[st.state];
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
  function updateRunner(now) {
    const { s, f1, f2, back, front } = runnerRange(runner, now);
    const summary = document.getElementById('summary'), next = document.getElementById('next');
    const finish = `finish ${runner.from} to ${runner.to}`;
    if (now < s) {
      summary.textContent = `Starts in ${left(s - now)}`;
      next.textContent = `Start ${runner.start}, ${finish}`;
    } else if (now < f2) {
      summary.textContent = now < f1 ? `Between km ${kmText(back)} and ${kmText(front)}` : `Between km ${kmText(back)} and the finish`;
      next.textContent = `Pace ${pace(f1 - s)} to ${pace(f2 - s)} per km, ${finish}`;
    } else {
      summary.textContent = 'Finished';
      next.textContent = `Started ${runner.start}, ${finish}`;
    }
  }

  setMode(mode);
  setInterval(update, 30e3);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && update());
}

start();
