import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// V2.1d part ii — the comparison view. NEW spec file; every existing spec stays byte-identical.
// Fixtures are derived IN-SPEC from the committed seeds-run.json (a REAL 0.8.0 artifact whose
// ranges came from the actual attach_ranges — test_seeds_fixture.py pins that): structuredClone +
// meta surgery, nothing new committed. The view under test loads them through the normal slim
// loader → CompareView path, so a green spec means the real render path, not a fixture cosmetic.

const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'seeds-run.json'), 'utf-8'),
) as Record<string, unknown>;

type Artifact = {
  schema_version: string;
  meta: {
    run_id: string;
    demand_profile?: string;
    assignment?: { mode: string; scope?: string | null } | null;
    scenario?: { changes?: Array<Record<string, unknown>> } | null;
  };
  scorecard?: {
    groups: Array<Record<string, { value?: number | null; range?: unknown; note?: string } | string | null>>;
  } | null;
};

function variant(mutate: (a: Artifact) => void): Artifact {
  const a = structuredClone(FIXTURE) as unknown as Artifact;
  mutate(a);
  return a;
}
function stripRanges(a: Artifact) {
  for (const g of a.scorecard?.groups ?? []) {
    for (const k of ['travel_time_delta', 'safety_delta', 'access_delta']) {
      const cell = g[k] as { range?: unknown } | null;
      if (cell && typeof cell === 'object' && 'range' in cell) delete cell.range;
    }
  }
}
function carTravel(a: Artifact): { value?: number | null } {
  const g = a.scorecard!.groups.find((x) => x.group === 'car_commuter') as Record<string, { value?: number | null }>;
  return g.travel_time_delta;
}

// BASE: the settled/calibrated 3-seed fixture (car travel 2.1 stable-ranged; cyclist travel + safety
// sign-unstable). DAY_ONE: day-one, rangeless (0.8.0 rangeless = single seed), car travel 5.1 so the
// car travel Δ is deterministic: 5.1 − 2.1 = +3.0s.
const BASE = variant((a) => (a.meta.run_id = 'cmp-settled'));
const DAY_ONE = variant((a) => {
  a.meta.run_id = 'cmp-dayone';
  a.meta.assignment = { mode: 'day_one' };
  stripRanges(a);
  carTravel(a).value = 5.1;
});
const SYNTHETIC = variant((a) => {
  a.meta.run_id = 'cmp-synth';
  a.meta.demand_profile = 'synthetic_demo';
});
// TWIN: only run_id + change DESCRIPTION differ from BASE — proves description-only ≠ mismatch.
const TWIN = variant((a) => {
  a.meta.run_id = 'cmp-twin';
  if (a.meta.scenario?.changes?.[0]) a.meta.scenario.changes[0].description = 'same change, different label';
});
const NO_SCORECARD = variant((a) => {
  a.meta.run_id = 'cmp-noscore';
  delete (a as Record<string, unknown>).scorecard;
});
// PRE-0.8.0 pair: rangeless + version patched — seed provenance honestly UNKNOWN on both sides.
const OLD_A = variant((a) => {
  a.meta.run_id = 'cmp-old-a';
  a.schema_version = '0.7.0';
  stripRanges(a);
});
const OLD_B = variant((a) => {
  a.meta.run_id = 'cmp-old-b';
  a.schema_version = '0.7.0';
  stripRanges(a);
});

const ALL = [BASE, DAY_ONE, SYNTHETIC, TWIN, NO_SCORECARD, OLD_A, OLD_B];

// The referendum litmus (verbatim from discourse.spec) + the compare-specific banned set.
const BANNED = /\b(majority|minority|referendum|consensus|unanimous|plurality)\b/i;
const STANCE_TALLY = /\d+\s*%[^.]{0,24}(support|oppos|favou?r|against)|\bfinal (distribution|tally|result|vote)\b|\d+\s+for\s*\/\s*\d+\s+against/i;
const COMPARE_BANNED = /\b(winner|wins|recommended?|net benefit|overall (score|better)|better option)\b/i;

const GROUP_ORDER = [
  'car_commuter', 'cyclist', 'pedestrian', 'local_resident', 'business_owner', 'accessibility', 'transit_riders',
];

