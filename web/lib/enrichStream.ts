/**
 * V2.3a — the enrich SSE client: a thin typed wrapper over EventSource for
 * GET /api/runs/<id>/enrich/stream.
 *
 * Reconnect model (deliberately simple — no fragile resume state): the server's `id:` is the events
 * file's absolute line number, so the browser's NATIVE auto-reconnect + Last-Event-ID replay is the
 * resume path; we dedup by lastEventId (a full replay-from-0 after a stale id is idempotent) and reset
 * the dedup on `job_start` (a re-enrich truncates the file — job_start is line 0 of every fresh file).
 * When the browser gives up (readyState CLOSED after a non-200 reconnect — e.g. the server restarted
 * and 404s), we call onDegrade() ONCE: the caller's poll loop never stopped, so the UI falls back to
 * polled progress. Streaming is transport, not content — the done-edge artifact reload stays authoritative.
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

export interface StreamHandlers {
  onVoice?: (v: VoiceEvent) => void;
  /** Progress for the RunCard line: voice counts and/or the current sub-command label. */
  onProgress?: (p: { done?: number; total?: number; label?: string }) => void;
  /** Terminal event received (ok = job_done, !ok = job_failed). The stream is closed after this. */
  onTerminal?: (ok: boolean) => void;
  /** The stream is gone for good (server refused the reconnect). Poll remains the backstop. */
  onDegrade?: () => void;
}

/** Open the enrich stream for a run. Returns a close function (idempotent). */
export function openEnrichStream(runId: string, h: StreamHandlers): () => void {
  const es = new EventSource(`${API_BASE}/api/runs/${runId}/enrich/stream`);
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

  es.addEventListener('job_start', (e) => {
    if (closed) return;
    // A NEW job truncated the file: this frame is line 0 — reset so replayed lines aren't dropped.
    lastSeen = Number((e as MessageEvent).lastEventId) || 0;
  });

  es.addEventListener('voices_total', (e) => {
    if (closed || !fresh(e as MessageEvent)) return;
    const d = JSON.parse((e as MessageEvent).data) as { total?: number };
    h.onProgress?.({ total: d.total });
  });

  es.addEventListener('voice', (e) => {
    if (closed || !fresh(e as MessageEvent)) return;
    const d = JSON.parse((e as MessageEvent).data) as VoiceEvent & { event: string };
    h.onProgress?.({ done: d.done, total: d.total });
    h.onVoice?.({ index: d.index, done: d.done, total: d.total, agent: d.agent });
  });

  es.addEventListener('cmd_start', (e) => {
    if (closed || !fresh(e as MessageEvent)) return;
    const d = JSON.parse((e as MessageEvent).data) as { label?: string };
    h.onProgress?.({ label: d.label });
  });

  const terminal = (ok: boolean) => (e: Event) => {
    if (closed || !fresh(e as MessageEvent)) return;
    close();
    h.onTerminal?.(ok);
  };
  es.addEventListener('job_done', terminal(true));
  es.addEventListener('job_failed', terminal(false));

  es.onerror = () => {
    if (closed) return;
    // CONNECTING = the native auto-reconnect is in flight (Last-Event-ID rides it) — let it work.
    // CLOSED = the browser gave up (non-200 on reconnect, e.g. 404 after a server restart): degrade.
    if (es.readyState === EventSource.CLOSED) {
      close();
      h.onDegrade?.();
    }
  };

  return close;
}
