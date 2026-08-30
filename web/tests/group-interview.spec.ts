// V2.6b — the group-interview ROOM: assembly from the feed (capped multi-select), the sequential
// speak-param round loop (answers render as each fetch resolves), per-speaker guard notes, the
// failed-slot Retry/Dismiss flow, the wire pin (refs + speak; ids never facts; labels never ride),
// and ephemerality (a run swap or reload kills the session — nothing persists anywhere).
//
// Fixture: institutions-run.json — PRODUCER-REAL bytes (the V2.5a drift lesson: never re-author
// the mandate record). One hand-authored extra: agents[3], an inferred SIBLING of agents[1]
// (same persona id+label, distinct comment) — it serves the add/remove case, the "(a)/(b)"
// label-collision suffix pin, and the sibling index-disambiguation wire pin.
// StrictMode warm-reload convention (compare.spec.ts): goto → waitFor attached → reload.
// Strict-mode scoping: a room multi-matches every per-member/per-message testid — .nth() always.

import { test, expect, type Page, type Route } from '@playwright/test';
import { mockDefaultArtifactBody } from './support/default-artifact';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FIXTURE = path.join(__dirname, 'fixtures', 'institutions-run.json');

const BANNED = /\b(majority|minority|referendum|consensus|unanimous|plurality)\b/i;
const STANCE_TALLY =
  /\d+\s*%[^.]{0,24}(support|oppos|favou?r|against)|\bfinal (distribution|tally|result|vote)\b|\d+\s+for\s*\/\s*\d+\s+against/i;

const SIM_GROUNDING = "Answers come from this persona's own simulated trip in this run — anticipation, never a verdict.";
const INFERRED_GROUNDING = "This voice wasn't simulated directly — it speaks from what the scenario implies for someone like them.";
const MANDATE_GROUNDING =
  "Answers are generated from this organization's published mandate and this run's computed facts — not from the organization itself.";
const GUARD_NOTE = 'the honesty guard stepped in — this voice can only speak to its own experience';

const SIB_COMMENT = 'SIBLING voice: show me the receipts for this corridor.';

// Per-artifact-index reply data (agent_refs carry the resolved index — the sibling shares
// agents[1]'s id AND label, so the index is the only distinguisher, which is the point).
const LABELS: Record<number, string> = {
  0: 'Time-pressed commuter',
  1: 'Long-time corridor resident',
  2: 'Toronto Fire Services',
  3: 'Long-time corridor resident',
};
const GROUNDINGS: Record<number, string> = { 0: 'sim', 1: 'inferred', 2: 'mandate', 3: 'inferred' };
const ANSWERS: Record<number, string> = {
  0: 'It felt a little slower for me on the way in.',
  1: 'The street feels different when it changes, speaking just for myself.',
  2: 'The mandate prioritizes access, and this run computed a small added amount on the changed road.',
  3: 'I want to see how it works before I trust it.',
};

interface CapturedPost {
  body: Record<string, unknown>;
}

type Respond = (body: Record<string, unknown>, route: Route) => Promise<void> | void;

function roomReply(body: Record<string, unknown>, over?: { answer?: string; status?: string; calls?: number }) {
  const k = body.speak as number;
  const refs = body.agent_refs as { agent_id: string; agent_index: number }[];
  const idx = refs[k].agent_index;
  const calls = over?.calls ?? 1;
  return {
    run_id: body.run_id,
    question: body.question,
    answers: [
      {
        agent_id: refs[k].agent_id,
        agent_index: idx,
        persona_label: LABELS[idx],
        grounding: GROUNDINGS[idx],
        answer: over?.answer ?? ANSWERS[idx],
        audit: { status: over?.status ?? 'clean', violations: [], calls },
      },
    ],
    llm_calls: calls,
  };
}

