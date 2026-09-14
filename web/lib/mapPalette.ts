// V2.7c — the map's colour constants in ONE module. Before this, every road colour was an inline
// literal in MapView.tsx and the change legend hand-duplicated the same hexes into DOM swatches
// (three places to drift). Layers read the RGBA tuples; DOM swatches read `css()` of the same
// tuple, so the two can never disagree.
//
// THE TRANSIT-MAP PALETTE (the ratified design's legend swatches, recovered verbatim — see the
// V2.7c plan; these are map-specific and deliberately NOT nadi.css tokens): "a printed-transit-map
// language: the network data already knows what every lane is, so the figure shows it — muted,
// credible, never a hero image."

export type Rgba = [number, number, number, number];

/** `rgb(r,g,b)` for a DOM swatch — alpha deliberately dropped (a swatch is a chip, not a layer). */
export const css = (c: Rgba): string => `rgb(${c[0]},${c[1]},${c[2]})`;

/** #515459 — the roadway (car lanes), width ∝ lane count. */
export const ROADWAY: Rgba = [81, 84, 89, 255];
/** #d2d2d5 — the sidewalk, a lighter ribbon at the curb. */
export const SIDEWALK: Rgba = [210, 210, 213, 255];
/** #f2f2f3 — the painted centerline (solid on arterials, dashed on collectors); also the ground. */
export const CENTERLINE: Rgba = [242, 242, 243, 255];
/** #96625c — direction chevrons (z ≥ 15) and the "proposed" mark on a drawn road. */
export const CHEVRON: Rgba = [150, 98, 92, 255];
/** #8fae87 — a dedicated bike lane band (rendered for the scenario's bike_lane CHANGE only). */
export const BIKE_BAND: Rgba = [143, 174, 135, 255];
/** #96625c — a dedicated BUS lane band (the design's "muted red"). V2.7c's "no bus data" row was
 *  false-premised: the per-lane table (V2.7d) shows 23 bus+bike lanes on the canonical net. */
export const BUS_BAND: Rgba = [150, 98, 92, 255];
/** #2f3133 — one traveller, any mode (mode is legible from the icon at z ≥ 16, never from colour). */
export const TRAVELER: Rgba = [47, 49, 51, 255];
/** The 1 px light rim on a background traveller — a dark dot on the dark roadway needs one. */
export const TRAVELER_RIM: Rgba = [242, 242, 243, 200];
/** Instrumented-vehicle trails (faint by design; light so they read on the dark roadway). */
export const TRAIL: Rgba = [235, 236, 238, 255];

// ---- Act I's ghost: the computing run's member, an outline of something NOT in force here. On the
// #515459 roadway the V2.7b dashed slate vanished into the road it outlined (the C11 baseline frame is
// docs-assets/v27b-c11-ghost-magnified.png), so the ghost is a PAIR: a dark casing under a dashed light
// core, which reads on the dark body AND on the light ground either side of it.
export const GHOST_CASING: Rgba = [47, 49, 51, 230];
export const GHOST_CORE: Rgba = [242, 242, 243, 240];

// ---- The change overlays (V2.2c per-type styling; values unchanged from MapView's inline tables).
export const CAP_CASING: Record<string, Rgba> = {
  lane_closure: [42, 42, 48, 235], road_closure: [110, 22, 22, 240], incident: [125, 62, 12, 240],
};
export const CAP_DASH_COLOR: Record<string, Rgba> = {
  lane_closure: [250, 190, 40, 240], road_closure: [225, 62, 50, 245], incident: [246, 122, 40, 245],
};
export const CAP_DASH: Record<string, [number, number]> = {
  lane_closure: [4, 3], road_closure: [1.5, 1.5], incident: [3, 2],
};
/** An edited street (speed limit) — amber. A drawn road is a ROAD BODY under a CHEVRON-brown casing (C5). */
export const EDIT_OVERLAY: Rgba = [245, 170, 40, 230];
/** The school-zone designation tint (always shown) — school-bus yellow. */
export const ZONE: Rgba = [255, 200, 40, 255];
export const ZONE_TINT: Rgba = [255, 200, 40, 90];
/** The draft basket's hovered member — the CHEVRON brown, which reads on the dark roadway AND on the
 *  light ground (a drawn road lies off-network). The V2.4a dark slate vanished on #515459. */
export const DRAFT_HOVER: Rgba = [150, 98, 92, 250];
/** Build-stage edge tint for a not-bike-eligible edge — light, so it reads over the dark roadway. */
export const EDIT_TINT_NEUTRAL: Rgba = [225, 228, 235, 170];

// ---- Surrogate near-miss markers (never a crash claim): the flare pulse and the resting dot.
export const CONFLICT_PULSE: Rgba = [235, 140, 60, 255];
export const CONFLICT_DOT: Rgba = [120, 120, 132, 110];

// ---- The basemap (CARTO positron-nolabels) is the GROUND: its own hues are close to the design's
// and are overridden on load to the exact swatches — zero deck cost, zero data. The layer ids are
// positron's (probed 2026-09-11); a missing id is skipped, never a crash.
export const BASEMAP = {
  ground: '#f2f2f3',
  water: '#d7e1e7',
  greenery: '#e0e7dc',
  waterOpacity: 0.7,
  greeneryOpacity: 0.7,
  groundLayer: 'background',
  waterLayer: 'water',
  greeneryLayers: ['landcover', 'park_national_park', 'park_nature_reserve', 'landuse'],
} as const;
