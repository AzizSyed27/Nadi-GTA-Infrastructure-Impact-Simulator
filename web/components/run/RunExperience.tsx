'use client';

/**
 * V2.7b C8b — ACT I: the physics, narrated while it happens.
 *
 * A run used to be a progress chip. Everything the tool actually does — the demand loading, the
 * baseline morning finishing, the change going in and coming back out with the restoration PROVED —
 * happened invisibly behind the word "analysis". This surface is that work, said out loud.
 *
 * THE COPY IS NOT WRITTEN HERE. Every beat's title and detail arrive on the event, composed
 * server-side in `scenario_harness.Beats` from the mechanism each one reports — beat 4's sentence is
 * derived from `change_scheduler.assert_restored` and is pytest-pinned against the overclaim the
 * mockup invited ("checked edge by edge"). This component renders those strings verbatim. Restating
 * them here would create a second source for the one sentence in the product that must not drift.
 *
 * WHAT THIS COMPONENT MAY SAY ON ITS OWN is only what is structurally true of the screen: which leg
 * the map is playing, and that the results are readable. Both are spec-pinned below.
 */

import { memo, useCallback, useMemo, useState } from 'react';

import type { RunFeedState } from '@/lib/runFeed';
import { fmtSimTime } from '@/lib/simTime';

/** THE MAP CAPTION — spec-pinned verbatim. The map is playing a RECORDED baseline leg while the
 *  scenario leg computes; saying anything vaguer would let a reader believe they are watching their
 *  change happen. They are not, and the sentence says so twice: once about the leg, once about the
 *  ghosted outline. */
export const CAPTION_HEAD = 'MAP SHOWS: BASELINE LEG (RECORDED)';
export const CAPTION_BODY =
  'The scenario leg is computing about a half-step behind and is never rendered live. Your change ' +
  'appears here only as the ghosted outline — it does not affect what is playing.';
export const GHOST_LABEL = 'YOUR MEMBER — APPLIES TO THE SCENARIO LEG, NOT THIS PLAYBACK';

/** The honest alternative when there is nothing to play. Calibrated runs free the baseline spill
 *  mid-run to stay memory-bounded, so there are no trajectories — an empty map with no explanation
 *  would read as a failure of a run that is working perfectly. */
export const NO_BASELINE_HEAD = 'MAP SHOWS: THE NETWORK ONLY';

/** And the state BEFORE either answer exists: the baseline leg is still being simulated, so there
 *  is nothing to play and no reason yet to say there won't be. A statement about the screen's own
 *  state — the one kind of sentence this component is allowed to compose itself. */
export const PENDING_BASELINE =
  'The baseline leg is still being simulated — playback begins here when it lands. The beats below ' +
  'are live.';

export const RESULTS_BAND_NOTE =
  'computed by the simulator in Act I, no AI — read now';

const wallClock = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const RunExperience = memo(function RunExperience({
  experience,
  demandProfile,
  playing,
  simTime,
  onReadResults,
}: {
  experience: RunFeedState;
  demandProfile: string | undefined;
  /** Is baseline traffic ACTUALLY on the map right now. Deliberately not derived from
   *  `baselineUrl`: the url arrives an instant before the artifact does, and a caption that keys on
   *  the event rather than on the screen claims playback during the fetch. The caption describes
   *  what a reader can see. */
  playing: boolean;
  /** The playback clock in WHOLE sim-seconds. The caller quantizes and this component is memo'd, so
   *  Act I's panels re-render when the displayed second changes and not on every rAF tick — the map
   *  owns that budget (the V2.5c trails-identity lesson, one surface over). `onReadResults` must be
   *  a stable callback or the memo can never bail. */
  simTime: number;
  onReadResults: () => void;
}) {
  const { beats, baselineUnavailable, resultsReadyAt } = experience;

  return (
    <>
      <div className="nadi-shell" style={captionWrap} data-testid="act-one-caption">
        <div style={captionHead}>
          {playing
            ? `${CAPTION_HEAD} · sim-time ${fmtSimTime(simTime, demandProfile)}`
            : NO_BASELINE_HEAD}
        </div>
        <div style={captionBody}>
          {playing ? CAPTION_BODY : (baselineUnavailable ?? PENDING_BASELINE)}
        </div>
        {playing && <div style={ghostLabel} data-testid="act-one-ghost-label">{GHOST_LABEL}</div>}
      </div>

      <div className="nadi-shell" style={ledgerWrap} data-testid="act-one-ledger">
        <div style={ledgerHead}>THE RUN, AS IT HAPPENS</div>
        {beats.length === 0 && (
          <div style={ledgerWaiting} data-testid="act-one-waiting">
            the physics is starting — the first beat lands when the demand is loaded
          </div>
        )}
        {beats.map((b) => (
          <div key={b.n} style={beatRow} data-testid="act-one-beat" data-beat={b.key}>
            <div style={beatTop}>
              <span style={beatNum}>{String(b.n).padStart(2, '0')}</span>
              <span style={beatTitle}>{b.title}</span>
              <span style={beatClock}>{wallClock(b.ts)}</span>
            </div>
            <div style={beatDetail}>{b.detail}</div>
          </div>
        ))}
      </div>

      {resultsReadyAt != null && (
        <div className="nadi-shell" style={bandWrap} data-testid="results-band">
          <span style={bandLead}>RESULTS — COMPLETE SINCE {wallClock(resultsReadyAt)}</span>
          <span style={bandNote}>· {RESULTS_BAND_NOTE}</span>
          <button className="btn btn-secondary" style={bandBtn} onClick={onReadResults}
                  data-testid="results-band-read">
            Read the results
          </button>
        </div>
      )}
    </>
  );
});

