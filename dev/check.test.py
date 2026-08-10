"""Contract checks for the gate's own suite roster.

`tools/check.py` is the single registry: a dev/ suite runs because a
line in NODE_SUITES names it. That list is hand-kept beside a directory,
and #204 is what a hand list beside an enumeration costs - the list's
stated reason covers a suite DEPARTING and says nothing about one
ARRIVING, so a `dev/*.test.mjs` nobody adds to it is simply never run
and the gate stays green. A suite nobody registers is decoration that
reads as coverage.

`roster_problems` is the arm that closes that, and this file is what
says the arm is right. Its rules are exercised over a directory this
suite BUILDS, never over dev/ itself, for dev/check_live.test.py's
reason and #34's: a rule exercised only against the tree it guards
cannot be shown to fail, and "the roster agrees" and "nothing was
enumerated" both print an empty list. The missing-dev/ arms below are
that second sentence made to fail.

#227 is the same sentence about the other language: the walk read
`*.test.mjs` and nothing else, so the arm that catches a stray Node
suite immediately was blind to a stray `dev/*.test.py`. Both suffixes
are walked now, and the Python side needs one link the Node side does
not - main() loops over NODE_SUITES, so a line there IS a stage,
whereas the Python suites are hand-written stages beside the checker
each one guards. `registration_problems` is what holds that list to
what main() runs.

Each rule is watched from both sides - an arm that sees it fire and an
arm that sees it stay silent - because a check that refuses everything
looks exactly like one that refuses correctly.

Several arms read tools/check.py's own source instead of a rule, and
they are the ticket rather than decoration: a check that is written but
never registered is the exact failure this file exists about, and
nothing else here would notice the gate quietly dropping one of its
stages. One of them reads a stage's LABEL rather than its argv, because
the label is the whole of what a reader of the stage table is given
(P3 F8).

This is also tools/check.py's first self-suite. Every other checker in
tools/ has had one since the checker it tests was written; the gate
itself did not, which is part of why the roster could go unguarded.

No framework and no new dependency, matching the suites beside it.
"""

import inspect
import os
import re
import shutil
import sys
import tempfile

# tools/ is not a package and check.py is a script, so the import has to
# be made reachable before it can be named. isort would hoist the import
# above the path insertion and break it, hence the explicit skip - the
# same shape as dev/check_live.test.py.
#
# Aliased because the house helper in every suite here is called
# `check`, and the module under test is check.py. Renaming the helper in
# one suite out of eight would be the worse trade.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))

import check as gate  # noqa: I001


failures = 0
performed = 0

# Asserted at the end rather than only printed. A hand-written total
# that nothing compares against still prints a confident "OK" when a
# check stops running - an early return, a renamed helper - which is the
# armed-looking-but-not failure this repository holds to be worse than
# having no check at all.
EXPECTED = 37

# Every scratch root built here, so the suite removes what it made even
# when an arm fails. mkdtemp does not clean up after itself.
ROOTS = []


def check(label, condition):
    global failures, performed
    performed += 1
    if not condition:
        failures += 1
    print("pass " if condition else "FAIL ", label)


def only(problems):
    """The single problem expected, or "" when there is not exactly one.

    Indexing straight into the list would raise instead of reporting,
    and a suite that raises stops: the remaining contracts never run, so
    a mutation shows one break at a time rather than all of them.
    """
    return problems[0] if len(problems) == 1 else ""


def tree(*names, dev=True):
    """A scratch repo root holding dev/<name> for each name given.

    Under the OS temp directory rather than in the checkout, because
    dev/ is scanned by the comment check and linted by eslint: a fixture
    written beside these files would be read as source by two other
    stages, and one of them would run it.

    `dev=False` builds the root without the directory at all, which is
    the case where an enumeration reads nothing and has to say so.
    """
    root = tempfile.mkdtemp(prefix="binder-roster-")
    ROOTS.append(root)
    if dev:
        os.mkdir(os.path.join(root, "dev"))
        for name in names:
            write(os.path.join(root, "dev", name))
    return root


