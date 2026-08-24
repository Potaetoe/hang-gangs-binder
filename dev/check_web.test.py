"""Contract checks for the publishability gate's own CSP handling.

`tools/check_web.py` has had no tests. Its only verification has ever been
manual mutation, and that is precisely why the attribute-order bug in #34
survived: a mutation is written against the *rule* - add `telegram.org` to
a page, watch it fail - so it never exercises the *parser* that has to find
the policy before any rule can be applied. Every mutation passed. The
policy was simply never read.

So this suite tests the parser on strings rather than on the five files it
happens to guard, and it tests the pin table for completeness rather than
for the pages that exist today.

No framework and no new dependency, matching the `.mjs` suites beside it -
a test runner is not needed to compare values.
"""

import os
import sys
import tempfile

# tools/ is not a package and check_web.py is a script, so the import has
# to be made reachable before it can be named. isort would hoist the
# import above the path insertion and break it, hence the explicit skip.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))

import check_web  # noqa: I001


failures = 0
performed = 0

# Counted AND asserted, which are two different jobs. Printing the count
# keeps a machine-knowable number out of prose - AGENTS.md's rule 4 - and
# comparing it catches the other direction: a check that stops running,
# behind an early return or a renamed helper, still prints a confident
# "OK" for every check that remains. dev/check_budget.test.py argues this
# at length and is where the pattern comes from.
EXPECTED = 588


def check(label, condition):
    global failures, performed
    performed += 1
    if not condition:
        failures += 1
    print("pass " if condition else "FAIL ", label)


def meta(policy, reversed_attrs=False):
    """One page's worth of head, with the CSP written either way round."""
    if reversed_attrs:
        tag = ('<meta content="%s" '
               'http-equiv="Content-Security-Policy">' % policy)
    else:
        tag = ('<meta http-equiv="Content-Security-Policy" '
               'content="%s">' % policy)
    return "<!doctype html>\n<html>\n<head>\n%s\n</head>\n</html>" % tag


BASIC = "default-src 'none'; script-src 'self'; base-uri 'none'"


# ------------------------------------------------------------------ #
# The parser.                                                         #

directives, problem = check_web.parse_csp(meta(BASIC))
check("a policy is parsed into directives",
      problem is None and directives is not None)
check("each directive keeps its source list in order",
      directives.get("script-src") == ["'self'"])
check("a valueless directive parses to an empty list",
      check_web.parse_csp(meta("upgrade-insecure-requests"))[0]
      .get("upgrade-insecure-requests") == [])

# The bug this issue is about. HTML does not care about attribute order;
# the old regexes did, and a miss made every CSP check skip in silence.
reversed_directives, reversed_problem = check_web.parse_csp(
    meta(BASIC, reversed_attrs=True))
check("attribute order does not hide a policy",
      reversed_problem is None and reversed_directives == directives)

# The shape of the bug, not just its two known instances. A parser that
# cannot read a thing must not report "no problem found".
_, unreadable = check_web.parse_csp(
    "<meta http-equiv=\"Content-Security-Policy\">")
check("a marker with no content is a reported problem, not a skip",
      isinstance(unreadable, str) and unreadable)

_, malformed = check_web.parse_csp(
    "<meta http-equiv=\"Content-Security-Policy\" content=\"\">")
check("an empty policy is a reported problem", isinstance(malformed, str))

# A page with no CSP at all is check 3's to report, not this parser's, so
# it is absence rather than a problem - and the two must stay distinct.
none_directives, none_problem = check_web.parse_csp("<html><head></head>")
check("no policy at all is absence, not a problem",
      none_directives is None and none_problem is None)

# Commented-out policies are not policies. The old code stripped comments
# and that behavior has to survive the rewrite.
commented_directives, _ = check_web.parse_csp(
    "<!-- %s -->" % meta("script-src 'unsafe-inline'"))
check("a policy inside an HTML comment is ignored",
      commented_directives is None)

dupe_directives, dupe_problem = check_web.parse_csp(
    meta("script-src 'self'; script-src 'unsafe-inline'"))
check("a repeated directive is a reported problem",
      isinstance(dupe_problem, str) and "script-src" in (dupe_problem or ""))


# ------------------------------------------------------------------ #
# The pin, and its completeness.                                      #

expected = check_web.EXPECTED_CSP

# The property that makes this a pin rather than a description: a page
# added tomorrow fails until somebody writes its policy down here. A table
# that only covers the pages that already exist is a table that stops
# being a check the moment the site grows.
pages = set(check_web.html_pages())
check("every published page has a pinned policy",
      pages and pages <= set(expected))
check("the pin names no page that does not exist",
      set(expected) <= pages)

check("the sign-in page is pinned with the Telegram exception",
      set(expected["index.html"]["script-src"]) ==
      {"'self'", "'unsafe-eval'", "https://telegram.org"})
check("no other page is pinned with 'unsafe-eval'",
      all("'unsafe-eval'" not in sources
          for name, policy in expected.items() if name != "index.html"
          for sources in policy.values()))
check("no other page is pinned with a Telegram origin",
      all("telegram.org" not in source
          for name, policy in expected.items() if name != "index.html"
          for sources in policy.values() for source in sources))

# default-src was outside checks 11 and 12 entirely, which is how a page
# could have widened every directive it does not set explicitly.
check("every page pins default-src",
      all("default-src" in policy for policy in expected.values()))
check("every page's default-src is 'none'",
      all(policy["default-src"] == ["'none'"]
          for policy in expected.values()))

# Fonts are the newest thing default-src 'none' silently forbids. A page
# that omits font-src still renders - in the fallback stack - so this is
# the directive whose absence no visitor and no other check reports.
check("every page pins font-src",
      all("font-src" in policy for policy in expected.values()))
# The other half, and the one that matters more. The whole reason the
# faces are vendored is that no request for them leaves this origin;
# a font-src that named a CDN would give that away while every other
# check here stayed green.
check("no page's font-src reaches past this origin",
      all(policy["font-src"] == ["'self'"]
          for policy in expected.values()))

# And the pin has to match what actually ships, or it is a table
# describing a site that does not exist.
check("no page's shipped policy differs from its pin",
      check_web.csp_policy_problems() == [])


# ------------------------------------------------------------------ #
# Check 10 - the shell each page carries.                             #

# The same property the CSP pin has, for the same reason. A shell table
# covering only the pages that already exist stops being a check the
# moment the site grows, and a page arriving is exactly when somebody
# copies a shell from whichever page they had open.
shells = check_web.SHELLS
check("every published page is pinned to a shell",
      pages and pages <= set(shells))
check("the shell pin names no page that does not exist",
      set(shells) <= pages)
check("the only shells are rail and plain",
      set(shells.values()) == {"rail", "plain"})

# Both kinds have to exist, or one of the two rule sets below is
# describing nothing. A table that had quietly become all-rail would
# leave the plain arms inert while every check here passed.
check("the pin covers both kinds of page",
      len([p for p, s in shells.items() if s == "rail"]) >= 2 and
      len([p for p, s in shells.items() if s == "plain"]) >= 1)

# The owner's decision on #73, pinned as a fact rather than left to the
# markup: no rail before sign-in.
check("the sign-in page is pinned plain", shells["index.html"] == "plain")
check("the error page is pinned plain", shells["404.html"] == "plain")
check("the signed-in pages are pinned to the rail",
      all(shells[page] == "rail"
          for page in ("your-page.html", "charts.html", "admin.html")))

# And the pin has to match what actually ships.
check("no page's shipped shell differs from its pin",
      check_web.shell_problems() == [])

# The rules, exercised on strings rather than on the five files, so they
# are tested for the shape of the failure and not for today's markup.
#
# The fixture is the ruled shape of #187: .rail-links lists where a
# signed-in member goes, and the route back to sign-in lives beside the
# session instead - the wordmark and the session block both carry it.
RAIL = (
    '<aside class="rail">'
    '<a class="wordmark" href="index.html"><span>Binder</span></a>'
    '<ul class="rail-links">'
    '<li><a href="your-page.html">Submit</a></li>'
    '<li><a href="charts.html">Progress</a></li>'
    '</ul>'
    '<div class="rail-session"><a id="sign-in" href="index.html">'
    'Sign in</a></div>'
    '</aside>'
    '<button id="theme-toggle"></button><div id="theme-chips"></div>'
)

check("a rail is read out of a page as its destinations, in order",
      [href for href, _ in check_web.rail_links(RAIL)] ==
      ["your-page.html", "charts.html"])
check("a page with no rail reads as absence rather than as empty",
      check_web.rail_links("<p>nothing here</p>") is None)

# The rail rules, both directions on each.
check("a complete rail raises nothing",
      check_web.rail_page_problems(RAIL) == [])
check("a rail page with no rail at all is reported",
      check_web.rail_page_problems("<p>nothing</p>") == ["has no rail"])

# The anti-stranding arm, reading the whole rail aside since #187: the
# route to sign-in may live in the wordmark or the session block, and
# only an aside carrying it nowhere is a rail somebody can be stranded
# behind. Both directions - the session block's copy alone satisfies
# it, and stripping every copy is refused.
check("the session block's route alone satisfies the stranding arm",
      check_web.rail_page_problems(
          RAIL.replace('<a class="wordmark" href="index.html">'
                       '<span>Binder</span></a>', '')) == [])
check("a rail aside with no route to sign-in anywhere is refused",
      any("stranded" in p for p in check_web.rail_page_problems(
          RAIL.replace('href="index.html"', 'href="charts.html"'))))

# The other direction of the same ruling: the door is session state,
# not navigation. A Sign in entry among the destinations is exactly
# what #187 removed, and an arm that only demanded the route somewhere
# would let it drift back in silence.
check("the door among the rail destinations is refused",
      any("door" in p for p in check_web.rail_page_problems(
          RAIL.replace('<li><a href="your-page.html">Submit</a></li>',
                       '<li><a href="index.html">Sign in</a></li>'
                       '<li><a href="your-page.html">Submit</a></li>'))))

# The hamburger is gone, and a page that kept it is a page that did not
# get the rail - which the parity arm alone would not catch, because two
# pages can carry the same stale markup.
check("a page still carrying the retired hamburger ids is refused",
      any("nav-toggle" in p for p in check_web.rail_page_problems(
          RAIL + '<button id="nav-toggle"></button>')))

# The plain rules, both directions. The second argument is whether this
# is the entrance; False is every plain page but one.
PLAIN = '<main><a href="index.html">Sign in</a></main>'
check("a plain page with a way off it raises nothing",
      check_web.plain_page_problems(PLAIN, False) == [])
check("a plain page carrying a rail is refused",
      any("session home" in p
          for p in check_web.plain_page_problems(PLAIN + RAIL, False)))

# The arm that stops "plain" from becoming "a dead end with nice
# typography". A fragment and an off-site link both leave a visitor
# where they started, so neither counts.
DEAD_END = "<main>Sorry.</main>"
check("a plain page with no way off it is refused",
      any("no way off it" in p
          for p in check_web.plain_page_problems(DEAD_END, False)))
check("a fragment is not a way off a page",
      any("no way off it" in p for p in check_web.plain_page_problems(
          '<a href="#top">back to top</a>', False)))
check("an off-site link is not a way through the site",
      any("no way off it" in p for p in check_web.plain_page_problems(
          '<a href="https://example.com">away</a>', False)))

# The entrance, exempt since #274 took the footers' nav off every page.
# It is the page every dead end already leads to - public.js returns a
# visitor with no session there and 404.html points at it - so there is
# nowhere it could strand somebody that they were not already going.
#
# The exemption is narrow on purpose, and this pair is what says so: the
# rail refusal still applies to it, because a session home on the page
# that signs people in is the copy-paste failure the shell table exists
# for and has nothing to do with stranding.
check("the entrance may carry no way off itself",
      check_web.plain_page_problems(DEAD_END, True) == [])
check("and is still refused a rail",
      any("session home" in p
          for p in check_web.plain_page_problems(RAIL, True)))

# Both directions on the pin that grants the exemption, which is the
# arm with teeth: an exemption whose subject is not published, or is
# published behind a rail, is an exemption belonging to no page while
# whichever plain page took its place strands people quietly.
check("the entrance is a page this site publishes",
      check_web.SIGN_IN_PAGE in check_web.html_pages())
check("and is the plain page it is excused as",
      check_web.SHELLS.get(check_web.SIGN_IN_PAGE) == "plain")

# The session block, the other half of the shell nothing was comparing
# (#200). The rail arm above reads .rail-links, so the block holding the
# session line, the door and the exit sat outside every comparison while
# being kept in three copies by hand - #152's disease with a different
# subject, exactly as the wordmark's was.
SESSION = check_web.rail_session(RAIL)

check("the session block is read out of a rail as a fragment",
      SESSION is not None and
      SESSION.startswith('<div class="rail-session"') and
      SESSION.endswith("</div>") and 'id="sign-in"' in SESSION)
check("a rail with no session block reads as absence",
      check_web.rail_session('<aside class="rail"></aside>') is None)

# The reason this is a depth-aware scan and not a non-greedy match: a
# session block that grows a wrapper stops at the wrapper's own closing
# tag, and the arm then compares three truncated fragments that agree
# about the half they can still see.
NESTED = RAIL.replace(
    '<a id="sign-in" href="index.html">Sign in</a>',
    '<div class="rail-door"><a id="sign-in" href="index.html">Sign in</a>'
    '</div>')
check("a session block containing a div is read whole",
      check_web.rail_session(NESTED).endswith("</div></div>"))
check("an unclosed session block reads as absence rather than as the "
      "rest of the page",
      check_web.rail_session('<div class="rail-session"><a>Sign in</a>')
      is None)

# What counts as a difference between two copies. Indentation does not:
# the three copies sit at three different depths on their pages the day
# somebody reflows one, and a failure nobody can act on is a failure
# everybody learns to re-run. Words and attributes do.
check("a fragment's indentation is not part of it",
      check_web.fragment_pieces(
          '<div class="rail-session">\n  <a>Sign in</a>\n</div>') ==
      check_web.fragment_pieces(
          '<div class="rail-session"><a>Sign in</a></div>'))
check("a fragment's words are part of it",
      check_web.fragment_pieces("<a>Sign in</a>") !=
      check_web.fragment_pieces("<a>Log in</a>"))
check("a fragment's attributes are part of it",
      check_web.fragment_pieces('<a id="sign-in"></a>') !=
      check_web.fragment_pieces('<a id="signin"></a>'))

# The parity arm itself, on fragments rather than on the three files, so
# what is exercised is the shape of the failure.
THREE = dict.fromkeys(("admin.html", "charts.html", "your-page.html"),
                      SESSION)

check("three identical session blocks raise nothing",
      check_web.session_parity_problems(THREE) == [])

drifted = check_web.session_parity_problems(
    dict(THREE, **{"your-page.html": SESSION.replace("Sign in", "Log in")}))
check("a session block that drifted on one page is refused",
      [name for name, _ in drifted] == ["your-page.html"])
check("the failure names a page to compare against",
      any("admin.html" in problem for _, problem in drifted))
check("the failure says which piece differs",
      any("'Log in'" in problem and "'Sign in'" in problem
          for _, problem in drifted))

# The other direction, and the one that says this is a parity arm rather
# than a pin: the same edit made on every copy is a rename, not a drift,
# and the copies are still identical afterwards.
check("the same edit on every copy raises nothing",
      check_web.session_parity_problems(
          {name: block.replace("Sign in", "Log in")
           for name, block in THREE.items()}) == [])
check("reindenting one copy is not a difference",
      check_web.session_parity_problems(
          dict(THREE, **{"charts.html": SESSION.replace("><", ">\n  <")}))
      == [])

check("a copy that runs on past the others is refused",
      any("carries" in problem for _, problem in
          check_web.session_parity_problems(
              dict(THREE,
                   **{"your-page.html": SESSION + "<span>and</span>"}))))
check("a copy that stops short of the others is refused",
      any("stops short" in problem for _, problem in
          check_web.session_parity_problems(
              dict(THREE,
                   **{"your-page.html": SESSION[:SESSION.index("<a ")]}))))

# The hole check 23 paid for in #114 and the wordmark arm remembers: a
# parity rule holding one copy cannot fail, so it says so instead of
# passing.
check("one session block left to compare is refused",
      any("cannot fail" in problem for _, problem in
          check_web.session_parity_problems({"admin.html": SESSION})))

# And the absence that would make parity vacuously true. A page that
# dropped its copy leaves the survivors agreeing with each other.
check("a rail page with no session block is refused",
      any("session block" in problem
          for problem in check_web.rail_page_problems(
              RAIL.replace(SESSION, ""))))

# The pin and the pages, so the arm is not comparing an empty set.
RAILED = sorted(name for name, shell in check_web.SHELLS.items()
                if shell == "rail")
check("every railed page ships a session block for the arm to compare",
      all(check_web.rail_session(check_web.page_text(name)) is not None
          for name in RAILED) and len(RAILED) >= 2)


# The wordmark, the one hand-kept copy nothing compares. Check 10's own
# docstring says the rail "carries the wordmark" while the comparison
# reads .rail-links and stops; the name tables read titles, headings and
# rail entries, and the chip arm reads chips. So the site's own name can
# be changed on all but one of its copies with the whole gate green -
# #152's disease with a different subject, found while #191 renamed them.
check("every page pinned to carry the wordmark exists",
      set(check_web.WORDMARK_PAGES) <= pages)
# Spelled out rather than derived from SHELLS. A pin computed as "the
# rail pages" could not fail when a rail page dropped its copy, which is
# the hole this arm exists to hold shut - and it would not reach the
# sign-in page at all, which is PLAIN in SHELLS and carries the mark
# outside any rail (#273). 404.html is absent because it is the plain
# page that stays plain, and the page a copied shell would hand the name
# to next.
#
# ONE equality, not an equality plus "and 404.html is not in it". The
# second conjunct was here and could not fail on its own: the equality
# already entails it, so nothing could redden it that had not reddened
# the equality first. An assertion that cannot fail reads to the next
# person as a guard, which is worse than no line at all.
check("the pin covers the rail pages and the sign-in page",
      set(check_web.WORDMARK_PAGES) ==
      {"admin.html", "charts.html", "index.html", "your-page.html"})

MARK = ('<span class="wordmark-owner">Hang Gang</span>'
        '<span class="wordmark-name">Binder</span>')

check("a wordmark is read out of a page as its two lines",
      check_web.page_wordmark(MARK) == ("Hang Gang", "Binder"))
check("a page with no wordmark reads as absence in both halves",
      check_web.page_wordmark("<p>nothing here</p>") == (None, None))
check("a wordmark line is read through the markup inside it",
      check_web.page_wordmark(
          '<span class="wordmark-owner"><em>Hang</em> Gang</span>')[0] ==
      "Hang Gang")
# Both quote styles, for the reason the label roles give: an arm a
# single quote walks past is a refusal that fails open while the gate
# reports the page as checked.
check("the wordmark reader is not walked past by a single quote",
      check_web.page_wordmark(
          "<span class='wordmark-name'>Binder</span>")[1] == "Binder")

# One page's own wordmark, before any page is compared with another.
check("a complete wordmark on a page pinned to carry one raises nothing",
      check_web.page_wordmark_problems(MARK, True) == [])
check("a page pinned to carry the wordmark and carrying none is refused",
      any("carries no wordmark" in p
          for p in check_web.page_wordmark_problems("<p>hello</p>", True)))
check("half a wordmark is refused",
      any("only the" in p for p in check_web.page_wordmark_problems(
          '<span class="wordmark-name">Binder</span>', True)))
check("a wordmark line with no words in it is refused",
      any("no words" in p for p in check_web.page_wordmark_problems(
          MARK.replace(">Hang Gang<", "><"), True)))

# The copy-paste direction, and the one that keeps the table honest: a
# page carrying the site's name and named by no pin is a copy nothing
# compares, which is the whole failure this arm exists for.
check("a page carrying a wordmark it is not pinned to carry is refused",
      any("names no page in WORDMARK_PAGES" in p
          for p in check_web.page_wordmark_problems(MARK, False)))
check("a page pinned plain of the wordmark and carrying none raises "
      "nothing",
      check_web.page_wordmark_problems("<p>Not found</p>", False) == [])

# Parity itself, on rosters rather than on files.
check("wordmarks that agree raise nothing",
      check_web.wordmark_parity_problems(
          {"a.html": ("Hang Gang", "Binder"),
           "b.html": ("Hang Gang", "Binder")}) == [])
check("a wordmark renamed on one copy of four is refused",
      any("Muse's" in p for p in dict(check_web.wordmark_parity_problems(
          {"admin.html": ("Hang Gang", "Binder"),
           "index.html": ("Hang Gang", "Binder"),
           "your-page.html": ("Hang Gang", "Binder"),
           "charts.html": ("Muse's", "Binder")})).values()))
check("a second line renamed on one copy is refused",
      any("Ledger" in p for p in dict(check_web.wordmark_parity_problems(
          {"a.html": ("Hang Gang", "Binder"),
           "b.html": ("Hang Gang", "Ledger")})).values()))
# One roster is not a parity claim. The chip arm paid for this exact
# hole in #114: a rule holding a single copy cannot fail.
check("a single wordmark leaves the arm nothing to compare",
      any("cannot fail" in p for _, p in
          check_web.wordmark_parity_problems({"a.html": ("Hang Gang",
                                                         "Binder")})))

