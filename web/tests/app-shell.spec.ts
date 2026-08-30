import { test, expect } from '@playwright/test';
import { mockDefaultArtifact } from './support/default-artifact';
import { gate } from './support/shell';
import { BANNED, STANCE_TALLY } from './support/sweeps';

// V2.7a — the APP SHELL's own spec (split out of discourse.spec, where the two labeled-landing
// tests had nothing to do with discourse). Pins MapView's load state + the shell chrome.
// The C4 landing rewrite (precedence chain, example fallback, the payload-shaped-pointer
// inversion) lands HERE.

test('a malformed pointer degrades LABELED, never a render crash', async ({ page }) => {
  // V2.5c review-caught: well-formed JSON of the WRONG shape (neither {run_id} nor an artifact)
  // must not commit a bogus artifact — that blew up at the meta.bbox destructure in render.
  // V2.5d: the failure is now LABELED (the artifact-load-error line), not an eternal spinner.
  await page.route('**/latest.json', (route) => route.fulfill({ json: { weird: true } }));
  await page.goto('/');
  await expect(page.getByTestId('artifact-load-error')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('scorecard-panel')).toHaveCount(0); // nothing bogus committed
});

test('a missing default artifact degrades LABELED, never an eternal spinner', async ({ page }) => {
  // V2.5d: the landing page was the app's ONE unlabeled failure — a 404 left a permanent
  // silent "Loading scenario…" (no r.ok check). Now it names the condition.
  await page.route('**/latest.json', (route) => route.fulfill({ status: 404, body: 'not found' }));
  await page.goto('/');
  const err = page.getByTestId('artifact-load-error');
  await expect(err).toBeVisible({ timeout: 20_000 });
  await expect(err).toContainText("couldn't load the scenario artifact");
  await expect(err).toContainText('?run=');
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
