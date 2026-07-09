'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, { useControl, type MapRef } from 'react-map-gl/maplibre';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { TripsLayer } from '@deck.gl/geo-layers';
import { ScatterplotLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { Agent, Conflict, LonLat, Person, PinnedSimAgent, TrajectoryArtifact, Vehicle } from '@/lib/types';
import { isSimPersonAgent, isSimVehicleAgent } from '@/lib/types';
import { Timeline } from '@/components/Timeline';
import { ScenarioHeader } from '@/components/ScenarioHeader';
import { CommentFeed } from '@/components/CommentFeed';
import { DiscourseFeed } from '@/components/DiscourseFeed';
import { CascadeSelector } from '@/components/CascadeSelector';
import { ArgumentEngagementPanel } from '@/components/ArgumentEngagementPanel';
import { AgentPanel } from '@/components/AgentPanel';
import { ScorecardPanel } from '@/components/ScorecardPanel';
import { ReportPanel } from '@/components/ReportPanel';
import { ConflictLegend } from '@/components/ConflictLegend';
import { activeAt, agentId, positionAt, positionAtCached, sentimentColor } from '@/lib/viz';
import { agentLookup, cascadeById, cascadeIds, reachForCascade, trajectoriesForCascade } from '@/lib/social';

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
  const [feedGroup, setFeedGroup] = useState<string | null>(null); // scorecard→feed join filter
  const [flashId, setFlashId] = useState<string | null>(null); // reverse join: briefly ring a located dot
  const [showReport, setShowReport] = useState(false); // full-screen Report view (toggled from the map)
  const [mode, setMode] = useState<'playback' | 'discourse'>('playback'); // sim-time playback ⇄ social cascade
  const [cascadeId, setCascadeId] = useState<string | null>(null); // selected cascade in discourse mode
  const mapRef = useRef<MapRef | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    // no-store: latest.json is a large (~20MB), frequently-rewritten alias — don't HTTP-cache it (avoids
    // serving a stale artifact, and sidesteps chromium ERR_CACHE_WRITE_FAILURE on the large body).
    fetch(ARTIFACT_URL, { cache: 'no-store' })
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

  // Clear any pending flash timer on unmount.
  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
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
  // Inferred (community) voices — no trip, no dot; the feed interleaves them on a synthetic clock.
  const inferredAgents = useMemo<Agent[]>(
    () => (artifact?.agents ?? []).filter((a) => a.grounding === 'inferred'),
    [artifact],
  );
  // agentId → pinned entry, for the reverse join (feed row → fly to that traveler's dot).
  const pinnedById = useMemo(() => {
    const m: Record<string, Pinned> = {};
    for (const p of pinned) m[agentId(p.agent)] = p;
    return m;
  }, [pinned]);
  const conflicts = useMemo(() => artifact?.conflicts ?? [], [artifact]);

  // v0.4.0 social cascade (the discourse phase). All social render paths select via lib/social helpers,
  // which apply the load-bearing clean-filter — excluded content can never reach a component here.
  const social = artifact?.social ?? null;
  const socialIds = useMemo(() => (social ? cascadeIds(social) : []), [social]);
  const lookup = useMemo(() => (artifact ? agentLookup(artifact) : {}), [artifact]);
  const activeCascade = cascadeId ?? socialIds[0] ?? null;
  const selCascade = useMemo(
    () => (social && activeCascade ? cascadeById(social, activeCascade) : undefined),
    [social, activeCascade],
  );
  const selTrajectories = useMemo(
    () => (social && activeCascade ? trajectoriesForCascade(social, activeCascade) : []),
    [social, activeCascade],
  );
  const selReach = useMemo(
    () => (social && activeCascade ? reachForCascade(social, activeCascade) : []),
    [social, activeCascade],
  );

  // Reverse join: fly to (and briefly ring) a pinned agent's dot at its worst moment (trigger_t position).
  const onLocate = useCallback(
    (a: PinnedSimAgent) => {
      const p = pinnedById[agentId(a)];
      if (!p) return;
      const [lon, lat] = positionAt(p.path, p.timestamps, a.trigger_t);
      mapRef.current?.getMap().flyTo({ center: [lon, lat], zoom: 14, duration: 800 });
      setFlashId(agentId(a));
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashId(null), 1300);
    },
    [pinnedById],
  );

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

  // 5) Flash ring (reverse join): a transient white ring at a located agent's worst-moment position.
  const flashData = flashId && pinnedById[flashId] ? [pinnedById[flashId]] : [];
  const flashRing = new ScatterplotLayer<Pinned>({
    id: 'flash-ring',
    data: flashData,
    getPosition: (d) => positionAt(d.path, d.timestamps, d.agent.trigger_t),
    filled: false,
    stroked: true,
    getLineColor: [40, 90, 200, 230],
    getLineWidth: 2.5,
    lineWidthUnits: 'pixels',
    getRadius: 18,
    radiusUnits: 'pixels',
  });

  const layers: Layer[] = [
    trails,
    backgroundVehicleDots,
    backgroundPersonDots,
    conflictDots,
    conflictPulses,
    instrumentedDots,
    flashRing,
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

      {socialIds.length > 0 && (
        <div style={modeToggle} data-testid="mode-toggle">
          <button
            style={{ ...modeBtn, ...(mode === 'playback' ? modeBtnActive : null) }}
            onClick={() => setMode('playback')}
            data-testid="mode-playback"
          >
            ▶ Playback
          </button>
          <button
            style={{ ...modeBtn, ...(mode === 'discourse' ? modeBtnActive : null) }}
            onClick={() => setMode('discourse')}
            data-testid="mode-discourse"
          >
            💬 Discourse
          </button>
        </div>
      )}

      {mode === 'playback' ? (
        <>
          <CommentFeed
            agents={pinnedAgents}
            inferred={inferredAgents}
            currentTime={t}
            simStart={meta.sim_start}
            simEnd={meta.sim_end}
            filterGroup={feedGroup}
            onClearFilter={() => setFeedGroup(null)}
            onSelect={setSelected}
            onLocate={onLocate}
            selectedId={selected ? agentId(selected) : null}
          />
          <div style={rightRail}>
            <ScorecardPanel
              scorecard={artifact.scorecard}
              activeGroup={feedGroup}
              onSelectGroup={(g) => setFeedGroup((cur) => (cur === g ? null : g))}
            />
            <AgentPanel agent={selected} onClose={() => setSelected(null)} />
          </div>
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
        </>
      ) : (
        <>
          <DiscourseFeed
            cascade={selCascade}
            trajectories={selTrajectories}
            lookup={lookup}
            cascadeId={activeCascade ?? ''}
          />
          <div style={rightRail}>
            <CascadeSelector ids={socialIds} active={activeCascade ?? ''} onSelect={setCascadeId} />
            <ArgumentEngagementPanel rows={selReach} />
          </div>
        </>
      )}

      <button style={reportBtn} onClick={() => setShowReport(true)} data-testid="open-report">
        📄 Report
      </button>
      {showReport && <ReportPanel onClose={() => setShowReport(false)} />}
    </div>
  );
}

