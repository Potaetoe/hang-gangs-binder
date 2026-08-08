# Hang Gang's Binder

A submission portal for the Hang Gang. People enter their stats; one
person — whoever holds the key — can export them.

**Submitters need no account** — today. That is changing; see the status
note below. Open the page, fill the form, done.

**Submissions are encrypted in your browser before they are sent.** The
service that stores them cannot read them. Only someone holding the
project's private key can, and that key is not stored online anywhere.

> **Status: open.** The form, the storage endpoint and the export tool
> are built, deployed and verified end to end against the live site.
> The keypair exists — the public half is published, the private half is
> held offline. There is also a [public
> dashboard](https://potaetoe.github.io/hang-gangs-binder/dashboard.html)
> showing what the submissions add up to, with nobody's name in it. See
> [DESIGN.md](DESIGN.md) for how it all fits together and why.
>
> **Changing, and now fully built.** An accounts redesign was decided on
> 2026-08-05: members sign in with Telegram before submitting, entries
> are tied to an account so they can be updated and removed, and the
> dashboard moves behind a sign-in.
>
> As of 2026-08-07 **every build step of it is done** — the sign-in page,
> the member panel, the session gates on the dashboard and the export,
> row deletion, and the checks that guard all of it. None of it is
> **deployed**.
>
> **What a visitor sees today is unchanged**, and that is the point of the
> arrangement rather than a delay in it: the live site is the last
> complete release, and the redesign lands in one cutover instead of
> arriving in ten half-states, several of which refuse everybody by
> design.
>
> The step-by-step is [CUTOVER.md](CUTOVER.md), the reasoning behind its
> order is [REDESIGN.md](REDESIGN.md) Part 8, and the design is
> [DESIGN.md](DESIGN.md) under "Accounts". The cutover has a real outage
> in it — the schema migration takes production submissions down before
> either deploy — so it is a sitting, not a push.

---

## What gets collected

Required: **Telegram username**, **weight**, **height**, and a
confirmation that you are 18 or older.

After the cutover the username is **not typed** — it comes from the
Telegram sign-in, and the field is gone from the form rather than hidden or
made read-only. That closes a gap rather than tidying one: while it was
typed, a signed-in member could enter somebody else's handle and have it
stored beside their own account id, which is a row whose identity and
label disagree.

Optional: gender, which roles you take in the kink (feeder, feedee,
gainer, fat admirer), and your country.

Weight and height can be entered in either pounds and inches or
kilograms and centimetres — there is a toggle, and it starts on
imperial. Whichever you use, both are stored, along with exactly what
you typed.

## What is public

The [dashboard](https://potaetoe.github.io/hang-gangs-binder/dashboard.html)
shows totals: how many people, the middle weight and height, and how
the answers are spread. It has no Telegram handles in it and no
individual entries — only counts, medians and distributions, worked out
before anything is published. It updates when the keyholder publishes,
and it says on the page how old the figures are.

Nothing else is public. The submissions themselves are ciphertext that
only the private key opens.

## Running it locally

No build step and no dependencies. Serve `apps/web` and open it:

```bash
python -m http.server 8124 --directory apps/web
```

Then visit <http://127.0.0.1:8124> — that address rather than
`localhost`, because `http.server` binds IPv4 only and a browser tries
`localhost` as IPv6 first, paying a failed-connect delay on every request
that makes the site read as slow (#72).

Serving it matters — opening `index.html` as a `file://` URL breaks the
crypto APIs the form depends on, because they require a secure context.
`http://localhost` counts as one; a bare file path does not.

**Use port 8124.** `config.js` selects an environment by hostname and the
Worker's allowed origins name that port; another port fails CORS quietly,
which looks like the endpoint being down.

**A local preview talks to the development Worker and database, not
production** — `config.js` maps `localhost` and `127.0.0.1` to
`hgbinderworker-dev` with its own D1 and its own key. That is the opposite
of what it used to do, and it is the reason this section is safe to follow
at all: before the development environment existed, running the site
locally wrote rows into the live database. An unknown hostname gets **no**
endpoint and no key rather than falling back to production, so a preview
served from anywhere else refuses to submit instead of guessing.

**Telegram sign-in cannot work on localhost.** BotFather binds the widget
to `potaetoe.github.io`, so the widget renders "Bot domain invalid" on any
other host — that is configuration, not a bug, and it cannot be tested
locally. Local work signs in through `POST /auth/dev` instead, which
exists only when `DEV_LOGIN_SECRET` is set on the development Worker and
only from a loopback origin. Its absence is what turns the route off, and
it must never be set on production. Every page shows a banner while a
development session is in use, because a development session that looks
real is worse than none.

## Generating the key

Whoever holds the key runs this themselves, on their own machine. It is
not part of the site and is never published.

```bash
python -m http.server 8125 --directory tools
```

Then visit <http://127.0.0.1:8125/keygen.html>. It hands back two
things: a `publicKey` line to paste into
[apps/web/config.js](apps/web/config.js) and commit, and a key file to
save somewhere safe and **never** commit. It verifies the two halves
agree before showing you either.

Serve it — do not open it from disk. Browsers disagree about whether a
`file://` URL gets the cryptography this needs, and a page that lacks it
looks exactly like a working one until it quietly produces nothing.

**There is no recovery from losing the key file.** Every submission is
encrypted to it. Make the second copy the day you make the first.

## Checking a key you already have

Two different questions, and the second is the one that matters:

- **Which key is this?** There is a production key, a development key
  and a committed throwaway. They look alike and are easy to mix up.
- **Does it still work?** Matching a public key proves identity.
  Decrypting a real row proves function.

```bash
python -m http.server 8124 --directory .
```

Then <http://127.0.0.1:8124/tools/keycheck.html>. Drop the key file in
and it names the key; paste a `ciphertext` value from the database and
it tells you whether that key opens it.

Serve the **repository root**, not `tools/` — the page uses the real
`apps/web/crypto.js` rather than its own copy, so that a checker cannot
agree with itself while disagreeing with the site.

**Nothing leaves the page.** Its `connect-src` allows this origin only.
There is a **Self-test** button that decrypts the committed fixture with
the committed throwaway key: if that fails, the tool is broken rather
than your key, and its other answers should be ignored.

## Repository layout

```
apps/web/          the published site — this directory IS the build
server/            the Cloudflare Worker and its database schema,
                   deployed by hand and never touched by CI
tools/             checks and the key generator; never published
dev/               test harness; never published
```

`apps/web` is copied verbatim to GitHub Pages. Nothing is stripped, so
nothing can fail to be stripped — anything that should not be public
simply does not live in that directory.

## Configuration

[apps/web/config.js](apps/web/config.js) is the one file a fork or a new
owner needs to change: the endpoint it posts to, and the public key it
encrypts to. Both values are public by design.

Changing the endpoint means changing it in **two** places — `config.js`
and the `connect-src` of every page that loads it. Do one without the
other and the site still loads, still looks correct, and silently drops
every submission at the browser's security check. `tools/check_web.py`
fails the build rather than letting that ship.

## Deploying

A push to `main` is a release. `.github/workflows/deploy.yml` runs the
checks and, if they pass, publishes `apps/web`.

**While the accounts redesign is being built, work goes to the
`accounts` branch, not to `main`.** Its steps are a chain, and the
states in the middle of it are broken on purpose — a sign-in page
exists several steps before the widget that signs anybody in. `main`
stays at the last state worth serving until the chain is finished, so
what is live is always complete. The branch publishes nothing: the
deploy job names `refs/heads/main` and only that. See `REDESIGN.md` for
the build order and `DESIGN.md`, "What is deliberately not here", for
why this is not a staging branch.

### `main` is frozen, and how to fix production anyway

That leaves one thing this file has to answer, because the moment it is
needed is the worst moment to work it out:

**If something is wrong with the live site right now, do this.**

1. Branch from `main`, not from `accounts`:

   ```bash
   git fetch origin && git checkout -b hotfix-<what> origin/main
   ```

2. Make the **smallest change that fixes the thing**. Not the correct
   change, not the tidy one — the smallest. Everything else waits for
   `accounts`.

3. Run the gate, and confirm what you are about to publish:

   ```bash
   python tools/check.py
   git diff --stat origin/main -- apps/web
   ```

   The second command is the one that matters. It lists exactly what
   changes on the live site, and it should be short enough to read.

4. Open a pull request against `main` so CI runs **before** the merge,
   then merge it. Merging is the release.

5. Carry it forward so it is not lost at cutover:

   ```bash
   git checkout accounts && git cherry-pick <the merge commit>
   ```

6. Confirm the live site actually changed — the deploy reporting success
   is not the same as the change being served:

   ```bash
   curl -sI https://potaetoe.github.io/hang-gangs-binder/ | grep -i last-modified
   ```

**Owner present.** This is a live release, the same category as clearing
the table or deploying the Worker, and it is not something an agent does
alone.

**Step 5 is the one that gets skipped.** A fix that lands on `main` and
never reaches `accounts` is a fix that disappears the day the redesign
merges, and nothing reports it — `accounts` will simply overwrite it
with the older code and every check will pass.

There is no staging environment, so **verify locally before pushing** —
open the site as above, and run the same checks CI will run:

```bash
python tools/check_web.py
```

It confirms every link resolves, that each page carries the shared head
(including its content security policy), and that nothing key-shaped is
sitting in the directory that gets published.

Run the Node checks too — they need Node, and nothing else:

```bash
node dev/crypto.test.mjs
```

That one proves a submission encrypted today can still be decrypted, and
that a ciphertext stored earlier can still be read. If it fails, stop:
the data is what breaks.

If you touched `apps/web/crypto.js`, run it in a browser too — Node is
the same specification but not what a submitter uses. Serve the
repository root and open
<http://127.0.0.1:8124/dev/crypto-browser-check.html>; see
[dev/README.md](dev/README.md).

If you changed the endpoint or the Worker:

```bash
node dev/worker.test.mjs
```

## Security

The short version: your data is encrypted in your browser using a public
key, and can only be read by whoever holds the matching private key.
Losing that key makes the data permanently unreadable — there is no
recovery, by design.

The long version, including what this does and does not protect against,
is in [DESIGN.md](DESIGN.md).

## Handing it on

This project is built to be transferable — the data, the storage and the
site move independently, and none of it requires sharing an account. The
checklist is in [HANDOFF.md](HANDOFF.md).

## License

MIT — see [LICENSE](LICENSE).
