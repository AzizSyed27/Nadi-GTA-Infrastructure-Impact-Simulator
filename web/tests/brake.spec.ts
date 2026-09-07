// V2.7b C10b — THE BRAKE, and the sentence that lets a reader consent before pressing Run.
//
// The chain is armed as of this commit, so a reader who presses Run now spends ~1,800 model calls.
// Three things had to be true first, and each is pinned here:
//
//   * A COST THEY CAN SEE AND ACT ON. The running total sits beside the control that stops it —
//     a number you cannot act on is just a number — and it NEVER understates: retries are real
//     calls the projection cannot know, so the title says the estimate is not a cap.
//   * SKIP TAKES YOU TO THE ANSWER. Once every exit path is terminal (C10a), skipping unmounts
//     Act II — so without this the reader lands on Watch's finished layout, two clicks from the
//     block explaining what they just did. The navigation fires on THE CLICK, never on the
//     terminal edge: a run that simply ends, or one stopped from another surface, must not yank a
//     reader off whatever they were reading.
//   * THE FIGURES ARE FINAL, SAID FIRST. The stopped block leads with it, because that is the
//     whole design: interpretation is an addition on top of numbers that were already complete.

import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mockDefaultArtifactBody, DEFAULT_RUN_ID } from './support/default-artifact';
import { gate, openRunFromList, openStage } from './support/shell';

const RUN = DEFAULT_RUN_ID;

const frame = (id: number, event: string, data: Record<string, unknown>) =>
  `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify({ event, ts: 1_700_000_000 + id, ...data })}\n\n`;

function loadedArtifact(): string {
  const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'institutions-run.json'), 'utf-8');
  const art = JSON.parse(raw) as { meta: { run_id: string } };
  art.meta.run_id = RUN;
  return JSON.stringify(art);
}

/** Mid-run: voices streaming, nothing ended. */
function runningBody(): string {
  let b = 'retry: 100\n\n';
  b += frame(0, 'run_start', { run_id: RUN, description: 'a closure', demand_profile: 'synthetic_demo' });
  b += frame(1, 'stage_start', { stage: 'enrich:voices', label: 'sampling travelers', kind: 'llm' });
  b += frame(2, 'personas', { total: 212, sim: 41, inferred: 171, basis: 'each point is one traveler' });
  b += frame(3, 'voices_total', { total: 213 });
  b += frame(4, 'voice', { index: 0, done: 47, total: 213, agent: { grounding: 'inferred', persona: { id: 'p0', label: 'A resident' }, reaction: { comment: 'Quieter.', sentiment: 0, stance: 'neutral' } } });
  b += frame(5, 'stage_usage', { stage: 'voices', calls: 47 });
  return b;
}

/** The same run, stopped. */
function stoppedBody(): string {
  return runningBody() + frame(6, 'stage_partial', { stage: 'enrich:voices', keys: ['voices'] })
    + frame(7, 'run_ended', { status: 'skipped', detail: 'stopped at your request' });
}

const LEDGER_STOPPED = {
  run_id: RUN,
  stages: [
    { key: 'personas', status: 'done', llm_calls: 0, label: 'personas sampled' },
    { key: 'voices', status: 'partial', llm_calls: 47, label: 'voices' },
    { key: 'institutions', status: 'skipped', llm_calls: 0, label: 'institutions' },
    { key: 'discourse', status: 'skipped', llm_calls: 0, label: 'discourse' },
    { key: 'report', status: 'skipped', llm_calls: 0, label: 'report' },
    { key: 'index', status: 'skipped', llm_calls: 0, label: 'chat index' },
  ],
  projection: { calls: 1815, basis: '212 travelers, one call each; ~13 report slots; 3 discourse cascades' },
  ended: { status: 'skipped', at: 1_700_000_500, reason: 'stopped at your request' },
};

