/*
 * Where each deployment points, and who it encrypts to.
 *
 * This is the one file a fork or a new owner has to change, and both
 * values in it are public on purpose:
 *
 *   endpoint   the Worker's address. Not a secret - it accepts writes
 *              from the site's origin and nothing else, and it hands
 *              back nothing without the export token.
 *
 *   publicKey  the admin's PUBLIC key. Publishing it is what a public
 *              key is for; it encrypts and cannot decrypt. The private
 *              half never enters this repository. See DESIGN.md, "Key
 *              custody".
 *
 * Add or change an `endpoint` and you must also add its origin to the
 * `connect-src` of every page that loads this file, or the browser
 * blocks the request and the form fails silently. tools/check_web.py
 * fails the build if the two disagree.
 */
const ENVIRONMENTS = {
  "potaetoe.github.io": {
    name: "production",
    endpoint: "https://hgbinderworker.sorcererbiggz.workers.dev",

    // Generated 2026-08-04 by tools/keygen.html. A raw uncompressed
    // P-256 point in base64 - see DESIGN.md, "How the key itself is
    // written down". The matching private half is held by the keyholder
    // and exists nowhere in this repository.
    //
    // Replacing this makes every submission encrypted to the old key
    // unreadable by the new one. That is a rotation, not an edit: the old
    // key gets archived rather than destroyed, or the history it
    // encrypted is gone. See HANDOFF.md.
    publicKey: "BEKFlvIzxk0/nOTskgzbKfYoqmMW3ds4EmUpn6rqx9rD1d5PhnxXT9kD917khzW07MUT2yAX18Wc7rD4K0BTSQ8=",
  },
  "localhost": {
    name: "development",
    endpoint: "https://hgbinderworker-dev.sorcererbiggz.workers.dev",

    // Development has a separate keypair so test rows never require the
    // production private key. Only this public half belongs in Git.
    publicKey: "BL4L1Ap1ZybmyIfJ8wJuaV1hUMtTmtMPaE//xgG5GdS5tH8Atk24MqkwNaVx5OMST/OsDWMJ5l4fSsvlFKZKyrc=",
  },
};

ENVIRONMENTS["127.0.0.1"] = ENVIRONMENTS.localhost;

// No production fallback. An unknown host gets no endpoint and no key, so
// the existing page guards close submissions instead of reaching live data.
globalThis.BINDER_CONFIG = ENVIRONMENTS[location.hostname] || {
  name: "unknown",
  publicKey: null,
};
