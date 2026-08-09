"""Contract checks for the live-verification ledger.

`tools/check_live.py` holds the ledger — every surface of this project
that only a running system can exercise, each carrying a verification
status — and the rules that stop it rotting. It is what makes
#157's claim true that "what has never been tried against a running
system" is a command rather than a reading of thirty pull requests.

The failure this file is written against is the one #157 exists for.
Thirty merged pull requests each honestly wrote "live: not performed";
every label was correct and the sum was a systemic gap nobody owned.
A ledger that only describes is the same failure one layer up, so the
rules here are the ones that can go red: a route added without a row,
a page added without a row, a row that names a file no longer in the
tree, a first-contact classification whose stated reason the code has
since falsified, and a performed row citing a head no declared run
accounts for.

Rules are exercised on strings rather than on the tree they happen to
guard, for #34's reason and check_docs.test.py's: a mutation written
against a rule never exercises the reader that has to find something
before any rule can apply, and "no problem found here" and "nothing
read here" print the same sentence. The router parser therefore gets
its own strings, including the ones it must REFUSE — a dispatch line
it cannot classify is a failure, never a skip, because a parser that
filters before it refuses drops exactly the case it was written to
catch.

Each rule is watched from both sides: an arm that sees it fire, and an
arm that sees it stay silent. A check that refuses everything looks
exactly like one that refuses correctly.

No framework and no new dependency, matching the suites beside it.
"""

import os
import re
import sys

# tools/ is not a package and check_live.py is a script, so the import
# has to be made reachable before it can be named. isort would hoist
# the import above the path insertion and break it, hence the explicit
# skip - the same shape as dev/check_docs.test.py.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))

import check_live  # noqa: I001


failures = 0
performed = 0

# Asserted at the end rather than only printed. A hand-written total
# that nothing compares against still prints a confident "OK" when a
# check stops running - an early return, a renamed helper - which is
# the armed-looking-but-not failure this repository holds to be worse
# than having no check at all.
EXPECTED = 86


def check(label, condition):
    global failures, performed
    performed += 1
    if not condition:
        failures += 1
    print("pass " if condition else "FAIL ", label)


def only(problems):
    """The single problem expected, or "" when there is not exactly one.

    Indexing straight into the list would raise instead of reporting,
    and a suite that raises stops: the remaining contracts never run,
    so a mutation shows one break at a time rather than all of them.
    """
    return problems[0] if len(problems) == 1 else ""


def entry(**over):
    """A well-formed `never` entry, so each arm mutates one field."""
    base = {
        "id": "GET /me",
        "surface": "route",
        "claim": "the panel reads its own counts back from a live row",
        "covers": ["server/worker.js"],
        "status": "never",
    }
    base.update(over)
    return base


# ------------------------------------------------------------------ #
# The router parser. The spine is read out of the dispatch block       #
# because a check computed entirely from the file it guards cannot     #
# detect that the file was rearranged.                                 #

ROUTER = '''
async function route(request, env, url, allowed) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }
  const path = url.pathname;
  const method = request.method;
  if (method === "GET" && path === "/me") {
    return handleMe();
  }
  const submission = /^\\/submission\\/([^/]+)$/.exec(path);
  if (method === "DELETE" && submission) {
    return handleDeleteSubmission();
  }
  return json({ error: "Not found." }, 404, allowed);
}
'''


def routed(source):
    return check_live.route_ids(source)


ids, problems = routed(ROUTER)

check("a literal route is read out of the dispatch block",
      problems == [] and "GET /me" in ids)

check("a pattern route is read as its shape, not its regex",
      "DELETE /submission/{}" in ids)

check("the preflight is a route, and the only path-less one",
      "OPTIONS *" in ids)

check("the parser reads every dispatch line and no more",
      len(ids) == 3)

# The refusal, from both sides. A method test the parser cannot resolve
# to a route is the shape a future dispatch style arrives in, and the
# damage is silent: the spine shrinks, the completeness rule passes,
# and a route nobody has a row for looks covered.
mangled = ROUTER.replace('method === "GET" && path === "/me"',
                         'method === "GET" && matchesSomething(path)')
_, refused = routed(mangled)

check("a dispatch line the parser cannot classify is refused",
      len(refused) == 1)

check("the refusal names the line it could not read",
      "matchesSomething" in only(refused))

check("a resolvable dispatch line is not refused",
      routed(ROUTER)[1] == [])

# OPTIONS is allowed to carry no path. Nothing else is - a second
# path-less method would be a route with no shape, and guessing one is
# how a spine acquires an entry that matches nothing.
pathless = ROUTER.replace('request.method === "OPTIONS"',
                          'request.method === "HEAD"')

