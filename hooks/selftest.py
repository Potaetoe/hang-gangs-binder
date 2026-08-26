"""Fires every hook rule both ways - a deny case and a pass case - so a
hook that quietly breaks fails CI instead of failing us.

    py -3 hooks/selftest.py
"""

import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


def run(hook, payload, env_extra=None):
    env = dict(os.environ)
    env.update(env_extra or {})
    proc = subprocess.run(
        [sys.executable, os.path.join(HERE, hook)],
        input=json.dumps(payload), capture_output=True, text=True,
        env=env, cwd=os.path.dirname(HERE), timeout=60)
    return proc.returncode


def bash(command):
    return {"tool_name": "Bash", "tool_input": {"command": command}}


failures = 0
performed = 0


def check(label, hook, payload, want_deny, env_extra=None):
    global failures, performed
    performed += 1
    code = run(hook, payload, env_extra)
    denied = code == 2
    ok = denied == want_deny
    if not ok:
        failures += 1
    print("%s  %s  %s" % ("pass" if ok else "FAIL",
                          "deny" if want_deny else "allow", label))


with tempfile.TemporaryDirectory() as tmp:
    def state_env(content=None):
        path = os.path.join(tmp, "state.json")
        if content is not None:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(content, f)
        elif os.path.exists(path):
            os.remove(path)
        return {"BINDER_STATE": path, "BINDER_BRANCH": "feature-x"}

    # git_guard
    check("force push", "git_guard.py",
          bash("git push -f origin feature-x"), True, state_env())
    check("force-with-lease passes", "git_guard.py",
          bash("git push --force-with-lease origin feature-x"), False,
          state_env())
    check("gh api -f is not a force push (the old guard's misfire)",
          "git_guard.py",
          bash("git push origin feature-x && gh api -X PATCH x -f a=b"),
          False, state_env())
    check("push to a frozen branch", "git_guard.py",
          bash("git push origin old-accounts"), True, state_env())
    check("--no-verify", "git_guard.py",
          bash("git commit --no-verify -m x"), True, state_env())
    check("inline commit message (-m) - PS 5.1 mangles prose",
          "git_guard.py",
          bash('git commit -m "words with \\"quotes\\""'), True,
          state_env())
    check("inline commit message (-am)", "git_guard.py",
          bash("git commit -am fix"), True, state_env())
    check("commit by message file passes", "git_guard.py",
          bash("git commit -F C:/scratch/msg.txt"), False, state_env())
    check("commit --amend without a message passes", "git_guard.py",
          bash("git commit --amend --no-edit"), False, state_env())
    check("inline gh pr body (--body)", "git_guard.py",
          bash('gh pr create --title t --body "words"'), True,
          state_env())
    check("inline gh body (-b)", "git_guard.py",
          bash("gh pr comment 5 -b thanks"), True, state_env())
    check("gh --body-file passes", "git_guard.py",
          bash("gh pr create --title t --body-file pr.md"), False,
          state_env())
    check("signoff ; merge in one command - the gate reads state "
          "before the command runs", "git_guard.py",
          bash('py -3 hooks/record.py signoff 9 "ok" ; '
               "gh pr merge 9 --merge"), True, state_env())
    check("signoff && merge stays honored - the Bash tool's atomic "
          "pair", "git_guard.py",
          bash('py -3 hooks/record.py signoff 9 "ok" && '
               "gh pr merge 9 --merge"), False, state_env())
    check("a merge alone passes git-guard - sign-off checking is the "
          "merge-gate's job", "git_guard.py",
          bash("gh pr merge 9 --merge"), False, state_env())

    # merge_gate
    check("pr merge without sign-off", "merge_gate.py",
          bash("gh pr merge feature-x --merge"), True, state_env())
    check("pr merge with sign-off", "merge_gate.py",
          bash("gh pr merge feature-x --merge"), False,
          state_env({"signoff": {"target": "feature-x"}}))
    check("push to v1 without sign-off", "merge_gate.py",
          bash("git push origin v1"), True, state_env())
    check("push to v1 with sign-off", "merge_gate.py",
          bash("git push origin v1"), False,
          state_env({"signoff": {"target": "v1"}}))
    check("feature-branch push needs no sign-off", "merge_gate.py",
          bash("git push origin feature-x"), False, state_env())
    check("record-signoff && push in ONE chain passes - a failed "
          "record stops the chain anyway", "merge_gate.py",
          bash('py -3 hooks/record.py signoff v1 "ok" && '
               'git push origin v1'),
          False, state_env())
    check("record ; push (not &&) is still denied - a failed record "
          "would not stop it", "merge_gate.py",
          bash('py -3 hooks/record.py signoff v1 "ok" ; '
               'git push origin v1'),
          True, state_env())
    check("push && record-AFTER is still denied - too late",
          "merge_gate.py",
          bash('git push origin v1 && '
               'py -3 hooks/record.py signoff v1 "ok"'),
          True, state_env())
    check("a QUOTED mention of a push is not a push - a commit "
          "message or a fixture string never trips the gate",
          "merge_gate.py",
          bash('git commit -m "the gate denies git push origin v1 '
               'without a signoff"'),
          False, state_env())

    # deploy_gate
    mig = os.path.join(tmp, "mig")
    os.makedirs(mig, exist_ok=True)
    with open(os.path.join(mig, "0001_first.sql"), "w") as f:
        f.write("-- fixture")
    # Every deploy_gate case pins BINDER_BUNDLE to a fixture, so the
    # selftest never reads the real .svelte-kit build - a developer
    # whose last local build was a test build would otherwise see the
    # migration cases fail on the bundle rule instead.
    clean_bundle = os.path.join(tmp, "worker-clean.js")
    with open(clean_bundle, "w") as f:
        f.write("export default { fetch() {} };")
    hooked_bundle = os.path.join(tmp, "worker-hooked.js")
    with open(hooked_bundle, "w") as f:
        f.write('error(404, "BINDER-TEST-HOOKS-COMPILED-IN");')
    env_mig = dict(state_env({"migrations_applied": "0000_older.sql"}))
    env_mig["BINDER_MIGRATIONS_DIR"] = mig
    env_mig["BINDER_BUNDLE"] = clean_bundle
    check("deploy with unapplied migration", "deploy_gate.py",
          bash("npx wrangler deploy"), True, env_mig)
    env_ok = dict(state_env({"migrations_applied": "0001_first.sql"}))
    env_ok["BINDER_MIGRATIONS_DIR"] = mig
    env_ok["BINDER_BUNDLE"] = clean_bundle
    check("deploy with migrations current", "deploy_gate.py",
          bash("npx wrangler deploy"), False, env_ok)
    env_hooked = dict(state_env({"migrations_applied": "0001_first.sql"}))
    env_hooked["BINDER_MIGRATIONS_DIR"] = mig
    env_hooked["BINDER_BUNDLE"] = hooked_bundle
    check("deploy of a bundle with test hooks compiled in",
          "deploy_gate.py", bash("npx wrangler deploy"), True, env_hooked)
    env_missing = dict(state_env({"migrations_applied": "0001_first.sql"}))
    env_missing["BINDER_MIGRATIONS_DIR"] = mig
    env_missing["BINDER_BUNDLE"] = os.path.join(tmp, "no-such-worker.js")
    check("a missing bundle is wrangler's problem, not the gate's",
          "deploy_gate.py", bash("npx wrangler deploy"), False,
          env_missing)
    # state_env writes ONE shared file, so behind-state is rebuilt
    # before each case that needs it - the first version of these two
    # reused a dict whose file a later case had already overwritten.
    env_behind = dict(state_env({"migrations_applied": "0000_older.sql"}))
    env_behind["BINDER_MIGRATIONS_DIR"] = mig
    env_behind["BINDER_BUNDLE"] = clean_bundle
    check("record-migration && deploy in ONE chain passes",
          "deploy_gate.py",
          bash("py -3 hooks/record.py migrations-applied "
               "0001_first.sql && npx wrangler deploy"),
          False, env_behind)
    env_behind = dict(state_env({"migrations_applied": "0000_older.sql"}))
    env_behind["BINDER_MIGRATIONS_DIR"] = mig
    env_behind["BINDER_BUNDLE"] = clean_bundle
    check("record ; deploy (not &&) is still denied", "deploy_gate.py",
          bash("py -3 hooks/record.py migrations-applied "
               "0001_first.sql ; npx wrangler deploy"),
          True, env_behind)

    # migration_guard
    mig2 = os.path.join(tmp, "mig2")
    os.makedirs(mig2, exist_ok=True)
    with open(os.path.join(mig2, "0001_clean.sql"), "w") as f:
        f.write("CREATE TABLE x (id text PRIMARY KEY);\n")
    env_mig2 = {"BINDER_MIGRATIONS_DIR": mig2}
    check("clean migration applies remotely", "migration_guard.py",
          bash("npx wrangler d1 migrations apply binder-db --remote"),
          False, env_mig2)
    with open(os.path.join(mig2, "0002_pragma.sql"), "w") as f:
        f.write("PRAGMA foreign_keys=OFF;\nDROP TABLE x;\n")
    check("PRAGMA foreign_keys is refused by remote D1 - deny before "
          "production does", "migration_guard.py",
          bash("npx wrangler d1 migrations apply binder-db --remote"),
          True, env_mig2)
    with open(os.path.join(mig2, "0002_pragma.sql"), "w") as f:
        f.write("PRAGMA defer_foreign_keys = on;\nDROP TABLE x;\n")
    check("defer_foreign_keys does not span remote statements - deny",
          "migration_guard.py",
          bash("npx wrangler d1 migrations apply binder-db --remote"),
          True, env_mig2)
    check("a local apply is the test bench - the guard leaves it alone",
          "migration_guard.py",
          bash("npx wrangler d1 migrations apply binder-db --local"),
          False, env_mig2)
    check("unrelated commands pass", "migration_guard.py",
          bash("npx wrangler deploy"), False, env_mig2)

    # secret_guard
    def write(path, content):
        return {"tool_name": "Write",
                "tool_input": {"file_path": path, "content": content}}
    check("telegram token into a repo file", "secret_guard.py",
          write("C:/repo/src/config.ts",
                'const t = "123456789:' + "A" * 35 + '";'), True)
    check("secret assignment into a repo file", "secret_guard.py",
          write("C:/repo/src/x.ts",
                "SESSION_SECRET = 'kj3h5k2j4h5k3j4h5k2j4h5k3j4h'"), True)
    check("env read passes", "secret_guard.py",
          write("C:/repo/src/x.ts",
                "const s = platform.env.SESSION_SECRET;"), False)
    check(".env itself passes", "secret_guard.py",
          write("C:/repo/.env", "SESSION_SECRET=abcdefabcdefabcdefabcdef"),
          False)
    check(".dev.vars passes - it is the local secrets file",
          "secret_guard.py",
          write("C:/repo/.dev.vars", "ID_SECRET=abcdefabcdefabcdefabcdef"),
          False)

    # fleet_guard
    def agent(prompt, model="sonnet", isolation="worktree"):
        return {"tool_name": "Task", "tool_input": {
            "prompt": prompt, "model": model, "isolation": isolation}}
    check("haiku given edit work", "fleet_guard.py",
          agent("Implement the charts component in src/routes. Done "
                "means tests pass.", model="haiku"), True)
    check("edit without a worktree", "fleet_guard.py",
          agent("Fix the bug in src/lib/db.ts. Done: npm run check "
                "passes.", isolation=""), True)
    check("edit without a machine-checkable done", "fleet_guard.py",
          agent("Refactor src/lib/session.ts to be cleaner."), True)
    check("agent asked to push", "fleet_guard.py",
          agent("Port the charts math to src/lib. Done: tests pass. "
                "Then git push and open a PR."), True)
    check("a proper bounded dispatch", "fleet_guard.py",
          agent("Port the charts math into src/lib/charts.ts. Done "
                "means: npm run check passes and the new vitest suite "
                "passes."), False)
    check("research task free of edit rules", "fleet_guard.py",
          agent("Search the web for D1 backup best practice and report.",
                model="haiku", isolation=""), False)

print("\n%d case(s), %d failed" % (performed, failures))
sys.exit(1 if failures else 0)
