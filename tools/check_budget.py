#!/usr/bin/env python3
"""
Hold every published page to a pinned transfer budget.

    python tools/check_budget.py

Issue #80. #72 measured the load and acquitted it, and the complaint
that started the redesign is how the site looks rather than how it
loads - so nothing here makes the site faster. This is the check that
notices when a redesign touching every page makes it heavier, which is
the only way the ground #72 measured gets lost: quietly, one page at a
time, with every other check still green.

WHAT IS MEASURED
----------------
For each HTML page in apps/web: the page itself, every same-origin file
its <script>, <link>, <img> and <source> tags name, and - transitively
- everything a stylesheet pulls in through url() or @import. Each file
is compressed with gzip at level 9 and the sizes are summed.

Gzip because that is what travels. The edge that serves this site
compresses text, so the bytes a visitor pays for are the compressed
ones; raw sizes
overstate this tree by a factor of three or four, and a ceiling built
on them would be a number with no relationship to anybody's experience
of the site. Level 9 is the closest a local run gets to what an edge
serves. gzip.compress is given mtime=0 so the same bytes measure the
same size on every run instead of carrying the clock into the header.

Third-party origins are outside the budget. index.html loads Telegram's
widget from telegram.org: a real transfer, and not one any change here
can make smaller, so counting it would move a ceiling whenever somebody
else shipped.

The stylesheet walk and the image tags are not in #80's wording, and
both are load-bearing. The approved ~140 KB of vendored fonts arrive
through @font-face in theme.css rather than through a <link> in the
head, and a page given warmth (#73) gets it partly in pictures - so a
budget reading only <script> and <link> would watch the two largest
payload changes of the whole redesign land and say nothing. The rule
this follows is AGENTS.md's review bar: attack the hazard the design
names, rather than check the criteria the specification lists.

Read as a limit rather than a proof. srcset and its descriptors, CSS
image-set(), a URL a script assembles at runtime, and anything a
third-party origin pulls in behind its own script are all outside what
static reading can reach. Those are stated here rather than left for
somebody to discover: a check believed to cover more than it does is
the failure mode this repository keeps paying for.

THE CEILINGS ARE NUMBERS
------------------------
CEILINGS pins one figure per page, in bytes, at roughly ten percent
above what that page measures today. Prose cannot do this job: "keep
the pages light" has never failed a build, and DESIGN.md carrying a
sentence about weight is what the gate is for instead.

Two arms, because a budget that only catches growth drifts upward until
it permits anything:

 - over the ceiling FAILS, naming the page, its total, the ceiling and
   the heaviest files inside it, so the fix is obvious without anybody
   rerunning the check to find out where the weight is. A change that
   adds weight on purpose RAISES the ceiling in the same diff. That is
   the whole mechanism: payload growth becomes a reviewed act instead
   of an accident.
 - a ceiling standing more than STALE_ABOVE over what its page measures
   FAILS too, as stale headroom. Without that arm one generous pin
   would let a page grow by half in silence, and a ceiling that outruns
   its page has stopped being a budget.

The second arm turns out to guard this check against itself, which is
worth more than the shrink case it was written for. Blinding the
extractor - the mutation that makes every other rule here pass while
measuring nothing - leaves five pages measuring their own HTML alone,
and five pins hundreds of percent above them. A growth-only budget
would have reported that as a very light site.

Ten percent of headroom against a twenty-five percent stale limit
leaves a fifteen-point band for ordinary drift. Part of that band pays
for something measured rather than assumed: THE SAME BYTES DO NOT GZIP
TO THE SAME SIZE ON EVERY MACHINE. Python 3.14 on Windows links
zlib-ng, the Ubuntu runner links stock zlib, and level 9 does not agree
between them.

HOW BIG THE GAP IS, AND WHY THE NUMBER IS NOT WRITTEN DOWN. It has
already moved once, by a lot, and in both senses. When these totals were
mostly text the two machines differed by whole percents; the vendored
woff2 faces then made nearly all of every total here already-compressed
bytes that gzip cannot move, and #181 took the comments out of what is
left, so the disagreement now lives in a small text share and the last
measurement put it under a tenth of a percent - with the local figure
coming out LARGER than CI's, which is the opposite of the direction this
file recorded when the totals were text. A number pinned in this prose
would be wrong again after the next payload change, so read the spread
instead of trusting a figure: run this check locally and read the same
table out of the gate log of CI's run for the same commit.

So a byte-exact budget is not available across the two machines that run
this gate, and the ceilings below are pinned against the LARGER of the
two figures - larger by comparison, never by which machine printed it.
That distinction is the whole of the instruction: "take the number CI
prints" was right when it was written, and the direction flip made it
silently wrong, which is how a pinning rule pins against the wrong side.
Measure both, pin the bigger. The 25% stale limit is what leaves room on
the other side.

WHAT THIS CHECK DOES NOT DO
---------------------------
It assumes references resolve. tools/check_web.py check 1 owns broken
references and reports them properly; a page naming a file that is not
there is refused here, with a pointer at that check, rather than
measured as though the file were empty - silently measuring a missing
file as zero would let a broken page look like a light one.

It says nothing about how fast any of this loads. Bytes are a proxy,
and the honest one: a request count, a render time or a Lighthouse
score all depend on a network and a machine, and a gate cannot have
either.

The page list is pinned rather than read off the directory, for the
reason CSP_PAGES in tools/check_web.py gives: a table derived from what
exists cannot fail when a page is added, and a page being added is
exactly when a budget gets forgotten.

WHERE THE HEADROOM IS NOT: UNUSED CSS
-------------------------------------
Written down because this is the first place somebody looks when a page
reads 94% of its ceiling, and because the answer is counter-intuitive
enough that it will otherwise be rediscovered at the cost of a day.

#80's unused-CSS cross-check has been run, against the redesigned pages
it was deferred for. Every top-level selector in apps/web/theme.css was
taken against the static markup of all five pages, against every class
and attribute the eleven scripts set at runtime, and against the SVG
apps/web/dashboard.js generates. THE WHOLE YIELD IS FOUR SELECTORS -
112 raw bytes, which is around twenty once gzipped, and gzipped is what
travels:

  input[type="password"] and its :hover pair - there is no password
  field anywhere in the app, and no reference to one. Sign-in is the
  Telegram widget plus a session token, and the admin key import is a
  textarea.

  body.wide:not(.railed) > *, twice - once at its rule and once in the
  52rem override. admin.html is the only page carrying `wide`, and it
  always carries `railed` beside it, so the combination this needs
  exists nowhere. Weaker than the password case, which rests on a total
  absence: a future page splitting the two would make this live again.

That is under a fiftieth of one percent of any ceiling here, and a
quarter of one percent of the tightest page's remaining headroom. It is
worth removing for tidiness and it is not a budget fix - a run of this
check prints the real figures either way, which is the point of printing
them. The weight on these pages is
the vendored woff2 faces and the scripts, both of which the comments
above account for by name, and the per-surface stylesheet split (#160)
is where the CSS bytes actually are - five pages paying for rules four
of them never match is a different quantity entirely from four rules
nobody matches.

AND DO NOT AUTOMATE THIS. A general dead-CSS pass over this tree, of the
kind that searches for each selector's name, deletes .series-0 through
.series-5 and their circle/text pairs - twelve of the most heavily
exercised rules in the stylesheet - and goes green on its own gate.
dashboard.js builds those names by concatenation rather than writing
them, so none of the six appears as a literal string in any file here.
Check 21 in tools/check_web.py now pins that coupling in both
directions, and it is the guard rail #160 needs before it moves any of
those rules; the trap is stated there in full.
"""

