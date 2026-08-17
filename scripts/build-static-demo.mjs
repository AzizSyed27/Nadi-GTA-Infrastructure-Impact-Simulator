/**
 * V2.5d — build the static read-only demo bundle (docs/DEPLOY.md has the hosting story).
 *
 *   node scripts/build-static-demo.mjs
 *
 * Runs `next build` with NEXT_STATIC_EXPORT=1 + NEXT_PUBLIC_STATIC_DEMO=1 (fully static out/,
 * live affordances disabled-with-why, default caching for immutable files), prunes out/ to the
 * demo file set, and WRITES out/latest.json as the pointer to the pinned run — the pointer is
 * build-written, never committed (local runs rewrite the real one at will).
 *
 * Demo set: the pinned social run triple (artifact + graphs sidecar + latest-report) — playback,
 * scorecard, feed, discourse, graphs, and the report all describe the SAME run — plus the modern
 * 0.9.0 run (institutional voices + the ends chip; also the compare partner, which deliberately
 * fires the provenance-mismatch lines — the guard IS part of the demo).
 */
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web');
const OUT = path.join(WEB, 'out');

const PINNED = 'multimodal-scenario-20260702T044134Z';
const MODERN = 'multimodal-scenario-20260814T063253Z';

// everything under out/ that is NOT in this keep-list (and not _next/ or an html/ico asset)
// gets pruned — the export copies web/public verbatim, which includes dev-only fixtures.
const KEEP = new Set([
  'network.json',
  `${PINNED}.json`,
  `${PINNED}-graphs.json`,
  `${MODERN}.json`,
  'latest-report.json',
  'latest-report.md',
]);

console.log('[demo] next build (static export)…');
execSync('npm run build', {
  cwd: WEB,
  stdio: 'inherit',
  env: { ...process.env, NEXT_STATIC_EXPORT: '1', NEXT_PUBLIC_STATIC_DEMO: '1' },
});

console.log('[demo] pruning out/ to the demo set…');
let pruned = 0;
for (const entry of fs.readdirSync(OUT)) {
  const p = path.join(OUT, entry);
  const stat = fs.statSync(p);
  if (stat.isDirectory()) continue; // _next/ etc. stay
  if (entry.endsWith('.html') || entry.endsWith('.ico') || entry.endsWith('.txt')) continue;
  if (entry.endsWith('.svg') || entry.endsWith('.png')) continue; // framework assets
  if (KEEP.has(entry)) continue;
  fs.rmSync(p);
  pruned++;
}

// the pointer: build-written, aimed at the pinned run (report + graphs + playback coherent)
fs.writeFileSync(path.join(OUT, 'latest.json'), JSON.stringify({ run_id: PINNED }) + '\n');

let total = 0;
const manifest = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir)) {
    const p = path.join(dir, e);
    const s = fs.statSync(p);
    if (s.isDirectory()) walk(p);
    else {
      total += s.size;
      if (s.size > 1024 * 1024) manifest.push(`${(s.size / 1048576).toFixed(1).padStart(6)} MB  ${path.relative(OUT, p)}`);
      if (s.size > 25 * 1024 * 1024) {
        console.error(`[demo] ERROR: ${e} exceeds Cloudflare Pages' 25 MiB/file cap`);
        process.exitCode = 1;
      }
    }
  }
};
walk(OUT);
console.log(`[demo] pruned ${pruned} non-demo files; bundle ${(total / 1048576).toFixed(1)} MB at ${OUT}`);
console.log('[demo] files > 1 MB:');
for (const m of manifest.sort().reverse()) console.log('  ' + m);
console.log('[demo] serve locally:  npx serve web/out   ·   deploy: see docs/DEPLOY.md');