check("no shipped page's wordmark disagrees with another's",
      check_web.wordmark_problems() == [])

# THE ORDER OF THE TWO LINES. WORDMARK_LINES is a sequence and its
# positions are the words "first" and "second", but nothing read it as
# an order: wordmark_line() runs an independent search per component
# over the whole document, so the spans carried no positional
# information and the mark could be drawn inverted - "Binder" in italic
# display over "HANG GANG" in gold - with the whole of check 10 green.
# Confirmed by mutation on all four pages at once, which is also why
# parity cannot cover it: four copies agreeing on the wrong mark satisfy
# a comparison between copies.
check("the two lines in the ruled order raise nothing",
      check_web.wordmark_order_problems(MARK) == [])
check("the two lines swapped are refused",
      any("above the" in p for p in check_web.wordmark_order_problems(
          '<span class="wordmark-name">Binder</span>'
          '<span class="wordmark-owner">Hang Gang</span>')))
# A half-read mark is page_wordmark_problems()'s to report, and saying
# it twice is how one of the two gets weakened.
check("a mark with one line missing is left to the arm above",
      check_web.wordmark_order_problems(
          '<span class="wordmark-owner">Hang Gang</span>') == [])

# WHERE the mark sits, which is the owner's one ruled fact about it
# (#273's addendum) and had no arm at all: the roster pins THAT a page
# carries the mark and parity pins WHAT it says, so the whole thing
# could be moved below the sign-in form and the footer with three suites
# green. Confirmed by mutation before this arm was written.
#
# Containment inside body's first element, not a line number, because
# this site draws the mark two ways - standing first itself on the
# sign-in page, and standing first INSIDE the rail on the other three -
# and a positional rule that knew one of them would have to name pages.
RAILED = ('<body class="railed"><aside class="rail">'
          '<a class="wordmark" href="index.html">%s</a></aside>'
          "<main>page</main></body>" % MARK)
PLAIN_TOP = ('<body><p class="wordmark">%s</p><header><h1>Sign in</h1>'
             "</header></body>" % MARK)

check("the mark standing first inside the rail raises nothing",
      check_web.wordmark_placement_problems(RAILED) == [])
check("the mark standing first in the body itself raises nothing",
      check_web.wordmark_placement_problems(PLAIN_TOP) == [])
check("the mark moved below the page's content is refused",
      any("outside the first element" in p
          for p in check_web.wordmark_placement_problems(
              '<body><header><h1>Sign in</h1></header><main>form</main>'
              '<p class="wordmark">%s</p></body>' % MARK)))
# A comment or a stray newline before the mark is not the mark moving,
# and an arm that read raw offsets would say it was.
check("a comment before the mark is not the mark moving",
      check_web.wordmark_placement_problems(
          "<body>\n<!-- why the mark is here -->\n" +
          PLAIN_TOP[len("<body>"):]) == [])
check("a page carrying no mark is left to the roster arm",
      check_web.wordmark_placement_problems(
          "<body><main>Not found</main></body>") == [])
# Loud rather than quiet when the body cannot be read at all: a reader
# that returns nothing for markup it could not parse prints the same OK
# as one that found nothing wrong.
check("markup with no body is reported rather than passed",
      any("no <body>" in p for p in check_web.wordmark_placement_problems(
          '<p class="wordmark">%s</p>' % MARK)))


# ------------------------------------------------------------------ #
# Check 19 - the palette control, one shape on every page that offers  #
# one, in a footer that holds it and nothing else.                     #

# The pin first, because every rule below describes whichever pages it
# names. There is one table since #274: the owner ruled the floating
# Theme <details> off the signed-in pages and made every footer the row
# of swatches index.html has always carried, so the split #187
# introduced is gone and the property the row was chosen for - a
# control with no hidden state cannot be open over anything, however it
# fails - now belongs to every page.
check("every page but the error page offers a palette",
      check_web.THEMED_PAGES ==
      {"index.html", "your-page.html", "charts.html", "admin.html"})
# NAMED on the other side rather than merely absent, and that is the
# whole of what UNTHEMED_PAGES is for. Before #274, absence from the
# first table meant "this page offers no palette"; since the ruling it
# also means "this page carries no footer", because the footer IS the
# row - so a page nobody remembers to add shipped with neither while the
# arm that would have said so read the table to decide whether to look.
# SHELLS closes exactly this asymmetry one table up.
check("the error page is pinned to offer no palette at all",
      check_web.UNTHEMED_PAGES == {"404.html"} and
      "404.html" not in check_web.THEMED_PAGES)


def with_untheme(pinned, read):
    """`read()` with UNTHEMED_PAGES swapped for `pinned`."""
    shipped = check_web.UNTHEMED_PAGES
    try:
        check_web.UNTHEMED_PAGES = frozenset(pinned)
        return read()
    finally:
        check_web.UNTHEMED_PAGES = shipped


def palette_pins_over(names):
    """theme_control_page_problems() against a directory of empty pages."""
    with tempfile.TemporaryDirectory() as folder:
        for name in names:
            with open(os.path.join(folder, name), "w",
                      encoding="utf-8") as handle:
                handle.write("<!doctype html><body><main>page</main></body>")
        shipped = check_web.WEB
        try:
            check_web.WEB = folder
            return check_web.theme_control_page_problems()
        finally:
            check_web.WEB = shipped


# THE ABSENCE DIRECTION. A page in neither table is the one that prints
# OK with no palette AND no footer, because the arm reads the table to
# decide whether to look.
check("a published page in neither table is refused",
      any("named in neither THEMED_PAGES nor UNTHEMED_PAGES" in problem
          for page, problem in palette_pins_over(["new.html"])
          if page == "new.html"))
check("and a page named on one side is not",
      not any(page == "404.html" and "neither" in problem
              for page, problem in palette_pins_over(["404.html"])))
# A page in BOTH answers one question twice, and whichever arm reads
# first becomes the answer.
check("a page pinned in both tables is refused",
      any("BOTH THEMED_PAGES and UNTHEMED_PAGES" in problem
          for _page, problem in with_untheme(
              check_web.THEMED_PAGES | {"404.html"},
              lambda: palette_pins_over(["404.html"]))))

# And the pins have to match what actually ships.
check("no shipped page's palette control differs from its pin",
      check_web.theme_control_page_problems() == [])

# The rules on strings, both directions on each. SWATCH_MARKUP is the
# whole control: a row in flow, and a dot named by its aria-label
# because there are no words in a dot.
SWATCH_MARKUP = (
    '<div class="theme-swatches" role="group" aria-label="Color theme">'
    '<button data-set-theme="midnight" aria-label="Midnight">'
    '<span class="swatch-dot" data-palette="midnight"></span></button>'
    '</div>'
)

# The control #274 removed, kept here as the thing every arm below
# refuses rather than as a shape any page may carry.
FLYOUT_MARKUP = (
    '<details class="theme-picker">'
    '<summary>Theme</summary>'
    '<div class="theme-flyout"><button data-set-theme="midnight">Midnight'
    '</button></div>'
    '</details>'
)

check("a complete swatch row on a page that offers a palette raises "
      "nothing",
      check_web.theme_control_problems(SWATCH_MARKUP, True) == [])
check("a page pinned to offer none, carrying none, raises nothing",
      check_web.theme_control_problems('<main>Sorry.</main>', False) == [])

# The ruling reversed rather than drifting, and it is refused on a page
# that offers a palette and on one that does not alike - because the
# hazard is the hidden state, not which page inherited it.
check("a disclosure on a themed page is refused",
      any("hides its palette" in p for p in check_web.theme_control_problems(
          SWATCH_MARKUP + FLYOUT_MARKUP, True)))
check("a disclosure on a page that offers no palette is refused too",
      any("hides its palette" in p for p in check_web.theme_control_problems(
          FLYOUT_MARKUP, False)))
# The class is the half a rebuild drops first, so the word is refused
# beside the element: a <summary> still reading "Theme" is the same
# control arriving without the name this file finds it by.
check("a bare Theme summary is refused even with no theme-picker class",
      any("hides its palette" in p for p in check_web.theme_control_problems(
          SWATCH_MARKUP + "<summary>Theme</summary>", True)))

check("a themed page with chips and no swatch row is refused",
      any("theme-swatches" in p for p in check_web.theme_control_problems(
          '<button data-set-theme="pink" aria-label="Pink"></button>', True)))
check("a themed page with a swatch row and no chip is refused",
      any("data-set-theme" in p for p in check_web.theme_control_problems(
          '<div class="theme-swatches"></div>', True)))

# Chips beside the row rather than inside it are missed by the spacing,
# the target size and the pressed mark alike. The arm is a COUNT, not a
# "does the row hold any chip": one chip left outside a row that still
# holds three answers yes to that question, which is how the same arm's
# previous shape passed a live mutation.
check("ONE chip outside a row that still holds others is refused",
      any("1 of its 2" in p for p in check_web.theme_control_problems(
          '<div class="theme-swatches">'
          '<button data-set-theme="midnight" aria-label="Midnight"></button>'
          '</div>'
          '<button data-set-theme="pink" aria-label="Pink"></button>', True)))
# A row that never closes swallows the rest of the page, and a reader
# that stopped at the first close tag would have reported the chips as
# loose instead.
check("a swatch row that never closes is refused as unreadable",
      any("never closes" in p for p in check_web.theme_control_problems(
          '<div class="theme-swatches">'
          '<button data-set-theme="midnight" aria-label="M"></button>'
          '<button data-set-theme="pink" aria-label="P"></button>', True)))
check("a nested element does not end the row early",
      check_web.theme_control_problems(
          '<div class="theme-swatches">'
          '<div><button data-set-theme="midnight" aria-label="M"></button>'
          '</div>'
          '<button data-set-theme="pink" aria-label="P"></button></div>',
          True) == [])

# The retired hooks, refused on every page rather than merely absent.
# Nothing reads them - no page has a disclosure at all now - so an id
# left behind is what the next page copied from this one inherits.
for RETIRED in ("theme-toggle", "theme-chips"):
    check("id=%s is refused on a themed page" % RETIRED,
          any(RETIRED in p for p in check_web.theme_control_problems(
              SWATCH_MARKUP + '<div id="%s"></div>' % RETIRED, True)))
    check("id=%s is refused on a page that offers no palette" % RETIRED,
          any(RETIRED in p for p in check_web.theme_control_problems(
              '<div id="%s"></div>' % RETIRED, False)))

# The absent direction, which is what stops a control landing on the
# error page the way every other copy-paste failure here lands.
check("a page pinned to offer no palette, carrying a chip, is refused",
      any("stored preference" in p
          for p in check_web.theme_control_problems(
              '<button data-set-theme="pink">P</button>', False)))
check("a page pinned to offer no palette, carrying a swatch row, "
      "is refused",
      any("not pinned in THEMED_PAGES" in p
          for p in check_web.theme_control_problems(
              '<div class="theme-swatches"></div>', False)))

# The stale-pin arm. A roster entry with no page behind it is a check
# that cannot fail, which is the failure #114 paid for - so it is
# exercised here rather than assumed, by pinning a page that does not
# ship and putting the real set back immediately.
SHIPPING_THEMED = check_web.THEMED_PAGES
check_web.THEMED_PAGES = SHIPPING_THEMED | {"nowhere.html"}
check("a themed-page pin with no page behind it is refused",
      any(page == "nowhere.html"
          for page, _problem in check_web.theme_control_page_problems()))
check_web.THEMED_PAGES = SHIPPING_THEMED
check("the real pin is back after the stale-pin arm",
      check_web.theme_control_page_problems() == [])


# ------------------------------------------------------------------ #
# Check 19's footer arm - the owner's ruling on #274, which is that    #
# every footer is the swatch row and nothing else.                    #
#                                                                       #
# THE CUSTOM-PALETTE EDITOR THIS ARM ONCE HELD REQUIRED IS GONE          #
# (0.9-M2-S14, #380 ruling 2, superseding 0.9-M2-S6/#82 and              #
# 0.9-M2-S13/#378 entirely): the custom theme itself is retired, so      #
# footer_problems() reverts to the ruling's original, simpler shape -    #
# the row, and nothing beside it; every fixture below drops             #
# EDITOR_MARKUP accordingly.                                            #

# This is the arm with reach, and the reason it had to exist is the
# two cases nothing else in check_web.py can see: an off-site href is
# not a destination, so DESTINATIONS and the anti-stranding arm are
# both blind to it by construction; and an on-site link that spells
# its destination's own name satisfies the name table exactly. Before
# this, two of the four footers could have taken their nav back with
# the whole gate green.
FOOTER_OK = "<footer>%s</footer>" % SWATCH_MARKUP

check("a footer holding only the swatch row raises nothing",
      check_web.footer_problems(FOOTER_OK, True) == [])
check("a page that offers no palette and has no footer raises nothing",
      check_web.footer_problems("<main>Sorry.</main>", False) == [])

# The link, both spellings, because the ruling is about navigation and
# not about where it points.
check("an on-site link in a footer is refused",
      any("link in its footer" in p for p in check_web.footer_problems(
          "<footer>%s<p><a href=\"charts.html\">Muse's charts</a></p>"
          "</footer>" % SWATCH_MARKUP, True)))
check("an off-site link in a footer is refused",
      any("link in its footer" in p for p in check_web.footer_problems(
          '<footer>%s<p><a href="https://example.com">Read the code</a>'
          "</p></footer>" % SWATCH_MARKUP, True)))
# A link INSIDE the row would be cut out with it, so the arm reads what
# is left rather than the whole footer - and that is the direction this
# says out loud rather than leaving to the reader.
check("markup beside the row is refused even with no link in it",
      any("markup in its footer" in p for p in check_web.footer_problems(
          "<footer>%s<p><strong>Nearly</strong></p></footer>"
          % SWATCH_MARKUP, True)))
check("bare words beside the row are refused",
      any("words in its footer" in p for p in check_web.footer_problems(
          "<footer>%s Nearly nothing</footer>" % SWATCH_MARKUP, True)))
check("a link ahead of the row is refused too - the arms below are not "
      "positional any more, they read everything beside the row",
      any("link in its footer" in p for p in check_web.footer_problems(
          "<footer><p><a href=\"https://example.com\">Read the code</a>"
          "</p>%s</footer>" % SWATCH_MARKUP, True)))

# The two directions on the element itself.
check("a themed page with no footer at all is refused",
      any("carries no <footer>" in p
          for p in check_web.footer_problems(SWATCH_MARKUP, True)))
check("a page that offers no palette and carries a footer is refused",
      any("offers no palette and carries a <footer>" in p
          for p in check_web.footer_problems("<footer><p>Hi</p></footer>",
                                             False)))
# Two footers would leave this arm reading one and the ruling describing
# neither.
check("a second footer is refused",
      any("2 <footer> elements" in p for p in check_web.footer_problems(
          FOOTER_OK + "<footer><p>Also</p></footer>", True)))

# THE ROW MISSING FROM THE FOOTER, which is a failure here rather than
# a silent return. The arm one function down searches the WHOLE page for
# the row, so a footer arm that says nothing about the row's absence
# leaves "the row is on the page but not in the footer, and the footer
# is full of nav" with no reader at all - the owner's ruling reversed on
# one page with the gate green.
check("a themed page whose footer holds no swatch row is refused",
      any("no .theme-swatches row inside it" in p
          for p in check_web.footer_problems(
              '<footer><p><a href="your-page.html">Your page</a></p>'
              "</footer>" + SWATCH_MARKUP, True)))
# and the failure is the one a reader can act on: it says where to look
# for the row rather than only that the footer is wrong.
check("and it says the arm below owns where the row went",
      any("the arm below" in p for p in check_web.footer_problems(
          "<footer><p>nothing</p></footer>" + SWATCH_MARKUP, True)))

# INSIDE the row, which element_span() cuts out before the arms above
# read - so a reader that cut it out and never looked in it had moved
# the hiding place rather than closed it. `.theme-swatches` is
# `display: flex`, so a paragraph in there paints as a flex item beside
# the dots: a footer with prose links in it.
check("a link inside the swatch row is refused",
      any("INSIDE its .theme-swatches row" in p
          for p in check_web.footer_problems(
              "<footer>%s</footer>" % SWATCH_MARKUP.replace(
                  "</div>",
                  '<p><a href="https://example.com">Read the code</a></p>'
                  "</div>"), True)))
check("markup inside the swatch row is refused with no link in it",
      any("INSIDE its .theme-swatches row" in p
          for p in check_web.footer_problems(
              "<footer>%s</footer>" % SWATCH_MARKUP.replace(
                  "</div>", "<p><strong>Nearly</strong></p></div>"), True)))
check("bare words inside the swatch row are refused",
      any("words INSIDE its .theme-swatches row" in p
          for p in check_web.footer_problems(
              "<footer>%s</footer>" % SWATCH_MARKUP.replace(
                  "</div>", "Nearly nothing</div>"), True)))
# The swatches themselves are what the row is FOR, so they are cut out
# at depth and what is left is what is read - the same move one level
# down from the footer arm's.
check("the swatch buttons themselves are not read as intruders",
      check_web.swatch_row_problems(SWATCH_MARKUP) == [])
check("a swatch button that never closes is reported rather than assumed",
      any("never closes" in p for p in check_web.swatch_row_problems(
          '<div class="theme-swatches"><button data-set-theme="pink">'
          "</div>")))


# ------------------------------------------------------------------ #
# Check 14 - a key literal outside config.js.                         #

# The rule is exercised on strings, and the corpus mutation below is
# built from the key config.js actually carries rather than from a
# string shaped like the pattern. That distinction is the whole lesson
# of #34: a mutation written against the regex proves the regex can
# match, never that the check reaches the real content.
CONFIG_TEXT = open(
    os.path.join(check_web.WEB, check_web.CONFIG_FILE), encoding="utf-8"
).read()

check("the file allowed to carry a key does carry one",
      check_web.key_literal_problem(CONFIG_TEXT) is not None)

# The decisive one. If the pattern simply found nothing in this
# repository, every check here would pass and the arm would be inert -
# a null result wearing a positive result's clothes. This says the
# exemption is what spares config.js, not the pattern failing to fire.
check("config.js is spared by name, not by the pattern missing it",
      check_web.CONFIG_FILE not in
      [rel for rel, _ in check_web.hard_coded_key_hits()])
check("apps/web carries no key literal outside config.js",
      check_web.hard_coded_key_hits() == [])

# The realistic accident #41 names: the production key, or a prefix of
# it, pasted into a page to "check the layout". Taken verbatim out of
# config.js so this cannot pass by testing a different string than the
# one that matters.
REAL_KEY = check_web.KEY_LITERAL.search(CONFIG_TEXT).group(0)
PAGE = "<p id=\"key-fingerprint\">%s</p>\n<script>const k = %s;</script>"
check("the real key pasted into a page is caught",
      check_web.key_literal_problem(PAGE % ("", REAL_KEY)) is not None)

# Both directions at the boundary. 60 is the threshold; 59 must pass, or
# the check is a tripwire across ordinary content.
check("a 60-character base64 run is caught",
      check_web.key_literal_problem('"%s"' % ("A" * 60)) is not None)
check("a 59-character base64 run is not",
      check_web.key_literal_problem('"%s"' % ("A" * 59)) is None)
check("ordinary long prose is not a key",
      check_web.key_literal_problem(
          '"the quick brown fox jumps over the lazy dog, and then does '
          'it again, at considerable length, without stopping"') is None)

# The message goes into a CI log. Reporting the literal would publish
# the thing the check exists to keep out of public places.
REPORT = check_web.key_literal_problem('"%s"' % REAL_KEY.strip('"\''))
check("the report names a prefix and a length, not the literal",
      REAL_KEY.strip('"\'') not in REPORT and "characters" in REPORT)


# ------------------------------------------------------------------ #
# Check 15 - every module's exported namespace is frozen.             #

# Exercised on strings, for #34's reason: a mutation written against the
# nine modules in apps/web tests today's apps/web, and what has to hold
# is the shape of the failure. The live directory is asserted too, but
# separately and for a different claim - see "reaches real content".

FROZEN = """(function (root) {
  function helper() { return 1; }
  root.BinderThing = Object.freeze({ helper: helper });
})(globalThis);
"""
UNFROZEN = FROZEN.replace("Object.freeze({ helper: helper })",
                          "{ helper: helper }")

check("a frozen namespace raises nothing",
      check_web.export_problems("thing.js", FROZEN, "BinderThing") == [])
check("an unfrozen namespace is refused",
      len(check_web.export_problems("thing.js", UNFROZEN, "BinderThing")) == 1)

# The #34 direction, and the one this whole table exists for. A checker
# that cannot find what it was pointed at must not answer "no problem
# found" - that reading is indistinguishable from a clean file, and it
# is the one people believe.
EMPTY = ("(function (root) {\n  function helper() { return 1; }\n"
         "})(globalThis);\n")
absent = check_web.export_problems("thing.js", EMPTY, "BinderThing")
check("a module that assigns nothing is reported as absence, not a pass",
      len(absent) == 1 and "assigns it nowhere" in absent[0])
check("the absence report says the pin may be the stale half",
      "stale" in absent[0])

# A file with no exports at all, pinned as having none, is the legitimate
# state - so absence is only a failure against a pin that claims one.
check("a file pinned to publish nothing, publishing nothing, raises nothing",
      check_web.export_problems("thing.js", EMPTY, None) == [])

