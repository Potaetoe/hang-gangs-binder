#!/usr/bin/env python3
"""
Check that apps/web is internally consistent and safe to publish.

    python tools/check_web.py

Derived from what is actually in the directory rather than from a
hand-maintained list, because a hand-maintained list only knows about
files somebody remembered to add to it.

The checks, numbered - the count is the list rather than a sentence
above it, because a number in prose is the thing that goes stale on the
day a check is added:

1. Every local href/src in the HTML resolves to a file that exists. A
   rename that misses one reference publishes a page that 404s its own
   stylesheet and renders a dead form.

2. Nothing in apps/web looks like a private key. This is the one that
   matters. The whole design rests on the private key never being
   published, and apps/web is copied verbatim to a public site - so the
   moment a key lands in that directory it is public, permanently, in
   the git history as well as on the web. A regex is a weak guard, but
   it catches the realistic accidents: pasting a key into config.js
   "just to test the export locally" and forgetting, and - now that
   tools/keygen.html exists - pasting the whole key file into config.js
   when only the publicKey line belongs there. The generator hands over
   two things at once, a few centimetres apart on screen, and only one
   of them may be published.

   The Telegram bot token is the same kind of secret with a different
   shape. The realistic accident is pasting it into the sign-in page to
   make a local widget test work, so that shape is refused here too.

3. Every page carries the shared head: charset, viewport, title, the
   content security policy, the stylesheet and the pre-paint theme
   script. The pages still to be written - admin.html and the form -
   are the ones that handle plaintext and keys, so "I copied the old
   page and trimmed the head" is exactly the mistake worth catching
   automatically rather than at review.

4. Every endpoint arm in config.js is permitted by the CSP of every page
   that loads config.js. These files must agree, and they fail apart
   silently: change an endpoint alone and the page still looks right but
   the browser drops every request at connect-src.

5. Every environment in config.js has a real, distinct P-256 public key
   and a distinct endpoint. The production arm must be keyed by the
   deployed hostname, both loopback names must select development, and
   an unknown hostname must not fall back to production. This catches
   the dangerous half-finished copy-and-paste: a local preview that
   quietly encrypts to or writes into the live environment.

   Distinctness alone was not enough, and the gap is worth recording
   because the specification that produced it read as though it were.
   archive/REDESIGN.md asked for "no two arms share an endpoint or a public
   key", which catches an arm copied *over* another - and passes
   cleanly when the two are *swapped*, because swapped arms are still
   distinct. DESIGN.md names that exact failure one paragraph before
   prescribing the check: "production shipping the development
   endpoint, or the development public key. Neither throws."

   Confirmed by mutation before this was written: exchanging the two
   publicKey values left the whole gate green. The endpoint half of
   that swap fails loudly at runtime, since each Worker refuses the
   other's origin - but the key half is silent and unrecoverable.
   Production rows seal to a key the keyholder does not hold, the
   export lists them down the rotated-key path, and nothing can turn
   plaintext back into ciphertext.

   So production's key and endpoint are pinned to their literal values
   below rather than merely required to differ from development's. A
   value that cannot be recomputed from the file it guards is the only
   kind that catches a swap - the same reason dev/fixture.json is a
   committed constant rather than something the suite regenerates.

   Check 5 also holds the shape of the assignment, because the object it
   resolves carries that key at runtime. BINDER_CONFIG is locked
   non-writable and non-configurable, so a script cannot point the global
   at its own object between the moment form.js captures it and the moment
   it reads the key. The freeze that stops the resolved arm's own members
   from being mutated is the export roster's to enforce (check 15); this
   pin is the half a freeze rule reading assignments cannot see.

6. Nothing *sends a submission* to the network except through crypto.js.
   This is the design's one rule restated as something a machine can check:
   submission plaintext never leaves the browser. A named exemption records
   the one other body the site sends: auth.js forwards a sign-in payload and
   must run on the page that deliberately does not load crypto.js. Every
   other sender must name BinderCrypto, and every page loading one must
   actually load crypto.js.

   Sending, not touching. An earlier version of this check counted any
   fetch at all, which was right while every page here either submitted
   or exported, and became wrong the day dashboard.html arrived: that
   page only reads an aggregate that was published on purpose, sends
   nothing, and deliberately does not load crypto.js so that it cannot
   be talked into decrypting anything. Holding a read-only page to a
   rule about sending would have meant either loading decryption onto a
   page with no use for it, or turning the check off.

   It cannot prove the encryption is *used* - only that the pieces are
   present. A submit handler that posts the form fields and never calls
   encrypt would pass. That failure is loud in review and in the
   round-trip test; this catches the quiet one, which is a page wired
   to the endpoint with no encryption on it at all.

7. The stylesheet honours the hidden attribute. Every piece of this
   site that appears and disappears - the two unit groups, the "not
   open" notice, the success card, each field error - does it by
   setting `hidden` in JavaScript. The browser's own rule for that is
   `display: none` at the weakest specificity there is, so any
   component that sets display beats it: .card and .stack both set
   `flex`, and did, and the published form showed both unit systems at
   once alongside a "thanks for submitting" card nobody had earned.

   Nothing about that fails loudly. The JavaScript is correct, the
   attribute is set, the DOM inspector agrees the element is hidden,
   and reading `element.hidden` returns true - it is only the rendering
   that disagrees. So the one line the whole visibility model rests on
   is checked here rather than trusted.

8. The form's checked units radio and its visible field group agree.
   The site defaults to imperial, and that default is written down in
   two places that must match: which radio carries `checked`, and which
   of the two field groups carries `hidden`.

   applyUnits() reconciles them at DOMContentLoaded, which is what makes
   a mismatch so easy to miss - by the time anyone looks, the page is
   right. But the browser paints the markup before that runs, so a
   disagreement shows the wrong pair of boxes for a frame, and the boxes
   it shows are the ones somebody starts typing into. Worse, both groups
   visible at once is the exact rendering that shipped on 2026-08-04 for
   the different reason check 7 now guards.

9. Every promoted country code names a real country. The dropdown puts
   a short block at the top, listed in countries.js as ISO codes, and
   form.js skips any code it cannot find a name for - which is the right
   behavior on a live page and the reason a typo would be invisible.
   The country simply would not be in the promoted block, and the only
   way to notice is to know it should have been there.

10. Every page carries the shell it is pinned to carry, and the rail
    pages carry the same one. The destinations are written out in each
    page's HTML rather than built by nav.js, so that a script failure
    cannot strand somebody on a page with no way off it. The cost of
    that choice is the same list written several times, and copies of
    anything drift - a page added later gets its rail copied from
    whichever page was open, and a link added to one page is missing
    from the others.

    Which shell each page carries is pinned in SHELLS, outside the
    markup, for the reason CSP_PAGES gives: a table derived from what
    exists cannot fail when a page is added, and a page being added is
    exactly when somebody copies a shell from whichever page they had
    open. A published page missing from that table FAILS, and a table
    naming a page that does not exist FAILS as stale.

    Two shells, because the site has two kinds of page and one rule
    could not describe both:

    - RAIL. The signed-in pages. Each carries the wordmark, the same
      destinations in the same order, and the session home at the
      bottom. Compared against each other and failing if they differ.
      The Theme disclosure is NOT part of this shell any more and is
      check 19's, because the sign-in page carries one without a rail.
    - PLAIN. The pages a signed-out visitor meets - the cover, which
      the owner decided carries no rail before sign-in, and the error
      page, which goes plain on principle. These must NOT carry rail
      markup, which is the copy-paste direction: a session home on the
      cover would offer Sign out to somebody who has not signed in.

    The anti-stranding rule survives both shells rather than being
    spent on the rail. A rail aside must carry the route to the
    directory index somewhere - since #187 that is the wordmark and
    the session block rather than a destination entry, because the
    door is session state and not navigation, and a Sign in entry
    among the destinations is refused in the same breath. And a plain
    page must still carry at least one local link out of itself, in
    its own HTML, which is what stops "plain" from becoming "a dead
    end with nice typography".

    The wordmark is the shell's other hand-kept copy, and it crosses
    both shells - three rails and the sign-in cover - which is half of
    why nothing was comparing it. The paragraph above says the rail
    "carries the wordmark" while the comparison reads .rail-links and
    stops; the name tables read titles, headings and rail entries; the
    chip arm reads chips. So the site's own name could be renamed on
    three copies of four with the whole gate green, which is #152's
    disease with a different subject. WORDMARK_PAGES pins which pages
    carry one, outside the markup and in both directions, for the
    reason SHELLS gives - and the copy-paste direction has the teeth
    here too: a page carrying the site's name and named by no pin is a
    copy nothing compares. Agreement is the claim and the WORDS are
    not, for the reason check 23 gives about a chip's label: what the
    wordmark says is the owner's to rule, and #191 is where it is
    ruled.

11. The sign-in page must not load crypto.js. It is the only page allowed
    to load Telegram's third-party script, and keeping submission plaintext
    and the private key off that page limits what the trusted widget can
    reach. The page still holds the session after sign-in.

12. No page except the sign-in page may name telegram.org or unsafe-eval
    in its CSP. This catches a copied head quietly spreading the exception
    to a page that holds plaintext.

13. Every page's *whole* CSP is the pinned one - every directive, every
    source, on every page. Checks 11 and 12 pinned two directives on one
    page, which left default-src alone, and default-src governs every
    directive a page does not set explicitly - object-src among them. So
    a page could widen everything it had not named and nothing here
    would say so.

    The pin is a baseline plus declared deviations, each deviation
    carrying its reason, and the pages it covers are listed rather than
    read off the directory. Both of those are load-bearing. A table
    derived from what exists cannot fail when a page is added, and
    adding a page is exactly when somebody copies a head from whichever
    page they had open.

    All of this runs through one parser, and the parser reports rather
    than skips. That is the actual lesson of #34: the old searches
    matched http-equiv and then content within a tag, HTML does not care
    about attribute order, and a miss made every CSP check silently pass
    while check 3 still saw the marker. Two hazards were produced with
    the gate green. Every mutation ever written against these rules had
    passed, because a mutation exercises the rule and never the parser
    that has to find the policy first - which is why check_web.py now
    has a suite of its own in dev/check_web.test.py.

14. No file except config.js carries a base64 key-shaped literal. Check 2
    is about private keys and every one of its patterns targets a private
    shape - a PEM block, an assigned private_key, a JWK's "d" member. A
    raw public key matches none of them, and it should not in general:
    publishing a public key is what a public key is for, and config.js
    legitimately carries two.

    What makes a public key dangerous is being written down somewhere
    that cannot rotate. submit.html displays the first 32 characters of
    BINDER_CONFIG.publicKey so the group can compare it against the
    fingerprint published out-of-band in #29, and the entire mechanism
    rests on that value being derived at runtime from the key actually in
    use. Paste a literal there - a fingerprint, or a whole key "just to
    check the layout" - and every behavioral test still passes on the day
    it is written. After a rotation the page confidently certifies a key
    it is no longer encrypting to, and an anchor that vouches for the
    wrong key is worse than no anchor.

    So this is the same shape as check 5: the value belongs in one file
    and nowhere else, and something outside that file has to say so. A
    check computed entirely from the file it guards cannot detect that
    the file's contents were rearranged - which is the lesson #34 paid
    for.

    This assertion belongs here rather than in dev/ui.test.mjs, where an
    interim version guarded one named page: a page suite cannot own a
    repository-wide boundary, and two checks making the same claim in
    different files is how one of them gets quietly weakened.

15. Every module's exported namespace is frozen, and the roster of which
    module publishes which namespace is pinned here rather than read off
    the directory.

    AGENTS.md, "Code standards": "Exported objects are frozen, so a page
    cannot quietly redefine a helper another page depends on." That was
    a sentence in a document and nothing else. Four of the nine modules
    broke it, and the three that complied appear to have complied
    because they were written after the rule was stated - so the count
    drifted every time a module was added, and each rediscovery of the
    drift produced a fresh hand-written list that was wrong again by the
    time anyone read it. The list in #114 named admin.js:203 after the
    line had moved to 287, and omitted signout.js entirely because that
    module was written after the list was.

    A roster is what ends that, and it has to fail in BOTH directions to
    be worth having. A module in MODULE_EXPORTS that assigns nothing is
    reported as *absence* - that case is indistinguishable, to a checker
    that merely scans for unfrozen assignments, from a directory with
    nothing wrong in it, and #34 is what this repository paid to learn
    the difference. A script that assigns a global while claiming to
    publish none fails the other way.

    Two rules beyond "the assignment says Object.freeze", because that
    criterion alone does not reach the threat:

    - The namespace must be assigned exactly once. Two publish sites for
      one object is a freeze that covers whichever of them ran last.
    - Nothing may assign a MEMBER of the namespace after it is
      published. dashboard.js did exactly that: it built its literal,
      published it, and then bolted `render` on 424 lines later, past
      the document guard. A freeze at the assignment cannot cover a
      member added afterwards - it would throw there instead - so the
      object every page holds a reference to stays editable for as long
      as the module is still running, which is precisely the quiet edit
      the rule exists to remove. Build the whole object, then freeze
      once.

    The patterns recognize `window.` and `self.` alongside `root.` and
    `globalThis.`, and that is not defensive padding: countries.js
    genuinely publishes through `window.`, so a checker that knew only
    the two spellings its authors happened to use would have been blind
    to an entire export style already in this directory.

16. Every small label above a block declares which of three jobs it is
    doing, and the stylesheet can tell those three apart. #68 counted one
    component used 24 times for at least four different jobs - a section's
    name, an outcome, a warning, an instruction - and the finding is that
    a token meaning four things carries none of them: `Received` and
    `Unavailable` are outcomes and must not look like `Optional`, which is
    a category.

    The inventory is keyed by the label's words rather than by page, so a
    phrase cannot mean one thing here and another there, and both
    directions fail. The point of the missing-entry direction is not
    tidiness: it makes "what job is this doing?" a question somebody has
    to answer before a new label ships, which is the question nothing
    asked while the old component grew.

    The markup half cannot live in theme.css, because the drift happens
    in the pages - a new status wearing the section-name component looks
    right in a diff and reads as a section forever after. The stylesheet
    half cannot live in the pages, because three roles painted one color
    are one component with three names. So the table names the roles from
    outside both files, and each file answers for its own half.

    THE LIMIT, stated because this arm reads as though it had none. What
    it enforces is that the question gets asked; it cannot check the
    answer. A fourth job arriving as a NEW component - `.notice` above a
    block - is not a role, so nothing here sees it at all; and a fourth
    job filed under the nearest of these three passes cleanly, because a
    label declaring itself a `flag` is taken at its word. Both are the
    original overload arriving by a route the inventory does not watch.
    What this buys is that neither can happen silently in the pages that
    already exist: the entry has to be written, and writing it is where
    somebody says out loud what the label is for. Catching a wrong
    answer is the review bar's job, and AGENTS.md says so.

17. Every destination answers to one name, and the nav, the title and
    the heading all use it. #127 inventoried the drift and gave the
    motivating example: the admin page was called Export, which is what
    its first single job was, long after it had grown decryption, row
    deletion, publishing and charts. That is a falsified label in exactly
    the sense the comment ratchet polices for prose.

    The name is pinned outside the markup because it is written in eight
    places for four pages - three hand-copied rails, a title and a
    heading - and a rename that reaches seven of them is not visible from
    any one file. Checking the heading and the title as well as the rails
    is the half rail parity cannot reach: three rails can agree with each
    other and still disagree with the page they open.

18. Each page says which surface it belongs to, and carries that
    surface's clothes and no other. The owner's decision on #73 is that
    admin.html is an instrument panel - deliberately cooler than the
    member pages, and visibly labeled as the admin surface - so a reader
    never has to infer from the content which one they are looking at.

    Pinned outside the markup for the reason check 10's shell table
    gives, and the arm worth having is the same copy-paste direction: a
    page built by copying admin.html keeps its clothes, and a member page
    announcing itself as the admin surface is a page somebody stops
    trusting.

19. Every page that offers a palette carries the Theme disclosure, and
    every page that does not carries no chip at all. The owner's ruling
    on #150 is that this is ONE control at every width, and that the
    sign-in page gets it too - so it stopped being a fact about the rail
    the moment a page with no rail started carrying it, and check 10 is
    no longer a place that could state it.

    Which pages offer it is pinned in THEMED_PAGES, outside the markup,
    for the reason SHELLS and CSP_PAGES give. The absent direction is
    the one that would otherwise have nothing watching it: 404.html is
    the one page here with no palette control, that is deliberate, and a
    chip arriving on it by the usual route - somebody copying a page
    that has one - would change a stored preference from an error page
    and fail nothing.

    What it pins is presence, on purpose. Whether the four copies agree
    about a chip's LABEL is #152's, and two checks making the same claim
    in different places is how one of them gets quietly weakened.

20. A width block that turns `body.railed` into a flex column states
    its own `align-items`, and states `align-self` on `.rail`, rather
    than letting the grid rule's `start` through. On the grid that
    declaration addresses the block axis; in a flex column the same
    word addresses the inline axis, so inheriting it sizes the page
    column to its own content instead of to the screen and the widest
    page scrolls sideways (#148).

    It pins the declaration, not the render - this gate has no layout
    engine and #75 rejected jsdom for that. The long note above the
    check says what that does and does not buy, and why the branch is
    found by what it does rather than by its breakpoint.

21. The number of chart series slots is one number, and it is written in
    three places that must agree: the .series-N rules in theme.css, the
    --color-series-N set in every palette, and the cycle length
    dashboard.js divides by when it picks a slot.

    This is the guard rail #80's unused-CSS cross-check asked for, and
    the reason that cross-check does not ship as a general dead-CSS
    tool. dashboard.js names no series class anywhere. It BUILDS them:

        const cls = "chart-series series-" + (index % 6);

    and hangs the result on a <polyline>, a <circle> and a <text>. So a
    plain search of this repository for "series-0" finds nothing, in any
    file, while those twelve selectors are the most heavily exercised
    chart rules in the stylesheet - every line, dot and end-label on the
    weight-over-time chart wears one. A checker that harvests unused CSS
    by looking for literal strings deletes all twelve and goes green.
    THAT is the hazard here, and it is why the arm below is a pin on the
    coupling rather than a search for orphans.

    Both directions, and neither is loud on its own:

    - a slot the stylesheet does not define paints a line with an unset
      custom property, which is a line drawn in the inherited color -
      two people's histories rendered as one color, on a chart whose
      whole job is telling them apart.
    - a slot nothing ever selects is a rule that renders never, which is
      the orphan the cross-check was looking for in the first place.
    - a palette carrying fewer slots than the others fails the same way
      as the first case, on that palette only. A fifth palette is a live
      prospect (#82), and it arrives by copying a block that already has
      six values in it - so the direction to watch is a copy that got
      trimmed, on a theme nobody had open.

    dashboard.js's half is READ, never edited, and its absence is a
    reported problem rather than a skip: a producer that stopped
    composing the class, or that started composing it some other way,
    leaves the stylesheet's slots answering to nothing, and #34 is what
    this repository paid to learn that a rule which cannot find its
    subject must say so instead of passing.

22. The loading shape: theme-init.js is the only script in any page's
    head and blocks there deliberately, and every other script the site
    ships runs at the end of the body, classic.

    #80 asked for a review of end-of-body classic scripts against
    defer-in-head as the pages were rebuilt. The pages have settled and
    the answer recorded here is DO NOT MOVE THEM. The reasoning, so the
    question is not reopened without new facts:

    - It buys no bytes. This whole issue is a transfer budget, and defer
      changes when a file is fetched and executed, never how big it is.
    - It buys no meaningful earlier fetch either. Every page here is a
      few kilobytes of HTML, so the browser's preload scanner has
      already seen every <script src> in the document - end of body
      included - before the first byte of any of them arrives. The
      window head+defer would win back is the parse time of a document
      that arrives in one packet.
    - It costs the invariant this check exists to hold. Today "the head
      contains exactly one script, and it is the one that must block" is
      a sentence a reader can verify at a glance. Move ten deferred
      files up there and the head becomes a place scripts live, which is
      the state in which an eleventh arriving WITHOUT defer reintroduces
      the flash and reads as ordinary.

    So the arm worth having is the one nothing watched before: the
    anti-flash contract itself. theme-init.js exists as a same-origin
    file rather than an inline <script> because the CSP forbids
    'unsafe-inline', and it earns that request by running before first
    paint. Add `defer` to it - one word, in the direction the whole
    ticket was pointing - and it paints the default palette first, then
    corrects it. Every other check in this gate stays green through
    that, and the flash is a frame long, which is exactly the kind of
    regression nobody reproduces on demand.

    The body half holds two more, and the second is the one worth the
    check. POSITION: every same-origin script sits after all the markup,
    in one run, because session.js and theme.js query the document at
    top level with nothing guarding them. Content appearing after that
    run is refused rather than reasoned about, because "is this element
    queried at top level by any of the ten files above it?" is a
    question no reviewer should have to answer twice.

    ORDER: a script is loaded after whichever module publishes the
    namespace it captures. This is not a precaution. The wiring modules
    here do not reach for a namespace when they use it; they take it off
    the global object AS THEY RUN -

        const UI = root.BinderUI;                 apps/web/auth.js
        const Session = root.BinderSession;       apps/web/signout.js

    - one statement at module level, evaluated the moment the file
    executes. Put auth.js above ui.js and UI is undefined for the life
    of the page. What makes that worth a gate rather than a code review
    is the next line in each of them: these modules guard on the
    captured value (`if (element && UI)`), so nothing throws, no console
    error appears, and the page simply stops saying anything. The
    publisher roster this arm orders against is MODULE_EXPORTS, already
    in this file for check 15 - one home for which module publishes
    what, read twice.

    That arm is also the precondition on any future move. head+defer
    preserves document order for classic scripts, so the run COULD go up
    there intact - but "intact" is the whole load, and until now nothing
    said so. Whoever reopens this decision inherits a machine-checked
    order rather than an argument.

    Third-party scripts are outside all of this by origin: index.html's
    Telegram widget is async, loads from telegram.org, and is the one
    script here whose execution point is not document order. It is
    exempt because nothing in this repository sets its attributes.

    Reversing the decision is a normal act and a visible one, the same
    shape as raising a ceiling in tools/check_budget.py: move the tags
    and change this check in the same diff, where a reviewer sees the
    rule move next to the reason it moved.

23. The palette chips agree across the pages that carry them: the same
    ids, the same visible words on each id, in the same order.

    #152, and the shape of the gap is worth stating because several
    arms look like they cover it and each reads something else. Check
    19 pins that a page pinned to offer a palette HAS the control -
    per page, in isolation. Check 10's rail parity compares
    .rail-links and stops before the picker, which does not live in
    the rail. Check 17's name tables read titles, headings and rail
    entries. So a chip renamed on two of the four pages satisfied
    every one of them, and the only thing reading the four labels side
    by side was a person following the demo walk-through.

    The failure is quiet by construction, which is why it needs a
    gate. The id is what theme.js stores and what theme.css selects on;
    the label is only words. Rename one copy and nothing breaks, no
    console says anything, and the site simply calls one palette two
    things depending on which page the member is standing on.

    Three things it deliberately does NOT pin, each for its own
    reason:

    - PRESENCE, which is check 19's. That check's own docstring
      declines to state label agreement because "two checks making the
      same claim in different places is how one of them gets quietly
      weakened"; this is the other side of that sentence. A page
      pinned to offer a palette and carrying no chip at all is left
      out of the comparison here, and check 19 fails on that same page
      from that same roster in the same run.
    - WHAT A LABEL SAYS. #127 ruled the words, "Parchment Daylight"
      over the id `daylight` included. The reference page below is
      only whichever name sorts first, and a rename that reaches all
      four copies passes here on purpose: agreement is the claim, not
      the wording. A check that pinned the words would have to be
      edited to ship a decision that is the owner's to make.
    - WHAT AN ID MEANS. That `daylight` names a palette theme.js
      paints and theme.css defines is that coupling's business -
      theme.js's own BG map, check 21's slot pin, check_contrast.py's
      table. This arm reads the four pages against each other and
      nothing else.

    Order is pinned as well as membership. The list is written out by
    hand on every page exactly as the rail is, so it drifts the way
    the rail drifts - a chip inserted where the page somebody copied
    from did not have it - and a set comparison is blind to that.

    The reader is the part with teeth, because a checker that declines
    to see half its input while the gate prints OK is the same silent
    failure with a different cause. Two things hold it open:
    theme.js wires `[data-set-theme]` on ANY element, so this reads
    any element rather than <button>; and the count of chips it pairs
    with a label is reconciled against CHIP_MARKUP, which is what
    check 19 counts a chip by. A chip that check can see and this one
    cannot read is REPORTED, never skipped - so the two arms cannot
    drift into disagreeing about what a chip is.
"""

