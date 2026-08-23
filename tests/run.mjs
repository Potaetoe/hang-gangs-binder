/*
 * The 0.9 gate. One entry point, and everything else here is an arm.
 *
 *     node tests/run.mjs
 *
 * Exit 0 is green, anything else is red. It is the whole apparatus:
 * there is no framework under this file, no assertion library, and
 * nothing for an arm to import. 0.9-M0-S4 (#281), built new under the
 * owner ruling on #228 - the old gate in tools/check.py guards the
 * surfaces that still exist and retires with them, and the two run
 * side by side until it has none left.
 *
 * ------------------------------------------------------------------
 * WRITING AN ARM
 *
 *   1. Put a file at tests/<name>.test.mjs. That is the declaration:
 *      the suffix is how this runner finds it, and `git add` is what
 *      registers it with the RUNNER - no edit needed here for that
 *      half. tests/ROSTER is a SECOND, required registration (MAJOR5,
 *      #311; both directions since 0.9-M3-S1, #381): add the same
 *      path as its own line there, in the same commit, or this runner
 *      reds naming the file unrostered. THE REQUIRED-ARM ROSTER
 *      section below carries the full rule, including the EXCLUDE
 *      escape hatch for a suite that is deliberately non-gating.
 *   2. Print what you checked, one line per check.
 *   3. Exit non-zero if anything was wrong. `process.exit(failures ?
 *      1 : 0)` at the bottom is the entire contract.
 *
 * Nothing else is required and nothing else is read. An arm is a
 * program this runner starts and grades by its exit code, so it may
 * import what it likes, spawn what it likes, and be written in any
 * shape its subject deserves - the three site-* arms that arrived
 * with this runner do exactly that. HISTORY, NOT GUIDANCE (0.9-M3-S7
 * fix wave 1, #410, F4): those three were adopted with no edit to
 * THIS FILE, back when that was the whole of registration - true the
 * day they landed, before tests/ROSTER existed. Step 1 above is the
 * current rule: adopting a suite now also takes a tests/ROSTER row,
 * every time.
 *
 * DERIVE, DO NOT PIN. Read the spec, the config, or the shipped file
 * and compute what should be true; a hand-copied expected value is a
 * second copy of the fact, and it is the copy that goes stale. Where
 * a count IS the claim - "four pages carry the wordmark" - pin it and
 * say why in the arm, because subtraction is the failure a derived
 * count cannot see.
 *
 * ------------------------------------------------------------------
 * HOW A RED READS
 *
 * Each arm gets its own `node` process, so a red names the arm by
 * path, prints its exit code, and prints everything it wrote. Nothing
 * is summarized away and nothing is interpreted: an arm that throws
 * exits non-zero and is a red, never a skip, because the exit code is
 * the only thing consulted. On green the runner shows the arm's last
 * line - its own verdict - and drops the rest.
 *
 * Arms ran one at a time until 0.9-M3-S35 (#460) put them through a
 * pool - see THE POOL, further down, for what changed and what did not:
 * a suite that binds a socket or writes a scratch directory still gets
 * to assume nothing else is racing it, because that half of the
 * argument was never about ORDER, only about ISOLATION, and isolation
 * is what the pool's own reading and 20-run proof are about.
 *
 * TWO WAYS TO GO GREEN WITHOUT CHECKING ANYTHING, both refused here.
 * Finding no arms is a red - a gate that passes because it swept an
 * empty directory is the armed-looking-but-not failure this project
 * holds to be worse than no gate. And ANY file under tests/ that is not
 * an arm, not this file and not the preflight below is a red too: under
 * discovery the way coverage disappears is a file that stops matching
 * the pattern, which is the same hole #204 found in the old hand list
 * from the other side.
 *
 * Any file, and the sweep is deliberately not itself a pattern. It
 * looked at *.mjs first, which left half of its own sentence open:
 * package.json says "type": "module", so tests/site-spec.test.js is a
 * live arm - it loads, it runs, it passes - that this gate never calls
 * again, and renaming one letter took forty-four checks out with every
 * remaining arm green and no warning printed. A guard that only
 * inspects the extension it is guarding cannot see a file leave by
 * changing its extension. The cost is that tests/ holds arms and the
 * two exemptions and nothing else: a fixture, a helper or a README
 * wanted here needs its own line in NOT_ARMS, added by whoever needs
 * it and argued for there, which is the point rather than the price.
 * Whether an arm ran ENOUGH is the arm's own job,
 * and the site-* three do it by pinning their check counts; this
 * runner counts arms and never their contents, because a total kept
 * here would be a hand-pinned expectation in the one file that exists
 * to argue against them.
 *
 * ------------------------------------------------------------------
 * PYTHON ARMS: THE SHIM IS THE CONVENTION. tests/worktree-contract.
 * test.mjs is the template - five lines that find an interpreter and
 * shell out to a suite living beside the module it tests (tools/
 * agent_init_suite.py here). This runner does not learn *.test.py
 * natively: "an arm is a program this runner starts and grades by its
 * exit code" already covers a shim, with zero lines added here, and a
 * shim is proof of that on its own - it was adopted the same way the
 * three site-* arms were, without an edit to this file. Teaching the
 * runner a second suffix and a second interpreter would buy nothing a
 * shim does not already buy, and it would cost this file staying
 * single-language: the stray sweep's message ("name it *.test.mjs")
 * would need to know to say something else for a stray .py, discovery
 * would need a second execution path, and both would exist to save
 * five lines a shim already is. 0.9-M0-S8's reaper arms, next in the
 * queue and Python too, get the same five lines over their own suite.
 *
 * UNTRACKED FILES UNDER tests/ STAY STRICT-RED - no leniency added
 * here for a file `git status` calls untracked. The sweep already
 * does not care whether a file is tracked; it is filesystem discovery
 * over what is checked out, on purpose (see DERIVE, DO NOT PIN above),
 * and teaching it to skip untracked strays would mean shelling out to
 * git from the one file in this repository that currently does not
 * need to, to buy leniency for a state the environment contract
 * already has an answer to: `./run agent-init` hands every worktree a
 * scratch directory OUTSIDE the tree for exactly this - the lint stage
 * reads what is in the tree, so a new arm mid-work belongs in scratch
 * until its name and shape are the ones this gate should see, not in
 * tests/ wearing a wrong name so leniency can wave it through. Landing
 * it under tests/ at all, tracked or not, is the point where the
 * naming decision is supposed to already be made.
 *
 * ------------------------------------------------------------------
 * RETIRING AN OLD ARM WITH ITS SURFACE - the M2/M3/M4 pattern, a
 * THREE-PART act now (0.9-M3-S1, #381 widened it from two), in the
 * rebuild slice's own pull request:
 *
 *     delete dev/<x>.test.mjs AND its NODE_SUITES row in
 *     tools/check.py, AND add tests/<x>.test.mjs's own row to
 *     tests/ROSTER, all in the same commit that lands
 *     tests/<x>.test.mjs over the rebuilt surface.
 *
 * Same commit is the whole of it: the new arm exists before the old
 * one is gone, so no window has neither. Half a retirement cannot hide
 * on the OLD side - check.py's roster_problems() reds on a row whose
 * file is missing and on a dev/*.test.mjs no row names. It cannot hide
 * on the NEW side either: this runner's own roster reds a discovered
 * tests/<x>.test.mjs that arrived with no tests/ROSTER row, so the new
 * arm is no longer "registered by existing" the way it was before
 * #381 - its row is the third part of this act, not a byproduct of the
 * first two. The old runner's final removal is its own M4-era slice,
 * not something that falls out of the last retirement.
 *
 * THE FIRST STAGE IS THE SEAM, and it is wired: tests/preflight.mjs
 * exists, runs before any arm, and a red there stops the gate with no
 * arm run. 0.9-M0-S5 (#283) built the detection - the exit status of
 * `./run agent-init --verify`, reading .gitattributes' end-of-line
 * state directly rather than waiting for some later stage to trip
 * over a stale worktree and bury the cause. 0.9-M0-S7 (#287) is what
 * calls it from here. Its absence is graded the same way an empty
 * arms directory is below: a red, not a note, because tests/
 * preflight.mjs is expected to always be present from here on, and a
 * gate that quietly runs without it is the "armed-looking-but-not"
 * failure this file already refuses for the empty-directory case.
 * PRESENCE IS NOT ENOUGH EITHER (review-0.9-m0-s7-2026-08-13, finding
 * R2): an empty or gutted preflight is valid JavaScript that exits 0
 * having checked nothing, so stage zero also requires the one line
 * --verify's success path prints - see the vacuity guard where stage
 * zero runs, below - the same refusal reached a second way.
 *
 * ------------------------------------------------------------------
 * THE REQUIRED-ARM ROSTER (MAJOR5, #311; review-0.9-m0-s19). Discovery
 * above answers "what did the sweep find", which cannot see a whole
 * arm SUBTRACTED: `git rm tests/claim-vs-diff.test.mjs` shrinks the
 * walk by one file and the loop below simply runs one fewer program -
 * 9 arms, all green, exit 0, and nothing anywhere says a tenth used to
 * run. tests/ROSTER is a second, committed fact about what MUST be
 * here, read independently of the directory sweep rather than derived
 * from it - a roster generated from the same walk it is checked
 * against would shrink together with a deletion and prove nothing.
 * Discovery still finds every arm exactly as before and the stray
 * sweep below is unchanged; this adds a THIRD question neither
 * answers: does every path the roster names still exist among what
 * discovery found? A green run and the roster together are the whole
 * claim "the required set actually ran", which neither says alone.
 *
 * BOTH DIRECTIONS (0.9-M3-S1, #381, against 0.9-M2-S14's independent
 * review, #380). The paragraph above is one direction only - a roster
 * row naming a file that is gone. The reviewer found the gap in the
 * other one: DELETE a row for a suite that is still there, and nothing
 * above objects, because nothing above ever asks "does every file
 * discovery found have a row" - the gate went green at the reduced
 * count with a real suite quietly no longer required. tests/ROSTER now
 * answers both questions from one committed file: every required row
 * needs a file (as before), and every discovered file needs a row,
 * required or explicitly excluded via a line reading
 * "EXCLUDE <path> :: <reason>" - tests/ROSTER's own header carries the
 * full syntax. A suite deliberately left non-gating is a sentence
 * somebody wrote, never a row that is merely absent; tools/check.py's
 * NODE_SUITES_EXCLUDED (#204) is the same mechanism for the old gate's
 * own roster, checked the same two ways (stale, or both required and
 * excluded at once). tests/roster-two-way.test.mjs is the permanent
 * mutation proof, over an isolated copy of this file so the real gate
 * is never itself mutated to test it.
 *
 * TWO MORE WAYS TO GO GREEN WITHOUT REQUIRING ANYTHING, both closed by
 * 0.9-M3-S7 (#410, from #381's post-merge review). An all-EXCLUDE
 * roster - zero required rows, any number of exclusions - used to pass
 * the empty-roster guard, because that guard checked exclusions too;
 * it did not occur to the guard that "roster requires nothing" is true
 * regardless of how many files are excused from a list that was empty
 * anyway. Fixed by reading only `required.length` there. And a
 * duplicate line - the same required path twice, or the same EXCLUDE
 * path twice with two different reasons - used to be silently
 * accepted; the second EXCLUDE line silently overwrote the first's
 * reason in the Map, which is exactly the silent state this whole
 * mechanism exists to refuse one line over. Both duplicate shapes are
 * their own named red now.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runPool } from "./gate-pool.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HERE = fileURLToPath(new URL(".", import.meta.url));
const ARM_SUFFIX = ".test.mjs";
const PREFLIGHT = "tests/preflight.mjs";
const ROSTER = "tests/ROSTER";
const GATE_POOL = "tests/gate-pool.mjs";

/* Repo-relative and forward-slashed, so a name reads the same in a
   Windows terminal and in the Actions log. */
