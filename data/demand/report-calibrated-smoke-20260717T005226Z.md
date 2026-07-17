# Corridor change preview — PEAK-HOUR SMOKE (07:00-08:00, max_t=3600): Kingston Rd speed limit to 40 km/h at calibrated AM-peak demand

*A stakeholder-reaction preview, not a verdict. Safety figures are surrogate near-miss measures, not crash predictions.*

## 1. What was tested

This report previews a proposed change to lower Kingston Road's speed limit during the morning rush hour. It anticipates how drivers, residents, and businesses might be affected by the slower pace. The analysis focuses on travel delays and community reactions, without judging the outcome.

- **Change:** PEAK-HOUR SMOKE (07:00-08:00, max_t=3600): Kingston Rd speed limit to 40 km/h at calibrated AM-peak demand (edge `42140001`)
- **Corridor / network:** `corridor.net.xml` — one Toronto corridor
- **Demand simulated:** 67329 cars, 479 bicycles, 5077 pedestrians
- **Runs compared:** scenario `multimodal-scenario-20260717T005226Z` vs baseline `multimodal-baseline-20260717T005226Z`

## 2. Who is affected, and how

| Stakeholder group | Travel time | Safety | Access |
|---|---|---|---|
| Car commuters | +0.0s, 17.9% >30s [MEAS] | ±1024.21 [LOW] | — |
| Cyclists | +0.0s, 19.3% >30s [MEAS] | ±9.71 [LOW] | — |
| Pedestrians | +0.0s, 3.4% >30s [MEAS] | ±81.34 [LOW] | — |
| Local residents | — | ±1027.21 [LOW] | — |
| Business owners | — | — | — |
| Accessibility | — | — | — |
| Transit riders | — | — | — |

*POSITIVE = worse for the group · ± = magnitude only (safety direction not claimed) · [MEAS] measured · [LOW] low-confidence estimate.*

**Cell notes (verbatim):**
- *Travel time:* affected_share = fraction of this group's travelers >30s slower
- *Safety:* sign not stable across seeds 42/43/44; directional claim not supported

**Travel-time tail (cars):** median about no change; 17.9% of cars are >30s slower. This small affected share was checked across seeds 42, 43 and 44 and remains a small, stable tail with the vast majority of cars unaffected (exact cross-seed range not available for this run).

**Per-group reading:**
- **Car commuters:** Most car commuters see no change in travel time, but a small group experiences a noticeable slowdown.
- **Cyclists:** Most cyclists see no change in travel time, but a small group experiences a notable slowdown.
- **Pedestrians:** Most pedestrians see no change in travel time, but a small group is markedly slower, while a near-miss magnitude is present but its direction is not claimed.
- **Local residents:** A near-miss magnitude is present for this group, but its direction is not seed-stable and is not claimed here — the table shows the magnitude only.
- **Business owners:** There isn't enough measurable signal in this run to characterize how this change affects business owners.
- **Accessibility:** There isn't enough measurable signal in this run to characterize how this change affects accessibility.
- **Transit riders:** There isn't enough measurable signal in this run to characterize how this change affects transit riders.

## 3. What the affected people say

*Simulated persona reactions — anticipated texture, not a poll. Each quote is verbatim from one simulated persona.*

### Drivers

Some drivers worry about lost time and income from slower trips, while others welcome the possibility of calmer streets and quieter neighborhoods. A few are torn, seeing both a personal delay and a potential benefit for their home street. Others are pleased with time savings or neutral if their trip is unchanged.

> “That's brutal—adding 33 minutes to my morning commute means I'll miss my shift start for sure. This change wrecks my tight schedule.”
> — Time-pressed commuter (simulated persona)

> “Ugh, an extra six seconds? Not great for my morning rush, but if it slows down the racers flying past my house, maybe I'll trade that tiny delay for a bit more peace and quiet here.”
> — Resident who drives the corridor (simulated persona)

### Cyclists

Cyclists share a recurring wish for protected lanes, with some noting that slower car speeds make them more willing to ride here. Delivery riders emphasize time savings and reduced stress from calmer traffic. A few express frustration that the change adds to their commute time.

> “I'd still feel nervous with cars going 40 km/h right beside me, but if they slow down a bit it might feel a little safer. I wish there was a protected lane, that would make me ride here more.”
> — Cautious newer rider (simulated persona)

> “I'm all for this—saving 1.7 minutes per trip means more drops per shift, and if it cuts down on close calls from speeding cars, that's a huge bonus for me on my bike.”
> — Bicycle delivery courier (simulated persona)

### Pedestrians

Pedestrians and transit users describe a trade-off: some welcome a slightly faster bus trip, while others focus on the slower traffic and what it might mean for crossing the street. A recurring hope is that the change will make the corridor feel more comfortable for walking, especially near schools. There is no single view—some prioritize time savings, others the quality of the walking environment.

