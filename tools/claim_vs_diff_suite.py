"""Contract checks for the git-ops claim-vs-diff mechanism.

    py -3 tools/claim_vs_diff_suite.py

WHY THE ARMS SIT IN tools/ AND THE ENTRY POINT SITS IN tests/

`tests/` holds `.mjs` entry points and the 0.9 runner guards that: a
file there under any other extension is a stray. So the arms live
beside the module they test and `tests/claim-vs-diff.test.mjs` is the
entry point - five lines that find a Python and hand it this file.
0.9-M0-S7 settled that shim as the durable convention for a Python arm;
`tests/worktree-contract.test.mjs` and `tests/reaper.test.mjs` are the
first two instances, this is the third. This file holds every
assertion and the shim holds none.

Until the runner apparatus's own registration slice reaches this one
(if it has not already by the time this is read), both halves are run
by hand and no handoff may report either as gated.

WHY THIS BUILDS A REAL GIT REPOSITORY INSTEAD OF ASSERTING ON STRINGS

The subject under test is a comparison against a real `git diff`, and
the only trustworthy source of what git calls a rename, a deletion, or
an addition is git itself - a fixture made of hand-written dictionaries
would be a fixture of my own beliefs about git's own output shape, not
a proof about it. So every arm below runs against a small repository
built fresh under the system temporary directory with real commits and
real branches, and swept afterward the same way tools/reaper_suite.py
sweeps its own leftover roots.

Self-contained on purpose: no import from tools/reaper.py (the mission
brief's instruction - the timeout discipline is reused, the code is
not), no framework, no new dependency.
"""

import io
import os
import shutil
import subprocess
import sys
import tempfile
import time
from contextlib import redirect_stdout

# The module under test sits in this file's own directory, which Python
# puts on the path for a script it is handed - a plain import is the
# whole wiring.
import claim_vs_diff

# Encoding-safe stdout/stderr (0.9-M3-S29 fix wave, #449 F2): this
# suite's own fixtures write invalid-UTF-8 bytes on purpose, and its
# checks print the results - the same exposure ship_check.py's main()
# guards against. This file runs at import time (no __main__ guard, by
# this fleet's own convention - see the module docstring), and nothing
# imports it, so reconfiguring here is always the real run.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

failures = 0
performed = 0

# Asserted at the end rather than only printed. A hand-written total
# nothing compares against still prints a confident pass when a check
# stops running - an early return, a renamed helper - which is the
# armed-looking-but-not failure this repository holds to be worse than
# no check at all.
EXPECTED = 40


def check(label, condition):
    global failures, performed
    performed += 1
    if not condition:
        failures += 1
        print("FAIL  %s" % label)
    else:
        print("ok    %s" % label)


# No subprocess this suite starts may outlive it. A fixture git that
# waits for something is a suite that hangs a gate, and a hung gate is
# read as a slow one until somebody goes looking.
FIXTURE_TIMEOUT = 120


def git(repo, *args):
    done = subprocess.run(
        ["git", "-C", repo, "-c", "user.email=suite@example.invalid",
         "-c", "user.name=suite", *args],
        capture_output=True, text=True,
        encoding="utf-8", errors="replace",
        stdin=subprocess.DEVNULL,
        timeout=FIXTURE_TIMEOUT,
    )
    return done.returncode, done.stdout + done.stderr


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(data)


