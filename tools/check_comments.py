#!/usr/bin/env python3
"""
Hold code comments to the rule that they explain why.

    python tools/check_comments.py

A comment states the present-tense reason the code is shaped the way it
is: what breaks if it is changed back, what trap the next reader is
about to walk into. What changed, and whatever triggered the change,
belongs in the commit message, the pull request and the issue - which
is already this project's system of record for anything code-centric.
AGENTS.md, "Code standards", is the prose statement of that rule; this
is the enforced one, and tools/check_docs.py is its counterpart for
documents.

A comment that narrates a change has a second cost beyond duplication.
It is a claim about the past that no test covers, so nothing ever
falsifies it: the code moves on and the sentence stays, and a reader
who trusts it is worse off than one who had no comment at all. `git
log` cannot go stale that way, because it is the record rather than a
description of it.

AND THE FILES STAY READABLE AS TEXT
-----------------------------------
A second rule over the same scan set: no raw control byte under 0x09.
It sits here because this is the checker that reads those four
directories, and because a 0x00 in one of them is the character this
file masks code with - see control_byte_problems() for both halves of
the argument, and for why the document rules in tools/check_docs.py
could not have seen the file where this last happened.

A RATCHET, not a sweep
----------------------
Every offender already in the tree is pinned in ALLOWLIST below, and
cleanup rides the pull requests that next touch those files - a mass
rewrite of comments across apps/web would be a large diff over the
directory the published site is built from, and can move dist/ with it
- a comment that spanned lines leaves its newline behind - for no
change in behavior. So:

 - a new occurrence anywhere in the scan set fails, naming file, line
   and phrase;
 - an ALLOWLIST entry that stops matching fails too, saying to delete
   or lower it.

The list can therefore only shrink, and it cannot go stale.

The pin lives outside the file it guards on purpose. AGENTS.md, "The
review bar": a check computed entirely from the file it guards cannot
detect that the file was rearranged - something outside the file has to
say what it may contain. It is keyed by file and phrase rather than by
line number, so an edit ten lines above an offender does not churn the
list; the count is what makes a second offense in an already-pinned
file fail.

WHY THE PHRASE LIST IS THIS SHORT
---------------------------------
Each pattern is a history marker in English, not merely a word that
appears in old comments. The distinction was made against this tree
rather than in the abstract, and two candidates lost:

 - Bare "no longer" is a state marker, not a history marker. It matches
   six comments here and every one of them is present tense: focus left
   inside something that is no longer there, two stats that no longer
   fit their labels, a shared point that no longer identifies a line, a
   page certifying a key it is no longer encrypting to. Pinning six
   correct comments would teach the next cleanup pull request to break
   them. Only the narrow "no longer used" survives - a comment saying a
   thing is unused is describing a deletion that did not happen.
 - "the old X" and "the previous X" are runtime referents here six
   times out of seven: the old key during rotation, the old rows when a
   table is rebuilt, the previous snapshot in a diff. The one genuinely
   narrating comment they would catch is not worth the six.

The gap that leaves is real and is stated rather than hidden: this
check reads phrases, so a comment that narrates a change without using
one of them passes. It is a ratchet on the common shapes, not a proof.

AND A QUOTATION OF ANOTHER FILE HAS TO STILL BE IN IT
-----------------------------------------------------
A third rule over the same scan set, and the only one here that reads
outside the file it guards. The ratchet above is a phrase rule computed
from one file, so a comment falsified by an edit to a DIFFERENT file is
invisible to it however tight the phrase list gets - AGENTS.md, "The
review bar", states that corollary and #217 is the ticket. See
citation_problems() for the argument and for why archive/DESIGN.md is a
different file from DESIGN.md.

WHY THE CITATION RULE IS THIS NARROW
------------------------------------
Because the wide version does not work, which was established by
measurement against this tree rather than argued. Three candidates lost
before this one, each stricter than the last:

 - Any quoted string of eight characters or more that appears nowhere
   else in the tree: 422 reports out of 1161 quotations. Comments here
   quote rhetorically far more often than they cite - "is this the same
   person", "the answer is nothing" - and they quote code inline.
 - The same, restricted to comments that name a file somewhere in the
   block: 98 of 212. Naming a file three sentences away says nothing
   about whether the quotation is a citation of it.
 - A file plus a bare identifier, no quotation: 332 of 487, and
   unfixable. English verbs follow filenames constantly here
   ("apps/web/form.js writes ...", "DESIGN.md argues ..."), and no stop
   list separates a verb from an identifier without parsing the
   sentence.

Requiring a connective between the file and the quotation - a comma, a
colon, a possessive, or the quotation standing before "in FILE" - took
it to 63 candidates, every one of them a real citation, and 7 that did
not resolve. Six were genuinely stale, all six pointing at headings the
2026-08-08 documentation rewrite moved into archive/; the seventh
quoted "an account" where DESIGN.md says "the account". Zero false
positives, which is why this is a hard rule with no allowlist rather
than a ratchet.

What that narrowness costs is stated rather than hidden, and it is the
same gap the phrase list has: a comment that describes another file
without quoting it is not a citation and is not checked. Quoting the
thing you are relying on is what makes the reliance checkable. This
catches the shape that can be caught, not the class.

AND ONE RATCHET UNDER IT, FOR THE DOCUMENTS THAT MOVED FIRST
------------------------------------------------------------
The documentation was rewritten to the 0.9 design ahead of the code, by
owner ruling: the documents describe the system being built, while the
pages and the Worker still implement the one being replaced, and their
comments are rewritten by the milestone that reaches each file rather
than by a separate hunt. So a set of citations was falsified by a
change that was correct - the sections they name are gone because the
design they described is.

CITATION_PINS below is that set, and it is a ratchet on the same terms
as ALLOWLIST, counts included - {(file, cited path, quotation): count}.
A pinned citation that starts resolving fails, a pin whose comment is
gone fails, a pin whose count is higher than the number of comments
carrying it fails, a SECOND comment repeating a pinned citation fails,
and anything not pinned fails as before. The list shrinks by edits to
this file and grows by nothing else. Its entries are also the derived
work list - every comment in the pre-0.9 code that the rewrite
falsified, named by file, so the slice that rewrites a file can see
what it owes without reading a document to find out.

The count is not decoration, and this list shipped without one. As a
bare set of triples it read "every occurrence of this citation is
fine", which is not what a pin records: a pin records the comments that
were already there when the documents moved. A comment written today,
repeating a pinned quotation word for word, is new work pointing at a
section that does not exist - and both this gate and the suite that
arms it went green over exactly that, proven by mutation in the review
of the change that added the list (#279, 2026-08-13). Counting closes
it, for the same reason ALLOWLIST counts.

The two files that define and test the rule are EXEMPT, because a file
has to be able to name the phrases it forbids - the same reason
tools/check_server.py strips comments before it reads a vars block, so
that server/wrangler.toml can argue at length that ADMIN_TELEGRAM_IDS
is deliberately absent while the allowlist still refuses an assignment
under that name. The exemption is pinned in dev/check_comments.test.py
so it cannot grow one file at a time.

archive/ is never scanned. It is frozen history, and history is exactly
what it is allowed to contain.
"""

