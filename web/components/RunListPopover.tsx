'use client';

// V2.7a C4 — the RUN LIST: the header run tag expands into the run inventory (the ratified
// Map & Build §2b design). AN INVENTORY, NOT A RANKING — per run: name, a plain-terms option
// fingerprint, a one-line change summary, and the three actions (CLONE — the primary iteration
// affordance — / OPEN / COMPARE feeding Explore). No deltas, no scores, no best/worst anywhere:
// comparison lives in Compare, behind the provenance guard. A computing run shows its stage and
// opens in its current state.

import { useCallback, useEffect, useState } from 'react';
import { getRuns, type RunSummary } from '@/lib/api';
import { EXAMPLE_RUN_ID } from '@/lib/demo';

const STAGE_LABEL: Record<string, string> = {
  queued: 'queued',
  regen: 'regenerating the network',
  baseline: 'baseline run',
  scenario: 'scenario run',
  analysis: 'analysis',
  settling: 'settling',
};

function fingerprint(r: RunSummary): string {
  const bits = [`run ${r.id.replace('multimodal-scenario-', '')}`];
  if (r.started_at) bits.push(new Date(r.started_at * 1000).toLocaleDateString());
  bits.push(r.assignment === 'settled' ? 'settled' : 'day-one');
  bits.push(r.demand_profile === 'calibrated_am_peak' ? 'calibrated counts' : 'synthetic demo');
  const n = r.n_seeds ?? 1;
  bits.push(`${n} seed${n === 1 ? '' : 's'}`);
  return bits.join(' · ');
}

function changeSummary(r: RunSummary): string {
  if (r.changes?.length) {
    return r.changes.map((c) => (c.type ?? 'change').replace(/_/g, ' ')).join(' + ');
  }
  return r.description || '—';
}

