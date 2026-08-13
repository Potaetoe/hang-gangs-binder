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
 *   const blob = await BinderCrypto.encryptTo(record, [keyholder, member]);
 *   const record = await BinderCrypto.decrypt(blob, keyFileText);
 *
 * Two writers and one reader, deliberately. `encrypt` seals to one
 * recipient in format version 1; `encryptTo` seals to up to four in
 * version 2; `decrypt` reads both, because rows outlive the code that
 * wrote them and the database holds version 1 rows that nobody can
 * regenerate. Two entry points rather than one overloaded one, so a
 * caller cannot produce the wrong format by passing the wrong shape.
 *
 * The scheme is ECIES, composed from primitives the browser already
 * ships - no library, no CDN, nothing vendored. See DESIGN.md,
 * "Encryption", for why ~60 lines of composition beat 200 KB of
 * libsodium on the one page that handles cleartext.
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
 * The version byte is what lets a second format exist without orphaning
 * what is already stored. The first three fields are authenticated as
 * additional data, so none of them can be altered in the database
 * without the tag failing.
 *
 * Version 2 seals one record to several recipients at once - the
 * keyholder and the submitting member's own device key - so a member
 * can read their own history. One record cannot be sealed twice to two
 * keys and stay one row, so the record is encrypted once under a random
 * content key and that key is wrapped separately to each recipient:
 *
 *   [0]                      format version, 2
 *   [1]                      recipient count N, 1 to 4
 *   [2 .. 2+125N)            N recipient blocks, 125 bytes each:
 *      [+0  .. +65)            ephemeral public key, raw P-256 point
 *      [+65 .. +77)            the nonce that wraps the content key
 *      [+77 .. +125)           the wrapped content key: 32 bytes + tag
 *   [2+125N .. 14+125N)      the content nonce
 *   [14+125N ..]             ciphertext of the record, with its tag
 *
 * Every block is a fixed 125 bytes and there are no length fields, so
 * there is no length field to get wrong: `2 + 125N + 12 + 16` is
 * checkable against the blob's own length before a byte is parsed.
 *
 * Each block carries its OWN ephemeral key rather than sharing one
 * across the row. That is what makes a block self-contained - a reader
 * derives from block bytes alone, and a later re-seal can mint a block
 * for a new device without touching the others - and it is what
 * separates the two wrapping keys, since two ephemeral points against
 * two recipients give two unrelated shared secrets. Nothing in a block
 * names its recipient: a key id beside the ciphertext would answer "how
 * many devices has this account used, and when did they change" against
 * a breached database, so a reader tries each block and keeps the one
 * whose tag verifies. Four unwraps is microseconds; the identifier
 * would be permanent.
 *
 * Everything from byte 0 through the content nonce is the body's
 * additional data, so no block can be added, removed, reordered or
 * edited in the database without the body's tag failing - version 1's
 * property, held. The consequence for whoever adds a recipient later:
 * a row is re-sealed, not appended to. Bytes cannot be bolted on.
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

  // What encryptTo writes. `decrypt` reads both, and neither number
  // changes: the database holds rows in each.
  const ENVELOPE_VERSION = 2;

  const POINT_BYTES = 65;   // uncompressed P-256 point: 0x04 ‖ x ‖ y
  const IV_BYTES = 12;      // what AES-GCM is specified for
  const TAG_BYTES = 16;
  const HEADER_BYTES = 1 + POINT_BYTES + IV_BYTES;

  const KEY_BYTES = 32;     // AES-256

  // Version byte and recipient count, then fixed-size blocks. These are
  // the format, not a tuning knob - see the header comment for the
  // layout they describe.
  const ENVELOPE_PREFIX = 2;
  const BLOCK_BYTES = POINT_BYTES + IV_BYTES + KEY_BYTES + TAG_BYTES;

  // A ceiling rather than a limitation. One byte holds the count, so
  // the format could carry 255; four is what a row is *allowed* to
  // carry, which caps how long a reader spends trying blocks that are
  // not theirs and makes a corrupt count fail loudly instead of turning
  // into a long walk through garbage. Raising it is a format decision,
  // so it lives here beside the version bytes.
  const MAX_RECIPIENTS = 4;

  // Mixed into the key derivation so the key is bound to this scheme and
  // to this submission's throwaway public key. Two ciphertexts can no
  // longer be recombined, and a derivation from some future version of
  // this file cannot collide with this one. Changing this string
  // silently makes every stored row undecryptable; it is part of the
  // format, not a comment.
  const LABEL = "hang-gangs-binder/1 ecies p-256 hkdf-sha256 aes-256-gcm";

  // The same thing for version 2, and a different string is what stops
  // a version 2 derivation colliding with a version 1 one against the
  // same keys. It is part of the stored format on exactly the same
  // terms: change a character and every version 2 row goes silently
  // unreadable, which is what dev/fixture-v2.json exists to catch.
  const ENVELOPE_LABEL =
    "hang-gangs-binder/2 ecies p-256 hkdf-sha256 aes-256-gcm envelope";

  // One sentence for both ways a version 2 row can refuse a reader: no
  // block opened, and a block opened but the body did not. Which of the
  // two happened is a fact about who else the row was sealed to, so the
  // reader is told the same thing either way - and one constant is what
  // stops the two copies drifting into telling them apart by accident.
  const ENVELOPE_CLOSED = "none of this row's recipient blocks opened with " +
    "this key. Either it was sealed to different keys, or it was altered " +
    "after it was stored";

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
        ? "This page was not opened over a secure (https) address, so the " +
          "browser will not let it encrypt anything. Open the site from " +
          "its usual link and try again."
        : "This browser cannot do the encryption this form needs, so " +
          "nothing can be sent from here.";
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
   * The same three steps for one version 2 recipient block, producing
   * the key that wraps the content key rather than the key that
   * encrypts the record.
   *
   * A near-copy of deriveAesKey on purpose, and it must stay one. These
   * two functions serve two formats that are both live in the database,
   * and a single parameterized helper would mean any edit to it changed
   * the derivation of every stored row of both versions at once. The
   * version 1 path's job from now on is to be boring; the way to keep
   * it boring is to leave it alone. See DESIGN.md, "Encryption".
   *
   * The recipient's own public point is deliberately absent from the
   * info. It would add nothing here - the ephemeral point is already
   * unique per block, so the shared secrets are already unrelated - and
   * a reader cannot produce it: importPrivateKey imports the private
   * half non-extractable, which is what lets admin.html hold a key over
   * a thousand rows without that key being exportable from the page
   * that also holds plaintext. A derivation needing it would force that
   * property away.
   */
  async function deriveWrapKey(privateKey, publicKey, ephemeralRaw, usages) {
    const shared = await subtle().deriveBits(
      { name: "ECDH", public: publicKey }, privateKey, 256);

    const material = await subtle().importKey(
      "raw", shared, "HKDF", false, ["deriveKey"]);

    return subtle().deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(0),
        info: concat([encoder.encode(ENVELOPE_LABEL), ephemeralRaw]),
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
   * The recipients of one version 2 row, as raw points, in the order
   * given. The raw form is what makes a duplicate detectable, and a
   * duplicate is worth refusing: a page that seals to the keyholder
   * twice - because the member key it asked for came back as the
   * configured one - writes a row that looks dual-sealed, opens for
   * nobody new, and cannot be told apart from a correct row by anything
   * downstream. Loud here is the only place it can be loud.
   */
  async function envelopeRecipients(publicKeys) {
    const given = Array.isArray(publicKeys) ? publicKeys : [publicKeys];
    if (given.length < 1) {
      throw new Error("a submission needs at least one recipient - with " +
        "none, nothing that comes back could ever be opened");
    }
    if (given.length > MAX_RECIPIENTS) {
      throw new Error("this format carries at most " + MAX_RECIPIENTS +
        " recipients and " + given.length + " were given");
    }

    const recipients = [];
    const seen = [];
    for (const value of given) {
      const key = await asPublicKey(value);
      let raw;
      try {
        raw = new Uint8Array(await subtle().exportKey("raw", key));
      } catch (e) {
        throw new Error("one of these recipient keys cannot be read back as " +
          "a point, so it cannot be sealed to - pass the base64 public key " +
          "or a key imported from one");
      }
      const seal = toBase64(raw);
      if (seen.indexOf(seal) !== -1) {
        throw new Error("the same recipient was given twice. A row sealed " +
          "twice to one key opens for nobody it did not already open for, " +
          "and reads as though it had two recipients");
      }
      seen.push(seal);
      recipients.push(key);
    }
    return recipients;
  }

  /*
   * A record in, one base64 string out, readable by every recipient and
   * by nobody else. The record is encrypted once under a content key
   * this function invents and drops; each recipient gets that content
   * key wrapped to them in a block of their own.
   *
   * No page calls this yet - the form still writes version 1 rows
   * through `encrypt` above, and the slice that switches it over is its
   * own change. See #85.
   */
  async function encryptTo(record, publicKeys) {
    const recipients = await envelopeRecipients(publicKeys);
    const count = recipients.length;

    // Raw bytes rather than a generated CryptoKey, because the bytes
    // are what gets wrapped. Imported non-extractable below, so the key
    // that encrypts the record is never exportable from the page.
    const contentKeyBytes = root.crypto.getRandomValues(
      new Uint8Array(KEY_BYTES));

    const blocks = [];
    for (const recipient of recipients) {
      const ephemeral = await subtle().generateKey(
        { name: "ECDH", namedCurve: CURVE }, true, ["deriveBits"]);
      const ephemeralRaw = new Uint8Array(
        await subtle().exportKey("raw", ephemeral.publicKey));

      const wrapKey = await deriveWrapKey(
        ephemeral.privateKey, recipient, ephemeralRaw, ["encrypt"]);

      const wrapIv = root.crypto.getRandomValues(new Uint8Array(IV_BYTES));

      // The version, the count and this block's own point: everything
      // about the block a reader can check before it has opened
      // anything. The rest of the header cannot go here, because the
      // rest of the header is what this line is producing.
      const wrapAad = concat([
        Uint8Array.of(ENVELOPE_VERSION, count), ephemeralRaw]);

      const wrapped = new Uint8Array(await subtle().encrypt(
        { name: "AES-GCM", iv: wrapIv, additionalData: wrapAad,
          tagLength: 128 },
        wrapKey,
        contentKeyBytes
      ));

      blocks.push(concat([ephemeralRaw, wrapIv, wrapped]));
    }

    const iv = root.crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const header = concat(
      [Uint8Array.of(ENVELOPE_VERSION, count)].concat(blocks, [iv]));

    const contentKey = await subtle().importKey(
      "raw", contentKeyBytes, { name: "AES-GCM" }, false, ["encrypt"]);

    const sealed = new Uint8Array(await subtle().encrypt(
      { name: "AES-GCM", iv: iv, additionalData: header, tagLength: 128 },
      contentKey,
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
   * One version 2 row back to its record, for whichever recipient's key
   * is presented.
   *
   * Blocks are tried in order and the first one that opens wins, which
   * is what "no key id in the format" costs: a reader cannot know which
   * block is theirs until they have tried it. A block that cannot even
   * be parsed - a point knocked off the curve by a flipped bit - is
   * skipped rather than fatal, because it may belong to somebody else
   * and the reader's own block may be one block further on.
   */
  async function decryptEnvelope(bytes, privateKey) {
    // Before the count byte is read, not after. A row shorter than the
    // smallest possible one leaves `bytes[1]` undefined, and undefined
    // compares false against every bound below - so without this the
    // shortest rows fall all the way through to "no block opened",
    // which tells whoever is reading it on export day that they hold
    // the wrong key for a row that is simply damaged.
    if (bytes.length < ENVELOPE_PREFIX + BLOCK_BYTES + IV_BYTES + TAG_BYTES) {
      throw new Error("this row is too short to be a submission with even " +
        "one recipient - it was truncated somewhere between the form and " +
        "here");
    }

    const count = bytes[1];
    if (count < 1 || count > MAX_RECIPIENTS) {
      throw new Error("this row says it holds " + count + " recipient " +
        "blocks, and this format holds between 1 and " + MAX_RECIPIENTS +
        ". It is corrupt");
    }

    const headerBytes = ENVELOPE_PREFIX + (BLOCK_BYTES * count) + IV_BYTES;
    if (bytes.length < headerBytes + TAG_BYTES) {
      throw new Error("this row is too short to be a submission with " +
        count + " recipients - it was truncated somewhere between the form " +
        "and here");
    }

    const header = bytes.slice(0, headerBytes);
    const iv = bytes.slice(headerBytes - IV_BYTES, headerBytes);
    const sealed = bytes.slice(headerBytes);

    // Outside the loop, so that a key file which is damaged, of the
    // wrong curve, or the public half by mistake still says exactly
    // what is wrong with it instead of being swallowed as one more
    // block that did not open.
    const reader = await asPrivateKey(privateKey);

    let contentKeyBytes = null;
    for (let index = 0; index < count && !contentKeyBytes; index++) {
      const at = ENVELOPE_PREFIX + (BLOCK_BYTES * index);
      const ephemeralRaw = bytes.slice(at, at + POINT_BYTES);
      const wrapIv = bytes.slice(at + POINT_BYTES, at + POINT_BYTES + IV_BYTES);
      const wrapped = bytes.slice(at + POINT_BYTES + IV_BYTES, at + BLOCK_BYTES);

      try {
        const ephemeralPublic = await subtle().importKey(
          "raw", ephemeralRaw, { name: "ECDH", namedCurve: CURVE }, true, []);
        const wrapKey = await deriveWrapKey(
          reader, ephemeralPublic, ephemeralRaw, ["decrypt"]);
        const wrapAad = concat([
          bytes.slice(0, ENVELOPE_PREFIX), ephemeralRaw]);

        contentKeyBytes = new Uint8Array(await subtle().decrypt(
          { name: "AES-GCM", iv: wrapIv, additionalData: wrapAad,
            tagLength: 128 },
          wrapKey,
          wrapped
        ));
      } catch (e) {
        contentKeyBytes = null;
      }
    }

    if (!contentKeyBytes) {
      throw new Error(ENVELOPE_CLOSED);
    }

    let plaintext;
    try {
      const contentKey = await subtle().importKey(
        "raw", contentKeyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
      plaintext = await subtle().decrypt(
        { name: "AES-GCM", iv: iv, additionalData: header, tagLength: 128 },
        contentKey,
        sealed
      );
    } catch (e) {
      throw new Error(ENVELOPE_CLOSED);
    }

    try {
      return JSON.parse(decoder.decode(plaintext));
    } catch (e) {
      throw new Error("this row decrypted, but what came out is not a " +
        "submission record");
    }
  }

  /*
   * One stored row back to the record that produced it. Throws rather
   * than returning null on failure: at export time a row that cannot be
   * read is worth stopping on, not skipping quietly.
   */
  async function decrypt(blob, privateKey) {
    const bytes = fromBase64(blob);
    // The version byte decides which decoder reads the rest, and
    // everything below this line is the version 1 one. It gets no
    // tidying and no sharing with the branch above: the database holds
    // rows it is the only way to read.
    if (bytes[0] === ENVELOPE_VERSION) {
      return decryptEnvelope(bytes, privateKey);
    }
    if (bytes.length < HEADER_BYTES + TAG_BYTES) {
      throw new Error("this row is too short to be a submission - it was " +
        "truncated somewhere between the form and here");
    }
    if (bytes[0] !== VERSION) {
      throw new Error("this row is in format version " + bytes[0] + ", and " +
        "this page understands versions " + VERSION + " and " +
        ENVELOPE_VERSION + ". It was written by a different version of the " +
        "portal");
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

  // Frozen because your-page.html and admin.html both load this file while
  // holding plaintext: an export a later script can rewrite is an
  // `encrypt` that can be swapped for a passthrough, or a `decrypt`
  // handed the private key admin.html just imported. Freezing does not
  // stop the global itself being reassigned - nothing in a page can be
  // stopped from doing that - but it removes the quiet edit, where the
  // object every page already holds a reference to changes underneath
  // them. dev/crypto.test.mjs asserts it.
  root.BinderCrypto = Object.freeze({
    VERSION: VERSION,
    ENVELOPE_VERSION: ENVELOPE_VERSION,
    MAX_RECIPIENTS: MAX_RECIPIENTS,
    // The form calls this before showing itself, so an unusable browser
    // is a message rather than a dead button.
    unavailableReason: unavailableReason,
    importPublicKey: importPublicKey,
    importPrivateKey: importPrivateKey,
    encrypt: encrypt,
    encryptTo: encryptTo,
    decrypt: decrypt,
  });
})(globalThis);
