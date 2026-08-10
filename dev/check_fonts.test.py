"""Contract checks for the vendored-face coverage gate.

`tools/check_fonts.py` holds every subset face to the characters the
shipped pages actually ask it to draw. #85's weight slice cut the
italic display face down to a wordmark's inventory, and the hazard that
creates is silent: a face that lacks a character does not fail, it falls
back to the next family in the stack. The wordmark would still render,
in Georgia, and every other check in this gate would stay green.

Two halves, for the reason dev/check_budget.test.py gives. The
extractor is exercised on strings rather than on the directory it
happens to read, because a mutation exercises a *rule* and never the
parser a rule depends on - and an extractor that finds no wordmark
reports a face as covering everything asked of it, which is the
armed-looking-but-not failure this repository holds to be worse than no
check. Then the real tree is read, including the decisive arm: that the
real wordmark really does come back out of a real page.

The comparison is a pure function over found-sets, so both directions
are covered without editing a published file: a character the pages ask
for and the face lacks fails, and an inventory the face no longer
covers fails too. The second arm is what stops a future re-subset from
quietly narrowing the face to whatever today's copy happens to use.

THE TWO ARRIVAL DIRECTIONS
--------------------------
#227. Everything above answers for a face or a class DEPARTING. Both
arrival directions were invisible: a `.woff2` vendored into dist/fonts
that no line names was never looked at, and a class given the subset
family by theme.css was never asked what characters it spells. That is
the shape #204 found in the gate's own suite list, in a check whose own
docstring says the friction is the point - "a table derived from what
exists cannot fail when something is added, and something being added
is exactly when a subset gets forgotten". It could not fail when
something was added.

Both new rosters are exercised over inputs this suite builds - a
scratch fonts directory and stylesheet strings - for the reason the
extractor above is: a rule exercised only against the tree it guards
cannot be shown to fail, and "the roster agrees" and "nothing was
enumerated" print the same empty list.

No framework, matching the suites beside it.
"""

import os
import shutil
import sys
import tempfile

# tools/ is not a package and check_fonts.py is a script, so the import
# has to be made reachable before it can be named. isort would hoist the
# import above the path insertion and break it, hence the explicit skip -
# the same shape as dev/check_budget.test.py.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))

import check_fonts  # noqa: I001


failures = 0
performed = 0

# Asserted at the end rather than only printed, for the reason
# dev/check_budget.test.py states: a hand-written total that nothing
# compares against still prints a confident "OK" when a check stops
# running.
EXPECTED = 60

# Every scratch root built here, so the suite removes what it made even
# when an arm fails. mkdtemp does not clean up after itself.
ROOTS = []


def check(label, condition):
    global failures, performed
    performed += 1
    if not condition:
        failures += 1
    print("pass " if condition else "FAIL ", label)


def only(problems):
    """The single problem expected, or "" when there is not exactly one.

    Indexing straight into the list would raise instead of reporting,
    and a suite that raises stops: the remaining contracts never run, so
    a mutation shows one break at a time rather than all of them.
    """
    return problems[0] if len(problems) == 1 else ""


def fonts(*names, present=True):
    """A scratch published tree holding fonts/<name> for each name given.

    Under the OS temp directory rather than in the checkout, for
    dev/check.test.py's reason: a fixture written beside these files
    would be read as source by the comment stage and linted by another.

    `present=False` builds the tree without the fonts directory at all,
    which is the case where an enumeration reads nothing and has to say
    so rather than printing the silence of a roster that agrees.
    """
    root = tempfile.mkdtemp(prefix="binder-faces-")
    ROOTS.append(root)
    if present:
        os.mkdir(os.path.join(root, check_fonts.FONT_DIR))
        for name in names:
            path = os.path.join(root, check_fonts.FONT_DIR, name)
            with open(path, "wb") as handle:
                handle.write(b"scratch fixture, never parsed")
    return root


# One italic @font-face and one rule that takes it - the shape theme.css
# has, small enough to vary one thing at a time.
FACE_RULE = ('@font-face { font-family: "P"; font-style: italic;'
             ' font-weight: 600;'
             ' src: url("fonts/p-italic.woff2") format("woff2"); }\n')
WORDMARK_RULE = ('.wordmark-name { font-family: var(--font-display);'
                 ' font-style: italic; }\n')
PINNED = ("wordmark-name",)
FACE = "fonts/p-italic.woff2"


# ------------------------------------------------------------------ #
# The text extractor, on strings.                                     #

check("text inside a named class is found",
      check_fonts.class_text(
          '<span class="wordmark-name">Binder</span>',
          "wordmark-name") == ["Binder"])

