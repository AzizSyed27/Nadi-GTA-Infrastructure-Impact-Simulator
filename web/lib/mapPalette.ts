// V2.7c — the map's colour and width constants in ONE module. Before this, every road colour was
// an inline literal in MapView.tsx and the change legend hand-duplicated the same hexes into DOM
// swatches (three places to drift). Layers read the RGBA tuples; DOM swatches read the `css`
// twins, which are derived from the same tuples so the two can never disagree.
//
// C1 MOVES today's values without changing any of them (the byte-identical extraction — the
// harness numbers and a same-viewport screenshot pair are the proof). The transit-map palette
// lands in C2a.

export type Rgba = [number, number, number, number];

/** `rgb(r,g,b)` for a DOM swatch — alpha deliberately dropped (a swatch is a chip, not a layer). */
export const css = (c: Rgba): string => `rgb(${c[0]},${c[1]},${c[2]})`;

// Base road rendering (V2.0b). Width scales with lanes in METERS so it tracks zoom; clamped in pixels.
export const LANE_M = 3.2; // approx lane width for the rendered road body
export const ROAD_CASING: Rgba = [70, 74, 82, 220]; // dark casing under the fill
// ~98% of edges permit bikes (mixed traffic), so the tint is a WHISPER: bike-permitted reads as the neutral
// default and the rare non-bike edges (highways/ramps) quietly stand apart.
export const ROAD_FILL: Rgba = [214, 214, 219, 255]; // plain grey (non-bike, the minority)
export const ROAD_FILL_BIKE: Rgba = [208, 216, 211, 255]; // whisper green = bike-permitted
export const ONE_WAY_ARROW: Rgba = [66, 72, 86, 235]; // dark, reads on the light road
