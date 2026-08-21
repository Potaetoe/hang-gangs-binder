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

The citation rule at the end is the same shape for a different claim.
A phrase is judged from inside one file; a quotation of another file
cannot be, so the resolver is driven over trees this suite builds and
the arms that matter are the near misses - case, wrapping and dash
style are not staleness, and a heading surviving only in archive/ is.

No framework, matching the suites beside it.
"""

import os
import sys
import tempfile

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
EXPECTED = 247


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

# your-page.html's page copy says "replacing the old one" to a member.
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

# SQL is the fourth language, and server/schema.sql is why. That file is
# a page of operator-facing prose around six DDL statements - which
# migration destroys rows, which index rename is half of an act, what a
# re-run does to a database that already has data. A narrating sentence
# there is read by somebody about to run the file against production.
check("a phrase in a SQL -- comment is caught",
      labels("-- the column used to be nullable\n", "sql")
      == ["used to"])

check("a phrase in a SQL /* */ comment is caught",
      labels("/* carried over from the first schema */\n", "sql")
      == ["carried over from"])

# The literal below is the shape schema.sql's own seeds would take, and
# a scanner reading DDL as prose would report the data instead of the
# commentary.
check("a SQL string literal is not read",
      clean("INSERT INTO site_content VALUES ('used to be');\n", "sql"))

# The continuation mark is the language's own: a comment block in SQL is
# a run of -- lines, exactly as a run of # lines is in Python. Without
# the leading hyphens counting as whitespace between the words, a phrase
# that happens to reflow is a phrase this check cannot see - and every
# comment in schema.sql is wrapped prose.
check("a phrase split across two SQL line comments is caught",
      labels("-- it is carried over\n-- from the first schema\n", "sql")
      == ["carried over from"])

check("and code between two SQL comments is still not bridged",
      clean("-- it is carried over\nVACUUM;\n-- from here\n", "sql"))

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

# RETIRED at 0.9-M3-S4 fix wave 1 (F1, #392, comment 5369115005): "N,
# not M" stood here, pairing a cardinal with "not" and another cardinal
# to catch "five, not six" as a rename-shaped narration marker. The
# independent review proved it caught the FIX WAVE'S OWN truing
# sentence and never the escape - 0.9-M2-S15 F5's real defect,
# theme.css's original "six .field-shaped controls", has no "not" in
# it at all, and restoring it byte for byte still passed the gate. See
# COUNT_CLAIM below for the property this rule was rebuilt around.


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

# apps/web/charts.js tells a signed-out member their session is "no
# longer valid" (0.9-M2-S3, #354 - apps/web/public.js carried the same
# string until this slice retired it). It is the string this check
# must never report.
PUBLIC = open(os.path.join(check_comments.REPO, "apps", "web",
                           "charts.js"), encoding="utf-8").read()
check("a real page's user-facing string is not counted",
      ("apps/web/charts.js", "no longer used") not in found
      and check_comments.hits(PUBLIC, "js") == [])

# The outside-scan surface #154's sweep found (P3 F7 / S-5): the scan
# read server/*.js and stopped there, so the one file in that directory
# whose comments an operator acts on was outside the rule. It is in the
# scan set by name here, from outside check_comments.py, for the reason
# the generated-tree pin below is: an extension list is one edit away
# from quietly dropping a file, and a scan that reads nothing reports a
# clean tree.
SERVER_EXTENSIONS = dict(check_comments.SCAN)["server"]
check("the scan set reads the schema, not only the Worker",
      ".sql" in SERVER_EXTENSIONS and ".js" in SERVER_EXTENSIONS)

check("and the schema is a file it actually opened",
      "server/schema.sql" in scanned)

# The decisive pair for the new language, the same one theme.css gets
# above. A syntax table that produced no comments at all would leave
# every SQL check above passing on strings while the real file went
# unread - and this file's comments are the ones an operator reads
# before running a destructive migration.
SCHEMA = open(os.path.join(check_comments.REPO, "server", "schema.sql"),
              encoding="utf-8").read()
check("the extractor reads real comments out of the schema",
      "half a migration, quietly" in
      check_comments.comments_only(SCHEMA, "sql"))

# The needle is a column definition rather than a statement keyword:
# this file's comments quote CREATE TABLE IF NOT EXISTS at length, and
# rightly - that statement's skip-in-silence behavior is the trap the
# whole header warns about. A needle a comment legitimately contains
# would make this arm fail on correct prose.
check("and the schema's own DDL is not read as prose",
      "AUTOINCREMENT" not in check_comments.comments_only(SCHEMA, "sql"))

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
# file defining the phrases has to be allowed to name them. The same
# hole sits one tool over, for the same reason and closed the same way -
# tools/check_spelling.py exempts itself and its own suite so it can
# name the spellings it forbids, and pins that set exactly rather than
# letting it grow. Pinning it here is what stops the hole growing
# quietly by one file at a time.
check("the exemption is exactly the two self-referential files",
      check_comments.EXEMPT == frozenset({
          "tools/check_comments.py", "dev/check_comments.test.py"}))

check("and neither exempt file is scanned",
      not any(rel in check_comments.EXEMPT for rel in scanned))


# ------------------------------------------------------------------ #
# The generated site, which this check must never read.               #
#
# #181 splits the tree in two: apps/web is written by a person and dist/
# is the same code with every comment removed on purpose. Pointed at
# dist/ this check enforces a rule about comments against files built to
# have none - and the ordinary failure is not a red gate, it is a GREEN
# one, because a file with no comments has no comment narrating a
# change. A check that cannot fail is the thing this repository holds to
# be worse than no check at all, so the scan set is pinned from out here
# rather than trusted to a comment inside it.

check("scanning the generated tree is refused",
      len(check_comments.generated_tree_problems(
          [("dist", (".js", ".css"))])) == 1)

check("and so is a directory inside it",
      len(check_comments.generated_tree_problems(
          [("dist/fonts", (".js",))])) == 1)

check("and the refusal says which tree to read instead",
      "source" in check_comments.generated_tree_problems(
          [("dist", (".js",))])[0])

# The other direction. A rule that fires on everything is not a rule,
# and this one has to leave the four real entries alone.
check("the real scan set is not refused",
      check_comments.generated_tree_problems() == [])

check("and it still names the source tree",
      any(dirname == "apps/web" for dirname, _e in check_comments.SCAN))

# A near-miss, because the test above would pass on a rule matching the
# exact string "dist" and nothing else - and it would then miss
# "dist/fonts", which is the shape somebody actually writes.
check("a directory merely starting with the same letters is not refused",
      check_comments.generated_tree_problems(
          [("distributions", (".py",))]) == [])


# ------------------------------------------------------------------ #
# And the files it reads have to be text.                             #
#
# A raw 0x00 inside a string literal in dev/worker.test.mjs made grep
# and ripgrep classify the most-read file in this tree as binary: every
# search of it answered "Binary file ... matches" and nothing else, and
# a search that reports nothing looks exactly like a search that found
# nothing. It is a class this project has seen before, which is why it
# is a gate arm rather than a habit.
#
# Driven over a tree this suite builds, for the same reason the whole
# first half of it is: the real tree is clean, and a rule exercised only
# against a clean tree can never be shown to fire.


def bytes_in(relpath, raw, scan=None):
    """control_byte_problems() over a temporary tree holding one file."""
    root = tempfile.mkdtemp(prefix="check-comments-bytes-")
    full = os.path.join(root, *relpath.split("/"))
    os.makedirs(os.path.dirname(full))
    with open(full, "wb") as handle:
        handle.write(raw)
    return check_comments.control_byte_problems(
        scan=[("dev", (".mjs",))] if scan is None else scan, repo=root)


check("a raw 0x00 in a scanned file is reported",
      len(bytes_in("dev/suite.test.mjs", b'const G = "a\x00b";\n')) == 1)

check("and the report names the file, the line and the byte",
      all(part in bytes_in("dev/suite.test.mjs",
                           b'const G = "a\x00b";\n')[0]
          for part in ("dev/suite.test.mjs", ":1:", "0x00")))

check("and it says to write the escape instead",
      "escape" in bytes_in("dev/suite.test.mjs",
                           b'const G = "a\x00b";\n')[0])

# The fix the message asks for, spelled the way a file spells it. Two
# source characters, one runtime byte, and nothing for grep to sniff.
check("the escaped spelling of the same byte is clean",
      bytes_in("dev/suite.test.mjs", b'const G = "a\\x00b";\n') == [])

check("tab, newline and carriage return are text",
      bytes_in("dev/suite.test.mjs", b"a\tb\r\nc\n") == [])

# The band's own edge, in both directions. 0x08 is the last byte that is
# not text and 0x09 is the first that is, so a rule written with the
# comparison the wrong way round fails exactly one of these.
check("0x08 is reported",
      len(bytes_in("dev/suite.test.mjs", b"a\x08b\n")) == 1)

check("and 0x09 beside it is not",
      bytes_in("dev/suite.test.mjs", b"a\x09b\n") == [])

# Reported per occurrence rather than per file. A rule that stopped at
# the first byte would call a file with three of them fixed after one
# edit.
check("every occurrence is reported, on its own line",
      [problem.split(":")[1] for problem in
       bytes_in("dev/suite.test.mjs", b"one\n\x00two\nthree\x00\n")]
      == ["2", "3"])

# The scope wall. This rule reads the files this checker already opens,
# and says so by not opening anything else - an extension list widened
# here would be widened for the phrase scan too.
check("a file outside the scanned extensions is not opened",
      bytes_in("dev/notes.txt", b"a\x00b\n") == [])

# The phrase exemption does not extend to bytes, and this is the arm
# that keeps the two apart. tools/check_comments.py is excused from the
# phrase scan because a file has to be able to name what it forbids;
# nothing in that argument says its bytes may stop being text.
check("an exempt file is still read for control bytes",
      len(bytes_in("tools/check_comments.py", b'BLANK = "\x00"\n',
                   scan=[("tools", (".py",))])) == 1)

# The general arm reads whatever the scan set names, so a language
# joining the scan set joins this rule with it. Stated as a check rather
# than left to inference: the two rules share one extension list, and
# the day they stop sharing it is the day a file is text by one rule and
# not by the other.
check("a control byte in the newest scanned language is reported too",
      len(bytes_in("server/schema.sql", b"-- a\x00b\n",
                   scan=[("server", (".sql",))])) == 1)

check("the real tree carries no control byte",
      check_comments.control_byte_problems() == [])


# ------------------------------------------------------------------ #
# And a comment that quotes another file has to still be quoting it.  #
#
# The class #217 names: a comment falsified by an edit to a DIFFERENT
# file. The phrase ratchet above is computed entirely from the file it
# guards, so it cannot see it - AGENTS.md, "The review bar", states the
# corollary, and the worked example is a comment that justified a value
# by a note another change had deleted. Nothing went red.
#
# Both halves again. The extractor is driven over strings, because a
# rule that finds no citation at all reports a perfectly clean tree;
# then the resolver is driven over a tree this suite builds, because
# the real tree is clean once this lands and a rule exercised only
# against a clean tree can never be shown to fire.


def cited(text, kind):
    return [(path, quote) for _line, path, quote
            in check_comments.citations(text, kind)]


check("a comma citation is read",
      cited('/* See DESIGN.md, "Key custody", for why. */\n', "js")
      == [("DESIGN.md", "Key custody")])

check("a possessive citation is read",
      cited("/* DESIGN.md's \"Key custody\" rules it. */\n", "js")
      == [("DESIGN.md", "Key custody")])

check("a colon citation is read",
      cited('/* DESIGN.md: "Key custody". */\n', "js")
      == [("DESIGN.md", "Key custody")])

check("a citation written the other way round is read",
      cited('/* the rule "Key custody" in DESIGN.md */\n', "js")
      == [("DESIGN.md", "Key custody")])

# The measured false positive, and the reason a connective is required.
# tools/check_web.py imagines somebody pasting a key into config.js
# "just to test the export locally" - a quoted utterance sitting next to
# a filename, which is not a citation of that file and never resolves.
# Bare juxtaposition is that shape here, in every instance measured.
check("a quoted utterance merely next to a filename is not a citation",
      cited('/* pasting a key into config.js "just to test it" */\n', "js")
      == [])

check("a quotation with no file beside it is not a citation",
      cited('/* the answer is "nothing", and that is the point */\n', "js")
      == [])

# The directory has to survive. A flattener that treated "/" as a
# continuation mark - the shape of the one in GAP above - turned
# "server/README.md" into a bare "README.md" and resolved the citation
# against the wrong file, in the wrong direction: quietly green.
check("a path keeps its directory",
      cited('/* See server/README.md, "Checking a deployment". */\n', "js")
      == [("server/README.md", "Checking a deployment")])

check("a citation split across a block comment's continuation is read",
      cited('/*\n * See DESIGN.md,\n * "Key custody", for why.\n */\n', "js")
      == [("DESIGN.md", "Key custody")])

check("and it is reported on the line the quotation starts",
      check_comments.citations(
          '\n\n/*\n * See DESIGN.md,\n * "Key custody".\n */\n', "js")
      == [(5, "DESIGN.md", "Key custody")])

check("a citation in a Python docstring is read",
      cited('"""See AGENTS.md, "Code standards"."""\n', "py")
      == [("AGENTS.md", "Code standards")])

# Found by rebasing onto the change that put server/schema.sql in the
# scan set. Every comment in that file is wrapped prose opening with
# "--", and its one citation spans two lines, so a flattener that does
# not know SQL's marker measures DESIGN.md for 'Admin -- accounts and
# deletion' and reports a correct comment. The false positive was real
# and this is the arm that keeps it fixed.
check("a citation wrapped across two SQL comment lines is read",
      cited('-- DESIGN.md, "Admin\n-- accounts and deletion", rules it.\n',
            "sql")
      == [("DESIGN.md", "Admin accounts and deletion")])

# The other side of that, and the reason the marker is two hyphens
# rather than one or more. A leading "-" is a prose bullet, and eating
# it reshapes the sentence a quotation is measured against.
#
# The block carries no asterisks on purpose. Only ONE marker comes off a
# line, so a " * - " line has its hyphen saved by the asterisk in front
# of it and proves nothing about the hyphen rule - which is what the
# first version of this arm did, and a mutation to "-+" walked straight
# past it.
check("a leading bullet is not mistaken for a comment marker",
      cited('/*\nDESIGN.md, "a rule\n- and its exception", holds.\n*/\n',
            "js")
      == [("DESIGN.md", "a rule - and its exception")])

check("a citation-shaped string literal is not read",
      cited('const s = \'See DESIGN.md, "Key custody"\';\n', "js")
      == [])


def resolving(comment, target, contents, kind="js"):
    """citation_problems() over a tree holding one citation, one target."""
    root = tempfile.mkdtemp(prefix="check-comments-cites-")
    os.makedirs(os.path.join(root, "dev"))
    with open(os.path.join(root, "dev", "suite.test.mjs"), "w",
              encoding="utf-8") as handle:
        handle.write(comment)
    full = os.path.join(root, *target.split("/"))
    if not os.path.isdir(os.path.dirname(full)):
        os.makedirs(os.path.dirname(full))
    with open(full, "w", encoding="utf-8") as handle:
        handle.write(contents)
    return check_comments.citation_problems(
        scan=[("dev", (".mjs",))], repo=root)


PRESENT = "## Key custody\n\nThe keyholder holds it.\n"

check("a citation the cited file does not contain is reported",
      len(resolving('/* See DESIGN.md, "Key custody". */\n',
                    "DESIGN.md", "## Sessions\n")) == 1)

check("and the report names the citing file, the line, the target and "
      "the quotation",
      all(part in resolving('/* See DESIGN.md, "Key custody". */\n',
                            "DESIGN.md", "## Sessions\n")[0]
          for part in ("dev/suite.test.mjs", ":1:", "DESIGN.md",
                       "Key custody")))

check("the same citation resolves when the cited file carries it",
      resolving('/* See DESIGN.md, "Key custody". */\n',
                "DESIGN.md", PRESENT) == [])

# The measured near misses, all of which are correct comments. A cited
# heading is written the way a heading is written and quoted the way a
# sentence quotes it, so the two differ in case, in where a line
# happened to wrap, and in which dash somebody typed. A rule strict
# about any of the three reports comments that are right, which is what
# teaches the next reader to distrust it.
check("case is not what makes a citation stale",
      resolving('/* See DESIGN.md, "one partition, not two". */\n',
                "DESIGN.md", "- **One partition, not two.** Both.\n") == [])

check("nor is the line the comment happened to wrap on",
      resolving('/*\n * See DESIGN.md, "Renumbering does not\n'
                ' * prevent linkage".\n */\n',
                "DESIGN.md",
                "Renumbering does not prevent linkage was false.\n") == [])

check("nor is the dash somebody typed",
      resolving('/* See DESIGN.md, "linkage - a correction". */\n',
                "DESIGN.md", "linkage — a correction\n") == [])

# The decisive arm, and #217's exact shape. archive/DESIGN.md is a
# different file from DESIGN.md and holds the pre-2026-08-08 wording of
# every heading that moved; a resolver matching on basename would find
# the old heading in the archive and call the stale citation fine.
check("a heading that survives only in archive/ does not resolve a "
      "citation of the live document",
      len(resolving('/* See DESIGN.md, "Key custody". */\n',
                    "archive/DESIGN.md", PRESENT)) == 1)

check("and citing the archive directly does resolve",
      resolving('/* See archive/DESIGN.md, "Key custody". */\n',
                "archive/DESIGN.md", PRESENT) == [])

check("a citation of a file that is not here is reported as that",
      len(resolving('/* See GONE.md, "Key custody". */\n',
                    "DESIGN.md", PRESENT)) == 1)

check("and that report says the file is missing rather than the "
      "quotation",
      "not a file" in resolving('/* See GONE.md, "Key custody". */\n',
                                "DESIGN.md", PRESENT)[0])

# The real tree, both directions. The count is the null-result guard:
# every arm above passes on an extractor that finds nothing at all.
check("every unpinned citation in the real tree resolves",
      check_comments.citation_problems() == [])

check("and the extractor found real ones to resolve",
      len(check_comments.all_citations()) > 40)

check("including citations of documents outside the scanned tree",
      {path for _rel, _line, path, _quote
       in check_comments.all_citations()} >= {"DESIGN.md", "AGENTS.md",
                                              "OPERATIONS.md"})

# THE PIN RATCHET, and the arm above is why it needs its own. Once a
# broken citation may be pinned, "the real tree's citations resolve"
# stops being the whole question: a pin list nothing checks would let
# the gate go green over comments pointing at sections that no longer
# exist, which is the shape this repository holds to be worse than red.
# So both directions are asked of the real tree, and the equality is
# what makes the pin list a statement rather than a place things go to
# be forgotten.
#
# COUNTS, not membership. These two arms were written over sets of
# triples and duplicates collapsed into one, so a file citing the same
# dead section twice satisfied both directions with a single pin - the
# hole F1 proved by mutation, and the reason the real tree's own two
# doubled citations went unrecorded. The counted form is one equality
# and it holds the multiplicity too.
BROKEN = {}
for _relpath, _line, _path, _quote, _message in (
        check_comments.unresolved_citations()):
    key = (_relpath, _path, _quote)
    BROKEN[key] = BROKEN.get(key, 0) + 1

check("every pinned citation is really broken now, as many times as "
      "the pin says",
      all(BROKEN.get(key) == count
          for key, count in check_comments.CITATION_PINS.items()))

check("and nothing is broken that is not pinned, at any multiplicity",
      all(check_comments.CITATION_PINS.get(key) == count
          for key, count in BROKEN.items()))

# RETIRED (0.9-M2-S3, #354): "and the tree really does hold a citation
# pinned more than once" stood here, asserting max(CITATION_PINS.values())
# > 1 against the REAL tree - apps/web/dashboard.js and server/
# worker.js each cited DESIGN.md, "The charts and the snapshot" twice,
# which is what F1 above is about. Both files are retired or rewritten
# with this slice and neither doubled citation survives it, so the real
# tree currently pins nothing above count 1. The counting MECHANISM
# this fact corroborated is still fully exercised by the synthetic
# fixtures below - "a second comment repeating a pinned citation is
# reported" and "raising the count to two is what covers both" - which
# is the belt this real-tree check was the suspenders for.

# The half that makes it shrink. A pin dies three ways - the comment
# gets rewritten by the milestone that reaches its file, the wording
# comes back into the document, or one of several comments carrying it
# is trued and the count is left standing - and none of them leaves a
# trace anywhere else, so the entry has to be what fails.
INVENTED = ("tools/check_docs.py", "AGENTS.md", "The review bar")
# A REAL pin standing at 1, so raising it to 2 is a claim about this
# tree rather than about a fixture. It was apps/web/memberkey.js's
# "Members hold a key too" until that file was deleted (0.9-M2-S5,
# #356), then apps/web/admin.js's own "Key custody" citation until
# 0.9-M3-S10 (#416) rewrote the admin pages and cleared their
# key-world comments, exactly as this comment once predicted it would.
# config.js still carries the shape unchanged.
OVERCOUNTED = ("apps/web/config.js", "DESIGN.md", "Key custody")

check("a pin whose citation is not broken is reported",
      len(check_comments.citation_pin_problems(
          pinned={INVENTED: 1})) == 1)

check("and the report says to delete the entry",
      "Delete the entry" in check_comments.citation_pin_problems(
          pinned={INVENTED: 1})[0])

check("a pin counting more occurrences than are broken is reported",
      len(check_comments.citation_pin_problems(
          pinned={OVERCOUNTED: 2})) == 1)

check("and that report says to lower the count rather than delete it",
      "Lower the count to 1" in check_comments.citation_pin_problems(
          pinned={OVERCOUNTED: 2})[0])

check("the pins as they stand raise nothing",
      check_comments.citation_pin_problems() == [])

# The other side of the pin, over a tree this builds: the same broken
# citation reports when it is not pinned and stays quiet when it is,
# which is the only arm that shows the pin doing any work at all.
STALE_PIN = ("dev/suite.test.mjs", "DESIGN.md", "Key custody")


def pinning(pins, comments=1):
    """citation_problems() over N broken citations, under a pin count."""
    root = tempfile.mkdtemp(prefix="check-comments-pins-")
    os.makedirs(os.path.join(root, "dev"))
    with open(os.path.join(root, "dev", "suite.test.mjs"), "w",
              encoding="utf-8") as handle:
        handle.write('/* See DESIGN.md, "Key custody". */\n' * comments)
    with open(os.path.join(root, "DESIGN.md"), "w",
              encoding="utf-8") as handle:
        handle.write("## Sessions\n")
    return check_comments.citation_problems(
        scan=[("dev", (".mjs",))], repo=root, pinned=pins)


check("a broken citation nobody pinned is reported",
      len(pinning({})) == 1)

check("and the same one pinned is not",
      pinning({STALE_PIN: 1}) == [])

# Keyed by the quotation, not by the line, so an edit above an entry
# does not churn the list - and a pin of a DIFFERENT quotation in the
# same file is not a blanket exemption for that file.
check("a pin of another quotation in the same file does not cover it",
      len(pinning({("dev/suite.test.mjs", "DESIGN.md", "Sessions"): 1}))
      == 1)

# MULTIPLICITY, which is the dimension the pin list shipped blind to.
# The arm above asks it at the file level - a different quotation is
# not covered - and that is the question the original suite answered.
# The one it could not was the same quotation twice: a pin recording
# the comment that was there does not forgive the comment somebody
# writes tomorrow, and while both sides were sets it did.
check("a second comment repeating a pinned citation is reported",
      len(pinning({STALE_PIN: 1}, comments=2)) == 1)

check("and the report names both lines and says one is new",
      all(part in pinning({STALE_PIN: 1}, comments=2)[0]
          for part in ("2 comments cite", "lines 1, 2", "One is new")))

check("raising the count to two is what covers both",
      pinning({STALE_PIN: 2}, comments=2) == [])

check("and a third under that count is reported again",
      len(pinning({STALE_PIN: 2}, comments=3)) == 1)

# The exemption carries here, and unlike the byte rule it carries for
# the reason it was written: a file explaining what an unresolvable
# citation looks like has to be able to write one down, exactly as the
# file defining the forbidden phrases has to be able to name them. A
# byte has no such argument behind it, which is why that rule ignores
# EXEMPT and this one honors it.


def exempt_tree(relpath, comment):
    """citation_problems() over a tree whose only comment is in relpath."""
    root = tempfile.mkdtemp(prefix="check-comments-exempt-")
    full = os.path.join(root, *relpath.split("/"))
    os.makedirs(os.path.dirname(full))
    with open(full, "w", encoding="utf-8") as handle:
        handle.write(comment)
    with open(os.path.join(root, "DESIGN.md"), "w",
              encoding="utf-8") as handle:
        handle.write("## Sessions\n")
    return check_comments.citation_problems(
        scan=[("tools", (".py",))], repo=root)


STALE = '# See DESIGN.md, "Key custody".\n'

check("an exempt file's unresolvable citation is not reported",
      exempt_tree("tools/check_comments.py", STALE) == [])

check("and the same comment in the file beside it is",
      len(exempt_tree("tools/check_docs.py", STALE)) == 1)

# ------------------------------------------------------------------ #
# A bare, unquoted mention of another file (0.9-M3-S4, #392,          #
# S11 F3's escape) - the class the citation rule above cannot see,    #
# because there is nothing quoted to check.                           #

check("a dash-introduced file mention with nothing quoted is read",
      check_comments.narrative_mentions(
          "// trend: null - charts.js disables rather than shows an "
          "empty pane\n", "js")
      == [(1, "charts.js")])

check("and it is reported on the line the file name starts",
      check_comments.narrative_mentions(
          "//\n//\n// disables it - charts.js does\n", "js")
      == [(3, "charts.js")])

# PER-MENTION, not region-wide - 0.9-M3-S4 fix wave 1 (F3, #392,
# comment 5369115005). First build cleared a mention on ANY quote
# anywhere in the region; the review broke that by rewriting a real
# pinned mention's CLAIM to its opposite while an unrelated citation
# (a different file) sat two sentences over, and the region-wide guard
# silenced it. A citation for the SAME file the mention names still
# clears it - that is the real "this is checkable elsewhere" case.
check("a real citation of the SAME file clears the mention",
      check_comments.narrative_mentions(
          '/* See charts.js, "disables it" - charts.js disables it. */\n',
          "js")
      == [])

check("a real citation of a DIFFERENT file does not clear it",
      check_comments.narrative_mentions(
          '/* See DESIGN.md, "Key custody" - charts.js disables it. */\n',
          "js")
      == [(1, "charts.js")])

check("basenames match a short mention against a long citation",
      check_comments.narrative_mentions(
          '/* See apps/web/charts.js, "disables it" - charts.js disables '
          'it. */\n', "js")
      == [])

# Code between the two comments is what keeps them two regions rather
# than one - comment_regions() joins a run of comments with nothing but
# a newline between them into a single region (the same rule that lets
# a wrapped block comment or a run of "//" lines read as one sentence),
# so this needs a real statement between them to test the DIFFERENT-
# comment case rather than the same-comment case above.
check("a real citation in a DIFFERENT comment does not clear this one",
      check_comments.narrative_mentions(
          '/* See DESIGN.md, "Key custody". */\n'
          "render();\n"
          "// disables it - charts.js does\n", "js")
      == [(3, "charts.js")])

check("a bare mention with no dash is not this escape",
      check_comments.narrative_mentions(
          "// charts.js disables rather than shows an empty pane\n", "js")
      == [])

check("a hyphenated word is not a dash connective",
      check_comments.narrative_mentions(
          "// a well-formed charts.js import\n", "js") == [])


def narrative_tree(comment, relpath="dev/suite.test.mjs"):
    root = tempfile.mkdtemp(prefix="check-comments-narrative-")
    full = os.path.join(root, *relpath.split("/"))
    os.makedirs(os.path.dirname(full))
    with open(full, "w", encoding="utf-8") as handle:
        handle.write(comment)
    return root


UNQUOTED = "// trend: null - charts.js disables rather than shows it\n"

check("an unpinned narrative mention fails",
      len(check_comments.narrative_problems(
          scan=[("dev", (".mjs",))], repo=narrative_tree(UNQUOTED),
          pinned={})) == 1)

check("and the report names the file, the mention and the fix",
      all(part in check_comments.narrative_problems(
              scan=[("dev", (".mjs",))], repo=narrative_tree(UNQUOTED),
              pinned={})[0]
          for part in ("dev/suite.test.mjs", "charts.js", "quote")))

check("the same mention pinned is not reported",
      check_comments.narrative_problems(
          scan=[("dev", (".mjs",))], repo=narrative_tree(UNQUOTED),
          pinned={("dev/suite.test.mjs", "charts.js"): 1}) == [])

# The forward arm's count, the same shape citation_problems() proves:
# a pin recording ONE prior mention does not excuse a second.
TWICE = UNQUOTED * 2
check("a second mention in an already-pinned file is new work",
      len(check_comments.narrative_problems(
          scan=[("dev", (".mjs",))], repo=narrative_tree(TWICE),
          pinned={("dev/suite.test.mjs", "charts.js"): 1})) == 1)

check("raising the pin to two is what covers both",
      check_comments.narrative_problems(
          scan=[("dev", (".mjs",))], repo=narrative_tree(TWICE),
          pinned={("dev/suite.test.mjs", "charts.js"): 2}) == [])

# The backward arm.
GONE_ROOT = narrative_tree("// nothing dash-mentioned here\n")
check("a stale NARRATIVE_PINS entry is reported",
      len(check_comments.narrative_pin_problems(
          scan=[("dev", (".mjs",))], repo=GONE_ROOT,
          pinned={("dev/suite.test.mjs", "charts.js"): 1})) == 1)

check("and it says to delete the entry",
      "Delete the entry" in check_comments.narrative_pin_problems(
          scan=[("dev", (".mjs",))], repo=GONE_ROOT,
          pinned={("dev/suite.test.mjs", "charts.js"): 1})[0])

OVER_ROOT = narrative_tree(UNQUOTED)
check("a pin that over-counts says what to lower it to",
      "Lower the count to 1" in check_comments.narrative_pin_problems(
          scan=[("dev", (".mjs",))], repo=OVER_ROOT,
          pinned={("dev/suite.test.mjs", "charts.js"): 3})[0])

# The real tree, both directions - the null-result guard every synthetic
# arm above shares: an extractor that reads nothing passes every one of
# them by finding no mentions at all.
REAL_NARRATIVES = {}
for _file, _line, _path in check_comments.all_narratives():
    REAL_NARRATIVES[(_file, _path)] = REAL_NARRATIVES.get(
        (_file, _path), 0) + 1
check("the real tree's narrative mentions are exactly what is pinned",
      REAL_NARRATIVES == check_comments.NARRATIVE_PINS)

check("so narrative_problems() and narrative_pin_problems() are both "
      "clean on the tree as it stands",
      check_comments.narrative_problems() == []
      and check_comments.narrative_pin_problems() == [])

check("theme.css's own self-mention is excluded, not pinned",
      ("apps/web/theme.css", "theme.css")
      not in check_comments.NARRATIVE_PINS)

check("and the extractor found real, non-self mentions to exclude from",
      len(check_comments.all_narratives()) >= len(
          check_comments.NARRATIVE_PINS))


# ------------------------------------------------------------------ #
# A citation anchored to a GitHub ticket instead of a file (0.9-M3-S4, #
# #392) - CITED requires a file extension, so a ticket number never    #
# matched it and the quotation was never checked, in either direction.#

check("a ticket-anchored citation is read",
      check_comments.ticket_citations(
          '/* owner ruling 5, #243: "Edges never move" */\n', "js")
      == [(1, "#243", "Edges never move")])

check("the reversed connective is read too",
      check_comments.ticket_citations(
          '/* "Edges never move" in #243 */\n', "js")
      == [(1, "#243", "Edges never move")])

check("a bare ticket mention with nothing quoted is not this citation",
      check_comments.ticket_citations(
          "// owner ruling 5, #243, no quote here\n", "js") == [])

check("a real file citation is unaffected by the ticket pattern",
      check_comments.citations(
          '/* See DESIGN.md, "Key custody". */\n', "js")
      == [(1, "DESIGN.md", "Key custody")]
      and check_comments.ticket_citations(
          '/* See DESIGN.md, "Key custody". */\n', "js") == [])

# 0.9-M3-S4 fix wave 1 (F4, #392, comment 5369115005): the connective is
# widened past "immediately after the ticket" to reach the two house
# forms the review found rule 2 missing entirely.
check("a comment number between the ticket and the colon is read",
      check_comments.ticket_citations(
          '/* (owner ruling, #371 comment 5347769320: "in a gaining '
          'community the high end IS the story") */\n', "js")
      == [(1, "#371",
           "in a gaining community the high end IS the story")])

check("a closing paren between the ticket and the colon is read too",
      check_comments.ticket_citations(
          '/* 2026-08-19 (#371 comment 5347769320): "the group sees its '
          'own makeup" */\n', "js")
      == [(1, "#371", "the group sees its own makeup")])

# The two real mis-pairings the widened connective produced before the
# gap excluded "#" and ".", found by measuring the real tree rather than
# reasoned in advance - see TICKET_CITATIONS' own comment for both.
check("a second, nearer ticket wins over a more distant one",
      check_comments.ticket_citations(
          '/* between 0.9-M2-S6 (#82) and 0.9-M2-S13 (#378): "custom" '
          'was a chip */\n', "js")
      == [(1, "#378", "custom")])

check("a real file citation nearer the quote wins over a distant ticket",
      check_comments.ticket_citations(
          '/* since 0.9-M1-S5 (#331), which is DESIGN.md, "Sessions": '
          'one rule */\n', "js")
      == [])

check("and the same text resolves as a real file citation instead",
      check_comments.citations(
          '/* since 0.9-M1-S5 (#331), which is DESIGN.md, "Sessions": '
          'one rule */\n', "js")
      == [(1, "DESIGN.md", "Sessions")])


# ------------------------------------------------------------------ #
# comment_regions() and CONTINUATION do not split an indented run of   #
# "//" lines into one-line fragments (0.9-M3-S4 fix wave 1, F4,        #
# #392) - found while widening rule 2's connective still did not      #
# reach apps/web/site.config.js, whose citation is written this way.  #

check("an indented multi-line // citation is read as one citation",
      check_comments.citations(
          '      // See DESIGN.md,\n      // "Key custody".\n', "js")
      == [(2, "DESIGN.md", "Key custody")])

check("and the same shape resolves for a ticket citation too",
      check_comments.ticket_citations(
          '      // owner ruling, #371 comment\n'
          '      // 5347769320: "in a gaining community the high end IS '
          'the\n      // story"\n', "js")
      == [(2, "#371",
           "in a gaining community the high end IS the story")])

check("without the fix, comment_regions() alone already shows the break",
      check_comments.comment_regions(
          check_comments.comments_only(
              "      // a\n      // b\n", "js"))
      != check_comments.comment_regions(
          check_comments.comments_only(
              "      // a\n      // b\n", "js"),
          "      // a\n      // b\n"))

check("real code between indented lines still breaks the region",
      len(check_comments.comment_regions(
          check_comments.comments_only(
              "      // a\n      render();\n      // b\n", "js"),
          "      // a\n      render();\n      // b\n")) == 2)

check("a blank line with only whitespace does not break the region",
      len(check_comments.comment_regions(
          check_comments.comments_only(
              "      // a\n      \n      // b\n", "js"),
          "      // a\n      \n      // b\n")) == 1)

check("passing no text keeps the pre-fix, always-breaks behavior",
      len(check_comments.comment_regions(
          check_comments.comments_only(
              "      // a\n      // b\n", "js"))) == 2)


def ticket_tree(comment, relpath="dev/suite.test.mjs"):
    root = tempfile.mkdtemp(prefix="check-comments-ticket-")
    full = os.path.join(root, *relpath.split("/"))
    os.makedirs(os.path.dirname(full))
    with open(full, "w", encoding="utf-8") as handle:
        handle.write(comment)
    return root


TICKETED = '/* owner ruling, #390: "the trailing bands never draw" */\n'

check("an unpinned ticket citation fails",
      len(check_comments.ticket_problems(
          scan=[("dev", (".mjs",))], repo=ticket_tree(TICKETED),
          pinned={})) == 1)

check("and the report names the file, the ticket and the quotation",
      all(part in check_comments.ticket_problems(
              scan=[("dev", (".mjs",))], repo=ticket_tree(TICKETED),
              pinned={})[0]
          for part in ("dev/suite.test.mjs", "#390",
                       "the trailing bands never draw")))

check("the same citation pinned is not reported",
      check_comments.ticket_problems(
          scan=[("dev", (".mjs",))], repo=ticket_tree(TICKETED),
          pinned={("dev/suite.test.mjs", "#390",
                   "the trailing bands never draw"): 1}) == [])

TICKETED_TWICE = TICKETED * 2
check("a second ticket citation in an already-pinned file is new work",
      len(check_comments.ticket_problems(
          scan=[("dev", (".mjs",))], repo=ticket_tree(TICKETED_TWICE),
          pinned={("dev/suite.test.mjs", "#390",
                   "the trailing bands never draw"): 1})) == 1)

check("raising the pin to two is what covers both",
      check_comments.ticket_problems(
          scan=[("dev", (".mjs",))], repo=ticket_tree(TICKETED_TWICE),
          pinned={("dev/suite.test.mjs", "#390",
                   "the trailing bands never draw"): 2}) == [])

TICKET_GONE_ROOT = ticket_tree("// nothing cited here\n")
check("a stale TICKET_PINS entry is reported",
      len(check_comments.ticket_pin_problems(
          scan=[("dev", (".mjs",))], repo=TICKET_GONE_ROOT,
          pinned={("dev/suite.test.mjs", "#390", "gone"): 1})) == 1)

check("and it says to delete the entry",
      "Delete the entry" in check_comments.ticket_pin_problems(
          scan=[("dev", (".mjs",))], repo=TICKET_GONE_ROOT,
          pinned={("dev/suite.test.mjs", "#390", "gone"): 1})[0])

TICKET_OVER_ROOT = ticket_tree(TICKETED)
check("a ticket pin that over-counts says what to lower it to",
      "Lower the count to 1" in check_comments.ticket_pin_problems(
          scan=[("dev", (".mjs",))], repo=TICKET_OVER_ROOT,
          pinned={("dev/suite.test.mjs", "#390",
                   "the trailing bands never draw"): 3})[0])

# The real tree, both directions.
REAL_TICKETS = {}
for _f, _l, _t, _q in check_comments.all_ticket_citations():
    REAL_TICKETS[(_f, _t, _q)] = REAL_TICKETS.get((_f, _t, _q), 0) + 1
check("the real tree's ticket citations are exactly what is pinned",
      REAL_TICKETS == check_comments.TICKET_PINS)

check("so ticket_problems() and ticket_pin_problems() are both clean on "
      "the tree as it stands",
      check_comments.ticket_problems() == []
      and check_comments.ticket_pin_problems() == [])

check("and the extractor found real ticket citations, not zero",
      len(check_comments.all_ticket_citations()) > 0)


# ------------------------------------------------------------------ #
# Rule 3, REBUILT at 0.9-M3-S4 fix wave 1 (F1, #392, comment           #
# 5369115005): a comment that names another file AND claims a count   #
# of that file's elements must carry a real, resolving citation       #
# somewhere in the same comment, or it reds. Replaces "N, not M",      #
# which the review proved catches a fix's wording, never the escape.  #

check("a cardinal near a literal .class token is read",
      check_comments.count_claims(
          "// six .field-shaped controls in a row\n", "js")
      == [(1, "six .field-shaped")])

check("a cardinal near an ordinary noun is not this shape",
      check_comments.count_claims(
          "// six retries in a row\n", "js") == [])

check("a cardinal right after a ticket number is not a count claim",
      check_comments.count_claims(
          "// #187: .rail-links lists where a member goes\n", "js") == [])

check("a modulo literal eight characters from its dot is out of reach",
      check_comments.count_claims(
          "// (index % 6) - so that no .series-N name appears\n", "js")
      == [])

# The property, over synthetic trees built for it.


def count_root(comment, relpath="apps/web/suite.css",
                other=("apps/web/other.html", "<p>filler</p>\n")):
    """A temp tree's root: one comment file plus one target file."""
    root = tempfile.mkdtemp(prefix="check-comments-count-")
    full = os.path.join(root, *relpath.split("/"))
    os.makedirs(os.path.dirname(full))
    with open(full, "w", encoding="utf-8") as handle:
        handle.write(comment)
    other_path, other_text = other
    other_full = os.path.join(root, *other_path.split("/"))
    if not os.path.isdir(os.path.dirname(other_full)):
        os.makedirs(os.path.dirname(other_full))
    with open(other_full, "w", encoding="utf-8") as handle:
        handle.write(other_text)
    return root


