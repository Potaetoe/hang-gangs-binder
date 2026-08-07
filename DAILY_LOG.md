# Daily log

The working record for this repository, newest first — decisions,
coordination, and what is left blocked on whom. What *changed in the
product* belongs in `CHANGELOG.md`; this file is for the day itself.

**One entry per day, written by both agents.** If Claude and Codex both
worked, the day has one entry describing both — append to it rather than
starting a parallel one. See `AGENTS.md`, "Where the record lives".

Starts 2026-08-05.

---

## 2026-08-07

**Landed on `accounts`:** the MCP-delegation rules in `AGENTS.md`. `main`
untouched. Step 3b is still open on #26 and PR #32 still holds
`index.html`, `auth.js` and `check_web.py`. Step 4 is open on a branch,
built by Codex as an MCP tool and published by Claude — the first slice
run under that arrangement.

### Step 4, and the first delegation under the new rules

Codex wrote it in its clone; Claude posted the claim, reviewed, ran the
gate and the browser check, and pushed. Two rounds, and the review found
something in each.

**The first round's contract had a hole of exactly the shape the review
bar describes.** Two checks pinned the new three-argument `buildRecord`
while every pre-existing check still called it with two, so an
implementation making the third argument optional — falling back to
`input.telegram` when absent — would have satisfied every new criterion
and every old one and handed the typed handle straight back into the
record, gate green. That is check 5's failure again: each bullet correct,
each armed, the hazard untouched. A third check now requires the throw,
and thirteen call sites were updated to pass a session username. Twelve
were unaffected in meaning; "the handle is stored normalized" genuinely
depended on `input.telegram` reaching the record and now makes the same
claim about the session argument.

**The second round stopped at a file boundary, correctly.**
`dev/admin.test.mjs` calls `buildRecord` as a pipeline check and was
outside the claimed file list. The list was wrong, not the slice — the
claim was amended on the issue rather than the boundary crossed.

### Two operational findings about Codex-as-MCP

**Codex cannot run `tools/check.py`.** The sandbox refused to execute a
Python interpreter outside the workspace — `Access is denied`, from the
restricted token, not a missing install. Node and eslint run fine. So a
Codex report of "suites green" covers the Node suites and the linters
and never checks 1 or 3, and **running the gate is Claude's job** under
this arrangement. Working around it would be defeating a boundary, not
fixing a fault.

**The clone had no `node_modules` at all**, so checks 2 and 3 had never
run there. Installed with `--ignore-scripts`, per the reasoning in #20.

### Codex as an MCP tool, and who pushes

Codex now also runs as an MCP server that Claude drives, in its own clone,
under `workspace-write` with the network blocked. The owner chose, from
four options, that **Claude publishes what that Codex writes** — reading
the whole diff first and setting `--author` to Codex. The rejected ones
are worth recording: the owner pushing by hand puts them in the loop on
trivial commits, and routing through the standalone Codex's GitHub
connector means hand-carrying diffs between two Codexes that cannot see
each other's working tree.

The rule that keeps this honest is that **publishing a slice does not
transfer it.** The label is still the lock and still says Codex; only the
hands on `git push` moved.

### The Codex clone had drifted, silently

