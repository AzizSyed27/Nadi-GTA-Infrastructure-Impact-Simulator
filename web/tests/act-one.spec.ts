// V2.7b C8b — ACT I: the physics, narrated while it happens.
//
// Act I is the state where the run being WATCHED is not the run on SCREEN: a new run's physics is
// still going, so the map plays that run's recorded baseline leg while every panel still describes
// the previously-loaded run. Almost everything that can go wrong here goes wrong SILENTLY, which is
// what these tests are for:
//
//   * THE MISATTRIBUTION. Entity ids are per-run ordinals ('0', '1', '139'), so the computing run's
//     baseline preview reuses the exact ids the loaded run's agents pin to. Swapping the map's
//     entities while keeping the loaded agents joins one run's voices onto another run's trips and
//     renders beautifully. Pinned as a COUNT, because that is the only observable.
//   * THE STRANGER'S CHANGE. The persistent change overlay is keyed to the loaded run. Left on
//     during Act I it draws someone else's closure under a caption that calls it "your member".
//   * THE UNEARNED ✓. Beat 4 has honest variants (a drawn road, an unwindowed change, a window that
//     never fired) where nothing was withdrawn and so nothing was verified. The check mark is
//     earned by `change_scheduler`'s restoration assertion or it is not shown.
//
// The beat copy is NOT authored here or in the client: it is written server-side from the mechanism
// it reports (`scenario_harness.Beats`, pinned in test_act_one_beats.py against the "checked edge by
// edge" overclaim). These tests assert it arrives on screen VERBATIM — one source, two ends.

import { expect, test, type Page } from '@playwright/test';
import { mockDefaultArtifact, DEFAULT_RUN_ID } from './support/default-artifact';
import { gate, openRunFromList, openStage } from './support/shell';
import { BANNED, STANCE_TALLY } from './support/sweeps';

/** The run being watched — deliberately NOT the loaded artifact's id. That inequality IS Act I. */
const NEW_RUN = 'multimodal-scenario-20260901T120000Z';

// The server's own sentences, as `scenario_harness.Beats` writes them. Copied here as LITERALS on
// purpose: a pin that imported the string from the client would assert a constant against itself.
const B3_TITLE = 'YOUR CHANGE APPLIED AT t=600 s';
const B3_DETAIL = 'road_closure on -36784353#20 is now active in the scenario leg — computing, not shown';
const B4_TITLE = 'REVERTED AT t=1200 s';
const B4_DETAIL =
  'the change withdrew on schedule; on every lane it touched, the permissions and speed limit ' +
  'after withdrawal matched the values captured immediately before it was applied';

const frame = (id: number, event: string, data: Record<string, unknown>) =>
  `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify({ event, ts: 1_700_000_000 + id, ...data })}\n\n`;

/** Act I as the harness writes it. `revert` false = the honest no-withdrawal variant. */
function actOneBody(opts: { revert?: boolean; results?: boolean; baseline?: boolean } = {}): string {
  const { revert = true, results = true, baseline = true } = opts;
  let b = 'retry: 100\n\n';
  b += frame(0, 'run_start', { run_id: NEW_RUN, description: 'a closure at the doorstep', demand_profile: 'synthetic_demo' });
  b += frame(1, 'beat', {
    n: 1, key: 'demand', title: 'DEMAND LOADED',
    detail: '300 cars, 82 bicycles, 129 pedestrians — synthetic_demo demand',
    counts: { car: 300, bicycle: 82, pedestrian: 129 },
  });
  b += baseline
    ? frame(2, 'baseline_ready', { url: `/${NEW_RUN}-baseline.json`, entities: 4 })
    : frame(2, 'baseline_unavailable', {
        reason:
          'baseline playback is not available for this profile — the baseline trajectories are ' +
          'freed during the run to keep memory bounded. The beats and the results are unaffected.',
      });
  b += frame(3, 'beat', { n: 2, key: 'baseline', title: 'BASELINE MORNING COMPLETE', detail: 'simulated without your change — the like-for-like reference' });
  b += frame(4, 'beat', { n: 3, key: 'applied', title: B3_TITLE, detail: B3_DETAIL, sim_t: 600 });
  b += revert
    ? frame(5, 'beat', { n: 4, key: 'reverted', title: B4_TITLE, detail: B4_DETAIL, sim_t: 1200, restored_ok: true })
    : frame(5, 'beat', {
        n: 4, key: 'reverted', title: 'NOTHING TO WITHDRAW',
        detail: 'a drawn road is part of the network for the whole run; no in-sim change was applied, so none was reverted',
      });
  if (results) b += frame(6, 'results_ready', { report_url: `/${NEW_RUN}-report.json` });
  return b;
}

