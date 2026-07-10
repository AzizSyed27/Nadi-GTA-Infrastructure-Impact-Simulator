'use client';

import { useState } from 'react';
import type { Junction } from '@/lib/api';
import type { Scorecard } from '@/lib/types';
import { RunCard } from '@/components/RunCard';
import { RunSwitcher } from '@/components/RunSwitcher';
import { ScorecardPanel } from '@/components/ScorecardPanel';

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
  activeRunId: string | null;
  onDrawAnother: () => void; // clear the active run + draw state, back to drawing
  onLoaded: (id: string) => void; // RunCard reached done → parent re-fetches the artifact
  onLoadRun: (id: string) => void; // RunSwitcher picked a run → parent switches active run
  runLoaded: boolean; // the active run's artifact is the one currently shown (honesty flags are trustworthy)
  hasVoices: boolean;
  hasSocial: boolean;
  scorecard: Scorecard | undefined; // the active run's scorecard (shown once its artifact is loaded)
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

export function EditPanel(props: EditPanelProps) {
  const { ptA, ptB, hint, submitting, submitError, onSubmit, onReset, activeRunId, onDrawAnother } = props;

  return (
    <div style={rail} data-testid="edit-panel">
      <RunSwitcher activeRunId={activeRunId} onLoad={props.onLoadRun} />

      {activeRunId ? (
        <>
          <RunCard key={activeRunId} runId={activeRunId} onLoaded={props.onLoaded} />
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
const emptyHint: React.CSSProperties = { marginTop: 8, fontSize: 12, color: '#6b7280', lineHeight: 1.5 };
