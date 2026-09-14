'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ChangeWindow, Edge, SimChange } from '@/lib/api';
import { fmtWindowRange } from '@/lib/simTime';
import { edgeLabel } from '@/lib/streetNames';
import { directionNote, emitLaneClosures, laneRowsFor, type LaneSelection } from '@/lib/laneRows';

export type EventKind = 'lane_closure' | 'road_closure' | 'incident';

interface DropFormProps {
  /** The dropped / clicked edge, merged (network + eligibility). */
  edge: Edge;
  /** Its node-pair partner (the opposite direction), merged — null on a one-way street. */
  partner: Edge | null;
  /** The cross-street line ("between X and Y" / "near X"), or null. Derived by the caller from the network. */
  betweenText: string | null;
  /** A kind that arrived WITH the edge (a tile drop, the seam's second argument) — pre-selects the
   *  event; null is the ROAD CARD (a plain road click), which offers the kinds as buttons. */
  kind: EventKind | null;
  demandProfile: 'synthetic_demo' | 'calibrated_am_peak';
  submitting: boolean;
  submitError: string | null;
  onSpeedLimit: (valueMps: number) => void;
  onBikeLane: () => void;
  /** One `lane_closure` member per directional edge with a tick (the both-directions form). */
  onLaneClosures: (members: SimChange[]) => void;
  onRoadClosure: (window: ChangeWindow | null) => void;
  onIncident: (p: { lanes: number[]; speedFactor: number | null; window: ChangeWindow }) => void;
  onWindowedDraft: (active: boolean) => void; // the D1 lock signal (assignment → day_one)
  onCancel: () => void;
}

const KIND_TITLE: Record<EventKind, string> = {
  lane_closure: 'LANE CLOSURE', road_closure: 'ROAD CLOSURE', incident: 'TIMED INCIDENT',
};

/**
 * V2.7d C4a — the DROP FORM (the ratified §1d inline mini-form), which also serves as the ROAD CARD
 * when no kind arrived with the edge (V2.2c's EdgePalette, absorbed: every testid and string it
 * carried is preserved — the eight seam specs ride them unchanged). Lanes come from THIS ROAD'S LANE
 * TABLE for BOTH directions ("EB general 1 (curb)" … "WB general 1 (curb)"), sidewalk / bus / bike
 * rows listed inert (never closable), and ticks across directions add ONE lane_closure member PER
 * directional edge — with the per-direction consequence SAID before Run (`drop-direction-note`, the
 * ratification's one condition). Windows: start + duration MINUTES → sim-seconds; any windowed draft
 * locks the assignment to day-one (the D1 signal). Keyed by edge id in the parent so a fresh drop
 * remounts clean. Looks are C8's; this commit is behaviour.
 */
