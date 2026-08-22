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
every route in server/worker.js's dispatch block, every page in
apps/web/, and every real file export apps/web/*.js hands the browser
must carry a row. A slice that adds a route, a page or an export and no
row turns the gate red, and the failure carries the row to paste. That
is the whole mechanism, and the reason it is narrow: a gate that fails
for something the failing slice cannot fix gets disabled, and a
disabled mechanism is worse than a small one.

**The export spine forces on a MIME type, not a marker.** A route is
enumerable because server/worker.js's dispatch block names every path
in one place; a page is enumerable because apps/web lists its own
files. A file export has neither property - two call sites across two
files today (submit.js and charts.js, each its own `wireDownload()`
building a workbook; admin.js's own three exports, and the shared
`offer()` that built them, retired whole at 0.9-M3-S10, #416 - #385
§4 rules that no admin surface exposes a current member's data) - so
nothing here can read "this call hands the browser a file" off the code
shape the way
METHOD_TEST reads a dispatch line. What every export carries, at the
exact call that builds the download, is a literal MIME type a Blob
never needs for any other reason: `"text/csv..."`, the OOXML
spreadsheet type, and JSON's own type with a charset parameter -
`admin.js`'s API calls all send bare `"application/json"`, with no
charset, so the parameter is what tells a download's Content-Type from
a request's. export_families() reads all three, each anchored tightly
enough that xlsx.js's own longer Content-Type string for the workbook
part - one part-type further, `...spreadsheetml.sheet.main+xml` - does
not match. **A family EXPORT_MIME has never heard of is not silently
skipped.** export_families() only ever says which of the *registered*
families a file carries; a literal MIME type handed straight to a
`new Blob(` call that matches none of them is a download this ledger
cannot classify, not one that does not exist - the review that opened
this second sentence proved the gap by injecting five (0.9-M3-S6 fix
wave 1, #394). unrecognized_blob_types() finds exactly that shape and
export_class_problems() below refuses the gate on it, in the same
breath export_families() is silent about a MIME type nowhere near a
`new Blob(` call, such as a fetch header's Content-Type - out of
reach by construction, not by exemption, because a header is never
inside that call's own parentheses.

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

# tools/ is not a package; a script run directly puts its own directory
# on sys.path, and dev/check_live.test.py inserts it before naming
# check_live at all - so this resolves either way. Imported rather than
# copied, the same reason tools/check_server.py imports check_web
# instead of holding its own key patterns: two JS comment strippers
# drifting apart is worse than one shared one.
import check_web

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKER = os.path.join(REPO, "server", "worker.js")
WEB = os.path.join(REPO, "apps", "web")

STATUSES = ("never", "performed", "first-contact")

# `route`, `page` and `export` are the forced spine - all three are
# enumerable from the tree, so a row cannot be silently missing. `flow`
# is everything else a sitting exercises; nothing can force one into
# existence, and calling that out is more useful than a spine that
# pretends to cover it.
SURFACES = ("route", "page", "flow", "export")

# The deployments a run can have driven. Two Workers answer for this
# project - server/wrangler.toml's non-production block and its bare
# one - and a sitting reaches exactly one of them. The arm is declared
# on the run rather than on the row so that it cannot be typed wrong per
# row, and the report groups on it: without the grouping, a count of
# performed rows is read as coverage of whichever deployment the reader
# had in mind.
#
# "development" names every REHEARSAL/SITTING run recorded below,
# against the pre-0.9 Worker that [env.dev] deployed - true history,
# unrenamed on purpose (0.9-M1-S1, #325: that block is now [env.sit] in
# the file, but a past run drove what was actually deployed the day it
# ran, and renaming the label would misstate which Worker it was).
#
# "sit" is its own arm (0.9-M1-S2, #326), never an overload of
# "development": [env.sit] carries a real TELEGRAM_BOT_TOKEN and a real
# TELEGRAM_GROUP_CHAT_ID that no run ever recorded against "development"
# had, so evidence earned on one is not evidence about the other, and a
# shared label would blur exactly the grouping the module docstring's
# evidence-is-about-one-deployment paragraph exists to keep. Declared
# here with zero runs citing it: the owner has signed in on sit once,
# and nothing this file can read says what that sign-in established, so
# RUNS stays silent about it rather than guessing, and report() names
# the arm as unproven rather than omitting it.
ARMS = ("development", "sit", "production")

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
#
# No "sit has no published origin" cause is registered here, because
# server/wrangler.toml's [env.sit.vars] names one (0.9-M1-S3, #329) and
# a cause nothing in the ledger stands on is exactly what
# dev/check_live.test.py's "every registered cause is carried by at
# least one entry" refuses to let sit quietly. "The Telegram widget
# rendering and its callback" reads "off-machine" below for the same
# reason: the origin existing is not BotFather's /setdomain having
# been run, so the row still needs a cause nothing here can corroborate.
CAUSES = {
    "guarded-branch": {
        "guard": True,
        "checked": True,
        "why": "the development arm takes a branch production will not, "
               "so it exercises the wrong side of a guard",
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
#
# Two rows currently rest on something no file here can check: one
# "production-secret" row on the production id list and account secret,
# and "the Telegram widget rendering and its callback", whose cause is
# "off-machine" rather than something server/wrangler.toml's
# ALLOWED_ORIGINS shape can corroborate, because BotFather's /setdomain
# is an owner act no shell here can perform or see the result of
# (0.9-M1-S3, #329).
#
# It came down from four when the development sign-in's route was removed
# and its production-secret row went with it (0.9-M2-S1, #352), and from
# three when the key fingerprint members were asked to compare went with
# the client seal (0.9-M2-S5, #356). That is the ratchet working in the
# direction it is built for: deleting the mechanism is the cheapest way a
# trusted claim ever stops being owed.
UNCORROBORATED_CEILING = 2

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
    # The two POST /auth/dev rows retired with the route (0.9-M2-S1,
    # #352). spine_problems() below is what made that mandatory rather
    # than tidy: it fails in BOTH directions, so a ledger row for a
    # surface server/worker.js no longer dispatches reddens this stage.
    # Their evidence is not lost - it is in the git history of this file
    # and in that slice's pull request - and keeping the rows would have
    # meant carrying live evidence about a route nobody can call.
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
        "claim": "a member's listing carries their own rows and "
                 "nobody else's, newest first, each one OPENED by the "
                 "Worker from its at-rest ciphertext (0.9-M1-S6, "
                 "#332). tests/entry-rows.test.mjs drives the whole "
                 "lifecycle against the real format, so the seal, the "
                 "open and the account scoping are covered off-line. "
                 "The half that stays live-only is D1 applying the "
                 "ORDER BY and the LIMIT: every sequence the arm "
                 "compares against is produced by a sort in the arm, "
                 "and the cap is a slice of rows a stub already held "
                 "rather than a database that stops reading",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "GET /my-entries, after the session is revoked",
        "surface": "route",
        "claim": "a token captured before Sign out reads nothing "
                 "after it. The route now serves a member's whole "
                 "history as PLAINTEXT (0.9-M1-S6, #332), so what a "
                 "stale token would reach is the readable record "
                 "rather than bytes needing a key - which raises what "
                 "this row is worth rather than changing what it "
                 "tests. A stub cannot falsify this half: it deletes "
                 "a row from an array, which proves the route "
                 "re-resolves the caller every call and proves "
                 "nothing about D1 removing the row. Capture the "
                 "token first, sign out, replay it",
        "covers": ["server/worker.js", "apps/web/signout.js"],
        "status": "never",
    },
    {
        "id": "POST /submit",
        "surface": "route",
        "claim": "the WORKER seals a submitted record and the row "
                 "reaches D1 openable under STORE_SECRET, and a "
                 "correction supersedes exactly one entry without "
                 "rewriting it (0.9-M1-S6, #332). The row id is "
                 "assigned before the seal and bound into the "
                 "ciphertext, so what a live run adds over "
                 "tests/entry-rows.test.mjs is D1 accepting that id "
                 "as the PRIMARY KEY and the UNIQUE index on "
                 "`supersedes` refusing a real raced correction",
        "covers": ["server/worker.js"],
        # Reclassified from "performed" by 0.9-M1-S6 (#332), which is
        # the change that falsified the evidence rather than a doubt
        # about it. The sitting recorded rows SEALED IN THE BROWSER
        # reaching the deployed database and opening under the
        # deployment's key - a client-seal path this slice retires. The
        # route it exercised does not exist to be re-checked, so the
        # honest state is that the route as it now stands has never run
        # against a real database. It needs STORE_SECRET set on sit
        # first, which is the operator act this slice does not perform.
        "status": "never",
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
        "id": "GET /charts-data",
        "surface": "route",
        "claim": "the Worker aggregates the whole corpus on request and "
                 "answers one measure over the filters it was given - "
                 "the trend, the "
                 "fixed-band distribution and the group makeup - with "
                 "the floor the settings hold already applied (0.9-M2-"
                 "S0, #351; reshaped by 0.9-M2-S10, #371, to the owner's "
                 "charts ruling at #243 comment 5346978974). "
                 "tests/charts-aggregate.test.mjs decides every "
                 "disclosure rule off-line against real seals - the "
                 "shipped floor of 0 drawing every cell, band and month "
                 "at its true value, the band edges coming from the "
                 "spec and never from the data, the group makeup's "
                 "unique-member counting, and the whole suppression "
                 "machinery re-proved at a raised floor - so the rules "
                 "themselves need no live run. THREE HALVES STAY "
                 "LIVE-ONLY, and each is a "
                 "database or a platform doing something a stub cannot "
                 "be wrong about: D1 applying the NOT EXISTS tombstone "
                 "predicate over real rows rather than an array filter "
                 "the arm wrote; D1 applying the ORDER BY and the "
                 "MAX_AGGREGATE_ROWS cap, which is the one place a "
                 "chart could be drawn from part of a history without "
                 "saying so; and the CPU an aggregation really costs, "
                 "since every current row is opened per request and a "
                 "Worker has a limit a Node process does not. Read one "
                 "measure with a filter and without, on a corpus with "
                 "several members and a correction among them, and "
                 "watch the no-store header arrive",
        "covers": ["server/worker.js", "server/charts-agg.js"],
        "status": "never",
    },
    {
        "id": "GET /charts-data, combined filters",
        "surface": "route",
        "claim": "the multi-select filter shape the chips send "
                 "(0.9-M3-S31, #455, generalizing 0.9-M3-S24's #438 to "
                 "the chips ruled at #454 items 16-18): repeated "
                 "`filter=`/`value=` pairs, paired by position, SEVERAL "
                 "pairs allowed to name one field and forming that "
                 "field's set, at most MAX_FILTER_PAIRS pairs per "
                 "request, aggregated over the population that holds "
                 "one of each named field's values - OR within a "
                 "field, AND across fields. "
                 "tests/charts-aggregate.test.mjs sections 10 and 11 "
                 "decide every rule of it off-line against real seals - "
                 "the union and the intersection on fixtures where the "
                 "two numbers differ, the identity between a set "
                 "naming every value of a field and no set at all, the "
                 "refusals (a duplicate value in one set, an unpaired "
                 "name, a value the effective spec no longer offers, "
                 "one pair past the cap), the floor applied to a union "
                 "and to an intersection exactly as to the whole, and "
                 "the disclosure claim that an ask matching one member "
                 "and an ask matching nobody come back as the same "
                 "document across all twenty-seven pairs of sets. WHAT "
                 "STAYS LIVE-ONLY is "
                 "the CPU a multi-predicate aggregation really costs on "
                 "a Worker: every current row is opened per request and "
                 "each named field is another read per person, so the "
                 "shape of the answer is proven off-line but its cost "
                 "under a real platform limit is not. Send two chips, "
                 "then a field's whole set, then the cap's worth of "
                 "pairs against a corpus with "
                 "several members, and watch one answer come back "
                 "inside the limit",
        "covers": ["server/worker.js", "server/charts-agg.js"],
        "status": "never",
    },
    {
        "id": "GET /charts-data, the present-values list",
        "surface": "route",
        "claim": "the group-makeup block is where a page learns which "
                 "values a big list should offer (0.9-M3-S31, #455 "
                 "scope 4, serving the owner's ruling at #454 item 18): "
                 "a line whose count is above zero and whose value is "
                 "not null, the blank and the pooled bucket being "
                 "keyed by null and neither of them a value. Because "
                 "those cells are floored before they leave, presence "
                 "obeys the floor with no rule of its own - a value too "
                 "few members hold has no line, so it is never offered "
                 "as a filter. tests/charts-aggregate.test.mjs section "
                 "11e arms both directions on one corpus: at the "
                 "shipped floor of 0 the list is exactly what the group "
                 "holds, and at a raised floor the value one member "
                 "holds is gone from it while the block still names "
                 "another. WHAT STAYS LIVE-ONLY is what a REAL group's "
                 "list looks like: the country codes a real membership "
                 "holds are the one input no fixture can stand for, and "
                 "0.9-M3-S14's drop list is built from them. Read the "
                 "group-makeup block of an unfiltered view against a "
                 "corpus with several countries in it and check the "
                 "list a member is offered against the codes really "
                 "entered",
        "covers": ["server/worker.js", "server/charts-agg.js"],
        "status": "never",
    },
    {
        "id": "DELETE /submission/{}",
        "surface": "route",
        "claim": "a member removes one of their OWN rows and an admin "
                 "removes anyone's, and nothing beside it moves "
                 "(0.9-M1-S6, #332). The live half a stub cannot "
                 "reach is that a member's delete carries its account "
                 "clause into D1: a stub filters an array, so it "
                 "proves the statement was sent scoped and proves "
                 "nothing about the database honoring it",
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
    # The door read added at 0.9-M3-S8 (#414). Unlike the two /content
    # rows above, this one HAS a consumer coming: the admin page (#416)
    # writes the three names and the door reads them, so what a sitting
    # can establish is the whole round trip - set the group name, load
    # the door signed out, see it. That page is a parallel slice, so the
    # row is owed rather than performed, and the claim is written
    # against what a run will actually be able to see.
    {
        "id": "GET /config",
        "surface": "route",
        "claim": "the three public names come back with no credential "
                 "at all, and nothing else in site_content does - a "
                 "floor set on the same deployment is absent from this "
                 "answer, which is the allow-list holding against real "
                 "rows rather than against a stub's",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "GET /admin-log",
        "surface": "route",
        "claim": "an admin write on a real deployment leaves one line "
                 "with the actor it really had, and the same read as a "
                 "member session is 401 with lines in the table to "
                 "withhold. The half a stub cannot reach is the "
                 "ordering: `at` ties inside one millisecond and the "
                 "tiebreak is SQLite's own rowid, so newest-first is a "
                 "claim about D1 rather than about an array sort",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    # The form builder added at 0.9-M3-S11 (#419). The three rows below
    # are owed rather than performed because the pages that drive them
    # are parallel slices, and each claim is written against what a
    # sitting will actually be able to see once they land.
    {
        "id": "GET /spec",
        "surface": "route",
        "claim": "with nothing in the overlay the answer is the shipped "
                 "spec byte for byte, on a real deployment reading a "
                 "real table rather than a stub's empty result - and a "
                 "caller with no session gets 401 while rows exist to "
                 "withhold",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "PUT /admin-fields/{}",
        "surface": "route",
        "claim": "an admin adds a categorical field on a real "
                 "deployment, a member's form and the charts' filter "
                 "chips offer it on the next load with no release, and "
                 "the change log carries the line. The half a stub "
                 "cannot reach is D1's own text handling, in two "
                 "places. The LIKE that splits the field namespace off "
                 "from the site copy folds, so whether a hand-written "
                 "`Field.Gender` row lands on the same side of that "
                 "split as `field.gender` is a claim about SQLite; and "
                 "`ORDER BY name` decides which of two rows composing "
                 "onto one id is read last, which the arms pin to "
                 "BINARY because that is D1's collation. A stub can "
                 "state both and only a running deployment can settle "
                 "them",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "DELETE /admin-fields/{}",
        "surface": "route",
        "claim": "retiring a field takes it out of the form and the "
                 "charts while every sealed row keeps the answers "
                 "members gave it, read back byte for byte out of a "
                 "real `submissions` table - and un-retiring brings the "
                 "field back with its values",
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
    # THE ONE ROW HERE WHOSE CLAIM IS NOT THE SAME SENTENCE ON BOTH
    # SIDES OF THE NEXT `server/` DEPLOY, which is why it says which
    # guard it describes. This repository's guard counts grants and not
    # rows: handleDeleteMembership holds back the last `admin` row an
    # authority read would obey, and spares a row that grants nobody
    # anything - so a table whose only `admin` row is one of those lets
    # go of it. A Worker deployed before that narrowing counts every
    # `admin` row instead and refuses exactly that removal, so the
    # second half of this claim reads 409 there. Whoever performs this
    # row reads the guard off the deployment they are pointed at rather
    # than off this checkout, or they file a defect against the version
    # skew - which is the same trap OPERATIONS.md flags at the flip's
    # first condition, arriving here because the ledger is where a live
    # claim nobody could perform is supposed to live. Production is
    # further back still: it carries no `/membership` routes at all
    # until the cutover takes them.
    {
        "id": "DELETE /membership/{}/{}",
        "surface": "route",
        "claim": "the last `admin` row that grants cannot be removed, "
                 "while a row that grants nothing comes off whenever an "
                 "admin presses Remove - including when it is the only "
                 "`admin` row the table has left, which is the half a "
                 "Worker older than the narrowing refuses",
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
    # `form.js` stands under this row because form.js is the file that
    # does the sealing the `how` describes. Left out, a change to what an
    # entry seals to would leave this claim reading fresh against a page
    # and a panel that had not moved - and #85 is the change that made
    # form.js's seal variable at all, so the omission stopped being free
    # on the day the branch landed.
    {
        "id": "your-page.html",
        "surface": "page",
        "claim": "the form round-trips to a live Worker",
        "covers": ["apps/web/your-page.html", "apps/web/submit.js",
                   "apps/web/form.js"],
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
    # "your-page.html, the member's own seal" stood here and is RETIRED
    # (0.9-M2-S5, #356). It was #85's headline claim - an entry a real
    # browser sealed, opening under the device key that browser
    # generated - and it is retired for the reason a row is ever retired
    # here rather than moved to `never`: its subject left. There is no
    # member device key, no client seal and no apps/web/memberkey.js to
    # file one away with; the Worker seals what it stores (DESIGN.md,
    # "Trust model: the Worker reads"), and tests/store-crypto.test.mjs
    # is where that is proven. A `never` row for a mechanism that no
    # longer exists reads as an outstanding verification debt forever,
    # which is the opposite of what this ledger is for.
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
    # Both rows below were "performed" for the pre-0.9 page: a member
    # session reading the published snapshot, and the same forged-token
    # 401 rehearsal every gated page gets its own row for. 0.9-M2-S3
    # (#354) rebuilds the page around GET /charts-data instead - apps/web/
    # public.js is gone with the snapshot it read - so both claims are
    # now about a page nobody has driven live yet, and RESET to "never"
    # rather than left "performed" against a page that no longer
    # exists. Live-driving the rebuilt page is real debt this table
    # keeps rather than one this slice happens to owe: neither claim
    # was reachable from an isolated agent worktree with no credential.
    {
        "id": "charts.html",
        "surface": "page",
        "claim": "a member session draws a real figure from GET "
                 "/charts-data - the filter and measure controls, a "
                 "picture toggle that reads one cached answer twice, "
                 "and the honest not-enough sentence on a floored cut. "
                 "AND THE PAGE IS REACHABLE AT ITS OWN URL: navigating "
                 "to charts.html follows the assets layer's redirect to "
                 "/charts and lands on HTML, not on a route's JSON "
                 "(0.9-M2-S8, #365 - the route moved to /charts-data)",
        "covers": ["apps/web/charts.html", "apps/web/charts.js"],
        "status": "never",
    },
    {
        "id": "charts.html, a live 401",
        "surface": "page",
        "claim": "a refused session says so where the page stands, "
                 "rather than redirecting - matching your-page.html's "
                 "and admin.html's own live-401 rows, each in the "
                 "words their page uses",
        "covers": ["apps/web/charts.html", "apps/web/charts.js"],
        "status": "never",
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

    # ---- exports: the surface #394 opens (fleet-review-M2.md, S14's
    # F4). The site hands a browser a real file, and the ledger's spine
    # stops at the page unless a row forces each real download into
    # existence off the MIME type its Blob call carries - see the module
    # docstring's "export spine forces on a MIME type" paragraph.
    #
    # THE ADMIN CSV/XLSX/JSON ROWS RETIRED 0.9-M3-S10 (#416). The entry
    # exports left with the keyfile tool (Prime's ruling on this
    # ticket's own fork, 2026-08-21, reading #385 §4: no admin surface
    # exposes a current member's data) - admin.js's own Blob() calls are
    # gone, so export_locations() no longer derives these ids and a row
    # for them would be exactly the "reassuring count outlives the
    # thing it counts" failure this ledger exists to refuse (this
    # file's own freshness() docstring).
    {
        "id": "submit.js: xlsx export",
        "surface": "export",
        "claim": "a real click on your-page's download button produces "
                 "a workbook a real spreadsheet application opens and "
                 "reads back as the member's own entries, in "
                 "DOWNLOAD_COLUMNS' order, under the date-stamped "
                 "filename the page names it",
        "covers": ["apps/web/submit.js"],
        "status": "never",
    },
    {
        "id": "charts.js: xlsx export",
        "surface": "export",
        "claim": "a real click on the charts download button produces "
                 "a workbook whose rows match the figures drawn on "
                 "screen at the moment of the click, with any country "
                 "or group label BinderXlsx.build() writes landing as "
                 "a string rather than a formula it runs - the same "
                 "typing guard the admin xlsx export carries, proved "
                 "here on a workbook built from an aggregate answer "
                 "rather than raw entries",
        "covers": ["apps/web/charts.js"],
        "status": "never",
    },

    # ---- flows: voluntary rows, seeded from the cutover review pack's
    # Tier A and the dev-arm rehearsal's ledger. Nothing forces one into
    # existence; these are the largest debts stated as data so the query
    # answers the question the owner actually asks. A flow is also where
    # a discharged claim lands when it is about no single route and no
    # single page - the origin gate is in front of every route, and the
    # signed-out bounce is a property of the pages together.
    # THE TWO ROWS BELOW LOST A THIRD OF THEIR CLAIM AT 0.9-M2-S8
    # (#365). Each said "no origin at all is refused in bytes identical
    # to a foreign origin", and each was honestly performed against a
    # Worker where that held. It no longer does, on purpose: an absent
    # Origin is what every same-origin read looks like, and refusing it
    # refused the site every read of its own pages. The two halves that
    # ARE still true - a foreign origin refused, the allowed origin
    # admitted as far as the route's own 401 - keep their evidence,
    # because that evidence is still about the shipped behavior. The
    # third state is not silently dropped: it is its own `never` row
    # below, which is the ledger's whole point.
    {
        "id": "the origin gate, both refusals it still makes",
        "surface": "flow",
        "claim": "an allowed origin reaches the handler and is refused "
                 "on its credential, while a foreign origin is refused "
                 "by the gate itself",
        "covers": ["server/worker.js", "server/wrangler.toml"],
        "status": "performed",
        "performed": dict(
            REHEARSAL,
            how="GET /snapshot answered 401 for http://127.0.0.1:8124 "
                "and for http://localhost:8124, and 403 for "
                "https://potaetoe.github.io. The pair is the check: the "
                "401 alone cannot tell a working gate from a Worker "
                "that allows everything. http://127.0.0.1:8130 - a "
                "delegated slice's own assigned port - also answered "
                "403, which is the mechanical reason live verification "
                "has been unreachable from every slice but the one "
                "holding 8124. The same probe also drove a request with "
                "NO Origin header and read 403; that answer is not "
                "carried here, because 0.9-M2-S8 (#365) makes it 401 "
                "and the absent-Origin state is its own row below. GET "
                "/snapshot is retired (0.9-M2-S3, #354, deletion not "
                "gating), so this exact probe cannot be reissued - a "
                "re-verifier today runs it against GET /charts-data, "
                "the API-shaped route now standing in the gate's path"),
    },
    {
        "id": "the origin gate admits a same-origin read",
        "surface": "flow",
        "claim": "a GET carrying NO Origin header - which is what every "
                 "same-origin read and every address-bar navigation "
                 "looks like on the wire - reaches the route and earns "
                 "the route's own answer, while carrying no Access-"
                 "Control-Allow-Origin of any kind; and the same "
                 "request as a POST or a DELETE is still refused by the "
                 "gate (0.9-M2-S8, #365)",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "the origin gate on production, both refusals it still makes",
        "surface": "flow",
        "claim": "the gate in front of every route on the live "
                 "deployment refuses a foreign origin, and admits the "
                 "published origin as far as the route's own refusal",
        "covers": ["server/worker.js", "server/wrangler.toml"],
        "status": "performed",
        "performed": dict(
            PRODUCTION,
            how="GET /snapshot against the production Worker three "
                "times, differing only in the Origin header. "
                "https://example.com answered 403 "
                '{"error":"Origin not allowed."} with no CORS header of '
                "any kind; https://potaetoe.github.io answered 401 "
                "carrying Access-Control-Allow-Origin for that origin, "
                "Vary: Origin and Max-Age 86400. The pair is the check: "
                "the 403 alone cannot tell a working gate from a Worker "
                "refusing everything. The third probe, with no Origin "
                "header, also read 403; that answer is not carried "
                "here, because 0.9-M2-S8 (#365) makes it the route's "
                "own 401 and the absent-Origin state is its own row "
                "above. Read-only GETs, which is the whole of what a "
                "slice holding no credential may drive against this "
                "deployment. GET /snapshot is retired (0.9-M2-S3, "
                "#354, deletion not gating), so this exact probe cannot "
                "be reissued - a re-verifier today runs it against GET "
                "/charts-data, still read-only and still credential-"
                "free at the gate"),
    },
    {
        "id": "the signed-out bounce, with nothing announced",
        "surface": "flow",
        "claim": "a reader with no session is sent to the sign-in page "
                 "from every gated page, and no request leaves at all - "
                 "a request that earns a 401 has still announced the "
                 "reader to the Worker",
        "covers": ["apps/web/session.js", "apps/web/submit.js",
                   "apps/web/charts.js", "apps/web/admin.js"],
        "status": "performed",
        "performed": dict(
            REHEARSAL,
            how="with sessionStorage empty, your-page.html, charts.html "
                "and admin.html each sent the reader to index.html; no "
                "form, no figures and no key box painted, and the "
                "network panel stayed empty on all three. The charts.html "
                "leg was rehearsed against the pre-0.9-M2-S3 page - the "
                "call is now apps/web/charts.js's own Session.require(), "
                "unchanged in shape, but not re-rehearsed against the "
                "rebuilt page's real bytes (#354)"),
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
    # "charts painted from decrypted rows" stood here - a flow row for
    # apps/web/dashboard.js's SVG drawing, sighted once in a browser
    # against admin.html's Publish preview. RETIRED (0.9-M2-S3, #354):
    # dashboard.js is deleted with the snapshot route it drew, admin.html
    # is stated dead rather than patched, and the concern this row named
    # - a chart drawn from real data rather than asserted in Node with no
    # layout engine - now belongs to the "charts.html" row above, which
    # is `never` until the rebuilt page gets its own live sighting.
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
    # "query.js frozen in a browser engine" stood here - the row's own
    # claim already said "no page in apps/web requests it", and 0.9-M2-S3
    # (#354) deletes the file outright with the snapshot-era system it
    # served. Nothing left to be evidence about.

    # ---- flow: reachable on sit now, not yet driven.
    #
    # RECLASSIFIED 0.9-M1-S2 (#326). server/wrangler.toml's [env.sit]
    # names a real TELEGRAM_BOT_TOKEN and TELEGRAM_GROUP_CHAT_ID
    # (0.9-M1-S1, #325, the two-bot split, #228 Worker-topology
    # addendum) - the opposite of what these five rows' "guarded-
    # branch" cause stood on: that no non-production arm ever carries
    # either secret, so the guard text below always closes. cause_
    # problems() only checks that a pinned guard's text still exists in
    # server/worker.js, never whether an arm can still be forced
    # through it - the same corollary the review bar names for a check
    # computed from the file it guards - so nothing here caught the
    # premise breaking; it is a judgment call, argued and recorded here
    # instead. BotFather's /setdomain for sit is also run (#282, closed
    # 2026-08-18), so the last off-machine precondition these flows
    # needed is met too. "guarded-branch" is gone from all five: sit
    # can take the right side of every guard listed below now, so
    # "first-contact" - permanently unreachable before production - is
    # the wrong column.
    #
    # Still not "performed." The owner has signed in on sit once, but
    # no date, head or account of what that sign-in actually drove is
    # written down anywhere this file can cite, and status_problems()
    # below requires exactly that triple for a performed claim, on
    # purpose - a row does not get marked discharged on a fact nobody
    # recorded. "never" is the honest middle: reachable, owed, counted
    # in the cadence line rather than sitting outside it as a permanent
    # risk. Discharging one for real means editing it here with the
    # date, the head and what actually ran, the same act that
    # discharges every other "never" row in this ledger.
    {
        "id": "telegram sign-in past the bot-token guard",
        "surface": "flow",
        "claim": "signature verification, the freshness window, the "
                 "no-username refusal and minting an admin all run for "
                 "real the moment a Telegram account signs in on sit, "
                 "which now carries a bot token able to verify one",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "the group check answering member, left or unknown",
        "surface": "flow",
        "claim": "sit carries a real chat id now, so the group check "
                 "can answer member, left or unknown for a real "
                 "Telegram account rather than always falling to the "
                 "unconfigured branch",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "one payload, one session",
        "surface": "flow",
        "claim": "a payload spent once is refused the second time, so a "
                 "captured one cannot mint a session beside the "
                 "member's own inside the freshness window",
        "covers": ["server/worker.js"],
        # Still nothing local reaches this: it runs after a payload
        # HMAC-signed under a real bot token has verified, which the
        # row above this one covers. The suite drives it against a
        # stub, and a stub is not a D1 primary key - what stays
        # unobserved is SQLite refusing the second INSERT. A real
        # sign-in on sit discharges it by posting one captured payload
        # twice, the same operator act the row above needs.
        "status": "never",
    },
    {
        "id": "a leaver's live sessions revoked",
        "surface": "flow",
        "claim": "revocation fires from one place, on a standing only a "
                 "real group check can produce - reachable now that "
                 "sit's chat id is real, and not yet driven",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "membership rows granting authority rather than listing",
        "surface": "flow",
        "claim": "every consumption site of that table sits inside the "
                 "Telegram sign-in, which sit can now complete for "
                 "real, so a membership row can carry actual authority "
                 "instead of being inert",
        "covers": ["server/worker.js"],
        "status": "never",
    },

    # ---- first contact: permanently unreachable before production.
    # Not debt. A row here is a risk that survives a perfect rehearsal,
    # and every one of them is the identity half of the design.
    #
    # No row here moves on a rehearsal, by construction - a sitting that
    # discharged one would be a sitting that had falsified the reason
    # the row is here, and the pinned guards are what would say so.
    #
    # The five rows on the no-real-bot premise are reclassified in the
    # flow section above (0.9-M1-S2, #326); see that section for the
    # reasoning. The row immediately below rests on a DIFFERENT premise
    # sit does not break: it deliberately carries no ADMIN_TELEGRAM_IDS
    # and no ALWAYS_ALLOW_TELEGRAM_IDS (DESIGN.md's no-admin-list design,
    # scheduled for retirement at 0.9-M3 per 0.9-M1-S5, #331, which found
    # neither reachable on sit either). Nothing here reclassifies it.
    #
    # A third row sat here on the development sign-in's secret, and it is
    # gone with the route (0.9-M2-S1, #352) rather than reclassified.
    # That is the one exit from this list nobody has to negotiate: a
    # permanent risk stops being one when the code that carried it does.
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
    # RECLASSIFIED 0.9-M1-S3 (#329). server/wrangler.toml's
    # [env.sit.vars] now names sit's own published origin beside
    # localhost - the fact "published-origin-only" existed to describe
    # the ABSENCE of - so origin_problems() below would fail this row's
    # old cause the moment that origin landed (mutation evidence: this
    # is the corroborating check for the cause, and it is exactly what
    # went red first). The claim did not become true: BotFather /
    # setdomain is still unrun (#282 stays open on it), so nothing here
    # can show the widget actually works against sit yet - only WHY it
    # cannot answered differently. "off-machine" is the honest reason
    # now: what is missing is an owner act in BotFather's own UI, not a
    # config value this repository can see. This is the one row #329's
    # own completion reclassifies; the six rows below still reading
    # "guarded-branch" rest on a DIFFERENT premise (sit's bot token,
    # not its origin) and are untouched here - #326 is theirs.
    {
        "id": "the Telegram widget rendering and its callback",
        "surface": "flow",
        "claim": "BotFather binds the widget to the published origin, "
                 "so the frame and the session it mints are reachable "
                 "from nowhere else",
        "covers": ["apps/web/index.html"],
        "status": "first-contact",
        "cause": "off-machine",
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
    # "the submit page fingerprint against the pinned message" stood here
    # and is RETIRED (0.9-M2-S5, #356). Nobody is asked to compare a
    # fingerprint any more: DESIGN.md's "Trust model: the Worker reads"
    # retired the admin key box, the key fingerprint and the whole
    # compare-it-yourself ceremony with them, and your-page.html carries
    # no slot to print one into. The row's subject left, so the row goes
    # rather than sitting as a first-contact debt against a ritual that
    # will never happen.
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
# The export spine, read off a literal MIME type rather than a         #
# dispatch line or a file listing - see the module docstring's         #
# "export spine forces on a MIME type" paragraph for why neither of    #
# route_ids()'s or page_names()'s tricks reaches this surface.         #

# Anchored, not a bare substring: `"text/csv[^"]*"` still matches a
# charset suffix, but the xlsx pattern closes on the exact quote a
# download's Blob type ends on, so it does not fire on
# `...spreadsheetml.sheet.main+xml"`, xlsx.js's own Content-Type string
# for the workbook part - one part-type longer, and the reason a bare
# `"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
# prefix match would have been wrong. The json pattern requires a
# charset parameter for the opposite reason: admin.js's own fetch calls
# send `"Content-Type": "application/json"` with no charset at all
# (apps/web/admin.js, apps/web/auth.js, apps/web/form.js all do), so a
# bare-prefix match here would have forced a row off an API request
# rather than off the one download that actually carries a charset.
EXPORT_MIME = (
    ("csv", re.compile(r'"text/csv[^"]*"')),
    ("xlsx", re.compile(
        r'"application/vnd\.openxmlformats-officedocument\.'
        r'spreadsheetml\.sheet"')),
    ("json", re.compile(r'"application/json;charset=[^"]*"')),
)


def export_families(source):
    """The MIME families a source string carries, in EXPORT_MIME order.

    Pure - a string in, families out - so a fixture drives it without
    touching the tree, the same reason route_ids() takes a source
    string rather than reading server/worker.js itself.
    export_locations() below is what wires this to the real files.

    Comments are blanked first (check_web.strip_js_comments) so a MIME
    literal that survives only in a comment - the CSV download deleted,
    the string left behind in a `//` note about it - cannot keep
    forcing a row for an export nobody can press. The fix wave that
    added this found the gap concretely: a stale row read `47 rows,
    OK` while the page it described no longer offered a download
    (0.9-M3-S6 fix wave 1, #394, F2).
    """
    blanked = check_web.strip_js_comments(source)
    return [family for family, pattern in EXPORT_MIME
            if pattern.search(blanked)]


# Bounded lookahead rather than an unbounded one: `[\s\S]` already
# spans newlines with no re.S flag needed, but a Blob() call whose type
# argument is a variable rather than a literal - admin.js's now-retired
# `offer()` passed one, `type: type`, until 0.9-M3-S10 (#416) removed it
# with the exports it built - has to stop the search from reading on
# into some later, unrelated `new Blob(` call and misattributing its
# type. Nothing in the tree needs that guard today; the bound stays
# because the shape it guards against is a property of the regex, not
# of admin.js, and every real call still closes its type argument
# within a couple of lines regardless.
BLOB_TYPE_LITERAL = re.compile(r'new Blob\([\s\S]{0,300}?type:\s*"([^"]*)"')


def blob_mime_types(source):
    """Every literal MIME type passed straight to a `new Blob(` call.

    Pure, and comments blanked first for the same reason
    export_families() blanks them. Every `new Blob(` call in the tree
    today (submit.js, charts.js) passes its type as a literal, so this
    function and export_families() currently agree on every export the
    tree carries; the two stayed split because a variable type - the
    shape BLOB_TYPE_LITERAL above is built to skip past, `type: type` -
    is not a choice only one function in this tree could ever make.
    This function reads a literal type INSIDE the call, which is what
    unrecognized_blob_types() below has to classify or refuse rather
    than silently miss.
    """
    return BLOB_TYPE_LITERAL.findall(check_web.strip_js_comments(source))


def unrecognized_blob_types(source):
    """[mime, ...] for source's literal Blob() types no family recognizes.

    Pure, the same shape as export_families() and blob_mime_types()
    above it stands on. export_families() is silent about a MIME type
    outside EXPORT_MIME by design - that is right for anything not
    actually building a download, such as a fetch header's Content-
    Type, which this function never sees because it is never inside a
    `new Blob(` call's own parentheses. A literal MIME type that IS
    inside one is a download, though, and a download this ledger
    cannot classify is not the same as a download that does not exist:
    the review that opened this function proved the gap by injecting
    five (application/pdf, .zip, plain text, text/calendar,
    application/octet-stream) into apps/web/charts.js and watching the
    gate stay green (0.9-M3-S6 fix wave 1, #394, F1).
    """
    return [mime for mime in blob_mime_types(source)
            if not any(pattern.search('"%s"' % mime)
                       for _, pattern in EXPORT_MIME)]


def export_locations():
    """{export id: apps/web file} for every real file export in the tree.

    One row per (file, family): submit.js and charts.js each carry one
    (xlsx), so it yields two ids today. admin.js's own three (csv,
    xlsx, json) retired with the exports themselves at 0.9-M3-S10
    (#416). The id names the file and the family rather than the
    button or the export's own prose, because neither of those is
    derivable from the MIME type alone - deriving less is deriving
    something the next export cannot silently defeat by being named
    differently.
    """
    found = {}
    for name in sorted(os.listdir(WEB)):
        if not name.endswith(".js"):
            continue
        source = read(os.path.join(WEB, name))
        for family in export_families(source):
            found["%s: %s export" % (name, family)] = "apps/web/%s" % name
    return found


def export_class_problems():
    """FAIL text for every real file's unrecognized Blob() export class.

    The real-tree wiring for unrecognized_blob_types() above, the same
    split export_locations() keeps from export_families(): the pure
    rule takes a fixture, this walks apps/web/*.js and reports.
    """
    problems = []
    for name in sorted(os.listdir(WEB)):
        if not name.endswith(".js"):
            continue
        source = read(os.path.join(WEB, name))
        for mime in unrecognized_blob_types(source):
            problems.append(
                "apps/web/%s hands the browser a file through new "
                "Blob() typed %r, an export class the live-"
                "verification ledger does not know. Register it - add "
                "%r's family to EXPORT_MIME in tools/check_live.py - "
                "or, if it should not be a real download, drop the "
                "literal MIME type from that Blob() call"
                % (name, mime, mime))
    return problems


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

    Only the three forced surfaces. Nothing enumerates a flow, so
    nothing here can say which files one ought to name, and a rule that
    guessed would be a rule the next flow row argues with.
    """
    if row.get("surface") == "route":
        return ["server/worker.js"]
    if row.get("surface") == "page":
        return ["apps/web/%s" % route_of(row.get("id", ""))]
    if row.get("surface") == "export":
        path = export_locations().get(row.get("id", ""))
        return [path] if path else []
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


def spine_problems(ledger, routes, pages, exports):
    """The forcing rule: the code decides what the ledger must contain.

    Both directions, over all three forced surfaces. A surface with no
    row is the failure #157 is about; a row for a surface that has left
    is how a reassuring count outlives the thing it counts. `exports` is
    export_locations()'s {id: file} shape, unlike `routes` and `pages` -
    a route always stands on server/worker.js and a page always stands
    on its own name, but an export's file varies with which of three
    files carried its MIME type, so the row-to-add message needs it
    named rather than assumed.
    """
    problems = []
    claimed = {"route": set(), "page": set(), "export": set()}
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

    for export_id, path in exports.items():
        if export_id not in claimed["export"]:
            problems.append(
                "%s hands the browser a real file and the live-"
                "verification ledger has no row for it (%s). Add to "
                "LEDGER in tools/check_live.py:\n"
                '        {"id": "%s", "surface": "export",\n'
                '         "claim": "<what a live run would establish>",\n'
                '         "covers": ["%s"],\n'
                '         "status": "never"},'
                % (path, export_id, export_id, path))

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
        if row.get("surface") == "export" and route_of(rid) not in exports:
            problems.append(
                "ledger row %r claims a file export apps/web no longer "
                "hands the browser; a ledger holding rows for exports "
                "that have left counts the wrong thing" % rid)

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


def cause_problems(ledger, worker_source):
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

    Took a `blocks` parameter (server/wrangler.toml's parsed vars
    blocks) through 0.9-M1-S3: the only reader was origin_problems(),
    retired the same slice along with the "published-origin-only" cause
    it alone corroborated - see the note above CAUSES.
    """
    problems = []
    uncorroborated = 0

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

    if uncorroborated > UNCORROBORATED_CEILING:
        problems.append(
            "%d first-contact rows rest on something no file in this "
            "repository can check, and the ceiling is %d. Raising it is "
            "allowed and is meant to be a line somebody reads: every "
            "row here is a claim taken on trust. Pin one to source, "
            "perform one, or say in the diff why the trust grew."
            % (uncorroborated, UNCORROBORATED_CEILING))

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

    found = entry_problems(LEDGER)
    found += spine_problems(LEDGER, routes, page_names(), export_locations())
    found += export_class_problems()
    found += cause_problems(LEDGER, source)
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
