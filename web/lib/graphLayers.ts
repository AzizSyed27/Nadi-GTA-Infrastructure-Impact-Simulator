/**
 * V2.7b C9 — the OASIS graph's SHAPE and its RENDERING, lifted out of GraphSplitView so two
 * surfaces can draw the same graph the same way: Explore · Graphs (V2.3d, where it lives beside the
 * entity graph) and Act II's discourse stage card.
 *
 * This is a pure MOVE, deliberately byte-faithful — the palettes, the five layers, their ids, radii
 * and alphas are unchanged, and `graphs.spec.ts`'s eight tests are the proof of that. The honesty
 * rails came with it and are restated here because this is now where they live:
 *
 *   * UNIFORM node radius. Degree sizing would render a visual centrality leaderboard, which is the
 *     referendum guard's problem in a different medium.
 *   * Group colours never encode stance.
 *   * Influence connectors are DASHED and drawn separately from follow edges, because they are a
 *     different relation — only ~6% of them coincide, and the sidecar's exposure note says so.
 *   * Exclusion rings mark WITHHELD-POST METADATA. The count and the rule names may be shown; the
 *     content never may.
 */

import type { Layer } from '@deck.gl/core';
import { LineLayer, PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { PathStyleExtension } from '@deck.gl/extensions';

// ---------------------------------------------------------------- the sidecar shape (off-contract)

export interface GraphsOasisNode {
  id: string;
  x: number;
  y: number;
  label: string;
  group: string | null;
  grounding: string;
  connected: boolean;
  /** METADATA about withheld posts — a count and the rules that withheld them, never the text. */
  excluded?: { count: number; rules: string[] };
}

export interface GraphsOasis {
  framing: string;
  seed: number;
  layout: string;
  nodes: GraphsOasisNode[];
  edges: { from: string; to: string; kind: string }[];
  influence: { cascade_id: string | null; from: string; to: string; shifted: boolean }[];
  coverage: { agents: number; nodes: number; with_edges: number; mandate_excluded?: number };
  exposure_note: string;
}

export interface GraphsEntityNode {
  id: string;
  x: number;
  y: number;
  type: string;
  sources: string[];
  source_count: number;
}

export interface GraphsEntity {
  framing: string;
  index_ts: string;
  index_built_at: string | null;
  note: string;
  packing_note: string;
  stale_note?: string;
  nodes: GraphsEntityNode[];
  edges: { from: string; to: string; weight: number }[];
  components: number;
  isolates: number;
}

export interface GraphsSidecar {
  run_id: string;
  generated_at: string;
  oasis: GraphsOasis | null;
  entity: GraphsEntity | null;
}

// ------------------------------------------------------------------------------------- palettes

export const GROUP_COLOR: Record<string, [number, number, number]> = {
  car: [31, 78, 156],
  bicycle: [46, 139, 87],
  pedestrian: [217, 130, 30],
  local_resident: [124, 90, 168],
  business_owner: [150, 100, 60],
  accessibility: [0, 140, 140],
  transit_riders: [190, 80, 130],
  taxpayer: [110, 116, 125],
};

export const EDGE_KIND_COLOR: Record<string, [number, number, number, number]> = {
  homophily: [120, 135, 155, 80],
  geography: [110, 150, 120, 90],
  cross: [180, 150, 90, 100],
};

export const FALLBACK_COLOR: [number, number, number] = [110, 116, 125];

// --------------------------------------------------------------------------------- the layer set

/**
 * The OASIS half's five layers, in paint order. PURE — every input is passed in, so the same call
 * produces the same layers from either surface.
 *
 * `influence` arrives ALREADY FILTERED to the active cascade, and `shiftedIds` derived from it, because
 * both are also read by the caller's own seam/tooltip code; recomputing them here would give two
 * surfaces two chances to disagree about which cascade is showing.
 */
export function buildOasisLayers({
  oasis,
  oasisById,
  influence,
  shiftedIds,
  onHoverNode,
}: {
  oasis: GraphsOasis;
  oasisById: Record<string, GraphsOasisNode>;
  influence: GraphsOasis['influence'];
  shiftedIds: Set<string>;
  onHoverNode: (n: GraphsOasisNode | null, x: number, y: number) => void;
}): Layer[] {
  const pos = (id: string): [number, number] => [oasisById[id].x, oasisById[id].y];
  return [
    new LineLayer({
      id: 'follow-edges',
      data: oasis.edges.filter((e) => oasisById[e.from] && oasisById[e.to]),
      getSourcePosition: (e: GraphsOasis['edges'][0]) => pos(e.from),
      getTargetPosition: (e: GraphsOasis['edges'][0]) => pos(e.to),
      getColor: (e: GraphsOasis['edges'][0]) => EDGE_KIND_COLOR[e.kind] ?? [130, 130, 130, 80],
      getWidth: 1,
      widthUnits: 'pixels',
    }),
    new PathLayer({
      id: 'influence',
      data: influence.filter((p) => oasisById[p.from] && oasisById[p.to]),
      getPath: (p: GraphsOasis['influence'][0]) => [pos(p.from), pos(p.to)],
      getColor: [196, 69, 69, 190],
      getWidth: 1.6,
      widthUnits: 'pixels',
      getDashArray: [5, 4],
      dashJustified: true,
      extensions: [new PathStyleExtension({ dash: true })],
    }),
    new ScatterplotLayer({
      id: 'exclusion-rings',
      data: oasis.nodes.filter((n) => n.excluded),
      getPosition: (n: GraphsOasisNode) => [n.x, n.y],
      stroked: true,
      filled: false,
      getLineColor: [201, 121, 21, 230],
      getLineWidth: 2,
      lineWidthUnits: 'pixels',
      getRadius: 8,
      radiusUnits: 'pixels',
      pickable: false,
    }),
    new ScatterplotLayer({
      id: 'shifted-rings',
      data: oasis.nodes.filter((n) => shiftedIds.has(n.id)),
      getPosition: (n: GraphsOasisNode) => [n.x, n.y],
      stroked: true,
      filled: false,
      getLineColor: [196, 69, 69, 200],
      getLineWidth: 1.5,
      lineWidthUnits: 'pixels',
      getRadius: 6,
      radiusUnits: 'pixels',
      pickable: false,
    }),
    new ScatterplotLayer({
      id: 'oasis-nodes',
      data: oasis.nodes,
      getPosition: (n: GraphsOasisNode) => [n.x, n.y],
      // UNIFORM radius — degree sizing would be a visual centrality leaderboard
      getRadius: 4,
      radiusUnits: 'pixels',
      getFillColor: (n: GraphsOasisNode) => {
        const c = (n.group && GROUP_COLOR[n.group]) || FALLBACK_COLOR;
        return [c[0], c[1], c[2], n.connected ? 235 : 90];
      },
      pickable: true,
      onHover: (info) => {
        onHoverNode((info.object as GraphsOasisNode) ?? null, info.x, info.y);
        return true;
      },
    }),
  ];
}
