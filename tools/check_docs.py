#!/usr/bin/env python3
"""
Hold the documentation system to its own rules.

    python tools/check_docs.py

Three checks, all born from the same week of failures (issue #77):

 1. REGISTRY - the top-level markdown documents are exactly the ones
    AGENTS.md names, and the files in security/ are exactly the ones
    named here. Adding one is an owner decision and so is removing one,
    so both directions fail the gate until the list here is edited -
    and editing it is the act that records the approval. CUTOVER.md is
    the single document allowed to leave on its own, which REQUIRED
    below states by omitting it.
 2. TRIPWIRES - phrases this project has falsified must never reappear
    in an operative document. Three corrections in one week each
    missed at least one hand-made copy of the fact they corrected, so
    this checks that a correction reached every copy, written the only
    way that scales: the falsified sentence itself is the pattern.
    Matched across the line breaks these documents wrap at, because
    the copy a correction misses is a copy somebody reflowed rather
    than pasted intact - see GAP.
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
# the prose statement of this set; this is the enforced one. Membership
# is checked in both directions - an unregistered presence here, and a
# registered absence through REQUIRED below.
#
# UAT.md is here by the owner's directive on #126, and this line is
# where that approval is recorded - editing this set IS the act, which
# is why nothing else in the repository needs to assert it.
REGISTRY = {
    "README.md",
    "AGENTS.md",
    "DESIGN.md",
    "OPERATIONS.md",
    "UAT.md",
    "CUTOVER.md",
}

# The registered documents that have no story for leaving.
#
# CUTOVER.md is the one that does - it deletes itself in its own
# aftercare - so it is absent from this set rather than written in and
# exempted, which keeps the exemption a fact about CUTOVER.md instead of
# a special case somebody has to remember.
#
# Without this arm, registration only ever caught a document ARRIVING.
# A registered document could be deleted and the gate printed a clean
# tree, because absence was made unremarkable for CUTOVER.md's sake and
# nothing distinguished the one document that leaves by design from the
# ones that would be a silent loss. Measured on #126: with UAT.md moved
# out of the tree the whole run still passed, and the acceptance script
# the cutover is gated on had simply stopped existing. Same reasoning as
# SECURITY below, which has always been checked in both directions.
REQUIRED = REGISTRY - {"CUTOVER.md"}

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
# "analysis", "microorganism"). Platform identifiers keep their own
# spelling, but none of these appears in one.
#
# Deliberately unanchored at the front. A word boundary there makes the
# rule silent on compounds - "watercolour", "misbehaviour",
# "reorganisation" - and a compound is where a British spelling is
# least likely to be caught by eye, so it is the case this rule can
# least afford to miss. The suffix side carries the narrowing instead:
# "organis" reports only when "e", "es", "ed", "ing" or "ation"
# follows, which is the whole reason "microorganism" passes clean.
SPELLING = [
    r"centimetre", r"kilometre", r"millimetre",
    r"colour", r"behaviour", r"favourite",
    r"analyse\b", r"analysed\b", r"analysing\b",
    r"(?:quantis|normalis|summaris|organis|initialis|recognis"
    r"|minimis|maximis|serialis|standardis)(?:e[sd]?|ing|ation)\b",
]

# A stage count written into prose goes stale the day a suite is
# added. Say where to look, never what the number was on the day of
# writing.
#
# The number and the noun do not have to be adjacent: "eleven gate
# checks" and "eleven of the checks" are the same claim as "eleven
# checks". Adjacency is what forces a gap like this to be patched by
# hand, and the "all eleven" tripwire is that patch - a rule needing
# hand-maintained instances to cover itself is a rule that is too
# tight. So up to three words may stand between, none of them the noun
# itself, which is what keeps two counts in one sentence reporting as
# two rather than being swallowed into a single span. The separators
# are whitespace only, so punctuation ends the window and the pattern
# cannot reach across a clause into an unrelated noun.
#
# Number words below ten are left alone - "three privacy checks" is a
# reference to a group, not a claim about the gate's size. Digits get
# no such exemption, so "9 checks" reports where "nine checks" does
# not. That asymmetry is deliberate rather than an oversight of the
# alternation: a figure in prose reads as a measured count, and a
# figure is what a stale number is written as.
COUNTS = re.compile(
    r"\b(?:eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen"
    r"|eighteen|nineteen|twenty|\d+)"
    r"(?:\s+(?!checks\b|stages\b)[\w'-]+){0,3}"
    r"\s+(?:checks|stages)\b",
    re.IGNORECASE,
)

# What may separate the words of a phrase that prose has wrapped:
# ordinary whitespace, and the ">" a blockquote puts at the head of
# every continuation line. A phrase reflowed across a line break is the
# same phrase - tools/check_comments.py reaches that conclusion for
# code comments, and hard-wrapped documents need it more, because these
# wrap near 72 columns while the phrases above run to 49 characters.
#
# "#" is absent on purpose, and that is the bound on this widening. It
# opens a heading here rather than continuing a comment, and a heading
# between two words is a structural break: the words either side of it
# are not one sentence however they happen to line up.
GAP = r"[\s>]+"


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


def tripwire(phrase):
    """One registered phrase as a pattern a line break cannot defeat.

    Substring semantics, not word-anchored, and the difference is the
    point: tools/check_comments.py wraps its markers in \\b and this
    deliberately does not. A front anchor would stop "all eleven"
    matching inside "small eleven", which NARROWS what a registered
    falsified claim catches - the opposite of what this file is for,
    and a separate decision from letting a phrase survive a wrap.
    """
    return re.compile(GAP.join(re.escape(word) for word in phrase.split()),
                      re.IGNORECASE)


TRIPWIRE_RULES = [(phrase, why, tripwire(phrase))
                  for phrase, why in TRIPWIRES]


def line_of(text, offset):
    """The 1-based line a match at `offset` starts on.

    Where it STARTS, because the tail of a wrapped phrase is a fragment
    that means nothing on its own - a reader sent to the second line
    would not see the claim being reported.
    """
    return text.count("\n", 0, offset) + 1


def one_line(matched):
    """A match with its wrap flattened, so one problem prints as one line."""
    return re.sub(r"\s+", " ", matched).strip()


def scan_text(relpath, text):
    """The three content rules, over one document's whole text.

    Whole text rather than line by line, because these documents are
    hard-wrapped near 72 columns and a reader that sees one line at a
    time cannot see a phrase the wrap split in half. The patterns carry
    their own whitespace tolerance; offsets become line numbers here,
    so a report still names the line a match starts on.

    Problems come back in document order, so a reader walks the file
    downward whichever rule caught what.
    """
    found = []

    def report(offset, message):
        found.append((offset, message))

    for phrase, why, pattern in TRIPWIRE_RULES:
        for match in pattern.finditer(text):
            report(match.start(),
                   "%s:%d: tripwire %r (%s)"
                   % (relpath, line_of(text, match.start()), phrase, why))

    for pattern in SPELLING:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            report(match.start(),
                   "%s:%d: British spelling %r - American spelling "
                   "is the settled rule"
                   % (relpath, line_of(text, match.start()),
                      match.group(0)))

    for match in COUNTS.finditer(text):
        report(match.start(),
               "%s:%d: %r states a gate size in prose - say where to "
               "look (the gate prints its own list), not what the "
               "number was"
               % (relpath, line_of(text, match.start()),
                  one_line(match.group(0))))

    return [message for _offset, message in sorted(found,
                                                   key=lambda hit: hit[0])]


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


def missing_document_problems(present):
    """Registered documents that are gone, over a given set of names.

    The other direction, and the one registration lacked. Deleting a
    document is as much an owner decision as adding one, so it is
    recorded the same way: by editing the registry, which is what this
    message asks for.
    """
    return [
        "%s: registered as an operative document and missing from the "
        "repository root. Removing one is an owner decision on the same "
        "terms as adding one; recording it IS editing REGISTRY in "
        "tools/check_docs.py. Only CUTOVER.md leaves on its own, and it "
        "is kept out of REQUIRED for exactly that reason." % name
        for name in sorted(REQUIRED - present)
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

    This is about the READER, not the tree, which is what keeps it
    necessary now that missing_document_problems() watches the tree.
    That arm reads the repository root directly, so it stays quiet when
    every document is present and targets() is what broke - a renamed
    helper, an early return, a filter that matches nothing. In that
    state the tree is complete, no other arm has anything to say, and a
    scan that read not one byte would otherwise print exactly like a
    clean one. CUTOVER.md is why absence of a single document is still
    unremarkable HERE: it deletes itself in its own aftercare, so the
    floor sits on the empty list and nowhere else.
    """
    if scanned:
        return []
    return ["no document was read at all. Absence of any one "
            "registered document is not an error (CUTOVER.md deletes "
            "itself), so nothing else here reports an empty scan - and "
            "a scan of nothing prints exactly like a clean tree."]


def problems():
    present = top_level_documents()
    found = registry_problems(present)
    found += missing_document_problems(present)
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
