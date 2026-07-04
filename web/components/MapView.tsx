'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, { useControl, type MapRef } from 'react-map-gl/maplibre';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { TripsLayer } from '@deck.gl/geo-layers';
import { ScatterplotLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { Conflict, LonLat, Person, PinnedSimAgent, TrajectoryArtifact, Vehicle } from '@/lib/types';
import { isSimPersonAgent, isSimVehicleAgent } from '@/lib/types';
import { Timeline } from '@/components/Timeline';
import { ScenarioHeader } from '@/components/ScenarioHeader';
import { CommentFeed } from '@/components/CommentFeed';
import { AgentPanel } from '@/components/AgentPanel';
import { ConflictLegend } from '@/components/ConflictLegend';
import { activeAt, agentId, positionAtCached, sentimentColor } from '@/lib/viz';

// Token-free CARTO positron style (no API key).
const POSITRON = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

// The artifact to play back. Stable alias written by the pipeline's final step (scorecard.py) — always
// mirrors the fully-assembled + scorecard-injected run, so no brittle timestamped filename here.
const ARTIFACT_URL = '/latest.json';

const PULSE_WINDOW = 25; // sim seconds around trigger_t during which an instrumented dot swells
const CONFLICT_FADE_S = 10; // a near-miss pulse fades over ~this many sim-seconds, then rests as a dot

/** A sim agent joined to its trajectory (vehicle OR person) — stable across frames; the clickable dots. */
interface Pinned {
  agent: PinnedSimAgent;
  path: LonLat[];
  timestamps: number[];
  kind: 'vehicle' | 'person';
}

/** Attaches a deck.gl MapboxOverlay to the MapLibre map and re-pushes layers + tooltip each render. */
function DeckOverlay({
  layers,
  getTooltip,
}: {
  layers: Layer[];
  getTooltip: (info: PickingInfo) => { html: string; style?: Record<string, string> } | null;
}) {
  const overlay = useControl(() => new MapboxOverlay({ interleaved: false }));
  overlay.setProps({ layers, getTooltip });
  return null;
}

export default function MapView() {
  const [artifact, setArtifact] = useState<TrajectoryArtifact | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [selected, setSelected] = useState<PinnedSimAgent | null>(null);
  const [showAllConflicts, setShowAllConflicts] = useState(true);
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

  // Static split (recomputed only when the artifact changes). PINNED = sim agents joined to a real
  // simulated traveler — vehicle- OR person-backed (both get a clickable dot). BACKGROUND = every
  // vehicle/person NOT pinned. Inferred agents have no trip, so they don't appear on the map.
  const { pinned, bgVehicles, bgPersons } = useMemo(() => {
    const vehicles = artifact?.vehicles ?? [];
    const persons = artifact?.persons ?? [];
    // NB: `Map` is shadowed by the react-map-gl <Map> import above — use plain Records for the lookups.
    const vById: Record<string, Vehicle> = {};
    for (const v of vehicles) vById[v.id] = v;
    const pById: Record<string, Person> = {};
    for (const p of persons) pById[p.id] = p;

    const pins: Pinned[] = [];
    const pinnedVeh = new Set<string>();
    const pinnedPer = new Set<string>();
    for (const a of artifact?.agents ?? []) {
      if (isSimVehicleAgent(a)) {
        const v = vById[a.vehicle_id];
        if (v) {
          pins.push({ agent: a, path: v.path, timestamps: v.timestamps, kind: 'vehicle' });
          pinnedVeh.add(v.id);
        }
      } else if (isSimPersonAgent(a)) {
        const p = pById[a.person_id];
        if (p) {
          pins.push({ agent: a, path: p.path, timestamps: p.timestamps, kind: 'person' });
          pinnedPer.add(p.id);
        }
      }
    }
    return {
      pinned: pins,
      bgVehicles: vehicles.filter((v) => !pinnedVeh.has(v.id)),
      bgPersons: persons.filter((p) => !pinnedPer.has(p.id)),
    };
  }, [artifact]);

  // Agents for the time-keyed comment feed = the pinned ones (all carry trigger_t).
  const pinnedAgents = useMemo(() => pinned.map((p) => p.agent), [pinned]);
  const conflicts = useMemo(() => artifact?.conflicts ?? [], [artifact]);

  // Near-miss tooltip — hover on a conflict dot/pulse. Ordinal framing ONLY (never a rate/probability).
  const getTooltip = useCallback((info: PickingInfo) => {
    const lid = info.layer?.id;
    if ((lid === 'conflict-dots' || lid === 'conflict-pulses') && info.object) {
      const c = info.object as Conflict;
      return {
        html:
          `<div style="font:12px system-ui,sans-serif;line-height:1.4">` +
          `<b>Near-miss event</b><br/>` +
          `type: ${c.type}<br/>` +
          `sim-time: ${Math.round(c.t)}s<br/>` +
          `severity: ${c.severity.toFixed(2)} <span style="opacity:0.7">(higher = more severe in this run)</span>` +
          `</div>`,
        style: { background: 'rgba(20,20,25,0.92)', color: '#fff', borderRadius: '6px', padding: '7px 9px' },
      };
    }
    return null;
  }, []);

  if (!artifact) {
    return <div style={loading}>Loading scenario…</div>;
  }

  const { meta } = artifact;
  const [minLon, minLat, maxLon, maxLat] = meta.bbox;
  const t = currentTime;

  // 1) Faint trails for the instrumented VEHICLE travelers (keeps the current look; ped trails omitted).
  const trailVehicles = pinned.filter((d) => d.kind === 'vehicle');
  const trails = new TripsLayer<Pinned>({
    id: 'instrumented-trails',
    data: trailVehicles,
    getPath: (d) => d.path,
    getTimestamps: (d) => d.timestamps,
    getColor: [120, 125, 135],
    opacity: 0.5,
    widthMinPixels: 2,
    trailLength: 200,
    fadeTrail: true,
    currentTime: t,
    capRounded: true,
    jointRounded: true,
  });

  // 2a) Background vehicles: small neutral-grey dots at their current position (only while active).
  const bgVehActive = bgVehicles.filter((v) => activeAt(v.timestamps, t));
  const backgroundVehicleDots = new ScatterplotLayer<Vehicle>({
    id: 'background-vehicle-dots',
    data: bgVehActive,
    getPosition: (v) => positionAtCached(v.path, v.timestamps, t),
    getFillColor: [150, 152, 158, 150],
    getRadius: 2.5,
    radiusUnits: 'pixels',
    pickable: false,
    updateTriggers: { getPosition: t },
  });

  // 2b) Background pedestrians: same small dot, a subtly distinct (muted teal) tint from vehicles.
  const bgPerActive = bgPersons.filter((p) => activeAt(p.timestamps, t));
  const backgroundPersonDots = new ScatterplotLayer<Person>({
    id: 'background-person-dots',
    data: bgPerActive,
    getPosition: (p) => positionAtCached(p.path, p.timestamps, t),
    getFillColor: [110, 158, 160, 165],
    getRadius: 2.5,
    radiusUnits: 'pixels',
    pickable: false,
    updateTriggers: { getPosition: t },
  });

  // 3) Conflicts — SURROGATE near-misses observed in this run (NEVER a crash prediction / danger claim).
  // 3a) Persistent dots (toggle "show all conflicts"): one STATIC layer (stable data ref, no per-frame
  //     updateTriggers → near-zero cost). Subtle small dots that read as "events happened here".
  const conflictDots = new ScatterplotLayer<Conflict>({
    id: 'conflict-dots',
    data: conflicts,
    visible: showAllConflicts,
    getPosition: (c) => [c.lon, c.lat],
    getFillColor: [120, 120, 132, 110],
    getRadius: 2.5,
    radiusUnits: 'pixels',
    pickable: true,
  });

  // 3b) Active pulses: each near-miss flares as playback crosses its `t`, fading over CONFLICT_FADE_S.
  //     The active window holds only a handful at a time, so CPU-filtering per frame is cheap (no
  //     DataFilterExtension needed at this scale — see the plan's research note).
  const activeConflicts = conflicts.filter((c) => {
    const age = t - c.t;
    return age >= 0 && age <= CONFLICT_FADE_S;
  });
  const conflictPulses = new ScatterplotLayer<Conflict>({
    id: 'conflict-pulses',
    data: activeConflicts,
    getPosition: (c) => [c.lon, c.lat],
    getFillColor: (c) => {
      const frac = Math.max(0, 1 - (t - c.t) / CONFLICT_FADE_S); // 1 at the event → 0 as it fades
      return [235, 140, 60, Math.round(40 + 190 * frac)];
    },
    getRadius: (c) => 4 + Math.max(0, Math.min(1, c.severity)) * 8, // 4–12 px, severity-scaled
    radiusUnits: 'pixels',
    stroked: true,
    getLineColor: [235, 140, 60, 220],
    getLineWidth: 1,
    lineWidthUnits: 'pixels',
    pickable: true,
    updateTriggers: { getFillColor: t }, // small active set → cheap per-frame re-eval
  });

  // 4) Instrumented dots: larger, colored by sentiment, clickable; swell near their trigger_t. Now covers
  //    BOTH vehicle- and person-pinned sim agents (one layer, driven off the unified pinned list).
  const instActive = pinned.filter((d) => activeAt(d.timestamps, t));
  const instrumentedDots = new ScatterplotLayer<Pinned>({
    id: 'instrumented-dots',
    data: instActive,
    getPosition: (d) => positionAtCached(d.path, d.timestamps, t),
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
      const obj = info.object as Pinned | undefined;
      if (obj) setSelected(obj.agent);
    },
    updateTriggers: { getPosition: t, getRadius: t }, // NOT getFillColor — sentiment is static
  });

  const layers: Layer[] = [
    trails,
    backgroundVehicleDots,
    backgroundPersonDots,
    conflictDots,
    conflictPulses,
    instrumentedDots,
  ];

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
        <DeckOverlay layers={layers} getTooltip={getTooltip} />
      </Map>

      <ScenarioHeader scenario={meta.scenario} />
      <CommentFeed
        agents={pinnedAgents}
        currentTime={t}
        onSelect={setSelected}
        selectedId={selected ? agentId(selected) : null}
      />
      <AgentPanel agent={selected} onClose={() => setSelected(null)} />
      <ConflictLegend
        count={conflicts.length}
        activeCount={activeConflicts.length}
        showAll={showAllConflicts}
        onToggle={() => setShowAllConflicts((s) => !s)}
      />
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
