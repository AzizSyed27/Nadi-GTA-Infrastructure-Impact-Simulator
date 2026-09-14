import { test, expect, type Page } from '@playwright/test';
import { mockDefaultArtifact } from './support/default-artifact';
import {
  REASON_SETTLED_SEVERED,
  deriveBlockers,
  hasWindowedMember,
  lifoConflictReason,
  severs,
} from '../lib/draftBlockers';
import type { EdgeEligibility, SimChange } from '../lib/api';
import { CAR, laneTable, netEdge } from './support/net';

/**
 * V2.4a — the draft basket. Two halves:
 *
 * 1. FUNCTION-LEVEL pins for web/lib/draftBlockers.ts — the TS mirror of
 *    python/src/change_scheduler.py's shared reason strings + lifo_conflict_reason. Strings are
 *    pinned as LITERALS here (never via the imported constant alone — a tautological pin can't
 *    catch drift). The LIFO boundary pins use the SAME numbers as the Python-side pin
 *    (test_change_scheduler.test_adjacent_windows_compose_via_revert_before_apply: A[100,500] +
 *    B[500,800], state verified at t=499/500/501): touching end==start is LEGAL (crossing uses
 *    strict >, never >=). A >=-for-> port typo makes a FALSE blocker — the client would refuse a
 *    draft the server would run, and the server-400 backstop can never catch that.
 *
 * 2. E2E cases for the basket UI (all /api/* + network.json mocked; no fixture artifact, so the
 *    tiny-fixture StrictMode hazard documented in compare.spec.ts does not apply here).
 *
 * Existing specs stay behaviorally pinned: the single-change wire shape asserted in
 * closure-palette/edit/seeds is unchanged by the basket (1 member, no tags → {change} exactly).
 */

// ---------------------------------------------------------------------------------------------
// Half 1 — draftBlockers function pins (no page)
// ---------------------------------------------------------------------------------------------

const sl = (edge: string, w?: [number, number]): SimChange => ({
  type: 'speed_limit',
  target_edge: edge,
  value_mps: 8.3,
  ...(w ? { window: { start_s: w[0], end_s: w[1] } } : {}),
});
const lc = (edge: string, lanes: number[], w?: [number, number]): SimChange => ({
  type: 'lane_closure',
  target_edge: edge,
  target_lanes: lanes,
  ...(w ? { window: { start_s: w[0], end_s: w[1] } } : {}),
});
const rc = (edge: string, w?: [number, number]): SimChange => ({
  type: 'road_closure',
  target_edge: edge,
  ...(w ? { window: { start_s: w[0], end_s: w[1] } } : {}),
});

const elig = (id: string, lanes: number[]): EdgeEligibility => ({
  id,
  car_lane_count: lanes.length,
  car_lane_indices: lanes,
  eligible_bike_lane: true,
  eligibility_reason: 'eligible',
});
const ELIG: Record<string, EdgeEligibility> = {
  E_A: elig('E_A', [1, 2]),
  E_B: elig('E_B', [0]),
};

const LIFO_A = `windows on the same edge ('E_A') must be disjoint or nested — crossing windows cannot be reverted correctly (LIFO revert restores captured state)`;

