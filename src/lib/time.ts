// Race-day clock and closure states. All times are fixed to +01:00 (CET on Sunday 1 November 2026).
import type { Closure } from './data';

export const at = (hhmm: string) => Date.parse(`2026-11-01T${hhmm}:00+01:00`);
// The time-travel slider covers the race itself.
export const DAY_START = at('09:00');
export const DAY_END = at('16:00');

export type Status = { state: 'open' | 'closed' | 'done'; next: number; text: string };

// Where a closure stands at time `now`: its state and the next change.
export function status(c: Closure, now: number): Status {
  if (now < at(c.close)) return { state: 'open', next: at(c.close), text: 'closes in' };
  if (now < at(c.open)) return { state: 'closed', next: at(c.open), text: 'opens in' };
  return { state: 'done', next: Infinity, text: 'reopened' };
}

// Open chunks are shaded by minutes until they close: orange when close, signage blue far off.
const RAMP: [number, string][] = [[0, '#ff5a00'], [30, '#ffb000'], [90, '#3d8bd9'], [240, '#1c4e8a']];

export function color(st: Status, now: number): string {
  if (st.state === 'closed') return '#e30613';
  if (st.state === 'done') return '#9aa0a6';
  const mins = (st.next - now) / 60e3;
  if (mins <= RAMP[0][0]) return RAMP[0][1];
  for (let i = 1; i < RAMP.length; i++) {
    const [m0, c0] = RAMP[i - 1];
    const [m1, c1] = RAMP[i];
    if (mins <= m1) return mix(c0, c1, (mins - m0) / (m1 - m0));
  }
  return RAMP[RAMP.length - 1][1];
}

// A colour between two #rrggbb colours, `t` from 0 to 1.
function mix(a: string, b: string, t: number): string {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
}

// Time left as "45m" or "1h5m".
export function left(ms: number): string {
  const m = Math.ceil(ms / 60e3);
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60}m` : `${m}m`;
}

const clockFormat = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' });
export const clock = (ms: number) => clockFormat.format(ms);
