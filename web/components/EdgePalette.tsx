'use client';

import { useState } from 'react';
import type { Edge } from '@/lib/api';

interface EdgePaletteProps {
  edge: Edge;
  submitting: boolean;
  submitError: string | null;
  onSpeedLimit: (valueMps: number) => void;
  onBikeLane: () => void;
  onCancel: () => void;
}

/**
 * The edit-an-edge palette: change the speed limit, or convert the curbside car lane to a bike lane. The
 * bike-lane option is offered ONLY when the backend says the edge is eligible (>= 2 car lanes); otherwise it is
 * greyed with the backend's own `eligibility_reason` as the tooltip — the frontend never guesses the rule.
 * Keyed by edge id in the parent so a fresh selection remounts with the edge's current speed.
 */
export function EdgePalette({ edge, submitting, submitError, onSpeedLimit, onBikeLane, onCancel }: EdgePaletteProps) {
  const [speed, setSpeed] = useState<number>(Math.round(edge.speed_mps * 10) / 10);

  return (
    <div style={card} data-testid="edge-palette">
      <div style={title}>Edit this road</div>
      <div style={meta}>
        <code>{edge.id}</code>
        <br />
        {edge.car_lane_count} car {edge.car_lane_count === 1 ? 'lane' : 'lanes'} · current speed{' '}
        {(edge.speed_mps * 3.6).toFixed(0)} km/h
      </div>

      <div style={section}>
        <label style={field}>
          New speed limit (m/s)
          <input
            type="number"
            min={1}
            step={0.1}
            value={speed}
            onChange={(e) => setSpeed(Math.max(1, Number(e.target.value) || 1))}
            style={input}
            data-testid="palette-speed"
          />
        </label>
        <button
          style={{ ...primaryBtn, ...(submitting ? busyBtn : null) }}
          disabled={submitting}
          onClick={() => onSpeedLimit(speed)}
          data-testid="apply-speed"
        >
          Apply speed limit
        </button>
      </div>

      <div style={section}>
        <button
          style={{ ...secondaryBtn, ...(edge.eligible_bike_lane && !submitting ? null : disabledBtn) }}
          disabled={!edge.eligible_bike_lane || submitting}
          title={edge.eligible_bike_lane ? undefined : edge.eligibility_reason}
          onClick={onBikeLane}
          data-testid="apply-bike-lane"
        >
          Convert curbside lane to bike lane
        </button>
        {!edge.eligible_bike_lane && (
          <div style={reasonText} data-testid="bike-ineligible-reason">
            {edge.eligibility_reason}
          </div>
        )}
      </div>

      <button style={linkBtn} onClick={onCancel} disabled={submitting} data-testid="palette-cancel">
        cancel
      </button>
      {submitError && (
        <div style={errText} data-testid="palette-error">
          {submitError}
        </div>
      )}
    </div>
  );
}

const card: React.CSSProperties = {
  flexShrink: 0,
  pointerEvents: 'auto',
  background: 'rgba(255,255,255,0.98)',
  border: '1px solid #d7dbe0',
  borderRadius: 10,
  boxShadow: '0 2px 10px rgba(0,0,0,0.14)',
  padding: '12px 14px',
  fontFamily: 'system-ui, sans-serif',
  color: '#374151',
};
const title: React.CSSProperties = { fontSize: 14, fontWeight: 700, marginBottom: 6 };
const meta: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 10, lineHeight: 1.5, wordBreak: 'break-all' };
const section: React.CSSProperties = { borderTop: '1px solid #eef1f4', paddingTop: 10, marginTop: 6 };
const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#6b7280', marginBottom: 8 };
const input: React.CSSProperties = { border: '1px solid #cbd3dc', borderRadius: 8, padding: '6px 8px', fontSize: 13, color: '#374151' };
const primaryBtn: React.CSSProperties = {
  border: 'none',
  background: '#1f4e9c',
  color: '#fff',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
};
const busyBtn: React.CSSProperties = { opacity: 0.6, cursor: 'default' };
const secondaryBtn: React.CSSProperties = {
  width: '100%',
  border: '1px solid #cbd3dc',
  background: '#f6f8fa',
  color: '#374151',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
};
const disabledBtn: React.CSSProperties = { opacity: 0.5, cursor: 'not-allowed', color: '#9aa0a8' };
const reasonText: React.CSSProperties = { marginTop: 6, fontSize: 11.5, color: '#8a9099', lineHeight: 1.4 };
const linkBtn: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#8a9099',
  fontSize: 12,
  cursor: 'pointer',
  textDecoration: 'underline',
  marginTop: 10,
};
const errText: React.CSSProperties = { marginTop: 8, fontSize: 12, color: '#b23a3a' };
