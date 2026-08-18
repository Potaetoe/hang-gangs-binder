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
tree, a row that does not stand on the file its own surface is, a
first-contact classification whose stated reason the code has since
falsified, a performed row citing a head no declared run accounts for,
and a run that does not say which deployment it drove.

Two further failures are #202's, and both are about a ledger that
cannot see its own condition. A row is evidence about ONE deployment,
so a run names its arm and the report groups on it - thirty-one rows
earned against the development Worker are not coverage of the one the
cutover is about. And evidence ages, so the cadence trigger counts a
stale row as owed again rather than counting the `never` rows alone,
which is how five sixths of this ledger aged out with nothing due.
The three-valued `due()` is part of that: a batch that cannot be shown
due is not a batch shown not-due.

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
EXPECTED = 120


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
# What a forced row's evidence has to stand on. `covers` is the list    #
# staleness is measured against, so a row free to name any path in the  #
# tree is a row that can be made permanently fresh by naming one that   #
# never moves - and permanent freshness reads as the strongest kind of  #
# evidence rather than as the absence of any. Derived from the id       #
# rather than trusted from the row, which is the review bar's           #
# corollary: a rule computed entirely from the field it guards cannot   #
# detect that the field was chosen to pass it.                          #

check("a route row that does not stand on the worker is reported",
      len(check_live.entry_problems([entry(covers=["AGENTS.md"])])) == 1)

check("the report names the file the row is required to stand on",
      "server/worker.js" in only(check_live.entry_problems(
          [entry(covers=["AGENTS.md"])])))

check("a route row standing on the worker raises nothing",
      check_live.entry_problems(
          [entry(covers=["server/worker.js", "AGENTS.md"])]) == [])

check("a page row that does not stand on its own page is reported",
      len(check_live.entry_problems([entry(
          id="admin.html", surface="page",
          covers=["apps/web/index.html"])])) == 1)

check("a page row standing on its own page raises nothing",
      check_live.entry_problems([entry(
          id="admin.html", surface="page",
          covers=["apps/web/admin.html", "apps/web/admin.js"])]) == [])

# A qualified id is resolved before the rule reads it, the same way the
# spine resolves one. Comparing the whole id instead would make the
# qualifier the way to write a page row that stands on no page.
check("a qualified page row is held to its own page too",
      len(check_live.entry_problems([entry(
          id="admin.html, a live 401", surface="page",
          covers=["apps/web/index.html"])])) == 1)

# Nothing enumerates a flow, so nothing here can say which files one
# ought to name. Saying that outright is better than a rule that
# guesses, which is the same reason `flow` is outside the spine.
check("a flow row is not held to a derived covers list",
      check_live.entry_problems([entry(
          id="the key flow", surface="flow",
          covers=["AGENTS.md"])]) == [])


# ------------------------------------------------------------------ #
# Which deployment the evidence was earned against. #202's first fault  #
# is that thirty-one rows earned against the development Worker read as #
# coverage of the one the cutover is about. A run names its arm, and a  #
# row may not contradict the run it cites.                              #

check("a cited head resolves to the arm its run declares",
      check_live.arm_of(check_live.SITTING["sha"]) == "development"
      and check_live.arm_of(check_live.PRODUCTION["sha"]) == "production")

check("a head no run declares resolves to no arm",
      check_live.arm_of("0" * 40) is None)

check("evidence naming the arm its run drove raises nothing",
      check_live.entry_problems([entry(
          status="performed",
          performed=dict(GOOD,
                         arm=check_live.arm_of(GOOD["sha"])))]) == [])

check("evidence naming an arm its run did not drive is reported",
      len(check_live.entry_problems([entry(
          status="performed",
          performed=dict(GOOD, arm="production"))])) == 1)


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


def caused(ledger, source=WORKER_SRC):
    return check_live.cause_problems(ledger, source)


PINNED = entry(status="first-contact", cause="guarded-branch",
               guard="if (!botToken)")

check("a guard the source still carries corroborates its entry",
      caused([PINNED]) == [])

check("a guard the source no longer carries fails the gate",
      len(caused([PINNED], source="if (botToken === null) {")) == 1)

check("the falsified-guard report says to reclassify or re-pin",
      "reclassify"
      in only(caused([PINNED], source="nothing here")).lower())

