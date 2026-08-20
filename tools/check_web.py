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
   published, and apps/web is what dist/ is built from (#181) - the
   build strips comments and nothing else, so the moment a key lands in
   this directory it is public, permanently, in the git history as well
   as on the web, whatever the build does. A regex is a weak guard, but
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

6. Nothing *sends a submission* to the network except through crypto.js -
   PRE-0.9-M2-S2's rule, still enforced for what still carries it (admin.html's
   export decrypts client-side). DESIGN.md, "Trust model: the Worker reads"
   retired the rule itself for entry submission: rows are sealed by the
   Worker under its own secret now, not by the browser, so form.js posts
   plaintext on purpose and is a named exemption for exactly that reason -
   the same shape auth.js already was for a sign-in payload. Every other
   sender must name BinderCrypto, and every page loading one must actually
   load crypto.js.

   Sending, not touching. An earlier version of this check counted any
   fetch at all, which was right while every page here either submitted
   or exported, and became wrong the day charts.html arrived: that
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
      The palette control is NOT part of this shell and is check 19's,
      because every page carries one and only three carry a rail.
    - PLAIN. The pages a signed-out visitor meets - the sign-in page,
      which the owner decided carries no rail before sign-in, and the
      error page, which goes plain on principle. These must NOT carry
      rail markup, which is the copy-paste direction: a session home on
      the sign-in page would offer Sign out to somebody who has not
      signed in.

    The anti-stranding rule survives both shells rather than being
    spent on the rail. A rail aside must carry the route to the
    directory index somewhere - since #187 that is the wordmark and
    the session block rather than a destination entry, because the
    door is session state and not navigation, and a Sign in entry
    among the destinations is refused in the same breath. And a plain
    page must still carry at least one local link out of itself, in
    its own HTML, which is what stops "plain" from becoming "a dead
    end with nice typography" - the entrance excepted, since #274 took
    the footers' nav off every page and the entrance is the page every
    dead end already leads back to. Which page that is is pinned as
    SIGN_IN_PAGE, and the pin answers for the exemption in both
    directions.

    The wordmark is the shell's other hand-kept copy, and WORDMARK_PAGES
    rather than this table is what says which pages carry one - the two
    rosters cut the site along different lines, since the sign-in page
    is PLAIN here and carries the name anyway, which is half of
    why nothing was comparing it. The paragraph above says the rail
    "carries the wordmark" while the parity arms read .rail-links and
    the session block and stop there; the name tables read titles,
    headings and the links a page writes a name into; the chip arm
    reads chips. So the site's own name could be renamed on every copy
    but one with the whole gate green, which is #152's
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
    that cannot rotate. your-page.html displays the first 32 characters of
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

19. Every page that offers a palette offers it as a row of swatches,
    in a footer that holds that row and nothing else; every page that
    does not carries no chip at all and no footer.

    The owner's ruling of 2026-08-13 (#274) is that all footers are
    identical, that nav belongs to the rail, and that the palette is
    offered the way index.html has always offered it. So there is one
    shape where there were two: the floating Theme <details> is gone
    from the signed-in pages, and with it the split #187 introduced.
    Which pages offer a palette is pinned in THEMED_PAGES, outside the
    markup, for the reason SHELLS and CSP_PAGES give.

    Three directions have teeth:

    - A disclosure ANYWHERE is the ruling reversed, and it is refused
      by element and by the word "Theme" on a <summary> alike, so a
      panel that comes back having lost its class is still refused.
      The property it costs was never a preference: a control with no
      hidden state cannot be open over the Telegram widget on the page
      that signs anybody in, however its script, its stylesheet or its
      layout fails - and after the ruling every page has it.
    - A LINK in a footer is the nav the ruling removed. It is refused
      whether it points at this site or off it, because the rail is
      what carries nav and an outbound link is nav that leaves. That
      direction is the one nothing else in this file can reach: an
      off-site href is invisible to the name table and to the
      anti-stranding arm by construction, and an on-site link that
      happens to spell the destination's own name satisfies the name
      table exactly.
    - A chip OUTSIDE the swatch row is a palette button standing loose
      in the footer. It was worth an arm while the row was a panel
      that folded, and it is worth the same arm now that the footer is
      supposed to hold the row and nothing else.

    404.html is the one page with no palette control at all, that is
    deliberate, and a chip arriving on it by the usual route would
    change a stored preference from an error page and fail nothing. It
    is therefore also the one page with no footer: the footer is the
    palette row, and a page with no palette has no row to put in one.

    What it pins is presence and shape, on purpose. Whether the copies
    agree about a chip's LABEL is #152's, and two checks making the
    same claim in different places is how one of them gets quietly
    weakened.

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
    - WHAT A LABEL SAYS. #191 ruled the words, "Daylight" over the
      longer label #127 chose included. The reference page below is
      only whichever name sorts first, and a rename that reaches all
      four copies passes here on purpose: agreement is the claim, not
      the wording. A check that pinned the words would have to be
      edited to ship a decision that is the owner's to make.

      Check 24 now makes that edit, and it is the intended act: the
      owner's decision lives in an artifact, and #203 made the
      artifact machine-checked. The seam holds - agreement and order
      stay here, and only the word the four copies agree on is read
      against the mockup there.
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
    failure with a different cause. Three things hold it open:
    theme.js wires `[data-set-theme]` on ANY element, so this reads
    any element rather than <button>; a chip's name is its visible
    words or, where it has none, its aria-label, because a palette is
    offered as a colored dot and a reader that saw only words would
    find no names to compare at all; and the count of chips it pairs
    with a name is reconciled
    against CHIP_MARKUP, which is what check 19 counts a chip by. A
    chip that check can see and this one cannot read is REPORTED,
    never skipped - so the two arms cannot drift into disagreeing
    about what a chip is.

24. The shipped design tokens are the ones the mockup rules: every
    --color-* in each of the four palettes, the shared scale block
    underneath them, the palette names a member reads, and the
    surfaces the mockup rules OUT.

    #203, and the gap it closes is that the design gate was not a
    gate. The artifact "Binder — Site Mockup (post-cutover)" is the
    owner's ruling on styling and design, CI cannot fetch it, and so
    every styling decision in it was enforced by somebody remembering
    to look. What it rules arrives here instead as a hand-derived
    table, pinned outside the file it guards, in the arrangement
    DESTINATIONS and SHELLS are already in and for the review bar's
    reason: a check computed from the stylesheet cannot notice that
    the stylesheet was redesigned.

    The token layer is what is pinned, not the components. Every rule
    in theme.css takes its color, type, spacing and measures from
    these custom properties, so the tokens are the vocabulary the
    mockup and the shipped site actually share - and it is the token
    underneath that a one-character edit moves invisibly. --measure
    from 46rem to 60rem re-lays out five pages and fails nothing.
    Copying the component rules in instead would put a second
    stylesheet inside a Python file, stale on the first honest
    refactor.

    Parity runs both directions on all of it, the DESTINATIONS way: a
    pinned token the stylesheet has stopped declaring, a token it
    declares that the mockup does not rule, a declaring block the
    table does not know, a pinned block that has gone, and the same
    block declared twice - where the last one wins, so a value
    corrected in the wrong copy changes nothing and reads as done.
    Daylight and Contrast are each written out twice, once for the
    attribute a member picks and once for the preference they arrive
    with, kept in step by hand; reading both against one ruled set
    rather than against each other is what stops the drifted copy
    being the reference.

    One arm reads a component rather than the token layer, and it is
    the exception that proves where the seam is. The swatch row - in
    every page's footer since #274 - shows the four palettes at once,
    and a dot cannot ask CSS for a palette other than the one the page
    is wearing, because the tokens are scoped to :root. So those eight
    colors are written on the dot, and held here to the palette the
    mockup rules, in both directions. One stylesheet serves every page,
    so widening the row to four footers widened what this arm is worth
    without moving a line of it.
    Left uncompared they would be four colors that stop meaning the
    palettes they offer the moment one is retuned, and the row would
    go on looking exactly as deliberate as before.

    Two further arms are not about values. The font stacks are read against
    the @font-face rules rather than against the table, because the
    mockup's own note records the one departure it could not avoid -
    the live site serves vendored woff2 where the mockup shows the
    fallback stacks - and a stack leading with a family nothing
    vendors still RESOLVES, to the next name in it. Every page keeps
    rendering, in a face the mockup never showed, and nothing fails.
    And the ruled-out surfaces are refused rather than merely absent,
    in both the markup and the stylesheet, because absence is not a
    claim: the keyholder note #191 deleted is gone from every page
    today and nothing else here would notice it coming back on the
    next page written from an old tab.

    WHAT THIS ARM RESTS ON, named because it is not a property of this
    table or of the file it reads: the tokens govern the site's
    appearance only while theme.css is the only thing painting it, and
    what makes that true is style-src 'self' in every page's CSP. Check
    26 is where that dependency is armed - widen the directive and this
    table goes on comparing a stylesheet the site is no longer styled
    by, with every arm here green.

    WHEN THE OWNER UPDATES THE ARTIFACT, this table is edited in the
    same change as the stylesheet, with the mockup's own words for
    the decision in the commit message - deliberately the same
    two-place act as raising a ceiling in tools/check_budget.py. What
    it deliberately does NOT pin, and why, is written out above the
    table: rendered pixels, and taste. The instrument's de-carded
    shape is check 25's rather than this table's, for the seam that
    list gives. check_contrast.py reads the same hexes to a different
    question - legible, versus ruled - and neither reads the other's
    table.

25. The signed-in pages share one card geometry, and the instrument
    has no cards to share. #178, and #174 as its one control group.

    The gap: the gate could see label roles, names, palettes and
    contrast, and nothing at all compared the SHAPE of a box from one
    page to the next - padding, radius, border treatment, header
    shape, the gap between a box and the one above it. So they
    drifted silently, which is how admin.html came to look like a
    different product from the page beside it.

    The owner's ruling on #178 is that the fix is not one geometry
    for three pages but ONE GRAMMAR PER SHELL. The member pages are
    leaves of a binder and read as cards; the instrument is a
    workbench and reads as runner-headed sections, with a single box
    left for the warning - "boxes are for warnings only", which is
    the sentence this check exists to hold.

    Which page gets which grammar is NOT a third roster. It falls out
    of SHELLS and SURFACES, both already pinned outside the markup: a
    signed-in page (SHELLS says rail) on the member surface carries
    cards, and one on the instrument surface carries sections. A page
    arriving without an entry in either table already fails checks 10
    and 18, and #206 is this repository watching a third hand-kept
    roster drift from the two it duplicates.

    Two arms, and they fail for opposite reasons:

    - AGREEMENT, across the card pages. The geometry each page
      RESOLVES for the card components is computed per page from its
      own body classes and compared page against page. This is the
      shape that survives the design changing: an edit to `.card`
      itself moves every page together and passes, which is the
      point - a check that reddens when the design legitimately
      evolves everywhere at once gets edited until it stops, and
      #142 is where that was learned. What it catches is one page
      moving alone.

      What it CANNOT catch is stated where it is implemented: this
      arm can only see a difference the card pages' body classes can
      express, and today those pages carry the same ones. The roster
      below is the teeth, and #154's sweep found both of its gaps.
    - THE SCOPED OVERRIDE, which is how one page moves alone. Every
      surface-qualified rule painting a card component is named in
      CARD_SCOPES with the surface it is for and WITH WHAT IT
      DECLARES, in every direction. An override nobody wrote down
      fails; a pin whose block has gone fails as stale; a rostered
      scope whose own values have moved fails too, because a roster
      that answers only whether a scope exists is one the design
      drifts underneath. With two card pages the agreement arm alone
      could be satisfied by a rule that moved both, and this is the
      half that refuses it.

      A component is read however its compound is qualified -
      `div.card` and `main.stack` paint cards and stacks - and a
      compound this reader cannot score is REPORTED rather than
      dropped, the way an unresolvable scope already was. Both are
      #154's partition-2 finding: silence and agreement printed the
      same word.

    Then the markup, which is where a grammar is actually worn:

    - On the instrument, inside <main>, every box carries an outcome
      or a caution and never a section name, and every section name
      stands on a `.tool`. A tool arriving as a box is the exact
      regression this ticket removed, and it announces itself by
      putting a runner inside a card.
    - On the card pages, inside <main>, there are no `.tool`
      sections at all. The instrument's grammar leaking outward is
      the same defect pointing the other way, and it arrives by the
      usual route - somebody copying the page they had open.

    The limit, stated because the arm reads as though it had none:
    these are declared values in one stylesheet, not rendered pixels.
    There is no layout engine here and #75 rejected jsdom for exactly
    this, so two different tokens holding the same length still read
    as a difference, and a geometry set by something other than these
    properties is outside it. What it buys is that a box cannot
    change shape on one page without the change being written down.

    And it is ONE stylesheet only while nothing else is allowed to
    paint - the same dependency check 24 names, armed in check 26. A
    second sheet linked from one page carries geometry this comparison
    never opens.

26. Nothing paints this site except theme.css. Checks 24 and 25 read
    one file and answer for the whole site's appearance; this is what
    makes that answer true, and #154's sweep found it written down
    nowhere (P2 F3, and mutation J for the second half).

    Three routes, and none of them is check 13's:

    - The CSP pin table itself. Check 13 reconciles each page's
      shipped policy against its pin, which means it has no opinion
      about what the two agree on: widen the page and the pin in one
      edit - 'unsafe-inline' for a convenient rule, an origin for a
      webfont - and check 13 is satisfied while the design gate is
      speaking for a site it no longer governs. So this arm reads the
      table check 13 takes as given, and every pinned style-src has to
      be 'self' and nothing else.
    - A second same-origin stylesheet. That is the one styling route
      the CSP deliberately permits, because a second file on this
      origin is exactly what 'self' means. Check 1 asks only whether
      the file a link names exists, and checks 24 and 25 open
      theme.css by name, so the sheet beside it is read by nothing.
    - The same route spelled inside the file: an @import in theme.css.
      Same origin, so the policy permits it; inside the file the design
      arms open, so every page's link roster stays right; and invisible
      to check 1, which reads href and src out of the HTML.

    What is NOT restated here: a page carrying no stylesheet at all is
    check 3's missing-head report, and a shipped policy that has drifted
    from its pin is check 13's. Inline <style> and style attributes are
    refused by the policy rather than by a scan here - which is the
    whole reason the first arm exists, since a scan of today's markup
    would not notice the policy that refuses them being relaxed.
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

# sit serves the page and the API from the one origin (0.9-M1-S10, #339;
# DESIGN.md, "The constraint that shapes everything"), so this is the
# third and, for now, last literal origin every interactive page's
# connect-src has to carry.
SIT_ENDPOINT = "https://hgbinderworker-sit.sorcererbiggz.workers.dev"

# Arms built before the keyless ruling (DESIGN.md, "Trust model: the
# Worker reads") still carry a real key and must keep carrying one - a
# config that quietly dropped production's or development's key would
# leave every submission on that host unreadable. An arm outside this
# set may declare `publicKey: null` instead; see literal_null().
KEYED_ARM_NAMES = frozenset({"production", "development"})


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


