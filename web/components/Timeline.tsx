'use client';

import { useEffect, useRef, useState } from 'react';

const SPEED = 60; // sim-seconds advanced per real second of playback

interface TimelineProps {
  simStart: number;
  simEnd: number;
  currentTime: number;
  onSeek: (t: number) => void;
  vehicleCount: number;
}

function fmt(t: number): string {
  const s = Math.max(0, Math.floor(t));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function Timeline({ simStart, simEnd, currentTime, onSeek, vehicleCount }: TimelineProps) {
  const [playing, setPlaying] = useState(true);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number | null>(null);
  // Read the latest time inside the rAF loop without re-subscribing the effect. Update the ref in an
  // effect (not during render — refs must not be mutated while rendering).
  const timeRef = useRef(currentTime);
  useEffect(() => {
    timeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    if (!playing) return;
    const tick = (now: number) => {
      if (lastRef.current != null) {
        const dt = (now - lastRef.current) / 1000;
        let next = timeRef.current + SPEED * dt;
        if (next >= simEnd) next = simStart; // loop back to the start
        onSeek(next);
      }
      lastRef.current = now;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      lastRef.current = null;
    };
  }, [playing, simStart, simEnd, onSeek]);

  return (
    <div style={bar}>
      <button style={btn} onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? '❚❚' : '►'}
      </button>
      <input
        type="range"
        min={simStart}
        max={simEnd}
        step={1}
        value={currentTime}
        onChange={(e) => {
          setPlaying(false); // manual scrub pauses playback
          onSeek(Number(e.target.value));
        }}
        style={{ flex: 1 }}
      />
      <span style={label}>
        t = {fmt(currentTime)} / {fmt(simEnd)} &middot; {vehicleCount} veh
      </span>
    </div>
  );
}

const bar: React.CSSProperties = {
  position: 'absolute',
  left: 16,
  right: 16,
  bottom: 16,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 14px',
  borderRadius: 10,
  background: 'rgba(255,255,255,0.92)',
  boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
  fontFamily: 'system-ui, sans-serif',
  zIndex: 10,
};

const btn: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 8,
  border: '1px solid #ccc',
  background: '#fff',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
};

const label: React.CSSProperties = {
  minWidth: 170,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  fontSize: 13,
  color: '#333',
};
