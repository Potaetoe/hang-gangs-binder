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
EXPECTED = 106


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
# Check 15 - the label roles.                                         #

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
# label an act that has to declare its job.
check("a label carrying a declared role raises nothing",
      check_web.page_label_problems('<p class="flag">Received</p>') == [])
check("a label nobody has given a job is refused",
      any("names no job" in p for p in check_web.page_label_problems(
          '<p class="runner">Very nearly done</p>')))
check("a label doing a different job from the one declared is refused",
      any("says it is" in p for p in check_web.page_label_problems(
          '<p class="runner">Received</p>')))

# The overload itself, in the form #68 found it: an outcome wearing the
# section-name component, which is what made `Received` look like
# `Optional`.
check("an outcome dressed as a section name names both roles",
      any('"Received" as "runner"' in p and '"flag"' in p
          for p in check_web.page_label_problems(
              '<p class="runner">Received</p>')))

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

# And the pins have to match what actually ships.
check("no shipped label's role differs from the inventory",
      check_web.label_problems() == [])
check("the stylesheet tells the three roles apart",
      check_web.label_style_problems() == [])


# ------------------------------------------------------------------ #
# Check 16 - one name per destination.                                #

check("every published page is named once",
      set(check_web.DESTINATIONS) == set(check_web.html_pages()))
check("no two destinations answer to the same name",
      len(set(check_web.DESTINATIONS.values())) ==
      len(check_web.DESTINATIONS))

NAMED = ('<title>Progress — HangGang</title><h1>Progress</h1>'
         '<ul class="rail-links">'
         '<li><a href="index.html">Sign in</a></li>'
         '<li><a href="dashboard.html">Progress</a></li></ul>')

check("a page whose surfaces agree raises nothing",
      check_web.page_name_problems(NAMED, "Progress") == [])
check("a heading disagreeing with the page's name is refused",
      any("its heading says" in p for p in check_web.page_name_problems(
          NAMED.replace("<h1>Progress</h1>", "<h1>Dashboard</h1>"),
          "Progress")))
check("a title disagreeing with the page's name is refused",
      any("bookmark" in p for p in check_web.page_name_problems(
          NAMED.replace("<title>Progress", "<title>Dashboard"), "Progress")))
check("a page with no heading at all is refused",
      any("what page it is" in p for p in check_web.page_name_problems(
          NAMED.replace("<h1>Progress</h1>", ""), "Progress")))

# The half rail parity cannot reach. Three rails can agree with each
# other and disagree with the page they open, which is exactly the drift
# #127 inventoried - the admin page called Export by every rail on the
# site at once.
check("a rail calling another page by a name it does not answer to "
      "is refused",
      any('calling index.html "Home"' in p
          for p in check_web.page_name_problems(
              NAMED.replace(">Sign in<", ">Home<"), "Progress")))
check("no shipped page disagrees with its own name",
      check_web.name_problems() == [])


# ------------------------------------------------------------------ #
# Check 17 - the member pages and the admin instrument.               #

check("every published page names a surface",
      set(check_web.SURFACES) == set(check_web.html_pages()))
check("exactly one page is the admin instrument",
      [page for page, surface in check_web.SURFACES.items()
       if surface == "instrument"] == ["admin.html"])

INSTRUMENT = ('<body class="wide railed instrument">'
              '<p class="surface-mark">Admin surface</p>')
MEMBER = '<body class="railed"><h1>Progress</h1>'

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
check("no shipped page wears the wrong surface",
      check_web.surface_problems() == [])


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
      len(frozen_in_place) == 9 and all(frozen_in_place))
check("apps/web raises no export problem",
      check_web.module_export_problems() == [])


if failures:
    print("\ncheck_web.py FAILED %d of %d checks" % (failures, performed))
    sys.exit(1)
if performed != EXPECTED:
    print("\ncheck_web.py ran %d checks, expected %d - a check stopped "
          "running, or one was added without updating EXPECTED"
          % (performed, EXPECTED))
    sys.exit(1)
print("\ncheck_web.py OK - %d checks" % performed)
