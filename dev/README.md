# dev/

Test harness and scratch verification. **Never published** — the deploy
copies `apps/web` and nothing else. Run everything at once with
`./run check`; run one suite with `node dev/<name>.test.mjs`. Every
suite loads the shipped file's real bytes (the pure/DOM split in
`AGENTS.md` is what makes that possible), and every suite is registered
in both `tools/check.py` and CI — two lists, edited together.

| Suite | What it proves |
| --- | --- |
| `crypto.test.mjs` | round trips, and the **committed v1 fixture still decrypts** — the one check standing between a format change and an unreadable database |
| `form.test.mjs` | conversions, validation, the record — a wrong factor writes a plausible number into a blob with no original to compare against |
| `form-wiring.test.mjs` | the DOM half of `form.js`, including Add entry restoring the form after a submission (#64 lived in this gap) |
| `submit.test.mjs` | panel counts come from `GET /me` and nowhere else; a refused send stores and claims nothing; prefill scoping (#56) |
| `admin.test.mjs` | CSV quoting and the spreadsheet-formula guard — a quoting bug opens cleanly and is quietly wrong |
| `admin-session.test.mjs` | the admin page runs on a session, no token box; deletion proved against a published snapshot, not the DOM |
| `xlsx.test.mjs` | the hand-built ZIP opens at all — it ends with a reader that re-checks every CRC |
| `dashboard.test.mjs` | aggregation, suppression floor, quantization — including that a published point is ambiguous rather than a join key |
| `public.test.mjs` | signed-out, refused-session and nothing-published states stay distinct on the member dashboard |
| `ui.test.mjs` | shared DOM wiring, and that `ui.js` contains no `fetch` or POST |
| `session.test.mjs` | tab-scoped sessions, expiry, the auth POST/store/redirect handoff |
| `worker.test.mjs` | routing, validation, CORS, sign-in, the gating matrix — and that `POST /auth/dev` **fails closed**, the one place a silent pass is itself the compromise |
| `check_web.test.py` | `check_web.py`'s own CSP parser — a checker that cannot read is indistinguishable from a site with nothing wrong (#34) |
| `check_server.test.py` | `check_server.py`'s vars parser and rules, including that its key pattern still matches real key material |

## Two fixtures, opposite rules

| | `fixture.json` + the account-id fixture | `sample-submissions.json` |
| --- | --- | --- |
| Purpose | prove the stored formats still read | disposable test data for `admin.html` |
| Regenerate? | **never** — a failure means stored rows are at stake; add a version byte and a decoder for both | yes, freely, via `make-sample.mjs` |

> `make-sample.mjs` is **broken on `accounts`** (#66): `buildRecord`
> gained a third argument and this caller still passes two. The
> committed sample predates the change and still loads.

`test-key.json` is a throwaway keypair, committed on purpose; it opens
nothing real. The real keypairs and their custody: `OPERATIONS.md`,
"The keys".

## Browser-side checks

`crypto-browser-check.html` repeats the platform-dependent crypto
checks in a real browser under the published CSP — Node is the same
specification but not what a submitter uses. Serve the **repository
root** so the page reaches the real shipped files:

```bash
./run serve-root
```

then <http://127.0.0.1:8124/dev/crypto-browser-check.html>.

To load the sample into `admin.html` (served the same way, at
`/apps/web/admin.html`), paste in the console **before** fetching:

```js
const sample = await (await fetch("/dev/sample-submissions.json")).json();
window.fetch = async () => new Response(JSON.stringify(sample),
  { headers: { "Content-Type": "application/json" } });
```

then load `test-key.json` in the key picker. Expect 17 of 18 rows to
decrypt and row 16 listed as unopenable — the rotated-key case. The
stub catches the Publish request too, so nothing can leave the page;
**there is deliberately no `?sample=` hook and there must not be one**,
because `apps/web` ships verbatim and a console cannot be deployed by
accident.
