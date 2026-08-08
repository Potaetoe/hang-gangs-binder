#!/usr/bin/env python3
"""
Hold every palette to WCAG contrast, with margin.

    python tools/check_contrast.py

Issue #81. The theming system was sound and unmeasured: three palettes
as custom-property blocks, switched by an attribute, system preference
honored without JavaScript - and nothing anywhere computed a single
ratio. Measuring by hand found nineteen failing pairings, so the
question this answers is not "is it right today" but "can the twentieth
arrive without anybody noticing".

WHAT IS MEASURED
----------------
apps/web/theme.css is parsed into one set of concrete colors per
palette, and PAIRINGS below is computed for every one of them. A
pairing is a foreground token, a background token, and which rule it
falls under: text (WCAG 1.4.3) or a non-text mark and boundary (1.4.11).

The ratio is WCAG 2.x relative luminance - the sRGB channel transform,
the 0.2126/0.7152/0.0722 weights, and (lighter + 0.05) / (darker +
0.05). It is arithmetic over the declared hexes, which is the whole of
what this check can honestly claim; see the limits at the bottom.

MARGIN IS THE STANDARD
----------------------
Every ratio must clear its threshold by MARGIN, not merely reach it.
#81 measured Dark's current-page nav link at 4.53:1 against a 4.5
requirement and named the problem exactly: that is luck, not margin. A
palette shipping on three hundredths of a point has not been designed,
and the next person to nudge a hex by one digit has no idea they are
standing on the line.

THE LEVEL BELONGS TO THE SCOPE
------------------------------
SCOPES pins which palette each :root block is, and which level it
answers to. Midnight, Pink and Parchment Daylight are held to AA - 4.5
text, 3 non-text.
The high-contrast palette is held to AAA - 7 text, 4 non-text - because
a palette whose entire purpose is contrast is not finished when it
merely matches the palette a visitor turned away from.

BOTH DIRECTIONS, TWICE
----------------------
Two ratchets, because a contrast check that only computes ratios drifts
into measuring less and less while staying green:

 - SCOPES. A :root block declaring a background whose selector is not
   pinned FAILS as an unknown palette, which is what stops a fifth
   palette shipping unmeasured. A pinned scope matching nothing FAILS
   as stale. The table lives here, outside the stylesheet, for the
   reason AGENTS.md's review bar gives: a check computed entirely from
   the file it guards cannot detect that the file was rearranged.
 - COVERAGE. A pairing naming a token no palette defines FAILS as a
   stale list. A --color-* token defined in the stylesheet that appears
   in no pairing and no exemption FAILS as an unguarded color. The
   second arm is the one that would have caught #81's worst finding on
   its own: six chart-series hexes shared by three palettes, tuned for
   the darkest of them, nine of ten pairings failing on the pale one,
   and nothing anywhere obliged to account for them.

EXEMPT is deliberately two entries and is pinned in
dev/check_contrast.test.py as well, because growing it is the one edit
that makes a failing pairing disappear without changing a color:

 - --color-accent-quiet is color-mix() over a transparent stop. It has
   no fixed luminance to measure - what it composites over decides
   that - so a number here would be invented rather than computed.
 - --color-border is decorative by rule. WCAG 1.4.11 asks 3:1 of
   boundaries needed to identify a control, and the components that
   need identifying take --color-border-strong, which IS measured
   against both surfaces a control sits on. Card edges, table rules and
   the footer line carry no information and are allowed to be quiet.
   That split is the reason --color-border-strong exists at all.

WHAT THIS CHECK DOES NOT DO
---------------------------
It reads declared values, not rendered pixels. Which token actually
paints which element is a fact about the rules further down the
stylesheet and about the markup, and static reading cannot reach it -
so a pairing list that goes stale against the components is a real
failure mode, and the coverage arm is what bounds it: every color has
to be in the list somewhere.

Opacity, filters, gradients, overlapping stacking contexts and any
color a script assembles at runtime are outside it too. So is text
size: WCAG allows 3:1 for large text, and every pairing here is held to
the small-text figure instead, which is stricter than required rather
than looser.

Color-vision deficiency is not computed here. The chart-series values
were validated against protan/deutan simulation when they were chosen,
and the comment beside them in theme.css records the verdicts; this
check holds their contrast and cannot re-derive their separation.
"""

