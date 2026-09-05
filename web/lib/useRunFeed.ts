/**
 * V2.7b C3 — THE RUN FEED: one owner for a run's status poll and its event stream.
 *
 * Both used to live inside `RunCard`, which mounts only in the Build stage. That was fine while the
 * only thing watching a run was the card beside the editor; it is not fine now. The run experience
 * lives in Watch, the document reads results in Read, and a planner who switches stages mid-run must
 * not silently stop the machinery that is narrating it. Lifting the poll and the stream into a hook
 * MapView owns makes the feed outlive any one panel.
 *
 * C3 IS A LIFT, NOT A CHANGE. The poll cadence, the request-per-poll count, the 404 latch, the
 * backoff, the done-edge, the stream's open/close moments and its degrade rules are all carried over
 * exactly. This matters concretely: three specs mock `/status` as a CALL-COUNT SEQUENCED machine
 * (`edit.spec`, `seeds.spec`, `enrich-stream.spec`), and `enrich-stream.spec` also indexes its events
 * route by call number — so an extra consumer, a faster cadence, or a double-open would break proofs
 * that have nothing to do with this refactor. The feed therefore runs on exactly the condition that
 * used to mount RunCard: `activeRunId != null`. Widening past that is a later commit's business, in
 * a commit that owns the consequences.
 *
 * It also REPLACES RunCard's `/status` consumer rather than joining it — MapView's liveIdentity
 * effect already reads `/api/runs` instead of `/status` for exactly this reason (V2.7a-F2's scar).
 *
 * The hook has no `key={runId}` remount to reset it, which was RunCard's only reset mechanism. Every
 * per-run field is therefore reset explicitly when the id changes.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { getLedger, getRunStatus, type EnrichStage, type RunStatus } from './api';
import { STATIC_DEMO } from './demo';
import { openRunStream, type RunEvent, type VoiceEvent } from './runStream';
import { emptyFeedState, foldEvent, resolveEnding, seedFromLedger,
         type Ledger, type RunFeedState } from './runFeed';

const POLL_MS = 1500;

export interface RunFeed {
  /** The last polled status — the single source for every chip, rail and number RunCard renders. */
  status: RunStatus | null;
  /** The run id isn't in the state store. It won't self-heal, so polling stopped (S6). */
  notFound: boolean;
  /** Live counts from the stream: `{done, total}` for voices, `label` for coarser stages. */
  streamProgress: { done?: number; total?: number; label?: string } | null;
  /** The stream is gone for good; the poll (which never stopped) carries the counts. LABELED in UI. */
  streamDegraded: boolean;
  /** An enrich POST succeeded: restart the terminal-stopped poll and re-open the stream. */
  enrichLaunched: (stage: EnrichStage) => void;
  /** Merge a locally-known status change (the identity save — the poll has stopped on a done run). */
  mergeStatus: (patch: Partial<RunStatus>) => void;
  /** V2.7b C7 — THE PROJECTION. The run experience as a fold over the ledger + the events file, so
   *  a reload mid-run rebuilds the same screen instead of an empty one. */
  experience: RunFeedState;
}

export interface RunFeedHandlers {
  /** The run reached `done` — load its artifact. Fires on the EDGE into done, per run and per enrich. */
  onLoaded?: (runId: string) => void;
  /** One streamed voice, in completion order. */
  onVoice?: (runId: string, v: VoiceEvent) => void;
  /** Every content event in file order, deduped — the fold's input (consumed from C7). */
  onEvent?: (runId: string, ev: RunEvent, id: number) => void;
}

