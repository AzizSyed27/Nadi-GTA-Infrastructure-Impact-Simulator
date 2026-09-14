'use client';

import { useState } from 'react';
import type { ChangeWindow, Junction, Edge, RunOptions, RunStatus, SimChange } from '@/lib/api';
import type { RunFeed } from '@/lib/useRunFeed';
import type { Agent, Scorecard } from '@/lib/types';
import { RunCard } from '@/components/RunCard';
import { ScorecardPanel } from '@/components/ScorecardPanel';
import { DropForm, type DropKind } from '@/components/DropForm';
import type { Blocker } from '@/lib/draftBlockers';
import { VIA_CAP } from '@/lib/viaRules';

/** What a tile arms: the five drop kinds, plus the two that enter their own modes (zone-select, the draw). */
export type ArmKind = DropKind | 'school_zone' | 'new_road';

const TILES: { kind: ArmKind; testid: string; label: string }[] = [
  { kind: 'road_closure', testid: 'tile-road-closure', label: 'ROAD CLOSURE' },
  { kind: 'lane_closure', testid: 'tile-lane-closure', label: 'LANE CLOSURE' },
  { kind: 'speed_limit', testid: 'tile-speed-limit', label: 'SPEED LIMIT' },
  { kind: 'incident', testid: 'tile-incident', label: 'TIMED INCIDENT' },
  { kind: 'bike_lane', testid: 'tile-bike-lane', label: 'BIKE-LANE CONVERSION' },
  // the SCHOOL ZONE tile keeps the `zone-mode-toggle` testid — school-zone.spec / draft-basket.spec ride it
  { kind: 'school_zone', testid: 'zone-mode-toggle', label: '🏫 SCHOOL ZONE' },
  { kind: 'new_road', testid: 'tile-draw-road', label: 'DRAW A NEW ROAD' },
];

/** V2.7d C4b — "02 · ADD A CHANGE": the seven tiles (the ratified §1c palette). A tile ARMS a kind; the
 *  next road click carries it into the drop form (C5 adds the pointer drag onto the road). The zone and
 *  draw tiles enter the existing modes. Looks are C8's. */
const DRAG_THRESHOLD_PX = 6;
const isDropKind = (k: ArmKind): k is DropKind => k !== 'school_zone' && k !== 'new_road';

function ChangeTiles({ armed, onArm, onDrop, dropMiss }: {
  armed: ArmKind | null; onArm: (k: ArmKind) => void;
  onDrop: (kind: DropKind, clientX: number, clientY: number) => void; dropMiss: boolean;
}) {
  // V2.7d C5 — POINTER-based drag (never HTML5 DnD onto the canvas): pointerdown captures the pointer
  // on the tile, a fixed DOM ghost follows it, and pointerup past the threshold is a DROP at the
  // release point (MapView picks the road there). A release within the threshold is the click — ARM.
  const [drag, setDrag] = useState<{ kind: DropKind; label: string; x: number; y: number; moved: boolean; x0: number; y0: number } | null>(null);
  const onPointerDown = (t: (typeof TILES)[number]) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isDropKind(t.kind) || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ kind: t.kind, label: t.label, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false });
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY, moved: d.moved || Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > DRAG_THRESHOLD_PX } : d));
  };
  const onPointerUp = (t: (typeof TILES)[number]) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const d = drag;
    setDrag(null);
    if (d.moved && isDropKind(t.kind)) onDrop(t.kind, e.clientX, e.clientY);
    else onArm(t.kind);
  };
  return (
    <div className="ed-card" data-testid="change-tiles">
      <div className="ed-kicker">02 · ADD A CHANGE</div>
      <div className="ed-title">Add a change</div>
      <div className="ed-muted">drag a change onto a road — or pick it, then click the road it applies to</div>
      <div className="ed-tiles">
        {TILES.map((t) => (
          <button
            key={t.kind}
            className="ed-tile"
            aria-pressed={armed === t.kind}
            onClick={isDropKind(t.kind) ? undefined : () => onArm(t.kind)}
            onPointerDown={onPointerDown(t)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp(t)}
            data-testid={t.testid}
          >
            {t.label}
          </button>
        ))}
      </div>
      {dropMiss && (
        <div className="ed-warn" data-testid="drop-miss">
          That spot is not on a road — drop the change onto a road.
        </div>
      )}
      {drag?.moved && (
        // the ghost keeps the tile's PRESSED look through `ed-tile-ghost` (no test sees it — stated)
        <div className="ed-tile ed-tile-ghost" style={{ position: 'fixed', left: drag.x, top: drag.y, transform: 'translate(-50%, -50%)', pointerEvents: 'none', zIndex: 20 }}>
          {drag.label}
        </div>
      )}
    </div>
  );
}
import { ZonePalette } from '@/components/ZonePalette';
import { DraftPanel, type DraftMember } from '@/components/DraftPanel';

