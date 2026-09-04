import { test, expect, type Page } from '@playwright/test';
import { openRunFromList } from './support/shell';
import { mockDefaultArtifactBody } from './support/default-artifact';
import * as fs from 'node:fs';
import * as path from 'node:path';

// V2.3a — the SSE-streamed enrich. Backend fully MOCKED: the stream route serves a buffered
// text/event-stream body (Playwright can't chunk a fulfill — EventSource still fires the frames in
// order, which is exactly the incremental-processing path under test), and the status route is a
// stateful machine that HOLDS `enrich:voices` for several polls after the stream completes — so the
// "voices render while the job is still running" assertion is a genuine proof of stream-driven
// rendering, not of the done-edge artifact reload.
//
// Fixture: school-zone-run.json (a REAL producer artifact with 0 agents + real canonical edge ids —
// network.json is served REAL and the sim voice pins to the fixture's real veh0). Artifact routes
// carry the ~500 ms floor delay + warmOpen reload (the compare.spec StrictMode/maplibre convention).

const RUN_ID = 'school-zone-fixture'; // the fixture's meta.run_id — MapView's run-id guard joins on it
const FIXTURE = path.join(__dirname, 'fixtures', 'school-zone-run.json');
const DEGRADE_COPY = 'live stream unavailable — updating by poll';
const BANNED = /\b(majority|minority|referendum|consensus|unanimous|plurality)\b/i;
const STANCE_TALLY = /\d+\s*%[^.]{0,24}(support|oppos|favou?r|against)|\bfinal (distribution|tally|result|vote)\b|\d+\s+for\s*\/\s*\d+\s+against/i;

// The five streamed voices: 1 sim (pinned to the fixture's real veh0) + 3 inferred community voices
// + 1 mandate-grounded institutional voice (V2.3c — streams through the SAME plumbing unchanged;
// mandate agents force the enriched artifact to 0.9.0). No client-side schema validation runs (V2.5c fact).
const VOICES = [
  {
    persona: { id: 'time_pressed', label: 'Devi, commuter' },
    reaction: { comment: 'My drive through the zone took a couple of minutes longer this morning.', sentiment: -0.5, stance: 'opposed' },
    grounding: 'sim',
    vehicle_id: 'veh0',
    outcome: { baseline_duration: 240.0, scenario_duration: 360.0, delta_seconds: 120.0, baseline_timeloss: 20.0, scenario_timeloss: 100.0 },
    trigger_t: 300.0,
  },
  {
    persona: { id: 'local_resident', label: 'Rana, resident' },
    reaction: { comment: 'Slower cars past my street sounds like a calmer morning to me.', sentiment: 0.6, stance: 'supportive' },
    grounding: 'inferred',
  },
  {
    persona: { id: 'shop_owner', label: 'Nadia, shop owner' },
    reaction: { comment: 'I mostly wonder whether deliveries will take longer during the window.', sentiment: -0.1, stance: 'neutral' },
    grounding: 'inferred',
  },
  {
    persona: { id: 'taxpayer', label: 'Omar, taxpayer' },
    reaction: { comment: 'I did not ask for this change and I want to see what it actually does first.', sentiment: -0.3, stance: 'neutral' },
    grounding: 'inferred',
  },
  {
    grounding: 'mandate',
    persona: { id: 'transport_ops', label: 'City of Toronto Transportation Services' },
    mandate: {
      institution: 'City of Toronto Transportation Services',
      mission: 'to provide a safe, efficient, and effective transportation system that serves our residents, businesses, and visitors in an environmentally, socially and economically sustainable manner.',
      source: 'https://www.toronto.ca/city-government/accountability-operations-customer-service/city-administration/staff-directory-divisions-and-customer-service/transportation-services/',
      retrieved: '2026-08-01',
    },
    citations: [{ key: 'reroute', text: '12 of 300 matched car trips diverted onto other streets during the run.', notes: [] }],
    reaction: {
      comment: "City of Toronto Transportation Services' published mandate (toronto.ca, retrieved 2026-08-01) prioritizes a safe, efficient, and effective transportation system. Read against that mandate, this run computed: 12 of 300 matched car trips diverted onto other streets during the run.",
      sentiment: 0.0,
      stance: 'neutral',
    },
  },
];
const TOTAL = VOICES.length; // 5

