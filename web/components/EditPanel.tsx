'use client';

import { useState } from 'react';
import type { ChangeWindow, Junction, Edge, RunOptions } from '@/lib/api';
import type { VoiceEvent } from '@/lib/enrichStream';
import type { Agent, Scorecard } from '@/lib/types';
import { RunCard } from '@/components/RunCard';
import { RunSwitcher } from '@/components/RunSwitcher';
import { ScorecardPanel } from '@/components/ScorecardPanel';
import { EdgePalette } from '@/components/EdgePalette';
import { ZonePalette } from '@/components/ZonePalette';

export interface DrawParams {
  lanes: number;
  speed_mps: number;
  bidirectional: boolean;
}

interface EditPanelProps {
  ptA: Junction | null;
  ptB: Junction | null;
  hint: string | null;
  junctionsDown: boolean; // backend unreachable while loading snap targets → show the start-the-server hint
  submitting: boolean;
  submitError: string | null;
  onSubmit: (p: DrawParams) => void;
  onReset: () => void; // clear the in-progress draw
  // V2.1b/c run options for the NEXT submitted run (demand profile + day-one/settled assignment)
  runOptions: RunOptions;
  onRunOptions: (o: RunOptions) => void;
  activeRunId: string | null;
  onDrawAnother: () => void; // clear the active run + draw state, back to drawing
  onLoaded: (id: string) => void; // RunCard reached done → parent re-fetches the artifact
  onVoice: (id: string, v: VoiceEvent) => void; // V2.3a: a streamed voice → parent appends it to the artifact
  // V2.3a: voices streamed so far (arrival order) — the live ticker while enrich generates; cleared by
  // the parent when the done-edge reload swaps in the authoritative artifact.
  streamedVoices: Agent[];
  onLoadRun: (id: string) => void; // RunSwitcher picked a run → parent switches active run
  runLoaded: boolean; // the active run's artifact is the one currently shown (honesty flags are trustworthy)
  hasVoices: boolean;
  hasSocial: boolean;
  scorecard: Scorecard | undefined; // the active run's scorecard (shown once its artifact is loaded)
  // edit-an-edge (5.2b)
  selectedEdge: Edge | null;
  canEditEdges: boolean; // zoomed in enough that existing edges are rendered/clickable
  onEdgeSpeed: (valueMps: number) => void;
  onEdgeBike: () => void;
  onEdgeCancel: () => void;
  // V2.2c — temporary events (closures + incident) + the windowed → day_one lock
  onEdgeLaneClosure: (lanes: number[], window: ChangeWindow | null) => void;
  onEdgeRoadClosure: (window: ChangeWindow | null) => void;
  onEdgeIncident: (p: { lanes: number[]; speedFactor: number | null; window: ChangeWindow }) => void;
  onWindowedDraft: (active: boolean) => void;
  windowLocked: boolean; // a windowed draft is pending → assignment locks to day_one
  // V2.2d — the school-zone flow (zone-select mode accumulates map-clicked edges)
  zoneMode: boolean;
  zoneEdges: string[];
  onZoneToggle: () => void;
  onZoneRemove: (id: string) => void;
  onZoneSubmit: (valueMps: number, window: ChangeWindow) => void;
  onZoneCancel: () => void;
}

// RATIFIED phase-5 road defaults — a two-way, two-lane, ~50 km/h street (what a planner usually draws, and
// what 5.1's acceptance run drew). NOT the backend SimChange request defaults (lanes 1 / one-way), which stay
// conservative on the wire; the FORM presents the ratified product decision.
const DEFAULTS: DrawParams = { lanes: 2, speed_mps: 13.9, bidirectional: true };