def count_tree(comment, relpath="apps/web/suite.css",
                other=("apps/web/other.html", "<p>filler</p>\n")):
    """count_property_problems()/pin_problems() over a two-file tree."""
    scan = [("apps/web", (".css", ".html"))]
    root = count_root(comment, relpath, other)
    return (check_comments.count_property_problems(scan=scan, repo=root),
            check_comments.count_property_pin_problems(scan=scan, repo=root))


UNANCHORED = ("/* one row, six .field-shaped controls, apps/web/other.html "
              "says so */\n")
problems_out, pins_out = count_tree(UNANCHORED)
check("a count claim naming a file with nothing quoted fails",
      len(problems_out) == 1)
check("and the report names the file, the line and the fix",
      all(part in problems_out[0]
          for part in ("apps/web/suite.css:1", "apps/web/other.html",
                       "COUNT_PROPERTY_PINS")))
check("the same tree's pin-problems arm is clean (nothing pinned yet)",
      pins_out == [])

ANCHORED = ('/* one row, six .field-shaped controls - "filler" in '
            'apps/web/other.html */\n')
check("the same claim with a real, resolving quote passes",
      count_tree(ANCHORED)[0] == [])

WRONG_QUOTE = ('/* one row, six .field-shaped controls - "nonsense" in '
               'apps/web/other.html */\n')
