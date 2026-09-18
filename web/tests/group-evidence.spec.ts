// V2.7e C1 — the group-evidence COMPOSER: pure-function pins (the street-names.spec idiom — no
// vitest). `groupEvidence` is what the run document's evidence strip renders from — voices per
// grounding, the group's three cells WITH their confidence and note (the first body-text render of
// cell notes anywhere in the document), and the one agent the "Ask one" door opens on.
//
// THE PICK RULE (ratified 2026-09-17, D-Q1): the room seed and the Ask door share ONE stated rule —
// each group's largest-consequence simulated voices first (|scenario − baseline| descending, TIES BY
// ARTIFACT INDEX — a total order, so a synthetic run where many deltas are 0.0 seeds in artifact
// order among ties, never "whatever the engine did"), then inferred voices in artifact order;
// alternating A, B, A, B, A up to ROOM_MAX. THE IMBALANCE RIDER: when one group runs out the
// alternation backfills from the other and the seed NOTE states the actual counts — one derived
// template, always true, no special branch. Supply under ROOM_MIN → no seed (no CTA: a
// clickable-then-failing door is the thing V2.7a refused to ship).
import { test, expect } from '@playwright/test';
import type { Agent, TrajectoryArtifact } from '../lib/types';
import {
  ROOM_MAX,
  ROOM_MIN,
  groupEvidence,
  rankedVoices,
  roomSeed,
  seedNote,
} from '../lib/groupEvidence';

/** A sim voice pinned to a vehicle with a trip delta (seconds); persona id decides the group. */
function sim(id: string, persona: string, deltaS: number): Agent {
  return {
    persona: { id: persona, label: `${persona} ${id}` },
    reaction: { comment: 'x', sentiment: 0, stance: 'neutral' },
    grounding: 'sim',
    vehicle_id: id,
    outcome: {
      baseline_duration: 600,
      scenario_duration: 600 + deltaS,
      delta_seconds: deltaS,
      baseline_timeloss: 0,
      scenario_timeloss: 0,
    } as unknown as Agent['outcome'],
    trigger_t: 100,
  } as Agent;
}
function inferred(persona: string, n: number): Agent {
  return {
    persona: { id: persona, label: `${persona} ${n}` },
    reaction: { comment: 'y', sentiment: 0, stance: 'neutral' },
    grounding: 'inferred',
  } as Agent;
}
function mandate(): Agent {
  return {
    persona: { id: 'tfs', label: 'Toronto Fire Services' },
    reaction: { comment: 'z', sentiment: 0, stance: 'neutral' },
    grounding: 'mandate',
  } as Agent;
}

function artifactWith(agents: Agent[], scorecard?: unknown): TrajectoryArtifact {
  return {
    schema_version: '0.10.0',
    meta: { run_id: 'r', sim_start: 0, sim_end: 1800, bbox: [0, 0, 1, 1], network: 'n', generated_at: 't' },
    vehicles: [],
    persons: [],
    agents,
    scorecard: scorecard ?? { groups: [] },
  } as unknown as TrajectoryArtifact;
}

// car_commuter personas: time_pressed, gig_driver, steady_regular; accessibility: accessibility_advocate;
// local_resident: longtime_resident (the PERSONA_GROUP map in personaGroups.ts)
const A = 'car_commuter';
const B = 'accessibility';