import gzip
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# dist/, not apps/web - #181. This check is the one place in the gate
# where the question is literally "how many bytes travel", so it has to
# read the bytes that travel: the generated site in dist/, with the
# design record taken out of the CSS and the scripts.
# Pointed at apps/web it would measure a tree nobody downloads and
# overstate every page by the weight of its own comments, which is 78%
# of theme.css.
#
# It is also why tools/check.py runs the build stage BEFORE this one. A
# stale dist/ makes every number here a fact about a site that is not
# being shipped, and a budget measuring the wrong tree is worse than no
# budget: it is a wrong answer with a table around it.
WEB = os.path.join(REPO, "dist")

# Gzipped bytes per page: the page plus everything it pulls in. Pinned
# at roughly HEADROOM above what each measures, taking the LARGER figure
# wherever the owner's machine and the CI runner disagree - whichever of
# them printed it. See the docstring on zlib-ng for why naming a machine
# there is the part that goes wrong.
#
# These live here, outside apps/web, and that is the point rather than
# an accident of layout. AGENTS.md, "The review bar": a check computed
# entirely from the file it guards cannot detect that the file was
# rearranged - something outside has to say what it may contain.
#
# Raising one is a normal act, and it is meant to be visible: it lands
# in the same diff as the weight it permits, where a reviewer sees the
# number move next to the reason it moved. These five moved for #81's
# fourth palette: theme.css carries a High contrast block, a
# prefers-contrast block, a --color-border-strong value in each palette
# and the reasoning behind the chosen series values, every page carries
# a fourth theme chip, and the stylesheet is in all five totals. That is
# +1.7 KB gzipped on each page, and it is the growth this arm exists to
# make somebody look at rather than the growth it exists to refuse.
#
# admin.html and your-page.html then moved again, and only those two,
# because they are the two pages that load apps/web/crypto.js and
# crypto.js carries a second stored format. Version 2 seals a
# submission to the keyholder and to the submitting member at once,
# which is a second encoder, a second derivation and a decoder that
# reads both - about 3.7 KB gzipped, on both pages equally. #85 is
# where the format and the reasons for it are.
#
# And then all five moved by about 94 KB, which is the payload this
# check was written to make somebody look at. #73's identity layer
# vendors five latin-subset woff2 faces into apps/web/fonts and reaches
# them from @font-face in theme.css, and the stylesheet is in all five
# totals: Playfair Display 600 and its italic at ~22.6 KB each, DM Sans
# 400 and 600 at ~13.8 KB each, JetBrains Mono 400 at ~20.7 KB. The
# owner approved that download by name and at about this size, on #73.
#
# Two things about that number belong here rather than in anybody's
# head. It is one payment for the whole site rather than five - the
# faces are one set of URLs, so the second page a visitor opens fetches
# none of them again, and this check deliberately cannot see a cache,
# which makes these five totals an overstatement of what a session
# costs. And woff2 is already compressed, so gzipping it here changes
# it by a few bytes either way: the machine-to-machine slack the
# docstring describes now applies to a much smaller share of each total
# than it did, because only the text part of each page moves between
# zlib-ng and stock zlib.
#
# admin.html alone then carries a further +3 KB gzipped for #70: the
# export page keeps its imported key as a non-extractable CryptoKey in
# IndexedDB, which is an open-read-write-delete layer, a verdict on what
# it finds there, and the copy that tells the keyholder what storing it
# does and does not buy. Its pin absorbs that without moving, and that is
# a fact worth stating rather than a coincidence to lean on: the fonts
# above are the reason there is room, so the next few kilobytes of script
# on this page are the ones that will need the number raised.
#
# That page came due immediately. All five moved again for #73's layout
# shell, and this is the diff the sentence above was written for:
#
#   404.html        114,021 -> 116,276   (+2.0%)
#   admin.html      165,495 -> 172,683   (+4.3%)
#   charts.html     138,255 -> 145,435   (+5.2%)
#   index.html      119,494 -> 122,401   (+2.4%)
#   your-page.html  148,875 -> 155,656   (+4.6%)
#
# Two sources, and they land differently. That diff put the rail, the
# mobile strip, an entrance animation, the runner and a --color-gold per
# palette into theme.css, and the stylesheet is in all five totals -
# which is the whole of what 404.html and index.html paid, and they paid
# it while LOSING a file each, because a plain page loads no nav.js. The
# three rail pages additionally carry the rail markup itself and
# apps/web/signout.js, which is why they moved twice as far.
#
# Every ceiling is re-pinned at HEADROOM over what its page measures
# now, rather than only the three that would have failed. Leaving the
# other two at their old numbers would have parked them at 91% of a pin
# nobody had looked at, and the stale arm exists precisely because a
# ceiling that has stopped tracking its page has stopped being a budget.
#
# admin.html is the one to watch. It sat at 98% of its old ceiling on
# this machine BEFORE that re-pin, against a machine-to-machine gap the
# docstring then measured in whole percents - so the number was one CI
# run away from failing on bytes nobody had added since. That is the
# case for re-pinning against the measurement rather than against
# whichever pin happens to still be clear, and it survives the gap
# having shrunk: the argument is about tracking the page, not about how
# wide the noise band happened to be that week.
#
# The per-page structural pass (#68/#127) moves all five again, and by
# less than the shell did - gzipped, on this machine:
#
#   404.html        116,455 -> 119,092   (+2.3%)
#   admin.html      172,866 -> 175,925   (+1.8%)
#   charts.html     145,616 -> 148,149   (+1.7%)
#   index.html      122,580 -> 125,129   (+2.1%)
#   your-page.html  155,819 -> 159,263   (+2.2%)
#
# One source this time, and it is why the five numbers are so alike:
# theme.css is in every total and carries all of it - three label
# components where there was one, the control chassis and the tab strip
# the owner asked for, and the instrument surface. The markup itself is
# roughly a wash. your-page.html deletes four card wrappers and gains the
# comments explaining why; admin.html gains a nameplate and loses a
# label. A page whose HTML barely moves still pays for a stylesheet that
# did, and that is the shape to expect from any component work here.
#
# Re-pinned at HEADROOM against the new measurement, all five again and
# for the reason above: 93% of a pin is not a failure, but at the time
# it was within the machine-to-machine gap of being one, and a ceiling
# nobody re-pinned is a ceiling that stopped tracking its page.
#
# And then all five fall, which is the first time these numbers have
# moved DOWN. #181 ships the site from dist/ - apps/web with the comments
# taken out of the CSS and the scripts - and this table now measures that
# tree instead of the source:
#
#   404.html        120,715 -> 103,072   (-14.6%)
#   admin.html      190,882 -> 136,112   (-28.7%)
#   charts.html     154,823 -> 118,143   (-23.7%)
#   index.html      130,088 -> 108,535   (-16.6%)
#   your-page.html  162,154 -> 125,594   (-22.5%)
#
# admin.html is the page that needed it. It stood at 99% of its ceiling
# after #69's membership pane landed - one ordinary card away from a
# failing gate on a page nobody had made heavier since.
#
# theme.css alone accounts for 16,021 B of every one of those, because it
# is in all five totals and 78% of it was prose. admin.html and
# charts.html take the rest from dashboard.js, admin.js and crypto.js,
# which are the heavily-reasoned files.
#
# Nothing was deleted to get this. The comments are still in apps/web,
# where they are read and edited; what changed is that they are no longer
# sent to a browser that cannot use them. That distinction is the whole
# of #181 and it is why the route #80 measured (deleting four dead
# selectors, 19 B) and the route #160 measured (a per-surface split, 3-7
# KB and a gzip-dictionary penalty that made admin.html heavier) were
# both correctly refused.
#
# Re-pinned at HEADROOM against the new measurement, all five, for the
# reason every earlier re-pin gives: the stale arm exists precisely so a
# ceiling that has stopped tracking its page fails. Leaving these at
# their old numbers would have parked every page at 63-79% of a pin
# nobody had looked at, which is what that arm is written to refuse.
CEILINGS = {
    "404.html": 113400,
    "admin.html": 144900,
    "charts.html": 130000,
    "index.html": 119400,
    # 138200 -> 142200. The owner's reviewed act, 2026-08-09 evening,
    # taken on a decision question with the measurements in front of it
    # and recorded on #85 at close. THIS IS THE FIRST CEILING THIS
    # SYSTEM HAS MOVED, and this diff is the record of it, which is the
    # mechanism working rather than an exception to it: growth becomes a
    # reviewed act instead of an accident, and here it was reviewed by
    # the person whose budget it is.
    #
    # The page gained the personal history pane by owner order (#85's
    # member-held keys), so the budget for what the page does moved with
    # what the page does. It is not a page that grew by drift.
    #
    # The number was chosen against the one hazard a local measurement
    # cannot see. At 138200 the page measured 1.47% clear, against the
    # whole-percent machine-to-machine variance this file documented at
    # the time - so the margin read as inside the noise of the two
    # machines that run this gate, and a green local run would not have
    # predicted the runner.
    #
    # That variance has since been re-measured far smaller (see the
    # docstring), which means the headroom bought here is wider than the
    # hazard it was bought against. THE CEILING IS NOT REVISITED ON THAT
    # BASIS. It is the owner's reviewed act on a decision question, not a
    # figure derived from the variance, and STALE_ABOVE is what polices
    # it from the other direction if the page ever stops earning it.
    #
    # Rejected in the same decision, and recorded so they are not
    # re-proposed as savings nobody considered: stripping the wordmark
    # face's OpenType layout would free about 3.5 KB and land 404.html
    # within a few dozen bytes of the stale-headroom floor below - run
    # this check and take 3532 off 404.html's total to see the margin
    # today, because it moves with every change to that page. It
    # relocates the risk onto the other arm of this same check rather
    # than removing it. Subsetting the mono face is real and larger, and
    # is a slice of its own rather than a thing to fold into a feature.
    #
    # The standing no-ceiling-moves ruling on #85 is superseded FOR THIS
    # ONE CEILING by the owner personally. Every other pin here stands,
    # and STALE_ABOVE still polices this one from the other direction -
    # a ceiling that outruns its page fails whoever raised it.
    "your-page.html": 142200,
}

