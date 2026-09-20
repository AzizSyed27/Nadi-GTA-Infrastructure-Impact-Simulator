'use client';

import { nonCompletionsLine } from '@/lib/nonCompletions';
import { useCallback, useEffect, useState } from 'react';
import { getProjection, postEnrich, postIdentity, type EnrichStage, type RunStatus, type StageProjection } from '@/lib/api';
import { DEMO_READONLY_NOTE, STATIC_DEMO } from '@/lib/demo';
import type { RunFeed } from '@/lib/useRunFeed';
import { signedMinutes } from '@/lib/viz';
import { fmtWindowRange } from '@/lib/simTime';

// The staged progression (matches scenario_harness run-state writes). A new_road run patches the network first
// (regen); runtime changes (speed_limit / bike_lane) apply live, so they have NO regen stage — the card renders
// only the stages the run actually has. Enrich stages ('enrich:voices' etc.) are shown separately below.
const NEWROAD_STAGES = ['queued', 'regen', 'baseline', 'scenario', 'analysis', 'done'] as const;
const RUNTIME_STAGES = ['queued', 'baseline', 'scenario', 'analysis', 'done'] as const;
const STAGE_LABEL: Record<string, string> = {
  queued: 'Queued',
  regen: 'Regenerating network',
  settle_baseline: 'Settling baseline',
  settle_scenario: 'Settling scenario',
  baseline: 'Baseline run',
  scenario: 'Scenario run',
  analysis: 'Analysis',
  done: 'Done',
};
// V2.1c: settled runs iterate assignment BEFORE the micro pair — the settle stages appear on the rail
// only when the run's assignment is 'settled' (day-one rails are byte-identical to before).
const SETTLE_STAGES = ['settle_baseline', 'settle_scenario'] as const;

// The enrich buttons. V2.7d FOLLOW-UP — NO COST LITERAL SURVIVES HERE. The prices were V2.3-era
// literals ("~1¢" beside an enrich that meters ~213 calls; "$" on a button that also rebuilds the
// chat index, the single largest metered term) under a comment claiming they were "pulled from the
// metered actuals". Each button's price now comes from `GET /api/projection`'s per-stage terms —
// the same function the manual enrich writes into the ledger, so the number a reader consents to
// on the button and the denominator the cost line later divides by can never come from two
// formulas — or it renders NO price: a missing number is a missing number, never an invented one.
// The unit is model calls (the projection's), not money: no per-call price exists in this repo.
const ENRICH: { stage: EnrichStage; label: string; tip: string }[] = [
  { stage: 'voices', label: 'voices', tip: 'Sample persona reactions.' },
  { stage: 'report', label: 'report', tip: 'Generate the per-run report and rebuild the chat index.' },
  { stage: 'discourse', label: 'discourse', tip: 'Run the 3-cascade social propagation.' },
];


/**
 * Renders one run's staged pipeline, then offers enrichment. One job at a time is enforced
 * server-side; a 409 on an enrich click surfaces inline.
 *
 * V2.7b C3 — this card no longer OWNS the run's machinery. The status poll and the SSE stream moved
 * to `useRunFeed`, held by MapView, because the card mounts only in Build and the run experience has
 * to watch the same run from Watch. Everything the card shows still comes from that one feed, so the
 * numbers on this card and the numbers in the experience can never disagree: there is one poll.
 *
 * The V2.3a stream behavior is unchanged and still lives behind the feed: live counts
 * ("voices 47/212") replace dead air, per-voice events flow to the artifact so the comment feed
 * renders incrementally, the poll remains the backstop, and if the stream dies for good a labeled
 * note says so while the polled `enrich_progress` carries the counts.
 */
