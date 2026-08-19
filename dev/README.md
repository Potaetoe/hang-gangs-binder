# dev/

**Read this before touching a suite here or driving the demo.** Test
harness, fixtures and the drivable demo. **Never published** — the
deploy copies `dist/`, and nothing under here is in it or reachable
from it.

**This apparatus is transitional and no 0.9 work goes in it.** The
runner, the conventions and the CI wiring are being rebuilt at
0.9-M0-S4 (#281) with `tests/` as their home; what is here guards the
surfaces that still exist and retires arm by arm, each one leaving in
the same pull request as the rebuild slice that removes its surface.
Re-using anything from here in the new apparatus takes a stated
justification. Everything below describes what still runs, not a
pattern to copy.

Run the lot with `./run check`. Run one suite directly:
`node dev/<name>.test.mjs` for the suites that drive the shipped
scripts, `py -3 dev/<name>.test.py` for the ones that check a checker.
Every suite loads the shipped file's real bytes — the pure/DOM split in
`AGENTS.md` is what makes that possible — and every one opens with a
header saying what it proves and why it is a file of its own rather
than rows in its neighbor.

**There is no list of the suites here, and adding one back is the
mistake this paragraph exists to prevent (#206).** There were three
rosters: `NODE_SUITES` in `tools/check.py`, this directory itself, and
a table in this file. #204 taught the gate to hold the first two
against each other in both directions — a suite that arrives with no
line fails, and a line whose file left fails too. The table was
compared against nothing, and by the time anybody measured it, it was
short by more suites than a reader would guess from how complete it
looked. A roster nothing checks is worse than no roster, because it
reads like one that is checked.

So `tools/check.py` is the roster, and since #227 it is one for both
languages: `NODE_SUITES` names the Node suites and carries the reason
each is a separate stage, `PYTHON_SUITES` names the ones that check a
checker, and each is held against this directory in both directions.
The Python stages are written by hand beside the checker each one
guards, so `PYTHON_SUITES` is held against `main()` as well, or it
could name a stage nobody runs. What actually ran is the stage table
the gate prints, which is the one roster that cannot go stale.

`harness.mjs` holds the `check`/`report` pair and the assertion that
the number of checks a run performed is the number the suite says it
has — so a check that stops running goes red instead of vanishing
under a confident summary.

## Two kinds of fixture, opposite rules

| | the stored-format fixtures | `sample-submissions.json` |
| --- | --- | --- |
| Purpose | prove the stored format still reads | disposable test data for a page |
| Regenerate? | **never** — a failure means stored rows are at stake; add a version byte and a decoder for all of them | yes, freely, via `make-sample.mjs` |

> Regenerating rewrites every stored blob even when nothing changed, so
> the diff says nothing about whether the records moved. Regenerate
> when the record shape changes, and say in the commit what moved.

**The gate runs `make-sample.mjs` on every pass**, to a scratch path
outside the checkout — `node dev/make-sample.mjs [output path]`, and
`make-sample.test.mjs` is what passes one. So a change that breaks the
generator goes red instead of waiting to be noticed, the committed
sample is never rewritten by a check, and regenerating it stays a
decision somebody makes.

That stage also holds the property above: a fresh run reproduces every
record — same ids, same account ids, same receipt times — and rewrites
every blob. It fails when the table and the committed sample come
apart, which is the change that has to regenerate.

*Until 0.9-M1 lands* the stored format is the pre-0.9 sealed one, and
the committed throwaway keypairs here exist to open it. They protect
nothing real. The rule above outlives them: 0.9's at-rest format gets
its own fixture on the same terms — see `DESIGN.md`, "Encryption".

## Browser-side checks

`crypto-browser-check.html` repeats the platform-dependent checks in a
real browser under the published CSP — Node is the same specification
but not what a member uses. Serve the **repository root** so the page
reaches the real shipped files:

```bash
./run serve-root
```

then <http://127.0.0.1:8124/dev/crypto-browser-check.html>.

## The drivable demo

The demonstration the owner drives, built on #272 as **the site with a
toolbar**:

```bash
./run demo
```

then the port the banner names. `--port N` moves it, which is what a
parallel agent session's preview block uses — and a **positional**
argument is silently ignored, so read the banner rather than assuming.

The root lands on the sign-in page, and from there **the demo is the
site**: shipped pages at real paths, laid out against the real window,
driven the way a visitor drives them. There is no console beside it, no
frame around it and no glass over it — resize the browser to see the
narrow layout, and use the product's own rail to move around.

What rides above the page is one slim strip: the word *Demo*, a line
saying nothing here is real, and **only the controls a visitor could
not produce for themselves**. That test is the whole design of it.
Everything a visitor *can* do is left to the product. `demo-stub.js`
holds the table and `demo.test.mjs` drives every control in both
directions: the press that acts, and the press that cannot act on this
page and says so.

The sign-in page's own button offers the same list of identities, which
is the second door the owner asked for. It stands in for the widget's
account chooser, so what happens after the press is the product's own
sign-in, watched.

Nothing reaches a real endpoint: `demo-boot.js` replaces `fetch` before
any shipped script runs and refuses any URL it has no answer for. The
strip's own reader is a **second, separate** allowlist on a global the
product has no name for.

The clock the strip moves is `Date.now` and only `Date.now`. The idle
timer reads the clock rather than counting intervals, which is right
and also why it cannot be watched; the jump is computed from the page's
own window at press time, so the demo cannot drift from the numbers
that page really measures. `new Date()` is left alone, or every
rendered date would move with it.

The pages come from a mirror at `/demo/`, read out of `apps/web` on
every request — so a page a slice changes is a page the demo shows
changed, with no work here. **`apps/web` still takes no hook, and the
mirrored pages are the shipped bytes.** The mirror applies a small
fixed set of edits on the way out, every one listed in `demo-stub.js`.
Anchors are not among them — the demo is the whole window rather than a
page in a frame, so a link that leaves the product is left to leave.
`demo.test.mjs` fails if a mirrored page differs from the shipped one
in any other way, pins the edit table by name, and fails on a declared
edit that has stopped applying to any page. That first arm rebuilds the
mirrored page from the shipped bytes with the edits written out in the
suite, rather than undoing the mirror and comparing — undoing it is
computed from the same file, so an edit applied and unapplied by the
same pair passes it while never appearing on the table.

Which Worker routes the stub must answer is derived rather than stated
— read out of `apps/web`, so a route a later slice adds fails the gate
rather than the walk-through.

The offline arm is not the only one. `./run serve` against the
development Worker is the live end-to-end feel; what the offline arm
adds is the states a live database cannot be asked for on demand — a
revoked session, a corrected entry, a cell under the floor.

*The demo rebuilds to the 0.9 surface set at 0.9-M4*, with full parity
across every page including Members and Settings, and a picker of
exactly Member and Admin. Its suites are apparatus too and are presumed
new at that milestone; an individual arm carries over only with a
stated justification. Until then it drives the pre-0.9 site.

## Hosting the demo off this machine

`./run bake` writes that same demo to `_demo/` as ordinary static files
— the mirror's output at real paths, the strip, the stub and the
fabricated sample. Serve that directory with anything at all and open
its root, exactly as you drive the local one. `demo-corpus.js` rides
along too (`demo-bake.mjs` still names it among the demo's own files),
but it answers "not available" rather than building anything: the
snapshot route it used to simulate is deleted, not gated, on the real
Worker (0.9-M2-S3, #354), and the strip's own "data" group says as
much in one line where the presets used to be. The 0.9-M4 demo rebuild
decides what, if anything, replaces it.
`--out PATH` writes somewhere else; the directory is generated on
demand and never committed.

**It writes files and does nothing else.** No upload, no wrangler, no
deploy — where a build lands is a separate act with its own approval,
and this is not it.

Three things the bake refuses or must do. It refuses a tree with
uncommitted changes, because the stamp's whole value is that somebody
can check out the named commit and get these bytes back. It refuses any
source that is neither under `apps/web` nor on the list of demo files
named in `demo-bake.mjs` — an allowlist by filename rather than a
pattern over `dev/`, because `dev/` also holds the stored-format
fixtures, every suite, and whatever the next slice puts here, and
nobody re-reads a pattern before it publishes something. And it
**clears its output directory before writing**: a bake that did not
left six stale files in a published build on 2026-08-13.

**No page from `apps/web` is written anywhere but `/demo/`.** That is
the rule with no exceptions: `demo-boot.js` is what replaces `fetch`,
it arrives only through the mirror, and a page without it is a live
copy of the product on a public URL calling whatever `config.js`
resolves to. The bake re-reads the bytes it is about to write and
refuses any page that does not undo back to the shipped file exactly.
The pages outside `/demo/` are the build's own root, which loads
nothing from `apps/web` and redirects to the mirrored sign-in page, and
a root `404.html` so an unknown path stops serving the fold.

Hosting is why the configuration edit exists at all, and
`demo-stub.js` explains it beside the others: `config.js` chooses by
`location.hostname` and knows the published site and localhost, so
anywhere else it hands back no endpoint — which also turns the
endpoint plus a path into a relative URL aimed at whichever host is
serving. The stand-in points at a reserved name that resolves nowhere,
so the one case that reaches the network is the case where the demo
already failed.

What is deliberately not in a build: no real endpoint, no real row, no
secret, and nothing from `dev/` but the demo's own files. The corpus is
fabricated by the shipped code from made-up people. The root page says
so, every page keeps the `noindex` it ships with, and `apps/web`'s own
`robots.txt` is emitted at the root where a crawler reads it.

A build is a **snapshot** and says which commit it was taken at, as
metadata on that root page rather than as copy on anybody's screen. The
local demo cannot go stale because it re-reads `apps/web` per request;
a hosted copy is stale the moment the next slice merges, so re-bake on
each merge wave or on demand.