/**
 * A contract-shaped baseline leg for the computing run. Its vehicle ids DELIBERATELY START AT THE
 * SAME PLACE as the loaded fixture's (`veh0`, `veh1`, …) — not as a trick, but because that is what
 * production does: both runs draw their demand from the same generator, so both number their
 * travelers from zero. `institutions-run.json` pins an agent to `veh0`, so an unblanked join would
 * silently attach that run's voice to THIS run's first car.
 */
function baselineArtifact(runId = `${NEW_RUN}-baseline`): string {
  const veh = (id: string, x: number) => ({
    id, mode: 'car',
    path: [[-79.23 + x, 43.77], [-79.22 + x, 43.775], [-79.21 + x, 43.78]],
    t0: 0, dt: 60,
  });
  return JSON.stringify({
    schema_version: '0.10.0',
    meta: {
      run_id: runId, generated_at: '2026-09-01T12:00:00Z',
      network: 'corridor.net.xml', sim_start: 0, sim_end: 1800,
      bbox: [-79.3, 43.72, -79.1, 43.85], scenario: null,
      demand_profile: 'synthetic_demo', assignment: 'day_one', seeds: [42],
    },
    vehicles: [veh('veh0', 0), veh('veh1', 0.002), veh('veh2', 0.004), veh('veh3', 0.006)],
    persons: [],
    agents: [],
    scorecard: null,
  });
}

async function mockActOne(
  page: Page,
  opts: {
    events?: string | null;
    status?: Record<string, unknown>;
    changes?: unknown[];
    /** Poll count after which the run reports `done`. Act I ENDING is a TRANSITION, and it has to
     *  be mocked as one: a status that reads terminal on the first poll is never watchable, so the
     *  stream never opens, no beat ever arrives, and the held moment has nothing to hold. */
    doneAfter?: number;
  } = {},
) {
  let polls = 0;
  // the LOADED run carries a sim agent pinned to `veh0` — the collision the blanking rule guards
  await mockDefaultArtifact(page, 'institutions-run.json');
  await page.route('**/api/junctions**', (r) => r.fulfill({ json: { junctions: [], count: 0 } }));
  await page.route('**/api/edges**', (r) => r.fulfill({ json: { edges: [], count: 0 } }));
  await page.route(`**/${NEW_RUN}-baseline.json`, (r) =>
    r.fulfill({ body: baselineArtifact(), contentType: 'application/json' }));
  // the run itself is NOT loadable yet — that is what "still computing" means on the wire
  await page.route(`**/${NEW_RUN}.json`, (r) => r.fulfill({ status: 404, body: 'not ready' }));
  await page.route('**/api/runs', (r) =>
    r.fulfill({
      json: {
        runs: [
          { id: NEW_RUN, description: 'a closure at the doorstep', status: 'running', stage: 'scenario', started_at: 2 },
          { id: DEFAULT_RUN_ID, description: 'the loaded run', status: 'done', stage: 'done', started_at: 1 },
        ],
      },
    }));
  await page.route('**/api/runs/*/status', (r) => {
    const over = opts.doneAfter != null && polls++ >= opts.doneAfter;
    return r.fulfill({
      json: {
        run_id: NEW_RUN,
        stage: over ? 'done' : 'scenario',
        status: over ? 'done' : 'running',
        description: 'a closure at the doorstep',
        changes: opts.changes ?? [{ type: 'road_closure', target_edge: 'edge-a' }],
        ...(opts.status ?? {}),
      },
    });
  });
  await page.route('**/api/runs/*/ledger', (r) => r.fulfill({ json: { run_id: NEW_RUN, ledger: null } }));
  await page.route('**/api/runs/*/events', (r) => {
    if (opts.events == null) return r.fulfill({ status: 404, body: '{"detail":"no event stream"}' });
    return r.fulfill({ status: 200, contentType: 'text/event-stream', body: opts.events });
  });
}

