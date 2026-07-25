'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ChangeWindow, Edge } from '@/lib/api';
import { fmtWindowRange } from '@/lib/simTime';

interface EdgePaletteProps {
  edge: Edge;
  demandProfile: 'synthetic_demo' | 'calibrated_am_peak';
  submitting: boolean;
  submitError: string | null;
  onSpeedLimit: (valueMps: number) => void;
  onBikeLane: () => void;
  onLaneClosure: (lanes: number[], window: ChangeWindow | null) => void;
  onRoadClosure: (window: ChangeWindow | null) => void;
  onIncident: (p: { lanes: number[]; speedFactor: number | null; window: ChangeWindow }) => void;
  onWindowedDraft: (active: boolean) => void; // the D1 lock signal (assignment → day_one)
  onCancel: () => void;
}

type EventKind = 'lane_closure' | 'road_closure' | 'incident';

/**
 * The edit-an-edge palette. Speed limit + bike lane (5.2b, unchanged) plus the V2.2c temporary
 * events: close lanes (a picker over the edge's REAL car-lane indices), close the road, or an
 * incident (blocked lanes and/or a slowdown — a CAPACITY event, never a crash simulation).
 * Windows are entered as start + duration MINUTES and submitted in sim-seconds; the resolved
 * range renders as clock times on the calibrated profile (t=0 == 07:00). Any windowed draft
 * locks the assignment toggle to day-one (temporary events have no equilibrium — the server 400
 * with the same reason stays the backstop). Keyed by edge id in the parent so a fresh selection
 * remounts clean.
 */
