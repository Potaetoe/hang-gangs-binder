/*
 * Where this deployment points, and who it encrypts to.
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
 * Change `endpoint` and you must also add its origin to the
 * `connect-src` of every page that loads this file, or the browser
 * blocks the request and the form fails silently. tools/check_web.py
 * fails the build if the two disagree.
 */
window.BINDER_CONFIG = {
  endpoint: "https://hgbinderworker.sorcererbiggz.workers.dev",

  // Not generated yet - tools/keygen.html comes before the form. The
  // form must refuse to submit while this is null rather than posting
  // something it could not encrypt.
  publicKey: null,
};
