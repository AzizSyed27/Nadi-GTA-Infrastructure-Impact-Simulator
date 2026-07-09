'use client';

import { useMemo, useState } from 'react';

import type { Agent, Cascade, OpinionTrajectory } from '@/lib/types';
import { sentimentHex } from '@/lib/viz';
import { modeIconOf } from '@/lib/personaGroups';
import { cleanEvents, exposureLabel } from '@/lib/social';

const MAX_VOICES_PER_STEP = 5; // representative new voices per step (the rest collapse into a "+N more" line)
const CAP = 60; // rows rendered before "show more"

interface Props {
  cascade: Cascade | undefined;
  trajectories: OpinionTrajectory[];
  /** agentId → Agent, for persona label / mode / round-0 sentiment. */
  lookup: Record<string, Agent>;
  cascadeId: string;
}

type DItem = (
  | { kind: 'opening'; step: number; key: string; count: number }
  | { kind: 'voice'; step: number; key: string; agentId: string; content: string; via: string | null }
  | { kind: 'shift'; step: number; key: string; agentId: string; from: string; to: string; movedBy: string[] }
  | { kind: 'more'; step: number; key: string; count: number }
  | { kind: 'activity'; step: number; key: string; count: number }
) & { showHead?: boolean };

/**
 * The DISCOURSE phase: the same seeded voices played forward as a cascade. Step 0 (the seeds, already the
 * playback feed) collapses into one opening summary; each later step leads with SHIFT rows (a derived stance
 * moved, with provenance), then a few representative new voices ("+N more"), then like/repost activity as a
 * capped interstitial. Excluded content is filtered upstream (cleanEvents) and can never appear here. This is
 * MOVEMENT over steps — never a tally, never a for/against split.
 */