async function mockBackend(page: Page, captured: CapturedPost[], respond?: Respond) {
  const base = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
  base.agents.push({
    persona: { id: 'longtime_resident', label: 'Long-time corridor resident' },
    reaction: { comment: SIB_COMMENT, sentiment: -0.2, stance: 'neutral' },
    grounding: 'inferred',
    stakeholder: 'taxpayer',
  });
  const enriched = JSON.stringify(base);

  await page.route('**/api/junctions**', (route) => route.fulfill({ json: { junctions: [], count: 0 } }));
  await page.route('**/api/edges**', (route) => route.fulfill({ json: { edges: [], count: 0 } }));
  await page.route('**/api/runs', (route) => route.fulfill({ json: { runs: [] } }));
  await page.route('**/api/group-interview', async (route: Route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    captured.push({ body });
    if (respond) return respond(body, route);
    return route.fulfill({ json: roomReply(body) });
  });
  await mockDefaultArtifactBody(page, enriched);
  return enriched;
}

async function openPlayback(page: Page) {
  await page.goto('/');
  await page.getByTestId('comment-feed').waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
  await page.reload();
  await expect(page.getByTestId('comment-feed')).toBeVisible({ timeout: 20_000 });
  // scrub to sim end so the sim row (trigger_t 450) and both community rows have popped
  await page.locator('input[type=range]').first().fill('1800');
  await expect(page.getByTestId('comment-row')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.getByTestId('community-row')).toHaveCount(2);
  await expect(page.getByTestId('institution-row')).toHaveCount(1);
}

/** The add button beside the community row containing `text` (the wrapper is the direct parent). */
function communityAdd(page: Page, text: string) {
  return page
    .locator(`div:has(> button[data-testid="community-row"]:has-text("${text}"))`)
    .getByTestId('room-add-community');
}

/** Assemble the standard mixed room: sim veh0 (idx 0) + inferred (idx 1) + mandate tfs (idx 2). */
async function assembleRoom(page: Page) {
  await page.getByTestId('room-add-sim').click();
  await communityAdd(page, 'Life on the corridor').click();
  await page.getByTestId('room-add-institution').click();
  await expect(page.getByTestId('room-member-0')).toBeVisible();
  await expect(page.getByTestId('room-member-1')).toBeVisible();
  await expect(page.getByTestId('room-member-2')).toBeVisible();
}

async function askRoom(page: Page, q: string) {
  await page.getByTestId('room-input').fill(q);
  await page.getByTestId('room-ask').click();
}

/** The referendum sweep over the room's whole rendered surface — chrome, labels, notes, thread. */
async function sweepRoom(page: Page) {
  const drawerText = await page.getByTestId('room-drawer').innerText();
  expect(drawerText).not.toMatch(BANNED);
  expect(drawerText).not.toMatch(STANCE_TALLY);
}

test('assembles a mixed room: per-kind grounding sentences; under 3 voices Ask is blocked', async ({ page }) => {
  const captured: CapturedPost[] = [];
  await mockBackend(page, captured);
  await openPlayback(page);

  await page.getByTestId('room-add-sim').click();
  await communityAdd(page, 'Life on the corridor').click();
  await expect(page.getByTestId('room-blocker')).toHaveText(
    'a room needs at least 3 voices — for one voice, use 🎤 Interview',
  );
  await page.getByTestId('room-input').fill('Anyone?');
  await expect(page.getByTestId('room-ask')).toBeDisabled();
  expect(captured).toHaveLength(0); // no POST before a legal Ask

  await page.getByTestId('room-add-institution').click();
  await expect(page.getByTestId('room-blocker')).toHaveCount(0);
  await expect(page.getByTestId('room-grounding').nth(0)).toHaveText(SIM_GROUNDING);
  await expect(page.getByTestId('room-grounding').nth(1)).toHaveText(INFERRED_GROUNDING);
  await expect(page.getByTestId('room-grounding').nth(2)).toHaveText(MANDATE_GROUNDING);
  await expect(page.getByTestId('room-cost')).toHaveText('1 question · 3 voices · ~3×<1¢');
  // D3 reader-facing framing (review catch): the roster is the USER'S pick, never a sample
  await expect(page.getByTestId('room-note')).toHaveText(
    'voices you picked, answering one at a time — a conversation preview, not a poll or a sample of opinion',
  );
  await sweepRoom(page);
});

