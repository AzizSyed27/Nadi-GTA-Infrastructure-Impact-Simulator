'use client';

import type { ArgumentReach } from '@/lib/types';

type ReachRow = ArgumentReach & { perPost: number | null };

/**
 * ENGAGED-reach per cascade: which argument drew the most RESPONSE (agents who liked/commented/reposted a
 * post making it). NOT exposure-reach (that saturates to everyone under random surfacing) and NOT stance —
 * arguments, not votes, so NO sentiment coloring. `per-post` (responses ÷ posts) is shown alongside because
 * the raw count partly tracks how much an argument was POSTED; per-post says which punched above its volume.
 */
export function ArgumentEngagementPanel({ rows }: { rows: ReachRow[] }) {
  if (rows.length === 0) return null;
  const maxReached = Math.max(1, ...rows.map((r) => r.reached));
  const ordered = [...rows].sort((a, b) => b.reached - a.reached);
  return (
    <div style={wrap} data-testid="engagement-panel">
      <div style={head}>WHICH ARGUMENT DREW THE MOST RESPONSE</div>
      <div style={sub}>within this simulated cascade · unique agents who acted on a post making the argument</div>
      <div style={table}>
        {ordered.map((r) => (
          <div key={r.argument} style={rowStyle} data-testid="engagement-row">
            <div style={label}>{r.argument}</div>
            <div style={barTrack}>
              <div style={{ ...barFill, width: `${Math.round((r.reached / maxReached) * 100)}%` }} />
            </div>
            <div style={nums}>
              <span style={reached} data-testid="reach-count">
                {r.reached}
              </span>
              {r.post_count != null && (
                <span style={perPost}>
                  {r.post_count} posts · {r.perPost}/post
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      <div style={foot}>
        Response volume, not persuasion — the most-answered arguments were also the most-posted. “/post”
        normalizes for that.
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = {
  background: 'rgba(255,255,255,0.94)',
  borderRadius: 12,
  boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
  padding: '10px 12px',
  fontFamily: 'system-ui, sans-serif',
  pointerEvents: 'auto',
};
const head: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#374151' };
const sub: React.CSSProperties = { fontSize: 10, color: '#9aa0a6', marginTop: 2, marginBottom: 8 };
const table: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 7 };
const rowStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr', gap: 2 };
const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#1f2937' };
const barTrack: React.CSSProperties = { height: 6, background: '#eef1f4', borderRadius: 4, overflow: 'hidden' };
// Deliberately a single neutral slate — NEVER sentiment/stance colored (arguments, not votes).
const barFill: React.CSSProperties = { height: '100%', background: '#64748b', borderRadius: 4 };
const nums: React.CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 8 };
const reached: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#334155' };
const perPost: React.CSSProperties = { fontSize: 10, color: '#6b7280' };
const foot: React.CSSProperties = { fontSize: 10, color: '#9aa0a6', marginTop: 9, lineHeight: 1.4 };