def write_bytes(path, data):
    """Like write() but for raw bytes - what a Python str literal cannot
    hold, which a LONE invalid-UTF-8 byte (0.9-M3-S29, #449's second
    fixture) is."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(data)


def git_show_report(repo, ref, path):
    """`git(repo, "show", "ref:path")` run in a SEPARATE process, so a
    crash inside it is observed rather than taking this suite down with
    it - the exact failure mode 0.9-M3-S29 (#449) exists to end.
    "OK <code> <ascii(out)>" on success, "CRASH <type> <message>" if the
    subprocess call itself raised (an uncaught UnicodeDecodeError,
    before this ticket's fix, is exactly that). `ascii()`, not `repr()`
    - the child's own stdout is written under ITS console codec, and
    this suite hit exactly the collision this ticket is about while
    piping a real curly quote back through `repr()`: cp1252 CAN encode
    U+201D (byte 0x94), but that lone byte is not valid UTF-8, so the
    parent's own errors="replace" read on the pipe silently turned it
    into U+FFFD before this string ever reached a check. `ascii()`
    escapes every non-ASCII codepoint to a `\\uXXXX` literal, so the
    channel between the two processes never carries a non-ASCII byte at
    all - the fixture's own transport can no longer reproduce the bug
    it exists to catch in the code under test."""
    script = (
        "import sys\n"
        "sys.path.insert(0, %r)\n"
        "import claim_vs_diff\n"
        "try:\n"
        "    code, out = claim_vs_diff.git(%r, 'show', %r)\n"
        "    print('OK', code, ascii(out))\n"
        "except Exception as exc:\n"
        "    print('CRASH', type(exc).__name__, str(exc))\n"
    ) % (os.path.dirname(os.path.abspath(claim_vs_diff.__file__)),
        repo, "%s:%s" % (ref, path))
    done = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        stdin=subprocess.DEVNULL, timeout=FIXTURE_TIMEOUT)
    return (done.stdout + done.stderr).strip()


# The name every working root of this suite is made under, and the only
# name the sweep below will delete.
PREFIX = "claim-vs-diff-suite-"

# How old a matching directory must be before the sweep believes it
# belongs to a FINISHED run. This suite takes seconds, so an hour is
# not a close call, and what it protects is a second agent running this
# file right now, whose working root carries the same name by
# construction.
STALE_AFTER = 3600


def sweep_prior_roots(parent, keep, now=None):
    swept = []
    now = time.time() if now is None else now
    for name in sorted(os.listdir(parent)):
        path = os.path.join(parent, name)
        if not name.startswith(PREFIX) or path == keep:
            continue
        if not os.path.isdir(path) or os.path.islink(path):
            continue
        if now - os.path.getmtime(path) < STALE_AFTER:
            continue
        try:
            shutil.rmtree(path)
        except OSError:
            continue
        swept.append(name)
    return swept


def run_tool(argv, stdin_text=None):
    """(exit code, everything it printed) for one claim_vs_diff.main() call.

    Driven in-process rather than as a subprocess, the same way
    tools/reaper_suite.py drives reaper.main(): stdin and stdout are
    both swapped out around the call, so a --declared-less invocation
    reads the fixture text this suite hands it rather than this
    process's real stdin.
    """
    buffer = io.StringIO()
    old_stdin = sys.stdin
    try:
        if stdin_text is not None:
            sys.stdin = io.StringIO(stdin_text)
        with redirect_stdout(buffer):
            code = claim_vs_diff.main(argv)
    finally:
        sys.stdin = old_stdin
    return code, buffer.getvalue()


parent = tempfile.gettempdir()
root = tempfile.mkdtemp(prefix=PREFIX, dir=parent)
swept = sweep_prior_roots(parent, root)
if swept:
    print("swept %d leftover root(s): %s" % (len(swept), ", ".join(swept)))

try:
    primary = os.path.join(root, "primary")
    os.makedirs(primary)
    git(primary, "init", "-b", "accounts")
    write(os.path.join(primary, "kept.txt"), "kept\n")
    write(os.path.join(primary, "old-name.txt"), "renamed content\n")
    write(os.path.join(primary, "to-delete.txt"), "going away\n")
    git(primary, "add", "-A")
    git(primary, "commit", "-m", "base")

    git(primary, "checkout", "-b", "slice-exact")
    write(os.path.join(primary, "new-file.txt"), "brand new\n")
    git(primary, "add", "-A")
    git(primary, "commit", "-m", "add new-file.txt")

    print("\n--- an exact declared match is MATCH, exit 0 ---")
    code, said = run_tool(["slice-exact", "accounts", "--repo", primary],
                          stdin_text="new-file.txt\n")
    check("exact match exits 0", code == 0)
    check("the report says MATCH", "MATCH" in said)
    check("declared-but-untouched is empty",
          "DECLARED-BUT-UNTOUCHED (0)" in said)
    check("touched-but-undeclared is empty",
          "TOUCHED-BUT-UNDECLARED (0)" in said)

    print("\n--- a declared-but-untouched path is named, mismatch exits "
          "1 ---")
    code, said = run_tool(["slice-exact", "accounts", "--repo", primary],
                          stdin_text="new-file.txt\nghost.txt\n")
    check("mismatch exits 1", code == 1)
    check("MISMATCH is printed", "MISMATCH" in said)
    check("ghost.txt is named as declared-but-untouched",
          "DECLARED-BUT-UNTOUCHED (1): ghost.txt" in said)
    check("touched-but-undeclared stays empty",
          "TOUCHED-BUT-UNDECLARED (0)" in said)

    print("\n--- a touched-but-undeclared path is named, mismatch exits "
          "1 ---")
    code, said = run_tool(["slice-exact", "accounts", "--repo", primary],
                          stdin_text="")
    check("mismatch exits 1", code == 1)
    check("new-file.txt is named as touched-but-undeclared",
          "TOUCHED-BUT-UNDECLARED (1): new-file.txt" in said)
    check("declared-but-untouched stays empty",
          "DECLARED-BUT-UNTOUCHED (0)" in said)

    print("\n--- a rename is counted on both sides, not dropped ---")
    git(primary, "checkout", "accounts")
    git(primary, "checkout", "-b", "slice-rename")
    git(primary, "mv", "old-name.txt", "new-name.txt")
    git(primary, "commit", "-m", "rename old-name.txt to new-name.txt")

    code, said = run_tool(["slice-rename", "accounts", "--repo", primary],
                          stdin_text="new-name.txt\n")
    check("declaring only the new name of a rename is a mismatch naming "
          "the old one",
          code == 1 and "TOUCHED-BUT-UNDECLARED (1): old-name.txt"
          in said)
    code, said = run_tool(["slice-rename", "accounts", "--repo", primary],
                          stdin_text="old-name.txt\nnew-name.txt\n")
    check("declaring both sides of the rename matches",
          code == 0 and "MATCH" in said)

    print("\n--- a deletion is counted, not dropped ---")
    git(primary, "checkout", "accounts")
    git(primary, "checkout", "-b", "slice-delete")
    git(primary, "rm", "to-delete.txt")
    git(primary, "commit", "-m", "remove to-delete.txt")

    code, said = run_tool(["slice-delete", "accounts", "--repo", primary],
                          stdin_text="")
    check("an undeclared deletion is touched-but-undeclared",
          code == 1 and "TOUCHED-BUT-UNDECLARED (1): to-delete.txt"
          in said)
    code, said = run_tool(["slice-delete", "accounts", "--repo", primary],
                          stdin_text="to-delete.txt\n")
    check("declaring the deleted path matches",
          code == 0 and "MATCH" in said)

    print("\n--- the declared-list parser tolerates a completion "
          "comment's own shape ---")
    messy = ("# a completion comment\n"
             "- `new-file.txt` - new, the whole point of this slice.\n"
             "\n"
             "  \n")
    check("bullets, backticks, comments and blank lines all parse to "
          "one path",
          claim_vs_diff.parse_declared(messy) == {"new-file.txt"})
    check("a backslash path normalizes to forward slashes",
          claim_vs_diff.parse_declared("tools\\x.py\n") == {"tools/x.py"})
    check("a leading ./ is stripped",
          claim_vs_diff.parse_declared("./tools/x.py\n") == {"tools/x.py"})

    print("\n--- a plain, undecorated line is not truncated at its "
          "first space (S13-F1) ---")
    # Review finding B1 (2026-08-14): parse_declared fell through to
    # line.split()[0] for any undecorated line, breaking the tool's own
    # documented "one path per line" contract for any space-containing
    # path. The backtick-quoted form (the fleet's actual comment shape)
    # was never affected - this fixture targets the plain form
    # specifically, since that is the form the contract names.
    git(primary, "checkout", "accounts")
    git(primary, "checkout", "-b", "slice-space")
    write(os.path.join(primary, "a path with spaces.txt"), "spacey\n")
    git(primary, "add", "-A")
    git(primary, "commit", "-m", "add a path with spaces.txt")

    check("parse_declared keeps a whole undecorated line as one path, "
          "not just its first token",
          claim_vs_diff.parse_declared("a path with spaces.txt\n")
          == {"a path with spaces.txt"})
    code, said = run_tool(["slice-space", "accounts", "--repo", primary],
                          stdin_text="a path with spaces.txt\n")
    check("a plain (undecorated) declared line containing a space "
          "matches, not a phantom truncated pair",
          code == 0 and "MATCH" in said)
    code, said = run_tool(["slice-space", "accounts", "--repo", primary],
                          stdin_text="`a path with spaces.txt`\n")
    check("the backtick-wrapped form still matches too (never broken)",
          code == 0 and "MATCH" in said)

    print("\n--- --declared reads a real file, not only stdin ---")
    declared_path = os.path.join(root, "declared.txt")
    write(declared_path, "new-file.txt\n")
    code, said = run_tool(["slice-exact", "accounts", "--repo", primary,
                           "--declared", declared_path])
    check("--declared FILE is honored", code == 0 and "MATCH" in said)

    print("\n--- a BOM at the start of a --declared file is tolerated "
          "(#387) ---")
    # PowerShell 5.1's `Set-Content -Encoding utf8` writes a UTF-8 byte-
    # order mark at the start of the file. Read with plain "utf-8" that
    # BOM decodes into a literal U+FEFF character glued onto the first
    # path, so the first declared path never matches the real diff -
    # a false MISMATCH that aborts a good landing at the door.
    check("parse_declared strips a leading BOM rather than treating it "
          "as part of the first path",
          claim_vs_diff.parse_declared("\ufeffnew-file.txt\n")
          == {"new-file.txt"})

    bom_match_path = os.path.join(root, "declared-bom.txt")
    with open(bom_match_path, "w", encoding="utf-8-sig",
              newline="\n") as handle:
        handle.write("new-file.txt\n")
    code, said = run_tool(["slice-exact", "accounts", "--repo", primary,
                           "--declared", bom_match_path])
    check("a BOM-carrying declared file still matches (BOM stripped, "
          "not read as part of the first path)",
          code == 0 and "MATCH" in said)

    print("\n--- a BOM-carrying declared file with a REAL mismatch "
          "still refuses (BOM tolerance never masks a genuine "
          "mismatch) ---")
    # F3 (review finding, 2026-08-21): a check that only asserts
    # `code == 1 and "MISMATCH" in said` is not discriminating here on
    # its own - ghost.txt is untouched either way, mark stripped or
    # not, so it mismatches under the UNFIXED tool too (the reviewer's
    # RED re-fire proved exactly this: that assertion was the one
    # survivor of four). What actually distinguishes fixed from unfixed
    # is the CONTENT of the delta: the unfixed tool would still be
    # carrying the mark on the declared path, so the untouched line
    # would read "...): \ufeffghost.txt", not "...): ghost.txt" - a
    # different substring that this check would (correctly) fail to
    # find. So the exit code and the exact clean path name are asserted
    # together, in one check, rather than split into a weak one and a
    # strong one.
    bom_mismatch_path = os.path.join(root, "declared-bom-mismatch.txt")
    with open(bom_mismatch_path, "w", encoding="utf-8-sig",
              newline="\n") as handle:
        handle.write("ghost.txt\n")
    code, said = run_tool(["slice-exact", "accounts", "--repo", primary,
                           "--declared", bom_mismatch_path])
    check("a BOM-carrying declared file with a real mismatch still "
          "exits 1 and names the CLEAN path (ghost.txt, not a "
          "mark-glued one) as declared-but-untouched",
          code == 1 and "MISMATCH" in said
          and "DECLARED-BUT-UNTOUCHED (1): ghost.txt" in said)

    print("\n--- the mark arriving as three separate mis-decoded "
          "characters (not one U+FEFF) is stripped too (F1, review "
          "finding, 2026-08-21) ---")
    # main()'s stdin path (sys.stdin.read()) decodes under the
    # process's own console locale, not forced UTF-8 - on a non-UTF-8
    # locale (cp1252, the reviewer's machine) the same three BOM bytes
    # (EF BB BF) come out as three separate characters instead of one
    # U+FEFF. A fix that only strips U+FEFF looks complete against
    # every --declared FILE fixture (open() with encoding="utf-8"
    # always produces the single-character form) while leaving the
    # real stdin path broken - this is that shape, driven directly
    # against parse_declared() first, then against a real OS pipe
    # below.
    check("parse_declared strips the three-separate-character "
          "(mis-decoded) form of the mark too, not only the single "
          "U+FEFF character",
          claim_vs_diff.parse_declared("\xef\xbb\xbfnew-file.txt\n")
          == {"new-file.txt"})

    print("\n--- a real OS pipe carrying raw UTF-8 BOM bytes on stdin "
          "still matches, under THIS interpreter's own locale-"
          "dependent decoding (F1) ---")
    # This is the arm the finding specifically asked for: run_tool()
    # above drives main() in-process with sys.stdin swapped for an
    # io.StringIO, which hands back already-decoded text - a fixture
    # shape that can never reproduce F1, because the bug lives IN the
    # decoding step a StringIO skips entirely. A real subprocess with
    # raw bytes on a real stdin pipe runs that decoding step for real,
    # on whatever locale this machine's Python actually uses - proving
    # the fix works under this interpreter's real behavior rather than
    # under a simulation of it.
    bom_bytes = b"\xef\xbb\xbfnew-file.txt\n"
    proc = subprocess.run(
        [sys.executable, claim_vs_diff.__file__, "slice-exact",
         "accounts", "--repo", primary, "--declared", "-"],
        input=bom_bytes, capture_output=True, timeout=FIXTURE_TIMEOUT)
    check("a real stdin pipe carrying raw UTF-8 BOM bytes still "
          "matches (exit 0, MATCH), decoded however this interpreter "
          "actually decodes console stdin",
          proc.returncode == 0 and b"MATCH" in proc.stdout)

    print("\n--- an undecodable declared file (UTF-16, PowerShell "
          "5.1's plain redirection default) is refused as COULD NOT "
          "ASK, never a crash and never read as MISMATCH (F2, review "
          "finding, 2026-08-21) ---")
    # UnicodeDecodeError is a ValueError, not an OSError - before this
    # fix it escaped uncaught, printed a bare Python traceback, and
    # exited 1, which collides with this tool's own documented
    # contract (exit 1 is reserved for a NAMED mismatch, never for a
    # question the tool could not even ask).
    utf16_path = os.path.join(root, "declared-utf16.txt")
    with open(utf16_path, "w", encoding="utf-16") as handle:
        handle.write("new-file.txt\n")
    code, said = run_tool(["slice-exact", "accounts", "--repo", primary,
                           "--declared", utf16_path])
    check("an undecodable declared file exits 2, distinct from the 1 "
          "an uncaught crash used to produce",
          code == 2)
    check("the report names a decode problem in plain words, not a "
          "traceback and not a silent empty match",
          "could not decode the declared file list" in said)

    print("\n--- refs that do not resolve are refused, not misread as a "
          "clean diff ---")
    code, said = run_tool(["no-such-branch", "accounts", "--repo", primary],
                          stdin_text="")
    check("an unresolvable branch exits 2, distinct from 0 or 1",
          code == 2)
    code, said = run_tool(["slice-exact", "no-such-base", "--repo", primary],
                          stdin_text="")
    check("an unresolvable base exits 2 too",
          code == 2 and "could not resolve base" in said)

    print("\n--- a git that does not answer is refused, not read as a "
          "clean diff ---")
    patient = claim_vs_diff.GIT_TIMEOUT
    claim_vs_diff.GIT_TIMEOUT = 0.000001
    try:
        code, said = run_tool(["slice-exact", "accounts", "--repo", primary],
                              stdin_text="")
        check("an unanswering git exits 2, distinct from 0 or 1",
              code == 2)
        check("the report names the timeout, not a silent 'no diff'",
              "did not answer" in said)
    finally:
        claim_vs_diff.GIT_TIMEOUT = patient

    print("\n--- an empty declared list against an empty diff is "
          "refused, never a silent match (S13-F3) ---")
    # Review finding B3 (2026-08-14): merge_base == branch_sha (a branch
    # already contained in base) makes the diff empty, and an empty
    # declared list against an empty touched set is otherwise
    # indistinguishable from a real MATCH - "nothing to compare" is not
    # the same fact as "the declared set is exactly the real diff", and
    # the evidence (an empty diff) is exactly what an accidentally-empty
    # declaration (a forgotten --declared, a stdin the caller's shell
    # fed nothing) also produces.
    git(primary, "checkout", "-b", "slice-empty", "accounts")
    code, said = run_tool(["slice-empty", "accounts", "--repo", primary],
                          stdin_text="")
    check("no diff and no declaration exits 2, naming 'nothing "
          "declared', never a silent match",
          code == 2 and "NOTHING DECLARED" in said)

    code, said = run_tool(["slice-empty", "accounts", "--repo", primary,
                           "--allow-empty"], stdin_text="")
    check("--allow-empty opts back into treating it as a real match",
          code == 0 and "MATCH" in said)

    print("\n--- the tool's own header carries the F10 extension note "
          "---")
    check("the module docstring names Prime running this against its "
          "own summaries (audit F10), so that note cannot silently "
          "drift out of the header",
          "F10" in claim_vs_diff.__doc__
          and "Prime" in claim_vs_diff.__doc__
          and "own summaries" in claim_vs_diff.__doc__)

    print("\n--- git() decodes a non-ASCII byte instead of crashing "
          "(0.9-M3-S29, #449) ---")
    # Root cause: git(), before this fix, ran subprocess.run() with
    # text=True and NO encoding, so Python decoded the child's stdout
    # under this machine's OWN locale codec (cp1252 on Windows) rather
    # than UTF-8 - and cp1252 has no mapping at all for byte 0x9D (nor
    # 0x81, 0x8D, 0x8F, 0x90). A curly right double quote, U+201D,
    # encodes in UTF-8 as the three bytes E2 80 9D - the last of which
    # is exactly that undefined byte - so a perfectly valid UTF-8 file
    # crashed subprocess.run() itself with UnicodeDecodeError, before
    # git()'s own try/except (which only catches TimeoutExpired and
    # OSError - a decode error is neither) ever saw it. Driven through
    # a SEPARATE process below (git_show_report()) rather than called
    # in-process, because the whole point of this arm is to observe a
    # crash without that crash taking this suite down with it - which
    # is exactly the shape ship_check.py hit for real (S15's builder,
    # 2026-08-22): a bare traceback and nothing printed.
    git(primary, "checkout", "accounts")
    git(primary, "checkout", "-b", "slice-nonascii")
    write(os.path.join(primary, "curly-quote.txt"),
         "a right curly quote: ”, valid UTF-8 throughout\n")
    write_bytes(os.path.join(primary, "invalid-byte.txt"),
               b"before \x9d after, 0x9D alone is not valid UTF-8\n")
    git(primary, "add", "-A")
    git(primary, "commit", "-m", "add non-ASCII fixtures for git() (#449)")

    quote_report = git_show_report(primary, "slice-nonascii",
                                   "curly-quote.txt")
    check("a file holding a valid-UTF-8 non-ASCII character (U+201D, "
         "whose UTF-8 encoding's last byte 0x9D has no mapping in "
         "cp1252) decodes through git() without crashing - exit 0, not "
         "an escaped UnicodeDecodeError",
          quote_report.startswith("OK 0"))
    check("...and the real character comes through decoded, not "
         "replaced - it IS valid UTF-8, so errors=\"replace\" never "
         "needs to touch it (ascii()'s own \\u201d escape names the "
         "real character; \\ufffd would name a replacement instead)",
          "\\u201d" in quote_report and "\\ufffd" not in quote_report)

    invalid_report = git_show_report(primary, "slice-nonascii",
                                     "invalid-byte.txt")
    check("a file holding a byte that is NOT valid UTF-8 on its own "
         "(a lone 0x9D) also decodes through git() without crashing - "
         "exit 0, proving errors=\"replace\" (not just an encoding "
         "name) is what stands between a genuinely bad byte and a "
         "bare traceback",
          invalid_report.startswith("OK 0"))
    check("...and the invalid byte reads back as the replacement "
         "character (U+FFFD), not silently dropped and not misread as "
         "something else",
          "\\ufffd" in invalid_report)

finally:
    shutil.rmtree(root, ignore_errors=True)

print("\n%d checks, %d failure(s)" % (performed, failures))
if performed != EXPECTED:
    print("EXPECTED %d checks and %d ran. A suite that quietly stops "
          "running is a suite that quietly stops checking."
          % (EXPECTED, performed))
    sys.exit(1)
sys.exit(1 if failures else 0)