import base64
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(REPO, "apps", "web")

# Deliberately broad. A false positive costs somebody thirty seconds of
# reading; a false negative costs every submitter their privacy.
KEY_PATTERNS = [
    (r"-----BEGIN [A-Z ]*PRIVATE KEY-----", "a PEM private key block"),
    (r"\bprivate[_-]?key\s*[:=]\s*['\"][^'\"]{16,}", "an assigned private_key"),
    (r"\bsecret[_-]?key\s*[:=]\s*['\"][^'\"]{16,}", "an assigned secret_key"),
    # What tools/keygen.html actually produces. "d" is the private
    # scalar of a JWK - the member that makes it the secret half, and
    # the one a public JWK does not carry. 32+ base64url characters
    # keeps it clear of any short "d" that means something else.
    (r"[\"']d[\"']\s*:\s*[\"'][A-Za-z0-9_-]{32,}[\"']",
     "the private half of a JWK key (its \"d\" member)"),
    # The key file pasted whole, envelope and all, instead of just the
    # publicKey line out of it.
    (r"[\"']?\bprivate[_-]?key[\"']?\s*[:=]\s*\{",
     "an assigned privateKey object - the generator's key file, pasted whole"),
    # BotFather's token shape. It is deliberately structural rather than a
    # literal: the real credential never enters the repository or a test.
    (r"(?<![A-Za-z0-9_-])\d{8,10}:[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])",
     "a Telegram bot token"),
]


# (description, pattern) for the head every published page shares.
# Matched loosely on purpose - this asserts the piece is present, not
# that it is spelled a particular way.
REQUIRED_HEAD = [
    ("a <meta charset>", r'<meta\s+charset='),
    ("a viewport meta", r'<meta\s+name="viewport"'),
    ("a <title>", r"<title>\s*\S"),
    ("a Content-Security-Policy meta",
     r'http-equiv="Content-Security-Policy"'),
    ("a link to theme.css", r'href="theme\.css"'),
    ("the pre-paint theme-init.js script", r'src="theme-init\.js"'),
]


def html_pages():
    return sorted(n for n in os.listdir(WEB) if n.endswith(".html"))


def html_references():
    """(page, target) for every local href/src in apps/web's HTML."""
    refs = []
    for name in html_pages():
        text = open(os.path.join(WEB, name), encoding="utf-8").read()
        # Comments first: prose in a comment may name a file that
        # deliberately does not exist here (dev/ is never published).
        text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
        for target in re.findall(r'(?:href|src)="([^"]+)"', text):
            if re.match(r"^(?:https?:)?//|^mailto:|^#|^data:", target):
                continue
            refs.append((name, target.split("?", 1)[0].split("#", 1)[0]))
    return refs


def missing_head_pieces():
    """(page, description) for every shared head element a page lacks."""
    gaps = []
    for name in html_pages():
        text = open(os.path.join(WEB, name), encoding="utf-8").read()
        text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
        for description, pattern in REQUIRED_HEAD:
            if not re.search(pattern, text, re.I):
                gaps.append((name, description))
    return gaps


CONFIG_FILE = "config.js"
PRODUCTION_HOST = "potaetoe.github.io"

# What production must ship, written down where config.js cannot reach it.
#
# These are not secrets - a public key is published on purpose and the
# endpoint accepts writes from one origin - so the only thing they do here
# is refuse to move. That is the point. Every other assertion about
# config.js is computed *from* config.js, which means editing that file
# edits the standard it is held to; two arms with their values exchanged
# satisfy every one of them.
#
# PRODUCTION_KEY is safe to pin because it is already permanent. Replacing
# it is a rotation, not an edit - every submission encrypted to the old key
# stops being readable by the new one - so a change here should be rare,
# deliberate, and accompanied by the archive step in OPERATIONS.md, "The keys". If this
# check ever fires during ordinary work, the answer is almost never to
# update the constant.
PRODUCTION_KEY = ("BEKFlvIzxk0/nOTskgzbKfYoqmMW3ds4EmUpn6rqx9rD"
                  "1d5PhnxXT9kD917khzW07MUT2yAX18Wc7rD4K0BTSQ8=")
PRODUCTION_ENDPOINT = "https://hgbinderworker.sorcererbiggz.workers.dev"

# Both origins appear in every interactive page's connect-src, so the CSP
# pin below needs to name them. Written out here rather than read from
# config.js on purpose: csp_gaps() already checks the other direction -
# that every endpoint config.js names is reachable under connect-src - and
# deriving the pin from the same file would make both checks agree with
# whatever config.js happens to say. One reconciles, the other pins, and
# a pin that reads its expectation from the thing it guards is check 5's
# mistake again.
DEVELOPMENT_ENDPOINT = "https://hgbinderworker-dev.sorcererbiggz.workers.dev"


def crossed_wire_problems(environments):
    """Problems where production carries a value that is not production's.

    Two failures, and they are not the same one twice:

    the swap - production's arm holding development's key or endpoint. The
    endpoint half announces itself, because each Worker refuses the other's
    origin, so the site fails at the first request rather than quietly. The
    key half does not announce anything at all: submissions encrypt, POST,
    store, and are unreadable by the only person who is supposed to read
    them.

    the copy - some *other* arm holding production's key. Development then
    seals its test rows to production's key, so reading them back means
    loading the real private key on a page served over plain HTTP from a
    local directory. archive/REDESIGN.md gives that as the whole reason development
    has a keypair of its own.
    """
    problems = []
    for environment in environments:
        is_production = environment["name"] == "production"
        key = environment["publicKey"]
        endpoint = environment["endpoint"]

        if is_production:
            if key and key != PRODUCTION_KEY:
                problems.append(
                    "the production arm does not carry the production "
                    "public key. Rows written by the live site would be "
                    "sealed to a key the keyholder does not hold, and no "
                    "export could ever read them back")
            if endpoint and endpoint != PRODUCTION_ENDPOINT:
                problems.append(
                    "the production arm does not carry the production "
                    "endpoint, so the live site would write somewhere it "
                    "was never meant to")
        else:
            if key == PRODUCTION_KEY:
                problems.append(
                    "the %s arm carries the production public key. Reading "
                    "its rows back would mean loading the real private key "
                    "outside production, which is what a separate "
                    "development keypair exists to avoid" %
                    environment["host"])
            if endpoint == PRODUCTION_ENDPOINT:
                problems.append(
                    "the %s arm carries the production endpoint, so local "
                    "work would write into the live database" %
                    environment["host"])
    return problems


def literal_field(body, name):
    """One quoted `name: "value"` out of a single ENVIRONMENTS arm.

    Module level, and deliberately taking the body rather than closing
    over it. A version defined inside the loop that walks the arms reads
    correctly only for as long as it is called in the same iteration it
    was defined in - store one of those closures, call it later, and it
    silently reports the last arm's values for every arm. Keeping the
    body a parameter is what makes that shape unavailable, and the
    failure it forecloses is a config check that passes while describing
    the wrong environment.
    """
    found = re.search(r"\b%s\s*:\s*[\"']([^\"']+)[\"']" % name, body)
    return found.group(1) if found else None


