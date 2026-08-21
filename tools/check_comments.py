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

THREE MORE HOLES, EACH A COVERAGE GAP RATHER THAN A BROKEN RULE
-----------------------------------------------------------------
0.9-M3-S4 (#392), filed at the M2-to-M3 fleet gate over three real
escapes the rules above could not have caught, each for a different
reason than "the phrase list is too short". Fix wave 1 (the
independent review, #392 comment 5369115005) found the first build's
first and third mechanisms caught the WORDING of a fix rather than the
DEFECT, and rewrote both; the account below is the wave-1 shape.

 - S11 F3 (#372): apps/web/charts.html said "charts.js disables rather
   than shows an empty pane" - a claim about a NAMED FILE with nothing
   quoted. The citation rule above requires a quotation to check a
   citation against; a bare mention has nothing to check, so it never
   entered either rule. See NARRATIVE_PINS below.
 - S15 F5 (#383): apps/web/theme.css said "six .field-shaped controls"
   long after the row it described dropped, and the file had never
   produced a single ALLOWLIST or CITATION_PINS entry - not because its
   comments were clean, but because nothing here had ever been shown to
   fire on THIS file. The build's first attempt added a phrase for the
   fix wave's OWN truing comment ("FIVE, NOT SIX (0.9-M2-S15, #383):
   ..."), which is real narration but is not the escape: the review
   proved the literal S15 sentence, restored verbatim, still passes,
   and so does adding or deleting a control after it. See
   COUNT_PROPERTY_PINS below for the rebuild.
 - The third shape, found while building the first two: a citation can
   be shaped exactly like the quoted CITATIONS above and cite a GitHub
   ticket instead of a file - `#378: "no numbers over bars, ever"` in
   apps/web/charts.js is one instance. CITED requires a file extension,
   so `#\\d+` never matched it and the quotation was never checked
   against anything, in either direction, because a ticket number is
   not a file this checker can open. The first build's TICKET_CITATIONS
   only matched the ticket sitting immediately before the connective;
   `apps/web/site.config.js`'s own escape - S16's, #390's find while
   #390 was still open - cites `#371 comment 5347769320: "..."` and
   `(owner ruling, #390): "..."`, both with words between the ticket
   and the colon, and neither ever reached rule 2 at all. See
   TICKET_PINS below for the widened connective.

NARRATIVE_PINS answers the first shape the same way ALLOWLIST answers a
phrase: it cannot verify a bare mention (there is nothing quoted to
check), so it ratchets the shape itself - a dash-introduced, unquoted
mention of another file is new work the moment it is not already
pinned. The dash is deliberate, not a stand-in for "any connective":
AGENTS.md's own "The review bar" and the CITATIONS design above both
hold that a connective is what makes a rule usable rather than merely
correct, and a bare CITED token appears constantly in ordinary prose
("apps/web/form.js writes one control per field") with no claim behind
it at all - narrowing to the one connective the real escape used keeps
the pin list to fifteen honest entries instead of the low thousands a
bare-mention scan produces. This is a RATCHET ON ONE SURFACE FORM OF
SEVEN (the fix wave's own measurement): a dash-mention is caught, but
"see FILE, which..." or "because FILE does..." or an em dash are not,
and neither is this exact edit's own new mention in theme.css ("see
apps/web/charts.html's own comment"), which uses "see" between the dash
and the file. Widening the connective was measured and rejected at
first build (it is what keeps the pin list honest rather than a
few-thousand-line sweep); the surface this rule covers is real but
narrow, and is stated as narrow rather than implied complete.

Fix wave 1 also narrowed WHAT counts as "quotes nothing": the guard
used to be region-wide (any `"` anywhere in the comment cleared every
mention in it, even one naming a completely different file than the
quote resolves). It is now per-mention - a dash-mentioned file is
cleared only when THAT SAME file also has a real CITATIONS match
somewhere in the region, checked by basename so "charts.js" and
"apps/web/charts.js" are the same clearance. A quote resolving DESIGN.md
two sentences over no longer silences an unrelated, unquoted mention of
charts.js.

TICKET_PINS answers the third shape with the CITATIONS machinery
itself, rather than new machinery: `#\\d+` stands in for CITED inside
the same two connective-plus-quotation patterns. Fix wave 1 widened the
pre-quote connective from "immediately after the ticket" to "up to
fifty characters of prose, ending in a colon, with no quote in between"
- wide enough to reach `#371 comment 5347769320: "..."` and `(owner
ruling, #390): "..."`, the two real house forms rule 2 missed at first
build, while still requiring the colon-then-quote shape that keeps this
a hard extraction rather than a guess. What TICKET_PINS answers, stated
plainly because the first build's docstring did not say it clearly
enough: THIS RULE TRACKS THAT A TICKET IS CITED BESIDE A QUOTATION. IT
NEVER COMPARES THE COMMENT TO THE TICKET'S CONTENT - there is no local
copy of a GitHub issue to check the quotation against, so a ticket
citation is broken by construction and TICKET_PINS records which ones
were already known-unverifiable, exactly as CITATION_PINS records a
file citation's known-stale ones. A pinned ticket citation later
rewritten to say something false stays green; nothing here or anywhere
else in this file can see that happen.

COUNT_PROPERTY_PINS rebuilds the third rule around the actual property
0.9-M2-S15 F5 needed: a comment that both names another file (any
CITED-shaped mention anywhere in the SAME comment region, not only the
dash form NARRATIVE_PINS restricts to) and states a count of that
file's elements (a cardinal immediately near a literal `.class`-shaped
token written in prose - the exact shape "six .field-shaped controls"
takes, narrow for the same reason CARDINAL numbers near an ordinary
countable noun are unfixably common ("two retries", "three steps") and
a literal CSS class token in prose is not) REDS unless the SAME comment
region also carries a real CITATIONS match that RESOLVES - reusing
citations()/unresolved_citations() rather than a new resolver, which is
what "the house mechanism check_comments already trusts" means in the
ruling this answers. This still checks a SHAPE, not the count itself:
a resolving citation proves the file exists and the quotation is really
in it, never that the cardinal is arithmetically correct. A comment
that names a file, claims a count, and quotes something true but
irrelevant from that file still passes - the property is "an anchor
exists to check by hand," not "the count was checked."

ALL FOUR RULES (NARRATIVE_PINS, TICKET_PINS, COUNT_PROPERTY_PINS, and
CITATIONS itself) are ratchets on the SHAPE of a sentence. A claim's
TRUTH is checked only where a quoted anchor exists and only up to
whatever the anchor quotes - CITATIONS' own resolution is a text-
presence check against the cited file's real bytes, never a semantic
one. Where no anchor exists, these rules make the shape mandatory (name
a file and a count, or provide the anchor) without themselves auditing
whether the anchored claim is true; a human still reads the fourteen
NARRATIVE_PINS mentions and the five TICKET_PINS citations to know
that. This is a narrower claim than the first build's closing sentence
made, and the narrowing is the fix.
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
#
# BLANK joins " \t" in the leading class as of 0.9-M3-S4 fix wave 1
# (F4, #392): comment_regions() now joins an indented "//" continuation
# line into its region (see that function's own docstring), which means
# unwrap() sees the line's INDENTATION as literal 0x00 bytes rather than
# as absent - comments_only() blanks code-level whitespace, and
# indentation before a comment marker is code, not comment. Without
# BLANK here, CONTINUATION.match() stops at position 0 (0x00 is not a
# space or tab), so nothing is stripped and the marker itself - "//" -
# was read as PROSE, appearing inside citation quotations pulled from
# an indented file. This is the fix for that, not a new rule.
CONTINUATION = re.compile(r"^[ \t%s]*(?:\*+|\#+|//+|<!--|--+)?[ \t%s]*"
                           % (BLANK, BLANK))

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


# A cardinal number, spelled out or digits - reused below by
# COUNT_CLAIM. RETIRED FROM PHRASES AT 0.9-M3-S4 FIX WAVE 1 (#392):
# a first attempt paired this with "not" to catch "five, not six" as a
# rename-shaped narration marker, on the theory that a corrected count
# is the same disease "renamed from" and "moved from" already catch.
# The independent review (comment 5369115005, finding F1) proved that
# pattern catches the FIX WAVE'S OWN truing sentence, never the ESCAPE:
# theme.css's original "six .field-shaped controls" - the sentence that
# actually shipped wrong for a milestone - has no "not" in it at all,
# and restoring it byte for byte still passed the gate. See
# COUNT_PROPERTY_PINS below for the rule built on the property this one
# was never able to reach.
NUMBER = (r"(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|"
          r"twelve|\d+)")


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

# dev/check_web.test.py's "11, not 12: theme-init.js left MODULE_EXPORTS
# at 0.9-M2-S14 (#380 ruling 2) ... when the custom theme it published
# ... retired with it" is real narration, the same shape as theme.css's
# fix-wave truing comment - RETIRED FROM ALLOWLIST at fix wave 1 (#392)
# along with the "N, not M" phrase that pinned it (see NUMBER above):
# the pattern that caught it was proven, by the independent review, to
# catch a fix's own wording rather than the escape it was named for.
# Nothing scans for this shape any more; it is not this slice's file to
# reword, and pinning a phrase this narrow just to keep one honest entry
# would be the tail wagging the dog.

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
    ("server/schema.sql", "DESIGN.md", "The charts and the snapshot"): 1,
    ("server/worker.js", "DESIGN.md",
     "The prefill is scoped to the account"): 1,
    ("dev/crypto.test.mjs", "DESIGN.md", "Key custody"): 1,
}

# A dash immediately before a path this repository could hold - the
# connective the real escape used (0.9-M2-S11, #372: apps/web/
# charts.html's "...trend: null - charts.js disables rather than shows
# an empty pane"). Restricted to this one connective on purpose; see
# NARRATIVE_PINS below and "NARRATIVE_PINS answers the first shape" in
# the module docstring for the measurement that ruled out a wider one.
NARRATIVE = re.compile(r"-\s+(%s)\b" % CITED)

# {(file, cited path): count}. A comment that names another file via
# NARRATIVE, in a comment region that quotes nothing at all, cannot be
# checked the way a real citation is - there is nothing quoted to read
# the target for, so the best this file can do is the ratchet PHRASES
# already runs for a linguistic marker: pin what is already here, fail
# what is new. An entry comes OFF in the pull request that next touches
# its file, same as ALLOWLIST and CITATION_PINS; raising a count is an
# edit to this file with a reason in the pull request.
#
# RE-MEASURED at fix wave 1 (F3, #392, comment 5369115005): the first
# build's guard cleared a whole comment region on ANY quote anywhere in
# it, so most of what is pinned below was invisible until the guard
# became per-mention. Thirty-nine (file, path) pairs, forty-five
# occurrences - up from fourteen. apps/web/theme.css's self-mention
# ("theme.css says so above") is still excluded rather than pinned, for
# the same reason as before: a file's claim about its own text is
# checkable by anyone reading the file.
NARRATIVE_PINS = {
    ('apps/web/admin.html', 'server/worker.js'): 1,
    ('apps/web/auth.js', 'submit.js'): 1,
    ('apps/web/charts.html', 'charts.js'): 1,
    ('apps/web/config.js', 'auth.js'): 1,
    ('apps/web/crypto.js', 'DESIGN.md'): 1,
    ('apps/web/crypto.js', 'dev/crypto.test.mjs'): 1,
    ('apps/web/form.js', 'admin.js'): 1,
    ('apps/web/form.js', 'apps/web/site.config.js'): 1,
    ('apps/web/site.config.js', 'your-page.html'): 1,
    ('apps/web/theme.css', 'apps/web/charts.js'): 1,
    ('dev/admin-session.test.mjs', 'dashboard.js'): 1,
    ('dev/admin.test.mjs', 'dashboard.js'): 1,
    ('dev/check_web.test.py', 'AGENTS.md'): 1,
    ('dev/check_web.test.py', 'public.js'): 1,
    ('dev/demo-bake.test.mjs', 'dev/demo-bake.mjs'): 1,
    ('dev/demo-server.mjs', 'demo-stub.js'): 1,
    ('dev/demo-stub.js', 'AGENTS.md'): 1,
    ('dev/session.test.mjs', 'session.js'): 1,
    ('dev/signout.test.mjs', 'apps/web/memberkey.js'): 1,
    ('dev/signout.test.mjs', 'check_web.py'): 1,
    ('dev/worker.test.mjs', './store-crypto.js'): 1,
    ('server/charts-agg.js', 'apps/web/countries.js'): 1,
    ('server/worker.js', 'precedence.test.mjs'): 1,
    ('server/worker.js', 'server/store-crypto.js'): 1,
    ('server/worker.js', 'wrangler.toml'): 1,
    ('tools/agent_init.py', 'tools/requirements-gate.txt'): 1,
    ('tools/check.py', 'dev/form.test.mjs'): 1,
    ('tools/check.py', 'tools/build_web.mjs'): 1,
    ('tools/check_docs.py', 'tools/check_comments.py'): 1,
    ('tools/check_fonts.py', 'tools/build_web.mjs'): 1,
    ('tools/check_live.py', 'server/wrangler.toml'): 2,
    ('tools/check_web.py', 'AGENTS.md'): 2,
    ('tools/check_web.py', 'admin.html'): 2,
    ('tools/check_web.py', 'crypto.js'): 1,
    ('tools/check_web.py', 'index.html'): 1,
    ('tools/check_web.py', 'theme.js'): 1,
    ('tools/fleet_status.py', 'reaper.py'): 3,
    ('tools/session_open_suite.py', 'reaper.py'): 1,
    ('tools/ship_check.py', 'AGENTS.md'): 2,
}

# A GitHub ticket number, `#\d+` - never a file, and every one of these
# resolves against a repository object this checker can open (issues
# live on GitHub, not on disk), so a citation anchored to one is broken
# by construction, in the same sense unresolved_citations() already
# reports "not a file here" for a stale path.
TICKET = r"#\d+"

# The connective is WIDER than CITATIONS' own on purpose, and that
# widening is fix wave 1's F4 (#392, comment 5369115005): the first
# build reused CITATIONS' tight connective ('s, or a bare , or :
# directly after the token) verbatim, and it missed the house forms
# apps/web/site.config.js and server/charts-agg.js actually use - a
# comment number or "owner ruling" sitting between the ticket and the
# colon, exactly the shape S16's real escape lived in:
#   #371 comment 5347769320: "in a gaining community the high end IS
#   the story"                                    (site.config.js)
#   2026-08-19 (#371 comment 5347769320): "the group sees its own
#   makeup; the members-only door is what protects it"
#                                                (server/charts-agg.js)
# Up to fifty characters of ordinary prose are allowed between the
# ticket and a terminal comma or colon, never a quote - so a comment
# that cites a ticket, closes that thought, and only later opens an
# unrelated quotation is not swept in either. Two characters are also
# refused in that gap, both found by a wrong pairing in the real tree
# rather than reasoned in advance: "#" (a SECOND ticket sitting closer
# to the quote than the one the naive gap would have captured - dev/
# check_web.test.py cites "0.9-M2-S6 (#82) and 0.9-M2-S13 (#378):
# 'custom'", and without excluding #, the far ticket #82 wins instead
# of #378, the one actually beside the colon) and "." (a real FILE
# citation sitting in the same gap - dev/worker.test.mjs's "(#331),
# which is DESIGN.md, 'Sessions'" already resolves as a file citation
# via CITATIONS above, and without excluding the dot in "DESIGN.md"
# from the gap, the wider ticket pattern claims the same quotation for
# #331 too). The reversed form (a quotation read backward into a
# ticket via "in"/"of"/"under") is unchanged from first build; no real
# instance in the tree needed it widened.
TICKET_CITATIONS = (
    (re.compile(r"(%s)(?:'s|[^\"\n#.]{0,50}[,:])\s+\"([^\"\n]{6,200})\""
                 % TICKET), 1, 2),
    (re.compile(r"\"([^\"\n]{6,200})\"\s+(?:in|of|under)\s+(%s)\b" % TICKET),
     2, 1),
)

# {(file, ticket, quotation): count}. Every ticket-anchored citation is
# broken - there is no "does the ticket still say this" question this
# checker can ask, and ticket_problems() never claims otherwise: this
# rule tracks that a ticket is cited beside a quotation, never that the
# quotation still matches the ticket's content - so a pinned citation
# rewritten to say something false stays green. TICKET_PINS just records
# which citations were already known to be checked no further than
# that.
#
# RE-MEASURED at fix wave 1 (F4, #392, comment 5369115005), same
# reason NARRATIVE_PINS was: the widened connective and the comment_
# regions() indentation fix together reach citations first build's five
# could not - twenty-four now, including apps/web/site.config.js's own
# escape (S16's real one) and server/charts-agg.js's twin.
TICKET_PINS = {
    ('apps/web/charts.js', '#243',
     'Edges come from the field spec and never move or merge'): 1,
    ('apps/web/charts.js', '#372',
     'legibility is a geometry property, not a count target'): 1,
    ('apps/web/charts.js', '#372',
     'measured, or estimated conservatively from the caption text'): 1,
    ('apps/web/charts.js', '#378',
     'a count scale in whole people (integer ticks only)'): 1,
    ('apps/web/charts.js', '#378', 'a tooltip verifies any value'): 1,
    ('apps/web/charts.js', '#378', 'including an empty slot'): 1,
    ('apps/web/charts.js', '#378', 'no numbers over bars, ever'): 1,
    ('apps/web/charts.js', '#378',
     'the month and the values that point carries - group mean; the You '
     'point its own value'): 1,
    ('apps/web/charts.js', '#378',
     'the values that point carries - group mean; the You point its own '
     'value'): 1,
    ('apps/web/charts.js', '#390',
     "the last painted band is the band CONTAINING the data's maximum; "
     "its upper spec edge is the axis end."): 1,
    ('apps/web/charts.js', '#390',
     'the workbook carries exactly the answer on screen'): 1,
    ('apps/web/charts.js', '#396', 'Showing Weight (lb).'): 1,
    ('apps/web/site.config.js', '#371',
     'in a gaining community the high end IS the story'): 1,
    ('apps/web/theme.css', '#378',
     "clamp inside the chart figure's bounding box"): 1,
    ('dev/admin-session.test.mjs', '#354',
     'a refused unpublish ends the session and leaves'): 1,
    ('dev/admin-session.test.mjs', '#354',
     'publishing repeats what the document does not contain'): 1,
    ('dev/admin.test.mjs', '#275',
     'the private half of the key this site encrypts to'): 1,
    ('dev/check_web.test.py', '#378', 'custom'): 1,
    ('dev/demo.test.mjs', '#354', '-- The snapshot --'): 1,
    ('dev/demo.test.mjs', '#354',
     'Publishing, and the takedown that is not the same as never'): 1,
    ('dev/demo.test.mjs', '#354',
     'every snapshot row has a control, with the counts on it'): 1,
    ('server/charts-agg.js', '#243',
     'Edges come from the field spec and never move or merge.'): 1,
    ('server/charts-agg.js', '#371',
     'the group sees its own makeup; the members-only door is what '
     'protects it'): 1,
    ('tools/check_web.py', '#191', 'Daylight'): 1,
}

# A cardinal near a literal CSS-class-shaped token written in prose -
# "six .field-shaped controls", "four .field-shaped controls" - is a
# claim about how many elements somewhere carry that class. Measured
# three times against the real tree before landing on this shape:
#
#  - a cardinal within 40 characters of ANY `.identifier` token: 130
#    findings once combined with a file mention, almost all noise - a
#    bare "one" (a function word constantly used as a pronoun/article,
#    "the one file", "at once") near any dotted token, including a
#    plain file path with no space around its dot ("tools/reaper.py").
#  - requiring a HYPHEN in the token after the dot (excludes a file
#    extension, which is never hyphenated here - .py, .js, .css - while
#    keeping a CSS class written in kebab-case, which always is): 3.
#    Two were still noise - dev/check_web.test.py's "#187: .rail-links"
#    (a TICKET number, not a count - `\d+` reads "187" out of "#187")
#    and tools/check_web.py's "(index % 6) - so that no .series-N" (a
#    modulo literal, fifteen characters from its dot).
#  - excluding a number directly preceded by "#" and tightening the gap
#    to eight characters (kills the modulo case; keeps "five
#    .field-shaped", one character away): 1 - theme.css's own claim,
#    and nothing else in the tree takes this shape.
#
# "one" is not excluded from NUMBER itself (COUNT_PROPERTY_PINS would
# still need a real "one .field-shaped" claim to exist for that to
# matter, and none does); the hyphen requirement is what did the work.
COUNT_CLAIM = re.compile(
    r"(?<!#)\b%s\b[^.\n]{0,8}\.[a-zA-Z][a-zA-Z0-9]*-[a-zA-Z0-9-]*"
    % NUMBER)

# A bare CITED-shaped token, for finding "does this comment name a file
# at all" without CITATIONS' connective-and-quote requirement - rule 3
# below needs the WIDE question (any mention, anywhere in the region),
# unlike NARRATIVE's narrow one, because the property it enforces is
# "a count claim plus a file mention, with nothing to check the count
# against", not "was this specific connective used".
CITED_TOKEN = re.compile(CITED)

# {(file, line): reason}. Fix wave 1's rebuild of rule 3 (F1, #392,
# comment 5369115005): a comment region that both names another file
# (CITED_TOKEN, anywhere - not only NARRATIVE's dash form) and claims a
# count of that file's elements (COUNT_CLAIM) must also carry a real
# CITATIONS match that RESOLVES somewhere in the same region, or it is
# new work pointing at an unverifiable count. Measured against the real
# tree before this slice's own theme.css fix: one instance - theme.css's
# own control-row comment, which is why theme.css never had an entry
# here either, the same reason it never had one in ALLOWLIST or
# CITATION_PINS: nothing had been shown to fire on it. That one instance
# is fixed in this wave (a real, resolving quote from
# apps/web/charts.html now backs the count), not pinned - the pin list
# starts, and stays, empty. An entry would record a count claim about
# another file's elements that the wave chose not to anchor; there is
# none.
COUNT_PROPERTY_PINS = {}


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


def comment_regions(masked, text=None):
    """[(start, stop)] for each comment region of a masked file.

    Newlines survive comments_only() everywhere, so a region ends at the
    first blanked code character rather than at a line break - which is
    what makes a run of "//" lines one comment instead of several.

    THE INDENTATION FIX (0.9-M3-S4 fix wave 1, F4, #392, comment
    5369115005): found while widening rule 2's connective to reach
    apps/web/site.config.js's real citation, which still did not
    resolve after the widening. The cause was here, not in the ticket
    pattern - `citations()` itself already returned nothing for that
    file, on a citation this rule never touches. Every "//" comment
    inside a nested object literal is indented, and the leading spaces
    before EACH LINE's own "//" are code-level whitespace, outside any
    comment span, so comments_only() blanks them - which used to close
    the region right there, splitting one wrapped citation into two
    one-line fragments neither of which carries both the ticket and the
    quotation. A `/* */` block never had this problem (the whole span
    between the markers copies verbatim, indentation included), which
    is why it went unnoticed until a "//"-commented, indented, multi-
    line citation was measured for the first time.

    `text` is the SAME file's unmasked text, optional so a caller with
    no unmasked text handy (none currently exist, but the parameter
    defaults closed rather than required) keeps the old behavior. When
    given, a blank run that is PURE WHITESPACE in the original - not a
    blanked comment marker, not real code - does not end a region;
    real code between two comments still does, since it is never only
    whitespace. This is who close_blank_run() answers when it is asked.
    """
    def close_blank_run(run_start, run_stop):
        """Whether a blank run at these offsets ends a region.

        True (region ends) unless `text` was given and every character
        in the run is whitespace in the ORIGINAL, unmasked source - the
        one case this rule exists to reach: indentation before the next
        continuation line's own comment marker.
        """
        if text is None:
            return True
        return text[run_start:run_stop].strip() != ""

    regions = []
    start = None
    index = 0
    length = len(masked)
    while index < length:
        if masked[index] == BLANK:
            if start is None:
                index += 1
                continue
            run_start = index
            while index < length and masked[index] == BLANK:
                index += 1
            if close_blank_run(run_start, index):
                regions.append((start, run_start))
                start = None
        else:
            if start is None:
                start = index
            index += 1
    if start is not None:
        regions.append((start, length))
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
    for start, stop in comment_regions(masked, text):
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


def narrative_mentions(text, kind):
    """[(line, cited path)] for a bare, dash-introduced file mention.

    PER-MENTION, not region-wide - fix wave 1's F3 (#392, comment
    5369115005). First build cleared a whole comment region the moment
    ANY quote appeared in it, which the review broke by rewriting a real
    pinned mention's CLAIM to its opposite while a citation for a
    DIFFERENT file sat two sentences over in the same comment: the
    unrelated quote silenced the falsified one. A mention is cleared now
    only when the SAME file it names also carries a real CITATIONS match
    in the SAME region - compared by basename, since a comment may spell
    the mention short ("charts.js") and the citation long
    ("apps/web/charts.js") for the same real file. A citation for some
    OTHER file no longer clears anything.

    unwrap() is reused rather than re-derived so a mention split across
    a block comment's continuation lines is still one mention, the same
    reason citations() needs it.
    """
    masked = comments_only(text, kind)
    found = []
    for start, stop in comment_regions(masked, text):
        flat, offsets = unwrap(masked, start, stop)
        cited_here = set()
        for pattern, path_group, _quote_group in CITATIONS:
            for cite in pattern.finditer(flat):
                cited_here.add(os.path.basename(cite.group(path_group)))
        for match in NARRATIVE.finditer(flat):
            path = match.group(1)
            if os.path.basename(path) in cited_here:
                continue
            at = offsets[match.start(1)]
            found.append((masked.count("\n", 0, at) + 1, path))
    return sorted(found)


def all_narratives(scan=None, repo=None):
    """[(file, line, cited path)] over the scan set, self-mentions dropped.

    A file naming itself ("theme.css says so above") is not the escape
    NARRATIVE_PINS exists for - a claim a file makes about its own text
    is checkable by anyone reading the same file, which is exactly the
    property missing from a claim about a DIFFERENT one. Dropped by
    comparing both the bare name and the scan-relative path, since a
    comment may spell either.
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
            for line, path in narrative_mentions(text, kind):
                if path in (relpath, name):
                    continue
                out.append((relpath, line, path))
    return out


def narrative_problems(scan=None, repo=None, pinned=None):
    """A problem per narrative file mention beyond the count pinned for it.

    The forward arm, the same shape ratchet_problems() runs for a
    phrase: membership alone would forgive every future mention of an
    already-pinned pair, so this compares COUNTS, exactly as
    citation_problems() does above and for the same reason (F1, #279) -
    a second mention of the same file in the same comment's neighborhood
    is new work, not the occurrence that was already there.
    """
    pinned = NARRATIVE_PINS if pinned is None else pinned
    broken = {}
    for relpath, line, path in all_narratives(scan, repo):
        broken.setdefault((relpath, path), []).append(line)
    problems = []
    for key in sorted(broken):
        relpath, path = key
        places = broken[key]
        allowed = pinned.get(key, 0)
        if len(places) <= allowed:
            continue
        if allowed:
            problems.append(
                "%s: %d comments dash-mention %s unquoted and %d are "
                "pinned (lines %s). One is new: quote the claim so it can "
                "be checked against %s, or pin it"
                % (relpath, len(places), path, allowed,
                   ", ".join(str(line) for line in places), path))
        else:
            problems.extend(
                "%s:%d: names %s after a dash with nothing quoted in the "
                "comment, so nothing here can check what it claims. Quote "
                "the specific claim so it resolves against %s, or pin the "
                "mention in NARRATIVE_PINS"
                % (relpath, line, path, path)
                for line in places)
    return problems


def narrative_pin_problems(scan=None, repo=None, pinned=None):
    """A problem per NARRATIVE_PINS entry that no longer describes the tree.

    The backward arm: a pin whose mention was quoted, reworded or
    deleted stops being true, and the list is written to shrink, not to
    accumulate excuses.
    """
    pinned = NARRATIVE_PINS if pinned is None else pinned
    broken = {}
    for relpath, line, path in all_narratives(scan, repo):
        broken.setdefault((relpath, path), []).append(line)
    problems = []
    for key in sorted(pinned):
        relpath, path = key
        count = pinned[key]
        actual = len(broken.get(key, []))
        if actual == 0:
            problems.append(
                "NARRATIVE_PINS pins %s in %s, and it is not there any "
                "more - quoted, reworded, or deleted. Delete the entry; "
                "the list is a ratchet and only shrinks"
                % (path, relpath))
        elif actual < count:
            problems.append(
                "NARRATIVE_PINS pins %d occurrence(s) of %s in %s and %d "
                "remain. Lower the count to %d"
                % (count, path, relpath, actual, actual))
    return problems


def ticket_citations(text, kind):
    """[(line, ticket, quotation)] for one file's source, sorted.

    Same extraction as citations() above, TICKET_CITATIONS in place of
    CITATIONS - see TICKET_CITATIONS for why the pattern itself needs no
    change beyond that swap.
    """
    masked = comments_only(text, kind)
    found = []
    for start, stop in comment_regions(masked, text):
        flat, offsets = unwrap(masked, start, stop)
        for pattern, path_group, quote_group in TICKET_CITATIONS:
            for match in pattern.finditer(flat):
                at = offsets[match.start(quote_group)]
                found.append((masked.count("\n", 0, at) + 1,
                              match.group(path_group),
                              match.group(quote_group)))
    return sorted(found)


def all_ticket_citations(scan=None, repo=None):
    """[(file, line, ticket, quotation)] over the scan set."""
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
            for line, ticket, quote in ticket_citations(text, kind):
                out.append((relpath, line, ticket, quote))
    return out


def ticket_problems(scan=None, repo=None, pinned=None):
    """A problem per ticket citation beyond the count pinned for it.

    Every ticket citation is broken by construction (see TICKET above),
    so there is no resolution step to run before this - the whole
    question is whether it was already pinned, the same forward-arm
    shape narrative_problems() runs.
    """
    pinned = TICKET_PINS if pinned is None else pinned
    broken = {}
    for relpath, line, ticket, quote in all_ticket_citations(scan, repo):
        broken.setdefault((relpath, ticket, quote), []).append(line)
    problems = []
    for key in sorted(broken):
        relpath, ticket, quote = key
        places = broken[key]
        allowed = pinned.get(key, 0)
        if len(places) <= allowed:
            continue
        if allowed:
            problems.append(
                "%s: %d comments cite %s, %r and %d are pinned (lines %s). "
                "One is new, and a ticket is never a file this checker can "
                "read: quote the file that carries the ruling instead, or "
                "pin the citation"
                % (relpath, len(places), ticket, quote, allowed,
                   ", ".join(str(line) for line in places)))
        else:
            problems.extend(
                "%s:%d: cites %s, %r - a ticket rather than a file, so "
                "nothing here can check the quotation against it. Quote "
                "the file that carries this ruling instead, or pin the "
                "citation in TICKET_PINS if the ticket is genuinely the "
                "only record"
                % (relpath, line, ticket, quote)
                for line in places)
    return problems


def ticket_pin_problems(scan=None, repo=None, pinned=None):
    """A problem per TICKET_PINS entry that no longer describes the tree."""
    pinned = TICKET_PINS if pinned is None else pinned
    broken = {}
    for relpath, line, ticket, quote in all_ticket_citations(scan, repo):
        broken.setdefault((relpath, ticket, quote), []).append(line)
    problems = []
    for key in sorted(pinned):
        relpath, ticket, quote = key
        count = pinned[key]
        actual = len(broken.get(key, []))
        if actual == 0:
            problems.append(
                "TICKET_PINS pins %r out of %s in %s, and no comment "
                "cites it any more. Delete the entry; the list is a "
                "ratchet and only shrinks"
                % (quote, ticket, relpath))
        elif actual < count:
            problems.append(
                "TICKET_PINS pins %d occurrence(s) of %r out of %s in %s "
                "and %d remain. Lower the count to %d"
                % (count, quote, ticket, relpath, actual, actual))
    return problems


def count_claims(text, kind):
    """[(line, matched text)] for a cardinal near a literal .class token.

    The extractor half of rule 3's rebuild (fix wave 1, F1, #392,
    comment 5369115005) - a pure function over strings, the same reason
    hits() and citations() are, so a mutation exercises the PATTERN and
    never the file-walking around it.
    """
    masked = comments_only(text, kind)
    found = []
    for match in COUNT_CLAIM.finditer(masked):
        line = masked.count("\n", 0, match.start()) + 1
        found.append((line, match.group(0).strip()))
    return sorted(found)


def count_property_findings(scan=None, repo=None):
    """[(file, line, (file mentions,))] for an unanchored count claim.

    A comment region qualifies when it both claims a count (COUNT_CLAIM)
    and names another file (CITED_TOKEN, self-mentions excluded) with no
    real, RESOLVING CITATIONS match anywhere in the SAME region -
    "resolving" checked by excluding whatever unresolved_citations()
    already flags as broken, so a stale citation cannot double as an
    anchor for a count claim it does not back either. citations() and
    unresolved_citations() are reused rather than a second resolver
    written for this rule alone - the house mechanism the ruling this
    answers named.
    """
    scan = SCAN if scan is None else scan
    repo = REPO if repo is None else repo
    broken_by_file = {}
    for relpath, line, _path, _quote, _message in unresolved_citations(
            scan, repo):
        broken_by_file.setdefault(relpath, set()).add(line)
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
            masked = comments_only(text, kind)
            resolving_lines = ({line for line, _p, _q in citations(
                text, kind)} - broken_by_file.get(relpath, set()))
            for start, stop in comment_regions(masked, text):
                flat, _offsets = unwrap(masked, start, stop)
                if not COUNT_CLAIM.search(flat):
                    continue
                mentions = sorted({
                    match.group(0) for match in CITED_TOKEN.finditer(flat)
                    if match.group(0) not in (relpath, name)})
                if not mentions:
                    continue
                start_line = masked.count("\n", 0, start) + 1
                stop_line = masked.count("\n", 0, stop) + 1
                anchored = any(start_line <= line <= stop_line
                               for line in resolving_lines)
                if anchored:
                    continue
                out.append((relpath, start_line, tuple(mentions)))
    return out


def count_property_problems(scan=None, repo=None, pinned=None):
    """A problem per unanchored count-of-another-file's-elements claim.

    The forward arm. Unlike NARRATIVE_PINS and TICKET_PINS this is keyed
    by (file, line) rather than counted - a count claim is written once
    per sentence, not repeated the way a citation to the same file might
    be, so there is nothing here for a count to distinguish.
    """
    pinned = COUNT_PROPERTY_PINS if pinned is None else pinned
    problems = []
    for relpath, line, mentions in count_property_findings(scan, repo):
        if (relpath, line) in pinned:
            continue
        problems.append(
            "%s:%d: names %s and claims a count of its elements with "
            "nothing quoted anywhere in the comment to check it against - "
            "the exact shape of 0.9-M2-S15 F5's escape (#383). Add a "
            "quoted citation from %s (the CITATIONS form above) backing "
            "the claim, or pin it in COUNT_PROPERTY_PINS"
            % (relpath, line, ", ".join(mentions), mentions[0]))
    return problems


def count_property_pin_problems(scan=None, repo=None, pinned=None):
    """A problem per COUNT_PROPERTY_PINS entry that no longer applies.

    The backward arm - a pin whose count claim was anchored, reworded or
    deleted stops being true, same shape as every other pin's backward
    arm in this file.
    """
    pinned = COUNT_PROPERTY_PINS if pinned is None else pinned
    found = {(relpath, line) for relpath, line, _mentions in
             count_property_findings(scan, repo)}
    problems = []
    for key in sorted(pinned):
        if key not in found:
            problems.append(
                "COUNT_PROPERTY_PINS pins %s:%d, and it is anchored or "
                "gone now. Delete the entry; the list is a ratchet and "
                "only shrinks" % key)
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
    out.extend(narrative_problems())
    out.extend(narrative_pin_problems())
    out.extend(ticket_problems())
    out.extend(ticket_pin_problems())
    out.extend(count_property_problems())
    out.extend(count_property_pin_problems())
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
          "%d phrase occurrence(s), %d citation(s) pinned for the slice "
          "that rewrites their file, %d unquoted file mention(s) pinned, "
          "%d ticket citation(s) pinned and %d unanchored count claim(s) "
          "pinned)."
          % (len(scanned), len(all_citations()), sum(ALLOWLIST.values()),
             sum(CITATION_PINS.values()), sum(NARRATIVE_PINS.values()),
             sum(TICKET_PINS.values()), len(COUNT_PROPERTY_PINS)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
