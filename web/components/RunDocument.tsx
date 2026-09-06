'use client';

// V2.7a C3 — the RUN DOCUMENT: the Read stage's surface, replacing the old report drawer.
// Composition rule (the numbers-code-rendered / prose-audited split, shaping the page):
//   * the spec table and section 2.4 render from the ARTIFACT (changesOf + artifact.scorecard —
//     never the report's generation-time snapshot);
//   * stat callouts render from the report's CODE-DERIVED facts block (V2.7a C1) — numbers are
//     never parsed out of markdown;
//   * narrative prose comes ONLY from the report's EXISTING audited LLM slots (abstract =
//     what_tested.framing; per-group sentences = who_affected.glosses; syntheses; caveat intro) —
//     no prose is authored client-side beyond mechanical evidence text (the ScorecardPanel/chip
//     precedent), and no new LLM surface exists;
//   * every honesty sentence that rides a payload (detour notes, zone locks, the non-completions
//     attribution parenthetical, the scope disclosure) renders VERBATIM beside its numbers.
// Degradation is LABELED: no report → the artifact-derived sections + report-missing; a report
// for another run → report-mismatch (never silently render another run's report).

import { useState } from 'react';
import type { Agent, TrajectoryArtifact } from '@/lib/types';
import { changesOf } from '@/lib/types';
import { GROUP_LABEL, SCORECARD_GROUP_ORDER, groupOfAgent } from '@/lib/personaGroups';
import { chipInferred, chipSim, fmtSigned } from '@/lib/scorecardStyles';
import { fmtWindowRange } from '@/lib/simTime';
import { assignmentLabel, demandLabel } from '@/lib/provenance';
import { nonCompletionsLine } from '@/lib/nonCompletions';
import { windowedScope, scopeNoteText } from '@/lib/windowedScope';
import type { PerRunReport, ReportFacts } from '@/lib/reportData';

// ── Method-note constants (spec-pinned; the settled note is the CAVEAT ONLY — project process
//    never enters product copy) ─────────────────────────────────────────────────────────────────
export const NOTE_SAFETY =
  'Safety figures anywhere in this tool are trajectory-derived near-miss surrogates ' +
  '(time-to-collision, hard braking, blocked junctions), reported as magnitude with direction ' +
  'unclaimed where the sign is not seed-stable. Never crash prediction.';
export const NOTE_TRAVEL =
  'Travel medians are measured from each group’s own simulated trips, shown with the share of ' +
  'trips more than 30 s slower — the tail often carries the change the median hides.';
export const NOTE_ACCESS =
  'Access is a rule-based heuristic from the change type, labeled low confidence — an estimate ' +
  'to reason about, not a measurement.';
export const NOTE_NOT_MEASURED =
  'An empty cell is not measured for this run — not zero, and not an error. Inferred groups have ' +
  'no simulated trips; voices exist without numbers. Buckets are ordered by epistemic status; ' +
  'entries within a bucket follow the fixed stakeholder order, never effect size — no ranking is ' +
  'implied anywhere in this section.';
export const NOTE_SETTLED_BASIS =
  'The settled figure’s iteration basis is under re-verification after a sort-order fix; the ' +
  'direction of the finding is not in doubt. Settled assignment iterates driver route choice only.';
export const COLOPHON_SWEEP =
  'a banned-language sweep fails the test suite on any drift toward verdicts or tallies';
export const COLOPHON_CLOSE =
  'Nadi arranges evidence; the planner concludes. Nothing in this document is a recommendation.';

export type ReportState = 'loading' | 'ready' | 'missing' | 'mismatch';

