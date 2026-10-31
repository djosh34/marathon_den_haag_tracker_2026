// Where a runner can be on the marathon course, assuming an even pace between the start and a finish window.
import { at, left } from './time';

export const KM = 42.195;

// Times as HH:MM: the start, and the fastest and slowest finish.
export type Runner = { start: string; from: string; until: string };
export const DEFAULTS: Runner = { start: '10:15', from: '14:00', until: '14:30' };

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

// Choices for the settings: 24h times every 5 minutes from 07:00 to 18:00.
export const TIMES: string[] = [];
for (let m = 7 * 60; m <= 18 * 60; m += 5) TIMES.push(hhmm(m));

// Applies one changed setting and keeps start < finish from <= finish until.
export function adjust(runner: Runner, key: keyof Runner, value: string): Runner {
  const changed = { ...runner, [key]: value };
  const s = minutes(changed.start);
  let f = minutes(changed.from);
  let u = minutes(changed.until);
  if (key === 'until') {
    u = Math.max(u, s + 5);
    f = Math.max(Math.min(f, u), s + 5);
  } else {
    f = Math.max(f, s + 5);
    u = Math.max(u, f);
  }
  return { start: hhmm(s), from: hhmm(f), until: hhmm(u) };
}

// The runner's possible km range at `now`: the back runs at the slowest pace, the front at the fastest.
export type Range = { state: 'before' | 'running' | 'finished'; back: number; front: number; startsIn: number };

export function range(runner: Runner, now: number): Range {
  const start = at(runner.start);
  const km = (finish: string) => Math.min(Math.max((KM * (now - start)) / (at(finish) - start), 0), KM);
  const state = now < start ? 'before' : now >= at(runner.until) ? 'finished' : 'running';
  return { state, back: km(runner.until), front: km(runner.from), startsIn: start - now };
}

export function summary(r: Range): string {
  if (r.state === 'before') return `Starts in ${left(r.startsIn)}`;
  if (r.state === 'finished') return 'Finished';
  if (r.front >= KM) return `Between km ${r.back.toFixed(1)} and the finish`;
  return `Between km ${r.back.toFixed(1)} and ${r.front.toFixed(1)}`;
}

// Minutes:seconds per km to finish at `finish`.
function pace(runner: Runner, finish: string): string {
  const secs = Math.round((at(finish) - at(runner.start)) / 1e3 / KM);
  return `${Math.floor(secs / 60)}:${pad(secs % 60)}`;
}

export const paceLine = (r: Runner) =>
  `Pace ${pace(r, r.from)} to ${pace(r, r.until)} per km, finish ${r.from} to ${r.until}`;
