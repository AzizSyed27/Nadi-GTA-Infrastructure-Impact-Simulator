import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Phase 4.3 — the REFERENDUM GUARD (extended) + the load-bearing EXCLUDED-CONTENT filter, asserted across
// every view. The litmus for the referendum guard: no surface may answer "so did they end up for or against?"
// Transition counts ("38 hardened, 25 warmed") ARE movement and allowed; a tally/verdict is not.

// 5.2b: pin to the committed 212-agent social run via ?run=, so these specs no longer depend on latest.json
// (which the editor now overwrites at will — it is only the current-run pointer).
const PINNED = 'multimodal-scenario-20260702T044134Z';
const PINNED_URL = `/?run=${PINNED}`;

async function gotoDiscourse(page: Page) {
  await page.goto(PINNED_URL);
  await page.getByTestId('mode-discourse').click();
  await expect(page.getByTestId('discourse-feed')).toBeVisible();
}

// verdict/tally words the audit itself bans in prose — must never surface anywhere.
const BANNED = /\b(majority|minority|referendum|consensus|unanimous|plurality)\b/i;
// a stance head-count / final split, e.g. "73% support", "final distribution", "12 for / 8 against".
const STANCE_TALLY = /\d+\s*%[^.]{0,24}(support|oppos|favou?r|against)|\bfinal (distribution|tally|result|vote)\b|\d+\s+for\s*\/\s*\d+\s+against/i;

test('referendum guard: no tallies, no stance-over-time chart, at any cascade step', async ({ page }) => {
  await gotoDiscourse(page);
  const tabs = page.locator('[data-testid^="cascade-tab-"]');
  const n = await tabs.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    await tabs.nth(i).click();
    await expect(page.getByTestId('engagement-panel')).toBeVisible();
    const body = (await page.locator('body').innerText());
    expect(body).not.toMatch(BANNED);
    expect(body).not.toMatch(STANCE_TALLY);
    // no stance-over-time CHART (a tally in motion): the discourse feed + engagement panel are text-only.
    expect(await page.locator('[data-testid="discourse-feed"] svg, [data-testid="discourse-feed"] canvas').count()).toBe(0);
    expect(await page.locator('[data-testid="engagement-panel"] svg, [data-testid="engagement-panel"] canvas').count()).toBe(0);
  }
});

test('movement (transition counts) IS allowed and present', async ({ page }) => {
  await gotoDiscourse(page);
  // a shift row renders a stance transition (movement, not a position) — the guard must not have removed these.
  await expect(page.getByTestId('discourse-shift').first()).toBeVisible();
  await expect(page.getByTestId('discourse-shift').first()).toContainText('→');
});

test('excluded content appears NOWHERE in the DOM, across playback, every cascade, and the report', async ({ page }) => {
  await page.goto(PINNED_URL);
  const excluded: string[] = await page.evaluate(async (pin) => {
    const art = await (await fetch(`/${pin}.json`)).json();
    const out: string[] = [];
    for (const c of art.social?.cascades ?? [])
      for (const s of c.steps ?? [])
        for (const e of s.events ?? [])
          if (e.content && e.audit_status === 'excluded') out.push(e.content);
    return out;
  }, PINNED);
  expect(excluded.length).toBeGreaterThan(0); // the filter is only meaningful if there IS excluded content

  const assertAbsent = async (label: string) => {
    const body = await page.locator('body').innerText();
    for (const s of excluded) expect(body, `${label}: excluded content leaked`).not.toContain(s);
  };

  await assertAbsent('playback'); // default view
  await page.getByTestId('mode-discourse').click();
  const tabs = page.locator('[data-testid^="cascade-tab-"]');
  const n = await tabs.count();
  for (let i = 0; i < n; i++) {
    await tabs.nth(i).click();
    // expand the feed so hidden rows are in the DOM too
    const more = page.getByTestId('discourse-show-more');
    if (await more.count()) await more.click();
    await assertAbsent(`discourse cascade ${i + 1}`);
  }
  // the report view
  await page.getByTestId('open-report').click();
  await expect(page.getByTestId('report-discourse')).toBeVisible();
  await assertAbsent('report');
});

test('the pinned specs are independent of latest.json (overwrite it and they still pass)', async ({ page }) => {
  // latest.json is now only the editor's current-run pointer — overwrite it with a social-less new_road run
  // and confirm the pinned discourse view is unaffected, while the DEFAULT view reflects the overwrite.
  const pub = path.resolve(__dirname, '..', 'public');
  const latest = path.join(pub, 'latest.json');
  const newRoad = path.join(pub, 'multimodal-scenario-20260709T221140Z.json'); // real new_road run, no social
  const backup = fs.readFileSync(latest);
  fs.copyFileSync(newRoad, latest);
  try {
    // pinned run still drives discourse, unaffected by latest.json
    await page.goto(PINNED_URL);
    await page.getByTestId('mode-discourse').click();
    await expect(page.getByTestId('discourse-feed')).toBeVisible();
    // the default view (latest.json) now shows the new_road run → discourse is locked (no social)
    await page.goto('/');
    await expect(page.getByTestId('mode-discourse')).toBeDisabled();
  } finally {
    fs.writeFileSync(latest, backup); // restore (idempotent; harmless either way once latest.json is gitignored)
  }
});
