'use client';

import type { InstrumentedAgent } from '@/lib/types';
import { minutes, sentimentHex, signedMinutes } from '@/lib/viz';

/** Side panel for a clicked instrumented traveler: persona, before/after numbers, full comment. */
export function AgentPanel({ agent, onClose }: { agent: InstrumentedAgent | null; onClose: () => void }) {
  if (!agent) return null;
  const { persona, outcome, reaction } = agent;
  const worse = outcome.delta_seconds > 0;
  const deltaColor = outcome.delta_seconds > 0 ? '#c64545' : outcome.delta_seconds < 0 ? '#3caa5a' : '#6b7280';

  return (
    <div style={panel} data-testid="agent-panel">
      <button style={close} onClick={onClose} aria-label="Close">
        ×
      </button>
      <div style={kicker}>INSTRUMENTED TRAVELER</div>
      <div style={label}>{persona.label}</div>

      <div style={row}>
        <span style={dot(sentimentHex(reaction.sentiment))} />
        <span style={{ fontSize: 12, color: '#444', textTransform: 'capitalize' }}>
          {reaction.stance} · sentiment {reaction.sentiment.toFixed(2)}
        </span>
      </div>

      <div style={grid}>
        <div style={cell}>
          <div style={cellLabel}>Baseline</div>
          <div style={cellVal}>{minutes(outcome.baseline_duration)}</div>
        </div>
        <div style={cell}>
          <div style={cellLabel}>Scenario</div>
          <div style={cellVal}>{minutes(outcome.scenario_duration)}</div>
        </div>
        <div style={cell}>
          <div style={cellLabel}>{worse ? 'Slower' : 'Change'}</div>
          <div style={{ ...cellVal, color: deltaColor }}>{signedMinutes(outcome.delta_seconds)}</div>
        </div>
      </div>

      <div style={commentBox}>“{reaction.comment}”</div>
    </div>
  );
}

const panel: React.CSSProperties = {
  position: 'absolute',
  top: 70,
  right: 16,
  width: 300,
  padding: '16px 18px',
  borderRadius: 12,
  background: 'rgba(255,255,255,0.97)',
  boxShadow: '0 4px 18px rgba(0,0,0,0.22)',
  zIndex: 20,
  fontFamily: 'system-ui, sans-serif',
};
const close: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 10,
  border: 'none',
  background: 'transparent',
  fontSize: 20,
  lineHeight: 1,
  color: '#999',
  cursor: 'pointer',
};
const kicker: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: 0.6,
  textTransform: 'uppercase',
  color: '#9aa0a6',
};
const label: React.CSSProperties = { fontSize: 17, fontWeight: 700, color: '#1f2937', margin: '2px 0 10px' };
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 };
const cell: React.CSSProperties = { background: '#f3f4f6', borderRadius: 8, padding: '8px 6px', textAlign: 'center' };
const cellLabel: React.CSSProperties = { fontSize: 10, color: '#8a8a8a', textTransform: 'uppercase', letterSpacing: 0.4 };
const cellVal: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: '#1f2937', marginTop: 2, fontVariantNumeric: 'tabular-nums' };
const commentBox: React.CSSProperties = { fontSize: 14, lineHeight: 1.45, color: '#374151', fontStyle: 'italic' };

function dot(color: string): React.CSSProperties {
  return { width: 12, height: 12, borderRadius: '50%', background: color, display: 'inline-block', flex: '0 0 auto' };
}
