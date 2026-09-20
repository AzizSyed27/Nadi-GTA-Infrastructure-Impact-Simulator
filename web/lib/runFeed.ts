/**
 * V2.7b C7 — THE FOLD: the run experience as a projection of the events file.
 *
 * `foldEvents(seedFromLedger(ledger), events)` is a PURE function. Everything the experience shows —
 * which beats landed, which stage is running, the voices that have arrived, how it ended — is
 * derived here from (a) the durable ledger and (b) the append-only event lines. Nothing lives only
 * in React state.
 *
 * That is what makes a reload mid-run rebuild the same screen rather than a blank one: the client
 * re-reads the ledger, replays the file from line 0, folds, and is exactly where it was. It is also
 * what makes the experience testable without a server — feed the fold a list of events and assert
 * the state, no browser required.
 *
 * TWO RULES THIS FILE EXISTS TO ENFORCE:
 *
 * 1. **The fold is never batched.** It advances per `voice` event straight off the stream. The
 *    voice cards and the stage ticker render from here, so "voices arriving one at a time" is a
 *    property of this function, not of a render schedule. (No batching is implemented anywhere —
 *    C7 measured the append path at 0.5 ms and did not build one — but the rule is what keeps a
 *    future optimisation from quietly turning the live claim into a slideshow.)
 * 2. **Counters come from here or from the ledger, never from a literal.** Every "N of M" on
 *    screen traces to an event or a ledger row.
 */

import type { RunEvent, VoiceEvent } from './runStream';
import type { Agent } from './types';

/** The presented Act II stages, in order — MIRRORS python/src/run_ledger.py STAGES. Presented
 *  stages are not subprocess boundaries: institutions has no subprocess of its own, and
 *  personas/voices are two stages inside one enrich job. */
export const STAGE_KEYS = ['personas', 'voices', 'institutions', 'discourse', 'report', 'index'] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export const STAGE_LABEL: Record<StageKey, string> = {
  personas: 'personas sampled',
  voices: 'voices',
  institutions: 'institutions',
  discourse: 'discourse',
  report: 'report',
  index: 'chat index',
};

/** Stages that call a model. Institutions and personas do NOT — institutions are composed
 *  deterministically over byte-pinned roster text. The cost line says so rather than inheriting a
 *  plausible-looking count. */
export const STAGE_COSTS_MODEL: Record<StageKey, boolean> = {
  personas: false, voices: true, institutions: false, discourse: true, report: true, index: true,
};

export type StageStatus = 'pending' | 'running' | 'done' | 'partial' | 'skipped' | 'failed';
export type RunEnding = 'complete' | 'skipped' | 'degraded' | 'failed';

export interface LedgerStageRow {
  key: string;
  label?: string;
  llm?: boolean;
  status: StageStatus;
  started_at?: number | null;
  ended_at?: number | null;
  llm_calls?: number | null;
  detail?: string;
  produced?: Record<string, unknown>;
}

export interface Ledger {
  run_id: string;
  created_at?: number;
  updated_at?: number;
  quant?: { status: StageStatus; started_at?: number | null; ended_at?: number | null };
  facts_report?: { status: StageStatus; at?: number | null };
  stages: LedgerStageRow[];
  projection?: { calls: number | null; basis: string };
  ended?: { status: RunEnding; at: number; reason: string } | null;
}

export interface Beat {
  n: number;
  key: string;
  title: string;
  detail: string;
  ts: number;
  simT?: number | null;
  note?: string | null;
  /** Beat 4 only, and only on a run that actually withdrew a change: `change_scheduler`'s own
   *  restoration verdict. The honest VARIANTS (a drawn road, an unwindowed change, a window that
   *  never fired) carry no verdict because there was no withdrawal to verify — so this is `null`
   *  there, and the held moment withholds its ✓ rather than decorating a sentence that claims
   *  nothing. The check mark is earned by the assertion, never by the beat's existence. */
  restoredOk?: boolean | null;
  /** Beat 3 only, and only where the harness actually READ THE CHANGE BACK from the simulator
   *  (`change_scheduler._apply`'s per-type assert). Same rule as `restoredOk`: the honest variants
   *  run no assert, so this is null there and the tick is withheld. */
  appliedOk?: boolean | null;
}

export interface StageState {
  key: StageKey;
  label: string;
  status: StageStatus;
  /** Metered model calls, from the ledger. `null` = this stage cannot count its own calls, which
   *  the cost line reports as a floor rather than silently adding a zero. */
  calls: number | null;
  detail: string;
  /** Only for a stage that streams countable content (voices): {done, total}. */
  progress?: { done: number; total: number };
}