export interface DrawParams {
  lanes: number;
  speed_mps: number;
  bidirectional: boolean;
}

interface EditPanelProps {
  ptA: Junction | null;
  ptB: Junction | null;
  viaCount: number; // V2.6d — bends placed so far (empty-map clicks mid-draw)
  onUndoBend: () => void; // pop the last bend (the visible mirror of Escape)
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
  // V2.7b C3: the poll + stream live in MapView's useRunFeed; the card renders what the feed holds.
  feed: RunFeed;
  // V2.3a: voices streamed so far (arrival order) — the live ticker while enrich generates; cleared by
  // the parent when the done-edge reload swaps in the authoritative artifact.
  streamedVoices: Agent[];
  runLoaded: boolean; // the active run's artifact is the one currently shown (honesty flags are trustworthy)
  hasVoices: boolean;
  hasSocial: boolean;
  scorecard: Scorecard | undefined; // the active run's scorecard (shown once its artifact is loaded)
  // edit-an-edge (5.2b)
  selectedEdge: Edge | null;
  /** V2.7d C4a: the kind that arrived with the selection (a drop); null = the road card. */
  dropKind: DropKind | null;
  /** V2.7d C4b: the tile currently ARMED (the accessible drop path) — the next road click carries it. */
  armedKind: ArmKind | null;
  onArm: (kind: ArmKind) => void;
  /** V2.7d C5: a tile DROPPED on the map at client pixels — MapView picks the road under the pointer. */
  onDrop: (kind: DropKind, clientX: number, clientY: number) => void;
  /** The last drop landed on no road (shown ~1.5 s). */
  dropMiss: boolean;
  /** The selected edge's node-pair partner (the opposite direction), merged; null on a one-way street. */
  dropPartner: Edge | null;
  /** The cross-street line for the selected edge ("between X and Y" / "near X"), or null. */
  dropBetween: string | null;
  canEditEdges: boolean; // zoomed in enough that existing edges are rendered/clickable
  /** V2.7d C4b: one `speed_limit` member per directional edge (two with the both-directions box). */
  onEdgeSpeeds: (members: SimChange[]) => void;
  onEdgeBike: () => void;
  onEdgeCancel: () => void;
  // V2.2c — temporary events (closures + incident) + the windowed → day_one lock
  /** V2.7d C4a: one `lane_closure` member per directional edge with a tick (the both-directions form). */
  onEdgeLaneClosures: (members: SimChange[]) => void;
  /** V2.7d C4b: one `road_closure` member per directional edge (two with the both-directions box). */
  onEdgeRoadClosures: (members: SimChange[]) => void;
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
  // V2.4c — clone a finished run's changes[] into a fresh draft (RunCard button)
  onClone: (st: RunStatus) => void;
  // V2.4a — the draft basket (applies ADD members; one Run submits the whole draft)
  draftMembers: DraftMember[];
  /** V2.7d: street name for an edge id (network export), null when unnamed — the draft rows read it. */
  nameOf: (id: string) => string | null;
  draftTags: string[];
  draftBlockers: Blocker[]; // V2.7d C6: cards — the shared reason verbatim + the fix each offers
  onDraftSwitchDayOne: () => void;
  onDraftRemoveWindow: (id: string) => void;
  onDraftRemoveMember: (id: string) => void;
  draftError: string | null; // Run failures (400/409), verbatim
  onDraftRemove: (id: string) => void;
  onDraftRun: () => void;
  onDraftHover: (id: string | null) => void; // row hover → map overlay highlight
}

