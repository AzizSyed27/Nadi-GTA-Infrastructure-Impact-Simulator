import { test, expect } from '@playwright/test';
import {
  MIN_SEGMENT_M,
  VIA_CAP,
  metersBetween,
  parseVia,
  properCrossing,
  viaCapReason,
  viaClickReason,
  viaCloseReason,
  viaCrossingReason,
  viaOutsideReason,
  viaTooCloseReason,
} from '../lib/viaRules';
import { changeSetKey } from '../lib/compare';
import type { Change, LonLat } from '../lib/types';

/**
 * V2.6d — function-level pins for web/lib/viaRules.ts, the TS mirror of
 * python/src/network_edit.py's via geometry rules (the draftBlockers half-1 convention: no
 * page). Literals are pinned HERE as strings/numbers — never via the imported constant alone
 * (a tautological pin can't catch drift) — with the same STRUCTURAL cases as the Python matrix
 * (test_network_edit.test_new_road_via_reason_matrix: cap 9-refused/8-legal, bbox-before-
 * distance order, the bowtie), so the two languages can't drift apart silently. The client/server metric gap (equirectangular vs UTM) is a RATIFIED residual —
 * see the viaRules.ts header; these pins assert the literals, not cross-metric equality.
 */

test('via literals match network_edit.py', () => {
  expect(VIA_CAP).toBe(8); // network_edit.VIA_CAP
  expect(MIN_SEGMENT_M).toBe(10.0); // network_edit.MIN_SEGMENT_M
});

test('the four sentences match the server templates verbatim', () => {
  // the SAME example numbers as the Python pins
  expect(viaCapReason(9)).toBe('a new road takes at most 8 via points (got 9)');
  expect(viaOutsideReason(1)).toBe('via point 1 is outside the study area');
  expect(viaTooCloseReason(1, 3.0)).toBe(
    'consecutive points on a new road must be at least 10 m apart (segment 1 is 3.0 m)',
  );
  expect(viaCrossingReason(1, 3)).toBe('the road crosses itself (segment 1 intersects segment 3)');
});

test('properCrossing is PROPER — strict interiors, like the Python predicate', () => {
  // the same four cases as test_proper_crossing_pure
  expect(properCrossing([0, 0], [10, 10], [0, 10], [10, 0])).toBe(true); // clean crossing
  expect(properCrossing([0, 0], [10, 0], [10, 0], [20, 10])).toBe(false); // shared endpoint
  expect(properCrossing([0, 0], [10, 0], [5, 0], [15, 0])).toBe(false); // collinear overlap
  expect(properCrossing([0, 0], [10, 0], [5, 5], [15, 5])).toBe(false); // disjoint
});

test('metersBetween is sane at corridor latitude', () => {
  // 0.001 deg of latitude is ~111.2 m everywhere
  const d = metersBetween([-79.25, 43.75], [-79.25, 43.751]);
  expect(d).toBeGreaterThan(110);
  expect(d).toBeLessThan(112);
});

test('viaClickReason mirrors the server rule ORDER (bbox before distance)', () => {
  const bbox: [number, number, number, number] = [-79.2, 43.7, -79.1, 43.8];
  const a: LonLat = [-79.25, 43.75]; // outside bbox (lon < min)
  // the candidate is BOTH outside the bbox AND ~2 m from the anchor — the bbox sentence wins,
  // exactly as the server orders its checks (a lat/lon swap must never get a distance sentence)
  const reason = viaClickReason([a], [-79.25, 43.75002], bbox);
  expect(reason).toBe('via point 1 is outside the study area');
});

test('viaClickReason: cap, min-segment, crossing', () => {
  // cap: 8 vias already placed -> the 9th is refused with the server sentence
  const anchors: LonLat[] = Array.from({ length: 9 }, (_, i) => [i * 0.01, 0]); // [A, v1..v8]
  expect(viaClickReason(anchors, [0.095, 0], null)).toBe(
    'a new road takes at most 8 via points (got 9)',
  );
  // THE BOUNDARY (review catch): the 8th via is LEGAL — a >=-for-> port typo makes a FALSE
  // client blocker the server backstop can never catch (the LIFO t=499/500/501 precedent)
  expect(viaClickReason(anchors.slice(0, 8), [0.085, 0], null)).toBeNull();

  // min-segment: the new tail segment is ~5.6 m
  const tooClose = viaClickReason([[0, 43.75]], [0, 43.75005], null);
  const d = metersBetween([0, 43.75], [0, 43.75005]);
  expect(tooClose).toBe(viaTooCloseReason(1, d));
  expect(tooClose).toContain('consecutive points on a new road must be at least 10 m apart (segment 1 is ');

  // crossing: the classic bowtie scaled into degrees — A(0,0) v1(8,5) v2(2,5) candidate(10,0),
  // segment 3 (v2->candidate) properly crosses segment 1 (A->v1)
  const s = 1e-3;
  const bow: LonLat[] = [
    [0, 0],
    [8 * s, 5 * s],
    [2 * s, 5 * s],
  ];
  expect(viaClickReason(bow, [10 * s, 0], null)).toBe(
    'the road crosses itself (segment 1 intersects segment 3)',
  );
});

test('viaCloseReason: nothing without vias; closing segment checked with them', () => {
  // no vias -> the straight draw never runs the via rules (server via-less path is untouched)
  expect(viaCloseReason([[0, 43.75]], [0, 43.750001])).toBeNull();
  // one via, B ~3 m past it -> the closing segment (segment 2) is too short
  const r = viaCloseReason([[0, 43.75], [0, 43.751]], [0, 43.751003]);
  expect(r).toContain('(segment 2 is ');
  // the bowtie closed at the B click -> crossing caught there too
  const s = 1e-3;
  const bow: LonLat[] = [
    [0, 0],
    [8 * s, 5 * s],
    [2 * s, 5 * s],
  ];
  expect(viaCloseReason(bow, [10 * s, 0])).toBe(
    'the road crosses itself (segment 1 intersects segment 3)',
  );
});

test('parseVia is tolerant on read — junk items degrade, never crash', () => {
  expect(parseVia(['J_mid', '-79.25,43.745', 'x,y', '1,2,3', ''])).toEqual([[-79.25, 43.745]]);
  expect(parseVia(undefined)).toEqual([]);
  expect(parseVia(null)).toEqual([]);
});

test('changeSetKey projects via (BACKLOG: two runs differing only in curve must not compare identical)', () => {
  const base: Change = {
    type: 'new_road',
    target_edge: 'nr_A_B',
    description: 'x',
    from_junction: 'A',
    to_junction: 'B',
  } as Change;
  const straight = changeSetKey([base]);
  const curvedA = changeSetKey([{ ...base, via: ['-79.25,43.745'] } as Change]);
  const curvedB = changeSetKey([{ ...base, via: ['-79.24,43.746'] } as Change]);
  // via-less keys are byte-identical to the pre-V2.6d projection (undefined is dropped)
  expect(straight).not.toContain('via');
  // via-differing changes produce different keys; identical vias agree
  expect(curvedA).not.toBe(straight);
  expect(curvedA).not.toBe(curvedB);
  expect(changeSetKey([{ ...base, via: ['-79.25,43.745'] } as Change])).toBe(curvedA);
});
