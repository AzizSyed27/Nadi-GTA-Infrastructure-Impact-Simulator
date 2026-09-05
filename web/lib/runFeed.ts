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
}

export function emptyFeedState(runId: string | null = null): RunFeedState {
  return {
    runId,
    beats: [], demand: null, demandProfile: null,
    baselineUrl: null, baselineUnavailable: null, resultsReadyAt: null,
    stages: STAGE_KEYS.map((key) => ({
      key, label: STAGE_LABEL[key], status: 'pending' as StageStatus, calls: null, detail: '',
    })),
    voices: [], voicesTotal: null,
    institutionsSpoke: [], institutionsSilent: [],
    slots: [], indexDocs: null,
    ended: null, endedByState: false,
    llmCallsTotal: 0, projection: null,
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
  if (ledger.ended) base.ended = { status: ledger.ended.status, detail: ledger.ended.reason };
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
      for (const k of keys) {
        const cur = s.stages.find((x) => x.key === k);
        // a stage that never started (no content arrived) is not silently marked done
        if (cur && (cur.status === 'running' || status === 'failed')) {
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
