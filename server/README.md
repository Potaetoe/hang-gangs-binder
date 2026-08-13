# server/

**Read this before changing the endpoint.** The storage endpoint is one
Cloudflare Worker (`worker.js`) over one D1 database (`schema.sql`).

**Not deployed by CI** — deployed by hand, which means this directory
and the live endpoint can disagree. Probing which Worker actually
answers, the secrets it needs, and every operating procedure are in
[../OPERATIONS.md](../OPERATIONS.md).

Deploy and schema commands, with the `--env dev` trap that matters:
`OPERATIONS.md`, "Deploying the Worker". Reasoning about the
configuration lives as comments in [wrangler.toml](wrangler.toml); the
routing is exercised by `node dev/worker.test.mjs` without an account
or a network.

*Until 0.9-M1 lands* this Worker is the pre-0.9 one: it enforces the
key-world routes and reads its admins from its own lists. `DESIGN.md`
is the design it is being rebuilt to, not a description of it.
