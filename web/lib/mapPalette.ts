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
/** #2f3133 — one traveller, any mode (mode is legible from the icon at z ≥ 16, never from colour). */
export const TRAVELER: Rgba = [47, 49, 51, 255];
