'use client';

import { useEffect, useState } from 'react';

import { getProjection, type SimChange } from '@/lib/api';
import { STATIC_DEMO } from '@/lib/demo';
import { fmtWindowRange } from '@/lib/simTime';
import { memberWindow, type Blocker } from '@/lib/draftBlockers';
import { edgeLabel } from '@/lib/streetNames';

/**
 * V2.4a — one basket member. `change` is the EXACT wire object the palette callbacks build (the
 * single-change regression pin depends on submitting these references untouched). `valid` is
 * always true this step — the palettes gate Add — and exists for V2.4c member editing. `origin`
 * marks zone-macro members (the derived school_zone tag); `path` carries a new_road's two
 * junction coords captured at add time (a minted road has no canonical-network geometry).
 */
export interface DraftMember {
  id: string;
  change: SimChange;
  valid: boolean;
  origin?: 'zone';
  path?: [number, number][];
  /** V2.7d C5: where a DROPPED member landed (lon/lat) — its tile icon is pinned there; absent otherwise. */
  at?: [number, number];
}

interface DraftPanelProps {
  members: DraftMember[];
  tags: string[];
  /** V2.7d C6: blocker CARDS — the engine sentence verbatim + the resolution each offers. */
  blockers: Blocker[];
  onSwitchDayOne: () => void;
  onRemoveWindow: (id: string) => void;
  onRemoveMember: (id: string) => void;
  demandProfile: 'synthetic_demo' | 'calibrated_am_peak';
  submitting: boolean;
  error: string | null;
  onRemove: (id: string) => void;
  onRun: () => void;
  onHover: (id: string | null) => void;
  /** V2.7d: the street name for an edge id from the network export, null when unnamed. */
  nameOf: (id: string) => string | null;
}

/** Mechanical one-line member summary (the RunCard chip conventions — type + edge + details +
 * window; no server-prose ports, no asserted benefit). */
function memberSummary(c: SimChange, profile: 'synthetic_demo' | 'calibrated_am_peak',
                       nameOf: (id: string) => string | null): string {
  let base: string;
  // V2.7d: the edge reads name-plus-id (`Markham Road (edge X)`), id-only (`edge X`) when unnamed
  const edge = 'target_edge' in c && c.target_edge ? edgeLabel(nameOf(c.target_edge), c.target_edge) : '';
  switch (c.type) {
    case 'speed_limit':
      base = `Speed limit ${Math.round(c.value_mps * 3.6)} km/h · ${edge}`;
      break;
    case 'bike_lane':
      base = `Bike lane · ${edge}`;
      break;
    case 'lane_closure':
      // optional-chained like the incident case: cloned members arrive through a loose status-dict
      // cast, and a malformed one must render a wrong count, never crash the panel
      base = `${c.target_lanes?.length ?? 0} lane(s) closed · ${edge}`;
      break;
    case 'road_closure':
      base = `Road closed · ${edge}`;
      break;
    case 'incident':
      base =
        `Incident · ${edge}` +
        (c.effect?.blocked ? ` · ${c.target_lanes?.length ?? 0} lane(s) blocked` : '') +
        (c.effect?.speed_factor != null ? ` · slowed to ${Math.round(c.effect.speed_factor * 100)}%` : '');
      break;
    case 'new_road':
      base =
        `New road · ${c.from_junction} → ${c.to_junction}` +
        (c.via?.length ? ` · ${c.via.length} bend${c.via.length === 1 ? '' : 's'}` : '');
      break;
  }
  const w = memberWindow(c);
  return w ? `${base} · ${fmtWindowRange(w, profile)}` : base;
}

/**
 * V2.4a — the draft basket panel: the editable member list, the draft-time blockers (shared
 * reason strings VERBATIM — the client never invents its own phrasing), and the one Run button
 * that submits the whole draft. Run is disabled ONLY while a blocker exists (or mid-submit);
 * a server 400/409 renders verbatim below and the draft is retained for edit-and-retry.
 */
