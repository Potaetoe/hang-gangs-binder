"""Contract checks for the source-comment spelling gate.

`tools/check_spelling.py` is issue #334's answer to a finding from the
S4 independent review (#330): AGENTS.md rule 8 claims American spelling
is machine-checked, and until this file existed the only machine doing
any of that checking was tools/check_docs.py, over four documents and
security/ - never a comment in apps/web, server, dev or tools. A
British spelling in apps/web/dashboard.js ("relabelled") sailed through
every gate this repository runs, twice, before anybody read the line by
eye.

Two halves, the same shape #34 established for every checker in this
family. The deny-list is tested on strings, because a mutation exercises
a *rule* and never the extractor that has to find a comment before any
rule can apply - and the false-positive side matters as much as the
catch side here: a family anchored wrong reads "called" and "organism"
as offenses and teaches the next reader to ignore the gate. Then the
ratchet is tested as a pure function over a found-set, exactly the shape
dev/check_comments.test.py already proved for ALLOWLIST - an occurrence
that is not pinned fails, and a pin that stops matching fails too. Then
the real tree is tested, including the decisive pair: that PINNED is
exactly what scanning the tree finds, and that the one instance the
ticket named is gone from it.

No framework, matching the suites beside it.
"""

import os
import sys

# tools/ is not a package and check_spelling.py is a script, so the
# import has to be made reachable before it can be named. isort would
# hoist the import above the path insertion and break it, hence the
# explicit skip - the same shape as dev/check_comments.test.py.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))

import check_spelling  # noqa: I001


failures = 0
performed = 0

# Asserted at the end rather than only printed. A hand-written total
# that nothing compares against still prints a confident "OK" when a
# check stops running - an early return, a renamed helper - which is
# the armed-looking-but-not failure this repository holds to be worse
# than having no check at all.
EXPECTED = 57


def check(label, condition):
    global failures, performed
    performed += 1
    if not condition:
        failures += 1
    print("pass " if condition else "FAIL ", label)


def labels(text, kind="js"):
    return sorted({label for _line, label, _text in
                   check_spelling.hits(text, kind)})


def clean(text, kind="js"):
    return check_spelling.hits(text, kind) == []


# ------------------------------------------------------------------ #
# The deny-list, family by family, on strings.                        #

check("a metric unit in -tre is caught",
      labels("// a centimetre of slack absorbs the rounding\n")
      == ["metric units (-tre)"])

check("colour is caught",
      labels("/* pick a colour for the badge */") == ["-our words"])

check("behaviour is caught",
      labels("// screen-reader behaviour is the platform's\n")
      == ["-our words"])

check("analyse is caught",
      labels("// analyse the batch before writing it\n")
      == ["analyse family"])

check("organise, one of the ten -ise stems, is caught",
      labels("// organise the rows before export\n") == ["-ise family"])

check("a compound is still caught, because the family is unanchored",
      labels("// this file was reorganised last spring\n")
      == ["-ise family"])

check("labelled, the -ll- family, is caught",
      labels("/* the group went unlabelled until now */")
      == ["-ll- doubling"])

check("cancelled is caught",
      labels("// the request is cancelled here\n") == ["-ll- doubling"])

check("a compound -ll- form is still caught, same as the -ise family",
      labels("// it is gone rather than relabelled\n")
      == ["-ll- doubling"])

check("counsellor, the -lor suffix, is caught",
      labels("// ask the counsellor before the export\n")
      == ["-ll- doubling"])

check("marvellous, the -ous suffix, is caught",
      labels("// a marvellous result for a first attempt\n")
      == ["-ll- doubling"])

# ------------------------------------------------------------------ #
# The American forms are clean. A check this repository has to trust  #
# had better not fire on the spelling it is defending.                #

check("centimeter, the American form, is clean",
      clean("// a centimeter of slack absorbs the rounding\n"))

check("color, the American form, is clean",
      clean("/* pick a color for the badge */"))

check("analyze, the American form, is clean",
      clean("// analyze the batch before writing it\n"))

check("labeled, the American form, is clean",
      clean("// the group stayed labeled throughout\n"))

check("canceled, the American form, is clean",
      clean("// the request is canceled here\n"))

check("counselor, the American form, is clean",
      clean("// ask the counselor before the export\n"))

# ------------------------------------------------------------------ #
# The false-positive class the docstring argues against by name.      #

