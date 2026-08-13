#!/usr/bin/env python3
"""Hold every subset face to the characters the pages ask it to draw.

    python tools/check_fonts.py

Issue #85. The vendored Playfair Display italic carries a wordmark's
inventory rather than a full latin subset, because the only text it
draws is one word - "Binder", in the rail wordmark. A full latin subset
of a display face is 23,204 gzipped bytes, and theme.css names it from
every page, so the difference is paid wherever that word is drawn.
WORDMARK_PAGES in tools/check_web.py is the roster that says which
pages draw it; do not read this check as covering only the rail, since
a plain page is free to grow a wordmark and this arm would have to see
it the day it did.

WHY THIS CHECK HAS TO EXIST, AND WHY IT HAD TO EXIST FIRST
----------------------------------------------------------
A font that lacks a character fails silently. There is no error, no
console line, no failed request: the browser falls through to the next
family in the stack, so a wordmark whose copy grows a character the
subset does not carry still renders - in Georgia, beside four faces
that did load. It looks like a design regression rather than a missing
glyph, and it survives every other check in this gate.

That is the whole hazard of subsetting, and it is why this arm was
written and committed before the smaller binary was.

WHAT IS MEASURED
----------------
For each face in FACES: the text of every element on every shipped page
that carries the class the face is pinned against, and the face's own
cmap. Every character in that text has to be in that cmap.

The demand is read from dist/ rather than apps/web, for the reason
tools/check_budget.py reads dist/: this is a question about what a
visitor's browser is handed, and dist/ is the tree that is published.

THE CLASS ROSTER IS PINNED, AND THAT IS THE POINT
-------------------------------------------------
FACES maps a face to the classes whose text it draws. It is a hand list
and it lives here, outside apps/web, which AGENTS.md's review bar asks
for directly: a check computed entirely from the file it guards cannot
detect that the file was rearranged, so something outside has to say
what it may contain. A roster derived by resolving CSS custom
properties through the cascade would be the file describing itself.

It also means a NEW element given the italic face needs a line here.
That is deliberate friction of the same kind CEILINGS and CSP_PAGES
carry: a table derived from what exists cannot fail when something is
added, and something being added is exactly when a subset gets
forgotten.

AND UNTIL #227 THE FRICTION WAS NOT THERE
-----------------------------------------
The paragraph above is the argument for a hand roster, and the roster
it argued for could not fail when something was added - which is the
one case it names. Both arrival directions were open:

 - a `.woff2` vendored into dist/fonts that no line here names was
   simply never looked at. FACES_UNPINNED closes it: every vendored
   face is either pinned above or carries a written reason it needs no
   coverage check, so a new face is a sentence somebody wrote.

 - a class theme.css gives the subset face was never asked what
   characters it spells. ITALIC_FACE and the class roster close that
   one, and they key on `font-style: italic` because that declaration
   is what can only be served by a vendored italic face. The key is
   decisive only while the tree vendors ONE italic face, so a second
   one is reported rather than silently narrowing this claim.

Both are held in both directions - a roster line whose face or class
has gone fails too - for the reason tools/check.py's suite roster is:
an arm for one direction that can pass while the other is broken is
what #204 found, and it is what was here.

TWO ARMS, BECAUSE THE FIRST ONE ALONE ROTS
-------------------------------------------
 - a character the pages ask for and the face lacks FAILS, naming the
   character, the face and the text that wanted it. This is the arm that
   catches a copy change: rename the wordmark to anything carrying a
   character outside the subset and the gate goes red instead of the
   page going serif.

 - a face that no longer covers REQUIRED_INVENTORY FAILS too. Without
   it, the first arm would ratchet the other way: somebody re-subsets to
   exactly today's six letters, the check passes, and the next copy
   change is a silent fallback again. The inventory is what the owner
   ruled the face must carry - full ASCII printable plus the
   typographic punctuation a wordmark uses - rather than what today's
   wordmark happens to spell.

WHAT THIS CHECK DOES NOT DO
---------------------------
It says nothing about how the glyphs look. A subset that kept every
required character and dropped kerning would pass here and still change
the wordmark's spacing; that is what the render evidence on the pull
request is for, and it is stated rather than implied because a check
believed to cover more than it does is the failure this repository
keeps paying for.

It reads static markup only. Text a script writes into one of these
elements is outside what this can see - there is none today, and that
is a fact about the tree rather than a property of this check.

The class roster reads `font-style: italic` as a declaration of its
own and does not read the `font` shorthand, which can carry a style in
front of a size. There is none in the stylesheet; a shorthand that
arrives is a demand this would not see, which is why it is written
down here rather than left to be discovered.

It does not read apps/web. The two trees are held identical by the
gate's build stage, which is a better guarantee than reading both here
would be.
"""

