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
const GHOST_EDGE = '-35303701'; // real, 744 m, inside the fixture's bbox — see the ghost test
const B3_DETAIL =
  `road_closure on ${GHOST_EDGE} took effect in the scenario leg — every lane it closed was read ` +
  'back from the simulator as barred to cars';
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
    detail: '300 cars, 82 bicycles, 129 pedestrians — synthetic demo demand',
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
  // `applied_ok` rides beat 3 exactly where `_apply` ran a readback assert - so the fixture stamps
  // it on the closure and withholds it on the drawn-road variant, like the harness does.
  b += frame(4, 'beat', {
    n: 3, key: 'applied', title: B3_TITLE, detail: B3_DETAIL, sim_t: 600,
    ...(revert ? { applied_ok: true } : {}),
  });
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
    /** V2.7d follow-up — the LEDGER, keyed BY CONTENT on whether the events body has been served
     *  (the server writes the ledger's ending immediately before it emits `run_ended`, so "the
     *  stream has been served" is the moment the durable ending exists; a read COUNT is not usable —
     *  StrictMode's double mount reads the ledger twice before the stream opens). Default: null on
     *  every read, which is what let three footer pins stay green while the live footer lied: the
     *  client re-reads the ledger on the run's terminal edge and MERGES its stage statuses in, and
     *  a null ledger has none to merge. A chain-off fixture must serve the real durable state —
     *  six `skipped` stages — or it models a premise the server does not keep. */
    ledger?: (ctx: { streamServed: boolean }) => Record<string, unknown> | null;
  } = {},
) {
  let polls = 0;
  let streamServed = false;
  // the LOADED run carries a sim agent pinned to `veh0` — the collision the blanking rule guards
  await mockDefaultArtifact(page, 'institutions-run.json');
  await page.route('**/api/junctions**', (r) => r.fulfill({ json: { junctions: [], count: 0 } }));
  await page.route('**/api/edges**', (r) => r.fulfill({ json: { edges: [], count: 0 } }));
  await page.route(`**/${NEW_RUN}-baseline.json`, (r) =>
    r.fulfill({ body: baselineArtifact(), contentType: 'application/json' }));
  // the run itself is NOT loadable yet — that is what "still computing" means on the wire
  await page.route(`**/${NEW_RUN}.json`, (r) => r.fulfill({ status: 404, body: 'not ready' }));
  // ONE SOURCE FOR "HOW IS THE WATCHED RUN DOING", read by both endpoints. They used to disagree —
  // the list said `running` while `/status` said `done` — which was invisible until V2.7b F3 taught
  // the LANDING to consult the list: it would attach a feed to a run the status reported finished,
  // the done edge fired `loadRun` immediately, and the run list then marked the row "viewing" and
  // withdrew its OPEN button before the test could click it. A fixture whose two endpoints describe
  // different worlds can only be right by luck.
  //
  // `/api/runs` reads the counter WITHOUT advancing it: several specs sequence `/status` by call
  // count, and an extra consumer that ticked it would break proofs unrelated to this one.
  const watchedState = (advance: boolean) => {
    const n = advance ? polls++ : polls;
    const over = opts.doneAfter != null && n >= opts.doneAfter;
    return {
      stage: over ? 'done' : 'scenario',
      status: over ? 'done' : 'running',
      ...(opts.status ?? {}),
    } as { stage: string; status: string };
  };
  await page.route('**/api/runs', (r) =>
    r.fulfill({
      json: {
        runs: [
          { id: NEW_RUN, description: 'a closure at the doorstep', ...watchedState(false), started_at: 2 },
          { id: DEFAULT_RUN_ID, description: 'the loaded run', status: 'done', stage: 'done', started_at: 1 },
        ],
      },
    }));
  await page.route('**/api/runs/*/status', (r) =>
    r.fulfill({
      json: {
        run_id: NEW_RUN,
        ...watchedState(true),
        description: 'a closure at the doorstep',
        changes: opts.changes ?? [{ type: 'road_closure', target_edge: GHOST_EDGE }],
      },
    }));
  await page.route('**/api/runs/*/ledger', (r) =>
    r.fulfill({ json: { run_id: NEW_RUN, ledger: opts.ledger ? opts.ledger({ streamServed }) : null } }));
  await page.route('**/api/runs/*/events', (r) => {
    if (opts.events == null) return r.fulfill({ status: 404, body: '{"detail":"no event stream"}' });
    streamServed = true;
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

// `persons` rides the seam beside `vehicles` (MapView's renderStats) and belongs in any
// "the map is genuinely empty" claim — a pedestrian left animating is the same lie as a car.
type RenderStats = { vehicles: number; persons: number; pinnedAgents: number; conflicts: number };
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
  // AND THE OUTLINE IS ACTUALLY DRAWN. The label promises a ghost; until this pin the mock used an
  // edge id no networkLookup entry matched, so the layer was empty in every run and every
  // screenshot — a caption describing something that was never on screen.
  await expect.poll(async () => (await overlaySeam(page))?.ghost, { timeout: 20_000 }).toBe(1);
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
  // the member's outline is still DRAWN here (the change exists; only the playback doesn't), so its
  // label rides with it — an unexplained dashed line is what the caption exists to prevent
  await expect(page.getByTestId('act-one-ghost-label')).toBeVisible();

  // THE SENTENCE HAS TO BE TRUE. The entity source is gated on Act I, not on "is there a preview":
  // a `preview ?? artifact` fallthrough would animate the LOADED run's traffic under this exact
  // caption — the loudest possible lie, and invisible to every assertion above.
  await expect.poll(async () => (await renderStats(page))?.vehicles, { timeout: 20_000 }).toBe(0);
  expect((await renderStats(page))!.pinnedAgents).toBe(0);
  // and the clock counts what is on the map, not what used to be
  await expect(page.getByTestId('timeline-readout')).toContainText('0 veh');
  if (process.env.NADI_SHOTS) await page.screenshot({ path: '../docs-assets/v27b-c9-network-only.png' });
});

test('before the baseline lands, the caption says THAT — not that there will never be one', async ({ page }) => {
  // Act I's first seconds: beats are arriving, the baseline leg is still simulating, so neither
  // baseline_ready nor baseline_unavailable has been written yet.
  let b = 'retry: 100\n\n';
  b += frame(0, 'run_start', { run_id: NEW_RUN, description: 'a closure', demand_profile: 'synthetic_demo' });
  b += frame(1, 'beat', { n: 1, key: 'demand', title: 'DEMAND LOADED', detail: '300 cars, 82 bicycles, 129 pedestrians — synthetic demo demand' });
  await mockActOne(page, { events: b });
  await enterActOne(page);

  const cap = page.getByTestId('act-one-caption');
  await expect(cap).toBeVisible({ timeout: 20_000 });
  await expect(cap).toContainText('MAP SHOWS: THE NETWORK ONLY');
  await expect(cap).toContainText('The baseline leg is still being simulated — playback begins here when it lands.');
  await expect.poll(async () => (await renderStats(page))?.vehicles, { timeout: 20_000 }).toBe(0);
});

test('a baseline that FAILS TO FETCH keeps the caption honest and the map empty', async ({ page }) => {
  // THE THIRD ROUTE TO AN EMPTY MAP, and until now the only one nothing covered. The other two are
  // pinned above: the profile that never has a baseline (`baseline_unavailable`) and the window
  // before either event arrives. This is the one in between — `baseline_ready` HAS arrived carrying
  // a url, the client asked for it, and the request failed. The url exists, so `experience
  // .baselineUrl` is set and the fetch effect runs; only `baselinePreview` stays null.
  //
  // It is the branch V2.7b C11's acceptance was supposed to probe live and never did, which is why
  // it is a spec now: a one-time live observation proves a moment, a spec proves it every run.
  await mockActOne(page, { events: actOneBody() });
  await page.unroute(`**/${NEW_RUN}-baseline.json`);
  await page.route(`**/${NEW_RUN}-baseline.json`, (r) => r.fulfill({ status: 404, body: 'gone' }));
  await enterActOne(page);

  const cap = page.getByTestId('act-one-caption');
  await expect(cap).toBeVisible({ timeout: 20_000 });
  await expect(cap).toContainText('MAP SHOWS: THE NETWORK ONLY');
  // the member still exists, so its outline and label still ride — only the PLAYBACK is missing
  await expect(page.getByTestId('act-one-ghost-label')).toBeVisible();
  await expect.poll(async () => (await overlaySeam(page))?.ghost, { timeout: 20_000 }).toBe(1);

  // AND THE SENTENCE HAS TO BE TRUE — the assertion the caption text cannot make for itself. With a
  // `preview ?? artifact` fallthrough (the pre-C8b shape) the LOADED run's traffic would animate
  // under this exact caption: the loudest possible lie, and green against every line above.
  await expect.poll(async () => (await renderStats(page))?.vehicles, { timeout: 20_000 }).toBe(0);
  const stats = (await renderStats(page))!;
  expect(stats.persons).toBe(0);
  expect(stats.pinnedAgents).toBe(0);
  await expect(page.getByTestId('timeline-readout')).toContainText('0 veh');
  if (process.env.NADI_SHOTS) await page.screenshot({ path: '../docs-assets/v27b-c11-network-only-blocked.png' });
});

// ------------------------------------------------- F3: the landing attaches the feed by itself

test('a plain RELOAD while a run computes reconstructs the act — no run list needed', async ({ page }) => {
  // THE HOLE THE PHASE LEFT IN ITS OWN FLAGSHIP, and its real shape is not the obvious one. A
  // computing run has NO artifact yet, so a reload cannot land on it: the landing falls through to
  // the last run actually VIEWED — an older, finished one — and shows that, while the run the reader
  // fired goes on computing with nothing on screen referring to it. The two acts detached on an
  // accidental F5, and C11's "reload mid-Act-II reconstructs" proof only ever held via the run list.
  //
  // Note this fixture is the ORDINARY Act I shape: the loaded artifact is the previous run, the
  // watched run is `NEW_RUN`, and `/<NEW_RUN>.json` still 404s. Nothing is opened by hand.
  await mockActOne(page, { events: actOneBody() });
  // the reader WAS watching this run — the client remembers that the moment the feed follows one,
  // which is the durable evidence a reload has to work from (the in-memory id dies with the page)
  await page.addInitScript((id) => localStorage.setItem('nadi:watchedRun', id), NEW_RUN);

  await page.goto('/');
  await gate(page);
  await page.reload();
  await openStage(page, 'watch');

  // the feed attached itself: the beats are the WATCHED run's, over the previous run's artifact
  await expect(page.getByTestId('act-one-ledger')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('act-one-ledger')).toContainText(B3_TITLE);
  await expect(page.getByTestId('act-one-caption')).toContainText('MAP SHOWS:');
});

test('a landing with NOTHING running attaches nothing — the cold landing stays silent', async ({ page }) => {
  // The other half, and the one protecting the ratified silent-404 pin: a done run with no events
  // file must paint ZERO degrade UI on first paint. Attaching on every landing would have opened a
  // stream for the example run on every cold visit — the overwhelmingly common case.
  await mockActOne(page, { events: null, status: { stage: 'done', status: 'done' } });
  await page.unroute('**/api/runs');
  await page.route('**/api/runs', (r) =>
    r.fulfill({ json: { runs: [{ id: DEFAULT_RUN_ID, description: 'the loaded run', status: 'done', stage: 'done', started_at: 1 }] } }));

  await page.goto('/');
  await gate(page);
  await page.reload();
  await openStage(page, 'watch');
  await expect(page.getByTestId('comment-feed')).toBeVisible({ timeout: 20_000 });

  await expect(page.getByTestId('act-one-caption')).toHaveCount(0);
  await expect(page.getByTestId('act-one-ledger')).toHaveCount(0);
  await expect(page.getByTestId('act-two')).toHaveCount(0);
});

test('the landing still leaves the BUILD rail alone — the feed id is not the rail id', async ({ page }) => {
  // Why the fix needed a SECOND id rather than just setting `activeRunId` on the landing: that one
  // also decides the Build rail. Setting it here would swap the draw card and the palettes for
  // RunCard on every landing — eight spec files depend on that rail — and would take the run list's
  // OPEN button off the row being viewed.
  await mockActOne(page, { events: actOneBody() });
  await page.addInitScript((id) => localStorage.setItem('nadi:watchedRun', id), NEW_RUN);

  await page.goto('/');
  await gate(page);
  await page.reload();
  await openStage(page, 'watch');
  await expect(page.getByTestId('act-one-ledger')).toBeVisible({ timeout: 25_000 }); // feed attached

  await openStage(page, 'build');
  await expect(page.getByTestId('draw-card')).toBeVisible({ timeout: 20_000 });      // rail untouched
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
  // Beat 3's tick is earned the same way, from the apply-side readback assert. C10a emitted
  // `applied_ok` and nothing rendered it, so a verified apply showed the same neutral dot as an
  // unverified one — found live in C11, and the negative below is what makes this pin mean something.
  await expect(page.getByTestId('held-applied')).toContainText('✓');
  await expect(page.getByTestId('held-sealed')).toContainText('the numbers below cannot change now');
  // a moment, not a gate — said on the panel itself, in every chain state (see below)
  await expect(page.getByTestId('held-note')).toContainText('This panel is a moment, not a gate.');

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
  // and the apply row withholds its tick for the same reason: nothing was read back, because
  // nothing was applied in-sim.
  await expect(page.getByTestId('held-applied')).not.toContainText('✓');
});

// ------------------------------------------------------- the footer claims only what is happening

/**
 * THE MODAL FOOTER USED TO OVERCLAIM. It said "Interpretation is already underway below"
 * unconditionally — and the chain can be disarmed (`NADI_AUTO_ENRICH=0`; it was off by default
 * until C10b armed it), in which case nothing is underway and the run card two inches behind the
 * modal shows `voices —` beside manual enrich buttons. The first clause is now derived; the second
 * never is.
 */
async function heldFooter(
  page: Page,
  tail: string,
  opts: { doneAfter?: number; ledger?: (ctx: { streamServed: boolean }) => Record<string, unknown> | null } = {},
) {
  await mockActOne(page, { events: actOneBody() + tail, doneAfter: opts.doneAfter ?? 3, ledger: opts.ledger });
  await serveFinishedRun(page);
  await enterActOne(page, 'build');
  await expect(page.getByTestId('held-moment')).toBeVisible({ timeout: 25_000 });
  return page.getByTestId('held-note');
}

test('footer, chain RUNNING: it may say interpretation is underway', async ({ page }) => {
  const note = await heldFooter(page, frame(7, 'stage_start', { stage: 'enrich:voices', label: 'sampling travelers', kind: 'llm' }));
  await expect(note).toContainText('Interpretation is already underway below');
  await expect(note).toContainText('This panel is a moment, not a gate.');
});

/** The server's chain-off tail, VERBATIM (server.py `_run_cmds` + `_run_facts_only` + the armed
 *  check; pinned as the same literal sequence in test_stage_runner.py's dark-run test). The results
 *  document ENDS a stage nothing started — a fact of the emission, not of the fold. */
const CHAIN_OFF_TAIL =
  frame(7, 'cmd_start', { i: 0, n: 1, label: 'computing the results document' }) +
  frame(8, 'cmd_end', { i: 0, n: 1, label: 'computing the results document', returncode: 0 }) +
  frame(9, 'stage_end', { stage: 'results', status: 'done', detail: '' }) +
  frame(10, 'run_ended', { status: 'complete', detail: '' });

/** The chain-off LEDGER as `run_ledger.end(..., reason="interpretation not requested")` leaves it:
 *  the acceptance run `multimodal-scenario-20260915T051601Z`'s shape, transcribed. Every never-run
 *  stage is `skipped` — the honest "never ran" list, and the status the discriminator once mistook
 *  for "started". */
const CHAIN_OFF_LEDGER = {
  run_id: NEW_RUN,
  quant: { status: 'done', started_at: 1, ended_at: 2 },
  facts_report: { status: 'done', at: 3 },
  stages: [
    { key: 'personas', label: 'personas sampled', llm: false, status: 'skipped', llm_calls: 0, detail: '' },
    { key: 'voices', label: 'voices', llm: true, status: 'skipped', llm_calls: 0, detail: '' },
    { key: 'institutions', label: 'institutions', llm: false, status: 'skipped', llm_calls: 0, detail: '' },
    { key: 'discourse', label: 'discourse', llm: true, status: 'skipped', llm_calls: 0, detail: '' },
    { key: 'report', label: 'report', llm: true, status: 'skipped', llm_calls: 0, detail: '' },
    { key: 'index', label: 'chat index', llm: true, status: 'skipped', llm_calls: 0, detail: '' },
  ],
  projection: { calls: null, basis: '' },
  ended: { status: 'complete', at: 4, reason: 'interpretation not requested' },
};

test('footer, NO chain: it says so and names where the controls are — against the REAL emission and the REAL ledger', async ({ page }) => {
  // THE PIN THAT MOCKED A PREMISE. This test's old tail was one `run_ended` line over a null
  // ledger, and it stayed green while the live footer said "already underway" on a chain-off run
  // (V2.7d's acceptance, docs-assets/v27d-acceptance-build.png). The server writes the ledger's
  // `ended` BEFORE it emits `run_ended`; the client re-reads the ledger on that edge and merges six
  // `skipped` statuses in; and `chainState` counted any non-pending status as started. None of
  // that existed in the mock. Now the tail is the server's own four lines and the ledger is the
  // durable state it leaves — null while the run is still going (the mount reads), the chain-off
  // ledger once the stream that ends it has been served (the terminal re-read). The held moment
  // opens when the physics is DONE (`!actOne`), so the status must go terminal as it does in every
  // footer pin; the panel then stays until dismissed, which is what lets the re-read be observed.
  const note = await heldFooter(page, CHAIN_OFF_TAIL, {
    ledger: ({ streamServed }) => (streamServed ? CHAIN_OFF_LEDGER : null),
  });
  await expect(note).toContainText('Interpretation hasn’t started — the enrich controls are on the run card.');
  // the terminal re-read has landed when the seam shows the ledger's six skipped stages
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const f = (window as unknown as { __nadiRunFeed?: { stages: { status: string }[] } }).__nadiRunFeed;
        return f ? f.stages.filter((s) => s.status === 'skipped').length : 0;
      }),
      { timeout: 15_000 })
    .toBe(6);
  await expect(note).toContainText('Interpretation hasn’t started');
  await expect(note).not.toContainText('already underway');
  await expect(note).toContainText('This panel is a moment, not a gate.');
  if (process.env.NADI_SHOTS) await page.getByTestId('held-moment').screenshot({ path: '../docs-assets/v27d-fu-held-footer-none.png' });
});

