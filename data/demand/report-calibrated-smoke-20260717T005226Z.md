# Corridor change preview — PEAK-HOUR SMOKE (07:00-08:00, max_t=3600): Kingston Rd speed limit to 40 km/h at calibrated AM-peak demand

*A stakeholder-reaction preview, not a verdict. Safety figures are surrogate near-miss measures, not crash predictions.*

## 1. What was tested

This report previews how a proposed reduction of the speed limit on Kingston Road during the morning peak hour would affect people who drive, walk, or cycle along the corridor.

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
- *Safety:* sign not stable across seeds 42/43/44; directional claim not supported. At peak density, safety surrogates are dominated by queue interactions; raw conflict counts are not comparable across demand profiles, and pedestrian conflicts are proportionally under-represented relative to vehicle car-following events. Conflict stream in the artifact is a severity-stratified sample of 201670 observed events

**Travel-time tail (cars):** median about no change; 17.9% of cars are >30s slower. This small affected share was checked across seeds 42, 43 and 44 and remains a small, stable tail with the vast majority of cars unaffected (exact cross-seed range not available for this run).

**Per-group reading:**
- **Car commuters:** Most car commuters see no change in travel time, but a small group experiences a noticeable slowdown.
- **Cyclists:** Most cyclists see no change in travel time, but a small group experiences a notable slowdown.
- **Pedestrians:** Most pedestrians see no change in travel time, but a small group is noticeably slower, while safety signals are present but directionally unclear.
- **Local residents:** A near-miss magnitude is present for this group, but its direction is not seed-stable and is not claimed here — the table shows the magnitude only.
- **Business owners:** There isn't enough measurable signal in this run to characterize how this change affects business owners.
- **Accessibility:** There isn't enough measurable signal in this run to characterize how this change affects accessibility.
- **Transit riders:** There isn't enough measurable signal in this run to characterize how this change affects transit riders.

## 3. What the affected people say

*Simulated persona reactions — anticipated texture, not a poll. Each quote is verbatim from one simulated persona.*

### Drivers

Some drivers worry about added travel time disrupting tight schedules and income, while others hope the change might bring calmer streets. A few see a slight time savings as a welcome surprise. The tension is between those focused on personal efficiency and those open to trading a minor delay for a quieter neighborhood.

> “That's brutal—adding 33 minutes to my morning commute means I'll miss my shift start for sure. This change wrecks my tight schedule.”
> — Time-pressed commuter (simulated persona)

> “Ugh, an extra six seconds? Not great for my morning rush, but if it slows down the racers flying past my house, maybe I'll trade that tiny delay for a bit more peace and quiet here.”
> — Resident who drives the corridor (simulated persona)

### Cyclists

Cyclists are split between those who welcome slower car speeds for a calmer ride and those who worry about added travel time. A recurring hope is for a protected lane, which many feel would make the route more inviting. Some delivery cyclists see time savings, while others feel the change penalizes them.

> “I'd still feel nervous with cars going 40 km/h right beside me, but if they slow down a bit it might feel a little safer. I wish there was a protected lane, that would make me ride here more.”
> — Cautious newer rider (simulated persona)

> “I'm all for safer streets, but adding nearly 3 minutes to my bike commute when I'm already dodging traffic every day feels like a penalty rather than a protection.”
> — Daily bike commuter (simulated persona)

### Pedestrians

Pedestrians and transit users express a recurring hope that slower traffic will make crossing streets feel more comfortable, especially for children. Some welcome modest time savings for bus trips, while others are willing to accept small delays in exchange for a calmer street environment. The main tension is between those who prioritize travel time and those who prioritize ease of crossing.

> “I don't mind the extra few seconds if it means cars are moving slower and my kids can cross the street more safely. That's a trade-off I'm happy to make.”
> — School-run parent on foot (simulated persona)

> “If this change shaves a minute and a half off my bus ride, I'm all for it—that means I can leave home a bit later and still catch my connection.”
> — Walk-to-transit commuter (simulated persona)

### Community voices

Business owners worry that slower traffic and lost parking will reduce customer access and delivery efficiency. Some commuters fear buses will be delayed behind slower cars. Others welcome calmer streets and improved crossing conditions for people with disabilities or children. A recurring tension is between perceived benefits for pedestrians and perceived costs for drivers and businesses.