import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (directory, extensions). Directories rather than a recursive walk:
# node_modules, _site and .wrangler are all somebody else's code, and a
# walk that has to exclude them grows an exclusion list instead of a
# scan list.
#
# THIS SCANS SOURCE, AND dist/ MUST NEVER JOIN IT (#181). dist/ is the
# published site: apps/web with every comment deliberately removed. This
# check exists to make comments mandatory, so pointed at that tree it
# would be enforcing a rule about comments against files designed to have
# none - and it would go GREEN doing it, because a file with no comments
# has no comment that narrates a change. That is the worst failure shape
# this repository knows: a check that reports success for a run that
# verified nothing.
#
# It would not stay green, as it happens - every ALLOWLIST pin below
# would stop matching, and a pin that stops matching fails. But that is
# a second line of defense that happens to hold, not the reason. The
# reason is that source is the only tree where this question means
# anything, and dev/check_comments.test.py pins the scan set so adding
# the artifact is a failing check rather than an edit somebody makes on
# a tidy-up afternoon.
GENERATED = "dist"

# server/schema.sql is in here because its comments are the ones
# somebody ACTS on: which migration drops rows, which index rename is
# half of an act, what a re-run does to a database that already holds
# data. A sentence there is read by an operator with a terminal open,
# which makes it the last place in this repository where a claim about
# the past is harmless - and the file sat outside the scan while every
# .js beside it was read (#227).
SCAN = [
    ("apps/web", (".js", ".css", ".html")),
    ("server", (".js", ".sql")),
    ("dev", (".mjs", ".py", ".js")),
    ("tools", (".py",)),
]

EXEMPT = frozenset({
    "tools/check_comments.py",
    "dev/check_comments.test.py",
})

KIND = {".js": "js", ".mjs": "js", ".css": "css", ".html": "html",
        ".py": "py", ".sql": "sql"}

