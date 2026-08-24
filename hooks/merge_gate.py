"""merge-gate (WORKING.md, Enforcement #2): nothing reaches the default
branch without the owner's recorded sign-off. CI-green is enforced by
GitHub branch protection; this hook holds the owner's-OK half.

The sign-off is recorded when the owner gives it:

    py -3 hooks/record.py signoff <branch> "<the owner's words>"

It names one branch and is consumed by the merge that uses it, so an
old OK can never cover a new change.
"""

import re

from _common import (read_input, read_state, write_state, command_of,
                     segments, current_branch, deny)

DEFAULT = "v1"


def signoff_for(state, target):
    signoff = state.get("signoff") or {}
    return signoff if signoff.get("target") == target else None


payload = read_input()
state = read_state()

for seg in segments(command_of(payload)):
    merging = re.search(r"\bgh\s+pr\s+merge\b", seg)
    pushing_default = (
        re.search(r"\bgit\s+push\b", seg) and (
            re.search(r"\b(origin\s+%s|HEAD:%s|\s%s:%s)\b"
                      % (DEFAULT, DEFAULT, DEFAULT, DEFAULT), seg)
            or (not re.search(r"\borigin\s+\S", seg)
                and current_branch() == DEFAULT)))

    if not (merging or pushing_default):
        continue

    if merging:
        m = re.search(r"gh\s+pr\s+merge\s+(\S+)", seg)
        target = m.group(1) if m and not m.group(1).startswith("-") \
            else current_branch()
    else:
        target = DEFAULT

    used = signoff_for(state, target)
    if not used:
        deny("No recorded owner sign-off for %r (WORKING.md, "
             "merge-gate). The owner test-drives and OKs first; then: "
             "py -3 hooks/record.py signoff %s \"<their words>\" - "
             "and try again." % (target, target))

    # Consumed on use: one OK covers one landing.
    state["last_signoff_used"] = used
    state["signoff"] = None
    write_state(state)
