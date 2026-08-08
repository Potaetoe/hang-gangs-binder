#!/usr/bin/env python3
"""
Hold the documentation system to its own rules.

    python tools/check_docs.py

Three checks, all born from the same week of failures (issue #77):

 1. REGISTRY - the top-level markdown documents are exactly the ones
    AGENTS.md names, and the files in security/ are exactly the ones
    named here. Adding either is an owner decision, so an unregistered
    file fails the gate until the list here is edited - and editing it
    is the act that records the approval.
 2. TRIPWIRES - phrases this project has falsified must never reappear
    in an operative document. Three corrections in one week each
    missed at least one hand-made copy of the fact they corrected, so
    this checks that a correction reached every copy, written the only
    way that scales: the falsified sentence itself is the pattern.
 3. STYLE - American spelling (settled 2026-08-06, violated twice
    since), and no gate-size counts in prose (wrong three times in one
    week; the gate prints its own list, and that printout is the
    number).

Under all three sits a floor: a run that read no document at all fails
rather than reporting a clean tree. See null_scan_problems().

archive/ is deliberately not scanned. It is frozen history, and the
falsified claims inside it are allowed to survive there as history -
the same reason a correction is recorded in a commit message rather
than erased from it.

security/ IS scanned, and the difference from archive/ is the point.
Both hold documents nobody edits after the fact, but archive/ records
what this project believed, while a security record states what is
true of it - and it is the document somebody hands to an outside
reader. A claim this project has already falsified does more damage
there than in a document only agents read, so the tripwires and the
spelling rule reach into it. A requirement quotation that ever
collides with a tripwire phrase gets paraphrased or taken to the
owner; exempting the folder would remove an entry from the list below
by another route, which needs the owner either way.
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

# security/ holds dated security records, registered by name for the
# same reason the documents above are: arriving quietly is the failure
# mode. Two differences from that registry, both deliberate.
#
# Every entry is checked, whatever its extension. The scan above is
# bounded to .md because the repository root legitimately holds code and
# configuration; this folder holds records only, and the artifact most
# likely to land here unnoticed is a .ckl, which is XML.
#
# A registered file that is ABSENT also fails. A record here is what one
# reviewer found on one date; it is superseded by a later record beside
# it rather than corrected, so nothing in this folder has a reason to
# disappear. CUTOVER.md's absence is allowed because it deletes itself
# in its own aftercare - there is no counterpart to that here, and a
# vanished assessment reads as a passing gate on evidence nobody can
# see.
SECURITY_DIR = "security"
SECURITY = {
    "README.md",
    "stig-asd-v6r4.md",
}

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


def document_text(relpath):
    """One scan target's bytes, as text.

    Kept apart from the rules below so the rules can be exercised on
    strings. Finding a document is the half of this file that a
    mutation never reaches - a mutation is written against a rule, and
    every rule reports a clean tree when the reader hands it nothing.
    That is #34, and dev/check_docs.test.py is what closes it.
    """
    path = os.path.join(REPO, relpath)
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def scan_text(relpath, text):
    """The three content rules, over one document's text.

    Line by line, which bounds what a tripwire can match: a phrase
    broken across a wrap is not seen. #121 carries that limit.
    """
    problems = []
    for lineno, line in enumerate(text.splitlines(), 1):
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
    return problems


def top_level_documents():
    """The markdown files sitting at the repository root."""
    return {name for name in os.listdir(REPO)
            if name.lower().endswith(".md")
            and os.path.isfile(os.path.join(REPO, name))}


def registry_problems(present):
    """Unregistered top-level documents, over a given set of names."""
    return [
        "%s: not in the document registry. A new top-level "
        "document needs owner approval; recording the approval "
        "IS editing REGISTRY in tools/check_docs.py (see "
        "AGENTS.md, 'The documentation system')." % name
        for name in sorted(present) if name not in REGISTRY
    ]


def security_problems():
    """Both directions on the security/ registry: unregistered, and gone.

    The folder itself is reported when it is missing, the #34 way: a
    scanner that cannot find what it was pointed at has to say so,
    because "nothing unregistered here" and "nothing read here" print
    identically.
    """
    folder = os.path.join(REPO, SECURITY_DIR)
    if not os.path.isdir(folder):
        return ["%s/: the registered security folder is missing. "
                "AGENTS.md, 'The documentation system', names it - "
                "removing it is an owner decision that empties SECURITY "
                "in tools/check_docs.py in the same change."
                % SECURITY_DIR]

    present = {name for name in os.listdir(folder)
               if os.path.isfile(os.path.join(folder, name))}
    return security_registry_problems(present)


def security_registry_problems(present):
    """The two directions, over a given set of file names."""
    problems = [
        "%s/%s: not in the security registry. A record here needs owner "
        "approval on the same terms as a top-level document; recording "
        "the approval IS editing SECURITY in tools/check_docs.py (see "
        "security/README.md, 'Adding one')." % (SECURITY_DIR, name)
        for name in sorted(present - SECURITY)
    ]
    problems += [
        "%s/%s: registered here and missing from the folder. A dated "
        "record is superseded by a later one beside it, never deleted - "
        "restore it, or take it off SECURITY deliberately."
        % (SECURITY_DIR, name)
        for name in sorted(SECURITY - present)
    ]
    return problems


def targets():
    """Every document the content rules are applied to."""
    found = [n for n in sorted(REGISTRY)
             if os.path.isfile(os.path.join(REPO, n))]
    found += [p for p in ALSO_SCANNED
              if os.path.isfile(os.path.join(REPO, p))]
    # Registered records that are prose. A non-markdown artifact is held
    # to the registry but not read for tripwires or spelling: its words
    # are the catalog's rather than this project's, so a rule this
    # project settled has no jurisdiction over them - and a .ckl or a
    # zip is not text this scanner can open.
    found += [os.path.join(SECURITY_DIR, n) for n in sorted(SECURITY)
              if n.lower().endswith(".md")
              and os.path.isfile(os.path.join(REPO, SECURITY_DIR, n))]
    return found


def null_scan_problems(scanned):
    """The floor: a run that read nothing is not a clean tree.

    security_problems() states this principle for the folder - "a
    scanner that cannot find what it was pointed at has to say so,
    because 'nothing unregistered here' and 'nothing read here' print
    identically" - and it holds for the documents on the same terms.

    Absence of any one registered document is deliberately not an
    error, because CUTOVER.md deletes itself in its own aftercare. That
    is precisely why their absence in total has to be: no other arm in
    this file remarks on a document that is simply gone, so an empty
    target list is the one state that would otherwise print success on
    a scan that read nothing at all.
    """
    if scanned:
        return []
    return ["no document was read at all. Absence of any one "
            "registered document is not an error (CUTOVER.md deletes "
            "itself), so nothing else here reports an empty scan - and "
            "a scan of nothing prints exactly like a clean tree."]


def problems():
    found = registry_problems(top_level_documents())
    found += security_problems()

    scanned = targets()
    found += null_scan_problems(scanned)
    for relpath in scanned:
        found += scan_text(relpath, document_text(relpath))
    return found


def main():
    found = problems()
    if found:
        print("check_docs: %d problem(s)\n" % len(found))
        for problem in found:
            print("  " + problem)
        return 1

    print("check_docs: both registries, tripwires and style all hold "
          "(%d files scanned)." % len(targets()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