import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS = os.path.join(REPO, "apps", "web", "theme.css")

# How far past its threshold a ratio has to land. #81's worked example
# is why this is not zero: 4.53 against a 4.5 requirement passed, and
# was one rounding away from not passing.
MARGIN = 0.1

THRESHOLDS = {
    # WCAG 1.4.3 (small text) and 1.4.11 (non-text contrast).
    "AA": {"text": 4.5, "mark": 3.0},
    # 1.4.6 enhanced text, and 4:1 for boundaries and marks - above the
    # 3:1 the standard asks, because this palette is chosen by somebody
    # who has said the others are not enough.
    "AAA": {"text": 7.0, "mark": 4.0},
}

# (media condition or None, normalized selector) -> (palette, level).
#
# Pinned rather than discovered. A block this table does not name fails
# as an unknown palette, and an entry matching nothing fails as stale,
# so a fourth palette could not have been added without this file
# moving - which is exactly what happened when the fourth one was.
#
# The two :root:not([data-theme]) scopes have identical selectors and
# are told apart only by their media condition. Dropping the condition
# would measure one of them twice and the other never.
SCOPES = {
    (None, ':root,:root[data-theme="midnight"]'): ("Midnight", "AA"),
    (None, ':root[data-theme="pink"]'): ("Pink", "AA"),
    (None, ':root[data-theme="daylight"]'): ("Parchment Daylight", "AA"),
    (None, ':root[data-theme="contrast"]'): ("High contrast", "AAA"),
    ("(prefers-color-scheme: light)", ":root:not([data-theme])"):
        ("Parchment Daylight (prefers-color-scheme)", "AA"),
    ("(prefers-contrast: more)", ":root:not([data-theme])"):
        ("High contrast (prefers-contrast)", "AAA"),
}

# (foreground, background, rule). Pinned, and pinned as pairs rather
# than as a list of tokens: what a color has to clear depends entirely
# on what it sits on, and --color-accent has to answer for both a
# label on top of it and its own edge against the page.
PAIRINGS = [
    # Body copy and secondary copy, on both surfaces a page has.
    ("--color-text", "--color-bg", "text"),
    ("--color-text", "--color-surface", "text"),
    ("--color-text-muted", "--color-bg", "text"),
    ("--color-text-muted", "--color-surface", "text"),

    # The error message under a field, which is the one place color is
    # not the only signal but is still the color a person reads.
    ("--color-warn-text", "--color-warn-bg", "text"),

    # Accent-colored text on a surface: the current-page nav link, and
    # the pairing #81 measured at 4.53 in Dark.
    ("--color-accent-text", "--color-bg", "text"),
    ("--color-accent-text", "--color-surface", "text"),

    # The label on a filled button, measured against the fill. This is
    # the pairing that made the token split necessary - one --primary
    # serving both roles is why Light's button label sat at 4.0:1.
    ("--color-on-accent", "--color-accent", "text"),

    # --color-accent-strong is the primary button's hover fill, and only
    # that. It was also the color of every ordinary link until Midnight,
    # and the two jobs turn out to be incompatible whenever the button
    # label is the light half of the pair: a hover light enough to read
    # as link text on the page is a hover the cream label cannot sit on.
    # Every earlier palette hid that, because all of them label their
    # buttons in the dark half, where one lighter value happens to serve
    # both. Links moved to --color-accent-text, which is what theme.css's
    # own token comment always said that token was for.
    #
    # So this is measured as a shape rather than as text - and the label
    # on it gets the pairing nothing had before. A hovered button is
    # still a button: its fill has to be findable against the page, and
    # what is written on it has to stay readable while the pointer is
    # there.
    ("--color-accent-strong", "--color-bg", "mark"),
    ("--color-on-accent", "--color-accent-strong", "text"),

    # A focus ring nobody can see is not a focus indicator.
    ("--color-focus", "--color-bg", "mark"),

    # The accent as a shape rather than as text: the chart bar, the
    # checked radio, the pressed chip's fill against the page.
    ("--color-accent", "--color-bg", "mark"),

    # The component boundary, against both surfaces a control sits on -
    # a card and the field color inside it.
    ("--color-border-strong", "--color-surface", "mark"),
    ("--color-border-strong", "--color-field", "mark"),
]

