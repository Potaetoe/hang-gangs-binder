"""Contract checks for the comment ratchet.

`tools/check_comments.py` enforces the rule the owner set on 2026-08-08:
a code comment states why the code is the way it is, and what changed -
together with whatever triggered the change - lives in the commit
message, the pull request and the issue. AGENTS.md, "Code standards",
is the prose statement of that rule; this suite is what proves the
enforcement behind it is real.

Two halves, for the reason #34 paid for. The patterns are tested on
strings rather than on the files they happen to guard, because a
mutation exercises a *rule* and never the extractor that has to find a
comment before any rule can apply - and an extractor that finds no
comments at all reports a perfectly clean tree. Then the real tree is
tested, including the decisive pair: that the extractor reads real
comments, and that what it reads is exactly what the allowlist pins.

The ratchet is tested as a pure function over a found-set, so both
directions are covered without editing a real file: an occurrence that
is not pinned fails, and a pin that stops matching fails too. A list
that can only shrink is the whole design - cleanup rides the pull
requests that touch those files.

No framework, matching the suites beside it.
"""

import os
import sys

# tools/ is not a package and check_comments.py is a script, so the
# import has to be made reachable before it can be named. isort would
# hoist the import above the path insertion and break it, hence the
# explicit skip - the same shape as dev/check_web.test.py.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))

import check_comments  # noqa: I001


failures = 0
performed = 0

# Asserted at the end rather than only printed. Both sibling suites end
# with a hand-written total that nothing compares against, so a check
# that stops running - an early return, a renamed helper - still prints
# a confident "OK". Comparing the count is what makes the total mean
# something.
EXPECTED = 52


def check(label, condition):
    global failures, performed
    performed += 1
    if not condition:
        failures += 1
    print("pass " if condition else "FAIL ", label)


def labels(text, kind):
    return sorted({label for _line, label, _text in
                   check_comments.hits(text, kind)})


def clean(text, kind):
    return check_comments.hits(text, kind) == []


# ------------------------------------------------------------------ #
# The extractor. Comments only - code is not prose.                   #

check("a phrase in a // comment is caught",
      labels("// this used to be a two-column grid\n", "js")
      == ["used to"])

check("a phrase in a /* */ comment is caught",
      labels("/* it used to be defined inside the loop */\n", "js")
      == ["used to"])

# The failure that would make this whole check a decoration. apps/web
# ships two user-facing strings containing "no longer", and a scanner
# reading code would report the pages as offenders and be switched off.
check("the same phrase in a string literal is not caught",
      clean('const m = "This used to be true";\n', "js"))

check("a phrase in a CSS comment is caught",
      labels("/* carried over from the other project */\n", "css")
      == ["carried over from"])

check("CSS outside a comment is not read",
      clean('.a { content: "used to be"; }\n', "css"))

check("a phrase in an HTML comment is caught",
      labels("<!-- the JSON link used to be grey text -->\n", "html")
      == ["used to"])

# submit.html's page copy says "replacing the old one" to a member.
# Visible copy is the product, not commentary on the product.
check("HTML page copy is not read",
      clean("<p>a new entry is added, and it used to be</p>\n", "html"))

check("a phrase in a Python # comment is caught",
      labels("# it used to be defined inside the loop\n", "py")
      == ["used to"])

# tools/ carries its reasoning in docstrings, not in # comments -
# check_web.py's pinned occurrence is inside one. A scanner that read
# only "#" would find nothing there and call the file clean.
check("a phrase in a Python docstring is caught",
      labels('def f():\n    """It used to be inside the loop."""\n', "py")
      == ["used to"])

check("a Python single-quoted string is not read",
      clean('MESSAGE = "used to be"\n', "py"))

# A comment block is one comment however it is laid out. Both of these
# straddle a line break, and both are real shapes in this tree. Three
# words rather than two on purpose: "used to" completes on one line, so
# it would pass these without the phrase ever having been joined up.
check("a phrase split across a block comment's continuation is caught",
      labels("/*\n * it is carried over\n * from the other project\n */\n",
             "js")
      == ["carried over from"])

check("a phrase split across two line comments is caught",
      labels("// it is carried over\n// from the other project\n", "js")
      == ["carried over from"])

# The other side of that. Two comments with code between them are two
# comments, and bridging them would report a phrase nobody wrote.
check("code between two comments is not bridged",
      clean("// it is carried over\nrender();\n// from here\n", "js"))

