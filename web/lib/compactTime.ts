// V2.6c — the TS twin of contract_models' compact-timestamp rule. SINGLE-SOURCED comparison rule
// across the language boundary: the python side pins THIS file's literals
// (test_compact_rule_lockstep_with_ts), so the eps constant and the closed-form formula below must
// stay byte-recognizable — an exact-write/tolerant-read divergence would let an entity pass the
// write-time check and misread here.

export const COMPACT_DT_EPS = 1e-6;

/** Reconstruct a compact entity's explicit timestamp array. The SAME closed form the write-time
 * eligibility check compared against: t0 + i * dt — never incremental accumulation (float drift
 * over ~1800 steps). Callers materialize ONCE per artifact (viz.ts positionAtCached keys its
 * index-hint WeakMap on the array identity; a per-frame expansion is the V2.5c 0.36 FPS class). */
export function expandTimestamps(t0: number, dt: number, n: number): number[] {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = t0 + i * dt;
  return out;
}
