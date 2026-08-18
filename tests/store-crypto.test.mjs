/*
 * The at-rest encryption format, armed. 0.9-M1-S4 (#330), over
 * server/store-crypto.js.
 *
 *     node tests/store-crypto.test.mjs
 *
 * WHAT THIS ARM IS FOR. DESIGN.md, "Encryption" rules that a raw
 * database dump alone reveals nothing, and that the stored format
 * carries a version byte and a committed fixture that must always
 * decode. Those are properties of stored bytes, so they are checked
 * against stored bytes: the fixtures below are records this format
 * produced once, frozen, and decoded on every run.
 *
 * THE FIXTURE LIVES IN THIS FILE RATHER THAN BESIDE IT. tests/run.mjs
 * reds on any file under tests/ that is not an arm, deliberately - a
 * fixture wanted here needs its own NOT_ARMS line and an argument for
 * it. There is a better place than an exemption: the fixture is two
 * hex constants and their pinned SHA-256, and keeping them in the arm
 * that reads them means the bytes, the key that opens them and the
 * refusal to regenerate them are one screen apart instead of three
 * files apart. server/ is the other candidate and is worse - it is the
 * directory that gets deployed, and a test key committed there is a
 * test key inside the deployment.
 *
 * NEVER REGENERATE THESE FIXTURES. Ruled in DESIGN.md, "Encryption"
 * and carried verbatim by #330: if a fixture stops decoding, the
 * stored format changed and every stored row went with it. The remedy
 * is a NEW version byte and a decoder for BOTH, never a fresh fixture
 * pasted over the failing one - the fresh one passes and every real
 * row stays unreadable. FIXTURE_SHA256 below is the tripwire: it is
 * the hash of the frozen bytes, so editing the hex without editing the
 * hash reds, and editing both is a two-constant act nobody performs by
 * accident.
 *
 * THE KEY BELOW IS A TEST KEY AND ONLY A TEST KEY. It is a printable
 * sentence chosen so nobody can mistake it for a real secret, it opens
 * nothing but these two records, and no deployed Worker ever sees it.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MODULE = ROOT + "server/store-crypto.js";

let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) failures += 1;
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

const hex = (bytes) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (text) =>
  new Uint8Array((text.match(/../g) || []).map((pair) =>
    parseInt(pair, 16)));

async function sha256(bytes) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

/* Whatever it threw, described without assuming it is an Error. */
async function threw(work) {
  try {
    await work();
    return null;
  } catch (error) { return error; }
}

/* ------------------------------------------------------------------
 * THE COMMITTED v1 FIXTURE. Two records - one row, one directory -
 * sealed once under TEST_SECRET with the context named beside each,
 * and frozen. Read the NEVER REGENERATE paragraph above before
 * touching any constant in this block.
 */
const TEST_SECRET =
  "test-only store secret for the 0.9-M1-S4 fixture, committed on " +
  "purpose and deployed nowhere";
const TEST_KEY_ID = 1;

const FIXTURE = {
  row: {
    accountId: "acct-hmac-2f6c9a1b4e8d7350",
    recordId: "row-000000000000001",
    plaintext: "{\"weight\":180,\"unit\":\"lb\",\"note\":\"first sitting\"}",
    record: "",
  },
  directory: {
    accountId: "acct-hmac-2f6c9a1b4e8d7350",
    recordId: "dir-000000000000001",
    plaintext: "{\"handle\":\"@example\",\"display\":\"Example\"," +
      "\"role\":\"member\"}",
    record: "",
  },
};

/* SHA-256 over the frozen record bytes, one per fixture. The hash is
   the half a regeneration forgets. */
const FIXTURE_SHA256 = {
  row: "",
  directory: "",
};

/* ------------------------------------------------------------------ */

const source = await readFile(MODULE, "utf8").catch(() => null);
if (source === null) {
  console.log("FAIL  server/store-crypto.js exists");
  console.log("\nstore-crypto FAILED - the module is not in the tree, so " +
    "nothing below could run");
  process.exit(1);
}

let mod = null;
const importError = await threw(async () => {
  mod = await import("../server/store-crypto.js");
});
if (importError) {
  console.log("FAIL  server/store-crypto.js imports");
  console.log(String(importError && importError.stack || importError));
  console.log("\nstore-crypto FAILED - the module did not import, so " +
    "nothing below could run");
  process.exit(1);
}

const { openStoreWithKeys, openStore, PURPOSE, VERSION,
        StoreFormatError, StoreConfigError } = mod;

const keyring = { writeKeyId: TEST_KEY_ID, secrets: { 1: TEST_SECRET } };
const store = await openStoreWithKeys(keyring);