Found before any delegation: the clone was checked out on
`step-3-session-plumbing`, tracking `origin/main`, four commits ahead of a
branch that no longer exists on the remote. Two of those four had already
landed as squashes under different SHAs (#16, #17). Its working tree was
clean the whole time.

**A clone that cannot fetch drifts without a symptom.** `git status`
reports nothing to commit while the branch underneath it has been deleted
upstream. Nothing was rebased or discarded — the old branch ref is left
where it was, and a new `accounts` tracking `origin/accounts` was checked
out beside it. Re-syncing before *every* delegation is now the rule rather
than a thing to remember.

### A correction worth carrying

`DESIGN.md`'s accounts build order still marks only steps 1 and 8. It does
not record step 2's unpublish or step 3's session half, both of which
landed on 2026-08-06. `REDESIGN.md`'s status table and the issue comments
are current and agree with each other. Not fixed here — flagged, because
the next agent to read the build order for status will be reading the
stale copy.

---

## 2026-08-06

**Landed on `accounts`:** step 3's session half merged, repo-wide code
standards, and the suppression floor. `main` untouched at `b6a984f`
throughout; every CI run shows `deploy: skipped`.

Claude and Codex. Codex resumed with the two deliberately ordered slices
that both touch the sign-in page; issue #25 goes first so issue #26 starts
from settled navigation.

### Standards, decided and built

The owner chose external linters, a full retrofit, American spelling,
and a review bar of *attack the named threat*. Three of the four went
against my recommendation and the fourth was mine.

- **ESLint and Ruff**, registered in *both* suite lists. A linter is a
  gate, not a build — `apps/web` still ships verbatim, nothing is
  rewritten, formatting is never automatic. `DESIGN.md`'s no-bundler
  paragraph is amended rather than contradicted, and the test for future
  tooling is written down: **does it change what ships, or refuse to
  ship?**
- Ruff immediately found a **loop-variable closure** in
  `check_web.py`'s config parser. It read correctly only while called in
  the same iteration; stored and called later it would report the last
  arm's values for every arm — a config check passing while describing
  the wrong environment.
- **`.gitattributes`** — and a correction: the repo was never broken.
  `core.autocrlf=true` is one machine's setting and git storage was
  uniformly LF all along. The exposure was that nothing in the repo said
  what the answer should be, so it was whoever committed last.
- **American spelling**, 114 replacements. Four were identifiers and one
  crossed a file boundary: `normaliseTelegram` is an exported API.

### The adversarial review

Attacked the whole project on request. Seven findings, all filed as
slices (#20–#26), and the sharpest ones were against **my own decisions
from the same day**: 87 npm packages added to a repo that documented a
rejection of third-party code, and a frozen `main` with no hotfix path.

### The suppression floor — #19, merged as `265dfbe`

The finding that mattered. A published snapshot of a plausible
24-person group said *"exactly one member is in Japan"* and *"exactly
one member is nonbinary"*, and `ROLE_VOCABULARY` is
feeder/feedee/gainer/admirer, so a singleton published a named person's
kink role to the open web.

**The reasoning it replaced was nearly right**, which is why it lasted:
rows are dangerous, aggregates are safe. True for large N. **At
twenty-four an aggregate of one is a row.** Worse, the quantisation work
had closed a real join key and left confidence *higher* than before.

`MIN_CELL = 5`, with three properties that each took a mistake to find:

- **Subtraction is the attack, not redaction.** Published cells still
  sum to the group, so nothing is recoverable by arithmetic.
- **Histograms merge rather than bucket**, so shape and total survive.
- **One partition, not two.** Found by attacking the hazard rather than
  confirming the rule, and the same shape as the check 5 gap: the two
  unit systems bin different fields at different widths, so both could
  satisfy the floor while an overlay recovered a finer partition.
  Differencing cumulative counts produced sub-floor cells in **2899 of
  3000** random groups.

**My first fix for that was worse than the bug** — it took each
system's edges from the min and max actually in the group, fitting the
edge to a real person's weight. Edges are converted, never re-derived.

**A false alarm worth keeping:** my initial intersection test measured
against the raw values, which an attacker does not have. An attack must
run against the published document alone or it measures the wrong thing.

Also caught: `render()` dereferences the basis immediately, so a
suppressed `null` basis would have **white-screened the public page**.

Nine mutations. One survived the first pass — BMI bins — because the
check named the bin sets I thought of rather than gathering them all.

### Learned about the tooling

**`Closes #N` does not fire while `main` is frozen.** GitHub auto-closes
only on the default branch. #19 merged green and left its issue open.
Now in `AGENTS.md`; every slice needs closing by hand until cutover.

### The suppression floor shipped and the exposure stayed up

Found while probing production to write the cutover procedure, hours
after #19 was closed as fixed: `GET /snapshot` was still serving the
snapshot published 2026-08-05T17:24, unauthenticated, describing
**exactly one person** — gender, both roles, a 65–70 weight bin. The
thing #19 is about, live, on the day it was fixed.

**Neither half of the fix could have reached it.** The floor runs in the
code that *assembles* a snapshot; the published artifact is an assembled
row in the `snapshots` table, and nothing re-evaluates it. And the floor
is on `accounts`, undeployed, so even rebuilding would not have applied
it.

**The plan had no one going back for it either.** Unpublishing belongs
to step 2, and step 2 had moved to the cutover — so the live object was
scheduled for retraction at the *end* of the redesign, on an unstated
assumption that it was harmless meanwhile. At n=1 it was not.

Taken down with `DELETE FROM snapshots WHERE id = 1` against
`hg_binder_db`, verified at the endpoint. `submissions` untouched at 1
row, so the snapshot is rebuildable from `admin.html` — nothing lost.
Step 2 is now only the clear.

**Carry forward: a fix that prevents producing a bad artifact does not
retract the ones already produced.** When a privacy fix lands against a
publisher, ask separately what is published *right now*. The code
review answers "will this happen again", not "is it happening".

Second-order, and the reason it went unnoticed for a day: this project
verifies deployments with unauthenticated probes designed to tell
failure modes apart, and a *successful* `GET /snapshot` reads as healthy.
Nothing looks at what the success contains.

### The sign-in route and honest UI contract — #25 (Codex)

Started from the current `accounts` tree after reading the consolidated
instructions and the issue handoff. `BinderUI.checkedValue` accepted a
third `scope` argument that no product caller passed, so the apparent
collision protection was inert. The parameter is removed rather than
wiring three additional caller files outside the slice; the global lookup
is now the visible, test-pinned choice.

All five static navigation blocks gain an explicit route to `index.html`.
The old navigation check only compared the blocks, so five identical
omissions passed. Its contract now requires the sign-in route itself — the
hazard is a signed-out visitor stranded away from the only page that can
mint a session, not merely markup drift.

The two contracts were committed before the implementation. Against the
base, the UI suite failed the arity assertion and the publishability check
reported all five missing routes; both passed after the product change.

### Open threads

**BotFather is done** — bot created, `/setdomain` → `potaetoe.github.io`
returned success. That was the only owner errand blocking the build
order, and it is now clear. #26 unblocked and labeled `codex`, behind
#25 because both touch `index.html`.

Remaining owner items are not blocking: #29 (key fingerprint in the
group description) and the live `/auth/dev` mint.

Claude is writing the cutover procedure into `REDESIGN.md` — the sitting
is now four irreversible acts, not the two Part 8 describes, and Part
10's Worker rollback names a commit that production does not match.

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
quantization, which landed the same day.

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
  Commit the test first, implement to green. Where behavior cannot be
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
  moving network behavior into `ui.js`; `dev/ui.test.mjs` pins that as an
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

### Later the same day — configuration, and two CI findings

Claude. Issue #25 reviewed and merged (rebase, so the test-first commit
survives as its own commit); #26 reviewed and **blocked**; the Worker's
configuration finished with the owner.