const rel = (absolute) =>
  absolute.slice(ROOT.length).split("\\").join("/");

/* This file exempts itself by asking where it is, not by naming
   itself. The sweep below is over every file in tests/, so a spelled-
   out "tests/run.mjs" is a second copy of this file's own path: rename
   the runner and it reports itself as a stray it is in the middle of
   running. GATE_POOL is the runner's own helper (0.9-M3-S35, #460): it
   exports a function and calls no check(), so it is a non-arm the same
   way this file, PREFLIGHT and ROSTER already are - see gate-pool.mjs's
   own header for the argument this set's own doc comment asks for. */
const NOT_ARMS = new Set([rel(fileURLToPath(import.meta.url)), PREFLIGHT,
                          ROSTER, GATE_POOL]);

/* THE POOL (0.9-M3-S35, #460). Arms used to run one at a time - not for
   speed, the header above said, because a suite that binds a socket or
   writes a scratch directory is one this ordering let stay simple. That
   reasoning is now the FLOOR the pool has to clear rather than a
   standing prohibition: every arm was read for shared, colliding state
   (fixed ports, the fleet's real records under BINDER_FLEET_STATE, a
   temp directory named by branch rather than randomly) and each one
   that touches anything like that drives it through an isolated
   `tempfile`-rooted fixture with its own `--state`/env override -
   tools/reaper_suite.py, tools/fleet_status_suite.py, tools/
   prime_lock_suite.py, tools/agent_init_suite.py, tools/
   claim_vs_diff_suite.py, tools/ship_check_suite.py and tools/
   session_open_suite.py all say so in their own header comments, and
   none of them reads or writes this repository's own real git state,
   the real fleet directory, or a fixed port. The two `wrangler --help`
   arms (operations-sit-procedure, operations-bot-rotation) make no
   write at all. Twenty consecutive pool runs with zero flakes is the
   proof this reading earns, carried in the ticket rather than pinned
   here as a comment nothing re-checks - the READING is what licenses
   the pool, and the twenty-run proof is what confirms the reading was
   right, not a substitute for either half.
   POOL SIZE DEFAULTS TO 4, NEVER THE CPU COUNT (fix wave 4, re-fire #3,
   finding F1, Prime's ruling 2026-08-22: "the pool's DEFAULT width is 4
   ... never default to the CPU count"). It used to default to
   `cpus().length` - on the 12-core machine this ticket was built on,
   that opened 12 concurrent arms plus their own `python`/`git`
   children, and under ordinary fleet load (this machine running other
   agents at the same time) that exhausted the machine's own memory
   commit: 10 of the reviewer's 15 full-gate runs at pool 12 went red,
   with node processes dying mid-arm (`0xC0000409`) and `git` spawns
   returning nothing, never the arms' own logic failing. The same head
   was green at pool 1 and green at pool 4, and pool 4 was AS FAST as
   pool 12 (87.0s vs 82.3s in the reviewer's own back-to-back run) - the
   width that broke the machine bought no speed a narrower width did
   not already have. `BINDER_GATE_POOL` still overrides it - the
   suppressed lever the mutation battery uses to prove pool size 1
   restores the old sequential wall time, and the lever a machine known
   to have room for more may raise, with a reason stated where it is
   raised. Read with `envNumber` below, not a bare `Number(...) ||
   default` - `0` is a legitimate override for a lever like this
   (gate-budget.test.mjs's own "forced 0s budget" scenario needs it to
   mean zero, not "unset"), and `||` treats the falsy number 0 exactly
   like an absent variable, silently discarding it back to the
   default. */
