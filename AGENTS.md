# Repository instructions for coding agents

**Read this before your first edit.** It is the only instructions file
in this repository — if you are about to create a second document
describing how agents work here, edit this one instead. Everything here
applies to every agent working this repository.

Authority, in order: direct owner instructions, this file, `DESIGN.md`,
the latest comment on the issue you are working. The owner sets the
goal, approves material trade-offs, and is the final decision-maker.

## The 0.9 wave

The design being built is the **keyless binder**, ruled by the owner on
2026-08-13 and recorded at issue #228, comment 5287071398. `DESIGN.md`
is that record in the shape a builder reads, and it is the file to
argue with — not the comment. **Version 1.0 is the cutover.**

**The naming standard is law: site version, milestone, slice.** Every
string that names a piece of work uses it, and there are no codenames,
no wave names and no descriptive titles standing in for it:

| Where | Form |
| --- | --- |
| Issue title | `0.9-M1-S2: <short name>` |
| Branch | `0.9-m1-s2` |
| Pull request title | leads with `0.9-M1-S2:` |
| GitHub milestone | `0.9-M1` |
| Fleet routing row | `0.9-m1-s2` |

The milestone cut, in order: **`0.9-M0`** the fleet-management and
foundation batch, running in parallel from day one · **`0.9-M1`** the
Worker foundation — bot auth, the new schema, the roster, the entries
API, live aggregates, settings · **`0.9-M2`** the member pages — door,
your page, charts · **`0.9-M3`** the admin pages — Members and Settings
· **`0.9-M4`** the demo rebuild, the register sitting and the copy.
Mockup-first review and the owner-gated demo apply from M2 on.

**Acceptance ships with its milestone**, as a section on the milestone's
own issue, written against what that milestone actually built. There is
no standing acceptance document; the one that used to be here described
a system that is being replaced, which is how it went stale.

**Model tier is part of the slice, not a habit.** Builders run on
Sonnet; a slice that reaches production or does anything irreversible
runs on a specialist; refactor runs on Opus; and the ruled list is
carried word for word — **crypto, auth and money slices build on Opus
regardless**. Read that list as written rather than as translated:
this project has no money surface today and its client-side crypto is
dead with the keys, so what it reaches in 0.9 is authentication, the
stored formats a Worker encrypts and anything holding a credential —
but a surface that comes back is covered by the list already, without
a new ruling. Review depth keys to the builder's tier. The tier lives
in the agent definitions, so a brief that names one is quoting them.

## The documentation system

The operative documents, and only these: `README.md`, `AGENTS.md`,
`DESIGN.md`, `OPERATIONS.md`. Beside them the registered `security/`
folder holds dated security records — an assessment against a named
baseline, a checklist, a later audit. Those are snapshots of what was
found on a date, never corrected in place, which is why they are not
operative documents and do not enlarge that set;
`security/README.md` is that folder's charter.
`tools/check_docs.py` holds both registries and **fails the gate on any
unregistered top-level document, on any registered one that goes
missing, and on any file in `security/` it does not name** — so adding
or removing either is a two-file act that cannot happen by accident.

**How documentation is written here. Deviating from any of these rules
needs owner approval first, asked in chat:**

1. **Every document declares its reader in its first line.** A document
   nobody is named for accumulates paragraphs for everybody.
2. **One home per fact.** A fact is stated in full in exactly one
   document; everywhere else points to it. The review that produced
   this system found single facts hand-copied into eight files, and
   corrections that missed copies three times in one week.
3. **Derived beats written down.** If a check, a data file or the code
   already holds the fact, say where to read it rather than copying it.
   Route lists, field lists, stage counts, secret names and port
   numbers all have a machine-readable home; a second copy in prose is
   a thing that can be wrong.
4. **Mutable state never goes in a document.** Who holds what, current
   blockers, deployment state, live configuration: GitHub issues and
   pull requests. History lookup is `git log`, issues and PRs.
5. **A process artifact states the condition that retires it.** A
   document, a section or a marked line that describes a transitional
   state says what ends it. Without that condition it outlives the
   transition, and the reader cannot tell whether it still applies.
