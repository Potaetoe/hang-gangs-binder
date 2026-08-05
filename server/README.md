# server/

The storage endpoint: one Cloudflare Worker (`worker.js`) over one D1
database (`schema.sql`). **Not deployed by CI** — it is set up once, by
hand, by whoever owns the Cloudflare account, and it lives outside the
GitHub Pages deploy entirely.

It is kept in the repo so the endpoint's behaviour is reviewable and so
a new owner can stand up their own copy without reverse engineering the
one that exists.

Four routes and nothing else:

| Route | Who can call it | What it does |
| --- | --- | --- |
| `POST /submit` | anyone, from an allowed origin | appends one row of ciphertext |
| `GET /export` | anyone holding the export token | returns every row |
| `POST /snapshot` | anyone holding the export token | replaces the published aggregate |
| `GET /snapshot` | anyone, from an allowed origin | returns it |
| `DELETE /snapshot` | anyone holding the export token | takes it down |

It never decrypts, holds no key, and cannot read what it stores. The
export token is not what keeps the data confidential — the rows are
ciphertext either way — it just stops the corpus being casually
harvestable. See DESIGN.md, "Export".

`GET /snapshot` is the one route with no token on it, and that is
deliberate: what it returns has no handles and no rows in it, only
counts, medians and histogram bins. The Worker cannot compute a
snapshot — doing that requires reading the submissions — so it is built
in the keyholder's browser and this endpoint only holds the result. See
DESIGN.md, "The public dashboard".

`DELETE /snapshot` is the only destructive route here, and the only one
in the Worker at all — the submissions table has no `DELETE` and no
`UPDATE` path and is not touched by it. It needs the export token and
**not** the private key, so a retraction never waits on decrypting the
corpus first. Deleting nothing succeeds, so pressing Unpublish twice is
not an error.

## Setting it up

No CLI required; all of this is in the Cloudflare dashboard.

1. **Create the database.** Workers & Pages → D1 → create a database
   named `hg_binder_db`. Open its console and run the contents of
   `schema.sql`.
2. **Create the Worker.** Workers & Pages → create a Worker, then edit
   its code and paste in `worker.js`.
3. **Bind the database.** Open the Worker from the Workers & Pages list,
   go to its **Bindings** tab, and add a **D1 database** binding with
   variable name **`DB`** pointing at `hg_binder_db`. The name matters —
   `worker.js` reads `env.DB`.

   A *binding* is a connection to another Cloudflare resource, and is
   not the same screen as *Variables and Secrets* below, even though
   both arrive on the same `env` object in the code. `env.DB` is a live
   database client; `env.EXPORT_TOKEN` is a string.

   Check the Worker redeploys afterwards. A binding added without a
   redeploy is the case where the code is right, every test here passes,
   and the first real request still fails on `env.DB` being undefined.
4. **Add the export token.** Settings → Variables and Secrets → add a
   **secret** named **`EXPORT_TOKEN`**. Generate a long random value and
   store it the same way as the private key; the admin page will ask for
   it. A secret, not a plaintext variable — plaintext variables are
   visible in the dashboard to anyone with account access.
5. **Deploy**, then put the Worker's URL in `apps/web/config.js` and add
   its origin to the `connect-src` of every page that loads
   `config.js`. Until both are done the site cannot talk to it, by
   design; `tools/check_web.py` fails the build if only one is done.

Optionally, add a plaintext variable **`ALLOWED_ORIGINS`** — a
comma-separated list of the origins allowed to POST here. Left unset,
the Worker falls back to the `DEFAULT_ORIGINS` in `worker.js`: this
site, plus `http://localhost:8124` for local work.

**Anyone running their own copy should set it.** It is what lets the
Worker code stay byte-identical across deployments — if you are editing
`worker.js` to change a URL, use this variable instead. Note that
setting it *replaces* the defaults rather than adding to them, which is
deliberate: an inherited deployment should stop accepting the previous
owner's site, not keep quietly writing rows from it.

`server/wrangler.toml` records the same bindings for anyone who would
rather deploy from the command line than the dashboard.

## Updating an existing deployment

`schema.sql` uses `CREATE TABLE IF NOT EXISTS`, so re-running the whole
file against a live database is safe and adds whatever is missing
without touching what is there. That is the update path: paste
`schema.sql` into the D1 console again, then paste `worker.js` into the
Worker editor and deploy.

**The snapshot feature needs both halves**, and the failure if only one
is done is quiet in the usual way:

- Worker updated, table missing → Publish returns a 500 and the public
  dashboard stays empty.
- Table created, Worker not updated → Publish gets a 404 from a route
  that does not exist yet, which reads as "Not found" rather than
  "you have not deployed this".

Neither breaks the form or the export, which keep working throughout.

## Changing it

Run the checks before pasting a new version into the dashboard:

```bash
node dev/worker.test.mjs
```

That exercises the real routing, validation and CORS logic against a
stub database — no account and no network needed. What it cannot check
is the part only the dashboard knows: that `DB` is bound, that
`EXPORT_TOKEN` is set, and that both tables exist. A Worker missing any
of them will pass every test here and fail on the first real request.
