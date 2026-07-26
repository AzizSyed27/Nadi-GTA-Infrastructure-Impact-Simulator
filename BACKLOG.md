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