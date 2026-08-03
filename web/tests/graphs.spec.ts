import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// V2.3d — the graph SPLIT-VIEW: the two graphs, visibly two graphs. Framing headers + the
// one-liner verbatim; cascade-scoped influence connectors DISTINCT from follow edges; exclusion
// markers surfacing the withheld-posts audit (rules on hover, NEVER content); per-panel labeled
// degradation naming BOTH recovery paths (enrich + the backfill CLI); the referendum guard
// extended (no centrality/influencer leaderboard language). Mocked backend everywhere except the
// LAST test — the pinned smoke proving real fetch + committed sidecar + the .gitignore negation
// end to end (its failure mode to catch is silent-never-landed).

const RUN_ID = 'multimodal-scenario-graphsfixture';
const FIXTURE = path.join(__dirname, 'fixtures', 'school-zone-run.json');
const PINNED = 'multimodal-scenario-20260702T044134Z';

const OASIS_HEADER = 'Who influences whom in the simulated discourse — one simulated preview, not a prediction';
const ENTITY_HEADER = "What the report's chat agent knows — entities and relations extracted from this run's corpus";
const SPLIT_ONE_LINER = 'Two different graphs on purpose: discourse propagation is not the chat agent’s memory.';

const BANNED = /\b(majority|minority|referendum|consensus|unanimous|plurality)\b/i;
const STANCE_TALLY = /\d+\s*%[^.]{0,24}(support|oppos|favou?r|against)|\bfinal (distribution|tally|result|vote)\b|\d+\s+for\s*\/\s*\d+\s+against/i;
// the graphs extension: influence-winner / centrality-leaderboard language is a visual referendum
const GRAPHS_BANNED = /\b(centrality|most influential|top voices?|influencers?|leaderboard|rank(ed|ing)?)\b/i;

// planted as excluded cascade content in the MOCK ARTIFACT — must never surface in the graphs view
// (the sidecar carries exclusion METADATA only; this polices the whole channel end to end)
const SENTINEL = 'XSENTINEL-EXCLUDED-POST-CONTENT-9Q7';

type GraphsSeam = {
  loading: boolean;
  error: boolean;
  oasis: { nodes: number; edges: number; connectors: number; exclusions: number; activeCascade: string | null } | null;
  entity: { nodes: number; edges: number; stale: boolean } | null;
};

function syntheticSidecar(): Record<string, unknown> {
  return {
    run_id: RUN_ID,
    generated_at: '2026-08-02T00:00:00Z',
    oasis: {
      framing: 'who influences whom in the simulated discourse',
      seed: 42,
      layout: 'spring',
      nodes: [
        { id: 'a1', x: 0, y: 0, label: 'Daily driver', group: 'car', grounding: 'vehicle', connected: true },
        { id: 'a2', x: 10, y: 4, label: 'Commuting cyclist', group: 'bicycle', grounding: 'vehicle', connected: true },
        { id: 'a3', x: 5, y: 9, label: 'Long-time resident', group: 'local_resident', grounding: 'inferred', connected: false },
        {
          id: 'a_excl', x: 8, y: 2, label: 'Shop owner', group: 'business_owner', grounding: 'inferred', connected: true,
          excluded: { count: 2, rules: ['no_digits', 'safety_direction'] },
        },
      ],
      edges: [
        { from: 'a1', to: 'a2', kind: 'homophily' },
        { from: 'a2', to: 'a1', kind: 'homophily' },
        { from: 'a2', to: 'a_excl', kind: 'geography' },
        { from: 'a1', to: 'a_excl', kind: 'cross' },
      ],
      influence: [
        { cascade_id: 'cascade_1', from: 'a1', to: 'a2', shifted: true },
        { cascade_id: 'cascade_1', from: 'a1', to: 'a_excl', shifted: false },
        { cascade_id: 'cascade_1', from: 'a2', to: 'a_excl', shifted: false },
        { cascade_id: 'cascade_2', from: 'a2', to: 'a1', shifted: false },
      ],
      coverage: { agents: 6, nodes: 4, with_edges: 3, mandate_excluded: 1 },
      exposure_note:
        'most influence arrived via ambient feed surfacing rather than follow edges — the dashed connectors are drawn separately from the follow graph for that reason',
    },
    entity: {
      framing: "what the report's chat agent knows",
      index_ts: '20260101T000000Z',
      index_built_at: '2026-01-01T00:00:00Z',
      note: 'extracted from the chat index served for this run (index-20260101T000000Z) — reflects that index’s corpus when it was built',
      packing_note: 'disconnected clusters are packed side by side, not force-laid into false adjacency',
      nodes: [
        { id: 'Kingston Road', x: 0, y: 0, type: 'location', sources: ['scorecard row', 'voice: shop owner'], source_count: 5 },
        { id: 'travel time', x: 6, y: 3, type: 'concept', sources: ['report section'], source_count: 1 },
        { id: 'cyclists', x: 3, y: 7, type: 'person', sources: [], source_count: 0 },
      ],
      edges: [
        { from: 'Kingston Road', to: 'travel time', weight: 2 },
        { from: 'travel time', to: 'cyclists', weight: 1 },
      ],
      components: 1,
      isolates: 0,
    },
  };
}

