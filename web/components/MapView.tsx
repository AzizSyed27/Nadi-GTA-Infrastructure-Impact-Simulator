'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Map, { useControl, type MapRef } from 'react-map-gl/maplibre';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { TripsLayer } from '@deck.gl/geo-layers';
import { ScatterplotLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { Agent, TrajectoryArtifact, Vehicle } from '@/lib/types';
import { Timeline } from '@/components/Timeline';
import { ScenarioHeader } from '@/components/ScenarioHeader';
import { CommentFeed } from '@/components/CommentFeed';
import { AgentPanel } from '@/components/AgentPanel';
import { activeAt, positionAt, sentimentColor } from '@/lib/viz';

// Token-free CARTO positron style (no API key).
const POSITRON = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

// The artifact to play back. Verified against `/sample_v0_2_0.json` first; now the real Groq run.
// (Timestamped filename is brittle — one-line change to point at a different run.)
const ARTIFACT_URL = '/scenario-20260625T162323Z.json';

const PULSE_WINDOW = 25; // sim seconds around trigger_t during which the instrumented dot swells

/** An instrumented traveler joined to its vehicle trajectory (stable across frames). */
interface Instrumented {
  agent: Agent;
  vehicle: Vehicle;
}

/** Attaches a deck.gl MapboxOverlay to the MapLibre map and re-pushes layers each render. */
function DeckOverlay({ layers }: { layers: Layer[] }) {
  const overlay = useControl(() => new MapboxOverlay({ interleaved: false }));
  overlay.setProps({ layers });
  return null;
}

export default function MapView() {
  const [artifact, setArtifact] = useState<TrajectoryArtifact | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [selected, setSelected] = useState<Agent | null>(null);
  const mapRef = useRef<MapRef | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(ARTIFACT_URL)
      .then((r) => r.json())
      .then((data: TrajectoryArtifact) => {
        if (cancelled) return;
        setArtifact(data);
        setCurrentTime(data.meta.sim_start);
      })
      .catch((e) => console.error(`failed to load ${ARTIFACT_URL}`, e));
    return () => {
      cancelled = true;
    };
  }, []);

  const agents = useMemo<Agent[]>(() => artifact?.agents ?? [], [artifact]);

  // Static split (recomputed only when the artifact changes): instrumented vehicles (joined to their
  // agent) vs background vehicles. A vehicle is INSTRUMENTED iff its id appears in agents[].
  const { instrumented, background } = useMemo(() => {
    const vehicles = artifact?.vehicles ?? [];
    // NB: `Map` is shadowed by the react-map-gl <Map> import above — use a plain Record for the lookup.
    const byId: Record<string, Vehicle> = {};
    for (const v of vehicles) byId[v.id] = v;
    const inst: Instrumented[] = [];
    for (const a of agents) {
      const v = byId[a.vehicle_id];
      if (v) inst.push({ agent: a, vehicle: v });
    }
    const instIds = new Set(agents.map((a) => a.vehicle_id));
    const bg = vehicles.filter((v) => !instIds.has(v.id));
    return { instrumented: inst, background: bg };
  }, [artifact, agents]);

  if (!artifact) {
    return <div style={loading}>Loading scenario…</div>;
  }

  const { meta } = artifact;
  const [minLon, minLat, maxLon, maxLat] = meta.bbox;
  const t = currentTime;

  // 1) Faint trails for the instrumented travelers — so each watched traveler's route reads as motion.
  const trails = new TripsLayer<Instrumented>({
    id: 'instrumented-trails',
    data: instrumented,
    getPath: (d) => d.vehicle.path,
    getTimestamps: (d) => d.vehicle.timestamps,
    getColor: [120, 125, 135],
    opacity: 0.5,
    widthMinPixels: 2,
    trailLength: 200,
    fadeTrail: true,
    currentTime: t,
    capRounded: true,
    jointRounded: true,
  });

  // 2) Background vehicles: small neutral dots at their current position (only while active).
  const bgActive = background.filter((v) => activeAt(v.timestamps, t));
  const backgroundDots = new ScatterplotLayer<Vehicle>({
    id: 'background-dots',
    data: bgActive,
    getPosition: (v) => positionAt(v.path, v.timestamps, t),
    getFillColor: [150, 152, 158, 150],
    getRadius: 2.5,
    radiusUnits: 'pixels',
    pickable: false,
    updateTriggers: { getPosition: t },
  });

  // 3) Instrumented dots: larger, colored by sentiment, clickable; swell near their trigger_t.
  const instActive = instrumented.filter((d) => activeAt(d.vehicle.timestamps, t));
  const instrumentedDots = new ScatterplotLayer<Instrumented>({
    id: 'instrumented-dots',
    data: instActive,
    getPosition: (d) => positionAt(d.vehicle.path, d.vehicle.timestamps, t),
    getFillColor: (d) => [...sentimentColor(d.agent.reaction.sentiment), 255],
    getRadius: (d) => (Math.abs(t - d.agent.trigger_t) < PULSE_WINDOW ? 11 : 7),
    radiusUnits: 'pixels',
    stroked: true,
    getLineColor: [255, 255, 255],
    getLineWidth: 1.5,
    lineWidthUnits: 'pixels',
    pickable: true,
    autoHighlight: true,
    highlightColor: [255, 255, 255, 90],
    onClick: (info: PickingInfo) => {
      const obj = info.object as Instrumented | undefined;
      if (obj) setSelected(obj.agent);
    },
    updateTriggers: { getPosition: t, getRadius: t }, // NOT getFillColor — sentiment is static
  });

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: (minLon + maxLon) / 2,
          latitude: (minLat + maxLat) / 2,
          zoom: 12,
        }}
        mapStyle={POSITRON}
        style={{ width: '100%', height: '100%' }}
        onLoad={() => {
          mapRef.current?.getMap().fitBounds(
            [
              [minLon, minLat],
              [maxLon, maxLat],
            ],
            { padding: 40, duration: 0 },
          );
        }}
      >
        <DeckOverlay layers={[trails, backgroundDots, instrumentedDots]} />
      </Map>

      <ScenarioHeader scenario={meta.scenario} />
      <CommentFeed
        agents={agents}
        currentTime={t}
        onSelect={setSelected}
        selectedId={selected?.vehicle_id}
      />
      <AgentPanel agent={selected} onClose={() => setSelected(null)} />
      <Timeline
        simStart={meta.sim_start}
        simEnd={meta.sim_end}
        currentTime={t}
        onSeek={setCurrentTime}
        vehicleCount={artifact.vehicles.length}
      />
    </div>
  );
}

const loading: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  fontFamily: 'system-ui, sans-serif',
  color: '#555',
};
