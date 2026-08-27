"""merge-gate (WORKING.md, Enforcement #2): nothing reaches the default
branch without the owner's recorded sign-off. CI-green is enforced by
GitHub branch protection; this hook holds the owner's-OK half.

The sign-off is recorded when the owner gives it:

    py -3 hooks/record.py signoff <branch> "<the owner's words>"

It names one branch and is consumed by the merge that uses it, so an
old OK can never cover a new change. A signoff recording standing
EARLIER in an unbroken && chain also counts - if the record fails, &&
never reaches the merge (owner, 2026-08-24).
"""

import re

from _common import (read_input, read_state, write_state, command_of,
                     chained, current_branch, strip_quoted, deny)

DEFAULT = "main"


def signoff_for(state, target):
    signoff = state.get("signoff") or {}
    return signoff if signoff.get("target") == target else None


def recorded_earlier(parts, index, target):
    pattern = re.compile(r"record\.py\s+signoff\s+" + re.escape(target))
    for j in range(index - 1, -1, -1):
        if parts[j + 1][1] != "&&":
            return False
        if pattern.search(parts[j][0]):
            return True
    return False


payload = read_input()
state = read_state()
parts = chained(strip_quoted(command_of(payload)))

for index, (seg, _joiner) in enumerate(parts):
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

    if recorded_earlier(parts, index, target):
        continue

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
