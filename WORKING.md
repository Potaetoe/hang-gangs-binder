# Working — how this project is built

This file and DESIGN.md are the only things that govern development.
DESIGN.md says what we build; this file says how. Everything older is
history, kept in git.

**The standing rule:** any change to how we work is written into this
file in the same commit as the change itself, so the truth has one
home. Changes to the core sections (the contract, done, security, the
fleet) need the owner's OK first. Claude may amend housekeeping
details and flags them in the next report.

## The contract

1. The owner hands Claude a feature.
2. Claude builds it, asking up front where behavior is undecided and
   deciding small design details itself.
3. The owner test-drives it on the deployed site.
4. Claude fixes what the owner points at, until the owner is satisfied.
5. Merge happens after the owner's OK, not before.

One session works the repo at a time. Work happens on feature
branches; the default branch moves only by this loop.

## What "done" means

- Claude personally drove the feature in a real browser on the
  deployed site, as a member and as an admin, and it worked.
- Driving means looking closely: zooming in, reading every rendered
  detail as a member would. The user experience is the product, so a
  control that renders wrong is broken even when its code path passes.
- The feature's loop has a Playwright test that walks it the way a
  person does (for example: an admin adds a field, and the member form
  shows it).
- TypeScript strict passes. CI is green.
- The report to the owner is a blunt list: works / broken / untested.
  Nothing an agent or a test claims is reported as seen unless Claude
  saw it.

## The fleet

Agents exist to finish faster, never for their own sake. Claude builds
by default; an agent is a tool pointed at a job it is structurally good
at, briefed with these two files plus the task.

| Job                                                           | Who            |
| ------------------------------------------------------------- | -------------- |
| The overarching process, product judgment, anything unbounded | Claude (Fable) |
| Complex but well-bounded analysis, adversarial security work  | Opus           |
| Specific bounded coding where tests and types define success  | Sonnet         |
| Web lookup and doc reading                                    | Haiku          |

- Work that needs eyes (visual judgment, product feel) is never
  delegated. Agents cannot see rendered pages.
- Delegated coding needs a machine-checkable "done" and files disjoint
  from anything else in flight.
- At most one helper builds alongside Claude, and only on an obvious
  fork of the plan.
- Research that is really a judgment call goes up a tier or stays with
  Claude. Haiku looks things up; it does not decide.
- Agents that edit code run in isolated worktrees.
- No agent's claim reaches the owner unverified. Agents produce diffs
  and reports; Claude drives the result before it counts.

## Security

Before launch, the app gets a **defensive code review**: a first-party
read of our own source for security defects, so we find and fix our
own weaknesses before the group arrives. It is quality assurance on
code we own and operate, the same class of pass as the linter or the
test suite.

- Claude reviews `src/lib/server/`, `src/hooks.server.ts` and the
  routes against current published guidance, looked up fresh rather
  than recalled: the OWASP Top 10 and cheat sheets, plus any standard
  the owner names.
- Focus areas: authentication and sessions, authorization on every
  admin path, input parsing, the sealed-identity encryption, and the
  privacy promises DESIGN.md makes.
- Findings are ranked by severity, the ones that matter get fixed, and
  the owner gets the blunt report. What is deliberately accepted is
  written down as accepted, with its reason.

The first pass is recorded in
[docs/SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md).

Day to day, security-sensitive code (hashing, sessions, the sealed
directory) gets Claude's most careful work and honest flagging of
anything uncertain, not ceremony.

## Code layout

- Server code lives in feature modules under `src/lib/server/` (auth,
  identity, fields, entries, charts, events, socials, admin, settings,
  with shared db, crypto, days and units). Each folder's `index.ts` is
  its front door; routes import from there, never from a module's
  insides.
- Routes are grouped by who may reach them: `(public)` and `(member)`,
  with `admin/` inside `(member)`. The access check lives once, in
  `src/hooks.server.ts`, and covers pages, form actions and endpoints
  alike. Routes outside both groups guard themselves.
- Comments say why, not what, and never tell history. Dates, rulings
  and old versions belong in git and in these two files.
- One deployment is one Worker and one D1 database. Splitting into
  several Workers is not on the table while one group runs one site.

## Enforcement — the hooks

Every policy above that a machine can check, a machine checks. Hooks
live in the repo (versioned, visible) and are wired through the project
settings. Each hook denies with a remedy in its message; a denial means
follow the remedy, never work around it. One selftest command fires
every rule both ways (a deny case and a pass case) and runs in CI.

1. **session-open**: at session start, surfaces DESIGN.md and
   WORKING.md, the current feature and its state, and warns loudly if
   another session appears to be working the repo.
2. **merge-gate**: blocks merging or pushing to the default branch
   unless the owner's sign-off for that branch is recorded. The owner's
   OK is written to a sign-off record when given; no record, no merge.
   GitHub branch protection also requires CI green, so even a hook
   failure cannot slip a change through.