def config_environments(text=None):
    """([environment], [problem]) parsed from config.js source.

    This is deliberately a narrow parser for the literal object this project
    ships, not a JavaScript interpreter. A computed endpoint or key would make
    the publish-time invariant unknowable, which is itself a build failure.

    Takes the source rather than only a path so the pins below can be
    exercised on strings, the way export_problems and the CSP parser are.
    A check that can only run against the one file it guards is a check a
    mutation reaches only by editing that file - and this one guards the
    assignment that carries the key every submission encrypts to, so the
    reassignment lock has to be falsifiable without touching the shipped
    config.
    """
    if text is None:
        path = os.path.join(WEB, CONFIG_FILE)
        if not os.path.exists(path):
            return [], ["does not exist"]
        text = open(path, encoding="utf-8").read()

    text = strip_js_comments(text)
    block = re.search(
        r"\bconst\s+ENVIRONMENTS\s*=\s*\{(.*?)\n\s*\};", text, re.S)
    if not block:
        return [], ["does not define a literal ENVIRONMENTS object"]

    arms = re.compile(
        r'(?:"([^"]+)"|\'([^\']+)\'|([A-Za-z0-9_.-]+))\s*:\s*'
        r'\{([^{}]*)\}\s*,?', re.S)
    environments = []
    problems = []
    for match in arms.finditer(block.group(1)):
        host = next(value for value in match.groups()[:3]
                    if value is not None)
        body = match.group(4)

        environment = {
            "host": host,
            "name": literal_field(body, "name"),
            "endpoint": literal_field(body, "endpoint"),
            "publicKey": literal_field(body, "publicKey"),
        }
        environments.append(environment)
        for required in ("name", "endpoint", "publicKey"):
            if not environment[required]:
                problems.append("the %s arm has no literal %s" %
                                (host, required))

    if not environments:
        problems.append("ENVIRONMENTS has no literal hostname arms")

    hosts = [environment["host"] for environment in environments]
    if len(hosts) != len(set(hosts)):
        problems.append("ENVIRONMENTS defines one hostname more than once")

    production = [environment for environment in environments
                  if environment["name"] == "production"]
    if len(production) != 1:
        problems.append("must contain exactly one arm named production")
    elif production[0]["host"] != PRODUCTION_HOST:
        problems.append(
            "the production arm is keyed by %s, not the deployed hostname %s"
            % (production[0]["host"], PRODUCTION_HOST))

    development = [environment for environment in environments
                   if environment["name"] == "development"]
    if len(development) != 1 or development[0]["host"] != "localhost":
        problems.append(
            "must contain exactly one localhost arm named development")

    alias = re.search(
        r'ENVIRONMENTS\s*\[\s*["\']127\.0\.0\.1["\']\s*\]\s*=\s*'
        r'ENVIRONMENTS(?:\.localhost|\s*\[\s*["\']localhost["\']\s*\])',
        text)
    if not alias:
        problems.append("127.0.0.1 is not aliased to the localhost arm")

    no_default = re.search(
        r'globalThis\.BINDER_CONFIG\s*=\s*(?:Object\.freeze\s*\(\s*)?'
        r'ENVIRONMENTS\s*\[\s*location\.hostname\s*\]\s*\|\|\s*\{'
        r'\s*name\s*:\s*["\']unknown["\']\s*,\s*'
        r'publicKey\s*:\s*null\s*,?\s*\}', text, re.S)
    if not no_default:
        problems.append(
            "an unknown hostname does not resolve to the closed, keyless arm")

    # The reassignment lock. Freezing the resolved arm (enforced as a freeze
    # through MODULE_EXPORTS) stops config.publicKey being mutated, but a
    # frozen object still sits behind a writable global: a script could point
    # BINDER_CONFIG at its own object before form.js reads the key. A
    # non-writable, non-configurable defineProperty closes that, and pinning
    # it here is what makes it undroppable - the freeze rule reads assignments
    # and never a property descriptor. The Object.freeze wrapper the pattern
    # above tolerates is not required here: the freeze is the export roster's
    # to enforce, so a stripped freeze fails there rather than being reported
    # as a resolution problem it does not have.
    lock = re.search(
        r'Object\.defineProperty\s*\(\s*globalThis\s*,\s*'
        r'["\']BINDER_CONFIG["\']\s*,\s*\{([^}]*)\}', text, re.S)
    if not lock:
        problems.append(
            "BINDER_CONFIG is never redefined non-writable, so the global "
            "can be reassigned before form.js reads the key it encrypts to")
    else:
        descriptor = lock.group(1)
        if not re.search(r'\bwritable\s*:\s*false\b', descriptor):
            problems.append(
                "BINDER_CONFIG is redefined without writable: false, so the "
                "global can still be reassigned before the key is read")
        if not re.search(r'\bconfigurable\s*:\s*false\b', descriptor):
            problems.append(
                "BINDER_CONFIG is redefined without configurable: false, so "
                "the lock can be redefined away before the key is read")

    for field_name in ("endpoint", "publicKey"):
        values = [environment[field_name] for environment in environments
                  if environment[field_name]]
        if len(values) != len(set(values)):
            problems.append("two environment arms share the same %s" %
                            field_name)

    return environments, problems


def endpoint_origin(endpoint):
    """The HTTPS origin of one literal endpoint, or None if malformed."""
    match = re.match(r"^(https://[^/]+)(?:/.*)?$", endpoint or "")
    return match.group(1) if match else None


def csp_gaps(origins):
    """(page, origin) for pages whose CSP would block an endpoint.

    Only pages that actually load config.js are checked. A page with no
    reason to reach an endpoint should not be given permission to - the
    404 page is the current example.
    """
    origins = [origin for origin in origins if origin]
    if not origins:
        return []
    users = {page for page, target in html_references()
             if target == CONFIG_FILE}
    gaps = []
    for name in sorted(users):
        text = open(os.path.join(WEB, name), encoding="utf-8").read()
        # Through the shared parser since #34. This function carried the
        # original `if not policy: continue`, which is where checks 11
        # and 12 inherited it from - an unreadable policy silently became
        # "no gaps found", so a page could have had every endpoint
        # blocked and this would have said nothing.
        directives, problem = parse_csp(text)
        if problem:
            continue  # csp_policy_problems() reports it, and once is enough
        if directives is None:
            continue  # already reported by the shared-head check
        allowed = directives.get("connect-src", [])
        for origin in origins:
            if origin not in allowed:
                gaps.append((name, origin))
    return gaps


# P-256, from FIPS 186-4. Only what is needed to test whether a point
# satisfies y^2 = x^3 - 3x + b (mod p); nothing here does cryptography.
P256_P = (1 << 256) - (1 << 224) + (1 << 192) + (1 << 96) - 1
P256_B = int("5ac635d8aa3a93e7b3ebbd55769886bc"
             "651d06b0cc53b0f63bce3c3e27d2604b", 16)


def public_key_problem(value):
    """A description of what is wrong with one environment key, or None."""
    if not value:
        return "no publicKey is set"
    try:
        raw = base64.b64decode(value, validate=True)
    except Exception:
        return "the publicKey is not valid base64 - the paste was mangled"

    if len(raw) != 65:
        return ("the publicKey decodes to %d bytes, not the 65 an "
                "uncompressed P-256 point takes - the paste was truncated"
                % len(raw))
    if raw[0] != 0x04:
        return ("the publicKey does not begin with the 0x04 that marks an "
                "uncompressed point")

    x = int.from_bytes(raw[1:33], "big")
    y = int.from_bytes(raw[33:], "big")
    if x >= P256_P or y >= P256_P:
        return "the publicKey's coordinates are out of range for P-256"
    if (y * y - (x * x * x - 3 * x + P256_B)) % P256_P != 0:
        return ("the publicKey is not a point on P-256 - the paste is "
                "corrupt, or it is a key for some other curve")
    return None


CRYPTO_FILE = "crypto.js"
SIGN_IN_PAGE = "index.html"

# The CSP meta tag, found by its marker and then read for its content -
# in either order, because HTML does not care and the previous spelling
# of this did.
#
# It wanted http-equiv and then content inside one tag. Reversing the two
# attributes made the search return None, at which point every CSP check
# skipped in silence while check 3 still passed on the http-equiv
# substring alone. Both hazards were produced with the gate green. See
# #34; the tests are in dev/check_web.test.py.
CSP_MARKER = re.compile(
    r'<meta\b[^>]*http-equiv\s*=\s*"Content-Security-Policy"[^>]*>', re.I)
CSP_CONTENT = re.compile(r'\bcontent\s*=\s*"([^"]*)"', re.I)


def parse_csp(text):
    """(directives, problem) for the first CSP meta in a document.

    directives maps a lowercased directive name to its source list, in
    the order written. Both halves of the return can be None: no CSP at
    all is *absence*, which is check 3's to report, not this function's.

    A problem is returned when the marker is there and the policy cannot
    be read from it. That distinction is the whole point, and the hazard
    it closes is silence rather than misreading: a checker that reports
    "no problem found" when it could not read at all is worse than one
    with no opinion, because the first is believed.
    """
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)

    marker = CSP_MARKER.search(text)
    if not marker:
        return None, None

    content = CSP_CONTENT.search(marker.group(0))
    if not content:
        return None, ("carries a Content-Security-Policy meta with no "
                      "readable content attribute")
    if not content.group(1).strip():
        return None, "carries an empty Content-Security-Policy"

    directives = {}
    for raw in content.group(1).split(";"):
        tokens = raw.split()
        if not tokens:
            continue
        name = tokens[0].lower()
        if name in directives:
            return None, ("repeats the %s directive; a reader cannot tell "
                          "which one is meant" % name)
        directives[name] = tokens[1:]
    if not directives:
        return None, "carries a Content-Security-Policy with no directives"
    return directives, None


# Every page's whole policy, pinned from outside the page.
#
# This is the corollary DESIGN.md draws from check 5, applied to the CSP:
# a check computed entirely from the file it guards cannot detect that
# the file's contents were rearranged. Checks 11 and 12 pinned two
# directives on one page, which left default-src - and therefore every
# directive a page does not set explicitly, object-src among them - free
# to widen with nothing to say so.
#
# Written as a baseline plus declared deviations rather than five copies,
# because the interesting fact is *which pages differ and why*, and five
# copies bury it in duplication somebody will later "tidy".
CSP_BASELINE = {
    "default-src": ["'none'"],
    "script-src": ["'self'"],
    "style-src": ["'self'"],
    "img-src": ["'self'", "data:"],
    # The vendored faces in apps/web/fonts, reached from @font-face in
    # theme.css. default-src 'none' governs font loading like everything
    # else, so a page without this directive loads no font at all and
    # renders the fallback stack - which looks like a design choice
    # rather than a blocked request, and is the one CSP failure nobody
    # reports as a bug. 'self' and only 'self': the fonts are vendored
    # precisely so no third-party origin is ever reached for them.
    "font-src": ["'self'"],
    "connect-src": ["'self'", PRODUCTION_ENDPOINT, DEVELOPMENT_ENDPOINT],
    "base-uri": ["'none'"],
    "form-action": ["'none'"],
}

# Each deviation carries its reason. A page that differs for a reason
# nobody wrote down is the thing this table exists to make impossible.
CSP_DEVIATIONS = {
    # Static text and a link home. It talks to no Worker, so naming one
    # would be a permission granted for nothing.
    "404.html": {"connect-src": ["'self'"]},

    # The sign-in page, and the only page permitted third-party script.
    # Telegram's legacy widget builds its data-onauth handler with eval,
    # so 'unsafe-eval' is required alongside the script and frame
    # origins. Survivable only because it is confined: no form, no
    # plaintext, no key, and check 11 keeps crypto.js off it.
    #
    # Provisional. BotFather binds the widget to a domain, so localhost
    # cannot prove the real render or callback - the first sign-in on
    # potaetoe.github.io is the observation, and if the policy differs
    # this table changes with it. Pinned so that is a decision.
    "index.html": {
        "script-src": ["'self'", "'unsafe-eval'", "https://telegram.org"],
        "frame-src": ["https://oauth.telegram.org"],
    },
}


# The pages this table covers, written out rather than read off the
# directory.
#
# Deriving it from html_pages() was the first version and it was wrong:
# a new page would have been handed the baseline automatically, so the
# check "every page has a pinned policy" could never fail. That is an
# armed-looking check that is inert, which this repository holds to be
# worse than no check at all.
#
# Listing them means adding a page fails the gate until somebody says
# what its policy is - and adding a page is exactly when somebody copies
# a head from whichever page they had open, which is the hazard
# DESIGN.md names when it argues for check 12.
CSP_PAGES = frozenset({
    "404.html",
    "admin.html",
    "dashboard.html",
    "index.html",
    "submit.html",
})

EXPECTED_CSP = {
    name: dict(CSP_BASELINE, **CSP_DEVIATIONS.get(name, {}))
    for name in sorted(CSP_PAGES)
}


def csp_policy_problems():
    """(page, problem) where a shipped policy is not the pinned one."""
    problems = []
    pages = set(html_pages())

    for name in sorted(pages - CSP_PAGES):
        problems.append((name, "has no pinned Content-Security-Policy. Add "
                               "it to CSP_PAGES, with a deviation and a "
                               "reason if it does not take the baseline"))
    for name in sorted(CSP_PAGES - pages):
        problems.append((name, "is pinned in CSP_PAGES but does not exist"))

    for name in sorted(pages & CSP_PAGES):
        text = open(os.path.join(WEB, name), encoding="utf-8").read()
        directives, problem = parse_csp(text)
        if problem:
            problems.append((name, problem))
            continue
        if directives is None:
            continue  # no policy at all is check 3's to report

        expected = EXPECTED_CSP[name]
        for directive in sorted(set(expected) | set(directives)):
            want = expected.get(directive)
            got = directives.get(directive)
            if want is None:
                problems.append((name, "sets %s, which is not pinned for "
                                       "this page" % directive))
            elif got is None:
                problems.append((name, "is missing the %s directive" %
                                 directive))
            elif got != want:
                problems.append((name, "%s is %r; pinned as %r"
                                 % (directive, " ".join(got),
                                    " ".join(want))))
    return problems

# What "this file puts something on the wire" looks like in a directory
# with no build step and no framework. A bare fetch() is a read and is
# not enough: reading is what the public dashboard does, and what the
# export does, and neither is the risk this check exists for.
#
# sendBeacon is here because its whole purpose is sending a body, and
# an XMLHttpRequest with an explicit method is the older spelling of
# the same thing.
SENDS_TO_NETWORK = re.compile(
    r"method\s*:\s*[\"'](?:POST|PUT|PATCH)[\"']|"
    r"\bsendBeacon\s*\(|"
    r"\.open\s*\(\s*[\"'](?:POST|PUT|PATCH)[\"']",
    re.I)

# Check 6 approximates "a submission never leaves before encryption" by
# recognizing scripts that send a request body. Authentication is the one
# body with a different purpose, and naming it here keeps that exception
# narrow and reviewable instead of weakening the rule for every sender.
UNENCRYPTED_SENDERS = {
    "auth.js": "forwards a sign-in payload and stores the issued session",
}


def strip_js_comments(text):
    """Prose about fetch() is not a fetch().

    Comments are blanked rather than deleted: every character becomes a
    space and every newline survives, so the result is the same length
    as the input and an offset into it still names the right line of the
    original file. Check 15 reports the line a global is assigned on,
    and a stripper that removed comment text would have shifted every
    number it printed - by hundreds of lines in these files, which open
    with long comments. A checker that names the wrong line is not a
    smaller problem than one that names none; it sends the reader to a
    line that looks innocent and invites them to close the report.
    """
    def blank(match):
        return re.sub(r"[^\n]", " ", match.group(0))

    text = re.sub(r"/\*.*?\*/", blank, text, flags=re.S)
    # Line-anchored, so the // inside an http:// URL is not a comment.
    return re.sub(r"^[^\S\n]*//.*$", blank, text, flags=re.M)


def line_of(text, offset):
    """The 1-based line number an offset falls on."""
    return text.count("\n", 0, offset) + 1


def unencrypted_paths():
    """(file, problem) for anything that could put plaintext on the wire."""
    problems = []

    senders = set()
    for name in sorted(n for n in os.listdir(WEB) if n.endswith(".js")):
        if name == CRYPTO_FILE:
            continue
        code = strip_js_comments(
            open(os.path.join(WEB, name), encoding="utf-8").read())
        if not SENDS_TO_NETWORK.search(code):
            continue
        senders.add(name)
        if name in UNENCRYPTED_SENDERS:
            continue
        if "BinderCrypto" not in code:
            problems.append((
                name,
                "sends a body to the endpoint but never mentions "
                "BinderCrypto, so whatever it sends has not been through "
                "crypto.js"))

    for page, target in html_references():
        if target in senders:
            if target in UNENCRYPTED_SENDERS:
                continue
            loaded = {t for p, t in html_references() if p == page}
            if CRYPTO_FILE not in loaded:
                problems.append((
                    page,
                    "loads %s, which sends to the endpoint, but does not "
                    "load %s - the encryption would not be there to call"
                    % (target, CRYPTO_FILE)))

    for name in sorted(UNENCRYPTED_SENDERS):
        if name not in senders:
            problems.append((
                name,
                "is named as an unencrypted sender exemption but does not "
                "send a body. Remove the stale exemption so a later POST "
                "cannot inherit it silently"))

    return problems


def sign_in_boundary_problems():
    """(page, problem) when the sign-in-only boundary widens or spreads.

    Check 11 - crypto.js must not be on the sign-in page - plus the
    Telegram-specific half of check 12. Exact-token pinning belongs in
    csp_policy_problems() rather than here, because it pins every
    directive on every page rather than two on one.

    The Telegram spread check stays even though a whole-policy pin
    subsumes it, because it says *why* in its message. "submit.html names
    telegram.org even though only index.html is allowed the callback
    exception" tells a reader what rule they broke; "script-src is
    'self' https://telegram.org; pinned as 'self'" tells them a value
    disagrees. Both are true and only one is an explanation.
    """
    problems = []
    sign_in_refs = {
        target for page, target in html_references()
        if page == SIGN_IN_PAGE
    }
    if CRYPTO_FILE in sign_in_refs:
        problems.append((
            SIGN_IN_PAGE,
            "loads crypto.js even though it is the only page permitted "
            "Telegram's third-party widget. Keep submission plaintext and "
            "the private key off this page; it already holds the session "
            "after sign-in"))

    for name in html_pages():
        if name == SIGN_IN_PAGE:
            continue
        text = open(os.path.join(WEB, name), encoding="utf-8").read()
        directives, problem = parse_csp(text)
        if problem:
            continue  # csp_policy_problems() reports it, and once is enough
        if directives is None:
            continue  # the missing-policy case is check 3's to report

        # Tokens, not a regex over the raw policy. The policy is already
        # parsed by the time we get here, and matching tokens removes the
        # delimiter question entirely - the first version of this check
        # had a regex that a trailing semicolon slipped past, which is
        # the kind of bug a source list cannot have.
        sources = [source.lower()
                   for values in directives.values() for source in values]
        permissions = []
        if any("telegram.org" in source for source in sources):
            permissions.append("telegram.org")
        if "'unsafe-eval'" in sources:
            permissions.append("'unsafe-eval'")
        if permissions:
            problems.append((
                name,
                "names %s in its CSP even though only index.html is allowed "
                "the Telegram callback exception" % " and ".join(permissions)))

    return problems