# Per language: what opens a comment, and what opens a string that must
# NOT be read as one. Two of the four matter for a reason already in
# the tree - apps/web tells a member their session is "no longer
# valid", and tools/ carries its reasoning in docstrings rather than in
# "#" comments, so Python's triple-quoted strings are comments here and
# its ordinary strings are not.
SYNTAX = {
    "js": {"line": ("//",), "block": (("/*", "*/"),),
           "string": ('"', "'", "`"), "regex": True},
    "css": {"line": (), "block": (("/*", "*/"),),
            "string": ('"', "'"), "regex": False},
    "html": {"line": (), "block": (("<!--", "-->"),),
             "string": (), "regex": False},
    "py": {"line": ("#",), "block": (('"""', '"""'), ("'''", "'''")),
           "string": ('"', "'"), "regex": False},
    # Both quotes are code in SQL and neither is a comment: single
    # quotes hold string literals, double quotes hold identifiers, and
    # server/schema.sql's seeds and column names are written in them.
    "sql": {"line": ("--",), "block": (("/*", "*/"),),
            "string": ("'", '"'), "regex": False},
}

# Code is blanked to a character that no whitespace class matches, so
# two comments with code between them cannot be joined into a phrase
# nobody wrote. A space would let exactly that happen.
BLANK = "\x00"

# What may separate the words of a phrase inside one comment: ordinary
# whitespace, and the leading "*", "#", "//" or "--" of a continuation
# line. A phrase reflowed across a line break is the same phrase, and
# every comment in server/schema.sql is wrapped prose - so without the
# hyphens here that file's rule would hold only for sentences that
# happen to fit on one line.
GAP = r"[\s*#/-]+"

# A "/" may open a regular expression only where an expression may
# begin. Without this, `.replace(/\//g, "_")` in server/worker.js reads
# as a comment opener and the rest of that line becomes prose the file
# never contained.
REGEX_BEFORE = frozenset("(,=:[!&|?{};+-*%^~<>") | {""}

# Whitespace, continuation marks and comment openers immediately before
# a phrase - everything that is punctuation of the comment rather than
# words of the sentence.
LEAD = re.compile(r"""[\s*#/<!"'-]+$""")

# What opens a continuation line, stripped when a comment is read as one
# sentence. Only the LEADING marker, and only these: GAP above collapses
# every "/" and "-" it meets, which is right for a phrase and wrong for
# a citation, because it turns "server/README.md" into a bare
# "README.md" and resolves the citation against a different file. That
# failure is silent.
#
# "--" is two or more, never one, and that is the whole reason SQL can
# be read at all here: every comment in server/schema.sql is wrapped
# prose opening with "--", so a citation that spans two of its lines
# reads as 'Admin -- accounts and deletion' unless the marker comes off.
# A single leading "-" is a prose bullet and stays - eating one would
# silently reshape the sentence a quotation is measured against.
CONTINUATION = re.compile(r"^[ \t]*(?:\*+|\#+|//+|<!--|--+)?[ \t]*")

# A path this repository could hold. Extensions rather than "anything
# with a dot" so that "e.g." and "t.me/handle" are not read as files.
CITED = r"(?:[\w.-]+/)*[\w.-]+\.(?:md|py|js|mjs|css|html|sql|json|toml|txt)"

# A CITATION IS A FILE PLUS A CONNECTIVE PLUS A QUOTATION, and the
# connective is what makes the rule usable rather than merely correct.
# Bare juxtaposition - a quotation sitting next to a filename with
# nothing joining them - is a quoted utterance in this tree, not a
# citation: check_web.py imagines a key pasted into config.js "just to
# test the export locally", and dashboard-render.test.mjs paraphrases
# one file's comment while naming another. Neither ever resolves, and
# both would be reported forever. See WHY THE CITATION RULE IS THIS
# NARROW in the docstring for what that costs and what it buys.
CITATIONS = (
    (re.compile(r"(%s)(?:'s|[,:])\s+\"([^\"\n]{6,160})\"" % CITED), 1, 2),
    (re.compile(r"\"([^\"\n]{6,160})\"\s+(?:in|of|under)\s+(%s)\b" % CITED),
     2, 1),
)

# Ways of writing the same quotation that are not staleness: the case
# it was folded to mid-sentence, the line the comment wrapped on, and
# whether the author typed a hyphen where the document has an em dash.
# All three are real comments here, and reporting them would teach the
# next reader to distrust the rule.
# Written as escapes rather than as the characters themselves: this is
# the file that argues bytes should stay ordinary, and a range of six
# dashes nobody can tell apart on screen is the worst place to spend
# that credibility.
DASHES = re.compile("[\u2010-\u2015]")
WRAPPED = re.compile(r"\s+")


def marker(*words):
    return re.compile(r"\b" + GAP.join(words) + r"\b", re.I)


