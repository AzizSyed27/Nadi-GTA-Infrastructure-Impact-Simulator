'use client';

/**
 * V2.7b C9 — Act II's REPORT stage: the document composing, and the audit doing its job in public.
 *
 * The left side is the REPORT SKELETON — a code-derived typed graph of what the document is being
 * written ABOUT (the scenario, the measures, the groups it touches), drawn as inline SVG with
 * square nodes in labeled columns. It is deliberately a different STRUCTURE from the discourse
 * stage's round-node organic scatter, and it is deliberately NOT the LightRAG entity graph, which
 * keeps its own meaning in Explore · Graphs. Two graphs that look alike would be a claim that they
 * mean the same thing.
 *
 * The right side is the SAME `RunDocument` the reader lands in, fed a report whose prose grows —
 * so "the same document" is true rather than a resemblance. THE MERGE IS SCAFFOLDING: when the
 * stage ends the caller fetches the written file and swaps it in, and what a reader is left looking
 * at is the file.
 *
 * VIEW THE CORRECTION is the credibility moment this stage exists for. The audit catches an
 * overclaiming sentence, the slot is retried, and the REJECTED DRAFT is persisted (C5) so the
 * correction can be shown rather than described. Reports written before V2.7b carry no draft, and
 * that says so instead of implying nothing was caught.
 */

import { useState } from 'react';

import { RunDocument, type ReportState } from '@/components/RunDocument';
import type { PerRunReport } from '@/lib/reportData';
import { auditTally, type RunFeedState, type SlotState } from '@/lib/runFeed';
import type { Agent, TrajectoryArtifact } from '@/lib/types';

export const NO_DRAFT_RECORDED =
  'rejected draft not recorded for this report — drafts have been recorded since V2.7b';
export const SKELETON_NOTE =
  'What the document is being written about, from computed facts. Not the chat agent’s entity ' +
  'graph — that one lives in Explore · Graphs and means something else.';

export function ReportStage({
  experience,
  artifact,
  report,
  reportState,
  isExample,
  liveName,
  onGroupDoorway,
  onGroupInterview,
}: {
  experience: RunFeedState;
  artifact: TrajectoryArtifact;
  /** Either the merged projection (while composing) or the written file (after the swap). */
  report: PerRunReport | null;
  reportState: ReportState;
  isExample: boolean;
  liveName: string | null;
  onGroupDoorway: (group: string) => void;
  /** V2.7e — threaded to the document; this stage renders INSIDE Act II, so its doors are always
   *  blocked (Watch is the interpretation streaming in, with nothing for a door to land on). */
  onGroupInterview?: (agent: Agent) => void;
}) {
  const tally = auditTally(experience.slots);
  const corrected = experience.slots.filter((s) => s.status === 'resolved_on_retry');
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div style={wrap} data-testid="act-two-report">
      <div style={leftCol}>
        <Skeleton report={report} />
        <p style={muted}>{SKELETON_NOTE}</p>

        <div style={auditLine} data-testid="act-two-audit-line">
          {tally.clean} clean · {tally.corrected} corrected on retry · {tally.unresolved} unresolved
        </div>
        {tally.codeRendered > 0 && (
          <div style={muted} data-testid="act-two-code-rendered">
            {tally.codeRendered} section{tally.codeRendered === 1 ? '' : 's'} written by code, with no
            model involved
          </div>
        )}

        {corrected.map((s) => (
          <div key={s.slot} style={correctionRow}>
            <button style={linkBtn} data-testid="act-two-view-correction"
                    onClick={() => setOpen(open === s.slot ? null : s.slot)}>
              {open === s.slot ? 'hide the correction' : `view the correction · ${s.slot}`}
            </button>
            {open === s.slot && <Correction slot={s} />}
          </div>
        ))}
      </div>

      <div style={rightCol}>
        <div className="nadi-doc" style={docBox} data-testid="act-two-document">
          <RunDocument
            artifact={artifact}
            report={report}
            reportState={reportState}
            isExample={isExample}
            liveName={liveName}
            onGroupDoorway={onGroupDoorway}
            onGroupInterview={onGroupInterview}
            doorwaysBlocked
          />
        </div>
      </div>
    </div>
  );
}

