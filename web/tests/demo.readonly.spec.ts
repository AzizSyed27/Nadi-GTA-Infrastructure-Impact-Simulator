// V2.7f C4 — THE STATIC DEMO'S READ-ONLY SURFACES, against the served bundle (the `static-demo`
// project on :3001 — no route mocks, no backend, `NEXT_PUBLIC_STATIC_DEMO=1` inlined at build).
// The rule from web/lib/demo.ts: every live affordance is DISABLED WITH THE WHY, and every disabled
// surface renders DEMO_READONLY_NOTE verbatim — a stranger who clicks Run and gets an error learns
// the tool is broken; one who reads the sentence learns what the tool is. These pins are the
// structural half of what V2.5d verified by hand: the header's lock, the document's doors, the
// chat, AND the three routes the exploration found ungated (the run list's clone / new-draft
// buttons reach the Build stage past the header's lock; the run card's enrich buttons; Compare's
// run pickers), plus the demo-aware discourse caption and the example's graphs sidecar (C3).
// `stage-build` is DISABLED in the demo, so the shell helpers' `openStage(page, 'build')` is never
// used here — a click on it no-ops silently.
import { test, expect, type Page } from '@playwright/test';
import { DEMO_READONLY_NOTE, EXAMPLE_RUN_ID, EXAMPLE_RUN_NAME } from '../lib/demo';
import { BANNED, STANCE_TALLY } from './support/sweeps';

const PINNED = 'multimodal-scenario-20260702T044134Z';

async function landing(page: Page, url = '/') {
  await page.goto(url);
  await expect(page.getByTestId('stage-build')).toBeAttached({ timeout: 30_000 });
}

test('the bare URL lands on the example run document, and Build is locked with the why', async ({ page }) => {
  await landing(page);
  await expect(page.getByTestId('example-kicker')).toHaveText('EXAMPLE RUN · LOADED READ-ONLY · A PREVIEW, NOT A VERDICT');
  await expect(page.getByTestId('run-document')).toContainText(EXAMPLE_RUN_NAME);
  await expect(page.getByTestId('stage-build')).toBeDisabled();
  await expect(page.getByTestId('stage-build')).toHaveAttribute('title', DEMO_READONLY_NOTE);
  await expect(page.getByTestId('build-your-own')).toBeDisabled();
  await expect(page.getByTestId('build-your-own')).toHaveAttribute('title', DEMO_READONLY_NOTE);
  // the example's own "Start a new draft" says why it is disabled too — the title was `undefined`
  const start = page.getByTestId('example-start-draft');
  if (await start.count()) {
    await expect(start).toBeDisabled();
    await expect(start).toHaveAttribute('title', DEMO_READONLY_NOTE);
  }
  if (process.env.NADI_SHOTS) await page.screenshot({ path: '../docs-assets/v27f-demo-landing.png' });
});

test('the document’s doors: the Ask door and the room CTA carry the note; the Hear door still opens Watch', async ({ page }) => {
  await landing(page);
  const rows = page.getByTestId('doc-group-row');
  await rows.nth(0).click();
  const strip = page.getByTestId('doc-evidence');
  await expect(strip).toBeVisible();
  await expect(strip.getByTestId('demo-readonly-note')).toHaveText(DEMO_READONLY_NOTE);
  await expect(page.getByTestId('doc-interview')).toHaveCount(0);
  await rows.nth(1).click();
  const cta = page.getByTestId('doc-room-cta');
  if (await cta.count()) {
    await expect(cta).toBeDisabled();
    await expect(page.getByTestId('demo-readonly-note').last()).toHaveText(DEMO_READONLY_NOTE);
  }
  // the one door that needs no backend
  await page.getByTestId('doc-tray-clear').click();
  await rows.nth(0).click();
  await page.getByTestId('doc-hear').click();
  await expect(page.getByTestId('comment-feed')).toBeVisible({ timeout: 20_000 });
});