async function mockBackend(page: Page, opts: { delayA?: boolean } = {}) {
  // Non-empty network/junction stubs (the seeds.spec shapes) — an empty network.json destabilizes
  // the map layer stack under the dev overlay and the mode toggle never settles.
  const J1 = { id: 'J1', lon: -79.2229, lat: 43.7443, type: 'priority', n_in: 4, n_out: 4 };
  const NET_EDGE = {
    id: 'E1', geometry: [[-79.222, 43.744], [-79.214, 43.75]], lanes: 2, speed_mps: 13.9,
    oneway: false, allows: { car: true, bike: true, ped: true },
  };
  await page.route('**/api/junctions**', (r) => r.fulfill({ json: { junctions: [J1], count: 1 } }));
  await page.route('**/api/edges**', (r) =>
    r.fulfill({ json: { edges: [{ id: 'E1', car_lane_count: 2, eligible_bike_lane: true, eligibility_reason: 'eligible' }], count: 1 } }));
  await page.route('**/network.json', (r) => r.fulfill({ json: { edges: [NET_EDGE] } }));
  await page.route('**/api/runs', (r) =>
    r.fulfill({
      json: {
        runs: ALL.map((a, i) => ({
          id: a.meta.run_id, description: `fixture ${a.meta.run_id}`, status: 'done', stage: 'done', started_at: i,
        })),
      },
    }),
  );
  for (const a of ALL) {
    await page.route(`**/${a.meta.run_id}.json`, async (r) => {
      // A floor delay on every artifact response: a 4 KB fixture otherwise resolves INSIDE the dev
      // StrictMode double-mount window, mounting <Map> mid-cycle and tripping a fatal deck.gl/
      // maplibre teardown crash (getProjection of null → error overlay). Real artifacts are tens of
      // MB and always land after that window — the delay makes the fixture behave like reality.
      const delay = opts.delayA && a.meta.run_id === 'cmp-settled' ? 1200 : 500;
      await new Promise((res) => setTimeout(res, delay));
      await r.fulfill({ json: a });
    });
  }
}

async function pickB(page: Page, id: string) {
  await page.getByTestId('compare-picker-b').getByTestId('run-select').selectOption(id);
  await page.waitForResponse((r) => r.url().includes(`${id}.json`));
}

