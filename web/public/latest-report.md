# Corridor change preview — Converted lane 1 of edge 660176957#0 to a bicycle-only lane

*A stakeholder-reaction preview, not a verdict. Safety figures are surrogate near-miss measures, not crash predictions.*

## 1. What was tested

This report previews how converting one general-traffic lane into a bicycle-only lane on the corridor would affect people who drive, cycle, walk, and use transit. The change is being tested to see how it shifts travel patterns and street activity. The following sections describe the anticipated reactions and potential impacts.

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
- **Car commuters:** Most car commuters see no change in travel time, but a small group experiences noticeably slower trips, while access becomes slightly worse.
- **Cyclists:** Cyclists see no measurable change in typical travel time, a slight improvement in access with low confidence, and a near-miss magnitude whose direction is not claimed.
- **Pedestrians:** Pedestrians see slightly better access with no change in typical travel time, though a safety signal is present but directionally unreliable.
- **Local residents:** A near-miss magnitude is present for this group, but its direction is not seed-stable and is not claimed here — the table shows the magnitude only.
- **Business owners:** Access is estimated to be slightly worse for this group, from a low-confidence rule-based estimate.
- **Accessibility:** There isn't enough measurable signal in this run to characterize how this change affects accessibility.
- **Transit riders:** There isn't enough measurable signal in this run to characterize how this change affects transit riders.

## 3. What the affected people say

*Simulated persona reactions — anticipated texture, not a poll. Each quote is verbatim from one simulated persona.*

### Drivers

Drivers are primarily concerned about any increase in travel time, with some worried about lost income or tight schedules. Those whose commute remains unchanged are generally neutral or supportive, especially if the change brings calmer streets or safety benefits near schools. A few oppose the lane removal on principle, even if their time is barely affected.

> “That extra 1.8 minutes might not sound like much, but for me it's less trips per hour and more angry passengers. This lane change is just going to slow me down and cost me money.”
> — Rideshare / delivery driver (simulated persona)

> “I'm glad the travel time stays the same—that means the street can be safer for my kids crossing near the school without making my drive worse.”
> — Safety-conscious driver-parent (simulated persona)

### Cyclists

Cyclists overwhelmingly welcome the protected bike lane, citing reduced stress from car traffic and a sense of safety that would encourage regular use. Many note that travel time remains unchanged, making the change a clear win. A recurring hope is to focus on riding or deliveries without dodging cars.

> “Same travel time but way less stress from cars zooming past me? That's a win in my book. I'll take a calmer ride any day.”
> — Bicycle delivery courier (simulated persona)

> “I'm thrilled about the protected bike lane—I'd feel much safer biking here and might actually start using this corridor regularly instead of avoiding it.”
> — Cautious newer rider (simulated persona)

### Pedestrians

Some travelers are neutral because their walking time to the bus stop and bus schedule remain unchanged. Others welcome the bike lane, hoping it will slow traffic and make crossing the street more comfortable, especially for those with children. A few note a slight time savings that eases their bus connection.

> “Well, if my walking time and bus schedule aren't affected, I don't really mind the change—it's fine by me.”
> — Walk-to-transit commuter (simulated persona)

> “I'm all for it—slower traffic and a bike lane should make crossing the street much less scary for me and the kids.”
> — School-run parent on foot (simulated persona)

### Community voices

Business owners fear losing curb access and parking, which they say is essential for customers and deliveries. Some residents worry about slower bus service and accessibility barriers for wheelchair users. Others welcome the change, hoping it will calm traffic and make the street feel more like a neighborhood.

> “I'm worried this bike lane will take away parking spots my customers need to stop and shop—my business depends on that curb access.”
> — Small business owner (community perspective, not a measured traveler)

> “I've lived here for 30 years and I'm all for anything that slows down traffic and makes the street feel more like home. Fewer cars racing by will be a welcome change.”
> — Long-time corridor resident (community perspective, not a measured traveler)

## 4. How discourse might unfold

*One or more SIMULATED cascades over the seeded reactions — illustrative unfoldings, never a forecast or a vote. Movement, not a final position.*

Drivers who earn per trip voice frustration that small delays add up to lost income, while others welcome calmer streets for a more relaxed commute or easier crossings. A middle-ground appears around the idea that modest time trade-offs are acceptable near schools, though drivers remain concerned about cumulative earnings impact.

**Which argument drew the most response** (unique agents who acted on a post making it; “/post” normalizes for how much it was posted):
- *cascade c1:* protected lane — 157 (85 posts, 1.85/post); delay / slower — 131 (69 posts, 1.9/post); calmer / quieter — 85 (24 posts, 3.54/post); cost / tax — 13 (4 posts, 3.25/post); parking / curb — 3 (3 posts, 1.0/post)
- *cascade c2:* delay / slower — 146 (72 posts, 2.03/post); protected lane — 139 (86 posts, 1.62/post); calmer / quieter — 77 (25 posts, 3.08/post); parking / curb — 7 (3 posts, 2.33/post); cost / tax — 6 (5 posts, 1.2/post)
- *cascade c3:* delay / slower — 162 (69 posts, 2.35/post); protected lane — 145 (86 posts, 1.69/post); calmer / quieter — 99 (24 posts, 4.12/post); cost / tax — 12 (4 posts, 3.0/post); parking / curb — 4 (4 posts, 1.0/post)

**Who moved** (derived stance transitions within each cascade — movement, not a final position; counts are per cascade and are not added across cascades):
- *cascade c1:* 63 agents moved (by group — car_commuter: 52, pedestrian: 10, transit_riders: 1); 38 hardened, 25 warmed.
- *cascade c2:* 58 agents moved (by group — car_commuter: 53, pedestrian: 5); 39 hardened, 19 warmed.
- *cascade c3:* 66 agents moved (by group — car_commuter: 54, pedestrian: 10, transit_riders: 1, accessibility: 1); 37 hardened, 29 warmed.

**Across cascades:** the most-answered argument differed across runs — the cascades DIVERGE on which argument travels furthest. Engagement is response volume under neutral surfacing, not persuasion (see limitations).

**Withheld by the guard:** 94 posts were excluded from this section and the chat corpus (by rule — safety_direction: 43, immutability: 42, tally: 1, crash: 8). An exclusion is the honesty guard working.

*A middle-ground moment from the cascade (verbatim):*
> “Absolutely this. I drive past the school every morning and I'll gladly take an extra minute if it means I don't have to hold my breath every time a kid darts between parked cars. Speed isn't everything.”
> — Safety-conscious driver-parent (simulated cascade utterance)

> “"Only an extra 6 seconds" — I hear that every time they tweak something on this corridor. Multiply that by 30-40 trips a day and you're talking real money out of my pocket. You get a quieter street, I get a worse earnings report. Easy for folks who aren't paid per trip to shrug it off.”
> — Rideshare / delivery driver (simulated cascade utterance)

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
- **Generated:** 2026-07-09T00:05:51.035145+00:00 · deepseek/deepseek-chat
- **Audit:** passed — 14 slots (10 LLM-audited: 8 clean, 2 corrected on retry, 0 unresolved; 4 code-rendered).
