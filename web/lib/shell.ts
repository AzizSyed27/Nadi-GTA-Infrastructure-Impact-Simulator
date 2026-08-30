// V2.7a — the four-stage shell: Build → Watch → Read → Explore. One workflow, not tabs —
// a run moves through the stages; availability and done-checks derive from what the run
// actually HAS (labeled degradation per stage replaces disabled toggles wherever content
// can honestly say why it's missing — the graphs precedent).

export type Stage = 'build' | 'watch' | 'read' | 'explore';
export type ExploreSub = 'compare' | 'discourse' | 'graphs' | 'chat';

export const STAGES: ReadonlyArray<{ key: Stage; num: string; label: string }> = [
  { key: 'build', num: '01', label: 'BUILD' },
  { key: 'watch', num: '02', label: 'WATCH' },
  { key: 'read', num: '03', label: 'READ' },
  { key: 'explore', num: '04', label: 'EXPLORE' },
];

export const EXPLORE_SUBS: ReadonlyArray<{ key: ExploreSub; label: string }> = [
  { key: 'compare', label: 'Compare' },
  { key: 'discourse', label: 'Discourse' },
  { key: 'graphs', label: 'Graphs' },
  { key: 'chat', label: 'Chat' },
];

// the disabled-stage hint (pre-run: only Build is enterable — there is nothing to watch or read)
export const STAGE_LOCKED_HINT = 'unlocks when a run finishes';

export interface StageState {
  available: Record<Stage, boolean>;
  done: Record<Stage, boolean>;
}

export function stageAvailability(opts: {
  hasArtifact: boolean;
  hasReport: boolean;
  hasSocial: boolean;
  hasGraphs: boolean;
}): StageState {
  const { hasArtifact, hasReport, hasSocial, hasGraphs } = opts;
  return {
    // no run → Build only; a loaded run makes every stage ENTERABLE (missing content
    // renders a labeled empty state inside the stage, never a dead nav item).
    available: { build: true, watch: hasArtifact, read: hasArtifact, explore: hasArtifact },
    // ✓ = the stage's content exists for this run (derived, never asserted).
    done: {
      build: hasArtifact,
      watch: hasArtifact,
      read: hasReport,
      explore: hasSocial || hasGraphs,
    },
  };
}