def literal_null(body, name):
    """True if `name: null` appears literally in an arm's body.

    A deliberate keyless declaration and a forgotten field read the same
    way to literal_field() - both are None - and the required-field loop
    below has to tell them apart. Only the arm that spells out `null`
    counts as declaring itself keyless; an arm with the field left out
    entirely still fails as missing.
    """
    return re.search(r"\b%s\s*:\s*null\b" % name, body) is not None


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
            # 0.9 is keyless (DESIGN.md, "Trust model: the Worker
            # reads"), so an arm built after that ruling may declare
            # `publicKey: null` on purpose rather than carry a key it
            # has no use for. Recorded separately from "publicKey" so
            # the required-field loop below can tell a deliberate null
            # apart from a field nobody wrote.
            "publicKeyIsNull": literal_null(body, "publicKey"),
        }
        environments.append(environment)
        for required in ("name", "endpoint", "publicKey"):
            if environment[required]:
                continue
            if (required == "publicKey" and environment["publicKeyIsNull"]
                    and environment["name"] not in KEYED_ARM_NAMES):
                continue
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
    "connect-src": ["'self'", PRODUCTION_ENDPOINT, DEVELOPMENT_ENDPOINT,
                    SIT_ENDPOINT],
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
    # origins. Redirect mode needs no eval and was rejected: it returns
    # the signed payload in a URL query string, into history, Referer
    # headers and access logs - DESIGN.md, "The sign-in page and the
    # CSP". The exception is survivable only because it is CONFINED to
    # this page: no form and no plaintext in reach, which is the
    # positional rule that document states.
    #
    # Three exact tokens and no fourth. Widening this entry is the
    # failure it exists to make impossible - if the exception ever has
    # to grow, DESIGN.md's recorded answer is the bot deep-link flow
    # rather than a wider policy.
    #
    # Provisional still, and against sit rather than against a retired
    # host: BotFather binds the widget to one domain, so no local
    # preview can prove the real render or the real callback. The first
    # sign-in against sit's own origin and sit's own bot is the
    # observation (OPERATIONS.md, "Building the sit environment",
    # step 6), and if the policy the widget actually needs differs, this
    # table changes with it. Pinned so that is a decision somebody makes
    # rather than a head somebody copied.
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
    "charts.html",
    "index.html",
    "your-page.html",
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
#
# form.js joined this list at 0.9-M2-S2 (#353) for the reason DESIGN.md's
# "Trust model: the Worker reads" states outright: all client-side crypto
# is gone, and rows are sealed by the Worker under a secret only it holds
# rather than by this page. There is no crypto.js call for form.js to
# make any more - the check this exemption narrows is retired for this
# page's whole surface, not weakened for it.
UNENCRYPTED_SENDERS = {
    "auth.js": "forwards a sign-in payload and stores the issued session",
    "form.js": "posts the record's plaintext for the Worker to seal at "
               "rest - there is no client-side encryption on this page "
               "any more (DESIGN.md, 'Trust model: the Worker reads')",
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
    subsumes it, because it says *why* in its message. "your-page.html names
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
# meets: the sign-in page, which the owner decided carries no rail
# before sign-in (#73), and the error page, which goes plain on
# principle.
SHELLS = {
    "404.html": "plain",
    "admin.html": "rail",
    "charts.html": "rail",
    "index.html": "plain",
    "your-page.html": "rail",
}

# The hamburger the rail replaced. The destinations are visible at
# every width now - the owner's decision on #73 - and since #274 no
# disclosure opens anything on this site at all, so a page still
# carrying nav-toggle or nav-menu is a page that kept the hamburger.
# Those names are refused below rather than merely unused.
RETIRED_IDS = ("nav-toggle", "nav-menu")

RAIL_MARKUP = re.compile(r'class="rail[\s"]', re.I)


def rail_menu(text):
    """One page's .rail-links list, or None when it carries none.

    Named separately from the pairs inside it because the name-table arm
    needs the region rather than its contents: the destinations answer
    to the rail loop in page_name_problems(), and a link reported by two
    arms reads as two defects.
    """
    menu = re.search(r'<ul[^>]*class="rail-links".*?</ul>', text, re.S | re.I)
    return menu.group(0) if menu else None


def rail_links(text):
    """The (href, label) pairs inside a page's .rail-links, in order."""
    menu = rail_menu(text)
    if menu is None:
        return None
    return re.findall(r'<a\s+href="([^"]+)"[^>]*>(.*?)</a>',
                      menu, re.S | re.I)


def rail_aside(text):
    """One page's whole rail <aside>, or None when it carries none.

    The region the anti-stranding arm reads since #187. The route to
    sign-in left .rail-links for the session block, and the wordmark
    carries it too - so the claim "this rail can always get somebody
    back to the door" is about the aside, not about the destinations
    list inside it.

    NO PAGE FOOTER LINKS THE DOOR ANY MORE (#265 row 22 took the last
    two out), and the rule did not move an inch for it - which is the
    point of where it was written. A footer is content and the rail is
    the shell: the shell is the copy this file holds identical across
    pages, so the shell is the copy the rule can stand on. Had this
    ever been allowed to rest on a footer, removing a footer link would
    have been a stranding question instead of a copy question.
    """
    match = re.search(r'<aside[^>]*class="rail[\s"].*?</aside>',
                      text, re.S | re.I)
    return match.group(0) if match else None


# The session block, read the way WORDMARK_LINES reads its classes: as a
# word inside the class list rather than as the whole attribute, so a
# second class beside this one is still the same component.
RAIL_SESSION_OPEN = re.compile(
    r'<div\b[^>]*class\s*=\s*["\'][^"\']*\brail-session\b[^"\']*["\'][^>]*>',
    re.I)

# Every div boundary, opening or closing, so the scan below can count
# depth. A non-greedy `.*?</div>` stops at the FIRST closing tag, which
# for a block that grows a wrapper is the wrapper's - and three copies
# truncated at the same place agree about the half they can still see.
DIV_EDGE = re.compile(r"<div\b[^>]*>|</div\s*>", re.I)

# What a parity failure with no page to blame is attributed to, for the
# reason WORDMARK_PIN gives: the pin is the subject in that case.
SESSION_PIN = "SHELLS in tools/check_web.py"


def rail_session(text):
    """One page's .rail-session block, or None when it carries none.

    Comments are expected to be gone already - every rule here reads the
    markup page_text() returns - because a div boundary inside a comment
    is a boundary this scan would count.
    """
    start = RAIL_SESSION_OPEN.search(text)
    if not start:
        return None

    depth = 0
    for edge in DIV_EDGE.finditer(text, start.start()):
        depth += -1 if edge.group(0).startswith("</") else 1
        if depth == 0:
            return text[start.start():edge.end()]

    # Unclosed. Absence rather than the rest of the page: returning the
    # tail would hand the parity arm a fragment that grows with whatever
    # was written after it, and the arm above reports the absence.
    return None


def fragment_pieces(markup):
    """One markup fragment as its tags and its words, spacing flattened.

    Indentation is not a difference between two copies of a block: the
    three copies sit at whatever depth their page puts them at, and a
    failure that fires on a reflow is one everybody learns to re-run.
    Words and attributes are differences.

    Kept as a list rather than folded to a hash, so a failure can name
    the piece that differs - and rather than to a set, because a set
    cannot see a reordering or a duplicate, which are two of the ways a
    hand-copied block drifts.
    """
    pieces = []
    for piece in re.findall(r"<[^>]+>|[^<]+", markup):
        flattened = " ".join(piece.split())
        if flattened:
            pieces.append(flattened)
    return pieces


def fragment_difference(here, there, reference):
    """What to say about two fragments that disagree, naming a page."""
    for mine, theirs in zip(here, there):
        if mine != theirs:
            return "writes %r where %s writes %r" % (mine, reference, theirs)
    if len(here) > len(there):
        return ("carries %r, which %s does not"
                % (here[len(there)], reference))
    return ("stops short of %s, which goes on to %r"
            % (reference, there[len(here)]))


def session_parity_problems(blocks):
    """[(page, problem)] for session blocks that disagree.

    `blocks` is {page: markup} for the railed pages whose block could be
    read whole. Compared against whichever page sorts first, for the
    reason rail parity gives: a message naming a page to go and look at
    beats one saying only that they differ.
    """
    if len(blocks) < 2:
        return [(SESSION_PIN,
                 "leaves this arm %d session block to compare. Parity is a "
                 "claim about copies, and a rule holding one copy cannot "
                 "fail - the hole check 23 paid for in #114. Either the "
                 "railed pages come back, or this arm has outlived its "
                 "subject and goes out with the reason written down"
                 % len(blocks))]

    problems = []
    reference = sorted(blocks)[0]
    for name in sorted(blocks):
        if name == reference:
            continue
        here = fragment_pieces(blocks[name])
        there = fragment_pieces(blocks[reference])
        if here == there:
            continue
        problems.append((
            name,
            "has a session block that differs from %s's: it %s. Every "
            "railed page carries its own copy of the block that says "
            "whether this tab holds a session and offers the door or the "
            "exit, so an edit reaching some of the copies leaves a member "
            "meeting a different session on every page"
            % (reference, fragment_difference(here, there, reference))))

    return problems


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


def plain_page_problems(text, entrance):
    """[problem] for one page that is pinned plain.

    `entrance` is whether this is the page every dead end on this site
    leads back to. Takes the markup rather than a filename so the rules
    can be exercised on strings. That is #34's lesson applied here: a
    mutation written against the five files tests today's markup, and
    what has to hold is the shape of the failure.
    """
    problems = []

    # The copy-paste direction. A rail on a plain page would offer the
    # session home - signed-in state and Sign out - to somebody who has
    # not signed in yet.
    if RAIL_MARKUP.search(text) or rail_links(text) is not None:
        problems.append(
            "is pinned plain and carries rail markup. The rail holds the "
            "session home, and a signed-out visitor has no session for it "
            "to be the home of")

    # Plain is a treatment, not a dead end - EXCEPT on the entrance,
    # which is where being at a dead end stops. #274 took the footers'
    # nav off every page on the owner's ruling, and the sign-in page's
    # footer link was the whole of what this arm was reading there. It
    # is not a hole the ruling opened: every other page on this site
    # needs a session, session.js's own require() returns anybody
    # without one to the entrance, and 404.html's own way off points
    # at it. The one page
    # nothing can strand you on is the one every route already ends at,
    # so the requirement is stated where it means something instead of
    # being dropped.
    if not entrance and not local_links(text):
        problems.append(
            "is pinned plain and carries no link to anywhere else on this "
            "site, so a visitor who lands here with scripts blocked has no "
            "way off it. The one page exempt from this is the entrance, "
            "pinned as SIGN_IN_PAGE in tools/check_web.py")

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

    # Parity is a claim about copies, so a page that simply dropped its
    # copy makes the claim true of whatever survived. The absence is
    # refused here rather than left to the comparison, for the reason
    # the identical-incomplete rails above give.
    if rail_session(text) is None:
        problems.append(
            "carries a rail with no .rail-session block that closes. That "
            "block is where the rail says whether this tab holds a session "
            "and offers the door or the exit, and a page without one "
            "leaves the parity arm comparing whichever copies survived")

    for retired in [i for i in RETIRED_IDS if 'id="%s"' % i in text]:
        problems.append(
            "still carries id=\"%s\" from the hamburger the rail replaced. "
            "The destinations are visible now, and since #274 nothing on "
            "this site opens at all" % retired)

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

    # The entrance is the one page excused from carrying a way off
    # itself, so the pin naming it has to answer for that exemption in
    # both directions. An entrance that is not published excuses
    # nothing and hides the fact; an entrance pinned to the rail
    # excuses a page that has a rail full of destinations anyway, and
    # would leave whatever plain page took its place stranding people
    # with the gate green.
    if SIGN_IN_PAGE not in pages:
        problems.append((
            SIGN_IN_PAGE,
            "is pinned as the entrance in SIGN_IN_PAGE in "
            "tools/check_web.py and is not a page in apps/web. Every "
            "other page here needs a session and returns a visitor "
            "without one to that page, so an entrance nothing publishes "
            "is a site whose dead ends lead nowhere"))
    elif SHELLS.get(SIGN_IN_PAGE) != "plain":
        problems.append((
            SIGN_IN_PAGE,
            "is pinned as the entrance in SIGN_IN_PAGE in "
            "tools/check_web.py and is not pinned plain in SHELLS. The "
            "entrance is excused from carrying a link off itself; a page "
            "with a rail is not excused from anything, and the exemption "
            "would then belong to no page at all"))

    rails = {}
    sessions = {}
    for name in pages:
        if name not in SHELLS:
            continue
        text = re.sub(r"<!--.*?-->", "", open(os.path.join(WEB, name),
                                              encoding="utf-8").read(),
                      flags=re.S)

        if SHELLS[name] == "plain":
            for problem in plain_page_problems(text, name == SIGN_IN_PAGE):
                problems.append((name, problem))
            continue

        for problem in rail_page_problems(text):
            problems.append((name, problem))

        links = rail_links(text)
        if links:
            rails[name] = links

        # A block that could not be read whole is no evidence about
        # another page's, so it stays out of the comparison - but it is
        # REPORTED above, never skipped, which is the discipline #152
        # was filed for.
        session = rail_session(text)
        if session is not None:
            sessions[name] = session

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

    # The rest of the shell the comparison above never read. #187 moved
    # the door out of .rail-links and into this block, so the arm that
    # compares the destinations stopped covering the half that changed
    # (#200).
    problems.extend(session_parity_problems(sessions))

    # A rail link to a page that does not exist is caught by check 1 as a
    # broken reference, so it is not repeated here.
    return problems


# Which pages write the site's own name out by hand. The three rails,
# and the sign-in page, which carries the name with no rail around it
# to hold it (#273, the owner's addendum): the mark is the first thing
# in that page's flow. So this roster is NOT "the rail pages" under
# another name, and it cannot be derived from SHELLS - the sign-in page
# is PLAIN there and carries the wordmark anyway, which is exactly the
# combination a membership rule would miss.
#
# Pinned outside the markup for the reason SHELLS gives, and the ABSENT
# direction is the one with teeth: a page carrying the wordmark and
# named by no pin is a copy nothing compares, and a page arriving is
# exactly when somebody copies a shell from whichever page they had
# open. 404.html deliberately carries none.
WORDMARK_PAGES = frozenset({
    "admin.html", "charts.html", "index.html", "your-page.html",
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


def wordmark_span(text, component):
    """The match for one wordmark line's <span>, or None."""
    return re.search(
        r'<span\b[^>]*class\s*=\s*["\'][^"\']*\b%s\b[^"\']*["\'][^>]*>'
        r'(.*?)</span>' % re.escape(component), text, re.S | re.I)


def wordmark_line(text, component):
    """The words one wordmark line shows, or None if the page has none."""
    found = wordmark_span(text, component)
    return label_text(found.group(1)) if found else None


# The element the site's name has to be inside. Not a position in the
# markup and not a page list: on the rail pages the mark is the first
# thing in <aside class="rail">, and on the sign-in page it IS the first
# thing in <body> (#273's addendum, the owner's one ruled fact about the
# mark - "the name greets from the top of the page and never moves").
# Both satisfy "inside body's first element", which is why one arm holds
# both shapes and no page needs naming here.
BODY = re.compile(r"<body\b[^>]*>", re.I)

# The first ELEMENT after <body>, so a comment, a stray newline or a
# text node before it does not read as the mark being out of place.
FIRST_ELEMENT = re.compile(r"<(\w+)\b[^>]*>")

WORDMARK_ELEMENT = re.compile(
    r'<(\w+)\b[^>]*class\s*=\s*["\'][^"\']*\bwordmark\b[^"\']*["\']', re.I)


def body_first_element(text):
    """((start, end), problem) for the first element inside <body>."""
    body = BODY.search(text)
    if body is None:
        return None, ("carries no <body>, so where anything sits on it "
                      "cannot be read at all")
    found = FIRST_ELEMENT.search(text, body.end())
    if found is None:
        return None, "carries a <body> with no element in it"
    return element_span(text, found)


def wordmark_placement_problems(text):
    """[problem] for where one page puts the site's name.

    The ruled fact is that the name greets from the top and never moves
    (#273's addendum). Nothing held it: WORDMARK_PAGES pins THAT a page
    carries the mark and check 10's parity pins WHAT it says, so the
    whole mark could be moved below the sign-in form and the footer with
    the gate green - confirmed by mutation before this arm was written.

    Read as containment inside body's first element rather than as a
    line number, because the two shapes on this site are the mark itself
    standing first and the mark standing first inside the rail, and a
    positional rule that knew only one of them would have to name pages.
    """
    mark = WORDMARK_ELEMENT.search(text)
    if mark is None:
        return []  # a page with no mark is page_wordmark_problems()'s

    span, unreadable = body_first_element(text)
    if unreadable:
        return [unreadable]

    if not span[0] <= mark.start() < span[1]:
        return [
            "carries the site's name outside the first element in its "
            "<body>. The name greets from the top of the page and never "
            "moves - the owner's addendum on #273 - and that is the one "
            "thing about the mark nothing else here holds: the roster "
            "pins that a page carries it and check 10's parity pins what "
            "it says, so a mark moved below the form and the footer "
            "reads identically to both"]

    return []


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

    problems.extend(wordmark_order_problems(text))
    return problems


def wordmark_order_problems(text):
    """[problem] for a wordmark whose two lines are in the wrong order.

    WORDMARK_LINES is a sequence and the positions in it are the words
    "first" and "second", but nothing read them as an order until now:
    wordmark_line() runs an INDEPENDENT search per component over the
    whole document, so the two spans carry no positional information at
    all and swapping them changes nothing any arm can see. Confirmed by
    mutation: the pages rendered "Binder" in italic display above "HANG
    GANG" in gold - the mark inverted from the approved mockup - with
    check 10 whole and green.

    The parity arm cannot cover this, and that is the point: it compares
    the pages to EACH OTHER, so a swap applied to all four copies is
    four pages agreeing on the wrong mark.
    """
    spans = [wordmark_span(text, component)
             for component, _ in WORDMARK_LINES]
    if any(found is None for found in spans):
        return []  # a half-read mark is the arm above's to report

    for (earlier, (_, before)), (later, (_, after)) in zip(
            zip(spans, WORDMARK_LINES), zip(spans[1:], WORDMARK_LINES[1:])):
        if earlier.start() > later.start():
            return [
                "draws the %s wordmark line above the %s one. The order "
                "is the mark: the gold possessive sits over the italic "
                "display noun, which is how the approved mockup draws it "
                "- and WORDMARK_LINES in tools/check_web.py is a sequence "
                "for that reason. Nothing else can see this. Each line is "
                "found by its own search, so the two are the same to every "
                "other arm, and parity compares the copies to each other, "
                "which four identically-inverted pages satisfy"
                % (after, before)]

    return []


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
        # Kept out of `own` on purpose: a mark in the wrong PLACE is
        # still a mark this arm can read, so the page stays in the
        # comparison below rather than dropping out of it and taking its
        # evidence about the other copies with it.
        problems.extend((name, problem)
                        for problem in wordmark_placement_problems(text))
        # A page whose own wordmark could not be read whole is no
        # evidence about another page's, so it is left out of the
        # comparison - but it is REPORTED above, never skipped, which is
        # the discipline #152 was filed for.
        if carries and not own:
            marks[name] = page_wordmark(text)

    problems.extend(wordmark_parity_problems(marks))
    return problems


# Which pages offer a palette. One table, because there is one shape:
# the owner's ruling of 2026-08-13 (#274) took the floating Theme
# <details> off the signed-in pages and made every footer the row of
# swatches index.html has always carried. What #187 split by page and
# the ruling of 2026-08-10 wrote down as two shapes is one shape again,
# and the property the swatch row was chosen for now belongs to every
# page: a control with no hidden state has nothing that can be open over
# anything, however its script, its stylesheet or its layout fails.
#
# Pinned outside the markup for the reason SHELLS gives. 404.html is not
# in it: it offers no palette, that is deliberate, and the way a chip
# lands on it is the way every copy-paste failure in this file lands -
# somebody builds the next page from whichever one they had open. A chip
# there writes a stored preference from an error page and fails nothing.
THEMED_PAGES = frozenset(
    {"admin.html", "charts.html", "index.html", "your-page.html"})

# The other side of that table, and it is not decoration. Before #274,
# absence from THEMED_PAGES meant one thing - "this page offers no
# palette". Since the ruling it ALSO means "this page carries no
# footer", because the footer IS the row. So a page nobody remembers to
# add to the set ships with no palette AND no footer, and the arm that
# would have said so reads the set to decide whether to look. SHELLS
# closes exactly this asymmetry one table up by naming every published
# page; this does the same, so a new page has to be written into one
# side or the other and cannot arrive in neither.
UNTHEMED_PAGES = frozenset({"404.html"})

# The disclosure the ruling removed, read as an ELEMENT and not as a
# class alone - refused now rather than pinned to three pages, the way
# RETIRED_THEME_IDS and RETIRED_LABEL are refused. Reading the element
# is what makes the refusal hold: a panel rebuilt out of markup a script
# has to open would keep the hazard and lose the only tag naming it.
#
# `[^>]*` for the attributes, the same simplification CHIP_OPEN makes:
# a ">" inside a quoted attribute value ends the tag as far as this
# reader is concerned. That is loud rather than quiet - the control
# reads as missing - and it is the direction a refusal is allowed to be
# wrong in.
PICKER_DETAILS = re.compile(
    r"<details\b[^>]*\bclass\s*=\s*[\"'][^\"']*\btheme-picker\b[^>]*>", re.I)

# The word the disclosure's button carried. Refused with the element,
# because the class is the half a rebuild drops first: a <summary> that
# still says "Theme" is the same control arriving without the name this
# file finds it by.
THEME_CONTROL_NAME = "Theme"

SUMMARY = re.compile(r"<summary\b[^>]*>(.*?)</summary>", re.S | re.I)

# The row of dots, read by its class and with its tag CAPTURED. The
# class is what the stylesheet lays out in flow; the tag is what
# element_span() below needs to find where the row ends, which is how
# the footer arm tells the row apart from anything standing beside it.
SWATCH_GROUP = re.compile(
    r"<(\w+)\b[^>]*\bclass\s*=\s*[\"'][^\"']*\btheme-swatches\b[^>]*>", re.I)

# The custom-palette editor (0.9-M2-S6, #82) - the one exception the
# footer-is-the-row-and-nothing-else ruling now carries, per the design
# mandate settled 2026-08-19: the two color pickers live in a native
# <details class="more"> directly below the swatch row, the site's own
# disclosure grammar rather than a new floating panel. Found by the same
# class check 27's more_disclosure_problems() already enforces on every
# <details> on these pages, so this arm and that one read one shape
# rather than two.
THEME_EDITOR_DETAILS = re.compile(
    r"<(\w+)\b[^>]*\bclass\s*=\s*[\"'][^\"']*\bmore\b[^>]*>", re.I)

# One page's footer, read whole. Non-greedy to the first closing tag
# rather than depth-aware, because a footer cannot nest a footer - and
# a page carrying two of them is refused by the arm rather than read.
FOOTER = re.compile(r"<footer\b[^>]*>(.*?)</footer\s*>", re.S | re.I)

# What a footer is allowed to hold besides the swatch row: nothing. Kept
# as a marker for the sentence rather than as a table, because the whole
# content of the rule is that there is no list.
ANY_TAG = re.compile(r"<\w+\b")

# The link the ruling took out, read WITHOUT regard to where it points.
# On-site and off-site alike: the rail carries navigation, and an
# outbound link is navigation that leaves. This is the direction nothing
# else in this file can reach - an off-site href is invisible to
# DESTINATIONS and to the anti-stranding arm by construction, and an
# on-site link spelling its destination's own name satisfies the name
# table exactly.
FOOTER_ANCHOR = re.compile(r"<a\b[^>]*>", re.I)

# The ids the control was opened through while a script owned its open
# state. Refused rather than merely absent, the way RETIRED_IDS and
# RETIRED_LABEL are: no page has a disclosure now, so nothing reads
# either id - and an id left behind is a hook the next page copied from
# this one inherits, plus an aria-controls pointing at a relationship
# the page does not have.
RETIRED_THEME_IDS = ("theme-toggle", "theme-chips")

# What theme.js wires a chip by. The button's own text is not read here:
# whether the copies agree about a label is #152's question, and this
# one is only whether the control is on the page at all.
CHIP_MARKUP = re.compile(r"\bdata-set-theme\s*=", re.I)


def element_span(text, found):
    """((start, end), problem) for the whole element `found` opened.

    `found` is a match whose first group is the tag name. The span runs
    from the opening tag to the end of the matching closing one, so a
    caller can cut the element out and read what was standing beside it.

    Depth-aware rather than a match to the first closing tag, because a
    nested element of the same name would end the span early and
    everything after it would then read as sitting outside - a failure
    that points the reader at markup which is perfectly correct.

    (None, problem) is "there is one and this reader could not read it
    whole", kept apart from a clean span for the reason
    chip_roster_problems() gives: a reader that quietly drops what it
    cannot parse prints the same OK as one that found nothing wrong.
    """
    tag = found.group(1)
    opener = re.compile(r"<%s\b[^>]*>" % re.escape(tag), re.I)
    closer = re.compile(r"</%s\s*>" % re.escape(tag), re.I)

    depth, index = 1, found.end()
    while depth:
        nested = opener.search(text, index)
        end = closer.search(text, index)
        if end is None:
            return None, (
                "carries a <%s> that never closes, so what is inside it "
                "and what is merely after it cannot be told apart - and "
                "everything below it on the page is inside the element"
                % tag)
        if nested is not None and nested.start() < end.start():
            depth += 1
            index = nested.end()
            continue
        depth -= 1
        index = end.end()
    return (found.start(), index), None


def footer_problems(text, themed):
    """[problem] for one page's footer against the owner's ruling on #274.

    The footer is the swatch row, its custom-palette editor since
    0.9-M2-S6 (#82), and nothing else - so this reads what is left after
    both are cut out. That is the arm with reach: an off-site href is
    invisible to DESTINATIONS and to the anti-stranding arm alike, and an
    on-site link spelling its destination's own name satisfies the name
    table exactly - so before this, two of the four footers could take
    their nav back with the whole gate green.
    """
    problems = []
    footers = FOOTER.findall(text)

    if len(footers) > 1:
        problems.append(
            "carries %d <footer> elements. This arm reads one, so a second "
            "is a footer nothing looks at - and the ruling is that every "
            "page's footer is the same row" % len(footers))
        return problems

    if not themed:
        if footers:
            problems.append(
                "offers no palette and carries a <footer>. The footer IS "
                "the palette row since #274, so a page with no row has "
                "nothing to put in one and an empty element is a rule "
                "painting a line under nothing")
        return problems

    if not footers:
        problems.append(
            "offers a palette and carries no <footer>. That is where the "
            "swatch row lives on every other page, and a row somewhere "
            "else is the identical-footers ruling broken on one page")
        return problems

    inside = footers[0]

    found = SWATCH_GROUP.search(inside)
    if not found:
        # NOT a silent return. The arm below searches the WHOLE page for
        # the row, so a footer arm that says nothing when the row is not
        # in the footer leaves "the row is on the page but not in the
        # footer, and the footer is full of nav" with no reader at all -
        # the owner's ruling reversed on one page with the whole gate
        # green, found by mutation. A themed
        # page whose footer holds no row is the same failure as a themed
        # page with no footer, and it says so in the same words.
        problems.append(
            "carries a <footer> with no .theme-swatches row inside it. "
            "The footer IS the palette row since #274, so a footer "
            "holding anything else - or nothing - is the identical-"
            "footers ruling broken on this page. Where the row went is "
            "the arm below; that it is not HERE is this one")
        return problems

    span, unreadable = element_span(inside, found)
    if unreadable:
        problems.append(unreadable)
        return problems

    # F2 (0.9-M2-S6 fix wave 1, #82): "directly below the row" is a
    # claim about what comes AFTER the row, so the EDITOR SEARCH reads
    # only that text. Concatenating inside[:span[0]] (before the row)
    # onto inside[span[1]:] (after it) before this search would prove
    # the editor is PRESENT somewhere in the footer while throwing away
    # where - an editor placed above the row would land at the front of
    # that concatenation, reading `between` a few lines down as empty
    # and passing the position check on a footer where the editor
    # actually sits above the row.
    after_row = inside[span[1]:]
    within = inside[span[0]:span[1]]

    # The custom-palette editor, cut out of `after_row` the same way the
    # row was cut out of `inside` - the one element besides the row a
    # themed footer may now hold (0.9-M2-S6, design mandate 1). Required
    # rather than merely allowed: every themed page carries the same
    # fifth chip, so every themed page owes the editor it opens, the
    # same parity the four named palettes already hold.
    editor = THEME_EDITOR_DETAILS.search(after_row)
    if not editor:
        problems.append(
            "offers a palette and carries no <details class=\"more\"> "
            "custom-palette editor directly below its swatch row. "
            "0.9-M2-S6 ships the editor on every themed page - the "
            "Custom chip in the row above needs it to mean anything - so "
            "a page missing it is one member cannot reach their own "
            "colors from")
        return problems

    editor_span, editor_unreadable = element_span(after_row, editor)
    if editor_unreadable:
        problems.append(editor_unreadable)
        return problems

    # The editor's OWN summary word, checked against its own isolated
    # span rather than against the page as a whole - more_disclosure_
    # problems() (check 27) still holds every <summary> on the page to
    # MORE_SUMMARY or THEME_PICKER_SUMMARY as a pair of allowed words,
    # but only this arm knows WHICH <details> is the editor, so only
    # this arm can say the editor itself carries the ruled one rather
    # than merely that the word appears somewhere on the page (0.9-M2-
    # S13, #378: "the 'More' button is rethemed and relabeled as the
    # single obvious 'Custom theme' control").
    editor_markup = after_row[editor_span[0]:editor_span[1]]
    editor_summary = SUMMARY.search(editor_markup)
    if editor_summary is None:
        problems.append(
            "carries a custom-palette editor with no <summary> at all. "
            "0.9-M2-S13 (#378) made the editor's own summary the whole "
            "of how a member reaches Custom - a summary-less <details> "
            "opens through the browser's own default word instead, "
            "never the ruled one")
    else:
        editor_word = label_text(editor_summary.group(1))
        if editor_word != THEME_PICKER_SUMMARY:
            problems.append(
                "labels its custom-palette editor \"%s\", and 0.9-M2-S13 "
                "(#378) ruled the word \"%s\" for exactly this control - "
                "THEME_PICKER_SUMMARY in tools/check_web.py. The custom "
                "swatch circle this editor's own summary replaced is "
                "gone; a summary still reading \"More\" (or anything "
                "else) is that control arriving without the name a "
                "member would recognize it by"
                % (editor_word, THEME_PICKER_SUMMARY))

    between = after_row[:editor_span[0]]
    if between.strip():
        problems.append(
            "carries markup or words between the swatch row and its "
            "<details class=\"more\"> custom-palette editor. The editor "
            "sits directly below the row with nothing between them "
            "(design mandate 1), so anything there is the footer "
            "drifting again")

    # F2 (0.9-M2-S6 fix wave 2, #82): only the EDITOR SEARCH above needs
    # position preserved - "directly below" is a claim about order, and
    # order only means something relative to the row. The link/markup/
    # words arms below make no positional claim at all ("the footer is
    # the row and its editor, and nothing else" - order-blind by the
    # ruling's own words), so they read for everything that ISN'T the
    # row or the editor: what came before the row, plus what's left of
    # `after_row` once the editor's own span is cut out of it. Wave 1
    # fixed the editor search by narrowing `rest` to after_row and then
    # reused that SAME narrowed `rest` for these arms too - so content
    # before the row (an off-site link, markup, bare words) stopped
    # being read by anything, the exact hole #274 closed reopened one
    # page earlier. Confirmed by the new before-the-row fixture in
    # dev/check_web.test.py: it passes wave 1's function silently and
    # is refused here.
    rest = inside[:span[0]] + after_row[editor_span[1]:]
    if THEME_EDITOR_DETAILS.search(rest):
        problems.append(
            "carries more than one <details class=\"more\"> custom-"
            "palette editor in its footer. One picker, reused on every "
            "page, is the whole point of the mechanism")

    for _ in FOOTER_ANCHOR.findall(rest):
        problems.append(
            "carries a link in its footer. #274 removed the footers' nav "
            "on the owner's ruling - the rail is what carries navigation, "
            "and an outbound link is navigation that leaves. Nothing else "
            "in this file reaches this: an off-site href is not a "
            "destination, and an on-site one spelling its page's own name "
            "passes the name table")
        break

    if ANY_TAG.search(rest):
        problems.append(
            "carries markup in its footer beside the swatch row. The "
            "footer is the row and nothing else, on every page alike, so "
            "an element standing next to it is the drift that made the "
            "four footers disagree in the first place")

    if TAG.sub("", rest).strip():
        problems.append(
            "carries words in its footer beside the swatch row. A "
            "sentence there is the footers' old prose arriving without "
            "its link, and the ruling is that the footer says nothing")

    problems.extend(swatch_row_problems(within))

    return problems


# What the swatch row itself is allowed to hold: swatch buttons. The row
# is `display: flex`, so anything else put inside it paints as a flex
# item BESIDE the dots - which renders as exactly the footer the ruling
# forbids while sitting in the one place the arm above cuts out before
# reading. Confirmed by mutation: both retired links restored inside the
# row, whole gate green.
SWATCH_BUTTON = re.compile(r"<(/?)(button)\b[^>]*>", re.I)


def swatch_row_problems(within):
    """[problem] for what one page put INSIDE its swatch row.

    `within` is the row's own markup, opening and closing tags included.
    Read rather than skipped, because element_span() cutting the row out
    is what makes the footer arm able to tell the row from what stands
    beside it - and a reader that cuts something out and never looks in
    it has moved the hiding place rather than closed it.

    The buttons are cut out the same way the row is, so this is the same
    sentence one level down: the row is its swatches and nothing else.
    """
    rest = SWATCH_ROW_OPEN.sub("", within, count=1)
    rest = re.sub(r"</\w+\s*>\s*$", "", rest)

    # The buttons cut out at DEPTH, the way element_span() cuts the row
    # out of the footer: a <button> inside a <button> is not markup this
    # site writes, and a reader that assumed it away would read the
    # second closing tag as ending the first control.
    depth, index, kept = 0, 0, []
    for found in SWATCH_BUTTON.finditer(rest):
        if found.group(1):
            depth -= 1
            if not depth:
                index = found.end()
            continue
        if not depth:
            kept.append(rest[index:found.start()])
        depth += 1

    problems = []
    if depth:
        problems.append(
            "carries a <button> in its .theme-swatches row that never "
            "closes, so what is a swatch and what is standing beside one "
            "cannot be told apart")
        return problems
    kept.append(rest[index:])
    outside = "".join(kept)

    if FOOTER_ANCHOR.search(outside) or ANY_TAG.search(outside):
        problems.append(
            "carries markup INSIDE its .theme-swatches row that is not a "
            "swatch. The row lays its children out in a flex line, so "
            "anything else in it paints beside the dots - a footer with "
            "prose links in it, arriving in the one place the arm above "
            "cuts out before it reads")
    if TAG.sub("", outside).strip():
        problems.append(
            "carries words INSIDE its .theme-swatches row. The row is "
            "its swatches and nothing else, for the same reason the "
            "footer is the row and nothing else")
    return problems


SWATCH_ROW_OPEN = re.compile(
    r"<\w+\b[^>]*\bclass\s*=\s*[\"'][^\"']*\btheme-swatches\b[^>]*>", re.I)


def theme_control_problems(text, themed):
    """[problem] for one page's palette control against the ruled shape.

    `themed` is whether the page is pinned to offer a palette at all.
    Takes markup rather than a filename for the reason
    plain_page_problems() gives: a rule exercised only on the files that
    ship today is a rule tested against today's markup, and what has to
    hold is the shape of the failure.
    """
    problems = []

    for retired in [i for i in RETIRED_THEME_IDS if 'id="%s"' % i in text]:
        problems.append(
            "carries id=\"%s\", which is the hook the palette control was "
            "opened through while a script owned its open state. Nothing "
            "reads it - no page has a disclosure - so what is left is an "
            "id the next page copied from this one inherits" % retired)

    # The disclosure, refused on every page rather than pinned to three.
    # Both halves: the element #274 removed, and the word its button
    # carried - because the class is what a rebuild drops first, and a
    # <summary> still reading "Theme" is the same control arriving
    # without the name this file finds it by.
    if PICKER_DETAILS.search(text) or any(
            label_text(words) == THEME_CONTROL_NAME
            for words in SUMMARY.findall(text)):
        problems.append(
            "hides its palette behind a disclosure, and #274 ruled the "
            "flyout off every page. A control with hidden state is one "
            "that can be open over something - over the Telegram widget "
            "on the page that signs anybody in - and the swatches have no "
            "reveal to fail. The word is pinned in THEME_CONTROL_NAME in "
            "tools/check_web.py")

    swatch_row = SWATCH_GROUP.search(text)
    chips = CHIP_MARKUP.findall(text)

    if themed:
        if not swatch_row:
            problems.append(
                "offers a palette and carries no .theme-swatches row, so "
                "there is nothing for the stylesheet to lay out in flow "
                "and the dots fall wherever the footer puts them")
        if not chips:
            problems.append(
                "offers a palette and carries no data-set-theme swatch. "
                "theme.js wires the palettes by that attribute and finds "
                "nothing to wire")
        elif swatch_row:
            # COUNTED rather than asked whether any chip is inside the
            # row. One chip left beside it while the others stay in is
            # the shape this arm is for, and "does the row contain a
            # chip" answers yes to it - which is how a stray palette
            # button ends up standing loose in the footer forever with
            # the gate green. Found by mutation on the shape this
            # replaced, which is what mutation is for.
            span, unreadable = element_span(text, swatch_row)
            if unreadable:
                problems.append(unreadable)
            else:
                held = len(CHIP_MARKUP.findall(text[span[0]:span[1]]))
                if held < len(chips):
                    problems.append(
                        "carries %d of its %d data-set-theme chips OUTSIDE "
                        "the .theme-swatches row. The stylesheet lays the "
                        "row out, so a chip beside it is a control the "
                        "spacing, the target size and the pressed mark all "
                        "miss" % (len(chips) - held, len(chips)))
        return problems

    if swatch_row:
        problems.append(
            "carries a .theme-swatches row and is not pinned in "
            "THEMED_PAGES in tools/check_web.py. Either this page now "
            "offers a palette and the pin is stale, or it inherited the "
            "row from whichever page it was copied from - say which")
    if chips:
        problems.append(
            "carries a data-set-theme chip and is not pinned in "
            "THEMED_PAGES in tools/check_web.py. A chip writes a stored "
            "preference, and this page is not one the site offers that "
            "from")

    return problems


def theme_control_page_problems():
    """(page, problem) for the palette control across the published pages."""
    problems = []
    pages = html_pages()

    for name in sorted((THEMED_PAGES | UNTHEMED_PAGES) - set(pages)):
        problems.append((
            name,
            "is pinned in THEMED_PAGES or UNTHEMED_PAGES in "
            "tools/check_web.py and is not a page in apps/web. Delete the "
            "entry, or restore the page it was written for - a pin with "
            "no page behind it is a check that cannot fail"))

    for name in sorted(THEMED_PAGES & UNTHEMED_PAGES):
        problems.append((
            name,
            "is pinned in BOTH THEMED_PAGES and UNTHEMED_PAGES in "
            "tools/check_web.py. The two tables answer one question and "
            "a page in both makes whichever arm is read first the answer"))

    for name in sorted(set(pages) - THEMED_PAGES - UNTHEMED_PAGES):
        problems.append((
            name,
            "is published and is named in neither THEMED_PAGES nor "
            "UNTHEMED_PAGES in tools/check_web.py. Since #274 the footer "
            "IS the palette row, so absence from the first table no "
            "longer means only \"no palette\" - it also means \"no "
            "footer\", and a page nobody adds ships with neither while "
            "this arm reads the table to decide whether to look. Say "
            "which side this page is on"))

    for name in pages:
        text = page_text(name)
        themed = name in THEMED_PAGES
        for problem in theme_control_problems(text, themed):
            problems.append((name, problem))
        for problem in footer_problems(text, themed):
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
    "About to clear itself": "caution",
    "Add an entry": "runner",
    "Before you close this": "caution",
    "Charts": "runner",
    "Development session": "caution",
    "How your entry is handled": "runner",
    "Key": "runner",
    "Members": "runner",
    "Membership": "runner",
    "Not open": "flag",
    "Publish": "runner",
    "Published": "runner",
    # The one entry whose role has changed since it was written. It was
    # a `flag` while Result was an outcome in a box of its own; #178
    # made the instrument's tools into sections, so Result now names one
    # of the six rather than reporting a verdict about the page.
    "Result": "runner",
    "Rows that grant nothing": "caution",
    "Rows that would not open": "caution",
    "Session": "runner",
    "Telegram": "runner",
    "Unavailable": "flag",
    "What this is": "runner",
    "Your entries": "runner",
    "Your trend": "runner",
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
# drift that issue inventoried. So are the copies that live outside the
# destinations list - the door in each session block, which #187 put
# beyond the rail loop's reach and PROSE_LINKS below brings back. The
# footers carried copies of it too until #265 row 22 took the door out
# of them and #274 took every link out of them, so the only copies left
# are the session blocks'.
#
# The site's own name reaches a reader by two routes - the tab strip,
# through this constant, and the wordmark over the door - and #191 rules
# them to one string, because a site whose tab and whose masthead
# disagree is #127's complaint one level up. This constant holds the
# titles to it; the wordmark arm on check 10 holds the hand-kept copies
# of the masthead to each other, and WORDMARK_PAGES is where to read
# which pages those are. Neither reads the other, and the pair of them
# is what the words below are worth.
SITE_TITLE = "Hang Gang Binder"

DESTINATIONS = {
    "404.html": "Not found",
    "admin.html": "Admin",
    "charts.html": "Charts",
    "index.html": "Sign in",
    "your-page.html": "Your page",
}

# Which links say something other than the name of the page they open.
# Keyed (page, destination) and holding the exact words, because the
# difference between a name and a sentence is not in the markup: "Sign
# in" and "Add yours" are the same element pointing at the same page,
# and only a table outside the pages can say which of them is a copy of
# a name that a rename has to reach.
#
# Pinned for the reason SHELLS gives, and the ABSENT direction is again
# the one with teeth: a link this table does not name is held to the
# name, so a new sentence arrives loudly instead of widening the hole
# #201 filed - copies of the door label in session blocks and in footers
# answering to nothing while #191 renamed the pages around them. The
# footers' copies are gone: #265 row 22 retired the door's on the
# owner's ruling and #274 retired every link they had left, so what
# remains is the session blocks', which are the copies #187 says the
# door belongs to. A declaration nothing carries any more FAILS as
# stale, for the reason WORDMARK_PAGES gives.
#
# What this cannot say is whether a sentence is still true after a
# rename. "Go to sign in" is prose, and prose is the owner's to write.
PROSE_LINKS = {
    ("404.html", "index.html"): frozenset({"Go to sign in"}),
    # The Publish card's own link, beside the act it belongs to: a
    # keyholder who has just pressed Publish is one press from reading
    # what they published. It said something different from the footer's
    # invitation to the same page while the footers had one (#265
    # row 22); #274 left it the only link on this page that does.
    ("admin.html", "charts.html"): frozenset({"Open it"}),
    ("charts.html", "index.html"): frozenset({"Add yours"}),
}

# What a stale prose declaration is attributed to, for the reason
# WORDMARK_PIN gives.
PROSE_PIN = "PROSE_LINKS in tools/check_web.py"

# One anchor, split into its attributes and what it shows, so the arm
# can read a class off it. The wordmark is an anchor to index.html whose
# words are the site's name rather than that page's, and check 10 holds
# its copies to each other - held here too it would answer to two
# tables at once, and the next rename would have to satisfy both.
ANCHOR = re.compile(r"<a\b([^>]*)>(.*?)</a>", re.S | re.I)
ANCHOR_HREF = re.compile(r'href\s*=\s*["\']([^"\']*)["\']', re.I)

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


def named_links(text):
    """[(destination, label)] for the links on one page that name a page.

    Everything the rail loop in page_name_problems() does not already
    read: the session block's door, the footers' door, and every link in
    the content that writes a page's name out. Off-site links belong to
    somebody else's site, and the wordmark answers to check 10.
    """
    menu = rail_menu(text)
    elsewhere = text.replace(menu, "") if menu else text

    found = []
    for attributes, shown in ANCHOR.findall(elsewhere):
        href = ANCHOR_HREF.search(attributes)
        if not href:
            continue
        if "wordmark" in " ".join(re.findall(CLASS_ATTR, attributes)).split():
            continue
        target = rail_target(href.group(1))
        if target is None:
            continue
        found.append((target, label_text(shown)))
    return found


def named_link_problems(name, text):
    """[problem] for one page's links calling a page something else."""
    problems = []
    for target, shown in named_links(text):
        if target not in DESTINATIONS:
            problems.append(
                "links to %s, which names no destination in DESTINATIONS in "
                "tools/check_web.py. Say what that page is called, or fix "
                "the link - a link this table cannot resolve is one no "
                "rename will ever reach" % target)
        elif shown != DESTINATIONS[target] and shown not in PROSE_LINKS.get(
                (name, target), frozenset()):
            problems.append(
                'has a link calling %s "%s", and that page is called "%s". '
                "Either the name changed here and not in DESTINATIONS in "
                "tools/check_web.py, or this link is a sentence rather than "
                "a copy of the name and PROSE_LINKS has to say so"
                % (target, shown, DESTINATIONS[target]))
    return problems


def prose_pin_problems(shown):
    """[(subject, problem)] for prose declarations nothing carries.

    `shown` is the (page, destination, words) actually found. A pin with
    nothing behind it is a check that cannot fail, and the pages are
    where the words live - so the table shrinks when the site does,
    rather than quietly excusing a link that comes back later.
    """
    problems = []
    for (page, target), labels in sorted(PROSE_LINKS.items()):
        for words in sorted(labels):
            if (page, target, words) in shown:
                continue
            problems.append((
                PROSE_PIN,
                'declares "%s" on %s as prose pointing at %s, and no link '
                "there shows it. Delete the declaration, or restore the "
                "link - a declaration with nothing behind it excuses a "
                "copy of the name that nobody has written yet"
                % (words, page, target)))
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

    shown = set()
    for name in pages:
        if name not in DESTINATIONS:
            continue
        text = page_text(name)
        for problem in page_name_problems(text, DESTINATIONS[name]):
            problems.append((name, problem))
        for problem in named_link_problems(name, text):
            problems.append((name, problem))
        shown.update((name, target, words)
                     for target, words in named_links(text))

    problems.extend(prose_pin_problems(shown))
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
    "charts.html": "member",
    "index.html": "member",
    "your-page.html": "member",
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


FORM_PAGE = "your-page.html"

# The two halves of the units default, as they appear in the markup.
UNIT_SYSTEMS = ("imperial", "metric")


def units_default_problem():
    """A description of the units default contradicting itself, or None.

    NARROWED AT 0.9-M2-S2 (#353) to the one half that is still
    hand-kept markup. form.js renders every field's boxes into
    #entry-fields at runtime, tagged `data-units-group`, so there is no
    static #imperial-fields/#metric-fields group left that could ship
    hidden or visible wrong: the page paints nothing there until the
    script runs, and applyUnits() picks the group from the same radio
    checked below. What remains worth checking is that radio itself:
    exactly one `units` radio ships checked, or the form opens with no
    unit system selected or with two.
    """
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
    "charts.js": "BinderCharts",
    "config.js": "BINDER_CONFIG",
    "crypto.js": "BinderCrypto",
    "fields.js": "BinderFields",
    "form.js": "BinderForm",
    "session.js": "BinderSession",
    "signout.js": "BinderSignOut",
    # The one export theme-init.js carries (0.9-M2-S6, #82): the custom-
    # palette math, published from the pre-paint script rather than from
    # a second <head> script because check 22 below pins the head to
    # exactly one. theme.js captures it at the end of the body; see
    # loading_problems()'s own PREPAINT_SCRIPT seed for why that capture
    # is in-order despite theme-init.js never appearing in a page's body
    # run.
    "theme-init.js": "BinderCustomPalette",
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
    "nav.js": "marks the current destination in the rail and returns",
    # BINDER_SITE is a data global, not a namespace of helpers - the same
    # shape BINDER_CONFIG is - but unlike BINDER_CONFIG it deliberately
    # ships UNFROZEN at this assignment: apps/web/fields.js's own header
    # explains why the freeze has to happen on the first READ instead of
    # at load, so a MODULE_EXPORTS pin here would fail the very freeze
    # rule that gap is designed around. NON_NAMESPACE_GLOBALS below is
    # where that is recorded, landed at 0.9-M2-S2 (#353) alongside the
    # file's move into apps/web/.
    "site.config.js": "assigns BINDER_SITE - see NON_NAMESPACE_GLOBALS",
    "submit.js": "wires your-page.html's trend, its entries list, its "
                 "download and idle expiry",
    "theme.js": "wires the palette controls in place",
}

# Globals that are deliberately not frozen namespaces. Narrow, named, and
# each carrying its reason - the same shape as UNENCRYPTED_SENDERS above,
# and for the same argument: an exemption list stays reviewable, while
# relaxing the rule for every global would not.
#
# Note what these are NOT: an assertion that freezing them would be wrong,
# only that they are data or a callback rather than a namespace of helpers
# the freeze rule was written for. BINDER_CONFIG is deliberately absent from
# this list: it carries the endpoint every page on it writes to, so a script
# that rewrites it redirects every submission somewhere the site did not
# choose. It is held to the freeze rule through MODULE_EXPORTS and locked
# non-writable by config_environments, not exempted here - do not move it
# back.
NON_NAMESPACE_GLOBALS = {
    ("countries.js", "BINDER_COUNTRIES"):
        "the country name table the form reads",
    ("countries.js", "BINDER_COUNTRIES_PROMOTED"):
        "the promoted country codes, which check 9 reconciles",
    ("auth.js", "onTelegramAuth"):
        "the callback Telegram's widget invokes by name from its own script",
    ("site.config.js", "BINDER_SITE"):
        "the form's field spec, deliberately unfrozen at this assignment - "
        "apps/web/fields.js freezes it on the first read instead, so that "
        "the freeze holds whichever of the two <script> tags loads first",
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


CHART_FILE = "charts.js"

# apps/web/dashboard.js built a series class by cycling - "series-" +
# (index % 6) - so that no .series-N name ever appeared as a literal
# string; that file is gone (0.9-M2-S3, #354), and its retirement is
# what left this file naming the successor.
#
# apps/web/charts.js has nothing to hide from a dead-code search and
# writes its class names out whole (design mandate 6 fixes the shape at
# exactly two series: the group average on series-0, a member's own line
# on series-1 - there is no cycle to read a length off). So this reads a
# literal set of slot numbers instead of a modulo length: every
# "chart-series series-N", "chart-dot series-N" or
# "chart-series-label series-N" found as a quoted literal names a slot in
# use. A producer spelled some other way matches nothing here and is
# reported as ABSENT rather than passed over, for the same reason the
# retired cycle read was: the stylesheet's slots would be answering to
# nothing this check can read, and a rule that has lost its subject must
# say so.
SERIES_LITERAL = re.compile(
    r"""["'](?:chart-series|chart-dot|chart-series-label)\s+series-(\d+)["']""")

# The stylesheet's three halves of the same number. Stroke on the line,
# fill on the shapes meant to be solid, and the value each slot resolves
# to, one set per palette.
SERIES_STROKE = re.compile(r"^\.series-(\d+)$")
SERIES_FILL = re.compile(r"^(?:circle|text)\.series-(\d+)$")
SERIES_TOKEN = re.compile(r"--color-series-(\d+)\s*:")


def series_slots_used(js):
    """The highest slot apps/web/charts.js's own code names, or None.

    Contiguous from 0 by construction - every slot from 0 up to the
    highest named one is "in use", the same shape a cycle length always
    described, so the range-and-compare logic below needs no change to
    read a literal set instead of a modulo number.
    """
    found = [int(n) for n in SERIES_LITERAL.findall(js)]
    return max(found) + 1 if found else None


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
    """[problem] for a chart script that uses a series slot the stylesheet
    does not style.

    Checks one direction only, and that is a change from before this
    slice (0.9-M2-S3, #354) rather than an oversight. apps/web/
    dashboard.js cycled through every slot theme.css defined, so a slot
    defined and never reached was real dead CSS; apps/web/charts.js uses
    exactly two (design mandate 6 fixes the shape there), and theme.css
    still carries all six, validated together as one set - color 2's
    contrast and CVD separation were measured against colors 3, 4 and 5,
    not against color 0 and 1 alone, so trimming the unused four would
    mean re-deriving the ordering for whatever uses them next rather
    than reusing work already done. The four spare slots are accepted
    headroom, not an orphan: nothing here declares them dead, and
    nothing needs to until a change actually removes their last reason
    to exist. tools/check_contrast.py keeps measuring all six against
    both backgrounds regardless, so a spare slot still cannot go
    unmeasured while it waits.

    The trap this still guards against: no .series-N name appears as a
    literal string anywhere in this repository outside apps/web/
    charts.js's own two, so a slot it uses but theme.css does not style
    looks unused to a search and is not.
    """
    problems = []
    used = series_slots_used(js)
    if used is None:
        return ["apps/web/%s composes no series class this check can read, "
                "so nothing says which slots theme.css must define. The "
                "shape it reads is a quoted \"chart-series series-N\" (or "
                "chart-dot / chart-series-label) literal - if the chart "
                "now picks its slot some other way, teach this check the "
                "new shape rather than leaving the stylesheet's slots "
                "answering to nothing" % CHART_FILE]
    if not used:
        return ["apps/web/%s names no series slot at all, so every chart "
                "line would draw with no class to color it" % CHART_FILE]

    stroke, fill, palettes = stylesheet_series(css)

    absent, _extra = missing_slots(stroke, used)
    if absent:
        problems.append(
            "apps/web/%s uses series slot%s %s and apps/web/%s defines no "
            ".series-%s rule, so a chart line at that slot is stroked in "
            "whatever color it inherits - which is the color of the line "
            "beside it, on the one chart whose job is telling two people "
            "apart"
            % (CHART_FILE, "s" if len(absent) != 1 else "",
               list(range(used)), STYLESHEET,
               ", .series-".join(str(n) for n in absent)))

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
        short, _over = missing_slots(slots, used)
        if short:
            problems.append(
                "apps/web/%s gives \"%s\" no value for series slot%s %s, "
                "which apps/web/%s uses. A palette is copied from the one "
                "open at the time and trimmed, and the chart only looks "
                "wrong on that theme"
                % (STYLESHEET, palette, "s" if len(short) != 1 else "",
                   short, CHART_FILE))

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


# A namespace one script reads at CALL time from a page that may not have
# published it, declared here with the reason.
#
# EMPTY, AND THAT IS THE HEALTHY STATE. Every script in apps/web is
# loaded on a page that publishes what it captures, so the ordering rule
# below judges every capture there is. The table stays because the
# exemption it grants is real - a rule with no way to say "this read
# happens when a button is pressed" would eventually be answered by
# loading a publisher onto pages that need none of it - but a row is a
# cost, and an empty registry is what a registry looks like when the
# code does not need one.
#
# What a row costs, said plainly, because the last one cost it: the
# exemption does not merely permit the read, it REMOVES ORDER POLICING
# for the pair. So a page reorder afterwards captures undefined, the
# guarded call goes quiet, and whatever that call was for stops
# happening with every stage of this gate green.
#
# THIS FILE DECLARES THE EXEMPTION AND DOES NOT EARN IT, and that split
# is the whole of the rule. An earlier version tried to earn it here,
# from the text: the reference must not appear at brace depth 1, and the
# value must be guarded. Each of those is a PROXY for "the namespace is
# not touched while the page loads", and all three were defeated - a
# function defined deep and CALLED at top level captures at load with
# the depth arm satisfied; an unbalanced brace inside a string literal
# inflates the counter permanently, so the very `const UI =
# root.BinderUI;` shape this rule exists for reads as deep; and a
# file-wide guard regex is satisfied by a dead guard, or by the guard's
# own text inside a string, while the real use goes unguarded.
#
# The property is earned by EXECUTION instead, in dev/signout.test.mjs:
# it reads THIS table and fails if it holds a row whose deferred read is
# not demonstrated by loading the shipped bytes under a recording global.
# Adding a row here is therefore two changes, and the second one is the
# evidence - AGENTS.md's corollary applied to the exemption itself, since
# something outside the file has to say what the file may contain.
#
# What belongs here is what a registry is for: the pair, and the reason.
DEFERRED_CAPTURES = {}


def deferred_capture_problems(name, js, declared=DEFERRED_CAPTURES):
    """[problem] for a declared deferred capture that is not reviewable.

    Pure over one script's text, and deliberately narrow: it asks only
    that a declared pair name a script which really reads the namespace,
    and carry a reason. Whether that read is SAFE is a runtime question,
    answered by running the bytes - see the note above.

    The table is a PARAMETER, defaulting to the shipped one, because the
    shipped one is empty: arms driving it would exercise the loop zero
    times and pass by describing nothing, which is the armed-looking and
    inert shape this repository refuses. dev/check_web.test.py hands it
    a synthetic table instead, and the gate below hands it none.
    """
    problems = []
    for (script, namespace), reason in sorted(declared.items()):
        if script != name:
            continue
        if not reason.strip():
            problems.append(
                "%s is exempted for %s with no reason written down. The "
                "reason is the whole of what makes this reviewable"
                % (script, namespace))
        # A pair naming a script that does not read the namespace is an
        # exemption for nothing - either the code moved and the row
        # outlived it, or the row was wrong when written. Both are stale
        # rows in a table whose only job is to be current.
        if not re.search(CAPTURED_NAMESPACE % namespace, js):
            problems.append(
                "%s is exempted for %s and never reads it. An exemption "
                "that guards nothing is a row to delete"
                % (script, namespace))
    return problems


def run_order_problems(run, captures, declared=DEFERRED_CAPTURES):
    """[problem] for a run of scripts that reads a namespace too early.

    Pure, over a run and a capture map, because the hazard is a page's
    ORDER and a rule exercised only against the five orders that exist
    today is a rule tested against today's content. The exemption table
    is a parameter for the reason deferred_capture_problems() gives.
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
            # Declared as read when something is pressed rather than as
            # the page loads, and shape-checked where the script is read.
            # The ordering rule has nothing to say about it: there is no
            # load-time window to be on the wrong side of.
            if (name, namespace) in declared:
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


# The Sign out control, by the id signout.js wires its click to. Read as
# the whole attribute value rather than as a substring, so a control
# named `sign-out-confirm` tomorrow is not silently taken for this one.
SIGN_OUT_CONTROL = re.compile(r'\bid\s*=\s*["\']sign-out["\']', re.I)

# The module that performs it, and the only place destruction lives.
SIGN_OUT_SCRIPT = "signout.js"


def sign_out_wiring_problems(text):
    """[problem] for a page offering Sign out without the module for it.

    Nothing else in this file says a page must load a particular script.
    SHELLS pins the markup a page carries, page_loading_problems() pins
    where scripts sit, and run_order_problems() pins their order - none
    of the three has an opinion about which scripts exist. That gap is
    fine for every module here except this one, because signing out is
    the act that destroys what this device retains: the session, the
    cleartext prefill, and the device key that opens every entry the
    member has ever submitted.

    Destruction rides signout.js precisely so that no page can forget it
    while offering the button - IndexedDB is origin-wide and the key is
    there whatever the page loaded. So the button and the module are one
    thing, and this is the rule that says so. A page copied from an open
    tab with the rail in it and one line missing from the run would
    otherwise ship a control that neither ends the session nor destroys
    anything, and every stage of this gate would pass.

    Comments go first, because a script tag commented out while
    debugging is not a loaded script and the page comments beside these
    runs discuss this very file at length. A page whose body cannot be
    read is not judged here: page_loading_problems() reports that on the
    same page, and one defect is one row.
    """
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    if not SIGN_OUT_CONTROL.search(text):
        return []
    if page_body(text) is None:
        return []
    if SIGN_OUT_SCRIPT in page_script_run(text):
        return []
    return [
        "offers a Sign out control and never loads %s, which is the "
        "module that performs it. Sign out ends the session, erases the "
        "cleartext prefill and destroys the member's device key - a page "
        "with the button and without the module offers all three and "
        "does none of them" % SIGN_OUT_SCRIPT]


def loading_problems():
    """(page, problem) for every published page's loading shape."""
    captures = {}
    problems = []
    for name in sorted(os.listdir(WEB)):
        if name.endswith(".js"):
            js = strip_js_comments(
                open(os.path.join(WEB, name), encoding="utf-8").read())
            captures[name] = module_captures(js)
            # Attributed to the script rather than to a page: an
            # exemption whose shape has gone is wrong wherever it is
            # loaded, and blaming the first page to load it would send
            # the reader to the wrong file.
            for problem in deferred_capture_problems(name, js):
                problems.append((name, problem))

    for name in html_pages():
        text = open(os.path.join(WEB, name), encoding="utf-8").read()
        text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
        for problem in page_loading_problems(text):
            problems.append((name, problem))
        # PREPAINT_SCRIPT is not part of page_script_run() - that
        # function's own docstring is "the site's own scripts, in the
        # order they execute", and the pre-paint one is a different kind
        # of script, blocking in the head rather than classic at the end
        # of the body. It still runs before every one of them, which is
        # exactly check 22's own guarantee a few hundred lines up - so
        # for the ordering question alone, it is seeded in at the front
        # rather than left for the loop below to read as a publisher
        # that never ran. Since 0.9-M2-S6 (#82) it is a publisher
        # (BinderCustomPalette, in MODULE_EXPORTS), and without this seed
        # every page capturing it would fail order for a script that in
        # fact always runs first.
        run = [PREPAINT_SCRIPT, *page_script_run(text)]
        for problem in run_order_problems(run, captures):
            problems.append((name, problem))
        for problem in sign_out_wiring_problems(text):
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
    """[(id, name)] for one page's palette chips, in document order.

    `name` is what a member is offered the palette BY, and a swatch
    carries one in its aria-label: a row of four dots is the shape that
    cannot cover anything however it fails, and a dot has no words in
    it. Reading only visible words would leave every swatch nameless
    here, and then check 23's parity and check 24's ruled-word arm
    would both have nothing left to compare.

    Visible words still WIN where a chip has both, and the branch is
    kept for that reason rather than for a page that uses it today.
    They are what a sighted member acts on, and a label that disagreed
    with them would be the two-names-for-one-palette failure #152
    exists for, one layer down.

    `name` is None for a chip whose element never closes, which says
    something different from a chip carrying no name at all - the two
    send whoever reads the failure to look at different things.

    Takes comment-stripped markup, for the reason page_text() gives: the
    footer notes on these pages name this attribute repeatedly, and a
    rule reading a page's comments is describing markup the page does
    not have.
    """
    chips = []
    for found in CHIP_OPEN.finditer(text):
        tag, attributes = found.group(1), found.group(2)
        closing = re.compile(r"</%s\s*>" % re.escape(tag), re.I)
        end = closing.search(text, found.end())
        if end is None:
            name = None
        else:
            name = (label_text(text[found.end():end.start()])
                    or " ".join((tag_attribute(attributes, "aria-label")
                                 or "").split()))
        chips.append((tag_attribute(attributes, CHIP_ATTRIBUTE) or "",
                      name))
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
                "there is no name to compare and the rest of the page is "
                "inside the button" % (name or CHIP_ATTRIBUTE))
        elif not label:
            problems.append(
                "carries a chip for \"%s\" with neither visible words nor "
                "an aria-label. The id is what gets stored; the name is "
                "the only part of this a member is ever offered, and a "
                "colored dot with nothing to call it is a control only "
                "somebody who can see it can use" % name)

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


# ------------------------------------------------------------------
# Check 24: the design tokens the mockup rules.
#
# The artifact "Binder — Site Mockup (post-cutover)" is the owner's
# styling and design gate of record (#203), and CI cannot fetch it. So
# what it rules arrives here as a hand-derived table pinned outside the
# file it guards - the arrangement DESTINATIONS, SHELLS and SCOPES in
# check_contrast.py are already in, for the review bar's reason: a check
# computed entirely from the stylesheet cannot detect that the
# stylesheet was redesigned.
#
# WHEN THE OWNER UPDATES THE ARTIFACT this table is edited in the same
# change as the stylesheet, and the mockup's own words for the decision
# go in the commit message. That is deliberately the same two-place act
# as raising a ceiling in tools/check_budget.py, where the rule moves
# next to the reason it moved and a reviewer reads both at once. There
# is no third place to keep in step: the artifact is not in this
# repository, and this table is the whole of what the gate knows about
# it.
#
# WHAT IS PINNED IS THE TOKEN LAYER, not the components. Every rule in
# this stylesheet takes its color, its type, its spacing and its
# measures out of these custom properties, so the tokens are the
# vocabulary the mockup and the shipped site actually share. Copying the
# component rules in instead would put a second stylesheet inside a
# Python file, stale on the first legitimate refactor - and it is the
# token underneath that a one-character edit moves invisibly. --measure
# from 46rem to 60rem re-lays out five pages and fails nothing.
#
# WHAT IS DELIBERATELY NOT PINNED, because the next reader will ask:
#
#  - The de-carded admin instrument, which is check 25's rather than
#    this table's. The seam is the one this list opens with: a token is
#    a value to copy across, and a component's geometry is a comparison
#    between pages - so pinning the instrument here would mean writing
#    the mockup's component rules into this file, which is the second
#    stylesheet the paragraph above refuses. Check 25 compares instead,
#    and reads SHELLS and SURFACES for which page owes which grammar.
#  - Rendered pixels. There is no layout engine here and #75 rejected
#    jsdom for exactly this, so these are declared values, the same
#    limit check_contrast.py states about itself. Which token paints
#    which element is outside all of it.
#  - Taste: visual weight, the rail's proportions, the sample figures.
#
# HOW THIS SITS BESIDE check_contrast.py, which reads the same hexes.
# That file asks whether a palette is LEGIBLE, and whether anything
# ships unmeasured. This asks whether it is the palette the design gate
# RULED. A shift from #120d10 to #0b0b0b clears every ratio there with
# room to spare, and is exactly what this is for. Neither reads the
# other's table; a fifth palette reddens both, in two sentences sending
# the reader to two different places, because "unmeasured" and "unruled"
# are two different repairs.
MOCKUP = 'the "Binder — Site Mockup (post-cutover)" artifact'

# (media condition, selector list) -> which palette that block declares,
# both normalized for whitespace. Keyed on the pair rather than on the
# selector alone because Daylight and Contrast are each written out
# TWICE - once for the attribute a member picks, once for the system
# preference somebody arrives with - and the two copies are kept in step
# by hand, which is how the three rails drifted. Reading both against
# one ruled set rather than against each other is what stops the drifted
# copy being the reference.
MOCKUP_PALETTE_BLOCKS = {
    ("", ':root, :root[data-theme="midnight"]'): "midnight",
    ("", ':root[data-theme="pink"]'): "pink",
    ("", ':root[data-theme="daylight"]'): "daylight",
    ("", ':root[data-theme="contrast"]'): "contrast",
    ("(prefers-color-scheme: light)", ":root:not([data-theme])"): "daylight",
    ("(prefers-contrast: more)", ":root:not([data-theme])"): "contrast",
}

# The one block that is not a palette. Everything a palette does not
# decide is decided here, once, which is why a palette redeclaring one
# of these fails below rather than being merged in.
MOCKUP_SCALE_BLOCK = ("", ":root")

# From the mockup's `.site` token block. The scale is one decision for
# the whole site there as it is here, and the mockup's own note records
# why the font stacks can be compared at all: the live site serves its
# vendored woff2 files and the mockup shows the site's fallback stacks,
# so these are the same strings on both sides.
MOCKUP_SCALE = {
    "--color-accent-quiet":
        "color-mix(in oklab, var(--color-accent) 12%, transparent)",
    "--font-display":
        '"Playfair Display", Georgia, "Palatino Linotype", "Book Antiqua", serif',
    "--font-body":
        '"DM Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    "--font-mono":
        '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    "--text-xs": "0.8125rem",
    "--text-sm": "0.875rem",
    "--text-base": "1rem",
    "--text-lg": "1.125rem",
    "--display": "clamp(1.5rem, 1.25rem + 1.1vw, 1.9rem)",
    "--space-1": "0.25rem",
    "--space-2": "0.5rem",
    "--space-3": "0.75rem",
    "--space-4": "1rem",
    "--space-6": "1.5rem",
    "--space-8": "2rem",
    "--radius": "0.75rem",
    "--radius-pill": "999px",
    "--measure": "46rem",
    "--measure-wide": "84rem",
    "--rail-width": "15rem",
}

# The four palettes, from the mockup's `.site` block (Midnight, its
# default) and its three `.frame[data-palette="…"] .site` blocks. Every
# palette rules the same twenty-one tokens, and the suite pins that: a
# palette short of one takes whatever the cascade left above it, which
# is the shape of #81's worst finding.
MOCKUP_PALETTES = {
    # The default, and the mockup's own default frame.
    "midnight": {
        "--color-bg": "#120d10",
        "--color-surface": "#1c1417",
        "--color-accent": "#c73743",
        "--color-accent-strong": "#bd3440",
        "--color-text": "#f1e9e2",
        "--color-text-muted": "#bba9a6",
        "--color-border": "#4a3a40",
        "--color-border-strong": "#7a6870",
        "--color-warn-bg": "#3a2a18",
        "--color-warn-text": "#e7b583",
        "--color-field": "#120d10",
        "--color-focus": "#f2a9b4",
        "--color-accent-text": "#e4737c",
        "--color-gold": "#d2a24c",
        "--color-on-accent": "#fff7f1",
        "--color-series-0": "var(--color-accent)",
        "--color-series-1": "#c98500",
        "--color-series-2": "#d55181",
        "--color-series-3": "#9085e9",
        "--color-series-4": "#199e70",
        "--color-series-5": "#d95926",
    },
    "pink": {
        "--color-bg": "#1e141a",
        "--color-surface": "#2a1d26",
        "--color-accent": "#e87fa8",
        "--color-accent-strong": "#f4a6c6",
        "--color-text": "#f5e6ee",
        "--color-text-muted": "#c2aab8",
        "--color-border": "#493742",
        "--color-border-strong": "#8b7784",
        "--color-warn-bg": "#3f2320",
        "--color-warn-text": "#f0b49f",
        "--color-field": "#1e141a",
        "--color-focus": "#ffa8c8",
        "--color-accent-text": "#e87fa8",
        "--color-gold": "#d2a24c",
        "--color-on-accent": "#1e141a",
        "--color-series-0": "var(--color-accent)",
        "--color-series-1": "#d95926",
        "--color-series-2": "#199e70",
        "--color-series-3": "#c98500",
        "--color-series-4": "#9085e9",
        "--color-series-5": "#e66767",
    },
    # "Daylight" throughout since #191 - the id already was daylight,
    # and the longer label #127 chose was renamed by the same ruling.
    # MOCKUP_CHIPS below is where that word is held.
    "daylight": {
        "--color-bg": "#f3eadb",
        "--color-surface": "#fbf5ea",
        "--color-accent": "#8e2530",
        "--color-accent-strong": "#75161f",
        "--color-text": "#2e2226",
        "--color-text-muted": "#61524b",
        "--color-border": "#d6c6b0",
        "--color-border-strong": "#857567",
        "--color-warn-bg": "#ebdcc2",
        "--color-warn-text": "#6e4a1f",
        "--color-field": "#fffdf6",
        "--color-focus": "#5e1b23",
        "--color-accent-text": "#8e2530",
        "--color-gold": "#7e5a14",
        "--color-on-accent": "#fbf1e4",
        "--color-series-0": "var(--color-accent)",
        "--color-series-1": "#9c6100",
        "--color-series-2": "#2a78d6",
        "--color-series-3": "#b23a63",
        "--color-series-4": "#4a3aa7",
        "--color-series-5": "#0a7d4f",
    },
    "contrast": {
        "--color-bg": "#000000",
        "--color-surface": "#0a0a0a",
        "--color-accent": "#f08090",
        "--color-accent-strong": "#f8b0bc",
        "--color-text": "#ffffff",
        "--color-text-muted": "#d6d0ce",
        "--color-border": "#3a3a3a",
        "--color-border-strong": "#a0a0a0",
        "--color-warn-bg": "#201500",
        "--color-warn-text": "#ffd08a",
        "--color-field": "#000000",
        "--color-focus": "#ffffff",
        "--color-accent-text": "#f08090",
        "--color-gold": "#f5c674",
        "--color-on-accent": "#000000",
        "--color-series-0": "var(--color-accent)",
        "--color-series-1": "#d95926",
        "--color-series-2": "#199e70",
        "--color-series-3": "#c98500",
        "--color-series-4": "#9085e9",
        "--color-series-5": "#e66767",
    },
}

# The words on the chips, from the mockup's theme picker - which every
# page in it carries identically, in this order.
#
# This is the half check 23 declines. That arm holds the four hand-kept
# copies to EACH OTHER, and its docstring says why it stops short of the
# wording: a check pinning the words "would have to be edited to ship a
# decision that is the owner's to make". #203 is the ticket that makes
# that edit the intended act - the decision has been made, in the
# artifact, and the artifact is now what the gate answers to. Order and
# cross-page agreement stay check 23's, so neither arm restates the
# other: 23 says the four copies agree, this says the word they agree on
# is the ruled one.
#
# "custom" joined the four at 0.9-M2-S6 (#82) as a design-consult
# exception - the chip's own dot was painted at runtime from a member's
# own colors and had no fixed value the mockup could ever rule the way
# it rules the other four's - and left again at 0.9-M2-S13 (#378, the
# 2026-08-19 charts sitting round two): the custom swatch circle this
# entry named is REMOVED, so there is no data-set-theme="custom" chip
# left on any page for this table to rule a word for. The mockup's own
# four remain what this table is, unexceptioned once more.
MOCKUP_CHIPS = {
    "midnight": "Midnight",
    "pink": "Pink",
    "daylight": "Daylight",
    "contrast": "Contrast",
}

# What a stale chip pin is attributed to, when there is no page to
# blame. The parallel of CHIP_PIN one check up.
MOCKUP_CHIP_PIN = "MOCKUP_CHIPS in tools/check_web.py"

# Surfaces the mockup rules OUT, refused rather than merely absent.
# Absence is not a claim: this note is gone from every page and from
# theme.css after #191, and nothing else in this gate would notice it
# coming back on the next page copied from a tab somebody had open.
# RETIRED_IDS and RETIRED_LABEL are the same shape for the hamburger and
# the old label component; this table is the one whose provenance is the
# mockup rather than a component's retirement.
REFUSED_CLASSES = {
    "rail-note": (
        "the keyholder note under Admin, removed outright by #191 - "
        "\"seems silly to tell anyone what they may need\". The rail "
        "says where a member can go, and nothing about who is allowed "
        "in when they get there"),
}

# The three stacks whose lead family the site vendors. Held apart from
# MOCKUP_SCALE because the arm below reads the stylesheet's own value
# rather than the pinned one: a rename that reaches BOTH the mockup and
# this table still has to arrive with a woff2 behind it.
FONT_TOKENS = ("--font-display", "--font-body", "--font-mono")

CUSTOM_PROPERTY = re.compile(r"(--[\w-]+)\s*:\s*([^;]+);")

FONT_FACE_FAMILY = re.compile(
    r"@font-face\s*\{[^{}]*?font-family\s*:\s*([^;]+);", re.S | re.I)


def family_name(text):
    """One font family, unquoted and unpadded."""
    return text.strip().strip("\"'").strip()


def lead_family(stack):
    """The family a stack leads with - the one it asks for first."""
    return family_name(stack.split(",")[0])


def custom_property_blocks(css):
    """[(media, selector, [(name, value)])] per block declaring one.

    A block declaring no custom property is left out entirely, so an
    @font-face, a component rule and a @keyframes step never appear
    here at all. Both the media condition - "" outside any @media - and
    the selector list are whitespace-normalized, because a table keyed
    on the exact bytes of a selector goes stale the first time somebody
    rewraps a line, and a stale key reads as a block that is missing
    AND a block nothing rules.

    Not media_block_bodies() one check up: that helper discards the
    condition, which is all check 20 needs and the whole of what a
    palette block is identified by here. The order blocks come back in
    is not document order across an @media boundary; nothing below
    depends on it, and everything it reports is sorted.
    """
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)

    blocks = []

    def read(text, media):
        for rule in CSS_RULE.finditer(text):
            declared = [(name, " ".join(value.split()))
                        for name, value in CUSTOM_PROPERTY.findall(
                            rule.group(2))]
            if declared:
                blocks.append((media, " ".join(rule.group(1).split()),
                               declared))

    outside = []
    index = 0
    for opener in re.finditer(r"@media([^{]*)\{", css):
        if opener.start() < index:
            continue  # nested, and already inside a body read below
        outside.append(css[index:opener.start()])
        depth, end = 1, opener.end()
        while end < len(css) and depth:
            if css[end] == "{":
                depth += 1
            elif css[end] == "}":
                depth -= 1
            end += 1
        read(css[opener.end():end - 1], " ".join(opener.group(1).split()))
        index = end
    outside.append(css[index:])
    read("".join(outside), "")

    return blocks


def block_name(key):
    """A block key written as something to go and look for."""
    media, selector = key
    return "%s inside @media %s" % (selector, media) if media else selector


def token_problems(css):
    """[problem] for a stylesheet that has left the mockup's table.

    Takes the text rather than reading the file, for the reason check
    18 gives: a rule reachable only through the stylesheet it guards is
    a rule tested against today's stylesheet, and the shape of the
    failure is what has to hold.
    """
    problems = []

    declared_by = {}
    for media, selector, declared in custom_property_blocks(css):
        declared_by.setdefault((media, selector), []).append(dict(declared))

    ruled = dict.fromkeys(MOCKUP_PALETTE_BLOCKS)
    ruled.update(MOCKUP_PALETTE_BLOCKS)
    ruled[MOCKUP_SCALE_BLOCK] = None  # the scale block rules no palette

    for key in sorted(set(declared_by) - set(ruled)):
        problems.append(
            "declares custom properties in %s, and %s does not rule that "
            "block. Either a design decision has shipped that the mockup "
            "has not been shown, or MOCKUP_PALETTE_BLOCKS in "
            "tools/check_web.py has not been told about it - a token "
            "block nothing rules is this gate back where #203 found it"
            % (block_name(key), MOCKUP))

    for key in sorted(set(ruled) - set(declared_by)):
        problems.append(
            "declares nothing in %s, and %s rules that block as %s. Either "
            "it has stopped shipping, or the pin in tools/check_web.py is "
            "stale - and a stale pin is how a table stops describing the "
            "site while still passing"
            % (block_name(key), MOCKUP,
               'the "%s" palette' % ruled[key] if ruled[key]
               else "the shared scale"))

    for key in sorted(set(declared_by) & set(ruled)):
        copies = declared_by[key]
        what = ('the "%s" palette' % ruled[key] if ruled[key]
                else "the shared scale")
        if len(copies) > 1:
            problems.append(
                "declares %s %d times over. The last one wins, so a value "
                "corrected in any of the others changes nothing and reads "
                "as done" % (block_name(key), len(copies)))

        wanted = (MOCKUP_PALETTES[ruled[key]] if ruled[key]
                  else MOCKUP_SCALE)
        shipped = copies[-1]  # the one that wins, if there is more than one

        for name in sorted(set(wanted) - set(shipped)):
            problems.append(
                "does not declare %s for %s (%s), and %s rules it as "
                "\"%s\". A token a block stops declaring falls through "
                "to whatever the cascade left above it"
                % (name, what, block_name(key), MOCKUP, wanted[name]))

        for name in sorted(set(shipped) - set(wanted)):
            problems.append(
                "declares %s for %s (%s), and %s rules no such token "
                "there. Show the mockup the decision and pin it here in "
                "the same change, or take it out"
                % (name, what, block_name(key), MOCKUP))

        for name in sorted(set(shipped) & set(wanted)):
            if shipped[name] != wanted[name]:
                problems.append(
                    "declares %s as \"%s\" where %s rules \"%s\", for %s "
                    "(%s)" % (name, shipped[name], MOCKUP, wanted[name],
                              what, block_name(key)))

    return problems


def font_stack_problems(css):
    """[problem] for the type stacks and the faces disagreeing.

    The mockup's own note records the one departure it could not avoid:
    the live site serves its vendored Playfair Display / DM Sans /
    JetBrains Mono woff2 files where the mockup shows the fallback
    stacks. That is what makes this checkable rather than a matter of
    trust - and the failure is silent by construction, because a stack
    leading with a family nothing vendors still RESOLVES, to the next
    name in it. Every page keeps rendering, in a face the mockup never
    showed, with nothing anywhere failing.

    Read off the stylesheet's own values rather than out of
    MOCKUP_SCALE, so that a rename reaching both the mockup and the
    table still has to arrive with a font file behind it.
    """
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    vendored = {family_name(found)
                for found in FONT_FACE_FAMILY.findall(css)}

    leads = {}
    for _media, _selector, declared in custom_property_blocks(css):
        for name, value in declared:
            if name in FONT_TOKENS:
                leads[name] = lead_family(value)

    problems = []
    for name in FONT_TOKENS:
        # A stack that is not declared at all is token_problems()' to
        # report, and it reports it against the block it is missing
        # from, which is the more useful sentence of the two.
        if name in leads and leads[name] not in vendored:
            problems.append(
                "leads %s with \"%s\", and no @font-face here serves that "
                "family. The stack still resolves - to the next name in "
                "it - so every page renders in a face %s does not show, "
                "and nothing fails" % (name, leads[name], MOCKUP))

    for family in sorted(vendored - set(leads.values())):
        problems.append(
            "serves \"%s\" with an @font-face, and no font stack here "
            "leads with it. Its woff2 is committed and copied into "
            "dist/, and no page will ever ask for it" % family)

    return problems


# The swatch dots, and the one place in this stylesheet where a
# palette's colors are written out on a component.
#
# It is forced rather than chosen. A palette's tokens live under
# `:root[data-theme="pink"]`, so from inside whatever palette the page
# is currently wearing there is no expression that says "Pink's page
# color" - `var(--color-bg)` says the color of the palette already on
# screen, four times over, and the row of dots comes out in one color.
# Writing the values on the dot is the only way it can show what it
# offers.
#
# Which is exactly the shape that goes stale in silence: a palette
# retuned in the block above leaves four dots quietly meaning the colors
# those palettes had. So the copy is held to the ruled palette here, and
# the drift becomes a red gate instead of a design that stops being
# true.
SWATCH_DOT = re.compile(
    r"\.swatch-dot\s*\[\s*data-palette\s*=\s*\"([\w-]+)\"\s*\]\s*\{([^{}]*)\}")

# Which declaration on the dot answers to which palette token. Both are
# whole declarations rather than parts of a shorthand, and that is what
# makes them readable here: a ring written as `border: 0.2rem solid #x`
# would bury the color where this reader cannot compare it, so the width
# and the style are declared once on .swatch-dot itself and only the
# color varies.
SWATCH_TOKENS = {
    "background": "--color-bg",
    "border-color": "--color-accent",
}


def swatch_problems(css):
    """[problem] for the swatch dots drifting from the ruled palettes.

    Both directions, the DESTINATIONS way. A dot for a palette the
    mockup does not rule is a palette the design gate has never seen,
    offered in every footer on the site; a ruled palette with no dot is
    the row quietly dropping one, which nothing else here would notice
    because three dots look exactly as intentional as four.
    """
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)

    painted = {}
    for palette, body in SWATCH_DOT.findall(css):
        painted.setdefault(palette, []).append(
            {name.strip(): " ".join(value.split())
             for name, value in DECLARATION.findall(body)})

    problems = []

    for palette in sorted(set(painted) - set(MOCKUP_PALETTES)):
        problems.append(
            "paints a swatch for the palette \"%s\", and %s rules "
            "four: %s. A dot nobody has drawn is a palette every footer "
            "offers and the design gate has never seen"
            % (palette, MOCKUP, ", ".join(sorted(MOCKUP_PALETTES))))

    for palette in sorted(set(MOCKUP_PALETTES) - set(painted)):
        problems.append(
            "paints no swatch for the \"%s\" palette, and %s rules "
            "it. The dot is the whole of what tells that button apart from "
            "the ones beside it, so an unpainted one is a control with "
            "nothing on it" % (palette, MOCKUP))

    for palette in sorted(set(painted) & set(MOCKUP_PALETTES)):
        copies = painted[palette]
        if len(copies) > 1:
            problems.append(
                "paints the \"%s\" swatch %d times over. The last one wins, "
                "so a color corrected in any of the others changes nothing "
                "and reads as done" % (palette, len(copies)))
        shown = copies[-1]

        for prop in sorted(SWATCH_TOKENS):
            token = SWATCH_TOKENS[prop]
            wanted = MOCKUP_PALETTES[palette][token]
            if prop not in shown:
                problems.append(
                    "paints the \"%s\" swatch with no %s, so that half of "
                    "the dot falls through to whatever the cascade left "
                    "above it instead of showing %s (%s)"
                    % (palette, prop, token, wanted))
            elif shown[prop] != wanted:
                problems.append(
                    "paints the \"%s\" swatch's %s as \"%s\" where that "
                    "palette's %s is \"%s\". The dot is a copy of the "
                    "palette because CSS cannot reach one palette's tokens "
                    "from inside another, and a copy nothing compares is a "
                    "swatch that stops meaning the palette it offers"
                    % (palette, prop, shown[prop], token, wanted))

    return problems