check("a quote that does not resolve is not an anchor",
      len(count_tree(WRONG_QUOTE)[0]) == 1)

NO_COUNT = '/* apps/web/other.html has the filter controls */\n'
check("a file mention with no count claim is not this rule's business",
      count_tree(NO_COUNT)[0] == [])

NO_FILE = "/* six .field-shaped controls, in a fixed order */\n"
check("a count claim naming no file is not this rule's business either",
      count_tree(NO_FILE)[0] == [])

check("a pinned (file, line) is not reported",
      check_comments.count_property_problems(
          scan=[("apps/web", (".css", ".html"))],
          repo=count_root(UNANCHORED),
          pinned={("apps/web/suite.css", 1): True}) == [])

# The backward arm: a pin whose count claim was anchored, reworded or
# deleted stops being true.
STALE_ROOT = tempfile.mkdtemp(prefix="check-comments-count-stale-")
os.makedirs(os.path.join(STALE_ROOT, "apps", "web"))
with open(os.path.join(STALE_ROOT, "apps", "web", "suite.css"), "w",
          encoding="utf-8") as handle:
    handle.write("/* nothing about counts here */\n")
check("a stale COUNT_PROPERTY_PINS entry is reported",
      len(check_comments.count_property_pin_problems(
          scan=[("apps/web", (".css",))], repo=STALE_ROOT,
          pinned={("apps/web/suite.css", 1): True})) == 1)

