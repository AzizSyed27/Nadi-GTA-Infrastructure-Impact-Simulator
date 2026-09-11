/**
 * V2.7c map-shots — the PIXELS ARC's capture vehicle: the same viewport, the same centre, the
 * same three zooms (one per band of the zoom ladder), before and after every restyle commit, so
 * a before/after pair is a comparison and not two unrelated screenshots.
 *
 * Runs against a PRODUCTION build (the perf harness rule — dev/StrictMode double-renders):
 *
 *   cd web && npm run build && npm run start
 *   node scripts/map-shots.mjs --tag before [--run <run_id>] [--url http://localhost:3000]
 *                              [--center lon,lat] [--zooms 13,15.2,16.5] [--t 3400]
 *
 * Writes docs-assets/v27c-<tag>-z<zoom>.png (1600×1000, the harness viewport). The zoom is set
 * through the __nadiViewport seam's jumpTo — the REAL maplibre map — and the capture waits for
 * the seam to report the band that zoom belongs to, so a frame is never taken mid-gesture.
 *
 * The centre defaults to the artifact bbox centre — pass --center to frame a specific street
 * (the C11 ghost frame, a closure) so before/after compare the same corridor. Playback is scrubbed
 * to --t and left PAUSED (the frame is deterministic: same t, same dots).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium } from '../web/node_modules/@playwright/test/index.mjs';

const args = process.argv.slice(2);
// Both `--name value` and `--name=value` (a lon,lat value starts with '-', so the = form is the
// natural one to type — the first capture silently fell back to the bbox centre without this).
const opt = (name, dflt) => {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const URL_BASE = opt('url', 'http://localhost:3000');
const RUN_ID = opt('run', 'multimodal-scenario-20260814T063253Z'); // the committed EXAMPLE run
const TAG = opt('tag', 'shot');
const ZOOMS = opt('zooms', '13,15.2,16.5').split(',').map(Number);
const SCRUB_T = Number(opt('t', '3400'));
const CENTER = opt('center', null)?.split(',').map(Number) ?? null;
const OUT_DIR = path.resolve(process.cwd(), 'docs-assets');
if (!fs.existsSync(OUT_DIR)) throw new Error(`run from the repo root: ${OUT_DIR} missing`);

const browser = await chromium.launch({ headless: false }); // HEADED: hardware GL, the rasterizer rule
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(`${URL_BASE}/?run=${RUN_ID}`);
await page.waitForFunction(() => performance.getEntriesByName('nadi:artifact-rendered').length > 0, undefined, {
  timeout: 180_000,
});
await page.locator('[data-testid="stage-watch"]').click({ timeout: 15_000 });
await page.locator('input[type=range]').first().fill(String(SCRUB_T)); // scrub pauses playback
await page.waitForTimeout(500);

const center =
  CENTER ??
  (await page.evaluate(async (id) => {
    const a = await (await fetch(`/${id}.json`)).json();
    const [w, s, e, n] = a.meta.bbox;
    return [(w + e) / 2, (s + n) / 2];
  }, RUN_ID));

const bandOf = (z) => (z >= 16 ? 'icons' : z >= 15 ? 'lanes' : 'far');
for (const z of ZOOMS) {
  await page.evaluate(([lon, lat, zoom]) => window.__nadiViewport.jumpTo(lon, lat, zoom), [center[0], center[1], z]);
  await page.waitForFunction((b) => window.__nadiViewport?.band === b, bandOf(z), { timeout: 10_000 });
  await page.waitForTimeout(800); // let deck settle the frame after the jump (tiles + buffers)
  const file = path.join(OUT_DIR, `v27c-${TAG}-z${String(z).replace('.', '_')}.png`);
  await page.screenshot({ path: file });
  console.log(`${file}  centre ${center.map((c) => c.toFixed(5)).join(',')}  z${z} (${bandOf(z)})  t=${SCRUB_T}`);
}
await browser.close();