# Six chart series, each against both backgrounds a chart is drawn on.
# Written as a loop rather than twelve lines because the rule is
# uniform and a hand-written list is where a slot goes missing.
PAIRINGS += [("--color-series-%d" % slot, background, "mark")
             for slot in range(6)
             for background in ("--color-bg", "--color-surface")]

# The colors no pairing can measure. Two entries, and both are reasoned
# in the docstring rather than merely listed. Pinned in
# dev/check_contrast.test.py too: this set is the one edit that makes a
# failure disappear without changing a color.
EXEMPT = frozenset({"--color-accent-quiet", "--color-border"})

CUSTOM_PROPERTY = re.compile(r"(--[\w-]+)\s*:\s*([^;]+);")
VAR_REFERENCE = re.compile(r"^var\(\s*(--[\w-]+)\s*\)$")
HEX_COLOR = re.compile(r"^#(?:[0-9a-f]{3}|[0-9a-f]{6})$", re.I)


def luminance(color):
    """WCAG 2.x relative luminance of one hex color, 0.0 to 1.0."""
    red, green, blue = parse_hex(color)

    def channel(value):
        value /= 255.0
        if value <= 0.03928:
            return value / 12.92
        return ((value + 0.055) / 1.055) ** 2.4

    return (0.2126 * channel(red) + 0.7152 * channel(green)
            + 0.0722 * channel(blue))


def ratio(one, other):
    """WCAG contrast ratio between two hex colors, 1.0 to 21.0.

    Symmetric by construction - the lighter of the two goes on top -
    so a pairing does not have to know which of its colors is in front.
    """
    first, second = luminance(one), luminance(other)
    lighter, darker = max(first, second), min(first, second)
    return (lighter + 0.05) / (darker + 0.05)


def parse_hex(value):
    """(r, g, b) for a hex color, or None for anything else.

    None rather than a guess. A value this cannot read is a value the
    check does not understand, and reading an unparseable declaration
    as black would report enormous contrast for a palette nobody
    measured - the failure mode that looks like success.
    """
    if not value or not HEX_COLOR.match(value.strip()):
        return None
    digits = value.strip().lstrip("#")
    if len(digits) == 3:
        digits = "".join(digit * 2 for digit in digits)
    return tuple(int(digits[at:at + 2], 16) for at in (0, 2, 4))


def strip_comments(text):
    """`text` with CSS comments removed.

    A stylesheet under construction keeps the shape it is heading for
    in a comment, and a palette read out of one is a palette nobody
    ships.
    """
    return re.sub(r"/\*.*?\*/", "", text, flags=re.S)


def rules(text):
    """[(media condition, selector, {property: value})] for a stylesheet.

    A hand-written scanner rather than a CSS parser, because the whole
    of what has to be understood is one level of @media around ordinary
    rule blocks, and a dependency is not available to a directory that
    installs nothing.
    """
    text = strip_comments(text)
    found = []
    index = 0
    while True:
        opening = text.find("{", index)
        if opening < 0:
            return found
        prelude = text[index:opening].strip()
        closing = matching_brace(text, opening)

        if prelude.startswith("@media"):
            condition = prelude[len("@media"):].strip()
            for _inner, selector, decls in rules(
                    text[opening + 1:closing]):
                found.append((condition, selector, decls))
        else:
            found.append((None, normalize(prelude),
                          declarations(text[opening + 1:closing])))
        index = closing + 1


def matching_brace(text, opening):
    """The index of the "}" closing the "{" at `opening`.

    An unbalanced stylesheet returns the end of the text rather than
    raising: the message a person needs is which palette failed, and a
    traceback out of the scanner buries it.
    """
    depth = 0
    for at in range(opening, len(text)):
        if text[at] == "{":
            depth += 1
        elif text[at] == "}":
            depth -= 1
            if depth == 0:
                return at
    return len(text)


def normalize(selector):
    """One selector with its whitespace collapsed out.

    A selector list is written across lines here, and the scope table
    has to match it as one string.
    """
    return re.sub(r"\s+", "", selector)