# What a fresh pin gets: about ten percent of room to grow into. Large
# enough that reformatting a page does not fail a build, and small
# enough that a page cannot double behind it.
#
# It is a proportion rather than a byte count, and now that the fonts
# are in the totals that cuts the other way too: ten percent of the
# lightest page is over 12 KB, which is a whole sixth face. A budget
# cannot notice growth smaller than its own headroom - what it can do
# is refuse growth nobody wrote a reason for, which is the arm below.
HEADROOM = 1.10

# How far a ceiling may stand above its page before the pin itself is
# the problem. A quarter is deliberately looser than HEADROOM: the gap
# between them is the band where ordinary editing lives, and a limit
# equal to the headroom would fail every pin the day after it was
# written.
STALE_ABOVE = 1.25

# How many of the heaviest files a failure names. Three is enough to
# point at the cause without turning the message into a directory
# listing.
WORST = 3

# Anything that is not a same-origin path: a scheme, a
# protocol-relative host, an inline payload, a mail link, a fragment.
EXTERNAL = re.compile(r"^(?:[a-z][a-z0-9+.-]*:)?//|^[a-z]+:|^#", re.I)

# <link> rel values the browser fetches no file for. Everything else
# counts, and the default direction matters: an unknown rel that does
# transfer must land in the total rather than slip out of it, because
# a budget that under-counts reports a page as light while the visitor
# pays for the rest. preload and modulepreload - the shapes a redesign
# reaches for - are transfers and are absent from this set on purpose.
NON_TRANSFER_RELS = frozenset({
    "canonical", "alternate", "dns-prefetch", "preconnect", "author",
    "license", "help", "next", "prev", "search", "bookmark", "nofollow",
})

