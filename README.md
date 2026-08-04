# Hang Gang's Binder

A submission portal for the Hang Gang. People enter their stats; one
person — whoever holds the key — can export them.

**Submitters need no account.** There is nothing to sign up for and
nothing to log into. Open the page, fill the form, done.

**Submissions are encrypted in your browser before they are sent.** The
service that stores them cannot read them. Only someone holding the
project's private key can, and that key is not stored online anywhere.

> **Status: not open yet.** The site, the page shell and the storage
> endpoint are built, deployed and talking to each other, and the
> keypair exists — the public half is published, the private half is
> held offline. The form and the export tool are not built, so nothing
> collects data yet and nothing can. See [DESIGN.md](DESIGN.md) for
> what is being built, in what order, and why.

---

## What gets collected

Required: **Telegram username**, **weight**, **height**, and a
confirmation that you are 18 or older.

Optional: gender, which roles you take in the kink (feeder, feedee,
gainer, fat admirer), and your country.

Weight and height can be entered in either pounds and inches or
kilograms and centimetres — there is a toggle.

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
