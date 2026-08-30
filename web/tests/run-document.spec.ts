import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { mockDefaultArtifactBody } from './support/default-artifact';
import { openStage, gate } from './support/shell';
import { BANNED, STANCE_TALLY } from './support/sweeps';

// V2.7a C3 — the RUN DOCUMENT (the Read stage). Pins: the three-bucket assignment + fixed
// ordering, the scope disclosure riding 2.4 (same literals as scorecard-scope.spec), the copy
// truths (colophon has NO test counts + carries the sweep sentence; the settled method note is
// the CAVEAT ONLY — no plan-speak), the labeled report-missing / report-mismatch states, the
// committed-example rendered-equals-file pin, and the referendum sweep over the new surface.

const FIXTURE = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'fixtures', 'school-zone-run.json'), 'utf-8'),
);
const RUN_ID = FIXTURE.meta.run_id as string; // 'school-zone-fixture'
const EXAMPLE = 'multimodal-scenario-20260814T063253Z'; // the committed fire-station composite

/** A crafted scorecard exercising all three buckets (values are test literals, not run data). */
function craftedScorecard() {
  return {
    groups: [
      // bucket 1 — claimable travel direction + measured tail + unclaimed safety magnitude
      {
        group: 'car_commuter', grounding: 'sim',
        travel_time_delta: { value: -1.0, affected_share: 0.15, confidence: 'measured', note: 'tt' },
        safety_delta: { value: 43.24, confidence: 'low', note: 'surrogate' },
        access_delta: { value: -0.5, confidence: 'low', note: 'rule' },
      },
      // bucket 1 via the tail alone (median 0, direction unclaimed elsewhere)
      {
        group: 'cyclist', grounding: 'sim',
        travel_time_delta: { value: 0.0, affected_share: 0.23, confidence: 'measured', note: 'tt' },
        safety_delta: { value: 0.25, confidence: 'low', note: 'surrogate' },
        access_delta: null,
      },
      // bucket 2 — ONLY an unclaimed magnitude (safety) — direction never claimed
      {
        group: 'local_resident', grounding: 'inferred',
        travel_time_delta: null,
        safety_delta: { value: 42.61, confidence: 'low', note: 'surrogate' },
        access_delta: null,
      },
      // bucket 2 — sign-unstable travel (range spans zero) → direction unclaimed
      {
        group: 'pedestrian', grounding: 'sim',
        travel_time_delta: { value: 2.0, confidence: 'measured', note: 'tt', range: { min: -1, max: 3, n_seeds: 3, sign_stable: false } },
        safety_delta: null,
        access_delta: null,
      },
      // bucket 3 — nothing measured
      { group: 'business_owner', grounding: 'inferred', travel_time_delta: null, safety_delta: null, access_delta: null },
      { group: 'accessibility', grounding: 'inferred', travel_time_delta: null, safety_delta: null, access_delta: null },
      { group: 'transit_riders', grounding: 'inferred', travel_time_delta: null, safety_delta: null, access_delta: null },
    ],
    bca: null,
  };
}

function mkReport(runId: string, over: Record<string, unknown> = {}) {
  return {
    generated_at: '2026-01-01T00:00:00+00:00', provider: 'stub', model: 'stub',
    run_id: runId,
    run: {
      scenario_run_id: runId, baseline_run_id: 'b', network: 'corridor.net.xml', seeds: [42],
      thresholds: { ttc_s: 3, veh_pet_s: 2, ped_pet_s: 5, materiality_s: 30 },
      demand: { car: 300, bicycle: 82, pedestrian: 129 }, cars_rerouted: 3, severed_edges: [],
    },
    scenario_change: { description: 'stub change', target_edge: 'E1' },
    facts: {
      changes: [], assignment: { mode: 'day_one' }, demand_profile: 'synthetic_demo',
      sim_end: 1800, tags: null, n_seeds: 1, seed_basis: null, sign_unstable_cells: [],
      non_completions: null, non_completions_split: null, insertion_backlog: null,
      window_events: null, response_detour: null, zone_facts: null, scope_disclosure: null,
      calibration: null, render_sample: null,
    },
    scorecard: { groups: [] },
    car_tail: {
      median_s: -1.0, share_gt30_pct: 15, cross_seed_available: false,
      sentence: 'The median car trip is effectively unchanged; a tail of trips is materially slower.',
    },
    sections: {
      what_tested: { framing: 'STUB ABSTRACT PROSE — what was tested and what it shows.' },
      who_affected: { group_order: [], group_labels: {}, glosses: { car_commuter: 'STUB GLOSS for car commuters.' } },
      what_they_say: { groups: [] },
      institutional: null,
      discourse: null,
      cannot_tell: { intro: 'STUB CAVEAT INTRO.', caveats: [{ title: 'stub caveat', body: 'stub caveat body' }] },
    },
    audit: { passed: true, slots_checked: 1, summary: 'stub audit', log: [] },
    sources: [],
    ...over,
  };
}