TWICE = FROZEN.replace(
    "})(globalThis);",
    "  root.BinderThing = Object.freeze({ helper: helper });\n})(globalThis);")
twice = check_web.export_problems("thing.js", TWICE, "BinderThing")
check("a namespace published twice is refused",
      any("2 times" in p for p in twice))

# dashboard.js's actual shape before this issue: frozen at the
# assignment is not the same claim as frozen when the module finishes.
LATE = FROZEN.replace(
    "})(globalThis);",
    "  root.BinderThing.render = render;\n})(globalThis);")
late = check_web.export_problems("thing.js", LATE, "BinderThing")
check("a member assigned after publication is refused even when frozen",
      len(late) == 1 and "after the object is published" in late[0])
check("the late-member report names the member",
      "BinderThing.render" in late[0])

# The regex boundary that makes the rule above possible: what follows
# the namespace in `root.X.y = ...` is a dot, not an equals sign, so a
# late member must not also read as a second publish site.
check("a member assignment does not read as a second publish site",
      not any("2 times" in p for p in late))

# countries.js publishes through `window.`, so a pattern that knew only
# root/globalThis would have been blind to an export style already here.
check("a namespace published through window. is recognized",
      check_web.export_problems(
          "thing.js", FROZEN.replace("root.Binder", "window.Binder"),
          "BinderThing") == [])
check("an unfrozen window. namespace is still refused",
      len(check_web.export_problems(
          "thing.js", UNFROZEN.replace("root.Binder", "window.Binder"),
          "BinderThing")) == 1)

# The other direction on the roster: a script pinned as publishing
# nothing that grows an export.
sneak = check_web.export_problems("thing.js", FROZEN, None)
check("a global in a file pinned to publish nothing is refused",
      len(sneak) == 1 and "publishing nothing" in sneak[0])

# A second, unpinned global inside a real module.
second = check_web.export_problems(
    "thing.js",
    FROZEN.replace("})(globalThis);",
                   "  root.BinderExtra = Object.freeze({});\n})(globalThis);"),
    "BinderThing")
check("a second unpinned global in a module is refused",
      len(second) == 1 and "BinderExtra" in second[0])

# Prose about an export is not an export - the same distinction
# strip_js_comments draws for fetch() in check 6.
check("a commented-out assignment is not an assignment",
      check_web.export_problems(
          "thing.js", FROZEN + "// root.BinderGhost = {};\n",
          "BinderThing") == [])
check("a comparison is not an assignment",
      check_web.export_problems(
          "thing.js",
          FROZEN.replace("})(globalThis);",
                         "  if (root.BinderOther === 1) return;\n"
                         "})(globalThis);"),
          "BinderThing") == [])

# Line numbers are the reason strip_js_comments blanks rather than
# deletes. A report that names a line hundreds of rows off sends the
# reader somewhere innocent, which is worse than naming no line at all.
PADDED = "/*\n%s\n*/\n%s" % ("\n".join([" * filler"] * 40), UNFROZEN)
padded = check_web.export_problems("thing.js", PADDED, "BinderThing")
check("a line number survives a comment block above it",
      "line 45" in padded[0])
check("blanking a comment preserves the length of the source",
      len(check_web.strip_js_comments(PADDED)) == len(PADDED))
check("blanking a comment preserves every newline",
      check_web.strip_js_comments(PADDED).count("\n") == PADDED.count("\n"))

# ------------------------------------------------------------------ #
# The roster tables, for completeness rather than for today's files.  #

SCRIPTS = {n for n in os.listdir(check_web.WEB) if n.endswith(".js")}

check("every published script is pinned in exactly one table",
      SCRIPTS == (set(check_web.MODULE_EXPORTS)
                  ^ set(check_web.NO_MODULE_EXPORT)))
check("the two tables name no script in common",
      not (set(check_web.MODULE_EXPORTS) & set(check_web.NO_MODULE_EXPORT)))
check("neither table names a script that does not exist",
      (set(check_web.MODULE_EXPORTS) | set(check_web.NO_MODULE_EXPORT))
      <= SCRIPTS)
check("the roster covers both kinds of script",
      check_web.MODULE_EXPORTS and check_web.NO_MODULE_EXPORT)
check("every exemption names a script that exists",
      all(name in SCRIPTS for name, _ in check_web.NON_NAMESPACE_GLOBALS))

# REACHES REAL CONTENT. Every check above this line would pass against a
# directory the rule never actually read - the null result wearing a
# positive result's clothes that dev/check_web.test.py already guards
# against for the key-literal arm. This says the freeze was found in the
# shipped bytes of every module on the roster.
frozen_in_place = []
for module, namespace in sorted(check_web.MODULE_EXPORTS.items()):
    source = open(os.path.join(check_web.WEB, module), encoding="utf-8").read()
    frozen_in_place.append(
        bool(check_web.frozen_publish(check_web.strip_js_comments(source),
                                      namespace)))
check("every module on the roster freezes its export in the shipped file",
      # 13, not 12: nav.js joined MODULE_EXPORTS at 0.9-M3-S33 (#457),
      # publishing BinderNav once the bottom bar's admin-gate needed a
      # pure read (isAdminVia) a suite could exercise without a
      # document - moved out of NO_MODULE_EXPORT, where it had sat since
      # nav.js assigned no global at all. site-content.js joined at
      # 0.9-M3-S12 (#418), publishing BinderSiteContent; theme-init.js
      # left the roster earlier, at 0.9-M2-S14 (#380 ruling 2), when the
      # custom theme it published (BinderCustomPalette) retired with it.
      len(frozen_in_place) == 13 and all(frozen_in_place))
check("apps/web raises no export problem",
      check_web.module_export_problems() == [])


# ------------------------------------------------------------------ #
# The config.js freeze and lock (check 5 resolution + lock,           #
# check 15 roster). BINDER_CONFIG carries the key every submission    #
# encrypts to, so both swap vectors have to be undroppable.           #

# config_environments takes source now, so its pins run on strings the
# way export_problems does. This one guards the assignment that carries
# the key, so its reassignment lock must be falsifiable without editing
# the shipped config.
CONFIG_ENV_OK = """
const ENVIRONMENTS = {
  "potaetoe.github.io": {
    name: "production",
    endpoint: "https://prod.example.workers.dev",
    publicKey: "PRODKEYPRODKEYPRODKEY",
  },
  "localhost": {
    name: "development",
    endpoint: "https://dev.example.workers.dev",
    publicKey: "DEVKEYDEVKEYDEVKEY",
  },
};
ENVIRONMENTS["127.0.0.1"] = ENVIRONMENTS.localhost;
globalThis.BINDER_CONFIG = Object.freeze(
  ENVIRONMENTS[location.hostname] || { name: "unknown", publicKey: null }
);
Object.defineProperty(globalThis, "BINDER_CONFIG", {
  writable: false,
  configurable: false,
});
"""

check("a well-formed config resolves with no problem",
      check_web.config_environments(CONFIG_ENV_OK)[1] == [])

# 0.9-M1-S10 (#339): an arm outside {production, development} may
# declare `publicKey: null` on purpose - DESIGN.md, "Trust model: the
# Worker reads", 0.9 is keyless - rather than carry a key it has no use
# for. Both directions belong here: the null resolves clean, a
# forgotten field still does not, and the escape hatch stays closed to
# the two arms that still carry a real key.
CONFIG_ENV_WITH_KEYLESS_ARM = CONFIG_ENV_OK.replace(
    '  },\n};',
    '  },\n'
    '  "sit.example.workers.dev": {\n'
    '    name: "sit",\n'
    '    endpoint: "https://sit.example.workers.dev",\n'
    '    publicKey: null,\n'
    '  },\n'
    '};', 1)
check("a keyless arm outside production/development resolves with no "
      "problem",
      check_web.config_environments(CONFIG_ENV_WITH_KEYLESS_ARM)[1] == [])

CONFIG_ENV_MISSING_KEY_FIELD = CONFIG_ENV_WITH_KEYLESS_ARM.replace(
    '    publicKey: null,\n', '')
check("an arm that omits publicKey entirely is still refused - only a "
      "written-out null counts as a declaration",
      any("no literal publicKey" in p for p in check_web.config_environments(
          CONFIG_ENV_MISSING_KEY_FIELD)[1]))

CONFIG_ENV_PRODUCTION_GONE_KEYLESS = CONFIG_ENV_OK.replace(
    'publicKey: "PRODKEYPRODKEYPRODKEY"', 'publicKey: null')
check("production cannot declare itself keyless by writing null",
      any("no literal publicKey" in p for p in check_web.config_environments(
          CONFIG_ENV_PRODUCTION_GONE_KEYLESS)[1]))

# The resolution arm, unchanged in intent by the freeze wrapper: an
# unknown host must fall through to the closed, keyless object.
NO_FALLBACK = CONFIG_ENV_OK.replace(
    ' || { name: "unknown", publicKey: null }', "")
check("a config with no keyless fallback is refused",
      any("closed, keyless arm" in p
          for p in check_web.config_environments(NO_FALLBACK)[1]))

# The reassignment lock, three ways it can be dropped. Each leaves the
# frozen object sitting behind a global a script can still overwrite.
NO_LOCK = CONFIG_ENV_OK[:CONFIG_ENV_OK.index("Object.defineProperty")]
check("a config that never locks the global is refused",
      any("reassigned before form.js reads" in p
          for p in check_web.config_environments(NO_LOCK)[1]))
check("a lock left writable is refused",
      any("writable: false" in p for p in check_web.config_environments(
          CONFIG_ENV_OK.replace("writable: false", "writable: true"))[1]))
check("a lock left configurable is refused",
      any("configurable: false" in p for p in check_web.config_environments(
          CONFIG_ENV_OK.replace(
              "configurable: false", "configurable: true"))[1]))

# REACHES REAL CONTENT. The string arms above prove the pins fire; this
# proves the shipped config.js actually satisfies them - the lock is in
# the bytes, not only in a crafted fixture.
check("the shipped config.js resolves closed and locked",
      check_web.config_environments()[1] == [])

# The hole this issue names: export_problems continued on BINDER_CONFIG
# in NON_NAMESPACE_GLOBALS before any freeze test, so deleting the freeze
# raised nothing. config.js is on the roster now, so the export freeze
# rule reaches it - stripping Object.freeze from the shipped bytes is
# refused where it once passed in silence.
STRIPPED_FREEZE = check_web.strip_js_comments(CONFIG_TEXT).replace(
    "Object.freeze(", "(", 1)
stripped = check_web.export_problems(
    check_web.CONFIG_FILE, STRIPPED_FREEZE, "BINDER_CONFIG")
check("config.js with its freeze stripped is refused by the roster",
      len(stripped) == 1 and "without Object.freeze" in stripped[0])
check("config.js is held to the freeze rule, not exempted from it",
      check_web.MODULE_EXPORTS.get("config.js") == "BINDER_CONFIG" and
      ("config.js", "BINDER_CONFIG") not in check_web.NON_NAMESPACE_GLOBALS)


# ------------------------------------------------------------------ #
# Check 16 - the label roles.                                         #

# The table itself, before any markup is read. A role with no sentence
# behind it produces a failure message that cannot say what the reader
# should have written instead.
check("every label role says what job it does",
      all(isinstance(why, str) and why
          for why in check_web.LABEL_ROLES.values()))
check("every label in the inventory names a role that exists",
      set(check_web.LABELS.values()) <= set(check_web.LABEL_ROLES))

# The reader, on strings. The section-name component wraps its words in
# a span so its rule can run off it, so a reader that took the raw match
# would compare "<span>Members</span>" against the inventory forever.
check("a label is read as its role and its words",
      check_web.page_labels('<p class="runner"><span>Members</span></p>') ==
      [("runner", "Members")])
check("a label's words survive the markup inside it",
      check_web.label_text("<span>Rows that\n  would not open</span>") ==
      "Rows that would not open")
check("an ordinary paragraph is not a label",
      check_web.page_labels("<p class='muted'>a sentence</p>") == [])

# Both directions on the inventory, which is the arm that makes adding a
# label an act that has to declare its job. "Not open" stands in for the
# retired "Received" fixture (0.9-M2-S2, #353 dropped the confirmation
# card the word named, along with "Optional" and "Your account") - any
# LABELS entry still pinned "flag" makes the same point.
check("a label carrying a declared role raises nothing",
      check_web.page_label_problems('<p class="flag">Not open</p>') == [])
check("a label nobody has given a job is refused",
      any("names no job" in p for p in check_web.page_label_problems(
          '<p class="runner">Very nearly done</p>')))
check("a label doing a different job from the one declared is refused",
      any("says it is" in p for p in check_web.page_label_problems(
          '<p class="runner">Not open</p>')))

# The overload itself, in the form #68 found it: an outcome wearing the
# section-name component, which is what made `Received` look like
# `Optional` (both retired since; see the comment above).
check("an outcome dressed as a section name names both roles",
      any('"Not open" as "runner"' in p and '"flag"' in p
          for p in check_web.page_label_problems(
              '<p class="runner">Not open</p>')))

# The retired component, refused in the markup and in the stylesheet.
check("a page still wearing the retired label component is refused",
      any("means none of them" in p for p in check_web.page_label_problems(
          '<p class="eyebrow">Received</p>')))

# The evasion: the same class on something that is not a paragraph
# renders identically and would otherwise be invisible here.
check("a role worn by something that is not a paragraph is refused",
      any("not a paragraph" in p for p in check_web.page_label_problems(
          '<div class="flag">Received</div>')))
check("a role on a paragraph is not caught by that arm",
      not any("not a paragraph" in p for p in check_web.page_label_problems(
          '<p class="flag">Received</p>')))

# A role class alongside another class still has to answer for itself.
check("a role wearing a second class is still read as that role",
      check_web.page_labels('<p class="flag small">Result</p>') ==
      [("flag", "Result")])

# Both quote styles, everywhere a class is read. These pages are
# hand-written HTML and both spellings are valid, so a reader pinned to
# one of them is a reader that one keystroke walks past - and the arm
# walked past is a refusal, which fails open.
check("a single-quoted role is read as that role",
      check_web.page_labels("<p class='runner'>Members</p>") ==
      [("runner", "Members")])
check("a single-quoted retired component is refused",
      any("means none of them" in p for p in check_web.page_label_problems(
          "<p class='eyebrow'>Received</p>")))
check("the retired component is refused beside another class",
      any("means none of them" in p for p in check_web.page_label_problems(
          '<p class="eyebrow small">Received</p>')))
check("a single-quoted role on something that is not a paragraph is refused",
      any("not a paragraph" in p for p in check_web.page_label_problems(
          "<div class='flag'>Received</div>")))

# A role's color has to be a token, because the distinctness arm compares
# what is written. A literal that paints another role's exact pixels is
# the evasion that needs no coincidence, and it reads as different text.
check("a role color written as a token is accepted",
      check_web.COLOR_TOKEN.match("var(--color-warn-text)") is not None)
check("a role color written as a literal is not",
      check_web.COLOR_TOKEN.match("#e7b583") is None and
      check_web.COLOR_TOKEN.match("rgb(231, 181, 131)") is None)

# The stylesheet half, on strings. A reader that accepted only bare
# `.role` selectors modelled one page's worth of the cascade: the roles
# as they paint with nothing else on the body. Every page-level override
# was invisible to it, so `body.instrument .flag` could be given another
# role's exact token and paint two roles identically on admin.html with
# the whole gate green.
DISTINCT = (".runner { color: var(--color-gold); }"
            ".flag { color: var(--color-text); }"
            ".caution { color: var(--color-warn-text); }")

check("a stylesheet painting the three roles apart raises nothing",
      check_web.css_role_problems(DISTINCT) == [])
check("two roles painted the same token are refused",
      any("the same" in p for p in check_web.css_role_problems(
          DISTINCT.replace("var(--color-text);", "var(--color-gold);"))))
check("a role repainted under a page-level context is read as that role",
      check_web.selector_role("body.instrument .flag") ==
      ("body.instrument", "flag"))
check("a rule painting the role's pseudo-element is not the role's color",
      check_web.selector_role(".runner::after") is None)
check("a context that collides two roles on one page is refused",
      any("body.instrument" in p for p in check_web.css_role_problems(
          DISTINCT + "body.instrument .flag { color: var(--color-gold); }")))
check("a context that leaves the roles apart raises nothing",
      check_web.css_role_problems(
          DISTINCT +
          "body.instrument .runner { color: var(--color-text-muted); }") == [])
check("a color written under a context still has to be a token",
      any("--color-* token" in p for p in check_web.css_role_problems(
          DISTINCT + "body.instrument .flag { color: #e7b583; }")))

# The other one-keystroke way past a comparison of written text.
check("a token's inner spacing does not make it a different color",
      check_web.normalized_color("var( --color-gold )") ==
      check_web.normalized_color("var(--color-gold)"))
check("two roles painted one token spelled two ways are refused",
      any("the same" in p for p in check_web.css_role_problems(
          DISTINCT.replace("var(--color-text);", "var( --color-gold );"))))

# And the pins have to match what actually ships.
check("no shipped label's role differs from the inventory",
      check_web.label_problems() == [])
check("the stylesheet tells the three roles apart",
      check_web.label_style_problems() == [])


# ------------------------------------------------------------------ #
# Check 17 - one name per destination.                                #

check("every published page is named once",
      set(check_web.DESTINATIONS) == set(check_web.html_pages()))
check("no two destinations answer to the same name",
      len(set(check_web.DESTINATIONS.values())) ==
      len(check_web.DESTINATIONS))

# The fixture's own name is a shape - "the name this page answers to" -
# but the rail entry inside it is not: page_name_problems() reads every
# rail href against the real DESTINATIONS, so an entry written out by
# hand is a second copy of the table that goes stale at the next rename
# and takes this whole block red with it. So the label is read from the
# table and the fixture is built around it. What is being exercised is
# the disagreement, and a disagreement needs one real name to disagree
# with.
CHARTS = check_web.DESTINATIONS["charts.html"]
NAMED = ("<title>%s — %s</title><h1>%s</h1>"
         '<ul class="rail-links">'
         '<li><a href="index.html">Sign in</a></li>'
         '<li><a href="charts.html">%s</a></li></ul>'
         % (CHARTS, check_web.SITE_TITLE, CHARTS, CHARTS))

check("a page whose surfaces agree raises nothing",
      check_web.page_name_problems(NAMED, CHARTS) == [])
check("a heading disagreeing with the page's name is refused",
      any("its heading says" in p for p in check_web.page_name_problems(
          NAMED.replace("<h1>%s</h1>" % CHARTS, "<h1>Dashboard</h1>"),
          CHARTS)))
check("a title disagreeing with the page's name is refused",
      any("bookmark" in p for p in check_web.page_name_problems(
          NAMED.replace("<title>%s" % CHARTS, "<title>Dashboard"), CHARTS)))
check("a page with no heading at all is refused",
      any("what page it is" in p for p in check_web.page_name_problems(
          NAMED.replace("<h1>%s</h1>" % CHARTS, ""), CHARTS)))

# The half rail parity cannot reach. Three rails can agree with each
# other and disagree with the page they open, which is exactly the drift
# #127 inventoried - the admin page called Export by every rail on the
# site at once.
check("a rail calling another page by a name it does not answer to "
      "is refused",
      any('calling index.html "Home"' in p
          for p in check_web.page_name_problems(
              NAMED.replace(">Sign in<", ">Home<"), CHARTS)))

# The spelling the browser resolves identically and a membership test
# does not. `if href in DESTINATIONS` read "./admin.html" as something
# other than a destination and skipped it in silence, which put #127's
# own motivating example - the admin page called Export - back on all
# three rails with the gate green. A rule that skips what it cannot
# recognize fails open, so unknown hrefs are reported rather than passed.
check("a rail href is read through its spelling",
      check_web.rail_target("./charts.html") == "charts.html")
check("a rail href's fragment is not part of the page it names",
      check_web.rail_target("charts.html#top") == "charts.html")
check("a rail href's query is not part of the page it names",
      check_web.rail_target("charts.html?from=rail") == "charts.html")
check("an off-site rail href names no destination here",
      check_web.rail_target("https://example.com/admin.html") is None)
check("a bare directory href is the index",
      check_web.rail_target("") == "index.html")
check("a dot-slash rail calling a page by a name it does not answer to "
      "is refused",
      any('calling ./index.html "Home"' in p
          for p in check_web.page_name_problems(
              NAMED.replace('href="index.html">Sign in',
                            'href="./index.html">Home'), CHARTS)))
check("a rail entry naming no destination at all is refused",
      any("names no destination" in p for p in check_web.page_name_problems(
          NAMED.replace('href="charts.html"', 'href="reports.html"'),
          CHARTS)))

check("no shipped page disagrees with its own name",
      check_web.name_problems() == [])

# The copies of a name that live outside .rail-links (#201). The rail
# loop above reads the destinations list, and #187 moved the door out of
# it - so five copies of the door label, three in the session blocks and
# two in footers, answered to no table at all while a rename swept the
# pages around them.
#
# A link is a copy of a name unless PROSE_LINKS says it is a sentence.
# The fixture is built around the real names for the reason NAMED gives.
DOOR = check_web.DESTINATIONS["index.html"]
ELSEWHERE = (
    '<aside class="rail">'
    '<a class="wordmark" href="index.html"><span>%s</span></a>'
    '<ul class="rail-links"><li><a href="charts.html">%s</a></li></ul>'
    '<div class="rail-session"><a href="index.html">%s</a></div>'
    '</aside>'
    '<footer><p><a href="index.html">%s</a> · '
    '<a href="https://github.com/Potaetoe/hang-gangs-binder">Read the code'
    '</a></p></footer>'
    % (check_web.SITE_TITLE, CHARTS, DOOR, DOOR))