/** The mock artifact: the school-zone fixture (real producer output) + a minimal social block
 * whose EXCLUDED event carries the sentinel — the artifact is the only place excluded content
 * exists, and the graphs view must never surface it. */
function mockArtifact(): string {
  const art = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
  art.meta.run_id = RUN_ID;
  art.social = {
    graph: { edges: [] },
    cascades: [
      {
        cascade_id: 'cascade_1',
        steps: [
          {
            step: 0,
            events: [
              { agent_id: 'a_excl', content: SENTINEL, audit_status: 'excluded' },
              { agent_id: 'a1', content: 'a fine post about the corridor', audit_status: 'included' },
            ],
          },
        ],
      },
      { cascade_id: 'cascade_2', steps: [] },
    ],
    trajectories: [],
  };
  return JSON.stringify(art);
}

async function mockLoadedRun(page: Page, sidecar: Record<string, unknown> | null | 'missing') {
  await page.route('**/api/junctions**', (route) => route.fulfill({ json: { junctions: [], count: 0 } }));
  await page.route('**/api/edges**', (route) => route.fulfill({ json: { edges: [], count: 0 } }));
  await page.route('**/api/runs', (route) =>
    route.fulfill({ json: { runs: [{ id: RUN_ID, description: 'graphs fixture', status: 'done', stage: 'done', started_at: 2 }] } }));
  await page.route('**/api/runs/*/status', (route) =>
    route.fulfill({ json: { run_id: RUN_ID, stage: 'done', status: 'done', description: 'graphs fixture' } }));
  const artifactBody = mockArtifact();
  await page.route(`**/${RUN_ID}.json`, async (route) => {
    // 500 ms delay floor (compare.spec convention): a tiny fixture resolving inside StrictMode's
    // double-mount window fatally crashes maplibre teardown in dev
    await new Promise((res) => setTimeout(res, 500));
    await route.fulfill({ body: artifactBody, contentType: 'application/json' });
  });
  await page.route(`**/${RUN_ID}-graphs.json`, (route) =>
    sidecar === 'missing'
      ? route.fulfill({ status: 404, body: 'not found' })
      : route.fulfill({ json: sidecar }),
  );
}

async function warmOpen(page: Page) {
  await page.goto(`/?run=${RUN_ID}`);
  // warm-reload convention: cold dev compile + StrictMode detaches first paint
  await page.getByTestId('mode-edit').waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
  await page.reload();
  await expect(page.getByTestId('mode-edit')).toBeVisible({ timeout: 20_000 });
  // artifact loaded (the change overlay seam fires once changes resolve against the network)
  await page.waitForFunction(
    () => ((window as unknown as { __nadiChangeOverlay?: { count: number } }).__nadiChangeOverlay?.count ?? 0) > 0,
    undefined, { timeout: 20_000 },
  );
}

async function openGraphs(page: Page) {
  await page.getByTestId('mode-graphs').click();
  await expect(page.getByTestId('graph-split-view')).toBeVisible();
}

async function seam(page: Page): Promise<GraphsSeam> {
  return page.evaluate(() => (window as unknown as { __nadiGraphs: GraphsSeam }).__nadiGraphs);
}

async function waitForSidecar(page: Page) {
  await page.waitForFunction(() => {
    const s = (window as unknown as { __nadiGraphs?: GraphsSeam }).__nadiGraphs;
    return !!s && !s.loading;
  }, undefined, { timeout: 20_000 });
}

// ------------------------------------------------------------------ 1. both panels + framing

