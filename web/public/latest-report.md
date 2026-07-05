# Corridor change preview — Converted lane 1 of edge 660176957#0 to a bicycle-only lane

*A stakeholder-reaction preview, not a verdict. Safety figures are surrogate near-miss measures, not crash predictions.*

## 1. What was tested

This report previews a proposed change where one of the car lanes on the corridor would become a bicycle-only lane. The text explores how drivers, cyclists, and nearby residents might experience this shift in road space.

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
- **Car commuters:** Most car commuters see no change in typical travel time, though a small group is markedly slower, and overall access is slightly worse.
- **Cyclists:** Cyclists see no consistent change in trip time, while some routes gain slightly easier access, though the safety picture remains unclear.
- **Pedestrians:** Pedestrians see slightly better access to destinations, though typical travel time is unchanged and the safety picture is unclear.
- **Local residents:** A near-miss magnitude is present for this group, but its direction is not seed-stable and is not claimed here — the table shows the magnitude only.
- **Business owners:** Access is estimated to be slightly worse for this group, from a low-confidence rule-based estimate.
- **Accessibility:** There isn't enough measurable signal in this run to characterize how this change affects accessibility.
- **Transit riders:** There isn't enough measurable signal in this run to characterize how this change affects transit riders.

## 3. What the affected people say

*Simulated persona reactions — anticipated texture, not a poll. Each quote is verbatim from one simulated persona.*

### Drivers

Drivers and travelers are focused on travel time impacts, with many relieved if their commute remains unchanged. A few express concern about removing a car lane, while others welcome potential calmer streets or improved conditions near schools. The tension is between those wary of any lane reduction and those who see a trade-off as acceptable if their own time isn't affected.

> “I mean, it's barely a blip on my time, so I can't get too worked up over it. Still, taking away a car lane feels like it's heading in the wrong direction, you know?”
> — Rideshare / delivery driver (simulated persona)

> “Since my drive time stays about the same, I'm not too bothered by the change—and honestly, if it means less speeding and noise outside my front door, I might even be a little happier with the trade-off.”
> — Resident who drives the corridor (simulated persona)

### Cyclists

Cyclists broadly welcome the protected bike lane, emphasizing reduced stress from car traffic and a greater sense of safety, even when travel times remain unchanged. Many express relief at no longer being squeezed or dodged by cars, and some new or cautious riders indicate they would start using the corridor regularly. The recurring hope is for a calmer, more predictable ride without worrying about side mirrors or doors.

> “Finally, a dedicated bike lane means I can fly without dodging side mirrors and doors — same speed but way less stress, so that's a win for my sanity and my paycheck.”
> — Bicycle delivery courier (simulated persona)

> “I’m thrilled — a protected bike lane is exactly what I needed to feel safe biking here, and since my trip time stays the same, it’s a total win.”
> — Cautious newer rider (simulated persona)

### Pedestrians

Walkers to transit are largely indifferent or supportive, as their travel times are mostly unchanged. A recurring hope is that a bike lane might calm traffic, making street crossings feel more comfortable for families. There is little tension, as most see no downside for themselves.

> “Well, if it doesn't slow me down and might calm traffic for my crossings, that sounds fine by me.”
> — Senior who walks everywhere (simulated persona)

> “I'm happy about this change—any move that calms traffic and makes crossings safer for my kids is a win in my book, even if my walk time stays the same.”
> — School-run parent on foot (simulated persona)

### Community voices

A recurring tension is between business owners who fear losing curb access and long-time residents who welcome slower traffic and a more neighborhood feel. Some wheelchair users and transit riders raise concerns about crossing accessibility and bus reliability, while others hope the change could calm traffic. The debate is not just about bikes but about whose needs the street should prioritize.

> “I'm worried this bike lane will take away parking spots my customers need to stop and shop—my business depends on that curb access.”
> — Small business owner (community perspective, not a measured traveler)

> “I've lived here for 30 years and I'm all for anything that slows down traffic and makes the street feel more like home. Fewer cars racing by will be a welcome change.”
> — Long-time corridor resident (community perspective, not a measured traveler)

## 4. What this analysis cannot tell you

The following limits define what this preview can and cannot assert, and should be considered together with the findings.

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
- **Generated:** 2026-07-05T03:19:25.361559+00:00 · deepseek/deepseek-chat
- **Audit:** passed — 13 slots (9 LLM-audited: 7 clean, 2 corrected on retry, 0 unresolved; 4 code-rendered).