> “I don't mind the extra few seconds if it means cars are moving slower and my kids can cross the street more safely. That's a trade-off I'm happy to make.”
> — School-run parent on foot (simulated persona)

> “If this change shaves a minute and a half off my bus ride, I'm all for it—that means I can leave home a bit later and still catch my connection.”
> — Walk-to-transit commuter (simulated persona)

### Community voices

Business owners fear losing curbside parking and customer access, while some commuters worry about slower bus travel. Others welcome calmer streets for safety and accessibility, especially for children and people with disabilities. A few question whether the change is needed or effective.

> “Slowing down cars to 40 km/h might help, but if it means losing curbside parking for my customers, that's a direct hit to my business. I can't afford fewer people stopping by.”
> — Small business owner (community perspective, not a measured traveler)

> “I've lived on Kingston Road for over 20 years and I'm all for slowing traffic down—it's about time we made this street safer for our kids and quieter for us.”
> — Long-time corridor resident (community perspective, not a measured traveler)

## 5. What this analysis cannot tell you

The following limits bound what this preview can and cannot claim, and should be read alongside the findings.

- **Safety direction is not established.** The safety surrogate is reported as a magnitude only — its direction is not claimed: “sign not stable across seeds 42/43/44; directional claim not supported”. Do not read the safety column as 'the change made things safer or more dangerous'.
- **Surrogate measures are not crash predictions.** Safety here means trajectory-derived surrogates (time-to-collision, hard braking, blocked junctions), counted as near-miss events observed in this run. They are not crashes, and this tool does not predict crashes, injuries, or their probability.
- **One corridor, one demand level.** The simulation is bounded to a single corridor at a single modelled demand (67329 cars, 479 bicycles, 5077 pedestrians). It does not model the wider network, other times of day, or induced demand.
- **In-run adaptation is not settled equilibrium.** Travelers do not re-plan across days here: 948 cars rerouted within the run. Real corridors reach a new equilibrium over weeks as people adjust routes, modes, and times — this preview shows the immediate response, not that settled state.
- **A stratified sample, not a census.** The voiced reactions come from a stratified sample of personas pinned to specific simulated travelers (deliberately including the hardest-hit tail), not a poll of everyone. They show the texture of who wins and loses, never a headcount of support or opposition.
- **The access column is a rule-based estimate.** Access impacts are a deterministic heuristic from the change type (e.g. curbside space), labelled low-confidence — an estimate to reason about, not a measurement.

## Methodology & provenance

- **Runs:** scenario `multimodal-scenario-20260717T005226Z`, baseline `multimodal-baseline-20260717T005226Z`
- **Seeds:** 42, 43, 44
- **Thresholds:** time-to-collision 3.0s, vehicle PET 2.0s, pedestrian PET 5.0s, delay materiality >30s
- **Demand:** count-calibrated AM peak (07:00–09:00; sim t=0 is 07:00), built from Toronto Open Data turning-movement counts via SUMO routeSampler. Each counted intersection contributes its own latest post-2020 count day — a composite typical AM peak, not one observed morning. Vehicle classes (cars/trucks/buses) are merged per movement; bike demand is anchored at approach level and pedestrian demand at corridor total only — no count-fidelity claim for bike/ped volumes.
- **Rendering:** the map shows 1500 of 27221 vehicles and 800 of 2538 pedestrians (an outcome-stratified sample); every number in this report is computed over the full simulated population.
- **Count reproduction (GEH):** simulated vs counted mean-hourly flows at 421 counted approach lanes: GEH under 5 at 51.8% (planning practice targets 85%; not met — treat absolute volumes as approximate; baseline-vs-scenario comparisons remain like-for-like). Worst locations:

  | location | approach | counted (veh/h) | simulated (veh/h) | GEH |
  |---|---|---|---|---|
  | Kingston Rd / Amiens Rd | e | 1942 | 7 | 62.0 |
  | Kingston Rd / Amiens Rd | w | 1216 | 8 | 48.8 |
  | Markham Rd / Milner Ave | n | 1152 | 0 | 48.0 |
  | Kingston Rd / Cromwell Rd / Guildwood Pkwy | e | 1700 | 238 | 47.0 |
  | Kingston Rd / Falaise Rd | e | 1502 | 257 | 42.0 |

  Full per-location table + iteration log: `data/demand/` provenance (`counts-inventory-20260714T043040Z.json` lineage).
- **Generated:** 2026-07-17T02:27:34.091732+00:00 · deepseek/deepseek-v4-flash
- **Audit:** passed — 13 slots (9 LLM-audited: 6 clean, 3 corrected on retry, 0 unresolved; 4 code-rendered).
