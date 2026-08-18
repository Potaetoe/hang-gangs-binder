/*
 * The at-rest encryption format: what a stored record IS, and the one
 * door that reads one back. 0.9-M1-S4 (#330).
 *
 * THE READER is whoever stores or reads a record in the Worker.
 * Nothing else in this tree encrypts or decrypts stored data, so the
 * format lives in one file and a version bump is one edit rather than
 * a hunt. The Worker's routes wire it; this file knows nothing about
 * routes, sessions or the database.
 *
 * ------------------------------------------------------------------
 * WHAT IS INSIDE, AND WHAT A RAW DUMP STILL SHOWS
 *
 * Every handle, every display name and every free-text field is inside
 * the ciphertext - directory included. That last word is the load-
 * bearing one and it is DESIGN.md, "The identifier is the whole
 * problem" implemented rather than restated: the handles that matter
 * are the few dozen in one group's member list, so a clear-text roster
 * sitting beside the rows answers "did @foo submit?" without reading a
 * single entry. A hash of a handle is the same oracle over a smaller
 * alphabet. The store is the answer instead.
 *
 * What a raw dump still shows, stated rather than glossed: row counts,
 * timestamps, the version byte, the key id, and the ciphertext length,
 * which tracks the plaintext length byte for byte because NO PADDING
 * is applied and none is claimed. Traffic analysis and record counts
 * are already named as out of scope in DESIGN.md, "Threat model,
 * honestly stated", and the largest item on that list - whoever runs
 * the Worker reads plaintext in order to serve it - is a ruled trade
 * this file cannot and must not appear to change.
 *
 * ------------------------------------------------------------------
 * THE ALGORITHM, ARGUED AGAINST THE RULED PROPERTIES
 *
 * DESIGN.md, "Encryption" rules exactly two properties: the secret
 * never leaves the Worker, and a raw database dump alone reveals
 * nothing. AES-256-GCM through the runtime's own WebCrypto is what
 * this file implements, and every piece of that choice answers one of
 * the two.
 *
 *   AUTHENTICATED ENCRYPTION, NOT ENCRYPTION. "A dump reveals nothing"
 *   is only half of what a store needs; the other half is that an
 *   attacker who can WRITE to that dump cannot make the Worker serve
 *   plaintext it never stored. GCM verifies its tag before a single
 *   byte of plaintext is returned. A chaining mode with a MAC bolted
 *   on beside it reaches the same property through two primitives, an
 *   ordering decision and a comparison somebody has to keep constant-
 *   time - three places to be wrong for one property GCM already has,
 *   which is why no such composition is here.
 *
 *   WEBCRYPTO, AND NOTHING IMPORTED. The Workers runtime carries it,
 *   so the code that touches plaintext has no dependency at all - no
 *   supply chain, no version skew between the sealing side and the
 *   opening side, and nothing to audit but this file. Read the import
 *   list: there is none.
 *
 *   A FRESH 12-BYTE RANDOM NONCE PER OPERATION, from
 *   crypto.getRandomValues. GCM's one catastrophic failure is nonce
 *   reuse under one key: two records sharing a nonce leak the XOR of
 *   their plaintexts and hand over the authentication subkey with it.
 *   A Workers isolate offers no safe counter state - the platform
 *   creates and discards isolates at its own discretion and runs many
 *   at once, so a counter, a row id, a timestamp or anything derived
 *   from them is a value two isolates can hand out twice with nothing
 *   able to notice. Randomness is the only source here that needs no
 *   coordination. 96 bits is GCM's native nonce width, which also
 *   avoids the GHASH derivation any other width goes through. Every
 *   write re-encrypts with a new nonce; a nonce read out of storage is
 *   never put back into an encrypt call.
 *
 *   ADDITIONAL AUTHENTICATED DATA, MANDATORY. The ciphertext is bound
 *   to the version, the purpose, the account and the record it belongs
 *   to, so a row lifted into another account, another record slot or
 *   the directory fails to open rather than decrypting into somebody
 *   else's page. Without it a database write is a data-move attack:
 *   the ciphertext is intact, the tag verifies, and the Worker serves
 *   one member's entry as another's. The fields are length-prefixed
 *   because concatenation alone is ambiguous - account "ab" with
 *   record "c" and account "a" with record "bc" would otherwise
 *   produce identical bound data.
 *
 *   HKDF-SHA-256 SUBKEYS, NON-EXTRACTABLE. The configured secret is
 *   never a cipher key directly: one subkey per (key id, purpose) is
 *   derived under a fixed label, so the row key and the directory key
 *   are unrelated and a compromise of one buys nothing about the
 *   other. Deriving also means the secret may be an operator-typed
 *   string rather than exactly 32 bytes of key material. The derived
 *   keys are imported non-extractable and held in a closure, so
 *   nothing that serializes the store handle - a log line, an error
 *   response, JSON.stringify - can reach them. This file's own copy of
 *   the secrets is cleared the moment the subkeys exist; the caller's
 *   bindings are the caller's, and no second copy outlives this
 *   function.
 *
 *   THE CIPHER SECRET IS ITS OWN SECRET. STORE_SECRET, and only
 *   STORE_SECRET. The account-id HMAC key is a different secret with a
 *   different lifetime - DESIGN.md, "The bot is temporary" is why it
 *   must not be borrowed from something already in hand - and this
 *   file does not name it, take it, or accept it.
 *
 * ------------------------------------------------------------------
 * THE LAYOUT
 *
 *     byte  0       version            1 today
 *     bytes 1-2     key id             big-endian, 1 through 65535
 *     bytes 3-14    nonce              12 bytes, fresh per operation
 *     bytes 15-     ciphertext + tag   AES-256-GCM, 16-byte tag
 *
 * Version and key id are in the clear because both must be read before
 * a key can be chosen, and they are separate fields on purpose: THE
 * KEY ID IS WHAT MAKES ROTATION FREE. Retiring a secret means writing
 * under a new id while the old one stays readable, so a rotation costs
 * no version byte, no decoder branch and no re-encryption pass over
 * the whole store. Two bytes rather than one: a wrapping generation
 * counter would let two different secrets share an id, and the failure
 * that produces is a decrypt that fails indistinguishably from tamper
 * - undiagnosable by construction, because the refusal below is
 * deliberately uniform.
 *
 * The version byte is bound into the additional data, so a record
 * cannot be relabeled as a different version. The key id is not: a
 * flipped key id selects a different key and the tag fails on its own,
 * and there is no confusion left for binding it to prevent.
 *
 * NEVER REGENERATE A FAILING FIXTURE. Ruled in DESIGN.md,
 * "Encryption": the format is part of the stored data, so a committed
 * fixture that stops decoding means the layout changed and every
 * stored row went silently unreadable with it. The remedy is a NEW
 * version byte and a decoder for BOTH - never fresh bytes pasted over
 * the failing ones, which turn the gate green while leaving every real
 * row unreadable. tests/store-crypto.test.mjs holds the v1 fixture and
 * a hash pin over it that makes the quiet edit loud.
 *
 * WHAT "A DECODER FOR BOTH" COSTS, because raising the constant alone
 * is the trap rather than the remedy: label() and boundData() read the
 * module-level VERSION, so a bump re-derives every subkey and rewrites
 * the bound data for OLD records too, and v1 stops opening the moment
 * the new code deploys. A version bump therefore passes the RECORD's
 * version into both of them instead of letting either read the
 * module's - and the key map, keyed by (key id, purpose) today, takes
 * version as a third dimension with it, since two live versions want
 * different subkeys under one key id. Neither is parameterized here
 * because a second version settles that shape and a guess does not;
 * the committed fixture is what makes the trap loud, and it fails on
 * a bare bump exactly as intended.
 *
 * ------------------------------------------------------------------
 * FAIL CLOSED, AND SAY NOTHING
 *
 * Tamper, an unknown version, an unknown key id, a wrong secret, a
 * cross-account swap and a cross-purpose swap all raise ONE opaque
 * error carrying no field name, no offset and no reason. Anything
 * finer is an oracle: a caller that can tell "unknown version" from
 * "bad tag" can walk the format, and a caller that can tell "wrong
 * account" from "bad tag" can test account ids against records.
 *
 * ONE THROW SITE, so the STACK is uniform as well as the message. A
 * message that names nothing is only half a refusal: the runtime
 * records the line that threw, so six throw sites hand a caller
 * exactly the six-way distinction the message declines to make. Every
 * refusal leaves through refuse() below, and StoreFormatError writes
 * its own stack to a constant - the same field, closed by the same
 * argument. StoreConfigError keeps its real stack on purpose: a
 * configuration mistake is a bug somebody has to find, and nothing is
 * probing for it.
 *
 * WHAT THE CLOCK STILL TELLS, AND WHY IT IS ACCEPTED. The refusal is
 * uniform in type, in message and in stack. It is NOT constant-time,
 * and this file makes no such claim. A record whose version byte is
 * wrong, whose key id the ring does not hold, or which is too short to
 * be a record at all is refused before any AES call and costs a few
 * microseconds; a record that reaches the tag check costs several
 * times that. A caller who can time the door therefore learns WHICH
 * VERSION AND WHICH KEY IDS the ring accepts, one probe at a time.
 * That is the whole of what the clock gives, and it is accepted rather
 * than defended: the version byte and the key id are in the clear in
 * every record already, so a caller holding one reads both without a
 * stopwatch. What the clock does NOT give is a plaintext oracle -
 * every record that reaches a key runs the same GCM verification, and
 * the tag comparison inside it belongs to the platform. Padding the
 * early refusals out to the slow path would be a constant-time claim
 * this file cannot honestly make on a runtime it does not control, and
 * a false claim of that kind is worse than a stated limit.
 *
 * A configuration mistake is the opposite and is loud - a missing or
 * too-short STORE_SECRET, an empty account id, a plaintext that is not
 * a string. Those are the Worker's own bugs rather than an attacker's
 * probe, they surface at startup or in a code path no request reaches,
 * and a silent one becomes data nobody can read later. Neither error
 * ever carries key material.
 */

const VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + 2 + NONCE_BYTES;
const KEY_ID_MIN = 1;
const KEY_ID_MAX = 0xffff;

/* HKDF turns a typed secret into key material; it cannot manufacture
   entropy that was never there. This is the only place able to notice
   a weak STORE_SECRET, so it refuses one rather than deriving a
   perfectly well-formed key from four characters. */
const MIN_SECRET_CHARS = 24;

/* THE UINT16 LENGTH PREFIX IS WHAT THIS CEILING DEFENDS, and caller
   hygiene is the side effect rather than the point. boundData writes
   each field's byte length as a big-endian uint16, so a field of 65537
   bytes writes the same two prefix bytes as a field of 1 byte - and
   those prefixes are the only thing separating an account of ab with a
   record of c from an account of a with a record of bc. Wrap one and
   that separation is gone: a caller able to put an over-long id on one
   side of the pair can make two different pairs produce byte-identical
   bound data, which is one account's record opening under another's
   context with a valid tag. A ceiling two orders of magnitude below
   the wrap point is what puts the wrap out of REACH rather than merely
   out of the ordinary, and refusing is the only mechanism that does it
   - truncating to the ceiling would collide the same way, one length
   lower. Removing this constant is a cross-account lift, not a
   loosened validation. tests/store-crypto.test.mjs drives the boundary
   and the wrap point both. */