function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const DEFAULT_POOL = 4;
const POOL_SIZE = envNumber("BINDER_GATE_POOL", DEFAULT_POOL);

/* THE BUDGET (0.9-M3-S35, #460; ENFORCEMENT SPLIT at re-fire #2, F1-F5's
   own Prime ruling 2026-08-22). 300s is the figure this slice measured
   room under on an idle machine after the pool and the reaper-suite cut
   landed; BINDER_GATE_BUDGET_SECONDS overrides it for a machine known to
   run slower (a contended worktree, a loaded CI runner) - always with
   the reason stated where it is raised, never silently.

   RE-FIRE #2 finding F5 (and the ruling closing the whole class):
   comparing this run's own real wall time against a fixed-second
   ceiling is exactly the "timing decision on a contended machine" the
   ruling retires - the SAME shared, contended machine this whole ticket
   was built on turned a real, honest 300s overage into a red for a
   reason that has nothing to do with whether the code is slow. THE
   BUDGET stays (a reader still wants to know a run got slow), but it
   only REDS - joins `problems`, fails the gate - when
   BINDER_GATE_ENFORCE_BUDGET reads EXACTLY "1". CI sets that variable
   (the one line Prime's ruling leaves for Prime to add to
   .github/workflows/deploy.yml, since that file is sensitive-tier and
   not this slice's to touch); every other caller - a bare `./run
   check`, a builder's own terminal, this file's own suite - gets the
   IDENTICAL wall-time line and an ADVISORY message that never fails the
   run, because the whole point of ENFORCE_BUDGET is that "this specific
   machine, right now, was slow" is not a fact a builder can fix by
   editing code. */
const DEFAULT_BUDGET_SECONDS = 300;
const BUDGET_SECONDS = envNumber("BINDER_GATE_BUDGET_SECONDS",
  DEFAULT_BUDGET_SECONDS);
const ENFORCE_BUDGET = process.env.BINDER_GATE_ENFORCE_BUDGET === "1";