def mockup_token_problems():
    """The three arms check 24 reads off theme.css."""
    css = stylesheet_text()
    if css is None:
        return []  # the missing-stylesheet case is check 1's to report
    return (token_problems(css) + font_stack_problems(css)
            + swatch_problems(css))


def page_chip_label_problems(text):
    """[problem] for one page's chips against the ruled palette names.

    An empty id, an empty label and an element that never closes are
    all check 23's roster arm to report, and it reports each of them
    against a different thing to go and look at. They are skipped here
    rather than restated, which is the same seam that arm's own
    docstring holds with check 19.
    """
    problems = []
    for name, label in page_chips(text):
        if not name or not label:
            continue
        if name not in MOCKUP_CHIPS:
            problems.append(
                "offers the palette \"%s\", and %s rules four: %s. A "
                "palette the design gate has not seen is one nobody has "
                "measured, named or drawn"
                % (name, MOCKUP, ", ".join(sorted(MOCKUP_CHIPS))))
        elif label != MOCKUP_CHIPS[name]:
            problems.append(
                "calls the \"%s\" palette \"%s\", and %s calls it \"%s\". "
                "The id is what theme.js stores and what theme.css selects "
                "on, so the label is the only part of this a member ever "
                "reads" % (name, label, MOCKUP, MOCKUP_CHIPS[name]))
    return problems


