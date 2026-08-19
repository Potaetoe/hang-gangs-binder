#!/usr/bin/env python3
"""
Hold source comments to the American-spelling rule AGENTS.md already
claims is machine-checked.

    python tools/check_spelling.py

Issue #334, found by the S4 independent review (#330): AGENTS.md rule 8
says American spelling is machine-checked, but the only machine that
checked it was tools/check_docs.py, and that one reads four registered
documents plus security/ - never a comment in apps/web, server, dev or
tools. A British spelling written in a code comment sailed through
every gate this repository runs, and stayed there.

WHAT THIS READS
----------------
Comments only, over the same four directories and extensions
tools/check_comments.py already reads: apps/web (.js/.css/.html),
server (.js/.sql), dev (.mjs/.py/.js), tools (.py) - SCAN, KIND and
comments_only() are imported from there rather than rewritten, so the
two checks agree about what a "comment" is in a SQL file without
answering that question twice. A second comment-stripper, hand-written
for this file, is a second place for "does <!-- --> nest in HTML" to be
answered, and a second place is where the two answers drift - silently,
the way tools/check.py's own docstring warns a hand-kept roster can.

IDENTIFIERS ARE OUT OF SCOPE, ON PURPOSE
------------------------------------------
AGENTS.md's rule reaches identifiers too, and this check does not.
apps/web/dashboard.js exports a function named `labeller`, and several
suites import it by that exact spelling - a check that flagged the name
would be asking for a rename with call-site churn across files this
slice does not own, a different-shaped change from correcting a
sentence. That is a slice of its own. Stated here rather than hidden:
this closes the comment gap the review found, not every gap rule 8
could be read to promise - and it is why a comment that CITES that
function by name ("see labeller() above") is a pinned exception below
rather than a fix: rewriting the comment's spelling would make it quote
a name that does not exist.

WHY THE DENY-LIST IS THIS SHORT
---------------------------------
Two families copied from tools/check_docs.py's SPELLING (see WHY NOT
IMPORTED below), plus one new family this review's own finding
demanded:

 - -our-/-tre words: colour, behaviour, favourite, and the three metric
   units. Anchored on the whole word - "your" is not "youour" - the
   exact set check_docs.py already trusts for documents.
 - -ise/-yse words: analyse and its inflections, plus the ten-stem
   -is(e/ing/ation) alternation (organise, recognise, and friends).
   Deliberately unanchored at the front, same as check_docs.py, so a
   compound is still caught - and it is a real shape here:
   "unrecognised" is one of this scan's own findings.
 - -ll- words, the family that let "relabelled" through both existing
   gates, because neither one had it. Anchored to THIRTEEN STEMS -
   label, cancel, model, travel, signal, level, channel, counsel,
   marvel, fuel, equal, total, dial - rather than to a bare "ll",
   because "ll" is one of the most ordinary digraphs in English prose.
   Measured against this tree: an unanchored search for "lled\\b" alone
   returns "called", "filled", "spelled" and "polled" before it returns
   one genuine offender, because those roots already carry a double
   consonant and neither dialect doubles it further. The thirteen stems
   are the ones where American drops a second consonant that British
   keeps, because their stress falls on the FIRST syllable (LA-bel,
   TRA-vel, CAN-cel) rather than the last - "control" and "compel"
   double under EITHER spelling and are deliberately left out, and so
   is "enrol/enroll", whose two dialects disagree about the bare verb
   but agree once a suffix is added ("enrolled" either way, since
   American's own base form already carries the second "l") - a
   different rule than this one enforces.

WHAT THIS WILL STILL MISS, ON PURPOSE
----------------------------------------
The gap is stated rather than hidden, same as check_docs.py states its
own. Thirteen stems and two borrowed families are not a dictionary:
"bevelled", "libelled" and "shovelled" take the same rule and are not
on the list, because the list is short by the ticket's own instruction
and a wider one risks the false-positive class it is built to avoid -
a name, or a word that only looks like the family. Proper nouns are the
sharper case an unanchored family would have to answer for: every
"-well" surname, "Cornwall", "Russell", "Powell", "Attwell" - and the
thirteen-stem anchoring is what keeps this check from ever reading one,
because none of them contains "label", "cancel", "model", "travel",
"signal", "level", "channel", "counsel", "marvel", "fuel", "equal",
"total" or "dial" as a substring. That is a claim about these thirteen,
not a guarantee about a fourteenth stem someone adds later - the next
stem added here earns its own instance of this same argument.

WHY NOT IMPORTED FROM tools/check_docs.py
--------------------------------------------
The -our- and -ise- families exist there already, word for word, and
importing them would be one list instead of two. Copied instead,
because the two checks answer different questions over different
trees: check_docs.py asks whether four registered documents are spelled
correctly, and a change to what counts as a violation there is an
owner-approved edit to a registry (AGENTS.md, "The documentation
system", rule 7). This check asks the same question of source comments,
and coupling the two would mean a docs-registry edit silently reaches
into every comment in the tree, or the reverse - neither of which
either file's own review is written to catch. tools/check.py's own
docstring gives the same reasoning for check_web.py and
check_server.py staying two files instead of one: "the two directories
are dangerous for opposite reasons."

A RATCHET, same shape as check_comments.py's ALLOWLIST
---------------------------------------------------------
This check is new, and the tree it reads was written across many
months with no machine ever holding it to rule 8. Running this file's
own scan before writing PINNED below - and before the one fix this
change makes - found fifty pre-existing occurrences across eighteen
files, most of them "modelled" repeated through dev/worker.test.mjs's
own prose about how a query planner is modelled. Failing the gate on
all of them in one slice would be exactly the mass rewrite
tools/check_comments.py's docstring already argues against: a large
diff over files this ticket did not touch, for no change in behavior,
when two of the eighteen are held by OTHER in-flight slices this one
may not edit at all.

So: the one instance the review named, apps/web/dashboard.js:1904's
"relabelled", is fixed in this change - it is what the ticket asks for,
and it costs one word. Every other pre-existing occurrence is PINNED
below, by (file, family label): count, on the terms ALLOWLIST already
states - a new occurrence anywhere fails, a pinned file that stops
matching fails too, and an entry comes off in the pull request that
next touches its file. Two pins carry a second reason instead of "not
this slice": server/worker.js and tools/check_web.py are held by
0.9-M1-S6 and 0.9-M1-S10 as of this writing, and this slice's brief
says read them, never edit them - so those two pins are not this file's
debt to clear even when the rest of PINNED empties, until whichever
slice lands first releases the file.
"""

