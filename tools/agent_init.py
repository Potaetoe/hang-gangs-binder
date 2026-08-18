#!/usr/bin/env python3
"""
The worktree contract, as a mechanism: `./run agent-init`, `./run agent-park`.

`agent-init` makes a checkout gate-ready and PRINTS the contract the
agent working in it is held to. `agent-park` is the far end of the same
contract: it frees the branch and leaves the record a reaper can prove a
worktree dead from. Both are safe on the primary checkout and on a
linked worktree, both are idempotent, and both hard-fail with a remedy
rather than repairing a state that is not provably safe to touch.

WHY A VERB RATHER THAN A PARAGRAPH IN A BRIEF

Four traps produced real red runs on this repository inside one week,
and every one of them was written down somewhere at the time:

  - A worktree checked out before a .gitattributes eol pin holds files
    the pin declares LF as CRLF. `git status` is CLEAN, because the
    attribute normalizes on the way to the index, so the mismatch is
    invisible to every command an agent runs first - and the gate stage
    that byte-compares dist/ against apps/web fails on a tree where
    nothing is wrong. It reads exactly like the agent's own defect, and
    it cost two reviewers and an executor a day between them.
  - A node_modules junctioned in from the primary checkout holds every
    package and still fails a `-d` test in Git Bash, which sends
    `npm ci` through the junction and tears down the primary checkout's
    install. `./run bootstrap` learned to probe the binary instead; the
    probe here is the generalization, and it refuses to install through
    a junction at all.
  - Port blocks announced in prose on an issue outlive the agent that
    announced them, so the next reader cannot tell a held block from a
    released one and two agents took one block.
  - A finished agent leaves its branch checked out in a worktree nobody
    deletes, so landing that branch needs a ref dance no mechanism owns.

A brief can only say those things. A verb finds them, repairs the two
that are mechanically repairable, refuses when the state is not safe to
touch, and records the two facts - a port block, a dead worktree - that
another process has to read.

WHERE THE STATE LIVES, AND WHY IT IS NOT IN THE REPOSITORY

Leases and worktree records are machine-held, under the fleet's state
directory (BINDER_FLEET_STATE, defaulting to ~/.claude/binder-fleet),
one JSON file per lease and one per worktree. The alternative shape - a
lease file inside the repository, ignored by git - loses on three
counts, and the first is decisive. A lease is a claim against every
OTHER worktree on this machine, and each worktree is a separate
directory: an in-repo lease file is invisible to the agent it exists to
warn, which is the whole function. Second, a worktree record has to
outlive its worktree, because the reaper reads it to decide whether to
delete that directory and then has to record that it did. Third, an
in-repo file that git ignores is still a file: it makes the working
tree non-empty for anything walking the directory, and `./run bake`
already refuses to stamp a commit against a tree it thinks is dirty.
The cost of machine-held state is that it is invisible to a git clone
and unversioned - which is correct for what it describes, since none of
it is a fact about the project and all of it is a fact about one
machine at one moment.

WHAT THE READINESS PROBE PROVES, AND WHAT IT DOES NOT

The probe is one real gate stage - the byte comparison of dist/ against
apps/web - and not the whole gate. It is chosen because it is the
cheapest stage that FAILS UNDER THE EXACT TRAP this verb repairs, so a
green probe is evidence that the repair worked rather than an
assertion; it needs node, so it also proves the runtime the Node half
of the gate depends on; and it is under half a second against roughly
fourteen for the full gate, which is what makes running it on every
init affordable. What it does not prove is that the tree is green. It
is a statement about the ENVIRONMENT, and the printed contract says so
in those words, because a readiness check an agent mistakes for a gate
run is worse than no readiness check at all.

Transitional: the probe names a stage of the dying gate. When the new
apparatus (0.9-M0-S4) owns the equivalent stage, PROBE below is
repointed at it and this paragraph goes with it.

THE MARKER CONTRACT, FOR THE REAPER

`agent-park` writes the worktree record with "state": "parked" and a
"park" block. That record is the provably-dead marker, and it is a
CLAIM, never a permission: the reaper re-verifies every field against
the live machine and deletes nothing whose proof it cannot reproduce.
The fields are:

  park.branch      the branch this worktree held, or null if its HEAD
                   was already detached
  park.tip         the full 40-character SHA that branch pointed at
  park.head        the full 40-character SHA HEAD was detached at, which
                   equals park.tip whenever park.branch is set
  park.clean       true, and only ever true: park refuses a worktree
                   with uncommitted or untracked content, so a record
                   exists only for a tree whose work is committed
  park.merged      whether park.tip was an ancestor of origin/accounts
                   AT PARK TIME - a fact with a timestamp on it, not a
                   licence, and the reaper recomputes it
  park.ports       the block released back to the lease pool
  park.scratch     the scratch directory removed, or null - and null
                   also covers the two cases park declines to act on:
                   a record naming no scratch directory, and a path
                   that failed the containment test below, which is
                   REPORTED on the terminal and left on disk. The field
                   says what was deleted and never what was found.
  park.at          when this was written

Before deleting anything the reaper independently establishes, on the
live machine: the path is still a registered worktree of this
repository; its HEAD is detached at park.head; `git status --porcelain`
there is empty; and park.branch, if the ref still exists, points at
park.tip and park.tip is an ancestor of a mainline. All four hold or
the worktree is REPORTED and left alone - the provable-dead floor is
that a failed proof is a report, never a deletion, and a branch is
deleted with `-d` first always, `-D` only with the ancestry proof
printed beside it, and never after a `-d` that timed out. Having
reaped, the reaper sets "state" to
"reaped" with its own timestamp and drops any lease naming that path.
A record whose worktree path no longer exists is inert: `agent-init`
already treats its lease as reclaimable, so a reaper that dies halfway
through blocks nobody.

WHAT THIS DELIBERATELY DOES NOT DO

It does not create worktrees, delete them, or move a branch other than
detaching HEAD in the worktree it is run in. It never runs the gate on
the agent's behalf, and it never pushes.

`--verify` mutates nothing at all, ON EITHER VERB. That is what makes
it safe as a first stage of the gate: the apparatus slice consumes
initialization_problems() below, or the exit status of `./run
agent-init --verify`, to refuse an uninitialized worktree before
spending forty stages on one. On park it is the dry run of a
destructive act, which is the flag an unsure agent reaches for, and it
answers with the status park would give - a report is the only thing a
question is allowed to cost.

Nothing here deletes a path it cannot prove it owns. `within()` is that
proof, and it is one function rather than a rule each teardown restates
- see its own reasoning for why the obvious string test is wrong, and
0.9-M0-S8's reaper for the same question at worktree size.
"""

import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Bumped when the contract itself changes shape. A record written under
# an older number reads as uninitialized, so a contract change re-inits
# every live worktree instead of leaving half the fleet on the old one
# with nothing to notice.
CONTRACT = 1

# The record and lease file format. Separate from CONTRACT because a
# reader (the reaper) cares about the shape of the file and not about
# what the verb printed when it wrote it.
SCHEMA = 1

# The six blocks a delegated agent may take, and the block that belongs
# to the machine's primary checkout. Six numbers per block is what a
# preview, a demo mirror and their spares need; the reservation exists
# because the owner drives the demo on the primary while agents run.
PORT_BLOCKS = [(8130, 8135), (8140, 8145), (8150, 8155),
               (8160, 8165), (8170, 8175), (8180, 8185)]
PRIMARY_BLOCK = (8124, 8126)

# The one gate stage the readiness probe runs. See the module docstring
# for why this stage and not another, and for the condition that
# repoints it at the new apparatus.
PROBE = ("dist is the build of apps/web",
         ["tools/build_web.mjs", "--check"])

# What the gate actually executes for its lint stage. The probe is the
# ENTRY POINT rather than the directory, and rather than the shell
# shim beside it, because those are three different questions: a
# junctioned node_modules answers the directory test wrongly in Git
# Bash, and a partial install can leave the shim without the module it
# launches.
ESLINT_ENTRY = os.path.join("node_modules", "eslint", "bin", "eslint.js")