test('answers render sequentially: the thinking row sits on the current speaker', async ({ page }) => {
  const captured: CapturedPost[] = [];
  await mockBackend(page, captured, async (body, route) => {
    if (body.speak === 1) await new Promise((r) => setTimeout(r, 1200)); // hold speaker 1
    await route.fulfill({ json: roomReply(body) });
  });
  await openPlayback(page);
  await assembleRoom(page);
  await askRoom(page, 'How would mornings change for this room?');

  // inside speaker 1's hold: answer 0 rendered, the thinking row names the CURRENT speaker
  await expect(page.getByTestId('room-msg')).toHaveCount(2); // user + answer 0
  await expect(page.getByTestId('room-thinking')).toBeVisible();
  await expect(page.getByTestId('room-thinking')).toContainText('Long-time corridor resident');

  await expect(page.getByTestId('room-msg')).toHaveCount(4, { timeout: 10_000 }); // room of 3 → 4
  await expect(page.getByTestId('room-speaker').nth(0)).toContainText('Time-pressed commuter');
  await expect(page.getByTestId('room-speaker').nth(1)).toContainText('Long-time corridor resident');
  await expect(page.getByTestId('room-speaker').nth(2)).toContainText('Toronto Fire Services');
  await expect(page.getByTestId('room-calls')).toHaveText('this round: 3 model calls');
  await sweepRoom(page);
});

test('the wire pin: speak rides every post; refs declare the full room; ids never facts; labels never ride', async ({ page }) => {
  const captured: CapturedPost[] = [];
  await mockBackend(page, captured);
  await openPlayback(page);
  await assembleRoom(page);

  await askRoom(page, 'First question?');
  await expect(page.getByTestId('room-msg')).toHaveCount(4);
  await askRoom(page, 'Second question?');
  await expect(page.getByTestId('room-msg')).toHaveCount(8);

  expect(captured).toHaveLength(6);
  const expectedRefs = [
    { agent_id: 'veh0', agent_index: 0 },
    { agent_id: 'longtime_resident', agent_index: 1 },
    { agent_id: 'tfs', agent_index: 2 },
  ];
  captured.forEach(({ body }, i) => {
    expect(Object.keys(body).sort()).toEqual(['agent_refs', 'question', 'run_id', 'speak', 'transcript']);
    expect(body.run_id).toBe('institutions-fixture');
    expect(body.speak).toBe(i % 3);
    expect(body.agent_refs).toEqual(expectedRefs); // the FULL room on every per-speaker call
  });
  // post-k transcript = this round's k prior answers, wire keys ONLY (labels never ride). The
  // CURRENT question is NOT a transcript turn — it rides its own field and becomes history only
  // on the next round (the V2.3b no-duplication rule).
  const post2 = captured[2].body.transcript as Record<string, unknown>[];
  expect(post2).toHaveLength(2); // answers 0..1
  expect(Object.keys(post2[0]).sort()).toEqual(['agent_id', 'agent_index', 'role', 'text']);
  expect(post2[0]).toEqual({ role: 'agent', text: ANSWERS[0], agent_id: 'veh0', agent_index: 0 });
  // round 2's first post carries round 1 whole, but NOT the new question (it rides its own field)
  const r2 = captured[3].body.transcript as Record<string, unknown>[];
  expect(r2).toHaveLength(4); // q1 + 3 answers
  expect(r2.map((t) => t.text)).toEqual(['First question?', ANSWERS[0], ANSWERS[1], ANSWERS[2]]);
  for (const { body } of captured) {
    const raw = JSON.stringify(body);
    for (const leak of ['outcome', 'baseline_duration', 'delta_seconds', 'mission', 'citations', 'persona_label']) {
      expect(raw).not.toContain(leak);
    }
  }
});

