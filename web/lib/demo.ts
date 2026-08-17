/**
 * V2.5d — the static read-only demo build. `NEXT_PUBLIC_STATIC_DEMO=1` is inlined at build time
 * by scripts/build-static-demo.mjs; normal dev/prod builds are byte-identical (the flag is
 * absent, every branch folds to the live behavior).
 *
 * The demo DISABLES its live affordances with the why — a property of the distribution, never a
 * defect: a stranger who clicks Run and gets an error learns the tool is broken; one who reads
 * the sentence learns what the tool actually is. Single-source: every disabled surface renders
 * DEMO_READONLY_NOTE verbatim.
 */
export const STATIC_DEMO = process.env.NEXT_PUBLIC_STATIC_DEMO === '1';

export const DEMO_READONLY_NOTE =
  'read-only walkthrough of pre-computed runs; editing, chat, and interviews need the local ' +
  'backend (SUMO + a model key) — see SETUP.md in the repo';

/**
 * Artifact fetch caching: local dev keeps `no-store` (frequently-rewritten aliases + the
 * documented chromium ERR_CACHE_WRITE_FAILURE on large bodies); the static demo serves
 * IMMUTABLE files, where `no-store` would re-pull ~20 MB per visit past the CDN edge.
 */
export const ARTIFACT_CACHE: RequestCache | undefined = STATIC_DEMO ? undefined : 'no-store';
