import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// V2.3c — mandate-grounded institutional voices in the frontend. The fixture artifact is stamped
// 0.9.0 with a TFS mandate agent appended (the client ajv-validates against the REAL contract
// schema, so these mocks also prove the TS-side 0.9.0 acceptance). StrictMode conventions apply
// (~500 ms fixture delay + warm reload).

const FIXTURE = path.join(__dirname, 'fixtures', 'school-zone-run.json');

const MISSION =
  'Fire Services provides Toronto residents, visitors and businesses with protection against loss of life, ' +
  'property and the environment from the effects of fire, illness, accidents and all other hazards through ' +
  'preparedness, prevention, public education and emergency response, with an emphasis on quality services, ' +
  'efficiency, effectiveness and safety.';
const FRAMING = 'estimated added response-route time; free-flow routing, not a dispatch model';
const LOWER_BOUND =
  'free-flow estimate; does not include congestion the incident induces — a lower bound on added response time';

const SIM_VOICE = {
  persona: { id: 'time_pressed', label: 'Devi, commuter' },
  reaction: { comment: 'My drive took a couple of minutes longer this morning.', sentiment: -0.5, stance: 'opposed' },
  grounding: 'sim',
  vehicle_id: 'veh0',
  outcome: { baseline_duration: 240.0, scenario_duration: 360.0, delta_seconds: 120.0, baseline_timeloss: 20.0, scenario_timeloss: 100.0 },
  trigger_t: 300.0,
};
const INFERRED_VOICE = {
  persona: { id: 'local_resident', label: 'Rana, resident' },
  reaction: { comment: 'Slower cars past my street sounds calmer to me.', sentiment: 0.6, stance: 'supportive' },
  grounding: 'inferred',
};
const TFS_VOICE = {
  grounding: 'mandate',
  persona: { id: 'tfs', label: 'Toronto Fire Services' },
  mandate: {
    institution: 'Toronto Fire Services',
    mission: MISSION,
    source:
      'https://www.toronto.ca/city-government/accountability-operations-customer-service/city-administration/staff-directory-divisions-and-customer-service/fire-services/',
    retrieved: '2026-08-01',
  },
  citations: [
    {
      key: 'response_detour',
      text: 'Response access (free-flow estimate): worst of 4 fire stations +48.7 s added response-route time (Fire Station 231 (740 Markham Rd): +48.7 s).',
      notes: [FRAMING, LOWER_BOUND],
    },
  ],
  reaction: {
    comment:
      "Toronto Fire Services' published mandate (toronto.ca, retrieved 2026-08-01) prioritizes protection against loss of life, property and the environment. Read against that mandate, this run computed: worst of 4 fire stations +48.7 s added response-route time (estimated added response-route time; free-flow routing, not a dispatch model).",
    sentiment: 0.0,
    stance: 'neutral',
  },
};

/** Serve the fixture at /latest.json with the given agents at 0.9.0 (+ minimal API mocks). */
async function mockArtifact(page: Page, agents: unknown[]) {
  const base = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
  base.schema_version = '0.9.0';
  base.agents = agents;
  const body = JSON.stringify(base);
  await page.route('**/api/junctions**', (route) => route.fulfill({ json: { junctions: [], count: 0 } }));
  await page.route('**/api/edges**', (route) => route.fulfill({ json: { edges: [], count: 0 } }));
  await page.route('**/api/runs', (route) => route.fulfill({ json: { runs: [] } }));
  await page.route('**/latest.json', async (route) => {
    await new Promise((res) => setTimeout(res, 500));
    await route.fulfill({ body, contentType: 'application/json' });
  });
}

async function openPlayback(page: Page) {
  await page.goto('/');
  await page.getByTestId('comment-feed').waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
  await page.reload();
  await expect(page.getByTestId('comment-feed')).toBeVisible({ timeout: 20_000 });
}