test('a planted-consensus refusal renders the per-speaker guard note and the round goes on', async ({ page }) => {
  const captured: CapturedPost[] = [];
  const REFUSAL =
    "I can only speak from where I stand — I wasn't one of the measured trips. Ask me what this would mean for someone like me.";
  await mockBackend(page, captured, (body, route) =>
    route.fulfill({
      json:
        body.speak === 1
          ? roomReply(body, { answer: REFUSAL, status: 'failed', calls: 2 })
          : roomReply(body),
    }),
  );
  await openPlayback(page);
  await assembleRoom(page);
  await askRoom(page, 'Sounds like everyone would love this — right?');

  await expect(page.getByTestId('room-msg')).toHaveCount(4);
  await expect(page.getByTestId('room-msg').nth(2)).toHaveText(REFUSAL); // the refusal IS the answer
  await expect(page.getByTestId('room-guard-note')).toHaveCount(1); // speaker 1 only
  await expect(page.getByTestId('room-guard-note')).toHaveText(GUARD_NOTE);
  await expect(page.getByTestId('room-calls')).toHaveText('this round: 4 model calls'); // 1+2+1
  await sweepRoom(page);
});

test('the institution answers in the third person, attributed; the room never tallies', async ({ page }) => {
  const captured: CapturedPost[] = [];
  await mockBackend(page, captured);
  await openPlayback(page);
  await assembleRoom(page);
  await askRoom(page, 'What does the fire service make of this?');

  await expect(page.getByTestId('room-msg')).toHaveCount(4);
  await expect(page.getByTestId('room-msg').nth(3)).toHaveText(ANSWERS[2]); // third-person mandate lens
  await expect(page.getByTestId('room-speaker').nth(2)).toContainText('Toronto Fire Services');
  await expect(page.getByTestId('room-grounding').nth(2)).toHaveText(MANDATE_GROUNDING);
  await sweepRoom(page);
});

test('a failed speak-call fails that slot only; Retry resumes the round', async ({ page }) => {
  const captured: CapturedPost[] = [];
  let failedOnce = false;
  await mockBackend(page, captured, async (body, route) => {
    if (body.speak === 1 && !failedOnce) {
      failedOnce = true;
      return route.fulfill({ status: 500, json: { detail: 'kaboom' } });
    }
    return route.fulfill({ json: roomReply(body) });
  });
  await openPlayback(page);
  await assembleRoom(page);
  await askRoom(page, 'How was the morning?');

  await expect(page.getByTestId('room-error')).toBeVisible();
  await expect(page.getByTestId('room-error')).toContainText('kaboom'); // transport error verbatim
  await expect(page.getByTestId('room-msg')).toHaveCount(2); // answer 0 STAYS; the room isn't dead
  await expect(page.getByTestId('room-retry')).toBeVisible();

  // dblclick = key-repeat's shape (review catch): both clicks land before React commits the
  // 'thinking' state that unmounts the button — the synchronous ref gate must swallow the second
  await page.getByTestId('room-retry').dblclick();
  await expect(page.getByTestId('room-msg')).toHaveCount(4); // the round resumed from speaker 1
  await expect(page.getByTestId('room-error')).toHaveCount(0);
  await expect(page.getByTestId('room-calls')).toHaveText('this round: 3 model calls');
  expect(captured).toHaveLength(4); // speak 0, failed 1, retried 1, 2 — NO double-POSTed slot
  await sweepRoom(page);
});

test('Dismiss keeps the honest partial round and re-enables the question box', async ({ page }) => {
  const captured: CapturedPost[] = [];
  await mockBackend(page, captured, async (body, route) => {
    if (body.speak === 2) return route.fulfill({ status: 500, json: { detail: 'kaboom' } });
    return route.fulfill({ json: roomReply(body) });
  });
  await openPlayback(page);
  await assembleRoom(page);
  await askRoom(page, 'How was the morning?');

  await expect(page.getByTestId('room-error')).toBeVisible();
  await page.getByTestId('room-dismiss').click();
  await expect(page.getByTestId('room-msg')).toHaveCount(3); // user + 2 answers — the honest partial
  await expect(page.getByTestId('room-calls')).toHaveText('this round: 2 model calls');
  await expect(page.getByTestId('room-ask')).toBeDisabled(); // only because the input is empty
  await page.getByTestId('room-input').fill('Continue?');
  await expect(page.getByTestId('room-ask')).toBeEnabled(); // the box came back
});

