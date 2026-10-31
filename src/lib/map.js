// The MapLibre map: an offline Protomaps basemap, the courses, the closure chunks and the runner range.
// Everything that changes over time is a constant paint property set with setPaintProperty: WebKit does not
// always repaint after GeoJSON setData or data-driven paint changes, which re-process tiles in the worker.
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PMTiles, Protocol } from 'pmtiles';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { asset } from '$app/paths';
import data from './data.js';
import { status, color, left } from './time.js';
import { range, pointAt, MARKERS, KM } from './runner.js';

const INK = '#1d2226', RUNNER = '#ff5a00', OTHER = '#8a7bb0', CLEAR = 'rgba(0,0,0,0)';
const chunkIds = data.closures.map((c, i) => `chunk-${i}`);

// Serves the whole .pmtiles file from memory, so no HTTP range requests are needed.
class BufferSource {
  constructor(key, buf) { this.key = key; this.buf = buf; }
  getKey() { return this.key; }
  async getBytes(offset, length) { return { data: this.buf.slice(offset, offset + length) }; }
}

const line = (coords, props = {}) => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } });

// Every paint property that depends on the time or the view, per layer.
function paints({ now, mode, runner }) {
  const roads = mode === 'roads';
  // Layers are hidden with a transparent colour: WebKit does not repaint after a line-opacity change.
  const out = {
    '10k': { 'line-color': roads ? OTHER : CLEAR },
    '5k': { 'line-color': roads ? OTHER : CLEAR },
    casing: { 'line-width': roads ? 7 : 5 },
    course: { 'line-color': roads ? CLEAR : INK },
  };
  data.closures.forEach((c, i) => {
    const st = status(c, now);
    out[chunkIds[i]] = { 'line-color': roads ? color(st) : CLEAR, 'line-width': { open: 4, closed: 4.5, done: 3 }[st.state] };
  });
  // The runner range is a step gradient along the course, so it moves without touching the source data.
  const r = range(runner, now);
  const [a, b] = [r.back / KM, r.front / KM];
  const step = (c) => roads || r.state !== 'running' || b <= a
    ? ['step', ['line-progress'], CLEAR, 1, CLEAR]
    : b >= 1 ? ['step', ['line-progress'], CLEAR, a, c] : ['step', ['line-progress'], CLEAR, a, c, b, CLEAR];
  out['range-casing'] = { 'line-gradient': step('#fff') };
  out.range = { 'line-gradient': step(RUNNER) };
  return out;
}

export async function createMap(container, state, { onChunk }) {
  const [buf, layers, worker] = await Promise.all([
    fetch(asset('/map/hague.pmtiles')).then((r) => r.arrayBuffer()),
    fetch(asset('/map/layers.json')).then((r) => r.json()),
    fetch(workerUrl).then((r) => r.blob()),
  ]);
  // WebKit fetches worker scripts past the service worker, so hand MapLibre a blob of the cached copy.
  maplibregl.setWorkerUrl(URL.createObjectURL(new Blob([worker], { type: 'text/javascript' })));
  const protocol = new Protocol();
  protocol.add(new PMTiles(new BufferSource('hague', buf)));
  maplibregl.addProtocol('pmtiles', protocol.tile);

  const abs = (p) => new URL(asset(p), location.href).href;
  const round = { 'line-join': 'round', 'line-cap': 'round' };
  const other = { 'line-width': 2, 'line-dasharray': [2.5, 1.5] };
  const initial = paints(state);
  const with0 = (id, paint) => ({ ...paint, ...initial[id] });

  // All course layers are part of the initial style, so they draw with the first frame.
  const bounds = data.routes.marathon.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds());
  const map = new maplibregl.Map({
    container,
    style: {
      version: 8,
      glyphs: abs('/map/fonts/') + '{fontstack}/{range}.pbf',
      sprite: abs('/map/sprites/grayscale'),
      sources: {
        protomaps: { type: 'vector', url: 'pmtiles://hague', attribution: '© OpenStreetMap, Protomaps' },
        '10k': { type: 'geojson', data: line(data.routes['10k']) },
        '5k': { type: 'geojson', data: line(data.routes['5k']) },
        marathon: { type: 'geojson', data: line(data.routes.marathon), lineMetrics: true },
        chunks: { type: 'geojson', data: { type: 'FeatureCollection', features: data.closures.map((c, i) => line(c.line, { i })) } },
      },
      layers: [
        ...layers,
        { id: '10k', type: 'line', source: '10k', paint: with0('10k', other) },
        { id: '5k', type: 'line', source: '5k', paint: with0('5k', other) },
        { id: 'casing', type: 'line', source: 'marathon', layout: round, paint: with0('casing', { 'line-color': '#fff' }) },
        { id: 'course', type: 'line', source: 'marathon', layout: round, paint: with0('course', { 'line-width': 2 }) },
        ...chunkIds.map((id, i) => ({ id, type: 'line', source: 'chunks', filter: ['==', ['get', 'i'], i], layout: round, paint: initial[id] })),
        { id: 'range-casing', type: 'line', source: 'marathon', layout: round, paint: with0('range-casing', { 'line-width': 11 }) },
        { id: 'range', type: 'line', source: 'marathon', layout: round, paint: with0('range', { 'line-width': 6 }) },
      ],
    },
    bounds,
    fitBoundsOptions: { padding: { top: 60, right: 30, bottom: 100, left: 30 } },
    maxBounds: [[4.05, 51.93], [4.45, 52.18]],
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }));

  const marker = (cls, text, lngLat) => {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
    return el;
  };
  const pill = 'pointer-events-none rounded px-1 pt-px text-[11px]/[1.25] font-bold text-white tabular-nums shadow-[0_0_0_1.5px_#fff]';
  const badges = data.closures.map((c) => marker(`badge bg-closed ${pill}`, '', c.label));
  const kms = MARKERS.map((km) => ({ km, el: marker(`km bg-ink ${pill}`, String(km), pointAt(km)) }));

  let current = state, loaded = false;
  const showKms = () => {
    const near = map.getZoom() >= 12.5;
    for (const { km, el } of kms) el.hidden = current.mode !== 'runner' || !(near || km % 10 === 0);
  };
  map.on('zoom', showKms);
  map.on('load', () => { loaded = true; update(current); });
  map.on('click', chunkIds, (e) => current.mode === 'roads' && onChunk(e.features[0].properties.i));

  function update(s) {
    current = s;
    if (loaded) {
      for (const [id, paint] of Object.entries(paints(s))) {
        for (const [k, v] of Object.entries(paint)) map.setPaintProperty(id, k, v);
      }
    }
    data.closures.forEach((c, i) => {
      const st = status(c, s.now);
      badges[i].hidden = s.mode !== 'roads' || st.state !== 'closed';
      badges[i].textContent = left(st.next - s.now);
    });
    showKms();
  }
  update(state);

  return { update, flyTo: (center) => map.flyTo({ center, zoom: 14, padding: { bottom: 80 } }) };
}
