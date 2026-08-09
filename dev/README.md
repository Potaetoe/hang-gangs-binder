# dev/

Test harness and scratch verification. **Never published** — the deploy
copies `apps/web` and nothing else. Run everything at once with
`./run check`; run one suite with `node dev/<name>.test.mjs`. Every
suite loads the shipped file's real bytes (the pure/DOM split in
`AGENTS.md` is what makes that possible), and every suite is registered
in `tools/check.py` — the single registry, whose printed stage table is
the roster; CI runs that same gate as one step. The table below maps
what each suite defends, not where it is registered.

`harness.mjs` holds the `check`/`report` pair and the assertion that the
number of checks a run performed is the number the suite says it has —
so a check that stops running goes red instead of vanishing under a
confident summary. A suite adopting it keeps its own stubs, fixtures and
labels, and passes its own count; the header of that file explains the
two ways a check may be written and why both are still accepted.

| Suite | What it proves |
| --- | --- |
| `crypto.test.mjs` | round trips for both stored formats, and the **committed fixtures still decrypt** — the one check standing between a format change and an unreadable database. The v2 fixture is asserted twice, once per recipient, because a change that locks one of the two out passes every round trip |
| `form.test.mjs` | conversions, validation, the record — a wrong factor writes a plausible number into a blob with no original to compare against |
| `form-wiring.test.mjs` | the DOM half of `form.js`, including New entry restoring the form after a submission (#64 lived in this gap) |
| `submit.test.mjs` | panel counts come from `GET /me` and nowhere else; a refused send stores and claims nothing; prefill scoping (#56) |
| `admin.test.mjs` | CSV quoting and the spreadsheet-formula guard — a quoting bug opens cleanly and is quietly wrong |
| `admin-session.test.mjs` | the admin page runs on a session, no token box; deletion proved against a published snapshot, not the DOM |
| `xlsx.test.mjs` | the hand-built ZIP opens at all — it ends with a reader that re-checks every CRC |
| `dashboard.test.mjs` | aggregation, suppression floor, quantization — including that a published point is ambiguous rather than a join key |
| `dashboard-render.test.mjs` | what the same file **draws**, which the row above cannot reach: it loads `dashboard.js` with no `document`, and the drawing half is behind that guard. Asserts the tree, not the call — the panel order, the classes `theme.css` styles against, the `MIN_CELL`-suppressed states, and that no handle survives into a published rendering |
| `public.test.mjs` | signed-out, refused-session and nothing-published states stay distinct on the member dashboard |
| `ui.test.mjs` | shared DOM wiring, and that `ui.js` contains no `fetch` or POST |
| `session.test.mjs` | tab-scoped sessions, expiry, the auth POST/store/redirect handoff |
| `worker.test.mjs` | routing, validation, CORS, sign-in, the gating matrix — and that `POST /auth/dev` **fails closed**, the one place a silent pass is itself the compromise |
| `check_web.test.py` | `check_web.py`'s own CSP parser — a checker that cannot read is indistinguishable from a site with nothing wrong (#34) |
| `check_server.test.py` | `check_server.py`'s vars parser and rules, including that its key pattern still matches real key material |
| `make-sample.test.mjs` | `make-sample.mjs` still runs and still writes what its summary claims — the generator loads the shipped `form.js` and `crypto.js`, and nothing else here exercises it (#66) |
| `demo.test.mjs` | the drivable demo cannot drift. Undoing the mirror's declared edits returns the shipped page byte for byte, every Worker path `apps/web` calls has an answer in the stub, and `apps/web` names nothing under `dev/`. It binds a socket and drives the real mirror |
| `demo-bake.test.mjs` | the **emitted set** of a hosted build, which is a different failure from drift: no `apps/web` page written outside `/demo/` (a page with no `fetch` replacement on it is the product, live, on a public URL), no source off the allowlist, and a stamp that names the commit and refuses a dirty tree |

## Two kinds of fixture, opposite rules

| | `fixture.json`, `fixture-v2.json` + the account-id fixture | `sample-submissions.json` |
| --- | --- | --- |
| Purpose | prove the stored formats still read | disposable test data for `admin.html` |
| Regenerate? | **never** — a failure means stored rows are at stake; add a version byte and a decoder for all of them | yes, freely, via `make-sample.mjs` |

> Regenerating rewrites every ciphertext even when nothing changed —
> each row gets a fresh ephemeral key, by design — so the diff says
> nothing about whether the records moved. Regenerate when the record
> shape changes, and say in the commit what moved.

**The gate runs `make-sample.mjs` on every pass**, to a scratch path
outside the checkout — `node dev/make-sample.mjs [output path]`, and
`make-sample.test.mjs` is what passes one. So a change to `form.js`'s
pure half or `crypto.js` that breaks the generator goes red instead of
waiting to be noticed, the committed sample is never rewritten by a
check, and regenerating it stays a decision somebody makes.

That stage also holds the property above: a fresh run reproduces every
record — same ids, same account ids, same `received_at` — and rewrites
every blob. It fails when the table and the committed sample come
apart, which is the change that has to regenerate.

`test-key.json` and `test-member-key.json` are throwaway keypairs,
committed on purpose; they open nothing real. The first stands in for
the keyholder and the second for a member's own device key, which is
what a version 2 row's two recipients are. The real keypairs and their
custody: `OPERATIONS.md`, "The keys".

## Browser-side checks

`crypto-browser-check.html` repeats the platform-dependent crypto
checks in a real browser under the published CSP — Node is the same
specification but not what a submitter uses. Both stored formats are
checked there, because a member reads their own history in a browser
and the keyholder exports from one. Serve the **repository root** so
the page reaches the real shipped files:

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

## The drivable demo

The same idea, made walkable end to end for #122 — the demonstration the
owner drives before the cutover:

```bash
./run demo
```

then <http://127.0.0.1:8126/dev/demo.html>. `--port N` moves it, which is
what a parallel agent session's preview block uses; the committed port is
what `UAT.md` cites.

Pick a scenario, and the console stages the session, the prefill and the
published corpus that scenario needs, then puts a **shipped page** in the
frame. Nothing reaches a real endpoint: `demo-boot.js` replaces `fetch`
before any shipped script runs and refuses any URL it has no answer for,
and the only keys anywhere near it are the throwaway pairs above.

The pages come from a mirror at `/demo/`, read out of `apps/web` on every
request — so a page PR 4 or PR 5 changes is a page the demo shows changed,
with no work here. **`apps/web` still takes no hook.** The mirror applies
three edits on the way out, every one listed in `demo-stub.js` and
rendered by the console so nobody has to take that on trust: it adds the
two dev scripts ahead of the page's own, it points the Telegram widget
at a local stand-in, and it points `config.js` at a stand-in naming an
address that cannot resolve. `demo.test.mjs` fails if a mirrored page
differs from the shipped one in any other way, and pins the table at
those three by name.

Over the frame is a **frame size**, and the phone one narrows the frame
to the CSS pixel size `demo-stub.js` names. An iframe's width is the
viewport the page inside it lays out against, so the shipped pages run
their own phone rules in it — the rail as a strip, its destinations still
in flow — which is what makes `UAT.md`'s phone-width steps
drivable here rather than by narrowing the window. The Theme control is
not one of those rules: it is one disclosure at every width, so it is
there in both. It is a width and
nothing else: the console stays a desktop tool, no touch, user agent or
pixel ratio is emulated, and `apps/web` is not touched to make it work.

Two things the console derives rather than states, because both would go
stale the week they were written: which acceptance box is drivable yet
(read out of the shipped bytes, so a box flips when its slice lands), and
which Worker routes the stub must answer (read out of `apps/web`, so a
route a later slice adds fails the gate rather than the walk-through).

The offline arm is not the only one. `./run serve` against the dev Worker
is the live end-to-end feel, and the console names it; what the offline
arm adds is the states a live database cannot be asked for on demand — a
revoked session, a corrected entry, a cell under the floor.

## Hosting the demo off this machine

`./run bake` writes that same demo to `_demo/` as ordinary static files
— the mirror's output at real paths, the console, the stub, the corpus
builder and the fabricated sample. Serve that directory with anything at
all and drive `/dev/demo.html` exactly as you drive the local one.
`--out PATH` writes somewhere else; the directory is generated on demand
and never committed.

**It writes files and does nothing else.** No upload, no wrangler, no
deploy — where a build lands is a separate act with its own approval,
and this is not it.

Two things the bake refuses. A tree with uncommitted changes, because
the stamp's whole value is that somebody can check out the named commit
and get these bytes back, and a stamp naming a commit that is not what
was baked is worse than no stamp. And any source that is neither under
`apps/web` nor on the list of demo files named in `demo-bake.mjs` — an
allowlist by filename rather than a pattern over `dev/`, because `dev/`
also holds both stored-format fixtures, every suite, and whatever the
next slice puts here, and nobody re-reads a pattern before it publishes
something.

**No page from `apps/web` is written anywhere but `/demo/`.** That is
the rule with no exceptions: `demo-boot.js` is what replaces `fetch`, it
arrives only through the mirror, and a page without it is a live copy of
the product on a public URL calling whatever `config.js` resolves to.
The bake re-reads the bytes it is about to write and refuses any page
that does not undo back to the shipped file exactly. The two pages
outside `/demo/` — the console and a landing page — load nothing from
`apps/web` at all.

Hosting adds a third mirror edit, and `demo-stub.js` explains it beside
the other two: `config.js` chooses by `location.hostname` and knows the
published site and localhost, so anywhere else it hands back a null key
and no endpoint — which also turns `config.endpoint + "/me"` into the
relative URL `undefined/me`, aimed at whichever host is serving. The
stand-in seals to the same throwaway development key and points at a
reserved name that resolves nowhere, so the one case that reaches the
network is the case where the demo already failed.

What is deliberately not in a build: no private key, no real endpoint,
no real row, no secret, and nothing from `dev/` but the demo's own files
and the throwaway pairs above. The corpus is fabricated by the shipped
code from made-up people. The landing page says so, every page keeps the
`noindex` it ships with, and `apps/web`'s own `robots.txt` is emitted at
the root where a crawler reads it.

A build is a **snapshot** and says which commit it was taken at, on the
console and on the landing page. The local demo cannot go stale because
it re-reads `apps/web` per request; a hosted copy is stale the moment
the next slice merges, so re-bake on each merge wave or on demand.
