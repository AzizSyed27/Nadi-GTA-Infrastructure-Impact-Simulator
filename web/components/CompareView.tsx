'use client';

// V2.1d part ii — two completed runs side by side, per stakeholder. The tool ARRANGES, the planner
// concludes: no sums, no ranks, no recommendation (the referendum guard extends to this surface).
// The provenance-mismatch guard renders PROMINENTLY before any delta; a refused delta ("—†", amber)
// is glanceably distinct from a genuinely-empty one (plain "—") — a principled refusal must survive
// without hovering.

import { Fragment } from 'react';
import { deltaEligibility, detectMismatches, seedLabel, seedProvenanceOf, type CompareSide } from '@/lib/compare';
import { changesOfSide } from '@/lib/compare';
import { GROUP_LABEL, SCORECARD_GROUP_ORDER } from '@/lib/personaGroups';
import {
  chipInferred,
  chipSim,
  fmtSigned,
  ScoreCell,
  signColor,
  type CellKind,
} from '@/lib/scorecardStyles';
import type { ScorecardCell, ScorecardGroup } from '@/lib/types';
import { RunSwitcher } from '@/components/RunSwitcher';

interface CompareViewProps {
  a: CompareSide | null;
  b: CompareSide | null;
  loading: { a: boolean; b: boolean };
  error: { a: string | null; b: string | null };
  onPickA: (id: string) => void;
  onPickB: (id: string) => void;
}

const METRICS: { kind: CellKind; label: string; attr: keyof Pick<ScorecardGroup, 'travel_time_delta' | 'safety_delta' | 'access_delta'> }[] = [
  { kind: 'travel', label: 'travel', attr: 'travel_time_delta' },
  { kind: 'safety', label: 'safety', attr: 'safety_delta' },
  { kind: 'access', label: 'access', attr: 'access_delta' },
];

function groupOf(side: CompareSide | null, gid: string): ScorecardGroup | undefined {
  return side?.scorecard?.groups?.find((g) => g.group === gid);
}

/** One Δ cell: signed where a direction is claimable on both sides; the amber "—†" refusal where
 *  the tool DECLINES to subtract (safety always; sign-unstable either side); plain "—" where a
 *  side simply has nothing. */
function DeltaCell({ a, b, kind, gid }: { a?: ScorecardCell | null; b?: ScorecardCell | null; kind: CellKind; gid: string }) {
  const v = deltaEligibility(a, b, kind);
  if (v.eligible) {
    const unit = kind === 'travel' ? 's' : '';
    return (
      <div style={deltaBox} data-testid="compare-delta" data-metric={kind} data-group={gid}>
        <span style={{ color: signColor(v.delta), fontWeight: 600 }}>{fmtSigned(v.delta, unit)}</span>
      </div>
    );
  }
  if (v.refused) {
    return (
      <div
        style={{ ...deltaBox, ...deltaRefused }}
        title={v.reason}
        data-testid="compare-delta"
        data-metric={kind}
        data-group={gid}
        data-refused="true"
      >
        —†
      </div>
    );
  }
  return (
    <div style={deltaBox} title={v.reason} data-testid="compare-delta" data-metric={kind} data-group={gid}>
      <span style={{ color: '#c2c7cf' }}>—</span>
    </div>
  );
}

/** One side's provenance strip — DESCRIBES the run (independent of the mismatch guard; absence of
 *  a mismatch never means absence of disclosure). Chip wording mirrors RunCard's. */
function ProvenanceStrip({ side, label, testid, loading, error }: {
  side: CompareSide | null;
  label: string;
  testid: string;
  loading: boolean;
  error: string | null;
}) {
  if (error) {
    return (
      <div style={strip} data-testid={testid}>
        <div style={stripTitle}>{label}</div>
        <div style={errText}>{error}</div>
      </div>
    );
  }
  if (loading) {
    return (
      <div style={strip} data-testid={testid}>
        <div style={stripTitle}>{label}</div>
        <div style={stripLine}>loading…</div>
      </div>
    );
  }
  if (!side) {
    return (
      <div style={strip} data-testid={testid}>
        <div style={stripTitle}>{label}</div>
        <div style={stripLine}>no run selected</div>
      </div>
    );
  }
  const asn = side.meta.assignment;
  const changes = changesOfSide(side);
  const demand =
    side.meta.demand_profile === 'calibrated_am_peak'
      ? 'calibrated AM peak (07:00–09:00, count-anchored)'
      : 'synthetic demo demand';
  const assignment =
    asn?.mode === 'settled'
      ? `settled response (iterated assignment, drivers only)${asn.converged != null ? ` · ${asn.converged ? `converged in ${asn.iterations} iterations` : 'iteration cap reached'}` : ''}`
      : 'day-one response — today’s route habits, no assignment iteration';
  const rs = side.meta.render_sample;
  return (
    <div style={strip} data-testid={testid}>
      <div style={stripTitle}>
        {label} · <code style={{ fontSize: 11 }}>{side.runId.replace('multimodal-scenario-', '')}</code>
      </div>
      {changes.length > 0 && <div style={stripLine}>{changes[0].description}</div>}
      <div style={stripLine}>demand: {demand}</div>
      <div style={stripLine}>{assignment}</div>
      <div style={stripLine}>{seedLabel(seedProvenanceOf(side))}</div>
      {rs && (
        <div style={stripLine}>
          render sample: {rs.rendered_vehicles} of {rs.total_vehicles} vehicles (outcomes are full-population)
        </div>
      )}
      {!side.scorecard && (
        <div style={{ ...stripLine, color: '#b23a3a' }} data-testid="compare-no-scorecard">
          no scorecard yet — the quant pipeline hasn’t finished for this run
        </div>
      )}
    </div>
  );
}

