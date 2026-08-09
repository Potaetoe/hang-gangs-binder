"""Contract checks for the palette contrast gate.

`tools/check_contrast.py` parses `apps/web/theme.css`, resolves every
palette to concrete colors, and computes the WCAG ratio for a pinned
list of pairings. Issue #81 measured nineteen failing pairings by hand;
the job here is that the nineteenth cannot come back, and that a fifth
palette cannot ship without being measured.

Two halves, for the reason #34 paid for. The parser is tested on
strings rather than on the stylesheet it happens to read, because a
mutation exercises a *rule* and never the parser that has to find
something before any rule can apply - and a parser that finds no
palettes computes zero pairings and reports a perfectly accessible
site. Then the real tree is tested, including the decisive arm: real
palettes come back out of the real stylesheet.

The arms are exercised as pure functions over synthetic palettes, so
both directions are covered without editing a file that is copied
verbatim to the published site. A pairing naming a token nothing
defines fails as a stale list; a `--color-*` token that appears in no
pairing and no exemption fails as an unguarded color. Coverage in one
direction only would let a token be added and never measured, which is
how the six chart-series colors went three palettes without anybody
noticing they were tuned for one of them.

The EXEMPT set is pinned here as well as in the checker. It is the one
place a failing pairing can be made to disappear by editing a single
line, so the list that may hold it lives outside the file that reads
it - AGENTS.md, "The review bar".

No framework, matching the suites beside it.
"""

import os
import sys

# tools/ is not a package and check_contrast.py is a script, so the
# import has to be made reachable before it can be named. isort would
# hoist the import above the path insertion and break it, hence the
# explicit skip - the same shape as dev/check_budget.test.py.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))

import check_contrast  # noqa: I001


failures = 0
performed = 0

# Asserted at the end rather than only printed. A hand-written total
# that nothing compares against still prints a confident "OK" when a
# check stops running - an early return, a renamed helper - which is
# the armed-looking-but-not failure this repository holds to be worse
# than having no check at all.
EXPECTED = 72


def check(label, condition):
    global failures, performed
    performed += 1
    if not condition:
        failures += 1
    print("pass " if condition else "FAIL ", label)


# ------------------------------------------------------------------ #
# The arithmetic. WCAG 2.x relative luminance, against values that can #
# be looked up rather than recomputed from this same code.            #

check("white on black is 21:1",
      round(check_contrast.ratio("#ffffff", "#000000"), 4) == 21.0)

check("a color against itself is 1:1",
      check_contrast.ratio("#3b82f6", "#3b82f6") == 1.0)

# The canonical AA boundary gray: #767676 is the darkest gray that
# still clears 4.5:1 on white, and it is the value every contrast tool
# agrees on to two decimals.
check("the canonical AA gray on white is 4.54",
      round(check_contrast.ratio("#767676", "#ffffff"), 2) == 4.54)

check("the ratio does not depend on which color is named first",
      check_contrast.ratio("#767676", "#ffffff")
      == check_contrast.ratio("#ffffff", "#767676"))

# The pairing issue #81 measured at 4.53 and called luck rather than
# margin. If this number moves, the checker's arithmetic moved.
check("Dark's blue on its card surface is the 4.53 #81 measured",
      round(check_contrast.ratio("#3b82f6", "#1e1e1e"), 2) == 4.53)

check("shorthand hex is read as the color it names",
      check_contrast.ratio("#fff", "#000")
      == check_contrast.ratio("#ffffff", "#000000"))

check("luminance is 0 for black and 1 for white",
      check_contrast.luminance("#000000") == 0.0
      and check_contrast.luminance("#ffffff") == 1.0)


# ------------------------------------------------------------------ #
# Hex parsing. A value that is not a color must be refused rather than #
# guessed at - a checker that reads an unparseable value as black      #
# reports enormous contrast for a palette it never understood.         #

check("a six-digit hex parses", check_contrast.parse_hex("#1e1e1e")
      == (30, 30, 30))

check("a three-digit hex expands",
      check_contrast.parse_hex("#abc") == (170, 187, 204))

check("case does not matter",
      check_contrast.parse_hex("#F08090")
      == check_contrast.parse_hex("#f08090"))

check("a color function is not a hex",
      check_contrast.parse_hex("color-mix(in oklab, red 12%, transparent)")
      is None)

check("a named color is not a hex",
      check_contrast.parse_hex("rebeccapurple") is None)

