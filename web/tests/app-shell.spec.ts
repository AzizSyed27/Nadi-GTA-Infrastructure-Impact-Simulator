import { test, expect } from '@playwright/test';
import { mockDefaultArtifact } from './support/default-artifact';
import { gate } from './support/shell';
import { BANNED, STANCE_TALLY } from './support/sweeps';

// V2.7a — the APP SHELL's own spec: the LANDING PRECEDENCE CHAIN
// (?run= → localStorage last-viewed → the latest.json pointer → the committed EXAMPLE run)
// with every failure labeled, plus ride-along 6a: the V2.5c legacy payload-shaped latest.json
// EXPIRED — it now takes the labeled error path (deleting only the console.warn would have
// loaded it silently).

const EXAMPLE = 'multimodal-scenario-20260814T063253Z';

test('a malformed pointer degrades LABELED, never a render crash', async ({ page }) => {
  // V2.5c review-caught: well-formed JSON of the WRONG shape (neither {run_id} nor an artifact)
  // must not commit a bogus artifact — that blew up at the meta.bbox destructure in render.
  // The chain deliberately ABORTS here rather than falling to the example: an unrecognized
  // pointer is a broken installation, not a cold visitor.
  await page.route('**/latest.json', (route) => route.fulfill({ json: { weird: true } }));
  await page.goto('/');
  await expect(page.getByTestId('artifact-load-error')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('scorecard-panel')).toHaveCount(0); // nothing bogus committed
});

test('a payload-shaped latest.json takes the LABELED error path (the V2.5c fallback expired)', async ({ page }) => {
  // Ride-along 6a. The legacy branch used to console.warn and LOAD the payload — deleting the
  // warn alone would have made the compat path invisible; instead the payload shape is refused
  // with the regeneration path named.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const body = fs.readFileSync(path.resolve(__dirname, 'fixtures', 'school-zone-run.json'), 'utf-8');
  await page.route('**/latest.json', (route) =>
    route.fulfill({ body, contentType: 'application/json' }),
  );
  await page.goto('/');
  const err = page.getByTestId('artifact-load-error');
  await expect(err).toBeVisible({ timeout: 20_000 });
  await expect(err).toContainText('legacy full-artifact payload');
  await expect(err).toContainText('pointer');
  await expect(page.getByTestId('scorecard-panel')).toHaveCount(0); // the payload never commits
});

test('pointer 404 alone → the committed EXAMPLE lands read-only at Read', async ({ page }) => {
  // The ratified cold landing: a fresh clone has no latest.json — the chain falls through to
  // the example. The CHAIN is what this pins (the example URL resolving + the read-only
  // semantics), so the example body is a fixture stand-in — the REAL committed example renders
  // end-to-end in run-document.spec's ?run= test (a ~20 MB dev fetch here starved the next
  // test's setup under full-suite contention).
  const fs = await import('node:fs');
  const path = await import('node:path');
  const art = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'school-zone-run.json'), 'utf-8'));
  const example = { ...art, meta: { ...art.meta, run_id: EXAMPLE } };
  await page.route('**/latest.json', (route) => route.fulfill({ status: 404, body: 'not found' }));
  await page.route(`**/${EXAMPLE}.json`, async (route) => {
    await new Promise((res) => setTimeout(res, 500)); // the StrictMode tiny-fixture convention
    await route.fulfill({ body: JSON.stringify(example), contentType: 'application/json' });
  });
  await page.route(`**/${EXAMPLE}-report.json`, (route) => route.fulfill({ status: 404, body: 'nope' }));
  await page.goto('/');
  await gate(page);
  await expect(page.getByTestId('shell-run-tag')).toContainText('20260814T063253Z', { timeout: 30_000 });
  await expect(page.getByTestId('run-document')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('example-kicker')).toHaveText(
    'EXAMPLE RUN · LOADED READ-ONLY · A PREVIEW, NOT A VERDICT',
  );
  // the example's Build stage is the read-only composition view with the clone-to-iterate path
  await page.getByTestId('stage-build').click();
  await expect(page.getByTestId('example-build')).toBeVisible();
  await expect(page.getByTestId('example-build')).toContainText(
    'editing this example is disabled — clone it into a fresh draft to iterate',
  );
  await expect(page.getByTestId('example-start-draft')).toBeVisible();
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(BANNED);
  expect(body).not.toMatch(STANCE_TALLY);
});

test('pointer 404 AND example unavailable → the labeled error, never a spinner', async ({ page }) => {
  await page.route('**/latest.json', (route) => route.fulfill({ status: 404, body: 'not found' }));
  await page.route(`**/${EXAMPLE}.json`, (route) => route.fulfill({ status: 404, body: 'not found' }));
  await page.goto('/');
  const err = page.getByTestId('artifact-load-error');
  await expect(err).toBeVisible({ timeout: 20_000 });
  await expect(err).toContainText("couldn't load the scenario artifact");
  await expect(err).toContainText('?run=');
});

test('a RETURNING user lands on their last-viewed run — localStorage beats the pointer', async ({ page }) => {
  // pointer → run A; persisted last-viewed → run B; the landing must resolve B.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const art = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'school-zone-run.json'), 'utf-8'));
  const runB = { ...art, meta: { ...art.meta, run_id: 'multimodal-scenario-LASTVIEWED' } };
  await mockDefaultArtifact(page); // pointer pair → run A (the default fixture)
  await page.route('**/multimodal-scenario-LASTVIEWED.json', (route) =>
    route.fulfill({ body: JSON.stringify(runB), contentType: 'application/json' }),
  );
  await page.addInitScript(() => {
    window.localStorage.setItem('nadi:lastRun', 'multimodal-scenario-LASTVIEWED');
  });
  await page.goto('/');
  await gate(page);
  await expect(page.getByTestId('shell-run-tag')).toContainText('LASTVIEWED', { timeout: 20_000 });
});

test('an unresolvable stored run id falls through the chain (validated, never trusted)', async ({ page }) => {
  await mockDefaultArtifact(page); // the pointer resolves run A
  await page.addInitScript(() => {
    window.localStorage.setItem('nadi:lastRun', 'multimodal-scenario-PRUNED-LONG-AGO');
  });
  // the stored id 404s (nothing routes it) → hop 3 (the pointer) must land run A
  await page.goto('/');
  await gate(page);
  // the tag renders the ARTIFACT's own run id (the pointer alias never surfaces)
  await expect(page.getByTestId('shell-run-tag')).toContainText('school-zone-fixture', { timeout: 20_000 });
});

test('the shell chrome renders the four stages and passes the referendum sweep', async ({ page }) => {
  await mockDefaultArtifact(page);
  await page.goto('/');
  await gate(page);
  await page.reload();
  await expect(page.getByTestId('stage-nav')).toBeVisible({ timeout: 20_000 });
  for (const s of ['build', 'watch', 'read', 'explore']) {
    await expect(page.getByTestId(`stage-${s}`)).toBeVisible();
  }
  // the header carries the project's framing, never a verdict surface
  const body = await page.locator('body').innerText();
  expect(body).toContain('arranges evidence · the planner concludes');
  expect(body).not.toMatch(BANNED);
  expect(body).not.toMatch(STANCE_TALLY);
});
