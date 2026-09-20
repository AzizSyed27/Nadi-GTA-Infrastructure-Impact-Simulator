// V2.7b C9 — ACT II: the interpretation, streaming.
//
// Act II is the state where the run's OWN artifact is loaded (so Act I is over) and interpretation
// is still running. Everything on screen is content the run produced; the machinery that produced
// it is never shown. What these tests are for:
//
//   * THE FILE WINS. While the report stage runs, the document is a client-side MERGE of landed
//     slots. At stage_end the written file replaces it. A merge bug or one missed event would
//     otherwise leave the projection diverging from the persisted document forever — so the pin
//     serves a file whose text DIFFERS from the merged text and asserts the file's text is what
//     stands.
//   * VOICES ARRIVE ONE AT A TIME, asserted against the fold-driven card stream (hold /status at
//     `enrich:voices` so stream-driven rendering is provable — the enrich-stream.spec trick).
//   * DESIGNED SILENCE IS A RENDERED STATE. An institution with no facts in its mandate is a card
//     that says why, not an absent card that reads as an omission.
//   * LIVE-ONLY. A finished run reopened from the list must NOT show these cards — its ledger seed
//     carries stage statuses and could otherwise fake the act into history.

import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mockDefaultArtifactBody, DEFAULT_RUN_ID } from './support/default-artifact';
import { gate, openRunFromList, openStage } from './support/shell';
import { BANNED, GRAPHS_BANNED, STANCE_TALLY } from './support/sweeps';

/**
 * ONE id for the run and for the artifact's own `meta.run_id`, because that is what production
 * guarantees: `loadRun(id)` fetches `/<id>.json`, which the server wrote from that run. Act II
 * requires the loaded artifact to BE the watched run's — an id mismatch is Act I by definition, so
 * a fixture served under a different id than it carries would never reach this act at all.
 */
const RUN = DEFAULT_RUN_ID;
const ART = RUN;

/** institutions-run.json with its run id rewritten to the id it is served under (the documented
 *  in-memory-mutated fixture idiom). It carries a sim agent pinned to `veh0`. */
function loadedArtifact(): string {
  const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'institutions-run.json'), 'utf-8');
  const art = JSON.parse(raw) as { meta: { run_id: string } };
  art.meta.run_id = RUN;
  return JSON.stringify(art);
}

const frame = (id: number, event: string, data: Record<string, unknown>) =>
  `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify({ event, ts: 1_700_000_000 + id, ...data })}\n\n`;

const voice = (i: number, label: string, comment: string, extra: Record<string, unknown> = {}) => ({
  index: i, done: i + 1, total: 3,
  agent: { grounding: 'inferred', persona: { id: `p${i}`, label }, reaction: { comment, sentiment: 0, stance: 'neutral' }, ...extra },
});

const MANDATE = {
  institution: 'Toronto Fire Services',
  mission: 'To protect life, property and the environment from the effects of fire and other emergencies.',
  source: 'https://example.invalid/tfs',
  retrieved: '2026-08-01',
};
const TDSB_SILENT = {
  id: 'tdsb',
  label: 'Toronto District School Board',
  reason: 'no school-adjacent measure was computed for this run',
};

/** The merged text and the file's text DIFFER on purpose — that difference is the assertion. */
const MERGED_FRAMING = 'MERGED-FRAMING this sentence came off the event stream.';
const FILE_FRAMING = 'FILE-FRAMING this sentence came out of the written report.';
const DRAFT_TEXT = 'The majority of residents would clearly support this.';
const FINAL_TEXT = 'Some residents in this run saw shorter trips and others saw longer ones.';

