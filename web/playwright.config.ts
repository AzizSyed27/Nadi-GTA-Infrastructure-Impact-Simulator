import { defineConfig, devices } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Minimal Playwright harness for the referendum-guard + excluded-content-absence assertions (Phase 4.3).
// Reuses a dev server if one is already running on :3000; otherwise starts `npm run dev`.
//
// V2.7f C4 — A SECOND PROJECT, `static-demo`, runs the `demo.*.spec.ts` files against the SERVED
// static bundle (`web/out`, built by `node scripts/build-static-demo.mjs`) on :3001. The demo's
// branches are inlined at BUILD time (`NEXT_PUBLIC_STATIC_DEMO=1`), so the dev-server project can
// never exercise them — the disabled-with-why surfaces were smoke-verified by hand from V2.5d
// until here. The bundle is built BEFORE `playwright test`, never inside a webServer command: the
// build writes `web/.next`, which the dev server also uses. When `out/latest.json` is absent the
// project and its server are SKIPPED, LOUDLY — a silent bypass is the class the edit guard exists
// to refuse (`npm run e2e:demo` runs the project alone).
const DEMO_OUT = path.resolve(__dirname, 'out');
const DEMO_BUILT = fs.existsSync(path.join(DEMO_OUT, 'latest.json'));
if (!DEMO_BUILT) {
  console.log('[static-demo] web/out/latest.json missing — the static-demo project is SKIPPED; build it: node scripts/build-static-demo.mjs');
}
const DEMO_TEST = /demo\..*\.spec\.ts$/;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1, // the artifact is large; serialize to avoid concurrent multi-MB fetches
  reporter: 'line',
  // A suite whose sources changed mid-run cannot report green — half its specs ran a different
  // tree. This is globalSetup rather than a reporter on purpose: `--reporter=line` on the command
  // line replaces the config's reporter list and would silently disable it (see edit-guard.ts).
  globalSetup: './tests/support/edit-guard.ts',
  globalTeardown: './tests/support/edit-guard-teardown.ts',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: DEMO_TEST },
    ...(DEMO_BUILT
      ? [{
          name: 'static-demo',
          testMatch: DEMO_TEST,
          use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3001' },
        }]
      : []),
  ],
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    ...(DEMO_BUILT
      ? [{
          // python 3.13's threading http.server: no dependency, ignores query strings, so the
          // README's `?run=…&compare=…` deep links resolve to index.html like a CDN would serve them
          command: 'python -m http.server 3001 --directory out',
          url: 'http://localhost:3001/latest.json',
          reuseExistingServer: true,
          timeout: 30_000,
        }]
      : []),
  ],
});
