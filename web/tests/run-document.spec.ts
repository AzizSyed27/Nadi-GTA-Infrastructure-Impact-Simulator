import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { mockDefaultArtifactBody } from './support/default-artifact';
import { openStage, gate } from './support/shell';
import { BANNED, STANCE_TALLY } from './support/sweeps';
import { EXAMPLE_RUN_NAME } from '../lib/demo';

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
      // bucket 1 via the TAIL ALONE (review catch: value 0.0 with no range was already
      // claimable, so the tail disjunct was untested — here travel is SIGN-UNSTABLE and only
      // the measured tail share puts the group in "moved"; deleting the tail clause fails this)
      {
        group: 'cyclist', grounding: 'sim',
        travel_time_delta: { value: 0.5, affected_share: 0.23, confidence: 'measured', note: 'tt', range: { min: -1, max: 2, n_seeds: 3, sign_stable: false } },
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

// ── V2.7e C1 — 2.4 rows SELECT (the ratified canvas, form 1d); the doorway is the tray's ────────

test('2.4 rows SELECT: toggle, cap two, oldest dropped; the tray says what is picked', async ({ page }) => {
  // Before e a row click NAVIGATED (Read → Watch, the feed filtered). The canvas ratified
  // selection: one group is the doorway to its evidence, two offer a room. Read is NOT left by
  // a click — that is the whole change, and the first assertion pins it.
  const art = { ...FIXTURE, scorecard: craftedScorecard() };
  await openDoc(page, art, mkReport(RUN_ID));
  const rows = page.getByTestId('doc-group-row');
  await expect(page.getByTestId('doc-tray-empty')).toHaveText(
    'pick one group to hear it; two to put them in a room', // canvas-verbatim
  );
  await rows.nth(0).click(); // car_commuter
  await expect(rows.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('run-document')).toBeVisible(); // a selection, not a navigation
  await expect(page.getByTestId('doc-tray-chip-car_commuter')).toBeVisible();
  await rows.nth(1).click(); // cyclist — two selected
  await expect(page.getByTestId('doc-tray-chip-cyclist')).toBeVisible();
  await rows.nth(2).click(); // pedestrian — the OLDEST (car_commuter) drops: slice(-2)
  await expect(page.getByTestId('doc-tray-chip-car_commuter')).toHaveCount(0);
  await expect(page.getByTestId('doc-tray-chip-pedestrian')).toBeVisible();
  await expect(rows.nth(0)).toHaveAttribute('aria-pressed', 'false');
  await rows.nth(2).click(); // a second click on a selected row deselects it
  await expect(page.getByTestId('doc-tray-chip-pedestrian')).toHaveCount(0);
  await page.getByTestId('doc-tray-clear').click();
  await expect(page.getByTestId('doc-tray-empty')).toBeVisible();
  await expect(rows.nth(1)).toHaveAttribute('aria-pressed', 'false');
  // the ordering pin's contract holds: still exactly one doc-group-row per group, in order
  const order = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-group')));
  expect(order).toHaveLength(7);
});

test('one selection opens the EVIDENCE STRIP — a group with no voices says so, never a dead door', async ({ page }) => {
  // the fixture carries NO voices (agents: []): the honest state is a sentence, not a button
  const art = { ...FIXTURE, scorecard: craftedScorecard() };
  await openDoc(page, art, mkReport(RUN_ID));
  await page.getByTestId('doc-group-row').first().click(); // car_commuter (bucket 1)
  const strip = page.getByTestId('doc-evidence');
  await expect(strip).toBeVisible();
  await expect(page.getByTestId('doc-no-voices')).toHaveText(
    'no voices in this run belong to Car commuters — nothing to hear; the numbers above stand on their own',
  );
  await expect(page.getByTestId('doc-hear')).toHaveCount(0);
  await expect(page.getByTestId('doc-interview')).toHaveCount(0);
  // THE NUMBERS' BASIS — the three cells with their confidence and NOTE as body text (the first
  // body-text render of cell notes in the document; before e they were hover titles only)
  const basis = page.getByTestId('doc-cell-basis');
  await expect(basis).toHaveCount(3);
  await expect(basis.nth(0)).toContainText('travel');
  await expect(basis.nth(0)).toContainText('measured — tt');
  await expect(basis.nth(1)).toContainText('safety ±43.24');
  await expect(basis.nth(1)).toContainText('low — surrogate');
  await expect(basis.nth(2)).toContainText('access');
  await expect(basis.nth(2)).toContainText('low — rule');
  // what is NOT a door is said, not faked
  await expect(page.getByTestId('doc-no-door')).toHaveText(
    'discourse, the chat and the graphs have no per-group view — they are reached from Explore',
  );
  // a not-measured group: every cell reads "not measured in this run"
  await page.getByTestId('doc-group-row').last().click(); // transit_riders — this drops car_commuter? no: two selected → the strip follows the LATEST single selection only when one is selected
  await page.getByTestId('doc-group-row').first().click(); // deselect car_commuter → one selected (transit_riders)
  await expect(page.getByTestId('doc-cell-basis').nth(0)).toContainText('not measured in this run');
  const body = await page.getByTestId('run-document').innerText();
  expect(body).not.toMatch(BANNED);
  expect(body).not.toMatch(STANCE_TALLY);
  if (process.env.NADI_SHOTS) {
    // the tray + strip sit below the document panel's scroll fold: bring them into view, then a
    // viewport capture (an element capture of the section is clipped at the fold)
    await page.getByTestId('doc-evidence').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '../docs-assets/v27e-c1-no-voices.png' });
  }
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
  // V2.7e — the doorway with REAL voices: SELECT a group → the strip counts what this run carries
  // (the committed example's own agents: 120 car commuters, all simulated) → the HEAR door opens
  // Watch with that group filtering the feed (the existing scorecard→feed join, unchanged)
  await page.locator('[data-testid="doc-group-row"][data-group="car_commuter"]').click();
  const strip = page.getByTestId('doc-evidence');
  await expect(strip).toContainText('120 voices in this run (120 simulated, 0 inferred)');
  // the Ask door's pick is a STATED curation — the rule is on the button
  await expect(page.getByTestId('doc-interview')).toHaveAttribute('title', /most-affected simulated voice/);
  if (process.env.NADI_SHOTS) {
    await page.getByTestId('doc-evidence').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '../docs-assets/v27e-c1-tray.png' });
  }
  await page.getByTestId('doc-hear').click();
  await expect(page.getByTestId('comment-feed')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('feed-filter-chip')).toContainText('Car commuters');
  await expect(page.getByTestId('run-document')).toHaveCount(0); // the door is the navigation
});

