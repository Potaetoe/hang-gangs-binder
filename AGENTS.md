# Repository instructions for coding agents

**This is the only instructions file in this repository.** It replaces
`CODEX.md` and `CODEX_CHECKLIST.md`, both of which are deleted. If you are
about to create a second document describing how agents should work here,
edit this one instead — the duplication this file was consolidated out of
cost a day of divergent records, and the rule that prevents a repeat is
in "Where the record lives" below.

Two agents work on this repository: **Claude Opus 5** and **Codex Sol
5.6**. Everything here applies to both unless it names one.

Durable rules live in this file. Mutable facts — the active branch, who
holds which slice, deployment identifiers, current blockers — live in the
latest comment on the slice issue, never here.

---

## Authority and orientation

- Follow direct owner instructions first, then this file, then the
  accepted design documents, then the latest comment on the slice issue.
- Read the relevant sections of `DESIGN.md` and `REDESIGN.md` before
  changing code. `DESIGN.md` carries every architectural decision and its
  rejected alternatives; do not re-derive them and do not re-litigate them
  without a new reason.
- **Refer to work by build step, never by issue number.** They do not
  match and never will — GitHub numbers its own. Issue #9 is step 8. The
  issue title leads with its step and is authoritative.
- The owner sets the goal, approves material trade-offs, and is the final
  decision-maker. Neither agent deploys, handles a secret, or performs an
  irreversible operation without being asked.

## The split between the two agents

**By slice, not by phase.** Whoever takes a slice specs it, tests it and
builds it; the other reviews the diff and may block.

This corrects the original arrangement, in which Claude planned and Codex
implemented. That model was revised early and **the revision was never
written into this repository**, so it went on being followed from the only
document that stated it. That is the failure this file exists to stop: an
agreement that lives in a conversation is not an agreement the next
session can find.

The reason the phase split was wrong *here specifically*: this repository's
design facts have consistently come **out of** implementation — the
`polyline fill: none` rule, `connect-src` omitting `blob:`, `[hidden]`
losing to `display: flex`, the `tokenMatches` crash, and check 5's
blindness to a swapped `config.js` arm. A wall between planning and
building sits exactly where the information flows.

**The contract between agents is a failing test, not a paragraph.** Commit
the test first, implement to green. Where behavior cannot be known in
advance — the login widget's real CSP, quantization bin sizes — the rule is
**spike, then specify**: observe it, record the finding in a commit, then
pin it.

**Do not manufacture parallelism.** The accounts build order is mostly a
chain. On a chain the second agent's value is review, not throughput.

## Coordination

- **The `claude` and `codex` labels are the lock**, because both agents
  publish as the same GitHub account and an assignee cannot tell them
  apart. Claim a slice by applying your label before starting.
- Do not touch a file reserved by a slice carrying the other agent's
  label. Comment on the issue when you start and when you stop, naming the
  files held and what you are leaving undone.

### Claiming a slice, concretely

**The label says who. The claim comment says what — and the collision is
always at the file level, never at the issue level.** On 2026-08-06
issues #25 and #26 both changed `index.html`; nothing in this file
prevented that, and it was avoided only because Codex noticed and
ordered them by hand. Courtesy is not a lock.

**Read the board immediately before your first edit, not when you picked
the task.** A claim you read an hour ago is not current.

```
gh issue list --repo Potaetoe/hang-gangs-binder --state open \
  --json number,title,labels
gh pr list --repo Potaetoe/hang-gangs-binder --state open \
  --json number,title,headRefName,files
```

An open PR reserves its files just as a labelled issue does — arguably
harder, since the change already exists. To see what a branch actually
touches rather than what its handoff claims:

```
git diff --name-only origin/accounts...origin/<branch>
```

**Then post the claim before the first edit**, as an issue comment:

```
CLAIM claude — step 4
Branch:  claude/issue-5-submit-session
Base:    <full 40-char sha>
Files:   server/worker.js, dev/worker.test.mjs, apps/web/submit.js
Not:     tools/check_web.py (issue #26 holds it)
```

**Release it the same way** when the PR merges or you stop early:

```
RELEASE claude — step 4
Landed:  <sha or "nothing">
Left:    <what the next agent inherits, or "nothing">
```

then remove your label. **An issue whose PR has merged but whose label is
still on it reads as held**, which is the same failure as `Closes #N` not
firing — see below.

**If your file list overlaps something already claimed**, you have three
options and picking silently is not one: take a different slice; branch
from *their* branch rather than from `accounts`, saying so in the claim;
or ask them to release. Say which in the claim comment.

