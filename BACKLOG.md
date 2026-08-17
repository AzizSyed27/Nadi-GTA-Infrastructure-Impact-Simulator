# Backlog — deferred ideas & their tier

A home for "should I build this now?" — so scope decisions have somewhere to land instead of scattering across
plan files. Nothing here is committed work; it's the map of what we deliberately deferred and why.

## V2 editor — tiered change types (tier 1 SHIPPED; tiers 2/3 open)
Tier 1 SHIPPED in V2.2 (road/lane closures + incidents, the full palette) and the windowed-change
contract shape was decided ONCE as prescribed (the 0.5.0 `window` field, live since V2.2 — apply/
revert in-sim with proof logs). What remains open:

- **Sidewalk / curb-ramp patches — TIER 2 (medium).** Pedestrian-network geometry; touches the ped population +
  the SSM ped-PET pass. More plumbing than a lane edit, less than a whole vertical. (Note: `new_road` currently
  carries NO sidewalk — a sidewalk patch is the natural pairing.)
- **Parking — its OWN vertical, NOT a palette button.** Curbside parking supply/demand is a different model
  (occupancy, search traffic, loading) — don't cram it into the change palette; if pursued, it's a separate
  feature with its own data + UI.

## V2.1 calibration — foundation-level, requires recalibration
These are the levers that move interior GEH past ~55% toward the 85% bar (diagnosis:
`data/demand/V2.1b-diagnosis.md` — the composite ceiling is build-residual × loading × clipped net,
and no loading knob recovers it). Both are phase-opening rebuilds, never patches:

- **bbox expansion** — a larger net extent so boundary demand has upstream origin (the clipped
  boundary is why 22% of counted movements could not be placed and entries saturate). Regenerates
  `corridor.net.xml`, which invalidates `network.json`, the golden trajectory fixtures, AND the entire
  current calibration (junction ids, matched links, routes).
- **real signal-plan import** — replace netconvert-default green splits at arterial intersections with
  the city's coordinated timings. Shifts every baseline; requires recalibration end-to-end.

## V2.2 response detour — rung 2 — SHIPPED in V2.5b (end-node probing replaced the anchor walk)
The rung-2 design SHIPPED: per capacity-event member × per segment END NODE × per station,
cost-to-end = min over ALL incoming passenger approaches per net (no exclusions — the mutated nets
encode member state; the reverse partner of a one-way-closed street is just an approach),
independent best-per-net disclosed by `END_METHOD_NOTE`. The open questions resolved: one-end
rendering = one line per end with causes riding; honest zero = one constant; it REPLACED the old
fact (legacy `probes` sidecars render as-is, shape-keyed). The doorstep station's rows carry an
explicit ORIGIN-CLOSED cause. `position_m` was SUPERSEDED at this rung (end-node probing answers
"which direction" without it; a position-refined claim would assert more than the whole-edge
`apply_to_net` computes) — it stays accepted-but-unused, waiting on a partial-edge capacity model
(rung 3, alongside per-window nets). **Cross-vintage incomparability:** old "+29.1 s
detour-past-anchor" and new "+X s to reach an end" are DIFFERENT measurements — the vocabulary
split is test-pinned in every new-shape render; CompareView is the named exposure (sides are slim
{meta, scorecard} and render no detour today; if response access ever enters compare or any
side-by-side surface, cross-SHAPE deltas get the refused-"—†" idiom, never arithmetic).

## The pre-V2.5b record (historical; the design pressure that produced the above)
The current destination rule picks the first downstream junction WITH AN ALTERNATE APPROACH, so the
measured fact is **"how much longer to reach a point reachable another way" — systematically biased
toward small/zero deltas**. The question a response service actually asks is "can you still reach
addresses ON the closed segment, and from which direction."