def chip_label_problems():
    """[(subject, problem)] for palette names against the mockup."""
    problems = []
    offered = set()

    for name in sorted(THEMED_PAGES & set(html_pages())):
        text = page_text(name)
        for problem in page_chip_label_problems(text):
            problems.append((name, problem))
        offered.update(palette for palette, _label in page_chips(text)
                       if palette)

    # Failing open when the site offers no chip at all, on purpose:
    # that is check 19 failing on every themed page in this same run,
    # and four more lines saying the mockup rules a palette nothing
    # offers would send the reader somewhere that is not the problem.
    if offered:
        for palette in sorted(set(MOCKUP_CHIPS) - offered):
            problems.append((
                MOCKUP_CHIP_PIN,
                "rules the \"%s\" palette and no page offers it. Either a "
                "palette has been dropped from every page at once, or this "
                "pin has outlived the mockup it was taken from"
                % palette))

    return problems


def page_refused_problems(text):
    """[problem] for one page carrying a surface the mockup ruled out."""
    classes = set()
    for attribute in re.findall(CLASS_ATTR, text):
        classes.update(attribute.split())

    return ["carries .%s, and %s rules it out: %s. Take the markup out "
            "rather than hiding it - a hidden surface is one the next "
            "page copied from this one inherits"
            % (name, MOCKUP, REFUSED_CLASSES[name])
            for name in sorted(REFUSED_CLASSES) if name in classes]


