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

The full security pass happens once the app is feature-complete, before
launch:

- A small panel of independent Opus attackers — one each on
  auth/sessions, member-data exposure, and the privacy floor — trying to
  break the deployed app, findings ranked.
- Plus an outside check: current security best practice for small
  community apps, researched and verified with the owner, compared
  against our posture.
- Claude fixes the findings; the owner gets the blunt report.

Until then, security-sensitive code (hashing, sessions, the sealed
directory, the floor) gets Claude's most careful work and honest
flagging of anything uncertain — not ceremony.

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
   machine rule, from day one.
4. **git-guard** — blocks force-pushes to the default branch, pushes to
   the frozen old branches, and `--no-verify`.
5. **secret-guard** — blocks writing secret-shaped values (bot tokens,
   `*_SECRET=` literals) into repo files. Remedy: `wrangler secret put`.
6. **fleet-guard** — holds agent dispatches to the fleet rules: an agent
   that edits code must run in an isolated worktree and its task must
   state a machine-checkable "done"; Haiku is never given edit work;
   no agent is asked to push or merge.
7. **report-reminder** — injects the standing rules (plain speech; done
   means driven; reports are works / broken / untested) at each prompt,
   so they survive any session's context.

Stated honestly: the rules a regex cannot hold — blunt reporting, the
same-commit rule, never repeating an unverified claim — are enforced by
the contract and the owner's eyes, not by hooks. The hooks cover
everything mechanical; the selftest proves each one fires.

## Ops runbook

- **Deploy:** `wrangler deploy` of the SvelteKit app.
- **Releases (owner ruling 2026-08-24):** until launch, production IS
  the test site - features deploy straight to the one URL and the
  owner test-drives there, since no member is affected. AT LAUNCH this
  flips to preview versions: feature work goes up with
  `wrangler versions upload`, the owner drives the version's own
  preview URL, and production moves only when Claude promotes after
  the sign-off. A preview version shares production's database, so a
  schema-changing feature gets flagged before its preview goes up.
- **Secrets:** the bot token, the group chat ID, the bot username, the
  identity-scramble secret, the directory-seal secret. Set via
  `wrangler secret put`, never in files. (Sessions need no secret —
  they are random tokens stored hashed in the database.)
- **Database:** D1, schema changes only through migration files applied
  with `wrangler d1 migrations apply` — before deploying code that
  needs them. The app refuses loudly (not quietly) when the schema is
  behind.
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