import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# tools/ is not a package, and both files are scripts - the directory
# holding this one is already on sys.path[0] when it is run directly
# (`python tools/check_spelling.py`), which is what makes the bare
# import below resolve with no path surgery. dev/check_spelling.test.py
# inserts tools/ itself before importing this module, so the same bare
# import resolves there too - see that file's own comment for why the
# insertion has to happen before any import is written.
import check_comments  # noqa: E402

SCAN = check_comments.SCAN
KIND = check_comments.KIND
comments_only = check_comments.comments_only
missing_directories = check_comments.missing_directories

# This file and its suite are exempt for the reason
# tools/check_comments.py's own EXEMPT is: a file has to be able to
# name the spellings it forbids. Both are pinned here, not grown one
# file at a time - the same shape as check_comments.EXEMPT.
#
# tools/check_docs.py joins them for the identical reason, one file
# over: its own SPELLING docstring argues for an unanchored pattern by
# naming the compounds that pattern is FOR ("watercolour",
# "misbehaviour", "reorganisation") in a `#` comment, not a string, so
# a scan of comments finds them. dev/check_docs.test.py does not need
# the same exemption - its own example words all sit inside string
# literals the Python string rule already blanks, which this scan
# proved rather than assumed (see dev/check_spelling.test.py).
EXEMPT = frozenset({
    "tools/check_spelling.py",
    "dev/check_spelling.test.py",
    "tools/check_docs.py",
})

# (label, pattern). Every label is a PINNED key below, so renaming one
# is a deliberate act that fails the stale-entry arm until PINNED is
# edited to match - the same contract check_comments.py's PHRASES/
# ALLOWLIST pair keeps.
SPELLING = [
    ("metric units (-tre)", r"centimetre|kilometre|millimetre"),
    ("-our words", r"colour|behaviour|favourite"),
    ("analyse family", r"analys(?:e|ed|ing)\b"),
    ("-ise family",
     r"(?:quantis|normalis|summaris|organis|initialis|recognis"
     r"|minimis|maximis|serialis|standardis)(?:e[sd]?|ing|ation)\b"),
    ("-ll- doubling",
     r"(?:label|cancel|model|travel|signal|level|channel|counsel|marvel"
     r"|fuel|equal|total|dial)l(?:ed|ing|ers?|ors?|ous)\b"),
]

SPELLING_RULES = [(label, re.compile(pattern, re.IGNORECASE))
                  for label, pattern in SPELLING]

