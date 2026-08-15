import { test, expect, type Page, type Route } from '@playwright/test';
import { mockDefaultArtifactBody } from './support/default-artifact';
import * as fs from 'node:fs';
import * as path from 'node:path';

// V2.3b — the persona interview drawer. Backend fully MOCKED: /api/interview is stubbed per test and
// the intercepted payload is ASSERTED to carry ids only, never facts (the server builds the grounding).
// The fixture artifact (school-zone-run.json, real producer output) is served at /latest.json with the
// 4 VOICES pre-baked into agents[] — playback is the default mode, so no edit-rail dance is needed.
// StrictMode/maplibre conventions: ~500 ms fixture delay + one warm reload (compare.spec.ts).

const FIXTURE = path.join(__dirname, 'fixtures', 'school-zone-run.json');
const BANNED = /\b(majority|minority|referendum|consensus|unanimous|plurality)\b/i;
const STANCE_TALLY = /\d+\s*%[^.]{0,24}(support|oppos|favou?r|against)|\bfinal (distribution|tally|result|vote)\b|\d+\s+for\s*\/\s*\d+\s+against/i;

const SIM_GROUNDING = "Answers come from this persona's own simulated trip in this run — anticipation, never a verdict.";
const INFERRED_GROUNDING = "This voice wasn't simulated directly — it speaks from what the scenario implies for someone like them.";
const GUARD_NOTE = 'the honesty guard stepped in — this voice can only speak to its own experience';

// The same 4 voices the enrich-stream spec streams: 1 sim (pinned to the fixture's real veh0) + 3 inferred.
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

const INFERRED_IDS = ['local_resident', 'shop_owner', 'taxpayer'];

interface CapturedPost {
  body: Record<string, unknown>;
}

/** Mock the backend; `respond` builds the /api/interview reply per intercepted POST. */
async function mockBackend(
  page: Page,
  respond: (body: Record<string, unknown>) => Record<string, unknown>,
  captured: CapturedPost[],
) {
  const base = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
  base.agents = VOICES;
  const enriched = JSON.stringify(base);

  await page.route('**/api/junctions**', (route) => route.fulfill({ json: { junctions: [], count: 0 } }));
  await page.route('**/api/edges**', (route) => route.fulfill({ json: { edges: [], count: 0 } }));
  await page.route('**/api/runs', (route) => route.fulfill({ json: { runs: [] } }));
  await page.route('**/api/interview', (route: Route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    captured.push({ body });
    return route.fulfill({ json: respond(body) });
  });
  // '/' resolves the latest.json POINTER (V2.5c) — serve the ENRICHED fixture as the default
  // run (the helper carries the ~500 ms StrictMode floor delay).
  await mockDefaultArtifactBody(page, enriched);
}

function reply(bodyIn: Record<string, unknown>, answer: string, status = 'clean'): Record<string, unknown> {
  return {
    answer,
    audit: { status },
    grounding: bodyIn.agent_id === 'veh0' ? 'sim' : 'inferred',
    run_id: bodyIn.run_id,
    agent_id: bodyIn.agent_id,
    persona_label: 'x',
  };
}

/** Open playback on the fixture (warm reload) and scrub to sim end so every voice has fired. */
async function openPlayback(page: Page) {
  await page.goto('/');
  await page.getByTestId('comment-feed').waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
  await page.reload();
  await expect(page.getByTestId('comment-feed')).toBeVisible({ timeout: 20_000 });
  await page.locator('input[type=range]').first().fill('1800');
  await expect(page.getByTestId('comment-row')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.getByTestId('community-row')).toHaveCount(3);
}

test('sim voice: drawer opens from the agent panel; the payload carries ids, never facts', async ({ page }) => {
  const captured: CapturedPost[] = [];
  await mockBackend(page, (b) => reply(b, 'It felt a little slower than usual, honestly.'), captured);
  await openPlayback(page);

  await page.getByTestId('comment-row').click();
  await expect(page.getByTestId('agent-panel')).toBeVisible();
  const open = page.getByTestId('interview-open');
  await expect(open).toContainText('<1¢'); // cost honesty on the trigger too
  await open.click();

  await expect(page.getByTestId('interview-drawer')).toBeVisible();
  await expect(page.getByTestId('interview-grounding')).toHaveText(SIM_GROUNDING);
  await expect(page.getByTestId('interview-send')).toContainText('<1¢');

  await page.getByTestId('interview-input').fill('How was your commute?');
  await page.getByTestId('interview-send').click();
  await expect(page.getByTestId('interview-msg')).toHaveCount(2, { timeout: 10_000 }); // question + answer
  await expect(page.getByTestId('interview-msg').last()).toContainText('a little slower than usual');

  // IDS, NEVER FACTS: the client sends run_id + agent_id + agent_index + question + transcript —
  // no outcome numbers (agent_index is a positional REFERENCE, disambiguating sibling inferred voices).
  expect(captured).toHaveLength(1);
  const body = captured[0].body;
  expect(Object.keys(body).sort()).toEqual(['agent_id', 'agent_index', 'question', 'run_id', 'transcript']);
  expect(body.agent_id).toBe('veh0');
  expect(body.agent_index).toBe(0); // the sim voice is agents[0] in the fixture
  expect(body.run_id).toBe('school-zone-fixture');
  const raw = JSON.stringify(body);
  for (const leak of ['outcome', 'baseline_duration', 'delta_seconds', '240', '360']) {
    expect(raw).not.toContain(leak);
  }
});

