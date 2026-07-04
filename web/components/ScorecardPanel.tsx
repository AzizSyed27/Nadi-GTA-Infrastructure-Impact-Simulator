'use client';

import { useState } from 'react';

import type { Scorecard, ScorecardGroup } from '@/lib/types';
import { GROUP_LABEL, OTHER_VOICES_GROUP, SCORECARD_GROUP_ORDER } from '@/lib/personaGroups';
import { BETTER, chipInferred, chipSim, ScoreCell, WORSE } from '@/lib/scorecardStyles';

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
                <ScoreCell cell={g?.travel_time_delta} kind="travel" />
                <ScoreCell cell={g?.safety_delta} kind="safety" />
                <ScoreCell cell={g?.access_delta} kind="access" />
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