TAG = re.compile(r"<(script|link|img|source)\b[^>]*>", re.I)

# Tags whose transfer is named by src. <link> is the odd one out - it
# uses href, and href on an anchor is a navigation rather than a
# payload, which is why the tag set above is a list and not "anything
# with a URL in it".
SRC_TAGS = frozenset({"script", "img", "source"})
STYLE_IMPORT = re.compile(r"""@import\s+["']([^"']+)["']""", re.I)
STYLE_URL = re.compile(r"""url\(\s*["']?([^"')]+)["']?\s*\)""", re.I)


def attribute(tag, name):
    """One quoted attribute value out of a tag, or None.

    Both quote styles, because HTML accepts either and a check that
    reads one of them reports a page as referencing nothing the moment
    somebody writes the other.
    """
    for quote in ('"', "'"):
        found = re.search(r"\b%s\s*=\s*%s([^%s]*)%s"
                          % (name, quote, quote, quote), tag, re.I)
        if found:
            return found.group(1)
    return None


def local_target(value):
    """A same-origin path out of one attribute value, or None.

    A leading "/" is site-root-relative and apps/web is the site root -
    nothing above it is ever published - so a rooted path names the
    same file a bare name does. A path climbing
    out of the directory is refused rather than resolved: nothing above
    apps/web is published, so it cannot be a transfer this site makes.
    """
    if not value:
        return None
    value = value.strip()
    if not value or EXTERNAL.match(value):
        return None
    value = value.split("?", 1)[0].split("#", 1)[0]
    value = value.lstrip("/")
    if not value or ".." in value.split("/"):
        return None
    return value