test('the run list has no "backend unreachable" — it says the note, opens the example, and locks clone / new draft', async ({ page }) => {
  await landing(page);
  await page.getByTestId('shell-run-tag').click();
  const list = page.getByTestId('run-list');
  await expect(list).toBeVisible();
  await expect(page.getByTestId('run-list-down')).toHaveCount(0);
  await expect(list.getByTestId('demo-readonly-note')).toHaveText(DEMO_READONLY_NOTE);
  await expect(list).not.toContainText('backend unreachable');
  await expect(list).not.toContainText('Build makes more');
  await expect(page.getByTestId(`run-row-${EXAMPLE_RUN_ID}`)).toBeVisible();
  const clone = page.getByTestId(`run-row-clone-${EXAMPLE_RUN_ID}`);
  await expect(clone).toBeDisabled();
  await expect(clone).toHaveAttribute('title', DEMO_READONLY_NOTE);
  const draft = page.getByTestId('run-list-new-draft');
  await expect(draft).toBeDisabled();
  await expect(draft).toHaveAttribute('title', DEMO_READONLY_NOTE);
  if (process.env.NADI_SHOTS) await page.screenshot({ path: '../docs-assets/v27f-demo-run-list.png' });
  const text = await list.innerText();
  expect(text).not.toMatch(BANNED);
  expect(text).not.toMatch(STANCE_TALLY);
});

test('Watch on the 212-voice run replays its own traffic — the finished run’s playback, never Act I/II', async ({ page }) => {
  await landing(page, `/?run=${PINNED}`);
  await page.getByTestId('stage-watch').click();
  await expect(page.getByTestId('comment-feed')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('act-two')).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => {
    const s = (window as unknown as { __nadiRenderStats?: Record<string, unknown> }).__nadiRenderStats;
    return s ? Object.values(s).some((v) => typeof v === 'number' && v > 0) : false;
  }), { timeout: 20_000 }).toBe(true);
});

test('Explore · Discourse on the example says the enrich needs the backend and points at the run that carries one', async ({ page }) => {
  await landing(page);
  await page.getByTestId('stage-explore').click();
  await page.getByTestId('explore-discourse').click();
  const empty = page.getByTestId('discourse-empty');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('needs the local backend');
  await expect(empty).not.toContainText('Build stage');
  const link = empty.getByRole('link');
  await expect(link).toHaveAttribute('href', `/?run=${PINNED}`);
  if (process.env.NADI_SHOTS) await page.screenshot({ path: '../docs-assets/v27f-demo-discourse-caption.png' });
  // the link resolves inside the bundle (the lockstep with the build script's own literal)
  const r = await page.request.get(`/${PINNED}.json`);
  expect(r.status()).toBe(200);
  const text = await empty.innerText();
  expect(text).not.toMatch(BANNED);
  expect(text).not.toMatch(STANCE_TALLY);
});

test('Explore · Discourse on the 212-voice run renders its cascade', async ({ page }) => {
  await landing(page, `/?run=${PINNED}`);
  await page.getByTestId('stage-explore').click();
  await page.getByTestId('explore-discourse').click();
  await expect(page.getByTestId('discourse-empty')).toHaveCount(0);
  await expect(page.getByTestId('discourse-feed')).toBeVisible({ timeout: 20_000 });
});

test('Explore · Graphs on the example renders the entity graph from the shipped sidecar, never the missing state', async ({ page }) => {
  await landing(page);
  await page.getByTestId('stage-explore').click();
  await page.getByTestId('explore-graphs').click();
  await expect(page.getByTestId('graph-split-view')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('graphs-missing')).toHaveCount(0);
  await expect(page.getByTestId('entity-header')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('oasis-empty')).toBeVisible(); // the example carries no cascade — said, not faked
  if (process.env.NADI_SHOTS) await page.screenshot({ path: '../docs-assets/v27f-demo-graphs-example.png' });
});

test('Explore · Chat carries the note and no composer', async ({ page }) => {
  await landing(page);
  await page.getByTestId('stage-explore').click();
  await page.getByTestId('explore-chat').click();
  await expect(page.getByTestId('chat-panel').getByTestId('demo-readonly-note')).toHaveText(DEMO_READONLY_NOTE);
  await expect(page.getByTestId('chat-input')).toHaveCount(0);
});

test('the Compare deep link: the mismatch guard does its job, and the run pickers are locked with the why', async ({ page }) => {
  await landing(page, `/?run=${PINNED}&compare=${EXAMPLE_RUN_ID}`);
  await expect(page.getByTestId('compare-view')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('mismatch-note').first()).toBeVisible({ timeout: 20_000 });
  const selects = page.getByTestId('run-select');
  await expect(selects).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    await expect(selects.nth(i)).toBeDisabled();
    await expect(selects.nth(i)).toHaveAttribute('title', DEMO_READONLY_NOTE);
  }
  if (process.env.NADI_SHOTS) await page.screenshot({ path: '../docs-assets/v27f-demo-compare-guard.png' });
});
