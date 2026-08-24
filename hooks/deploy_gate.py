"""deploy-gate (WORKING.md, Enforcement #3): the schema goes first.

A deploy is refused while the newest migration file is not recorded as
applied - the failure that once shut sign-in for every member was a
Worker deployed over a database missing its columns. After applying,
record it:

    npx wrangler d1 migrations apply binder-db --remote
    py -3 hooks/record.py migrations-applied <newest-file-name>
"""

import glob
import os
import re

from _common import read_input, read_state, command_of, segments, deny


def newest_migration():
    directory = os.environ.get("BINDER_MIGRATIONS_DIR") or "drizzle"
    files = sorted(os.path.basename(p)
                   for p in glob.glob(os.path.join(directory, "*.sql")))
    return files[-1] if files else None


payload = read_input()
for seg in segments(command_of(payload)):
    if not re.search(r"\bwrangler\s+(deploy|versions\s+upload)\b", seg):
        continue
    newest = newest_migration()
    if newest is None:
        continue  # no migrations exist yet - nothing to be behind on
    applied = read_state().get("migrations_applied")
    if applied != newest:
        deny("The schema goes first (WORKING.md, deploy-gate): newest "
             "migration is %r but the record says %r was last applied. "
             "Run: npx wrangler d1 migrations apply binder-db --remote "
             "then: py -3 hooks/record.py migrations-applied %s - and "
             "deploy again." % (newest, applied, newest))
