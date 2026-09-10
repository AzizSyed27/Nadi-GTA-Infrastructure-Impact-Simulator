// V2.7b F-guard — A SUITE THAT WAS EDITED WHILE IT RAN MAY NOT REPORT GREEN.
//
// Editing web/ sources during a Playwright run against the dev server makes the result meaningless:
// specs that already executed used the old bundle, specs after the hot reload used the new one, and
// the summary line averages two different trees into one number you then act on. This happened
// three times across V2.7a/b — every time it was caught only because the author noticed and said so.
// Honesty as the only layer is exactly what the border-longhand ban was written to retire, so this
// is the mechanical layer.
//
// WHY globalSetup/globalTeardown AND NOT A REPORTER. A reporter was the first attempt and it
// worked — until it didn't: `--reporter=line` on the command line REPLACES the config's reporter
// list, so the guard silently vanished from exactly the invocation this project uses most (measured
// live: the bypass message never printed). These two config keys have no CLI override, so the guard
// cannot be turned off by a flag someone types out of habit.
//
// WHY A FILE HANDOFF AND NOT A CLOSURE. globalSetup returning its own teardown is documented
// Playwright behaviour, but it did NOT fire here — verified against this install with a probe that
// edited a source 4 s into an 11 s run: the edit landed, the file changed, the guard stayed silent.
// So the snapshot goes to the OS temp dir (never the repo, never OneDrive) and an explicit
// globalTeardown reads it. Both halves are proven red-and-green rather than assumed.
//
// CONTENT HASHES, NOT MTIMES. The repo lives under OneDrive, which moves mtimes without a content
// edit — CLAUDE.md records an mtime-based fix being counterexampled by exactly that resync. A guard
// that fires on files nobody touched gets disabled, which would be worse than no guard.
//
// Escape hatch for the deliberate case (iterating on one spec, editing it between runs):
//   NADI_ALLOW_SUITE_EDITS=1 npx playwright test <file>
// It says so in the output — a silent bypass would be the same disease one level down.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FullConfig } from '@playwright/test';

/** Source roots whose contents decide what the browser actually ran. */
const WATCHED_DIRS = ['app', 'components', 'lib', 'tests'];
/** Single files that change how the suite executes. */
const WATCHED_FILES = ['playwright.config.ts', 'package.json'];

// `web/public` is deliberately NOT watched: the backend writes `<run>-report.json` and per-run
// artifacts there DURING a run by design, and flagging those would fire on every live-backend suite.
// The rest is build/tool output that regenerates on its own.
const SKIP_DIRS = new Set([
  'node_modules', '.next', 'out', 'test-results', 'playwright-report', '.playwright-mcp', 'public',
]);
const SKIP_FILES = new Set(['next-env.d.ts']);
const SKIP_SUFFIXES = ['.tsbuildinfo'];

type Snapshot = Map<string, string>;

/** web/ — the directory holding playwright.config.ts, found by walking up from the config's root. */
function webRoot(config: FullConfig): string {
  let dir = config.rootDir;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'playwright.config.ts'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return config.rootDir; // degrade to something real rather than throwing inside setup
}

function hashFile(abs: string): string {
  return crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex');
}

function walk(root: string, rel: string, into: Snapshot): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return; // a watched dir that does not exist is not a failure
  }
  for (const e of entries) {
    const childRel = path.join(rel, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(root, childRel, into);
    } else if (e.isFile()) {
      if (SKIP_FILES.has(e.name)) continue;
      if (SKIP_SUFFIXES.some((s) => e.name.endsWith(s))) continue;
      try {
        into.set(childRel.split(path.sep).join('/'), hashFile(path.join(root, childRel)));
      } catch {
        /* vanished mid-walk — the drift report below will show it as removed */
      }
    }
  }
}

export function snapshot(root: string): Snapshot {
  const snap: Snapshot = new Map();
  for (const d of WATCHED_DIRS) walk(root, d, snap);
  for (const f of WATCHED_FILES) {
    const abs = path.join(root, f);
    if (fs.existsSync(abs)) snap.set(f, hashFile(abs));
  }
  return snap;
}

export function drift(before: Snapshot, after: Snapshot): string[] {
  const lines: string[] = [];
  for (const [rel, hash] of before) {
    if (!after.has(rel)) lines.push(`  removed   ${rel}`);
    else if (after.get(rel) !== hash) lines.push(`  changed   ${rel}`);
  }
  for (const rel of after.keys()) if (!before.has(rel)) lines.push(`  added     ${rel}`);
  return lines.sort();
}

/** Where the run's opening snapshot waits for teardown: the OS temp dir, never the repo (OneDrive)
 *  and never `test-results/` (Playwright cleans that at run start). */
const HANDOFF = path.join(os.tmpdir(), 'nadi-edit-guard.json');

const bypassed = () => process.env.NADI_ALLOW_SUITE_EDITS === '1';

/** globalSetup — snapshot the tree the suite is about to run against. */
export default function editGuardSetup(config: FullConfig): void {
  try {
    fs.rmSync(HANDOFF, { force: true }); // a crashed previous run must not judge this one
  } catch {
    /* nothing to clear */
  }
  if (bypassed()) {
    console.log('[edit-guard] BYPASSED (NADI_ALLOW_SUITE_EDITS=1) — this run does not prove the tree.');
    return;
  }
  const root = webRoot(config);
  const before = snapshot(root);
  fs.writeFileSync(HANDOFF, JSON.stringify({ root, files: Object.fromEntries(before) }), 'utf-8');
  console.log(`[edit-guard] watching ${before.size} source files under web/ for this run`);
}

/** globalTeardown — re-hash and refuse to let a drifted run stand. */
export function editGuardTeardown(): void {
  if (bypassed() || !fs.existsSync(HANDOFF)) return;
  const saved = JSON.parse(fs.readFileSync(HANDOFF, 'utf-8')) as {
    root: string; files: Record<string, string>;
  };
  fs.rmSync(HANDOFF, { force: true });

  const changed = drift(new Map(Object.entries(saved.files)), snapshot(saved.root));
  if (changed.length === 0) return;
  // THROW, don't just log: the teardown failure is what makes the run non-zero, and a green summary
  // line above an ignored warning is the exact thing this guard exists to prevent.
  throw new Error(
    `\n\n  SUITE INVALIDATED — ${changed.length} file(s) under web/ changed while this run was ` +
    'executing.\n  Specs before the change ran a different tree than specs after it, so the ' +
    `summary above describes no single tree:\n${changed.join('\n')}\n` +
    '  Settle the tree and re-run. (Deliberate? NADI_ALLOW_SUITE_EDITS=1.)\n',
  );
}