def declarations(block):
    """{custom property: value} for one block, ignoring plain CSS.

    Only custom properties. `color-scheme: dark` is a real declaration
    and not a color this check can pair with anything.
    """
    return {name: value.strip()
            for name, value in CUSTOM_PROPERTY.findall(block)
            if name.startswith("--")}


def resolve(tokens, name):
    """The value of one token with var() followed one level, or None.

    One level, because theme.css uses exactly one hop - the series
    slot that takes the accent - and a resolver that chased arbitrarily
    far would need a cycle guard to keep a stylesheet typo from hanging
    the gate. A second hop comes back unresolved and fails as "not a
    hex color", which names the real problem.
    """
    value = tokens.get(name)
    if value is None:
        return None
    reference = VAR_REFERENCE.match(value)
    if reference and reference.group(1) != name:
        return tokens.get(reference.group(1), value)
    return value


def scopes(text):
    """({palette: (level, tokens)}, [unknown scope]) for a stylesheet.

    A block is a palette when it declares a background. The shared
    :root block of type, spacing and radius tokens declares none, and
    reading it as a palette would compute every pairing against a
    background it does not have.
    """
    found = {}
    unknown = []
    for condition, selector, decls in rules(text):
        if "--color-bg" not in decls:
            continue
        key = (condition, selector)
        if key not in SCOPES:
            unknown.append(
                "%s%s declares --color-bg, so it is a palette, and SCOPES "
                "in tools/check_contrast.py does not name it. Add it with "
                "the level it answers to - a palette this check cannot "
                "name is a palette it never measures"
                % ("@media %s " % condition if condition else "", selector))
            continue
        name, level = SCOPES[key]
        found[name] = (level, decls)
    return found, unknown


def scope_problems(palettes, unknown):
    """Both directions of the scope table."""
    problems = list(unknown)
    for (condition, selector), (name, _level) in sorted(
            SCOPES.items(), key=lambda item: item[1][0]):
        if name not in palettes:
            problems.append(
                "SCOPES pins the %s palette at %s%s, and no block in "
                "theme.css matches. Delete the entry, or restore the "
                "palette it was written for - a pinned scope with no "
                "block behind it is a check that cannot fail"
                % (name, "@media %s " % condition if condition else "",
                   selector))
    return problems


def pairing_problems(palettes, pairings=None, thresholds=None):
    """[problem] for every pinned pairing in every palette.

    Pure, over a palette set handed in, so both directions can be
    exercised without editing a file that is copied verbatim to the
    published site.
    """
    pairings = PAIRINGS if pairings is None else pairings
    thresholds = THRESHOLDS if thresholds is None else thresholds
    problems = []

    if not palettes:
        return ["theme.css yielded no palettes at all, so this check "
                "computed nothing. A contrast gate that measures an "
                "empty set reports success for a run that verified "
                "nothing"]

    for name in sorted(palettes):
        level, tokens = palettes[name]
        for foreground, background, kind in pairings:
            needed = thresholds[level][kind] + MARGIN
            colors = {}
            missing = False
            for role, token in (("foreground", foreground),
                                ("background", background)):
                value = resolve(tokens, token)
                if value is None:
                    problems.append(
                        "%s does not define %s, which the %s / %s "
                        "pairing needs. Every palette declares the same "
                        "token set, so one short is a palette that "
                        "cannot be measured"
                        % (name, token, foreground, background))
                    missing = True
                elif parse_hex(value) is None:
                    problems.append(
                        "%s defines %s as %r, which is not a hex color, "
                        "so its %s contrast cannot be computed. A value "
                        "this check cannot read is a value it must not "
                        "guess at" % (name, token, value, role))
                    missing = True
                else:
                    colors[role] = value
            if missing:
                continue

            measured = ratio(colors["foreground"], colors["background"])
            if measured < needed:
                problems.append(
                    "%s: %s on %s measures %.2f:1 and needs %.2f:1 "
                    "(%s %s at %.1f, plus the %.1f margin this check "
                    "requires). Colors: %s on %s"
                    % (name, foreground, background, measured, needed,
                       level, kind, thresholds[level][kind], MARGIN,
                       colors["foreground"], colors["background"]))

    return problems