/** Act II as the server writes it, up to (but not including) the report stage ending. */
function actTwoBody(opts: { report?: boolean; discourse?: boolean; index?: boolean } = {}): string {
  let b = 'retry: 100\n\n';
  b += frame(0, 'run_start', { run_id: ART, description: 'a closure', demand_profile: 'synthetic_demo' });
  b += frame(1, 'stage_start', { stage: 'enrich:voices', label: 'sampling travelers', kind: 'llm' });
  b += frame(2, 'personas', {
    total: 212, sim: 41, inferred: 171,
    basis: 'each point is one traveler on their own computed route — no invented people; 41 pinned to a simulated trip, 171 inferred community voices',
  });
  b += frame(3, 'voices_total', { total: 3 });
  b += frame(4, 'voice', voice(0, 'Time-pressed commuter', 'My usual drive felt longer.', { grounding: 'sim', vehicle_id: 'veh0' }));
  b += frame(5, 'voice', voice(1, 'Long-time corridor resident', 'Side streets picked up traffic.'));
  b += frame(6, 'voice', voice(2, 'Local shop owner', 'Fewer people came past the door.'));
  b += frame(7, 'institutions', {
    spoke: [{
      grounding: 'mandate', persona: { id: 'tfs', label: 'Toronto Fire Services' },
      reaction: { comment: 'The closure lengthens one approach to addresses on the closed segment.', sentiment: 0, stance: 'neutral' },
      mandate: MANDATE,
      citations: [{ key: 'response_access', text: '1 of 4 fire stations unreachable during the window; worst of the reachable +29.1 s added time to reach an end.', notes: ['These are free-flow estimates and not a dispatch model.'] }],
    }],
    silent: [TDSB_SILENT],
  });
  b += frame(8, 'stage_usage', { stage: 'voices', calls: 3 });
  b += frame(9, 'stage_end', { stage: 'enrich:voices', status: 'done', detail: '' });
  if (opts.discourse) {
    b += frame(10, 'stage_start', { stage: 'enrich:discourse', label: 'running the discourse cascades', kind: 'llm' });
    b += frame(11, 'stage_end', { stage: 'enrich:discourse', status: 'done', detail: '' });
    b += frame(12, 'stage_usage', { stage: 'discourse', calls: 9 });
  }
  if (opts.index) {
    b += frame(15, 'stage_start', { stage: 'enrich:index', label: 'building the chat index', kind: 'llm' });
    b += frame(16, 'index_progress', { docs: 235 });
  }
  if (opts.report) {
    b += frame(20, 'stage_start', { stage: 'enrich:report', label: 'writing the report', kind: 'llm' });
    b += frame(21, 'slot_start', { slot: 'framing' });
    b += frame(22, 'slot_landed', { slot: 'framing', status: 'clean', text: MERGED_FRAMING, violations: [], calls: 1 });
    b += frame(23, 'slot_landed', {
      slot: 'caveat_intro', status: 'resolved_on_retry', text: FINAL_TEXT,
      violations: [{ rule: 'tally', sentence: DRAFT_TEXT }], draft: DRAFT_TEXT, calls: 2,
    });
  }
  return b;
}

/** A minimal but real-shaped facts-only report: prose absent, figures present. */
function factsOnlyReport(framing = ''): string {
  return JSON.stringify({
    report_version: 3,
    prose: framing ? undefined : { status: 'not_composed', note: 'The figures and the full scorecard in this document are complete — they were computed by the simulator. No narrative has been composed for this run.' },
    generated_at: '2026-09-06T00:00:00Z',
    provider: null, model: null, run_id: ART,
    run: {
      scenario_run_id: ART, baseline_run_id: `${ART}-base`, network: 'corridor.net.xml',
      seeds: [42], thresholds: { ttc_s: 1.5, veh_pet_s: 2, ped_pet_s: 2, materiality_s: 30 },
      demand: { car: 300, bicycle: 82, pedestrian: 129 }, cars_rerouted: 5, severed_edges: [],
    },
    scenario_change: { description: 'Closure at the fire station’s doorstep', target_edge: '-36784353#20' },
    scorecard: {},
    car_tail: { median_s: 1.2, share_gt30_pct: 0, cross_seed_available: false, sentence: 'Single seed (42) — cross-seed stability of this tail was not probed for this run.' },
    sections: {
      what_tested: { framing },
      who_affected: { glosses: {}, group_order: ['car_commuter', 'cyclist', 'pedestrian'] },
      what_they_say: { groups: [] },
      institutional: null,
      discourse: null,
      cannot_tell: { intro: '', caveats: [{ title: 'Surrogates, not crashes', body: 'Safety figures are surrogate near-miss measures.' }] },
    },
    audit: { passed: null, slots_checked: 0, summary: 'no narrative was composed for this run — nothing to audit.', log: [] },
    sources: [],
  });
}

