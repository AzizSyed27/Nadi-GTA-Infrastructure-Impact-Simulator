// V2.1d part ii — the comparison view's PURE logic: slim run views, seed provenance, the
// provenance-mismatch guard, and delta eligibility (the honesty core). No React here; the
// CompareView renders what these functions decide. Tested through web/tests/compare.spec.ts
// (web/ has no vitest harness — deliberate; don't introduce one for this).

import type { Change, Meta, Scorecard, ScorecardCell, TrajectoryArtifact } from '@/lib/types';
import { changesOf } from '@/lib/types';
import type { CellKind } from '@/lib/scorecardStyles';

/** A run reduced to what comparison needs. The 74 MB of trajectories/agents/social behind a full
 *  artifact is deliberately NOT retained — only meta + scorecard survive, so two picked sides cost
 *  kilobytes, not gigabytes. */
export interface CompareSide {
  runId: string;
  schemaVersion: string;
  meta: Meta;
  scorecard?: Scorecard | null;
}

export function slimFromArtifact(a: TrajectoryArtifact): CompareSide {
  return { runId: a.meta.run_id, schemaVersion: a.schema_version, meta: a.meta, scorecard: a.scorecard };
}

/**
 * Fetch + slim one side. NO ajv validation: these are 74 MB artifacts and schema validation in the
 * browser is multi-second jank — MapView's own artifact loader makes the same call. The transient
 * JSON.parse spike is accepted (identical to today's run switching); only the slim view is retained.
 * A shape guard covers the honest failure modes instead (a 404 HTML body, a non-artifact JSON).
 */
export async function loadCompareSide(id: string): Promise<CompareSide> {
  const r = await fetch(`/${id}.json`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`run artifact /${id}.json not found (HTTP ${r.status})`);
  const data = (await r.json()) as TrajectoryArtifact;
  if (typeof data?.meta?.run_id !== 'string' || typeof data?.schema_version !== 'string') {
    throw new Error(`/${id}.json is not a run artifact (no meta.run_id)`);
  }
  return slimFromArtifact(data);
}

export function schemaAtLeast(version: string, major: number, minor: number): boolean {
  const [ma, mi] = version.split('.').map((x) => Number(x) || 0);
  return ma > major || (ma === major && mi >= minor);
}

export type SeedProvenance = { kind: 'known'; n: number } | { kind: 'unknown' };

/**
 * Seed provenance is derived, not stamped (meta carries no n_seeds): any cell range names its
 * n_seeds; a RANGELESS 0.8.0 artifact is single-seed BY CONSTRUCTION (ranges are emitted whenever
 * n_seeds>1); pre-0.8.0 artifacts predate ranges entirely, so their seed count is honestly unknown.
 */
export function seedProvenanceOf(side: CompareSide): SeedProvenance {
  for (const g of side.scorecard?.groups ?? []) {
    for (const cell of [g.travel_time_delta, g.safety_delta, g.access_delta]) {
      if (cell?.range != null) return { kind: 'known', n: cell.range.n_seeds };
    }
  }
  if (schemaAtLeast(side.schemaVersion, 0, 8)) return { kind: 'known', n: 1 };
  return { kind: 'unknown' };
}

/** The per-side disclosure label — shown on the provenance strip UNCONDITIONALLY (independent of
 *  the mismatch guard: absence of a mismatch never means absence of disclosure). */
export function seedLabel(p: SeedProvenance): string {
  if (p.kind === 'unknown') return 'seeds unknown (pre-0.8.0 run)';
  return p.n > 1 ? `robustness probe: ${p.n} seeds` : 'single seed';
}

/** The change-set identity for the mismatch guard: mechanical fields only — a description-only
 *  difference is NOT a mismatch (same physical change, different label). */
export function changeSetKey(changes: Change[]): string {
  const projected = changes
    .map((c) => ({
      type: c.type,
      target_edge: c.target_edge,
      value_mps: c.value_mps ?? null,
      target_lane: c.target_lane ?? null,
      target_lanes: c.target_lanes ?? null,
    }))
    .sort((x, y) => `${x.type}|${x.target_edge}`.localeCompare(`${y.type}|${y.target_edge}`));
  return JSON.stringify(projected);
}

export function changesOfSide(side: CompareSide): Change[] {
  // changesOf takes the artifact shape; feed it the slim view's meta under the same contract.
  return changesOf({ meta: side.meta } as TrajectoryArtifact);
}