6. **Corrections edit the sentence in place.** The story of what the
   text used to say goes in the commit message and the issue, not woven
   into the document. The one exception: a warning whose *reader's next
   action* depends on knowing the trap may keep its reason inline.
7. **New documents need the owner**, and so does a new record in
   `security/`. The registries above enforce it; editing one is the
   owner-approval act and says so.
8. American spelling in prose and identifiers, machine-checked;
   platform names keep their own spelling. Comments and docs explain
   *why*, not *what*.

`archive/` is the pre-2026-08-08 documentation, frozen. Never edit it
and never cite it as current; it is where the full reasoning lives when
an operative document compresses a decision to a sentence.

### The status artifact

The owner keeps a Claude artifact — **"Hang Gang's Binder — status"** —
as a daily historical-record dashboard. A session that materially
changes the repository updates it before ending; find it in the
artifact gallery by title, and do not commit its URL to this public
repository. It is a rendering of the record and never the record
itself: everything on it must be recoverable from issues, pull requests
and `git log`.

## Working an issue

Work is claimed and released on GitHub issues, and the collision that
matters is at the *file* level:

- **Read the board immediately before your first edit** — open issues
  with labels, and open pull requests with their real file lists. An
  open pull request reserves its files just as a labeled issue does.
- **A file is held if any open CLAIM names it**, whatever issue you
  associate that file with. Test your files against the claim lists,
  not against issue titles.
- **Check `git worktree list` too.** Two sessions can carry the same
  label, so the label cannot see a second one; a claim names its
  session by naming its worktree.
- **Post a `CLAIM` comment before the first edit**: branch, full
  40-character base SHA, the files held, the files deliberately not
  held. **Release the same way** when the pull request merges or you
  stop, then remove the label. A label left on a merged issue reads as
  held.
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

