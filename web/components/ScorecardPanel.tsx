'use client';

import { useState } from 'react';

import type { Scorecard, ScorecardCell, ScorecardGroup } from '@/lib/types';
import { GROUP_LABEL, OTHER_VOICES_GROUP, SCORECARD_GROUP_ORDER } from '@/lib/personaGroups';

/**
 * The per-STAKEHOLDER scorecard (7 groups × travel_time / safety / access). Honesty is the whole point:
 *  - sign color only where a direction is claimed (travel_time = measured, access = heuristic estimate);
 *  - SAFETY renders as a ± magnitude with NO direction color — the artifact's own note says the sign is
 *    not stable across seeds, so we report magnitude and refuse the direction;
 *  - every [LOW]-confidence cell is visually muted vs the [MEAS] cells;
 *  - clicking a group row filters the feed to that group's voices (numbers → voices join).
 * NOTHING here sums across groups — this is a distribution, never a single verdict.
 */
interface ScorecardPanelProps {
  scorecard: Scorecard | undefined;
  activeGroup: string | null;
  onSelectGroup: (group: string) => void;
}

const WORSE = '#c64545';
const BETTER = '#3caa5a';
const NEUTRAL = '#6b7280';

function signColor(value: number): string {
  return value > 0 ? WORSE : value < 0 ? BETTER : NEUTRAL;
}

