/**
 * V2.6d — the TS mirror of python/src/network_edit.py's via geometry rules (VIA_CAP /
 * MIN_SEGMENT_M / the four sentence templates). The draftBlockers convention: constants and
 * sentences are the SERVER'S OWN literals, pinned in via-rules.spec.ts — the client never
 * invents its own phrasing, and the server 400 (rendered verbatim in draft-error) stays the
 * backstop for anything the click-time checks miss.
 *
 * DELIBERATE RESIDUAL (user-ratified — do NOT "fix" by tightening): the client measures with
 * equirectangular metres on WGS84 lon/lat; the server measures in projected UTM metres. Within
 * centimetres of a threshold, a click the client accepts can still 400 at Run — and that is the
 * designed outcome: draft-error renders the server's verbatim sentence. Tightening the client
 * thresholds to eliminate the gap would REJECT VALID CLICKS to dodge a rare, already-handled
 * rejection. Keep the thresholds at the server's literals and let the rare mismatch fall
 * through to the 400.
 */
import type { LonLat } from './types';

export type Bbox = [number, number, number, number];

export const VIA_CAP = 8; // network_edit.VIA_CAP
export const MIN_SEGMENT_M = 10.0; // network_edit.MIN_SEGMENT_M

export const viaCapReason = (n: number) =>
  `a new road takes at most ${VIA_CAP} via points (got ${n})`;
export const viaOutsideReason = (i: number) => `via point ${i} is outside the study area`;
export const viaTooCloseReason = (i: number, d: number) =>
  `consecutive points on a new road must be at least ${MIN_SEGMENT_M.toFixed(0)} m apart ` +
  `(segment ${i} is ${d.toFixed(1)} m)`;
export const viaCrossingReason = (i: number, j: number) =>
  `the road crosses itself (segment ${i} intersects segment ${j})`;

/** Equirectangular metres at the mean latitude — centimetre-accurate at corridor scale. */
export function metersBetween(a: LonLat, b: LonLat): number {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad * Math.cos(((a[1] + b[1]) / 2) * toRad);
  return R * Math.hypot(dLon, dLat);
}

/** Line-faithful port of network_edit._proper_crossing — STRICT `< 0` orientation products:
 *  shared endpoints and collinear touches are NOT crossings. */
export function properCrossing(p: LonLat, q: LonLat, r: LonLat, s: LonLat): boolean {
  const orient = (a: LonLat, b: LonLat, c: LonLat) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return orient(p, q, r) * orient(p, q, s) < 0 && orient(r, s, p) * orient(r, s, q) < 0;
}

/**
 * Validate ONE candidate via click against the working polyline. `anchors` = [A, ...vias]
 * (the drawn points so far); the candidate would become via #anchors.length (1-based).
 * Server rule order mirrored (cap -> bbox -> min-segment -> crossing) so the same click
 * yields the same sentence. `bbox` = the artifact's meta.bbox; when unavailable the bbox
 * rule is skipped client-side (the server 400 backstop still enforces it).
 */
export function viaClickReason(anchors: LonLat[], candidate: LonLat, bbox: Bbox | null): string | null {
  const viaNo = anchors.length; // [A, v1..vk] -> candidate is via #(k+1) == anchors.length
  if (viaNo > VIA_CAP) return viaCapReason(viaNo);
  if (
    bbox &&
    !(bbox[0] <= candidate[0] && candidate[0] <= bbox[2] && bbox[1] <= candidate[1] && candidate[1] <= bbox[3])
  ) {
    return viaOutsideReason(viaNo);
  }
  const last = anchors[anchors.length - 1];
  const segNo = anchors.length; // 1-based over [A, ...vias, candidate]
  const d = metersBetween(last, candidate);
  if (d < MIN_SEGMENT_M) return viaTooCloseReason(segNo, d);
  for (let i = 0; i < anchors.length - 2; i++) {
    // the new tail segment vs every non-adjacent earlier segment
    if (properCrossing(anchors[i], anchors[i + 1], last, candidate)) {
      return viaCrossingReason(i + 1, segNo);
    }
  }
  return null;
}

/**
 * The closing-segment check at the B click (and B replacement mid-form): [..last via] -> B.
 * No cap/bbox legs — B is a snapped existing junction. With no vias this returns null: the
 * straight draw never runs the via rules (the server's via-less path is byte-identical too).
 */
export function viaCloseReason(anchors: LonLat[], b: LonLat): string | null {
  if (anchors.length < 2) return null;
  const last = anchors[anchors.length - 1];
  const segNo = anchors.length;
  const d = metersBetween(last, b);
  if (d < MIN_SEGMENT_M) return viaTooCloseReason(segNo, d);
  for (let i = 0; i < anchors.length - 2; i++) {
    if (properCrossing(anchors[i], anchors[i + 1], last, b)) return viaCrossingReason(i + 1, segNo);
  }
  return null;
}

/** Tolerant READ-side parse (overlays): items that aren't two finite numbers are SKIPPED — a
 *  legacy junction-id via degrades to the two-junction chord instead of crashing. */
export function parseVia(via: string[] | undefined | null): LonLat[] {
  const out: LonLat[] = [];
  for (const item of via ?? []) {
    const parts = item.split(',');
    if (parts.length !== 2) continue;
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat) && parts[0].trim() !== '' && parts[1].trim() !== '') {
      out.push([lon, lat]);
    }
  }
  return out;
}
