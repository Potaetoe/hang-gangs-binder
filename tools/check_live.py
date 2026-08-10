#!/usr/bin/env python3
"""
The ledger of what has, and has not, been exercised against a running
system - and the rules that stop it rotting.

    python tools/check_live.py            the gate stage
    python tools/check_live.py --report   the query, or `./run live`

#157 is the reason this exists. Thirty merged pull requests each
honestly wrote "live: not performed". Every one of those labels was
correct, and their sum was a systemic gap nobody owned: the whole
accounts design - sessions, membership, the supersede guard, the group
check - had been proven against a hand-written D1 stub and nothing
else. The mechanical cause is that a verification label lives in a pull
request body, which no gate can read, so "what has never been tried
against a running system" was an archaeology exercise across thirty
pull requests rather than a question with an answer.

AGENTS.md rule 2 is why the answer is here rather than in a document:
mutable state never goes in one. What has been exercised is mutable
state by definition, so a document holding it would be stale the week
it was written - which is the same failure one layer up.

**What makes this forced rather than voluntary.** LEDGER is not
checked against itself. Its completeness is asserted against the code:
every route in server/worker.js's dispatch block and every page in
apps/web/ must carry a row. A slice that adds a route and no row turns
the gate red, and the failure carries the row to paste. That is the
whole mechanism, and the reason it is narrow: a gate that fails for
something the failing slice cannot fix gets disabled, and a disabled
mechanism is worse than a small one.

**What it deliberately does not force.** Nothing here can make a slice
declare "my chart has never been painted" - no enumeration produces
that claim. Rows of surface `flow` are voluntary, and the ledger says
so rather than implying a coverage it does not have.

**The boundary that matters more than the size of the ledger.** Some
claims cannot be met before production: the Telegram widget is bound by
BotFather to the published origin, and the development Worker carries
no bot token, no admin ids and no group chat id, deliberately - see
server/wrangler.toml, which also says not to "fix" the asymmetry. Those
belong on a permanent first-contact list, not in a debt column that
implies they can be cleared. A permanent list is a dumping ground
unless each entry's reason can be falsified from OUTSIDE the ledger, so
every cause below is either pinned to text in server/worker.js or to
the two ALLOWED_ORIGINS blocks. The two causes nothing in this
repository can check - a secret is invisible here by design, and so is
a Telegram group - are held instead by a ratchet ceiling, the shape
check_comments.py already uses for its allowlist.

**Evidence is about one deployment.** Two Workers answer here, and a
run drove exactly one of them, so every run names its arm and the
report groups on it. Without that field a reader counts rows and reads
coverage: thirty-one rows earned against the development Worker say
nothing whatever about the production one, which is the deployment the
cutover is about. An arm carrying no evidence is printed as empty
rather than left out, because an omitted arm and an arm nobody
registered read identically.

**A stale row is owed again.** A performed claim is against bytes, and
bytes move; a row whose covered files have moved since its run stands
at a head this tree has gone past, which is the same standing as a row
nothing has ever exercised, and re-running the probe costs what running
it the first time cost. So the cadence counts the `never` rows and the
stale ones together. Counting the `never` rows alone is how five sixths
of this ledger aged out with the report answering that no batch was
due. `covers` is what that measurement reads, which is why a route row
must stand on server/worker.js and a page row on its own page, derived
from the id: a row free to name any path could name one that never
moves, and permanent freshness reads as the strongest evidence here
rather than as the absence of any.

**The cadence is measured, not enforced.** A stage that reddens on a
date, or on a merge count, would block work the failing slice cannot
unblock: the batch needs port 8124 (server/wrangler.toml pins the
development origins to it) and it needs secrets, so it is owner-only by
capability rather than by preference. `--report` states how far behind
the record is and what is due; the exit code stays with the structural
rules and never with the calendar. What holds the arithmetic to
something instead is dev/check_live.test.py, itself a registered gate
stage: a cadence that goes back to counting `never` rows alone turns
the gate red there.
"""

import os
import re
import subprocess
import sys

import check_server

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKER = os.path.join(REPO, "server", "worker.js")
WRANGLER = os.path.join(REPO, "server", "wrangler.toml")
WEB = os.path.join(REPO, "apps", "web")

STATUSES = ("never", "performed", "first-contact")

# `route` and `page` are the forced spine - both are enumerable from the
# tree, so a row cannot be silently missing. `flow` is everything else a
# sitting exercises; nothing can force one into existence, and calling
# that out is more useful than a spine that pretends to cover it.
SURFACES = ("route", "page", "flow")

# The deployments a run can have driven. Two Workers answer for this
# project - server/wrangler.toml's [env.dev] block and its bare one -
# and a sitting reaches exactly one of them. The arm is declared on the
# run rather than on the row so that it cannot be typed wrong per row,
# and the report groups on it: without the grouping, a count of
# performed rows is read as coverage of whichever deployment the reader
# had in mind.
ARMS = ("development", "production")

REQUIRED = ("id", "surface", "claim", "covers", "status")
OPTIONAL = ("performed", "cause", "guard")

# Why a claim cannot be met before production, and what says so from
# outside this file. `guard` means the row pins source text; `checked`
# means something in this repository can falsify the classification.
#
# An uncheckable cause is not a lesser one - it is the honest name for a
# claim that rests on a value no file here can see. Dressing it in a
# predicate that cannot fail would be worse than admitting it, so those
# two are bounded by the ceiling below instead.
CAUSES = {
    "guarded-branch": {
        "guard": True,
        "checked": True,
        "why": "the development arm takes a branch production will not, "
               "so it exercises the wrong side of a guard",
    },
    "published-origin-only": {
        "guard": False,
        "checked": True,
        "why": "it needs the published origin; BotFather binds the "
               "widget there and the development arm allows loopback "
               "only",
    },
    "production-secret": {
        "guard": False,
        "checked": False,
        "why": "it rests on a secret's value, and no file in this "
               "repository can see one",
    },
    "off-machine": {
        "guard": False,
        "checked": False,
        "why": "it needs a system that is not on this machine and that "
               "no shell here reaches",
    },
}

# A ratchet, not a budget. Every uncorroborated first-contact row is a
# claim taken on trust, so the count may only fall; raising this number
# is a line in a diff somebody reads, which is the whole point. Take one
# off the moment a row can be pinned or performed instead.
UNCORROBORATED_CEILING = 3

# The batch is due when the OWED count reaches this, or before any
# cutover, whichever comes first. Owed is the `never` rows plus the
# stale ones - see owed() for why a stale row counts, and the module
# docstring for what counting only the never rows cost.
#
# The number is chosen against two measured quantities rather than
# taste: #157's gap was thirty pull requests, and the dev-arm rehearsal
# measured a ninety-minute sitting that discharges about nineteen items.
# A threshold above that turns the batch into a project; well below it
# turns a cheap redeploy into ceremony. It did not move when staleness
# joined the count, and that is deliberate: the threshold is a number of
# ITEMS A SITTING CAN DISCHARGE, and re-running a probe whose evidence
# has aged costs the sitting what running it the first time cost.
CADENCE_THRESHOLD = 15

# The runs every performed row below stands on, oldest first. Each is a
# sitting against the deployed development Worker with the pages served
# from that head. The date and the head live here once rather than in
# every row, so a run is recorded in one place instead of being copied
# into as many rows as it discharges.
#
# There are two because they reached two different halves. REHEARSAL is
# what a session holding no secret can drive: the origin gate, the
# refusals, a forged token. SITTING is the owner at the keyboard with
# the development sign-in secret and the private key file, which is the
# only way to reach anything behind a session - server/wrangler.toml
# pins the development origins to port 8124 and the values are write-
# only once set, so this half is owner-only by capability.
#
# A row cites the run that produced it and is never re-dated to the
# newer one. Staleness is derived per row against that row's own head,
# so moving a row forward to the latest run would age its evidence
# backwards and hide exactly the movement the STALE mark exists to
# show.
#
# RUNS is read in the order written, and that order is the whole
# statement of chronology: both of these carry the same date, so
# nothing sorted on a date can tell them apart and max() would answer
# with whichever the ledger lists first. Two rules hold the declaration
# to something - a performed row must cite a run named here, and a run
# named here must be cited by a performed row - so a head cannot appear
# that the report has nowhere to put, and a run cannot outlive the last
# row standing on it while still dating the cadence line.
#
# The head is the tree the sitting drove, which is not the same as the
# build the deployed Worker was running - a Worker version is not
# knowable from this repository at all. That gap is one more reason a
# performed row ages into STALE rather than standing as a permanent
# pass, and the reason each `how` states what came back rather than only
# which step produced it: the step numbers belong to a rehearsal
# script, which is written to be thrown away once its steps become
# UAT.md's live arm, and evidence that dies with its pointer is evidence
# about nothing.
# PRODUCTION is the third and it is a different KIND of run: three
# read-only GETs from a delegated slice, no secret and no browser, which
# is the whole of what can be driven against the live deployment without
# a credential. It is small on purpose and it is the first evidence this
# ledger has ever carried about the Worker the cutover is about. Its
# head is the tree the probes were driven at, the same convention the
# two above follow, and it is not a claim that this Worker is running
# that build - see the paragraph above on why a version is unknowable
# from here.
REHEARSAL = {"date": "2026-08-09",
             "arm": "development",
             "sha": "eca87b48142f916ac4c8469f608e6ad945515840"}