check("a four-digit hex is refused rather than half-read",
      check_contrast.parse_hex("#abcd") is None)


# ------------------------------------------------------------------ #
# The parser, on strings.                                             #

SIMPLE = """
:root,
:root[data-theme="dark"] {
  color-scheme: dark;
  --color-bg: #121212;
  --color-surface: #1e1e1e;
}

:root[data-theme="pink"] {
  --color-bg: #241b21;
}
"""

def first(found):
    """The first rule parsed, or an empty stand-in.

    Blinding the parser is the mutation that proves this whole file is
    worth running, and a blinded parser returns nothing. Indexing
    straight into that would end the suite with a traceback instead of
    reporting which arm noticed - and a traceback names the line that
    tripped rather than the rule that broke.
    """
    return found[0] if found else (None, "", {})


RULES = check_contrast.rules(SIMPLE)

check("a palette block is found",
      any(selector == ':root,:root[data-theme="dark"]'
          for _media, selector, _decls in RULES))

check("and its custom properties come back with it",
      any(decls.get("--color-bg") == "#121212"
          for _media, _selector, decls in RULES))

check("a second block is not folded into the first",
      len([1 for _m, _s, decls in RULES if "--color-bg" in decls]) == 2)

check("a declaration that is not a custom property is ignored",
      all("color-scheme" not in decls for _m, _s, decls in RULES))

# A comment is not a declaration. A stylesheet under construction keeps
# the shape it is heading for in one, and a parser that reads it would
# measure a palette nobody ships.
check("a commented-out declaration is not read",
      first(check_contrast.rules(
          ':root { /* --color-bg: #ffffff; */ '
          '--color-bg: #000000; }'))[2].get("--color-bg") == "#000000")

MEDIA = """
@media (prefers-color-scheme: light) {
  :root:not([data-theme]) {
    --color-bg: #f2efe9;
  }
}
"""

MEDIA_RULES = check_contrast.rules(MEDIA)
MEDIA_RULE = first(MEDIA_RULES)

check("a media-scoped block is found",
      len(MEDIA_RULES) == 1)

# The decisive half of the parser. Two palettes live inside media
# blocks and their selectors are identical to each other; without the
# condition there is no way to tell the light one from the
# high-contrast one, and a checker that dropped the condition would
# measure one palette twice and the other never.
check("and it is attributed to its media condition",
      MEDIA_RULE[0] == "(prefers-color-scheme: light)")

check("and the selector inside the media block is kept",
      MEDIA_RULE[1] == ":root:not([data-theme])")

check("and the declaration inside it is read",
      MEDIA_RULE[2].get("--color-bg") == "#f2efe9")

check("a nested media block does not swallow the rule after it",
      len(check_contrast.rules(MEDIA + ':root { --color-bg: #000; }')) == 2)


# ------------------------------------------------------------------ #
# var() resolution, one level.                                        #

TOKENS = {
    "--color-accent": "#3b82f6",
    "--color-series-0": "var(--color-accent)",
    "--color-series-1": "#d95926",
    "--color-loop": "var(--color-loop)",
    "--color-deep": "var(--color-series-0)",
}

check("a plain value resolves to itself",
      check_contrast.resolve(TOKENS, "--color-series-1") == "#d95926")

check("a var() reference resolves one level",
      check_contrast.resolve(TOKENS, "--color-series-0") == "#3b82f6")

check("an absent token resolves to nothing",
      check_contrast.resolve(TOKENS, "--color-missing") is None)

# One level, stated rather than assumed. theme.css uses exactly one
# hop, and a resolver that chased arbitrarily far would need a cycle
# guard to avoid hanging the gate on a stylesheet typo.
check("a second hop is left unresolved rather than chased",
      check_contrast.parse_hex(
          check_contrast.resolve(TOKENS, "--color-deep")) is None)

check("a self-referential token does not hang the resolver",
      check_contrast.parse_hex(
          check_contrast.resolve(TOKENS, "--color-loop")) is None)


# ------------------------------------------------------------------ #
# The scope table, both directions.                                   #

REAL = open(check_contrast.CSS, encoding="utf-8").read()
PALETTES, UNKNOWN = check_contrast.scopes(REAL)


def tokens_of(palette):
    """One parsed palette's colors, or None when it was not found.

    None rather than a default map, and every caller has to say so:
    two palettes that are both absent would otherwise compare equal and
    the "these two blocks agree" checks would pass on a parse that read
    neither of them.
    """
    entry = PALETTES.get(palette)
    return entry[1] if entry else None

