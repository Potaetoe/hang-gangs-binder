#!/usr/bin/env python3
"""
Run every check this project has, locally.

    python tools/check.py

Nothing here publishes anything - the checks are the whole point, so
this exists to make "did I break it?" one command instead of a list of
remembered ones. It runs the two
linters, every Node suite in dev/, the publishability check, the
deployment-config check, the documentation check, the comment check,
the per-page transfer budget, and the suite behind each checker, and
exits non-zero if any of them fails.
(The previous version of this docstring enumerated the stages with a
count, listed one suite short, and was stale within a week - the
printout at the end of a run is the list, and the only one that cannot
drift.) In outline:

    - apps/web is publishable (references resolve, no key-shaped
      content), and check_web.py's own CSP parser holds
    - server/ commits no member ids, dev sign-in secret or key, and
      check_server.py's own vars parser holds
    - the documents stay registered, tripwire-free and American-spelled
      (tools/check_docs.py carries the registry)
    - code comments explain why, and no new one narrates a change
      (tools/check_comments.py carries the allowlist that pins the
      offenders still here); the same stage refuses a raw control byte
      in any source file it reads, because a file grep classifies as
      binary answers nothing to any search of it
    - the same comments hold to American spelling, over the same
      source tree check_comments.py already reads (tools/check_spelling.py
      carries the deny-list and the ratchet that pins what was already
      there when this stage was born; #334)
    - each page stays inside its gzipped transfer budget, in both
      directions (tools/check_budget.py carries the ceilings; a change
      that adds weight raises them in its own diff)
    - every palette in theme.css meets WCAG with margin, and every
      color it declares is measured by something
      (tools/check_contrast.py carries the pairings and the scope
      table; a palette that table does not name fails)
    - eslint and ruff pass
    - every dev/ suite passes, from the crypto fixture to the Worker's
      gating matrix - NODE_SUITES below is the roster for the Node
      suites and PYTHON_SUITES for the ones that check a checker, and
      both are held against dev/ in both directions, so a suite that
      arrives without a line is a failure rather than a file nobody
      runs (#204, and #227 for the second suffix). PYTHON_SUITES is
      held against main() as well, because those stages are written by
      hand rather than iterated

Checks 1 and 3 are siblings and not one check with two scopes, because
the two directories are dangerous for opposite reasons: apps/web is what
dist/ is built from, so anything landing in it is published, and server/
is the directory that gets run. See the docstring in
tools/check_server.py.

The linters are a gate, not a build: nothing they run rewrites a file,
and they refuse a release rather than producing one.

There IS one thing here that writes a file - tools/build_web.mjs, which
generates dist/ from apps/web by removing comments (#181) - and this
gate never runs it. The "dist is the build of apps/web" stage below asks
whether the committed artifact is what the source builds to, in both
directions, and reports; it does not fix. That is the same shape as
every other check here, and it is what keeps DESIGN.md's test satisfied:
a release is refused rather than quietly produced. See DESIGN.md, "What
is deliberately not here".

What none of it can see is the Cloudflare dashboard. A Worker with no
D1 binding, or no EXPORT_TOKEN, passes every check here and fails on
the first real request - so a live round trip stays part of deploying.
See OPERATIONS.md, "Checking a deployment".

Order is deliberate: check_web.py runs first because the one failure
that cannot be undone is publishing a private key, and there is no
reason to spend thirty seconds on Node suites before hearing about it.
"""

import inspect
import os
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Where the roster arm below looks, and what it counts as a suite.
# Named rather than inlined so dev/check.test.py can pin the scope: a
# SUITE_DIR of "." would enumerate the whole repository, and a scope
# wall is checked rather than promised here (AGENTS.md, "The review
# bar").
SUITE_DIR = "dev"
SUITE_SUFFIX = ".test.mjs"

# The other language in the same directory. #227: the walk below read
# .mjs and nothing else, so a stray dev/*.test.py landed unnoticed while
# the .mjs control was caught immediately - the arm was written once and
# the second suffix was left with the hand list #204 is about.
PYTHON_SUITE_SUFFIX = ".test.py"