/**
 * THE HELD MOMENT — the cleanup, proved rather than asserted.
 *
 * It opens when the physics finishes and holds until dismissed, while interpretation streams below:
 * a MOMENT, not a gate (the ratified decision). Its checklist is beats 3 and 4 rendered verbatim,
 * for the reason in this file's header — the sentence about what was verified has exactly one
 * author, and it is the code that did the verifying.
 *
 * Shown once per run (remembered in localStorage): re-interrupting on every reload mid-Act-II would
 * make a moment into a nuisance. It never appears for a finished run at all, because beats come only
 * from the events file and a terminal run opens no stream.
 */
export const HELD_LEAD_VERIFIED = 'The tool proved the cleanup rather than asserting it:';
export const HELD_LEAD_PLAIN = 'What this run did with your change:';
export const HELD_SEALED =
  'both legs finished and this run’s record was written — the numbers below cannot change now';

export function HeldMoment({
  experience,
  onDismiss,
  onReadResults,
}: {
  experience: RunFeedState;
  onDismiss: () => void;
  onReadResults: () => void;
}) {
  const applied = experience.beats.find((b) => b.key === 'applied');
  const reverted = experience.beats.find((b) => b.key === 'reverted');
  if (!reverted) return null;

  // THE ✓ IS EARNED BY AN ASSERTION, NOT BY A BEAT EXISTING. A run that withdrew a change carries
  // `change_scheduler`'s restoration verdict; the honest variants (a drawn road, an unwindowed
  // change, a window that never fired) carry none, because there was no withdrawal to verify. Their
  // sentence still renders — it is true and it is the run's own account — but unticked, and the
  // lead-in stops claiming a proof. This screen's whole worth is that its checks mean something.
  const verified = reverted.restoredOk === true;

  return (
    <div className="nadi-shell" style={heldBackdrop} data-testid="held-moment">
      <section className="blueprint" style={heldPanel}>
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <div style={heldKicker}>BEAT {reverted.n} OF 4 · {wallClock(reverted.ts)}</div>
        <h3 style={heldTitle}>{reverted.title}</h3>
        <div style={heldLead}>{verified ? HELD_LEAD_VERIFIED : HELD_LEAD_PLAIN}</div>
        <ul style={heldList} data-testid="held-checklist">
          {applied && (
            <li style={heldItem} data-testid="held-applied">
              <span style={heldMark}>·</span>
              <span>
                <b>{applied.title}</b> — {applied.detail}
              </span>
            </li>
          )}
          <li style={heldItem} data-testid="held-reverted">
            <span style={heldMark}>{verified ? '✓' : '·'}</span>
            <span>{reverted.detail}</span>
          </li>
          <li style={heldItem} data-testid="held-sealed">
            <span style={heldMark}>✓</span>
            <span>{HELD_SEALED}</span>
          </li>
        </ul>
        <div style={heldFooter}>
          <button className="btn btn-primary" onClick={onReadResults} data-testid="held-read">
            Read the results — they’re ready
          </button>
          <button className="btn btn-secondary" onClick={onDismiss} data-testid="held-dismiss">
            Keep watching
          </button>
        </div>
        <div style={heldNote} data-testid="held-note">
          Interpretation is already underway below — this panel is a moment, not a gate. Nothing is
          waiting on you.
        </div>
      </section>
    </div>
  );
}

/** Has this run's held moment already been seen? Remembered per run so a reload does not
 *  re-interrupt. Storage can throw (private windows, blocked site data) — a throw means "show it",
 *  which is the harmless direction. */
export function useHeldMomentSeen(runId: string | null): [boolean, () => void] {
  // The stored answer is DERIVED, not synchronized into state: an effect that setStates on runId
  // change would render the moment for one frame before hiding it again, and MapView is ssr:false,
  // so reading storage while rendering is safe here.
  const stored = useMemo(() => {
    if (!runId) return false;
    try {
      return window.localStorage.getItem(`nadi:heldSeen:${runId}`) === '1';
    } catch {
      return false; // storage blocked → show it, which is the harmless direction
    }
  }, [runId]);
  const [markedRun, setMarkedRun] = useState<string | null>(null);
  const markSeen = useCallback(() => {
    setMarkedRun(runId);
    try {
      if (runId) window.localStorage.setItem(`nadi:heldSeen:${runId}`, '1');
    } catch {
      /* a viewer who blocks storage simply sees it again next reload */
    }
  }, [runId]);
  return [stored || (runId != null && markedRun === runId), markSeen];
}

// ------------------------------------------------------------------------------------- styles