**A claim goes stale after roughly a day with no push to its branch.**
Take it over by commenting on the issue first, then swapping the label —
never by simply starting.

### When CI is backed up

GitHub Actions degraded for hours on 2026-08-06, first failing runs
before checkout and later creating runs it never started. That changes
what good coordination looks like, because **merges are what free a
file**:

- **A queued run is not a green run, and a merge on one is a merge on
  nothing.** Say "verified locally, CI pending" in the handoff and let
  the reviewer decide — do not quietly treat local green as sufficient.
- **Do not stack slices on files an unmerged branch already changes.**
  With merges blocked, the second slice inherits a rebase and the
  reviewer inherits a diff against a base that no longer means anything.
  Prefer a slice with a disjoint file list while the queue is stuck; the
  build order has usually got one.
- If nothing disjoint is left, branch from the unmerged branch and say so
  — an explicit dependency is fine, a silent one is what produces the
  conflict nobody expected.
- **Work in your own checkout.** Codex uses a separate clone; Claude uses
  the main working tree. Never check out a branch in the other agent's
  tree — an uncommitted edit sitting there while the other checks out
  produces a state neither intended and neither can attribute.
- Preserve unrelated changes in a dirty tree. Stage files explicitly;
  never `git add -A` over work you did not make.
- **Shut down your own preview servers before reporting done.** Two
  orphaned servers on port 8124 were left running on 2026-08-05 and
  silently served a branch checkout to anything that asked for a local
  preview. Use port 8124 unless a Worker origin policy is deliberately
  changed; another port fails CORS quietly.

## Where the record lives

Exactly one file for each of these. Before adding any top-level document,
check whether one of these already covers it.

| File | What belongs in it |
| --- | --- |
| `AGENTS.md` | this file — durable rules for both agents |
| `CHANGELOG.md` | product and repository changes, newest first, dated by commit date |
| `DAILY_LOG.md` | the working day — decisions, coordination, what is blocked on whom |
| `DESIGN.md` | architecture, decisions, and rejected alternatives |
| `REDESIGN.md` | the accounts scaffolding plan and build order |
| GitHub issue comments | current locks, blockers, live configuration, anything mutable |

Both agents write `CHANGELOG.md` and `DAILY_LOG.md`. Append to the
existing entry for the day rather than starting a parallel one; if both
agents worked, the day has one entry describing both.

