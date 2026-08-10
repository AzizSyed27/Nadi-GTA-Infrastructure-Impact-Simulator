import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// V2.4c — clone-to-draft + run identity (name/note). Backend fully mocked; the identity store is a
// CLOSURE VAR so a rename genuinely "persists" across ↻ and page.reload() through the mock, the
// way the real sidecar does. The clone case uses the REAL 0.8.0 fixture artifact (the CLAUDE.md
// hard-part: cross-version cloning is tested against a real pre-current-version artifact, not a
// fresh fixture). The pinned-403 case pins the REAL PINNED_IDENTITY_REASON verbatim (python-side
// source: trajectory_io.PINNED_IDENTITY_REASON — mocked errors pin only PERMANENT server strings).

const RUN_ID = 'multimodal-scenario-identity-fixture';
const FIXTURE = path.join(__dirname, 'fixtures', 'school-zone-run.json');
const BANNED = /\b(majority|minority|referendum|consensus|unanimous|plurality)\b/i;

const PINNED_IDENTITY_REASON =
  'multimodal-scenario-20260702T044134Z is the PINNED Playwright/report anchor: a name or note ' +
  'on it changes the runLabel output on every spec-pinned run-picker surface (the edit rail + ' +
  'both compare pickers) and breaks the spec suite hours later with no obvious cause. Refusing ' +
  'the identity write (clone-to-draft stays open — it only reads). For a deliberate re-pin set ' +
  'NADI_ALLOW_PINNED_ENRICH=1.';

function fixtureArtifact(): { body: string; changes: Record<string, unknown>[] } {
  const art = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
  return { body: JSON.stringify(art), changes: art.meta.scenario.changes };
}

/** Backend mock with a mutable identity store; opts.identity403 makes the identity POST refuse. */
async function mockBackend(
  page: Page,
  changes: Record<string, unknown>[],
  opts: { identity403?: string } = {},
) {
  const identity: { name?: string; note?: string } = {};
  let lastSimBody: Record<string, unknown> | null = null;
  await page.route('**/api/junctions**', (r) => r.fulfill({ json: { junctions: [], count: 0 } }));
  await page.route('**/api/edges**', (r) => r.fulfill({ json: { edges: [], count: 0 } }));
  await page.route('**/api/runs', (r) =>
    r.fulfill({
      json: {
        runs: [{
          id: RUN_ID, description: 'School zone: 30 km/h on 3 streets', status: 'done',
          stage: 'done', started_at: 2, ...(identity.name ? { name: identity.name } : {}),
        }],
      },
    }));
  await page.route('**/api/runs/*/identity', (r) => {
    if (opts.identity403) return r.fulfill({ status: 403, json: { detail: opts.identity403 } });
    const body = r.request().postDataJSON() as { name?: string; note?: string };
    identity.name = (body.name ?? '').trim() || undefined;
    identity.note = (body.note ?? '').trim() || undefined;
    return r.fulfill({ json: { ...(identity.name ? { name: identity.name } : {}), ...(identity.note ? { note: identity.note } : {}) } });
  });
  await page.route('**/api/runs/*/status', (r) =>
    r.fulfill({
      json: {
        run_id: RUN_ID, stage: 'done', status: 'done',
        description: 'School zone: 30 km/h on 3 streets',
        demand_profile: 'synthetic_demo',
        change: changes[0], changes, tags: ['school_zone'],
        cars_rerouted: 0, car_median_delta_s: 0.4,
        ...(identity.name ? { name: identity.name } : {}),
        ...(identity.note ? { note: identity.note } : {}),
      },
    }));
  await page.route('**/api/simulate', (r) => {
    lastSimBody = r.request().postDataJSON();
    return r.fulfill({ json: { run_id: 'multimodal-scenario-cloned-fixture' } });
  });
  const { body } = fixtureArtifact();
  await page.route(`**/${RUN_ID}.json`, async (r) => {
    // compare.spec convention: delay a tiny fixture past StrictMode's double-mount window
    await new Promise((res) => setTimeout(res, 500));
    await r.fulfill({ body, contentType: 'application/json' });
  });
  return { getSimBody: () => lastSimBody };
}