check("a class among several is still found",
      check_fonts.class_text(
          '<span class="a wordmark-name b">Binder</span>',
          "wordmark-name") == ["Binder"])

check("single quotes are read as well as double",
      check_fonts.class_text(
          "<span class='wordmark-name'>Binder</span>",
          "wordmark-name") == ["Binder"])

check("a different class is not collected",
      check_fonts.class_text(
          '<span class="wordmark-owner">Hang Gang</span>',
          "wordmark-name") == [])

# A prefix match would collect `wordmark-name-note` and report
# characters the face is never asked to draw, which fails the gate for a
# reason that does not exist.
check("a class the name is only a prefix of is not collected",
      check_fonts.class_text(
          '<span class="wordmark-nameplate">Other</span>',
          "wordmark-name") == [])

check("every occurrence on a page is collected",
      check_fonts.class_text(
          '<span class="wordmark-name">Bin</span>'
          '<span class="wordmark-name">der</span>',
          "wordmark-name") == ["Bin", "der"])

check("an HTML comment is not read",
      check_fonts.class_text(
          '<!-- <span class="wordmark-name">Ghost</span> -->'
          '<span class="wordmark-name">Binder</span>',
          "wordmark-name") == ["Binder"])

check("a named entity resolves to the character it names",
      check_fonts.class_text(
          '<span class="wordmark-name">Hang&amp;Gang</span>',
          "wordmark-name") == ["Hang&Gang"])

check("a numeric entity resolves to the character it names",
      check_fonts.class_text(
          '<span class="wordmark-name">Gang&#8217;s</span>',
          "wordmark-name") == ["Gang\u2019s"])

check("surrounding whitespace is not part of the demand",
      check_fonts.class_text(
          '<span class="wordmark-name">\n  Binder\n</span>',
          "wordmark-name") == ["Binder"])

check("a page with no such element demands nothing",
      check_fonts.class_text("<p>nothing here</p>", "wordmark-name") == [])


# ------------------------------------------------------------------ #
# The comparison, as a pure function over found-sets.                 #

check("a face covering what is asked reports nothing",
      check_fonts.uncovered(["Binder"], set("Binder")) == [])

check("a character the face lacks is reported",
      check_fonts.uncovered(["Binder"], set("Binde")) == ["r"])

check("several missing characters are reported in order",
      check_fonts.uncovered(["Zorro"], set("or")) == ["Z"])

check("a space is a character the face has to carry",
      check_fonts.uncovered(["Hang Gang"], set("HangG")) == [" "])

# The apostrophe case is the one this slice was written against: the
# site is "Hang Gang's Binder", and a typographic apostrophe is the
# character a wordmark most plausibly gains without anybody thinking of
# it as a font change.
check("a typographic apostrophe is reported when absent",
      check_fonts.uncovered(["Gang\u2019s"], set("Gangs")) == ["\u2019"])

check("an empty demand is covered by an empty face",
      check_fonts.uncovered([], set()) == [])


# ------------------------------------------------------------------ #
# The failure message, which has to survive being printed.            #
#
# The character this check names is by definition one a face could not
# draw, and very often one the console cannot encode either. Printing it
# raw kills the run with UnicodeEncodeError on a cp1252 terminal - the
# check still exits non-zero, so the gate still fails, but it fails with
# a traceback instead of the sentence saying what is wrong, at exactly
# the moment it is doing its job. Found by mutation on this branch.

check("a missing character is named by codepoint",
      "U+4E2D" in check_fonts.describe(["中"]))

check("a missing character is not embedded raw in the message",
      check_fonts.describe(["中"]).isascii())

check("the inventory arm reports what a face has stopped covering",
      check_fonts.uncovered([check_fonts.REQUIRED_INVENTORY],
                            set("AB")) != [])

check("the inventory arm passes a face that still covers it",
      check_fonts.uncovered([check_fonts.REQUIRED_INVENTORY],
                            set(check_fonts.REQUIRED_INVENTORY)) == [])


# ------------------------------------------------------------------ #
# Arrival, first direction: a face vendored into the published tree.   #

root = fonts("a.woff2")
check("a face roster naming exactly what is vendored reports nothing",
      check_fonts.face_roster_problems({"fonts/a.woff2": ("k",)}, {},
                                       root) == [])

root = fonts("a.woff2", "b.woff2")
arriving = check_fonts.face_roster_problems({"fonts/a.woff2": ("k",)}, {},
                                            root)
check("a vendored face that no line names is reported",
      "fonts/b.woff2" in only(arriving))
check("the arrival message says nothing checks it",
      "nothing here checks it" in only(arriving))

