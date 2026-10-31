// Race-day clock and closure states. All times are fixed to +01:00 (CET on Sunday 1 November 2026).

// Open chunks are shaded by minutes until they close: signage blue far off, orange when close.
export const RAMP = [[0, '#ff5a00'], [30, '#ffb000'], [90, '#3d8bd9'], [240, '#1c4e8a']];
export const CLOSED = '#e30613', GONE = '#9aa0a6';

export const at = (hhmm) => Date.parse(`2026-11-01T${hhmm}:00+01:00`);
// The time-travel slider covers the race itself.
export const DAY_START = at('09:00'), DAY_END = at('16:00');

// Where a closure stands at time `now`: its state and the next change.
export function status(c, now) {
  const close = Date.parse(c.close), open = Date.parse(c.open);
  if (now < close) return { state: 'open', next: close, text: 'closes in', mins: (close - now) / 60e3 };
  if (now < open) return { state: 'closed', next: open, text: 'opens in', mins: (open - now) / 60e3 };
  return { state: 'done', next: Infinity, text: 'reopened', mins: 0 };
}

export function rampColor(mins) {
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const j = RAMP.findIndex(([m]) => mins <= m);
  if (j === -1) return RAMP.at(-1)[1];
  if (j === 0) return RAMP[0][1];
  const [[m0, c0], [m1, c1]] = [RAMP[j - 1], RAMP[j]];
  const t = (mins - m0) / (m1 - m0), a = hex(c0), b = hex(c1);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
}

export const color = (st) => ({ open: rampColor(st.mins), closed: CLOSED, done: GONE })[st.state];

export function left(ms) {
  const m = Math.ceil(ms / 60e3);
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60}m` : `${m}m`;
}

export const hhmm = (iso) => iso.slice(11, 16);
const clockFmt = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' });
export const clock = (ms) => clockFmt.format(ms);