async function openRunCard(page: Page) {
  await page.goto(`/?run=${RUN_ID}`);
  await page.getByTestId('mode-edit').waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
  await page.reload();
  await expect(page.getByTestId('mode-edit')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('mode-edit').click();
  await page.getByTestId('run-select').selectOption(RUN_ID);
  await expect(page.getByTestId('run-card')).toBeVisible();
}

test('clone a REAL 0.8.0 run to draft: members + tag + options land; an edited draft POSTs differently', async ({ page }) => {
  const { changes } = fixtureArtifact();
  const { getSimBody } = await mockBackend(page, changes);
  await openRunCard(page);

  await page.getByTestId('clone-to-draft').click();
  // the run view yields to a FRESH draft: 3 members, the reconstructed zone tag, no name copied
  await expect(page.getByTestId('draft-panel')).toBeVisible();
  await expect(page.locator('[data-testid^="draft-member-"]')).toHaveCount(3);
  await expect(page.getByTestId('draft-tag')).toHaveText('school_zone');
  // the zone members are windowed → the draft-level D1 lock holds
  await expect(page.getByTestId('option-assignment')).toBeDisabled();

  // iterate: remove one member → the new scenario differs from the source
  await page.locator('[data-testid^="draft-remove-"]').first().click();
  await expect(page.locator('[data-testid^="draft-member-"]')).toHaveCount(2);
  await page.getByTestId('draft-run').click();
  await expect(page.getByTestId('run-card')).toBeVisible();
  const body = getSimBody() as { changes?: { target_edge: string }[]; tags?: string[]; change?: unknown } | null;
  expect(body?.change).toBeUndefined();
  expect(body?.tags).toEqual(['school_zone']); // the tag survives the clone via origin reconstruction
  expect(body?.changes).toHaveLength(2); // differs from the 3-member source
  const sourceEdges = changes.map((c) => c.target_edge as string).sort();
  const clonedEdges = (body?.changes ?? []).map((c) => c.target_edge).sort();
  expect(sourceEdges).toEqual(expect.arrayContaining(clonedEdges)); // a strict subset of the source
  expect(BANNED.test(await page.getByTestId('edit-panel').innerText())).toBe(false);
});

test('rename renders on the card + picker and survives reload; note round-trips', async ({ page }) => {
  const { changes } = fixtureArtifact();
  await mockBackend(page, changes);
  await openRunCard(page);

  await page.getByTestId('rename-toggle').click();
  await page.getByTestId('name-input').fill('Kingston pilot v2');
  await page.getByTestId('note-input').fill('the almost-worked variant');
  await page.getByTestId('identity-save').click();
  await expect(page.getByTestId('run-name')).toHaveText('Kingston pilot v2');
  await expect(page.getByTestId('run-note')).toHaveText('the almost-worked variant');

  // the picker label carries the name after a refresh (the ↻ affordance)
  await page.getByTestId('run-refresh').click();
  await expect(page.getByTestId('run-select')).toContainText('Kingston pilot v2');

  // and a full reload re-reads it from the (mock-persisted) sidecar
  await page.reload();
  await expect(page.getByTestId('mode-edit')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('mode-edit').click();
  await page.getByTestId('run-select').selectOption(RUN_ID);
  await expect(page.getByTestId('run-name')).toHaveText('Kingston pilot v2');

  // clearing through the UI (review-caught gap): an empty save removes the name AND the note —
  // the local status merge must actually CLEAR the rendered lines, not leave them stale
  await page.getByTestId('rename-toggle').click();
  await page.getByTestId('name-input').fill('');
  await page.getByTestId('note-input').fill('');
  await page.getByTestId('identity-save').click();
  await expect(page.getByTestId('run-name')).toHaveCount(0);
  await expect(page.getByTestId('run-note')).toHaveCount(0);

  // note-only save: a note without a name renders alone
  await page.getByTestId('rename-toggle').click();
  await page.getByTestId('note-input').fill('note without a name');
  await page.getByTestId('identity-save').click();
  await expect(page.getByTestId('run-note')).toHaveText('note without a name');
  await expect(page.getByTestId('run-name')).toHaveCount(0);
});

test('the pinned run refuses a rename with the exact shared reason', async ({ page }) => {
  const { changes } = fixtureArtifact();
  await mockBackend(page, changes, { identity403: PINNED_IDENTITY_REASON });
  await openRunCard(page);

  await page.getByTestId('rename-toggle').click();
  await page.getByTestId('name-input').fill('should be refused');
  await page.getByTestId('identity-save').click();
  await expect(page.getByTestId('identity-error')).toHaveText(PINNED_IDENTITY_REASON);
  await expect(page.getByTestId('run-name')).toHaveCount(0); // nothing renamed
});

test('an injection name renders INERT on BOTH surfaces it reaches (card + picker option)', async ({ page }) => {
  // React escapes by default so this passes trivially TODAY — the pin exists so any FUTURE surface
  // that renders names (a report header, a chat corpus label) inherits a failing test the moment
  // it renders them un-inertly.
  const { changes } = fixtureArtifact();
  await mockBackend(page, changes);
  await openRunCard(page);

  const evil = '<img src=x onerror=window.__pwned=1>**bold**';
  await page.getByTestId('rename-toggle').click();
  await page.getByTestId('name-input').fill(evil);
  await page.getByTestId('identity-save').click();

  await expect(page.getByTestId('run-name')).toHaveText(evil); // the LITERAL string, as text
  await page.getByTestId('run-refresh').click();
  await expect(page.getByTestId('run-select')).toContainText('<img src=x'); // picker option: literal too
  expect(await page.locator('img[src="x"]').count()).toBe(0); // never an element
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  expect(await page.locator('[data-testid="run-name"] b, [data-testid="run-name"] strong').count()).toBe(0);
});
