# Corridor change preview — Closed 2 of 3 car lanes on edge 42140001 from 07:10 to 07:40

*A stakeholder-reaction preview, not a verdict. Safety figures are surrogate near-miss measures, not crash predictions.*

## 1. What was tested

This report previews a proposed change on one Toronto corridor where two car lanes would be closed during a short morning window, leaving the road open in the remaining lane(s). The text anticipates how different people—drivers, transit users, nearby residents—might be affected by that temporary lane closure, without judging whether the change is good or bad.

- **Change:** Closed 2 of 3 car lanes on edge 42140001 from 07:10 to 07:40 (edge `42140001`, lanes [1, 2]) — active from 07:10 to 07:40
- **Corridor / network:** `corridor.net.xml` — one Toronto corridor
- **Demand simulated:** 67329 cars, 479 bicycles, 5077 pedestrians
- **Runs compared:** scenario `multimodal-scenario-V22AACCEPT` vs baseline `multimodal-baseline-V22AACCEPT`
- **Closure window (verified):** applied at 07:10, reverted at 07:40 — the restored road state was checked against the exact pre-closure capture (restored == captured).
- **Non-completions under the closure:** 734 cars, 1 bicycles, 9 pedestrians completed in baseline but not in the closure run — counted here as non-completions, never averaged into travel-time deltas.
- **Diverted:** 999 cars ended on a different route than baseline; the travel-time cells in section 2 are the delay on the alternates (matched travelers only).

## 2. Who is affected, and how

| Stakeholder group | Travel time | Safety | Access |
|---|---|---|---|
| Car commuters | +0.0s, 16.1% >30s [MEAS] | ±376.81 [LOW] | +0.50 [LOW] |
| Cyclists | +0.0s, 15.4% >30s [MEAS] | ±11.62 [LOW] | — |
| Pedestrians | +0.0s, 3.6% >30s [MEAS] | ±34.85 [LOW] | — |
| Local residents | — | ±375.06 [LOW] | — |
| Business owners | — | — | — |
| Accessibility | — | — | — |
| Transit riders | — | — | — |

*POSITIVE = worse for the group · ± = magnitude only (safety direction not claimed) · [MEAS] measured · [LOW] low-confidence estimate.*

*Scorecard measures cover the full simulated period (07:00–08:00); the change was active from 07:10 to 07:40 of it. Effects during the active window are diluted by the periods before and after it.*

**Cell notes (verbatim):**
- *Travel time:* affected_share = fraction of this group's travelers >30s slower
- *Safety:* sign not stable across seeds 42/43/44; directional claim not supported. At peak density, safety surrogates are dominated by queue interactions; raw conflict counts are not comparable across demand profiles, and pedestrian conflicts are proportionally under-represented relative to vehicle car-following events. Conflict stream in the artifact is a severity-stratified sample of 199848 observed events
- *Access:* rule-based estimate; applies during the closure window

**Travel-time tail (cars):** median about no change; 16.1% of cars are >30s slower. This small affected share was checked across seeds 42, 43 and 44 and remains a small, stable tail with the vast majority of cars unaffected (exact cross-seed range not available for this run).

**Per-group reading:**
- **Car commuters:** Most car commuters see no change in their typical travel time, but a small group is markedly slower, and access is slightly worse.
- **Cyclists:** Most cyclists see no change in their typical travel time, but a small group experiences a marked slowdown, while the safety signal is present but its direction is not claimed.
- **Pedestrians:** Most pedestrians see no change in typical travel time, but a small group is markedly slower, while the safety signal remains directionally unclaimed.
- **Local residents:** For this group, a near-miss magnitude is present, but its direction is not claimed (not seed-stable) — the table shows the magnitude only.
- **Business owners:** There isn't enough measurable signal in this run to characterize how this change affects business owners.
- **Accessibility:** There isn't enough measurable signal in this run to characterize how this change affects accessibility.
- **Transit riders:** There isn't enough measurable signal in this run to characterize how this change affects transit riders.

## 3. What the affected people say

*Simulated persona reactions — anticipated texture, not a poll. Each quote is verbatim from one simulated persona.*

### Drivers

Reactions split between those who see added delay as a real cost to their routine or earnings and those who find the change negligible or even beneficial. A recurring hope is that calmer traffic near the school justifies the trade-off, while some remain wary of disruption despite personal gains. The tension centers on whether modest personal losses are worth broader street calm.

