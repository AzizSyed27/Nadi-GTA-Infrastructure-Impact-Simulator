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

async function mockBackend(page: Page, net: unknown = NET) {
  const body = fs.readFileSync(FIXTURE, 'utf-8');
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
  expect(rl!.layers).toEqual([
    { id: 'road-sidewalk', visible: true, count: 2 },
    { id: 'road-body', visible: true, count: 3 },
    { id: 'road-centerline', visible: true, count: 1 },
    { id: 'road-centerline-collector', visible: false, count: 1 },
  ]);
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

// ---- the real network: structural smoke only (counts belong to the fixture tests above) ----

test('real network smoke: the seams publish over the exported net at the landing zoom', async ({ page }) => {
  await mockBackend(page, null);
  await openWatch(page);
  await expect.poll(async () => (await roadLayers(page))?.layers.length ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
  const rl = await roadLayers(page);
  expect(rl!.band).toBe('far');
  for (const l of rl!.layers) expect(l.count).toBeGreaterThan(0);
});
