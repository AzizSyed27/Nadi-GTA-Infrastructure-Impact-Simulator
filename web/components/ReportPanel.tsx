'use client';

import { useEffect, useState } from 'react';

import type { Scorecard, ScorecardGroup } from '@/lib/types';
import { GROUP_LABEL, SCORECARD_GROUP_ORDER } from '@/lib/personaGroups';
import { badgeLow, badgeMeas, chipInferred, chipSim, ScoreCell } from '@/lib/scorecardStyles';

// The report is a SEPARATE artifact (not on the frozen trajectory contract), written by python/src/report.py
// and mirrored to /latest-report.json. Its shape is owned here (kept in sync with report.py's report_json).
const REPORT_URL = '/latest-report.json';

interface Quote {
  label: string;
  comment: string;
  grounding: 'sim' | 'inferred';
}
interface SynthGroup {
  key: string;
  label: string;
  synthesis: string;
  quotes: Quote[];
  sample_size: number;
}
interface Caveat {
  title: string;
  body: string;
}
interface ReachRow {
  argument: string;
  reached: number;
  post_count: number | null;
  per_post: number | null;
}
interface CascadeShift {
  movers: number;
  by_group: Record<string, number>;
  hardened: number;
  warmed: number;
}
interface Discourse {
  synthesis: string;
  quotes: { label: string; comment: string }[];
  cascade_ids: string[];
  reach: Record<string, ReachRow[]>;
  dominant: Record<string, string | null>;
  diverge: boolean;
  shifts: Record<string, CascadeShift>;
  excluded_count: number;
  excluded_by: Record<string, number>;
}
interface AuditEntry {
  slot: string;
  status: 'clean' | 'resolved_on_retry' | 'failed';
  violations: { rule: string; sentence: string }[];
}
interface Report {
  generated_at: string;
  provider: string;
  model: string;
  run: {
    scenario_run_id: string;
    baseline_run_id: string;
    network: string;
    seeds: number[];
    thresholds: { ttc_s: number; veh_pet_s: number; ped_pet_s: number; materiality_s: number };
    demand: { car: number; bicycle: number; pedestrian: number };
    cars_rerouted: number;
  };
  scenario_change: { description: string; target_edge: string; target_lane?: number | null };
  scorecard: Scorecard;
  car_tail: { median_s: number; share_gt30_pct: number; cross_seed_available: boolean; sentence: string };
  sections: {
    what_tested: { framing: string };
    who_affected: { glosses: Record<string, string> };
    what_they_say: { groups: SynthGroup[] };
    /** V2.3c — code-rendered mandate-lens voices; null/absent on pre-0.9.0 reports (renders nothing). */
    institutional?: {
      voices: {
        id: string;
        label: string;
        mandate: { institution: string; mission: string; source: string; retrieved: string };
        citations: { key: string; text: string; notes?: string[] }[];
        comment: string;
      }[];
      empty_reason: string | null;
      disclaimer: string;
    } | null;
    discourse: Discourse | null;
    cannot_tell: { intro: string; caveats: Caveat[] };
  };
  audit: { passed: boolean; slots_checked: number; summary: string; log: AuditEntry[] };
  sources: string[];
}

/**
 * The report content — V2.7a interim: rendered INSIDE the Read stage's DocumentPanel (the old
 * full-screen overlay + 📄 button died with the mode toggle; the chat moved to Explore · Chat).
 * Renders the STRUCTURED report JSON — not raw markdown — so the scorecard keeps the map panel's
 * exact badge/muting/± treatment. Framing stays anticipation, never a verdict; nothing here
 * tallies stance. Replaced wholesale by RunDocument in V2.7a C3.
 */
