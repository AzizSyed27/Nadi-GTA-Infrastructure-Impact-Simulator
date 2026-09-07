'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Layer } from '@deck.gl/core';
import { LineLayer, ScatterplotLayer } from '@deck.gl/layers';

import { CascadeSelector } from '@/components/CascadeSelector';
import { DeckPanel } from '@/components/DeckPanel';
import { GROUP_LABEL } from '@/lib/personaGroups';
// V2.7b C9 — the OASIS shape and its five layers moved to lib/ so Act II's discourse card draws
// the same graph with the same renderer. This file keeps the entity half and the split-view chrome.
import {
  buildOasisLayers,
  FALLBACK_COLOR,
  type GraphsEntity,
  type GraphsEntityNode,
  type GraphsOasisNode,
  type GraphsSidecar,
} from '@/lib/graphLayers';

/**
 * V2.3d — the graph SPLIT-VIEW: the project's two graphs, visibly two graphs.
 * Left: the OASIS social graph ("who influences whom in the simulated discourse").
 * Right: the GraphRAG entity graph ("what the report's chat agent knows").
 * Positions come precomputed from the graphs sidecar (networkx server-side) — this component only
 * renders. HONESTY RAILS: uniform node size (degree sizing would be a visual centrality
 * leaderboard), group/type colors never stance; influence connectors are DASHED and separate from
 * follow edges (the exposure note explains why); exclusion markers surface the withheld-posts
 * audit with rules on hover, never content; each panel degrades to a labeled empty state naming
 * BOTH recovery paths. The sidecar shape is off-contract (like ReportPanel's Report interface).
 */

const OASIS_HEADER = 'Who influences whom in the simulated discourse — one simulated preview, not a prediction';
const ENTITY_HEADER = "What the report's chat agent knows — entities and relations extracted from this run's corpus";
const SPLIT_ONE_LINER = 'Two different graphs on purpose: discourse propagation is not the chat agent’s memory.';
const BACKFILL_HINT = 'or backfill: python python/src/graph_export.py --run-id <run>';

const ENTITY_TYPE_COLOR: Record<string, [number, number, number]> = {
  person: [31, 78, 156],
  concept: [124, 90, 168],
  location: [46, 139, 87],
  event: [217, 130, 30],
  organization: [0, 140, 140],
  content: [150, 100, 60],
  data: [190, 80, 130],
};

interface Hover {
  x: number;
  y: number;
  lines: string[];
}

