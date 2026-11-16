import { test, expect, type Page } from '@playwright/test';
import { LANDING_TEST_COUNTS } from '../lib/landingCounts';
import { mockDefaultArtifact } from './support/default-artifact';
import { gate } from './support/shell';
import { BANNED, STANCE_TALLY } from './support/sweeps';

// V2.8 — THE FRONT DOOR. The landing page owns `/` (the ratified canvas "Nadi Landing.dc.html");
// the shell lives at `/app/`. These pins cover: the page's sections, the ratified copy
// corrections (canvas → the repo's record) as literals, the same-host demo links, the one-source
// test counts, the count-ups' targets, and that the landing asks nothing of an API or artifact.
//
// THE HERO IS A RATIFIED EXCEPTION (user, 2026-11-15): "Plan, Preview, and Predict." and the two
// vehicles meeting at "Predict" ship exactly as designed, on this page only. The headline pin
// below is that decision, not an oversight — the product's preview-never-oracle rule is unchanged
// everywhere else.

const PINNED = 'multimodal-scenario-20260702T044134Z';
const EXAMPLE = 'multimodal-scenario-20260814T063253Z';

// The page QUOTES what the tool refuses to say; those quotes are exempt from the sweep by literal.
const REFUSED_EXAMPLE = '“62% of residents support the change.”';
const FOOTER_DISCLAIMER =
  'A stakeholder-reaction preview. Not a referendum, not a recommendation, not a crash predictor. Bounded to one corridor, and it says so.';

async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('landing')).toBeVisible({ timeout: 30_000 });
}

test('the landing owns / — every section of the canvas, and the ratified headline', async ({ page }) => {
  await open(page);
  for (const label of [
    'Landing nav', 'Landing hero', 'Landing street', 'Landing 01 what it does', 'Landing 02 how it works',
    'Landing 03 findings', 'Landing thesis interlude', 'Landing 04 honesty', 'Landing 05 demo', 'Landing footer',
  ]) {
    await expect(page.locator(`[data-screen-label="${label}"]`), label).toHaveCount(1);
  }
  const h1 = page.locator('h1');
  for (const word of ['Plan,', 'Preview,', 'and', 'Predict.']) await expect(h1).toContainText(word);
  await expect(page.locator('[data-intro-car]')).toHaveCount(4); // the intro vehicles, as designed
  await expect(page.getByTestId('landing-voice-dot')).toHaveCount(212);
});

test('the copy corrections render as the record states them, and the canvas wording is gone', async ({ page }) => {
  await open(page);
  const shipped = [
    'No tallies, averages or winners. A banned-language sweep in 24 of 36 Playwright suites, plus a Python sweep, fails the test suite on tally language.',
    'Worst added time for a fire truck to reach the west end of the closed street, routed free-flow from four real Toronto Fire stations, among those that can still reach it.',
    'The corridor’s synthetic morning demand',
    'PROVENANCE MISMATCH · FLAGGED',
    'Side by side, including the provenance-mismatch guard doing its job on a mismatched pair.',
    'Dropped onto a street for the whole run; the school-zone macro times it.',
    'Traffic moves around it. Nadi previews who that reaches, and what each of them is likely to say, before anyone is consulted.',
    'A read-only replay of finished SUMO runs on the real Toronto corridor; editing, chat and interviews need the local backend, and the demo says so instead of failing quietly.',
    'ANOTHER STATION',
  ];
  for (const s of shipped) await expect(page.getByText(s, { exact: true }), s).toHaveCount(1);
  await expect(page.getByText('what each of them is likely to say, before anyone is consulted. The tool arranges evidence.')).toHaveCount(1);

  const body = (await page.getByTestId('landing').innerText()).replace(/\s+/g, ' ');
  for (const gone of [
    'fails CI', 'the nearest of four', 'About 67,000 morning travelers', 'NOT COMPARED',
    'should not be compared', 'will say', 'or a timed window', 'OR A TIMED WINDOW',
    'NEAREST STATION', 'on calibrated Toronto open data', '06:00',
  ]) {
    expect(body, gone).not.toContain(gone);
  }
});