export function CompareView(props: CompareViewProps) {
  const { a, b } = props;
  const bothPicked = a != null && b != null;
  const bothScored = bothPicked && a.scorecard != null && b.scorecard != null;
  const mismatches = bothPicked ? detectMismatches(a, b) : [];

  return (
    <div style={sheet} data-testid="compare-view">
      <div style={inner}>
        <div style={heading}>Compare two runs</div>
        <div style={framing}>
          Side-by-side arrangement of two completed runs, per stakeholder. Δ = B − A per cell. Nothing
          here is summed, ranked, or turned into a recommendation — the tool arranges, the planner
          concludes.
        </div>
        <div style={legendLine}>
          ＋ worse · − better · ± = magnitude only (direction not claimed) ·{' '}
          <span style={{ ...deltaRefusedInline }}>†</span> cross-run direction not claimed — the tool
          declines to subtract these
        </div>

        <div style={pickerRow}>
          <div style={pickerCol} data-testid="compare-picker-a">
            <div style={pickerLabel}>Run A</div>
            <RunSwitcher activeRunId={a?.runId ?? null} onLoad={props.onPickA} />
          </div>
          <div style={pickerCol} data-testid="compare-picker-b">
            <div style={pickerLabel}>Run B</div>
            <RunSwitcher activeRunId={b?.runId ?? null} onLoad={props.onPickB} />
          </div>
        </div>

        {!bothPicked && (
          <div style={emptyState} data-testid="compare-empty">
            Select two completed runs to lay their scorecards side by side.
          </div>
        )}

        {bothPicked && a.runId === b.runId && (
          <div style={sameRunNote} data-testid="same-run-note">
            comparing a run with itself — every delta is zero by construction; useful only as a
            rendering check
          </div>
        )}

        {mismatches.length > 0 && (
          <div style={mismatchBlock} data-testid="mismatch-note">
            <div style={mismatchHead}>⚠ these runs were produced differently — deltas below mix that difference in</div>
            {mismatches.map((m) => (
              <div key={m.field} style={mismatchLine} data-testid="mismatch-line" data-field={m.field}>
                {m.line}
              </div>
            ))}
          </div>
        )}

        <div style={stripRow}>
          <ProvenanceStrip side={a} label="A" testid="compare-prov-a" loading={props.loading.a} error={props.error.a} />
          <ProvenanceStrip side={b} label="B" testid="compare-prov-b" loading={props.loading.b} error={props.error.b} />
        </div>

        {bothPicked && (
          <div style={gridWrap}>
            <div style={grid} data-testid="compare-grid">
              {/* header row 1: metric spans */}
              <div style={hCell} />
              {METRICS.map((m) => (
                <div key={m.kind} style={{ ...hMetric, gridColumn: 'span 3' }}>
                  {m.label}
                  {m.kind === 'safety' && (
                    <span
                      style={hInfo}
                      title="Safety is a surrogate near-miss magnitude; its direction is not claimed within a run, so no cross-run difference is computed."
                    >
                      ⓘ
                    </span>
                  )}
                </div>
              ))}
              {/* header row 2: A / B / Δ */}
              <div style={hCell} />
              {METRICS.map((m) => (
                <Fragment key={m.kind}>
                  <div style={{ ...hSub, ...triadStart }}>A</div>
                  <div style={hSub}>B</div>
                  <div style={hSub}>Δ B−A</div>
                </Fragment>
              ))}
              {/* rows: SCORECARD_GROUP_ORDER, never reordered */}
              {SCORECARD_GROUP_ORDER.map((gid) => {
                const ga = groupOf(a, gid);
                const gb = groupOf(b, gid);
                const grounding = ga?.grounding ?? gb?.grounding;
                return (
                  <div key={gid} style={rowContents} data-testid="compare-row" data-group={gid}>
                    <div style={labelCell}>
                      <span>{GROUP_LABEL[gid] ?? gid}</span>
                      {grounding && (
                        <span style={grounding === 'inferred' ? chipInferred : chipSim}>{grounding}</span>
                      )}
                    </div>
                    {METRICS.map((m) => (
                      <Fragment key={m.kind}>
                        <div style={triadStart}>
                          <ScoreCell cell={ga?.[m.attr]} kind={m.kind} testid="compare-cell-a" />
                        </div>
                        <ScoreCell cell={gb?.[m.attr]} kind={m.kind} testid="compare-cell-b" />
                        <DeltaCell a={ga?.[m.attr]} b={gb?.[m.attr]} kind={m.kind} gid={gid} />
                      </Fragment>
                    ))}
                  </div>
                );
              })}
            </div>
            {!bothScored && (
              <div style={gridNote}>
                deltas require a scorecard on both sides — the missing side renders em-dashes only
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- styles ----
const sheet: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 24, // BELOW the mode toggle (25) — the way back out must stay clickable
  background: 'rgba(247,248,250,0.98)',
  overflowY: 'auto',
  fontFamily: 'system-ui, sans-serif',
  color: '#374151',
};
const inner: React.CSSProperties = { maxWidth: 1100, margin: '0 auto', padding: '64px 20px 40px' };
const heading: React.CSSProperties = { fontSize: 18, fontWeight: 700, marginBottom: 4 };
const framing: React.CSSProperties = { fontSize: 12.5, color: '#6b7280', lineHeight: 1.5 };
const legendLine: React.CSSProperties = { fontSize: 11, color: '#8a9099', marginTop: 6, marginBottom: 14 };
const pickerRow: React.CSSProperties = { display: 'flex', gap: 14, marginBottom: 14 };
const pickerCol: React.CSSProperties = { flex: 1, minWidth: 0 };
const pickerLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#8a9099', marginBottom: 4 };
const emptyState: React.CSSProperties = { padding: '28px 0', fontSize: 13, color: '#6b7280' };
const sameRunNote: React.CSSProperties = {
  fontSize: 12,
  color: '#6b7280',
  background: '#eef1f4',
  borderRadius: 8,
  padding: '8px 12px',
  marginBottom: 10,
};
const mismatchBlock: React.CSSProperties = {
  background: '#fdf1dc',
  border: '1px solid #ecd9b0',
  borderRadius: 10,
  padding: '10px 14px',
  marginBottom: 12,
};
const mismatchHead: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#92600a', marginBottom: 4 };
const mismatchLine: React.CSSProperties = { fontSize: 12.5, color: '#92600a', lineHeight: 1.55 };
const stripRow: React.CSSProperties = { display: 'flex', gap: 14, marginBottom: 14 };
const strip: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: '#fff',
  border: '1px solid #d7dbe0',
  borderRadius: 10,
  padding: '10px 12px',
};
const stripTitle: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, marginBottom: 4 };
const stripLine: React.CSSProperties = { fontSize: 11.5, color: '#6b7280', lineHeight: 1.5, wordBreak: 'break-word' };
const errText: React.CSSProperties = { fontSize: 12, color: '#b23a3a' };
const gridWrap: React.CSSProperties = { overflowX: 'auto' };
const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '150px repeat(3, minmax(88px, 1fr) minmax(88px, 1fr) minmax(72px, 0.8fr))',
  gap: 4,
  alignItems: 'stretch',
  minWidth: 900,
};
// each row is a display: contents wrapper so the grid columns align across rows
const rowContents: React.CSSProperties = { display: 'contents' };
const hCell: React.CSSProperties = {};
const hMetric: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: '#6b7280',
  textAlign: 'center',
  borderLeft: '2px solid #e2e6ea',
  paddingTop: 4,
};
const hInfo: React.CSSProperties = { marginLeft: 4, cursor: 'help', color: '#9aa0a8' };
const hSub: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: '#9aa0a8', textAlign: 'center' };
const triadStart: React.CSSProperties = { borderLeft: '2px solid #e2e6ea', paddingLeft: 4 };
const labelCell: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  justifyContent: 'center',
  fontSize: 12.5,
  fontWeight: 600,
};
const deltaBox: React.CSSProperties = {
  background: '#f3f4f6',
  borderRadius: 8,
  minHeight: 34,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 13,
  fontVariantNumeric: 'tabular-nums',
};
const deltaRefused: React.CSSProperties = { color: '#92600a', background: '#fdf1dc', fontWeight: 700 };
const deltaRefusedInline: React.CSSProperties = { color: '#92600a', fontWeight: 700 };
const gridNote: React.CSSProperties = { marginTop: 8, fontSize: 11.5, color: '#8a9099' };
