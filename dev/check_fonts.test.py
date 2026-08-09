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

No framework, matching the suites beside it.
"""

import os
import sys

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
EXPECTED = 24


def check(label, condition):
    global failures, performed
    performed += 1
    if not condition:
        failures += 1
    print("pass " if condition else "FAIL ", label)


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
          "wordmark-name") == ["Gang’s"])

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
      check_fonts.uncovered(["Gang’s"], set("Gangs")) == ["’"])

check("an empty demand is covered by an empty face",
      check_fonts.uncovered([], set()) == [])

check("the inventory arm reports what a face has stopped covering",
      check_fonts.uncovered([check_fonts.REQUIRED_INVENTORY],
                            set("AB")) != [])

check("the inventory arm passes a face that still covers it",
      check_fonts.uncovered([check_fonts.REQUIRED_INVENTORY],
                            set(check_fonts.REQUIRED_INVENTORY)) == [])


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

check("so the gate passes on the tree as it stands",
      check_fonts.problems() == [])


if failures:
    print("\ncheck_fonts.py FAILED %d of %d checks" % (failures, performed))
    sys.exit(1)
if performed != EXPECTED:
    print("\ncheck_fonts.py ran %d checks, expected %d - a check stopped "
          "running, or one was added without updating EXPECTED"
          % (performed, EXPECTED))
    sys.exit(1)
print("\ncheck_fonts.py OK - %d checks" % performed)