STYLESHEET = "theme.css"

# `[hidden] { display: none !important }`, however it is spaced. The
# !important is required, not stylistic: without it the rule loses to
# any component that sets display, which is the exact failure this
# checks for.
HONOURS_HIDDEN = re.compile(
    r"\[hidden\][^{}]*\{[^{}]*display\s*:\s*none\s*!\s*important", re.I | re.S)


def hidden_attribute_problem():
    """A description of the stylesheet failing to honour [hidden], or None."""
    path = os.path.join(WEB, STYLESHEET)
    if not os.path.exists(path):
        return None  # the missing-stylesheet case is check 1's to report
    css = re.sub(r"/\*.*?\*/", "", open(path, encoding="utf-8").read(),
                 flags=re.S)
    if HONOURS_HIDDEN.search(css):
        return None
    return ("%s does not force [hidden] to display:none !important. Every "
            "element this site shows and hides - both unit groups, the "
            "closed notice, the success card, the field errors - relies on "
            "that one rule, and .card and .stack set display:flex, which "
            "beats the browser's own [hidden] rule. The pages would render "
            "every hidden element at once, with nothing reporting it"
            % STYLESHEET)


# The one declaration in this stylesheet whose MEANING changes with its
# container, which is why it gets a check of its own.
#
# `body.railed` is a grid at full width, and there `align-items: start`
# addresses the block axis: it keeps the rail from being stretched down
# a page taller than itself. A width block that turns that same
# container into a flex column re-points the identical declaration at
# the INLINE axis, where `start` means "size every child to its own
# content" instead. `.page` then takes its min-content width rather
# than the screen's, and on a page holding one control that will not
# shrink - admin.html's file input, whose intrinsic width is what it
# contributes while intrinsic sizes are computed - that is wider than a
# phone. The page scrolls sideways (#148).
#
# `.rail` is checked separately because an item's own `align-self`
# outranks its container's `align-items`, and it sets `start` for the
# same grid reason. Answering only on the container leaves the strip
# short of the right edge, its bottom rule ending mid-page.
#
# WHAT THIS PINS IS THE DECLARATION, NOT THE RENDER. It cannot say a
# page fits its viewport: there is no layout engine in this gate, and
# #75 rejected jsdom for exactly this - `getBoundingClientRect()`
# returns 0x0 there, so a width assertion passes vacuously, which is
# worse than no assertion. What it can say is that the column branch
# ANSWERS the alignment question instead of inheriting an answer aimed
# at a different axis. That is the part no reader sees, because the two
# rules are nine hundred lines apart and the second one looks complete.
#
# The branch is found by what it does to the container, never by its
# breakpoint. "The 64rem block" is a fact about a number any redesign
# may move, and a second column branch added later has the identical
# hazard and is caught by the identical rule. dev/demo.test.mjs reached
# the same conclusion picking this same block by its rules rather than
# by its size, after a first attempt keyed on ordering went green with
# an unrelated block satisfying it.
FLEX_CONTAINER = re.compile(r"\bdisplay\s*:\s*flex\b", re.I)
DECLARES_ALIGN_ITEMS = re.compile(r"\balign-items\s*:", re.I)
DECLARES_ALIGN_SELF = re.compile(r"\balign-self\s*:", re.I)

# One rule: everything up to `{`, then everything up to `}`. Media
# blocks are stripped of their own braces first, so no rule here ever
# contains another.
CSS_RULE = re.compile(r"([^{}]+)\{([^{}]*)\}", re.S)


def media_block_bodies(css):
    """The body of every @media block, brace-matched.

    Counted rather than matched to the first `}`, because a media block
    is a block OF blocks - stopping at the first closing brace would
    hand back one rule and call it the branch.
    """
    bodies = []
    for opener in re.finditer(r"@media[^{]*\{", css):
        depth = 1
        index = opener.end()
        while index < len(css) and depth:
            if css[index] == "{":
                depth += 1
            elif css[index] == "}":
                depth -= 1
            index += 1
        bodies.append(css[opener.end():index - 1])
    return bodies


def rule_bodies(block, selector):
    """Every rule body in `block` whose selector list names `selector`.

    The list is split and compared whole rather than searched, so
    `.rail-links` is not mistaken for `.rail` and `.rail, .page {…}`
    still counts as answering for the rail.
    """
    bodies = []
    for rule in CSS_RULE.finditer(block):
        parts = [one.strip() for one in rule.group(1).split(",")]
        if selector in parts:
            bodies.append(rule.group(2))
    return bodies


def css_column_branch_problems(css):
    """Descriptions of a width block inheriting the grid's alignment.

    Takes the stylesheet's text rather than reading the file, so the
    suite can exercise the SHAPE of the failure instead of whatever
    theme.css happens to say today - the split check 18 argues for.
    """
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)

    problems = []
    for block in media_block_bodies(css):
        railed = rule_bodies(block, "body.railed")
        if not any(FLEX_CONTAINER.search(body) for body in railed):
            continue

        if not any(DECLARES_ALIGN_ITEMS.search(body) for body in railed):
            problems.append(
                "turns body.railed into a flex container in a width block "
                "without stating align-items there. The grid rule's "
                "align-items: start then applies to the inline axis "
                "instead of the block axis, and every child is sized to "
                "its own content rather than to the screen")

        if not any(DECLARES_ALIGN_SELF.search(body)
                   for body in rule_bodies(block, ".rail")):
            problems.append(
                "turns body.railed into a flex container in a width block "
                "without stating align-self on .rail there. An item's own "
                "alignment outranks its container's, so the rail keeps the "
                "grid's start and the strip stops short of the edge it "
                "draws its bottom rule across")

    return problems


def column_branch_alignment_problems():
    """css_column_branch_problems() against the shipped stylesheet."""
    path = os.path.join(WEB, STYLESHEET)
    if not os.path.exists(path):
        return []  # the missing-stylesheet case is check 1's to report
    return css_column_branch_problems(
        open(path, encoding="utf-8").read())


# Which shell each published page carries. Pinned here rather than read
# off the markup: a rule derived from what the pages happen to contain
# cannot fail when a page arrives carrying the wrong one, and arriving
# is exactly when a shell gets copied from whichever page was open.
#
# RAIL is the signed-in surface. PLAIN is what a signed-out visitor
# meets: the cover, which the owner decided carries no rail before
# sign-in (#73), and the error page, which goes plain on principle.
SHELLS = {
    "404.html": "plain",
    "admin.html": "rail",
    "dashboard.html": "rail",
    "index.html": "plain",
    "submit.html": "rail",
}

# The hamburger the rail replaced. The destinations are visible at
# every width now - the owner's decision on #73 - and the only thing a
# disclosure opens here is the theme chips, so a page still carrying
# nav-toggle or nav-menu is a page that kept the hamburger. Those names
# are refused below rather than merely unused.
RETIRED_IDS = ("nav-toggle", "nav-menu")

RAIL_MARKUP = re.compile(r'class="rail[\s"]', re.I)


def rail_links(text):
    """The (href, label) pairs inside a page's .rail-links, in order."""
    menu = re.search(r'<ul[^>]*class="rail-links".*?</ul>', text, re.S | re.I)
    if not menu:
        return None
    return re.findall(r'<a\s+href="([^"]+)"[^>]*>(.*?)</a>',
                      menu.group(0), re.S | re.I)


def rail_aside(text):
    """One page's whole rail <aside>, or None when it carries none.

    The region the anti-stranding arm reads since #187. The route to
    sign-in left .rail-links for the session block, and the wordmark
    carries it too - so the claim "this rail can always get somebody
    back to the door" is about the aside, not about the destinations
    list inside it. Two of the three page footers also link the door,
    but a footer is content and the rail is the shell: the shell is the
    copy this file holds identical across pages, so the shell is the
    copy the rule can stand on.
    """
    match = re.search(r'<aside[^>]*class="rail[\s"].*?</aside>',
                      text, re.S | re.I)
    return match.group(0) if match else None


def local_links(text):
    """Every same-origin href in a page, in order.

    Used only to answer "can somebody leave this page without a
    script", so a fragment or an off-site link does not count: a
    fragment goes nowhere and an external link leaves the site rather
    than moving through it.
    """
    return [href for href in re.findall(r'<a\s+[^>]*href="([^"]+)"', text,
                                        re.I)
            if not re.match(r"^(?:https?:)?//|^mailto:|^#|^data:", href)]


def plain_page_problems(text):
    """[problem] for one page that is pinned plain.

    Takes the markup rather than a filename so the rules can be
    exercised on strings. That is #34's lesson applied here: a mutation
    written against the five files tests today's markup, and what has to
    hold is the shape of the failure.
    """
    problems = []

    # The copy-paste direction. A rail on the cover would offer the
    # session home - signed-in state and Sign out - to somebody who has
    # not signed in yet.
    if RAIL_MARKUP.search(text) or rail_links(text) is not None:
        problems.append(
            "is pinned plain and carries rail markup. The rail holds the "
            "session home, and a signed-out visitor has no session for it "
            "to be the home of")

    # Plain is a treatment, not a dead end.
    if not local_links(text):
        problems.append(
            "is pinned plain and carries no link to anywhere else on this "
            "site, so a visitor who lands here with scripts blocked has no "
            "way off it")

    return problems


def rail_page_problems(text):
    """[problem] for one page that is pinned to the rail."""
    links = rail_links(text)
    if links is None:
        return ["has no rail"]
    if not links:
        return ["has a rail with no destinations"]

    problems = []

    # Identical incomplete rails still strand somebody. Sign-in is the
    # route a member whose session died needs most, so comparing the
    # copies is not enough: every copy of the aside must carry the
    # directory index somewhere. Since #187 that somewhere is the
    # wordmark and the session block rather than a destination entry,
    # so the whole aside is read rather than .rail-links - the
    # rationale outlived the selector it was first written as.
    aside = rail_aside(text) or ""
    if not any(rail_target(href) == "index.html"
               for href in local_links(aside)):
        problems.append(
            "has no route to sign-in anywhere in its rail, so a member "
            "whose session has expired can be stranded away from the page "
            "that mints a new one")

    # The other direction of the same ruling. #187 moved the door out of
    # the destinations: .rail-links lists where a signed-in member goes,
    # and Sign in in that list is the door offered to people already
    # inside. Its home is the session block, beside the words that say
    # whether there is a session to end - refused here rather than
    # merely removed, because three hand-kept copies drift back the way
    # they drifted apart.
    for href, _ in links:
        if rail_target(href) == "index.html":
            problems.append(
                "offers the sign-in door (%s) among its rail destinations. "
                "#187 moved that route to the session block: navigation "
                "lists where a signed-in member goes, and the session "
                "block is the surface that knows whether to offer the "
                "door or the exit" % href)
            break

    for retired in [i for i in RETIRED_IDS if 'id="%s"' % i in text]:
        problems.append(
            "still carries id=\"%s\" from the hamburger the rail replaced. "
            "The destinations are visible now and the disclosure opens the "
            "theme chips instead" % retired)

    return problems


def shell_problems():
    """(page, problem) for pages whose shell is missing, wrong or drifted."""
    problems = []
    pages = html_pages()

    # Both directions on the table itself, before anything is read out
    # of a page. Without these the rules below describe whichever pages
    # the table happens to name, which is the failure mode the table
    # exists to prevent.
    for name in sorted(set(pages) - set(SHELLS)):
        problems.append((
            name,
            "is published but names no shell in SHELLS in tools/"
            "check_web.py. Say whether it carries the rail or is plain, "
            "so the next page copied from an open tab cannot inherit the "
            "wrong one in silence"))
    for name in sorted(set(SHELLS) - set(pages)):
        problems.append((
            name,
            "is pinned in SHELLS in tools/check_web.py and is not a page "
            "in apps/web. Delete the entry, or restore the page"))

    rails = {}
    for name in pages:
        if name not in SHELLS:
            continue
        text = re.sub(r"<!--.*?-->", "", open(os.path.join(WEB, name),
                                              encoding="utf-8").read(),
                      flags=re.S)

        if SHELLS[name] == "plain":
            for problem in plain_page_problems(text):
                problems.append((name, problem))
            continue

        for problem in rail_page_problems(text):
            problems.append((name, problem))

        links = rail_links(text)
        if links:
            rails[name] = links

    # Compared against whichever page sorts first, so the message names a
    # specific page to go and look at rather than "they differ".
    #
    # The message reports the destinations that DIFFER rather than both
    # lists in full, and it reports them as (href, label) pairs. Printing
    # the hrefs alone is what a first cut did, and it produced a failure
    # reading "admin.html has [a, b, c], this has [a, b, c]" whenever the
    # drift was in a link's text - which is most of the ways a hand-copied
    # list drifts, and the case a reviewer is least likely to spot by eye.
    if len(rails) > 1:
        reference = sorted(rails)[0]
        for name in sorted(rails):
            if name == reference or rails[name] == rails[reference]:
                continue
            here = set(rails[name])
            there = set(rails[reference])
            problems.append((
                name,
                "has a different rail from %s. Every page carries its own "
                "copy, so they have to be kept identical by hand - %s has "
                "%s where this has %s"
                % (reference, reference,
                   sorted(there - here) or "nothing extra",
                   sorted(here - there) or "nothing extra")))

    # A rail link to a page that does not exist is caught by check 1 as a
    # broken reference, so it is not repeated here.
    return problems


# Which pages write the site's own name out by hand. Three rails and
# the sign-in cover, so it crosses both shells and neither shell rule
# could state it - which is half of why nothing was comparing it.
#
# Pinned outside the markup for the reason SHELLS gives, and the ABSENT
# direction is the one with teeth: a page carrying the wordmark and
# named by no pin is a fifth copy nothing compares, and a page arriving
# is exactly when somebody copies a shell from whichever page they had
# open. 404.html deliberately carries none.
WORDMARK_PAGES = frozenset({
    "admin.html", "dashboard.html", "index.html", "submit.html",
})

# The two lines, by the classes theme.css paints them with. Read as
# words inside the class list rather than as the whole attribute, for
# the reason CLASS_ATTR gives: a second class beside this one is the
# same component, and an equality test never saw it.
WORDMARK_LINES = (
    ("wordmark-owner", "first"),
    ("wordmark-name", "second"),
)

# What a parity failure with no page to blame is attributed to, for the
# reason CHIP_PIN gives: the pin is the subject in that case.
WORDMARK_PIN = "WORDMARK_PAGES in tools/check_web.py"


def wordmark_line(text, component):
    """The words one wordmark line shows, or None if the page has none."""
    found = re.search(
        r'<span\b[^>]*class\s*=\s*["\'][^"\']*\b%s\b[^"\']*["\'][^>]*>'
        r'(.*?)</span>' % re.escape(component), text, re.S | re.I)
    return label_text(found.group(1)) if found else None


def page_wordmark(text):
    """(first line, second line) for one page's wordmark.

    A half is None when the page does not carry it at all and "" when it
    is there with nothing in it. The two say different things to whoever
    reads the failure - a missing line is a shell that was copied wrong,
    an empty one is a rename halfway through - so they are not folded
    together here.
    """
    return tuple(wordmark_line(text, component)
                 for component, _ in WORDMARK_LINES)


def page_wordmark_problems(text, carries):
    """[problem] for one page's own wordmark, before any comparison.

    Takes markup rather than a filename for the reason
    plain_page_problems() gives: what has to hold is the shape of the
    failure, not today's four files.
    """
    problems = []
    lines = page_wordmark(text)

    if not carries:
        if any(line is not None for line in lines):
            problems.append(
                "carries the wordmark and names no page in WORDMARK_PAGES "
                "in tools/check_web.py. Every copy of the site's own name "
                "is written out by hand, so a copy this table does not "
                "know about is one no rename will ever reach and nothing "
                "will ever compare")
        return problems

    if all(line is None for line in lines):
        problems.append(
            "is pinned to carry the wordmark and carries no wordmark at "
            "all. The name over the door is part of the shell, and a page "
            "that lost it in a copy looks like somebody else's site")
        return problems

    for (component, position), line in zip(WORDMARK_LINES, lines):
        if line is None:
            problems.append(
                "carries only the other half of the wordmark: there is no "
                ".%s on it. The name is two lines and one of them is "
                "missing" % component)
        elif not line:
            problems.append(
                "carries a %s wordmark line with no words in it. The "
                "class still paints, so this reads on the page as a gap "
                "above or below the half that survived" % position)

    return problems


