// V2.7b C10b — THE BRAKE, and the sentence that lets a reader consent before pressing Run.
//
// The chain is armed as of this commit, so a reader who presses Run now spends thousands of model
// calls (C11's acceptance metered ~5,150 on a 213-voice run; the projection's own figure moved with
// that measurement, which is why every number below is MOCKED — these tests pin how the client
// renders the server's projection, never what the projection computes, and that split is what let
// the model change without touching a single assertion here).
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
import { BANNED, STANCE_TALLY } from './support/sweeps';

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

test('the cost line gets its DENOMINATOR while the run is still live', async ({ page }) => {
  // `set_projection` writes the ledger's projection at CHAIN START — after the mount-time seed has
  // already read the ledger. So for the reader who watched the run from the beginning (the reader
  // the act is for) the cost line had a numerator and nothing to weigh it against: "model calls:
  // 213", never "213 of ~7,157". Found live in C11's acceptance. Run A only had a denominator
  // because it had been REOPENED after the chain started, which is the path that seeds late.
  //
  // THE FIXTURE REPRODUCES IT BY CONTENT, NOT BY TIMING. A first read with no projection and a
  // second with one IS the server's own sequence, and unlike a delayed route it cannot be won or
  // lost by a race: without the re-read there is no second read, so the denominator never arrives.
  let reads = 0;
  await mockRun(page);
  await page.route('**/api/runs/*/ledger', (r) => {
    reads += 1;
    return r.fulfill({
      json: {
        run_id: RUN,
        ledger: {
          run_id: RUN,
          stages: [
            { key: 'personas', status: 'done', llm_calls: 0, label: 'personas sampled' },
            { key: 'voices', status: 'running', llm_calls: 47, label: 'voices' },
            { key: 'institutions', status: 'pending', llm_calls: 0, label: 'institutions' },
            { key: 'discourse', status: 'pending', llm_calls: 0, label: 'discourse' },
            { key: 'report', status: 'pending', llm_calls: 0, label: 'report' },
            { key: 'index', status: 'pending', llm_calls: 0, label: 'chat index' },
          ],
          // the chain has not written it yet on the first read — exactly the live mid-flight shape
          projection: reads === 1 ? null : { calls: 7157, basis: 'the basis the server composed' },
          ended: null,
        },
      },
    });
  });
  await enterActTwo(page);

  await expect(page.getByTestId('act-two-cost')).toContainText('of ~7,157', { timeout: 20_000 });
  await expect(page.getByTestId('act-two-cost-basis')).toContainText('the basis the server composed');
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
  // and the stage that failed is NAMED with its reason. Before C11 `failed` matched none of the
  // status filters, so voices vanished from the sentence while its 47 calls still counted — a
  // reader saw a spend with nothing to attach it to.
  //
  // ONLY voices. The stream's `stage_end` is keyed on the RUN-STATE string `enrich:voices`, which
  // covers three presented stages; the ledger carries each one's own outcome (personas done,
  // institutions skipped). This assertion is the pin that a group's failure never overturns a
  // stage that already reported for itself — without it the sentence blamed the provider for a
  // personas stage that had finished, and which reading a reader got depended on whether the
  // ledger or the stream landed last.
  await expect(block).toContainText('failed: voices');
  await expect(block).not.toContainText('personas sampled — provider unreachable');
  // and the reason is said ONCE. Under a chain, one outage fails every stage it touches, so the
  // per-stage detail and the run's ending reason are the same string — repeated per stage it put a
  // raw provider exception three times into one paragraph (looked-at catch, C11's degraded run).
  // A stage keeps its own detail only where it DIFFERS, which is the case that clause is for.
  expect((await block.innerText()).match(/provider unreachable/g) ?? []).toHaveLength(1);
  if (process.env.NADI_SHOTS) await page.screenshot({ path: '../docs-assets/v27b-c10-degraded-state.png' });
});

test('a stage whose reason DIFFERS from the run’s keeps its own', async ({ page }) => {
  // The other half of the rule above: deduplicating must not swallow information. Here the stage
  // failed for one reason and the run ended for another, so both belong on screen.
  const body = runningBody()
    + frame(6, 'stage_end', { stage: 'enrich:voices', status: 'failed', detail: 'the model returned no usable text' })
    + frame(7, 'run_ended', { status: 'degraded', detail: 'provider unreachable' });
  await mockRun(page, {
    events: body,
    ledger: {
      ...LEDGER_STOPPED,
      stages: LEDGER_STOPPED.stages.map((st) =>
        st.key === 'voices' ? { ...st, status: 'failed', detail: 'the model returned no usable text' } : st),
      ended: { status: 'degraded', at: 1_700_000_500, reason: 'provider unreachable' },
    },
  });
  await enterActTwo(page);
  await openStage(page, 'read');

  const block = page.getByTestId('interpretation-degraded');
  await expect(block).toContainText('failed: voices — the model returned no usable text');
  await expect(block).toContainText('Reason given: provider unreachable.');
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
  // the article renders narrative prose and appears in no other spec — swept HERE, where it is
  // actually on screen
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(BANNED);
  expect(body).not.toMatch(STANCE_TALLY);
  // and the act is not showing: this run is finished
  await expect(page.getByTestId('act-two')).toHaveCount(0);
});

// --------------------------------------------------------------------------------------- sweeps

test('the brake, the endings and the article add no aggregate framing of their own', async ({ page }) => {
  // Every surface C10b added was unswept: the cost line and its basis, the skip control and its
  // error, the stopped and degraded blocks, the Run button's spend sentence, and the Watch
  // article — which renders narrative prose and appears in no other spec. The referendum guard is
  // about what the UI says on its own; these are the newest places it could say something.
  await mockRun(page, { events: stoppedBody(), ledger: LEDGER_STOPPED });
  await enterActTwo(page);
  const live = await page.locator('body').innerText();
  expect(live).not.toMatch(BANNED);
  expect(live).not.toMatch(STANCE_TALLY);

  await page.getByTestId('act-two-skip').click();
  await expect(page.getByTestId('interpretation-skipped')).toBeVisible({ timeout: 20_000 });
  const stopped = await page.locator('body').innerText();
  expect(stopped).not.toMatch(BANNED);
  expect(stopped).not.toMatch(STANCE_TALLY);

  // NB the Watch article is swept in its own test, not here: this fixture's /status keeps saying
  // `running`, so Act II stays mounted and the finished-run layout the article lives in is
  // unreachable. Sweeping where the surface cannot render proves nothing.
});