export interface SlotState {
  slot: string;
  status: 'clean' | 'resolved_on_retry' | 'failed' | 'code_rendered';
  text: string;
  /** The REJECTED pre-retry draft, persisted server-side since C5 — the credibility moment. */
  draft?: string;
  violations?: { rule: string; sentence: string }[];
}

export interface RunFeedState {
  runId: string | null;
  /** ACT I */
  beats: Beat[];
  demand: { car: number; bicycle: number; pedestrian: number } | null;
  demandProfile: string | null;
  /** The baseline leg, playable while the scenario leg computes. `null` + a reason = the honest
   *  unavailable state (calibrated runs free the spill mid-run by design). */
  baselineUrl: string | null;
  baselineUnavailable: string | null;
  resultsReadyAt: number | null;
  /** ACT II */
  stages: StageState[];
  /** The sampled set, and the sentence that says what those points ARE — the stage's whole claim is
   *  provenance ("one traveler on their own computed route"), which a bare count cannot carry. */
  personas: { total: number; basis: string } | null;
  voices: Agent[];
  voicesTotal: number | null;
  institutionsSpoke: Agent[];
  institutionsSilent: { id: string; label: string; reason: string }[];
  slots: SlotState[];
  indexDocs: number | null;
  /** The run's ending, once known. */
  ended: { status: RunEnding; detail: string } | null;
  /** Set when the client decides the run is over WITHOUT an ending line — the crash/orphan case
   *  (state terminal + lock free + no run_ended). Never invents a status. */
  endedByState: boolean;
  llmCallsTotal: number;
  projection: { calls: number | null; basis: string } | null;
  /** V2.7f C1 — THE COST LINE'S SCOPE. A `stage_start` carrying `keys` (the MANUAL enrich path —
   *  server.py's `_ENRICH_KEYS`, the server's own statement of which presented stages this job
   *  meters) sets it; a `stage_start` WITHOUT keys (the chain — a fresh run or a RESUME) clears it
   *  to null, which is chain semantics: Σ all. Both halves matter: a stale scope after a manual
   *  enrich would keep summing three old keys through a resume that meters thousands off-line.
   *  `run_ended` never touches it — the terminal frame still reads this job's count. */
  inFlight: StageKey[] | null;
  /** How many `run_ended` lines have folded. A re-enrich's own ending equals the seeded
   *  `ended.status` (both `complete`), so the terminal-edge ledger re-read keys on THIS. */
  endings: number;
}

/** What the Act II cost line's numerator IS: this job's stages while a manual enrich is in flight
 *  (the projection beside it is that stage's), else the whole run's rows as they stand. */
export function costLineSpent(state: RunFeedState): number {
  if (!state.inFlight) return state.llmCallsTotal;
  const keys = new Set<StageKey>(state.inFlight);
  return state.stages.reduce((n, s) => n + (keys.has(s.key) ? (s.calls ?? 0) : 0), 0);
}

export function emptyFeedState(runId: string | null = null): RunFeedState {
  return {
    runId,
    beats: [], demand: null, demandProfile: null,
    baselineUrl: null, baselineUnavailable: null, resultsReadyAt: null,
    stages: STAGE_KEYS.map((key) => ({
      key, label: STAGE_LABEL[key], status: 'pending' as StageStatus, calls: null, detail: '',
    })),
    personas: null,
    voices: [], voicesTotal: null,
    institutionsSpoke: [], institutionsSilent: [],
    slots: [], indexDocs: null,
    ended: null, endedByState: false,
    llmCallsTotal: 0, projection: null,
    inFlight: null, endings: 0,
  };
}

/** Seed the fold from the DURABLE half. A run whose events file was pruned (7 days) still renders
 *  its honest end state from here; the events then fill in the live detail. */
export function seedFromLedger(ledger: Ledger | null, runId: string | null = null): RunFeedState {
  const base = emptyFeedState(ledger?.run_id ?? runId);
  if (!ledger) return base;
  const byKey = new Map(ledger.stages.map((s) => [s.key, s]));
  base.stages = STAGE_KEYS.map((key) => {
    const row = byKey.get(key);
    return {
      key,
      label: row?.label ?? STAGE_LABEL[key],
      status: (row?.status ?? 'pending') as StageStatus,
      calls: row?.llm_calls ?? null,
      detail: row?.detail ?? '',
    };
  });
  base.llmCallsTotal = ledger.stages.reduce((n, s) => n + (s.llm_calls ?? 0), 0);
  base.projection = ledger.projection ?? null;
  if (ledger.ended) {
    base.ended = { status: ledger.ended.status, detail: ledger.ended.reason };
    base.endings = 1;
  }
  if (ledger.facts_report?.status === 'done' && ledger.facts_report.at) {
    base.resultsReadyAt = ledger.facts_report.at;
  }
  return base;
}