export function EdgePalette({
  edge, demandProfile, submitting, submitError,
  onSpeedLimit, onBikeLane, onLaneClosure, onRoadClosure, onIncident, onWindowedDraft, onCancel,
}: EdgePaletteProps) {
  const [speed, setSpeed] = useState<number>(Math.round(edge.speed_mps * 10) / 10);
  const [eventKind, setEventKind] = useState<EventKind | null>(null);
  const [laneSel, setLaneSel] = useState<number[]>([]);
  const [winStart, setWinStart] = useState<string>(''); // minutes from sim start
  const [winDur, setWinDur] = useState<string>(''); // minutes
  const [slowdown, setSlowdown] = useState<'' | '75' | '50' | '25'>('');

  const windowInputsTouched = winStart !== '' || winDur !== '';
  const window = useMemo<ChangeWindow | null>(() => {
    if (winStart === '' || winDur === '') return null;
    const start = Number(winStart);
    const dur = Number(winDur);
    if (!Number.isFinite(start) || !Number.isFinite(dur) || start < 0 || dur <= 0) return null;
    return { start_s: start * 60, end_s: (start + dur) * 60 };
  }, [winStart, winDur]);

  // The D1 lock: an incident is ALWAYS windowed; closures lock as soon as window inputs are touched.
  const windowActive = eventKind === 'incident' || (eventKind !== null && windowInputsTouched);
  useEffect(() => {
    onWindowedDraft(windowActive);
    return () => onWindowedDraft(false); // unmount (cancel / edge switch) clears the lock
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowActive]);

  const toggleLane = (idx: number) =>
    setLaneSel((sel) => (sel.includes(idx) ? sel.filter((i) => i !== idx) : [...sel, idx].sort((a, b) => a - b)));

  const pickKind = (k: EventKind) => {
    setEventKind((cur) => (cur === k ? null : k));
    setLaneSel([]);
    setSlowdown('');
  };

  // both-or-neither for closures; incident requires a full window
  const windowValid = eventKind === 'incident' ? window !== null : !windowInputsTouched || window !== null;
  const laneNeed = eventKind === 'lane_closure' ? laneSel.length >= 1 : true;
  const incidentNeed = eventKind !== 'incident' || laneSel.length >= 1 || slowdown !== '';
  const canApply = !submitting && windowValid && laneNeed && incidentNeed;

  const windowLabel =
    window === null
      ? null
      : demandProfile === 'calibrated_am_peak'
        ? fmtWindowRange(window, demandProfile)
        : `${Number(winStart)}–${Number(winStart) + Number(winDur)} min`; // input-unit echo (synthetic)

  const lanePicker = (
    <div style={laneRow} data-testid="lane-picker">
      {edge.car_lane_indices.map((idx, pos) => (
        <label key={idx} style={laneCheck}>
          <input
            type="checkbox"
            checked={laneSel.includes(idx)}
            onChange={() => toggleLane(idx)}
            data-testid={`lane-check-${idx}`}
          />
          lane {pos + 1}
        </label>
      ))}
    </div>
  );

  const windowBlock = (required: boolean) => (
    <div style={{ marginTop: 8 }}>
      <div style={fieldLabel}>
        Active window {required ? '(required — a temporary event)' : '(optional — leave empty for the whole run)'}
      </div>
      <div style={winRow}>
        <label style={winField}>
          start (min)
          <input type="number" min={0} step={1} value={winStart} onChange={(e) => setWinStart(e.target.value)}
                 style={input} data-testid="window-start" />
        </label>
        <label style={winField}>
          duration (min)
          <input type="number" min={1} step={1} value={winDur} onChange={(e) => setWinDur(e.target.value)}
                 style={input} data-testid="window-duration" />
        </label>
      </div>
      {windowLabel && (
        <div style={winLabel} data-testid="window-label">
          active {windowLabel}
        </div>
      )}
    </div>
  );

  return (
    <div style={card} data-testid="edge-palette">
      <div style={title}>Edit this road</div>
      <div style={meta}>
        <code>{edge.id}</code>
        <br />
        {edge.car_lane_count} car {edge.car_lane_count === 1 ? 'lane' : 'lanes'} · current speed{' '}
        {(edge.speed_mps * 3.6).toFixed(0)} km/h
      </div>

      <div style={section}>
        <label style={field}>
          New speed limit (m/s)
          <input
            type="number"
            min={1}
            step={0.1}
            value={speed}
            onChange={(e) => setSpeed(Math.max(1, Number(e.target.value) || 1))}
            style={input}
            data-testid="palette-speed"
          />
        </label>
        <button
          style={{ ...primaryBtn, ...(submitting ? busyBtn : null) }}
          disabled={submitting}
          onClick={() => onSpeedLimit(speed)}
          data-testid="apply-speed"
        >
          Apply speed limit
        </button>
      </div>

      <div style={section}>
        <button
          style={{ ...secondaryBtn, ...(edge.eligible_bike_lane && !submitting ? null : disabledBtn) }}
          disabled={!edge.eligible_bike_lane || submitting}
          title={edge.eligible_bike_lane ? undefined : edge.eligibility_reason}
          onClick={onBikeLane}
          data-testid="apply-bike-lane"
        >
          Convert curbside lane to bike lane
        </button>
        {!edge.eligible_bike_lane && (
          <div style={reasonText} data-testid="bike-ineligible-reason">
            {edge.eligibility_reason}
          </div>
        )}
      </div>

      {/* V2.2c — temporary events (closures + incident). Mechanical copy only, never asserted benefit. */}
      <div style={section}>
        <div style={fieldLabel}>Close / disrupt</div>
        <div style={kindRow}>
          <button style={{ ...kindBtn, ...(eventKind === 'lane_closure' ? kindActive : null) }}
                  onClick={() => pickKind('lane_closure')} data-testid="palette-type-lane-closure">
            Close lanes
          </button>
          <button style={{ ...kindBtn, ...(eventKind === 'road_closure' ? kindActive : null) }}
                  onClick={() => pickKind('road_closure')} data-testid="palette-type-road-closure">
            Close road
          </button>
          <button style={{ ...kindBtn, ...(eventKind === 'incident' ? kindActive : null) }}
                  onClick={() => pickKind('incident')} data-testid="palette-type-incident">
            Incident
          </button>
        </div>

        {eventKind === 'lane_closure' && (
          <>
            <div style={fieldLabel}>Which car lanes to close</div>
            {lanePicker}
            {windowBlock(false)}
            <button style={{ ...primaryBtn, marginTop: 10, ...(canApply ? null : disabledBtn) }}
                    disabled={!canApply} onClick={() => onLaneClosure(laneSel, window)}
                    data-testid="apply-lane-closure">
              Close {laneSel.length || '…'} lane{laneSel.length === 1 ? '' : 's'}
            </button>
          </>
        )}

        {eventKind === 'road_closure' && (
          <>
            {windowBlock(false)}
            <button style={{ ...primaryBtn, marginTop: 10, ...(canApply ? null : disabledBtn) }}
                    disabled={!canApply} onClick={() => onRoadClosure(window)}
                    data-testid="apply-road-closure">
              Close the whole road
            </button>
          </>
        )}

        {eventKind === 'incident' && (
          <>
            <div style={fieldLabel}>Blocked lanes (optional if a slowdown is set)</div>
            {lanePicker}
            <label style={{ ...field, marginTop: 6 }}>
              Slowdown
              <select value={slowdown} onChange={(e) => setSlowdown(e.target.value as typeof slowdown)}
                      style={input} data-testid="incident-slowdown">
                <option value="">none</option>
                <option value="75">to 75% speed</option>
                <option value="50">to 50% speed</option>
                <option value="25">to 25% speed</option>
              </select>
            </label>
            {windowBlock(true)}
            <button style={{ ...primaryBtn, marginTop: 10, ...(canApply ? null : disabledBtn) }}
                    disabled={!canApply}
                    onClick={() =>
                      window && onIncident({ lanes: laneSel, speedFactor: slowdown === '' ? null : Number(slowdown) / 100, window })}
                    data-testid="apply-incident">
              Add incident
            </button>
          </>
        )}
      </div>

      <button style={linkBtn} onClick={onCancel} disabled={submitting} data-testid="palette-cancel">
        cancel
      </button>
      {submitError && (
        <div style={errText} data-testid="palette-error">
          {submitError}
        </div>
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
const title: React.CSSProperties = { fontSize: 14, fontWeight: 700, marginBottom: 6 };
const meta: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 10, lineHeight: 1.5, wordBreak: 'break-all' };
const section: React.CSSProperties = { borderTop: '1px solid #eef1f4', paddingTop: 10, marginTop: 6 };
const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#6b7280', marginBottom: 8 };
const fieldLabel: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 4 };
const input: React.CSSProperties = { border: '1px solid #cbd3dc', borderRadius: 8, padding: '6px 8px', fontSize: 13, color: '#374151' };
const primaryBtn: React.CSSProperties = {
  border: 'none',
  background: '#1f4e9c',
  color: '#fff',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
};
const busyBtn: React.CSSProperties = { opacity: 0.6, cursor: 'default' };
const secondaryBtn: React.CSSProperties = {
  width: '100%',
  border: '1px solid #cbd3dc',
  background: '#f6f8fa',
  color: '#374151',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
};
const disabledBtn: React.CSSProperties = { opacity: 0.5, cursor: 'not-allowed', color: '#9aa0a8' };
const reasonText: React.CSSProperties = { marginTop: 6, fontSize: 11.5, color: '#8a9099', lineHeight: 1.4 };
const linkBtn: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#8a9099',
  fontSize: 12,
  cursor: 'pointer',
  textDecoration: 'underline',
  marginTop: 10,
};
const errText: React.CSSProperties = { marginTop: 8, fontSize: 12, color: '#b23a3a' };
const kindRow: React.CSSProperties = { display: 'flex', gap: 6, marginBottom: 6 };
const kindBtn: React.CSSProperties = {
  flex: 1,
  border: '1px solid #cbd3dc',
  background: '#f6f8fa',
  color: '#374151',
  borderRadius: 8,
  padding: '6px 4px',
  fontSize: 11.5,
  fontWeight: 600,
  cursor: 'pointer',
};
const kindActive: React.CSSProperties = { background: '#eef4ff', borderColor: '#1f4e9c', color: '#1f4e9c' };
const laneRow: React.CSSProperties = { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 4 };
const laneCheck: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#374151' };
const winRow: React.CSSProperties = { display: 'flex', gap: 8 };
const winField: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, color: '#6b7280', flex: 1 };
const winLabel: React.CSSProperties = { marginTop: 5, fontSize: 12, color: '#1f4e9c', fontWeight: 600 };
