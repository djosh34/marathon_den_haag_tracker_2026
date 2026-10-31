// Where a runner can be on the marathon course, assuming an even pace between the start and a finish window.
import data from './data.js';
import { at, left } from './time.js';

export const KM = 42.195;
export const DEFAULTS = { start: '10:15', from: '14:00', until: '14:30' };

// Distance along the course GPX, scaled so the whole course measures exactly 42.195 km.
const course = data.routes.marathon;
const cum = [0];
for (let i = 1; i < course.length; i++) {
  const [a, b] = [course[i - 1], course[i]];
  cum.push(cum[i - 1] + Math.hypot((b[1] - a[1]) * 111.2, (b[0] - a[0]) * 111.2 * Math.cos((52.05 * Math.PI) / 180)));
}
const scale = KM / cum.at(-1);

export function pointAt(km) {
  const d = km / scale;
  const i = cum.findIndex((c) => c >= d);
  if (i === -1) return course.at(-1);
  if (i === 0) return course[0];
  const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1]);
  const [a, b] = [course[i - 1], course[i]];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// Km markers: every 2.5 km.
export const MARKERS = Array.from({ length: Math.floor(KM / 2.5) }, (_, i) => (i + 1) * 2.5);

const mins = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// Choices for the settings: 24h times every 5 minutes from 07:00 to 18:00.
export const TIMES = Array.from({ length: (18 - 7) * 12 + 1 }, (_, i) => hm(7 * 60 + i * 5));

// Applies one changed setting and keeps start < finish from <= finish until.
export function adjust(settings, key, value) {
  if (!/^\d\d:\d\d$/.test(value)) return settings;
  let { start: s, from: f, until: u } = Object.fromEntries(Object.entries({ ...settings, [key]: value }).map(([k, v]) => [k, mins(v)]));
  if (key === 'until') {
    u = Math.max(u, s + 5);
    f = Math.max(Math.min(f, u), s + 5);
  } else {
    f = Math.max(f, s + 5);
    u = Math.max(u, f);
  }
  return { start: hm(s), from: hm(f), until: hm(u) };
}

// The runner's possible km range at `now`: the back runs at the slowest pace, the front at the fastest.
export function range(settings, now) {
  const [s, f, u] = [at(settings.start), at(settings.from), at(settings.until)];
  const clamp = (km) => Math.min(Math.max(km, 0), KM);
  const back = clamp((KM * (now - s)) / (u - s)), front = clamp((KM * (now - s)) / (f - s));
  const state = now < s ? 'before' : now >= u ? 'finished' : 'running';
  return { state, back, front, startsIn: s - now };
}

export function summary(r) {
  if (r.state === 'before') return `Starts in ${left(r.startsIn)}`;
  if (r.state === 'finished') return 'Finished';
  return r.front >= KM ? `Between km ${r.back.toFixed(1)} and the finish` : `Between km ${r.back.toFixed(1)} and ${r.front.toFixed(1)}`;
}

function pace(from, to) {
  const secs = Math.round((at(to) - at(from)) / 1e3 / KM);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

export const paceLine = (s) => `Pace ${pace(s.start, s.from)} to ${pace(s.start, s.until)} per km, finish ${s.from} to ${s.until}`;
