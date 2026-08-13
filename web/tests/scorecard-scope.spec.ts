import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// V2.2 closeout — the ScorecardPanel scope line: scorecard measures are RUN-scoped, a windowed
// change was active for only part of the run. A windowed run must show the one-line scope note
// under the panel header; an unwindowed run must show NOTHING new. The report carries the full
// disclosure sentence (pinned in python/tests/test_report.py); this line is the map-side mirror.
// Fixture: school-zone-run.json (3 speed_limit members, window 600–1200, synthetic) — the
// unwindowed state is a delete-window clone (seeds-run.json is NOT clean-unwindowed: one of its
// members carries a window).

const RUN_ID = 'multimodal-scenario-scope-fixture';
const FIXTURE = path.join(__dirname, 'fixtures', 'school-zone-run.json');

type OverlaySeam = { count: number };

async function mockLoadedRun(page: Page, artifactBody: string) {
  await page.route('**/api/junctions**', (route) => route.fulfill({ json: { junctions: [], count: 0 } }));
  await page.route('**/api/edges**', (route) => route.fulfill({ json: { edges: [], count: 0 } }));
  await page.route('**/api/runs', (route) =>
    route.fulfill({ json: { runs: [{ id: RUN_ID, description: 'scope fixture', status: 'done', stage: 'done', started_at: 2 }] } }));
  await page.route('**/api/runs/*/status', (route) =>
    route.fulfill({ json: { run_id: RUN_ID, stage: 'done', status: 'done', description: 'scope fixture' } }));
  await page.route(`**/${RUN_ID}.json`, async (route) => {
    // compare.spec convention: a tiny fixture resolving inside StrictMode's double-mount window
    // crashes maplibre teardown in dev — delay it past that window
    await new Promise((res) => setTimeout(res, 500));
    await route.fulfill({ body: artifactBody, contentType: 'application/json' });
  });
}

async function warmOpen(page: Page) {
  await page.getByTestId('mode-edit').waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
  await page.reload();
  await expect(page.getByTestId('mode-edit')).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => {
    const s = (window as unknown as { __nadiChangeOverlay?: OverlaySeam }).__nadiChangeOverlay;
    return (s?.count ?? 0) > 0;
  }, undefined, { timeout: 20_000 });
}

test('windowed run: the scorecard scope line renders with the window range', async ({ page }) => {
  const body = fs.readFileSync(FIXTURE, 'utf-8');
  await mockLoadedRun(page, body);
  await page.goto(`/?run=${RUN_ID}`);
  await warmOpen(page);

  await expect(page.getByTestId('scorecard-panel')).toBeVisible({ timeout: 20_000 });
  // fixture members all share window 600–1200 on synthetic demand → the sim-second range form.
  // V2.4b: the subject pluralizes mechanically (3 windowed members → "changes"), no span clause
  // (identical windows are not "differing").
  await expect(page.getByTestId('scorecard-scope-note')).toHaveText(
    'measures cover the full run; changes active t=600–1200 s',
  );
});

test('differing member windows: the scope line uses the spanning window and says so', async ({ page }) => {
  // V2.4b — the mixed-window composite the draft basket can now produce: the client line must
  // carry the SAME span-note clause the report's disclosure sentence does (zone_lens.span_note
  // lockstep), never silently present a spanning range as if all members shared it.
  const art = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
  art.meta.scenario.changes[1].window = { start_s: 900, end_s: 1500 }; // one member shifts
  await mockLoadedRun(page, JSON.stringify(art));
  await page.goto(`/?run=${RUN_ID}`);
  await warmOpen(page);

  await expect(page.getByTestId('scorecard-panel')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('scorecard-scope-note')).toHaveText(
    'measures cover the full run; changes active t=600–1500 s ' +
      '(members carry differing windows; these figures use the spanning window)',
  );
});

test('disjoint member windows: the scope line names the dead time', async ({ page }) => {
  // V2.5a — all members windowed, merged windows leave a gap: the spanning range absorbs dead
  // time, so the clause must ride (client copy of zone_lens.DISJOINT_SPAN_CLAUSE, lockstep with
  // the report's disclosure sentence).
  const art = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
  art.meta.scenario.changes[0].window = { start_s: 300, end_s: 600 };
  art.meta.scenario.changes[1].window = { start_s: 1500, end_s: 1800 };
  art.meta.scenario.changes[2].window = { start_s: 600, end_s: 900 }; // touching #0 — contiguous
  await mockLoadedRun(page, JSON.stringify(art));
  await page.goto(`/?run=${RUN_ID}`);
  await warmOpen(page);

  await expect(page.getByTestId('scorecard-panel')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('scorecard-scope-note')).toHaveText(
    'measures cover the full run; changes active t=300–1800 s ' +
      '(members carry differing windows; these figures use the spanning window; ' +
      'the spanning window includes periods where no change was active)',
  );
});

test('disjoint windowed members + a permanent member: no dead-time clause', async ({ page }) => {
  // V2.5a — a permanent member fills the gap; "no change was active" would be false. The
  // differing clause stays, the mechanical subject names the windowed members.
  const art = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
  art.meta.scenario.changes[0].window = { start_s: 300, end_s: 600 };
  art.meta.scenario.changes[1].window = { start_s: 1500, end_s: 1800 };
  delete art.meta.scenario.changes[2].window; // permanent — bridges the gap
  await mockLoadedRun(page, JSON.stringify(art));
  await page.goto(`/?run=${RUN_ID}`);
  await warmOpen(page);

  await expect(page.getByTestId('scorecard-panel')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('scorecard-scope-note')).toHaveText(
    'measures cover the full run; windowed changes active t=300–1800 s ' +
      '(members carry differing windows; these figures use the spanning window)',
  );
});

test('unwindowed run: no scope line (nothing new renders)', async ({ page }) => {
  const art = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
  for (const c of art.meta.scenario.changes) delete c.window; // permanent limits, same composite
  await mockLoadedRun(page, JSON.stringify(art));
  await page.goto(`/?run=${RUN_ID}`);
  await warmOpen(page);

  await expect(page.getByTestId('scorecard-panel')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('scorecard-scope-note')).toHaveCount(0);
});