export interface Mismatch {
  field: 'assignment' | 'demand' | 'scope' | 'changes' | 'seeds';
  line: string;
}

/**
 * The provenance-mismatch guard: compares HOW the two runs were produced. Each difference gets its
 * own plain-language line; the view renders them prominently. Informs, never blocks. This COMPARES
 * the sides — the per-side provenance strips DESCRIBE each side independently of this function.
 */
export function detectMismatches(a: CompareSide, b: CompareSide): Mismatch[] {
  const out: Mismatch[] = [];

  const modeA = a.meta.assignment?.mode ?? 'day_one'; // pre-0.7.0 artifacts are day-one by definition
  const modeB = b.meta.assignment?.mode ?? 'day_one';
  if (modeA !== modeB) {
    out.push({
      field: 'assignment',
      line:
        'comparing a settled run against a day-one run — the difference blends the change’s effect with the adaptation model',
    });
  } else if ((a.meta.assignment?.scope ?? null) !== (b.meta.assignment?.scope ?? null)) {
    // scope only meaningfully differs when the modes MATCH (a mode mismatch already covers it)
    out.push({
      field: 'scope',
      line: 'assignment scope differs — driver adaptation covers different populations on each side',
    });
  }

  const demandA = a.meta.demand_profile ?? 'synthetic_demo';
  const demandB = b.meta.demand_profile ?? 'synthetic_demo';
  if (demandA !== demandB) {
    out.push({ field: 'demand', line: 'comparing calibrated against synthetic demand — not like-for-like' });
  }

  if (changeSetKey(changesOfSide(a)) !== changeSetKey(changesOfSide(b))) {
    out.push({
      field: 'changes',
      line:
        'these runs simulate different changes — each delta mixes the difference between the changes with everything downstream of it',
    });
  }

  const seedsA = seedProvenanceOf(a);
  const seedsB = seedProvenanceOf(b);
  if (seedsA.kind === 'known' && seedsB.kind === 'known' && seedsA.n !== seedsB.n) {
    out.push({
      field: 'seeds',
      line: `seed evidence differs: A ran ${seedsA.n === 1 ? 'a single seed' : `${seedsA.n} seeds`}, B ${
        seedsB.n === 1 ? 'a single seed' : `${seedsB.n} seeds`
      } — cells without a range carry no robustness evidence`,
    });
  } else if (seedsA.kind !== seedsB.kind) {
    const unknown = seedsA.kind === 'unknown' ? 'A' : 'B';
    out.push({
      field: 'seeds',
      line: `seed provenance unknown for ${unknown} (pre-0.8.0 run) — its single number may not be seed-stable`,
    });
  }
  // Two unknowns compare EQUAL — no mismatch line. Deliberate: there is nothing mismatched between
  // them; the per-side "seeds unknown" disclosure still shows on both provenance strips.

  return out;
}

export type DeltaVerdict = { eligible: true; delta: number } | { eligible: false; refused: boolean; reason: string };

/**
 * The delta-honesty core (USER-RATIFIED): a cross-run delta is rendered only where a direction is
 * claimable on BOTH sides.
 * - SAFETY never gets delta arithmetic: within a run its direction is not claimed (±magnitude),
 *   so a signed cross-run difference would manufacture the exact claim the cells refuse → REFUSED.
 * - A sign-unstable cell (range.sign_stable === false) on either side likewise → REFUSED.
 * - A missing cell/value on either side → not eligible, but NOT a refusal (genuinely nothing there).
 * The refused/absent distinction drives the view's glanceable "—†" vs plain "—" rendering.
 */
export function deltaEligibility(
  cellA: ScorecardCell | null | undefined,
  cellB: ScorecardCell | null | undefined,
  kind: CellKind,
): DeltaVerdict {
  if (kind === 'safety') {
    return {
      eligible: false,
      refused: true,
      reason: 'direction not claimed within either run; a cross-run difference would assert one',
    };
  }
  if (cellA?.value == null || cellB?.value == null) {
    return { eligible: false, refused: false, reason: 'no value on one side' };
  }
  if (cellA.range?.sign_stable === false || cellB.range?.sign_stable === false) {
    return {
      eligible: false,
      refused: true,
      reason: 'sign-unstable across seeds on one side — a signed cross-run delta would assert a direction the seeds refute',
    };
  }
  return { eligible: true, delta: cellB.value - cellA.value };
}
