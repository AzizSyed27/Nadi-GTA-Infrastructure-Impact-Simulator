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

## V2.5c follow-on — the contract-side payload rung — PAID in V2.6c (the 0.10.0 ceremony)
Landed 2026-08-20, measured on the 90 MB exemplar via the real encoders + the V2.5c harness
(headed, prod): raw 90.5→40.7 MB (-55.0%), **gzip transfer 26.9→7.6 MB (-71.8%)**, parse
3.3→1.4 s, **nav→first-render 3.7→1.8 s**, heap 189→90 MB, frames identical (122/61 fps p50/p95);
the normalizer's cost is visible in joinMs (2→7 ms). One measured-claim CORRECTION recorded: the
V2.5c "`speeds` is read by no renderer" line was TS-true but python-FALSE — `sampler.worst_moment`
(the trigger_t computation, a detached subprocess) consumed wire speeds; V2.6c moved it to the
outcomes-sidecar `worst_t` stamped at record time, with the `SpeedsUnavailableError` named
backstop. Timestamps were NOT all regular either: 2-10 calibrated vehicles per run carry real
3-216 s teleport holes — 0.10.0 uses per-entity EITHER-shape ({t0, dt} XOR explicit), lossless by
construction. Render-side levers (eager-slim split, typed arrays) stay unindicted and recorded
for V2.7.

## V2.6c follow-on — new_road.via runtime threading — SHIPPED (V2.6d, 2026-08-22)
Curved drawn roads landed end to end (acceptance run `multimodal-scenario-20260823T020424Z`:
a 3-bend connector between the 5.1 demo pair 8721888314→11747314439, minted edges carry the
5-point shape, length == polyline exactly, length/chord 1.05). Two earlier live curves were
HONEST ZEROS worth keeping: `…20260822T055343Z` (6 bends tracing the winding street
`25372703#0` — 8-point shape, length/chord 4.2, but it PARALLELS the street it follows, so no
trip benefits) and `…20260822T060211Z` (a 3-bend shortcut on the ×11 detour pair at the far-NW
corner — sumolib proves the router takes it, 59.6 s vs 277 s, the reverse direction canonically
unreachable — but the synthetic demo has no trips through that pocket). Lesson for the demo
recipe: a curve changes GEOMETRY, not demand; pick the pair with demand first, bend second.
**The recorded threading sketch was DIVERGED from
deliberately**: this entry's "node/edge pairs multiply per waypoint" (one edge per segment,
junction-id vias) became ONE edge with a `shape` polyline — materially simpler (minted ids stay
1-or-2, the edge-count gauntlet + `count_on_new_edges` unchanged, no minted nodes) — and via's
wire meaning became 'lon,lat' COORDINATE-PAIR strings (free waypoints, not junctions; the
recorded decision rides the schema description + `contract_models.Change.via` + `types.ts`).
`changeSetKey` gained via; the draft overlay captures the bent path. **Mid-curve junctions are
STRUCTURALLY absent — stated, not a bug**: via points are shape geometry, so no other road can
connect at a bend (connect at real junctions instead). The curved-road restyle SHIPPED in V2.7c C5:
a drawn road (playback overlay, draft basket, live preview) renders as a ROAD BODY at Change.lanes ×
3.2 m — grey with white striping from z ≥ 15 under a chevron-brown "proposed" casing — never a
schematic line; the orange/teal idiom is retired (this note predated the ratified design).

## The lexicographic newest-pick family — FIXED (2026-08-21, after firing twice)
The `sorted(glob)[-1]` bug ('V' > '2') fired twice with real cost (the V2.5a two-day stale-index
drift; the V2.6c stale-roster Groq-cap burn) and the fix swept the FAMILY, not the pair: the
shared `trajectory_io.newest_ts_named` (digit-first name filter; skipped junk WARNED by name
every resolution; junk-only → loud SystemExit naming files + the explicit flag) now backs
`newest_instrumented` / `newest_outcomes` (the upstream sibling with SIX junk names) /
`report._resolve` / `scorecard._resolve` / `robustness._seed42` + the golden-test picks + the
review-caught stragglers `report._load_calibration_provenance` (the SILENT variant — a junk
provenance would have fed report methodology text with no error) and `demand_calibration`'s
`newest_inventory`/`newest_provenance` (single-file spaces today; future-proofed inline);
`run_state.list_all` got an ORDERING-ONLY key (junk lists last, never filtered — an inventory,
not a resolver); `report_agent.newest_index` was REDESIGNED alignment-first (latest-report's
run id → its index dir; explicit prints on unreadable-report + skipped junk + missing aligned
index; is_dir guards the stray-file trap) — the V2.5a drift class is dead structurally, and the
lifespan mismatch warning is now the backstop canary. NB BOTH previously recorded fix candidates
were counterexampled in this tree: strict strptime rejects the legitimate --run-ts probe
`20260719T0500SEED1`; mtime is scrambled by OneDrive resync (July-named files carrying August
mtimes) and index-dir mtime tracks last CHAT, not last build. SystemExit severity is
CLI/subprocess-contained (reachability grep in test_run_resolvers.py — no live handler reaches
an exit-bearing resolver).