const frame = (id: number, event: string, data: Record<string, unknown>) =>
  `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify({ event, ts: 0, ...data })}\n\n`;

/** A complete stream: run_start(0) … all voices … stream_end. `retry: 100` speeds any reconnect. */
function fullStreamBody(): string {
  let b = 'retry: 100\n\n';
  b += frame(0, 'run_start', { run_id: RUN_ID, description: 'school zone fixture' });
  b += frame(1, 'stage_start', { stage: 'enrich:voices', label: 'enrich:voices', kind: 'llm', stages: ['sampling travelers', 'generating voices'] });
  b += frame(2, 'cmd_start', { i: 0, n: 2, label: 'sampling travelers' });
  b += frame(3, 'voices_total', { total: TOTAL });
  VOICES.forEach((agent, i) => {
    b += frame(4 + i, 'voice', { index: i, done: i + 1, total: TOTAL, agent });
  });
  b += frame(4 + TOTAL, 'stage_end', { stage: 'enrich:voices', status: 'done', detail: '' });
  b += frame(5 + TOTAL, 'run_ended', { status: 'complete', detail: '' });
  // the CONTROL frame the client closes on — never a file line (V2.7b)
  b += frame(6 + TOTAL, 'stream_end', { status: 'done', detail: '' });
  return b;
}

/** A stream that DIES after 2 voices — no stream_end control frame, so EventSource auto-reconnects. */
function partialStreamBody(): string {
  let b = 'retry: 100\n\n';
  b += frame(0, 'run_start', { run_id: RUN_ID, description: 'school zone fixture' });
  b += frame(1, 'stage_start', { stage: 'enrich:voices', label: 'enrich:voices', kind: 'llm', stages: ['sampling travelers', 'generating voices'] });
  b += frame(2, 'cmd_start', { i: 0, n: 2, label: 'sampling travelers' });
  b += frame(3, 'voices_total', { total: TOTAL });
  b += frame(4, 'voice', { index: 0, done: 1, total: TOTAL, agent: VOICES[0] });
  b += frame(5, 'voice', { index: 1, done: 2, total: TOTAL, agent: VOICES[1] });
  return b;
}

/**
 * Mock the backend around the real fixture. `streamBody(i)` returns the i-th stream response body,
 * or null → that request 404s (the degrade path). The status machine: `done` until the enrich POST,
 * then `enrich:voices` for `holdPolls` polls (with the poll-derived enrich_progress once streaming
 * is expected dead), then `done` again — at which point the artifact route serves the ENRICHED body.
 */