async function mockActTwo(
  page: Page,
  opts: { events?: string; status?: Record<string, unknown>; report?: string; graphs?: boolean; realGraph?: boolean; holdVoices?: boolean } = {},
) {
  await mockDefaultArtifactBody(page, loadedArtifact());
  await page.route('**/api/junctions**', (r) => r.fulfill({ json: { junctions: [], count: 0 } }));
  await page.route('**/api/edges**', (r) => r.fulfill({ json: { edges: [], count: 0 } }));
  await page.route('**/api/runs', (r) =>
    r.fulfill({ json: { runs: [{ id: RUN, description: 'a closure', status: 'running', stage: 'enrich:voices', started_at: 1 }] } }));
  await page.route('**/api/runs/*/status', (r) =>
    r.fulfill({
      json: {
        run_id: RUN, stage: 'enrich:voices', status: 'running', description: 'a closure',
        ...(opts.status ?? {}),
      },
    }));
  await page.route('**/api/runs/*/ledger', (r) => r.fulfill({ json: { run_id: RUN, ledger: null } }));
  await page.route('**/api/runs/*/events', (r) =>
    r.fulfill({ status: 200, contentType: 'text/event-stream', body: opts.events ?? actTwoBody() }));
  await page.route(`**/${ART}-report.json`, (r) =>
    r.fulfill({ body: opts.report ?? factsOnlyReport(), contentType: 'application/json' }));
  await page.route(`**/${ART}-graphs.json`, (r) => {
    if (opts.realGraph) {
      // the COMMITTED pinned sidecar: 205 nodes, 724 edges, 3 cascades — a real cascade, not a stub
      const real = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', 'public', 'multimodal-scenario-20260702T044134Z-graphs.json'), 'utf-8')) as { oasis: unknown };
      return r.fulfill({ json: { run_id: ART, generated_at: '2026-09-07T00:00:00Z', entity: null, oasis: real.oasis } });
    }
    return opts.graphs
      ? r.fulfill({
          json: {
            run_id: ART, generated_at: '2026-09-06T00:00:00Z', entity: null,
            oasis: {
              framing: 'who influences whom', seed: 42, layout: 'spring',
              nodes: [
                { id: 'a', x: -0.5, y: 0, label: 'Time-pressed commuter', group: 'car', grounding: 'sim', connected: true },
                { id: 'b', x: 0.5, y: 0.3, label: 'Long-time corridor resident', group: 'local_resident', grounding: 'inferred', connected: true, excluded: { count: 1, rules: ['safety_direction'] } },
              ],
              edges: [{ from: 'a', to: 'b', kind: 'homophily' }],
              influence: [{ cascade_id: 'c1', from: 'a', to: 'b', shifted: true }],
              coverage: { agents: 2, nodes: 2, with_edges: 2 },
              exposure_note: 'influence connectors are drawn from opinion trajectories, separately from follow edges',
            },
          },
        })
      : r.fulfill({ status: 404, body: 'no sidecar' });
  });
}

/** Land, open the run (its artifact IS the loaded one), go to Watch. */
async function enterActTwo(page: Page) {
  await page.goto('/');
  await gate(page);
  await page.reload();
  await expect(page.getByTestId('stage-build')).toBeVisible({ timeout: 20_000 });
  await openRunFromList(page, RUN);
  await openStage(page, 'watch');
  await expect(page.getByTestId('act-two')).toBeVisible({ timeout: 20_000 });
}

// ------------------------------------------------------------------------------- the six cards

test('the six stage cards render, follow the running stage, and click back to pin', async ({ page }) => {
  await mockActTwo(page);
  await enterActTwo(page);

  for (const k of ['personas', 'voices', 'institutions', 'discourse', 'report', 'index']) {
    await expect(page.getByTestId(`act-two-card-${k}`)).toBeVisible();
  }
  // auto-follow landed on a stage that actually produced something
  await expect(page.getByTestId('act-two-panel-institutions')).toBeVisible();

  // click back to a finished stage: it PINS, and the follow control appears to give the act back
  await page.getByTestId('act-two-card-personas').click();
  await expect(page.getByTestId('act-two-panel-personas')).toBeVisible();
  await expect(page.getByTestId('act-two-follow')).toBeVisible();
  await page.getByTestId('act-two-follow').click();
  await expect(page.getByTestId('act-two-follow')).toHaveCount(0);
  // env-gated capture for the looked-at review (`NADI_SHOTS=1 npx playwright test act-two --headed`)
  if (process.env.NADI_SHOTS) await page.screenshot({ path: '../docs-assets/v27b-c9-rail.png' });
});

test('a stage that runs no model says so, instead of rendering a bare zero', async ({ page }) => {
  await mockActTwo(page);
  await enterActTwo(page);
  await expect(page.getByTestId('act-two-card-personas')).toContainText('no model');
  await expect(page.getByTestId('act-two-card-institutions')).toContainText('no model');
  await expect(page.getByTestId('act-two-card-voices')).toContainText('3 calls');
});

// --------------------------------------------------------------------------------------- panels