test.describe('draftBlockers — the change_scheduler mirror', () => {
  test('REASON_SETTLED_SEVERED matches the Python constant literally', () => {
    // change_scheduler.py:39-42 — a paraphrase here would desync the client from the server 400.
    expect(REASON_SETTLED_SEVERED).toBe(
      'closures can strand trips that start or end on the closed road; equilibrium assignment ' +
        'cannot honestly settle a severed network — use day-one response',
    );
  });

  test('lifoConflictReason: crossing same-edge windows return the exact shared reason', () => {
    expect(lifoConflictReason([lc('E_A', [1], [100, 500]), rc('E_A', [400, 800])])).toBe(LIFO_A);
  });

  test('lifoConflictReason: nested and disjoint same-edge windows are legal', () => {
    expect(lifoConflictReason([lc('E_A', [1], [100, 800]), rc('E_A', [200, 700])])).toBeNull();
    expect(lifoConflictReason([lc('E_A', [1], [100, 500]), rc('E_A', [501, 800])])).toBeNull();
  });

  test('lifoConflictReason: touching end == start is LEGAL — the t=499/500/501 boundary pin', () => {
    // Same numbers as python/tests/test_change_scheduler.test_adjacent_windows_compose_via_revert_before_apply:
    // A[100,500] + B[500,800] is the phased-closure shape — at t=500 A's revert fires BEFORE B's
    // apply (crossing uses strict >). A >= typo in the port turns this into a false blocker the
    // server backstop can never correct (the draft would never be submitted).
    expect(lifoConflictReason([lc('E_A', [1], [100, 500]), lc('E_A', [2], [500, 800])])).toBeNull();
    expect(lifoConflictReason([lc('E_A', [1], [100, 500]), lc('E_A', [2], [499, 800])])).toBe(LIFO_A);
    expect(lifoConflictReason([lc('E_A', [1], [100, 500]), lc('E_A', [2], [501, 800])])).toBeNull();
  });

  test('lifoConflictReason: unwindowed members are invisible; different edges never conflict', () => {
    // change_scheduler.py:124-125 — unwindowed members never enter the replay.
    expect(lifoConflictReason([rc('E_A'), lc('E_A', [1], [100, 500])])).toBeNull();
    expect(lifoConflictReason([lc('E_A', [1], [100, 500]), rc('E_B', [400, 800])])).toBeNull();
  });

  test('severs: road_closure always; lane_closure only when ALL car lanes close; unknown edge is conservative', () => {
    expect(severs(rc('E_A'), ELIG)).toBe(true);
    expect(severs(lc('E_A', [1, 2]), ELIG)).toBe(true); // every car lane of E_A
    expect(severs(lc('E_A', [1]), ELIG)).toBe(false); // one of two remains
    expect(severs(lc('E_X', [0]), ELIG)).toBe(false); // no eligibility loaded → let the server 400 decide
    expect(severs(sl('E_A'), ELIG)).toBe(false);
  });

  test('deriveBlockers: settled + severing member blocks once; day_one never; severed orders before LIFO', () => {
    expect(deriveBlockers([rc('E_A'), rc('E_B')], 'settled', ELIG)).toEqual([REASON_SETTLED_SEVERED]);
    expect(deriveBlockers([rc('E_A')], 'day_one', ELIG)).toEqual([]);
    expect(
      deriveBlockers([rc('E_A'), lc('E_A', [1], [100, 500]), lc('E_A', [2], [400, 800])], 'settled', ELIG),
    ).toEqual([REASON_SETTLED_SEVERED, LIFO_A]);
  });

  test('hasWindowedMember: any windowed member flips it', () => {
    expect(hasWindowedMember([sl('E_A'), rc('E_B')])).toBe(false);
    expect(hasWindowedMember([sl('E_A'), rc('E_B', [100, 500])])).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Half 2 — the basket UI (all backend mocked; the closure-palette.spec mock/preamble idiom)
// ---------------------------------------------------------------------------------------------

const RUN_ID = 'multimodal-scenario-draftbasket-fixture';
const D1_REASON = 'temporary events have no equilibrium; use day-one response';
const BANNED = /\b(majority|minority|referendum|consensus|unanimous|plurality)\b/i;
const STANCE_TALLY = /\d+\s*%[^.]{0,24}(support|oppos|favou?r|against)|\bfinal (distribution|tally|result|vote)\b|\d+\s+for\s*\/\s*\d+\s+against/i;

// three edges: E_A's car lanes are the REAL indices [1, 2] (lane 0 = sidewalk), E_B [0, 1], E_C [0]
const EDGES = [
  { id: 'E_A', geometry: [[-79.222, 43.744], [-79.214, 43.75]], car_lane_indices: [1, 2] },
  { id: 'E_B', geometry: [[-79.218, 43.746], [-79.21, 43.752]], car_lane_indices: [0, 1] },
  { id: 'E_C', geometry: [[-79.214, 43.748], [-79.206, 43.754]], car_lane_indices: [0] },
];

type DraftSeam = {
  count: number;
  zoneTagged: boolean;
  hoveredId: string | null;
  items: { id: string; type: string; windowed: boolean }[];
};

async function mockBackend(page: Page, opts: { reject?: { status: number; detail: string }; names?: Record<string, string>; partner?: boolean } = {}) {
  await mockDefaultArtifact(page); // V2.5c: the default pointer pair — never the real latest.json
  let lastBody: Record<string, unknown> | null = null;
  await page.route('**/api/junctions**', (route) => route.fulfill({ json: { junctions: [], count: 0 } }));
  // V2.7d C4a: `partner` adds `-E_A`, the westbound NODE-PAIR partner of E_A (one car lane), and links
  // the two through `reverse` — the both-directions lane rows read it
  // The table must AGREE with each edge's `car_lane_indices` (C4a's closable set is their intersection):
  // E_A [1,2] carries the curb sidewalk at 0; E_B [0,1] and E_C [0] have a car lane AT the curb, so they
  // are the net's ped-on-car-lane shape (allows.ped, no sidewalk lane — 28 such edges exist).
  const netEdges = EDGES.map((e) => netEdge({
    id: e.id, geometry: e.geometry,
    lanes: e.car_lane_indices.includes(0) ? e.car_lane_indices.map(() => CAR) : laneTable(e.car_lane_indices.length + 1, true),
    speed_mps: 13.9,
    oneway: false, allows: { car: true, bike: true, ped: true }, name: opts.names?.[e.id] ?? null,
    reverse: opts.partner && e.id === 'E_A' ? '-E_A' : null,
  }));
  if (opts.partner) {
    // the partner runs the other way ~5 m to the side (real partners are parallel offset polylines —
    // identical geometry would make the pick under a drop ambiguous)
    netEdges.push(netEdge({ id: '-E_A', geometry: [...EDGES[0].geometry].reverse().map(([lon, lat]) => [lon + 0.0003, lat]), lanes: 2, speed_mps: 13.9, oneway: false,
      allows: { car: true, bike: true, ped: true }, name: opts.names?.E_A ?? null, reverse: 'E_A' }));
  }
  const eligEdges = EDGES.map((e) => ({
    id: e.id, car_lane_count: e.car_lane_indices.length, car_lane_indices: e.car_lane_indices,
    eligible_bike_lane: true, eligibility_reason: 'eligible',
  }));
  if (opts.partner) eligEdges.push({ id: '-E_A', car_lane_count: 1, car_lane_indices: [1], eligible_bike_lane: false, eligibility_reason: 'one lane' });
  await page.route('**/network.json', (route) =>
    route.fulfill({
      json: {
        // V2.7d: edges are UNNAMED unless a test names one — the single-change wire pin below reads the
        // client's id-only description, and a named E_A would (correctly) change it
        edges: netEdges,
      },
    }));
  await page.route('**/api/edges**', (route) =>
    route.fulfill({ json: { edges: eligEdges, count: eligEdges.length } }));
  await page.route('**/api/simulate', (route) => {
    lastBody = route.request().postDataJSON();
    if (opts.reject) return route.fulfill({ status: opts.reject.status, json: { detail: opts.reject.detail } });
    return route.fulfill({ json: { run_id: RUN_ID } });
  });
  await page.route('**/api/runs', (route) => route.fulfill({ json: { runs: [] } }));
  await page.route('**/api/runs/*/status', (route) =>
    route.fulfill({ json: { run_id: RUN_ID, stage: 'baseline', status: 'running', change: { type: 'speed_limit' }, description: 'fixture' } }));
  return () => lastBody;
}

async function openEdit(page: Page) {
  await page.goto('/');
  // warm-reload convention (compare.spec.ts): cold dev compile + StrictMode detaches first paint
  await page.getByTestId('stage-build').waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
  await page.reload();
  await expect(page.getByTestId('stage-build')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('stage-build').click();
  await page.waitForFunction(() => typeof (window as unknown as { __nadiEditEdge?: unknown }).__nadiEditEdge === 'function');
  await page.waitForFunction(() => ((window as unknown as { __nadiNetworkEdges?: number }).__nadiNetworkEdges ?? 0) > 0);
  // eligibility must land BEFORE any edge pick — the palette snapshots the merge at click time,
  // and a pre-eligibility pick renders an EMPTY lane picker (flake-caught; the seam closes the race)
  await page.waitForFunction(() => ((window as unknown as { __nadiEligEdges?: number }).__nadiEligEdges ?? 0) > 0);
}

async function pickEdge(page: Page, id: string) {
  await page.evaluate((eid) => (window as unknown as { __nadiEditEdge: (x: string) => void }).__nadiEditEdge(eid), id);
  await expect(page.getByTestId('edge-palette')).toBeVisible();
}

const draftRows = (page: Page) => page.locator('[data-testid^="draft-member-"]');

test('V2.7d: a member on a NAMED edge summarizes name-plus-id; an unnamed edge keeps the id', async ({ page }) => {
  await mockBackend(page, { names: { E_A: 'Lawrence Avenue East' } });
  await openEdit(page);
  await pickEdge(page, 'E_A');
  await page.getByTestId('palette-type-road-closure').click();
  await page.getByTestId('apply-road-closure').click();
  await expect(draftRows(page)).toHaveCount(1);
  await expect(page.getByTestId('draft-member-d1')).toContainText('Road closed · Lawrence Avenue East (edge E_A)');
  await pickEdge(page, 'E_C');
  await page.getByTestId('palette-speed').fill('8');
  await page.getByTestId('apply-speed').click();
  await expect(draftRows(page)).toHaveCount(2);
  await expect(page.getByTestId('draft-member-d2')).toContainText('Speed limit 29 km/h · edge E_C');
});

// ---- V2.7d C4a — the drop form: a kind arrives WITH the edge; lanes come from the table, both directions ----

test('V2.7d C4a: the seam opens the drop form pre-set to a kind, with lane rows from the table', async ({ page }) => {
  await mockBackend(page, { names: { E_A: 'Lawrence Avenue East' }, partner: true });
  await openEdit(page);
  await page.evaluate(() =>
    (window as unknown as { __nadiEditEdge: (x: string, k?: string) => void }).__nadiEditEdge('E_A', 'lane_closure'));
  await expect(page.getByTestId('drop-form')).toBeVisible();
  await expect(page.getByTestId('drop-form')).toContainText('Lawrence Avenue East (edge E_A)');
  // rows: E_A [sidewalk, general 1 (curb), general 2] then -E_A [sidewalk, general 1 (curb)] — the ratified
  // "which lanes — from this road's lane table", both directions. E_A's mock geometry runs NORTH, so the
  // initials derive as NB / SB (data, never a label written by hand).
  await expect(page.getByTestId('lane-check-1')).toBeVisible();
  await expect(page.getByTestId('lane-check-2')).toBeVisible();
  await expect(page.getByTestId('lane-check-rev-1')).toBeVisible();
  await expect(page.getByTestId('lane-picker')).toContainText('NB general 1 (curb)');
  await expect(page.getByTestId('lane-picker')).toContainText('SB general 1 (curb)');
  await expect(page.getByTestId('apply-lane-closure')).toBeDisabled(); // nothing ticked yet
  await page.getByTestId('lane-check-1').check(); // the looked-at frame shows a ticked direction and its note
  if (process.env.NADI_SHOTS) await page.screenshot({ path: '../docs-assets/v27d-c4-drop-form.png' });
  await page.getByTestId('lane-check-1').uncheck();
  // the no-kind seam call still opens the ROAD CARD exactly as before (the eight seam specs ride it)
  await page.getByTestId('palette-cancel').click();
  await pickEdge(page, 'E_A');
  await expect(page.getByTestId('palette-type-lane-closure')).toBeVisible();
});

test('V2.7d C4a: ticking one direction SAYS so before Run; ticking both emits one member per directional edge', async ({ page }) => {
  const getBody = await mockBackend(page, { partner: true });
  await openEdit(page);
  await page.evaluate(() =>
    (window as unknown as { __nadiEditEdge: (x: string, k?: string) => void }).__nadiEditEdge('E_A', 'lane_closure'));
  await expect(page.getByTestId('drop-form')).toBeVisible();
  await page.getByTestId('lane-check-1').check();
  // THE RATIFICATION CONDITION: the per-direction consequence is a sentence, pinned verbatim
  await expect(page.getByTestId('drop-direction-note')).toHaveText('closes northbound only — southbound stays open');
  await page.getByTestId('lane-check-rev-1').check();
  await expect(page.getByTestId('drop-direction-note')).toHaveText('closes both directions — 2 members');
  await page.getByTestId('apply-lane-closure').click();
  await expect(draftRows(page)).toHaveCount(2);
  await expect(page.getByTestId('draft-member-d1')).toContainText('1 lane(s) closed · edge E_A');
  await expect(page.getByTestId('draft-member-d2')).toContainText('1 lane(s) closed · edge -E_A');
  await page.getByTestId('draft-run').click();
  await expect.poll(() => getBody()?.changes).toBeTruthy();
  const body = getBody() as { changes: { type: string; target_edge: string; target_lanes: number[] }[] };
  expect(body.changes.map((c) => [c.type, c.target_edge, c.target_lanes])).toEqual([
    ['lane_closure', 'E_A', [1]],
    ['lane_closure', '-E_A', [1]],
  ]);
});

// ---- V2.7d C4b — the seven tiles ARM a kind (the accessible path); the both-directions checkbox ----

test('V2.7d C4b: a tile arms a kind — the next road click opens the form pre-set; draw / zone tiles enter their modes', async ({ page }) => {
  await mockBackend(page, { partner: true });
  await openEdit(page);
  await expect(page.getByTestId('change-tiles')).toBeVisible();
  for (const k of ['road-closure', 'lane-closure', 'speed-limit', 'incident', 'bike-lane', 'draw-road']) {
    await expect(page.getByTestId(`tile-${k}`)).toBeVisible();
  }
  await page.getByTestId('tile-lane-closure').click();
  await expect(page.getByTestId('tile-lane-closure')).toHaveAttribute('aria-pressed', 'true');
  // a plain road click (the seam without a kind) now lands the ARMED kind
  await page.evaluate(() => (window as unknown as { __nadiEditEdge: (x: string) => void }).__nadiEditEdge('E_A'));
  await expect(page.getByTestId('drop-form')).toBeVisible();
  await expect(page.getByTestId('lane-check-1')).toBeVisible();
  await page.getByTestId('palette-cancel').click();
  await expect(page.getByTestId('tile-lane-closure')).toHaveAttribute('aria-pressed', 'false'); // cancel disarms
  // DRAW A NEW ROAD → the draw card's first step; SCHOOL ZONE keeps the `zone-mode-toggle` testid (school-zone.spec)
  await page.getByTestId('tile-draw-road').click();
  await expect(page.getByTestId('draw-card')).toContainText('Click a junction on the map to start.');
  await page.getByTestId('zone-mode-toggle').click();
  await expect(page.getByTestId('zone-palette')).toBeVisible();
});

// ---- V2.7d C5 — the pointer drag: a tile dragged ONTO a road opens the form at the drop point ----

/** Container-relative pixels of a lon/lat through the map's own projection (the `__nadiViewport` seam). */
async function projectPx(page: Page, lonlat: [number, number]) {
  // z17 (0.43 m/px): the two directions of a street sit tens of pixels apart, so a drop's pick is
  // unambiguous — at the landing zoom both directions share the same pixels (deck picks the topmost)
  await page.evaluate(
    ([lon, lat]) => (window as unknown as { __nadiViewport: { jumpTo: (a: number, b: number, z: number) => void } }).__nadiViewport.jumpTo(lon, lat, 17),
    lonlat,
  );
  await page.waitForTimeout(500);
  const canvas = page.locator('canvas.maplibregl-canvas').first();
  const box = (await canvas.boundingBox())!;
  const px = await page.evaluate(
    ([lon, lat]) => (window as unknown as { __nadiViewport: { project: (a: number, b: number) => { x: number; y: number } } }).__nadiViewport.project(lon, lat),
    lonlat,
  );
  return { x: box.x + px.x, y: box.y + px.y, box };
}

async function dragTileTo(page: Page, tile: string, x: number, y: number) {
  const t = (await page.getByTestId(tile).boundingBox())!;
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 10 });
  await page.mouse.up();
}

test('V2.7d C5: dragging LANE CLOSURE onto a road opens the drop form for THAT road', async ({ page }) => {
  await mockBackend(page, { partner: true });
  await openEdit(page);
  await page.waitForFunction(() => typeof (window as unknown as { __nadiViewport?: { project?: unknown } }).__nadiViewport?.project === 'function');
  const g = EDGES[0].geometry;
  const mid: [number, number] = [(g[0][0] + g[g.length - 1][0]) / 2, (g[0][1] + g[g.length - 1][1]) / 2];
  const p = await projectPx(page, mid);
  await dragTileTo(page, 'tile-lane-closure', p.x, p.y);
  await expect(page.getByTestId('drop-form')).toBeVisible();
  await expect(page.getByTestId('drop-form')).toContainText('edge E_A');
  await expect(page.getByTestId('lane-check-1')).toBeVisible();
  await expect(page.getByTestId('tile-lane-closure')).toHaveAttribute('aria-pressed', 'false'); // a drop never leaves a tile armed
});

test('V2.7d C5: a drop on empty map says so and adds nothing', async ({ page }) => {
  await mockBackend(page, { partner: true });
  await openEdit(page);
  await page.waitForFunction(() => typeof (window as unknown as { __nadiViewport?: { project?: unknown } }).__nadiViewport?.project === 'function');
  const box = (await page.locator('canvas.maplibregl-canvas').first().boundingBox())!;
  await dragTileTo(page, 'tile-road-closure', box.x + 40, box.y + box.height - 40); // the corner: no mock edge there
  await expect(page.getByTestId('drop-miss')).toBeVisible();
  await expect(page.getByTestId('drop-form')).toHaveCount(0);
  await expect(draftRows(page)).toHaveCount(0);
});

test('V2.7d C5: a member added from a drop pins its tile icon at the drop point', async ({ page }) => {
  await mockBackend(page, { partner: true });
  await openEdit(page);
  await page.waitForFunction(() => typeof (window as unknown as { __nadiViewport?: { project?: unknown } }).__nadiViewport?.project === 'function');
  const g = EDGES[0].geometry;
  const mid: [number, number] = [(g[0][0] + g[g.length - 1][0]) / 2, (g[0][1] + g[g.length - 1][1]) / 2];
  const p = await projectPx(page, mid);
  await dragTileTo(page, 'tile-road-closure', p.x, p.y);
  await expect(page.getByTestId('drop-form')).toBeVisible();
  await page.getByTestId('apply-road-closure').click();
  await expect(draftRows(page)).toHaveCount(1);
  await expect(page.getByTestId('draft-pin-d1')).toBeVisible();
  // the pin is DOM, anchored by the map's projection — within a few px of where the tile was released
  const pin = (await page.getByTestId('draft-pin-d1').boundingBox())!;
  expect(Math.abs(pin.x + pin.width / 2 - p.x)).toBeLessThan(12);
  expect(Math.abs(pin.y + pin.height / 2 - p.y)).toBeLessThan(12);
});

test('V2.7d C4b: a road closure on a two-way street — one direction by default, SAID; both directions = 2 members', async ({ page }) => {
  const getBody = await mockBackend(page, { partner: true });
  await openEdit(page);
  await page.evaluate(() =>
    (window as unknown as { __nadiEditEdge: (x: string, k?: string) => void }).__nadiEditEdge('E_A', 'road_closure'));
  await expect(page.getByTestId('drop-form')).toBeVisible();
  await expect(page.getByTestId('both-directions')).not.toBeChecked(); // default OFF — the single-change wire pin stands
  await expect(page.getByTestId('drop-direction-note')).toHaveText('closes northbound only — southbound stays open');
  await page.getByTestId('both-directions').check();
  await expect(page.getByTestId('drop-direction-note')).toHaveText('closes both directions — 2 members');
  await page.getByTestId('apply-road-closure').click();
  await expect(draftRows(page)).toHaveCount(2);
  await expect(page.getByTestId('draft-member-d1')).toContainText('Road closed · edge E_A');
  await expect(page.getByTestId('draft-member-d2')).toContainText('Road closed · edge -E_A');
  await page.getByTestId('draft-run').click();
  await expect.poll(() => getBody()?.changes).toBeTruthy();
  const body = getBody() as { changes: { type: string; target_edge: string }[] };
  expect(body.changes.map((c) => [c.type, c.target_edge])).toEqual([['road_closure', 'E_A'], ['road_closure', '-E_A']]);
});

test('V2.7d C4b: a speed limit from the road card applies to both directions only when asked, with its own note', async ({ page }) => {
  const getBody = await mockBackend(page, { partner: true });
  await openEdit(page);
  await pickEdge(page, 'E_A'); // the road card
  await expect(page.getByTestId('drop-direction-note')).toHaveText('applies to northbound only — southbound unchanged');
  await page.getByTestId('both-directions').check();
  await expect(page.getByTestId('drop-direction-note')).toHaveText('applies to both directions — 2 members');
  await page.getByTestId('palette-speed').fill('8');
  await page.getByTestId('apply-speed').click();
  await expect(draftRows(page)).toHaveCount(2);
  await page.getByTestId('draft-run').click();
  await expect.poll(() => getBody()?.changes).toBeTruthy();
  const body = getBody() as { changes: { type: string; target_edge: string; description: string }[] };
  expect(body.changes.map((c) => [c.type, c.target_edge, c.description])).toEqual([
    ['speed_limit', 'E_A', 'Speed limit on E_A -> 8 m/s'],
    ['speed_limit', '-E_A', 'Speed limit on -E_A -> 8 m/s'],
  ]);
});
const draftSeam = (page: Page) =>
  page.evaluate(() => (window as unknown as { __nadiDraftOverlay: DraftSeam }).__nadiDraftOverlay);

test('mixed 3-member draft: adds accumulate, draft-level D1 lock, hover seam, remove, one composite POST', async ({ page }) => {
  const getBody = await mockBackend(page);
  await openEdit(page);

  // member d1 — speed_limit on E_A: ADD, not a POST; the palette closes, the panel appears
  await pickEdge(page, 'E_A');
  await page.getByTestId('palette-speed').fill('8');
  await page.getByTestId('apply-speed').click();
  await expect(page.getByTestId('edge-palette')).toBeHidden();
  await expect(page.getByTestId('draft-panel')).toBeVisible();
  await expect(draftRows(page)).toHaveCount(1);
  expect(getBody()).toBeNull(); // nothing on the wire until Run

  // member d2 — WINDOWED lane_closure on E_B: after the add the palette is gone, yet the D1 lock
  // must hold at DRAFT level (the draft owns a windowed member now)
  await pickEdge(page, 'E_B');
  await page.getByTestId('palette-type-lane-closure').click();
  await page.getByTestId('lane-check-0').check();
  await page.getByTestId('window-start').fill('10');
  await page.getByTestId('window-duration').fill('20');
  await page.getByTestId('apply-lane-closure').click();
  await expect(draftRows(page)).toHaveCount(2);
  await expect(page.getByTestId('edge-palette')).toBeHidden();
  await expect(page.getByTestId('option-assignment')).toBeDisabled();
  await expect(page.getByTestId('assignment-locked-reason')).toHaveText(D1_REASON);

  // member d3 — incident (slowdown only) on E_C
  await pickEdge(page, 'E_C');
  await page.getByTestId('palette-type-incident').click();
  await page.getByTestId('window-start').fill('10');
  await page.getByTestId('window-duration').fill('30');
  await page.getByTestId('incident-slowdown').selectOption('50');
  await page.getByTestId('apply-incident').click();
  await expect(draftRows(page)).toHaveCount(3);

  // hover highlights that member's overlay (the seam mirrors the hovered id)
  await page.getByTestId('draft-member-d2').hover();
  await expect.poll(() => draftSeam(page).then((s) => s.hoveredId)).toBe('d2');
  await page.getByTestId('draft-run').hover();
  await expect.poll(() => draftSeam(page).then((s) => s.hoveredId)).toBeNull();

  // remove the windowed member → 2 rows
  await page.getByTestId('draft-remove-d2').click();
  await expect(draftRows(page)).toHaveCount(2);

  // run → ONE composite POST of the two survivors
  await page.getByTestId('draft-run').click();
  await expect(page.getByTestId('run-card')).toBeVisible();
  const body = getBody() as {
    change?: unknown; changes?: { type: string; target_edge: string }[]; tags?: string[]; assignment?: string;
  } | null;
  expect(body?.change).toBeUndefined();
  expect(body?.tags).toBeUndefined();
  expect(body?.assignment).toBe('day_one'); // the incident member keeps the draft windowed
  expect(body?.changes).toHaveLength(2);
  expect((body?.changes ?? []).map((m) => m.target_edge).sort()).toEqual(['E_A', 'E_C']);
  expect((body?.changes ?? []).map((m) => m.type).sort()).toEqual(['incident', 'speed_limit']);

  // the referendum guard holds over the whole edit rail
  const text = await page.getByTestId('edit-panel').innerText();
  expect(BANNED.test(text)).toBe(false);
  expect(STANCE_TALLY.test(text)).toBe(false);
});

test('single-change draft submits today\'s exact wire shape (regression pin)', async ({ page }) => {
  const getBody = await mockBackend(page);
  await openEdit(page);
  await pickEdge(page, 'E_A');
  await page.getByTestId('palette-speed').fill('8');
  await page.getByTestId('apply-speed').click();
  await expect(draftRows(page)).toHaveCount(1);
  await page.getByTestId('draft-run').click();
  await expect(page.getByTestId('run-card')).toBeVisible();
  const body = getBody() as { change?: Record<string, unknown>; changes?: unknown; tags?: unknown } | null;
  // byte-for-byte today's single shape: {change} with the client description, never {changes}/{tags}
  expect(body?.changes).toBeUndefined();
  expect(body?.tags).toBeUndefined();
  expect(body?.change).toEqual({
    type: 'speed_limit',
    target_edge: 'E_A',
    value_mps: 8,
    description: 'Speed limit on E_A -> 8 m/s',
  });
});

test('settled + severing member blocks with the shared reason; toggling clears it', async ({ page }) => {
  await mockBackend(page);
  await openEdit(page);

  // an unwindowed road_closure severs; day_one → no blocker
  await pickEdge(page, 'E_A');
  await page.getByTestId('palette-type-road-closure').click();
  await page.getByTestId('apply-road-closure').click();
  await expect(draftRows(page)).toHaveCount(1);
  await expect(page.getByTestId('draft-blocker')).toHaveCount(0);
  await expect(page.getByTestId('draft-run')).toBeEnabled();

  // settled → the blocker appears with the shared reason VERBATIM and Run disables
  await page.getByTestId('option-assignment').check();
  await expect(page.getByTestId('draft-blocker')).toHaveText(REASON_SETTLED_SEVERED);
  await expect(page.getByTestId('draft-run')).toBeDisabled();
  await page.getByTestId('option-assignment').uncheck();
  await expect(page.getByTestId('draft-blocker')).toHaveCount(0);
  await expect(page.getByTestId('draft-run')).toBeEnabled();

  // the lane_closure-closes-EVERY-car-lane variant severs identically
  await page.getByTestId('draft-remove-d1').click();
  await expect(draftRows(page)).toHaveCount(0);
  await pickEdge(page, 'E_A');
  await page.getByTestId('palette-type-lane-closure').click();
  await page.getByTestId('lane-check-1').check();
  await page.getByTestId('lane-check-2').check();
  await page.getByTestId('apply-lane-closure').click();
  await page.getByTestId('option-assignment').check();
  await expect(page.getByTestId('draft-blocker')).toHaveText(REASON_SETTLED_SEVERED);
  await expect(page.getByTestId('draft-run')).toBeDisabled();
});

test('same-edge crossing windows block with the LIFO reason; touching windows stay legal', async ({ page }) => {
  await mockBackend(page);
  await openEdit(page);

  // windowed lane_closure 10–30 min on E_A
  await pickEdge(page, 'E_A');
  await page.getByTestId('palette-type-lane-closure').click();
  await page.getByTestId('lane-check-1').check();
  await page.getByTestId('window-start').fill('10');
  await page.getByTestId('window-duration').fill('20');
  await page.getByTestId('apply-lane-closure').click();
  await expect(draftRows(page)).toHaveCount(1);

  // crossing road_closure 20–40 min on the SAME edge → the exact shared LIFO reason, Run disabled
  await pickEdge(page, 'E_A');
  await page.getByTestId('palette-type-road-closure').click();
  await page.getByTestId('window-start').fill('20');
  await page.getByTestId('window-duration').fill('20');
  await page.getByTestId('apply-road-closure').click();
  await expect(page.getByTestId('draft-blocker')).toHaveText(LIFO_A);
  await expect(page.getByTestId('draft-run')).toBeDisabled();

  // removing the crossing member clears it
  await page.getByTestId('draft-remove-d2').click();
  await expect(page.getByTestId('draft-blocker')).toHaveCount(0);

  // TOUCHING window 30–50 min (end == start at the shared minute) is LEGAL — the UI half of the
  // boundary pin (the second-sharp half is the t=499/500/501 function pin above)
  await pickEdge(page, 'E_A');
  await page.getByTestId('palette-type-road-closure').click();
  await page.getByTestId('window-start').fill('30');
  await page.getByTestId('window-duration').fill('20');
  await page.getByTestId('apply-road-closure').click();
  await expect(draftRows(page)).toHaveCount(2);
  await expect(page.getByTestId('draft-blocker')).toHaveCount(0);
  await expect(page.getByTestId('draft-run')).toBeEnabled();
});

test('zone macro lands N members + tag in the draft; ONE POST only on Run', async ({ page }) => {
  const getBody = await mockBackend(page);
  await openEdit(page);
  await page.getByTestId('zone-mode-toggle').click();
  await expect(page.getByTestId('zone-palette')).toBeVisible();
  for (const e of EDGES) {
    await page.evaluate((eid) => (window as unknown as { __nadiEditEdge: (x: string) => void }).__nadiEditEdge(eid), e.id);
  }
  await expect(page.getByTestId('zone-edge-list').locator('li')).toHaveCount(3);
  await page.getByTestId('zone-window-start').fill('10');
  await page.getByTestId('zone-window-duration').fill('10');
  await page.getByTestId('apply-school-zone').click();

  // macro semantics: NO POST — N members + the tag land in the draft, zone mode exits
  expect(getBody()).toBeNull();
  await expect(page.getByTestId('zone-palette')).toBeHidden();
  await expect(draftRows(page)).toHaveCount(3);
  await expect(page.getByTestId('draft-tag')).toHaveText('school_zone');
  // the zone members are windowed → the draft holds the D1 lock after the palette is gone
  await expect(page.getByTestId('option-assignment')).toBeDisabled();
  await expect(page.getByTestId('assignment-locked-reason')).toHaveText(D1_REASON);

  await page.getByTestId('draft-run').click();
  await expect(page.getByTestId('run-card')).toBeVisible();
  const body = getBody() as {
    change?: unknown; changes?: { type: string; target_edge: string; value_mps: number; window: { start_s: number; end_s: number } }[];
    tags?: string[]; assignment?: string;
  } | null;
  expect(body?.change).toBeUndefined();
  expect(body?.tags).toEqual(['school_zone']);
  expect(body?.assignment).toBe('day_one');
  expect(body?.changes).toHaveLength(3);
  expect((body?.changes ?? []).map((m) => m.target_edge).sort()).toEqual(['E_A', 'E_B', 'E_C']);
  for (const m of body?.changes ?? []) {
    expect(m).toMatchObject({ type: 'speed_limit', window: { start_s: 600, end_s: 1200 } });
    expect(m.value_mps).toBeCloseTo(30 / 3.6, 3);
  }
});

test('a server rejection (the one-job 409) renders verbatim in draft-error and the draft survives', async ({ page }) => {
  // Mocked-error tests verify RENDERING, not server reality — so pin only PERMANENT error shapes.
  // This detail is the real one-job-lock template (server.py `a job is already running
  // ({run_state.active()}); one job at a time`), producible forever. The first version of this
  // test mocked REASON_COMPOSITE_MEMBER — a transitional 400 V2.4b deletes — and, being mocked,
  // would have stayed green while pinning a rejection the server can no longer produce
  // (review-caught).
  const reason = 'a job is already running (multimodal-scenario-20260101T000000Z); one job at a time';
  const getBody = await mockBackend(page, { reject: { status: 409, detail: reason } });
  await openEdit(page);
  await pickEdge(page, 'E_A');
  await page.getByTestId('palette-speed').fill('8');
  await page.getByTestId('apply-speed').click();
  await pickEdge(page, 'E_B');
  await page.getByTestId('palette-type-road-closure').click();
  await page.getByTestId('apply-road-closure').click();
  await expect(draftRows(page)).toHaveCount(2);
  await page.getByTestId('draft-run').click();
  await expect(page.getByTestId('draft-error')).toHaveText(reason); // the backend's words, verbatim
  await expect(draftRows(page)).toHaveCount(2); // the draft is retained, not cleared
  expect((getBody() as { changes?: unknown[] } | null)?.changes).toHaveLength(2);
});
