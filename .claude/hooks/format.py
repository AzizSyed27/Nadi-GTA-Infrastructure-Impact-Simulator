#!/usr/bin/env python
"""PostToolUse formatter for Write|Edit|MultiEdit.

Formats + lints the file that was just written:
  - .py                     -> ruff format, then ruff check --fix
  - .ts/.tsx/.js/.jsx       -> prettier --write, then eslint --fix (via local npx)

ALWAYS exits 0 -- a missing tool or a formatter failure must never block the
session. Tools are resolved with shutil.which (so npx -> npx.cmd resolves on
Windows, and an absent tool is a clean no-op). The TS path uses `npx --no-install`
to stay OFFLINE: it never reaches out to the network to fetch a missing package.
"""

import json
import os
import shutil
import subprocess
import sys

PY_EXT = {".py"}
JS_EXT = {".ts", ".tsx", ".js", ".jsx"}


def run(cmd, cwd=None, timeout=25):
    """Run cmd, swallowing every failure. Returns nothing; never raises."""
    exe = shutil.which(cmd[0])
    if not exe:
        return  # tool not installed -> no-op
    try:
        subprocess.run(
            [exe, *cmd[1:]],
            cwd=cwd,
            timeout=timeout,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except Exception:
        pass  # timeout / spawn error / anything -> ignore, never block


def nearest_package_dir(file_path):
    """Walk up from the file to the nearest dir containing package.json."""
    d = os.path.dirname(os.path.abspath(file_path))
    while True:
        if os.path.isfile(os.path.join(d, "package.json")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            return os.path.dirname(os.path.abspath(file_path))
        d = parent


def main():
    payload = json.load(sys.stdin)
    file_path = (payload.get("tool_input") or {}).get("file_path") or ""
    if not file_path or not os.path.isfile(file_path):
        return

    ext = os.path.splitext(file_path)[1].lower()
    if ext in PY_EXT:
        run(["ruff", "format", file_path])
        run(["ruff", "check", "--fix", file_path])
    elif ext in JS_EXT:
        cwd = nearest_package_dir(file_path)
        run(["npx", "--no-install", "prettier", "--write", file_path], cwd=cwd)
        run(["npx", "--no-install", "eslint", "--fix", file_path], cwd=cwd)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    finally:
        sys.exit(0)  # PostToolUse must never block on a formatter problem