test('personas: the count split and the SERVER’s basis sentence, and what it cannot show', async ({ page }) => {
  await mockActTwo(page);
  await enterActTwo(page);
  await page.getByTestId('act-two-card-personas').click();
  const p = page.getByTestId('act-two-personas');
  await expect(p).toContainText('212');
  await expect(p).toContainText('each point is one traveler on their own computed route — no invented people');
  // the emitter carries no ids[], so the card says what it is not showing rather than faking it
  await expect(page.getByTestId('personas-not-shown')).toContainText('isn’t shown on the map');
});

test('voices arrive ONE AT A TIME off the stream, while the run still reads as running', async ({ page }) => {
  // Only the first two voices are in the body; the status stays `enrich:voices`, so anything
  // rendered here was rendered from the STREAM, not from a reload of a finished artifact.
  const partial = actTwoBody().split(frame(6, 'voice', voice(2, 'Local shop owner', 'Fewer people came past the door.')))[0];
  await mockActTwo(page, { events: partial });
  await enterActTwo(page);
  await page.getByTestId('act-two-card-voices').click();

  await expect(page.getByTestId('act-two-voice')).toHaveCount(2);
  await expect(page.getByTestId('act-two-voice-count')).toContainText('2 of 3 voices');
  const first = page.getByTestId('act-two-voice').first();
  await expect(first).toContainText('Long-time corridor resident'); // newest first
  await expect(page.getByTestId('act-two-voices')).toContainText('My usual drive felt longer.');
});

test('institutions: TFS speaks with its mandate verbatim; TDSB’s silence is a STATE with a reason', async ({ page }) => {
  await mockActTwo(page);
  await enterActTwo(page);
  await page.getByTestId('act-two-card-institutions').click();

  const inst = page.getByTestId('act-two-institution');
  await expect(inst).toContainText(MANDATE.mission); // verbatim roster bytes, never paraphrased
  await expect(inst).toContainText('retrieved 2026-08-01');
  await expect(page.getByTestId('act-two-citation')).toContainText('+29.1 s added time to reach an end');
  await expect(page.getByTestId('act-two-citation')).toContainText('free-flow estimates and not a dispatch model');
  await expect(page.getByTestId('act-two-disclaimer'))
    .toContainText('not a statement by, from, or on behalf of Toronto Fire Services.');

  const silent = page.getByTestId('institution-silent');
  await expect(silent).toBeVisible();
  await expect(silent).toContainText('Toronto District School Board');
  await expect(silent).toContainText('no school-adjacent measure was computed for this run');
  await expect(page.getByTestId('act-two-institutions')).toContainText('Silence is the honest output here');
  if (process.env.NADI_SHOTS) await page.screenshot({ path: '../docs-assets/v27b-c9-institutions.png' });
});

test('discourse: while it runs it admits it has no step-by-step progress; then the graph replays', async ({ page }) => {
  await mockActTwo(page, {
    events: actTwoBody() + frame(10, 'stage_start', { stage: 'enrich:discourse', label: 'running the discourse cascades', kind: 'llm' }),
  });
  await enterActTwo(page);
  await expect(page.getByTestId('act-two-panel-discourse')).toBeVisible();
  await expect(page.getByTestId('act-two-discourse'))
    .toContainText('This stage reports no step-by-step progress');

});

test('discourse: once the stage ends the graph lands, labeled as a REPLAY of recorded steps', async ({ page }) => {
  await mockActTwo(page, { events: actTwoBody({ discourse: true }), realGraph: true });
  await enterActTwo(page);
  await page.getByTestId('act-two-card-discourse').click();

  await expect(page.getByTestId('graph-canvas-act-two-oasis')).toBeVisible({ timeout: 20_000 });
  // node positions are computed AFTER the cascade, so there is no honest way to animate it live
  await expect(page.getByTestId('discourse-replay-note')).toContainText('nothing here is animating live');
  await expect(page.getByTestId('act-two-discourse-doorway')).toContainText('Explore · Discourse');
  // the posts are NOT duplicated here — their text lives only in the artifact
  await expect(page.getByTestId('act-two-discourse')).toContainText('influence connectors are drawn from opinion trajectories');
  if (process.env.NADI_SHOTS) await page.screenshot({ path: '../docs-assets/v27b-c10-oasis-graph.png' });
});

// ------------------------------------------------------------------------------- the report stage