/** The server's run-state stage string ('enrich:voices') → the presented stages it produces. One
 *  subprocess can produce two presented stages; the UI never learns a subprocess exists. */
const STATE_TO_KEYS: Record<string, StageKey[]> = {
  'enrich:voices': ['personas', 'voices', 'institutions'],
  'enrich:discourse': ['discourse'],
  'enrich:report': ['report'],
  'enrich:index': ['index'],
};

function setStage(state: RunFeedState, key: StageKey, patch: Partial<StageState>): void {
  const i = state.stages.findIndex((s) => s.key === key);
  if (i >= 0) state.stages[i] = { ...state.stages[i], ...patch };
}

/**
 * Fold one event into the state. Returns a NEW state object when something changed, the SAME one
 * when the event carries nothing this projection tracks — so a consumer can bail on identity and a
 * heartbeat costs no render.
 */
export function foldEvent(prev: RunFeedState, ev: RunEvent): RunFeedState {
  const s: RunFeedState = { ...prev };
  // AN EVENT FALSIFIES THE POLL'S GUESS. `endedByState` is an INFERENCE from a terminal stage string
  // — the fallback for a run whose process died without writing `run_ended`. An event arriving
  // afterwards is proof the run did not end: a chained run passes THROUGH `done` between the quant
  // leg and the chain's first stage write, and a guess that outlived that evidence is what made the
  // interpretation run invisibly (V2.7b C11). A real ending is a `run_ended` line, which sets
  // `ended` a few lines below and is never cleared here.
  s.endedByState = false;
  const kind = ev.event;

  switch (kind) {
    case 'run_start':
      s.runId = (ev.run_id as string) ?? s.runId;
      s.demandProfile = (ev.demand_profile as string) ?? s.demandProfile;
      return s;

    case 'beat': {
      const n = ev.n as number;
      if (s.beats.some((b) => b.n === n)) return prev; // fire-once, mirrored client-side
      s.beats = [...s.beats, {
        n, key: ev.key as string, title: ev.title as string, detail: ev.detail as string,
        ts: ev.ts, simT: (ev.sim_t as number) ?? null, note: (ev.note as string) ?? null,
        restoredOk: (ev.restored_ok as boolean) ?? null,
        appliedOk: (ev.applied_ok as boolean) ?? null,
      }].sort((a, b) => a.n - b.n);
      if (ev.counts) s.demand = ev.counts as RunFeedState['demand'];
      if (ev.demand_profile) s.demandProfile = ev.demand_profile as string;
      return s;
    }

    case 'baseline_ready':
      s.baselineUrl = ev.url as string;
      s.baselineUnavailable = null;
      return s;

    case 'baseline_unavailable':
      s.baselineUnavailable = ev.reason as string;
      s.baselineUrl = null;
      return s;

    case 'results_ready':
      s.resultsReadyAt = ev.ts;
      return s;

    case 'stage_start': {
      const keys = STATE_TO_KEYS[ev.stage as string];
      if (!keys) return prev; // the quant stage: Act I renders from beats, not stage cards
      s.stages = [...s.stages];
      // V2.7f C1 — THE SCOPE RULE, both halves (see `inFlight`). A keyed start (the manual path)
      // scopes the cost line to this job's stages and starts their counts FRESH — null, "not yet
      // metered", never the prior job's ledger count; a keyless start (the chain, a resume) clears
      // the scope to Σ all. The server's keys are the truth about which rows this job began (C0).
      const jobKeys = Array.isArray(ev.keys) ? (ev.keys as StageKey[]) : null;
      s.inFlight = jobKeys;
      for (const k of jobKeys ?? []) setStage(s, k, { status: 'pending', calls: null, detail: '' });
      // Only the FIRST of a multi-stage subprocess goes running; the rest follow as their content
      // arrives, so "institutions" doesn't claim to be working while voices are still generating.
      setStage(s, keys[0], { status: 'running', detail: (ev.label as string) ?? '' });
      return s;
    }

    case 'stage_end': {
      const keys = STATE_TO_KEYS[ev.stage as string];
      if (!keys) return prev;
      const status: StageStatus = ev.status === 'failed' ? 'failed' : 'done';
      s.stages = [...s.stages];
      // V2.7b C9 — the MANUAL report enrich runs report.py AND report_agent.py under one
      // `enrich:report` state string, so `index_progress` starts the chat-index card and nothing
      // would ever end it. (The auto-chain gives index its own `enrich:index` step, so this only
      // fires on the manual path — which, with the chain dark until C10, is the path a reader
      // actually takes.) Close it only if it is running: a report enrich on a run whose index was
      // never touched must not mark that stage done.
      const groupKeys =
        ev.stage === 'enrich:report' && s.stages.find((x) => x.key === 'index')?.status === 'running'
          ? [...keys, 'index' as StageKey]
          : keys;
      for (const k of groupKeys) {
        const cur = s.stages.find((x) => x.key === k);
        if (!cur) continue;
        // A GROUP'S VERDICT DOES NOT OVERTURN A STAGE THAT ALREADY REPORTED ITS OWN (V2.7b C11).
        // Several presented stages can share one run-state string — `enrich:voices` covers
        // personas, voices and institutions — so a failed group end used to mark all three failed,
        // including a personas stage its OWN `personas` event had already settled as done, or an
        // institutions stage the ledger recorded as skipped. That is a false causal claim about a
        // stage that had already finished (the same family as C11a's failed-stage naming fix), and
        // it made the rendering depend on whether the ledger or the stream landed last — a race a
        // spec was quietly winning. Stages still in flight take the group's verdict, as before: on
        // the MANUAL enrich path all of them are running when the group fails, so nothing changes
        // there. A stage that never started is still not silently marked done.
        const settled = cur.status === 'done' || cur.status === 'partial' || cur.status === 'skipped';
        if (cur.status === 'running' || (status === 'failed' && !settled)) {
          setStage(s, k, { status, detail: (ev.detail as string) ?? cur.detail });
        }
      }
      return s;
    }

    case 'stage_partial': {
      const keys = (ev.keys as string[]) ?? STATE_TO_KEYS[ev.stage as string] ?? [];
      s.stages = [...s.stages];
      for (const k of keys) setStage(s, k as StageKey, { status: 'partial' });
      return s;
    }

    case 'stage_usage': {
      const key = ev.stage as StageKey;
      const calls = ev.calls as number | null;
      if (calls == null) return prev;
      s.stages = [...s.stages];
      setStage(s, key, { calls });
      s.llmCallsTotal = s.stages.reduce((n, x) => n + (x.calls ?? 0), 0);
      return s;
    }

    case 'personas':
      s.personas = { total: ev.total as number, basis: (ev.basis as string) ?? '' };
      s.stages = [...s.stages];
      setStage(s, 'personas', { status: 'done', detail: (ev.basis as string) ?? '',
                                progress: { done: ev.total as number, total: ev.total as number } });
      return s;

    case 'voices_total':
      s.voicesTotal = ev.total as number;
      s.stages = [...s.stages];
      setStage(s, 'personas', { status: 'done' });
      setStage(s, 'voices', { status: 'running',
                              progress: { done: s.voices.length, total: ev.total as number } });
      return s;

    case 'voice': {
      const v = ev as unknown as VoiceEvent;
      // A re-enrich streams a FRESH set: done===1 replaces rather than appends (the V2.3a rule).
      const fresh = v.done === 1;
      s.voices = fresh ? [v.agent] : [...s.voices, v.agent];
      s.voicesTotal = v.total ?? s.voicesTotal;
      s.stages = [...s.stages];
      setStage(s, 'voices', {
        status: 'running',
        progress: { done: v.done, total: v.total ?? s.voices.length },
      });
      return s;
    }

    case 'institutions':
      s.institutionsSpoke = (ev.spoke as Agent[]) ?? [];
      s.institutionsSilent = (ev.silent as RunFeedState['institutionsSilent']) ?? [];
      s.stages = [...s.stages];
      setStage(s, 'voices', { status: 'done' });
      setStage(s, 'institutions', { status: 'done', calls: 0 }); // deterministic: zero, and stated
      return s;

    case 'slot_start':
      s.stages = [...s.stages];
      setStage(s, 'report', { status: 'running', detail: `composing ${ev.slot as string}` });
      return s;

    case 'slot_landed': {
      const slot: SlotState = {
        slot: ev.slot as string,
        status: ev.status as SlotState['status'],
        text: (ev.text as string) ?? '',
        draft: (ev.draft as string) ?? undefined,
        violations: (ev.violations as SlotState['violations']) ?? undefined,
      };
      s.slots = [...s.slots.filter((x) => x.slot !== slot.slot), slot];
      return s;
    }

    case 'index_progress':
      s.indexDocs = ev.docs as number;
      s.stages = [...s.stages];
      setStage(s, 'index', { status: 'running', detail: `${ev.docs as number} docs` });
      return s;

    case 'run_ended':
      s.ended = { status: ev.status as RunEnding, detail: (ev.detail as string) ?? '' };
      s.endings = prev.endings + 1; // never touches `inFlight`: the terminal frame reads this job
      return s;

    default:
      return prev; // cmd_start/cmd_end/heartbeats: machinery, deliberately not projected
  }
}