export function RunCard({
  runId,
  feed,
  onClone,
}: {
  runId: string;
  /** V2.7b C3 — the status poll and the event stream now live in MapView's useRunFeed, so they
   *  outlive this card: the run experience watches the same run from Watch, and a stage switch no
   *  longer silently stops the machinery narrating a live run. The card renders the feed and owns
   *  only its own UI state (which button is busy, whether the rename form is open). */
  feed: RunFeed;
  onClone?: (st: RunStatus) => void; // V2.4c - clone this run's changes[] into a fresh draft
}) {
  const { status, notFound, streamProgress, streamDegraded, enrichLaunched, mergeStatus } = feed;
  const [enrichBusy, setEnrichBusy] = useState<EnrichStage | null>(null);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  // The buttons' prices — the SERVER's per-stage projections, fetched once per mount (a property of
  // the server's configuration, not of the run). `armed` is deliberately NOT consulted: it is the
  // CHAIN's switch, and these buttons spend regardless of it. Unreachable or shapeless → no price.
  const [stageCosts, setStageCosts] = useState<Partial<Record<EnrichStage, StageProjection>> | null>(null);
  useEffect(() => {
    if (STATIC_DEMO) return; // the demo has no API, and the buttons are disabled there anyway
    void getProjection().then((r) => setStageCosts(r.ok ? (r.value.stages ?? null) : null));
  }, []);
  // V2.4c - the identity (name/note) edit affordance
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [identityBusy, setIdentityBusy] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);

  // Clear the busy button on done OR failed - else the buttons stay stuck disabled (B1). The poll
  // used to do this inline; reading it off the polled status keeps the behavior identical.
  // EDGE-TRIGGERED, and it has to be: a plain `terminal ? null : busy` derivation would un-disable
  // the buttons for the whole in-flight window of an enrich fired ON a finished run (the common
  // case), re-opening the double-click it exists to prevent. React's documented "adjusting state
  // when a prop changes" gives the same edge without an effect, one render pass earlier.
  const terminal = status?.status === 'done' || status?.status === 'failed';
  const [prevTerminal, setPrevTerminal] = useState(terminal);
  if (terminal !== prevTerminal) {
    setPrevTerminal(terminal);
    if (terminal) setEnrichBusy(null);
  }

  const runEnrich = useCallback(
    async (stage: EnrichStage) => {
      setEnrichError(null);
      setEnrichBusy(stage);
      const res = await postEnrich(runId, stage);
      if (!res.ok) {
        setEnrichBusy(null);
        setEnrichError(res.error);
        return;
      }
      enrichLaunched(stage);
    },
    [runId, enrichLaunched],
  );

  if (notFound && !status) {
    return (
      <div className="ed-card" data-testid="run-card">
        <div className="ed-title">Run not found</div>
        <div className="ed-sub">{runId}</div>
      </div>
    );
  }

  const stage = status?.stage ?? 'queued';
  const failed = status?.status === 'failed';
  const done = status?.stage === 'done';
  // V2.4b: composites carry `changes` (plural) in run-state; the singular `change` (= members[0],
  // the back-compat field) is only trustworthy alone on single-change runs.
  const members = status?.changes ?? (status?.change ? [status.change] : []);
  const isNewRoad = members[0]?.type === 'new_road';

  // V2.3a — live enrich progress: stream counts while it's up; the polled derivation once degraded.
  // Counts ("47/212") beat the sub-command label; the label alone covers report/discourse.
  const enriching = (status?.stage ?? '').startsWith('enrich:');
  const prog = streamDegraded ? status?.enrich_progress : (streamProgress ?? status?.enrich_progress);
  const enrichProgressText =
    prog?.total != null ? `${prog.done ?? 0}/${prog.total}` : (prog?.label ?? '');
  const baseStages: readonly string[] = isNewRoad ? NEWROAD_STAGES : RUNTIME_STAGES; // runtime: NO regen
  const STAGES =
    status?.assignment === 'settled'
      ? [...baseStages.slice(0, baseStages.indexOf('baseline')), ...SETTLE_STAGES,
         ...baseStages.slice(baseStages.indexOf('baseline'))]
      : baseStages;
  const activeIdx = STAGES.indexOf(stage);

  // THE number, framed honestly: for a runtime lane/speed change 0-reroute is expected — cars absorb it as
  // delay, not detour (the 2.2 finding) — so surface the car delay alongside so 0 doesn't read as failure.
  const rer = status?.cars_rerouted ?? 0;
  const rerouteLabel = isNewRoad
    ? `${rer} ${rer === 1 ? 'car' : 'cars'} rerouted onto the new road`
    : rer === 0
      ? '0 rerouted — absorbed as delay'
      : `${rer} ${rer === 1 ? 'car' : 'cars'} rerouted`;
  const cm = status?.car_median_delta_s;
  const cs = status?.car_affected_share;
  const carDelay =
    cm != null ? `car median ${signedMinutes(cm)}${cs != null ? ` · ${Math.round(cs * 100)}% materially affected` : ''}` : null;

  const demandChip =
    status?.demand_profile === 'calibrated_am_peak'
      ? 'calibrated AM peak (07:00–09:00, count-anchored)'
      : status?.demand_profile === 'synthetic_demo'
        ? 'synthetic demo demand'
        : null;

  // V2.2d — the school-zone chip (composite runs tagged school_zone): street count + the shared
  // window range. Mechanical, no asserted benefit. Falls back silently for untagged runs.
  const zoneChanges = (status?.tags?.includes('school_zone') && status?.changes) || [];
  const zoneWindows = zoneChanges
    .map((c) => c.window)
    .filter((w): w is { start_s: number; end_s: number } => w != null);
  const zoneChip = zoneChanges.length
    ? `School zone · ${zoneChanges.length} street${zoneChanges.length === 1 ? '' : 's'}${
        zoneWindows.length
          ? ` · ${fmtWindowRange(
              {
                start_s: Math.min(...zoneWindows.map((w) => w.start_s)),
                end_s: Math.max(...zoneWindows.map((w) => w.end_s)),
              },
              status?.demand_profile,
            )}`
          : ''
      }`
    : null;

  // V2.2c — the windowed-change chip ("2 lane(s) closed 07:15–09:00"), mechanical from the change
  // dict + the run's demand profile (clock times on calibrated, t=0 == 07:00). V2.4b: SINGLE-change
  // runs only — describing an N-member composite by member 0 silently misrepresented the run.
  const chWindow = members[0]?.window as { start_s: number; end_s: number } | undefined;
  const chType = members[0]?.type;
  const chLanes = (members[0]?.target_lanes as number[] | undefined)?.length ?? 0;
  const chEffect = members[0]?.effect as { blocked?: boolean; speed_factor?: number } | undefined;
  const windowChip = members.length === 1 && chWindow
    ? chType === 'lane_closure'
      ? `${chLanes} lane(s) closed ${fmtWindowRange(chWindow, status?.demand_profile)}`
      : chType === 'road_closure'
        ? `road closed ${fmtWindowRange(chWindow, status?.demand_profile)}`
        : chType === 'incident'
          ? `incident ${fmtWindowRange(chWindow, status?.demand_profile)}${chEffect?.blocked ? ` · ${chLanes} lane(s) blocked` : ''}${chEffect?.speed_factor != null ? ` · slowed to ${Math.round(chEffect.speed_factor * 100)}%` : ''}`
          : `active ${fmtWindowRange(chWindow, status?.demand_profile)}`
    : null;

  // V2.4b — the untagged-composite chip: member count + the SPANNING active window. Mechanical;
  // the per-member truth lives in the report/ScenarioHeader. Zone-tagged runs keep their zone chip.
  const memberWindows = members
    .map((c) => c.window as { start_s: number; end_s: number } | undefined)
    .filter((w): w is { start_s: number; end_s: number } => w != null);
  const compositeChip =
    members.length > 1
      ? `${members.length} changes${
          memberWindows.length
            ? ` · active ${fmtWindowRange(
                { start_s: Math.min(...memberWindows.map((w) => w.start_s)),
                  end_s: Math.max(...memberWindows.map((w) => w.end_s)) },
                status?.demand_profile,
              )}`
            : ''
        }`
      : null;

  // V2.2c — non-completions as a first-class number for capacity runs; the split's labels are
  // causally NEUTRAL ("not inserted"). Per-MODE and skip-zero (mirrors report.py): never hardcode
  // cars — a closure whose whole impact lands on pedestrians must not read "0 cars did not
  // complete". V2.4b: the backlog-attribution parenthetical now rides HERE too (user-ratified —
  // the V2.2c chip exemption ends; the split never renders without the attribution, any surface).
  // V2.7a: the sentence is composed by lib/nonCompletions.ts (shared with the run document;
  // the toHaveText pins ride the shared composer).
  const ncLine = nonCompletionsLine(
    status?.non_completions,
    status?.non_completions_split,
    status?.insertion_backlog,
  );

  // V2.2b/V2.5b — the emergency-response fact (capacity runs), SHAPE-KEYED. Members shape: ends
  // are the counted noun (E excludes no_approach / all-baseline-unreachable ends — not
  // window-caused; an end is unreachable iff NO station reaches it during the window). Legacy
  // probes shape keeps today's exact strings; both render the two honesty sentences under the
  // chip (never tooltip-only). The two shapes measure DIFFERENT things — never compare across.
  const rd = status?.response_detour;
  const rdEnds = (rd?.members ?? []).flatMap((m) =>
    (m.ends ?? []).filter((e) => !e.status && (e.probes ?? []).some((p) => p.baseline_s != null)),
  );
  const rdEndNumeric = rdEnds.flatMap((e) => e.probes ?? []).filter((p) => p.added_s != null);
  const rdUnreachableEnds = rdEnds.filter((e) => !(e.probes ?? []).some((p) => p.added_s != null));
  // legacy shape — "not computable" is deliberately cause-neutral; the report carries the
  // per-probe reason. Hardened (`?.probes?.`): a members payload carries no probes array.
  const rdComputable = rd?.probes?.filter((p) => p.added_s != null) ?? [];
  const rdNoNumber = rd?.probes?.filter((p) => p.added_s == null) ?? [];
  const rdWorst = rdComputable.length ? Math.max(...rdComputable.map((p) => p.added_s as number)) : null;
  // The single number is the MAX and says so — with several stations and a mixed spread, an
  // unlabeled number reads as "the added response time" or an average. Old sidecars without
  // `represents` fall back to "probes".
  const rdProbes = rd?.probes ?? [];
  const rdNoun = rdProbes.length && rdProbes.every((p) => p.represents === 'fire_station') ? 'stations' : 'probes';
  const responseLine = rd?.members
    ? rdEndNumeric.length
      ? `${
          rdUnreachableEnds.length
            ? `${rdUnreachableEnds.length} of ${rdEnds.length} segment ends unreachable`
            : `all ${rdEnds.length} segment ends reachable`
        } · worst +${Math.max(...rdEndNumeric.map((p) => p.added_s as number)).toFixed(0)} s (${
          rd.members.length
        } segment${rd.members.length === 1 ? '' : 's'} × ${rd.origins?.length ?? 0} stations) — see the report`
      : 'no segment end reachable from any station during the window — see the report'
    : rd
      ? rdWorst != null
        ? `worst of ${rdProbes.length} ${rdNoun}: +${rdWorst.toFixed(0)} s${
            rdNoNumber.length ? ` (${rdNoNumber.length} not computable — see the report)` : ''
          }`
        : rdNoNumber.length
          ? `response route not computable from any of the ${rdProbes.length} ${rdNoun} — see the report`
          : rd.destination_note ?? 'response detour not computable — see the report'
      : null;

  // V2.4c — save the identity; on success MERGE the response into local status (the poll loop has
  // STOPPED on a terminal run and would never repaint the name otherwise). Errors render verbatim
  // (the pinned 403 reason included). All name/note rendering is React text nodes — injection-inert.
  const saveIdentity = async () => {
    setIdentityBusy(true);
    setIdentityError(null);
    const res = await postIdentity(runId, { name: nameInput, note: noteInput });
    setIdentityBusy(false);
    if (!res.ok) {
      setIdentityError(res.error);
      return;
    }
    mergeStatus({ name: res.value.name, note: res.value.note });
    setEditingIdentity(false);
  };

  return (
    <div className="ed-card" data-testid="run-card">
      <div className="ed-title">{done ? 'Run complete' : failed ? 'Run failed' : 'Running…'}</div>
      {status?.name && !editingIdentity && (
        <div className="ed-run-name" data-testid="run-name">
          {status.name}
        </div>
      )}
      <div className="ed-sub">{status?.description || runId}</div>
      {status?.note && !editingIdentity && (
        <div className="ed-sub" style={{ whiteSpace: 'pre-wrap' }} data-testid="run-note">
          {status.note}
        </div>
      )}
      {status && !editingIdentity && (
        <button
          className="ed-link ed-sub"
          data-testid="rename-toggle"
          onClick={() => {
            setNameInput(status.name ?? '');
            setNoteInput(status.note ?? '');
            setIdentityError(null);
            setEditingIdentity(true);
          }}
        >
          {status.name || status.note ? 'rename' : 'name this run'}
        </button>
      )}
      {editingIdentity && (
        <div data-testid="identity-form" className="ed-window">
          <input
            className="ed-input ed-wide"
            value={nameInput}
            maxLength={60}
            placeholder="name (optional)"
            onChange={(e) => setNameInput(e.target.value)}
            data-testid="name-input"
          />
          <textarea
            className="ed-input ed-wide"
            style={{ resize: 'vertical' }}
            value={noteInput}
            maxLength={500}
            rows={2}
            placeholder="note (optional)"
            onChange={(e) => setNoteInput(e.target.value)}
            data-testid="note-input"
          />
          <div className="ed-actions">
            <button className="btn btn-secondary" disabled={identityBusy} onClick={saveIdentity} data-testid="identity-save">
              Save
            </button>
            <button className="ed-link" onClick={() => setEditingIdentity(false)} data-testid="identity-cancel">
              cancel
            </button>
          </div>
          {identityError && (
            <div className="ed-warn" data-testid="identity-error">
              {identityError}
            </div>
          )}
        </div>
      )}
      {demandChip && (
        <div className="ed-sub" data-testid="demand-chip">
          demand: {demandChip}
        </div>
      )}
      {status?.demand_profile === 'calibrated_am_peak' && (
        <div className="ed-sub" data-testid="comparison-validity-chip">
          absolute volumes approximate · scenario-vs-baseline is like-for-like
        </div>
      )}
      {status?.assignment === 'settled' && (
        <div className="ed-sub" data-testid="assignment-chip">
          settled response (iterated assignment, drivers only)
          {stage.startsWith('settle') && status?.detail ? ` — ${status.detail}` : ''}
        </div>
      )}
      {zoneChip && (
        <div className="ed-sub" data-testid="zone-chip">
          {zoneChip}
        </div>
      )}
      {/* the zone chip already carries the composite's window range — the untagged composite
          chip and the single-change window chip each cover their own shape */}
      {compositeChip && !zoneChip && (
        <div className="ed-sub" data-testid="composite-chip">
          {compositeChip}
        </div>
      )}
      {windowChip && !zoneChip && (
        <div className="ed-sub" data-testid="window-chip">
          {windowChip}
        </div>
      )}
      {(status?.n_seeds ?? 1) > 1 && (
        <div className="ed-sub" data-testid="seeds-chip">
          robustness probe: {status?.n_seeds} seeds (42, 43, 44)
          {(stage === 'baseline' || stage === 'scenario') && status?.detail?.startsWith('seed probe')
            ? ` — ${status.detail}`
            : ''}
        </div>
      )}

      {/* staged rail — only the stages this run actually has (runtime changes skip regen) */}
      <ol className="ed-stages" data-testid="run-stages">
        {STAGES.map((s, i) => {
          const state = failed ? 'idle' : i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'idle';
          return (
            <li key={s} className="ed-stage" data-stage={s} data-state={state}>
              <span className="ed-dot" />
              {STAGE_LABEL[s]}
            </li>
          );
        })}
      </ol>

      {enriching && (
        <div className="ed-winlabel" data-testid="enrich-running">
          Enriching: {stage.replace('enrich:', '')}…{enrichProgressText ? ` ${enrichProgressText}` : ''}
        </div>
      )}
      {enriching && streamDegraded && (
        <div className="ed-sub" data-testid="enrich-stream-degraded">
          live stream unavailable — updating by poll
        </div>
      )}
      {failed && <div className="ed-warn" data-testid="run-failed">{status?.detail || 'the run failed'}</div>}

      {done && (
        <>
          <div className="ed-number" data-testid="reroute-number">{rerouteLabel}</div>
          {carDelay && <div className="ed-hint" data-testid="car-delay">{carDelay}</div>}
          {ncLine && (
            <div className="ed-hint" data-testid="non-completions">{ncLine}</div>
          )}
          {responseLine && rd && (
            <div className="ed-sub" data-testid="response-access-chip">
              response access: {responseLine}
              <div className="ed-sub-note">
                {rd.framing}; {rd.lower_bound_note}
              </div>
            </div>
          )}
          <div className="ed-label">Enrich this run</div>
          <div className="ed-btnrow" data-testid="enrich-buttons">
            {ENRICH.map((e) => {
              const cost = stageCosts?.[e.stage];
              return (
                <button
                  key={e.stage}
                  className="btn btn-secondary"
                  title={STATIC_DEMO ? DEMO_READONLY_NOTE : e.tip}
                  // V2.7f C4 — unreachable in the demo once Build is locked end to end, gated
                  // for the rule's sake: a clickable-then-failing POST is the thing the demo refuses
                  disabled={enrichBusy !== null || STATIC_DEMO}
                  onClick={() => runEnrich(e.stage)}
                  data-testid={`enrich-${e.stage}`}
                >
                  {e.label}
                  {cost != null && cost.calls > 0 && (
                    <>
                      {' '}
                      <span className="ed-cost" title={cost.basis} data-testid={`enrich-cost-${e.stage}`}>
                        ~{cost.calls.toLocaleString()} calls
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          {enrichError && <div className="ed-warn" data-testid="enrich-error">{enrichError}</div>}
          {/* V2.4c — clone this run's changes[] into a fresh draft (D4: iterate by adjusting the
              thing that almost worked; name/note never copied — a new scenario earns its own) */}
          {members.length > 0 && onClone && status && (
            <button
              className="btn btn-secondary ed-mt"
              onClick={() => onClone(status)}
              data-testid="clone-to-draft"
            >
              ⧉ Clone to draft
            </button>
          )}
        </>
      )}
    </div>
  );
}

// V2.7d C8b — every look lives in app/nadi.css under `.nadi-shell .ed-*` / `.btn` (the rail carries the class).