def write(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("// scratch fixture, never run\n")


def roster(*paths):
    """NODE_SUITES' shape - (label, path) - for the paths given."""
    return [("scratch " + path, path) for path in paths]


# ---------------------------------------------------------------------
# The roster agreeing, which has to be silent before any arm that fires
# means anything.

root = tree("a.test.mjs", "b.test.mjs")
check("a roster naming exactly what is on disk reports nothing",
      gate.roster_problems(roster("dev/a.test.mjs", "dev/b.test.mjs"),
                           {}, root) == [])

check("one file registered under two labels is not a disagreement",
      gate.roster_problems([("one", "dev/a.test.mjs"),
                            ("two", "dev/a.test.mjs"),
                            ("three", "dev/b.test.mjs")], {}, root) == [])

root = tree("a.test.mjs", "harness.mjs", "fixture.json", "demo.html")
check("dev/ files that are not suites are not roster entries",
      gate.roster_problems(roster("dev/a.test.mjs"), {}, root) == [])

root = tree("a.test.mjs", "b.test.mjs.bak")
check("a name that merely contains the suffix is not a suite",
      gate.roster_problems(roster("dev/a.test.mjs"), {}, root) == [])

# ---------------------------------------------------------------------
# Arriving: the direction #204 is about. A file on disk that no line
# names.

root = tree("a.test.mjs", "arrived.test.mjs")
arriving = gate.roster_problems(roster("dev/a.test.mjs"), {}, root)
check("a suite on disk that no line names is reported",
      "dev/arrived.test.mjs" in only(arriving))
check("the arrival message says the gate never runs it",
      "never runs it" in only(arriving))

# ---------------------------------------------------------------------
# Departing: the direction the hand list's own comment already covered.

root = tree("a.test.mjs")
departing = gate.roster_problems(
    roster("dev/a.test.mjs", "dev/gone.test.mjs"), {}, root)
check("a line naming a file that is not there is reported",
      "dev/gone.test.mjs" in only(departing))

# Both at once, which is the property rather than a third case: an arm
# for arrival that can pass while departure is broken, or the reverse,
# is the shape that let #204 exist.
root = tree("a.test.mjs", "arrived.test.mjs")
both = gate.roster_problems(
    roster("dev/a.test.mjs", "dev/gone.test.mjs"), {}, root)
check("both directions are reported from one walk", len(both) == 2)
check("the walk names the arrival",
      any("dev/arrived.test.mjs" in problem for problem in both))
check("the walk names the departure",
      any("dev/gone.test.mjs" in problem for problem in both))

# ---------------------------------------------------------------------
# The exclusion list: a suite left out on purpose is a sentence somebody
# wrote, and an entry that stops matching fails the way check_comments'
# pins do, so the list cannot go stale.

root = tree("a.test.mjs", "skipped.test.mjs")
check("an excluded suite is not reported as unregistered",
      gate.roster_problems(roster("dev/a.test.mjs"),
                           {"dev/skipped.test.mjs": "a reason"}, root) == [])

root = tree("a.test.mjs")
stale = gate.roster_problems(roster("dev/a.test.mjs"),
                             {"dev/skipped.test.mjs": "a reason"}, root)
check("an exclusion the enumeration cannot find is reported",
      "dev/skipped.test.mjs" in only(stale))

root = tree("a.test.mjs", "harness.mjs")
unreachable = gate.roster_problems(roster("dev/a.test.mjs"),
                                   {"dev/harness.mjs": "a reason"}, root)
check("an exclusion for a file the enumeration never sees is reported",
      "dev/harness.mjs" in only(unreachable))

root = tree("a.test.mjs")
contradiction = gate.roster_problems(roster("dev/a.test.mjs"),
                                     {"dev/a.test.mjs": "a reason"}, root)
check("a suite both registered and excluded is reported",
      "dev/a.test.mjs" in only(contradiction))

# ---------------------------------------------------------------------
# Paths outside dev/. The enumeration deliberately does not walk them -
# that is the scope wall - so existence is the only thing the roster can
# say about one, and it has to say it or the list rots outside dev/.

root = tree("a.test.mjs")
write(os.path.join(root, "server", "side.test.mjs"))
check("a registered path outside dev/ that exists is accepted",
      gate.roster_problems(roster("dev/a.test.mjs",
                                  "server/side.test.mjs"), {}, root) == [])
outside = gate.roster_problems(
    roster("dev/a.test.mjs", "server/absent.test.mjs"), {}, root)
check("a registered path outside dev/ that is missing is reported",
      "server/absent.test.mjs" in only(outside))

# ---------------------------------------------------------------------
# Nothing read is not nothing wrong. #34: a reader that finds no
# directory returns the same empty list as a roster that agrees.

root = tree(dev=False)
check("a missing dev/ is reported rather than read as agreement",
      gate.roster_problems(roster("dev/a.test.mjs"), {}, root) != [])
check("a missing dev/ fails even when the roster is empty too",
      gate.roster_problems([], {}, root) != [])

# ---------------------------------------------------------------------
# The defaults, which are what the gate stage actually runs on. Asserted
# by making them disagree rather than by re-asserting the tree is clean:
# that second question is the stage's, and one failure printing twice
# sends the reader after two fixes.

empty = tree()
check("the default roster is NODE_SUITES itself",
      len(gate.roster_problems(None, {}, empty))
      == len({path for _, path in gate.NODE_SUITES}))
check("the default tree is a real one, holding suites of its own",
      len(gate.roster_problems([], {})) > 0)

check("the enumeration stays inside dev/", gate.SUITE_DIR == "dev")
check("a suite is a *.test.mjs file", gate.SUITE_SUFFIX == ".test.mjs")

# ---------------------------------------------------------------------
# The Python half of the same question. #227: everything above walked
# *.test.mjs and nothing else, so a stray dev/*.test.py landed unnoticed
# while the .mjs control was caught immediately - the arm was written
# once and the other language was left with the hand list #204 is about.
#
# The two suffixes are read by one walk with a parameter rather than by
# a second function, because two functions would be two places for the
# arrival direction to be forgotten in, which is the whole ticket.

root = tree("a.test.py", "b.test.py")
check("a Python roster naming exactly what is on disk reports nothing",
      gate.roster_problems(roster("dev/a.test.py", "dev/b.test.py"), {},
                           root, gate.PYTHON_SUITE_SUFFIX) == [])

root = tree("a.test.py", "arrived.test.py")
py_arriving = gate.roster_problems(roster("dev/a.test.py"), {}, root,
                                   gate.PYTHON_SUITE_SUFFIX)
check("a Python suite on disk that no line names is reported",
      "dev/arrived.test.py" in only(py_arriving))

root = tree("a.test.py")
py_departing = gate.roster_problems(roster("dev/a.test.py",
                                           "dev/gone.test.py"), {}, root,
                                    gate.PYTHON_SUITE_SUFFIX)
check("a Python line naming a file that is not there is reported",
      "dev/gone.test.py" in only(py_departing))

# The two walks are blind to each other, which is what makes running
# both of them the only way to cover dev/. One walk that swept both
# would report every .py as an unregistered .mjs and the reverse.
root = tree("a.test.mjs", "b.test.py")
check("the Node walk does not read a Python suite",
      gate.roster_problems(roster("dev/a.test.mjs"), {}, root) == [])
check("the Python walk does not read a Node suite",
      gate.roster_problems(roster("dev/b.test.py"), {}, root,
                           gate.PYTHON_SUITE_SUFFIX) == [])

check("a Python suite is a *.test.py file",
      gate.PYTHON_SUITE_SUFFIX == ".test.py")
check("the Python roster names something",
      len(gate.PYTHON_SUITES) > 0)

# ---------------------------------------------------------------------
# The link the Node side does not need. main() loops over NODE_SUITES,
# so a line there IS a stage; the Python suites are hand-written run()
# calls beside the checker each one guards, deliberately - so
# PYTHON_SUITES is a list beside main() rather than the thing main()
# reads, and without this arm it could name a stage nobody runs. The
# roster arm above chains disk to the list; this one chains the list to
# the gate.

ghost = gate.registration_problems([("ghost stage", "dev/g.test.py")],
                                   "nothing runs anything")
check("a rostered Python suite main() does not run is reported",
      "dev/g.test.py" in only(ghost))

check("a rostered Python suite main() does run is not reported",
      gate.registration_problems(
          [("ghost stage", "dev/g.test.py")],
          '("ghost stage", ["dev/g.test.py"])') == [])

drifted = gate.registration_problems(
    [("ghost stage", "dev/g.test.py")], '("other name", ["dev/g.test.py"])')
check("a stage label that drifted from the roster is reported",
      "ghost stage" in only(drifted))

# ---------------------------------------------------------------------
# Registration. An arm nobody runs is the ticket, so the two stages this
# change adds are pinned against main()'s own source - nothing else in
# this repository would notice either one being dropped.

source = inspect.getsource(gate.main)
check("the gate's main() calls the roster arm",
      "roster_problems(" in source)
check("the gate's main() walks the Python suffix too",
      "PYTHON_SUITE_SUFFIX" in source)
check("the gate's main() calls the registration arm",
      "registration_problems(" in source)
check("the gate's main() registers this suite as a stage",
      "dev/check.test.py" in source)

# ---------------------------------------------------------------------
# What the stage table calls things. P3 F8: checks 24 and 25 are the
# design gate of record, they live inside tools/check_web.py, and the
# one stage that runs it was called `apps/web publishable` - so a
# mockup-token failure printed under a name that says neither. The label
# is the only thing a reader of the table gets, and this arm is what
# stops it reverting to the shorter one.

design = re.search(r'results\.append\(\("([^"]+)", run\(\s*"[^"]+",\s*'
                   r'\[sys\.executable, "tools/check_web\.py"\]', source)
check("the stage that carries the design gate is named for it too",
      design is not None and "design gate" in design.group(1))


for path in ROOTS:
    shutil.rmtree(path, ignore_errors=True)

if failures:
    print("\ncheck.py FAILED %d of %d checks" % (failures, performed))
    sys.exit(1)
if performed != EXPECTED:
    print("\ncheck.py ran %d checks, expected %d - a check stopped "
          "running, or one was added without updating EXPECTED"
          % (performed, EXPECTED))
    sys.exit(1)
print("\ncheck.py OK - %d checks" % performed)
