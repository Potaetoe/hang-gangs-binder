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
EXPECTED = 239


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
# Check 19 - the Theme control, present where it is pinned and absent  #
# everywhere else.                                                    #

# The pin first, because every rule below describes whichever pages it
# names. The sign-in page is in it and the error page is not, and that
# pair is the whole ruling on #150: one control at every width, offered
# signed out, and never on the page somebody reaches by accident.
check("the sign-in page is pinned to offer a palette",
      "index.html" in check_web.THEMED_PAGES)
check("the error page is pinned to offer none",
      "404.html" not in check_web.THEMED_PAGES)
check("the three signed-in pages are pinned to offer a palette",
      all(page in check_web.THEMED_PAGES
          for page in ("submit.html", "dashboard.html", "admin.html")))

# And the pin has to match what actually ships.
check("no shipped page's Theme control differs from its pin",
      check_web.theme_control_page_problems() == [])

# The rules on strings, both directions on each. THEMED is the whole
# control: the button, the group it names, and one chip inside it.
THEMED = (
    '<div class="theme-picker">'
    '<button id="theme-toggle" aria-controls="theme-chips">Theme</button>'
    '<div id="theme-chips"><button data-set-theme="midnight">M</button>'
    '</div></div>'
)

check("a complete Theme control on a page pinned to offer one "
      "raises nothing",
      check_web.theme_control_problems(THEMED, True) == [])
check("a page pinned to offer none, carrying none, raises nothing",
      check_web.theme_control_problems('<main>Sorry.</main>', False) == [])

# The ids one at a time, so a message names the missing one.
check("a page that offers a palette and lost the button is refused",
      any("theme-toggle" in p for p in check_web.theme_control_problems(
          THEMED.replace('id="theme-toggle"', 'id="something-else"'), True)))
check("a page that offers a palette and lost the chip group is refused",
      any("theme-chips" in p for p in check_web.theme_control_problems(
          THEMED.replace('id="theme-chips"', 'id="something-else"'), True)))

# A disclosure opening an empty group is a control that reaches no
# palette, and both ids survive that.
check("a disclosure with no chip behind it is refused",
      any("data-set-theme" in p for p in check_web.theme_control_problems(
          THEMED.replace('data-set-theme', 'data-something'), True)))

# The absent direction, which is what stops a chip landing on the error
# page the way every other copy-paste failure here lands.
check("a page pinned to offer no palette, carrying the button, "
      "is refused",
      any("theme-toggle" in p for p in check_web.theme_control_problems(
          '<button id="theme-toggle"></button>', False)))
check("a page pinned to offer no palette, carrying the chip group, "
      "is refused",
      any("theme-chips" in p for p in check_web.theme_control_problems(
          '<div id="theme-chips"></div>', False)))
check("a page pinned to offer no palette, carrying a chip, is refused",
      any("stored preference" in p
          for p in check_web.theme_control_problems(
              '<button data-set-theme="pink">P</button>', False)))

# The stale-pin arm. A roster entry with no page behind it is a check
# that cannot fail, which is the failure #114 paid for - so it is
# exercised here rather than assumed, by pinning a page that does not
# ship and putting the real set back immediately.
SHIPPING = check_web.THEMED_PAGES
check_web.THEMED_PAGES = SHIPPING | {"nowhere.html"}
check("a themed-page pin with no page behind it is refused",
      any(page == "nowhere.html"
          for page, _problem in check_web.theme_control_page_problems()))
check_web.THEMED_PAGES = SHIPPING
check("the real pin is back after the stale-pin arm",
      check_web.theme_control_page_problems() == [])


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
      len(frozen_in_place) == 11 and all(frozen_in_place))
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

# The spelling the browser resolves identically and a membership test
# does not. `if href in DESTINATIONS` read "./admin.html" as something
# other than a destination and skipped it in silence, which put #127's
# own motivating example - the admin page called Export - back on all
# three rails with the gate green. A rule that skips what it cannot
# recognize fails open, so unknown hrefs are reported rather than passed.
check("a rail href is read through its spelling",
      check_web.rail_target("./dashboard.html") == "dashboard.html")
check("a rail href's fragment is not part of the page it names",
      check_web.rail_target("dashboard.html#top") == "dashboard.html")
check("a rail href's query is not part of the page it names",
      check_web.rail_target("dashboard.html?from=rail") == "dashboard.html")
check("an off-site rail href names no destination here",
      check_web.rail_target("https://example.com/admin.html") is None)
check("a bare directory href is the index",
      check_web.rail_target("") == "index.html")
check("a dot-slash rail calling a page by a name it does not answer to "
      "is refused",
      any('calling ./index.html "Home"' in p
          for p in check_web.page_name_problems(
              NAMED.replace('href="index.html">Sign in',
                            'href="./index.html">Home'), "Progress")))
check("a rail entry naming no destination at all is refused",
      any("names no destination" in p for p in check_web.page_name_problems(
          NAMED.replace('href="dashboard.html"', 'href="reports.html"'),
          "Progress")))

