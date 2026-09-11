// V2.7c — the base ROAD layers as a PURE builder (the graphLayers.buildOasisLayers precedent):
// derived rows in, deck layers out, no React, no window. MapView memoizes the rows on the network
// identity and the layers on [rows, band], so the road buffers build once and playback never
// rebuilds them (deck diffs constant props; the row arrays keep their identity across bands).
//
// THE ZOOM LADDER lives here. deck accessors never see the viewport, and a layer's `visible` flag
// keeps its buffers while omitting it from the layer array destroys them — so the ladder is a
// small set of STATIC per-band layers toggled with `visible`, keyed on a quantized BAND that
// MapView derives from the map's own zoom events. The thresholds are the ratified rules
// (z ≥ 15 lane detail + chevrons, z ≥ 16 mode icons); their numbers come from the brief, not
// the mockup, and map-ladder.spec.ts pins them as literals on both sides of each rung.
//
// THE FAR BAND (every zoom) is "centerline only": the sidewalk ribbon UNDER the road body UNDER
// the painted centerline — width ∝ lane count from the lane model, and no direction marks (the
// one-way arrows of V2.0b retired here; chevrons are the z ≥ 15 rung).

import { IconLayer, PathLayer } from '@deck.gl/layers';
import { PathStyleExtension } from '@deck.gl/extensions';
import type { Layer } from '@deck.gl/core';
import type { CenterlineRow, ChevronAnchor, RoadRow, RoadRows } from './roadGeometry';
import { CENTERLINE, CHEVRON, ROADWAY, SIDEWALK } from './mapPalette';

// The chevron glyph: an SVG data URL (no binary asset — the V2.0b /arrow.png is deleted), NORTH at angle 0,
// masked so the layer's colour applies. Explicit width/height — loaders.gl needs them on an SVG root.
const CHEVRON_ICON = {
  url:
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
        '<path d="M7 22 L16 10 L25 22" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    ),
  width: 32,
  height: 32,
  mask: true,
  anchorX: 16,
  anchorY: 16,
};

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

// ONE extension instance for every dashed layer — a `new PathStyleExtension` per render was the
// V2.7b per-frame allocation the plan retires.
const DASH = new PathStyleExtension({ dash: true });
/** The collector centerline's dash, in units of the line's own width (the design's `9 12`). */
const COLLECTOR_DASH: [number, number] = [9, 12];
/** A lane stripe's dash (a real lane marking: short white dashes), in units of its 1 px width. */
const STRIPE_DASH: [number, number] = [4, 4];
/** A dash with no gap renders solid — the arterial centerline through the same layer. */
const SOLID: [number, number] = [1e6, 0];

export interface RoadLayerInputs {
  rows: RoadRows;
  band: ZoomBand;
  /** Chevron anchors at the CURRENT quantized zoom (empty at the far band — the walk is skipped there). */
  chevrons: ChevronAnchor[];
  /** The glyph size at that zoom (roadGeometry.chevronSizePx — scales with the lane pixel pitch). */
  chevronSizePx: number;
}

/**
 * The far band's layers (C2a). Pixel clamps: at the overview zoom every road is sub-pixel (a
 * 3.2 m lane is 0.46 px at z13), so the body floors at 1.5 px and the ribbon at 3 px — the ribbon
 * reads as a light halo at the overview and becomes a true one-sided 2.0 m sidewalk once a metre
 * is wider than a pixel (z ≥ 16). The painted centerline is a fixed 1.4 px: solid on arterials at
 * every zoom; the collector dash is BUILT here too but `visible` only from the lanes band (the
 * buffers persist across the toggle — deck keeps an invisible layer's state).
 */
export function buildRoadLayers({ rows, band, chevrons, chevronSizePx }: RoadLayerInputs): Layer[] {
  if (rows.body.length === 0) return [];
  const sidewalk = new PathLayer<RoadRow>({
    id: 'road-sidewalk', data: rows.sidewalk, getPath: (d) => d.path, getColor: SIDEWALK,
    getWidth: (d) => d.widthM, widthUnits: 'meters', widthMinPixels: 3, widthMaxPixels: 30,
    capRounded: true, jointRounded: true, pickable: false,
  });
  const body = new PathLayer<RoadRow>({
    id: 'road-body', data: rows.body, getPath: (d) => d.path, getColor: ROADWAY,
    getWidth: (d) => d.widthM, widthUnits: 'meters', widthMinPixels: 1.5, widthMaxPixels: 60,
    capRounded: true, jointRounded: true, pickable: false,
  });
  const centerline = new PathLayer<CenterlineRow>({
    id: 'road-centerline', data: rows.centerline, getPath: (d) => d.path, getColor: CENTERLINE,
    getWidth: 1.4, widthUnits: 'pixels', capRounded: false, jointRounded: true, pickable: false,
    getDashArray: SOLID, extensions: [DASH],
  } as ConstructorParameters<typeof PathLayer<CenterlineRow>>[0]); // the closure-dash cast idiom
  const collector = new PathLayer<CenterlineRow>({
    id: 'road-centerline-collector', data: rows.collectorCenterline, getPath: (d) => d.path,
    getColor: CENTERLINE, getWidth: 1.4, widthUnits: 'pixels', capRounded: false, jointRounded: true,
    pickable: false, visible: band !== 'far', getDashArray: COLLECTOR_DASH, extensions: [DASH],
  } as ConstructorParameters<typeof PathLayer<CenterlineRow>>[0]);
  // C3a — THE LANES BAND (z ≥ 15): white striping on every internal car-lane boundary. Built at load
  // (~2,300 rows on the canonical net — small enough that lazy construction buys nothing) and
  // toggled with `visible`. At exactly z15 a 3.2 m lane is 1.85 px, so the stripes are a fine
  // texture there and become legible lanes by z16 (3.7 px) — the ratified threshold, with the
  // data-derived pixel-pitch floor recorded as the looked-at gate's exit (the V2.7c plan, 4a).
  const stripes = new PathLayer<CenterlineRow>({
    id: 'road-stripes', data: rows.stripes, getPath: (d) => d.path, getColor: CENTERLINE,
    getWidth: 1, widthUnits: 'pixels', capRounded: false, jointRounded: true, pickable: false,
    visible: band !== 'far', getDashArray: STRIPE_DASH, extensions: [DASH],
  } as ConstructorParameters<typeof PathLayer<CenterlineRow>>[0]);
  // C3b — direction chevrons at constant on-screen spacing (roadGeometry.chevronAnchors), rebuilt
  // once per zoom gesture (the anchors are keyed on the quantized zoom), hidden below z15.
  const chevronLayer = new IconLayer<ChevronAnchor>({
    id: 'road-chevrons', data: chevrons, getPosition: (d) => d.position,
    getAngle: (d) => 360 - d.bearing, // map bearing is cw-from-north; deck getAngle is ccw → negate
    getIcon: () => CHEVRON_ICON, getSize: chevronSizePx, sizeUnits: 'pixels', getColor: CHEVRON, billboard: true,
    pickable: false, visible: band !== 'far',
    updateTriggers: { getSize: chevronSizePx },
  });
  return [sidewalk, body, centerline, collector, stripes, chevronLayer];
}

/** The seam's view of a layer list: id, visibility, row count — what map-ladder.spec pins. */
export function describeLayers(layers: Layer[]): { id: string; visible: boolean; count: number }[] {
  return layers.map((l) => {
    const d = (l.props as { data?: unknown }).data;
    return { id: l.id, visible: l.props.visible !== false, count: Array.isArray(d) ? d.length : 0 };
  });
}
