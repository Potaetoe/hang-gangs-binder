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

**The cadence is measured, not enforced.** A stage that reddens on a
date, or on a merge count, would block work the failing slice cannot
unblock: the batch needs port 8124 (server/wrangler.toml pins the
development origins to it) and it needs secrets, so it is owner-only by
capability rather than by preference. `--report` states how far behind
the record is and what is due; the exit code stays with the four
structural rules.
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

# The batch is due when the debt reaches this, or before any cutover,
# whichever comes first. Chosen against two measured numbers rather than
# taste: #157's gap was thirty pull requests, and the dev-arm rehearsal
# measured a ninety-minute sitting that discharges about nineteen items.
# A threshold above that turns the batch into a project; well below it
# turns a cheap redeploy into ceremony.
CADENCE_THRESHOLD = 15

# The ledger. `covers` names the files a row's evidence stands on, so a
# performed row goes stale when they move - see stale() for why that is
# derived at read time rather than stored.
#
# A route row's id is the route as the router spells it, optionally
# followed by ", <qualifier>" when one route wants more than one claim.
LEDGER = [
    # ---- routes: the surface that is inert until something is
    # deployed. Every one of these is currently debt, which is #157's
    # headline stated as data rather than as a sentence.
    {
        "id": "OPTIONS *",
        "surface": "route",
        "claim": "the preflight answers 204 for an allowed origin and "
                 "403 for a foreign one, which every browser POST "
                 "below depends on",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "POST /auth/telegram",
        "surface": "route",
        "claim": "with no bot token configured the route answers a "
                 "clean 401 rather than throwing",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "POST /auth/dev",
        "surface": "route",
        "claim": "a development sign-in mints a real session, and a "
                 "wrong secret answers 404 rather than 401",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "DELETE /session",
        "surface": "route",
        "claim": "signing out ends the row server-side, not only the "
                 "local copy",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "GET /me",
        "surface": "route",
        "claim": "the member panel reads its effective and superseded "
                 "counts back from stored rows",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "POST /submit",
        "surface": "route",
        "claim": "a sealed row reaches D1, and a correction supersedes "
                 "exactly one entry",
        "covers": ["server/worker.js"],
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
        "id": "POST /snapshot",
        "surface": "route",
        "claim": "publishing writes a document carrying no handles and "
                 "no individual rows",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "GET /snapshot",
        "surface": "route",
        "claim": "the published document is members-only and refuses a "
                 "signed-out reader",
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
        "status": "never",
    },
    {
        "id": "POST /content",
        "surface": "route",
        "claim": "an admin override reaches the page that reads that "
                 "name",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "DELETE /content/{}",
        "surface": "route",
        "claim": "unsetting an override brings the shipped copy back "
                 "intact, rather than publishing a blank",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "GET /membership",
        "surface": "route",
        "claim": "the listing separates membership from malformed and "
                 "never mixes the two",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "POST /membership",
        "surface": "route",
        "claim": "a development session may not write an admin row, "
                 "and is refused in the same bytes as everything else",
        "covers": ["server/worker.js"],
        "status": "never",
    },
    {
        "id": "DELETE /membership/{}/{}",
        "surface": "route",
        "claim": "the last admin row cannot be removed, and a row "
                 "spelled in the wrong case still can",
        "covers": ["server/worker.js"],
        "status": "never",
    },

    # ---- pages: apps/web is copied verbatim to the published site, so
    # every page's live behavior is unexercised until it is served from
    # somewhere a Worker will answer.
    {
        "id": "index.html",
        "surface": "page",
        "claim": "the sign-in page reaches a live Worker and lands a "
                 "signed-in member on the submit page",
        "covers": ["apps/web/index.html"],
        "status": "never",
    },
    {
        "id": "submit.html",
        "surface": "page",
        "claim": "the form round-trips to a live Worker, and a live "
                 "401 clears the token and sends the reader back",
        "covers": ["apps/web/submit.html", "apps/web/submit.js"],
        "status": "never",
    },
    {
        "id": "dashboard.html",
        "surface": "page",
        "claim": "the published figures paint from a real snapshot, "
                 "and a live 401 says so in the page rather than "
                 "redirecting",
        "covers": ["apps/web/dashboard.html", "apps/web/public.js"],
        "status": "never",
    },
    {
        "id": "admin.html",
        "surface": "page",
        "claim": "the page that holds the whole corpus in the clear "
                 "has never been opened in a browser at all",
        "covers": ["apps/web/admin.html", "apps/web/admin.js"],
        "status": "never",
    },
    {
        "id": "404.html",
        "surface": "page",
        "claim": "the page says so plainly, offers one way back, and "
                 "requests nothing off-origin",
        "covers": ["apps/web/404.html"],
        "status": "never",
    },

    # ---- flows: voluntary rows, seeded from the cutover review pack's
    # Tier A and the dev-arm rehearsal's ledger. Nothing forces one into
    # existence; these are the largest debts stated as data so the query
    # answers the question the owner actually asks.
    {
        "id": "the import-once, return-later key flow",
        "surface": "flow",
        "claim": "the keyholder imports the development private key "
                 "once and a later visit decrypts without another "
                 "paste, against a real export",
        "covers": ["apps/web/admin.js"],
        "status": "never",
    },
    {
        "id": "charts painted from decrypted rows",
        "surface": "flow",
        "claim": "a chart is drawn from rows a live Worker returned, "
                 "rather than asserted in Node with no layout engine",
        "covers": ["apps/web/dashboard.js", "apps/web/admin.js"],
        "status": "never",
    },
    {
        "id": "the supersede guard against real D1",
        "surface": "flow",
        "claim": "the guarded insert and the UNIQUE index refuse a "
                 "second correction of one entry, against a database "
                 "rather than a hand-written stub",
        "covers": ["server/worker.js", "server/schema.sql"],
        "status": "never",
    },
    {
        "id": "the crypto module's real bytes in a browser",
        "surface": "flow",
        "claim": "both stored formats round-trip in a browser's "
                 "WebCrypto rather than only in Node's",
        "covers": ["dev/crypto-browser-check.html", "apps/web/crypto.js"],
        "status": "never",
    },

    # ---- first contact: permanently unreachable before production.
    # Not debt. A row here is a risk that survives a perfect rehearsal,
    # and every one of them is the identity half of the design.
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
        "covers": ["apps/web/submit.html"],
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

        problems.extend(status_problems(rid, row))

    return problems


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


def last_rehearsal(ledger):
    """The most recent performed evidence, or None."""
    dates = [row["performed"] for row in ledger
             if row["status"] == "performed" and row.get("performed")]
    if not dates:
        return None
    return max(dates, key=lambda evidence: evidence["date"])


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


def stale(ledger, changed=changed_since):
    """[(id, [path, ...])] for performed rows whose bytes have moved.

    Derived at read time rather than stored. A stored staleness flag is
    a second copy of a fact that git already holds, and it would rot in
    exactly the way the labels in thirty pull request bodies did.
    """
    out = []
    for row in ledger:
        if row["status"] != "performed":
            continue
        moved = changed(row["performed"]["sha"], row["covers"])
        if moved:
            out.append((row["id"], moved))
    return out


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


def report():
    lines = []
    outstanding = debt(LEDGER)
    performed = [row for row in LEDGER if row["status"] == "performed"]
    permanent = [row for row in LEDGER
                 if row["status"] == "first-contact"]

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
    for row in performed:
        lines.append("  %-8s %-46s %s, %s"
                     % (row["surface"], row["id"],
                        row["performed"]["date"], row["performed"]["how"]))
    aged = stale(LEDGER)
    for rid, moved in aged:
        lines.append("    STALE  %s - %s moved since that head"
                     % (rid, ", ".join(moved)))

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
    lines.append("  debt %d, threshold %d - the batch is due when the "
                 "debt reaches the threshold" % (len(outstanding),
                                                 CADENCE_THRESHOLD))
    lines.append("  or before any cutover, whichever comes first.")
    latest = last_rehearsal(LEDGER)
    if latest is None:
        lines.append("  No rehearsal has ever been recorded. The debt "
                     "above is the whole ledger, which is what #157 "
                     "opens by saying.")
    else:
        moved = commits_since(latest["sha"])
        lines.append("  last rehearsal %s at %s; %s commits since"
                     % (latest["date"], latest["sha"][:12],
                        moved if moved is not None else "an undetermined "
                        "number of"))
    if len(outstanding) >= CADENCE_THRESHOLD:
        lines.append("  DUE.")
    lines.append("")
    lines.append("  The batch is owner-only by capability rather than "
                 "by preference: server/wrangler.toml pins the")
    lines.append("  development origins to port 8124, which the agent "
                 "pack reserves, and the sitting needs secrets.")
    lines.append("  Discharging a row means editing it here to "
                 "\"performed\" with the date, the full head it ran at,")
    lines.append("  and what ran. The steps themselves belong in "
                 "UAT.md's live arm, not in this file.")
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
