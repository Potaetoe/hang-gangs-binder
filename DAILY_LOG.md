# Daily log

The working record for this repository, newest first — decisions,
coordination, and what is left blocked on whom. What *changed in the
product* belongs in `CHANGELOG.md`; this file is for the day itself.

**One entry per day, written by both agents.** If Claude and Codex both
worked, the day has one entry describing both — append to it rather than
starting a parallel one. See `AGENTS.md`, "Where the record lives".

Starts 2026-08-05.

---

## 2026-08-05

**Landed:** 17 commits, `main` at `b6a984f`, CI green. Later the same day
`main` was frozen there and work moved to the `accounts` branch.

**Open at end of day:** draft PR #17 (step 3, session half); review issue
#18; one owner errand on the critical path.

Two agents worked: **Claude Opus 5** and **Codex Sol 5.6**. Codex took
steps 0, 0.5 and the session half of step 3; Claude took step 8, the CI
and release-model work, and review.

### The shape of the day

Three phases, and the middle one changed how the rest of the project gets
built.

**Morning — finishing the first system.** The export page and its
dashboard, the spreadsheet writer, the public dashboard, site navigation,
the desktop layout. At the end of it both ends of the original design
existed and were live: submitters encrypt in the browser, the keyholder
exports in theirs, nothing in between can read anything.

**Midday — the redesign, and the correction that caused it.** A privacy
claim in `DESIGN.md` was false: renumbering pseudonyms between published
snapshots never stopped anyone lining two snapshots up, because exact
timestamps and weights were a join key. Fixing it properly meant
quantisation, which landed the same day.

The larger thread was spam, filed as an operational problem — a nuisance
if junk ever appeared. Pulling on it produced accounts, sessions, a
deletion path and a gated dashboard, because nothing built could undo a
flood of junk rows. **A problem whose damage cannot be reversed by
anything in the system is not an operational problem, whatever it looks
like from the outside.** `REDESIGN.md` is the plan that came out of it.

**Afternoon and evening — two agents.**

### Decisions taken today

- **The split is by slice, not by phase.** `CODEX.md` was committed saying
  Claude-plans / Codex-implements and was revised the same day: whoever
  takes a slice specs it, tests it and builds it; the other reviews with
  authority to block.

  The reason is specific to this repository — its design facts have
  consistently come *out of* implementation. A wall between planning and
  building sits exactly where the information flows.

  **This revision was never written into the repository**, which is why
  Codex went on describing itself as the implementer in its own
  documents. Corrected at the end of the day in `AGENTS.md`.

- **The contract between agents is a failing test, not a paragraph.**
  Commit the test first, implement to green. Where behaviour cannot be
  known in advance, *spike then specify*.

- **Coordination runs through GitHub, not through the owner.** Eleven
  issues, one per build step, each naming the files its slice may touch.

- **The lock is a label, not an assignee** — both agents publish as
  `Potaetoe`, so GitHub cannot tell them apart.

- **Refer to slices by step number, never by issue number.** Issue #9 is
  step 8.

- **Parallelism is limited and should not be manufactured.** On a chain
  the second agent's value is review, not throughput.

### Coordination mechanics that had to be worked out

- Codex works in a **separate clone**, not a worktree of the main tree —
  stronger isolation than planned, and it means an uncommitted edit in
  one tree can never surprise the other.
- Codex's local Git and GitHub CLI could not read the machine's existing
  GitHub credentials, so it published through the GitHub connector
  instead. **Consequence worth knowing:** the connector constructs its own
  commit objects, so an identical tree arrives on the remote under a
  different SHA. Codex's local `60e50c2` and the pushed `21deba7` have
  byte-identical trees. Verify integrity by comparing blob and tree SHAs,
  not commit SHAs.
- Deployment authority stayed narrow throughout: Codex ran no Wrangler
  command, handled no secret, and made no D1 or production change.

### Step 0 — shared page wiring (Codex)

Issue #1, merged in PR #14; CI registration followed in PR #15.

- Added frozen `globalThis.BinderUI` in `apps/web/ui.js` — element lookup,
  visibility, checked-radio selection, status messages, guarded startup.
- Rewired form, dashboard, public dashboard and admin onto it **without**
  moving network behaviour into `ui.js`; `dev/ui.test.mjs` pins that as an
  architectural rule (no `fetch`, no POST).
- The suite landed registered in `tools/check.py` but **not** in GitHub
  Actions, so it passed locally and never ran in the pipeline. Caught and
  fixed in PR #15. **There are two suite lists and they have to be edited
  together.**

### Step 0.5 — development isolation (Codex)

Issue #2, merged in PR #16.

- Added the `hgbinderworker-dev` Wrangler environment with preview URLs
  disabled and the development D1 bound as `DB` — not the binding name
  `d1 create` prints, which would have deployed cleanly and failed on the
  first query.
- Removed loopback origins from the production Worker; they live in the
  development environment now.
- `config.js` selects by exact hostname, aliases `127.0.0.1`, and fails
  closed on unknown hosts.
- Expanded `check_web.py` to validate both arms, and moved its
  `connect-src` test from substring to exact token matching.
- Nine deliberate mutations run before handoff.

### Step 3 — session half, before the bot (Codex)

Issue #4, draft PR #17. Session commit `21deba7`, later rewritten to
`539e6ea` — same tree, rebased onto `accounts` with the reasoning moved
from the PR body into the commit message.

- Frozen `globalThis.BinderSession`: validated tab-scoped storage, expiry,
  removal of malformed values, bearer headers, signed-out redirects,
  visible development-session markers.
