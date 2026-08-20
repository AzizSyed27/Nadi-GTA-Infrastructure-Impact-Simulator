// V2.6c — the 0.10.0 dual-path reader over the committed MIXED-SHAPE fixture (compact-run.json,
// producer-real, regen-pinned by python/tests/test_compact_fixture.py). The __nadiRenderStats seam
// carries TRUE point counts under both shapes: a reader that silently drops or duplicates a
// teleport tail diverges from the fixture-derived constants below (F3). The expansion sample is
// asserted against HAND-WRITTEN literals — never "same as the python expansion" (the
// shared-inverse-bug rule). ?run= deep-link route (composite-runcard.spec convention: the 500 ms
// fixture delay + warm reload cover the StrictMode/maplibre teardown hazard).

import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const RUN_ID = 'compact-fixture';
const FIXTURE = path.join(__dirname, 'fixtures', 'compact-run.json');

const BANNED = /\b(majority|minority|referendum|consensus|unanimous|plurality)\b/i;

interface RenderStats {
  vehicles: number;
  persons: number;
  vehiclePathPoints: number;
  vehicleTsPoints: number;
  personPathPoints: number;
  personTsPoints: number;
  compactEntities: number;
  explicitEntities: number;
  sampleCompactTimestamps: number[] | null;
}

async function mockBackend(page: Page) {
  const body = fs.readFileSync(FIXTURE, 'utf-8');
  await page.route('**/api/junctions**', (route) => route.fulfill({ json: { junctions: [], count: 0 } }));
  await page.route('**/api/edges**', (route) => route.fulfill({ json: { edges: [], count: 0 } }));
  await page.route('**/api/runs', (route) => route.fulfill({ json: { runs: [] } }));
  await page.route(`**/${RUN_ID}.json`, async (route) => {
    // compare.spec convention: a tiny fixture resolving inside StrictMode's double-mount window
    // crashes maplibre teardown in dev — delay it past that window
    await new Promise((res) => setTimeout(res, 500));
    await route.fulfill({ body, contentType: 'application/json' });
  });
}

async function openRun(page: Page) {
  await page.goto(`/?run=${RUN_ID}`);
  await page.getByTestId('comment-feed').waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
  await page.reload();
  await expect(page.getByTestId('comment-feed')).toBeVisible({ timeout: 20_000 });
}

test('a 0.10.0 mixed-shape artifact joins every point of both shapes (the seam pin)', async ({ page }) => {
  await mockBackend(page);
  await openRun(page);

  // fixture-derived constants, hand-verified against compact-run.json: 3 vehicles (6+4+5 pts),
  // 2 persons (5+4 pts), 3 compact entities, 2 explicit (the mid-gap vehicle + tail-gap person)
  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { __nadiRenderStats?: RenderStats }).__nadiRenderStats), {
      timeout: 15_000,
    })
    .toEqual({
      vehicles: 3,
      persons: 2,
      vehiclePathPoints: 15,
      vehicleTsPoints: 15, // == pathPoints: nothing dropped, nothing duplicated — either shape
      personPathPoints: 9,
      personTsPoints: 9,
      compactEntities: 3,
      explicitEntities: 2,
      // HAND-WRITTEN literals (t0=4, dt=1): the TS expansion's ground truth, independent of the
      // python encoder — the two sides cannot agree on a wrong answer
      sampleCompactTimestamps: [4, 5, 6, 7, 8],
    });
});

test('playback smoke: compact and explicit entities render together; no tallies anywhere', async ({ page }) => {
  await mockBackend(page);
  await openRun(page);

  await page.locator('input[type=range]').first().fill('1800');
  await expect(page.getByTestId('comment-row')).toHaveCount(1, { timeout: 10_000 }); // the pinned sim voice popped
  await expect(page.getByTestId('community-row')).toHaveCount(1);
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(BANNED);
});
