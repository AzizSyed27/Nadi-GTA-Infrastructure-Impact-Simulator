'use client';

/**
 * V2.7b C9 — ACT II: the interpretation, streaming.
 *
 * Act I ends with every number final. Act II is what the model layer adds on top of numbers that
 * are already complete — which is why the whole act is skippable, failable, and labeled at its
 * honest cost, and why nothing here may ever look like it is producing a result.
 *
 * THE RULE FOR THE RIGHT-HAND SIDE IS CONTENT, NEVER MACHINERY. No tool calls, no API names, no
 * console output, no token counts. What a reader sees is what the run produced — a voice, a
 * mandate, a paragraph — and the only numbers are ones this project already computes and stands
 * behind.
 *
 * LIVE-ONLY (ratified). These cards render while interpretation is actually happening; a finished
 * run reopened from the list gets the ordinary Watch layout. The streamed content — voice text,
 * slot drafts — is not persisted anywhere the client can re-read, so a ledger-seeded card could
 * only ever show a count, and "done, but I have nothing to show you" is a second state per panel
 * bought for nothing.
 */

import { memo, useMemo, useState } from 'react';

import type { Agent, LonLat, TrajectoryArtifact } from '@/lib/types';
import {
  STAGE_COSTS_MODEL,
  type RunFeedState,
  type StageKey,
  type StageState,
} from '@/lib/runFeed';
import { GROUP_LABEL, groupOfAgent } from '@/lib/personaGroups';
import { chipInferred, chipSim } from '@/lib/scorecardStyles';
import { institutionDisclaimer } from '@/components/InstitutionPanel';
import { materializeTimestamps } from '@/lib/viz';
import { fmtSimTime } from '@/lib/simTime';
import type { NetworkEdge } from '@/lib/network';
import { buildEdgeGrid, nearestEdge, odLine } from '@/lib/streetNames';

/** Said once, at the top, because it is the claim the whole act depends on. */
export const ACT_TWO_HEAD = 'INTERPRETATION — the results are already complete';
export const ACT_TWO_NOTE =
  'Everything below is added on top of figures the simulator already finished. It is skippable, it ' +
  'can fail, and none of it changes a number.';

/** A stage that runs no model says so, rather than rendering a bare 0 a reader has to interpret. */
export const NO_MODEL_CALLS = 'zero model calls — composed deterministically';

export const SKIP_LABEL = 'Stop interpretation';
export const SKIP_TITLE =
  'Stops after the stage finishes what it is holding. Everything already generated is kept, and the ' +
  'figures were final before any of this started.';
/** The running total NEVER understates: retries are real calls and the projection cannot know them,
 *  so the title says the actual can pass the estimate rather than quietly capping it. */
export const COST_TITLE =
  'Metered from the stages themselves. The estimate is a projection, not a cap — retries push the ' +
  'actual above it.';

const STATUS_MARK: Record<string, string> = {
  pending: '·', running: '▶', done: '✓', partial: '◐', skipped: '—', failed: '×',
};

