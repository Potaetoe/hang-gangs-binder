# dev/

Test harness and scratch verification. **Never published** — the deploy
copies `apps/web` and nothing else, so anything in here is safe to be as
messy as it needs to be.

## What is here

- `worker.test.mjs` — exercises `server/worker.js` against a stub D1
  binding: preflight, origin rejection, the validation cases, Telegram
  sign-in, sessions, group membership, the account id, and a full
  route-by-caller gating matrix. No account, no network, no wrangler.

  ```bash
  node dev/worker.test.mjs
  ```

  Three parts of it are worth knowing about before changing anything.

  **The account-id fixture is a committed answer, and the same rule
  applies to it as to `fixture.json`: if it fails, do not regenerate
  it.** A changed account id means every stored row has detached from
  the person who wrote it, with nothing anywhere reporting it. Find what
  changed instead.

  **The `POST /auth/dev` refusals are the most important assertions in
  the file.** Everything else here protects the data; those protect the
  boundary that protects the data, and a silent pass is itself the
  compromise. Two independent conditions keep that route shut — the
  secret being unset, and the origin not being loopback — so removing
  either one alone still fails closed, and removing both fails two
  tests. That is the property being armed rather than the implementation.

  **Login payloads are signed here rather than committed.** A fixture
  would carry a fixed `auth_date` and the freshness check would start
  rejecting it five minutes after it was written.

  What it cannot see is the dashboard. A Worker with no D1 binding, or
  with a secret missing or wrong, passes every check here and fails on
  the first real request — so a live round trip stays part of deploying,
  not something this replaces. A wrong `TELEGRAM_BOT_TOKEN` is the new
  example: it refuses every sign-in with the same 401 a tampered payload
  gets.

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

- `xlsx.test.mjs` — exercises `apps/web/xlsx.js`, which writes the
  spreadsheet export: a ZIP of XML parts, built by hand because
  `admin.html` may not load a library.

  ```bash
  node dev/xlsx.test.mjs
  ```

  Its failure mode is the opposite of the CSV's and needs a different
  kind of check. A CSV with a quoting bug opens cleanly and is quietly
  wrong; an .xlsx with a bad checksum, an overstated central directory
  or an unescapable character does not open at all, and the message a
  keyholder gets says only that the file is corrupt. So the last
  section is a small ZIP **reader**: it walks the central directory,
  extracts every part and re-checks every CRC. That found a real bug —
  the end-of-central-directory record was measuring itself.

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

- `ui.test.mjs` exercises the shared DOM wiring in `apps/web/ui.js`:
  element lookup, visibility, checked-radio selection, status messages,
  and the guarded startup path for both synchronous and asynchronous
  failures.

  ```bash
  node dev/ui.test.mjs
  ```

  It also holds the architectural boundary that `ui.js` must contain no
  `fetch` or `POST`. Network behavior stays in the page-specific scripts,
  where the publishability check can require encryption for anything that
  sends a body.

- `session.test.mjs` exercises `apps/web/session.js` and the common half of
  `apps/web/auth.js`: tab-scoped storage, expiry, bearer headers, signed-out
  redirects, the visible development marker, and the POST/store/redirect
  handoff shared by `/auth/dev` and the future Telegram widget callback.

  ```bash
  node dev/session.test.mjs
  ```

  Its development secret is a literal test value consumed by a stub fetch;
  the suite makes no network request and does not need an owner secret. The
  successful live `/auth/dev` round trip remains an operational check because
  the real secret must not enter the repository or a test log.

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