const captionWrap: React.CSSProperties = {
  position: 'absolute', top: 68, left: '50%', transform: 'translateX(-50%)',
  maxWidth: 560, zIndex: 22, background: 'var(--color-bg)',
  border: '1px solid var(--color-divider)', padding: '10px 16px',
  fontFamily: 'var(--font-body)', color: 'var(--color-text)',
};
const captionHead: React.CSSProperties = {
  fontFamily: 'var(--font-heading)', fontSize: 12.5, letterSpacing: '.08em', fontWeight: 600,
};
const captionBody: React.CSSProperties = {
  fontSize: 12.5, lineHeight: 1.5, color: 'var(--color-neutral-700)', marginTop: 4,
};
const ghostLabel: React.CSSProperties = {
  fontSize: 10.5, letterSpacing: '.06em', color: 'var(--color-neutral-600)', marginTop: 6,
};

const ledgerWrap: React.CSSProperties = {
  position: 'absolute', top: 70, right: 16, width: 340, zIndex: 20,
  background: 'var(--color-bg)', border: '1px solid var(--color-divider)',
  padding: '12px 14px', maxHeight: 'calc(100vh - 200px)', overflowY: 'auto',
  fontFamily: 'var(--font-body)', color: 'var(--color-text)',
};
const ledgerHead: React.CSSProperties = {
  fontFamily: 'var(--font-heading)', fontSize: 12, letterSpacing: '.1em', fontWeight: 600,
  color: 'var(--color-neutral-700)', marginBottom: 10,
};
const ledgerWaiting: React.CSSProperties = {
  fontSize: 12.5, color: 'var(--color-neutral-600)', lineHeight: 1.5,
};
const beatRow: React.CSSProperties = {
  borderTop: '1px solid var(--color-divider)', padding: '9px 0',
};
const beatTop: React.CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 8 };
const beatNum: React.CSSProperties = {
  fontFamily: 'var(--font-heading)', fontSize: 11, color: 'var(--color-accent-700)',
};
const beatTitle: React.CSSProperties = {
  fontFamily: 'var(--font-heading)', fontSize: 13, fontWeight: 600, flex: 1,
};
const beatClock: React.CSSProperties = { fontSize: 10.5, color: 'var(--color-neutral-600)' };
const beatDetail: React.CSSProperties = {
  fontSize: 12, lineHeight: 1.5, color: 'var(--color-neutral-700)', marginTop: 3,
};

const bandWrap: React.CSSProperties = {
  position: 'absolute', bottom: 92, left: 16, zIndex: 22, display: 'flex',
  alignItems: 'center', gap: 8, background: 'var(--color-bg)',
  border: '1px solid var(--color-accent)', padding: '8px 12px',
  fontFamily: 'var(--font-body)', fontSize: 12,
};
const bandLead: React.CSSProperties = {
  fontFamily: 'var(--font-heading)', fontWeight: 600, letterSpacing: '.05em',
  color: 'var(--color-accent-700)',
};
const bandNote: React.CSSProperties = { color: 'var(--color-neutral-700)' };
const bandBtn: React.CSSProperties = { marginLeft: 6 };

const heldBackdrop: React.CSSProperties = {
  position: 'absolute', inset: 0, zIndex: 40, display: 'grid', placeItems: 'center',
  // A flat dark scrim rather than a tint of --color-text, so the contrast doesn't move if that
  // token's lightness does. MEASURED at this value (sampled off the rendered frame, because the
  // eye reads legible dark text as an undimmed panel): everything behind lands near (110,112,115)
  // against the panel's (242,242,243) — map, header and rail dimmed alike, panel plainly the
  // thing being read.
  background: 'rgba(18, 20, 26, 0.58)',
};
const heldPanel: React.CSSProperties = {
  width: 'min(620px, 86vw)', background: 'var(--color-bg)', padding: '22px 26px',
  fontFamily: 'var(--font-body)', color: 'var(--color-text)', boxShadow: 'var(--shadow-lg)',
};
const heldKicker: React.CSSProperties = {
  fontFamily: 'var(--font-heading)', fontSize: 11, letterSpacing: '.1em',
  color: 'var(--color-neutral-600)',
};
const heldTitle: React.CSSProperties = {
  fontFamily: 'var(--font-heading)', fontSize: 26, fontWeight: 600, margin: '6px 0 10px',
};
const heldLead: React.CSSProperties = { fontSize: 13.5, color: 'var(--color-neutral-700)' };
const heldList: React.CSSProperties = { listStyle: 'none', padding: 0, margin: '10px 0 0' };
const heldItem: React.CSSProperties = {
  fontSize: 13, lineHeight: 1.6, padding: '7px 0', display: 'flex', gap: 8,
  borderTop: '1px solid var(--color-divider)',
};
const heldMark: React.CSSProperties = {
  color: 'var(--color-accent-700)', flex: '0 0 auto', width: 12,
};
const heldFooter: React.CSSProperties = { display: 'flex', gap: 10, marginTop: 18 };
const heldNote: React.CSSProperties = {
  fontSize: 11.5, color: 'var(--color-neutral-600)', marginTop: 12, lineHeight: 1.5,
};
