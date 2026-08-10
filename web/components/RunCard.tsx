'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getRunStatus, postEnrich, type EnrichStage, type RunStatus } from '@/lib/api';
import { openEnrichStream, type VoiceEvent } from '@/lib/enrichStream';
import { signedMinutes } from '@/lib/viz';
import { fmtWindowRange } from '@/lib/simTime';

// The staged progression (matches scenario_harness run-state writes). A new_road run patches the network first
// (regen); runtime changes (speed_limit / bike_lane) apply live, so they have NO regen stage — the card renders
// only the stages the run actually has. Enrich stages ('enrich:voices' etc.) are shown separately below.
const NEWROAD_STAGES = ['queued', 'regen', 'baseline', 'scenario', 'analysis', 'done'] as const;
const RUNTIME_STAGES = ['queued', 'baseline', 'scenario', 'analysis', 'done'] as const;
const STAGE_LABEL: Record<string, string> = {
  queued: 'Queued',
  regen: 'Regenerating network',
  settle_baseline: 'Settling baseline',
  settle_scenario: 'Settling scenario',
  baseline: 'Baseline run',
  scenario: 'Scenario run',
  analysis: 'Analysis',
  done: 'Done',
};
// V2.1c: settled runs iterate assignment BEFORE the micro pair — the settle stages appear on the rail
// only when the run's assignment is 'settled' (day-one rails are byte-identical to before).
const SETTLE_STAGES = ['settle_baseline', 'settle_scenario'] as const;

// Enrich buttons with cost labels pulled from the METERED actuals (approximate — the tooltip says so).
// Understating a cost-consent label is worse than none: voices ≈0.7¢, report ≈$0.05, discourse ≈$2.2 (3 cascades).
const ENRICH: { stage: EnrichStage; label: string; cost: string; tip: string }[] = [
  { stage: 'voices', label: 'voices', cost: '~1¢', tip: 'Sample persona reactions. Approx cost ~1¢ per run.' },
  { stage: 'report', label: 'report', cost: '$', tip: 'Generate the per-run report. Approx cost ~$0.05.' },
  { stage: 'discourse', label: 'discourse', cost: '$$', tip: 'Run the 3-cascade social propagation. Approx cost ~$2.' },
];

const POLL_MS = 1500;

/**
 * Watches one run through its staged pipeline, then offers enrichment. Polls GET /api/runs/<id>/status;
 * on each transition into `done` it calls `onLoaded(runId)` so the parent re-fetches `/<runId>.json`
 * (a fresh run → scorecard; after voices → the feed; after discourse → discourse unlocks). One job at a
 * time is enforced server-side; a 409 on an enrich click surfaces inline.
 *
 * V2.3a: during an enrich the card ALSO opens the SSE stream — live counts ("voices 47/212") replace
 * dead air, and per-voice events flow up via `onVoice` so the feed renders incrementally. The poll loop
 * is untouched and remains the backstop: if the stream dies for good a labeled note says so and the
 * polled `enrich_progress` carries the counts. The done-edge reload stays the authoritative swap.
 */
