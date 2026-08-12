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

const { check, report } = suite("memberkey.js", 69);

/* ------------------------------------------------------------------ */
/* The module's shape.                                                 */

await check("the file publishes exactly one global", () =>
  Object.keys(globalThis).filter((name) => !globalsBefore.has(name))
    .join(",") === "BinderMemberKey");

await check("and it is frozen, like every other module here", () =>
  Object.isFrozen(Keys));

/*
 * The key set as a whole, not the presence of the members this file
 * happens to use. form.js and submit.js build against this object, so
 * adding or removing a member is a change to an interface other files
 * depend on rather than a refactor - the same reason
 * dev/query.test.mjs pins BinderQuery's key set.
 *
 * DESTRUCTION IS NOT ON THIS LIST, and its absence is the interface
 * half of #257. This module makes the key; signout.js destroys the
 * database directly, because IndexedDB is origin-wide and a page that
 * never loaded this file still has a key to destroy. A `forget` here
 * would be an export with no caller, and the next reader would wire
 * sign-out to it and reintroduce the shape that shipped the defect.
 */
await check("the exported surface is the one other files build on", () =>
  Object.keys(Keys).slice().sort().join(",") ===
    ["DB_NAME", "ROW_KEY", "STORE_NAME", "custodyRuling", "custodyVerdict",
      "ensure", "unavailableReason"].sort().join(","));

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

/*
 * AND THE SHAPE A WHOLLY PLAIN RECORD MAKES, which is the same defect
 * one field over. `{ type: "private", extractable: false }` satisfies
 * every clause the shape rule has about a private key, and a record
 * built entirely of plain values and one real `Uint8Array` clones into
 * IndexedDB without complaint - so it is reachable through a real store
 * rather than only through a probe. There is no key in it at all, and
 * the agreement is what notices: nothing that is not a CryptoKey can
 * derive.
 */