def page_references(text):
    """Same-origin files one HTML document's tags name, in order.

    Comments go first: a tag somebody commented out is not a request,
    and budgeting for bytes nobody downloads makes the ceiling wrong in
    the direction that hides growth. Duplicates collapse because the
    browser fetches each URL once.
    """
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    found = []
    for tag in TAG.finditer(text):
        markup = tag.group(0)
        if tag.group(1).lower() in SRC_TAGS:
            target = attribute(markup, "src")
        else:
            rel = (attribute(markup, "rel") or "").lower().split()
            if any(word in NON_TRANSFER_RELS for word in rel):
                continue
            target = attribute(markup, "href")
        target = local_target(target)
        if target and target not in found:
            found.append(target)
    return found


def style_references(text):
    """Same-origin files one stylesheet pulls in, in order.

    Comments go first for the same reason they do in an HTML page, and
    it is not hypothetical here: a stylesheet under construction keeps
    the shape it is heading for in a comment.
    """
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    found = []
    for pattern in (STYLE_IMPORT, STYLE_URL):
        for match in pattern.finditer(text):
            target = local_target(match.group(1))
            if target and target not in found:
                found.append(target)
    return found


def gzipped_size(path):
    """What one file costs on the wire, gzip level 9.

    mtime=0 keeps the header constant, so the same bytes measure the
    same size on every run of the same interpreter - a timestamp in the
    output would make the numbers wobble for a reason that has nothing
    to do with the site.

    Across interpreters they still wobble, because zlib-ng and stock
    zlib do not agree at level 9. The docstring has the measurements
    and what the ceilings do about it; the short version is that this
    number is a good measure of the site and a poor one of the
    machine, so nothing here may be pinned tighter than a few percent.
    """
    with open(path, "rb") as handle:
        return len(gzip.compress(handle.read(), 9, mtime=0))


