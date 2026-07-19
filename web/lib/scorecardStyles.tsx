/**
 * Shared scorecard visual vocabulary — the ONE place the honesty treatment lives, so the map's
 * ScorecardPanel and the Report view render cells identically:
 *  - sign color only where a direction is claimed (travel_time = measured, access = heuristic estimate);
 *  - SAFETY as a ± magnitude with NO direction color (the sign is not seed-stable — magnitude only);
 *  - V2.1d: ANY sign-unstable cell (range.sign_stable === false) gets the safety treatment — the main
 *    value renders ±magnitude with no sign or color ANYWHERE (a "+2.3s" would assert a direction the
 *    seeds refute); the range sub-line's signed endpoints are the one deliberate exception (they are
 *    the evidence OF the flip, not a direction claim), plus a SIGN? badge (top-left);
 *  - every [LOW]-confidence cell visually muted vs the [MEAS] cells;
 *  - the cell note surfaced as the native hover tooltip.
 * (This file is `.tsx` because it exports the shared <ScoreCell> component, not just style constants.)
 */

import type { CellRange, ScorecardCell } from '@/lib/types';

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

/**
 * V2.1d: format a cross-seed range. Travel shows SIGNED endpoints ("+1.8 to +2.9s") — measured data,
 * and on an unstable cell the straddle itself is the honest evidence. Safety shows ABSOLUTE endpoints
 * ("±0.20 to ±2.40") — a safety render never emits a sign character on any surface.
 */
export function fmtRange(range: CellRange, kind: CellKind): string {
  const dec = kind === 'travel' ? 1 : 2;
  if (kind === 'safety') {
    const [lo, hi] = [Math.abs(range.min), Math.abs(range.max)].sort((a, b) => a - b);
    return `±${lo.toFixed(dec)} to ±${hi.toFixed(dec)}`;
  }
  const f = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(dec)}`;
  return `${f(range.min)} to ${f(range.max)}${kind === 'travel' ? 's' : ''}`;
}

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
  // V2.1d: sign_stable lives ONLY on range — a rangeless cell is stable-by-absence (never throws).
  const unstable = cell.range?.sign_stable === false;

  let valueEl: React.ReactNode;
  if (kind === 'safety' || unstable) {
    // Magnitude only — direction not claimed (safety always; ANY cell whose sign flips across seeds).
    // The signed value must not appear anywhere for an unstable cell — map panel and report agree.
    valueEl = (
      <span style={{ color: NEUTRAL }}>
        ±{Math.abs(cell.value).toFixed(kind === 'travel' ? 1 : 2)}
        {kind === 'travel' ? 's' : ''}
      </span>
    );
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
      {cell.range != null && (
        <div style={cellSub} data-testid="cell-range">
          {fmtRange(cell.range, kind)} · {cell.range.n_seeds} seeds
        </div>
      )}
      {unstable && (
        <span style={badgeUnstable} data-testid="unstable-badge">
          SIGN?
        </span>
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

export const badgeBase: React.CSSProperties = {
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
// V2.1d: the sign-instability flag — top-LEFT so it coexists with MEAS/LOW at top-right. Amber: a
// warning about the DIRECTION, not the magnitude (the note tooltip carries the full explanation).
export const badgeUnstable: React.CSSProperties = {
  ...badgeBase,
  right: undefined,
  left: 3,
  color: '#92600a',
  background: '#fdf1dc',
};

const chipBase: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: 0.2,
  borderRadius: 5,
  padding: '0 5px',
  alignSelf: 'flex-start',
};
export const chipSim: React.CSSProperties = { ...chipBase, color: '#3f6212', background: '#ecf6dd' };
export const chipInferred: React.CSSProperties = { ...chipBase, color: '#6b7280', background: '#eef1f4' };
