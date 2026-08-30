import { test, expect, type Page } from '@playwright/test';
import { mockDefaultArtifact } from './support/default-artifact';
import { gate } from './support/shell';
import { BANNED, STANCE_TALLY } from './support/sweeps';

// V2.7a C4 — the RUN LIST (the header run tag's inventory popover). AN INVENTORY, NOT A
// RANKING: names, plain-terms fingerprints, one-line change summaries, and the three actions
// (CLONE / OPEN / COMPARE) — no deltas, no scores, no best/worst anywhere on the list.

const DONE_NAMED = 'multimodal-scenario-20260901T010101Z';
const DONE_PLAIN = 'multimodal-scenario-20260901T020202Z';
const COMPUTING = 'multimodal-scenario-20260901T030303Z';

// the list-surface ranking sweep: none of these may appear on the inventory
const RANKING = /\b(delta|score[sd]?|best|worst|rank(ed|ing)?|winner)\b|Δ/i;

async function openList(page: Page) {
  await mockDefaultArtifact(page);
  await page.route('**/api/runs', (route) =>
    route.fulfill({
      json: {
        runs: [
          {
            id: DONE_NAMED, description: 'Closed edge E1 (all lanes)', status: 'done', stage: 'done',
            started_at: 1787700000, name: 'Kingston pilot v2', demand_profile: 'calibrated_am_peak',
            assignment: 'settled', n_seeds: 3,
            changes: [{ type: 'road_closure', target_edge: 'E1' }, { type: 'speed_limit', target_edge: 'E2' }],
          },
          {
            id: DONE_PLAIN, description: 'Reduced max speed on edge E9', status: 'done', stage: 'done',
            started_at: 1787600000, changes: [{ type: 'speed_limit', target_edge: 'E9' }],
          },
          {
            id: COMPUTING, description: 'New road A->B', status: 'running', stage: 'baseline',
            started_at: 1787800000, changes: [{ type: 'new_road' }],
          },
        ],
      },
    }),
  );
  await page.goto('/');
  await gate(page);
  await page.reload();
  await expect(page.getByTestId('stage-build')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('shell-run-tag').click();
  await expect(page.getByTestId('run-list')).toBeVisible();
}

test('the inventory renders names, plain-terms fingerprints, change summaries — and no ranking', async ({ page }) => {
  await openList(page);
  const named = page.getByTestId(`run-row-${DONE_NAMED}`);
  await expect(named).toContainText('Kingston pilot v2'); // identity name wins
  await expect(named).toContainText('settled');
  await expect(named).toContainText('calibrated counts');
  await expect(named).toContainText('3 seeds');
  await expect(named).toContainText('road closure + speed limit');
  const plain = page.getByTestId(`run-row-${DONE_PLAIN}`);
  await expect(plain).toContainText('Reduced max speed on edge E9'); // description fallback
  await expect(plain).toContainText('day-one');
  await expect(plain).toContainText('1 seed');
  // the example row is synthesized (committed run, no local state) and labeled
  await expect(page.getByTestId('run-row-multimodal-scenario-20260814T063253Z')).toContainText('the example');
  // the inventory framing renders; nothing on the list ranks or scores
  const list = await page.getByTestId('run-list').innerText();
  expect(list).toContain('an inventory, not a ranking — no scores or deltas here; comparison lives in Explore');
  expect(list).toContain('deltas live in Compare — it refuses mismatched provenance');
  // the two framing sentences DISCLAIM ranking by naming it — strip the pinned copies, then
  // sweep the data rows (a delta/score/best-worst leaking into a ROW is the violation)
  const rowsOnly = list
    .replace('an inventory, not a ranking — no scores or deltas here; comparison lives in Explore', '')
    .replace('deltas live in Compare — it refuses mismatched provenance', '');
  expect(rowsOnly).not.toMatch(RANKING);
  expect(list).not.toMatch(BANNED);
  expect(list).not.toMatch(STANCE_TALLY);
});

test('a computing run shows its stage; clone/compare stay locked; it opens in its current state', async ({ page }) => {
  await openList(page);
  const row = page.getByTestId(`run-row-${COMPUTING}`);
  await expect(row.getByTestId('run-row-computing')).toHaveText('baseline run');
  await expect(row).toContainText('clone and compare unlock when the run finishes');
  await expect(row.getByTestId(`run-row-clone-${COMPUTING}`)).toHaveCount(0);
  await expect(row.getByTestId(`run-row-compare-a-${COMPUTING}`)).toHaveCount(0);
  // "opens in its current state" — the Build stage's watcher
  await page.route(`**/api/runs/${COMPUTING}/status`, (route) =>
    route.fulfill({ json: { run_id: COMPUTING, status: 'running', stage: 'baseline', description: 'New road A->B' } }),
  );
  await row.getByTestId(`run-row-open-${COMPUTING}`).click();
  await expect(page.getByTestId('run-list')).toHaveCount(0);
  await expect(page.getByTestId('edit-panel')).toBeVisible();
  await expect(page.getByTestId('run-card')).toBeVisible();
});

test('CLONE loads the members into a fresh draft (the primary iteration affordance)', async ({ page }) => {
  await openList(page);
  await page.getByTestId(`run-row-clone-${DONE_NAMED}`).click();
  await expect(page.getByTestId('run-list')).toHaveCount(0);
  await expect(page.getByTestId('edit-panel')).toBeVisible();
  await expect(page.getByTestId('draft-panel')).toBeVisible();
  await expect(page.locator('[data-testid^="draft-member-"]')).toHaveCount(2); // both members arrive
});

test('COMPARE AS B feeds Explore·Compare with that run on side B', async ({ page }) => {
  await openList(page);
  const fs = await import('node:fs');
  const path = await import('node:path');
  const art = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'school-zone-run.json'), 'utf-8'));
  const runB = { ...art, meta: { ...art.meta, run_id: DONE_PLAIN } };
  await page.route(`**/${DONE_PLAIN}.json`, (route) =>
    route.fulfill({ body: JSON.stringify(runB), contentType: 'application/json' }),
  );
  await page.getByTestId(`run-row-compare-b-${DONE_PLAIN}`).click();
  await expect(page.getByTestId('compare-view')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('compare-prov-b')).toContainText('20260901T020202Z', { timeout: 10_000 });
});

test('the viewing run is marked; its OPEN is inert text, not a dead button', async ({ page }) => {
  await openList(page);
  // the loaded artifact is the default fixture (school-zone-fixture) — not in the server list,
  // so no row is "viewing"; open a run, reopen the list, and the marking follows it.
  await page.route(`**/${DONE_PLAIN}.json`, async (route) => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const art = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'school-zone-run.json'), 'utf-8'));
    await route.fulfill({
      body: JSON.stringify({ ...art, meta: { ...art.meta, run_id: DONE_PLAIN } }),
      contentType: 'application/json',
    });
  });
  await page.getByTestId(`run-row-open-${DONE_PLAIN}`).click();
  await expect(page.getByTestId('run-document')).toBeVisible({ timeout: 10_000 }); // finished runs land at Read
  await page.getByTestId('shell-run-tag').click();
  const row = page.getByTestId(`run-row-${DONE_PLAIN}`);
  await expect(row).toContainText('viewing');
  await expect(row).toContainText('OPEN — VIEWING');
  await expect(row.getByTestId(`run-row-open-${DONE_PLAIN}`)).toHaveCount(0);
});