# The whole reason the -ll- family is anchored to thirteen stems
# instead of a bare "ll": these four are the most common shapes a bare
# "lled\b"/"lling\b" search returns in this tree, and none of them is a
# spelling difference - the root already carries a doubled consonant in
# both dialects.
check("called is not a -ll- offense",
      clean("// the helper is called once per row\n"))

check("filled is not a -ll- offense",
      clean("// a filled chip around a caution\n"))

check("controlled is not a -ll- offense (stressed final syllable)",
      clean("// the flag is controlled by the caller\n"))

check("installed is not a -ll- offense",
      clean("// the dependency is installed once\n"))

# enrol/enroll disagree about the bare verb and agree once a suffix is
# added, which is a different rule than the one this file enforces -
# so "enrol" is deliberately not one of the thirteen stems, and
# "enrolled" must not fire from any of them either.
check("enrolled is not flagged - the dialects agree once suffixed",
      clean("// a member enrolled through the form\n"))

# cancellation keeps its double L in both dialects (only the verb's
# past tense and gerund differ), so the -ise/-ll- split has to leave
# the -ation suffix off the -ll- family entirely.
check("cancellation is not a -ll- offense",
      clean("// filed under cancellation once removed\n"))

# organism and analysis are check_docs.py's own worked false positives
# for the same -ise family pattern, copied here rather than re-derived,
# because the pattern string is copied from there too - a family that
# passes check_docs.py's suite and fails this one would mean the copy
# drifted.
check("organism is not mistaken for the -ise family",
      clean("// the organism is described in the record\n"))

check("analysis is not mistaken for the -ise family",
      clean("// the analysis is filed beside the assessment\n"))

check("microorganism is not mistaken for the -ise family",
      clean("// every microorganism in the sample is listed\n"))

# Proper nouns are the sharper case for the -ll- family: an unanchored
# bare "ll" would have to answer for every "-well" surname. The
# thirteen stems are checked directly, by name, against the argument
# the docstring makes - none contains any of them as a substring.
PROPER_NOUNS = ["Cornwall", "Russell", "Powell", "Attwell", "Caldwell",
               "Rockwell", "Maxwell", "Mitchell", "Campbell"]
check("no -ll- stem is a substring of any of these surnames",
      all(stem not in name.lower()
          for name in PROPER_NOUNS
          for stem in ("label", "cancel", "model", "travel", "signal",
                       "level", "channel", "counsel", "marvel", "fuel",
                       "equal", "total", "dial")))

check("and none of the surnames themselves is flagged in prose",
      all(clean("// %s signed the entry\n" % name)
          for name in PROPER_NOUNS))

# ------------------------------------------------------------------ #
# Comments only - code and strings are not prose.                     #

check("the same word in a string literal is not caught",
      clean('const m = "This colour is reserved";\n'))

check("an identifier is not caught, even one spelled the British way",
      clean("function labeller(identify) { return identify; }\n"))

check("a phrase in a CSS comment is caught",
      labels("/* screen-reader behaviour is the platform's */\n", "css")
      == ["-our words"])

check("CSS outside a comment is not read",
      clean('.a { content: "cancelled"; }\n', "css"))

check("a phrase in an HTML comment is caught",
      labels("<!-- ask the counsellor before export -->\n", "html")
      == ["-ll- doubling"])

check("a phrase in a Python # comment is caught",
      labels("# the batch is modelled here\n", "py")
      == ["-ll- doubling"])

check("a phrase inside a Python string is not caught",
      clean('label = "the batch is modelled here"\n', "py"))


# ------------------------------------------------------------------ #
# The ratchet, as a pure function over a found-set - the identical     #
# shape dev/check_comments.test.py already proved for ALLOWLIST.      #

SCANNED = ["apps/web/dashboard.js", "apps/web/theme.css"]


def ratchet(found, pinned):
    return check_spelling.ratchet_problems(found, pinned, SCANNED)


check("a clean tree with nothing pinned has no problems",
      ratchet({}, {}) == [])

new = ratchet(
    {("apps/web/theme.css", "-our words"): [(12, "colour")]}, {})
check("an occurrence that is not pinned fails",
      len(new) == 1)
check("and the failure names the file, the line and the word",
      "apps/web/theme.css" in new[0] and ":12" in new[0]
      and "colour" in new[0])

check("a pinned occurrence is suppressed",
      ratchet({("apps/web/theme.css", "-our words"): [(12, "colour")]},
              {("apps/web/theme.css", "-our words"): 1}) == [])

