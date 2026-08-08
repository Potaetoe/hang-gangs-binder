#!/usr/bin/env python3
"""
Hold the documentation system to its own rules.

    python tools/check_docs.py

Three checks, all born from the same week of failures (issue #77):

 1. REGISTRY - the top-level markdown documents are exactly the ones
    AGENTS.md names. Adding one is an owner decision, so an
    unregistered document fails the gate until the list here is
    edited - and editing it is the act that records the approval.
 2. TRIPWIRES - phrases this project has falsified must never reappear
    in an operative document. Three corrections in one week each
    missed at least one hand-made copy of the fact they corrected, so
    this checks that a correction reached every copy, written the only
    way that scales: the falsified sentence itself is the pattern.
 3. STYLE - American spelling (settled 2026-08-06, violated twice
    since), and no gate-size counts in prose (wrong three times in one
    week; the gate prints its own list, and that printout is the
    number).

archive/ is deliberately not scanned. It is frozen history, and the
falsified claims inside it are allowed to survive there as history -
the same reason a correction is recorded in a commit message rather
than erased from it.
"""

import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The operative documents. AGENTS.md, "The documentation system", is
# the prose statement of this set; this is the enforced one. CUTOVER.md
# deletes itself in its own aftercare, so absence is never an error -
# only an unregistered presence is.
REGISTRY = {
    "README.md",
    "AGENTS.md",
    "DESIGN.md",
    "OPERATIONS.md",
    "CUTOVER.md",
}

# Directory guides: scanned for content, not part of the top-level
# registry.
ALSO_SCANNED = [
    os.path.join("dev", "README.md"),
    os.path.join("server", "README.md"),
]

# (lowercase substring, why it must not reappear). Append an entry
# every time a documented claim is falsified; never remove one without
# the owner.
TRIPWIRES = [
    ("will not authenticate from a non-interactive shell",
     "falsified 2026-08-08 - wrangler authenticates on retry"),
    ("mechanically impossible from an agent shell",
     "falsified 2026-08-08 - the owner-only reason that was not one"),
    ("no agent can read a live secret list",
     "falsified 2026-08-08 - wrangler versions view lists the names"),
    ("all eleven",
     "the gate count that outlived two corrections"),
    ("cannot be lined up",
     "renumbering never prevented linkage - DESIGN.md has the claim"),
    ("share no exact series point",
     "unachievable by rounding - the honest claim is ambiguity"),
]

# British spellings the 2026-08-06 decision settled against, as
# patterns narrow enough not to bite legitimate words ("organism",
# "analysis"). Platform identifiers keep their own spelling, but none
# of these appears in one.
SPELLING = [
    r"\bcentimetre", r"\bkilometre", r"\bmillimetre",
    r"\bcolour", r"\bbehaviour", r"\bfavourite",
    r"\banalyse\b", r"\banalysed\b", r"\banalysing\b",
    r"\b(?:quantis|normalis|summaris|organis|initialis|recognis"
    r"|minimis|maximis|serialis|standardis)(?:e[sd]?|ing|ation)\b",
]

# A stage count written into prose goes stale the day a suite is
# added. Say where to look, never what the number was on the day of
# writing. Number words below ten are left alone - "three privacy
# checks" is a reference, not a gate size.
COUNTS = re.compile(
    r"\b(?:eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen"
    r"|eighteen|nineteen|twenty|\d+)\s+(?:checks|stages)\b",
    re.IGNORECASE,
)


def scan(relpath, problems):
    path = os.path.join(REPO, relpath)
    with open(path, encoding="utf-8") as handle:
        lines = handle.read().splitlines()

    for lineno, line in enumerate(lines, 1):
        low = line.lower()
        for phrase, why in TRIPWIRES:
            if phrase in low:
                problems.append(
                    "%s:%d: tripwire %r (%s)"
                    % (relpath, lineno, phrase, why))
        for pattern in SPELLING:
            match = re.search(pattern, line, re.IGNORECASE)
            if match:
                problems.append(
                    "%s:%d: British spelling %r - American spelling "
                    "is the settled rule" % (relpath, lineno,
                                             match.group(0)))
        match = COUNTS.search(line)
        if match:
            problems.append(
                "%s:%d: %r states a gate size in prose - say where to "
                "look (the gate prints its own list), not what the "
                "number was" % (relpath, lineno, match.group(0)))


def main():
    problems = []

    for name in sorted(os.listdir(REPO)):
        if not name.lower().endswith(".md"):
            continue
        if not os.path.isfile(os.path.join(REPO, name)):
            continue
        if name not in REGISTRY:
            problems.append(
                "%s: not in the document registry. A new top-level "
                "document needs owner approval; recording the approval "
                "IS editing REGISTRY in tools/check_docs.py (see "
                "AGENTS.md, 'The documentation system')." % name)

    targets = [n for n in sorted(REGISTRY)
               if os.path.isfile(os.path.join(REPO, n))]
    targets += [p for p in ALSO_SCANNED
                if os.path.isfile(os.path.join(REPO, p))]
    for relpath in targets:
        scan(relpath, problems)

    if problems:
        print("check_docs: %d problem(s)\n" % len(problems))
        for problem in problems:
            print("  " + problem)
        return 1

    print("check_docs: registry, tripwires and style all hold "
          "(%d documents scanned)." % len(targets))
    return 0


if __name__ == "__main__":
    sys.exit(main())
