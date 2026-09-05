// V2.7b C7 — THE FOLD: the run experience as a projection of the events file.
//
// Two properties are load-bearing and neither is obvious from reading the code:
//
//   * RECONSTRUCTION. A reload mid-run must rebuild the same screen. That is only true if the
//     experience is derived from (ledger + events) rather than accumulated in React state, so the
//     test replays a file into a fresh page and asserts the fold lands where it should.
//   * THE SILENT 404. A run that is DONE and has no events file is the NORMAL, PERMANENT state of
//     every committed run — the example has no events file and never will, and the static demo has
//     no API at all. It must paint ZERO degrade UI. The labeled degrade belongs to exactly one
//     situation: a run that is RUNNING whose stream cannot be reached.
//
// The fold's pure half is asserted directly (no browser needed for a reduce); the wiring is
// asserted through the __nadiRunFeed seam, which publishes counts and stage keys, never content.

import { expect, test, type Page } from '@playwright/test';
import { mockDefaultArtifact, DEFAULT_RUN_ID } from './support/default-artifact';
import { gate, openRunFromList } from './support/shell';
import { BANNED, STANCE_TALLY } from './support/sweeps';

const RUN_ID = DEFAULT_RUN_ID;

interface FeedSeam {
  runId: string | null;
  beats: string[];
  stages: { key: string; status: string; calls: number | null }[];
  voices: number;
  voicesTotal: number | null;
  slots: number;
  baseline: string | null;
  resultsReady: boolean;
  ended: string | null;
  llmCalls: number;
}

const seam = (page: Page) =>
  page.evaluate(() => (window as unknown as { __nadiRunFeed?: FeedSeam }).__nadiRunFeed);

const frame = (id: number, event: string, data: Record<string, unknown>) =>
  `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify({ event, ts: 1_700_000_000 + id, ...data })}\n\n`;

/** A run's whole life, as the server would have written it: Act I's beats, then the chain. */
function fullRunBody(): string {
  let b = 'retry: 100\n\n';
  b += frame(0, 'run_start', { run_id: RUN_ID, description: 'a closure', demand_profile: 'synthetic_demo' });
  b += frame(1, 'beat', { n: 1, key: 'demand', title: 'DEMAND LOADED', detail: '300 cars, 82 bicycles, 129 pedestrians — synthetic_demo demand', counts: { car: 300, bicycle: 82, pedestrian: 129 } });
  b += frame(2, 'baseline_ready', { url: `/${RUN_ID}-baseline.json`, entities: 511 });
  b += frame(3, 'beat', { n: 2, key: 'baseline', title: 'BASELINE MORNING COMPLETE', detail: 'simulated without your change — the like-for-like reference' });
  b += frame(4, 'beat', { n: 3, key: 'applied', title: 'YOUR CHANGE APPLIED AT t=600 s', detail: 'road_closure on -e1 is now active in the scenario leg — computing, not shown', sim_t: 600 });
  b += frame(5, 'beat', { n: 4, key: 'reverted', title: 'REVERTED AT t=1200 s', detail: 'the change withdrew on schedule; on every lane it touched, the permissions and speed limit after withdrawal matched the values captured immediately before it was applied', sim_t: 1200, restored_ok: true });
  b += frame(6, 'results_ready', { report_url: `/${RUN_ID}-report.json` });
  b += frame(7, 'stage_start', { stage: 'enrich:voices', label: 'sampling travelers', kind: 'llm' });
  b += frame(8, 'voices_total', { total: 3 });
  b += frame(9, 'voice', { index: 0, done: 1, total: 3, agent: { grounding: 'inferred', persona: { id: 'p0', label: 'Voice 0' }, reaction: { comment: 'One.', sentiment: 0, stance: 'neutral' } } });
  b += frame(10, 'voice', { index: 1, done: 2, total: 3, agent: { grounding: 'inferred', persona: { id: 'p1', label: 'Voice 1' }, reaction: { comment: 'Two.', sentiment: 0, stance: 'neutral' } } });
  b += frame(11, 'voice', { index: 2, done: 3, total: 3, agent: { grounding: 'inferred', persona: { id: 'p2', label: 'Voice 2' }, reaction: { comment: 'Three.', sentiment: 0, stance: 'neutral' } } });
  b += frame(12, 'stage_usage', { stage: 'voices', calls: 3 });
  b += frame(13, 'institutions', { spoke: [], silent: [{ id: 'tdsb', label: 'Toronto District School Board', reason: 'no school-adjacent measure was computed for this run' }] });
  b += frame(14, 'stage_end', { stage: 'enrich:voices', status: 'done', detail: '' });
  b += frame(15, 'run_ended', { status: 'complete', detail: '' });
  return b;
}