def stylesheet_refused_problems(css):
    """[problem] for a stylesheet still painting a ruled-out surface.

    The boundary is stricter than check 16's `\\b`, which matches
    between a word character and a hyphen and would read .rail-note-x
    as .rail-note. A refusal is allowed to be wrong in the direction of
    firing on garbage; it is not allowed to be wrong about a class
    somebody legitimately named.
    """
    return ["still defines .%s, and %s rules it out: %s. A rule left "
            "behind for a surface that has gone is what the next page "
            "written from an old tab finds already styled"
            % (name, MOCKUP, REFUSED_CLASSES[name])
            for name in sorted(REFUSED_CLASSES)
            if re.search(r"(^|[\s,{}>+~])\.%s(?![\w-])" % re.escape(name),
                         css)]


def refused_surface_problems():
    """[(subject, problem)] for ruled-out surfaces still shipping."""
    problems = []
    for name in html_pages():
        for problem in page_refused_problems(page_text(name)):
            problems.append((name, problem))

    css = stylesheet_text()
    if css is not None:
        for problem in stylesheet_refused_problems(css):
            problems.append((STYLESHEET, problem))

    return sorted(problems)


# ------------------------------------------------------------------
# Check 25: one card geometry across the signed-in pages, and the
# instrument's boxes are warnings.
#
# #178's finding is that nothing in this gate compared the SHAPE of a
# box from one page to the next, so the shapes drifted and only a
# person putting two pages side by side ever noticed. The owner's
# ruling on that issue is one grammar PER SHELL - cards on the member
# pages, runner-headed sections on the instrument - and the rule to
# pin, in the ruling's own words, is that "on body.instrument, boxes
# are for warnings only".