# A regex literal is code, and this tree is full of them -
# server/worker.js alone holds `/\//g`. Read as a comment opener, the
# rest of the line becomes prose the file never contained.
check("a // inside a regex literal does not open a comment",
      clean("const r = /\\/\\/used to be/;\n", "js"))

check("a // inside a string does not open a comment",
      clean('const u = "https://example.test/used to be";\n', "js"))

check("the line number reported is the phrase's own",
      check_comments.hits("// nothing\n//\n// it used to be\n", "js")
      == [(3, "used to", "used to")])


# ------------------------------------------------------------------ #
# The phrases. Present tense is the rule, not past tense the offense.  #

# Every one of these is a real comment in this repository, trimmed to
# its clause. All six describe what the code does now; none narrates a
# change. They are pinned here because the seed list for this check
# included a bare "no longer", which matches all of them - and pinning
# six correct comments into an allowlist would teach the next cleanup
# pull request to break them. Widening the pattern back fails here,
# loudly, with this comment attached.
PRESENT_TENSE = [
    ("js", "// focus is left inside something that is no longer\n"
           "// there, and the next Tab starts from the top"),
    ("css", "/* one stat per row, since two no longer fit their\n"
            "   labels */"),
    ("js", "/* a shared point no longer identifies a line */"),
    ("py", "# it certifies a key it is no longer encrypting to"),
    ("js", "/* asserting on a document that can no longer exist */"),
    ("py", "# Keep the subject line no longer than 60 characters."),
]
check("present-tense prose containing 'no longer' stays clean",
      all(clean(text, kind) for kind, text in PRESENT_TENSE))

# The narrow half that is kept. A comment saying a thing is not used is
# describing a deletion that did not happen.
check("'no longer used' is caught",
      labels("// the third argument is no longer used\n", "js")
      == ["no longer used"])

# "used to be" alone would miss four of the offenders in this tree.
check("'used to' catches more than 'used to be'",
      labels("// the assertion used to live in the page suite\n", "js")
      == ["used to"])

# English gives "used to" a second reading with the same surface form,
# and apps/web/crypto.js is it: "The uncompressed point a JWK spells
# out as two coordinates. Used to check a key file against itself."
# That is the passive "employed to" - present tense, and correct.
# Running the check found it; a subject is what separates the two.
check("the passive 'used to' reading is not narration",
      clean("/* Two coordinates. Used to check a key file. */\n", "js"))

check("and it is the missing subject that does it, not the full stop",
      labels("/* Two coordinates. The check used to live here. */\n", "js")
      == ["used to"])

check("a phrase opening its own comment has no subject either",
      clean("<!-- Used to check a key file against itself -->\n", "html"))

for phrase, expected in [
    ("carried over from the other project", "carried over from"),
    ("originally specified in the redesign", "originally"),
    ("previously the loop rebuilt the table", "previously"),
    ("renamed from buildRow in the same pass", "renamed from"),
    ("moved from the page suite to the gate", "moved from"),
    ("this replaces the two-column grid", "this replaces"),
    ("libsodium was rejected because of its size", "was rejected because"),
]:
    check("%r is caught" % expected,
          labels("// " + phrase + "\n", "js") == [expected])

# The seed list is a list of history markers, and "the old X" is not
# one: this tree says "the old key" during rotation, "the old rows"
# when a table is rebuilt, "the previous snapshot" in a diff. Six
# runtime referents against one narrating comment is the wrong trade.
check("a runtime referent is not a history marker",
      clean("// decrypt with the old key, then the new one\n", "js"))


# ------------------------------------------------------------------ #
# The ratchet, as a pure function over a found-set.                    #

SCANNED = ["apps/web/theme.css", "apps/web/nav.js"]


def ratchet(found, allowlist):
    return check_comments.ratchet_problems(found, allowlist, SCANNED)


check("a clean tree with an empty allowlist has no problems",
      ratchet({}, {}) == [])

# The forward arm: anything new fails, and the message has to be
# actionable enough to fix without reading this file.
new = ratchet({("apps/web/nav.js", "used to"): [(46, "used to")]}, {})
check("an occurrence that is not pinned fails",
      len(new) == 1)
check("and the failure names the file, the line and the phrase",
      "apps/web/nav.js" in new[0] and ":46" in new[0]
      and "used to" in new[0])

check("a pinned occurrence is suppressed",
      ratchet({("apps/web/theme.css", "used to"): [(284, "used to")]},
              {("apps/web/theme.css", "used to"): 1}) == [])

