/**
 * V2.3a/V2.7b — the RUN event SSE client: a thin typed wrapper over EventSource for
 * GET /api/runs/<id>/events.
 *
 * Reconnect model (deliberately simple — no fragile resume state): the server's `id:` is the events
 * file's absolute line number, so the browser's NATIVE auto-reconnect + Last-Event-ID replay is the
 * resume path; we dedup by lastEventId (a full replay-from-0 after a stale id is idempotent) and reset
 * the dedup on `run_start` (a fresh run truncates the file — run_start is line 0 of every fresh file).
 * When the browser gives up (readyState CLOSED after a non-200 reconnect — e.g. the server restarted
 * and 404s), we call onDegrade() ONCE: the caller's poll loop never stopped, so the UI falls back to
 * polled progress. Streaming is transport, not content — the artifact reload stays authoritative.
 *
 * CLOSING IS CONTROL, NOT CONTENT (the V2.7b rule, mirrored from python/src/run_events.py). V2.3a
 * closed on a `job_done` LINE. The events file is now per-RUN and never truncated mid-run, so a skip
 * writes a `run_ended` line that a later resume appends AFTER — closing on that line would make the
 * run unreplayable past its first ending. The server decides end-of-stream from the run's actual state
 * and sends a synthesized `stream_end` frame that is never a file line; `run_ended` is content the
 * caller reads to learn HOW the run ended.
 */

import type { Agent } from './types';
import { API_BASE } from './api';

export interface VoiceEvent {
  /** Position in the final artifact's agents[] order — the dedup/reorder key. */
  index: number;
  done: number;
  total: number;
  agent: Agent;
}

/** Every event name the server can put in the file. The generic tap subscribes to each: EventSource
 *  has no wildcard, and `onmessage` never fires because every frame carries an explicit `event:`. */
export const RUN_EVENT_NAMES = [
  // lifecycle
  'run_start', 'stage_start', 'stage_end', 'cmd_start', 'cmd_end', 'run_ended',
  // ACT I (V2.7b C4): the beats, and what the map can play while the scenario leg computes
  'beat', 'baseline_ready', 'baseline_unavailable', 'results_ready',
  // ACT II (V2.7b C5/C6): streamed content and the ledger's inputs
  'personas', 'voices_total', 'voice', 'institutions',
  'slot_start', 'slot_landed', 'index_progress', 'stage_usage',
  'stage_partial',
] as const;
// EventSource dispatches BY NAME — there is no wildcard, and `onmessage` never fires because every
// frame carries an explicit `event:`. A name missing from this list is silently never delivered,
// which is exactly how C1's list (written before the Act I/II events existed) swallowed every beat.
// Anything the server can emit belongs here.

export type RunEventName = (typeof RUN_EVENT_NAMES)[number];

export interface RunEvent {
  event: string;
  ts: number;
  [k: string]: unknown;
}

export interface StreamHandlers {
  onVoice?: (v: VoiceEvent) => void;
  /** Progress for the RunCard line: voice counts and/or the current sub-command label. */
  onProgress?: (p: { done?: number; total?: number; label?: string }) => void;
  /** The stream closed because the run is over (ok = the run's state is done, !ok = failed). */
  onTerminal?: (ok: boolean) => void;
  /** The stream is gone for good (server refused the reconnect). Poll remains the backstop. */
  onDegrade?: () => void;
  /** Every content event, in file order, deduped — the fold's input (V2.7b). */
  onEvent?: (ev: RunEvent, id: number) => void;
}

/** Open the run event stream. Returns a close function (idempotent). */
export function openRunStream(runId: string, h: StreamHandlers): () => void {
  const es = new EventSource(`${API_BASE}/api/runs/${runId}/events`);
  let lastSeen = -1; // highest event id processed; native reconnect replays can overlap
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    es.close();
  };

  /** Dedup gate shared by every listener: skip already-seen ids (reconnect replay overlap). */
  const fresh = (e: MessageEvent): boolean => {
    const id = Number(e.lastEventId);
    if (!Number.isFinite(id) || id <= lastSeen) return false;
    lastSeen = id;
    return true;
  };

  // The generic tap runs FIRST for every event name (listeners fire in registration order), so the
  // typed handlers below can rely on the dedup already having advanced — hence they re-check ids
  // themselves only where they were registered before the tap (run_start).
  for (const name of RUN_EVENT_NAMES) {
    es.addEventListener(name, (e) => {
      if (closed) return;
      const me = e as MessageEvent;
      const id = Number(me.lastEventId);
      if (name === 'run_start') {
        // A NEW run truncated the file: this frame is line 0 — reset so replayed lines aren't dropped.
        lastSeen = Number.isFinite(id) ? id : 0;
      } else if (!fresh(me)) {
        return;
      }
      const d = JSON.parse(me.data) as RunEvent;
      h.onEvent?.(d, Number.isFinite(id) ? id : -1);
      if (name === 'voices_total') {
        h.onProgress?.({ total: d.total as number | undefined });
      } else if (name === 'voice') {
        const v = d as unknown as VoiceEvent;
        h.onProgress?.({ done: v.done, total: v.total });
        h.onVoice?.({ index: v.index, done: v.done, total: v.total, agent: v.agent });
      } else if (name === 'cmd_start') {
        h.onProgress?.({ label: d.label as string | undefined });
      }
    });
  }

  // CONTROL frame, never a file line: the server has drained the file and the run is provably over.
  es.addEventListener('stream_end', (e) => {
    if (closed) return;
    const d = JSON.parse((e as MessageEvent).data) as { status?: string };
    close();
    h.onTerminal?.(d.status !== 'failed');
  });

  let failures = 0; // consecutive errors without a successful open — see the CONNECTING-limbo note
  es.onopen = () => {
    failures = 0;
  };
  es.onerror = () => {
    if (closed) return;
    // CONNECTING = the native auto-reconnect is in flight (Last-Event-ID rides it) — let it work.
    // CLOSED = the browser gave up (non-200 on reconnect, e.g. 404 after a server restart): degrade.
    if (es.readyState === EventSource.CLOSED) {
      close();
      h.onDegrade?.();
      return;
    }
    // A NETWORK-level failure (connection refused, an SSE-hostile proxy) never reaches CLOSED — the
    // browser retries CONNECTING forever while the UI would keep painting the last stream counts with
    // no label. Degradation must be labeled, never silent: give the retry loop 3 consecutive failures
    // (onopen resets the count), then close it ourselves and fall back to the poll.
    failures += 1;
    if (failures >= 3) {
      close();
      h.onDegrade?.();
    }
  };

  return close;
}
