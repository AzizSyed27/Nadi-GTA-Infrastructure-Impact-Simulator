// V2.7c — the base ROAD layers as a PURE builder (the graphLayers.buildOasisLayers precedent):
// data in, deck layers out, no React, no window. MapView memoizes the result on the data
// identities, so the road buffers build once and playback never rebuilds them.
//
// THE ZOOM LADDER lives here too. deck accessors never see the viewport, and a layer's `visible`
// flag keeps its buffers while omitting it from the layer array destroys them — so the ladder is
// a small set of STATIC per-band layers toggled with `visible`, keyed on a quantized BAND that
// MapView derives from the map's own zoom events. The thresholds are the ratified rules
// (z ≥ 15 lane detail + chevrons, z ≥ 16 mode icons); their numbers come from the brief, not
// the mockup, and map-ladder.spec.ts pins them as literals on both sides of each rung.

import { IconLayer, PathLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { ArrowAnchor, NetworkEdge } from './network';
import { LANE_M, ONE_WAY_ARROW, ROAD_CASING, ROAD_FILL, ROAD_FILL_BIKE } from './mapPalette';

export type ZoomBand = 'far' | 'lanes' | 'icons';

/** Lane striping + direction chevrons appear at and above this zoom (ratified rung 2). */
export const BAND_LANES_ZOOM = 15;
/** Travellers become heading-rotated mode icons at and above this zoom (ratified rung 3). */
export const BAND_ICONS_ZOOM = 16;

/** The band a zoom falls in — inclusive at each rung, so 15.0 is already lane detail. */
export function zoomBand(zoom: number): ZoomBand {
  if (zoom >= BAND_ICONS_ZOOM) return 'icons';
  if (zoom >= BAND_LANES_ZOOM) return 'lanes';
  return 'far';
}

/** Zoom rounded to 0.25 — the chevron memo's key (a rebuild per gesture, never per frame). */
export function quantizeZoom(zoom: number): number {
  return Math.round(zoom * 4) / 4;
}

export interface RoadLayerInputs {
  edges: NetworkEdge[];
  arrows: ArrowAnchor[];
}

/**
 * Today's three base layers, extracted verbatim (C1): dark casing (wider) UNDER a light fill
 * (narrower) — deck has no casing prop, stacking is the idiom — and one direction arrow per
 * one-way edge at its midpoint. Returns [] for an empty network so nothing draws before it lands.
 */
export function buildRoadLayers({ edges, arrows }: RoadLayerInputs): Layer[] {
  if (edges.length === 0) return [];
  const casing = new PathLayer<NetworkEdge>({
    id: 'network-casing', data: edges, getPath: (e) => e.geometry, getColor: ROAD_CASING,
    getWidth: (e) => e.lanes * LANE_M + 2.4, widthUnits: 'meters', widthMinPixels: 2.5, widthMaxPixels: 42,
    capRounded: true, jointRounded: true, pickable: false,
  });
  const fill = new PathLayer<NetworkEdge>({
    id: 'network-fill', data: edges, getPath: (e) => e.geometry,
    getColor: (e) => (e.allows.bike ? ROAD_FILL_BIKE : ROAD_FILL), // bike-permitted edges subtly greener
    getWidth: (e) => e.lanes * LANE_M, widthUnits: 'meters', widthMinPixels: 1, widthMaxPixels: 38,
    capRounded: true, jointRounded: true, pickable: false,
  });
  // Dynamic-icon mode (getIcon returns the sprite descriptor) — more reliable than a pre-packed atlas.
  const oneWay = new IconLayer<ArrowAnchor>({
    id: 'one-way-arrows', data: arrows, getPosition: (d) => d.position,
    getAngle: (d) => 360 - d.bearing, // map bearing is cw-from-north; deck getAngle is ccw → negate
    getIcon: () => ({ url: '/arrow.png', width: 32, height: 32, mask: true, anchorX: 16, anchorY: 16 }),
    getSize: 15, sizeUnits: 'pixels', getColor: ONE_WAY_ARROW, billboard: true, pickable: false,
  });
  return [casing, fill, oneWay];
}

/** The seam's view of a layer list: id, visibility, row count — what map-ladder.spec pins. */
export function describeLayers(layers: Layer[]): { id: string; visible: boolean; count: number }[] {
  return layers.map((l) => {
    const d = (l.props as { data?: unknown }).data;
    return { id: l.id, visible: l.props.visible !== false, count: Array.isArray(d) ? d.length : 0 };
  });
}