test('the document composes from landed slots, and the audit line tallies them', async ({ page }) => {
  await mockActTwo(page, { events: actTwoBody({ report: true }) });
  await enterActTwo(page);
  await page.getByTestId('act-two-card-report').click();

  // the merged framing is on screen BEFORE any file carries it
  await expect(page.getByTestId('act-two-document')).toContainText(MERGED_FRAMING, { timeout: 20_000 });
  await expect(page.getByTestId('act-two-audit-line')).toContainText('1 clean · 1 corrected on retry · 0 unresolved');
  // and the prose-not-composed box does NOT contradict the prose now on screen
  await expect(page.getByTestId('prose-not-composed')).toHaveCount(0);
  await expect(page.getByTestId('act-two-skeleton')).toBeVisible();
  if (process.env.NADI_SHOTS) await page.screenshot({ path: '../docs-assets/v27b-c10-report-skeleton.png' });
});

test('VIEW THE CORRECTION shows the rejected draft, the rule, and what replaced it', async ({ page }) => {
  await mockActTwo(page, { events: actTwoBody({ report: true }) });
  await enterActTwo(page);
  await page.getByTestId('act-two-card-report').click();
  await page.getByTestId('act-two-view-correction').click();

  await expect(page.getByTestId('act-two-correction')).toContainText('caught by tally');
  await expect(page.getByTestId('act-two-draft')).toHaveText(DRAFT_TEXT);
  await expect(page.getByTestId('act-two-final')).toHaveText(FINAL_TEXT);
  if (process.env.NADI_SHOTS) await page.screenshot({ path: '../docs-assets/v27b-c9-correction.png' });
});

test('THE FILE WINS: at stage_end the written report replaces the merge', async ({ page }) => {
  // the file's framing DIFFERS from the merged framing — that difference is the whole assertion
  const written = factsOnlyReport(FILE_FRAMING);
  await mockActTwo(page, {
    events: actTwoBody({ report: true }) + frame(24, 'stage_end', { stage: 'enrich:report', status: 'done', detail: '' }),
    report: written,
  });
  await enterActTwo(page);
  await page.getByTestId('act-two-card-report').click();

  await expect(page.getByTestId('act-two-document')).toContainText(FILE_FRAMING, { timeout: 20_000 });
  await expect(page.getByTestId('act-two-document')).not.toContainText(MERGED_FRAMING);
});

// ------------------------------------------------------------------------------------ live-only

test('a FINISHED run reopened from the list shows no act — Act II is live-only', async ({ page }) => {
  // Its ledger seed carries stage statuses, which is exactly what could fake the act into history.
  await mockActTwo(page, { status: { stage: 'done', status: 'done' } });
  await page.unroute('**/api/runs/*/ledger');
  await page.route('**/api/runs/*/ledger', (r) =>
    r.fulfill({
      json: {
        run_id: RUN,
        ledger: {
          run_id: RUN,
          stages: [
            { key: 'personas', status: 'done', llm_calls: 0 },
            { key: 'voices', status: 'done', llm_calls: 213 },
            { key: 'institutions', status: 'done', llm_calls: 0 },
            { key: 'discourse', status: 'done', llm_calls: 9 },
            { key: 'report', status: 'done', llm_calls: 13 },
            { key: 'index', status: 'done', llm_calls: 4 },
          ],
          ended: { status: 'complete', at: 1_700_000_500, reason: '' },
        },
      },
    }));
  await page.goto('/');
  await gate(page);
  await page.reload();
  await expect(page.getByTestId('stage-build')).toBeVisible({ timeout: 20_000 });
  await openRunFromList(page, RUN);
  await openStage(page, 'watch');

  await expect(page.getByTestId('comment-feed')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('act-two')).toHaveCount(0);
});

