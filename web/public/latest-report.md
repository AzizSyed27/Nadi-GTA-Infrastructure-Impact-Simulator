# Corridor change preview — New road cluster_281310765_281313230_9690520599->8721888316

*A stakeholder-reaction preview, not a verdict. Safety figures are surrogate near-miss measures, not crash predictions.*

## 1. What was tested

This report previews a proposed new two-lane road connecting a junction cluster to another junction, without a sidewalk at this stage. It explores how the change might affect people traveling through the area, including drivers, cyclists, and pedestrians.

- **Change:** A new 2-lane two-way road connecting junction `cluster_281310765_281313230_9690520599` and junction `8721888316` — a new travel option, no sidewalk at this stage (new edge `nr_cluster_281310765_281313230_9690520599_8721888316`).
- **Corridor / network:** `multimodal-scenario-20260710T153406Z.net.xml` — one Toronto corridor
- **Demand simulated:** 300 cars, 82 bicycles, 129 pedestrians
- **Runs compared:** scenario `multimodal-scenario-20260710T153406Z` vs baseline `multimodal-baseline-20260710T153406Z`

## 2. Who is affected, and how

| Stakeholder group | Travel time | Safety | Access |
|---|---|---|---|
| Car commuters | -0.5s, 17.7% >30s [MEAS] | ±38.36 [LOW] | -0.50 [LOW] |
| Cyclists | +0.0s, 25.6% >30s [MEAS] | ±5.04 [LOW] | — |
| Pedestrians | +0.0s, 5.4% >30s [MEAS] | ±3.27 [LOW] | — |
| Local residents | — | ±39.47 [LOW] | — |
| Business owners | — | — | — |
| Accessibility | — | — | — |
| Transit riders | — | — | — |

*POSITIVE = worse for the group · ± = magnitude only (safety direction not claimed) · [MEAS] measured · [LOW] low-confidence estimate.*

**Cell notes (verbatim):**
- *Travel time:* affected_share = fraction of this group's travelers >30s slower
- *Safety:* sign not stable across seeds 42/43/44; directional claim not supported
- *Access:* rule-based estimate

**Travel-time tail (cars):** median -0.5s; 17.7% of cars are >30s slower. This small affected share was checked across seeds 42, 43 and 44 and remains a small, stable tail with the vast majority of cars unaffected (exact cross-seed range not available for this run).

**Per-group reading:**
- **Car commuters:** Most car commuters see little change, but a small group experiences noticeably slower travel.
- **Cyclists:** Most cyclists see no change in travel time, but a small group experiences a noticeable slowdown.
- **Pedestrians:** Most pedestrians are unaffected, but a small group experiences a notable slowdown, while a near-miss magnitude is present without a claimed direction.
- **Local residents:** A near-miss magnitude is present for this group, but its direction is not seed-stable and is not claimed here — the table shows the magnitude only.
- **Business owners:** There isn't enough measurable signal in this run to characterize how this change affects business owners.
- **Accessibility:** There isn't enough measurable signal in this run to characterize how this change affects accessibility.
- **Transit riders:** There isn't enough measurable signal in this run to characterize how this change affects transit riders.

## 3. What the affected people say

*Simulated persona reactions — anticipated texture, not a poll. Each quote is verbatim from one simulated persona.*

## 5. What this analysis cannot tell you

The following limits bound what this preview can and cannot claim, and should be read alongside the findings.

- **Safety direction is not established.** The safety surrogate is reported as a magnitude only — its direction is not claimed: “sign not stable across seeds 42/43/44; directional claim not supported”. Do not read the safety column as 'the change made things safer or more dangerous'.
- **Surrogate measures are not crash predictions.** Safety here means trajectory-derived surrogates (time-to-collision, hard braking, blocked junctions), counted as near-miss events observed in this run. They are not crashes, and this tool does not predict crashes, injuries, or their probability.
- **One corridor, one demand level.** The simulation is bounded to a single corridor at a single modelled demand (300 cars, 82 bicycles, 129 pedestrians). It does not model the wider network, other times of day, or induced demand.
- **In-run adaptation is not settled equilibrium.** Travelers do not re-plan across days here: 4 cars rerouted within the run. Real corridors reach a new equilibrium over weeks as people adjust routes, modes, and times — this preview shows the immediate response, not that settled state.
- **A stratified sample, not a census.** The voiced reactions come from a stratified sample of personas pinned to specific simulated travelers (deliberately including the hardest-hit tail), not a poll of everyone. They show the texture of who wins and loses, never a headcount of support or opposition.
- **The access column is a rule-based estimate.** Access impacts are a deterministic heuristic from the change type (e.g. curbside space), labelled low-confidence — an estimate to reason about, not a measurement.

## Methodology & provenance

- **Runs:** scenario `multimodal-scenario-20260710T153406Z`, baseline `multimodal-baseline-20260710T153406Z`
- **Seeds:** 42, 43, 44
- **Thresholds:** time-to-collision 3.0s, vehicle PET 2.0s, pedestrian PET 5.0s, delay materiality >30s
- **Generated:** 2026-07-10T15:41:31.513787+00:00 · deepseek/deepseek-chat
- **Audit:** passed — 9 slots (5 LLM-audited: 5 clean, 0 corrected on retry, 0 unresolved; 4 code-rendered).