export function ActTwo({
  experience,
  artifact,
  network,
  graphPanel,
  reportPanel,
  onSkip,
  skipping,
  skipError,
}: {
  experience: RunFeedState;
  artifact: TrajectoryArtifact;
  /** V2.7d: the network export (names + geometry) — the voice card's origin→destination line derives from it. */
  network?: NetworkEdge[];
  /** The discourse stage's body — passed in so this file doesn't pull deck.gl into every render. */
  graphPanel: React.ReactNode;
  reportPanel: React.ReactNode;
  /** Stop the rest. The caller navigates to Read on success — see MapView's handler. */
  onSkip: () => void;
  skipping: boolean;
  skipError: string | null;
}) {
  const { stages } = experience;
  const spent = experience.llmCallsTotal;
  const projected = experience.projection?.calls ?? null;

  // AUTO-FOLLOW: the running stage, else the last one that has started. A reader who clicks a
  // started card PINS it (so a voice that would otherwise scroll past can be read) and the
  // following control gives the act back.
  const followed = useMemo<StageKey>(() => {
    const running = stages.find((s) => s.status === 'running');
    if (running) return running.key;
    const started = [...stages].reverse().find((s) => s.status !== 'pending');
    return started?.key ?? 'personas';
  }, [stages]);
  const [pinned, setPinned] = useState<StageKey | null>(null);
  const shown = pinned ?? followed;
  const shownStage = stages.find((s) => s.key === shown) ?? stages[0];

  return (
    <div className="nadi-shell" style={sheet} data-testid="act-two">
      <div style={head}>
        <div style={headLine}>{ACT_TWO_HEAD}</div>
        <div style={headNote}>{ACT_TWO_NOTE}</div>
        <div style={brakeRow}>
          {/* THE COST, and the control that stops it, side by side — a number a reader cannot act
              on is just a number. Both are ledger-derived: `spent` is metered from the stages
              themselves, `projected` is the server's own pre-spend estimate. */}
          <span style={costTotal} title={COST_TITLE} data-testid="act-two-cost">
            model calls: {spent.toLocaleString()}
            {projected != null ? ` of ~${projected.toLocaleString()}` : ''}
          </span>
          <button className="btn btn-secondary" style={skipBtn} onClick={onSkip} disabled={skipping}
                  title={SKIP_TITLE} data-testid="act-two-skip">
            {skipping ? 'stopping…' : SKIP_LABEL}
          </button>
        </div>
        {experience.projection?.basis && (
          <div style={basisNote} data-testid="act-two-cost-basis">{experience.projection.basis}</div>
        )}
        {skipError && <div style={errNote} data-testid="act-two-skip-error">{skipError}</div>}
      </div>

      <div style={rail} data-testid="act-two-rail">
        {stages.map((s, i) => (
          <button
            key={s.key}
            style={{ ...railCard, ...(s.key === shown ? railCardOn : null) }}
            data-testid={`act-two-card-${s.key}`}
            data-status={s.status}
            aria-current={s.key === shown}
            disabled={s.status === 'pending'}
            onClick={() => setPinned(s.key)}
          >
            <span style={railNum}>{String(i + 1).padStart(2, '0')}</span>
            <span style={railLabel}>{s.label}</span>
            <span style={railMark}>{STATUS_MARK[s.status] ?? '·'}</span>
            <span style={railCost}>{costLine(s)}</span>
          </button>
        ))}
      </div>

      {pinned && (
        <button style={followBtn} data-testid="act-two-follow" onClick={() => setPinned(null)}>
          ← following the run
        </button>
      )}

      <div style={body} data-testid={`act-two-panel-${shown}`}>
        {shown === 'personas' && <PersonasPanel experience={experience} />}
        {shown === 'voices' && <VoicesPanel experience={experience} artifact={artifact} network={network} />}
        {shown === 'institutions' && <InstitutionsPanel experience={experience} />}
        {shown === 'discourse' && graphPanel}
        {shown === 'report' && reportPanel}
        {shown === 'index' && <IndexPanel experience={experience} stage={shownStage} />}
      </div>
    </div>
  );
}

/** Per-stage cost. `STAGE_COSTS_MODEL` gets its first consumer here: a stage that runs no model
 *  states that, and a stage that does but hasn't reported yet says nothing rather than "0". */
function costLine(s: StageState): string {
  if (!STAGE_COSTS_MODEL[s.key]) return 'no model';
  return s.calls == null ? '' : `${s.calls} call${s.calls === 1 ? '' : 's'}`;
}

// ------------------------------------------------------------------------------------- personas

