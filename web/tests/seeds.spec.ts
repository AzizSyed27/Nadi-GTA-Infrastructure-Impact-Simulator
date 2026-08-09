import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// V2.1d — seeds as a run option, ranges in the scorecard. NEW spec file: every existing spec stays
// byte-identical (single-seed rails/renders unchanged). The finished run resolves to the committed
// fixture seeds-run.json — a REAL 0.8.0 artifact whose ranges came from the actual
// scorecard.attach_ranges (test_seeds_fixture.py pins that), loaded through the normal
// loadArtifact -> ScorecardPanel -> ScoreCell path. No test-only props: the fixture flip and a live
// flip hit the SAME render branch.

const SEED_RUN_ID = 'multimodal-scenario-seeds-fixture';
const FIXTURE = path.join(__dirname, 'fixtures', 'seeds-run.json');
const J1 = { id: 'J1', lon: -79.2229, lat: 43.7443, type: 'priority', n_in: 4, n_out: 4 };
const E_ELIG = { id: 'E_ELIG', geometry: [[-79.222, 43.744], [-79.214, 43.75]], speed_mps: 13.9, car_lane_count: 2, eligible_bike_lane: true, eligibility_reason: 'eligible', oneway: false };

// The same referendum litmus as edit.spec / discourse.spec — multi-seed copy must not invent tallies.
const BANNED = /\b(majority|minority|referendum|consensus|unanimous|plurality)\b/i;
const STANCE_TALLY = /\d+\s*%[^.]{0,24}(support|oppos|favou?r|against)|\bfinal (distribution|tally|result|vote)\b|\d+\s+for\s*\/\s*\d+\s+against/i;

const RUNTIME_STAGES = ['baseline', 'scenario', 'analysis', 'done'];

async function mockBackend(page: Page, opts: { seedDetail?: boolean } = {}) {
  const statusCalls: Record<string, number> = {};
  let lastBody: Record<string, unknown> | null = null;

  await page.route('**/api/junctions**', (route) => route.fulfill({ json: { junctions: [J1], count: 1 } }));
  await page.route('**/network.json', (route) =>
    route.fulfill({ json: { edges: [{ id: E_ELIG.id, geometry: E_ELIG.geometry, lanes: 2, speed_mps: E_ELIG.speed_mps, oneway: false, allows: { car: true, bike: true, ped: true } }] } }));
  await page.route('**/api/edges**', (route) =>
    route.fulfill({ json: { edges: [{ id: E_ELIG.id, car_lane_count: 2, eligible_bike_lane: true, eligibility_reason: 'eligible' }], count: 1 } }));
  await page.route('**/api/simulate', (route) => {
    lastBody = route.request().postDataJSON();
    return route.fulfill({ json: { run_id: SEED_RUN_ID } });
  });
  await page.route('**/api/runs', (route) =>
    route.fulfill({ json: { runs: [{ id: SEED_RUN_ID, description: '3-seed fixture run', status: 'done', stage: 'done', started_at: 1 }] } }));
  await page.route('**/api/runs/*/status', (route) => {
    const n = (statusCalls[SEED_RUN_ID] = (statusCalls[SEED_RUN_ID] ?? 0) + 1);
    const stage = RUNTIME_STAGES[Math.min(n - 1, RUNTIME_STAGES.length - 1)];
    const done = stage === 'done';
    // Mid-run, the probe pairs surface via the detail chip under the UNCHANGED 'scenario' stage.
    const detail = opts.seedDetail && stage === 'scenario' ? 'seed probe 43 — pair 2/3: baseline leg' : undefined;
    return route.fulfill({
      json: {
        run_id: SEED_RUN_ID, stage, status: done ? 'done' : 'running', n_seeds: 3, detail,
        change: { type: 'bike_lane' }, description: '3-seed fixture run',
        ...(done ? { cars_rerouted: 0, car_median_delta_s: 2.1, car_affected_share: 0.18 } : {}),
      },
    });
  });
  // The finished run's artifact = the committed REAL 0.8.0 fixture.
  await page.route(`**/${SEED_RUN_ID}.json`, (route) =>
    route.fulfill({ body: fs.readFileSync(FIXTURE, 'utf-8'), contentType: 'application/json' }));
  return () => lastBody;
}