/* THE PER-ARM TIMEOUT (0.9-M3-S35 fix wave 1, #460, review comment
   5379811881, finding F3) IS A HANG GUARD, NOT A SLOWNESS GUARD
   (sharpened at re-fire #2, findings F1/F3/F4, Prime's ruling
   2026-08-22). THE BUDGET above reds (or, locally, advisories) a run
   that finished slow; it cannot catch one that never finishes at all,
   because it runs AFTER `await runPool(...)` returns - a hung arm (one
   that never exits on its own: a deadlock, a wedged subprocess, an
   `await` on something that never resolves) hangs the whole gate
   forever and the budget line never prints. This timeout's only job is
   killing THAT case; it is not supposed to fire on an arm that is
   merely running slow under load, and fix wave 2's 200s default did
   exactly that - re-fire #2 watched it kill six genuinely healthy arms
   in one loaded run (tests/fleet-status.test.mjs,
   tests/operations-bot-rotation.test.mjs, tests/operations-sit-
   procedure.test.mjs, tests/reaper.test.mjs, tests/ship-check.test.mjs,
   tests/worktree-contract.test.mjs - none of them hung, all of them
   just slow that run) and measured tests/reaper.test.mjs itself as high
   as 93.5s on this machine, a number that keeps climbing with the
   fleet's own size rather than holding still the way a per-code-change
   figure should. Chasing that number with an ever-larger multiplier is
   the same whack-a-mole class the ruling closes: the fix is to stop
   asking this lever to distinguish "slow" from "hung" at all. The
   default is now 600s - comfortably clear of anything this ticket has
   ever measured a real arm take, including under heavy load, while
   staying a HANG guard rather than a performance ceiling (THE BUDGET
   above is the performance ceiling, and it is advisory locally for the
   same reason). 600 > 300 (the advisory local budget) is fine on
   purpose: a single arm can run past the whole gate's own advisory
   budget without being killed, because locally that is a "this run was
   slow" fact, not a "something is stuck" fact - CI's own 300s ENFORCED
   budget is what actually catches a slow arm there, well before 600s
   per-arm would. BINDER_ARM_TIMEOUT_SECONDS overrides it, with a reason
   stated where it is raised, the same convention BINDER_GATE_BUDGET_
   SECONDS already uses - CI reads this default, since neither workflow
   sets either variable.

   PREFLIGHT IS EXEMPT FROM THIS TIMEOUT, EXPLICITLY (re-fire #2, finding
   F1/F3). tests/preflight.mjs used to run through the exact same
   `runFile()` as every arm, so ARM_TIMEOUT_SECONDS silently governed it
   too - under load, the fixture in tests/gate-budget.test.mjs's own
   hung-arm scenario killed its stub preflight before the scenario's
   hung arm ever started, which graded a scenario that never ran the
   thing it claimed to. `runFile()` below now takes an explicit
   `timeoutSeconds` argument rather than reading the module-level
   constant itself, and the ONE call below for PREFLIGHT passes `null` -
   no timer is armed at all, so no load this machine can produce ever
   trips it, which is the cleanest form of the "measured so that no load
   seen on this machine can trip it" bar the ruling sets for whichever
   of the two options (exempt, or a separate generous timeout) a builder
   picks: exemption needs no measurement, because there is nothing to
   trip. Preflight is a handful of fast, local checks (git attributes,
   `agent-init --verify`'s own record), never a suite that spawns
   arbitrary work the way an arm can, so the risk this trades away is
   different in kind from a wedged arm, not merely smaller - and a
   preflight that genuinely never returns is a problem with THIS
   machine's environment, not a code defect this gate exists to catch by
   killing a process tree. */
const DEFAULT_ARM_TIMEOUT_SECONDS = 600;
const ARM_TIMEOUT_SECONDS = envNumber("BINDER_ARM_TIMEOUT_SECONDS",
  DEFAULT_ARM_TIMEOUT_SECONDS);

/* THE TEST-DURATION SEAM (0.9-M3-S35 fix wave 2, #460, re-fire #1,
   finding F1). tests/gate-budget.test.mjs used to grade two things by
   comparing REAL measured wall-clock durations against each other - a
   pool-of-3-vs-pool-of-1 ratio, and the "slowest" line's claimed name
   ordering. Both flaked, on two different checks in the same file,
   under real contention on the machine this ticket was built on:
   `runFile()`'s own `ms` starts before `spawn()`, so it carries node's
   own process start-up jitter, and neither check's margin survived it.
   Fix wave 1 widened the ordering check's fixture gaps to fix the FIRST
   flake; the re-fire found that widening pushed the ratio check's ideal
   value from about 0.5 up to about 0.69 against an unmoved 0.75
   threshold, and it flaked twice in 26 runs - a wider margin on one
   check narrowed the other's, because both read the SAME three
   fixture arms. A real deadline is no answer to a check whose margin is
   a measurement of the machine, not of the code.

   The fix is structural rather than a wider margin. An arm may report
   its OWN duration by printing a line reading
   "__GATE_TEST_DURATION_MS__ <n>", and this runner substitutes that
   EXACT number for the REAL measured `ms` everywhere `ms` feeds once
   arm reporting happens - the per-arm printed duration and the
   "slowest" sort - but ONLY when BINDER_GATE_TEST_DURATIONS_MS reads
   EXACTLY "1". With an injected, exact duration,
   tests/gate-budget.test.mjs's ordering and "right total" checks
   compare a number the fixture arm CHOSE against this runner's own
   arithmetic on that number - there is no measurement left for a busy
   machine to jitter, so there is nothing left to flake.

   ARMED AGAINST A LYING ARM IN A REAL RUN. BINDER_GATE_TEST_DURATIONS_MS
   is never set by CI (`.github/workflows/deploy.yml` sets no
   BINDER_GATE_* variable at all - confirmed in review comment
   5379811881, "What held"), by `./run check`, or by any of this
   repository's own tooling - so a real arm's own
   __GATE_TEST_DURATION_MS__ line, printed for any reason, is inert:
   `effectiveMs()` below never even looks for the marker unless the
   variable is EXACTLY "1", not merely truthy or merely present, so a
   stray or malicious print cannot inflate or shrink what the gate
   reports about a real arm's speed without a human deliberately
   opting into test mode by name - the same opt-in shape
   BINDER_GATE_POOL and BINDER_GATE_BUDGET_SECONDS already use, except
   this lever defaults OFF rather than to a number, because an arm's own
   claim about its own duration is exactly the one thing this gate must
   not trust unless a human turned that trust on by name.
   tests/gate-budget.test.mjs's own "SEAM OFF" scenario proves this both
   ways the variable could fail to read as an explicit "1" - genuinely
   absent, and present but reading something else - against a fixture
   arm that lies outright (claims ~999 real seconds). */