# The pin is a count, not a license for the file. A second one in a
# file that already has one is exactly the new offense this exists to
# stop, and it is the case a line-number pin would have got right and a
# file-level pin would have missed.
second = ratchet(
    {("apps/web/theme.css", "used to"): [(284, "used to"),
                                         (900, "used to")]},
    {("apps/web/theme.css", "used to"): 1})
check("a second occurrence in an already-pinned file fails",
      len(second) == 1 and "284" in second[0] and "900" in second[0])

# The backward arm, and the reason the list cannot go stale.
gone = ratchet({}, {("apps/web/theme.css", "used to"): 1})
check("a pin that matches nothing fails",
      len(gone) == 1)
check("and it says to delete the entry",
      "delete" in gone[0].lower())

over = ratchet(
    {("apps/web/theme.css", "used to"): [(284, "used to")]},
    {("apps/web/theme.css", "used to"): 3})
check("a pin that over-counts fails and says what to lower it to",
      len(over) == 1 and "1" in over[0])

stale_file = ratchet({}, {("apps/web/deleted.js", "used to"): 1})
check("a pin naming a file outside the scan set fails",
      len(stale_file) == 1 and "apps/web/deleted.js" in stale_file[0])

stale_phrase = ratchet({}, {("apps/web/theme.css", "invented"): 1})
check("a pin naming a phrase no pattern produces fails",
      len(stale_phrase) == 1 and "invented" in stale_phrase[0])


# ------------------------------------------------------------------ #
# The real tree.                                                      #

found, scanned = check_comments.scan_tree()

check("the scan set is not empty",
      len(scanned) > 20)

check("every scanned directory the rule names is represented",
      all(any(rel.startswith(d + "/") for rel in scanned)
          for d in ("apps/web", "server", "dev", "tools")))

check("archive/ is never scanned",
      not any(rel.startswith("archive/") for rel in scanned))

# The decisive check, and the one that would notice this arm rotting.
# If the extractor simply found nothing in real files, every string
# check above would still pass and the tree check below would pass by
# reading nothing - a null result wearing a positive result's clothes.
#
# The needle is a phrase from the comment above `[hidden]`, which is
# the one comment in this stylesheet that cannot quietly go away:
# tools/check_web.py check 7 refuses to publish a stylesheet without
# that rule. A needle taken from any other comment is a needle the next
# cleanup pull request deletes, leaving this arm passing on prose
# nobody meant to keep.
THEME = open(os.path.join(check_comments.REPO, "apps", "web",
                          "theme.css"), encoding="utf-8").read()
check("the extractor reads real comments out of a real file",
      "weakest possible specificity" in
      check_comments.comments_only(THEME, "css").lower())

check("and a real file's code is not read as prose",
      "font-variant-numeric" not in
      check_comments.comments_only(THEME, "css"))

# apps/web/public.js tells a signed-out member their session is "no
# longer valid". It is the string this check must never report.
PUBLIC = open(os.path.join(check_comments.REPO, "apps", "web",
                           "public.js"), encoding="utf-8").read()
check("a real page's user-facing string is not counted",
      ("apps/web/public.js", "no longer used") not in found
      and check_comments.hits(PUBLIC, "js") == [])

check("the real tree's occurrences are exactly what is pinned",
      {key: len(places) for key, places in found.items()}
      == check_comments.ALLOWLIST)

check("so the gate passes on the tree as it stands",
      check_comments.problems() == [])

check("every pinned file is in the scan set",
      all(rel in scanned for rel, _label in check_comments.ALLOWLIST))

check("every pinned phrase is one a pattern produces",
      all(label in {name for name, _p, _why in check_comments.PHRASES}
          for _rel, label in check_comments.ALLOWLIST))

# The exemption is the hole in this check and it is deliberate: the
# file defining the phrases has to be allowed to name them, exactly as
# server/wrangler.toml is allowed to name DEV_LOGIN_SECRET in order to
# say it must never be set. Pinning it here is what stops the hole
# growing quietly by one file at a time.
check("the exemption is exactly the two self-referential files",
      check_comments.EXEMPT == frozenset({
          "tools/check_comments.py", "dev/check_comments.test.py"}))

check("and neither exempt file is scanned",
      not any(rel in check_comments.EXEMPT for rel in scanned))


if failures:
    print("\ncheck_comments.py FAILED %d of %d checks"
          % (failures, performed))
    sys.exit(1)
if performed != EXPECTED:
    print("\ncheck_comments.py ran %d checks, expected %d - a check "
          "stopped running, or one was added without updating EXPECTED"
          % (performed, EXPECTED))
    sys.exit(1)
print("\ncheck_comments.py OK - %d checks" % performed)