export function RunDocument({
  artifact,
  report,
  reportState,
  isExample = false,
  liveName = null,
  onGroupDoorway,
}: {
  artifact: TrajectoryArtifact;
  report: PerRunReport | null;
  reportState: ReportState;
  isExample?: boolean;
  /** the identity endpoint's name for this run, when the backend is up — wins over the
   *  report-carried name (the report's copy is the static demo's carrier) */
  liveName?: string | null;
  onGroupDoorway: (group: string) => void;
}) {
  const [showAudit, setShowAudit] = useState(false);
  const meta = artifact.meta;
  const changes = changesOf(artifact);
  const profile = meta.demand_profile ?? 'synthetic_demo';
  const facts: ReportFacts | null = reportState === 'ready' ? (report?.facts ?? null) : null;
  const rpt = reportState === 'ready' ? report : null;
  const scope = windowedScope(changes, meta.sim_end);

  // V2.7a follow-up — the document is a NAME-RENDERING surface (runLabel's precedence rule):
  // live identity name → the report-carried name → the mechanical change title.
  const mechanicalTitle =
    changes.length === 1
      ? (changes[0].description ?? `${(changes[0].type ?? 'change').replace(/_/g, ' ')} on ${changes[0].target_edge ?? 'the corridor'}`)
      : `${changes.length} changes on the corridor`;
  const title = liveName ?? (reportState === 'ready' ? report?.run?.name : null) ?? mechanicalTitle;

  // ── the method-note registry: notes accumulate in render order; sups reference by key ────────
  const notes: { key: string; text: string }[] = [];
  const note = (key: string, text: string | null | undefined) => {
    if (!text) return;
    if (!notes.some((n) => n.key === key)) notes.push({ key, text });
  };
  const sup = (k: string): React.ReactNode => {
    const i = notes.findIndex((n) => n.key === k);
    if (i < 0) return null;
    return (
      <sup style={{ lineHeight: 0 }}>
        <a href={`#doc-note-${i + 1}`} style={supLink}>{i + 1}</a>
      </sup>
    );
  };

  // detour notes (verbatim payload sentences) register before the findings render
  const rd = facts?.response_detour ?? null;
  const rdMembers = rd?.members ?? null;
  // (review) notes register only when the FINDING renders — a legacy probes-shape payload must
  // not leave orphaned footnotes with no superscript referencing them
  if (rd && rdMembers && rdMembers.length > 0) {
    note('rd-framing', rd.framing);
    note('rd-lower', rd.lower_bound_note);
    note('rd-origins', rd.origins_note);
    note('rd-end-method', rd.end_method_note);
    note('rd-probed', rd.probed_members_note);
    note('rd-coincidence', rd.window_coincidence_note);
  }
  if (rpt) note('travel', NOTE_TRAVEL);
  note('safety', NOTE_SAFETY);
  if (artifact.scorecard?.groups.some((g) => g.access_delta?.value != null)) note('access', NOTE_ACCESS);
  note('not-measured', NOTE_NOT_MEASURED);
  if (facts?.assignment?.mode === 'settled') note('settled', NOTE_SETTLED_BASIS);

  // ── 2.4 bucket assignment (fixed group order within buckets, never effect size) ──────────────
  const groupsById = new Map((artifact.scorecard?.groups ?? []).map((g) => [g.group, g]));
  const voiceCounts = new Map<string, number>();
  for (const a of (artifact.agents ?? []) as Agent[]) {
    const g = groupOfAgent(a);
    if (g) voiceCounts.set(g, (voiceCounts.get(g) ?? 0) + 1);
  }
  type Row = { gid: string; bucket: 1 | 2 | 3 };
  const claimable = (cell?: { value?: number | null; range?: { sign_stable: boolean } | null } | null) =>
    cell?.value != null && cell.range?.sign_stable !== false;
  const rows: Row[] = SCORECARD_GROUP_ORDER.map((gid) => {
    const g = groupsById.get(gid);
    const cells = [g?.travel_time_delta, g?.safety_delta, g?.access_delta];
    const anyValue = cells.some((c) => c?.value != null);
    if (!anyValue) return { gid, bucket: 3 };
    // travel/access with a claimable sign — or a measured tail — put a group in "moved";
    // safety NEVER claims direction (±magnitude always), so safety alone lands in bucket 2.
    const moved =
      claimable(g?.travel_time_delta) ||
      claimable(g?.access_delta) ||
      (g?.travel_time_delta?.affected_share ?? 0) > 0;
    return { gid, bucket: moved ? 1 : 2 };
  });
  const maxMag = Math.max(
    1e-9,
    ...(artifact.scorecard?.groups ?? []).map((g) => Math.abs(g.safety_delta?.value ?? 0)),
  );

  // finding numbers are PRECOMPUTED from which facts exist (pure — no render-scope mutation)
  const findingKeys: string[] = [
    rdMembers && rdMembers.length > 0 ? 'response' : null,
    rpt ? 'travel' : null,
    facts && nonCompletionsLine(facts.non_completions, facts.non_completions_split, facts.insertion_backlog)
      ? 'nc'
      : null,
    facts?.zone_facts ? 'zone' : null,
    'groups',
  ].filter((k): k is string => k != null);
  const findingHead = (key: string, label: string) => `2.${findingKeys.indexOf(key) + 1}  ${label}`;

  return (
    <article data-testid="run-document" style={wrap}>
      {isExample ? (
        <h6 style={kicker} data-testid="example-kicker">
          EXAMPLE RUN · LOADED READ-ONLY · A PREVIEW, NOT A VERDICT
        </h6>
      ) : (
        <h6 style={kicker}>ANTICIPATED IMPACT PREVIEW — a preview, not a verdict</h6>
      )}
      <h2 style={{ marginBottom: 'var(--space-4)', textWrap: 'pretty' } as React.CSSProperties}>{title}</h2>
      <div style={subtle}>Safety figures are surrogate near-miss measures, not crash predictions.</div>

      {reportState === 'loading' && <div style={subtle}>loading the report…</div>}
      {reportState === 'missing' && (
        <div style={degradeNote} data-testid="report-missing">
          No report for this run yet — the abstract and findings come from the audited report,
          which hasn’t been generated. Run the report enrich (the run card in the Build stage), or{' '}
          <code>python python/src/report.py --run-id {meta.run_id}</code>. The scenario
          specification and the per-group index below render from the run itself.
        </div>
      )}
      {reportState === 'mismatch' && (
        <div style={degradeNote} data-testid="report-mismatch">
          The report file served for this run describes a different run — refusing to render it
          (a document must never carry another run’s findings). Regenerate with{' '}
          <code>python python/src/report.py --refresh-facts --run-id {meta.run_id}</code>.
        </div>
      )}

      {/* V2.7b — THE PROSE STATE. A facts-only document (Act I's zero-LLM report), a skipped
          interpretation, or a failed one all produce a report whose FIGURES ARE COMPLETE and whose
          narrative slots are empty. Rendering that as a blank abstract would read as a broken
          document; this says which of the three it is, in the server's own sentence
          (`report.PROSE_NOTES`, rendered verbatim — the client composes none of it). */}
      {rpt?.prose && rpt.prose.status !== 'composed' && (
        <div
          style={degradeNote}
          data-testid={rpt.prose.status === 'partial' ? 'prose-partial' : 'prose-not-composed'}
        >
          {rpt.prose.note}
        </div>
      )}

      {/* The abstract is an LLM slot: absent on a prose-less report, where the note above stands in
          its place. An empty <p> would be a silent blank, which is the state this refuses. */}
      {rpt && rpt.sections.what_tested.framing && (
        <>
          <h6 style={secKicker}>Abstract</h6>
          <p style={abstract}>{rpt.sections.what_tested.framing}</p>
        </>
      )}

      {/* ── 1 · Scenario specification — from the ARTIFACT (never report.scenario_change:
             that field is changes[0] only and under-reports composites) ───────────────── */}
      <h6 style={secKicker}>1 · Scenario specification</h6>
      <table className="table" style={{ fontSize: 13.5 }}>
        <tbody>
          <tr>
            <td style={specKey}>Members</td>
            <td data-testid="doc-members">
              {changes.map((c, i) => (
                <div key={i}>
                  {/* server-composed descriptions already carry their window in clock/sim terms —
                      append it only on the mechanical fallback (closures/incidents pre-serialize) */}
                  {c.description ??
                    `${(c.type ?? 'change').replace(/_/g, ' ')}${c.target_edge ? ` — ${c.target_edge}` : ''}${
                      c.window ? ` · ${fmtWindowRange(c.window, profile)}` : ''
                    }`}
                </div>
              ))}
            </td>
          </tr>
          <tr>
            <td style={specKey}>Demand</td>
            <td>
              {demandLabel(profile)}
              {rpt
                ? ` — ${rpt.run.demand.car.toLocaleString()} cars, ${rpt.run.demand.bicycle.toLocaleString()} bicycles, ${rpt.run.demand.pedestrian.toLocaleString()} pedestrians`
                : ''}
            </td>
          </tr>
          <tr>
            <td style={specKey}>Assignment</td>
            <td>
              {assignmentLabel(meta.assignment)}
              {sup('settled')}
            </td>
          </tr>
          <tr>
            <td style={specKey}>Seeds</td>
            <td>
              {rpt
                ? `${rpt.run.seeds.join(', ')}${(facts?.n_seeds ?? 1) > 1 ? ' — per-cell ranges shown where they disagree' : ''}`
                : 'per-cell ranges shown where seeds disagree'}
            </td>
          </tr>
          <tr>
            <td style={specKey}>Extent</td>
            <td>one corridor (Scarborough / Pickering / Ajax extract), one demand level</td>
          </tr>
        </tbody>
      </table>

      {/* ── 2 · Findings — each renders IFF its fact exists (fewer findings than a mockup is
             correct behavior; nothing is fabricated) ──────────────────────────────────── */}
      <h6 style={secKicker}>2 · Findings</h6>

      {rdMembers && rdMembers.length > 0 && (
        <section style={finding} data-testid="doc-finding" data-finding="response">
          <div style={findingTitle}>{findingHead('response', 'EMERGENCY ACCESS, PER END')}</div>
          {rdMembers.map((m, mi) => (
            <div key={mi} style={{ marginTop: mi ? 'var(--space-4)' : 'var(--space-2)' } as React.CSSProperties}>
              <div style={memberHead}>
                {(m.type ?? 'change').replace(/_/g, ' ')} — <code>{m.edge}</code>
                {m.window ? ` · ${fmtWindowRange(m.window, profile)}` : ''}
              </div>
              <div style={calloutRow}>
                {(m.ends ?? []).map((e, ei) => {
                  const probes = e.probes ?? [];
                  const reachable = probes.filter((p) => p.added_s != null);
                  const worst = reachable.length ? Math.max(...reachable.map((p) => p.added_s as number)) : null;
                  return (
                    <div key={ei} style={callout}>
                      {worst != null ? (
                        <>
                          <div style={calloutNum}>
                            +{worst} s{sup('rd-framing')}
                          </div>
                          <div style={calloutLabel}>worst added time to reach — {e.label}</div>
                        </>
                      ) : (
                        <>
                          <div style={calloutNum}>—</div>
                          <div style={calloutLabel}>
                            {e.label}: {e.note ?? 'no route computable from any probed station'}
                          </div>
                        </>
                      )}
                      {probes
                        .filter((p) => p.added_s == null && p.note)
                        .map((p, pi) => (
                          <div key={pi} style={causeLine}>
                            {p.label}: {p.note}
                          </div>
                        ))}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <div style={rideAlong}>
            {rd!.origins_note}
            {sup('rd-origins')}
          </div>
        </section>
      )}

      {rpt && (
        <section style={finding} data-testid="doc-finding" data-finding="travel">
          <div style={findingTitle}>{findingHead('travel', 'TRAVEL TIME, CARS')}</div>
          <p style={findingProse} data-testid="report-tail">
            {rpt.car_tail.sentence}
            {sup('travel')}
          </p>
          <div style={calloutRow}>
            <div style={callout}>
              <div style={calloutNum}>{fmtSigned(rpt.car_tail.median_s, 's')}</div>
              <div style={calloutLabel}>median car trip change</div>
            </div>
            <div style={callout}>
              <div style={calloutNum}>{rpt.car_tail.share_gt30_pct}%</div>
              <div style={calloutLabel}>of car trips more than 30 s slower</div>
            </div>
            <div style={callout}>
              <div style={calloutNum}>{rpt.run.cars_rerouted.toLocaleString()}</div>
              <div style={calloutLabel}>cars rerouted in this run</div>
            </div>
          </div>
        </section>
      )}

      {facts && nonCompletionsLine(facts.non_completions, facts.non_completions_split, facts.insertion_backlog) && (
        <section style={finding} data-testid="doc-finding" data-finding="non-completions">
          <div style={findingTitle}>{findingHead('nc', 'WHO DID NOT COMPLETE')}</div>
          {/* the INVARIANT rides the shared composer: the split never renders without the
              backlog-attribution parenthetical */}
          <p style={findingProse} data-testid="doc-non-completions">
            {nonCompletionsLine(facts.non_completions, facts.non_completions_split, facts.insertion_backlog)}
          </p>
        </section>
      )}

      {facts?.zone_facts && (
        <section style={finding} data-testid="doc-finding" data-finding="zone">
          <div style={findingTitle}>{findingHead('zone', 'SCHOOL-ZONE CROSSING CONFLICTS')}</div>
          <div style={calloutRow}>
            <div style={callout}>
              <div style={calloutNum}>
                {facts.zone_facts.ped_vehicle_conflicts.baseline} → {facts.zone_facts.ped_vehicle_conflicts.scenario}
              </div>
              <div style={calloutLabel}>ped–vehicle crossing conflicts near the zone, baseline → scenario</div>
            </div>
          </div>
          {/* the two V2.2d HONESTY LOCKS ride the numbers unconditionally, verbatim */}
          <div style={rideAlong} data-testid="doc-zone-variation">{facts.zone_facts.variation_note}</div>
          <div style={rideAlong} data-testid="doc-zone-population">{facts.zone_facts.population_note}</div>
        </section>
      )}

      {/* ── 2.(last) · Who this touches, per group — from the ARTIFACT scorecard ─────────── */}
      <section style={finding} data-testid="doc-scorecard-section">
        <div style={findingTitle}>{findingHead('groups', 'WHO THIS TOUCHES, PER GROUP')}</div>
        <p style={findingProse}>
          An index, not a verdict: it shows where something moved so you can go ask the people it
          moved. Nothing is summed across groups. Click a group to hear its voices.
        </p>
        <div style={legendLine}>
          + worse · − better · ± magnitude only (direction not claimed)
          {sup('safety')} · a band <BandGlyph /> spans zero: it moved by about this much, either way
        </div>
        {scope && (
          <div style={legendLine} data-testid="doc-scope-note">
            {scopeNoteText(scope, meta.demand_profile)}
          </div>
        )}

        <BucketHead accent>Where something moved</BucketHead>
        {rows.filter((r) => r.bucket === 1).map((r) => (
          <GroupRow key={r.gid} gid={r.gid} accent groupsById={groupsById} voiceCounts={voiceCounts}
            gloss={rpt?.sections.who_affected.glosses[r.gid]} maxMag={maxMag} onOpen={onGroupDoorway} sup={sup} />
        ))}
        {/* (review) the cross-note fires only when a bucket-1 row actually CARRIES a safety
            magnitude — "the safety magnitudes above" must never point at nothing */}
        {rows.some((r) => r.bucket === 1 && groupsById.get(r.gid)?.safety_delta?.value != null) && (
          <div style={crossNote}>also unclaimed: the safety magnitudes above — each rides with its group.</div>
        )}

        {rows.some((r) => r.bucket === 2) && (
          <>
            <BucketHead>
              Moved, direction unclaimed
              {sup('safety')}
            </BucketHead>
            {rows.filter((r) => r.bucket === 2).map((r) => (
              <GroupRow key={r.gid} gid={r.gid} groupsById={groupsById} voiceCounts={voiceCounts}
                gloss={rpt?.sections.who_affected.glosses[r.gid]} maxMag={maxMag} onOpen={onGroupDoorway} sup={sup} />
            ))}
          </>
        )}

        {rows.some((r) => r.bucket === 3) && (
          <>
            <BucketHead>
              Not measured in this run
              {sup('not-measured')}
            </BucketHead>
            {rows.filter((r) => r.bucket === 3).map((r) => (
              <GroupRow key={r.gid} gid={r.gid} groupsById={groupsById} voiceCounts={voiceCounts}
                gloss={rpt?.sections.who_affected.glosses[r.gid]} maxMag={maxMag} onOpen={onGroupDoorway} sup={sup} />
            ))}
          </>
        )}
      </section>

      {/* ── voices / institutional / discourse — the audited report sections, testids intact ── */}
      {rpt && rpt.sections.what_they_say.groups.length > 0 && (
        <>
          <h6 style={secKicker}>3 · What the affected say</h6>
          <div style={subtle}>Simulated persona reactions — anticipated texture, not a poll. Quotes are verbatim.</div>
          {rpt.sections.what_they_say.groups.map((g) => (
            <div key={g.key} style={{ marginTop: 14 }} data-testid="synthesis-group" data-group={g.key}>
              <h3 style={h3}>{g.label}</h3>
              <p style={para}>{g.synthesis}</p>
              {g.quotes.map((q, i) => {
                const community = q.grounding === 'inferred';
                return (
                  <blockquote key={i} style={community ? quoteCommunity : quoteSim}>
                    <div style={quoteText}>“{q.comment}”</div>
                    <div style={quoteAttr}>
                      — {q.label}{' '}
                      <span style={community ? tagCommunity : tagSim}>
                        {community ? 'inferred community voice' : 'simulated persona'}
                      </span>
                    </div>
                  </blockquote>
                );
              })}
            </div>
          ))}
        </>
      )}

      {rpt?.sections.institutional && (
        <div data-testid="report-institutional" style={{ marginTop: 20 }}>
          <h3 style={h3}>Institutional perspectives (mandate lens)</h3>
          <div style={subtle}>{rpt.sections.institutional.disclaimer}</div>
          {rpt.sections.institutional.voices.length === 0 ? (
            <p style={para} data-testid="report-institutional-empty">
              {rpt.sections.institutional.empty_reason}
            </p>
          ) : (
            rpt.sections.institutional.voices.map((v) => (
              <div key={v.id} style={instCard} data-testid="report-institution" data-institution={v.id}>
                <div style={{ fontWeight: 700 }}>{v.label}</div>
                <div style={instMeta}>
                  Published mandate —{' '}
                  <a href={v.mandate.source} target="_blank" rel="noreferrer" style={{ color: '#1f4e9c' }}>
                    source
                  </a>{' '}
                  · retrieved {v.mandate.retrieved}
                </div>
                <div style={instMission}>“{v.mandate.mission}”</div>
                {v.citations.map((c, i) => (
                  <div key={i} style={{ marginTop: 6 }}>
                    <div style={instCite}>{c.text}</div>
                    {(c.notes ?? []).map((n, j) => (
                      <div key={j} style={instNote}>
                        {n}.
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}

      {rpt?.sections.discourse && (
        <div data-testid="report-discourse" style={{ marginTop: 20 }}>
          <h3 style={h3}>How discourse might unfold</h3>
          <div style={subtle}>
            Simulated cascades over the seeded reactions — illustrative unfoldings, never a forecast or a
            vote. Movement, not a final position.
          </div>
          <p style={para}>{rpt.sections.discourse.synthesis}</p>
          {rpt.sections.discourse.cascade_ids.map((cid) => (
            <div key={cid} style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>cascade {cid}</div>
              <ul style={factsList}>
                {[...(rpt.sections.discourse!.reach[cid] ?? [])]
                  .sort((a, b) => b.reached - a.reached)
                  .map((r) => (
                    <li key={r.argument} data-testid="report-reach-row">
                      {r.argument} — <b>{r.reached}</b>
                      {r.post_count ? ` (${r.post_count} posts, ${r.per_post}/post)` : ''}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
          <ul style={factsList}>
            {rpt.sections.discourse.cascade_ids.map((cid) => {
              const s = rpt.sections.discourse!.shifts[cid];
              const by = Object.entries(s.by_group).map(([g, n]) => `${g}: ${n}`).join(', ') || 'none';
              return (
                <li key={cid}>
                  <b>cascade {cid}:</b> {s.movers} agents moved (by group — {by}); {s.hardened} hardened,{' '}
                  {s.warmed} warmed.
                </li>
              );
            })}
          </ul>
          {rpt.sections.discourse.excluded_count > 0 && (
            <p style={para}>
              <b>Withheld by the guard:</b> {rpt.sections.discourse.excluded_count} posts were excluded (
              {Object.entries(rpt.sections.discourse.excluded_by)
                .map(([r, n]) => `${r}: ${n}`)
                .join(', ')}
              ). An exclusion is the honesty guard working.
            </p>
          )}
          {rpt.sections.discourse.quotes.map((q, i) => (
            <blockquote key={i} style={quoteSim}>
              <div style={quoteText}>“{q.comment}”</div>
              <div style={quoteAttr}>
                — {q.label} <span style={tagSim}>simulated cascade utterance</span>
              </div>
            </blockquote>
          ))}
        </div>
      )}

      {rpt && (
        <>
          <h6 style={secKicker}>What this run cannot tell you</h6>
          {/* the intro is the LLM slot; the CAVEATS below it are code-rendered from the facts, so
              they stand on a prose-less document while the intro paragraph simply isn't there */}
          {rpt.sections.cannot_tell.intro && <p style={para}>{rpt.sections.cannot_tell.intro}</p>}
          <div style={caveatWrap} data-testid="report-caveats">
            {rpt.sections.cannot_tell.caveats.map((c, i) => (
              <div key={i} style={caveatCard}>
                <div style={caveatTitle}>{c.title}</div>
                <div style={caveatBody}>{c.body}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Notes on method (the footnote targets) ───────────────────────────────────────── */}
      <h6 style={secKicker} id="doc-notes">Notes on method</h6>
      <ol style={noteList} data-testid="doc-method-notes">
        {notes.map((n, i) => (
          <li key={n.key} id={`doc-note-${i + 1}`}>{n.text}</li>
        ))}
      </ol>

      {/* ── Colophon — derived from run data; test counts deliberately OMITTED (derive-or-omit) ── */}
      <h6 style={secKicker}>Colophon &amp; data sources</h6>
      <p style={colophon} data-testid="doc-colophon">
        SUMO microsimulation of all traffic · trajectory contract v{artifact.schema_version}
        {profile === 'calibrated_am_peak' ? ' · Toronto open data: traffic counts' : ''}
        {rd ? ' · Toronto open data: TFS station locations' : ''}
        {rpt?.sections.institutional?.voices.length
          ? ' · institutional missions quoted verbatim with retrieval dates'
          : ''}
        {' · '}
        {COLOPHON_SWEEP}.
      </p>
      {rpt && (
        <>
          <button style={auditToggle} onClick={() => setShowAudit((s) => !s)} data-testid="audit-toggle">
            {showAudit ? '▾' : '▸'} Report audit — {rpt.audit.summary}
          </button>
          {showAudit && (
            <div style={auditBox} data-testid="audit-log">
              {rpt.audit.log.map((e, i) => (
                <div key={i} style={auditRow}>
                  <span style={e.status === 'clean' ? auditClean : auditFixed}>{e.status}</span> {e.slot}
                  {e.violations.length > 0 && (
                    <span style={auditViol}>
                      {' '}:: {e.violations.map((v) => `${v.rule}: ${v.sentence}`).join(' | ')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          <div style={provLine}>
            generated {rpt.generated_at}
            {rpt.facts_refreshed_at ? ` · facts refreshed ${rpt.facts_refreshed_at}` : ''} ·{' '}
            {rpt.provider}/{rpt.model}
          </div>
        </>
      )}
      <p style={closeLine}>{COLOPHON_CLOSE}</p>
    </article>
  );
}

// ── 2.4 pieces ─────────────────────────────────────────────────────────────────────────────────
function BandGlyph() {
  return (
    <svg viewBox="0 0 40 12" style={{ width: 40, height: 12, verticalAlign: -2 }}>
      <line x1="20" y1="0" x2="20" y2="12" stroke="#98989b" strokeDasharray="2 2" />
      <rect x="4" y="3" width="32" height="6" fill="#b5d9fd" stroke="#597ea3" strokeWidth="0.8" />
    </svg>
  );
}

function Band({ mag, maxMag }: { mag: number; maxMag: number }) {
  const half = Math.max(1, (mag / maxMag) * 30);
  return (
    <svg viewBox="0 0 64 12" style={{ width: 64, height: 12, verticalAlign: -2 }}>
      <line x1="32" y1="0" x2="32" y2="12" stroke="#98989b" strokeDasharray="2 2" />
      <rect x={32 - half} y="3" width={half * 2} height="6" fill="#b5d9fd" stroke="#597ea3" strokeWidth="0.8" />
    </svg>
  );
}

function BucketHead({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <h6 style={{ ...bucketHead, color: accent ? 'var(--color-accent-700)' : 'var(--color-neutral-700)' }}>
      {children}
    </h6>
  );
}

function GroupRow({
  gid,
  accent,
  groupsById,
  voiceCounts,
  gloss,
  maxMag,
  onOpen,
  sup,
}: {
  gid: string;
  accent?: boolean;
  groupsById: Map<string, { grounding?: string; travel_time_delta?: CellT | null; safety_delta?: CellT | null; access_delta?: CellT | null }>;
  voiceCounts: Map<string, number>;
  gloss: string | undefined;
  maxMag: number;
  onOpen: (gid: string) => void;
  sup: (k: string) => React.ReactNode;
}) {
  const g = groupsById.get(gid);
  const voices = voiceCounts.get(gid) ?? 0;
  const t = g?.travel_time_delta;
  const s = g?.safety_delta;
  const a = g?.access_delta;
  const bits: React.ReactNode[] = [];
  if (t?.value != null) {
    bits.push(
      <span key="t">
        travel {fmtSigned(t.value, 's')} median
        {(t.affected_share ?? 0) > 0 ? `, ${Math.round((t.affected_share ?? 0) * 1000) / 10}% >30 s` : ''}
        {sup('travel')}
      </span>,
    );
  }
  if (s?.value != null) {
    bits.push(
      <span key="s">
        safety ±{Math.abs(s.value)} <Band mag={Math.abs(s.value)} maxMag={maxMag} />
        {sup('safety')}
      </span>,
    );
  }
  if (a?.value != null) {
    bits.push(
      <span key="a">
        access {fmtSigned(a.value, '')} by rule
        {sup('access')}
      </span>,
    );
  }
  const missing = [t, s, a].filter((c) => c?.value == null).length;
  if (missing === 3) {
    bits.push(
      <span key="none">
        not measured in this run
        {sup('not-measured')}
      </span>,
    );
  }
  return (
    <button
      style={{ ...groupRow, borderLeft: `2px solid ${accent ? 'var(--color-accent-400)' : 'var(--color-neutral-300)'}` }}
      onClick={() => onOpen(gid)}
      data-testid="doc-group-row"
      data-group={gid}
    >
      <span style={groupRowHead}>
        <span style={groupName}>
          {(GROUP_LABEL[gid] ?? gid).toUpperCase()}{' '}
          <span style={g?.grounding === 'inferred' ? chipInferred : chipSim}>{g?.grounding ?? 'inferred'}</span>
        </span>
        <span style={doorway}>{voices} voices ▸</span>
      </span>
      {gloss && <span style={groupGloss}>{gloss}</span>}
      <span style={evidence}>
        {bits.map((b, i) => (
          <span key={i}>
            {i > 0 ? ' · ' : ''}
            {b}
          </span>
        ))}
      </span>
    </button>
  );
}

type CellT = { value?: number | null; affected_share?: number | null; range?: { sign_stable: boolean } | null };

// ── styles ─────────────────────────────────────────────────────────────────────────────────────
const wrap: React.CSSProperties = { maxWidth: 620, fontFamily: 'var(--font-body)', color: 'var(--color-text)' };
const kicker: React.CSSProperties = { color: 'var(--color-accent-700)', marginBottom: 'var(--space-3)' };
const secKicker: React.CSSProperties = { marginTop: 'var(--space-8)' };
const subtle: React.CSSProperties = { fontSize: 12.5, color: 'var(--color-neutral-600)', fontStyle: 'italic', marginBottom: 6 };
const abstract: React.CSSProperties = { fontSize: 15, lineHeight: 1.65, textWrap: 'pretty' } as React.CSSProperties;
const degradeNote: React.CSSProperties = {
  border: '1px solid var(--color-neutral-400)',
  background: 'var(--color-neutral-100)',
  padding: '10px 14px',
  fontSize: 13.5,
  lineHeight: 1.6,
  margin: '10px 0',
};
const specKey: React.CSSProperties = { color: 'var(--color-neutral-600)', width: 110, verticalAlign: 'top' };
const finding: React.CSSProperties = { marginTop: 'var(--space-6)' };
const findingTitle: React.CSSProperties = {
  fontFamily: 'var(--font-heading)',
  fontSize: 15,
  fontWeight: 600,
  letterSpacing: '0.04em',
};
const findingProse: React.CSSProperties = { fontSize: 14.5, lineHeight: 1.65, margin: '6px 0 0', textWrap: 'pretty' } as React.CSSProperties;
const memberHead: React.CSSProperties = { fontSize: 13, color: 'var(--color-neutral-700)', marginTop: 4 };
const calloutRow: React.CSSProperties = { display: 'flex', gap: 'var(--space-8)', marginTop: 'var(--space-3)', flexWrap: 'wrap' };
const callout: React.CSSProperties = { maxWidth: 250 };
const calloutNum: React.CSSProperties = { fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 36, lineHeight: 1 };
const calloutLabel: React.CSSProperties = { fontSize: 12.5, color: 'var(--color-neutral-700)', marginTop: 4, lineHeight: 1.45 };
const causeLine: React.CSSProperties = { fontSize: 12, color: 'var(--color-neutral-700)', marginTop: 6, lineHeight: 1.45 };
const rideAlong: React.CSSProperties = { fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 8, lineHeight: 1.5 };
const legendLine: React.CSSProperties = { fontSize: 11.5, color: 'var(--color-neutral-600)', marginTop: 6 };
const bucketHead: React.CSSProperties = { marginTop: 'var(--space-6)', marginBottom: 6 };
const crossNote: React.CSSProperties = { fontSize: 12, color: 'var(--color-neutral-600)', marginTop: 6, paddingLeft: 14 };
const groupRow: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 4,
  width: '100%',
  textAlign: 'left',
  padding: '9px 12px',
  marginTop: 8,
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  font: 'inherit',
  color: 'inherit',
};
const groupRowHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 };
const groupName: React.CSSProperties = { fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 14, letterSpacing: '0.04em' };
const doorway: React.CSSProperties = { fontSize: 11, color: 'var(--color-accent-700)', whiteSpace: 'nowrap' };
const groupGloss: React.CSSProperties = { fontSize: 14, lineHeight: 1.55 };
const evidence: React.CSSProperties = { fontSize: 11.5, color: 'var(--color-neutral-600)' };
const supLink: React.CSSProperties = { textDecoration: 'none', fontWeight: 700, fontSize: 10 };
const h3: React.CSSProperties = { fontSize: 13, fontWeight: 700, margin: '0 0 4px' };
const para: React.CSSProperties = { fontSize: 14, margin: '0 0 8px' };
const factsList: React.CSSProperties = { fontSize: 13, margin: '0 0 6px', paddingLeft: 18 };
const quoteSim: React.CSSProperties = { margin: '6px 0', padding: '6px 12px', borderLeft: '3px solid #cbd5e1', background: '#f8fafc' };
const quoteCommunity: React.CSSProperties = { margin: '6px 0', padding: '6px 12px', borderLeft: '3px solid #b79bd6', background: '#f7f4fb' };
const quoteText: React.CSSProperties = { fontSize: 13.5, fontStyle: 'italic' };
const quoteAttr: React.CSSProperties = { fontSize: 11.5, color: 'var(--color-neutral-600)', marginTop: 3 };
const tagSim: React.CSSProperties = { color: '#64748b' };
const tagCommunity: React.CSSProperties = { color: '#7c5aa8' };
const instCard: React.CSSProperties = { background: '#eef3f7', borderLeft: '3px solid #3e6b8f', padding: '10px 12px', marginTop: 10 };
const instMeta: React.CSSProperties = { fontSize: 11, color: '#4b5f70', margin: '2px 0 4px' };
const instMission: React.CSSProperties = { fontSize: 12.5, fontStyle: 'italic', lineHeight: 1.45 };
const instCite: React.CSSProperties = { fontSize: 12.5, lineHeight: 1.4, fontVariantNumeric: 'tabular-nums' };
const instNote: React.CSSProperties = { fontSize: 11, color: 'var(--color-neutral-600)', fontStyle: 'italic', marginTop: 1 };
const caveatWrap: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 };
const caveatCard: React.CSSProperties = { border: '1px solid #f0d9a8', background: '#fdf8ec', padding: '9px 12px' };
const caveatTitle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#8a6d2f', marginBottom: 2 };
const caveatBody: React.CSSProperties = { fontSize: 12.5, color: '#5c5340' };
const noteList: React.CSSProperties = { fontSize: 13, lineHeight: 1.7, color: 'var(--color-neutral-700)', paddingLeft: 20, margin: '8px 0 0', display: 'grid', gap: 6 };
const colophon: React.CSSProperties = { fontSize: 13, lineHeight: 1.7, color: 'var(--color-neutral-700)', textWrap: 'pretty' } as React.CSSProperties;
const provLine: React.CSSProperties = { fontSize: 11.5, color: 'var(--color-neutral-500)', marginTop: 6 };
const closeLine: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--color-neutral-600)',
  marginTop: 'var(--space-4)',
  borderTop: '1px solid var(--color-divider)',
  paddingTop: 'var(--space-3)',
};
const auditToggle: React.CSSProperties = {
  marginTop: 10,
  border: '1px solid var(--color-divider)',
  background: 'transparent',
  padding: '6px 10px',
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const auditBox: React.CSSProperties = { marginTop: 6, fontSize: 11.5, lineHeight: 1.6 };
const auditRow: React.CSSProperties = { marginTop: 2 };
const auditClean: React.CSSProperties = { color: '#3caa5a', fontWeight: 600 };
const auditFixed: React.CSSProperties = { color: '#b7791f', fontWeight: 600 };
const auditViol: React.CSSProperties = { color: 'var(--color-neutral-600)' };

/** V2.7a C4 — the EXAMPLE run's Build stage: the read-only draft-composition view (the ratified
 *  Shell v2 article). Members render as they were run; editing the example is disabled with the
 *  reason — cloning into a fresh draft is the iteration path. */
export function ExampleBuildView({
  changes,
  profile,
  demoLocked,
  onStartDraft,
}: {
  changes: { type?: string; target_edge?: string; description?: string; window?: { start_s: number; end_s: number } | null }[];
  profile: string | undefined;
  demoLocked: boolean;
  onStartDraft: () => void;
}) {
  return (
    <article data-testid="example-build" style={wrap}>
      <h6 style={kicker}>Example run · build stage, read-only</h6>
      <h2 style={{ marginBottom: 'var(--space-4)', textWrap: 'pretty' } as React.CSSProperties}>
        How this run&rsquo;s draft was composed
      </h2>
      <p style={findingProse}>
        This run began as a draft. Each palette action added a member; one Run submitted the
        composite as a staged baseline → scenario → analysis job. The members below are shown as
        they were drawn.
      </p>
      <h6 style={secKicker}>Draft basket — {changes.length} member{changes.length === 1 ? '' : 's'}, as run</h6>
      <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
        {changes.map((c, i) => (
          <div key={i} className="blueprint" style={memberCard} data-testid="example-member">
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            <span style={memberName}>{(c.type ?? 'change').replace(/_/g, ' ').toUpperCase()}</span>
            <span style={memberMeta}>
              {c.description ??
                `${c.target_edge ?? ''}${c.window ? ` · ${fmtWindowRange(c.window, profile)}` : ''}`}
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 'var(--space-8)', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          onClick={onStartDraft}
          disabled={demoLocked}
          title={demoLocked ? undefined : undefined}
          data-testid="example-start-draft"
        >
          Start a new draft
        </button>
        <span style={{ fontSize: 13, color: 'var(--color-neutral-600)', fontStyle: 'italic' }}>
          editing this example is disabled — clone it into a fresh draft to iterate
        </span>
      </div>
    </article>
  );
}

const memberCard: React.CSSProperties = {
  padding: '10px 16px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 10,
  background: 'var(--color-bg)',
};
const memberName: React.CSSProperties = {
  fontFamily: 'var(--font-heading)',
  fontWeight: 600,
  fontSize: 15,
  letterSpacing: '0.03em',
};
const memberMeta: React.CSSProperties = { fontSize: 12, color: 'var(--color-neutral-600)' };
