# Corridor change preview — Converted lane 1 of edge 660176957#0 to a bicycle-only lane

*A stakeholder-reaction preview, not a verdict. Safety figures are surrogate near-miss measures, not crash predictions.*

## 1. What was tested

This report previews a proposed change on one Toronto corridor where a general-traffic lane would be converted into a bicycle-only lane. The text anticipates how people might react and what the change could mean for different road users, without offering a verdict or prediction.

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
- **Car commuters:** Most car commuters see no change in typical travel time, but a small group is markedly slower, and access is slightly worse.
- **Cyclists:** Cyclists see slightly better access, though the safety signal is not directionally reliable and typical travel time holds steady.
- **Pedestrians:** Pedestrians see slightly better access, though the safety signal is not directionally reliable, and typical travel time is unchanged.
- **Local residents:** For this group, a near-miss magnitude is present, but its direction is not claimed (not seed-stable) — the table shows the magnitude only.
- **Business owners:** Access is estimated to be slightly worse for this group, from a low-confidence rule-based estimate.
- **Accessibility:** There isn't enough measurable signal in this run to characterize how this change affects accessibility.
- **Transit riders:** There isn't enough measurable signal in this run to characterize how this change affects transit riders.

## 3. What the affected people say

*Simulated persona reactions — anticipated texture, not a poll. Each quote is verbatim from one simulated persona.*

### Drivers

Drivers in this group are primarily concerned with preserving their travel time and income, with many expressing relief that the change does not slow them down. Some worry about the principle of removing a car lane, while others welcome potential calmer streets and improved conditions near the school. The tension lies between those who see the change as an unnecessary inconvenience and those who view it as a worthwhile trade-off for community benefits.

> “That extra 1.8 minutes might not sound like much, but for me it's less trips per hour and more angry passengers. This lane change is just going to slow me down and cost me money.”
> — Rideshare / delivery driver (simulated persona)

> “I'm glad the travel time stays the same—that means the street can be safer for my kids crossing near the school without making my drive worse.”
> — Safety-conscious driver-parent (simulated persona)

### Cyclists

Cyclists overwhelmingly welcome the protected lane, citing reduced stress from cars passing closely and a greater sense of personal security. A recurring hope is that the lane will encourage more regular use of the corridor, especially among newer or more cautious riders. The consistent theme is that maintaining travel time while gaining separation from traffic is a clear win.

> “I'm thrilled about the protected bike lane—I'd feel much safer biking here and might actually start using this corridor regularly instead of avoiding it.”
> — Cautious newer rider (simulated persona)

> “I've been too nervous to bike here before, but a protected lane would make me feel safe enough to actually try it. My trip time stays the same, so that's great.”
> — Cautious newer rider (simulated persona)

### Pedestrians

Many travelers see little impact on their own walking or transit time and are neutral or mildly supportive. A recurring hope is that slower, calmer traffic will make street crossings feel less stressful, especially for those walking with children. Some are willing to accept a small delay in exchange for that perceived benefit.

> “As a walk-to-transit commuter, my walk to the bus stop doesn't change much, so I'm neutral about this lane conversion.”
> — Walk-to-transit commuter (simulated persona)

> “I'm happy about this change—any move that calms traffic and makes crossings safer for my kids is a win in my book, even if my walk time stays the same.”
> — School-run parent on foot (simulated persona)

### Community voices

The reactions reveal a deep split between those who fear losing curb access and parking for customers and those who long for calmer, more neighborhood-like streets. Some worry about accessibility at intersections and the impact on bus reliability, while others see the change as a chance to reclaim the street from speeding traffic. The tension centers on whether the corridor should prioritize through-traffic and parking or transform into a more human-scale space.

> “I'm worried this bike lane will take away parking spots my customers need to stop and shop—my business depends on that curb access.”
> — Small business owner (community perspective, not a measured traveler)

> “I've lived here for 30 years and I'm all for anything that slows down traffic and makes the street feel more like home. Fewer cars racing by will be a welcome change.”
> — Long-time corridor resident (community perspective, not a measured traveler)

## 4. How discourse might unfold

*One or more SIMULATED cascades over the seeded reactions — illustrative unfoldings, never a forecast or a vote. Movement, not a final position.*

The conversation might unfold as a tug-of-war between drivers who see every extra second as lost income and pedestrians, cyclists, and parents who welcome any slowdown near schools. A middle ground could emerge around the idea that the delay is negligible compared to the comfort and peace of mind for vulnerable road users, with some drivers acknowledging the trade-off is acceptable.

**Which argument drew the most response** (unique agents who acted on a post making it; “/post” normalizes for how much it was posted):
- *cascade c1:* protected lane — 157 (85 posts, 1.85/post); delay / slower — 131 (69 posts, 1.9/post); calmer / quieter — 85 (24 posts, 3.54/post); cost / tax — 13 (4 posts, 3.25/post); parking / curb — 3 (3 posts, 1.0/post)
- *cascade c2:* delay / slower — 146 (72 posts, 2.03/post); protected lane — 139 (86 posts, 1.62/post); calmer / quieter — 77 (25 posts, 3.08/post); parking / curb — 7 (3 posts, 2.33/post); cost / tax — 6 (5 posts, 1.2/post)
- *cascade c3:* delay / slower — 162 (69 posts, 2.35/post); protected lane — 145 (86 posts, 1.69/post); calmer / quieter — 99 (24 posts, 4.12/post); cost / tax — 12 (4 posts, 3.0/post); parking / curb — 4 (4 posts, 1.0/post)