test('the referendum sweep passes over everything the page says in its own voice', async ({ page }) => {
  await open(page);
  let body = (await page.getByTestId('landing').innerText()).replace(/\s+/g, ' ');
  for (const quoted of [REFUSED_EXAMPLE, FOOTER_DISCLAIMER]) {
    expect(body, quoted).toContain(quoted); // the exemption is by literal: if the quote moves, this fails
    body = body.replace(quoted, '');
  }
  expect(body).not.toMatch(BANNED);
  expect(body).not.toMatch(STANCE_TALLY);
});

test('every demo link is same-host /app/, the three stops carry their runs, and the CTA lands in the shell', async ({ page }) => {
  await mockDefaultArtifact(page);
  await open(page);
  const hrefs = await page.locator('[data-testid="landing"] a').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  expect(hrefs.filter((h) => h.includes('nadi-demo.pages.dev'))).toEqual([]);
  expect(hrefs.filter((h) => h.startsWith('/app/')).sort()).toEqual([
    '/app/', '/app/', '/app/', '/app/', '/app/',
    `/app/?run=${PINNED}`,
    `/app/?run=${PINNED}&compare=${EXAMPLE}`,
  ]);
  await page.getByRole('link', { name: 'Try the live demo' }).click();
  await page.waitForURL((u) => u.pathname === '/app/', { timeout: 20_000 });
  await gate(page);
  await expect(page.getByTestId('stage-nav')).toBeVisible({ timeout: 20_000 });
});

test('the landing asks nothing of an API and fetches no artifact', async ({ page }) => {
  const hits: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/|\.json(\?|$)/.test(r.url())) hits.push(r.url());
  });
  await open(page);
  await page.locator('#demo').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500); // let any lazy fetch fire
  expect(hits).toEqual([]);
});

test('the test counts come from the one constant', async ({ page }) => {
  await open(page);
  const run = page.locator('#run');
  await expect(run).toContainText(`${LANDING_TEST_COUNTS.pytest}PYTEST`);
  await expect(run).toContainText(`${LANDING_TEST_COUNTS.playwright}PLAYWRIGHT`);
  await expect(run).toContainText(`${LANDING_TEST_COUNTS.staticDemo}STATIC-DEMO`);
});

test('under reduced motion the figures are simply there — no count-up to wait for', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await page.locator('#findings').scrollIntoViewIfNeeded();
  const findings = page.locator('#findings');
  await expect(findings).toContainText('+29.1', { timeout: 5_000 });
  await expect(findings).toContainText('30 against 28');
  await expect(findings).toContainText('72%');
  await expect(findings).toContainText('51.8% of 421 links');
  await page.locator('#how-console').scrollIntoViewIfNeeded();
  await expect(page.locator('#how-console strong')).toHaveText('212', { timeout: 5_000 });
});

test('the count-ups land on the recorded figures, and Replay restarts the console', async ({ page }) => {
  // a viewport tall enough to hold the whole console: at 720 px Playwright scrolls the page to
  // lift Replay clear of the sticky nav, which moves the console out of its own trigger zone
  await page.setViewportSize({ width: 1280, height: 1100 });
  await open(page);
  await page.locator('#how-console').scrollIntoViewIfNeeded();
  const voices = page.locator('#how-console strong');
  await expect(voices).toHaveText('212', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Replay' }).click();
  await expect(voices).toHaveText('0'); // the console clock restarted
  await expect(voices).toHaveText('212', { timeout: 15_000 });
  await page.locator('#findings').scrollIntoViewIfNeeded();
  await expect(page.locator('#findings')).toContainText('+29.1', { timeout: 10_000 });
});

test('hovering a change tile lights its preview', async ({ page }) => {
  await open(page);
  const tile = page.locator('#what').getByText('Bike lane', { exact: true }).locator('xpath=..');
  await tile.scrollIntoViewIfNeeded();
  await expect(tile).not.toHaveAttribute('style', /var\(--color-accent\)/);
  await tile.hover();
  await expect(tile).toHaveAttribute('style', /var\(--color-accent\)/);
});
