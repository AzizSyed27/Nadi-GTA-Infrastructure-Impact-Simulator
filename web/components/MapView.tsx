'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, { useControl, type MapRef } from 'react-map-gl/maplibre';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { TripsLayer } from '@deck.gl/geo-layers';
import { ScatterplotLayer, LineLayer, PathLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { Agent, Conflict, LonLat, Person, PinnedSimAgent, TrajectoryArtifact, Vehicle } from '@/lib/types';
import { isSimPersonAgent, isSimVehicleAgent } from '@/lib/types';
import { EditPanel, type DrawParams } from '@/components/EditPanel';
import { getJunctions, getEdges, postSimulate, type Junction, type Edge, type SimChange } from '@/lib/api';
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
import { activeAt, agentId, nearestWithin, positionAt, positionAtCached, sentimentColor } from '@/lib/viz';
import { agentLookup, cascadeById, cascadeIds, reachForCascade, trajectoriesForCascade } from '@/lib/social';

// Token-free CARTO positron style (no API key).
const POSITRON = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

// The artifact to play back. Stable alias written by the pipeline's final step (scorecard.py) — always
// mirrors the fully-assembled + scorecard-injected run, so no brittle timestamped filename here.
const ARTIFACT_URL = '/latest.json';

const PULSE_WINDOW = 25; // sim seconds around trigger_t during which an instrumented dot swells
const CONFLICT_FADE_S = 10; // a near-miss pulse fades over ~this many sim-seconds, then rests as a dot
const SNAP_M = 60; // edit mode: a click within this many meters of a junction snaps to it
const EDGE_ZOOM = 14; // edit mode: only fetch/render existing edges at/above this zoom (city zoom = spaghetti)

/** A sim agent joined to its trajectory (vehicle OR person) — stable across frames; the clickable dots. */
interface Pinned {
  agent: PinnedSimAgent;
  path: LonLat[];
  timestamps: number[];
  kind: 'vehicle' | 'person';
}

// Deck's `getCursor` prop MUST be a function — `Deck._updateCursor` calls it every render frame. Passing
// `undefined` (any non-drawing render) clobbers deck's default and crashes, so we always supply this fallback.
const DEFAULT_CURSOR = ({ isDragging, isHovering }: { isDragging: boolean; isHovering: boolean }) =>
  isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab';

/** Attaches a deck.gl MapboxOverlay to the MapLibre map and re-pushes layers + tooltip each render.
 * In edit mode it also receives overlay-level onClick/onHover/getCursor — these fire on EVERY click/move
 * (info.coordinate is populated even on empty-space picks), which is how the two-click draw captures point B. */
function DeckOverlay({
  layers,
  getTooltip,
  onClick,
  onHover,
  getCursor,
}: {
  layers: Layer[];
  getTooltip: (info: PickingInfo) => { html: string; style?: Record<string, string> } | null;
  onClick?: (info: PickingInfo) => void;
  onHover?: (info: PickingInfo) => void;
  getCursor?: (state: { isDragging: boolean; isHovering: boolean }) => string;
}) {
  const overlay = useControl(() => new MapboxOverlay({ interleaved: false }));
  // getCursor is NEVER undefined (would crash deck's per-frame _updateCursor); onClick/onHover may be (deck null-checks).
  overlay.setProps({ layers, getTooltip, onClick, onHover, getCursor: getCursor ?? DEFAULT_CURSOR });
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
  const [mode, setMode] = useState<'playback' | 'discourse' | 'edit'>('playback'); // playback ⇄ discourse ⇄ edit
  const [cascadeId, setCascadeId] = useState<string | null>(null); // selected cascade in discourse mode
  // --- edit mode (5.2): draw-a-road + job runner ---
  const [junctions, setJunctions] = useState<Junction[]>([]); // snap targets in the viewport
  const [junctionsDown, setJunctionsDown] = useState(false); // backend unreachable while loading snap targets
  const [edges, setEdges] = useState<Edge[]>([]); // existing edges in view (zoom-gated) for the edit-an-edge palette
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null); // the edge whose palette is open
  const [zoom, setZoom] = useState(12); // tracked map zoom (edge layer is gated on EDGE_ZOOM)
  const [ptA, setPtA] = useState<Junction | null>(null); // first clicked junction
  const [ptB, setPtB] = useState<Junction | null>(null); // second clicked junction → opens the params form
  const [hoverCoord, setHoverCoord] = useState<LonLat | null>(null); // rubber-band endpoint while drawing
  const [drawHint, setDrawHint] = useState<string | null>(null); // transient "click nearer a junction"
  const [activeRunId, setActiveRunId] = useState<string | null>(null); // the run the card watches / shows
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const mapRef = useRef<MapRef | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    // `?run=<id>` deep-links a specific run (used by tests to pin a fixture); default is the editor pointer.
    // no-store: these are large (~20MB), frequently-rewritten aliases — don't HTTP-cache (avoids stale reads +
    // chromium ERR_CACHE_WRITE_FAILURE on the large body).
    const run = new URLSearchParams(window.location.search).get('run');
    const url = run ? `/${run}.json` : ARTIFACT_URL;
    fetch(url, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: TrajectoryArtifact) => {
        if (cancelled) return;
        setArtifact(data);
        setCurrentTime(data.meta.sim_start);
      })
      .catch((e) => console.error(`failed to load ${url}`, e));
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

  // ---- edit mode (5.2) ----
  // Fetch the viewport's junction snap targets. Called on entering edit mode and on map moveend.
  const fetchJunctions = useCallback(async () => {
    const m = mapRef.current?.getMap();
    if (!m) return;
    const b = m.getBounds();
    const res = await getJunctions([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    if (res.ok) {
      setJunctions(res.value.junctions);
      setJunctionsDown(false);
    } else {
      setJunctionsDown(true); // backend down → the draw card surfaces the "start the server" hint (not a silent empty)
    }
  }, []);

  // Existing edges for the edit-an-edge palette — ZOOM-GATED (the whole net at city zoom is spaghetti).
  const fetchEdges = useCallback(async () => {
    const m = mapRef.current?.getMap();
    if (!m) return;
    if (m.getZoom() < EDGE_ZOOM) {
      setEdges([]); // too coarse — don't fetch or render edges
      return;
    }
    const b = m.getBounds();
    const res = await getEdges([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    if (res.ok) setEdges(res.value.edges);
  }, []);

  // On entering edit mode, load junctions + edges once + on each moveend; track zoom; clear on leaving.
  useEffect(() => {
    if (mode !== 'edit') return;
    fetchJunctions();
    fetchEdges();
    const m = mapRef.current?.getMap();
    if (!m) return;
    setZoom(m.getZoom());
    const onMoveEnd = () => {
      fetchJunctions();
      fetchEdges();
      setZoom(m.getZoom());
    };
    m.on('moveend', onMoveEnd);
    return () => {
      m.off('moveend', onMoveEnd);
    };
  }, [mode, fetchJunctions, fetchEdges]);

  // Load a completed run's artifact by id (per-run public copy). RunCard calls this on the `done` edge.
  const loadRun = useCallback(async (id: string) => {
    setActiveRunId(id);
    try {
      const r = await fetch(`/${id}.json`, { cache: 'no-store' });
      if (!r.ok) return; // not ready yet (still running) — the run card keeps showing progress
      const data = (await r.json()) as TrajectoryArtifact;
      setArtifact(data);
      setCurrentTime(data.meta.sim_start);
    } catch (e) {
      console.error('failed to load run', id, e);
    }
  }, []);

  // Overlay-level click: snap to the picked junction, else the nearest within SNAP_M; 1st→A, 2nd→B (opens form).
  const onEditClick = useCallback(
    (info: PickingInfo) => {
      const lid = info.layer?.id;
      const coord = info.coordinate as LonLat | undefined;
      // Click an existing edge (when NOT mid-draw) → open the edit-an-edge palette.
      if (lid === 'edit-edges' && info.object && !ptA) {
        setSelectedEdge(info.object as Edge);
        setDrawHint(null);
        return;
      }
      let j: Junction | null = lid === 'snap-targets' ? (info.object as Junction) : null;
      if (!j && coord) j = nearestWithin(coord, junctions, SNAP_M);
      if (!j) {
        if (ptA) setDrawHint('Click nearer a junction.');
        else setSelectedEdge(null); // empty-space click dismisses an open palette
        return;
      }
      setSelectedEdge(null); // starting/continuing a road draw dismisses the palette
      if (!ptA) {
        setDrawHint(null);
        setPtA(j);
        setPtB(null);
        setHoverCoord(null);
      } else if (j.id !== ptA.id) {
        setDrawHint(null);
        setPtB(j);
      } else {
        setDrawHint('Pick a different junction for the end point.');
      }
    },
    [ptA, junctions],
  );

  // Overlay-level hover: drive the rubber-band only while placing the second point (bounds re-renders).
  const onEditHover = useCallback(
    (info: PickingInfo) => {
      if (ptA && !ptB && info.coordinate) setHoverCoord(info.coordinate as LonLat);
    },
    [ptA, ptB],
  );

  // Submit any edit → POST /api/simulate. On success the run card takes over (it polls + loads on done).
  const submitChange = useCallback(async (change: SimChange) => {
    setSubmitting(true);
    setSubmitError(null);
    const res = await postSimulate(change);
    setSubmitting(false);
    if (!res.ok) {
      setSubmitError(res.error); // includes the 409 lock message + the bike-lane ineligibility reason
      return;
    }
    setActiveRunId(res.value.run_id); // run card polls this; loadRun fires on the done edge
    setPtA(null);
    setPtB(null);
    setHoverCoord(null);
    setDrawHint(null);
    setSelectedEdge(null);
  }, []);

  const onSubmitDraw = useCallback(
    (p: DrawParams) => {
      if (!ptA || !ptB) return;
      submitChange({
        type: 'new_road',
        from_junction: ptA.id,
        to_junction: ptB.id,
        lanes: p.lanes,
        speed_mps: p.speed_mps,
        bidirectional: p.bidirectional,
        description: `New road ${ptA.id}->${ptB.id}`,
      });
    },
    [ptA, ptB, submitChange],
  );

  const onEdgeSpeed = useCallback(
    (valueMps: number) => {
      if (!selectedEdge) return;
      submitChange({ type: 'speed_limit', target_edge: selectedEdge.id, value_mps: valueMps,
        description: `Speed limit on ${selectedEdge.id} -> ${valueMps} m/s` });
    },
    [selectedEdge, submitChange],
  );

  const onEdgeBike = useCallback(() => {
    if (!selectedEdge) return;
    submitChange({ type: 'bike_lane', target_edge: selectedEdge.id, description: `Bike lane on ${selectedEdge.id}` });
  }, [selectedEdge, submitChange]);

  const resetDraw = useCallback(() => {
    setPtA(null);
    setPtB(null);
    setHoverCoord(null);
    setDrawHint(null);
    setSubmitError(null);
    setSelectedEdge(null);
  }, []);

  const drawAnother = useCallback(() => {
    setActiveRunId(null);
    resetDraw();
  }, [resetDraw]);

  // Test seam (Playwright): inject a map click / hover at [lon,lat] so the real snap→preview→form→submit path
  // runs without fighting the WebGL canvas hit-test. Present only while in edit mode; inert in production.
  useEffect(() => {
    if (mode !== 'edit') return;
    const w = window as unknown as {
      __nadiEdit?: (lon: number, lat: number) => void;
      __nadiEditHover?: (lon: number, lat: number) => void;
      __nadiEditEdge?: (edge: Edge) => void;
    };
    w.__nadiEdit = (lon, lat) => onEditClick({ coordinate: [lon, lat] } as PickingInfo);
    w.__nadiEditHover = (lon, lat) => onEditHover({ coordinate: [lon, lat] } as PickingInfo);
    // Select an existing edge (drives the edit-an-edge palette without a WebGL PathLayer pick).
    w.__nadiEditEdge = (edge) => onEditClick({ layer: { id: 'edit-edges' }, object: edge } as unknown as PickingInfo);
    return () => {
      delete w.__nadiEdit;
      delete w.__nadiEditHover;
      delete w.__nadiEditEdge;
    };
  }, [mode, onEditClick, onEditHover]);

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

  // 6) Edit mode: existing edges (edit-an-edge palette; zoom-gated, blue=bike-eligible, grey=not, orange=selected).
  const editEdges = new PathLayer<Edge>({
    id: 'edit-edges',
    data: edges,
    getPath: (e) => e.geometry,
    getColor: (e) =>
      e.id === selectedEdge?.id ? [240, 130, 30, 235] : e.eligible_bike_lane ? [80, 140, 255, 170] : [150, 156, 165, 150],
    getWidth: (e) => (e.id === selectedEdge?.id ? 6 : 3),
    widthUnits: 'pixels',
    capRounded: true,
    jointRounded: true,
    pickable: true,
    autoHighlight: true,
    highlightColor: [255, 255, 255, 80],
    updateTriggers: { getColor: selectedEdge?.id, getWidth: selectedEdge?.id },
  });

  // Junction snap targets + the rubber-band preview line. Only added when drawing.
  const snapTargets = new ScatterplotLayer<Junction>({
    id: 'snap-targets',
    data: junctions,
    getPosition: (jn) => [jn.lon, jn.lat],
    getFillColor: (jn) => (jn.id === ptA?.id || jn.id === ptB?.id ? [240, 180, 40, 255] : [70, 120, 220, 150]),
    getRadius: (jn) => (jn.id === ptA?.id || jn.id === ptB?.id ? 7 : 4),
    radiusUnits: 'pixels',
    stroked: true,
    getLineColor: [255, 255, 255, 220],
    getLineWidth: 1,
    lineWidthUnits: 'pixels',
    pickable: true,
    updateTriggers: { getFillColor: [ptA?.id, ptB?.id], getRadius: [ptA?.id, ptB?.id] },
  });
  const previewTo: LonLat | null = ptB ? [ptB.lon, ptB.lat] : hoverCoord;
  const drawPreview = new LineLayer<{ from: LonLat; to: LonLat }>({
    id: 'draw-preview',
    data: ptA && previewTo ? [{ from: [ptA.lon, ptA.lat], to: previewTo }] : [],
    getSourcePosition: (d) => d.from,
    getTargetPosition: (d) => d.to,
    getColor: [240, 130, 30, 230],
    getWidth: 3,
    widthUnits: 'pixels',
  });

  const layers: Layer[] = [
    trails,
    backgroundVehicleDots,
    backgroundPersonDots,
    conflictDots,
    conflictPulses,
    instrumentedDots,
    flashRing,
    ...(mode === 'edit' ? [editEdges, snapTargets, drawPreview] : []),
  ];

  // Discourse is only meaningful once a run carries a social block; fall back to playback if it's empty.
  const effectiveMode = mode === 'discourse' && socialIds.length === 0 ? 'playback' : mode;
  const editing = effectiveMode === 'edit';
  // Draw interactions are live only while actually drawing — NOT while a run card is shown (else background
  // map clicks would silently mutate ptA/ptB and the snap highlight). "Draw another" clears activeRunId.
  const drawing = editing && activeRunId == null;
  // Honesty flags for the active run's empty states (only trustworthy once its artifact is the one shown).
  const runLoaded = activeRunId != null && meta.run_id === activeRunId;
  const hasVoices = (artifact.agents?.length ?? 0) > 0;
  const hasSocial = socialIds.length > 0;

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
        <DeckOverlay
          layers={layers}
          getTooltip={getTooltip}
          onClick={drawing ? onEditClick : undefined}
          onHover={drawing ? onEditHover : undefined}
          getCursor={drawing ? ({ isDragging }) => (isDragging ? 'grabbing' : 'crosshair') : undefined}
        />
      </Map>

      <ScenarioHeader scenario={meta.scenario} />

      <div style={modeToggle} data-testid="mode-toggle">
        <button
          style={{ ...modeBtn, ...(effectiveMode === 'playback' ? modeBtnActive : null) }}
          onClick={() => setMode('playback')}
          data-testid="mode-playback"
        >
          ▶ Playback
        </button>
        <button
          style={{
            ...modeBtn,
            ...(effectiveMode === 'discourse' ? modeBtnActive : null),
            ...(hasSocial ? null : modeBtnDisabled),
          }}
          onClick={() => hasSocial && setMode('discourse')}
          disabled={!hasSocial}
          title={hasSocial ? undefined : 'Run discourse on a run to unlock the cascade view'}
          data-testid="mode-discourse"
        >
          💬 Discourse
        </button>
        <button
          style={{ ...modeBtn, ...(effectiveMode === 'edit' ? modeBtnActive : null) }}
          onClick={() => setMode('edit')}
          data-testid="mode-edit"
        >
          ✏️ Edit
        </button>
      </div>

      {editing ? (
        <EditPanel
          ptA={ptA}
          ptB={ptB}
          hint={drawHint}
          junctionsDown={junctionsDown}
          submitting={submitting}
          submitError={submitError}
          onSubmit={onSubmitDraw}
          onReset={resetDraw}
          activeRunId={activeRunId}
          onDrawAnother={drawAnother}
          onLoaded={loadRun}
          onLoadRun={setActiveRunId}
          runLoaded={runLoaded}
          hasVoices={hasVoices}
          hasSocial={hasSocial}
          scorecard={artifact.scorecard}
          selectedEdge={selectedEdge}
          canEditEdges={zoom >= EDGE_ZOOM}
          onEdgeSpeed={onEdgeSpeed}
          onEdgeBike={onEdgeBike}
          onEdgeCancel={() => setSelectedEdge(null)}
        />
      ) : effectiveMode === 'playback' ? (
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

// Mode toggle (Playback ⇄ Discourse ⇄ Edit) — top center, always shown. Discourse is disabled until a run
// carries a social{} block; Edit is always available (draw a road / run the job runner).
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
const modeBtnDisabled: React.CSSProperties = { color: '#c2c7cf', cursor: 'not-allowed' };

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