def wordmark_parity_problems(marks):
    """[(page, problem)] for wordmarks that disagree.

    `marks` is {page: (first, second)} for the pages whose own wordmark
    read clean. Compared against whichever page sorts first, for the
    reason rail parity gives: a message naming a page to go and look at
    beats one saying only that they differ.
    """
    if len(marks) < 2:
        return [(WORDMARK_PIN,
                 "leaves this arm %d wordmark to compare. Parity is a "
                 "claim about copies, and a rule holding one copy cannot "
                 "fail - the hole check 23 paid for in #114. Either the "
                 "pages carrying the name come back, or this arm has "
                 "outlived its subject and goes out with the reason "
                 "written down" % len(marks))]

    problems = []
    reference = sorted(marks)[0]
    for name in sorted(marks):
        if name == reference:
            continue
        for (_, position), here, there in zip(WORDMARK_LINES, marks[name],
                                              marks[reference]):
            if here == there:
                continue
            problems.append((
                name,
                "writes the %s line of the wordmark as %r where %s writes "
                "%r. Every page writes these two lines out by hand and "
                "nothing else on the site reads them, so a rename reaching "
                "some of the copies breaks nothing, says nothing, and "
                "leaves one site wearing two names depending on which page "
                "somebody is standing on"
                % (position, here, reference, there)))

    return problems


def wordmark_problems():
    """(page, problem) for the site's own name across its hand-kept copies."""
    problems = []
    pages = html_pages()
    marks = {}

    for name in sorted(set(WORDMARK_PAGES) - set(pages)):
        problems.append((
            name,
            "is pinned in WORDMARK_PAGES in tools/check_web.py and is not a "
            "page in apps/web. Delete the entry, or restore the page - a "
            "pin with no page behind it is a check that cannot fail"))

    for name in pages:
        text = page_text(name)
        carries = name in WORDMARK_PAGES
        own = page_wordmark_problems(text, carries)
        problems.extend((name, problem) for problem in own)
        # A page whose own wordmark could not be read whole is no
        # evidence about another page's, so it is left out of the
        # comparison - but it is REPORTED above, never skipped, which is
        # the discipline #152 was filed for.
        if carries and not own:
            marks[name] = page_wordmark(text)

    problems.extend(wordmark_parity_problems(marks))
    return problems


# Which pages offer a palette. The owner's ruling on #150: ONE Theme
# disclosure at every width, and the sign-in page carries it too - so
# this crosses both shells and cannot be stated by the table above.
#
# Pinned outside the markup for the reason SHELLS gives, and here it is
# the ABSENT direction that would otherwise have nothing watching it.
# 404.html deliberately offers no palette, and the way a chip lands on
# it is the way every copy-paste failure in this file lands: somebody
# builds the next page from whichever one they had open. A chip there
# writes a stored preference from an error page and fails nothing.
THEMED_PAGES = frozenset({
    "admin.html", "dashboard.html", "index.html", "submit.html",
})

# The ids the disclosure is wired through. A pair rather than one id
# because aria-controls has to name the thing the button opens, and a
# button whose aria-controls points at nothing announces a relationship
# the page does not have.
DISCLOSURE_IDS = ("theme-toggle", "theme-chips")

# What theme.js wires a chip by. The button's own text is not read here:
# whether the four copies agree about a label is #152's question, and
# this one is only whether the control is on the page at all.
CHIP_MARKUP = re.compile(r"\bdata-set-theme\s*=", re.I)


def theme_control_problems(text, themed):
    """[problem] for one page's Theme control, present or absent.

    Takes markup rather than a filename for the reason
    plain_page_problems() gives: a rule exercised only on the files that
    ship today is a rule tested against today's markup, and what has to
    hold is the shape of the failure.
    """
    problems = []

    if themed:
        for missing in [i for i in DISCLOSURE_IDS
                        if 'id="%s"' % i not in text]:
            problems.append(
                "offers a palette and carries no id=\"%s\", which nav.js "
                "and aria-controls both rely on to open the chips. The "
                "control is one disclosure at every width - #150 - so a "
                "page missing half of it has no way to reach a palette at "
                "any width" % missing)
        if not CHIP_MARKUP.search(text):
            problems.append(
                "offers a palette and carries no data-set-theme chip, so "
                "its disclosure opens an empty group. theme.js wires the "
                "chips by that attribute and finds nothing to wire")
        return problems

    for found in [i for i in DISCLOSURE_IDS if 'id="%s"' % i in text]:
        problems.append(
            "carries id=\"%s\" and is not pinned in THEMED_PAGES in "
            "tools/check_web.py. Either this page now offers a palette "
            "and the pin is stale, or it inherited the control from "
            "whichever page it was copied from - say which" % found)
    if CHIP_MARKUP.search(text):
        problems.append(
            "carries a data-set-theme chip and is not pinned in "
            "THEMED_PAGES in tools/check_web.py. A chip writes a stored "
            "preference, and this page is not one the site offers that "
            "from")

    return problems


def theme_control_page_problems():
    """(page, problem) for the Theme control across the published pages."""
    problems = []
    pages = html_pages()

    for name in sorted(THEMED_PAGES - set(pages)):
        problems.append((
            name,
            "is pinned in THEMED_PAGES in tools/check_web.py and is not a "
            "page in apps/web. Delete the entry, or restore the page it "
            "was written for - a pin with no page behind it is a check "
            "that cannot fail"))

    for name in pages:
        for problem in theme_control_problems(page_text(name),
                                              name in THEMED_PAGES):
            problems.append((name, problem))

    return problems


# The three jobs a small label above a block is allowed to do, and the
# component that does each. The value is the sentence a failure prints,
# so a reader who has never seen this table learns the distinction from
# the error rather than from here.
LABEL_ROLES = {
    "runner": "names the section it stands on",
    "flag": "reports an outcome the page has reached",
    "caution": "tells the reader something they have to act on",
}

# Every label the published pages carry, and which of those three jobs
# it does.
#
# Keyed by the words rather than by (page, words), and that is the arm
# with teeth: one phrase doing one job here and another job on the next
# page is the same overload arriving by a different route, so the table
# cannot express it.
#
# Both directions fail. A label a page carries that this does not name
# fails, which makes "what job is this doing?" a question somebody has
# to answer before a new label ships - the question nothing asked while
# one component quietly grew to mean four things. An entry no page
# carries fails too, so the list cannot rot into a description of a
# site that no longer exists.
LABELS = {
    "Before you close this": "caution",
    "Charts": "runner",
    "Development session": "caution",
    "How your entry is handled": "runner",
    "Members": "runner",
    "Membership": "runner",
    "Not open": "flag",
    "Nothing to show": "flag",
    "Optional": "runner",
    "Publish": "runner",
    "Published": "runner",
    "Received": "flag",
    "Result": "flag",
    "Rows that grant nothing": "caution",
    "Rows that would not open": "caution",
    "Session": "runner",
    "Telegram": "runner",
    "Unavailable": "flag",
    "What this is": "runner",
    "Your account": "runner",
}

# The one component the three roles above stand in for. Refused in the
# pages AND in the stylesheet, because either half surviving alone is
# how it comes back:
# a live rule invites the next label, and a page still wearing the class
# renders as unstyled body text with nothing to say so.
RETIRED_LABEL = "eyebrow"

# Every reader in this file matches class="x" and class='x' alike, and
# that is load-bearing rather than tidy. These pages are hand-written
# HTML where both spellings are valid and neither is enforced, and every
# rule reading a class here is a REFUSAL - so a reader pinned to one
# spelling does not merely miss things, it fails open while the gate
# reports the page as checked. class='eyebrow' brought the retired
# component back with the whole gate green.
#
# The quotes are not required to match each other. Mismatched quotes are
# malformed markup nothing here should be lenient about, and the error
# on the strict side of this choice is a refusal that fires on garbage,
# which is the direction a refusal is allowed to be wrong in.
CLASS_ATTR = r'class\s*=\s*["\']([^"\']*)["\']'

# A label is a paragraph. Restricting the tag is what makes the reader
# below safe rather than merely convenient - <p> cannot nest, so a
# non-greedy match to the next </p> cannot swallow a label inside a
# card, which is exactly what a general "any element" reader does.
LABEL_MARKUP = re.compile(r'<p\s+[^>]*%s[^>]*>(.*?)</p>' % CLASS_ATTR,
                          re.S | re.I)

# The evasion the rule above would otherwise leave open: the same class
# on something that is not a paragraph is invisible to the reader and
# paints identically on the page.
ROLE_ON_OTHER_TAG = re.compile(
    r'<(?!p[\s>])\w+\s+[^>]*class\s*=\s*["\'][^"\']*\b(%s)\b'
    % "|".join(sorted(LABEL_ROLES)), re.I)

# The retired component, read as a word inside the class list rather
# than as the whole attribute. class="eyebrow small" is the same
# component with a second class beside it, and an equality test on the
# attribute never saw it.
RETIRED_LABEL_MARKUP = re.compile(
    r'class\s*=\s*["\'][^"\']*\b%s\b' % RETIRED_LABEL, re.I)

TAG = re.compile(r"<[^>]+>")

# What a role's color has to be written as. The residual is worth stating
# rather than hiding: two DIFFERENT tokens that happen to hold the same
# value in one palette still pass here, because resolving tokens per
# palette is tools/check_contrast.py's machinery and not this file's.
# What this closes is the evasion that needs no coincidence at all - a
# literal that paints another role's exact pixels.
COLOR_TOKEN = re.compile(r"^var\(\s*--color-[\w-]+\s*\)$")


# A role rule's subject: the compound the rule actually paints. The
# selector is read from its right-hand end because that is what the
# cascade does - `body.instrument .flag` paints .flag, `.flag .runner`
# paints .runner - and it must be the WHOLE compound, so that
# `.runner::after` (the hairline, which carries no information) is not
# read as the section-name role's color.
ROLE_SUBJECT = re.compile(r"^\.(\w[\w-]*)$")


def selector_role(part):
    """(context, role) for one selector that paints a role, else None.

    Context is everything left of the role's own compound - "" for a
    bare `.flag`, "body.instrument" for the admin surface's override.
    Modelling it is what closes the hole a reader of bare selectors
    leaves open: such a reader sees one page's worth of the cascade, the
    roles as they paint with nothing else on the body, and every
    page-level override is invisible to it. That is enough to give two
    roles the identical token on admin.html with the whole gate green.
    """
    compounds = part.split()
    if not compounds:
        return None
    subject = ROLE_SUBJECT.match(compounds[-1])
    if not subject or subject.group(1) not in LABEL_ROLES:
        return None
    return " ".join(compounds[:-1]), subject.group(1)


def normalized_color(value):
    """One color declaration with its spacing removed.

    `var( --color-gold )` and `var(--color-gold)` are one paint and were
    two strings to a comparison of written text, which is a way past the
    distinctness arm that costs one keystroke and no coincidence at all.
    Removing every space is total rather than a heuristic because the
    rule above has already refused anything that is not a bare token.
    """
    return re.sub(r"\s+", "", value)


def label_text(markup):
    """The words a label shows, with its markup and spacing removed.

    The section-name component wraps its text in a span so the rule can
    run off it, so reading textContent rather than the raw match is the
    difference between "Session" and "<span>Session</span>".
    """
    return " ".join(TAG.sub("", markup).split())


def page_labels(text):
    """[(role, words)] for every label in one page's markup, in order."""
    found = []
    for classes, inner in LABEL_MARKUP.findall(text):
        roles = [role for role in classes.split() if role in LABEL_ROLES]
        for role in roles:
            found.append((role, label_text(inner)))
    return found


def page_text(name):
    """One page's markup with its comments removed.

    Comments go first everywhere a rule reads markup, because a shape
    described in a comment is not a shape the page has - and every one
    of these pages carries long comments that quote the very markup the
    rules below refuse.
    """
    return re.sub(r"<!--.*?-->", "",
                  open(os.path.join(WEB, name), encoding="utf-8").read(),
                  flags=re.S)


def page_label_problems(text):
    """[problem] for the labels in one page's markup.

    Takes markup rather than a filename for the reason
    plain_page_problems() gives: a rule exercised only on the five files
    that ship is a rule tested against today's content.
    """
    problems = []

    if RETIRED_LABEL_MARKUP.search(text):
        problems.append(
            'still carries class="%s". That one component meant a '
            "section's name, an outcome, a warning and an instruction "
            "at once, which is why it means none of them - say which "
            "of %s this label is"
            % (RETIRED_LABEL, " / ".join(sorted(LABEL_ROLES))))

    for role in sorted(set(ROLE_ON_OTHER_TAG.findall(text))):
        problems.append(
            'wears the "%s" role on something that is not a paragraph. A '
            "label is a paragraph here, and one that is not is invisible "
            "to this check while painting exactly like the labels it sits "
            "beside" % role.lower())

    for role, words in page_labels(text):
        if words not in LABELS:
            problems.append(
                'carries the label "%s", which names no job in LABELS in '
                "tools/check_web.py. Say whether it %s"
                % (words, ", ".join(
                    "%s (%s)" % (LABEL_ROLES[key], key)
                    for key in sorted(LABEL_ROLES))))
        elif LABELS[words] != role:
            problems.append(
                'labels "%s" as "%s", and LABELS in tools/check_web.py '
                'says it is "%s" - it %s'
                % (words, role, LABELS[words], LABEL_ROLES[LABELS[words]]))

    return problems


def label_problems():
    """(page, problem) for labels whose role is missing, wrong or stale."""
    problems = []
    seen = set()

    for name in html_pages():
        text = page_text(name)
        seen.update(words for _, words in page_labels(text))
        for problem in page_label_problems(text):
            problems.append((name, problem))

    # The stale direction, which only the whole directory can answer: a
    # label is gone when NO page carries it, and no single page knows
    # that.
    for words in sorted(set(LABELS) - seen):
        problems.append((
            "apps/web",
            'has no label reading "%s", which LABELS in tools/check_web.py '
            "still names. Delete the entry, or restore the label" % words))

    return problems


def stylesheet_text():
    """The stylesheet with its comments removed, or None if it is missing.

    Comments go first for the reason page_text() gives one file up: this
    stylesheet quotes the very selectors the rules below refuse, at
    length, in the block comments that explain why they are refused.
    """
    path = os.path.join(WEB, STYLESHEET)
    if not os.path.exists(path):
        return None  # check 1's to report
    return re.sub(r"/\*.*?\*/", "", open(path, encoding="utf-8").read(),
                  flags=re.S)


# The stylesheet half of the same rule. The components have to exist,
# and they have to be told apart: three roles painted the same color are
# one component with three names, which is the state this split was made
# to leave rather than a state to arrive back at.
def label_style_problems():
    """[problem] for a stylesheet that cannot tell the three roles apart."""
    css = stylesheet_text()
    return [] if css is None else css_role_problems(css)