# The gate's Python tooling (ruff, fontTools[woff]), pinned outside this
# file so a person and this verb read the same versions -
# tools/requirements-gate.txt carries the pins and the reasoning for
# them. install_python_gate_tools() below is the one place that reads
# this constant to build the install command; 0.9-M0-S19 documents that
# same command for a human running it by hand.
GATE_REQUIREMENTS = os.path.join("tools", "requirements-gate.txt")

# `i/<eol> w/<eol> attr/<attrs>\t<path>`, one NUL-terminated record per
# file. The -z form is what makes this parseable: without it git quotes
# any path holding a tab or a backslash, and a Windows checkout is the
# tree most likely to hold one.
EOL_LINE = re.compile(r"^i/(\S+)\s+w/(\S+)\s+attr/(.*?)\s*\t(.*)$", re.S)

# Files git stores with an explicit end-of-line pin are the only ones
# this verb touches. A file under plain text=auto has a working-tree
# form that depends on the platform and the config, so "wrong" is not a
# question a checker can answer about it; a file under eol=lf or
# eol=crlf has exactly one right answer on every machine.
DECLARED = ("eol=lf", "eol=crlf")


def now():
    return datetime.datetime.now(datetime.timezone.utc).replace(
        microsecond=0).isoformat().replace("+00:00", "Z")


def state_dir():
    """The fleet's machine-held state directory.

    The environment variable is not a convenience: it is what lets the
    suite drive every path here against a temporary directory, so the
    lease and marker rules are exercised rather than described.
    """
    override = os.environ.get("BINDER_FLEET_STATE")
    if override:
        return os.path.abspath(override)
    return os.path.join(os.path.expanduser("~"), ".claude", "binder-fleet")


def records_dir(state=None):
    return os.path.join(state or state_dir(), "worktrees")


def leases_dir(state=None):
    return os.path.join(state or state_dir(), "ports")


def record_path(repo, state=None):
    """One record per worktree, named for the path it describes.

    The digest is what makes the name unique - two agent worktrees can
    have the same basename under different parents, and a record that
    collides would let one agent's park write the other's death
    certificate.
    """
    full = os.path.abspath(repo)
    digest = hashlib.sha1(full.encode("utf-8")).hexdigest()[:8]
    return os.path.join(records_dir(state),
                        "%s-%s.json" % (os.path.basename(full), digest))


