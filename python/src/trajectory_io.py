"""(De)serialize trajectory artifacts and validate them against the frozen JSON Schema.

The canonical contract is ``contract/trajectory_schema.json``. Every write and every read passes
through ``jsonschema`` validation against that file, so the schema — not the pydantic model — is the
authority. The pydantic ``TrajectoryArtifact`` is used for typed construction on the Python side.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

from contract_models import COMPACT_TRAJECTORY_VERSIONS, MANDATE_VERSIONS, TrajectoryArtifact

# Repo root is two levels up from python/src/.  python/src/trajectory_io.py -> python/src -> python -> <root>
_REPO_ROOT = Path(__file__).resolve().parents[2]
CONTRACT_DIR = _REPO_ROOT / "contract"
SCHEMA_PATH = CONTRACT_DIR / "trajectory_schema.json"
RUNS_DIR = CONTRACT_DIR / "runs"

# ---------------------------------------------------------------------------------------------
# V2.3c closeout — the PINNED-run guard. The Playwright suite + the latest-report singleton are
# anchored to this exact run's committed 212-agent artifact; a voices or discourse enrich REWRITES
# the artifact (0.9.0 + institutional voices / regenerated cascades) and the damage surfaces hours
# later as unexplained spec failures with no obvious cause. The refusal is STRUCTURAL (server 403 +
# CLI SystemExit) because a doc warning only protects agents that read it. `report` enrich stays
# allowed — it never touches the artifact and is the documented singleton-maintenance path.
# ---------------------------------------------------------------------------------------------
PINNED_RUN_ID = "multimodal-scenario-20260702T044134Z"
# V2.7a — the landing's committed EXAMPLE run (the fire-station doorstep composite): its artifact
# AND its per-run report are committed, landing-load-bearing files — singleton-class by the same
# definition as the pinned run, so it JOINS the protected set below. Client-side read-only guards
# the UI only; this is the layer that stops a bare CLI enrich (which resolves the local
# latest.json default) from silently mutating the committed example.
EXAMPLE_RUN_ID = "multimodal-scenario-20260814T063253Z"
ALLOW_PINNED_ENV = "NADI_ALLOW_PINNED_ENRICH"
PINNED_REASON = (
    f"{PINNED_RUN_ID} is the PINNED Playwright/report anchor: a voices or discourse enrich "
    "REWRITES its artifact (0.9.0 + institutional voices / regenerated cascades) and breaks the "
    "spec suite + latest-report singleton hours later with no obvious cause. Refusing. For a "
    f"deliberate re-pin set {ALLOW_PINNED_ENV}=1."
)
EXAMPLE_ENRICH_REASON = (
    f"{EXAMPLE_RUN_ID} is the committed EXAMPLE run: the landing renders its artifact and per-run "
    "report from COMMITTED files, and a voices or discourse enrich REWRITES the artifact — the "
    "cold landing and the rendered-equals-file pins break hours later with no obvious cause. "
    f"Refusing. For a deliberate refresh set {ALLOW_PINNED_ENV}=1."
)

# The protected set: run id → role-specific enrich-refusal reason. The `report` enrich stays
# EXEMPT for every member (it never touches the artifact — the documented maintenance path;
# C6's example-report regen depends on it).
_PROTECTED_ENRICH_REASONS = {
    PINNED_RUN_ID: PINNED_REASON,
    EXAMPLE_RUN_ID: EXAMPLE_ENRICH_REASON,
}


def pinned_enrich_blocked(run_id: str) -> bool:
    """True when an artifact-rewriting enrich targets a PROTECTED run (env escape hatch honored)."""
    return run_id in _PROTECTED_ENRICH_REASONS and not os.environ.get(ALLOW_PINNED_ENV)


def enrich_refusal_reason(run_id: str) -> str:
    """The role-specific refusal for a protected run (callers check membership first)."""
    return _PROTECTED_ENRICH_REASONS[run_id]


def guard_pinned_enrich(run_id: str) -> None:
    """CLI form: refuse an artifact-rewriting enrich of a protected run LOUDLY, before any work."""
    if pinned_enrich_blocked(run_id):
        raise SystemExit(_PROTECTED_ENRICH_REASONS[run_id])


# V2.4c — the sibling guard for IDENTITY writes (user name/note). A name on a protected run
# changes the runLabel output on every spec-pinned name-rendering surface — the same
# breaks-hours-later class the enrich guard exists for. No CLI twin: only the identity endpoint
# writes the sidecar. (V2.7a reworded: the edit-rail picker retired; the run list replaced it.)
PINNED_IDENTITY_REASON = (
    f"{PINNED_RUN_ID} is the PINNED Playwright/report anchor: a name or note on it changes the "
    "runLabel output on every spec-pinned name-rendering surface (the run list + both compare "
    "pickers) and breaks the spec suite hours later with no obvious cause. Refusing the identity "
    f"write (clone-to-draft stays open — it only reads). For a deliberate re-pin set "
    f"{ALLOW_PINNED_ENV}=1."
)
EXAMPLE_IDENTITY_REASON = (
    f"{EXAMPLE_RUN_ID} is the committed EXAMPLE run: a name or note on it changes the labels the "
    "landing and the run list render for the example, and the run-document pins break hours "
    "later with no obvious cause. Refusing the identity write (clone-to-draft stays open — it "
    f"only reads). For a deliberate change set {ALLOW_PINNED_ENV}=1."
)

_PROTECTED_IDENTITY_REASONS = {
    PINNED_RUN_ID: PINNED_IDENTITY_REASON,
    EXAMPLE_RUN_ID: EXAMPLE_IDENTITY_REASON,
}


def pinned_identity_blocked(run_id: str) -> bool:
    """True when an identity (name/note) write targets a PROTECTED run (env escape hatch honored)."""
    return run_id in _PROTECTED_IDENTITY_REASONS and not os.environ.get(ALLOW_PINNED_ENV)


def identity_refusal_reason(run_id: str) -> str:
    """The role-specific identity refusal for a protected run (callers check membership first)."""
    return _PROTECTED_IDENTITY_REASONS[run_id]


@lru_cache(maxsize=1)
def load_schema() -> dict:
    """Load and cache the canonical JSON Schema."""
    with SCHEMA_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


@lru_cache(maxsize=1)
def _validator() -> Draft202012Validator:
    # FormatChecker makes the "date-time" format actually enforced (it is advisory otherwise).
    return Draft202012Validator(load_schema(), format_checker=FormatChecker())


def validate_artifact(data: dict) -> None:
    """Validate a plain dict against the contract. Raises jsonschema.ValidationError on failure."""
    _validator().validate(data)


def newest_ts_named(directory: Path, glob_pattern: str, prefix: str, *,
                    none_msg: str, flag_hint: str) -> Path:
    """Newest by NAME among TIMESTAMP-SHAPED candidates — the variable part after ``prefix``
    starts with a digit (every pipeline-minted run-ts starts with the year, so names sort
    correctly WITHIN the class; the legitimate --run-ts probe `20260719T0500SEED1` stays
    eligible — a strict strptime would reject it, and mtime is scrambled by OneDrive resync,
    both counterexampled in this tree).

    The lexicographic `sorted(glob)[-1]` this replaces fired TWICE ('V' > '2'): the V2.5a
    two-day stale-index drift and the V2.6c stale-roster Groq burn. Skipped non-timestamp names
    are WARNED by name on EVERY resolution; a junk-only space exits LOUDLY naming the files and
    the explicit flag — silence was the incident class. SystemExit is deliberate and
    CLI/subprocess-contained: no live FastAPI handler reaches this (reachability grep recorded
    in test_run_resolvers.py)."""
    candidates = sorted(directory.glob(glob_pattern))
    eligible = [p for p in candidates if p.name[len(prefix):][:1].isdigit()]
    skipped = [p for p in candidates if not p.name[len(prefix):][:1].isdigit()]
    if skipped:
        names = ", ".join(p.name for p in skipped)
        print(f"[resolve] skipping {len(skipped)} non-timestamp name(s): {names} — "
              f"pass {flag_hint} explicitly to use one")
    if eligible:
        return eligible[-1]
    if skipped:
        raise SystemExit(
            f"only non-timestamp names found ({', '.join(p.name for p in skipped)}) — "
            f"refusing to guess; pass {flag_hint} explicitly")
    raise SystemExit(none_msg)


def audit_version_gate(data: dict) -> None:
    """Emitted-shape self-check: the version must match the version-gated shapes.

    v0.5.0+: a scenario carries ``changes`` (the list authority) and NO legacy ``change``; a pre-0.5.0
    scenario carries ``change`` and no ``changes``. v0.6.0: ``meta.demand_profile`` is REQUIRED (and,
    with render_sample, forbidden before 0.6.0). v0.7.0+: ``meta.assignment`` REQUIRED (forbidden
    before). v0.8.0+: scorecard-cell ``range`` allowed (forbidden before). v0.9.0: mandate-grounded
    agents allowed (forbidden before). v0.10.0: the payload encoding — per-entity EITHER-shape
    timestamps ({t0, dt} XOR explicit) with ``speeds`` DROPPED; pre-0.10.0 entities must carry the
    two index-aligned arrays and never the compact fields. Baseline runs (no scenario) skip the
    scenario check.
    Belt-and-suspenders over the schema ``if/then`` gates (and independent of them) so a mis-wrapped
    producer emission fails LOUDLY at write time. Raises ``ValueError`` on mismatch."""
    version = data.get("schema_version")
    meta = data.get("meta", {})
    if version in ("0.6.0", "0.7.0", "0.8.0", "0.9.0", "0.10.0"):
        if not meta.get("demand_profile"):
            raise ValueError(f"version-gate: a {version} artifact's meta must declare demand_profile")
    elif "demand_profile" in meta or "render_sample" in meta:
        raise ValueError(
            f"version-gate: a {version} artifact must not carry meta.demand_profile/render_sample "
            "(v0.6.0 fields)"
        )
    if version in ("0.7.0", "0.8.0", "0.9.0", "0.10.0"):
        if not meta.get("assignment"):
            raise ValueError(f"version-gate: a {version} artifact's meta must declare assignment "
                             "(day_one vs settled)")
    elif "assignment" in meta:
        raise ValueError(f"version-gate: a {version} artifact must not carry meta.assignment "
                         "(a v0.7.0 field)")
    # v0.8.0+: scorecard-cell range is optional but forbidden BEFORE 0.8.0 (mirror of the schema's
    # pre-0.8.0 gate — presence on an older version means a mis-wrapped emission). NB `not in`, never
    # a literal `!=` against one version — the classic bump trap.
    if version not in ("0.8.0", "0.9.0", "0.10.0"):
        for grp in (data.get("scorecard") or {}).get("groups", []):
            for key in ("travel_time_delta", "safety_delta", "access_delta"):
                cell = grp.get(key)
                if isinstance(cell, dict) and "range" in cell:
                    raise ValueError(
                        f"version-gate: a {version} artifact's scorecard cell ({grp.get('group')}.{key}) "
                        "must not carry range (a v0.8.0 field)")
    # v0.9.0: mandate grounding + mandate/citations forbidden before (mirror of the schema's
    # pre-0.9.0 gate). Single source: contract_models.MANDATE_VERSIONS (extended on every bump).
    if version not in MANDATE_VERSIONS:
        for a in data.get("agents") or []:
            if a.get("grounding") == "mandate" or "mandate" in a or "citations" in a:
                raise ValueError(
                    f"version-gate: a {version} artifact must not carry mandate-grounded agents "
                    f"(v0.9.0 fields; agent persona={a.get('persona', {}).get('id')!r})")
    # V2.6c — the trajectory-shape gate (mirror of schema gates J/K; keyed on the single-sourced
    # COMPACT_TRAJECTORY_VERSIONS, never a literal — the bump trap). 0.10.0: no speeds, per-entity
    # {t0,dt}-pair XOR timestamps. Pre-0.10.0: both arrays required, compact fields forbidden.
    entities = list(data.get("vehicles") or []) + list(data.get("persons") or [])
    if version in COMPACT_TRAJECTORY_VERSIONS:
        for e in entities:
            if "speeds" in e:
                raise ValueError(
                    f"version-gate: a {version} entity ({e.get('id')!r}) must not carry speeds "
                    "(dropped at v0.10.0)")
            has_pair = "t0" in e and "dt" in e
            has_half_pair = ("t0" in e) != ("dt" in e)
            has_ts = "timestamps" in e
            if has_half_pair or has_pair == has_ts:
                raise ValueError(
                    f"version-gate: a {version} entity ({e.get('id')!r}) must carry the {{t0, dt}} "
                    f"pair XOR timestamps (got t0={'t0' in e}, dt={'dt' in e}, timestamps={has_ts})")
    else:
        for e in entities:
            if "t0" in e or "dt" in e:
                raise ValueError(
                    f"version-gate: a {version} entity ({e.get('id')!r}) must not carry compact "
                    "t0/dt (v0.10.0 fields)")
            if "timestamps" not in e or "speeds" not in e:
                raise ValueError(
                    f"version-gate: a {version} entity ({e.get('id')!r}) must carry timestamps "
                    "+ speeds")
    scenario = meta.get("scenario")
    if scenario is None:
        return
    has_change = "change" in scenario
    has_changes = "changes" in scenario
    if version in ("0.5.0", "0.6.0", "0.7.0", "0.8.0", "0.9.0", "0.10.0"):
        if not has_changes or has_change:
            raise ValueError(
                f"version-gate: a {version} artifact's scenario must carry `changes` (the list authority) "
                f"and NOT the legacy `change` (got change={has_change}, changes={has_changes})"
            )
    else:  # pre-0.5.0
        if not has_change or has_changes:
            raise ValueError(
                f"version-gate: a {version} artifact's scenario must carry the legacy `change` and NOT "
                f"`changes` (got change={has_change}, changes={has_changes})"
            )


def dump_artifact(artifact: TrajectoryArtifact, path: str | Path | None = None) -> Path:
    """Serialize -> validate against the schema -> write JSON. Returns the path written.

    If ``path`` is omitted, writes to ``contract/runs/<run_id>.json``.
    """
    # exclude_none: optional fields (meta.scenario, change.value_mps) are OMITTED when absent rather
    # than emitted as JSON null — the schema types them as object/number, so null would fail validation.
    # by_alias: the v0.4.0 SocialEdge stores `from` as `from_` (a Python keyword) and must emit it as "from".
    data = artifact.model_dump(mode="json", exclude_none=True, by_alias=True)
    validate_artifact(data)  # never write an artifact that violates the frozen contract
    audit_version_gate(data)  # and never write one whose version disagrees with its scenario shape
    out = Path(path) if path is not None else RUNS_DIR / f"{artifact.meta.run_id}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    return out


def load_artifact(path: str | Path) -> TrajectoryArtifact:
    """Read JSON -> validate against the schema -> parse into the typed model."""
    with Path(path).open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    validate_artifact(data)
    return TrajectoryArtifact.model_validate(data)


def write_latest_pointer(run_id: str) -> None:
    """V2.5c — web/public/latest.json is a POINTER ONLY ({"run_id": ...}), never a payload.
    The old full-artifact alias did two jobs (newest-run pointer + default payload); the payload
    job was both already-stale (the voices enrich never rewrote it) and the 90 MB spec hazard.
    Written ONLY on quant-run completion — an enrich or CLI recompute of an OLD run must never
    repoint the default (the accidental-repoint footgun class, V2.5c deliberate behavior change).
    The frontend resolves the pointer then fetches /<run_id>.json."""
    web = Path(__file__).resolve().parents[2] / "web" / "public"
    web.mkdir(parents=True, exist_ok=True)
    (web / "latest.json").write_text(json.dumps({"run_id": run_id}) + "\n", encoding="utf-8")
