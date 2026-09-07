'use client';

/**
 * V2.7b C10b — THE WATCH ARTICLE: the finished run's playback, given a reason to be watched.
 *
 * Brief item 8, and the last of the two acts' surfaces to land. While a run computes, Watch belongs
 * to the run experience; when it finishes, Watch has until now been a map with a feed beside it and
 * nothing saying what a reader is looking at or why they might scrub through it. This is that
 * sentence — the morning the street closed, replayed — with the two numbers the playback actually
 * shows, and the footnote that keeps one of them honest.
 *
 * THE NEAR-MISS COUNT CARRIES ITS SURROGATE FOOTNOTE, ALWAYS AND VERBATIM. It is the one number on
 * this surface a reader could mistake for a crash prediction, and `NOTE_SAFETY` is the project's
 * one sentence about that — imported, never restated, so the two cannot drift. This is also why the
 * count is never phrased as a change or a comparison: it is what this run's trajectories contained.
 */

import { NOTE_SAFETY } from '@/components/RunDocument';
import { fmtSimTime } from '@/lib/simTime';

export const ARTICLE_KICKER = 'THE RUN, REPLAYED';

export function WatchArticle({
  description,
  vehicles,
  conflicts,
  simStart,
  simEnd,
  demandProfile,
}: {
  description: string | null;
  vehicles: number;
  conflicts: number;
  simStart: number;
  simEnd: number;
  demandProfile: string | undefined;
}) {
  return (
    <div style={wrap} data-testid="watch-article">
      <div style={kicker}>{ARTICLE_KICKER}</div>
      <h3 style={title}>{description || 'This run, replayed'}</h3>
      <p style={body}>
        Every dot is one simulated traveler on their own computed route, moving through{' '}
        {fmtSimTime(simStart, demandProfile)}–{fmtSimTime(simEnd, demandProfile)} of this run.
        Scrub the bar below to move through the morning; the change appears and disappears at the
        times it was actually in force.
      </p>
      <div style={figures}>
        <Figure n={vehicles.toLocaleString()} label="vehicles on the network" />
        <Figure n={conflicts.toLocaleString()} label="near-miss surrogate events" />
      </div>
      {/* the footnote rides the number, not a tooltip: it is the difference between a surrogate and
          a crash prediction, and a reader must not have to hover to learn which one they are seeing */}
      <p style={footnote} data-testid="watch-article-safety-note">{NOTE_SAFETY}</p>
    </div>
  );
}

function Figure({ n, label }: { n: string; label: string }) {
  return (
    <div>
      <div style={figNum}>{n}</div>
      <div style={figLabel}>{label}</div>
    </div>
  );
}

const wrap: React.CSSProperties = { maxWidth: 640 };
const kicker: React.CSSProperties = {
  fontFamily: 'var(--font-heading)', fontSize: 11, letterSpacing: '.1em',
  color: 'var(--color-neutral-600)',
};
const title: React.CSSProperties = {
  fontFamily: 'var(--font-heading)', fontSize: 24, fontWeight: 600, margin: '4px 0 10px',
  textWrap: 'pretty',
} as React.CSSProperties;
const body: React.CSSProperties = { fontSize: 14, lineHeight: 1.6, margin: 0 };
const figures: React.CSSProperties = { display: 'flex', gap: 32, margin: '16px 0 12px' };
const figNum: React.CSSProperties = {
  fontFamily: 'var(--font-heading)', fontSize: 30, fontWeight: 600, lineHeight: 1,
};
const figLabel: React.CSSProperties = { fontSize: 11.5, color: 'var(--color-neutral-600)', marginTop: 3 };
const footnote: React.CSSProperties = {
  fontSize: 11.5, lineHeight: 1.5, color: 'var(--color-neutral-600)', margin: 0,
  borderTop: '1px solid var(--color-divider)', paddingTop: 8,
};
