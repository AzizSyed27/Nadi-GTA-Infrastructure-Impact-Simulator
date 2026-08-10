'use client';

import type { SimChange } from '@/lib/api';
import { fmtWindowRange } from '@/lib/simTime';
import { memberWindow } from '@/lib/draftBlockers';

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
}

interface DraftPanelProps {
  members: DraftMember[];
  tags: string[];
  blockers: string[];
  demandProfile: 'synthetic_demo' | 'calibrated_am_peak';
  submitting: boolean;
  error: string | null;
  onRemove: (id: string) => void;
  onRun: () => void;
  onHover: (id: string | null) => void;
}

/** Mechanical one-line member summary (the RunCard chip conventions — type + edge + details +
 * window; no server-prose ports, no asserted benefit). */
function memberSummary(c: SimChange, profile: 'synthetic_demo' | 'calibrated_am_peak'): string {
  let base: string;
  switch (c.type) {
    case 'speed_limit':
      base = `Speed limit ${Math.round(c.value_mps * 3.6)} km/h · ${c.target_edge}`;
      break;
    case 'bike_lane':
      base = `Bike lane · ${c.target_edge}`;
      break;
    case 'lane_closure':
      // optional-chained like the incident case: cloned members arrive through a loose status-dict
      // cast, and a malformed one must render a wrong count, never crash the panel
      base = `${c.target_lanes?.length ?? 0} lane(s) closed · ${c.target_edge}`;
      break;
    case 'road_closure':
      base = `Road closed · ${c.target_edge}`;
      break;
    case 'incident':
      base =
        `Incident · ${c.target_edge}` +
        (c.effect?.blocked ? ` · ${c.target_lanes?.length ?? 0} lane(s) blocked` : '') +
        (c.effect?.speed_factor != null ? ` · slowed to ${Math.round(c.effect.speed_factor * 100)}%` : '');
      break;
    case 'new_road':
      base = `New road · ${c.from_junction} → ${c.to_junction}`;
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
  members, tags, blockers, demandProfile, submitting, error, onRemove, onRun, onHover,
}: DraftPanelProps) {
  const n = members.length;
  const canRun = !submitting && n > 0 && blockers.length === 0;
  return (
    <div style={card} data-testid="draft-panel">
      <div style={titleRow}>
        <span style={title}>Draft scenario ({n})</span>
        {tags.includes('school_zone') && (
          <span style={tagChip} data-testid="draft-tag">
            school_zone
          </span>
        )}
      </div>
      <ul style={memberList}>
        {members.map((m) => (
          <li
            key={m.id}
            style={memberRow}
            data-testid={`draft-member-${m.id}`}
            onMouseEnter={() => onHover(m.id)}
            onMouseLeave={() => onHover(null)}
          >
            <span style={memberText}>{memberSummary(m.change, demandProfile)}</span>
            <button
              style={removeBtn}
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
      {blockers.map((b) => (
        <div key={b} style={blockerText} data-testid="draft-blocker">
          {b}
        </div>
      ))}
      <button
        style={{ ...primaryBtn, ...(canRun ? null : disabledBtn) }}
        disabled={!canRun}
        onClick={onRun}
        data-testid="draft-run"
      >
        {submitting ? 'Submitting…' : `Run scenario (${n} change${n === 1 ? '' : 's'})`}
      </button>
      {error && (
        <div style={errText} data-testid="draft-error">
          {error}
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
const titleRow: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 };
const title: React.CSSProperties = { fontSize: 14, fontWeight: 700 };
const tagChip: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 600, color: '#7a5b0a', background: '#fdeec7',
  border: '1px solid #e8cf8a', borderRadius: 999, padding: '1px 8px',
};
const memberList: React.CSSProperties = { listStyle: 'none', margin: '0 0 8px', padding: 0, maxHeight: 180, overflowY: 'auto' };
const memberRow: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '3px 0' };
const memberText: React.CSSProperties = { fontSize: 11.5, lineHeight: 1.4, wordBreak: 'break-all' };
const removeBtn: React.CSSProperties = { border: 'none', background: 'transparent', color: '#8a9099', cursor: 'pointer', fontSize: 12 };
const blockerText: React.CSSProperties = { marginTop: 6, fontSize: 12, color: '#b23a3a', lineHeight: 1.5 };
const primaryBtn: React.CSSProperties = {
  marginTop: 10,
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
const errText: React.CSSProperties = { marginTop: 8, fontSize: 12, color: '#b23a3a' };