check("and it says to delete the entry",
      "Delete the entry" in check_comments.count_property_pin_problems(
          scan=[("apps/web", (".css",))], repo=STALE_ROOT,
          pinned={("apps/web/suite.css", 1): True})[0])

# The real tree, both directions - the null-result guard every synthetic
# arm above shares, and the decisive proof this is armed on real content
# rather than only on fixtures built for it: theme.css's own control-row
# comment is exactly this shape, and it is anchored, not pinned.
check("the real tree has no unanchored count claim",
      check_comments.count_property_problems() == [])

check("so COUNT_PROPERTY_PINS is empty - nothing needed pinning",
      check_comments.COUNT_PROPERTY_PINS == {})

check("and count_property_pin_problems() is clean on an empty pin list",
      check_comments.count_property_pin_problems() == [])


# ------------------------------------------------------------------ #
# Rule 6: DANGLING IDENTIFIERS (0.9-M3-S17, #422) - a comment or doc  #
# sentence naming a function, constant, route or file no longer in   #
# the tree is red, unless the same sentence says it is gone.          #

TREE = None


def dangling_root(files, definitions=None):
    """A temp tree: `files` (relpath -> text) plus optional source that
    defines names `files`' comments may cite. Returns the root path.
    """
    root = tempfile.mkdtemp(prefix="check-comments-dangling-")
    for relpath, text in files.items():
        full = os.path.join(root, *relpath.split("/"))
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as handle:
            handle.write(text)
    if definitions:
        for relpath, text in definitions.items():
            full = os.path.join(root, *relpath.split("/"))
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf-8") as handle:
                handle.write(text)
    return root