async function mockBackend(
  page: Page,
  opts: { streamBody: (i: number) => string | null; holdPolls: number | { polls: number };
          polledProgress?: { done: number; total: number } },
) {
  const base = fs.readFileSync(FIXTURE, 'utf-8');
  const enrichedArt = JSON.parse(base);
  enrichedArt.agents = VOICES;
  enrichedArt.schema_version = '0.9.0'; // a mandate agent makes it a 0.9.0 artifact
  const enriched = JSON.stringify(enrichedArt);

  let enrichPosted = false;
  let enrichPolls = 0; // reset on every enrich POST — the machine supports a re-enrich cycle
  let streamCalls = 0;
  let enrichDone = false;

  await page.route('**/api/junctions**', (route) => route.fulfill({ json: { junctions: [], count: 0 } }));
  await page.route('**/api/edges**', (route) => route.fulfill({ json: { edges: [], count: 0 } }));
  await page.route('**/api/runs', (route) =>
    route.fulfill({ json: { runs: [{ id: RUN_ID, description: 'school zone fixture', status: 'done', stage: 'done', started_at: 1 }] } }),
  );
  await page.route('**/api/runs/*/enrich', (route) => {
    enrichPosted = true;
    enrichPolls = 0; // each POST starts a fresh cycle (a RE-enrich re-runs the machine)
    enrichDone = false;
    return route.fulfill({ json: { run_id: RUN_ID, stage: 'voices' } });
  });
  await page.route('**/api/runs/*/events', (route) => {
    const body = opts.streamBody(streamCalls++);
    if (body == null) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"no stream"}' });
    return route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'Cache-Control': 'no-cache' }, body });
  });
  await page.route('**/api/runs/*/status', (route) => {
    if (enrichPosted && !enrichDone) {
      enrichPolls++;
      // A live box lets a test HOLD the enriching status until it has finished asserting the live
      // state, then release it — instead of betting that N polls outlast those assertions. The
      // bet is not safe: rendering five streamed voices blocks the main thread long enough to
      // stretch one poll gap to ~6 s, so the same count covers wildly different wall time and the
      // test passes or fails on machine speed rather than on behavior.
      const limit = typeof opts.holdPolls === 'number' ? opts.holdPolls : opts.holdPolls.polls;
      if (enrichPolls <= limit) {
        return route.fulfill({
          json: {
            run_id: RUN_ID, stage: 'enrich:voices', status: 'running', description: 'school zone fixture',
            ...(opts.polledProgress ? { enrich_progress: opts.polledProgress } : {}),
          },
        });
      }
      enrichDone = true;
    }
    return route.fulfill({ json: { run_id: RUN_ID, stage: 'done', status: 'done', description: 'school zone fixture' } });
  });
  // The artifact: the real (voiceless) fixture until the enrich completes, the enriched body after.
  // ~500 ms floor delay — a tiny fixture resolving inside StrictMode's double-mount window crashes
  // maplibre teardown (compare.spec.ts convention).
  await page.route(`**/${RUN_ID}.json`, async (route) => {
    await new Promise((res) => setTimeout(res, 500));
    await route.fulfill({ body: enrichDone ? enriched : base, contentType: 'application/json' });
  });
  // '/' resolves the latest.json POINTER (V2.5c: never a payload) — serve the tiny fixture as
  // the default run via the pointer pair (the helper carries the floor delay).
  await mockDefaultArtifactBody(page, base);
}

/** Seek to sim end by scrubbing the Timeline slider — the app's own pause-and-seek path (the
 * overlay-playback.spec convention). */
async function scrubToEnd(page: Page) {
  await page.locator('input[type=range]').first().fill('1800');
}