/* 1. THE FIXTURE DECODES. The whole reason a stored format is pinned. */
for (const name of ["row", "directory"]) {
  const fixture = FIXTURE[name];
  const bytes = unhex(fixture.record);
  const context = { accountId: fixture.accountId,
                    recordId: fixture.recordId };
  const opened = await threw(async () => name === "row"
    ? store.openRow(bytes, context)
    : store.openDirectory(bytes, context));
  const plain = opened instanceof Error ? null : opened;
  check("the committed v1 " + name + " fixture decodes to its pinned " +
    "plaintext" + (opened instanceof Error
      ? " - it threw " + opened.name + ". DO NOT REGENERATE IT: add a " +
        "version byte and a decoder for both (DESIGN.md, \"Encryption\")"
      : ""),
    plain === fixture.plaintext);
  check("the committed v1 " + name + " fixture's bytes match their " +
    "pinned SHA-256",
    bytes.length > 0 && await sha256(bytes) === FIXTURE_SHA256[name]);
  check("the committed v1 " + name + " fixture carries version byte " +
    VERSION,
    bytes.length > 0 && bytes[0] === VERSION);
}

/* 2. ROUND TRIP, both purposes. */
const rowContext = { accountId: "acct-hmac-aaaa", recordId: "row-1" };
const dirContext = { accountId: "acct-hmac-aaaa", recordId: "dir-1" };
const rowPlain = "{\"weight\":201.5}";
const dirPlain = "{\"handle\":\"@someone\"}";

const rowRecord = await store.sealRow(rowPlain, rowContext);
const dirRecord = await store.sealDirectory(dirPlain, dirContext);

check("a row round trips", await store.openRow(rowRecord, rowContext) ===
  rowPlain);
check("a directory record round trips",
  await store.openDirectory(dirRecord, dirContext) === dirPlain);

/* 3. THE LAYOUT IS THE DOCUMENTED ONE: version, key id, nonce,
   ciphertext+tag, with version and key id in the clear so a rotation
   never needs a new version. */
check("a sealed record leads with the version byte",
  rowRecord[0] === VERSION);
check("a sealed record carries the write key id in the clear, big-endian",
  ((rowRecord[1] << 8) | rowRecord[2]) === TEST_KEY_ID);
check("a sealed record is 15 header bytes plus the ciphertext and a " +
  "16-byte tag",
  rowRecord.length === 15 + new TextEncoder().encode(rowPlain).length + 16);
check("the plaintext is not anywhere in the record",
  !hex(rowRecord).includes(hex(new TextEncoder().encode(rowPlain))));

/* 4. NONCE FRESHNESS. Two seals of one plaintext under one context
   must differ, or the nonce came from something derived. */
const again = await store.sealRow(rowPlain, rowContext);
check("two seals of the same plaintext and context differ",
  hex(again) !== hex(rowRecord));
check("their nonces differ",
  hex(again.slice(3, 15)) !== hex(rowRecord.slice(3, 15)));
check("their ciphertexts differ",
  hex(again.slice(15)) !== hex(rowRecord.slice(15)));

/* 5. FAIL CLOSED, UNIFORMLY. Every way a record can be unreadable
   produces one opaque error carrying no field name, offset or reason.
   The set of messages collected here has to have exactly one member -
   that is the property, and checking each path alone would not see a
   second message appearing. */
const tampered = Uint8Array.from(rowRecord);
tampered[20] ^= 0x01;
const truncated = rowRecord.slice(0, rowRecord.length - 1);
const tagFlipped = Uint8Array.from(rowRecord);
tagFlipped[tagFlipped.length - 1] ^= 0x80;
const wrongVersion = Uint8Array.from(rowRecord);
wrongVersion[0] = VERSION + 1;
const unknownKeyId = Uint8Array.from(rowRecord);
unknownKeyId[1] = 0x7f;
unknownKeyId[2] = 0xfe;
const nonceMoved = Uint8Array.from(rowRecord);
nonceMoved[3] ^= 0x01;

const refusals = [
  ["a tampered ciphertext byte", () => store.openRow(tampered, rowContext)],
  ["a flipped tag bit", () => store.openRow(tagFlipped, rowContext)],
  ["a truncated record", () => store.openRow(truncated, rowContext)],
  ["an unknown version byte",
   () => store.openRow(wrongVersion, rowContext)],
  ["an unknown key id", () => store.openRow(unknownKeyId, rowContext)],
  ["a moved nonce byte", () => store.openRow(nonceMoved, rowContext)],
  ["an empty record", () => store.openRow(new Uint8Array(0), rowContext)],
  ["a header with no ciphertext",
   () => store.openRow(new Uint8Array(15), rowContext)],
  ["something that is not bytes at all",
   () => store.openRow("not bytes", rowContext)],
  ["a row opened under another account",
   () => store.openRow(rowRecord,
     { accountId: "acct-hmac-bbbb", recordId: "row-1" })],
  ["a row opened under another record id",
   () => store.openRow(rowRecord,
     { accountId: "acct-hmac-aaaa", recordId: "row-2" })],
  ["a row opened as a directory record",
   () => store.openDirectory(rowRecord, rowContext)],
  ["a directory record opened as a row",
   () => store.openRow(dirRecord, dirContext)],
  ["a row opened under a different secret", async () => {
    const other = await openStoreWithKeys({ writeKeyId: 1,
      secrets: { 1: TEST_SECRET + " but not the same one at all" } });
    return other.openRow(rowRecord, rowContext);
  }],
];

