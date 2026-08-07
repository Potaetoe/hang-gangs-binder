# Changelog

Notable changes to Hang Gang's Binder, newest first. Dates are commit
dates. Every push to `main` publishes the site, so web entries go live as
soon as they land — the Worker is the exception and is deployed
separately, which is why some entries below say a thing is built and not
deployed.

A merged configuration change does not by itself prove the corresponding
live service was deployed. Where the two differ, entries say so.

This file starts on 2026-08-05. The work before it — the wire format, the
form, the Worker and D1, the key generator — is recorded in `DESIGN.md`,
which carries the reasoning rather than the sequence, and in the git
history.

## Unreleased — 2026-08-07

On `accounts`, not released. `main` stays at the last complete release.

### Configuration
- **`ACCOUNT_SECRET` is set on `hgbinderworker-dev`**, by the owner, and
  a live `POST /auth/dev` now returns a session. This corrects the
  2026-08-06 entry below, which recorded the gap. A fresh random value,
  deliberately not production's — `handleDevAuth` namespaces its subject
  as `"dev:" + subject` so the two cannot collide even under a shared
  secret, and reusing production's would discard that for nothing.
  **Local dev sign-in works, so a session no longer has to be faked**;
  step 4's browser check had to write one into `sessionStorage` by hand.
- The 2026-08-06 entry called the failure a 500. It is closer to a
  thrown `TypeError` — `hmacHex` guards with `typeof key === "string"`,
  so an absent binding reaches `importKey` as `undefined` rather than
  becoming an HMAC under an empty key. **That guard is why the failure
  was loud**; without it the Worker would have issued working dev
  account ids derived from nothing.

### Security
- **The production key fingerprint is published out-of-band** — a pinned
  message in the Telegram group, 2026-08-07, by the owner. Reported
  rather than verified here; no agent can see a Telegram group. It is
  the only mitigation for the repository-integrity threat that does not
  depend on trusting this repository, and it is a **detection** measure,
  not a preventative one. Pinned rather than placed in the group
  description, because an edited message carries an "edited" marker
  while a quietly edited description leaves no trace. Verified before
  posting that the live site, `main`, `accounts` and the issue all
  carried a byte-identical key.
- **Members can now compare the live encryption key with the pinned group
  message without opening source.** `submit.html` shows the first 32
  base64 characters of the configured public key in monospace and tells a
  member not to submit if they differ. #29's out-of-band anchor was only
  half a mechanism while the browser's value remained buried in
  `config.js`; the page now reads the key it is about to encrypt with on
  every setup, and shows no fingerprint when no key exists. #36.
- **The publishability gate now refuses a base64 key-shaped literal in any
  published file except `config.js`** — check 14. Check 2 does not cover
  this and is right not to: every one of its patterns targets a *private*
  key shape, and publishing a public key is what a public key is for.
  What #36 made dangerous is a public key written down where it cannot
  rotate — a fingerprint or a whole key pasted into a page passes every
  behavioral test on the day it is written, and after a rotation the page
  certifies a key it is no longer encrypting to. An anchor that vouches
  for the wrong key is worse than no anchor. The assertion **moved** out
  of `dev/ui.test.mjs`, where it guarded `submit.html` alone, rather than
  being copied: a page suite cannot own a repository-wide boundary, and
  two checks making the same claim is how one gets quietly weakened.
  `config.js` is exempt **by name**, and `dev/check_web.test.py` asserts
  that the exemption is what spares it rather than the pattern failing to
  fire — otherwise the arm could be inert and every test would still
  pass. Verified by mutation on the real gate: the production key pasted
  into `submit.html` fails it, reporting a length and a 12-character
  prefix rather than the literal, since the message goes into a CI log.
  #41.

### Data
- **Production `submissions` was cleared** — build step 2, by the owner,
  1 row → 0, with `sqlite_sequence` reset so the next real submission is
  `id = 1`. Irreversible and rehearsed on `hg_binder_db_dev` first. With
  the snapshot unpublished on 2026-08-06, step 2 is complete.
- **The clear is not durable until cutover.** `main` still ships the
  pre-accounts public form, and production `POST /submit` answers
  `400 Missing ciphertext` rather than `401` — it validates the body and
  never asks for a session. Any visitor can put a row back, and it would
  carry a `NULL` `account_id`. Re-run the clear immediately before
  cutover.