export function GraphSplitView({
  graphs,
  loading,
  error,
}: {
  graphs: GraphsSidecar | null;
  loading: boolean;
  error: boolean;
}) {
  const oasis = graphs?.oasis ?? null;
  const entity = graphs?.entity ?? null;

  const cascadeIds = useMemo(
    () => Array.from(new Set((oasis?.influence ?? []).map((p) => p.cascade_id).filter((c): c is string => !!c))).sort(),
    [oasis],
  );
  const [cascade, setCascade] = useState<string | null>(null);
  // membership check (review-caught): if the loaded run swaps under us (enrich done-edge reload),
  // a selection the new data doesn't have must fall back, never silently filter to zero connectors
  const activeCascade = cascade && cascadeIds.includes(cascade) ? cascade : (cascadeIds[0] ?? null);
  const [oasisHover, setOasisHover] = useState<Hover | null>(null);
  const [entityHover, setEntityHover] = useState<Hover | null>(null);

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

  const hoverOasisNode = useCallback(
    (n: GraphsOasisNode | null, x: number, y: number) => {
      if (!n) {
        setOasisHover(null);
        return;
      }
      const lines = [
        `${n.label}${n.group ? ` · ${GROUP_LABEL[n.group] ?? n.group}` : ''}`,
        n.connected ? `follows in this run's seeded graph` : 'no follow edges in this run',
      ];
      if (n.excluded) {
        lines.push(`${n.excluded.count} post(s) withheld by the honesty audit: ${n.excluded.rules.join(', ')}`);
      }
      setOasisHover({ x, y, lines });
    },
    [],
  );

  const hoverEntityNode = useCallback((n: GraphsEntityNode | null, x: number, y: number) => {
    if (!n) {
      setEntityHover(null);
      return;
    }
    const more = n.source_count > n.sources.length ? ` (+${n.source_count - n.sources.length} more)` : '';
    setEntityHover({ x, y, lines: [`${n.id} · ${n.type}`, `sources: ${n.sources.join(', ') || '—'}${more}`] });
  }, []);

  const oasisLayers = useMemo<Layer[]>(
    () =>
      oasis
        ? buildOasisLayers({ oasis, oasisById, influence: activeInfluence, shiftedIds, onHoverNode: hoverOasisNode })
        : [],
    [oasis, oasisById, activeInfluence, shiftedIds, hoverOasisNode],
  );

  const entityLayers = useMemo<Layer[]>(() => {
    if (!entity) return [];
    const byId: Record<string, GraphsEntityNode> = {};
    for (const n of entity.nodes) byId[n.id] = n;
    const maxW = Math.max(1, ...entity.edges.map((e) => e.weight));
    return [
      new LineLayer({
        id: 'entity-edges',
        data: entity.edges.filter((e) => byId[e.from] && byId[e.to]),
        getSourcePosition: (e: GraphsEntity['edges'][0]) => [byId[e.from].x, byId[e.from].y],
        getTargetPosition: (e: GraphsEntity['edges'][0]) => [byId[e.to].x, byId[e.to].y],
        getColor: (e: GraphsEntity['edges'][0]) => [120, 130, 145, 30 + Math.round(110 * (e.weight / maxW))],
        getWidth: 1,
        widthUnits: 'pixels',
      }),
      new ScatterplotLayer({
        id: 'entity-nodes',
        data: entity.nodes,
        getPosition: (n: GraphsEntityNode) => [n.x, n.y],
        getRadius: 3,
        radiusUnits: 'pixels',
        getFillColor: (n: GraphsEntityNode) => {
          const c = ENTITY_TYPE_COLOR[n.type] ?? FALLBACK_COLOR;
          return [c[0], c[1], c[2], 220];
        },
        pickable: true,
        onHover: (info) => {
          hoverEntityNode((info.object as GraphsEntityNode) ?? null, info.x, info.y);
          return true;
        },
      }),
    ];
  }, [entity, hoverEntityNode]);

  // Test seams (the __nadiChangeOverlay mirror + __nadiEdit* injection patterns): derived counts
  // as plain data, and hover injection CALLING THE REAL handlers.
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__nadiGraphs = {
      loading,
      error,
      oasis: oasis
        ? {
            nodes: oasis.nodes.length,
            edges: oasis.edges.length,
            connectors: activeInfluence.length,
            exclusions: oasis.nodes.filter((n) => n.excluded).length,
            activeCascade,
          }
        : null,
      entity: entity ? { nodes: entity.nodes.length, edges: entity.edges.length, stale: !!entity.stale_note } : null,
    };
    w.__nadiGraphsHover = (panel: string, id: string) => {
      if (panel === 'oasis') hoverOasisNode(oasisById[id] ?? null, 20, 20);
      else hoverEntityNode(entity?.nodes.find((n) => n.id === id) ?? null, 20, 20);
    };
    return () => {
      delete w.__nadiGraphs;
      delete w.__nadiGraphsHover;
    };
  }, [loading, error, oasis, entity, activeInfluence, activeCascade, oasisById, hoverOasisNode, hoverEntityNode]);

  return (
    <div style={sheet} data-testid="graph-split-view">
      <div style={inner}>
        <div style={oneLiner} data-testid="graphs-one-liner">
          {SPLIT_ONE_LINER}
        </div>
        {/* no sidecar at all: loading (never flash the per-panel empty states) or the labeled
            missing state naming BOTH recovery paths; per-panel empties are for a LOADED sidecar
            whose half is null */}
        {!graphs ? (
          error ? (
            <div style={emptyState} data-testid="graphs-missing">
              No graph layouts exported for this run yet — they are written by the discourse and
              report enriches ({BACKFILL_HINT}).
            </div>
          ) : (
            <div style={loadingNote}>loading graph layouts…</div>
          )
        ) : (
        <div style={panels}>
          {/* ---------- OASIS panel ---------- */}
          <div style={panel} data-testid="graph-panel-oasis">
            <div style={panelHead} data-testid="oasis-header">
              {OASIS_HEADER}
            </div>
            {oasis ? (
              <>
                <div style={metaLine} data-testid="oasis-meta">
                  {oasis.coverage.with_edges} of {oasis.coverage.agents} voices have follow edges
                  {/* attribute the agents-vs-nodes gap to its ACTUAL causes (review-caught):
                      institutional exclusion first, sibling-dedup only for the remainder */}
                  {(oasis.coverage.mandate_excluded ?? 0) > 0
                    ? ` · ${oasis.coverage.mandate_excluded} institutional voice(s) speak in the feed, not the graph`
                    : ''}
                  {oasis.coverage.nodes < oasis.coverage.agents - (oasis.coverage.mandate_excluded ?? 0)
                    ? ' · sibling voices share a node'
                    : ''}{' '}
                  · {oasis.nodes.filter((n) => n.excluded).length} voice(s) had posts withheld by the honesty audit
                </div>
                <div style={noteLine}>{oasis.exposure_note}.</div>
                {cascadeIds.length > 0 && activeCascade && (
                  <CascadeSelector ids={cascadeIds} active={activeCascade} onSelect={setCascade} />
                )}
                <div style={{ position: 'relative' }}>
                  <DeckPanel panelId="oasis" nodes={oasis.nodes} layers={oasisLayers} onHover={setOasisHover} />
                  {oasisHover && (
                    <div style={{ ...tooltip, left: oasisHover.x + 12, top: oasisHover.y + 12 }} data-testid="oasis-tooltip">
                      {oasisHover.lines.map((l, i) => (
                        <div key={i}>{l}</div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={legendLine}>
                  ● voices (colored by stakeholder group, uniform size) · ─ follow edges ·{' '}
                  <span style={{ color: '#c44545' }}>┅ influence (selected cascade)</span> ·{' '}
                  <span style={{ color: '#c97915' }}>◯ posts withheld (hover for the rule)</span>
                </div>
              </>
            ) : (
              <div style={emptyState} data-testid="oasis-empty">
                No discourse for this run — the social graph exists only after the discourse enrich.
                Run it from the ✏️ Edit rail ({BACKFILL_HINT}).
              </div>
            )}
          </div>

          {/* ---------- entity panel ---------- */}
          <div style={panel} data-testid="graph-panel-entity">
            <div style={panelHead} data-testid="entity-header">
              {ENTITY_HEADER}
            </div>
            {entity ? (
              <>
                <div style={metaLine} data-testid="entity-meta">
                  {entity.note} · index built {entity.index_built_at ?? 'unknown'} · {entity.components} clusters (
                  {entity.isolates} isolated) — {entity.packing_note}
                </div>
                {entity.stale_note && (
                  <div style={staleNote} data-testid="entity-stale-note">
                    {entity.stale_note}
                  </div>
                )}
                <div style={{ position: 'relative' }}>
                  <DeckPanel panelId="entity" nodes={entity.nodes} layers={entityLayers} onHover={setEntityHover} />
                  {entityHover && (
                    <div style={{ ...tooltip, left: entityHover.x + 12, top: entityHover.y + 12 }} data-testid="entity-tooltip">
                      {entityHover.lines.map((l, i) => (
                        <div key={i}>{l}</div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={legendLine}>● entities (colored by extracted type, uniform size) · ─ relations (opacity by weight)</div>
              </>
            ) : (
              <div style={emptyState} data-testid="entity-empty">
                No chat index for this run — the entity graph exists only after the report enrich
                builds the index. Run it from the ✏️ Edit rail ({BACKFILL_HINT}).
              </div>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

const sheet: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 24, // below the mode toggle (25) — the way back out must stay clickable
  background: 'rgba(247,248,250,0.98)',
  overflowY: 'auto',
  fontFamily: 'system-ui, sans-serif',
};
const inner: React.CSSProperties = { padding: '64px 20px 24px' };
const oneLiner: React.CSSProperties = {
  textAlign: 'center',
  fontSize: 13,
  fontWeight: 600,
  color: '#374151',
  marginBottom: 12,
};
const panels: React.CSSProperties = { display: 'flex', gap: 14, alignItems: 'stretch' };
const panel: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: '#fff',
  border: '1px solid #d7dbe0',
  borderRadius: 12,
  padding: '12px 14px',
  boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
};
const panelHead: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#1f2937', marginBottom: 6 };
const metaLine: React.CSSProperties = { fontSize: 11, color: '#6b7280', lineHeight: 1.4, marginBottom: 4 };
const noteLine: React.CSSProperties = { fontSize: 11, color: '#6b7280', fontStyle: 'italic', marginBottom: 6 };
const staleNote: React.CSSProperties = {
  fontSize: 11.5,
  color: '#8a6d1a',
  background: '#fdf6e3',
  borderRadius: 8,
  padding: '5px 8px',
  marginBottom: 6,
};
const tooltip: React.CSSProperties = {
  position: 'absolute',
  zIndex: 5,
  pointerEvents: 'none',
  background: 'rgba(28,32,38,0.92)',
  color: '#f3f4f6',
  fontSize: 11.5,
  lineHeight: 1.45,
  borderRadius: 6,
  padding: '5px 8px',
  maxWidth: 300,
};
const legendLine: React.CSSProperties = { fontSize: 10.5, color: '#6b7280', marginTop: 6 };
const emptyState: React.CSSProperties = {
  fontSize: 12.5,
  color: '#6b7280',
  lineHeight: 1.5,
  background: '#f3f4f6',
  borderRadius: 8,
  padding: '14px 16px',
  marginTop: 8,
};
const loadingNote: React.CSSProperties = { textAlign: 'center', fontSize: 12, color: '#9aa0a6', marginTop: 10 };