test('the run PASSES THROUGH done between the acts, and the poll comes back for Act II', async ({ page }) => {
  // THE PRIMARY PATH, and it was broken (found by C11's live acceptance). The harness writes `done`
  // at the end of the quant leg and the chain writes `enrich:voices` a moment later. A poll landing
  // in that window saw a terminal run and STOPPED FOR GOOD — so the status froze at `done`, Act II
  // never mounted for the reader who started the run, and the interpretation ran invisibly until a
  // reload recovered it. The fix is in the POLL, not in the act's predicate: a `stage_start`
  // arriving after the stop restarts it (bounded to one restart per stage key), which puts the
  // status back to `enrich:*` and mounts the act.
  //
  // THE ORDERING IS THE WHOLE FIXTURE. The chain's events must arrive AFTER the terminal blip, or
  // the test proves nothing: a buffered mock that delivers every frame at mount folds the stage
  // events while the poll is still running, so no restart is ever needed and the pin passes with
  // the fix reverted. So the stream is served in two parts, as the server writes it — the quant
  // leg's own frames first, then the chain's, once the poll has already stopped.
  await mockActTwo(page);
  let chainRequested = false;
  const chainDelivered = { done: false };
  let polls = 0;
  let sawBlip = false;
  await page.unroute('**/api/runs/*/events');
  await page.route('**/api/runs/*/events', async (r) => {
    if (!chainRequested) {
      // part 1: the run exists and its quant leg is over. No stage events yet — the chain has not
      // written any. The connection ends, and `retry` brings the client back for part 2.
      const head = ['retry: 300', '', ''].join('\n')
        + frame(0, 'run_start', { run_id: ART, description: 'a closure', demand_profile: 'synthetic_demo' });
      chainRequested = true;
      return r.fulfill({ status: 200, contentType: 'text/event-stream', body: head });
    }
    // part 2, held back until the poll has had time to see the terminal blip and stop
    await new Promise((res) => setTimeout(res, 3000));
    chainDelivered.done = true;
    return r.fulfill({ status: 200, contentType: 'text/event-stream', body: actTwoBody() });
  });
  await page.unroute('**/api/runs/*/status');
  await page.route('**/api/runs/*/status', (r) => {
    polls += 1;
    // terminal from the second poll until the chain has spoken — the live window exactly
    const blip = polls >= 2 && !chainDelivered.done;
    if (blip) sawBlip = true;
    return r.fulfill({
      json: {
        run_id: RUN, description: 'a closure',
        stage: blip ? 'done' : 'enrich:voices',
        status: blip ? 'done' : 'running',
      },
    });
  });
  await enterActTwo(page);

  // the terminal blip really was served, and the poll came back from it — a stopped poll would
  // have frozen there forever, which is what the live run did
  expect(sawBlip, 'the fixture must actually pass through a terminal status').toBe(true);
  await expect.poll(() => polls, { timeout: 20_000 }).toBeGreaterThan(2);
  await expect(page.getByTestId('act-two')).toBeVisible();
  await expect(page.getByTestId('act-two-card-voices')).toContainText('3 calls');
});

// --------------------------------------------------------------------------------------- sweeps

// ---- V2.7d C3b — the voice card's origin→destination line: derived from the network, or omitted ----
// veh0 (institutions-run.json) runs from [-79.222988, 43.744264] to [-79.225489, 43.742848]. Two hand
// edges straddle those endpoints (100 m east-west segments centred on each), so the line is a
// hand-known literal; an UNNAMED nearest edge omits the line — the honesty rule, never a fallback
// to the nearest named street.
const DEG_PER_M_LON_ACT = 1 / (111_195 * Math.cos((43.744 * Math.PI) / 180));
function odNet(originName: string | null) {
  const seg = (id: string, [lon, lat]: [number, number], name: string | null) => ({
    id, geometry: [[lon - 50 * DEG_PER_M_LON_ACT, lat], [lon + 50 * DEG_PER_M_LON_ACT, lat]],
    lanes: [{ width_m: 2.0, allows: { car: false, bike: false, ped: true, bus: false } }, { width_m: 3.2, allows: { car: true, bike: true, ped: false, bus: true } }],
    lane_count: 2, speed_mps: 13.9, oneway: true, allows: { car: true, bike: true, ped: true }, name, from: `${id}:a`, to: `${id}:b`, reverse: null,
  });
  return { edges: [seg('orig', [-79.222988, 43.744264], originName), seg('dest', [-79.225489, 43.742848], 'Destination Road')] };
}

test('V2.7d: a sim voice card names its trip from origin street to destination street when both resolve', async ({ page }) => {
  await mockActTwo(page, { events: actTwoBody() });
  await page.route('**/network.json', (r) => r.fulfill({ json: odNet('Origin Street') })); // after mockActTwo → wins
  await enterActTwo(page);
  await page.getByTestId('act-two-card-voices').click();
  await expect(page.getByTestId('act-two-voice')).toHaveCount(3); // the default body: one sim voice (veh0) + two inferred
  await expect(page.getByTestId('act-two-voice-od')).toHaveCount(1); // the inferred voices have no trip
  await expect(page.getByTestId('act-two-voice-od')).toHaveText('from Origin Street to Destination Road');
});

test('V2.7d: the origin→destination line is OMITTED when the nearest edge at either end is unnamed', async ({ page }) => {
  await mockActTwo(page, { events: actTwoBody() });
  await page.route('**/network.json', (r) => r.fulfill({ json: odNet(null) }));
  await enterActTwo(page);
  await page.getByTestId('act-two-card-voices').click();
  await expect(page.getByTestId('act-two-voice')).toHaveCount(3);
  await expect(page.getByTestId('act-two-voice-od')).toHaveCount(0);
});

