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

A SIXTH RULE, AND THE TREE ITSELF IS THE ANCHOR NOW
-----------------------------------------------------
0.9-M3-S17 (#422), filed after one batch (m3-b2) shipped sixteen
comments naming things two of its own slices had just deleted -
S8's review (#414 F2) found six still naming the deleted
`adminAccountIds()` and the renamed `CHART_SETTINGS`; S10's review
(#416 F3-F4) found ten citing exports, a keyfile tool and two suites
that slice removed. Both gates were green: every rule above checks a
comment against a PHRASE, another FILE'S text, or a TICKET - none of
them asks the tree "does this name still exist." dangling_problems()
below is the one that does.

WHAT COUNTS AS A NAME. Four shapes, each read out of a comment or an
operative document's prose (README.md, AGENTS.md, DESIGN.md,
OPERATIONS.md - "the docs it covers" in the ticket's words, because
CITATION_PINS above already treats exactly these four as first-class
targets it opens and reads; archive/ is frozen history and security/
is a dated-snapshot folder, both deliberately excluded for the same
reason archive/ is never scanned above, and neither carries prose
about a DIFFERENT repository the way a fork's own local notes might -
this checker has no way to tell "this name belongs to a fork" from
"this name is dangling", so the docs it reads are the ones this
project's own registries already vouch for):

 - a bare call, `name()` or `name(args)` - FUNC_CALL_BARE - checked
   against every `function name(`, `const/let/var name =`, `.name =
   function`, and `name: (` definition scan_tree()'s own four
   directories hold (defined_names() below), plus Python's `def
   name(`. "A definition, not another mention" (the ticket's words) is
   why a mention of the same name elsewhere never counts - only these
   five assignment shapes do, measured against this tree until each of
   `adminAccountIds()`, `box(i)` (a local callback assigned `const box
   = boxOf || function (i) {...}`, resolved only once JS_ASSIGN_DEF
   stopped requiring the arrow to sit immediately after `=`) and
   `openRow()` (server/store-crypto.js's `openRow: (record, context)
   =>`, an object-literal method JS_METHOD_DEF exists for) all
   resolved.
 - an `UPPER_SNAKE` token with at least one underscore - CONST_BARE -
   checked the same way, against `(?:const|let|var) UPPER_SNAKE =` and
   Python's `UPPER_SNAKE =`. The underscore is required for the same
   reason NARRATIVE and COUNT_CLAIM narrow on a measured shape rather
   than a guess: a bare "GET" or "OK" is an English word wearing caps,
   and every real constant this tree defines (`ADMIN_TELEGRAM_IDS`,
   `API_SEGMENTS`, `CHART_SETTINGS`) has an underscore.
 - `METHOD /path` - BARE_ROUTE - an HTTP verb immediately before a
   path, resolved against `known_api_segments()`, which reads
   server/worker.js's own `API_SEGMENTS` declaration (isApiPath's
   registry, "Every path above is API-shaped... everything else is a
   page or an asset, served by env.ASSETS" - server/worker.js's own
   comment, lines 70-72) rather than parsing route()'s dispatch
   conditionals or its parameterized regexes. MEASURED, NOT GUESSED: a
   bare `/path` with no verb is refused this rule entirely - `/p`,
   `/span`, `/body`, `/head` (HTML tags and CSS selectors), `/x` (a
   regex character class), `/etc/hosts` (a real Unix path), `/apps/web`
   and `/dev` (directory fragments) and half a dozen more all matched
   an unrestricted `/word` scan of this tree with nothing to do with a
   route; requiring the verb (`GET /config`, `GET /admin-log`, the
   ticket's own two examples) is what took that list to zero while
   keeping every real route intact. Every route this checker can
   confirm resolves is what `route()` answers `env.ASSETS.fetch`
   without ever reaching - a page or a static asset - is out of scope
   for the SAME reason: checking it would mean re-deriving dist/'s own
   routing, which is #181's question, not this one's.
 - a repo-relative path with a known extension - CITED_TOKEN, already
   defined above for the citation rules - resolved against the real
   file at that path OR (known_basenames()) any file anywhere in the
   tree sharing that basename, because `admin.html`, `form.js` and
   `worker.js` are written bare, with no directory, throughout
   DESIGN.md, OPERATIONS.md and README.md - checking only the exact
   relative path would redden every one of them.

BUILTIN_CALLS is the measured floor under the call-shape rule, not a
maintained standard-library index: `Boolean()`, `isFinite()`,
`toISOString()`, `toLocaleString()`, `getBoundingClientRect()`,
`getClientRects()`, `getComputedStyle()`, `getComputedTextLength()` are
the JS/DOM platform calls this tree's own comments name to explain
browser behavior (`getClientRects()` and `getComputedStyle()` sit in
AGENTS.md's own "Verification" bullets); `dict()`, `tuple()`,
`isinstance()`, `min()`, `max()`, `print()`, `open()`, `repr()`,
`ascii()`, `str.startswith()` and `Path.is_dir()` are the Python
builtins tools/ narrates the same way; `test()` and `after()` are
`node:test`'s own hook names, discussed by dev/harness.mjs's own
docstring explaining why this repo does not adopt them; `var()` is CSS
custom-property syntax (`var(--x)`), not a call at all. None of the
eleven is a repo definition and none will ever become one by this
checker's own admission - this is not a ratchet, because a builtin
never resolves and a growing list here would just be catching up to
however many the language and the platform ship. A NEW builtin name
this tree starts discussing joins the set in the same edit that adds
the comment, same as the two EXEMPT files above may name what they
forbid.

A HANDFUL OF MEASURED NAMES could not be resolved by any of the four
shapes above, are not builtins either, and are not really dangling -
DANGLING_PINS covers each, read for truth rather than assumed rather
than covered by a wider rule: an ILLUSTRATIVE placeholder a docstring
invents to explain a shape (`dev/harness.mjs`'s `somethingAsync()`,
`tools/agent_init.py`'s paired `pinned.txt`/`inned.txt` truncation
example, `dev/check_web.test.py`'s `defer.js`, `tools/fleet_status.py`'s
`/path/to/stub.py`, `tools/check_docs.py`'s formula placeholder
`THAT.md`, `server/worker.js`'s `x.html`); a name inside a SYNTHETIC
FIXTURE a suite builds to test another checker's own rule
(`dev/check_web.test.py`'s `helper()`, `dev/check.test.py`'s
`dev/stray.test.py`); a REJECTED DESIGN OPTION that was never built,
not a deleted one (`dev/signout.test.mjs`'s `forgetLocalData()`,
weighed and dropped in the same paragraph - "There was a latent
third..."); a WORD-STEM notation this file's own spelling docstring
writes, not a call (`tools/check_spelling.py`'s `-is(e/ing/ation)`); a
citation of a REAL DEPENDENCY, never this repository
(`tools/agent_init.py`'s fontTools-internal `woff2.py`); a quotation of
OLD PROSE a ledger's own history narrates replacing, not a citation of
a live file (`tools/check_live.py`'s `query.js`, "'query.js frozen in a
browser engine' stood here"); a shell-redirect EXAMPLE, not a path
(`tools/claim_vs_diff.py`'s `` `> file.txt` ``); and a path whose
PLACEHOLDER PREFIX is not part of this tree at all
(`tools/prime_lock.py`'s `` `<state>/locks/prime.json` ``). Each is
backward-checked the same way every other pin in this file is: a pin
whose (file, kind, name) stops matching what dangling_findings() would
otherwise report fails, naming the entry to delete - which is how
`tools/reaper_suite.py`'s own `shared/sentinel.txt` (the first fixture
found, and the reason `_suite.py` files are excluded from the path
shape entirely rather than pinned one fixture at a time - see
dangling_findings() below) never became a permanent entry here.

THE "IS GONE" ALLOWANCE, the ticket's own words: a name resolves as
history rather than as a defect when the SAME SENTENCE that names it
also says so, in one of five exact phrases - "is gone", "replaced",
"retired", "deleted", "renamed to" (GONE below, case-insensitive).
Sentence boundaries (SENTENCE_END below) are a mark followed by
whitespace or the region's own end, NOT the bare nearest `.`, `!` or `?`
has_subject() uses above - measured against dev/demo-corpus.js's own
"...the same file server/worker.js's real POST /snapshot handler
stored..." sentence, where the bare version split AT THE PERIOD INSIDE
"worker.js" itself, stranding the route on one side of its own "is
gone" sentence and the allowed word on the other; a sentence-end mark
must be followed by space or nothing; a period inside a filename never
is. Server/worker.js's own header narrates POST/GET/DELETE /snapshot as
"GONE (0.9-M2-S3, #354)" and dev/demo-corpus.js opens its whole
retirement comment with "RETIRED (0.9-M2-S3, #354):" before the route
it retires - both keep the route and the allowed word in ONE sentence,
by construction rather than by accident, which is what lets the
ticket's "within the same sentence" survive contact with the real tree
rather than needing widening to "the same paragraph." Where two
adjacent sentences carry the retirement and the name separately (the
measured shape - server/schema.sql's `snapshots` table comment among
others), the finding stands and is listed for its owner rather than
silently forgiven; a ratchet that forgave every near-miss would not be
asking the question the ticket wrote this rule to ask.

WHAT THIS RULE DOES NOT ATTEMPT: it is not a parser, and
defined_names() is five regexes over raw text, not an AST - a name
assigned through a destructuring pattern, a computed property, or a
decorator is invisible to it the same way an unusual definition shape
was until measurement found `box` and `openRow` and widened
JS_ASSIGN_DEF and added JS_METHOD_DEF/JS_PROPERTY_DEF to reach them.
The failure direction this leaves is stated rather than hidden: a
defined name that JS_ASSIGN_DEF's own shapes cannot see reads as
"gone" when it is not, which is a false red rather than a false green -
the direction this repository's own checks consistently prefer, and
correctable in the open the moment it happens, the same way the four
widenings above were.
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
    # ("apps/web/admin.html", "DESIGN.md", "The charts and the snapshot")
    # and ("apps/web/admin.js", "DESIGN.md", "Key custody") retired
    # 0.9-M3-S10 (#416): both comments left with the snapshot/publish
    # machinery and the keyfile-decrypt tool they described.
    ("apps/web/config.js", "OPERATIONS.md", "The keys"): 1,
    ("tools/check_web.py", "OPERATIONS.md", "The keys"): 1,
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
# occurrences - up from fourteen.
#
# RE-MEASURED AGAIN on the rebase order (#392, 2026-08-21): S2/S3/S5/S6
# landed comments carrying this same dash-mention shape after fix wave
# 1's count was taken, so the ratchet reddened on a tree it had never
# scanned - not a broken rule, the rule doing exactly what a ratchet
# does to an unmeasured tree. Four more pairs, each read for truth
# before pinning (a pin is a claim vouched for, not a count copied):
# dev/check_live.test.py's and tools/check_live.py's own admin.js
# mentions both check out against apps/web/admin.js's real, single
# untyped `type:` token; tools/claim_vs_diff_suite.py's "ghost.txt" is
# its own declared-but-untouched fixture path, used the same way
# throughout that file; tools/tier.py's "tests/run.mjs" names the 0.9
# gate's real runner, exactly as AGENTS.md's own "Verification" section
# does. Forty-three pairs, forty-nine occurrences now.
#
# RAISED AGAIN at 0.9-M3-S10 (#416): tools/check_live.py's own admin.js
# count moves from 1 to 2. The retirement note this slice adds beside
# LEDGER's export rows ("admin.js's own Blob() calls are gone") is a
# second, true dash-mention in the same file as the pinned one - read
# for truth the same way, against the real shipped admin.js, which now
# carries no Blob() call at all.
#
# apps/web/theme.css's self-mention ("theme.css says so above") is
# still excluded rather than pinned, for
# the same reason as before: a file's claim about its own text is
# checkable by anyone reading the file.
#
# DROPPED at 0.9-M3-S10's own fix wave (#416): ('apps/web/form.js',
# 'admin.js'). The comment that pin covered cited admin.js's now-gone
# CSV export as the reason form.js keeps height.feet/height.inches;
# rewritten to say the export retired rather than to still claim it
# reads them, which removed the dash-mention this pin existed for. The
# list is a ratchet and only shrinks, per its own rule above.
#
# DROPPED at 0.9-M3-S17 fix wave 1 (#422 review F3): ('server/worker.js',
# 'precedence.test.mjs'). Never a real dash-mention - unwrap()'s own bug,
# fixed in the same wave (see _hyphen_glued() above unwrap()): the real
# source reads "tests/route-\n * precedence.test.mjs", a hyphenated path
# wrapped mid-token with no space on either side of the break, and the
# unconditional inserted space used to manufacture a "- precedence.
# test.mjs" dash-connective that was never written. Fixing the wrap
# removed the manufactured dash along with the manufactured mention.
NARRATIVE_PINS = {
    ('apps/web/auth.js', 'submit.js'): 1,
    ('apps/web/charts.html', 'charts.js'): 1,
    ('apps/web/config.js', 'auth.js'): 1,
    ('apps/web/crypto.js', 'DESIGN.md'): 1,
    ('apps/web/crypto.js', 'dev/crypto.test.mjs'): 1,
    ('apps/web/form.js', 'apps/web/site.config.js'): 1,
    ('apps/web/site.config.js', 'your-page.html'): 1,
    ('apps/web/theme.css', 'apps/web/charts.js'): 1,
    ('dev/check_live.test.py', 'admin.js'): 1,
    # Raised from 1 to 2 at 0.9-M3-S10 (#416) - see the note above
    # NARRATIVE_PINS.
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
    ('server/worker.js', 'server/store-crypto.js'): 1,
    ('server/worker.js', 'wrangler.toml'): 1,
    ('tools/agent_init.py', 'tools/requirements-gate.txt'): 1,
    ('tools/check.py', 'dev/form.test.mjs'): 1,
    ('tools/check.py', 'tools/build_web.mjs'): 1,
    ('tools/check_docs.py', 'tools/check_comments.py'): 1,
    ('tools/check_fonts.py', 'tools/build_web.mjs'): 1,
    ('tools/check_live.py', 'admin.js'): 2,
    ('tools/check_live.py', 'server/wrangler.toml'): 2,
    ('tools/check_web.py', 'AGENTS.md'): 2,
    ('tools/check_web.py', 'admin.html'): 2,
    ('tools/check_web.py', 'crypto.js'): 1,
    ('tools/check_web.py', 'index.html'): 1,
    ('tools/check_web.py', 'theme.js'): 1,
    ('tools/claim_vs_diff_suite.py', 'ghost.txt'): 1,
    ('tools/fleet_status.py', 'reaper.py'): 3,
    ('tools/session_open_suite.py', 'reaper.py'): 1,
    ('tools/ship_check.py', 'AGENTS.md'): 2,
    ('tools/tier.py', 'tests/run.mjs'): 1,
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
# could not - twenty-four then, including apps/web/site.config.js's own
# escape (S16's real one) and server/charts-agg.js's twin.
#
# RE-MEASURED AGAIN on the rebase order (#392, 2026-08-21), for the
# same reason NARRATIVE_PINS was: S5 and S6 landed two more real ticket
# citations after the count above was taken. Both read for truth: tools/
# ship_check_suite.py's #393 citation and tools/tier.py's #403 citation
# each quote coherent, complete instructions from their own named
# tickets, the same shape as every existing entry. Twenty-six now.
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
    # dev/admin-session.test.mjs's and dev/admin.test.mjs's #354/#275
    # citations retired with the files themselves at 0.9-M3-S10 (#416).
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
    ('tools/ship_check_suite.py', '#393',
     "the block's totals are the tool's own computed values (a "
     "mutation forcing a wrong total into the block must red)"): 1,
    ('tools/tier.py', '#403',
     'mirror its rules in-repo (a fork needs them), do not import '
     'it.'): 1,
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


def code_only(text, kind):
    """`text` with every comment blanked, code and strings intact.

    comments_only()'s exact mirror image, built ON it rather than by
    re-deriving the lexer: wherever comments_only() KEPT a real
    character (that position is inside a comment), this blanks it;
    wherever comments_only() blanked (that position is code or a
    string), this keeps the original byte. Written for defined_names()
    below (0.9-M3-S17 fix wave 1, #422 review F2) - "a definition, not
    another mention" (the ticket's own words) means a name quoted
    inside a comment, describing code that used to exist, must never
    count as proof the name is bound. Strings survive on purpose:
    PY_STRING_CONST reads a real `os.environ.get("NAME")` call's own
    quoted argument, which is code, not narration about code.
    """
    masked = comments_only(text, kind)
    out = list(text)
    for index, char in enumerate(masked):
        if char != "\n" and char != BLANK:
            out[index] = BLANK
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


def _hyphen_glued(text):
    """Whether `text` (accumulated so far) ends in a hyphen glued
    directly to a word character - a hard line-wrap splitting a
    hyphenated path or identifier mid-token, never the phrase-
    separator dash this tree always writes WITH a space before it
    ("the row an admin can see -"). Measured against server/worker.js's
    own "tests/route-\n * precedence.test.mjs" (0.9-M3-S17 fix wave 1,
    #422 review F3): the real file is tests/route-precedence.test.mjs,
    wrapped at the hyphen with no space either side of the break -
    unwrap()'s unconditional inserted space read it as two dangling
    halves, "route-" (not a path at all) and "precedence.test.mjs" (a
    file that does not exist, because the real one starts with
    "route-"). The two OTHER wrap artifacts already pinned in
    DANGLING_PINS (dev/check_live.test.py's "export_\nfamilies()",
    dev/worker.test.mjs's "route-precedence.\n// test.mjs") end in "_"
    and "." rather than a bare hyphen, so this narrower check leaves
    both exactly as they were - untouched, still pinned, not this
    fix's to close.
    """
    return len(text) >= 2 and text[-1] == "-" and not text[-2].isspace() \
        and text[-2] != BLANK


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
        if number and not _hyphen_glued(text):
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


# ------------------------------------------------------------------ #
# Rule 6: DANGLING IDENTIFIERS (0.9-M3-S17, #422). See the module
# docstring's "A SIXTH RULE" section for the full argument; this is the
# machinery.

# The operative documents CITATION_PINS already treats as first-class
# citation targets - "the docs it covers" in the ticket's own words.
# archive/ (frozen history) and security/ (dated snapshots) are
# deliberately excluded, for the reason the docstring gives.
DOCS = ("README.md", "AGENTS.md", "DESIGN.md", "OPERATIONS.md")

# A bare call: `name()` or `name(args)`, no space before the paren (a
# real English parenthetical always has one - "the answer (obviously)
# is"). The plural suffix is excluded by name below rather than here,
# because "(s)" is the one shape measured to collide - "comment(s)",
# "citation(s)", "occurrence(s)" - and nothing else did.
FUNC_CALL_BARE = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]*)\(([^()]*)\)")
PLURAL_SUFFIX = re.compile(r"^(?:s|es|ies)$")

# A review-finding label's own sub-point, "F1(c)" - a real, recurring
# citation shape (tools/ship_check.py, tools/ship_check_suite.py: "review
# F1(c), #393") that is not a call at all.
FINDING_LABEL = re.compile(r"^F\d+$")
FINDING_SUBPOINT = re.compile(r"^[a-z]$")

# UPPER_SNAKE with at least one underscore - see the docstring for why
# the underscore is required (every real constant this tree defines has
# one; a bare "GET" or "OK" does not).
CONST_BARE = re.compile(r"\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b")

# An HTTP verb immediately before a path - no bare `/word` scan, per the
# docstring's measurement (`/p`, `/etc/hosts`, `/apps/web` and a dozen
# more are not routes).
BARE_ROUTE = re.compile(
    r"\b(?:GET|POST|DELETE|PUT|PATCH|OPTIONS)\s+(/[\w-]+(?::[\w-]+)?"
    r"(?:/[\w:-]+)*)")

# CITED_TOKEN (defined above, for rule 3) is too permissive to reuse
# here unchanged: `tests/*.test.mjs` (a glob) and `` `tests/<name>.test.mjs` ``
# (a template) both leave a "*" or "<...>" immediately before the
# extension-bearing remainder once the wildcard/placeholder itself,
# which is not in CITED's own character class, breaks the match - and
# ".test.mjs" or "test.mjs" then reads as a path candidate that was
# never meant literally. The lookbehind refuses a match whose first
# character is not freshly starting a token (preceded by "*", "<", a
# word character, or another "." that a real path would have swallowed
# as part of the same CITED match).
PATH_BARE = re.compile(r"(?<![*<>\w.])%s\b" % CITED)

# A template filename this repository writes about, never one it holds:
# `binder-YYYY-MM-DD.sql`, dated by the operator running the command,
# is a NAMING PATTERN shown in OPERATIONS.md's own backup instructions,
# not a file this tree can contain.
TEMPLATE_PATH = re.compile(r"YYYY|DD\b")

# Basenames this repository's own tooling discusses constantly and can
# never confirm by walking the tree - .claude/ is gitignored WHOLE
# (.gitignore line 45), so `settings.json` and every `.claude/hooks/*.py`
# script (bash_guard.py, dispatch_premise.py) are real, local-machine
# files no checkout ever tracks, mentioned here by bare basename as
# often as by their full .claude/ path.
GITIGNORED_BASENAMES = frozenset({
    "settings.json", "bash_guard.py", "dispatch_premise.py",
})

# The measured floor under FUNC_CALL_BARE - see "BUILTIN_CALLS is the
# measured floor" in the module docstring for what each one is and
# where it is discussed in this tree.
BUILTIN_CALLS = frozenset({
    # JS/DOM platform calls this tree's comments name to explain browser
    # or language behavior - never a repo definition.
    "Boolean", "Number", "String", "Date", "Response", "Blob",
    "isFinite", "toISOString", "toLocaleString", "toFixed", "padEnd",
    "getBoundingClientRect", "getClientRects", "getComputedStyle",
    "getComputedTextLength", "querySelectorAll", "includes", "slice",
    "split", "join", "close", "parse", "parseFloat", "freeze",
    "defineProperty", "length", "reload", "assign",
    # Node's own vm module, discussed in dev/signout.test.mjs's comment
    # explaining what vm.createContext() does and does not contextify.
    "createContext",
    # Python builtins and stdlib.
    "dict", "tuple", "isinstance", "min", "max", "print", "open", "repr",
    "ascii", "startswith", "is_dir", "len", "exit", "strip", "abspath",
    "require", "which", "mix", "TemporaryDirectory", "SystemExit",
    "splitlines",
    # fontTools, a third-party dependency tools/check_fonts.py drives -
    # not a repo definition.
    "TTFont",
    # node:test's own hook names, discussed by dev/harness.mjs's own
    # docstring explaining why this repo does not adopt them.
    "test", "after",
    # CSS custom-property syntax (`var(--x)`), not a call at all.
    "var",
    # Spreadsheet formula names apps/web/xlsx.js's own comments quote
    # verbatim (real Excel functions, never a repo definition),
    # cryptographic algorithm notation ("HMAC-SHA256(...)", server/
    # schema.sql and dev/make-sample.mjs's own comments), and
    # review-finding labels ("F1(CONFIRMED)"-shaped) that are not calls.
    "SUM", "COUNT", "not", "SHA256", "HMAC",
})

# Fifty-five names neither a definition scan nor the "is gone" sentence
# can clear, each read for truth once rather than assumed - see "A
# HANDFUL OF MEASURED NAMES" in the module docstring. {(file, kind,
# name): (count, reason)}, the same shape CITATION_PINS/NARRATIVE_PINS/
# TICKET_PINS use for their own pins (0.9-M3-S17 fix wave 1, #422
# review F1): a pin covers the occurrences that were already there when
# it was written, never a new mention appended after it - counted, not
# merely a set of triples, for the same reason CITATION_PINS is (that
# dict's own comment: "Counting closes it, for the same reason
# ALLOWLIST counts"). Before this wave DANGLING_PINS was the one pin
# list in this file with no count, so membership alone forgave every
# future line naming an already-pinned dangling thing, however many
# were added after the pin - proven by mutation, appending one new
# `dashboard.js` mention to an already-pinned file stayed green.
# Backward-checked by dangling_pin_problems() below, same as every
# other pin in this file: an entry whose triple stops being a real,
# would-be finding fails, naming itself for deletion; an entry whose
# real count drops below what is pinned fails too, naming the lower
# number to pin instead.
DANGLING_PINS = {
    ("dev/signout.test.mjs", "function", "forgetLocalData"):
        (1, "names a rejected design option (\"There was a latent "
            "third...\") that was never built, not a deleted one"),
    ("dev/harness.mjs", "function", "somethingAsync"):
        (1, "an illustrative placeholder name (\"() => somethingAsync() "
            "with the await forgotten\") explaining a shape, never a "
            "real call"),
    ("dev/check_web.test.py", "function", "helper"):
        (1, "a name inside a synthetic JS fixture string (FROZEN/"
            "UNFROZEN) this suite builds to test check_web.py's own "
            "rule, not real apps/web source"),
    ("tools/check_spelling.py", "function", "is"):
        (1, "\"-is(e/ing/ation)\" is a word-stem/suffix-alternation "
            "notation in this file's own spelling-pattern docstring, "
            "not a call"),
    ("tools/agent_init.py", "path", "woff2.py"):
        (1, "fontTools' own internal module (from the ImportError path "
            "this test drives), not a file this repository holds"),
    ("tools/agent_init.py", "path", "pinned.txt"):
        (1, "a hypothetical filename explaining a one-character "
            "truncation bug (\"turns pinned.txt into inned.txt\"), "
            "never a real fixture"),
    ("tools/agent_init.py", "path", "inned.txt"):
        (1, "the same hypothetical example's truncated half - see "
            "pinned.txt above"),
    ("dev/check.test.py", "path", "dev/stray.test.py"):
        (1, "a synthetic mutation-test fixture name this suite's own "
            "docstring invents to explain a found-by-mutation bug, "
            "never a real file"),
    ("tools/check_live.py", "path", "query.js"):
        (1, "a quoted OLD comment (\"'query.js frozen in a browser "
            "engine' stood here\") this ledger's own history narrates "
            "replacing, never a citation of a real file"),
    ("tools/claim_vs_diff.py", "path", "file.txt"):
        (1, "a PowerShell redirect example (\"`> file.txt`, not "
            "-Encoding utf8\"), not a path"),
    ("tools/fleet_status.py", "path", "path/to/stub.py"):
        (1, "an illustrative placeholder (\"/path/to/stub.py\"), never "
            "a real file"),
    ("tools/prime_lock.py", "path", "locks/prime.json"):
        (1, "written `<state>/locks/prime.json` - the placeholder "
            "prefix is not part of this repository's own tree, and the "
            "real path is outside it by design (the fleet's runtime "
            "state directory)"),
    ("dev/check_web.test.py", "path", "defer.js"):
        (1, "a hypothetical filename (\"a file that happens to be "
            "called defer.js\") illustrating a bare-attribute-name "
            "rule, not a real fixture"),
    ("tools/check_docs.py", "path", "THAT.md"):
        (1, "a placeholder in a formula (`REGISTRY - {\"THAT.md\"}`), "
            "never a real document"),
    ("server/worker.js", "path", "x.html"):
        (1, "a generic placeholder (\"a request for /x.html\") "
            "illustrating html_handling's redirect rule, not a real "
            "page"),

    # ONE WRAP-SPLIT EXTRACTOR ARTIFACT REMAINS PINNED: unwrap() (used
    # by every rule in this file, not only this one) inserts a single
    # space between two continuation lines unconditionally, which is
    # right for a phrase reflowed at a word boundary and wrong for a
    # token the ORIGINAL author's own line-wrap split mid-word. A
    # SECOND instance - server/worker.js's "tests/route-\n *
    # precedence.test.mjs", wrapped at a bare hyphen with no space
    # glued to a word character - is fixed in the RULE itself as of
    # this fix wave (_hyphen_glued() above unwrap(), #422 review F3)
    # rather than pinned, because the real path now reconstructs and
    # resolves; that pin (and its now-stale NARRATIVE_PINS twin above)
    # is deleted, not carried forward. This one is a genuinely
    # different wrap shape - the split lands on "_", not "-" - so it is
    # untouched by that fix and stays pinned:
    ("dev/check_live.test.py", "function", "families"):
        (1, "export_families() wraps as \"export_\\nfamilies()\" in the "
            "source; unwrap()'s inserted space splits the identifier "
            "and this rule reads only the second half. "
            "export_families() is real (tools/check_live.py)"),
    ("dev/worker.test.mjs", "path", "test.mjs"):
        (1, "tests/route-precedence.test.mjs wraps as \"...precedence."
            "\\n  // test.mjs\" in the source; unwrap()'s inserted "
            "space lands exactly inside the extension. tests/route-"
            "precedence.test.mjs is real"),

    # THE REMAINDER IS REAL, PRE-EXISTING DEBT, MEASURED AT 0.9-M3-S17'S
    # OWN BUILD (#422) AND LISTED IN ITS COMPLETION FOR EACH OWNING
    # FILE'S NEXT TOUCH - not a false positive, not fixed here. Grouped
    # by cause; every file listed is either outside this slice's declared
    # list or embedded in a paragraph too large to true as a "one-line
    # comment fix" (the pack's own bar for fixing outside the declared
    # list). Two are server/ and stay for #424 or the next sensitive
    # slice; the rest are apps/web/, dev/ or tools/ and stay for whoever
    # next touches that file, per AGENTS.md's own "comments slim as the
    # code that made them stale is touched."
    #
    # apps/web/dashboard.js, retired whole at 0.9-M2-S3 (#354), and its
    # own MIN_CELL and public.js alongside it: every entry below narrates
    # or worked-examples the retired file without "is gone"/"replaced"/
    # "retired"/"deleted"/"renamed to" in the SAME sentence as the name -
    # some in an adjacent sentence (dashboard.js IS narrated as retired
    # elsewhere in most of these files), some as a past-tense worked
    # example (tools/check_web.py's "dashboard.js did exactly that: it
    # built its literal, published it, and then bolted render on 424
    # lines later" - a real historical bug, correctly in the past tense,
    # just not in the rule's one recognized shape). Counting (fix wave 1,
    # F1) found three of these were already under-counted at "one" by
    # the old membership-only check: apps/web/charts.js, tools/
    # check_budget.py's bare "dashboard.js" and tools/check_spelling.py's
    # "apps/web/dashboard.js" each carry a second, previously invisible
    # occurrence.
    ("apps/web/charts.js", "path", "apps/web/dashboard.js"):
        (2, "apps/web/dashboard.js retired 0.9-M2-S3 (#354); listed, "
            "not fixed - #422"),
    ("apps/web/theme.css", "path", "apps/web/dashboard.js"):
        (1, "apps/web/dashboard.js retired 0.9-M2-S3 (#354); listed - "
            "#422"),
    ("apps/web/theme.css", "path", "dashboard.js"):
        (1, "apps/web/dashboard.js retired 0.9-M2-S3 (#354); listed - "
            "#422"),
    ("apps/web/xlsx.js", "path", "dashboard.js"):
        (1, "apps/web/dashboard.js retired 0.9-M2-S3 (#354); listed - "
            "#422"),
    ("dev/build_web.test.mjs", "path", "dashboard.js"):
        (1, "apps/web/dashboard.js retired 0.9-M2-S3 (#354); listed - "
            "#422"),
    ("dev/check_spelling.test.py", "path", "apps/web/dashboard.js"):
        (1, "apps/web/dashboard.js retired 0.9-M2-S3 (#354); listed - "
            "#422"),
    ("dev/check_web.test.py", "path", "dashboard.js"):
        (1, "apps/web/dashboard.js retired 0.9-M2-S3 (#354); listed - "
            "#422"),
    ("dev/demo.test.mjs", "path", "dashboard.js"):
        (1, "apps/web/dashboard.js retired 0.9-M2-S3 (#354); listed - "
            "#422"),
    ("tools/check_budget.py", "path", "apps/web/dashboard.js"):
        (1, "apps/web/dashboard.js retired 0.9-M2-S3 (#354); listed - "
            "#422"),
    ("tools/check_budget.py", "path", "dashboard.js"):
        (2, "apps/web/dashboard.js retired 0.9-M2-S3 (#354); listed - "
            "#422"),
    ("tools/check_live.py", "path", "apps/web/dashboard.js"):
        (1, "apps/web/dashboard.js retired 0.9-M2-S3 (#354); listed - "
            "#422"),
    ("tools/check_spelling.py", "path", "apps/web/dashboard.js"):
        (2, "apps/web/dashboard.js retired 0.9-M2-S3 (#354); listed - "
            "#422"),
    ("tools/check_web.py", "path", "dashboard.js"):
        (5, "apps/web/dashboard.js retired 0.9-M2-S3 (#354); listed - "
            "#422"),
    ("tools/check_spelling.py", "function", "labeller"):
        (1, "apps/web/dashboard.js's own exported `labeller`, retired "
            "with the file (0.9-M2-S3, #354); this docstring cites it "
            "by name to explain a spelling-ratchet exception, present "
            "tense. Listed - #422"),
    ("dev/demo-stub.js", "constant", "MIN_CELL"):
        (1, "MIN_CELL lived in apps/web/dashboard.js, retired with it "
            "0.9-M2-S3 (#354); listed - #422"),
    ("dev/demo.test.mjs", "constant", "MIN_CELL"):
        (2, "MIN_CELL lived in apps/web/dashboard.js, retired with it "
            "0.9-M2-S3 (#354); listed - #422"),
    ("server/charts-agg.js", "constant", "MIN_CELL"):
        (1, "MIN_CELL lived in apps/web/dashboard.js, retired with it "
            "0.9-M2-S3 (#354). NOT #424's to fix (0.9-M3-S17 fix wave "
            "1, #422 review F3): the sentence itself is correctly-"
            "framed historical prose - \"the pre-0.9 dashboard's `floor "
            "= identify ? 0 : MIN_CELL`\" - retirement framing in plain "
            "English that reds only because \"pre-0.9\" is not one of "
            "the five words GONE recognizes. Extractor narrowness, not "
            "owner debt; widening the allowance is the ticket's own "
            "call, not this slice's or #424's"),
    ("apps/web/index.html", "path", "public.js"):
        (1, "apps/web/public.js retired 0.9-M2-S3 (#354, folded into "
            "charts.js); listed - #422"),
    ("dev/check_web.test.py", "path", "public.js"):
        (1, "apps/web/public.js retired 0.9-M2-S3 (#354); listed - "
            "#422"),
    ("dev/demo-stub.js", "function", "movementOf"):
        (1, "names apps/web/dashboard.js-era behavior with no "
            "surviving function of this name anywhere in the tree; "
            "listed - #422"),
    ("dev/demo-stub.js", "function", "movementText"):
        (1, "names apps/web/dashboard.js-era behavior with no "
            "surviving function of this name anywhere in the tree; "
            "listed - #422"),

    # A dead-by-design negative-test fixture (the same shape ghost.txt
    # is pinned for above): dev/worker.test.mjs sets DEV_LOGIN_SECRET ON
    # PURPOSE to prove the local sign-in door it once gated (retired
    # 0.9-M2-S1, #352) reads nothing. Not a stale claim, but not phrased
    # with an allowed word either - listed rather than reworded, since
    # rewording a deliberately-dead fixture name risks reading as if the
    # door still exists.
    ("dev/worker.test.mjs", "constant", "DEV_LOGIN_SECRET"):
        (4, "dead-by-design fixture proving the retired local sign-in "
            "door (0.9-M2-S1, #352) reads nothing; listed - #422"),

    # The /snapshot route, retired 0.9-M2-S3 (#354) alongside the whole
    # publish/unpublish surface. server/worker.js's own header and
    # dev/demo-corpus.js both narrate it correctly (GONE below resolves
    # them); these two do not.
    ("dev/demo.test.mjs", "route", "/snapshot"):
        (1, "says the calls \"dropped out\" rather than one of the "
            "five allowed words; route retired 0.9-M2-S3 (#354). "
            "Listed - #422"),
    ("server/schema.sql", "route", "/snapshot"):
        (1, "the snapshots table's own header describes GET /snapshot "
            "in present tense with no retirement framing; route "
            "retired 0.9-M2-S3 (#354). server/ - listed for #424 or "
            "the next sensitive slice - #422"),

    # ADMIN_IDLE_MINUTES: mentioned twice in server/worker.js's own
    # comments, never bound anywhere - checked against 0.9-M3-S8's own
    # branch tip before it merged, same result. Not history (nothing
    # says it was ever real); a forward reference to a binding S8 named
    # but has not wired. server/ - listed for #424 or the next sensitive
    # slice, not S17's to invent a binding for.
    ("server/worker.js", "constant", "ADMIN_IDLE_MINUTES"):
        (2, "mentioned, never bound, in this file or 0.9-M3-S8's own "
            "branch before it merged; listed for #424 or the next "
            "sensitive slice - #422"),

    # Retired features and files with no single owner obvious enough to
    # rewrite blind:
    ("tools/check_live.py", "function", "origin_problems"):
        (1, "origin_problems() retired at 0.9-M1-S3 (#329) along with "
            "the \"published-origin-only\" cause it alone corroborated "
            "- this ledger entry was not trued when the OTHER mention "
            "in the same file was. Listed - #422"),
    ("dev/make-sample.mjs", "function", "readForm"):
        (1, "names a function with no surviving definition anywhere in "
            "the tree; origin unclear without deeper history. Listed - "
            "#422"),
    ("dev/demo-stub.js", "path", "dev/demo-console.js"):
        (1, "names a file with no surviving twin to "
            "dev/demo-server.mjs; possibly dev/demo-toolbar.js under a "
            "former name. Listed - #422"),
    ("dev/demo-stub.js", "path", "dev/submit.test.mjs"):
        (1, "claims a page-side guard is \"armed in "
            "dev/submit.test.mjs\", which does not exist; the real "
            "coverage's location is unclear without deeper history. "
            "Listed - #422"),
    ("dev/signout.test.mjs", "path", "dev/memberkey.test.mjs"):
        (1, "apps/web/memberkey.js and its test retired 0.9-M2-S5 "
            "(#356); listed - #422"),
    ("tools/check_live.py", "path", "apps/web/memberkey.js"):
        (1, "apps/web/memberkey.js retired 0.9-M2-S5 (#356); this "
            "ledger entry narrates \"RETIRED\" two sentences earlier, "
            "not the same one as the file mention. Listed - #422"),

    # Documents left out of REGISTRY on the owner's own 2026-08-13
    # directive (0.9-M0-S2) - tools/check_docs.py's own comment records
    # the decision, but not with one of the five allowed words either.
    ("dev/check_docs.test.py", "path", "CUTOVER.md"):
        (1, "CUTOVER.md left out of REGISTRY on the owner's 2026-08-13 "
            "directive (0.9-M0-S2); not phrased with an allowed word. "
            "Listed - #422"),
    ("tools/check_docs.py", "path", "CUTOVER.md"):
        (2, "CUTOVER.md left out of REGISTRY on the owner's 2026-08-13 "
            "directive (0.9-M0-S2); listed - #422"),
    ("tools/check_docs.py", "path", "UAT.md"):
        (1, "UAT.md left out of REGISTRY on the owner's 2026-08-13 "
            "directive (0.9-M0-S2); listed - #422"),
    ("tools/check_live.py", "path", "UAT.md"):
        (1, "UAT.md left out of REGISTRY on the owner's 2026-08-13 "
            "directive (0.9-M0-S2); listed - #422"),

    # Machine-held records outside this repository's own tree by design
    # (the fleet's own review archive, not a document check_docs.py's
    # REGISTRY could ever hold) - the same shape .claude/ is excused for
    # above, but named without that directory prefix so the automatic
    # exclusion cannot see it.
    ("tools/check_live.py", "path", "fleet-review-M2.md"):
        (1, "the fleet's own machine-held review record, outside this "
            "repository by design - not a file check_docs.py's "
            "REGISTRY could ever hold. Listed - #422"),

    # A named scenario ("the no-package.json skip"), not a citation of a
    # file by that name - close enough to CITED's shape that a more
    # precise extractor would need to parse "no-X" as a compound, which
    # is new machinery for one measured instance.
    ("tools/agent_init.py", "path", "no-package.json"):
        (1, "\"the no-package.json skip\" names a scenario this file "
            "handles elsewhere, not a citation of a file called that. "
            "Listed - #422"),

    # CLAUDE_PROJECT_DIR: real, and in constant harness use - but never
    # bound anywhere in THIS repository's own tracked code, only
    # discussed by name across six lines of one docstring. Surfaced by
    # this fix wave's own F2 fix (masking comments before defined_names()
    # runs its regexes, #422 review F2): before the fix, PY_STRING_CONST
    # read the docstring's own illustrative `os.environ["CLAUDE_PROJECT_
    # DIR"]` quote as if it were a real `os.environ.get(...)` call and
    # treated the name as bound. It never is - grep confirms this exact
    # quoted form appears nowhere else in the tree, and the real
    # variable is set by the harness outside any file this repository
    # tracks, the same shape a Worker secret is never assigned here
    # either (JS_DOT_CONST's own docstring). A newly-true finding, not a
    # newly-introduced defect; listed - #422.
    ("tools/agent_init.py", "constant", "CLAUDE_PROJECT_DIR"):
        (6, "the harness's own environment variable, read at the "
            "hook's own runtime outside this repository's tracked "
            "code; this docstring discusses it by name six times and "
            "binds it nowhere. Listed - #422"),
}

# Five ways this tree assigns a name, widened by measurement (see "a
# local callback assigned `const box = boxOf || function (i)`" and
# "server/store-crypto.js's `openRow: (record, context) =>`" in the
# module docstring) until every real definition in the tree resolved.
JS_FUNC_KEYWORD_DEF = re.compile(r"\bfunction\s+([A-Za-z_$][\w$]*)\s*\(")
JS_ASSIGN_DEF = re.compile(
    r"\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=")
JS_PROPERTY_DEF = re.compile(
    r"\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\b")
JS_METHOD_DEF = re.compile(r"\b([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?\(")
PY_FUNC_DEF = re.compile(r"^[ \t]*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(",
                          re.M)
JS_CONST_DEF = re.compile(
    r"\b(?:export\s+)?(?:const|let|var)\s+"
    r"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\s*=")
PY_CONST_DEF = re.compile(
    r"^[ \t]*([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\s*=", re.M)

# A dot-accessed UPPER_SNAKE property, read or written: `env.STORE_SECRET`,
# `bindings.STORE_SECRET_KEY_ID`, `globalThis.BINDER_CONFIG = `. Measured
# in: a Cloudflare Worker's own secrets and vars (STORE_SECRET,
# EXPORT_TOKEN, ALLOWED_ORIGINS and a dozen more) are never assigned in
# this repository at all - that is what a secret IS - and the object
# they hang off (`env`, `bindings`) is not fixed, so neither
# JS_ASSIGN_DEF nor a literal "env." prefix reaches all of them; one
# dot-access pattern, unanchored to the object name, does.
JS_DOT_CONST = re.compile(r"\.([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b")

# A quoted UPPER_SNAKE string literal in Python source: `os.environ.get(
# "BINDER_GH_CMD")`, `os.environ["GIT_DIR"]`, `environment.pop("GIT_DIR",
# None)`, `getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)` - four real
# shapes measured in tools/ alone, which is why this reads any quoted
# occurrence rather than chasing a fifth call shape: an environment
# variable's NAME is data to Python (a string argument), never a
# binding, so no assignment-shaped regex reaches it.
PY_STRING_CONST = re.compile(r"""["']([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)["']""")

# The five directories a definition may live in - wider than SCAN's own
# per-directory extension pairs on purpose: SCAN says where a COMMENT is
# read from, and a function may be DEFINED in a file that scan never
# opens (tools/build_web.mjs is the measured case - .mjs is not among
# tools/'s scanned extensions above, so `differences()`, defined there
# and cited from tools/check.py's own comment, resolved nowhere until
# defined_names() below stopped reusing SCAN's pairs and started walking
# every .py/.js/.mjs file under these directories instead). `tests/` is
# not in SCAN at all (it holds the 0.9 gate's own runner, not source
# this checker's comment rules cover), and ARM_SUFFIX - defined in
# tests/run.mjs, cited from tools/ship_check.py's own comment - is the
# measured reason it still has to be a definition source.
DEFINITION_DIRS = ("apps/web", "server", "dev", "tools", "tests")

API_SEGMENTS_DECL = re.compile(r"API_SEGMENTS\s*=\s*new Set\(\[(.*?)\]\)",
                                re.S)

# Case-insensitive, exactly the five phrases the ticket names - see
# "THE 'IS GONE' ALLOWANCE" in the module docstring.
GONE = re.compile(r"\b(?:is gone|replaced|retired|deleted|renamed to)\b",
                   re.I)


def defined_names(dirs=None, repo=None):
    """(function names, constant names) really assigned in the tree.

    "A definition, not another mention" (the ticket's words): every
    pattern here is a place a name is BOUND or - for JS_DOT_CONST alone -
    a place an env/bindings-style property is read or written, since a
    Worker secret is never assigned in this repository at all. EXEMPT is
    NOT honored here (unlike scan_tree()'s comment scan): the two files
    that define this checker's own phrase machinery still hold real,
    citable function definitions - `check_comments.problems()` is a real
    function other files' comments correctly name.
    """
    dirs = DEFINITION_DIRS if dirs is None else dirs
    repo = REPO if repo is None else repo
    functions = set()
    constants = set()
    for dirname in dirs:
        base = os.path.join(repo, *dirname.split("/"))
        if not os.path.isdir(base):
            continue
        for root, _subdirs, files in os.walk(base):
            for name in files:
                ext = os.path.splitext(name)[1]
                if ext not in (".py", ".js", ".mjs"):
                    continue
                full = os.path.join(root, name)
                relpath = os.path.relpath(full, repo).replace(os.sep, "/")
                with open(full, encoding="utf-8") as handle:
                    text = handle.read()
                # CODE ONLY, NOT COMMENTS (0.9-M3-S17 fix wave 1, #422
                # review F2): every regex below used to run against the
                # raw file, so a comment QUOTING an old signature -
                # "the old `function ghostRosterName() {`", a docstring
                # narrating "ADMIN_IDLE_MINUTES is discussed here in
                # prose" - counted as a binding. code_only() blanks
                # every comment (Python's triple-quoted docstrings
                # included, the same shape scan_tree() already treats as
                # a comment) and leaves code and string literals
                # exactly where they were, so "a definition, not another
                # mention" (the ticket's own words) holds for prose as
                # well as for a mention in someone else's code.
                code = code_only(text, KIND[ext])
                if ext == ".py":
                    functions.update(PY_FUNC_DEF.findall(code))
                    constants.update(PY_CONST_DEF.findall(code))
                    # NOT for EXEMPT (tools/check_comments.py and this
                    # rule's own dev/check_comments.test.py): both hold
                    # tight-quoted UPPER_SNAKE names for BOOKKEEPING -
                    # DANGLING_PINS' own keys and reason strings in one,
                    # this rule's own fixture strings ("set
                    # ADMIN_IDLE_MINUTES") in the other - never because
                    # either file assigns them. PY_STRING_CONST cannot
                    # tell "a real os.environ.get(...) key" from "a pin
                    # dict's own key naming what does NOT resolve" or "a
                    # test fixture proving a name does NOT resolve", and
                    # reading either as proof the name is real is exactly
                    # backwards. Measured: MIN_CELL, DEV_LOGIN_SECRET and
                    # ADMIN_IDLE_MINUTES each "resolved" this way in
                    # turn, from whichever of the two files last grew a
                    # fixture or a pin naming them - masking comments
                    # elsewhere does not touch this exemption, which
                    # guards these two files' own CODE, not their prose.
                    if relpath not in EXEMPT:
                        constants.update(PY_STRING_CONST.findall(code))
                else:
                    functions.update(JS_FUNC_KEYWORD_DEF.findall(code))
                    functions.update(JS_ASSIGN_DEF.findall(code))
                    functions.update(JS_PROPERTY_DEF.findall(code))
                    functions.update(JS_METHOD_DEF.findall(code))
                    constants.update(JS_CONST_DEF.findall(code))
                if relpath not in EXEMPT:
                    constants.update(JS_DOT_CONST.findall(code))
    return functions, constants


def known_api_segments(repo=None):
    """The Worker's own API_SEGMENTS, read out of server/worker.js.

    Not the dispatch conditionals or the parameterized routes' regexes -
    isApiPath()'s own registry, which is what decides whether a path
    reaches route() at all ("Every path above is API-shaped... "
    everything else is a page or an asset" - server/worker.js's own
    comment). A path outside this set is not this rule's question; see
    the module docstring for why.
    """
    repo = REPO if repo is None else repo
    full = os.path.join(repo, "server", "worker.js")
    if not os.path.isfile(full):
        return set()
    with open(full, encoding="utf-8") as handle:
        text = handle.read()
    match = API_SEGMENTS_DECL.search(text)
    if not match:
        return set()
    return set(re.findall(r'"([\w-]+)"', match.group(1)))


# Directories never worth a basename index: somebody else's code
# (node_modules), the built site (dist/, #181), frozen history
# (archive/) and VCS/tooling internals.
BASENAME_SKIP = frozenset({
    "node_modules", "dist", "archive", ".git", ".wrangler", "__pycache__",
})


def known_basenames(repo=None):
    """Every real file's basename, anywhere in the tree.

    admin.html, form.js and worker.js are cited bare, with no
    directory, throughout DESIGN.md, OPERATIONS.md and README.md - an
    exact-relpath check alone would redden every one of them.
    """
    repo = REPO if repo is None else repo
    names = set()
    for _root, dirs, files in os.walk(repo):
        dirs[:] = [d for d in dirs if d not in BASENAME_SKIP]
        names.update(files)
    return names


# A sentence-ending mark followed by whitespace or the region's own
# end - NOT the bare nearest `.`, `!` or `?` has_subject() above uses,
# because this tree writes `server/worker.js's` and `dashboard.js`
# constantly, and a period inside a filename (immediately followed by a
# word character, never whitespace) is not a sentence end. Measured: the
# bare version split "...server/worker.js's real POST /snapshot handler
# stored, byte for byte. That route is deleted..." at "worker.js" itself,
# stranding the route on one side of its own "is gone" sentence and the
# allowed word on the other.
SENTENCE_END = re.compile(r"[.!?](?=\s|$)")


def sentence_around(flat, start, end):
    """The sentence containing `flat[start:end]`, crudely.

    Good enough for the one question this asks - does an allowed word
    sit in the same sentence as the name - without a second real
    sentence-boundary mechanism beside comment_regions()'s own.
    """
    before = -1
    for match in SENTENCE_END.finditer(flat, 0, start):
        before = match.start()
    after_match = SENTENCE_END.search(flat, end)
    after = after_match.start() if after_match else len(flat)
    return flat[before + 1:after]


def _region_candidates(flat):
    """[(start, end, kind, name)] for every identifier shape in one
    flattened region - a code comment region (unwrap()'s output) or a
    whole document's raw text, both flat strings with no code between
    two "sentences" to bridge.
    """
    out = []
    for match in CONST_BARE.finditer(flat):
        out.append((match.start(), match.end(), "constant", match.group(0)))
    for match in FUNC_CALL_BARE.finditer(flat):
        if PLURAL_SUFFIX.match(match.group(2)):
            continue
        if FINDING_LABEL.match(match.group(1)) and \
                FINDING_SUBPOINT.match(match.group(2)):
            continue
        out.append((match.start(), match.end(), "function", match.group(1)))
    for match in BARE_ROUTE.finditer(flat):
        out.append((match.start(), match.end(), "route", match.group(1)))
    for match in PATH_BARE.finditer(flat):
        out.append((match.start(), match.end(), "path", match.group(0)))
    return out


def _resolves(kind, name, functions, constants, segments, basenames, repo):
    if kind == "function":
        return name in functions or name in BUILTIN_CALLS
    if kind == "constant":
        if name in constants:
            return True
        # A SECTION HEADING CAPITALIZING A REAL MODULE'S NAME, not a
        # constant (0.9-M3-S17 fix wave 1, #422 review F4): this
        # tree's own ALL-CAPS docstring-heading style ("WHY THE EXIT
        # CODE IS PRIME_LOCK'S ALONE" for tools/prime_lock.py, "WHY THE
        # CITATION RULE IS THIS NARROW" for a rule this very file
        # names) writes a real module's snake_case name in caps
        # constantly, and CONST_BARE cannot tell that shape from a
        # real constant by looking at the underscored token alone -
        # `tools/session_open.py`'s PRIME_LOCK pin, measured before
        # this fix and deleted once it landed, is exactly this
        # class. Checked against known_basenames() the same way a path
        # resolves: the heading is not claiming a constant exists, it
        # is naming a file in the house style. An ordinary English
        # ALL-CAPS pair with no matching file (READ_ONLY, MC_DONALD)
        # still reds - this narrows on the measured module-heading
        # shape, not on English capitalization generally.
        lowered = name.lower()
        return any(lowered + ext in basenames
                   for ext in (".py", ".js", ".mjs"))
    if kind == "route":
        parts = name.split("/")
        segment = parts[1] if len(parts) > 1 else ""
        return segment in segments
    if kind == "path":
        # .claude/ is gitignored whole (.gitignore line 45): every
        # session's settings.json and hooks/*.py are real, local-machine
        # files this repository never tracks, so an os.walk() of the
        # checked-out tree can never confirm one - by design, not by
        # staleness.
        if name == ".claude" or name.startswith(".claude/"):
            return True
        if os.path.basename(name) in GITIGNORED_BASENAMES:
            return True
        if TEMPLATE_PATH.search(name):
            return True
        if re.match(r"^\.\w+(?:\.\w+)*$", name):
            # A bare suffix with no stem - ".test.py", ".test.mjs" - is a
            # NAMING PATTERN this tree's own registries discuss (the
            # PYTHON_SUITE_SUFFIX constant, an arm's own extension), never
            # a specific file; CITED's character class allows a match to
            # start on the leading dot precisely because a real path may
            # too ("../x.md" is not a shape this tree uses, but the class
            # cannot tell "started mid-token" from "genuinely begins with
            # a dot" without this rule).
            return True
        if os.path.isfile(os.path.join(repo, *name.split("/"))):
            return True
        return os.path.basename(name) in basenames
    return True


def dangling_findings(scan=None, docs=None, repo=None):
    """[(file, line, kind, name)] for every name that resolves nowhere.

    Two source shapes, one resolution pass: a source file's own comment
    regions (comments_only() + comment_regions() + unwrap(), exactly as
    citations() reads them) and an operative document's whole text
    (DOCS - there is no code to mask out of a .md file, so the "region"
    is the file). EXEMPT is honored for source files the same way every
    rule above honors it.
    """
    scan = SCAN if scan is None else scan
    docs = DOCS if docs is None else docs
    repo = REPO if repo is None else repo
    functions, constants = defined_names(repo=repo)
    segments = known_api_segments(repo=repo)
    basenames = known_basenames(repo=repo)

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
            kind_ = KIND[os.path.splitext(name)[1]]
            masked = comments_only(text, kind_)
            for start, stop in comment_regions(masked, text):
                flat, offsets = unwrap(masked, start, stop)
                for cstart, cend, kind, cname in _region_candidates(flat):
                    if kind == "path" and relpath.endswith("_suite.py"):
                        # A *_suite.py file's whole purpose is building
                        # synthetic fixture trees (tools/reaper_suite.py's
                        # own "shared/sentinel.txt" is one instance) - bare
                        # filenames in its comments are overwhelmingly
                        # invented fixture names, not real repository
                        # paths, the same reason ghost.txt is pinned
                        # rather than checked for NARRATIVE_PINS. A whole-
                        # file exclusion rather than a pin per fixture
                        # name: measured against the real tree, these
                        # suites invent new ones constantly, and pinning
                        # each would just be re-deriving this same rule
                        # one fixture at a time.
                        continue
                    if _resolves(kind, cname, functions, constants,
                                 segments, basenames, repo):
                        continue
                    if GONE.search(sentence_around(flat, cstart, cend)):
                        continue
                    at = offsets[cstart]
                    line = masked.count("\n", 0, at) + 1
                    out.append((relpath, line, kind, cname))

    for docname in docs:
        full = os.path.join(repo, docname)
        if not os.path.isfile(full):
            continue
        with open(full, encoding="utf-8") as handle:
            flat = handle.read()
        for cstart, cend, kind, cname in _region_candidates(flat):
            if _resolves(kind, cname, functions, constants, segments,
                         basenames, repo):
                continue
            if GONE.search(sentence_around(flat, cstart, cend)):
                continue
            line = flat.count("\n", 0, cstart) + 1
            out.append((docname, line, kind, cname))
    return sorted(out)


def _dangling_by_key(scan=None, docs=None, repo=None):
    """{(file, kind, name): [line]} - dangling_findings() grouped by key.

    Grouping done once here for both rules below to ask a COUNT
    question of it, the same reason broken_by_citation() groups
    citation_problems()/citation_pin_problems() before either one asks
    theirs.
    """
    out = {}
    for relpath, line, kind, name in dangling_findings(scan, docs, repo):
        out.setdefault((relpath, kind, name), []).append(line)
    return out


def dangling_problems(scan=None, docs=None, repo=None, pinned=None):
    """A problem per dangling name beyond the count pinned for it.

    Membership alone would say "every occurrence of this name in this
    file is forgiven forever" - and that is the escape fix wave 1 found
    (F1, #422 review): DANGLING_PINS was the one pin list in this file
    with no count, so a NEW comment, written today, naming an already-
    pinned dangling thing passed green (proven by mutation: appending
    one more `dashboard.js` mention to an already-pinned file left
    PROBLEMS reported at 0). A pin now covers the occurrences that were
    already there when it was written, never one added after - the
    same property CITATION_PINS enforces, for the same reason (that
    dict's own comment: "a comment written after them... is new work
    pointing at a section that does not exist").
    """
    pinned = DANGLING_PINS if pinned is None else pinned
    by_key = _dangling_by_key(scan, docs, repo)
    problems = []
    for key in sorted(by_key):
        lines = by_key[key]
        relpath, kind, name = key
        allowed = pinned[key][0] if key in pinned else 0
        if len(lines) <= allowed:
            continue
        if allowed:
            problems.append(
                "%s: %d line(s) name the %s %r and DANGLING_PINS covers "
                "%d of them (lines %s). One is new, naming a thing this "
                "pin was never written to cover: true it against the "
                "tree as it stands, or raise the count with a reason in "
                "the pull request. A pin covers the occurrences that "
                "were already here when it was written, never one "
                "added after"
                % (relpath, len(lines), kind, name, allowed,
                   ", ".join(str(line) for line in lines)))
        else:
            for line in lines:
                problems.append(
                    "%s:%d: names the %s %r, which does not exist in "
                    "the tree any more (no definition, route or file "
                    "found). If it is history, say so in the same "
                    "sentence - \"is gone\", \"replaced\", \"retired\", "
                    "\"deleted\" or \"renamed to\" - otherwise true the "
                    "comment against the tree as it stands"
                    % (relpath, line, kind, name))
    return problems


def dangling_pin_problems(scan=None, docs=None, repo=None, pinned=None):
    """A problem per DANGLING_PINS entry whose count is no longer true.

    Two ways an entry stops being true, the same two citation_pin_
    problems() checks for CITATION_PINS: the name resolved, was
    reworded, or was deleted, so nothing here needs a pin any more; or
    some of the pinned occurrences were trued and the number still
    dangling is lower than what is pinned. Either way the entry names
    its own correction rather than going stale silently.
    """
    pinned = DANGLING_PINS if pinned is None else pinned
    by_key = _dangling_by_key(scan, docs, repo)
    problems = []
    for key in sorted(pinned):
        count, _reason = pinned[key]
        relpath, kind, name = key
        actual = len(by_key.get(key, []))
        if actual == 0:
            problems.append(
                "DANGLING_PINS pins %s in %s (%s), and it is not a "
                "dangling name any more - resolved, reworded or deleted. "
                "Delete the entry; the list is a ratchet and only shrinks"
                % (name, relpath, kind))
        elif actual < count:
            problems.append(
                "DANGLING_PINS pins %d occurrence(s) of %s in %s (%s) "
                "and the number still dangling is %d. Lower the count "
                "to %d; the list is a ratchet and only shrinks"
                % (count, name, relpath, kind, actual, actual))
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
    out.extend(dangling_problems())
    out.extend(dangling_pin_problems())
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
          "text, every quotation of another file is still in it or "
          "pinned, and every named function, constant, route and file "
          "still exists or says so (%d files scanned, %d cross-file "
          "citation(s) checked, %d phrase occurrence(s), %d citation(s) "
          "pinned for the slice that rewrites their file, %d unquoted "
          "file mention(s) pinned, %d ticket citation(s) pinned, %d "
          "unanchored count claim(s) pinned and %d dangling-name "
          "exception(s) pinned)."
          % (len(scanned), len(all_citations()), sum(ALLOWLIST.values()),
             sum(CITATION_PINS.values()), sum(NARRATIVE_PINS.values()),
             sum(TICKET_PINS.values()), len(COUNT_PROPERTY_PINS),
             sum(count for count, _reason in DANGLING_PINS.values())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