check("a page whose links use the pinned names raises nothing",
      check_web.named_link_problems("admin.html", ELSEWHERE) == [])

# The two halves #201 counted, each on its own.
check("the door label inside the session block is held to the name table",
      any('calling index.html "Log in"' in p
          for p in check_web.named_link_problems(
              "admin.html",
              ELSEWHERE.replace(
                  '<div class="rail-session"><a href="index.html">%s</a>'
                  % DOOR,
                  '<div class="rail-session"><a href="index.html">Log in'
                  '</a>'))))
check("the door label in a footer is held to the name table",
      any('calling index.html "Log in"' in p
          for p in check_web.named_link_problems(
              "admin.html",
              ELSEWHERE.replace('<footer><p><a href="index.html">%s</a>'
                                % DOOR,
                                '<footer><p><a href="index.html">Log in'
                                '</a>'))))

# The rail's destinations already answer to page_name_problems(), and a
# defect reported twice reads as two defects.
check("the rail's own destinations are left to the rail arm",
      check_web.named_link_problems(
          "admin.html",
          ELSEWHERE.replace('<li><a href="charts.html">%s</a></li>' % CHARTS,
                            '<li><a href="charts.html">Progress</a></li>'))
      == [])

# The wordmark is the site's name rather than a page's, and check 10
# holds its four copies to each other. Held here too it would answer to
# two tables, and the first rename would have to satisfy both.
check("the wordmark answers to its own arm and not to this one",
      check_web.named_link_problems(
          "admin.html",
          ELSEWHERE.replace("<span>%s</span>" % check_web.SITE_TITLE,
                            "<span>Some Other Name</span>")) == [])

# Fails open is the failure this arm inherits from #127: a link the
# table cannot resolve is reported rather than skipped.
check("a link to a page the name table does not know is refused",
      any("names no destination" in p for p in check_web.named_link_problems(
          "admin.html",
          ELSEWHERE.replace('<footer><p><a href="index.html">',
                            '<footer><p><a href="reports.html">'))))
check("an off-site link is not this table's to name",
      check_web.named_link_problems(
          "index.html",
          '<a href="https://example.com/index.html">Sign in</a>') == [])

# Prose is declared per page, not globally: the same sentence on a page
# that never had it is a new copy nothing was watching.
check("a link the table declares prose raises nothing",
      check_web.named_link_problems(
          "404.html", '<a href="index.html">Go to sign in</a>') == [])
check("prose declared for one page does not excuse another",
      any("Go to sign in" in p for p in check_web.named_link_problems(
          "admin.html", '<a href="index.html">Go to sign in</a>')))

# Both directions on the table itself. A declaration nothing carries any
# more is a pin that cannot fail, the same defect WORDMARK_PAGES refuses.
check("every prose declaration names a page that exists",
      {page for page, _ in check_web.PROSE_LINKS} <= pages)
check("every prose declaration names a destination that exists",
      {target for _, target in check_web.PROSE_LINKS} <=
      set(check_web.DESTINATIONS))
check("a prose declaration nothing carries any more is refused",
      len(check_web.prose_pin_problems(set())) ==
      sum(len(labels) for labels in check_web.PROSE_LINKS.values()))


def door_drift(text, token, index, replacement):
    """One page's markup with only the (index+1)th copy of a token changed.

    One copy at a time is the whole point: a rename that reaches every
    copy is a rename, and the drift this arm exists for is the one that
    reaches all but one.
    """
    parts = text.split(token)
    return (token.join(parts[:index + 1]) + replacement +
            token.join(parts[index + 1:]))


# The copies #201 counted, named and mutated one at a time against the
# pages that actually ship. This is the arm's real subject; the fixtures
# above are its shape.
#
# THREE NOW, AND NOT BECAUSE THE PIN WAS LOOSENED. #201 counted five:
# three in the session blocks and two in the footers of charts.html and
# admin.html. #265 row 22 retired the footers' pair on the owner's
# ruling - a door offered to somebody already inside, three inches under
# a rail reading "Signed in as ...", which is what #187 took out of the
# rail for the same reason. What is left is one copy per signed-in page,
# in the session block, which is the surface that knows whether to offer
# the door or the exit. The count is written here rather than derived so
# that a copy arriving anywhere fails this line before anybody has to
# notice it.
DOORS = (("admin.html", 1), ("charts.html", 1), ("your-page.html", 1))
check("the door copies outside the rail's destinations still number three",
      sum(check_web.page_text(name).count(">%s</a>" % DOOR)
          for name, _ in DOORS) == 3)
for door_page, door_copies in DOORS:
    check("%s carries the door copies this arm was counted against"
          % door_page,
          check_web.page_text(door_page).count(">%s</a>" % DOOR) ==
          door_copies)
    for door_index in range(door_copies):
        check("%s's door copy %d is under the name table"
              % (door_page, door_index + 1),
              any('calling index.html "Log in"' in p
                  for p in check_web.named_link_problems(
                      door_page,
                      door_drift(check_web.page_text(door_page),
                                 ">%s</a>" % DOOR, door_index,
                                 ">Log in</a>"))))


# ------------------------------------------------------------------ #
# Check 18 - the member pages and the admin instrument.               #

check("every published page names a surface",
      set(check_web.SURFACES) == set(check_web.html_pages()))
check("exactly one page is the admin instrument",
      [page for page, surface in check_web.SURFACES.items()
       if surface == "instrument"] == ["admin.html"])

INSTRUMENT = ('<body class="wide railed instrument">'
              '<p class="surface-mark">Admin surface</p>')
MEMBER = '<body class="railed"><h1>Members</h1>'

check("the instrument page wearing its own clothes raises nothing",
      check_web.page_surface_problems(INSTRUMENT, "instrument") == [])
check("a member page wearing none of them raises nothing",
      check_web.page_surface_problems(MEMBER, "member") == [])

check("the instrument page without its body class is refused",
      any("does not say so" in p for p in check_web.page_surface_problems(
          INSTRUMENT.replace(' instrument"', '"'), "instrument")))
check("the instrument page without a visible surface mark is refused",
      any("surface mark" in p for p in check_web.page_surface_problems(
          '<body class="wide railed instrument">', "instrument")))
check("a surface mark with no words in it does not count as one",
      any("surface mark" in p for p in check_web.page_surface_problems(
          INSTRUMENT.replace(">Admin surface<", "><"), "instrument")))

# The copy-paste direction, which is the arm worth having.
check("a member page claiming the instrument surface is refused",
      any("claims the admin instrument" in p
          for p in check_web.page_surface_problems(
              MEMBER.replace('"railed"', '"railed instrument"'), "member")))
check("a member page carrying the admin surface mark is refused",
      any("carries the admin surface mark" in p
          for p in check_web.page_surface_problems(
              MEMBER + '<p class="surface-mark">Admin surface</p>',
              "member")))

# Both quote styles here too, for the reason the label roles give: the
# arm a single quote walks past is a refusal, and a refusal that fails
# open is worse than no refusal, because the gate says it was checked.
check("a single-quoted instrument body wearing its clothes raises nothing",
      check_web.page_surface_problems(
          "<body class='wide railed instrument'>"
          "<p class='surface-mark'>Admin surface</p>", "instrument") == [])
check("a member page single-quoting the instrument class is refused",
      any("claims the admin instrument" in p
          for p in check_web.page_surface_problems(
              "<body class='railed instrument'>", "member")))

check("no shipped page wears the wrong surface",
      check_web.surface_problems() == [])


# The stylesheet half of the same rule. Check 16 built one for exactly
# this reason and check 18 shipped without one: the pages were made to
# declare which surface they belong to, and nothing anywhere said a
# surface had to look like anything. Deleting every body.instrument rule
# and the nameplate left admin.html rendering as a member page with the
# markup half still green - the clothes the docstring promises were a
# claim no arm was making.
DRESSED = ("body.instrument .runner { color: var(--color-text-muted); }"
           "body.instrument .card { padding: 1rem; }"
           ".surface-mark { color: var(--color-text-muted);"
           " background: var(--color-surface); }")

check("a stylesheet that dresses the instrument raises nothing",
      check_web.css_surface_problems(DRESSED) == [])
check("a stylesheet with no body.instrument rule at all is refused",
      any("defines nothing for body.instrument" in p
          for p in check_web.css_surface_problems(
              ".surface-mark { color: var(--color-text-muted); }")))
check("an instrument that only moves spacing around is refused",
      any("no color of its own" in p for p in check_web.css_surface_problems(
          "body.instrument .card { padding: 1rem; }"
          ".surface-mark { color: var(--color-text-muted); }")))
check("a stylesheet with no nameplate is refused",
      any("defines no .surface-mark" in p
          for p in check_web.css_surface_problems(
              "body.instrument .runner { color: var(--color-text-muted); }")))
check("a nameplate with nothing to set it off is refused",
      any("ordinary sentence" in p for p in check_web.css_surface_problems(
          "body.instrument .runner { color: var(--color-text-muted); }"
          ".surface-mark { padding: 1rem; }")))
check("the shipped stylesheet dresses the admin instrument",
      check_web.surface_style_problems() == [])


# ------------------------------------------------------------------ #
# Check 20 - the alignment that changes axis with its container.      #
#
# Driven on strings for the reason the surface arms above are: what is
# being tested is whether a width block ANSWERS the alignment question,
# and a suite that only ever sees today's theme.css cannot tell an
# answer apart from a stylesheet that happens not to need one.
#
# The grid rule is included in every fixture even though the check
# never reads it. It is what makes the fixture a fair model of the
# hazard - the inherited `start` is the whole reason the branch has to
# speak - and a fixture without it would pass for the wrong reason.
GRID = ("body.railed { display: grid;"
        " grid-template-columns: 15rem minmax(0, 1fr); align-items: start; }"
        ".rail { align-self: start; position: sticky; }")

ANSWERED = GRID + ("@media (max-width: 64rem) {"
                   " body.railed { display: flex; flex-direction: column;"
                   " align-items: stretch; }"
                   " .rail { align-self: stretch; position: static; }"
                   " .rail-links { flex-direction: row; } }")

check("a column branch that states both alignments raises nothing",
      check_web.css_column_branch_problems(ANSWERED) == [])

# #148 exactly: the container flips to a flex column and says nothing
# about alignment, so the grid's start reaches the inline axis.
check("a column branch silent on align-items is refused",
      any("without stating align-items" in p
          for p in check_web.css_column_branch_problems(
              GRID + "@media (max-width: 64rem) {"
              " body.railed { display: flex; flex-direction: column; }"
              " .rail { align-self: stretch; } }")))

# The half a container-only fix leaves behind. This is the arm that
# would have gone green on a fix that only widened the page.
check("a column branch silent on .rail's align-self is refused",
      any("without stating align-self on .rail" in p
          for p in check_web.css_column_branch_problems(
              GRID + "@media (max-width: 64rem) {"
              " body.railed { display: flex; align-items: stretch; }"
              " .rail { position: static; } }")))

check("a column branch with no .rail rule at all is refused",
      any("without stating align-self on .rail" in p
          for p in check_web.css_column_branch_problems(
              GRID + "@media (max-width: 64rem) {"
              " body.railed { display: flex; align-items: stretch; } }")))

# The breakpoint is not what identifies the branch. A redesign moving
# 64rem anywhere else keeps the hazard, so the rule has to keep finding
# it - and a SECOND column branch added later is caught by the same
# rule rather than by somebody remembering to extend a list.
check("the branch is found at any breakpoint, not just 64rem",
      any("without stating align-items" in p
          for p in check_web.css_column_branch_problems(
              GRID + "@media (max-width: 30rem) {"
              " body.railed { display: flex; }"
              " .rail { align-self: start; } }")))
check("a second column branch is judged on its own",
      len(check_web.css_column_branch_problems(
          ANSWERED + "@media (max-width: 30rem) {"
          " body.railed { display: flex; } }")) == 2)

# A width block that leaves the grid alone has no question to answer,
# and a check that reported one would fail on every unrelated media
# block in the file.
check("a width block that does not touch body.railed raises nothing",
      check_web.css_column_branch_problems(
          GRID + "@media (max-width: 52rem) { .pair"
          " { flex-direction: column; } }") == [])
check("a width block that keeps body.railed a grid raises nothing",
      check_web.css_column_branch_problems(
          GRID + "@media (max-width: 52rem) {"
          " body.railed { padding: 0; } }") == [])

# `.rail-links` and `.rail-session` are not `.rail`. Both live in the
# real branch, so a reader that matched on a prefix would find an
# align-self that answers for a different element entirely.
check("align-self on .rail-session does not answer for .rail",
      any("without stating align-self on .rail" in p
          for p in check_web.css_column_branch_problems(
              GRID + "@media (max-width: 64rem) {"
              " body.railed { display: flex; align-items: stretch; }"
              " .rail-links { align-self: stretch; }"
              " .rail-session { align-self: stretch; } }")))
# And the other direction: a selector list is a real way to write this,
# so refusing it would report a stylesheet that is correct.
check("align-self reached through a selector list does answer",
      check_web.css_column_branch_problems(
          GRID + "@media (max-width: 64rem) {"
          " body.railed { display: flex; align-items: stretch; }"
          " .rail, .page { align-self: stretch; } }") == [])

# Comments are stripped before anything is matched. A stylesheet whose
# only `align-items` in the branch sits inside the note explaining the
# hazard is the exact stylesheet this check exists to refuse, and it is
# what theme.css looks like from a distance.
check("an alignment named only in a comment does not answer",
      any("without stating align-items" in p
          for p in check_web.css_column_branch_problems(
              GRID + "@media (max-width: 64rem) {"
              " /* align-items: stretch belongs here */"
              " body.railed { display: flex; }"
              " .rail { align-self: stretch; } }")))

# Brace counting rather than matching to the first `}`. A media block
# is a block of blocks, and stopping early would hand back the first
# rule and judge the branch on it - here that reads body.railed as
# complete and never sees the missing .rail answer.
check("the whole media block is read, not its first rule",
      any("without stating align-self on .rail" in p
          for p in check_web.css_column_branch_problems(
              GRID + "@media (max-width: 64rem) {"
              " body.railed { display: flex; align-items: stretch; }"
              " .rail { position: static; }"
              " .page { padding: 1rem; } }")))

check("the shipped stylesheet answers in its column branch",
      check_web.column_branch_alignment_problems() == [])


# The arm that stops the one above being decorative, found by mutating
# rather than by reading: replacing the wrapper's body with `return []`
# left this whole suite green AND the gate green, because every arm
# above drives the pure function and the arm above expects nothing.
# A check that has been neutered where it meets the disk is a check
# that looks armed. So the wrapper is pointed at a stylesheet that must
# fail, which is the only way to establish that it reads a file at all
# and applies the rule to what it finds.
#
# The directory is a temporary one outside the repository: a fixture
# stylesheet written into apps/web would be published verbatim, and one
# written anywhere in the tree is linted by the gate that runs this.
BROKEN = GRID + ("@media (max-width: 64rem) {"
                 " body.railed { display: flex; flex-direction: column; } }")

with tempfile.TemporaryDirectory() as folder:
    with open(os.path.join(folder, check_web.STYLESHEET), "w",
              encoding="utf-8") as handle:
        handle.write(BROKEN)
    shipped = check_web.WEB
    try:
        check_web.WEB = folder
        found = check_web.column_branch_alignment_problems()
    finally:
        check_web.WEB = shipped

check("the wrapper reads the stylesheet rather than answering from "
      "nowhere", len(found) == 2)
check("and it is the shipped directory it normally reads",
      check_web.WEB.endswith(os.path.join("apps", "web")))


# ------------------------------------------------------------------ #
# Check 21: the chart series slots used, against the three places the #
# stylesheet defines them (0.9-M2-S3, #354 - rewritten from a modulo  #
# cycle read to a literal-set read: apps/web/charts.js writes its two #
# class names out whole rather than building one from an index, and   #
# apps/web/dashboard.js, the file that built one, is gone).           #
#                                                                     #
# Every fixture below writes .series-N as a literal, and the shipped  #
# tree never does outside charts.js's own two - which is the whole    #
# reason this check exists. A search for "series-2" across this       #
# repository finds these strings and nothing real, while twelve live  #
# selectors and six palettes' worth of values still answer to a slot  #
# count read this way.                    #

PRODUCER = '"chart-series series-1", "chart-dot series-1"'


def slots(count, palettes=1):
    """A stylesheet defining `count` slots across `palettes` palettes."""
    css = ""
    for palette in range(palettes):
        values = "".join("--color-series-%d: #00%d000;" % (n, n)
                         for n in range(count))
        css += ':root[data-theme="p%d"] { %s }' % (palette, values)
    for n in range(count):
        css += ".series-%d { stroke: var(--color-series-%d); }" % (n, n)
        css += ("circle.series-%d, text.series-%d "
                "{ fill: var(--color-series-%d); }" % (n, n, n))
    return css


check("the highest slot is read out of a chart-series literal",
      check_web.series_slots_used('"chart-series series-1"') == 2)
check("a chart-dot literal is read the same way",
      check_web.series_slots_used('"chart-dot series-2"') == 3)
check("a chart-series-label literal is read the same way",
      check_web.series_slots_used('"chart-series-label series-0"') == 1)
check("a script that composes no series class has no slots used",
      check_web.series_slots_used("const cls = seriesClass(index);")
      is None)

# design mandate 6 fixes the shape at two slots (0 and 1), so PRODUCER
# names slot 1 and the stylesheet needs slots 0 and 1 both styled -
# slots(2) below is exactly that.
check("a stylesheet with enough slots and a script that agree raise nothing",
      check_web.css_series_problems(slots(2), PRODUCER) == [])
check("a stylesheet carrying more slots than the script uses is not an "
      "orphan - the spare slots are accepted headroom now, unlike the "
      "retired dashboard.js cycle this check used to hold to an exact "
      "count",
      check_web.css_series_problems(slots(6), PRODUCER) == [])

# The direction that still matters: a slot the script actually uses,
# left unstyled.
check("a used slot the stylesheet does not define is refused",
      any(".series-1" in p for p in check_web.css_series_problems(
          slots(1), PRODUCER)))

check("a slot with a stroke and no fill is refused",
      any("fills" in p for p in check_web.css_series_problems(
          slots(2).replace("circle.series-1, text.series-1 "
                           "{ fill: var(--color-series-1); }", ""),
          PRODUCER)))

check("a palette short of a used slot is refused",
      any("no value for series slot" in p
          for p in check_web.css_series_problems(
              slots(2) + ':root[data-theme="q"] '
              "{ --color-series-0: red; }", PRODUCER)))
check("a palette short of a slot the script does not use is not refused - "
      "only the used slots are held to the palettes",
      not any("no value for series slot" in p
              for p in check_web.css_series_problems(
                  slots(2) + ':root[data-theme="q"] '
                  "{ --color-series-0: red; --color-series-1: blue; }",
                  PRODUCER)))
check("a stylesheet setting no series value at all is refused",
      any("sets no --color-series-N" in p
          for p in check_web.css_series_problems(
              ".series-0 { stroke: red; }"
              "circle.series-0, text.series-0 { fill: red; }",
              '"chart-series series-0"')))

# A rule that cannot find its subject must say so. This is the arm that
# stops the whole check from going quiet the day the chart changes shape.
check("a producer this check cannot read is reported, not skipped",
      any("composes no series class" in p
          for p in check_web.css_series_problems(slots(6), "// nothing")))

# Palettes live inside @media in this stylesheet, so a reader that only
# saw top-level blocks would find four of the six and call two of them
# absent - a failure that looks like a real finding.
check("a palette nested inside @media is found",
      check_web.stylesheet_series(
          "@media (prefers-color-scheme: light) { :root "
          "{ --color-series-0: red; --color-series-1: blue; } }")[2]
      == [(":root", {0, 1})])

check("the shipped stylesheet and chart script agree on the slot count",
      check_web.series_problems() == [])


# ------------------------------------------------------------------ #
# Check 22: the loading shape.                                        #

PREPAINT = '<script src="theme-init.js"></script>'
RUN = ('<script src="config.js"></script>'
       '<script src="ui.js"></script>')


def page(head=PREPAINT, body="<p>Hello</p>" + RUN):
    return ("<!doctype html><html><head>%s</head><body>%s</body></html>"
            % (head, body))


check("a page in the shipped loading shape raises nothing",
      check_web.page_loading_problems(page()) == [])

# The headline arm. One word, in the direction #80 was pointing, and
# every other check in this gate stays green through it.
check("defer on the pre-paint script is refused",
      any("silently undoes it" in p for p in check_web.page_loading_problems(
          page(head='<script defer src="theme-init.js"></script>'))))
check("async on the pre-paint script is refused",
      any("silently undoes it" in p for p in check_web.page_loading_problems(
          page(head='<script src="theme-init.js" async></script>'))))