test('footer, the facts-only window: it claims neither, rather than guessing', async ({ page }) => {
  // no stage event and no ending yet — the real, brief window between the physics finishing and
  // the chain's first stage. Saying either thing here would be a guess.
  const note = await heldFooter(page, '');
  await expect(note).not.toContainText('already underway');
  await expect(note).not.toContainText('hasn’t started');
  await expect(note).toContainText('This panel is a moment, not a gate.');
});

// -------------------------------------------------------------------------------------- the sweep

test('the held moment adds no aggregate framing either', async ({ page }) => {
  // The sweep below enters `watch` with a still-running run, so the modal is never on screen while
  // it runs — the checklist, its lead-in and its footer were unswept by construction.
  await mockActOne(page, { events: actOneBody(), doneAfter: 3 });
  await serveFinishedRun(page);
  await enterActOne(page, 'build');
  await expect(page.getByTestId('held-moment')).toBeVisible({ timeout: 25_000 });
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(BANNED);
  expect(body).not.toMatch(STANCE_TALLY);
});

test('Act I adds no aggregate framing of its own', async ({ page }) => {
  await mockActOne(page, { events: actOneBody() });
  await enterActOne(page);
  await expect(page.getByTestId('act-one-ledger')).toBeVisible({ timeout: 20_000 });

  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(BANNED);
  expect(body).not.toMatch(STANCE_TALLY);
});