def html_pages():
    return sorted(name for name in os.listdir(WEB)
                  if name.endswith(".html"))


def page_parts(page):
    """([(file, gzipped bytes)], [missing file]) for one page.

    A worklist rather than a single pass over the HTML, because a
    stylesheet can name a font and that font is a transfer the visitor
    pays for just as surely as a script tag is.
    """
    queue = [page]
    seen = {page}
    parts = []
    missing = []
    while queue:
        target = queue.pop(0)
        path = os.path.join(WEB, *target.split("/"))
        if not os.path.isfile(path):
            missing.append(target)
            continue
        parts.append((target, gzipped_size(path)))

        extension = os.path.splitext(target)[1].lower()
        if extension in (".html", ".htm"):
            children = page_references(read_text(path))
        elif extension == ".css":
            children = style_references(read_text(path))
        else:
            children = []
        for child in children:
            if child not in seen:
                seen.add(child)
                queue.append(child)
    return parts, missing


def read_text(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def measure():
    """({page: [(file, bytes)]}, [problem]) for the tree as it stands."""
    measured = {}
    problems = []
    for page in html_pages():
        parts, missing = page_parts(page)
        measured[page] = parts
        for target in missing:
            problems.append(
                "%s references %s, which does not exist, so this page's "
                "transfer size cannot be measured. Broken references are "
                "tools/check_web.py check 1's to report - fix that first"
                % (page, target))
    return measured, problems


def human(count):
    """A byte count in both units a person compares things in."""
    return "%s B (%.1f KB)" % (format(count, ","), count / 1024.0)


def heaviest(parts):
    """The WORST largest files in one page, as readable text."""
    ordered = sorted(parts, key=lambda part: (-part[1], part[0]))
    return ", ".join("%s %s" % (target, human(size))
                     for target, size in ordered[:WORST])


def budget_problems(measured, ceilings):
    """[problem] for measured pages held against pinned ceilings.

    Pure, over a found-set, so both arms can be exercised without
    editing the published tree this check measures - which since #181
    is dist/, and editing that by hand fails the build stage above.
    """
    problems = []

    for page in sorted(set(measured) - set(ceilings)):
        total = sum(size for _target, size in measured[page])
        problems.append(
            "%s has no pinned transfer budget. Add one to CEILINGS in "
            "tools/check_budget.py - about %s, which is the %s it "
            "measures plus the usual headroom - so the next change to "
            "this page has a number to fail against"
            % (page, human(int(total * HEADROOM)), human(total)))

    for page in sorted(set(ceilings) - set(measured)):
        problems.append(
            "CEILINGS pins %s, which is not a page in apps/web. Delete "
            "the entry, or restore the page it was written for - a pin "
            "with no page behind it is a check that cannot fail" % page)

    for page in sorted(set(measured) & set(ceilings)):
        parts = measured[page]
        total = sum(size for _target, size in parts)
        ceiling = ceilings[page]

        # A page that measures nothing has already been reported by
        # measure(), and dividing by it below would turn that into a
        # traceback instead of a message.
        if not total:
            continue

        if total > ceiling:
            problems.append(
                "%s transfers %s gzipped, over its ceiling of %s by %s. "
                "Heaviest: %s. If the weight is intended, raise the "
                "ceiling in this same change - growth nobody reviewed is "
                "the failure this check exists for"
                % (page, human(total), human(ceiling),
                   human(total - ceiling), heaviest(parts)))
        elif ceiling > total * STALE_ABOVE:
            problems.append(
                "%s is pinned at %s and transfers %s - %d%% above what "
                "it measures, past the %d%% of stale headroom allowed. "
                "Lower the ceiling to about %s. A ceiling that outruns "
                "its page has stopped being a budget: this one would let "
                "the page grow by half and still pass"
                % (page, human(ceiling), human(total),
                   round((ceiling / float(total) - 1) * 100),
                   round((STALE_ABOVE - 1) * 100),
                   human(int(total * HEADROOM))))

    return problems


def problems():
    """Every problem in the tree as it stands."""
    measured, found = measure()
    found.extend(budget_problems(measured, CEILINGS))
    return found


def main():
    measured, issues = measure()
    if not measured:
        issues.append(
            "apps/web holds no HTML pages, so this check read nothing. A "
            "gate that measures an empty set reports success for a run "
            "that verified nothing")
    issues.extend(budget_problems(measured, CEILINGS))

    if issues:
        for issue in issues:
            print("::error::%s" % issue)
        print("\ncheck_budget FAILED %d check(s)" % len(issues))
        return 1

    # The measured figures are printed rather than a bare "ok", so the
    # gate's output carries the real numbers. A line saying every page
    # is within budget is equally true of a run that measured nothing.
    print("check_budget: every page within its pinned transfer budget "
          "(gzip -9, page plus everything it references).\n")
    width = max(len(page) for page in measured)
    for page in sorted(measured):
        total = sum(size for _target, size in measured[page])
        ceiling = CEILINGS[page]
        print("  %-*s %8s / %8s B   %3d%% of ceiling, %2d file(s)"
              % (width, page, format(total, ","), format(ceiling, ","),
                 round(total * 100.0 / ceiling), len(measured[page])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