/**
 * Make the watched run LOADABLE — Act I's own ending. The poll's `done` edge calls loadRun, the
 * artifact swaps to this run's own, `actOne` goes false, and the held moment opens. The 500 ms delay
 * is the StrictMode tiny-fixture convention every spec here follows.
 */
async function serveFinishedRun(page: Page) {
  await page.unroute(`**/${NEW_RUN}.json`);
  await page.route(`**/${NEW_RUN}.json`, async (r) => {
    await new Promise((res) => setTimeout(res, 500));
    await r.fulfill({ body: baselineArtifact(NEW_RUN), contentType: 'application/json' });
  });
}

/** Land, then open the COMPUTING run — which the run list opens in its current state. */
async function enterActOne(page: Page, stage: 'watch' | 'read' | 'build' = 'watch') {
  await page.goto('/');
  await gate(page);
  await page.reload();
  await expect(page.getByTestId('stage-build')).toBeVisible({ timeout: 20_000 });
  await openRunFromList(page, NEW_RUN);
  await openStage(page, stage);
}

type RenderStats = { vehicles: number; pinnedAgents: number; conflicts: number };
const renderStats = (page: Page) =>
  page.evaluate(() => (window as unknown as { __nadiRenderStats?: RenderStats }).__nadiRenderStats);
const overlaySeam = (page: Page) =>
  page.evaluate(() => (window as unknown as { __nadiChangeOverlay?: { count: number; ghost: number } }).__nadiChangeOverlay);

// --------------------------------------------------------------------------- the beats and copy

test('the four beats render with the SERVER’s sentences, verbatim', async ({ page }) => {
  await mockActOne(page, { events: actOneBody() });
  await enterActOne(page);

  const ledger = page.getByTestId('act-one-ledger');
  await expect(ledger).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('act-one-beat')).toHaveCount(4);

  await expect(ledger).toContainText('DEMAND LOADED');
  await expect(ledger).toContainText('300 cars, 82 bicycles, 129 pedestrians');
  await expect(ledger).toContainText(B3_TITLE);
  await expect(ledger).toContainText(B3_DETAIL);
  await expect(ledger).toContainText(B4_TITLE);
  await expect(ledger).toContainText(B4_DETAIL);

  // THE NEGATIVE PIN the design import earned: the mockup's beat 4 claimed the restored network was
  // "checked edge by edge" against baseline. No such comparison exists — assert_restored checks a
  // per-lane triple on the lanes the change touched. The overclaim must never reappear at any layer.
  await expect(ledger).not.toContainText(/edge by edge/i);
  await expect(page.locator('body')).not.toContainText(/identical to baseline/i);
});

test('the map caption says which leg is playing, and labels the ghost as not-in-force', async ({ page }) => {
  await mockActOne(page, { events: actOneBody() });
  await enterActOne(page);

  const cap = page.getByTestId('act-one-caption');
  await expect(cap).toBeVisible({ timeout: 20_000 });
  await expect(cap).toContainText('MAP SHOWS: BASELINE LEG (RECORDED)');
  await expect(cap).toContainText(
    'The scenario leg is computing about a half-step behind and is never rendered live. Your ' +
    'change appears here only as the ghosted outline — it does not affect what is playing.',
  );
  await expect(page.getByTestId('act-one-ghost-label'))
    .toHaveText('YOUR MEMBER — APPLIES TO THE SCENARIO LEG, NOT THIS PLAYBACK');
  await expect(cap).toContainText('sim-time t='); // synthetic demand has no clock anchor to invent
  // env-gated capture for the looked-at review (`NADI_SHOTS=1 npx playwright test act-one --headed`).
  // Seams cannot see pixels: three real leaks in this commit were found only by looking at these.
  if (process.env.NADI_SHOTS) await page.screenshot({ path: '../docs-assets/v27b-c8b-act-one.png' });
});

