# Hang Gang's Binder

A submission portal for one Telegram group. Members sign in with
Telegram and enter their stats; whoever holds the private key can read
them back. **Submissions are encrypted in the browser before they are
sent** — the service that stores them cannot read them, and the key that
can is not stored online anywhere.

> **Status.** The accounts redesign is fully built on the `accounts`
> branch and none of it is deployed. The live site still runs the last
> complete release: an open form, no sign-in. The switch is one sitting
> with a real outage in it — see [CUTOVER.md](CUTOVER.md) — and until
> then what a visitor sees is unchanged on purpose: the site is always
> the last complete release, never a half-state.

The operative documents here, and what each is for:

| Document | What it answers |
| --- | --- |
| `README.md` | what this is, and how to run it locally |
| [AGENTS.md](AGENTS.md) | how agents work on this repository, including how documentation is written |
| [DESIGN.md](DESIGN.md) | why the architecture is what it is |
| [OPERATIONS.md](OPERATIONS.md) | running, deploying, and handing over the deployed system |
| [UAT.md](UAT.md) | the acceptance pass: what to drive, and what passing looks like |
| [CUTOVER.md](CUTOVER.md) | the one-sitting switch to the accounts system; deleted after it |

Anything mutable — who is working on what, current blockers, live
state — lives in GitHub issues and pull requests, not in these files.
The history of every decision is in `git log` and `archive/`.

## What gets collected

Required: Telegram username (taken from the sign-in, not typed), weight,
height, and an 18+ confirmation. Optional: gender, roles in the kink
(feeder, feedee, gainer, admirer), and country. Weight and height can be
typed in pounds/inches or kilograms/centimeters; both systems are
stored, along with exactly what was typed.

## What is public

The dashboard shows totals only — counts, medians, distributions — with
no handles and no individual entries, computed in the keyholder's
browser before anything is published. Since the redesign it requires a
member sign-in. Everything else stored is ciphertext that only the
private key opens. The full privacy reasoning is in
[DESIGN.md](DESIGN.md).

## Running it locally

No build step and no dependencies beyond Python and Node. The launcher
finds a working Python for you (on this machine, bare `python` is a
Microsoft Store stub):

```bash
./run serve
```

Then open <http://127.0.0.1:8124> — `127.0.0.1` rather than
`localhost`, because the bare server binds IPv4 only and the browser
tries IPv6 first, which reads as slowness (#72). Equivalent by hand:
`py -3 -m http.server 8124 --directory apps/web`.

Three things worth knowing before your first preview:

- **Port 8124 is not optional.** `config.js` selects an environment by
  hostname and the Worker's allowed origins name that port; another
  port fails CORS quietly, which looks like the endpoint being down.
- **A local preview talks to the development Worker and database,
  never production.** An unknown hostname gets no endpoint and no key
  at all — the form refuses rather than guessing.
- **Telegram sign-in cannot work on localhost.** BotFather binds the
  widget to `potaetoe.github.io`. Local work signs in through
  `POST /auth/dev` on the development Worker instead; every page shows
  a banner while a development session is in use. See
  [OPERATIONS.md](OPERATIONS.md).

Serving the files matters: a `file://` URL is not reliably a secure
context, and without one the crypto APIs are absent and the form
refuses to open.

## Checks

```bash
./run check
```

runs every check the project has — the same set CI runs — and prints
its own list. Report the totals it prints; never a remembered count.

## Repository layout

```
apps/web/   the published site - this directory IS the build
server/     the Cloudflare Worker and its schema, deployed by hand
tools/      checks and the key generator; never published
dev/        test harness; never published
archive/    the pre-2026-08-08 documentation system, frozen
```

`apps/web` is copied verbatim to GitHub Pages. Nothing is stripped, so
nothing can fail to be stripped — anything that should not be public
simply does not live in that directory.

[apps/web/config.js](apps/web/config.js) is the one file a fork or new
owner changes: the endpoint and the public key, both public by design.
Changing the endpoint means also changing the `connect-src` of every
page that loads it — do one without the other and submissions drop
silently at the browser's security check. The gate fails the build
rather than letting that ship.

## Deploying

**A push to `main` is a release.** CI runs the checks and publishes
`apps/web` if they pass. While the redesign waits on its cutover, work
goes to `accounts`, which publishes nothing.

### `main` is frozen, and how to fix production anyway

If something is wrong with the live site right now:

1. Branch from `main`: `git fetch origin && git checkout -b
   hotfix-<what> origin/main`
2. Make the **smallest change that fixes the thing** — not the correct
   change, not the tidy one.
3. Run the gate, and read exactly what will change on the live site:
   `git diff --stat origin/main -- apps/web` — short enough to read.
4. Open a pull request against `main` so CI runs before the merge, then
   merge. Merging is the release.
5. **Cherry-pick the fix to `accounts`.** This is the step that gets
   skipped, and its failure is silent: a fix that never reaches
   `accounts` disappears the day the redesign merges, with every check
   green.
6. Confirm the live site actually changed:
   `curl -sI https://potaetoe.github.io/hang-gangs-binder/ | grep -i last-modified`

**Owner present.** A hotfix is a live release, the same category as
deploying the Worker.

## Security, in one paragraph

Your data is encrypted in your browser with a public key and can only
be read by whoever holds the matching private key. Losing that key
makes the data permanently unreadable — there is no recovery, by
design. What this does and does not protect against is stated honestly
in [DESIGN.md](DESIGN.md); how the key is generated, checked and
handed over is in [OPERATIONS.md](OPERATIONS.md).

## License

MIT — see [LICENSE](LICENSE).
