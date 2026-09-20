'use client';

/**
 * V2.7b C9 — Act II's DISCOURSE stage.
 *
 * THIS STAGE REPORTS NO PER-STEP PROGRESS, AND SAYS SO. `propagation.py` touches the event stream
 * exactly four times — an import, two cancel checkpoints, and one `stage_usage` as it exits — so
 * between `cmd_start` and `cmd_end` there is genuinely nothing to show for several minutes. A
 * spinner implying otherwise would be machinery cosplaying as content. The card states the silence
 * and names what will arrive.
 *
 * WHAT ARRIVES IS THE GRAPH, from the sidecar the discourse enrich writes (739 KB, the
 * graphs-sidecar fetch pattern). The posts are deliberately NOT duplicated here: their text lives
 * only inside `artifact.social`, so showing them would mean refetching a 20–90 MB artifact mid-run
 * to copy a feed that already has a home. The doorway goes there instead.
 *
 * The graph REPLAYS RECORDED STEPS. Node positions are computed by `graph_export` after the cascade
 * finishes (`nx.spring_layout`), so there is no honest way to animate propagation live — during the
 * cascade there is nothing to place a node at. The label says replay, because that is what it is.
 */

import { useCallback, useMemo, useState } from 'react';
import type { Layer } from '@deck.gl/core';

import { CascadeSelector } from '@/components/CascadeSelector';
import { DeckPanel } from '@/components/DeckPanel';
import { buildOasisLayers, type GraphsOasisNode, type GraphsSidecar } from '@/lib/graphLayers';
import { GROUP_LABEL } from '@/lib/personaGroups';
import type { StageState } from '@/lib/runFeed';

export const DISCOURSE_RUNNING =
  'The cascades are running. This stage reports no step-by-step progress — it produces its result ' +
  'in one piece, and the graph appears here when it lands.';
export const REPLAY_NOTE =
  'A replay of recorded steps: node positions are computed after the cascade finishes, so nothing ' +
  'here is animating live.';
export const DISCOURSE_DOORWAY = 'The full cascade feed — who said what, and what moved — is in Explore · Discourse.';
export const NO_GRAPH_YET =
  'No graph layouts for this run yet. They are exported when the discourse enrich finishes.';
/** V2.7f C2 — a ledger `skipped` is a verdict that the stage never ran: said, never "yet". */
export const DISCOURSE_SKIPPED =
  'The discourse stage did not run in this run — no graph was exported.';

export function DiscourseStage({
  stage,
  graphs,
  onOpenDiscourse,
}: {
  stage: StageState;
  /** Already run-id guarded by the caller — this component never resolves a run. */
  graphs: GraphsSidecar | null;
  onOpenDiscourse: () => void;
}) {
  const oasis = graphs?.oasis ?? null;

  const cascadeIds = useMemo(
    () => Array.from(new Set((oasis?.influence ?? []).map((p) => p.cascade_id).filter((c): c is string => !!c))).sort(),
    [oasis],
  );
  const [cascade, setCascade] = useState<string | null>(null);
  // membership check (the V2.3d review catch): a selection the new data doesn't have must fall
  // back, never silently filter to zero connectors
  const activeCascade = cascade && cascadeIds.includes(cascade) ? cascade : (cascadeIds[0] ?? null);

  const oasisById = useMemo(() => {
    const m: Record<string, GraphsOasisNode> = {};
    for (const n of oasis?.nodes ?? []) m[n.id] = n;
    return m;
  }, [oasis]);
  const activeInfluence = useMemo(
    () => (oasis?.influence ?? []).filter((p) => p.cascade_id === activeCascade),
    [oasis, activeCascade],
  );
  const shiftedIds = useMemo(
    () => new Set(activeInfluence.filter((p) => p.shifted).map((p) => p.to)),
    [activeInfluence],
  );

  const [hover, setHover] = useState<string[] | null>(null);
  const onHoverNode = useCallback((n: GraphsOasisNode | null) => {
    if (!n) return setHover(null);
    const lines = [`${n.label}${n.group ? ` · ${GROUP_LABEL[n.group] ?? n.group}` : ''}`];
    // METADATA only — the count and the rules that withheld the posts, never their content
    if (n.excluded) lines.push(`${n.excluded.count} post(s) withheld by the honesty audit: ${n.excluded.rules.join(', ')}`);
    setHover(lines);
  }, []);

  const layers = useMemo<Layer[]>(
    () =>
      oasis
        ? buildOasisLayers({ oasis, oasisById, influence: activeInfluence, shiftedIds, onHoverNode })
        : [],
    [oasis, oasisById, activeInfluence, shiftedIds, onHoverNode],
  );
  // ONE stable nodes array: DeckPanel reconstructs its whole Deck whenever this identity changes,
  // so it must not be rebuilt per render (see the DeckPanel header).
  const nodes = useMemo(() => oasis?.nodes ?? [], [oasis]);

  if (!oasis) {
    return (
      <div style={col} data-testid="act-two-discourse">
        <p style={para}>
          {stage.status === 'running' ? DISCOURSE_RUNNING : stage.status === 'skipped' ? DISCOURSE_SKIPPED : NO_GRAPH_YET}
        </p>
      </div>
    );
  }

  return (
    <div style={col} data-testid="act-two-discourse">
      <div style={row}>
        <span style={counter}>
          {oasis.nodes.length} voices · {oasis.edges.length} follow edges · {activeInfluence.length} influence connectors
        </span>
        {cascadeIds.length > 0 && activeCascade && (
          <CascadeSelector ids={cascadeIds} active={activeCascade} onSelect={setCascade} />
        )}
      </div>
      <p style={muted} data-testid="discourse-replay-note">{REPLAY_NOTE}</p>
      <DeckPanel panelId="act-two-oasis" nodes={nodes} layers={layers} onHover={() => setHover(null)}
                 style={canvasBox} />
      {hover && (
        <div style={hoverBox} data-testid="act-two-graph-hover">
          {hover.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
      <p style={muted}>{oasis.exposure_note}</p>
      <button style={doorway} data-testid="act-two-discourse-doorway" onClick={onOpenDiscourse}>
        {DISCOURSE_DOORWAY}
      </button>
    </div>
  );
}

const col: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 900 };
const row: React.CSSProperties = { display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' };
const para: React.CSSProperties = { fontSize: 13.5, lineHeight: 1.6, margin: 0, maxWidth: 640 };
const muted: React.CSSProperties = { fontSize: 12, lineHeight: 1.55, color: 'var(--color-neutral-600)', margin: 0, maxWidth: 700 };
const counter: React.CSSProperties = {
  fontFamily: 'var(--font-heading)', fontSize: 12, letterSpacing: '.06em', color: 'var(--color-neutral-700)',
};
const canvasBox: React.CSSProperties = {
  position: 'relative', width: '100%', height: '46vh', overflow: 'hidden',
  background: '#fbfcfd', borderRadius: 8, border: '1px solid #eceff2',
};
const hoverBox: React.CSSProperties = {
  fontSize: 11.5, color: 'var(--color-neutral-700)', background: 'var(--color-bg)',
  border: '1px solid var(--color-divider)', padding: '5px 8px',
};
const doorway: React.CSSProperties = {
  border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
  fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--color-accent-700)',
  textDecoration: 'underline', alignSelf: 'flex-start',
};