test('the feed says a zero-voice group has NO voices in this run — never "keep playing"', async ({ page }) => {
  // institutions-run.json carries one car commuter + one resident + one mandate voice, and FIVE
  // scorecard groups with no voice at all. Before e the filtered feed said "No Cyclists voices yet
  // — keep playing" for both "not fired yet" and "none exist" — false in the second case, and no
  // amount of playing could make it true.
  const inst = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'institutions-run.json'), 'utf-8'));
  const art = { ...inst, meta: { ...inst.meta, run_id: RUN_ID }, scorecard: craftedScorecard() };
  await openDoc(page, art, mkReport(RUN_ID));
  await page.locator('[data-testid="doc-group-row"][data-group="cyclist"]').click();
  await expect(page.getByTestId('doc-no-voices')).toContainText('Cyclists');
  // and the feed itself, reached through Watch's own scorecard row, agrees with the document
  await openStage(page, 'watch');
  await expect(page.getByTestId('comment-feed')).toBeVisible({ timeout: 15_000 });
  // pause at t=0 (the scrub convention): the car voice fires at t=450, and playback auto-runs at
  // 60× — the "yet" branch must be asserted BEFORE it fires, by content, not by racing the clock
  await page.locator('input[type=range]').first().fill('0');
  await page.getByTestId('scorecard-row').filter({ hasText: 'Cyclists' }).click();
  await expect(page.getByTestId('feed-empty')).toHaveText('No Cyclists voices in this run');
  // a group WITH a voice that has not fired yet keeps the honest "yet"
  await page.getByTestId('scorecard-row').filter({ hasText: 'Car commuters' }).click();
  await expect(page.getByTestId('feed-empty')).toHaveText('No Car commuters voices yet — keep playing.');
});

