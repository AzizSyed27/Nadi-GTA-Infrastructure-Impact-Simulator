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

test('a malformed pointer degrades to the shell, never a render crash', async ({ page }) => {
  // V2.5c review-caught: well-formed JSON of the WRONG shape (neither {run_id} nor an artifact)
  // must not commit a bogus artifact — that blew up at the meta.bbox destructure in render.
  await page.route('**/latest.json', (route) => route.fulfill({ json: { weird: true } }));
  await page.goto('/');
  // the LABELED loading state survives (nothing bogus committed) — no dev-overlay crash
  await expect(page.getByText('Loading scenario…')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500); // give a would-be crash time to unmount the shell
  await expect(page.getByText('Loading scenario…')).toBeVisible();
  await expect(page.getByTestId('scorecard-panel')).toHaveCount(0); // nothing bogus committed
});

test('the pinned specs are independent of latest.json (repoint it and they still pass)', async ({ page }) => {
  // V2.5c: latest.json is the POINTER ONLY ({run_id}) — repoint it at a social-less new_road run
  // (a ~50-byte write, no 20 MB copy) and confirm the pinned discourse view is unaffected, while
  // the DEFAULT view resolves the repoint.
  const pub = path.resolve(__dirname, '..', 'public');
  const latest = path.join(pub, 'latest.json');
  const backup = fs.existsSync(latest) ? fs.readFileSync(latest) : null;
  fs.writeFileSync(latest, JSON.stringify({ run_id: 'multimodal-scenario-20260709T221140Z' })); // real new_road run, no social
  try {
    // pinned run still drives discourse, unaffected by latest.json
    await page.goto(PINNED_URL);
    await page.getByTestId('mode-discourse').click();
    await expect(page.getByTestId('discourse-feed')).toBeVisible();
    // the default view resolves the pointer to the new_road run → discourse is locked (no social)
    await page.goto('/');
    // 20s: the resolved artifact is a real ~20 MB fetch+parse on '/' in dev mode (the same
    // budget the other mount-path waits use; no client-side schema validation runs — V2.5c fact)
    await expect(page.getByTestId('mode-discourse')).toBeDisabled({ timeout: 20_000 });
  } finally {
    if (backup) fs.writeFileSync(latest, backup); // restore as-found
    else fs.unlinkSync(latest);
  }
});
