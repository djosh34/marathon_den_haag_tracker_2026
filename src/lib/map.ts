// The MapLibre map: an offline Protomaps basemap, the courses, the closure chunks and the runner range.
// Everything that changes over time is a constant paint property set with setPaintProperty: WebKit does not
// always repaint after GeoJSON setData or data-driven paint changes, which re-process tiles in the worker.
import * as maplibregl from 'maplibre-gl';
import type { ExpressionSpecification, LayerSpecification, LineLayerSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PMTiles, Protocol, type Source } from 'pmtiles';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { asset } from '$app/paths';
import data, { type Closure, type LngLat } from './data';
import { status, color, left } from './time';
import { range, KM, type Runner } from './runner';

export type Mode = 'roads' | 'runner';
export type View = { now: number; mode: Mode; runner: Runner };
export type MapApi = { update(view: View): void; flyTo(center: LngLat): void };
type Paint = NonNullable<LineLayerSpecification['paint']>;

const INK = '#1d2226', RUNNER = '#ff5a00', OTHER = '#8a7bb0', CLEAR = 'rgba(0,0,0,0)';
const WIDTH = { open: 4, closed: 4.5, done: 3 };
const chunkId = (c: Closure) => `chunk-${c.n}`;

// Serves the whole .pmtiles file from memory, so no HTTP range requests are needed.
const memorySource = (key: string, buffer: ArrayBuffer): Source => ({
  getKey: () => key,
  getBytes: async (offset, length) => ({ data: buffer.slice(offset, offset + length) }),
});

const line = (coordinates: LngLat[], properties = {}) =>
  ({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates } }) as const;

// The runner range is a step gradient along the course, so it moves without touching the source data.
function rangeGradient(view: View, color: string): ExpressionSpecification {
  const r = range(view.runner, view.now);
  const back = r.back / KM, front = r.front / KM;
  if (view.mode !== 'runner' || r.state !== 'running' || front <= back) return ['step', ['line-progress'], CLEAR, 1, CLEAR];
  if (front >= 1) return ['step', ['line-progress'], CLEAR, back, color];
  return ['step', ['line-progress'], CLEAR, back, color, front, CLEAR];
}

// Every paint property that depends on the time or the view, per layer.
// Layers are hidden with a transparent colour: WebKit does not repaint after a line-opacity change.
function paints(view: View): Record<string, Paint> {
  const roads = view.mode === 'roads';
  const out: Record<string, Paint> = {
    '10k': { 'line-color': roads ? OTHER : CLEAR },
    '5k': { 'line-color': roads ? OTHER : CLEAR },
    casing: { 'line-width': roads ? 7 : 5 },
    course: { 'line-color': roads ? CLEAR : INK },
    'range-casing': { 'line-gradient': rangeGradient(view, '#fff') },
    range: { 'line-gradient': rangeGradient(view, RUNNER) },
  };
  for (const c of data.closures) {
    const st = status(c, view.now);
    out[chunkId(c)] = { 'line-color': roads ? color(st, view.now) : CLEAR, 'line-width': WIDTH[st.state] };
  }
  return out;
}

