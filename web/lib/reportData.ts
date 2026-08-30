// V2.7a — the per-run report: shape + resolution for the Read stage's RunDocument.
//
// The report is a SEPARATE artifact (not on the frozen trajectory contract), written by
// python/src/report.py. Since V2.7a C1 every generation/refresh writes a per-run web copy at
// /<run_id>-report.json (the graphs-sidecar pattern — no pointer; the client already holds the
// run id). The old /latest-report.json singleton stops being read here (retired server-side in
// C5). Shape kept in sync with report.py's `_assemble_report_json`.

import type { RunStatus } from '@/lib/api';
import type { Scorecard } from '@/lib/types';

export interface Quote {
  label: string;
  comment: string;
  grounding: 'sim' | 'inferred';
}
export interface SynthGroup {
  key: string;
  label: string;
  synthesis: string;
  quotes: Quote[];
  sample_size: number;
}
export interface Caveat {
  title: string;
  body: string;
}
export interface ReachRow {
  argument: string;
  reached: number;
  post_count: number | null;
  per_post: number | null;
}
export interface CascadeShift {
  movers: number;
  by_group: Record<string, number>;
  hardened: number;
  warmed: number;
}
export interface DiscourseSection {
  synthesis: string;
  quotes: { label: string; comment: string }[];
  cascade_ids: string[];
  reach: Record<string, ReachRow[]>;
  dominant: Record<string, string | null>;
  diverge: boolean;
  shifts: Record<string, CascadeShift>;
  excluded_count: number;
  excluded_by: Record<string, number>;
}
export interface AuditEntry {
  slot: string;
  status: 'clean' | 'resolved_on_retry' | 'failed';
  violations: { rule: string; sentence: string }[];
}

/** The V2.7a C1 widened facts block — every code-derived fact the document renders. Keys are
 *  always present on new-vintage reports; the whole block is absent on old-vintage report JSONs
 *  (tolerated: prose + car_tail render, structured callouts are omitted, nothing is fabricated). */
export interface ReportFacts {
  changes: { type?: string; target_edge?: string; description?: string; window?: { start_s: number; end_s: number } | null; [k: string]: unknown }[];
  assignment: { mode: 'day_one' | 'settled'; scope?: string | null; converged?: boolean | null; iterations?: number | null } | null;
  demand_profile: string;
  sim_end: number;
  tags: string[] | null;
  n_seeds: number;
  seed_basis: string | null;
  sign_unstable_cells: [string, string][];
  non_completions: Record<string, number> | null;
  non_completions_split: Record<string, { entered_not_finished: number; not_inserted: number }> | null;
  insertion_backlog: Record<string, { baseline: number; scenario: number }> | null;
  window_events: unknown[] | null;
  response_detour: NonNullable<RunStatus['response_detour']> | null;
  zone_facts: NonNullable<RunStatus['zone_facts']> | null;
  scope_disclosure: string | null;
  calibration: Record<string, unknown> | null;
  render_sample: Record<string, unknown> | null;
}

export interface PerRunReport {
  generated_at: string;
  facts_refreshed_at?: string;
  provider: string;
  model: string;
  run_id?: string; // V2.7a C1 — top-level id (older report JSONs carry it only in run.scenario_run_id)
  run: {
    scenario_run_id: string;
    baseline_run_id: string;
    network: string;
    seeds: number[];
    thresholds: { ttc_s: number; veh_pet_s: number; ped_pet_s: number; materiality_s: number };
    demand: { car: number; bicycle: number; pedestrian: number };
    cars_rerouted: number;
  };
  scenario_change: { description: string; target_edge: string; target_lane?: number | null };
  facts?: ReportFacts;
  scorecard: Scorecard;
  car_tail: { median_s: number; share_gt30_pct: number; cross_seed_available: boolean; sentence: string };
  sections: {
    what_tested: { framing: string };
    who_affected: { glosses: Record<string, string> };
    what_they_say: { groups: SynthGroup[] };
    /** V2.3c — code-rendered mandate-lens voices; null/absent on pre-0.9.0 reports (renders nothing). */
    institutional?: {
      voices: {
        id: string;
        label: string;
        mandate: { institution: string; mission: string; source: string; retrieved: string };
        citations: { key: string; text: string; notes?: string[] }[];
        comment: string;
      }[];
      empty_reason: string | null;
      disclaimer: string;
    } | null;
    discourse: DiscourseSection | null;
    cannot_tell: { intro: string; caveats: Caveat[] };
  };
  audit: { passed: boolean; slots_checked: number; summary: string; log: AuditEntry[] };
  sources: string[];
}

export function reportUrl(runId: string): string {
  return `/${runId}-report.json`;
}

/** The report's own run id (top-level since C1; run.scenario_run_id on older vintages). */
export function reportRunId(r: PerRunReport): string | null {
  return r.run_id ?? r.run?.scenario_run_id ?? null;
}