const TEST_DURATIONS_ARMED =
  process.env.BINDER_GATE_TEST_DURATIONS_MS === "1";
const DURATION_MARKER = /^__GATE_TEST_DURATION_MS__ (\d+)\r?$/m;

/* The ms this arm's report() row and the "slowest" sort should use: the
   REAL measured wall-clock time from runFile(), unless the seam is
   armed AND this arm's own captured output carries the marker line -
   see THE TEST-DURATION SEAM above. */
function effectiveMs(result) {
  if (!TEST_DURATIONS_ARMED) return result.ms;
  const match = DURATION_MARKER.exec(result.output);
  return match ? Number(match[1]) : result.ms;
}

/* Windows has no process GROUPS the way POSIX does, so `-pid` (the
   POSIX kill-the-group trick, which needs `detached: true` at spawn
   time to put the child in its own group) does nothing there - the one
   portable primitive that kills a WHOLE descendant tree on Windows is
   `taskkill /T`, walking the OS's own parent-child records rather than
   anything this file tracked itself. `/F` forces it (SIGKILL has no
   Windows analogue to ask nicely with); a `taskkill` failure (the
   process already gone, most commonly - a race this function does not
   need to win, only to not throw on) is swallowed rather than thrown,
   because the caller's own `close` handler is what actually resolves
   the arm's result either way. */
const isWindows = process.platform === "win32";
function killTree(child) {
  if (isWindows) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    return;
  }
  try { process.kill(-child.pid, "SIGKILL"); }
  catch (error) { try { child.kill("SIGKILL"); } catch (inner) { /* already
    gone - the same harmless race the Windows branch above swallows */ } }
}

const exists = async (path) => {
  try {
    await stat(path);
    return true;
  } catch (error) { return false; }
};

/* Every file under tests/, sorted, so the gate runs in one order
   everywhere and a diff of two logs is about the arms. Every file and
   not every .mjs: the arms are picked out of this list by suffix below,
   and everything left over is the stray sweep, which has to see the
   extensions it is not looking for or it cannot notice one leaving. */
async function everyFile(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = dir + entry.name;
    if (entry.isDirectory()) found.push(...await everyFile(path + "/"));
    else found.push(path);
  }
  return found.sort();
}

/* Start it, wait for it, and report what it did. The exit code is the
   verdict; the output is captured whole as the evidence. runFile() ITSELF
   never inspects it - but it is not "never parsed" the way this comment
   used to claim (re-fire #2, finding F6: the sentence was already loose
   before this slice and this slice's own seam made it plainly false).
   Two callers elsewhere in this file DO parse it: verdictLine() (an
   arm's own last printed line, for the "ok"/green summary) and
   effectiveMs() (THE TEST-DURATION SEAM's marker line, further down).
   Both read the `output` this function hands back; this function's own
   job stops at capturing it whole and reporting the exit code.

   `timeoutSeconds` is explicit per call, not read from a module-level
   constant here, so PREFLIGHT (which passes `null` - see THE PER-ARM
   TIMEOUT above) and an ARM (which passes ARM_TIMEOUT_SECONDS) can be
   governed differently without a second copy of this function. `null`
   arms no timer at all.

   `detached: !isWindows` puts a POSIX child in its own process group, so
   `killTree()`'s `-pid` can reach a subprocess THIS arm itself spawned
   (a suite's own git or wrangler call) and not just the node process
   this file started directly - the timeout's whole point is a hung
   descendant, not only a hung top-level arm. Windows needs no such flag:
   `taskkill /T` already walks the OS's own parent-child records. */
function runFile(path, timeoutSeconds) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [path], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      detached: !isWindows,
    });
    let output = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const timer = timeoutSeconds == null ? null : setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutSeconds * 1000);
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      resolve({
        code: 1, output: "could not start it: " + error.message,
        ms: Date.now() - started, timedOut: false,
      });
    });
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({
        // A signal is a death, not a pass. Without this an arm killed
        // for running long arrives with code null and reads as zero.
        // A TIMED-OUT arm is graded "timeout" specifically rather than
        // folded into the signal case, because close() sees signal
        // OR null depending on the platform's own kill path
        // (taskkill's /F does not always deliver a signal Node
        // observes) - `timedOut`, set synchronously the moment the
        // timer fires, is the one fact that does not depend on the
        // platform's own reporting of the kill.
        code: timedOut ? "timeout" : (code === null ? "signal " + signal
          : code),
        output, ms: Date.now() - started, timedOut,
      });
    });
  });
}

const verdictLine = (output) => {
  const lines = output.split("\n").map((line) => line.trimEnd())
    .filter((line) => line !== "");
  return lines.length ? lines[lines.length - 1] : "(said nothing)";
};

const report = (name, ok, ms) =>
  console.log(name.padEnd(52) + (ok ? "ok" : "FAILED").padEnd(8) +
    (ms / 1000).toFixed(1) + "s");

function spill(name, result) {
  console.log("--- " + name + ", exit " + result.code + " " +
    "-".repeat(Math.max(3, 56 - name.length)));
  console.log(result.output.trimEnd() || "(it printed nothing)");
  console.log("-".repeat(60));
}

const problems = [];
const gateStarted = Date.now();
console.log("the 0.9 gate - " + rel(HERE) + "\n");

