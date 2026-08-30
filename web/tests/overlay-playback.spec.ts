import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// V2.2c — the overlay tells the truth in TIME: a windowed capacity change appears/disappears AT
// its window during playback (asserted via the __nadiChangeOverlay seam + __nadiSeek, never WebGL
// pixels). Fixture-driven: a copy of the real seeds-run artifact with its changes[] patched to a
// windowed lane_closure on a mocked network edge.

const RUN_ID = 'multimodal-scenario-overlay-fixture';
const FIXTURE = path.join(__dirname, 'fixtures', 'seeds-run.json');
const EDGE_ID = 'E_OVL';

const BANNED = /\b(majority|minority|referendum|consensus|unanimous|plurality)\b/i;

type OverlaySeam = { count: number; items: { type: string; windowed: boolean; active: boolean }[] };

function fixtureWithWindowedClosure(): { body: string; window: { start_s: number; end_s: number }; simEnd: number } {
  const art = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
  const simStart = art.meta.sim_start as number;
  const simEnd = art.meta.sim_end as number;
  const span = simEnd - simStart;
  const window = { start_s: simStart + 0.4 * span, end_s: simStart + 0.7 * span };
  art.meta.scenario.changes = [
    { type: 'lane_closure', target_edge: EDGE_ID, target_lanes: [1, 2], window,
      description: 'fixture windowed closure' },
  ];
  return { body: JSON.stringify(art), window, simEnd };
}

async function mockBackend(page: Page, artifactBody: string) {
  await page.route('**/api/junctions**', (route) => route.fulfill({ json: { junctions: [], count: 0 } }));
  await page.route('**/network.json', (route) =>
    route.fulfill({ json: { edges: [{ id: EDGE_ID, geometry: [[-79.22, 43.744], [-79.21, 43.75]], lanes: 3, speed_mps: 13.9, oneway: false, allows: { car: true, bike: true, ped: true } }] } }));
  await page.route('**/api/edges**', (route) => route.fulfill({ json: { edges: [], count: 0 } }));
  await page.route('**/api/runs', (route) =>
    route.fulfill({ json: { runs: [{ id: RUN_ID, description: 'overlay fixture', status: 'done', stage: 'done', started_at: 1 }] } }));
  await page.route('**/api/runs/*/status', (route) =>
    route.fulfill({ json: { run_id: RUN_ID, stage: 'done', status: 'done', change: { type: 'lane_closure' }, description: 'overlay fixture' } }));
  await page.route(`**/${RUN_ID}.json`, async (route) => {
    // the compare.spec convention: a tiny fixture resolving inside React StrictMode's double-mount
    // window fatally crashes maplibre teardown (getProjection of null → the dev overlay eats the
    // app). Delay ~500 ms so the fixture lands like a real artifact would.
    await new Promise((res) => setTimeout(res, 500));
    await route.fulfill({ body: artifactBody, contentType: 'application/json' });
  });
}

async function warmOpen(page: Page) {
  // one warm reload after first paint (cold-compile + StrictMode; see compare.spec.ts)
  await page.getByTestId('stage-build').waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
  await page.reload();
  await expect(page.getByTestId('stage-build')).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => {
    const s = (window as unknown as { __nadiChangeOverlay?: OverlaySeam }).__nadiChangeOverlay;
    return (s?.count ?? 0) > 0;
  });
}

async function seamState(page: Page): Promise<OverlaySeam> {
  return page.evaluate(() => (window as unknown as { __nadiChangeOverlay: OverlaySeam }).__nadiChangeOverlay);
}

test('a windowed closure appears and disappears AT its window during playback', async ({ page }) => {
  const { body, window: w } = fixtureWithWindowedClosure();
  await mockBackend(page, body);
  await page.goto(`/?run=${RUN_ID}`);
  await warmOpen(page);

  // Scrub the Timeline slider — the app's own deterministic seek path (its onChange PAUSES and
  // seeks atomically; a raw setState seek loses races against the rAF loop). Then poll the seam:
  // the update lands on React's next render.
  const scrubAndExpect = async (t: number, active: boolean) => {
    await page.locator('input[type=range]').first().fill(String(Math.round(t)));
    await page.waitForFunction(
      (exp) => {
        const s = (window as unknown as { __nadiChangeOverlay?: OverlaySeam }).__nadiChangeOverlay;
        return s?.items[0]?.active === exp;
      },
      active,
      { timeout: 3000 },
    );
  };

  await scrubAndExpect(w.start_s - 250, false); // before the window: no closure claimed
  const before = await seamState(page);
  expect(before.items[0]).toMatchObject({ type: 'lane_closure', windowed: true });
  await scrubAndExpect((w.start_s + w.end_s) / 2, true); // during: the closure shows
  await scrubAndExpect(w.end_s + 100, false); // reverted — the map stops claiming a closed road
});

test('per-type legend row renders mechanically; edit mode shows windowed overlays regardless of t', async ({ page }) => {
  const { body } = fixtureWithWindowedClosure();
  await mockBackend(page, body);
  await page.goto(`/?run=${RUN_ID}`);
  await warmOpen(page);
  const legend = page.getByTestId('legend-item-lane_closure');
  await expect(legend).toBeVisible();
  await expect(legend).toContainText('2 lane(s) closed');
  // the seeds fixture is a CALIBRATED artifact → the window renders as clock times (t=0 == 07:00):
  // window [1440, 2520] s == 07:24–07:42. Never the raw sim-seconds form on this profile.
  await expect(legend).toContainText('07:24–07:42');
  expect(await legend.innerText()).not.toContain('t=');

  // outside playback the overlay always shows (space-truth; time-truth is playback's job)
  await page.getByTestId('stage-build').click();
  const inEdit = await seamState(page);
  expect(inEdit.items[0].active).toBe(true);

  // referendum guard over the new surfaces
  const text = await page.locator('body').innerText();
  expect(BANNED.test(text)).toBe(false);
});