export function PersonasPanel({ experience }: { experience: RunFeedState }) {
  const p = experience.personas;
  if (!p) return <Waiting what="the traveler sample" />;
  return (
    <div style={col} data-testid="act-two-personas">
      <div style={bigRow}>
        <Big n={p.total} label="sampled travelers" />
      </div>
      {/* the server's own sentence, verbatim — it already names the split and the honesty claim */}
      <p style={para}>{p.basis}</p>
      {/* THE EMITTER CARRIES NO ids[], so nothing here can point at WHICH travelers were sampled.
          Lighting whichever entities happen to be loaded would render convincingly and be the
          wrong ones — the C8b misattribution class. Saying so is the honest subset. */}
      <p style={muted} data-testid="personas-not-shown">
        Which travelers were sampled isn’t shown on the map: the run reports the counts and the
        basis, not the individual ids.
      </p>
    </div>
  );
}

// --------------------------------------------------------------------------------------- voices

export const VOICES_NOTE =
  'Each card is one sampled traveler reacting to their own trip in this run — anticipation, never a verdict.';

export function VoicesPanel({
  experience,
  artifact,
  network,
}: {
  experience: RunFeedState;
  artifact: TrajectoryArtifact;
  network?: NetworkEdge[];
}) {
  const { voices, voicesTotal } = experience;
  const departOf = useMemo(() => departLookup(artifact), [artifact]);
  const odOf = useMemo(() => odLookup(artifact, network ?? []), [artifact, network]);
  if (voices.length === 0) return <Waiting what="the first voice" />;
  return (
    <div style={col} data-testid="act-two-voices">
      <div style={counter} data-testid="act-two-voice-count">
        {voices.length}
        {voicesTotal != null ? ` of ${voicesTotal}` : ''} voices
      </div>
      <p style={muted}>{VOICES_NOTE}</p>
      <div style={cards}>
        {[...voices].reverse().map((a, i) => (
          <VoiceCard key={`${a.persona.id}#${voices.length - i}`} agent={a} depart={departOf(a)} od={odOf(a)}
                     profile={(artifact.meta as { demand_profile?: string }).demand_profile} />
        ))}
      </div>
    </div>
  );
}

function VoiceCard({ agent, depart, od, profile }: { agent: Agent; depart: number | null; od: string | null; profile?: string }) {
  const group = groupOfAgent(agent);
  const inferred = agent.grounding === 'inferred';
  return (
    <div style={voiceCard} data-testid="act-two-voice">
      <div style={voiceHead}>
        <span style={voiceLabel}>{agent.persona.label}</span>
        {group && <span style={voiceGroup}>{GROUP_LABEL[group] ?? group}</span>}
        <span style={inferred ? chipInferred : chipSim}>{inferred ? 'inferred' : 'simulated'}</span>
        {/* depart time only when this entity is actually in the artifact — a calibrated run renders
            an outcome-stratified SAMPLE, so many voices have no trajectory here to read it from */}
        {depart != null && <span style={voiceDepart}>departs {fmtSimTime(depart, profile)}</span>}
        {/* V2.7d: origin→destination ONLY when both trajectory endpoints resolve to a NAMED nearest edge
            within 25 m (the V2.7b rule: derivable from the network, or the line is trimmed) */}
        {od != null && <span style={voiceDepart} data-testid="act-two-voice-od">{od}</span>}
      </div>
      <div style={voiceQuote}>{agent.reaction.comment}</div>
    </div>
  );
}

/** V2.7d: the origin→destination line for a sim voice — each trajectory endpoint resolved to the
 *  NEAREST edge of any kind within OD_THRESHOLD_M; unnamed or too far → null (the line is omitted). */
