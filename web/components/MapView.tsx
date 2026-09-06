'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, { useControl, type MapRef } from 'react-map-gl/maplibre';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { PathStyleExtension } from '@deck.gl/extensions';
import { fmtWindowRange } from '@/lib/simTime';
import { ARTIFACT_CACHE, EXAMPLE_RUN_ID, STATIC_DEMO } from '@/lib/demo';
import { TripsLayer } from '@deck.gl/geo-layers';
import { ScatterplotLayer, PathLayer, IconLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { Agent, ChangeType, Conflict, LonLat, MandateAgent, Person, PinnedSimAgent, TrajectoryArtifact, Vehicle } from '@/lib/types';
import { changesOf, isMandateAgent, MANDATE_VERSIONS } from '@/lib/types';
import { loadNetwork, onewayArrows, type ArrowAnchor, type NetworkEdge } from '@/lib/network';
import { isSimPersonAgent, isSimVehicleAgent } from '@/lib/types';
import { EditPanel, type DrawParams } from '@/components/EditPanel';
import { type DraftMember } from '@/components/DraftPanel';
import { deriveBlockers, hasWindowedMember, memberWindow } from '@/lib/draftBlockers';
import { getJunctions, getEdges, getRuns, postSimulate, postSimulateComposite, postGroupInterview, type ChangeWindow, type GroupTurnWire, type InterviewMsg, type Junction, type Edge, type EdgeEligibility, type SimChange, type RunOptions, type RunStatus } from '@/lib/api';
import type { VoiceEvent } from '@/lib/runStream';
import { useRunFeed } from '@/lib/useRunFeed';
import { InterviewDrawer } from '@/components/InterviewDrawer';
import { RoomDrawer, type RoomMsg, type RoomPair, type RoomRound } from '@/components/RoomDrawer';
import { GraphSplitView, type GraphsSidecar } from '@/components/GraphSplitView';
import { Timeline } from '@/components/Timeline';
import { ScenarioHeader } from '@/components/ScenarioHeader';
import { CommentFeed } from '@/components/CommentFeed';
import { DiscourseFeed } from '@/components/DiscourseFeed';
import { CascadeSelector } from '@/components/CascadeSelector';
import { ArgumentEngagementPanel } from '@/components/ArgumentEngagementPanel';
import { AgentPanel } from '@/components/AgentPanel';
import { InstitutionPanel } from '@/components/InstitutionPanel';
import { ScorecardPanel } from '@/components/ScorecardPanel';
import { ShellHeader } from '@/components/ShellHeader';
import { DocumentPanel } from '@/components/DocumentPanel';
import { ChatPanel } from '@/components/ChatPanel';
import { stageAvailability, type ExploreSub, type Stage } from '@/lib/shell';
import { windowedScope } from '@/lib/windowedScope';
import { ExampleBuildView, RunDocument, type ReportState } from '@/components/RunDocument';
import { RunListPopover } from '@/components/RunListPopover';
import { HeldMoment, RunExperience, useHeldMomentSeen } from '@/components/run/RunExperience';
import { reportRunId, reportUrl, type PerRunReport } from '@/lib/reportData';
import { ConflictLegend } from '@/components/ConflictLegend';
import { CompareView } from '@/components/CompareView';
import { loadCompareSide, slimFromArtifact, type CompareSide } from '@/lib/compare';
import { activeAt, agentId, materializeTimestamps, nearestWithin, positionAt, positionAtCached, sentimentColor, type Materialized } from '@/lib/viz';
import { parseVia, viaClickReason, viaCloseReason, type Bbox } from '@/lib/viaRules';
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

// The default-run POINTER (V2.5c): latest.json is {"run_id": "<id>"} — never a payload — written
// ONLY on quant-run completion (enriches never repoint the default). The mount effect resolves it
// then fetches /<run_id>.json.
const ARTIFACT_URL = '/latest.json';
// V2.7a — the returning user's last-viewed run (client-side only; loadRun + the mount commit
// both write it; the persisted id restores ONLY the run pointer — never session state).
const LAST_RUN_KEY = 'nadi:lastRun';

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
/** A change as the OVERLAY needs it. The loaded run supplies typed `Change`s from the artifact; a
 *  COMPUTING run supplies the same fields from its run-state (`RunStatus.changes`, loosely typed on
 *  the wire) — the resolver reads only what both carry. */
type GeomChange = {
  type?: string;
  target_edge?: string;
  from_junction?: string;
  to_junction?: string;
  via?: string[] | null;
  window?: { start_s: number; end_s: number } | null;
  target_lanes?: number[] | null;
  effect?: { blocked?: boolean | null; speed_factor?: number | null } | null;
};

/**
 * Resolve a change list to map geometry. EXTRACTED in V2.7b C8b because there are now two runs whose
 * changes can need drawing at once: the loaded run's (the persistent overlay) and, during Act I, the
 * one still computing — whose member the caption calls "yours", so it must be that run's member and
 * not the previous run's leftovers. One resolver keeps the two overlays pixel-identical by
 * construction; two copies would drift the first time a change type gained a field.
 */
async function resolveOverlayItems(
  changes: GeomChange[],
  bbox: [number, number, number, number],
  networkLookup: Record<string, { geometry: LonLat[] }>,
): Promise<{ items: OverlayItem[]; error: boolean }> {
  let error = false;
  // NB: `Map` is shadowed by the react-map-gl <Map> import — use a plain Record for the lookup.
  const junctionById: Record<string, LonLat> = {};
  if (changes.some((c) => c.type === 'new_road' && c.from_junction && c.to_junction)) {
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
      // V2.6d: the curve rides via ('lon,lat' strings, tolerant parse — a legacy junction-id via
      // degrades to today's two-junction chord, never a crash)
      if (a && b) geom = [a, ...parseVia(change.via), b];
    } else if (change.target_edge) {
      geom = networkLookup[change.target_edge]?.geometry ?? null; // canonical edge → network map
    }
    // V2.2c: carry the window/lanes/effect so the overlay can style per type AND tell the truth in
    // TIME (windowed items appear/disappear at their window during playback).
    if (geom) items.push({
      path: geom, type: change.type as ChangeType,
      window: change.window ?? null,
      target_lanes: change.target_lanes ?? null,
      effect: change.effect ?? null,
    });
  }
  return { items, error };
}

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
  // V2.7b C8b — ACT I's map source. While a new run computes, the artifact on screen is still the
  // PREVIOUS run's; this holds the computing run's baseline leg (emitted by the harness the moment
  // that leg finishes) so the map plays real recorded traffic instead of freezing on another run.
  // Kept SEPARATE from `artifact` on purpose: every run-id guard, the report vintage guard, the
  // scorecard and the panels keep reading the real artifact, so nothing downstream learns about it.
  const [baselinePreview, setBaselinePreview] =
    useState<{ runId: string; artifact: TrajectoryArtifact } | null>(null);
  // V2.5d: the default-artifact load failure is LABELED (was the app's one eternal spinner)
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [selected, setSelected] = useState<PinnedSimAgent | null>(null);
  // V2.3b — the interview drawer: which voice is being interviewed + per-agent SESSION transcripts
  // (a state record keyed by agentId — never persisted anywhere; cleared on run swap).
  const [interviewee, setInterviewee] = useState<Agent | null>(null);
  // Plain STATE, not a ref+tick: the drawer's messages prop reads this during render, and a ref
  // read there is a react-hooks/refs violation the old manual re-render tick only papered over.
  const [interviews, setInterviews] = useState<Record<string, InterviewMsg[]>>({});
  const onInterviewMsgs = useCallback((id: string, msgs: InterviewMsg[]) => {
    setInterviews((cur) => ({ ...cur, [id]: msgs }));
  }, []);
  // V2.6b — the group-interview ROOM. Participants are {agent, index} PAIRS resolved ONCE at add
  // time (identity flows as object references; indexOf on a copy breaks to -1 and an id-scan
  // fallback would misattribute sibling voices). Session-only like the single interviews — every
  // store below clears in loadRun; roomEpoch kills an in-flight round on run swap (an awaited
  // response must never resurrect turns into a fresh session).
  const [roomOpen, setRoomOpen] = useState(false);
  const [roomPairs, setRoomPairs] = useState<RoomPair[]>([]);
  const [roomMsgs, setRoomMsgs] = useState<RoomMsg[]>([]);
  const [roomRound, setRoomRound] = useState<RoomRound | null>(null);
  const [roomLastRound, setRoomLastRound] = useState<number | null>(null);
  const roomEpoch = useRef(0);
  // SYNCHRONOUS in-flight guard (review catch): React state commits async, so key-repeat on a
  // focused Retry/Ask can fire twice before `roomRound` updates — a ref check-and-set is the only
  // race-free gate against a double-POSTed speaker slot (double spend).
  const roomLoopActive = useRef(false);
  const [showAllConflicts, setShowAllConflicts] = useState(true);
  const [feedGroup, setFeedGroup] = useState<string | null>(null); // scorecard→feed join filter
  const [flashId, setFlashId] = useState<string | null>(null); // reverse join: briefly ring a located dot
  // V2.7a — the four-stage shell: Build → Watch → Read → Explore (one workflow, not tabs; a run
  // moves through them). `?compare=` deep-links into Explore·Compare — read in the initializer
  // (hydration-safe: the pre-artifact shell renders identically whatever the stage). The default
  // stage flips to Read with the C4 landing logic; until then Watch = behavioral parity with the
  // old playback default.
  const [stage, setStage] = useState<Stage>(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('compare')
      ? 'explore'
      : 'read',
  );
  const [exploreSub, setExploreSub] = useState<ExploreSub>('compare');
  const [docCollapsed, setDocCollapsed] = useState(false); // the run-document panel's collapse strip
  const [runsOpen, setRunsOpen] = useState(false); // the header run tag's inventory popover
  // true once the user explicitly starts/clones a draft — gates the EXAMPLE's read-only Build
  // view (without it, opening Build on the example shows composition, never an editable rail).
  const [freshDraft, setFreshDraft] = useState(false);
  const [playbackBarHidden, setPlaybackBarHidden] = useState(false); // Watch: the bar is toggleable, shown by default
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
  // V2.6d — via BEND points (empty-map clicks mid-draw), validated incrementally at click time
  // with the server's own sentences (an invalid curve never enters the basket).
  const [vias, setVias] = useState<LonLat[]>([]);
  // V2.2d — the school-zone flow: zone-select mode accumulates clicked edges (toggle to remove);
  // submit posts N windowed speed_limit primitives + tags=["school_zone"] as ONE composite run.
  const [zoneMode, setZoneMode] = useState(false);
  const [zoneEdges, setZoneEdges] = useState<string[]>([]);
  const [hoverCoord, setHoverCoord] = useState<LonLat | null>(null); // rubber-band endpoint while drawing
  const [drawHint, setDrawHint] = useState<string | null>(null); // transient "click nearer a junction"
  const [activeRunId, setActiveRunId] = useState<string | null>(null); // the run the card watches / shows
  // V2.7b C8b — THE ARTIFACT ON SCREEN IS NOT THE RUN BEING WATCHED. Everything the map draws is
  // gated on this: entities, the agent join, conflicts, the change overlay and its chrome. The rule
  // is one sentence — nothing belonging to run A may be drawn under run B's name — and it holds in
  // both windows where the two diverge (a run still computing, and a finished run whose artifact is
  // still being fetched). Declared HERE, above every consumer, because the render AND the
  // __nadiChangeOverlay seam read it: a seam that recomputed its own answer would report an overlay
  // the map is not drawing, and a seam that disagrees with the pixels is worse than no seam.
  const watchedRunNotLoaded =
    activeRunId != null && artifact != null && activeRunId !== artifact.meta.run_id;
  const [submitting, setSubmitting] = useState(false); // V2.4a: true only while runDraft's POST is in flight
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
    // V2.7a — the LANDING PRECEDENCE CHAIN (every hop validated; failure falls THROUGH, so the
    // ratified cold landing — the committed EXAMPLE run — is always reachable):
    //   ?run= (explicit; failure = labeled error, never a silent fallback)
    //   → localStorage last-viewed run (the returning user)
    //   → the latest.json POINTER (most-recently-RUN on this box; the demo build aims it at the
    //     example) — a payload-shaped or unrecognized pointer ABORTS with the labeled error
    //     (ride-along 6a: the V2.5c legacy-payload fallback EXPIRED; loading it silently would
    //     resurrect the compat branch as invisible behavior)
    //   → EXAMPLE_RUN_ID (committed).
    // Caching is ARTIFACT_CACHE (web/lib/demo.ts): no-store in live builds — large (~20MB),
    // frequently-rewritten aliases — but default caching in the static demo (immutable files).
    const run = new URLSearchParams(window.location.search).get('run');
    const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
    const fetchArtifact = async (url: string): Promise<TrajectoryArtifact> => {
      const r = await fetch(url, { cache: ARTIFACT_CACHE });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // V2.5c perf marks (permanent, read by scripts/perf-harness.mjs): fetch-to-parse split
      performance.mark('nadi:parse:start');
      const data = (await r.json()) as TrajectoryArtifact;
      performance.mark('nadi:parse:end');
      return data;
    };
    const commit = (art: TrajectoryArtifact, url: string): boolean => {
      if (!art?.meta) {
        // labeled degradation, never a render crash: well-formed JSON of the WRONG shape must
        // not commit a bogus artifact (it would blow up at the meta.bbox destructure in render)
        console.error(`failed to load ${url}: unrecognized artifact/pointer shape`);
        setLoadError(`${url} — unrecognized artifact/pointer shape`);
        return false;
      }
      setCurrentTime(art.meta.sim_start);
      setArtifact(art);
      try {
        window.localStorage.setItem(LAST_RUN_KEY, art.meta.run_id);
      } catch {
        /* storage unavailable (private mode) — the landing chain simply starts one hop later */
      }
      return true;
    };
    const load = async () => {
      // 1) explicit deep link — its failure is ITS error (no fallback: a pinned spec or a
      //    shared link must never silently show a different run)
      if (run) {
        const url = `/${run}.json`;
        try {
          const art = await fetchArtifact(url);
          if (!cancelled) commit(art, url);
        } catch (e) {
          console.error(`failed to load ${url}`, e);
          if (!cancelled) setLoadError(`${url} — ${msg(e)}`);
        }
        return;
      }
      // 2) the returning user's last-viewed run (validated; unresolvable → fall through)
      let last: string | null = null;
      try {
        last = window.localStorage.getItem(LAST_RUN_KEY);
      } catch {
        last = null;
      }
      if (last) {
        try {
          const art = await fetchArtifact(`/${last}.json`);
          if (cancelled) return;
          if (art?.meta && commit(art, `/${last}.json`)) return;
        } catch {
          /* pruned or renamed run — fall through */
        }
        if (cancelled) return;
      }
      // 3) the pointer
      try {
        const r = await fetch(ARTIFACT_URL, { cache: ARTIFACT_CACHE });
        if (r.ok) {
          const data = (await r.json()) as { run_id?: string; meta?: unknown };
          if (data && typeof data.run_id === 'string' && !data.meta) {
            if (cancelled) return;
            const url = `/${data.run_id}.json`;
            try {
              const art = await fetchArtifact(url);
              if (cancelled) return;
              if (art?.meta && commit(art, url)) return;
            } catch {
              /* the pointer's target was pruned — fall through to the example */
            }
            if (cancelled) return;
          } else if (data && typeof data === 'object' && (data as { meta?: unknown }).meta) {
            // ride-along 6a (V2.5c expiry): the legacy full-artifact payload takes the LABELED
            // error path now — deleting only the console.warn would have LOADED it silently.
            if (cancelled) return; // (review) a dead StrictMode instance must not clobber live state
            console.error('latest.json is a legacy full-artifact payload — the pointer contract expired at V2.7');
            setLoadError(
              `${ARTIFACT_URL} — legacy full-artifact payload; the V2.5c pointer contract ` +
                'expired at V2.7 — rerun any scenario to regenerate the {"run_id"} pointer',
            );
            return;
          } else {
            if (cancelled) return; // (review) same StrictMode guard as every sibling branch
            console.error(`failed to load ${ARTIFACT_URL}: unrecognized artifact/pointer shape`);
            setLoadError(`${ARTIFACT_URL} — unrecognized artifact/pointer shape`);
            return;
          }
        }
        /* 404 → fall through */
      } catch {
        /* network failure on the pointer — fall through */
      }
      if (cancelled) return;
      // 4) the committed example (the ratified cold landing)
      const url = `/${EXAMPLE_RUN_ID}.json`;
      try {
        const art = await fetchArtifact(url);
        if (!cancelled) commit(art, url);
      } catch (e) {
        console.error(`failed to load ${url}`, e);
        if (!cancelled) setLoadError(`${url} — ${msg(e)} (the default pointer and the committed example both failed)`);
      }
    };
    void load();
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
    let cancelled = false;
    (async () => {
      const { items, error } = await resolveOverlayItems(changes, bbox, networkLookup);
      if (!cancelled) setChangeGeom({ runId, items, error });
    })();
    return () => {
      cancelled = true;
    };
  }, [artifact, networkLookup]);

  // V2.3d — the graphs sidecar (positions precomputed server-side), fetched LAZILY on graphs-mode
  // entry. A 404 is the honest "no layouts exported for this run yet" state — GraphSplitView
  // renders it labeled. Cache invalidation is loadRun's setGraphsSidecar(null) (an enrich may have
  // just exported fresh layouts for the SAME run_id). Acceptance goes through a FUNCTIONAL setter
  // (only the still-pending fetch for this run may land) instead of an effect-cleanup `cancelled`
  // flag — cleanup would also fire on the guarded reruns this effect's own setState causes.
  const [graphsSidecar, setGraphsSidecar] = useState<{
    runId: string;
    data: GraphsSidecar | null;
    loading: boolean;
    error: boolean;
  } | null>(null);
  useEffect(() => {
    if (!(stage === 'explore' && exploreSub === 'graphs') || !artifact) return;
    const runId = artifact.meta.run_id;
    if (graphsSidecar?.runId === runId) return; // fetched, fetching, or errored — loadRun clears to refresh
    // queueMicrotask: the loading-state flip must not run synchronously inside the effect body
    // (react-hooks/set-state-in-effect — the ?compare= pick precedent above); it still fires before
    // any network macrotask, so `settle`'s loading guard sees it.
    queueMicrotask(() => setGraphsSidecar({ runId, data: null, loading: true, error: false }));
    const settle = (next: { runId: string; data: GraphsSidecar | null; loading: boolean; error: boolean }) =>
      setGraphsSidecar((cur) => (cur?.runId === runId && cur.loading ? next : cur));
    (async () => {
      try {
        const r = await fetch(`/${runId}-graphs.json`, { cache: ARTIFACT_CACHE });
        if (!r.ok) {
          settle({ runId, data: null, loading: false, error: true });
          return;
        }
        const data = (await r.json()) as GraphsSidecar;
        // stale-pick guard: only accept the sidecar for the run it claims
        settle({ runId, data: data.run_id === runId ? data : null, loading: false, error: data.run_id !== runId });
      } catch {
        settle({ runId, data: null, loading: false, error: true });
      }
    })();
  }, [stage, exploreSub, artifact, graphsSidecar]);

  // V2.7a C3 — the per-run REPORT for the Read stage (the graphs-sidecar pattern: lazy, keyed on
  // the run id, cleared by loadRun). VINTAGE GUARD: a report whose own run id disagrees with the
  // loaded run renders the labeled report-mismatch state — the document must never carry another
  // run's findings (the latest-report drift class, dead structurally).
  const [reportData, setReportData] = useState<{
    runId: string;
    report: PerRunReport | null;
    state: ReportState;
  } | null>(null);
  const [liveIdentity, setLiveIdentity] = useState<{ runId: string; name: string | null } | null>(null);
  useEffect(() => {
    if (stage !== 'read' || !artifact || STATIC_DEMO) return; // the demo has no identity endpoint
    const runId = artifact.meta.run_id;
    if (liveIdentity?.runId === runId) return;
    queueMicrotask(() => setLiveIdentity({ runId, name: null }));
    // the LIST endpoint, not /status: several specs mock /status as a staged SEQUENCE, and an
    // extra consumer advances their progression (caught live by seeds.spec); /api/runs is the
    // name surface anyway and statically mocked everywhere.
    getRuns().then((res) => {
      if (res.ok) {
        const name = res.value.runs.find((r) => r.id === runId)?.name ?? null;
        if (name) setLiveIdentity((cur) => (cur?.runId === runId ? { runId, name } : cur));
      }
    });
  }, [stage, artifact, liveIdentity]);
  useEffect(() => {
    if (stage !== 'read' || !artifact) return;
    const runId = artifact.meta.run_id;
    if (reportData?.runId === runId) return; // fetched, fetching, or errored — loadRun clears to refresh
    queueMicrotask(() => setReportData({ runId, report: null, state: 'loading' }));
    const settle = (next: { runId: string; report: PerRunReport | null; state: ReportState }) =>
      setReportData((cur) => (cur?.runId === runId && cur.state === 'loading' ? next : cur));
    (async () => {
      try {
        const r = await fetch(reportUrl(runId), { cache: ARTIFACT_CACHE });
        if (!r.ok) {
          settle({ runId, report: null, state: 'missing' });
          return;
        }
        const report = (await r.json()) as PerRunReport;
        settle(
          reportRunId(report) === runId
            ? { runId, report, state: 'ready' }
            : { runId, report: null, state: 'mismatch' },
        );
      } catch {
        settle({ runId, report: null, state: 'missing' });
      }
    })();
  }, [stage, artifact, reportData]);

  // Static split (recomputed only when the artifact changes). PINNED = sim agents joined to a real
  // simulated traveler — vehicle- OR person-backed (both get a clickable dot). BACKGROUND = every
  // vehicle/person NOT pinned. Inferred agents have no trip, so they don't appear on the map.
  // V2.6c — normalize ONCE per ENTITY-ARRAY identity: compact {t0, dt} entities materialize their
  // timestamp array here; explicit entities pass through by IDENTITY (viz.materializeTimestamps).
  // The normalized objects are what every frame reads (stable identities for the positionAtCached
  // WeakMap hint + the TripsLayer buffers). Keyed on artifact?.vehicles/persons — NOT [artifact]:
  // the V2.3a voice stream setArtifact-spreads per streamed voice (agents change, entity arrays
  // keep their references), and keying on the artifact would re-allocate every compact array per
  // voice — the V2.5c trails-identity regression class (review-caught).
  // V2.7b C8b — while Act I plays, the ENTITIES come from the computing run's baseline leg and the
  // rest of the document keeps coming from `artifact`. The run-id equality is the whole guard: a
  // preview only ever displaces the entities of the run it belongs to.
  const preview = baselinePreview?.runId === activeRunId ? baselinePreview.artifact : null;
  // V2.7b C8b — Act I clears these for the same reason it suppresses the change overlay: they are
  // the LOADED run's surrogate near-misses, and drawing them over a different run's traffic would
  // put one run's safety markers on another run's map. The screenshot walk caught them.
  const conflicts = useMemo(() => (watchedRunNotLoaded ? [] : (artifact?.conflicts ?? [])), [artifact, watchedRunNotLoaded]);
  // THE MAP'S ENTITY SOURCE, and the gate is `watchedRunNotLoaded` — NOT `preview != null`. A `preview ?? artifact`
  // fallthrough puts the LOADED run's traffic on the map in every Act I state where the preview is
  // absent: before `baseline_ready` lands (the baseline leg runs for minutes), on a calibrated run
  // that frees its spill and emits `baseline_unavailable`, on a failed fetch, on any pre-V2.7b run.
  // The caption in those states says the map shows the network only — so the fallthrough makes the
  // caption a lie, and the agent-blanking below can't catch it either (with no preview the join
  // runs against the loaded run's own vehicles and pins normally). Empty is the honest source.
  const entitySource = watchedRunNotLoaded ? preview : artifact;
  const rawVehicles = entitySource?.vehicles;
  const rawPersons = entitySource?.persons;
  const { normVehicles, normPersons } = useMemo(
    () => ({
      normVehicles: (rawVehicles ?? []).map(materializeTimestamps),
      normPersons: (rawPersons ?? []).map(materializeTimestamps),
    }),
    [rawVehicles, rawPersons],
  );

  const { pinned, bgVehicles, bgPersons, renderStats } = useMemo(() => {
    performance.mark('nadi:join:start'); // V2.5c perf mark (permanent; runs on artifact change only)
    const vehicles = normVehicles;
    const persons = normPersons;
    // NB: `Map` is shadowed by the react-map-gl <Map> import above — use plain Records for the lookups.
    const vById: Record<string, Materialized<Vehicle>> = {};
    for (const v of vehicles) vById[v.id] = v;
    const pById: Record<string, Materialized<Person>> = {};
    for (const p of persons) pById[p.id] = p;

    const pins: Pinned[] = [];
    const pinnedVeh = new Set<string>();
    const pinnedPer = new Set<string>();
    // V2.7b C8b — WHILE PREVIEWING, THE JOINED AGENT LIST IS EMPTY, and this is a correctness rule
    // rather than a tidiness one. Entity ids are per-run ordinals ('0', '1', '139'), so the
    // computing run's baseline preview reuses the ids the LOADED run's agents pin to — joining them
    // would silently attach the previous run's voices to this run's trips, with nothing to error on.
    // It is also the honest state: Act I has run no model, so this run has no voices yet.
    for (const a of (watchedRunNotLoaded ? [] : (artifact?.agents ?? []))) {
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
    // V2.6c — the __nadiRenderStats seam's data: TRUE point counts under both shapes, so a reader
    // that silently drops or duplicates a teleport tail shows up as a number (spec-pinned).
    const sumPath = (es: { path: unknown[] }[]) => es.reduce((n, e) => n + e.path.length, 0);
    const sumTs = (es: { timestamps: number[] }[]) => es.reduce((n, e) => n + e.timestamps.length, 0);
    const rawEntities = [...(rawVehicles ?? []), ...(rawPersons ?? [])];
    const firstCompactVehicle = (rawVehicles ?? []).find((v) => v.t0 != null);
    const out = {
      pinned: pins,
      bgVehicles: vehicles.filter((v) => !pinnedVeh.has(v.id)),
      bgPersons: persons.filter((p) => !pinnedPer.has(p.id)),
      renderStats: {
        vehicles: vehicles.length,
        persons: persons.length,
        // V2.7b C8b — how many agents are joined to a trip on the map right now. During Act I this
        // must be 0: entity ids are per-run ordinals, so joining the LOADED run's agents to the
        // computing run's baseline entities would misattribute voices with nothing to error on.
        // A count is the only way that rule is observable — the wrong join renders happily.
        pinnedAgents: pins.length,
        // and the surrogate near-miss markers, for the same reason: they are the loaded run's, and
        // during Act I they must not be drawn over a different run's traffic.
        conflicts: conflicts.length,
        vehiclePathPoints: sumPath(vehicles),
        vehicleTsPoints: sumTs(vehicles),
        personPathPoints: sumPath(persons),
        personTsPoints: sumTs(persons),
        compactEntities: rawEntities.filter((e) => e.t0 != null).length,
        explicitEntities: rawEntities.filter((e) => e.t0 == null).length,
        // the literal-anchored expansion sample: the first compact vehicle's first 5 materialized
        // times — the spec asserts HAND-COMPUTED values, never "same as the python expansion"
        sampleCompactTimestamps: firstCompactVehicle
          ? materializeTimestamps(firstCompactVehicle).timestamps.slice(0, 5)
          : null,
      },
    };
    performance.mark('nadi:join:end');
    return out;
  }, [artifact, watchedRunNotLoaded, normVehicles, normPersons, rawVehicles, rawPersons]);

  // V2.6c — publish the render-stats seam (the __nadiArrowCount convention: a useEffect, never an
  // in-memo window write).
  useEffect(() => {
    (window as unknown as { __nadiRenderStats?: unknown }).__nadiRenderStats = renderStats;
  }, [renderStats]);

  // V2.5c perf mark: the first committed render WITH artifact data — the harness's
  // first-map-paint proxy (fires once per artifact swap, after React commits the layer tree).
  useEffect(() => {
    if (artifact) performance.mark('nadi:artifact-rendered');
  }, [artifact]);

  // V2.5c: the trails data is TIME-INVARIANT (pinned changes only on artifact swap) — the old
  // fresh-array-per-render identity made deck re-run the path tesselator on every rAF tick
  // (173k points on the exemplar → the 0.36 FPS baseline). currentTime is a TripsLayer UNIFORM;
  // the data reference must be stable so buffers upload once.
  const trailVehicles = useMemo(() => pinned.filter((d) => d.kind === 'vehicle'), [pinned]);

  // Agents for the time-keyed comment feed = the pinned ones (all carry trigger_t).
  const pinnedAgents = useMemo(() => pinned.map((p) => p.agent), [pinned]);
  // Inferred (community) voices — no trip, no dot; the feed interleaves them on a synthetic clock.
  const inferredAgents = useMemo<Agent[]>(
    () => (artifact?.agents ?? []).filter((a) => a.grounding === 'inferred'),
    [artifact],
  );
  // V2.3c — mandate-grounded institutional voices (0.9.0+): no dot, no synthetic clock; a pinned
  // feed sub-block + the InstitutionPanel grounding card. The empty NOTE renders only where they
  // COULD have spoken (a 0.9.0 run with voices) — pre-0.9.0 artifacts render nothing new.
  const institutionAgents = useMemo<MandateAgent[]>(
    () => (artifact?.agents ?? []).filter(isMandateAgent),
    [artifact],
  );
  const institutionsEmpty =
    MANDATE_VERSIONS.includes(artifact?.schema_version ?? '') &&
    (artifact?.agents?.length ?? 0) > 0 &&
    institutionAgents.length === 0;
  const [institution, setInstitution] = useState<MandateAgent | null>(null);
  // agentId → pinned entry, for the reverse join (feed row → fly to that traveler's dot).
  const pinnedById = useMemo(() => {
    const m: Record<string, Pinned> = {};
    for (const p of pinned) m[agentId(p.agent)] = p;
    return m;
  }, [pinned]);

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
    if (stage !== 'build') return;
    fetchJunctions();
    let cancelled = false;
    (async () => {
      const res = await getEdges();
      if (!cancelled && res.ok) {
        const map: Record<string, EdgeEligibility> = {};
        for (const e of res.value.edges) map[e.id] = e;
        setEligById(map);
        // V2.4a deterministic seam (the __nadiNetworkEdges convention): specs gate edge picks on
        // eligibility having landed — a pick before this merges car_lane_indices: [] into the
        // palette's keyed snapshot, so the lane picker renders empty (a real race, spec-caught).
        (window as unknown as { __nadiEligEdges?: number }).__nadiEligEdges = res.value.edges.length;
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
  }, [stage, fetchJunctions]);

  // V2.3a — voices streamed so far this enrich (arrival order): the EditPanel live ticker's data.
  // Cleared by loadRun — the done-edge reload swaps in the authoritative artifact and the ticker yields
  // to the real feed. A mid-stream degrade keeps what already arrived (the panel is never corrupted).
  const [streamedAgents, setStreamedAgents] = useState<Agent[]>([]);

  // Load a completed run's artifact by id (per-run public copy). RunCard calls this on the `done` edge.
  const loadRun = useCallback(async (id: string) => {
    setActiveRunId(id);
    setStreamedAgents([]); // authoritative swap (or run switch) — the live ticker's job is over
    // V2.3b: interviews are per-run sessions — a run swap ends them (ephemeral by construction)
    setInterviewee(null);
    setInterviews({});
    setInstitution(null); // V2.3c: the grounding card is per-run too
    // V2.6b: the room is a per-run session too; the epoch bump kills any in-flight round loop
    roomEpoch.current++;
    roomLoopActive.current = false; // the epoch bump orphaned any in-flight loop — free the gate
    setRoomOpen(false);
    setRoomPairs([]);
    setRoomMsgs([]);
    setRoomRound(null);
    setRoomLastRound(null);
    // V2.3d: an enrich may have just exported fresh graph layouts for this same run_id — drop the
    // cached (possibly 404-errored) sidecar so graphs mode refetches instead of staying stale
    setGraphsSidecar(null);
    setReportData(null); // the Read stage refetches the new run's report
    setLiveIdentity(null);
    setFreshDraft(false); // viewing a run again — a future Build click shows its composition/watcher
    try {
      const r = await fetch(`/${id}.json`, { cache: ARTIFACT_CACHE });
      if (!r.ok) return; // not ready yet (still running) — the run card keeps showing progress
      const data = (await r.json()) as TrajectoryArtifact;
      setArtifact(data);
      // V2.7b C8b — the real run has landed, so Act I's stand-in is retired. Dropped AFTER the swap:
      // clearing it first would flash the PREVIOUS run's traffic between the two commits, and a
      // failed load above keeps the preview playing, which is the honest state (the run's own
      // baseline) rather than someone else's trips.
      setBaselinePreview(null);
      setCurrentTime(data.meta.sim_start);
      // V2.7a: the returning user lands on their most recently VIEWED run
      try {
        window.localStorage.setItem(LAST_RUN_KEY, data.meta.run_id);
      } catch {
        /* storage unavailable — landing simply starts one hop later */
      }
    } catch (e) {
      console.error('failed to load run', id, e);
    }
  }, []);

  // V2.6b — room handlers. addToRoom resolves the artifact index ONCE (reference equality is the
  // only reliable identity; a ref is never guessed for a copied object). Dup/cap checks live
  // INSIDE the functional updater: StrictMode double-invokes it, and identity being intrinsic
  // makes the second invoke a no-op (no minted ids needed, unlike the draft basket).
  const addToRoom = useCallback(
    (agent: Agent) => {
      const idx = artifact?.agents?.indexOf(agent) ?? -1;
      if (idx < 0) return;
      setRoomOpen(true);
      setRoomPairs((cur) => {
        if (cur.length >= 5 || cur.some((p) => p.index === idx)) return cur;
        return [...cur, { agent, index: idx }];
      });
    },
    [artifact],
  );

  const removeFromRoom = useCallback((index: number) => {
    setRoomPairs((cur) => cur.filter((p) => p.index !== index));
  }, []);

  // The sequential round loop (the ratified speak-param transport): one POST per speaker, each
  // answer appended to the wire transcript before the next call — answers render as they arrive.
  // A transport failure stops at that SPEAKER'S slot: rows 0..k-1 stand, Retry resumes from k
  // (same speak, same prefix — no silent re-spend). The epoch check after EVERY await keeps a
  // run-swap mid-round from resurrecting stale turns into the fresh session.
  const runRoomLoop = useCallback(
    async (round: RoomRound) => {
      if (!artifact || roomLoopActive.current) return; // ref gate: race-free vs key-repeat
      roomLoopActive.current = true;
      const epoch = roomEpoch.current;
      try {
        const runId = artifact.meta.run_id;
        const refs = round.pairs.map((p) => ({ agent_id: agentId(p.agent), agent_index: p.index }));
        let transcript = round.transcript;
        let calls = round.llmCalls;
        for (let k = round.speak; k < round.pairs.length; k++) {
          setRoomRound({ ...round, speak: k, transcript, llmCalls: calls, status: 'thinking', error: undefined });
          const res = await postGroupInterview(runId, refs, round.question, transcript, k);
          if (epoch !== roomEpoch.current) return; // run swapped mid-round — the room is gone
          if (!res.ok) {
            setRoomRound({ ...round, speak: k, transcript, llmCalls: calls, status: 'error', error: res.error });
            return;
          }
          const a = res.value.answers[0];
          const aIdx = a.agent_index ?? refs[k].agent_index;
          setRoomMsgs((cur) => [
            ...cur,
            { role: 'agent', text: a.answer, agentId: a.agent_id, agentIndex: aIdx,
              speakerLabel: a.persona_label, grounding: a.grounding, audit: a.audit },
          ]);
          transcript = [...transcript, { role: 'agent', text: a.answer, agent_id: a.agent_id, agent_index: aIdx }];
          calls += res.value.llm_calls;
        }
        setRoomRound(null);
        setRoomLastRound(calls); // the round's ACTUAL spend — can exceed N (per-speaker retries)
      } finally {
        // only the loop that still owns the session frees the gate — a stale (epoch-orphaned)
        // loop's finally must not unlock a successor mid-round; loadRun already reset it
        if (epoch === roomEpoch.current) roomLoopActive.current = false;
      }
    },
    [artifact],
  );

  const askRoom = useCallback(
    (question: string) => {
      if (roomLoopActive.current) return; // pre-side-effect gate: no duplicate optimistic user turn
      // the wire prefix is the PRIOR history stripped to wire keys — the question rides its own
      // field (the V2.3b no-duplication rule); display fields (labels/audit) never ride the wire
      const base: GroupTurnWire[] = roomMsgs.map((m) =>
        m.role === 'agent'
          ? { role: m.role, text: m.text, agent_id: m.agentId, agent_index: m.agentIndex }
          : { role: m.role, text: m.text },
      );
      setRoomMsgs((cur) => [...cur, { role: 'user', text: question }]);
      setRoomLastRound(null);
      void runRoomLoop({ question, pairs: roomPairs, speak: 0, transcript: base, llmCalls: 0, status: 'thinking' });
    },
    [roomMsgs, roomPairs, runRoomLoop],
  );

  const retryRoom = useCallback(() => {
    if (roomRound) void runRoomLoop(roomRound);
  }, [roomRound, runRoomLoop]);

  const dismissRound = useCallback(() => {
    if (!roomRound) return;
    setRoomLastRound(roomRound.llmCalls); // the honest partial round — what was actually spent
    setRoomRound(null);
  }, [roomRound]);

  // V2.3a — a voice streamed in mid-enrich: append its agent to the loaded artifact (hasVoices flips,
  // the playback feed grows, a pinned-sim dot appears) AND to the arrival-order ticker list. Dedup by
  // `index` (stream replays overlap on reconnect; the wrapper's lastEventId filter already drops
  // same-connection replays — this set is the cross-reload backstop); the done-edge loadRun replaces
  // the whole artifact — the authoritative swap this only previews.
  // `done === 1` is the first completion of a JOB: it resets the dedup set and REPLACES the voice
  // sets rather than appending — a RE-enrich of the same run streams a new voice set, and without the
  // reset the stale per-run indexes swallow every new voice (live-smoke-caught) while appends would
  // pile onto the previous enrich's 212.
  const streamedVoices = useRef<{ runId: string | null; seen: Set<number> }>({ runId: null, seen: new Set() });
  const handleVoice = useCallback((runId: string, v: VoiceEvent) => {
    const s = streamedVoices.current;
    const newJob = v.done === 1;
    if (s.runId !== runId || newJob) {
      s.runId = runId;
      s.seen = new Set();
    }
    if (s.seen.has(v.index)) return;
    s.seen.add(v.index);
    setStreamedAgents((prev) => (newJob ? [v.agent] : [...prev, v.agent]));
    setArtifact((prev) => {
      // run-id guard: never wire streamed voices onto a different loaded run
      if (!prev || prev.meta.run_id !== runId) return prev;
      return { ...prev, agents: [...(newJob ? [] : (prev.agents ?? [])), v.agent] };
    });
  }, []);

  // V2.7b C3 — THE RUN FEED. One poll and one stream per run, held here rather than inside the run
  // card, so they survive a stage switch: the run experience watches from Watch and the document
  // reads results from Read while the same run is still computing. The feed runs on exactly the
  // condition that used to mount the card (`activeRunId != null`), so request count and cadence are
  // unchanged for every existing spec — the widening is deliberate and belongs to a later commit.
  const feedHandlers = useMemo(() => ({ onLoaded: loadRun, onVoice: handleVoice }), [loadRun, handleVoice]);
  const runFeed = useRunFeed(activeRunId, feedHandlers);

  // ACT I PROPER — the narrative surfaces (the beat ledger and its caption, Watch's computing
  // split, Read's not-computed state, the header's run tag). Stricter than the map gate above,
  // because the two predicates answer different questions. The map asks "is anything on screen the
  // wrong run's?", which is true whenever the ids differ. Act I asks "is a run being simulated in
  // front of me?", and opening a FINISHED run also sets activeRunId a second or two before its
  // artifact arrives — without the second clause the caption would announce a baseline leg playing
  // for a run that finished days ago. Beats keep it true across the swap at the end of the act, so
  // the surface doesn't blink out and back while the real artifact loads.
  const watchedRunLive =
    runFeed.status != null && runFeed.status.status !== 'done' && runFeed.status.status !== 'failed';
  const actOne =
    watchedRunNotLoaded && (watchedRunLive || runFeed.experience.beats.length > 0);

  // V2.7b C7 — the experience seam: counts and stage keys, NEVER content. Specs read the fold's
  // shape from here; the content itself is asserted on the rendered surfaces, where a reader sees it.
  useEffect(() => {
    const x = runFeed.experience;
    (window as unknown as { __nadiRunFeed?: unknown }).__nadiRunFeed = {
      runId: x.runId,
      beats: x.beats.map((b) => b.key),
      stages: x.stages.map((st) => ({ key: st.key, status: st.status, calls: st.calls })),
      voices: x.voices.length,
      voicesTotal: x.voicesTotal,
      slots: x.slots.length,
      baseline: x.baselineUrl ? 'ready' : x.baselineUnavailable ? 'unavailable' : null,
      resultsReady: x.resultsReadyAt != null,
      ended: x.ended?.status ?? (x.endedByState ? 'by-state' : null),
      llmCalls: x.llmCallsTotal,
    };
  }, [runFeed.experience]);

  // V2.7b C8b — THE GHOST: the COMPUTING run's member, resolved from its run-state changes. The
  // persistent overlay above is keyed to the loaded run, and during Act I that is a DIFFERENT run —
  // drawing it while the caption says "your member" would label someone else's closure as yours.
  // Same resolver, so the ghost and the real overlay can never diverge in shape.
  const [ghostGeom, setGhostGeom] = useState<{ runId: string; items: OverlayItem[] } | null>(null);
  const watchedChanges = runFeed.status?.changes ?? (runFeed.status?.change ? [runFeed.status.change] : null);
  const watchedRunId = runFeed.status?.run_id ?? null;
  useEffect(() => {
    if (!watchedRunId || !watchedChanges || watchedChanges.length === 0 || !artifact) return;
    if (watchedRunId === artifact.meta.run_id) return; // it IS the loaded run — the real overlay has it
    let cancelled = false;
    (async () => {
      const bbox = artifact.meta.bbox as [number, number, number, number];
      const { items } = await resolveOverlayItems(watchedChanges, bbox, networkLookup);
      if (!cancelled) setGhostGeom({ runId: watchedRunId, items });
    })();
    return () => {
      cancelled = true;
    };
    // watchedChanges is a fresh array per poll; the run id is the identity that matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedRunId, artifact, networkLookup]);

  // V2.7b C8b — fetch the computing run's BASELINE LEG once its url arrives on the stream. Placed
  // here because it reads the fold; the entity memos above consume it through `baselinePreview`.
  // ITS ABSENCE IS SILENT, deliberately and in three ways: a calibrated run frees its baseline
  // spill mid-run and emits `baseline_unavailable` instead (the caption says so), a run from before
  // this step has no sidecar at all, and the static demo has no such file for any committed run.
  // None of those is a failure, so none of them may paint an error.
  const baselineUrl = runFeed.experience.baselineUrl;
  const baselineFor = runFeed.experience.runId;
  useEffect(() => {
    if (!baselineUrl || !baselineFor) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(baselineUrl, { cache: ARTIFACT_CACHE });
        if (!r.ok) return; // silent by rule
        const data = (await r.json()) as TrajectoryArtifact;
        if (!cancelled && data?.meta) {
          setBaselinePreview({ runId: baselineFor, artifact: data });
          // start the preview at ITS beginning: the clock is still wherever the previously-loaded
          // run left it, which can sit past this leg's end and show an empty map that looks broken
          setCurrentTime(data.meta.sim_start);
        }
      } catch {
        /* silent by rule — Act I keeps its beats and its honest caption */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baselineUrl, baselineFor]);

  // V2.7b C7 — the APPEND-COST seam, for scripts/perf-harness.mjs --appends N. It calls the REAL
  // handleVoice, so the measurement covers the true merge path rather than a stand-in. Published
  // only once an artifact is loaded; deleted on unmount like every other seam.
  useEffect(() => {
    const w = window as unknown as { __nadiAppendVoice?: (v: VoiceEvent) => void };
    if (!activeRunId && !artifact) return;
    const runId = artifact?.meta.run_id;
    if (!runId) return;
    w.__nadiAppendVoice = (v: VoiceEvent) => handleVoice(runId, v);
    return () => {
      delete w.__nadiAppendVoice;
    };
  }, [activeRunId, artifact, handleVoice]);

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
        if (ptA && !ptB && coord) {
          // V2.6d: an empty-map click mid-draw adds a BEND — validated incrementally with the
          // server's own sentences (too-close / out-of-bbox / crossing / over-cap clicks are
          // refused as the drawHint; the POST 400 stays the backstop for API callers).
          const bbox = (artifact?.meta.bbox as Bbox | undefined) ?? null;
          const reason = viaClickReason([[ptA.lon, ptA.lat], ...vias], coord, bbox);
          if (reason) setDrawHint(reason);
          else {
            setVias((v) => [...v, coord]);
            setDrawHint(null);
          }
        } else if (ptA) setDrawHint('Click nearer a junction.');
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
        // V2.6d: the CLOSING segment (last bend -> B) is validated here too — this branch also
        // REPLACES ptB mid-form, so a crossing/short close is caught on both paths.
        const closeReason = viaCloseReason([[ptA.lon, ptA.lat], ...vias], [j.lon, j.lat]);
        if (closeReason) {
          setDrawHint(closeReason);
          return;
        }
        setDrawHint(null);
        setPtB(j);
      } else {
        setDrawHint('Pick a different junction for the end point.');
      }
    },
    [ptA, ptB, vias, artifact, junctions, mergeEdge, zoneMode],
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

  // V2.4a — the DRAFT BASKET: apply ADDS a member (session-only React state); one Run button
  // submits the whole draft. The member's `change` is the EXACT wire object the palette callbacks
  // always built — runDraft submits these references untouched (the single-change regression pin).
  const [draft, setDraft] = useState<DraftMember[]>([]);
  const [hoveredDraftId, setHoveredDraftId] = useState<string | null>(null); // DraftPanel row hover → overlay highlight
  const [draftError, setDraftError] = useState<string | null>(null); // Run failures, verbatim (400/409)
  const draftSeq = useRef(0); // monotonic member ids ('d1', …) — incremented in event handlers only (StrictMode-safe)
  const draftRef = useRef<DraftMember[]>([]);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const addToDraft = useCallback((change: SimChange, extra?: Pick<DraftMember, 'origin' | 'path'>) => {
    // mint the id OUTSIDE the updater — StrictMode double-invokes updaters, and an impure
    // ++ref inside one skips every other id (d2, d4, …)
    const id = `d${++draftSeq.current}`;
    setDraft((d) => [...d, { id, change, valid: true, ...extra }]);
    setDraftError(null);
    // close the contributing tool — the same clears the old submit-on-apply did on success
    setPtA(null);
    setPtB(null);
    setVias([]);
    setHoverCoord(null);
    setDrawHint(null);
    setSelectedEdge(null);
  }, []);

  const onDraftRemove = useCallback((id: string) => {
    setDraft((d) => d.filter((m) => m.id !== id));
    setHoveredDraftId((cur) => (cur === id ? null : cur));
    setDraftError(null); // a stale 400 must not describe a draft that no longer exists
  }, []);

  // Run the draft → ONE POST. Wire rule: a zone-macro tag forces the composite path (the server
  // only reads tags there); else 1 member → today's EXACT single shape via postSimulate; N members
  // → changes[]. V2.2c belt-and-braces under the UI lock: a windowed draft ships day_one — the
  // server 400 with the shared D1 reason stays the visible backstop. V2.4b: mixed member types run
  // for real (the four windowable types); settled composites still 400 — rendered verbatim.
  const runDraft = useCallback(async () => {
    const members = draftRef.current;
    if (members.length === 0) return;
    const changes = members.map((m) => m.change);
    setSubmitting(true);
    setDraftError(null);
    const windowed = hasWindowedMember(changes);
    const opts = windowed ? { ...runOptionsRef.current, assignment: 'day_one' as const } : runOptionsRef.current;
    const tags = members.some((m) => m.origin === 'zone') ? ['school_zone'] : undefined;
    const res =
      tags || changes.length > 1
        ? await postSimulateComposite(changes, tags, opts)
        : await postSimulate(changes[0], opts);
    setSubmitting(false);
    if (!res.ok) {
      setDraftError(res.error); // the backend's words verbatim (409 lock / 400 reasons) — draft retained
      return;
    }
    setActiveRunId(res.value.run_id); // run card polls this; loadRun fires on the done edge
    setDraft([]);
    setHoveredDraftId(null);
  }, []);

  const onSubmitDraw = useCallback(
    (p: DrawParams) => {
      if (!ptA || !ptB) return;
      addToDraft(
        {
          type: 'new_road',
          from_junction: ptA.id,
          to_junction: ptB.id,
          lanes: p.lanes,
          speed_mps: p.speed_mps,
          bidirectional: p.bidirectional,
          // V2.6d: bends ride the wire as 'lon,lat' coord-pair strings (6-dp, the coordinate
          // convention); a straight road omits via — the single-change wire pin stays byte-equal
          ...(vias.length ? { via: vias.map(([lo, la]) => `${lo.toFixed(6)},${la.toFixed(6)}`) } : {}),
          description: `New road ${ptA.id}->${ptB.id}`,
        },
        // a minted road is absent from the canonical net — capture its overlay geometry now
        { path: [[ptA.lon, ptA.lat], ...vias, [ptB.lon, ptB.lat]] },
      );
    },
    [ptA, ptB, vias, addToDraft],
  );

  const onEdgeSpeed = useCallback(
    (valueMps: number) => {
      if (!selectedEdge) return;
      addToDraft({ type: 'speed_limit', target_edge: selectedEdge.id, value_mps: valueMps,
        description: `Speed limit on ${selectedEdge.id} -> ${valueMps} m/s` });
    },
    [selectedEdge, addToDraft],
  );

  const onEdgeBike = useCallback(() => {
    if (!selectedEdge) return;
    addToDraft({ type: 'bike_lane', target_edge: selectedEdge.id, description: `Bike lane on ${selectedEdge.id}` });
  }, [selectedEdge, addToDraft]);

  // V2.2c — temporary events. NO client description: the server composes the canonical
  // clock-time description (fmt_window; single source with the report/chips).
  const [draftWindowed, setDraftWindowed] = useState(false);
  const onEdgeLaneClosure = useCallback(
    (lanes: number[], window: ChangeWindow | null) => {
      if (!selectedEdge) return;
      addToDraft({ type: 'lane_closure', target_edge: selectedEdge.id, target_lanes: lanes,
        ...(window ? { window } : {}) });
    },
    [selectedEdge, addToDraft],
  );
  const onEdgeRoadClosure = useCallback(
    (window: ChangeWindow | null) => {
      if (!selectedEdge) return;
      addToDraft({ type: 'road_closure', target_edge: selectedEdge.id, ...(window ? { window } : {}) });
    },
    [selectedEdge, addToDraft],
  );
  const onEdgeIncident = useCallback(
    (p: { lanes: number[]; speedFactor: number | null; window: ChangeWindow }) => {
      if (!selectedEdge) return;
      addToDraft({
        type: 'incident', target_edge: selectedEdge.id, window: p.window,
        effect: { ...(p.lanes.length ? { blocked: true } : {}),
                  ...(p.speedFactor != null ? { speed_factor: p.speedFactor } : {}) },
        ...(p.lanes.length ? { target_lanes: p.lanes } : {}),
      });
    },
    [selectedEdge, addToDraft],
  );

  // V2.4a — the draft's derived truths. `draftWindowed` stays the LIVE palette signal (its unmount
  // cleanup clears only the palette's contribution); the members-derived term holds the D1 lock
  // independently, so adding a windowed member keeps the lock after the palette closes.
  const draftChanges = useMemo(() => draft.map((m) => m.change), [draft]);
  const draftTags = useMemo(
    () => (draft.some((m) => m.origin === 'zone') ? ['school_zone'] : []),
    [draft], // derived, never stored — removing every zone member honestly drops the tag
  );
  const draftHasWindowed = useMemo(() => hasWindowedMember(draftChanges), [draftChanges]);
  const windowLocked = draftWindowed || draftHasWindowed;
  // Blockers over the EFFECTIVE assignment (post-lock): D2's stable predicate set only — the
  // shared reason strings verbatim, never client phrasing (web/lib/draftBlockers.ts).
  const draftBlockers = useMemo(
    () => deriveBlockers(draftChanges, windowLocked ? 'day_one' : (runOptions.assignment ?? 'day_one'), eligById),
    [draftChanges, windowLocked, runOptions.assignment, eligById],
  );
  // While the draft (or an open palette) is windowed, force assignment to day_one (the toggle is
  // disabled with the D1 reason in the options block).
  useEffect(() => {
    if (windowLocked && runOptionsRef.current.assignment === 'settled') {
      setRunOptions((o) => ({ ...o, assignment: 'day_one' }));
    }
  }, [windowLocked]);

  // V2.4a — the zone flow is a MACRO over the basket: apply adds N windowed speed_limit members
  // tagged by origin (the derived school_zone tag rides the draft), no POST until Run.
  const onZoneSubmit = useCallback(
    (valueMps: number, window: ChangeWindow) => {
      if (zoneEdges.length === 0) return;
      const base = draftSeq.current;
      draftSeq.current += zoneEdges.length;
      const members: DraftMember[] = zoneEdges.map((id, i) => ({
        id: `d${base + i + 1}`,
        change: { type: 'speed_limit', target_edge: id, value_mps: valueMps, window },
        valid: true,
        origin: 'zone',
      }));
      setDraft((d) => [...d, ...members]);
      setDraftError(null);
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
    setDraftError(null);
  }, []);
  const onZoneCancel = useCallback(() => {
    setZoneMode(false);
    setZoneEdges([]);
    setDraftError(null);
  }, []);
  const onZoneRemove = useCallback((id: string) => {
    setZoneEdges((cur) => cur.filter((e) => e !== id));
  }, []);

  const resetDraw = useCallback(() => {
    setPtA(null);
    setPtB(null);
    setVias([]);
    setHoverCoord(null);
    setDrawHint(null);
    setDraftError(null);
    setSelectedEdge(null);
  }, []);

  // V2.6d — the app's first keyboard surface, mounted only mid-draw: Escape pops the last bend;
  // with none left it cancels the draw (the visible undo-bend button mirrors the pop for
  // discoverability, the zone-remove idiom).
  const onUndoBend = useCallback(() => {
    setVias((v) => v.slice(0, -1));
    setDrawHint(null);
  }, []);
  useEffect(() => {
    if (!(stage === 'build' && activeRunId == null && ptA && !ptB)) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (vias.length > 0) onUndoBend();
      else resetDraw();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage, activeRunId, ptA, ptB, vias, onUndoBend, resetDraw]);

  const drawAnother = useCallback(() => {
    setActiveRunId(null);
    resetDraw();
  }, [resetDraw]);

  // V2.4c — clone a finished run's changes into a FRESH draft (D4: iterate by adjusting the run
  // that almost worked; REPLACE, never merge; name/note are never copied — a new scenario earns
  // its own). Members come from run-state (single-change runs carry only `change`); origin:'zone'
  // reconstructs the school_zone tag through runDraft's existing derivation — without it a cloned
  // zone run would silently drop the tag (description branch + zone lens). Disclosed limits:
  // cloned new_road members get no draft overlay (the path is captured at ADD time only), and a
  // new_road inside a multi-member draft 400s verbatim on Run (the existing convention).
  const cloneToDraft = useCallback(
    // structural subset: RunCard's RunStatus AND a V2.7a run-list row both satisfy it
    (st: {
      changes?: RunStatus['changes'] | null;
      change?: RunStatus['change'] | null;
      tags?: string[] | null;
      demand_profile?: string | null;
      assignment?: string | null;
      n_seeds?: number | null;
    }) => {
      const changes = (st.changes ?? (st.change ? [st.change] : [])) as SimChange[];
      if (changes.length === 0) return;
      const zone = st.tags?.includes('school_zone') ?? false;
      const base = draftSeq.current; // bulk mint OUTSIDE setState (StrictMode-safe, the zone-macro idiom)
      draftSeq.current += changes.length;
      setDraft(
        changes.map((c, i) => ({
          id: `d${base + i + 1}`,
          change: c,
          valid: true,
          ...(zone ? { origin: 'zone' as const } : {}),
        })),
      );
      setHoveredDraftId(null);
      setDraftError(null);
      setRunOptions({
        ...(st.demand_profile ? { demand_profile: st.demand_profile as RunOptions['demand_profile'] } : {}),
        ...(st.assignment ? { assignment: st.assignment as RunOptions['assignment'] } : {}),
        ...(st.n_seeds ? { n_seeds: st.n_seeds as RunOptions['n_seeds'] } : {}),
      });
      setActiveRunId(null); // the DraftPanel is gated on !activeRunId — without this the clone is invisible
      resetDraw();
    },
    [resetDraw],
  );

  // Test seam (Playwright): inject a map click / hover at [lon,lat] so the real snap→preview→form→submit path
  // runs without fighting the WebGL canvas hit-test. Present only while in edit mode; inert in production.
  useEffect(() => {
    if (stage !== 'build') return;
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
  }, [stage, onEditClick, onEditHover, networkLookup]);

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
    const playbackNow = stage === 'watch';
    // V2.7b C8b: during Act I the loaded run's change is SUPPRESSED on the map (it belongs to a
    // different run) and the computing run's member is drawn as the ghost instead — the seam
    // mirrors both, so it never claims an overlay that isn't there.
    const items =
      !watchedRunNotLoaded && changeGeom && artifact && changeGeom.runId === artifact.meta.run_id ? changeGeom.items : [];
    (window as unknown as { __nadiChangeOverlay?: unknown }).__nadiChangeOverlay = {
      count: items.length,
      ghost: watchedRunNotLoaded && ghostGeom?.runId === activeRunId ? ghostGeom.items.length : 0,
      // V2.2d: the zone designation flag (the tint is ALWAYS shown for tagged runs; items' active
      // flags carry the time-truth for the speed members themselves).
      zoneTagged: !!artifact?.meta.scenario?.tags?.includes('school_zone'),
      items: items.map((d) => ({
        type: d.type,
        windowed: !!d.window,
        active: !d.window || !playbackNow || (currentTime >= d.window.start_s && currentTime <= d.window.end_s),
        // V2.6d: the rendered polyline's vertex count (a curved new_road = 2 + via points)
        vertices: d.path.length,
      })),
    };
  }, [changeGeom, artifact, currentTime, stage, socialIds, watchedRunNotLoaded, ghostGeom, activeRunId]);
  // (No __nadiSeek seam: a raw setState seek loses races against the Timeline's rAF loop —
  // specs scrub the Timeline slider instead, the app's own pause-and-seek path.)

  // V2.4a test seam — a SIBLING of __nadiChangeOverlay (whose count semantics stay untouched):
  // mirrors the DRAFT members + the hovered row so specs assert basket state without pixel reads.
  useEffect(() => {
    (window as unknown as { __nadiDraftOverlay?: unknown }).__nadiDraftOverlay = {
      count: draft.length,
      zoneTagged: draftTags.includes('school_zone'),
      hoveredId: hoveredDraftId,
      items: draft.map((m) => ({
        id: m.id,
        type: m.change.type,
        windowed: memberWindow(m.change) !== null,
        // V2.6d: the captured overlay polyline's vertex count (a curved new_road member = 2 + bends)
        vertices: m.path?.length ?? null,
      })),
    };
  }, [draft, draftTags, hoveredDraftId]);

  // The caption's sim-time, QUANTIZED to whole sim-seconds. Act I's panels must not re-render on
  // the rAF tick — the map owns that budget — so RunExperience is memo'd and this is the only prop
  // that moves during playback: it changes once per displayed second instead of ~70×/s. A timer
  // would have been the other way to throttle it; quantizing keeps the clock exactly truthful
  // (it is the playback clock, floored) and adds no interval to clean up.
  const captionTime = Math.floor(currentTime);
  // Stable, or the memo above can never bail.
  const goRead = useCallback(() => setStage('read'), []);

  // Shown once per run: the held moment is a MOMENT, not a gate, so re-interrupting on every
  // reload mid-Act-II would make it a nuisance.
  const [heldSeen, markHeldSeen] = useHeldMomentSeen(activeRunId);

  if (!artifact) {
    return loadError ? (
      <div style={loading} data-testid="artifact-load-error">
        couldn&apos;t load the scenario artifact ({loadError}) — if you&apos;re running locally,
        complete a run or open a ?run=&lt;id&gt; link.
      </div>
    ) : (
      <div style={loading}>Loading scenario…</div>
    );
  }

  const { meta } = artifact;
  const [minLon, minLat, maxLon, maxLat] = meta.bbox;
  const t = currentTime;

  // 1) Faint trails for the instrumented VEHICLE travelers (keeps the current look; ped trails
  // omitted). Data = the STABLE memoized array (hoisted above the early return, V2.5c).
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
  const backgroundVehicleDots = new ScatterplotLayer<Materialized<Vehicle>>({
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
  const backgroundPersonDots = new ScatterplotLayer<Materialized<Person>>({
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

  // V2.4a — the DRAFT overlay: basket members rendered on the map before any run exists. Zero
  // fetches by construction — a member's target_edge resolves through the already-loaded network
  // map; a new_road member carries its two junction coords captured at add time. Always active
  // (edit mode has no playback clock); a hovered DraftPanel row highlights its member here.
  type DraftOverlayItem = { id: string; type: string; path: LonLat[] };
  const draftOverlayItems: DraftOverlayItem[] = draft.flatMap((m) => {
    const path =
      m.path ??
      ('target_edge' in m.change && m.change.target_edge ? networkLookup[m.change.target_edge]?.geometry : undefined);
    return path ? [{ id: m.id, type: m.change.type, path }] : [];
  });
  const draftOverlay = new PathLayer<DraftOverlayItem>({
    id: 'draft-overlay',
    data: draftOverlayItems,
    getPath: (d) => d.path,
    getColor: (d) =>
      d.id === hoveredDraftId
        ? [40, 45, 55, 250] // hovered row → dark slate (the ROAD_CASING family) — a WHITE highlight
        : // vanishes into the near-white positron basemap (review-caught via screenshot; seams can't see it)
          (CAP_DASH_COLOR[d.type] ??
          (d.type === 'new_road' ? [20, 200, 170, 235] : [245, 170, 40, 230])), // teal minted road / amber edit
    getWidth: (d) => (d.id === hoveredDraftId ? 9 : 6),
    widthUnits: 'pixels',
    capRounded: true,
    jointRounded: true,
    // deck caches accessor results — without these triggers the hover highlight silently sticks
    updateTriggers: { getColor: [hoveredDraftId], getWidth: [hoveredDraftId] },
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
  // V2.6d: the working line BENDS at via points — a PathLayer over [A, ...bends, rubber-band tip]
  // (the same orange idiom; the V2.7 grey/striping restyle is explicitly deferred).
  const previewTo: LonLat | null = ptB ? [ptB.lon, ptB.lat] : hoverCoord;
  const previewPath: LonLat[] = ptA
    ? [[ptA.lon, ptA.lat], ...vias, ...(previewTo ? [previewTo] : [])]
    : [];
  const drawPreview = new PathLayer<{ path: LonLat[] }>({
    id: 'draw-preview',
    data: previewPath.length >= 2 ? [{ path: previewPath }] : [],
    getPath: (d) => d.path,
    getColor: [240, 130, 30, 230],
    getWidth: 3,
    widthUnits: 'pixels',
    jointRounded: true,
  });

  // V2.7a: the Explore SHEETS (compare / graphs / chat) occlude the map, so its chrome hides for
  // them; Explore·Discourse keeps the map visible behind the feed like the old discourse mode.
  // The old silent discourse→playback degrade is gone — a run with no social block renders the
  // LABELED discourse-empty state instead (the graphs precedent: enterable, honest, never dead).
  const sheetMode = stage === 'explore' && exploreSub !== 'discourse';

  // 5.3 CHANGE-VISIBILITY overlay (persistent, ALL modes) — the loaded run's change LOCATION so rerouting cars
  // don't appear to drive through empty space. Derived from the artifact (via the geometry fetch), NOT draw-state.
  // v0.5.0: render EVERY change the scenario composes (per-change color by type). A single-change run is one path.
  // V2.2c: capacity changes (closures/incident) get per-type styling in their own layers; during PLAYBACK a
  // windowed change renders ONLY within its window (the map tells the truth in time — the conflict-pulses
  // pattern: CPU filter on t, arrays rebuilt per frame). Legacy types keep change-overlay pixel-identical.
  // V2.7b C8b: during Act I the loaded run's change is SUPPRESSED — it belongs to a run that is not
  // the one being simulated, and leaving it on the map while the caption talks about "your member"
  // would attribute a stranger's closure to the reader. The ghost below takes its place.
  const overlayItems = watchedRunNotLoaded
    ? []
    : changeGeom && changeGeom.runId === meta.run_id
      ? changeGeom.items
      : [];
  const isOverlayActive = (d: OverlayItem): boolean =>
    !d.window || stage !== 'watch' || (t >= d.window.start_s && t <= d.window.end_s);
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
  // V2.7b C8b — THE GHOST: the computing run's member, drawn as an outline that reads as inactive
  // because it IS inactive here. It applies to the scenario leg; what is playing is the baseline.
  // Its label lives in the DOM caption rather than a deck TextLayer on purpose — the sentence
  // carries an em-dash, which is outside deck's default characterSet (the V2.2c font-atlas trap).
  const ghostItems = watchedRunNotLoaded && ghostGeom?.runId === activeRunId ? ghostGeom.items : [];
  const ghostOverlay = new PathLayer<OverlayItem>({
    id: 'ghost-change',
    data: ghostItems,
    getPath: (d) => d.path,
    getColor: [70, 76, 92, 115], // translucent slate: present, plainly not in force
    getWidth: 9,
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
    ghostOverlay, // V2.7b: Act I only — the computing run's member, not in force in this playback
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
    ...(stage === 'build' ? [editEdges, draftOverlay, snapTargets, drawPreview] : []),
  ];
  const editing = stage === 'build';
  // Draw interactions are live only while actually drawing — NOT while a run card is shown (else background
  // map clicks would silently mutate ptA/ptB and the snap highlight). "Draw another" clears activeRunId.
  const drawing = editing && activeRunId == null;
  // Honesty flags for the active run's empty states (only trustworthy once its artifact is the one shown).
  const runLoaded = activeRunId != null && meta.run_id === activeRunId;
  const isExample = meta.run_id === EXAMPLE_RUN_ID;
  // the run-document panel is open in Read, and in Build for the example's read-only
  // composition view — the top-left map chrome hides under it either way (looked-at catch)
  const docPanelOpen = stage === 'read' || (stage === 'build' && isExample && !freshDraft);
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

      {/* Map chrome (header / sample note / change legend) belongs to the MAP — hidden while a
          full SHEET covers it (compare and the V2.3d graph split-view both occlude the map). */}
      {/* V2.7a: Read hides the top-left map chrome too — the run document IS the description
          there, and the floating header/legend collide with the panel. */}
      {/* V2.7b C8b: hidden during Act I — it names the LOADED run's change, and the caption two
          inches away is talking about a different one (the screenshot walk caught the collision). */}
      {!sheetMode && !docPanelOpen && !watchedRunNotLoaded && <ScenarioHeader scenario={meta.scenario} />}

      {/* V2.1b render-sample framing: a capped artifact ALWAYS says it renders a sample — the map showing
          fewer dots than the simulated population must never read as the population itself. */}
      {/* V2.7b C8b: `meta` is the loaded run's, so during Act I this would describe a sampling
          decision made for a different artifact than the one on the map. */}
      {!sheetMode && !watchedRunNotLoaded && meta.render_sample && (
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
      {!sheetMode && !docPanelOpen && !watchedRunNotLoaded && changeGeom?.runId === meta.run_id && (
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


      {editing && isExample && !freshDraft ? (
        <DocumentPanel
          title={`RUN DOCUMENT — ${meta.run_id.replace('multimodal-scenario-', '')}`}
          collapsed={docCollapsed}
          onToggle={setDocCollapsed}
          topOffset={78}
        >
          <ExampleBuildView
            changes={changesOf(artifact)}
            profile={meta.demand_profile}
            demoLocked={STATIC_DEMO}
            onStartDraft={() => {
              setFreshDraft(true);
              drawAnother();
            }}
          />
        </DocumentPanel>
      ) : editing ? (
        <EditPanel
          ptA={ptA}
          ptB={ptB}
          viaCount={vias.length}
          onUndoBend={onUndoBend}
          hint={drawHint}
          junctionsDown={junctionsDown}
          submitting={submitting}
          submitError={null} // V2.4a: applies ADD to the draft (no POST) — Run errors render in the DraftPanel
          onSubmit={onSubmitDraw}
          onReset={resetDraw}
          runOptions={runOptions}
          onRunOptions={setRunOptions}
          activeRunId={activeRunId}
          onDrawAnother={drawAnother}
          feed={runFeed}
          streamedVoices={streamedAgents}
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
          windowLocked={windowLocked}
          zoneMode={zoneMode}
          zoneEdges={zoneEdges}
          onZoneToggle={onZoneToggle}
          onZoneRemove={onZoneRemove}
          onZoneSubmit={onZoneSubmit}
          onZoneCancel={onZoneCancel}
          draftMembers={draft}
          draftTags={draftTags}
          draftBlockers={draftBlockers}
          draftError={draftError}
          onDraftRemove={onDraftRemove}
          onDraftRun={runDraft}
          onDraftHover={setHoveredDraftId}
          onClone={cloneToDraft}
        />
      ) : stage === 'watch' ? (
        actOne ? (
          // V2.7b C8b — ACT I. Watch's panels are HIDDEN rather than emptied while a run computes:
          // CommentFeed, the scorecard and the agent panels all describe the LOADED run, which is
          // not the run being watched. Showing another run's findings beside a header naming this
          // one is exactly the confusion the V2.7a vintage guard refuses in the document; it is
          // refused here too, by the same principle.
          <>
            <RunExperience
              experience={runFeed.experience}
              // the WATCHED run's profile (it rides run_start), not the loaded run's — Act I is
              // about the run computing, and only a calibrated profile has a clock to anchor to
              demandProfile={runFeed.experience.demandProfile ?? undefined}
              playing={preview != null}
              simTime={captionTime}
              onReadResults={goRead}
            />
            <button
              style={pbToggle}
              data-testid="playback-bar-toggle"
              onClick={() => setPlaybackBarHidden((h) => !h)}
              title="hiding the bar pauses playback — the clock lives in the bar"
            >
              {playbackBarHidden ? 'show playback bar' : 'hide playback bar'}
            </button>
            {!playbackBarHidden && (
              <Timeline
                // the clock's DOMAIN is the previewed run's, not the loaded one's — a 2 h exemplar
                // loaded while a 30 min run computes would otherwise scrub against the wrong scale
                simStart={preview?.meta.sim_start ?? meta.sim_start}
                simEnd={preview?.meta.sim_end ?? meta.sim_end}
                currentTime={t}
                onSeek={setCurrentTime}
                // the readout counts what is ACTUALLY on the map: the baseline leg, or nothing
                vehicleCount={preview?.vehicles.length ?? 0}
              />
            )}
          </>
        ) : (
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
            onInterview={setInterviewee}
            institutions={institutionAgents}
            institutionsEmpty={institutionsEmpty}
            onInstitution={setInstitution}
            selectedId={selected ? agentId(selected) : null}
            onAddToRoom={addToRoom}
          />
          <div style={rightRail}>
            <ScorecardPanel
              scorecard={artifact.scorecard}
              activeGroup={feedGroup}
              onSelectGroup={(g) => setFeedGroup((cur) => (cur === g ? null : g))}
              demandProfile={meta.demand_profile}
              scope={windowedScope(changesOf(artifact), meta.sim_end)}
            />
            <AgentPanel
              agent={selected}
              onClose={() => setSelected(null)}
              onInterview={setInterviewee}
              onAddToRoom={addToRoom}
            />
            <InstitutionPanel
              agent={institution}
              onClose={() => setInstitution(null)}
              onInterview={setInterviewee}
              onAddToRoom={addToRoom}
            />
            {interviewee &&
              (() => {
                // Index-qualified identity: sibling INFERRED voices share a persona.id (the sampler
                // round-robins few personas over more records), so the agents[] index — not agentId
                // alone — keys the drawer remount, the transcript session, and the wire reference.
                const idx = artifact.agents?.indexOf(interviewee) ?? -1;
                const sessionKey = idx >= 0 ? `agent#${idx}` : agentId(interviewee);
                return (
                  <InterviewDrawer
                    key={sessionKey}
                    agent={interviewee}
                    agentIndex={idx}
                    runId={meta.run_id}
                    sessionKey={sessionKey}
                    messages={interviews[sessionKey] ?? []}
                    onMessages={onInterviewMsgs}
                    onClose={() => setInterviewee(null)}
                  />
                );
              })()}
            {roomOpen && (
              // V2.6b — the room: closing keeps pairs+thread (the session lives until loadRun);
              // any add re-opens it with the thread intact.
              <RoomDrawer
                pairs={roomPairs}
                messages={roomMsgs}
                round={roomRound}
                lastRoundCalls={roomLastRound}
                busy={roomRound?.status === 'thinking'}
                onAsk={askRoom}
                onRetry={retryRoom}
                onDismissRound={dismissRound}
                onRemove={removeFromRoom}
                onClose={() => setRoomOpen(false)}
              />
            )}
          </div>
          <ConflictLegend
            count={conflicts.length}
            activeCount={activeConflicts.length}
            showAll={showAllConflicts}
            onToggle={() => setShowAllConflicts((s) => !s)}
          />
          <button
            style={pbToggle}
            data-testid="playback-bar-toggle"
            onClick={() => setPlaybackBarHidden((h) => !h)}
            title="hiding the bar pauses playback — the clock lives in the bar"
          >
            {playbackBarHidden ? 'show playback bar' : 'hide playback bar'}
          </button>
          {!playbackBarHidden && (
            <Timeline
              simStart={meta.sim_start}
              simEnd={meta.sim_end}
              currentTime={t}
              onSeek={setCurrentTime}
              vehicleCount={artifact.vehicles.length}
            />
          )}
        </>
        )
      ) : stage === 'read' && actOne ? (
        // V2.7b C8b — the run being watched has no document yet, and the loaded run's document is
        // NOT a stand-in for it. A header naming one run above findings describing another is the
        // confusion the V2.7a vintage guard exists to refuse; refusing it here costs one labeled
        // state and buys the same guarantee. It is replaced by the real document seconds later,
        // when the facts-only report lands (which is why the wait is worth naming, not hiding).
        <DocumentPanel
          title={`RUN DOCUMENT — ${(activeRunId ?? '').replace('multimodal-scenario-', '')}`}
          collapsed={docCollapsed}
          onToggle={setDocCollapsed}
          topOffset={78}
        >
          {/* DocumentPanel already supplies .nadi-doc inside a .nadi-shell, so .btn resolves here */}
          <div style={notComputedWrap} data-testid="read-not-computed">
            <h6 style={notComputedKicker}>NOT COMPUTED YET</h6>
            <p style={notComputedBody}>
              This run’s physics is still running, so it has no document yet — and the run you were
              reading is a different run, so its findings are not shown here in its place.
            </p>
            <p style={notComputedBody}>
              The figures land the moment the simulation ends, before any model runs. Watch the run
              come in, or open another run from the run list.
            </p>
            <button className="btn btn-secondary" onClick={() => setStage('watch')}
                    data-testid="read-not-computed-watch">
              Watch this run
            </button>
          </div>
        </DocumentPanel>
      ) : stage === 'read' ? (
        // V2.7a interim Read: the report content inside the run-document panel (RunDocument
        // replaces it wholesale in C3; the panel frame + collapse strip are the keepers).
        <DocumentPanel
          title={`RUN DOCUMENT — ${meta.run_id.replace('multimodal-scenario-', '')}`}
          collapsed={docCollapsed}
          onToggle={setDocCollapsed}
          topOffset={78}
        >
          <RunDocument
            artifact={artifact}
            report={reportData?.runId === meta.run_id ? reportData.report : null}
            reportState={reportData?.runId === meta.run_id ? reportData.state : 'loading'}
            isExample={isExample}
            liveName={liveIdentity?.runId === meta.run_id ? liveIdentity.name : null}
            onGroupDoorway={(g) => {
              // the 2.4 doorway: this group's voices, in Watch (the existing scorecard→feed join)
              setFeedGroup(g);
              setStage('watch');
            }}
          />
        </DocumentPanel>
      ) : exploreSub === 'graphs' ? (
        // V2.3d — the two graphs, visibly two graphs (a full sheet; Timeline unmounted → rAF stops)
        <GraphSplitView
          graphs={graphsSidecar?.runId === meta.run_id ? graphsSidecar.data : null}
          loading={graphsSidecar?.runId === meta.run_id ? graphsSidecar.loading : true}
          error={graphsSidecar?.runId === meta.run_id ? graphsSidecar.error : false}
        />
      ) : exploreSub === 'compare' ? (
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
      ) : exploreSub === 'chat' ? (
        <ChatPanel />
      ) : hasSocial ? (
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
      ) : (
        // V2.7a — the labeled empty state REPLACES the old disabled 💬 toggle AND the silent
        // discourse→playback degrade: enterable, honest about why, names the recovery path
        // (the graphs-panel convention).
        <div style={discourseEmpty} data-testid="discourse-empty">
          No simulated discourse on this run yet — the discourse enrich hasn&apos;t run for it. Run it
          from the run card in the Build stage (voices, then discourse), or open a run that
          carries a discourse cascade.
        </div>
      )}

      <ShellHeader
        stage={stage}
        onStage={setStage}
        stageState={stageAvailability({
          hasArtifact: true, // past the early return — the artifact is loaded
          hasReport: reportData?.runId === meta.run_id && reportData.state === 'ready',
          // V2.7b: Read's ✓ lights when the FACTS-ONLY report lands, not when someone opens Read.
          // The report is fetched on entering the stage, so hasReport alone leaves the stage that
          // just became readable marked undone for as long as the reader stays in Watch.
          resultsReady: runFeed.experience.resultsReadyAt != null,
          hasSocial,
          hasGraphs: graphsSidecar?.runId === meta.run_id && !!graphsSidecar.data,
        })}
        exploreSub={exploreSub}
        onExploreSub={setExploreSub}
        // V2.7b C8b: during Act I every surface on screen is about the run being WATCHED — the map
        // plays its baseline leg, the beats are its beats, Read names it. The header naming the
        // still-loaded artifact instead put two different run ids on one screen (looked-at catch).
        runLabelText={(actOne ? activeRunId! : meta.run_id).replace('multimodal-scenario-', '')}
        buildLocked={STATIC_DEMO}
        onBuildYourOwn={() => {
          // "Build your own scenario" starts a FRESH draft (the watched run keeps computing
          // server-side and stays reopenable from the run list).
          setFreshDraft(true);
          setStage('build');
          drawAnother();
        }}
        runsOpen={runsOpen}
        onToggleRuns={() => setRunsOpen((o) => !o)}
      />
      {runsOpen && (
        <RunListPopover
          currentRunId={activeRunId}
          exampleLoaded={isExample}
          onOpen={(id, computing) => {
            setRunsOpen(false);
            if (computing) {
              // "a computing run opens in its current state" — the Build stage's watcher card
              setActiveRunId(id);
              setFreshDraft(false);
              setStage('build');
            } else {
              void loadRun(id);
              setStage('read'); // the document is the anchor surface for a finished run
            }
          }}
          onClone={(r) => {
            setRunsOpen(false);
            cloneToDraft(r);
            setFreshDraft(true);
            setStage('build');
          }}
          onCloneExample={() => {
            // the example's members come from the LOADED artifact (it has no local run-state)
            setRunsOpen(false);
            cloneToDraft({
              changes: changesOf(artifact) as unknown as RunStatus['changes'],
              tags: meta.scenario?.tags ?? undefined,
              demand_profile: meta.demand_profile,
              assignment: meta.assignment?.mode,
            });
            setFreshDraft(true);
            setStage('build');
          }}
          onCompareA={(id) => {
            setRunsOpen(false);
            pickCompareA(id);
            setStage('explore');
            setExploreSub('compare');
          }}
          onCompareB={(id) => {
            setRunsOpen(false);
            pickCompareB(id);
            setStage('explore');
            setExploreSub('compare');
          }}
          onNewDraft={() => {
            setRunsOpen(false);
            setFreshDraft(true);
            setStage('build');
            drawAnother();
          }}
          onClose={() => setRunsOpen(false)}
        />
      )}

      {/* V2.7b C8b — THE HELD MOMENT. Opens once the physics is done and the run's own artifact has
          loaded (so `meta` is this run's), and is deliberately NOT stage-gated: it is the one
          interruption the design ratified, and it should find the reader wherever they are. It can
          never appear for a finished run opened from the list — beats arrive only on the event
          stream, and a terminal run opens no stream. */}
      {!actOne && !heldSeen && runFeed.experience.runId === meta.run_id && (
        <HeldMoment
          experience={runFeed.experience}
          onDismiss={markHeldSeen}
          onReadResults={() => {
            markHeldSeen();
            setStage('read');
          }}
        />
      )}
    </div>
  );
}

// 5.3 change-visibility legend / offline note — top-left, beside the Report button.
const changeLegend: React.CSSProperties = {
  position: 'absolute',
  top: 68, // below the 54px shell header
  left: 16,
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

// Mode toggle (Playback ⇄ Discourse ⇄ Edit) — top center, always shown. Discourse is disabled until a run
// carries a social{} block; Edit is always available (draw a road / run the job runner).

// Top-right rail: scorecard stacked ABOVE the agent panel. Pointer-transparent so map clicks pass
// through the gaps; each child card re-enables pointer events on itself.
// V2.7b C8b — Read's not-computed-yet state (inside DocumentPanel, so .nadi-doc typography applies)
const notComputedWrap: React.CSSProperties = { maxWidth: 620 };
const notComputedKicker: React.CSSProperties = {
  fontFamily: 'var(--font-heading)', fontSize: 12, letterSpacing: '.1em',
  color: 'var(--color-neutral-600)', margin: '0 0 var(--space-3)',
};
const notComputedBody: React.CSSProperties = { fontSize: 14, lineHeight: 1.65, marginBottom: 'var(--space-3)' };

const pbToggle: React.CSSProperties = {
  position: 'absolute',
  bottom: 88, // beside (left of) the conflict legend, above the bar
  right: 270,
  zIndex: 21,
  border: '1px solid #d7dbe0',
  background: 'rgba(255,255,255,0.92)',
  borderRadius: 6,
  padding: '3px 9px',
  fontSize: 11,
  color: '#5d6470',
  cursor: 'pointer',
};
const discourseEmpty: React.CSSProperties = {
  position: 'absolute',
  top: 130,
  left: '50%',
  transform: 'translateX(-50%)',
  maxWidth: 460,
  background: 'rgba(255,255,255,0.97)',
  border: '1px solid #d7dbe0',
  borderRadius: 10,
  boxShadow: '0 2px 10px rgba(0,0,0,0.14)',
  padding: '14px 18px',
  fontSize: 13.5,
  lineHeight: 1.6,
  color: '#374151',
  zIndex: 20,
};
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
