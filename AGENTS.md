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
the test first, implement to green. Where behaviour cannot be known in
advance — the login widget's real CSP, quantisation bin sizes — the rule is
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

## Implementation invariants

- `apps/web/ui.js` is DOM-only. No `fetch`, no POST — network behaviour
  stays in page-specific modules so the web checks can stay strict.
- Unknown hostnames **fail closed**. `config.js` gives an unrecognised
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
- Colour in generated SVG must come from classes in `theme.css`;
  `style-src` carries no `'unsafe-inline'`, so a `style` attribute is
  dropped. A `polyline` needs `fill: none` from an element+class rule —
  the `fill="none"` attribute loses to any CSS rule.
- Keep sign-in code free of Telegram widget URLs and crypto calls until
  the real widget's CSP behaviour has been observed and its slice is
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
- Exercise affected pages in a real browser, including computed
  visibility.
- A local preview serves stale JS — `python -m http.server` sends no
  `Cache-Control`. Confirm with `fetch(url, { cache: "reload" })` before
  concluding a change did not land.

## The slice checklist

**Start**

- [ ] Read this file, the relevant design sections, and the latest issue comment.
- [ ] Confirm the build step, base commit, deliverables, exclusions, and reserved files.
- [ ] Confirm the issue does not carry the other agent's label; add yours and a start comment.
- [ ] Branch from the commit the issue names, in your own checkout.
- [ ] Check `git status` and preserve unrelated work.

**Implement**

- [ ] Stay inside the claimed slice and its file boundary.
- [ ] Add regression coverage for new behaviour, and mutation coverage for anything security-sensitive or quiet-failing.
- [ ] Register any new suite in both the local gate and CI.
- [ ] Update `CHANGELOG.md` and `DAILY_LOG.md` — appending to the day's existing entry, not starting a new one.

**Verify**

- [ ] `python tools/check.py`, with exact totals captured.
- [ ] `git diff --check`, and read the whole diff.
- [ ] Exercise every affected page in a browser, checking computed visibility.
- [ ] Separate source, local, CI and live results. Name any live check not performed.

**Publish**

- [ ] Stage only the intended files; write a commit message that carries the reasoning.
- [ ] Open or update a draft PR using the handoff format below.
- [ ] Wait for GitHub Actions and inspect the uploaded files on the remote branch.
- [ ] Stop comment on the issue: PR, checks, exclusions, next action.
- [ ] Shut down any preview server you started, and confirm the port is free.

## Handoff format

```text
Build step / issue:
Branch / base / remote head:
Files changed:
Behaviour delivered:
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
