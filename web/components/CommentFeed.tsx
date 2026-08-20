'use client';

import { useMemo, useState } from 'react';

import type { Agent, MandateAgent, PinnedSimAgent } from '@/lib/types';
import { agentId, sentimentHex } from '@/lib/viz';
import { GROUP_LABEL, groupOfAgent, modeIcon } from '@/lib/personaGroups';

interface CommentFeedProps {
  /** Sim-grounded agents (carry trigger_t — pop at their worst moment). */
  agents: PinnedSimAgent[];
  /** Inferred community agents (no trigger_t — interleaved on a synthetic render-time clock). */
  inferred: Agent[];
  /** V2.3c mandate-grounded institutional voices — a PINNED sub-block (never time-gated: a mandate
   * reading isn't a traveler moment), rendered above the ticker. */
  institutions?: MandateAgent[];
  /** True when this run COULD have institutional voices (0.9.0 + voices) but none had facts —
   * renders the honest empty-state line instead of silent absence. */
  institutionsEmpty?: boolean;
  /** Open the institutional grounding card (InstitutionPanel). */
  onInstitution?: (agent: MandateAgent) => void;
  currentTime: number;
  simStart: number;
  simEnd: number;
  /** When set, show only voices whose group matches (the scorecard→feed join). */
  filterGroup: string | null;
  onClearFilter: () => void;
  onSelect: (agent: PinnedSimAgent) => void;
  /** Reverse join: pan/flash a pinned agent's dot. */
  onLocate: (agent: PinnedSimAgent) => void;
  /** V2.3b: open the interview drawer for an INFERRED community voice (sim voices interview via the
   * AgentPanel button; this is the community rows' click affordance). */
  onInterview?: (agent: Agent) => void;
  /** V2.6b: add ANY feed voice to the group-interview room (the trailing ＋ on every row kind).
   * Bubbles the artifact's own agent OBJECT — MapView resolves the agents[] index by reference. */
  onAddToRoom?: (agent: Agent) => void;
  selectedId?: string | null;
}

const CAP = 50; // render the most-recent N; the rest hide behind "show earlier"

type FeedItem =
  | { key: string; when: number; kind: 'sim'; agent: PinnedSimAgent }
  | { key: string; when: number; kind: 'community'; agent: Agent };

/** Deterministic 0..1 hash of a string — for stable per-voice jitter (NOT Math.random, which would
 *  reshuffle every frame). */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * Live ticker of anticipated reactions. Sim voices pop as playback crosses their `trigger_t`; inferred
 * COMMUNITY voices are assigned synthetic, evenly-spaced display times across the sim window AT RENDER
 * (the artifact carries no fake trigger_t) and interleave with a distinct "community perspective" style.
 * Clicking a group row in the scorecard filters this feed to that group. NO tallies, NO stance averages —
 * this is voices over time, never a vote.
 */
