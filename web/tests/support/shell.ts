// V2.7a — the shell helpers every spec's preamble routes through. The stage nav replaced the
// mode toggle; these keep the two suite-wide conventions in ONE place:
//   * the LOAD SENTINEL: `stage-build` attached ⇔ the artifact loaded and the shell mounted
//     (byte-equivalent semantics to the old `mode-edit` gate — the nav renders only after the
//     artifact commit, so gating on it still means "map mounted, getBounds works");
//   * the WARM-RELOAD convention (compare.spec origin): a tiny fixture can resolve inside
//     StrictMode's double-mount window and fatally crash maplibre teardown in dev — gate, then
//     reload once, then assert the shell visible.
import { expect, type Page } from '@playwright/test';

export type Stage = 'build' | 'watch' | 'read' | 'explore';
export type ExploreSub = 'compare' | 'discourse' | 'graphs' | 'chat';

/** Wait (tolerantly) for the shell to mount — the load-completion sentinel. */
export async function gate(page: Page) {
  await page
    .getByTestId('stage-build')
    .waitFor({ state: 'attached', timeout: 30_000 })
    .catch(() => {});
}

/** goto → gate → warm reload → shell visible. The standard opener for every `goto('/')`-class spec. */
export async function warmOpen(page: Page, url = '/') {
  await page.goto(url);
  await gate(page);
  await page.reload();
  await expect(page.getByTestId('stage-build')).toBeVisible({ timeout: 20_000 });
}

/**
 * Enter a stage (and optionally an Explore sub-view). Clicking the active stage is a no-op,
 * so `openStage(page, 'watch')` is safe whatever the landing default is (the C4 landing flip
 * must not re-break spec preambles).
 */
export async function openStage(page: Page, stage: Stage, sub?: ExploreSub) {
  await page.getByTestId(`stage-${stage}`).click();
  if (sub) await page.getByTestId(`explore-${sub}`).click();
}
