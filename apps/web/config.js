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
    // P-256 point in base64 - see archive/DESIGN.md, "How the key itself is
    // written down". The matching private half is held by the keyholder
    // and exists nowhere in this repository.
    //
    // Replacing this makes every submission encrypted to the old key
    // unreadable by the new one. That is a rotation, not an edit: the old
    // key gets archived rather than destroyed, or the history it
    // encrypted is gone. See OPERATIONS.md, "The keys".
    publicKey: "BEKFlvIzxk0/nOTskgzbKfYoqmMW3ds4EmUpn6rqx9rD1d5PhnxXT9kD917khzW07MUT2yAX18Wc7rD4K0BTSQ8=",
  },
  "localhost": {
    name: "development",
    endpoint: "https://hgbinderworker-dev.sorcererbiggz.workers.dev",

    // Development has a separate keypair so test rows never require the
    // production private key. Only this public half belongs in Git.
    publicKey: "BL4L1Ap1ZybmyIfJ8wJuaV1hUMtTmtMPaE//xgG5GdS5tH8Atk24MqkwNaVx5OMST/OsDWMJ5l4fSsvlFKZKyrc=",
  },
  "hgbinderworker-sit.sorcererbiggz.workers.dev": {
    name: "sit",

    // Under one-Worker-one-origin (DESIGN.md, "The constraint that
    // shapes everything") the Worker serving this page also answers
    // its API, so the honest endpoint is the page's own address,
    // written out in full like every other arm here rather than as a
    // relative "" - auth.js's `if (!config.endpoint)` guard would read
    // an empty string as "not set up" and refuse to sign in.
    endpoint: "https://hgbinderworker-sit.sorcererbiggz.workers.dev",

    // 0.9 is keyless (DESIGN.md, "Trust model: the Worker reads" - all
    // client-side crypto is gone). sit is the first arm built after
    // that ruling, so it carries no key rather than a placeholder one;
    // production and localhost above still do because config.js itself
    // has not been rewritten for the keyless design yet.
    publicKey: null,
  },
};

ENVIRONMENTS["127.0.0.1"] = ENVIRONMENTS.localhost;

// No production fallback. An unknown host gets no endpoint and no key, so
// the existing page guards close submissions instead of reaching live data.
//
// Frozen and locked because this object carries the publicKey every
// submission encrypts to. form.js captures BINDER_CONFIG early, in setUp(),
// but reads config.publicKey late, when the submit button is pressed; a
// script with same-origin write access must not be able to swap the key
// between those two moments, in either of the two ways it could. Object.freeze
// closes member mutation of the resolved arm (config.publicKey = ...); the
// non-writable, non-configurable defineProperty closes reassignment of the
// global itself (BINDER_CONFIG = ...). Either swap would redirect ciphertext
// to a key the keyholder does not hold, silently, until an export fails to
// open. tools/check_web.py fails the build if either protection is dropped:
// the freeze through the export roster, the lock through config_environments.
globalThis.BINDER_CONFIG = Object.freeze(
  ENVIRONMENTS[location.hostname] || {
    name: "unknown",
    publicKey: null,
  }
);

Object.defineProperty(globalThis, "BINDER_CONFIG", {
  writable: false,
  configurable: false,
});
