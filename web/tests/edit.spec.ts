import { test, expect, type Page } from '@playwright/test';

// Phase 5.2 — the editor UI. Backend is MOCKED (page.route) for determinism + speed; the two map clicks are
// injected via the dev/test seam window.__nadiEdit(lon,lat) so we exercise the real snap→form→submit→poll→load
// path without fighting the WebGL canvas hit-test. The finished run resolves to a REAL new_road artifact
// already in web/public (scorecard, no voices/social) so the scorecard-populated assertion is genuine.

const RUN_ID = 'multimodal-scenario-20260709T221140Z'; // real new_road quant artifact in web/public
const PRIOR_ID = 'multimodal-scenario-20260709T214747Z'; // a different real run, for the switcher
const J1 = { id: 'J1', lon: -79.2229, lat: 43.7443, type: 'priority', n_in: 4, n_out: 4 };
const J2 = { id: 'J2', lon: -79.21, lat: 43.755, type: 'priority', n_in: 3, n_out: 3 };
// The finished RUN_ID artifact's change junctions — so the 5.3 change-visibility overlay can resolve their coords.
const J_A = { id: '266262655', lon: -79.22289, lat: 43.744257, type: 'priority', n_in: 4, n_out: 4 };
const J_B = { id: '427757562', lon: -79.2153, lat: 43.7502, type: 'priority', n_in: 3, n_out: 3 };
// Existing edges for the edit-an-edge palette (one bike-eligible, one not — with the backend's reason string).
const E_ELIG = { id: 'E_ELIG', geometry: [[-79.222, 43.744], [-79.214, 43.75]], speed_mps: 13.9, car_lane_count: 2, eligible_bike_lane: true, eligibility_reason: 'eligible' };
const E_INELIG = { id: 'E_INELIG', geometry: [[-79.205, 43.752], [-79.198, 43.758]], speed_mps: 8.3, car_lane_count: 1, eligible_bike_lane: false, eligibility_reason: "bike_lane needs >= 2 car lanes on edge 'E_INELIG' so >= 1 remains for cars; found 1 ([0]). Refusing to block the edge." };

// The referendum guard (same litmus as discourse.spec) — must hold over the edit UI + empty states too.
const BANNED = /\b(majority|minority|referendum|consensus|unanimous|plurality)\b/i;
const STANCE_TALLY = /\d+\s*%[^.]{0,24}(support|oppos|favou?r|against)|\bfinal (distribution|tally|result|vote)\b|\d+\s+for\s*\/\s*\d+\s+against/i;

async function mockBackend(page: Page) {
  const statusCalls: Record<string, number> = {};
  let lastType = 'new_road'; // captured from the last /api/simulate POST → drives the status stage list
  const NEWROAD = ['regen', 'baseline', 'scenario', 'analysis', 'done'];
  const RUNTIME = ['baseline', 'scenario', 'analysis', 'done']; // runtime changes have NO regen stage

  await page.route('**/api/junctions**', (route) => route.fulfill({ json: { junctions: [J1, J2, J_A, J_B], count: 4 } }));
  await page.route('**/api/edges**', (route) => route.fulfill({ json: { edges: [E_ELIG, E_INELIG], count: 2 } }));
  await page.route('**/api/simulate', (route) => {
    lastType = route.request().postDataJSON()?.change?.type ?? 'new_road';
    return route.fulfill({ json: { run_id: RUN_ID } });
  });
  await page.route('**/api/runs', (route) =>
    route.fulfill({
      json: {
        runs: [
          { id: RUN_ID, description: 'New road J1->J2', status: 'done', stage: 'done', started_at: 2 },
          { id: PRIOR_ID, description: 'Prior road', status: 'done', stage: 'done', started_at: 1 },
        ],
      },
    }),
  );
  // status: PRIOR is already done; RUN_ID advances one stage per poll. Stage list + done payload depend on the
  // submitted change type (new_road → regen + cars_on_new_road; runtime → no regen + car delay summary).
  await page.route('**/api/runs/*/status', (route) => {
    const m = route.request().url().match(/\/api\/runs\/([^/]+)\/status/);
    const id = m ? decodeURIComponent(m[1]) : '';
    if (id === PRIOR_ID) {
      return route.fulfill({ json: { run_id: id, stage: 'done', status: 'done', cars_rerouted: 3, change: { type: 'new_road' }, description: 'Prior road' } });
    }
    const isNewRoad = lastType === 'new_road';
    const stages = isNewRoad ? NEWROAD : RUNTIME;
    const n = (statusCalls[id] = (statusCalls[id] ?? 0) + 1);
    const stage = stages[Math.min(n - 1, stages.length - 1)];
    const done = stage === 'done';
    const doneFields = isNewRoad
      ? { cars_rerouted: 7, cars_on_new_road: 7 }
      : { cars_rerouted: 0, car_median_delta_s: 45, car_affected_share: 0.2 }; // 0-reroute = absorbed as delay
    return route.fulfill({
      json: { run_id: id, stage, status: done ? 'done' : 'running', change: { type: lastType }, description: 'edit run', ...(done ? doneFields : {}) },
    });
  });
}