/* Stage zero: the seam. */
if (await exists(ROOT + PREFLIGHT)) {
  // `null` - see THE PER-ARM TIMEOUT's own "PREFLIGHT IS EXEMPT" note
  // above: preflight is governed explicitly, and explicitly means no
  // timer at all rather than silently inheriting ARM_TIMEOUT_SECONDS.
  const result = await runFile(ROOT + PREFLIGHT, null);
  const verdict = verdictLine(result.output);
  /* VACUITY GUARD (review-0.9-m0-s7-2026-08-13, finding R2). Absence is
     hardened above into a red; a PRESENT-BUT-EMPTY (or otherwise
     gutted) tests/preflight.mjs is valid, empty JavaScript, so it exits
     0 having checked nothing - the criterion (file present, exit 0) is
     met while the property (this worktree was actually verified) is
     absent. The honest discriminator is evidence the check really ran,
     not merely its exit code: do_init()'s --verify branch prints
     "initialized: contract N, record ..." on its one success path
     (tools/agent_init.py), and nothing else in this repository
     produced that line - until 0.9-M0-S14 (#300) gave preflight a
     second legitimate success path. A CI checkout can never hold an
     initialization record (agent-init is machine-held Windows
     tooling), so preflight's path 2 prints "initialized: CI path ..."
     instead of shelling out to a --verify that can never pass there;
     this file is the one caller that has to tell the two apart from a
     gutted preflight, so it is the one place widened to recognize
     both. A verdict missing BOTH is graded the same "armed-looking-
     but-not" way an empty arms directory already is below - a red,
     not a note. */
  const vacuous = result.code === 0 &&
    !verdict.startsWith("initialized: contract ") &&
    !verdict.startsWith("initialized: CI path");
  const ok = result.code === 0 && !vacuous;
  report(PREFLIGHT, ok, result.ms);
  if (!ok) {
    spill(PREFLIGHT, result);
    console.log(vacuous
      ? "\npreflight exited 0 without printing either of the two " +
        "recognized success lines (--verify's own \"initialized: " +
        "contract N, ...\" or path 2's \"initialized: CI path ...\"), " +
        "so it is graded vacuous rather than green - a check that ran " +
        "and a file that merely exited 0 are not the same thing. Fix " +
        "that first."
      : "\npreflight is red, so no arm ran. Fix that first.");
    process.exit(1);
  }
  console.log("    " + verdict);
} else {
  console.log(PREFLIGHT + " is missing. It is expected to always be " +
    "present - 0.9-M0-S7 (#287) wired it to tools/agent_init.py's " +
    "--verify - so a gate that runs without it is graded the same as " +
    "one that finds no arms: a red, not a note.");
  process.exit(1);
}

/* Stage one onward: the arms. */
const files = await everyFile(HERE);
const arms = files.filter((path) => path.endsWith(ARM_SUFFIX));
const strays = files.filter((path) =>
  !path.endsWith(ARM_SUFFIX) && !NOT_ARMS.has(rel(path)));

console.log("");
/* Run concurrently, print in the same fixed order discovery already
   sorted `arms` into. runPool's whole contract is that its returned
   array is ordered by INPUT position regardless of finish order (see
   gate-pool.mjs), so this loop reads exactly as it did one arm at a
   time - only the `await runPool(...)` line above it is new. */
const results = await runPool(
  arms.map((path) => () => runFile(path, ARM_TIMEOUT_SECONDS)), POOL_SIZE);

for (let index = 0; index < arms.length; index += 1) {
  const path = arms[index];
  const result = results[index];
  const name = rel(path);
  const ok = result.code === 0;
  report(name, ok, effectiveMs(result));
  if (ok) console.log("    " + verdictLine(result.output));
  else {
    spill(name, result);
    if (result.timedOut) {
      console.log("\nTIMED OUT: " + name + " ran past its " +
        ARM_TIMEOUT_SECONDS + "s per-arm timeout and its process tree " +
        "was killed - this is a HANG guard, not a slowness ceiling (THE " +
        "BUDGET above is the slowness ceiling): it exists to end a " +
        "deadlock or a wedged subprocess, never to grade an arm that " +
        "simply ran long. BINDER_ARM_TIMEOUT_SECONDS raises the figure, " +
        "with a reason stated where it is set, for an arm known to need " +
        "longer than this default assumes.");
      problems.push(name + " (timed out after " + ARM_TIMEOUT_SECONDS +
        "s)");
    } else {
      problems.push(name);
    }
  }
}

console.log("=".repeat(60));

for (const path of strays) {
  const name = rel(path);
  problems.push(name);
  /* A stray .py gets its OWN message (review-0.9-m0-s7-2026-08-13,
     finding R3): the generic line below told a Python suite author to
     rename to *.test.mjs, which is the opposite of the shim convention
     this file's own header documents two screens up - renaming
     produces a broken arm (node cannot run a .py file), not a working
     one. The correct move is a shim beside the module, which is what
     tests/worktree-contract.test.mjs already is. */
  console.log(name.endsWith(".py")
    ? name + " is in tests/ and nothing runs it. A .py suite here " +
      "wants a shim, not a rename: leave it beside the module it " +
      "tests and add a five-line *" + ARM_SUFFIX + " that shells out " +
      "to it - tests/worktree-contract.test.mjs is the pattern."
    : name + " is in tests/ and nothing runs it. Name it " +
      "*" + ARM_SUFFIX + " so the gate finds it, or take it out." +
      /* The near-miss is worth its own sentence, because it is the
         case that arrives looking like a tidy-up rather than a
         deletion. */
      (/\.test\.[^./]+$/.test(name)
        ? " One suffix from being an arm is how coverage leaves " +
          "quietly: a file this close still runs by hand and still " +
          "passes."
        : ""));
}
if (arms.length === 0) {
  problems.push("no arms");
  console.log("no *" + ARM_SUFFIX + " under " + rel(HERE) + ". An empty " +
    "gate passes everything, so this is a failure.");
}