async function openDoc(page: Page, body: unknown, report: unknown | { status: number }) {
  await mockDefaultArtifactBody(page, JSON.stringify(body));
  await page.route(`**/${RUN_ID}-report.json`, (route) =>
    typeof report === 'object' && report != null && 'status' in (report as Record<string, unknown>)
      ? route.fulfill({ status: (report as { status: number }).status, body: 'nope' })
      : route.fulfill({ json: report }),
  );
  await page.goto('/');
  await gate(page);
  await page.reload();
  await expect(page.getByTestId('stage-build')).toBeVisible({ timeout: 20_000 });
  await openStage(page, 'read');
  await expect(page.getByTestId('run-document')).toBeVisible({ timeout: 10_000 });
}

test('three buckets assign by epistemic status; fixed group order, never effect size', async ({ page }) => {
  const art = { ...FIXTURE, scorecard: craftedScorecard() };
  await openDoc(page, art, mkReport(RUN_ID));

  const rows = page.getByTestId('doc-group-row');
  const order = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-group')));
  // bucket 1 (moved) → bucket 2 (unclaimed) → bucket 3 (not measured); the fixed
  // SCORECARD_GROUP_ORDER inside each bucket — cyclist's ±0.25 must NOT outrank resident's ±42.61
  expect(order).toEqual([
    'car_commuter', 'cyclist', // moved
    'pedestrian', 'local_resident', // unclaimed — pedestrian precedes resident in the fixed order
    'business_owner', 'accessibility', 'transit_riders', // not measured
  ]);
  // the audited gloss is the row's sentence (prose from the report, never client-authored)
  await expect(rows.first()).toContainText('STUB GLOSS for car commuters.');
  // evidence text: ± magnitude only for safety; not-measured is stated, not zeroed
  await expect(rows.first()).toContainText('safety ±43.24');
  await expect(rows.last()).toContainText('not measured in this run');
  // abstract renders first, from the audited slot
  await expect(page.getByTestId('run-document')).toContainText('STUB ABSTRACT PROSE');
  const body = await page.getByTestId('run-document').innerText();
  expect(body).not.toMatch(BANNED);
  expect(body).not.toMatch(STANCE_TALLY);
});

test('the scope disclosure rides 2.4 with the scorecard-scope literals', async ({ page }) => {
  const art = {
    ...FIXTURE,
    scorecard: craftedScorecard(),
    meta: {
      ...FIXTURE.meta,
      sim_end: 1800,
      scenario: {
        ...FIXTURE.meta.scenario,
        changes: [
          { type: 'speed_limit', target_edge: 'E_A', value_mps: 8.33, window: { start_s: 600, end_s: 1200 } },
          { type: 'speed_limit', target_edge: 'E_B', value_mps: 8.33, window: { start_s: 600, end_s: 1500 } },
        ],
      },
    },
  };
  await openDoc(page, art, mkReport(RUN_ID));
  await expect(page.getByTestId('doc-scope-note')).toHaveText(
    'measures cover the full run; changes active t=600–1500 s (members carry differing windows; these figures use the spanning window)',
  );
});

test('copy truths: colophon derives (no test counts), sweep sentence present; settled note is the caveat only', async ({ page }) => {
  const art = {
    ...FIXTURE,
    scorecard: craftedScorecard(),
    meta: { ...FIXTURE.meta, assignment: { mode: 'settled', scope: 'cars_only' } },
  };
  const report = mkReport(RUN_ID);
  (report.facts as Record<string, unknown>).assignment = { mode: 'settled', scope: 'cars_only' };
  await openDoc(page, art, report);

  const colophon = await page.getByTestId('doc-colophon').innerText();
  expect(colophon).toContain('a banned-language sweep fails the test suite');
  expect(colophon).not.toMatch(/\d+\s*(pytest|Playwright|tests)/i); // derive-or-omit → omitted
  const notes = await page.getByTestId('doc-method-notes').innerText();
  expect(notes).toContain('iteration basis is under re-verification after a sort-order fix');
  expect(notes).toContain('the direction of the finding is not in doubt');
  // the plan-speak stays OUT of product copy (the design-review ruling)
  const body = await page.getByTestId('run-document').innerText();
  expect(body).not.toMatch(/ratif|schedules the|committed work/i);
  // the closing line
  expect(body).toContain('Nadi arranges evidence; the planner concludes.');
});