# No "published-origin-only" fixture stands here: tools/check_live.py
# registers no such cause, for the reasoning its own note above CAUSES
# carries (0.9-M1-S3, #329). The row that cause named is exercised
# below instead, under its current cause.

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
    # A qualified id, so the spine resolves it to a route that is
    # dispatched and the only rule left to break is the derived-covers
    # one. A fresh route id would redden the spine instead, and the arm
    # would pass while proving nothing about what it names.
    ("derived covers", [entry(id="GET /me, off its own file",
                              covers=["AGENTS.md"])]),
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

# The arm rule breaks by editing RUNS rather than the ledger, so it
# cannot ride the loop above either.
saved_runs = check_live.RUNS
try:
    check_live.RUNS = (*saved_runs, {"date": "2026-08-09",
                                     "arm": "staging",
                                     "sha": "1" * 40})
    wired_arm = check_live.problems()
finally:
    check_live.RUNS = saved_runs

check("the run-arm rule is wired into problems()",
      any("staging" in problem for problem in wired_arm))


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

# A run states which deployment it drove. The report groups performed
# rows on that field, and the grouping is the only thing that says how
# thin one arm is - so a run outside the vocabulary takes its rows out
# of the grouping without a word.
check("the shipped runs all declare a registered arm",
      all(run.get("arm") in check_live.ARMS for run in check_live.RUNS))

saved_runs = check_live.RUNS
try:
    check_live.RUNS = (*saved_runs, {"date": "2026-08-09",
                                     "arm": "staging",
                                     "sha": "1" * 40})
    unregistered = check_live.run_problems(check_live.LEDGER)
finally:
    check_live.RUNS = saved_runs

check("a run declaring an unregistered arm is reported",
      any("staging" in problem for problem in unregistered))

# One head under two arms. `arm_of` answers with the first run naming
# it, so a second declaration re-labels every row standing on that head
# and nothing else says so.
saved_runs = check_live.RUNS
try:
    check_live.RUNS = (*saved_runs, dict(check_live.SITTING,
                                         arm="production"))
    doubled = check_live.run_problems(check_live.LEDGER)
finally:
    check_live.RUNS = saved_runs

check("one head declared twice under two arms is reported",
      any("twice" in problem for problem in doubled))

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
# What the cadence trigger counts. #202's second fault: the threshold   #
# read the `never` rows alone, so twenty-six of thirty-one performed    #
# rows could age out with the report still answering that no batch was  #
# due. A stale row is owed AGAIN - its evidence stands at a head this    #
# tree has moved past, which is the same standing as a row nothing has  #
# ever exercised, and it costs the same sitting minutes to discharge.   #


def moved(sha, paths):
    return ["server/worker.js"]


def unmoved(sha, paths):
    return []


def silent(sha, paths):
    return None


FRESH_ROWS = [entry(id="a", status="performed", performed=GOOD),
              entry(id="b", status="performed", performed=GOOD)]
NEVER_ROWS = [entry(id="c"), entry(id="d")]

check("a never row is owed",
      check_live.owed(NEVER_ROWS, unmoved)[0] == 2)

check("a performed row standing on unmoved bytes is not owed",
      check_live.owed(FRESH_ROWS, unmoved)[0] == 0)

check("a performed row whose covered bytes have moved is owed again",
      check_live.owed(FRESH_ROWS, moved)[0] == 2)

check("the owed count is the never rows and the stale ones together",
      check_live.owed(NEVER_ROWS + FRESH_ROWS, moved)[0] == 4)

# The reassuring direction, closed. `stale()` reads a row git cannot
# answer for as unmoved, which was harmless while staleness only
# printed; the moment it counts, that silence is an undercount of what
# is owed - and an undercount here reads as "nothing to do".
check("a row git cannot answer for is undetermined, not fresh",
      check_live.owed(FRESH_ROWS, silent) == (0, ["a", "b"]))

check("an unanswerable row is still not counted as stale",
      check_live.freshness(FRESH_ROWS, silent)[0] == [])

# The arithmetic the ticket is about, pinned from both sides. The debt
# alone stays under the threshold in every arm below; what moves the
# verdict is whether staleness is counted.
ENOUGH = [entry(id="n%d" % n)
          for n in range(check_live.CADENCE_THRESHOLD)]
AGEABLE = NEVER_ROWS + [entry(id="p%d" % n, status="performed",
                              performed=GOOD)
                        for n in range(check_live.CADENCE_THRESHOLD)]

check("a debt under the threshold with nothing stale is not due",
      check_live.due(NEVER_ROWS, unmoved) is False)