function odLookup(artifact: TrajectoryArtifact, network: NetworkEdge[]): (a: Agent) => string | null {
  if (network.length === 0) return () => null;
  const grid = buildEdgeGrid(network);
  const ends: Record<string, [LonLat, LonLat]> = {};
  for (const v of artifact.vehicles ?? []) if (v.path.length) ends[`v:${v.id}`] = [v.path[0], v.path[v.path.length - 1]];
  for (const p of artifact.persons ?? []) if (p.path.length) ends[`p:${p.id}`] = [p.path[0], p.path[p.path.length - 1]];
  const cache: Record<string, string | null> = {};
  return (a) => {
    const k = a.vehicle_id ? `v:${a.vehicle_id}` : a.person_id ? `p:${a.person_id}` : null;
    if (!k || !ends[k]) return null;
    if (!(k in cache)) {
      const [o, d] = ends[k];
      cache[k] = odLine(nearestEdge(o, grid)?.edge.name ?? null, nearestEdge(d, grid)?.edge.name ?? null);
    }
    return cache[k];
  };
}

/** first timestamp of the entity a sim voice is pinned to, or null. */
function departLookup(artifact: TrajectoryArtifact): (a: Agent) => number | null {
  const first: Record<string, number> = {};
  for (const v of artifact.vehicles ?? []) first[`v:${v.id}`] = materializeTimestamps(v).timestamps[0];
  for (const p of artifact.persons ?? []) first[`p:${p.id}`] = materializeTimestamps(p).timestamps[0];
  return (a) => {
    const k = a.vehicle_id ? `v:${a.vehicle_id}` : a.person_id ? `p:${a.person_id}` : null;
    return k && first[k] != null ? first[k] : null;
  };
}

// --------------------------------------------------------------------------------- institutions

export const SILENCE_NOTE =
  'Silence is the honest output here, not an omission: an institution speaks only when this run ' +
  'computed facts inside its mandate.';