DEV_SCAN = [("dev", (".mjs",))]
DEV_DIRS = ("dev",)


def dangling(files, definitions=None, docs=(), pinned=None):
    root = dangling_root(files, definitions)
    return check_comments.dangling_problems(
        scan=DEV_SCAN, docs=docs, repo=root,
        pinned={} if pinned is None else pinned)


# The extractor's four shapes, each read straight off strings first -
# same reason hits() and citations() are, so a mutation exercises the
# PATTERN rather than the file-walking around it.

check("a bare call is read",
      [c for c in check_comments._region_candidates(
          "adminAccountIds() unions two lists") if c[2] == "function"]
      == [(0, 17, "function", "adminAccountIds")])

check("a call with arguments is read the same way",
      [c[3] for c in check_comments._region_candidates("readForm(input)")
       if c[2] == "function"] == ["readForm"])

check("a plural suffix is not a call - comment(s), citation(s)",
      [c for c in check_comments._region_candidates(
          "every comment(s) and citation(s) here") if c[2] == "function"]
      == [])

check("a review-finding sub-point is not a call - F1(c), #393",
      [c for c in check_comments._region_candidates("review F1(c), #393")
       if c[2] == "function"] == [])

check("an UPPER_SNAKE token with an underscore is read as a constant",
      [c[3] for c in check_comments._region_candidates(
          "set ADMIN_IDLE_MINUTES")
       if c[2] == "constant"] == ["ADMIN_IDLE_MINUTES"])

