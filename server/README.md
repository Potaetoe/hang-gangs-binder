# server/

The storage endpoint: one Cloudflare Worker (`worker.js`) over one D1
database (`schema.sql`). **Not deployed by CI** — it is set up once, by
hand, by whoever owns the Cloudflare account, and it lives outside the
GitHub Pages deploy entirely.

It is kept in the repo so the endpoint's behaviour is reviewable and so
a new owner can stand up their own copy without reverse engineering the
one that exists.

Two routes and nothing else:

| Route | Who can call it | What it does |
| --- | --- | --- |
| `POST /submit` | anyone, from an allowed origin | appends one row of ciphertext |
| `GET /export` | anyone holding the export token | returns every row |

It never decrypts, holds no key, and cannot read what it stores. The
export token is not what keeps the data confidential — the rows are
ciphertext either way — it just stops the corpus being casually
harvestable. See DESIGN.md, "Export".

## Setting it up

No CLI required; all of this is in the Cloudflare dashboard.

1. **Create the database.** Workers & Pages → D1 → create a database
   named `binder`. Open its console and run the contents of
   `schema.sql`.
2. **Create the Worker.** Workers & Pages → create a Worker, then edit
   its code and paste in `worker.js`.
3. **Bind the database.** In the Worker's Settings → Bindings, add a D1
   binding with variable name **`DB`** pointing at `binder`. The name
   matters — `worker.js` reads `env.DB`.
4. **Add the export token.** Settings → Variables → add a **secret**
   named **`EXPORT_TOKEN`**. Generate a long random value and store it
   the same way as the private key; the admin page will ask for it.
   A secret, not a plaintext variable — plaintext variables are visible
   in the dashboard to anyone with account access.
5. **Deploy**, then put the Worker's URL in `apps/web/config.js` and add
   its origin to the `connect-src` of each page's content security
   policy. Until both are done the site cannot talk to it, by design.

`ALLOWED_ORIGINS` at the top of `worker.js` lists who may call it: the
published site and `http://localhost:8124` for local work. A fork
serving from a different address has to add its own.

## Changing it

Run the checks before pasting a new version into the dashboard:

```bash
node dev/worker.test.mjs
```

That exercises the real routing, validation and CORS logic against a
stub database — no account and no network needed. What it cannot check
is the part only the dashboard knows: that `DB` is bound and
`EXPORT_TOKEN` is set. A Worker missing either will pass every test here
and fail on the first real request.