# (label, pattern, why it is not a comment's job). The label is the
# ALLOWLIST key, so renaming one is a deliberate act that fails the
# stale-entry arm until the list is edited to match.
PHRASES = [
    ("used to", marker("used", "to"),
     "It narrates a past state."),
    ("carried over from", marker("carried", "over", "from"),
     "It narrates where the code came from."),
    ("no longer used", marker("no", "longer",
                              "(?:used|needed|necessary|required)"),
     "Code that is not used is deleted, not annotated."),
    ("originally", marker("originally"),
     "It narrates a past state."),
    ("previously", marker("previously"),
     "It narrates a past state."),
    ("renamed from", marker("renamed", "from"),
     "The rename is in the diff."),
    ("moved from", marker("moved", "from"),
     "The move is in the diff."),
    ("this replaces", marker("this", "replaces"),
     "What it replaces is in the diff."),
    ("was rejected because", marker("was", "rejected", "because"),
     "Say what the code does not do and why, in the present tense; the "
     "decision to reject belongs in the commit and the issue."),
]

# Phrases that narrate only when a subject stands in front of them.
# English gives "used to" two readings with identical surface form -
# "the assertion used to live here" narrates, and "the uncompressed
# point ... Used to check a key file against itself" is the passive
# "employed to", present tense and correct. apps/web/crypto.js is the
# second, found by running this check rather than by arguing about it,
# and a subject is the one signal that separates them without parsing
# the sentence. The residual is stated rather than hidden: "the key
# used to encrypt the payload" has a subject and would be reported.
# That failure is loud and rephrases to "the key that encrypts the
# payload"; the opposite failure is silent.
#
# The exemption stays this narrow on purpose. Widening it to spare a
# form of "be" in front of the phrase would clear the passive reading
# without any argument about subjects - "has been used to rehearse the
# migration" - but it clears "the flag was used to gate the beta" with
# it, and that one narrates. Reporting the passive reading and
# rephrasing it in a line is the trade this makes, in that direction,
# every time.
NEEDS_SUBJECT = frozenset({"used to"})

# What the scan set holds, pinned so the ratchet starts closed against
# each file on the day that file enters it. {(file, phrase): count}. An
# entry comes OFF this list in the pull request that next touches its
# file - never by raising a count. That sentence is the half of the
# ratchet nothing here enforces: a count that does not rise satisfies
# the check, so a change can edit a pinned file, walk past its entry,
# and pass. Whoever edits a file named below reads its entry first and
# either clears it or says in the commit why it survived the visit.
ALLOWLIST = {
    ("dev/ui.test.mjs", "used to"): 1,
}

# {(file, cited path, quotation): count} for every citation the 0.9
# documentation rewrite falsified. Keyed by the quotation rather than by
# a line number, so an edit above an entry does not churn the list; the
# count is what makes a second comment repeating a pinned citation fail,
# exactly as ALLOWLIST's count makes a second offense in a pinned file
# fail. A count comes DOWN as comments are trued and the entry goes when
# it reaches zero. Raising one is an edit to this file with a reason in
# the pull request, which is the only way a pin should ever grow.
#
# THE RETIREMENT CONDITION IS THE MILESTONE, NOT A DATE: an entry comes
# off in the slice that rewrites its file to the 0.9 design, which is
# the same slice that rewrites the comment. The set empties when the
# pre-0.9 pages and Worker are gone, and this block goes with it - a pin
# list that has outlived its cause is the stale roster this repository
# keeps deleting.
#
# Nothing here is an exemption from the rule. Each entry is a comment
# known to be pointing at a section that no longer exists, recorded
# where a check can hold it, instead of a red gate on work the owner
# ruled out of this slice.
#
# The two OPERATIONS.md "The keys" entries are here by a deliberate act
# rather than by discovery, and they are the reason to distrust a short
# quotation. Both resolved after the rewrite deleted the section they
# name, because two unrelated words of prose elsewhere in the file spell
# the same nine characters - a citation passing on an accident, which is
# the quiet direction. The rewrite took that phrasing out so these fail
# honestly and land on this list with the rest.
#
# THE TWO ENTRIES READING 2 ARE WHY THIS IS COUNTED. apps/web/dashboard.js
# and server/worker.js each cite DESIGN.md, "The charts and the snapshot"
# from two different comments, and while this list was a bare set of
# triples one pin apiece silently covered both - so twelve entries were
# standing for FOURTEEN falsified comments, and the derived work order
# under-counted the work by two. Counting found them the moment it was
# added. Neither is a new offense; both were already in the tree when the
# documents moved.
CITATION_PINS = {
    ("apps/web/admin.html", "DESIGN.md",
     "The charts and the snapshot"): 1,
    ("apps/web/config.js", "OPERATIONS.md", "The keys"): 1,
    ("tools/check_web.py", "OPERATIONS.md", "The keys"): 1,
    ("apps/web/admin.js", "DESIGN.md", "Key custody"): 1,
    ("apps/web/config.js", "DESIGN.md", "Key custody"): 1,
    ("apps/web/memberkey.js", "DESIGN.md", "Members hold a key too"): 1,
    ("server/schema.sql", "DESIGN.md", "The charts and the snapshot"): 1,
    ("server/worker.js", "DESIGN.md",
     "The prefill is scoped to the account"): 1,
    ("dev/crypto.test.mjs", "DESIGN.md", "Key custody"): 1,
}


