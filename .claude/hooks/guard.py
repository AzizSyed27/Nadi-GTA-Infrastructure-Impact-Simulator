#!/usr/bin/env python
"""PreToolUse guard for Write|Edit|MultiEdit.

Raises Claude Code's **ask** permission decision (an in-the-moment approval prompt) on writes to:
  - anything under contract/   (the FROZEN Python<->TS trajectory contract)
  - any .env / .env.* file      (secrets) -- but .env.example is allowed

The legitimate path for a deliberate contract change is now: just use the Write/Edit tool and APPROVE
the prompt (still bump schema_version + mirror BOTH python/ and web/). The old "comment out the hook in
settings.json" dance is retired. NOTE: the matcher only covers Write|Edit|MultiEdit, so Bash/runtime
writes to contract/ bypass this guard entirely -- those are PROHIBITED by convention (a process
violation policed by plan review), not a clever route.

Claude Code passes the event as JSON on stdin; the target path is tool_input.file_path (same field for
Write, Edit, and MultiEdit).

Output contract (verified against the Claude Code hooks docs): to raise an ask decision, print the
PreToolUse JSON below to STDOUT and exit 0 --

  {"hookSpecificOutput": {"hookEventName": "PreToolUse",
                          "permissionDecision": "ask",
                          "permissionDecisionReason": "<why>"}}

Exit 0 is REQUIRED: on exit 2 the stdout JSON is IGNORED (that is the old hard-block path). This hook
therefore never exits nonzero. It also FAILS OPEN: on any parse error / missing path it emits no
decision (exit 0, normal permission flow) so a malformed payload can never wedge the session.
"""

import json
import os
import re
import sys


def project_root(payload):
    return (
        os.environ.get("CLAUDE_PROJECT_DIR")
        or payload.get("cwd")
        or os.getcwd()
    )


def _norm(path):
    """Lowercased, forward-slash path. Maps Git-Bash drive form /c/x -> c:/x."""
    p = path.replace("\\", "/").lower().rstrip("/")
    m = re.match(r"^/([a-z])(/.*)?$", p)
    if m:
        p = m.group(1) + ":" + (m.group(2) or "")
    return p


def under_contract(file_path, root):
    """True if file_path resolves to contract/ (or below) under the project root."""
    # Primary: relative path (handles relative file_path and same-form abs paths).
    try:
        rel = os.path.relpath(file_path, root).replace("\\", "/").lower()
        if rel == "contract" or rel.startswith("contract/"):
            return True
    except ValueError:
        pass  # different drive on Windows -> rely on substring check below
    # Fallback: project-anchored substring on normalized forms (robust to
    # C:/... vs /c/... path styles). Anchored so 'mycontract/' can't match.
    f = _norm(file_path)
    r = _norm(root)
    return f == r + "/contract" or f.startswith(r + "/contract/")


def _ask(reason):
    """Emit the PreToolUse 'ask' decision to stdout. Caller then returns 0."""
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": reason,
        }
    }))


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0  # unparseable -> no decision, normal flow

    file_path = (payload.get("tool_input") or {}).get("file_path") or ""
    if not file_path:
        return 0

    root = project_root(payload)
    base = os.path.basename(file_path.replace("\\", "/"))

    if under_contract(file_path, root):
        _ask(
            f"{base} is under contract/ — the FROZEN Python<->TS trajectory contract. Approve ONLY for a "
            "deliberate contract change: bump schema_version and mirror BOTH python/ and web/. Editing via "
            "Write/Edit is the correct path now — do NOT route contract writes through Bash/Python "
            "(that bypasses this guard)."
        )
        return 0

    if re.match(r"^\.env(\..+)?$", base) and base != ".env.example":
        _ask(
            f"{base} is a secrets file (.env / .env.*). Approve only if you intend to write it; use "
            ".env.example for a committable, secret-free template."
        )
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