test('Act II adds no aggregate framing of its own, on any stage', async ({ page }) => {
  await mockActTwo(page, { events: actTwoBody({ report: true, discourse: true, index: true }), graphs: true });
  await enterActTwo(page);

  for (const k of ['personas', 'voices', 'institutions', 'discourse', 'report', 'index']) {
    await page.getByTestId(`act-two-card-${k}`).click();
    const text = await page.getByTestId('act-two').innerText();
    expect(text, `stage ${k}`).not.toMatch(BANNED);
    expect(text, `stage ${k}`).not.toMatch(STANCE_TALLY);
    // the discourse stage renders a GRAPH — no centrality, no influencer ranking
    if (k === 'discourse') expect(text).not.toMatch(GRAPHS_BANNED);
  }
});

// ── V2.7f C2 — the panel narrates what the ledger says ran ─────────────────────────────────────

/** The chain-off ledger the V2.7d acceptance run left behind (act-one's `CHAIN_OFF_LEDGER` shape,
 *  under this file's run) AS THE SERVER HOLDS IT DURING A MANUAL VOICES JOB: the three rows that job
 *  began are `running` / 0 (C0 begins them at the POST); every never-run stage `skipped` — a ledger
 *  VERDICT, not a start; once the job ends, its rows are closed with its count. */
function chainOffLedger(closed = false) {
  const row = (key: string, label: string, llm: boolean, status: string, calls: number) =>
    ({ key, label, llm, status, llm_calls: calls, detail: '' });
  const inFlight = closed ? 'done' : 'running';
  return {
    run_id: RUN,
    quant: { status: 'done', started_at: 1, ended_at: 2 },
    facts_report: { status: 'done', at: 3 },
    stages: [
      row('personas', 'personas sampled', false, inFlight, 0),
      row('voices', 'voices', true, inFlight, closed ? 3 : 0),
      row('institutions', 'institutions', false, inFlight, 0),
      row('discourse', 'discourse', true, 'skipped', 0),
      row('report', 'report', true, 'skipped', 0),
      row('index', 'chat index', true, 'skipped', 0),
    ],
    projection: { calls: 215, basis: '212 travelers, one call each, plus a 1% retry allowance' },
    ended: { status: 'complete', at: 4, reason: 'interpretation not requested' },
  };
}

/** A MANUAL voices enrich as the server writes it (C0: `keys` on the start line), optionally with
 *  the job's own ending — the rows are closed in the ledger BEFORE that line. */
function manualVoicesBody(withEnding: boolean): string {
  let b = 'retry: 300\n\n';
  b += frame(0, 'run_start', { run_id: ART, description: 'a closure', demand_profile: 'synthetic_demo' });
  b += frame(1, 'stage_start', { stage: 'enrich:voices', label: 'enrich:voices', kind: 'llm', stages: ['sampling travelers', 'generating voices'], keys: ['personas', 'voices', 'institutions'] });
  b += frame(2, 'personas', { total: 212, sim: 41, inferred: 171, basis: 'each point is one traveler on their own computed route' });
  b += frame(3, 'voices_total', { total: 3 });
  b += frame(4, 'voice', voice(0, 'Time-pressed commuter', 'My usual drive felt longer.', { grounding: 'sim', vehicle_id: 'veh0' }));
  b += frame(5, 'voice', voice(1, 'Long-time corridor resident', 'Side streets picked up traffic.'));
  b += frame(6, 'voice', voice(2, 'Local shop owner', 'Fewer people came past the door.'));
  b += frame(7, 'institutions', { spoke: [], silent: [TDSB_SILENT] });
  b += frame(8, 'stage_usage', { stage: 'voices', calls: 3 });
  if (withEnding) {
    b += frame(9, 'stage_end', { stage: 'enrich:voices', status: 'done', detail: '' });
    b += frame(10, 'run_ended', { status: 'complete', detail: '' });
  }
  return b;
}