# The pin is a count, not a license for the file - a second occurrence
# in an already-pinned file is exactly the new offense this exists to
# catch.
second = ratchet(
    {("apps/web/theme.css", "-our words"): [(12, "colour"),
                                            (90, "favourite")]},
    {("apps/web/theme.css", "-our words"): 1})
check("a second occurrence in an already-pinned file fails",
      len(second) == 1 and "12" in second[0] and "90" in second[0])

gone = ratchet({}, {("apps/web/theme.css", "-our words"): 1})
check("a pin that matches nothing fails",
      len(gone) == 1)
check("and it says to delete the entry",
      "delete" in gone[0].lower())

over = ratchet(
    {("apps/web/theme.css", "-our words"): [(12, "colour")]},
    {("apps/web/theme.css", "-our words"): 3})
check("a pin that over-counts fails and says what to lower it to",
      len(over) == 1 and "1" in over[0])

stale_file = ratchet({}, {("apps/web/deleted.js", "-our words"): 1})
check("a pin naming a file outside the scan set fails",
      len(stale_file) == 1 and "apps/web/deleted.js" in stale_file[0])


# ------------------------------------------------------------------ #
# The real tree.                                                      #

found, scanned = check_spelling.scan_tree()

check("the scan set is not empty",
      len(scanned) > 20)

check("every directory the rule names is represented",
      all(any(rel.startswith(d + "/") for rel in scanned)
          for d in ("apps/web", "server", "dev", "tools")))

check("archive/ is never scanned",
      not any(rel.startswith("archive/") for rel in scanned))

# The two checks' EXEMPT sets are different (deliberately - see
# EXEMPT's own comment), so their scanned sets differ too, in both
# directions at once: check_comments.py exempts itself and its own
# suite, which this check has no reason to skip, and this check exempts
# tools/check_docs.py for naming its own examples, which
# check_comments.py has no reason to skip.
check("this check reads check_comments.py itself, unlike check_comments.py",
      "tools/check_comments.py" in scanned
      and "dev/check_comments.test.py" in scanned)

CC_SCANNED = check_spelling.check_comments.scan_tree()[1]
check("this check exempts check_docs.py, unlike check_comments.py",
      "tools/check_docs.py" not in scanned
      and "tools/check_docs.py" in CC_SCANNED)

check("this check exempts its own two files",
      "tools/check_spelling.py" not in scanned
      and "dev/check_spelling.test.py" not in scanned)

# The decisive pair: the ticket's own instance is gone from the tree
# this scan reads, and it is gone because the source line changed, not
# because the pattern stopped looking for it.
DASHBOARD = open(os.path.join(check_spelling.REPO, "apps", "web",
                              "dashboard.js"), encoding="utf-8").read()
check("dashboard.js no longer says 'relabelled'",
      "relabelled" not in DASHBOARD.lower())
check("and the -ll- family would still catch it if it came back",
      labels("// it is gone rather than relabelled\n")
      == ["-ll- doubling"])

check("the real tree's occurrences are exactly what PINNED records",
      {key: len(places) for key, places in found.items()}
      == check_spelling.PINNED)

check("so the gate passes on the tree as it stands",
      check_spelling.problems() == [])

check("every pinned file is in the scan set",
      all(rel in scanned for rel, _label in check_spelling.PINNED))

check("every pinned label is one a pattern produces",
      all(label in {name for name, _p in check_spelling.SPELLING}
          for _rel, label in check_spelling.PINNED))

# The exemption is the hole in this check and it is deliberate, on the
# same terms tools/check_comments.py's own EXEMPT states: a file has to
# be able to name the spellings it forbids. Pinning the set here is
# what stops the hole growing quietly by one file at a time.
check("the exemption is exactly the three self-referential files",
      check_spelling.EXEMPT == frozenset({
          "tools/check_spelling.py", "dev/check_spelling.test.py",
          "tools/check_docs.py"}))


if failures:
    print("\ncheck_spelling.py FAILED %d of %d checks" % (failures,
                                                           performed))
    sys.exit(1)
if performed != EXPECTED:
    print("\ncheck_spelling.py ran %d checks, expected %d - a check "
          "stopped running, or one was added without updating EXPECTED"
          % (performed, EXPECTED))
    sys.exit(1)
print("\ncheck_spelling.py OK - %d checks" % performed)