check("no shipped page disagrees with its own name",
      check_web.name_problems() == [])


# ------------------------------------------------------------------ #
# Check 18 - the member pages and the admin instrument.               #

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
# Check 21: the chart series slot count, in its three places.         #
#                                                                     #
# Every fixture below writes .series-N as a literal, and the shipped  #
# tree never does - which is the whole reason this check exists. A    #
# search for "series-0" across this repository finds these strings    #
# and nothing in apps/web, while twelve live selectors and six        #
# palettes' worth of values depend on that number.                    #

PRODUCER = 'const cls = "chart-series series-" + (index % 6);'


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


check("the cycle length is read out of the built class name",
      check_web.series_cycle_length(PRODUCER) == 6)
check("spacing in the modulo does not hide the cycle length",
      check_web.series_cycle_length('"series-"+(i%4)') == 4)
check("a script that composes no series class has no cycle length",
      check_web.series_cycle_length("const cls = seriesClass(index);")
      is None)

check("a stylesheet and a script that agree raise nothing",
      check_web.css_series_problems(slots(6), PRODUCER) == [])

# The direction a dead-CSS pass produces: a slot deleted as unused.
check("a slot the stylesheet does not define is refused",
      any(".series-5" in p for p in check_web.css_series_problems(
          slots(5), PRODUCER)))
check("a slot past the cycle renders never and is refused",
      any("render never" in p for p in check_web.css_series_problems(
          slots(7), PRODUCER)))

check("a slot with a stroke and no fill is refused",
      any("fills" in p for p in check_web.css_series_problems(
          slots(6).replace("circle.series-5, text.series-5 "
                           "{ fill: var(--color-series-5); }", ""),
          PRODUCER)))

check("a palette short of a slot is refused",
      any("copied from the one open" in p
          for p in check_web.css_series_problems(
              slots(6) + ':root[data-theme="q"] '
              "{ --color-series-0: red; }", PRODUCER)))
check("a stylesheet setting no series value at all is refused",
      any("sets no --color-series-N" in p
          for p in check_web.css_series_problems(
              ".series-0 { stroke: red; }"
              "circle.series-0, text.series-0 { fill: red; }",
              '"series-" + (i % 1)')))

# A rule that cannot find its subject must say so. This is the arm that
# stops the whole check from going quiet the day the chart changes shape.
check("a producer this check cannot read is reported, not skipped",
      any("composes no series class" in p
          for p in check_web.css_series_problems(slots(6), "// nothing")))
check("a zero-length cycle is refused rather than divided by",
      any("divide by zero" in p for p in check_web.css_series_problems(
          slots(6), '"series-" + (i % 0)')))

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
              ("daylight", "Parchment Daylight"), ("contrast", "Contrast")]

CHIP_GROUP = "".join(chip_markup(n, w) for n, w in FOUR_CHIPS)

# The rename that reaches one page and not the others.
DRIFTED_CHIPS = [(n, "Daylight" if n == "daylight" else w)
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
check("a chip with no visible words is refused",
      any("no visible words" in p for p in check_web.chip_roster_problems(
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
    {"admin.html": FOUR_CHIPS, "dashboard.html": FOUR_CHIPS,
     "submit.html": DRIFTED_CHIPS})
check("a label renamed on ONE page is refused",
      len(DRIFT_FOUND) == 1)
check("the refusal names the page that drifted",
      bool(DRIFT_FOUND) and DRIFT_FOUND[0][0] == "submit.html")
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
      SHIPPED_CHIPS["submit.html"] != [])


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
    "submit.html": "".join(chip_markup(n, w) for n, w in DRIFTED_CHIPS),
})
check("the wrapper reads the pages rather than answering from nowhere",
      len(DISK_FOUND) == 1 and DISK_FOUND[0][0] == "submit.html")
check("and it is the shipped directory it normally reads",
      check_web.WEB.endswith(os.path.join("apps", "web")))

# Not decorative: submit.html's note on the #127 ruling names this
# attribute at length, so a reader taking raw markup would compare a
# page against prose about itself.
check("a chip written out inside a comment is not part of a roster",
      chips_over({
          "admin.html": CHIP_GROUP,
          "submit.html": CHIP_GROUP + "<!-- %s -->" % chip_markup(
              "ghost", "Ghost"),
      }) == [])

# A themed page carrying no chip at all is check 19's, and it fails
# there in this same run from this same roster. Restating it here is
# what that check's docstring declines to do, in the other direction.
check("a themed page with no chips is left to check 19, not restated",
      chips_over({
          "admin.html": CHIP_GROUP,
          "submit.html": CHIP_GROUP,
          "dashboard.html": "<p>Nothing here.</p>",
      }) == [])


if failures:
    print("\ncheck_web.py FAILED %d of %d checks" % (failures, performed))
    sys.exit(1)
if performed != EXPECTED:
    print("\ncheck_web.py ran %d checks, expected %d - a check stopped "
          "running, or one was added without updating EXPECTED"
          % (performed, EXPECTED))
    sys.exit(1)
print("\ncheck_web.py OK - %d checks" % performed)
