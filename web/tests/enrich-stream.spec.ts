import { test, expect, type Page } from '@playwright/test';
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

// The four streamed voices: 1 sim (pinned to the fixture's real veh0) + 3 inferred community voices.
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
];

const frame = (id: number, event: string, data: Record<string, unknown>) =>
  `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify({ event, ts: 0, ...data })}\n\n`;

/** A complete stream: job_start(0) … 4 voices … job_done. `retry: 100` speeds any reconnect. */
function fullStreamBody(): string {
  let b = 'retry: 100\n\n';
  b += frame(0, 'job_start', { run_id: RUN_ID, label: 'enrich:voices', stages: ['sampling travelers', 'generating voices'] });
  b += frame(1, 'cmd_start', { i: 0, n: 2, label: 'sampling travelers' });
  b += frame(2, 'voices_total', { total: 4 });
  VOICES.forEach((agent, i) => {
    b += frame(3 + i, 'voice', { index: i, done: i + 1, total: 4, agent });
  });
  b += frame(7, 'job_done', { label: 'enrich:voices' });
  return b;
}

/** A stream that DIES after 2 voices — no terminal frame, so EventSource auto-reconnects. */
function partialStreamBody(): string {
  let b = 'retry: 100\n\n';
  b += frame(0, 'job_start', { run_id: RUN_ID, label: 'enrich:voices', stages: ['sampling travelers', 'generating voices'] });
  b += frame(1, 'cmd_start', { i: 0, n: 2, label: 'sampling travelers' });
  b += frame(2, 'voices_total', { total: 4 });
  b += frame(3, 'voice', { index: 0, done: 1, total: 4, agent: VOICES[0] });
  b += frame(4, 'voice', { index: 1, done: 2, total: 4, agent: VOICES[1] });
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
  opts: { streamBody: (i: number) => string | null; holdPolls: number; polledProgress?: { done: number; total: number } },
) {
  const base = fs.readFileSync(FIXTURE, 'utf-8');
  const enrichedArt = JSON.parse(base);
  enrichedArt.agents = VOICES;
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
  await page.route('**/api/runs/*/enrich/stream', (route) => {
    const body = opts.streamBody(streamCalls++);
    if (body == null) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"no stream"}' });
    return route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'Cache-Control': 'no-cache' }, body });
  });
  await page.route('**/api/runs/*/status', (route) => {
    if (enrichPosted && !enrichDone) {
      enrichPolls++;
      if (enrichPolls <= opts.holdPolls) {
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
  // '/' loads latest.json before anything else — the REAL one is ~90 MB since the calibrated
  // exemplar and openRun loads it twice (goto + warm reload), eating most of the test budget.
  // Serve the tiny fixture there too (same floor delay).
  await page.route('**/latest.json', async (route) => {
    await new Promise((res) => setTimeout(res, 500));
    await route.fulfill({ body: base, contentType: 'application/json' });
  });
}

/** Seek to sim end by scrubbing the Timeline slider — the app's own pause-and-seek path (the
 * overlay-playback.spec convention). */
async function scrubToEnd(page: Page) {
  await page.locator('input[type=range]').first().fill('1800');
}

/** Open '/', warm-reload (StrictMode convention), enter edit mode, select the fixture run. */
async function openRun(page: Page) {
  await page.goto('/');
  await page.getByTestId('mode-edit').waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
  await page.reload();
  await expect(page.getByTestId('mode-edit')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('mode-edit').click();
  await expect(page.getByTestId('run-switcher')).toBeVisible();
  await page.getByTestId('run-select').selectOption(RUN_ID);
  await page.waitForResponse((r) => r.url().includes(`${RUN_ID}.json`));
  await expect(page.getByTestId('run-card')).toBeVisible();
  // the fixture has NO voices — the honest empty state is the genuine starting point
  await expect(page.getByTestId('no-voices')).toBeVisible({ timeout: 15_000 });
}

test('streamed voices render incrementally while the enrich job is still running', async ({ page }) => {
  await mockBackend(page, { streamBody: () => fullStreamBody(), holdPolls: 6 });
  await openRun(page);

  await page.getByTestId('enrich-voices').click();

  // The whole point: voices are VISIBLE while status still reads enrich:voices — before any
  // done-edge artifact reload could have delivered them.
  await expect(page.getByTestId('voice-stream-panel')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('enrich-running')).toBeVisible(); // still enriching
  await expect(page.getByTestId('enrich-running')).toContainText('4/4'); // live stream counts
  await expect(page.getByTestId('voice-stream-row')).toHaveCount(4);
  await expect(page.getByTestId('voice-stream-panel')).toContainText('community perspective'); // inferred labeled
  await expect(page.getByTestId('voice-stream-panel')).toContainText('not a poll');
  // hasVoices flipped live from the streamed append (the artifact copy, not the ticker)
  await expect(page.getByTestId('run-contains')).toContainText('voices ✓');

  // Status flips done → the authoritative reload swaps in the enriched artifact; the ticker yields.
  await expect(page.getByTestId('enrich-running')).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId('voice-stream-panel')).toBeHidden();
  await expect(page.getByTestId('run-contains')).toContainText('voices ✓');

  // Playback shows exactly the 4 artifact voices (1 sim + 3 community) — no stream duplicates.
  await page.getByTestId('mode-playback').click();
  await scrubToEnd(page); // all voices fired by sim end
  await expect(page.getByTestId('comment-row')).toHaveCount(1);
  await expect(page.getByTestId('community-row')).toHaveCount(3);

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
  await expect(page.getByTestId('enrich-running')).toBeVisible();
  await expect(page.getByTestId('voice-stream-row')).toHaveCount(4, { timeout: 10_000 });
  await expect(page.getByTestId('enrich-running')).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId('voice-stream-panel')).toBeHidden();

  // RE-enrich the same run: the new job's voices must stream (a stale per-run dedup set swallowed
  // them all — live-smoke-caught) and the ticker must RESET to the new set's count, never pile onto
  // the previous enrich's voices. (The exact-4-in-playback no-duplicates property is test 1's job.)
  await page.getByTestId('enrich-voices').click();
  await expect(page.getByTestId('enrich-running')).toBeVisible();
  await expect(page.getByTestId('voice-stream-row')).toHaveCount(4, { timeout: 10_000 });
  await expect(page.getByTestId('voice-stream-panel')).toContainText('4 so far');
  await expect(page.getByTestId('enrich-running')).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId('voice-stream-panel')).toBeHidden();
});

test('a mid-stream disconnect degrades to the poll without corrupting the panel', async ({ page }) => {
  // First stream request dies after 2 voices (no terminal frame); every reconnect 404s → degrade.
  await mockBackend(page, {
    streamBody: (i) => (i === 0 ? partialStreamBody() : null),
    holdPolls: 8,
    polledProgress: { done: 2, total: 4 },
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
  await expect(page.getByTestId('enrich-running')).toContainText('2/4');

  // The poll (never stopped) finishes the job: done → enriched artifact reload → all 4 voices.
  await expect(page.getByTestId('enrich-running')).toBeHidden({ timeout: 25_000 });
  await expect(page.getByTestId('enrich-stream-degraded')).toBeHidden();
  await expect(page.getByTestId('voice-stream-panel')).toBeHidden();
  await page.getByTestId('mode-playback').click();
  await scrubToEnd(page);
  await expect(page.getByTestId('comment-row')).toHaveCount(1);
  await expect(page.getByTestId('community-row')).toHaveCount(3);
});
