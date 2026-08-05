#!/usr/bin/env python3
"""
Run every check this project has, locally.

    python tools/check.py

A push to main publishes the site, so this exists to make "did I break
it?" one command instead of seven remembered ones. It runs the five
Node suites in dev/ and the publishability check, and exits non-zero if
any of them fails:

    1. apps/web is publishable (references resolve, no key-shaped content)
    2. crypto.js round trips, and the v1 fixture still decrypts
    3. form.js builds the record the way it always did
    4. admin.js quotes CSV correctly and guards spreadsheet formulas
    5. xlsx.js writes a ZIP that a reader can actually open
    6. dashboard.js aggregates the rows correctly
    7. worker.js routes, validates and enforces CORS

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
    ("admin CSV + formula guard", "dev/admin.test.mjs"),
    ("xlsx writer + ZIP reader", "dev/xlsx.test.mjs"),
    ("dashboard aggregation", "dev/dashboard.test.mjs"),
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


def main():
    results = []

    results.append(("apps/web publishable", run(
        "apps/web publishable", [sys.executable, "tools/check_web.py"]
    )))

    node = find_node()
    if node:
        for label, script in NODE_SUITES:
            results.append((label, run(label, [node, script])))
    else:
        print("\n=== dev/ suites ===")
        print("SKIPPED - node was not found, on PATH or in the usual "
              "install locations. Every suite in dev/ needs it, so this run "
              "is reported as failed rather than passing on one check out "
              "of seven.\n"
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
