"""Contract checks for the per-page transfer budget.

`tools/check_budget.py` holds each published page to a pinned number of
gzipped bytes: the page plus everything it pulls in. Issue #80 asks for
it because the redesign is about to touch every page and the gate has
no signal that would notice the payload doubling - #72 measured the
load and acquitted it, so the job here is keeping that ground, not
winning it.

Two halves, for the reason #34 paid for. The reference extractor is
tested on strings rather than on the directory it happens to read,
because a mutation exercises a *rule* and never the parser that has to
find something before any rule can apply - and an extractor that finds
no references measures five pages as five lone HTML files and calls the
site featherlight. Then the real tree is tested, including the decisive
arm: that real references come back out of a real page.

The arithmetic is tested as a pure function over a found-set, so both
directions are covered without touching a published file: over the
ceiling fails and names the heaviest files, and a ceiling that stands
far above what its page measures fails too, as stale headroom. A
budget that only catches growth drifts upward until it permits
anything.

No framework, matching the suites beside it.
"""

import os
import sys

# tools/ is not a package and check_budget.py is a script, so the import
# has to be made reachable before it can be named. isort would hoist the
# import above the path insertion and break it, hence the explicit skip
# - the same shape as dev/check_comments.test.py.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))

import check_budget  # noqa: I001


failures = 0
performed = 0

# Asserted at the end rather than only printed. A hand-written total
# that nothing compares against still prints a confident "OK" when a
# check stops running - an early return, a renamed helper - which is the
# armed-looking-but-not failure this repository holds to be worse than
# having no check at all.
EXPECTED = 55


def check(label, condition):
    global failures, performed
    performed += 1
    if not condition:
        failures += 1
    print("pass " if condition else "FAIL ", label)


# ------------------------------------------------------------------ #
# The reference extractor, on strings.                                #

check("a script tag is found",
      check_budget.page_references('<script src="form.js"></script>')
      == ["form.js"])

check("a stylesheet link is found",
      check_budget.page_references(
          '<link rel="stylesheet" href="theme.css">') == ["theme.css"])

check("an icon link is found",
      check_budget.page_references(
          '<link rel="icon" href="favicon.svg" type="image/svg+xml">')
      == ["favicon.svg"])

# index.html loads Telegram's widget from telegram.org. It is a real
# transfer and it is not this repository's to budget: nothing here can
# make it smaller, and counting it would move every ceiling whenever
# somebody else shipped.
check("an external script src is skipped",
      check_budget.page_references(
          '<script async src="https://telegram.org/js/telegram-widget.js'
          '?22"></script>') == [])

check("a protocol-relative src is skipped",
      check_budget.page_references('<script src="//cdn.test/x.js">'
                                   '</script>') == [])

check("a data: href is skipped",
      check_budget.page_references(
          '<link rel="icon" href="data:image/svg+xml,<svg/>">') == [])

# A tag somebody commented out is not a request, and budgeting for
# bytes nobody downloads makes the ceiling wrong in the direction that
# hides growth.
check("a commented-out tag is not counted",
      check_budget.page_references(
          '<!-- <script src="old.js"></script> -->') == [])

check("a commented-out tag beside a live one leaves the live one",
      check_budget.page_references(
          '<!-- <script src="old.js"></script> -->\n'
          '<script src="ui.js"></script>') == ["ui.js"])

check("a rel the browser fetches nothing for is skipped",
      check_budget.page_references(
          '<link rel="canonical" href="your-page.html">') == [])

# The default has to be fail-safe. An unknown rel that does transfer
# must land in the total rather than slip out of it: a budget that
# under-counts reports a page as light while the visitor pays for the
# rest.
check("an unknown rel counts, because the default is to count",
      check_budget.page_references(
          '<link rel="something-new" href="mystery.js">') == ["mystery.js"])

check("a preloaded font counts",
      check_budget.page_references(
          '<link rel="preload" as="font" href="inter.woff2" crossorigin>')
      == ["inter.woff2"])

check("single-quoted attributes are read",
      check_budget.page_references("<script src='nav.js'></script>")
      == ["nav.js"])

check("a query string and a fragment are trimmed",
      check_budget.page_references('<script src="ui.js?v=3#top"></script>')
      == ["ui.js"])

# apps/web is the site root - the deploy job copies that directory and
# nothing above it - so a leading slash names the same file a bare name
# does.
check("a root-relative path resolves like a bare name",
      check_budget.page_references('<script src="/theme.js"></script>')
      == ["theme.js"])

