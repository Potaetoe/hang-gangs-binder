# Hang Gang's Binder

**Read this first if you have just arrived, or if you are forking it.**

A private stats binder for one Telegram group. Members sign in with
Telegram, enter their measurements, read their own history back, and
see the group's charts. Membership and admin status follow the Telegram
group: whoever is in it can sign in, whoever administers it is an
admin, and leaving it removes access.

**Who can read what.** Entries are stored encrypted at rest under a
secret only the server holds, so a raw database dump reveals nothing.
Whoever runs that server can read entries, and this project says so
rather than implying otherwise — the honest statement of what is and is
not protected is [DESIGN.md](DESIGN.md), "Threat model, honestly
stated".

> **Status.** 0.9 — the keyless design — is being built on the
> `accounts` branch, and none of it is deployed. The live site still
> runs the last complete release. Version 1.0 is the cutover; until
> then what a visitor sees is unchanged on purpose, because the site is
> always the last complete release and never a half-state.

The operative documents, and what each answers:

| Document | What it answers |
| --- | --- |
| `README.md` | what this is, and how to run it locally |
| [AGENTS.md](AGENTS.md) | how agents work here, including how documentation is written |
| [DESIGN.md](DESIGN.md) | why the architecture is what it is |
| [OPERATIONS.md](OPERATIONS.md) | running, deploying and handing over the deployed system |

Anything mutable — who is working on what, current blockers, live state
— lives in GitHub issues and pull requests, not in these files. The
history of every decision is `git log` and `archive/`.

## What gets collected

**[apps/site.config.js](apps/site.config.js) is the answer, and it is a
data file rather than a paragraph**: the group's name, and one row per
field saying what kind it is, in what units and within what bounds.
`apps/fields.js` is the only thing that reads it, and everything that
needs to know about a field asks that. So a fork edits one file and the
rest follows, and "what does this collect" is answered by reading it
rather than by trusting a copy of it.

The Telegram username comes from the sign-in rather than being typed.

## Running it locally

No build step and no dependencies beyond Python and Node. The launcher
finds a working Python for you — on this machine bare `python` is a
Microsoft Store stub:

```bash
./run serve
```

Then open <http://127.0.0.1:8124> — `127.0.0.1` rather than
`localhost`, because the bare server binds IPv4 only and the browser
tries IPv6 first, which reads as slowness (#72).

Three things worth knowing before your first preview:

- **Port 8124 is not optional.** `apps/web/config.js` selects an
  environment by hostname and the Worker's allowed origins name that
  port; another port fails CORS quietly, which looks like the endpoint
  being down.
- **A local preview talks to the development Worker and database,
  never production.** An unknown hostname gets no endpoint at all — the
  page refuses rather than guessing.
- **Telegram sign-in cannot work on localhost.** BotFather binds the
  widget to `potaetoe.github.io`. Local work signs in through the
  Worker's development route instead, and every page shows a banner
  while a development session is in use. See
  [OPERATIONS.md](OPERATIONS.md).

Serve the files rather than opening them: a `file://` URL is not
reliably a secure context.

## Checks

```bash
./run check
```

runs every check the project has — the same set CI runs — and prints
its own list. Report the totals it prints, never a remembered count.

*This gate is transitional*: it guards the surfaces that still exist
and retires with them, while 0.9's work is tested in a new apparatus
under `tests/` (0.9-M0-S4, #281). Both run in CI through the
transition; `AGENTS.md`, "Verification", is the rule.

## Repository layout

```
apps/site.config.js  the one data file - the group's name and its fields
apps/fields.js       the only reader of it; everything else asks this
apps/web/            the site you edit - the source every fix belongs in
dist/                the site that is published - ./run build writes it (#181)
server/              the Cloudflare Worker and its schema, deployed by hand
tests/               0.9's test apparatus (#281); never published
tools/               the transitional gate's checks; never published
dev/                 the transitional harness and the demo; never published
archive/             the pre-2026-08-08 documentation system, frozen
```

The two files at the top of `apps/` are source and are **not** part of
the published site: `apps/web/` is what ships, and the pair beside it is
what 0.9's pages will derive from.

`dist/` is copied verbatim to GitHub Pages, and it is committed rather
than produced during the release — so what ships is in a diff somebody
read, and nothing can fail to be stripped at a moment nobody is
watching. It is `apps/web` with the comments taken out of the CSS and
the scripts (`./run build`, #181); the gate refuses a `dist/` that is
not what `apps/web` builds to, in either direction. Anything that
should not be public simply does not live in either directory.

**A fork edits `apps/site.config.js`** — its own name and its own
fields — and one more thing that has not moved yet:
[apps/web/config.js](apps/web/config.js) still holds the endpoint each
environment talks to. Changing an endpoint means also changing the
`connect-src` of every page that loads it — do one without the other
and requests drop silently at the browser's security check. The gate
fails the build rather than letting that ship.

## Deploying

**A push to `main` is a release.** CI runs the checks and publishes the
committed `dist/` if they pass — it copies that directory and builds
nothing, which is why what ships is always something a reviewer read.
While 0.9 is being built, work goes to `accounts`, which publishes
nothing.

### `main` is frozen, and how to fix production anyway

If something is wrong with the live site right now:

1. Branch from `main`: `git fetch origin && git checkout -b
   hotfix-<what> origin/main`
2. Make the **smallest change that fixes the thing** — not the correct
   change, not the tidy one.
3. **Read what will change on the live site, which is the directory the
   release publishes and not the one you edited.** If the branch
   carries a `dist/`, the fix still belongs in `apps/web` and
   `./run build` is what carries it across — run the build, then the
   gate, then `git diff --stat origin/main -- dist`. Skipping the build
   fails the "dist is the build of apps/web" stage (#181) at the worst
   possible moment. If the branch has no `dist/`, that release
   publishes `apps/web` and that is the diff to read; the `Build the
   site` step in `.github/workflows/deploy.yml` on the branch you are
   fixing settles which of the two you are looking at.
4. Open a pull request against `main` so CI runs before the merge, then
   merge. Merging is the release.
5. **Cherry-pick the fix to `accounts`.** This is the step that gets
   skipped, and its failure is silent: a fix that never reaches
   `accounts` disappears the day 0.9 merges, with every check green.
   Run `./run build` there before pushing if the two branches disagree
   about `dist/`.
6. Confirm the live site actually changed:
   `curl -sI https://potaetoe.github.io/hang-gangs-binder/ | grep -i last-modified`

**Owner present.** A hotfix is a live release, the same category as
deploying the Worker.

## License

MIT — see [LICENSE](LICENSE).
