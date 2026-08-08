# server/

The storage endpoint: one Cloudflare Worker (`worker.js`) over one D1
database (`schema.sql`). **Not deployed by CI** — deployed by hand,
which means this directory and the live endpoint can disagree; probing
which Worker actually answers, the secrets it needs, and every
operating procedure are in [../OPERATIONS.md](../OPERATIONS.md).

> ⚠ **Do not deploy `worker.js` ahead of the cutover.** The live site
> still sends no session, so this Worker would refuse every submitter.
> Inside the sitting the Worker goes first — [../CUTOVER.md](../CUTOVER.md)
> is the order. *(This warning dies with `CUTOVER.md` in its
> aftercare.)*

Deploy and schema commands, with the `--env dev` trap that matters:
`OPERATIONS.md`, "Deploying the Worker". Reasoning about the config
lives as comments in [wrangler.toml](wrangler.toml); the routing is
exercised by `node dev/worker.test.mjs` without an account or a
network.