export function RunListPopover({
  currentRunId,
  exampleLoaded,
  onOpen,
  onClone,
  onCloneExample,
  onCompareA,
  onCompareB,
  onNewDraft,
  onClose,
}: {
  // "viewing" = the run you explicitly OPENED (the watcher/active run) — NOT merely the
  // mount-landed artifact: the landing run must stay openable so its Build-stage watcher and
  // enrich affordances remain reachable from the list.
  currentRunId: string | null;
  exampleLoaded: boolean;
  onOpen: (id: string, computing: boolean) => void;
  onClone: (r: RunSummary) => void;
  onCloneExample: () => void;
  onCompareA: (id: string) => void;
  onCompareB: (id: string) => void;
  onNewDraft: () => void;
  onClose: () => void;
}) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [down, setDown] = useState(false);
  const refresh = useCallback(() => {
    getRuns().then((res) => {
      if (res.ok) {
        setRuns(res.value.runs);
        setDown(false);
      } else {
        setRuns([]);
        setDown(true);
      }
    });
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const sorted = [...(runs ?? [])].sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0));
  const haveExample = sorted.some((r) => r.id === EXAMPLE_RUN_ID);

  return (
    <div className="nadi-shell" style={pos}>
      <div className="blueprint" style={card} data-testid="run-list">
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <div style={headRow}>
          <span style={heading}>Runs</span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={mutedSmall}>named runs sort by recency</span>
            <button style={iconBtn} onClick={refresh} data-testid="run-list-refresh" title="refresh the inventory">
              ↻
            </button>
            <button style={iconBtn} onClick={onClose} data-testid="run-list-close" title="close">
              ×
            </button>
          </span>
        </div>
        <div style={inventoryLine}>
          an inventory, not a ranking — no scores or deltas here; comparison lives in Explore
        </div>
        {down && (
          <div style={downNote} data-testid="run-list-down">
            backend unreachable — the run inventory needs the local server; the example below
            still opens from committed files.
          </div>
        )}
        <div style={rowsWrap}>
          {sorted.map((r) => {
            const computing = r.status != null && r.status !== 'done' && r.status !== 'failed';
            const viewing = r.id === currentRunId;
            const isExample = r.id === EXAMPLE_RUN_ID;
            const clonable = !computing && (r.changes?.length ?? 0) > 0;
            return (
              <div key={r.id} style={{ ...row, ...(viewing ? rowViewing : null) }} data-testid={`run-row-${r.id}`}>
                <div style={rowHead}>
                  <span style={rowName} data-testid="run-row-name">
                    {r.name ?? (r.description || r.id.replace('multimodal-scenario-', ''))}
                  </span>
                  <span style={{ display: 'flex', gap: 6 }}>
                    {computing && (
                      <span className="tag tag-accent" style={tagSmall} data-testid="run-row-computing">
                        {STAGE_LABEL[r.stage ?? ''] ?? r.stage ?? 'running'}
                      </span>
                    )}
                    {r.status === 'failed' && (
                      <span className="tag tag-neutral" style={tagSmall}>failed</span>
                    )}
                    {viewing && <span className="tag tag-accent" style={tagSmall}>viewing</span>}
                    {isExample && <span className="tag tag-neutral" style={tagSmall}>the example</span>}
                  </span>
                </div>
                <div style={fpLine}>{fingerprint(r)}</div>
                <div style={chLine}>{changeSummary(r)}</div>
                <div style={actions}>
                  {clonable ? (
                    <button style={cloneBtn} onClick={() => onClone(r)} data-testid={`run-row-clone-${r.id}`}>
                      ⧉ CLONE TO DRAFT
                    </button>
                  ) : computing ? (
                    <span style={mutedSmall}>clone and compare unlock when the run finishes</span>
                  ) : null}
                  {viewing ? (
                    <span style={openViewing}>OPEN — VIEWING</span>
                  ) : (
                    <button
                      style={openBtn}
                      onClick={() => onOpen(r.id, computing)}
                      data-testid={`run-row-open-${r.id}`}
                    >
                      {computing ? 'OPEN — IN ITS CURRENT STATE' : 'OPEN'}
                    </button>
                  )}
                  {!computing && (
                    <span style={compareWrap}>
                      COMPARE AS{' '}
                      <button style={linkBtn} onClick={() => onCompareA(r.id)} data-testid={`run-row-compare-a-${r.id}`}>
                        A
                      </button>{' '}
                      ·{' '}
                      <button style={linkBtn} onClick={() => onCompareB(r.id)} data-testid={`run-row-compare-b-${r.id}`}>
                        B
                      </button>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {!haveExample && runs != null && (
            <div
              style={{ ...row, ...(currentRunId === EXAMPLE_RUN_ID ? rowViewing : null) }}
              data-testid={`run-row-${EXAMPLE_RUN_ID}`}
            >
              <div style={rowHead}>
                <span style={rowName} data-testid="run-row-name">Closure at the fire station&rsquo;s doorstep</span>
                <span style={{ display: 'flex', gap: 6 }}>
                  {currentRunId === EXAMPLE_RUN_ID && (
                    <span className="tag tag-accent" style={tagSmall}>viewing</span>
                  )}
                  <span className="tag tag-neutral" style={tagSmall}>the example</span>
                </span>
              </div>
              <div style={fpLine}>run {EXAMPLE_RUN_ID.replace('multimodal-scenario-', '')} · ships with the tool</div>
              <div style={chLine}>road closure + speed limit + incident</div>
              <div style={actions}>
                <button
                  style={{ ...cloneBtn, ...(exampleLoaded ? null : disabledBtn) }}
                  onClick={() => exampleLoaded && onCloneExample()}
                  disabled={!exampleLoaded}
                  title={exampleLoaded ? undefined : 'open the example first — its members come from the loaded artifact'}
                  data-testid={`run-row-clone-${EXAMPLE_RUN_ID}`}
                >
                  ⧉ CLONE TO DRAFT
                </button>
                {currentRunId === EXAMPLE_RUN_ID ? (
                  <span style={openViewing}>OPEN — VIEWING</span>
                ) : (
                  <button style={openBtn} onClick={() => onOpen(EXAMPLE_RUN_ID, false)} data-testid={`run-row-open-${EXAMPLE_RUN_ID}`}>
                    OPEN
                  </button>
                )}
                <span style={compareWrap}>
                  COMPARE AS{' '}
                  <button style={linkBtn} onClick={() => onCompareA(EXAMPLE_RUN_ID)} data-testid={`run-row-compare-a-${EXAMPLE_RUN_ID}`}>
                    A
                  </button>{' '}
                  ·{' '}
                  <button style={linkBtn} onClick={() => onCompareB(EXAMPLE_RUN_ID)} data-testid={`run-row-compare-b-${EXAMPLE_RUN_ID}`}>
                    B
                  </button>
                </span>
              </div>
            </div>
          )}
          {runs != null && sorted.length === 0 && !down && (
            <div style={mutedSmall}>no local runs yet — the example ships with the tool; Build makes more</div>
          )}
        </div>
        <div style={footer}>
          <button style={linkBtn} onClick={onNewDraft} data-testid="run-list-new-draft">
            + new draft
          </button>
          <span style={mutedSmall}>deltas live in Compare — it refuses mismatched provenance</span>
        </div>
      </div>
    </div>
  );
}

const pos: React.CSSProperties = { position: 'absolute', top: 62, right: 20, zIndex: 40 };
const mutedSmall: React.CSSProperties = { fontSize: 11, color: 'var(--color-neutral-600)' };
const card: React.CSSProperties = {
  width: 560,
  maxHeight: 'calc(100vh - 120px)',
  overflowY: 'auto',
  background: 'var(--color-bg)',
  boxShadow: 'var(--shadow-lg)',
  padding: '16px 20px 14px',
  fontFamily: 'var(--font-body)',
  color: 'var(--color-text)',
};
const headRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 };
const heading: React.CSSProperties = {
  fontFamily: 'var(--font-heading)',
  fontWeight: 600,
  fontSize: 13,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};
const iconBtn: React.CSSProperties = {
  border: '1px solid var(--color-divider)',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 12,
  padding: '1px 7px',
};
const inventoryLine: React.CSSProperties = { fontSize: 11.5, color: 'var(--color-neutral-600)', marginBottom: 10 };
const downNote: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--color-neutral-700)',
  border: '1px solid var(--color-neutral-400)',
  background: 'var(--color-neutral-100)',
  padding: '6px 10px',
  marginBottom: 8,
};
const rowsWrap: React.CSSProperties = { display: 'grid', gap: 8 };
const row: React.CSSProperties = { border: '1px solid var(--color-divider)', padding: '8px 12px 9px' };
const rowViewing: React.CSSProperties = { borderColor: 'var(--color-accent)' };
const rowHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 };
const rowName: React.CSSProperties = {
  fontFamily: 'var(--font-heading)',
  fontWeight: 600,
  fontSize: 15,
  letterSpacing: '0.02em',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const tagSmall: React.CSSProperties = { fontSize: 10.5, whiteSpace: 'nowrap' };
const fpLine: React.CSSProperties = { fontSize: 11.5, color: 'var(--color-neutral-600)', marginTop: 2 };
const chLine: React.CSSProperties = { fontSize: 12, marginTop: 3 };
const actions: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, marginTop: 7, flexWrap: 'wrap' };
const cloneBtn: React.CSSProperties = {
  fontSize: 11.5,
  fontFamily: 'var(--font-heading)',
  letterSpacing: '0.05em',
  background: 'var(--color-accent)',
  color: '#fff',
  border: 'none',
  padding: '4px 10px',
  cursor: 'pointer',
};
const disabledBtn: React.CSSProperties = { opacity: 0.45, cursor: 'not-allowed' };
const openBtn: React.CSSProperties = {
  fontSize: 12,
  fontFamily: 'var(--font-heading)',
  letterSpacing: '0.05em',
  background: 'transparent',
  border: 'none',
  color: 'var(--color-accent-700)',
  cursor: 'pointer',
  padding: 0,
};
const openViewing: React.CSSProperties = {
  fontSize: 12,
  fontFamily: 'var(--font-heading)',
  letterSpacing: '0.05em',
  color: 'var(--color-neutral-500)',
};
const compareWrap: React.CSSProperties = {
  fontSize: 12,
  fontFamily: 'var(--font-heading)',
  letterSpacing: '0.05em',
};
const linkBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--color-accent-700)',
  cursor: 'pointer',
  font: 'inherit',
  padding: 0,
  textDecoration: 'underline',
  textUnderlineOffset: 3,
};
const footer: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginTop: 12,
  borderTop: '1px solid var(--color-divider)',
  paddingTop: 10,
};