check("a face given a reason is not reported as unnamed",
      check_fonts.face_roster_problems(
          {"fonts/a.woff2": ("k",)},
          {"fonts/b.woff2": "a reason"}, root) == [])

root = fonts("a.woff2")
stale = check_fonts.face_roster_problems({"fonts/a.woff2": ("k",)},
                                         {"fonts/b.woff2": "a reason"}, root)
check("a reason for a face that is not vendored is reported",
      "fonts/b.woff2" in only(stale))

contradiction = check_fonts.face_roster_problems(
    {"fonts/a.woff2": ("k",)}, {"fonts/a.woff2": "a reason"}, root)
check("a face both pinned and excused is reported",
      "fonts/a.woff2" in only(contradiction))

root = fonts("a.woff2", "b.woff2.bak")
check("a name that merely contains the suffix is not a face",
      check_fonts.face_roster_problems({"fonts/a.woff2": ("k",)}, {},
                                       root) == [])

root = fonts(present=False)
check("a missing fonts directory is reported rather than read as agreement",
      check_fonts.face_roster_problems({}, {}, root) != [])


# ------------------------------------------------------------------ #
# Arrival, second direction: a class given the subset face.            #
#
# The key is `font-style: italic`, and it is decisive only while the
# tree vendors one italic face - which is why the first arm below is
# not about classes at all. A second italic @font-face would make the
# key ambiguous, so it is REPORTED rather than quietly narrowing what
# the roster can claim.

check("a stylesheet whose italic rules are all pinned reports nothing",
      check_fonts.italic_problems(FACE_RULE + WORDMARK_RULE,
                                  PINNED, {}, FACE) == [])

new_class = check_fonts.italic_problems(
    FACE_RULE + WORDMARK_RULE + ".blurb { font-style: italic; }\n",
    PINNED, {}, FACE)
check("a class the stylesheet makes italic that no line names is reported",
      "blurb" in only(new_class))
check("the message says the characters it spells go unchecked",
      "never asked" in only(new_class))

check("a class given a reason is not reported as unnamed",
      check_fonts.italic_problems(
          FACE_RULE + WORDMARK_RULE + ".blurb { font-style: italic; }\n",
          PINNED, {"blurb": "a reason"}, FACE) == [])

# A prose class that is styled italic somewhere else in the cascade is
# still a demand on the face, so the roster has to hold every subject -
# but only the subject. A descendant selector styles its rightmost
# compound, and reporting `.cover-leaf` too would be friction with no
# cause behind it.
check("only the rightmost compound of a selector is the subject",
      check_fonts.italic_problems(
          FACE_RULE + ".cover-leaf .wordmark-name { font-style: italic; }\n",
          PINNED, {}, FACE) == [])

comma = check_fonts.italic_problems(
    FACE_RULE + ".wordmark-name, .blurb { font-style: italic; }\n",
    PINNED, {}, FACE)
check("a comma list is read as several selectors",
      "blurb" in only(comma))

media = check_fonts.italic_problems(
    FACE_RULE + WORDMARK_RULE
    + "@media (max-width: 40rem) { .zoom { font-style: italic; } }\n",
    PINNED, {}, FACE)
check("a rule inside a media query is read like any other",
      "zoom" in only(media))

# An element selector with no class cannot be pinned against anything,
# so it is reported rather than passed over - the alternative is a
# demand the roster structurally cannot see.
bare = check_fonts.italic_problems(
    FACE_RULE + WORDMARK_RULE + "em { font-style: italic; }\n",
    PINNED, {}, FACE)
check("an italic rule whose subject carries no class is reported",
      "em" in only(bare))

check("a commented-out italic rule is not a demand",
      check_fonts.italic_problems(
          FACE_RULE + WORDMARK_RULE
          + "/* .ghost { font-style: italic; } */\n",
          PINNED, {}, FACE) == [])

check("an @font-face descriptor is not a styling rule",
      check_fonts.italic_selectors(FACE_RULE) == [])

# Departure, the direction the class roster also has to answer for: a
# line naming a class the stylesheet has stopped styling italic is a
# line about nothing, and it is what a rename leaves behind.
gone = check_fonts.italic_problems(FACE_RULE + WORDMARK_RULE
                                   + ".blurb { font-style: italic; }\n",
                                   PINNED, {"other": "a reason"}, FACE)
check("a reason for a class the stylesheet does not make italic is reported",
      any("other" in problem for problem in gone))

renamed = check_fonts.italic_problems(
    FACE_RULE + ".renamed { font-style: italic; }\n",
    PINNED, {"renamed": "a reason"}, FACE)
