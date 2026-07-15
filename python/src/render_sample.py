"""V2.1b — the outcome-stratified RENDER SAMPLE (D4): which entity trajectories a capped artifact
keeps. Outcomes/conflicts/scorecard are computed over the FULL population before this runs; the cap
only bounds what the map renders (meta.render_sample carries the "rendering 1 in N of X" numbers).

Stratification mirrors the persona sampler's spirit (sampler.bin_outcomes bins by delta_seconds;
persona-scorecard-id-hygiene: guarantee the extreme tail, allow honest empty bins) so the 2.5a persona
sampler — which can only pick entities present in the artifact — rides on top UNCHANGED: the top/bottom
tails it force-includes are guaranteed to be rendered.
"""

from __future__ import annotations

from sampler import BIN_ORDER, bin_outcomes, evenly_spaced

UNCHANGED_BAND_S = 5.0  # |delta| <= band = "roughly unchanged" (the sampler's default band)
TAIL_K = 25             # per mode: ALWAYS render the k worst and k best (covers the persona tail picks)


def _stratified_ids(outcomes: list[dict], cap: int, tail_k: int = TAIL_K) -> set[str]:
    """Up to ``cap`` ids: both extreme tails guaranteed, remainder spread across worse/unchanged/better
    proportionally to bin size (evenly spaced within each bin — deterministic, no RNG)."""
    if len(outcomes) <= cap:
        return {o["id"] for o in outcomes}
    tail_k = min(tail_k, max(1, cap // 4))  # small caps: tails must never consume the whole budget
    by_delta = sorted(outcomes, key=lambda o: (o["delta_seconds"], o["id"]))
    tails = {o["id"] for o in by_delta[:tail_k]} | {o["id"] for o in by_delta[-tail_k:]}
    bins = bin_outcomes([o for o in outcomes if o["id"] not in tails], UNCHANGED_BAND_S)
    remaining = max(0, cap - len(tails))
    total = sum(len(bins[b]) for b in BIN_ORDER) or 1
    picked: set[str] = set(tails)
    for b in BIN_ORDER:
        share = round(remaining * len(bins[b]) / total)
        ordered = sorted(bins[b], key=lambda o: (o["delta_seconds"], o["id"]))
        picked.update(o["id"] for o in evenly_spaced(ordered, min(share, len(ordered))))
    return picked


def build_render_sample(buckets: dict, cap_vehicles: int, cap_persons: int) -> set[str]:
    """The rendered id set from the per-mode outcome buckets (matched completers-in-both — entities
    with a comparable story). Bikes are usually few: they get their own headroom inside the vehicle
    cap (never crowded out by cars); peds cap separately. Non-completers are not rendered (their
    trajectories are partial); the full population still counts in outcomes/scorecard/meta totals."""
    cars = buckets["car"]["outcomes"]
    bikes = buckets["bicycle"]["outcomes"]
    peds = buckets["pedestrian"]["outcomes"]

    bike_take = _stratified_ids(bikes, max(1, cap_vehicles // 3)) if bikes else set()
    car_take = _stratified_ids(cars, max(1, cap_vehicles - len(bike_take))) if cars else set()
    ped_take = _stratified_ids(peds, cap_persons) if peds else set()
    return car_take | bike_take | ped_take
