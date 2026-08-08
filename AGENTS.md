# Repository instructions for coding agents

**This is the only instructions file in this repository.** If you are
about to create a second document describing how agents work here, edit
this one instead. Two agents work on this repository — **Claude** and
**Codex** — and everything here applies to both unless it names one.

Authority, in order: direct owner instructions, this file, `DESIGN.md`,
the latest comment on the issue you are working. The owner sets the
goal, approves material trade-offs, and is the final decision-maker.

## The documentation system

Five operative documents, and only five: `README.md`, `AGENTS.md`,
`DESIGN.md`, `OPERATIONS.md`, `CUTOVER.md` (which is deleted after the
cutover it describes). `tools/check_docs.py` holds that registry and
**fails the gate on any unregistered top-level document** — so adding
one is a two-file act that cannot happen by accident.

**How documentation is written here. Deviating from any of these rules
needs owner approval first, asked in chat:**

1. **One home per fact.** A fact is stated in full in exactly one
   document; everywhere else points to it. Before writing a paragraph,
   ask which document owns it — the review that produced this system
   found single facts hand-copied into eight files, and corrections
   that missed copies three times in one week.
2. **Mutable state never goes in a document.** Who holds what, current
   blockers, deployment state, live configuration: GitHub issues and
   pull requests. History lookup is `git log`, issues and PRs — that is
   the system of record for anything code-centric, by owner direction.
