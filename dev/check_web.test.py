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
this repository refuses third-party code it does not need, and a test
runner is not needed to compare values.
"""

import os
import sys

# tools/ is not a package and check_web.py is a script, so the import has
# to be made reachable before it can be named. isort would hoist the
# import above the path insertion and break it, hence the explicit skip.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))

import check_web  # noqa: I001


failures = 0


def check(label, condition):
    global failures
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

# And the pin has to match what actually ships, or it is a table
# describing a site that does not exist.
check("no page's shipped policy differs from its pin",
      check_web.csp_policy_problems() == [])


if failures:
    print("\ncheck_web.py FAILED %d of 17 checks" % failures)
    sys.exit(1)
print("\ncheck_web.py OK - 17 checks")
