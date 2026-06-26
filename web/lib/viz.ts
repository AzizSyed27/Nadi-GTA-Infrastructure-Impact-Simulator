// Pure visualization helpers for the playback (no React / deck imports — easy to reason about + test).

import type { LonLat } from '@/lib/types';

export type RGB = [number, number, number];

// Diverging sentiment scale: -1 red → 0 amber → +1 green.
const NEG: RGB = [214, 69, 69];
const MID: RGB = [235, 180, 70];
const POS: RGB = [60, 170, 90];

function lerp(a: RGB, b: RGB, f: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/** Map a sentiment in [-1, 1] to an [r,g,b] on the red↔amber↔green diverging scale. */
export function sentimentColor(s: number): RGB {
  const x = Math.max(-1, Math.min(1, s));
  return x < 0 ? lerp(MID, NEG, -x) : lerp(MID, POS, x);
}

/** Same scale as a CSS hex string, for DOM swatches (panel / feed). */
export function sentimentHex(s: number): string {
  const [r, g, b] = sentimentColor(s);
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** A vehicle's interpolated [lon, lat] at sim time `t`; clamped to its first/last point. */
export function positionAt(path: LonLat[], ts: number[], t: number): LonLat {
  const n = ts.length;
  if (n === 0) return [0, 0];
  if (t <= ts[0]) return path[0];
  if (t >= ts[n - 1]) return path[n - 1];
  let i = 1;
  while (i < n && ts[i] < t) i++;
  const f = (t - ts[i - 1]) / (ts[i] - ts[i - 1]);
  const a = path[i - 1];
  const b = path[i];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/** Is the vehicle on the network at sim time `t` (between its first and last sample)? */
export function activeAt(ts: number[], t: number): boolean {
  return ts.length > 0 && t >= ts[0] && t <= ts[ts.length - 1];
}

/** Seconds → a compact "+1.4 min" / "−0.8 min" style string (signed). */
export function signedMinutes(seconds: number): string {
  const m = seconds / 60;
  const sign = m > 0 ? '+' : m < 0 ? '−' : '';
  return `${sign}${Math.abs(m).toFixed(1)} min`;
}

/** Seconds → "X.X min" (unsigned). */
export function minutes(seconds: number): string {
  return `${(seconds / 60).toFixed(1)} min`;
}