## DISCOVERED with the family — settle's iteration sort (FIXED; re-verification OPEN)
`settle.py` had the same bug in the NUMERIC alphabet: `sorted()` over string digit dir-names
('9' > '11'), so with DEFAULT_CAP=12 (dirs 0..11) "the last iteration's routes" silently took
ITERATION 9's routes, and the avg_tts sequence feeding `convergence_stats` was scrambled too.
Fixed (`_iteration_dirs`, key=int, test-pinned 0..11 → 11). **OPEN DECISION: the V2.1c settled
deliverable (Kingston Rd day-one +5.05 s vs settled +2.31 s) was produced under the old sort —
its settled basis may be iteration 9, not the last. Re-verification = one settled calibrated
rerun (hours). The fix makes every FUTURE settled run correct regardless.**

## V2.5c follow-on — remove the legacy latest.json payload fallback — SHIPPED (V2.7a C4)
Landed as an INVERSION, not a deletion (the exploration caught that deleting the warn-only
branch would have LOADED the payload silently — it falls through to the meta-shaped commit):
a payload-shaped latest.json now takes the LABELED `artifact-load-error` path naming the
pointer regeneration, spec-pinned in app-shell.spec.ts. NEW SIBLING (scheduled removal):
`report.served_report_run_id` tolerates a pre-V2.7a latest-report PAYLOAD shape loudly
(any report generation rewrites the pointer) — delete the payload leg once every environment
has regenerated a report (V2.8 checkpoint).

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
- **The `latest-report.*` singleton — SHIPPED (V2.7a C3/C5, the real fix):** the Read stage's
  RunDocument resolves the PER-RUN report (`/<run_id>-report.json`, committed for the pinned +
  example runs) behind a run-id VINTAGE GUARD (mismatch → the labeled `report-mismatch` state);
  latest-report.json is a server-side POINTER only (never committed, the latest.json symmetry);
  the payload singletons are deleted and the suite ran green with them absent (the V2.5c
  double-acceptance form). The 0bead19 two-day-red class cannot recur: no committed global
  payload exists to overwrite, and another run's report refuses to render.

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

## V2.6a group interviews — deferred honesty edges (both review-surfaced 2026-08-19)
- **The SHARED disclaimer strip's conjunction hole — CLOSED (2026-08-19, the V2.6 follow-up;
  user-ratified baseline decision).** `_CLAUSE_BOUNDARY` now carries the coordinating adversatives
  (`but|yet`) for EVERY consumer; the V2.6b room-local fork is deleted (the room tests passed
  unmodified). ACCEPTED RESIDUALS — decisions, not gaps: and/or are never boundaries (a
  multi-object disclaimer — "cannot predict crashes or their probability" — must stay whole or
  its tail re-enters the crash check, the V2.3b false-positive class), and
  though/although/however are excluded too (review-caught on a five-word draft: they commonly
  CONTINUE a disclaimer — "crashes however unlikely the probability" false-flagged as crash
  talk). Smuggles joined by any excluded connector are absorbed by retry + the prompt rules;
  every exclusion carries a MUTATION-EFFECTIVE pin in test_report.py so the boundary set can
  neither shrink nor grow by drift. The audit-retry BASELINE SHIFT is recorded in CLAUDE.md's
  provider block (the next natural regen's count is the new baseline's first reading, not drift).
- **Sibling label collision in room attribution — UI half CLOSED in V2.6b, prompt half stays.**
  The RoomDrawer suffixes colliding participant labels "(a)/(b)" (UI-only, spec-pinned), so
  humans can tell sibling rows apart. STILL OPEN: the MODEL's transcript renders both siblings
  as "Omar, taxpayer said:" (the server's flatten uses the persona label; a server-side suffix
  would put markers into prompt text). Id resolution is fully disambiguated (index-qualified,
  object-identity self-detection) — only the prompt-side rendered label collides. Decide
  deliberately if a room of same-label siblings becomes a real use pattern.