/** Open '/', warm-reload (StrictMode convention), enter edit mode, select the fixture run. */
async function openRun(page: Page) {
  await page.goto('/');
  await page.getByTestId('stage-build').waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
  await page.reload();
  await expect(page.getByTestId('stage-build')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('stage-build').click();
  await expect(page.getByTestId('edit-panel')).toBeVisible();
  // Arm the artifact wait BEFORE the click (edit.spec's junctions convention). V2.7b C3 removed a
  // REDUNDANT second fetch: RunCard used to remount per run (key={activeRunId}), so its done-edge
  // detector reset and re-fired loadRun for a run that was ALREADY done. The feed does not remount,
  // so the artifact is fetched once - which is correct for a multi-MB body, and leaves nothing for a
  // late-armed wait to catch.
  const artifactFetched = page.waitForResponse((r) => r.url().includes(`${RUN_ID}.json`));
  await openRunFromList(page, RUN_ID, 'build');
  await artifactFetched;
  await expect(page.getByTestId('run-card')).toBeVisible();
  // the fixture has NO voices — the honest empty state is the genuine starting point
  await expect(page.getByTestId('no-voices')).toBeVisible({ timeout: 15_000 });
}

test('streamed voices render incrementally while the enrich job is still running', async ({ page }) => {
  // The status is HELD at enrich:voices until this test has finished asserting the live state, then
  // released explicitly. A fixed poll count was a bet that N polls outlast the assertions, and the
  // probe showed why that bet is unsafe: rendering the five streamed voices blocks the main thread,
  // stretching one poll gap from 1.5 s to ~6.3 s, so the same count covers very different wall time.
  // The proof is untouched — voices must still be visible WHILE the status reads enriching.
  const hold = { polls: 10_000 };
  await mockBackend(page, { streamBody: () => fullStreamBody(), holdPolls: hold });
  await openRun(page);

  await page.getByTestId('enrich-voices').click();

  // The whole point: voices are VISIBLE while status still reads enrich:voices — before any
  // done-edge artifact reload could have delivered them.
  await expect(page.getByTestId('voice-stream-panel')).toBeVisible({ timeout: 15_000 });
  // Explicit 15 s, the same budget (and for the same reason) as the re-enrich test below: under
  // full-suite dev-server load the FIRST status poll after the enrich POST can exceed the default
  // 5 s. The default was survivable until V2.7b C3 moved the poll into a hook whose state re-renders
  // MapView, and rendering the five streamed voices blocks the main thread for ~6 s — measured. The
  // PROPERTY is unchanged: voices must be visible WHILE the status still reads enriching.
  await expect(page.getByTestId('enrich-running')).toBeVisible({ timeout: 15_000 }); // still enriching
  await expect(page.getByTestId('enrich-running')).toContainText('5/5'); // live stream counts
  await expect(page.getByTestId('voice-stream-row')).toHaveCount(5);
  await expect(page.getByTestId('voice-stream-panel')).toContainText('community perspective'); // inferred labeled
  await expect(page.getByTestId('voice-stream-panel')).toContainText('institutional (mandate lens)'); // V2.3c ticker tag
  await expect(page.getByTestId('voice-stream-panel')).toContainText('not a poll');
  // hasVoices flipped live from the streamed append (the artifact copy, not the ticker)
  await expect(page.getByTestId('run-contains')).toContainText('voices ✓');

  // …now let the job finish. Status flips done → the authoritative reload swaps in the enriched
  // artifact; the ticker yields. Releasing here (rather than counting polls) is what makes the
  // BEFORE and AFTER halves of this test independent of how fast the machine renders.
  hold.polls = 0;
  await expect(page.getByTestId('enrich-running')).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId('voice-stream-panel')).toBeHidden();
  await expect(page.getByTestId('run-contains')).toContainText('voices ✓');

  // Playback shows exactly the artifact voices (1 sim + 3 community; the mandate voice renders in
  // its own pinned institutional sub-block, never a community row) — no stream duplicates.
  await page.getByTestId('stage-watch').click();
  await scrubToEnd(page); // all voices fired by sim end
  await expect(page.getByTestId('comment-row')).toHaveCount(1);
  await expect(page.getByTestId('community-row')).toHaveCount(3);
  await expect(page.getByTestId('institution-row')).toHaveCount(1);

  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(BANNED);
  expect(body).not.toMatch(STANCE_TALLY);
});

test('a re-enrich of the same run streams a fresh voice set (dedup resets, no pile-up)', async ({ page }) => {
  await mockBackend(page, { streamBody: () => fullStreamBody(), holdPolls: 4 });
  await openRun(page);

  // First enrich runs to done. GATE ORDER MATTERS: wait for the enriching state to RENDER before
  // waiting for it to end — a bare toBeHidden right after the click passes instantly in the window
  // before the first status poll commits "Enriching…", and the panel assertion then runs mid-enrich.
  await page.getByTestId('enrich-voices').click();
  // explicit 15 s on both enrich-running gates: under full-suite dev-server load the FIRST status
  // poll can exceed the default 5 s (observed twice in V2.3d suite runs; 5x green when quiet) —
  // the gate-order property is unchanged, only the budget
  await expect(page.getByTestId('enrich-running')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('voice-stream-row')).toHaveCount(5, { timeout: 10_000 });
  await expect(page.getByTestId('enrich-running')).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId('voice-stream-panel')).toBeHidden();

  // RE-enrich the same run: the new job's voices must stream (a stale per-run dedup set swallowed
  // them all — live-smoke-caught) and the ticker must RESET to the new set's count, never pile onto
  // the previous enrich's voices. (The exact-count-in-playback no-duplicates property is test 1's job.)
  await page.getByTestId('enrich-voices').click();
  await expect(page.getByTestId('enrich-running')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('voice-stream-row')).toHaveCount(5, { timeout: 10_000 });
  await expect(page.getByTestId('voice-stream-panel')).toContainText('5 so far');
  await expect(page.getByTestId('enrich-running')).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId('voice-stream-panel')).toBeHidden();
});

