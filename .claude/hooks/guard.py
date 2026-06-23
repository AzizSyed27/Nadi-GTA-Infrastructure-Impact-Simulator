#!/usr/bin/env python
"""PreToolUse guard for Write|Edit|MultiEdit.

Hard-blocks (exit 2) writes to:
  - anything under contract/   (the FROZEN Python<->TS trajectory contract)
  - any .env / .env.* file     (secrets) -- but .env.example is allowed

Claude Code passes the event as JSON on stdin; the target path is
tool_input.file_path (same field for Write, Edit, and MultiEdit).

Exit codes:  2 = block (reason on stderr, shown to Claude/user);  0 = allow.
This hook FAILS OPEN: on any parse error / missing path it exits 0 so a
malformed payload can never wedge the session.
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


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0  # unparseable -> don't block

    file_path = (payload.get("tool_input") or {}).get("file_path") or ""
    if not file_path:
        return 0

    root = project_root(payload)

    if under_contract(file_path, root):
        sys.stderr.write(
            "BLOCKED: contract/ holds the FROZEN Python<->TS trajectory contract.\n"
            "Edits here silently break both sides of the boundary.\n"
            "If this change is intended, bump the contract VERSION deliberately and\n"
            "update BOTH python/ and web/ to match. For the one-time legitimate\n"
            "creation/edit, temporarily comment out the PreToolUse hook in\n"
            ".claude/settings.json, make the change, then re-enable it.\n"
        )
        return 2

    base = os.path.basename(file_path.replace("\\", "/"))
    if re.match(r"^\.env(\..+)?$", base) and base != ".env.example":
        sys.stderr.write(
            f"BLOCKED: '{base}' is a secrets file (.env / .env.*).\n"
            "Refusing to write secrets into the repo.\n"
            "Use .env.example for a committable, secret-free template.\n"
        )
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