export function ReportPanel() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAudit, setShowAudit] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(REPORT_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: Report) => {
        if (!cancelled) setReport(data);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={sheet} data-testid="report-panel">
      <div>
        {error && <div style={muted}>Could not load the report ({error}). Generate it with report.py.</div>}
        {!report && !error && <div style={muted}>Loading report…</div>}

        {report && (
          <>
            <div style={kicker}>ANTICIPATED IMPACT PREVIEW — a preview, not a verdict</div>
            <h1 style={h1}>{report.scenario_change.description}</h1>
            <div style={subtle}>
              Safety figures are surrogate near-miss measures, not crash predictions.
            </div>

            {/* 1. What was tested */}
            <h2 style={h2}>1. What was tested</h2>
            <p style={para}>{report.sections.what_tested.framing}</p>
            <ul style={facts}>
              <li>
                <b>Change:</b> {report.scenario_change.description} (edge <code>{report.scenario_change.target_edge}</code>
                {report.scenario_change.target_lane != null ? `, lane ${report.scenario_change.target_lane}` : ''})
              </li>
              <li>
                <b>Corridor:</b> <code>{report.run.network}</code> — one Toronto corridor
              </li>
              <li>
                <b>Demand simulated:</b> {report.run.demand.car} cars, {report.run.demand.bicycle} bicycles,{' '}
                {report.run.demand.pedestrian} pedestrians
              </li>
              <li>
                <b>Runs:</b> scenario <code>{report.run.scenario_run_id}</code> vs baseline{' '}
                <code>{report.run.baseline_run_id}</code>
              </li>
            </ul>

            {/* 2. Who is affected, and how */}
            <h2 style={h2}>2. Who is affected, and how</h2>
            <Scorecards scorecard={report.scorecard} />
            <div style={legend}>
              <span style={{ color: '#c64545' }}>＋ worse</span> · <span style={{ color: '#3caa5a' }}>− better</span> ·
              ± = magnitude only (safety direction not claimed) · <span style={badgeMeas}>MEAS</span> measured ·{' '}
              <span style={badgeLow}>LOW</span> low-confidence estimate
            </div>
            <div style={tailBox} data-testid="report-tail">
              <b>Travel-time tail (cars):</b> {report.car_tail.sentence}
            </div>
            <ul style={glossList}>
              {SCORECARD_GROUP_ORDER.map((gid) => (
                <li key={gid}>
                  <b>{GROUP_LABEL[gid] ?? gid}:</b> {report.sections.who_affected.glosses[gid]}
                </li>
              ))}
            </ul>

            {/* 3. What the affected people say */}
            <h2 style={h2}>3. What the affected people say</h2>
            <div style={subtle}>Simulated persona reactions — anticipated texture, not a poll. Quotes are verbatim.</div>
            {report.sections.what_they_say.groups.map((g) => (
              <div key={g.key} style={{ marginTop: 16 }} data-testid="synthesis-group" data-group={g.key}>
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
                          {community ? 'community perspective, not a measured traveler' : 'simulated persona'}
                        </span>
                      </div>
                    </blockquote>
                  );
                })}
              </div>
            ))}

            {/* 3b. Institutional perspectives — V2.3c mandate lens (code-rendered; absent pre-0.9.0) */}
            {report.sections.institutional && (
              <div data-testid="report-institutional" style={{ marginTop: 20 }}>
                <h3 style={h3}>Institutional perspectives (mandate lens)</h3>
                <div style={subtle}>{report.sections.institutional.disclaimer}</div>
                {report.sections.institutional.voices.length === 0 ? (
                  <p style={para} data-testid="report-institutional-empty">
                    {report.sections.institutional.empty_reason}
                  </p>
                ) : (
                  report.sections.institutional.voices.map((v) => (
                    <div key={v.id} style={instCard} data-testid="report-institution" data-institution={v.id}>
                      <div style={{ fontWeight: 700, color: '#1f2937' }}>{v.label}</div>
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

            {/* 4. How discourse might unfold (v0.4.0 social cascade) */}
            {report.sections.discourse && (
              <div data-testid="report-discourse">
                <h2 style={h2}>4. How discourse might unfold</h2>
                <div style={subtle}>
                  Simulated cascades over the seeded reactions — illustrative unfoldings, never a forecast or a
                  vote. Movement, not a final position.
                </div>
                <p style={para}>{report.sections.discourse.synthesis}</p>

                <h3 style={h3}>Which argument drew the most response</h3>
                <div style={subtle}>
                  unique agents who acted on a post making it; “/post” normalizes for how much it was posted
                </div>
                {report.sections.discourse.cascade_ids.map((cid) => (
                  <div key={cid} style={{ marginTop: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>cascade {cid}</div>
                    <ul style={facts}>
                      {[...(report.sections.discourse!.reach[cid] ?? [])]
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

                <h3 style={h3}>Who moved</h3>
                <div style={subtle}>
                  derived stance transitions within each cascade — movement, per cascade, never summed
                </div>
                <ul style={facts}>
                  {report.sections.discourse.cascade_ids.map((cid) => {
                    const s = report.sections.discourse!.shifts[cid];
                    const by = Object.entries(s.by_group).map(([g, n]) => `${g}: ${n}`).join(', ') || 'none';
                    return (
                      <li key={cid}>
                        <b>cascade {cid}:</b> {s.movers} agents moved (by group — {by}); {s.hardened} hardened,{' '}
                        {s.warmed} warmed.
                      </li>
                    );
                  })}
                </ul>
                <p style={para}>
                  <b>Across cascades:</b> the most-answered argument{' '}
                  {report.sections.discourse.diverge
                    ? 'differed across runs — the cascades diverge on which argument travels furthest'
                    : 'was consistent across runs'}
                  . Engagement is response volume under neutral surfacing, not persuasion (see limitations).
                </p>
                {report.sections.discourse.excluded_count > 0 && (
                  <p style={para}>
                    <b>Withheld by the guard:</b> {report.sections.discourse.excluded_count} posts were excluded (
                    {Object.entries(report.sections.discourse.excluded_by)
                      .map(([r, n]) => `${r}: ${n}`)
                      .join(', ')}
                    ). An exclusion is the honesty guard working.
                  </p>
                )}
                <div style={subtle}>A middle-ground moment from the cascade (verbatim):</div>
                {report.sections.discourse.quotes.map((q, i) => (
                  <blockquote key={i} style={quoteSim}>
                    <div style={quoteText}>“{q.comment}”</div>
                    <div style={quoteAttr}>
                      — {q.label} <span style={tagSim}>simulated cascade utterance</span>
                    </div>
                  </blockquote>
                ))}
              </div>
            )}

            {/* 5. What this analysis cannot tell you */}
            <h2 style={h2}>5. What this analysis cannot tell you</h2>
            <p style={para}>{report.sections.cannot_tell.intro}</p>
            <div style={caveatWrap} data-testid="report-caveats">
              {report.sections.cannot_tell.caveats.map((c, i) => (
                <div key={i} style={caveatCard}>
                  <div style={caveatTitle}>{c.title}</div>
                  <div style={caveatBody}>{c.body}</div>
                </div>
              ))}
            </div>

            {/* Methodology & provenance */}
            <h2 style={h2}>Methodology &amp; provenance</h2>
            <ul style={facts}>
              <li>
                <b>Seeds:</b> {report.run.seeds.join(', ')}
              </li>
              <li>
                <b>Thresholds:</b> time-to-collision {report.run.thresholds.ttc_s}s, vehicle PET{' '}
                {report.run.thresholds.veh_pet_s}s, pedestrian PET {report.run.thresholds.ped_pet_s}s, delay
                materiality &gt;{report.run.thresholds.materiality_s}s
              </li>
              <li>
                <b>Generated:</b> {report.generated_at} · {report.provider}/{report.model}
              </li>
              <li>
                <b>Sources:</b> {report.sources.map((s) => <code key={s} style={{ marginRight: 6 }}>{s}</code>)}
              </li>
            </ul>
            <button style={auditToggle} onClick={() => setShowAudit((s) => !s)} data-testid="audit-toggle">
              {showAudit ? '▾' : '▸'} Audit log — {report.audit.summary}
            </button>
            {showAudit && (
              <div style={auditBox} data-testid="audit-log">
                {report.audit.log.map((e, i) => (
                  <div key={i} style={auditRow}>
                    <span style={e.status === 'clean' ? auditClean : auditFixed}>{e.status}</span> {e.slot}
                    {e.violations.length > 0 && (
                      <span style={auditViol}>
                        {' '}
                        :: {e.violations.map((v) => `${v.rule}: ${v.sentence}`).join(' | ')}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The 7×3 scorecard as a styled grid, reusing the shared ScoreCell (identical to the map panel). */
function Scorecards({ scorecard }: { scorecard: Scorecard }) {
  const byId: Record<string, ScorecardGroup> = {};
  for (const g of scorecard.groups) byId[g.group] = g;
  return (
    <div style={grid} data-testid="report-scorecard">
      <div style={{ ...gridHead, textAlign: 'left' }}>Stakeholder group</div>
      <div style={gridHead}>Travel time</div>
      <div style={gridHead}>Safety</div>
      <div style={gridHead}>Access</div>
      {SCORECARD_GROUP_ORDER.map((gid) => {
        const g = byId[gid];
        return (
          <div key={gid} style={gridRow} data-testid="report-scorecard-row" data-group={gid}>
            <div style={rowLabel}>
              <span>{GROUP_LABEL[gid] ?? gid}</span>
              <span style={g?.grounding === 'inferred' ? chipInferred : chipSim}>{g?.grounding ?? 'inferred'}</span>
            </div>
            <ScoreCell cell={g?.travel_time_delta} kind="travel" testid="report-cell" />
            <ScoreCell cell={g?.safety_delta} kind="safety" testid="report-cell" />
            <ScoreCell cell={g?.access_delta} kind="access" testid="report-cell" />
          </div>
        );
      })}
    </div>
  );
}

const sheet: React.CSSProperties = {
  position: 'relative',
  width: 'min(860px, 100%)',
  background: '#ffffff',
  borderRadius: 14,
  boxShadow: '0 8px 40px rgba(0,0,0,0.3)',
  padding: '28px 34px 40px',
  fontFamily: 'system-ui, sans-serif',
  color: '#1f2937',
  lineHeight: 1.5,
};
const kicker: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: 0.7,
  textTransform: 'uppercase',
  color: '#8a8a8a',
  fontWeight: 700,
};
const h1: React.CSSProperties = { fontSize: 22, fontWeight: 700, margin: '4px 0 2px' };
const subtle: React.CSSProperties = { fontSize: 12, color: '#8a8a8a', fontStyle: 'italic', marginBottom: 4 };
const h2: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  margin: '26px 0 8px',
  paddingBottom: 4,
  borderBottom: '1px solid #eee',
};
const h3: React.CSSProperties = { fontSize: 13, fontWeight: 700, margin: '0 0 4px', color: '#374151' };
const para: React.CSSProperties = { fontSize: 14, margin: '0 0 8px' };
const facts: React.CSSProperties = { fontSize: 13, margin: '0 0 6px', paddingLeft: 18, color: '#374151' };
const muted: React.CSSProperties = { fontSize: 14, color: '#8a8a8a', padding: '40px 0', textAlign: 'center' };

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1.6fr 1fr 1fr 1fr',
  gap: 6,
  alignItems: 'stretch',
  marginBottom: 8,
};
const gridHead: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: '#9aa0a6',
  textAlign: 'center',
  alignSelf: 'end',
  paddingBottom: 2,
};
const gridRow: React.CSSProperties = { display: 'contents' };
const rowLabel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  justifyContent: 'center',
  fontSize: 13,
  fontWeight: 600,
};
const legend: React.CSSProperties = { fontSize: 11, color: '#8a8a8a', margin: '2px 0 12px' };
const tailBox: React.CSSProperties = {
  fontSize: 13,
  background: '#f7f9fc',
  border: '1px solid #e6ebf2',
  borderRadius: 8,
  padding: '9px 12px',
  marginBottom: 12,
};
const glossList: React.CSSProperties = { fontSize: 13, paddingLeft: 18, color: '#374151', margin: 0 };

const quoteSim: React.CSSProperties = {
  margin: '6px 0',
  padding: '6px 12px',
  borderLeft: '3px solid #cbd5e1',
  background: '#f8fafc',
};
const quoteCommunity: React.CSSProperties = {
  margin: '6px 0',
  padding: '6px 12px',
  borderLeft: '3px solid #b79bd6',
  background: '#f7f4fb',
};
const quoteText: React.CSSProperties = { fontSize: 13.5, fontStyle: 'italic', color: '#374151' };
const quoteAttr: React.CSSProperties = { fontSize: 11.5, color: '#6b7280', marginTop: 3 };
const tagSim: React.CSSProperties = { color: '#64748b' };
const tagCommunity: React.CSSProperties = { color: '#7c5aa8' };
// V2.3c — the institutional cards (steel blue; distinct from sim grey and community purple)
const instCard: React.CSSProperties = {
  background: '#eef3f7',
  borderLeft: '3px solid #3e6b8f',
  borderRadius: 8,
  padding: '10px 12px',
  marginTop: 10,
};
const instMeta: React.CSSProperties = { fontSize: 11, color: '#4b5f70', margin: '2px 0 4px' };
const instMission: React.CSSProperties = { fontSize: 12.5, fontStyle: 'italic', color: '#374151', lineHeight: 1.45 };
const instCite: React.CSSProperties = { fontSize: 12.5, color: '#1f2937', lineHeight: 1.4, fontVariantNumeric: 'tabular-nums' };
const instNote: React.CSSProperties = { fontSize: 11, color: '#6b7280', fontStyle: 'italic', marginTop: 1 };

const caveatWrap: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 };
const caveatCard: React.CSSProperties = {
  border: '1px solid #f0d9a8',
  background: '#fdf8ec',
  borderRadius: 8,
  padding: '9px 12px',
};
const caveatTitle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#8a6d2f', marginBottom: 2 };
const caveatBody: React.CSSProperties = { fontSize: 12.5, color: '#5c5340' };

const auditToggle: React.CSSProperties = {
  marginTop: 18,
  border: 'none',
  background: 'transparent',
  color: '#6b7280',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  padding: 0,
  textAlign: 'left',
};
const auditBox: React.CSSProperties = {
  marginTop: 8,
  background: '#0f1115',
  color: '#d7dbe0',
  borderRadius: 8,
  padding: '10px 12px',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 11,
  lineHeight: 1.6,
  overflowX: 'auto',
};
const auditRow: React.CSSProperties = { whiteSpace: 'nowrap' };
const auditClean: React.CSSProperties = { color: '#5fd58a', fontWeight: 700 };
const auditFixed: React.CSSProperties = { color: '#e6b64c', fontWeight: 700 };
const auditViol: React.CSSProperties = { color: '#9aa0a6' };

