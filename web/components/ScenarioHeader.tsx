'use client';

import type { Scenario } from '@/lib/types';

/** Top bar naming the proposed change(s). Frames output as anticipation, never a verdict (CLAUDE.md).
 *  v0.5.0: a scenario may compose several changes — render every description (a single change is unchanged). */
export function ScenarioHeader({ scenario }: { scenario?: Scenario }) {
  if (!scenario) return null;
  // Normalize the scenario's change(s) to a list (mirrors changesOf, but ScenarioHeader gets only the scenario).
  const changes = scenario.changes ?? (scenario.change ? [scenario.change] : []);
  if (changes.length === 0) return null;
  return (
    <div style={bar} data-testid="scenario-header">
      <div style={kicker}>
        PROPOSED CHANGE{changes.length > 1 ? 'S' : ''} — anticipated reactions, a preview not a verdict
      </div>
      <div style={title}>{changes.map((c) => c.description).join(' · ')}</div>
    </div>
  );
}

const bar: React.CSSProperties = {
  position: 'absolute',
  top: 14,
  left: 16,
  right: 16,
  margin: '0 auto',
  maxWidth: 720,
  padding: '8px 14px',
  borderRadius: 10,
  background: 'rgba(255,255,255,0.94)',
  boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
  zIndex: 10,
  textAlign: 'center',
  fontFamily: 'system-ui, sans-serif',
};

const kicker: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: 0.6,
  textTransform: 'uppercase',
  color: '#8a8a8a',
};

const title: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: '#1f2937',
  marginTop: 2,
};
