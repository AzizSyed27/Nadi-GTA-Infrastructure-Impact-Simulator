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


CONFLICT_TAIL_K = 100   # the worst events by severity are ALWAYS kept — the extreme tail is the story
_N_SEVERITY_BANDS = 10  # deciles over severity [0,1]


def stratify_conflicts(conflicts: list[dict], cap: int | None, tail_k: int = CONFLICT_TAIL_K) -> list[dict]:
    """Severity-stratified conflict sampling for the artifact's render stream. NEVER truncate or
    keep-worst-N: either erases the soft-mode (near-threshold) mass that characterizes calibrated
    density (Read 2: the TTC distribution is bimodal — a hard mode near 0.75s and a soft mode near
    the threshold). Severity is an affine map of the breaching measure, so preserving severity-band
    mass preserves the TTC-band shape. Deterministic (no RNG): top-``tail_k`` by severity guaranteed,
    remaining budget split across severity deciles proportionally (largest remainder), evenly-spaced
    selection within each (t, lon, lat)-sorted band. Scorecard/outcomes are computed from the FULL
    list upstream — this bounds only what the artifact carries."""
    if cap is None or len(conflicts) <= cap:
        return conflicts
    from demand_calibration import apportion
    from sampler import evenly_spaced

    by_sev = sorted(conflicts, key=lambda c: (-c["severity"], c["t"], c["lon"], c["lat"]))
    tail = by_sev[:tail_k]
    tail_ids = {id(c) for c in tail}
    rest = [c for c in conflicts if id(c) not in tail_ids]

    bands: list[list[dict]] = [[] for _ in range(_N_SEVERITY_BANDS)]
    for c in rest:
        idx = min(_N_SEVERITY_BANDS - 1, int(c["severity"] * _N_SEVERITY_BANDS))
        bands[idx].append(c)
    budget = max(0, cap - len(tail))
    shares = apportion(budget, [len(b) for b in bands])
    picked: list[dict] = list(tail)
    for band, take in zip(bands, shares):
        ordered = sorted(band, key=lambda c: (c["t"], c["lon"], c["lat"]))
        picked.extend(evenly_spaced(ordered, min(take, len(ordered))))
    picked.sort(key=lambda c: (c["t"], c["lon"], c["lat"]))
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
