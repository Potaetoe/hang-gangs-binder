# Hang Gang's Binder

A submission portal for the Hang Gang. People enter their stats; one
person — whoever holds the key — can export them.

**Submitters need no account.** There is nothing to sign up for and
nothing to log into. Open the page, fill the form, done.

**Submissions are encrypted in your browser before they are sent.** The
service that stores them cannot read them. Only someone holding the
project's private key can, and that key is not stored online anywhere.

> **Status: scaffold.** The repository structure, the deploy pipeline,
> the page shell and the storage endpoint's code are in place. The
> endpoint is not deployed yet, and the form and the export tool are not
> built. See [DESIGN.md](DESIGN.md) for what is being built and why.

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

## Repository layout

```
apps/web/          the published site — this directory IS the build
server/            the Cloudflare Worker and its database schema,
                   deployed by hand and never touched by CI
tools/             checks and the offline key generator
dev/               test harness; never published
```

`apps/web` is copied verbatim to GitHub Pages. Nothing is stripped, so
nothing can fail to be stripped — anything that should not be public
simply does not live in that directory.

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

If you changed the endpoint, run its checks too — they need Node, and
nothing else:

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
