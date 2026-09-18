'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, { useControl, type MapRef } from 'react-map-gl/maplibre';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { PathStyleExtension } from '@deck.gl/extensions';
import { fmtSimTime, fmtWindowRange } from '@/lib/simTime';
import { ARTIFACT_CACHE, EXAMPLE_RUN_ID, STATIC_DEMO } from '@/lib/demo';
import { TripsLayer } from '@deck.gl/geo-layers';
import { ScatterplotLayer, PathLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { Agent, ChangeType, Conflict, LonLat, MandateAgent, Person, PinnedSimAgent, TrajectoryArtifact, Vehicle } from '@/lib/types';
import { changesOf, isMandateAgent, MANDATE_VERSIONS } from '@/lib/types';
import { loadNetwork, type NetworkEdge } from '@/lib/network';
import { buildRoadLayers, describeLayers, quantizeZoom, zoomBand, type ZoomBand } from '@/lib/roadLayers';
import { LANE_M, chevronAnchors, chevronSizePx, deriveRoadRows, laneModel, metersPerPixel, newRoadRows, offsetPolyline, type ChevronAnchor } from '@/lib/roadGeometry';
import {
  BASEMAP, BIKE_BAND, CAP_CASING, CAP_DASH, CAP_DASH_COLOR, CENTERLINE, CHEVRON, CONFLICT_DOT, CONFLICT_PULSE, DRAFT_HOVER,
  EDIT_OVERLAY, EDIT_TINT_NEUTRAL, GHOST_CASING, GHOST_CORE, ROADWAY, TRAIL, TRAVELER, TRAVELER_RIM, ZONE, ZONE_TINT, css,
} from '@/lib/mapPalette';

// ONE dash extension instance for every dashed overlay layer (a `new PathStyleExtension` per render
// was a per-rAF-tick allocation; the road layers hold their own in roadLayers.ts).
const DASH_EXT = new PathStyleExtension({ dash: true });
import { isSimPersonAgent, isSimVehicleAgent } from '@/lib/types';
import { DEFAULT_DRAW_PARAMS, EditPanel, type DrawParams } from '@/components/EditPanel';
import { type DraftMember } from '@/components/DraftPanel';
import { deriveBlockerCards, hasWindowedMember, memberWindow } from '@/lib/draftBlockers';
import { getJunctions, getEdges, getRuns, postSkip, postResume, postSimulate, postSimulateComposite, postGroupInterview, type ChangeWindow, type GroupTurnWire, type InterviewMsg, type Junction, type Edge, type EdgeEligibility, type SimChange, type RunOptions, type RunStatus } from '@/lib/api';
import type { VoiceEvent } from '@/lib/runStream';
import { useRunFeed } from '@/lib/useRunFeed';
import { InterviewDrawer } from '@/components/InterviewDrawer';
import { RoomDrawer, type RoomMsg, type RoomPair, type RoomRound } from '@/components/RoomDrawer';
import { ROOM_MAX, roomSeed, seedNote } from '@/lib/groupEvidence';
import { GROUP_LABEL } from '@/lib/personaGroups';
import { GraphSplitView } from '@/components/GraphSplitView';
import type { GraphsSidecar } from '@/lib/graphLayers';
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
import { ActTwo } from '@/components/run/ActTwo';
import type { DropKind } from '@/components/DropForm';
import type { ArmKind } from '@/components/EditPanel';
import { betweenLine, buildNodeIndex, crossStreets } from '@/lib/streetNames';
import { WatchArticle } from '@/components/run/WatchArticle';
import { DiscourseStage } from '@/components/run/DiscourseStage';
import { ReportStage } from '@/components/run/ReportStage';
import { chainState } from '@/lib/runFeed';
import { mergeSlots } from '@/lib/mergeSlots';
import { reportRunId, reportUrl, type PerRunReport } from '@/lib/reportData';
import { ConflictLegend } from '@/components/ConflictLegend';
import { CompareView } from '@/components/CompareView';
import { loadCompareSide, slimFromArtifact, type CompareSide } from '@/lib/compare';
import { activeAt, agentId, materializeTimestamps, nearestWithin, positionAt, positionAtCached, segmentAt, sentimentColor, type Materialized } from '@/lib/viz';
import { ICON_MAPPING, ICON_SIZE_M, modeAtlasUrl, type TravelerMode } from '@/lib/modeIcons';
import { IconLayer } from '@deck.gl/layers';

// The icons band's DATA SWAP: a hidden per-frame layer still regenerates its attributes every tick,
// so the dot and icon layer families exchange DATA (this constant vs the active arrays), never `visible`.
const EMPTY: never[] = [];
import { parseVia, viaClickReason, viaCloseReason, type Bbox } from '@/lib/viaRules';
import { agentLookup, cascadeById, cascadeIds, reachForCascade, trajectoriesForCascade } from '@/lib/social';

// Token-free CARTO positron style (no API key). V2.0b: the NO-LABELS variant — the exported network is now the
// road layer, so the basemap is demoted to context (green/water/buildings) with no competing street labels.
const POSITRON = 'https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json';

// Base road rendering: colours/widths live in web/lib/mapPalette.ts, the layers in web/lib/roadLayers.ts (V2.7c).

// The default-run POINTER (V2.5c): latest.json is {"run_id": "<id>"} — never a payload — written
// ONLY on quant-run completion (enriches never repoint the default). The mount effect resolves it
// then fetches /<run_id>.json.
const ARTIFACT_URL = '/latest.json';
// V2.7a — the returning user's last-viewed run (client-side only; loadRun + the mount commit
// both write it; the persisted id restores ONLY the run pointer — never session state).
const LAST_RUN_KEY = 'nadi:lastRun';
// V2.7b F3 — the run the reader is currently WATCHING (distinct from the last run they VIEWED: a
// computing run has no artifact to view). Written whenever the feed follows a run, read once by the
// landing so a reload restores THAT run rather than whichever run happens to be going.
const WATCHED_RUN_KEY = 'nadi:watchedRun';

// V2.7b C11 — how much of the stage the playback bar owns, so a left-anchored document panel does
// not sit over its controls. Measured from the rendered bar (56 px) plus the 20 px gutter every
// other floating surface uses.
const PLAYBACK_BAR_CLEARANCE = 76;

const PULSE_WINDOW = 25; // sim seconds around trigger_t during which an instrumented dot swells
const CONFLICT_FADE_S = 10; // a near-miss pulse fades over ~this many sim-seconds, then rests as a dot

// V2.2c — one change-overlay entry per change; capacity types carry their window/lanes/effect so
// the overlay styles per type and tells the truth in TIME during playback.
type OverlayItem = {
  path: LonLat[];
  type: ChangeType;
  /** The canonical edge the change targets (V2.7c: the bike band derives its lane offset from it). */
  edge?: string;
  /** A new_road's lane count (V2.7c C5: the drawn road's body width derives from it). */
  lanes?: number | null;
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
  lanes?: number | null;
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
      edge: change.target_edge,
      lanes: change.lanes ?? null,
      window: change.window ?? null,
      target_lanes: change.target_lanes ?? null,
      effect: change.effect ?? null,
    });
  }
  return { items, error };
}

const CAPACITY_TYPES: ReadonlySet<string> = new Set(['lane_closure', 'road_closure', 'incident']);
// (the per-type overlay colours/dashes live in web/lib/mapPalette.ts since V2.7c — the legend reads them too)
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
  /** V2.7c C4: the entity's mode, captured at join time (the icons band draws it as a glyph). */
  mode: TravelerMode;
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
  overlayRef,
}: {
  layers: Layer[];
  getTooltip: (info: PickingInfo) => { html: string; style?: Record<string, string> } | null;
  onClick?: (info: PickingInfo) => void;
  onHover?: (info: PickingInfo) => void;
  getCursor?: (state: { isDragging: boolean; isHovering: boolean }) => string;
  /** V2.7d C5: the overlay instance, exposed so a tile DROP can `pickObject` the road under the pointer. */
  overlayRef?: React.MutableRefObject<MapboxOverlay | null>;
}) {
  const overlay = useControl(() => new MapboxOverlay({ interleaved: false }));
  useEffect(() => {
    if (overlayRef) overlayRef.current = overlay;
  }, [overlay, overlayRef]);
  // getCursor is NEVER undefined (would crash deck's per-frame _updateCursor); onClick/onHover may be (deck null-checks).
  overlay.setProps({ layers, getTooltip, onClick, onHover, getCursor: getCursor ?? DEFAULT_CURSOR });
  return null;
}

/** V2.7d C5 — a DOM element anchored to a lon/lat through the map's own projection. Subscribes to
 *  the map's `move` with ITS OWN state, so MapView never re-renders per pan frame. */
function MapAnchored({ mapRef, at, children, testid }: {
  mapRef: React.RefObject<MapRef | null>; at: LonLat; children: React.ReactNode; testid?: string;
}) {
  const [px, setPx] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const update = () => {
      const p = map.project(at);
      setPx({ x: p.x, y: p.y });
    };
    update();
    map.on('move', update);
    return () => {
      map.off('move', update);
    };
  }, [mapRef, at]);
  if (!px) return null;
  return (
    <div style={{ position: 'absolute', left: px.x, top: px.y, transform: 'translate(-50%, -50%)', pointerEvents: 'none', zIndex: 3 }}
         data-testid={testid}>
      {children}
    </div>
  );
}

const PIN_GLYPH: Record<string, string> = {
  road_closure: '⛔', lane_closure: '⚠', speed_limit: '40', incident: '!', bike_lane: '🚲', new_road: '＋',
};

/** The tile icons pinned where each dropped member landed (the ratified "confirming … pins this icon at
 *  the drop point"). Members added by click or clone carry no `at` and get no pin. */