check("a reference climbing out of apps/web is refused",
      check_budget.page_references('<script src="../../dev/fixture.json">'
                                   '</script>') == [])

# The browser fetches each URL once, so a second reference to the same
# file costs nothing and must not be added twice.
check("the same file referenced twice counts once",
      check_budget.page_references(
          '<script src="ui.js"></script><script src="ui.js"></script>')
      == ["ui.js"])

# Every page links to every other page in its nav. Those are
# navigations, not part of this page's payload.
check("an anchor href is not a transfer",
      check_budget.page_references(
          '<a href="your-page.html">Your page</a>') == [])

check("a script with no src is not a reference",
      check_budget.page_references(
          "<script>window.x = 1;</script>") == [])

# A picture is the other way a page doubles in weight, and #73 asks for
# a warmer site. Absent from #80's wording, and the hazard #80 names is
# payload growth rather than the tag list it happens to enumerate.
check("an image is a transfer",
      check_budget.page_references('<img src="hero.avif" alt="">')
      == ["hero.avif"])

check("a <source> inside a picture is a transfer",
      check_budget.page_references('<source src="hero.webp" '
                                   'type="image/webp">') == ["hero.webp"])

# A stated limit, pinned so that removing it is a decision somebody
# makes rather than a coincidence. srcset is a list with descriptors,
# and reading it needs a parser this check does not have; the docstring
# says so alongside CSS image-set() and any URL a script assembles at
# runtime.
check("srcset is a known gap, not an accident",
      check_budget.page_references(
          '<img srcset="hero-2x.avif 2x" alt="">') == [])


# ------------------------------------------------------------------ #
# The stylesheet walk. Not in #80's wording, and load-bearing anyway:  #
# the redesign's vendored fonts arrive through @font-face, so a budget #
# that reads only tags in the HTML would watch ~140 KB land in silence.#

check("a url() in a stylesheet is found",
      check_budget.style_references(
          '@font-face { src: url("inter.woff2") format("woff2"); }')
      == ["inter.woff2"])

check("unquoted url() is read",
      check_budget.style_references("body { background: url(paper.png); }")
      == ["paper.png"])

check("an @import is found",
      check_budget.style_references('@import "tokens.css";')
      == ["tokens.css"])

check("a data: url in a stylesheet is skipped",
      check_budget.style_references(
          "li { list-style-image: url(data:image/gif;base64,R0lGOD); }")
      == [])

check("an external url() is skipped",
      check_budget.style_references(
          "@font-face { src: url(https://fonts.test/i.woff2); }") == [])

check("a url() inside a CSS comment is not counted",
      check_budget.style_references("/* url(sketch.png) */") == [])


# ------------------------------------------------------------------ #
# The arithmetic, as a pure function over a found-set.                 #

# 21,000 bytes across three files, heaviest first when ordered.
PAGE = [("your-page.html", 5000), ("form.js", 8500), ("theme.css", 7500)]
TOTAL = 21000


def budget(ceiling):
    return check_budget.budget_problems({"your-page.html": PAGE},
                                        {"your-page.html": ceiling})


check("a page under its ceiling has no problem", budget(23000) == [])

# The comparison is "over", not "at". A page landing exactly on its
# number has not exceeded it, and an off-by-one here would fail a gate
# for a change that spent nothing.
check("a page exactly at its ceiling has no problem", budget(TOTAL) == [])

over = budget(20000)
check("a page over its ceiling fails", len(over) == 1)
check("and the failure names the page, the total and the ceiling",
      "your-page.html" in over[0] and "21,000" in over[0]
      and "20,000" in over[0])

# Named so the fix is obvious without rerunning anything. form.js is
# the heaviest of the three and theme.css the second.
check("and it names the heaviest files",
      "form.js" in over[0] and over[0].index("form.js")
      < over[0].index("theme.css"))

stale = budget(30000)
check("a ceiling far above what the page measures fails as stale headroom",
      len(stale) == 1 and "stale" in stale[0].lower())
check("and it says what to lower the ceiling to",
      "23,100" in stale[0])

# The two constants have to agree, or a ceiling pinned by the rule this
# check states would fail the moment it was written.
check("a ceiling freshly pinned at the stated headroom passes both arms",
      budget(int(TOTAL * check_budget.HEADROOM)) == [])

check("a ceiling exactly at the stale limit passes",
      budget(int(TOTAL * check_budget.STALE_ABOVE)) == [])

check("and one byte past it fails",
      len(budget(int(TOTAL * check_budget.STALE_ABOVE) + 1)) == 1)