await check("a record whose private key is only an object is erased",
  async () => {
    const record = await filed(pair.privateKey, pair.publicKey);
    record.privateKey = { type: "private", extractable: false };
    return structuredClone(record) &&
      Keys.custodyVerdict(record, "a".repeat(64)) === "use" &&
      (await Keys.custodyRuling(record, "a".repeat(64))) === "erase";
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
 * key, and names the price: a re-seal request later.
 *
 * TWO FILES NOW WRITE THE SAME DATABASE NAME DOWN, and these arms are
 * what makes that safe. signout.js destroys the database directly
 * rather than calling into this module, because IndexedDB is
 * origin-wide and two of the three pages offering Sign out never load
 * this file - so a call routed through it destroyed nothing on exactly
 * those pages (#257). The cost of that shape is a duplicated literal,
 * and the failure mode of a duplicated literal is silent: rename it on
 * one side and sign-out cheerfully deletes a database nobody made,
 * while the key it was meant to destroy stays. So the two literals are
 * compared here, where both files are already in hand.
 *
 * The behavior these stand beside is at the foot of this file, where
 * signOut() is RUN. Neither half is enough alone: running it proves a
 * database is destroyed, and only this proves it is the right one.
 */
const signOutSource = await readFile(HERE("../apps/web/signout.js"), "utf8");

/*
 * The keyholder's working copy on admin.html, read out of the file that
 * owns it. Sign out is in the rail on admin.html too, so "destroy the
 * member's key" and "leave the keyholder's alone" are two claims about
 * the same button - and the second one is only checkable against
 * admin.js's own name for its database.
 */
const adminSource = await readFile(HERE("../apps/web/admin.js"), "utf8");
const KEYHOLDER_DB = (/const KEY_DB = "([^"]+)"/.exec(adminSource) || [])[1];

await check("admin.js's keyholder database is named where this file can read it",
  () => KEYHOLDER_DB === "hgb-keyholder-key" && KEYHOLDER_DB !== Keys.DB_NAME);

await check("sign out destroys a database, and names it through a constant",
  () => /deleteDatabase\(\s*\w+\s*\)/.test(signOutSource));

await check("and that constant holds the name this module makes its key in",
  () => {
    const named = /deleteDatabase\(\s*(\w+)\s*\)/.exec(signOutSource);
    if (!named) return false;
    const literal = new RegExp(
      "\\b" + named[1] + '\\s*=\\s*"([^"]*)"').exec(signOutSource);
    return Boolean(literal) && literal[1] === Keys.DB_NAME;
  });

/* ------------------------------------------------------------------ */
/* The deferred-capture exemption, and why there is no longer one.      */

/*
 * THE TABLE IS EMPTY NOW, AND THIS SECTION IS WHAT KEEPS IT HONEST.
 *
 * `DEFERRED_CAPTURES` in tools/check_web.py exempted a (script,
 * namespace) pair from the script-ordering rule, and it held exactly
 * one row: signout.js reading `BinderMemberKey`. That row is gone with
 * the read (#257) - sign-out destroys the database itself, so it names
 * no namespace it might be loaded above.
 *
 * The apparatus that earned the row is gone with it, deliberately and
 * with the reason written down here rather than in a commit nobody will
 * find. It loaded the shipped bytes under a recording global and failed
 * if the namespace was touched during load, and every one of those arms
 * iterated the table. Over an empty table they pass without executing
 * anything - armed-looking and inert, which this repository holds to be
 * worse than no arm at all, and which is the same ruling the session-
 * block parity arm makes when it is left one copy to compare.
 *
 * What replaces them is a ratchet with teeth in the direction that
 * matters: a row coming BACK fails here. The exemption does not merely
 * permit a read, it REMOVES ORDER POLICING for the pair - so a row
 * granted without execution evidence is a page reorder away from a
 * capability that silently stops happening. Whoever adds one restores
 * the recording harness in the same change, and this arm is what makes
 * them.
 */
const checkWeb = await readFile(HERE("../tools/check_web.py"), "utf8");

/*
 * A function rather than a one-off expression, because the reader
 * itself turned out to be the weak link and a weak link has to be
 * testable against text this file controls - see the arm two below.
 *
 * The table's own block, bounded before anything is read out of it. A
 * pattern swept over the whole file matches every other two-string
 * tuple in it, and a reader that finds the wrong rows is worse than one
 * that finds none.
 *
 * QUOTE-AGNOSTIC, and that is not tidiness. Python does not care which
 * quote a string is written with and nothing in this repository's gate
 * enforces one, so a single-quoted row is the same row to check_web.py
 * and was invisible to the double-quote-only pattern this replaced.
 * Found by the #154 sweep's gate partition.
 *
 * NULL AND EMPTY ARE DIFFERENT ANSWERS, and keeping them apart is the
 * whole value of this reader now that the right answer is empty. Null
 * means the block was not found - a rename, a reformat, a table moved -
 * and an empty list means it was found and holds nothing. Fold the two
 * together and "no exemptions" becomes indistinguishable from "this
 * file can no longer see the exemptions".
 */
function declaredCaptures(python) {
  const block = /DEFERRED_CAPTURES = \{([\s\S]*?)^\}/m.exec(python);
  if (!block) return null;
  return [...block[1].matchAll(
    /\(\s*(["'])([\w.-]+)\1\s*,\s*(["'])(\w+)\3\s*\)\s*:/g)].map((one) => ({
    script: one[2], namespace: one[4],
  }));
}

await check("no script is exempted from the script-ordering rule any more",
  () => {
    const declared = declaredCaptures(checkWeb);
    return declared !== null && declared.length === 0;
  });

/*
 * The same table written both legal ways, which is what stops the arm
 * above from reading "empty" off a reader that can no longer find a row
 * at all. Held here rather than by mutating check_web.py: a row's quote
 * style is not this suite's to change, and the property under test is
 * the reader's, so the reader is what gets given something to read.
 *
 * The pair is synthetic on purpose. A fixture naming a real script would
 * read as a claim about this tree, and this tree's claim is that there
 * are no exemptions.
 */
const SINGLE_QUOTED = [
  "DEFERRED_CAPTURES = {",
  "    ('example.js', 'BinderExample'):",
  "        \"a reason, which this arm does not read\",",
  "}",
].join("\n");

await check("and a row is found whichever quote Python happened to write it with",
  () => {
    const single = declaredCaptures(SINGLE_QUOTED);
    const double = declaredCaptures(SINGLE_QUOTED.replace(/'/g, "\""));
    return Boolean(single) && Boolean(double) && single.length === 1 &&
      single[0].script === "example.js" &&
      single[0].namespace === "BinderExample" &&
      JSON.stringify(single) === JSON.stringify(double);
  });

await check("and an unreadable table is not mistaken for an empty one",
  () => declaredCaptures("DEFERRED_CAPTURES = [\n]\n") === null &&
    declaredCaptures("DEFERRED_CAPTURES = {\n}\n").length === 0);

/*
 * ORDER AND INDEPENDENCE, PERFORMED RATHER THAN READ - and the arms
 * this replaced are worth describing, because they were defeated.
 *
 * They compared string offsets inside signOut()'s source and grepped
 * the file for two call spellings. Both are proxies, and the #154
 * sweep's client partition walked through both with the suite green:
 *
 *   - `if (localStore()) forgetDeviceKey();` keeps every offset in
 *     order and keeps the destruction call in the file, while sign-out
 *     stops destroying the key on exactly the browsers where storage is
 *     blocked;
 *   - folding both erasures into one `forgetLocalData()` helper behind
 *     that same condition keeps the destroying word inside signOut()'s
 *     body, so even the offset comparison still passes.
 *
 * There was a latent third: with the word absent altogether, `indexOf`
 * is -1, and -1 is less than every real offset, so "the key is
 * destroyed before the page navigates away" was TRUE of a sign-out that
 * destroyed no key at all.
 *
 * A fourth defeats all of those, and it is why the arms below drive the
 * PAGE as well as the browser (#257). A stub `BinderMemberKey` standing
 * on the context describes your-page - the one page of three that loads
 * the key module. On charts.html and admin.html that namespace is
 * genuinely absent, so a destruction reached through it skips its guard
 * and a member leaving from either keeps the key that opens their whole
 * history. Arms that always publish the stub cannot see that at all:
 * they agree with each other about the page a member is least often
 * standing on when they press the button.
 *
 * None of it is fixable with a better pattern, because the property is
 * not textual. So signOut() is RUN, against the shipped bytes, with
 * every act it can perform observed: the revoke, the prefill removal,
 * the database destruction with the name it was given, the credential
 * clear, and the navigation. What the arms below ask is what a member
 * gets, in an order, on browsers and pages that differ.
 */

/*
 * THE FAKES ARE DEFINED FROM INSIDE THE CONTEXT, and that is not a
 * style choice - it is the difference between these arms working and
 * looking like they work.
 *
 * A getter defined with Object.defineProperty on the sandbox OBJECT,
 * after vm.createContext() has contextified it, is reached through
 * V8's global proxy when script inside the context reads the name. The
 * proxy does not propagate a throw from that getter: the read answers
 * undefined and the exception is swallowed. Measured on Node v24.19.0
 * with a getter whose whole body is `throw`, read three ways
 * (`root.x`, `globalThis.x`, bare `x`) - none of them threw.
 *
 * Which makes a "blocked" mode written that way a second spelling of
 * "absent": both hand the shipped file a falsy value, both take the
 * same branch, and an arm distinguishing them proves nothing while
 * reading as though it proved the hardened-browser case. Removing the
 * try/catch from signout.js's `database()` is then a mutation the suite
 * does not notice, which is how it was found.
 *
 * Defining the properties by RUNNING code in the context puts them on
 * the real global inside it, and a throw from there propagates the way
 * a hardened browser's does. The host side keeps only the recorder and
 * the mode names, so what a fake does is still decided out here.
 */
const SIGN_OUT_FAKES = `
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  get() {
    if (modes.store === "absent") return null;
    if (modes.store === "blocked") {
      throw new Error("storage is unavailable here");
    }
    return {
      getItem() { return null; },
      setItem() {},
      removeItem() { record("prefill"); },
    };
  },
});

Object.defineProperty(globalThis, "indexedDB", {
  configurable: true,
  get() {
    if (modes.database === "absent") return null;
    if (modes.database === "blocked") throw new Error("no database here");
    return {
      deleteDatabase(name) {
        record("delete:" + name);
        if (modes.database === "throws") throw new Error("delete refused");
        return {};
      },
    };
  },
});

Object.defineProperty(globalThis, "BinderMemberKey", {
  configurable: true,
  get() {
    record("consulted");
    return modes.keys ? { DB_NAME: "hgb-member-key" } : undefined;
  },
});
`;

/*
 * The browsers and the pages, as four axes the arms below combine.
 *
 * `store` and `database` each have an "absent" and a "blocked", because
 * those are two different browsers and they need two different guards
 * in the shipped file: absent answers a falsy value, blocked throws on
 * the READ. `database` has a third, "throws", where the read succeeds
 * and `deleteDatabase` itself refuses - a guard around one of those two
 * is not a guard around the other, and either one unguarded ends
 * signOut() above the credential clear and the navigation.
 *
 * `keys` is the PAGE rather than the browser: your-page publishes
 * `BinderMemberKey`, charts and admin do not. It is a getter that
 * records the read, so "the namespace is never consulted" is an
 * observation rather than an inference - a guarded call passes on the
 * page that publishes the module and fails on the two that do not, so
 * the guard has to be absent rather than merely true today.
 *
 * The delete records the NAME it was asked for. A recorder that noted
 * only that a delete happened would pass a sign-out that destroyed the
 * keyholder's working copy on admin.html.
 */
async function performSignOut(
  { store = "working", keys = true, database = "working" } = {}) {
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
    // The two halves the fakes above reach back through: what they may
    // record, and which browser and page they are standing in.
    record(act) { acts.push(act); },
    modes: { store, keys, database },
  };
  vm.createContext(context);
  vm.runInContext(SIGN_OUT_FAKES, context, { filename: "fakes.js" });

  vm.runInContext(signOutSource, context, { filename: "signout.js" });
  context.BinderSignOut.signOut();
  return acts;
}

const DESTROYS = "delete:hgb-member-key";

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
      acts.indexOf(DESTROYS) > 0 &&
      acts.includes("prefill") && acts.includes("session") &&
      acts[acts.length - 1] === "navigate";
  });

/*
 * ONE DATABASE, AND WHICH ONE. Sign out is in the rail on admin.html,
 * where the keyholder's imported working copy lives in a database of its
 * own - so a sign-out that swept the origin, or that took the wrong
 * name, would destroy the corpus key on the way out of the export page.
 * The whole list is compared rather than the member's name being looked
 * for, because "the right one is among them" is what a sweep passes.
 */
await check("and it destroys that one database and no other", async () => {
  const deleted = (await performSignOut())
    .filter((act) => act.startsWith("delete:"));
  return deleted.join(",") === DESTROYS &&
    !deleted.includes("delete:" + KEYHOLDER_DB);
});

/*
 * THE ARM #257 TURNS ON. Two of the three pages that offer Sign out
 * never load memberkey.js, so on charts.html and admin.html the
 * namespace is absent - and that is the shape a member most often signs
 * out from, because it is every page except the one they submit on.
 * IndexedDB is origin-wide: the key made on your-page is right there,
 * and which scripts this page happened to load has nothing to do with
 * whether it must go.
 */
await check("the device key is destroyed on a page with no key module",
  async () => {
    const acts = await performSignOut({ keys: false });
    return acts.indexOf(DESTROYS) > 0 &&
      acts.indexOf(DESTROYS) < acts.indexOf("navigate") &&
      acts.includes("session") && acts[acts.length - 1] === "navigate";
  });

/*
 * And the same property said the way no guard can satisfy: the
 * namespace is never even read. A guarded call passes the arm above on
 * a page that publishes the module and fails it on the two that do not,
 * so the guard is what has to be absent - not merely arranged to be
 * true today.
 */
await check("and the key module is not consulted on any page", async () => {
  const present = await performSignOut();
  const absent = await performSignOut({ keys: false });
  return !present.includes("consulted") && !absent.includes("consulted");
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
      acts.includes(DESTROYS) && !acts.includes("prefill") &&
      acts.includes("session") && acts[acts.length - 1] === "navigate");
  });

/*
 * And the same independence read the other way, so neither erasure can
 * be made to depend on the other's module. The prefill is the only local
 * thing there is to erase on a page that never loaded the key module,
 * and it must still be erased there.
 */
await check("and the prefill is erased even where there is no key module",
  async () => {
    const acts = await performSignOut({ keys: false });
    return acts.includes("prefill") &&
      acts.includes("session") && acts[acts.length - 1] === "navigate";
  });

/*
 * WHERE THE DATABASE CANNOT BE REACHED AT ALL, sign-out still finishes.
 *
 * Both of these are real browsers rather than defensive decoration.
 * Reading `indexedDB` throws outright in some hardened configurations,
 * and `deleteDatabase` can refuse on an origin whose storage is
 * disabled. Either one, unguarded, ends signOut() in an exception - and
 * what sits below the destruction is `Session.clear()` and the
 * navigation, so the failure is not "the key survived", it is "the
 * member is still signed in, on the page they pressed Sign out on".
 * That is a worse outcome than the one this whole slice is about.
 */
await check("a browser that cannot even be asked for a database still leaves",
  async () => {
    const absent = await performSignOut({ database: "absent" });
    const blocked = await performSignOut({ database: "blocked" });
    return [absent, blocked].every((acts) =>
      !acts.some((act) => act.startsWith("delete:")) &&
      acts.includes("prefill") && acts.includes("session") &&
      acts[acts.length - 1] === "navigate");
  });

await check("and so does one whose delete refuses", async () => {
  const acts = await performSignOut({ database: "throws" });
  return acts.includes(DESTROYS) && acts.includes("session") &&
    acts[acts.length - 1] === "navigate";
});

report();