test('inferred voice: a community row opens the drawer with the inferred-basis disclosure', async ({ page }) => {
  const captured: CapturedPost[] = [];
  await mockBackend(page, (b) => reply(b, 'I was not one of the measured trips — for me it is about trust.'), captured);
  await openPlayback(page);

  // the community rows keep their purple accent (review-caught: the button-reset `border: 'none'`
  // shorthand silently wiped the borderLeft when ordered after it)
  const accent = await page
    .getByTestId('community-row')
    .first()
    .evaluate((el) => getComputedStyle(el).borderLeftWidth);
  expect(accent).toBe('3px');

  await page.getByTestId('community-row').first().click();
  await expect(page.getByTestId('interview-drawer')).toBeVisible();
  await expect(page.getByTestId('interview-grounding')).toHaveText(INFERRED_GROUNDING);

  await page.getByTestId('interview-input').fill('What would this mean for you?');
  await page.getByTestId('interview-send').click();
  await expect(page.getByTestId('interview-msg')).toHaveCount(2, { timeout: 10_000 });
  expect(INFERRED_IDS).toContain(captured[0].body.agent_id);
  // the index rides the wire and points at an inferred record (agents[1..3] in the fixture)
  expect([1, 2, 3]).toContain(captured[0].body.agent_index);
});

test('a failed audit renders the in-character refusal + the labeled guard note', async ({ page }) => {
  const refusal = 'Honestly, I can only speak to my own morning and how the trip felt for me.';
  await mockBackend(page, (b) => reply(b, refusal, 'failed'), []);
  await openPlayback(page);

  await page.getByTestId('comment-row').click();
  await page.getByTestId('interview-open').click();
  await page.getByTestId('interview-input').fill('How many people support this?');
  await page.getByTestId('interview-send').click();

  await expect(page.getByTestId('interview-msg').last()).toContainText('my own morning', { timeout: 10_000 });
  await expect(page.getByTestId('interview-guard-note')).toBeVisible();
  await expect(page.getByTestId('interview-guard-note')).toHaveText(GUARD_NOTE);

  const drawerText = await page.getByTestId('interview-drawer').innerText();
  expect(drawerText).not.toMatch(BANNED);
  expect(drawerText).not.toMatch(STANCE_TALLY);
});

test('per-agent transcripts survive switching voices (session-only, keyed by agent)', async ({ page }) => {
  const captured: CapturedPost[] = [];
  await mockBackend(page, (b) => reply(b, `answer for ${String(b.agent_id)}`), captured);
  await openPlayback(page);

  // exchange with the sim voice
  await page.getByTestId('comment-row').click();
  await page.getByTestId('interview-open').click();
  await page.getByTestId('interview-input').fill('First question?');
  await page.getByTestId('interview-send').click();
  await expect(page.getByTestId('interview-msg')).toHaveCount(2, { timeout: 10_000 });

  // switch to an inferred voice — its thread starts EMPTY
  await page.getByTestId('community-row').first().click();
  await expect(page.getByTestId('interview-grounding')).toHaveText(INFERRED_GROUNDING);
  await expect(page.getByTestId('interview-msg')).toHaveCount(0);

  // back to the sim voice — its 2-message thread is intact
  await page.getByTestId('comment-row').click();
  await page.getByTestId('interview-open').click();
  await expect(page.getByTestId('interview-grounding')).toHaveText(SIM_GROUNDING);
  await expect(page.getByTestId('interview-msg')).toHaveCount(2);
  await expect(page.getByTestId('interview-msg').last()).toContainText('answer for veh0');

  // the follow-up sends the PRIOR history as the transcript (the session context rides the wire)
  await page.getByTestId('interview-input').fill('Second question?');
  await page.getByTestId('interview-send').click();
  await expect(page.getByTestId('interview-msg')).toHaveCount(4, { timeout: 10_000 });
  const followUp = captured[captured.length - 1].body;
  const transcript = followUp.transcript as { role: string; text: string }[];
  expect(transcript.map((t) => t.text)).toEqual(['First question?', 'answer for veh0']);
});