async function mockRun(
  page: Page,
  opts: { events?: string; ledger?: unknown; skipStatus?: number; projection?: unknown | null } = {},
) {
  await mockDefaultArtifactBody(page, loadedArtifact());
  await page.route('**/api/junctions**', (r) => r.fulfill({ json: { junctions: [], count: 0 } }));
  await page.route('**/api/edges**', (r) => r.fulfill({ json: { edges: [], count: 0 } }));
  await page.route('**/api/projection**', (r) =>
    opts.projection === null
      ? r.fulfill({ status: 500, body: 'nope' })
      : r.fulfill({ json: opts.projection ?? { calls: 1815, basis: 'the basis', armed: true } }));
  await page.route('**/api/runs', (r) =>
    r.fulfill({ json: { runs: [{ id: RUN, description: 'a closure', status: 'running', stage: 'enrich:voices', started_at: 1 }] } }));
  await page.route('**/api/runs/*/status', (r) =>
    r.fulfill({ json: { run_id: RUN, stage: 'enrich:voices', status: 'running', description: 'a closure' } }));
  await page.route('**/api/runs/*/ledger', (r) =>
    r.fulfill({ json: { run_id: RUN, ledger: opts.ledger ?? null } }));
  // THE REPLAY RULE, as the real server implements it: a reconnect resumes from `Last-Event-ID`
  // and does NOT resend the header. A mock that replays from 0 on every reconnect makes one streamed
  // voice render as five, because the client's dedup floor resets on `run_start` (caught by looking
  // at a screenshot of a one-voice fixture showing five cards).
  let served = 0;
  await page.route('**/api/runs/*/events', (r) => {
    const resume = r.request().headers()['last-event-id'];
    const body = resume != null || served++ > 0 ? 'retry: 100000\n\n' : (opts.events ?? runningBody());
    return r.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });
  await page.route('**/api/runs/*/skip', (r) =>
    opts.skipStatus && opts.skipStatus >= 400
      ? r.fulfill({ status: opts.skipStatus, json: { detail: 'a job is already running (other); one job at a time' } })
      : r.fulfill({ json: { run_id: RUN, cancel_requested: true } }));
  await page.route('**/api/runs/*/resume', (r) => r.fulfill({ json: { run_id: RUN, resuming: ['voices'] } }));
  await page.route(`**/${RUN}-report.json`, (r) => r.fulfill({ status: 404, body: 'none' }));
}

/** A draft with one member — the Run button (and its cost sentence) live in the draft panel, which
 *  is the moment a reader is actually deciding to spend. Same seam-gated flow as draft-basket.spec:
 *  a pick before `/api/edges` lands snapshots an empty lane picker. */