check("a valued defer attribute is refused too",
      any("silently undoes it" in p for p in check_web.page_loading_problems(
          page(head='<script src="theme-init.js" defer="defer"></script>'))))

check("a second script in the head is refused",
      any("only script that may block" in p
          for p in check_web.page_loading_problems(
              page(head=PREPAINT + '<script src="nav.js"></script>'))))
check("an inline script in the head is refused",
      any("an inline script" in p for p in check_web.page_loading_problems(
          page(head=PREPAINT + "<script>go()</script>"))))
check("a page with no pre-paint script in its head is refused",
      any("carries no theme-init.js" in p
          for p in check_web.page_loading_problems(page(head=""))))

check("defer on one of the site's own body scripts is refused",
      any("moving one means moving the run" in p
          for p in check_web.page_loading_problems(
              page(body='<script defer src="config.js"></script>'))))
check("content after the run of body scripts is refused",
      any("query the document at top level" in p
          for p in check_web.page_loading_problems(
              page(body=RUN + "<p>after</p>"))))

# The one script here nothing in this repository sets the attributes of.
check("a third-party async script mid-body raises nothing",
      check_web.page_loading_problems(page(
          body='<script async src="https://telegram.org/js/w.js?22">'
               "</script><p>Hello</p>" + RUN)) == [])

# Both quote styles, for the reason the label roles give one file up.
check("a single-quoted pre-paint script is read",
      check_web.page_loading_problems(
          page(head="<script src='theme-init.js'></script>")) == [])
check("a single-quoted defer is refused",
      any("silently undoes it" in p for p in check_web.page_loading_problems(
          page(head="<script src='theme-init.js' defer></script>"))))

# A bare attribute name, so a file that happens to be called defer.js is
# not read as a deferred script.
check("a filename containing the word is not the attribute",
      check_web.page_loading_problems(
          page(body='<script src="defer.js"></script>')) == [])

check("a page with no </body> is a reported problem, not a skip",
      any("</body>" in p for p in check_web.page_loading_problems(
          "<html><head>%s</head><body>%s" % (PREPAINT, RUN))))

check("every shipped page holds the loading shape",
      check_web.loading_problems() == [])


# ------------------------------------------------------------------ #
# The Sign out control and the module that performs it.               #
#
# The button and the module are one thing, and this is the rule that
# keeps them one. Destroying the member's device key lives in
# signout.js, which every page offering Sign out already loads, rather
# than in a key module - IndexedDB is origin-wide, and a destruction
# reached through a module two of the three pages never loaded destroyed
# nothing on exactly those pages. That is #257, and it shipped. The key
# module itself is gone now (0.9-M2-S5, #356) and the destruction is
# not: devices the old pages wrote to still hold that database, and only
# code they load can remove it.
#
# Which leaves exactly one way for a future page to reopen it: ship the
# control and not the module. Nothing else in this file says a page must
# load any particular script - SHELLS pins the markup a page carries and
# the loading rules pin where scripts sit, and neither has an opinion
# about which ones. So a page could be added tomorrow with the rail
# copied from an open tab, the button in it, and the run missing one
# line, and every stage of this gate would pass while its Sign out both
# did nothing and destroyed nothing.
SIGN_OUT_CONTROL = ('<button type="button" class="secondary rail-signout" '
                    'id="sign-out" hidden>Sign out</button>')
SIGN_OUT_MODULE = '<script src="signout.js"></script>'

check("a page offering Sign out and loading the module raises nothing",
      check_web.sign_out_wiring_problems(
          page(body=SIGN_OUT_CONTROL + RUN + SIGN_OUT_MODULE)) == [])
check("a page offering Sign out and not loading it is refused",
      any("signout.js" in p for p in check_web.sign_out_wiring_problems(
          page(body=SIGN_OUT_CONTROL + RUN))))
# The direction that keeps this from being a rule about every page. The
# cover and the error page carry no session home by SHELLS, and a rule
# demanding the module there would be demanding a sign-out on a page
# with nothing to sign out of.
check("a page with no Sign out control is not judged here",
      check_web.sign_out_wiring_problems(page(body=RUN)) == [])
# Both quote styles, for the reason the pre-paint arms give one section
# up: nothing in this repository enforces one, and a reader blind to the
# other is a reader a page slips past without meaning to.
check("the control is found whichever quote it is written with",
      any("signout.js" in p for p in check_web.sign_out_wiring_problems(
          page(body="<button id='sign-out' hidden>Sign out</button>" + RUN))))
# A commented-out script tag is not a loaded script, and this is the
# arm that says so. It is not hypothetical: every one of these pages
# carries a long comment beside its script run explaining the order, and
# commenting a line out while debugging is how the tag comes to sit
# inside one. A reader that counted it would call the page wired.
check("a commented-out script tag does not satisfy the rule",
      any("signout.js" in p for p in check_web.sign_out_wiring_problems(
          page(body=SIGN_OUT_CONTROL + RUN
               + "<!-- " + SIGN_OUT_MODULE + " -->"))))
check("and every shipped page that offers Sign out loads it",
      all(check_web.sign_out_wiring_problems(check_web.page_text(name)) == []
          for name in check_web.html_pages()))

# The wiring, asked from outside. Every arm in this section calls its
# rule function directly, so a rule dropped from loading_problems()
# passes all of them while being absent from the gate's own walk over
# the shipped pages - armed-looking and unarmed, which AGENTS.md's
# review bar treats as worse than no check. Found by mutation: deleting
# the call left this suite entirely green.
# dev/check_comments.test.py asks its gate the same question the same
# way, and that is where the shape comes from.
check("the gate's page walk calls every loading rule this file defines",
      {"page_loading_problems", "run_order_problems",
       "deferred_capture_problems", "sign_out_wiring_problems"}
      <= set(check_web.loading_problems.__code__.co_names))


# The order arm. `const UI = root.BinderUI;` runs when the file does, and
# the modules holding it guard on the captured value - so getting this
# wrong produces a page that goes quiet rather than one that throws,
# which is why it is worth a gate at all.
CAPTURES = {"auth.js": {"BinderUI"}, "signout.js": {"BinderSession"}}

check("a namespace captured off the global object is found",
      check_web.module_captures("const UI = root.BinderUI;")
      == {"BinderUI"})
check("every spelling of the global object is found",
      check_web.module_captures("const S = window.BinderSession;")
      == {"BinderSession"})
# The reason the prefix is required rather than the bare name: these
# names appear in prose and in messages, and ordering a page against a
# sentence is a false failure that looks exactly like a real one.
check("a bare mention with no global object is not a capture",
      check_web.module_captures('say("BinderUI is missing");') == set())
check("a module publishing its own namespace does not capture it",
      check_web.run_order_problems(
          ["ui.js"], {"ui.js": {"BinderUI"}}) == [])

check("a run that publishes before it captures raises nothing",
      check_web.run_order_problems(["ui.js", "auth.js"], CAPTURES) == [])
check("a capturing script above its publisher is refused",
      any("goes quiet" in p for p in check_web.run_order_problems(
          ["auth.js", "ui.js"], CAPTURES)))
check("the refusal names both files and the namespace",
      all(word in check_web.run_order_problems(
          ["auth.js", "ui.js"], CAPTURES)[0]
          for word in ("auth.js", "ui.js", "BinderUI")))
check("a publisher absent from the page entirely is refused",
      any("never loads ui.js" in p for p in check_web.run_order_problems(
          ["auth.js"], CAPTURES)))

# The deferred-capture exemption, and the shape that is the whole of what
# admits it. Every arm here drives a SYNTHETIC table rather than the
# shipped one, which is #257's doing: the shipped table is empty now, and
# an arm reading it would pass by describing nothing at all. Exercised
# against a pair this tree does not ship for the same reason - a rule
# tested only against the one file it was written for is a rule that says
# yes to whatever that file happens to do, and this one is an exemption,
# so it is the rule most able to turn into a hole.
#
# The pair is signout.js reading `BinderXlsx`, and it is synthetic in the
# way that matters: xlsx.js is real and publishes that namespace, but it
# is on two pages while signout.js is on three, which is the shape an
# exemption would ever be asked for.
#
# BOTH HALVES OF THE PAIR MUST BE REAL, and that is the constraint to
# read before editing this. run_order_problems() resolves a namespace to
# its publisher through MODULE_EXPORTS and skips a namespace no module
# publishes - so a pair invented out of thin air leaves every arm below
# judging nothing and passing, which is the armed-looking-and-inert shape
# this file refuses everywhere else.
DEFERRED = ("signout.js", "BinderXlsx")
SYNTHETIC = {DEFERRED: "a reason, which is what admits the row"}

# The shipped table, in the one direction it can still be read. Nothing
# is exempt here: sign-out destroys the device key's database itself
# rather than reading a namespace two of the three pages that offer Sign
# out never publish. A row coming back has to earn the exemption by
# execution again, and dev/signout.test.mjs is where that is said.
check("nothing in this tree is exempt from the ordering rule",
      check_web.DEFERRED_CAPTURES == {})

check("a declared deferred capture is exempt from the ordering rule",
      check_web.run_order_problems(
          ["signout.js"], {"signout.js": {"BinderXlsx"}},
          SYNTHETIC) == [])
# The pair, not the namespace. Another script reading the same namespace
# without a declaration of its own gets no exemption from this one -
# otherwise one entry would quietly cover the whole tree.
check("the exemption is per script, not per namespace",
      any("never loads xlsx.js" in p for p in
          check_web.run_order_problems(
              ["submit.js"], {"submit.js": {"BinderXlsx"}},
              SYNTHETIC)))
# And the same capture with nothing declared, which is what this tree
# ships. Without this the arm above could be passing because the rule
# exempts everything rather than because it read the table.
check("and with nothing declared the ordering rule judges every capture",
      any("never loads xlsx.js" in p for p in
          check_web.run_order_problems(
              ["signout.js"], {"signout.js": {"BinderXlsx"}}, {})))

# WHAT THIS FILE MAY AND MAY NOT ASSERT ABOUT THE EXEMPTION.
#
# An earlier version of these arms exercised a textual shape rule here -
# brace depth for "is the read deferred", a regex for "is it guarded" -
# and a review defeated every one of them: a deep-defined function CALLED
# at top level, a brace inside a string literal inflating the counter,
# and a dead or string-embedded guard. Those were proxies for a runtime
# property, and no rewriting of a proxy fixes that.
#
# The property is earned by running the shipped bytes, in
# dev/signout.test.mjs, which reads the table below and fails if a
# declared namespace is touched during load. What is left here is what
# Python over text can honestly say: the row exists, it carries a reason,
# and it names a script that really reads the namespace.
READS = ('(function (root) { function go() { const write = '
         'root.BinderXlsx; if (write) write.book(); } })(globalThis);')

check("a declared pair whose script really reads the namespace is fine",
      check_web.deferred_capture_problems(
          "signout.js", READS, SYNTHETIC) == [])
# The staleness arm, which is the one failure a registry can have on its
# own: the code moved and the exemption outlived it. An exemption for a
# read that is not there suppresses ordering for nothing, and the next
# reader has no way to tell it from a live one.
check("an exemption for a namespace the script never reads is refused",
      any("guards nothing" in p for p in
          check_web.deferred_capture_problems(
              "signout.js", "(function (root) { })(globalThis);", SYNTHETIC)))
check("a script with no declaration of its own is not judged here",
      check_web.deferred_capture_problems("ui.js", READS, SYNTHETIC) == [])
check("a row admitted with no reason written down is refused",
      any("no reason written down" in p for p in
          check_web.deferred_capture_problems(
              "signout.js", READS, {DEFERRED: "   "})))
check("and the shipped tree declares no row for this file to judge",
      check_web.deferred_capture_problems(
          DEFERRED[0],
          check_web.strip_js_comments(open(
              os.path.join(check_web.WEB, DEFERRED[0]),
              encoding="utf-8").read())) == [])

check("the shipped pages' script runs are read, not assumed",
      check_web.page_script_run(
          "<html><head></head><body><script src='a.js'></script>"
          "</body></html>") == ["a.js"])
check("a third-party script is not part of the run to order",
      check_web.page_script_run(
          "<html><head></head><body>"
          "<script src='https://telegram.org/js/w.js'></script>"
          "<script src='a.js'></script></body></html>") == ["a.js"])


# ------------------------------------------------------------------ #
# Check 23 - the palette chips, read side by side (#152).             #
#                                                                     #
# The defect is precise and every arm here is aimed at it: a chip      #
# renamed on two of the four pages passed the whole gate. So the arm   #
# that carries this suite is the one changing ONE page's label and     #
# expecting a refusal - and its opposite, a rename reaching every      #
# page raising nothing, because agreement is what this pins and the    #
# words themselves are the owner's (#127).                             #


def chip_markup(name, label, tag="button"):
    return '<%s type="button" data-set-theme="%s">%s</%s>' % (
        tag, name, label, tag)


# The shipped roster, written out here rather than read off the pages,
# so an arm below cannot agree with a page that has drifted.
FOUR_CHIPS = [("midnight", "Midnight"), ("pink", "Pink"),
              ("daylight", "Daylight"), ("contrast", "Contrast")]

CHIP_GROUP = "".join(chip_markup(n, w) for n, w in FOUR_CHIPS)

# The rename that reaches one page and not the others.
DRIFTED_CHIPS = [(n, "Parchment Daylight" if n == "daylight" else w)
                 for n, w in FOUR_CHIPS]

# The reader first. Every one of these is a shape the gate would
# certify without reading if the reader declined to see it.
check("a chip's id and its words are read as one pair",
      check_web.page_chips(chip_markup("pink", "Pink"))
      == [("pink", "Pink")])
check("chips are read in document order",
      check_web.page_chips(CHIP_GROUP) == FOUR_CHIPS)
check("a single-quoted chip id is read",
      check_web.page_chips("<button data-set-theme='pink'>Pink</button>")
      == [("pink", "Pink")])
# theme.js queries the attribute, never the tag name, so a reader
# restricted to <button> would certify a control it never saw.
check("a chip on an element that is not a button is read",
      check_web.page_chips(chip_markup("pink", "Pink", tag="a"))
      == [("pink", "Pink")])
check("an element with no chip attribute is not a chip",
      check_web.page_chips('<button type="button">Save</button>') == [])
check("a chip's words are read through its own inner markup",
      check_web.page_chips(
          '<button data-set-theme="pink"><span>Pink</span></button>')
      == [("pink", "Pink")])
# The sign-in swatch: a colored dot has no words in it, so its name is
# the aria-label. A reader that saw only visible words would leave
# every swatch nameless, and the parity and ruled-word arms below would
# then be comparing three pages while the fourth went unread.
check("a wordless chip is named by its aria-label",
      check_web.page_chips(
          '<button data-set-theme="pink" aria-label="Pink">'
          '<span class="swatch-dot" data-palette="pink"></span></button>')
      == [("pink", "Pink")])
# Visible words win, because they are what a sighted member acts on and
# a label disagreeing with them is #152 one layer down.
check("visible words outrank an aria-label that disagrees",
      check_web.page_chips(
          '<button data-set-theme="pink" aria-label="Rose">Pink</button>')
      == [("pink", "Pink")])
# None, not "" - a chip with no closing tag and a chip with no words
# send whoever reads the failure to look at different things.
check("a chip whose element never closes has no label to compare",
      check_web.page_chips('<button data-set-theme="pink">Pink')
      == [("pink", None)])

# One page's own roster, before any comparison.
check("a page whose chips all read clean raises nothing",
      check_web.chip_roster_problems(CHIP_GROUP) == [])
# The reconciliation against check 19's own CHIP_MARKUP, and the case
# is real rather than theoretical: a ">" inside a quoted attribute
# value ends the opening tag as far as this file's reader is
# concerned, while check 19 counts the chip anyway. The two disagree
# about what is on the page, and saying so is the whole point - the
# alternative is a comparison quietly performed on three chips.
check("a chip check 19 counts and this reader cannot pair is refused",
      any("pairs" in p for p in check_web.chip_roster_problems(
          '<button title="a>b" data-set-theme="pink">Pink</button>')))
check("an empty chip id is refused",
      any("empty id" in p for p in check_web.chip_roster_problems(
          '<button data-set-theme="">Pink</button>')))
check("the same palette twice on one page is refused",
      any("two chips" in p for p in check_web.chip_roster_problems(
          chip_markup("pink", "Pink") + chip_markup("pink", "Rose"))))
check("a chip with neither words nor an aria-label is refused",
      any("nor an aria-label" in p for p in check_web.chip_roster_problems(
          '<button data-set-theme="pink"></button>')))
check("a chip whose element never closes is refused",
      any("never closes" in p for p in check_web.chip_roster_problems(
          '<button data-set-theme="pink">Pink')))

# The comparison. Both directions the issue names, and the third the
# rail already pays for.
check("pages agreeing about every chip raise nothing",
      check_web.chip_parity_problems(
          {"a.html": FOUR_CHIPS, "b.html": FOUR_CHIPS,
           "c.html": FOUR_CHIPS}) == [])

DRIFT_FOUND = check_web.chip_parity_problems(
    {"admin.html": FOUR_CHIPS, "charts.html": FOUR_CHIPS,
     "your-page.html": DRIFTED_CHIPS})
check("a label renamed on ONE page is refused",
      len(DRIFT_FOUND) == 1)
check("the refusal names the page that drifted",
      bool(DRIFT_FOUND) and DRIFT_FOUND[0][0] == "your-page.html")
check("the refusal carries both spellings and the page to compare with",
      bool(DRIFT_FOUND) and all(
          word in DRIFT_FOUND[0][1]
          for word in ("Daylight", "Parchment Daylight", "admin.html")))

# What it deliberately does not pin. #127 ruled these words; a rename
# reaching every copy is the site changing its mind, not drift, and a
# check that refused it would have to be edited to ship a decision
# that is not this file's to make.
RENAMED_CHIPS = [(n, w + " palette") for n, w in FOUR_CHIPS]
check("a rename that reaches every page raises nothing",
      check_web.chip_parity_problems(
          {"a.html": RENAMED_CHIPS, "b.html": RENAMED_CHIPS}) == [])

SHORT_CHIPS = [pair for pair in FOUR_CHIPS if pair[0] != "contrast"]
check("a palette missing from one page is refused",
      any("different set" in p for _subject, p in
          check_web.chip_parity_problems(
              {"a.html": FOUR_CHIPS, "b.html": SHORT_CHIPS})))
check("a palette on one page only is refused",
      any("different set" in p for _subject, p in
          check_web.chip_parity_problems(
              {"a.html": SHORT_CHIPS, "b.html": FOUR_CHIPS})))

# Order, for the reason rail parity pins it: the list is hand-copied
# on every page, and a chip inserted where the page somebody copied
# from did not have it is the same drift by the same route.
REORDERED_CHIPS = [FOUR_CHIPS[1], FOUR_CHIPS[0], *FOUR_CHIPS[2:]]
check("the same palettes in a different order are refused",
      any("different order" in p for _subject, p in
          check_web.chip_parity_problems(
              {"a.html": FOUR_CHIPS, "b.html": REORDERED_CHIPS})))

# A parity rule holding one copy cannot fail, which is the failure
# #114 paid for - so it reports rather than passing.
check("one roster is not a comparison, and says so",
      any(subject == check_web.CHIP_PIN for subject, _p in
          check_web.chip_parity_problems({"a.html": FOUR_CHIPS})))
check("no roster at all is not a comparison either",
      check_web.chip_parity_problems({}) != [])

# And the shipped pages.
check("the shipped pages agree about every palette chip",
      check_web.chip_problems() == [])

SHIPPED_CHIPS = {
    name: check_web.page_chips(check_web.page_text(name))
    for name in sorted(check_web.THEMED_PAGES)
}
check("every themed page ships one identical chip roster",
      len({tuple(r) for r in SHIPPED_CHIPS.values()}) == 1)
# Without this the arm above passes on four pages carrying no chips.
check("and that roster is not empty",
      SHIPPED_CHIPS["your-page.html"] != [])


# The arm that stops every arm above being decorative, and it is the
# lesson check 20's wrapper arm records one file up: replacing the
# wrapper's body with `return []` leaves all of them green, because
# they drive the pure functions and the shipped arm expects nothing.
# So the wrapper is pointed at pages that must fail.
#
# The directory is outside the repository. A fixture page written into
# apps/web would be published verbatim, and one written anywhere in
# the tree is linted by the gate that runs this.
def chips_over(pages):
    """chip_problems() against a directory holding exactly `pages`."""
    with tempfile.TemporaryDirectory() as folder:
        for name, markup in pages.items():
            with open(os.path.join(folder, name), "w",
                      encoding="utf-8") as handle:
                handle.write(
                    "<!doctype html><html><body>%s</body></html>" % markup)
        shipped = check_web.WEB
        try:
            check_web.WEB = folder
            return check_web.chip_problems()
        finally:
            check_web.WEB = shipped


DISK_FOUND = chips_over({
    "admin.html": CHIP_GROUP,
    "your-page.html": "".join(chip_markup(n, w) for n, w in DRIFTED_CHIPS),
})
check("the wrapper reads the pages rather than answering from nowhere",
      len(DISK_FOUND) == 1 and DISK_FOUND[0][0] == "your-page.html")
check("and it is the shipped directory it normally reads",
      check_web.WEB.endswith(os.path.join("apps", "web")))