import html as html_module
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(REPO, "dist")

# Face file -> the classes whose text that face draws. See the docstring
# on why this is a hand list rather than a walk of the cascade.
#
# One entry today. .wordmark-name is the only rule in theme.css carrying
# font-style: italic. A second place that wants the face restyles that
# same class rather than introducing another, which is what keeps this
# a one-row table; a new class given the italic face is what the
# unnamed-class arm below is for.
FACES = {
    "fonts/playfair-display-600-italic-latin.woff2": ("wordmark-name",),
}

# Where the face roster below looks, and what it counts as a face.
# Named rather than inlined so dev/check_fonts.test.py can pin the
# scope, the shape tools/check.py's SUITE_DIR is in.
FONT_DIR = "fonts"
FONT_SUFFIX = ".woff2"

# The one stylesheet the class roster reads. Every rule on this site
# lives in it; a second one linked from a single page is the styling
# route this cannot see, and it is check_web.py's CSP arms that keep
# that route shut.
STYLESHEET = "theme.css"

# {vendored face: why no line in FACES pins it}. Every .woff2 in the
# published fonts directory is in one table or the other, so a face
# arriving is a sentence somebody wrote rather than a file nobody
# looked at - the shape tools/check.py's NODE_SUITES_EXCLUDED has, and
# for the same reason. An entry the enumeration cannot find fails, so
# this list can only shrink and cannot go stale.
FACES_UNPINNED = {
    "fonts/dm-sans-400-latin.woff2":
        "a full latin subset, not narrowed to any one string. Nothing "
        "here can go silently missing from it, so there is no per-"
        "character demand to pin",
    "fonts/dm-sans-600-latin.woff2":
        "the same face at the weight the headings ask for, and a full "
        "latin subset for the same reason",
    "fonts/jetbrains-mono-400-latin.woff2":
        "a full latin subset. It draws the mono roles - labels, ids, "
        "figures - and carries the whole alphabet either way",
    "fonts/playfair-display-600-latin.woff2":
        "the upright half of the display family, and a full latin "
        "subset. Only the italic half was cut to a wordmark's "
        "inventory by #85, which is what put it in FACES and this one "
        "here",
}

# The face the class roster is about, and the declaration that reaches
# it. `font-style: italic` is the key because it is the one thing a
# rule can say that only a vendored italic face can serve - and it is
# decisive only while this tree vendors exactly one, which
# italic_problems() checks rather than assumes.
ITALIC_FACE = "fonts/playfair-display-600-italic-latin.woff2"

# {class: why it takes italic text and needs no coverage line}. Empty,
# and the emptiness is the point, exactly as NODE_SUITES_EXCLUDED's is:
# a class left out on purpose is then a sentence somebody wrote.
ITALIC_CLASSES_UNPINNED = {}