function DraftPins({ mapRef, members }: { mapRef: React.RefObject<MapRef | null>; members: DraftMember[] }) {
  return (
    <>
      {members.filter((m) => m.at).map((m) => (
        <MapAnchored key={m.id} mapRef={mapRef} at={m.at!} testid={`draft-pin-${m.id}`}>
          <div style={pinStyle} title={m.change.type.replace(/_/g, ' ')}>{PIN_GLYPH[m.change.type] ?? '•'}</div>
        </MapAnchored>
      ))}
    </>
  );
}
const pinStyle: React.CSSProperties = {
  width: 22, height: 22, borderRadius: 4, background: '#1d1f20', color: '#f2f2f3', fontSize: 11, fontWeight: 700,
  display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
};

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
  // V2.7e C2 — the note a document-seeded room carries ("seeded 3 from A, 2 from B — …"); null for
  // a room the reader assembled by hand. Cleared with the rest of the session.
  const [roomSeededFrom, setRoomSeededFrom] = useState<string | null>(null);
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
  const [watchDocCollapsed, setWatchDocCollapsed] = useState(true); // opt-in: the map is Watch's point
  const [playbackBarHidden, setPlaybackBarHidden] = useState(false); // Watch: the bar is toggleable, shown by default
  const [cascadeId, setCascadeId] = useState<string | null>(null); // selected cascade in discourse mode
  // --- edit mode (5.2): draw-a-road + job runner ---
  const [junctions, setJunctions] = useState<Junction[]>([]); // snap targets in the viewport
  const [junctionsDown, setJunctionsDown] = useState(false); // backend unreachable while loading snap targets
  // V2.0b: edit-an-edge is now a STYLING STATE of the network layer — eligibility metadata joined by id (the
  // whole net, fetched once), not a per-viewport geometry fetch. selectedEdge is the MERGED edge the palette reads.
  const [eligById, setEligById] = useState<Record<string, EdgeEligibility>>({});
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null); // the edge whose palette is open
  // V2.7d C4a: the kind that arrived WITH the selected edge (a tile drop / the seam's second argument);
  // null = the road card. Cleared with the selection.
  const [dropKind, setDropKind] = useState<DropKind | null>(null);
  // V2.7d C4b: the tile currently ARMED — the next road click carries it into the drop form.
  const [armedKind, setArmedKind] = useState<ArmKind | null>(null);
  const [zoom, setZoom] = useState(12); // tracked map zoom (edge layer is gated on EDGE_ZOOM)
  // V2.7c — the ZOOM LADDER's band (thresholds in roadLayers.ts), written from the map's own zoom
  // events in EVERY stage. The Build-only `zoom` state above STAYS: canEditEdges must not shift by
  // the 0.25 quantization below. Continuous zoom never enters React state — the per-frame layers
  // already rebuild each rAF tick, and a per-pan-frame MapView render is exactly the perf hazard
  // this arc is measured against. `zoomQ` (0.25 steps) is the chevron memo's key; `viewZoom` is
  // the seam's exact zoom, written on moveend only. Refs compare BEFORE setState (React's
  // same-value bail-out is not a contract to lean on during a zoom gesture).
  const [band, setBand] = useState<ZoomBand>('far');
  const [zoomQ, setZoomQ] = useState(12);
  const [viewZoom, setViewZoom] = useState(12);
  // V2.7c C2b — the basemap's ground / water / greenery as READ BACK from the live style after the
  // onLoad overrides (the seam reports the map's truth, never the request).
  const [basemap, setBasemap] = useState<{ ground: unknown; water: unknown; greenery: unknown } | null>(null);
  const bandRef = useRef<ZoomBand>('far');
  const zoomQRef = useRef(12);
  const onViewZoom = useCallback((z: number, settled: boolean) => {
    const b = zoomBand(z);
    if (b !== bandRef.current) {
      bandRef.current = b;
      setBand(b);
    }
    if (settled) {
      const q = quantizeZoom(z);
      if (q !== zoomQRef.current) {
        zoomQRef.current = q;
        setZoomQ(q);
      }
      setViewZoom(z);
    }
  }, []);
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
  // V2.7b F3 — THE RUN THE FEED FOLLOWS, which is not always the run the BUILD RAIL is bound to.
  // `activeRunId` carries a second meaning it acquired by accident: the rail keys on it, so a
  // non-null value replaces the draw card / palettes / DraftPanel with RunCard, stops map drawing,
  // and marks the run list's "viewing" row. That made it unusable as "the run to stream", because a
  // reader who reloads mid-run must get their run back WITHOUT losing the Build rail. So the feed
  // gets its own id. Every path that sets `activeRunId` sets this too (they are the same run in all
  // of them); the landing sets ONLY this, and only when a run is actually going.
  const [feedRunId, setFeedRunId] = useState<string | null>(null);
  // READ THE REMEMBERED WATCH AT FIRST RENDER, before the mirror below can clear it. The mirror runs
  // on mount with `feedRunId` still null and would remove the key — the landing effect, which runs
  // later, would then find nothing and every reload would look like a cold one. Captured here, the
  // ordering stops mattering.
  // a LAZY state initializer: it runs once, during the first render, which is the idiomatic way to
  // read a browser API at mount (a ref read during render is the rule React lints for).
  const [rememberedWatch] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(WATCHED_RUN_KEY);
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      if (feedRunId) window.localStorage.setItem(WATCHED_RUN_KEY, feedRunId);
      else window.localStorage.removeItem(WATCHED_RUN_KEY);
    } catch {
      /* storage unavailable (private mode) — a reload simply cannot restore the watch */
    }
  }, [feedRunId]);
  // V2.7b C8b — THE ARTIFACT ON SCREEN IS NOT THE RUN BEING WATCHED. Everything the map draws is
  // gated on this: entities, the agent join, conflicts, the change overlay and its chrome. The rule
  // is one sentence — nothing belonging to run A may be drawn under run B's name — and it holds in
  // both windows where the two diverge (a run still computing, and a finished run whose artifact is
  // still being fetched). Declared HERE, above every consumer, because the render AND the
  // __nadiChangeOverlay seam read it: a seam that recomputed its own answer would report an overlay
  // the map is not drawing, and a seam that disagrees with the pixels is worse than no seam.
  const watchedRunNotLoaded =
    feedRunId != null && artifact != null && feedRunId !== artifact.meta.run_id;
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
  // V2.7d C5: the deck overlay (for a drop's pickObject) and where a dropped member landed.
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const dropAtRef = useRef<LonLat | null>(null);
  const [dropMiss, setDropMiss] = useState(false);
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
  // V2.7b C9 — Act II reads the per-run report (as the merge base) and the graphs sidecar (the
  // discourse card's graph) while the reader is in WATCH, but both fetches are lazy on their own
  // stages. This flag unlocks them. It is set by a render-phase adjustment further down, because
  // `actTwo` needs the run feed and cannot be computed this early; the fetch effects can't move
  // below it without dragging their state declarations along.
  const [actTwoWantsData, setActTwoWantsData] = useState(false);
  const [graphsSidecar, setGraphsSidecar] = useState<{
    runId: string;
    data: GraphsSidecar | null;
    loading: boolean;
    error: boolean;
  } | null>(null);
  useEffect(() => {
    if (!(stage === 'explore' && exploreSub === 'graphs' || actTwoWantsData) || !artifact) return;
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
  }, [stage, exploreSub, artifact, graphsSidecar, actTwoWantsData]);

  // V2.7a C3 — the per-run REPORT for the Read stage (the graphs-sidecar pattern: lazy, keyed on
  // the run id, cleared by loadRun). VINTAGE GUARD: a report whose own run id disagrees with the
  // loaded run renders the labeled report-mismatch state — the document must never carry another
  // run's findings (the latest-report drift class, dead structurally).
  const [reportData, setReportData] = useState<{
    runId: string;
    report: PerRunReport | null;
    state: ReportState;
  } | null>(null);
  // V2.7b F3 — AFTER A RELOAD, THE LANDING PICKS UP THE RUN THIS READER WAS WATCHING.
  //
  // Reloading mid-run used to lose the whole experience, and the shape is not the obvious one: a
  // computing run has NO artifact yet (`/<id>.json` 404s until the quant leg ends), so the landing
  // cannot land ON it. It falls through to the last run actually VIEWED — an older, finished one —
  // and shows that, while the run the reader fired goes on computing with nothing on screen
  // referring to it. The events file was durable the whole time; only the pointer to it lived in
  // memory — so it is remembered now, and the landing restores it.
  //
  // IT RESTORES *THEIR* RUN, NOT WHICHEVER RUN IS GOING. A first draft attached to any run the list
  // reported running, and that hijacks: a reader who deliberately opens run A while run B computes
  // in the background would have the map yanked into B's Act I without asking — blanking A's agents
  // and playing B's baseline leg. The act-one suite caught it as a CONTROL assertion going from 1
  // to 0 (its "with the loaded run on screen the join is live" step), which is exactly the
  // wrong-run-render class this phase spent C8b closing. So the key is durable evidence that THIS
  // reader was watching THAT run; with no key, the landing does nothing at all.
  //
  // THREE CONSTRAINTS, each one a way the obvious version goes wrong:
  //   * it sets `feedRunId` ONLY, never `activeRunId` — the latter is what the Build rail keys on,
  //     so setting it here would replace the draw card and palettes with RunCard on every landing.
  //   * it takes the id from the RUN LIST's own row, never from the URL or the pointer, which
  //     legitimately serves an ALIAS (`default-fixture` for a body carrying `school-zone-fixture`).
  //   * it asks `/api/runs`, never `/status`: several specs mock `/status` as a call-count SEQUENCE
  //     and an extra consumer advances their progression (the standing warning below). `/api/runs`
  //     is statically mocked everywhere and already answers the only question being asked.
  //
  // WITH NOTHING REMEMBERED, OR THE REMEMBERED RUN FINISHED, IT ATTACHES NOTHING — which keeps the
  // ratified silent-404 pin true: a done run with no events file must paint zero degrade UI on the
  // cold landing's first paint, and that is the overwhelmingly common landing. A remembered run
  // that has since finished also forgets itself, so the key cannot go stale.
  //
  // a REF, not state: this is bookkeeping about a request already sent, and setting state in an
  // effect body is the cascading-render rule this project has already paid for twice.
  const landingAsked = useRef(false);
  useEffect(() => {
    if (!artifact || STATIC_DEMO) return;
    if (landingAsked.current || feedRunId != null) return; // asked already, or already following one
    landingAsked.current = true;
    const remembered = rememberedWatch;
    if (!remembered) return; // never watched anything here — the ordinary cold landing
    getRuns().then((res) => {
      if (!res.ok) return; // no backend (or the static demo): the landing simply stays as it was
      const row = res.value.runs.find((r) => r.id === remembered);
      const live = row != null && row.status !== 'done' && row.status !== 'failed';
      if (live) setFeedRunId(remembered);
      else { try { window.localStorage.removeItem(WATCHED_RUN_KEY); } catch { /* nothing to clear */ } }
    });
  }, [artifact, feedRunId, rememberedWatch]);

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
    if (!(stage === 'read' || actTwoWantsData) || !artifact) return;
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
  }, [stage, artifact, reportData, actTwoWantsData]);

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
  const preview = baselinePreview?.runId === feedRunId ? baselinePreview.artifact : null;
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
          pins.push({ agent: a, path: v.path, timestamps: v.timestamps, kind: 'vehicle', mode: v.type === 'bicycle' ? 'bicycle' : 'car' });
          pinnedVeh.add(v.id);
        }
      } else if (isSimPersonAgent(a)) {
        const p = pById[a.person_id];
        if (p) {
          pins.push({ agent: a, path: p.path, timestamps: p.timestamps, kind: 'person', mode: 'pedestrian' });
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
  }, [artifact, watchedRunNotLoaded, conflicts, normVehicles, normPersons, rawVehicles, rawPersons]);

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
  // V2.7c: the transit-map rows (lane model + offset polylines) derive ONCE per network identity;
  // the PURE roadLayers builder turns them into the band's layers (the graphLayers precedent). A
  // band change rebuilds the Layer objects but never the row arrays, so deck keeps the buffers.
  const roadRows = useMemo(() => deriveRoadRows(networkEdges), [networkEdges]);
  // C3b — chevron anchors at the CURRENT quantized zoom: a walk over the whole net once per zoom
  // gesture (never per frame), skipped entirely at the far band, which draws no direction marks.
  // Metres-per-pixel is taken at the artifact's bbox centre latitude (constant per run, so the
  // memo key is the zoom alone — a 0.05° latitude span moves the scale by ~0.1 %).
  const bboxLatC = artifact ? (artifact.meta.bbox[1] + artifact.meta.bbox[3]) / 2 : 43.75;
  const chevrons = useMemo<ChevronAnchor[]>(
    () => (band === 'far' ? [] : chevronAnchors(networkEdges, roadRows.body.map((r) => r.path), metersPerPixel(zoomQ, bboxLatC))),
    [networkEdges, roadRows, zoomQ, band, bboxLatC],
  );
  const chevronSize = chevronSizePx(metersPerPixel(zoomQ, bboxLatC));
  const baseNetworkLayers = useMemo<Layer[]>(
    () => buildRoadLayers({ rows: roadRows, band, chevrons, chevronSizePx: chevronSize }),
    [roadRows, band, chevrons, chevronSize],
  );

  // V2.7c C4 — the ACTIVE traveller sets for this frame, filtered ONCE (they were filtered inline in
  // the render body; hoisting them lets the seam below count what the layers draw). Per-frame by
  // nature: the arrays change identity with the clock, exactly as before.
  const activeSets = useMemo(
    () => ({
      veh: bgVehicles.filter((v) => activeAt(v.timestamps, currentTime)),
      per: bgPersons.filter((p) => activeAt(p.timestamps, currentTime)),
      inst: pinned.filter((d) => activeAt(d.timestamps, currentTime)),
    }),
    [bgVehicles, bgPersons, pinned, currentTime],
  );
  // V2.7c C4 test seam — a SIBLING global: how many travellers are drawn as dots vs icons right now,
  // so the band swap is a conservation pin (drawn once, never twice) rather than a pixel read.
  useEffect(() => {
    const icons = band === 'icons';
    const bg = activeSets.veh.length + activeSets.per.length;
    (window as unknown as { __nadiTravelers?: unknown }).__nadiTravelers = {
      band,
      dots: icons ? 0 : bg,
      icons: icons ? bg : 0,
      instrumentedDots: icons ? 0 : activeSets.inst.length,
      instrumentedIcons: icons ? activeSets.inst.length : 0,
    };
  }, [band, activeSets]);

  // V2.7c test seams — SIBLING globals of __nadiRenderStats (whose whole-object pin forbids new
  // keys): the viewport's settled zoom + band, with `jumpTo` calling the REAL map (late-bound
  // through the ref inside the closure — never a captured instance, the StrictMode dead-instance
  // hazard), and the road layer list as {id, visible, count} so a spec can pin what renders at a
  // stated zoom without reading pixels.
  useEffect(() => {
    (window as unknown as { __nadiViewport?: unknown }).__nadiViewport = {
      zoom: viewZoom,
      band,
      basemap,
      jumpTo: (lon: number, lat: number, z: number) =>
        mapRef.current?.getMap().jumpTo({ center: [lon, lat], zoom: z }),
      // V2.7d C5: container-relative pixels of a lon/lat — the drag tests aim a REAL mouse drop with it
      project: (lon: number, lat: number) => {
        const p = mapRef.current?.getMap().project([lon, lat]);
        return p ? { x: p.x, y: p.y } : null;
      },
    };
  }, [viewZoom, band, basemap]);
  useEffect(() => {
    (window as unknown as { __nadiRoadLayers?: unknown }).__nadiRoadLayers = {
      band,
      zoomQ,
      layers: describeLayers(baseNetworkLayers),
    };
  }, [baseNetworkLayers, band, zoomQ]);

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
        id, geometry: ne.geometry, speed_mps: ne.speed_mps, network: ne,
        car_lane_count: el?.car_lane_count ?? 0,
        car_lane_indices: el?.car_lane_indices ?? [],
        eligible_bike_lane: el?.eligible_bike_lane ?? false,
        eligibility_reason: el?.eligibility_reason ?? 'loading eligibility…',
      };
    },
    [networkLookup, eligById],
  );

  // V2.7d C4a — the drop form's context: the selected edge's NODE-PAIR partner (the opposite
  // direction, from the export's `reverse` — never derived from the id) merged like the edge itself,
  // and the cross-street line from the same-name walk (streetNames.crossStreets over a node index
  // built once per network identity).
  const nodeIndex = useMemo(() => buildNodeIndex(networkEdges), [networkEdges]);
  const dropPartner = useMemo(
    () => (selectedEdge?.network.reverse ? mergeEdge(selectedEdge.network.reverse) : null),
    [selectedEdge, mergeEdge],
  );
  const dropBetween = useMemo(
    () => (selectedEdge ? betweenLine(crossStreets(selectedEdge.network, networkLookup, nodeIndex)) : null),
    [selectedEdge, networkLookup, nodeIndex],
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
    setFeedRunId(id);
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
    setRoomSeededFrom(null);
    // V2.3d: an enrich may have just exported fresh graph layouts for this same run_id — drop the
    // cached (possibly 404-errored) sidecar so graphs mode refetches instead of staying stale
    setGraphsSidecar(null);
    setActTwoWantsData(false); // V2.7b: the next run earns its own Act II fetches
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
        if (cur.length >= ROOM_MAX || cur.some((p) => p.index === idx)) return cur;
        return [...cur, { agent, index: idx }];
      });
    },
    [artifact],
  );

  const removeFromRoom = useCallback((index: number) => {
    setRoomPairs((cur) => cur.filter((p) => p.index !== index));
  }, []);

  // V2.7e C2 — the run document's two-group doorway: a FRESH room composed by `roomSeed`'s stated
  // rule (each group's most-affected simulated voices first, alternating, cap ROOM_MAX), its note
  // stating the actual composition. A new roster starts a new thread — the previous session's
  // messages belonged to a room the reader is no longer in — and the epoch bump orphans any round
  // still in flight. The feed follows group A (the existing single-group join; the two-group feed
  // filter is deferred, BACKLOG).
  const seedRoom = useCallback(
    (a: string, b: string) => {
      if (!artifact) return;
      const seed = roomSeed(artifact, a, b);
      if (!seed) return; // the document renders no CTA for such a pair — belt and braces
      roomEpoch.current++;
      roomLoopActive.current = false;
      setRoomPairs(seed.pairs);
      setRoomMsgs([]);
      setRoomRound(null);
      setRoomLastRound(null);
      setRoomSeededFrom(seedNote(GROUP_LABEL[a] ?? a, seed.counts.a, GROUP_LABEL[b] ?? b, seed.counts.b));
      setRoomOpen(true);
      setFeedGroup(a);
      setStage('watch');
    },
    [artifact],
  );

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
  const runFeed = useRunFeed(feedRunId, feedHandlers);

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

  // V2.7b C9 — ACT II. The physics is over (its artifact is loaded, so `actOne` is false), the fold
  // belongs to THIS run, interpretation has started, and the run is still live. That last clause is
  // what makes the act LIVE-ONLY as ratified: a finished run reopened from the list opens no stream,
  // so it can never mount here — and the ledger seed, which DOES carry stage statuses, cannot fake
  // it into history. `experience.ended` deliberately does NOT unmount it: a reader watches the last
  // stage finish rather than having the screen vanish at the moment it completes.
  //
  // THE PASS-THROUGH-`done` BUG WAS NOT THIS PREDICATE (V2.7b C11, and the fix moved twice before
  // it landed here). A chained run passes THROUGH a terminal state between the quant leg and the
  // chain's first stage write, and what broke was that the POLL STOPPED there and never restarted
  // — so `watchedRunLive` froze at false and the act never mounted for the reader who started the
  // run. `useRunFeed` restarts the poll on a `stage_start` arriving after a stop, which puts the
  // status back to `enrich:*` within one tick and mounts the act. Replacing this clause instead —
  // with "did this session see the stream" — passed its own pin and broke five brake specs, because
  // it also removed the UNMOUNT: Watch then belongs to the act forever, and the playback a reader
  // goes to Watch FOR is unreachable without a run swap. The status is the right signal; it just
  // has to keep being read.
  const actTwo =
    !actOne &&
    runFeed.experience.runId != null &&
    runFeed.experience.runId === artifact?.meta.run_id &&
    watchedRunLive &&
    chainState(runFeed.experience) === 'running';

  // Unlock the report + graphs fetches for Act II (React's "adjusting state when a prop changes";
  // never resets here — loadRun clears it on a run swap).
  if (actTwo && !actTwoWantsData) setActTwoWantsData(true);

  // THE FILE WINS. While the report stage runs, the document on screen is a client-side MERGE of
  // the slots that have landed. The moment the stage ends, drop the fetched report so the effect
  // above re-reads the one report.py actually wrote — and it cannot race: report.py writes
  // web/public/<run>-report.json before its process exits, and the server emits stage_end only
  // after that process returns. Same for the graphs sidecar, which the discourse enrich writes.
  const reportStageDone = runFeed.experience.stages.find((s) => s.key === 'report')?.status === 'done';
  const discourseStageDone = runFeed.experience.stages.find((s) => s.key === 'discourse')?.status === 'done';
  const [prevReportDone, setPrevReportDone] = useState(reportStageDone);
  if (reportStageDone !== prevReportDone) {
    setPrevReportDone(reportStageDone);
    if (reportStageDone) setReportData(null); // EDGE-triggered: clearing every render would loop
  }
  const [prevDiscourseDone, setPrevDiscourseDone] = useState(discourseStageDone);
  if (discourseStageDone !== prevDiscourseDone) {
    setPrevDiscourseDone(discourseStageDone);
    if (discourseStageDone) setGraphsSidecar(null);
  }

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
          // C4b: an ARMED tile is a drop — the click carries its kind; otherwise the ROAD CARD
          setDropKind(armedKind && armedKind !== 'school_zone' && armedKind !== 'new_road' ? armedKind : null);
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
    [ptA, ptB, vias, artifact, junctions, mergeEdge, zoneMode, armedKind],
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
    const at = dropAtRef.current; // C5: a member added from a DROP pins its icon at the drop point
    dropAtRef.current = null;
    setDraft((d) => [...d, { id, change, valid: true, ...(at ? { at } : {}), ...extra }]);
    setDraftError(null);
    // close the contributing tool — the same clears the old submit-on-apply did on success
    setPtA(null);
    setPtB(null);
    setVias([]);
    setHoverCoord(null);
    setDrawHint(null);
    setSelectedEdge(null);
    setDropKind(null);
    setArmedKind(null); // C4b: adding a member disarms the tile
  }, [setDropKind, setArmedKind]);

  // V2.7d C4a: several members in ONE draftSeq bump (the zone-macro idiom — ids minted outside the
  // updater) — the both-directions lane closure / road closure / speed limit add one member per
  // directional edge.
  const addMembers = useCallback((changes: SimChange[]) => {
    if (changes.length === 0) return;
    const base = draftSeq.current;
    draftSeq.current += changes.length;
    // C5: members added from a DROP remember the drop point (their pinned icon); the ref is consumed
    const at = dropAtRef.current;
    dropAtRef.current = null;
    setDraft((d) => [...d, ...changes.map((change, i) => ({ id: `d${base + i + 1}`, change, valid: true, ...(at ? { at } : {}) }))]);
    setDraftError(null);
    setPtA(null);
    setPtB(null);
    setVias([]);
    setHoverCoord(null);
    setDrawHint(null);
    setSelectedEdge(null);
    setDropKind(null);
    setArmedKind(null); // C4b: adding a member disarms the tile
  }, [setDropKind, setArmedKind]);

  // V2.7d C6 — the blocker card's resolutions, each acting on the member the card points at.
  const onFixSwitchDayOne = useCallback(() => setRunOptions((o) => ({ ...o, assignment: 'day_one' })), []);
  const onFixRemoveWindow = useCallback((id: string) => {
    setDraft((d) => d.map((m) => {
      if (m.id !== id || !('window' in m.change)) return m;
      const { window: _w, ...rest } = m.change as { window?: ChangeWindow } & SimChange;
      void _w;
      return { ...m, change: rest as SimChange };
    }));
    setDraftError(null);
  }, []);
  const onFixRemoveMember = useCallback((id: string) => {
    setDraft((d) => d.filter((m) => m.id !== id));
    setHoveredDraftId((h) => (h === id ? null : h));
    setDraftError(null);
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
    setFeedRunId(res.value.run_id);
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

  // V2.7d C4b: the form composes the members (one per directional edge, descriptions included — the
  // client's `Speed limit on <ref> -> v m/s` form, name-plus-id when named, the bare id when not).
  const onEdgeSpeeds = useCallback(
    (members: SimChange[]) => {
      if (!selectedEdge) return;
      addMembers(members);
    },
    [selectedEdge, addMembers],
  );

  const onEdgeBike = useCallback(() => {
    if (!selectedEdge) return;
    addToDraft({ type: 'bike_lane', target_edge: selectedEdge.id, description: `Bike lane on ${selectedEdge.id}` });
  }, [selectedEdge, addToDraft]);

  // V2.2c — temporary events. NO client description: the server composes the canonical
  // clock-time description (fmt_window; single source with the report/chips).
  const [draftWindowed, setDraftWindowed] = useState(false);
  const onEdgeLaneClosures = useCallback(
    (members: SimChange[]) => {
      if (!selectedEdge) return;
      addMembers(members);
    },
    [selectedEdge, addMembers],
  );
  const onEdgeRoadClosures = useCallback(
    (members: SimChange[]) => {
      if (!selectedEdge) return;
      addMembers(members);
    },
    [selectedEdge, addMembers],
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
    () => deriveBlockerCards(draftChanges, windowLocked ? 'day_one' : (runOptions.assignment ?? 'day_one'), eligById),
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

  // V2.7d C4b — a tile ARMS a kind (click-to-arm, the accessible path; C5 adds the pointer drag). The
  // zone and draw tiles enter their EXISTING modes instead (a recorded decision); the five drop kinds
  // toggle, and the next road click carries the armed kind into the form. Any open form closes.
  const onArm = useCallback((kind: ArmKind) => {
    if (kind === 'school_zone') {
      setArmedKind(null);
      setSelectedEdge(null);
      setDropKind(null);
      if (!zoneMode) onZoneToggle();
      return;
    }
    if (kind === 'new_road') {
      setArmedKind(null);
      setDropKind(null);
      resetDraw();
      if (zoneMode) onZoneCancel();
      return;
    }
    setSelectedEdge(null);
    setDropKind(null);
    if (zoneMode) onZoneCancel();
    setArmedKind((cur) => (cur === kind ? null : kind));
  }, [zoneMode, onZoneToggle, onZoneCancel, resetDraw]);

  // V2.7d C5 — a tile DROPPED on the map: the road under the pointer through deck's own picking on the
  // `edit-edges` layer (container-relative px; radius 8), the form opens for THAT road pre-set to the
  // tile's kind, and the drop point is remembered so the member it adds pins its icon there. A miss
  // says so (`drop-miss`, 1.5 s) and adds nothing. Never HTML5 DnD onto the canvas (pointer-based).
  const onDropAt = useCallback((kind: DropKind, clientX: number, clientY: number) => {
    const map = mapRef.current?.getMap();
    const overlay = overlayRef.current;
    if (!map || !overlay) return;
    const r = map.getContainer().getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    const info = overlay.pickObject({ x, y, layerIds: ['edit-edges'], radius: 8 });
    const hit = info?.object as NetworkEdge | undefined;
    const merged = hit ? mergeEdge(hit.id) : null;
    setArmedKind(null);
    if (!merged) {
      setDropMiss(true);
      window.setTimeout(() => setDropMiss(false), 1500);
      return;
    }
    const ll = map.unproject([x, y]);
    dropAtRef.current = [ll.lng, ll.lat];
    setSelectedEdge(merged);
    setDropKind(kind);
    setDrawHint(null);
    if (zoneMode) onZoneCancel();
  }, [mergeEdge, zoneMode, onZoneCancel]);

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
    setFeedRunId(null);
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
      setFeedRunId(null);
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
      __nadiEditEdge?: (id: string, kind?: DropKind) => void;
    };
    w.__nadiEdit = (lon, lat) => onEditClick({ coordinate: [lon, lat] } as PickingInfo);
    w.__nadiEditHover = (lon, lat) => onEditHover({ coordinate: [lon, lat] } as PickingInfo);
    // V2.0b: select an existing edge by ID (geometry now lives in the network map, not the API response).
    // V2.7d C4a: an optional KIND is a drop — the form opens pre-set to it (the tile → road path the
    // pointer drag lands on in C5). No kind = the road card, exactly as before: behaviour-identical.
    w.__nadiEditEdge = (id, kind) => {
      const ne = networkLookup[id];
      if (!ne) return;
      onEditClick({ layer: { id: 'edit-edges' }, object: ne } as unknown as PickingInfo);
      if (kind) setDropKind(kind); // no kind: the click branch already applied the armed tile (or none)
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
          `sim-time: ${fmtSimTime(c.t, artifact?.meta.demand_profile)}<br/>` +
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
      ghost: watchedRunNotLoaded && ghostGeom?.runId === feedRunId ? ghostGeom.items.length : 0,
      // V2.2d: the zone designation flag (the tint is ALWAYS shown for tagged runs; items' active
      // flags carry the time-truth for the speed members themselves).
      zoneTagged: !!artifact?.meta.scenario?.tags?.includes('school_zone'),
      items: items.map((d) => ({
        type: d.type,
        windowed: !!d.window,
        active: !d.window || !playbackNow || (currentTime >= d.window.start_s && currentTime <= d.window.end_s),
        // V2.6d: the rendered polyline's vertex count (a curved new_road = 2 + via points)
        vertices: d.path.length,
        // V2.7c C3c: a bike_lane change renders as the TRUE-WIDTH curb-side lane from the lanes band
        // (a rendering of `path`, which itself never changes — the vertex pin above stays honest)
        laneBand: d.type === 'bike_lane' && band !== 'far' && !!(d.edge && networkLookup[d.edge]),
        // V2.7c C5: a new_road renders as a ROAD BODY at its lane count (never the schematic line);
        // `stripes` = the internal boundaries drawn at the current band (0 below z15)
        roadBody: d.type === 'new_road',
        stripes: d.type === 'new_road' && band !== 'far' ? newRoadRows(d.path, d.lanes ?? undefined).stripes.length : 0,
      })),
    };
  }, [changeGeom, artifact, currentTime, stage, socialIds, watchedRunNotLoaded, ghostGeom, feedRunId, band, networkLookup]);
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
        // V2.7c C5: a drawn road in the basket renders as a road body at its lane count
        roadBody: m.change.type === 'new_road' && !!m.path,
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

  // V2.7b C10b — THE BRAKE. Skip stops the interpretation and then takes the reader to Read: you
  // ended it, here is everything that exists. THE TRIGGER IS THIS CLICK, never the terminal edge —
  // routing on the edge would yank a reader off a pinned voice card when a run simply finishes, or
  // when someone else stopped it from another surface. Only the user's own action moves the user.
  const [skipping, setSkipping] = useState(false);
  const [skipError, setSkipError] = useState<string | null>(null);
  // V2.7b C10b — RESUME runs the stages the ledger says are not done. NB the endpoint re-runs
  // `partial` and `failed` stages too, not only never-ran ones, which is why the button says "run
  // the rest" rather than promising to pick up exactly where it stopped.
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const onResume = useCallback(async () => {
    if (!feedRunId) return;
    setResumeError(null);
    setResuming(true);
    const res = await postResume(feedRunId);
    setResuming(false);
    if (!res.ok) setResumeError(res.error); // verbatim: 403 pinned, 409 one-job, 409 nothing pending
  }, [feedRunId]);

  const onSkip = useCallback(async () => {
    if (!feedRunId) return;
    setSkipError(null);
    setSkipping(true);
    const res = await postSkip(feedRunId);
    setSkipping(false);
    if (!res.ok) {
      setSkipError(res.error); // verbatim, like every other run-control error
      return;
    }
    setStage('read');
  }, [feedRunId]);

  // V2.7b C10b — the interpretation's ending, as SENTENCES for the document. Everything here is
  // ledger-derived: `voices` is what actually arrived, `voicesTotal` what was planned, the stage
  // list is the ledger's own, and the reason is the server's `ended.reason` (which reaches the
  // client only through the terminal-edge ledger re-read). A run that simply completed renders
  // nothing — this is for the two endings that need explaining.
  const ended = runFeed.experience.ended;
  const interpretation = useMemo(() => {
    if (!ended || ended.status === 'complete') return null;
    const x = runFeed.experience;
    // EVERY COUNTER HERE IS THE LEDGER'S. The first draft read the streamed voice array instead,
    // which is a live-transport artifact: EventSource replays on reconnect, so that number drifts
    // upward while the run sits idle. What actually happened is durable — which stages ran, which
    // stopped part-way, which never started, and what each cost — so the sentence says that.
    const kept: string[] = [];
    const partial = x.stages.filter((st) => st.status === 'partial').map((st) => st.label);
    if (partial.length) kept.push(`${partial.join(', ')} stopped part-way and kept what had landed`);
    const done = x.stages.filter((st) => st.status === 'done').map((st) => st.label);
    if (done.length) kept.push(`finished: ${done.join(', ')}`);
    const never = x.stages.filter((st) => st.status === 'skipped').map((st) => st.label);
    if (never.length) kept.push(`never ran: ${never.join(', ')}`);
    // FAILED matched none of the three filters above, so a stage that failed vanished from the
    // sentence while its spend still counted — a degraded run read "47 model calls" with voices in
    // neither the finished list nor the never-ran one, and nothing saying where they went. The
    // stage's own detail is the ledger's (`set_stage(..., detail=...)`), carried through the
    // terminal-edge re-read; without that half this clause would have a name and no reason.
    const failed = x.stages.filter((st) => st.status === 'failed');
    if (failed.length) {
      // ...but the reason is the RUN'S, not each stage's, whenever they agree — and under a chain
      // they almost always do, because one outage fails every stage it touches. Rendered per stage
      // it repeated a raw provider exception three times inside one paragraph (looked-at catch on
      // C11's degraded run: an authentication dump, twice as stage details and once as "Reason
      // given"). A stage keeps its own detail only where it differs from the ending's, which is the
      // case the per-stage clause exists for. `endingDetail` is the SAME string this block prints
      // once, below.
      const endingDetail = (ended.detail ?? '').trim();
      kept.push(`failed: ${failed
        .map((st) => {
          const d = (st.detail ?? '').trim();
          return d && d !== endingDetail ? `${st.label} — ${d}` : st.label;
        })
        .join(', ')}`);
    }
    const cost = x.llmCallsTotal ? `The run spent ${x.llmCallsTotal.toLocaleString()} model calls.` : null;
    const sentence = kept.length
      ? `${kept.join('; ').replace(/^./, (c) => c.toUpperCase())}. ${cost ?? ''}`.trim()
      : cost;
    const status = ended.status === 'failed' ? ('failed' as const) : ended.status === 'degraded'
      ? ('degraded' as const) : ('skipped' as const);
    // the reason only renders when it ADDS something: on a skip it is "stopped at your request",
    // which the heading already says, and repeating it reads as a stray fragment (looked-at catch)
    // A provider's exception text is machinery, and this document is content. The reason is kept —
    // a reader who cannot see WHY has to go to a log — but clamped to its first line and a readable
    // length, so the sentence stays a sentence.
    const rawReason = (ended.detail ?? '').trim().split(/\r?\n/)[0].trim();
    const shortReason = rawReason.length > 160 ? `${rawReason.slice(0, 157).trimEnd()}…` : rawReason;
    const reason = shortReason && status !== 'skipped'
      ? `Reason given: ${shortReason}${/[.!?…]$/.test(shortReason) ? '' : '.'}`
      : null;
    return {
      status,
      kept: sentence,
      reason,
      onResume,
      resuming,
      error: resumeError,
    };
  }, [ended, runFeed.experience, onResume, resuming, resumeError]);

  // Shown once per run: the held moment is a MOMENT, not a gate, so re-interrupting on every
  // reload mid-Act-II would make it a nuisance.
  const [heldSeen, markHeldSeen] = useHeldMomentSeen(feedRunId);

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
    getColor: TRAIL, // V2.7c: light on the dark roadway (was a mid grey on a light road)
    opacity: 0.5,
    widthMinPixels: 2,
    trailLength: 200,
    fadeTrail: true,
    currentTime: t,
    capRounded: true,
    jointRounded: true,
  });

  // 2a) Background vehicles: small dots at their current position (only while active).
  // V2.7c: ONE traveller colour for any mode (the design: mode is legible from the icon at z ≥ 16,
  // never from colour) with a 1 px light rim — a dark dot on the dark roadway needs one, and the
  // rim is what keeps it legible on the light ground too (the C2b contrast-sibling check).
  // V2.7c C4: from z ≥ 16 the dots hand their DATA to the icon layers below (the data swap).
  const iconsBand = band === 'icons';
  const bgVehActive = activeSets.veh;
  const backgroundVehicleDots = new ScatterplotLayer<Materialized<Vehicle>>({
    id: 'background-vehicle-dots',
    data: iconsBand ? EMPTY : bgVehActive,
    getPosition: (v) => positionAtCached(v.path, v.timestamps, t),
    getFillColor: TRAVELER,
    getRadius: 2.5,
    radiusUnits: 'pixels',
    stroked: true,
    getLineColor: TRAVELER_RIM,
    getLineWidth: 1,
    lineWidthUnits: 'pixels',
    pickable: false,
    updateTriggers: { getPosition: t },
  });

  // 2b) Background pedestrians: the same dot (mode never rides on colour).
  const bgPerActive = activeSets.per;
  const backgroundPersonDots = new ScatterplotLayer<Materialized<Person>>({
    id: 'background-person-dots',
    data: iconsBand ? EMPTY : bgPerActive,
    getPosition: (p) => positionAtCached(p.path, p.timestamps, t),
    getFillColor: TRAVELER,
    getRadius: 2.5,
    radiusUnits: 'pixels',
    stroked: true,
    getLineColor: TRAVELER_RIM,
    getLineWidth: 1,
    lineWidthUnits: 'pixels',
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
    getFillColor: CONFLICT_DOT,
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
      return [CONFLICT_PULSE[0], CONFLICT_PULSE[1], CONFLICT_PULSE[2], Math.round(40 + 190 * frac)];
    },
    getRadius: (c) => 4 + Math.max(0, Math.min(1, c.severity)) * 8, // 4–12 px, severity-scaled
    radiusUnits: 'pixels',
    stroked: true,
    getLineColor: [CONFLICT_PULSE[0], CONFLICT_PULSE[1], CONFLICT_PULSE[2], 220],
    getLineWidth: 1,
    lineWidthUnits: 'pixels',
    pickable: true,
    updateTriggers: { getFillColor: t }, // small active set → cheap per-frame re-eval
  });

  // 4) Instrumented dots: larger, colored by sentiment, clickable; swell near their trigger_t. Now covers
  //    BOTH vehicle- and person-pinned sim agents (one layer, driven off the unified pinned list).
  const instActive = activeSets.inst;
  const instrumentedDots = new ScatterplotLayer<Pinned>({
    id: 'instrumented-dots',
    data: iconsBand ? EMPTY : instActive,
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

  // 4b) V2.7c C4 — THE ICONS BAND (z ≥ 16): "dots become overhead mode icons rotated to heading" — the
  //     only rung that changes travellers, so the lane switch (z15) and the icon switch (z16) never land
  //     in the same gesture. Mode is legible from the SHAPE (car / bicycle / pedestrian glyphs from
  //     modeIcons.ts), never from colour: background travellers keep the one TRAVELER hue, instrumented
  //     ones keep their sentiment colour and their trigger-time swell. Position and heading come from
  //     one cached bracket lookup (viz.segmentAt). Sizes are metres with a pixel floor. Data-swapped
  //     with the dot layers above (EMPTY below z16), so no layer pays attribute regeneration twice.
  const atlas = modeAtlasUrl();
  const modeOf = (type: string | undefined): TravelerMode => (type === 'bicycle' ? 'bicycle' : type === 'pedestrian' ? 'pedestrian' : 'car');
  const iconLayer = <D,>(
    id: string,
    data: D[],
    mode: (d: D) => TravelerMode,
    pathOf: (d: D) => LonLat[],
    tsOf: (d: D) => number[],
    color: ((d: D) => [number, number, number, number]) | [number, number, number, number],
    sizeMul: (d: D) => number,
    extra: Partial<ConstructorParameters<typeof IconLayer<D>>[0]> = {},
  ) =>
    new IconLayer<D>({
      id,
      data: iconsBand && atlas ? data : EMPTY,
      iconAtlas: atlas ?? undefined,
      iconMapping: ICON_MAPPING,
      getIcon: (d) => mode(d),
      getPosition: (d) => segmentAt(pathOf(d), tsOf(d), t).position,
      getAngle: (d) => 360 - segmentAt(pathOf(d), tsOf(d), t).bearing, // map bearing cw → deck ccw
      getSize: (d) => ICON_SIZE_M[mode(d)] * sizeMul(d),
      sizeUnits: 'meters',
      // 12 px floor: at z16 a 4.6 m car is 5 px and a walker 1 px — true to scale but not a SHAPE.
      // The rung exists so mode reads from the glyph, so the floor is where the glyph becomes one
      // (looked-at on the magnified z16.5 frame at a 9 px floor: rounded marks, not cars). Metres
      // take over from ~z17.4 for cars and the cap stops a road-sized mark at deep zooms.
      sizeMinPixels: 12,
      sizeMaxPixels: 30,
      getColor: color,
      billboard: true,
      updateTriggers: { getPosition: t, getAngle: t, getSize: t },
      ...extra,
    });
  const backgroundVehicleIcons = iconLayer<Materialized<Vehicle>>(
    'background-vehicle-icons', bgVehActive, (v) => modeOf(v.type), (v) => v.path, (v) => v.timestamps, TRAVELER, () => 1,
    { pickable: false },
  );
  const backgroundPersonIcons = iconLayer<Materialized<Person>>(
    'background-person-icons', bgPerActive, () => 'pedestrian', (p) => p.path, (p) => p.timestamps, TRAVELER, () => 1,
    { pickable: false },
  );
  const instrumentedIcons = iconLayer<Pinned>(
    'instrumented-icons', instActive,
    (d) => d.mode,
    (d) => d.path, (d) => d.timestamps,
    (d) => [...sentimentColor(d.agent.reaction.sentiment), 255] as [number, number, number, number],
    (d) => (Math.abs(t - d.agent.trigger_t) < PULSE_WINDOW ? 1.6 : 1.15), // the trigger swell, as size
    {
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 90],
      onClick: (info: PickingInfo) => {
        const obj = info.object as Pinned | undefined;
        if (obj) setSelected(obj.agent);
      },
    },
  );

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
            : EDIT_TINT_NEUTRAL, // V2.7c: light over the dark roadway (the old mid grey vanished on it)
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
  type DraftOverlayItem = { id: string; type: string; path: LonLat[]; lanes?: number };
  const draftOverlayItemsAll: DraftOverlayItem[] = draft.flatMap((m) => {
    const path =
      m.path ??
      ('target_edge' in m.change && m.change.target_edge ? networkLookup[m.change.target_edge]?.geometry : undefined);
    return path ? [{ id: m.id, type: m.change.type, path, lanes: (m.change as { lanes?: number }).lanes }] : [];
  });
  // V2.7c C5: a drawn road in the basket renders as a ROAD BODY (grey at its lane count under the
  // brown "proposed" casing; hover widens and brightens the casing) — the other member types keep
  // their overlay line. The captured path is never replaced.
  const draftRoadItems = draftOverlayItemsAll.filter((d) => d.type === 'new_road');
  const draftOverlayItems = draftOverlayItemsAll.filter((d) => d.type !== 'new_road');
  const draftOverlay = new PathLayer<DraftOverlayItem>({
    id: 'draft-overlay',
    data: draftOverlayItems,
    getPath: (d) => d.path,
    getColor: (d) =>
      d.id === hoveredDraftId
        ? DRAFT_HOVER // V2.7c: the chevron brown — the V2.4a dark slate (chosen to beat a LIGHT basemap)
        : // vanished on the #515459 roadway; a white highlight vanishes on the light ground a drawn
          // road crosses. Brown reads on both (looked-at, C2b).
          (CAP_DASH_COLOR[d.type] ?? EDIT_OVERLAY),
    getWidth: (d) => (d.id === hoveredDraftId ? 9 : 6),
    widthUnits: 'pixels',
    capRounded: true,
    jointRounded: true,
    // deck caches accessor results — without these triggers the hover highlight silently sticks
    updateTriggers: { getColor: [hoveredDraftId], getWidth: [hoveredDraftId] },
  });
  const draftRoadCasing = new PathLayer<DraftOverlayItem>({
    id: 'draft-road-casing',
    data: draftRoadItems,
    getPath: (d) => d.path,
    getColor: (d) => (d.id === hoveredDraftId ? DRAFT_HOVER : CHEVRON),
    getWidth: (d) => newRoadRows(d.path, d.lanes).casingWidthM + (d.id === hoveredDraftId ? 2.4 : 0),
    widthUnits: 'meters',
    widthMinPixels: 5,
    capRounded: true,
    jointRounded: true,
    updateTriggers: { getColor: [hoveredDraftId], getWidth: [hoveredDraftId] },
  });
  const draftRoadBody = new PathLayer<DraftOverlayItem>({
    id: 'draft-road-body',
    data: draftRoadItems,
    getPath: (d) => d.path,
    getColor: ROADWAY,
    getWidth: (d) => newRoadRows(d.path, d.lanes).bodyWidthM,
    widthUnits: 'meters',
    widthMinPixels: 3,
    capRounded: true,
    jointRounded: true,
  });
  const draftRoadStripes = new PathLayer<{ path: LonLat[] }>({
    id: 'draft-road-stripes',
    data: band === 'far' ? [] : draftRoadItems.flatMap((d) => newRoadRows(d.path, d.lanes).stripes.map((path) => ({ path }))),
    getPath: (d) => d.path,
    getColor: CENTERLINE,
    getWidth: 1,
    widthUnits: 'pixels',
    getDashArray: [4, 4],
    extensions: [DASH_EXT],
  } as ConstructorParameters<typeof PathLayer<{ path: LonLat[] }>>[0]);

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
  // V2.6d: the working line BENDS at via points — a PathLayer over [A, ...bends, rubber-band tip].
  // V2.7c C5: "the preview is the road at its real width — grey with white striping, never a
  // schematic line" — the road body at the form's DEFAULT lane count (the count is chosen after
  // B is clicked) under the brown "proposed" casing, stripes from the lanes band.
  const previewTo: LonLat | null = ptB ? [ptB.lon, ptB.lat] : hoverCoord;
  const previewPath: LonLat[] = ptA
    ? [[ptA.lon, ptA.lat], ...vias, ...(previewTo ? [previewTo] : [])]
    : [];
  const previewRows = previewPath.length >= 2 ? newRoadRows(previewPath, DEFAULT_DRAW_PARAMS.lanes) : null;
  const drawPreviewCasing = new PathLayer<{ path: LonLat[] }>({
    id: 'draw-preview-casing',
    data: previewRows ? [{ path: previewPath }] : [],
    getPath: (d) => d.path,
    getColor: CHEVRON,
    getWidth: previewRows?.casingWidthM ?? 1,
    widthUnits: 'meters',
    widthMinPixels: 5,
    capRounded: true,
    jointRounded: true,
  });
  const drawPreview = new PathLayer<{ path: LonLat[] }>({
    id: 'draw-preview',
    data: previewRows ? [{ path: previewPath }] : [],
    getPath: (d) => d.path,
    getColor: ROADWAY,
    getWidth: previewRows?.bodyWidthM ?? 1,
    widthUnits: 'meters',
    widthMinPixels: 3,
    capRounded: true,
    jointRounded: true,
  });
  const drawPreviewStripes = new PathLayer<{ path: LonLat[] }>({
    id: 'draw-preview-stripes',
    data: previewRows && band !== 'far' ? previewRows.stripes.map((path) => ({ path })) : [],
    getPath: (d) => d.path,
    getColor: CENTERLINE,
    getWidth: 1,
    widthUnits: 'pixels',
    getDashArray: [4, 4],
    extensions: [DASH_EXT],
  } as ConstructorParameters<typeof PathLayer<{ path: LonLat[] }>>[0]);

  // V2.7a: the Explore SHEETS (compare / graphs / chat) occlude the map, so its chrome hides for
  // them; Explore·Discourse keeps the map visible behind the feed like the old discourse mode.
  // The old silent discourse→playback degrade is gone — a run with no social block renders the
  // LABELED discourse-empty state instead (the graphs precedent: enterable, honest, never dead).
  const sheetMode = (stage === 'explore' && exploreSub !== 'discourse') || actTwo;

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
  const legacyActive = overlayItems.filter((d) => !CAPACITY_TYPES.has(d.type) && isOverlayActive(d));
  // V2.7c C3c — the BIKE BAND: a scenario's bike_lane is a real dedicated lane, so from the lanes band
  // it renders as the curb-side car lane at TRUE width (the lane model's rightmost car lane, offset
  // off the sidewalk) in the design's bike green; at the far band it stays a thin green line on the
  // edge (the change-overlay). `d.path` is never replaced — the band is a rendering of it — so the
  // overlay seam's vertex pins hold. A bike_lane change is never windowed (not a windowable type),
  // and the per-frame offset of one or two short polylines is microseconds.
  const bikeBandRows = band === 'far'
    ? []
    : legacyActive.flatMap((d) => {
        const e = d.type === 'bike_lane' && d.edge ? networkLookup[d.edge] : undefined;
        if (!e) return [];
        const m = laneModel(e);
        const laneCentre = m.bodyOffsetM + m.carWidthM / 2 - LANE_M / 2; // the rightmost car lane
        return [{ path: offsetPolyline(d.path, laneCentre) }];
      });
  // V2.7c C5 — a DRAWN ROAD (new_road) renders as a road body at its lane count: the brown
  // "proposed" casing under the grey body, white stripes on the internal boundaries from the lanes
  // band. The V2.6d teal schematic line is retired; the path (A + vias + B) is never replaced.
  const newRoadItems = legacyActive.filter((d) => d.type === 'new_road');
  const legacyItems = legacyActive.filter(
    (d) => d.type !== 'new_road' && !(bikeBandRows.length && d.type === 'bike_lane' && d.edge && networkLookup[d.edge]),
  );
  const newRoadCasing = new PathLayer<OverlayItem>({
    id: 'new-road-casing',
    data: newRoadItems,
    getPath: (d) => d.path,
    getColor: CHEVRON,
    getWidth: (d) => newRoadRows(d.path, d.lanes ?? undefined).casingWidthM,
    widthUnits: 'meters',
    widthMinPixels: 5,
    capRounded: true,
    jointRounded: true,
  });
  const newRoadBody = new PathLayer<OverlayItem>({
    id: 'new-road-body',
    data: newRoadItems,
    getPath: (d) => d.path,
    getColor: ROADWAY,
    getWidth: (d) => newRoadRows(d.path, d.lanes ?? undefined).bodyWidthM,
    widthUnits: 'meters',
    widthMinPixels: 3,
    capRounded: true,
    jointRounded: true,
  });
  const newRoadStripes = new PathLayer<{ path: LonLat[] }>({
    id: 'new-road-stripes',
    data: band === 'far' ? [] : newRoadItems.flatMap((d) => newRoadRows(d.path, d.lanes ?? undefined).stripes.map((path) => ({ path }))),
    getPath: (d) => d.path,
    getColor: CENTERLINE,
    getWidth: 1,
    widthUnits: 'pixels',
    getDashArray: [4, 4],
    extensions: [DASH_EXT],
  } as ConstructorParameters<typeof PathLayer<{ path: LonLat[] }>>[0]);
  const bikeBand = new PathLayer<{ path: LonLat[] }>({
    id: 'bike-band',
    data: bikeBandRows,
    getPath: (d) => d.path,
    getColor: BIKE_BAND,
    getWidth: LANE_M,
    widthUnits: 'meters',
    widthMinPixels: 2,
    capRounded: false,
    jointRounded: true,
  });
  const capItems = overlayItems.filter((d) => CAPACITY_TYPES.has(d.type) && isOverlayActive(d));
  // V2.2d — the zone TINT: a school zone is a DESIGNATION (like signage, it exists all day), so
  // the tint is ALWAYS visible; the speed-limit overlay items above carry the time-truth. The
  // legend row says exactly this so "yellow at t=0, no overlay" never reads as a bug.
  const zoneTagged = !!meta.scenario?.tags?.includes('school_zone');
  const zoneTint = new PathLayer<OverlayItem>({
    id: 'zone-tint',
    data: zoneTagged ? overlayItems : [],
    getPath: (d) => d.path,
    getColor: ZONE_TINT, // translucent school-bus yellow
    getWidth: 14,
    widthUnits: 'pixels',
    capRounded: true,
    jointRounded: true,
  });
  // V2.7b C8b — THE GHOST: the computing run's member, drawn as an outline that reads as inactive
  // because it IS inactive here. It applies to the scenario leg; what is playing is the baseline.
  // Its label lives in the DOM caption rather than a deck TextLayer on purpose — the sentence
  // carries an em-dash, which is outside deck's default characterSet (the V2.2c font-atlas trap).
  const ghostItems = watchedRunNotLoaded && ghostGeom?.runId === feedRunId ? ghostGeom.items : [];
  // V2.7c C2b — the ghost is a PAIR over the SAME items (the seam's `ghost` stays an ITEM count):
  // a dark casing under a DASHED light core. The V2.7b dashed slate was chosen against a light
  // basemap; on the #515459 roadway it vanished into the road it outlines (the re-captured frame
  // beside docs-assets/v27b-c11-ghost-magnified.png is this arc's gate). The dash stays: it is the
  // truer signal — this member is an outline of something not in force, and dashing is already
  // this project's mark for "a different kind of thing" (influence connectors).
  const ghostCasing = new PathLayer<OverlayItem>({
    id: 'ghost-change-casing',
    data: ghostItems,
    getPath: (d) => d.path,
    getColor: GHOST_CASING,
    getWidth: 7,
    widthUnits: 'pixels',
    capRounded: true,
    jointRounded: true,
  });
  const ghostOverlay = new PathLayer<OverlayItem>({
    id: 'ghost-change',
    data: ghostItems,
    getPath: (d) => d.path,
    getColor: GHOST_CORE,
    getWidth: 4,
    widthUnits: 'pixels',
    getDashArray: [7, 5],
    dashJustified: true,
    extensions: [DASH_EXT],
    capRounded: true,
    jointRounded: true,
    // the closure-dash cast idiom: getDashArray rides the extension, not PathLayer's own props
  } as ConstructorParameters<typeof PathLayer<OverlayItem>>[0]);
  const changeOverlay = new PathLayer<OverlayItem>({
    id: 'change-overlay',
    data: legacyItems,
    getPath: (d) => d.path,
    getColor: (d) => (d.type === 'bike_lane' ? BIKE_BAND : EDIT_OVERLAY), // bike green (far band) / amber edit — new_road has its own road-body layers
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
    extensions: [DASH_EXT],
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
    ghostCasing, // V2.7c: the ghost's dark casing — reads on the light ground either side of a road
    ghostOverlay, // V2.7b: Act I only — the computing run's member, not in force in this playback
    changeOverlay, // below the dots (above base) → rerouting cars visibly travel ON the proposed road
    newRoadCasing, // V2.7c C5: the drawn road as a road body (brown casing / grey body / stripes)
    newRoadBody,
    newRoadStripes,
    bikeBand, // V2.7c: the true-width bike lane from z ≥ 15
    closureCasing,
    closureDash,
    backgroundVehicleDots,
    backgroundPersonDots,
    backgroundVehicleIcons, // V2.7c C4: the icons band's travellers (EMPTY below z16)
    backgroundPersonIcons,
    conflictDots,
    conflictPulses,
    instrumentedDots,
    instrumentedIcons,
    flashRing,
    incidentMarkerDot,
    incidentMarkerGlyph,
    windowBadge,
    ...(stage === 'build'
      ? [editEdges, draftRoadCasing, draftRoadBody, draftRoadStripes, draftOverlay, snapTargets, drawPreviewCasing, drawPreview, drawPreviewStripes]
      : []),
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
        // V2.7c — the band listens here, on the map's own events, for every stage. `mapRef` is
        // null in mount effects until the artifact lands (the <Map> renders after the early
        // return), so onLoad is where the first read happens: fitBounds with duration 0 is
        // synchronous, and the zoom read right after it IS the landing zoom.
        onZoom={(e) => onViewZoom(e.viewState.zoom, false)}
        onMoveEnd={(e) => onViewZoom(e.viewState.zoom, true)}
        onLoad={() => {
          const m = mapRef.current?.getMap();
          if (!m) return;
          m.fitBounds(
            [
              [minLon, minLat],
              [maxLon, maxLat],
            ],
            { padding: 40, duration: 0 },
          );
          onViewZoom(m.getZoom(), true);
          // V2.7c C2b — the ground: positron-nolabels' own hues are close to the design's; the
          // overrides make them exact (zero deck cost, zero data). Each id is guarded — a style
          // change upstream degrades to positron's colour, never a crash.
          const paint = (id: string, prop: string, value: unknown) => {
            if (m.getLayer(id)) m.setPaintProperty(id, prop, value);
          };
          paint(BASEMAP.groundLayer, 'background-color', BASEMAP.ground);
          paint(BASEMAP.waterLayer, 'fill-color', BASEMAP.water);
          paint(BASEMAP.waterLayer, 'fill-opacity', BASEMAP.waterOpacity);
          for (const id of BASEMAP.greeneryLayers) {
            paint(id, 'fill-color', BASEMAP.greenery);
            paint(id, 'fill-opacity', BASEMAP.greeneryOpacity);
          }
          setBasemap({
            ground: m.getLayer(BASEMAP.groundLayer) ? m.getPaintProperty(BASEMAP.groundLayer, 'background-color') : null,
            water: m.getLayer(BASEMAP.waterLayer) ? m.getPaintProperty(BASEMAP.waterLayer, 'fill-color') : null,
            greenery: m.getLayer(BASEMAP.greeneryLayers[0]) ? m.getPaintProperty(BASEMAP.greeneryLayers[0], 'fill-color') : null,
          });
        }}
      >
        <DeckOverlay
          layers={layers}
          getTooltip={getTooltip}
          onClick={drawing ? onEditClick : undefined}
          onHover={drawing ? onEditHover : undefined}
          getCursor={drawing ? ({ isDragging }) => (isDragging ? 'grabbing' : 'crosshair') : undefined}
          overlayRef={overlayRef}
        />
      </Map>
      {/* V2.7d C5 — the tile icons pinned where dropped members landed (DOM, map-anchored) */}
      {stage === 'build' && <DraftPins mapRef={mapRef} members={draft} />}

      {/* Map chrome (header / sample note / change legend) belongs to the MAP — hidden while a
          full SHEET covers it (compare and the V2.3d graph split-view both occlude the map). */}
      {/* V2.7a: Read hides the top-left map chrome too — the run document IS the description
          there, and the floating header/legend collide with the panel. */}
      {/* V2.7b C8b: hidden during Act I — it names the LOADED run's change, and the caption two
          inches away is talking about a different one (the screenshot walk caught the collision). */}
      {!sheetMode && !docPanelOpen && !watchedRunNotLoaded && <ScenarioHeader scenario={meta.scenario} rightInset={editing ? 372 : 16} />}

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
                <span style={{ ...legendSwatch, background: css(CAP_DASH_COLOR[overlayItems[0].type]) }} />
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
                <span style={{ ...legendSwatch, background: css(overlayItems[0].type === 'new_road' ? CHEVRON : overlayItems[0].type === 'bike_lane' ? BIKE_BAND : EDIT_OVERLAY) }} />
                {overlayItems.length === 1
                  ? (overlayItems[0].type === 'new_road' ? 'proposed road' : overlayItems[0].type === 'bike_lane' ? 'bike lane' : 'edited street')
                  : `${overlayItems.length} changes`}
              </>
            )}
            {/* V2.2d — the zone row must SAY what always-visible means: at t=0 a viewer sees
                yellow tint and no change overlay, which would read as "zone active, nothing
                applied" without this sentence. */}
            {zoneTagged && (
              <span style={zoneLegendRow} data-testid="legend-zone">
                <span style={{ ...legendSwatch, background: css(ZONE) }} />
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
          dropKind={dropKind}
          dropPartner={dropPartner}
          dropBetween={dropBetween}
          canEditEdges={zoom >= EDGE_ZOOM}
          onEdgeSpeeds={onEdgeSpeeds}
          onEdgeBike={onEdgeBike}
          onEdgeCancel={() => { setSelectedEdge(null); setDropKind(null); setArmedKind(null); }}
          onEdgeLaneClosures={onEdgeLaneClosures}
          onEdgeRoadClosures={onEdgeRoadClosures}
          onEdgeIncident={onEdgeIncident}
          onWindowedDraft={setDraftWindowed}
          windowLocked={windowLocked}
          zoneMode={zoneMode}
          zoneEdges={zoneEdges}
          onZoneToggle={onZoneToggle}
          armedKind={armedKind}
          onArm={onArm}
          onDrop={onDropAt}
          dropMiss={dropMiss}
          onZoneRemove={onZoneRemove}
          onZoneSubmit={onZoneSubmit}
          onZoneCancel={onZoneCancel}
          draftMembers={draft}
          nameOf={(id) => networkLookup[id]?.name ?? null}
          draftTags={draftTags}
          draftBlockers={draftBlockers}
          draftError={draftError}
          onDraftRemove={onDraftRemove}
          onDraftSwitchDayOne={onFixSwitchDayOne}
          onDraftRemoveWindow={onFixRemoveWindow}
          onDraftRemoveMember={onFixRemoveMember}
          onDraftRun={runDraft}
          onDraftHover={setHoveredDraftId}
          onClone={cloneToDraft}
        />
      ) : stage === 'watch' && actTwo ? (
        // V2.7b C9 — ACT II. The map's job is over (Act I ended, the artifact is this run's); the
        // interpretation gets the surface. Live-only: a finished run reopened from the list never
        // reaches here, so the ordinary Watch layout below is what it gets.
        <ActTwo
          experience={runFeed.experience}
          artifact={artifact}
          network={networkEdges}
          onSkip={onSkip}
          skipping={skipping}
          skipError={skipError}
          graphPanel={
            <DiscourseStage
              stage={runFeed.experience.stages.find((s) => s.key === 'discourse')!}
              // the triple run-id guard, same as GraphSplitView's call site: a sidecar for another
              // run is never handed to a panel that would render it as this one's
              graphs={graphsSidecar?.runId === meta.run_id ? graphsSidecar.data : null}
              onOpenDiscourse={() => {
                setStage('explore');
                setExploreSub('discourse');
              }}
            />
          }
          reportPanel={
            <ReportStage
              experience={runFeed.experience}
              artifact={artifact}
              // THE MERGE IS SCAFFOLDING: while the report stage runs this is the facts-only
              // document plus whatever slots have landed; at stage_end the fetch above re-reads
              // the written file and this becomes the file itself.
              report={
                reportData?.runId === meta.run_id
                  ? reportStageDone
                    ? reportData.report
                    : mergeSlots(reportData.report, runFeed.experience.slots)
                  : null
              }
              reportState={reportData?.runId === meta.run_id ? reportData.state : 'loading'}
              isExample={isExample}
              liveName={liveIdentity?.runId === meta.run_id ? liveIdentity.name : null}
              onGroupDoorway={(g) => {
                setFeedGroup(g);
                setStage('watch');
              }}
              onGroupInterview={(agent) => {
                setInterviewee(agent);
                setStage('watch');
              }}
              onGroupRoom={seedRoom}
            />
          }
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
              ghost={ghostItems.length > 0}
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
                demandProfile={meta.demand_profile}
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
                seededFrom={roomSeededFrom}
              />
            )}
          </div>
          {/* V2.7b C10b — the finished run's article, in the document panel it shares with Read.
              It is the last of the two acts' surfaces: while a run computes Watch belongs to the
              run experience, and when it finishes this says what the playback is and why a reader
              might scrub through it. Collapsible like every other document panel. */}
          <DocumentPanel
            title="WATCH — THIS RUN, REPLAYED"
            collapsed={watchDocCollapsed}
            onToggle={setWatchDocCollapsed}
            topOffset={78}
            // clear the playback bar: its Play button is at the bar's LEFT end, under a
            // left-anchored panel, and the panel would otherwise cover it (V2.7b C11)
            bottomOffset={playbackBarHidden ? 20 : PLAYBACK_BAR_CLEARANCE}
          >
            <WatchArticle
              // the reader's own name for the run wins; else the change's own sentence
              description={(liveIdentity?.runId === meta.run_id ? liveIdentity.name : null)
                ?? changesOf(artifact)[0]?.description ?? null}
              vehicles={artifact.vehicles.length}
              conflicts={conflicts.length}
              simStart={meta.sim_start}
              simEnd={meta.sim_end}
              demandProfile={meta.demand_profile}
            />
          </DocumentPanel>
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
              demandProfile={meta.demand_profile}
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
          title={`RUN DOCUMENT — ${(feedRunId ?? '').replace('multimodal-scenario-', '')}`}
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
            interpretation={interpretation}
            onGroupDoorway={(g) => {
              // the 2.4 HEAR door: this group's voices, in Watch (the existing scorecard→feed join)
              setFeedGroup(g);
              setStage('watch');
            }}
            onGroupInterview={(agent) => {
              // V2.7e — the ASK door: the drawer on the group's pick (the artifact's own element)
              setInterviewee(agent);
              setStage('watch');
            }}
            onGroupRoom={seedRoom}
            // V2.7e — Act II holds Watch (no feed, no drawer to land on); Act I never reaches here
            // (Read shows the not-computed panel instead of a document)
            doorwaysBlocked={actTwo}
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
        runLabelText={(actOne ? feedRunId! : meta.run_id).replace('multimodal-scenario-', '')}
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
              setFeedRunId(id);
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