test('no report → the labeled report-missing state; artifact-derived sections still render', async ({ page }) => {
  const art = { ...FIXTURE, scorecard: craftedScorecard() };
  await openDoc(page, art, { status: 404 });
  const missing = page.getByTestId('report-missing');
  await expect(missing).toBeVisible();
  await expect(missing).toContainText('No report for this run yet');
  await expect(missing).toContainText('report enrich');
  // the run's own sections render regardless (spec table + 2.4 come from the artifact)
  await expect(page.getByTestId('doc-group-row').first()).toBeVisible();
  await expect(page.getByTestId('run-document')).toContainText('Scenario specification');
});

test("a report for ANOTHER run renders the labeled mismatch state — never another run's findings", async ({ page }) => {
  const art = { ...FIXTURE, scorecard: craftedScorecard() };
  const wrong = mkReport('multimodal-scenario-SOMEONE-ELSE');
  (wrong.sections.what_tested as { framing: string }).framing = 'WRONG-RUN PROSE MUST NOT RENDER.';
  await openDoc(page, art, wrong);
  await expect(page.getByTestId('report-mismatch')).toBeVisible();
  await expect(page.getByTestId('run-document')).not.toContainText('WRONG-RUN PROSE MUST NOT RENDER.');
});

test('the 2.4 doorway: a group row leaves Read and lands in Watch', async ({ page }) => {
  // the fixture carries NO voices (agents: []) — the feed honestly doesn't render, so this
  // half asserts the stage switch; the feed+filter half lives in the committed-example test
  // below, where 214 real voices exist.
  const art = { ...FIXTURE, scorecard: craftedScorecard() };
  await openDoc(page, art, mkReport(RUN_ID));
  await page.getByTestId('doc-group-row').first().click();
  await expect(page.getByTestId('scorecard-panel')).toBeVisible({ timeout: 10_000 }); // the Watch rail
  await expect(page.getByTestId('run-document')).toHaveCount(0); // Read left behind
});

test('the committed example renders ITS OWN report values — the rendered-equals-file pin', async ({ page }) => {
  // The committed per-run report is singleton-class (the landing renders from it): read the real
  // file at runtime and assert the document shows ITS values — drift between the committed bytes
  // and the render fails here (committed-artifact-SPECIFIC values, never non-emptiness).
  const committed = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'public', `${EXAMPLE}-report.json`), 'utf-8'),
  );
  const closure = committed.facts.response_detour.members.find(
    (m: { type: string }) => m.type === 'road_closure',
  );
  const worstOf = (label: string) => {
    const end = closure.ends.find((e: { label: string }) => e.label === label);
    return Math.max(
      ...end.probes.filter((p: { added_s: number | null }) => p.added_s != null).map((p: { added_s: number }) => p.added_s),
    );
  };
  await page.goto(`/?run=${EXAMPLE}`);
  await gate(page);
  await openStage(page, 'read');
  const doc = page.getByTestId('run-document');
  await expect(doc).toBeVisible({ timeout: 30_000 });
  await expect(doc).toContainText(`+${worstOf('east end')} s`); // 1.7 on today's bytes
  await expect(doc).toContainText(`+${worstOf('west end')} s`); // 29.1 on today's bytes
  // Station 231's origin-closed CAUSE rides verbatim, never folded into an average
  await expect(doc).toContainText('origin street is closed during the window');
  const body = await doc.innerText();
  expect(body).not.toMatch(BANNED);
  expect(body).not.toMatch(STANCE_TALLY);
  expect(body).not.toContain('s added response-route time'); // the V2.5b vocabulary split holds
  // the doorway with REAL voices: a group row opens Watch with that group filtering the feed
  await page.getByTestId('doc-group-row').first().click();
  await expect(page.getByTestId('comment-feed')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('feed-filter-chip')).toBeVisible();
});
