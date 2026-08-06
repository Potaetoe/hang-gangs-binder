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
> **Changing, and partly built.** An accounts redesign was decided on
> 2026-08-05: members sign in with Telegram before submitting, entries
> are tied to an account so they can be updated and removed, and the
> dashboard moves behind a sign-in.
>
> The Worker for it is **written and tested but not deployed** — the
> live endpoint is still the open one described below, and
> [server/README.md](server/README.md) explains why deploying it before
> the pages catch up would break the form. Everything a visitor sees is
> unchanged. The reasoning is in [DESIGN.md](DESIGN.md) under
> "Accounts", and the build plan in [REDESIGN.md](REDESIGN.md).

---

## What gets collected

Required: **Telegram username**, **weight**, **height**, and a
confirmation that you are 18 or older.

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

Then visit <http://localhost:8124>.

Serving it matters — opening `index.html` as a `file://` URL breaks the
crypto APIs the form depends on, because they require a secure context.
`http://localhost` counts as one; a bare file path does not.

## Generating the key

Whoever holds the key runs this themselves, on their own machine. It is
not part of the site and is never published.

```bash
python -m http.server 8125 --directory tools
```

Then visit <http://localhost:8125/keygen.html>. It hands back two
things: a `publicKey` line to paste into
[apps/web/config.js](apps/web/config.js) and commit, and a key file to
save somewhere safe and **never** commit. It verifies the two halves
agree before showing you either.

Serve it — do not open it from disk. Browsers disagree about whether a
`file://` URL gets the cryptography this needs, and a page that lacks it
looks exactly like a working one until it quietly produces nothing.

**There is no recovery from losing the key file.** Every submission is
encrypted to it. Make the second copy the day you make the first.

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

### `main` is frozen, and how to fix production anyway

**Ordinary work does not go to `main` right now.** The accounts redesign
is a chain of steps whose intermediate states are broken on purpose — a
sign-in page exists several steps before the widget that signs anybody
in — so they accumulate on the `accounts` branch and `main` stays at the
last state worth serving. What is live is always complete.

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
<http://localhost:8124/dev/crypto-browser-check.html>; see
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

## Licence

MIT — see [LICENSE](LICENSE).
