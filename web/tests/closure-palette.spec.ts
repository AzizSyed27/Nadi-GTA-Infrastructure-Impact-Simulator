import { test, expect, type Page } from '@playwright/test';
import { mockDefaultArtifact } from './support/default-artifact';

// V2.2c — the palette's closure/incident actions: the lane picker (REAL car-lane indices), the
// window inputs (minutes -> sim-seconds on the wire; clock labels on calibrated), the windowed →
// day_one lock with the EXACT D1 reason, and server-400s rendered verbatim. NEW file: existing
// specs stay byte-identical.

const RUN_ID = 'multimodal-scenario-closurepalette-fixture';
const J1 = { id: 'J1', lon: -79.2229, lat: 43.7443, type: 'priority', n_in: 4, n_out: 4 };
// lane 0 is the sidewalk — car lanes are the REAL indices [1, 2] (labels render as "lane 1/2").
const E = {
  id: 'E_CAP', geometry: [[-79.222, 43.744], [-79.214, 43.75]], speed_mps: 13.9,
  car_lane_count: 2, car_lane_indices: [1, 2], eligible_bike_lane: true, eligibility_reason: 'eligible',
};
const D1_REASON = 'temporary events have no equilibrium; use day-one response';

const BANNED = /\b(majority|minority|referendum|consensus|unanimous|plurality)\b/i;

async function mockBackend(page: Page, opts: { reject400?: string } = {}) {
  await mockDefaultArtifact(page); // V2.5c: the default pointer pair — never the real latest.json
  let lastBody: Record<string, unknown> | null = null;
  await page.route('**/api/junctions**', (route) => route.fulfill({ json: { junctions: [J1], count: 1 } }));
  await page.route('**/network.json', (route) =>
    route.fulfill({ json: { edges: [{ id: E.id, geometry: E.geometry, lanes: 3, speed_mps: E.speed_mps, oneway: false, allows: { car: true, bike: true, ped: true } }] } }));
  await page.route('**/api/edges**', (route) =>
    route.fulfill({ json: { edges: [{ id: E.id, car_lane_count: E.car_lane_count, car_lane_indices: E.car_lane_indices, eligible_bike_lane: E.eligible_bike_lane, eligibility_reason: E.eligibility_reason }], count: 1 } }));
  await page.route('**/api/simulate', (route) => {
    lastBody = route.request().postDataJSON();
    if (opts.reject400) return route.fulfill({ status: 400, json: { detail: opts.reject400 } });
    return route.fulfill({ json: { run_id: RUN_ID } });
  });
  await page.route('**/api/runs', (route) => route.fulfill({ json: { runs: [] } }));
  await page.route('**/api/runs/*/status', (route) =>
    route.fulfill({ json: { run_id: RUN_ID, stage: 'baseline', status: 'running', change: { type: 'lane_closure' }, description: 'fixture' } }));
  return () => lastBody;
}

async function openPalette(page: Page) {
  await page.goto('/');
  // warm-reload convention (compare.spec.ts): the tiny DEFAULT fixture (V2.5c pointer pair)
  // can land inside StrictMode's double-mount window and crash maplibre teardown — reload
  // once before interacting.
  await page.getByTestId('stage-build').waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
  await page.reload();
  await page.getByTestId('stage-build').click();
  await page.waitForFunction(() => typeof (window as unknown as { __nadiEditEdge?: unknown }).__nadiEditEdge === 'function');
  await page.waitForFunction(() => ((window as unknown as { __nadiNetworkEdges?: number }).__nadiNetworkEdges ?? 0) > 0);
  await page.evaluate((eid) => (window as unknown as { __nadiEditEdge: (x: string) => void }).__nadiEditEdge(eid), E.id);
  await expect(page.getByTestId('edge-palette')).toBeVisible();
}

test('lane picker renders the real car-lane indices and posts a lane_closure body', async ({ page }) => {
  const getBody = await mockBackend(page);
  await openPalette(page);
  await page.getByTestId('palette-type-lane-closure').click();
  // the picker shows one checkbox per REAL car-lane index (sidewalk lane 0 is never offered)
  await expect(page.getByTestId('lane-check-1')).toBeVisible();
  await expect(page.getByTestId('lane-check-2')).toBeVisible();
  expect(await page.getByTestId('lane-picker').locator('input').count()).toBe(2);
  // apply gates on >=1 lane picked
  await expect(page.getByTestId('apply-lane-closure')).toBeDisabled();
  await page.getByTestId('lane-check-1').check();
  await expect(page.getByTestId('apply-lane-closure')).toBeEnabled();
  await page.getByTestId('apply-lane-closure').click();
  await page.getByTestId('draft-run').click(); // V2.4a: apply adds to the draft; Run submits it
  await expect(page.getByTestId('run-card')).toBeVisible();
  const body = getBody() as { change: Record<string, unknown>; assignment?: string } | null;
  expect(body?.change).toMatchObject({ type: 'lane_closure', target_edge: E.id, target_lanes: [1] });
  expect(body?.change.window).toBeUndefined(); // unwindowed: whole-run closure
});

