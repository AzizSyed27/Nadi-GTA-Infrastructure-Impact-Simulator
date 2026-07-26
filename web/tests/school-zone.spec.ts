import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// V2.2d — the school zone: the FIRST real multi-change scenario. Palette flow (accumulate-select →
// one composite POST + tags), the always-visible zone tint with its DESIGNATION legend sentence,
// windowed-LEGACY time-gating (speed_limit members appear/disappear at their window in playback),
// the RunCard zone chip, and compare's mechanical mismatch over composites (window now in the key).
// Fixture: web/tests/fixtures/school-zone-run.json — a REAL producer artifact (pinned by
// python/tests/test_school_zone_fixture.py); its edges are real canonical network ids, so
// /network.json is served REAL (no mock) and the geometry join resolves.

const RUN_ID = 'multimodal-scenario-schoolzone-fixture';
const FIXTURE = path.join(__dirname, 'fixtures', 'school-zone-run.json');
const ZONE_LEGEND = 'school zone (designation, always shown) — reduced limits apply during the window';
const D1_REASON = 'temporary events have no equilibrium; use day-one response';
const BANNED = /\b(majority|minority|referendum|consensus|unanimous|plurality)\b/i;

type OverlaySeam = {
  count: number;
  zoneTagged: boolean;
  items: { type: string; windowed: boolean; active: boolean }[];
};

function fixture(): { body: string; edges: string[]; window: { start_s: number; end_s: number } } {
  const art = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
  const changes = art.meta.scenario.changes as { target_edge: string; window: { start_s: number; end_s: number } }[];
  return { body: JSON.stringify(art), edges: changes.map((c) => c.target_edge), window: changes[0].window };
}

/** Playback-view mocks: the artifact routes with the ~500 ms delay (compare.spec convention — a
 * tiny fixture resolving inside StrictMode's double-mount window crashes maplibre teardown);
 * network.json is REAL (the fixture's edges are canonical ids). */
async function mockLoadedRun(page: Page, artifactBody: string, extraRuns: { id: string; body: string }[] = []) {
  await page.route('**/api/junctions**', (route) => route.fulfill({ json: { junctions: [], count: 0 } }));
  await page.route('**/api/edges**', (route) => route.fulfill({ json: { edges: [], count: 0 } }));
  const runs = [{ id: RUN_ID, description: 'school zone fixture', status: 'done', stage: 'done', started_at: 2 },
                ...extraRuns.map((r, i) => ({ id: r.id, description: r.id, status: 'done', stage: 'done', started_at: 1 - i }))];
  await page.route('**/api/runs', (route) => route.fulfill({ json: { runs } }));
  await page.route('**/api/runs/*/status', (route) =>
    route.fulfill({ json: { run_id: RUN_ID, stage: 'done', status: 'done', description: 'school zone fixture' } }));
  await page.route(`**/${RUN_ID}.json`, async (route) => {
    await new Promise((res) => setTimeout(res, 500));
    await route.fulfill({ body: artifactBody, contentType: 'application/json' });
  });
  for (const r of extraRuns) {
    await page.route(`**/${r.id}.json`, (route) => route.fulfill({ body: r.body, contentType: 'application/json' }));
  }
}

async function warmOpen(page: Page) {
  await page.getByTestId('mode-edit').waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
  await page.reload();
  await expect(page.getByTestId('mode-edit')).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => {
    const s = (window as unknown as { __nadiChangeOverlay?: OverlaySeam }).__nadiChangeOverlay;
    return (s?.count ?? 0) > 0;
  }, undefined, { timeout: 20_000 });
}

async function seamState(page: Page): Promise<OverlaySeam> {
  return page.evaluate(() => (window as unknown as { __nadiChangeOverlay: OverlaySeam }).__nadiChangeOverlay);
}

// ---------------------------------------------------------------- 1. the palette flow

