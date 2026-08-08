# Cutover

The one sitting that deploys the accounts redesign. Follow this file
while doing it; the reasoning behind the order is in
[archive/REDESIGN.md](archive/REDESIGN.md) Part 8 and the rehearsal
findings are in the commits and issues around 2026-08-08. **Owner
present throughout. This file is deleted in aftercare.**

**This is not a push.** Step 4 drops and recreates `submissions`; from
that moment the old Worker cannot insert either (`account_id NOT
NULL`), so production submissions are down from step 4 until step 6
completes. That is why the Worker deploys before the site.

## What does not come back

| Act | Reversible? |
| --- | --- |
| Step 4, dropping `submissions` | **No.** There is no backup, and an export is not one |
| `ACCOUNT_SECRET` after step 8 | **No.** The first real submission stores an id derived from it; changing it after that orphans every member's history |
| Step 5, deploying the Worker | Yes — the capture at `binder-recovery/`, or `wrangler rollback` (never exercised) |
| Step 6, merging to `main` | Yes — `git revert` restores the pages exactly |

## Preconditions (verified before the sitting)

- [x] **Step 0 — capture production.** Done 2026-08-08:
      `binder-recovery/` outside the repo holds version `2d3c73a5…`,
      confirmed pre-accounts by reading it.
- [x] **Step 1 — rehearse the migration on `hg_binder_db_dev`.** Done
      2026-08-08 from production's exact starting DDL: the wrong-order
      run fails loudly (`no such column: account_id`) and leaves no
      half-state; the real sequence produces the new shape; an insert
      without `account_id` — what the old Worker sends — is refused.
      **Do not remove the `submissions_account` index as redundant: it
      is what makes a mis-run fail loudly instead of half-migrating.**
- [x] **Step 2 — six production secrets exist as Secrets**, confirmed
      from the dashboard (owner, 2026-08-07) and independently via
      `wrangler versions view` (2026-08-08). `DEV_LOGIN_SECRET` is
      absent. Names are checkable; values are not.
- [x] **Step 3 — `ADMIN_TELEGRAM_IDS` should hold your numeric id.**
      Encrypted, so nothing can check it before step 8 — a wrong id
      looks exactly like a working deployment until the export. Know
      what you put in it. (Your id: sign in, then devtools → Session
      storage → `hgb-session` → `telegramId` — no page shows it yet,
      #58.)
- [ ] UAT Part A green on the current `accounts` head (record:
      `archive/UAT.md`; re-run only what changed since).

## The sequence

### 4 — Drop and migrate. POINT OF NO RETURN

Check the row count first — any visitor can still refill the old open
form until step 5, so a nonzero count here is a decision, not a
surprise. Then, on production D1:

```sql
DROP TABLE submissions;
```

then run the whole of `server/schema.sql`.

**Continue when:** `submissions` has `account_id NOT NULL`; `sessions`
and `snapshots` exist.
**Back out:** none. Submissions are down from here until step 6.

### 5 — Deploy the accounts Worker

```bash
cd server && npx wrangler deploy
```

Probe (matrix in `OPERATIONS.md`): unauthenticated `GET /snapshot`
answers **401** — that is the healthy answer; a 404 means the deploy
did not take.

**Continue when:** the probes agree.
**Back out:** the capture, or `wrangler rollback`.

### 6 — Merge `accounts` → `main`

This publishes the site. **Confirm the `deploy` job ran**, not merely
that a run exists — it is gated on `refs/heads/main`, and a skipped
deploy looks like a green run.

**Continue when:** CI shows `deploy` ran and the live site serves the
sign-in page. The outage ends here.
**Back out:** `git revert`.

### 7 — Sign in on the live site, through the real widget

The one verification possible nowhere else — BotFather binds the widget
to `potaetoe.github.io`. The CSP was confirmed against the real
`telegram.org`/`oauth.telegram.org` origins on localhost; only the
callback is unproven. If the widget misrenders anyway, the policy is in
`DESIGN.md`, "The sign-in page and the CSP".

**Continue when:** a session is minted and reaches `submit.html`.

### 8 — One real submission, then one export

Submit through the live form as yourself; open `admin.html` on your
admin session; decrypt. This is the only check that proves the key, the
admin id and the endpoint all reached production intact — and it is the
moment `ACCOUNT_SECRET` becomes permanent. Any doubt about that secret
is resolved **before** pressing submit; this is the last cheap moment.

**Continue when:** the export decrypts and the row is yours.

### 9 — Acceptance and aftercare

Acceptance, on the live site:

- [ ] Someone **outside** the group tries to sign in and is refused
      (if `TELEGRAM_GROUP_CHAT_ID` is set).
- [ ] `POST /auth/dev` returns **404** on production.
- [ ] Signed out, `submit.html`, `dashboard.html` and `admin.html` all
      bounce to sign-in with **zero** Worker requests.
- [ ] A member session reaches the dashboard; an admin-only page
      refuses a member with a message, not a blank page.
- [ ] Publish a snapshot (so members see figures) and re-run the three
      privacy checks from `archive/UAT.md` A6.1–A6.3 against the real
      corpus: no handles or rows in the published document, no
      height panel, no series under five lines. **A failure here stops
      everything else until resolved.**
- [ ] `submit.html`'s key fingerprint matches the pinned group message.

Aftercare:

- [ ] Re-test `wrangler secret put` now that the Worker deployed from
      this repository (it failed with 10220 only in version-upload
      state).
- [ ] Delete the `accounts` branch — the no-staging-branch argument in
      `DESIGN.md` depends on it actually being deleted.
- [ ] Strip every paragraph tagged `[pre-cutover]` from
      `OPERATIONS.md`, and delete this file. Both are one grep:
      `pre-cutover`.
- [ ] Repoint `.github/dependabot.yml`'s `target-branch` to `main` and
      enable Dependabot automated security fixes — both waited on the
      freeze (#93).
- [ ] Update the pinned fingerprint **only if the key changed** — it
      did not, if you followed this file.
- [ ] Update the status artifact.

## If it goes wrong

Before step 4, everything is free — stop and change nothing else. After
step 4 the rows are gone and forward is the only direction that serves
anyone: the Worker restores from the capture, the site from
`git revert`, but an empty `submissions` is the state either way, and a
reverted site still cannot write to the new schema. Decide which half
is broken before touching either.