async function mockRun(page: Page, opts: { events?: string | null; ledger?: unknown | null; status?: Record<string, unknown> } = {}) {
  await mockDefaultArtifact(page);
  await page.route('**/api/junctions**', (r) => r.fulfill({ json: { junctions: [], count: 0 } }));
  await page.route('**/api/edges**', (r) => r.fulfill({ json: { edges: [], count: 0 } }));
  await page.route('**/api/runs', (r) =>
    r.fulfill({ json: { runs: [{ id: RUN_ID, description: 'fold fixture', status: 'done', stage: 'done', started_at: 1 }] } }));
  await page.route('**/api/runs/*/status', (r) =>
    r.fulfill({ json: { run_id: RUN_ID, stage: 'done', status: 'done', description: 'fold fixture', ...(opts.status ?? {}) } }));
  await page.route('**/api/runs/*/ledger', (r) =>
    r.fulfill({ json: { run_id: RUN_ID, ledger: opts.ledger ?? null } }));
  await page.route('**/api/runs/*/events', (r) => {
    if (opts.events == null) {
      return r.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"no event stream"}' });
    }
    return r.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'Cache-Control': 'no-cache' }, body: opts.events });
  });
}

/** Open the run so the feed is live (it runs on activeRunId), landing in Build where the run card
 *  mounts. The warm-reload is the StrictMode convention every goto('/') spec follows. */
async function openRun(page: Page) {
  await page.goto('/');
  await gate(page);
  await page.reload();
  await expect(page.getByTestId('stage-build')).toBeVisible({ timeout: 20_000 });
  await openRunFromList(page, RUN_ID, 'build');
}

// ------------------------------------------------------------------ the reconstruction property

test('the experience reconstructs from the events file — a reload lands where the run is', async ({ page }) => {
  await mockRun(page, { events: fullRunBody(), status: { stage: 'analysis', status: 'running' } });
  await openRun(page);

  // The fold replays the WHOLE file on connect (the server serves from line 0), so a page that
  // arrives late is indistinguishable from one that watched it live. That IS the reconstruction.
  await expect.poll(async () => (await seam(page))?.beats, { timeout: 20_000 })
    .toEqual(['demand', 'baseline', 'applied', 'reverted']);

  const s = (await seam(page))!;
  expect(s.runId).toBe(RUN_ID);
  expect(s.voices).toBe(3);
  expect(s.voicesTotal).toBe(3);
  expect(s.baseline).toBe('ready');
  expect(s.resultsReady).toBe(true);
  expect(s.ended).toBe('complete');
  // per-stage cost comes from the stage's OWN metered report, keyed by presented stage
  const byKey = Object.fromEntries(s.stages.map((x) => [x.key, x]));
  expect(byKey.voices.calls).toBe(3);
  expect(byKey.institutions.calls).toBe(0); // deterministic — zero, and stated as zero
  expect(s.llmCalls).toBe(3);
  // a stage the run never reached is NOT silently marked done
  expect(byKey.discourse.status).toBe('pending');
  expect(byKey.report.status).toBe('pending');
});

