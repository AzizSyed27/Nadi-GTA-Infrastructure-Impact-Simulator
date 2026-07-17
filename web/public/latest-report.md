# Corridor change preview — Converted lane 1 of edge 660176957#0 to a bicycle-only lane

*A stakeholder-reaction preview, not a verdict. Safety figures are surrogate near-miss measures, not crash predictions.*

## 1. What was tested

This report previews a proposed change on one Toronto corridor: one lane currently used by general traffic would become a bicycle-only lane. The text anticipates how people might react and what the change could mean for different road users.

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
- **Car commuters:** Most car commuters see no change in travel time, but a small group experiences noticeably slower trips, and access is slightly worse.
- **Cyclists:** Cyclists see no measurable change in typical travel time, a slight improvement in access, and a safety signal whose direction is not claimed.
- **Pedestrians:** Pedestrians see slightly better access with no change in travel time, though the safety signal is not directionally reliable.
- **Local residents:** A near-miss magnitude is present for this group, but its direction is not seed-stable and is not claimed here — the table shows the magnitude only.
- **Business owners:** Access is estimated to be slightly worse for this group, from a low-confidence rule-based estimate.
- **Accessibility:** There isn't enough measurable signal in this run to characterize how this change affects accessibility.
- **Transit riders:** There isn't enough measurable signal in this run to characterize how this change affects transit riders.

## 3. What the affected people say

*Simulated persona reactions — anticipated texture, not a poll. Each quote is verbatim from one simulated persona.*

### Drivers

Some worry that removing a lane is a step in the wrong direction, while others welcome potential calmer streets and improved conditions near schools. A recurring hope is that travel times stay the same, making the change acceptable. Tensions exist between those who see any slowdown as a cost and those who value other benefits.

> “That extra 1.8 minutes might not sound like much, but for me it's less trips per hour and more angry passengers. This lane change is just going to slow me down and cost me money.”
> — Rideshare / delivery driver (simulated persona)

> “I'm glad the travel time stays the same—that means the street can be safer for my kids crossing near the school without making my drive worse.”
> — Safety-conscious driver-parent (simulated persona)

### Cyclists

Cyclists overwhelmingly welcome the protected bike lane, emphasizing that it reduces stress from cars without increasing travel time. Many express relief at no longer being squeezed by traffic, and some note they would start using the corridor regularly. The recurring hope is for a calmer, more predictable ride.

> “Same travel time but way less stress from cars zooming past me? That's a win in my book. I'll take a calmer ride any day.”
> — Bicycle delivery courier (simulated persona)

> “I'm thrilled about the protected bike lane—I'd feel much safer biking here and might actually start using this corridor regularly instead of avoiding it.”
> — Cautious newer rider (simulated persona)

### Pedestrians

Walk-to-transit commuters generally express that the change has little effect on their walking time or bus schedule, leading to a neutral or accepting stance. Some see potential benefits in traffic calming that could improve the crossing experience, particularly for those with children. A few note a slight time savings that eases their bus connection.

> “Well, if it doesn't slow me down and might calm traffic for my crossings, that sounds fine by me.”
> — Senior who walks everywhere (simulated persona)

> “I'm happy about this change—shaving nearly a minute off my trip means I can be more relaxed about catching the bus.”
> — Walk-to-transit commuter (simulated persona)

### Community voices

Business owners along the corridor worry that removing parking or curb access will hurt their shops and make deliveries difficult. Some residents oppose the change as an unwanted expense that will worsen traffic, while others welcome slower traffic and a more neighborhood feel. Transit users hope the bike lane does not slow buses or reduce stop accessibility.

> “I'm worried this bike lane will take away parking spots my customers need to stop and shop—my business depends on that curb access.”
> — Small business owner (community perspective, not a measured traveler)

> “I hope the bike lane doesn't make bus service slower or more unpredictable—buses already get stuck in traffic, and I need reliable transit to get to work on time.”
> — Transit rider perspective (community perspective, not a measured traveler)

## 4. How discourse might unfold

*One or more SIMULATED cascades over the seeded reactions — illustrative unfoldings, never a forecast or a vote. Movement, not a final position.*

Drivers focused on earnings express frustration over cumulative seconds, while pedestrians and cyclists welcome calmer conditions. Some drivers acknowledge the value of reduced stress near schools, suggesting a possible middle ground where small delays are accepted for specific benefits like protected lanes.

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
> “Absolutely this. I drive past the school every morning and I'll gladly take an extra minute if it means I don't have to hold my breath every time a kid darts between parked cars. Speed isn't everything.”
> — Safety-conscious driver-parent (simulated cascade utterance)

> “Absolutely with you on this. I drive this corridor too and I'd much rather take an extra minute than worry about kids darting out near the school. Speed isn't everything—peace of mind is.”
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
- **Generated:** 2026-07-17T05:41:35.763497+00:00 · deepseek/deepseek-v4-flash
- **Audit:** passed — 14 slots (10 LLM-audited: 6 clean, 4 corrected on retry, 0 unresolved; 4 code-rendered).