> “This throws my whole morning off — 35 extra minutes is brutal when I've got a school drop-off and a shift to make. I can't just absorb that kind of delay.”
> — Time-pressed commuter (simulated persona)

> “An extra minute and a half is a small price to pay if it means calmer traffic and safer streets for the kids near the school.”
> — Safety-conscious driver-parent (simulated persona)

### Cyclists

The reactions show a clear trade-off between travel time and comfort, with many riders willing to accept small delays if it means less traffic squeezing past them. Some express frustration over longer commutes, while others see time savings as a benefit, especially those paid per delivery. A recurring theme is the desire for a calmer, less stressful ride, even if it costs a few extra minutes.

> “This is brutal for my commute — adding 12 minutes to an already long ride, and I’m guessing I’ll be squeezed even worse in the remaining lane. I need a safe route, but this delay makes me wonder if it’s worth it.”
> — Daily bike commuter (simulated persona)

> “Saving 3.3 minutes on my run means I can fit in another delivery, and if the lane change cuts down on close calls, even better for my nerves.”
> — Bicycle delivery courier (simulated persona)

### Pedestrians

The reactions center on a trade-off between minor travel time changes and the perceived quality of the walking and crossing experience. Many are willing to accept a few extra seconds if it means calmer traffic and a more comfortable crossing, especially for those with children. Others focus on the convenience of catching the bus more easily, while a few simply hope the changes don't make crossing feel more rushed. The shared texture is a pragmatic acceptance of small time shifts in exchange for a more pleasant and less stressful pedestrian environment.

> “A bit slower, but I'm on foot with the kids—slower traffic sounds safer at the crossings, so I'm okay with it.”
> — School-run parent on foot (simulated persona)

> “Two minutes shaved off my trip is a welcome surprise—less time waiting around means I can catch my bus with a bit more breathing room. As long as the walk to the stop stays safe, this works for me.”
> — Walk-to-transit commuter (simulated persona)

### Community voices

Shop owners and delivery-dependent voices worry about access, parking, and congestion during the morning rush, while long-time residents hope for calmer streets and a more neighborhood feel. Some transit riders are cautiously open if it helps buses, and accessibility advocates stress the need for clear cues and extra crossing time. The tension is between commercial and commuter flow on one side and quality-of-life and accessibility on the other.

> “Closing a lane during my morning rush is going to make it even harder for customers to get here and find parking—my shop depends on that curb access, and this could really hurt my business.”
> — Small business owner (community perspective, not a measured traveler)

> “I've lived here for years, and any move that slows down traffic and makes the street feel more like a neighborhood is a win. The morning rush is a constant noise and safety worry, so closing a couple lanes for half an hour sounds like a step in the right direction.”
> — Long-time corridor resident (community perspective, not a measured traveler)

### Institutional perspectives (mandate lens)

*Generated by this tool from each organization's published mandate and this run's computed facts — not statements by, from, or on behalf of the named organizations.*

