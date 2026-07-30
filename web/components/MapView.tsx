'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, { useControl, type MapRef } from 'react-map-gl/maplibre';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { PathStyleExtension } from '@deck.gl/extensions';
import { fmtWindowRange } from '@/lib/simTime';
import { TripsLayer } from '@deck.gl/geo-layers';
import { ScatterplotLayer, LineLayer, PathLayer, IconLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { Agent, ChangeType, Conflict, LonLat, Person, PinnedSimAgent, TrajectoryArtifact, Vehicle } from '@/lib/types';
import { changesOf } from '@/lib/types';
import { loadNetwork, onewayArrows, type ArrowAnchor, type NetworkEdge } from '@/lib/network';
import { isSimPersonAgent, isSimVehicleAgent } from '@/lib/types';
import { EditPanel, type DrawParams } from '@/components/EditPanel';
import { getJunctions, getEdges, postSimulate, postSimulateComposite, type ChangeWindow, type Junction, type Edge, type EdgeEligibility, type SimChange, type RunOptions } from '@/lib/api';
import type { VoiceEvent } from '@/lib/enrichStream';
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
import { CompareView } from '@/components/CompareView';
import { loadCompareSide, slimFromArtifact, type CompareSide } from '@/lib/compare';
import { activeAt, agentId, nearestWithin, positionAt, positionAtCached, sentimentColor } from '@/lib/viz';
import { agentLookup, cascadeById, cascadeIds, reachForCascade, trajectoriesForCascade } from '@/lib/social';

// Token-free CARTO positron style (no API key). V2.0b: the NO-LABELS variant — the exported network is now the
// road layer, so the basemap is demoted to context (green/water/buildings) with no competing street labels.
const POSITRON = 'https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json';

// Base road rendering (V2.0b). Width scales with lanes in METERS so it tracks zoom; clamped in pixels.
const LANE_M = 3.2; // approx lane width for the rendered road body
const ROAD_CASING = [70, 74, 82, 220] as [number, number, number, number]; // dark casing under the fill
// ~98% of edges permit bikes (mixed traffic), so the tint is a WHISPER: bike-permitted reads as the neutral
// default and the rare non-bike edges (highways/ramps) quietly stand apart. V2.5 restyles.
const ROAD_FILL = [214, 214, 219, 255] as [number, number, number, number]; // plain grey (non-bike, the minority)
const ROAD_FILL_BIKE = [208, 216, 211, 255] as [number, number, number, number]; // whisper green = bike-permitted

// The artifact to play back. Stable alias written by the pipeline's final step (scorecard.py) — always
// mirrors the fully-assembled + scorecard-injected run, so no brittle timestamped filename here.
const ARTIFACT_URL = '/latest.json';

const PULSE_WINDOW = 25; // sim seconds around trigger_t during which an instrumented dot swells
const CONFLICT_FADE_S = 10; // a near-miss pulse fades over ~this many sim-seconds, then rests as a dot

// V2.2c — one change-overlay entry per change; capacity types carry their window/lanes/effect so
// the overlay styles per type and tells the truth in TIME during playback.
type OverlayItem = {
  path: LonLat[];
  type: ChangeType;
  window?: { start_s: number; end_s: number } | null;
  target_lanes?: number[] | null;
  effect?: { blocked?: boolean | null; speed_factor?: number | null } | null;
};
const CAPACITY_TYPES: ReadonlySet<string> = new Set(['lane_closure', 'road_closure', 'incident']);
const CAP_CASING: Record<string, [number, number, number, number]> = {
  lane_closure: [42, 42, 48, 235], road_closure: [110, 22, 22, 240], incident: [125, 62, 12, 240],
};
const CAP_DASH_COLOR: Record<string, [number, number, number, number]> = {
  lane_closure: [250, 190, 40, 240], road_closure: [225, 62, 50, 245], incident: [246, 122, 40, 245],
};
const CAP_DASH: Record<string, [number, number]> = {
  lane_closure: [4, 3], road_closure: [1.5, 1.5], incident: [3, 2],
};
const midOf = (path: LonLat[]): LonLat => path[Math.floor(path.length / 2)];
// The window badge's glyphs — STATIC superset (digits, clock/sim forms, the en-dash — which is
// outside deck.gl's default ASCII characterSet). Never derived from data: an empty computed set
// (windowed item currently inactive) would break TextLayer's font atlas.
const BADGE_CHARSET = Array.from('0123456789:–t=s min-'); // ascii '-' too: negative start_s is CLI-reachable
const SNAP_M = 60; // edit mode: a click within this many meters of a junction snaps to it
const EDGE_ZOOM = 14; // edit mode: the zoom at/above which edge selection is precise enough (a palette UX hint)

// V2.2 closeout: the spanning window of the run's windowed change(s), or null when none is windowed.
// Windowed members only — a permanent member neither narrows nor widens the span — and DISPLAY
// bounds clamp to [0, sim_end] (a window may legally end past the sim ceiling; the line must never
// claim activity outside the run). Lockstep with the Python convention: report.build_scope_disclosure
// over zone_lens.resolve_window. Drives the ScorecardPanel scope line.
function windowedSpan(
  changes: { window?: { start_s: number; end_s: number } | null }[],
  simEnd: number,
): { start_s: number; end_s: number } | null {
  const ws = changes.flatMap((c) => (c.window ? [c.window] : []));
  if (!ws.length) return null;
  return {
    start_s: Math.max(Math.min(...ws.map((w) => w.start_s)), 0),
    end_s: Math.min(Math.max(...ws.map((w) => w.end_s)), simEnd),
  };
}

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
  // playback ⇄ discourse ⇄ edit ⇄ compare. `?compare=` deep-links straight into compare mode — read in
  // the initializer (hydration-safe: the pre-artifact shell renders identically whatever the mode).
  const [mode, setMode] = useState<'playback' | 'discourse' | 'edit' | 'compare'>(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('compare')
      ? 'compare'
      : 'playback',
  );
  const [cascadeId, setCascadeId] = useState<string | null>(null); // selected cascade in discourse mode
  // --- edit mode (5.2): draw-a-road + job runner ---
  const [junctions, setJunctions] = useState<Junction[]>([]); // snap targets in the viewport
  const [junctionsDown, setJunctionsDown] = useState(false); // backend unreachable while loading snap targets
  // V2.0b: edit-an-edge is now a STYLING STATE of the network layer — eligibility metadata joined by id (the
  // whole net, fetched once), not a per-viewport geometry fetch. selectedEdge is the MERGED edge the palette reads.
  const [eligById, setEligById] = useState<Record<string, EdgeEligibility>>({});
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null); // the edge whose palette is open
  const [zoom, setZoom] = useState(12); // tracked map zoom (edge layer is gated on EDGE_ZOOM)
  const [ptA, setPtA] = useState<Junction | null>(null); // first clicked junction
  const [ptB, setPtB] = useState<Junction | null>(null); // second clicked junction → opens the params form
  // V2.2d — the school-zone flow: zone-select mode accumulates clicked edges (toggle to remove);
  // submit posts N windowed speed_limit primitives + tags=["school_zone"] as ONE composite run.
  const [zoneMode, setZoneMode] = useState(false);
  const [zoneEdges, setZoneEdges] = useState<string[]>([]);
  const [hoverCoord, setHoverCoord] = useState<LonLat | null>(null); // rubber-band endpoint while drawing
  const [drawHint, setDrawHint] = useState<string | null>(null); // transient "click nearer a junction"
  const [activeRunId, setActiveRunId] = useState<string | null>(null); // the run the card watches / shows
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // V2.1d part ii — compare mode: two SLIM sides ({meta, scorecard} only; the 74MB bulk is never
  // retained). Side A defaults to the loaded artifact; both re-pickable. Picks survive mode switches.
  const [compareA, setCompareA] = useState<CompareSide | null>(null);
  const [compareB, setCompareB] = useState<CompareSide | null>(null);
  const [compareLoading, setCompareLoading] = useState({ a: false, b: false });
  const [compareError, setCompareError] = useState<{ a: string | null; b: string | null }>({ a: null, b: null });
  const compareReq = useRef<{ a: string | null; b: string | null }>({ a: null, b: null }); // stale-pick guard
  // 5.3 change-visibility overlay: the loaded run's change LOCATION, fetched once per run (survives switching +
  // ?run=). Tagged with runId so a stale fetch from a prior run is ignored; error=true → labeled degradation.
  // v0.5.0: a scenario may compose several changes — resolve + render each. `items` is one entry per change.
  // V2.2c: items carry window/lanes/effect so capacity changes style per type + gate on sim time.
  const [changeGeom, setChangeGeom] = useState<{ runId: string; items: OverlayItem[]; error: boolean } | null>(null);
  // V2.0b: the canonical network (base road layer, ALL modes). Loaded once; static.
  const [networkEdges, setNetworkEdges] = useState<NetworkEdge[]>([]);
  // id -> edge, the single source of road geometry (change-overlay + edit tints both resolve against it).
  // NB: `Map` is shadowed by the react-map-gl <Map> import — use a plain Record, not a JS Map.
  const networkLookup = useMemo(() => {
    const m: Record<string, NetworkEdge> = {};
    for (const e of networkEdges) m[e.id] = e;
    return m;
  }, [networkEdges]);
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

  // V2.1d compare picks. Stale-guard: only the LAST requested id per side may land (a fast
  // re-pick must not be overwritten by a slow earlier fetch resolving late).
  const pickCompareSide = useCallback((side: 'a' | 'b', id: string) => {
    compareReq.current[side] = id;
    setCompareLoading((s) => ({ ...s, [side]: true }));
    setCompareError((s) => ({ ...s, [side]: null }));
    loadCompareSide(id)
      .then((cs) => {
        if (compareReq.current[side] !== id) return; // stale
        (side === 'a' ? setCompareA : setCompareB)(cs);
      })
      .catch((e: unknown) => {
        if (compareReq.current[side] !== id) return;
        setCompareError((s) => ({ ...s, [side]: e instanceof Error ? e.message : String(e) }));
      })
      .finally(() => {
        if (compareReq.current[side] === id) setCompareLoading((s) => ({ ...s, [side]: false }));
      });
  }, []);
  const pickCompareA = useCallback((id: string) => pickCompareSide('a', id), [pickCompareSide]);
  const pickCompareB = useCallback((id: string) => pickCompareSide('b', id), [pickCompareSide]);

  // `?compare=<id>` kicks side B's fetch once (mode was already set by the initializer above).
  // queueMicrotask: the pick's loading-state flip must not run synchronously inside the effect body
  // (react-hooks/set-state-in-effect); one microtask later is indistinguishable to the user.
  useEffect(() => {
    const cmp = new URLSearchParams(window.location.search).get('compare');
    if (cmp) queueMicrotask(() => pickCompareSide('b', cmp));
  }, [pickCompareSide]);

  // Side A DERIVED during render: the loaded artifact's slim view until explicitly picked. This makes
  // a cold `?run=X&compare=Y` start deterministic by construction — side A is a pure function of the
  // loaded artifact (whenever X's fetch lands), side B is independent state; no fetch-ordering race
  // can blank side A. An explicit pick (compareA) always wins.
  const effectiveCompareA = useMemo(
    () => compareA ?? (artifact ? slimFromArtifact(artifact) : null),
    [compareA, artifact],
  );

  // V2.0b: load the exported canonical network ONCE (the base road layer). Static asset → default cache.
  // Sets a deterministic test seam (window.__nadiNetworkEdges) so Playwright can assert the network rendered.
  useEffect(() => {
    let cancelled = false;
    loadNetwork()
      .then((edges) => {
        if (cancelled) return;
        setNetworkEdges(edges);
        (window as unknown as { __nadiNetworkEdges?: number }).__nadiNetworkEdges = edges.length;
      })
      .catch((e) => console.error('failed to load /network.json', e));
    return () => {
      cancelled = true;
    };
  }, []);

  // Clear any pending flash timer on unmount.
  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  // 5.3 / V2.0b: resolve the loaded run's change LOCATION. A non-new_road target_edge is a CANONICAL edge, so its
  // geometry comes from the client network map (one source of road pixels — no /api/edges fetch). A new_road's
  // target_edge is a MINTED edge absent from the canonical net, so it still resolves via its two junction coords
  // (getJunctions). Re-runs when the network arrives. Render guards on runId so a stale result is ignored.
  useEffect(() => {
    const changes = artifact ? changesOf(artifact) : [];
    const runId = artifact?.meta.run_id;
    if (changes.length === 0 || !runId) return;
    const bbox = artifact!.meta.bbox as [number, number, number, number];
    const needsJunctions = changes.some((c) => c.type === 'new_road' && c.from_junction && c.to_junction);
    let cancelled = false;
    (async () => {
      let error = false;
      // NB: `Map` is shadowed by the react-map-gl <Map> import — use a plain Record for the junction lookup.
      const junctionById: Record<string, LonLat> = {};
      if (needsJunctions) {
        const res = await getJunctions(bbox); // new_road only: the backend knows minted-road endpoints
        if (res.ok) for (const j of res.value.junctions) junctionById[j.id] = [j.lon, j.lat];
        else error = true; // labeled degradation applies to the backend fetch (new_road)
      }
      const items: OverlayItem[] = [];
      for (const change of changes) {
        let geom: LonLat[] | null = null;
        if (change.type === 'new_road' && change.from_junction && change.to_junction) {
          const a = junctionById[change.from_junction];
          const b = junctionById[change.to_junction];
          if (a && b) geom = [a, b];
        } else if (change.target_edge) {
          geom = networkLookup[change.target_edge]?.geometry ?? null; // canonical edge → network map
        }
        // V2.2c: carry the window/lanes/effect so the overlay can style per type AND tell the
        // truth in TIME (windowed items appear/disappear at their window during playback).
        if (geom) items.push({
          path: geom, type: change.type,
          window: change.window ?? null,
          target_lanes: change.target_lanes ?? null,
          effect: change.effect ?? null,
        });
      }
      if (!cancelled) setChangeGeom({ runId, items, error });
    })();
    return () => {
      cancelled = true;
    };
  }, [artifact, networkLookup]);

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

  // V2.0b: the base road layers (the drawn network IS the sim's roads). STATIC — memoized on the network data,
  // no time updateTriggers, so buffers build once and playback never rebuilds them. Rendered in ALL modes.
  const arrowAnchors = useMemo(() => onewayArrows(networkEdges), [networkEdges]);
  const baseNetworkLayers = useMemo<Layer[]>(() => {
    if (networkEdges.length === 0) return [];
    // Dark casing (wider) UNDER a light fill (narrower) — deck.gl has no casing prop; stacking is the idiom.
    const casing = new PathLayer<NetworkEdge>({
      id: 'network-casing', data: networkEdges, getPath: (e) => e.geometry, getColor: ROAD_CASING,
      getWidth: (e) => e.lanes * LANE_M + 2.4, widthUnits: 'meters', widthMinPixels: 2.5, widthMaxPixels: 42,
      capRounded: true, jointRounded: true, pickable: false,
    });
    const fill = new PathLayer<NetworkEdge>({
      id: 'network-fill', data: networkEdges, getPath: (e) => e.geometry,
      getColor: (e) => (e.allows.bike ? ROAD_FILL_BIKE : ROAD_FILL), // bike-permitted edges subtly greener
      getWidth: (e) => e.lanes * LANE_M, widthUnits: 'meters', widthMinPixels: 1, widthMaxPixels: 38,
      capRounded: true, jointRounded: true, pickable: false,
    });
    // One-way direction: a small arrow at each one-way edge's midpoint, oriented along travel (from→to).
    // Dynamic-icon mode (getIcon returns the sprite descriptor) — more reliable than a pre-packed atlas.
    const arrows = new IconLayer<ArrowAnchor>({
      id: 'one-way-arrows', data: arrowAnchors, getPosition: (d) => d.position,
      getAngle: (d) => 360 - d.bearing, // map bearing is cw-from-north; deck getAngle is ccw → negate
      getIcon: () => ({ url: '/arrow.png', width: 32, height: 32, mask: true, anchorX: 16, anchorY: 16 }),
      getSize: 15, sizeUnits: 'pixels', getColor: [66, 72, 86, 235], billboard: true, pickable: false, // dark, reads on the light road
    });
    return [casing, fill, arrows];
  }, [networkEdges, arrowAnchors]);

  // V2.0b test seam: the one-way arrow layer's data count (deterministic "one-way indicator has data").
  useEffect(() => {
    (window as unknown as { __nadiArrowCount?: number }).__nadiArrowCount = arrowAnchors.length;
  }, [arrowAnchors]);

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

  // Merge a network edge (geometry + speed) with its eligibility metadata → the Edge the palette reads.
  const mergeEdge = useCallback(
    (id: string): Edge | null => {
      const ne = networkLookup[id];
      if (!ne) return null;
      const el = eligById[id];
      return {
        id, geometry: ne.geometry, speed_mps: ne.speed_mps,
        car_lane_count: el?.car_lane_count ?? 0,
        car_lane_indices: el?.car_lane_indices ?? [],
        eligible_bike_lane: el?.eligible_bike_lane ?? false,
        eligibility_reason: el?.eligibility_reason ?? 'loading eligibility…',
      };
    },
    [networkLookup, eligById],
  );

  // On entering edit mode: junctions per viewport (snap targets), eligibility once (whole net). Track zoom.
  // V2.0b: the whole-net bike-lane eligibility map (id → metadata) is fetched ONCE here (geometry comes from the
  // base network layer — no per-viewport geometry fetch). Inline async IIFE so the setState is post-await.
  useEffect(() => {
    if (mode !== 'edit') return;
    fetchJunctions();
    let cancelled = false;
    (async () => {
      const res = await getEdges();
      if (!cancelled && res.ok) {
        const map: Record<string, EdgeEligibility> = {};
        for (const e of res.value.edges) map[e.id] = e;
        setEligById(map);
      }
    })();
    const m = mapRef.current?.getMap();
    if (!m) return;
    setZoom(m.getZoom());
    const onMoveEnd = () => {
      fetchJunctions();
      setZoom(m.getZoom());
    };
    m.on('moveend', onMoveEnd);
    return () => {
      cancelled = true;
      m.off('moveend', onMoveEnd);
    };
  }, [mode, fetchJunctions]);

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

  // V2.3a — a voice streamed in mid-enrich: append its agent to the loaded artifact so the feed (and
  // any pinned-sim dot) renders incrementally. Dedup by `index` (stream replays overlap on reconnect);
  // the done-edge loadRun replaces the whole artifact — the authoritative swap this only previews.
  const streamedVoices = useRef<{ runId: string | null; seen: Set<number> }>({ runId: null, seen: new Set() });
  const handleVoice = useCallback((runId: string, v: VoiceEvent) => {
    const s = streamedVoices.current;
    if (s.runId !== runId) {
      s.runId = runId;
      s.seen = new Set();
    }
    if (s.seen.has(v.index)) return;
    s.seen.add(v.index);
    setArtifact((prev) => {
      // run-id guard: never wire streamed voices onto a different loaded run
      if (!prev || prev.meta.run_id !== runId) return prev;
      return { ...prev, agents: [...(prev.agents ?? []), v.agent] };
    });
  }, []);

  // Overlay-level click: snap to the picked junction, else the nearest within SNAP_M; 1st→A, 2nd→B (opens form).
  const onEditClick = useCallback(
    (info: PickingInfo) => {
      const lid = info.layer?.id;
      const coord = info.coordinate as LonLat | undefined;
      // V2.2d zone-select mode: edge clicks ACCUMULATE into the zone (click again to remove) —
      // no palette open, no draw. Empty-space clicks are inert while selecting a zone.
      if (zoneMode) {
        if (lid === 'edit-edges' && info.object) {
          const id = (info.object as NetworkEdge).id;
          setZoneEdges((cur) => (cur.includes(id) ? cur.filter((e) => e !== id) : [...cur, id]));
        }
        return;
      }
      // Click an existing edge (when NOT mid-draw) → open the edit-an-edge palette. The tint layer's data is the
      // network edge; merge it with eligibility to build the Edge the palette reads.
      if (lid === 'edit-edges' && info.object && !ptA) {
        const merged = mergeEdge((info.object as NetworkEdge).id);
        if (merged) {
          setSelectedEdge(merged);
          setDrawHint(null);
        }
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
    [ptA, junctions, mergeEdge, zoneMode],
  );

  // Overlay-level hover: drive the rubber-band only while placing the second point (bounds re-renders).
  const onEditHover = useCallback(
    (info: PickingInfo) => {
      if (ptA && !ptB && info.coordinate) setHoverCoord(info.coordinate as LonLat);
    },
    [ptA, ptB],
  );

  // V2.1b/c run options for the NEXT submitted run (demand profile + day-one/settled assignment).
  const [runOptions, setRunOptions] = useState<RunOptions>({});
  const runOptionsRef = useRef(runOptions);
  // Keep the ref fresh in an effect, not during render (the RunCard onLoadedRef pattern).
  useEffect(() => {
    runOptionsRef.current = runOptions;
  }, [runOptions]);

  // Submit any edit → POST /api/simulate. On success the run card takes over (it polls + loads on done).
  const submitChange = useCallback(async (change: SimChange) => {
    setSubmitting(true);
    setSubmitError(null);
    // V2.2c belt-and-braces under the UI lock: a windowed change (incident is always windowed)
    // ships with day_one — the server 400 with the shared D1 reason stays the visible backstop.
    const windowed = 'window' in change && change.window != null;
    const opts = windowed ? { ...runOptionsRef.current, assignment: 'day_one' as const } : runOptionsRef.current;
    const res = await postSimulate(change, opts);
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

  // V2.2c — temporary events. NO client description: the server composes the canonical
  // clock-time description (fmt_window; single source with the report/chips).
  const [draftWindowed, setDraftWindowed] = useState(false);
  const onEdgeLaneClosure = useCallback(
    (lanes: number[], window: ChangeWindow | null) => {
      if (!selectedEdge) return;
      submitChange({ type: 'lane_closure', target_edge: selectedEdge.id, target_lanes: lanes,
        ...(window ? { window } : {}) });
    },
    [selectedEdge, submitChange],
  );
  const onEdgeRoadClosure = useCallback(
    (window: ChangeWindow | null) => {
      if (!selectedEdge) return;
      submitChange({ type: 'road_closure', target_edge: selectedEdge.id, ...(window ? { window } : {}) });
    },
    [selectedEdge, submitChange],
  );
  const onEdgeIncident = useCallback(
    (p: { lanes: number[]; speedFactor: number | null; window: ChangeWindow }) => {
      if (!selectedEdge) return;
      submitChange({
        type: 'incident', target_edge: selectedEdge.id, window: p.window,
        effect: { ...(p.lanes.length ? { blocked: true } : {}),
                  ...(p.speedFactor != null ? { speed_factor: p.speedFactor } : {}) },
        ...(p.lanes.length ? { target_lanes: p.lanes } : {}),
      });
    },
    [selectedEdge, submitChange],
  );
  // While a windowed draft is pending, force the NEXT run's assignment to day_one (the toggle is
  // disabled with the D1 reason in the options block).
  useEffect(() => {
    if (draftWindowed && runOptionsRef.current.assignment === 'settled') {
      setRunOptions((o) => ({ ...o, assignment: 'day_one' }));
    }
  }, [draftWindowed]);

  // V2.2d — submit the school zone as ONE composite: N windowed speed_limit primitives + the
  // school_zone tag. Windowed by design → day_one on the wire (the server 400 stays the backstop).
  const onZoneSubmit = useCallback(
    async (valueMps: number, window: ChangeWindow) => {
      if (zoneEdges.length === 0) return;
      setSubmitting(true);
      setSubmitError(null);
      const members: SimChange[] = zoneEdges.map((id) => ({
        type: 'speed_limit', target_edge: id, value_mps: valueMps, window,
      }));
      const res = await postSimulateComposite(members, ['school_zone'],
        { ...runOptionsRef.current, assignment: 'day_one' as const });
      setSubmitting(false);
      if (!res.ok) {
        setSubmitError(res.error);
        return;
      }
      setActiveRunId(res.value.run_id);
      setZoneMode(false);
      setZoneEdges([]);
    },
    [zoneEdges],
  );
  const onZoneToggle = useCallback(() => {
    setZoneMode(true);
    setSelectedEdge(null);
    setPtA(null);
    setPtB(null);
    setHoverCoord(null);
    setDrawHint(null);
    setSubmitError(null);
  }, []);
  const onZoneCancel = useCallback(() => {
    setZoneMode(false);
    setZoneEdges([]);
    setSubmitError(null);
  }, []);
  const onZoneRemove = useCallback((id: string) => {
    setZoneEdges((cur) => cur.filter((e) => e !== id));
  }, []);

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
      __nadiEditEdge?: (id: string) => void;
    };
    w.__nadiEdit = (lon, lat) => onEditClick({ coordinate: [lon, lat] } as PickingInfo);
    w.__nadiEditHover = (lon, lat) => onEditHover({ coordinate: [lon, lat] } as PickingInfo);
    // V2.0b: select an existing edge by ID (geometry now lives in the network map, not the API response).
    w.__nadiEditEdge = (id) => {
      const ne = networkLookup[id];
      if (ne) onEditClick({ layer: { id: 'edit-edges' }, object: ne } as unknown as PickingInfo);
    };
    return () => {
      delete w.__nadiEdit;
      delete w.__nadiEditHover;
      delete w.__nadiEditEdge;
    };
  }, [mode, onEditClick, onEditHover, networkLookup]);

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

  // V2.2c test seams (must precede the early return — hooks stay unconditional):
  // __nadiChangeOverlay mirrors the overlay's per-item ACTIVE state under the playback clock;
  // __nadiSeek jumps the clock deterministically (playback only; the Timeline keeps advancing
  // from the seeked value — assert promptly or poll the seam).
  useEffect(() => {
    const playbackNow = mode === 'playback' || (mode === 'discourse' && socialIds.length === 0);
    const items = changeGeom && artifact && changeGeom.runId === artifact.meta.run_id ? changeGeom.items : [];
    (window as unknown as { __nadiChangeOverlay?: unknown }).__nadiChangeOverlay = {
      count: items.length,
      // V2.2d: the zone designation flag (the tint is ALWAYS shown for tagged runs; items' active
      // flags carry the time-truth for the speed members themselves).
      zoneTagged: !!artifact?.meta.scenario?.tags?.includes('school_zone'),
      items: items.map((d) => ({
        type: d.type,
        windowed: !!d.window,
        active: !d.window || !playbackNow || (currentTime >= d.window.start_s && currentTime <= d.window.end_s),
      })),
    };
  }, [changeGeom, artifact, currentTime, mode, socialIds]);
  // (No __nadiSeek seam: a raw setState seek loses races against the Timeline's rAF loop —
  // specs scrub the Timeline slider instead, the app's own pause-and-seek path.)

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

  // 6) Edit mode: a TINT over the SAME network geometry (one source of road pixels) — blue=bike-eligible,
  //    grey=not, orange=selected. Joins eligibility by id; the base network layers already draw the roads.
  const editEdges = new PathLayer<NetworkEdge>({
    id: 'edit-edges',
    data: networkEdges,
    getPath: (e) => e.geometry,
    getColor: (e) =>
      zoneMode && zoneEdges.includes(e.id)
        ? [255, 200, 40, 235] // V2.2d: zone-selected — school-bus yellow
        : e.id === selectedEdge?.id
          ? [240, 130, 30, 235]
          : eligById[e.id]?.eligible_bike_lane
            ? [80, 140, 255, 170]
            : [150, 156, 165, 150],
    getWidth: (e) => (e.id === selectedEdge?.id || (zoneMode && zoneEdges.includes(e.id)) ? 6 : 3),
    widthUnits: 'pixels',
    capRounded: true,
    jointRounded: true,
    pickable: true,
    autoHighlight: true,
    highlightColor: [255, 255, 255, 80],
    updateTriggers: {
      getColor: [selectedEdge?.id, eligById, zoneMode, zoneEdges],
      getWidth: [selectedEdge?.id, zoneMode, zoneEdges],
    },
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

  // Discourse is only meaningful once a run carries a social block; fall back to playback if it's empty.
  const effectiveMode = mode === 'discourse' && socialIds.length === 0 ? 'playback' : mode;

  // 5.3 CHANGE-VISIBILITY overlay (persistent, ALL modes) — the loaded run's change LOCATION so rerouting cars
  // don't appear to drive through empty space. Derived from the artifact (via the geometry fetch), NOT draw-state.
  // v0.5.0: render EVERY change the scenario composes (per-change color by type). A single-change run is one path.
  // V2.2c: capacity changes (closures/incident) get per-type styling in their own layers; during PLAYBACK a
  // windowed change renders ONLY within its window (the map tells the truth in time — the conflict-pulses
  // pattern: CPU filter on t, arrays rebuilt per frame). Legacy types keep change-overlay pixel-identical.
  const overlayItems = changeGeom && changeGeom.runId === meta.run_id ? changeGeom.items : [];
  const isOverlayActive = (d: OverlayItem): boolean =>
    !d.window || effectiveMode !== 'playback' || (t >= d.window.start_s && t <= d.window.end_s);
  // V2.2d: time-gating now covers ANY windowed item — a windowed speed_limit (the school zone's
  // members) appears/disappears at its window during playback exactly like the capacity types.
  // Unwindowed legacy items pass isOverlayActive unconditionally (pixel-identical to before).
  const legacyItems = overlayItems.filter((d) => !CAPACITY_TYPES.has(d.type) && isOverlayActive(d));
  const capItems = overlayItems.filter((d) => CAPACITY_TYPES.has(d.type) && isOverlayActive(d));
  // V2.2d — the zone TINT: a school zone is a DESIGNATION (like signage, it exists all day), so
  // the tint is ALWAYS visible; the speed-limit overlay items above carry the time-truth. The
  // legend row says exactly this so "yellow at t=0, no overlay" never reads as a bug.
  const zoneTagged = !!meta.scenario?.tags?.includes('school_zone');
  const zoneTint = new PathLayer<OverlayItem>({
    id: 'zone-tint',
    data: zoneTagged ? overlayItems : [],
    getPath: (d) => d.path,
    getColor: [255, 200, 40, 90], // translucent school-bus yellow
    getWidth: 14,
    widthUnits: 'pixels',
    capRounded: true,
    jointRounded: true,
  });
  const changeOverlay = new PathLayer<OverlayItem>({
    id: 'change-overlay',
    data: legacyItems,
    getPath: (d) => d.path,
    getColor: (d) => (d.type === 'new_road' ? [20, 200, 170, 235] : [245, 170, 40, 230]), // teal proposed road / amber edit
    getWidth: 6,
    widthUnits: 'pixels',
    capRounded: true,
    jointRounded: true,
    updateTriggers: { getColor: legacyItems.map((d) => d.type).join(',') },
  });
  const closureCasing = new PathLayer<OverlayItem>({
    id: 'closure-casing',
    data: capItems,
    getPath: (d) => d.path,
    getColor: (d) => CAP_CASING[d.type],
    getWidth: 8,
    widthUnits: 'pixels',
    capRounded: true,
    jointRounded: true,
  });
  const closureDash = new PathLayer<OverlayItem>({
    id: 'closure-dash',
    data: capItems,
    getPath: (d) => d.path,
    getColor: (d) => CAP_DASH_COLOR[d.type],
    getWidth: 5,
    widthUnits: 'pixels',
    capRounded: false,
    jointRounded: true,
    extensions: [new PathStyleExtension({ dash: true })],
    getDashArray: (d: OverlayItem) => CAP_DASH[d.type], // relative to path width (deck.gl 9.3)
  } as ConstructorParameters<typeof PathLayer<OverlayItem>>[0]);
  const incidentItems = capItems.filter((d) => d.type === 'incident');
  const incidentMarkerDot = new ScatterplotLayer<OverlayItem>({
    id: 'incident-marker-dot',
    data: incidentItems,
    getPosition: (d) => midOf(d.path),
    getFillColor: [255, 250, 240, 245],
    getLineColor: [125, 62, 12, 255],
    stroked: true,
    lineWidthMinPixels: 2,
    radiusUnits: 'pixels',
    getRadius: 9,
  });
  const incidentMarkerGlyph = new TextLayer<OverlayItem>({
    id: 'incident-marker-glyph',
    data: incidentItems,
    getPosition: (d) => midOf(d.path),
    getText: () => '!',
    getSize: 13,
    getColor: [125, 62, 12, 255],
    fontWeight: 800,
    billboard: true,
  });
  // The window badge ("08:15–08:55" calibrated / "t=600–2400 s" synthetic) — rendered whenever the
  // windowed item renders (V2.2d: capacity AND windowed-legacy items alike — both time-gate now).
  // The en-dash is OUTSIDE deck.gl's default ASCII characterSet: compute it.
  const badgeItems = [...legacyItems, ...capItems].filter((d) => d.window);
  const badgeText = (d: OverlayItem) =>
    fmtWindowRange(d.window!, (meta as { demand_profile?: string }).demand_profile);
  const windowBadge = new TextLayer<OverlayItem>({
    id: 'window-badge',
    data: badgeItems,
    getPosition: (d) => midOf(d.path),
    getText: badgeText,
    getSize: 12,
    getColor: [55, 55, 60, 255],
    getPixelOffset: [0, -20],
    background: true,
    getBackgroundColor: [255, 252, 240, 235],
    backgroundPadding: [5, 3, 5, 3],
    characterSet: BADGE_CHARSET,
    billboard: true,
  });

  const layers: Layer[] = [
    ...baseNetworkLayers, // V2.0b: the drawn network — z=0, below everything, all modes
    trails,
    zoneTint, // V2.2d: the always-visible zone designation, under the time-gated change overlay
    changeOverlay, // below the dots (above base) → rerouting cars visibly travel ON the proposed road
    closureCasing,
    closureDash,
    backgroundVehicleDots,
    backgroundPersonDots,
    conflictDots,
    conflictPulses,
    instrumentedDots,
    flashRing,
    incidentMarkerDot,
    incidentMarkerGlyph,
    windowBadge,
    ...(mode === 'edit' ? [editEdges, snapTargets, drawPreview] : []),
  ];
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

      {/* Map chrome (header / sample note / change legend) belongs to the MAP — hidden while the
          compare sheet covers it (the sheet carries its own per-side provenance instead). */}
      {effectiveMode !== 'compare' && <ScenarioHeader scenario={meta.scenario} />}

      {/* V2.1b render-sample framing: a capped artifact ALWAYS says it renders a sample — the map showing
          fewer dots than the simulated population must never read as the population itself. */}
      {effectiveMode !== 'compare' && meta.render_sample && (
        <div style={renderSampleNote} data-testid="render-sample-note">
          rendering {meta.render_sample.rendered_vehicles.toLocaleString()} of{' '}
          {meta.render_sample.total_vehicles.toLocaleString()} vehicles ·{' '}
          {meta.render_sample.rendered_persons.toLocaleString()} of{' '}
          {meta.render_sample.total_persons.toLocaleString()}{' '}
          pedestrians (outcome-stratified sample); conflict flares shown are a severity-stratified
          sample; scorecard counts cover the full population
        </div>
      )}

      {/* 5.3 change-visibility legend / labeled degradation — a change run always says WHERE its change is.
          v0.5.0: a composite scenario summarizes the count; a single change keeps its label. */}
      {effectiveMode !== 'compare' && changeGeom?.runId === meta.run_id && (
        overlayItems.length > 0 ? (
          <div style={changeLegend} data-testid="change-legend">
            {overlayItems.length === 1 && CAPACITY_TYPES.has(overlayItems[0].type) ? (
              // V2.2c per-type row — mechanical wording; lane counts never derived from
              // network.json's TOTAL lanes (only the change's own target_lanes length).
              <span data-testid={`legend-item-${overlayItems[0].type}`}>
                <span style={{ ...legendSwatch, background: `rgb(${CAP_DASH_COLOR[overlayItems[0].type].slice(0, 3).join(',')})` }} />
                {overlayItems[0].type === 'lane_closure' &&
                  `${overlayItems[0].target_lanes?.length ?? 0} lane(s) closed`}
                {overlayItems[0].type === 'road_closure' && 'road closed'}
                {overlayItems[0].type === 'incident' &&
                  `incident${overlayItems[0].effect?.speed_factor != null ? ' (slowdown)' : ''}${overlayItems[0].effect?.blocked ? ' (lanes blocked)' : ''}`}
                {overlayItems[0].window
                  ? ` · ${fmtWindowRange(overlayItems[0].window, (meta as { demand_profile?: string }).demand_profile)}`
                  : ''}
              </span>
            ) : (
              <>
                <span style={{ ...legendSwatch, background: overlayItems[0].type === 'new_road' ? 'rgb(20,200,170)' : 'rgb(245,170,40)' }} />
                {overlayItems.length === 1
                  ? (overlayItems[0].type === 'new_road' ? 'proposed road' : 'edited street')
                  : `${overlayItems.length} changes`}
              </>
            )}
            {/* V2.2d — the zone row must SAY what always-visible means: at t=0 a viewer sees
                yellow tint and no change overlay, which would read as "zone active, nothing
                applied" without this sentence. */}
            {zoneTagged && (
              <span style={zoneLegendRow} data-testid="legend-zone">
                <span style={{ ...legendSwatch, background: 'rgb(255,200,40)' }} />
                school zone (designation, always shown) — reduced limits apply during the window
              </span>
            )}
          </div>
        ) : changeGeom.error ? (
          <div style={changeOfflineNote} data-testid="change-offline">
            backend offline — change location not shown
          </div>
        ) : null
      )}

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
        <button
          style={{ ...modeBtn, ...(effectiveMode === 'compare' ? modeBtnActive : null) }}
          onClick={() => setMode('compare')}
          data-testid="mode-compare"
        >
          ⇄ Compare
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
          runOptions={runOptions}
          onRunOptions={setRunOptions}
          activeRunId={activeRunId}
          onDrawAnother={drawAnother}
          onLoaded={loadRun}
          onVoice={handleVoice}
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
          onEdgeLaneClosure={onEdgeLaneClosure}
          onEdgeRoadClosure={onEdgeRoadClosure}
          onEdgeIncident={onEdgeIncident}
          onWindowedDraft={setDraftWindowed}
          windowLocked={draftWindowed}
          zoneMode={zoneMode}
          zoneEdges={zoneEdges}
          onZoneToggle={onZoneToggle}
          onZoneRemove={onZoneRemove}
          onZoneSubmit={onZoneSubmit}
          onZoneCancel={onZoneCancel}
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
              demandProfile={meta.demand_profile}
              changeWindow={windowedSpan(changesOf(artifact), meta.sim_end)}
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
      ) : effectiveMode === 'compare' ? (
        // V2.1d part ii — the sheet occludes the (static) map; Timeline is unmounted so playback's
        // rAF loop stops for free. Picks live in MapView state and survive mode switches.
        <CompareView
          a={effectiveCompareA}
          b={compareB}
          loading={compareLoading}
          error={compareError}
          onPickA={pickCompareA}
          onPickB={pickCompareB}
        />
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

// 5.3 change-visibility legend / offline note — top-left, beside the Report button.
const changeLegend: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 132,
  zIndex: 25,
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap', // V2.2d: the zone designation row wraps to its own line
  maxWidth: 460,
  gap: 7,
  background: 'rgba(255,255,255,0.96)',
  border: '1px solid #d7dbe0',
  borderRadius: 8,
  boxShadow: '0 2px 8px rgba(0,0,0,0.14)',
  padding: '6px 10px',
  fontSize: 12,
  fontWeight: 600,
  color: '#374151',
  fontFamily: 'system-ui, sans-serif',
};
const zoneLegendRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  flexBasis: '100%',
  fontWeight: 500,
  color: '#57534e',
};
const legendSwatch: React.CSSProperties = { width: 16, height: 4, borderRadius: 2, display: 'inline-block' };

// V2.1b: the render-sample framing note — bottom-center, always visible while a capped artifact is loaded.
const renderSampleNote: React.CSSProperties = {
  position: 'absolute',
  bottom: 10,
  left: '50%',
  transform: 'translateX(-50%)',
  background: 'rgba(20,20,25,0.85)',
  color: '#cfd3dc',
  borderRadius: 6,
  padding: '5px 10px',
  fontSize: 11,
  zIndex: 5,
  maxWidth: 560,
  textAlign: 'center',
};
const changeOfflineNote: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 132,
  zIndex: 25,
  background: 'rgba(255,247,237,0.98)',
  border: '1px solid #f0c9a0',
  borderRadius: 8,
  boxShadow: '0 2px 8px rgba(0,0,0,0.14)',
  padding: '6px 10px',
  fontSize: 12,
  color: '#9a5a1e',
  fontFamily: 'system-ui, sans-serif',
};

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