test('window inputs lock assignment to day_one with the exact D1 reason; clearing unlocks', async ({ page }) => {
  await mockBackend(page);
  await openPalette(page);
  await page.getByTestId('option-assignment').check(); // settled selected before the window
  await page.getByTestId('palette-type-lane-closure').click();
  await page.getByTestId('window-start').fill('10');
  await page.getByTestId('window-duration').fill('20');
  await expect(page.getByTestId('option-assignment')).toBeDisabled();
  await expect(page.getByTestId('option-assignment')).not.toBeChecked(); // forced back to day_one
  await expect(page.getByTestId('assignment-locked-reason')).toHaveText(D1_REASON);
  // synthetic profile → the label echoes input units (minutes)
  await expect(page.getByTestId('window-label')).toContainText('10–30 min');
  await page.getByTestId('window-start').fill('');
  await page.getByTestId('window-duration').fill('');
  await expect(page.getByTestId('option-assignment')).toBeEnabled();
  // no tallies anywhere on the edit surfaces
  expect(BANNED.test(await page.getByTestId('edit-panel').innerText())).toBe(false);
});

test('calibrated profile renders the window label as clock times (t=0 == 07:00)', async ({ page }) => {
  await mockBackend(page);
  await openPalette(page);
  await page.getByTestId('option-demand').selectOption('calibrated_am_peak');
  await page.getByTestId('palette-type-road-closure').click();
  await page.getByTestId('window-start').fill('10');
  await page.getByTestId('window-duration').fill('20');
  await expect(page.getByTestId('window-label')).toContainText('07:10–07:30');
});

test('incident locks immediately, gates on effect+window, posts effect/window/lanes', async ({ page }) => {
  const getBody = await mockBackend(page);
  await openPalette(page);
  await page.getByTestId('palette-type-incident').click();
  // an incident is ALWAYS windowed — the lock engages on selection, before any input
  await expect(page.getByTestId('option-assignment')).toBeDisabled();
  await expect(page.getByTestId('assignment-locked-reason')).toHaveText(D1_REASON);
  await expect(page.getByTestId('apply-incident')).toBeDisabled(); // no window, no effect yet
  await page.getByTestId('window-start').fill('10');
  await page.getByTestId('window-duration').fill('30');
  await expect(page.getByTestId('apply-incident')).toBeDisabled(); // window alone is not an effect
  await page.getByTestId('lane-check-1').check();
  await page.getByTestId('incident-slowdown').selectOption('50');
  await expect(page.getByTestId('apply-incident')).toBeEnabled();
  await page.getByTestId('apply-incident').click();
  await page.getByTestId('draft-run').click(); // V2.4a: apply adds to the draft; Run submits it
  await expect(page.getByTestId('run-card')).toBeVisible(); // sync barrier before reading the body
  const body = getBody() as { change: Record<string, unknown>; assignment?: string } | null;
  expect(body?.change).toMatchObject({
    type: 'incident', target_edge: E.id, target_lanes: [1],
    window: { start_s: 600, end_s: 2400 },
    effect: { blocked: true, speed_factor: 0.5 },
  });
  expect(body?.assignment ?? 'day_one').toBe('day_one'); // belt-and-braces under the lock
});

test('road_closure posts a windowed body; a server 400 renders verbatim in draft-error', async ({ page }) => {
  const reason = "target_lanes [9] are not car lanes on edge 'E_CAP' (car lanes: [1, 2]) — lane_closure only closes car lanes; use road_closure to close the road";
  const getBody = await mockBackend(page, { reject400: reason });
  await openPalette(page);
  await page.getByTestId('palette-type-road-closure').click();
  await page.getByTestId('window-start').fill('5');
  await page.getByTestId('window-duration').fill('15');
  await page.getByTestId('apply-road-closure').click();
  await page.getByTestId('draft-run').click(); // V2.4a: the POST (and its 400) happens on Run
  await expect(page.getByTestId('draft-error')).toHaveText(reason); // the backend's words, verbatim
  const body = getBody() as { change: Record<string, unknown> } | null;
  expect(body?.change).toMatchObject({ type: 'road_closure', target_edge: E.id, window: { start_s: 300, end_s: 1200 } });
});
