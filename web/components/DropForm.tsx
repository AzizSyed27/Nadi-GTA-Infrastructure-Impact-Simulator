'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ChangeWindow, Edge, SimChange } from '@/lib/api';
import { fmtWindowRange } from '@/lib/simTime';
import { clientEdgeRef, edgeLabel } from '@/lib/streetNames';
import { applyNote, directionNote, emitLaneClosures, laneRowsFor, type LaneSelection } from '@/lib/laneRows';

export type EventKind = 'lane_closure' | 'road_closure' | 'incident';
/** What a tile / a drop can carry: the three temporary events plus the two edge edits. */
export type DropKind = EventKind | 'speed_limit' | 'bike_lane';
const isEvent = (k: DropKind | null): k is EventKind => k === 'lane_closure' || k === 'road_closure' || k === 'incident';

interface DropFormProps {
  /** The dropped / clicked edge, merged (network + eligibility). */
  edge: Edge;
  /** Its node-pair partner (the opposite direction), merged — null on a one-way street. */
  partner: Edge | null;
  /** The cross-street line ("between X and Y" / "near X"), or null. Derived by the caller from the network. */
  betweenText: string | null;
  /** A kind that arrived WITH the edge (a tile drop, the seam's second argument) — pre-selects the
   *  event; null is the ROAD CARD (a plain road click), which offers the kinds as buttons. */
  kind: DropKind | null;
  demandProfile: 'synthetic_demo' | 'calibrated_am_peak';
  submitting: boolean;
  submitError: string | null;
  /** One `speed_limit` member per directional edge (two when the both-directions box is ticked). */
  onSpeedLimits: (members: SimChange[]) => void;
  onBikeLane: () => void;
  /** One `lane_closure` member per directional edge with a tick (the both-directions form). */
  onLaneClosures: (members: SimChange[]) => void;
  /** One `road_closure` member per directional edge (two when the both-directions box is ticked). */
  onRoadClosures: (members: SimChange[]) => void;
  onIncident: (p: { lanes: number[]; speedFactor: number | null; window: ChangeWindow }) => void;
  onWindowedDraft: (active: boolean) => void; // the D1 lock signal (assignment → day_one)
  onCancel: () => void;
}

