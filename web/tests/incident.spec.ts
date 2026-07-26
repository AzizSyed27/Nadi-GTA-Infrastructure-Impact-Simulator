import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// V2.2b — the incident run's RunCard surfaces: the response-access chip must render the worst
// added_s WITH both honesty sentences (free-flow framing + the lower-bound disclosure) — never
// tooltip-only. NEW spec file: every existing spec stays byte-identical.

const RUN_ID = 'multimodal-scenario-incident-fixture';
const FIXTURE = path.join(__dirname, 'fixtures', 'seeds-run.json'); // any valid artifact body

const FRAMING = 'estimated added response-route time; free-flow routing, not a dispatch model';
const LOWER_BOUND = 'free-flow estimate; does not include congestion the incident induces — a lower bound on added response time';

const STATUS = {
  run_id: RUN_ID,
  stage: 'done',
  status: 'done',
  description: 'Blocked 2 car lanes on edge 42140001 (incident) from 07:10 to 07:30',
  change: { type: 'incident', target_edge: '42140001' },
  cars_rerouted: 12,
  car_median_delta_s: 1.4,
  car_affected_share: 0.05,
  demand_profile: 'calibrated_am_peak',
  non_completions: { car: 3, bicycle: 0, pedestrian: 0 },
  window_events: [
    { change_idx: 0, type: 'incident', target_edge: '42140001', window: { start_s: 600, end_s: 1800 },
      applied_t: 600, reverted_t: 1800, restored_ok: true, note: null },
  ],
  response_detour: {
    framing: FRAMING,
    lower_bound_note: LOWER_BOUND,
    destination_edge: '-35798648#1',
    destination_note: 'first outgoing passenger edge at the first downstream junction with an alternate approach',
    probes: [
      { label: 'Fire Station 231 (740 Markham Rd)', represents: 'fire_station', origin_edge: '48715757#0', baseline_s: 57.0, scenario_s: 105.7, added_s: 48.7 },
      { label: 'Fire Station 232 (1550 Midland Ave)', represents: 'fire_station', origin_edge: '39210630#0', baseline_s: 415.4, scenario_s: null, added_s: null, note: 'destination unreachable from this origin during the window' },
    ],
  },
};

async function mockBackend(page: Page) {
  await page.route('**/api/junctions**', (route) => route.fulfill({ json: { junctions: [], count: 0 } }));
  await page.route('**/network.json', (route) => route.fulfill({ json: { edges: [] } }));
  await page.route('**/api/edges**', (route) => route.fulfill({ json: { edges: [], count: 0 } }));
  await page.route('**/api/runs', (route) =>
    route.fulfill({ json: { runs: [{ id: RUN_ID, description: STATUS.description, status: 'done', stage: 'done', started_at: 1 }] } }));
  await page.route('**/api/runs/*/status', (route) => route.fulfill({ json: STATUS }));
  await page.route(`**/${RUN_ID}.json`, (route) =>
    route.fulfill({ body: fs.readFileSync(FIXTURE, 'utf-8'), contentType: 'application/json' }));
}

test('an incident run surfaces the response-access chip with both honesty sentences', async ({ page }) => {
  await mockBackend(page);
  await page.goto('/');
  // warm-reload convention (compare.spec.ts): the tiny fixture can land inside StrictMode's
  // double-mount window on a cold dev compile — reload once, then interact.
  await page.getByTestId('mode-edit').waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
  await page.reload();
  await expect(page.getByTestId('mode-edit')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('mode-edit').click();
  await page.getByTestId('run-select').selectOption(RUN_ID);
  await expect(page.getByTestId('run-card')).toBeVisible();

  const chip = page.getByTestId('response-access-chip');
  await expect(chip).toBeVisible();
  // the chip labels its statistic: the MAX, never an unlabeled number or an implied average
  await expect(chip).toContainText('worst of 2 stations: +49 s (1 not computable — see the report)');
  // BOTH honesty sentences render with the number — never tooltip-only.
  await expect(chip).toContainText(FRAMING);
  await expect(chip).toContainText(LOWER_BOUND);

  // The mechanical incident description (clock times; a capacity event, no crash wording).
  await expect(page.getByTestId('run-card')).toContainText('Blocked 2 car lanes');
  await expect(page.getByTestId('run-card')).toContainText('from 07:10 to 07:30');
  const cardText = await page.getByTestId('run-card').innerText();
  for (const banned of ['crash', 'collision', 'accident']) {
    expect(cardText.toLowerCase()).not.toContain(banned);
  }
});