const messages = new Set();
for (const [label, work] of refusals) {
  const error = await threw(work);
  check(label + " is refused",
    error instanceof StoreFormatError && error instanceof Error);
  if (error) messages.add(String(error.message));
}
check("every refusal above carries ONE message, with no field name, " +
  "offset or reason - saw " + JSON.stringify([...messages]),
  messages.size === 1);
check("that message names nothing about the record",
  [...messages].every((m) =>
    !/version|nonce|tag|key|account|purpose|offset|byte|length/i.test(m)));

/* 6. THE AAD IS UNAMBIGUOUS. Length-prefixed fields, so a record
   sealed for account "ab"/record "c" cannot open as "a"/"bc" - the
   concatenation both would produce is the same string, and only the
   prefixes tell them apart. */
const split = await store.sealRow("boundary", { accountId: "ab",
  recordId: "c" });
const slid = await threw(() => store.openRow(split, { accountId: "a",
  recordId: "bc" }));
check("the account/record boundary cannot be slid (length-prefixed AAD)",
  slid instanceof StoreFormatError);
check("the same record still opens under its own boundary",
  await store.openRow(split, { accountId: "ab", recordId: "c" }) ===
    "boundary");

/* 7. ROTATION NEEDS NO NEW VERSION. A second generation reads what the
   first sealed and stamps its own id on what it writes. */
const rotated = await openStoreWithKeys({
  writeKeyId: 2,
  secrets: { 1: TEST_SECRET, 2: TEST_SECRET + " generation two" },
});
check("a record sealed under key id 1 still opens after rotation",
  await rotated.openRow(rowRecord, rowContext) === rowPlain);
const freshRecord = await rotated.sealRow(rowPlain, rowContext);
check("what the rotated store writes carries key id 2",
  ((freshRecord[1] << 8) | freshRecord[2]) === 2);
check("the rotated store's records carry the SAME version byte",
  freshRecord[0] === VERSION);
check("the pre-rotation store cannot read a post-rotation record",
  await threw(() => store.openRow(freshRecord, rowContext))
    instanceof StoreFormatError);

/* 8. NO KEY MATERIAL ANYWHERE IT COULD LEAK. The canary is the secret
   itself: if any error, any thrown object's own properties, or the
   store handle serializes it, the substring is there to find. */
const CANARY = "ZQ7X-KEYMATERIAL-CANARY-8842";
const canaryStore = await openStoreWithKeys({ writeKeyId: 1,
  secrets: { 1: "store secret carrying " + CANARY + " and nothing else" } });
const canaryRecord = await canaryStore.sealRow("x", rowContext);
const canaryTampered = Uint8Array.from(canaryRecord);
canaryTampered[canaryTampered.length - 1] ^= 0xff;

const leakSurfaces = [];
const canaryError = await threw(() =>
  canaryStore.openRow(canaryTampered, rowContext));
leakSurfaces.push(String(canaryError.message), String(canaryError.stack),
  String(canaryError), JSON.stringify(canaryError),
  JSON.stringify(Object.getOwnPropertyNames(canaryError)
    .map((n) => canaryError[n])));
leakSurfaces.push(JSON.stringify(canaryStore),
  JSON.stringify(Object.keys(canaryStore)), String(canaryStore.openRow),
  String(canaryStore.sealRow));
const configError = await threw(() => openStoreWithKeys({ writeKeyId: 9,
  secrets: { 1: "store secret carrying " + CANARY + " and nothing else" } }));
leakSurfaces.push(String(configError && configError.message),
  String(configError && configError.stack));
check("no error, thrown object or store handle carries the secret",
  leakSurfaces.every((text) => !text.includes(CANARY)));
check("the store handle serializes to nothing at all",
  JSON.stringify(canaryStore) === "{}");
check("the store handle exposes exactly the four sealed operations",
  JSON.stringify(Object.keys(canaryStore).sort()) ===
    JSON.stringify(["openDirectory", "openRow", "sealDirectory",
                    "sealRow"]));
check("the store handle is frozen", Object.isFrozen(canaryStore));

/* 9. THE KEYS ARE NON-EXTRACTABLE, checked where it can be: the module
   never exports a key, and every importKey/deriveKey call passes the
   one named constant that spells the extractable flag. A count rather
   than an argument-position parse - the constant exists so this can be
   counted instead of parsed. */