# The components a card's shape is actually made of. `.card` is the
# box, `.stack` is the rhythm between one box and the next, and h2 is
# the header shape inside it - the five things #178 names, in the three
# selectors that carry them.
GEOMETRY_SUBJECTS = ("h2", ".card", ".stack")

# What counts as geometry, as opposed to color or behavior. Written as
# a pattern rather than a set because the longhands are the evasion:
# `padding-top` on one page and `padding` on the other is a difference
# a set of four names never sees, and neither is a shorthand somebody
# splits in half while "tidying".
#
# The width family is here because the owner ruling this check holds
# opens with "cards to all be the same width" - a card's width is the
# first thing that ruling is about, and a per-page width override is
# the drift arriving in the plainest way there is. The logical
# properties are the same evasion as the longhands one row up:
# `inline-size` is `width` under another name, and a family that
# refused only the physical spelling would be a family somebody rewrote
# rather than obeyed.
GEOMETRY_PROPERTY = re.compile(
    r"^(background|background-[\w-]+|border|border-[\w-]+"
    r"|padding|padding-[\w-]+|gap|row-gap|column-gap"
    r"|width|min-width|max-width"
    r"|inline-size|min-inline-size|max-inline-size"
    r"|margin|margin-[\w-]+|flex-basis"
    r"|font-family|font-size)$")

# The surface-qualified rules that may paint a card component, and what
# each is for. THIS IS THE ARM WITH TEETH, and it is worth saying why
# the agreement arm below is not enough on its own: there are two card
# pages today, so a rule that moved BOTH of them satisfies a comparison
# of one against the other perfectly. Drift arrives as a scope - a rule
# that says "on this surface, a card is shaped differently" - and the
# only way to notice one is to have written down which ones exist.
#
# Both directions, the DESTINATIONS way. An entry whose block has gone
# is a pin that can no longer fail, and a block no entry names is the
# override nobody declared.
#
# And each entry pins what its scope DECLARES, not merely that it
# exists. A roster that answered only the existence question let the
# scope's own values move underneath it - the instrument's card padding
# could become 7px and every arm stayed quiet, which is #178's defect
# one indirection out. `declares` is keyed by (media condition,
# property) because a scope that only exists inside a breakpoint is a
# different override from one that always applies, and the empty
# condition is the unconditional rule. Editing a value here in the same
# change as the stylesheet is the point: deliberately the same
# two-place act as raising a ceiling in tools/check_budget.py.
CARD_SCOPES = {
    ("body.instrument", ".card"): {
        "why":
            "the instrument's remaining warning boxes, tightened with "
            "the rest of that surface by the owner's decision on #73. "
            "It is a scope rather than drift because #178 took the "
            "instrument out of the card grammar entirely - what is "
            "left inside these boxes is a caution and a paragraph, "
            "never a tool",
        "declares": {
            ("", "padding"): "var(--space-3) var(--space-4) var(--space-4)",
            ("", "gap"): "var(--space-2)",
        },
    },
    ("body.instrument", "h2"): {
        "why":
            "the instrument gives up the display serif (#73), and a "
            "card heading is that decoration one level down. The sizes "
            "stay ordered so the page title stays the largest thing on "
            "it",
        "declares": {
            ("", "font-family"): "var(--font-body)",
            ("", "font-size"): "var(--text-base)",
        },
    },
    ("body.instrument", ".stack"): {
        "why":
            "the instrument's section-to-section rhythm, which #178 "
            "ruled and measured at --space-8 against the card pages' "
            "--space-4. A runner is a thin line and needs air above it "
            "to read as a division rather than as another paragraph, "
            "so this scope is the de-carded grammar itself rather than "
            "drift away from the shared one",
        "declares": {
            ("", "gap"): "var(--space-8)",
        },
    },
}

BODY_CLASS_ATTR = re.compile(
    r"<body[^>]*\bclass\s*=\s*[\"']([^\"']*)[\"']", re.I)

# A selector's context, once its own compound has been taken off the
# end. Only a body-qualified one can be resolved against a page, which
# is the whole readable vocabulary here; anything else is REPORTED
# rather than skipped, because a reader that quietly drops half its
# input prints the same OK as one that found nothing wrong (#34).
CONTEXT_COMPOUND = re.compile(r"^body((?:\.[\w-]+)*)$")

DECLARATION = re.compile(r"([\w-]+)\s*:\s*([^;]+)")


def body_classes(text):
    """The class list on one page's <body>, as a set.

    An empty set is a real answer - index.html carries no body class -
    and is not the same as a page with no body at all, which cannot
    happen here and would fail check 3 first if it did.
    """
    found = BODY_CLASS_ATTR.search(text)
    return frozenset(found.group(1).split()) if found else frozenset()


# One compound's simple selectors. Every shape is listed, including the
# ones this reader cannot score, because the whole point is to tell
# "not a card rule" apart from "a card rule in a shape I cannot read" -
# and a tokenizer that only knew the readable shapes would answer the
# first for both.
SIMPLE_SELECTOR = re.compile(
    r"\*|[a-zA-Z][\w-]*|\.[\w-]+|#[\w-]+|\[[^\]]*\]"
    r"|::?[\w-]+(?:\([^)]*\))?")

# The two it can: a type selector and a class selector. Those are what
# selector_weight() below scores exactly.
TYPE_OR_CLASS = re.compile(r"[a-zA-Z][\w-]*|\.[\w-]+")

# Whether a compound names a component at all, for the case where it
# does not tokenize. The lookarounds are why `.stack-tight` is not
# `.stack` and `div.h2` is not `h2`.
SUBJECT_MENTION = re.compile(
    "|".join(r"(?<![\w-])%s(?![\w-])" % re.escape(name)
             if name.startswith(".")
             else r"(?<![\w.-])%s(?![\w-])" % re.escape(name)
             for name in GEOMETRY_SUBJECTS))


def compound_simples(compound):
    """[simple selector] for one compound, or None if it does not read."""
    simples = []
    index = 0
    while index < len(compound):
        found = SIMPLE_SELECTOR.match(compound, index)
        if not found:
            return None
        simples.append(found.group(0))
        index = found.end()
    return simples


def geometry_subject(selector):
    """(context, subject, compound) for a rule painting a card component.

    Read from the right-hand end, the way the cascade does: the
    rightmost compound is what the rule paints, and everything left of
    it is the condition under which it paints. `.stack-tight` is a
    different component from `.stack` and must not match it, so simple
    selectors are compared whole rather than by prefix.

    A qualifier does not make a component a different component.
    `div.card`, `main.stack`, `section.card.wide` and `.card.card` all
    paint cards, a browser applies every one of them, and reading only
    the bare form is how a per-page override written the ordinary way
    stayed out of both arms (#154's partition-2 finding). What the
    qualifier does change is specificity, which selector_weight() below
    scores from this compound rather than from the subject.

    `subject` is None when the compound names a component in a shape
    this reader cannot score - a pseudo-class, a pseudo-element, an
    attribute, an id, or two components at once. That is REPORTED by
    the caller, never passed over: an arm that drops what it cannot
    parse prints the same OK as one that found nothing wrong, which is
    #34, and the unreadable-context path beside it has always said so.

    The residual is stated rather than hidden. A modifier class reads
    as its component, so `.card.narrow` is compared as though every
    card carried it - loud where it is wrong, which is the direction a
    refusal is allowed to be wrong in. `.narrow` is refused outright by
    this same check, so the shape has no home here to begin with.
    """
    compounds = " ".join(selector.split()).split()
    if not compounds:
        return None
    context, compound = " ".join(compounds[:-1]), compounds[-1]

    simples = compound_simples(compound)
    if simples is None:
        return (context, None, compound) if SUBJECT_MENTION.search(
            compound) else None

    named = {simple for simple in simples if simple in GEOMETRY_SUBJECTS}
    if not named:
        return None
    if len(named) > 1 or not all(TYPE_OR_CLASS.fullmatch(simple)
                                 for simple in simples):
        return context, None, compound
    return context, named.pop(), compound


def geometry_declarations(css):
    """[(media, context, subject, compound, [(property, value)])].

    In source order. Blocks declaring no geometry are left out
    entirely, so @font-face, @keyframes and every color rule never
    appear here at all. Order within one media scope is document order,
    which is what makes "the last declaration wins" resolvable below.

    The raw compound rides along because specificity is scored from it
    and the messages name it: a subject this reader cannot score has
    nothing else to be called by.
    """
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    blocks = []

    def read(text, media):
        for rule in CSS_RULE.finditer(text):
            declared = [
                (name.lower(), " ".join(value.split()))
                for name, value in DECLARATION.findall(rule.group(2))
                if GEOMETRY_PROPERTY.match(name.lower())]
            if not declared:
                continue
            for selector in rule.group(1).split(","):
                found = geometry_subject(selector)
                if found:
                    blocks.append((media, found[0], found[1], found[2],
                                   declared))

    outside = []
    index = 0
    for opener in re.finditer(r"@media([^{]*)\{", css):
        if opener.start() < index:
            continue  # nested, and already inside a body read below
        outside.append(css[index:opener.start()])
        depth, end = 1, opener.end()
        while end < len(css) and depth:
            if css[end] == "{":
                depth += 1
            elif css[end] == "}":
                depth -= 1
            end += 1
        read(css[opener.end():end - 1], " ".join(opener.group(1).split()))
        index = end
    outside.append(css[index:])
    read("".join(outside), "")

    return blocks


def context_applies(context, classes):
    """Whether a selector's context matches a page, or None if unread.

    None is not "no". It is "this file said something in a vocabulary
    this reader does not have", and the caller reports it - the one
    behavior that keeps an arm from failing open when the stylesheet
    grows a shape nobody anticipated.
    """
    if not context:
        return True
    compounds = context.split()
    if len(compounds) != 1:
        return None
    match = CONTEXT_COMPOUND.match(compounds[0])
    if not match:
        return None
    wanted = {name for name in match.group(1).split(".") if name}
    return wanted <= set(classes)


def selector_weight(context, compound):
    """(classes, elements) for one of the selectors this file accepts.

    Specificity, restricted to the vocabulary context_applies() will
    resolve at all: the compound contributes one per class and one per
    type selector it actually carries, and a context is `body` plus
    however many classes it names. That is exact here rather than an
    approximation, because anything outside the vocabulary is reported
    as unreadable instead of scored.

    Scored from the COMPOUND rather than from the subject, which is the
    other half of reading `div.card` as a card at all: it outranks
    `.card` wherever it sits, and calling both of them one class would
    hand the tie back to source position - the very defect the
    paragraph below says this function exists to have fixed.

    IT HAS TO BE MODELLED, and the first version of this check did not,
    which is the whole reason this function exists. Ordering by source
    position alone says a scoped rule written ABOVE the bare one loses -
    and the browser says the opposite, because `body.x .card` outranks
    `.card` wherever it sits. A stylesheet where a surface override sat
    higher in the file than the component it overrides would then be a
    real, rendered, per-page difference that this arm reported as
    agreement. Caught by mutation: the scope was declared honestly, the
    roster was satisfied, and the comparison stayed silent.
    """
    simples = compound_simples(compound) or []
    classes = len([simple for simple in simples if simple.startswith(".")])
    elements = len([simple for simple in simples if simple[:1].isalpha()])
    if context:
        match = CONTEXT_COMPOUND.match(context)
        classes += len([name for name in match.group(1).split(".") if name])
        elements += 1  # the `body` in the context
    return classes, elements