test('zone flow: accumulate streets, D1 lock, ONE composite POST with tags', async ({ page }) => {
  const E = (n: number) => ({
    id: `E_Z${n}`, geometry: [[-79.22 + n * 0.004, 43.744], [-79.218 + n * 0.004, 43.746]] as [number, number][],
  });
  const zone = [E(1), E(2), E(3)];
  let lastBody: Record<string, unknown> | null = null;
  await page.route('**/api/junctions**', (route) => route.fulfill({ json: { junctions: [], count: 0 } }));
  await page.route('**/network.json', (route) =>
    route.fulfill({ json: { edges: zone.map((e) => ({ id: e.id, geometry: e.geometry, lanes: 2, speed_mps: 13.9, oneway: false, allows: { car: true, bike: true, ped: true } })) } }));
  await page.route('**/api/edges**', (route) =>
    route.fulfill({ json: { edges: zone.map((e) => ({ id: e.id, car_lane_count: 2, car_lane_indices: [0, 1], eligible_bike_lane: true, eligibility_reason: 'eligible' })), count: 3 } }));
  await page.route('**/api/simulate', (route) => {
    lastBody = route.request().postDataJSON();
    return route.fulfill({ json: { run_id: RUN_ID } });
  });
  await page.route('**/api/runs', (route) => route.fulfill({ json: { runs: [] } }));
  await page.route('**/api/runs/*/status', (route) =>
    route.fulfill({ json: { run_id: RUN_ID, stage: 'baseline', status: 'running', description: 'zone fixture', tags: ['school_zone'] } }));

  await page.goto('/');
  // warm-reload convention (compare.spec.ts): cold dev compile + StrictMode detaches first paint
  await page.getByTestId('mode-edit').waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
  await page.reload();
  await expect(page.getByTestId('mode-edit')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('mode-edit').click();
  await page.waitForFunction(() => typeof (window as unknown as { __nadiEditEdge?: unknown }).__nadiEditEdge === 'function');
  await page.waitForFunction(() => ((window as unknown as { __nadiNetworkEdges?: number }).__nadiNetworkEdges ?? 0) > 0);
  await page.getByTestId('option-assignment').check(); // settled BEFORE the zone → must be forced back

  await page.getByTestId('zone-mode-toggle').click();
  await expect(page.getByTestId('zone-palette')).toBeVisible();
  // a zone draft is windowed BY DESIGN → the D1 lock engages on entry, with the exact reason
  await expect(page.getByTestId('option-assignment')).toBeDisabled();
  await expect(page.getByTestId('assignment-locked-reason')).toHaveText(D1_REASON);

  // accumulate three streets via the edge seam (the same onEditClick path a map click takes)
  for (const e of zone) {
    await page.evaluate((eid) => (window as unknown as { __nadiEditEdge: (x: string) => void }).__nadiEditEdge(eid), e.id);
  }
  await expect(page.getByTestId('zone-edge-list').locator('li')).toHaveCount(3);
  // remove + re-add: the list is editable, a second click on a selected street also removes it
  await page.getByTestId('zone-remove-E_Z2').click();
  await expect(page.getByTestId('zone-edge-list').locator('li')).toHaveCount(2);
  await page.evaluate(() => (window as unknown as { __nadiEditEdge: (x: string) => void }).__nadiEditEdge('E_Z2'));
  await expect(page.getByTestId('zone-edge-list').locator('li')).toHaveCount(3);

  await expect(page.getByTestId('apply-school-zone')).toBeDisabled(); // window required
  await page.getByTestId('zone-window-start').fill('10');
  await page.getByTestId('zone-window-duration').fill('10');
  await expect(page.getByTestId('zone-window-label')).toContainText('10–20 min');
  await expect(page.getByTestId('apply-school-zone')).toBeEnabled();
  await page.getByTestId('apply-school-zone').click();
  await expect(page.getByTestId('run-card')).toBeVisible();

  const body = lastBody as {
    changes?: { type: string; target_edge: string; value_mps: number; window: { start_s: number; end_s: number } }[];
    change?: unknown; tags?: string[]; assignment?: string;
  } | null;
  expect(body?.change).toBeUndefined(); // composite: never the single-change field
  expect(body?.tags).toEqual(['school_zone']);
  expect(body?.assignment).toBe('day_one'); // belt-and-braces under the lock
  expect(body?.changes).toHaveLength(3);
  // membership, not order: the remove + re-add step legitimately moved E_Z2 to the end
  expect((body?.changes ?? []).map((m) => m.target_edge).sort()).toEqual(['E_Z1', 'E_Z2', 'E_Z3']);
  for (const m of body?.changes ?? []) {
    expect(m).toMatchObject({ type: 'speed_limit', window: { start_s: 600, end_s: 1200 } });
    expect(m.value_mps).toBeCloseTo(30 / 3.6, 3); // 30 km/h default on the wire in m/s
  }
});

// ---------------------------------------------------------------- 2. tint + legend on a loaded run

test('loaded composite: 3 overlay items, zone designation legend sentence verbatim', async ({ page }) => {
  const { body } = fixture();
  await mockLoadedRun(page, body);
  await page.goto(`/?run=${RUN_ID}`);
  await warmOpen(page);

  const seam = await seamState(page);
  expect(seam.count).toBe(3);
  expect(seam.zoneTagged).toBe(true);
  expect(seam.items.every((i) => i.type === 'speed_limit' && i.windowed)).toBe(true);

  const legend = page.getByTestId('change-legend');
  await expect(legend).toContainText('3 changes');
  // the designation sentence — without it, yellow tint at t=0 with no overlay reads as a bug
  await expect(page.getByTestId('legend-zone')).toContainText(ZONE_LEGEND);

  const text = await page.locator('body').innerText();
  expect(BANNED.test(text)).toBe(false);
});

// ---------------------------------------------------------------- 3. windowed-LEGACY time-gating

test('windowed speed_limit members time-gate in playback; the zone designation never does', async ({ page }) => {
  const { body, window: w } = fixture();
  await mockLoadedRun(page, body);
  await page.goto(`/?run=${RUN_ID}`);
  await warmOpen(page);

  const scrubAndExpect = async (t: number, active: boolean) => {
    await page.locator('input[type=range]').first().fill(String(Math.round(t)));
    await page.waitForFunction(
      (exp) => {
        const s = (window as unknown as { __nadiChangeOverlay?: OverlaySeam }).__nadiChangeOverlay;
        return !!s && s.items.length === 3 && s.items.every((i) => i.active === exp);
      },
      active,
      { timeout: 3000 },
    );
  };

  await scrubAndExpect(w.start_s - 300, false); // before: reduced limits not yet claimed
  expect((await seamState(page)).zoneTagged).toBe(true); // …but the DESIGNATION tint stays
  await scrubAndExpect((w.start_s + w.end_s) / 2, true); // during: all three members show
  await scrubAndExpect(w.end_s + 300, false); // after: reverted — no limit claimed
  expect((await seamState(page)).zoneTagged).toBe(true);
});

test('an UNWINDOWED legacy change stays always-active (pixel-identical gating for old runs)', async ({ page }) => {
  const art = JSON.parse(fixture().body);
  for (const c of art.meta.scenario.changes) delete c.window; // permanent limits, same composite
  await mockLoadedRun(page, JSON.stringify(art));
  await page.goto(`/?run=${RUN_ID}`);
  await warmOpen(page);
  await page.locator('input[type=range]').first().fill('0');
  await page.waitForFunction(() => {
    const s = (window as unknown as { __nadiChangeOverlay?: OverlaySeam }).__nadiChangeOverlay;
    return !!s && s.items.length === 3 && s.items.every((i) => !i.windowed && i.active);
  }, undefined, { timeout: 3000 });
});

// ---------------------------------------------------------------- 4. the RunCard zone chip

test('the RunCard shows the zone chip (streets + window) and not a duplicate window chip', async ({ page }) => {
  const { body } = fixture();
  await mockLoadedRun(page, body);
  await page.route('**/api/runs/*/status', (route) =>
    route.fulfill({ json: {
      run_id: RUN_ID, stage: 'done', status: 'done',
      description: 'School zone: 30 km/h on 3 streets, from t=600 s to t=1200 s',
      tags: ['school_zone'],
      change: { type: 'speed_limit', target_edge: 'E1', window: { start_s: 600, end_s: 1200 } },
      changes: [
        { type: 'speed_limit', target_edge: 'E1', window: { start_s: 600, end_s: 1200 } },
        { type: 'speed_limit', target_edge: 'E2', window: { start_s: 600, end_s: 1200 } },
        { type: 'speed_limit', target_edge: 'E3', window: { start_s: 600, end_s: 1200 } },
      ],
      demand_profile: 'synthetic_demo', cars_rerouted: 12, car_median_delta_s: 0.4,
    } }));
  await page.goto('/');
  await page.getByTestId('mode-edit').waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
  await page.reload();
  await expect(page.getByTestId('mode-edit')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('mode-edit').click();
  await page.getByTestId('run-select').selectOption(RUN_ID);
  await expect(page.getByTestId('run-card')).toBeVisible();
  await expect(page.getByTestId('zone-chip')).toHaveText('School zone · 3 streets · t=600–1200 s');
  await expect(page.getByTestId('window-chip')).toHaveCount(0); // the zone chip carries the range
});

// ---------------------------------------------------------------- 5. compare over composites

test('compare: composite vs single-change mismatches; vs itself silent; window differences count', async ({ page }) => {
  const { body } = fixture();
  const single = JSON.parse(body);
  single.meta.run_id = 'sz-single';
  single.meta.scenario.changes = [single.meta.scenario.changes[0]];
  delete single.meta.scenario.tags;
  const twin = JSON.parse(body);
  twin.meta.run_id = 'sz-twin'; // identical physics, different id
  const shifted = JSON.parse(body);
  shifted.meta.run_id = 'sz-shifted'; // same edges+speeds, DIFFERENT hours — a real provenance difference
  for (const c of shifted.meta.scenario.changes) c.window = { start_s: 3600, end_s: 4200 };

  await mockLoadedRun(page, body, [
    { id: 'sz-single', body: JSON.stringify(single) },
    { id: 'sz-twin', body: JSON.stringify(twin) },
    { id: 'sz-shifted', body: JSON.stringify(shifted) },
  ]);
  await page.goto(`/?run=${RUN_ID}`);
  await warmOpen(page);
  await page.getByTestId('mode-compare').click();
  await expect(page.getByTestId('compare-view')).toBeVisible();

  const pickB = async (id: string) => {
    await page.getByTestId('compare-picker-b').getByTestId('run-select').selectOption(id);
    await expect(page.getByTestId('compare-picker-b')).toContainText(id);
  };

  await pickB('sz-single'); // fewer members = a different mechanical change set
  await expect(page.getByTestId('mismatch-line').and(page.locator('[data-field="changes"]'))).toBeVisible();

  await pickB('sz-twin'); // identical composite (tags are NOT in the key — same physics)
  await expect(page.getByTestId('mismatch-note')).toHaveCount(0);

  await pickB('sz-shifted'); // V2.2d: the WINDOW is mechanical — different hours mismatch
  await expect(page.getByTestId('mismatch-line').and(page.locator('[data-field="changes"]'))).toBeVisible();
});