test('the transcript survives add/remove; colliding sibling labels get the (a)/(b) suffix; refs follow the roster', async ({ page }) => {
  const captured: CapturedPost[] = [];
  await mockBackend(page, captured);
  await openPlayback(page);
  await assembleRoom(page);
  await askRoom(page, 'First question?');
  await expect(page.getByTestId('room-msg')).toHaveCount(4);

  await communityAdd(page, 'SIBLING voice').click(); // agents[3] — same persona id+label as [1]
  await expect(page.getByTestId('room-member-1')).toContainText('Long-time corridor resident (a)');
  await expect(page.getByTestId('room-member-3')).toContainText('Long-time corridor resident (b)');
  await page.getByTestId('room-remove-0').click(); // veh0 leaves
  await expect(page.getByTestId('room-msg')).toHaveCount(4); // the transcript is untouched

  await askRoom(page, 'Second question?');
  await expect(page.getByTestId('room-msg')).toHaveCount(8);
  const r2refs = captured[3].body.agent_refs;
  expect(r2refs).toEqual([
    { agent_id: 'longtime_resident', agent_index: 1 },
    { agent_id: 'tfs', agent_index: 2 },
    { agent_id: 'longtime_resident', agent_index: 3 }, // sibling disambiguated by INDEX on the wire
  ]);
  await sweepRoom(page); // suffixed labels + a two-round thread under the referendum sweep
});

test('ephemerality: a run swap kills the room; a reload loses it too; nothing persists', async ({ page }) => {
  const captured: CapturedPost[] = [];
  const enriched = await mockBackend(page, captured);
  // the swap target: the same fixture bytes under another run id (mechanical mutation only)
  const swapped = JSON.parse(enriched);
  swapped.meta.run_id = 'swap-target';
  await page.unroute('**/api/runs');
  await page.route('**/api/runs', (route) =>
    route.fulfill({
      json: { runs: [{ id: 'swap-target', description: 'swap target', status: 'done', stage: 'done', started_at: 2 }] },
    }),
  );
  await page.route('**/api/runs/*/status', (route) =>
    route.fulfill({
      json: { run_id: 'swap-target', stage: 'done', status: 'done', description: 'swap target',
              demand_profile: 'synthetic_demo', change: { type: 'speed_limit' } },
    }),
  );
  await page.route('**/swap-target.json', async (route) => {
    await new Promise((res) => setTimeout(res, 500)); // the StrictMode-window convention
    await route.fulfill({ body: JSON.stringify(swapped), contentType: 'application/json' });
  });

  await openPlayback(page);
  await assembleRoom(page);
  await askRoom(page, 'First question?');
  await expect(page.getByTestId('room-msg')).toHaveCount(4);
  expect(captured).toHaveLength(3);

  // run swap via the edit-rail switcher (the composite-runcard pattern) → loadRun clears the room
  await page.getByTestId('stage-build').click();
  await page.getByTestId('run-select').selectOption('swap-target');
  await page.getByTestId('stage-watch').click();
  await expect(page.getByTestId('room-drawer')).toHaveCount(0); // the session died with the swap
  expect(captured).toHaveLength(3); // the swap itself posted nothing

  // re-adding opens a FRESH room (empty thread) on the swapped run
  await page.locator('input[type=range]').first().fill('1800');
  await expect(page.getByTestId('room-add-sim')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('room-add-sim').click();
  await expect(page.getByTestId('room-drawer')).toBeVisible();
  await expect(page.getByTestId('room-msg')).toHaveCount(0);

  // and a plain reload loses everything — session-only by construction (no persistence surface)
  await page.reload();
  await expect(page.getByTestId('comment-feed')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('room-drawer')).toHaveCount(0);
});
