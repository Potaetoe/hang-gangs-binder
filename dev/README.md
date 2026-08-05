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

- a fixture of sample submissions for exercising the export tool without
  needing real data.

The test keypair here is a throwaway generated for testing and is
committed on purpose. It protects nothing and opens nothing real. The
real private key never enters this repository — see
[../DESIGN.md](../DESIGN.md).