// ── V2.7e C2 — two selections: the ROOM CTA (canvas 1d) ─────────────────────────────────────────

test('two selections offer "Put A + B in a conversation" — and the seeded room states its composition', async ({ page }) => {
  await page.goto(`/?run=${EXAMPLE}`);
  await gate(page);
  await openStage(page, 'read');
  await expect(page.getByTestId('run-document')).toBeVisible({ timeout: 30_000 });
  await page.locator('[data-testid="doc-group-row"][data-group="car_commuter"]').click();
  await page.locator('[data-testid="doc-group-row"][data-group="cyclist"]').click();
  const cta = page.getByTestId('doc-room-cta');
  await expect(cta).toHaveText('Put Car commuters + Cyclists in a conversation →'); // canvas-verbatim
  await expect(page.getByTestId('doc-evidence')).toHaveCount(0); // the strip is a ONE-selection surface
  if (process.env.NADI_SHOTS) {
    await cta.scrollIntoViewIfNeeded();
    await page.screenshot({ path: '../docs-assets/v27e-c2-room-cta.png' });
  }
  await cta.click();
  // Watch, the room open, seeded by the STATED rule: alternating A/B, each group's most-affected
  // simulated voices first — 120 + 40 sim voices supply five seats as 3 + 2
  const drawer = page.getByTestId('room-drawer');
  await expect(drawer).toBeVisible({ timeout: 15_000 });
  await expect(drawer.locator('[data-testid^="room-member-"]')).toHaveCount(5);
  await expect(page.getByTestId('room-seed-note')).toHaveText(
    'seeded 3 from Car commuters, 2 from Cyclists — most-affected first; add or remove anyone',
  );
  // the curation note keeps its bytes — the seed sentence is a SEPARATE element
  await expect(page.getByTestId('room-note')).toHaveText(
    'voices you picked, answering one at a time — a conversation preview, not a poll or a sample of opinion',
  );
  await expect(page.getByTestId('room-blocker')).toHaveCount(0);
  await expect(page.getByTestId('feed-filter-chip')).toContainText('Car commuters'); // the feed follows group A
  const text = await drawer.innerText();
  expect(text).not.toMatch(BANNED);
  expect(text).not.toMatch(STANCE_TALLY);
  if (process.env.NADI_SHOTS) {
    // a viewport capture: the drawer sits in the right rail under live playback and an element
    // capture never reaches "stable" (the same class as the Act II frame)
    await page.getByTestId('room-seed-note').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '../docs-assets/v27e-c2-seeded-room.png' });
  }
});

test('a pair that cannot fill a room gets a sentence, not a door', async ({ page }) => {
  // institutions-run.json: one car commuter + one resident — two voices, and a room needs three
  const inst = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'institutions-run.json'), 'utf-8'));
  const art = { ...inst, meta: { ...inst.meta, run_id: RUN_ID }, scorecard: craftedScorecard() };
  await openDoc(page, art, mkReport(RUN_ID));
  await page.locator('[data-testid="doc-group-row"][data-group="car_commuter"]').click();
  await page.locator('[data-testid="doc-group-row"][data-group="local_resident"]').click();
  await expect(page.getByTestId('doc-room-cta')).toHaveCount(0);
  await expect(page.getByTestId('doc-room-short')).toHaveText(
    'Car commuters + Local residents carry only 2 voices in this run — a room needs 3',
  );
});

test('the Ask door opens the interview drawer on the group’s most-affected simulated voice', async ({ page }) => {
  await page.goto(`/?run=${EXAMPLE}`);
  await gate(page);
  await openStage(page, 'read');
  await expect(page.getByTestId('run-document')).toBeVisible({ timeout: 30_000 });
  await page.locator('[data-testid="doc-group-row"][data-group="local_resident"]').click();
  await expect(page.getByTestId('doc-evidence')).toContainText('3 voices in this run (0 simulated, 3 inferred)');
  await page.getByTestId('doc-interview').click();
  // Watch, with the drawer open on one of the group's own voices (an inferred group → its first
  // inferred voice; the grounding sentence says which kind of voice is answering)
  await expect(page.getByTestId('interview-drawer')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('interview-grounding')).toContainText("wasn't simulated directly");
});

