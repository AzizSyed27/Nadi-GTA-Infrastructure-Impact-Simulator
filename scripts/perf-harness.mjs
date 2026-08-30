/**
 * V2.5c perf harness — the repeatable measurement vehicle behind the frontend budgets
 * (CLAUDE.md records the numbers; there is deliberately NO CI perf gate — re-run this at V2.7
 * checkpoints).
 *
 * MUST run against a PRODUCTION build (dev/StrictMode double-renders and doubles the deck
 * setProps push — numbers there are not representative):
 *
 *   cd web && npm run build && npm run start        # port 3000
 *   node scripts/perf-harness.mjs --run <run_id> [--url http://localhost:3000] [--label x]
 *
 * Measures, per run id:
 *   - fetch/transfer split (resource timing on the artifact), main-thread JSON.parse (the
 *     permanent nadi:parse marks + an isolated in-page parse control), the pinned/bg join
 *     (nadi:join marks), navigation → first committed artifact render (nadi:artifact-rendered);
 *   - frame profile at the exemplar's concurrency peak (scrub to t=3400, press Play, sample
 *     600 rAF deltas ≈ 10 s): p50/p95/max frame ms + fps + longtask count;
 *   - usedJSHeapSize after first render (launch with --enable-precise-memory-info).
 *
 * SCOPE: the nadi:* marks instrument the MOUNT path only (?run= / pointer-resolve);
 * loadRun (in-app run switching) is unmarked — measure it here if it ever matters.
 */
import { chromium } from '../web/node_modules/@playwright/test/index.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const URL_BASE = opt('url', 'http://localhost:3000');
const RUN_ID = opt('run', 'multimodal-scenario-20260727T180728Z');
const LABEL = opt('label', RUN_ID);
const SCRUB_T = Number(opt('scrub', '3400')); // the measured concurrency peak on the exemplar

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

// --headed: run with a visible window (HARDWARE GL). Default headless uses SwiftShader
// (software GL) — frame numbers there measure the rasterizer, not the user's GPU experience
// (caught live: 99.2% of a 1.8 s/frame profile sat in native "(program)" time under headless).
const HEADED = args.includes('--headed');
const browser = await chromium.launch({
  headless: !HEADED,
  args: ['--enable-precise-memory-info'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const t0 = Date.now();
await page.goto(`${URL_BASE}/?run=${RUN_ID}`);
await page.waitForFunction(() => performance.getEntriesByName('nadi:artifact-rendered').length > 0, undefined, {
  timeout: 180_000,
});
const wallToRender = Date.now() - t0;

const load = await page.evaluate((runId) => {
  const res = performance.getEntriesByType('resource').find((e) => e.name.includes(`${runId}.json`));
  const dur = (a, b) => {
    const A = performance.getEntriesByName(a);
    const B = performance.getEntriesByName(b);
    return A.length && B.length ? B[B.length - 1].startTime - A[A.length - 1].startTime : null;
  };
  const nav = performance.getEntriesByType('navigation')[0];
  const rendered = performance.getEntriesByName('nadi:artifact-rendered').pop();
  return {
    transferKB: res ? Math.round(res.transferSize / 1024) : null,
    decodedKB: res ? Math.round(res.decodedBodySize / 1024) : null,
    fetchMs: res ? Math.round(res.responseEnd - res.requestStart) : null,
    parseMs: dur('nadi:parse:start', 'nadi:parse:end') !== null ? Math.round(dur('nadi:parse:start', 'nadi:parse:end')) : null,
    joinMs: dur('nadi:join:start', 'nadi:join:end') !== null ? Math.round(dur('nadi:join:start', 'nadi:join:end')) : null,
    navToRenderMs: rendered && nav ? Math.round(rendered.startTime - nav.startTime) : null,
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
  };
}, RUN_ID);

// isolated parse control (fresh text → JSON.parse on the main thread, no React in the way)
const parseControlMs = await page.evaluate(async (runId) => {
  const r = await fetch(`/${runId}.json`);
  const s = await r.text();
  const a = performance.now();
  JSON.parse(s);
  return Math.round(performance.now() - a);
}, RUN_ID);

// frame profile at the concurrency peak: scrub (pauses playback), then press Play, then sample.
// The Timeline button's aria-label flips Pause→Play on the scrub-pause; give React a beat.
// V2.7a: the landing defaults to the Read stage — the playback bar (and its slider) live in
// Watch, so enter it first. The nav→render marks above already fired on the mount path.
await page.locator('[data-testid="stage-watch"]').click({ timeout: 15_000 });
await page.locator('input[type=range]').first().fill(String(SCRUB_T));
await page.waitForTimeout(300);
await page.locator('button[aria-label="Play"]').click({ timeout: 15_000 });

// --profile: attribute the frame time — sample the V8 CPU profile during the same window and
// print the top self-time functions (the measure-first mandate: name the cost, then fix it).
const PROFILE = args.includes('--profile');
let cdp = null;
if (PROFILE) {
  cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
}
const frames = await page.evaluate(
  () =>
    new Promise((res) => {
      // TIME-bounded (15 s), never frame-COUNT-bounded: at pathological frame rates a frame
      // count would take minutes — the sampler must survive the disease it measures.
      const WINDOW_MS = 15_000;
      const deltas = [];
      let longTasks = 0;
      const obs = new PerformanceObserver((list) => {
        longTasks += list.getEntries().length;
      });
      obs.observe({ type: 'longtask' });
      let last = null;
      const t0 = performance.now();
      const tick = (t) => {
        if (last != null) deltas.push(t - last);
        last = t;
        if (t - t0 < WINDOW_MS) requestAnimationFrame(tick);
        else {
          obs.disconnect();
          res({ deltas, longTasks });
        }
      };
      requestAnimationFrame(tick);
    }),
);
if (PROFILE && cdp) {
  const { profile } = await cdp.send('Profiler.stop');
  const hits = new Map();
  const total = profile.samples?.length ?? 0;
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  for (const s of profile.samples ?? []) {
    const n = byId.get(s);
    if (!n) continue;
    const f = n.callFrame;
    const key = `${f.functionName || '(anonymous)'} @ ${(f.url || '').split('/').pop()}:${f.lineNumber}`;
    hits.set(key, (hits.get(key) ?? 0) + 1);
  }
  const top = [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  console.log(`\n--- CPU self-time top functions (${total} samples during the frame window) ---`);
  for (const [k, v] of top) console.log(`${(100 * v / total).toFixed(1).padStart(5)}%  ${k}`);
}

const sorted = frames.deltas.slice().sort((a, b) => a - b);
const p50 = pct(sorted, 50);
const p95 = pct(sorted, 95);
const max = sorted[sorted.length - 1];

console.log(`\n=== perf-harness · ${LABEL} (${RUN_ID}) ===`);
console.log(`artifact: transfer ${load.transferKB} KB (decoded ${load.decodedKB} KB) · fetch ${load.fetchMs} ms`);
console.log(`parse (product mark) ${load.parseMs} ms · parse control ${parseControlMs} ms · join ${load.joinMs} ms`);
console.log(`nav → first artifact render: ${load.navToRenderMs} ms (wall ${wallToRender} ms)`);
console.log(`heap after render: ${load.heapMB} MB`);
console.log(
  `frames @t≈${SCRUB_T} (600 samples): p50 ${p50.toFixed(1)} ms (${(1000 / p50).toFixed(0)} fps) · ` +
    `p95 ${p95.toFixed(1)} ms (${(1000 / p95).toFixed(0)} fps) · max ${max.toFixed(0)} ms · longtasks ${frames.longTasks}`,
);

await browser.close();