## Static-demo DEPLOY + the README "See it live" link swap (blocked on the user's click)
**Rebuilt and re-verified at V2.7f (2026-09-20).** The bundle is BUILT from the V2.7f tree (`node
scripts/build-static-demo.mjs` → `web/out/`, 45.4 MB, every file <25 MiB — regenerate freely, it's
untracked): the pinned triple, the example run's artifact + report + graphs sidecar, `network.json`,
the pointer at the example. Verified STRUCTURALLY by the `static-demo` Playwright project (`cd web
&& npm run e2e:demo`, 11 pins over the served bundle incl. zero `/api/*` requests) and by a served
walk of the README's three stops. **NOT deployed**: the Cloudflare Pages click is deliberately the
user's (`DEPLOY.md`: `npx wrangler login` · `npx wrangler pages deploy web/out --project-name
nadi-demo`, or the connect-repo alternative). When the live `*.pages.dev` URL exists, it replaces
the "deploy in flight" placeholder in README "See it live" — the ONE pending README edit,
deliberately blocked on the deploy and NOT on the `v2.7` tag (the link swap is a follow-on commit).

## The front door (the NEXT arc — a design session first)
**The 0.1b constraint, promoted verbatim from the gitignored `docs/v2.7a-brief.md:50-52` so it
survives a clone:** "FRONT-DOOR CONSTRAINT (recorded 0.1b): a marketing front door OUTSIDE this
shell will exist later. Do not hardcode an entry flow that precludes it — the shell must be
mountable from a route the front door can link into." The standing answer (V2.7a C6): the shell
stays at `/`; a front-door route can mount beside it (repeat the `dynamic(..., {ssr:false})`
wrapper); nothing in the shell precludes it. **V2.7f's finding (DesignSync, 2026-09-19):** the
design project "Nadi traffic simulation redesign" holds five canvases, all app screens — Shell v2's
`data-screen-label`s are `Nadi shell` / `Read — example run document` / `Build — draft` / `Watch —
playback` / `Explore`, and the project's own `github.md` calls the Read document "the landing"; no
front-door, hero, marketing or landing-page section exists. Per the design-first convention no
front door is built from taste, so f shipped without one. What the next arc needs before any
commit: a design session on the canvas (the front door's own screen, what it links into, whether
`/` stays the shell or moves), then `next.config.ts` decisions a second route forces (`trailingSlash`
— `about.html` vs `about/index.html` in the export; `images: { unoptimized: true }` if a hero uses
`next/image` under `output: 'export'`), the demo project extended to the new route, and OG/twitter
metadata (`layout.tsx` carries only title + description today).

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

## V2.7a follow-ons (recorded at the C6 closeout)
- **The two-group room doorway — SHIPPED in V2.7e C2:** 2.4's rows SELECT (cap two); one selection
  opens the evidence strip (the hear door, the Ask door, the cells' basis, what is not a door); two
  offer "Put A + B in a conversation →", which seeds the room by the RATIFIED pick rule (each group's
  most-affected simulated voices first, ties by artifact index, then inferred, alternating; the seed
  note states the actual counts) or, when the pair cannot fill a room, a sentence with the count.
  **Deferred from it, with the reason:** the two-group FEED filter (`feedGroup` is a single-group
  join eight spec files drive; the CTA lands with the feed on group A and the drawer showing both —
  widening the join is a behavioural change on a shared surface for a cosmetic gain).
- **Per-stage document-panel articles — the Watch half SHIPPED in V2.7b C10b** (the playback
  article: near-miss callout with its surrogate footnote, the transport, the vehicles-on-network
  readout, inside the document panel, on the FINISHED-run Watch state). The Build-fresh article
  (change cards + steps replacing the palette rail) remains V2.7d's editor restyle.
- **Sweep single-sourcing, remainder:** `support/sweeps.ts` is the single source for NEW specs;
  15 older spec files still carry byte-identical local BANNED/STANCE_TALLY copies — migrate each
  when a commit touches it anyway (never as a bulk pass).
- **The marketing front door:** the shell stays at `/`; a front-door route can mount beside it
  (repeat the `dynamic(..., {ssr:false})` wrapper). Nothing in the shell precludes it — recorded
  as the 0.1b constraint's standing answer.
- **run-document findings coverage:** window_events (the revert proof) deliberately renders in
  the report markdown only, not as a document finding; legacy (pre-V2.5b `probes`-shape) detour
  payloads render no structured document callouts (the md keeps them) — both honest omissions,
  revisit if a document surface wants them.

## V2.7a follow-up — humanize the document's identifiers — CLOSED (clock half V2.7b C10b; street-name half V2.7d)
The document spoke edge-ids and raw sim-seconds; the ratified design speaks street names and
clock times. **The CLOCK half shipped in V2.7b C10b** — `Timeline`'s profile-blind local `fmt()`
(which rendered `10:00` elapsed where a calibrated run reads `08:40`) and the near-miss tooltip
now route through `simTime`, with a python↔TS lockstep pin on the anchor map.
**The STREET-NAME half shipped in V2.7d WITHOUT the regen this entry predicted:** C0's dry run
showed the recipe does not reproduce the canonical net (32 normal + 80 internal edges added), so
the net stayed a fixed asset and names come from the tracked OSM extract by way id at export time
(`network_export.py --names-from`; `street_names.py` both halves). The golden never moved. Names
reach the draft rows, the drop form, the server's descriptions, the report + chat corpus
(name-plus-id, never name-instead-of-id) and the voice cards (nearest edge within 25 m at both
ends, else omitted). Two consumers were DEFERRED with reasons — see the V2.7d follow-ons below.

## V2.7c follow-on — the PER-LANE TABLE on the wire — SHIPPED (V2.7d C1a/C1b)
**Landed as predicted, with two corrections to the prediction:** the invariant test was RE-DERIVED
over the wire table, not retired (`test_wire_table_equals_the_net_per_lane` + the sidewalk property
at 4,214 + the residuals 28 / 23 / 6 recounted as facts + `bus_only_lanes == 23` + the width
histogram) — a pin that would only ever agree with the export is still the guard against the export
drifting from the net; and the net DOES carry bus lanes — 23 bus+bike (psv) lanes, all on Midland
Avenue — so the band is not "drawable if" but DRAWN (`road-bus-band`, #96625c, z ≥ 15; the c-arc
conflicts row "no bus data" is corrected in CLAUDE.md). `laneModel` walks the table from the curb;
the three residuals are now drawn right by construction. The original record follows.
`web/public/network.json` carries `lanes` (a COUNT that includes sidewalk lanes) and per-EDGE
`allows{car,bike,ped}` — no per-lane widths or modes. V2.7c derives the sidewalk from a rule probed
on the canonical net and PINNED by `python/tests/test_lane_model_invariant.py` (`allows.ped` => one
2.0 m ped-only lane at index 0; 4,214 of 4,570 edges), with THREE stated residuals the rule draws
wrong: 28 edges allow pedestrians on a car lane with no sidewalk (drawn with a ribbon they lack);
23 edges carry one extra non-car non-ped lane (drawn 3.2 m); six edges carry off-width car lanes
(1.6 m x4 on the `23809840` segments, 7.0 m x2 on `27040771#0/#5`; drawn 3.2 m). The exact fix is
DATA: export a per-lane `{width_m, allows}` table per edge, which changes network.json (and the
golden trajectory does NOT change — the net is untouched — but the export shape does), so it belongs
to V2.7d beside the street-name regen by the ratified c/d split. When it lands: `laneModel` reads the
table, the invariant test retires, the three residual counts become zero by construction, and a
dedicated BUS-lane band becomes drawable if the net ever carries one (it carries none today).

