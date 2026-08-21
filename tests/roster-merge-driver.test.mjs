/*
 * Proves `.gitattributes`' `tests/ROSTER merge=union` line (0.9-M3-S18,
 * #428) is what turns two parallel appends to tests/ROSTER from a
 * conflict into a clean merge - the exact shape that stopped the door on
 * 2026-08-21: 0.9-M3-S8 and 0.9-M3-S10 each added one row, S10 landed
 * first, and `gh pr update-branch` on S8's PR (#427) hit a content
 * conflict that needed a specialist merge-forward.
 *
 * Reads the REAL `.gitattributes` rather than authoring a copy of its
 * text - the same reason tests/roster-two-way.test.mjs reads the real
 * tests/run.mjs instead of reimplementing it: a copy could drift from
 * what actually ships and prove nothing. Two fixture git repos, same
 * base commit, same two branches each appending one different row to
 * tests/ROSTER at the same position (the end of the file) - the exact
 * overlap that makes an ordinary merge conflict, confirmed by hand
 * before this file existed:
 *
 *   - WITHOUT the driver: `git merge` exits 1, CONFLICT (content), and
 *     tests/ROSTER is left holding literal `<<<<<<<` markers.
 *   - WITH the driver: `git merge` exits 0, "Auto-merging tests/ROSTER",
 *     and both branches' added rows are simply both there.
 *
 * The first fixture repo carries the real `.gitattributes` (the driver
 * active) and must merge clean. The second carries it with the
 * `tests/ROSTER merge=union` line stripped - the "remove the attribute"
 * mutation the floor calls for, baked into the arm so it is proven every
 * run rather than needing a separate hand pass - and must conflict the
 * way S8 vs S10 really did. Scenario 1 is therefore RED whenever the
 * real file has lost the line (nothing to strip differently between the
 * two fixtures) and GREEN only while the line is really there: this arm
 * would have failed had 0.9-M3-S18 never added it.
 *
 * GitHub's OWN server-side merge (the "Update branch" button, the PR
 * merge button, auto-merge) does not read this file at all - confirmed
 * against GitHub's own words in
 * https://github.com/orgs/community/discussions/9288 ("GitHub doesn't
 * consider user-defined .gitattributes files (normally, we use our own
 * .gitattrbutes file which you can't change)"), still open and
 * unresolved as of this writing. So the driver this arm proves fires on
 * a LOCAL `git merge` only - a PR whose branches both touch tests/ROSTER
 * still needs a merge-forward run by hand before push; this arm is what
 * proves that hand step actually resolves clean, not a claim that
 * GitHub's own button now does.
 *
 *     node tests/roster-merge-driver.test.mjs
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const REAL_ATTRIBUTES = await readFile(join(ROOT, ".gitattributes"), "utf8");

const UNION_LINE = /^tests\/ROSTER\s+merge=union\s*$/m;
if (!UNION_LINE.test(REAL_ATTRIBUTES)) {
  console.log("FAIL  .gitattributes carries no \"tests/ROSTER " +
    "merge=union\" line - nothing for this arm to prove.");
  process.exit(1);
}

/* The "remove the attribute" mutation, reproduced by construction rather
   than by a hand-run mutation pass: the file with only that one line
   gone, everything else - the eol pins this repo also depends on -
   left exactly as shipped. */
const STRIPPED_ATTRIBUTES = REAL_ATTRIBUTES
  .split("\n")
  .filter((line) => !/^tests\/ROSTER\s+merge=union\s*$/.test(line))
  .join("\n");

const BASE_ROSTER = "tests/alpha.test.mjs\ntests/beta.test.mjs\n";

function git(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  });
  return {
    code: result.status,
    output: (result.stdout || "") + (result.stderr || ""),
  };
}

/* Builds a temp repo carrying the given .gitattributes text, commits a
   base tests/ROSTER, then branches twice off that same base - branch-a
   appends tests/gamma.test.mjs, branch-b appends tests/delta.test.mjs,
   both at the same position - and merges branch-b into branch-a.
   Returns the merge's exit code and the post-merge tests/ROSTER text
   ("" if the file could not be read, which a conflicted merge still
   leaves readable with markers in it). Local `user.*` and gpg signing
   are set per-repo so this never depends on - or writes to - the
   machine's own git config. */
async function mergeFixture(attributesText) {
  const root = await mkdtemp(join(tmpdir(), "hgb-roster-merge-driver-"));
  git(root, ["init", "--quiet", "--initial-branch=main"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["config", "user.name", "Fixture"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  await mkdir(join(root, "tests"));
  await writeFile(join(root, ".gitattributes"), attributesText);
  await writeFile(join(root, "tests", "ROSTER"), BASE_ROSTER);
  git(root, ["add", "-A"]);
  git(root, ["commit", "--quiet", "-m", "base"]);

  git(root, ["checkout", "--quiet", "-b", "branch-a"]);
  await writeFile(join(root, "tests", "ROSTER"),
    BASE_ROSTER + "tests/gamma.test.mjs\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "--quiet", "-m", "branch-a adds gamma"]);

  git(root, ["checkout", "--quiet", "main"]);
  git(root, ["checkout", "--quiet", "-b", "branch-b"]);
  await writeFile(join(root, "tests", "ROSTER"),
    BASE_ROSTER + "tests/delta.test.mjs\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "--quiet", "-m", "branch-b adds delta"]);

  git(root, ["checkout", "--quiet", "branch-a"]);
  const merge = git(root, ["merge", "--no-edit", "branch-b"]);
  const rosterText = await readFile(join(root, "tests", "ROSTER"), "utf8")
    .catch(() => "");
  await rm(root, { recursive: true, force: true });
  return { code: merge.code, rosterText };
}

let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) failures += 1;
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

/* 1. The real .gitattributes, union driver active: the merge that broke
   the door for S8/S10 goes clean, both rows land, no conflict markers. */
{
  const { code, rosterText } = await mergeFixture(REAL_ATTRIBUTES);
  check("with the real .gitattributes, the merge exits 0", code === 0);
  check("no conflict markers in the merged tests/ROSTER",
    !rosterText.includes("<<<<<<<"));
  check("both branches' rows survive the merge",
    rosterText.includes("tests/gamma.test.mjs") &&
    rosterText.includes("tests/delta.test.mjs"));
}

/* 2. The same merge with the union line stripped - the mutation the
   floor calls for ("remove the attribute -> the fixture merge
   conflicts"), proven every run. Reproduces the real 2026-08-21
   conflict exactly: two branches appending at the same position, no
   driver to reconcile them, git's ordinary 3-way merge left to conflict
   the way it did for S8 and S10. */
{
  const { code, rosterText } = await mergeFixture(STRIPPED_ATTRIBUTES);
  check("with the attribute stripped, the merge exits nonzero (conflict)",
    code !== 0);
  check("the stripped-attribute merge leaves conflict markers behind",
    rosterText.includes("<<<<<<<"));
}

const EXPECTED = 5;
console.log(failures
  ? `\nroster-merge-driver FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\nroster-merge-driver ran ${performed} checks, expected ${EXPECTED}`
    : `\nroster-merge-driver OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
