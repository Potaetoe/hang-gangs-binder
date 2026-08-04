/*
 * Encryption. The only file that stands between a filled-in form and a
 * public database.
 *
 * Two callers: the form encrypts to the published public key, and
 * admin.html decrypts with the private half. One implementation, so the
 * two cannot drift - and one round-trip test in dev/ that proves they
 * still agree, because every way this file can be wrong is silent. A
 * form producing undecryptable ciphertext looks exactly like a working
 * one until export day.
 *
 *   const blob = await BinderCrypto.encrypt(record, BINDER_CONFIG.publicKey);
 *   const record = await BinderCrypto.decrypt(blob, keyFileText);
 *
 * The scheme is ECIES, composed from primitives the browser already
 * ships - no library, no CDN, nothing vendored. See DESIGN.md,
 * "Encryption, concretely", for why ~60 lines of composition beat 200 KB
 * of libsodium on the one page that handles cleartext.
 *
 *   1. Generate a throwaway P-256 keypair, used for this submission and
 *      then dropped. Its private half never leaves this function, which
 *      is what makes each submission independently sealed: nothing the
 *      submitter keeps can reopen what they sent.
 *   2. ECDH it against the admin's public key.
 *   3. HKDF-SHA-256 the shared secret into an AES-256-GCM key.
 *   4. Encrypt, and send the throwaway public key alongside the result
 *      so the admin can repeat step 2 from their side.
 *
 * On the wire, one byte string, then standard base64:
 *
 *   [0]        format version
 *   [1..65]    the throwaway public key, raw uncompressed P-256 point
 *   [66..77]   the AES-GCM nonce
 *   [78..]     ciphertext, with its 16-byte tag
 *
 * The version byte is here so a later format can be introduced without
 * orphaning what is already stored: rows outlive the code that wrote
 * them, and by the time a change is wanted the database will hold blobs
 * nobody can regenerate. The first three fields are authenticated as
 * additional data, so none of them can be altered in the database
 * without the tag failing.
 *
 * Standard base64, no line breaks: server/worker.js rejects anything
 * else, and a URL-safe alphabet here would fail at the endpoint rather
 * than in a review.
 *
 * This file reads no configuration and touches no DOM. It takes a key
 * and a record and returns a string, which is what makes it testable
 * outside a browser - dev/crypto.test.mjs loads these exact bytes.
 */
