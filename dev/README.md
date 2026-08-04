# dev/

Test harness and scratch verification. **Never published** — the deploy
copies `apps/web` and nothing else, so anything in here is safe to be as
messy as it needs to be.

## What is here

- `worker.test.mjs` — exercises `server/worker.js` against a stub D1
  binding: preflight, origin rejection, the validation cases, and the
  token gate on export. No account, no network, no wrangler.

  ```bash
  node dev/worker.test.mjs
  ```

## Planned

- a round-trip test for the crypto: encrypt a known payload with a test
  keypair, decrypt it, assert the result is byte-identical. This is the
  check worth having — a form that silently produces undecryptable
  ciphertext looks exactly like a working form until export day.
- a fixture of sample submissions for exercising the export tool without
  needing real data.

The test keypair used here is a throwaway generated for testing and is
committed on purpose. It protects nothing. The real private key never
enters this repository — see [../DESIGN.md](../DESIGN.md).