check("a path-less method other than the preflight is refused",
      len(routed(pathless)[1]) == 1)

# The floor, and the reason this suite exists at all: a parser that
# cannot find what it was pointed at must report rather than return
# "nothing wrong here".
check("a source with no route() at all is reported, not passed",
      len(routed("function fetch() { return 1; }")[1]) == 1)

check("the no-router report says the block was not found",
      "dispatch block" in only(routed("function other() {}")[1]))

check("a route() with no dispatch line at all is reported",
      len(routed("async function route(a) {\n  return json();\n}\n")[1])
      == 1)

badpattern = ROUTER.replace("/^\\/submission\\/([^/]+)$/",
                            "/^\\/submission\\/(?<id>.+)$/")

check("a route pattern the parser cannot render as a shape is refused",
      len(routed(badpattern)[1]) == 1)

# The real bytes, after the strings. A pass on the strings above means
# the rules work; this is what says they were pointed at the shipped
# router.
REAL_ROUTES, REAL_ROUTE_PROBLEMS = check_live.route_ids(
    check_live.read(check_live.WORKER))

check("the shipped router parses with no refusals",
      REAL_ROUTE_PROBLEMS == [])

check("the shipped router yields the routes it dispatches",
      {"POST /auth/dev", "GET /snapshot", "DELETE /snapshot",
       "DELETE /membership/{}/{}", "OPTIONS *"} <= set(REAL_ROUTES))


# ------------------------------------------------------------------ #
# Entry shape. The vocabulary is closed in both directions: a missing  #
# key and an unknown key are both failures, because a ledger that      #
# accepts free-form fields is a document again.                        #

check("a well-formed entry raises nothing",
      check_live.entry_problems([entry()]) == [])

check("a missing required key is reported",
      len(check_live.entry_problems([entry(claim=None)])) == 1)

check("the missing-key report names the key",
      "claim" in only(check_live.entry_problems(
          [{k: v for k, v in entry().items() if k != "claim"}])))

check("an unknown key is reported",
      len(check_live.entry_problems([entry(notes="hello")])) == 1)

check("a duplicate id is reported",
      len(check_live.entry_problems([entry(), entry()])) == 1)

check("two distinct ids are not reported",
      check_live.entry_problems(
          [entry(), entry(id="GET /export")]) == [])

check("a status outside the vocabulary is reported",
      len(check_live.entry_problems([entry(status="mostly")])) == 1)

check("a surface outside the vocabulary is reported",
      len(check_live.entry_problems([entry(surface="widget")])) == 1)

check("an empty covers list is reported",
      len(check_live.entry_problems([entry(covers=[])])) == 1)

check("covers naming a path not in the tree is reported",
      len(check_live.entry_problems(
          [entry(covers=["server/worker-2.js"])])) == 1)

check("covers naming a real path is not reported",
      check_live.entry_problems(
          [entry(covers=["server/worker.js", "AGENTS.md"])]) == [])

# The head of a run the ledger declares. Evidence has to stand on one
# of those and this fixture is held to the same rule as a shipped row,
# because a fixture free to cite any head would exercise every arm
# below except the one that says which heads are citable.
GOOD = {"date": "2026-08-09",
        "sha": "9e78ea9d11c883f10da563ed4b99eb7c3ba1e024",
        "how": "three origins, three answers"}

check("a performed entry with full evidence raises nothing",
      check_live.entry_problems(
          [entry(status="performed", performed=GOOD)]) == [])

check("performed with no evidence at all is reported",
      len(check_live.entry_problems([entry(status="performed")])) == 1)

check("performed with an abbreviated sha is reported",
      len(check_live.entry_problems([entry(
          status="performed",
          performed=dict(GOOD, sha="588dac5"))])) == 1)

check("performed with an unreadable date is reported",
      len(check_live.entry_problems([entry(
          status="performed",
          performed=dict(GOOD, date="9 August"))])) == 1)

check("performed with no account of what ran is reported",
      len(check_live.entry_problems([entry(
          status="performed", performed=dict(GOOD, how=""))])) == 1)

# A well-formed head is not the same as a citable one. Two runs share a
# date here, so the report cannot sort its way to the later of them and
# reads a declared order instead; a row citing a head outside that
# order is evidence the query has nowhere to put, and it would drop out
# of the cadence line without a word.
check("performed evidence standing on an undeclared head is reported",
      len(check_live.entry_problems([entry(
          status="performed", performed=dict(GOOD, sha="0" * 40))])) == 1)

