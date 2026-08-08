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
EXPECTED = 48


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
          for page in ("submit.html", "dashboard.html", "admin.html")))

# And the pin has to match what actually ships.
check("no page's shipped shell differs from its pin",
      check_web.shell_problems() == [])

# The rules, exercised on strings rather than on the five files, so they
# are tested for the shape of the failure and not for today's markup.
RAIL = (
    '<aside class="rail"><ul class="rail-links">'
    '<li><a href="index.html">Sign in</a></li>'
    '<li><a href="submit.html">Submit</a></li>'
    '</ul></aside>'
    '<button id="theme-toggle"></button><div id="theme-chips"></div>'
)

check("a rail is read out of a page as its destinations, in order",
      [href for href, _ in check_web.rail_links(RAIL)] ==
      ["index.html", "submit.html"])
check("a page with no rail reads as absence rather than as empty",
      check_web.rail_links("<p>nothing here</p>") is None)

# The rail rules, both directions on each.
check("a complete rail raises nothing",
      check_web.rail_page_problems(RAIL) == [])
check("a rail page with no rail at all is reported",
      check_web.rail_page_problems("<p>nothing</p>") == ["has no rail"])

# The anti-stranding arm, which survives into both shells rather than
# into neither. A rail without the route to sign-in is the one a member
# whose session expired cannot use.
check("a rail naming no index.html is refused",
      any("stranded" in p for p in check_web.rail_page_problems(
          RAIL.replace('href="index.html"', 'href="dashboard.html"'))))

# The disclosure ids, one at a time, so a message names the missing one.
check("a rail missing the disclosure button is refused",
      any("theme-toggle" in p for p in check_web.rail_page_problems(
          RAIL.replace('id="theme-toggle"', 'id="something-else"'))))
check("a rail missing the chips it controls is refused",
      any("theme-chips" in p for p in check_web.rail_page_problems(
          RAIL.replace('id="theme-chips"', 'id="something-else"'))))

# The hamburger is gone, and a page that kept it is a page that did not
# get the rail - which the parity arm alone would not catch, because two
# pages can carry the same stale markup.
check("a page still carrying the retired hamburger ids is refused",
      any("nav-toggle" in p for p in check_web.rail_page_problems(
          RAIL + '<button id="nav-toggle"></button>')))

# The plain rules, both directions.
PLAIN = '<main><a href="index.html">Sign in</a></main>'
check("a plain page with a way off it raises nothing",
      check_web.plain_page_problems(PLAIN) == [])
check("a plain page carrying a rail is refused",
      any("session home" in p
          for p in check_web.plain_page_problems(PLAIN + RAIL)))

# The arm that stops "plain" from becoming "a dead end with nice
# typography". A fragment and an off-site link both leave a visitor
# where they started, so neither counts.
check("a plain page with no way off it is refused",
      any("no way off it" in p
          for p in check_web.plain_page_problems("<main>Sorry.</main>")))
check("a fragment is not a way off a page",
      any("no way off it" in p for p in check_web.plain_page_problems(
          '<a href="#top">back to top</a>')))
check("an off-site link is not a way through the site",
      any("no way off it" in p for p in check_web.plain_page_problems(
          '<a href="https://example.com">away</a>')))


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


if failures:
    print("\ncheck_web.py FAILED %d of %d checks" % (failures, performed))
    sys.exit(1)
if performed != EXPECTED:
    print("\ncheck_web.py ran %d checks, expected %d - a check stopped "
          "running, or one was added without updating EXPECTED"
          % (performed, EXPECTED))
    sys.exit(1)
print("\ncheck_web.py OK - %d checks" % performed)