export function DraftPanel({
  members, tags, blockers, demandProfile, submitting, error, onRemove, onRun, onHover, nameOf,
  onSwitchDayOne, onRemoveWindow, onRemoveMember,
}: DraftPanelProps) {
  const n = members.length;
  const canRun = !submitting && n > 0 && blockers.length === 0;
  // fetched once per mount: the projection is a property of the server's configuration, not of the
  // draft, so it does not change while a reader edits members
  const [spend, setSpend] = useState<{ calls: number; basis: string; armed: boolean } | null>(null);
  useEffect(() => {
    if (STATIC_DEMO) return; // the demo has no API, and pressing Run is disabled there anyway
    void getProjection().then((r) => setSpend(r.ok ? r.value : null));
  }, []);
  return (
    // V2.7d C8a — looks only: the DS classes (app/nadi.css `.ed-*`, `.btn`) resolve under the rail's
    // `.nadi-shell`; every testid and string below is frozen.
    <div className="ed-card" data-testid="draft-panel">
      <div className="ed-kicker">03 · DRAFT</div>
      <div style={titleRow}>
        <span className="ed-title" style={{ marginBottom: 0 }}>Draft scenario ({n})</span>
        {tags.includes('school_zone') && (
          <span className="tag tag-accent" data-testid="draft-tag">
            school_zone
          </span>
        )}
      </div>
      <ul className="ed-members">
        {members.map((m) => (
          <li
            key={m.id}
            className="ed-member"
            data-testid={`draft-member-${m.id}`}
            onMouseEnter={() => onHover(m.id)}
            onMouseLeave={() => onHover(null)}
          >
            <span className="ed-member-text">{memberSummary(m.change, demandProfile, nameOf)}</span>
            <button
              className="ed-x"
              onClick={() => onRemove(m.id)}
              disabled={submitting}
              data-testid={`draft-remove-${m.id}`}
              aria-label={`remove ${m.id}`}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      {/* V2.7d C6 — THE BLOCKER CARD (the ratified §1c "BLOCKER · ENGINE SENTENCE, VERBATIM" + resolution
          buttons). The sentence stays the shared change_scheduler literal, byte for byte; the buttons act
          on the member the card points at. An incident's window is REQUIRED server-side, so its card
          says so and offers removal instead of the window. */}
      {blockers.map((b) => {
        const member = members[b.memberIdx];
        return (
          <div key={b.reason} className="ed-refusal" data-testid="draft-blocker-card">
            <div className="ed-refusal-kicker">BLOCKER · ENGINE SENTENCE, VERBATIM</div>
            <div className="ed-sentence" data-testid="draft-blocker">
              {b.reason}
            </div>
            <div className="ed-fixes">
              {b.fix === 'switch_day_one' && (
                <button className="btn btn-secondary" onClick={onSwitchDayOne} data-testid="blocker-switch-day-one">
                  SWITCH TO DAY-ONE
                </button>
              )}
              {b.fix === 'remove_window' && member && (
                <button className="btn btn-secondary" onClick={() => onRemoveWindow(member.id)} data-testid="blocker-remove-window">
                  REMOVE THE WINDOW
                </button>
              )}
              {b.fix === 'remove_member' && member && (
                <>
                  <span className="ed-note">an incident needs its window — remove the member instead</span>
                  <button className="btn btn-secondary" onClick={() => onRemoveMember(member.id)} data-testid="blocker-remove-member">
                    REMOVE THE MEMBER
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
      {/* V2.7b C10b — THE PRE-SPEND SENTENCE. Deliberately NOT a blocker: it uses the neutral note
          style rather than the red one, and `canRun` is untouched — a cost notice tells you what
          pressing this costs, it does not stop you. The number is the SERVER'S (one function also
          used to write the ledger's projection); if the endpoint is unreachable the sentence loses
          its number rather than inventing one, and if the chain is disarmed it says so instead of
          promising a spend that will not happen. */}
      <div className="ed-hint" data-testid="draft-spend-note">
        {spend == null
          ? 'Runs the physics, then interpretation — skippable.'
          : spend.armed
            ? `Runs the physics, then interpretation (~${spend.calls.toLocaleString()} model calls, skippable).`
            : 'Runs the physics. Interpretation is off on this server — nothing is spent.'}
      </div>
      <div className="ed-actions">
        <button
          className="btn btn-primary"
          disabled={!canRun}
          onClick={onRun}
          data-testid="draft-run"
        >
          {submitting ? 'Submitting…' : `Run scenario (${n} change${n === 1 ? '' : 's'})`}
        </button>
      </div>
      {blockers.length > 0 && (
        <div className="ed-hint" data-testid="draft-run-blocked-note">
          blocked — resolve the conflict on member {blockers[0].memberIdx + 1} to run
        </div>
      )}
      {error && (
        <div className="ed-warn" data-testid="draft-error">
          {error}
        </div>
      )}
    </div>
  );
}

// V2.7d C8a — the one layout rule that stays inline (a flex row for the title + the school-zone tag);
// every look lives in app/nadi.css under `.nadi-shell .ed-*`.
const titleRow: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 };
