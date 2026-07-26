import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// V2.2c — the RunCard's windowed-change chip + THE closure numbers (diverted, the causally-neutral
// non-completions split, response detour with BOTH honesty sentences). NEW file; incident.spec's
// scaffold conventions.

const RUN_ID = 'multimodal-scenario-windowedcard-fixture';
const FIXTURE = path.join(__dirname, 'fixtures', 'seeds-run.json'); // any valid artifact body

const FRAMING = 'estimated added response-route time; free-flow routing, not a dispatch model';
const LOWER_BOUND = 'free-flow estimate; does not include congestion the incident induces — a lower bound on added response time';
const BANNED = /\b(majority|minority|referendum|consensus|unanimous|plurality)\b/i;

const STATUS = {
  run_id: RUN_ID,
  stage: 'done',
  status: 'done',
  description: 'Closed 2 of 3 car lanes on edge 42140001 from 07:15 to 09:00',
  change: {
    type: 'lane_closure', target_edge: '42140001', target_lanes: [1, 2],
    window: { start_s: 900, end_s: 7200 },
  },
  cars_rerouted: 935,
  car_median_delta_s: 0.0,
  car_affected_share: 0.178,
  demand_profile: 'calibrated_am_peak',
  non_completions: { car: 957, bicycle: 1, pedestrian: 4 },
  non_completions_split: {
    car: { entered_not_finished: 812, not_inserted: 145 },
    bicycle: { entered_not_finished: 1, not_inserted: 0 },
    pedestrian: { entered_not_finished: 4, not_inserted: 0 },
  },
  insertion_backlog: { car: { baseline: 45500, scenario: 45700 } },
  window_events: [
    { change_idx: 0, type: 'lane_closure', target_edge: '42140001', window: { start_s: 900, end_s: 7200 },
      applied_t: 900, reverted_t: 7200, restored_ok: true, note: null },
  ],
  response_detour: {
    framing: FRAMING,
    lower_bound_note: LOWER_BOUND,
    origins_note: 'probe origins are Toronto Fire Services station locations (Toronto Open Data, retrieved 2026-07-25); routes are computed from every station and do not indicate which station would respond',
    destination_edge: '-35798648#1',
    probes: [
      { label: 'Fire Station 231 (740 Markham Rd)', represents: 'fire_station', origin_edge: 'O1', baseline_s: 57.0, scenario_s: 57.0, added_s: 0.0,
        note: 'the changed road stays passable at unchanged free-flow speed on this route — no added time under free-flow routing' },
      { label: 'Fire Station 232 (1550 Midland Ave)', represents: 'fire_station', origin_edge: 'O2', baseline_s: 415.4, scenario_s: 415.4, added_s: 0.0 },
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

test('the windowed lane_closure run card shows the chip + THE numbers with neutral split labels', async ({ page }) => {
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

  // the windowed-change chip — clock times on calibrated (t=0 == 07:00)
  await expect(page.getByTestId('window-chip')).toHaveText('2 lane(s) closed 07:15–09:00');

  // THE numbers: diverted + the split (causally-NEUTRAL "not inserted") + response access
  await expect(page.getByTestId('reroute-number')).toContainText('935');
  // per-MODE and skip-zero (mirrors report.py) — never hardcoded to cars: a closure whose whole
  // impact lands on pedestrians must not render "0 cars did not complete".
  await expect(page.getByTestId('non-completions')).toHaveText(
    '962 travelers did not complete — car: 812 stranded en route, 145 not inserted; bicycle: 1 stranded en route; pedestrian: 4 stranded en route');
  const chip = page.getByTestId('response-access-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('worst of 2 stations: +0 s'); // the labeled MAX
  await expect(chip).toContainText(FRAMING);
  await expect(chip).toContainText(LOWER_BOUND);

  // never a causal "never entered"-style accusation, never tallies, never crash words
  const cardText = await page.getByTestId('run-card').innerText();
  expect(cardText.toLowerCase()).not.toContain('never entered');
  expect(BANNED.test(cardText)).toBe(false);
  for (const banned of ['crash', 'collision', 'accident']) {
    expect(cardText.toLowerCase()).not.toContain(banned);
  }
});