(function (root) {
  "use strict";

  const CURVE = "P-256";

  // Bumping this means writing a decoder for both formats, not swapping
  // this number. See the header comment.
  const VERSION = 1;

  const POINT_BYTES = 65;   // uncompressed P-256 point: 0x04 ‖ x ‖ y
  const IV_BYTES = 12;      // what AES-GCM is specified for
  const TAG_BYTES = 16;
  const HEADER_BYTES = 1 + POINT_BYTES + IV_BYTES;

  // Mixed into the key derivation so the key is bound to this scheme and
  // to this submission's throwaway public key. Two ciphertexts can no
  // longer be recombined, and a derivation from some future version of
  // this file cannot collide with this one. Changing this string
  // silently makes every stored row undecryptable; it is part of the
  // format, not a comment.
  const LABEL = "hang-gangs-binder/1 ecies p-256 hkdf-sha256 aes-256-gcm";

  // server/worker.js refuses anything larger. Failing here says which
  // field is too long while the submitter is still on the page, instead
  // of turning into a 413 they cannot act on.
  const MAX_BASE64 = 16 * 1024;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  /*
   * crypto.subtle is absent outside a secure context, and a page that
   * lacks it fails in whichever way each browser chooses - usually by
   * appearing to do nothing. The form asks first and says so, rather
   * than letting a submitter fill in three fields and press a dead
   * button.
   */
  function unavailableReason() {
    if (!root.crypto || !root.crypto.subtle) {
      return root.isSecureContext === false
        ? "This page is not in a secure context, so the browser withholds " +
          "the cryptography this form needs. Open it over https:// or " +
          "http://localhost."
        : "This browser does not provide crypto.subtle, so nothing can be " +
          "encrypted here.";
    }
    return null;
  }

  function subtle() {
    const problem = unavailableReason();
    if (problem) throw new Error(problem);
    return root.crypto.subtle;
  }

  function concat(parts) {
    let total = 0;
    for (const part of parts) total += part.length;
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }

  function toBase64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function fromBase64(text) {
    let binary;
    try {
      binary = atob(String(text).trim());
    } catch (e) {
      throw new Error("this is not valid base64, so it is not a submission " +
        "this page wrote");
    }
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  function fromBase64Url(text) {
    const padded = String(text).replace(/-/g, "+").replace(/_/g, "/");
    return fromBase64(padded + "===".slice((padded.length + 3) % 4));
  }

  /*
   * The uncompressed point a JWK spells out as two coordinates. Used to
   * check a key file against itself - see importPrivateKey.
   */
  function rawFromJwk(jwk) {
    const x = fromBase64Url(jwk.x || "");
    const y = fromBase64Url(jwk.y || "");
    if (x.length !== 32 || y.length !== 32) {
      throw new Error("this key file's coordinates are the wrong size for " +
        "P-256, so it is damaged");
    }
    return concat([Uint8Array.of(0x04), x, y]);
  }

  /*
   * ECDH, then HKDF. Both sides run this: the submitter with their
   * throwaway private key and the admin's public one, the admin with
   * their private key and the throwaway public one that arrived in the
   * blob. Same shared secret, same label, same AES key.
   *
   * The HKDF salt is empty on purpose. A salt has to reach the other
   * side, which here would mean carrying random bytes in every row to
   * seed a derivation whose input is already a fresh ECDH secret per
   * submission. The ephemeral key is doing that job.
   */
  async function deriveAesKey(privateKey, publicKey, ephemeralRaw, usages) {
    const shared = await subtle().deriveBits(
      { name: "ECDH", public: publicKey }, privateKey, 256);

    // HKDF input keying material must be non-extractable; WebCrypto
    // rejects the import otherwise.
    const material = await subtle().importKey(
      "raw", shared, "HKDF", false, ["deriveKey"]);

    return subtle().deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(0),
        info: concat([encoder.encode(LABEL), ephemeralRaw]),
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      usages
    );
  }

  /*
   * The public half as config.js carries it: a raw uncompressed P-256
   * point in standard base64. tools/check_web.py already refuses to
   * publish a config.js whose key fails these checks; they are repeated
   * here because a fork's config.js has not been through that gate.
   */
  async function importPublicKey(base64) {
    const raw = fromBase64(base64);
    if (raw.length !== POINT_BYTES || raw[0] !== 0x04) {
      throw new Error("the public key in config.js is not a 65-byte " +
        "uncompressed P-256 point - re-copy the line from " +
        "tools/keygen.html");
    }
    return subtle().importKey(
      "raw", raw, { name: "ECDH", namedCurve: CURVE }, true, []);
  }

  /*
   * The private half, as tools/keygen.html saves it: a JWK inside an
   * envelope. A bare JWK is accepted too, because someone will
   * eventually paste just the inner object - DESIGN.md says so, and the
   * alternative is an admin staring at a rejection with the right key
   * in their clipboard.
   *
   * When the envelope is present its publicKey is checked against the
   * JWK's own coordinates. They cannot disagree unless the file was
   * edited or two halves of different keypairs were filed together,
   * and the failure that would otherwise follow - "cannot decrypt",
   * on every row - looks identical to having the wrong key entirely.
   */
  async function importPrivateKey(source) {
    let value = source;
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch (e) {
        throw new Error("this is not the key file - expected the JSON that " +
          "tools/keygen.html saves, or the JWK inside it");
      }
    }
    if (!value || typeof value !== "object") {
      throw new Error("no key was given");
    }

    let jwk = value;
    let envelopePublic = null;
    if (value.privateKey && typeof value.privateKey === "object") {
      jwk = value.privateKey;
      envelopePublic = typeof value.publicKey === "string"
        ? value.publicKey : null;
    }

    if (jwk.kty !== "EC" || jwk.crv !== CURVE) {
      throw new Error("this key is not a P-256 key, so it cannot open " +
        "anything this portal wrote");
    }
    if (!jwk.d) {
      throw new Error("this is the PUBLIC half of the key. Decrypting needs " +
        "the private half - the file with \"d\" in it");
    }

    if (envelopePublic) {
      const stated = toBase64(fromBase64(envelopePublic));
      if (stated !== toBase64(rawFromJwk(jwk))) {
        throw new Error("this key file contradicts itself: the public key it " +
          "records is not the one its private half belongs to. Two halves of " +
          "different keypairs have been filed together, or the file was " +
          "edited");
      }
    }

    return subtle().importKey(
      "jwk", jwk, { name: "ECDH", namedCurve: CURVE }, false, ["deriveBits"]);
  }

  async function asPublicKey(value) {
    return typeof value === "string" ? importPublicKey(value) : value;
  }

  async function asPrivateKey(value) {
    // A CryptoKey from importPrivateKey, so admin.html can import once
    // and decrypt a thousand rows.
    return value && value.type === "private" ? value : importPrivateKey(value);
  }

  /*
   * A record in, one base64 string out. The record is whatever the form
   * collected; this file does not know or care what is in it, which is
   * what keeps the form's fields a form question.
   */
  async function encrypt(record, publicKey) {
    const recipient = await asPublicKey(publicKey);

    const ephemeral = await subtle().generateKey(
      { name: "ECDH", namedCurve: CURVE }, true, ["deriveBits"]);
    const ephemeralRaw = new Uint8Array(
      await subtle().exportKey("raw", ephemeral.publicKey));

    const key = await deriveAesKey(
      ephemeral.privateKey, recipient, ephemeralRaw, ["encrypt"]);

    const iv = root.crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const header = concat([Uint8Array.of(VERSION), ephemeralRaw, iv]);

    const sealed = new Uint8Array(await subtle().encrypt(
      { name: "AES-GCM", iv: iv, additionalData: header, tagLength: 128 },
      key,
      encoder.encode(JSON.stringify(record))
    ));

    const blob = toBase64(concat([header, sealed]));
    if (blob.length > MAX_BASE64) {
      throw new Error("this submission is too long to store - something in " +
        "the form holds far more text than it should");
    }
    return blob;
  }

  /*
   * One stored row back to the record that produced it. Throws rather
   * than returning null on failure: at export time a row that cannot be
   * read is worth stopping on, not skipping quietly.
   */
  async function decrypt(blob, privateKey) {
    const bytes = fromBase64(blob);
    if (bytes.length < HEADER_BYTES + TAG_BYTES) {
      throw new Error("this row is too short to be a submission - it was " +
        "truncated somewhere between the form and here");
    }
    if (bytes[0] !== VERSION) {
      throw new Error("this row is in format version " + bytes[0] + ", and " +
        "this page only understands version " + VERSION + ". It was written " +
        "by a different version of the portal");
    }

    const ephemeralRaw = bytes.slice(1, 1 + POINT_BYTES);
    const iv = bytes.slice(1 + POINT_BYTES, HEADER_BYTES);
    const header = bytes.slice(0, HEADER_BYTES);
    const sealed = bytes.slice(HEADER_BYTES);

    let ephemeralPublic;
    try {
      ephemeralPublic = await subtle().importKey(
        "raw", ephemeralRaw, { name: "ECDH", namedCurve: CURVE }, true, []);
    } catch (e) {
      throw new Error("this row does not carry a usable key of its own, so " +
        "it cannot be opened - it is corrupt");
    }

    const key = await deriveAesKey(
      await asPrivateKey(privateKey), ephemeralPublic, ephemeralRaw,
      ["decrypt"]);

    let plaintext;
    try {
      plaintext = await subtle().decrypt(
        { name: "AES-GCM", iv: iv, additionalData: header, tagLength: 128 },
        key,
        sealed
      );
    } catch (e) {
      // AES-GCM reports one opaque error for every reason it can fail,
      // and the two that matter are worth naming for whoever is reading
      // this on export day.
      throw new Error("this row could not be opened with this key. Either it " +
        "was encrypted to a different key, or it was altered after it was " +
        "stored");
    }

    try {
      return JSON.parse(decoder.decode(plaintext));
    } catch (e) {
      throw new Error("this row decrypted, but what came out is not a " +
        "submission record");
    }
  }

  root.BinderCrypto = {
    VERSION: VERSION,
    // The form calls this before showing itself, so an unusable browser
    // is a message rather than a dead button.
    unavailableReason: unavailableReason,
    importPublicKey: importPublicKey,
    importPrivateKey: importPrivateKey,
    encrypt: encrypt,
    decrypt: decrypt,
  };
})(globalThis);