def skip_string(text, start):
    """The index just past the string literal opening at `start`.

    An unterminated quote stops at the newline instead of swallowing
    the rest of the file, so one stray apostrophe cannot silently blind
    the whole check. Only a template literal legitimately spans lines.
    """
    quote = text[start]
    index = start + 1
    while index < len(text):
        char = text[index]
        if char == "\\":
            index += 2
            continue
        if char == quote:
            return index + 1
        if char == "\n" and quote != "`":
            return index
        index += 1
    return len(text)


def skip_regex(text, start):
    """The index just past the regex literal opening at `start`.

    Character classes are tracked because `/^\\/submission\\/([^/]+)$/`
    is real code in server/worker.js: a scanner that let the "/" inside
    `[^/]` close the literal would resume in the middle of one.

    A literal that reaches the end of its line was not a literal - a
    regex cannot span lines - so the "/" is handed back as ordinary
    code rather than the rest of the file being consumed.
    """
    index = start + 1
    in_class = False
    while index < len(text):
        char = text[index]
        if char == "\\":
            index += 2
            continue
        if char == "\n":
            break
        if char == "[":
            in_class = True
        elif char == "]":
            in_class = False
        elif char == "/" and not in_class:
            return index + 1
        index += 1
    return start + 1


def comments_only(text, kind):
    """`text` with everything outside a comment blanked.

    Same length and same line breaks as the input, so a match's offset
    still names the line it is on. Returning spans instead would make
    every caller do that arithmetic.
    """
    syntax = SYNTAX[kind]
    out = [BLANK] * len(text)
    index = 0
    previous = ""
    while index < len(text):
        char = text[index]
        if char == "\n":
            out[index] = "\n"
            index += 1
            continue

        opened = False
        for start, end in syntax["block"]:
            if text.startswith(start, index):
                stop = text.find(end, index + len(start))
                stop = len(text) if stop < 0 else stop + len(end)
                for position in range(index, stop):
                    out[position] = text[position]
                index = stop
                opened = True
                break
        if opened:
            continue

        for start in syntax["line"]:
            if text.startswith(start, index):
                stop = text.find("\n", index)
                stop = len(text) if stop < 0 else stop
                for position in range(index, stop):
                    out[position] = text[position]
                index = stop
                opened = True
                break
        if opened:
            continue

        if char in syntax["string"]:
            index = skip_string(text, index)
            previous = '"'
            continue
        if syntax["regex"] and char == "/" and previous in REGEX_BEFORE:
            index = skip_regex(text, index)
            previous = "/"
            continue

        if not char.isspace():
            previous = char
        index += 1
    return "".join(out)


def has_subject(masked, start):
    """Whether a sentence subject stands before the phrase at `start`.

    Everything back to the last sentence end, comment opener or run of
    code is punctuation rather than words. If nothing is left, the
    phrase opens its own sentence and has no subject to narrate about.
    """
    before = LEAD.sub("", masked[:start])
    return bool(before) and before[-1] not in ".!?:;" + BLANK


def hits(text, kind):
    """[(line, label, matched text)] for one file's source, sorted."""
    masked = comments_only(text, kind)
    found = []
    for label, pattern, _why in PHRASES:
        for match in pattern.finditer(masked):
            if label in NEEDS_SUBJECT and not has_subject(masked,
                                                          match.start()):
                continue
            line = masked.count("\n", 0, match.start()) + 1
            found.append((line, label,
                          re.sub(GAP, " ", match.group(0)).strip()))
    return sorted(found)


def missing_directories():
    """Scan directories that are not there.

    Reported rather than skipped, the #34 way: a scanner that cannot
    find what it was pointed at must say so, because "nothing wrong
    here" and "nothing read here" print identically.
    """
    return [name for name, _extensions in SCAN
            if not os.path.isdir(os.path.join(REPO, *name.split("/")))]


def scan_tree():
    """({(file, label): [(line, matched)]}, [file])."""
    found = {}
    scanned = []
    for dirname, extensions in SCAN:
        base = os.path.join(REPO, *dirname.split("/"))
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