check("every palette scope in the real stylesheet is a pinned one",
      UNKNOWN == [])

# The decisive arm. If the parser simply found nothing, every string
# check above would still pass and the checker would compute no
# pairings at all - a null result wearing a positive result's clothes.
check("the real stylesheet yields the four palettes and the two "
      "system-preference scopes", len(PALETTES) == 6)

check("and each of them carries a full set of tokens",
      bool(PALETTES)
      and all(len(tokens) >= 19 for _level, tokens in PALETTES.values()))

check("Midnight is among them and is an AA palette",
      any(name.startswith("Midnight") and level == "AA"
          for name, (level, _t) in PALETTES.items()))

check("High contrast is among them and is held to AAA",
      any(name.startswith("High contrast") and level == "AAA"
          for name, (level, _t) in PALETTES.items()))

# A :root block that declares no background is the shared block of type
# and spacing tokens, not a palette. Reading it as one would compute
# every pairing against a background it does not define.
check("the shared token block is not mistaken for a palette",
      bool(PALETTES)
      and all("--color-bg" in tokens
              for _level, tokens in PALETTES.values()))

# A palette the pinned table does not know must fail rather than be
# measured against a guessed level. This is what stops a fifth palette
# shipping unchecked, and it is the arm that a table derived from the
# stylesheet could not have.
UNPINNED = check_contrast.scopes(
    REAL + '\n:root[data-theme="sepia"] { --color-bg: #f0e0c0; }')[1]
check("a palette the scope table does not name is reported",
      len(UNPINNED) == 1 and "sepia" in UNPINNED[0])

check("a pinned scope that matches nothing fails as stale",
      any("scope" in problem.lower()
          for problem in check_contrast.scope_problems({}, [])))


# ------------------------------------------------------------------ #
# The pairing arm, over synthetic palettes.                           #

def one(level, **overrides):
    """A palette holding every token the pinned pairings can name.

    White on black throughout, so every pairing measures 21:1 and any
    failure the arms report is the one the check under test put there.
    The accent is a background as well as a foreground - a label sits
    on it - so it takes white and its label takes black.
    """
    tokens = dict.fromkeys(
        {fg for fg, _bg, _kind in check_contrast.PAIRINGS}
        | {bg for _fg, bg, _kind in check_contrast.PAIRINGS}, "#ffffff")
    tokens.update({
        "--color-bg": "#000000",
        "--color-surface": "#000000",
        "--color-field": "#000000",
        "--color-warn-bg": "#000000",
        "--color-accent": "#ffffff",
        "--color-on-accent": "#000000",
    })
    tokens.update(overrides)
    return {"Test": (level, tokens)}


def only(level, foreground, background, kind="text"):
    """One pairing on its own, so a threshold can be aimed at exactly.

    The pinned list shares --color-bg across a dozen pairings, so
    moving it to test one of them moves the other eleven. A list of one
    is the only way to ask what a single threshold does.
    """
    return check_contrast.pairing_problems(
        {"Test": (level, {"--color-fg": foreground,
                          "--color-bg": background})},
        pairings=[("--color-fg", "--color-bg", kind)])


check("a palette of white on black passes every pairing",
      check_contrast.pairing_problems(one("AA")) == [])

check("and it passes at AAA too, since 21:1 clears seven",
      check_contrast.pairing_problems(one("AAA")) == [])

# Text on a background it barely clears must fail. #767676 on white is
# 4.54 - over the 4.5 threshold and inside the 0.1 margin this check
# demands, which is the whole point of the margin.
squeezed = only("AA", "#767676", "#ffffff")
check("a text pairing that clears 4.5 by less than the margin fails",
      len(squeezed) == 1)

check("and the failure names the palette, the pairing and both numbers",
      "Test" in squeezed[0] and "--color-fg" in squeezed[0]
      and "4.54" in squeezed[0] and "4.60" in squeezed[0])

check("a text pairing with the margin to spare passes",
      only("AA", "#595959", "#ffffff") == [])

# The AAA palette is the reason the level is a property of the scope
# rather than a constant. The same pairing that passes at AA fails at
# AAA, and a checker with one threshold would have called the
# high-contrast palette finished.
check("a pairing that passes at AA fails at AAA",
      only("AA", "#595959", "#ffffff") == []
      and only("AAA", "#595959", "#ffffff") != [])