const MAX_FIELD_BYTES = 512;

/* The extractable flag, named once so every call site reads the same
   and so a check can count them. No derived key ever leaves this
   file. */
const NOT_EXTRACTABLE = false;

/* Domain separation for the derivation. The salt is fixed rather than
   random because the same subkey must come back on every isolate and
   after every deploy; with a high-entropy secret a fixed salt costs
   nothing, and the per-purpose label below is what actually separates
   the keys. */
const HKDF_SALT = "hang gang's binder / store at rest / v1";

const PURPOSE = Object.freeze({ ROW: "row", DIRECTORY: "dir" });

const UTF8 = new TextEncoder();

/* Fatal decoding, so ciphertext that verifies but is not text refuses
   rather than returning replacement characters that read like data. */
const FROM_UTF8 = new TextDecoder("utf-8", { fatal: true });

/*
 * The one thing a caller learns when a record will not open. It takes
 * no argument at all, so there is no way to attach a reason to it
 * without editing this class - which is the point rather than an
 * inconvenience.
 */
class StoreFormatError extends Error {
  constructor() {
    super("the stored record could not be read");
    this.name = "StoreFormatError";
    /* The stack is a field name arriving by another route: it carries
       the file, the line and the call path of whichever check refused,
       so a caller comparing two stacks reads "unknown key id" against
       "bad tag" straight off them while the message says neither. A
       constant is the same answer the message gives. */
    this.stack = this.name + ": " + this.message;
  }
}

/*
 * The one place a record is refused. Called rather than thrown at each
 * check so that the refusal has a single origin - see ONE THROW SITE
 * above for why the stack is part of what is being kept quiet.
 */
function refuse() {
  throw new StoreFormatError();
}

/*
 * A mistake in the Worker's own configuration or call. Loud, and never
 * carrying a value - only the name of the setting that is wrong.
 */
class StoreConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "StoreConfigError";
  }
}

const label = (keyId, purpose) =>
  "hgb/store/v" + VERSION + "/key-" + keyId + "/" + purpose;

/*
 * version || len(purpose) purpose || len(account) account ||
 * len(record) record, every length a big-endian uint16.
 *
 * Length prefixes rather than a separator: a separator has to be a
 * byte no field may contain, which is a rule about the fields instead
 * of about the encoding, and an id that smuggles one in collapses two
 * distinct records into one bound value.
 */