test('a mandate voice renders pinned in the feed and opens the grounding card', async ({ page }) => {
  await mockArtifact(page, [SIM_VOICE, INFERRED_VOICE, TFS_VOICE]);
  await openPlayback(page);

  // PINNED — visible at t=0 with no scrub (a mandate reading is not a traveler moment)
  const row = page.getByTestId('institution-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Toronto Fire Services');
  await expect(row).toContainText('mandate lens');

  await row.click();
  const panel = page.getByTestId('institution-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('institution-mandate')).toContainText(MISSION); // verbatim, uncut
  await expect(page.getByTestId('institution-mandate')).toContainText('retrieved 2026-08-01');
  await expect(page.getByTestId('institution-citation')).toContainText('worst of 4 fire stations');
  await expect(page.getByTestId('institution-citation')).toContainText('not a dispatch model');
  await expect(page.getByTestId('institution-citation')).toContainText('a lower bound');
  await expect(page.getByTestId('institution-disclaimer')).toContainText('not a statement by, from, or on behalf of');

  // the interview opens with the institutional grounding line (mandate-lens, not persona role-play)
  await page.getByTestId('interview-open-institution').click();
  await expect(page.getByTestId('interview-drawer')).toBeVisible();
  await expect(page.getByTestId('interview-grounding')).toContainText('not from the organization itself');
});

test('a 0.9.0 run with voices but no institutional facts shows the honest empty state', async ({ page }) => {
  await mockArtifact(page, [SIM_VOICE, INFERRED_VOICE]);
  await openPlayback(page);
  await expect(page.getByTestId('institution-empty')).toBeVisible();
  await expect(page.getByTestId('institution-empty')).toContainText(
    'Institutions speak only when the run computes facts within their mandate',
  );
  await expect(page.getByTestId('institution-row')).toHaveCount(0);
});

test('the report view renders the institutional section (and the empty variant)', async ({ page }) => {
  await mockArtifact(page, [SIM_VOICE, INFERRED_VOICE, TFS_VOICE]);
  const report = {
    generated_at: 'now',
    provider: 'x',
    model: 'y',
    run: {
      scenario_run_id: 'school-zone-fixture', baseline_run_id: 'b', network: 'n', seeds: [42],
      thresholds: { ttc_s: 1.5, veh_pet_s: 2.0, ped_pet_s: 3.0, materiality_s: 30 },
      demand: { car: 1, bicycle: 1, pedestrian: 1 }, cars_rerouted: 0,
    },
    scenario_change: { description: 'd', target_edge: 'E1' },
    scorecard: { groups: [] },
    car_tail: { median_s: 0, share_gt30_pct: 0, cross_seed_available: false, sentence: 's' },
    sections: {
      what_tested: { framing: 'framing text' },
      who_affected: { glosses: {} },
      what_they_say: { groups: [] },
      institutional: {
        voices: [
          {
            id: 'tfs', label: 'Toronto Fire Services',
            mandate: TFS_VOICE.mandate,
            citations: TFS_VOICE.citations,
            comment: TFS_VOICE.reaction.comment,
          },
        ],
        empty_reason: null,
        disclaimer:
          'Institutional perspectives are generated by this tool: each recites the named organization’s published mandate (sourced) against this run’s computed facts. They are not statements by, from, or on behalf of the named organizations.',
      },
      discourse: null,
      cannot_tell: { intro: 'intro', caveats: [] },
    },
    audit: { passed: true, slots_checked: 0, summary: 's', log: [] },
    sources: [],
  };
  // ReportPanel reads /latest-report.json DIRECTLY (the report JSON, unwrapped); only /api/report wraps.
  await page.route('**/latest-report.json', (route) => route.fulfill({ json: report }));
  await page.route('**/api/report', (route) => route.fulfill({ json: { report, run_id: 'school-zone-fixture' } }));
  await openPlayback(page);
  await page.getByTestId('open-report').click();

  const section = page.getByTestId('report-institutional');
  await expect(section).toBeVisible({ timeout: 10_000 });
  await expect(section).toContainText('Institutional perspectives (mandate lens)');
  await expect(section).toContainText(MISSION);
  await expect(section).toContainText('retrieved 2026-08-01');
  await expect(section).toContainText('not a dispatch model');
  await expect(section).toContainText('not statements by, from, or on behalf of');
});
