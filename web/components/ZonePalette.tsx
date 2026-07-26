'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ChangeWindow } from '@/lib/api';
import { fmtWindowRange } from '@/lib/simTime';

interface ZonePaletteProps {
  edges: string[]; // accumulated zone edge ids (clicked on the map)
  demandProfile: 'synthetic_demo' | 'calibrated_am_peak';
  submitting: boolean;
  submitError: string | null;
  onRemoveEdge: (id: string) => void;
  onSubmit: (valueMps: number, window: ChangeWindow) => void;
  onWindowedDraft: (active: boolean) => void; // the D1 lock — a zone is windowed by design
  onCancel: () => void;
}

/**
 * V2.2d — the school-zone flow: accumulate streets by clicking them on the map, pick one reduced
 * speed + one active window, submit as a COMPOSITE of windowed speed_limit primitives tagged
 * school_zone. The window is REQUIRED (a school zone is a time-of-day designation — that is the
 * point of the flow); the pending draft locks assignment to day-one (same D1 lock as V2.2c).
 * Mechanical copy only — the zone asserts no benefit.
 */
export function ZonePalette({
  edges, demandProfile, submitting, submitError, onRemoveEdge, onSubmit, onWindowedDraft, onCancel,
}: ZonePaletteProps) {
  const [speedKmh, setSpeedKmh] = useState<number>(30); // the school-zone conventional default
  const [winStart, setWinStart] = useState<string>(''); // minutes from sim start
  const [winDur, setWinDur] = useState<string>(''); // minutes

  const window = useMemo<ChangeWindow | null>(() => {
    if (winStart === '' || winDur === '') return null;
    const start = Number(winStart);
    const dur = Number(winDur);
    if (!Number.isFinite(start) || !Number.isFinite(dur) || start < 0 || dur <= 0) return null;
    return { start_s: start * 60, end_s: (start + dur) * 60 };
  }, [winStart, winDur]);

  // A zone draft is ALWAYS a windowed draft — lock assignment to day-one while this card is open.
  useEffect(() => {
    onWindowedDraft(true);
    return () => onWindowedDraft(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canApply = !submitting && edges.length >= 1 && window !== null && speedKmh >= 5;
  const windowLabel =
    window === null
      ? null
      : demandProfile === 'calibrated_am_peak'
        ? fmtWindowRange(window, demandProfile)
        : `${Number(winStart)}–${Number(winStart) + Number(winDur)} min`;

  return (
    <div style={card} data-testid="zone-palette">
      <div style={title}>🏫 School zone</div>
      <div style={hint}>
        Click streets on the map to add them to the zone. Each gets the same reduced limit during
        the window.
      </div>

      <div style={fieldLabel}>Zone streets ({edges.length})</div>
      {edges.length === 0 ? (
        <div style={hint} data-testid="zone-empty-hint">
          none yet — click a street on the map
        </div>
      ) : (
        <ul style={edgeList} data-testid="zone-edge-list">
          {edges.map((id) => (
            <li key={id} style={edgeRow} data-testid={`zone-edge-${id}`}>
              <code style={edgeCode}>{id}</code>
              <button style={removeBtn} onClick={() => onRemoveEdge(id)} disabled={submitting}
                      data-testid={`zone-remove-${id}`} aria-label={`remove ${id}`}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <label style={field}>
        Zone speed limit (km/h)
        <input
          type="number"
          min={5}
          step={5}
          value={speedKmh}
          onChange={(e) => setSpeedKmh(Math.max(5, Number(e.target.value) || 5))}
          style={input}
          data-testid="zone-speed"
        />
      </label>

      <div style={fieldLabel}>Active window (required — the zone is a time-of-day designation)</div>
      <div style={winRow}>
        <label style={winField}>
          start (min)
          <input type="number" min={0} step={1} value={winStart} onChange={(e) => setWinStart(e.target.value)}
                 style={input} data-testid="zone-window-start" />
        </label>
        <label style={winField}>
          duration (min)
          <input type="number" min={1} step={1} value={winDur} onChange={(e) => setWinDur(e.target.value)}
                 style={input} data-testid="zone-window-duration" />
        </label>
      </div>
      {windowLabel && (
        <div style={winLabel} data-testid="zone-window-label">
          reduced limits apply {windowLabel}
        </div>
      )}

      <button
        style={{ ...primaryBtn, marginTop: 10, ...(canApply ? null : disabledBtn) }}
        disabled={!canApply}
        onClick={() => window && onSubmit(speedKmh / 3.6, window)}
        data-testid="apply-school-zone"
      >
        Simulate school zone ({edges.length} street{edges.length === 1 ? '' : 's'})
      </button>

      <button style={linkBtn} onClick={onCancel} disabled={submitting} data-testid="zone-cancel">
        cancel
      </button>
      {submitError && (
        <div style={errText} data-testid="zone-error">
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
const hint: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 8, lineHeight: 1.5 };
const fieldLabel: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 4 };
const edgeList: React.CSSProperties = { listStyle: 'none', margin: '0 0 8px', padding: 0, maxHeight: 130, overflowY: 'auto' };
const edgeRow: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '2px 0' };
const edgeCode: React.CSSProperties = { fontSize: 11.5, wordBreak: 'break-all' };
const removeBtn: React.CSSProperties = { border: 'none', background: 'transparent', color: '#8a9099', cursor: 'pointer', fontSize: 12 };
const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#6b7280', marginBottom: 8 };
const input: React.CSSProperties = { border: '1px solid #cbd3dc', borderRadius: 8, padding: '6px 8px', fontSize: 13, color: '#374151' };
const winRow: React.CSSProperties = { display: 'flex', gap: 8 };
const winField: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, color: '#6b7280', flex: 1 };
const winLabel: React.CSSProperties = { marginTop: 5, fontSize: 12, color: '#1f4e9c', fontWeight: 600 };
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
const disabledBtn: React.CSSProperties = { opacity: 0.5, cursor: 'not-allowed' };
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
