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

A RATCHET, not a sweep
----------------------
Every offender already in the tree is pinned in ALLOWLIST below, and
cleanup rides the pull requests that next touch those files - a mass
rewrite of comments across apps/web would be a large diff over the
directory that is copied verbatim to the published site, for no change
in behavior. So:

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

The two files that define and test the rule are EXEMPT, because a file
has to be able to name the phrases it forbids - the same reason
tools/check_server.py strips comments before looking for
DEV_LOGIN_SECRET, so that server/wrangler.toml can say at length that
it must never be set. The exemption is pinned in
dev/check_comments.test.py so it cannot grow one file at a time.

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
SCAN = [
    ("apps/web", (".js", ".css", ".html")),
    ("server", (".js",)),
    ("dev", (".mjs", ".py", ".js")),
    ("tools", (".py",)),
]

EXEMPT = frozenset({
    "tools/check_comments.py",
    "dev/check_comments.test.py",
})

KIND = {".js": "js", ".mjs": "js", ".css": "css", ".html": "html",
        ".py": "py"}

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
}

# Code is blanked to a character that no whitespace class matches, so
# two comments with code between them cannot be joined into a phrase
# nobody wrote. A space would let exactly that happen.
BLANK = "\x00"

# What may separate the words of a phrase inside one comment: ordinary
# whitespace, and the leading "*", "#" or "//" of a continuation line.
# A phrase reflowed across a line break is the same phrase.
GAP = r"[\s*#/]+"

# A "/" may open a regular expression only where an expression may
# begin. Without this, `.replace(/\//g, "_")` in server/worker.js reads
# as a comment opener and the rest of that line becomes prose the file
# never contained.
REGEX_BEFORE = frozenset("(,=:[!&|?{};+-*%^~<>") | {""}

# Whitespace, continuation marks and comment openers immediately before
# a phrase - everything that is punctuation of the comment rather than
# words of the sentence.
LEAD = re.compile(r"""[\s*#/<!"'-]+$""")


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
NEEDS_SUBJECT = frozenset({"used to"})

# Every offender in the tree as of 2026-08-08, pinned so the ratchet
# can start closed. {(file, phrase): count}. An entry comes OFF this
# list in the pull request that next touches its file - never by
# raising a count.
ALLOWLIST = {
    ("apps/web/admin.html", "used to"): 1,
    ("apps/web/dashboard.js", "originally"): 1,
    ("apps/web/dashboard.js", "used to"): 1,
    ("apps/web/theme.css", "carried over from"): 1,
    ("apps/web/theme.css", "used to"): 1,
    ("dev/dashboard.test.mjs", "used to"): 2,
    ("dev/ui.test.mjs", "used to"): 1,
    ("tools/check_web.py", "this replaces"): 1,
    ("tools/check_web.py", "used to"): 2,
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


def problems():
    found, scanned = scan_tree()
    out = [
        "SCAN names %s, which does not exist. The check would pass "
        "while reading nothing" % name
        for name in missing_directories()
    ]
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
    # offenses" is true of a scan that read no files. The counts are
    # what make the line worth printing.
    print("check_comments: comments explain why (%d files scanned, %d "
          "pinned occurrence(s) left to clean up)."
          % (len(scanned), sum(ALLOWLIST.values())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