function boundData(purpose, accountId, recordId) {
  const parts = [purpose, accountId, recordId].map((text) =>
    UTF8.encode(text));
  let size = 1;
  for (const part of parts) size += 2 + part.length;
  const out = new Uint8Array(size);
  out[0] = VERSION;
  let at = 1;
  for (const part of parts) {
    out[at] = (part.length >> 8) & 0xff;
    out[at + 1] = part.length & 0xff;
    out.set(part, at + 2);
    at += 2 + part.length;
  }
  return out;
}

function requireField(name, value) {
  if (typeof value !== "string" || value === "") {
    throw new StoreConfigError(name + " must be a non-empty string");
  }
  if (UTF8.encode(value).length > MAX_FIELD_BYTES) {
    throw new StoreConfigError(
      name + " is longer than the " + MAX_FIELD_BYTES + "-byte limit");
  }
  return value;
}

function requireKeyId(name, value) {
  const id = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value) : value;
  if (!Number.isInteger(id) || id < KEY_ID_MIN || id > KEY_ID_MAX) {
    throw new StoreConfigError(
      name + " must be a whole number from " + KEY_ID_MIN + " to " +
      KEY_ID_MAX);
  }
  return id;
}

function requireSecret(name, value) {
  if (typeof value !== "string") {
    throw new StoreConfigError(name + " is missing");
  }
  if (value.length < MIN_SECRET_CHARS) {
    throw new StoreConfigError(
      name + " is shorter than the " + MIN_SECRET_CHARS +
      "-character minimum, and HKDF cannot add entropy that is not there");
  }
  return value;
}

/* One AES-GCM key per (key id, purpose), derived from the secret and
   imported so it cannot be read back out. */
async function subkey(secret, keyId, purpose) {
  let material;
  try {
    material = await crypto.subtle.importKey(
      "raw", UTF8.encode(secret), "HKDF", NOT_EXTRACTABLE, ["deriveKey"]);
  } catch (error) {
    throw new StoreConfigError(
      "the store secret could not be imported as key material");
  }
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: UTF8.encode(HKDF_SALT),
      info: UTF8.encode(label(keyId, purpose)),
    },
    material,
    { name: "AES-GCM", length: 256 },
    NOT_EXTRACTABLE,
    ["encrypt", "decrypt"]);
}

function asBytes(record) {
  if (record instanceof Uint8Array) return record;
  if (record instanceof ArrayBuffer) return new Uint8Array(record);
  return refuse();
}

/*
 * Open a store over an explicit key ring.
 *
 *   writeKeyId  the generation new records are sealed under.
 *   secrets     { <key id>: <secret string> } - every generation that
 *               must still be readable, the write one included.
 *
 * Every subkey is derived here, at construction, and the secrets are
 * not kept: what the returned handle closes over is a map of
 * non-extractable keys and nothing else.
 */