**Rung-2 fact (a design, not a tweak):** probe the closed segment's **END NODES** rather than a
downstream junction — report per-origin reachability and cost to each end ("reachable from the east
end +12 s; the west end is unreachable while the closure is active"). Open design questions: rendering
when one end is reachable and the other isn't; what "honest zero" means for this fact; whether it
replaces or accompanies the current one. Natural companion to **`position_m`** (accepted-but-unused in
the contract since 0.5.0) — along-edge probing is the same rung.

**V2.4b outcome — the multi-member exclusion is production-EXERCISED; the observation feeding this
design (run `multimodal-scenario-20260810T200300Z`, road_closure `-36784353#20` 600–1200 + permanent
speed_limit `-1288863201` + factor-only incident `-1288863202#6` 600–1680, via the basket):** the
destination rule ran **CLEAN on its first real 3-edge exclusion set** — the PRIMARY branch fired
("first outgoing passenger edge at the first downstream junction with an alternate approach
(0 hop(s) past the changed road)" → `-36784307#3`); **no fallback, no uncomputable note**. Payload
now logs `modified_edges` (the 3-edge union), `destination_anchor` (`-36784353#20` = changes[0])
and the ORDER-DEPENDENCE note ("destination anchored to the first change; with multiple modified
edges this choice is arbitrary and affects the estimate") — the same three-member draft reordered
would anchor differently, which is exactly the rung-2 pressure. Result shape: doorstep Station 231
honestly UNREACHABLE during the window; 232 +10.2 s / 234 +29.1 s / 243 +2.7 s. Rung-2 remains a
design decision, now with a live datapoint instead of a unit fixture. **V2.5a paid the two wording
observations at rung 1:** the honest-ZERO sentences now pluralize from `len(modified_edges)`
("the changed road/roads", divergence-shape-pinned — the `destination_note` strings stay singular,
still the rung-2 rewrite's problem), and the window-coincidence conservatism is DISCLOSED
(`response_probe.WINDOW_COINCIDENCE_NOTE`, fires iff >1 distinct member window, REQUIRED-iff
verify-pinned, riding report + TFS citations + chat corpus). Per-window probing — computing the
detour against each window's actual net state instead of the most-constrained union — remains
rung-2 design space.

## V2.2d — student demand segment: DEFERRED (data fights back)
The school-zone lens counts what the demand actually contains, and says so (`zone_facts.
population_note` names the population; the report caveat repeats it). A REAL student segment needs:
- **TTS (Transportation Tomorrow Survey) zone-level records** — requires DMG registration/approval
  (not an open download); the open ward-level profile CSV is far too coarse for one corridor.
- **Bell-time schedules**: no dataset — the 08:00–09:00 modeled window is a TDSB POLICY-BAND
  assumption (elementary starts cluster 8:15–9:15), not measured arrival curves.
Until a segment lands, zone facts must keep NAMING their population ("pedestrian entities from the
… demand — not modeled schoolchildren"). School LOCATIONS are open (School Locations - All Types,
Toronto Open Data) and are used as siting context only — walk-Y-signs / crossing-guard posts would
be adjacent context, never measured children.

## V2.2 closeout — disjoint-window span honesty — PAID in V2.5a
The understatement (span covers ~the whole period, dilution sentence suppressed, two-thirds of the
run with no active change) is now DISCLOSED: `zone_lens.DISJOINT_SPAN_CLAUSE` ("the spanning window
includes periods where no change was active") rides inside the differing parenthetical iff ALL
members are windowed AND the merged union leaves a gap (a permanent member fills gaps — mixed sets
never get the clause; touching windows are contiguous, the LIFO boundary convention). Wired through
`build_scope_disclosure` (report line + caveat + chat corpus + the verify_facts equality recompute)
and the client mirror (`windowedScope.disjoint` → ScorecardPanel), pinned both sides incl. the
exact [0,300]+[1500,1800] shape. The SPAN CONVENTION ITSELF is unchanged (ratified: no redesign);
an "active intermittently" per-member form remains possible future work, no longer a live honesty
duty. zone_facts `window_note` deliberately NOT extended (the zone macro assigns identical windows;
a disjoint zone run is only craftable via clone-edit) — extend it there if that ever changes.

## V2.5c follow-on — the contract-side payload rung (measured, awaiting the ceremony)
Profiling measured ~50% of the 90 MB exemplar as wire waste, all CONTRACT-side (schema bump +
both serializers + fixture regen — the trajectory-contract ceremony, deliberately out of V2.5c's
render-side scope): **`speeds` is read by no renderer (8.6 MB)**; **timestamps are perfectly
regular 1.0 s steps (8.2 MB, derivable from `t0 + i·step`)**; **coordinates carry 14 decimals
where 6 ≈ 11 cm (~32 MB of the 64.6 MB path mass)**. A future 0.10.0 candidate — the numbers
above justify the ceremony when V2.7 needs the payload headroom. Render-side levers measured and
NOT currently indicted (74 fps, 3.9 s first paint on 90 MB): the eager-slim sidecar split
(~840 KB chrome payload, the graphs-sidecar idiom) and typed-array coordinate storage — both
designs recorded in the V2.5c plan, available when V2.7's per-frame ambitions raise the bar.

## V2.5c follow-on — remove the legacy latest.json payload fallback (scheduled: V2.7)
MapView's mount tolerates a pre-V2.5c latest.json that still carries a FULL artifact payload
(the transitional branch), and per the expire-loudly rule it `console.warn`s naming the stale
shape and this removal. By V2.7 every environment has rerun a scenario (regenerating the
pointer) — DELETE the `data?.meta` legacy branch in the mount effect then. A compat branch that
works silently is the kind that lives forever; this line is its scheduled death.

## V2.5d follow-on — STATIC_DEMO gating has no spec coverage (smoke-verified only)
`NEXT_PUBLIC_STATIC_DEMO` is inlined at BUILD time, so the dev-server Playwright project can never
exercise the demo branches (the disabled-with-why Edit toggle / chat form / interview form, the
`DEMO_READONLY_NOTE` renders, default-vs-no-store caching). V2.5d verified them by smoke + a
looked-at screenshot against the served bundle — procedural, not structural. The structural fix is
a SECOND Playwright project whose webServer serves `web/out/` after `build-static-demo.mjs` (a
handful of specs: note visible on all three gated surfaces, Edit toggle visibly disabled, the
walkthrough stops render). Until then, any change touching `web/lib/demo.ts` or a gated surface
re-runs the served-bundle smoke by hand.

## V2.5a follow-on — singleton/index drift hazards (the two-day-cost class)
Both surfaced by the V2.5a forensics; both got DOC corrections only — the mechanisms are still
live, and each already cost ~2 silent days once.
- **`newest_index()` lexicographic sort is still live ammunition:** the resolver
  (`report_agent.py`, `sorted(INDEX_ROOT.glob("index-*"))[-1]`) picks the lexicographically last
  `index-*` NAME — any non-timestamp name sorting above `'2'` (e.g. `index-V*`) beats every
  timestamped index forever. It silently served the wrong run's chat for 2 days (the
  "index run != report run" boot warning prints into a detached server log nobody reads).
  Candidate fixes: parse-and-sort by the actual timestamp with a LOUD refusal on unparseable
  names, or resolve the served index FROM the committed `latest-report.json` run id instead of
  newest-anything (kills the misalignment class outright).
- **The `latest-report.*` singleton is one demo commit from red again:** the pinned-run guard
  covers artifact-rewriting enriches, but nothing structural stops another committed
  `latest-report.*` overwrite — commit `0bead19` ("feat: demo run") did exactly this and
  discourse.spec sat red ~2 days until the V2.5a forensics found it. The recorded LESSON
  (re-run discourse.spec after touching either singleton) is procedural only. Candidate guards:
  a spec-side pin that `latest-report.json.run.scenario_run_id` equals the Playwright-pinned run
  id (a cheap always-on test fails the suite AT the overwriting commit, not days later), or the
  real fix — a per-run report view retiring the global singleton (V2.7 territory).

## V2.4 follow-on — new_road members in composites (regen-then-runtime; USER-HIT gap)
A real drafting attempt composed a 3-segment new-road CHAIN plus a 29-street school zone in one
basket and hit the member-type refusal (`REASON_COMPOSITE_MEMBER`) — exactly the "build the
connecting road AND zone the area around it" scenario a planner wants. Today one run is EITHER a
regenerated-network new_road (netconvert patch → `run_quant`) OR a runtime composite
(`run_quant_runtime` on the live net); the two paths never meet, and sequential runs don't stack
either — every run patches from the CANONICAL net, so a prior run's minted road is absent from the
next run's network. The capability: regen FIRST (patch ALL new_road members into one scenario net —
the existing sumolib gauntlet + load-probe per segment, which also gives multi-segment chains for
free), then apply the runtime members to the PATCHED net (`run_pair_multimodal` already accepts a
`scenario_net_path`; today that branch REPLACES the change list with None — it would instead need
to carry the runtime members through `simulate_multimodal` against the patched net). Design care:
revert proofs, the response-detour probe, and `network_export`/overlays must all read the patched
net; the composite member gate then narrows to bike_lane-only. Until this lands the honest UI story
stays: new roads run as single-member drafts; the zone/closure composite runs separately.

## V2.4d — calibrated windowed-closure composite: FUTURE EXEMPLAR CANDIDATE (deferred, ratified)
The V2.4b acceptance ran SYNTHETIC and exercised every honesty path (composite-null, multi-member
exclusion, span disclosure, revert proofs, TFS); a calibrated sibling adds REALISM (saturation
behavior under composed closures at real AM-peak demand), not coverage — deferred on that basis.
When it runs: shape = 3 windowed members incl. ≥1 closure, calibrated AM peak, the BOUNDED hour
(`NADI_MAX_T_OVERRIDE=3600`). Duties attached: **probe-first** (a calibrated closure COMPOSITE is
an unmeasured shape — sample sim-pace from the tripinfo tail before trusting any ETA), the
bounded-launch HARD-GATE (WMI check that the live sumo cmdline carries `--end`), keep-awake, and
override-restore STRUCTURALLY FIRST on return (the V2.2d ops lessons, hoisted to Run commands).

## V2.4c — clone from FAILED runs (cheap future extension)
Clone-to-draft renders in the RunCard's done-block only. A FAILED run's members are exactly the
draft a planner wants to fix ("it crashed on the third member — clone, drop it, rerun"), and the
status dict already carries `changes` from the queued/baseline writes; the extension is moving the
button out of the `done &&` gate + a spec case. Deferred: failed-run states can be partial
(pre-baseline failures may carry only the queued members), so the clone's provenance needs a
glance-able "cloned from a FAILED run" cue before this ships.

## V2.3c — institutional mandate sources: periodic re-verification (staleness)
`python/src/institutions.json` quotes each institution's published mission VERBATIM with a source
URL + retrieval date (`_provenance`). The quote is honest at capture but organizations revise their
published missions — a 2026 quote rendering verbatim years later is the stale-SVC-counts class of
problem. The rendered retrieval date (report institutional section, InstitutionPanel, interview
grounding) is the READER'S freshness signal; the maintenance duty is to periodically re-fetch the
source pages, confirm or update the mission text, and refresh `retrieved` + `_provenance`. The
mandate byte-identity pin (`test_institutions.py`) means an update is a deliberate roster edit,
never a drive-by reword. No mechanism until it hurts.

## Standing items (scattered across prior plans)
- **Rung-2/3 change types** — beyond the palette's rung-1 (see the tiered list above).
- **Side-by-side run compare** — SHIPPED V2.1d as ⇄ Compare (two slim scorecard sides, the
  provenance-mismatch guard, refused "—†" deltas where direction isn't claimable).
- **36 fps playback** — RESOLVED by V2.5c measurement: 74 fps p50 / 71 fps p95 on the 90 MB
  exemplar (headed prod build, hardware GL) after the trails data-identity memo. The historical
  "slow playback" perception was two things: the trails re-tessellation churn (fixed, A/B'd
  48→74 fps) and SOFTWARE-GL environments (headless/SwiftShader measures the rasterizer, not the
  app — the harness's --headed lesson).
- **Echo-exclusion refinement** — the 4.4 cascade `safety_direction` rule tuning has known residual edge cases in
  distinguishing echoes from assertions.
- **Equilibrium / multi-day modeling** — the sim is one-shot within a corridor window; true traveler adaptation
  (day-to-day re-routing until equilibrium) is out of scope for the preview but noted.

## Known cleanup (flagged, not urgent)
- **Vestigial legacy paths** — `scenario_harness.run_pair` / `join_outcomes` / `_print_report` and `sampler.py`'s
  flat-outcomes (`"modes" not in side`) branch are dead since `speed_limit` moved to the multimodal
  `run_quant_runtime` (5.2b). No live producer emits the flat shape; safe to delete in a dedicated cleanup step.
