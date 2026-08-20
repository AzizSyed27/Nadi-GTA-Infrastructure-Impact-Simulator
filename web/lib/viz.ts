// Pure visualization helpers for the playback (no React / deck imports — easy to reason about + test).

import type { Agent, LonLat, Person, Vehicle } from '@/lib/types';
import { expandTimestamps } from '@/lib/compactTime';

/** An entity whose timestamps are guaranteed materialized (the normalizer's output type). */
export type Materialized<T extends Vehicle | Person> = T & { timestamps: number[] };

/**
 * V2.6c — the dual-shape reader. EXPLICIT entities return by IDENTITY (positionAtCached's index
 * hint is a WeakMap keyed on the timestamps ARRAY identity, and the TripsLayer buffers key on
 * object identity — a copy would cache-miss every frame); COMPACT entities materialize their
 * array ONCE. Call ONLY from a per-artifact memo (the MapView join memo), never per frame —
 * a per-frame expansion is the V2.5c 0.36 FPS regression class.
 */
export function materializeTimestamps<T extends Vehicle | Person>(e: T): Materialized<T> {
  if (e.timestamps) return e as Materialized<T>;
  return { ...e, timestamps: expandTimestamps(e.t0!, e.dt!, e.path.length) };
}

export type RGB = [number, number, number];

/**
 * A stable id for any agent kind, for React keys + selection matching. Vehicle-pinned agents key on
 * their vehicle_id, person-pinned on person_id, and inferred (unpinned) fall back to the persona id.
 */
export function agentId(a: Agent): string {
  return a.vehicle_id ?? a.person_id ?? a.persona.id;
}

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

// PERFORMANCE (2.6a): the real artifact has long trajectories (vehicles ~555 pts, pedestrians ~1359,
// max 3654). The naive positionAt rescans from index 1 every call, so per-frame cost grows with sim-time
// and janks at real scale (~511 entities). This cache remembers each entity's last bracket index —
// monotonic during forward play (amortized O(1)), and self-resets on a backward scrub. Keyed on the
// (stable) timestamps array identity, so it needs no external bookkeeping.
const _idxHint = new WeakMap<number[], number>();

/** Same as `positionAt`, but O(1) amortized during forward playback via a per-entity index hint. */
export function positionAtCached(path: LonLat[], ts: number[], t: number): LonLat {
  const n = ts.length;
  if (n === 0) return [0, 0];
  if (t <= ts[0]) return path[0];
  if (t >= ts[n - 1]) return path[n - 1];
  let i = _idxHint.get(ts) ?? 1;
  if (i < 1 || i >= n) i = 1;
  if (ts[i - 1] > t) i = 1; // scrubbed back before the cached bracket — reset and re-scan forward
  while (i < n && ts[i] < t) i++;
  _idxHint.set(ts, i);
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

// --- Edit-mode geometry: snap a click to the nearest existing junction (5.2 draw-a-road). ---
const _EARTH_M = 6371000;

/** Great-circle distance in meters between two [lon, lat] points. */
export function haversineMeters(a: LonLat, b: LonLat): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * _EARTH_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Nearest {lon,lat}-bearing item to `coord` within `maxMeters`, or null if none is close enough. */
export function nearestWithin<T extends { lon: number; lat: number }>(
  coord: LonLat,
  items: T[],
  maxMeters: number,
): T | null {
  let best: T | null = null;
  let bestD = maxMeters;
  for (const it of items) {
    const d = haversineMeters(coord, [it.lon, it.lat]);
    if (d <= bestD) {
      bestD = d;
      best = it;
    }
  }
  return best;
}