def css_role_problems(css):
    """[problem] for stylesheet text that cannot tell the roles apart.

    Takes the text rather than reading the file for the reason this
    suite's own docstring gives: a rule that can only be exercised
    through the directory it guards is a rule tested against today's
    content, and #34's mutations all passed that way.
    """
    problems = []
    if re.search(r"(^|[\s,}])\.%s\b" % RETIRED_LABEL, css):
        problems.append(
            'still defines .%s. A component kept alive for one last page '
            "is how the next label joins it" % RETIRED_LABEL)

    # Every rule that paints a role, keyed by (context, role), in
    # document order. Reading every rule rather than the first is
    # deliberate: the shared declarations and the per-role ones are
    # separate blocks by design, so a reader that stopped at the first
    # block a role's name appears in would find the grouped selector and
    # conclude the role sets no color.
    #
    # Two things replace an earlier value here, and they are not the
    # same thing. Within one context the last rule wins, which is what
    # the cascade does between selectors of equal weight. Across
    # contexts nothing wins: a context is kept separately and resolved
    # against the base below, because `body.instrument .flag` beats
    # `.flag` on specificity wherever the two are written.
    defined = set()
    colors = {}
    for selectors, block in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
        painted = set()
        for part in selectors.split(","):
            found = selector_role(part.strip())
            if found:
                painted.add(found)
        if not painted:
            continue
        defined |= {role for context, role in painted if not context}
        color = re.search(r"(?<![\w-])color\s*:\s*([^;]+);", block)
        if color:
            for key in painted:
                colors[key] = color.group(1).strip()

    for role in sorted(LABEL_ROLES):
        if role not in defined:
            problems.append(
                "defines no .%s, so every label that %s renders as ordinary "
                "body text" % (role, LABEL_ROLES[role]))
        elif ("", role) not in colors:
            problems.append(
                ".%s sets no color of its own, so it cannot be told from "
                "the label beside it" % role)

    # The token rule reaches every context, not only the base one.
    # Without it the distinctness arm below compares strings and can be
    # walked straight past: `.caution { color: #e7b583 }` differs from
    # `var(--color-warn-text)` as text while painting the identical
    # pixels. Requiring a token is also this file's own rule - every
    # component here is styled through the tokens, which is what lets a
    # palette be a block of variables.
    for (context, role), value in sorted(colors.items()):
        if not COLOR_TOKEN.match(value):
            problems.append(
                ".%s takes the color %s%s rather than a --color-* token. Two "
                "roles are told apart here by the token each one names, so "
                "a literal is a distinction this cannot see - and a palette "
                "cannot reach it either"
                % (role, value, " under %s" % context if context else ""))

    # Each context is resolved on its own, base colors standing in for
    # the roles it does not override. That is the page as it actually
    # paints: on admin.html the section names take the instrument's
    # muted token and the other two roles keep theirs, and the three
    # still have to be three.
    for context in sorted({context for context, _ in colors}):
        by_color = {}
        for role in sorted(LABEL_ROLES):
            value = colors.get((context, role), colors.get(("", role)))
            if value is not None:
                by_color.setdefault(normalized_color(value), []).append(role)

        for value, roles in sorted(by_color.items()):
            if len(roles) > 1:
                problems.append(
                    "paints %s the same %s%s. A label that %s and one that %s "
                    "are different claims about the page and cannot look "
                    "identical"
                    % (" and ".join(".%s" % role for role in roles), value,
                       " under %s" % context if context else "",
                       LABEL_ROLES[roles[0]], LABEL_ROLES[roles[1]]))

    return problems


# The one name each destination answers to. Pinned here because the same
# name is written in eight places - three hand-copied rails, a title and
# a heading - and a rename that reaches seven of them leaves a site
# arguing with itself about what its own pages are called (#127).
#
# The heading and the title are checked as well as the rails, which is
# the half a rail-parity rule cannot reach: three rails agreeing with
# each other and disagreeing with the page they open is exactly the
# drift that issue inventoried.
SITE_TITLE = "HangGang"

DESTINATIONS = {
    "404.html": "Not found",
    "admin.html": "Admin",
    "dashboard.html": "Progress",
    "index.html": "Sign in",
    "submit.html": "Your binder",
}

HEADING = re.compile(r"<h1[^>]*>(.*?)</h1>", re.S | re.I)
TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.S | re.I)


# An href that leaves this site. Read before anything is stripped,
# because the scheme is what makes it somebody else's page - and the
# name table has nothing to say about a page it does not publish.
OFF_SITE = re.compile(r"^(?:[a-z][a-z0-9+.-]*:|//)", re.I)


def rail_target(href):
    """The page one rail href names, or None if it names no page here.

    #127's motivating example came back through the missing half of
    this. `if href in DESTINATIONS` reads "./admin.html" as something
    other than a destination and skips it in silence, so the rails could
    call the admin page Export again with the whole gate green - a
    membership test with no else-branch fails open, and the browser
    resolves both spellings to the same file.

    Only the spellings that mean the same page are folded together. A
    directory in the path is left in place, so a rail pointing somewhere
    this table does not name is reported rather than quietly renamed
    into a page that exists.
    """
    target = href.strip().split("#", 1)[0].split("?", 1)[0]
    if OFF_SITE.match(target):
        return None
    target = re.sub(r"^\./", "", target)
    target = re.sub(r"^/", "", target)
    return target or "index.html"  # the bare directory is its index


def page_name_problems(text, expected):
    """[problem] for one page's markup disagreeing about its own name."""
    problems = []

    heading = HEADING.search(text)
    if not heading:
        problems.append("carries no <h1>, so it does not say what page "
                        "it is")
    elif label_text(heading.group(1)) != expected:
        problems.append('is called "%s" and its heading says "%s"'
                        % (expected, label_text(heading.group(1))))

    title = TITLE.search(text)
    wanted = "%s — %s" % (expected, SITE_TITLE)
    if not title:
        problems.append("carries no <title>")
    elif label_text(title.group(1)) != wanted:
        problems.append(
            'has the title "%s", and this page is "%s" - a tab and a '
            "bookmark are where a name is read most often"
            % (label_text(title.group(1)), wanted))

    # Every rail on every page, not only the entry pointing at itself.
    # A rename lands on the page being renamed first and on the two
    # copies elsewhere last, so the copies are what this is for.
    for href, shown in rail_links(text) or []:
        target = rail_target(href)
        if target is None:
            continue  # somebody else's page, and not this table's to name
        if target not in DESTINATIONS:
            problems.append(
                "has a rail entry pointing at %s, which names no destination "
                "in DESTINATIONS in tools/check_web.py. Say what that page is "
                "called, or fix the link - a rail entry this table cannot "
                "resolve is one no rename will ever reach" % href)
        elif label_text(shown) != DESTINATIONS[target]:
            problems.append(
                'has a rail calling %s "%s", and that page is called "%s"'
                % (href, label_text(shown), DESTINATIONS[target]))

    return problems


def name_problems():
    """(page, problem) for surfaces that disagree about a page's name."""
    problems = []
    pages = html_pages()

    for name in sorted(set(pages) - set(DESTINATIONS)):
        problems.append((
            name,
            "is published and names no destination in DESTINATIONS in "
            "tools/check_web.py. Say what this page is called, once, so "
            "its rail entry, its title and its heading cannot drift apart"))
    for name in sorted(set(DESTINATIONS) - set(pages)):
        problems.append((
            name,
            "is pinned in DESTINATIONS in tools/check_web.py and is not a "
            "page in apps/web. Delete the entry, or restore the page"))

    for name in pages:
        if name not in DESTINATIONS:
            continue
        for problem in page_name_problems(page_text(name),
                                          DESTINATIONS[name]):
            problems.append((name, problem))

    return problems


# Which surface each page belongs to, pinned for the reason SHELLS gives
# one table down: a rule derived from what a page happens to contain
# cannot fail when a page arrives carrying the wrong one.
#
# INSTRUMENT is admin.html and the owner's decision on #73 - deliberately
# cooler than the member pages, and visibly labeled as the admin surface
# so nobody has to infer from the content which one they are looking at.
# MEMBER is everything else, including the error page: whoever lands
# there is not being told they have found the admin panel.
SURFACES = {
    "404.html": "member",
    "admin.html": "instrument",
    "dashboard.html": "member",
    "index.html": "member",
    "submit.html": "member",
}

INSTRUMENT_BODY = re.compile(
    r'<body[^>]*\bclass\s*=\s*["\'][^"\']*\binstrument\b', re.I)
SURFACE_MARK = re.compile(
    r'<p\s+[^>]*class\s*=\s*["\'][^"\']*\bsurface-mark\b[^"\']*["\'][^>]*>'
    r'(.*?)</p>', re.S | re.I)


def surface_problems():
    """(page, problem) for pages wearing the wrong surface, or none."""
    problems = []
    pages = html_pages()

    for name in sorted(set(pages) - set(SURFACES)):
        problems.append((
            name,
            "is published and names no surface in SURFACES in tools/"
            "check_web.py. Say whether it is a member-facing page or the "
            "admin instrument, so the next page copied from an open tab "
            "cannot inherit the wrong one in silence"))
    for name in sorted(set(SURFACES) - set(pages)):
        problems.append((
            name,
            "is pinned in SURFACES in tools/check_web.py and is not a page "
            "in apps/web. Delete the entry, or restore the page"))

    for name in pages:
        if name not in SURFACES:
            continue
        for problem in page_surface_problems(page_text(name), SURFACES[name]):
            problems.append((name, problem))

    return problems


def page_surface_problems(text, surface):
    """[problem] for one page's markup wearing the wrong surface."""
    problems = []
    marked = SURFACE_MARK.search(text)

    if surface == "instrument":
        if not INSTRUMENT_BODY.search(text):
            problems.append(
                "is the admin instrument and its <body> does not say so, "
                "so it renders in the member pages' warmth")
        if not marked or not label_text(marked.group(1)):
            problems.append(
                "is the admin instrument and carries no visible surface "
                "mark. The owner's decision is that this page is "
                "unmistakably the admin surface, and a reader cannot be "
                "asked to infer that from the content")
        return problems

    # The copy-paste direction, which is the arm worth having: a page
    # built by copying admin.html keeps its clothes, and a member page
    # that announces itself as the admin surface is a page somebody
    # stops trusting.
    if INSTRUMENT_BODY.search(text):
        problems.append("is member-facing and its <body> claims the admin "
                        "instrument surface")
    if marked:
        problems.append("is member-facing and carries the admin surface "
                        "mark")

    return problems


# The instrument's clothes, in the stylesheet. This half exists for the
# reason check 16's does: the markup half makes a page DECLARE which
# surface it belongs to, and a declaration nothing renders is a class
# attribute. Deleting every body.instrument rule and the nameplate left
# admin.html painting exactly like a member page with the markup half
# still green, so "carries that surface's clothes" was a claim no arm
# was making.
INSTRUMENT_SELECTOR = re.compile(r"(^|[\s,>+~])body\.instrument\b", re.I)
SURFACE_MARK_CLASS = ".surface-mark"

# What "deliberately cooler" is a claim about. A body.instrument block
# that only moves spacing around leaves the member pages' warmth exactly
# where it was, which is the half of the owner's decision on #73 that a
# reader actually sees.
COLOR_PROPERTY = re.compile(
    r"(?<![\w-])(?:color|background|background-color|border|border-color)"
    r"\s*:", re.I)


def surface_style_problems():
    """[problem] for a stylesheet with no admin instrument in it."""
    css = stylesheet_text()
    return [] if css is None else css_surface_problems(css)


def css_surface_problems(css):
    """[problem] for stylesheet text that dresses no admin instrument."""
    problems = []
    instrument = []
    nameplate = []

    for selectors, block in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
        for part in selectors.split(","):
            part = part.strip()
            if INSTRUMENT_SELECTOR.search(part):
                instrument.append(block)
            if part == SURFACE_MARK_CLASS:
                nameplate.append(block)

    if not instrument:
        problems.append(
            "defines nothing for body.instrument, so admin.html renders in "
            "the member pages' clothes and the class its markup carries "
            "means nothing. SURFACES in tools/check_web.py pins which page "
            "is the instrument; this is where the instrument gets its look")
    elif not any(COLOR_PROPERTY.search(block) for block in instrument):
        problems.append(
            "gives body.instrument no color of its own - every rule under it "
            "moves spacing only, so the admin surface keeps the member "
            "pages' warmth that the owner's decision on #73 spends to tell "
            "the two apart")

    if not nameplate:
        problems.append(
            "defines no %s, so the nameplate saying which surface this is "
            "has no band to sit in. The decision is that a reader never has "
            "to infer the surface from the content, and unstyled prose above "
            "the page is what that decision was made against"
            % SURFACE_MARK_CLASS)
    elif not any(COLOR_PROPERTY.search(block) for block in nameplate):
        problems.append(
            "gives %s no color, background or border, so the nameplate "
            "renders as an ordinary sentence and marks nothing"
            % SURFACE_MARK_CLASS)

    return problems


COUNTRIES_FILE = "countries.js"


def promoted_country_problems():
    """(code, problem) for promoted codes with no country behind them."""
    path = os.path.join(WEB, COUNTRIES_FILE)
    if not os.path.exists(path):
        return []  # check 1's to report
    text = strip_js_comments(open(path, encoding="utf-8").read())

    promoted = re.search(
        r"BINDER_COUNTRIES_PROMOTED\s*=\s*\[(.*?)\]", text, re.S)
    if not promoted:
        return []  # no promoted block is a legitimate state
    codes = re.findall(r"[\"']([^\"']+)[\"']", promoted.group(1))

    known = set(re.findall(r"^\s*([A-Z]{2})\s*:", text, re.M))
    problems = []
    seen = set()
    for code in codes:
        if code in seen:
            problems.append((
                code,
                "is promoted twice, so it appears twice in the block at the "
                "top of the dropdown"))
        seen.add(code)
        if code not in known:
            problems.append((
                code,
                "is not a country in %s. form.js skips it, so the dropdown "
                "would simply be missing it at the top with nothing "
                "reporting why" % COUNTRIES_FILE))
    return problems


FORM_PAGE = "submit.html"

# The two halves of the units default, as they appear in the markup.
UNIT_SYSTEMS = ("imperial", "metric")


def units_default_problem():
    """A description of the units default contradicting itself, or None."""
    path = os.path.join(WEB, FORM_PAGE)
    if not os.path.exists(path):
        return None  # check 1's to report
    text = re.sub(r"<!--.*?-->", "", open(path, encoding="utf-8").read(),
                  flags=re.S)

    checked = [
        system for system in UNIT_SYSTEMS
        if re.search(
            r'<input[^>]*name="units"[^>]*value="%s"[^>]*\bchecked\b' % system,
            text, re.I)
        or re.search(
            r'<input[^>]*\bchecked\b[^>]*name="units"[^>]*value="%s"' % system,
            text, re.I)
    ]
    if len(checked) != 1:
        return ("%s has %d units radio marked checked, not exactly one - the "
                "form would open with no unit system selected, or with two"
                % (FORM_PAGE, len(checked)))

    hidden = {}
    for system in UNIT_SYSTEMS:
        group = re.search(r'<div[^>]*id="%s-fields"[^>]*>' % system, text, re.I)
        if not group:
            return ("%s has no #%s-fields group, so the units toggle has "
                    "nothing to show" % (FORM_PAGE, system))
        hidden[system] = bool(re.search(r"\bhidden\b", group.group(0), re.I))

    wanted = checked[0]
    other = UNIT_SYSTEMS[1 - UNIT_SYSTEMS.index(wanted)]
    if hidden[wanted]:
        return ("%s checks the %s radio but ships #%s-fields hidden, so the "
                "form paints with no inputs at all until applyUnits() runs"
                % (FORM_PAGE, wanted, wanted))
    if not hidden[other]:
        return ("%s checks the %s radio but does not ship #%s-fields hidden, "
                "so the form paints both unit systems at once"
                % (FORM_PAGE, wanted, other))
    return None


# The generated site (#181): apps/web with the comments taken out of the
# CSS and the scripts. Everything else in this file reads apps/web, and
# that is correct - it is the tree a person edits, and dist/ is proved to
# say the same thing by tools/build_web.mjs's token arm, so a property
# established on the source holds for the artifact.
#
# The key scan is the one exception, and it is the right one to make.
# "Do not publish the private key" is the single failure here that cannot
# be undone, and a check that reasons about the published tree instead of
# reading it is a check with an assumption between it and the hazard.
# This one reads both.
PUBLISHED = os.path.join(REPO, "dist")


def key_shaped_content(root_dir=None):
    """(file, description) for anything in a tree resembling a key."""
    hits = []
    root_dir = WEB if root_dir is None else root_dir
    for root, _dirs, names in os.walk(root_dir):
        for name in sorted(names):
            full = os.path.join(root, name)
            rel = os.path.relpath(full, root_dir).replace(os.sep, "/")
            try:
                text = open(full, encoding="utf-8").read()
            except (UnicodeDecodeError, OSError):
                continue  # binary asset - not where a pasted key lands
            for pattern, description in KEY_PATTERNS:
                if re.search(pattern, text, re.I):
                    hits.append((rel, description))
    return hits


# A base64 literal long enough to be a key rather than a coincidence. An
# uncompressed P-256 point is 65 bytes, so the real thing is 88 base64
# characters; 60 leaves room for a truncated paste while staying clear of
# ordinary long strings. Deliberately NOT anchored to a variable name -
# the accident this catches is a bare literal, and giving it a name is
# the one form of it somebody would notice while typing.
KEY_LITERAL = re.compile(r"""["'][A-Za-z0-9+/]{60,}={0,2}["']""")


def key_literal_problem(text):
    """A description of a base64 key-shaped literal in text, or None.

    Separate from the walk below so the rule can be tested on strings.
    #34's mutations all passed because they were written against the
    rule and never reached the parser that had to find the policy
    first; a rule that can only be exercised through the directory it
    guards is the same trap.
    """
    found = KEY_LITERAL.search(text)
    if not found:
        return None
    return ("a base64 key-shaped literal (%d characters, starting %s)"
            % (len(found.group(0)) - 2, found.group(0)[1:13]))