test('a profile with no baseline playback says so — AND the map is genuinely empty', async ({ page }) => {
  await mockActOne(page, { events: actOneBody({ baseline: false }) });
  await enterActOne(page);

  const cap = page.getByTestId('act-one-caption');
  await expect(cap).toBeVisible({ timeout: 20_000 });
  await expect(cap).toContainText('MAP SHOWS: THE NETWORK ONLY');
  await expect(cap).toContainText('freed during the run to keep memory bounded');
  await expect(cap).toContainText('The beats and the results are unaffected.');
  await expect(page.getByTestId('act-one-ghost-label')).toHaveCount(0); // nothing is playing to ghost over

  // THE SENTENCE HAS TO BE TRUE. The entity source is gated on Act I, not on "is there a preview":
  // a `preview ?? artifact` fallthrough would animate the LOADED run's traffic under this exact
  // caption — the loudest possible lie, and invisible to every assertion above.
  await expect.poll(async () => (await renderStats(page))?.vehicles, { timeout: 20_000 }).toBe(0);
  expect((await renderStats(page))!.pinnedAgents).toBe(0);
  // and the clock counts what is on the map, not what used to be
  await expect(page.getByTestId('timeline-readout')).toContainText('0 veh');
});

test('before the baseline lands, the caption says THAT — not that there will never be one', async ({ page }) => {
  // Act I's first seconds: beats are arriving, the baseline leg is still simulating, so neither
  // baseline_ready nor baseline_unavailable has been written yet.
  let b = 'retry: 100\n\n';
  b += frame(0, 'run_start', { run_id: NEW_RUN, description: 'a closure', demand_profile: 'synthetic_demo' });
  b += frame(1, 'beat', { n: 1, key: 'demand', title: 'DEMAND LOADED', detail: '300 cars, 82 bicycles, 129 pedestrians — synthetic_demo demand' });
  await mockActOne(page, { events: b });
  await enterActOne(page);

  const cap = page.getByTestId('act-one-caption');
  await expect(cap).toBeVisible({ timeout: 20_000 });
  await expect(cap).toContainText('MAP SHOWS: THE NETWORK ONLY');
  await expect(cap).toContainText('The baseline leg is still being simulated — playback begins here when it lands.');
  await expect.poll(async () => (await renderStats(page))?.vehicles, { timeout: 20_000 }).toBe(0);
});

test('opening a FINISHED run never announces an act — no run is being simulated', async ({ page }) => {
  // Opening a finished run also sets activeRunId a second or two before its artifact lands, so the
  // ids diverge exactly as they do during Act I. Only the run's own liveness tells the two apart,
  // and without that clause the caption would announce a baseline leg playing for a run that
  // finished days ago. The artifact route here is deliberately slow, holding the window open.
  await mockActOne(page, { events: null, status: { stage: 'done', status: 'done' } });
  await page.unroute(`**/${NEW_RUN}.json`);
  await page.route(`**/${NEW_RUN}.json`, async (r) => {
    await new Promise((res) => setTimeout(res, 3000)); // a real 20-90 MB artifact takes about this
    await r.fulfill({ body: baselineArtifact(NEW_RUN), contentType: 'application/json' });
  });
  await page.goto('/');
  await gate(page);
  await page.reload();
  await expect(page.getByTestId('stage-build')).toBeVisible({ timeout: 20_000 });
  await openRunFromList(page, NEW_RUN, 'watch');

  // mid-fetch: no act, no beat ledger, no caption claiming playback
  await expect(page.getByTestId('act-one-caption')).toHaveCount(0);
  await expect(page.getByTestId('act-one-ledger')).toHaveCount(0);
  await expect(page.getByTestId('held-moment')).toHaveCount(0);
});

// ------------------------------------------------------------- the two silent-failure guarantees

