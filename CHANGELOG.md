# Changelog

Notable changes to Hang Gang's Binder, newest first. Dates are commit
dates. Every push to `main` publishes the site, so web entries go live as
soon as they land — the Worker is the exception and is deployed
separately, which is why some entries below say a thing is built and not
deployed.

This file starts on 2026-08-05. The work before it — the wire format, the
form, the Worker and D1, the key generator — is recorded in `DESIGN.md`,
which carries the reasoning rather than the sequence, and in the git
history.

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

Build-order steps 0 and 0.5 of the accounts redesign.

### Added
- `apps/web/ui.js` (`BinderUI`), holding the page wiring that
  `form.js`, `admin.js` and `public.js` each carried their own copy of —
  the boot guard, `show()`, and status rendering. `dev/ui.test.mjs` is a
  16-check DOM contract over it.
- A development Worker and database: `hgbinderworker-dev` over
  `hg_binder_db_dev`, so a local preview stops writing into the live
  data. `config.js` now switches on hostname rather than being edited.
- `POST /auth/dev` on the development Worker only. Four independent
  conditions, each failing closed, and a `404` rather than a `401` so
  production does not advertise the route's existence. It exists because
  Telegram's login widget binds to one domain and refuses `localhost`,
  so sign-in cannot otherwise be exercised anywhere but production.

### Changed
- `tools/check_web.py` was reworked around the two-environment split so
  a local endpoint cannot reach production and the reverse.
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

## 2026-08-05 — Quantised the published series

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
  than quietly dropped: quantising is deterministic, so an unchanged
  entry quantises identically in both documents and the snapshots go on
  sharing points. Coarsening makes them more alike, not less.
- What quantisation buys is ambiguity, not absence — a shared point
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
- `entryFor`, the single normalisation of a decrypted record read by
  both the CSV writer and the charts. Two independent readings would be
  two chances to disagree, and a table saying one thing while a chart
  says another is the kind of disagreement nobody notices, because each
  looks right alone.

### Notes
- Two things about drawing under this CSP were learned by getting them
  wrong: colour has to come from classes in `theme.css` because
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