**`Closes #N` does not close anything while `main` is frozen.** GitHub
auto-closes an issue only when the commit reaches the **default** branch,
and every slice merges to `accounts`. Write the reference anyway so the
issue and the commit are linked, then **close the issue by hand** with a
comment saying what landed and what is left. The suppression-floor slice
(#19) merged green and left its own issue open, which is how this was
found.

**This table exists because on 2026-08-05 both agents independently wrote
a changelog and a daily log for the same day, in the same repository,
neither aware of the other.** The work was good in both cases and it still
had to be merged by hand. Convergent instincts are not coordination.

## Commit messages carry the reasoning

**A commit message is a single subject line only when the change genuinely
needs no explanation.** That is rare here.

This is not a style preference. This project recovers facts from
`git log` — `entryFor`, the `polyline fill: none` rule, `connect-src`
omitting `blob:`, the `tokenMatches` crash that made a crashed suite read
as zero failures — and each is still known because somebody wrote *why*
into a commit rather than into a pull request thread or a chat.

A PR body is not in the repository. A reader six months out has `git log`.
Four commits landed in this repository with empty bodies, two of them live
in production, and their reasoning exists nowhere a future reader will
find it.

Write the why, what was rejected, and what was verified. If the PR body
says it, the commit message should say it.

## Code standards

Most of this is machine-checked, which is the point — a standard that
only exists in this file is one three agents can each read differently.
Run `python tools/check.py`; it is eleven checks now and two of them are
the linters.

| Concern | Where it is decided | Enforced by |
| --- | --- | --- |
| Line endings, charset, final newline | `.gitattributes`, `.editorconfig` | git, on commit |
| JavaScript style and correctness | `eslint.config.js` | `npx eslint .` |
| Python style and correctness | `pyproject.toml` | `python -m ruff check .` |
| What may be published | `tools/check_web.py` | the gate |

**A linter here is a gate, not a build.** `apps/web` is copied verbatim
to the published site; nothing rewrites a file, and a lint failure
refuses a release rather than producing one. That is why this does not
contradict `DESIGN.md`'s rejection of a bundler — read that section
before proposing tooling that *transforms* anything.

Setup, once: `npm install` (devDependencies only, `node_modules` is
ignored and never published) and `python -m pip install ruff`.

The conventions the linters cannot express:

- **The module shape means something.** `(function (root) { … })(globalThis)`
  is a file that assigns a global; `(function () { … })()` is a file that
  does not. Do not add an unused `root` parameter for symmetry — `nav.js`
  had one and it was removed.
- **Exported objects are frozen.** `BinderUI`, `BinderSession` and
  `BinderAuth` are `Object.freeze`d, so a page cannot quietly redefine a
  helper another page depends on.
- **The pure/DOM split is what makes the suites possible.** `crypto.js`,
  `form.js`, `admin.js`, `session.js` each export a pure half and wire the
  DOM after a `typeof document === "undefined"` guard, so a Node suite can
  load the shipped file's real bytes rather than a copy.
- **American spelling**, in prose, comments and our own identifiers.
  Platform names keep their own spelling — CSS is `color` because the
  property is `color`. Settled 2026-08-06 after the repository was found
  split mid-word.
- **Comments explain why, not what.** The reasoning in this repository is
  load-bearing and has repeatedly been the only record of a decision. A
  comment restating the line below it is worse than none.

## The review bar

Reviewing a slice means **attacking the threat the design names, not
checking the criterion the spec lists.**

Re-running the gate and reading the diff is not enough, and there is a
worked example. `check_web.py` check 5 exists to catch production
pointing at development. `REDESIGN.md` specified it as four bullets;
every bullet was implemented correctly and every one was confirmed armed
by mutation. The gate still passed with the production and development
public keys **exchanged** — because two swapped arms are still distinct,
and distinctness was the criterion. `DESIGN.md` named that exact failure
one paragraph before prescribing the check that could not catch it.

So a review asks two questions, and the second is the one that finds
things:

1. Does the code do what the spec said?
2. **Does the spec still cover the hazard the design document names?**
   Go and read the hazard in its own words, then try to produce it. If it
   can be produced while the gate stays green, the specification is wrong
   — and saying so is the review's job, not a nitpick outside it.

Corollary worth stating, because it decided the fix: **a check computed
entirely from the file it guards cannot detect that the file's contents
were rearranged.** When the invariant is "this specific value belongs
*here*", something outside the file has to say so.

A finding against the specification is not a finding against whoever
implemented it. Say which it is.

## Operational and security boundaries

- **A coding request does not authorize an adjacent act.** Code changes do
  not authorize deployments, secret changes, D1 mutations, or Wrangler
  commands. Those are owner operations unless the owner explicitly asks.
- **Never ask for, handle, or log a secret.** The export token, the
  private key, `DEV_LOGIN_SECRET`, `ACCOUNT_SECRET`, the Telegram bot
  token, and any Cloudflare API token stay with the owner. `admin.html`
  takes what it needs at runtime.
- **Distinguish source verification, local-browser verification, CI
  verification, and live verification in every handoff.** Never imply one
  proves another. Record a live check you could not perform as *not
  performed*; do not substitute a mock and call it live.
- **`apps/web/` is copied verbatim to the published site.** No test hooks,
  no fixtures, no development-only globals. There is deliberately no
  `?sample=` hook.
- **A push to `main` is a release.** While the accounts redesign is being
  built, work goes to the `accounts` branch and `main` stays at the last
  complete release. The deploy job names `refs/heads/main` and nothing
  else.
- **All six production Worker secrets are set** as of 2026-08-06:
  `EXPORT_TOKEN`, `TELEGRAM_BOT_TOKEN`, `ACCOUNT_SECRET`,
  `TELEGRAM_GROUP_CHAT_ID`, `ADMIN_TELEGRAM_IDS`,
  `ALWAYS_ALLOW_TELEGRAM_IDS` — **secrets, not `[vars]`**, because a
  `[vars]` block is committed and this repository is public. Do not write
  any of them into `wrangler.toml`. The dev Worker still has no
  `ACCOUNT_SECRET`; see the issue for why that is a guaranteed 500 rather
  than a missing nicety.
- **`wrangler secret put` cannot set them, and this is not an
  authentication problem.** Production's script was hand-pasted, which
  leaves the Worker in **version-upload state**, and `secret put` creates
  *and deploys* a version in one step. Cloudflare refuses that with
  `error 10220: Prod worker settings can not be deployed with a Version
  Upload`, for anyone, however they authenticate. **The dashboard is the
  tool** until cutover deploys from this repository — the same conclusion
  `ALLOWED_ORIGINS` reached. Secrets survive a later `wrangler deploy`,
  so they hold through cutover. Re-test the CLI after cutover rather than
  assuming it stays broken or assuming it heals.
- **Piping a value into `wrangler secret put` breaks its
  authentication.** A piped stdin makes wrangler consider itself
  non-interactive, and a non-interactive wrangler refuses the stored
  OAuth login and demands `CLOUDFLARE_API_TOKEN` — which nobody here may
  handle. A wrapper that feeds a secret on stdin is a dead end, not a bug
  to fix.
- **`npx --yes wrangler@latest` is not reproducible.** Two runs minutes
  apart resolved to 4.45.0 and 4.119.0 and failed differently. Pin the
  version in anything written down.

## Implementation invariants

- `apps/web/ui.js` is DOM-only. No `fetch`, no POST — network behavior
  stays in page-specific modules so the web checks can stay strict.
- Unknown hostnames **fail closed**. `config.js` gives an unrecognized
  host no endpoint and no key; a production fallback is the accident that
  arrangement exists to prevent.
- Session material lives in `sessionStorage`, never in persistent storage.
  Signing out must also clear the local prefill — it holds weight and
  height in the clear.
- Preserve `admin.html`'s break-glass export-token path unless an accepted
  design explicitly replaces it. Member-session gating belongs on
  submission paths.
- **Verify what renders, not what a property says.** `element.hidden`
  being true does not mean anything is hidden — `.card` and `.stack` set
  `display: flex`, which beats the browser's own `[hidden]` rule, and only
  `theme.css`'s `[hidden] { display: none !important }` makes it true. Use
  `getComputedStyle()` and `getClientRects()`.
- Color in generated SVG must come from classes in `theme.css`;
  `style-src` carries no `'unsafe-inline'`, so a `style` attribute is
  dropped. A `polyline` needs `fill: none` from an element+class rule —
  the `fill="none"` attribute loses to any CSS rule.
- Keep sign-in code free of Telegram widget URLs and crypto calls until
  the real widget's CSP behavior has been observed and its slice is
  unblocked.
- **Never regenerate a committed fixture to make a failing test pass.**
  `dev/fixture.json` and the account-id fixture stop matching only when
  the stored format changed, and every stored row went with it. The fix is
  a new version byte and a decoder for both. `dev/sample-submissions.json`
  is the opposite and may be regenerated freely.

## Verification

- Run `python tools/check.py` before any handoff. Report exact suite and
  assertion counts, not "tests pass".
- **When adding a suite, register it in both `tools/check.py` and
  `.github/workflows/deploy.yml`.** There are two suite lists and they
  have to be edited together. A locally green suite that CI never invokes
  is not complete — and a check that looks armed and is not buys
  confidence, which is worse than no check.
- **Confirm every new check is armed by mutation, in both directions.**
  Break it, watch it fail, restore it, watch it pass. State the mutations
  in the handoff.

  **Then keep going, because this is necessary and not sufficient.** A
  mutation is derived from the check, so it can only ever ask "does this
  check enforce what it says?" — never "is this the right thing to
  enforce?" Check 5's four bullets were each implemented correctly and
  each confirmed armed, and the gate still passed with the production and
  development keys exchanged. Nine mutations passed on the suppression
  floor while the two unit systems were still publishing a partition a
  reader could difference.

  Mutation proves the check works. **The review bar below proves it is
  the right check.** When the two seem to disagree, the review bar wins —
  it is the one that has caught things.
- Exercise affected pages in a real browser, including computed
  visibility.
- A local preview serves stale JS — `python -m http.server` sends no
  `Cache-Control`. Confirm with `fetch(url, { cache: "reload" })` before
  concluding a change did not land.
- **Check that a CI run *exists* for the head commit, not merely that no
  run failed.** A red run appears in every listing; a commit with no run
  appears in none, so `gh run list` shows an unbroken column of green and
  the unverified commit is simply absent. Absence reads as success.

  ```
  gh api "repos/OWNER/REPO/actions/runs?head_sha=<FULL 40-CHAR SHA>"
  ```

  **`head_sha` requires the full 40-character SHA. An abbreviated one
  returns `total_count: 0` — the same answer as a commit that genuinely
  never ran.** That is a silent false negative on the exact check meant
  to catch silent failures, and on 2026-08-06 it produced a confident,
  wrong report of a dropped run. `git rev-parse HEAD`, never the short
  form off a log line.

- **During an incident, run *creation* lags — a run that is absent now
  may appear minutes later.** The same day, a push to `accounts` had no
  run for several minutes and then had one. "Not created yet" and "never
  created" look identical at the moment you look, and only the second is
  a problem. Re-check before concluding, and prefer waiting to
  dispatching.

- **`workflow_dispatch` on `main` deploys.** The deploy job's condition is
  `github.event_name != 'pull_request' && github.ref ==
  'refs/heads/main'`, and a manual dispatch satisfies both. On `accounts`
  a dispatch is harmless; on `main` it is a release. Never reach for it
  as a routine "just re-trigger the checks" move.

- **Do not call an intermittent outage over on one success.** That
  incident produced four failures and one pass inside half an hour, and
  the pass was read as recovery. It was not.

## The slice checklist

**Start**

- [ ] Read this file, the relevant design sections, and the latest issue comment.
- [ ] Confirm the build step, base commit, deliverables, exclusions, and reserved files.
- [ ] **Read the board now, not when you picked the task** — open issues
      with labels, *and* open PRs with their real file lists. See
      "Claiming a slice, concretely".
- [ ] Confirm the issue does not carry the other agent's label, and that
      **no open PR or labelled issue names a file on your list**. If one
      does, say which of the three options you took.
- [ ] **Post the `CLAIM` comment and add your label before the first
      edit.** Not after the branch, not with the PR.
- [ ] Branch from the commit the issue names, in your own checkout.
- [ ] Check `git status` and preserve unrelated work.

**Implement**

- [ ] Stay inside the claimed slice and its file boundary.
- [ ] Add regression coverage for new behavior, and mutation coverage for anything security-sensitive or quiet-failing.
- [ ] Register any new suite in both the local gate and CI.
- [ ] Update `CHANGELOG.md` and `DAILY_LOG.md` — appending to the day's existing entry, not starting a new one.

**Verify**

- [ ] `python tools/check.py` — all eleven, with exact totals captured.
      The linters are checks 2 and 3; a new file has never been linted
      before it lands, so run the gate on the *merge result*, not only on
      the branch.
- [ ] `git diff --check`, and read the whole diff.
- [ ] Exercise every affected page in a browser, checking computed visibility.
- [ ] Separate source, local, CI and live results. Name any live check not performed.
- [ ] Reviewing? Re-read the hazard the design names and try to produce
      it, rather than re-running the criterion the spec lists.

**Publish**

- [ ] Stage only the intended files; write a commit message that carries the reasoning.
- [ ] Open or update a draft PR using the handoff format below.
- [ ] Wait for GitHub Actions and inspect the uploaded files on the remote branch.
      **Confirm a run exists for the full head SHA** — see Verification —
      and treat `queued` as pending, never as passing.
- [ ] Stop comment on the issue: PR, checks, exclusions, next action.
- [ ] **Post the `RELEASE` comment and remove your label** once it merges
      or once you stop. A label left on a merged slice reads as held.
- [ ] Shut down any preview server you started, and confirm the port is free.

## Handoff format

```text
Build step / issue:
Branch / base / remote head:
Files changed:
Behavior delivered:
Source and local checks:
CI checks:
Live checks (and any not performed):
Mutations run, and what each proved:
Deviations or exclusions:
Current blockers:
Next action:
```

## When to stop and ask

Stop and return to the owner rather than deciding alone when:

- the plan and the code disagree in a way that changes the design;
- a change would alter a privacy claim, a security boundary, or what is
  published;
- the work would need a secret, a deployment, or anything irreversible;
- a check cannot be made to fail, and you are about to ship it anyway.

Neither agent is an independent source of truth, and neither retains
reliable memory outside the durable artifacts listed above. That is what
this file is for.

## Fixing production while `main` is frozen

The full procedure is in `README.md`, on **`main`** as well as here — it
lives there because `main` is what somebody has checked out when the site
is broken, and this file may not exist on the branch they are standing on.

Rehearsed once on 2026-08-06 rather than left as a plan: the procedure
was delivered by the procedure it describes, verified not to change
`apps/web`, merged through a pull request, and confirmed live. Every
irreversible thing here has a rehearsal rule and this had none.

Two things agents get wrong about it:

- **The smallest change that fixes the thing**, not the correct one and
  not the tidy one. `git diff --stat origin/main -- apps/web` before
  merging should be short enough to read.
- **Step 5 — cherry-pick forward to `accounts` — is the step that gets
  skipped**, and its failure is silent. A fix that lands on `main` and
  never reaches `accounts` disappears the day the redesign merges, while
  every check passes and `accounts` overwrites it with older code.

**Owner present.** A hotfix is a live release, the same category as
clearing the table or deploying the Worker.
