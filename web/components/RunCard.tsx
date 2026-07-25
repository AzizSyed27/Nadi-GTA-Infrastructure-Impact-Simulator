'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getRunStatus, postEnrich, type EnrichStage, type RunStatus } from '@/lib/api';
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
 */
export function RunCard({ runId, onLoaded }: { runId: string; onLoaded: (runId: string) => void }) {
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [enrichBusy, setEnrichBusy] = useState<EnrichStage | null>(null);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0); // bump to restart polling after launching an enrich
  const lastStage = useRef<string | null>(null);
  const onLoadedRef = useRef(onLoaded);
  // Keep the callback ref fresh without re-running the polling effect. (Parent remounts this component per
  // runId via `key`, so no explicit per-run reset effect is needed — a fresh mount clears all state.)
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  }, [onLoaded]);

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
    },
    [runId],
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
  const enriching = stage.startsWith('enrich:');
  const isNewRoad = status?.change?.type === 'new_road';
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

  // V2.2c — the windowed-change chip ("2 lane(s) closed 07:15–09:00"), mechanical from the change
  // dict + the run's demand profile (clock times on calibrated, t=0 == 07:00).
  const chWindow = status?.change?.window as { start_s: number; end_s: number } | undefined;
  const chType = status?.change?.type;
  const chLanes = (status?.change?.target_lanes as number[] | undefined)?.length ?? 0;
  const chEffect = status?.change?.effect as { blocked?: boolean; speed_factor?: number } | undefined;
  const windowChip = chWindow
    ? chType === 'lane_closure'
      ? `${chLanes} lane(s) closed ${fmtWindowRange(chWindow, status?.demand_profile)}`
      : chType === 'road_closure'
        ? `road closed ${fmtWindowRange(chWindow, status?.demand_profile)}`
        : chType === 'incident'
          ? `incident ${fmtWindowRange(chWindow, status?.demand_profile)}${chEffect?.blocked ? ` · ${chLanes} lane(s) blocked` : ''}${chEffect?.speed_factor != null ? ` · slowed to ${Math.round(chEffect.speed_factor * 100)}%` : ''}`
          : `active ${fmtWindowRange(chWindow, status?.demand_profile)}`
    : null;

  // V2.2c — non-completions as a first-class number for capacity runs; the split's labels are
  // causally NEUTRAL ("not inserted" — the report carries the backlog attribution context).
  const ncTotal = status?.non_completions
    ? Object.values(status.non_completions).reduce((a, b) => a + b, 0)
    : null;
  const ncSplitCar = status?.non_completions_split?.car;
  const nonCompletionsLine =
    ncTotal != null && ncTotal > 0
      ? ncSplitCar
        ? `${status!.non_completions!.car} cars did not complete (${ncSplitCar.entered_not_finished} stranded en route, ${ncSplitCar.not_inserted} not inserted)`
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
  const responseLine = rd
    ? rdWorst != null
      ? `+${rdWorst.toFixed(0)} s response-route estimate (${rd.probes.length} probes${
          rdNoNumber.length ? `, ${rdNoNumber.length} not computable — see the report` : ''
        })`
      : rdNoNumber.length
        ? `response route not computable for any probe — see the report (${rd.probes.length} probes)`
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
      {windowChip && (
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

      {enriching && <div style={enrichNote} data-testid="enrich-running">Enriching: {stage.replace('enrich:', '')}…</div>}
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