/** The params mini-form. Keyed by the endpoint pair so each fresh draw remounts with the ratified defaults. */
function DrawForm({
  ptA,
  ptB,
  submitting,
  submitError,
  onSubmit,
  onReset,
}: {
  ptA: Junction;
  ptB: Junction;
  submitting: boolean;
  submitError: string | null;
  onSubmit: (p: DrawParams) => void;
  onReset: () => void;
}) {
  const [params, setParams] = useState<DrawParams>(DEFAULTS);
  return (
    <div data-testid="params-form">
      <div style={endpoints}>
        <code>{ptA.id}</code> → <code>{ptB.id}</code>
      </div>
      <label style={field}>
        Lanes (per direction)
        <input
          type="number"
          min={1}
          value={params.lanes}
          onChange={(e) => setParams((p) => ({ ...p, lanes: Math.max(1, Number(e.target.value) || 1) }))}
          style={input}
          data-testid="param-lanes"
        />
      </label>
      <label style={field}>
        Speed (m/s)
        <input
          type="number"
          min={1}
          step={0.1}
          value={params.speed_mps}
          onChange={(e) => setParams((p) => ({ ...p, speed_mps: Math.max(1, Number(e.target.value) || 1) }))}
          style={input}
          data-testid="param-speed"
        />
      </label>
      <label style={checkRow}>
        <input
          type="checkbox"
          checked={params.bidirectional}
          onChange={(e) => setParams((p) => ({ ...p, bidirectional: e.target.checked }))}
          data-testid="param-bidirectional"
        />
        Two-way (both directions)
      </label>

      <div style={actions}>
        <button
          style={{ ...primaryBtn, ...(submitting ? busyBtn : null) }}
          disabled={submitting}
          onClick={() => onSubmit(params)}
          data-testid="simulate-btn"
        >
          {submitting ? 'Submitting…' : 'Simulate'}
        </button>
        <button style={linkBtn} onClick={onReset} disabled={submitting} data-testid="params-cancel">
          cancel
        </button>
      </div>
      {submitError && (
        <div style={hintText} data-testid="submit-error">
          {submitError}
        </div>
      )}
    </div>
  );
}

/** V2.1b/c/d — run options for the NEXT run. The assignment + seeds copy is the ratified honest framing.
 * V2.2c: a pending WINDOWED draft locks assignment to day-one with the D1 reason shown. */
function RunOptionsBlock({ options, onChange, windowLocked }: {
  options: RunOptions; onChange: (o: RunOptions) => void; windowLocked: boolean;
}) {
  const assignment = options.assignment ?? 'day_one';
  const seeds = options.n_seeds ?? 1;
  return (
    <div style={card} data-testid="run-options">
      <label style={field}>
        Traffic volumes
        <select
          value={options.demand_profile ?? 'synthetic_demo'}
          onChange={(e) => onChange({ ...options, demand_profile: e.target.value as RunOptions['demand_profile'] })}
          style={input}
          data-testid="option-demand"
        >
          <option value="synthetic_demo">Synthetic demo (fast)</option>
          <option value="calibrated_am_peak">Calibrated AM peak (count-anchored; slower)</option>
        </select>
      </label>
      <label style={{ ...checkRow, ...(windowLocked ? { opacity: 0.55 } : null) }}>
        <input
          type="checkbox"
          checked={!windowLocked && assignment === 'settled'}
          disabled={windowLocked}
          onChange={(e) => onChange({ ...options, assignment: e.target.checked ? 'settled' : 'day_one' })}
          data-testid="option-assignment"
        />
        Settled response
      </label>
      {windowLocked && (
        // the EXACT D1 sentence — client copy of change_scheduler.REASON_WINDOWED_SETTLED
        // (python/src/change_scheduler.py); the server 400 with the same words is the backstop.
        <div style={hintText} data-testid="assignment-locked-reason">
          temporary events have no equilibrium; use day-one response
        </div>
      )}
      <div style={hintText}>
        Day-one response: travelers react with today&apos;s habits (minutes). Settled response: travelers
        have adjusted to the change (iterated assignment; takes substantially longer).
      </div>
      <label style={{ ...checkRow, marginTop: 10 }}>
        <input
          type="checkbox"
          checked={seeds === 3}
          onChange={(e) => onChange({ ...options, n_seeds: e.target.checked ? 3 : 1 })}
          data-testid="option-seeds"
        />
        Robustness probe (3 seeds)
      </label>
      <div style={hintText}>
        Runs the baseline+scenario pair three times (seeds 42, 43, 44) and shows per-cell ranges —
        roughly 3&times; the simulation time.
      </div>
      {seeds === 3 && options.demand_profile === 'calibrated_am_peak' && (
        <div style={hintText} data-testid="seeds-cost-warning">
          With calibrated demand this is a batch-scale run — expect hours, not minutes.
        </div>
      )}
    </div>
  );
}