const KIND_TITLE: Record<DropKind, string> = {
  lane_closure: 'LANE CLOSURE', road_closure: 'ROAD CLOSURE', incident: 'TIMED INCIDENT',
  speed_limit: 'SPEED LIMIT', bike_lane: 'BIKE-LANE CONVERSION',
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
  onSpeedLimits, onBikeLane, onLaneClosures, onRoadClosures, onIncident, onWindowedDraft, onCancel,
}: DropFormProps) {
  const [speed, setSpeed] = useState<number>(Math.round(edge.speed_mps * 10) / 10);
  const [eventKind, setEventKind] = useState<EventKind | null>(isEvent(kind) ? kind : null);
  // C4b: the both-directions box for a road closure / speed limit — DEFAULT OFF (the single-change
  // wire pin stands); its consequence is said either way (`drop-direction-note`).
  const [bothDirs, setBothDirs] = useState(false);
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
    <div className="ed-lanes" data-testid="lane-picker">
      {rows.filter((r) => bothSides || r.side === 'primary').map((r) => {
        const tid = r.side === 'primary' ? `lane-check-${r.sumoIndex}` : `lane-check-rev-${r.sumoIndex}`;
        if (r.kind !== 'general') {
          return (
            <span key={tid} className="ed-lane-inert" title="not a car lane — not closable">
              {r.label}
            </span>
          );
        }
        return (
          <label key={tid} className={r.closable ? 'ed-check' : 'ed-check ed-check-off'} title={r.reason}>
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
    <div className="ed-window">
      <div className="ed-label">
        Active window {required ? '(required — a temporary event)' : '(optional — leave empty for the whole run)'}
      </div>
      <div className="ed-winrow">
        <label className="ed-field">
          <span className="ed-muted">start (min)</span>
          <input type="number" min={0} step={1} value={winStart} onChange={(e) => setWinStart(e.target.value)}
                 className="ed-input" data-testid="window-start" />
        </label>
        <label className="ed-field">
          <span className="ed-muted">duration (min)</span>
          <input type="number" min={1} step={1} value={winDur} onChange={(e) => setWinDur(e.target.value)}
                 className="ed-input" data-testid="window-duration" />
        </label>
      </div>
      {windowLabel && (
        <div className="ed-winlabel" data-testid="window-label">
          active {windowLabel}
        </div>
      )}
    </div>
  );

  const pn = partner?.network ?? null;
  const note = eventKind === 'lane_closure' ? directionNote(edge.network, pn, laneSel) : null;
  const targets = bothDirs && partner ? [edge, partner] : [edge];
  // the both-directions box: only on a two-way street, for the road closure and the speed limit
  const bothBox = (verb: 'closes' | 'applies') => (
    <div className="ed-window">
      {partner && (
        <label className="ed-check">
          <input type="checkbox" checked={bothDirs} onChange={(e) => setBothDirs(e.target.checked)} data-testid="both-directions" />
          both directions ({edgeLabel(partner.network.name, partner.id)} too)
        </label>
      )}
      <div className="ed-note-strong" data-testid="drop-direction-note">{applyNote(edge.network, pn, bothDirs, verb)}</div>
    </div>
  );
  const bothVerb: 'closes' | 'applies' | null =
    eventKind === 'road_closure' ? 'closes' : eventKind === null && kind !== 'bike_lane' ? 'applies' : null;

  return (
    <div className="ed-card" data-testid={kind ? 'drop-form' : 'edge-palette'}>
      <div className="ed-kicker">{kind ? `NEW MEMBER · ${KIND_TITLE[kind]}` : 'EDIT THIS ROAD'}</div>
      <div className="ed-title">{edgeLabel(edge.network.name, edge.id)}</div>
      <div className="ed-muted">
        {betweenText ? `${betweenText} · ` : ''}
        {laneCount} {laneCount === 1 ? 'lane' : 'lanes'} · {edge.car_lane_count} car {edge.car_lane_count === 1 ? 'lane' : 'lanes'} this direction · current speed{' '}
        {(edge.speed_mps * 3.6).toFixed(0)} km/h
      </div>

      {/* ONE both-directions box per form: the speed section's (road card / speed form) or the road
          closure's — never two `drop-direction-note`s; the lane closure carries its own note. */}
      {bothVerb && bothBox(bothVerb)}

      {(!kind || kind === 'speed_limit') && (
          <div className="ed-section">
            <label className="ed-field">
              <span className="ed-muted">New speed limit (m/s)</span>
              <input
                type="number"
                min={1}
                step={0.1}
                value={speed}
                onChange={(e) => setSpeed(Math.max(1, Number(e.target.value) || 1))}
                className="ed-input"
                data-testid="palette-speed"
              />
            </label>
            <button
              className="btn btn-primary"
              disabled={submitting}
              onClick={() => onSpeedLimits(targets.map((t) => ({
                type: 'speed_limit', target_edge: t.id, value_mps: speed,
                description: `Speed limit on ${clientEdgeRef(t.network.name, t.id)} -> ${speed} m/s`,
              })))}
              data-testid="apply-speed"
            >
              Apply speed limit
            </button>
          </div>
      )}

      {(!kind || kind === 'bike_lane') && (
        <>
          <div className="ed-section">
            <button
              className="btn btn-secondary ed-wide"
              disabled={!edge.eligible_bike_lane || submitting}
              title={edge.eligible_bike_lane ? undefined : edge.eligibility_reason}
              onClick={onBikeLane}
              data-testid="apply-bike-lane"
            >
              Convert curbside lane to bike lane
            </button>
            {!edge.eligible_bike_lane && (
              <div className="ed-hint" data-testid="bike-ineligible-reason">
                {edge.eligibility_reason}
              </div>
            )}
          </div>
        </>
      )}

      {/* V2.2c — temporary events (closures + incident). Mechanical copy only, never asserted benefit. */}
      <div className="ed-section">
        {!kind && (
          <>
            <div className="ed-label">Close / disrupt</div>
            {/* V2.7d C8b: the kind row is a SEGMENTED control (aria-pressed = the picked kind) */}
            <div className="ed-seg" role="group" aria-label="Close / disrupt">
              <button type="button" aria-pressed={eventKind === 'lane_closure'}
                      onClick={() => pickKind('lane_closure')} data-testid="palette-type-lane-closure">
                Close lanes
              </button>
              <button type="button" aria-pressed={eventKind === 'road_closure'}
                      onClick={() => pickKind('road_closure')} data-testid="palette-type-road-closure">
                Close road
              </button>
              <button type="button" aria-pressed={eventKind === 'incident'}
                      onClick={() => pickKind('incident')} data-testid="palette-type-incident">
                Incident
              </button>
            </div>
          </>
        )}

        {eventKind === 'lane_closure' && (
          <>
            <div className="ed-label">Which lanes — from this road&rsquo;s lane table</div>
            {lanePicker(true)}
            {note && (
              <div className="ed-note-strong" data-testid="drop-direction-note">
                {note}
              </div>
            )}
            {windowBlock(false)}
            <button className="btn btn-primary ed-mt"
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
            <button className="btn btn-primary ed-mt"
                    disabled={!canApply}
                    onClick={() => onRoadClosures(targets.map((t) => ({
                      type: 'road_closure', target_edge: t.id, ...(window ? { window } : {}),
                    })))}
                    data-testid="apply-road-closure">
              Close the whole road
            </button>
          </>
        )}

        {eventKind === 'incident' && (
          <>
            <div className="ed-label">Blocked lanes (optional if a slowdown is set)</div>
            {lanePicker(false)}
            <label className="ed-field ed-window">
              <span className="ed-muted">Slowdown</span>
              <select value={slowdown} onChange={(e) => setSlowdown(e.target.value as typeof slowdown)}
                      className="ed-input" data-testid="incident-slowdown">
                <option value="">none</option>
                <option value="75">to 75% speed</option>
                <option value="50">to 50% speed</option>
                <option value="25">to 25% speed</option>
              </select>
            </label>
            {windowBlock(true)}
            <button className="btn btn-primary ed-mt"
                    disabled={!canApply}
                    onClick={() =>
                      window && onIncident({ lanes: laneSel.primary, speedFactor: slowdown === '' ? null : Number(slowdown) / 100, window })}
                    data-testid="apply-incident">
              Add incident
            </button>
          </>
        )}
      </div>

      <div className="ed-actions">
        <button className="ed-link" onClick={onCancel} disabled={submitting} data-testid="palette-cancel">
          cancel
        </button>
      </div>
      {submitError && (
        <div className="ed-warn" data-testid="palette-error">
          {submitError}
        </div>
      )}
    </div>
  );
}

// V2.7d C8b — every look lives in app/nadi.css under `.nadi-shell .ed-*` / `.btn` (the rail carries the class).