/* The required-arm roster (MAJOR5, #311). See the header block above,
   "THE REQUIRED-ARM ROSTER", for why this is a THIRD question and not
   a restatement of discovery: every path tests/ROSTER names must still
   be among what the sweep found, checked against a committed list that
   does not shrink when a file does. */
const rosterPath = ROOT + ROSTER;
if (!(await exists(rosterPath))) {
  problems.push(ROSTER);
  console.log(ROSTER + " is missing. It is the required-arm roster " +
    "(MAJOR5, #311) and is expected to always be present, so a gate " +
    "that runs without it is graded the same as one that finds no " +
    "arms: a red, not a note.");
} else {
  const rosterText = await readFile(rosterPath, "utf8");
  const lines = rosterText.split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

  /* EXCLUDE lines (0.9-M3-S1, #381) are the written exception: a suite
     left off the required list on purpose reads identically, at the
     file level, to one somebody forgot - "fine unlisted" and "never
     rostered" are the same fact until one of them is written down.
     "EXCLUDE <path> :: <reason>" states it. Any line starting with
     EXCLUDE is treated as an exclusion attempt, well-formed or not -
     never silently read as a literal required path spelling "EXCLUDE
     ...", which would just fail as REQUIRED ARM MISSING for the wrong
     reason. */
  const EXCLUDE_LINE = /^EXCLUDE\s+(\S+)\s*::\s*(.*)$/;
  const required = [];
  const requiredSeen = new Set();
  const excluded = new Map();
  for (const line of lines) {
    if (!line.startsWith("EXCLUDE")) {
      /* F5 (0.9-M3-S7, #410): a duplicate required row is refused by
         name rather than silently accepted as a no-op repeat - two
         lines naming the same file assert nothing a single line did
         not already, and a second copy is a thing that can drift from
         the first (AGENTS.md, "one home per fact"). */
      if (requiredSeen.has(line)) {
        problems.push("duplicate required row: " + line);
        console.log("DUPLICATE REQUIRED ROW: " + ROSTER + " lists " +
          line + " more than once as a required row. Remove the extra " +
          "line - a repeat asserts nothing a single line did not " +
          "already, and it is a thing that can drift from the first.");
        continue;
      }
      requiredSeen.add(line);
      required.push(line);
      continue;
    }
    const match = EXCLUDE_LINE.exec(line);
    const reason = match ? match[2].trim() : "";
    if (!match || reason === "") {
      problems.push("malformed exclusion: " + line);
      console.log("MALFORMED EXCLUSION: " + ROSTER + " has the line \"" +
        line + "\", which does not parse as \"EXCLUDE <path> :: " +
        "<reason>\" - a path with no reason after \"::\", or no \"::\" " +
        "at all, states nothing. Fix the line or remove it.");
      continue;
    }
    /* F5 again: a duplicate EXCLUDE line for the same path is refused
       by name too. Without this, `excluded` is a Map and the second
       reason silently overwrites the first - the exact silent state
       the exclusion mechanism exists to avoid, just moved one line
       over. The first entry stands; the duplicate is reported and
       otherwise ignored, so this path is still correctly excluded by
       its first, surviving reason. */
    if (excluded.has(match[1])) {
      problems.push("duplicate exclusion: " + match[1]);
      console.log("DUPLICATE EXCLUSION: " + ROSTER + " excludes " +
        match[1] + " more than once (\"" + excluded.get(match[1]) +
        "\" and now \"" + reason + "\"). A second EXCLUDE line for the " +
        "same path would silently overwrite the first's reason - keep " +
        "exactly one EXCLUDE line per path.");
      continue;
    }
    excluded.set(match[1], reason);
  }

  /* THE ORDERING RULE (0.9-M3-S18, #428). tests/ROSTER's own header
     states it: required rows in ascending alphabetical order among
     themselves, EXCLUDE rows in ascending alphabetical order among
     themselves. The reason this exists at all is `.gitattributes`'
     `tests/ROSTER merge=union` line, added the same slice - the union
     merge driver is what lets two slices that each append one row (the
     exact shape that stopped the door on 2026-08-21, 0.9-M3-S8 and
     0.9-M3-S10) merge clean instead of conflicting, but the driver has
     no notion this file has an ordering rule at all: it just
     concatenates both sides' added lines at their own recorded
     positions. Nothing else here would ever notice a union merge
     landing two real rows out of order - discovery still finds every
     arm, both directions above are satisfied, and the file would read
     as quietly fine. This is what turns that into a red instead of a
     silent drift. Checked as two separate sequences, not one shared
     one, because a required row and an EXCLUDE row answer different
     questions and interleaving them by file position (as opposed to by
     category) is not itself a rule anything states. */
  function checkOrder(list, label) {
    for (let i = 1; i < list.length; i += 1) {
      if (list[i - 1] > list[i]) {
        problems.push("roster out of order: " + list[i - 1] + ", " +
          list[i]);
        console.log("ROSTER OUT OF ORDER: " + ROSTER + " lists " +
          list[i] + " immediately after " + list[i - 1] + ", but " +
          label + " rows belong in ascending alphabetical order and " +
          list[i] + " sorts before " + list[i - 1] + ". Move the line " +
          "to where the ordering rule puts it - a union merge could " +
          "have left it here without anybody writing it out of order " +
          "by hand; " + ROSTER + "'s own header carries the rule.");
      }
    }
  }
  checkOrder(required, "required");
  checkOrder([...excluded.keys()], "EXCLUDE");

  /* F3 (0.9-M3-S7, #410): a roster made ENTIRELY of EXCLUDE lines
     still asserts nothing, however many exclusions it carries - the
     review found the guard here read `required.length === 0 &&
     excluded.size === 0`, so an empty required list was excused by any
     exclusion at all. Delete every arm file, delete every required
     row, and leave the EXCLUDE lines standing: that state passed green
     before this fix, and it is exactly the whole-arm SUBTRACTION
     MAJOR5/#311 built this file to catch. The count of exclusions is
     never relevant to whether the roster requires anything. */
  if (required.length === 0) {
    problems.push(ROSTER + " (empty)");
    console.log(ROSTER + " names no required arms. However many " +
      "EXCLUDE lines it carries, a roster that requires nothing " +
      "asserts nothing - this fails the same way no roster at all " +
      "does. Add at least one required row.");
  }

  const found = new Set(arms.map(rel));
  const requiredSet = new Set(required);

  /* Direction A (MAJOR5, #311, armed since it landed) - every path the
     roster REQUIRES must still be among what discovery found. */
  for (const name of required) {
    if (found.has(name)) continue;
    problems.push("required arm missing: " + name);
    console.log("REQUIRED ARM MISSING: " + ROSTER + " names " + name +
      " and discovery did not find it. Either the file was deleted " +
      "or renamed, or " + ROSTER + " itself needs updating - argue " +
      "for that change in the commit that makes it, per this file's " +
      "own DERIVE, DO NOT PIN header.");
  }

  /* Direction B (0.9-M3-S1, #381) - the gap 0.9-M2-S14's independent
     review found: a real suite's row was deleted from tests/ROSTER and
     the gate stayed green at the reduced count, because nothing ever
     asked discovery's question the other way round. Every path
     discovery FOUND must be named by the roster, required or
     excluded. */
  for (const name of found) {
    if (requiredSet.has(name) || excluded.has(name)) continue;
    problems.push("arm not on roster: " + name);
    console.log("ARM NOT ON ROSTER: " + name + " is a discovered " +
      "suite and " + ROSTER + " does not name it, required or " +
      "excluded. Add \"" + name + "\" to " + ROSTER + ", or, if it is " +
      "deliberately non-gating, add \"EXCLUDE " + name + " :: " +
      "<reason>\" - an unrostered suite reads identically to one " +
      "nobody remembered to keep, which is the gap this check exists " +
      "to close.");
  }

  /* The exclusion list against both the roster and discovery, the same
     two ways tools/check.py's NODE_SUITES_EXCLUDED is already checked
     (#204): an exclusion nobody can find any more excuses nothing, and
     a path both required and excluded is a contradiction the gate
     cannot act on. */
  for (const [name, reason] of excluded) {
    if (!found.has(name)) {
      problems.push("stale exclusion: " + name);
      console.log("STALE EXCLUSION: " + ROSTER + " excludes " + name +
        " (\"" + reason + "\") and discovery does not find it. An " +
        "exclusion for a file that is not there excuses nothing and " +
        "hides the next reader from the one that is - delete the " +
        "entry.");
    }
    if (requiredSet.has(name)) {
      problems.push("required and excluded: " + name);
      console.log("REQUIRED AND EXCLUDED: " + ROSTER + " both requires " +
        "and excludes " + name + " - the gate runs it either way " +
        "discovery finds it, so the exclusion is a false sentence " +
        "about this gate. Delete whichever of the two lines is wrong.");
    }
  }
}