# What every face above must carry regardless of what the pages spell
# today. Full ASCII printable, so any English wordmark fits without a
# re-subset, plus the typographic punctuation a wordmark actually
# reaches for - the curly apostrophe above all, since the site is "Hang
# Gang's Binder" and that is the character a rename gains without
# anybody thinking of it as a font change.
#
# Owner ruling, 2026-08-09: err wide within the face's role. The saving
# is in dropping the non-latin blocks and the glyph variants, not in
# shaving letters, and a six-glyph subset would have been brittle in
# exactly the way this constant exists to prevent.
#
# The non-ASCII half is written as escapes rather than as the characters
# themselves. A literal no-break space or curly apostrophe in a source
# file is invisible to the next reader and indistinguishable from its
# ASCII lookalike in a diff - the same class of trap this check exists
# to catch, and a poor one to lay here.
REQUIRED_INVENTORY = (
    " !\"#$%&'()*+,-./0123456789:;<=>?@"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`"
    "abcdefghijklmnopqrstuvwxyz{|}~"
    "\u00a0"                    # no-break space
    "\u2013\u2014"              # en dash, em dash
    "\u2018\u2019\u201a"        # single quotes, incl. apostrophe
    "\u201c\u201d\u201e"        # double quotes
    "\u2026"                    # ellipsis
    "\u2039\u203a"              # single angle quotes
)

# How many missing characters a failure names before it stops. Enough to
# show the shape of the problem without turning the message into a
# character dump.
WORST = 12

# The declaration that reaches an italic face. Anchored on a declaration
# boundary rather than searched for loose, because `font-style: italic`
# is also a substring of nothing else here and would be one the day a
# custom property is named after it.
ITALIC = re.compile(r"(^|;)\s*font-style\s*:\s*italic\s*(;|$)", re.I)


def html_pages():
    return sorted(name for name in os.listdir(WEB)
                  if name.endswith(".html"))


def class_text(text, name):
    """Every element's text for one class, in document order.

    Comments go first, for the reason tools/check_budget.py drops them
    before reading tags: markup somebody commented out draws nothing, so
    a character only a commented-out wordmark carries would fail this
    gate for a demand that does not exist.

    The class is matched as a whole word rather than as a substring. A
    prefix match would collect `wordmark-nameplate` and report
    characters the face is never asked for, which is a failure with no
    cause behind it.

    Entities are resolved, because `&#8217;` is a demand for the curly
    apostrophe exactly as the literal character is, and reading it as
    seven ASCII characters would be wrong in both directions at once -
    it would pass a face missing the apostrophe and fail one missing
    the digits.

    OPENING TAGS ARE MATCHED, AND THE BODY IS WALKED SEPARATELY, which
    is not a stylistic choice. One expression spanning the whole element
    consumes the element it matched, so `re.finditer` resumes AFTER it
    and never sees anything nested inside - and the wordmark is nested,
    inside the rail aside on every page that carries one. A
    whole-element pattern therefore matches the wrapper, finds the
    wrong class on it, and reports that no page asks anything of this
    face: a green check over an empty demand, which is the exact failure
    the empty-demand arm below exists to catch. It caught that one.
    """
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    found = []
    for match in re.finditer(
            r"<([a-z0-9]+)\b([^>]*)>", text, re.I):
        attributes = match.group(2)
        if attributes.rstrip().endswith("/"):
            continue
        quoted = re.search(r"\bclass\s*=\s*(\"[^\"]*\"|'[^']*')",
                           attributes, re.I)
        if not quoted or name not in quoted.group(1)[1:-1].split():
            continue
        body = element_body(text, match.group(1), match.end())
        if body is None:
            continue
        inner = re.sub(r"<[^>]+>", "", body)
        found.append(html_module.unescape(inner).strip())
    return found


def element_body(text, tag, start):
    """The markup between one opening tag and its own closing tag.

    Depth-counted rather than "up to the next `</tag>`", because the
    first close belongs to the first nested element of the same name
    rather than to the one that was opened - and reading it as the
    element's end would truncate the text the face is asked to draw,
    which fails this check in the direction that reports too little.

    None when nothing closes it, so an unbalanced page is skipped rather
    than measured against a body that runs to the end of the file.
    """
    depth = 1
    position = start
    pattern = re.compile(r"<(/?)%s\b[^>]*>" % re.escape(tag), re.I)
    while True:
        match = pattern.search(text, position)
        if not match:
            return None
        depth += -1 if match.group(1) else 1
        if depth == 0:
            return text[start:match.start()]
        position = match.end()


def uncovered(texts, cmap):
    """Characters the given texts need that the cmap does not carry.

    Pure, over found-sets, so both arms can be exercised without editing
    a published file or rebuilding a font - the shape
    tools/check_budget.py's budget_problems() uses and for the same
    reason.

    Sorted rather than in encounter order: a stable message is one a
    reader can compare between two runs.
    """
    needed = set()
    for text in texts:
        needed.update(text)
    return sorted(needed - set(cmap))


def vendored_faces(web=None):
    """Every face file in the published fonts directory, or None.

    None rather than an empty set when the directory is not there, so
    "nothing was enumerated" cannot print the same silence as "the
    roster agrees" - #34's finding, and the reason tools/check.py's
    roster arm opens the same way.
    """
    web = WEB if web is None else web
    directory = os.path.join(web, FONT_DIR)
    if not os.path.isdir(directory):
        return None
    return {FONT_DIR + "/" + name for name in os.listdir(directory)
            if name.endswith(FONT_SUFFIX)}


def face_roster_problems(pinned=None, unpinned=None, web=None):
    """Every way the two face tables and the fonts directory disagree.

    This is the ARRIVAL half. A face named in FACES that is not on disk
    is already reported by problems() below, which names the face and
    says the coverage could not be checked - a better message than
    anything this walk could give - so it is deliberately not repeated
    here.

    The parameters exist so dev/check_fonts.test.py can drive this over
    a directory it builds: a rule exercised only against the tree it
    guards cannot be shown to fail.
    """
    pinned = FACES if pinned is None else pinned
    unpinned = FACES_UNPINNED if unpinned is None else unpinned

    found = vendored_faces(web)
    if found is None:
        return ["%s/ is not there at all, so no face was enumerated and "
                "both tables were compared against an empty answer. A "
                "reader that found nothing to read prints the same "
                "silence as a roster that agrees." % FONT_DIR]

    problems = []

    for path in sorted(found - set(pinned) - set(unpinned)):
        problems.append(
            "%s is vendored and nothing here checks it. A face is either "
            "pinned in FACES against the classes it draws, or given a "
            "line in FACES_UNPINNED saying why it needs no coverage "
            "check. A subset face nobody pinned is the failure this file "
            "exists about, and it renders as a fallback serif rather "
            "than as an error." % path)

    for path in sorted(unpinned):
        if path not in found:
            problems.append(
                "FACES_UNPINNED names %s and the enumeration does not "
                "find it. A reason for a face that is not vendored "
                "excuses nothing and hides the next reader from the one "
                "that is - delete the entry." % path)
        if path in pinned:
            problems.append(
                "%s is both pinned in FACES and excused in "
                "FACES_UNPINNED. It is checked, so the excuse is a false "
                "sentence about this gate - delete whichever of the two "
                "is wrong." % path)

    return problems


def css_blocks(css):
    """(selector text, declarations) for every innermost brace block.

    Innermost, which is what makes a media query readable without a
    parser: the pattern cannot cross a brace, so a wrapper holding
    another block never matches and the rules inside it are read
    exactly as the ones outside are. The wrapper's own prelude is not
    returned, and it is not wanted - `@media` styles nothing itself.

    Comments go first, for the reason class_text() drops them: a rule
    somebody commented out styles nothing, so a class only a
    commented-out rule carries would be reported for a demand that does
    not exist. The published stylesheet has no comments left in it -
    tools/build_web.mjs takes them out - which makes this the arm that
    survives this reader ever being pointed at apps/web.
    """
    css = re.sub(r"/\*.*?\*/", " ", css, flags=re.S)
    return [(match.group(1).strip(), match.group(2))
            for match in re.finditer(r"([^{}]*)\{([^{}]*)\}", css)]


def italic_selectors(css):
    """Every selector whose rule asks for italic text, comma-split.

    At-rule blocks are skipped: `@font-face` DECLARES a face and its
    `font-style` is a descriptor saying what the file contains, not a
    demand that anything be drawn in it. Reading one as a rule would
    report the face as styling nothing and the roster as short by
    whatever the descriptor's prelude spelled.
    """
    found = []
    for prelude, declarations in css_blocks(css):
        if not prelude or prelude.startswith("@"):
            continue
        if ITALIC.search(declarations):
            found.extend(part.strip() for part in prelude.split(",")
                         if part.strip())
    return found


def subject_classes(selector):
    """The classes on the element a selector styles.

    Its rightmost compound, not every class in it. `.rail
    .wordmark-name` styles the wordmark and says nothing about what
    `.rail` is drawn in, so collecting both would demand a roster line
    for a class that takes no face - friction with no cause behind it,
    which is the kind that gets a check deleted.
    """
    compound = re.split(r"[\s>+~]+", selector.strip())[-1]
    return set(re.findall(r"\.([A-Za-z0-9_-]+)", compound))


def italic_face_sources(css):
    """The face file every italic @font-face block loads, sorted."""
    found = []
    for prelude, declarations in css_blocks(css):
        if prelude.lower() != "@font-face" or not ITALIC.search(declarations):
            continue
        url = re.search(r"""url\(\s*["']?([^"')]+)""", declarations)
        found.append(url.group(1).strip() if url else "")
    return sorted(found)


def italic_problems(css, pinned=None, unpinned=None, face=None):
    """Every way the class roster and the stylesheet disagree.

    The arrival direction (#227) is the third loop: a class the
    stylesheet makes italic that no line names takes a face nobody
    asked what it can draw. The other loops are what keep that arm
    honest - a key that has stopped being decisive, a scan that read
    nothing, and roster lines about classes the stylesheet no longer
    styles.
    """
    face = ITALIC_FACE if face is None else face
    unpinned = ITALIC_CLASSES_UNPINNED if unpinned is None else unpinned
    problems = []

    if pinned is None:
        if face not in FACES:
            problems.append(
                "%s is the face this class roster is about and FACES does "
                "not carry it, so the roster it reads is empty and every "
                "class would pass. Either the face moved and ITALIC_FACE "
                "did not, or its FACES line went." % face)
        pinned = FACES.get(face, ())

    sources = italic_face_sources(css)
    if sources != [face]:
        problems.append(
            "%s declares %s as its italic face(s) and this roster is "
            "about %s. The class arm reads `font-style: italic` as "
            "meaning that face, which it only does while exactly one is "
            "vendored - so a second face, or a different one, is "
            "reported rather than left to narrow this check silently."
            % (STYLESHEET, ", ".join(sources) or "no face", face))

    selectors = italic_selectors(css)
    if not selectors:
        problems.append(
            "no rule in %s asks for italic text, so this roster was "
            "compared against an empty scan and would pass however wrong "
            "it was. Either the selector reader has stopped matching, or "
            "nothing takes the italic face and its FACES line should go "
            "with it." % STYLESHEET)

    seen = set()
    for selector in selectors:
        classes = subject_classes(selector)
        if not classes:
            problems.append(
                "`%s` is styled italic in %s and the element it styles "
                "carries no class, so there is no name to pin it against "
                "and the characters it spells are never asked of the "
                "face. Give it a class and a roster line, or style it "
                "through one that has both." % (selector, STYLESHEET))
            continue
        seen |= classes
        for name in sorted(classes - set(pinned) - set(unpinned)):
            problems.append(
                ".%s is made italic by %s and no line names it, so the "
                "characters it spells were never asked of %s. Add it to "
                "that face's row in FACES, or say in "
                "ITALIC_CLASSES_UNPINNED why it needs no coverage line."
                % (name, STYLESHEET, face))

    for name in sorted(set(unpinned) - seen):
        problems.append(
            "ITALIC_CLASSES_UNPINNED names .%s and no rule in %s makes it "
            "italic. A reason for a class that takes no face excuses "
            "nothing - delete the entry." % (name, STYLESHEET))

    for name in sorted(set(pinned) - seen):
        problems.append(
            "FACES pins .%s against %s and no rule in %s makes it "
            "italic, so that row is measuring a demand this face no "
            "longer serves. Either the class was renamed in the "
            "stylesheet and not here, or the row should go."
            % (name, face, STYLESHEET))

    return problems


def face_cmap(path):
    """The set of characters one font file can draw.

    fontTools rather than a hand parser: a woff2's tables are Brotli
    compressed and there is no stdlib route to them. The import is done
    here rather than at module scope so the absence of the dependency
    becomes a problem this check REPORTS, instead of a traceback that
    stops the gate before it says which stage needed what.
    """
    from fontTools.ttLib import TTFont

    font = TTFont(path)
    try:
        return {chr(point) for point in font.getBestCmap()}
    finally:
        font.close()


def demanded_text():
    """{face: [text]} for every rostered face, read off the shipped pages."""
    demanded = {}
    for face, classes in FACES.items():
        texts = []
        for page in html_pages():
            with open(os.path.join(WEB, page), encoding="utf-8") as handle:
                markup = handle.read()
            for name in classes:
                texts.extend(class_text(markup, name))
        demanded[face] = texts
    return demanded


def describe(characters):
    """Missing characters as something a person can act on.

    ascii() rather than repr(), and it is load-bearing rather than
    fussy. The character this check names is by definition one the face
    could not draw, which is very often one the console cannot encode
    either: on a cp1252 terminal - the default on the machine this gate
    is run from by hand - printing it raises UnicodeEncodeError, and the
    check dies with a traceback INSTEAD of the message that says what is
    wrong. It still exits non-zero, so the gate still fails; it fails
    illegibly, at exactly the moment it is doing its job. Found by
    mutation, which is what mutation is for.
    """
    shown = characters[:WORST]
    text = ", ".join("%s (U+%04X)" % (ascii(char), ord(char))
                     for char in shown)
    if len(characters) > WORST:
        text += " and %d more" % (len(characters) - WORST)
    return text


def problems():
    """Every problem in the tree as it stands."""
    found = []

    # The two rosters run before the dependency gate below, because
    # neither needs to open a font: a face that arrived unnamed and a
    # class that arrived unpinned are exactly as true on a machine
    # without fontTools, and reporting only "install fontTools" there
    # would hide them behind an environment fault.
    found.extend(face_roster_problems())

    stylesheet = os.path.join(WEB, STYLESHEET)
    if not os.path.isfile(stylesheet):
        found.append(
            "%s is not in the published tree, so no rule was read and the "
            "class roster verified nothing. It is where every rule on "
            "this site lives; a published tree without it is a site with "
            "no styling at all." % STYLESHEET)
    else:
        with open(stylesheet, encoding="utf-8") as handle:
            found.extend(italic_problems(handle.read()))

    try:
        import fontTools  # noqa: F401
    except ImportError:
        found.append(
            "fontTools is not installed, so no face could be read and the "
            "coverage half of this check verified nothing. It is the "
            "gate's only route into a woff2 - the tables are Brotli "
            "compressed - so this is reported as a failure rather than "
            "skipped: a stage that passes when its dependency is missing "
            "is the armed-looking-but-not check this repository holds to "
            "be worse than having no check at all. Install it with "
            "`python -m pip install fonttools[woff]`")
        return found

    demanded = demanded_text()

    for face in sorted(FACES):
        path = os.path.join(WEB, *face.split("/"))
        if not os.path.isfile(path):
            found.append(
                "%s is named in FACES and there is no such file, so the "
                "characters the pages ask of it could not be checked. "
                "Either the face moved and its roster line did not, or a "
                "line names a face that was never vendored" % face)
            continue

        cmap = face_cmap(path)
        texts = demanded[face]

        if not texts:
            found.append(
                "%s is named in FACES and no page carries any of its "
                "classes (%s), so this face was checked against an empty "
                "demand and would pass however narrow it was. Either the "
                "markup that used it is gone and this line should go with "
                "it, or a class was renamed on the pages and not here"
                % (face, ", ".join(FACES[face])))
            continue

        missing = uncovered(texts, cmap)
        if missing:
            found.append(
                "%s cannot draw %s, which the shipped pages ask of it "
                "(%s). A browser does not report this: it falls through "
                "to the next family in the stack, so the text renders in "
                "a fallback serif and every other check here stays green. "
                "Re-subset the face to include it, or change the copy back"
                % (face, describe(missing),
                   ", ".join(ascii(text) for text in sorted(set(texts)))))

        thin = uncovered([REQUIRED_INVENTORY], cmap)
        if thin:
            found.append(
                "%s no longer covers the inventory this face is required "
                "to carry - missing %s. The pages may not ask for these "
                "today, which is exactly why the requirement is pinned "
                "rather than derived: a face narrowed to whatever the "
                "current copy spells turns the next wording change into a "
                "silent fallback" % (face, describe(thin)))

    return found


def main():
    if not FACES:
        print("::error::FACES is empty, so this check read nothing. A gate "
              "that measures an empty set reports success for a run that "
              "verified nothing")
        print("\ncheck_fonts FAILED 1 check(s)")
        return 1

    issues = problems()

    if issues:
        for issue in issues:
            print("::error::%s" % issue)
        print("\ncheck_fonts FAILED %d check(s)" % len(issues))
        return 1

    # The real figures are printed rather than a bare "ok", for the
    # reason tools/check_budget.py prints its table: a line saying every
    # face covers what is asked of it is equally true of a run that
    # asked nothing.
    print("check_fonts: every subset face covers the characters the "
          "shipped pages ask of it, and the pinned inventory.\n")
    demanded = demanded_text()
    for face in sorted(FACES):
        path = os.path.join(WEB, *face.split("/"))
        texts = demanded[face]
        needed = set()
        for text in texts:
            needed.update(text)
        print("  %s\n      %d mapped, %d asked for by %d element(s): %s"
              % (face, len(face_cmap(path)), len(needed), len(texts),
                 ", ".join(ascii(text) for text in sorted(set(texts)))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