export function foldEvents(seed: RunFeedState, events: RunEvent[]): RunFeedState {
  return events.reduce(foldEvent, seed);
}

/** The AUDIT LINE, derived from the slots that have landed — never a literal. `code_rendered`
 *  slots are counted separately because they cost nothing and were never model-audited. */
/**
 * V2.7b C9 — is interpretation actually happening? The held moment used to claim "interpretation is
 * already underway below" unconditionally, which is false in the shipping configuration:
 * the chain can be disarmed (`NADI_AUTO_ENRICH=0`; it was off by default until C10b),
 * and behind the modal the run card then shows `voices —` beside manual enrich buttons.
 *
 * The discriminator is the fold's own stage set: a stage is STARTED when its status is one a stage
 * can only reach by running — `running`, `done`, `partial`, `failed`. `pending` is not started, and
 * neither is `skipped`: that is the status `run_ledger.end()` stamps on every stage that NEVER RAN,
 * and it reaches this fold through the terminal-edge ledger re-read (useRunFeed), which merges the
 * ledger's statuses in the instant `run_ended` folds.
 *
 * V2.7d FOLLOW-UP — THE PREMISE THIS ONCE RESTED ON DIED AT C10b, AND THE PINS DID NOT NOTICE. The
 * first version counted any non-`pending` status as started, on the premise that "the no-chain
 * path writes NO stage events and the ledger's reason never reaches the client live". Both halves
 * were false by the time it shipped: the chain-off path DOES write a stage event (`stage_end
 * stage="results"` for the facts-only document — harmless here, it has no stage key in
 * `STATE_TO_KEYS` and folds to a no-op) and the ledger's `ended.reason` DOES reach the client (the
 * C10b re-read copies it into `ended.detail`) — and so do six `skipped` statuses, which flipped the
 * footer to "already underway" on every chain-off run one paint after it had said the truth. The
 * three footer pins stayed green through it because they mocked a null ledger and a lone
 * `run_ended` line: a pin that mocks a premise cannot detect the premise dying. The chain-off pin
 * now replays the real emission over the real ledger (act-one.spec, with test_stage_runner pinning
 * the same literal sequence server-side). `ended.detail === "interpretation not requested"` is an
 * available positive signal and deliberately NOT used: a cross-language string coupling for a fact
 * the stage set already carries.
 *
 *   'running'  a stage is or was actually running, so something started.
 *   'none'     the run ended having started none.
 *   'unknown'  neither yet — the facts-only window between the physics finishing and the chain's
 *              first stage. Real, brief, and NOT worth guessing about on screen.
 */