async function openStoreWithKeys(keyring) {
  if (!keyring || typeof keyring !== "object") {
    throw new StoreConfigError("a key ring is required");
  }
  const writeKeyId = requireKeyId("writeKeyId", keyring.writeKeyId);
  const secrets = keyring.secrets;
  if (!secrets || typeof secrets !== "object") {
    throw new StoreConfigError("secrets must be an object of key id to secret");
  }
  const entries = Object.keys(secrets).map((given) => {
    const id = requireKeyId("the key id " + JSON.stringify(given), given);
    return [id, requireSecret("the secret for key id " + id, secrets[given])];
  });
  if (entries.length === 0) {
    throw new StoreConfigError("the key ring names no secrets");
  }
  if (!entries.some(([id]) => id === writeKeyId)) {
    throw new StoreConfigError(
      "writeKeyId names key id " + writeKeyId +
      ", which the key ring holds no secret for");
  }
  /* "1" and "01" are one id and two entries. Whichever loses would
     shadow the other silently, and every record already written under
     the loser becomes unreadable with no way to tell that apart from
     tamper - the same failure the two-byte key id exists to keep out
     of reach, arriving through the ring instead of through the
     counter. */
  const seen = new Set();
  for (const [id] of entries) {
    if (seen.has(id)) {
      throw new StoreConfigError(
        "the key ring names key id " + id + " more than once, so one " +
        "secret would shadow the other");
    }
    seen.add(id);
  }

  const keys = new Map();
  for (const [id, secret] of entries) {
    for (const purpose of [PURPOSE.ROW, PURPOSE.DIRECTORY]) {
      keys.set(id + "/" + purpose, await subkey(secret, id, purpose));
    }
  }
  /* The subkeys exist, so this function's own copy of the secrets goes
     now rather than resting on an engine's judgment about which
     captured variables an inner closure keeps alive. What the handle
     below closes over is the key map. */
  entries.length = 0;

  async function seal(purpose, plaintext, context) {
    if (typeof plaintext !== "string") {
      throw new StoreConfigError("the plaintext must be a string");
    }
    const holder = context || {};
    const accountId = requireField("accountId", holder.accountId);
    const recordId = requireField("recordId", holder.recordId);
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    const sealed = new Uint8Array(await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData: boundData(purpose, accountId, recordId),
        tagLength: TAG_BYTES * 8,
      },
      keys.get(writeKeyId + "/" + purpose),
      UTF8.encode(plaintext)));
    const record = new Uint8Array(HEADER_BYTES + sealed.length);
    record[0] = VERSION;
    record[1] = (writeKeyId >> 8) & 0xff;
    record[2] = writeKeyId & 0xff;
    record.set(nonce, 3);
    record.set(sealed, HEADER_BYTES);
    return record;
  }

  async function open(purpose, record, context) {
    const holder = context || {};
    const accountId = requireField("accountId", holder.accountId);
    const recordId = requireField("recordId", holder.recordId);
    const bytes = asBytes(record);
    if (bytes.length < HEADER_BYTES + TAG_BYTES) refuse();
    if (bytes[0] !== VERSION) refuse();
    const key = keys.get(((bytes[1] << 8) | bytes[2]) + "/" + purpose);
    if (!key) refuse();
    let plaintext;
    try {
      plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: bytes.subarray(3, HEADER_BYTES),
          additionalData: boundData(purpose, accountId, recordId),
          tagLength: TAG_BYTES * 8,
        },
        key,
        bytes.subarray(HEADER_BYTES));
    } catch (error) {
      return refuse();
    }
    try {
      return FROM_UTF8.decode(plaintext);
    } catch (error) {
      return refuse();
    }
  }

  /* Four named operations rather than one taking a purpose string.
     The purpose is half of what binds a record to its slot, so it is
     chosen by which function the caller reaches for - a typo becomes a
     missing function at the call site instead of a record nothing can
     open. A new purpose is a new label and a new pair here, which is
     the review the derivation deserves. */
  return Object.freeze({
    sealRow: (plaintext, context) => seal(PURPOSE.ROW, plaintext, context),
    openRow: (record, context) => open(PURPOSE.ROW, record, context),
    sealDirectory: (plaintext, context) =>
      seal(PURPOSE.DIRECTORY, plaintext, context),
    openDirectory: (record, context) =>
      open(PURPOSE.DIRECTORY, record, context),
  });
}

/*
 * The door the Worker uses: a store built from the bindings.
 *
 *   STORE_SECRET                  the cipher secret. Required.
 *   STORE_SECRET_KEY_ID           the generation to write under.
 *                                 Defaults to 1.
 *   STORE_SECRET_PREVIOUS         the retiring generation, kept
 *                                 readable across a rotation.
 *   STORE_SECRET_PREVIOUS_KEY_ID  its id. Required whenever the
 *                                 previous secret is set, and distinct
 *                                 from the write id - two secrets
 *                                 sharing an id is the one mistake a
 *                                 rotation can make that looks like
 *                                 tamper afterwards.
 *
 * A third live generation is a third entry in the ring above, not a
 * format change.
 */
async function openStore(env) {
  const bindings = env || {};
  const writeKeyId = bindings.STORE_SECRET_KEY_ID === undefined
    ? 1
    : requireKeyId("STORE_SECRET_KEY_ID", bindings.STORE_SECRET_KEY_ID);
  const secrets = {};
  secrets[writeKeyId] = requireSecret("STORE_SECRET", bindings.STORE_SECRET);
  if (bindings.STORE_SECRET_PREVIOUS !== undefined) {
    const previousId = requireKeyId("STORE_SECRET_PREVIOUS_KEY_ID",
      bindings.STORE_SECRET_PREVIOUS_KEY_ID);
    if (previousId === writeKeyId) {
      throw new StoreConfigError(
        "STORE_SECRET_PREVIOUS_KEY_ID matches STORE_SECRET_KEY_ID, so one " +
        "generation would hide the other");
    }
    secrets[previousId] = requireSecret("STORE_SECRET_PREVIOUS",
      bindings.STORE_SECRET_PREVIOUS);
  }
  return openStoreWithKeys({ writeKeyId, secrets });
}

export { openStore, openStoreWithKeys, PURPOSE, VERSION, StoreFormatError,
         StoreConfigError };
