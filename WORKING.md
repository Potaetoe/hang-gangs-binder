# Working — how this project is built

Written 2026-08-24 by the owner and Claude. This file and DESIGN.md are
the only things that govern development. Everything older is history.

**The standing rule:** any change to how we work is written into this
file in the same commit as the change itself. Truth has one home.
Changes to the core sections (the contract, done, security, the fleet
rules) need the owner's OK first. Housekeeping details Claude may amend,
flagged in the next report.

## The contract

1. The owner hands Claude a feature.
2. Claude implements it — asking up front where behavior is undecided,
   deciding small design details itself.
3. The owner test-drives it on the deployed site.
4. Claude fixes what the owner points at, until the owner is satisfied.
5. Merge happens after the owner's OK, not before.

One session works the repo at a time. Feature branches; the default
branch only moves by the loop above.

## What "done" means

- Claude personally drove the feature in a real browser on the deployed
  site, as a member and as an admin, and it worked.
- Driving means looking closely - zooming in on the details, reading
  every rendered pixel as a member would. The user experience IS the
  product (owner ruling 2026-08-24); a control that renders wrong is
  broken even when the code path passes.
- The feature's loop has a Playwright test that walks it the way a
  person does (example: admin adds a field, the member form shows it).
- TypeScript strict passes. CI is green.
- The report to the owner is a blunt list: works / broken / untested.
  Nothing an agent or a test claims is reported as seen unless Claude
  saw it.

## The fleet

The point of the fleet is to finish faster, not to do it for no reason.
Claude builds by default; agents are tools pointed at jobs they are
structurally good at, briefed by these two files plus the task itself.

| Job                                                           | Who            |
| ------------------------------------------------------------- | -------------- |
| The overarching process, product judgment, anything unbounded | Claude (Fable) |
| Complex but well-bounded analysis, adversarial security work  | Opus           |
| Specific bounded coding where tests and types define success  | Sonnet         |
| Web lookup and doc reading                                    | Haiku          |

Rules that priced in the old lessons:

- Work needing eyes (visual judgment, product feel) is never delegated —
  agents cannot see rendered pages.
- Delegated coding needs a machine-checkable "done" and files disjoint
  from anything else in flight.
- Parallel building is used sparingly: at most one helper alongside
  Claude, only on an obvious fork of the plan.
- Research that is really a judgment call goes up-tier or stays with
  Claude; Haiku handles lookup, not decisions.
- Agents that edit code run in isolated worktrees.
- No agent's claim reaches the owner unverified. Agents produce diffs
  and reports; Claude drives the result before it counts.

## Security

Before launch, the app gets a **defensive code review**: a first-party
read of our own source for security-relevant defects, so we find and
fix our own weaknesses before the group arrives. It is quality
assurance on code we own and operate — the same class of pass as the
linter or the test suite.

- Claude reviews `src/lib/server/` and the routes against current
  published guidance, looked up fresh rather than recalled: the OWASP
  Top 10 and cheat sheets, plus any standard the owner names.
- Focus areas: authentication and sessions, authorization on every
  admin path, input parsing, the sealed-identity encryption, and the
  privacy promises DESIGN.md makes.
- Findings are ranked by severity, the ones that matter get fixed, and
  the owner gets the blunt report. What is deliberately accepted gets
  written down as accepted, with its reason.

The first pass ran 2026-08-26 and is recorded in
[docs/SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md).

Day to day, security-sensitive code (hashing, sessions, the sealed
directory) gets Claude's most careful work and honest flagging of
anything uncertain — not ceremony.

## Enforcement — the hooks

Every policy above that a machine can check, a machine checks. Hooks
live IN the repo (versioned, visible), wired through the project
settings, built in step 0 of the build order. Each hook denies with a
remedy in its message; a denial means follow the remedy, never work
around it. One selftest command fires every rule both ways (a deny case
and a pass case) and runs in CI.

1. **session-open** — at session start: surfaces DESIGN.md and
   WORKING.md, the current feature and its state, and warns loudly if
   another session appears to be working the repo. (The
   one-session-at-a-time rule, and the day-to-day continuity fix.)
2. **merge-gate** — blocks merging or pushing to the default branch
   unless the owner's sign-off for that branch is recorded and CI is
   green. The owner's OK gets written to a sign-off record when given;
   no record, no merge. GitHub branch protection additionally requires
   CI green at the platform level, so even a hook failure cannot slip
   an unmerged-quality change through.
3. **deploy-gate** — blocks `wrangler deploy` when the newest migration
   file has not been recorded as applied. The schema goes first, as a
   machine rule, from day one. Since 2026-08-26 it also refuses to
   deploy a bundle that still contains the `/test/*` hooks: a plain
   production build erases them at build time (they exist only in
   `vite dev` and in builds run with `TEST_HOOKS=1`, which is how the
   e2e suite gets them), and a bundle carrying their marker string is
   a test build that must not reach production. Since 2026-08-27 its
   bundle rule and the migration-guard's pragma scan also re-fire in
   the release pipeline (hooks/ci_gate.py, imported from the hooks so
   each rule keeps one home) - GitHub's runner has no hooks. The
   migrations-applied record stays local-only: the pipeline applies
   migrations itself before every deploy, so the record guards just
   the break-glass path.
