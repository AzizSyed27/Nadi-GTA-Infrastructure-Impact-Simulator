// Central access layer for the v0.4.0 social{} block (OASIS cascades). The excluded-content filter is
// LOAD-BEARING: excluded events ship INSIDE the artifact (for provenance), so every social render path must
// go through cleanEvents() here — never re-filter per component (one miss leaks an excluded post to the DOM).

import type { Agent, ArgumentReach, Cascade, OpinionTrajectory, Social, SocialEvent, TrajectoryArtifact } from '@/lib/types';
import { agentId } from '@/lib/viz';

export interface StepEvent {
  step: number;
  event: SocialEvent;
}

export function cascadeIds(social: Social): string[] {
  return (social.cascades ?? []).map((c) => c.cascade_id);
}

export function cascadeById(social: Social, id: string): Cascade | undefined {
  return (social.cascades ?? []).find((c) => c.cascade_id === id);
}

function firstCascadeId(social: Social): string | undefined {
  return social.cascades?.[0]?.cascade_id;
}

/** THE load-bearing filter: only audit_status==='clean' events ever leave this module. Excluded content
 *  (present in the artifact for provenance) is dropped here so no view can render it. */
export function cleanEvents(cascade: Cascade | undefined): StepEvent[] {
  if (!cascade) return [];
  const out: StepEvent[] = [];
  for (const s of cascade.steps ?? []) {
    for (const e of s.events ?? []) {
      if (e.audit_status === 'clean') out.push({ step: s.step, event: e });
    }
  }
  return out;
}

/** Trajectories belonging to a cascade. Absent cascade_id = the reference (first) cascade. */
export function trajectoriesForCascade(social: Social, cascadeId: string): OpinionTrajectory[] {
  const ref = firstCascadeId(social);
  return (social.trajectories ?? []).filter((t) => (t.cascade_id ?? ref) === cascadeId);
}

/** Engaged-reach rows for a cascade, with the volume-normalized actions-per-post derived. NOT stance-colored
 *  (arguments, not votes). `reached` = agents who ACTED ON a post making the argument ("drew the most
 *  response"); per-post exposes the volume-confound. */
export function reachForCascade(social: Social, cascadeId: string): (ArgumentReach & { perPost: number | null })[] {
  return (social.argument_reach ?? [])
    .filter((r) => r.cascade_id === cascadeId)
    .map((r) => ({ ...r, perPost: r.post_count ? Math.round((r.reached / r.post_count) * 100) / 100 : null }));
}

/** agentId → Agent, for resolving a cascade event's `agent` to a persona label / mode / round-0 sentiment. */
export function agentLookup(artifact: TrajectoryArtifact): Record<string, Agent> {
  const m: Record<string, Agent> = {};
  for (const a of artifact.agents ?? []) m[agentId(a)] = a;
  return m;
}

/** How the actor came to see the post. Under the RANDOM recsys substitution, 'recsys' is ambient surfacing —
 *  NEVER phrase it as an algorithmic recommendation. */
export function exposureLabel(via: SocialEvent['exposed_via']): string | null {
  if (via === 'follow') return 'via someone they follow';
  if (via === 'recsys') return 'came across it';
  return null;
}