### Changed
- **The Telegram handle on a submission comes from the verified session,
  and `submit.html` no longer has a field to type one into.** Build step
  4. `buildRecord` takes the session username as a mandatory third
  argument and throws without it; `readForm` supplies it from
  `BinderSession.read()`. Before this, a signed-in member could type
  somebody else's handle and have it stored — the row's `account_id`
  would have been right and the handle beside it a lie, which is the
  divergence accounts exists to remove. The field is deleted rather than
  hidden or made readonly, so there is nothing left for sign-out to
  clear.
- A session handle is checked for presence only, not against this page's
  5–32 character `HANDLE` rule. The Worker already refuses a Telegram
  account with no username, and past that the identity provider's rule
  governs rather than ours.

### Notes
- `server/worker.js` was not touched. `POST /submit` was already gated on
  a member session and already wrote `account_id` from that session
  rather than from the body; this step confirmed that rather than
  assuming it. **The live half of step 4 is still unproven** — a real row
  arriving with an `account_id`, and a signed-out `curl` refused, need
  the accounts Worker deployed, which happens at cutover with step 2.
- `validate()`'s one-argument path still applies `HANDLE` to
  `input.telegram`, and no page reaches it now, so three checks in
  `dev/form.test.mjs` exercise code the product never takes. Left
  visible for a later cleanup rather than folded into this slice.

### Security
- **Every page's whole Content-Security-Policy is now pinned**, not two
  directives on one page. Checks 11 and 12 left `default-src` unchecked,
  and `default-src` governs every directive a page does not set
  explicitly — `object-src` among them — so a page could widen
  everything it had not named with nothing to say so. The pin is a
  baseline plus declared deviations, each carrying its reason, and the
  pages it covers are **listed** rather than read off the directory: a
  table derived from what exists cannot fail when a page is added, and
  adding a page is exactly when a head gets copied. #34.
- **The CSP parser reports when it cannot read, instead of skipping.**
  The old searches matched `http-equiv` and *then* `content` within one
  tag; HTML does not care about attribute order, so reversing the two
  made every CSP check pass in silence while check 3 still saw the
  marker. Two hazards were produced against the old code with the gate
  green — `index.html` carrying `script-src * 'unsafe-inline'
  'unsafe-eval'`, and `submit.html` carrying the Telegram origin. Both
  now fail. Absence and unreadability are kept distinct: a page with no
  policy at all is still check 3's to report.
- `csp_gaps()` routed through the same parser. It carried the original
  `if not policy: continue` and is where checks 11 and 12 inherited it.

### Added
- **`dev/check_web.test.py` — the gate's first test of itself**, and the
  local gate is twelve checks. `check_web.py` had never had tests, which
  is the direct cause of the bug above: its only verification was manual
  mutation, and a mutation is written against a *rule*, so it exercises
  the rules and never the parser that has to find the policy first.
  Every mutation on checks 11 and 12 passed while the policy was never
  read. No framework and no new dependency, matching the `.mjs` suites;
  registered in both `tools/check.py` and the CI workflow.

### Documentation
- **Worker setup now records all three numeric id bindings as secrets, not
  vars.** Their being ids rather than credentials never made a public
  `[vars]` block safe: the allowlist is the membership oracle the
  account-id design exists to prevent, and a dashboard-only var is
  silently erased by the next deploy. Six live statements across five
  files — the Worker config, server setup table, bindings header,
  authoritative design bullet, Part 1 setup table and top-of-file
  exception — now agree with the six production secrets. They also
  record that this production deployment must use the dashboard until
  cutover because its version-upload state makes `wrangler secret put`
  fail with error 10220.
- **`owner-only` no longer means "irreversible".** It now means the work
  is unreachable from an agent session, and the issue has to name which
  of three reasons applies: it needs a secret, it is not on this machine,
  or it needs an authenticated Wrangler command. An irreversible act an
  agent *can* perform takes a confirmation in chat, not a handover — the
  old reading was a category that quietly grew to cover work an agent
  could have done after one question. Every `owner-only` issue now
  carries numbered steps, and writing them is the test: if the steps show
  the work is reachable, the label was wrong.