def resolved_geometry(blocks, classes):
    """({(media, subject, property): value}, [(context, subject, compound)]).

    The second half is what could not be read - a context in a shape
    this reader has no vocabulary for, or a subject it cannot score,
    the two told apart by whether `subject` is None. Both are handed
    back for REPORTING rather than dropped.

    The cascade as a browser resolves it, within one media scope and
    over the rules whose context the page satisfies: specificity first,
    source position only to break a tie. See selector_weight() for why
    the second half alone is not enough.

    Media conditions are kept as part of the key rather than resolved
    against a width, because there is no viewport here. Two pages have
    to agree at every breakpoint the file declares, which is a stricter
    claim than agreeing at one, and it is the claim #178 wants.
    """
    resolved = {}
    unreadable = []
    ordered = []
    for index, (media, context, subject, compound,
                declared) in enumerate(blocks):
        if subject is None:
            unreadable.append((context, None, compound))
            continue
        applies = context_applies(context, classes)
        if applies is None:
            unreadable.append((context, subject, compound))
            continue
        if not applies:
            continue
        ordered.append((selector_weight(context, compound), index,
                        media, subject, declared))

    for _, _, media, subject, declared in sorted(ordered,
                                                 key=lambda row: row[:2]):
        for name, value in declared:
            resolved[(media, subject, name)] = value
    return resolved, unreadable


def card_pages():
    """The signed-in pages that wear the card grammar, sorted."""
    return sorted(name for name, shell in SHELLS.items()
                  if shell == "rail" and SURFACES.get(name) == "member")


def section_pages():
    """The signed-in pages that wear the section grammar, sorted."""
    return sorted(name for name, shell in SHELLS.items()
                  if shell == "rail" and SURFACES.get(name) == "instrument")


def geometry_agreement_problems(css, pages):
    """[(subject, problem)] where one page's cards have moved alone.

    `pages` is {page: markup}, so the body classes come from the page
    rather than from a table: which surface a page declares is check
    18's to pin, and reading it here rather than restating it is what
    keeps one fact in one place.

    WHAT THIS ARM CANNOT SAY, and it has to be said out loud because
    the arm reads as though it compared everything: it can only find a
    difference the card pages' BODY CLASSES can express. Today they
    carry the same ones, so every scope either reaches both pages or
    neither, and no stylesheet edit can make these two resolutions
    diverge at all. The roster below is the teeth in that arrangement -
    which is why both of #154's blocks-cutover findings against this
    check were about what the roster could see, and why a gap here is
    not covered by "the other arm would catch it".
    """
    problems = []
    blocks = geometry_declarations(css)
    wearers = [name for name in card_pages() if name in pages]

    if len(wearers) < 2:
        return [(STYLESHEET,
                 "has fewer than two pages wearing the card grammar, so "
                 "there is nothing to compare and this arm reported "
                 "agreement it never established. SHELLS and SURFACES in "
                 "tools/check_web.py are what say which pages those are")]

    resolutions = {}
    # Reported once rather than once per wearer: what a reader cannot
    # read does not depend on which page it was being read against, and
    # the same sentence twice reads as two defects.
    reported = set()
    for name in wearers:
        resolved, unreadable = resolved_geometry(blocks,
                                                 body_classes(pages[name]))
        resolutions[name] = resolved
        for entry in unreadable:
            if entry in reported:
                continue
            reported.add(entry)
            context, subject, compound = entry
            if subject is None:
                problems.append((
                    STYLESHEET,
                    "paints a card component with \"%s\", which this check "
                    "cannot score. It reads a compound of type and class "
                    "selectors and nothing else, so a component behind a "
                    "pseudo-class, an attribute or an id - or two components "
                    "at once - is reported rather than passed over. A rule "
                    "the browser applies and this arm drops is exactly how a "
                    "shape came apart unnoticed (#178)" % compound))
                continue
            problems.append((
                STYLESHEET,
                "paints %s under \"%s\", which this check cannot resolve "
                "against a page. It reads a bare rule and a body-qualified "
                "one and nothing else, so a scope in any other shape is "
                "reported rather than passed over - an arm that drops what "
                "it does not understand prints OK for a page it never "
                "checked" % (subject, context)))

    reference = wearers[0]
    for name in wearers[1:]:
        keys = set(resolutions[reference]) | set(resolutions[name])
        for key in sorted(keys):
            media, subject, prop = key
            here = resolutions[name].get(key)
            there = resolutions[reference].get(key)
            if here == there:
                continue
            problems.append((
                STYLESHEET,
                "gives %s a different %s on %s (%s) than on %s (%s)%s. Both "
                "are signed-in member pages and #178 is the owner asking "
                "that they read as one thing - a card that changes shape "
                "from one page to the next is the drift this arm exists to "
                "catch"
                % (subject, prop, name, here or "unset", reference,
                   there or "unset",
                   " inside @media %s" % media if media else "")))

    return problems


def card_scope_problems(css):
    """[(subject, problem)] for surface overrides nobody wrote down.

    Three refusals, not one. A scope no entry names is the override
    nobody declared; an entry with no block behind it is a pin that can
    no longer fail; and a rostered scope whose DECLARATIONS have moved
    is the one the first two miss - #154's partition-3 finding, where
    the instrument's card padding could become 7px with every arm
    quiet, because the roster only ever answered whether the scope
    existed.

    Blocks are merged per scope before any of that, in source order, so
    a surface written across two rules is one entry here rather than
    two reports of the same thing.
    """
    problems = []
    declared = {}

    for media, context, subject, _, pairs in geometry_declarations(css):
        if subject is None or not context:
            continue
        block = declared.setdefault((context, subject), {})
        for name, value in pairs:
            block[(media, name)] = value

    for key in sorted(declared):
        context, subject = key
        found = declared[key]
        conditions = "".join(
            " inside @media %s" % media
            for media in sorted({media for media, _ in found if media}))

        if key not in CARD_SCOPES:
            problems.append((
                STYLESHEET,
                "paints %s under \"%s\"%s, and CARD_SCOPES in "
                "tools/check_web.py does not name it. A rule that shapes a "
                "card on one surface and not another is how the pages came "
                "apart in the first place (#178): say there which surface it "
                "is for and why, or take the scope off and move the design "
                "everywhere at once" % (subject, context, conditions)))
            continue

        pinned = CARD_SCOPES[key]["declares"]
        for media, name in sorted(set(pinned) | set(found)):
            here = found.get((media, name))
            there = pinned.get((media, name))
            if here == there:
                continue
            problems.append((
                STYLESHEET,
                "gives %s a %s of %s under \"%s\"%s, and CARD_SCOPES in "
                "tools/check_web.py pins %s. A roster that says only THAT a "
                "scope exists cannot see the scope itself move: edit the "
                "entry in the same change as the rule - the same two-place "
                "act as raising a ceiling in tools/check_budget.py - or say "
                "in that change why the surface needs this one"
                % (subject, name, here or "nothing", context,
                   " inside @media %s" % media if media else "",
                   there or "nothing")))

    for context, subject in sorted(set(CARD_SCOPES) - set(declared)):
        problems.append((
            STYLESHEET,
            "declares no geometry for %s under \"%s\", and CARD_SCOPES in "
            "tools/check_web.py still names it. Delete the entry, or restore "
            "the rule - a pin with no block behind it is a check that cannot "
            "fail" % (subject, context)))

    return problems


CONTAINER_TAGS = frozenset({
    "article", "aside", "div", "fieldset", "footer", "form", "header",
    "main", "nav", "section",
})

ELEMENT = re.compile(r"<(/?)([a-zA-Z][\w-]*)((?:[^>\"']|\"[^\"]*\"|'[^']*')*)>")

MAIN_SLICE = re.compile(r"<main\b.*?</main\s*>", re.S | re.I)


def main_labels(text):
    """[(role, words, parent, parent_classes)] and [(index, classes)].

    Returns the labels inside <main> paired with the container each one
    stands in, and every container that was opened - which together are
    the whole of what "a section name inside a box" and "a box with no
    warning in it" need to be answerable at all.

    Only <main> is read. The rail carries a `Session` runner on every
    signed-in page and is not a section of the document, so a rule
    written over the whole page would have to carve it out by name -
    and a carve-out is the thing that stops applying the day the rail
    grows a second one.

    The scanner tracks containers rather than every element because
    that is what the rules below are about, and because a general HTML
    reader is a liability in a file whose job is to refuse: <p> cannot
    nest, <input> and <br> never close, and a stack that tried to model
    both would go wrong silently on markup a browser renders fine.
    """
    slice_ = MAIN_SLICE.search(text)
    if not slice_:
        return [], []

    inside = slice_.group(0)
    labels = []
    containers = []
    stack = []

    for element in ELEMENT.finditer(inside):
        closing = bool(element.group(1))
        tag = element.group(2).lower()
        attributes = element.group(3)

        if tag == "p" and not closing:
            found = LABEL_MARKUP.match(inside, element.start())
            if found:
                classes, body = found.group(1), found.group(2)
                parent = stack[-1] if stack else None
                for role in [r for r in classes.split() if r in LABEL_ROLES]:
                    labels.append((
                        role, label_text(body), parent,
                        containers[parent][1] if parent is not None
                        else frozenset()))
            continue

        if tag not in CONTAINER_TAGS:
            continue
        if closing:
            if stack:
                stack.pop()
            continue
        if attributes.rstrip().endswith("/"):
            continue  # self-closed, so it opens nothing
        index = len(containers)
        containers.append((index, frozenset(
            " ".join(re.findall(CLASS_ATTR, attributes)).split())))
        stack.append(index)

    return labels, containers


def grammar_markup_problems(text, grammar):
    """[problem] for one page's <main> wearing the wrong grammar.

    Takes markup and the grammar the page is pinned to rather than a
    filename, for the reason plain_page_problems() gives: a rule
    exercised only against the pages that ship today is a rule tested
    against today's markup, and the shape of the failure is what has to
    hold.
    """
    problems = []
    labels, containers = main_labels(text)

    if grammar == "cards":
        for _, classes in containers:
            if "tool" in classes:
                problems.append(
                    "carries a .tool section inside <main>, and this is a "
                    "card page. The instrument's grammar arriving here is "
                    "#178's drift pointing outward, and it arrives the way "
                    "every copy does - from whichever page was open")
            # `.narrow` is declared only under `body.wide`, and a card
            # page is not wide. So it paints nothing here while saying,
            # in the markup, that this box is narrower than the ones
            # beside it - and four of them said it. That is #178's
            # disease one layer up from the stylesheet: boxes written
            # differently and rendered identically, until the day the
            # page becomes wide and the difference is suddenly real.
            if "narrow" in classes:
                problems.append(
                    "carries .narrow inside <main>, and .narrow only means "
                    "something on a `wide` page. A card page IS the reading "
                    "measure, so this says a box is narrower than its "
                    "neighbours and then paints it the same - take the class "
                    "off rather than leaving the next reader to copy it")
        return problems

    boxed = {index for index, classes in containers if "card" in classes}
    warned = set()
    for role, words, parent, _ in labels:
        if parent is None or parent not in boxed:
            continue
        if role == "runner":
            problems.append(
                "puts the section name \"%s\" inside a box. On this surface "
                "boxes are for warnings only - the owner's ruling on #178 - "
                "so a tool is a runner-headed .tool section and never a "
                "card" % words)
        else:
            warned.add(parent)

    for _ in sorted(boxed - warned):
        problems.append(
            "carries a box inside <main> with no outcome and no caution in "
            "it. On this surface a box IS the warning (#178), so one that "
            "says nothing to act on is a tool that kept its card")

    tools = {index for index, classes in containers if "tool" in classes}
    headed = {parent for role, _, parent, _ in labels if role == "runner"}
    for _ in sorted(tools - headed):
        problems.append(
            "carries a .tool section with no runner standing on it. The "
            "runner's rule IS the section divider here, so a section "
            "without one is a block of controls with nothing saying where "
            "one tool ends and the next begins")

    for role, words, parent, classes in labels:
        if role != "runner" or parent is None:
            continue
        if "tool" not in classes:
            problems.append(
                "stands the section name \"%s\" on something that is not a "
                ".tool. Every section on this surface is the same width by "
                "construction because .tool is what gives it that width - a "
                "runner outside one is a section that will not line up "
                "with the ones above it" % words)

    return problems


def grammar_problems():
    """(subject, problem) for the signed-in pages' shared card grammar."""
    problems = []
    pages = {name: page_text(name) for name in html_pages()}

    for name in card_pages():
        if name in pages:
            for problem in grammar_markup_problems(pages[name], "cards"):
                problems.append((name, problem))

    for name in section_pages():
        if name in pages:
            for problem in grammar_markup_problems(pages[name], "sections"):
                problems.append((name, problem))

    css = stylesheet_text()
    if css is not None:
        problems.extend(geometry_agreement_problems(css, pages))
        problems.extend(card_scope_problems(css))

    return problems


# ------------------------------------------------------------------
# Check 26: the two styling routes checks 24 and 25 leave open.
#
# #154's sweep, P2 F3 and P3 mutation J. Checks 24 and 25 read ONE
# stylesheet and speak for the whole site's appearance, and the only
# thing that makes that true is that no page may be painted from
# anywhere else. That is a CSP property, not a property of theme.css,
# and it was written down nowhere.
#
# Check 13 does not cover it and cannot: it reconciles each page's
# shipped policy against its pin and has no opinion about what the two
# agree on. A page and its pin widened in the same edit - 'unsafe-inline'
# for one convenient rule, a CDN for one webfont - passes check 13, and
# every design arm above goes on comparing a stylesheet that is no
# longer the only thing painting the site.
#
# So this arm reads the pin TABLE, which is the one thing check 13 takes
# as given. Widening style-src stays possible; it stops being quiet.

# The only style-src any page may carry. Written out rather than read
# off CSP_BASELINE, for the review bar's reason: a rule that asks the
# table what the table says cannot notice the table moving.
STYLE_SOURCE = ["'self'"]

LINK_ELEMENT = re.compile(r"<link\b[^>]*>", re.I)


def page_stylesheets(text):
    """[href] for every stylesheet <link> in one page's markup, in order.

    Read by the rel token rather than by the file's extension: an
    alternate stylesheet is a stylesheet a member can switch to, and a
    preload or an icon that happens to name a .css file paints nothing.
    """
    found = []
    for tag in LINK_ELEMENT.findall(text):
        relation = (tag_attribute(tag, "rel") or "").lower().split()
        if "stylesheet" in relation:
            found.append((tag_attribute(tag, "href") or "").strip())
    return found


def pinned_style_problems(expected=None):
    """[(page, problem)] where the CSP pin stops confining styling.

    Over the table rather than over the pages, and parameterized so the
    suite can drive a widened pin without editing the shipped one.
    """
    expected = EXPECTED_CSP if expected is None else expected
    problems = []
    for name in sorted(expected):
        sources = expected[name].get("style-src")
        if sources == STYLE_SOURCE:
            continue
        if sources is None:
            problems.append((name, (
                "pins no style-src at all, so default-src decides how it "
                "may be painted and this table says nothing about the "
                "directive the design gate stands on. Check 24 rules the "
                "tokens in %s and check 25 reads the card geometry out of "
                "the same file; pin style-src %s"
                % (STYLESHEET, " ".join(STYLE_SOURCE)))))
            continue
        problems.append((name, (
            "is pinned with style-src \"%s\" rather than \"%s\". Check 24 "
            "rules the design tokens in %s and check 25 reads the card "
            "geometry out of that same file, and both speak for the site's "
            "whole appearance only while nothing else may paint it. A "
            "widened style-src takes their teeth out and every arm here "
            "stays green doing it - so widening it is this line, in the "
            "change that argues for it"
            % (" ".join(sources), " ".join(STYLE_SOURCE), STYLESHEET))))
    return problems


def page_stylesheet_problems(text):
    """[problem] for a page styled by anything but the one stylesheet.

    A page linking no stylesheet at all is check 3's to report - it is
    the shared head that is missing - and saying it twice is how one of
    the two gets weakened.
    """
    problems = []
    written = page_stylesheets(text)
    linked = [href.split("?", 1)[0].split("#", 1)[0] for href in written]

    for index, target in enumerate(linked):
        if target == STYLESHEET:
            continue
        if not target:
            problems.append(
                "carries a stylesheet <link> with no href. A link this "
                "reader cannot resolve is reported rather than skipped: "
                "silence and a clean page print the same word")
            continue
        problems.append(
            "links the stylesheet %s, and %s is the one this site has. "
            "Check 24 pins the tokens in that file and check 25 reads the "
            "card geometry out of it, so a second sheet paints past both "
            "of them - and the CSP permits it, because a second file on "
            "this origin is exactly what style-src 'self' allows"
            % (written[index], STYLESHEET))

    if linked.count(STYLESHEET) > 1:
        problems.append(
            "links %s %d times. The duplicate paints nothing today, and it "
            "is a second place to re-point tomorrow - the one nobody "
            "re-reads" % (STYLESHEET, linked.count(STYLESHEET)))

    return problems


# An import is the same route as a second <link>, spelled inside the
# file rather than beside it. Read off the stylesheet with its comments
# already stripped, because this file argues about what it refuses at
# length and in prose.
STYLE_IMPORT = re.compile(r"@import\b[^;]*;?", re.I)


def stylesheet_import_problems(css):
    """[problem] for a stylesheet pulling a second one in behind it."""
    return [
        "carries %s. An import is the same styling route as a second "
        "<link> and the quieter one: it is same-origin, so style-src "
        "'self' permits it, and it is inside the file check 24 and check "
        "25 open rather than beside it - so every page's link roster "
        "stays right while rules paint from a file nothing here reads"
        % " ".join(found.group(0).split())
        for found in STYLE_IMPORT.finditer(css)
    ]


# Every animation this stylesheet could run, named where a reader will
# look for it. Refused rather than merely absent, the way RETIRED_IDS
# and PICKER_DETAILS are.
#
# #273 removed the entrance animation and retired the reduced-motion row
# from the live-verification ledger on the grounds that "there are no
# keyframes and no animated element left on the page, so there is
# nothing for the setting to reduce." That grounded a PERMANENT ledger
# retirement on a property nothing enforced: every mention of @keyframes
# in tools/ and dev/ is a parser explicitly SKIPPING the block, so an
# entrance animation could come back with the gate green, the row that
# would have demanded a reduced-motion sitting gone, and nothing to
# re-add it. This is the half of that pair a file can hold.
#
# What it does NOT hold: a transition, which animates without a keyframe
# and which the blanket @media (prefers-reduced-motion) block below is
# already written to cover. The retired row was about an ENTRANCE - an
# element arriving under its own steam - and that is what needs a
# keyframe.
KEYFRAMES = re.compile(r"@(?:-\w+-)?keyframes\b", re.I)


def keyframes_problems(css):
    """[problem] for a stylesheet that declares an animation."""
    return [
        "declares %s. The entrance animation went out with the cover "
        "(#273), and the live-verification ledger's reduced-motion row "
        "went with it because there was nothing left for the setting to "
        "reduce. An animation arriving now would restore the hazard with "
        "the row that asked somebody to sit with it already retired - so "
        "a keyframe is refused here, and re-adding one is the change "
        "that puts that ledger row back" % found.group(0)
        for found in [KEYFRAMES.search(css)] if found
    ]


def styling_exclusivity_problems():
    """[(subject, problem)] for styling that reaches past the design gate."""
    problems = list(pinned_style_problems())
    for name in html_pages():
        for problem in page_stylesheet_problems(page_text(name)):
            problems.append((name, problem))

    css = stylesheet_text()
    if css is not None:
        for problem in stylesheet_import_problems(css):
            problems.append((STYLESHEET, problem))
        for problem in keyframes_problems(css):
            problems.append((STYLESHEET, problem))

    return sorted(problems)