/** The rejected draft, the rule that caught it, and what replaced it. */
function Correction({ slot }: { slot: SlotState }) {
  return (
    <div style={correctionBox} data-testid="act-two-correction">
      {(slot.violations ?? []).map((v, i) => (
        <div key={i} style={ruleLine}>
          caught by <b>{v.rule}</b>
        </div>
      ))}
      {slot.draft ? (
        <>
          <div style={draftLabel}>the model wrote</div>
          <div style={draftText} data-testid="act-two-draft">{slot.draft}</div>
        </>
      ) : (
        <div style={muted} data-testid="act-two-no-draft">{NO_DRAFT_RECORDED}</div>
      )}
      <div style={draftLabel}>what the document says instead</div>
      <div style={finalText} data-testid="act-two-final">{slot.text}</div>
    </div>
  );
}

/**
 * THE SKELETON — square typed nodes in three labeled columns, joined by labeled edges. Built from
 * CODE-DERIVED facts only (the scenario change, the measures the run computes, the groups on the
 * scorecard) so it can never claim a finding the document hasn't made.
 */
function Skeleton({ report }: { report: PerRunReport | null }) {
  const change = report?.scenario_change?.description ?? 'the scenario';
  const groups = report?.sections.who_affected.group_order ?? Object.keys(report?.scorecard ?? {});
  const measures = ['travel time', 'safety surrogate', 'access'];
  const rows = Math.max(groups.length, measures.length, 1);
  const H = 26;
  const height = rows * H + 34;

  const col1 = 8, col2 = 176, col3 = 344, w = 150;
  const node = (x: number, y: number, label: string, key: string) => (
    <g key={key}>
      <rect x={x} y={y} width={w} height={19} fill="#fff" stroke="#c9ced6" />
      <text x={x + 6} y={y + 13} fontSize="9.5" fill="#33383f">{trim(label, 26)}</text>
    </g>
  );

  return (
    <svg width="100%" viewBox={`0 0 500 ${height}`} style={svgBox} data-testid="act-two-skeleton"
         role="img" aria-label="report skeleton">
      <text x={col1} y="10" fontSize="8" fill="#8b9099" letterSpacing="0.8">SCENARIO</text>
      <text x={col2} y="10" fontSize="8" fill="#8b9099" letterSpacing="0.8">MEASURES</text>
      <text x={col3} y="10" fontSize="8" fill="#8b9099" letterSpacing="0.8">WHO IT TOUCHES</text>
      {node(col1, 18, change, 'change')}
      {measures.map((m, i) => (
        <g key={m}>
          <line x1={col1 + w} y1={28} x2={col2} y2={18 + i * H + 10} stroke="#d7dbe0" />
          {node(col2, 18 + i * H, m, m)}
        </g>
      ))}
      {groups.map((g, i) => (
        <g key={g}>
          <line x1={col2 + w} y1={28} x2={col3} y2={18 + i * H + 10} stroke="#d7dbe0" />
          {node(col3, 18 + i * H, g.replace(/_/g, ' '), g)}
        </g>
      ))}
    </svg>
  );
}

const trim = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const wrap: React.CSSProperties = { display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' };
const leftCol: React.CSSProperties = { flex: '1 1 380px', minWidth: 320, display: 'flex', flexDirection: 'column', gap: 8 };
const rightCol: React.CSSProperties = { flex: '1 1 460px', minWidth: 340 };
const svgBox: React.CSSProperties = { border: '1px solid #eceff2', borderRadius: 8, background: '#fbfcfd' };
const docBox: React.CSSProperties = {
  maxHeight: '64vh', overflowY: 'auto', border: '1px solid var(--color-divider)', padding: '10px 14px',
};
const auditLine: React.CSSProperties = {
  fontFamily: 'var(--font-heading)', fontSize: 12.5, letterSpacing: '.05em', color: 'var(--color-accent-700)',
};
const muted: React.CSSProperties = { fontSize: 11.5, lineHeight: 1.5, color: 'var(--color-neutral-600)', margin: 0 };
const correctionRow: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const linkBtn: React.CSSProperties = {
  border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
  fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--color-accent-700)', textDecoration: 'underline',
};
const correctionBox: React.CSSProperties = {
  border: '1px solid var(--color-divider)', padding: '8px 10px', display: 'flex',
  flexDirection: 'column', gap: 4,
};
const ruleLine: React.CSSProperties = { fontSize: 11.5, color: '#8a6d1a' };
const draftLabel: React.CSSProperties = {
  fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-neutral-600)', marginTop: 3,
};
const draftText: React.CSSProperties = {
  fontSize: 12, lineHeight: 1.45, textDecoration: 'line-through', color: 'var(--color-neutral-600)',
};
const finalText: React.CSSProperties = { fontSize: 12, lineHeight: 1.45 };