async function enterEditAndLoadJunctions(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('mode-edit')).toBeVisible(); // artifact loaded → map mounted → getBounds works
  // Arm the response wait BEFORE the click so a fast junctions fetch can't slip past it.
  const jResp = page.waitForResponse((r) => r.url().includes('/api/junctions'));
  await page.getByTestId('mode-edit').click();
  await expect(page.getByTestId('edit-panel')).toBeVisible();
  await expect(page.getByTestId('draw-card')).toBeVisible();
  await jResp;
  await page.waitForFunction(() => typeof (window as unknown as { __nadiEdit?: unknown }).__nadiEdit === 'function');
}

// Small typed helpers around the test seam.
async function seamClick(page: Page, lon: number, lat: number) {
  await page.evaluate(([lo, la]) => (window as unknown as { __nadiEdit: (a: number, b: number) => void }).__nadiEdit(lo, la), [lon, lat]);
}
async function seamHover(page: Page, lon: number, lat: number) {
  await page.evaluate(([lo, la]) => (window as unknown as { __nadiEditHover: (a: number, b: number) => void }).__nadiEditHover(lo, la), [lon, lat]);
}

test('draw a road, watch the staged run, land on a populated scorecard', async ({ page }) => {
  // Guard the deck.gl getCursor regression: after Simulate, `drawing` flips false — the overlay must still
  // supply a valid getCursor function, or deck's per-frame _updateCursor throws "getCursor is not a function".
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await mockBackend(page);
  await enterEditAndLoadJunctions(page);

  // First click snaps to J1; a hover toward J2 draws the rubber-band → screenshot the draw interaction.
  await seamClick(page, J1.lon, J1.lat);
  await seamHover(page, J2.lon, J2.lat);
  await expect(page.getByTestId('draw-card')).toContainText('Click a second junction');
  await page.screenshot({ path: 'test-results/edit-draw.png' });

  // Second click → the params mini-form with the RATIFIED defaults.
  await seamClick(page, J2.lon, J2.lat);
  await expect(page.getByTestId('params-form')).toBeVisible();
  await expect(page.getByTestId('param-lanes')).toHaveValue('2');
  await expect(page.getByTestId('param-speed')).toHaveValue('13.9');
  await expect(page.getByTestId('param-bidirectional')).toBeChecked();

  // Simulate → the run card appears and advances through the staged rail.
  await page.getByTestId('simulate-btn').click();
  await expect(page.getByTestId('run-card')).toBeVisible();
  await expect(page.getByTestId('run-stages')).toContainText('Baseline run');

  // On done: THE number + the loaded run's scorecard + the enrich buttons + honest empty states.
  await expect(page.getByTestId('reroute-number')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('reroute-number')).toContainText('rerouted onto the new road');
  // The scorecard renders only once the finished run's artifact has loaded — this waits for that load.
  await expect(page.getByTestId('scorecard-panel')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('enrich-voices')).toBeVisible();
  await expect(page.getByTestId('enrich-discourse')).toBeVisible();
  await expect(page.getByTestId('no-voices')).toBeVisible(); // fresh run has no voices — say so plainly
  // 5.3: the change-visibility overlay resolved the new_road location → the "proposed road" legend shows.
  await expect(page.getByTestId('change-legend')).toContainText('proposed road');
  await page.screenshot({ path: 'test-results/edit-finished.png' });

  // Referendum guard holds over the edit UI (no tallies / verdict language anywhere).
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(BANNED);
  expect(body).not.toMatch(STANCE_TALLY);

  // No deck.gl getCursor crash across the whole draw→submit→done flow (drawing flipped false post-submit).
  expect(pageErrors.filter((m) => /getCursor/i.test(m)), pageErrors.join('\n')).toHaveLength(0);
});