/* THE PRINTED BUDGET (0.9-M3-S35, #460). Wall time is the whole gate's,
   from the first line this file printed to here - preflight and the
   roster checks included, not only the pooled arms - because a reader
   deciding whether this run was slow does not care which stage the time
   went into. The three slowest ARMS specifically (not preflight, which
   is one seam rather than a roster of many) are what a reader chases
   next when the total is a surprise. */
const wallMs = Date.now() - gateStarted;
const slowest = arms
  .map((path, index) => ({ name: rel(path), ms: effectiveMs(results[index]) }))
  .sort((a, b) => b.ms - a.ms)
  .slice(0, 3);
console.log("\nwall time    " + (wallMs / 1000).toFixed(1) +
  "s (pool size " + POOL_SIZE + ")");
console.log("slowest      " + (slowest.length
  ? slowest.map((arm) => arm.name + " " + (arm.ms / 1000).toFixed(1) + "s")
      .join(", ")
  : "(no arms ran)"));

/* THE BUDGET, ENFORCED OR ADVISORY (re-fire #2, F1/F5, Prime's ruling
   2026-08-22). Same trigger, same numbers, two different endings: a real
   run over budget is always worth printing, but it only fails the gate
   when BINDER_GATE_ENFORCE_BUDGET reads exactly "1" - CI is the one
   caller that sets it. Everywhere else (a bare `./run check`, a
   builder's own terminal) a slow run is visible, never a red for a fact
   that might be nothing but this one machine's own load right now. */
if (wallMs > BUDGET_SECONDS * 1000) {
  if (ENFORCE_BUDGET) {
    problems.push("over budget");
    console.log("\nOVER BUDGET: this run took " + (wallMs / 1000).toFixed(1) +
      "s wall, over the " + BUDGET_SECONDS + "s budget. Slowness is a red " +
      "here (BINDER_GATE_ENFORCE_BUDGET=1 is set), not a surprise left " +
      "for the next reader to notice by eye in a scrolling log - " +
      "BINDER_GATE_BUDGET_SECONDS raises the figure, with a reason " +
      "stated where it is set, for a machine known to run slower than " +
      "this default assumes.");
  } else {
    console.log("\nADVISORY OVER BUDGET: this run took " +
      (wallMs / 1000).toFixed(1) + "s wall, over the " + BUDGET_SECONDS +
      "s budget. Not enforced here - BINDER_GATE_ENFORCE_BUDGET=1 (set " +
      "by CI) turns this same line into a red; printed anyway so a slow " +
      "run is visible without failing a build over what might be this " +
      "one machine's own load. BINDER_GATE_BUDGET_SECONDS still raises " +
      "the figure in either mode.");
  }
}

console.log(problems.length
  ? "\n" + arms.length + " arm(s), " + problems.length + " problem(s): " +
    problems.join(", ") + "\nNot safe to push."
  : "\n" + arms.length + " arm(s), all green.");
process.exit(problems.length ? 1 : 0);