export function EditPanel(props: EditPanelProps) {
  const { ptA, ptB, hint, submitting, submitError, onSubmit, onReset, activeRunId, onDrawAnother } = props;

  return (
    <div style={rail} data-testid="edit-panel">
      <RunSwitcher activeRunId={activeRunId} onLoad={props.onLoadRun} />
      {!activeRunId && (
        <RunOptionsBlock options={props.runOptions} onChange={props.onRunOptions} windowLocked={props.windowLocked} />
      )}

      {activeRunId ? (
        <>
          <RunCard key={activeRunId} runId={activeRunId} onLoaded={props.onLoaded} onVoice={props.onVoice} />
          {props.streamedVoices.length > 0 && (
            <div style={card} data-testid="voice-stream-panel">
              <div style={contains}>
                Voices streaming in — {props.streamedVoices.length} so far (anticipated reactions, not a poll)
              </div>
              {props.streamedVoices
                .slice(-STREAM_SHOWN)
                .reverse()
                .map((a, i) => (
                  <div key={`${a.persona.id}:${props.streamedVoices.length - i}`} style={voiceRow} data-testid="voice-stream-row">
                    <span style={voiceLabel}>
                      {a.persona.label}
                      {a.grounding === 'inferred' ? ' — community perspective' : ''}
                    </span>
                    <span style={voiceComment}>{a.reaction.comment}</span>
                  </div>
                ))}
              {props.streamedVoices.length > STREAM_SHOWN && (
                <div style={voiceMore}>…and {props.streamedVoices.length - STREAM_SHOWN} earlier</div>
              )}
            </div>
          )}
          {props.runLoaded && (
            <div style={{ flexShrink: 0 }}>
              <ScorecardPanel scorecard={props.scorecard} activeGroup={null} onSelectGroup={() => {}} />
            </div>
          )}
          <div style={card}>
            {props.runLoaded && (
              <>
                <div style={contains} data-testid="run-contains">
                  This run has: scorecard ✓ · voices {props.hasVoices ? '✓' : '—'} · discourse{' '}
                  {props.hasSocial ? '✓' : '—'}
                </div>
                {!props.hasVoices && (
                  <div style={emptyHint} data-testid="no-voices">
                    No stakeholder voices yet — run <b>voices</b> above to hear individual anticipated reactions.
                  </div>
                )}
                {!props.hasSocial && (
                  <div style={emptyHint} data-testid="no-discourse">
                    Discourse not run — run <b>discourse</b> above to unlock the cascade view.
                  </div>
                )}
              </>
            )}
            <button style={secondaryBtn} onClick={onDrawAnother} data-testid="draw-another">
              ＋ Draw another road
            </button>
          </div>
        </>
      ) : props.zoneMode ? (
        <ZonePalette
          edges={props.zoneEdges}
          demandProfile={props.runOptions.demand_profile ?? 'synthetic_demo'}
          submitting={submitting}
          submitError={submitError}
          onRemoveEdge={props.onZoneRemove}
          onSubmit={props.onZoneSubmit}
          onWindowedDraft={props.onWindowedDraft}
          onCancel={props.onZoneCancel}
        />
      ) : props.selectedEdge ? (
        <EdgePalette
          key={props.selectedEdge.id}
          edge={props.selectedEdge}
          demandProfile={props.runOptions.demand_profile ?? 'synthetic_demo'}
          submitting={submitting}
          submitError={submitError}
          onSpeedLimit={props.onEdgeSpeed}
          onBikeLane={props.onEdgeBike}
          onLaneClosure={props.onEdgeLaneClosure}
          onRoadClosure={props.onEdgeRoadClosure}
          onIncident={props.onEdgeIncident}
          onWindowedDraft={props.onWindowedDraft}
          onCancel={props.onEdgeCancel}
        />
      ) : (
        <div style={card} data-testid="draw-card">
          <div style={title}>Draw a road</div>
          {props.junctionsDown ? (
            <div style={hintText} data-testid="junctions-down">
              Junctions unavailable — start the backend (<code>uvicorn server:app --port 8000</code>), then
              re-enter Edit mode.
            </div>
          ) : (
            !ptA && <div style={step}>Click a junction on the map to start.</div>
          )}
          {!ptA && !props.junctionsDown && (
            <div style={subStep} data-testid="edge-zoom-hint">
              {props.canEditEdges
                ? 'Or click an existing road to change its speed limit / add a bike lane.'
                : 'Zoom in to click an existing road (speed limit / bike lane).'}
            </div>
          )}
          {!ptA && !props.junctionsDown && (
            <button style={{ ...secondaryBtn, marginTop: 8 }} onClick={props.onZoneToggle}
                    data-testid="zone-mode-toggle">
              🏫 Draw a school zone
            </button>
          )}
          {ptA && !ptB && (
            <div style={step}>
              Start: <code>{ptA.id}</code>
              <br />
              Click a second junction to finish.
              <button style={linkBtn} onClick={onReset} data-testid="draw-cancel">
                cancel
              </button>
            </div>
          )}
          {hint && (
            <div style={hintText} data-testid="draw-hint">
              {hint}
            </div>
          )}
          {ptA && ptB && (
            <DrawForm
              key={`${ptA.id}-${ptB.id}`}
              ptA={ptA}
              ptB={ptB}
              submitting={submitting}
              submitError={submitError}
              onSubmit={onSubmit}
              onReset={onReset}
            />
          )}
        </div>
      )}
    </div>
  );
}