def read_json(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return None


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(data, handle, indent=2, sort_keys=True)
        handle.write("\n")


def within(path, root):
    """Whether `path` lives inside `root` - a PATH test, not a string one.

    THE CONTAINMENT PRIMITIVE. os.path.commonpath compares path
    COMPONENTS, and that is the whole difference from a prefix test: a
    SIBLING named `binder-scratch-elsewhere` satisfies
    `startswith("binder-scratch")`, so a teardown built on the string
    test recursively deletes a tree it does not own and prints that it
    removed its own. It takes no malice to reach - the scratch root is
    read from the environment at teardown time, so a root that differs
    between one act and the next makes prefix collisions ordinary.

    Both sides are resolved first, so the answer is about where the two
    paths land rather than about how they are spelled.

    The root is deliberately NOT inside itself. A record naming the root
    would otherwise authorize deleting every agent's scratch directory
    on the machine in one call, which is the same accident one size
    larger.

    0.9-M0-S8's reaper deletes whole worktrees out of records it did not
    write, which is this question with a far larger blast radius. It
    takes this function rather than writing a second one: two
    containment tests are two chances to hold the string version.
    """
    try:
        path = os.path.realpath(path)
        root = os.path.realpath(root)
        return path != root and os.path.commonpath([path, root]) == root
    except (OSError, ValueError):
        # Paths on different Windows drives have no common component and
        # commonpath says so by raising. That is not containment, and a
        # guard that raises where it cannot answer stops the caller
        # instead of protecting it.
        return False


# shutil.rmtree's error callback was renamed when the signature changed
# to carry the exception itself; both spellings take (function, path,
# problem) here, so the name is all that varies.
_RMTREE_HANDLER = "onexc" if sys.version_info >= (3, 12) else "onerror"


def _clear_read_only(function, path, _problem):
    os.chmod(path, stat.S_IWRITE)
    function(path)


def rmtree_hard(path):
    """A recursive delete that survives a read-only file, and still fails.

    git writes loose objects read-only, so deleting any tree that holds
    a repository raises PermissionError on Windows partway through.
    `ignore_errors=True` answers that by hiding it: the directory
    survives, the caller reports a clean teardown, and the residue
    accumulates in a shared parent where the next reader cannot tell
    whose it is. Clearing the bit and retrying is the actual repair, and
    what is still undeletable afterwards is RAISED - a teardown nobody
    can see fail is the failure this repository holds to be worse than a
    loud one.
    """
    shutil.rmtree(path, **{_RMTREE_HANDLER: _clear_read_only})


def git(repo, *args):
    """(returncode, stdout, stderr) for a git command, streams kept apart.

    SEPARATE, because a machine parser downstream is only safe reading
    ONE of them. `git status --porcelain -z` and `git ls-files --eol
    -z` are parsed as machine records on a returncode of 0 - success is
    not proof stderr is empty. A global excludes file git cannot read
    prints a WARNING and still exits 0, and folded into the SAME string
    a parser reads as records, that warning line is itself a record: no
    NUL in it to split on, so the two-character status prefix a warning
    line happens to start with reads as a "status" and the rest of the
    sentence reads as a "path". A clean worktree reads as holding
    uncommitted work, and `agent-park` refuses it. This is the CRLF-trap
    sibling - a state git itself produces that is invisible until a
    parser downstream chokes on it - and the fix is the same shape:
    stop the two things that mean different things from sharing one
    string. eol_problems(), dirty_paths(), registered_worktrees() and
    head_state() below read stdout only and never touch stderr; a
    caller building a message for a PERSON joins the two back together
    explicitly, via git_report() below, which is the only place they
    are allowed to touch.

    NOT STRIPPED, and that is load-bearing rather than an omission.
    `git status --porcelain` puts the two status columns in the FIRST
    two characters of every line, and a file modified in the working
    tree has a SPACE in the first one. Stripping the output takes that
    space off the first line only, which shifts one path by a character
    and turns pinned.txt into inned.txt - so the file no longer matches
    the mismatch list, and the end-of-line repair below stops seeing it
    as uncommitted work it must not touch. Found by the suite, on the
    one arm written to prove the repair refuses over uncommitted work.
    Callers that want a tidy value strip their own.
    """
    done = subprocess.run(
        ["git", "-C", repo, *args],
        capture_output=True, text=True,
    )
    return done.returncode, done.stdout, done.stderr


def git_report(stdout, stderr):
    """stdout and stderr joined into one string, for a person to read.

    The one place the two streams are allowed back together, and only
    for a fail() message - never for anything a parser downstream reads
    back in. Each side is stripped and blank sides are dropped, so a
    command that wrote to only one stream does not report a blank line
    for the other.
    """
    parts = [part.strip() for part in (stdout, stderr)
             if part and part.strip()]
    return "\n".join(parts) if parts else "(git produced no output)"


def find_node():
    """node, or None.

    Written here rather than imported from the gate. tools/check.py has
    the same helper and importing it would tie this verb to a file the
    0.9 apparatus rebuild is going to replace - the presumption on that
    apparatus is against re-use, and a launcher that stops working
    because a checker was rewritten is the coupling that presumption
    exists to prevent. The candidate list is short on purpose: it
    covers the Windows installer's machine-PATH case, which a shell
    started from an already running process cannot see.
    """
    found = shutil.which("node")
    if found:
        return found
    candidates = [
        os.path.join(os.environ.get("ProgramFiles", ""), "nodejs",
                     "node.exe"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs",
                     "nodejs", "node.exe"),
        "/usr/local/bin/node",
        "/usr/bin/node",
    ]
    for path in candidates:
        if path and os.path.isfile(path):
            return path
    return None


def worktree_kind(repo):
    """("primary"|"linked", the common git directory), or (None, error).

    A linked worktree has a .git FILE pointing into the primary's
    administrative directory, so its git dir and its common dir differ.
    This is the distinction park refuses to cross: detaching HEAD in the
    primary checkout would silently take the machine's shared checkout
    off its branch.
    """
    code, out, err = git(repo, "rev-parse", "--git-dir", "--git-common-dir")
    if code != 0:
        return None, git_report(out, err)
    lines = out.strip().splitlines()
    if len(lines) != 2:
        return None, "git did not answer with two directories: %s" % out
    here, common = (os.path.abspath(os.path.join(repo, line))
                    for line in lines)
    return ("linked" if here != common else "primary"), common


def primary_root(repo):
    """The primary checkout's absolute root, or None if it cannot be told.

    A linked worktree's `.claude/` is gitignored and therefore absent -
    see plant_hook_registration() below for why that matters. Every hook
    script this fleet runs lives only in the PRIMARY's checkout, so a
    worktree that wants to run them needs the primary's own path, not a
    copy. `worktree_kind()` already resolves the shared git-common-dir
    for exactly this reason (park's own primary/linked distinction), and
    that directory's parent is the checkout it belongs to - a shared
    `.git` only ever lives at the primary's root.
    """
    kind, common = worktree_kind(repo)
    if kind is None:
        return None
    if kind == "primary":
        return os.path.abspath(repo)
    return os.path.dirname(common)


# The one string every hook command in the primary's settings.json uses
# to name its own script - see plant_hook_registration() for why this,
# and only this, substring is rewritten.
HOOK_SCRIPT_MARKER = "$CLAUDE_PROJECT_DIR/.claude/hooks/"


def plant_hook_registration(primary, existing=None):
    """(settings dict to write, note), or (None, why there is nothing to
    plant) - wiring the primary's hooks into a linked worktree (#347).

    THE GAP THIS CLOSES

    `.claude/` is gitignored by design (see .gitignore's own comment on
    the line), so `git worktree add` never carries `.claude/settings.json`
    or `.claude/hooks/*.py` into a new worktree - there is nothing there
    for anything to read. A Claude Code session whose project directory
    IS that worktree therefore registers no project hooks at all: the
    guards this project depends on (push-to-main, cross-tree git, the
    backgrounded-gate refusal, the false-premise dispatch check) do not
    exist for it. This function is what `do_init` calls, on every linked
    worktree, to repair that.

    WHY THIS COPIES NOTHING

    Not one byte of `.claude/hooks/*.py` is copied. A copy goes stale
    the moment the primary's hooks change, and a stale copy is worse
    than the gap it would close because it LOOKS armed. Instead, every
    hook command that names `$CLAUDE_PROJECT_DIR/.claude/hooks/<file>`
    (HOOK_SCRIPT_MARKER above) is rewritten to name the PRIMARY's own
    absolute path to that same file, so the worktree always runs the
    primary's CURRENT script. `agent-init` re-runs on every HEAD move
    (the pack's own contract), so this registration is refreshed exactly
    as often as everything else it establishes - it has no separate
    staleness window of its own.

    `$CLAUDE_PROJECT_DIR` is left untouched everywhere it does NOT
    prefix `.claude/hooks/` - concretely, the SessionStart hook's `cd
    "$CLAUDE_PROJECT_DIR" && ./run session-open` is written through
    unchanged. `./run` and `tools/session_open.py` are tracked files,
    present in every worktree already, and session-open's own identity
    is keyed to the worktree that ran it (its module docstring: "this
    worktree's identity" via agent_init.record_path()) - rewriting that
    `cd` to the primary would make every worktree session report the
    PRIMARY's identity to the prime lock, exactly backwards from what
    session-open is for. Nor does this touch what a hook SCRIPT reads
    from `os.environ["CLAUDE_PROJECT_DIR"]` at its own runtime
    (bash_guard.py's cross-tree containment check, dispatch_premise.py's
    git lookups) - that is the harness's real environment variable for
    the session actually running, set independently of any string this
    function writes, and both of those checks are already correct
    against the session's own worktree. Only the FILE PATH used to find
    and exec the script is what this function repairs.

    WHY "permissions" IS NEVER PLANTED

    The primary's settings.json also carries a `permissions.allow` list.
    Copying it into every worktree would hand every session there the
    same pre-approved command list without a prompt - a wider grant than
    this ticket's scope, and no part of the guard mechanism needs it:
    the PreToolUse hooks run and can deny regardless of what is or is
    not on that list. So this reads ONLY the "hooks" key out of the
    primary's settings.json and returns a dict holding ONLY that key
    merged over `existing` (whatever the worktree's own settings.json
    already carries by hand) - "permissions" and every other key stays
    exactly what `existing` already said, untouched.

    NEVER CALLED FOR THE PRIMARY ITSELF

    `do_init` only calls this when `kind == "linked"`. The primary
    checkout already carries its own real settings.json; this function
    is never given the chance to touch it.
    """
    primary_settings = os.path.join(primary, ".claude", "settings.json")
    data = read_json(primary_settings)
    if not isinstance(data, dict) or not isinstance(data.get("hooks"), dict):
        return None, (
            "no %s to plant hooks from - this checkout does not carry "
            "the fleet's machine-held hook mechanism, so there is "
            "nothing missing here either." % primary_settings)

    replacement = primary.replace(os.sep, "/").rstrip("/") + "/.claude/hooks/"

    def rewrite(value):
        if isinstance(value, str):
            return value.replace(HOOK_SCRIPT_MARKER, replacement)
        if isinstance(value, list):
            return [rewrite(item) for item in value]
        if isinstance(value, dict):
            return {key: rewrite(item) for key, item in value.items()}
        return value

    merged = dict(existing or {})
    merged["hooks"] = rewrite(data["hooks"])
    return merged, ("hooks registered from %s, pointed at the primary's "
                    "own scripts" % primary_settings)


def head_state(repo):
    """(branch or None, full head sha or None).

    Reads git()'s stdout only. A warning on stderr - the unreadable-
    excludes-file case git_report() exists for - has no NUL and no
    fixed width, so folded into either of these two single-line answers
    it silently changes what .strip() returns: a real branch name grows
    a second line, and a real 40-character sha stops being 40
    characters and reads as unresolvable. Both cases were reachable
    before this function stopped seeing stderr at all.
    """
    code, branch, _err = git(repo, "symbolic-ref", "--quiet", "--short",
                             "HEAD")
    branch = branch.strip() if code == 0 and branch.strip() else None
    code, sha, _err = git(repo, "rev-parse", "HEAD")
    sha = sha.strip()
    return branch, (sha if code == 0 and len(sha) == 40 else None)


def dirty_paths(repo):
    """{path} for everything git reports as not committed.

    Untracked files count. A worktree holding an untracked file is a
    worktree holding work nobody can recover once the directory is
    deleted, which is exactly what the death protocol is about.

    Reads git()'s stdout only - see git()'s own docstring for why a
    machine parser here never touches stderr. On a clean tree, real
    stdout is the empty string, and nothing below validates a field's
    SHAPE before reading it as a status-and-path pair: any non-empty
    text - a warning line from the unreadable global excludes file case
    included - reads as one, its first two characters becoming a
    status column and the rest becoming a path. `agent-park` trusts
    this set completely, so a stray warning folded in here is a phantom
    path, and a worktree with no uncommitted work gets refused for
    holding one.
    """
    code, out, _err = git(repo, "status", "--porcelain", "-z")
    if code != 0:
        return None
    paths = set()
    fields = [field for field in out.split("\0") if field]
    index = 0
    while index < len(fields):
        entry = fields[index]
        index += 1
        if len(entry) < 4:
            continue
        status, path = entry[:2], entry[3:]
        paths.add(path)
        # A rename spends two NUL-separated fields: the status and the
        # new path, then the old path on its own. Reading that second
        # field as a status entry would report a path with no status
        # and drop the next real one.
        if "R" in status and index < len(fields):
            paths.add(fields[index])
            index += 1
    return paths


def eol_problems(repo):
    """(fixable, committed, binary) for every end-of-line pin in the tree.

    fixable   [(path, worktree form, declared form)] - the stale-worktree
              trap. The index is right, the working file is not, and
              re-checking the file out is the whole repair.
    committed [(path, index form)] - the index itself holds CRLF for a
              file pinned to LF. That is a defect in a COMMIT and no
              amount of re-checking-out fixes it, so it is reported and
              never touched.
    binary    [path] - a file the pin declares text whose content reads
              as binary. Same reasoning: a repair here would be a guess
              about bytes, and this verb does not guess about bytes.
    """
    code, out, _err = git(repo, "ls-files", "--eol", "-z")
    if code != 0:
        return None, None, None
    fixable, committed, binary = [], [], []
    for record in out.split("\0"):
        if not record.strip():
            continue
        match = EOL_LINE.match(record)
        if not match:
            continue
        index_eol, work_eol, attrs, path = match.groups()
        declared = next((value.split("=")[1] for value in DECLARED
                         if value in attrs), None)
        if declared is None:
            continue
        # An empty file, or one with no line break in it at all, has no
        # end-of-line form to be wrong about.
        if work_eol == "none":
            continue
        if work_eol == "-text":
            binary.append(path)
            continue
        # Every text pin stores LF in the index, eol=crlf included: the
        # attribute describes the CHECKOUT, not the object. So anything
        # other than LF in the index is the committed-CRLF defect.
        if index_eol not in ("lf", "none"):
            committed.append((path, index_eol))
            continue
        if work_eol != declared:
            fixable.append((path, work_eol, declared))
    return fixable, committed, binary


def renormalize(repo, paths):
    """Re-check-out `paths` so the working tree matches its pins.

    Deleted first, then restored, because git may keep a working file
    whose stat information it already believes and the point here is to
    force the bytes to be written again. Chunked because a stale
    worktree can hold hundreds of these and every platform has an
    argument-length ceiling.
    """
    for path in paths:
        full = os.path.join(repo, path)
        if os.path.isfile(full):
            os.remove(full)
    for start in range(0, len(paths), 50):
        code, out, err = git(repo, "checkout", "--", *paths[start:start + 50])
        if code != 0:
            return git_report(out, err)
    return None


def dependency_state(repo):
    """What the lint stage will find, and whether it may be installed.

    Returns (present, junctioned, target). `junctioned` is the case
    ./run bootstrap was taught about and the reason this returns a
    triple rather than a boolean: a node_modules that resolves
    elsewhere is somebody else's install, shared read-only, and an
    `npm ci` aimed at it does not fail - it succeeds, into the primary
    checkout, and takes that checkout's tooling apart on the way.
    """
    modules = os.path.join(repo, "node_modules")
    if not os.path.exists(modules):
        return False, False, None
    resolved = os.path.realpath(modules)
    junctioned = resolved != os.path.abspath(modules)
    return os.path.isfile(os.path.join(repo, ESLINT_ENTRY)), junctioned, (
        resolved if junctioned else None)


def python_gate_tools_present():
    """(ruff, fontTools[woff]) - each True if importable right now.

    A MACHINE fact rather than a worktree fact, unlike node_modules:
    pip installs into the interpreter this process is already running
    under, not into `repo`, so there is nothing here for a second
    worktree to share, junction into or shadow - two worktrees on one
    machine either both see the tools or neither does.

    `sys.executable -m ruff` rather than `shutil.which("ruff")`, because
    it is the route tools/check.py itself falls back to when "ruff" is
    not on PATH, and checking for a route this verb never exercises
    would be checking the wrong thing.

    fontTools needs its "woff" extra (brotli) to read the format
    check_fonts.py's whole job is reading, but merely importing the
    woff2 submodule does NOT prove the extra landed (a gap a review
    found, S18-MINOR4, #310): woff2.py wraps its own `import brotli`
    in a try/except and sets a module-level `haveBrotli = False` on
    failure rather than raising, so `from fontTools.ttLib.woff2 import
    WOFF2Reader` succeeds either way - the ImportError only fires
    later, inside `WOFF2Reader.__init__`, which is exactly the "still
    fail later, inside the check, on a font it cannot open" case this
    probe exists to catch before it happens. Asserting the flag itself
    is what proves brotli, not just fontTools, actually landed.
    """
    ruff_ok = subprocess.run(
        [sys.executable, "-m", "ruff", "--version"],
        capture_output=True, text=True).returncode == 0
    fonttools_ok = subprocess.run(
        [sys.executable, "-c",
         "from fontTools.ttLib.woff2 import haveBrotli\nassert haveBrotli"],
        capture_output=True, text=True).returncode == 0
    return ruff_ok, fonttools_ok


def install_python_gate_tools(requirements):
    """returncode for installing the gate's pinned Python tooling.

    `sys.executable -m pip`, never a bare `python` - this machine's PATH
    has resolved that to a Microsoft Store stub that exits nonzero on
    every invocation before now, and the interpreter this process is
    already running under is unambiguous where a PATH lookup is not.
    The command this runs, spelled out for a human rather than through
    sys.executable, is:

        py -3 -m pip install --quiet -r tools/requirements-gate.txt

    0.9-M0-S19 documents that literal line; this function is what it is
    quoting.
    """
    return subprocess.run(
        [sys.executable, "-m", "pip", "install", "--quiet",
         "-r", requirements]).returncode


def bound_ports(block):
    """Ports in `block` observed bound, or None if nothing could observe.

    Corroboration only, and the docstring says so because the temptation
    to promote it is real: an agent that holds a lease and has not
    started its server yet is INVISIBLE here, which is how two agents
    once read a clean netstat and took the same block. A lease file is
    the authority; this is what lets a message about a suspicious lease
    say something true about the machine as well.
    """
    command = (["netstat", "-ano"] if os.name == "nt"
               else ["netstat", "-ltn"])
    try:
        done = subprocess.run(command, capture_output=True, text=True)
    except (OSError, ValueError):
        return None
    if done.returncode != 0:
        return None
    found = set()
    for port in range(block[0], block[1] + 1):
        if re.search(r"[:.]%d\b" % port, done.stdout):
            found.add(port)
    return found


def registered_worktrees(repo):
    """{absolute path} for every worktree git knows about, or None."""
    code, out, _err = git(repo, "worktree", "list", "--porcelain")
    if code != 0:
        return None
    return {os.path.abspath(line[len("worktree "):])
            for line in out.splitlines() if line.startswith("worktree ")}


def lease_path(block, state=None):
    return os.path.join(leases_dir(state), "%d.json" % block[0])


def lease_reclaimable(lease, repo, state=None):
    """Why this lease may be taken over, or None if it may not.

    Three proofs, all mechanical, none of them a timeout. A lease does
    not go stale by being old - an agent can hold a block for an hour
    without binding anything - it goes stale by its holder ceasing to
    exist, and each of these establishes that:

      - the directory it names is gone;
      - git no longer registers that directory as a worktree, which is
        what a reaped worktree looks like from here;
      - the holder's own record says it parked, which is the death
        certificate saying so in the holder's own hand.
    """
    holder = lease.get("worktree")
    if not holder:
        return "the lease names no worktree at all"
    if not os.path.isdir(holder):
        return "its worktree %s is not on disk" % holder
    known = registered_worktrees(repo)
    if known is not None and os.path.abspath(holder) not in known:
        return "%s is not a registered worktree of this repository" % holder
    record = read_json(record_path(holder, state))
    if record and record.get("state") == "parked":
        return "its worktree %s is parked" % holder
    return None


def current_lease(repo, state=None):
    """The block this worktree already holds, or None.

    Asked BEFORE any allocation, and that order is the fix for a real
    defect: the scan below walks the blocks in order and recognizes this
    worktree's own lease when it reaches it, so a worktree holding the
    third block and asking again was handed the first one as well. Two
    leases, one agent, and a block nobody could take because its holder
    was not using it.
    """
    mine = os.path.abspath(repo)
    for block in [*PORT_BLOCKS, PRIMARY_BLOCK]:
        lease = read_json(lease_path(block, state))
        if lease and os.path.abspath(lease.get("worktree", "")) == mine:
            return block
    return None


def take_lease(repo, branch, state=None, requested=None, reclaim=False):
    """(block, note) for the port block this worktree holds, or (None, why).

    Allocation is a file created with O_EXCL, which is the whole
    mechanism: two agents racing for one block cannot both succeed,
    where two agents reading a list and then writing to it can. The
    holder's own lease is recognized and kept, so a second init changes
    nothing.
    """
    os.makedirs(leases_dir(state), exist_ok=True)
    mine = os.path.abspath(repo)
    blocks = [PRIMARY_BLOCK] if requested == "primary" else PORT_BLOCKS
    wanted = PRIMARY_BLOCK[0] if requested == "primary" else requested
    if isinstance(requested, int):
        blocks = [block for block in PORT_BLOCKS if block[0] == requested]
        if not blocks:
            return None, ("%d starts no block this fleet allocates. The "
                          "blocks are %s." % (requested, blocks_as_text()))

    already = current_lease(repo, state)
    if already and (wanted is None or wanted == already[0]):
        return already, "already leased to this worktree"

    def hand_over(block, note):
        """Give back the block this worktree was on, once on the new one.

        Once, and not before: releasing first and then failing to take
        the requested block would leave the agent holding nothing, which
        is worse than holding the block it asked to leave.
        """
        if already and already != block:
            os.remove(lease_path(already, state))
            return block, note + ", releasing %d-%d it held" % already
        return block, note

    held = []
    for block in blocks:
        path = lease_path(block, state)
        existing = read_lease(path)
        if existing is not None:
            if os.path.abspath(existing.get("worktree", "")) == mine:
                return hand_over(block, "already leased to this worktree")
            why = lease_reclaimable(existing, repo, state)
            if why or reclaim:
                superseded = existing.get("worktree", "an unnamed worktree")
                write_lease(path, mine, branch, block)
                return hand_over(block, "reclaimed from %s, because %s"
                                 % (superseded,
                                    why or "--reclaim was passed"))
            held.append((block, existing))
            continue
        try:
            handle = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            # Lost the race between the read above and here. The other
            # agent holds it; try the next block.
            held.append((block, read_lease(path) or {}))
            continue
        write_new_lease(handle, mine, branch, block)
        return hand_over(block, "newly leased")

    return None, lease_refusal(held)


def read_lease(path):
    """The lease at `path` as a record, or None if there is no file there.

    A file that exists and holds nothing readable answers as an EMPTY
    record rather than as an absent one, and the difference between
    those two answers is a port block. Creating the file and writing it
    cannot be one instruction, so a kill in the gap leaves a zero-byte
    lease; read_json cannot tell that from a missing file, and an
    allocator that reads it as missing goes on to fail the exclusive
    create against the file that is sitting right there - and treats the
    block as taken by a holder no message can name.

    An empty record is the input lease_reclaimable's first clause exists
    for: it names no worktree, so nothing establishes a live holder, so
    it is taken over and said out loud. Answering None here instead
    would make an unreadable lease FREE, which is the opposite error and
    the worse one - a live agent's block could be stolen by corrupting
    its lease.
    """
    if not os.path.exists(path):
        return None
    existing = read_json(path)
    return existing if isinstance(existing, dict) else {}


def lease_record(worktree, branch, block):
    return {
        "schema": SCHEMA,
        "block": list(block),
        "worktree": worktree,
        "branch": branch,
        "leased_at": now(),
    }


def write_lease(path, worktree, branch, block):
    write_json(path, lease_record(worktree, branch, block))


def write_new_lease(handle, worktree, branch, block):
    """Fill a lease through the descriptor the exclusive create returned.

    One open rather than an open, a close and a second open: the gap
    between a lease existing and a lease being readable is the window
    that produces a zero-byte lease, and closing the file only to
    reopen it by name widens that window for no gain. It does not
    ELIMINATE the window - no sequence of writes is proof against a
    kill - which is why read_lease above still has to recover from it.
    """
    with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as file:
        json.dump(lease_record(worktree, branch, block), file, indent=2,
                  sort_keys=True)
        file.write("\n")


def blocks_as_text():
    return ", ".join("%d-%d" % block for block in PORT_BLOCKS)


def lease_refusal(held):
    """The message for a full lease table - a state, not a bug."""
    lines = ["every port block this fleet allocates is leased, and none "
             "of them is provably free:"]
    for block, lease in held:
        observed = bound_ports(block)
        if observed is None:
            evidence = "nothing here could observe the ports"
        elif observed:
            evidence = "ports %s are bound" % ", ".join(
                str(port) for port in sorted(observed))
        else:
            # The pack's own finding, mechanized: silence here is not
            # evidence of a dead holder.
            evidence = ("no port in it is bound, which is consistent with "
                        "a dead holder and does not prove one - an agent "
                        "that has not started its server yet is invisible "
                        "to netstat")
        lines.append("  %d-%d  held by %s since %s; %s"
                     % (block[0], block[1],
                        lease.get("worktree", "an unnamed worktree"),
                        lease.get("leased_at", "an unrecorded time"),
                        evidence))
    lines.append("remedy: run `./run agent-park` in whichever of those "
                 "worktrees is finished, which releases its block; or, "
                 "once you have established a holder is gone, "
                 "`./run agent-init --ports <start> --reclaim`, which "
                 "prints what it superseded.")
    return "\n".join(lines)


def release_lease(repo, state=None):
    """The block this worktree held, dropped. Idempotent."""
    block = current_lease(repo, state)
    if block:
        os.remove(lease_path(block, state))
    return block


def scratch_root():
    """The parent every scratch directory is made under.

    Overridable for the same reason the state directory is: the suite
    drives this against a directory it can delete afterwards, and
    without that every suite run leaks a directory into the shared
    parent - measured, eight of them, because the temporary
    repositories a suite builds are never parked and park is what
    removes a scratch directory. It doubles as the escape hatch on a
    machine whose temporary directory is not where scratch belongs.
    """
    return os.environ.get("BINDER_SCRATCH_ROOT") or os.path.join(
        tempfile.gettempdir(), "binder-scratch")


def take_scratch(branch, existing=None):
    """A scratch directory outside the repository tree, made once.

    Outside is the requirement, not a preference: the lint stage reads
    the tree it is pointed at, and a scratch directory inside a worktree
    has already cost a slice a full gate run. The branch name is in the
    path because the shared session scratchpad is shared, and same-named
    files there have overwritten each other mid-slice.
    """
    if existing and os.path.isdir(existing):
        return existing
    parent = scratch_root()
    os.makedirs(parent, exist_ok=True)
    slug = re.sub(r"[^A-Za-z0-9._-]", "-", branch or "detached")
    return tempfile.mkdtemp(prefix=slug + "-", dir=parent)


def scratch_disposition(record):
    """(the recorded scratch path, whether a teardown may delete it).

    One answer, read by the dry run and by the act. A dry run that
    computes its own version of a decision is a dry run that can
    disagree with the verb it claims to describe, and the whole value of
    the dry run is that it does not.
    """
    scratch = record.get("scratch")
    if not scratch or not os.path.isdir(scratch):
        return scratch, False
    return scratch, within(scratch, scratch_root())


def initialization_problems(repo=None, state=None):
    """Every reason this worktree counts as uninitialized, as lines.

    THE CALLABLE THE GATE'S FIRST STAGE CONSUMES. An empty list means
    `./run agent-init` has been run here, under this contract, and the
    conditions it establishes still hold. It reads state and runs one
    git command; it changes nothing, so a stage may call it before
    deciding whether to spend forty stages on the tree.

    Each line is written to be printed to the agent that skipped the
    verb, so each one ends in the same remedy rather than in a
    diagnosis nobody can act on.
    """
    repo = REPO if repo is None else repo
    remedy = "Run `./run agent-init` (PowerShell: `.\\run agent-init`)."
    record = read_json(record_path(repo, state))
    if record is None:
        return ["this worktree has no initialization record, so nothing "
                "has established that its line endings, its dependencies "
                "or its port block are in a state the gate can trust. "
                + remedy]
    problems = []
    if record.get("contract") != CONTRACT:
        problems.append(
            "the initialization record was written under contract %s and "
            "this one is %d, so what it established is not what is "
            "required now. %s"
            % (record.get("contract", "an unrecorded version"), CONTRACT,
               remedy))
    if record.get("state") != "live":
        problems.append(
            "the initialization record says this worktree is %s, so an "
            "agent working in it is working in a worktree something else "
            "believes is finished and may delete. %s"
            % (record.get("state", "in no recorded state"), remedy))
    # Only the fixable class belongs here. A CRLF byte in the index and
    # a text pin over binary content are defects in COMMITS, which the
    # verb refuses to touch and the gate is entitled to fail on; calling
    # them uninitialization would send an agent to run a verb that
    # cannot help it.
    fixable, _committed, _binary = eol_problems(repo)
    if fixable is None:
        problems.append("git could not read this worktree's end-of-line "
                        "state, so it is not a checkout this contract can "
                        "speak for. " + remedy)
    elif fixable:
        problems.append(
            "%d file(s) hold the wrong end-of-line form for what "
            ".gitattributes pins - %s. git status is clean and the byte "
            "comparisons in the gate are not, which is the stale-worktree "
            "trap rather than a defect in the tree. %s"
            % (len(fixable), ", ".join(path for path, _, _ in fixable[:3]),
               remedy))
    present, junctioned, _ = dependency_state(repo)
    if not present:
        problems.append(
            "%s is not there, and the gate reports that absence as a "
            "FAILED lint stage rather than as a missing install. %s"
            % (ESLINT_ENTRY.replace(os.sep, "/"), remedy))
    if junctioned and not present:
        problems.append(
            "node_modules resolves outside this worktree and the lint "
            "entry point is not in it, so the shared install is broken "
            "rather than absent. " + remedy)
    return problems


def probe_readiness(repo):
    """(ok, what it says). One real gate stage, and it is named as one."""
    node = find_node()
    if node is None:
        return False, ("node is not on PATH or in the usual install "
                       "locations, and every Node stage of the gate "
                       "needs it.")
    script = os.path.join(repo, PROBE[1][0])
    if not os.path.isfile(script):
        return False, ("%s is not in this worktree, which means the "
                       "checkout predates the generator the gate compares "
                       "against. Fetch and check out the current tip."
                       % PROBE[1][0])
    done = subprocess.run([node, *PROBE[1]], cwd=repo,
                          capture_output=True, text=True)
    if done.returncode == 0:
        return True, PROBE[0]
    return False, (done.stdout + done.stderr).strip()


def fail(message, remedy=None):
    print("\nagent-init: REFUSED\n")
    print(message)
    if remedy:
        print("\nremedy: %s" % remedy)
    return 1


def do_init(args):
    repo = os.path.abspath(args.repo or REPO)
    state = args.state
    kind, common = worktree_kind(repo)
    if kind is None:
        return fail("%s is not a git checkout: %s" % (repo, common),
                    "run this from inside the repository, or from a "
                    "worktree of it.")

    if args.verify:
        problems = initialization_problems(repo, state)
        for problem in problems:
            print(problem)
        if not problems:
            print("initialized: contract %d, record %s"
                  % (CONTRACT, record_path(repo, state)))
        return 1 if problems else 0

    branch, head = head_state(repo)
    print("=== agent-init: the worktree contract ===\n")
    print("worktree     %s" % repo)
    print("checkout     %s worktree; git dir shared at %s" % (kind, common))
    print("head         %s @ %s"
          % (branch or "DETACHED", head or "an unreadable HEAD"))

    # 1. Line endings, before anything measures bytes.
    dirty = dirty_paths(repo)
    if dirty is None:
        return fail("git status could not be read in %s." % repo,
                    "check that this directory is a healthy checkout.")
    fixable, committed, binary = eol_problems(repo)
    if fixable is None:
        return fail("git could not report the end-of-line state of %s."
                    % repo, "check that this directory is a healthy "
                            "checkout.")
    if committed:
        return fail(
            "%d file(s) hold CRLF IN THE INDEX under a pin that stores "
            "LF: %s. Re-checking them out cannot fix that; the wrong "
            "bytes are in a commit."
            % (len(committed), ", ".join(path for path, _ in committed)),
            "`git add --renormalize .` on a branch, review the diff, and "
            "commit it. This verb does not rewrite history or stage "
            "anything.")
    if binary:
        return fail(
            "%d file(s) are pinned as text and hold content git reads as "
            "binary: %s." % (len(binary), ", ".join(binary)),
            "restore those files from a known-good commit; a repair here "
            "would be a guess about bytes.")
    blocked = [path for path, _, _ in fixable if path in dirty]
    if blocked:
        return fail(
            "%d file(s) need re-checking-out for their line endings and "
            "hold uncommitted changes: %s. Restoring them would delete "
            "that work." % (len(blocked), ", ".join(blocked)),
            "commit or stash those files, then run this again. Nothing "
            "has been changed.")
    if fixable:
        error = renormalize(repo, [path for path, _, _ in fixable])
        if error:
            return fail("re-checking out the mismatched files failed: %s"
                        % error, "resolve the git error above and run "
                                 "this again.")
        after, _, _ = eol_problems(repo)
        if after:
            return fail(
                "%d file(s) still hold the wrong end-of-line form after "
                "being re-checked-out: %s."
                % (len(after), ", ".join(path for path, _, _ in after)),
                "a checkout that does not take the pin is a git "
                "configuration problem on this machine - check "
                "core.autocrlf and core.eol.")
        print("line endings %d file(s) renormalized to their pins: %s"
              % (len(fixable),
                 ", ".join(path for path, _, _ in fixable[:6])
                 + (", ..." if len(fixable) > 6 else "")))
    else:
        print("line endings every pinned file already matches its pin")

    # 2. Dependencies, junction-safe.
    present, junctioned, target = dependency_state(repo)
    if present and junctioned:
        print("dependencies %s resolves through a junction to %s - shared, "
              "read-only, not installing"
              % (ESLINT_ENTRY.replace(os.sep, "/"), target))
    elif present:
        print("dependencies %s is present - not installing"
              % ESLINT_ENTRY.replace(os.sep, "/"))
    elif junctioned:
        return fail(
            "node_modules in this worktree resolves to %s and the lint "
            "entry point is not there, so the shared install is broken "
            "rather than absent. Installing would write THROUGH the "
            "junction and take the other checkout's install apart."
            % target,
            "repair or remove the junction from the checkout that owns "
            "it, then run this again.")
    elif args.no_install:
        print("dependencies absent, and --no-install was passed - the "
              "lint stage of the gate will report FAILED")
    elif not os.path.isfile(os.path.join(repo, "package.json")):
        # Field note, 0.9-M0-S6 (#286): the harness spawned a worktree at
        # an ancient tip with no package.json, and `npm ci` run from
        # there did not fail - it walked UP the directory tree, found
        # the primary checkout's package.json, and reinstalled ITS
        # node_modules before this verb went on to refuse for the real
        # reason. No damage that time only because the shared install
        # verified intact afterwards; the walk-up itself is not
        # contained by cwd and is not a chance worth taking twice. A
        # repo root with no package.json has nothing here to install
        # against, so this skips rather than letting npm choose a
        # directory on its own.
        print(
            "dependencies absent, and %s has no package.json - skipping "
            "the install rather than letting npm walk up into a "
            "different checkout. The lint stage of the gate will report "
            "FAILED until this worktree is on a branch that has one."
            % repo)
    else:
        npm = shutil.which("npm")
        if npm is None:
            return fail("npm is not on PATH and node_modules is absent.",
                        "install Node.js, which brings npm with it.")
        print("dependencies absent - installing with --ignore-scripts")
        done = subprocess.run([npm, "ci", "--ignore-scripts"], cwd=repo)
        if done.returncode != 0:
            return fail("npm ci failed in %s." % repo,
                        "read npm's output above; nothing else here has "
                        "been changed.")
        present, _, _ = dependency_state(repo)
        if not present:
            return fail(
                "npm ci reported success and %s is still not there."
                % ESLINT_ENTRY.replace(os.sep, "/"),
                "check the install for a partial or interrupted state.")

    # 2b. Python gate tooling: ruff and fontTools[woff]. The same
    # dependency-completeness question as step 2, but for the checks
    # tools/check.py runs directly rather than through npm - a clean
    # local gate needs both halves, and until now this verb only ever
    # answered for the Node one (MINOR4, #310).
    requirements = os.path.join(repo, GATE_REQUIREMENTS)
    ruff_ok, fonttools_ok = python_gate_tools_present()
    if ruff_ok and fonttools_ok:
        print("py deps      ruff and fontTools[woff] already importable - "
              "skipping the install")
    elif args.no_install:
        print("py deps      absent, and --no-install was passed - the "
              "ruff (python) and font-coverage stages of the gate will "
              "report FAILED")
    elif not os.path.isfile(requirements):
        # Mirrors the no-package.json skip above rather than refusing:
        # a worktree checked out at a tip before this file existed has
        # nothing here to install from, and that is a fact about which
        # commit is checked out, not a defect this verb repairs.
        print(
            "py deps      absent, and %s is not in this worktree - "
            "skipping the install. The ruff (python) and font-coverage "
            "stages of the gate will report FAILED until this worktree "
            "is on a branch that has one." % GATE_REQUIREMENTS.replace(
                os.sep, "/"))
    else:
        print("py deps      installing from %s"
              % GATE_REQUIREMENTS.replace(os.sep, "/"))
        code = install_python_gate_tools(requirements)
        if code != 0:
            return fail(
                "%s -m pip install -r %s failed."
                % (os.path.basename(sys.executable),
                   GATE_REQUIREMENTS.replace(os.sep, "/")),
                "read pip's output above; nothing else here has been "
                "changed.")
        ruff_ok, fonttools_ok = python_gate_tools_present()
        if not (ruff_ok and fonttools_ok):
            missing = ", ".join(
                name for name, ok in
                (("ruff", ruff_ok), ("fontTools[woff]", fonttools_ok))
                if not ok)
            return fail(
                "pip reported success and %s still cannot be imported."
                % missing,
                "check the install for a partial or interrupted state.")

    # 2c. Hooks: point this worktree's own registration at the PRIMARY's
    # guard scripts (#347) - `.claude/` is gitignored, so a linked
    # worktree carries no `.claude/hooks/*.py` or `.claude/settings.json`
    # of its own, and nothing here has ever registered the project hooks
    # for a session whose project directory is this worktree. Never runs
    # for the primary itself (kind == "primary" skips it entirely, so
    # the primary's own settings.json is never touched by this verb).
    # See plant_hook_registration()'s own docstring for the whole
    # argument, including why this copies nothing, why "permissions" is
    # never planted, and why $CLAUDE_PROJECT_DIR survives in SessionStart.
    hook_note = None
    if kind == "linked":
        primary = primary_root(repo)
        if primary is None:
            hook_note = ("could not determine the primary checkout's "
                         "root - skipping hook registration")
        else:
            worktree_settings = os.path.join(repo, ".claude", "settings.json")
            planted, hook_note = plant_hook_registration(
                primary, read_json(worktree_settings))
            if planted is not None:
                write_json(worktree_settings, planted)
        print("hooks        %s" % hook_note)

    # 3. Gate readiness: one real stage, named as one.
    #
    # The order of these two refusals is the whole point of the stage. A
    # real gate stage is a real program with real imports - this one
    # parses JavaScript with acorn, out of node_modules - so with the
    # dependencies absent it fails on a missing module and says nothing
    # whatever about the tree. Reporting that as a defect in the tree
    # would be this verb committing the exact cry-wolf failure it exists
    # to end. Found by running the verb on a throwaway worktree rather
    # than by reasoning about it: the suite's stand-in stage imports
    # nothing, so no arm here could have seen it.
    ok, said = probe_readiness(repo)
    if not ok and not present:
        return fail(
            "the readiness probe could not RUN. It runs the gate stage "
            "%s, which needs the installed dependencies, and node_modules "
            "is absent here:\n\n%s" % (PROBE[0], said),
            "run this again and let it install - the probe depends on "
            "the install, so skipping one skips the other. Nothing has "
            "been established about the tree either way.")
    if not ok:
        return fail(
            "the readiness probe failed, and the line endings above are "
            "already right - so believe this one. It ran the gate stage "
            "%s and got:\n\n%s" % (PROBE[0], said),
            "this is a defect in the tree rather than in the worktree. "
            "Fix it, or `./run check` for the whole picture.")
    print("readiness    gate stage %s: ok. THE ENVIRONMENT IS READY; the "
          "tree is not thereby green - `./run check` is the gate." % said)

    # 4. The contract, generated from what was just established.
    record = read_json(record_path(repo, state)) or {}
    requested = "primary" if kind == "primary" else args.ports
    block, note = take_lease(repo, branch, state, requested, args.reclaim)
    if block is None:
        return fail(note)
    scratch = take_scratch(branch, record.get("scratch"))
    record.update({
        "schema": SCHEMA,
        "contract": CONTRACT,
        "worktree": repo,
        "kind": kind,
        "branch": branch,
        "state": "live",
        "initialized_at": now(),
        "ports": list(block),
        "scratch": scratch,
    })
    record.pop("park", None)
    write_json(record_path(repo, state), record)
    print_contract(repo, kind, branch, block, note, scratch, state, hook_note)
    return 0


def print_contract(repo, kind, branch, block, note, scratch, state,
                   hook_note=None):
    print("\n--- the environment contract ---\n")
    if kind == "primary":
        print("1. checkout   This is the PRIMARY checkout, shared by the "
              "machine.\n"
              "              Nothing may detach it and no agent may park "
              "it.")
    elif branch:
        print("1. checkout   This worktree holds the branch %s. No other "
              "worktree can\n"
              "              check it out while this one does, which is "
              "why\n"
              "              `./run agent-park` detaches before you "
              "terminate." % branch)
    else:
        print("1. checkout   HEAD here is detached, which is the state a "
              "worktree is\n"
              "              handed to you in. Branch from "
              "origin/accounts before you\n"
              "              edit, so the work has a ref a landing can "
              "move.")
    print("2. ports      %d-%d, leased to this worktree (%s).\n"
          "              The lease file is the announcement; nothing "
          "outside this\n"
          "              block is yours, and %d-%d belong to the primary "
          "checkout."
          % (block[0], block[1], note, PRIMARY_BLOCK[0], PRIMARY_BLOCK[1]))
    print("3. scratch    %s\n"
          "              Outside the repository, which is the rule: the "
          "lint stage\n"
          "              reads what is in the tree." % scratch)
    if hook_note is not None:
        print("4. hooks      %s\n"
              "              (#347: a linked worktree's own .claude/ is "
              "gitignored - this is\n"
              "              how the project's guard hooks reach a "
              "session rooted here.)" % hook_note)
        print("5. teardown   `./run agent-park` before you terminate. It "
              "detaches the\n"
              "              branch, releases the block, removes the "
              "scratch directory\n"
              "              and writes the record a reaper can prove "
              "this worktree\n"
              "              dead from. Record: %s"
              % record_path(repo, state))
    else:
        print("4. teardown   `./run agent-park` before you terminate. It "
              "detaches the\n"
              "              branch, releases the block, removes the "
              "scratch directory\n"
              "              and writes the record a reaper can prove "
              "this worktree\n"
              "              dead from. Record: %s"
              % record_path(repo, state))
    print("\nre-run this verb any time; it is idempotent.")


def describe_scratch(scratch, removed, refused, trouble):
    """One line for what became of the scratch directory.

    A refusal reads as a refusal rather than as "none to remove". The
    path belongs to somebody, it is still on disk, and a teardown that
    says nothing about a directory it declined to touch leaves it for
    nobody to find.
    """
    if refused:
        return ("REFUSED - %s is not under %s, so it is reported and left "
                "alone." % (refused, scratch_root()))
    if trouble:
        return "%s could NOT be removed: %s" % (scratch, trouble)
    return "%s removed" % scratch if removed else "none to remove"


def report_park(repo, state, record):
    """What `agent-park` would do here, having done none of it.

    Every fact below is read. Nothing is detached, released, deleted or
    written, which is the entire contract of the flag. The exit status
    is park's own answer given in advance - 0 where it would park, 1
    where it would refuse - so a script can ask the question without
    taking the consequence, and so can an agent that is unsure.
    """
    print("=== agent-park --verify: what parking would do ===\n")
    dirty = dirty_paths(repo)
    if dirty is None:
        print("park would REFUSE: git status could not be read in %s."
              % repo)
        return 1
    if dirty:
        print("park would REFUSE: %d uncommitted or untracked path(s): %s."
              % (len(dirty), ", ".join(sorted(dirty)[:8])))
        print("\nA parked worktree is one a reaper may delete, so parking "
              "over uncommitted\nwork would be deleting it. Nothing here "
              "has been changed.")
        return 1
    branch, tip = head_state(repo)
    if tip is None:
        print("park would REFUSE: HEAD in %s does not resolve to a commit."
              % repo)
        return 1
    block = current_lease(repo, state)
    scratch, may_remove = scratch_disposition(record)
    if scratch and not os.path.isdir(scratch):
        said = "%s is already gone; nothing would be removed" % scratch
    elif scratch and may_remove:
        said = "%s would be removed" % scratch
    elif scratch:
        said = ("%s would be REFUSED - it is not under %s"
                % (scratch, scratch_root()))
    else:
        said = "none recorded"
    print("branch       %s would be detached at %s"
          % (branch or "none - HEAD is already detached", tip))
    print("clean        yes - no uncommitted or untracked path")
    print("ports        %s"
          % ("%d-%d would be released" % block if block else "none held"))
    print("scratch      %s" % said)
    print("marker       %s would be written" % record_path(repo, state))
    print("\nNothing has been changed. `./run agent-park` is what performs "
          "it.")
    return 0


def do_park(args):
    repo = os.path.abspath(args.repo or REPO)
    state = args.state
    kind, _ = worktree_kind(repo)
    if kind is None:
        return fail("%s is not a git checkout." % repo,
                    "run this from inside the worktree you are parking.")
    if kind == "primary":
        return fail(
            "%s is the PRIMARY checkout, not an agent worktree. Parking "
            "detaches HEAD, and detaching the primary takes the machine's "
            "shared checkout off its branch." % repo,
            "park the worktree you were working in instead.")

    record = read_json(record_path(repo, state)) or {}

    if args.verify:
        # The dry-run form of the DESTRUCTIVE verb, and the reason it
        # has to exist here as well as on init: --verify is documented
        # as the flag that changes nothing, so it is the flag an agent
        # reaches for when it is unsure - and being unsure about park is
        # exactly the state in which the act must not happen. Ignoring
        # it silently made the two consequential outcomes reachable by a
        # question: a LIVE worktree's block goes back to a pool another
        # agent allocates from, and the worktree acquires the death
        # certificate the reaper deletes on.
        #
        # Nothing below this branch runs, because everything below this
        # branch changes something.
        return report_park(repo, state, record)

    print("=== agent-park: the death protocol ===\n")

    dirty = dirty_paths(repo)
    if dirty is None:
        return fail("git status could not be read in %s." % repo,
                    "check that this directory is a healthy checkout.")
    if dirty:
        listed = ", ".join(sorted(dirty)[:8])
        return fail(
            "this worktree holds %d uncommitted or untracked path(s): %s. "
            "A parked worktree is one a reaper may delete, so parking "
            "over uncommitted work would be deleting it."
            % (len(dirty), listed),
            "commit what matters (a WIP commit is free), delete what does "
            "not, then run this again.")

    branch, tip = head_state(repo)
    if tip is None:
        return fail("HEAD in %s does not resolve to a commit." % repo,
                    "check that this directory is a healthy checkout.")
    if branch:
        code, out, err = git(repo, "checkout", "--detach")
        if code != 0:
            return fail("detaching HEAD failed: %s" % git_report(out, err),
                        "resolve the git error above and run this again.")
    _, head = head_state(repo)
    if head != tip:
        return fail(
            "HEAD moved while parking: expected %s, found %s." % (tip, head),
            "something else is working in this worktree. Establish what, "
            "then run this again.")

    code, _out, _err = git(repo, "merge-base", "--is-ancestor", tip,
                           "origin/accounts")
    merged = code == 0

    released = release_lease(repo, state)
    # Only a directory under the root this verb makes them in, and
    # `within` is what asks that as a question about paths. A teardown
    # that deletes a path out of a record it did not write is a teardown
    # that can delete anything, and a record this verb did not write is
    # precisely the case the guard exists for.
    scratch, may_remove = scratch_disposition(record)
    removed = False
    refused = None
    trouble = None
    if scratch and os.path.isdir(scratch):
        if may_remove:
            try:
                rmtree_hard(scratch)
            except OSError as problem:
                trouble = problem
            removed = not os.path.isdir(scratch)
        else:
            refused = scratch

    record.update({
        "schema": SCHEMA,
        "contract": CONTRACT,
        "worktree": repo,
        "kind": kind,
        "branch": branch,
        "state": "parked",
        "park": {
            "at": now(),
            "branch": branch,
            "tip": tip,
            "head": head,
            "clean": True,
            "merged": merged,
            "ports": list(released) if released else None,
            "scratch": scratch if removed else None,
        },
    })
    write_json(record_path(repo, state), record)

    print("branch       %s, detached at %s"
          % (branch or "none (HEAD was already detached)", tip))
    print("clean        yes - no uncommitted or untracked path")
    print("merged       %s origin/accounts at park time"
          % ("an ancestor of" if merged else "NOT an ancestor of"))
    print("ports        %s"
          % ("%d-%d released" % released if released else "none held"))
    print("scratch      %s" % describe_scratch(scratch, removed, refused,
                                               trouble))
    print("marker       %s" % record_path(repo, state))
    print("\nThis worktree is now provably finished: its branch is free "
          "for a landing,\nits block is back in the pool, and the marker "
          "above is what a reaper reads.\nThe reaper re-proves every one "
          "of those facts against this machine before it\ndeletes "
          "anything, and reports rather than deletes when a proof does "
          "not hold.")
    if not merged:
        print("\nNote: %s is not an ancestor of origin/accounts, so this "
              "branch still\ncarries unlanded work. That is normal for "
              "build-and-hold; the reaper's own\nancestry proof is what "
              "keeps it from being deleted early." % tip[:12])
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="./run agent-init",
        description="The worktree contract: make a checkout gate-ready "
                    "and print what the agent working in it is held to.")
    parser.add_argument("command", choices=["init", "park"])
    parser.add_argument("--verify", action="store_true",
                        help="change nothing and report: on init, "
                             "whether this worktree is initialized; on "
                             "park, what parking it would do")
    parser.add_argument("--ports", type=int, default=None,
                        help="request a specific block by its first port")
    parser.add_argument("--reclaim", action="store_true",
                        help="supersede the lease on the requested block, "
                             "printing what it superseded")
    parser.add_argument("--no-install", action="store_true",
                        help="report missing dependencies (node_modules, "
                             "the Python gate tools) instead of "
                             "installing them")
    # Both of these exist so the suite can drive this against a scratch
    # checkout and a scratch state directory. A rule exercised only
    # against the tree it guards cannot be shown to fail.
    parser.add_argument("--repo", default=None,
                        help=argparse.SUPPRESS)
    parser.add_argument("--state", default=None,
                        help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    return do_init(args) if args.command == "init" else do_park(args)


if __name__ == "__main__":
    sys.exit(main())