3. **deploy-gate**: blocks `wrangler deploy` while the newest
   migration file is not recorded as applied (the schema goes first),
   and refuses any bundle that still contains the `/test/*` hooks. A
   plain production build erases them; they exist only in `vite dev`
   and in builds run with `TEST_HOOKS=1`, which is how the e2e suite
   gets them. The bundle rule and the migration-guard's pragma scan
   also re-fire in the release pipeline (hooks/ci_gate.py), because
   GitHub's runner has no hooks. The migrations-applied record stays
   local: the pipeline applies migrations itself before every deploy,
   so the record guards only the break-glass path.
4. **git-guard**: blocks force-pushes to the default branch, pushes to
   the frozen old branches, and `--no-verify`. Commit messages and gh
   bodies travel by file (`git commit -F <file>`, `--body-file
<file>`), never inline, because this machine's PowerShell rebuilds
   native arguments naively and any quote or newline turns into
   garbage. A sign-off recording never shares a command with the merge
   it unlocks: the merge-gate reads its state before the command runs,
   and PowerShell has no `&&` to make the pair atomic. Record first,
   then merge as its own command (an `&&` chain from the Bash tool is
   honored).
5. **secret-guard**: blocks writing secret-shaped values (bot tokens,
   `*_SECRET=` literals) into repo files. Remedy: `wrangler secret put`.
6. **fleet-guard**: holds agent dispatches to the fleet rules. An
   agent that edits code must run in an isolated worktree with a
   machine-checkable "done"; Haiku is never given edit work; no agent
   is asked to push or merge.
7. **report-reminder**: injects the standing rules (plain speech; done
   means driven; reports are works / broken / untested) at each
   prompt, so they survive any session's context.
8. **migration-guard**: blocks a remote `d1 migrations apply` while any
   migration file leans on a pragma that behaves differently in
   production: `PRAGMA foreign_keys` (remote D1 refuses it) or
   `defer_foreign_keys` (remote D1 commits statement by statement, so
   the deferral does nothing). The remedy is a parent-first rebuild
   that satisfies every foreign key at every statement boundary. Local
   applies stay unguarded on purpose; they are the test bench.

The rules a regex cannot hold (blunt reporting, the same-commit rule,
never repeating an unverified claim) are enforced by the contract and
the owner's eyes, not by hooks. The hooks cover everything mechanical,
and the selftest proves each one fires.

## Ops runbook

The operator's full book is [docs/RUNBOOK.md](docs/RUNBOOK.md). The
rules:

- **Deploy:** the pipeline deploys, not the laptop. Merging to main
  runs the deploy job in `.github/workflows/ci.yml`: rebuild, re-fire
  the deploy-gate and migration-guard rules, apply pending D1
  migrations (schema first), `wrangler deploy`, then a smoke check of
  the live URL. A manual `wrangler deploy` is break-glass only, for
  when GitHub or the pipeline is down, and the local hooks still gate
  it.
- **Releases:** every PR uploads a preview version at a stable URL
  (`<branch>-hang-gangs-binder.sorcererbiggz.workers.dev`), posted as
  a PR comment. Previews sit behind Cloudflare Access (the owner's
  email, one-time PIN); production stays public. Test-drives happen on
  the preview; production moves only by the merge, after sign-off. A
  preview shares production's database, so a PR carrying migrations
  gets a loud warning in its preview comment, and its schema-needing
  routes wait for the merge. The Telegram door never works on
  previews: BotFather links the widget to exactly one hostname, the
  production one. Preview drives use the password door; the Telegram
  door gets its drive on production after merge. Rollback is
  `npx wrangler rollback`, code only. Migrations never roll back, so
  every migration must leave the previous code able to run.
- **Secrets:** six of them: the bot token, the bot username, the group
  chat ID, the admin allow-list of Telegram IDs (how a fork's first
  admin is made), the identity-scramble secret, and the directory-seal
  secret. Set via `wrangler secret put`, never in files. Sessions need
  no secret; they are random tokens stored hashed. Losing the
  directory-seal secret makes every stored identity permanently
  unreadable: the stats survive, the names do not. The pipeline holds
  a seventh, `CLOUDFLARE_API_TOKEN` (Workers Scripts edit + D1 edit),
  in GitHub's secret store, set by the owner, never in a file.
- **Database:** D1, with schema changes only through migration files
  applied with `wrangler d1 migrations apply`, before the code that
  needs them. Code running ahead of its schema fails outright, with a
  crash line naming the missing table or column; it never half-works.
- **Crash lines:** when a page dies unexpectedly, the route and error
  text land in Workers Logs (dashboard → the worker → Logs). That is
  the only thing ever logged. Invocation logs are off (wrangler.jsonc)
  because they would store URLs. Locally, `/test/boom` fires the path
  on demand.
- **Take-down:** delete the worker. The database survives unless the
  owner orders otherwise.
