import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// V2.3c — mandate-grounded institutional voices in the frontend. V2.5a: the fixture is
// PRODUCER-REAL (institutions-run.json, regen-pinned by python/tests/test_institutions_fixture.py
// — the old hand-mocked mandate agent had already drifted from the producer's disclaimer and
// survived on a shared substring). The artifact is genuine 0.9.0 with a TFS mandate agent built
// by the real deterministic chain; the client ajv-validates it against the REAL contract schema.
// Its change set is the V2.5a synergy shape (2-member all-windowed DISJOINT composite whose
// detour payload carries the window-coincidence note), so this spec also pins the item-1 sentence
// and the item-3 clause in the real UI. StrictMode conventions apply (~500 ms delay + warm reload).

const FIXTURE = path.join(__dirname, 'fixtures', 'institutions-run.json');
const SECTION_FIXTURE = path.join(__dirname, 'fixtures', 'institutions-report-section.json');

const MISSION =
  'Fire Services provides Toronto residents, visitors and businesses with protection against loss of life, ' +
  'property and the environment from the effects of fire, illness, accidents and all other hazards through ' +
  'preparedness, prevention, public education and emergency response, with an emphasis on quality services, ' +
  'efficiency, effectiveness and safety.';

/** Serve the producer-real fixture at /latest.json (+ minimal API mocks); `mutate` for variants. */
async function mockArtifact(page: Page, mutate?: (art: { agents: { grounding: string }[] }) => void) {
  const art = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
  if (mutate) mutate(art);
  const body = JSON.stringify(art);
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
  await mockArtifact(page);
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
  // V2.5b members citation — per-end aggregation, re-quoted from the regenerated fixture bytes
  await expect(page.getByTestId('institution-citation')).toContainText('east end worst +29.1 s');
  await expect(page.getByTestId('institution-citation')).toContainText(
    'west end worst of the reachable +6 s (1 of 2 unreachable)',
  );
  await expect(page.getByTestId('institution-citation')).toContainText('not a dispatch model');
  await expect(page.getByTestId('institution-citation')).toContainText('a lower bound');
  // V2.5a item 1 — the window-coincidence sentence rides the citation notes in the real UI
  await expect(page.getByTestId('institution-citation')).toContainText('most-constrained moment');
  // V2.5b — the end-method + probed-members sentences ride too
  await expect(page.getByTestId('institution-citation')).toContainText('may use different approaches');
  await expect(page.getByTestId('institution-citation')).toContainText('not separately probed');
  await expect(page.getByTestId('institution-disclaimer')).toContainText('not a statement by, from, or on behalf of');

  // V2.5a item 3 — the fixture's disjoint windows surface the dead-time clause on the scope note
  await expect(page.getByTestId('scorecard-scope-note')).toHaveText(
    'measures cover the full run; changes active t=300–1800 s ' +
      '(members carry differing windows; these figures use the spanning window; ' +
      'the spanning window includes periods where no change was active)',
  );

  // the interview opens with the institutional grounding line (mandate-lens, not persona role-play)
  await page.getByTestId('interview-open-institution').click();
  await expect(page.getByTestId('interview-drawer')).toBeVisible();
  await expect(page.getByTestId('interview-grounding')).toContainText('not from the organization itself');
});

test('a 0.9.0 run with voices but no institutional facts shows the honest empty state', async ({ page }) => {
  // mechanical filter of the real fixture — no hand-authored agents anywhere in this spec
  await mockArtifact(page, (art) => {
    art.agents = art.agents.filter((a) => a.grounding !== 'mandate');
  });
  await openPlayback(page);
  await expect(page.getByTestId('institution-empty')).toBeVisible();
  await expect(page.getByTestId('institution-empty')).toContainText(
    'Institutions speak only when the run computes facts within their mandate',
  );
  await expect(page.getByTestId('institution-row')).toHaveCount(0);
});

test('the report view renders the institutional section (producer-real fixture)', async ({ page }) => {
  await mockArtifact(page);
  // sections.institutional comes VERBATIM from the committed companion —
  // build_institutional_section output, recompute-pinned python-side (no hand-authored
  // disclaimer literal to drift).
  const institutional = JSON.parse(fs.readFileSync(SECTION_FIXTURE, 'utf-8'));
  const report = {
    generated_at: 'now',
    provider: 'x',
    model: 'y',
    run: {
      scenario_run_id: 'institutions-fixture', baseline_run_id: 'b', network: 'n', seeds: [42],
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
      institutional,
      discourse: null,
      cannot_tell: { intro: 'intro', caveats: [] },
    },
    audit: { passed: true, slots_checked: 0, summary: 's', log: [] },
    sources: [],
  };
  // ReportPanel reads /latest-report.json DIRECTLY (the report JSON, unwrapped); only /api/report wraps.
  await page.route('**/latest-report.json', (route) => route.fulfill({ json: report }));
  await page.route('**/api/report', (route) => route.fulfill({ json: { report, run_id: 'institutions-fixture' } }));
  await openPlayback(page);
  await page.getByTestId('open-report').click();

  const section = page.getByTestId('report-institutional');
  await expect(section).toBeVisible({ timeout: 10_000 });
  await expect(section).toContainText('Institutional perspectives (mandate lens)');
  await expect(section).toContainText(MISSION);
  await expect(section).toContainText('retrieved 2026-08-01');
  await expect(section).toContainText('not a dispatch model');
  await expect(section).toContainText('most-constrained moment'); // V2.5a item 1 in the report section
  await expect(section).toContainText('east end worst +29.1 s'); // V2.5b members citation text
  await expect(section).toContainText('may use different approaches'); // V2.5b end-method note
  await expect(section).toContainText('not statements by, from, or on behalf of');
});