- **No authenticated Wrangler command can run from an agent shell**, and
  it is mechanical rather than a policy choice. The owner's OAuth login is
  present and current; an agent shell is non-interactive, and a
  non-interactive wrangler refuses a stored OAuth login and demands
  `CLOUDFLARE_API_TOKEN`. Wider than the existing piped-stdin note — it
  covers every authenticated subcommand, including read-only ones. Note
  that `wrangler whoami` misreports this as "You are not authenticated",
  which invites a `wrangler login` that does not help; diagnose with a
  subcommand instead.
- **`AGENTS.md` describes Codex running as an MCP tool**, which is a
  second way of working that the file did not previously distinguish from
  Codex running as its own session. In that mode Codex has no network, so
  it cannot fetch, push, or comment on an issue — Claude posts the claim,
  reads the whole diff, commits with `--author` set to Codex, and pushes.
  Publishing a slice does not transfer it; the label remains the lock.
  The section also says what to do when Codex stops mid-slice, because a
  clone holding half-written files looks exactly like one holding
  finished ones.

## Unreleased — 2026-08-06

On `accounts`, not released. `main` stays at the last complete release.

### Configuration
- **All six production Worker secrets are set** — `EXPORT_TOKEN`,
  `TELEGRAM_BOT_TOKEN`, `ACCOUNT_SECRET`, `TELEGRAM_GROUP_CHAT_ID`,
  `ADMIN_TELEGRAM_IDS`, `ALWAYS_ALLOW_TELEGRAM_IDS`, as secrets rather
  than `[vars]`. `server/wrangler.toml` still describes the last three as
  plaintext vars and is now wrong; correcting it is what #30 has left.
- **`wrangler secret put` cannot set them.** Production's script was
  hand-pasted, leaving the Worker in version-upload state, and
  `secret put` creates and deploys a version in one step — refused with
  `error 10220`, for anyone, however they authenticate. The dashboard is
  the tool until cutover deploys from this repository.
- The **development Worker still has no `ACCOUNT_SECRET`**, which makes
  every `/auth/dev` sign-in a 500 rather than a missing convenience.

### Documentation
- `DESIGN.md` records why the sign-in page's policy needs a third
  exception, `'unsafe-eval'`, and why redirect mode was rejected for it:
  redirect returns the signed payload in a URL query string, putting the
  numeric id and handle into history, `Referer` headers and access logs
  on every sign-in. It also corrects the sentence the exception was first
  argued with — the page is not one with nothing to steal, since after
  sign-in it holds the session.
- `AGENTS.md` gains the Worker-configuration reality above, and three
  CI-verification rules: check that a run **exists** for the head commit
  rather than that none failed; query `head_sha` with the **full
  40-character SHA**, because an abbreviated one returns `total_count: 0`
  and is indistinguishable from a commit that never ran; and never reach
  for `workflow_dispatch` as a routine re-trigger, because on `main` it
  satisfies the deploy condition and releases the site.

### Security
- The Telegram login widget now lives on the sign-in-only page and names
  `hanggangbinder_bot`. Browser observation found that legacy callback mode
  evaluates `data-onauth`, so its provisional CSP confines
  `https://telegram.org`, `https://oauth.telegram.org`, and `'unsafe-eval'`
  to `index.html`; no form, plaintext, key, or `crypto.js` is present there.
- Publishability checks 11 and 12 enforce that separation: the sign-in page
  cannot load `crypto.js`; its `script-src` and `frame-src` are pinned to the
  exact observed callback policy; and no other page can inherit Telegram or
  `'unsafe-eval'` CSP permissions. Check 2 also refuses the structural shape
  of a BotFather token without recording a credential.
- **A published snapshot no longer describes fewer than five people.**
  `MIN_CELL = 5`. Before this, a plausible 24-person group published
  "exactly one member is in Japan" and "exactly one member is
  nonbinary" — and `ROLE_VOCABULARY` is feeder/feedee/gainer/admirer,
  so a singleton there published a named person's kink role to the open
  web.
- Categorical cells below the floor pool into one `Other (fewer than 5)`
  bucket, which must clear the floor itself or the breakdown is
  suppressed entirely.
- Histograms **merge** adjacent bins rather than bucketing, so the shape
  and the total survive and the tails simply widen.