export function useRunFeed(runId: string | null, h: RunFeedHandlers): RunFeed {
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [nonce, setNonce] = useState(0); // bump to restart polling after launching an enrich
  const [streamProgress, setStreamProgress] =
    useState<{ done?: number; total?: number; label?: string } | null>(null);
  const [streamDegraded, setStreamDegraded] = useState(false);
  const [experience, setExperience] = useState<RunFeedState>(() => emptyFeedState(runId));

  const lastStage = useRef<string | null>(null);
  const streamClose = useRef<(() => void) | null>(null);
  // The current job's stream reached its terminal frame. Without this, the reconnect effect would
  // re-open the finished stream every render until the POLL sees done (the status stays enrich:* for
  // up to a poll tick after the run ends) — an open/replay/close loop. Reset when a new enrich launches.
  const streamEnded = useRef(false);
  const handlers = useRef(h);
  useEffect(() => {
    handlers.current = h;
  }, [h]);

  // The reset RunCard used to get free from `key={activeRunId}`. It runs BEFORE the poll effect
  // below on a run-id change (declaration order), so a new run never inherits the previous run's
  // stage memory, stream dedup floor, or degrade flag.
  useEffect(() => {
    setStatus(null);
    setNotFound(false);
    setStreamProgress(null);
    setStreamDegraded(false);
    setExperience(emptyFeedState(runId));
    // NOT setNonce(0): the poll effect keys on [runId, nonce], so resetting the counter here would
    // schedule a SECOND immediate poll for the new run on any swap that followed an enrich - an
    // extra /status request, which is exactly what breaks a call-count-sequenced mock. The run-id
    // change already re-runs that effect; the counter only ever needs to move forward.
    lastStage.current = null;
    streamEnded.current = false;
    streamClose.current?.();
    streamClose.current = null;
  }, [runId]);

  // Seed the projection from the DURABLE half. A run whose events file was pruned (7 days) still
  // renders its honest end state from the ledger; the events then fill in the live detail. A run
  // with NO ledger is the normal case for everything before V2.7b and every CLI run — it is not an
  // error and paints nothing.
  useEffect(() => {
    if (!runId || STATIC_DEMO) return;
    let cancelled = false;
    void (async () => {
      const res = await getLedger(runId);
      if (cancelled || !res.ok || !res.value.ledger) return;
      setExperience((prev) => {
        // seed UNDER whatever the stream already folded: events are the fresher truth
        const seeded = seedFromLedger(res.value.ledger as Ledger, runId);
        return prev.beats.length || prev.voices.length ? prev : seeded;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    // No run, or no backend to ask: the static demo serves pre-computed files and has no API, so
    // polling it would retry a refused connection forever behind a screen that is working fine.
    if (!runId || STATIC_DEMO) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const res = await getRunStatus(runId);
      if (stop) return;
      if (!res.ok) {
        // 404 = the run_id isn't in the state store; it won't self-heal → stop polling (S6).
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        timer = setTimeout(tick, POLL_MS * 2); // transient/backend-down: back off, keep trying
        return;
      }
      const st = res.value;
      setStatus(st);
      setNotFound(false);
      // The client half of the STATE-DRIVEN terminal rule: a crash mid-chain leaves no run_ended
      // line, and a projection waiting for one would tail forever.
      setExperience((prev) => resolveEnding(prev, st));
      const terminal = st.status === 'done' || st.status === 'failed';
      // Fire the refresh on the edge INTO done (covers the initial run and each enrich).
      if (st.stage === 'done' && lastStage.current !== 'done') handlers.current.onLoaded?.(runId);
      lastStage.current = st.stage;
      if (!terminal) timer = setTimeout(tick, POLL_MS);
    };
    void tick();

    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, nonce]);

  // V2.3a — open the SSE stream (idempotent; the server replays from line 0 so a late open loses
  // nothing). The stream is ADDITIVE: closing/degrading never touches the poll loop.
  const openStream = useCallback(() => {
    if (!runId || STATIC_DEMO) return;
    if (streamClose.current) return; // already open
    setStreamDegraded(false);
    streamClose.current = openRunStream(runId, {
      onVoice: (v) => handlers.current.onVoice?.(runId, v),
      onEvent: (ev, id) => {
        setExperience((prev) => foldEvent(prev, ev));
        handlers.current.onEvent?.(runId, ev, id);
      },
      onProgress: (p) => setStreamProgress((prev) => ({ ...prev, ...p })),
      onTerminal: () => {
        streamClose.current = null;
        streamEnded.current = true;
      },
      onDegrade: () => {
        streamClose.current = null;
        setStreamDegraded(true); // labeled degradation — the poll (still running) carries the counts
      },
    });
  }, [runId]);

  const enriching = (status?.stage ?? '').startsWith('enrich:');
  // V2.7b C7 — the stream now opens for ANY non-terminal run, not only an enriching one. Act I's
  // beats are emitted during the quant stages (baseline/scenario/analysis), so a stream that waited
  // for `enrich:*` would miss the entire first act — the run would narrate itself to nobody.
  //
  // A TERMINAL run opens nothing: its durable half is the ledger, and its events file may legally
  // not exist at all (pruned at 7 days, or never written for a CLI run). Not opening is what makes
  // the done-run 404 silent by construction rather than by a suppression rule.
  const watchable = status != null && status.status !== 'done' && status.status !== 'failed';

  // Page-reload reconnect: a feed that finds the run still live re-opens the stream — replay-from-0
  // restores everything (and re-delivers voices; the fold dedups by index).
  useEffect(() => {
    if (watchable && !streamDegraded && !streamEnded.current) openStream();
  }, [watchable, streamDegraded, openStream]);

  // Unmount / run swap: close the EventSource.
  useEffect(
    () => () => {
      streamClose.current?.();
      streamClose.current = null;
    },
    [runId],
  );

  const enrichLaunched = useCallback(
    (stage: EnrichStage) => {
      lastStage.current = `enrich:${stage}`; // so the next `done` edge re-fires onLoaded
      setNonce((n) => n + 1); // restart polling for the enrich run
      setStreamProgress(null); // a fresh job — never show a previous stage's counts
      streamEnded.current = false;
      openStream(); // open immediately (stage_start is already on disk — the POST wrote it synchronously)
    },
    [openStream],
  );

  const mergeStatus = useCallback((patch: Partial<RunStatus>) => {
    setStatus((s) => (s ? { ...s, ...patch } : s));
  }, []);

  return { status, notFound, streamProgress, streamDegraded, enrichLaunched, mergeStatus, experience };
}