# Not decorative: your-page.html's note on the #127 ruling names this
# attribute at length, so a reader taking raw markup would compare a
# page against prose about itself.
check("a chip written out inside a comment is not part of a roster",
      chips_over({
          "admin.html": CHIP_GROUP,
          "your-page.html": CHIP_GROUP + "<!-- %s -->" % chip_markup(
              "ghost", "Ghost"),
      }) == [])

# A themed page carrying no chip at all is check 19's, and it fails
# there in this same run from this same roster. Restating it here is
# what that check's docstring declines to do, in the other direction.
check("a themed page with no chips is left to check 19, not restated",
      chips_over({
          "admin.html": CHIP_GROUP,
          "your-page.html": CHIP_GROUP,
          "charts.html": "<p>Nothing here.</p>",
      }) == [])


# ------------------------------------------------------------------
# Check 24: the design tokens the mockup rules.
#
# Driven on strings for this suite's own reason: the shipped stylesheet
# is one arrangement of the rules, and what has to hold is the SHAPE of
# the failure. The stylesheet the arms below are fed is built out of
# the pinned table itself rather than typed out again here - a fixture
# holding a second copy of seventy-two hexes would go stale the day the
# owner moves one, and would then be testing the copy.
#
# The wrapper arms at the end are the ones that read apps/web, and they
# are what stops all of this being decorative: check 20's wrapper arm
# recorded the lesson one suite up, where replacing a wrapper's body
# with `return []` left every pure arm green.

FACES = "\n".join(
    '@font-face { font-family: %s; src: url("f.woff2"); }' % family
    for family in ('"Playfair Display"', '"DM Sans"', '"JetBrains Mono"'))


def declarations(table):
    """One block's worth of custom-property declarations."""
    return "\n".join("  %s: %s;" % pair for pair in sorted(table.items()))


def block_text(key, table):
    """A CSS block for `key`, inside its @media when it has one."""
    media, selector = key
    rule = "%s {\n%s\n}" % (selector, declarations(table))
    return "@media %s {\n%s\n}" % (media, rule) if media else rule


def token_css(overrides=None, extra=""):
    """The stylesheet the pinned table describes, `overrides` applied.

    `overrides` maps a block key to what that block should declare
    instead of the ruled values; None drops the block entirely. The
    block roster is read off the table rather than listed again, so a
    palette added to the pin is exercised here without an edit.
    """
    overrides = overrides or {}
    parts = []
    for key in [*check_web.MOCKUP_PALETTE_BLOCKS,
                check_web.MOCKUP_SCALE_BLOCK]:
        if key == check_web.MOCKUP_SCALE_BLOCK:
            table = check_web.MOCKUP_SCALE
        else:
            table = check_web.MOCKUP_PALETTES[
                check_web.MOCKUP_PALETTE_BLOCKS[key]]
        table = overrides.get(key, table)
        if table is not None:
            parts.append(block_text(key, table))
    return "\n".join([*parts, extra, FACES])


MIDNIGHT_BLOCK = ("", ':root, :root[data-theme="midnight"]')
LIGHT_BLOCK = ("(prefers-color-scheme: light)", ":root:not([data-theme])")

# The table has to describe the stylesheet before any arm driven off
# it means anything. If this one goes red, every arm below is testing
# a fiction and the wrapper arms at the end are the only real ones.
check("the table's block roster names the midnight block",
      MIDNIGHT_BLOCK in check_web.MOCKUP_PALETTE_BLOCKS)
check("and the light-preference copy of daylight",
      check_web.MOCKUP_PALETTE_BLOCKS.get(LIGHT_BLOCK) == "daylight")
check("the scale block is not one of the palette blocks",
      check_web.MOCKUP_SCALE_BLOCK
      not in check_web.MOCKUP_PALETTE_BLOCKS)
check("every block names a palette the table rules",
      set(check_web.MOCKUP_PALETTE_BLOCKS.values())
      == set(check_web.MOCKUP_PALETTES))
# A palette short of a token is a palette carrying whatever the block
# above it left in the cascade, which is #81's worst finding's shape.
check("every palette rules the same set of tokens",
      len({tuple(sorted(t)) for t in
           check_web.MOCKUP_PALETTES.values()}) == 1)
# The ids theme.css defines and the ids the pages offer were two
# different sets between 0.9-M2-S6 (#82) and 0.9-M2-S13 (#378): "custom"
# was a chip with no static palette block behind it BY DESIGN (design
# mandate 5 - its dot was painted at runtime from a member's own colors,
# and a static swatch_problems() entry for it would have been exactly
# the fixed value that mandate refused to let it have). 0.9-M2-S13 (#378)
# removed the custom swatch circle entirely - the "Custom theme" control
# it left behind is the footer's own disclosure summary, not a
# data-set-theme chip - so the two sets are one set again, with no
# exception either arm has to carve out.
check("every ruled chip names a ruled palette",
      set(check_web.MOCKUP_CHIPS) == set(check_web.MOCKUP_PALETTES))


check("the stylesheet the table describes has no problems",
      check_web.token_problems(token_css()) == [])

MOVED = dict(check_web.MOCKUP_PALETTES["midnight"])
MOVED["--color-bg"] = "#0b0b0b"
BG_MOVED = check_web.token_problems(
    token_css({MIDNIGHT_BLOCK: MOVED}))
check("a palette value that has left the mockup is reported",
      len(BG_MOVED) == 1)
# Both values, because the failure a reader has to act on is which of
# the two is wrong, and that is not knowable from either alone.
check("and the message carries the shipped value and the ruled one",
      "#0b0b0b" in BG_MOVED[0] and "#120d10" in BG_MOVED[0])

DROPPED = {k: v for k, v in check_web.MOCKUP_PALETTES["midnight"].items()
           if k != "--color-focus"}
check("a token the stylesheet stops declaring is reported",
      any("--color-focus" in p for p in check_web.token_problems(
          token_css({MIDNIGHT_BLOCK: DROPPED}))))

ADDED = dict(check_web.MOCKUP_PALETTES["midnight"])
ADDED["--color-halo"] = "#abcdef"
check("a token the mockup does not rule is reported",
      any("--color-halo" in p for p in check_web.token_problems(
          token_css({MIDNIGHT_BLOCK: ADDED}))))

# The direction that keeps the scale one decision. A palette free to
# redefine --measure is a palette that re-lays out five pages.
SHADOWED = dict(check_web.MOCKUP_PALETTES["midnight"])
SHADOWED["--measure"] = "60rem"
check("a scale token redeclared inside a palette is reported",
      any("--measure" in p for p in check_web.token_problems(
          token_css({MIDNIGHT_BLOCK: SHADOWED}))))

WIDER = dict(check_web.MOCKUP_SCALE)
WIDER["--measure"] = "60rem"
check("a scale value that has left the mockup is reported",
      any("--measure" in p and "46rem" in p for p in
          check_web.token_problems(
              token_css({check_web.MOCKUP_SCALE_BLOCK: WIDER}))))

check("a palette block the stylesheet stops declaring is reported",
      any("pink" in p for p in check_web.token_problems(
          token_css({("", ':root[data-theme="pink"]'): None}))))

check("a declaring block the mockup does not rule is reported",
      any("sepia" in p for p in check_web.token_problems(token_css(
          extra=':root[data-theme="sepia"] { --color-bg: #001122; }'))))

# Last one wins, so a value corrected in the wrong copy changes
# nothing and reads as done.
check("the same block declared twice is reported",
      any("twice" in p or "2 times" in p for p in
          check_web.token_problems(token_css(
              extra=block_text(check_web.MOCKUP_SCALE_BLOCK,
                               check_web.MOCKUP_SCALE)))))

# Daylight is written out twice - once for the attribute, once for a
# system preferring light - and the two are kept in step by hand. This
# is the arm that reads them against one ruled set instead of against
# each other, so neither copy can be the drifted reference.
DRIFTED_LIGHT = dict(check_web.MOCKUP_PALETTES["daylight"])
DRIFTED_LIGHT["--color-surface"] = "#ffffff"
check("the light-preference copy drifting from daylight is reported",
      any("--color-surface" in p for p in check_web.token_problems(
          token_css({LIGHT_BLOCK: DRIFTED_LIGHT}))))

# theme.css quotes the selectors and the tokens it explains, at
# length, in the block comments beside them.
check("a palette written out inside a comment rules nothing",
      check_web.token_problems(token_css(
          extra="/* :root[data-theme='ghost'] { --color-bg: #fff; } */"
      )) == [])


# The mockup's own note names the one departure it could not avoid:
# the live site serves vendored woff2 files where the mockup shows the
# fallback stacks. That makes the coupling checkable - a stack leading
# with a family nothing vendors still resolves, to the next name in
# it, so every page keeps rendering in a face the mockup never showed.
check("the stacks and the faces the stylesheet ships agree",
      check_web.font_stack_problems(token_css()) == [])

UNVENDORED = dict(check_web.MOCKUP_SCALE)
UNVENDORED["--font-body"] = '"Inter", system-ui, sans-serif'
check("a stack leading with a family nothing vendors is reported",
      any("Inter" in p for p in check_web.font_stack_problems(
          token_css({check_web.MOCKUP_SCALE_BLOCK: UNVENDORED}))))

check("a vendored family no stack leads with is reported",
      any("Comic Sans" in p for p in check_web.font_stack_problems(
          token_css(extra='@font-face { font-family: "Comic Sans"; '
                          'src: url("c.woff2"); }'))))


# The sign-in swatches, which are the one component this check reads.
# A dot cannot ask CSS for a palette other than the one the page is
# wearing, so the eight colors are written on the component - and a
# copy nothing compares is what stops meaning the palette the moment
# that palette is retuned.
def swatch_css(overrides=None, drop=()):
    """The shipped swatch rules, with the named palettes edited."""
    out = []
    for palette, tokens in sorted(check_web.MOCKUP_PALETTES.items()):
        if palette in drop:
            continue
        edit = (overrides or {}).get(palette, {})
        shown = {"background": tokens["--color-bg"],
                 "border-color": tokens["--color-accent"]}
        shown.update(edit)
        body = "".join("%s: %s;" % pair for pair in sorted(shown.items())
                       if pair[1] is not None)
        out.append('.swatch-dot[data-palette="%s"] { %s }' % (palette, body))
    return "\n".join(out)


check("swatches painted from the ruled palettes raise nothing",
      check_web.swatch_problems(swatch_css()) == [])

# The arm this exists for. Retune a palette and leave the dot behind,
# and the row goes on looking exactly as deliberate as it did before.
check("a swatch whose background has left its palette is refused",
      any("--color-bg" in p for p in check_web.swatch_problems(
          swatch_css({"pink": {"background": "#000000"}}))))
check("a swatch whose ring has left its palette is refused",
      any("--color-accent" in p for p in check_web.swatch_problems(
          swatch_css({"midnight": {"border-color": "#000000"}}))))
check("a swatch missing half the dot is refused",
      any("falls through" in p for p in check_web.swatch_problems(
          swatch_css({"daylight": {"border-color": None}}))))

# Both directions on the roster, the DESTINATIONS way.
check("a ruled palette with no swatch at all is refused",
      any("contrast" in p for p in check_web.swatch_problems(
          swatch_css(drop=("contrast",)))))
check("a swatch for a palette the mockup does not rule is refused",
      any("sepia" in p for p in check_web.swatch_problems(
          swatch_css() +
          '\n.swatch-dot[data-palette="sepia"] { background: #fff; '
          'border-color: #000; }')))
check("the same swatch painted twice over is refused",
      any("times over" in p for p in check_web.swatch_problems(
          swatch_css() + "\n" + swatch_css(drop=("pink", "daylight",
                                                 "contrast")))))

# And a stylesheet that offers no swatches at all fails rather than
# passing quietly - four missing dots read as four missing rules, not
# as a page that stopped offering palettes.
check("a stylesheet painting no swatch at all is refused",
      len(check_web.swatch_problems("")) == len(check_web.MOCKUP_PALETTES))

check("the shipped stylesheet's swatches are the ruled palettes",
      check_web.swatch_problems(check_web.stylesheet_text()) == [])


# The reader under all of it. A table keyed on the exact bytes of a
# selector goes stale the first time somebody rewraps a line, so the
# normalizing is load-bearing rather than tidy.
WRAPPED = """
:root,
:root[data-theme="midnight"] {
  --font-body: "DM Sans", system-ui,
               -apple-system, sans-serif;
}
"""
WRAPPED_BLOCKS = check_web.custom_property_blocks(WRAPPED)
check("a selector list wrapped over two lines is one selector",
      [s for _m, s, _d in WRAPPED_BLOCKS]
      == [':root, :root[data-theme="midnight"]'])
check("and a value wrapped over two lines is one value",
      WRAPPED_BLOCKS[0][2]
      == [("--font-body", '"DM Sans", system-ui, -apple-system, '
                          "sans-serif")])

MEDIA_BLOCKS = check_web.custom_property_blocks(
    "@media (prefers-contrast: more) { :root { --radius: 0; } }")
check("a block inside @media is attributed to its condition",
      MEDIA_BLOCKS == [("(prefers-contrast: more)", ":root",
                        [("--radius", "0")])])

check("a rule declaring no custom property is not a token block",
      check_web.custom_property_blocks(
          ".card { display: flex; } :root { color-scheme: dark; }") == [])
check("and neither is a keyframe step",
      check_web.custom_property_blocks(
          "@keyframes o { from { opacity: 1; } to { opacity: 0; } }")
      == [])


# The palette names, which check 23 deliberately declines to pin: that
# arm holds the four copies to each other and says so, and this is the
# other side of the sentence - what the word they agree on has to be.
def chip_page(chips):
    """A page carrying exactly `chips`, as (id, label) pairs."""
    return "".join(
        '<button data-set-theme="%s">%s</button>' % pair for pair in chips)


RULED_CHIPS = sorted(check_web.MOCKUP_CHIPS.items())
check("the ruled palette names pass",
      check_web.page_chip_label_problems(chip_page(RULED_CHIPS)) == [])

RENAMED = [(i, "Parchment Daylight" if i == "daylight" else w)
           for i, w in RULED_CHIPS]
RENAMED_FOUND = check_web.page_chip_label_problems(chip_page(RENAMED))
check("a palette wearing a name the mockup does not rule is reported",
      len(RENAMED_FOUND) == 1)
check("and the message carries both names",
      "Parchment Daylight" in RENAMED_FOUND[0]
      and "Daylight" in RENAMED_FOUND[0])

check("a palette id the mockup does not rule is reported",
      any("sepia" in p for p in check_web.page_chip_label_problems(
          chip_page([*RULED_CHIPS, ("sepia", "Sepia")]))))

# Three shapes check 23's roster arm already reports, each with a
# different thing to go and look at. Restating them here is what that
# arm's docstring declines to do in the other direction.
check("an empty chip id is left to check 23",
      check_web.page_chip_label_problems(
          '<button data-set-theme="">Midnight</button>') == [])
check("a chip with no words is left to check 23",
      check_web.page_chip_label_problems(
          '<button data-set-theme="midnight"></button>') == [])
check("a chip whose element never closes is left to check 23",
      check_web.page_chip_label_problems(
          '<button data-set-theme="midnight">Midnight') == [])


# Surfaces the mockup rules OUT. Absence is not a claim: .rail-note is
# gone from every page and from theme.css today, and nothing else in
# this gate would notice it coming back.
check("a page carrying a refused surface is reported",
      any("rail-note" in p for p in check_web.page_refused_problems(
          '<span class="rail-note">Keyholder only</span>')))
check("and it is found among a list of classes, not only alone",
      check_web.page_refused_problems(
          '<span class="small rail-note muted">x</span>') != [])
check("a class that merely starts with the refused name is not it",
      check_web.page_refused_problems(
          '<span class="rail-notes">x</span>') == [])
check("a clean page is clean",
      check_web.page_refused_problems(
          '<ul class="rail-links"><li>x</li></ul>') == [])

check("a stylesheet still defining a refused surface is reported",
      any("rail-note" in p for p in check_web.stylesheet_refused_problems(
          ".rail-note { display: block; }")))
check("a longer class name that contains it is not it",
      check_web.stylesheet_refused_problems(
          ".rail-note-hidden { display: none; }") == [])
check("and a descendant selector still counts as defining it",
      check_web.stylesheet_refused_problems(
          ".rail .rail-note { color: red; }") != [])


# The wrappers, against the shipped tree. Everything above drives pure
# functions on strings, and a wrapper returning [] satisfies all of it.
check("the shipped stylesheet is the mockup's token table",
      check_web.mockup_token_problems() == [])
check("the shipped pages call every palette what the mockup calls it",
      check_web.chip_label_problems() == [])
check("nothing shipped carries a surface the mockup ruled out",
      check_web.refused_surface_problems() == [])


def tokens_over(css):
    """mockup_token_problems() against a stylesheet holding `css`."""
    with tempfile.TemporaryDirectory() as folder:
        with open(os.path.join(folder, check_web.STYLESHEET), "w",
                  encoding="utf-8") as handle:
            handle.write(css)
        shipped = check_web.WEB
        try:
            check_web.WEB = folder
            return check_web.mockup_token_problems()
        finally:
            check_web.WEB = shipped


check("the token wrapper reads the stylesheet on disk",
      any("--measure" in p for p in tokens_over(
          token_css({check_web.MOCKUP_SCALE_BLOCK: WIDER}))))
check("and it is the shipped stylesheet it normally reads",
      check_web.WEB.endswith(os.path.join("apps", "web")))

def tokens_with_no_stylesheet():
    """mockup_token_problems() over a directory carrying no theme.css."""
    with tempfile.TemporaryDirectory() as folder:
        shipped = check_web.WEB
        try:
            check_web.WEB = folder
            return check_web.mockup_token_problems()
        finally:
            check_web.WEB = shipped


# A missing stylesheet is check 1's to report, and reporting it twice
# is how one of the two gets weakened.
check("a missing stylesheet is left to check 1",
      tokens_with_no_stylesheet() == [])


def refused_over(pages, css):
    """refused_surface_problems() against a directory of `pages`."""
    with tempfile.TemporaryDirectory() as folder:
        for name, markup in pages.items():
            with open(os.path.join(folder, name), "w",
                      encoding="utf-8") as handle:
                handle.write(
                    "<!doctype html><html><body>%s</body></html>" % markup)
        with open(os.path.join(folder, check_web.STYLESHEET), "w",
                  encoding="utf-8") as handle:
            handle.write(css)
        shipped = check_web.WEB
        try:
            check_web.WEB = folder
            return check_web.refused_surface_problems()
        finally:
            check_web.WEB = shipped


REFUSED_FOUND = refused_over(
    {"your-page.html": '<span class="rail-note">Keyholder only</span>'},
    ".rail-note { display: block; }")
check("the refusal wrapper reads the pages and the stylesheet",
      {subject for subject, _p in REFUSED_FOUND}
      == {"your-page.html", check_web.STYLESHEET})
# theme.css and every page carry long comments quoting the markup and
# the selectors the rules refuse.
check("a refused surface named only in a comment is not carried",
      refused_over(
          {"your-page.html": '<!-- <span class="rail-note">x</span> -->'},
          "/* .rail-note is gone, see #191 */") == [])


def chip_labels_over(pages):
    """chip_label_problems() against a directory of `pages`."""
    with tempfile.TemporaryDirectory() as folder:
        for name, markup in pages.items():
            with open(os.path.join(folder, name), "w",
                      encoding="utf-8") as handle:
                handle.write(
                    "<!doctype html><html><body>%s</body></html>" % markup)
        shipped = check_web.WEB
        try:
            check_web.WEB = folder
            return check_web.chip_label_problems()
        finally:
            check_web.WEB = shipped


check("the chip wrapper reads the pages rather than answering from "
      "nowhere",
      [s for s, _p in chip_labels_over({
          "your-page.html": chip_page(RENAMED),
          "admin.html": chip_page(RULED_CHIPS),
      })] == ["your-page.html"])
# A ruled palette that has stopped being offered anywhere is a stale
# pin, and a stale pin is how a table stops describing the site.
check("a ruled palette no page offers is reported against the pin",
      any(subject == check_web.MOCKUP_CHIP_PIN for subject, _p in
          chip_labels_over({
              "your-page.html": chip_page(RULED_CHIPS[:3]),
              "admin.html": chip_page(RULED_CHIPS[:3]),
          })))
# Failing open here on purpose: a site with no chips at all is check
# 19 failing on every themed page, and four more lines saying the
# mockup rules a palette nothing offers help nobody.
check("a site with no chips leaves the stale-pin arm quiet",
      chip_labels_over({"your-page.html": "<p>Nothing here.</p>"}) == [])


# ------------------------------------------------------------------
# Check 25: one card geometry across the signed-in pages, and the
# instrument's boxes are warnings.
#
# The reader is most of this arm's risk, exactly as it was for the CSP:
# the rules are two comparisons and a roster, and everything hard is in
# deciding which rule paints a card, which page a scope applies to, and
# which box a label is standing in. So the scanner is driven over
# strings here rather than over the five files it guards - a rule
# reachable only through today's markup is a rule tested against today's
# markup.

GEOMETRY_CSS = """
.card { padding: 1rem; border-radius: var(--radius); gap: 0.75rem; }
.stack { display: flex; gap: 1rem; }
.stack-tight { gap: 0.25rem; }
h1, h2, h3 { font-family: var(--font-display); }
body.instrument .card { padding: 0.75rem; gap: 0.5rem; }
"""