function fmtSigned(value: number, unit: string): string {
  const s = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${s}${Math.abs(value).toFixed(unit === 's' ? 1 : 2)}${unit}`;
}

/** Render one cell. `kind` decides the honesty treatment. */
function Cell({ cell, kind }: { cell: ScorecardCell | null | undefined; kind: 'travel' | 'safety' | 'access' }) {
  if (!cell || cell.value == null) {
    return (
      <div style={cellBox} data-testid="scorecard-cell">
        <span style={{ color: '#c2c7cf' }}>—</span>
      </div>
    );
  }
  const badge = cell.confidence === 'measured' ? 'MEAS' : 'LOW';
  const low = cell.confidence !== 'measured';

  let valueEl: React.ReactNode;
  if (kind === 'safety') {
    // Magnitude only — direction not claimed (seed-unstable sign). Neutral, no sign color.
    valueEl = <span style={{ color: NEUTRAL }}>±{Math.abs(cell.value).toFixed(2)}</span>;
  } else if (kind === 'travel') {
    valueEl = <span style={{ color: signColor(cell.value) }}>{fmtSigned(cell.value, 's')}</span>;
  } else {
    // access — directional heuristic, sign-colored but muted (it's an estimate).
    valueEl = <span style={{ color: signColor(cell.value) }}>{fmtSigned(cell.value, '')}</span>;
  }

  return (
    <div style={{ ...cellBox, ...(low ? cellLow : null) }} title={cell.note ?? undefined} data-testid="scorecard-cell">
      <div style={cellValRow}>{valueEl}</div>
      {kind === 'travel' && cell.affected_share != null && (
        <div style={cellSub}>{Math.round(cell.affected_share * 100)}% &gt;30s</div>
      )}
      <span style={badge === 'MEAS' ? badgeMeas : badgeLow}>{badge}</span>
    </div>
  );
}

export function ScorecardPanel({ scorecard, activeGroup, onSelectGroup }: ScorecardPanelProps) {
  const [open, setOpen] = useState(true);
  if (!scorecard || !scorecard.groups?.length) return null;

  const byId: Record<string, ScorecardGroup> = {};
  for (const g of scorecard.groups) byId[g.group] = g;

  // The seed-stability caveat, pulled from the data (first safety note) — the info tooltip on the column.
  const safetyCaveat =
    scorecard.groups.map((g) => g.safety_delta?.note).find(Boolean) ??
    'Safety magnitudes are not seed-stable; direction is not claimed.';

  return (
    <div style={panel} data-testid="scorecard-panel">
      <button style={header} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>PER-STAKEHOLDER OUTCOMES</span>
        <span style={{ color: '#9aa0a6' }}>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div style={body}>
          <div style={legend}>
            <span style={{ color: WORSE }}>＋ worse</span> ·{' '}
            <span style={{ color: BETTER }}>− better</span> · ± = magnitude only (direction not claimed)
          </div>

          <div style={colHead}>
            <span />
            <span style={colLabel}>travel</span>
            <span style={colLabel}>
              safety{' '}
              <span style={info} title={safetyCaveat} data-testid="safety-caveat">
                ⓘ
              </span>
            </span>
            <span style={colLabel}>access</span>
          </div>

          {SCORECARD_GROUP_ORDER.map((gid) => {
            const g = byId[gid];
            const isActive = activeGroup === gid;
            return (
              <button
                key={gid}
                data-testid="scorecard-row"
                data-group={gid}
                onClick={() => onSelectGroup(gid)}
                style={{ ...groupRow, ...(isActive ? groupRowActive : null) }}
              >
                <span style={groupLabelCol}>
                  <span style={groupName}>{GROUP_LABEL[gid]}</span>
                  <span style={g?.grounding === 'inferred' ? chipInferred : chipSim}>
                    {g?.grounding ?? 'inferred'}
                  </span>
                </span>
                <Cell cell={g?.travel_time_delta} kind="travel" />
                <Cell cell={g?.safety_delta} kind="safety" />
                <Cell cell={g?.access_delta} kind="access" />
              </button>
            );
          })}

          <button
            data-testid="scorecard-other"
            onClick={() => onSelectGroup(OTHER_VOICES_GROUP)}
            style={{ ...otherRow, ...(activeGroup === OTHER_VOICES_GROUP ? groupRowActive : null) }}
          >
            <span style={{ fontSize: 12, color: '#6b7280' }}>Other voices — no scorecard row</span>
            <span style={{ fontSize: 11, color: '#9aa0a6' }}>filter feed ›</span>
          </button>
        </div>
      )}
    </div>
  );
}

const panel: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.96)',
  borderRadius: 12,
  boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
  fontFamily: 'system-ui, sans-serif',
  overflow: 'hidden',
  pointerEvents: 'auto',
};
const header: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '9px 12px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.6,
  color: '#374151',
};
const body: React.CSSProperties = { padding: '2px 10px 10px' };
const legend: React.CSSProperties = { fontSize: 10, color: '#8a8a8a', margin: '0 2px 8px', lineHeight: 1.4 };
const colHead: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1.5fr 1fr 1fr 1fr',
  gap: 6,
  alignItems: 'center',
  padding: '0 2px 4px',
};
const colLabel: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: '#9aa0a6',
  textAlign: 'center',
};
const info: React.CSSProperties = { cursor: 'help', color: '#b0b6be' };
const groupRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1.5fr 1fr 1fr 1fr',
  gap: 6,
  alignItems: 'stretch',
  width: '100%',
  textAlign: 'left',
  border: '1px solid transparent',
  background: 'transparent',
  borderRadius: 8,
  padding: '4px 2px',
  cursor: 'pointer',
  marginBottom: 2,
};
const groupRowActive: React.CSSProperties = { background: '#e8f0fe', border: '1px solid #c7dbfb' };
const groupLabelCol: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, justifyContent: 'center', paddingLeft: 4 };
const groupName: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#1f2937' };
const cellBox: React.CSSProperties = {
  position: 'relative',
  background: '#f3f4f6',
  borderRadius: 8,
  padding: '6px 4px 5px',
  textAlign: 'center',
  minHeight: 34,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
  fontVariantNumeric: 'tabular-nums',
};
const cellLow: React.CSSProperties = { background: '#f7f7f8', opacity: 0.72 };
const cellValRow: React.CSSProperties = { fontSize: 13, fontWeight: 600 };
const cellSub: React.CSSProperties = { fontSize: 9, color: '#8a8a8a', marginTop: 1 };
const badgeBase: React.CSSProperties = {
  position: 'absolute',
  top: 2,
  right: 3,
  fontSize: 7,
  fontWeight: 700,
  letterSpacing: 0.3,
  padding: '0 2px',
  borderRadius: 3,
};
const badgeMeas: React.CSSProperties = { ...badgeBase, color: '#2f855a', background: '#e3f3e9' };
const badgeLow: React.CSSProperties = { ...badgeBase, color: '#9aa0a6', background: '#ececee' };
const chipBase: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: 0.2,
  borderRadius: 5,
  padding: '0 5px',
  alignSelf: 'flex-start',
};
const chipSim: React.CSSProperties = { ...chipBase, color: '#3f6212', background: '#ecf6dd' };
const chipInferred: React.CSSProperties = { ...chipBase, color: '#6b7280', background: '#eef1f4' };
const otherRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  width: '100%',
  border: '1px dashed #d7dbe0',
  background: 'transparent',
  borderRadius: 8,
  padding: '7px 8px',
  marginTop: 4,
  cursor: 'pointer',
};