# (label, path relative to the repo root). The dev/ suites are listed
# here rather than discovered by globbing dev/*.test.mjs, because a
# suite that stops being run should be a deletion somebody made on
# purpose, not a file that quietly stopped matching a pattern.
#
# The list is kept honest against that glob in BOTH directions by
# roster_problems() below, and the second direction is the one this
# comment was missing: keeping the list by hand answers for a suite
# departing, and says nothing about one arriving. A dev/*.test.mjs
# nobody added here was never run and the gate was green (#204).
NODE_SUITES = [
    ("crypto round trip + v1 fixture", "dev/crypto.test.mjs"),
    ("member device key custody", "dev/memberkey.test.mjs"),
    # "form record building", "form wiring + reopen after submit" and
    # "member panel + failed-send guard" retired with your-page.html's
    # tabs, its hand-kept field list and its client-side seal
    # (0.9-M2-S2, #353) - dev/form.test.mjs, dev/form-wiring.test.mjs and
    # dev/submit.test.mjs all guarded exactly those mechanisms and
    # nothing else. tests/your-page.test.mjs is what replaced them.
    ("admin CSV + formula guard", "dev/admin.test.mjs"),
    ("admin session + row deletion", "dev/admin-session.test.mjs"),
    ("xlsx writer + ZIP reader", "dev/xlsx.test.mjs"),
    ("dashboard aggregation", "dev/dashboard.test.mjs"),
    # Two stages for one file, because the two halves cannot be reached
    # from one harness: the aggregation suite above loads dashboard.js
    # with no document, which is what proves it runs under Node and what
    # makes everything below its wiring line unreachable. A separate
    # label also says which half broke.
    ("dashboard drawing", "dev/dashboard-render.test.mjs"),
    ("member query engine + floor properties", "dev/query.test.mjs"),
    ("member dashboard session", "dev/public.test.mjs"),
    ("shared UI wiring", "dev/ui.test.mjs"),
    ("session storage + auth handoff + sign-out boundary",
     "dev/session.test.mjs"),
    ("worker routing + CORS", "dev/worker.test.mjs"),
    # Last, because it spawns a second node and does eighteen ECDH
    # seals - the slowest entry here, and the one whose failure is
    # least urgent. It is the only stage that exercises
    # dev/make-sample.mjs at all; #66 lived in that gap for weeks.
    ("sample generator still runs", "dev/make-sample.test.mjs"),
    # The demo the owner drives before the cutover (#122). It is here
    # rather than left to be run by hand because the way a demo fails is
    # by drifting: the pages move and the harness keeps showing what it
    # showed last month, which looks exactly like a demo that works.
    # This stage is what notices - it binds a socket and drives the real
    # mirror, so it is late in the list beside the other slow one.
    ("drivable demo + its mirror", "dev/demo.test.mjs"),
    # The same demo as files (#143). A separate stage from the one above
    # because the two fail for different reasons: that one goes red when
    # the demo drifts from the product, this one when the EMITTED SET
    # does - a page written without the mirror's edits, a glob that
    # swept dev/ onto a public host, a snapshot with no commit on it.
    # Reading which of those broke off one label is worth the line.
    ("baked static demo + its manifest", "dev/demo-bake.test.mjs"),
    # The generator behind the "dist is the build of apps/web" stage
    # above. That stage asks whether the artifact is current; this one
    # asks whether the thing answering is right - including that it
    # removes comments and NOTHING else, which no byte-comparison
    # against a fresh build can see. #181.
    ("build_web strippers + staleness", "dev/build_web.test.mjs"),
]

# {path: why it is not run}. Empty, and the emptiness is the point: a
# suite left out on purpose is then a sentence somebody wrote, which is
# the entire difference between left out and forgotten. An entry the
# enumeration cannot find fails the same way a check_comments.py pin
# that stops matching does, so this list can only shrink and cannot go
# stale.
NODE_SUITES_EXCLUDED = {}