def ratchet_problems(found, allowlist, scanned):
    """Both directions: anything new fails, and so does a dead pin."""
    problems = []
    reasons = {label: why for label, _pattern, why in PHRASES}
    in_scan = set(scanned)
    advice = ("Say why the code is the way it is; what changed, and "
              "whatever triggered it, belongs in the commit message, "
              "the pull request and the issue")

    for key in sorted(found):
        relpath, label = key
        places = found[key]
        pinned = allowlist.get(key, 0)
        if len(places) <= pinned:
            continue
        if pinned:
            problems.append(
                "%s: %d comments match %r and %d are pinned (lines %s). "
                "One of them is new. %s %s"
                % (relpath, len(places), label, pinned,
                   ", ".join(str(line) for line, _m in places),
                   reasons[label], advice))
        else:
            for line, matched in places:
                problems.append(
                    "%s:%d: comment says %r. %s %s"
                    % (relpath, line, matched, reasons[label], advice))

    for key in sorted(allowlist):
        relpath, label = key
        pinned = allowlist[key]
        actual = len(found.get(key, []))
        if label not in reasons:
            problems.append(
                "ALLOWLIST pins %r in %s, and no pattern produces that "
                "phrase. Delete the entry, or restore the pattern it "
                "was written for" % (label, relpath))
        elif relpath not in in_scan:
            problems.append(
                "ALLOWLIST pins %s, which is not in the scan set - "
                "deleted, renamed, or exempt. Delete the entry"
                % relpath)
        elif actual == 0:
            problems.append(
                "ALLOWLIST pins %d occurrence(s) of %r in %s and none "
                "match. Delete the entry - the list is a ratchet and "
                "only shrinks" % (pinned, label, relpath))
        elif actual < pinned:
            problems.append(
                "ALLOWLIST pins %d occurrence(s) of %r in %s and %d "
                "match. Lower the count to %d"
                % (pinned, label, relpath, actual, actual))

    return problems


def generated_tree_problems(scan=None):
    """A problem if the scan set has been pointed at the built site.

    Pure, over the scan set, so the rule can be exercised without moving
    a directory. See GENERATED above for why this is worth a check of
    its own rather than a comment: the failure it refuses is silent.
    """
    scan = SCAN if scan is None else scan
    return [
        "SCAN names %s, which is generated - it is apps/web with every "
        "comment removed on purpose (#181). This check makes comments "
        "mandatory, so reading that tree asks a question the tree was "
        "built to answer trivially. Scan the source" % dirname
        for dirname, _extensions in scan
        if dirname == GENERATED or dirname.startswith(GENERATED + "/")
    ]


def control_byte_problems(scan=None, repo=None):
    """A problem per raw control byte in the files this check reads.

    THE SCAN SET IS THE REASON THIS RULE LIVES HERE rather than beside
    the document rules in tools/check_docs.py. That checker reads the
    registered documents and security/; this one reads the four source
    directories, which is where the byte landed - inside a string
    literal in a .mjs suite, a file no document rule would ever open.

    Every file above is read as text by something. A byte under 0x09 is
    not text, and the damage is not that it renders oddly:

     - grep and ripgrep sniff the first buffer of a file, decide it is
       binary and answer "Binary file X matches" instead of the line. A
       search of the most-read file in the tree then reports nothing,
       which is indistinguishable from a search that found nothing.
     - it defeats THIS check in particular. Code is masked to a literal
       0x00 - see BLANK above - so that two comments with code between
       them cannot be joined into a phrase nobody wrote. A 0x00 the file
       genuinely contains is the same character as that mask, so a
       narrating phrase split by one is a phrase the ratchet cannot see.

    Escapes cost nothing: "\\x00" in JavaScript or Python is the same
    runtime byte and leaves the file text. So the rule is not a
    restriction on what a suite may send, only on how it is spelled.

    EXEMPT is not honored here, and that is deliberate. Those two files
    are excused from the phrase scan because a file has to be able to
    name the phrases it forbids; nothing about that argument extends to
    bytes, and they are read as text like everything else.

    The band stops below 0x09 because tab, newline and carriage return
    are text and everything under them is not. 0x0B and up are left
    alone rather than guessed at - a form feed is a formatting choice
    somebody might defend, and no tool here treats one as binary.

    The parameters exist so dev/check_comments.test.py can drive this
    over a tree it builds. Reading the real directories is main()'s job,
    and a rule exercised only against the tree it guards cannot be shown
    to fail.
    """
    scan = SCAN if scan is None else scan
    repo = REPO if repo is None else repo

    out = []
    for dirname, extensions in scan:
        base = os.path.join(repo, *dirname.split("/"))
        if not os.path.isdir(base):
            continue
        for name in sorted(os.listdir(base)):
            full = os.path.join(base, name)
            if not os.path.isfile(full) or not name.endswith(extensions):
                continue
            with open(full, "rb") as handle:
                raw = handle.read()
            for index, byte in enumerate(raw):
                if byte >= 0x09:
                    continue
                out.append(
                    "%s/%s:%d: a raw 0x%02x byte. grep and ripgrep read "
                    "the whole file as binary and answer nothing out of "
                    "it, and this check's own code mask is that same "
                    "character. Write the escape instead - the runtime "
                    "bytes are identical"
                    % (dirname, name, raw.count(b"\n", 0, index) + 1, byte))
    return out