- `make-sample.mjs` — builds `sample-submissions.json`, the disposable
  test data for `admin.html` and its dashboard.

  ```bash
  node dev/make-sample.mjs
  ```

  A readable table of people sits at the top of the file. Each row is
  put through the real `validate()` and built by the real
  `buildRecord()`, then sealed by the real `crypto.js` to
  `test-key.json`'s public half — so the sample cannot drift from what
  the form actually produces, and the script refuses to write a file
  containing anything the form would have rejected. The one row that is
  *meant* to be impossible is marked `expect: "invalid"` in the table.

  **This is the opposite of `fixture.json`, and confusing the two would
  be bad:**

  | | `fixture.json` | `sample-submissions.json` |
  | --- | --- | --- |
  | Purpose | proves the wire format still decrypts | disposable test data |
  | Regenerate it? | **never** — see the warning above | yes, freely |

  It is committed so a fresh clone can skip straight to the snippet
  below, and every run produces different bytes — the ephemeral key and
  the nonce are fresh per row by design. Regenerate it whenever the
  record shape changes.

- `sample-submissions.json` — 18 rows shaped exactly like the Worker's
  `GET /export` reply, so it drops into `admin.html` with no
  translation. Seventeen open with `test-key.json`; one is sealed to a
  keypair the script generates and throws away.

  Each row earns its place by reaching a branch that is otherwise only
  reachable by luck: three people with **several entries each** (the
  weight-over-time chart draws nobody with a single entry, and one of
  them loses weight rather than gaining), a **height that changes
  between entries** for the data-quality panel, a row with **every
  optional field blank**, **both unit systems** including an imperial
  entry with the inches box empty, a handle beginning `=` for the CSV
  formula guard, the **top and bottom of every validation range**, and
  the **row nothing can open** — the rotated-key case, which is the one
  most likely to be wrong on the day it matters.

### Loading the sample into `admin.html`

Serve the **repository root**, the way `crypto-browser-check.html`
already needs, so the sample is reachable over HTTP alongside the site:

```bash
python -m http.server 8124 --directory .
```

The site is then at <http://localhost:8124/apps/web/admin.html>. Open
the browser console there and paste this **before** pressing Fetch and
decrypt:

```js
const sample = await (await fetch("/dev/sample-submissions.json")).json();
window.fetch = async () => new Response(JSON.stringify(sample),
  { headers: { "Content-Type": "application/json" } });
```

Serving `apps/web` on its own works too — that is the normal way to
preview the site — but `dev/` is then outside the document root, so
paste the file's contents instead of fetching it:

```js
const sample = { /* paste dev/sample-submissions.json here */ };
window.fetch = async () => new Response(JSON.stringify(sample),
  { headers: { "Content-Type": "application/json" } });
```

Either way, put anything at all in the token box — the stub never looks
at it — and load `test-key.json` with the file picker. The page should
report 17 of 18 rows decrypted, list row 16 under "Rows that would not
open", and draw the dashboard with `roundrobin_ok` named in the height
panel.

### Exercising the publish path without publishing

The stub above catches every `fetch`, including the one behind the
Publish button, so pressing it locally sends nothing anywhere. To see
what it *would* send, press **Show what would be sent** instead — that
touches no network at all and prints the snapshot.

To watch the request itself, keep a copy of what the stub was handed:

```js
window.__sent = [];
window.fetch = async (url, opts) => {
  if (String(url).endsWith("/snapshot")) {
    window.__sent.push(JSON.parse(opts.body));
    return new Response('{"ok":true}',
      { headers: { "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify(sample),
    { headers: { "Content-Type": "application/json" } });
};
```

The check worth making on `window.__sent[0]` is the one the whole
feature turns on — that no handle is anywhere in it:

```js
JSON.stringify(window.__sent[0]).includes("roundrobin_ok")   // false
```

`dev/dashboard.test.mjs` asserts the same thing without a browser, and
that is the version CI runs. This one is for looking at.

**There is deliberately no `?sample=` hook, and there must not be one.**
`apps/web` is published verbatim, so a code path that loads fake data
into the export page is a code path that ships to the live site. The
stub lives in a console, where it cannot be deployed by accident.

- `test-key.json` — the throwaway keypair all of these use, in the same
  envelope `tools/keygen.html` writes.

The test keypair here is a throwaway generated for testing and is
committed on purpose. It protects nothing and opens nothing real. The
real private key never enters this repository — see
[../DESIGN.md](../DESIGN.md).