**All six production Worker secrets are now set** — `EXPORT_TOKEN`,
`TELEGRAM_BOT_TOKEN`, `ACCOUNT_SECRET`, `TELEGRAM_GROUP_CHAT_ID`,
`ADMIN_TELEGRAM_IDS`, `ALWAYS_ALLOW_TELEGRAM_IDS`, all as secrets. The
group is a supergroup, so its `-100…` id is stable and will not shift
under a basic-group upgrade.

**Issue #30's prescribed fix does not work**, which is the finding rather
than the chore. `wrangler secret put --name hgbinderworker` fails with
`error 10220, Prod worker settings can not be deployed with a Version
Upload`: production's script was hand-pasted, `secret put` creates *and
deploys* a version in one step, and Cloudflare refuses the combination —
for anyone, however they authenticate. The dashboard is the tool until
cutover. `AGENTS.md` carries this, along with the two smaller traps: a
piped stdin makes wrangler non-interactive and it then demands
`CLOUDFLARE_API_TOKEN`, and `wrangler@latest` resolved to two different
versions minutes apart that failed differently.

**The widget's CSP needed a third exception, and the owner confirmed
it.** `'unsafe-eval'`, because Telegram's script puts `data-onauth`
through `__parseFunction`. Redirect mode avoids eval and was rejected:
it returns the signed payload in a URL query string, putting the numeric
id and handle into browser history, `Referer` headers and host access
logs on every sign-in — the membership oracle the account-id design
exists to prevent, relocated into a log. `DESIGN.md` `ef8c17c` carries
the reasoning and one correction: the sign-in page is **not** a page with
nothing to steal, because after sign-in it holds the session.