4. **git-guard** — blocks force-pushes to the default branch, pushes to
   the frozen old branches, and `--no-verify`. Since 2026-08-26 (owner
   order, after PowerShell 5.1 mangled inline prose into git errors
   twice in one day) it also holds the git process itself: commit
   messages and gh bodies travel by FILE — `git commit -F <file>`,
   `--body-file <file>` — never inline `-m`/`--body`, because this
   machine's shell rebuilds native arguments naively and any quote or
   newline in them becomes garbage. And a sign-off recording never
   shares a command with the merge it unlocks: the merge-gate reads
   its state before the command runs, and PowerShell has no `&&` to
   make the pair atomic — record first, merge as its own next command
   (an `&&` chain from the Bash tool stays honored).
5. **secret-guard** — blocks writing secret-shaped values (bot tokens,
   `*_SECRET=` literals) into repo files. Remedy: `wrangler secret put`.
6. **fleet-guard** — holds agent dispatches to the fleet rules: an agent
   that edits code must run in an isolated worktree and its task must
   state a machine-checkable "done"; Haiku is never given edit work;
   no agent is asked to push or merge.
7. **report-reminder** — injects the standing rules (plain speech; done
   means driven; reports are works / broken / untested) at each prompt,
   so they survive any session's context.
8. **migration-guard** — blocks a REMOTE `d1 migrations apply` while
   any migration file leans on a pragma that behaves differently on
   production: `PRAGMA foreign_keys` (remote D1 refuses it) or
   `defer_foreign_keys` (remote commits statement by statement, so
   the deferral quietly does nothing). Born 2026-08-26, the day a
   migration passed the whole local suite and production rolled it
   back; the remedy is a parent-first rebuild that satisfies every
   foreign key at every statement boundary. Local applies stay
   unguarded on purpose — they are the test bench.

Stated honestly: the rules a regex cannot hold — blunt reporting, the
same-commit rule, never repeating an unverified claim — are enforced by
the contract and the owner's eyes, not by hooks. The hooks cover
everything mechanical; the selftest proves each one fires.

## Ops runbook

- **Deploy:** the pipeline deploys, not the laptop (owner OK
  2026-08-27, replacing the 2026-08-24 straight-to-prod ruling - the
  flip planned for launch, taken early). Merging to main runs the
  deploy job in .github/workflows/ci.yml: rebuild, re-fire the
  deploy-gate and migration-guard rules (hooks/ci_gate.py), apply
  pending D1 migrations (schema first), `wrangler deploy`, then a
  smoke check of the live URL. A manual `wrangler deploy` from a
  machine is break-glass only - for when GitHub or the pipeline itself
  is down - and the local hooks still gate it.
- **Releases:** every PR uploads a preview version at a stable URL
  (`<branch>-hang-gangs-binder.sorcererbiggz.workers.dev`), posted as
  a PR comment. Preview URLs sit behind Cloudflare Access (previews
  only; the owner's email, one-time PIN; a dashboard setting, made
  2026-08-27) - production stays public. Test-drives happen on the
  preview; production moves only by the merge, after sign-off. A
  preview shares production's database, so a PR carrying migrations
  gets a loud warning in its preview comment and its schema-needing
  routes wait for the merge. Rollback is `npx wrangler rollback` -
  code only. Migrations never roll back, so every migration must
  leave the previous code able to run.
- **Secrets:** six of them — the bot token, the bot username, the group
  chat ID, the admin allow-list of Telegram IDs (how a fork's first
  admin is made), the identity-scramble secret, the directory-seal
  secret. Set via `wrangler secret put`, never in files. (Sessions need
  no secret — they are random tokens stored hashed in the database.)
  Losing the directory-seal secret makes every stored identity
  permanently unreadable; the stats survive, the names do not.
  The pipeline holds a seventh: `CLOUDFLARE_API_TOKEN`, a GitHub
  Actions repo secret (Workers Scripts edit + D1 edit) that lets the
  deploy job apply migrations and deploy. It lives in GitHub's secret
  store, set by the owner, never in a file.
- **Database:** D1, schema changes only through migration files applied
  with `wrangler d1 migrations apply` — before deploying code that
  needs them. The app refuses loudly (not quietly) when the schema is
  behind.
- **Crash lines:** when a page dies unexpectedly, the route and error
  text land in Workers Logs (dashboard → the worker → Logs). That is
  the ONLY thing ever logged - invocation logs are off by design
  (wrangler.jsonc), because they would store URLs. Locally,
  /test/boom fires the path on demand.
- **Take-down:** delete the worker; the database survives unless the
  owner orders otherwise.

## The build order

Each step lands by the contract above. The owner can reorder at any
time.

0. Scaffold: SvelteKit + TypeScript + D1 + Drizzle + Playwright + CI,
   deployed skeleton with the ported look — plus the seven hooks, their
   selftest green, and branch protection on before any feature starts.
1. Auth: both doors, registration + approval, linking, admin resets.
2. Core loop: entry form, your page.
3. Charts: the board, focused fields with combined filters, units,
   the desktop face. (Floorless — owner ruling 2026-08-24, recorded
   in DESIGN.md; the old step 6 landed here.)
4. Admin surface: settings, members, change log, departed cleanup.
5. Form builder, end to end — the acceptance test from DESIGN.md.
6. Fork README, the security pass, launch.

## The reset (record, not governance)

On 2026-08-24 the owner retired everything that previously governed this
project: the old branches (frozen as history), the old gates and hooks,
the agent fleet apparatus, and all prior process documents and rulings.
The old Cloudflare workers and databases were ordered deleted. Product
behavior decisions start fresh as each feature is built. What you are
reading, plus DESIGN.md, is the entire system.
