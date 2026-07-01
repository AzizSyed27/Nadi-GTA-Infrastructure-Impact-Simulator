'use client';

import { useMemo } from 'react';

import type { InstrumentedAgent } from '@/lib/types';
import { sentimentHex } from '@/lib/viz';

interface CommentFeedProps {
  agents: InstrumentedAgent[];
  currentTime: number;
  onSelect: (agent: InstrumentedAgent) => void;
  selectedId?: string | null;
}

/**
 * Live ticker. Each agent's comment appears once playback crosses its `trigger_t` (the traveler's
 * worst-traffic moment). Derived from `currentTime` each render, so scrubbing back — or the timeline
 * looping to the start — empties/refills it automatically (no stale buffer). Newest on top; clicking a
 * row opens that traveler's panel.
 */
export function CommentFeed({ agents, currentTime, onSelect, selectedId }: CommentFeedProps) {
  const fired = useMemo(
    () => agents.filter((a) => a.trigger_t <= currentTime).sort((a, b) => b.trigger_t - a.trigger_t),
    [agents, currentTime],
  );

  if (agents.length === 0) return null;

  return (
    <div style={wrap} data-testid="comment-feed">
      <div style={head}>
        ANTICIPATED REACTIONS{' '}
        <span style={{ color: '#9aa0a6' }}>
          {fired.length} of {agents.length} travelers so far
        </span>
      </div>
      <div style={list}>
        {fired.length === 0 ? (
          <div style={empty}>Press play — reactions pop as each traveler hits their worst moment.</div>
        ) : (
          fired.map((a, i) => (
            <button
              key={a.vehicle_id}
              data-testid="comment-row"
              onClick={() => onSelect(a)}
              style={{
                ...row,
                ...(i === 0 ? rowFresh : null),
                ...(a.vehicle_id === selectedId ? rowSelected : null),
              }}
            >
              <span style={dot(sentimentHex(a.reaction.sentiment))} />
              <span style={rowText}>
                <span style={rowLabel}>{a.persona.label}</span>
                <span style={rowComment}>{a.reaction.comment}</span>
              </span>
            </button>
          ))
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
  padding: '8px 12px',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.6,
  color: '#374151',
  borderBottom: '1px solid #eee',
};
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
const rowFresh: React.CSSProperties = { background: '#fff7e6' };
const rowSelected: React.CSSProperties = { background: '#e8f0fe' };
const rowText: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 };
const rowLabel: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#1f2937' };
const rowComment: React.CSSProperties = { fontSize: 12, color: '#4b5563', lineHeight: 1.35 };

function dot(color: string): React.CSSProperties {
  return { width: 10, height: 10, borderRadius: '50%', background: color, marginTop: 3, flex: '0 0 auto' };
}