# (label, path) for every Python suite main() runs. This list is NOT
# what main() iterates, and that is deliberate rather than an oversight:
# each Python suite is a stage written beside the checker it guards, so
# the reader of main() meets check_docs.py's suite next to check_docs.py
# instead of in a block at the end. The cost of that ordering is a list
# that could name a stage nobody runs, which registration_problems()
# below is what pays.
PYTHON_SUITES = [
    ("check_web CSP parser + pin", "dev/check_web.test.py"),
    ("check_server vars parser + rules", "dev/check_server.test.py"),
    ("check_docs registries + rules", "dev/check_docs.test.py"),
    ("check_comments extractor + ratchet", "dev/check_comments.test.py"),
    ("check_spelling extractor + ratchet", "dev/check_spelling.test.py"),
    ("check_budget extractor + budgets", "dev/check_budget.test.py"),
    ("check_fonts extractor + coverage", "dev/check_fonts.test.py"),
    ("check_contrast parser + pairings", "dev/check_contrast.test.py"),
    ("check_live parser + ledger rules", "dev/check_live.test.py"),
    ("check.py roster rules", "dev/check.test.py"),
]

# {path: why it is not run}. Empty for NODE_SUITES_EXCLUDED's reason.
PYTHON_SUITES_EXCLUDED = {}


def roster_problems(listed=None, excluded=None, repo=None, suffix=None,
                    names=None):
    """Every way the hand roster and dev/ can disagree, as readable lines.

    Both directions in one walk, which is the point rather than a
    saving - the same shape tools/build_web.mjs differences() uses for
    dist/. "A suite was deleted and its line stayed" and "a suite was
    added and no line names it" are one question asked twice, and an arm
    for the first that can pass while the second is broken is exactly
    what #204 found here.

    Only SUITE_DIR is enumerated. A registered path outside it is still
    required to exist, because that is the whole of what this can say
    about one without walking a directory it has no business walking.

    One walk serves both suffixes, and `suffix` is a parameter rather
    than a second function because two functions would be two places for
    the arrival direction to be forgotten in - which is the whole
    ticket, twice over (#204, then #227).

    `names` is the price of that sharing and it is not cosmetic. A walk
    that does not know which roster it is reading names the wrong one:
    the Python arm fired on a stray .test.py and told the reader to add
    it to NODE_SUITES, the one list that then fails for naming a
    .test.py. Found by mutation on this branch.

    The parameters exist so dev/check.test.py can drive this over a
    directory it builds. Reading the real tree is the stage's job in
    main(), and a rule exercised only against the tree it guards cannot
    be shown to fail.
    """
    listed = NODE_SUITES if listed is None else listed
    excluded = NODE_SUITES_EXCLUDED if excluded is None else excluded
    repo = REPO if repo is None else repo
    suffix = SUITE_SUFFIX if suffix is None else suffix
    roster, skipped = (("NODE_SUITES", "NODE_SUITES_EXCLUDED")
                       if names is None else names)

    directory = os.path.join(repo, SUITE_DIR)
    if not os.path.isdir(directory):
        return ["%s/ is not there at all, so nothing was enumerated and "
                "this roster was compared against an empty answer. A "
                "reader that found nothing to read prints the same "
                "silence as a roster that agrees." % SUITE_DIR]

    found = {SUITE_DIR + "/" + name for name in os.listdir(directory)
             if name.endswith(suffix)}
    registered = {path for _, path in listed}
    problems = []

    for path in sorted(registered):
        if not os.path.isfile(os.path.join(repo, path)):
            problems.append(
                "%s is registered in %s and there is no such "
                "file. Either the suite moved and its line did not, or "
                "the suite was deleted and its line stayed - a stage "
                "that cannot run is a stage that reports FAILED for a "
                "reason nobody can act on." % (path, roster))

    for path in sorted(found - registered - set(excluded)):
        problems.append(
            "%s is not in %s, so the gate never runs it. A "
            "suite nobody runs is decoration that reads as coverage: "
            "add it there with a label, or say in %s "
            "why it is skipped." % (path, roster, skipped))

    for path in sorted(excluded):
        if path not in found:
            problems.append(
                "%s names %s and the enumeration does "
                "not find it. An exclusion for a file that is not there "
                "excuses nothing and hides the next reader from the one "
                "that is - delete the entry." % (skipped, path))
        if path in registered:
            problems.append(
                "%s is both registered and excluded. The gate runs it, "
                "so the exclusion is a false sentence about this gate - "
                "delete whichever of the two is wrong." % path)

    return problems


