"""V2.7b C8a — the run-event vocabulary: one registry, and a pin that fails when the client can't hear.

THE BUG THIS CLOSES, in full, because it is invisible by nature. EventSource dispatches STRICTLY by
name: the client calls `addEventListener(name, …)` once per name, there is no wildcard, and
`onmessage` never fires because every frame carries an explicit `event:`. So an event the server
writes but the client never registered is not an error and not a warning — it is silence. In C7 the
client's list predated the Act I/II vocabulary, and every `beat`, `baseline_ready`, `results_ready`,
`slot_landed` and `stage_usage` frame was dropped on the floor while Act I rendered nothing.
Everything passed.

The close is two-sided and cheap: `run_events.EVENT_NAMES` is the single source of what the server
may write, `emit()` warns when a name is missing from it, and the lockstep pin below asserts every
registered name appears in the client's listener list — the `test_compact_rule_lockstep_with_ts`
precedent (read the .ts, assert containment; no parsing, no Node).

Run: python -m pytest python/tests/test_event_vocabulary.py -v
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "python" / "src"))

import run_events  # noqa: E402

RUN_STREAM_TS = REPO / "web" / "lib" / "runStream.ts"


def _client_listener_names() -> set[str]:
    """The names `web/lib/runStream.ts` actually registers a listener for.

    Read from the RUN_EVENT_NAMES array's own text — the array IS the listener set (the file loops
    over it calling addEventListener), so parsing it is parsing the truth rather than a restatement
    of it. `stream_end` is registered separately and is added here for the same reason."""
    src = RUN_STREAM_TS.read_text(encoding="utf-8")
    block = src.split("export const RUN_EVENT_NAMES = [", 1)[1].split("] as const;", 1)[0]
    names = set(re.findall(r"'([a-z_]+)'", block))
    if "addEventListener('stream_end'" in src:
        names.add("stream_end")
    return names


def test_every_server_event_has_a_client_listener() -> None:
    """THE PIN. A registered name with no listener silently loses data — that is the whole C7 bug.
    (The reverse, a listener with no emitter, is a harmless no-op and is deliberately not failed.)"""
    listeners = _client_listener_names()
    missing = [n for n in run_events.EVENT_NAMES if n not in listeners]
    assert not missing, (
        f"web/lib/runStream.ts registers no listener for {missing} — EventSource dispatches by name, "
        f"so the client would silently never receive these. Add them to RUN_EVENT_NAMES.")


def test_the_control_frame_is_registered_too() -> None:
    """`stream_end` is synthesized by the SSE endpoint and never written to the file, so it is not in
    EVENT_NAMES — but the client must still listen for it or the stream never closes."""
    assert run_events.STREAM_END not in run_events.EVENT_NAMES, (
        "stream_end is CONTROL, never a file line — keeping it out of the file vocabulary is what "
        "makes an interior run_ended safe to replay")
    assert run_events.STREAM_END in _client_listener_names()


def test_the_registry_covers_the_constants_and_has_no_duplicates() -> None:
    assert run_events.RUN_START in run_events.EVENT_NAMES
    assert run_events.RUN_ENDED in run_events.EVENT_NAMES
    assert len(set(run_events.EVENT_NAMES)) == len(run_events.EVENT_NAMES), "no duplicate names"


def test_emit_warns_on_an_unregistered_name_but_still_writes(tmp_path, capsys) -> None:
    """Warn, never raise: a run event is a NARRATION of the run, never part of it — the same reason
    change_scheduler swallows a beat listener's failure rather than killing a simulation. The
    warning is what a developer sees; the pin above is what fails the build."""
    p = tmp_path / "r.events.jsonl"
    run_events.begin(p, "r")
    run_events.emit(p, "totally_made_up", x=1)
    out = capsys.readouterr().out
    assert "unregistered event 'totally_made_up'" in out
    assert "RUN_EVENT_NAMES" in out, "the warning must name BOTH places a new event has to be added"
    events, _ = run_events.read_from(p, 0)
    assert [e["event"] for _, e in events] == ["run_start", "totally_made_up"], (
        "the line is still written — dropping it would turn a naming mistake into data loss")


def test_a_registered_name_warns_about_nothing(tmp_path, capsys) -> None:
    p = tmp_path / "r.events.jsonl"
    run_events.begin(p, "r")
    run_events.emit(p, "beat", n=1, key="demand", title="T", detail="D")
    assert "WARNING" not in capsys.readouterr().out


def test_stage_event_is_env_gated(tmp_path, monkeypatch) -> None:
    """The subprocess-side emitter resolves its path from the env, so a CLI run writes nothing and
    stays byte-identical — the property every emitter in this codebase holds."""
    monkeypatch.delenv(run_events.ENV_VAR, raising=False)
    monkeypatch.setattr(run_events, "EVENTS_ROOT", tmp_path / "root")
    run_events.stage_event("personas", total=213)
    assert not (tmp_path / "root").exists()

    ev = tmp_path / "r.events.jsonl"
    run_events.begin(ev, "r")
    monkeypatch.setenv(run_events.ENV_VAR, str(ev))
    run_events.stage_event("personas", total=213, basis="each point is one traveler")
    events, _ = run_events.read_from(ev, 0)
    assert events[1][1]["event"] == "personas" and events[1][1]["total"] == 213