- Published cells still sum to the group. Subtraction is the attack, not
  redaction: naming US 8 and GB 5 against a known total of 24 while
  dropping Japan discloses Japan exactly as loudly as printing it.
- The weight-over-time series publishes only above `MIN_CELL` lines. A
  line is one person by construction, so the floor cannot apply cell by
  cell.
- **Both unit systems now publish one partition.** They bin different
  stored fields at different widths, 10 kg against 20 lb, so their
  boundaries did not align — both could satisfy the floor while a reader
  who overlaid them recovered a finer partition. Differencing the
  cumulative counts produced sub-floor cells in 2899 of 3000 random
  groups.

### Fixed
- `BinderUI.checkedValue` now exposes the global two-argument behavior
  every caller actually used; its unused `scope` parameter no longer
  advertises collision protection that was never active.
- Every static navigation menu now links to the sign-in page. Check 10
  requires that route as well as identical menus, so removing it from all
  five pages cannot strand signed-out visitors while the gate stays green.
- `render()` dereferenced the basis immediately, so a suppressed
  (`null`) basis would have white-screened the public dashboard for any
  group below the floor.
- CI installs lint tooling with `npm ci --ignore-scripts`. Without it,
  any of 87 transitive packages could run arbitrary code at install
  time, in the job that decides whether a release is allowed. The
  realistic attack was never site compromise — `verify` holds
  `contents: read` — but a dependency quietly neutering ESLint gives a
  gate that reports success on a repository that should fail.
- `AGENTS.md` stated the mutation rule and the review bar side by side
  and let the reader guess which governs. It now states the
  relationship: a mutation is derived from the check, so it can only ask
  whether the check enforces what it says, never whether that is the
  right thing to enforce. When they disagree, the review bar wins.

### Security
- **`main` is a protected branch**: pull request required, `verify`
  required, force pushes and deletion refused, **administrators
  included**. Verified by attempting a real direct push, which GitHub
  refused. Zero required approvals is deliberate — GitHub forbids
  approving your own pull request and both agents publish as the owner's
  account, so requiring one would deadlock every merge.
- A documented, **rehearsed** path for fixing production while `main` is
  frozen, in `README.md` on `main` where somebody with a broken site is
  standing.

### Added
- `tools/keycheck.html` — names which of the three keypairs a private
  key file is, and separately whether it still decrypts a real row.
  Never published; nothing leaves the page; a self-test proves the tool
  before you trust its answer about your key.

### Added
- ESLint and Ruff, registered in **both** `tools/check.py` and the
  workflow. A linter here is a gate, not a build: `apps/web` still ships
  verbatim, nothing is rewritten, and formatting is never applied
  automatically. Ruff immediately found a loop-variable closure in
  `check_web.py`'s config parser that would have reported the wrong
  environment.
- `.gitattributes` and `.editorconfig`, so line endings are a property
  of the repository rather than of whichever agent committed last.
- `AGENTS.md` as the single instructions file, absorbing `CODEX.md` and
  `CODEX_CHECKLIST.md`.

### Changed
- American spelling throughout — prose, comments and our own
  identifiers. Platform names keep their own spelling. 114 replacements;
  `normaliseTelegram` was an exported API and was renamed in both the
  export and its test.
- `main` is frozen at `b6a984f` until the accounts redesign is complete.
  The `deploy` job now names `refs/heads/main` explicitly rather than
  merely excluding pull requests.

### Notes
- **The reasoning the suppression floor replaced was nearly right**, which
  is why it survived: rows are dangerous and aggregates are safe. That
  holds for large N. At twenty-four an aggregate of one is a row.
- The unit-system leak was found by **attacking the hazard** rather than
  confirming the rule, and is the same shape as the earlier `check 5`
  gap — every rule correctly applied, the composition defeating them.

## Unreleased