check("a pinned class the stylesheet no longer makes italic is reported",
      "wordmark-name" in only(renamed))

# Nothing read is not nothing wrong, again: a stylesheet with no italic
# rule in it at all reports the same empty list as one whose rules all
# agree.
silent = check_fonts.italic_problems(FACE_RULE, (), {}, FACE)
check("a stylesheet with no italic rule is reported rather than read as "
      "agreement", silent != [])

two = check_fonts.italic_problems(
    FACE_RULE + FACE_RULE.replace("p-italic", "q-italic") + WORDMARK_RULE,
    PINNED, {}, FACE)
check("a second italic face is reported, because the key stops being "
      "decisive", any("q-italic" in problem for problem in two))

other = check_fonts.italic_problems(
    FACE_RULE.replace("p-italic", "q-italic") + WORDMARK_RULE,
    PINNED, {}, FACE)
check("an italic face the roster does not name is reported",
      any("q-italic" in problem for problem in other))

# The default pinned set is FACES' row for the italic face, so naming a
# face FACES does not carry leaves this arm measuring an empty roster -
# which would pass every class through. It is reported instead.
check("an italic face FACES does not carry is reported",
      any("FACES" in problem for problem in check_fonts.italic_problems(
          FACE_RULE + WORDMARK_RULE, None, {}, "fonts/absent.woff2")))


# ------------------------------------------------------------------ #
# The block reader the two class arms rest on.                        #

check("a block's selector is read without the block before it",
      check_fonts.css_blocks(".a { color: red; }\n.b { color: blue; }")
      == [(".a", " color: red; "), (".b", " color: blue; ")])

check("a nested block is read and its wrapper is not a selector",
      [prelude for prelude, _ in
       check_fonts.css_blocks("@media (x) { .a { color: red; } }")]
      == [".a"])

check("the subject of a descendant selector is its last compound",
      check_fonts.subject_classes(".a .b") == {"b"})

check("a pseudo-class is not part of the name",
      check_fonts.subject_classes("a.link:hover") == {"link"})

check("a selector with no class has no subject to pin",
      check_fonts.subject_classes("em") == set())


# ------------------------------------------------------------------ #
# The real tree.                                                      #

check("the face roster names at least one face",
      len(check_fonts.FACES) >= 1)

check("every rostered face file exists in dist",
      all(os.path.isfile(os.path.join(check_fonts.WEB, *path.split("/")))
          for path in check_fonts.FACES))

# The decisive arm. If this reads nothing, every rule above still
# passes while measuring an empty demand.
demanded = check_fonts.demanded_text()
check("the real wordmark comes back out of the real pages",
      any("Binder" in text
          for texts in demanded.values() for text in texts))

check("the real face's cmap is non-empty",
      all(len(check_fonts.face_cmap(
          os.path.join(check_fonts.WEB, *path.split("/")))) > 0
          for path in check_fonts.FACES))

# The decisive arms for the two new rosters, and they are the same
# sentence as "the real wordmark comes back out of the real pages": an
# enumeration that finds nothing and a scan that reads no rule both make
# every rule above pass while measuring an empty set.
check("the enumeration finds the vendored faces",
      len(check_fonts.vendored_faces()) >= 2)

check("the roster answers for every face that is vendored",
      set(check_fonts.vendored_faces())
      == set(check_fonts.FACES) | set(check_fonts.FACES_UNPINNED))

with open(os.path.join(check_fonts.WEB, check_fonts.STYLESHEET),
          encoding="utf-8") as handle:
    stylesheet = handle.read()

check("the shipped stylesheet really does make the wordmark italic",
      any("wordmark-name" in check_fonts.subject_classes(selector)
          for selector in check_fonts.italic_selectors(stylesheet)))

check("and it loads exactly one italic face, the one the roster pins",
      check_fonts.italic_face_sources(stylesheet)
      == [check_fonts.ITALIC_FACE])

check("the italic face the class roster is about is a rostered face",
      check_fonts.ITALIC_FACE in check_fonts.FACES)

check("so the gate passes on the tree as it stands",
      check_fonts.problems() == [])


for path in ROOTS:
    shutil.rmtree(path, ignore_errors=True)

if failures:
    print("\ncheck_fonts.py FAILED %d of %d checks" % (failures, performed))
    sys.exit(1)
if performed != EXPECTED:
    print("\ncheck_fonts.py ran %d checks, expected %d - a check stopped "
          "running, or one was added without updating EXPECTED"
          % (performed, EXPECTED))
    sys.exit(1)
print("\ncheck_fonts.py OK - %d checks" % performed)