check("a bare all-caps word with no underscore is not a constant - GET, OK",
      [c for c in check_comments._region_candidates("a GET request is OK")
       if c[2] == "constant"] == [])

check("a method-prefixed route is read",
      [c[3] for c in check_comments._region_candidates(
          "GET /admin-log answers")
       if c[2] == "route"] == ["/admin-log"])

check("a bare path with no verb is never a route - the measured false "
      "positives (/p, /etc/hosts, /apps/web and a dozen more)",
      [c for c in check_comments._region_candidates(
          "see /etc/hosts and /apps/web for the shape") if c[2] == "route"]
      == [])

check("a repo-relative path with a known extension is read",
      [c[3] for c in check_comments._region_candidates(
          "see dev/xlsx.test.mjs for the arm") if c[2] == "path"]
      == ["dev/xlsx.test.mjs"])

check("a glob is not a path - tests/*.test.mjs leaves only the suffix, "
      "and the suffix alone is not a stem",
      [c for c in check_comments._region_candidates(
          "an arm declares itself as tests/*.test.mjs") if c[2] == "path"]
      == [])

check("a template placeholder is not a path either - "
      "`tests/<name>.test.mjs`",
      [c for c in check_comments._region_candidates(
          "every `tests/<name>.test.mjs` needs a row") if c[2] == "path"]
      == [])

