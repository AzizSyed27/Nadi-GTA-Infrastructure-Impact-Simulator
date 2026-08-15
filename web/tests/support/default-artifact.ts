import type { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * V2.5c — the default-run POINTER pair. latest.json is {"run_id": ...} (never a payload), so a
 * spec that opens '/' must route BOTH halves: the pointer AND the per-run artifact it resolves
 * to. Every goto('/') spec uses this helper, so no spec ever depends on the real pointer target
 * (mutable, up to ~90 MB when a calibrated exemplar is newest) — the acceptance criterion is
 * that overwriting OR DELETING the real latest.json leaves the whole suite green.
 *
 * The ~500 ms delay on the ARTIFACT route is the established StrictMode tiny-fixture
 * mitigation (compare.spec convention): a fixture resolving inside the double-mount window
 * fatally crashes maplibre teardown in dev.
 */
export const DEFAULT_RUN_ID = 'default-fixture';

export async function mockDefaultArtifact(
  page: Page,
  fixtureFile = 'school-zone-run.json',
): Promise<void> {
  const body = fs.readFileSync(path.join(__dirname, '..', 'fixtures', fixtureFile), 'utf-8');
  await mockDefaultArtifactBody(page, body);
}

/** Same pair, but with a caller-built artifact body (the in-memory-mutated fixture idiom). */
export async function mockDefaultArtifactBody(page: Page, body: string): Promise<void> {
  await page.route('**/latest.json', (route) =>
    route.fulfill({ json: { run_id: DEFAULT_RUN_ID } }),
  );
  await page.route(`**/${DEFAULT_RUN_ID}.json`, async (route) => {
    await new Promise((res) => setTimeout(res, 500));
    await route.fulfill({ body, contentType: 'application/json' });
  });
}