def registration_problems(listed=None, source=None):
    """Every PYTHON_SUITES row main() does not actually run.

    The link the Node side does not need. main() iterates NODE_SUITES,
    so a line there IS a stage and there is nothing between the two to
    drift; the Python stages are hand-written, so the roster above is a
    claim about main() rather than a description of it - and a roster
    that claims something nothing reads is exactly what #204 and #227
    are both about.

    main()'s own source is the evidence because the stage list only
    exists while main() is running, and a check that imported and ran
    the gate to find out would run the gate twice.
    """
    listed = PYTHON_SUITES if listed is None else listed
    source = inspect.getsource(main) if source is None else source

    problems = []
    for label, path in listed:
        if path not in source:
            problems.append(
                "%s is in PYTHON_SUITES and main() does not run it, so a "
                "suite this file says is a stage is a file nobody "
                "executes. Register it as a stage, or take the line out."
                % path)
        elif label not in source:
            problems.append(
                "PYTHON_SUITES calls %s \"%s\" and main() runs it under "
                "another name. The label is what the stage table prints, "
                "so the two disagreeing means the roster describes a run "
                "nobody sees." % (path, label))
    return problems


def find_node():
    """Locate node, falling back to where the installers put it.

    shutil.which alone is not enough: the Windows node installer adds
    itself to the *machine* PATH, which a shell started from an already
    running process does not see until it is restarted. Every suite
    here needs node, so getting this wrong turns the whole gate into a
    single unexplained failure on a machine where node is installed.
    """
    found = shutil.which("node")
    if found:
        return found

    candidates = [
        os.path.join(os.environ.get("ProgramFiles", ""), "nodejs", "node.exe"),
        os.path.join(os.environ.get("ProgramFiles(x86)", ""), "nodejs",
                     "node.exe"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "nodejs",
                     "node.exe"),
        "/usr/local/bin/node",
        "/usr/bin/node",
        os.path.expanduser("~/.nvm/current/bin/node"),
    ]
    for path in candidates:
        if path and os.path.isfile(path):
            return path
    return None


def run(label, argv):
    print("\n=== %s ===" % label, flush=True)
    return subprocess.run(argv, cwd=REPO).returncode == 0


def run_linters(node):
    """(label, ok) for ESLint and Ruff.

    A missing linter is reported as FAILED, never as skipped, for the
    same reason a missing node is: a gate that quietly drops a check
    reports success for a run that verified less than it claims. That is
    the failure this repository has hit twice - a suite registered
    locally but not in CI, and a check that could not fail.

    Neither of these rewrites a file; they refuse a release rather than
    producing one. The one generator this repository has is not run from
    here either - see this module's docstring. DESIGN.md, "What is
    deliberately not here".
    """
    results = []

    if node:
        eslint = os.path.join(REPO, "node_modules", "eslint", "bin",
                              "eslint.js")
        if os.path.exists(eslint):
            results.append(("eslint (js)", run(
                "eslint (js)", [node, eslint, "."])))
        else:
            print("\n=== eslint (js) ===")
            print("FAILED - node_modules is missing. Run `npm install` "
                  "once; it installs devDependencies only and nothing "
                  "from it is published.")
            results.append(("eslint (js)", False))
    else:
        results.append(("eslint (js)", False))

    ruff = shutil.which("ruff")
    ruff_cmd = [ruff, "check", "."] if ruff else [
        sys.executable, "-m", "ruff", "check", "."]
    try:
        results.append(("ruff (python)", run("ruff (python)", ruff_cmd)))
    except FileNotFoundError:
        print("\n=== ruff (python) ===")
        print("FAILED - ruff is not installed. `python -m pip install "
              "ruff`.")
        results.append(("ruff (python)", False))

    return results