async function openCompare(page: Page, runA = 'cmp-settled') {
  // DEV-ONLY hazard, worked around here rather than in app code: on a cold Turbopack compile the
  // very first mount can land the tiny fixture artifact inside React StrictMode's double-mount
  // window, unmounting <Map> mid-cycle and fatally crashing maplibre (getProjection of null → the
  // error overlay replaces the app). One warm reload after first paint sidesteps it — production
  // builds have no StrictMode double-mount, and real artifacts (tens of MB) never hit the window.
  await page.goto(`/?run=${runA}`);
  await page.getByTestId('mode-compare').waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
  await page.reload();
  await expect(page.getByTestId('mode-compare')).toBeVisible();
  await page.waitForFunction(() => ((window as unknown as { __nadiNetworkEdges?: number }).__nadiNetworkEdges ?? 0) > 0);
  await expect(async () => {
    await page.getByTestId('mode-compare').click({ timeout: 2000 });
    await expect(page.getByTestId('compare-view')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
}

test('settled vs day-one: aligned grid, legal deltas, refused safety deltas, mismatch lines', async ({ page }) => {
  await mockBackend(page);
  await openCompare(page);
  await pickB(page, 'cmp-dayone');
  await expect(page.getByTestId('compare-grid')).toBeVisible();

  // (g) 7 rows, fixed order regardless of magnitudes.
  const rows = page.getByTestId('compare-row');
  await expect(rows).toHaveCount(7);
  const order = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-group')));
  expect(order).toEqual(GROUP_ORDER);

  // (a) the car travel delta is exact and signed: 5.1 − 2.1 = +3.0s (worse → sign color applies).
  const carDelta = page.locator('[data-testid="compare-delta"][data-metric="travel"][data-group="car_commuter"]');
  await expect(carDelta).toHaveText('+3.0s');
  // A side keeps its range sub-line; B side is rangeless.
  await expect(page.getByTestId('compare-grid').getByTestId('cell-range').first()).toBeVisible();

  // (b) safety Δ = the REFUSED marker on all 7 rows: —† + data-refused + tooltip; the † legend shows.
  const safetyDeltas = page.locator('[data-testid="compare-delta"][data-metric="safety"]');
  await expect(safetyDeltas).toHaveCount(7);
  for (const d of await safetyDeltas.all()) {
    await expect(d).toHaveAttribute('data-refused', 'true');
    await expect(d).toContainText('—†');
    await expect(d).toHaveAttribute('title', /direction not claimed within either run/);
  }
  await expect(page.getByTestId('compare-view')).toContainText('cross-run direction not claimed');

  // The UNSTABLE cyclist travel cell (sign-unstable on side A) also refuses its delta.
  const cycDelta = page.locator('[data-testid="compare-delta"][data-metric="travel"][data-group="cyclist"]');
  await expect(cycDelta).toHaveAttribute('data-refused', 'true');
  await expect(cycDelta).toHaveAttribute('title', /sign-unstable across seeds/);

  // (c) mismatch note: assignment line + seeds line (3 seeds vs single), NO demand line.
  await expect(page.getByTestId('mismatch-note')).toBeVisible();
  await expect(page.locator('[data-testid="mismatch-line"][data-field="assignment"]')).toContainText(
    'blends the change’s effect with the adaptation model',
  );
  await expect(page.locator('[data-testid="mismatch-line"][data-field="seeds"]')).toContainText('seed evidence differs');
  await expect(page.locator('[data-testid="mismatch-line"][data-field="demand"]')).toHaveCount(0);

  // (f) referendum guard over the whole view.
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(BANNED);
  expect(body).not.toMatch(STANCE_TALLY);
  expect(body).not.toMatch(COMPARE_BANNED);
  expect(await page.locator('[data-testid="compare-view"] svg, [data-testid="compare-view"] canvas').count()).toBe(0);
  await page.screenshot({ path: 'test-results/compare-settled-dayone.png', fullPage: true });
});

test('calibrated vs synthetic fires the demand line; provenance twins fire nothing', async ({ page }) => {
  await mockBackend(page);
  await openCompare(page);
  await pickB(page, 'cmp-synth');
  await expect(page.locator('[data-testid="mismatch-line"][data-field="demand"]')).toContainText(
    'not like-for-like',
  );
  // Twins: identical provenance, description-only difference → NO mismatch note at all.
  await pickB(page, 'cmp-twin');
  await expect(page.getByTestId('mismatch-note')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/compare-twins.png', fullPage: true });
});

test('pre-0.8.0 pair: per-side unknown-seeds disclosure WITHOUT a seeds mismatch line', async ({ page }) => {
  await mockBackend(page);
  await openCompare(page, 'cmp-old-a');
  await pickB(page, 'cmp-old-b');
  // disclosure describes each side…
  await expect(page.getByTestId('compare-prov-a')).toContainText('seeds unknown (pre-0.8.0 run)');
  await expect(page.getByTestId('compare-prov-b')).toContainText('seeds unknown (pre-0.8.0 run)');
  // …while two unknowns compare equal: no seeds mismatch (and no other line — same provenance).
  await expect(page.locator('[data-testid="mismatch-line"][data-field="seeds"]')).toHaveCount(0);
  await expect(page.getByTestId('mismatch-note')).toHaveCount(0);
});

test('same-run compare is degenerate but honest; missing scorecard renders the empty column', async ({ page }) => {
  await mockBackend(page);
  await openCompare(page);
  // (d) same run on both sides.
  await pickB(page, 'cmp-settled');
  await expect(page.getByTestId('same-run-note')).toContainText('every delta is zero by construction');
  // (e) a scorecard-less side: honest note, plain-— deltas (absence, NOT the —† refusal) for travel.
  await pickB(page, 'cmp-noscore');
  await expect(page.getByTestId('compare-no-scorecard')).toContainText('no scorecard yet');
  const carDelta = page.locator('[data-testid="compare-delta"][data-metric="travel"][data-group="car_commuter"]');
  await expect(carDelta).toContainText('—');
  await expect(carDelta).not.toHaveAttribute('data-refused', 'true');
  await expect(carDelta).not.toContainText('—†');
  await page.screenshot({ path: 'test-results/compare-noscore.png', fullPage: true });
});

test('deep-link determinism: ?run=A&compare=B with side A delayed — no blank side A', async ({ page }) => {
  await mockBackend(page, { delayA: true }); // side B's fetch resolves FIRST
  await page.goto('/?run=cmp-settled&compare=cmp-dayone');
  // same cold-compile warm-up as openCompare (see the comment there)
  await page.getByTestId('compare-view').waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
  await page.reload();
  await expect(page.getByTestId('compare-view')).toBeVisible({ timeout: 20_000 });
  // Side A resolves from the (delayed) loaded artifact — derived at render, no race.
  await expect(page.getByTestId('compare-prov-a')).toContainText('cmp-settled', { timeout: 20_000 });
  await expect(page.getByTestId('compare-prov-b')).toContainText('cmp-dayone');
  await expect(page.getByTestId('compare-grid')).toBeVisible();
  await page.screenshot({ path: 'test-results/compare-deeplink.png', fullPage: true });
});