## V2.7a follow-up — scorecard._SAFETY_NOTE bakes "42/43/44" into single-seed artifacts — TAKEN in V2.7e C3 (Exit B)
`scorecard.py` `_SAFETY_NOTE` ("sign not stable across seeds 42/43/44; …") was the V1 default
note written into every SINGLE-seed artifact's safety cells — the same constant-seed-tuple
disease the V2.7a follow-up fixed in `report._cross_seed_sentence`, but baked into COMMITTED
artifacts. Hover-only until V2.7e C1's evidence strip put the cell notes on screen as body text —
the EXAMPLE run then READ "seeds 42/43/44" beside its own single-seed caveat, in one file. **CLOSED
at the ratified scope (Exit B, 2026-09-18):** the note DERIVES (`default_safety_note` — "single seed
(42) — cross-seed sign stability was not probed; magnitude only, directional claim not supported";
multi-seed names the seeds and leaves stability to the range; a fixture built without a run says
"seed count not recorded"); the legacy literal is KEPT and RECOGNISED by both the report's caveat and
the earned-note rewrite (`is_default_safety_note` / `strip_default_safety_prefix`), never written;
the EXAMPLE run recomputed (only its four notes changed) + its report refreshed; the two web
fixtures' notes patched in place at their vintages; `scorecard.main()` refuses a protected run
without `NADI_ALLOW_PINNED_ENRICH=1`. **BANKED, with the cost:** the PINNED run
`multimodal-scenario-20260702T044134Z` still carries the legacy literal — imprecise, not false (a
real 42/43/44 verdict exists for it; a faithful derivation reads "seeds 42, 43, 44 were run — …"),
and its recompute is ~20 MB of tracked churn plus a report refresh, under the same env. The 0709 pair,
`sample_v0_4_0.json` and the archived V2.1b smoke report keep the literal too (known vintages, read
correctly by the recognisers). **A method fact:** regenerating a committed fixture from its producer
module RE-VERSIONS it to the producer's current schema (0.10.0), which the fixtures' vintage pins
forbid by design — for a note-only change, patch through `trajectory_io.dump_artifact` in place.

## V2.7b follow-ons (recorded at the C11 closeout, from the live acceptance)

- **The interpretation's SHAPE is now a product decision, and it finally has its numbers.**
  Metered on C11's acceptance run (213 sampled voices, 3 cascades): voices **213** · discourse
  **2,231** · report **10** · chat index **2,751** — so the two stages a reader may never open
  cost **~96%** of the run, and the chat index alone (62 minutes of wall clock) is the single
  largest stage, built for a feature behind Explore · Chat. Nothing here is wrong; the cost is
  simply now legible, which is what makes the choice possible. Candidates, all deferred: per-stage
  opt-outs on the Run form; the index as an on-demand build when a reader first opens chat; fewer
  cascades by default. **Do not "fix" this by hiding the number** — the projection's whole job is
  that the number is visible before the spend.
