'use client';

/**
 * Legend + toggle for the conflict overlay. Frames the overlay HONESTLY: these are safety-SURROGATE
 * near-misses OBSERVED in this run's trajectories, never crash predictions and never "danger the change
 * added". The toggle controls the persistent static dots; the flare pulses always play during motion.
 */
interface ConflictLegendProps {
  count: number;
  activeCount: number;
  showAll: boolean;
  onToggle: () => void;
}

export function ConflictLegend({ count, activeCount, showAll, onToggle }: ConflictLegendProps) {
  if (count === 0) return null;
  return (
    <div style={wrap} data-testid="conflict-legend">
      <div style={head}>Near-miss events observed in this run</div>
      <div style={rowLine}>
        <span style={pulseSwatch} />
        <span style={caption}>flares as it happens ({activeCount} now) · fades over ~10 s</span>
      </div>
      <div style={rowLine}>
        <span style={dotSwatch} />
        <span style={caption}>{count} total · higher severity = larger flare</span>
      </div>
      <label style={toggle}>
        <input type="checkbox" checked={showAll} onChange={onToggle} data-testid="conflict-toggle" />
        <span>show all conflict locations</span>
      </label>
      <div style={disclaimer}>Surrogate measure — a relative severity within this run, not a crash rate.</div>
    </div>
  );
}

const wrap: React.CSSProperties = {
  position: 'absolute',
  right: 16,
  bottom: 84,
  width: 244,
  padding: '10px 12px',
  background: 'rgba(255,255,255,0.94)',
  borderRadius: 12,
  boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
  zIndex: 10,
  fontFamily: 'system-ui, sans-serif',
};
const head: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.4,
  color: '#374151',
  marginBottom: 8,
};
const rowLine: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 };
const caption: React.CSSProperties = { fontSize: 11, color: '#4b5563', lineHeight: 1.3 };
const pulseSwatch: React.CSSProperties = {
  width: 12,
  height: 12,
  borderRadius: '50%',
  background: 'rgba(235,140,60,0.85)',
  border: '1px solid rgba(235,140,60,1)',
  flex: '0 0 auto',
};
const dotSwatch: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: 'rgba(120,120,132,0.6)',
  flex: '0 0 auto',
  margin: '0 2px',
};
const toggle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  color: '#374151',
  marginTop: 6,
  cursor: 'pointer',
};
const disclaimer: React.CSSProperties = {
  fontSize: 10,
  color: '#9aa0a6',
  lineHeight: 1.35,
  marginTop: 7,
  borderTop: '1px solid #eee',
  paddingTop: 6,
};