def comment_regions(masked):
    """[(start, stop)] for each comment region of a masked file.

    Newlines survive comments_only() everywhere, so a region ends at the
    first blanked code character rather than at a line break - which is
    what makes a run of "//" lines one comment instead of several.
    """
    regions = []
    start = None
    for index, char in enumerate(masked):
        if char == BLANK:
            if start is not None:
                regions.append((start, index))
                start = None
        elif start is None:
            start = index
    if start is not None:
        regions.append((start, len(masked)))
    return regions


def unwrap(masked, start, stop):
    """One comment region as a single line, and each character's offset.

    The offsets are what let a match report the line it was written on
    after the wrapping has been taken out; returning the text alone
    would put every citation in a block comment on the block's line.
    """
    text = []
    offsets = []
    position = start
    for number, raw in enumerate(masked[start:stop].split("\n")):
        if number:
            text.append(" ")
            offsets.append(position)
        for index in range(CONTINUATION.match(raw).end(), len(raw)):
            text.append(raw[index])
            offsets.append(position + index)
        position += len(raw) + 1
    return "".join(text), offsets


def citations(text, kind):
    """[(line, cited path, quotation)] for one file's source, sorted."""
    masked = comments_only(text, kind)
    found = []
    for start, stop in comment_regions(masked):
        flat, offsets = unwrap(masked, start, stop)
        for pattern, path_group, quote_group in CITATIONS:
            for match in pattern.finditer(flat):
                at = offsets[match.start(quote_group)]
                found.append((masked.count("\n", 0, at) + 1,
                              match.group(path_group),
                              match.group(quote_group)))
    return sorted(found)


def anchor(text):
    """A quotation as it is compared against the file it names."""
    return WRAPPED.sub(" ", DASHES.sub("-", text)).strip().lower()


def all_citations(scan=None, repo=None):
    """[(file, line, cited path, quotation)] over the scan set.

    Separate from the rule below because main() has to be able to say
    how many citations were checked. "Every citation resolves" is true
    of a scan that found none, and that is the failure shape this
    repository holds to be worse than a red gate.
    """
    scan = SCAN if scan is None else scan
    repo = REPO if repo is None else repo
    out = []
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
            with open(full, encoding="utf-8") as handle:
                text = handle.read()
            kind = KIND[os.path.splitext(name)[1]]
            for line, path, quote in citations(text, kind):
                out.append((relpath, line, path, quote))
    return out


def unresolved_citations(scan=None, repo=None):
    """[(file, line, cited path, quotation, message)] that do not resolve.

    THIS IS THE ONE RULE HERE THAT READS OUTSIDE THE FILE IT GUARDS, and
    that is the whole point of it (#217). AGENTS.md, "The review bar":
    a check computed entirely from the file it guards cannot detect what
    happened outside it - so the phrase ratchet above, however tight,
    structurally cannot see a comment falsified by an edit to a
    different file. The worked example is a comment justifying a rail
    width by a note in a page another change had deleted; the sentence
    stayed, the note went, and nothing anywhere went red.

    archive/DESIGN.md is a DIFFERENT FILE from DESIGN.md and the
    distinction is load-bearing. It holds the pre-2026-08-08 wording of
    every heading the documentation rewrite moved, so a resolver
    matching on basename would find each stale citation's target in the
    archive and pass - quietly, which is the direction that costs.
    Citing the archive directly stays correct: AGENTS.md sanctions it as
    where the full reasoning lives when a root document compresses a
    decision to a sentence.

    Separate from the two rules below because both need this answer:
    one reports what is not pinned, the other reports a pin that is no
    longer true of it.

    The parameters exist so dev/check_comments.test.py can drive this
    over trees it builds. The real tree's remaining failures are all
    pinned, and a rule exercised only against a tree it passes cannot
    be shown to fire.
    """
    repo = REPO if repo is None else repo
    contents = {}
    out = []
    for relpath, line, path, quote in all_citations(scan, repo):
        if path not in contents:
            target = os.path.join(repo, *path.split("/"))
            if not os.path.isfile(target):
                contents[path] = None
            else:
                # errors="replace" because a citation of a file this
                # cannot decode is still worth answering; a traceback
                # out of a gate stage answers nothing.
                with open(target, encoding="utf-8",
                          errors="replace") as handle:
                    contents[path] = anchor(handle.read())
        if contents[path] is None:
            out.append((
                relpath, line, path, quote,
                "%s:%d: the comment cites %s, which is not a file here. "
                "Point it at the file that holds this now, or drop the "
                "reference - a pointer to nothing is worse than none"
                % (relpath, line, path)))
        elif anchor(quote) not in contents[path]:
            out.append((
                relpath, line, path, quote,
                "%s:%d: the comment quotes %r out of %s, and %s does not "
                "contain it. Either the quotation is wrong or what it "
                "named has moved: true the comment against the file as "
                "it stands now, or cite the file that carries the "
                "wording today (archive/ keeps the pre-2026-08-08 one)"
                % (relpath, line, quote, path, path)))
    return out