test('a reload mid-run rebuilds the same state — the projection is the file, not React state', async ({ page }) => {
  await mockRun(page, { events: fullRunBody(), status: { stage: 'analysis', status: 'running' } });
  await openRun(page);
  await expect.poll(async () => (await seam(page))?.voices, { timeout: 20_000 }).toBe(3);
  const before = await seam(page);

  await page.reload();
  await expect(page.getByTestId('stage-build')).toBeVisible({ timeout: 20_000 });
  await openRunFromList(page, RUN_ID, 'build');

  await expect.poll(async () => (await seam(page))?.voices, { timeout: 20_000 }).toBe(3);
  const after = await seam(page);
  expect(after).toEqual(before); // byte-for-byte the same projection
});

test('the ledger seeds the durable half when the events file is gone (pruned at 7 days)', async ({ page }) => {
  // The run ended days ago: no events survive, but the ledger still says what ran and what it cost.
  await mockRun(page, {
    events: null,
    status: { stage: 'done', status: 'done' },
    ledger: {
      run_id: RUN_ID,
      stages: [
        { key: 'personas', status: 'done', llm_calls: 0 },
        { key: 'voices', status: 'done', llm_calls: 213 },
        { key: 'institutions', status: 'done', llm_calls: 0 },
        { key: 'discourse', status: 'skipped', llm_calls: 0 },
        { key: 'report', status: 'skipped', llm_calls: 0 },
        { key: 'index', status: 'skipped', llm_calls: 0 },
      ],
      projection: { calls: 230, basis: '213 voices + 13 report slots' },
      facts_report: { status: 'done', at: 1_700_000_000 },
      ended: { status: 'skipped', at: 1_700_000_100, reason: 'stopped at your request' },
    },
  });
  await openRun(page);

  await expect.poll(async () => (await seam(page))?.ended, { timeout: 20_000 }).toBe('skipped');
  const s = (await seam(page))!;
  expect(s.llmCalls).toBe(213);
  expect(s.resultsReady).toBe(true);
  const byKey = Object.fromEntries(s.stages.map((x) => [x.key, x]));
  expect(byKey.voices.status).toBe('done');
  expect(byKey.discourse.status).toBe('skipped'); // "never run", honestly, from the ledger alone
});

// ------------------------------------------------------------------------- THE SILENT-404 PIN

test('a DONE run with no events file paints ZERO degrade UI — the example run case', async ({ page }) => {
  // This is the permanent, normal state of every committed run: the example has no events file and
  // never will, the pinned run has no run-state on a fresh box, and the static demo has no API.
  // A degrade note here would tell a cold visitor that something is broken on a page that is
  // working exactly as designed.
  await mockRun(page, { events: null, ledger: null, status: { stage: 'done', status: 'done' } });
  await openRun(page);
  await expect(page.getByTestId('run-card')).toBeVisible({ timeout: 20_000 });

  // give the feed every chance to paint something it shouldn't
  await page.waitForTimeout(2000);
  await expect(page.getByTestId('enrich-stream-degraded')).toHaveCount(0);
  await expect(page.getByTestId('run-experience-degraded')).toHaveCount(0);

  const s = (await seam(page))!;
  expect(s.beats).toEqual([]);
  expect(s.ended).toBe('by-state'); // known over from run-state, with NO invented status
  expect(s.baseline).toBeNull();    // a missing -baseline.json is silence, not an error

  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/stream unavailable/i);
  expect(body).not.toMatch(BANNED);
  expect(body).not.toMatch(STANCE_TALLY);
});

test('a RUNNING run whose stream is unreachable DOES degrade, labeled', async ({ page }) => {
  // The mirror image, and the one case the labeled degrade belongs to.
  await mockRun(page, { events: null, ledger: null, status: { stage: 'enrich:voices', status: 'running' } });
  await openRun(page);
  await expect(page.getByTestId('enrich-stream-degraded')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('enrich-stream-degraded'))
    .toHaveText('live stream unavailable — updating by poll');
});