test('a manual voices enrich on a chain-off run: the panel follows what ran, and a stage that did not run says so', async ({ page }) => {
  // THE LIVE FRAME (v27e-c5-live-act2-first.png): card 06 "chat index" rendered SELECTED with
  // "— 0 calls" and a body reading "Building the chat index from this run's corpus… It is still
  // working." — on a voices-only manual enrich of a run whose chain never ran. The follow fallback
  // treated the ledger's `skipped` as "started" (index is last in the rail, so it won every time no
  // stage was running), the body keyed on `done` alone, and a skipped row's `llm_calls: 0` rendered
  // as a count. Narration derives from the ledger's stage states now: skipped is a verdict.
  await mockActTwo(page);
  let releaseEnding: () => void = () => {};
  const endingGate = new Promise<void>((res) => (releaseEnding = res));
  let servedEnding = false;
  await page.unroute('**/api/runs/*/ledger');
  await page.route('**/api/runs/*/ledger', (r) => r.fulfill({ json: { run_id: RUN, ledger: chainOffLedger(servedEnding) } }));
  await page.unroute('**/api/runs/*/events');
  let streamCalls = 0;
  await page.route('**/api/runs/*/events', async (r) => {
    const i = streamCalls++;
    if (i >= 1) {
      await endingGate;
      servedEnding = true; // the rows are closed before the run_ended line is written
    }
    return r.fulfill({ status: 200, contentType: 'text/event-stream', body: manualVoicesBody(i >= 1) });
  });
  await enterActTwo(page);

  // the followed card is the last stage that actually RAN — institutions, never the skipped index
  await expect(page.getByTestId('act-two-panel-institutions')).toBeVisible({ timeout: 15_000 });
  const index = page.getByTestId('act-two-card-index');
  await expect(index).toHaveAttribute('data-status', 'skipped');
  await expect(index).toHaveAttribute('aria-current', 'false');
  await expect(index).not.toContainText('calls'); // a skipped row's 0 is not a count
  if (process.env.NADI_SHOTS) await page.screenshot({ path: '../docs-assets/v27f-c2-manual-voices-panel.png' });

  await index.click();
  const panel = page.getByTestId('act-two-index');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('did not run');
  await expect(panel).not.toContainText('Building');
  await expect(panel).not.toContainText('still working');
  const text = await page.getByTestId('act-two').innerText();
  expect(text).not.toMatch(BANNED);
  expect(text).not.toMatch(STANCE_TALLY);
  if (process.env.NADI_SHOTS) await page.screenshot({ path: '../docs-assets/v27f-c2-index-did-not-run.png' });

  // the job ends: the rows the server closed merge in, the act stays up (a server that had left
  // them skipped would flip the chain state to 'none' on the re-read and unmount it)
  releaseEnding();
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __nadiRunFeed?: { ended: string | null } }).__nadiRunFeed))?.ended, { timeout: 15_000 }).toBe('complete');
  await expect(page.getByTestId('act-two')).toBeVisible();
  await expect(page.getByTestId('act-two-card-voices')).toHaveAttribute('data-status', 'done', { timeout: 10_000 });
});

// ── V2.7e C1 — the document's doorways answer the wrong-run predicate ───────────────────────────

test('the document’s doorways are BLOCKED while Act II holds Watch', async ({ page }) => {
  // The strip's doors lead to Watch. During Act II, Watch is the interpretation streaming in —
  // no feed, no room, no drawer to land on — so a live-looking door would be the
  // clickable-then-failing surface V2.7a refused to ship. (Act I needs no door at all: Read shows
  // the not-computed panel, and no document exists to select in — pinned in act-one.spec.)
  // The stream REPLACES the loaded artifact's voices with the streamed set (the V2.3a new-job
  // rule), and the default body's personas are placeholders (`p0`…) that belong to no scorecard
  // group. One token makes the streamed sim voice a real car commuter, so the strip has a door
  // to disable — the assertion is on the door, not on an empty strip.
  await mockActTwo(page, { events: actTwoBody().replace('"id":"p0"', '"id":"time_pressed"') });
  await enterActTwo(page);
  await openStage(page, 'read');
  await expect(page.getByTestId('run-document')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-testid="doc-group-row"][data-group="car_commuter"]').click();
  await expect(page.getByTestId('doc-evidence')).toContainText('1 voice in this run (1 simulated, 0 inferred)');
  await expect(page.getByTestId('doc-doors-blocked')).toHaveText(
    'Watch is showing a run in progress — these doors open when it lands',
  );
  await expect(page.getByTestId('doc-hear')).toBeDisabled();
  await expect(page.getByTestId('doc-interview')).toBeDisabled();
  // a VIEWPORT capture: an element capture waits for stability, which Act II's live re-renders
  // behind the document panel never grant
  if (process.env.NADI_SHOTS) {
    await page.getByTestId('doc-doors-blocked').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '../docs-assets/v27e-c1-blocked.png' });
  }
});