def hard_coded_key_hits():
    """(file, description) for a key literal outside config.js."""
    hits = []
    for root, _dirs, names in os.walk(WEB):
        for name in sorted(names):
            rel = os.path.relpath(os.path.join(root, name), WEB)
            rel = rel.replace(os.sep, "/")
            # The one file allowed to name a key. Its own arms are
            # checked by check 5, which pins production by hostname -
            # so "in config.js" is not the same as "unchecked".
            if rel == CONFIG_FILE:
                continue
            try:
                text = open(os.path.join(root, name), encoding="utf-8").read()
            except (UnicodeDecodeError, OSError):
                continue  # binary asset - not where a pasted key lands
            problem = key_literal_problem(text)
            if problem:
                hits.append((rel, problem))
    return hits


# Which module publishes which global namespace. Pinned here, outside
# every file it describes, for the reason CSP_PAGES and SHELLS give: a
# roster derived from what apps/web happens to contain cannot fail when a
# module is added, and a module being added is exactly when the freeze
# gets left off.
#
# A hand-written list of the modules that satisfy this rule cannot hold.
# #114's is wrong in two ways at once: it names admin.js:203 when the
# line is 287, and it omits signout.js, which is a module and does
# export. Neither is carelessness - a list of the files that satisfy a
# property goes stale the moment a file changes, and nothing reads it to
# find out.
MODULE_EXPORTS = {
    "admin.js": "BinderAdmin",
    "auth.js": "BinderAuth",
    "config.js": "BINDER_CONFIG",
    "crypto.js": "BinderCrypto",
    "dashboard.js": "BinderDashboard",
    "form.js": "BinderForm",
    "query.js": "BinderQuery",
    "session.js": "BinderSession",
    "signout.js": "BinderSignOut",
    "ui.js": "BinderUI",
    "xlsx.js": "BinderXlsx",
}

# The scripts that publish no namespace, each with the reason. Listed
# rather than inferred, so that a page script quietly growing an export
# is a gate failure instead of a diff nobody reads. AGENTS.md, "Code
# standards": `(function () { ... })()` assigns no global, and that shape
# is a decision these files have already made.
NO_MODULE_EXPORT = {
    "countries.js": "is two data tables the form reads",
    "nav.js": "wires the current-destination mark and the Theme "
              "disclosure in place and returns",
    "public.js": "wires dashboard.html and calls into BinderDashboard",
    "submit.js": "wires submit.html and calls into BinderForm",
    "theme-init.js": "sets the pre-paint theme attribute and returns",
    "theme.js": "wires the theme chips in place",
}

# Globals that are deliberately not frozen namespaces. Narrow, named, and
# each carrying its reason - the same shape as UNENCRYPTED_SENDERS above,
# and for the same argument: an exemption list stays reviewable, while
# relaxing the rule for every global would not.
#
# Note what these are NOT: an assertion that freezing them would be wrong,
# only that they are data or a callback rather than a namespace of helpers
# the freeze rule was written for. BINDER_CONFIG is deliberately absent from
# this list: it carries the publicKey form.js encrypts to, so a script that
# rewrites it redirects every submission to a key the keyholder does not
# hold. It is held to the freeze rule through MODULE_EXPORTS and locked
# non-writable by config_environments, not exempted here - do not move it
# back.
NON_NAMESPACE_GLOBALS = {
    ("countries.js", "BINDER_COUNTRIES"):
        "the country name table the form reads",
    ("countries.js", "BINDER_COUNTRIES_PROMOTED"):
        "the promoted country codes, which check 9 reconciles",
    ("auth.js", "onTelegramAuth"):
        "the callback Telegram's widget invokes by name from its own script",
}

# `root.`, `globalThis.`, `window.` and `self.` all reach the same
# object. All four are recognized because countries.js genuinely
# publishes through `window.` - a pattern that knew only the spellings
# its author had in mind would have been blind to an export style
# already in this directory, which is how a check ends up armed-looking
# and inert.
GLOBAL_OBJECT = r"(?:root|globalThis|window|self)"

# `= ` and not `==`, `===`, `>=`, `<=` or `!=`: this is an assignment,
# not a comparison.
GLOBAL_ASSIGNMENT = re.compile(
    r"(?<![\w$.])%s\.([A-Za-z_$][\w$]*)\s*=(?!=)" % GLOBAL_OBJECT)

# The late edit. `root.BinderDashboard.render = render` matches this and
# deliberately does NOT match GLOBAL_ASSIGNMENT, because what follows the
# namespace there is a dot rather than an equals sign.
GLOBAL_MEMBER_ASSIGNMENT = re.compile(
    r"(?<![\w$.])%s\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*=(?!=)"
    % GLOBAL_OBJECT)


def frozen_publish(code, namespace):
    """Whether a namespace is published through Object.freeze."""
    return re.search(
        r"(?<![\w$.])%s\.%s\s*=\s*Object\.freeze\s*\("
        % (GLOBAL_OBJECT, re.escape(namespace)), code)


def export_problems(name, text, namespace):
    """[problem] for one script's global assignments.

    Takes the source rather than a path so the rules can be exercised on
    strings. That is #34's lesson applied again: a mutation written
    against the nine files in this directory tests today's directory,
    and what has to hold is the shape of the failure.

    `namespace` is what this file is pinned to publish, or None for a
    file pinned to publish nothing. Both are assertions. A file pinned
    to publish that assigns nothing is reported as absence - the case a
    checker that only scans for unfrozen assignments cannot tell apart
    from a directory with nothing wrong in it.
    """
    code = strip_js_comments(text)

    assignments = {}
    for found in GLOBAL_ASSIGNMENT.finditer(code):
        assignments.setdefault(found.group(1), []).append(
            line_of(code, found.start()))

    problems = []

    if namespace is None:
        for other in sorted(assignments):
            if (name, other) in NON_NAMESPACE_GLOBALS:
                continue
            problems.append(
                "assigns the global %s at line %d while pinned in "
                "NO_MODULE_EXPORT as publishing nothing. Pin it in "
                "MODULE_EXPORTS so it is held to the freeze rule, or record "
                "in NON_NAMESPACE_GLOBALS why it is not a namespace"
                % (other, assignments[other][0]))
        return problems

    lines = assignments.get(namespace)
    if not lines:
        problems.append(
            "is pinned in MODULE_EXPORTS as publishing %s and assigns it "
            "nowhere. Either the export was renamed or removed and this pin "
            "is stale, or the file stopped exporting - say which. A roster "
            "entry nothing answers to is a check that cannot fail, which is "
            "worse than no check at all" % namespace)
        return problems

    if len(lines) > 1:
        problems.append(
            "assigns %s %d times, at lines %s. One object with two publish "
            "sites is frozen only on whichever ran last, and a reader has "
            "no way to tell which that is"
            % (namespace, len(lines),
               ", ".join(str(n) for n in lines)))

    if not frozen_publish(code, namespace):
        problems.append(
            "assigns %s at line %d without Object.freeze. AGENTS.md, \"Code "
            "standards\": exported objects are frozen, so a page cannot "
            "quietly redefine a helper another page depends on"
            % (namespace, lines[0]))

    for found in GLOBAL_MEMBER_ASSIGNMENT.finditer(code):
        if found.group(1) != namespace:
            continue
        problems.append(
            "assigns %s.%s at line %d, after the object is published. A "
            "member bolted on later cannot be covered by a freeze at the "
            "assignment - freezing there makes this line throw instead - so "
            "the object every page already holds a reference to stays "
            "editable for as long as the module is still running. Build the "
            "whole object, then freeze once"
            % (namespace, found.group(2), line_of(code, found.start())))

    for other in sorted(assignments):
        if other == namespace or (name, other) in NON_NAMESPACE_GLOBALS:
            continue
        problems.append(
            "assigns a second global %s at line %d, which no table in "
            "tools/check_web.py names. Every global this directory "
            "publishes is pinned somewhere, so that adding one is a "
            "decision somebody wrote down"
            % (other, assignments[other][0]))

    return problems


def module_export_problems():
    """(file, problem) for the export roster and every module's freeze."""
    problems = []
    scripts = {n for n in os.listdir(WEB) if n.endswith(".js")}

    # The roster itself, both directions, before a single file is read.
    # Without these the rules below describe whichever scripts the tables
    # happen to name, which is the failure the tables exist to prevent.
    for name in sorted(scripts - set(MODULE_EXPORTS) - set(NO_MODULE_EXPORT)):
        problems.append((
            name,
            "is published but is named in neither MODULE_EXPORTS nor "
            "NO_MODULE_EXPORT in tools/check_web.py. Say which namespace it "
            "publishes, or that it publishes none, so the next module "
            "cannot start the count over"))

    both = set(MODULE_EXPORTS) & set(NO_MODULE_EXPORT)
    for name in sorted(both):
        problems.append((
            name,
            "is named in both MODULE_EXPORTS and NO_MODULE_EXPORT in "
            "tools/check_web.py. The tables contradict each other, so "
            "whichever rule ran would look like the whole rule"))

    for name in sorted((set(MODULE_EXPORTS) | set(NO_MODULE_EXPORT))
                       - scripts):
        problems.append((
            name,
            "is pinned in tools/check_web.py and is not a script in "
            "apps/web. Delete the entry, or restore the file"))

    for name in sorted(scripts):
        if name in both:
            continue  # already reported; the pin is ambiguous
        if name not in MODULE_EXPORTS and name not in NO_MODULE_EXPORT:
            continue  # already reported as unpinned
        text = open(os.path.join(WEB, name), encoding="utf-8").read()
        for problem in export_problems(name, text, MODULE_EXPORTS.get(name)):
            problems.append((name, problem))

    # The exemption list, checked for staleness in the same pass. An
    # exemption that no longer matches anything is a standing permission
    # nobody is using, and the next global to take that name inherits it
    # in silence - the argument UNENCRYPTED_SENDERS makes above.
    for name, other in sorted(NON_NAMESPACE_GLOBALS):
        if name not in scripts:
            problems.append((
                name,
                "is named in NON_NAMESPACE_GLOBALS in tools/check_web.py "
                "and is not a script in apps/web. Remove the stale "
                "exemption"))
            continue
        code = strip_js_comments(
            open(os.path.join(WEB, name), encoding="utf-8").read())
        if other not in [found.group(1)
                         for found in GLOBAL_ASSIGNMENT.finditer(code)]:
            problems.append((
                name,
                "is exempted in NON_NAMESPACE_GLOBALS for the global %s, "
                "which it no longer assigns. Remove the stale exemption so "
                "a later global cannot inherit it silently" % other))

    return problems


CHART_FILE = "dashboard.js"

# What dashboard.js does instead of naming a series class: it builds one,
# and the built name is the only place the cycle length is written down on
# that side. Anchored on the concatenation rather than on a line number,
# because the producer moves within its file and this shape does not.
#
# A producer spelled some other way - a named constant instead of a
# literal, say - matches nothing here and is reported as ABSENT rather
# than passed over. That direction is deliberate: the stylesheet's slots
# would then be answering to a number this check cannot read, and a rule
# that has lost its subject must say so.
SERIES_CYCLE = re.compile(
    r"""["'][^"']*\bseries-["']\s*\+\s*"""
    r"""\(\s*[A-Za-z_$][\w$]*\s*%\s*(\d+)\s*\)""")

# The stylesheet's three halves of the same number. Stroke on the line,
# fill on the shapes meant to be solid, and the value each slot resolves
# to, one set per palette.
SERIES_STROKE = re.compile(r"^\.series-(\d+)$")
SERIES_FILL = re.compile(r"^(?:circle|text)\.series-(\d+)$")
SERIES_TOKEN = re.compile(r"--color-series-(\d+)\s*:")


def series_cycle_length(js):
    """How many slots the chart script cycles through, or None."""
    found = SERIES_CYCLE.search(js)
    return int(found.group(1)) if found else None


def stylesheet_series(css):
    """(stroke slots, fill slots, [(palette, slots)]) out of stylesheet text.

    Takes the text rather than reading the file, for the reason
    css_role_problems() gives: a rule exercised only through the
    directory it guards is a rule tested against today's content.
    """
    stroke = set()
    fill = set()
    palettes = []
    for selectors, block in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
        for part in selectors.split(","):
            part = part.strip()
            found = SERIES_STROKE.match(part)
            if found:
                stroke.add(int(found.group(1)))
            found = SERIES_FILL.match(part)
            if found:
                fill.add(int(found.group(1)))
        slots = {int(n) for n in SERIES_TOKEN.findall(block)}
        if slots:
            palettes.append((re.sub(r"\s+", " ", selectors).strip(), slots))
    return stroke, fill, palettes


def missing_slots(slots, cycle):
    """Which of 0..cycle-1 a set lacks, and which it has beyond them."""
    wanted = set(range(cycle))
    return sorted(wanted - slots), sorted(slots - wanted)


def css_series_problems(css, js):
    """[problem] for a chart script and a stylesheet that disagree on slots.

    The trap, restated where somebody reading a failure meets it: no
    .series-N name appears as a literal string anywhere in this
    repository, so every one of these selectors looks unused to a search
    and none of them is.
    """
    problems = []
    cycle = series_cycle_length(js)
    if cycle is None:
        return ["apps/web/%s composes no series class this check can read, "
                "so nothing says how many slots theme.css must define. The "
                "shape it reads is a string ending \"series-\" concatenated "
                "with a modulo - if the chart now picks its slot some other "
                "way, teach this check the new shape rather than leaving "
                "the stylesheet's slots answering to nothing" % CHART_FILE]
    if not cycle:
        return ["apps/web/%s cycles through 0 series slots, so every chart "
                "line would divide by zero picking one" % CHART_FILE]

    stroke, fill, palettes = stylesheet_series(css)

    absent, extra = missing_slots(stroke, cycle)
    if absent:
        problems.append(
            "apps/web/%s cycles through %d series slots and apps/web/%s "
            "defines no .series-%s rule, so a chart line at that slot is "
            "stroked in whatever color it inherits - which is the color "
            "of the line beside it, on the one chart whose job is telling "
            "two people apart"
            % (CHART_FILE, cycle, STYLESHEET,
               ", .series-".join(str(n) for n in absent)))
    if extra:
        problems.append(
            "apps/web/%s defines .series-%s, past the %d slots apps/web/%s "
            "cycles through, so those rules render never"
            % (STYLESHEET, ", .series-".join(str(n) for n in extra),
               cycle, CHART_FILE))

    if fill != stroke:
        problems.append(
            "apps/web/%s strokes slots %s but fills %s. The dot on a point "
            "and the handle at the end of a line wear the same class as the "
            "line does, so a slot with a stroke and no fill draws its "
            "history in one color and labels it in another"
            % (STYLESHEET, sorted(stroke) or "none", sorted(fill) or "none"))

    if not palettes:
        problems.append(
            "apps/web/%s sets no --color-series-N anywhere, so every "
            ".series-N rule above resolves to an unset custom property and "
            "the chart draws in one color" % STYLESHEET)
    for palette, slots in palettes:
        short, over = missing_slots(slots, cycle)
        if short or over:
            problems.append(
                "apps/web/%s gives \"%s\" the series values %s, and there "
                "are %d slots to fill. A palette is copied from the one "
                "open at the time and trimmed, and the chart only looks "
                "wrong on that theme"
                % (STYLESHEET, palette, sorted(slots), cycle))

    return problems


def series_problems():
    """[problem] for the shipped stylesheet and the shipped chart script."""
    css = stylesheet_text()
    path = os.path.join(WEB, CHART_FILE)
    if css is None or not os.path.exists(path):
        return []  # check 1's to report
    return css_series_problems(
        css, strip_js_comments(open(path, encoding="utf-8").read()))


PREPAINT_SCRIPT = "theme-init.js"

HEAD_CLOSE = re.compile(r"</head\s*>", re.I)
BODY_CLOSE = re.compile(r"</body\s*>", re.I)
SCRIPT_OPEN = re.compile(r"<script\b[^>]*>", re.I)
SCRIPT_ELEMENT = re.compile(r"<script\b[^>]*>.*?</script\s*>", re.S | re.I)

# A bare attribute name, so a filename containing the word does not read
# as the attribute. Both are valueless in practice and both are accepted
# with a value, because HTML accepts defer="defer".
LOADING_ATTRIBUTE = re.compile(r"(?:^|\s)(defer|async)(?=[\s/>=])", re.I)

# Anything that is not a same-origin path: a scheme, a protocol-relative
# host, an inline payload.
OFF_ORIGIN = re.compile(r"^(?:[a-z][a-z0-9+.-]*:)?//|^[a-z]+:", re.I)


def tag_attribute(tag, name):
    """One quoted attribute value out of a tag, or None.

    Both quote styles, for the reason the label roles give: an arm that
    walks past a single quote fails open, and the gate then says the
    thing was checked.
    """
    for quote in ('"', "'"):
        found = re.search(r"\b%s\s*=\s*%s([^%s]*)%s"
                          % (name, quote, quote, quote), tag, re.I)
        if found:
            return found.group(1)
    return None