check("stale rows carry an under-threshold debt over the threshold",
      check_live.due(AGEABLE, moved) is True)

check("the same ledger with nothing stale is not due",
      check_live.due(AGEABLE, unmoved) is False)

# Three-valued on purpose. A batch that cannot be shown due is not a
# batch shown not-due, and printing the second for the first is this
# ticket's own arithmetic one layer down.
check("a count that cannot be completed is neither due nor not-due",
      check_live.due(NEVER_ROWS + FRESH_ROWS, silent) is None)

# And the floor is only reached when there is something to be silent
# about. A ledger with no performed rows has nothing that could age, so
# the count is complete and False is the honest answer.
check("a ledger with nothing to age answers not-due rather than None",
      check_live.due(NEVER_ROWS, silent) is False)

check("a count already at the threshold is due even when other rows "
      "cannot be aged",
      check_live.due(ENOUGH + FRESH_ROWS, silent) is True)


# ------------------------------------------------------------------ #
# The report is where that arithmetic is read, so each arm above is    #
# pinned again through the printed text: a correct helper nothing      #
# prints is #157's failure with a different subject.                   #

DUE_TEXT = check_live.report(moved)
CALM_TEXT = check_live.report(unmoved)
SILENT_TEXT = check_live.report(silent)

check("the cadence line counts stale rows toward what is owed",
      "owed %d" % (len(check_live.debt(check_live.LEDGER))
                   + len(check_live.stale(check_live.LEDGER, moved)))
      in DUE_TEXT)

check("the report says DUE when staleness carries the count over",
      "DUE." in DUE_TEXT)

check("a fresh ledger under the threshold does not say DUE",
      ("DUE." in CALM_TEXT)
      == (len(check_live.debt(check_live.LEDGER))
          >= check_live.CADENCE_THRESHOLD))

check("the report refuses to say not-due when rows cannot be aged",
      "CANNOT SAY" in SILENT_TEXT)

# The marker line rather than the word. The closing paragraph names
# STALE in prose to say how such a row is discharged, and a bare word
# count would read that as a thirty-fourth stale row.
check("every stale row is marked where the report lists it",
      DUE_TEXT.count("\n      STALE  ") == len(
          [e for e in check_live.LEDGER if e["status"] == "performed"])
      and "\n      STALE  " not in CALM_TEXT)

check("performed rows are grouped under the arm that earned them",
      all("  %s  (" % arm in DUE_TEXT for arm in check_live.ARMS))

# An arm with no evidence at all is the state this ledger was in for
# production until today, and it has to be printed rather than left out
# - an omitted arm is indistinguishable from an arm nobody registered.
saved = check_live.LEDGER
try:
    check_live.LEDGER = [
        e for e in saved
        if e["status"] != "performed"
        or check_live.arm_of(e["performed"]["sha"]) != "production"]
    without_production = check_live.report(unmoved)
finally:
    check_live.LEDGER = saved

check("an arm no performed row stands on is named as empty, not "
      "omitted",
      "production  - NO ROW HAS EVER BEEN PERFORMED"
      in without_production)


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

# The aim ratchet, and the same shape as the arm above it. Taking the
# production rows out is one status edit each, and the state that
# restores is the one #202 opens by describing: every row of evidence
# in this ledger earned against a Worker the cutover is not about.
check("the production arm carries at least one performed row",
      any(e["status"] == "performed"
          and check_live.arm_of(e["performed"]["sha"]) == "production"
          for e in check_live.LEDGER))

check("every performed row's evidence resolves to a registered arm",
      all(check_live.arm_of(e["performed"]["sha"]) in check_live.ARMS
          for e in check_live.LEDGER if e["status"] == "performed"))

check("every registered cause is carried by at least one entry",
      {e.get("cause") for e in check_live.LEDGER if e.get("cause")}
      == set(check_live.CAUSES))

# 0.9-M1-S3 (#329), Prime's second rider: the reclassification is a
# CAUSE change, not a status change - sit's own origin existing does
# not mean BotFather's /setdomain has been run, so nothing here may
# read this row as performed without that owner act actually
# happening. Both halves are asserted together so a future edit that
# quietly flips either one - the cause back to something checked, or
# the status to "performed" on nothing - reds here first.
check("the reclassified Telegram-widget row still names an off-machine "
      "cause and is still not marked performed",
      any(e["id"] == "the Telegram widget rendering and its callback"
          and e["cause"] == "off-machine"
          and e["status"] == "first-contact"
          for e in check_live.LEDGER))

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