# ------------------------------------------------------------------
# Check 27: the owner's register bar (#275, ruled on #265).
#
# The bar is nine rules and only two of them can be read off a file.
# "One clause per message" and "no voice survivors" are judgements a
# person makes; what a check can hold is the handful of lines the owner
# dictated WORD FOR WORD, and the mechanism the ruling names for
# everything those lines stopped saying.
#
# Both halves are here because either alone fails open. A ruled sentence
# with nowhere for its old explanation to go comes back lengthened by
# the next person who misses the missing fact; a disclosure with no
# ruled sentence in front of it is a page that hid its prose and changed
# nothing. The pair is the ruling.
#
# READ AS THE WHOLE OF WHAT THE ELEMENT RENDERS, never as a substring.
# "Signed out." is inside "Signed out. This browser now holds nothing of
# yours." - the exact sentence the ruling removed - so a containment
# test passes on the text it was written to refuse. That is the shape of
# this arm's only real failure mode, and it is why the comparison is
# equality against the element's own text.

# The lines the owner ruled, keyed by the page and the id of the element
# that renders each one.
#
# `{}` stands for an element the page fills at runtime: the count in the
# sealed-rows line is written by submit.js, so the pin is over the
# sentence around it rather than over a number no file holds. Every
# other slot in these pages is a whole element too, so the marker needs
# no escape.
#
# "privacy-line" is not ruled copy - it is the 0.9-M4 placeholder,
# pinned by owner ruling on #355 (2026-08-19). The pin does not claim
# the bracketed filler is governed prose; it claims the SLOT's contents
# are governed, so a swap-in - the real sentence at M4, or anything
# else, at any time - has to touch this line in the same change rather
# than drift past the gate unnoticed. At M4 the pin and the sentence
# move together.
RULED_LINES = {
    "index.html": {
        "signed-out": "Signed out.",
        "privacy-line": "[Privacy line — the owner writes this "
                         "sentence at the 0.9-M4 register sitting.]",
    },
    # your-page.html's OLD two ruled lines here - the sealed-rows count
    # and "Compare with the group's pinned code before submitting" -
    # retired with the client seal they were both about (0.9-M2-S2,
    # #353): DESIGN.md, "Trust model: the Worker reads" ends the
    # browser-side decrypt those sentences described and the public-key
    # comparison they asked a member to perform.
    #
    # "pre-leave-notice" is not ruled copy either - it is the 0.9-M4
    # placeholder for the pre-leave notice (#294 F3), pinned by the same
    # owner ruling that pins the door page's own equivalent slot (#355
    # comment 5337476261, carried into this page by the #353 fix-wave
    # review, finding F7). The pin does not claim the bracketed filler is
    # governed prose; it claims the SLOT's contents are governed, so a
    # swap-in - the real sentence at M4, or anything else, at any time -
    # has to touch this line in the same change rather than drift past
    # the gate unnoticed. At M4 the pin and the sentence move together.
    "your-page.html": {
        "pre-leave-notice": "[Pre-leave notice — the owner writes this "
                             "sentence at the 0.9-M4 register sitting.]",
    },
    "charts.html": {
        "charts-intro":
            "Counts and averages — no names, no individual entries.",
    },
}

# The disclosure the whys moved behind, and the three things about it
# that are not a matter of taste.
#
# The class is what theme.css lays out; the word is what a member reads
# and is the same word on every card, because a disclosure that is
# called something different on each page is four controls rather than
# one. And it ships CLOSED: `open` in the markup is the prose back on
# the page with a control drawn around it, which is the whole of what
# this ruling removed.
MORE_CLASS = "more"
MORE_SUMMARY = "More"

# The one summary this ruling now names a second word for (0.9-M2-S13,
# #378, the 2026-08-19 charts sitting round two): the footer's own
# custom-palette editor, whose "More" is rethemed and relabeled as the
# single obvious "Custom theme" control (design mandate 4) - the same
# element THEME_EDITOR_DETAILS finds and footer_problems() requires one
# of per themed page, so this is not a second disclosure earning a
# second word, it is the one every themed page already carries reading
# differently now. Every OTHER <summary> on the site still owes
# MORE_SUMMARY exactly - this name is reserved for that one control and
# refused anywhere else, the same way RETIRED_LABEL is refused outside
# its own retirement.
THEME_PICKER_SUMMARY = "Custom theme"

# The product pages the ruling names. admin.html is one of them - the
# instrument's allowance under rule 7 is ONE short explanatory sentence
# per card, not a page-wide exemption from the mechanism.
MORE_PAGES = frozenset({"admin.html", "charts.html", "your-page.html"})

DETAILS_OPEN = re.compile(r"<details\b([^>]*)>", re.I)

# An element the page fills at runtime, matched as a tag pair with
# nothing between it. Backreferenced to its own tag name so that a pair
# of different elements cannot be read as one empty one.
EMPTY_ELEMENT = re.compile(r"<(\w+)\b[^>]*>\s*</\1\s*>")

ENTITIES = (("&mdash;", "—"), ("&hellip;", "…"),
            ("&lt;", "<"), ("&gt;", ">"), ("&amp;", "&"))


def paragraph_by_id(text, element_id):
    """The inner markup of the <p> carrying `element_id`, or None.

    Restricted to <p> for the reason LABEL_MARKUP gives: <p> cannot
    nest, so a non-greedy match to the next </p> cannot swallow a
    paragraph standing inside something else. Every ruled line is one
    paragraph, and a ruling that lands somewhere else should have to
    say so here rather than arrive through a reader that was general
    enough not to notice.
    """
    found = re.search(
        r'<p\b[^>]*\bid\s*=\s*["\']%s["\'][^>]*>(.*?)</p\s*>'
        % re.escape(element_id), text, re.S | re.I)
    return None if found is None else found.group(1)


def rendered_text(markup):
    """What one element's markup puts on screen, spacing collapsed."""
    text = EMPTY_ELEMENT.sub("{}", markup)
    text = TAG.sub("", text)
    for entity, character in ENTITIES:
        text = text.replace(entity, character)
    return " ".join(text.split())


def ruled_line_problems(text, page):
    """[problem] for one page's ruled lines against what it renders."""
    problems = []
    for element_id, ruled in sorted(RULED_LINES.get(page, {}).items()):
        markup = paragraph_by_id(text, element_id)
        if markup is None:
            problems.append(
                "carries no <p id=\"%s\">, which is where the owner's ruled "
                "line \"%s\" renders. RULED_LINES in tools/check_web.py is "
                "the record of the ruling (#275); an id renamed out from "
                "under it takes the sentence with it" % (element_id, ruled))
            continue
        shown = rendered_text(markup)
        if shown != ruled:
            problems.append(
                "renders \"%s\" where the owner ruled \"%s\" (#275). The "
                "comparison is the WHOLE of what that element shows, "
                "because every sentence the ruling removed had the ruled "
                "one inside it" % (shown, ruled))
    return problems


def more_disclosure_problems(text, page):
    """[problem] for one page's More disclosures against the ruled shape."""
    problems = []
    opens = DETAILS_OPEN.findall(text)
    summaries = [label_text(words) for words in SUMMARY.findall(text)]

    for attributes in opens:
        classes = (tag_attribute("<details%s>" % attributes, "class")
                   or "").split()
        if MORE_CLASS not in classes:
            problems.append(
                "carries a <details> that is not a .%s. One disclosure "
                "shape on every product card is what makes the reveal read "
                "as the same control twice - a second shape is a second "
                "control the stylesheet does not lay out" % MORE_CLASS)
        if re.search(r"\bopen\b", attributes, re.I):
            problems.append(
                "ships a <details> with `open` on it. A disclosure that is "
                "already open is the prose back on the page with a control "
                "drawn around it, which is what #275 moved behind it")

    for words in summaries:
        if words != MORE_SUMMARY and words != THEME_PICKER_SUMMARY:
            problems.append(
                "labels a disclosure \"%s\". The word is \"%s\" on every "
                "page - MORE_SUMMARY in tools/check_web.py - because a "
                "reveal named differently on each card is four controls "
                "rather than one, with the one reserved exception "
                "THEME_PICKER_SUMMARY (\"%s\") names for the footer's own "
                "custom-palette editor" %
                (words, MORE_SUMMARY, THEME_PICKER_SUMMARY))

    # THEME_PICKER_SUMMARY reads as a page-wide word here - a themed
    # page's footer editor is welcome to carry it and no other page is,
    # but which specific <details> owes it is footer_problems()'s own
    # question, not this one's: that arm already isolates the editor's
    # exact span (element_span() on THEME_EDITOR_DETAILS), so IT checks
    # the editor's own <summary> word directly rather than this function
    # inferring identity from a page-wide count - a page-wide count
    # cannot tell "the editor itself was renamed" from "some unrelated
    # card borrowed the word" apart, and a check that cannot tell two
    # failures apart is answering a different question than the one
    # asked of it.
    if page not in THEMED_PAGES and THEME_PICKER_SUMMARY in summaries:
        problems.append(
            "carries a disclosure labeled \"%s\" and is not pinned in "
            "THEMED_PAGES in tools/check_web.py. That word is reserved "
            "for the footer's custom-palette editor, which only a themed "
            "page carries" % THEME_PICKER_SUMMARY)

    if page in MORE_PAGES and not opens:
        problems.append(
            "is a product page with no <details class=\"%s\"> on it. #275 "
            "ruled the whys behind a native disclosure; a page that "
            "carries none either kept its explanations in front of the "
            "reader or deleted facts the ruling only asked it to move"
            % MORE_CLASS)

    if len(opens) != len(summaries):
        problems.append(
            "carries %d <details> and %d <summary>. A disclosure with no "
            "summary opens through the browser's own default word, which "
            "is not the ruled one and is not the same word twice"
            % (len(opens), len(summaries)))

    return problems


# The whole of what a rule reaching the More disclosure may declare.
#
# Check 27 above enforces three MARKUP facts - the class, the word, and
# the absence of `open` - and it cannot see the stylesheet. Two lines of
# CSS put every card's prose back on the page with `open` still false
# and the marker still reading "More":
#
#     details.more::details-content { content-visibility: visible;
#                                     block-size: auto; }
#
# Confirmed by mutation, in a browser, on the built dist: the ruling's
# central mechanic undone across all nine cards with nothing red.
#
# An ALLOWLIST rather than a list of dangerous properties, for the
# reason AGENTS.md's corollary gives: a blocklist is a guess about which
# lever the next person reaches for, and this one has to hold against
# levers nobody has thought of. What the shipped rules needed was
# typography and one margin until 0.9-M2-S13 (#378): the footer's own
# summary is rethemed as a button now (design mandate 4), which is
# chrome, not typography - background, border, border-color,
# border-radius and padding joined the same day, all read straight off
# the swatch buttons' own declarations a few hundred lines up rather
# than invented fresh. Still refuses what it always refused:
# REVEAL_PROPERTIES below is the one thing no addition here ever
# widens, because nothing on this site has another use for either of
# them.
MORE_STYLE_PROPERTIES = frozenset({
    "color", "cursor", "font-size", "margin-block-start",
    "background", "border", "border-color", "border-radius", "padding",
})

# The selector shapes that reach a More disclosure or its contents. The
# type selector is in it as well as the class: `details > :not(summary)`
# reaches every card on the site without ever saying "more".
MORE_SELECTOR = re.compile(r"\.more\b|\bdetails\b|::details-content", re.I)

# Two properties refused WHATEVER selector carries them, because both
# exist to decide whether a box that is not being displayed paints
# anyway, and this site has no other use for either. This is the reach
# the allowlist above does not have: a rule that names neither the class
# nor the element still cannot turn a closed disclosure on.
REVEAL_PROPERTIES = ("content-visibility", "::details-content")


def more_style_problems(css):
    """[problem] for stylesheet rules that could open a closed disclosure.

    WHAT THIS CANNOT CATCH, stated rather than implied. A rule reaching
    the moved prose through a selector naming neither `.more`, `details`
    nor `::details-content` - a class on the paragraph itself - is
    outside both arms unless it uses one of the two refused properties.
    So is anything a script does, and so is the browser's own behavior.
    Those need a check that reads what RENDERS with the disclosure shut,
    which needs a layout engine; #75 rejected jsdom for exactly that and
    the rendered half is post-cutover work. This arm is the strongest
    one a reader of text can be.
    """
    problems = []

    for name in REVEAL_PROPERTIES:
        if name in css:
            problems.append(
                "uses %s. It decides whether the contents of a closed "
                "<details> are laid out and painted anyway, and #275 put "
                "the whys behind a disclosure that ships CLOSED. Nothing "
                "on this site has another use for it, so it is refused "
                "here whatever selector carries it - which is the reach "
                "the allowlist below does not have" % name)

    for rule in CSS_RULE.finditer(css):
        selectors = [" ".join(part.split())
                     for part in rule.group(1).split(",")]
        reaching = [part for part in selectors if MORE_SELECTOR.search(part)]
        if not reaching:
            continue
        for name, _ in DECLARATION.findall(rule.group(2)):
            if name.lower() not in MORE_STYLE_PROPERTIES:
                problems.append(
                    "declares %s on %s. MORE_STYLE_PROPERTIES in "
                    "tools/check_web.py is the whole of what a rule "
                    "reaching the More disclosure may set - an allowlist, "
                    "because check 27's markup arms cannot see the "
                    "stylesheet and two declarations put every card's "
                    "prose back on the page with `open` still absent"
                    % (name.lower(), ", ".join(reaching)))

    return problems


# What each page's masthead renders, whole.
#
# Check 27 pins the ruled lines as the whole of what their ELEMENT
# shows, which closes the substring hole and leaves the sibling hole
# open: the pinned <p id="charts-intro"> untouched, and the sentence the
# ruling vetoed under rule 4 added as the next paragraph in the same
# <header>. Both on screen, whole gate green - AGENTS.md's corollary
# exactly, a check computed entirely from the element it guards cannot
# see that a sentence was added beside it.
#
# The header is the region because it is where the ruled line on
# charts.html lives, it is bounded, and rule 8 says the names in it are
# identifiers rather than prose - so pinning it whole costs nothing that
# is supposed to move and refuses everything that is not.
PAGE_HEADERS = {
    "404.html": "Not found The link may be old, or the address mistyped.",
    "admin.html":
        "Admin Decrypts the submissions in this browser — nothing is "
        "uploaded.",
    "charts.html":
        "Members Charts Counts and averages — no names, no "
        "individual entries.",
    "index.html":
        "Members Sign in Sign in once for this tab — then it is your page "
        "to fill in, and everyone's numbers to read.",
    "your-page.html":
        "Members Your page Fill the form and you are in the binder — your "
        "sign-in lasts as long as this tab.",
}

PAGE_HEADER = re.compile(r"<header\b[^>]*>(.*?)</header\s*>", re.S | re.I)


def region_text(markup):
    """What a region of several elements puts on screen, as words.

    rendered_text() one function up drops each tag and keeps what is
    around it, which is right for ONE element: the slot markers and the
    inline <strong> inside a ruled sentence have to close up. Over a
    region it is wrong - two block elements written with no whitespace
    between them run their last and first words together, so the pin
    would be a pin on how the file happens to be wrapped, and rewrapping
    a line would redden the gate on markup nobody changed.
    """
    text = EMPTY_ELEMENT.sub(" {} ", markup)
    text = TAG.sub(" ", text)
    for entity, character in ENTITIES:
        text = text.replace(entity, character)
    return " ".join(text.split())


def page_header_problems(text, page):
    """[problem] for one page's masthead against what PAGE_HEADERS pins."""
    ruled = PAGE_HEADERS.get(page)
    if ruled is None:
        return ["is published and is named in no PAGE_HEADERS entry in "
                "tools/check_web.py. The masthead is where the ruling's "
                "own header line lives; a page arriving with an unpinned "
                "one is a region nothing reads"]

    found = PAGE_HEADER.findall(text)
    if len(found) != 1:
        return ["carries %d <header> elements. This arm reads one, and a "
                "second masthead is a region nothing compares" % len(found)]

    shown = region_text(found[0])
    if shown != ruled:
        return ["renders \"%s\" in its <header> where PAGE_HEADERS in "
                "tools/check_web.py pins \"%s\". The REGION is pinned, not "
                "only the ruled line inside it: a check computed from the "
                "element it guards cannot see a sentence added beside it, "
                "and the vetoed flirt went back on charts.html that way "
                "with the whole gate green" % (shown, ruled)]

    return []


# Sentences the ruling took out, refused wherever they come back.
#
# The header pin above holds one region whole; this holds these exact
# words across the entire page, which is the reach a region pin does not
# have - the vetoed sign-out inventory returning beside #signed-out in
# <main> is the same defect one element lower down.
#
# A refusal list is a guess about which sentences return and is not
# claimed to be more: it catches the ones the ruling names, and the
# header pin is what catches a sentence nobody wrote down.
VETOED_LINES = (
    "This browser now holds nothing of yours.",
    "Getting heavier? Muse certainly hopes so.",
    "Worth checking before assuming they are damaged.",
)


def vetoed_line_problems(text):
    """[problem] for a page rendering a sentence the ruling removed."""
    # region_text() rather than rendered_text(), for the reason it gives:
    # over a whole page the one that drops tags without a space in their
    # place runs one element's last word into the next element's first,
    # and a refusal that reads a joined-up word finds nothing.
    shown = region_text(text)
    return [
        "renders \"%s\", which #275 removed. VETOED_LINES in "
        "tools/check_web.py refuses it wherever it comes back, because "
        "the arms that took it out read one element each and a vetoed "
        "sentence returns as the element NEXT to that one" % ruled
        for ruled in VETOED_LINES if ruled in shown
    ]


def register_problems():
    """[(page, problem)] for the pages against the owner's register bar."""
    problems = []
    for page in sorted(set(RULED_LINES) | MORE_PAGES | set(PAGE_HEADERS)):
        if page not in html_pages():
            problems.append((
                page,
                "is named in RULED_LINES, MORE_PAGES or PAGE_HEADERS in "
                "tools/check_web.py and is not a page in apps/web. Delete "
                "the entry, or restore the page it was written for - a pin "
                "with no page behind it is a check that cannot fail"))

    for page in html_pages():
        text = page_text(page)
        for problem in ruled_line_problems(text, page):
            problems.append((page, problem))
        for problem in more_disclosure_problems(text, page):
            problems.append((page, problem))
        for problem in page_header_problems(text, page):
            problems.append((page, problem))
        for problem in vetoed_line_problems(text):
            problems.append((page, problem))

    css = stylesheet_text()
    if css is not None:
        for problem in more_style_problems(css):
            problems.append((STYLESHEET, problem))

    return sorted(problems)


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

        # A deliberate `publicKey: null` on an arm outside KEYED_ARM_NAMES
        # is not "no publicKey is set" - it is 0.9's keyless design
        # (DESIGN.md, "Trust model: the Worker reads") declared on
        # purpose, and public_key_problem() has no way to tell that
        # apart from a forgotten key. config_environments() already
        # confirmed which one this is.
        if environment["publicKeyIsNull"] and \
                environment["name"] not in KEYED_ARM_NAMES:
            continue
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
        problems.append("%s." % problem)

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

    for problem in mockup_token_problems():
        problems.append("%s %s." % (STYLESHEET, problem))

    for subject, problem in chip_label_problems():
        problems.append("%s %s." % (subject, problem))

    for subject, problem in refused_surface_problems():
        problems.append("%s %s." % (subject, problem))

    for subject, problem in grammar_problems():
        problems.append("%s %s." % (subject, problem))

    for subject, problem in styling_exclusivity_problems():
        problems.append("%s %s." % (subject, problem))

    for page, problem in register_problems():
        problems.append("%s %s." % (page, problem))

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
