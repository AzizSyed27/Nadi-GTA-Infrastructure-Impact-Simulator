// V2.7f C4 — THE STATIC DEMO BUNDLE, as built: what `scripts/build-static-demo.mjs` leaves in
// `web/out` and what the served bundle asks the network for. Runs under the `static-demo` project
// only (baseURL :3001, python's http.server over `out/`); no route mocks anywhere in this file —
// the point is the UN-mocked no-backend behavior. Two claims:
//   * THE SET: every KEEP file is present (incl. the example run's graphs sidecar, C3), the pointer
//     aims at the EXAMPLE run, no `latest-report.*` payload survives the prune, no non-KEEP JSON
//     rides along, and every file is under Cloudflare Pages' 25 MiB cap.
//   * ZERO API: a landing → run list → Watch → Explore walk issues no request to `/api/*` at all.
//     The demo has no backend; a request to one is a surface that was never gated.
import { test, expect, type Page } from '@playwright/test';
import { APP } from './support/app-url';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EXAMPLE_RUN_ID } from '../lib/demo';

const OUT = path.resolve(__dirname, '..', 'out');
const PINNED = 'multimodal-scenario-20260702T044134Z';
const KEEP = [
  'network.json',
  `${PINNED}.json`, `${PINNED}-graphs.json`, `${PINNED}-report.json`,
  `${EXAMPLE_RUN_ID}.json`, `${EXAMPLE_RUN_ID}-graphs.json`, `${EXAMPLE_RUN_ID}-report.json`,
];
const CAP = 25 * 1024 * 1024;

test('the bundle carries exactly the demo set, the pointer at the example, every file under the cap', () => {
  for (const f of KEEP) expect(fs.existsSync(path.join(OUT, f)), f).toBe(true);
  expect(JSON.parse(fs.readFileSync(path.join(OUT, 'latest.json'), 'utf-8'))).toEqual({ run_id: EXAMPLE_RUN_ID });
  const top = fs.readdirSync(OUT);
  expect(top).not.toContain('latest-report.json');
  expect(top).not.toContain('latest-report.md');
  const strayJson = top.filter((f) => f.endsWith('.json') && f !== 'latest.json' && !KEEP.includes(f));
  expect(strayJson, 'non-KEEP JSON in the bundle').toEqual([]);
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  const over = walk(OUT).filter((f) => fs.statSync(f).size > CAP);
  expect(over, 'files over Cloudflare Pages’ 25 MiB cap').toEqual([]);
});

async function apiRequestsDuring(page: Page, walk: () => Promise<void>): Promise<string[]> {
  const hits: string[] = [];
  page.on('request', (r) => {
    if (/\/api\//.test(r.url())) hits.push(r.url());
  });
  await walk();
  return hits;
}

test('a landing → run list → Watch → Explore walk asks nothing of an API', async ({ page }) => {
  const hits = await apiRequestsDuring(page, async () => {
    await page.goto(APP);
    await expect(page.getByTestId('example-kicker')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('shell-run-tag').click();
    await expect(page.getByTestId('run-list')).toBeVisible();
    await page.getByTestId('run-list-close').click();
    await page.getByTestId('stage-watch').click();
    await expect(page.getByTestId('comment-feed')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('stage-explore').click();
    await page.getByTestId('explore-graphs').click();
    await page.waitForTimeout(1500); // let any lazy fetch fire
  });
  expect(hits, 'requests to /api/* from the static demo').toEqual([]);
});

// V2.8 - the landing page is the bundle's front door: `/` paints the landing (no map, no API, no
// artifact), its CTA opens the shell at /app/ on the SAME host, and a pre-V2.8 deep link at `/`
// forwards to the shell on a plain file server exactly as it does on the CDN.
test('the bundle opens on the landing; its CTA and a pre-V2.8 deep link both reach the shell', async ({ page }) => {
  const hits = await apiRequestsDuring(page, async () => {
    await page.goto('/');
    await expect(page.getByTestId('landing')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('h1')).toContainText('Predict.');
    await page.getByRole('link', { name: 'Try the live demo' }).click();
    await page.waitForURL((u) => u.pathname === '/app/', { timeout: 20_000 });
    await expect(page.getByTestId('example-kicker')).toBeVisible({ timeout: 30_000 });
    await page.goto(`/?run=${PINNED}`);
    await page.waitForURL((u) => u.pathname === '/app/' && u.searchParams.get('run') === PINNED, { timeout: 20_000 });
    await expect(page.getByTestId('stage-build')).toBeAttached({ timeout: 30_000 });
  });
  expect(hits).toEqual([]);
});