const rail: React.CSSProperties = {
  position: 'absolute',
  top: 70,
  right: 16,
  width: 340,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  maxHeight: 'calc(100vh - 160px)',
  overflowY: 'auto',
  zIndex: 20,
  pointerEvents: 'none',
};
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
const title: React.CSSProperties = { fontSize: 14, fontWeight: 700, marginBottom: 8 };
const step: React.CSSProperties = { fontSize: 12.5, lineHeight: 1.5, color: '#4b5563' };
const subStep: React.CSSProperties = { fontSize: 12, lineHeight: 1.5, color: '#8a9099', marginTop: 8 };
const endpoints: React.CSSProperties = { fontSize: 13, marginBottom: 10, color: '#1f4e9c', fontWeight: 600 };
const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#6b7280', marginBottom: 8 };
const input: React.CSSProperties = { border: '1px solid #cbd3dc', borderRadius: 8, padding: '6px 8px', fontSize: 13, color: '#374151' };
const checkRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#4b5563', marginBottom: 10 };
const actions: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 };
const primaryBtn: React.CSSProperties = {
  border: 'none',
  background: '#1f4e9c',
  color: '#fff',
  borderRadius: 8,
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
};
const busyBtn: React.CSSProperties = { opacity: 0.6, cursor: 'default' };
const secondaryBtn: React.CSSProperties = {
  marginTop: 10,
  border: '1px solid #cbd3dc',
  background: '#f6f8fa',
  color: '#374151',
  borderRadius: 8,
  padding: '7px 12px',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
};
const linkBtn: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#8a9099',
  fontSize: 12,
  cursor: 'pointer',
  textDecoration: 'underline',
  marginLeft: 8,
};
const hintText: React.CSSProperties = { marginTop: 8, fontSize: 12, color: '#b23a3a' };
const contains: React.CSSProperties = { fontSize: 12, color: '#4b5563' };
// V2.3a — the streamed-voices ticker (newest first; capped, the rest summarized)
const STREAM_SHOWN = 6;
const voiceRow: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 1, marginTop: 8 };
const voiceLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#1f2937' };
const voiceComment: React.CSSProperties = { fontSize: 11, color: '#4b5563', lineHeight: 1.4 };
const voiceMore: React.CSSProperties = { marginTop: 8, fontSize: 10, color: '#8a9099' };
const emptyHint: React.CSSProperties = { marginTop: 8, fontSize: 12, color: '#6b7280', lineHeight: 1.5 };
