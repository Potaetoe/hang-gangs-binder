

(function (root) {
  "use strict";

  const CURVE = "P-256";

   
   
  const VERSION = 1;

   
   
  const ENVELOPE_VERSION = 2;

  const POINT_BYTES = 65;    
  const IV_BYTES = 12;       
  const TAG_BYTES = 16;
  const HEADER_BYTES = 1 + POINT_BYTES + IV_BYTES;

  const KEY_BYTES = 32;      

   
   
   
  const ENVELOPE_PREFIX = 2;
  const BLOCK_BYTES = POINT_BYTES + IV_BYTES + KEY_BYTES + TAG_BYTES;

   
   
   
   
   
   
  const MAX_RECIPIENTS = 4;

   
   
   
   
   
   
  const LABEL = "hang-gangs-binder/1 ecies p-256 hkdf-sha256 aes-256-gcm";

   
   
   
   
   
  const ENVELOPE_LABEL =
    "hang-gangs-binder/2 ecies p-256 hkdf-sha256 aes-256-gcm envelope";

   
   
   
   
   
  const ENVELOPE_CLOSED = "none of this row's recipient blocks opened with " +
    "this key. Either it was sealed to different keys, or it was altered " +
    "after it was stored";

   
   
   
  const MAX_BASE64 = 16 * 1024;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  

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

  

  function rawFromJwk(jwk) {
    const x = fromBase64Url(jwk.x || "");
    const y = fromBase64Url(jwk.y || "");
    if (x.length !== 32 || y.length !== 32) {
      throw new Error("this key file's coordinates are the wrong size for " +
        "P-256, so it is damaged");
    }
    return concat([Uint8Array.of(0x04), x, y]);
  }

  

  async function deriveAesKey(privateKey, publicKey, ephemeralRaw, usages) {
    const shared = await subtle().deriveBits(
      { name: "ECDH", public: publicKey }, privateKey, 256);

     
     
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
     
     
    return value && value.type === "private" ? value : importPrivateKey(value);
  }

  

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

  

  async function encryptTo(record, publicKeys) {
    const recipients = await envelopeRecipients(publicKeys);
    const count = recipients.length;

     
     
     
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

  

  async function decryptEnvelope(bytes, privateKey) {
     
     
     
     
     
     
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

  

  async function decrypt(blob, privateKey) {
    const bytes = fromBase64(blob);
     
     
     
     
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

   
   
   
   
   
   
   
   
  root.BinderCrypto = Object.freeze({
    VERSION: VERSION,
    ENVELOPE_VERSION: ENVELOPE_VERSION,
    MAX_RECIPIENTS: MAX_RECIPIENTS,
     
     
    unavailableReason: unavailableReason,
    importPublicKey: importPublicKey,
    importPrivateKey: importPrivateKey,
    encrypt: encrypt,
    encryptTo: encryptTo,
    decrypt: decrypt,
  });
})(globalThis);