def subject(selector):
    return check_web.geometry_subject(selector)


check("a bare component selector has no context",
      subject(".card") == ("", ".card", ".card"))
check("a surface-qualified one carries its context",
      subject("body.instrument .card")
      == ("body.instrument", ".card", ".card"))
check("an element subject is read the same way",
      subject("body.instrument h2") == ("body.instrument", "h2", "h2"))
check("a component that merely starts with the name is not it",
      subject(".stack-tight") is None)
check("and a rule painting something else is not read at all",
      subject(".row input[type=\"text\"]") is None)
check("a card used only as a context paints nothing here",
      subject(".card .hint") is None)

# The gap #154's partition-2 sweep found, and the reason it was ranked
# blocks-cutover: a subject was recognized only when the rightmost
# compound was EXACTLY the component, so qualifying it took the rule out
# of both arms while the browser went on applying it normally. Silence
# is the failure mode that looks like success.
check("a type qualifier does not make it a different component",
      subject("div.card") == ("", ".card", "div.card"))
check("nor does one on a scoped rule",
      subject("body.entries div.card")
      == ("body.entries", ".card", "div.card"))
check("the shipped shape of that gap reads as the stack it is",
      subject("body.instrument main.stack")
      == ("body.instrument", ".stack", "main.stack"))
check("a modifier class alongside the component is still the component",
      subject("section.card.wide") == ("", ".card", "section.card.wide"))
# From #154's partition-3 report: a redundant qualifier matches exactly
# the element set the bare selector does, so reading it as a different
# subject is a rule that paints cards and is compared against nothing.
check("a redundant same-class qualifier is the same subject",
      subject(".card.card") == ("", ".card", ".card.card"))

# The asymmetry the same finding names: an unreadable CONTEXT was
# reported and an unreadable SUBJECT was dropped. A reader that skips
# what it cannot parse prints the same OK as one that found nothing
# wrong, which is #34 again one layer in.
check("a subject this reader cannot score is reported, not dropped",
      subject(".card:hover") == ("", None, ".card:hover"))
check("and so is one behind a pseudo-element",
      subject("body.instrument .card::before")
      == ("body.instrument", None, ".card::before"))
check("and one behind an attribute selector",
      subject(".card[data-open]") == ("", None, ".card[data-open]"))
check("a compound naming two components at once cannot be scored either",
      subject("h2.card") == ("", None, "h2.card"))
check("but a pseudo-class on something that is not a component stays "
      "silent",
      subject(".row:hover") is None)

check("a selector list is split before it is read",
      [b[2] for b in check_web.geometry_declarations(
          "h1, h2, h3 { font-size: 1rem; }")] == ["h2"])
check("a block declaring no geometry is not a geometry block",
      check_web.geometry_declarations(".card { color: red; }") == [])
check("a longhand counts as geometry, which is the evasion a name "
      "list misses",
      check_web.geometry_declarations(".card { padding-top: 1rem; }") != [])
check("and a block inside @media is attributed to its condition",
      check_web.geometry_declarations(
          "@media (max-width: 52rem) { .card { padding: 0; } }"
      )[0][0] == "(max-width: 52rem)")
check("geometry written inside a comment paints nothing",
      check_web.geometry_declarations(
          "/* .card { padding: 9rem; } */ .card { color: red; }") == [])
check("a qualified subject reaches the reader at all",
      [b[2] for b in check_web.geometry_declarations(
          "body.instrument main.stack { gap: 1rem; }")] == [".stack"])

# #154's partition-2 F2. The owner's ruling quoted in theme.css opens
# with "cards to all be the same width", and the width family was the
# one part of a card's shape this pattern could not see - so the fully
# declared, honestly written per-page width override passed both arms.
for property_ in ("width", "min-width", "max-width", "inline-size",
                  "min-inline-size", "max-inline-size", "margin",
                  "margin-top", "margin-inline", "margin-inline-start",
                  "margin-block", "flex-basis"):
    check("%s is part of a card's shape" % property_,
          check_web.geometry_declarations(
              ".card { %s: 1rem; }" % property_) != [])
check("and a property that only sounds like one is not",
      check_web.geometry_declarations(".card { marginal: 1rem; }") == [])

check("a bare rule applies to every page",
      check_web.context_applies("", frozenset()) is True)
check("a surface scope applies to the page that declares it",
      check_web.context_applies(
          "body.instrument", frozenset({"wide", "instrument"})) is True)
check("and not to one that does not",
      check_web.context_applies(
          "body.instrument", frozenset({"railed"})) is False)
check("a scope naming two classes needs both",
      check_web.context_applies(
          "body.wide.instrument", frozenset({"wide"})) is False)
# The one that keeps this arm from failing open. A context this reader
# has no vocabulary for is neither "applies" nor "does not" - it is
# unread, and #34 is what this repository paid to learn that the two
# must not print the same thing.
check("a scope in a shape this reader cannot resolve is unread, not no",
      check_web.context_applies(".rail", frozenset({"railed"})) is None)
check("and so is a two-compound descendant scope",
      check_web.context_applies(
          "body.instrument .page", frozenset({"instrument"})) is None)

check("a component subject weighs one class",
      check_web.selector_weight("", ".card") == (1, 0))
check("an element subject weighs one element",
      check_web.selector_weight("", "h2") == (0, 1))
check("a surface scope adds its body and its classes",
      check_web.selector_weight("body.instrument", ".card") == (2, 1))
# Reading a qualified compound as its bare component would be a lie
# about specificity, and specificity is what orders the cascade below.
# `div.card` outranks `.card` wherever it sits, exactly as a scope does.
check("a type qualifier weighs its element",
      check_web.selector_weight("", "div.card") == (1, 1))
check("a modifier class weighs a class",
      check_web.selector_weight("", "section.card.wide") == (2, 1))
check("a redundant qualifier weighs twice, which is what a browser does",
      check_web.selector_weight("", ".card.card") == (2, 0))
check("the shipped instrument stack weighs both bodies and both classes",
      check_web.selector_weight("body.instrument", "main.stack") == (2, 2))
# The defect a mutation found: ordering by source position alone lets a
# scoped rule written ABOVE the bare one lose, where a browser has it
# win. A per-page difference would then be real, rendered, and reported
# as agreement.
SCOPE_FIRST = ("body.instrument .card { padding: 9rem; }\n"
               ".card { padding: 1rem; }\n")
check("a scope written above the rule it overrides still wins",
      check_web.resolved_geometry(
          check_web.geometry_declarations(SCOPE_FIRST),
          frozenset({"instrument"}))[0][("", ".card", "padding")] == "9rem")
check("and the page it does not name keeps the bare rule",
      check_web.resolved_geometry(
          check_web.geometry_declarations(SCOPE_FIRST),
          frozenset({"railed"}))[0][("", ".card", "padding")] == "1rem")
check("two rules of equal weight are settled by source position",
      check_web.resolved_geometry(
          check_web.geometry_declarations(
              ".card { padding: 1rem; }\n.card { padding: 2rem; }"),
          frozenset())[0][("", ".card", "padding")] == "2rem")
# The same defect one step along: a qualified compound written above the
# bare rule wins in a browser too, and reading it as the bare component
# would put it back under source position.
QUALIFIED_FIRST = ("div.card { padding: 9rem; }\n"
                   ".card { padding: 1rem; }\n")
check("a qualified rule written above the bare one still wins",
      check_web.resolved_geometry(
          check_web.geometry_declarations(QUALIFIED_FIRST),
          frozenset())[0][("", ".card", "padding")] == "9rem")

RESOLVED_MEMBER, UNREAD_MEMBER = check_web.resolved_geometry(
    check_web.geometry_declarations(GEOMETRY_CSS), frozenset({"railed"}))
RESOLVED_INSTRUMENT, _ = check_web.resolved_geometry(
    check_web.geometry_declarations(GEOMETRY_CSS),
    frozenset({"railed", "instrument"}))

check("a member page resolves the base card padding",
      RESOLVED_MEMBER[("", ".card", "padding")] == "1rem")
check("the instrument's own scope wins on the instrument",
      RESOLVED_INSTRUMENT[("", ".card", "padding")] == "0.75rem")
check("a scope the page does not match leaves the base standing",
      RESOLVED_MEMBER[("", ".card", "gap")] == "0.75rem")
check("a property no scope touches survives into both",
      RESOLVED_MEMBER[("", ".card", "border-radius")]
      == RESOLVED_INSTRUMENT[("", ".card", "border-radius")])
check("nothing in a readable stylesheet is reported unread",
      UNREAD_MEMBER == [])


def agreement_over(css, pages):
    return [problem for _, problem
            in check_web.geometry_agreement_problems(css, pages)]


TWO_CARD_PAGES = dict.fromkeys(check_web.card_pages(),
                               '<body class="railed"></body>')

check("two card pages resolving the same geometry agree",
      agreement_over(GEOMETRY_CSS, TWO_CARD_PAGES) == [])
# The arm's whole point, stated as a test: moving the design moves
# every page at once and stays green. A check that reddened here would
# be edited until it stopped - #142.
check("moving the component itself moves both pages and stays quiet",
      agreement_over(GEOMETRY_CSS.replace("padding: 1rem", "padding: 2rem"),
                     TWO_CARD_PAGES) == [])
check("a scope that reaches exactly one card page is reported",
      len(agreement_over(
          GEOMETRY_CSS + "body.narrowcards .card { padding: 3rem; }",
          {check_web.card_pages()[0]: '<body class="railed narrowcards">',
           check_web.card_pages()[1]: '<body class="railed">'})) == 1)
check("and the message says which property moved on which page",
      "padding" in agreement_over(
          GEOMETRY_CSS + "body.narrowcards .card { padding: 3rem; }",
          {check_web.card_pages()[0]: '<body class="railed narrowcards">',
           check_web.card_pages()[1]: '<body class="railed">'})[0])
check("a property one page declares and the other does not is a "
      "difference too",
      len(agreement_over(
          GEOMETRY_CSS + "body.narrowcards .card { border-top: 0; }",
          {check_web.card_pages()[0]: '<body class="railed narrowcards">',
           check_web.card_pages()[1]: '<body class="railed">'})) == 1)
check("an unresolvable scope is reported rather than passed over",
      any("cannot resolve" in problem for problem in agreement_over(
          GEOMETRY_CSS + ".rail .card { padding: 0; }", TWO_CARD_PAGES)))
check("and so is a subject in a shape this reader cannot score",
      any("cannot score" in problem for problem in agreement_over(
          GEOMETRY_CSS + ".card:hover { padding: 0; }", TWO_CARD_PAGES)))

# #154's partition-2 F1, as the report wrote it: the qualified form of a
# per-page override has to fail everything the bare form fails. Four
# properties, four failures, either way round.
SPLIT_PAGES = {
    check_web.card_pages()[0]: '<body class="railed narrowcards">',
    check_web.card_pages()[1]: '<body class="railed">',
}
OVERRIDE = ("{ padding: 3rem; gap: 0; border-top: 0; max-width: 18rem; }")

check("a qualified per-page override fails exactly what the bare one "
      "fails",
      agreement_over(
          GEOMETRY_CSS + "body.narrowcards div.card " + OVERRIDE,
          SPLIT_PAGES)
      == agreement_over(
          GEOMETRY_CSS + "body.narrowcards .card " + OVERRIDE, SPLIT_PAGES))
check("and there are four of them, one per property that moved",
      len(agreement_over(
          GEOMETRY_CSS + "body.narrowcards div.card " + OVERRIDE,
          SPLIT_PAGES)) == 4)

# #154's partition-2 F2, the report's own mutation. It is the honest,
# fully declared per-page width override - which is why it passed.
WIDTHS = "{ max-width: 18rem; width: 18rem; margin-inline: 0; }"

check("a per-page width override is a difference this arm reports",
      len(agreement_over(GEOMETRY_CSS + "body.narrowcards .card " + WIDTHS,
                         SPLIT_PAGES)) == 3)
# The #142 direction, and the one that decides whether the family can
# stay in the pattern: widths that move both pages at once are the
# design evolving, and an arm that reddened here would be edited until
# it stopped.
check("a shared width rule moves both pages together and stays quiet",
      agreement_over(GEOMETRY_CSS + ".card " + WIDTHS, TWO_CARD_PAGES) == [])
check("and it needs no scope pin either, because it scopes nothing",
      [problem for problem
       in check_web.card_scope_problems(GEOMETRY_CSS + ".card " + WIDTHS)
       if "does not name it" in problem[1]] == [])
# A comparison with one side is not a comparison. It has to say so
# rather than print the agreement it never established.
check("fewer than two wearers is reported, not reported as agreement",
      len(agreement_over(GEOMETRY_CSS,
                         {check_web.card_pages()[0]: "<body>"})) == 1)


def scopes_over(css):
    return [problem for _, problem in check_web.card_scope_problems(css)]


check("the shipped scopes are the pinned scopes",
      scopes_over(check_web.stylesheet_text()) == [])
check("a surface override nobody wrote down is reported",
      any("CARD_SCOPES" in problem for problem in scopes_over(
          check_web.stylesheet_text()
          + "\nbody.railed .card { padding: 0; }")))
check("a pin whose block has gone is reported as stale",
      any("still names it" in problem
          for problem in scopes_over(".card { padding: 1rem; }")))
check("a bare rule needs no pin",
      scopes_over(".card { padding: 1rem; }\n.stack { gap: 1rem; }")
      == [problem for problem in scopes_over(".card { padding: 1rem; }")
          if "still names it" in problem])
check("a width-family override is a scope like any other",
      any("does not name it" in problem for problem in scopes_over(
          check_web.stylesheet_text()
          + "\nbody.railed .card { max-width: 18rem; }")))
check("and a qualified one cannot slip past the roster",
      any("does not name it" in problem for problem in scopes_over(
          check_web.stylesheet_text()
          + "\nbody.railed div.card { padding: 0; }")))

# #154's partition-3 report: the roster said only THAT a scope existed,
# so the scope's own values were free to move. A roster that cannot see
# its entry change is a roster the design drifts underneath - which is
# the whole defect #178 was about, one indirection out.
SHIPPED_CSS = check_web.stylesheet_text()
INSTRUMENT_PADDING = "var(--space-3) var(--space-4) var(--space-4)"

check("a rostered scope changing its value is reported",
      any("CARD_SCOPES" in problem for problem in scopes_over(
          SHIPPED_CSS.replace(INSTRUMENT_PADDING, "7px"))))
check("and the message says which property moved",
      any("padding" in problem for problem in scopes_over(
          SHIPPED_CSS.replace(INSTRUMENT_PADDING, "7px"))))
check("a rostered scope growing a property is reported too",
      any("max-width" in problem for problem in scopes_over(
          SHIPPED_CSS.replace(
              "padding: " + INSTRUMENT_PADDING,
              "max-width: 18rem;\n  padding: " + INSTRUMENT_PADDING))))

# The other direction, and the one that keeps the pin from being edited
# away the first time the design legitimately moves: the entry and the
# rule are edited together, the same two-place act as raising a ceiling
# in tools/check_budget.py.
SHIPPED_SCOPES = check_web.CARD_SCOPES
MOVED = dict(SHIPPED_SCOPES)
MOVED[("body.instrument", ".card")] = {
    "why": SHIPPED_SCOPES[("body.instrument", ".card")]["why"],
    "declares": dict(SHIPPED_SCOPES[("body.instrument", ".card")]["declares"]),
}
MOVED[("body.instrument", ".card")]["declares"][("", "padding")] = "7px"
try:
    check_web.CARD_SCOPES = MOVED
    check("a scope moved in both places at once is silent",
          scopes_over(SHIPPED_CSS.replace(INSTRUMENT_PADDING, "7px")) == [])
finally:
    check_web.CARD_SCOPES = SHIPPED_SCOPES


def markup(inner, classes="railed instrument"):
    return ('<body class="%s"><aside class="rail">'
            '<p class="runner"><span>Session</span></p></aside>'
            "<main class=\"stack\">%s</main></body>" % (classes, inner))


def grammar(inner, kind="sections", classes="railed instrument"):
    return check_web.grammar_markup_problems(markup(inner, classes), kind)


TOOL = '<div class="tool"><p class="runner"><span>Charts</span></p></div>'
WARN_BOX = '<div class="card"><p class="caution">Development session</p></div>'
FLAG_BOX = '<div class="card"><p class="flag">Unavailable</p></div>'

check("a runner-headed section on the instrument is the grammar",
      grammar(TOOL) == [])
check("a warning box beside it is the one box that stays",
      grammar(TOOL + WARN_BOX) == [])
check("an outcome box is a box that says something too",
      grammar(TOOL + FLAG_BOX) == [])
check("a tool that kept its card is reported",
      len(grammar('<div class="card"><p class="runner"><span>Charts</span>'
                  "</p></div>")) > 0)
check("and the report names the section it found in a box",
      any("Charts" in problem for problem in grammar(
          '<div class="card"><p class="runner"><span>Charts</span>'
          "</p></div>")))
check("a box with nothing to act on is a tool that kept its card",
      any("no outcome and no caution" in problem
          for problem in grammar('<div class="card"><p>Words.</p></div>')))
check("a section with no runner on it is reported",
      any("no runner standing on it" in problem
          for problem in grammar('<div class="tool"><p>Words.</p></div>')))
check("a runner standing on something that is not a section is reported",
      any("not a .tool" in problem for problem in grammar(
          '<div class="stack"><p class="runner"><span>Charts</span>'
          "</p></div>")))
# The rail carries a Session runner on every signed-in page, and it is
# not a section of the document. Reading only <main> is what keeps that
# from needing a carve-out by name - the kind that stops applying the
# day the rail grows a second one.
check("the rail's own runner is outside all of this",
      grammar(TOOL) == [])
check("a page with no main at all reports nothing rather than throwing",
      check_web.grammar_markup_problems(
          '<body class="railed instrument"></body>', "sections") == [])

check("a card page carrying cards is the grammar",
      grammar(WARN_BOX, "cards", "railed") == [])
check("the instrument's section grammar leaking outward is reported",
      any(".tool section inside <main>" in problem
          for problem in grammar(TOOL, "cards", "railed")))
check("and a card page's runner outside a box is left alone",
      grammar('<div class="stack-tight">'
              '<p class="runner"><span>Optional</span></p></div>',
              "cards", "railed") == [])
check("a width opt-out on a page with no wide measure to opt out of "
      "is reported",
      any(".narrow" in problem for problem in grammar(
          '<div class="card narrow"><p>Words.</p></div>', "cards",
          "railed")))
check("and the instrument keeps it, because there it paints",
      grammar('<div class="card narrow">'
              '<p class="caution">Development session</p></div>') == [])

check("the two grammars name every signed-in page and no other",
      sorted(check_web.card_pages() + check_web.section_pages())
      == sorted(name for name, shell in check_web.SHELLS.items()
                if shell == "rail"))
check("the shipped pages wear the grammar they are pinned to",
      check_web.grammar_problems() == [])


# ------------------------------------------------------------------
# Check 26: the styling routes checks 24 and 25 do not cover.
#
# #154's sweep, P2 F3 and P3 mutation J. Checks 24 and 25 read one
# stylesheet and speak for the whole site's appearance, and the only
# thing that makes that true is `style-src 'self'` in every page's CSP
# - which nothing in either check named, so a policy edit could have
# taken the design gate's teeth out while every arm above stayed green.
# The second same-origin stylesheet is the route the CSP itself leaves
# open, because a second file on this origin is exactly what 'self'
# permits.

check("the baseline every page inherits closes inline styling",
      check_web.CSP_BASELINE["style-src"] == check_web.STYLE_SOURCE)
check("and 'self' alone is what that means",
      check_web.STYLE_SOURCE == ["'self'"])

# The pin table is what this arm reads, because a widened pin is the
# failure it exists for: a page and its pin widened together satisfy
# check 13, which reconciles the two against each other and has no
# opinion about what they agree on.
BASE_PIN = {"style-src": ["'self'"]}
check("a pin table that keeps styling on this origin is clean",
      check_web.pinned_style_problems(
          {"admin.html": BASE_PIN, "charts.html": BASE_PIN}) == [])

INLINE = check_web.pinned_style_problems(
    {"admin.html": BASE_PIN,
     "charts.html": {"style-src": ["'self'", "'unsafe-inline'"]}})
check("a pin that admits inline styling is reported",
      [subject for subject, _p in INLINE] == ["charts.html"])
check("and the report says which gate it disarms",
      "check 24" in INLINE[0][1].lower()
      and "check 25" in INLINE[0][1].lower())

check("a pin that admits another origin is reported too",
      len(check_web.pinned_style_problems(
          {"admin.html": {"style-src": ["'self'", "https://cdn.example"]}}))
      == 1)

# Absence is not silence here. A pin with no style-src at all leaves
# default-src to govern styling, and the table then says nothing about
# the directive this whole arm depends on.
check("a pin with no style-src at all is reported",
      len(check_web.pinned_style_problems(
          {"admin.html": {"script-src": ["'self'"]}})) == 1)

check("the shipped pin table is closed",
      check_web.pinned_style_problems() == [])


def links(*tags):
    return "<html><head>%s</head><body></body></html>" % "".join(tags)


THEME_LINK = '<link rel="stylesheet" href="theme.css">'