- **The projection's two large terms are calibrated on ONE run's cascade volume.**
  `CASCADE_SCORING_PER_AGENT`, `CASCADE_POSTS_PER_CALL` and `INDEX_CALLS_PER_DOC` are measured
  constants (server.py, with their derivation in `_project_interpretation`'s docstring). A cascade
  that talks more or less, or a corpus builder change, moves them. The pin that matters
  (`test_the_projection_errs_HIGH_not_low_against_the_measured_acceptance_run`) asserts the
  direction, not the accuracy: re-derive the constants when a run's metered total approaches the
  projection rather than sitting comfortably under it.
- **The landing never attaches the run feed — SHIPPED as V2.7b F3 (`a9f1d04`).** The gap was:
  `?run=<id>` and a plain reload loaded the artifact but left `activeRunId` null, so a mid-run reload
  showed the run's completed figures with no beats, no act and no live cost until the reader
  re-opened it from the run list. The shipped fix is a SECOND id — `feedRunId`, the run the FEED
  follows — leaving `activeRunId` to mean exactly what it meant (the rail, drawing, the viewing row);
  the landing attaches only from `localStorage nadi:watchedRun`, with liveness read from `/api/runs`
  and keyed on `art.meta.run_id`. **The rest of this entry is why that shape, and not the obvious
  one — it remains a live constraint on anything that touches either id:**
  simply setting `activeRunId` on the landing replaces the ENTIRE Build rail with RunCard
  (`EditPanel.tsx` — draw-card, edge/zone palettes, DraftPanel, RunOptionsBlock), which 8 spec files
  depend on; kills map drawing (`drawing = editing && activeRunId == null`); removes the OPEN button
  for the "viewing" row, breaking run-identity and three composite-runcard tests; starts a feed on
  every cold landing whose `done` edge re-fetches the multi-MB artifact; and keying off the POINTER
  id rather than `art.meta.run_id` would mount Act I over a finished run (the pointer serves
  `default-fixture` while the body carries `school-zone-fixture`). Liveness must come from
  `/api/runs` and never `/status`, which several specs sequence. **A SIXTH failure mode the
  implementation found, which the plan had not predicted:** attaching to whichever run the list
  reports RUNNING hijacks the screen — opening run A while run B computes yanks the map into B's
  Act I, uninvited. The attach must key on durable evidence that this reader was watching that
  specific run (`nadi:watchedRun`), which is also what keeps the ratified silent-404 pin true on a
  cold landing, where nothing is remembered and the landing must do nothing.
- **A static demo cannot show baseline playback**, and the KEEP entry the plan carried for
  `<run>-baseline.json` was deliberately NOT added (checked, twice over): the harness writes that
  file only under `if (n_written and beats.on)`, so no run predating V2.7b has one and neither
  demo run qualifies; and the client reaches it through the `baseline_ready` SSE event's url,
  which a static export never fires. A demo that wants Act I's playback needs a `baselineUrl` that
  does not come from the stream — that is the honest shape of the debt. **V2.7f says it in the
  README instead** ("Watch replays a finished run's own traffic, and the live run experience …
  needs the local backend and never appears in the demo"); the demo project pins that no Act I/II
  mounts on the served bundle.
- **Per-step cascade content events** (`cascade_step` / `cascade_posts`): would give the discourse
  stage live content instead of the graph at stage end. Enters as ONE server commit — emitters in
  `propagation.py` **plus** `run_events.EVENT_NAMES` and `runStream.ts`'s `RUN_EVENT_NAMES` in the
  same change, because a server event with no client listener is silence rather than an error (the
  C7 bug `test_event_vocabulary.py` now pins against).
- **`ids[]` on the `personas` event**, so the personas card can light the sampled travelers on
  their own routes. One field, the same registry+listener duty. Until then the card shows the
  count split and the server's own basis sentence — never whatever entities happen to be loaded,
  which would render convincingly and be the wrong travelers.

## V2.7b C11 defect residuals (the two that outlived their fixes)

Both belong to defects that WERE fixed in C11b; these are the parts a fix cannot reach backwards.

- **The chat corpus fix is FORWARD-ONLY, and the served demo index still has the gap.** The
  cascade-post doc handle became unique per event in C11b, but every index built before that keeps
  the posts LightRAG refused as `batch_duplicate`. Measured from the committed artifact: the PINNED
  run (`multimodal-scenario-20260702T044134Z`) — whose index is the one served for chat — is missing
  **115 of its 1,355 clean cascade posts (8%)**. Nothing is wrong on screen; chat simply cannot cite
  what was never indexed. Rebuilding is the documented protected-run maintenance op
  (`report_agent.py --run-id <id> --rebuild` under `NADI_ALLOW_PINNED_ENRICH=1`) and costs roughly
  3–4k model calls at the measured ~2.4 calls/doc, so it is a deliberate spend, not a drive-by.
- **The staleness fix is scoped to the process holding the lock.** `run_state.read` no longer
  coerces a long-running stage to `failed` when THIS process owns that run's lock — but a CLI
  reader, or a server restarted mid-run, still does. That is the honest answer for them (neither can
  see the lock), and it means a 40-minute chat-index build looks failed to anything but the server
  that launched it. If that ever needs closing, the fix is a heartbeat write from the chain, not a
  longer timeout.

## V2.7b C11 — the empty-map caption overpromises on a FAILED baseline fetch

Found twice while closing the frame-debt gate: once in the new spec's frame, once live with a real
404. When `baseline_ready` has delivered a url and the fetch then fails, the caption head is right
(`MAP SHOWS: THE NETWORK ONLY`) but the body falls through to the PENDING wording — *"the baseline
leg is still being simulated — playback begins here when it lands"* — and it will not land. The map
is genuinely empty and the results-unaffected claim is true, so nothing about the DATA is false; the
overpromise is in the explanation, which is the surface this project holds to the same standard.
Closing it means distinguishing "no url yet" from "url arrived, fetch failed" — a `baselineFailed`
flag set by the fetch effect's error path, plus a third caption body. That is new reader-facing
copy, so it wants ratifying rather than inventing; the state is pinned either way by
`act-one.spec.ts`'s failed-fetch case, which asserts the head and the entity counts, not the body.

## V2.7d follow-ons (recorded at the C9 closeout, 2026-09-14)
- **Map STREET LABELS — DEFERRED, cost stated.** The ratified Map & Build canvas shows named streets
  on the map; the product does not. A label layer is a deck `TextLayer` on the perf-gated hot path
  (the V2.7c ladder's budgets: p95 ≥ 30 fps at every band, the icons-band crossing probe) — its own
  commit with the harness re-run at fit / z15.2 / z16.5, in e or f. Until it lands, street names are
  legible in the draft rows, the drop form, the run card, the report and the voice cards, but not on
  the map itself. Data is ready: `network.json` carries `name` per edge (4,487 named / 83 unnamed).
- **CLOSED (V2.7e C5, 2026-09-18) — `reactions.py` PROMPT NAMES, ratified at D-Q3 and landed.**
  The prompt's road is name-plus-id when the net names the edge and the pre-C5 `the corridor road
  (<id>)` byte for byte when not; bike_lane gains the name inside its mechanical sentence (never the
  description); the framing clause reads "no street names beyond those provided"; the report's
  framing phrase is the id-free AND digit-free twin (50 named edges carry digits — Highway 401 —
  and that slot's audit fails loudly on digits); the CLI descriptions ride `street_names` too.
  Gated by one live voices enrich: 65 of 212 voices named the street, 0 said the id, the only
  street token in the corpus was the provided one. The VOCABULARY VINTAGE DIVERGENCE it predicted
  is now a fact stated in CLAUDE.md beside C10's: voices before hear "the corridor road", voices
  after hear the street; committed and protected runs, their cascades and their corpora keep the
  old side (the divergence was never id → name — 0 of 4,686 committed comments said an id).
- **Window PRESETS on the drop form (AM PEAK / SCHOOL PM / ALL DAY) — NOT implemented.** The ratified
  §1d form shows preset chips; the shipped form keeps V2.2c's start + duration minutes. When built:
  AM PEAK derives from the calibrated profile's anchor map (`simTime` / `demand_profiles` — never a
  literal; the mockup's 08:00→09:00 is illustrative), SCHOOL PM renders only when the profile spans
  it (hidden on the AM profile), ALL DAY clears both, and on `synthetic_demo` only ALL DAY renders (no
  clock exists). A conflicts-table row in CLAUDE.md's V2.7d box says so.
- **The order-sensitive Playwright pair — harden the spec or the card, never `force`. THE FAMILY,
  not just the symptoms: this is the STALE-SERVER / SEQUENCED-MOCK class** — tests whose outcome
  depends on what the dev server and the mock sequence happen to be doing at the moment of the
  assertion, not on the tree. Prior members: the V2.7a F2 `/status` extra-consumer trap (a new fetch
  to a sequence-mocked endpoint advanced seeds.spec's staged progression), the V2.7b C11
  poll-restart hunt (a predicate blamed for a poll that had stopped; the mount fix moved twice), the
  c-arc load flakes (C3 run-identity's rename click-timeout, C4 act-two's card click), and the
  days-old dev server that cost 13 unrendered-shell timeouts. The two named here:
  `act-two.spec.ts:478` ("Act II adds no aggregate framing of its own, on any stage") and
  `run-identity.spec.ts:118` (the rename round-trip) both fail on a click that Playwright's call log
  shows RESOLVED, then "waiting for element to be visible, enabled and stable" (act-two) or the
  post-scroll hang — the two-frame stability wait on a card that re-renders under load (the running
  stage card's `data-status="running"` animation; the run card right after a status merge). Measured
  this arc: act-two:478 fails in-file after its 12 siblings and 1-of-2 ALONE on a fresh dev server;
  run-identity:118 failed 2-of-3 alone on BOTH the C8b tree and the committed C8a tree (stash-
  verified) on a seven-hour-old dev server, then 2/2 on a fresh one. Pre-existing (act-two:478
  reproduces on the pre-arc tree, verified at C1b), NOT this arc's regression — but every full gate
  now pays a re-run for them. **The method rule the family teaches (also in CLAUDE.md's V2.7d lesson
  ledger): a reproducing red is not the working change's until the committed tree is tried on the
  SAME server, then a fresh one — record both rates.** Candidate fixes: wait on a settled
  `data-status` before the click, or give the running card a `prefers-reduced-motion`-style test
  hook; either way a pin that the fix actually removes the instability (Playwright's
  `--repeat-each 5` green on the loaded box).
- **CLOSED (the V2.7d follow-up, 2026-09-16) — a MANUAL enrich's Act II cost line read "model calls:
  0" while it spent** (found at the V2.7d closeout's live acceptance, run
  `multimodal-scenario-20260915T051601Z`: a manual voices enrich with the chain OFF streamed 214
  voices under "model calls: 0" and the voices card's "0 calls"). CAUSE, corrected by the follow-up's
  exploration: the manual `POST /enrich` wrote NOTHING to the ledger (no projection, no stage rows —
  its one ledger touch was `_absorb_usage` after every subprocess had exited), the client's enrich
  launch re-read no ledger, and the C11 projection re-read fires once and never retries; the "0 calls"
  on the voices CARD was the chain-off ledger's `llm_calls: 0` seeded as a number where an unseeded
  stage renders ''. `stage_usage` is emitted once at the stage's process exit, so mid-stage NOTHING
  is metered — the honest numerator is zero, and the fix is the denominator: the POST now writes the
  STAGE's projection (`_project_stage`, the same terms as the whole) synchronously before its
  `stage_start` line, the client re-reads it on the enrich launch (replacing a reopened run's
  whole-chain number), and the line's title says a zero beside an estimate is not yet metered, not
  free. The RATIFIED resting state — `model calls: 0 of ~215` with the basis, then `47 of ~215` once
  the stage reports — is pinned by content (enrich-stream.spec); a progress-derived floor was
  deliberately NOT built (a second client-derived cost model, and stage-inconsistent).
- **Act I's beat-4 held panel re-shows over Act II when Watch is entered during a manual enrich of an
  already-finished run** ("NO WITHDRAWAL — THIS CHANGE HAS NO WINDOW", the results-ready beat, over the
  streaming voices — `docs-assets/v27d-acceptance-voices-od.png`). CAUSE: the beats fold from the
  durable event log on every Watch entry and the held moment keys on the results-ready beat, not on
  whether the reader already read past it. Cosmetic ("a moment, not a gate", dismissable) — V2.7b
  territory; decide whether a run that has ended dismisses the held moment by default.
  **REPRODUCED 2026-09-18 (V2.7e C5's gate enrich):** over Act II on entering Watch, then over
  playback after the enrich ended (`docs-assets/v27e-c5-live-act2-first.png`,
  `v27e-c5-live-held-panel-after-enrich.png`).
- **CLOSED (V2.7f C2, 2026-09-20) — the stage panel under the held moment said "Building the chat
  index … It is still working" for a stage that was not running** (V2.7e C5's gate;
  `v27e-c5-live-act2-first.png`). The selection rule was the follow fallback's `!== 'pending'`,
  which counted a ledger-seeded `skipped` as started, and the chat-index card is last in the rail;
  the body keyed on `done` alone; a skipped row's `llm_calls: 0` rendered as "0 calls". Now the
  fallback and the per-card count key on `STAGE_STARTED` (skipped is a verdict), the index panel
  renders one sentence pair per status ("was not built in this run — this stage did not run"), the
  discourse stage has a skipped branch, and the pin (act-two.spec) surfaced the terminal-edge merge
  letting a row still `running` overturn stream-settled statuses at seed on a re-enrich — fixed in
  the same commit (`v27f-c2-manual-voices-panel.png`, `v27f-c2-index-did-not-run.png`).
- **GraphSplitView's oasis-empty copy says "Run it from the ✏️ Edit rail"** (found by V2.7f C4's
  demo frame `v27f-demo-graphs-example.png`): the ✏️ Edit rail is vocabulary retired at V2.7a, and
  in the static demo it is an instruction the visitor cannot follow. graphs.spec pins the empty
  states' text, so it wants its own small commit: name the Build stage's run card (and, in the
  demo, the shipped run that carries a cascade, as the discourse caption now does).
- **Lifetime spend across re-enrichs is NOT tracked (a stated non-goal, V2.7f C0/C1):** a ledger
  row is the stage's LAST job's count (`begin_stage` resets it), so "This run’s stages as they
  stand cost N model calls" can DROP after a voices re-enrich on a chained run — the sentence says
  what the rows are, on purpose. Tracking lifetime spend would need a per-job history in the
  ledger; not built, recorded.
- **An Act II voice card cannot be framed once the enrich ends — twice now DOM-quoted, never
  framed** (d's acceptance and e's C5: the two omitted-od-line simulated cards, vehicles 156 and 40
  on the acceptance run, identified by artifact geometry; Act II unmounts on the done edge's 1.5 s
  poll before an element capture lands). A product item, not a test item: a way to reopen Act II's
  voices panel over a finished run (or a voice card in the feed that carries the od line) so a
  specific card can be looked at without another spend.
- **Cyclist personas speculate a closure creates "a protected bike lane"** ("If closing a car lane
  means there's finally a protected bike lane on Lawrence…" — `cautious_cyclist`, `bike_commuter`):
  12 such comments on the acceptance run BEFORE V2.7e C5 and 14 after, so the persona's own prior
  and not the prompt-names change; the prompt's mechanical sentence says the lane is CLOSED and says
  nothing about reallocation. A persona-prior honesty item: decide whether the cyclist personas'
  descriptions or the closure line should say a closed lane is not a bike lane.
- **`server.py:1067/1069` — the composite description has no singular guard** ("1 changes on the
  corridor" / "1 speed-limit changes"); only the school-zone branch at 1065 pluralizes. Found by the
  C10 exploration, pre-existing (V2.4b), not d's. Reachability doubtful: a 1-member draft takes the
  single-change path, so only a TAGGED non-speed 1-member composite could hit it. One-line fix when a
  hand is next in that function; banked with its cause, not fixed in the closeout.
- **CLOSED (the V2.7d follow-up, 2026-09-16) — the run card's voices button said "~1¢" beside an
  enrich that meters ~213 model calls** (`RunCard.tsx` — V2.3a-era literals under a comment claiming
  they were "pulled from the metered actuals"; "$" on the report button, which ALSO rebuilds the chat
  index, the single largest metered term). Now every price derives from `GET /api/projection`'s
  per-stage `stages` (the same `_project_stage` the manual enrich writes into the ledger — one cost
  model, three callers) as "~N calls" with the stage basis as its title, or renders NO price when the
  endpoint is unreachable or shapeless; no cost literal survives, and the unit is model calls because
  no per-call price exists in this repo. `armed` is not consulted — the buttons spend regardless.
  Pinned in edit.spec (the derived labels; the `¢`/`$` sweep over the card).
- **CLOSED (the V2.7d follow-up, 2026-09-16) — the held moment said "Interpretation is already
  underway below" on a chain-OFF run** (`docs-assets/v27d-acceptance-build.png` / `-read.png`). The
  CAUSE first recorded here (the facts-only `results` stage_end) was WRONG at the fold level: that
  event has no key in `STATE_TO_KEYS` and folds to a no-op. The real poison: `run_ledger.end()`
  marks every never-run stage `skipped`, the server writes that BEFORE emitting `run_ended`, the
  client's C10b terminal-edge re-read merges the six `skipped` statuses in, and `chainState`
  counted any non-`pending` status as started — 'none' for one paint, then 'running'. The three
  footer pins stayed green because `mockActOne` routed the ledger as null, so the re-read had
  nothing to merge. Fixed: a stage is started only when its status is `running`/`done`/`partial`/
  `failed`; the hook's inline duplicate of the check now calls `chainState`; the docstring states
  the true premise. The chain-off pin replays the server's real four-line tail over the real
  chain-off ledger (act-one.spec), with test_stage_runner pinning the same literal sequence
  server-side. Related, unchanged: the same panel stays up over Build and Read until dismissed — by
  design (a moment, dismissable), noted so the acceptance frames are read right.
- **Banked by the follow-up's exploration (V2.7b territory; (a) and (b) CLOSED at V2.7f C0/C1,
  2026-09-20 — `begin_stage` starts a row fresh per job, the manual POST begins its rows and stamps
  `keys` on `stage_start`, the job closes them, the client scopes the cost line on the keys and
  clears it on a keyless start, the terminal re-read keys on an `endings` counter, and the truthy
  placeholder no longer overwrites a real projection; the rest stay banked):** (a) the ledger ACCUMULATES
  `llm_calls` (`add_llm_calls` +=) while the stream fold SETS them — a re-enrich reads 426 in the
  ledger against 213 live, and the terminal-edge merge prefers the ledger **— SEEN LIVE 2026-09-18
  (V2.7e C5's gate, the second voices enrich of the acceptance run): the ledger's voices row read
  426 afterwards with its status still `skipped`, and the FIRST frame of the re-enrich (+3 s) read
  "model calls: 213 of ~215" with the voices card already "✓ 213 calls" — the prior enrich's count
  seeded from the ledger row and rendered as if this enrich were complete; the ratified "0 of ~215"
  resting state is a first enrich's only**; (b) that merge takes
  `durable.projection ?? prev.projection`, and the placeholder `{calls: null, basis: ""}` is truthy —
  it can overwrite a good projection, and it overwrites stage STATUSES from a ledger the manual path
  never updates (a manual `stage_end` cannot flip a `skipped`-seeded stage to `done`: the fold's
  guard takes the verdict only on `running` stages); (c) the manual `stage_start` carries
  `label: "enrich:voices"` (machinery) where the chain sends the human label, and the first card's
  detail shows it; (d) `_project_interpretation(instrumented=…)` has no caller, so the basis's "the
  run's own count replaces this" promise is never fulfilled (the chain could pass the sampler's
  count after personas); (e) a pre-V2.7b run gets a ledger initialised with `quant: running` by
  `ensure()` at its first manual enrich (via `_absorb_usage` before, `set_projection` now too);
  (f) `_run_cmds` emits `stage_end` only — the quant leg's `stage_start` says `quant` and its
  `stage_end` says `simulate`, and the facts-only document ends a `results` stage nothing started;
  no pin covers a stage-field VALUE (only event names are lockstepped) and none locksteps
  `run_ledger.STAGE_KEYS` with `runFeed.ts`'s.
- **The RunCard's `rename-toggle` uses `.ed-link .ed-sub`** — a button styled as a sub-line; if the
  run card gets a §-source in a later design session, its identity affordance is the row to revisit.