test('THE MISATTRIBUTION GUARD: the baseline plays and NO agent is joined to it', async ({ page }) => {
  await mockActOne(page, { events: actOneBody() });
  await page.goto('/');
  await gate(page);
  await page.reload();
  await expect(page.getByTestId('stage-build')).toBeVisible({ timeout: 20_000 });

  // CONTROL FIRST, or this test cannot fail: with the loaded run on screen the join is live and
  // pins its one sim agent to `veh0`. That reading is what makes the 0 below mean something.
  await expect.poll(async () => (await renderStats(page))?.pinnedAgents, { timeout: 20_000 }).toBe(1);
  expect((await renderStats(page))!.vehicles).toBe(2);

  await openRunFromList(page, NEW_RUN);
  await openStage(page, 'watch');
  await expect(page.getByTestId('act-one-ledger')).toBeVisible({ timeout: 20_000 });

  // the map's entities are now the BASELINE's four — and the loaded run's agent, whose vehicle_id
  // matches one of them exactly, is NOT pinned to it.
  await expect.poll(async () => (await renderStats(page))?.vehicles, { timeout: 20_000 }).toBe(4);
  expect((await renderStats(page))!.pinnedAgents).toBe(0);
});

test('THE STRANGER’S CHANGE: every surface describing the LOADED run is gone during Act I', async ({ page }) => {
  await mockActOne(page, { events: actOneBody() });
  await page.goto('/');
  await gate(page);
  await page.reload();
  await expect(page.getByTestId('stage-build')).toBeVisible({ timeout: 20_000 });
  await openStage(page, 'watch');

  // CONTROL: with the loaded run on screen these surfaces are present and correct.
  await expect(page.getByTestId('change-legend')).toBeVisible({ timeout: 20_000 });
  const legendBefore = await page.getByTestId('change-legend').innerText();
  expect(legendBefore.length).toBeGreaterThan(0);
  await expect.poll(async () => (await overlaySeam(page))?.count, { timeout: 20_000 }).toBeGreaterThan(0);

  await openRunFromList(page, NEW_RUN);
  await openStage(page, 'watch');
  await expect(page.getByTestId('act-one-caption')).toBeVisible({ timeout: 20_000 });

  // The overlay, the legend and the scenario header all describe a run that is NOT being simulated.
  // Each was found leaking by a looked-at screenshot, not by a seam — the caption sat two inches
  // from a card naming somebody else's closure.
  await expect.poll(async () => (await overlaySeam(page))?.count, { timeout: 20_000 }).toBe(0);
  await expect(page.getByTestId('change-legend')).toHaveCount(0);
  await expect(page.getByTestId('scenario-header')).toHaveCount(0);
  await expect(page.getByTestId('render-sample-note')).toHaveCount(0);
  // and the loaded run's surrogate near-misses are off the map too
  expect((await renderStats(page))!.conflicts).toBe(0);
});

// --------------------------------------------------------------------- what Watch and Read show

test('Watch hides the panels that describe a DIFFERENT run', async ({ page }) => {
  await mockActOne(page, { events: actOneBody() });
  await enterActOne(page);
  await expect(page.getByTestId('act-one-ledger')).toBeVisible({ timeout: 20_000 });

  // the feed, the scorecard and the agent rail all render the LOADED run — a different run from the
  // one being watched. Hidden, not emptied: an empty scorecard under this run's name would read as
  // "this run measured nothing", which is a claim, and a false one.
  await expect(page.getByTestId('comment-feed')).toHaveCount(0);
  await expect(page.getByTestId('scorecard-panel')).toHaveCount(0);
  // the map and its clock stay — they are the point of the act
  await expect(page.getByTestId('playback-bar-toggle')).toBeVisible();
});

