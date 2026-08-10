/*
 * The member's device key: what it is, what it refuses, and what Sign
 * out destroys.
 *
 * WHAT THIS SUITE CAN AND CANNOT REACH, said first because the split is
 * unusual here and reading past it would make the coverage look wider
 * than it is.
 *
 * `crypto.subtle` is real under Node, so everything about the KEY is
 * exercised against the shipped bytes: it is a P-256 ECDH pair, its
 * private half cannot be exported by anything, its public half can, and
 * `apps/web/crypto.js` seals to it and opens what it sealed. That last
 * one is the whole point of the module and it is proven end to end.
 *
 * `indexedDB` is NOT real under Node, and this file does not invent one.
 * A fake database would prove that a fake database works; what it would
 * not prove is the thing that matters - that the shipped file asks for
 * its own database, keyed the way #56 and #65 require. So the custody
 * RULES are exercised as functions over records - the shape half pure
 * and synchronous, the halves-agree half against real WebCrypto - the
 * storage calls are read off the source, and the round trip through a
 * real IndexedDB is a browser claim rather than a Node one. Where a
 * claim is a browser claim it says so here rather than being quietly
 * omitted.
 */
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { suite } from "./harness.mjs";

const HERE = (p) => new URL(p, import.meta.url);

const source = await readFile(HERE("../apps/web/memberkey.js"), "utf8");

/*
 * Loaded the way a page loads it - the shipped bytes, evaluated with no
 * document - rather than imported. The file assigns a global, which is
 * what the module-shape rule in AGENTS.md is about, and an import would
 * not see that at all.
 */
const globalsBefore = new Set(Object.keys(globalThis));
new Function(source)();
const Keys = globalThis.BinderMemberKey;

const { check, report } = suite("memberkey.js", 66);

/* ------------------------------------------------------------------ */
/* The module's shape.                                                 */

await check("the file publishes exactly one global", () =>
  Object.keys(globalThis).filter((name) => !globalsBefore.has(name))
    .join(",") === "BinderMemberKey");

await check("and it is frozen, like every other module here", () =>
  Object.isFrozen(Keys));

/*
 * The key set as a whole, not the presence of the members this file
 * happens to use. submit.js and signout.js both build against this
 * object, so adding or removing a member is a change to an interface
 * two files depend on rather than a refactor - the same reason
 * dev/query.test.mjs pins BinderQuery's key set.
 */
await check("the exported surface is the one two other files build on", () =>
  Object.keys(Keys).slice().sort().join(",") ===
    ["DB_NAME", "ROW_KEY", "STORE_NAME", "custodyRuling", "custodyVerdict",
      "ensure", "forget", "unavailableReason"].sort().join(","));

/*
 * Its own database, and this arm is the mechanical half of an argument
 * DESIGN.md makes in prose. The keyholder's working copy lives in
 * `hgb-keyholder-key` on admin.html; sharing one database would mean two
 * features negotiating a version number to add a store, and it would put
 * a member's key one `getAll` away from a page whose whole job is
 * holding the corpus in the clear.
 */
await check("the device key gets a database of its own", () =>
  Keys.DB_NAME === "hgb-member-key" && Keys.DB_NAME !== "hgb-keyholder-key");

/*
 * Read off the source, because "where does this key live" is not a
 * question the exported API can be asked. Session material is
 * sessionStorage by DESIGN.md; the prefill is localStorage; this is
 * neither, and a slice that moved it into either would be moving
 * exportable bytes into storage a script can read back as a string.
 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

await check("the key touches neither web storage", () =>
  !/\blocalStorage\b/.test(code) && !/\bsessionStorage\b/.test(code));

/* ------------------------------------------------------------------ */
/* The key itself.                                                     */

/*
 * THE ASSERTION THE DESIGN SPIKE ASKED FOR BY NAME, and labelled
 * unverified when it asked: that generating with `extractable: false`
 * leaves the PUBLIC half exportable anyway. crypto.js's `encryptTo`
 * needs those 65 bytes and refuses a recipient it cannot read back, so
 * if the spec did not work this way the whole mechanism would be
 * unbuildable rather than slightly different.
 *
 * The arguments are READ OFF THE SHIPPED FILE rather than written here.
 * A suite that generated its own pair with its own arguments would prove
 * what WebCrypto does and nothing at all about what this file asks for -
 * and "asks for an extractable private key" is precisely the mutation
 * that has to fail.
 */