test('the run switcher restores a prior run', async ({ page }) => {
  await mockBackend(page);
  await page.goto('/');
  await page.getByTestId('mode-edit').click();
  await expect(page.getByTestId('run-switcher')).toBeVisible();

  // Pick the prior run → its artifact reloads and its (completed) run card shows.
  await page.getByTestId('run-select').selectOption(PRIOR_ID);
  await page.waitForResponse((r) => r.url().includes(`${PRIOR_ID}.json`));
  await expect(page.getByTestId('run-card')).toBeVisible();
  await expect(page.getByTestId('reroute-number')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('scorecard-panel')).toBeVisible();
});

test('discourse mode is locked until a run carries a social block', async ({ page }) => {
  await mockBackend(page);
  await page.goto('/');
  // Load a new_road run (no social) explicitly, then assert Discourse is locked — independent of latest.json,
  // which is now an arbitrary editor pointer.
  await page.getByTestId('mode-edit').click();
  await page.getByTestId('run-select').selectOption(RUN_ID);
  await page.waitForResponse((r) => r.url().includes(`${RUN_ID}.json`));
  // The loaded new_road run has no social → the Discourse toggle is disabled.
  await expect(page.getByTestId('mode-discourse')).toBeDisabled();
});

// ---- 5.2b: edit an existing edge ----
async function enterEditForEdges(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('mode-edit')).toBeVisible();
  await page.getByTestId('mode-edit').click();
  await expect(page.getByTestId('edit-panel')).toBeVisible();
  await page.waitForFunction(() => typeof (window as unknown as { __nadiEditEdge?: unknown }).__nadiEditEdge === 'function');
}
async function seamEdge(page: Page, edge: unknown) {
  await page.evaluate((e) => (window as unknown as { __nadiEditEdge: (x: unknown) => void }).__nadiEditEdge(e), edge);
}

test('edit an edge: ineligible bike-lane is greyed with the backend reason; eligible is enabled', async ({ page }) => {
  await mockBackend(page);
  await enterEditForEdges(page);

  // Ineligible edge → palette shows the bike option greyed, with the backend's reason (not the frontend's guess).
  await seamEdge(page, E_INELIG);
  await expect(page.getByTestId('edge-palette')).toBeVisible();
  await expect(page.getByTestId('apply-bike-lane')).toBeDisabled();
  await expect(page.getByTestId('bike-ineligible-reason')).toContainText('2 car lanes');
  await page.screenshot({ path: 'test-results/edit-edge-ineligible.png' });

  // Eligible edge → the bike option is enabled.
  await seamEdge(page, E_ELIG);
  await expect(page.getByTestId('edge-palette')).toBeVisible();
  await expect(page.getByTestId('apply-bike-lane')).toBeEnabled();
  await page.screenshot({ path: 'test-results/edit-edge-palette.png' });
});

test('a speed_limit submit walks the regen-free stages and reads 0-reroute as delay', async ({ page }) => {
  await mockBackend(page);
  await enterEditForEdges(page);
  await seamEdge(page, E_ELIG);
  await page.getByTestId('palette-speed').fill('8');
  await page.getByTestId('apply-speed').click();

  await expect(page.getByTestId('run-card')).toBeVisible();
  // Runtime change → the rail has Baseline but NO regen stage.
  await expect(page.getByTestId('run-stages')).toContainText('Baseline run');
  await expect(page.getByTestId('run-stages')).not.toContainText('Regenerating network');
  // On done: 0 reroute framed honestly + the car delay context.
  await expect(page.getByTestId('reroute-number')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('reroute-number')).toContainText('absorbed as delay');
  await expect(page.getByTestId('car-delay')).toBeVisible();
});
