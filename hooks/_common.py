"""Shared bits for the hooks. WORKING.md, "Enforcement", is the spec.

A PreToolUse hook denies by exiting 2 with the reason on stderr; the
reason always carries the remedy. State lives in .claude/state.json
(gitignored, per-machine). Env overrides exist so hooks/selftest.py can
drive every rule against fixtures instead of the real repo.
"""

import json
import os
import re
import subprocess
import sys


def read_input():
    try:
        return json.load(sys.stdin)
    except Exception:
        return {}


def state_path():
    return os.environ.get("BINDER_STATE") or os.path.join(
        os.getcwd(), ".claude", "state.json")


def read_state():
    try:
        with open(state_path(), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def write_state(state):
    path = state_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)


def command_of(payload):
    tool_input = payload.get("tool_input") or {}
    return tool_input.get("command") or ""


def segments(command):
    """A compound command, split so one segment's flags cannot be
    misread as another's - the lesson of the old guard denying a
    `gh api -f` because a `git push` stood earlier in the line."""
    return [s.strip() for s in re.split(r"[;&|]+", command) if s.strip()]


def current_branch():
    override = os.environ.get("BINDER_BRANCH")
    if override:
        return override
    try:
        out = subprocess.run(
            ["git", "branch", "--show-current"],
            capture_output=True, text=True, timeout=10)
        return out.stdout.strip()
    except Exception:
        return ""


def deny(message):
    print(message, file=sys.stderr)
    sys.exit(2)
