'use client';

// V2.7a — the shell header: NADI wordmark + tagline, the four-stage nav (Build → Watch →
// Read → Explore, one workflow — completed stages show a check), the loaded run's name, and
// the "Build your own scenario" CTA. Appearance from the ratified Shell v2 design (Industry
// DS); every VALUE here derives from run data — nothing is transcribed from the mockups.

import { DEMO_READONLY_NOTE } from '@/lib/demo';
import {
  EXPLORE_SUBS,
  STAGES,
  STAGE_LOCKED_HINT,
  type ExploreSub,
  type Stage,
  type StageState,
} from '@/lib/shell';

export function ShellHeader({
  stage,
  onStage,
  stageState,
  exploreSub,
  onExploreSub,
  runLabelText,
  buildLocked,
  onBuildYourOwn,
  runsOpen,
  onToggleRuns,
}: {
  stage: Stage;
  onStage: (s: Stage) => void;
  stageState: StageState;
  exploreSub: ExploreSub;
  onExploreSub: (s: ExploreSub) => void;
  runLabelText: string | null;
  buildLocked: boolean; // STATIC_DEMO — editing needs the local backend
  onBuildYourOwn: () => void;
  runsOpen: boolean;
  onToggleRuns: () => void;
}) {
  return (
    <div className="nadi-shell">
      <header style={bar}>
        <div style={brand}>
          <span style={wordmark}>NADI</span>
          <span style={tagline}>arranges evidence · the planner concludes</span>
        </div>
        <nav style={nav} data-testid="stage-nav">
          {STAGES.map((s, i) => {
            const active = s.key === stage;
            const enabled = stageState.available[s.key] && !(s.key === 'build' && buildLocked);
            const done = stageState.done[s.key];
            const title = !stageState.available[s.key]
              ? STAGE_LOCKED_HINT
              : s.key === 'build' && buildLocked
                ? DEMO_READONLY_NOTE
                : undefined;
            return (
              <span key={s.key} style={{ display: 'flex', alignItems: 'center' }}>
                {i > 0 && (
                  <span
                    style={{
                      width: 26,
                      height: 1,
                      background: done || active ? 'var(--color-accent-500)' : 'var(--color-neutral-300)',
                      margin: '0 10px',
                    }}
                  />
                )}
                <button
                  onClick={() => enabled && onStage(s.key)}
                  disabled={!enabled}
                  title={title}
                  data-testid={`stage-${s.key}`}
                  style={{ ...stageBtn, ...(enabled ? null : stageBtnDisabled) }}
                >
                  <span style={{ ...stageNum, color: active ? 'var(--color-accent-700)' : 'var(--color-neutral-500)' }}>
                    {s.num}
                  </span>
                  <span
                    style={{
                      ...stageLabel,
                      color: active ? 'var(--color-accent-700)' : 'var(--color-text)',
                      borderBottom: active ? '2px solid var(--color-accent)' : '2px solid transparent',
                    }}
                  >
                    {s.label}
                  </span>
                  {done && !active && <span style={{ fontSize: 11, color: 'var(--color-accent-700)' }}>✓</span>}
                </button>
              </span>
            );
          })}
        </nav>
        <div style={right}>
          {runLabelText && (
            <button
              className="tag tag-outline"
              style={{ whiteSpace: 'nowrap', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer', background: 'transparent', font: 'inherit' }}
              onClick={onToggleRuns}
              title="the run inventory — open, clone, compare"
              data-testid="shell-run-tag"
            >
              run: {runLabelText} {runsOpen ? '▴' : '▾'}
            </button>
          )}
          <button
            className="btn btn-primary"
            style={{ whiteSpace: 'nowrap' }}
            onClick={onBuildYourOwn}
            disabled={buildLocked}
            title={buildLocked ? DEMO_READONLY_NOTE : undefined}
            data-testid="build-your-own"
          >
            Build your own scenario
          </button>
        </div>
      </header>
      {stage === 'explore' && (
        <div style={subBar} data-testid="explore-subnav">
          <span style={subKicker}>EXPLORE THIS RUN</span>
          {EXPLORE_SUBS.map((s) => (
            <button
              key={s.key}
              onClick={() => onExploreSub(s.key)}
              data-testid={`explore-${s.key}`}
              style={{
                ...subBtn,
                fontWeight: s.key === exploreSub ? 600 : 400,
                color: s.key === exploreSub ? 'var(--color-accent-700)' : 'var(--color-neutral-700)',
                borderBottom:
                  s.key === exploreSub ? '1.5px solid var(--color-accent)' : '1.5px solid transparent',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const bar: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: 54,
  display: 'grid',
  gridTemplateColumns: '1fr auto 1fr',
  alignItems: 'center',
  padding: '0 var(--space-6)',
  background: 'var(--color-bg)',
  borderBottom: '1px solid var(--color-divider)',
  zIndex: 30,
  fontFamily: 'var(--font-body)',
  color: 'var(--color-text)',
};
const brand: React.CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 'var(--space-4)', minWidth: 0 };
const wordmark: React.CSSProperties = {
  fontFamily: 'var(--font-heading)',
  fontWeight: 600,
  fontSize: 22,
  letterSpacing: '0.02em',
};
const tagline: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--color-neutral-600)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
const nav: React.CSSProperties = { display: 'flex', alignItems: 'center' };
const stageBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 6,
  cursor: 'pointer',
  padding: '4px 2px',
  background: 'transparent',
  border: 'none',
  font: 'inherit',
};
const stageBtnDisabled: React.CSSProperties = { opacity: 0.45, cursor: 'default' };
const stageNum: React.CSSProperties = { fontFamily: 'var(--font-heading)', fontSize: 11 };
const stageLabel: React.CSSProperties = {
  fontFamily: 'var(--font-heading)',
  fontWeight: 600,
  fontSize: 15,
  letterSpacing: '0.08em',
  paddingBottom: 2,
};
const right: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  gap: 'var(--space-4)',
  minWidth: 0,
};
const subBar: React.CSSProperties = {
  position: 'absolute',
  top: 54,
  left: 0,
  right: 0,
  height: 40,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--space-6)',
  background: 'var(--color-bg)',
  borderBottom: '1px solid var(--color-divider)',
  zIndex: 29,
  fontFamily: 'var(--font-body)',
};
const subKicker: React.CSSProperties = {
  fontFamily: 'var(--font-heading)',
  fontSize: 12,
  letterSpacing: '0.1em',
  color: 'var(--color-neutral-600)',
};
const subBtn: React.CSSProperties = {
  fontSize: 13,
  cursor: 'pointer',
  padding: '3px 1px',
  background: 'transparent',
  border: 'none',
  fontFamily: 'inherit',
};