def defined_colors(text):
    """Every --color-* token the stylesheet declares, in any block.

    The whole stylesheet rather than the palette blocks alone.
    --color-accent-quiet is declared in the shared :root block beside
    the type and spacing tokens, and a coverage arm that read only
    palettes would report it as undefined while leaving a real color
    unaccounted for - the exact hole the arm exists to close.
    """
    return {name
            for _condition, _selector, decls in rules(text)
            for name in decls
            if name.startswith("--color-")}


def coverage_problems(defined, pairings=None, exempt=None):
    """[problem] for the pinned list and the colors it must account for.

    Both directions. A pairing naming a token nothing defines is a
    stale entry that reads as coverage while measuring nothing; a color
    in no pairing and no exemption is an unguarded color, which is what
    six shared chart-series hexes were for three palettes.
    """
    pairings = PAIRINGS if pairings is None else pairings
    exempt = EXEMPT if exempt is None else exempt
    problems = []

    named = {token for pairing in pairings for token in pairing[:2]}

    for token in sorted(named - defined):
        problems.append(
            "PAIRINGS names %s and no palette defines it. Delete the "
            "pairing, or restore the token it was written for - a "
            "pairing over a token nothing declares reads as coverage "
            "and measures nothing" % token)

    for token in sorted(defined - named - exempt):
        problems.append(
            "%s is defined in theme.css and appears in no pairing and "
            "no exemption, so nothing measures it. Pair it against what "
            "it sits on, or exempt it in tools/check_contrast.py and "
            "say why - an unchecked color is an unguarded one" % token)

    for token in sorted(exempt - defined):
        problems.append(
            "EXEMPT names %s and no palette defines it. Delete the "
            "entry - the exemptions are the one list that can hide a "
            "failure, so a dead one may not sit there" % token)

    return problems


def problems():
    """Every problem in the stylesheet as it stands."""
    if not os.path.isfile(CSS):
        return ["apps/web/theme.css is not there, so this check read "
                "nothing. A gate that parses an absent file reports "
                "success for a run that verified nothing"]

    with open(CSS, encoding="utf-8") as handle:
        text = handle.read()
    palettes, unknown = scopes(text)

    found = scope_problems(palettes, unknown)
    found.extend(pairing_problems(palettes))
    found.extend(coverage_problems(defined_colors(text)))
    return found


def main():
    issues = problems()
    if issues:
        for issue in issues:
            print("::error::%s" % issue)
        print("\ncheck_contrast FAILED %d check(s)" % len(issues))
        return 1

    with open(CSS, encoding="utf-8") as handle:
        palettes, _unknown = scopes(handle.read())

    # The tightest pairing in the tree, printed rather than a bare
    # "ok". A line saying every palette passes is equally true of a run
    # that measured nothing; the worst ratio and the count are what
    # make it worth reading, and they are what moves when somebody
    # spends the margin.
    worst = None
    for name in sorted(palettes):
        level, tokens = palettes[name]
        for foreground, background, kind in PAIRINGS:
            measured = ratio(resolve(tokens, foreground),
                             resolve(tokens, background))
            slack = measured - (THRESHOLDS[level][kind] + MARGIN)
            if worst is None or slack < worst[0]:
                worst = (slack, name, foreground, background, measured)

    print("check_contrast: %d palettes x %d pairings, every one clear of "
          "its threshold by at least the %.1f margin.\n"
          % (len(palettes), len(PAIRINGS), MARGIN))
    width = max(len(name) for name in palettes)
    for name in sorted(palettes):
        level, tokens = palettes[name]
        ratios = [ratio(resolve(tokens, foreground),
                        resolve(tokens, background))
                  for foreground, background, _kind in PAIRINGS]
        print("  %-*s  %s   text %.1f / mark %.1f   worst %.2f:1"
              % (width, name, level, THRESHOLDS[level]["text"],
                 THRESHOLDS[level]["mark"], min(ratios)))
    print("\n  tightest: %s, %s on %s at %.2f:1 - %.2f over what it needs"
          % (worst[1], worst[2], worst[3], worst[4], worst[0]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
