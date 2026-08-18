# server/

**Read this before changing the endpoint.** The storage endpoint is one
Cloudflare Worker (`worker.js`) over one D1 database (`schema.sql`).

**Not deployed by CI** — deployed by hand, which means this directory
and the live endpoint can disagree. Probing which Worker actually
answers, the secrets it needs, and every operating procedure are in
[../OPERATIONS.md](../OPERATIONS.md).

Deploy and schema commands, with the `--env sit` trap that matters:
`OPERATIONS.md`, "Deploying the Worker". Reasoning about the
configuration lives as comments in [wrangler.toml](wrangler.toml); the
API routing is exercised by `node dev/worker.test.mjs` without an
account or a network, the entry rows' whole sealed lifecycle by `node
tests/entry-rows.test.mjs` (0.9-M1-S6, #332), and the asset-vs-API
precedence that decides whether a path even reaches that router by `node
tests/route-precedence.test.mjs` (0.9-M1-S3, #329).

**Entry rows are sealed at rest by this Worker** and it can read them —
`store-crypto.js` is the format, and `DESIGN.md`, "Trust model: the
Worker reads", is the ruled trade. `STORE_SECRET` is what it needs to do
either; without it every route that stores or reads a row fails closed.

*Until the rest of 0.9-M1 lands* this Worker is a mixture: the entry-row
routes are the 0.9 ones, while admins still come from its own lists
rather than from the Telegram group. `DESIGN.md` is the design it is
being rebuilt to, not a description of it — `worker.js`'s own header
names each mechanism the record retires and the milestone that does it.