export function InstitutionsPanel({ experience }: { experience: RunFeedState }) {
  const { institutionsSpoke: spoke, institutionsSilent: silent } = experience;
  if (spoke.length === 0 && silent.length === 0) return <Waiting what="the mandate lens" />;
  return (
    <div style={col} data-testid="act-two-institutions">
      <div style={counter}>{NO_MODEL_CALLS}</div>
      {spoke.map((a) => (
        <InstitutionCard key={a.persona.id} agent={a} />
      ))}
      {silent.length > 0 && (
        <>
          <p style={muted}>{SILENCE_NOTE}</p>
          {silent.map((s) => (
            <div key={s.id} style={silentCard} data-testid="institution-silent">
              <div style={silentLabel}>{s.label}</div>
              {/* the reason names the FACT CLASS this run did not compute — never a generic empty */}
              <div style={silentReason}>{s.reason}</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function InstitutionCard({ agent }: { agent: Agent }) {
  const md = agent.mandate;
  if (!md) return null;
  return (
    <div style={instCard} data-testid="act-two-institution">
      <div style={instKicker}>INSTITUTIONAL PERSPECTIVE · MANDATE LENS</div>
      <div style={instLabel}>{agent.persona.label}</div>
      <div style={mandateBox} data-testid="act-two-mandate">
        <div style={mandateHead}>
          Published mandate —{' '}
          <a style={srcLink} href={md.source} target="_blank" rel="noreferrer">source</a> · retrieved{' '}
          {md.retrieved}
        </div>
        {/* VERBATIM roster bytes: for a real organization, paraphrase is misrepresentation */}
        <div style={mission}>“{md.mission}”</div>
      </div>
      <div style={instComment}>{agent.reaction.comment}</div>
      {(agent.citations ?? []).length > 0 && (
        <>
          <div style={citesHead}>
            Facts cited from this run: {agent.citations!.length} — all computed in Act I
          </div>
          {agent.citations!.map((c) => (
            <div key={c.key} style={citeBox} data-testid="act-two-citation">
              <div style={citeText}>{c.text}</div>
              {(c.notes ?? []).map((n, i) => (
                <div key={i} style={citeNote}>{n}</div>
              ))}
            </div>
          ))}
        </>
      )}
      <div style={disclaimerBox} data-testid="act-two-disclaimer">
        {institutionDisclaimer(md.institution)}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------------- chat index

export function IndexPanel({ experience, stage }: { experience: RunFeedState; stage: StageState }) {
  // A stage with no content to show says exactly that. No fake terminal, no invented progress bar.
  return (
    <div style={col} data-testid="act-two-index">
      <p style={para}>
        {experience.indexDocs != null
          ? `Building the chat index — ${experience.indexDocs} documents from this run.`
          : 'Building the chat index from this run’s corpus.'}
      </p>
      <p style={muted}>
        This stage produces no reading of its own: it is what makes “ask the report” able to answer
        from this run. {stage.status === 'done' ? 'It finished.' : 'It is still working.'}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------------------------ the waits

export const Waiting = memo(function Waiting({ what }: { what: string }) {
  return (
    <div style={col} data-testid="act-two-waiting">
      <p style={muted}>waiting for {what} — nothing has arrived for this stage yet</p>
    </div>
  );
});

function Big({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div style={bigNum}>{n.toLocaleString()}</div>
      <div style={bigLabel}>{label}</div>
    </div>
  );
}

// -------------------------------------------------------------------------------------- styles

const sheet: React.CSSProperties = {
  // scrollbarGutter STABLE: without it, a stage whose panel is short enough to lose the scrollbar
  // changes the sheet's inner width, which re-wraps the rail above and makes the cards JUMP as a
  // reader clicks between stages (caught by a click that could never land on a moving target).
  position: 'absolute', inset: '56px 0 0 0', zIndex: 24, overflowY: 'scroll', scrollbarGutter: 'stable',
  background: 'var(--color-bg)', padding: '14px 18px 28px',
  fontFamily: 'var(--font-body)', color: 'var(--color-text)',
};
const head: React.CSSProperties = { marginBottom: 12 };
const headLine: React.CSSProperties = {
  fontFamily: 'var(--font-heading)', fontSize: 13, letterSpacing: '.09em', fontWeight: 600,
  color: 'var(--color-accent-700)',
};
const headNote: React.CSSProperties = {
  fontSize: 12.5, lineHeight: 1.5, color: 'var(--color-neutral-700)', maxWidth: 760, marginTop: 3,
};
const brakeRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap',
};
const costTotal: React.CSSProperties = {
  fontFamily: 'var(--font-heading)', fontSize: 12.5, letterSpacing: '.05em',
  color: 'var(--color-accent-700)',
};
const skipBtn: React.CSSProperties = { fontSize: 11.5, padding: '3px 9px' };
const basisNote: React.CSSProperties = {
  fontSize: 11, lineHeight: 1.45, color: 'var(--color-neutral-600)', marginTop: 3, maxWidth: 720,
};
const errNote: React.CSSProperties = { fontSize: 11.5, color: '#b3261e', marginTop: 4 };
const rail: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 };
const railCard: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1,
  padding: '7px 10px', minWidth: 132, textAlign: 'left', cursor: 'pointer',
  background: 'var(--color-bg)', border: '1px solid var(--color-divider)',
  fontFamily: 'var(--font-body)', color: 'var(--color-text)',
};
const railCardOn: React.CSSProperties = {
  // the FULL shorthand, not `borderColor`: React warns (and the browser can drop the colour) when a
  // shorthand and its longhand are mixed across rerenders — the same shorthand-vs-longhand hazard
  // that erased CommentFeed's accent in V2.3b. Caught here by a dev-overlay badge in a screenshot.
  border: '1px solid var(--color-accent)',
  background: 'color-mix(in srgb, var(--color-accent) 7%, transparent)',
};
const railNum: React.CSSProperties = { fontFamily: 'var(--font-heading)', fontSize: 10, color: 'var(--color-neutral-600)' };
const railLabel: React.CSSProperties = { fontFamily: 'var(--font-heading)', fontSize: 12.5, fontWeight: 600 };
const railMark: React.CSSProperties = { fontSize: 11, color: 'var(--color-accent-700)' };
const railCost: React.CSSProperties = { fontSize: 10, color: 'var(--color-neutral-600)' };
const followBtn: React.CSSProperties = {
  border: 'none', background: 'none', cursor: 'pointer', padding: 0, marginBottom: 8,
  fontFamily: 'var(--font-body)', fontSize: 11.5, color: 'var(--color-accent-700)',
};
const body: React.CSSProperties = { borderTop: '1px solid var(--color-divider)', paddingTop: 12 };
const col: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 900 };
const para: React.CSSProperties = { fontSize: 13.5, lineHeight: 1.6, margin: 0 };
const muted: React.CSSProperties = { fontSize: 12, lineHeight: 1.55, color: 'var(--color-neutral-600)', margin: 0 };
const counter: React.CSSProperties = {
  fontFamily: 'var(--font-heading)', fontSize: 12, letterSpacing: '.06em', color: 'var(--color-neutral-700)',
};
const bigRow: React.CSSProperties = { display: 'flex', gap: 28 };
const bigNum: React.CSSProperties = { fontFamily: 'var(--font-heading)', fontSize: 34, fontWeight: 600, lineHeight: 1 };
const bigLabel: React.CSSProperties = { fontSize: 11.5, color: 'var(--color-neutral-600)', marginTop: 2 };
const cards: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 };
const voiceCard: React.CSSProperties = {
  border: '1px solid var(--color-divider)', borderLeft: '3px solid #b79bd6', padding: '7px 10px',
};
const voiceHead: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' };
const voiceLabel: React.CSSProperties = { fontSize: 12.5, fontWeight: 600 };
const voiceGroup: React.CSSProperties = { fontSize: 11, color: 'var(--color-neutral-600)' };
const voiceDepart: React.CSSProperties = { fontSize: 10.5, color: 'var(--color-neutral-600)' };
const voiceQuote: React.CSSProperties = { fontSize: 12.5, lineHeight: 1.45, marginTop: 3 };
const instCard: React.CSSProperties = {
  border: '1px solid var(--color-divider)', borderLeft: '3px solid #3e6b8f', padding: '10px 12px',
};
const instKicker: React.CSSProperties = {
  fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: '#3e6b8f',
};
const instLabel: React.CSSProperties = { fontSize: 15, fontWeight: 700, margin: '2px 0 6px' };
const mandateBox: React.CSSProperties = { background: '#eef3f7', borderRadius: 8, padding: '7px 9px' };
const mandateHead: React.CSSProperties = { fontSize: 10.5, color: 'var(--color-neutral-600)' };
const srcLink: React.CSSProperties = { color: '#3e6b8f' };
const mission: React.CSSProperties = { fontSize: 12, fontStyle: 'italic', lineHeight: 1.45, marginTop: 3 };
const instComment: React.CSSProperties = { fontSize: 12.5, lineHeight: 1.5, marginTop: 7 };
const citesHead: React.CSSProperties = {
  fontSize: 10, letterSpacing: '.05em', textTransform: 'uppercase', color: '#9aa0a6', marginTop: 8,
};
const citeBox: React.CSSProperties = { borderLeft: '2px solid #d7dbe0', padding: '3px 0 3px 8px', marginTop: 4 };
const citeText: React.CSSProperties = { fontSize: 12.5, fontVariantNumeric: 'tabular-nums' };
const citeNote: React.CSSProperties = { fontSize: 10.5, fontStyle: 'italic', color: 'var(--color-neutral-600)' };
const disclaimerBox: React.CSSProperties = {
  color: '#8a6d1a', background: '#fdf6e3', borderRadius: 8, padding: '6px 8px', fontSize: 11.5,
  marginTop: 8, lineHeight: 1.45,
};
const silentCard: React.CSSProperties = {
  border: '1px dashed var(--color-divider)', padding: '7px 10px', background: 'transparent',
};
const silentLabel: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: 'var(--color-neutral-700)' };
const silentReason: React.CSSProperties = { fontSize: 11.5, color: 'var(--color-neutral-600)', marginTop: 2 };