check("the one stylesheet a page is allowed is clean",
      check_web.page_stylesheet_problems(links(THEME_LINK)) == [])

# Mutation J itself. Nothing else in this gate reads a second
# stylesheet: check 1 only asks whether the file it names exists, and
# checks 24 and 25 open theme.css by name.
SECOND = check_web.page_stylesheet_problems(
    links(THEME_LINK, '<link rel="stylesheet" href="extra.css">'))
check("a second same-origin stylesheet is reported",
      len(SECOND) == 1)
check("and the report names the file that would paint",
      "extra.css" in SECOND[0])

check("an off-origin stylesheet is reported as well",
      len(check_web.page_stylesheet_problems(links(
          THEME_LINK,
          '<link rel="stylesheet" href="https://cdn.example/x.css">'))) == 1)

# An alternate stylesheet is a stylesheet a member can switch to, which
# is the same route wearing a different rel.
check("an alternate stylesheet is still a stylesheet",
      len(check_web.page_stylesheet_problems(links(
          THEME_LINK,
          '<link rel="alternate stylesheet" href="extra.css">'))) == 1)

check("a link that is not a stylesheet is not read",
      check_web.page_stylesheet_problems(links(
          THEME_LINK, '<link rel="icon" href="favicon.ico">')) == [])

# The same file twice paints nothing new, and it is still reported: two
# link elements are two places to re-point, and the second is the one
# nobody re-reads.
check("the one stylesheet linked twice is reported",
      len(check_web.page_stylesheet_problems(
          links(THEME_LINK, THEME_LINK))) == 1)

check("a cache-busting query is the same file",
      check_web.page_stylesheet_problems(
          links('<link rel="stylesheet" href="theme.css?v=2">')) == [])

# A page with no stylesheet at all is check 3's to report, and saying it
# twice is how one of the two gets weakened.
check("a page linking nothing is left to check 3",
      check_web.page_stylesheet_problems(links()) == [])


def styling_over(pages):
    """styling_exclusivity_problems() against a directory of `pages`."""
    with tempfile.TemporaryDirectory() as folder:
        for name, head in pages.items():
            with open(os.path.join(folder, name), "w",
                      encoding="utf-8") as handle:
                handle.write("<!doctype html>" + links(head))
        shipped = check_web.WEB
        try:
            check_web.WEB = folder
            return check_web.styling_exclusivity_problems()
        finally:
            check_web.WEB = shipped


check("the wrapper reads the pages on disk rather than answering from "
      "nowhere",
      [subject for subject, _p in styling_over({
          "your-page.html": THEME_LINK + '<link rel="stylesheet" '
                                         'href="extra.css">',
          "charts.html": THEME_LINK,
      })] == ["your-page.html"])

# Every page here quotes markup in its comments, theme.css included.
check("a stylesheet named only in a comment is not linked",
      styling_over({"your-page.html":
                    THEME_LINK + "<!-- %s -->" %
                    '<link rel="stylesheet" href="extra.css">'}) == [])

# The third route, and the quietest of the three: an @import is
# same-origin, so the policy permits it, and it sits INSIDE the file
# checks 24 and 25 open rather than beside it - every page's link
# roster stays correct while rules paint from somewhere nothing here
# reads.
IMPORTED = check_web.stylesheet_import_problems(
    '@import url("extra.css");\n.card { padding: 1rem; }\n')
check("a stylesheet pulling in a second one is reported",
      len(IMPORTED) == 1)
check("and the report quotes the import it found",
      "extra.css" in IMPORTED[0])
check("a stylesheet that imports nothing is clean",
      check_web.stylesheet_import_problems(".card { padding: 1rem; }") == [])

# THE ANIMATION, refused rather than merely absent. #273 removed the
# entrance animation and retired the live-verification ledger's
# reduced-motion row on the grounds that there was nothing left for the
# setting to reduce - which grounded a permanent retirement on a
# property nothing enforced. Every mention of @keyframes in tools/ and
# dev/ before this was a parser explicitly SKIPPING the block, so an
# animation could come back with the gate green and the row that would
# have asked somebody to sit with it already gone.
check("a stylesheet declaring an animation is refused",
      any("@keyframes" in p for p in check_web.keyframes_problems(
          "@keyframes rise { from { opacity: 0; } }\n")))
check("a vendor-prefixed one is the same animation",
      len(check_web.keyframes_problems(
          "@-webkit-keyframes rise { from { opacity: 0; } }\n")) == 1)
# What this does NOT hold, said here rather than left to be discovered:
# a transition animates without a keyframe, and the blanket
# prefers-reduced-motion block is what covers it. The retired row was
# about an ENTRANCE, and an entrance needs a keyframe.
check("a transition is not an entrance and is not refused",
      check_web.keyframes_problems(
          ".card { transition: color 120ms; }") == [])
check("the shipped stylesheet declares none",
      check_web.keyframes_problems(check_web.stylesheet_text()) == [])


def imports_over(css):
    """styling_exclusivity_problems() against a stylesheet holding `css`."""
    with tempfile.TemporaryDirectory() as folder:
        with open(os.path.join(folder, check_web.STYLESHEET), "w",
                  encoding="utf-8") as handle:
            handle.write(css)
        shipped = check_web.WEB
        try:
            check_web.WEB = folder
            return check_web.styling_exclusivity_problems()
        finally:
            check_web.WEB = shipped


# theme.css argues at length, in comments, about what it refuses.
check("an import named only in a comment is not an import",
      imports_over("/* No @import url(\"extra.css\") here, see #227. */")
      == [])
check("and the same line outside a comment is one",
      [subject for subject, _p in
       imports_over('@import url("extra.css");')] == [check_web.STYLESHEET])

check("nothing shipped is styled by anything but the one stylesheet",
      check_web.styling_exclusivity_problems() == [])


# ------------------------------------------------------------------
# Check 27: the owner's register bar (#275).
#
# The arm that matters is EQUALITY, and it is tested against the very
# sentence the ruling removed: "Signed out. This browser now holds
# nothing of yours." contains "Signed out." exactly, so a containment
# test would report the vetoed line as ruled copy. Every other check
# here is the parser that has to find the element before the comparison
# can be made at all - which is this suite's whole reason for existing.

RULED = '<p class="status" id="signed-out">%s</p>'

# A two-line fixture PAGE THIS SUITE REGISTERS, rather than whichever
# live page happens to hold two pins today. The parser is what is under
# test here, and reading its fixtures off a live pin makes it go red on
# a ruling that never touched it: the door's own "Signed out." entry did
# exactly that when the owner re-sited the acknowledgement to a toast
# (2026-08-23, #454 comment 5389445914) and the words moved to
# RULED_TOAST_LINES. Two entries, because "one ruled line missing does
# not excuse the page's others" needs a page with more than one - the
# same reason the SLOT_PAGE block below registers two.
RULED_PAGE = "test-fixture-ruled-lines.html"
check_web.RULED_LINES[RULED_PAGE] = {
    "signed-out": "Signed out.",
    "privacy-line": "[Privacy line — the owner writes this sentence at "
                    "the 0.9-M4 register sitting.]",
}
PRIVACY_LINE = (
    '<p class="muted" id="privacy-line" data-pending-copy="0.9-M4">'
    "[Privacy line — the owner writes this sentence at the 0.9-M4 "
    "register sitting.]</p>")

try:
    check("the ruled line is read off the element that renders it",
          check_web.ruled_line_problems(
              RULED % "Signed out." + PRIVACY_LINE, RULED_PAGE) == [])
    check("and the sentence the ruling removed is not the ruled line",
          check_web.ruled_line_problems(
              RULED % "Signed out. This browser now holds nothing of yours."
              + PRIVACY_LINE, RULED_PAGE) != [])
    check("a paragraph broken over lines still reads as one sentence",
          check_web.ruled_line_problems(
              '<p id="signed-out">\n  Signed out.\n</p>' + PRIVACY_LINE,
              RULED_PAGE) == [])
    check("an id nothing renders is a missing ruling, not a passing one",
          len(check_web.ruled_line_problems(
              "<p>Signed out.</p>" + PRIVACY_LINE, RULED_PAGE)) == 1)
    check("one ruled line missing does not excuse the page's others",
          len(check_web.ruled_line_problems(PRIVACY_LINE, RULED_PAGE)) == 1)
    check("a page with no ruled line of its own has nothing to say",
          check_web.ruled_line_problems("<p>anything at all</p>", "404.html")
          == [])
finally:
    # Removed for the reason the SLOT_PAGE block below removes its own:
    # left registered, it is a page with no file behind it that every
    # later arm in this run has to treat as real.
    del check_web.RULED_LINES[RULED_PAGE]

# ------------------------------------------------------------------
# The same ruling's words when a TOAST speaks them (owner ruling
# 2026-08-23, #454 comment 5389445914; #457 review, F2). Four things
# have to hold at once, and each is driven to fail on its own here -
# a pin whose four halves are only ever exercised together is a pin
# whose weakest half is untested.

TOAST_ROW = ("auth.js", "SIGNED_OUT_LINE", "Signed out.", "index.html")
TOAST_CODE = ('const SIGNED_OUT_LINE = "Signed out.";\n'
              "  UI.showToast(SIGNED_OUT_LINE);\n")
TOAST_MARKUP = ('<p class="toast" id="toast" role="status" '
                'aria-live="polite" hidden></p>')

check("a script holding the ruled words and showing them passes",
      check_web.ruled_toast_problems(TOAST_ROW, TOAST_CODE, TOAST_MARKUP)
      == [])
check("a word changed in the constant fails - the ruling is the WORDS, "
      "and the vehicle moving did not soften them",
      len(check_web.ruled_toast_problems(
          TOAST_ROW, TOAST_CODE.replace("Signed out.", "Signed off."),
          TOAST_MARKUP)) == 1)
check("the sentence the ruling removed is refused here too, exactly as "
      "the markup pin refuses it",
      len(check_web.ruled_toast_problems(
          TOAST_ROW,
          TOAST_CODE.replace(
              "Signed out.",
              "Signed out. This browser now holds nothing of yours."),
          TOAST_MARKUP)) == 1)
check("no constant at all is a missing ruling, not a passing one",
      len(check_web.ruled_toast_problems(
          TOAST_ROW, "UI.showToast(SIGNED_OUT_LINE);", TOAST_MARKUP)) == 1)
check("a constant nobody hands to the toast fails - the words would be "
      "in the file and on nobody's screen",
      len(check_web.ruled_toast_problems(
          TOAST_ROW, 'const SIGNED_OUT_LINE = "Signed out.";',
          TOAST_MARKUP)) == 1)
check("a page with no #toast fails - showToast() finds its element by "
      "that id and returns silently, so the acknowledgement would be a "
      "no-op with every text pin green",
      len(check_web.ruled_toast_problems(
          TOAST_ROW, TOAST_CODE, "<p>a door with no toast</p>")) == 1)
check("and a page that is not in apps/web at all is named as that, "
      "rather than read as a page with no toast",
      any("not a page in apps/web" in problem for _file, problem
          in check_web.ruled_toast_problems(TOAST_ROW, TOAST_CODE, None)))

# The runtime slot: a ruled line rendered by an element the page fills
# at runtime rather than by static prose, matched with `{}` standing in
# for the part a script writes. RULED_LINES carried this shape over
# your-page.html's sealed-rows count until 0.9-M2-S2 (#353) retired that
# line with the client seal it described - see RULED_LINES' own comment.
# The property under test is general (ruled_line_problems() over ANY
# `{}` slot), so it is exercised here with a synthetic fixture rather
# than a real page's now-shorter list.
SLOT_PAGE = "test-fixture-two-ruled-lines.html"
check_web.RULED_LINES[SLOT_PAGE] = {
    "key-check": "Compare with the group's pinned code before "
                 "submitting.",
    "history-sealed": "{} can't be opened here. Ask an admin.",
}
try:
    KEY_CHECK = ('<p id="key-check">Compare with the group\'s pinned code '
                 "before submitting.</p>")
    SEALED = ('<p class="muted small" id="history-sealed">'
              '<strong id="history-sealed-count"></strong> '
              "can't be opened here. Ask an admin.</p>")

    check("an element the page fills at runtime is read as a slot",
          check_web.ruled_line_problems(KEY_CHECK + SEALED, SLOT_PAGE)
          == [])
    check("and a slot standing empty of its sentence still fails",
          len(check_web.ruled_line_problems(
              KEY_CHECK + '<p id="history-sealed"><strong '
              'id="history-sealed-count"></strong> were sealed on another '
              "device.</p>", SLOT_PAGE)) == 1)
    check("one ruled line missing does not excuse the page's others",
          len(check_web.ruled_line_problems(SEALED, SLOT_PAGE)) == 1)
finally:
    # A dict this suite injected is a dict this suite removes - left in
    # place it would be a fake page every later arm in this run has to
    # treat as real, including the door-count arms further down.
    del check_web.RULED_LINES[SLOT_PAGE]

MORE = ('<details class="more"><summary>More</summary><p>why</p></details>')

check("the ruled disclosure passes on a product page",
      check_web.more_disclosure_problems(MORE, "your-page.html") == [])
check("a product page with no disclosure fails",
      len(check_web.more_disclosure_problems("<p>prose</p>", "your-page.html"))
      == 1)
check("a page outside MORE_PAGES is not asked for one",
      check_web.more_disclosure_problems("<p>prose</p>", "404.html") == [])
check("a disclosure shipped open is prose with a control around it",
      any("open" in p for p in check_web.more_disclosure_problems(
          MORE.replace("<details ", "<details open "), "your-page.html")))
check("a disclosure that is not the one shape fails",
      any(check_web.MORE_CLASS in p
          for p in check_web.more_disclosure_problems(
              MORE.replace('class="more"', 'class="panel"'),
              "your-page.html")))
check("a disclosure called something else fails",
      any("Details" in p for p in check_web.more_disclosure_problems(
          MORE.replace("<summary>More", "<summary>Details"),
          "your-page.html")))
check("a disclosure with no summary at all fails",
      any("<summary>" in p for p in check_web.more_disclosure_problems(
          '<details class="more"><p>why</p></details>', "your-page.html")))

# THE STYLESHEET, which the three markup arms above cannot see - and
# this slice put `.more` rules in it. Two declarations undo the ruling's
# central mechanic across every card with `open` still absent and the
# marker still reading "More", confirmed by mutation in a browser on the
# built dist.
MORE_CSS = (".more > summary { font-size: 12px; color: grey; "
            "cursor: pointer; }\n"
            ".more > :not(summary) { margin-block-start: 4px; }\n")

check("the shipped .more rules raise nothing",
      check_web.more_style_problems(MORE_CSS) == [])
check("the two-line reveal is refused",
      any("content-visibility" in p for p in check_web.more_style_problems(
          MORE_CSS + "details.more::details-content { "
                     "content-visibility: visible; block-size: auto; }\n")))
# An ALLOWLIST rather than a list of dangerous properties, because a
# blocklist is a guess about which lever the next person reaches for.
check("a property outside the allowlist is refused whatever it does",
      any("block-size" in p for p in check_web.more_style_problems(
          MORE_CSS + ".more > :not(summary) { block-size: auto; }\n")))
# The TYPE selector as well as the class: `details > :not(summary)`
# reaches every card on this site without ever saying "more".
check("a rule reaching the disclosure by its element is read too",
      any("details" in p for p in check_web.more_style_problems(
          MORE_CSS + "details > :not(summary) { display: block; }\n")))
# And the two properties refused whatever carries them, which is the
# reach the allowlist has not got: a rule naming neither the class nor
# the element still cannot turn a closed disclosure on.
check("the reveal properties are refused under any selector at all",
      any("content-visibility" in p for p in check_web.more_style_problems(
          MORE_CSS + ".why-prose { content-visibility: visible; }\n")))
check("and the pseudo-element is refused the same way",
      any("::details-content" in p for p in check_web.more_style_problems(
          MORE_CSS + "::details-content { color: red; }\n")))
check("the shipped stylesheet passes both",
      check_web.more_style_problems(check_web.stylesheet_text()) == [])

# THE REGION, not only the element. Check 27 pins each ruled line as the
# whole of what its own element renders, which closes the substring hole
# and leaves the sibling hole open - the pinned paragraph untouched and
# the sentence the ruling vetoed added as the next one in the same
# <header>, both on screen, whole gate green. AGENTS.md's corollary
# exactly.
HEADER_OK = ('<header class="stack-tight"><p class="runner">'
             "<span>Members</span></p><h1>Charts</h1>"
             '<p class="muted" id="charts-intro">Counts and averages — no '
             "names, no individual entries.</p></header>")

check("a masthead that matches its pin raises nothing",
      check_web.page_header_problems(HEADER_OK, "charts.html") == [])
check("a sentence added beside the ruled line is refused",
      any("REGION is pinned" in p for p in check_web.page_header_problems(
          HEADER_OK.replace(
              "</header>",
              '<p class="muted">Getting heavier? Muse certainly hopes so.'
              "</p></header>"), "charts.html")))
check("a page with no pinned masthead is refused",
      any("no PAGE_HEADERS entry" in p
          for p in check_web.page_header_problems(HEADER_OK, "new.html")))
check("a second masthead is a region nothing compares",
      any("2 <header> elements" in p for p in check_web.page_header_problems(
          HEADER_OK * 2, "charts.html")))
check("every shipped page's masthead is pinned",
      set(check_web.PAGE_HEADERS) == set(check_web.html_pages()))

# The refusal list, which is the reach the region pin has not got: the
# vetoed sign-out inventory coming back beside #signed-out in <main> is
# the same defect one element further down the page. It catches the
# sentences the ruling NAMES; the region pin is what catches one nobody
# wrote down. Neither is claimed to be the other.
check("a page rendering none of the vetoed sentences raises nothing",
      check_web.vetoed_line_problems("<p>Signed out.</p>") == [])
check("a vetoed sentence coming back anywhere on the page is refused",
      any("removed" in p for p in check_web.vetoed_line_problems(
          '<p id="signed-out">Signed out.</p><p class="muted">This browser '
          "now holds nothing of yours.</p>")))
check("a vetoed sentence quoted in a comment is not on the page",
      check_web.vetoed_line_problems(
          "<!-- was: Getting heavier? Muse certainly hopes so. -->"
          "<p>Counts and averages.</p>") == [])

check("the pages themselves meet the bar's two readable rules",
      check_web.register_problems() == [])

# tab_bar_contents_problems() (0.9-M3-S33 fix wave 1, #457 review F1) -
# check 28's own presence and parity arms both held before this fix
# wave, and both still pass a bar emptied of every item, since neither
# one reads INSIDE the <nav>. This is the arm that does, tested on
# strings the same way rail_page_problems() is tested above rather
# than on the five files it happens to guard today.
TAB_BAR = (
    '<nav class="tab-bar" aria-label="Site">'
    '<a class="tab-bar-item" id="tab-bar-yourpage" href="your-page.html">'
    '<span>Your page</span></a>'
    '<a class="tab-bar-item" id="tab-bar-charts" href="charts.html">'
    '<span>Charts</span></a>'
    '<button class="tab-bar-item" id="tab-bar-signout" hidden>'
    '<span>Sign out</span></button>'
    '<a class="tab-bar-item" id="tab-bar-admin" href="admin.html" hidden>'
    '<span>Admin</span></a>'
    '</nav>'
)

check("one item's own tag is read out of a .tab-bar fragment by id",
      check_web.tab_bar_item_fragment(TAB_BAR, "tab-bar-charts") is not None
      and "Charts" in
      check_web.tab_bar_item_fragment(TAB_BAR, "tab-bar-charts"))
check("an id no item carries reads as absence",
      check_web.tab_bar_item_fragment(TAB_BAR, "tab-bar-nothing") is None)

check("a complete .tab-bar raises nothing",
      check_web.tab_bar_contents_problems(TAB_BAR) == [])

# THE F1 CASE ITSELF: every item removed, the <nav> left standing -
# exactly the state check 28's presence arm (a bare tab_bar_fragment()
# search) and its parity arm (comparing empty copies to each other)
# both call fine.
EMPTY_TAB_BAR = '<nav class="tab-bar" aria-label="Site"></nav>'
check("an empty .tab-bar - every item gone, the wrapper left standing - "
      "is refused, one problem per missing id",
      len(check_web.tab_bar_contents_problems(EMPTY_TAB_BAR)) == 4 and
      all('carries no id="tab-bar-' in p
          for p in check_web.tab_bar_contents_problems(EMPTY_TAB_BAR)))

check("an item present by id but pointed at the wrong page is refused",
      any('does not link to charts.html' in p
          for p in check_web.tab_bar_contents_problems(
              TAB_BAR.replace('href="charts.html"', 'href="your-page.html"',
                              1))))
check("an item present by id but carrying the wrong label is refused",
      any('not labeled "Charts"' in p
          for p in check_web.tab_bar_contents_problems(
              TAB_BAR.replace("<span>Charts</span>",
                               "<span>Chart</span>"))))


if failures:
    print("\ncheck_web.py FAILED %d of %d checks" % (failures, performed))
    sys.exit(1)
if performed != EXPECTED:
    print("\ncheck_web.py ran %d checks, expected %d - a check stopped "
          "running, or one was added without updating EXPECTED"
          % (performed, EXPECTED))
    sys.exit(1)
print("\ncheck_web.py OK - %d checks" % performed)
