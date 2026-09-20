'use client';

import { useCallback, useEffect, useState } from 'react';
import { getRuns, type RunSummary } from '@/lib/api';
import { DEMO_READONLY_NOTE, STATIC_DEMO } from '@/lib/demo';

/** Short, human label for a run row: its description if present, else the timestamp tail of the id. */
function runLabel(r: RunSummary): string {
  // V2.4c: the user NAME takes precedence over the mechanical description (truncated for the
  // 260px select); name-less output stays BYTE-IDENTICAL to pre-c labels (spec-pinned surfaces).
  const tail = r.id.replace('multimodal-scenario-', '');
  const name = r.name?.trim();
  const head = name ? (name.length > 40 ? `${name.slice(0, 39)}…` : name) : r.description?.trim();
  return `${head ? head + ' · ' : ''}${tail}${r.status && r.status !== 'done' ? ` (${r.status})` : ''}`;
}

/**
 * Reload any run the runner knows about. Fed by GET /api/runs; selecting a run hands its id to the parent,
 * which fetches `/<id>.json`. `latest.json` is never rewritten here — this only switches what's shown.
 */
export function RunSwitcher({ activeRunId, onLoad }: { activeRunId: string | null; onLoad: (id: string) => void }) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [down, setDown] = useState(false);

  const refresh = useCallback(async () => {
    if (STATIC_DEMO) return; // V2.7f C4 — no inventory to ask for, and no API to ask
    const res = await getRuns();
    if (res.ok) {
      setRuns(res.value.runs);
      setDown(false);
    } else {
      setDown(true);
    }
  }, []);

  // Refresh on mount and whenever the active run changes (a fresh run just landed in the list). Uses a local
  // promise chain (setState in the async callback, not synchronously in the effect body).
  useEffect(() => {
    if (STATIC_DEMO) return; // V2.7f C4 — Compare mounts two of these; neither may reach for /api/runs
    let cancelled = false;
    getRuns().then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setRuns(res.value.runs);
        setDown(false);
      } else {
        setDown(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeRunId]);

  return (
    <div style={wrap} data-testid="run-switcher">
      <label style={label}>Load a run</label>
      <div style={row}>
        <select
          style={select}
          value={activeRunId ?? ''}
          onChange={(e) => e.target.value && onLoad(e.target.value)}
          disabled={STATIC_DEMO}
          title={STATIC_DEMO ? DEMO_READONLY_NOTE : undefined}
          data-testid="run-select"
        >
          <option value="" disabled>
            {STATIC_DEMO ? 'the two demo runs are the deep links' : down ? 'backend unreachable' : runs.length ? 'select a completed run…' : 'no runs yet'}
          </option>
          {runs.map((r) => (
            <option key={r.id} value={r.id}>
              {runLabel(r)}
            </option>
          ))}
        </select>
        <button style={refreshBtn} onClick={refresh} disabled={STATIC_DEMO} title={STATIC_DEMO ? DEMO_READONLY_NOTE : 'Refresh run list'} data-testid="run-refresh">
          ↻
        </button>
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = {
  flexShrink: 0,
  pointerEvents: 'auto',
  background: 'rgba(255,255,255,0.98)',
  border: '1px solid #d7dbe0',
  borderRadius: 10,
  boxShadow: '0 2px 10px rgba(0,0,0,0.14)',
  padding: '10px 12px',
  fontFamily: 'system-ui, sans-serif',
  color: '#374151',
};
const label: React.CSSProperties = { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#8a9099' };
const row: React.CSSProperties = { display: 'flex', gap: 6, marginTop: 6 };
const select: React.CSSProperties = {
  flex: 1,
  border: '1px solid #cbd3dc',
  borderRadius: 8,
  padding: '6px 8px',
  fontSize: 12,
  color: '#374151',
  background: '#fff',
  maxWidth: 260,
};
const refreshBtn: React.CSSProperties = {
  border: '1px solid #cbd3dc',
  background: '#f6f8fa',
  borderRadius: 8,
  padding: '6px 9px',
  fontSize: 13,
  cursor: 'pointer',
  color: '#374151',
};