# The two statuses may not be worn at once. This is the arm that stops
# an entry being marked discharged and permanently-impossible together,
# which would read as cleared in one column and excused in the other.
check("performed evidence on a never entry is reported",
      len(check_live.entry_problems([entry(performed=GOOD)])) == 1)

check("a cause on a never entry is reported",
      len(check_live.entry_problems(
          [entry(cause="production-secret")])) == 1)

check("a first-contact entry with a known cause raises nothing",
      check_live.entry_problems([entry(
          status="first-contact", cause="production-secret")]) == [])

check("first-contact with no cause is reported",
      len(check_live.entry_problems(
          [entry(status="first-contact")])) == 1)

check("first-contact with an unregistered cause is reported",
      len(check_live.entry_problems(
          [entry(status="first-contact", cause="too hard")])) == 1)

check("a cause needing a pinned guard is reported without one",
      len(check_live.entry_problems(
          [entry(status="first-contact", cause="guarded-branch")])) == 1)

check("the same cause with a guard raises nothing",
      check_live.entry_problems([entry(
          status="first-contact", cause="guarded-branch",
          guard="if (!botToken)")]) == [])

check("a guard on a cause that does not take one is reported",
      len(check_live.entry_problems([entry(
          status="first-contact", cause="production-secret",
          guard="if (!botToken)")])) == 1)


# ------------------------------------------------------------------ #
# Completeness. This is the forcing arm: the rule that costs a slice   #
# something rather than the rule that describes.                       #

SPINE_ROUTES = ["GET /me", "POST /submit"]
SPINE_PAGES = ["index.html", "admin.html"]


def spined(ledger):
    return check_live.spine_problems(ledger, SPINE_ROUTES, SPINE_PAGES)


COVERING = [entry(id="GET /me"), entry(id="POST /submit"),
            entry(id="index.html", surface="page",
                  covers=["apps/web/index.html"]),
            entry(id="admin.html", surface="page",
                  covers=["apps/web/admin.html"])]

check("a ledger covering every route and page raises nothing",
      spined(COVERING) == [])

check("a dispatched route with no ledger row fails the gate",
      len(spined(COVERING[1:])) == 1)

check("the report gives the exact row to add",
      '"id": "GET /me"' in only(spined(COVERING[1:])))

check("a published page with no ledger row fails the gate",
      len(spined(COVERING[:3])) == 1)

# The other direction. A route deleted leaves a row claiming a surface
# that no longer exists, and a ledger holding rows for surfaces that
# are gone is how a count stays reassuring while the thing it counts
# leaves.
check("a row for a route the router no longer dispatches is reported",
      len(spined([*COVERING, entry(id="GET /gone")])) == 1)

check("a row for a page no longer published is reported",
      len(spined([*COVERING, entry(id="old.html", surface="page",
                                   covers=["AGENTS.md"])])) == 1)

# The qualifier reads through to the same rule. A row that says one more
# thing about a route names that route and then a comma, so the reverse
# rule has to resolve the id before it compares - otherwise a qualified
# id is the way to put a row in the ledger for a surface that is not in
# the tree, and it would read as covered.
check("a qualified row for a route that has left is still reported",
      len(spined([*COVERING, entry(id="GET /gone, signed out")])) == 1)

check("a flow row is not held to the spine",
      spined([*COVERING,
              entry(id="the key flow", surface="flow")]) == [])

check("more than one row may cover one route",
      spined([*COVERING, entry(id="GET /me, signed out")]) == [])


# ------------------------------------------------------------------ #
# The boundary. A permanent list is a dumping ground unless the reason #
# each entry is on it can be falsified from outside the ledger.        #

WORKER_SRC = 'if (!botToken) {\n  return null;\n}\n'

DEV_LOOPBACK = {
    "[vars]": {"ALLOWED_ORIGINS": "https://potaetoe.github.io"},
    "[env.dev.vars]": {
        "ALLOWED_ORIGINS": "http://localhost:8124,http://127.0.0.1:8124"},
}


def caused(ledger, source=WORKER_SRC, blocks=None):
    return check_live.cause_problems(
        ledger, source, DEV_LOOPBACK if blocks is None else blocks)


PINNED = entry(status="first-contact", cause="guarded-branch",
               guard="if (!botToken)")

check("a guard the source still carries corroborates its entry",
      caused([PINNED]) == [])

check("a guard the source no longer carries fails the gate",
      len(caused([PINNED], source="if (botToken === null) {")) == 1)

check("the falsified-guard report says to reclassify or re-pin",
      "reclassify"
      in only(caused([PINNED], source="nothing here")).lower())

WIDGET = entry(status="first-contact", cause="published-origin-only")

