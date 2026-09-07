'use client';

/**
 * V2.7b C9 — a standalone Deck under an OrthographicView, lifted out of GraphSplitView so the
 * discourse stage card can draw the OASIS graph with the same renderer Explore · Graphs uses.
 * A pure move; `graphs.spec.ts` is the proof nothing changed.
 *
 * TWO PROPERTIES ARE LOAD-BEARING and were paid for in V2.3d:
 *
 *   * THE CANVAS NEEDS A `position: relative` SIZED WRAPPER. Deck repositions raw canvases, so
 *     without the wrapper the panel escapes its box.
 *   * THE DECK IS CONSTRUCTED ONCE PER `bounds` IDENTITY and layers ride `setProps`. `bounds` is
 *     memoed on `[nodes]` BY REFERENCE, so a caller that hands over a freshly-built nodes array on
 *     every update finalizes and rebuilds the whole Deck each time. An animating surface must keep
 *     one stable nodes array and vary only `layers`.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Deck, OrthographicView } from '@deck.gl/core';
import type { Layer } from '@deck.gl/core';

export function DeckPanel({
  panelId,
  nodes,
  layers,
  onHover,
  style,
}: {
  panelId: string;
  /** Positions only — used for BOUNDS. Picking and hover ride the layers the caller builds. */
  nodes: { x: number; y: number }[];
  layers: Layer[];
  onHover: (h: null) => void;
  /** The sized wrapper's style. Defaults to the V2.3d graph-panel box. */
  style?: React.CSSProperties;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const deckRef = useRef<Deck<OrthographicView> | null>(null);

  const bounds = useMemo(() => {
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: Math.max(1e-6, maxX - minX), h: Math.max(1e-6, maxY - minY) };
  }, [nodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box || nodes.length === 0) return; // empty half never constructs a deck (NaN bounds)
    const zoom = Math.log2(Math.min(box.clientWidth / bounds.w, box.clientHeight / bounds.h)) - 0.15;
    const deck = new Deck<OrthographicView>({
      canvas,
      views: new OrthographicView({ flipY: true }),
      controller: true,
      // clamp [-8, 10]: the OASIS spring layout lives in [-1, 1] (fit zoom ≈ 8) while the entity
      // shelf-pack spans thousands of units (fit ≈ 0) — a [-6, 6] clamp blob-ified the OASIS panel
      initialViewState: { target: [bounds.cx, bounds.cy, 0], zoom: Math.max(-8, Math.min(10, zoom)) },
      layers,
    });
    deckRef.current = deck;
    return () => {
      deck.finalize();
      deckRef.current = null;
    };
    // construct once per panel data identity — layers update via the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds]);

  useEffect(() => {
    deckRef.current?.setProps({ layers });
  }, [layers]);

  // clear the tooltip when the pointer leaves the panel entirely
  return (
    <div
      ref={boxRef}
      data-testid={`graph-canvas-${panelId}`}
      style={style ?? canvasBox}
      onMouseLeave={() => onHover(null)}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}

const canvasBox: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '56vh',
  overflow: 'hidden',
  background: '#fbfcfd',
  borderRadius: 8,
  border: '1px solid #eceff2',
};
