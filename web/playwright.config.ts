import { defineConfig, devices } from '@playwright/test';

// Minimal Playwright harness for the referendum-guard + excluded-content-absence assertions (Phase 4.3).
// Reuses a dev server if one is already running on :3000; otherwise starts `npm run dev`.
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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