**The testing apparatus is being rebuilt, and 0.9 work is tested in the
new one.** Owner ruling, 2026-08-13: everything is new — the arms, the
runner, the gate verbs and the CI wiring — and its home is `tests/`
(0.9-M0-S4, #281). No 0.9 slice bends an old check or plugs into the
old runner; **re-using any old testing artifact requires stated
justification, and the presumption is against it.**

**The old gate is transitional.** It guards the surfaces that still
exist and nothing else, and its arms retire **with** each surface, in
the same pull request as the rebuild slice that removes it — no
unguarded window, and no check left running over something that is
gone. CI carries both worlds through the transition: the old gate
shrinking, the new one growing. The old runner retires when its last
surface does. Read an old check as evidence about the code it still
guards, never as the pattern for a new one.

- Run both gates before any handoff, and report the exact totals each
  prints — never a remembered count, and never "tests pass". The old
  one is `./run check` (or `py -3 tools/check.py`).
- **A new check is registered where its apparatus registers checks**,
  and **confirmed armed by mutation, in both directions**: break it,
  watch it fail, restore it, watch it pass, and state the mutations in
  the handoff. `tools/check.py` is the old runner's single registry,
  which CI runs whole as one step; a retirement edits it in the same
  change that removes the surface.
- **`tests/` is deliberately unregistered until #281 wires its
  runner**, and that is the one place the registration rule is
  suspended rather than met. Its suites are plain `node tests/<file>`
  entry points that import nothing from `dev/`, run by hand, and the
  slice that builds the runner adopts them by moving a file. Registering
  them in the dying runner would be the re-use the owner ruled against,
  so a 0.9 suite states in its handoff that it was run by hand and how
  — an unregistered check reported as gated is the failure this bullet
  exists to prevent.
- Mutation is necessary and not sufficient. A mutation only asks "does
  this check enforce what it says?", never "is this the right thing to
  enforce?" — the review bar below is what answers that.
- Exercise affected pages in a real browser. **Verify what renders, not
  what a property says**: `element.hidden` can read true while the
  element paints — use `getComputedStyle()` and `getClientRects()`.
- **Label every verification claim** as source, local browser, CI or
  live, and never let one imply another. A check you could not run is
  reported as *not performed*, never omitted. A queued CI run is not a
  green run.
- **A `live` claim nobody could perform belongs in the ledger, not only
  in a pull request body.** `./run live` is the query for what has
  never been exercised against a running system, what never can be
  before production, and when the next batch is due;
  `tools/check_live.py` carries it, and the gate fails on a route or a
  page that has no row. A body is not in the repository, so a correct
  label written in thirty of them summed into a gap nobody owned.
- **Check that a CI run exists for the head commit**, not merely that
  none failed — an absent run reads as success in every listing:
  `gh api "repos/OWNER/REPO/actions/runs?head_sha=<sha>"` with the
  **full 40-character SHA**; an abbreviated one returns the same empty
  answer as a commit that never ran.

## The review bar

Reviewing means **attacking the threat the design names, not checking
the criterion the spec lists.** Read the hazard in `DESIGN.md` in its
own words, then try to produce it; if it can be produced while the gate
stays green, the specification is wrong, and saying so is the review's
job. The worked example: every specified bullet implemented and armed,
and the gate still passed with the production and development keys
*exchanged* — distinctness was the criterion, and two swapped arms are
still distinct. Corollary: a check computed entirely from the file it
guards cannot detect that the file was rearranged; something outside
the file has to say what it may contain.

A finding against the specification is not a finding against whoever
implemented it. Say which it is.

## Boundaries

- **Never ask for, handle or log a secret.** The Telegram bot token,
  the secret entries are encrypted under, any Cloudflare API token, any
  development login secret. Generating a fresh value is still handling
  one. The committed throwaway development keys are the only key
  material any slice touches.
- **A coding request does not authorize an adjacent act** — deploys,
  secret changes, database mutations need the owner to ask. But asking
  can be one line in chat, and an agent with approval performs the act
  itself. Irreversibility is a reason to confirm first, not a reason to
  hand the work to somebody else.
- **`owner-only` means unreachable from an agent session**, for exactly
  two reasons: it needs a secret, or it is not on this machine — a
  BotFather setting, a Telegram group, a dashboard screen no CLI
  reaches. Every `owner-only` issue carries numbered steps; if writing
  the steps shows an agent could do it, the label is wrong.
- **`apps/web/` is the site you edit; `dist/` is the site that is
  published.** `dist/` is `apps/web` with the comments removed from the
  CSS and the scripts — `./run build` writes it, it is committed, and
  the gate refuses one that is not what `apps/web` builds to in either
  direction (#181). **Never edit `dist/` by hand.** Neither directory
  takes a test hook, a fixture, a development-only global or a
  `?sample=` hook.
- **`apps/` also holds source that is neither the site nor published.**
  `apps/site.config.js` and `apps/fields.js` sit beside `apps/web/`,
  not inside it, and nothing in either directory above is derived from
  them yet — 0.9-M2 is what moves the spec into the shipped tree and
  loads it there. Adding a file at the top of `apps/` is therefore a
  decision about what a page may read, not a tidying choice.
- **A push to `main` is a release**; work goes to `accounts` until the
  cutover. The hotfix procedure is in `README.md`, which is on `main`
  when you need it.
- Wrangler authenticates from an agent shell; the first call in a
  session may fail once with error 10000 and succeeds on retry.
  **`--env dev` is not optional on any deploy** — a bare deploy
  resolves to production. Dry-run and read the bindings back.
- Session material lives in `sessionStorage`, never persistent storage;
  signing out clears whatever the page kept.

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
  it. **A change that falsifies a comment updates or deletes that
  comment in the same change.** `tools/check_comments.py` carries the
  phrase list and enforces it as a **ratchet** — every offender already
  here is pinned in its allowlist, a new one fails the gate, and a pin
  that stops matching fails too, so the list can only shrink and cannot
  go stale. Take an entry off in the change that next touches its file;
  never raise a count. **A comment that names another file and quotes
  it must still be quoting it**, enforced against the cited file rather
  than against phrases.
- **Comments in the pre-0.9 code slim as 0.9 rewrites each file.** The
  documentation moved to the 0.9 design ahead of the code by owner
  ruling, so a comment in a page or a Worker that argues from the key
  world is expected until its milestone reaches it — and is deleted or
  rewritten by the slice that does, never by a separate comment hunt.
  `tools/check_comments.py` names every such comment whose citation the
  documentation rewrite falsified; clearing your file's entries is part
  of rewriting it.
- **Commit messages carry the reasoning** — the why, what was rejected,
  what was verified. This project recovers facts from `git log`; a pull
  request body is not in the repository.
- **Never regenerate a committed fixture to make a failing test pass.**
  A stored-format fixture failing means the stored format changed and
  every stored row went with it; the fix is a new version byte and a
  decoder for both.

## The live channel

The owner-and-agents channel records nothing. Claims stay on GitHub;
decisions are not made until their SHA lands and is posted back. Never
paste a secret — one that appears there is burned; say so and rotate it
immediately. Address agents by name and only the named agent replies.
Label verification claims. Bring the owner decisions and blockers, not
progress narration — and when the owner says something is done, it is
done. Disagreements: both positions stated once, owner decides.

## When a second agent runs sandboxed

An agent driven as a tool inside a sandboxed clone has **no network**:
it cannot fetch, pull, push or comment, and those failures look like
ordinary shell noise to it. Whoever drives it therefore syncs the clone
and creates the branch *before* the delegation, posts the claim and the
label, **reads the whole diff** before committing with the author set
to the agent that wrote it, and releases. Publishing a slice does not
make it yours — the label still says who holds the files. If it dies
mid-slice, nothing partial is published as finished: run the gate on
what is actually in the clone, then either take the slice over or hand
it back with nothing committed. Never reply into a dead thread; a
follow-up without its thread id starts a cold agent that answers as if
it remembered.

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
- 2026-08-08: a PR in CONFLICTING state gets no `pull_request` run at
  all — GitHub creates nothing when it cannot compute the merge, and an
  absent run reads as success in any listing that only looks for
  failures. Rebase first, then look for the run by full SHA.
- 2026-08-08: the same bytes do not gzip to the same size on both
  machines — Python here links zlib-ng, the runner links stock zlib,
  and level 9 differs. Any size gate needs slack, and **which machine
  comes out larger is not fixed** — pin against the larger measurement
  rather than against a named machine. `tools/check_budget.py` carries
  the current figure and how to re-measure it.
- 2026-08-08: `__pycache__` outlives `git checkout` — Python keeps
  serving the previous tree's bytecode, so a reverted mutation stays
  "applied" and the gate lies in both directions. Delete `__pycache__`
  before trusting any Python check after switching trees.
- 2026-08-08: `git worktree remove --force` follows a Windows junction
  inside the worktree and deletes the **target's** contents. Sever
  junctions before any recursive removal touches a tree that might hold
  one.
- 2026-08-08: `getComputedStyle()` inside a `display:none` subtree
  serves stale resolved colors — two palettes read back identical while
  the custom properties under them do change. Reveal the element and
  read one palette per script call.
- 2026-08-08: a worktree warm-up that races the agent already working
  in it detaches HEAD mid-slice — the commit lands on no branch and the
  branch signaled as ready pushes nothing. Move no worktree that has a
  branch checked out or commits of its own.
- 2026-08-09: a worktree checked out before the `*.txt text eol=lf` pin
  holds `apps/web/robots.txt` with CRLF while the built copy is LF, and
  "dist is the build of apps/web" fails on a tree where nothing is
  wrong. Delete the tracked `.txt` files, `git checkout --` them under
  the pin, and only then believe a remaining red. Hit again 2026-08-13.
- 2026-08-10: `dev/demo-server.mjs` takes `--port`, not a positional —
  a positional is silently ignored and the committed default binds,
  which is how a reserved port block gets double-claimed unnoticed.
  Confirm the banner names the port you asked for.
- 2026-08-13: a bake that does not clear its output directory deploys
  whatever the previous bake left; six stale files reached a published
  build that way. Clearing the output is part of building it.
