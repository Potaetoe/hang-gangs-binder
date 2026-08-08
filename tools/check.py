#!/usr/bin/env python3
"""
Run every check this project has, locally.

    python tools/check.py

A push to main publishes the site, so this exists to make "did I break
it?" one command instead of seventeen remembered ones. It runs the two
linters, the eleven Node suites in dev/, the publishability check, the
deployment-config check, and the suite behind each of those two, and
exits non-zero if any of them fails:

     1. apps/web is publishable (references resolve, no key-shaped
        content)
     2. check_web.py's own CSP parser and policy pin
     3. server/ commits no member ids, dev sign-in secret or key
     4. check_server.py's own vars parser and rules
     5. eslint passes over the JavaScript
     6. ruff passes over the Python
     7. crypto.js round trips, and the v1 fixture still decrypts
     8. form.js builds the record the way it always did
     9. submit.js shows counts from /me, and a failed send stores nothing
    10. admin.js quotes CSV correctly and guards spreadsheet formulas
    11. admin.js requires an admin session and keeps deletion state current
    12. xlsx.js writes a ZIP that a reader can actually open
    13. dashboard.js aggregates the rows correctly
    14. public.js requires and sends a member session for the dashboard
    15. ui.js keeps the shared DOM wiring and boot guard intact
    16. session.js stores a valid tab session and auth.js hands it off
    17. worker.js routes, validates and enforces CORS

Checks 1 and 3 are siblings and not one check with two scopes, because
the two directories are dangerous for opposite reasons: apps/web is
copied verbatim to a public site, and server/ is the directory that gets
run. See the docstring in tools/check_server.py.

The linters are a gate, not a build. Nothing they run rewrites a file
and apps/web is still copied verbatim to the published site; they refuse
a release rather than producing one. See DESIGN.md, "What is
deliberately not here".

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
    ("member panel + failed-send guard", "dev/submit.test.mjs"),
    ("admin CSV + formula guard", "dev/admin.test.mjs"),
    ("admin session + row deletion", "dev/admin-session.test.mjs"),
    ("xlsx writer + ZIP reader", "dev/xlsx.test.mjs"),
    ("dashboard aggregation", "dev/dashboard.test.mjs"),
    ("member dashboard session", "dev/public.test.mjs"),
    ("shared UI wiring", "dev/ui.test.mjs"),
    ("session storage + auth handoff", "dev/session.test.mjs"),
    ("worker routing + CORS", "dev/worker.test.mjs"),
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

    Neither of these is a build step. apps/web is still copied verbatim
    and nothing here rewrites a file; they refuse a release rather than
    producing one. See DESIGN.md, "What is deliberately not here".
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

    results.append(("apps/web publishable", run(
        "apps/web publishable", [sys.executable, "tools/check_web.py"]
    )))

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

    node = find_node()
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