export type ChainState = 'running' | 'none' | 'unknown';

/** The statuses a stage can only reach by RUNNING. `skipped` is a ledger verdict ("never ran"),
 *  not a start — V2.7f C2 exports the set so the Act II rail's follow fallback and its per-card
 *  count key on the same fact as the chain discriminator, instead of on `!== 'pending'`. */
export const STAGE_STARTED: ReadonlySet<StageStatus> = new Set(['running', 'done', 'partial', 'failed']);

export function chainState(state: RunFeedState): ChainState {
  if (state.stages.some((s) => STAGE_STARTED.has(s.status))) return 'running';
  return state.ended ? 'none' : 'unknown';
}

export function auditTally(slots: SlotState[]): {
  clean: number; corrected: number; unresolved: number; codeRendered: number;
} {
  return {
    clean: slots.filter((s) => s.status === 'clean').length,
    corrected: slots.filter((s) => s.status === 'resolved_on_retry').length,
    unresolved: slots.filter((s) => s.status === 'failed').length,
    codeRendered: slots.filter((s) => s.status === 'code_rendered').length,
  };
}

/**
 * Is the run over? The client's half of the STATE-DRIVEN terminal rule (python/src/run_events.py).
 * A crash mid-chain leaves no `run_ended` line, so a projection that waited for one would tail
 * forever. Terminal run-state with no ending line IS an ending — it just isn't a labeled one, and
 * `endedByState` says which case a reader is looking at.
 */
export function resolveEnding(
  state: RunFeedState,
  runStatus: { status?: string } | null,
): RunFeedState {
  if (state.ended) return state;
  const terminal = runStatus?.status === 'done' || runStatus?.status === 'failed';
  if (!terminal) return state;
  return { ...state, endedByState: true };
}