export function CommentFeed(props: CommentFeedProps) {
  const {
    agents,
    inferred,
    institutions = [],
    institutionsEmpty = false,
    onInstitution,
    currentTime,
    simStart,
    simEnd,
    filterGroup,
    onClearFilter,
    onSelect,
    onLocate,
    onInterview,
    onAddToRoom,
    selectedId,
  } = props;
  const [expanded, setExpanded] = useState(false);

  // Synthetic display clock for inferred voices — evenly spaced + small deterministic jitter so they
  // don't land on a mechanical cadence. Recomputed only when the inferred set / window changes.
  const communityItems = useMemo<FeedItem[]>(() => {
    const n = inferred.length;
    if (n === 0) return [];
    const spacing = (simEnd - simStart) / (n + 1);
    return inferred.map((a, i) => {
      const key = `inf:${agentId(a)}:${i}`;
      const base = simStart + spacing * (i + 1);
      const jitter = (hash01(key) - 0.5) * spacing * 0.6;
      const when = Math.min(simEnd, Math.max(simStart, base + jitter));
      return { key, when, kind: 'community', agent: a };
    });
  }, [inferred, simStart, simEnd]);

  const simItems = useMemo<FeedItem[]>(
    () => agents.map((a) => ({ key: `sim:${agentId(a)}`, when: a.trigger_t, kind: 'sim', agent: a })),
    [agents],
  );

  const fired = useMemo(() => {
    const all = [...simItems, ...communityItems].filter((it) => it.when <= currentTime);
    const scoped = filterGroup ? all.filter((it) => groupOfAgent(it.agent) === filterGroup) : all;
    return scoped.sort((a, b) => b.when - a.when);
  }, [simItems, communityItems, currentTime, filterGroup]);

  if (agents.length === 0 && inferred.length === 0 && institutions.length === 0) return null;

  const shown = expanded ? fired : fired.slice(0, CAP);
  const hiddenCount = fired.length - shown.length;
  const showInstitutionBlock = !filterGroup && (institutions.length > 0 || institutionsEmpty);

  return (
    <div style={wrap} data-testid="comment-feed">
      <div style={head}>
        <span>ANTICIPATED REACTIONS</span>
        {filterGroup && (
          <button style={chip} onClick={onClearFilter} data-testid="feed-filter-chip">
            showing: {GROUP_LABEL[filterGroup] ?? filterGroup} <span style={chipX}>×</span>
          </button>
        )}
      </div>
      {showInstitutionBlock && (
        <div style={instBlock} data-testid="institution-block">
          <div style={instHead}>INSTITUTIONAL PERSPECTIVES — MANDATE LENS</div>
          {institutions.length === 0 ? (
            <div style={instEmpty} data-testid="institution-empty">
              Institutions speak only when the run computes facts within their mandate — this run
              has none.
            </div>
          ) : (
            institutions.map((a) => (
              <div style={rowWrap} key={agentId(a)}>
                <button
                  data-testid="institution-row"
                  style={{ ...instRow, flex: 1 }}
                  onClick={() => onInstitution?.(a)}
                  title="See this voice's grounding — mandate source + the facts it cites"
                >
                  <span style={rowText}>
                    <span style={rowLabel}>
                      <span style={icon}>🏛️</span>
                      {a.persona.label}
                      <span style={instTag}>— mandate lens</span>
                    </span>
                    <span style={rowComment}>{a.reaction.comment}</span>
                  </span>
                </button>
                {onAddToRoom && (
                  <button
                    style={addBtn}
                    data-testid="room-add-institution"
                    title="Add to conversation — a group interview (3–5 voices)"
                    aria-label={`Add ${a.persona.label} to conversation`}
                    onClick={() => onAddToRoom(a)}
                  >
                    ＋
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
      <div style={list}>
        {shown.length === 0 ? (
          <div style={empty}>
            {filterGroup
              ? `No ${GROUP_LABEL[filterGroup] ?? filterGroup} voices yet — keep playing.`
              : 'Press play — reactions pop as each traveler hits their worst moment.'}
          </div>
        ) : (
          <>
            {shown.map((it, i) =>
              it.kind === 'sim' ? (
                <div style={rowWrap} key={it.key}>
                  <button
                    data-testid="comment-row"
                    onClick={() => {
                      onSelect(it.agent);
                      onLocate(it.agent);
                    }}
                    style={{
                      ...row,
                      flex: 1,
                      ...(i === 0 ? rowFresh : null),
                      ...(agentId(it.agent) === selectedId ? rowSelected : null),
                    }}
                  >
                    <span style={dot(sentimentHex(it.agent.reaction.sentiment))} />
                    <span style={rowText}>
                      <span style={rowLabel}>
                        <span style={icon}>{modeIcon(it.agent.persona.id)}</span>
                        {it.agent.persona.label}
                      </span>
                      <span style={rowComment}>{it.agent.reaction.comment}</span>
                    </span>
                  </button>
                  {onAddToRoom && (
                    <button
                      style={addBtn}
                      data-testid="room-add-sim"
                      title="Add to conversation — a group interview (3–5 voices)"
                      aria-label={`Add ${it.agent.persona.label} to conversation`}
                      onClick={() => onAddToRoom(it.agent)}
                    >
                      ＋
                    </button>
                  )}
                </div>
              ) : (
                // V2.3b: a community row is now a click target — it opens the interview drawer for
                // this inferred voice (styling unchanged; UA button styles reset in communityRow).
                <div style={rowWrap} key={it.key}>
                  <button
                    data-testid="community-row"
                    style={{ ...communityRow, flex: 1, ...(onInterview ? { cursor: 'pointer' } : null) }}
                    onClick={() => onInterview?.(it.agent)}
                    title="Ask this voice a question"
                  >
                    <span style={dot(sentimentHex(it.agent.reaction.sentiment))} />
                    <span style={rowText}>
                      <span style={rowLabel}>
                        <span style={icon}>{modeIcon(it.agent.persona.id)}</span>
                        {it.agent.persona.label}
                        <span style={communityTag}>— community perspective</span>
                      </span>
                      <span style={rowComment}>{it.agent.reaction.comment}</span>
                    </span>
                  </button>
                  {onAddToRoom && (
                    <button
                      style={addBtn}
                      data-testid="room-add-community"
                      title="Add to conversation — a group interview (3–5 voices)"
                      aria-label={`Add ${it.agent.persona.label} to conversation`}
                      onClick={() => onAddToRoom(it.agent)}
                    >
                      ＋
                    </button>
                  )}
                </div>
              ),
            )}
            {hiddenCount > 0 && (
              <button style={showEarlier} onClick={() => setExpanded(true)} data-testid="show-earlier">
                show earlier ({hiddenCount})
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
  width: 320,
  maxHeight: '46vh',
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
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '8px 12px',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.6,
  color: '#374151',
  borderBottom: '1px solid #eee',
};
const chip: React.CSSProperties = {
  border: 'none',
  background: '#e8f0fe',
  color: '#1f4e9c',
  borderRadius: 6,
  padding: '2px 7px',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: 0.2,
  cursor: 'pointer',
  textTransform: 'none',
};
const chipX: React.CSSProperties = { marginLeft: 2, fontWeight: 700 };
const list: React.CSSProperties = { overflowY: 'auto', padding: 6 };
const empty: React.CSSProperties = { padding: '10px 8px', fontSize: 12, color: '#9aa0a6' };
const row: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
  width: '100%',
  textAlign: 'left',
  border: 'none',
  background: 'transparent',
  padding: '7px 8px',
  borderRadius: 8,
  cursor: 'pointer',
};
const communityRow: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
  width: '100%',
  padding: '7px 8px 7px 7px',
  borderRadius: 8,
  background: '#f7f4fb',
  marginBottom: 1,
  // V2.3b: now a <button> — reset the UA styles so the row renders exactly as the old div did.
  // ORDER MATTERS: the `border` shorthand wipes every longhand, so the purple accent must come AFTER
  // it (review-caught: shorthand-after-longhand silently erased the borderLeft).
  border: 'none',
  borderLeft: '3px solid #b79bd6',
  textAlign: 'left',
  font: 'inherit',
  color: 'inherit',
};
const instBlock: React.CSSProperties = { padding: '6px 6px 2px', borderBottom: '1px solid #eee' };
const instHead: React.CSSProperties = { fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, color: '#3e6b8f', padding: '0 6px 4px' };
const instEmpty: React.CSSProperties = { padding: '0 6px 8px', fontSize: 11, color: '#9aa0a6', lineHeight: 1.35 };
const instRow: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
  width: '100%',
  padding: '6px 8px 6px 7px',
  borderRadius: 8,
  background: '#eef3f7',
  marginBottom: 3,
  cursor: 'pointer',
  // button UA reset; the accent must come AFTER the shorthand (the border-wipe lesson)
  border: 'none',
  borderLeft: '3px solid #3e6b8f',
  textAlign: 'left',
  font: 'inherit',
  color: 'inherit',
};
const instTag: React.CSSProperties = { fontSize: 10, fontWeight: 500, color: '#3e6b8f', letterSpacing: 0.1 };
const rowFresh: React.CSSProperties = { background: '#fff7e6' };
const rowSelected: React.CSSProperties = { background: '#e8f0fe' };
const rowText: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 };
const rowLabel: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#1f2937', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' };
const icon: React.CSSProperties = { fontSize: 12 };
const communityTag: React.CSSProperties = { fontSize: 10, fontWeight: 500, color: '#7c5aa8', letterSpacing: 0.1 };
const rowComment: React.CSSProperties = { fontSize: 12, color: '#4b5563', lineHeight: 1.35 };
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

// V2.6b — every row kind gains a trailing "add to conversation" ＋. Nested buttons are invalid
// HTML, so each row is a flex WRAPPER (the list key lives here) with the original row button
// (flex:1 — its width:100% is inert once flex-basis is 0) and the add button as SIBLINGS. The
// row buttons keep their testids and their border-shorthand-before-longhand accent ordering
// (computed-style-pinned in interview.spec).
const rowWrap: React.CSSProperties = { display: 'flex', alignItems: 'stretch', gap: 2 };
const addBtn: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#6b7280',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  padding: '0 5px',
  borderRadius: 8,
  flex: '0 0 auto',
};