export async function createMap(container: HTMLElement, view: View, onChunk: (n: number) => void): Promise<MapApi> {
  const [buffer, basemap, worker] = await Promise.all([
    fetch(asset('map/hague.pmtiles')).then((r) => r.arrayBuffer()),
    fetch(asset('map/layers.json')).then((r) => r.json() as Promise<LayerSpecification[]>),
    fetch(workerUrl).then((r) => r.blob()),
  ]);
  // WebKit fetches worker scripts past the service worker, so hand MapLibre a blob of the cached copy.
  maplibregl.setWorkerUrl(URL.createObjectURL(new Blob([worker], { type: 'text/javascript' })));
  const protocol = new Protocol();
  protocol.add(new PMTiles(memorySource('hague', buffer)));
  maplibregl.addProtocol('pmtiles', protocol.tile);

  // The absolute URL of static/map/, for the glyphs and sprites (asset() only takes file names).
  const mapDir = new URL('.', new URL(asset('map/layers.json'), location.href)).href;
  const initial = paints(view);
  const round = { 'line-join': 'round', 'line-cap': 'round' } as const;
  // A line layer with its fixed paint plus the paint for the current view.
  const layer = (id: string, source: string, paint: Paint, more: Partial<LineLayerSpecification> = {}): LineLayerSpecification =>
    ({ id, type: 'line', source, layout: round, ...more, paint: { ...paint, ...initial[id] } });
  const dashed: Paint = { 'line-width': 2, 'line-dasharray': [2.5, 1.5] };

  // All course layers are part of the initial style, so they draw with the first frame.
  const map = new maplibregl.Map({
    container,
    style: {
      version: 8,
      glyphs: mapDir + 'fonts/{fontstack}/{range}.pbf',
      sprite: mapDir + 'sprites/grayscale',
      sources: {
        protomaps: { type: 'vector', url: 'pmtiles://hague', attribution: '© OpenStreetMap, Protomaps' },
        '10k': { type: 'geojson', data: line(data.routes['10k']) },
        '5k': { type: 'geojson', data: line(data.routes['5k']) },
        marathon: { type: 'geojson', data: line(data.routes.marathon), lineMetrics: true },
        chunks: { type: 'geojson', data: { type: 'FeatureCollection', features: data.closures.map((c) => line(c.line, { n: c.n })) } },
      },
      layers: [
        ...basemap,
        // The dashed courses keep MapLibre's default (butt) line ends.
        layer('10k', '10k', dashed, { layout: {} }),
        layer('5k', '5k', dashed, { layout: {} }),
        layer('casing', 'marathon', { 'line-color': '#fff' }),
        layer('course', 'marathon', { 'line-width': 2 }),
        ...data.closures.map((c) => layer(chunkId(c), 'chunks', {}, { filter: ['==', ['get', 'n'], c.n] })),
        layer('range-casing', 'marathon', { 'line-width': 11 }),
        layer('range', 'marathon', { 'line-width': 6 }),
      ],
    },
    bounds: data.routes.marathon.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds()),
    fitBoundsOptions: { padding: { top: 60, right: 30, bottom: 100, left: 30 } },
    maxBounds: [[4.05, 51.93], [4.45, 52.18]],
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }));

  // Badges and km markers are HTML markers, shown and hidden with the `hidden` attribute.
  const pill = 'pointer-events-none rounded font-bold text-white tabular-nums shadow-[0_0_0_1.5px_#fff]';
  const small = 'px-1 pt-px text-[11px]/[1.25]';
  const marker = (className: string, text: string, at: LngLat) => {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    new maplibregl.Marker({ element: el }).setLngLat(at).addTo(map);
    return el;
  };
  const badges = data.closures.map((c) => marker(`badge bg-closed ${pill} ${small}`, '', c.label));
  // The multiples of 10 are a little bigger.
  const kms = data.markers.map((m) => marker(`km bg-ink ${pill} ${m.km % 10 ? small : 'px-1.5 pt-px text-[13px]/[1.25]'}`, String(m.km), m.at));

  let current = view;
  let loaded = false;
  map.on('load', () => {
    loaded = true;
    update(current);
  });
  map.on('click', data.closures.map(chunkId), (e) => {
    if (current.mode === 'roads') onChunk(e.features![0].properties.n);
  });

  function update(view: View) {
    current = view;
    if (loaded) {
      for (const [id, paint] of Object.entries(paints(view))) {
        for (const [property, value] of Object.entries(paint)) map.setPaintProperty(id, property as keyof Paint, value);
      }
    }
    for (const c of data.closures) {
      const st = status(c, view.now);
      badges[c.n].hidden = view.mode !== 'roads' || st.state !== 'closed';
      badges[c.n].textContent = left(st.next - view.now);
    }
    for (const el of kms) el.hidden = view.mode !== 'runner';
  }
  update(view);

  return { update, flyTo: (center) => map.flyTo({ center, zoom: 14, padding: { bottom: 80 } }) };
}
