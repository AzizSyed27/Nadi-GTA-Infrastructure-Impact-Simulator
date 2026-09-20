// V2.7f C1 — THE COST LINE'S SCOPE, as pure-fold pins (the group-evidence.spec idiom — no vitest).
//
// The defect (live, 2026-09-18): a RE-enrich's first frame read "model calls: 213 of ~215" — the
// prior enrich's count seeded from the ledger, rendered as if this enrich were complete — and on a
// run that had run the whole chain the line would have read "5,208 of ~215": the numerator summed
// every stage while the denominator was one stage's. The fix has two halves and this file pins the
// client's: a `stage_start` carrying `keys` (the manual path — server.py's `_ENRICH_KEYS`, C0)
// SCOPES the line to this job's stages and starts their counts fresh; a `stage_start` WITHOUT keys
// (the chain, a fresh run or a RESUME) CLEARS the scope — Σ all, the whole-run line. Both halves are
// pinned, because the second is what keeps a resume honest: after a manual voices enrich, resume
// runs discourse/report/index through the chain body, whose starts carry no keys, and a stale scope
// would keep summing three old keys while thousands of calls metered off-line.
import { test, expect } from '@playwright/test';
import type { RunEvent } from '../lib/runStream';
import {
  costLineSpent,
  foldEvents,
  seedFromLedger,
  type Ledger,
} from '../lib/runFeed';

const RUN = 'multimodal-scenario-19990101T000000Z';

/** A run that already ran voices ONCE (the ledger a re-enrich starts from). */
function ledgerVoicesDone(): Ledger {
  const row = (key: string, status: string, calls: number) =>
    ({ key, label: key, llm: true, status, llm_calls: calls, detail: '' }) as Ledger['stages'][number];
  return {
    run_id: RUN,
    stages: [
      row('personas', 'done', 0), row('voices', 'done', 213), row('institutions', 'done', 0),
      row('discourse', 'skipped', 0), row('report', 'skipped', 0), row('index', 'skipped', 0),
    ],
    projection: { calls: 7157, basis: 'the whole chain' },
    ended: { status: 'complete', at: 4, reason: 'interpretation not requested' },
  };
}

const ev = (event: string, data: Record<string, unknown> = {}): RunEvent =>
  ({ event, ts: 0, ...data }) as unknown as RunEvent;

const KEYS = ['personas', 'voices', 'institutions'];

test('a keyed stage_start scopes the line to THIS job and starts its counts fresh', () => {
  const seed = seedFromLedger(ledgerVoicesDone(), RUN);
  expect(costLineSpent(seed)).toBe(213); // no job in flight: the whole-run line
  expect(seed.inFlight).toBeNull();

  const started = foldEvents(seed, [ev('stage_start', { stage: 'enrich:voices', label: 'enrich:voices', kind: 'llm', keys: KEYS })]);
  expect(started.inFlight).toEqual(KEYS);
  expect(costLineSpent(started)).toBe(0); // "0 of ~215" — this enrich's N, never the prior job's 213
  const voices = started.stages.find((s) => s.key === 'voices')!;
  expect(voices.calls).toBeNull(); // not yet metered
  expect(voices.status).toBe('pending'); // only keys[0] runs at the start line (today's rule)
  expect(started.stages.find((s) => s.key === 'personas')!.status).toBe('running');

  const metered = foldEvents(started, [
    ev('voices_total', { total: 3 }),
    ev('stage_usage', { stage: 'voices', calls: 47 }),
    ev('stage_end', { stage: 'enrich:voices', status: 'done', detail: '' }),
  ]);
  expect(costLineSpent(metered)).toBe(47);
  expect(metered.llmCallsTotal).toBe(47); // the document's whole-run figure: the rows as they stand

  const ended = foldEvents(metered, [ev('run_ended', { status: 'complete', detail: '' })]);
  expect(costLineSpent(ended)).toBe(47); // the terminal frame still reads this job's count
  expect(ended.inFlight).toEqual(KEYS); // run_ended never touches the scope
  expect(ended.endings).toBe(2); // the ledger's ending + this job's — the re-read fires per ending
});

test('a KEYLESS stage_start clears the scope — the whole-run line is the honest scope on a resume', () => {
  const seed = seedFromLedger(ledgerVoicesDone(), RUN);
  const manual = foldEvents(seed, [
    ev('stage_start', { stage: 'enrich:voices', label: 'enrich:voices', kind: 'llm', keys: KEYS }),
    ev('voices_total', { total: 3 }),
    ev('stage_usage', { stage: 'voices', calls: 47 }),
    ev('stage_end', { stage: 'enrich:voices', status: 'done', detail: '' }),
    ev('run_ended', { status: 'complete', detail: '' }),
  ]);
  expect(costLineSpent(manual)).toBe(47);

  // RESUME: the chain body's starts carry no keys
  const resumed = foldEvents(manual, [
    ev('stage_start', { stage: 'enrich:discourse', label: 'running the discourse cascades', kind: 'llm' }),
    ev('stage_usage', { stage: 'discourse', calls: 2231 }),
  ]);
  expect(resumed.inFlight).toBeNull();
  expect(costLineSpent(resumed)).toBe(47 + 2231); // a stale scope would still read 47
  expect(resumed.llmCallsTotal).toBe(47 + 2231);
});

test('a chain-shaped fold (never a keyed start) reads the whole run, as before', () => {
  const seed = seedFromLedger(null, RUN);
  const chain = foldEvents(seed, [
    ev('stage_start', { stage: 'enrich:voices', label: 'sampling travelers', kind: 'llm' }),
    ev('stage_usage', { stage: 'voices', calls: 213 }),
    ev('stage_start', { stage: 'enrich:discourse', label: 'running the discourse cascades', kind: 'llm' }),
    ev('stage_usage', { stage: 'discourse', calls: 40 }),
  ]);
  expect(chain.inFlight).toBeNull();
  expect(costLineSpent(chain)).toBe(chain.llmCallsTotal);
  expect(chain.llmCallsTotal).toBe(253);
  expect(chain.endings).toBe(0);
});