def broken_by_citation(scan=None, repo=None):
    """{(file, cited path, quotation): [(line, message)]} of what is broken.

    Both rules below compare COUNTS rather than asking whether a triple
    appears at all, so the grouping is done once here for both of them.
    """
    out = {}
    for relpath, line, path, quote, message in unresolved_citations(
            scan, repo):
        out.setdefault((relpath, path, quote), []).append((line, message))
    return out


def citation_problems(scan=None, repo=None, pinned=None):
    """A problem per broken quotation beyond the count pinned for it.

    Membership alone would say "every occurrence of this citation is
    forgiven", and that is not what an entry in CITATION_PINS records:
    it records the comments that were already there when the documents
    moved. A comment written after them, repeating a pinned quotation
    word for word, is new work pointing at a section that does not
    exist, and it is reported here rather than covered.
    """
    pinned = CITATION_PINS if pinned is None else pinned
    broken = broken_by_citation(scan, repo)
    problems = []
    for key in sorted(broken):
        relpath, path, quote = key
        places = broken[key]
        allowed = pinned.get(key, 0)
        if len(places) <= allowed:
            continue
        if allowed:
            problems.append(
                "%s: %d comments cite %s, %r and the pin covers %d of "
                "them (lines %s). One is new, and it points at wording "
                "that is not there: true it against the file as it stands "
                "now, or cite the file that carries the wording today. "
                "A pin covers the comments that were already here when "
                "the documents moved, never one written after them"
                % (relpath, len(places), path, quote, allowed,
                   ", ".join(str(line) for line, _m in places)))
        else:
            problems.extend(message for _line, message in places)
    return problems


def citation_pin_problems(scan=None, repo=None, pinned=None):
    """A problem per pin that no longer describes what is broken.

    The half that makes CITATION_PINS a ratchet rather than a list of
    excuses. Three ways an entry stops being true and all three fail
    here: the document grew the wording back, so the citation resolves
    and the pin is a claim about nothing; the comment was rewritten by
    the milestone that reached its file, which is the retirement this
    list is written to have; or one of several comments carrying a
    pinned citation was trued and the count is now too high. The entry
    comes off or comes down, and the list cannot go stale the way an
    unchecked roster does.
    """
    pinned = CITATION_PINS if pinned is None else pinned
    broken = broken_by_citation(scan, repo)
    problems = []
    for key in sorted(pinned):
        relpath, path, quote = key
        count = pinned[key]
        actual = len(broken.get(key, []))
        if actual == 0:
            problems.append(
                "CITATION_PINS pins %r out of %s in %s, and that "
                "citation is not broken any more - the comment was "
                "rewritten, or the wording came back. Delete the entry; "
                "the list is a ratchet and only shrinks"
                % (quote, path, relpath))
        elif actual < count:
            problems.append(
                "CITATION_PINS pins %d occurrence(s) of %r out of %s in "
                "%s and the number still broken is %d. Lower the count "
                "to %d; the list is a ratchet and only shrinks"
                % (count, quote, path, relpath, actual, actual))
    return problems


def problems():
    found, scanned = scan_tree()
    out = generated_tree_problems()
    out.extend(
        "SCAN names %s, which does not exist. The check would pass "
        "while reading nothing" % name
        for name in missing_directories()
    )
    out.extend(control_byte_problems())
    out.extend(citation_problems())
    out.extend(citation_pin_problems())
    out.extend(ratchet_problems(found, ALLOWLIST, scanned))
    return out


def main():
    issues = problems()
    if issues:
        print("check_comments: %d problem(s)\n" % len(issues))
        for issue in issues:
            print("  " + issue)
        return 1

    _found, scanned = scan_tree()
    # What was established, not the part that is easy to say: "no new
    # offenses" is true of a scan that read no files, and so is "every
    # citation resolves". The counts are what make the line worth
    # printing.
    print("check_comments: comments explain why, every scanned file is "
          "text and every quotation of another file is still in it or "
          "pinned (%d files scanned, %d cross-file citation(s) checked, "
          "%d phrase occurrence(s) and %d citation(s) pinned for the "
          "slice that rewrites their file)."
          % (len(scanned), len(all_citations()), sum(ALLOWLIST.values()),
             sum(CITATION_PINS.values())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
