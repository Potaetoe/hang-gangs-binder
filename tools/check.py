#!/usr/bin/env python3
"""
Run every check this project has, locally.

    python tools/check.py

A push to main publishes the site, so this exists to make "did I break
it?" one command instead of a list of remembered ones. It runs the two
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
      offenders still here)
    - each page stays inside its gzipped transfer budget, in both
      directions (tools/check_budget.py carries the ceilings; a change
      that adds weight raises them in its own diff)
    - every palette in theme.css meets WCAG with margin, and every
      color it declares is measured by something
      (tools/check_contrast.py carries the pairings and the scope
      table; a palette that table does not name fails)
    - eslint and ruff pass
    - every dev/ suite passes, from the crypto fixture to the Worker's
      gating matrix - NODE_SUITES below is the roster

Checks 1 and 3 are siblings and not one check with two scopes, because
the two directories are dangerous for opposite reasons: apps/web is
copied verbatim to a public site, and server/ is the directory that gets
run. See the docstring in tools/check_server.py.

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
See server/README.md, "Checking a deployment".

Order is deliberate: check_web.py runs first because the one failure
that cannot be undone is publishing a private key, and there is no
reason to spend thirty seconds on Node suites before hearing about it.
"""

import os
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (label, path relative to the repo root). The dev/ suites are listed
# here rather than discovered by globbing dev/*.test.mjs, because a
# suite that stops being run should be a deletion somebody made on
# purpose, not a file that quietly stopped matching a pattern.
NODE_SUITES = [
    ("crypto round trip + v1 fixture", "dev/crypto.test.mjs"),
    ("form record building", "dev/form.test.mjs"),
    ("form wiring + reopen after submit", "dev/form-wiring.test.mjs"),
    ("member panel + failed-send guard", "dev/submit.test.mjs"),
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

    results.append(("apps/web publishable", run(
        "apps/web publishable", [sys.executable, "tools/check_web.py"]
    )))

    # dist/ is what the deploy job publishes and apps/web is what a person
    # edits; this is the stage that says the two have not come apart. It
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
    results.append(("comments say why", run(
        "comments say why",
        [sys.executable, "tools/check_comments.py"]
    )))

    results.append(("check_comments extractor + ratchet", run(
        "check_comments extractor + ratchet",
        [sys.executable, "dev/check_comments.test.py"]
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
        print("\nAll checks passed. Safe to push - remember that a push to "
              "main publishes the site.\nIf server/worker.js changed, "
              "deploying it is a separate step: see server/README.md.")
        return 0

    print("\nNot safe to push.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