# {(file, label): count}. Pre-existing occurrences this check's own
# first run found, pinned so the gate opens green against a tree
# nothing has held to this rule before - see the docstring's RATCHET
# section for why a sweep is the wrong shape for this slice.
#
# server/worker.js and tools/check_web.py carry a note beyond "clear it
# on next touch": both are held by other in-flight slices (0.9-M1-S6,
# 0.9-M1-S10) as of this pin, and this slice's brief is to read their
# files, never edit them. The entries stay until whichever slice lands
# first and releases the file - this ratchet does not know which that
# will be, and does not need to.
PINNED = {
    ("apps/web/admin.html", "-our words"): 1,
    ("apps/web/admin.html", "-ll- doubling"): 1,
    ("apps/web/admin.js", "-ll- doubling"): 1,
    ("apps/web/theme.css", "-our words"): 1,
    ("dev/admin-session.test.mjs", "-ll- doubling"): 1,
    ("dev/admin.test.mjs", "-ise family"): 1,
    ("dev/demo-config.js", "-ll- doubling"): 1,
    ("dev/demo-stub.js", "-ll- doubling"): 1,
    ("dev/demo.test.mjs", "-ll- doubling"): 1,
    ("dev/memberkey.test.mjs", "-ll- doubling"): 2,
    ("dev/worker.test.mjs", "-ise family"): 3,
    ("dev/worker.test.mjs", "-ll- doubling"): 16,
    ("tools/agent_init_suite.py", "-our words"): 1,
    # Held by 0.9-M1-S10 (#339) as of this pin - read-only this slice.
    ("tools/check_web.py", "metric units (-tre)"): 1,
    ("tools/check_web.py", "-ll- doubling"): 2,
    # dev/check_web.test.py cites tools/check_web.py's own prose in a
    # comment - a citation, not a fresh sentence, same shape as the
    # `labeller` exception above.
    ("dev/check_web.test.py", "-ll- doubling"): 1,
}


def hits(text, kind):
    """[(line, label, matched text)] for one file's comments, sorted."""
    masked = comments_only(text, kind)
    found = []
    for label, pattern in SPELLING_RULES:
        for match in pattern.finditer(masked):
            line = masked.count("\n", 0, match.start()) + 1
            found.append((line, label, match.group(0)))
    return sorted(found)


def scan_tree(scan=None, repo=None):
    """({(file, label): [(line, matched)]}, [file]) over the scan set."""
    scan = SCAN if scan is None else scan
    repo = REPO if repo is None else repo
    found = {}
    scanned = []
    for dirname, extensions in scan:
        base = os.path.join(repo, *dirname.split("/"))
        if not os.path.isdir(base):
            continue
        for name in sorted(os.listdir(base)):
            full = os.path.join(base, name)
            if not os.path.isfile(full) or not name.endswith(extensions):
                continue
            relpath = "%s/%s" % (dirname, name)
            if relpath in EXEMPT:
                continue
            scanned.append(relpath)
            with open(full, encoding="utf-8") as handle:
                text = handle.read()
            kind = KIND[os.path.splitext(name)[1]]
            for line, label, matched in hits(text, kind):
                found.setdefault((relpath, label), []).append(
                    (line, matched))
    return found, scanned


def ratchet_problems(found, pinned, scanned):
    """Both directions: a new occurrence fails, and so does a dead pin.

    Same shape as tools/check_comments.py's ratchet_problems() - a
    pinned file reporting more than its pin fails as "one of these is
    new" rather than naming every line, since the pinned lines are
    already known debt and only the delta is this run's business; an
    unpinned file names every line, because there is no delta to speak
    of yet.
    """
    problems = []
    in_scan = set(scanned)

    for key in sorted(found):
        relpath, label = key
        places = found[key]
        allowed = pinned.get(key, 0)
        if len(places) <= allowed:
            continue
        if allowed:
            problems.append(
                "%s: %d comment(s) match %r and %d are pinned (lines %s). "
                "One of them is new - American spelling is the settled "
                "rule (AGENTS.md rule 8)"
                % (relpath, len(places), label, allowed,
                   ", ".join(str(line) for line, _m in places)))
        else:
            for line, matched in places:
                problems.append(
                    "%s:%d: comment says %r. American spelling is the "
                    "settled rule (AGENTS.md rule 8)"
                    % (relpath, line, matched))

    for key in sorted(pinned):
        relpath, label = key
        count = pinned[key]
        if relpath not in in_scan:
            problems.append(
                "PINNED names %s, which is not in the scan set - deleted, "
                "renamed, or exempt. Delete the entry" % relpath)
            continue
        actual = len(found.get(key, []))
        if actual == 0:
            problems.append(
                "PINNED pins %d occurrence(s) of %r in %s and none match "
                "any more. Delete the entry - the list is a ratchet and "
                "only shrinks" % (count, label, relpath))
        elif actual < count:
            problems.append(
                "PINNED pins %d occurrence(s) of %r in %s and %d match. "
                "Lower the count to %d" % (count, label, relpath, actual,
                                           actual))

    return problems


def problems():
    found, scanned = scan_tree()
    out = [
        "SCAN (imported from tools/check_comments.py) names %s, which "
        "does not exist. The check would pass while reading nothing"
        % name
        for name in missing_directories()
    ]
    out.extend(ratchet_problems(found, PINNED, scanned))
    return out


def main():
    issues = problems()
    if issues:
        print("check_spelling: %d problem(s)\n" % len(issues))
        for issue in issues:
            print("  " + issue)
        return 1

    _found, scanned = scan_tree()
    print("check_spelling: source comments hold to American spelling "
          "(%d files scanned, %d pre-existing occurrence(s) pinned across "
          "%d file(s) for the pull requests that next touch them)."
          % (len(scanned), sum(PINNED.values()),
             len({relpath for relpath, _label in PINNED})))
    return 0


if __name__ == "__main__":
    sys.exit(main())