**Who moved** (derived stance transitions within each cascade — movement, not a final position; counts are per cascade and are not added across cascades):
- *cascade c1:* 63 agents moved (by group — car_commuter: 52, pedestrian: 10, transit_riders: 1); 38 hardened, 25 warmed.
- *cascade c2:* 58 agents moved (by group — car_commuter: 53, pedestrian: 5); 39 hardened, 19 warmed.
- *cascade c3:* 66 agents moved (by group — car_commuter: 54, pedestrian: 10, transit_riders: 1, accessibility: 1); 37 hardened, 29 warmed.

**Across cascades:** the most-answered argument differed across runs — the cascades DIVERGE on which argument travels furthest. Engagement is response volume under neutral surfacing, not persuasion (see limitations).

**Withheld by the guard:** 57 posts were excluded from this section and the chat corpus (by rule — immutability: 45, tally: 1, safety_direction: 3, crash: 8). An exclusion is the honesty guard working.

*A middle-ground moment from the cascade (verbatim):*
> “0.1 minute for not getting squeezed by passing cars? I'll take that trade every single time. I ride this corridor daily and I'm tired of feeling the whoosh of traffic inches from my elbow. A protected lane means I can actually breathe on my commute.”
> — Daily bike commuter (simulated cascade utterance)

> “Absolutely this. I drive past the school every morning and I'll gladly take an extra minute if it means I don't have to hold my breath every time a kid darts between parked cars. Speed isn't everything.”
> — Safety-conscious driver-parent (simulated cascade utterance)

## 5. What this analysis cannot tell you

The following limits bound what this preview can and cannot claim, and should be read alongside the findings.

- **Safety direction is not established.** The safety surrogate is reported as a magnitude only — its direction is not claimed: “sign not stable across seeds 42/43/44; directional claim not supported”. Do not read the safety column as 'the change made things safer or more dangerous'.
- **Surrogate measures are not crash predictions.** Safety here means trajectory-derived surrogates (time-to-collision, hard braking, blocked junctions), counted as near-miss events observed in this run. They are not crashes, and this tool does not predict crashes, injuries, or their probability.
- **One corridor, one demand level.** The simulation is bounded to a single corridor at a single modelled demand (300 cars, 82 bicycles, 129 pedestrians). It does not model the wider network, other times of day, or induced demand.
- **In-run adaptation is not settled equilibrium.** Travelers do not re-plan across days here: 0 cars rerouted within the run. Real corridors reach a new equilibrium over weeks as people adjust routes, modes, and times — this preview shows the immediate response, not that settled state.
- **A stratified sample, not a census.** The voiced reactions come from a stratified sample of personas pinned to specific simulated travelers (deliberately including the hardest-hit tail), not a poll of everyone. They show the texture of who wins and loses, never a headcount of support or opposition.
- **The access column is a rule-based estimate.** Access impacts are a deterministic heuristic from the change type (e.g. curbside space), labelled low-confidence — an estimate to reason about, not a measurement.
- **Cascades are illustrative unfoldings.** The discourse section shows independent simulated cascades over the same seeded reactions. They are illustrative, not forecasts — the same opinions cascaded differently across runs (who engages and who shifts varies run to run), so read them as texture, never as what the community will decide.
- **Argument spread is response volume under neutral surfacing.** The recommender that decides which posts agents see is a neutral random-surfacing stand-in (the interest-based recommender is unavailable at this scale), so an argument's engagement partly reflects how much it was posted, not only its pull. Exposure-based reach saturates under random surfacing and is not reported; the engaged figures are 'drew the most response', shown with a per-post normalization.

## Methodology & provenance

- **Runs:** scenario `multimodal-scenario-20260702T044134Z`, baseline `multimodal-baseline-20260702T044134Z`
- **Seeds:** 42, 43, 44
- **Thresholds:** time-to-collision 3.0s, vehicle PET 2.0s, pedestrian PET 5.0s, delay materiality >30s
- **Demand:** synthetic demonstration demand (a small random-trips set) — traffic volumes are illustrative, not calibrated to counts; read volume-dependent numbers as baseline-vs-scenario comparisons, not real-world magnitudes.
- **Assignment:** day-one response — travelers use today's route habits; no iterated adjustment was applied.
- **Day-one vs settled, in plain terms:** a day-one run answers "what happens the morning this change appears" — every traveler still follows the route habits they had before, and the numbers show the shock response. A settled run answers "what does this corridor look like after people have had time to adjust" — driver route choices are re-computed repeatedly until overall travel times stop shifting, approximating the adjusted state. Neither is more true; they answer different planning questions, and the difference between them is itself informative (it shows how much adaptation the change invites). Settled response iterates driver route choice; pedestrian and cyclist routes are held fixed, so adaptation is modeled for drivers only.
- **Generated:** 2026-08-13T05:00:57.058349+00:00 · deepseek/deepseek-v4-flash
- **Audit:** passed — 14 slots (10 LLM-audited: 10 clean, 0 corrected on retry, 0 unresolved; 4 code-rendered).