test('the seeds option posts n_seeds=3 and the run shows the seeds chip with probe detail', async ({ page }) => {
  const getBody = await mockBackend(page, { seedDetail: true });
  await page.goto('/');
  await page.getByTestId('mode-edit').click();
  await expect(page.getByTestId('run-options')).toBeVisible();

  // Toggle the robustness probe on -> the POST body carries n_seeds: 3.
  await page.getByTestId('option-seeds').check();
  await page.waitForFunction(() => typeof (window as unknown as { __nadiEditEdge?: unknown }).__nadiEditEdge === 'function');
  await page.waitForFunction(() => ((window as unknown as { __nadiNetworkEdges?: number }).__nadiNetworkEdges ?? 0) > 0);
  await page.evaluate((eid) => (window as unknown as { __nadiEditEdge: (x: string) => void }).__nadiEditEdge(eid), E_ELIG.id);
  await expect(page.getByTestId('edge-palette')).toBeVisible();
  await page.getByTestId('apply-bike-lane').click();
  await page.getByTestId('draft-run').click(); // V2.4a: apply adds to the draft; Run submits it
  await expect(page.getByTestId('run-card')).toBeVisible();
  expect(getBody()?.n_seeds).toBe(3);

  // The seeds chip is present and, during the probe pass, carries the per-probe detail.
  await expect(page.getByTestId('seeds-chip')).toBeVisible();
  await expect(page.getByTestId('seeds-chip')).toContainText('robustness probe: 3 seeds (42, 43, 44)');
  await expect(page.getByTestId('seeds-chip')).toContainText('seed probe 43 — pair 2/3');

  // The stage rail is IDENTICAL to a single-seed runtime run — no new stages for probes.
  await expect(page.getByTestId('run-stages')).toContainText('Baseline run');
  await expect(page.getByTestId('run-stages')).not.toContainText('Regenerating network');
  const stages = await page.getByTestId('run-stages').locator('li').allInnerTexts();
  expect(stages).toEqual(['Queued', 'Baseline run', 'Scenario run', 'Analysis', 'Done']);
});

test('ranged cells render ranges; sign-unstable cells are neutral with the SIGN? badge', async ({ page }) => {
  await mockBackend(page);
  await page.goto('/');
  await page.getByTestId('mode-edit').click();
  await page.getByTestId('run-select').selectOption(SEED_RUN_ID);
  await page.waitForResponse((r) => r.url().includes(`${SEED_RUN_ID}.json`));
  await expect(page.getByTestId('scorecard-panel')).toBeVisible({ timeout: 20_000 });

  // The stable car travel cell shows the range sub-line — the ratified "+1.8 to +2.9s" form.
  await expect(page.getByTestId('scorecard-panel')).toContainText('+1.8 to +2.9s · 3 seeds');

  // Sign-unstable cells carry the SIGN? badge (cyclist travel + the safety flips — the V1 lesson live).
  expect(await page.getByTestId('unstable-badge').count()).toBeGreaterThanOrEqual(2);

  // NEUTRALITY (revision 3): the unstable cyclist travel cell (canonical +2.3, range −1.4..+5.1)
  // renders "±2.3s" — its signed form must not appear anywhere on the page. The stable car cell's
  // "+2.1s" DOES render (direction earned). Signed range ENDPOINTS are the deliberate exception.
  const body = await page.locator('body').innerText();
  expect(body).toContain('±2.3s');
  expect(body).not.toContain('+2.3s');
  expect(body).toContain('+2.1s');

  // Safety stays a no-sign-character surface even with a range: absolute endpoints only.
  expect(body).toMatch(/±1\.20 to ±2\.40/); // car safety range (−1.2..2.4 → abs-sorted)

  // Referendum guard holds over the multi-seed surfaces.
  expect(body).not.toMatch(BANNED);
  expect(body).not.toMatch(STANCE_TALLY);
  await page.screenshot({ path: 'test-results/seeds-scorecard.png' });
});