test('split view: both panels render with the framing headers + one-liner verbatim, 2 canvases', async ({ page }) => {
  await mockLoadedRun(page, syntheticSidecar());
  await warmOpen(page);
  await openGraphs(page);
  await waitForSidecar(page);

  await expect(page.getByTestId('oasis-header')).toHaveText(OASIS_HEADER);
  await expect(page.getByTestId('entity-header')).toHaveText(ENTITY_HEADER);
  await expect(page.getByTestId('graphs-one-liner')).toHaveText(SPLIT_ONE_LINER);

  const s = await seam(page);
  expect(s.oasis).toEqual({ nodes: 4, edges: 4, connectors: 3, exclusions: 1, activeCascade: 'cascade_1' });
  expect(s.entity).toEqual({ nodes: 3, edges: 2, stale: false });

  // exactly the two panel canvases INSIDE the split view (each panel = one standalone deck)
  expect(await page.locator('[data-testid="graph-split-view"] canvas').count()).toBe(2);

  // coverage + exposure + packing lines render FROM SIDECAR FIELDS (spot the composed meta lines)
  await expect(page.getByTestId('oasis-meta')).toContainText('3 of 6 voices have follow edges');
  // gap attribution (review-caught): institutional exclusion named FIRST, sibling-dedup only for
  // the remainder (nodes 4 < agents 6 - mandate 1 = 5, so both render here)
  await expect(page.getByTestId('oasis-meta')).toContainText('1 institutional voice(s) speak in the feed, not the graph');
  await expect(page.getByTestId('oasis-meta')).toContainText('sibling voices share a node');
  await expect(page.getByTestId('oasis-meta')).toContainText('1 voice(s) had posts withheld by the honesty audit');
  await expect(page.getByTestId('entity-meta')).toContainText('index built 2026-01-01T00:00:00Z');
  await expect(page.getByTestId('entity-meta')).toContainText('packed side by side, not force-laid into false adjacency');
});

// ------------------------------------------------------------------ 2. cascade-scoped connectors

test('cascade tab switch changes the connector count; follow edges stay put', async ({ page }) => {
  await mockLoadedRun(page, syntheticSidecar());
  await warmOpen(page);
  await openGraphs(page);
  await waitForSidecar(page);

  let s = await seam(page);
  expect(s.oasis?.activeCascade).toBe('cascade_1');
  expect(s.oasis?.connectors).toBe(3);

  await page.locator('[data-testid="graph-panel-oasis"] [data-testid="cascade-tab-cascade_2"]').click();
  await page.waitForFunction(
    () => (window as unknown as { __nadiGraphs?: GraphsSeam }).__nadiGraphs?.oasis?.activeCascade === 'cascade_2');
  s = await seam(page);
  expect(s.oasis?.connectors).toBe(1); // influence is cascade-scoped…
  expect(s.oasis?.edges).toBe(4); // …follow edges are not (they are a different thing on purpose)
});

// ------------------------------------------------------------------ 3. exclusion hover: rules, never content

test('exclusion hover shows count + rules via the REAL handler; the sentinel never surfaces', async ({ page }) => {
  await mockLoadedRun(page, syntheticSidecar());
  await warmOpen(page);
  await openGraphs(page);
  await waitForSidecar(page);

  await page.evaluate(() =>
    (window as unknown as { __nadiGraphsHover: (p: string, id: string) => void }).__nadiGraphsHover('oasis', 'a_excl'));
  await expect(page.getByTestId('oasis-tooltip')).toBeVisible();
  await expect(page.getByTestId('oasis-tooltip')).toContainText(
    '2 post(s) withheld by the honesty audit: no_digits, safety_direction');

  // entity hover: id + type + bounded sources
  await page.evaluate(() =>
    (window as unknown as { __nadiGraphsHover: (p: string, id: string) => void }).__nadiGraphsHover('entity', 'Kingston Road'));
  await expect(page.getByTestId('entity-tooltip')).toContainText('Kingston Road · location');
  await expect(page.getByTestId('entity-tooltip')).toContainText('scorecard row, voice: shop owner (+3 more)');

  // the artifact's excluded content exists in this page's data — it must never reach the DOM here
  const body = await page.locator('body').innerText();
  expect(body).not.toContain(SENTINEL);
});

// ------------------------------------------------------------------ 4. per-panel labeled degradation

