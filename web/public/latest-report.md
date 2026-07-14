# Corridor change preview — Converted lane 1 of edge 660176957#0 to a bicycle-only lane

*A stakeholder-reaction preview, not a verdict. Safety figures are surrogate near-miss measures, not crash predictions.*

## 1. What was tested

This report previews a proposed change on one Toronto corridor: one general-traffic lane would become a bicycle-only lane. The text anticipates how people might react and what the change could mean for different road users.

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
- **Car commuters:** Most car commuters see no change in travel time, but a small group experiences noticeably slower trips, while access is slightly worse.
- **Cyclists:** Cyclists see no change in typical travel time, slightly better access with low confidence, and a near-miss magnitude whose direction is not claimed.
- **Pedestrians:** Pedestrians see slightly better access with no change in typical travel time, though the safety signal is present but directionally unreliable.
- **Local residents:** A near-miss magnitude is present for this group, but its direction is not seed-stable and is not claimed here — the table shows the magnitude only.
- **Business owners:** Access is estimated to be slightly worse for this group, from a low-confidence rule-based estimate.
- **Accessibility:** There isn't enough measurable signal in this run to characterize how this change affects accessibility.
- **Transit riders:** There isn't enough measurable signal in this run to characterize how this change affects transit riders.

## 3. What the affected people say

*Simulated persona reactions — anticipated texture, not a poll. Each quote is verbatim from one simulated persona.*

### Drivers

Drivers are primarily concerned about any increase in travel time, with some expressing anxiety about losing a car lane even if their commute remains unchanged. A few note that if travel times stay the same, they can accept the change, and some even mention potential benefits like quieter streets. There is a tension between those who see lane removal as a negative step and those who are open to trade-offs if their own schedule isn't affected.

> “That extra 1.8 minutes might not sound like much, but for me it's less trips per hour and more angry passengers. This lane change is just going to slow me down and cost me money.”
> — Rideshare / delivery driver (simulated persona)

> “Since my drive time stays about the same, I'm not too bothered by the change—and honestly, if it means less speeding and noise outside my front door, I might even be a little happier with the trade-off.”
> — Resident who drives the corridor (simulated persona)

### Cyclists

Cyclists overwhelmingly welcome the protected bike lane, citing reduced stress from not being squeezed by cars and the ability to focus on their ride or deliveries. Many mention that travel time remains unchanged, making the change a clear improvement for their daily commute or work. A recurring hope is that the lane will encourage more people to bike on this corridor, including those who previously avoided it due to safety concerns.

> “Same travel time but way less stress from cars zooming past me? That's a win in my book. I'll take a calmer ride any day.”
> — Bicycle delivery courier (simulated persona)

> “I'm thrilled about the protected bike lane—I'd feel much safer biking here and might actually start using this corridor regularly instead of avoiding it.”
> — Cautious newer rider (simulated persona)

### Pedestrians

Walk-to-transit commuters are largely neutral about the lane conversion, as their walking time and bus schedule remain unchanged. Some see potential benefits like calmer traffic and more pleasant crossings, while a few note a minor delay. There is no strong opposition, but a quiet hope that the change might improve the street environment.

> “Since my walk to the bus stop stays about the same, I'm fine with the change—bike lanes are good for the neighborhood.”
> — Walk-to-transit commuter (simulated persona)

> “A tenth of a minute slower is nothing if it means safer crossings for the kids — I'd take that trade any day.”
> — School-run parent on foot (simulated persona)

### Community voices

Business owners fear loss of customer parking and delivery access, while some residents welcome slower traffic and a calmer street. Accessibility concerns about curb redesign and crossing times are raised, and transit riders hope bus service is not worsened. The tension is between those who prioritize curb access for commerce and those who seek a more livable, less car-dominated street.

> “I'm worried this bike lane will take away parking spots my customers need to stop and shop—my business depends on that curb access.”
> — Small business owner (community perspective, not a measured traveler)

> “I've lived here for years, and anything that slows down traffic and makes the street safer for walking and biking is welcome in my book — I'm tired of the noise and speed.”
> — Long-time corridor resident (community perspective, not a measured traveler)

## 4. How discourse might unfold

*One or more SIMULATED cascades over the seeded reactions — illustrative unfoldings, never a forecast or a vote. Movement, not a final position.*

The conversation reveals a tension between drivers who depend on speed for income and pedestrians, cyclists, and parents who prioritize safety and comfort. A middle-ground emerges around the idea that small delays are acceptable if they bring meaningful improvements, especially near schools, though drivers emphasize the cumulative cost of those seconds.

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
> “"Only an extra 6 seconds" — I hear that every time they tweak something on this corridor. Multiply that by 30-40 trips a day and you're talking real money out of my pocket. You get a quieter street, I get a worse earnings report. Easy for folks who aren't paid per trip to shrug it off.”
> — Rideshare / delivery driver (simulated cascade utterance)

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
- **Generated:** 2026-07-13T05:23:53.608962+00:00 · deepseek/deepseek-v4-flash
- **Audit:** passed — 14 slots (10 LLM-audited: 8 clean, 2 corrected on retry, 0 unresolved; 4 code-rendered).