def main():
    results = []
    node = find_node()

    # The label names the design gate as well as publishability because
    # checks 24 and 25 live in this same file, and a stage prints one
    # name for everything under it: a mockup-token failure was surfacing
    # under "apps/web publishable", which says neither what broke nor
    # which ruling it broke (P3 F8). dev/check.test.py reads this label
    # rather than the argv beside it, so it cannot quietly shorten again.
    results.append(("apps/web publishable + the mockup's design gate", run(
        "apps/web publishable + the mockup's design gate",
        [sys.executable, "tools/check_web.py"]
    )))

    # apps/web is what a person edits and dist/ is the same code with
    # comments stripped; this is the stage that says the two have not
    # come apart. It
    # runs before the budget below because the budget measures dist/, and
    # measuring a stale artifact is a number about a site nobody is
    # shipping. #181.
    if node:
        results.append(("dist is the build of apps/web", run(
            "dist is the build of apps/web",
            [node, "tools/build_web.mjs", "--check"]
        )))
    else:
        print("\n=== dist is the build of apps/web ===")
        print("FAILED - node was not found, and the generator needs it.")
        results.append(("dist is the build of apps/web", False))

    # The gate checking itself. It runs on the same interpreter and needs
    # no node, so it is here rather than in NODE_SUITES - and it runs
    # second because a broken checker makes the check above meaningless
    # rather than merely wrong.
    results.append(("check_web CSP parser + pin", run(
        "check_web CSP parser + pin", [sys.executable, "dev/check_web.test.py"]
    )))

    # server/ is checked separately from apps/web, not as a second scope
    # inside it. #39 produced the reason: check_web.py is bounded to
    # apps/web by construction, so a [vars] block publishing the group's
    # numeric Telegram ids passed every check this gate had.
    results.append(("server/ commits no ids or secrets", run(
        "server/ commits no ids or secrets",
        [sys.executable, "tools/check_server.py"]
    )))

    results.append(("check_server vars parser + rules", run(
        "check_server vars parser + rules",
        [sys.executable, "dev/check_server.test.py"]
    )))

    # The documentation system holding to its own rules: the top-level
    # registry, falsified-claim tripwires, and spelling. Born from
    # issue #77 - three corrections in one week each missed a hand-made
    # copy of the fact they corrected.
    results.append(("docs registry + tripwires", run(
        "docs registry + tripwires",
        [sys.executable, "tools/check_docs.py"]
    )))

    # The reader behind it, tested on strings. The registries and the
    # rules are only as good as the half that finds a document to apply
    # them to, and that half is the one a mutation never reaches.
    results.append(("check_docs registries + rules", run(
        "check_docs registries + rules",
        [sys.executable, "dev/check_docs.test.py"]
    )))

    # The same rule for code that check_docs.py holds for documents: a
    # comment says why, and what changed says it in the commit message.
    # A ratchet rather than a sweep - every offender already here is
    # pinned, a new one fails, and a pin that stops matching fails too.
    #
    # The label names two rules because the stage answers for two. The
    # second is a floor under the first: a source file carrying a raw
    # control byte reads as binary to grep and to this checker's own
    # code mask, so the tree it scans has to be text before anything it
    # says about that tree can be trusted.
    results.append(("comments say why + source is text", run(
        "comments say why + source is text",
        [sys.executable, "tools/check_comments.py"]
    )))

    results.append(("check_comments extractor + ratchet", run(
        "check_comments extractor + ratchet",
        [sys.executable, "dev/check_comments.test.py"]
    )))

    # AGENTS.md rule 8's other half: American spelling, held over the
    # same comment surface check_comments.py just read rather than over
    # the four documents check_docs.py owns. #334 - a British spelling
    # in a code comment passed both of those and was found by eye.
    results.append(("comments hold to American spelling", run(
        "comments hold to American spelling",
        [sys.executable, "tools/check_spelling.py"]
    )))

    results.append(("check_spelling extractor + ratchet", run(
        "check_spelling extractor + ratchet",
        [sys.executable, "dev/check_spelling.test.py"]
    )))

    # Each page against a pinned number of gzipped bytes. #72 measured
    # the load and acquitted it; this is what keeps that ground while a
    # redesign touches every page, since nothing else in this gate would
    # notice the payload doubling.
    results.append(("per-page transfer budget", run(
        "per-page transfer budget",
        [sys.executable, "tools/check_budget.py"]
    )))

    results.append(("check_budget extractor + budgets", run(
        "check_budget extractor + budgets",
        [sys.executable, "dev/check_budget.test.py"]
    )))

    # Every subset face against the characters the pages ask it to draw.
    # #85 cut the italic display face down to a wordmark's inventory to
    # free the budget above, and that trade has a silent failure on the
    # other side of it: a missing glyph is not an error, it is a fallback
    # to the next family in the stack, so the wordmark would still render
    # and nothing else here would notice it had gone serif.
    results.append(("subset faces cover the wordmark", run(
        "subset faces cover the wordmark",
        [sys.executable, "tools/check_fonts.py"]
    )))

    results.append(("check_fonts extractor + coverage", run(
        "check_fonts extractor + coverage",
        [sys.executable, "dev/check_fonts.test.py"]
    )))

    # Every palette against WCAG, with a written margin. #81 measured
    # nineteen failing pairings by hand and nothing in this gate would
    # have found the twentieth - or noticed a fifth palette shipping
    # unmeasured, which is the arm that outlives the values.
    results.append(("palettes meet WCAG", run(
        "palettes meet WCAG",
        [sys.executable, "tools/check_contrast.py"]
    )))

    results.append(("check_contrast parser + pairings", run(
        "check_contrast parser + pairings",
        [sys.executable, "dev/check_contrast.test.py"]
    )))

    # Every surface only a running system can exercise, against the
    # ledger that records whether one ever has. #157: thirty merged pull
    # requests each honestly wrote "live: not performed", and thirty
    # correct labels summed into a gap nobody owned - because the labels
    # lived in pull request bodies, which no gate can read. This stage is
    # what makes a route or a page added without a verification status
    # cost something. `./run live` prints the same ledger as a report.
    results.append(("live-verification ledger", run(
        "live-verification ledger",
        [sys.executable, "tools/check_live.py"]
    )))

    results.append(("check_live parser + ledger rules", run(
        "check_live parser + ledger rules",
        [sys.executable, "dev/check_live.test.py"]
    )))

    # The two rosters against dev/, in both directions, before the
    # suites they govern run below. In-process rather than a subprocess
    # like its neighbors, because the thing being checked IS the two
    # lists thirty lines up: a second interpreter would import this file
    # only to read them back out of it. #204, then #227 for the Python
    # half - which needs the third call as well, because its stages are
    # written by hand rather than iterated.
    roster = (roster_problems()
              + roster_problems(PYTHON_SUITES, PYTHON_SUITES_EXCLUDED, None,
                                PYTHON_SUITE_SUFFIX,
                                ("PYTHON_SUITES", "PYTHON_SUITES_EXCLUDED"))
              + registration_problems())
    print("\n=== dev/ suite roster ===", flush=True)
    for problem in roster:
        print(problem)
    if not roster:
        print("ok - NODE_SUITES and %s/*%s name the same set, PYTHON_SUITES "
              "and %s/*%s do too, every exclusion still names a file, and "
              "main() runs every Python suite the roster claims."
              % (SUITE_DIR, SUITE_SUFFIX, SUITE_DIR, PYTHON_SUITE_SUFFIX))
    results.append(("dev/ suite roster", not roster))

    # This gate's own roster rules. Every other checker in tools/ has a
    # suite in dev/ holding its reader to strings; the gate itself had
    # none, and NODE_SUITES is a hand list beside a directory - the one
    # place here where a check can be added and never run. #204.
    results.append(("check.py roster rules", run(
        "check.py roster rules",
        [sys.executable, "dev/check.test.py"]
    )))

    results.extend(run_linters(node))
    if node:
        for label, script in NODE_SUITES:
            results.append((label, run(label, [node, script])))
    else:
        print("\n=== dev/ suites ===")
        print("SKIPPED - node was not found, on PATH or in the usual "
              "install locations. Every suite in dev/ needs it, so this run "
              "is reported as failed rather than passing on one check out "
              "of eight.\n"
              "dev/crypto-browser-check.html covers part of the same ground "
              "in a browser - see dev/README.md - but the CSV, xlsx, "
              "dashboard and worker suites have no browser equivalent.")
        for label, _ in NODE_SUITES:
            results.append((label, False))

    width = max(len(label) for label, _ in results)
    print("\n" + "=" * (width + 10))
    for label, ok in results:
        print("%-*s %s" % (width + 2, label, "ok" if ok else "FAILED"))
    print("=" * (width + 10))

    if all(ok for _, ok in results):
        print("\nAll checks passed. Safe to push - nothing publishes "
              "automatically: there is no live site today (down by owner "
              "order; 1.0 deploys the new one).\nIf server/worker.js "
              "changed, deploying it is a separate step: see "
              "server/README.md.")
        return 0

    print("\nNot safe to push.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
