# server/

The storage endpoint. **Not deployed by CI** — this code is pasted into
a Google Apps Script project attached to a Google Sheet and deployed
from there, by hand, by whoever owns the Sheet.

It is kept in the repo anyway so the endpoint's behaviour is reviewable
and so a new owner can stand up their own copy without reverse
engineering the one that exists.

What it will do, in full:

- accept a `POST`, append one row to the Sheet, return `{ok: true}`
- store the submitted ciphertext verbatim plus a receipt timestamp
- never decrypt anything — it has no key and no read path

What it will not do: validate the contents (it cannot see them), or
serve data back out. Export happens in the admin page from the Sheet's
own export, not through this endpoint.

Anti-abuse hooks go at the top of `doPost` as a single early return, so
adding a Turnstile check later is an insert rather than a rewrite.