check("loopback-only dev origins corroborate the widget's entry",
      caused([WIDGET]) == [])

check("a published origin reaching the dev arm fails the gate",
      len(caused([WIDGET], blocks={
          "[vars]": {"ALLOWED_ORIGINS": "https://potaetoe.github.io"},
          "[env.dev.vars]": {
              "ALLOWED_ORIGINS": "http://127.0.0.1:8124,"
                                 "https://potaetoe.github.io"}})) == 1)

check("a production arm with no published origin fails the gate",
      len(caused([WIDGET], blocks={
          "[vars]": {"ALLOWED_ORIGINS": "http://127.0.0.1:8124"},
          "[env.dev.vars]": {
              "ALLOWED_ORIGINS": "http://127.0.0.1:8124"}})) == 1)

check("an agent port block added to the dev arm is still loopback",
      caused([WIDGET], blocks={
          "[vars]": {"ALLOWED_ORIGINS": "https://potaetoe.github.io"},
          "[env.dev.vars]": {
              "ALLOWED_ORIGINS": "http://127.0.0.1:8124,"
                                 "http://127.0.0.1:8170"}}) == [])

# The ratchet. Two causes cannot be corroborated from any file here -
# a secret is invisible to this repository by design, and so is a
# Telegram group - so the arm on those is a ceiling that can only be
# raised in a diff somebody reads.
UNCHECKABLE = [entry(id="a", status="first-contact",
                     cause="production-secret"),
               entry(id="b", status="first-contact", cause="off-machine")]

over = UNCHECKABLE + [entry(id="c%d" % n, status="first-contact",
                            cause="production-secret")
                      for n in range(check_live.UNCORROBORATED_CEILING)]

check("uncorroborated entries up to the ceiling raise nothing",
      caused(UNCHECKABLE) == [])

check("one uncorroborated entry past the ceiling fails the gate",
      len(caused(over)) == 1)

check("the ceiling report names the ceiling and the count",
      str(check_live.UNCORROBORATED_CEILING) in only(caused(over)))

check("a corroborated cause is not counted against the ceiling",
      caused([PINNED] * 1 + [entry(id="w%d" % n,
                                   status="first-contact",
                                   cause="guarded-branch",
                                   guard="if (!botToken)")
                             for n in range(20)]) == [])


# ------------------------------------------------------------------ #
# Wiring. Defined and not called is the same as absent, so each arm is #
# driven through problems() - the function the gate actually runs.     #

WIRED = check_live.problems()

check("the shipped ledger passes every rule",
      WIRED == [])

for label, planted in (
    ("entry shape", [entry(status="mostly")]),
    ("spine completeness", [entry(id="GET /nowhere")]),
    # A flow row, so the only rule this can break is the cause rule.
    # A route-shaped id would redden the spine instead and the arm
    # would pass while proving nothing about what it names.
    ("cause corroboration", [entry(id="z", surface="flow",
                                   status="first-contact",
                                   cause="guarded-branch",
                                   guard="if (!nothing_pins_this)")]),
):
    saved = check_live.LEDGER
    try:
        check_live.LEDGER = saved + planted
        drove = check_live.problems()
    finally:
        check_live.LEDGER = saved
    check("the %s rule is wired into problems()" % label, drove != [])

# The declared-run rule breaks by taking rows away rather than by
# adding one, so it cannot ride the loop above - and dropping every
# performed row also empties the spine, which would make a bare
# "something failed" arm pass for the wrong reason. The message is
# named instead.
saved = check_live.LEDGER
try:
    check_live.LEDGER = [e for e in saved if e["status"] != "performed"]
    without = check_live.problems()
finally:
    check_live.LEDGER = saved

check("the declared-run rule is wired into problems()",
      any("no performed row stands on it" in problem
          for problem in without))


# ------------------------------------------------------------------ #
# The query. `./run live` is the answer #157 asks for, so what it says #
# is a contract rather than a printout.                                #

TEXT = check_live.report()

check("the report separates the debt from the permanent list",
      "NEVER EXERCISED" in TEXT and "FIRST CONTACT" in TEXT)

check("the report marks the uncorroborated causes as uncorroborated",
      TEXT.count("UNCORROBORATED") >= 1)

check("the report states the cadence threshold",
      str(check_live.CADENCE_THRESHOLD) in TEXT)

check("the report says outright when no rehearsal has ever run",
      ("no rehearsal" in TEXT.lower())
      == (check_live.last_rehearsal(check_live.LEDGER) is None))