export function DropForm({
  edge, partner, betweenText, kind, demandProfile, submitting, submitError,
  onSpeedLimit, onBikeLane, onLaneClosures, onRoadClosure, onIncident, onWindowedDraft, onCancel,
}: DropFormProps) {
  const [speed, setSpeed] = useState<number>(Math.round(edge.speed_mps * 10) / 10);
  const [eventKind, setEventKind] = useState<EventKind | null>(kind);
  const [laneSel, setLaneSel] = useState<LaneSelection>({ primary: [], partner: [] });
  const [winStart, setWinStart] = useState<string>(''); // minutes from sim start
  const [winDur, setWinDur] = useState<string>(''); // minutes
  const [slowdown, setSlowdown] = useState<'' | '75' | '50' | '25'>('');

  const rows = useMemo(
    () => laneRowsFor(edge.network, partner?.network ?? null,
      { primary: edge.car_lane_indices, partner: partner?.car_lane_indices ?? [] }),
    [edge, partner],
  );
  const laneCount = rows.filter((r) => r.kind !== 'sidewalk').length;

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

  const toggleLane = (side: 'primary' | 'partner', idx: number) =>
    setLaneSel((sel) => {
      const cur = sel[side];
      const next = cur.includes(idx) ? cur.filter((i) => i !== idx) : [...cur, idx].sort((a, b) => a - b);
      return { ...sel, [side]: next };
    });

  const pickKind = (k: EventKind) => {
    setEventKind((cur) => (cur === k ? null : k));
    setLaneSel({ primary: [], partner: [] });
    setSlowdown('');
  };

  const ticks = laneSel.primary.length + laneSel.partner.length;
  // both-or-neither for closures; incident requires a full window
  const windowValid = eventKind === 'incident' ? window !== null : !windowInputsTouched || window !== null;
  const laneNeed = eventKind === 'lane_closure' ? ticks >= 1 : true;
  const incidentNeed = eventKind !== 'incident' || laneSel.primary.length >= 1 || slowdown !== '';
  const canApply = !submitting && windowValid && laneNeed && incidentNeed;

  const windowLabel =
    window === null
      ? null
      : demandProfile === 'calibrated_am_peak'
        ? fmtWindowRange(window, demandProfile)
        : `${Number(winStart)}–${Number(winStart) + Number(winDur)} min`; // input-unit echo (synthetic)

  // The lane picker: general lanes are checkboxes (disabled when the server's list disagrees); the
  // sidewalk / bus / bike rows are inert text — never closable, never an input (the V2.2c picker's
  // input count stays the car-lane count). `bothSides` lists the partner's rows too (lane closure);
  // an incident stays single-edge (positional).
  const lanePicker = (bothSides: boolean) => (
    <div style={laneRow} data-testid="lane-picker">
      {rows.filter((r) => bothSides || r.side === 'primary').map((r) => {
        const tid = r.side === 'primary' ? `lane-check-${r.sumoIndex}` : `lane-check-rev-${r.sumoIndex}`;
        if (r.kind !== 'general') {
          return (
            <span key={tid} style={laneInert} title="not a car lane — not closable">
              {r.label}
            </span>
          );
        }
        return (
          <label key={tid} style={{ ...laneCheck, ...(r.closable ? null : laneOff) }} title={r.reason}>
            <input
              type="checkbox"
              checked={laneSel[r.side].includes(r.sumoIndex)}
              disabled={!r.closable}
              onChange={() => toggleLane(r.side, r.sumoIndex)}
              data-testid={tid}
            />
            {r.label}
          </label>
        );
      })}
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

  const note = eventKind === 'lane_closure' ? directionNote(edge.network, partner?.network ?? null, laneSel) : null;

  return (
    <div style={card} data-testid={kind ? 'drop-form' : 'edge-palette'}>
      <div style={kicker}>{kind ? `NEW MEMBER · ${KIND_TITLE[kind]}` : 'EDIT THIS ROAD'}</div>
      <div style={title}>{edgeLabel(edge.network.name, edge.id)}</div>
      <div style={meta}>
        {betweenText ? `${betweenText} · ` : ''}
        {laneCount} {laneCount === 1 ? 'lane' : 'lanes'} · {edge.car_lane_count} car {edge.car_lane_count === 1 ? 'lane' : 'lanes'} this direction · current speed{' '}
        {(edge.speed_mps * 3.6).toFixed(0)} km/h
      </div>

      {!kind && (
        <>
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
        </>
      )}

      {/* V2.2c — temporary events (closures + incident). Mechanical copy only, never asserted benefit. */}
      <div style={section}>
        {!kind && (
          <>
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
          </>
        )}

        {eventKind === 'lane_closure' && (
          <>
            <div style={fieldLabel}>Which lanes — from this road&rsquo;s lane table</div>
            {lanePicker(true)}
            {note && (
              <div style={noteText} data-testid="drop-direction-note">
                {note}
              </div>
            )}
            {windowBlock(false)}
            <button style={{ ...primaryBtn, marginTop: 10, ...(canApply ? null : disabledBtn) }}
                    disabled={!canApply}
                    onClick={() => onLaneClosures(emitLaneClosures(edge.network, partner?.network ?? null, laneSel, window))}
                    data-testid="apply-lane-closure">
              Close {ticks || '…'} lane{ticks === 1 ? '' : 's'}
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
            {lanePicker(false)}
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
                      window && onIncident({ lanes: laneSel.primary, speedFactor: slowdown === '' ? null : Number(slowdown) / 100, window })}
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
const kicker: React.CSSProperties = { fontSize: 10.5, letterSpacing: '0.1em', color: '#8a9099', marginBottom: 2 };
const title: React.CSSProperties = { fontSize: 14, fontWeight: 700, marginBottom: 4 };
const meta: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 10, lineHeight: 1.5, wordBreak: 'break-word' };
const section: React.CSSProperties = { borderTop: '1px solid #eef1f4', paddingTop: 10, marginTop: 6 };
const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#6b7280', marginBottom: 8 };
const fieldLabel: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 4 };
const noteText: React.CSSProperties = { fontSize: 12, color: '#374151', fontWeight: 600, margin: '4px 0 2px' };
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
// the FULL shorthand, not `borderColor`: this object is spread over `kindBtn` (which carries
// `border`), and a shorthand meeting its longhand across a spread is where the colour gets dropped
const kindActive: React.CSSProperties = {
  background: '#eef4ff', border: '1px solid #1f4e9c', color: '#1f4e9c',
};
const laneRow: React.CSSProperties = { display: 'grid', gap: 5, marginBottom: 4 };
const laneCheck: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151' };
const laneOff: React.CSSProperties = { color: '#9aa0a8' };
const laneInert: React.CSSProperties = { fontSize: 12, color: '#9aa0a8', paddingLeft: 22 };
const winRow: React.CSSProperties = { display: 'flex', gap: 8 };
const winField: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, color: '#6b7280', flex: 1 };
const winLabel: React.CSSProperties = { marginTop: 5, fontSize: 12, color: '#1f4e9c', fontWeight: 600 };
