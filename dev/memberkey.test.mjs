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
 * RULES are exercised as a pure function over records, the storage calls
 * are read off the source, and the round trip through a real IndexedDB
 * is a browser claim rather than a Node one. Where a claim is a browser
 * claim it says so here rather than being quietly omitted.
 */
import { readFile } from "node:fs/promises";
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

const { check, report } = suite("memberkey.js", 34);

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
    ["DB_NAME", "ROW_KEY", "STORE_NAME", "custodyVerdict", "ensure",
      "forget", "unavailableReason"].sort().join(","));

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
 * THE RULE IS ERASE, NOT SKIP, and it is #56 and #65's rule rather than
 * a new one. A shared browser must not hand the next member the previous
 * member's key - and the difference between ignoring a foreign record
 * and destroying it is the difference between a check somebody can
 * forget and a record that is not there. The key opens a whole history
 * rather than one measurement, so the reasoning applies with more at
 * stake, not less.
 *
 * Everything malformed lands on the same verdict, which is the fail-
 * closed half: a record this file cannot fully vouch for is destroyed
 * and replaced, never reused. A key of unknown provenance sealing a
 * member's entries is a row nobody can open, discovered on export day.
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

/*
 * Order, which is the half a reader would not think to check. The revoke
 * needs the token, so it goes first; the three local destructions follow;
 * the navigation is last, because a page that has already left cannot
 * finish erasing anything. `location.replace` is what ends the turn, so
 * every erase has to be started before it.
 */
await check("the key is destroyed before the page navigates away", () => {
  const body = /function signOut\(\)[\s\S]*?\n {2}\}/.exec(signOutSource)[0];
  return body.indexOf("forget") < body.indexOf("location") &&
    body.indexOf("revokeSession") < body.indexOf("forget");
});

/*
 * The one thing sign-out must NOT do, stated because it is the tempting
 * simplification: destroying the key is not the same act as clearing the
 * prefill, and a single helper doing both would put a key deletion
 * behind whatever future condition somebody attaches to prefill
 * clearing. They are separate calls in the same function.
 */
await check("destroying the key is its own call, not folded into another",
  () => /clearPrefill\(\);/.test(signOutSource) &&
    /forget\(\);/.test(signOutSource));

report();