# Which run the cadence line names. RUNS is read in the order it is
# written because a date cannot break the tie: two sittings on one day
# sort equal, max() answers with whichever the ledger happens to list
# first, and the cadence line then measures drift from the wrong head -
# quietly, and in the reassuring direction if the older head is picked
# last. Chronology is authored here rather than derived, so these arms
# are what hold the authoring to something.
BOTH = [entry(status="performed",
              performed=dict(check_live.REHEARSAL, how="the first")),
        entry(id="q", status="performed",
              performed=dict(check_live.SITTING, how="the second"))]

check("the latest run any performed row cites is the one reported",
      check_live.last_rehearsal(BOTH) == check_live.SITTING)

check("a run no performed row cites is not reported as the latest",
      check_live.last_rehearsal(BOTH[:1]) == check_live.REHEARSAL)

check("a declared run that no row stands on is reported",
      len(check_live.run_problems([])) == len(check_live.RUNS))

check("the shipped ledger stands on every run it declares",
      check_live.run_problems(check_live.LEDGER) == [])

check("every ledger entry reaches the report",
      all(e["id"] in TEXT for e in check_live.LEDGER))

# Evidence ages. A performed claim is against bytes, and bytes move -
# so "performed" is never a permanent pass, and the staleness is
# derived at read time rather than stored where it would rot.
FRESH = entry(status="performed", performed=GOOD)

check("performed evidence is stale when a covered file has moved",
      check_live.stale([FRESH], lambda sha, paths: ["server/worker.js"])
      == [(FRESH["id"], ["server/worker.js"])])

check("performed evidence standing on unmoved files is not stale",
      check_live.stale([FRESH], lambda sha, paths: []) == [])

check("a never entry has no evidence to go stale",
      check_live.stale([entry()], lambda sha, paths: ["x"]) == [])

check("staleness is not asserted when git cannot answer",
      check_live.stale([FRESH], lambda sha, paths: None) == [])


# ------------------------------------------------------------------ #
# The ledger itself, read as data. These are the properties #157 asks  #
# for that no individual rule above states.                            #

# A ratchet in the one direction that can go wrong quietly. A row is
# discharged by editing a status, and a status edits back just as
# easily: dropping every performed row would restore the ledger to the
# state #157 opens by describing, and nothing outside this arm would
# say so. Evidence shape is asserted here as well as in entry_problems
# because this arm reads the shipped LEDGER rather than a fixture, and
# an evidence dict that never reaches a rule is a claim about a date.
check("a recorded rehearsal cannot be walked back to none, and every "
      "performed row states the head and the day it ran",
      [e for e in check_live.LEDGER if e["status"] == "performed"] != []
      and all(check_live.SHA.match(e["performed"]["sha"])
              and check_live.DATE.match(e["performed"]["date"])
              for e in check_live.LEDGER
              if e["status"] == "performed"))

check("discharging rows does not empty the debt",
      len([e for e in check_live.LEDGER if e["status"] == "never"]) > 0)

check("every registered cause is carried by at least one entry",
      {e.get("cause") for e in check_live.LEDGER if e.get("cause")}
      == set(check_live.CAUSES))

check("the destructive route is on the ledger and marked hands-off",
      any(e["id"] == "DELETE /snapshot"
          and "probe" in e["claim"].lower()
          for e in check_live.LEDGER))

check("every guard pinned by the ledger is in the shipped worker",
      all(e["guard"] in check_live.read(check_live.WORKER)
          for e in check_live.LEDGER if e.get("guard")))

check("every claim is a sentence rather than a label",
      all(len(e["claim"].split()) >= 4 for e in check_live.LEDGER))

# Resolved through route_of, the same way the spine reads an id. The
# property is that the part naming the route is the router's own
# spelling; comparing the whole id instead forbids the second claim
# about one route that this ledger's vocabulary allows and its own
# spine arm above accepts.
check("the ledger ids are the router's spelling, not a paraphrase",
      all(check_live.route_of(e["id"]) in REAL_ROUTES
          for e in check_live.LEDGER if e["surface"] == "route"))

check("no ledger id carries leading or trailing space",
      all(e["id"] == e["id"].strip() for e in check_live.LEDGER))

check("the shipped worker is read from server/, not copied here",
      re.search(r"server[/\\]worker\.js$", check_live.WORKER) is not None)


if failures:
    print("\ncheck_live.py FAILED %d of %d checks"
          % (failures, performed))
    sys.exit(1)
if performed != EXPECTED:
    print("\ncheck_live.py ran %d checks, expected %d - a check "
          "stopped running, or one was added without updating EXPECTED"
          % (performed, EXPECTED))
    sys.exit(1)
print("\ncheck_live.py OK - %d checks" % performed)
