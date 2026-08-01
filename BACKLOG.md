# Backlog — deferred ideas & their tier

A home for "should I build this now?" — so scope decisions have somewhere to land instead of scattering across
plan files. Nothing here is committed work; it's the map of what we deliberately deferred and why.

## V2 editor — tiered change types
The V1 editor ships `new_road` + runtime `speed_limit` / `bike_lane` (the palette). V2 change types, cheapest &
most demo-worthy first:

- **Closures (road / lane / turn) — TIER 1, the first rung when V2 opens.** Cheap (a runtime edge/lane
  disallow-all, mechanically like `bike_lane`'s lane-permission edit) and **spectacular** on the map — a closed
  street reroutes visibly and hits the scorecard hard. Highest demo-value-per-effort.
- **Sidewalk / curb-ramp patches — TIER 2 (medium).** Pedestrian-network geometry; touches the ped population +
  the SSM ped-PET pass. More plumbing than a lane edit, less than a whole vertical. (Note: `new_road` currently
  carries NO sidewalk — a sidewalk patch is the natural pairing.)
- **Parking — its OWN vertical, NOT a palette button.** Curbside parking supply/demand is a different model
  (occupancy, search traffic, loading) — don't cram it into the change palette; if pursued, it's a separate
  feature with its own data + UI.
- **Time-windowed changes (peak-only lanes, timed closures, HOV hours) — a CONTRACT design decision to make
  ONCE.** The artifact/`Change` currently models a single static change in force from t=0. Time-windows mean the
  change has a schedule → the frozen contract, the SUMO application (mid-sim `apply_change`), and the playback all
  need a time dimension. Decide the shape deliberately before building any windowed change type.

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

## V2.2 response detour — rung 2: destination-rule bias (deferred design)
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

**Do NOT design this before V2.2d**: d's composite is the first multi-member modified-edge exclusion
set and will stress the CURRENT rule — change one variable at a time.

**V2.2d outcome — the multi-member exclusion is production-UNEXERCISED (a coverage gap, not a
defect).** The response detour only fires on capacity events; the school zone is a speed_limit
composite, so d shipped the multi-member `modified` union UNIT-verified only (the detour fact
correctly does not compute on a zone run). The real exercise needs a **multi-change CLOSURE
scenario, which NO palette flow currently produces** (composites are speed_limit-only in d).
Written down here rather than assumed-closed by the unit test — when composite members widen to
closures, the first such run exercises this path for real (and rung 2 above becomes urgent: with
several closed segments the "reachable another way" bias compounds).

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

## V2.2 closeout — disjoint-window span honesty (review-flagged, API-reachable only)
The windowed-scope disclosure uses the ratified spanning-window convention (`zone_lens.resolve_window`
+ the span note) for differing member windows. For DISJOINT windows (e.g. [0,300] and [1500,1800] on an
1800 s run) the span covers ~the whole period, so the dilution sentence is suppressed while two-thirds
of the run had no active change — the span note fires ("members carry differing windows; these figures
use the spanning window") but understates the gap. No palette can compose disjoint member windows today
(the 🏫 zone palette assigns ONE shared window); reachable only by hand-POSTing a composite. If a
multi-window composite flow ever lands, refine the sentence for gapped spans (e.g. per-member windows
or an "active intermittently" form) rather than widening the span convention silently.

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
- **Side-by-side run compare** — view two runs' scorecards/maps together (currently one active run + the switcher).
- **36 fps playback** — smoother trail animation at real entity counts (perf pass on the deck layers).
- **Echo-exclusion refinement** — the 4.4 cascade `safety_direction` rule tuning has known residual edge cases in
  distinguishing echoes from assertions.
- **Equilibrium / multi-day modeling** — the sim is one-shot within a corridor window; true traveler adaptation
  (day-to-day re-routing until equilibrium) is out of scope for the preview but noted.

## Known cleanup (flagged, not urgent)
- **Vestigial legacy paths** — `scenario_harness.run_pair` / `join_outcomes` / `_print_report` and `sampler.py`'s
  flat-outcomes (`"modes" not in side`) branch are dead since `speed_limit` moved to the multimodal
  `run_quant_runtime` (5.2b). No live producer emits the flat shape; safe to delete in a dedicated cleanup step.

## Features to add
- **Multiple new Scenarios** - Adding scenarios like   