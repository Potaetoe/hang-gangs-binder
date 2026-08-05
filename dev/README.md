# dev/

Test harness and scratch verification. **Never published** — the deploy
copies `apps/web` and nothing else, so anything in here is safe to be as
messy as it needs to be.

## What is here

- `worker.test.mjs` — exercises `server/worker.js` against a stub D1
  binding: preflight, origin rejection, the validation cases, the token
  gate on export, and that `ALLOWED_ORIGINS` overrides the built-in list
  in both directions. No account, no network, no wrangler.

  ```bash
  node dev/worker.test.mjs
  ```

  What it cannot see is the dashboard. A Worker with no D1 binding, or
  no `EXPORT_TOKEN`, passes every check here and fails on the first real
  request — so a live round trip stays part of deploying, not something
  this replaces.

- `crypto.test.mjs` — exercises `apps/web/crypto.js`: round trips, the
  ways a key may be handed in, and every way a row must refuse to open.

  ```bash
  node dev/crypto.test.mjs
  ```

  The check that earns its keep is the **committed fixture** — a
  ciphertext written by version 1 of the format, which must still
  decrypt. Everything else here passes just as happily after a change
  that quietly alters the format, and such a change would leave the
  live database unreadable with no error anywhere.

  **If the fixture stops decrypting, do not regenerate it.** That is the
  test working. Either revert the change, or give it a new version byte
  and teach `decrypt` to read both formats — the rows already stored
  cannot be rewritten.

- `form.test.mjs` — exercises the pure half of `apps/web/form.js`:
  normalising a Telegram handle, reading a number strictly, the unit
  conversions in both directions, validation, and the record that gets
  encrypted.

  ```bash
  node dev/form.test.mjs
  ```

  It exists for the same reason `crypto.test.mjs` does. A wrong
  conversion factor does not throw and does not look wrong — it writes a
  plausible number into a blob nobody can read back, and by the time
  anyone notices there is no original left to correct it from. `form.js`
  returns before touching the DOM when there is no `document`, which is
  what lets this load the shipped file rather than a copy.

  The last two checks run a real record through `crypto.js` and back,
  which is where the two halves meet.

- `admin.test.mjs` — exercises the pure half of `apps/web/admin.js`:
  CSV quoting, the spreadsheet-formula guard, and turning a decrypted
  record into a row.

  ```bash
  node dev/admin.test.mjs
  ```

  The CSV is the product — everything else in this project exists to
  get the data into that file intact. A quoting bug does not throw and
  does not look wrong; it shifts one column into the next and produces
  a file that opens cleanly in a spreadsheet and is quietly incorrect.

  The last checks run the whole pipeline in one go: a record built by
  the real `form.js`, encrypted by the real `crypto.js`, decrypted, and
  turned into a CSV row.

- `dashboard.test.mjs` — exercises the pure half of
  `apps/web/dashboard.js`: averages, binning, breakdowns, the
  people-versus-entries split, and the weight-over-time series.

  ```bash
  node dev/dashboard.test.mjs
  ```

  Aggregation is where a dashboard lies quietly. A median taken over
  the wrong rows, a person counted once per submission, a blank
  silently dropped from a breakdown — none of them throw, and a chart
  that is wrong is indistinguishable from a chart that is right. The
  drawing is checked by looking at it; the arithmetic is checked here.

- `crypto-browser-check.html` — the platform-dependent half of the same
  checks, in a real browser under the published pages' content security
  policy. Node is the same specification, which is why the Node test is
  the one CI runs, but Node is not what a submitter uses.

  Serve the **repository root**, not `apps/web` — the page reaches into
  `apps/web` for the real `crypto.js` and `config.js`, so nothing is
  copied:

  ```bash
  python -m http.server 8124 --directory .
  ```

  Then <http://localhost:8124/dev/crypto-browser-check.html>. Port 8124
  is the localhost origin `server/worker.js` already allows. Note that
  while this is running the site itself is at `/apps/web/`.

- `fixture.json` — the stored ciphertext and the record it must come
  back as. Both checks read this one file; two copies would be two
  things to keep in step, and the copy that drifted would be the one
  still passing.

- `test-key.json` — the throwaway keypair both use, in the same envelope
  `tools/keygen.html` writes.

## Planned

### A fixture of sample submissions

**Why.** `admin.html` and its dashboard are the only parts of this
project with no repeatable way to exercise them. Every test of them so
far has meant hand-building fake rows in the browser console and
stubbing `window.fetch` — which was done three times in one session,
differently each time, and is gone the moment the tab closes. It also
means anyone inheriting this project cannot see the export working
without pointing it at real submissions, which is exactly what they
should not have to do.

**Do not confuse this with `fixture.json`.** They are opposites, and
mixing them up would be bad:

| | `fixture.json` | the sample fixture |
| --- | --- | --- |
| Purpose | proves the wire format still decrypts | disposable test data |
| Regenerate it? | **never** — see the warning above | yes, freely |

Because of that, the sample must be **generated by a committed script**
rather than hand-written, so it can be rebuilt when the record shape
changes. `fixture.json` cannot be, and must not be.

**What to build.**

1. `dev/make-sample.mjs` — reads a small readable table of people at the
   top of the file and writes `dev/sample-submissions.json`, encrypting
   each record to `dev/test-key.json`'s public half with the real
   `apps/web/crypto.js`. Build the records with the real
   `apps/web/form.js` `buildRecord`, not by hand, so the sample cannot
   drift from what the form actually produces.

2. `dev/sample-submissions.json` — shaped exactly like the Worker's
   `GET /export` reply, so it can be dropped in with no translation:

   ```json
   { "ok": true, "submissions": [ { "id": 1, "ciphertext": "…", "received_at": "…" } ] }
   ```

3. A documented way to load it into `admin.html` locally. Prefer a
   pasted console snippet that stubs `fetch`, recorded here in this
   README. **Do not add a `?sample=` hook or any other dev branch to
   `apps/web`** — that directory is published verbatim, and a code path
   that loads fake data into the export page is not something to ship
   to a live site.

**What the data must cover**, because each of these exercises a branch
that is otherwise only reachable by luck:

- two or more people with **several entries each**, at different
  weights and dates — the weight-over-time chart draws nobody with a
  single entry
- a person whose **height changes between entries**, for the
  data-quality panel
- **blanks**: no gender, no country, no affiliations
- **both unit systems**, including one imperial entry with empty inches
- a handle beginning `=`, for the CSV formula guard
- one row **encrypted to a different key**, so the "rows that would not
  open" path is exercised — this is the rotated-key case and the one
  most likely to be wrong when it matters
- values at the **edges of the form's validation range**, top and
  bottom

**Done when** a fresh clone can run one command, paste one snippet, and
see a populated export page and dashboard — with the failure panel
showing — having touched nothing real.

The test keypair here is a throwaway generated for testing and is
committed on purpose. It protects nothing and opens nothing real. The
real private key never enters this repository — see
[../DESIGN.md](../DESIGN.md).