def loading_attribute(tag):
    """"defer", "async", or None for a script tag that carries neither."""
    found = LOADING_ATTRIBUTE.search(tag)
    return found.group(1).lower() if found else None


def same_origin_scripts(markup):
    """(tag, src) for every same-origin <script src> in document order."""
    found = []
    for tag in SCRIPT_OPEN.findall(markup):
        source = tag_attribute(tag, "src") or ""
        if source and not OFF_ORIGIN.match(source):
            found.append((tag, source))
    return found


def page_body(text):
    """The markup between </head> and </body>, or None if either is absent."""
    head_close = HEAD_CLOSE.search(text)
    body_close = BODY_CLOSE.search(text)
    if not head_close or not body_close:
        return None
    return text[head_close.end():body_close.start()]


def page_script_run(text):
    """The site's own scripts on one page, in the order they execute."""
    body = page_body(text)
    return [] if body is None else [src for _tag, src
                                    in same_origin_scripts(body)]


def page_loading_problems(text):
    """[problem] for one page's script placement and loading attributes.

    Takes the page text with comments already gone, so both arms can be
    exercised on strings rather than only through the five files that
    happen to exist.
    """
    head_close = HEAD_CLOSE.search(text)
    body_close = BODY_CLOSE.search(text)
    if not head_close or not body_close:
        return ["has no %s, so where its scripts sit cannot be read. A "
                "check that cannot find its subject reports that rather "
                "than passing" % ("</head>" if not head_close else "</body>")]

    problems = []
    head = text[:head_close.start()]
    body = text[head_close.end():body_close.start()]

    head_scripts = SCRIPT_OPEN.findall(head)
    prepaint = [tag for tag in head_scripts
                if tag_attribute(tag, "src") == PREPAINT_SCRIPT]

    for tag in head_scripts:
        if tag in prepaint:
            continue
        problems.append(
            "loads %s in its head. %s is the only script that may block "
            "there, and it earns that by painting the saved palette "
            "before the first frame - a head that scripts live in is a "
            "head where the next one arrives without anybody weighing it"
            % (tag_attribute(tag, "src") or "an inline script",
               PREPAINT_SCRIPT))

    for tag in prepaint:
        attribute = loading_attribute(tag)
        if attribute:
            problems.append(
                "gives %s the %s attribute, which is the one edit that "
                "silently undoes it: the browser then paints the default "
                "palette and corrects it a frame later. It is a file "
                "rather than an inline script because the CSP forbids "
                "'unsafe-inline', and it is worth that request only while "
                "it blocks" % (PREPAINT_SCRIPT, attribute))

    if not prepaint:
        problems.append(
            "carries no %s in its head, so it paints the default palette "
            "and corrects it once the body runs" % PREPAINT_SCRIPT)

    own = same_origin_scripts(body)
    for tag, source in own:
        attribute = loading_attribute(tag)
        if attribute:
            problems.append(
                "gives %s the %s attribute. The site's own scripts run at "
                "the end of the body, classic and in document order, and "
                "check 22's entry in this file records why - moving one "
                "means moving the run and changing that check in the same "
                "diff" % (source, attribute))

    if own:
        first = body.index(own[0][0])
        tail = SCRIPT_ELEMENT.sub("", body[first:])
        if tail.strip():
            problems.append(
                "puts content after the run of scripts at the end of its "
                "body. Two of those files query the document at top level "
                "with nothing guarding them, so markup below them is "
                "markup they may not find. Scripts and whitespace only "
                "down there, or move the run and say so here")

    return problems


# A namespace TAKEN OFF the global object, which is the form that makes
# document order load-bearing. `const UI = root.BinderUI;` runs the moment
# the file does, so a script placed above its publisher captures undefined
# and every later call reads a member of nothing.
#
# The prefix is what makes this narrow enough to be worth having. The
# names also appear in prose and in messages, and a bare search for
# "BinderUI" would order a page against a sentence. Measured rather than
# assumed before it was written this way: across every script in apps/web
# the prefixed and unprefixed counts are identical, every one of the 24
# references, so nothing is lost by requiring the prefix.
CAPTURED_NAMESPACE = r"%s\s*\.\s*%%s\b" % GLOBAL_OBJECT


def module_captures(js):
    """The namespaces one script takes off the global object."""
    return {namespace for namespace in set(MODULE_EXPORTS.values())
            if re.search(CAPTURED_NAMESPACE % namespace, js)}


def run_order_problems(run, captures):
    """[problem] for a run of scripts that reads a namespace too early.

    Pure, over a run and a capture map, because the hazard is a page's
    ORDER and a rule exercised only against the five orders that exist
    today is a rule tested against today's content.
    """
    publisher = {namespace: name for name, namespace in MODULE_EXPORTS.items()}
    at = {}
    for index, name in enumerate(run):
        at.setdefault(name, index)

    problems = []
    for name in run:
        for namespace in sorted(captures.get(name, ())):
            owner = publisher.get(namespace)
            if owner is None or owner == name:
                continue
            if owner not in at:
                problems.append(
                    "loads %s, which takes %s off the global object as it "
                    "runs, and never loads %s. It captures undefined, and "
                    "the failure surfaces wherever that value is next read "
                    "rather than here" % (name, namespace, owner))
            elif at[owner] > at[name]:
                problems.append(
                    "loads %s before %s. %s takes %s off the global object "
                    "as it runs, so it captures undefined - and these "
                    "modules guard on the captured value, which means the "
                    "page does not throw, it goes quiet"
                    % (name, owner, name, namespace))
    return problems


def loading_problems():
    """(page, problem) for every published page's loading shape."""
    captures = {}
    for name in sorted(os.listdir(WEB)):
        if name.endswith(".js"):
            captures[name] = module_captures(strip_js_comments(
                open(os.path.join(WEB, name), encoding="utf-8").read()))

    problems = []
    for name in html_pages():
        text = open(os.path.join(WEB, name), encoding="utf-8").read()
        text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
        for problem in page_loading_problems(text):
            problems.append((name, problem))
        for problem in run_order_problems(page_script_run(text), captures):
            problems.append((name, problem))
    return problems


# One palette chip's opening tag. Any element, not <button>, because
# theme.js wires `document.querySelectorAll("[data-set-theme]")` and a
# reader narrower than the thing it describes is a reader that goes
# quiet on the day a chip is written some other way. It is found by its
# attribute rather than by walking the group, so a chip that escapes
# the group's div is still read.
CHIP_OPEN = re.compile(r"<(\w+)\b([^>]*\bdata-set-theme\s*=[^>]*)>", re.I)

CHIP_ATTRIBUTE = "data-set-theme"

# What a failure with no page to blame is attributed to. The pin is the
# subject in that case, not any one page.
CHIP_PIN = "THEMED_PAGES in tools/check_web.py"


def page_chips(text):
    """[(id, label)] for one page's palette chips, in document order.

    `label` is None for a chip whose element never closes, which says
    something different from a chip carrying no words - the two send
    whoever reads the failure to look at different things.

    Takes comment-stripped markup, for the reason page_text() gives:
    submit.html's note on the "Parchment Daylight" ruling names this
    attribute repeatedly, and a rule reading a page's comments is
    describing markup the page does not have.
    """
    chips = []
    for found in CHIP_OPEN.finditer(text):
        tag, attributes = found.group(1), found.group(2)
        closing = re.compile(r"</%s\s*>" % re.escape(tag), re.I)
        end = closing.search(text, found.end())
        label = label_text(text[found.end():end.start()]) if end else None
        chips.append((tag_attribute(attributes, CHIP_ATTRIBUTE) or "",
                      label))
    return chips


def chip_roster_problems(text):
    """[problem] for one page's own chips, before any page is compared.

    A page failing here is left out of the comparison below, because a
    roster this file could not read whole is not evidence about another
    page - but it is REPORTED, never skipped. Failing open is the
    default for a reader, and #152 exists because three separate rules
    each stopped short of the chips in silence.
    """
    problems = []
    chips = page_chips(text)

    counted = len(CHIP_MARKUP.findall(text))
    if counted != len(chips):
        problems.append(
            "carries %d %s attribute(s) and this check pairs %d of them "
            "with a label. CHIP_MARKUP is what check 19 counts a chip by, "
            "so a chip that check can see and this one cannot read is a "
            "chip nothing compares - teach the reader in "
            "tools/check_web.py the shape that got past it, rather than "
            "leaving the comparison below to run on what is left"
            % (counted, CHIP_ATTRIBUTE, len(chips)))

    seen = set()
    for name, label in chips:
        if not name:
            problems.append(
                "carries a %s chip with an empty id. theme.js stores that "
                "string as the member's palette preference, so a chip with "
                "nothing in it returns whoever presses it to the default "
                "and reports success" % CHIP_ATTRIBUTE)
        elif name in seen:
            problems.append(
                "carries two chips for the palette \"%s\". A page "
                "disagreeing with itself is not something comparing it "
                "with another page can settle" % name)
        else:
            seen.add(name)

        if label is None:
            problems.append(
                "carries a chip for \"%s\" whose element never closes, so "
                "there are no words to compare and the rest of the page is "
                "inside the button" % (name or CHIP_ATTRIBUTE))
        elif not label:
            problems.append(
                "carries a chip for \"%s\" with no visible words in it. "
                "The id is what gets stored; the label is the only part a "
                "member ever reads" % name)

    return problems


def chip_parity_problems(rosters):
    """[(subject, problem)] for chip rosters that disagree.

    `rosters` is {page: [(id, label)]} for the pages whose own chips
    read clean. Compared against whichever page sorts first, for the
    reason rail parity gives: a message naming a specific page to go
    and look at beats one saying that they differ.
    """
    if len(rosters) < 2:
        return [(CHIP_PIN,
                 "leaves this arm %d roster to compare. Parity is a claim "
                 "about copies, and a rule holding one copy cannot fail - "
                 "which is the failure #114 paid for. Either the pages "
                 "that offer a palette come back, or this arm has outlived "
                 "its subject and goes out with the reason written down"
                 % len(rosters))]

    problems = []
    reference = sorted(rosters)[0]
    for name in sorted(rosters):
        if name == reference:
            continue
        here, there = rosters[name], rosters[reference]
        ids_here = [i for i, _ in here]
        ids_there = [i for i, _ in there]

        missing = [i for i in ids_there if i not in ids_here]
        extra = [i for i in ids_here if i not in ids_there]
        if missing or extra:
            problems.append((
                name,
                "offers a different set of palettes from %s: %s has %s "
                "that this page does not, and this page has %s that %s "
                "does not. A palette offered on some pages and not others "
                "is one a member chooses and then cannot get back to"
                % (reference, reference, missing or "nothing",
                   extra or "nothing", reference)))
            continue

        words = dict(there)
        drifted = [(i, w) for i, w in here if w != words[i]]
        for palette, label in drifted:
            problems.append((
                name,
                "calls the \"%s\" palette %r where %s calls it %r. Every "
                "page writes these buttons out by hand and the id is what "
                "gets stored, so a rename reaching some of the copies "
                "breaks nothing, says nothing, and leaves one palette "
                "wearing two names on one site (#152)"
                % (palette, label, reference, words[palette])))
        if drifted:
            continue

        if ids_here != ids_there:
            problems.append((
                name,
                "offers the same palettes as %s in a different order (%s "
                "against %s). This list is hand-copied exactly as the rail "
                "is, and it drifts the same way - a chip inserted where "
                "the page somebody copied from did not have it"
                % (reference, ids_here, ids_there)))

    return problems


def chip_problems():
    """(subject, problem) for the palette chips across the pinned pages."""
    problems = []
    rosters = {}

    for name in sorted(THEMED_PAGES & set(html_pages())):
        text = page_text(name)
        if not CHIP_MARKUP.search(text):
            # Presence is check 19's, and it fails on this same page,
            # from this same roster, in this same run. Restating it here
            # is what that check's docstring declines to do in the other
            # direction - so the page is left out of the comparison and
            # nothing is lost, because the gate is one exit code.
            continue
        own = chip_roster_problems(text)
        problems.extend((name, problem) for problem in own)
        if not own:
            rosters[name] = page_chips(text)

    return problems + chip_parity_problems(rosters)


def main():
    problems = []
    environments, config_problems = config_environments()

    for page, target in html_references():
        if not os.path.exists(os.path.join(WEB, target.replace("/", os.sep))):
            problems.append("%s references %s, which does not exist"
                            % (page, target))

    for page, description in missing_head_pieces():
        problems.append("%s is missing %s" % (page, description))

    for problem in config_problems:
        problems.append("%s: %s." % (CONFIG_FILE, problem))

    for problem in crossed_wire_problems(environments):
        problems.append("%s: %s." % (CONFIG_FILE, problem))

    origins = []
    for environment in environments:
        origin = endpoint_origin(environment["endpoint"])
        if environment["endpoint"] and not origin:
            problems.append(
                "%s: the %s endpoint is not a literal HTTPS URL." %
                (CONFIG_FILE, environment["host"]))
        if origin:
            origins.append(origin)

        problem = public_key_problem(environment["publicKey"])
        if problem:
            problems.append(
                "%s: the %s arm has %s. Every submission on that hostname "
                "would fail at encryption time." %
                (CONFIG_FILE, environment["host"], problem))

    for page, origin in csp_gaps(origins):
        problems.append(
            "%s does not allow %s in its CSP connect-src, but that is the "
            "endpoint one config.js arm points at - every request would be "
            "blocked by the browser." % (page, origin))

    problem = hidden_attribute_problem()
    if problem:
        problems.append(problem + ".")

    for problem in column_branch_alignment_problems():
        problems.append("%s %s." % (STYLESHEET, problem))

    for page, problem in shell_problems():
        problems.append("%s %s." % (page, problem))

    for page, problem in wordmark_problems():
        problems.append("%s %s." % (page, problem))

    for page, problem in theme_control_page_problems():
        problems.append("%s %s." % (page, problem))

    for code, problem in promoted_country_problems():
        problems.append("%s: the promoted country %s %s."
                        % (COUNTRIES_FILE, code, problem))

    problem = units_default_problem()
    if problem:
        problems.append(
            "%s. The checked radio and the visible field group are the same "
            "decision written twice; applyUnits() hides the disagreement a "
            "moment after the browser has already shown it." % problem)

    for name, problem in unencrypted_paths():
        problems.append(
            "%s %s. Encrypting before anything leaves the browser is the "
            "whole design - see DESIGN.md." % (name, problem))

    for page, problem in sign_in_boundary_problems():
        problems.append("%s %s." % (page, problem))

    for page, problem in csp_policy_problems():
        problems.append("%s %s." % (page, problem))

    for name, problem in module_export_problems():
        problems.append("%s %s." % (name, problem))

    for page, problem in label_problems():
        problems.append("%s %s." % (page, problem))

    for problem in label_style_problems():
        problems.append("%s %s." % (STYLESHEET, problem))

    for page, problem in name_problems():
        problems.append("%s %s." % (page, problem))

    for page, problem in surface_problems():
        problems.append("%s %s." % (page, problem))

    for problem in surface_style_problems():
        problems.append("%s %s." % (STYLESHEET, problem))

    for problem in series_problems():
        problems.append("%s." % problem)

    for page, problem in loading_problems():
        problems.append("%s %s." % (page, problem))

    for subject, problem in chip_problems():
        problems.append("%s %s." % (subject, problem))

    for where in ("apps/web", "dist"):
        root_dir = WEB if where == "apps/web" else PUBLISHED
        if not os.path.isdir(root_dir):
            problems.append(
                "%s is not there, so the key scan read nothing. A scan over "
                "a missing tree finds no keys in exactly the way a clean one "
                "does." % where)
            continue
        for rel, description in key_shaped_content(root_dir):
            problems.append(
                "%s/%s contains %s. dist/ is published to a public site and "
                "apps/web is what builds it - this must not be committed."
                % (where, rel, description))

    for rel, description in hard_coded_key_hits():
        problems.append(
            "apps/web/%s contains %s. Only %s may name a key, so that what "
            "the page shows is derived from the key it actually encrypts to "
            "- a literal still passes every behavioral test after a "
            "rotation, and then certifies the wrong key."
            % (rel, description, CONFIG_FILE))

    if problems:
        for p in problems:
            print("::error::%s" % p)
        print("\napps/web FAILED %d check(s)" % len(problems))
        return 1

    pages = html_pages()
    # "distinct" was the whole claim once, and it was too weak to be worth
    # printing on its own - two arms with their values exchanged are
    # distinct. Say that production was pinned, so the line reports what
    # was actually established rather than the part that is easy to check.
    key_note = ("%d distinct environment keys and endpoints, production "
                "pinned" % len(environments))
    print("apps/web OK - %d page(s), all references resolve, shared head "
          "intact, no key-shaped content, no key literal outside %s, %s"
          % (len(pages), CONFIG_FILE, key_note))
    return 0


if __name__ == "__main__":
    sys.exit(main())