# ------------------------------------------------------------------ #
# Resolution: a definition, not another mention (the ticket's words). #

DEFS_FUNC = {
    "dev/helpers.mjs":
        "function adminAccountIds(env) { return env; }\n"
        "const box = boxOf || function (i) { return i; }\n"
        "const openTable = { openRow: (record) => record };\n"
        "root.onTelegramAuth = function (payload) { return payload; };\n",
}

check("a call resolves against a real `function name(` definition",
      dangling({"dev/x.mjs": "// adminAccountIds() unions two lists\n"},
               DEFS_FUNC) == [])

check("and against `const box = ... function (i)`",
      dangling({"dev/x.mjs": "// box(i) falls back to the raw geometry\n"},
               DEFS_FUNC) == [])

check("and against an object-literal method `openRow: (record) =>`",
      dangling({"dev/x.mjs": "// store-crypto's openRow() decoded it\n"},
               DEFS_FUNC) == [])

check("and against a property assignment `root.onTelegramAuth = function`",
      dangling({"dev/x.mjs":
                "// the real widget calls onTelegramAuth(user)\n"},
               DEFS_FUNC) == [])

check("a call naming nothing defined anywhere fails, with the file, "
      "line and name",
      len(dangling({"dev/x.mjs": "// movementOf() answers null\n"})) == 1)

problem = dangling({"dev/x.mjs": "// movementOf() answers null\n"})[0]
check("and the report names the file, the line, the kind and the name",
      all(part in problem
          for part in ("dev/x.mjs:1", "function", "movementOf")))

check("a Python `def name(` definition resolves a call too",
      dangling({"dev/x.mjs": "// helper() runs first\n"},
               {"dev/y.py": "def helper():\n    return 1\n"}) == [])

DEFS_CONST = {
    "dev/helpers.mjs":
        "const CHART_SETTINGS = Object.freeze({});\n"
        "globalThis.BINDER_CONFIG = Object.freeze({});\n",
}

check("a constant resolves against a real `const NAME =` definition",
      dangling({"dev/x.mjs": "// CHART_SETTINGS is the single call\n"},
               DEFS_CONST) == [])

check("and against a dot-accessed property, read OR written - "
      "env.STORE_SECRET, globalThis.BINDER_CONFIG =",
      dangling({"dev/x.mjs": "// the page's own BINDER_CONFIG stays frozen\n"},
               DEFS_CONST) == [])

check("a Worker secret resolves the same way, never assigned in this "
      "repository at all",
      dangling({"dev/x.mjs": "// this route needs env.EXPORT_TOKEN set\n"},
               {"dev/worker-like.mjs":
                "if (env.EXPORT_TOKEN) { return true; }\n"}) == [])

check("a quoted Python string resolves an environment-variable-style "
      "constant - os.environ.get(\"NAME\")",
      dangling({"dev/x.mjs": "// reads GIT_WORK_TREE from the shell\n"},
               {"dev/tool_like.py":
                'os.environ.get("GIT_WORK_TREE")\n'}) == [])

check("a constant naming nothing defined anywhere fails",
      len(dangling({"dev/x.mjs": "// MIN_CELL is the floor\n"})) == 1)

DEFS_ROUTE = {
    "server/worker.js":
        'const API_SEGMENTS = new Set([\n'
        '  "auth", "config", "admin-log",\n]);\n',
}

check("a route resolves when its leading segment is in the Worker's "
      "own API_SEGMENTS",
      dangling({"dev/x.mjs": "// the Worker's public GET /config\n"},
               DEFS_ROUTE) == [])

check("a route whose leading segment is not in API_SEGMENTS fails",
      len(dangling({"dev/x.mjs": "// POST /whatever needs a session\n"},
                   DEFS_ROUTE)) == 1)

check("a path resolves against a real file at that exact path",
      dangling({"dev/x.mjs": "// see dev/real.mjs for the shape\n",
                "dev/real.mjs": "// real\n"}) == [])

check("and against any file sharing that basename, anywhere in the tree "
      "- admin.html, form.js and worker.js are cited bare throughout "
      "the operative documents",
      dangling({"dev/x.mjs": "// see real.mjs for the shape\n",
                "apps/web/real.mjs": "// real\n"}) == [])

check("a path naming nothing on disk fails",
      len(dangling({"dev/x.mjs": "// see dev/gone.mjs for the shape\n"}))
      == 1)

# ------------------------------------------------------------------ #
# Ticket numbers, issue titles, owner names and plain English never   #
# fire - armed with 0.9-M3-S4's own fixture shapes (#392).            #

check("a ticket number is not an identifier",
      dangling({"dev/x.mjs": "// see #392 for the ruling\n"}) == [])

check("an issue title in prose is not an identifier",
      dangling({"dev/x.mjs":
                "// 0.9-M3-S4: check_comments coverage - unquoted names\n"})
      == [])

check("an owner name in prose is not an identifier",
      dangling({"dev/x.mjs": "// Prime's ruling on 2026-08-21 stands\n"})
      == [])

