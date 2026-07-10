import { test, expect, type Page } from '@playwright/test';

// Phase 5.2 — the editor UI. Backend is MOCKED (page.route) for determinism + speed; the two map clicks are
// injected via the dev/test seam window.__nadiEdit(lon,lat) so we exercise the real snap→form→submit→poll→load
// path without fighting the WebGL canvas hit-test. The finished run resolves to a REAL new_road artifact
// already in web/public (scorecard, no voices/social) so the scorecard-populated assertion is genuine.

const RUN_ID = 'multimodal-scenario-20260709T221140Z'; // real new_road quant artifact in web/public
const PRIOR_ID = 'multimodal-scenario-20260709T214747Z'; // a different real run, for the switcher
const J1 = { id: 'J1', lon: -79.2229, lat: 43.7443, type: 'priority', n_in: 4, n_out: 4 };
const J2 = { id: 'J2', lon: -79.21, lat: 43.755, type: 'priority', n_in: 3, n_out: 3 };

// The referendum guard (same litmus as discourse.spec) — must hold over the edit UI + empty states too.
const BANNED = /\b(majority|minority|referendum|consensus|unanimous|plurality)\b/i;
const STANCE_TALLY = /\d+\s*%[^.]{0,24}(support|oppos|favou?r|against)|\bfinal (distribution|tally|result|vote)\b|\d+\s+for\s*\/\s*\d+\s+against/i;

async function mockBackend(page: Page) {
  const statusCalls: Record<string, number> = {};
  const STAGES = ['regen', 'baseline', 'scenario', 'analysis', 'done'];

  await page.route('**/api/junctions**', (route) => route.fulfill({ json: { junctions: [J1, J2], count: 2 } }));
  await page.route('**/api/simulate', (route) => route.fulfill({ json: { run_id: RUN_ID } }));
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
  // status: PRIOR is already done; RUN_ID advances one stage per poll so the card visibly progresses.
  await page.route('**/api/runs/*/status', (route) => {
    const m = route.request().url().match(/\/api\/runs\/([^/]+)\/status/);
    const id = m ? decodeURIComponent(m[1]) : '';
    if (id === PRIOR_ID) {
      return route.fulfill({ json: { run_id: id, stage: 'done', status: 'done', cars_rerouted: 3, description: 'Prior road' } });
    }
    const n = (statusCalls[id] = (statusCalls[id] ?? 0) + 1);
    const stage = STAGES[Math.min(n - 1, STAGES.length - 1)];
    const done = stage === 'done';
    return route.fulfill({
      json: {
        run_id: id,
        stage,
        status: done ? 'done' : 'running',
        description: 'New road J1->J2',
        ...(done ? { cars_rerouted: 7, cars_on_new_road: 7 } : {}),
      },
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
  await page.screenshot({ path: 'test-results/edit-finished.png' });

  // Referendum guard holds over the edit UI (no tallies / verdict language anywhere).
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(BANNED);
  expect(body).not.toMatch(STANCE_TALLY);
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
  // The default latest.json DOES carry social, so discourse is enabled there — switch to a new_road run first.
  await page.getByTestId('mode-edit').click();
  await page.getByTestId('run-select').selectOption(RUN_ID);
  await page.waitForResponse((r) => r.url().includes(`${RUN_ID}.json`));
  // The loaded new_road run has no social → the Discourse toggle is disabled.
  await expect(page.getByTestId('mode-discourse')).toBeDisabled();
});