async function openDraft(page: Page) {
  await page.route('**/network.json', (r) =>
    r.fulfill({ json: { edges: [{ id: 'E_A', geometry: [[-79.23, 43.77], [-79.22, 43.775]], lanes: 2, speed_mps: 13.9, oneway: false, allows: { car: true, bike: true, ped: true } }] } }));
  await page.unroute('**/api/edges**');
  await page.route('**/api/edges**', (r) =>
    r.fulfill({ json: { edges: [{ id: 'E_A', car_lane_count: 1, car_lane_indices: [0], eligible_bike_lane: true, eligibility_reason: 'eligible' }], count: 1 } }));
  await page.goto('/');
  await gate(page);
  await page.reload();
  await expect(page.getByTestId('stage-build')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('stage-build').click();
  await page.waitForFunction(() => typeof (window as unknown as { __nadiEditEdge?: unknown }).__nadiEditEdge === 'function');
  await page.waitForFunction(() => ((window as unknown as { __nadiEligEdges?: number }).__nadiEligEdges ?? 0) > 0);
  await page.evaluate(() => (window as unknown as { __nadiEditEdge: (x: string) => void }).__nadiEditEdge('E_A'));
  await expect(page.getByTestId('edge-palette')).toBeVisible();
  await page.getByTestId('palette-speed').fill('8');
  await page.getByTestId('apply-speed').click();
  await expect(page.getByTestId('draft-panel')).toBeVisible();
}

async function enterActTwo(page: Page) {
  await page.goto('/');
  await gate(page);
  await page.reload();
  await expect(page.getByTestId('stage-build')).toBeVisible({ timeout: 20_000 });
  await openRunFromList(page, RUN);
  await openStage(page, 'watch');
  await expect(page.getByTestId('act-two')).toBeVisible({ timeout: 20_000 });
}

// ------------------------------------------------------------------------------- the cost line

test('the running cost sits beside the control that stops it, and never understates', async ({ page }) => {
  await mockRun(page, { ledger: { ...LEDGER_STOPPED, ended: null } });
  await enterActTwo(page);

  const cost = page.getByTestId('act-two-cost');
  await expect(cost).toContainText('model calls: 47 of ~1,815');
  // the estimate is a PROJECTION, not a cap — retries are real calls it cannot know about
  await expect(cost).toHaveAttribute('title', /not a cap/);
  await expect(page.getByTestId('act-two-cost-basis')).toContainText('report slots');
  await expect(page.getByTestId('act-two-skip')).toBeVisible();
  if (process.env.NADI_SHOTS) await page.screenshot({ path: '../docs-assets/v27b-c10-skip-affordance.png' });
});

// ------------------------------------------------------------------------------------- the skip

test('SKIP takes the reader to Read, where the answer is', async ({ page }) => {
  await mockRun(page, { events: stoppedBody(), ledger: LEDGER_STOPPED });
  await enterActTwo(page);
  await page.getByTestId('act-two-skip').click();

  // the click navigates — not the terminal edge (see the negative below)
  await expect(page.getByTestId('document-panel')).toBeVisible({ timeout: 20_000 });
  const block = page.getByTestId('interpretation-skipped');
  await expect(block).toBeVisible();
  // the figures first: that is the whole design
  await expect(block).toContainText('The figures and the scorecard in this document are final');
  await expect(block).toContainText('stopped at your request');
  // COUNTERS ARE THE LEDGER'S. Not the streamed voice array — that is a live-transport artifact
  // (EventSource replays on reconnect, so it drifts upward while the run sits idle); what actually
  // happened is durable, and it is what a reader is owed.
  await expect(block).toContainText('Voices stopped part-way and kept what had landed');
  // the skip's reason IS the heading — repeating it below would be a stray fragment
  await expect(block).not.toContainText('Reason given');
  await expect(block).toContainText('never ran: institutions, discourse, report, chat index');
  await expect(block).toContainText('The run spent 47 model calls.');
  if (process.env.NADI_SHOTS) await page.screenshot({ path: '../docs-assets/v27b-c10-skipped-state.png' });
});

test('a DEGRADED run says the figures still stand', async ({ page }) => {
  // The provider was unreachable, or a stage exploded. The run itself is unharmed — every number
  // came from the physics — and the block leads with exactly that.
  const degradedBody = runningBody()
    + frame(6, 'stage_end', { stage: 'enrich:voices', status: 'failed', detail: 'provider unreachable' })
    + frame(7, 'run_ended', { status: 'degraded', detail: 'provider unreachable' });
  await mockRun(page, {
    events: degradedBody,
    ledger: {
      ...LEDGER_STOPPED,
      stages: LEDGER_STOPPED.stages.map((st) =>
        st.key === 'voices' ? { ...st, status: 'failed' } : st),
      ended: { status: 'degraded', at: 1_700_000_500, reason: 'provider unreachable' },
    },
  });
  await enterActTwo(page);
  await openStage(page, 'read');

  const block = page.getByTestId('interpretation-degraded');
  await expect(block).toBeVisible({ timeout: 20_000 });
  await expect(block).toContainText('Interpretation could not finish.');
  await expect(block).toContainText('The figures and the scorecard in this document are final');
  await expect(block).toContainText('Reason given: provider unreachable.');
  if (process.env.NADI_SHOTS) await page.screenshot({ path: '../docs-assets/v27b-c10-degraded-state.png' });
});

test('a run ENDING on its own does not move the reader', async ({ page }) => {
  // The mirror image, and the reason the navigation keys on the click: a run that simply finishes,
  // or one stopped from another surface, must not yank someone off what they were reading.
  await mockRun(page, { events: stoppedBody(), ledger: LEDGER_STOPPED });
  await page.goto('/');
  await gate(page);
  await page.reload();
  await expect(page.getByTestId('stage-build')).toBeVisible({ timeout: 20_000 });
  await openRunFromList(page, RUN);
  await openStage(page, 'explore');

  await page.waitForTimeout(2500); // long enough for the ended event to fold
  await expect(page.getByTestId('document-panel')).toHaveCount(0);
});

test('a refused skip says so verbatim and stays put', async ({ page }) => {
  await mockRun(page, { skipStatus: 409 });
  await enterActTwo(page);
  await page.getByTestId('act-two-skip').click();

  await expect(page.getByTestId('act-two-skip-error')).toContainText('one job at a time');
  await expect(page.getByTestId('act-two')).toBeVisible(); // no navigation on a failed stop
});

test('the stopped block offers to run the rest', async ({ page }) => {
  await mockRun(page, { events: stoppedBody(), ledger: LEDGER_STOPPED });
  await enterActTwo(page);
  await page.getByTestId('act-two-skip').click();
  await expect(page.getByTestId('interpretation-skipped')).toBeVisible({ timeout: 20_000 });

  const [req] = await Promise.all([
    page.waitForRequest((r) => r.url().includes('/resume') && r.method() === 'POST'),
    page.getByTestId('interpretation-resume').click(),
  ]);
  expect(req.url()).toContain(RUN);
});

// ------------------------------------------------------------------- the pre-spend sentence

test('the Run button says what pressing it costs, from the SERVER', async ({ page }) => {
  await mockRun(page);
  await openDraft(page);
  await expect(page.getByTestId('draft-spend-note'))
    .toContainText('Runs the physics, then interpretation (~1,815 model calls, skippable).');
  if (process.env.NADI_SHOTS) await page.screenshot({ path: '../docs-assets/v27b-c10-run-button.png' });
});

test('with no projection to be had, the sentence loses its NUMBER, not its warning', async ({ page }) => {
  await mockRun(page, { projection: null });
  await openDraft(page);
  const note = page.getByTestId('draft-spend-note');
  await expect(note).toContainText('Runs the physics, then interpretation — skippable.');
  await expect(note).not.toContainText('model calls'); // never invented client-side
});

test('with the chain disarmed the sentence promises no spend', async ({ page }) => {
  await mockRun(page, { projection: { calls: 1815, basis: 'the basis', armed: false } });
  await openDraft(page);
  await expect(page.getByTestId('draft-spend-note'))
    .toContainText('Interpretation is off on this server — nothing is spent.');
});

// ------------------------------------------------------------------------- the Watch article

test('a FINISHED run gets an article, and its near-miss count carries the surrogate footnote', async ({ page }) => {
  // Brief item 8. The count is the one number on this surface a reader could mistake for a crash
  // prediction, so the project's single sentence about that rides it — imported, never restated.
  await mockRun(page, { events: stoppedBody(), ledger: LEDGER_STOPPED });
  await page.unroute('**/api/runs/*/status');
  await page.route('**/api/runs/*/status', (r) =>
    r.fulfill({ json: { run_id: RUN, stage: 'done', status: 'done', description: 'a closure' } }));
  await page.goto('/');
  await gate(page);
  await page.reload();
  await expect(page.getByTestId('stage-build')).toBeVisible({ timeout: 20_000 });
  await openStage(page, 'watch');

  // collapsed by default — the map is Watch's point; the strip opens it
  await page.getByTestId('document-strip').click();
  const article = page.getByTestId('watch-article');
  await expect(article).toBeVisible({ timeout: 20_000 });
  await expect(article).toContainText('Every dot is one simulated traveler on their own computed route');
  await expect(article).toContainText('near-miss surrogate events');
  await expect(page.getByTestId('watch-article-safety-note'))
    .toContainText('Never crash prediction.');
  // and the act is not showing: this run is finished
  await expect(page.getByTestId('act-two')).toHaveCount(0);
});
