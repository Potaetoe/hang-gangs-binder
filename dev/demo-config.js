/*
 * The demo's stand-in for apps/web/config.js - the third mirror edit.
 *
 * WHY THE SHIPPED FILE CANNOT SERVE THIS. config.js chooses by
 * location.hostname and knows exactly two: the published site and
 * localhost (with 127.0.0.1 aliased onto it). That is the right shape -
 * an unknown host gets no endpoint and a null key on purpose, so a
 * stranger's fork closes its own page guards instead of reaching live
 * data. It is also what makes the demo undrivable from anywhere else:
 * `publicKey` null means the form cannot seal a record, so a hosted
 * build would show a product that appears broken.
 *
 * The sharper half is `endpoint`. Undefined, `config.endpoint + "/me"`
 * is the string "undefined/me" - a RELATIVE URL, which resolves against
 * whatever origin is serving the build. A page that looks like it is
 * talking to a Worker is then talking to the host.
 *
 * WHY THE ADDRESS IS ONE THAT CANNOT RESOLVE. dev/demo-boot.js replaces
 * fetch before any shipped script runs, so in normal operation nothing
 * here is ever dialled. That is exactly why the value matters: the only
 * case that reaches the network is the case where the replacement did
 * not happen, and in that case the request must not arrive at a Worker
 * that exists. `.invalid` is reserved by RFC 2606 and resolves nowhere,
 * and the pages' own connect-src does not name it either - so the
 * browser's policy refuses it a second time, from a direction this file
 * cannot weaken.
 *
 * Naming the real development Worker here would work just as well right
 * up until it didn't, and the day it didn't would be the day a demo on
 * a public URL started writing at a real endpoint.
 *
 * THE KEY IS A COPY, AND THE GATE HOLDS IT TO ITS ORIGINAL.
 * dev/demo.test.mjs reads apps/web/config.js and fails unless the value
 * below is one of the public keys that file names. It is the
 * development half: a public key, which is the half that encrypts and
 * cannot decrypt, and its private counterpart is the committed
 * throwaway in dev/test-key.json that opens the fabricated sample and
 * nothing else. See dev/README.md, "Two kinds of fixture".
 */
globalThis.BINDER_CONFIG = {
  name: "demo",
  endpoint: "https://demo.invalid",
  publicKey: "BL4L1Ap1ZybmyIfJ8wJuaV1hUMtTmtMPaE//xgG5GdS5tH8Atk24MqkwNaVx5OMST/OsDWMJ5l4fSsvlFKZKyrc=",
};
