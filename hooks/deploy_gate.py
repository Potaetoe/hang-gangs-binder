"""deploy-gate (WORKING.md, Enforcement #3): the schema goes first,
and the test hooks never go at all.

A deploy is refused while the newest migration file is not recorded as
applied - the failure that once shut sign-in for every member was a
Worker deployed over a database missing its columns. After applying,
record it:

    npx wrangler d1 migrations apply binder-db --remote
    py -3 hooks/record.py migrations-applied <newest-file-name>

A record command standing EARLIER in an unbroken && chain also counts:
if the record fails, && never reaches the deploy. Denying that twice
taught the gate to read it (owner, 2026-08-24).

A deploy is also refused when the built worker still contains the
/test/* hooks (SECURITY-REVIEW.md finding 2). A production build
tree-shakes them away; a bundle built with TEST_HOOKS=1 keeps them,
and carries the marker string below to prove it. Remedy: rebuild with
a plain `npm run build` and deploy that.
"""

import glob
import os
import re

from _common import read_input, read_state, command_of, chained, strip_quoted, deny

TEST_HOOK_MARKER = "BINDER-TEST-HOOKS-COMPILED-IN"


def bundle_roots():
    """What wrangler will deploy: _worker.js is a small loader that
    imports the real server code from .svelte-kit/output/server, so
    both are scanned. BINDER_BUNDLE (file or directory) is the
    selftest's fixture override."""
    override = os.environ.get("BINDER_BUNDLE")
    if override:
        return [override]
    return [os.path.join(".svelte-kit", "cloudflare", "_worker.js"),
            os.path.join(".svelte-kit", "output", "server")]


def check_bundle():
    """Deny when the built worker still contains the test hooks. A
    missing bundle passes - wrangler will fail on it loudly enough."""
    for root in bundle_roots():
        if os.path.isdir(root):
            paths = glob.glob(os.path.join(root, "**", "*.js"),
                              recursive=True)
        else:
            paths = [root]
        for path in paths:
            try:
                with open(path, encoding="utf-8", errors="ignore") as f:
                    bundle = f.read()
            except OSError:
                continue
            if TEST_HOOK_MARKER in bundle:
                deny("Test hooks are compiled into this build "
                     "(deploy-gate, SECURITY-REVIEW.md finding 2): %s "
                     "contains the %r marker, so this bundle was built "
                     "with TEST_HOOKS=1 and its /test/* routes are live "
                     "capabilities. Rebuild for production - npm run "
                     "build - and deploy that." % (path, TEST_HOOK_MARKER))


def newest_migration():
    directory = os.environ.get("BINDER_MIGRATIONS_DIR") or "drizzle"
    files = sorted(os.path.basename(p)
                   for p in glob.glob(os.path.join(directory, "*.sql")))
    return files[-1] if files else None


def recorded_earlier(parts, index, newest):
    pattern = re.compile(
        r"record\.py\s+migrations-applied\s+" + re.escape(newest))
    for j in range(index - 1, -1, -1):
        if parts[j + 1][1] != "&&":
            return False
        if pattern.search(parts[j][0]):
            return True
    return False


def check_migrations(parts, index):
    newest = newest_migration()
    if newest is None:
        return  # no migrations exist yet - nothing to be behind on
    if recorded_earlier(parts, index, newest):
        return
    applied = read_state().get("migrations_applied")
    if applied != newest:
        deny("The schema goes first (WORKING.md, deploy-gate): newest "
             "migration is %r but the record says %r was last applied. "
             "Run: npx wrangler d1 migrations apply binder-db --remote "
             "then: py -3 hooks/record.py migrations-applied %s - and "
             "deploy again." % (newest, applied, newest))


def main():
    payload = read_input()
    parts = chained(strip_quoted(command_of(payload)))
    for index, (seg, _joiner) in enumerate(parts):
        if not re.search(r"\bwrangler\s+(deploy|versions\s+upload)\b", seg):
            continue
        check_bundle()
        check_migrations(parts, index)


if __name__ == "__main__":
    main()