SITTING = {"date": "2026-08-09",
           "arm": "development",
           "sha": "9e78ea9d11c883f10da563ed4b99eb7c3ba1e024"}

PRODUCTION = {"date": "2026-08-09",
              "arm": "production",
              "sha": "8f32002abb19cea6c1a1a9b213b9218f28abb706"}

RUNS = (REHEARSAL, SITTING, PRODUCTION)

# The ledger. `covers` names the files a row's evidence stands on, so a
# performed row goes stale when they move - see stale() for why that is
# derived at read time rather than stored.
#
# A route row's id is the route as the router spells it, optionally
# followed by ", <qualifier>" when one route wants more than one claim.
# A qualifier is how one surface carries two claims that a single status
# cannot describe: a route half exercised is two rows with one status
# each, never one row wearing a status that averages them.
LEDGER = [
    # ---- routes: the surface that is inert until something is
    # deployed. Between them the two runs reach every route a public
    # reader or a development session can drive. What stays debt is the
    # doors that answer only to the break-glass token, the ones that
    # destroy something and are deliberately hand-driven, and the
    # content routes - whose claims are written against what a run can
    # actually observe, because nothing in apps/web reads what they set.
    {
        "id": "OPTIONS *",
        "surface": "route",
        "claim": "the preflight answers 204 for an allowed origin and "
                 "403 for a foreign one, which every browser POST "
                 "below depends on",
        "covers": ["server/worker.js"],
        "status": "performed",
        "performed": dict(
            REHEARSAL,
            how="OPTIONS /submit answered 204 for http://127.0.0.1:8124 "
                "and 403 for a foreign origin, carrying "
                "Access-Control-Allow-Origin for the caller, Vary: "
                "Origin and Max-Age: 86400"),
    },
    {
        "id": "POST /auth/telegram",
        "surface": "route",
        "claim": "with no bot token configured the route answers a "
                 "clean 401 rather than throwing",
        "covers": ["server/worker.js"],
        "status": "performed",
        "performed": dict(
            REHEARSAL,
            how="the deployment was read as carrying three secrets and "
                "no TELEGRAM_BOT_TOKEN, and the route then answered 401 "
                '{"error":"That sign-in could not be verified."} to a '
                "plausible payload and to an empty one - a status, not "
                "a throw. The 401 alone cannot say which guard closed "
                "the path, because a wrong hash answers in the same "
                "bytes; the secret listing is what discriminates"),
    },
    {
        "id": "POST /auth/dev",
        "surface": "route",
        "claim": "a development sign-in mints a real session",
        "covers": ["server/worker.js"],
        "status": "performed",
        "performed": dict(
            SITTING,
            how="the route minted sessions against the deployed "
                "development Worker in both shapes the sitting needed, "
                "an admin subject and a member subject. Each was then "
                "spent on other routes rather than only inspected, "
                "which is the difference between a token being issued "
                "and a session existing"),
    },
    {
        "id": "POST /auth/dev, a wrong secret",
        "surface": "route",
        "claim": "the route answers 404 rather than 401, in the bytes a "
                 "route that does not exist would answer in",
        "covers": ["server/worker.js"],
        "status": "performed",
        "performed": dict(
            REHEARSAL,
            how='a wrong secret answered 404 {"error":"Not found."}, '
                "byte-identical to GET /nope - a control the sitting "
                "added, because 404 on its own does not show that the "
                "route declines to advertise itself"),
    },
    {
        "id": "DELETE /session",
        "surface": "route",
        "claim": "signing out ends the row server-side, not only the "
                 "local copy",
        "covers": ["server/worker.js"],
        "status": "performed",
        "performed": dict(
            SITTING,
            how="after Sign out the same token drew 401 from /me, "
                "/export and /membership. Three routes rather than "
                "one, because a page that has merely dropped its local "
                "copy looks identical from the reader's side; only a "
                "route that will not see the row again says the row is "
                "gone"),
    },
    {
        "id": "GET /me",
        "surface": "route",
        "claim": "the member panel reads its effective and superseded "
                 "counts back from stored rows",
        "covers": ["server/worker.js"],
        "status": "performed",
        "performed": dict(
            SITTING,
            how="your-page.html's account card painted from a live call - "
                "Entries stored, and no \"Your Telegram id\" line for a "
                "development session, which has none - and after a "
                "correction landed the count held instead of going one "
                "higher. The held count is the superseded half's "
                "evidence rather than a second reading: the figure is "
                "total minus superseded, so it is only right if both "
                "were counted off real rows. No page paints the "
                "superseded count itself, so that half was exercised "
                "through the number depending on it and not read "
                "directly"),
    },
    {
        "id": "GET /my-entries",
        "surface": "route",
        "claim": "a member's listing carries their own rows in id "
                 "order and nobody else's, with the sealed bytes as "
                 "stored. dev/worker.test.mjs reads the ORDER BY "
                 "column, its direction and the LIMIT off the "
                 "statement, so a Worker that drops, reverses or "
                 "unbounds either clause goes red there. The half that "
                 "stays live-only is D1 applying them: every sequence "
                 "the suite compares against is produced by a sort in "
                 "the suite, and the cap is a slice of rows the stub "
                 "already held rather than a database that stops "
                 "reading",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "GET /my-entries, after the session is revoked",
        "surface": "route",
        "claim": "a token captured before Sign out reads no sealed "
                 "bytes after it. The route carries a member's whole "
                 "encrypted history since #85, so revocation stopped "
                 "being about counts - and the stub cannot falsify "
                 "this half: it deletes a row from an array, which "
                 "proves the route re-resolves the caller every call "
                 "and proves nothing about D1 removing the row. "
                 "Capture the token first, sign out, replay it",
        "covers": ["server/worker.js", "apps/web/signout.js"],
        "status": "never",
    },
    {
        "id": "POST /submit",
        "surface": "route",
        "claim": "a sealed row reaches D1, and a correction supersedes "
                 "exactly one entry",
        "covers": ["server/worker.js"],
        "status": "performed",
        "performed": dict(
            SITTING,
            how="rows sealed in the browser reached the deployed "
                "database and came back openable under the "
                "deployment's key, while rows pushed in beside them "
                "carrying placeholder ciphertext did not - which is "
                "what tells a row that made the whole round trip from "
                "one that was seeded. A correction then stored 200 and "
                "replaced exactly one row: the member's count held "
                "rather than rising, a second correction of the same "
                "row drew 409 in the wording the page shows, and the "
                "fan-in query returned nothing before or after. The "
                "refusals answer identically where they must - a "
                "foreign entry, an absent one and a seeded one all 404 "
                "byte for byte, so the route is not a way to test "
                "which ids exist - and a malformed pointer draws 400 "
                "with no coercion of \"1\" to 1"),
    },
    {
        "id": "GET /export",
        "surface": "route",
        "claim": "the break-glass token opens the ciphertext export "
                 "with no browser and no private key",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "GET /export, an admin session in a browser",
        "surface": "route",
        "claim": "the whole ciphertext corpus reaches the keyholder's "
                 "browser, and a row the key cannot open is named "
                 "rather than dropped",
        "covers": ["server/worker.js", "apps/web/admin.js"],
        "status": "performed",
        "performed": dict(
            SITTING,
            how="admin.html fetched the export over an admin session "
                "and opened seven real rows; two rows seeded with "
                "placeholder ciphertext came back listed by id under "
                "the rows that would not open, rather than silently "
                "skipped - the ordinary cause of an unopenable row is "
                "a rotated key, and hiding those rows reads as data "
                "loss. The break-glass credential is the row above and "
                "was not driven, so this row carries the browser half "
                "only"),
    },
    {
        "id": "POST /snapshot",
        "surface": "route",
        "claim": "publishing writes a document carrying no handles and "
                 "no individual rows",
        "covers": ["server/worker.js"],
        "status": "performed",
        "performed": dict(
            SITTING,
            how="the document was read as raw bytes before it was "
                "sent, which is the only order in which this claim can "
                "be checked at all: counts, medians and bins, no "
                "handles, no individual rows and no ids, identified "
                "false, and the series labelled generically. The "
                "suppression floor was watched withholding whole "
                "breakdowns rather than publishing stubs - gender and "
                "country came back as empty lists - and a document "
                "that merely omits nothing could not have shown that"),
    },
    {
        "id": "GET /snapshot",
        "surface": "route",
        "claim": "a signed-in member reads the published document back, "
                 "which is the half a refusal cannot show: a route that "
                 "refuses everybody refuses a signed-out reader too",
        "covers": ["server/worker.js"],
        "status": "performed",
        "performed": dict(
            SITTING,
            how="a member session read the published document back on "
                "charts.html - the combined-weight hero, an entries "
                "and people line agreeing with what had been "
                "submitted, a freshness line and the distributions. "
                "The signed-out refusal below is what this pairs with: "
                "a Worker refusing everybody would have answered that "
                "one in exactly the same bytes"),
    },
    {
        "id": "GET /snapshot, a signed-out reader",
        "surface": "route",
        "claim": "a reader carrying no credential is refused by the "
                 "route rather than by the origin gate in front of it",
        "covers": ["server/worker.js"],
        "status": "performed",
        "performed": dict(
            REHEARSAL,
            how='401 {"error":"Not authorized."} from an allowed '
                "origin with no credential, against the gate's 403 "
                '{"error":"Origin not allowed."} - two different '
                "refusals, so the 401 is the route's own"),
    },
    # The same claim against the other Worker, and a separate row rather
    # than a re-dating of the one above: they are about two deployments,
    # and one status cannot describe both. Read it beside its twin - the
    # pair is what the arm grouping in the report exists to keep apart.
    {
        "id": "GET /snapshot, a signed-out reader on production",
        "surface": "route",
        "claim": "the route's own refusal on the deployment the cutover "
                 "is about, and the far side of it is unobservable "
                 "without a credential - so what a signed-out reader "
                 "can establish about production stops at the 401",
        "covers": ["server/worker.js"],
        "status": "performed",
        "performed": dict(
            PRODUCTION,
            how='401 {"error":"Not authorized."} from '
                "https://potaetoe.github.io carrying no Authorization "
                "header, against 403 for the same request with the "
                "Origin header removed - two different refusals, so the "
                "401 is the route's own and not the gate's. This is the "
                "DESIGNED uncredentialed answer and not a fault: the "
                "dispatch block refuses a caller-less request before "
                "handleReadSnapshot runs, so the "
                '"No snapshot published yet." 404 behind it cannot be '
                "reached from here, and whether production carries a "
                "published document is not observable without a "
                "session"),
    },
    # The row the two above stop short of, written down here rather than
    # left in a pull request body - AGENTS.md is explicit that a live
    # claim nobody could perform belongs in the ledger, and #157 is what
    # happens when it does not. It stays `never` and it stays debt: it
    # is not first-contact, because production EXISTS and the claim is
    # reachable there today. What it costs is a credential, which is
    # what puts it outside a delegated slice rather than outside the
    # project.
    {
        "id": "GET /snapshot, a credentialed read on production",
        "surface": "route",
        "claim": "a caller the production Worker accepts reads the "
                 "route past its session gate and learns whether a "
                 "document is published - the designed 404 when none "
                 "is, which is the answer no uncredentialed probe can "
                 "distinguish from a refusal",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "DELETE /snapshot",
        "surface": "route",
        "claim": "no automated probe drives this route: it is the one "
                 "destructive door here, it stays hand-driven, and a "
                 "suite that could reach it is a suite that will",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "DELETE /submission/{}",
        "surface": "route",
        "claim": "an admin removes one stored row and nothing beside "
                 "it moves",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "GET /content",
        "surface": "route",
        "claim": "the one route that answers without a credential "
                 "still answers without one",
        "covers": ["server/worker.js"],
        "status": "performed",
        "performed": dict(
            REHEARSAL,
            how='200 {"ok":true,"content":{}} with no Authorization '
                "header at all. The empty object is the deployment "
                "having no override set, not the route declining to "
                "answer - a 401 here is the failure this row watches "
                "for, and it is what gating this route by accident "
                "would look like"),
    },
    # These two claims are written against what a run can observe, and
    # that is narrower than what the routes are for. Nothing in
    # apps/web fetches /content: site_content appears in
    # server/worker.js and in its test file and nowhere a browser
    # loads. So an override reaching a page, and the shipped copy
    # coming back when it is unset, are not claims any sitting can
    # establish - there is no consumer, and no fallback to watch.
    #
    # They stay debt rather than moving to the permanent list, and the
    # distinction is the point. First-contact means production is the
    # first chance; this is a capability with no client, which
    # production does not fix either. A `never` row goes on being
    # counted as owed, which is the correct pressure - the answer is a
    # consumer or a decision to stop shipping the routes, not a status
    # that excuses them.
    {
        "id": "POST /content",
        "surface": "route",
        "claim": "an override is stored and comes back on the "
                 "credential-free read, which is as far as this route "
                 "can be followed while no page in apps/web asks for "
                 "one",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "DELETE /content/{}",
        "surface": "route",
        "claim": "unsetting a name takes it out of that same read; "
                 "that the shipped copy comes back in its place is "
                 "unobservable for the reason above, there being no "
                 "page that prefers an override to what it ships with",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "GET /membership",
        "surface": "route",
        "claim": "the listing separates membership from malformed and "
                 "never mixes the two",
        "covers": ["server/worker.js"],
        "status": "performed",
        "performed": dict(
            SITTING,
            how="the listing carried the one row a development session "
                "may write, and then, with rows the interface would "
                "never allow seeded straight into the table, it "
                "carried the two well-formed admin rows under "
                "membership and the non-hex one under malformed, "
                "alone. The seeding is what makes this a check: "
                "wrangler validates nothing, and that door is the "
                "whole reason the malformed list exists"),
    },
    {
        "id": "POST /membership",
        "surface": "route",
        "claim": "a development session may not write an admin row, "
                 "and is refused in the same bytes as everything else",
        "covers": ["server/worker.js"],
        "status": "performed",
        "performed": dict(
            SITTING,
            how="a development session writing an admin row drew 401 "
                "in the same bytes as every other refusal on this "
                "Worker, so the refusal teaches a caller nothing about "
                "what the route would have said next. The one role it "
                "may write stored 200 and then appeared in the "
                "listing - the allow arm, without which a route that "
                "refused everything would answer the first exactly the "
                "same way"),
    },
    {
        "id": "DELETE /membership/{}/{}",
        "surface": "route",
        "claim": "the last admin row cannot be removed, and a row "
                 "spelled in the wrong case still can",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "DELETE /membership/{}/{}, a development session",
        "surface": "route",
        "claim": "a development session may not remove an admin row "
                 "either, and is refused in the bytes it is refused "
                 "for writing one in",
        "covers": ["server/worker.js"],
        "status": "performed",
        "performed": dict(
            SITTING,
            how="DELETE against an admin row over a development "
                "session answered 401, matching the POST refusal "
                "above. What this route exists to guard - the last "
                "admin row, and a row spelled in a case this Worker "
                "cannot honor still being removable - answers only to "
                "the break-glass token and is the row above"),
    },

    # ---- pages: dist/ is what the deploy copies - apps/web with the
    # comments taken out of the CSS and the scripts (#181) - so a page's
    # live behavior is unexercised until it is served from somewhere a
    # Worker will answer. Both halves are recorded here
    # now. The refusal half needs no secret - a forged session token
    # draws a real 401 from a deployed Worker - and the signed-in half
    # needed the development sign-in secret and a person at the
    # keyboard, which is why it waited for the second run.
    {
        "id": "index.html",
        "surface": "page",
        "claim": "the sign-in page reaches a live Worker and lands a "
                 "signed-in member on the submit page",
        "covers": ["apps/web/index.html"],
        "status": "performed",
        "performed": dict(
            SITTING,
            how="signed in from this page through the script it ships "
                "against the deployed Worker, as an admin and as a "
                "member, and the session it minted carried the reader "
                "on to your-page.html, where the form and the account "
                "card painted. The widget is its own row on the "
                "first-contact list below; what is discharged here is "
                "that this page reaches a live Worker at all and that "
                "what it mints is accepted by the next page"),
    },
    # The retest of the arm below starts by restarting the browser, and
    # the reading is worth nothing without it: the operating system
    # setting does not reach a browser that is already running, so
    # matchMedia goes on answering false, the page paints the animation
    # it would have painted anyway, and what looks like a pass is a
    # pass for the wrong reason. Ten seconds, in the right order.
    {
        "id": "index.html, the reduced-motion arm",
        "surface": "page",
        "claim": "a reader asking for reduced motion is given no frame "
                 "of the closed cover at all, the stylesheet "
                 "cancelling that animation outright rather than "
                 "shortening it - at 0.01ms the first frame still "
                 "paints, and the first frame is an opaque panel "
                 "across the whole viewport",
        "covers": ["apps/web/index.html", "apps/web/theme.css"],
        "status": "never",
    },
    {
        "id": "your-page.html",
        "surface": "page",
        "claim": "the form round-trips to a live Worker",
        "covers": ["apps/web/your-page.html", "apps/web/submit.js"],
        "status": "performed",
        "performed": dict(
            SITTING,
            how="entries were typed into the form and sealed in the "
                "browser, and what came back out of the export under "
                "the deployment's key was those same values - so the "
                "round trip closed on a real Worker rather than at the "
                "POST, which is the most a page can tell on its own. "
                "The account card on the same page read its count back "
                "from the service"),
    },
    {
        "id": "your-page.html, a live 401",
        "surface": "page",
        "claim": "a refused session clears the stored token and sends "
                 "the reader back to the sign-in page",
        "covers": ["apps/web/your-page.html", "apps/web/submit.js"],
        "status": "performed",
        "performed": dict(
            REHEARSAL,
            how="a forged session token drew a real 401 from the "
                "deployed Worker; the token was cleared and the page "
                "replaced itself with index.html"),
    },
    {
        "id": "charts.html",
        "surface": "page",
        "claim": "the published figures paint from a real snapshot",
        "covers": ["apps/web/charts.html", "apps/web/public.js"],
        "status": "performed",
        "performed": dict(
            SITTING,
            how="read as a member: the combined-weight hero first, "
                "before any chart, entries and people agreeing with "
                "what had been submitted, a freshness line, the "
                "distributions, and a privacy paragraph that matched "
                "what the document actually carried. A second publish "
                "with nothing changed drew the movement line stating "
                "its own suppression - too few entries have moved to "
                "say by how much - rather than a blank, a blank being "
                "the different and false claim that nothing changed. "
                "That the figures paint is this row. That every "
                "suppressed cell paints legibly is not: defects were "
                "filed against three that do not"),
    },
    {
        "id": "charts.html, a live 401",
        "surface": "page",
        "claim": "a refused session clears the token and the page says "
                 "so where it stands, rather than redirecting",
        "covers": ["apps/web/charts.html", "apps/web/public.js"],
        "status": "performed",
        "performed": dict(
            REHEARSAL,
            how="the same forged token; the token was cleared, the page "
                "stayed put and read \"Your sign-in is no longer "
                "valid.\" Three pages answer a live 401 three different "
                "ways, so one row could not have covered them"),
    },
    {
        "id": "admin.html",
        "surface": "page",
        "claim": "the page that holds the whole corpus in the clear "
                 "paints its key card and its controls when it is "
                 "served from an origin the Worker answers",
        "covers": ["apps/web/admin.html", "apps/web/admin.js"],
        "status": "performed",
        "performed": dict(
            REHEARSAL,
            how="opened in a browser for the first time in this "
                "project's life: the key card, Fetch and decrypt, Clear "
                "and Unpublish all painted, and no export-token box "
                "appeared. What is behind the key card was not reached "
                "at this head - decrypting needs the development "
                "private key, which is held offline - so what the key "
                "opens is carried by the key-flow rows below and never "
                "by this one, whatever status those rows wear"),
    },
    {
        "id": "admin.html, a live 401",
        "surface": "page",
        "claim": "a refused session draws an error card, and this page "
                 "alone neither redirects nor clears the token the "
                 "Worker has just refused",
        "covers": ["apps/web/admin.html", "apps/web/admin.js"],
        "status": "performed",
        "performed": dict(
            REHEARSAL,
            how="the export call answered 401, observed by "
                "instrumenting window.fetch rather than by reading the "
                "page's own words back; the card said \"The admin "
                "session was not accepted.\", the page stayed, and the "
                "refused token was still in sessionStorage afterwards"),
    },
    {
        "id": "404.html",
        "surface": "page",
        "claim": "the page says so plainly, offers one way back, and "
                 "requests nothing off-origin",
        "covers": ["apps/web/404.html"],
        "status": "performed",
        "performed": dict(
            REHEARSAL,
            how="opened directly: a plain message, one way back, no "
                "rail and no Theme chips, and nothing requested "
                "off-origin under its connect-src 'self'"),
    },

    # ---- flows: voluntary rows, seeded from the cutover review pack's
    # Tier A and the dev-arm rehearsal's ledger. Nothing forces one into
    # existence; these are the largest debts stated as data so the query
    # answers the question the owner actually asks. A flow is also where
    # a discharged claim lands when it is about no single route and no
    # single page - the origin gate is in front of every route, and the
    # signed-out bounce is a property of the pages together.
    {
        "id": "the origin gate, all three answers",
        "surface": "flow",
        "claim": "an allowed origin reaches the handler and is refused "
                 "on its credential, while a foreign origin and no "
                 "origin at all are refused by the gate in bytes "
                 "identical to each other",
        "covers": ["server/worker.js", "server/wrangler.toml"],
        "status": "performed",
        "performed": dict(
            REHEARSAL,
            how="GET /snapshot answered 401 for http://127.0.0.1:8124 "
                "and for http://localhost:8124, and 403 for "
                "https://potaetoe.github.io and for a request with no "
                "Origin header. The three answers together are the "
                "check: the first alone cannot tell a working gate from "
                "a Worker that allows everything, and a probe that "
                "forgets the header reads exactly like a foreign origin "
                "being refused. http://127.0.0.1:8130 - a delegated "
                "slice's own assigned port - also answered 403, which "
                "is the mechanical reason live verification has been "
                "unreachable from every slice but the one holding 8124"),
    },
    {
        "id": "the origin gate on production, all three answers",
        "surface": "flow",
        "claim": "the gate in front of every route on the live "
                 "deployment refuses a foreign origin and a request "
                 "carrying no origin at all in identical bytes, and "
                 "admits the published origin as far as the route's own "
                 "refusal",
        "covers": ["server/worker.js", "server/wrangler.toml"],
        "status": "performed",
        "performed": dict(
            PRODUCTION,
            how="GET /snapshot against the production Worker three "
                "times, differing only in the Origin header. No header "
                "at all and https://example.com both answered 403 "
                '{"error":"Origin not allowed."} with no CORS header of '
                "any kind; https://potaetoe.github.io answered 401 "
                "carrying Access-Control-Allow-Origin for that origin, "
                "Vary: Origin and Max-Age 86400. The three together are "
                "the check: the 403 alone cannot tell a working gate "
                "from a Worker refusing everything, and a probe that "
                "forgets the header reads exactly like a foreign origin "
                "being refused. Read-only GETs, which is the whole of "
                "what a slice holding no credential may drive against "
                "this deployment"),
    },
    {
        "id": "the signed-out bounce, with nothing announced",
        "surface": "flow",
        "claim": "a reader with no session is sent to the sign-in page "
                 "from every gated page, and no request leaves at all - "
                 "a request that earns a 401 has still announced the "
                 "reader to the Worker",
        "covers": ["apps/web/session.js", "apps/web/submit.js",
                   "apps/web/public.js", "apps/web/admin.js"],
        "status": "performed",
        "performed": dict(
            REHEARSAL,
            how="with sessionStorage empty, your-page.html, charts.html "
                "and admin.html each sent the reader to index.html; no "
                "form, no figures and no key box painted, and the "
                "network panel stayed empty on all three"),
    },
    {
        "id": "the import-once, return-later key flow",
        "surface": "flow",
        "claim": "the keyholder imports the development private key "
                 "once and a later visit decrypts without another "
                 "paste, against a real export",
        "covers": ["apps/web/admin.js"],
        "status": "performed",
        "performed": dict(
            SITTING,
            how="the key file was picked before a single row existed, "
                "and the page proved it cryptographically there and "
                "then - a probe sealed to the deployment's published "
                "key and opened again - so the expensive discovery of "
                "holding the wrong key was available against an empty "
                "database rather than against a corpus already "
                "dropped. It then survived five sign-outs and a "
                "navigation, and opened a real export with no second "
                "paste, which is the half that a key merely accepted "
                "cannot show"),
    },
    {
        "id": "charts painted from decrypted rows",
        "surface": "flow",
        "claim": "a chart is drawn from rows a live Worker returned, "
                 "rather than asserted in Node with no layout engine",
        "covers": ["apps/web/dashboard.js", "apps/web/admin.js"],
        "status": "performed",
        "performed": dict(
            SITTING,
            how="the first human view of that SVG: weight over time "
                "drew a real slope for the two people carrying two "
                "entries and a single point for the three carrying "
                "one, and the distributions and the height panel "
                "populated. Every assertion about this drawing until "
                "the run was made in Node, with no layout engine and "
                "no pixels"),
    },
    # Two rows, because one status cannot describe both parties to the
    # refusal. A pair of corrections fired from a console arrives at
    # the Worker serialized, so the 409 comes from the ordinary check
    # and says nothing at all about the index; recording that as the
    # race arm is how a guard gets written down as raced when it has
    # only been asked twice. The index refusing under a genuine race is
    # held by the suite's holdInsert seam in dev/worker.test.mjs and by
    # nothing live.
    {
        "id": "the supersede guard against real D1",
        "surface": "flow",
        "claim": "the guarded insert refuses a second correction of "
                 "one entry against a database rather than a "
                 "hand-written stub, and no entry is left with two "
                 "current rows",
        "covers": ["server/worker.js", "server/schema.sql"],
        "status": "performed",
        "performed": dict(
            SITTING,
            how="against the deployed development database, with "
                "submissions_supersedes_unique confirmed on the table "
                "before anything was written: a correction stored 200 "
                "and left the member's count where it was, a second "
                "correction of the same row drew 409 in the wording "
                "the page shows, and the fan-in query returned no rows "
                "before or after. Which party refused is the row "
                "below, and it is not this one"),
    },
    {
        "id": "the supersede guard against real D1, the index as the "
              "refusing party",
        "surface": "flow",
        "claim": "with two corrections genuinely in flight at once the "
                 "UNIQUE index is what refuses the second, rather than "
                 "the ordinary check getting there first - the half "
                 "that decides whether the guard survives a race, and "
                 "the half a hand-driven pair cannot reach because the "
                 "requests serialize on the way out",
        "covers": ["server/worker.js", "server/schema.sql"],
        "status": "never",
    },
    {
        "id": "the UNIQUE index on supersedes, on the deployed database",
        "surface": "flow",
        "claim": "the index the guard falls back on is applied to the "
                 "development database, under the name that makes it "
                 "unique rather than the one it replaced",
        "covers": ["server/schema.sql"],
        "status": "performed",
        "performed": dict(
            REHEARSAL,
            how="sqlite_master on hg_binder_db_dev listed "
                "submissions_supersedes_unique beside "
                "submissions_account. The name is the whole evidence: a "
                "failed migration leaves the table with no index at "
                "all, and the non-unique predecessor spells itself "
                "differently. That the index REFUSES a second "
                "correction is the race row above, and neither run has "
                "reached it"),
    },
    {
        "id": "the crypto module's real bytes in a browser",
        "surface": "flow",
        "claim": "both stored formats round-trip in a browser's "
                 "WebCrypto rather than only in Node's",
        "covers": ["dev/crypto-browser-check.html", "apps/web/crypto.js"],
        "status": "performed",
        "performed": dict(
            REHEARSAL,
            how="dev/crypto-browser-check.html served over loopback and "
                "opened: every check green, both stored formats, and a "
                "seal to config.js's development key that the Worker "
                "accepts as base64. Bounded honestly: that page carries "
                "a Content-Security-Policy no published page carries, "
                "so what round-tripped is the browser's WebCrypto and "
                "not any shipped page's policy"),
    },
    {
        "id": "query.js frozen in a browser engine",
        "surface": "flow",
        "claim": "the shipped bytes publish BinderQuery and the freeze "
                 "holds under the engine that will run them, rather "
                 "than only under Node's loader",
        "covers": ["apps/web/query.js"],
        "status": "performed",
        "performed": dict(
            SITTING,
            how="loaded in a browser: BinderQuery published, "
                "Object.isFrozen answering true on it, the whole "
                "contract present, and describe() answering with its "
                "caption. The exported-objects-are-frozen rule is "
                "asserted everywhere else by a Node suite, and a "
                "loader is not an engine. What this does NOT say is "
                "that anything loads the file in the course of using "
                "the site: no page in apps/web requests it, which is a "
                "decision about whether it should ship yet and not "
                "something a run can settle"),
    },

    # ---- first contact: permanently unreachable before production.
    # Not debt. A row here is a risk that survives a perfect rehearsal,
    # and every one of them is the identity half of the design.
    #
    # No row here moves on a rehearsal, by construction - a sitting that
    # discharged one would be a sitting that had falsified the reason
    # the row is here, and the pinned guards are what would say so. The
    # membership row is the one to read beside server/wrangler.toml:
    # that file's [env.dev] block owns the same fact for the deployment
    # and this row owns it for the ledger, in the same words, so a
    # future sweep finds one fact rather than a disagreement.
    {
        "id": "telegram sign-in past the bot-token guard",
        "surface": "flow",
        "claim": "signature verification, the freshness window, the "
                 "no-username refusal and minting an admin all sit "
                 "behind a guard the development arm never passes",
        "covers": ["server/worker.js"],
        "status": "first-contact",
        "cause": "guarded-branch",
        "guard": "if (!botToken) return null;",
    },
    {
        "id": "the group check answering member, left or unknown",
        "surface": "flow",
        "claim": "the development arm exercises the unconfigured "
                 "branch, which is the one production will not use",
        "covers": ["server/worker.js"],
        "status": "first-contact",
        "cause": "guarded-branch",
        "guard": 'if (!env.TELEGRAM_GROUP_CHAT_ID) return "member";',
    },
    {
        "id": "a leaver's live sessions revoked",
        "surface": "flow",
        "claim": "revocation fires from one place, on a standing the "
                 "development arm cannot produce",
        "covers": ["server/worker.js"],
        "status": "first-contact",
        "cause": "guarded-branch",
        "guard": 'if (standing === "left") {',
    },
    {
        "id": "membership rows granting authority rather than listing",
        "surface": "flow",
        "claim": "every consumption site of that table sits inside the "
                 "Telegram sign-in, so on the development arm a row is "
                 "writable, readable and inert",
        "covers": ["server/worker.js"],
        "status": "first-contact",
        "cause": "guarded-branch",
        "guard": "const isAdmin = (await adminAccountIds(env))"
                 ".has(accountId);",
    },
    {
        "id": "the development sign-in's loopback condition",
        "surface": "flow",
        "claim": "the origin handed to the handler is already a "
                 "matched entry, so this condition fires only on a "
                 "misconfigured Worker and on neither deployment",
        "covers": ["server/worker.js"],
        "status": "first-contact",
        "cause": "guarded-branch",
        "guard": "if (!isLoopback(origin)) return missing;",
    },
    {
        "id": "the secret-only backfill measurement",
        "surface": "flow",
        "claim": "the development arm reads an empty id list, so the "
                 "measurement comes back empty for the wrong reason "
                 "and the flip decision rests on a number nothing has "
                 "produced",
        "covers": ["server/worker.js"],
        "status": "first-contact",
        "cause": "guarded-branch",
        "guard": "for (const id of await secretAdminAccountIds(env)) {",
    },
    {
        "id": "the Telegram widget rendering and its callback",
        "surface": "flow",
        "claim": "BotFather binds the widget to the published origin, "
                 "so the frame and the session it mints are reachable "
                 "from nowhere else",
        "covers": ["apps/web/index.html"],
        "status": "first-contact",
        "cause": "published-origin-only",
    },
    {
        "id": "POST /auth/dev answering 404 on production",
        "surface": "flow",
        "claim": "the absence of the development secret is what turns "
                 "the route off, and only production can show it, "
                 "where anything but 404 is a sign-in bypass",
        "covers": ["server/worker.js"],
        "status": "first-contact",
        "cause": "production-secret",
    },
    {
        "id": "the production id list and account secret being right",
        "surface": "flow",
        "claim": "a wrong admin id looks exactly like a working "
                 "deployment until the first export, and the account "
                 "secret becomes permanent at the first stored row",
        "covers": ["server/wrangler.toml"],
        "status": "first-contact",
        "cause": "production-secret",
    },
    {
        "id": "the submit page fingerprint against the pinned message",
        "surface": "flow",
        "claim": "the fingerprint members are asked to compare lives "
                 "in a Telegram group, which no page here and no shell "
                 "here can see",
        "covers": ["apps/web/your-page.html"],
        "status": "first-contact",
        "cause": "off-machine",
    },
]