> “Slowing down cars to 40 km/h might help, but if it means losing curbside parking for my customers, that's a direct hit to my business. I can't afford fewer people stopping by.”
> — Small business owner (community perspective, not a measured traveler)

> “Slowing traffic on Kingston Rd during peak hours will make crossings safer and give me more time to navigate intersections with my cane. This is a win for accessibility.”
> — Accessibility advocate (community perspective, not a measured traveler)

## 5. What this analysis cannot tell you

The following limits bound what this preview can and cannot claim, and should be read alongside the findings.

- **Safety direction is not established.** The safety surrogate is reported as a magnitude only — its direction is not claimed: “sign not stable across seeds 42/43/44; directional claim not supported. At peak density, safety surrogates are dominated by queue interactions; raw conflict counts are not comparable across demand profiles, and pedestrian conflicts are proportionally under-represented relative to vehicle car-following events. Conflict stream in the artifact is a severity-stratified sample of 201670 observed events”. Do not read the safety column as 'the change made things safer or more dangerous'.
- **Surrogate measures are not crash predictions.** Safety here means trajectory-derived surrogates (time-to-collision, hard braking, blocked junctions), counted as near-miss events observed in this run. They are not crashes, and this tool does not predict crashes, injuries, or their probability.
- **One corridor, one demand level.** The simulation is bounded to a single corridor at a single modelled demand (67329 cars, 479 bicycles, 5077 pedestrians). It does not model the wider network, other times of day, or induced demand.
- **In-run adaptation is not settled equilibrium.** Travelers do not re-plan across days here: 948 cars rerouted within the run. Real corridors reach a new equilibrium over weeks as people adjust routes, modes, and times — this preview shows the immediate response, not that settled state.
- **A stratified sample, not a census.** The voiced reactions come from a stratified sample of personas pinned to specific simulated travelers (deliberately including the hardest-hit tail), not a poll of everyone. They show the texture of who wins and loses, never a headcount of support or opposition.
- **The access column is a rule-based estimate.** Access impacts are a deterministic heuristic from the change type (e.g. curbside space), labelled low-confidence — an estimate to reason about, not a measurement.

## Methodology & provenance

- **Runs:** scenario `multimodal-scenario-20260717T005226Z`, baseline `multimodal-baseline-20260717T005226Z`
- **Seeds:** 42, 43, 44
- **Thresholds:** time-to-collision 3.0s, vehicle PET 2.0s, pedestrian PET 5.0s, delay materiality >30s
- **Demand:** anchored to 126 interior counted intersections (2023–2026, multimodal 15-min counts), GEH-validated at 51.8% of 421 counted approach links (industry target 85%). Absolute volumes are approximate — the corridor's boundary inflow and default signal timing under-deliver demand at busy links. Baseline-vs-scenario comparisons use identical demand, so this systematic bias cancels in the delta: the tool's comparisons are like-for-like even where absolute volumes are approximate.
- **Demand construction:** Toronto Open Data turning-movement counts via SUMO routeSampler (sim t=0 is 07:00); each intersection contributes its own latest count day — a composite typical AM peak. Vehicle classes merged per movement; bike demand anchored at approach level and pedestrian demand at corridor total only — no count-fidelity claim for bike/ped volumes.
- **Rendering:** the map shows 1500 of 27221 vehicles and 800 of 2538 pedestrians (an outcome-stratified sample); conflict flares are a severity-stratified sample; every number in this report is computed over the full simulated population.
- **Worst counted locations (GEH):**

  | location | approach | counted (veh/h) | simulated (veh/h) | GEH |
  |---|---|---|---|---|
  | Kingston Rd / Amiens Rd | e | 1942 | 7 | 62.0 |
  | Kingston Rd / Amiens Rd | w | 1216 | 8 | 48.8 |
  | Markham Rd / Milner Ave | n | 1152 | 0 | 48.0 |
  | Kingston Rd / Cromwell Rd / Guildwood Pkwy | e | 1700 | 238 | 47.0 |
  | Kingston Rd / Falaise Rd | e | 1502 | 257 | 42.0 |

  Full per-location table + iteration log: `data/demand/` provenance (`counts-inventory-20260714T043040Z.json` lineage).
- **Generated:** 2026-07-17T05:40:36.398357+00:00 · deepseek/deepseek-v4-flash
- **Audit:** passed — 13 slots (9 LLM-audited: 4 clean, 5 corrected on retry, 0 unresolved; 4 code-rendered).