// ── V2.7a follow-up — the document's NAME (the static-demo identity gap) ──────────────────────

test('title precedence: live identity name → report-carried name → the mechanical title', async ({ page }) => {
  const art = { ...FIXTURE, scorecard: craftedScorecard() };
  const named = mkReport(RUN_ID);
  (named.run as Record<string, unknown>).name = 'Kingston pilot v2';
  // no live status route → the report-carried name renders
  await openDoc(page, art, named);
  await expect(page.getByTestId('run-document').locator('h2').first()).toHaveText('Kingston pilot v2');
});

test('a LIVE identity name beats the report-carried name', async ({ page }) => {
  const art = { ...FIXTURE, scorecard: craftedScorecard() };
  const named = mkReport(RUN_ID);
  (named.run as Record<string, unknown>).name = 'STALE REPORT NAME';
  await page.route('**/api/runs', (route) =>
    route.fulfill({ json: { runs: [{ id: RUN_ID, description: 'd', status: 'done', stage: 'done', started_at: 1, name: 'Fresh live name' }] } }),
  );
  await openDoc(page, art, named);
  await expect(page.getByTestId('run-document').locator('h2').first()).toHaveText('Fresh live name');
});

test('an unnamed run keeps the mechanical title', async ({ page }) => {
  const art = { ...FIXTURE, scorecard: craftedScorecard() };
  await openDoc(page, art, mkReport(RUN_ID)); // no run.name anywhere
  await expect(page.getByTestId('run-document').locator('h2').first()).not.toHaveText(/^$/);
  await expect(page.getByTestId('run-document').locator('h2').first()).not.toContainText('Kingston');
});

test('the document title renders a markup name INERT (the V2.4c name-surface invariant)', async ({ page }) => {
  const art = { ...FIXTURE, scorecard: craftedScorecard() };
  const named = mkReport(RUN_ID);
  (named.run as Record<string, unknown>).name = '<img src=x onerror=alert(1)>';
  await openDoc(page, art, named);
  await expect(page.getByTestId('run-document').locator('h2').first()).toContainText('<img src=x'); // the LITERAL
});

test('the committed example report carries EXAMPLE_RUN_NAME — one source, no drift', async ({ page: _page }) => {
  // the run list's synthesized row imports the constant; the committed report is spec-pinned
  // EQUAL to it — two hardcoded copies of one name is the drift disease.
  const committed = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'public', `${EXAMPLE}-report.json`), 'utf-8'),
  );
  expect(committed.run.name).toBe(EXAMPLE_RUN_NAME);
});

test('a described AND windowed member renders its description once — no appended window', async ({ page }) => {
  const art = {
    ...FIXTURE,
    scorecard: craftedScorecard(),
    meta: {
      ...FIXTURE.meta,
      scenario: {
        ...FIXTURE.meta.scenario,
        changes: [{
          type: 'lane_closure', target_edge: 'E_A', target_lanes: [1],
          description: 'Closed 1 lane of edge E_A from t=600 s to t=1200 s',
          window: { start_s: 600, end_s: 1200 },
        }],
      },
    },
  };
  await openDoc(page, art, mkReport(RUN_ID));
  // scoped to the MEMBERS cell: the scope-disclosure note legitimately carries the en-dash
  // range elsewhere in the document — the duplication disease lives in this one cell
  const members = page.getByTestId('doc-members');
  await expect(members).toContainText('Closed 1 lane of edge E_A from t=600 s to t=1200 s');
  // the fmtWindowRange en-dash form appearing HERE means the window was appended ON TOP of
  // the description (the C3 interim-screenshot duplication) — it must not render
  await expect(members).not.toContainText('t=600–1200 s');
});
