// V2.7c — the ZOOM LADDER seams. The map's appearance was pinned by NOTHING before this arc: no
// spec set a zoom, and the only visual instruments were human-compared screenshots and the perf
// harness. This spec is the measurable half of the pixels arc — it pins which road layers render,
// with how many rows, at which zoom BAND — through two SIBLING seams (`__nadiViewport`,
// `__nadiRoadLayers`); never through caption or legend text, and never as new keys on
// `__nadiRenderStats` (compact-run.spec's whole-object toEqual owns that object).
//
// The network is a HAND-WRITTEN fixture (the edit.spec two-edge idiom), so every count below is a
// hand-computed literal that survives V2.7d's netconvert regen — plus ONE real-network smoke in
// the last test, whose assertions are structural (> 0 / band), never counts.
//
// `jumpTo` fires maplibre's move/zoom events SYNCHRONOUSLY, but the band lands on the next React
// render — every read after a jump is an `expect.poll`, never an immediate evaluate.

import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BAND_ICONS_ZOOM, BAND_LANES_ZOOM, zoomBand } from '../lib/roadLayers';

const RUN_ID = 'compact-fixture';
const FIXTURE = path.join(__dirname, 'fixtures', 'compact-run.json'); // bbox [-79.3, 43.7, -79.2, 43.8]

// The fixture net: one two-way pair — A (3 lanes: 2 car + a sidewalk → an ARTERIAL direction) and
// -A (2 lanes: 1 car + a sidewalk → a COLLECTOR direction), both allows.ped — and one one-way edge
// (B, 1 lane, no sidewalk). Lon/lat inside the artifact's bbox.
const NET = {
  edges: [
    { id: 'A', geometry: [[-79.26, 43.75], [-79.25, 43.75]], lanes: 3, speed_mps: 13.89, oneway: false, allows: { car: true, bike: true, ped: true } },
    { id: '-A', geometry: [[-79.25, 43.7501], [-79.26, 43.7501]], lanes: 2, speed_mps: 13.89, oneway: false, allows: { car: true, bike: true, ped: true } },
    { id: 'B', geometry: [[-79.25, 43.76], [-79.24, 43.76]], lanes: 1, speed_mps: 13.89, oneway: true, allows: { car: true, bike: true, ped: false } },
  ],
};
const CENTER: [number, number] = [-79.25, 43.755];

type Viewport = { zoom: number; band: 'far' | 'lanes' | 'icons'; jumpTo: (lon: number, lat: number, zoom: number) => void };
type RoadLayers = { band: string; zoomQ: number; layers: { id: string; visible: boolean; count: number }[] };

const viewport = (page: Page) =>
  page.evaluate(() => {
    const v = (window as unknown as { __nadiViewport?: Viewport }).__nadiViewport;
    return v ? { zoom: v.zoom, band: v.band } : null;
  });
const roadLayers = (page: Page) =>
  page.evaluate(() => (window as unknown as { __nadiRoadLayers?: RoadLayers }).__nadiRoadLayers ?? null);
const jumpTo = (page: Page, lon: number, lat: number, zoom: number) =>
  page.evaluate(([lo, la, z]) => (window as unknown as { __nadiViewport: Viewport }).__nadiViewport.jumpTo(lo, la, z), [lon, lat, zoom]);

async function mockBackend(page: Page, net: unknown = NET, mutate?: (artifact: Record<string, unknown>) => void) {
  let body = fs.readFileSync(FIXTURE, 'utf-8');
  if (mutate) {
    const a = JSON.parse(body) as Record<string, unknown>;
    mutate(a);
    body = JSON.stringify(a);
  }
  await page.route('**/api/junctions**', (route) => route.fulfill({ json: { junctions: [], count: 0 } }));
  await page.route('**/api/edges**', (route) => route.fulfill({ json: { edges: [], count: 0 } }));
  await page.route('**/api/runs', (route) => route.fulfill({ json: { runs: [] } }));
  if (net) await page.route('**/network.json', (route) => route.fulfill({ json: net }));
  await page.route(`**/${RUN_ID}.json`, async (route) => {
    await new Promise((res) => setTimeout(res, 500)); // the StrictMode tiny-fixture floor
    await route.fulfill({ body, contentType: 'application/json' });
  });
}