const derivations = (source.match(/subtle\.importKey\(/g) || []).length +
  (source.match(/subtle\.deriveKey\(/g) || []).length;
const notExtractable = (source.match(/NOT_EXTRACTABLE/g) || []).length - 1;
check("the module never calls exportKey",
  !source.includes("exportKey"));
check("every importKey/deriveKey passes NOT_EXTRACTABLE - " + derivations +
  " call(s), " + notExtractable + " use(s)",
  derivations > 0 && derivations === notExtractable);
check("the module names no cipher primitive other than AES-GCM",
  !/AES-CBC|AES-CTR|RSA-OAEP|createCipher/i.test(source));
check("the module imports nothing", !/^\s*import\s/m.test(source));

/* 10. ACCOUNT_SECRET IS NEVER A CIPHER KEY. The rule is that it stays
   HMAC-only (DESIGN.md, "The identifier is the whole problem" keys the
   account id to it), so this module must not so much as know its
   name. */
check("the module never names ACCOUNT_SECRET",
  !source.includes("ACCOUNT_SECRET"));
check("the module reserves STORE_SECRET as its own secret",
  source.includes("STORE_SECRET"));

/* 11. THE DUMP LINE IS IN THE DOCSTRING, because the honest statement
   of what a dump still shows is part of the format, not commentary on
   it - DESIGN.md, "Threat model, honestly stated" is where the reader
   goes next. */
check("the docstring says the directory is inside the ciphertext",
  /directory included/i.test(source) && /inside the ciphertext/i.test(source));
check("the docstring says what a dump still shows",
  /row counts?/i.test(source) && /timestamps?/i.test(source) &&
  /no padding/i.test(source));
check("the docstring forbids regenerating a failing fixture",
  /never regenerate/i.test(source));

/* 12. THE ENV DOOR. openStore(env) is the shape S6 wires; a missing or
   too-short STORE_SECRET is a configuration failure and says so
   loudly, which is the opposite of the decode path's silence and is
   the difference between an operator error and an attacker probe. */
const envStore = await openStore({ STORE_SECRET: TEST_SECRET });
check("openStore(env) round trips through STORE_SECRET",
  await envStore.openRow(await envStore.sealRow(rowPlain, rowContext),
    rowContext) === rowPlain);
check("openStore(env) defaults to key id 1",
  ((await envStore.sealRow("x", rowContext))[1] << 8 |
   (await envStore.sealRow("x", rowContext))[2]) === 1);
check("a missing STORE_SECRET is a loud configuration failure",
  await threw(() => openStore({})) instanceof StoreConfigError);
check("a short STORE_SECRET is refused",
  await threw(() => openStore({ STORE_SECRET: "short" }))
    instanceof StoreConfigError);
check("a previous generation without its key id is refused",
  await threw(() => openStore({ STORE_SECRET: TEST_SECRET,
    STORE_SECRET_PREVIOUS: TEST_SECRET + " two" }))
    instanceof StoreConfigError);
check("a previous generation reusing the write key id is refused",
  await threw(() => openStore({ STORE_SECRET: TEST_SECRET,
    STORE_SECRET_PREVIOUS: TEST_SECRET + " two",
    STORE_SECRET_PREVIOUS_KEY_ID: "1" })) instanceof StoreConfigError);
check("openStore(env) reads a previous generation when both are given",
  await (await openStore({ STORE_SECRET: TEST_SECRET + " generation two",
    STORE_SECRET_KEY_ID: "2", STORE_SECRET_PREVIOUS: TEST_SECRET,
    STORE_SECRET_PREVIOUS_KEY_ID: "1" })).openRow(rowRecord, rowContext) ===
    rowPlain);

/* 13. CALLER BUGS ARE LOUD, and deliberately NOT the opaque refusal:
   an empty account id is an uninitialized variable in the Worker, not
   an attacker probe, and binding "" into the AAD would let two records
   that both forgot the id open each other. */
check("an empty account id is a loud caller failure",
  await threw(() => store.sealRow("x", { accountId: "",
    recordId: "row-1" })) instanceof StoreConfigError);
check("a missing record id is a loud caller failure",
  await threw(() => store.sealRow("x", { accountId: "a" }))
    instanceof StoreConfigError);
check("a non-string plaintext is a loud caller failure",
  await threw(() => store.sealRow({ weight: 1 }, rowContext))
    instanceof StoreConfigError);
check("PURPOSE names exactly the two purposes and is frozen",
  Object.isFrozen(PURPOSE) &&
  JSON.stringify(PURPOSE) === JSON.stringify({ ROW: "row",
                                               DIRECTORY: "dir" }));

const EXPECTED = 62;
console.log(failures
  ? `\nstore-crypto FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\nstore-crypto ran ${performed} checks, expected ${EXPECTED}`
    : `\nstore-crypto OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
