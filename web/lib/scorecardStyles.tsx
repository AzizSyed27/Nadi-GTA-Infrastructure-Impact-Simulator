/**
 * Shared scorecard visual vocabulary — the ONE place the honesty treatment lives, so the map's
 * ScorecardPanel and the Report view render cells identically:
 *  - sign color only where a direction is claimed (travel_time = measured, access = heuristic estimate);
 *  - SAFETY as a ± magnitude with NO direction color (the sign is not seed-stable — magnitude only);
 *  - every [LOW]-confidence cell visually muted vs the [MEAS] cells;
 *  - the cell note surfaced as the native hover tooltip.
 * (This file is `.tsx` because it exports the shared <ScoreCell> component, not just style constants.)
 */

import type { ScorecardCell } from '@/lib/types';

export const WORSE = '#c64545'; // POSITIVE value = worse for the group
export const BETTER = '#3caa5a';
export const NEUTRAL = '#6b7280';

export function signColor(value: number): string {
  return value > 0 ? WORSE : value < 0 ? BETTER : NEUTRAL;
}

/** Signed value with a real Unicode minus (−, U+2212); 1 decimal for seconds, 2 otherwise. */
export function fmtSigned(value: number, unit: string): string {
  const s = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${s}${Math.abs(value).toFixed(unit === 's' ? 1 : 2)}${unit}`;
}

export type CellKind = 'travel' | 'safety' | 'access';

/** One scorecard cell, rendered with the shared honesty treatment. `testid` lets each surface tag its own. */
export function ScoreCell({
  cell,
  kind,
  testid = 'scorecard-cell',
}: {
  cell: ScorecardCell | null | undefined;
  kind: CellKind;
  testid?: string;
}) {
  if (!cell || cell.value == null) {
    return (
      <div style={cellBox} data-testid={testid}>
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
    <div style={{ ...cellBox, ...(low ? cellLow : null) }} title={cell.note ?? undefined} data-testid={testid}>
      <div style={cellValRow}>{valueEl}</div>
      {kind === 'travel' && cell.affected_share != null && (
        <div style={cellSub}>{Math.round(cell.affected_share * 100)}% &gt;30s</div>
      )}
      <span style={badge === 'MEAS' ? badgeMeas : badgeLow}>{badge}</span>
    </div>
  );
}

export const cellBox: React.CSSProperties = {
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
export const cellLow: React.CSSProperties = { background: '#f7f7f8', opacity: 0.72 };
export const cellValRow: React.CSSProperties = { fontSize: 13, fontWeight: 600 };
export const cellSub: React.CSSProperties = { fontSize: 9, color: '#8a8a8a', marginTop: 1 };

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
export const badgeMeas: React.CSSProperties = { ...badgeBase, color: '#2f855a', background: '#e3f3e9' };
export const badgeLow: React.CSSProperties = { ...badgeBase, color: '#9aa0a6', background: '#ececee' };

const chipBase: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: 0.2,
  borderRadius: 5,
  padding: '0 5px',
  alignSelf: 'flex-start',
};
export const chipSim: React.CSSProperties = { ...chipBase, color: '#3f6212', background: '#ecf6dd' };
export const chipInferred: React.CSSProperties = { ...chipBase, color: '#6b7280', background: '#eef1f4' };