- The common half of `auth.js` — development auth and the future widget
  callback share one POST/store/redirect path.
- Form moved to `submit.html`; `index.html` is a sign-in-only shell that
  does not load `crypto.js`.
- Break-glass preserved: loading `session.js` does not gate `admin.html`.

Verified green: nine gates, 303 Node assertions, 27 focused session/auth
checks, browser checks using computed styles and client rectangles, and
three mutations.

### What the day cost, and what it bought

The two-agent setup immediately exposed a gap it created: CI fired only on
pushes to `main`, so under branch-and-review every check ran *after* the
merge. PR #12 was merged on a local gate alone. Fixed the same day.

### Review of PR #17 (Claude)

Reviewed in a scratch worktree, gate re-run rather than accepted: all 9
pass. The code is good — the pure/DOM split holds, tests load the shipped
files, `index.html` genuinely does not load `crypto.js`.

**Blocked initially, and not for a code defect.** The PR said the deployed
Worker already refuses unsigned submissions. It does not:

```
POST https://hgbinderworker.sorcererbiggz.workers.dev/auth/telegram
  -> 404 {"error":"Not found."}
```

The live Worker is still the old hand-pasted one. Merging to `main` would
have published a portal that refuses everybody. Resolved by the release
model change below rather than by changing the code.

### The release model changed

Owner's call: **`main` stays at the last complete release until every step
of the redesign is finished.** Steps go to the `accounts` branch.

**`main` is the last state worth serving, not the newest state that passed
its tests.**

One trap surfaced implementing it. The `deploy` job was gated by
`if: github.event_name != 'pull_request'` — which excludes pull requests
and nothing else, correct only while `main` was the single branch in the
`push` trigger list. Adding `accounts` there would have published a
half-built redesign on every push. The condition now names the branch that
releases.

**A branch that deploys because of what it is *not* is one trigger-list
edit away from deploying.**

Falls out of it: step 2 leaves the critical path and moves to the cutover,
alongside deploying the accounts Worker — both irreversible, both the same
moment.

### Full review of Codex's work, and a live gap it turned up (Claude)

All four Codex commits reviewed, posted as issue #18.

`check_web.py` check 5 exists to catch production pointing at development.
It did not. Swapping the production and development `publicKey` values
left the entire gate green — mutation-proven.

The endpoint half of that swap fails loudly. **The key half is silent and
unrecoverable**: production rows seal to a key the keyholder does not
hold, and nothing can turn plaintext back into ciphertext.

**The specification was at fault, not the implementation.** `REDESIGN.md`
asked for "no two arms share an endpoint or a public key"; Codex built all
four bullets correctly and every one is armed. But **two swapped arms are
still distinct**. `DESIGN.md` names that exact failure one paragraph
before prescribing the check that cannot catch it.

**The reusable lesson: a check computed entirely from the file it guards
cannot detect that the file's contents were rearranged.** When the
invariant is "this specific value belongs *here*", something outside the
file has to say so.

Fixed in `460ffef` — production's key and endpoint pinned as constants,
plus the reverse direction. Six mutations, both directions.

Also raised: empty commit message bodies on all four Codex commits; a dead
`scope` parameter on `checkedValue` alongside a `name="units"` collision
across pages; and an open question about who holds the development private
key.

### End of day — one record instead of two

Both agents independently wrote a changelog and a daily log for the same
day, in the same repository, neither aware of the other. Both were good
and both still had to be merged by hand. **Convergent instincts are not
coordination.**

Consolidated:

- `AGENTS.md` is now the single instructions file. `CODEX.md` and
  `CODEX_CHECKLIST.md` are deleted into it, and the superseded
  planner/implementer split is corrected there — it had never reached the
  repository.
- `CHANGELOG.md` and `DAILY_LOG.md` are one file each, written by both
  agents, with the ownership table in `AGENTS.md` naming what goes where.
- Two orphaned preview servers from 6:47 PM and 9:14 PM were found still
  listening on 8124, serving a branch checkout to anything asking for a
  local preview. Killed. `AGENTS.md` now requires shutting down your own
  servers before reporting done.
- `step-3-session-plumbing` was rewritten to `539e6ea`: the same tree,
  rebased onto `accounts`, with the reasoning moved out of the PR body
  into the commit message and the `check_web.py` docstring conflict
  resolved (both halves kept). Codex's three documentation commits were
  dropped from that branch **after** their four blobs were confirmed
  byte-identical to what had already been merged here — nothing was
  lost, and PR #17 is now purely the step 3 code slice.

### Open threads

**Blocked on the owner — the critical path:**

1. **BotFather.** `/newbot`, keep the username, then `/setdomain` →
   `potaetoe.github.io`. Telegram will not accept `localhost`, so the
   widget cannot be exercised anywhere else. **The only owner errand
   blocking forward progress.**
2. **A live `/auth/dev` mint**, to confirm a session reaches
   `submit.html`. Needs the owner-held `DEV_LOGIN_SECRET`; neither agent
   asks for or handles it.

**Moved to the cutover:** step 2 — clear `submissions`, unpublish the
snapshot, in one sitting with deploying the accounts Worker and merging
`accounts` into `main`. Rehearse on the development database first.

**Blocked on Codex:** the widget half of step 3, until the bot exists and
its real CSP violations can be observed. Plus the #18 findings.

**Not started:** steps 4–7, 9, 10, all downstream of step 3.

### Other projects

`Weight-Goal-Calculator`: one commit, `bef9fc0` — finding node when it is
installed but not on `PATH`.