# The non-text rule is looser than the text one, and a checker that
# applied one figure to both would either fail every focus ring or let
# body copy ship at 3:1.
check("a mark passes at 3:1 where the same pair fails as text",
      only("AA", "#888888", "#ffffff", kind="mark") == []
      and only("AA", "#888888", "#ffffff") != [])

check("and AAA holds a mark to four rather than three",
      only("AAA", "#888888", "#ffffff", kind="mark") != [])

# A missing token cannot be measured, and skipping it silently is how a
# palette ships one token short of the set every other palette holds.
#
# Whichever token the first pairing names, rather than a token spelled
# out here. Naming one couples this check to the contents of the pinned
# list: deleting that pairing - which is a mutation somebody will run -
# would take the token out of the synthetic palette too, and this line
# would die with a KeyError instead of reporting the coverage arm that
# actually caught it.
DROPPED = check_contrast.PAIRINGS[0][0]
short = one("AA")
del short["Test"][1][DROPPED]
check("a palette missing a token a pairing names fails",
      any(DROPPED in problem
          for problem in check_contrast.pairing_problems(short)))

bad = one("AA", **{"--color-text": "not-a-color"})
check("a token that is not a hex color fails loudly",
      any("--color-text" in problem and "hex" in problem.lower()
          for problem in check_contrast.pairing_problems(bad)))

check("a palette set with nothing in it fails as a null scan",
      check_contrast.pairing_problems({}) != [])


# ------------------------------------------------------------------ #
# Coverage, both directions.                                          #

DEFINED = check_contrast.defined_colors(REAL)

# The whole stylesheet, not the palette blocks alone.
# --color-accent-quiet is declared in the shared :root block beside the
# type and spacing tokens, so a coverage arm reading only palettes
# would leave a real color unaccounted for while reporting its
# exemption as dead.
check("the color scan reaches tokens outside the palette blocks",
      "--color-accent-quiet" in DEFINED)

check("the pinned pairings cover every color the stylesheet defines",
      check_contrast.coverage_problems(DEFINED) == [])

# Direction one: a pairing naming a token nothing defines is a stale
# list entry, and it reads as coverage while measuring nothing.
check("a pairing naming a token no palette defines fails",
      any("--color-ghost" in problem for problem in
          check_contrast.coverage_problems(
              DEFINED,
              pairings=[*check_contrast.PAIRINGS,
                        ("--color-ghost", "--color-bg", "text")])))

# Direction two, and the one that matters more: a color defined and
# never measured is an unguarded color. Six chart-series hexes sat in
# three palettes tuned for one of them, and no check said anything.
extra = DEFINED | {"--color-invented"}
check("a color token in no pairing and no exemption fails",
      any("--color-invented" in problem
          for problem in check_contrast.coverage_problems(extra)))

check("and the exempt set is what keeps that arm honest",
      any("--color-invented" in problem
          for problem in check_contrast.coverage_problems(extra))
      and check_contrast.coverage_problems(
          extra, exempt=frozenset({*check_contrast.EXEMPT,
                                   "--color-invented"})) == [])

# Pinned here as well as in the checker. Growing this set is the one
# edit that makes a failing pairing disappear without changing a color,
# so it is stated in two files and a reviewer sees both move.
check("the exemptions are exactly the two colors that cannot be measured",
      check_contrast.EXEMPT == frozenset({"--color-accent-quiet",
                                          "--color-border"}))

check("an exemption naming a token nothing defines fails as stale",
      any("--color-gone" in problem for problem in
          check_contrast.coverage_problems(
              DEFINED,
              exempt=frozenset({*check_contrast.EXEMPT,
                                "--color-gone"}))))


# ------------------------------------------------------------------ #
# The pinned list itself.                                             #

check("every palette is measured for text against both backgrounds",
      {("--color-text", "--color-bg"),
       ("--color-text", "--color-surface"),
       ("--color-text-muted", "--color-bg"),
       ("--color-text-muted", "--color-surface")}
      <= {(fg, bg) for fg, bg, _kind in check_contrast.PAIRINGS})

check("the label on an accent fill is measured against the fill",
      ("--color-on-accent", "--color-accent", "text")
      in check_contrast.PAIRINGS)

# A hovered button is still a button. --color-accent-strong stopped
# being link text when Midnight showed that one token cannot be both a
# hover fill under a cream label and legible text on the page; these two
# are what replaced that single text pairing, and the second of them is
# coverage no palette had before.
check("the hover fill is measured as a shape against the page",
      ("--color-accent-strong", "--color-bg", "mark")
      in check_contrast.PAIRINGS)

