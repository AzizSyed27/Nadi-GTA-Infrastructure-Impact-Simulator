import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// V2.4b — the UNTAGGED mixed-composite RunCard: `changes` (plural) drives the chips. Before this,
// the chips read status.change (= members[0]) and silently presented an N-member run as a single
// change — or rendered NO window chip when member 0 was unwindowed. Also pins the V2.4b end of the
// V2.2c exemption: the non-completions split renders WITH the backlog-attribution parenthetical on
// the RunCard too (sums across modes, mirroring the report/institutions wording).
// Fixture: school-zone-run.json surgery — tags dropped, changes made heterogeneous (the acceptance
// shape: road_closure 600-1200 + speed_limit 900-1500 + factor-only incident 600-1800).

const RUN_ID = 'multimodal-scenario-compositecard-fixture';
const FIXTURE = path.join(__dirname, 'fixtures', 'school-zone-run.json');
const BANNED = /\b(majority|minority|referendum|consensus|unanimous|plurality)\b/i;
const STANCE_TALLY = /\d+\s*%[^.]{0,24}(support|oppos|favou?r|against)|\bfinal (distribution|tally|result|vote)\b|\d+\s+for\s*\/\s*\d+\s+against/i;

function mixedArtifact(): { body: string; changes: Record<string, unknown>[] } {
  const art = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
  const edges = (art.meta.scenario.changes as { target_edge: string }[]).map((c) => c.target_edge);
  const changes = [
    { type: 'road_closure', target_edge: edges[0], window: { start_s: 600, end_s: 1200 },
      description: `Closed edge ${edges[0]} (all lanes) from t=600 s to t=1200 s` },
    { type: 'speed_limit', target_edge: edges[1], value_mps: 8.33,
      window: { start_s: 900, end_s: 1500 },
      description: `Reduced max speed on edge ${edges[1]} to 30 km/h from t=900 s to t=1500 s` },
    { type: 'incident', target_edge: edges[2], window: { start_s: 600, end_s: 1800 },
      effect: { speed_factor: 0.5 },
      description: `Reduced speed to 50% on edge ${edges[2]} (incident) from t=600 s to t=1800 s` },
  ];
  art.meta.scenario.changes = changes;
  delete art.meta.scenario.tags; // UNTAGGED — the zone chip must not cover for the composite chip
  return { body: JSON.stringify(art), changes };
}

async function mockBackend(page: Page, artifactBody: string, changes: Record<string, unknown>[]) {
  await page.route('**/api/junctions**', (route) => route.fulfill({ json: { junctions: [], count: 0 } }));
  await page.route('**/api/edges**', (route) => route.fulfill({ json: { edges: [], count: 0 } }));
  await page.route('**/api/runs', (route) =>
    route.fulfill({ json: { runs: [{ id: RUN_ID, description: '3 changes on the corridor', status: 'done', stage: 'done', started_at: 2 }] } }));
  await page.route('**/api/runs/*/status', (route) =>
    route.fulfill({
      json: {
        run_id: RUN_ID, stage: 'done', status: 'done',
        description: '3 changes on the corridor, from t=600 s to t=1800 s',
        demand_profile: 'synthetic_demo',
        change: changes[0], changes,
        cars_rerouted: 42, car_median_delta_s: 3.2, car_affected_share: 0.11,
        non_completions: { car: 30, bicycle: 7 },
        non_completions_split: {
          car: { entered_not_finished: 12, not_inserted: 18 },
          bicycle: { entered_not_finished: 0, not_inserted: 7 },
        },
        insertion_backlog: {
          car: { baseline: 15, scenario: 20 },
          bicycle: { baseline: 3, scenario: 5 },
        },
        response_detour: {
          framing: 'estimated added response-route time; free-flow routing, not a dispatch model',
          lower_bound_note:
            'free-flow estimate; does not include congestion the incident induces — a lower bound on added response time',
          destination_edge: 'D1', destination_note: 'first outgoing passenger edge…',
          probes: [
            { label: 'Fire Station 231 (740 Markham Rd)', represents: 'fire_station', origin_edge: 'O1', baseline_s: 100.0, scenario_s: 129.1, added_s: 29.1 },
            { label: 'Fire Station 232 (1550 Midland Ave)', represents: 'fire_station', origin_edge: 'O2', baseline_s: 90.0, scenario_s: 90.0, added_s: 0.0 },
          ],
        },
      },
    }));
  await page.route(`**/${RUN_ID}.json`, async (route) => {
    // compare.spec convention: a tiny fixture resolving inside StrictMode's double-mount window
    // crashes maplibre teardown in dev — delay it past that window
    await new Promise((res) => setTimeout(res, 500));
    await route.fulfill({ body: artifactBody, contentType: 'application/json' });
  });
}

test('untagged mixed composite: composite chip + spanning window; no member-0 window chip; backlog parenthetical', async ({ page }) => {
  const { body, changes } = mixedArtifact();
  await mockBackend(page, body, changes);
  await page.goto(`/?run=${RUN_ID}`);
  await page.getByTestId('mode-edit').waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
  await page.reload();
  await expect(page.getByTestId('mode-edit')).toBeVisible({ timeout: 20_000 });

  // the RunCard mounts when a run is selected in the edit rail (the edit.spec switcher pattern)
  await page.getByTestId('mode-edit').click();
  await page.getByTestId('run-select').selectOption(RUN_ID);
  await expect(page.getByTestId('run-card')).toBeVisible();

  // the composite chip: member count + the SPANNING active window (600–1800), mechanical
  await expect(page.getByTestId('composite-chip')).toHaveText('3 changes · active t=600–1800 s');
  // never the member-0-only window chip, and no zone chip on an untagged run
  await expect(page.getByTestId('window-chip')).toHaveCount(0);
  await expect(page.getByTestId('zone-chip')).toHaveCount(0);

  // the split renders WITH the backlog attribution (18 = 15+3 baseline, 25 = 20+5 scenario)
  await expect(page.getByTestId('non-completions')).toHaveText(
    '37 travelers did not complete — car: 12 stranded en route, 18 not inserted; ' +
      'bicycle: 7 not inserted (insertion backlog affects baseline too: 18 baseline vs 25 scenario)',
  );

  // the detour fact renders with both honesty sentences (labels its statistic; worst of N)
  await expect(page.getByTestId('response-access-chip')).toContainText('worst of 2 stations: +29 s');
  await expect(page.getByTestId('response-access-chip')).toContainText('not a dispatch model');

  // the referendum guard holds over the whole card
  const text = await page.getByTestId('run-card').innerText();
  expect(BANNED.test(text)).toBe(false);
  expect(STANCE_TALLY.test(text)).toBe(false);
});