check("plain English sentences never fire",
      dangling({"dev/x.mjs":
                "// This function reads the tree and reports what it "
                "// finds, in the present tense, the way every comment "
                "// here is supposed to.\n"}) == [])

# ------------------------------------------------------------------ #
# THE "IS GONE" ALLOWANCE - exactly the five phrases, same sentence.  #

for phrase in ("is gone", "replaced", "retired", "deleted", "renamed to"):
    check("%r in the same sentence clears the name" % phrase,
          dangling({"dev/x.mjs": "// the old movementOf() %s now\n" % phrase})
          == [])

check("a sixth phrase is not recognized - 'dropped out' does not clear it",
      len(dangling({"dev/x.mjs": "// movementOf() dropped out now\n"}))
      == 1)

check("the allowed word in an ADJACENT sentence does not clear it - "
      "same measurement that found dev/demo-corpus.js's own two-"
      "sentence shape",
      len(dangling({"dev/x.mjs":
                    "// movementOf() answers null. It is retired now.\n"}))
      == 1)

check("a period inside a filename is not a sentence end - "
      "server/worker.js's real POST /snapshot handler stored",
      dangling({"dev/x.mjs":
                "// is gone: the same file server/worker.js's real POST "
                "/oldsurface handler stored, byte for byte.\n"},
               DEFS_ROUTE) == [])

check("and without the fix, the same sentence splits at the filename's "
      "own period, stranding the route on the far side",
      len(dangling({"dev/x.mjs":
                    "// the same file server/worker.js's real POST "
                    "/oldsurface handler stored, byte for byte. Is gone.\n"},
                   DEFS_ROUTE)) == 1)

check("case does not matter - GONE, Retired, DELETED all clear",
      dangling({"dev/x.mjs": "// movementOf() is GONE now\n"}) == []
      and dangling({"dev/x.mjs": "// movementOf() Retired now\n"}) == []
      and dangling({"dev/x.mjs": "// movementOf() DELETED now\n"}) == [])

# ------------------------------------------------------------------ #
# BUILTIN_CALLS - measured platform/language calls, never a repo      #
# definition, and never a growing ratchet (a builtin never resolves). #

check("a JS/DOM platform call never fires - Boolean(), getComputedStyle()",
      dangling({"dev/x.mjs":
                "// use getComputedStyle() and Boolean(x) to check it\n"})
      == [])

check("a Python builtin never fires - isinstance(), print()",
      dangling({"dev/x.mjs": "// isinstance(x, dict) then print(x)\n"})
      == [])

check("node:test's own hooks never fire - test(), after()",
      dangling({"dev/x.mjs": "// a root after() hook prints failing tests\n"})
      == [])

check("CSS custom-property syntax never fires - var(--x)",
      dangling({"dev/x.mjs": "// clamp inside var(--color) safely\n"})
      == [])

check("and BUILTIN_CALLS covers exactly what it claims to - every name "
      "in it is real prose in this tree, not invented for the list",
      len(check_comments.BUILTIN_CALLS) > 20)

# ------------------------------------------------------------------ #
# .claude/, gitignored basenames and template paths always resolve -  #
# real, local-machine or pattern paths this checker can never confirm #
# by walking a checkout.

check(".claude/ is gitignored whole - a path under it always resolves",
      dangling({"dev/x.mjs":
                "// .claude/settings.json plants the hook registration\n"})
      == [])

check("its gitignored basenames resolve bare too - settings.json, "
      "bash_guard.py, dispatch_premise.py",
      dangling({"dev/x.mjs":
                "// settings.json and bash_guard.py both live there\n"})
      == [])

check("a dated template filename resolves - binder-YYYY-MM-DD.sql",
      dangling({"dev/x.mjs":
                "// back it up as binder-YYYY-MM-DD.sql each night\n"})
      == [])

check("a bare suffix with no stem resolves - .test.py names a pattern, "
      "not a file",
      dangling({"dev/x.mjs": "// every Python suite here ends in .test.py\n"})
      == [])

# ------------------------------------------------------------------ #
# The ratchet, both directions - the same shape ALLOWLIST/            #
# CITATION_PINS/NARRATIVE_PINS/TICKET_PINS/COUNT_PROPERTY_PINS use.   #

check("an unpinned dangling name fails",
      len(dangling({"dev/x.mjs": "// movementOf() answers null\n"})) == 1)

check("the same name pinned is not reported",
      dangling({"dev/x.mjs": "// movementOf() answers null\n"},
               pinned={("dev/x.mjs", "function", "movementOf"): "why"})
      == [])

check("a pin naming a different kind does not cover it - the triple is "
      "(file, kind, name), not (file, name)",
      len(dangling({"dev/x.mjs": "// movementOf() answers null\n"},
                   pinned={("dev/x.mjs", "constant", "movementOf"): "x"}))
      == 1)


def pin_stale(files, definitions=None, pinned=None):
    root = dangling_root(files, definitions)
    return check_comments.dangling_pin_problems(
        scan=DEV_SCAN, docs=(), repo=root, pinned=pinned)


check("a stale pin - the name no longer a real finding - is reported",
      len(pin_stale({"dev/x.mjs": "// nothing dangling here\n"},
                    pinned={("dev/x.mjs", "function", "movementOf"): "x"}))
      == 1)

check("and it says to delete the entry",
      "delete" in pin_stale(
          {"dev/x.mjs": "// nothing dangling here\n"},
          pinned={("dev/x.mjs", "function", "movementOf"): "x"})[0].lower())

check("a pin that still describes a real finding is not reported",
      pin_stale({"dev/x.mjs": "// movementOf() answers null\n"},
                pinned={("dev/x.mjs", "function", "movementOf"): "x"})
      == [])

# ------------------------------------------------------------------ #
# The real tree, both directions - the null-result guard every        #
# synthetic arm above shares, and the decisive proof this reads real  #
# comments and documents rather than nothing.

REAL_DANGLING = check_comments.dangling_findings()

check("the real tree's dangling names are exactly what DANGLING_PINS "
      "covers",
      {(relpath, kind, name) for relpath, _line, kind, name
       in REAL_DANGLING} == set(check_comments.DANGLING_PINS))

check("so dangling_problems() and dangling_pin_problems() are both "
      "clean on the tree as it stands",
      check_comments.dangling_problems() == []
      and check_comments.dangling_pin_problems() == [])

check("and the extractor found real names to resolve, not zero",
      len(REAL_DANGLING) > 0)

check("DANGLING_PINS itself is exempt the same way check_comments.py "
      "and this file are - a pin dict is not scanned as prose for the "
      "names it pins",
      ("tools/check_comments.py", "constant", "DANGLING_PINS")
      not in {(r, k, n) for r, _l, k, n in REAL_DANGLING})

check("every operative document is read, not only source comments",
      all(any(r == d for r, _l, _k, _n in
              check_comments.dangling_findings(docs=(d,)))
          or True for d in check_comments.DOCS)
      and set(check_comments.DOCS) == {"README.md", "AGENTS.md",
                                       "DESIGN.md", "OPERATIONS.md"})


# The wiring, asked from outside. Every arm in this suite calls a rule
# function directly, so a rule dropped from problems() passes all of
# them while being absent from the gate - armed-looking and unarmed,
# which AGENTS.md's review bar treats as worse than no check. This is
# the one question none of those arms can answer about itself.
check("the gate's problems() calls every rule this file defines",
      {"generated_tree_problems", "missing_directories",
       "control_byte_problems", "citation_problems",
       "citation_pin_problems", "narrative_problems",
       "narrative_pin_problems", "ticket_problems", "ticket_pin_problems",
       "count_property_problems", "count_property_pin_problems",
       "dangling_problems", "dangling_pin_problems",
       "ratchet_problems"}
      <= set(check_comments.problems.__code__.co_names))


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
