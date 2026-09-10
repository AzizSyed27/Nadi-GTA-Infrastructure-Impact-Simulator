// V2.7b F-guard — the DETECTION half, pinned deterministically.
//
// The guard's wiring (globalSetup/globalTeardown in playwright.config.ts) is proven by running a
// suite and editing a source mid-run — a real integration probe, but a timing-dependent one that
// cannot live in a spec. What CAN live here is the part that decides: given the tree before and the
// tree after, does it see the drift? These pins run against a scratch directory, so they are exact.
//
// They matter because the guard is the layer that replaces "the author noticed and said so". A
// guard that silently sees nothing is worse than none: it converts an honest catch into a false
// all-clear. Every case below fails if `drift` stops comparing content.

import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { drift, snapshot } from './support/edit-guard';

/** A scratch web-root shaped like the real one: a watched dir, plus files the guard must ignore. */
function scratchRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nadi-guard-'));
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'lib', 'a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(root, 'lib', 'b.ts'), 'export const b = 2;\n');
  fs.writeFileSync(path.join(root, 'playwright.config.ts'), '// config\n');
  return root;
}

test('a changed source is seen — by CONTENT, which is what mtime cannot do here', async () => {
  const root = scratchRoot();
  const before = snapshot(root);
  expect(before.has('lib/a.ts')).toBe(true);

  // rewrite with DIFFERENT content
  fs.writeFileSync(path.join(root, 'lib', 'a.ts'), 'export const a = 999;\n');
  expect(drift(before, snapshot(root))).toEqual(['  changed   lib/a.ts']);

  // ...and rewriting IDENTICAL content is NOT drift. This is the OneDrive case: the repo lives on a
  // synced drive that moves mtimes without an edit, and CLAUDE.md records an mtime-based fix being
  // counterexampled by exactly that. A guard that cried wolf here would be turned off.
  const same = snapshot(root);
  fs.writeFileSync(path.join(root, 'lib', 'a.ts'), 'export const a = 999;\n');
  expect(drift(same, snapshot(root))).toEqual([]);
});

test('added and removed files are seen too', async () => {
  const root = scratchRoot();
  const before = snapshot(root);

  fs.writeFileSync(path.join(root, 'lib', 'c.ts'), 'export const c = 3;\n');
  fs.rmSync(path.join(root, 'lib', 'b.ts'));

  expect(drift(before, snapshot(root))).toEqual(['  added     lib/c.ts', '  removed   lib/b.ts']);
});

test('the writers a live run makes on its own are NOT drift', async () => {
  // `web/public` is where the backend drops `<run>-report.json` and per-run artifacts DURING a run,
  // by design. Watching it would fire on every suite run against a live backend — the guard would
  // be disabled within a day. Same for build output.
  const root = scratchRoot();
  const before = snapshot(root);

  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public', 'some-run-report.json'), '{"prose":"…"}');
  fs.mkdirSync(path.join(root, '.next'), { recursive: true });
  fs.writeFileSync(path.join(root, '.next', 'build-manifest.json'), '{}');
  fs.writeFileSync(path.join(root, 'lib', 'x.tsbuildinfo'), '{}');
  fs.writeFileSync(path.join(root, 'next-env.d.ts'), '// regenerated\n');

  expect(drift(before, snapshot(root))).toEqual([]);
});
