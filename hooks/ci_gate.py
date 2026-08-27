"""ci-gate: the deploy-gate and migration-guard rules, re-fired in CI.

The local hooks intercept wrangler commands typed on this machine; the
release pipeline (.github/workflows/ci.yml) deploys from a GitHub
runner where no hook fires. So the pipeline runs this script before it
uploads or deploys anything: the same bundle check (no test hooks in a
production build) and the same migration scan (no pragma that behaves
differently on remote D1), imported from the hooks themselves so the
rule has one home.

The one deploy-gate rule NOT re-fired here is the migrations-applied
record: that record is per-machine state, and the pipeline makes it
moot by applying migrations itself, schema first, before every deploy.

    py -3 hooks/ci_gate.py

Exits 2 with the remedy on stderr when a rule denies - which fails the
CI job, which is the point.
"""

from deploy_gate import check_bundle
from migration_guard import check_migration_files

check_bundle()
check_migration_files()
print("ci-gate: bundle clean, migrations clean")
