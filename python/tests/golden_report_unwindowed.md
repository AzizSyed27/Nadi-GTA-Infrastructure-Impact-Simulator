# Corridor change preview — Converted a car lane to a bike lane

*A stakeholder-reaction preview, not a verdict. Safety figures are surrogate near-miss measures, not crash predictions.*

## 1. What was tested

Stub framing paragraph.

- **Change:** Converted a car lane to a bike lane (edge `E1`, lane 1)
- **Corridor / network:** `corridor.net.xml` — one Toronto corridor
- **Demand simulated:** 300 cars, 82 bicycles, 129 pedestrians
- **Runs compared:** scenario `scen-GOLDEN` vs baseline `base-GOLDEN`

## 2. Who is affected, and how

| Stakeholder group | Travel time | Safety | Access |
|---|---|---|---|
| Car commuters | +0.0s, 3.3% >30s [MEAS] | ±6.50 [LOW] | +0.33 [LOW] |
| Cyclists | +0.0s, 0.0% >30s [MEAS] | ±6.80 [LOW] | -1.00 [LOW] |
| Pedestrians | — | — | — |
| Local residents | — | — | — |
| Business owners | — | — | — |
| Accessibility | — | — | — |
| Transit riders | — | — | — |

*POSITIVE = worse for the group · ± = magnitude only (safety direction not claimed) · [MEAS] measured · [LOW] low-confidence estimate.*

**Cell notes (verbatim):**
- *Travel time:* tt
- *Safety:* safety unstable
- *Access:* est

**Travel-time tail (cars):** median about no change; 3.3% of cars are >30s slower. This small affected share was checked across seeds 42, 43 and 44 and remains a small, stable tail with almost all cars unaffected (exact cross-seed range not available for this run).

**Per-group reading:**
- **Car commuters:** Stub gloss for car_commuter.
- **Cyclists:** Stub gloss for cyclist.
- **Pedestrians:** Stub gloss for pedestrian.
- **Local residents:** Stub gloss for local_resident.
- **Business owners:** Stub gloss for business_owner.
- **Accessibility:** Stub gloss for accessibility.
- **Transit riders:** Stub gloss for transit_riders.

## 3. What the affected people say

*Simulated persona reactions — anticipated texture, not a poll. Each quote is verbatim from one simulated persona.*

## 5. What this analysis cannot tell you

Stub caveat intro.

- **Safety direction is not established.** The safety surrogate is reported as a magnitude only — its direction is not claimed: “safety unstable”. Do not read the safety column as 'the change made things safer or more dangerous'.
- **Surrogate measures are not crash predictions.** Safety here means trajectory-derived surrogates (time-to-collision, hard braking, blocked junctions), counted as near-miss events observed in this run. They are not crashes, and this tool does not predict crashes, injuries, or their probability.
- **One corridor, one demand level.** The simulation is bounded to a single corridor at a single modelled demand (300 cars, 82 bicycles, 129 pedestrians). It does not model the wider network, other times of day, or induced demand.
- **In-run adaptation is not settled equilibrium.** Travelers do not re-plan across days here: 0 cars rerouted within the run. Real corridors reach a new equilibrium over weeks as people adjust routes, modes, and times — this preview shows the immediate response, not that settled state.
- **A stratified sample, not a census.** The voiced reactions come from a stratified sample of personas pinned to specific simulated travelers (deliberately including the hardest-hit tail), not a poll of everyone. They show the texture of who wins and loses, never a headcount of support or opposition.
- **The access column is a rule-based estimate.** Access impacts are a deterministic heuristic from the change type (e.g. curbside space), labelled low-confidence — an estimate to reason about, not a measurement.

## Methodology & provenance

- **Runs:** scenario `scen-GOLDEN`, baseline `base-GOLDEN`
- **Seeds:** 42
- **Thresholds:** time-to-collision 3.0s, vehicle PET 2.0s, pedestrian PET 5.0s, delay materiality >30s
- **Demand:** synthetic demonstration demand (a small random-trips set) — traffic volumes are illustrative, not calibrated to counts; read volume-dependent numbers as baseline-vs-scenario comparisons, not real-world magnitudes.
- **Assignment:** day-one response — travelers use today's route habits; no iterated adjustment was applied.
- **Day-one vs settled, in plain terms:** a day-one run answers "what happens the morning this change appears" — every traveler still follows the route habits they had before, and the numbers show the shock response. A settled run answers "what does this corridor look like after people have had time to adjust" — driver route choices are re-computed repeatedly until overall travel times stop shifting, approximating the adjusted state. Neither is more true; they answer different planning questions, and the difference between them is itself informative (it shows how much adaptation the change invites). Settled response iterates driver route choice; pedestrian and cyclist routes are held fixed, so adaptation is modeled for drivers only.
- **Generated:** 2026-07-28T00:00:00+00:00 · none/stub
- **Audit:** stub (deterministic golden render — no LLM)