export function RunCard({
  runId,
  onLoaded,
  onVoice,
}: {
  runId: string;
  onLoaded: (runId: string) => void;
  onVoice?: (runId: string, v: VoiceEvent) => void;
}) {
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [enrichBusy, setEnrichBusy] = useState<EnrichStage | null>(null);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0); // bump to restart polling after launching an enrich
  const [streamProgress, setStreamProgress] = useState<{ done?: number; total?: number; label?: string } | null>(null);
  const [streamDegraded, setStreamDegraded] = useState(false);
  const lastStage = useRef<string | null>(null);
  const streamClose = useRef<(() => void) | null>(null);
  // The current job's stream reached its terminal frame. Without this, the reconnect effect would
  // re-open the finished stream every render until the POLL sees done (the status stays enrich:* for
  // up to a poll tick after job_done) — an open/replay/close loop. Reset when a new enrich launches.
  const streamEnded = useRef(false);
  const onLoadedRef = useRef(onLoaded);
  const onVoiceRef = useRef(onVoice);
  // Keep the callback refs fresh without re-running the polling effect. (Parent remounts this component per
  // runId via `key`, so no explicit per-run reset effect is needed — a fresh mount clears all state.)
  useEffect(() => {
    onLoadedRef.current = onLoaded;
    onVoiceRef.current = onVoice;
  }, [onLoaded, onVoice]);

  useEffect(() => {
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
      const terminal = st.status === 'done' || st.status === 'failed';
      // Fire the refresh on the edge INTO done (covers the initial run and each enrich).
      if (st.stage === 'done' && lastStage.current !== 'done') onLoadedRef.current(runId);
      if (terminal) setEnrichBusy(null); // clear on done OR failed — else the buttons stay stuck disabled (B1)
      lastStage.current = st.stage;
      if (!terminal) timer = setTimeout(tick, POLL_MS);
    };
    tick();

    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, nonce]);

  // V2.3a — open the SSE stream (idempotent; the server replays from line 0 so a late open loses
  // nothing). The stream is ADDITIVE: closing/degrading never touches the poll loop.
  const openStream = useCallback(() => {
    if (streamClose.current) return; // already open
    setStreamDegraded(false);
    streamClose.current = openEnrichStream(runId, {
      onVoice: (v) => onVoiceRef.current?.(runId, v),
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

  // Page-reload reconnect: a freshly-mounted card that finds the run already enriching re-opens the
  // stream — replay-from-0 restores the counts (and re-delivers voices; the parent dedups by index).
  useEffect(() => {
    if (enriching && !streamDegraded && !streamEnded.current) openStream();
  }, [enriching, streamDegraded, openStream]);

  // Unmount: close the EventSource (the per-runId `key` remount makes this the only cleanup needed).
  useEffect(
    () => () => {
      streamClose.current?.();
      streamClose.current = null;
    },
    [],
  );

  const runEnrich = useCallback(
    async (stage: EnrichStage) => {
      setEnrichError(null);
      setEnrichBusy(stage);
      const res = await postEnrich(runId, stage);
      if (!res.ok) {
        setEnrichBusy(null);
        setEnrichError(res.error);
        return;
      }
      lastStage.current = `enrich:${stage}`; // so the next `done` edge re-fires onLoaded
      setNonce((n) => n + 1); // restart polling for the enrich run
      setStreamProgress(null); // a fresh job — never show a previous stage's counts
      streamEnded.current = false;
      openStream(); // open immediately (job_start is already on disk — the POST wrote it synchronously)
    },
    [runId, openStream],
  );

  if (notFound && !status) {
    return (
      <div style={card} data-testid="run-card">
        <div style={title}>Run not found</div>
        <div style={sub}>{runId}</div>
      </div>
    );
  }

  const stage = status?.stage ?? 'queued';
  const failed = status?.status === 'failed';
  const done = status?.stage === 'done';
  // V2.4b: composites carry `changes` (plural) in run-state; the singular `change` (= members[0],
  // the back-compat field) is only trustworthy alone on single-change runs.
  const members = status?.changes ?? (status?.change ? [status.change] : []);
  const isNewRoad = members[0]?.type === 'new_road';

  // V2.3a — live enrich progress: stream counts while it's up; the polled derivation once degraded.
  // Counts ("47/212") beat the sub-command label; the label alone covers report/discourse.
  const prog = streamDegraded ? status?.enrich_progress : (streamProgress ?? status?.enrich_progress);
  const enrichProgressText =
    prog?.total != null ? `${prog.done ?? 0}/${prog.total}` : (prog?.label ?? '');
  const baseStages: readonly string[] = isNewRoad ? NEWROAD_STAGES : RUNTIME_STAGES; // runtime: NO regen
  const STAGES =
    status?.assignment === 'settled'
      ? [...baseStages.slice(0, baseStages.indexOf('baseline')), ...SETTLE_STAGES,
         ...baseStages.slice(baseStages.indexOf('baseline'))]
      : baseStages;
  const activeIdx = STAGES.indexOf(stage);

  // THE number, framed honestly: for a runtime lane/speed change 0-reroute is expected — cars absorb it as
  // delay, not detour (the 2.2 finding) — so surface the car delay alongside so 0 doesn't read as failure.
  const rer = status?.cars_rerouted ?? 0;
  const rerouteLabel = isNewRoad
    ? `${rer} ${rer === 1 ? 'car' : 'cars'} rerouted onto the new road`
    : rer === 0
      ? '0 rerouted — absorbed as delay'
      : `${rer} ${rer === 1 ? 'car' : 'cars'} rerouted`;
  const cm = status?.car_median_delta_s;
  const cs = status?.car_affected_share;
  const carDelay =
    cm != null ? `car median ${signedMinutes(cm)}${cs != null ? ` · ${Math.round(cs * 100)}% materially affected` : ''}` : null;

  const demandChip =
    status?.demand_profile === 'calibrated_am_peak'
      ? 'calibrated AM peak (07:00–09:00, count-anchored)'
      : status?.demand_profile === 'synthetic_demo'
        ? 'synthetic demo demand'
        : null;

  // V2.2d — the school-zone chip (composite runs tagged school_zone): street count + the shared
  // window range. Mechanical, no asserted benefit. Falls back silently for untagged runs.
  const zoneChanges = (status?.tags?.includes('school_zone') && status?.changes) || [];
  const zoneWindows = zoneChanges
    .map((c) => c.window)
    .filter((w): w is { start_s: number; end_s: number } => w != null);
  const zoneChip = zoneChanges.length
    ? `School zone · ${zoneChanges.length} street${zoneChanges.length === 1 ? '' : 's'}${
        zoneWindows.length
          ? ` · ${fmtWindowRange(
              {
                start_s: Math.min(...zoneWindows.map((w) => w.start_s)),
                end_s: Math.max(...zoneWindows.map((w) => w.end_s)),
              },
              status?.demand_profile,
            )}`
          : ''
      }`
    : null;

  // V2.2c — the windowed-change chip ("2 lane(s) closed 07:15–09:00"), mechanical from the change
  // dict + the run's demand profile (clock times on calibrated, t=0 == 07:00). V2.4b: SINGLE-change
  // runs only — describing an N-member composite by member 0 silently misrepresented the run.
  const chWindow = members[0]?.window as { start_s: number; end_s: number } | undefined;
  const chType = members[0]?.type;
  const chLanes = (members[0]?.target_lanes as number[] | undefined)?.length ?? 0;
  const chEffect = members[0]?.effect as { blocked?: boolean; speed_factor?: number } | undefined;
  const windowChip = members.length === 1 && chWindow
    ? chType === 'lane_closure'
      ? `${chLanes} lane(s) closed ${fmtWindowRange(chWindow, status?.demand_profile)}`
      : chType === 'road_closure'
        ? `road closed ${fmtWindowRange(chWindow, status?.demand_profile)}`
        : chType === 'incident'
          ? `incident ${fmtWindowRange(chWindow, status?.demand_profile)}${chEffect?.blocked ? ` · ${chLanes} lane(s) blocked` : ''}${chEffect?.speed_factor != null ? ` · slowed to ${Math.round(chEffect.speed_factor * 100)}%` : ''}`
          : `active ${fmtWindowRange(chWindow, status?.demand_profile)}`
    : null;

  // V2.4b — the untagged-composite chip: member count + the SPANNING active window. Mechanical;
  // the per-member truth lives in the report/ScenarioHeader. Zone-tagged runs keep their zone chip.
  const memberWindows = members
    .map((c) => c.window as { start_s: number; end_s: number } | undefined)
    .filter((w): w is { start_s: number; end_s: number } => w != null);
  const compositeChip =
    members.length > 1
      ? `${members.length} changes${
          memberWindows.length
            ? ` · active ${fmtWindowRange(
                { start_s: Math.min(...memberWindows.map((w) => w.start_s)),
                  end_s: Math.max(...memberWindows.map((w) => w.end_s)) },
                status?.demand_profile,
              )}`
            : ''
        }`
      : null;

  // V2.2c — non-completions as a first-class number for capacity runs; the split's labels are
  // causally NEUTRAL ("not inserted"). Per-MODE and skip-zero (mirrors report.py): never hardcode
  // cars — a closure whose whole impact lands on pedestrians must not read "0 cars did not
  // complete". V2.4b: the backlog-attribution parenthetical now rides HERE too (user-ratified —
  // the V2.2c chip exemption ends; the split never renders without the attribution, any surface).
  const ncTotal = status?.non_completions
    ? Object.values(status.non_completions).reduce((a, b) => a + b, 0)
    : null;
  const ncSplit = status?.non_completions_split;
  const splitParts = ncSplit
    ? Object.entries(ncSplit)
        .filter(([, b]) => b.entered_not_finished + b.not_inserted > 0)
        .map(([m, b]) => {
          const bits = [
            b.entered_not_finished > 0 ? `${b.entered_not_finished} stranded en route` : null,
            b.not_inserted > 0 ? `${b.not_inserted} not inserted` : null,
          ].filter(Boolean);
          return `${m}: ${bits.join(', ')}`;
        })
    : [];
  const bl = status?.insertion_backlog;
  const blSums = bl
    ? Object.values(bl).reduce<[number, number]>(
        (acc, b) => [acc[0] + b.baseline, acc[1] + b.scenario], [0, 0])
    : null;
  const nonCompletionsLine =
    ncTotal != null && ncTotal > 0
      ? splitParts.length
        ? `${ncTotal} travelers did not complete — ${splitParts.join('; ')}${
            blSums
              ? ` (insertion backlog affects baseline too: ${blSums[0]} baseline vs ${blSums[1]} scenario)`
              : ''
          }`
        : `${ncTotal} travelers did not complete under the change`
      : null;

  // V2.2b — the emergency-response detour fact (capacity runs). Worst added_s leads; BOTH honesty
  // sentences render with the number (never tooltip-only). Unreachable probes surface as words.
  const rd = status?.response_detour;
  const rdComputable = rd?.probes.filter((p) => p.added_s != null) ?? [];
  // "not computable" is deliberately cause-neutral — a null added_s can mean origin unmatched,
  // unreachable in baseline, or unreachable during the window; the report carries the per-probe
  // reason. Empty probes (no routable destination) still render the labeled destination_note.
  const rdNoNumber = rd?.probes.filter((p) => p.added_s == null) ?? [];
  const rdWorst = rdComputable.length ? Math.max(...rdComputable.map((p) => p.added_s as number)) : null;
  // The single number is the MAX and says so — with several stations and a mixed spread, an
  // unlabeled number reads as "the added response time" or an average. Old sidecars without
  // `represents` fall back to "probes".
  const rdNoun = rd?.probes.length && rd.probes.every((p) => p.represents === 'fire_station') ? 'stations' : 'probes';
  const responseLine = rd
    ? rdWorst != null
      ? `worst of ${rd.probes.length} ${rdNoun}: +${rdWorst.toFixed(0)} s${
          rdNoNumber.length ? ` (${rdNoNumber.length} not computable — see the report)` : ''
        }`
      : rdNoNumber.length
        ? `response route not computable from any of the ${rd.probes.length} ${rdNoun} — see the report`
        : rd.destination_note ?? 'response detour not computable — see the report'
    : null;

  return (
    <div style={card} data-testid="run-card">
      <div style={title}>{done ? 'Run complete' : failed ? 'Run failed' : 'Running…'}</div>
      <div style={sub}>{status?.description || runId}</div>
      {demandChip && (
        <div style={{ ...sub, opacity: 0.8 }} data-testid="demand-chip">
          demand: {demandChip}
        </div>
      )}
      {status?.demand_profile === 'calibrated_am_peak' && (
        <div style={{ ...sub, opacity: 0.8 }} data-testid="comparison-validity-chip">
          absolute volumes approximate · scenario-vs-baseline is like-for-like
        </div>
      )}
      {status?.assignment === 'settled' && (
        <div style={{ ...sub, opacity: 0.8 }} data-testid="assignment-chip">
          settled response (iterated assignment, drivers only)
          {stage.startsWith('settle') && status?.detail ? ` — ${status.detail}` : ''}
        </div>
      )}
      {zoneChip && (
        <div style={{ ...sub, opacity: 0.8 }} data-testid="zone-chip">
          {zoneChip}
        </div>
      )}
      {/* the zone chip already carries the composite's window range — the untagged composite
          chip and the single-change window chip each cover their own shape */}
      {compositeChip && !zoneChip && (
        <div style={{ ...sub, opacity: 0.8 }} data-testid="composite-chip">
          {compositeChip}
        </div>
      )}
      {windowChip && !zoneChip && (
        <div style={{ ...sub, opacity: 0.8 }} data-testid="window-chip">
          {windowChip}
        </div>
      )}
      {(status?.n_seeds ?? 1) > 1 && (
        <div style={{ ...sub, opacity: 0.8 }} data-testid="seeds-chip">
          robustness probe: {status?.n_seeds} seeds (42, 43, 44)
          {(stage === 'baseline' || stage === 'scenario') && status?.detail?.startsWith('seed probe')
            ? ` — ${status.detail}`
            : ''}
        </div>
      )}

      {/* staged rail — only the stages this run actually has (runtime changes skip regen) */}
      <ol style={rail} data-testid="run-stages">
        {STAGES.map((s, i) => {
          const state = failed ? 'idle' : i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'idle';
          return (
            <li key={s} style={{ ...stageRow, ...(state === 'active' ? stageActive : null) }} data-stage={s} data-state={state}>
              <span style={{ ...dot, ...(state === 'done' ? dotDone : state === 'active' ? dotActive : null) }} />
              {STAGE_LABEL[s]}
            </li>
          );
        })}
      </ol>

      {enriching && (
        <div style={enrichNote} data-testid="enrich-running">
          Enriching: {stage.replace('enrich:', '')}…{enrichProgressText ? ` ${enrichProgressText}` : ''}
        </div>
      )}
      {enriching && streamDegraded && (
        <div style={{ ...sub, opacity: 0.85, marginTop: 4 }} data-testid="enrich-stream-degraded">
          live stream unavailable — updating by poll
        </div>
      )}
      {failed && <div style={errText} data-testid="run-failed">{status?.detail || 'the run failed'}</div>}

      {done && (
        <>
          <div style={theNumber} data-testid="reroute-number">{rerouteLabel}</div>
          {carDelay && <div style={carDelayLine} data-testid="car-delay">{carDelay}</div>}
          {nonCompletionsLine && (
            <div style={carDelayLine} data-testid="non-completions">{nonCompletionsLine}</div>
          )}
          {responseLine && rd && (
            <div style={{ ...sub, opacity: 0.85 }} data-testid="response-access-chip">
              response access: {responseLine}
              <div style={{ opacity: 0.75, fontSize: '0.85em' }}>
                {rd.framing}; {rd.lower_bound_note}
              </div>
            </div>
          )}
          <div style={enrichLabel}>Enrich this run</div>
          <div style={enrichRow} data-testid="enrich-buttons">
            {ENRICH.map((e) => (
              <button
                key={e.stage}
                style={{ ...enrichBtn, ...(enrichBusy ? enrichBtnBusy : null) }}
                title={e.tip}
                disabled={enrichBusy !== null}
                onClick={() => runEnrich(e.stage)}
                data-testid={`enrich-${e.stage}`}
              >
                {e.label} <span style={costTag}>{e.cost}</span>
              </button>
            ))}
          </div>
          {enrichError && <div style={errText} data-testid="enrich-error">{enrichError}</div>}
        </>
      )}
    </div>
  );
}

const card: React.CSSProperties = {
  flexShrink: 0,
  pointerEvents: 'auto',
  background: 'rgba(255,255,255,0.98)',
  border: '1px solid #d7dbe0',
  borderRadius: 10,
  boxShadow: '0 2px 10px rgba(0,0,0,0.14)',
  padding: '12px 14px',
  fontFamily: 'system-ui, sans-serif',
  color: '#374151',
};
const title: React.CSSProperties = { fontSize: 14, fontWeight: 700, marginBottom: 2 };
const sub: React.CSSProperties = { fontSize: 11, color: '#8a9099', marginBottom: 10, wordBreak: 'break-all' };
const rail: React.CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 5 };
const stageRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#9aa0a8' };
const stageActive: React.CSSProperties = { color: '#1f4e9c', fontWeight: 600 };
const dot: React.CSSProperties = { width: 9, height: 9, borderRadius: '50%', background: '#d4d8de', flex: '0 0 auto' };
const dotDone: React.CSSProperties = { background: '#3caa5a' };
const dotActive: React.CSSProperties = { background: '#1f4e9c' };
const enrichNote: React.CSSProperties = { marginTop: 8, fontSize: 12, color: '#1f4e9c', fontWeight: 600 };
const theNumber: React.CSSProperties = { marginTop: 10, fontSize: 13, color: '#374151', lineHeight: 1.4, fontWeight: 600 };
const carDelayLine: React.CSSProperties = { marginTop: 4, fontSize: 12, color: '#6b7280' };
const enrichLabel: React.CSSProperties = { marginTop: 12, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#8a9099' };
const enrichRow: React.CSSProperties = { marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' };
const enrichBtn: React.CSSProperties = {
  border: '1px solid #cbd3dc',
  background: '#f6f8fa',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 12,
  fontWeight: 600,
  color: '#374151',
  cursor: 'pointer',
};
const enrichBtnBusy: React.CSSProperties = { opacity: 0.5, cursor: 'default' };
const costTag: React.CSSProperties = { color: '#8a9099', fontWeight: 500, marginLeft: 3 };
const errText: React.CSSProperties = { marginTop: 8, fontSize: 12, color: '#b23a3a' };