3. **Corrections edit the sentence in place.** The story of what the
   text used to say and why it changed goes in the commit message and
   the issue — not woven into the document. The archive keeps the old
   style for the era it covers; operative documents carry current truth
   only. The one exception: a warning whose *reader's next action*
   depends on knowing the trap (for example "do not remove that index
   as redundant") may keep its reason inline.
4. **No machine-knowable fact goes in prose.** Stage counts, suite
   lists, port numbers already in config, secret values' presence —
   state where to look and how to check, not what the answer was on the
   day of writing. The gate's stage count was wrong in three places in
   one week because it was prose.
5. **New documents need the owner.** The registry above enforces it;
   editing the registry is the owner-approval act and says so.
6. American spelling in prose and identifiers (machine-checked now);
   platform names keep their own spelling. Comments and docs explain
   *why*, not *what*.

`archive/` is the pre-2026-08-08 documentation, frozen. Never edit it,
never cite it as current; it is where the full reasoning lives when a
root document compresses a decision to a sentence.

### The status artifact

The owner keeps a Claude artifact — **"Hang Gang's Binder — status"** —
as a daily historical-record dashboard: what happened each working day,
and where the project stands. A Claude session that materially changes
the repository updates it before ending (find it in the artifact
gallery by title; do not commit its URL to this public repository).
It is a rendering of the record, never the record itself: everything on
it must be recoverable from issues, PRs and `git log`.

## Working an issue

Work is claimed and released on GitHub issues. Both agents publish as
the same GitHub account, so **the `claude` and `codex` labels are the
lock**, and the collision that matters is at the *file* level:

- **Read the board immediately before your first edit** — open issues
  with labels, and open PRs with their real file lists. An open PR
  reserves its files just as a labelled issue does.
- **Check `git worktree list` too.** Two Claude sessions carry the same
  label, so the label lock cannot see a second Claude; a claim names
  its session by naming its worktree.
- **Post a `CLAIM` comment before the first edit**: branch, full
  40-char base SHA, the files held, the files deliberately not held.
  **Release the same way** when the PR merges or you stop, then remove
  the label. A label left on a merged issue reads as held.
- If your file list overlaps an existing claim: take a different issue,
  branch from *their* branch and say so, or ask them to release. Pick
  one out loud; picking silently is not an option.
- A claim is stale after roughly a day with no push. Take it over by
  commenting first, then swapping the label — never by simply starting.
- Work in your own checkout; stage files explicitly; never `git add -A`
  over work you did not make. Shut down any preview server you started
  before reporting done.

**The contract between agents is a failing test, not a paragraph.**
Commit the test first, implement to green. Where behavior cannot be
known in advance, spike, observe, record the finding in a commit, then
pin it. Whoever takes an issue specs it, tests it and builds it; the
other reviews the diff and may block. Do not manufacture parallelism —
on a dependency chain the second agent's value is review, not
throughput.

**`Closes #N` does not fire while `main` is frozen** — auto-close only
runs on the default branch. Write the reference anyway, then close the
issue by hand with a comment saying what landed.

## Verification

- Run the gate before any handoff: `./run check` (or
  `py -3 tools/check.py`). Report the exact totals it prints — never a
  remembered count, and never "tests pass".
- **A new check is registered in both suite lists** — `tools/check.py`
  and `.github/workflows/deploy.yml` — and **confirmed armed by
  mutation, in both directions**: break it, watch it fail, restore it,
  watch it pass, and state the mutations in the handoff.
- Mutation is necessary and not sufficient. A mutation only asks "does
  this check enforce what it says?", never "is this the right thing to
  enforce?" — the review bar below is what answers that.
- Exercise affected pages in a real browser. **Verify what renders, not
  what a property says**: `element.hidden` can read true while the
  element paints — use `getComputedStyle()` and `getClientRects()`.
- **Label every verification claim** as source, local browser, CI, or
  live, and never let one imply another. A check you could not run is
  reported as *not performed*, never omitted. A queued CI run is not a
  green run.
- **Check that a CI run exists for the head commit**, not merely that
  none failed — an absent run reads as success in every listing:
  `gh api "repos/OWNER/REPO/actions/runs?head_sha=<sha>"` with the
  **full 40-character SHA** (`git rev-parse HEAD`); an abbreviated one
  returns the same empty answer as a commit that never ran.

## The review bar

Reviewing means **attacking the threat the design names, not checking
the criterion the spec lists.** Read the hazard in `DESIGN.md` in its
own words, then try to produce it; if it can be produced while the gate
stays green, the specification is wrong, and saying so is the review's
job. The worked example is check 5: every specified bullet implemented
and armed, and the gate still passed with the production and
development keys *exchanged* — distinctness was the criterion, and two
swapped arms are still distinct. Corollary: a check computed entirely
from the file it guards cannot detect that the file was rearranged;
something outside the file has to say what it may contain.

A finding against the specification is not a finding against whoever
implemented it. Say which it is.

## Boundaries

- **Never ask for, handle, or log a secret.** The private keys, the
  export token, `DEV_LOGIN_SECRET`, `ACCOUNT_SECRET`, the bot token,
  any Cloudflare API token. Generating a fresh value is still handling
  one.
- **A coding request does not authorize an adjacent act** — deploys,
  secret changes, D1 mutations need the owner to ask. But asking can be
  one line in chat, and an agent with approval performs the act itself.
  Irreversibility is a reason to confirm first, not a reason to hand
  the work to somebody else.
- **`owner-only` means unreachable from an agent session**, for exactly
  two reasons: it needs a secret, or it is not on this machine (a
  BotFather setting, a Telegram group, a dashboard screen no CLI
  reaches). Every `owner-only` issue carries numbered steps; if writing
  the steps shows an agent could do it, the label is wrong — take it
  off, ask in chat, do the work.
- **`apps/web/` is copied verbatim to the published site.** No test
  hooks, no fixtures, no development-only globals, deliberately no
  `?sample=` hook.
- **A push to `main` is a release**; work goes to `accounts` until the
  cutover. The hotfix procedure is in `README.md`, which is on `main`
  when you need it.
- Wrangler authenticates from an agent shell; the first call in a
  session may fail once with error 10000 and succeeds on retry.
  **`--env dev` is not optional on any deploy** — a bare deploy
  resolves to production. Dry-run and read the bindings back:
  `hg_binder_db_dev` and localhost origins, or stop.
- Session material lives in `sessionStorage`, never persistent storage;
  signing out must also clear the local prefill.

## Code standards

Machine-checked wherever possible; the gate is the standard. What the
linters cannot express:

- **The module shape means something.** `(function (root) { … })
  (globalThis)` assigns a global; `(function () { … })()` does not. No
  unused `root` parameters for symmetry.
- **Exported objects are frozen**, so a page cannot quietly redefine a
  helper another page depends on.
- **The pure/DOM split is what makes the suites possible.** Modules
  export a pure half and wire the DOM behind a
  `typeof document === "undefined"` guard, so Node loads the shipped
  file's real bytes. `ui.js` is DOM-only — no `fetch`, no POST.
- **Comments say why; git says what changed.** A comment states the
  present-tense reason the code is this shape — what breaks if it is
  changed back, what trap the next reader is walking into. What
  changed, and whatever triggered it, goes in the commit message, the
  pull request and the issue. A comment that narrates a change is a
  claim about the past that no test covers, so nothing ever falsifies
  it: the code moves on and the sentence stays. **A change that
  falsifies a comment updates or deletes that comment in the same
  change.** `tools/check_comments.py` carries the phrase list and
  enforces it as a **ratchet** — every offender already here is pinned
  in its allowlist, a new one fails the gate, and a pin that stops
  matching fails too, so the list can only shrink and cannot go stale.
  Take an entry off in the change that next touches its file; never
  raise a count.
- **Commit messages carry the reasoning** — the why, what was rejected,
  what was verified. This project recovers facts from `git log`; a PR
  body is not in the repository. A single subject line is for changes
  that genuinely need no explanation, which is rare here.
- **Never regenerate a committed fixture to make a failing test pass.**
  `dev/fixture.json` and the account-id fixture failing means the
  stored format changed and every stored row went with it; the fix is a
  new version byte and a decoder for both.

## The live channel

The owner+agents channel records nothing. Claims stay on GitHub;
decisions are not made until their SHA lands and is posted back. Never
paste a secret — one that appears here is burned; say so and rotate it
immediately. Address agents by name and only the named agent replies;
if a message is ambiguous, one agent asks who is taking it rather than
both answering. Label verification claims (source / CI / browser /
live). Bring the owner decisions and blockers, not progress narration —
and when the owner says something is done, it is done. Disagreements:
both positions stated once, owner decides.

## When Codex runs as an MCP tool

Codex driven by Claude runs in a sandboxed clone with **no network**:
it cannot fetch, pull, push, or comment, and those failures look like
ordinary shell noise to it. Claude therefore: syncs the clone and
creates the branch *before* every delegation (the sandbox cannot write
`.git`), posts the claim and label, **reads the whole diff** before
committing with `--author` set to Codex, opens the PR, and releases.
Publishing a slice does not make it Claude's — the label still says
who holds the files. If Codex dies mid-slice, nothing partial is
published as finished: run the gate on what is actually in the clone,
then either take the slice over (comment, swap the label, name the
seam in the commit) or hand it back (commit nothing, stop comment,
remove the label). Never `codex-reply` into a dead thread — a follow-up
without the `threadId` starts a cold Codex that answers as if it
remembered.

## When to stop and ask

Stop and return to the owner when: the plan and the code disagree in a
way that changes the design; a change would alter a privacy claim, a
security boundary, or what is published; the work needs a secret, a
deployment, or anything irreversible; or a check cannot be made to fail
and you are about to ship it anyway. **Stopping to ask is not handing
the work over** — ask, get the answer, then do it yourself.

## Field notes

Hard-won platform facts, one line each, dated. The full stories are in
`archive/` and the commits that found them.

- 2026-08-05: two orphaned preview servers silently served a stale
  branch; kill your servers and confirm the port is free.
- 2026-08-06: GitHub Actions `pull_request` branch filters match the
  **base**, so a PR stacked on another branch gets no run at all —
  dispatch `verify` on the branch, or retarget after the parent merges.
- 2026-08-06: retarget a stacked child **before** merging its parent
  with `--delete-branch`, or the child auto-closes unrecoverably.
- 2026-08-06: after a squash merge, commit messages the squash did not
  absorb die with the branch — compare `git log --format=%B` both sides
  before deleting.
- 2026-08-06: `workflow_dispatch` on `main` **deploys**; on any other
  ref it verifies only.
- 2026-08-06: during a CI incident, run *creation* lags — absent-now is
  not absent-forever; and one green run does not end an outage.
- 2026-08-06: `npx --yes wrangler@latest` resolved to two different
  majors minutes apart; pin the version in anything written down.
- 2026-08-06: piping a value into `wrangler secret put` makes it demand
  an API token nobody here may handle; a stdin wrapper is a dead end.
- 2026-08-08: one failed call is a hypothesis, not a capability
  boundary — the wrangler auth error 10000 refreshes and succeeds on
  retry, and the note claiming impossibility cost a day.
- 2026-08-08: a rehearsal against the wrong starting state goes green
  and proves nothing; the starting state is the part nobody checks.