test('Read refuses to stand another run’s document in for the one computing', async ({ page }) => {
  await mockActOne(page, { events: actOneBody() });
  await enterActOne(page, 'read');

  const notYet = page.getByTestId('read-not-computed');
  await expect(notYet).toBeVisible({ timeout: 20_000 });
  await expect(notYet).toContainText('This run’s physics is still running');
  await expect(notYet).toContainText('a different run, so its findings are not shown here in its place');
  if (process.env.NADI_SHOTS) await page.screenshot({ path: '../docs-assets/v27b-c8b-read-not-computed.png' });
  // the panel — and the header tag — name the run being WATCHED, not the one still loaded. Two run
  // ids on one screen is the confusion this whole state exists to avoid.
  await expect(page.getByTestId('document-panel')).toContainText('20260901T120000Z');
  await expect(page.getByTestId('shell-run-tag')).toContainText('20260901T120000Z');
  await expect(page.getByTestId('report-caveats')).toHaveCount(0);
});

// ------------------------------------------------------------------------------- results + held

test('the results band appears when the FACTS land, and says no AI was involved', async ({ page }) => {
  await mockActOne(page, { events: actOneBody() });
  await enterActOne(page);

  const band = page.getByTestId('results-band');
  await expect(band).toBeVisible({ timeout: 20_000 });
  await expect(band).toContainText('RESULTS — COMPLETE SINCE');
  await expect(band).toContainText('computed by the simulator in Act I, no AI — read now');
});

test('no results band before results_ready — the claim is never made early', async ({ page }) => {
  await mockActOne(page, { events: actOneBody({ results: false }) });
  await enterActOne(page);
  await expect(page.getByTestId('act-one-ledger')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('results-band')).toHaveCount(0);
});

test('the held moment proves the cleanup — and the ✓ is EARNED', async ({ page }) => {
  // Act I is over: the run's own artifact is loadable, so the poll's done edge swaps it in.
  await mockActOne(page, { events: actOneBody(), doneAfter: 3 });
  await serveFinishedRun(page);
  // Build, not Watch: the held moment is deliberately not stage-gated, and staying out of Watch
  // keeps this test about the moment rather than about the finished run's panels.
  await enterActOne(page, 'build');

  const held = page.getByTestId('held-moment');
  await expect(held).toBeVisible({ timeout: 25_000 });
  await expect(held).toContainText(B4_TITLE);
  await expect(held).toContainText('The tool proved the cleanup rather than asserting it:');
  await expect(page.getByTestId('held-reverted')).toContainText('✓');
  await expect(page.getByTestId('held-reverted')).toContainText(B4_DETAIL);
  await expect(page.getByTestId('held-sealed')).toContainText('the numbers below cannot change now');
  // a moment, not a gate — said on the panel itself
  await expect(page.getByTestId('held-note')).toContainText('this panel is a moment, not a gate');

  if (process.env.NADI_SHOTS) await page.screenshot({ path: '../docs-assets/v27b-c8b-held-moment.png' });
  await page.getByTestId('held-dismiss').click();
  await expect(held).toHaveCount(0);
});

test('the honest variant withholds the ✓ rather than decorating a sentence that proves nothing', async ({ page }) => {
  await mockActOne(page, { events: actOneBody({ revert: false }), doneAfter: 3 });
  await serveFinishedRun(page);
  // Build, not Watch: the held moment is deliberately not stage-gated, and staying out of Watch
  // keeps this test about the moment rather than about the finished run's panels.
  await enterActOne(page, 'build');

  const held = page.getByTestId('held-moment');
  await expect(held).toBeVisible({ timeout: 25_000 });
  await expect(held).toContainText('NOTHING TO WITHDRAW');
  await expect(held).toContainText('What this run did with your change:');
  await expect(held).not.toContainText('The tool proved the cleanup');
  await expect(page.getByTestId('held-reverted')).not.toContainText('✓');
  await expect(page.getByTestId('held-reverted')).toContainText('no in-sim change was applied, so none was reverted');
});

// -------------------------------------------------------------------------------------- the sweep

test('Act I adds no aggregate framing of its own', async ({ page }) => {
  await mockActOne(page, { events: actOneBody() });
  await enterActOne(page);
  await expect(page.getByTestId('act-one-ledger')).toBeVisible({ timeout: 20_000 });

  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(BANNED);
  expect(body).not.toMatch(STANCE_TALLY);
});