// RATIFIED phase-5 road defaults — a two-way, two-lane, ~50 km/h street (what a planner usually draws, and
// what 5.1's acceptance run drew). NOT the backend SimChange request defaults (lanes 1 / one-way), which stay
// conservative on the wire; the FORM presents the ratified product decision.
const DEFAULTS: DrawParams = { lanes: 2, speed_mps: 13.9, bidirectional: true };
/** V2.7c C5: the draw PREVIEW renders the road at this lane count until the form is filled in. */
export const DEFAULT_DRAW_PARAMS: Readonly<DrawParams> = DEFAULTS;

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
      <div className="ed-label">
        <span className="ed-code">{ptA.id}</span> → <span className="ed-code">{ptB.id}</span>
      </div>
      <label className="ed-field">
        <span className="ed-muted">Lanes (per direction)</span>
        <input
          type="number"
          min={1}
          value={params.lanes}
          onChange={(e) => setParams((p) => ({ ...p, lanes: Math.max(1, Number(e.target.value) || 1) }))}
          className="ed-input"
          data-testid="param-lanes"
        />
      </label>
      <label className="ed-field">
        <span className="ed-muted">Speed (m/s)</span>
        <input
          type="number"
          min={1}
          step={0.1}
          value={params.speed_mps}
          onChange={(e) => setParams((p) => ({ ...p, speed_mps: Math.max(1, Number(e.target.value) || 1) }))}
          className="ed-input"
          data-testid="param-speed"
        />
      </label>
      <label className="ed-check">
        <input
          type="checkbox"
          checked={params.bidirectional}
          onChange={(e) => setParams((p) => ({ ...p, bidirectional: e.target.checked }))}
          data-testid="param-bidirectional"
        />
        Two-way (both directions)
      </label>

      <div className="ed-actions">
        <button
          className="btn btn-primary"
          disabled={submitting}
          onClick={() => onSubmit(params)}
          data-testid="simulate-btn"
        >
          {submitting ? 'Submitting…' : 'Add to draft'}
        </button>
        <button className="ed-link" onClick={onReset} disabled={submitting} data-testid="params-cancel">
          cancel
        </button>
      </div>
      {submitError && (
        <div className="ed-warn" data-testid="submit-error">
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
  const demand = options.demand_profile ?? 'synthetic_demo';
  const settled = !windowLocked && assignment === 'settled';
  const setDemand = (d: RunOptions['demand_profile']) => onChange({ ...options, demand_profile: d });
  return (
    <div className="ed-card" data-testid="run-options">
      <div className="ed-kicker">01 · RUN OPTIONS</div>
      {/* V2.7d C8a — the ratified §1c SEGMENTED controls. TRAFFIC is two pressed-state buttons (the
          <select> is gone; closure-palette.spec migrated in the same commit). RESPONSE keeps the REAL
          `option-assignment` checkbox — four specs .check()/.uncheck()/toBeDisabled() it — inside its
          segmented row beside a DAY-ONE button; the D1 lock sentence is verbatim, as before. */}
      <div className="ed-label">Traffic volumes</div>
      <div className="ed-seg" role="group" aria-label="Traffic volumes">
        <button type="button" aria-pressed={demand === 'synthetic_demo'} onClick={() => setDemand('synthetic_demo')} data-testid="option-demand-synthetic">
          Synthetic demo
        </button>
        <button type="button" aria-pressed={demand === 'calibrated_am_peak'} onClick={() => setDemand('calibrated_am_peak')} data-testid="option-demand-calibrated">
          Calibrated counts
        </button>
      </div>
      <div className="ed-hint">
        {/* the old <option> texts, kept on the surface as the explainer line (looks only — no new copy) */}
        {demand === 'calibrated_am_peak' ? 'Calibrated AM peak (count-anchored; slower)' : 'Synthetic demo (fast)'}
      </div>
      <div className="ed-label">Response</div>
      <div className="ed-seg" role="group" aria-label="Response">
        <button
          type="button"
          aria-pressed={!settled}
          disabled={windowLocked}
          onClick={() => onChange({ ...options, assignment: 'day_one' })}
          data-testid="option-assignment-day-one"
        >
          Day-one
        </button>
        <label className={settled ? 'ed-seg-on' : windowLocked ? 'ed-seg-locked' : undefined}>
          <input
            type="checkbox"
            checked={settled}
            disabled={windowLocked}
            onChange={(e) => onChange({ ...options, assignment: e.target.checked ? 'settled' : 'day_one' })}
            data-testid="option-assignment"
          />
          Settled response
        </label>
      </div>
      {windowLocked && (
        // the EXACT D1 sentence — client copy of change_scheduler.REASON_WINDOWED_SETTLED
        // (python/src/change_scheduler.py); the server 400 with the same words is the backstop.
        <div className="ed-warn" data-testid="assignment-locked-reason">
          temporary events have no equilibrium; use day-one response
        </div>
      )}
      <div className="ed-hint">
        Day-one response: travelers react with today&apos;s habits (minutes). Settled response: travelers
        have adjusted to the change (iterated assignment; takes substantially longer).
      </div>
      <label className="ed-check" style={{ marginTop: 'var(--space-3)' }}>
        <input
          type="checkbox"
          checked={seeds === 3}
          onChange={(e) => onChange({ ...options, n_seeds: e.target.checked ? 3 : 1 })}
          data-testid="option-seeds"
        />
        Robustness probe (3 seeds)
      </label>
      <div className="ed-hint">
        Runs the baseline+scenario pair three times (seeds 42, 43, 44) and shows per-cell ranges —
        roughly 3&times; the simulation time.
      </div>
      {seeds === 3 && options.demand_profile === 'calibrated_am_peak' && (
        <div className="ed-warn" data-testid="seeds-cost-warning">
          With calibrated demand this is a batch-scale run — expect hours, not minutes.
        </div>
      )}
    </div>
  );
}

export function EditPanel(props: EditPanelProps) {
  const { ptA, ptB, hint, submitting, submitError, onSubmit, onReset, activeRunId, onDrawAnother } = props;

  return (
    // V2.7d C8a — the rail carries `.nadi-shell` ITSELF so the DS classes resolve inside it; the
    // pointer-events pair (rail none / each card auto) is untouched and stays inline.
    <div className="nadi-shell" style={rail} data-testid="edit-panel">
      {/* V2.7a: the edit-rail run picker retired — the header's run list (RunListPopover) is
          the one open/clone/compare surface; Compare keeps its two RunSwitcher instances. */}
      {!activeRunId && (
        <RunOptionsBlock options={props.runOptions} onChange={props.onRunOptions} windowLocked={props.windowLocked} />
      )}
      {/* V2.7d C4b — 02 · ADD A CHANGE: the seven tiles, always in the rail while composing */}
      {!activeRunId && <ChangeTiles armed={props.armedKind} onArm={props.onArm} onDrop={props.onDrop} dropMiss={props.dropMiss} />}

      {activeRunId ? (
        <>
          <RunCard key={activeRunId} runId={activeRunId} feed={props.feed} onClone={props.onClone} />
          {props.streamedVoices.length > 0 && (
            <div className="ed-card" data-testid="voice-stream-panel">
              <div className="ed-muted">
                Voices streaming in — {props.streamedVoices.length} so far (anticipated reactions, not a poll)
              </div>
              {props.streamedVoices
                .slice(-STREAM_SHOWN)
                .reverse()
                .map((a, i) => (
                  <div key={`${a.persona.id}:${props.streamedVoices.length - i}`} className="ed-voice" data-testid="voice-stream-row">
                    <span className="ed-voice-label">
                      {a.persona.label}
                      {a.grounding === 'inferred' ? ' — community perspective' : a.grounding === 'mandate' ? ' — institutional (mandate lens)' : ''}
                    </span>
                    <span className="ed-voice-text">{a.reaction.comment}</span>
                  </div>
                ))}
              {props.streamedVoices.length > STREAM_SHOWN && (
                <div className="ed-caption">…and {props.streamedVoices.length - STREAM_SHOWN} earlier</div>
              )}
            </div>
          )}
          {props.runLoaded && (
            <div style={{ flexShrink: 0 }}>
              <ScorecardPanel scorecard={props.scorecard} activeGroup={null} onSelectGroup={() => {}} />
            </div>
          )}
          <div className="ed-card">
            {props.runLoaded && (
              <>
                <div className="ed-muted" data-testid="run-contains">
                  This run has: scorecard ✓ · voices {props.hasVoices ? '✓' : '—'} · discourse{' '}
                  {props.hasSocial ? '✓' : '—'}
                </div>
                {!props.hasVoices && (
                  <div className="ed-hint" data-testid="no-voices">
                    No stakeholder voices yet — run <b>voices</b> above to hear individual anticipated reactions.
                  </div>
                )}
                {!props.hasSocial && (
                  <div className="ed-hint" data-testid="no-discourse">
                    Discourse not run — run <b>discourse</b> above to unlock the cascade view.
                  </div>
                )}
              </>
            )}
            <button className="btn btn-secondary" style={{ marginTop: 'var(--space-2)' }} onClick={onDrawAnother} data-testid="draw-another">
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
        <DropForm
          key={`${props.selectedEdge.id}:${props.dropKind ?? 'card'}`}
          edge={props.selectedEdge}
          partner={props.dropPartner}
          betweenText={props.dropBetween}
          kind={props.dropKind}
          demandProfile={props.runOptions.demand_profile ?? 'synthetic_demo'}
          submitting={submitting}
          submitError={submitError}
          onSpeedLimits={props.onEdgeSpeeds}
          onBikeLane={props.onEdgeBike}
          onLaneClosures={props.onEdgeLaneClosures}
          onRoadClosures={props.onEdgeRoadClosures}
          onIncident={props.onEdgeIncident}
          onWindowedDraft={props.onWindowedDraft}
          onCancel={props.onEdgeCancel}
        />
      ) : (
        <div className="ed-card" data-testid="draw-card">
          <div className="ed-title">Draw a road</div>
          {props.junctionsDown ? (
            <div className="ed-warn" data-testid="junctions-down">
              Junctions unavailable — start the backend (<code>uvicorn server:app --port 8000</code>), then
              re-enter Edit mode.
            </div>
          ) : (
            !ptA && <div>Click a junction on the map to start.</div>
          )}
          {!ptA && !props.junctionsDown && (
            <div className="ed-hint" data-testid="edge-zoom-hint">
              {props.canEditEdges
                ? 'Or click an existing road to change its speed limit / add a bike lane.'
                : 'Zoom in to click an existing road (speed limit / bike lane).'}
            </div>
          )}
          {/* V2.7d C4b: the school-zone entry moved onto its tile (`zone-mode-toggle` lives there now) */}
          {ptA && !ptB && (
            <div>
              Start: <span className="ed-code">{ptA.id}</span>
              <br />
              Click a second junction to finish — or click along a street to bend the road.
              {props.viaCount > 0 && (
                <div className="ed-hint" data-testid="bend-count">
                  {props.viaCount} bend{props.viaCount === 1 ? '' : 's'} (Esc removes the last){' '}
                  <button className="ed-link" onClick={props.onUndoBend} data-testid="undo-bend">
                    undo bend
                  </button>
                </div>
              )}
              <div className="ed-actions">
                <button className="ed-link" onClick={onReset} data-testid="draw-cancel">
                  cancel
                </button>
              </div>
              {/* V2.7d C7 — the ratified §1e caption: the via count against the cap, the two ways out */}
              <div className="ed-caption" data-testid="draw-caption">
                VIA {props.viaCount} OF {VIA_CAP} · CLICK A JUNCTION TO END · ESC CANCELS
              </div>
            </div>
          )}
          {hint && (GENERIC_HINTS.has(hint) ? (
            <div className="ed-warn" data-testid="draw-hint">
              {hint}
            </div>
          ) : (
            // V2.7d C7 — the ratified §1e container for a REFUSED click: the treatment is designed, the
            // words are not (the sentence stays the server's own, verbatim, under the same `draw-hint` pin)
            <div className="ed-refusal" data-testid="draw-refusal">
              <div className="ed-refusal-kicker">REFUSED · ENGINE SENTENCE, VERBATIM</div>
              <div className="ed-sentence" data-testid="draw-hint">
                {hint}
              </div>
              <div className="ed-note">the click is not added — the drawing stays as it was; click farther along to continue</div>
            </div>
          ))}
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
      {/* V2.4a — the draft basket, LAST in the rail (palette/draw-card positions stay stable). */}
      {!activeRunId && props.draftMembers.length > 0 && (
        <DraftPanel
          members={props.draftMembers}
          nameOf={props.nameOf}
          tags={props.draftTags}
          blockers={props.draftBlockers}
          demandProfile={props.runOptions.demand_profile ?? 'synthetic_demo'}
          submitting={submitting}
          error={props.draftError}
          onRemove={props.onDraftRemove}
          onSwitchDayOne={props.onDraftSwitchDayOne}
          onRemoveWindow={props.onDraftRemoveWindow}
          onRemoveMember={props.onDraftRemoveMember}
          onRun={props.onDraftRun}
          onHover={props.onDraftHover}
        />
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
// V2.3a — the streamed-voices ticker (newest first; capped, the rest summarized)
const STREAM_SHOWN = 6;
// V2.7d C7 — the two GENERIC draw hints are guidance, not refusals — they never get the REFUSED treatment.
const GENERIC_HINTS = new Set(['Click nearer a junction.', 'Pick a different junction for the end point.']);
// V2.7d C8a — every other look lives in app/nadi.css under `.nadi-shell .ed-*` (the rail carries the class).
