# Corridor change preview — Converted lane 1 of edge 660176957#0 to a bicycle-only lane

*A stakeholder-reaction preview, not a verdict. Safety figures are surrogate near-miss measures, not crash predictions.*

## 1. What was tested

This report previews a proposed change on one Toronto corridor where a general-traffic lane would become a bicycle-only lane. The text anticipates how people might react and what the change could mean, without offering a verdict or prediction.

- **Change:** Converted lane 1 of edge 660176957#0 to a bicycle-only lane (edge `660176957#0`, lane 1)
- **Corridor / network:** `corridor.net.xml` — one Toronto corridor
- **Demand simulated:** 300 cars, 82 bicycles, 129 pedestrians
- **Runs compared:** scenario `multimodal-scenario-20260702T044134Z` vs baseline `multimodal-baseline-20260702T044134Z`

## 2. Who is affected, and how

| Stakeholder group | Travel time | Safety | Access |
|---|---|---|---|
| Car commuters | +0.0s, 3.3% >30s [MEAS] | ±6.58 [LOW] | +0.33 [LOW] |
| Cyclists | +0.0s, 0.0% >30s [MEAS] | ±6.86 [LOW] | -1.00 [LOW] |
| Pedestrians | +0.0s, 0.0% >30s [MEAS] | ±0.19 [LOW] | -0.10 [LOW] |
| Local residents | — | ±7.35 [LOW] | — |
| Business owners | — | — | +0.50 [LOW] |
| Accessibility | — | — | — |
| Transit riders | — | — | — |

*POSITIVE = worse for the group · ± = magnitude only (safety direction not claimed) · [MEAS] measured · [LOW] low-confidence estimate.*

**Cell notes (verbatim):**
- *Travel time:* affected_share = fraction of this group's travelers >30s slower
- *Safety:* sign not stable across seeds 42/43/44; directional claim not supported
- *Access:* rule-based estimate

**Travel-time tail (cars):** median about no change; 3.3% of cars are >30s slower. Across seeds 42/43/44 this share stays in [2.3%, 3.3%] — a small hard-hit tail, with the vast majority of cars unaffected.

**Per-group reading:**
- **Car commuters:** Most car commuters see no change in travel time, but a small group experiences a noticeable slowdown, while access becomes slightly worse.
- **Cyclists:** Cyclists see no measurable change in typical travel time, a slight improvement in access, and a safety signal that is present but directionally uncertain.
- **Pedestrians:** Pedestrians see slightly better access with no change in typical travel time, though the safety signal is too unstable to interpret.
- **Local residents:** A near-miss magnitude is present for this group, but its direction is not seed-stable and is not claimed here — the table shows the magnitude only.
- **Business owners:** Access is estimated to be slightly worse for this group, from a low-confidence rule-based estimate.
- **Accessibility:** There isn't enough measurable signal in this run to characterize how this change affects accessibility.
- **Transit riders:** There isn't enough measurable signal in this run to characterize how this change affects transit riders.

## 3. What the affected people say

*Simulated persona reactions — anticipated texture, not a poll. Each quote is verbatim from one simulated persona.*

### Drivers

Drivers are primarily concerned with how the change affects their travel time, with many neutral as long as their commute stays the same. A few opposed see any lane reduction as a step in the wrong direction, while supportive voices welcome calmer streets and better conditions near schools. The tension is between those who prioritize keeping traffic moving and those who value a more pleasant street environment.

> “I mean, it's barely a blip on my time, so I can't get too worked up over it. Still, taking away a car lane feels like it's heading in the wrong direction, you know?”
> — Rideshare / delivery driver (simulated persona)

> “Since my drive time stays about the same, I'm not too bothered by the change—and honestly, if it means less speeding and noise outside my front door, I might even be a little happier with the trade-off.”
> — Resident who drives the corridor (simulated persona)

### Cyclists

Cyclists overwhelmingly welcome the protected bike lane, citing reduced stress from car traffic and a greater sense of safety. Many note that travel time remains unchanged, making the change a clear benefit. A recurring hope is that the lane will encourage more regular use of the corridor, especially among those who previously avoided it.

> “I'm thrilled about the protected bike lane—I'd feel much safer biking here and might actually start using this corridor regularly instead of avoiding it.”
> — Cautious newer rider (simulated persona)

> “Finally, a dedicated bike lane means I can fly without dodging side mirrors and doors — same speed but way less stress, so that's a win for my sanity and my paycheck.”
> — Bicycle delivery courier (simulated persona)

### Pedestrians

Some travelers are neutral because their walking time to the bus stop remains unchanged. Others welcome the bike lane, hoping it will slow traffic and make crossing the street feel less hurried, especially for those with children. A few note a slight time savings that eases their bus connection.

> “Well, if my walking time and bus schedule aren't affected, I don't really mind the change—it's fine by me.”
> — Walk-to-transit commuter (simulated persona)

> “I'm happy about this change—any move that calms traffic and makes crossings safer for my kids is a win in my book, even if my walk time stays the same.”
> — School-run parent on foot (simulated persona)

### Community voices

Business owners fear losing curb access and parking, which they say is essential for customers and deliveries. Some residents worry about impacts on transit reliability and accessibility for people with disabilities. Others welcome the change, hoping it will slow traffic and make the street feel more like a neighborhood.

> “I'm worried this bike lane will take away parking spots my customers need to stop and shop—my business depends on that curb access.”
> — Small business owner (community perspective, not a measured traveler)

> “I've lived here for years, and anything that slows down traffic and makes the street safer for walking and biking is welcome in my book — I'm tired of the noise and speed.”
> — Long-time corridor resident (community perspective, not a measured traveler)

## 4. What this analysis cannot tell you

The following limits bound what this preview can and cannot claim, and should be read alongside the findings.

- **Safety direction is not established.** The safety surrogate is reported as a magnitude only — its direction is not claimed: “sign not stable across seeds 42/43/44; directional claim not supported”. Do not read the safety column as 'the change made things safer or more dangerous'.
- **Surrogate measures are not crash predictions.** Safety here means trajectory-derived surrogates (time-to-collision, hard braking, blocked junctions), counted as near-miss events observed in this run. They are not crashes, and this tool does not predict crashes, injuries, or their probability.
- **One corridor, one demand level.** The simulation is bounded to a single corridor at a single modelled demand (300 cars, 82 bicycles, 129 pedestrians). It does not model the wider network, other times of day, or induced demand.
- **In-run adaptation is not settled equilibrium.** Travelers do not re-plan across days here: 0 cars rerouted within the run. Real corridors reach a new equilibrium over weeks as people adjust routes, modes, and times — this preview shows the immediate response, not that settled state.
- **A stratified sample, not a census.** The voiced reactions come from a stratified sample of personas pinned to specific simulated travelers (deliberately including the hardest-hit tail), not a poll of everyone. They show the texture of who wins and loses, never a headcount of support or opposition.
- **The access column is a rule-based estimate.** Access impacts are a deterministic heuristic from the change type (e.g. curbside space), labelled low-confidence — an estimate to reason about, not a measurement.

## Methodology & provenance

- **Runs:** scenario `multimodal-scenario-20260702T044134Z`, baseline `multimodal-baseline-20260702T044134Z`
- **Seeds:** 42, 43, 44
- **Thresholds:** time-to-collision 3.0s, vehicle PET 2.0s, pedestrian PET 5.0s, delay materiality >30s
- **Generated:** 2026-07-06T01:40:34.681818+00:00 · deepseek/deepseek-chat
- **Audit:** passed — 13 slots (9 LLM-audited: 7 clean, 2 corrected on retry, 0 unresolved; 4 code-rendered).