**#26 is blocked on one item.** Check 12 skips `index.html`, so it
enforces that the exception does not spread and not that it stays narrow
— and narrowness is the only reason the exception is acceptable.
Rewriting that page's policy with `'unsafe-inline'` and an arbitrary
third-party origin left all eleven stages green.

**A CI incident, and a wrong diagnosis of it worth more than the
incident.** A GitHub Actions incident failed five runs in `Set up job`
before checkout; none of it reached the code, and `ffd48b2` was never
broken. It was intermittent rather than a window, and one success was
misread as recovery.

Then a push to `accounts` appeared to have produced no run at all, and I
reported that GitHub had dropped it. **That was wrong twice over.**
`?head_sha=` was queried with a *seven-character* SHA, and the API
answers `total_count: 0` for an abbreviated SHA exactly as it does for a
commit that never ran — a silent false negative on the check written to
catch silent failures. The full SHA showed two runs. And run *creation*
was lagging during the incident: the push run did exist, queued, minutes
later. "Not created yet" and "never created" are indistinguishable at the
moment of looking, and only one of them is a problem.

The `workflow_dispatch` I fired to "fix" it was harmless on `accounts`
and would not have been on `main` — a manual dispatch satisfies the
deploy job's condition and releases the site. `AGENTS.md` now carries all
three: the full-SHA requirement, the creation lag, and the dispatch
hazard.

### Open threads

**Blocked on the owner:**

1. **The dev Worker has no `ACCOUNT_SECRET`** (#33). `handleDevAuth`
   HMACs with it, so every development sign-in 500s at the last line of
   the handler, after both guards have passed. One command, a fresh value
   that is never production's.
2. **Publish the production key fingerprint out-of-band** (#29).
3. **A live `/auth/dev` mint**, to confirm a session reaches
   `submit.html`. Needs the owner-held `DEV_LOGIN_SECRET`; neither agent
   asks for or handles it.

**Done, and previously listed here as the critical path: BotFather.** The
bot is `@hanggangbinder_bot` and `/setdomain` → `potaetoe.github.io`
succeeded. No owner errand blocks forward progress now.

**Moved to the cutover:** step 2 — clear `submissions`, unpublish the
snapshot, in one sitting with deploying the accounts Worker and merging
`accounts` into `main`. Rehearse on the development database first. Plus
the widget's real render and callback, which BotFather's host binding
makes unprovable from localhost.

**Blocked on Codex:** the check 12 pin on #26, and `wrangler.toml`'s
comment block on #30 — it still calls the three id secrets plaintext
vars, which is the sentence that would talk the next person into
re-creating the defect. Plus the #18 findings.

**Not started:** steps 4–7, 9, 10.

### Other projects

`Weight-Goal-Calculator`: one commit, `bef9fc0` — finding node when it is
installed but not on `PATH`.
