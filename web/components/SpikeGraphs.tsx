'use client';

// V2.3d STEP-1 SPIKE (temporary — deleted before the feature lands): standalone deck.gl Deck under
// OrthographicView on a plain <canvas>, per the plan checklist. Renders a small synthetic graph and
// reports every checklist probe into a JSON readout the browser check can read.

import { useEffect, useRef, useState } from 'react';
import { Deck, OrthographicView } from '@deck.gl/core';
import { LineLayer, PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { PathStyleExtension } from '@deck.gl/extensions';

const NODES = Array.from({ length: 40 }, (_, i) => ({
  id: `n${i}`,
  x: (i % 8) * 40,
  y: Math.floor(i / 8) * 40, // y grows DOWN in our packing — flipY probe
  label: `node ${i}`,
}));
const EDGES = Array.from({ length: 30 }, (_, i) => ({
  from: NODES[i % 40],
  to: NODES[(i * 7 + 3) % 40],
}));
const DASHED = Array.from({ length: 8 }, (_, i) => ({
  path: [
    [NODES[i].x, NODES[i].y],
    [NODES[39 - i].x, NODES[39 - i].y],
  ] as [number, number][],
}));

function makeLayers(alt: boolean, onHover: (o: unknown, x: number, y: number) => void) {
  return [
    new LineLayer({
      id: 'edges',
      data: EDGES,
      getSourcePosition: (d: (typeof EDGES)[0]) => [d.from.x, d.from.y],
      getTargetPosition: (d: (typeof EDGES)[0]) => [d.to.x, d.to.y],
      getColor: [150, 160, 170, 120],
      getWidth: 1,
      widthUnits: 'pixels',
    }),
    new PathLayer({
      id: 'dashed',
      data: alt ? DASHED.slice(0, 4) : DASHED,
      getPath: (d: (typeof DASHED)[0]) => d.path,
      getColor: [200, 80, 40, 200],
      getWidth: 2,
      widthUnits: 'pixels',
      getDashArray: [6, 4],
      dashJustified: true,
      extensions: [new PathStyleExtension({ dash: true })],
    }),
    new ScatterplotLayer({
      id: 'nodes',
      data: NODES,
      getPosition: (d: (typeof NODES)[0]) => [d.x, d.y],
      getFillColor: alt ? [40, 120, 200, 255] : [30, 90, 160, 255],
      getRadius: 6,
      radiusUnits: 'pixels',
      pickable: true,
      onHover: (info) => {
        onHover(info.object ?? null, info.x, info.y);
        return true;
      },
    }),
  ];
}

function SpikePanel({ label, report }: { label: string; report: (k: string, v: unknown) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const deckRef = useRef<Deck<OrthographicView> | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [alt, setAlt] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let deck: Deck<OrthographicView> | null = null;
    try {
      deck = new Deck({
        canvas,
        views: new OrthographicView({ flipY: true }),
        controller: true,
        initialViewState: { target: [140, 90, 0], zoom: 0.5 },
        layers: makeLayers(false, (o, x, y) => {
          const obj = o as { label?: string } | null;
          setHover(obj?.label ? `${obj.label}@${Math.round(x)},${Math.round(y)}` : null);
        }),
      });
      deckRef.current = deck;
      report(`${label}:constructed`, true);
    } catch (e) {
      report(`${label}:constructed`, String(e));
    }
    return () => {
      try {
        deck?.finalize();
        report(`${label}:finalized`, true);
      } catch (e) {
        report(`${label}:finalized`, String(e));
      }
      deckRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // setProps layer swap (the tab-switch path)
    try {
      deckRef.current?.setProps({
        layers: makeLayers(alt, (o, x, y) => {
          const obj = o as { label?: string } | null;
          setHover(obj?.label ? `${obj.label}@${Math.round(x)},${Math.round(y)}` : null);
        }),
      });
      report(`${label}:setProps`, true);
    } catch (e) {
      report(`${label}:setProps`, String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alt]);

  return (
    <div style={{ border: '1px solid #ccc', padding: 8 }}>
      <div>
        {label} · hover: <span data-testid={`${label}-hover`}>{hover ?? '—'}</span>{' '}
        <button data-testid={`${label}-swap`} onClick={() => setAlt((a) => !a)}>
          swap layers
        </button>
      </div>
      {/* Deck absolutely positions/resizes the canvas — it needs a position:relative sized box */}
      <div data-testid={`${label}-box`} style={{ position: 'relative', width: 420, height: 300, overflow: 'hidden' }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

export default function SpikeGraphs() {
  const [results, setResults] = useState<Record<string, unknown>>({});
  const [mounted, setMounted] = useState(true);
  const [cycles, setCycles] = useState(0);
  const report = (k: string, v: unknown) =>
    setResults((r) => (JSON.stringify(r[k]) === JSON.stringify(v) ? r : { ...r, [k]: v }));

  return (
    <div style={{ padding: 16, fontFamily: 'monospace', fontSize: 13 }}>
      <h3>V2.3d spike: Deck + OrthographicView (temporary)</h3>
      <button
        data-testid="spike-remount"
        onClick={() => {
          setMounted(false);
          setTimeout(() => {
            setMounted(true);
            setCycles((c) => c + 1);
          }, 50);
        }}
      >
        remount ({cycles})
      </button>
      {mounted && (
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <SpikePanel label="left" report={report} />
          <SpikePanel label="right" report={report} />
        </div>
      )}
      <pre data-testid="spike-out">{JSON.stringify({ ...results, cycles }, null, 1)}</pre>
    </div>
  );
}
