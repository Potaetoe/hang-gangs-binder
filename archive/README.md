# archive/

The documentation system this repository used from 2026-08-05 to
2026-08-08, frozen. Replaced in issue #77 by the five-document system at
the repository root, after a review found the same facts hand-copied into
five to eight files each, and three corrections in one week that each
missed at least one copy.

**Nothing in here is maintained.** These files were trued up once on
2026-08-08, immediately before freezing, and are not edited after it. A
claim in here may have been correct on its date and falsified since; the
code, the gate, and the root documents are the authority, and when they
disagree with this directory, this directory loses.

The files are kept rather than deleted because they carry the full
reasoning behind the design and the working record of how it was built —
including corrections recorded *as* corrections, which the root documents
deliberately no longer do. When a root document compresses a decision to
a sentence, the paragraph it compressed is in here.

| Was | What it carried | Where that lives now |
| --- | --- | --- |
| `root-README.md` | product intro, local preview, hotfix procedure | `README.md` |
| `AGENTS.md` | agent rules plus an operational encyclopedia | `AGENTS.md` — rules only; hard-won trivia is its "Field notes" |
| `DESIGN.md` | architecture, decisions, every rejected alternative | `DESIGN.md`, condensed; full reasoning stays here |
| `REDESIGN.md` | the accounts build plan and its running record | build finished 2026-08-07; history in issues and `git log` |
| `CUTOVER.md` | the cutover runbook with findings woven in | `CUTOVER.md`, terse; findings in `git log` and here |
| `UAT.md` | the acceptance pass; Part A's record | Part A's final record is here; Part B is in `CUTOVER.md` |
| `HANDOFF.md` | operating and transferring the project | `OPERATIONS.md` |
| `CHANNEL.md` | conduct in the live owner+agents channel | `AGENTS.md`, "The live channel" |
| `CHANGELOG.md` | product changes, dated | issues, pull requests, `git log` |
| `DAILY_LOG.md` | the working day | issues, pull requests, `git log` |
| `dev-README.md` | the test-harness guide | `dev/README.md` |
| `server-README.md` | Worker setup, secrets, probe matrix | `server/README.md` (pointer) and `OPERATIONS.md` |

The gate's documentation stage (`tools/check_docs.py`) deliberately does
not scan this directory, so the falsified claims it hunts out of
operative documents are allowed to survive in here as history.