test('a network-level stream failure (never CLOSED) still degrades labeled, not silently', async ({ page }) => {
  // route.abort() = a network error: the browser's EventSource retries CONNECTING forever and never
  // reaches CLOSED — the wrapper must degrade after 3 consecutive failed opens (review-caught gap:
  // without it the last stream counts keep painting with no label, the silent fallback the labeled-
  // degradation rule forbids).
  await mockBackend(page, { streamBody: () => null, holdPolls: 8, polledProgress: { done: 2, total: 5 } });
  let streamCalls = 0;
  await page.route('**/api/runs/*/events', (route) => {
    if (streamCalls++ === 0)
      return route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'Cache-Control': 'no-cache' }, body: partialStreamBody() });
    return route.abort(); // every reconnect dies at the network level — CONNECTING limbo
  });
  await openRun(page);

  await page.getByTestId('enrich-voices').click();
  await expect(page.getByTestId('voice-stream-row')).toHaveCount(2, { timeout: 5000 });
  await expect(page.getByTestId('enrich-stream-degraded')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('enrich-stream-degraded')).toHaveText(DEGRADE_COPY);
  // uncorrupted + polled counts carry on, exactly like the 404 degrade
  await expect(page.getByTestId('voice-stream-row')).toHaveCount(2);
  await expect(page.getByTestId('enrich-running')).toContainText('2/5');
  await expect(page.getByTestId('enrich-running')).toBeHidden({ timeout: 25_000 });
  await expect(page.getByTestId('voice-stream-panel')).toBeHidden();
});

test('a mid-stream disconnect degrades to the poll without corrupting the panel', async ({ page }) => {
  // First stream request dies after 2 voices (no terminal frame); every reconnect 404s → degrade.
  await mockBackend(page, {
    streamBody: (i) => (i === 0 ? partialStreamBody() : null),
    holdPolls: 8,
    polledProgress: { done: 2, total: 5 },
  });
  await openRun(page);

  await page.getByTestId('enrich-voices').click();

  // The 2 voices that arrived before the drop render…
  await expect(page.getByTestId('voice-stream-row')).toHaveCount(2, { timeout: 5000 });
  // …then the reconnect 404s and the degradation is LABELED, never silent.
  await expect(page.getByTestId('enrich-stream-degraded')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('enrich-stream-degraded')).toHaveText(DEGRADE_COPY);
  // The panel is uncorrupted: what already streamed stays, and the POLLED counts carry on.
  await expect(page.getByTestId('voice-stream-row')).toHaveCount(2);
  await expect(page.getByTestId('enrich-running')).toContainText('2/5');

  // The poll (never stopped) finishes the job: done → enriched artifact reload → all voices.
  await expect(page.getByTestId('enrich-running')).toBeHidden({ timeout: 25_000 });
  await expect(page.getByTestId('enrich-stream-degraded')).toBeHidden();
  await expect(page.getByTestId('voice-stream-panel')).toBeHidden();
  await page.getByTestId('stage-watch').click();
  await scrubToEnd(page);
  await expect(page.getByTestId('comment-row')).toHaveCount(1);
  await expect(page.getByTestId('community-row')).toHaveCount(3);
  await expect(page.getByTestId('institution-row')).toHaveCount(1);
});