const generateCall =
  /generateKey\(\s*\{\s*name:\s*"ECDH",\s*namedCurve:\s*([\w"-]+)\s*\},\s*(\w+),\s*\[([^\]]*)\]/
    .exec(code);

/*
 * The curve may be a literal or the named constant crypto.js also uses,
 * and both are resolved here rather than one of them being assumed. A
 * constant that quietly became P-384 would leave every arm below green
 * against a key crypto.js cannot seal to.
 */
const curve = generateCall && (/^"/.test(generateCall[1])
  ? generateCall[1].replace(/"/g, "")
  : (new RegExp("const " + generateCall[1] + ' = "([^"]+)"').exec(code) ||
      [])[1]);

await check("the shipped file asks for a P-256 ECDH pair", () =>
  Boolean(generateCall) && curve === "P-256");

await check("and asks for it non-extractable, in the file rather than here",
  () => generateCall[2] === "false");

await check("with deriveBits and nothing else", () =>
  generateCall[3].replace(/\s|"/g, "") === "deriveBits");

const pair = await crypto.subtle.generateKey(
  { name: "ECDH", namedCurve: curve }, generateCall[2] === "true",
  generateCall[3].replace(/\s|"/g, "").split(",").filter(Boolean));

await check("the private half cannot be exported by anything", async () => {
  if (pair.privateKey.extractable) return false;
  try {
    await crypto.subtle.exportKey("jwk", pair.privateKey);
    return false;
  } catch (error) {
    return true;
  }
});

await check("the public half still exports as the 65 bytes the format " +
  "needs", async () => {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw",
    pair.publicKey));
  return pair.publicKey.extractable === true && raw.length === 65 &&
    raw[0] === 4;
});

/*
 * And the end-to-end claim, which is the only one that says the key is
 * USEFUL rather than merely well-formed: crypto.js seals a record to
 * this pair and opens it again with the private half, as a CryptoKey,
 * never as bytes. `asPrivateKey` takes a CryptoKey directly, which is
 * what makes a non-extractable key a usable recipient at all.
 */
const cryptoSource = await readFile(HERE("../apps/web/crypto.js"), "utf8");
new Function(cryptoSource)();
const Crypto = globalThis.BinderCrypto;

const RECORD = { kg: 91.5, at: "2026-08-09" };

await check("crypto.js seals to this key and opens it again", async () => {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw",
    pair.publicKey));
  const base64 = btoa(String.fromCharCode(...raw));
  const blob = await Crypto.encryptTo(RECORD, [base64]);
  const back = await Crypto.decrypt(blob, pair.privateKey);
  return JSON.stringify(back) === JSON.stringify(RECORD);
});

await check("and a different device key opens nothing of the first one's",
  async () => {
    const other = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw",
      pair.publicKey));
    const blob = await Crypto.encryptTo(RECORD,
      [btoa(String.fromCharCode(...raw))]);
    try {
      await Crypto.decrypt(blob, other.privateKey);
      return false;
    } catch (error) {
      // The envelope's refusal rather than the single-recipient one. A
      // second device key is a v2 row by construction, and a member
      // reading "sealed to different keys" about a row that has two
      // blocks neither of which is theirs is being told the wrong thing.
      return /none of this row's recipient blocks opened/.test(error.message);
    }
  });

/* ------------------------------------------------------------------ */
/* Custody: whose key is this, and what happens when it is not yours.  */

/*
 * WHAT THIS SECTION IS AND IS NOT ABOUT, because the two properties
 * that sound alike are kept by different mechanisms.
 *
 * A shared browser not handing the next member the previous member's
 * key is the KEY PATH's doing, and it is structural - the store reads
 * its key out of the record, so a lookup for one account cannot return
 * another's. That is asserted above, off the source, and confirmed in a
 * real IndexedDB rather than here.
 *
 * These arms are the narrower rule: a record filed under THIS account
 * that does not vouch for itself is destroyed and replaced, never
 * adopted. Everything unvouchable lands on one verdict, which is the
 * fail-closed half - a key of unknown provenance sealing a member's
 * entries is a row nobody can open, discovered on export day.
 */
const good = () => ({
  accountId: "a".repeat(64),
  privateKey: pair.privateKey,
  publicKeyRaw: new Uint8Array(65),
  createdAt: "2026-08-09T00:00:00.000Z",
});

await check("a record for this account is used", () =>
  Keys.custodyVerdict(good(), "a".repeat(64)) === "use");

await check("no record at all means generate one", () =>
  Keys.custodyVerdict(null, "a".repeat(64)) === "generate" &&
  Keys.custodyVerdict(undefined, "a".repeat(64)) === "generate");

await check("another member's record is ERASED, not skipped", () =>
  Keys.custodyVerdict(good(), "b".repeat(64)) === "erase");

await check("a record with no account on it is erased", () => {
  const record = good();
  delete record.accountId;
  return Keys.custodyVerdict(record, "a".repeat(64)) === "erase";
});

/*
 * Case matters, and this arm is why the comparison is strict. An account
 * id is lower-case hex from an HMAC, but `wrangler d1 execute` has
 * already put upper-case hex in the clear column once - server/worker.js
 * carries a COLLATE NOCASE for exactly that. Here the safe direction is
 * the opposite one: a record whose id merely case-folds to this member's
 * is a record this file did not write, and it is erased.
 */
await check("an account id that only case-folds to this one is erased", () => {
  // The RECORD carries the folded form and the caller carries the real
  // one, which is the only arrangement that tests the comparison. The
  // other way round tests the account-id pattern instead - "A" is not
  // hex to it - and passes whatever the comparison does.
  const record = good();
  record.accountId = "A".repeat(64);
  return Keys.custodyVerdict(record, "a".repeat(64)) === "erase";
});

await check("a record carrying no private key is erased", () => {
  const record = good();
  record.privateKey = null;
  return Keys.custodyVerdict(record, "a".repeat(64)) === "erase";
});

/*
 * An EXTRACTABLE private key in this store was not written by this file,
 * because this file cannot produce one. Whatever put it there could read
 * it out again, so it is destroyed rather than adopted - the one arm
 * here that catches a key which is otherwise perfectly well-formed.
 */
await check("a private key something could export is erased", async () => {
  const soft = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const record = good();
  record.privateKey = soft.privateKey;
  return Keys.custodyVerdict(record, "a".repeat(64)) === "erase";
});

await check("a public half of the wrong length is erased", () => {
  const record = good();
  record.publicKeyRaw = new Uint8Array(64);
  return Keys.custodyVerdict(record, "a".repeat(64)) === "erase";
});

await check("a public half that is not bytes at all is erased", () => {
  const record = good();
  record.publicKeyRaw = "BBBB";
  return Keys.custodyVerdict(record, "a".repeat(64)) === "erase";
});

/*
 * THE THREE SHAPES THAT MEASURE 65 AND ARE NOT BYTES - the #154 sweep's
 * F-7, armed here because #85's seal half has just given the value a
 * real consumer.
 *
 * Each of them passes a length test and each walks to nothing under
 * `String.fromCharCode.apply(null, raw)`, so each would be ADOPTED and
 * then hand form.js an empty public key. The failure that follows is
 * silent and permanent: the browser holds a good private key, seals
 * every entry to the keyholder alone because the public half is falsy,
 * and the member's own pane stays empty forever with nothing anywhere
 * saying why.
 *
 * The verdict is checked AND the consequence is checked, because the
 * two are different claims: erasing is what the rule says, and an empty
 * public half is what adopting would cost. An arm on the verdict alone
 * would keep passing if `usable` later learned to accept these.
 */
for (const [what, value] of [
  ["an ArrayBuffer", new ArrayBuffer(65)],
  ["a DataView over one", new DataView(new ArrayBuffer(65))],
  ["a bare object claiming the length", { byteLength: 65 }],
]) {
  await check("a public half that is " + what + " is erased, not adopted",
    () => {
      const record = good();
      record.publicKeyRaw = value;
      return Keys.custodyVerdict(record, "a".repeat(64)) === "erase";
    });
}

await check("and the reason: none of those three carries any bytes to read",
  () => [new ArrayBuffer(65), new DataView(new ArrayBuffer(65)),
    { byteLength: 65 }].every((value) =>
    String.fromCharCode.apply(null, value) === ""));

/*
 * THE FOURTH SHAPE, and it is why the three above are shapes somebody
 * thought of rather than the class itself.
 *
 * `Object.prototype.toString` is not a brand check. `Symbol.toStringTag`
 * overrides what it answers, so any object at all can call itself
 * "[object Uint8Array]" - and there is no realm in which a genuine one
 * behaves differently, so the tag buys the cross-realm tolerance it was
 * chosen for and buys no custody at all.
 *
 * What closes the class is the walk the consumers really perform.
 * `usable` turns the value into base64 by reading it BY INDEX, and
 * `generateFor` measures the bytes it exported with `.length` - so
 * `.length` is the length that matters. `byteLength` is a property all
 * four of these carry and none of them has to walk to anything.
 *
 * Two spoofs, because they fail differently and the second is the worse
 * one. The first claims the tag alone and walks to nothing, which is the
 * empty-public-half failure the three arms above describe. The second
 * claims the tag AND the length: it walks to sixty-five characters, so
 * the public half comes back non-empty and TRUTHY, and form.js seals a
 * member's entries to a key nothing ever generated.
 */
await check("a public half that only claims the Uint8Array tag is erased",
  () => {
    const record = good();
    record.publicKeyRaw = {
      byteLength: 65,
      get [Symbol.toStringTag]() { return "Uint8Array"; },
    };
    return Keys.custodyVerdict(record, "a".repeat(64)) === "erase";
  });

await check("and one claiming the tag and the length, holding no bytes",
  () => {
    const record = good();
    record.publicKeyRaw = {
      length: 65,
      byteLength: 65,
      get [Symbol.toStringTag]() { return "Uint8Array"; },
    };
    return Keys.custodyVerdict(record, "a".repeat(64)) === "erase";
  });

await check("and the reason the tag cannot be the test: it is writable",
  () => Object.prototype.toString.call({
    get [Symbol.toStringTag]() { return "Uint8Array"; },
  }) === "[object Uint8Array]");

await check("and the reason the second is worse: it walks to a whole key",
  () => String.fromCharCode.apply(null, { length: 65 }) ===
    String.fromCharCode(0).repeat(65));

await check("a record that is not an object is erased", () =>
  Keys.custodyVerdict("mine", "a".repeat(64)) === "erase" &&
  Keys.custodyVerdict(42, "a".repeat(64)) === "erase");

/*
 * And the caller's side of the same rule. An account id this file cannot
 * vouch for must never select a record: `undefined === undefined` would
 * otherwise make a record with no account match a caller with no
 * account, which is the shape of every one of these failures.
 */
await check("no account id means no record is anybody's", () =>
  Keys.custodyVerdict(good(), null) === "erase" &&
  Keys.custodyVerdict(good(), undefined) === "erase" &&
  Keys.custodyVerdict(good(), "") === "erase");

/* ------------------------------------------------------------------ */
/* Custody, second half: are those two halves two halves of one key?   */

/*
 * THE QUESTION EVERY ARM ABOVE IS UNABLE TO ASK.
 *
 * Each of those judges `publicKeyRaw` by what it looks like: sixty-five
 * values, readable by index, tagged as bytes. A GENUINE `Uint8Array` of
 * sixty-five attacker-chosen bytes satisfies every one of them, survives
 * `structuredClone` into IndexedDB, and carries no mark at all of who
 * wrote it. Nothing about its shape is wrong; what is wrong is whose it
 * is.
 *
 * Adopting one is the gravest outcome this file has. The member keeps a
 * good private key, `usable` hands form.js a well-formed public half,
 * and every entry from then on seals to a key the member cannot open -
 * with the page showing nothing unusual, because nothing unusual has
 * happened yet. It surfaces on export day, over rows already written.
 *
 * WHY AGREEMENT AND NOT A SIGNATURE: the stored private key is
 * `deriveBits`-only by construction and could not sign a challenge if
 * this file asked it to. ECDH runs from both ends instead, and the two
 * secrets are equal exactly when the halves are two ends of one pair.
 *
 * These arms run against REAL WEBCRYPTO - Node's is the browser's - so
 * they exercise the derivation rather than a description of it. What
 * they cannot reach is `ensure` erasing and regenerating on this
 * verdict, which needs a real IndexedDB; that is a browser claim, made
 * in the pull request and labelled there.
 */
const foreign = await crypto.subtle.generateKey(
  { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);

const rawOf = async (key) =>
  new Uint8Array(await crypto.subtle.exportKey("raw", key));

/*
 * A record built the way `generateFor` builds one: a private key and the
 * exported public half of whichever pair is named. Passing two different
 * pairs is how the poisoned row is written.
 */
const filed = async (privateHalf, publicHalf) => ({
  accountId: "a".repeat(64),
  privateKey: privateHalf,
  publicKeyRaw: await rawOf(publicHalf),
  createdAt: "2026-08-09T00:00:00.000Z",
});

await check("the two halves of one real pair are adopted", async () =>
  (await Keys.custodyRuling(await filed(pair.privateKey, pair.publicKey),
    "a".repeat(64))) === "use");

/*
 * THE ARM THIS SECTION EXISTS FOR. Both halves are genuine, both are the
 * right shape, and they are halves of different keypairs - which is
 * exactly what a poisoned row looks like when whoever wrote it knows
 * what a P-256 point is.
 */
await check("a genuine public half of somebody else's pair is ERASED",
  async () =>
    (await Keys.custodyRuling(await filed(pair.privateKey, foreign.publicKey),
      "a".repeat(64))) === "erase");

/*
 * And the measurement that says the arm above is about something: the
 * shape rule adopts that identical record. Without this, a ruling that
 * simply forwarded the shape verdict would pass the arm above the day
 * somebody made the two halves match by accident.
 */
await check("and nothing in its shape refuses it - the shape rule adopts it",
  async () =>
    Keys.custodyVerdict(await filed(pair.privateKey, foreign.publicKey),
      "a".repeat(64)) === "use");

/*
 * Sixty-five bytes that are not a point at all. `good()` above carries
 * exactly this - sixty-five zeros - which is why it is still the fixture
 * the shape arms use and no longer a record this file would keep.
 */
await check("sixty-five bytes that are no point on the curve are erased",
  async () => {
    const flat = new Uint8Array(65);
    const prefixed = new Uint8Array(65);
    prefixed[0] = 4;
    prefixed.fill(9, 1);
    for (const raw of [flat, prefixed]) {
      const record = await filed(pair.privateKey, pair.publicKey);
      record.publicKeyRaw = raw;
      if ((await Keys.custodyRuling(record, "a".repeat(64))) !== "erase") {
        return false;
      }
    }
    return true;
  });

/*
 * The platform fact the on-curve half of the rule stands on, asserted
 * rather than assumed: WebCrypto will not import those bytes as a point,
 * so the import is a real check and its throw is a real refusal.
 */
await check("and the reason: WebCrypto refuses to import them at all",
  async () => {
    try {
      await crypto.subtle.importKey("raw", new Uint8Array(65),
        { name: "ECDH", namedCurve: "P-256" }, false, []);
      return false;
    } catch (error) {
      return true;
    }
  });

/*
 * A pair whose halves DO match, on a private key that cannot derive.
 * The test cannot be performed, and "cannot be performed" has to land on
 * erase rather than on adopt - a record this file cannot vouch for is
 * refused whether the answer was no or there was no answer.
 */
await check("a private key that cannot derive is erased, not adopted",
  async () => {
    const mute = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
    return (await Keys.custodyRuling(await filed(mute.privateKey,
      mute.publicKey), "a".repeat(64))) === "erase";
  });

await check("what the shape rule refuses, the ruling refuses too", async () =>
  (await Keys.custodyRuling(null, "a".repeat(64))) === "generate" &&
  (await Keys.custodyRuling(await filed(pair.privateKey, pair.publicKey),
    "b".repeat(64))) === "erase" &&
  (await Keys.custodyRuling(good(), null)) === "erase");

/*
 * NOTHING IS REMEMBERED, and the third call is the half that matters.
 * A verdict cached on the module would answer for the record it first
 * saw, and the record is precisely the thing an attacker replaces - so
 * a cache would let a poisoned row inherit a clean row's answer, and
 * would let one poisoned row condemn every later clean one.
 */
await check("the halves are re-checked on every call, never remembered",
  async () => {
    const record = await filed(pair.privateKey, pair.publicKey);
    const first = await Keys.custodyRuling(record, "a".repeat(64));
    record.publicKeyRaw = await rawOf(foreign.publicKey);
    const second = await Keys.custodyRuling(record, "a".repeat(64));
    const third = await Keys.custodyRuling(
      await filed(pair.privateKey, pair.publicKey), "a".repeat(64));
    return first === "use" && second === "erase" && third === "use";
  });

await check("and the record is not marked on the way past", async () => {
  const record = await filed(pair.privateKey, pair.publicKey);
  await Keys.custodyRuling(record, "a".repeat(64));
  return Reflect.ownKeys(record).sort().join(",") ===
    "accountId,createdAt,privateKey,publicKeyRaw";
});

/*
 * The throwaway pair, read off the source for the same reason the
 * member's own pair is: a suite that generated its own would prove what
 * WebCrypto does and nothing about what this file asks for. Every
 * `generateKey` in the file is covered rather than the first one, so a
 * second pair cannot arrive with weaker arguments than the first.
 */
const generateCalls = [...code.matchAll(
  /generateKey\(\s*\{\s*name:\s*"ECDH",\s*namedCurve:\s*([\w"-]+)\s*\},\s*(\w+),\s*\[([^\]]*)\]/g)];

await check("every pair this file makes is non-extractable and derive-only",
  () => generateCalls.length === 2 && generateCalls.every((one) =>
    one[2] === "false" && one[3].replace(/\s|"/g, "") === "deriveBits"));

/*
 * The stored public half is imported with NO usage at all, which is what
 * WebCrypto requires of an ECDH public key and what says this import is
 * a validity check rather than a key being put to work. Non-extractable
 * for the same reason everything else here is: there is no path by which
 * a poisoned point should become bytes this page can hand anywhere.
 */
const importCall = /importKey\(\s*\n?\s*"raw", record\.publicKeyRaw,\s*\n?\s*\{\s*name:\s*"ECDH",\s*namedCurve:\s*(\w+)\s*\},\s*(\w+),\s*\[([^\]]*)\]/
  .exec(code);

await check("the record's public half is imported as a point on the curve",
  () => Boolean(importCall) && importCall[1] === "CURVE" &&
    importCall[2] === "false" && importCall[3].trim() === "");

const agreeBody =
  /async function halvesAgree\(record\) \{([\s\S]*?)\n {2}\}/.exec(code);
const compareLoop = agreeBody &&
  /for \(let i = 0; i < SECRET_BYTES; i\+\+\) \{([\s\S]*?)\n {6}\}/
    .exec(agreeBody[1]);

/*
 * COUNTED, AND TO THE END. A comparison that returns on the first
 * differing byte answers in a time that depends on how much of the
 * secret the caller guessed right - and while the caller here is a
 * record in a database rather than a network peer, the shape is one
 * nobody should have to re-derive the safety of. A fixed count also
 * means a short secret cannot end the walk early with the accumulator
 * still clean.
 */
await check("the two secrets are compared byte by byte, to the end", () =>
  Boolean(compareLoop) && /\|=/.test(compareLoop[1]) &&
  /\^/.test(compareLoop[1]) &&
  !/\breturn\b|\bbreak\b/.test(compareLoop[1]));

/*
 * And never as text. `btoa` of a shared secret, a `join`, a `toString` -
 * each turns thirty-two bytes into a string that lives until the garbage
 * collector gets to it and compares by a path nobody controls.
 */
await check("and never as strings - no base64, no join, no text compare",
  () => Boolean(agreeBody) &&
    !/btoa|String\.fromCharCode|\.join\(|JSON\.|toString\(/.test(agreeBody[1]));

await check("the throwaway pair is never stored, returned or written down",
  () => Boolean(agreeBody) &&
    !/store\.|\.put\(|console\.|return ephemeral/.test(agreeBody[1]));

/*
 * The wiring, which is the one claim here that is textual rather than
 * behavioral: `ensure` has to act on the RULING. Calling the shape
 * verdict instead would leave every arm above green over a file that
 * still adopts the poisoned row, so the arm asks for the ruling by name
 * AND for the shape verdict's absence from that function.
 */
const ensureBody =
  /async function ensure\(accountId\) \{([\s\S]*?)\n {2}\}/.exec(code);

await check("ensure decides on the ruling, not on the shape rule alone",
  () => Boolean(ensureBody) &&
    /await custodyRuling\(record, accountId\)/.test(ensureBody[1]) &&
    !/custodyVerdict\(/.test(ensureBody[1]));

/*
 * ERASE MEANS THE STORE, not the row that was read. The new cause routes
 * into the same path the old ones use, and a `delete` on one key would
 * leave the rest of a store this file did not write sitting there.
 */
await check("and an erase still clears the whole store, never one row",
  () => Boolean(ensureBody) &&
    /verdict === "erase"[\s\S]{0,240}store\.clear\(\)/.test(ensureBody[1]) &&
    !/store\.delete\(/.test(code));

/*
 * NO MIGRATION. The cross-check is computed, never stored, so a key a
 * member's browser made yesterday is adopted today without a new field
 * to fill in or a version to upgrade past. A record that had to carry
 * proof of itself would make every existing one unvouchable, and "erase,
 * never skip" would then destroy every legitimate key in the field.
 */
const storedFields = /return \{([\s\S]*?)\n {4}\};/.exec(
  (/async function generateFor\(accountId\) \{([\s\S]*?)\n {2}\}/
    .exec(code) || ["", ""])[1]);

await check("nothing new is stored, and the database version does not move",
  () => Boolean(storedFields) &&
    [...storedFields[1].matchAll(/^\s*(\w+):/gm)].map((one) => one[1])
      .sort().join(",") === "accountId,createdAt,privateKey,publicKeyRaw" &&
    /factory\.open\(DB_NAME, 1\)/.test(code));

/* ------------------------------------------------------------------ */
/* No database: the path a member must never notice.                   */

/*
 * A browser with no IndexedDB - private mode in some browsers, storage
 * blocked, an origin the user has locked down - must not be a browser
 * where submitting fails. The convenience key is missing; the entry is
 * not. So `ensure` answers null rather than throwing, and slice 4 seals
 * to the keyholder alone on that answer.
 *
 * Node is that browser, which is what makes this testable at all here:
 * `globalThis.indexedDB` is genuinely absent rather than stubbed away.
 */
await check("a browser with no database is told so, plainly", () =>
  typeof Keys.unavailableReason() === "string" &&
  /database/i.test(Keys.unavailableReason()));

await check("and asking for a key there answers null rather than throwing",
  async () => (await Keys.ensure("a".repeat(64))) === null);

await check("forgetting a key that cannot exist is not an error",
  async () => (await Keys.forget()) === false);

/* ------------------------------------------------------------------ */
/* What the storage calls are, read off the source.                    */

/*
 * These are source arms rather than behavior arms, and they are here
 * because the behavior they stand for needs a real IndexedDB. Each one
 * pins a decision that would otherwise be provable only in a browser,
 * and each names what a mutation of it would cost.
 */
/*
 * Keyed by account id, and by the record's OWN account id rather than
 * by a key handed in beside it.
 *
 * `keyPath` is what makes those the same thing: the store reads the key
 * out of the object it is storing, so a record cannot be filed under an
 * account it does not claim to belong to. Storing under an out-of-line
 * key would leave the two able to disagree, and a record filed under
 * one member while claiming another is a record `custodyVerdict` reads
 * as foreign every time - a key regenerated on every load, which looks
 * like nothing at all until an export finds rows nobody can open.
 *
 * A fixed row name is the other failure, and it is #56's: one row means
 * one key per browser, handed to whoever signs in next.
 */
await check("the store keys records by the account id inside them", () =>
  /createObjectStore\([^,]+,\s*\{\s*keyPath:\s*ROW_KEY\s*\}\)/.test(code) &&
  Keys.ROW_KEY === "accountId" &&
  /store\.get\(accountId\)/.test(code));

await check("the key material is stored as objects, never as JWK or bytes",
  () => !/exportKey\(\s*"jwk"/.test(source) && !/\.d\b/.test(source));

/*
 * Persistence is asked for and never waited on for correctness. Safari
 * evicts script-writable storage after seven days without interaction,
 * and `persist()` is the documented exemption - but Firefox prompts for
 * it, and a member who says no must still be able to submit. So the call
 * is best-effort: its answer changes how long the key survives and
 * nothing else.
 */
await check("persistence is requested", () =>
  /navigator\.storage/.test(source) && /\.persist\(\)/.test(source));

await check("and refusing it is not an error path", () =>
  !/throw[\s\S]{0,80}persist/i.test(source));

/* ------------------------------------------------------------------ */
/* Sign out destroys it - the boundary DESIGN.md already states.       */

/*
 * DESIGN.md's Encryption section says signing out destroys the device
 * key, and names the price: a re-seal request later. Until this slice
 * nothing implemented that sentence, so the document was ahead of the
 * code - which is the direction nobody notices, because the document
 * reads correct.
 *
 * Pinned from BOTH sides on purpose, and the second one is the arm that
 * matters. signout.js calling `forget` proves the call exists; the
 * exported name existing proves it can be called. Neither alone survives
 * a rename, and the failure mode of a rename here is silent: sign-out
 * keeps working, and the key it was supposed to destroy stays.
 */
const signOutSource = await readFile(HERE("../apps/web/signout.js"), "utf8");

await check("signOut destroys the device key", () =>
  /BinderMemberKey/.test(signOutSource) && /forget\(\)/.test(signOutSource));

await check("and the name it calls is the name this module exports", () => {
  const called = /(\w+)\.forget\(\)/.exec(signOutSource);
  return Boolean(called) && typeof Keys.forget === "function";
});

/* ------------------------------------------------------------------ */
/* The deferred-capture exemption, earned by running the bytes.        */

/*
 * WHY THIS IS HERE AND NOT IN tools/check_web.py.
 *
 * signout.js is loaded by every signed-in page; memberkey.js by the one
 * page that seals entries. So signout.js reads `BinderMemberKey` off a
 * global that two of the three pages never publish, and
 * `DEFERRED_CAPTURES` in check_web.py exempts that pair from the
 * script-ordering rule.
 *
 * That exemption is dangerous in a specific way, and it is worth naming
 * before the arms: it does not merely permit the read, it REMOVES ORDER
 * POLICING for the pair. So if the read were in fact a load-time
 * capture, a later reorder of your-page.html's script run would capture
 * undefined, sign-out would silently stop destroying the key, and
 * DESIGN.md's sentence about signing out would go false with every
 * stage of the gate green.
 *
 * check_web.py tried to earn the exemption from the text - the
 * reference must sit deeper than the module's top level, and the value
 * must be guarded. A review defeated all three arms of that:
 *
 *   - a function DEFINED deep and CALLED at the module's top level
 *     reads at load while sitting at depth 2;
 *   - an unbalanced brace inside a string literal inflates a raw brace
 *     counter permanently, so everything after it reads as deep -
 *     including the exact `const UI = root.BinderUI;` hazard;
 *   - a file-wide regex for a guard is satisfied by a dead one
 *     (`if (keys && false)`) or by the guard's own text inside a
 *     string, while the real use goes unguarded.
 *
 * Each of those is a textual proxy for a runtime property, so the fix
 * is not a better regex. The property is "the namespace is not touched
 * while the page loads", and the only thing that settles it is loading
 * the page's actual bytes and watching. These arms do that, over the
 * TABLE rather than over signout.js by name, so a pair added to
 * check_web.py with no execution evidence fails here.
 */
const checkWeb = await readFile(HERE("../tools/check_web.py"), "utf8");
/* The table's own block, bounded before anything is read out of it. A
 * pattern swept over the whole file matches every other two-string tuple
 * in it, and a reader that finds the wrong rows is worse than one that
 * finds none - it would exercise pairs that are not exemptions and miss
 * the ones that are. */
/*
 * A function rather than a one-off expression, because the reader
 * itself turned out to be the weak link and a weak link has to be
 * testable against text this file controls - see the arm two below.
 *
 * QUOTE-AGNOSTIC, and that is not tidiness. Python does not care which
 * quote a string is written with and nothing in this repository's gate
 * enforces one, so `('signout.js', 'BinderMemberKey'):` is the same row
 * to check_web.py and was invisible to the double-quote-only pattern
 * this replaced. The consequence is worse than a missing arm: every
 * arm below iterates what this returns, so a row it cannot see is a row
 * granted the exemption with NEITHER the load-time property nor the
 * guarded one ever checked. An undiscovered row is silently trusted,
 * where a missing one would at least be loud. Found by the #154 sweep's
 * gate partition.
 */
function declaredCaptures(python) {
  const block = /DEFERRED_CAPTURES = \{([\s\S]*?)^\}/m.exec(python);
  if (!block) return null;
  return [...block[1].matchAll(
    /\(\s*(["'])([\w.-]+)\1\s*,\s*(["'])(\w+)\3\s*\)\s*:/g)].map((one) => ({
    script: one[2], namespace: one[4],
  }));
}

const declared = declaredCaptures(checkWeb) || [];

await check("the deferred-capture table is readable, and it is not empty",
  () => declared.length > 0 &&
    declared.some((one) => one.script === "signout.js" &&
      one.namespace === "BinderMemberKey"));

/*
 * The same table written both legal ways, which is the fixture the
 * reader above was rewritten for. Held here rather than by mutating
 * check_web.py: a row's quote style is not this suite's to change, and
 * the property under test is the reader's, so the reader is what gets
 * given something to read.
 */
const SINGLE_QUOTED = [
  "DEFERRED_CAPTURES = {",
  "    ('signout.js', 'BinderMemberKey'):",
  "        \"a reason, which this arm does not read\",",
  "}",
].join("\n");

await check("a row is found whichever quote Python happened to write it with",
  () => {
    const single = declaredCaptures(SINGLE_QUOTED);
    const double = declaredCaptures(SINGLE_QUOTED.replace(/'/g, "\""));
    return single && double && single.length === 1 &&
      single[0].script === "signout.js" &&
      single[0].namespace === "BinderMemberKey" &&
      JSON.stringify(single) === JSON.stringify(double);
  });

/*
 * One load, one recorded global.
 *
 * The namespace is defined as a GETTER on the context's own global, so
 * every read is observed - including one that happens and then discards
 * the value, which is the shape a defeated proxy lets through. The
 * script is run as the page runs it: its own bytes, no document (the
 * DOM half returns early, exactly as on a page whose elements it does
 * not need), and `globalThis` as its `root`.
 */
async function loadRecording(script, namespace, publish) {
  const source = await readFile(HERE("../apps/web/" + script), "utf8");
  const reads = [];
  const context = {
    BinderSession: { authorization() { return {}; }, clear() {} },
    BINDER_CONFIG: {},
    fetch() { return Promise.resolve(); },
    location: { replace() {} },
    localStorage: {
      getItem() { return null; }, setItem() {}, removeItem() {},
    },
  };
  vm.createContext(context);
  let loading = true;
  Object.defineProperty(context, namespace, {
    configurable: true,
    get() {
      reads.push(loading ? "load" : "call");
      return publish;
    },
  });
  vm.runInContext(source, context, { filename: script });
  loading = false;
  return { context, reads };
}

await check("no declared namespace is touched while its script loads",
  async () => {
    for (const one of declared) {
      const { reads } = await loadRecording(one.script, one.namespace, {
        forget() { return Promise.resolve(true); },
      });
      if (reads.includes("load")) return false;
    }
    return true;
  });

/*
 * And the two halves of "guarded", which the regex could only gesture
 * at. Absent, the act must complete without throwing - that is what a
 * page with no memberkey.js does. Present, the namespace must actually
 * be USED, which is what a dead guard fails: `if (keys && false)` reads
 * the global and then does nothing, and only watching the far side of
 * the guard tells the two apart.
 *
 * DRIVEN OVER THE TABLE, NOT OVER A NAME WRITTEN HERE - the #154
 * sweep's S-20. The load-time arm above loops `declared`, and a pair of
 * string literals beside that loop is a split brain: a second row added
 * to check_web.py takes the load-time property and slips past the
 * guarded one entirely, and a row renamed there leaves these arms
 * exercising a pair the table no longer declares while the loop moves
 * on. Both stay green, and both are then about nothing.
 *
 * WHAT CANNOT COME OFF THE TABLE is the ACT: `(script, namespace)` says
 * which global a script must not touch while it loads, and says nothing
 * about what calling into it looks like. So the act is written here, per
 * pair, and the coverage arm below is what keeps that from re-opening
 * the same hole: every declared row must have one, so a row added to
 * check_web.py with no act to drive it fails here rather than being
 * granted the exemption unexercised.
 */
const GUARD_ACTS = new Map([
  ["signout.js|BinderMemberKey", () => {
    let forgotten = 0;
    return {
      publish: { forget() { forgotten += 1; return Promise.resolve(true); } },
      drive(context) { context.BinderSignOut.signOut(); },
      used() { return forgotten === 1; },
    };
  }],
]);

const pairKey = (one) => one.script + "|" + one.namespace;

await check("every declared row carries an act this file can drive", () =>
  declared.length > 0 && declared.every((one) => GUARD_ACTS.has(pairKey(one))));

await check("with the namespace absent the act completes rather than throwing",
  async () => {
    for (const one of declared) {
      const make = GUARD_ACTS.get(pairKey(one));
      if (!make) return false;
      const act = make();
      const { context } = await loadRecording(one.script, one.namespace,
        undefined);
      act.drive(context);
    }
    return true;
  });

await check("with it present the act reaches through the guard and uses it",
  async () => {
    for (const one of declared) {
      const make = GUARD_ACTS.get(pairKey(one));
      if (!make) return false;
      const act = make();
      const { context, reads } = await loadRecording(one.script,
        one.namespace, act.publish);
      act.drive(context);
      if (!act.used() || !reads.includes("call") || reads.includes("load")) {
        return false;
      }
    }
    return true;
  });

/*
 * ORDER AND INDEPENDENCE, PERFORMED RATHER THAN READ - and the two arms
 * this replaced are worth describing, because they were defeated.
 *
 * They compared string offsets inside signOut()'s source and grepped
 * the file for two call spellings. Both are proxies, and the #154
 * sweep's client partition walked through both with the suite green:
 *
 *   - `if (localStore()) forgetDeviceKey();` keeps every offset in
 *     order and keeps `keys.forget();` in the file, while sign-out stops
 *     destroying the key on exactly the browsers where storage is
 *     blocked;
 *   - folding both erasures into one `forgetLocalData()` helper behind
 *     that same condition keeps the word "forget" inside signOut()'s
 *     body, so even the offset comparison still passes.
 *
 * There was a latent third: with the word absent altogether,
 * `indexOf("forget")` is -1, and -1 is less than every real offset, so
 * "the key is destroyed before the page navigates away" was TRUE of a
 * sign-out that destroyed no key at all.
 *
 * None of that is fixable with a better pattern, because the property
 * is not textual. So signOut() is RUN, against the shipped bytes, with
 * every act it can perform observed: the revoke, the prefill removal,
 * the key destruction, the credential clear, and the navigation. What
 * the arms below ask is what a member gets, in an order, on browsers
 * that differ.
 */
async function performSignOut({ store = "working", keys = true } = {}) {
  const acts = [];
  const context = {
    BINDER_CONFIG: { endpoint: "https://worker.example" },
    BinderSession: {
      authorization() { return { Authorization: "Bearer token" }; },
      clear() { acts.push("session"); },
    },
    // The revoke is deliberately not awaited by the shipped file, so
    // this answers something with a .catch and nothing else - matching
    // what signout.js does with the return value rather than what a
    // fetch really is.
    fetch(url, options) {
      acts.push("revoke:" + (options && options.method));
      return { catch() {} };
    },
    location: { replace() { acts.push("navigate"); } },
  };
  vm.createContext(context);

  /*
   * The store is a GETTER so that "blocked" can throw the way a real
   * hardened browser does - reading `localStorage` there is not a
   * property that answers null, it is an exception - and so that
   * "absent" is genuinely absent rather than an object that quietly
   * accepts calls. These are the two browsers the defeated arms let a
   * key survive on.
   */
  Object.defineProperty(context, "localStorage", {
    configurable: true,
    get() {
      if (store === "absent") return null;
      if (store === "blocked") throw new Error("storage is unavailable here");
      return {
        getItem() { return null; },
        setItem() {},
        removeItem() { acts.push("prefill"); },
      };
    },
  });
  Object.defineProperty(context, "BinderMemberKey", {
    configurable: true,
    get() {
      return keys
        ? { forget() { acts.push("forget"); return Promise.resolve(true); } }
        : undefined;
    },
  });

  vm.runInContext(signOutSource, context, { filename: "signout.js" });
  context.BinderSignOut.signOut();
  return acts;
}

/*
 * The order itself. The revoke needs the token the lines below destroy,
 * so it goes first; the navigation is last, because `location.replace`
 * ends the turn and a page that has already left finishes none of the
 * erasures above it.
 */
await check("sign out revokes, then destroys, and only then leaves",
  async () => {
    const acts = await performSignOut();
    return acts[0] === "revoke:DELETE" &&
      acts.indexOf("forget") > 0 &&
      acts.includes("prefill") && acts.includes("session") &&
      acts[acts.length - 1] === "navigate";
  });

/*
 * THE ARM THE MUTATIONS ABOVE DIE ON. Destroying the device key is a
 * separate act from clearing the prefill, and the way to say that
 * without saying it about spelling is to take the prefill's storage
 * away: on a browser with no localStorage, and on one where reading it
 * throws, the key must still go. Every version of "fold them together
 * behind one condition" fails here, however it is named.
 *
 * The key is the graver of the two, which is why this is the direction
 * that gets its own arm: the prefill is one measurement a member typed,
 * and this key opens everything they have ever submitted.
 */
await check("the device key is destroyed even where the prefill cannot be",
  async () => {
    const absent = await performSignOut({ store: "absent" });
    const blocked = await performSignOut({ store: "blocked" });
    return [absent, blocked].every((acts) =>
      acts.includes("forget") && !acts.includes("prefill") &&
      acts.includes("session") && acts[acts.length - 1] === "navigate");
  });

/*
 * And the same independence read the other way, so neither erasure can
 * be made to depend on the other's module. Two of the three pages that
 * offer Sign out do not load memberkey.js at all, and on those the
 * prefill is the only local thing there is to erase.
 */
await check("and the prefill is erased even where there is no key module",
  async () => {
    const acts = await performSignOut({ keys: false });
    return acts.includes("prefill") && !acts.includes("forget") &&
      acts.includes("session") && acts[acts.length - 1] === "navigate";
  });

report();