def read(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read()


# ------------------------------------------------------------------ #
# The router, read as the spine.                                      #

ROUTER_OPEN = re.compile(r"^async function route\(", re.M)
METHOD_TEST = re.compile(r'(?:request\.)?method\s*===\s*"([A-Z]+)"')
PATH_TEST = re.compile(r'path\s*===\s*"([^"]*)"')
PATTERN_BIND = re.compile(
    r"^\s*const\s+([A-Za-z_]\w*)\s*=\s*/(.*)/\.exec\(path\)")
PATTERN_USE = re.compile(r"&&\s*([A-Za-z_]\w*)\s*\)")
SHAPE_OK = re.compile(r"[A-Za-z0-9/_.{}-]+")


def router_body(source):
    """(body, problem) for server/worker.js's dispatch block.

    A parser that cannot find what it was pointed at reports rather
    than returning "nothing wrong here" - #34's lesson, and the one
    that matters most here: an unread router yields an empty spine,
    every completeness rule below passes, and a route nobody has a row
    for reads as covered.
    """
    opened = ROUTER_OPEN.search(source)
    if not opened:
        return None, ("server/worker.js names no `async function "
                      "route(` - the dispatch block has moved or been "
                      "renamed, and the ledger's completeness rule "
                      "would pass while reading nothing")
    rest = source[opened.start():]
    end = re.search(r"^\}", rest[1:], re.M)
    if not end:
        return None, ("the dispatch block in server/worker.js does not "
                      "close at column 0 - the reader cannot bound it, "
                      "and a half-read router is an under-read one")
    return rest[:end.end() + 1], None


def shape(pattern):
    """A route pattern as the path shape it matches, or None.

    None is a refusal and never a skip. A pattern this cannot render is
    a route the spine would otherwise lose silently.
    """
    if not (pattern.startswith("^") and pattern.endswith("$")):
        return None
    inner = pattern[1:-1].replace("\\/", "/").replace("([^/]+)", "{}")
    if not SHAPE_OK.fullmatch(inner):
        return None
    return inner


def route_ids(source):
    """([route id, ...], [problem, ...]) from a router source.

    Every dispatch line is routed through the refusal. A line naming a
    method that resolves to no path and no bound pattern is a failure,
    because filtering it out is how a check stops covering exactly the
    case it was written for.
    """
    body, problem = router_body(source)
    if problem:
        return [], [problem]

    bound = {}
    ids = []
    problems = []
    for line in body.splitlines():
        binding = PATTERN_BIND.match(line)
        if binding:
            bound[binding.group(1)] = shape(binding.group(2))
            continue

        found = METHOD_TEST.search(line)
        if not found:
            continue
        method = found.group(1)

        path = PATH_TEST.search(line)
        if path:
            ids.append("%s %s" % (method, path.group(1)))
            continue

        used = PATTERN_USE.search(line)
        if used and used.group(1) in bound:
            if bound[used.group(1)] is None:
                problems.append(
                    "the route pattern bound to `%s` cannot be read as "
                    "a path shape, so its route would be missing from "
                    "the ledger's spine without anything saying so"
                    % used.group(1))
                continue
            ids.append("%s %s" % (method, bound[used.group(1)]))
            continue

        # The preflight is the one dispatch line with no path, because
        # it answers before a path means anything. A second path-less
        # method would be a route with no shape, and guessing one puts
        # an entry in the spine that matches nothing.
        if method == "OPTIONS":
            ids.append("OPTIONS *")
            continue

        problems.append(
            "this dispatch line names a method and resolves to no "
            "route, so the spine cannot see it: %s" % line.strip())

    if not ids and not problems:
        problems.append(
            "the dispatch block in server/worker.js dispatches "
            "nothing the reader can see - the router has changed "
            "shape, and every rule below would pass on an empty spine")
    return ids, problems


def page_names():
    return sorted(name for name in os.listdir(WEB)
                  if name.endswith(".html"))


# ------------------------------------------------------------------ #
# The rules.                                                          #

DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SHA = re.compile(r"^[0-9a-f]{40}$")


def entry_problems(ledger):
    """A description for every row that is not well formed.

    The vocabulary is closed in both directions. A missing key and an
    unknown key are both failures, because a ledger that accepts
    free-form fields has become a document again - and a document is
    what #157 is replacing.
    """
    problems = []
    seen = set()
    for row in ledger:
        rid = row.get("id") or "<no id>"

        missing = [key for key in REQUIRED
                   if not row.get(key)]
        if missing:
            problems.append(
                "ledger row %r is missing %s" % (rid, ", ".join(missing)))
            continue

        unknown = sorted(set(row) - set(REQUIRED) - set(OPTIONAL))
        if unknown:
            problems.append(
                "ledger row %r carries %s, which no rule reads - a row "
                "may only say what the vocabulary here can check"
                % (rid, ", ".join(unknown)))
            continue

        if rid in seen:
            problems.append(
                "ledger row %r appears twice; one row per claim, and a "
                "second claim about one route qualifies its id after a "
                "comma" % rid)
            continue
        seen.add(rid)

        if row["surface"] not in SURFACES:
            problems.append(
                "ledger row %r has surface %r; it must be one of %s"
                % (rid, row["surface"], ", ".join(SURFACES)))
            continue

        if row["status"] not in STATUSES:
            problems.append(
                "ledger row %r has status %r; it must be one of %s"
                % (rid, row["status"], ", ".join(STATUSES)))
            continue

        if not isinstance(row["covers"], list):
            problems.append(
                "ledger row %r must cover a list of paths" % rid)
            continue
        absent = [path for path in row["covers"]
                  if not os.path.exists(os.path.join(REPO, path))]
        if absent:
            problems.append(
                "ledger row %r stands on %s, which is not in the tree - "
                "evidence about a file that has left is evidence about "
                "nothing" % (rid, ", ".join(absent)))
            continue

        unstood = [path for path in surface_files(row)
                   if path not in row["covers"]]
        if unstood:
            problems.append(
                "ledger row %r does not stand on %s, which is the file "
                "its own surface is. `covers` is what staleness is "
                "measured against, so a row that names other files ages "
                "on their movement and not on its own - and a row that "
                "never ages reads as the strongest evidence here rather "
                "than as none" % (rid, ", ".join(unstood)))
            continue

        problems.extend(status_problems(rid, row))

    return problems


def surface_files(row):
    """The files a forced row's evidence must stand on, from its id.

    Derived rather than trusted, which is AGENTS.md's review-bar
    corollary: a rule computed entirely from the field it guards cannot
    detect that the field was chosen to pass it. `covers` decides when a
    row goes stale, so a row free to name any path in the tree can buy
    permanent freshness by naming one that never moves.

    Only the two forced surfaces. Nothing enumerates a flow, so nothing
    here can say which files one ought to name, and a rule that guessed
    would be a rule the next flow row argues with.
    """
    if row.get("surface") == "route":
        return ["server/worker.js"]
    if row.get("surface") == "page":
        return ["apps/web/%s" % route_of(row.get("id", ""))]
    return []


def arm_of(sha):
    """The deployment a cited head was driven against, or None.

    The first run naming a head wins, which is why run_problems refuses
    a head declared twice: a second declaration would re-label every row
    standing on that head and nothing else would say so.
    """
    for run in RUNS:
        if run["sha"] == sha:
            return run["arm"]
    return None


def status_problems(rid, row):
    """The fields one status requires and the others forbid.

    The two statuses may not be worn at once: a row marked discharged
    and permanently-impossible together reads as cleared in one column
    and excused in the other, which is the exact ambiguity this ledger
    replaces.
    """
    status = row["status"]
    evidence = row.get("performed")
    cause = row.get("cause")

    if status != "performed" and evidence:
        return ["ledger row %r carries evidence and is not marked "
                "performed" % rid]
    if status != "first-contact" and cause:
        return ["ledger row %r names a first-contact cause and is not "
                "marked first-contact" % rid]

    if status == "performed":
        if not isinstance(evidence, dict):
            return ["ledger row %r is marked performed and carries no "
                    "evidence; a performed claim states its date, the "
                    "head it ran at, and what ran" % rid]
        if not DATE.match(str(evidence.get("date", ""))):
            return ["ledger row %r needs an ISO date for when it was "
                    "performed" % rid]
        if not SHA.match(str(evidence.get("sha", ""))):
            return ["ledger row %r needs the full 40-character head it "
                    "was performed at; an abbreviated one cannot be "
                    "compared against what has moved since" % rid]
        if not str(evidence.get("how", "")).strip():
            return ["ledger row %r needs an account of what actually "
                    "ran; a date alone is a claim about a calendar"
                    % rid]
        if evidence["sha"] not in {run["sha"] for run in RUNS}:
            return ["ledger row %r stands on a head that RUNS does not "
                    "declare. Two runs here share a date, so the "
                    "report reads a declared order rather than sorting "
                    "the rows; a head outside it is evidence the query "
                    "has nowhere to put, and the row would drop out of "
                    "the cadence line without a word. Declare the run "
                    "beside the others, or cite the one that produced "
                    "this row" % rid]
        named = evidence.get("arm")
        if named and named != arm_of(evidence["sha"]):
            return ["ledger row %r says it was performed against the %s "
                    "arm and cites a run that drove the %s arm. "
                    "Evidence earned against one deployment is not "
                    "evidence about the other, and the report groups on "
                    "this field, so the mismatch would move the row into "
                    "a column it was never earned in"
                    % (rid, named, arm_of(evidence["sha"]))]
        return []

    if status == "first-contact":
        if cause not in CAUSES:
            return ["ledger row %r is on the permanent list for %r, "
                    "which is not a registered cause; the causes are %s"
                    % (rid, cause, ", ".join(sorted(CAUSES)))]
        wants_guard = CAUSES[cause]["guard"]
        if wants_guard and not row.get("guard"):
            return ["ledger row %r rests on %r, which is only "
                    "corroborated by the source text it pins; give it a "
                    "guard" % (rid, cause)]
        if not wants_guard and row.get("guard"):
            return ["ledger row %r pins a guard, and %r is not "
                    "corroborated by source text; the pin would read as "
                    "a check nothing performs" % (rid, cause)]

    return []


def route_of(rid):
    """A row's id back to the route it claims something about."""
    return rid.split(",")[0].strip()


def spine_problems(ledger, routes, pages):
    """The forcing rule: the code decides what the ledger must contain.

    Both directions. A surface with no row is the failure #157 is
    about; a row for a surface that has left is how a reassuring count
    outlives the thing it counts.
    """
    problems = []
    claimed = {"route": set(), "page": set()}
    for row in ledger:
        surface = row.get("surface")
        if surface in claimed:
            claimed[surface].add(route_of(row.get("id", "")))

    for route in routes:
        if route not in claimed["route"]:
            problems.append(
                "server/worker.js dispatches `%s` and the live-"
                "verification ledger has no row for it. Nothing is "
                "asking you to go and verify it - it is asking you to "
                "say what a live run would show. Add to LEDGER in "
                "tools/check_live.py:\n"
                '        {"id": "%s", "surface": "route",\n'
                '         "claim": "<what a live run would establish>",\n'
                '         "covers": ["server/worker.js"],\n'
                '         "status": "never"},' % (route, route))

    for page in pages:
        if page not in claimed["page"]:
            problems.append(
                "apps/web/%s is published and the live-verification "
                "ledger has no row for it. Add to LEDGER in "
                "tools/check_live.py:\n"
                '        {"id": "%s", "surface": "page",\n'
                '         "claim": "<what a live run would establish>",\n'
                '         "covers": ["apps/web/%s"],\n'
                '         "status": "never"},' % (page, page, page))

    for row in ledger:
        rid = row.get("id", "")
        if row.get("surface") == "route" and route_of(rid) not in routes:
            problems.append(
                "ledger row %r claims a route server/worker.js no "
                "longer dispatches; a ledger holding rows for surfaces "
                "that have left counts the wrong thing" % rid)
        if row.get("surface") == "page" and route_of(rid) not in pages:
            problems.append(
                "ledger row %r claims a page apps/web no longer "
                "publishes" % rid)

    return problems


def cited_runs(ledger):
    return {row["performed"]["sha"] for row in ledger
            if row["status"] == "performed" and row.get("performed")}


def run_problems(ledger):
    """A declared run with no row standing on it.

    The other direction is entry_problems', row by row: a row may only
    cite a declared run. This one stops the declaration outliving its
    evidence. A run whose last row has been reclassified still sets the
    cadence line's date and the head that staleness is measured from,
    which is a confident answer about a sitting nothing remembers.
    """
    problems = [
        "RUNS declares the run at %s and no performed row stands "
        "on it. A run outliving its last row goes on dating the "
        "cadence line and setting the head staleness is measured "
        "against, for evidence the ledger no longer carries"
        % run["sha"][:12]
        for run in RUNS if run["sha"] not in cited_runs(ledger)]

    # The arm, and the head it is attached to. Both failures are
    # silent ones: an unregistered arm drops its rows out of the
    # report's grouping, and a head declared twice re-labels every row
    # standing on it, because arm_of answers with the first run naming
    # it. The grouping is the only thing that says how thin one arm is.
    seen = {}
    for run in RUNS:
        if run.get("arm") not in ARMS:
            problems.append(
                "RUNS declares the run at %s with arm %r, which is not "
                "one of %s. A run states which deployment it drove, and "
                "a run outside the vocabulary takes its rows out of the "
                "report's grouping without a word"
                % (run["sha"][:12], run.get("arm"), ", ".join(ARMS)))
        if run["sha"] in seen:
            problems.append(
                "RUNS declares the head at %s twice, as the %r arm and "
                "the %r arm. A head resolves to one arm by the first run "
                "naming it, so the second declaration silently re-labels "
                "every row standing on that head"
                % (run["sha"][:12], seen[run["sha"]], run.get("arm")))
        seen[run["sha"]] = run.get("arm")

    return problems


def loopback(origin):
    return (origin.startswith("http://localhost")
            or origin.startswith("http://127.0.0.1"))


def cause_problems(ledger, worker_source, blocks):
    """The boundary, corroborated from outside the ledger.

    A permanent list nobody re-examines is where an untested thing goes
    to stop being counted. So each corroborated cause is pinned to
    something a plausible change falsifies, and the two that cannot be
    pinned are bounded by a ceiling instead.

    A pinned guard is exact text, which makes it brittle - reformatting
    that line reddens this stage. That is the wanted behavior rather
    than a cost: the row gets read again, and re-pinning it is one
    edit. A fuzzy pin that survived the edit would survive the deletion
    too.
    """
    problems = []
    uncorroborated = 0
    wants_origins = False

    for row in ledger:
        if row.get("status") != "first-contact":
            continue
        cause = row.get("cause")
        meta = CAUSES.get(cause)
        if not meta:
            continue
        if not meta["checked"]:
            uncorroborated += 1
        if meta["guard"]:
            guard = row.get("guard") or ""
            if guard not in worker_source:
                problems.append(
                    "ledger row %r is on the permanent list because "
                    "server/worker.js carries `%s`, and it does not. "
                    "Reclassify the row or re-pin the guard - a "
                    "first-contact claim whose stated reason the code "
                    "has moved past is a claim nothing supports"
                    % (row.get("id"), guard))
        if cause == "published-origin-only":
            wants_origins = True

    if wants_origins:
        problems.extend(origin_problems(blocks))

    if uncorroborated > UNCORROBORATED_CEILING:
        problems.append(
            "%d first-contact rows rest on something no file in this "
            "repository can check, and the ceiling is %d. Raising it is "
            "allowed and is meant to be a line somebody reads: every "
            "row here is a claim taken on trust. Pin one to source, "
            "perform one, or say in the diff why the trust grew."
            % (uncorroborated, UNCORROBORATED_CEILING))

    return problems


def origin_problems(blocks):
    """The asymmetry the widget's classification rests on.

    Development allows loopback only; production names the published
    origin. Adding the agent port blocks' loopback origins to the
    development arm - which is the cheapest way to make live checks
    routine for delegated slices - leaves this intact, deliberately.
    """
    problems = []
    dev = blocks.get("[env.dev.vars]", {}).get("ALLOWED_ORIGINS")
    live = blocks.get("[vars]", {}).get("ALLOWED_ORIGINS")
    if dev is None or live is None:
        return ["server/wrangler.toml no longer names ALLOWED_ORIGINS "
                "in both vars blocks, so the widget's first-contact "
                "classification rests on nothing readable"]

    reachable = [origin for origin in dev.split(",")
                 if origin.strip() and not loopback(origin.strip())]
    if reachable:
        problems.append(
            "the development arm now allows %s, which is not loopback. "
            "A published origin reaching it changes what the widget can "
            "be exercised against, so its first-contact row wants "
            "re-reading rather than inheriting" % ", ".join(reachable))

    if not [origin for origin in live.split(",")
            if origin.strip() and not loopback(origin.strip())]:
        problems.append(
            "the production arm names no published origin, so "
            "'published-origin-only' distinguishes nothing")

    return problems


# ------------------------------------------------------------------ #
# The query.                                                          #

def debt(ledger):
    return [row for row in ledger if row["status"] == "never"]


def last_rehearsal(ledger, arm=None):
    """The newest run any performed row stands on, or None.

    Narrowed to one arm when `arm` is given, because "how far behind the
    record is" has a different answer per deployment and one number
    across both is the reassuring one. RUNS is walked backwards rather
    than the rows sorted by date: three runs here fall on one day, so a
    sort has nothing to break the tie with and answers with whichever
    row the ledger lists first - the older head, and the cadence line
    would then measure drift from a run that is not the latest. That
    failure is silent and reads in the reassuring direction, which is
    the shape this whole file is against.
    """
    cited = cited_runs(ledger)
    for run in reversed(RUNS):
        if run["sha"] in cited and arm in (None, run["arm"]):
            return run
    return None


def changed_since(sha, paths):
    """Which of `paths` moved after `sha`, or None if git cannot say.

    None rather than an empty list, because "nothing changed" and "no
    answer" must not print the same sentence - the whole reason this
    ledger exists is a correct label whose meaning was read wrong.
    """
    try:
        done = subprocess.run(
            ["git", "log", "--format=", "--name-only", "%s..HEAD" % sha,
             "--", *paths],
            cwd=REPO, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    if done.returncode != 0:
        return None
    return sorted({line.strip() for line in done.stdout.splitlines()
                   if line.strip()})


def freshness(ledger, changed=changed_since):
    """([(id, [path, ...])], [id, ...]) - what has aged, and what cannot
    be aged at all.

    Derived at read time rather than stored. A stored staleness flag is
    a second copy of a fact that git already holds, and it would rot in
    exactly the way the labels in thirty pull request bodies did.

    The second list is the point of this function existing beside
    stale(). A shallow clone answers nothing for a head it does not
    carry, and folding those rows in with the unmoved ones was harmless
    while staleness only printed. It stops being harmless the moment
    staleness counts toward the cadence: silence would become an
    undercount of what is owed, and an undercount here reads as nothing
    to do.
    """
    aged = []
    undetermined = []
    for row in ledger:
        if row["status"] != "performed":
            continue
        moved = changed(row["performed"]["sha"], row["covers"])
        if moved is None:
            undetermined.append(row["id"])
        elif moved:
            aged.append((row["id"], moved))
    return aged, undetermined


def stale(ledger, changed=changed_since):
    """[(id, [path, ...])] for performed rows whose bytes have moved."""
    return freshness(ledger, changed)[0]


def owed(ledger, changed=changed_since):
    """(count, [id, ...]) - what the cadence trigger counts, and what it
    could not read.

    A `never` row is owed because nothing has ever exercised it. A stale
    row is owed AGAIN: its evidence stands at a head this tree has moved
    past, which is the same standing, and re-running the probe costs the
    sitting what running it the first time cost. Counting the never rows
    alone is how nine debts against a threshold of fifteen read as
    nothing due while twenty-six of thirty-one performed rows had aged
    out - the arithmetic #202 exists to make impossible.
    """
    aged, undetermined = freshness(ledger, changed)
    return len(debt(ledger)) + len(aged), undetermined


def due(ledger, changed=changed_since):
    """True, False, or None when the count cannot be completed.

    None is not False. A batch that cannot be SHOWN due is not a batch
    shown not-due, and printing the second for the first is this file's
    own failure one layer down.

    A count already at the threshold answers True whatever could not be
    read, because an unread row can only add to it - the undetermined
    rows are a floor on what is owed, never a ceiling.
    """
    count, undetermined = owed(ledger, changed)
    if count >= CADENCE_THRESHOLD:
        return True
    if undetermined:
        return None
    return False


def commits_since(sha):
    try:
        done = subprocess.run(
            ["git", "rev-list", "--count", "%s..HEAD" % sha],
            cwd=REPO, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    if done.returncode != 0:
        return None
    return done.stdout.strip()


def report(changed=changed_since):
    lines = []
    outstanding = debt(LEDGER)
    performed = [row for row in LEDGER if row["status"] == "performed"]
    permanent = [row for row in LEDGER
                 if row["status"] == "first-contact"]
    aged, unaged = freshness(LEDGER, changed)
    moved_by = dict(aged)

    lines.append("Live-verification ledger - %d rows" % len(LEDGER))
    lines.append("")
    lines.append("NEVER EXERCISED against a running system  (%d)"
                 % len(outstanding))
    for row in outstanding:
        lines.append("  %-8s %-46s %s"
                     % (row["surface"], row["id"], row["claim"]))

    lines.append("")
    lines.append("PERFORMED  (%d)" % len(performed))
    if not performed:
        lines.append("  none - no rehearsal against a running system "
                     "has ever been recorded here")
    else:
        lines.append("  Grouped by the deployment each run drove. "
                     "Evidence earned against one arm is not")
        lines.append("  evidence about the other, and a single flat "
                     "count reads as though it were.")
        for arm in ARMS:
            rows = [row for row in performed
                    if arm_of(row["performed"]["sha"]) == arm]
            lines.append("")
            if not rows:
                lines.append("  %s  - NO ROW HAS EVER BEEN PERFORMED "
                             "AGAINST THIS ARM" % arm)
                continue
            lines.append("  %s  (%d rows, %d stale)"
                         % (arm, len(rows),
                            len([r for r in rows if r["id"] in moved_by])))
            for row in rows:
                lines.append("    %-8s %-46s %s, %s"
                             % (row["surface"], row["id"],
                                row["performed"]["date"],
                                row["performed"]["how"]))
                if row["id"] in moved_by:
                    lines.append(
                        "      STALE  %s moved since that head"
                        % ", ".join(moved_by[row["id"]]))
    if unaged:
        lines.append("")
        lines.append("  %d performed row(s) could not be aged at all - "
                     "git did not answer for the head they" % len(unaged))
        lines.append("  stand on. That is not the same as fresh, and "
                     "the owed count below says so.")

    lines.append("")
    lines.append("FIRST CONTACT - cannot be met before production  (%d)"
                 % len(permanent))
    lines.append("  Not debt. These survive a perfect rehearsal.")
    for cause in sorted(CAUSES):
        rows = [row for row in permanent if row.get("cause") == cause]
        if not rows:
            continue
        mark = ("corroborated" if CAUSES[cause]["checked"]
                else "UNCORROBORATED, %d of %d against the ceiling"
                     % (len(rows), UNCORROBORATED_CEILING))
        lines.append("")
        lines.append("  %s [%s]" % (cause, mark))
        lines.append("    %s" % CAUSES[cause]["why"])
        for row in rows:
            lines.append("      %-44s %s" % (row["id"], row["claim"]))

    lines.append("")
    lines.append("CADENCE")
    count, unread = owed(LEDGER, changed)
    verdict = due(LEDGER, changed)
    lines.append("  owed %d of %d - %d never exercised, %d performed "
                 "row(s) gone stale."
                 % (count, len(LEDGER), len(outstanding), len(aged)))
    lines.append("  A stale row is owed AGAIN: its evidence stands at a "
                 "head this tree has moved past,")
    lines.append("  which is the standing of a row nothing has ever "
                 "exercised, and it costs a sitting the")
    lines.append("  same minutes. Counting the never rows alone is how "
                 "five sixths of this ledger aged")
    lines.append("  out with nothing due.")
    lines.append("  threshold %d - the batch is due when the owed count "
                 "reaches it," % CADENCE_THRESHOLD)
    lines.append("  or before any cutover, whichever comes first.")
    lines.append("")
    for arm in ARMS:
        latest = last_rehearsal(LEDGER, arm)
        if latest is None:
            lines.append("  %-12s no run has ever driven this arm"
                         % arm)
            continue
        moved = commits_since(latest["sha"])
        if moved is None:
            since = "an undetermined number of commits"
        else:
            since = "%s commit%s" % (moved, "" if moved == "1" else "s")
        lines.append("  %-12s last run %s at %s; %s since"
                     % (arm, latest["date"], latest["sha"][:12], since))
    lines.append("")
    if last_rehearsal(LEDGER) is None:
        lines.append("  No rehearsal has ever been recorded. The debt "
                     "above is the whole ledger, which is what #157 "
                     "opens by saying.")
    if verdict is True:
        lines.append("  DUE.")
    elif verdict is None:
        lines.append("  CANNOT SAY - %d performed row(s) could not be "
                     "aged, so the owed count is a floor. A batch that "
                     "cannot be shown due is not one shown not-due."
                     % len(unread))
    else:
        lines.append("  Not due.")
    lines.append("")
    lines.append("  Most of the batch is owner-only by capability "
                 "rather than by preference: server/wrangler.toml")
    lines.append("  pins the development origins to port 8124, which "
                 "the agent pack reserves, and anything behind")
    lines.append("  a session needs secrets. The exception is the "
                 "production arm's uncredentialed edge - the")
    lines.append("  origin gate and the refusals in front of every "
                 "route answer read-only GETs from any")
    lines.append("  shell, which is how that arm's first rows were "
                 "earned.")
    lines.append("  Discharging a row means editing it here to "
                 "\"performed\" with an account of what ran, beside the")
    lines.append("  date and the full head of the sitting that ran it. "
                 "A row marked STALE is discharged the")
    lines.append("  same way and never by re-dating it onto a run it "
                 "did not stand on: re-performing it means")
    lines.append("  declaring the new run in RUNS and citing that. The "
                 "steps themselves belong in UAT.md's")
    lines.append("  live arm, not in this file.")
    return "\n".join(lines)


# ------------------------------------------------------------------ #

def problems():
    source = read(WORKER)
    routes, refused = route_ids(source)
    if refused:
        return refused

    blocks, unreadable = check_server.vars_blocks(read(WRANGLER))
    if unreadable:
        return [unreadable]

    found = entry_problems(LEDGER)
    found += spine_problems(LEDGER, routes, page_names())
    found += cause_problems(LEDGER, source, blocks)
    found += run_problems(LEDGER)
    return found


def main():
    found = problems()
    for problem in found:
        print("FAIL  %s" % problem)
    if found:
        print("\n%d problem(s). The ledger and the code disagree - see "
              "tools/check_live.py, and `./run live` for the report."
              % len(found))
        return 1

    if "--report" in sys.argv:
        print(report())
        return 0

    print("live-verification ledger OK - %d rows, %d never exercised, "
          "%d first-contact.\nRun `./run live` for the report."
          % (len(LEDGER), len(debt(LEDGER)),
             len([r for r in LEDGER if r["status"] == "first-contact"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