**City of Toronto Transportation Services** — published mandate ([https://www.toronto.ca/city-government/accountability-operations-customer-service/city-administration/staff-directory-divisions-and-customer-service/transportation-services/](https://www.toronto.ca/city-government/accountability-operations-customer-service/city-administration/staff-directory-divisions-and-customer-service/transportation-services/), retrieved 2026-08-01):
> “to provide a safe, efficient, and effective transportation system that serves our residents, businesses, and visitors in an environmentally, socially and economically sustainable manner.”

- 999 of 19829 matched car trips diverted onto other streets during the run.
- Trips that completed in the baseline but not this scenario: 744 (car 734, bicycle 1, pedestrian 9).

## 5. What this analysis cannot tell you

The following limits bound what this preview can and cannot claim, and should be read alongside the findings.

- **Safety direction is not established.** The safety surrogate is reported as a magnitude only — its direction is not claimed: “sign not stable across seeds 42/43/44; directional claim not supported. At peak density, safety surrogates are dominated by queue interactions; raw conflict counts are not comparable across demand profiles, and pedestrian conflicts are proportionally under-represented relative to vehicle car-following events. Conflict stream in the artifact is a severity-stratified sample of 199848 observed events”. Do not read the safety column as 'the change made things safer or more dangerous'.
- **Surrogate measures are not crash predictions.** Safety here means trajectory-derived surrogates (time-to-collision, hard braking, blocked junctions), counted as near-miss events observed in this run. They are not crashes, and this tool does not predict crashes, injuries, or their probability.
- **One corridor, one demand level.** The simulation is bounded to a single corridor at a single modelled demand (67329 cars, 479 bicycles, 5077 pedestrians). It does not model the wider network, other times of day, or induced demand.
- **In-run adaptation is not settled equilibrium.** Travelers do not re-plan across days here: 999 cars rerouted within the run. Real corridors reach a new equilibrium over weeks as people adjust routes, modes, and times — this preview shows the immediate response, not that settled state.
- **A stratified sample, not a census.** The voiced reactions come from a stratified sample of personas pinned to specific simulated travelers (deliberately including the hardest-hit tail), not a poll of everyone. They show the texture of who wins and loses, never a headcount of support or opposition.
- **The access column is a rule-based estimate.** Access impacts are a deterministic heuristic from the change type (e.g. curbside space), labelled low-confidence — an estimate to reason about, not a measurement.
- **A windowed change: scorecard measures cover the whole run.** Scorecard measures cover the full simulated period (07:00–08:00); the change was active from 07:10 to 07:40 of it. Effects during the active window are diluted by the periods before and after it.
- **A temporary event, previewed as the day-one response only.** The closure or incident applies and is lifted within the simulated period. Temporary events have no settled equilibrium, so no iterated-assignment claim is made — what you see is how travelers respond within the run (diverting, queueing, or not completing), not how the corridor would adapt to a permanent change.
- **Institutional perspectives are generated, not statements.** Institutional perspectives are generated by this tool: each recites the named organization's published mandate (sourced, with its retrieval date) against this run's computed facts. They are not statements by, from, or on behalf of the named organizations, and the mandate quote is only as current as its retrieval date.

## Methodology & provenance

- **Runs:** scenario `multimodal-scenario-V22AACCEPT`, baseline `multimodal-baseline-V22AACCEPT`
- **Seeds:** 42
- **Thresholds:** time-to-collision 3.0s, vehicle PET 2.0s, pedestrian PET 5.0s, delay materiality >30s
- **Demand:** anchored to 126 interior counted intersections (2023–2026, multimodal 15-min counts), GEH-validated at 51.8% of 421 counted approach links (industry target 85%). Absolute volumes are approximate — the corridor's boundary inflow and default signal timing under-deliver demand at busy links. Baseline-vs-scenario comparisons use identical demand, so this systematic bias cancels in the delta: the tool's comparisons are like-for-like even where absolute volumes are approximate.
- **Demand construction:** Toronto Open Data turning-movement counts via SUMO routeSampler (sim t=0 is 07:00); each intersection contributes its own latest count day — a composite typical AM peak. Vehicle classes merged per movement; bike demand anchored at approach level and pedestrian demand at corridor total only — no count-fidelity claim for bike/ped volumes.
- **Rendering:** the map shows 801 of 27127 vehicles and 801 of 2538 pedestrians (an outcome-stratified sample); conflict flares are a severity-stratified sample; every number in this report is computed over the full simulated population.
- **Worst counted locations (GEH):**

  | location | approach | counted (veh/h) | simulated (veh/h) | GEH |
  |---|---|---|---|---|
  | Kingston Rd / Amiens Rd | e | 1942 | 7 | 62.0 |
  | Kingston Rd / Amiens Rd | w | 1216 | 8 | 48.8 |
  | Markham Rd / Milner Ave | n | 1152 | 0 | 48.0 |
  | Kingston Rd / Cromwell Rd / Guildwood Pkwy | e | 1700 | 238 | 47.0 |
  | Kingston Rd / Falaise Rd | e | 1502 | 257 | 42.0 |

  Full per-location table + iteration log: `data/demand/` provenance (`counts-inventory-20260714T043040Z.json` lineage).
- **Assignment:** day-one response — travelers use today's route habits; no iterated adjustment was applied.
- **Day-one vs settled, in plain terms:** a day-one run answers "what happens the morning this change appears" — every traveler still follows the route habits they had before, and the numbers show the shock response. A settled run answers "what does this corridor look like after people have had time to adjust" — driver route choices are re-computed repeatedly until overall travel times stop shifting, approximating the adjusted state. Neither is more true; they answer different planning questions, and the difference between them is itself informative (it shows how much adaptation the change invites). Settled response iterates driver route choice; pedestrian and cyclist routes are held fixed, so adaptation is modeled for drivers only.
- **Generated:** 2026-08-11T20:48:07.279052+00:00 · deepseek/deepseek-v4-flash
- **Audit:** passed — 13 slots (9 LLM-audited: 8 clean, 1 corrected on retry, 0 unresolved; 4 code-rendered).