test('oasis-only sidecar: entity panel degrades LABELED, naming the report enrich + backfill', async ({ page }) => {
  const sc = syntheticSidecar();
  sc.entity = null;
  await mockLoadedRun(page, sc);
  await warmOpen(page);
  await openGraphs(page);
  await waitForSidecar(page);

  expect((await seam(page)).oasis?.nodes).toBe(4); // the present half still renders
  const empty = page.getByTestId('entity-empty');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('report enrich');
  await expect(empty).toContainText('python python/src/graph_export.py --run-id');
});

test('entity-only sidecar: oasis panel degrades LABELED (+ the stale note renders when present)', async ({ page }) => {
  const sc = syntheticSidecar();
  sc.oasis = null;
  (sc.entity as Record<string, unknown>).stale_note =
    "this index was built before this run's latest enrich — rebuild the chat index (report enrich) to refresh it";
  await mockLoadedRun(page, sc);
  await warmOpen(page);
  await openGraphs(page);
  await waitForSidecar(page);

  const empty = page.getByTestId('oasis-empty');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('discourse enrich');
  await expect(empty).toContainText('python python/src/graph_export.py --run-id');

  // the staleness fold-in: legible where the data is read, not just noted in an export field
  await expect(page.getByTestId('entity-stale-note')).toContainText('built before this run');
  expect((await seam(page)).entity?.stale).toBe(true);
});

test('no sidecar at all (404): ONE labeled missing state naming both writers + backfill', async ({ page }) => {
  await mockLoadedRun(page, 'missing');
  await warmOpen(page);
  await openGraphs(page);
  await page.waitForFunction(
    () => (window as unknown as { __nadiGraphs?: GraphsSeam }).__nadiGraphs?.error === true,
    undefined, { timeout: 20_000 });

  const missing = page.getByTestId('graphs-missing');
  await expect(missing).toBeVisible();
  await expect(missing).toContainText('discourse and report enriches');
  await expect(missing).toContainText('python python/src/graph_export.py --run-id');
  // no half rendered, no per-panel empties pretending to know which half is absent
  expect(await page.locator('[data-testid="graph-split-view"] canvas').count()).toBe(0);
  await expect(page.getByTestId('oasis-empty')).toHaveCount(0);
  await expect(page.getByTestId('entity-empty')).toHaveCount(0);
});

// ------------------------------------------------------------------ 5. the referendum guard, extended

test('guard sweep across cascade tabs: BANNED + STANCE_TALLY + GRAPHS_BANNED all clean', async ({ page }) => {
  await mockLoadedRun(page, syntheticSidecar());
  await warmOpen(page);
  await openGraphs(page);
  await waitForSidecar(page);

  const tabs = page.locator('[data-testid="graph-panel-oasis"] [data-testid^="cascade-tab-"]');
  const n = await tabs.count();
  expect(n).toBe(2);
  for (let i = 0; i < n; i++) {
    await tabs.nth(i).click();
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(BANNED);
    expect(body).not.toMatch(STANCE_TALLY);
    expect(body).not.toMatch(GRAPHS_BANNED);
  }
});

// ------------------------------------------------------------------ 6. the pinned smoke (NO routes)

test('pinned run, real fetch: the committed sidecar lands with its EXACT OASIS node count', async ({ page }) => {
  // read the committed fixture at runtime — self-updating on deliberate regen, but a silently
  // dropped OASIS half (or a gitignore regression eating the file) FAILS instead of passing
  const committed = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'public', `${PINNED}-graphs.json`), 'utf-8'));
  const expectedOasisNodes = committed.oasis.nodes.length;
  expect(expectedOasisNodes).toBeGreaterThan(100); // the 212-voice run — sanity on the fixture itself

  await page.goto(`/?run=${PINNED}`);
  await expect(page.getByTestId('mode-edit')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('mode-graphs').click();
  await expect(page.getByTestId('graph-split-view')).toBeVisible();
  await page.waitForFunction(() => {
    const s = (window as unknown as { __nadiGraphs?: GraphsSeam }).__nadiGraphs;
    return !!s && !s.loading && !!s.oasis;
  }, undefined, { timeout: 30_000 });

  const s = await seam(page);
  expect(s.oasis?.nodes).toBe(expectedOasisNodes);
  expect(s.entity?.nodes ?? 0).toBeGreaterThan(0);
  expect(await page.locator('[data-testid="graph-split-view"] canvas').count()).toBe(2);
});