check("and the label on the hover fill is measured against it",
      ("--color-on-accent", "--color-accent-strong", "text")
      in check_contrast.PAIRINGS)

# The direction that would undo the argument. Holding a fill to the text
# threshold is what forced the old conflict, and putting it back would
# quietly re-forbid a crimson button with a cream label.
check("and the hover fill is not held to the text rule it left behind",
      ("--color-accent-strong", "--color-bg", "text")
      not in check_contrast.PAIRINGS)

check("the component boundary is measured against both surfaces it "
      "sits on",
      {("--color-border-strong", "--color-surface"),
       ("--color-border-strong", "--color-field")}
      <= {(fg, bg) for fg, bg, _kind in check_contrast.PAIRINGS})

check("all six chart series are measured against both backgrounds",
      all(("--color-series-%d" % n, bg, "mark") in check_contrast.PAIRINGS
          for n in range(6)
          for bg in ("--color-bg", "--color-surface")))

check("the focus ring is measured, since a ring nobody can see is not "
      "a focus indicator",
      ("--color-focus", "--color-bg", "mark") in check_contrast.PAIRINGS)

# The gold role, on BOTH surfaces, and the second one is why this is
# pinned here rather than left to the coverage arm next door.
#
# Coverage fails a token that appears in no pairing at all - so with the
# page pairing present, deleting the card pairing measures one fewer
# thing and passes. That was found by mutation, not by reading. The card
# is the tighter of the two on every dark palette, since --color-surface
# is lighter than --color-bg there, and .runner is used inside cards, so
# the pairing that would go quiet is the one the shipped component
# actually depends on.
check("the gold role is measured on the page and inside a card",
      all(("--color-gold", background, "text") in check_contrast.PAIRINGS
          for background in ("--color-bg", "--color-surface")))

# Held as text rather than as a mark. WCAG allows 3:1 for large text and
# a runner is set small, so the looser rule would be the wrong one to
# have reached for.
check("and held to the text rule, which is the stricter one here",
      all(kind == "text" for fg, _bg, kind in check_contrast.PAIRINGS
          if fg == "--color-gold"))

check("the margin is a tenth of a point, not zero",
      check_contrast.MARGIN == 0.1)

check("AAA text is seven and AAA non-text is four",
      check_contrast.THRESHOLDS["AAA"] == {"text": 7.0, "mark": 4.0})

check("AA text is four and a half and AA non-text is three",
      check_contrast.THRESHOLDS["AA"] == {"text": 4.5, "mark": 3.0})


# ------------------------------------------------------------------ #
# The real tree.                                                      #

DAYLIGHT = tokens_of("Daylight") or {}
MIDNIGHT = tokens_of("Midnight") or {}

check("Daylight's muted text clears AA on the page it sits on",
      check_contrast.ratio(DAYLIGHT.get("--color-text-muted", "#ffffff"),
                           DAYLIGHT.get("--color-bg", "#ffffff")) >= 4.6)

check("Midnight's accent text clears AA on a card with margin, not by 0.03",
      check_contrast.ratio(MIDNIGHT.get("--color-accent-text", "#ffffff"),
                           MIDNIGHT.get("--color-surface", "#ffffff")) >= 4.6)

# The two system-preference scopes exist so a visitor who has expressed
# a preference and never touched the chips gets the same palette the
# chip would give them. Values that drifted apart would be a palette
# nobody tested.
check("the light media block and the Daylight chip declare the same colors",
      tokens_of("Daylight") is not None
      and tokens_of("Daylight")
      == tokens_of("Daylight (prefers-color-scheme)"))

check("the contrast media block and the contrast chip declare the same "
      "colors",
      tokens_of("High contrast") is not None
      and tokens_of("High contrast")
      == tokens_of("High contrast (prefers-contrast)"))

check("so the gate passes on the tree as it stands",
      check_contrast.problems() == [])


if failures:
    print("\ncheck_contrast.py FAILED %d of %d checks"
          % (failures, performed))
    sys.exit(1)
if performed != EXPECTED:
    print("\ncheck_contrast.py ran %d checks, expected %d - a check "
          "stopped running, or one was added without updating EXPECTED"
          % (performed, EXPECTED))
    sys.exit(1)
print("\ncheck_contrast.py OK - %d checks" % performed)
