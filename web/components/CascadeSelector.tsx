'use client';

/**
 * Flip between the independent cascades. Same round-0 seeds, different unfoldings — the point is SEEING the
 * divergence, so this is a plain selector, NOT a "final result" toggle. Framed as one illustrative run.
 */
export function CascadeSelector({
  ids,
  active,
  onSelect,
}: {
  ids: string[];
  active: string;
  onSelect: (id: string) => void;
}) {
  if (ids.length === 0) return null;
  return (
    <div style={wrap} data-testid="cascade-selector">
      <div style={head}>CASCADE</div>
      <div style={row}>
        {ids.map((id, i) => (
          <button
            key={id}
            data-testid={`cascade-tab-${id}`}
            onClick={() => onSelect(id)}
            style={{ ...tab, ...(id === active ? tabActive : null) }}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <div style={note}>one simulated cascade — not a prediction</div>
    </div>
  );
}

const wrap: React.CSSProperties = {
  background: 'rgba(255,255,255,0.94)',
  borderRadius: 12,
  boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
  padding: '8px 12px',
  fontFamily: 'system-ui, sans-serif',
  pointerEvents: 'auto',
};
const head: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: '#374151' };
const row: React.CSSProperties = { display: 'flex', gap: 6, marginTop: 6 };
const tab: React.CSSProperties = {
  minWidth: 30,
  border: '1px solid #d7dbe0',
  background: '#fff',
  borderRadius: 8,
  padding: '4px 10px',
  fontSize: 13,
  fontWeight: 700,
  color: '#4b5563',
  cursor: 'pointer',
};
const tabActive: React.CSSProperties = { background: '#1f4e9c', color: '#fff', border: '1px solid #1f4e9c' };
const note: React.CSSProperties = { fontSize: 10, color: '#9aa0a6', marginTop: 6, fontStyle: 'italic' };