Proposed in [PR #17](https://github.com/Potaetoe/hang-gangs-binder/pull/17),
based on `accounts`. Build-order step 3, session half only.

### Added
- `apps/web/session.js` and a frozen `globalThis.BinderSession`:
  tab-scoped session storage, expiry validation, bearer headers, explicit
  sign-in redirects, and a visible development-session marker.
- The transport half of `apps/web/auth.js`, shared by development auth and
  the future Telegram widget callback — both responses travel the same
  POST/store/redirect path.
- `apps/web/submit.html`, holding the form formerly served by
  `index.html`.
- `dev/session.test.mjs`, registered in **both** `tools/check.py` and
  GitHub Actions.

### Changed
- `index.html` is a sign-in-only shell. It does not load `crypto.js` and
  holds no submission fields — the one page permitted third-party script
  is the one page with nothing to steal.
- Form submissions require a stored member session and send its bearer
  token.
- Interactive pages load session support; `404.html` stays inert.
- Shared navigation points at `submit.html`.
- `check_web.py` gains one named, stale-checked auth-payload exemption,
  and its units-default check moves to `submit.html`.

### Security
- Malformed, unsuccessful and expired session responses fail closed and
  are removed from tab storage rather than left to fail every request
  until the tab closes.
- Authentication can POST only to the two known auth routes.
- `admin.html` is **not** auto-redirected when signed out, preserving the
  owner's break-glass export-token path. Gating the dashboard belongs to
  step 6.

### Still blocked
- Telegram widget markup and the bot username.
- Telegram `script-src` and `frame-src` permissions, pending observation
  of the real widget rather than assertion of a policy.
- Widget-confinement checks 11 and 12.
- One positive live `/auth/dev` round trip, which needs the owner-held
  secret.

## 2026-08-05 — Stopped releasing the redesign one step at a time

### Added
- `accounts`, an integration branch. The accounts redesign is a chain of
  ten steps whose intermediate states are broken **on purpose** — a
  sign-in page before the widget exists refuses everybody, and a session
  gate before a page can sign anybody in refuses everybody twice. Steps
  land on `accounts`; `main` stays at the last complete release and the
  two meet once, when the chain is finished.

### Changed
- The `deploy` job's condition is now
  `github.event_name != 'pull_request' && github.ref == 'refs/heads/main'`.
  The ref test is the load-bearing half. The condition was the event
  test alone, which was sufficient only while `main` was the single
  branch in the `push` trigger list — the moment `accounts` joined it, a
  push to that branch would have satisfied the old condition and
  published a half-built redesign to the live site.
- `accounts` is in both the `push` and `pull_request` trigger lists.
  Leaving it out of `pull_request` would mean a step merged into it with
  no checks at all, which is the failure the trigger list was widened to
  fix in the first place.

### Notes
- **A branch that deploys because of what it is *not* is one
  trigger-list edit away from deploying.** The fix is to name the branch
  that releases, rather than to enumerate the branches that do not.
- This is not a staging environment and does not deploy anything. The
  non-production *environment* — a second Worker and D1, with
  `config.js` choosing by hostname — is a different thing and already
  exists.
- The header comment in the workflow claimed "there is deliberately no
  staging branch: a push is a release", which this makes false. It was
  rewritten rather than left to be read as current.
- This also unblocks the sequencing problem it was made for: step 2
  (clearing the table and unpublishing the snapshot) no longer has to
  happen before step 3 can merge. It moves to the cutover, alongside
  deploying the accounts Worker — which is where it always belonged,
  since both are irreversible and both describe the same moment.

## 2026-08-05 — Split the environment, and shared the page wiring

Build-order steps 0 and 0.5 of the accounts redesign. Shared UI in
[PR #14](https://github.com/Potaetoe/hang-gangs-binder/pull/14) with its CI
registration in [#15](https://github.com/Potaetoe/hang-gangs-binder/pull/15);
development isolation in
[#16](https://github.com/Potaetoe/hang-gangs-binder/pull/16). Nine
deliberate mutations were run across the two before handoff.

### Added
- `apps/web/ui.js` (frozen `globalThis.BinderUI`), holding the page wiring
  that `form.js`, `admin.js` and `public.js` each carried their own copy
  of — element lookup, visibility, checked-radio selection, status
  rendering, and a guarded boot. `dev/ui.test.mjs` is a 16-check DOM
  contract over it, including the architectural rule that **`ui.js`
  contains no `fetch` and no POST** — network behavior stays in
  page-specific modules so `check_web.py` can keep its senders rule
  strict.
- A development Worker and database: `hgbinderworker-dev` over
  `hg_binder_db_dev`, so a local preview stops writing into the live
  data. `config.js` now switches on hostname rather than being edited.
- `POST /auth/dev` on the development Worker only. Four independent
  conditions, each failing closed, and a `404` rather than a `401` so
  production does not advertise the route's existence. It exists because
  Telegram's login widget binds to one domain and refuses `localhost`,
  so sign-in cannot otherwise be exercised anywhere but production.

### Changed
- `config.js` selects production or development by **exact hostname**,
  aliases `127.0.0.1` to localhost, and fails closed on an unknown host
  with neither endpoint nor key. A production fallback is the accident the
  whole arrangement exists to prevent.
- The production Worker no longer allows loopback origins; they moved to
  the development environment.
- `tools/check_web.py` was reworked around the two-environment split: it
  validates every arm's endpoint and P-256 key, the production hostname,
  the loopback alias, the closed fallback, and CSP coverage for every arm
  on every page that loads `config.js`. Its `connect-src` test also moved
  from substring matching to **exact token matching** — a policy naming a
  lookalike origin that contained the real one as a substring would have
  passed the old test while permitting exfiltration.
- Every page loading `config.js` now permits **both** Worker origins in
  `connect-src`. A `<meta>` policy is one string served to both hosts, so
  this is unavoidable; `DESIGN.md` records it as an accepted loosening
  rather than a surprise.
- `dev/worker.test.mjs` covers the development login from the numeric
  loopback origin as well as from `localhost`.
- `preview_urls = false` is repeated on the development environment
  rather than left to inherit, so old versions of the sign-in bypass do
  not stay reachable at a permanent hostname.

### Notes
- The isolation was verified live in both directions rather than
  assumed: production refuses both loopback origins with `403`,
  development refuses `potaetoe.github.io` with `403`, and
  `POST /auth/dev` returns `404` on production, where no
  `DEV_LOGIN_SECRET` exists to turn it on.
- The production half of that needed a Cloudflare **dashboard** edit of
  `ALLOWED_ORIGINS`, not a `wrangler deploy`. The live production script
  reports `Source: Unknown (version_upload)` — hand-pasted, matching no
  commit — so a deploy would replace it with the repository's accounts
  Worker and refuse every submitter. The API settings endpoint is
  equally wrong for it: `bindings` is a replace rather than a merge, and
  a partial write drops `DB` or `EXPORT_TOKEN`, which every test in
  `dev/` passes without noticing.
- `dev/ui.test.mjs` shipped in one commit registered only in
  `tools/check.py` and not in the workflow, so it passed locally and
  never ran in CI. Fixed the same day. There are two suite lists in this
  repository and they have to be edited together — a check that looks
  armed and is not buys confidence, which is worse than having no check.

## 2026-08-05 — Ran the checks on pull requests, not only after the merge

### Changed
- CI now runs on pull requests as well as pushes to `main`. Until two
  agents started working here a push to `main` *was* the review, so
  gating only `main` was enough; under branch-and-review every check was
  running after the merge. One PR had already been merged on the
  strength of a local gate and nothing else.
- The `deploy` job stays `main`-only by an explicit `if` rather than by
  the trigger list, so publishing remains something merging does and a
  branch cannot cause a release.
- `pages: write` and `id-token: write` moved from the workflow down to
  the `deploy` job, so a pull request cannot reach them at all. The
  workflow keeps `contents: read`. The Pages concurrency group moved
  with them, so pull request checks do not queue behind a release they
  are not going to perform.

## 2026-08-05 — Quantized the published series

### Changed
- A published weight-over-time point now carries the date rather than
  the instant, and each weight snapped to the histogram bin the
  dashboard already uses. The keyholder's own snapshot is untouched — it
  never leaves their tab.

### Notes
- This closes the hole behind the linkage correction made earlier the
  same day. An exact millisecond plus a weight to a tenth was a join
  key: publish twice and one person's line reappeared verbatim with a
  point on the end. Renumbering pseudonyms never touched that.
- `REDESIGN.md` had specified the missing assertion as "two snapshots of
  the same corpus, one with an extra entry, share no exact series
  point". That is not achievable and the criterion was corrected rather
  than quietly dropped: quantizing is deterministic, so an unchanged
  entry quantizes identically in both documents and the snapshots go on
  sharing points. Coarsening makes them more alike, not less.
- What quantization buys is ambiguity, not absence — a shared point
  stops identifying a line because several people land on the same date
  and the same bin. Five checks assert that over a fixture built with
  off-midnight times and off-bin weights, so none of them can pass by
  accident, and each was confirmed armed by mutation in both directions.

## 2026-08-05 — Wrote down the accounts redesign, and built its Worker

Step 1 of the build order. **Built and deliberately not deployed** — the
pages that sign somebody in do not exist yet.

### Added
- `REDESIGN.md`: the scaffolding plan for accounts — the setup only the
  account owner can do, the schema, the routes, the page map, the test
  and `check_web.py` changes, and the order with its checkpoints.
- `CODEX.md`, recording the second agent's role, and what it can and
  cannot establish on its own.
- Telegram sign-in, sessions, account ids, group membership, `GET /me`
  and a per-row delete in `server/worker.js`. Every route is gated in
  one place in the router, so a handler that forgot to ask who was
  calling is not a mistake that is available.
- `tools/check.py`, running `check_web.py` and every `dev/` suite in one
  command — the same gate Weight-Goal-Calculator already had.
  `check_web.py` runs first on purpose: publishing a private key is the
  one unrecoverable mistake this project can make, and there is no
  reason to hear about it after thirty seconds of Node.

### Notes
- **The repository and the live endpoint now disagree on purpose.**
  Deploying `worker.js` today would `401` every submitter — the form
  encrypts fine and is then refused, because it sends no session.
  `server/README.md` opens with that warning.
- `server/schema.sql` carries the subtler trap: run it against
  production and `CREATE TABLE IF NOT EXISTS` silently skips
  `submissions`, leaving a `sessions` table beside an unmigrated one.
- The account id is an HMAC of the Telegram **numeric** id under a
  Worker secret, never a hash of the handle. A hashed handle would turn
  the database into a membership oracle, since the guesses are the few
  dozen names in a group's member list. `ACCOUNT_SECRET` is therefore
  permanent, in the same category as `crypto.js`'s derivation label.
- Mutation testing found a real bug rather than confirming a clean run.
  Removing the `DEV_LOGIN_SECRET` guard made `tokenMatches` compare
  against an undefined secret and throw, so the suite crashed — and a
  harness counting FAIL lines read that as zero failures. `tokenMatches`
  now refuses an unset secret instead of throwing.
- The runbooks are deliberately **not** rewritten ahead of the code.
  `README.md`, `HANDOFF.md` and `server/README.md` still describe what
  actually runs. A runbook describing a system that does not exist is
  worse than a stale one.
- `dev/worker.test.mjs` was rewritten around a stub D1 understanding all
  three tables: 64 checks, including a committed account-id fixture
  under the same never-regenerate rule as `dev/fixture.json`.

## 2026-08-05 — Published a dashboard nobody needs a key to read

### Added
- `apps/web/dashboard.html` and `public.js`: a public dashboard reading
  a published aggregate. A page cannot be given rows — "female, GB,
  241 lb, 5 ft 8 in" is a person to anyone who knows her — so what gets
  published is counts, medians and histogram bins, aggregated in the
  keyholder's browser where the plaintext already is.
- `apps/web/xlsx.js`: a spreadsheet export, written by hand because an
  `.xlsx` is a ZIP of XML parts and `admin.html` runs under
  `script-src 'self'`. A library here would see the whole corpus, and
  the policy forbids the CDN it would arrive from. What it buys over the
  CSV is types: a CSV cannot say whether `90.7` is a number or the
  characters `"90.7"`, so every reader guesses, and a spreadsheet
  guessing about a column of handles is where a handle becomes a float.
- `apps/web/nav.js` and a hamburger menu in the header of all four
  pages. The links are written out in each page's HTML rather than built
  by the script, because a page whose navigation vanishes when a script
  fails is a page somebody can get stranded on.
- `dev/make-sample.mjs` and `dev/sample-submissions.json` — 18 rows, 17
  of which decrypt, one sealed to a discarded key so the rotated-key
  path is exercised. This is the **opposite** of `dev/fixture.json`:
  disposable, and regenerated by a committed script whenever the record
  shape changes.
- `check_web.py` checks 8, 9 and 10 — the units default written in two
  places agreeing, promoted country codes naming real countries, and
  every page carrying the same navigation. All confirmed armed by
  mutation.

### Changed
- `render()` takes a snapshot rather than rows, and `admin.html` builds
  one of its own entries to draw itself. That is what makes Publish a
  preview instead of a leap — the same function drew what is already on
  screen. The published document differs by one flag: pseudonyms instead
  of handles, and the data-quality panel dropped.
- Imperial is the default everywhere. Both dashboards gained a unit
  toggle that reads the stored field and never converts.
- The stylesheet was mobile-first, so every page rendered as a 34rem
  column with the rest of the window empty. Inverted: the rules are now
  the desktop layout and mobile is one override block at the bottom.
- `server/wrangler.toml` became the deployment rather than a description
  of one. It had drifted in both ways a documentation-only config drifts
  — the repository's name instead of the Worker's, and `REPLACE_ME` for
  `database_id`. A deploy against that would not have errored; it would
  have created a second Worker beside the real one.
- `check_web.py` check 6 changed meaning. It held every file touching
  the network to naming `BinderCrypto`, which broke on `dashboard.html`
  — the first page that reads without sending. It now fires on files
  that send a body.

### Notes
- Unpublishing needs the export token and **not** the key. Requiring the
  key would mean decrypting the corpus in order to remove something
  derived from it, which is backwards and slowest at exactly the moment
  speed matters. Deleting nothing succeeds on purpose.
- Weight over time is opt-in and off by default. It is the one part
  still about individuals, pseudonyms or not.
- The CSV's formula guard is deliberately **not** applied to the
  spreadsheet. A cell typed as an inline string is a string — a formula
  lives in an `<f>` element and this never writes one — so the leading
  apostrophe would just be an apostrophe in the sheet.
- The ZIP test reads the archive back rather than trusting it, and
  earned its keep immediately: the end-of-central-directory record was
  measuring itself, overstated by exactly twelve bytes, which tolerant
  readers ignore and strict ones do not. Confirmed independently with
  Python's `zipfile`.
- There is deliberately no `?sample=` hook in `apps/web`. That directory
  is published verbatim, and a code path that loads fake data into the
  export page is not something to ship to a live site.

## 2026-08-05 — Built the export page and its dashboard

The other end of the design: export token in, key file in, decrypted CSV
out, all of it in the keyholder's own browser.

### Added
- `apps/web/admin.html` and `admin.js`, with the CSV logic split pure
  and exported as `BinderAdmin` so `dev/admin.test.mjs` can run it. The
  CSV is the product, and a quoting bug does not throw — it shifts one
  column into the next and produces a file that opens cleanly and is
  wrong.
- `apps/web/dashboard.js`: charts as hand-written inline SVG, no chart
  library, for the same reason the spreadsheet writer is hand-written.
- `entryFor`, the single normalization of a decrypted record read by
  both the CSV writer and the charts. Two independent readings would be
  two chances to disagree, and a table saying one thing while a chart
  says another is the kind of disagreement nobody notices, because each
  looks right alone.

### Notes
- Two things about drawing under this CSP were learned by getting them
  wrong: color has to come from classes in `theme.css` because
  `style-src` carries no `'unsafe-inline'`, and a `polyline` needs
  `fill: none` from an element+class rule, because the `fill="none"`
  attribute loses to any CSS rule. It shipped once as a filled wedge
  instead of a line.
- A row that will not decrypt is named, not skipped. The ordinary cause
  is a rotated key, where the old rows fail and the new ones are exactly
  what was wanted.
- Cells beginning `=`, `+`, `-` or `@` are defused with a leading
  apostrophe, because a spreadsheet runs them. Nothing passing the
  form's validation starts that way, but a record is whatever arrived,
  and this design does not assume the submitter's browser was the
  submitter's.
- `connect-src` deliberately omits `blob:`. A download is not a fetch —
  confirmed by watching `securitypolicyviolation` while clicking the
  link. Adding it would have permitted the only thing this page never
  does.
- Entries are not people. Storage is append-only, so a resubmission is a
  new row, and "how many people" and "what was submitted" are different
  questions. The dashboard has a toggle rather than an opinion; on the
  sample data the mean weight moves 112.3 kg to 104.7 kg between them.
- BMI is shown as a number with no clinical category labels attached.
  Those are a judgement this page has no business making about people
  who filled in a form, and they would be the part everybody read.
