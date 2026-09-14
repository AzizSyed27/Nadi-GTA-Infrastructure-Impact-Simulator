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
    <div className="ed-card" data-testid="zone-palette">
      <div className="ed-kicker">NEW MEMBERS · SCHOOL ZONE</div>
      <div className="ed-title">🏫 School zone</div>
      <div className="ed-muted">
        Click streets on the map to add them to the zone. Each gets the same reduced limit during
        the window.
      </div>

      <div className="ed-label">Zone streets ({edges.length})</div>
      {edges.length === 0 ? (
        <div className="ed-hint" data-testid="zone-empty-hint">
          none yet — click a street on the map
        </div>
      ) : (
        <ul className="ed-members" data-testid="zone-edge-list">
          {edges.map((id) => (
            <li key={id} className="ed-member" data-testid={`zone-edge-${id}`}>
              <span className="ed-code">{id}</span>
              <button className="ed-x" onClick={() => onRemoveEdge(id)} disabled={submitting}
                      data-testid={`zone-remove-${id}`} aria-label={`remove ${id}`}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="ed-field">
        <span className="ed-muted">Zone speed limit (km/h)</span>
        <input
          type="number"
          min={5}
          step={5}
          value={speedKmh}
          onChange={(e) => setSpeedKmh(Math.max(5, Number(e.target.value) || 5))}
          className="ed-input"
          data-testid="zone-speed"
        />
      </label>

      <div className="ed-label">Active window (required — the zone is a time-of-day designation)</div>
      <div className="ed-winrow">
        <label className="ed-field">
          <span className="ed-muted">start (min)</span>
          <input type="number" min={0} step={1} value={winStart} onChange={(e) => setWinStart(e.target.value)}
                 className="ed-input" data-testid="zone-window-start" />
        </label>
        <label className="ed-field">
          <span className="ed-muted">duration (min)</span>
          <input type="number" min={1} step={1} value={winDur} onChange={(e) => setWinDur(e.target.value)}
                 className="ed-input" data-testid="zone-window-duration" />
        </label>
      </div>
      {windowLabel && (
        <div className="ed-winlabel" data-testid="zone-window-label">
          reduced limits apply {windowLabel}
        </div>
      )}

      <div className="ed-actions">
        <button
          className="btn btn-primary"
          disabled={!canApply}
          onClick={() => window && onSubmit(speedKmh / 3.6, window)}
          data-testid="apply-school-zone"
        >
          Add to draft ({edges.length} street{edges.length === 1 ? '' : 's'})
        </button>
        <button className="ed-link" onClick={onCancel} disabled={submitting} data-testid="zone-cancel">
          cancel
        </button>
      </div>
      {submitError && (
        <div className="ed-warn" data-testid="zone-error">
          {submitError}
        </div>
      )}
    </div>
  );
}

// V2.7d C8b — every look lives in app/nadi.css under `.nadi-shell .ed-*` / `.btn` (the rail carries the class).