export function DiscourseFeed({ cascade, trajectories, lookup, cascadeId }: Props) {
  const [expanded, setExpanded] = useState(false);

  const items = useMemo<DItem[]>(() => {
    const voicesByStep: Record<number, DItem[]> = {};
    const shiftsByStep: Record<number, DItem[]> = {};
    const activityByStep: Record<number, number> = {};
    let openingCount = 0;

    for (const { step, event } of cleanEvents(cascade)) {
      const bearing = (event.action === 'post' || event.action === 'comment') && event.content;
      if (bearing && step === 0) {
        openingCount += 1;
      } else if (bearing) {
        (voicesByStep[step] ??= []).push({
          kind: 'voice',
          step,
          key: `v:${cascadeId}:${step}:${event.agent}:${voicesByStep[step]?.length ?? 0}`,
          agentId: event.agent,
          content: event.content as string,
          via: exposureLabel(event.exposed_via),
        });
      } else if ((event.action === 'like' || event.action === 'repost') && step >= 1) {
        activityByStep[step] = (activityByStep[step] ?? 0) + 1;
      }
    }
    for (const t of trajectories) {
      const pts = t.points ?? [];
      for (let i = 1; i < pts.length; i++) {
        if (pts[i].stance !== pts[i - 1].stance) {
          (shiftsByStep[pts[i].step] ??= []).push({
            kind: 'shift',
            step: pts[i].step,
            key: `s:${cascadeId}:${t.agent}:${pts[i].step}`,
            agentId: t.agent,
            from: pts[i - 1].stance,
            to: pts[i].stance,
            movedBy: t.influenced_by ?? [],
          });
        }
      }
    }

    const out: DItem[] = [];
    if (openingCount > 0) out.push({ kind: 'opening', step: 0, key: `o:${cascadeId}`, count: openingCount });
    const steps = [
      ...new Set(
        [...Object.keys(voicesByStep), ...Object.keys(shiftsByStep), ...Object.keys(activityByStep)].map(Number),
      ),
    ].sort((a, b) => a - b);
    for (const step of steps) {
      for (const s of shiftsByStep[step] ?? []) out.push(s); // shifts first — the movement is the headline
      const vs = voicesByStep[step] ?? [];
      for (const v of vs.slice(0, MAX_VOICES_PER_STEP)) out.push(v);
      if (vs.length > MAX_VOICES_PER_STEP) {
        out.push({ kind: 'more', step, key: `m:${cascadeId}:${step}`, count: vs.length - MAX_VOICES_PER_STEP });
      }
      if (activityByStep[step]) out.push({ kind: 'activity', step, key: `a:${cascadeId}:${step}`, count: activityByStep[step] });
    }
    let prev = -1;
    for (const it of out) {
      it.showHead = it.step !== prev; // first item of each step gets the step header
      prev = it.step;
    }
    return out;
  }, [cascade, trajectories, cascadeId]);

  if (!cascade) return null;
  const label = (aid: string) => lookup[aid]?.persona.label ?? aid;
  const shown = expanded ? items : items.slice(0, CAP);
  const hidden = items.length - shown.length;

  return (
    <div style={wrap} data-testid="discourse-feed">
      <div style={head}>HOW THE CONVERSATION UNFOLDS</div>
      <div style={list}>
        {shown.length === 0 ? (
          <div style={empty}>No discourse in this cascade.</div>
        ) : (
          <>
            {shown.map((it) => {
              const header =
                it.showHead && it.kind !== 'opening' ? (
                  <div key={`h:${it.step}`} style={stepHead} data-testid="discourse-step-head">
                    as word spreads · step {it.step}
                  </div>
                ) : null;
              if (it.kind === 'opening') {
                return (
                  <div key={it.key} style={openingLine} data-testid="discourse-opening">
                    {it.count} opening posts — the seeded reactions (see Playback). The conversation unfolds below.
                  </div>
                );
              }
              if (it.kind === 'shift') {
                const moved = it.movedBy.map(label).slice(0, 2).join(', ');
                return (
                  <div key={it.key}>
                    {header}
                    <div
                      style={shiftRow}
                      data-testid="discourse-shift"
                      title="derived stance (post-hoc stance-scoring of this agent's utterances) — not a declared position"
                    >
                      <span style={shiftIcon}>↝</span>
                      <span style={rowText}>
                        <span style={rowLabel}>{label(it.agentId)}</span>
                        <span style={shiftText}>
                          <b>{it.from}</b> → <b>{it.to}</b>
                          {moved && <span style={movedBy}> · moved by: {moved}</span>}
                        </span>
                      </span>
                    </div>
                  </div>
                );
              }
              if (it.kind === 'voice') {
                const a = lookup[it.agentId];
                return (
                  <div key={it.key}>
                    {header}
                    <div style={row} data-testid="discourse-voice">
                      <span style={dot(sentimentHex(a?.reaction.sentiment ?? 0))} />
                      <span style={rowText}>
                        <span style={rowLabel}>
                          <span style={icon}>{a ? modeIconOf(a.persona) : '💬'}</span>
                          {label(it.agentId)}
                          {it.via && <span style={viaTag}>· {it.via}</span>}
                        </span>
                        <span style={rowComment}>{it.content}</span>
                      </span>
                    </div>
                  </div>
                );
              }
              if (it.kind === 'more') {
                return (
                  <div key={it.key} style={moreLine} data-testid="discourse-more">
                    + {it.count} more voices this step
                  </div>
                );
              }
              return (
                <div key={it.key}>
                  {header}
                  <div style={activity} data-testid="discourse-activity">
                    {it.count} liked / reposted
                  </div>
                </div>
              );
            })}
            {hidden > 0 && (
              <button style={showEarlier} onClick={() => setExpanded(true)} data-testid="discourse-show-more">
                show more ({hidden})
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = {
  position: 'absolute',
  left: 16,
  bottom: 84,
  width: 340,
  maxHeight: '52vh',
  display: 'flex',
  flexDirection: 'column',
  background: 'rgba(255,255,255,0.94)',
  borderRadius: 12,
  boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
  zIndex: 10,
  fontFamily: 'system-ui, sans-serif',
  overflow: 'hidden',
};
const head: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.6,
  color: '#374151',
  borderBottom: '1px solid #eee',
};
const list: React.CSSProperties = { overflowY: 'auto', padding: 6 };
const empty: React.CSSProperties = { padding: '10px 8px', fontSize: 12, color: '#9aa0a6' };
const stepHead: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.4,
  color: '#9aa0a6',
  textTransform: 'uppercase',
  padding: '8px 8px 3px',
};
const row: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 8px' };
const shiftRow: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
  padding: '6px 8px',
  borderLeft: '3px solid #e0a94b',
  background: '#fdf6e9',
  borderRadius: 8,
  margin: '1px 0',
};
const rowText: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 };
const rowLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#1f2937',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexWrap: 'wrap',
};
const icon: React.CSSProperties = { fontSize: 12 };
const viaTag: React.CSSProperties = { fontSize: 10, fontWeight: 500, color: '#8a94a6' };
const rowComment: React.CSSProperties = { fontSize: 12, color: '#4b5563', lineHeight: 1.35 };
const shiftIcon: React.CSSProperties = { fontSize: 14, color: '#c98a1e', marginTop: 1, flex: '0 0 auto' };
const shiftText: React.CSSProperties = { fontSize: 12, color: '#7a5b12' };
const movedBy: React.CSSProperties = { color: '#9a7a2e', fontWeight: 500 };
const activity: React.CSSProperties = { fontSize: 11, color: '#9aa0a6', fontStyle: 'italic', padding: '4px 8px' };
const moreLine: React.CSSProperties = { fontSize: 11, color: '#8a94a6', padding: '2px 8px 6px' };
const openingLine: React.CSSProperties = {
  fontSize: 11,
  color: '#6b7280',
  background: '#f3f4f6',
  borderRadius: 8,
  padding: '8px 10px',
  margin: '2px 2px 6px',
  lineHeight: 1.4,
};
const showEarlier: React.CSSProperties = {
  width: '100%',
  border: 'none',
  background: 'transparent',
  color: '#6b7280',
  fontSize: 11,
  fontWeight: 600,
  padding: '8px 6px',
  cursor: 'pointer',
};

function dot(color: string): React.CSSProperties {
  return { width: 10, height: 10, borderRadius: '50%', background: color, marginTop: 3, flex: '0 0 auto' };
}