async function openWatch(page: Page) {
  await page.goto(`/?run=${RUN_ID}`);
  await page.getByTestId('stage-build').waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
  await page.reload();
  await expect(page.getByTestId('stage-build')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('stage-watch').click();
  await expect(page.getByTestId('comment-feed')).toBeVisible({ timeout: 20_000 });
}

// ---- the pure band function: literals pinned BOTH sides of each threshold ----

test('zoom bands: 15 and 16 are the ratified thresholds, inclusive at the rung', () => {
  expect(BAND_LANES_ZOOM).toBe(15);
  expect(BAND_ICONS_ZOOM).toBe(16);
  expect(zoomBand(12.7)).toBe('far');
  expect(zoomBand(14.999)).toBe('far');
  expect(zoomBand(15)).toBe('lanes');
  expect(zoomBand(15.999)).toBe('lanes');
  expect(zoomBand(16)).toBe('icons');
  expect(zoomBand(18.5)).toBe('icons');
});

// ---- the seams over the fixture net ----

test('the landing is the far band: fitBounds zoom is published and the road layers are the three base layers', async ({ page }) => {
  await mockBackend(page);
  await openWatch(page);
  await expect.poll(async () => (await viewport(page))?.band, { timeout: 20_000 }).toBe('far');
  const v = await viewport(page);
  expect(v!.zoom).toBeGreaterThan(9); // fitBounds over a 0.1° bbox at 1280×720 — never the initial 12 literal
  expect(v!.zoom).toBeLessThan(BAND_LANES_ZOOM);
  const rl = await roadLayers(page);
  expect(rl!.band).toBe('far');
  // C2a — the far band is "centerline only": the sidewalk ribbon under the road body under the
  // painted centerline, and NO direction marks (chevrons are the z ≥ 15 rung). Row counts are
  // hand-computed from the fixture: 3 edges; 2 with a sidewalk (A, -A — allows.ped); the two-way
  // edges carry a centerline (B is one-way — no opposing direction, no painted line): A's is the
  // solid ARTERIAL line (every zoom), -A's the dashed COLLECTOR line, which is built but HIDDEN
  // below z15 — at the overview a 1.4 px dash on a 2 px road dithers to noise (looked-at catch on
  // the C2a frame), so the collector dash joins the lane-detail rung.
  // C3a: the lane stripes (every INTERNAL car-lane boundary) are built at load and hidden below z15:
  // A has 2 car lanes → 1 stripe; -A and B have 1 car lane → none.
  expect(rl!.layers).toEqual([
    { id: 'road-sidewalk', visible: true, count: 2 },
    { id: 'road-body', visible: true, count: 3 },
    { id: 'road-centerline', visible: true, count: 1 },
    { id: 'road-centerline-collector', visible: false, count: 1 },
    { id: 'road-stripes', visible: false, count: 1 },
    // C3b: no chevrons are computed at the far band (the memo skips the walk) — count 0, hidden
    { id: 'road-chevrons', visible: false, count: 0 },
  ]);
});

test('chevrons appear at the lanes band at 160 px spacing: 9 over the fixture net at z15.2', async ({ page }) => {
  await mockBackend(page);
  await openWatch(page);
  const chevrons = async () => (await roadLayers(page))?.layers.find((l) => l.id === 'road-chevrons');
  await expect.poll(async () => (await chevrons())?.visible, { timeout: 20_000 }).toBe(false);
  await jumpTo(page, CENTER[0], CENTER[1], 15.2);
  await expect.poll(async () => (await chevrons())?.visible, { timeout: 10_000 }).toBe(true);
  // HAND-DERIVED: zoomQ = 15.25; the artifact bbox centre lat = 43.75 → mpp = 78271.517·cos(43.75°)/2^15.25
  // = 1.4509 m/px → spacing 232.1 m. Each fixture edge spans 0.01° of longitude ≈ 803 m → chevrons at
  // 116, 348, 580 m (812 > 803) → 3 per edge × 3 edges (A, -A, B — every direction, not only one-way).
  // -A's end lies 11 m from A's start but heads the opposite way (Δ180°) → no chain.
  await expect.poll(async () => (await chevrons())?.count, { timeout: 10_000 }).toBe(9);
  // z16.25 → mpp 0.7255 → spacing 116 m → 58, 174, …, 754 → 7 per edge → 21
  await jumpTo(page, CENTER[0], CENTER[1], 16.2);
  await expect.poll(async () => (await chevrons())?.count, { timeout: 10_000 }).toBe(21);
});

test('lane stripes are hidden at the far band and shown from the lanes band (built once, toggled)', async ({ page }) => {
  await mockBackend(page);
  await openWatch(page);
  const stripes = async () => (await roadLayers(page))?.layers.find((l) => l.id === 'road-stripes');
  await expect.poll(async () => (await stripes())?.visible, { timeout: 20_000 }).toBe(false);
  await jumpTo(page, CENTER[0], CENTER[1], 15.2);
  await expect.poll(async () => (await stripes())?.visible, { timeout: 10_000 }).toBe(true);
  expect((await stripes())?.count).toBe(1);
  await jumpTo(page, CENTER[0], CENTER[1], 16.2);
  await expect.poll(async () => (await stripes())?.visible, { timeout: 10_000 }).toBe(true); // icons band keeps lane detail
});

test('the collector centerline is hidden at the far band and shown from the lanes band (built once, toggled)', async ({ page }) => {
  await mockBackend(page);
  await openWatch(page);
  const collector = async () => (await roadLayers(page))?.layers.find((l) => l.id === 'road-centerline-collector');
  await expect.poll(async () => (await collector())?.visible, { timeout: 20_000 }).toBe(false);
  await jumpTo(page, CENTER[0], CENTER[1], 15.2);
  await expect.poll(async () => (await collector())?.visible, { timeout: 10_000 }).toBe(true);
  expect((await collector())?.count).toBe(1); // the same row — toggled, not rebuilt
  await jumpTo(page, CENTER[0], CENTER[1], 14.8);
  await expect.poll(async () => (await collector())?.visible, { timeout: 10_000 }).toBe(false);
});

test('jumpTo crosses the rungs: z15.2 is the lanes band, z16.2 the icons band, and back', async ({ page }) => {
  await mockBackend(page);
  await openWatch(page);
  await expect.poll(async () => (await viewport(page))?.band, { timeout: 20_000 }).toBe('far');

  await jumpTo(page, CENTER[0], CENTER[1], 15.2);
  await expect.poll(async () => (await viewport(page))?.band, { timeout: 10_000 }).toBe('lanes');
  expect((await viewport(page))!.zoom).toBeCloseTo(15.2, 3);
  await expect.poll(async () => (await roadLayers(page))?.band, { timeout: 10_000 }).toBe('lanes');
  expect((await roadLayers(page))!.zoomQ).toBe(15.25); // quantized to 0.25 for the chevron memo

  await jumpTo(page, CENTER[0], CENTER[1], 16.2);
  await expect.poll(async () => (await viewport(page))?.band, { timeout: 10_000 }).toBe('icons');
  expect((await roadLayers(page))!.zoomQ).toBe(16.25);

  await jumpTo(page, CENTER[0], CENTER[1], 13);
  await expect.poll(async () => (await viewport(page))?.band, { timeout: 10_000 }).toBe('far');
  expect((await roadLayers(page))!.zoomQ).toBe(13);
});

test('a band crossing never touches the entity join (the render-stats seam is a sibling, untouched)', async ({ page }) => {
  await mockBackend(page);
  await openWatch(page);
  await expect.poll(async () => (await viewport(page))?.band, { timeout: 20_000 }).toBe('far');
  const before = await page.evaluate(() => (window as unknown as { __nadiRenderStats?: unknown }).__nadiRenderStats);
  await jumpTo(page, CENTER[0], CENTER[1], 16.2);
  await expect.poll(async () => (await viewport(page))?.band, { timeout: 10_000 }).toBe('icons');
  const after = await page.evaluate(() => (window as unknown as { __nadiRenderStats?: unknown }).__nadiRenderStats);
  expect(after).toEqual(before);
});

// ---- the icons band (C4): "Dots become overhead mode icons rotated to heading. The only rung that changes
// travellers." The swap is a DATA swap (a hidden per-frame layer would still regenerate its attributes every
// tick), mirrored by the sibling seam `__nadiTravelers` as row counts per family, so the pin is conservation:
// every active traveller is drawn exactly once, as a dot below z16 and as an icon from z16. ----

test('travellers are dots below z16 and mode icons from z16 — every active traveller drawn once, never twice', async ({ page }) => {
  await mockBackend(page);
  await openWatch(page);
  type Trav = { band: string; dots: number; icons: number; instrumentedDots: number; instrumentedIcons: number };
  const trav = () => page.evaluate(() => (window as unknown as { __nadiTravelers?: Trav }).__nadiTravelers ?? null);
  // the compact fixture's entities live at sim-times 4..9 s (t0 = 4, dt = 1) — scrub INTO them
  await page.locator('input[type=range]').first().fill('6');
  await expect.poll(async () => (await trav())?.dots ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);
  const far = (await trav())!;
  expect(far.band).toBe('far');
  expect(far.icons).toBe(0);
  expect(far.instrumentedIcons).toBe(0);
  expect(far.instrumentedDots).toBe(1); // the fixture pins ONE agent to a trip (compact-run.spec's pinnedAgents)
  await jumpTo(page, CENTER[0], CENTER[1], 16.2);
  await expect.poll(async () => (await trav())?.band, { timeout: 10_000 }).toBe('icons');
  const icons = (await trav())!;
  expect(icons.dots).toBe(0);
  expect(icons.icons).toBe(far.dots); // the same travellers, now icons
  expect(icons.instrumentedDots).toBe(0);
  expect(icons.instrumentedIcons).toBe(1);
  await jumpTo(page, CENTER[0], CENTER[1], 15.5);
  await expect.poll(async () => (await trav())?.band, { timeout: 10_000 }).toBe('lanes');
  expect((await trav())!.icons).toBe(0); // the lanes band keeps dots — the lane switch and the icon switch never share a gesture
  expect((await trav())!.dots).toBe(far.dots);
});

// ---- a drawn road (C5): the playback overlay of a new_road renders as a ROAD BODY at Change.lanes × 3.2 m
// with white striping from the lanes band and a thin chevron-brown casing as the "proposed" mark — never
// the V2.6d teal schematic line. `path` (A + vias + B) is untouched; the seam mirrors the rendering. ----

test('a new_road change renders as a road body: legend + swatch, stripes from the lanes band, path untouched', async ({ page }) => {
  await mockBackend(page, NET, (a) => {
    const meta = a.meta as { scenario: { changes: Record<string, unknown>[] } };
    meta.scenario.changes = [{
      type: 'new_road', target_edge: 'nr_1', from_junction: 'J1', to_junction: 'J2', lanes: 2, speed_mps: 13.89,
      via: ['-79.245,43.752'], description: 'New road J1→J2',
    }];
  });
  // the new_road resolver fetches the junction coordinates from the backend (the ONE backend call an overlay makes)
  await page.unroute('**/api/junctions**');
  await page.route('**/api/junctions**', (route) =>
    route.fulfill({ json: { junctions: [{ id: 'J1', lon: -79.25, lat: 43.75 }, { id: 'J2', lon: -79.24, lat: 43.75 }], count: 2 } }),
  );
  await openWatch(page);
  type Seam = { items: { type: string; vertices: number; roadBody: boolean; stripes: number }[] };
  const seam = () => page.evaluate(() => (window as unknown as { __nadiChangeOverlay?: Seam }).__nadiChangeOverlay ?? null);
  await expect.poll(async () => (await seam())?.items[0]?.type, { timeout: 20_000 }).toBe('new_road');
  const legend = page.getByTestId('change-legend');
  await expect(legend).toContainText('proposed road');
  await expect(legend.locator('span').first()).toHaveCSS('background-color', 'rgb(150, 98, 92)');
  const far = (await seam())!.items[0];
  expect(far.vertices).toBe(3); // A + 1 via + B — the V2.6d pin's shape, untouched
  expect(far.roadBody).toBe(true);
  expect(far.stripes).toBe(0); // no striping at the far band
  await jumpTo(page, CENTER[0], CENTER[1], 15.2);
  await expect.poll(async () => (await seam())?.items[0]?.stripes, { timeout: 10_000 }).toBe(1); // 2 lanes → 1 internal boundary
  expect((await seam())!.items[0].vertices).toBe(3);
});

// ---- the bike-lane CHANGE band (C3c): a scenario's bike_lane is a REAL dedicated lane, so it renders in
// the design's bike-band green — a thin line at the far band, the curb-side car lane at TRUE width from the
// lanes band. (`allows.bike` on 98 % of the net's edges is mixed traffic, never a band.) The overlay's `path`
// is untouched (the vertex pins); the band is a rendering of it, mirrored by `laneBand` on the seam. ----

test('a bike_lane change renders as the bike band: legend + swatch, and true-width from the lanes band', async ({ page }) => {
  await mockBackend(page, NET, (a) => {
    const meta = a.meta as { scenario: { changes: Record<string, unknown>[] } };
    meta.scenario.changes = [{ type: 'bike_lane', target_edge: 'A', target_lane: 0, description: 'Bike lane on A' }];
  });
  await openWatch(page);
  type Seam = { items: { type: string; vertices: number; laneBand: boolean }[] };
  const seam = () => page.evaluate(() => (window as unknown as { __nadiChangeOverlay?: Seam }).__nadiChangeOverlay ?? null);
  await expect.poll(async () => (await seam())?.items[0]?.type, { timeout: 20_000 }).toBe('bike_lane');
  const legend = page.getByTestId('change-legend');
  await expect(legend).toContainText('bike lane');
  await expect(legend.locator('span').first()).toHaveCSS('background-color', 'rgb(143, 174, 135)');
  expect((await seam())!.items[0].vertices).toBe(2); // the edge's geometry, untouched
  expect((await seam())!.items[0].laneBand).toBe(false); // far band: a thin line along the edge
  await jumpTo(page, CENTER[0], CENTER[1], 15.2);
  await expect.poll(async () => (await seam())?.items[0]?.laneBand, { timeout: 10_000 }).toBe(true);
  expect((await seam())!.items[0].vertices).toBe(2); // still the same path on the seam
});

// ---- the basemap paint (C2b): positron-nolabels' ground / water / greenery are overridden on load to
// the design's swatches, read BACK from the live style so the pin is the map's truth, not the request ----

test('the basemap ground, water and greenery are the transit-map swatches (read back from the live style)', async ({ page }) => {
  await mockBackend(page);
  await openWatch(page);
  await expect
    .poll(
      async () =>
        page.evaluate(() => (window as unknown as { __nadiViewport?: { basemap?: unknown } }).__nadiViewport?.basemap ?? null),
      { timeout: 20_000 },
    )
    .toEqual({ ground: '#f2f2f3', water: '#d7e1e7', greenery: '#e0e7dc' });
});

// ---- the real network: structural smoke only (counts belong to the fixture tests above) ----

test('real network smoke: the seams publish over the exported net at the landing zoom', async ({ page }) => {
  await mockBackend(page, null);
  await openWatch(page);
  await expect.poll(async () => (await roadLayers(page))?.layers.length ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
  const rl = await roadLayers(page);
  expect(rl!.band).toBe('far');
  // every row-backed layer has rows over the real net; chevrons are computed ONLY from the lanes
  // band (the far band draws no direction marks), so their count at the landing is 0 by design
  for (const l of rl!.layers) {
    if (l.id === 'road-chevrons') expect(l.count).toBe(0);
    else expect(l.count).toBeGreaterThan(0);
  }
  await jumpTo(page, -79.2274, 43.7644, 15.2);
  await expect
    .poll(async () => (await roadLayers(page))?.layers.find((l) => l.id === 'road-chevrons')?.count ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(0);
});