test('groupEvidence counts voices per grounding and hands back the artifact’s OWN agent', () => {
  const agents = [sim('v0', 'time_pressed', 5), sim('v1', 'gig_driver', -40), inferred('longtime_resident', 1), mandate()];
  const art = artifactWith(agents, {
    groups: [
      {
        group: A, grounding: 'sim',
        travel_time_delta: { value: -1.0, affected_share: 0.15, confidence: 'measured', note: 'affected_share = fraction >30s slower' },
        safety_delta: { value: 43.24, confidence: 'low', note: 'sign not stable' },
        access_delta: null,
      },
    ],
  });
  const ev = groupEvidence(art, A);
  expect(ev.label).toBe('Car commuters');
  expect(ev.voices).toEqual({ sim: 2, inferred: 0, total: 2 });
  // the Ask door's agent is the LARGEST-consequence sim voice (|−40| > |5|), by REFERENCE
  expect(ev.firstAgent).toBe(agents[1]);
  // the three cells, with confidence + note carried (the strip's "numbers' basis" list)
  expect(ev.cells.map((c) => c.key)).toEqual(['travel', 'safety', 'access']);
  expect(ev.cells[0]).toMatchObject({ value: -1.0, confidence: 'measured', note: 'affected_share = fraction >30s slower' });
  expect(ev.cells[1]).toMatchObject({ value: 43.24, confidence: 'low', note: 'sign not stable' });
  expect(ev.cells[2]).toMatchObject({ value: null, confidence: null, note: null }); // absent → not measured
  // a group with no row and no voices is honest, not a crash
  const none = groupEvidence(art, 'transit_riders');
  expect(none.voices.total).toBe(0);
  expect(none.firstAgent).toBeNull();
  expect(none.cells.every((c) => c.value == null)).toBe(true);
  // mandate voices belong to no scorecard group (the institution sentinel) — never counted here
  expect(groupEvidence(art, 'institution').voices.total).toBe(0);
});

test('rankedVoices: sim by |delta| descending, TIES BY ARTIFACT INDEX, then inferred in artifact order', () => {
  const agents = [
    sim('v0', 'time_pressed', 0), // tie at 0 — index 0
    inferred('longtime_resident', 1), // not this group
    sim('v1', 'gig_driver', 0), // tie at 0 — index 2
    sim('v2', 'steady_regular', -30), // the largest consequence
    inferred('resident_driver', 1), // maps to car_commuter; marked inferred to exercise the inferred tail
  ];
  const art = artifactWith(agents);
  const ranked = rankedVoices(art, A);
  expect(ranked.map((a) => agents.indexOf(a))).toEqual([3, 0, 2, 4]);
});

test('roomSeed alternates A, B, A, B, A — the balanced 3 + 2 case', () => {
  const agents = [
    sim('a0', 'time_pressed', 10), sim('a1', 'gig_driver', 20), sim('a2', 'steady_regular', 30),
    inferred('accessibility_advocate', 1), inferred('accessibility_advocate', 2),
  ];
  const seed = roomSeed(artifactWith(agents), A, B);
  expect(seed).not.toBeNull();
  // A's largest first (a2, 30), then B's first inferred, then a1, then B's second, then a0
  expect(seed!.pairs.map((p) => p.index)).toEqual([2, 3, 1, 4, 0]);
  expect(seed!.pairs.every((p) => p.agent === agents[p.index])).toBe(true); // reference identity
  expect(seed!.counts).toEqual({ a: 3, b: 2 });
  expect(seed!.pairs.length).toBe(ROOM_MAX);
});

test('roomSeed backfills when one group runs out — the imbalanced 4 + 1 case, and the note says so', () => {
  const agents = [
    sim('a0', 'time_pressed', 1), sim('a1', 'gig_driver', 2), sim('a2', 'steady_regular', 3), sim('a3', 'time_pressed', 4),
    sim('a4', 'gig_driver', 5), // six car voices; only five seats
    inferred('accessibility_advocate', 1),
  ];
  const seed = roomSeed(artifactWith(agents), A, B);
  expect(seed!.pairs.map((p) => p.index)).toEqual([4, 5, 3, 2, 1]); // A4, B0, then A backfills
  expect(seed!.counts).toEqual({ a: 4, b: 1 });
  expect(seedNote('Car commuters', 4, 'Accessibility', 1)).toBe(
    'seeded 4 from Car commuters, 1 from Accessibility — most-affected first; add or remove anyone',
  );
});

test('roomSeed refuses a pair whose combined supply is under ROOM_MIN', () => {
  expect(ROOM_MIN).toBe(3);
  const agents = [sim('a0', 'time_pressed', 1), inferred('accessibility_advocate', 1)];
  expect(roomSeed(artifactWith(agents), A, B)).toBeNull();
  // the same pair with a third voice on either side seeds
  const three = [...agents, sim('a1', 'gig_driver', 2)];
  expect(roomSeed(artifactWith(three), A, B)!.pairs.length).toBe(3);
});