// Top-left affordance to open the full-screen Report view (the generated per-run report).
const reportBtn: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 16,
  zIndex: 25,
  border: '1px solid #d7dbe0',
  background: 'rgba(255,255,255,0.96)',
  borderRadius: 10,
  boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
  padding: '8px 12px',
  fontSize: 13,
  fontWeight: 600,
  color: '#374151',
  fontFamily: 'system-ui, sans-serif',
  cursor: 'pointer',
};

// Mode toggle (Playback ⇄ Discourse) — top center. Only shown when the artifact carries a social{} block.
const modeToggle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 25,
  display: 'flex',
  gap: 4,
  background: 'rgba(255,255,255,0.96)',
  border: '1px solid #d7dbe0',
  borderRadius: 10,
  boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
  padding: 3,
};
const modeBtn: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  borderRadius: 8,
  padding: '6px 12px',
  fontSize: 13,
  fontWeight: 600,
  color: '#6b7280',
  fontFamily: 'system-ui, sans-serif',
  cursor: 'pointer',
};
const modeBtnActive: React.CSSProperties = { background: '#1f4e9c', color: '#fff' };

// Top-right rail: scorecard stacked ABOVE the agent panel. Pointer-transparent so map clicks pass
// through the gaps; each child card re-enables pointer events on itself.
const rightRail: React.CSSProperties = {
  position: 'absolute',
  top: 70,
  right: 16,
  width: 340,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  maxHeight: 'calc(100vh - 160px)',
  overflowY: 'auto',
  zIndex: 20,
  pointerEvents: 'none',
};

const loading: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  fontFamily: 'system-ui, sans-serif',
  color: '#555',
};