# The registry arm, the same shape CSP_PAGES has in tools/check_web.py:
# a table derived from what exists cannot fail when a page is added,
# and a new page is exactly when a budget gets forgotten.
missing_ceiling = check_budget.budget_problems({"new.html": PAGE}, {})
check("a page with no pinned ceiling fails",
      len(missing_ceiling) == 1 and "new.html" in missing_ceiling[0])

check("and it suggests a starting number rather than only complaining",
      "23,100" in missing_ceiling[0])

stale_pin = check_budget.budget_problems({}, {"gone.html": 10000})
check("a ceiling naming a page that does not exist fails",
      len(stale_pin) == 1 and "gone.html" in stale_pin[0])

# A page whose files are all unreadable measures zero, and the stale arm
# divides by what the page measures.
check("a page measuring nothing does not divide by zero",
      check_budget.budget_problems({"empty.html": []},
                                   {"empty.html": 10000}) == [])


# ------------------------------------------------------------------ #
# The real tree.                                                      #

INDEX = open(os.path.join(check_budget.WEB, "index.html"),
             encoding="utf-8").read()
INDEX_REFS = check_budget.page_references(INDEX)

# The decisive arm. If the extractor simply found nothing in real files,
# every string check above would still pass and each page would measure
# as one lone HTML file - a null result wearing a positive result's
# clothes.
check("the extractor finds real references in a real page",
      len(INDEX_REFS) >= 8)

check("and the stylesheet is among them", "theme.css" in INDEX_REFS)

# What the cover genuinely pulls in: the pre-paint theme script from the
# head, the body scripts that sign somebody in, and nav.js - which is
# here for the Theme disclosure this page carries at every width (#150)
# rather than for a rail it does not have.
check("and the scripts are among them",
      {"theme-init.js", "config.js", "ui.js", "session.js", "auth.js",
       "theme.js", "nav.js"} <= set(INDEX_REFS))

# The negative arm, and crypto.js is the right file to hold it: this
# page is the one page tools/check_web.py's check 11 refuses it on, so
# the day it appears in this set is the day the extractor started
# inventing references rather than reading them.
check("and a script the page does not load is not counted against it",
      "crypto.js" not in INDEX_REFS)

check("and the third-party widget is not",
      not any("telegram" in ref for ref in INDEX_REFS))

measured, unmeasurable = check_budget.measure()

# The arm that says WHICH tree, and it is load-bearing rather than
# bookkeeping (#181). This check answers "how many bytes travel", and
# after the split into a hand-written apps/web and a generated dist/
# there are two trees it could read. Pointed at the source it would
# measure a tree no visitor downloads and overstate every page by the
# weight of its own comments - 78% of theme.css - which is a wrong
# answer that looks exactly like a right one. Nothing else in the gate
# would notice, because every other property of the two trees is the
# same by construction.
check("the budget measures the published tree rather than the source",
      os.path.basename(check_budget.WEB) == "dist"
      and os.path.isdir(os.path.join(check_budget.REPO, "apps", "web")))

check("and the two trees are genuinely different bytes",
      len(open(os.path.join(check_budget.REPO, "apps", "web", "theme.css"),
               encoding="utf-8").read())
      > len(open(os.path.join(check_budget.WEB, "theme.css"),
                 encoding="utf-8").read()) + 40000)

check("every published page is measured",
      set(measured) == set(check_budget.html_pages()) and len(measured) >= 5)

check("every reference in the tree resolves, so nothing is unmeasurable",
      unmeasurable == [])

check("every published page has a pinned ceiling",
      set(measured) <= set(check_budget.CEILINGS))

check("every pinned ceiling names a page that exists",
      set(check_budget.CEILINGS) <= set(measured))

# A page always outweighs its own HTML, because every one of them loads
# the shared stylesheet. A measurement equal to the page file alone
# means the walk stopped.
check("a real page measures more than its own HTML file",
      all(sum(size for _f, size in parts)
          > dict(parts)[name] for name, parts in measured.items()))

check("the shared stylesheet is counted in every page",
      all("theme.css" in dict(parts) for parts in measured.values()))

check("so the gate passes on the tree as it stands",
      check_budget.problems() == [])


if failures:
    print("\ncheck_budget.py FAILED %d of %d checks" % (failures, performed))
    sys.exit(1)
if performed != EXPECTED:
    print("\ncheck_budget.py ran %d checks, expected %d - a check stopped "
          "running, or one was added without updating EXPECTED"
          % (performed, EXPECTED))
    sys.exit(1)
print("\ncheck_budget.py OK - %d checks" % performed)
