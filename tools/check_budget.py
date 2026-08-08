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

Gzip because that is what travels. GitHub Pages serves text compressed,
so the bytes a visitor pays for are the compressed ones; raw sizes
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
leaves a fifteen-point band for ordinary drift. Most of that band is
spent on something measured rather than assumed: THE SAME BYTES DO NOT
GZIP TO THE SAME SIZE ON EVERY MACHINE. Python 3.14 on Windows links
zlib-ng, the Ubuntu runner links stock zlib, and at level 9 zlib-ng
compresses this tree 0.8% to 4.3% smaller - 404.html is 12,979 B on the
owner's machine and 13,543 B in CI (run 31255416749).

So a byte-exact budget is not available across the two machines that
run this gate, and the ceilings below are pinned against the LARGER of
the two figures. Pin a new one the same way: take the number CI prints
if the two disagree, or the gate passes locally and fails on the
runner. The 25% stale limit is what leaves room in the other
direction - the machine that measures ~4% lower still sits well inside
it.

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
"""

import gzip
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(REPO, "apps", "web")

# Gzipped bytes per page: the page plus everything it pulls in. Pinned
# at roughly HEADROOM above what each measures, taking the CI runner's
# figure wherever it and the owner's machine disagree - see the
# docstring on zlib-ng.
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
# admin.html and submit.html then moved again, and only those two,
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
CEILINGS = {
    "404.html": 125500,
    "admin.html": 177100,
    "dashboard.html": 152200,
    "index.html": 131500,
    "submit.html": 163900,
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
    the deploy job copies that directory and nothing above it - so a
    rooted path names the same file a bare name does. A path climbing
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
    editing a file that is copied verbatim to the published site.
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
