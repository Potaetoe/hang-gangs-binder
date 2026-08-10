/*
 * The member's own key. One keypair per account, generated in this
 * browser, and never leaving it in any form.
 *
 *   const key = await BinderMemberKey.ensure(accountId);
 *   if (key) seal to [BINDER_CONFIG.publicKey, key.publicKeyBase64];
 *   await BinderMemberKey.forget();          // Sign out
 *
 * WHAT IT IS FOR. Every entry seals to the keyholder, and until this
 * file that was the only recipient - so a member could not read their
 * own history back, on any device, ever. #85's owner decision was
 * member-held keys with "as frictionless as possible" as the binding
 * constraint, and a key nobody types is a key bound to the device that
 * made it. Durability comes from the keyholder instead: they can
 * re-seal a member's rows to a new device key in the one session where
 * the plaintext legitimately exists. Recovery is "ask an admin", which
 * is how deletion already works here. DESIGN.md, "Members hold a key
 * too", is where that decision lives.
 *
 * NON-EXTRACTABLE IS THE WHOLE PROPERTY. The private half is generated
 * with `extractable: false`, so no code can read it out - not this file,
 * not a compromised apps/web, not an extension driving the page's own
 * API surface. It is stored as the `CryptoKey` object itself, structure-
 * cloned into IndexedDB; there is never a JWK, never bytes, nothing this
 * page could write down again. That is the same shape admin.html keeps
 * the keyholder's working copy in, for the same reason.
 *
 * ITS OWN DATABASE, not a store inside the keyholder's. Two features
 * sharing a database have to agree on a version number to add a store,
 * and these two have nothing else in common: different pages, different
 * lifetimes, and one of them sits on the page that holds the whole
 * corpus in the clear.
 *
 * NOT sessionStorage and NOT localStorage, and the reasons run opposite
 * ways. Session material is authority the Worker issued and can revoke,
 * which is why DESIGN.md bounds it to the tab; this key is not
 * authority - nothing issued it and nothing can revoke it. The prefill
 * is localStorage because it is cleartext a member typed. Putting key
 * material in either would mean storing it as a string, which is the one
 * property this design exists to avoid. What ends this key is Sign out,
 * and clearing site data.
 *
 * TWO DIFFERENT MECHANISMS KEEP TWO DIFFERENT PROMISES, and conflating
 * them is how one of them quietly stops being kept.
 *
 * The KEY PATH is what stops a shared browser handing the next member
 * the previous member's key. The store reads the key out of the record
 * it files, so a lookup for one account cannot return another's - that
 * is structural, and it is the #56 property. Two members using one
 * browser end up with a key each, and each one's own sign-out deletes
 * the database that holds both.
 *
 * ERASE, NEVER SKIP is the narrower second line, and it is about a
 * record filed under THIS account that does not vouch for itself: an
 * account id that does not match, a private key something could export,
 * a public half of the wrong length, or a public half that is not that
 * private key's at all. Those cannot arrive from this file, so whatever
 * put them there is not this file, and the answer is to destroy and
 * regenerate rather than adopt. Adopting one means a member's entries
 * sealed to a key of unknown provenance - a row nobody can open,
 * discovered on export day.
 *
 * The last of those four is the only one shape cannot settle, and it is
 * the one an attacker who knows the format would write: sixty-five
 * genuine bytes of somebody else's public key beside the member's own
 * private key. `custodyRuling` asks the curve instead of the shape, and
 * the two halves of the custody rule are split at exactly that line.
 *
 * THE MISSING KEY IS NEVER AN ERROR. Storage blocked, private browsing,
 * a browser with no IndexedDB: `ensure` answers null and the caller
 * seals to the keyholder alone and submits normally. A member must never
 * be unable to submit because a convenience key was missing.
 *
 * No DOM half. This file wires nothing and paints nothing - its callers
 * do both - so there is no `typeof document` guard below, and its
 * absence is deliberate rather than forgotten.
 */
(function (root) {
  "use strict";

  const DB_NAME = "hgb-member-key";
  const STORE_NAME = "keys";

  /*
   * The key PATH, not a row name - the store reads its key out of the
   * record it files, so a record cannot be filed under an account it
   * does not claim to belong to.
   *
   * This is the #56 property and it is structural rather than checked: a
   * lookup for one account cannot return another's, so a shared browser
   * never hands the second member the first one's key. A single fixed
   * row would mean one key per browser, given to whoever signed in next.
   */
  const ROW_KEY = "accountId";

  const CURVE = "P-256";
  const RAW_POINT_BYTES = 65;

  /*
   * A P-256 ECDH agreement is the x-coordinate of the shared point: 256
   * bits, 32 bytes, the same figure crypto.js derives before its HKDF.
   * Both are written out because one is what `deriveBits` is asked for
   * and the other is how many bytes the comparison below must walk, and
   * a comparison that measured what it was handed would be a comparison
   * a short answer could end early.
   */
  const SECRET_BITS = 256;
  const SECRET_BYTES = 32;

  /*
   * An account id is 64 lower-case hex characters - an HMAC-SHA-256
   * under ACCOUNT_SECRET, as GET /me hands it over. Anything else is
   * refused before it can select a record, because the failure this
   * guards is `undefined === undefined` matching a record with no
   * account against a caller with no account.
   */
  const ACCOUNT_ID = /^[0-9a-f]{64}$/;

  function subtle() {
    return root.crypto && root.crypto.subtle ? root.crypto.subtle : null;
  }

  function database() {
    try {
      return root.indexedDB || null;
    } catch (error) {
      // Accessing indexedDB throws outright in some hardened
      // configurations rather than reading undefined, and that is a
      // browser without one rather than a fault to report.
      return null;
    }
  }

  /*
   * Why a member's browser cannot hold a key, in words a caller can put
   * on a screen - or null when it can. The shape crypto.js's
   * `unavailableReason` already established, so a page asks both the
   * same way.
   */
  function unavailableReason() {
    if (!subtle()) {
      return "this browser has no WebCrypto, so it cannot make a key of " +
        "your own";
    }
    if (!database()) {
      return "this browser keeps no database for this site, so a key of " +
        "your own would not survive the tab";
    }
    return null;
  }

  /*
   * What to do with what the store handed back, judged by SHAPE alone:
   * use it, erase it, or there is nothing there.
   *
   * Pure, synchronous, and separate from the storage for one reason: a
   * rule that only exists inside an IndexedDB callback is a rule that
   * can only be tested by faking IndexedDB.
   *
   * Shape is everything settled without a key operation, which is most
   * of the custody rule and all of the cheap part of it. The one
   * question it cannot reach - whether that public half is the stored
   * private key's - is `custodyRuling` below, and a record has to pass
   * both. Keeping this half free of promises is also what keeps it
   * FIRST: a record filed under a foreign account never reaches a curve.
   *
   * The record arrives from a lookup on this account's own key, so the
   * account clause below is NOT what separates two members sharing a
   * browser - the key path above is, and it does it structurally. What
   * this asks is whether a record filed under this account vouches for
   * itself, and everything unvouchable fails toward "erase". A record
   * this file could not have written is one something else wrote.
   */
  function custodyVerdict(record, accountId) {
    if (record === null || record === undefined) return "generate";
    if (!ACCOUNT_ID.test(String(accountId))) return "erase";
    if (typeof record !== "object") return "erase";
    // Strict, and deliberately not the Worker's COLLATE NOCASE. There an
    // upper-case id written straight into D1 must still match its own
    // rows; here a record whose id merely case-folds to this member's is
    // a record this file did not write.
    if (record.accountId !== accountId) return "erase";
    const key = record.privateKey;
    if (!key || typeof key !== "object") return "erase";
    if (key.type !== "private") return "erase";
    // This file cannot produce an extractable private key, so whatever
    // put one here could read it out again.
    if (key.extractable !== false) return "erase";
    /*
     * THE WALK THE CONSUMERS PERFORM IS THE TEST, and nothing weaker is.
     *
     * `usable` below turns these bytes into base64 with
     * `String.fromCharCode.apply(null, raw)`, which reads an INDEXED
     * list, and `generateFor` measures what it exported with `.length`.
     * So `.length` is the length that matters here and the indices have
     * to be read rather than assumed. An ArrayBuffer of 65 bytes, a
     * DataView over one and a bare `{ byteLength: 65 }` all satisfy a
     * byteLength test, carry no index at all, and walk to NOTHING - so
     * the record is adopted and the member's public half comes back as
     * the empty string. That is worse than erasing: form.js reads a
     * falsy key as "this browser has none" and seals to the keyholder
     * alone forever, on a browser that is holding a perfectly good
     * private key it will never be able to use. An object claiming a
     * `length` and no indices is worse again - it walks to sixty-five
     * NUL characters, so the public half comes back TRUTHY and every
     * entry seals to a key nothing ever generated.
     *
     * The tag is a filter, not the test. `Symbol.toStringTag` overrides
     * what `Object.prototype.toString` answers, so any object at all can
     * call itself a Uint8Array; what the comparison still buys over
     * `instanceof` is that a genuine array from another realm is judged
     * by what it is rather than by which window made it. Custody comes
     * from the two rules under it.
     *
     * The indices are walked with a counted loop rather than with
     * `Array.prototype.every.call`, which SKIPS absent indices and would
     * answer true for the very object this is written to refuse.
     */
    const raw = record.publicKeyRaw;
    if (Object.prototype.toString.call(raw) !== "[object Uint8Array]") {
      return "erase";
    }
    if (raw.length !== RAW_POINT_BYTES) return "erase";
    for (let i = 0; i < RAW_POINT_BYTES; i++) {
      if (typeof raw[i] !== "number") return "erase";
    }
    // Sixty-five real bytes, and that is all this can say. Whether they
    // are the stored key's sixty-five bytes is `custodyRuling`'s.
    return "use";
  }

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      const factory = database();
      if (!factory) {
        reject(new Error("this browser keeps no database for this site"));
        return;
      }
      const request = factory.open(DB_NAME, 1);
      request.onupgradeneeded = function () {
        request.result.createObjectStore(STORE_NAME, { keyPath: ROW_KEY });
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  // close() waits for outstanding transactions before it takes effect,
  // so a write resolved here is still committed after this returns.
  async function withStore(mode, act) {
    const db = await openDatabase();
    try {
      return await new Promise(function (resolve, reject) {
        const transaction = db.transaction(STORE_NAME, mode);
        const request = act(transaction.objectStore(STORE_NAME));
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error); };
      });
    } finally {
      db.close();
    }
  }

  /*
   * Best-effort, and never on the path to a submission.
   *
   * Safari deletes script-writable storage after seven days of use with
   * no interaction with the site, and `persist()` is the documented
   * exemption from that and from eviction under pressure. Chrome and
   * Safari answer it silently from interaction history; Firefox asks the
   * member. A member who refuses still gets a key, still submits, and
   * still reads their history until the browser takes the key away -
   * at which point the recovery path in DESIGN.md is what they walk.
   *
   * So nothing here throws and nothing waits on the answer for
   * correctness. Whether it was granted changes how long a key lives and
   * nothing else, which is why the result is not returned: a caller
   * given it would have to decide something, and there is nothing to
   * decide.
   */
  async function requestPersistence() {
    try {
      const storage = root.navigator && root.navigator.storage;
      if (storage && typeof storage.persist === "function") {
        await storage.persist();
      }
    } catch (error) {
      // A refusal, a prompt dismissed, or a browser that has no opinion.
      // All three are the same non-event here.
    }
  }

  async function generateFor(accountId) {
    const pair = await subtle().generateKey(
      { name: "ECDH", namedCurve: CURVE }, false, ["deriveBits"]);
    /*
     * The public half exports even though the pair was generated
     * non-extractable - WebCrypto marks only the private half - and
     * crypto.js's `encryptTo` needs exactly these 65 bytes. Read back
     * here rather than at seal time so a browser that somehow cannot
     * produce them fails while making a key, not while sealing an entry
     * a member has already typed.
     */
    const raw = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
    if (raw.length !== RAW_POINT_BYTES) {
      throw new Error("this browser produced a public key of an unexpected " +
        "shape, so an entry sealed to it could not be opened");
    }
    return {
      accountId: accountId,
      privateKey: pair.privateKey,
      publicKeyRaw: raw,
      createdAt: new Date().toISOString(),
    };
  }

  /*
   * IS THAT PUBLIC HALF THIS PRIVATE KEY'S? The shape rule cannot ask,
   * and a poisoned row turns on the answer.
   *
   * A genuine 65-byte Uint8Array of an attacker's choosing passes every
   * shape arm there is, survives the structured clone into IndexedDB,
   * and carries no mark of who wrote it. Adopting one costs more than
   * any other failure here: the member keeps a good private key, `usable`
   * hands form.js a well-formed public half, and every entry from then
   * on seals to a key the member cannot open - with the page showing
   * nothing wrong, because nothing visible is wrong. It surfaces on
   * export day, over rows already written.
   *
   * AGREEMENT, NOT A SIGNATURE. The stored private key is
   * `deriveBits`-only by construction and could not sign a challenge if
   * this file asked it to. What the curve does allow is ECDH from both
   * ends: derive against the record's public half with a throwaway
   * private key, derive against the record's private key with that
   * throwaway's public half. The two secrets are equal exactly when the
   * halves are two ends of one pair, and nothing but the real private
   * key produces the second one.
   *
   * THE IMPORT IS HALF THE TEST. `importKey` refuses bytes that are not
   * a point on P-256, so a throw there is a failed on-curve check rather
   * than a fault to report - and it lands on the same answer as a
   * mismatch, because both say the same thing about the row. No usage is
   * asked for: an ECDH public key may not carry one, and this import is
   * a validity question rather than a key being put to work.
   *
   * FALSE IS THE ONLY FAILURE. A mismatch, a throw, a private key whose
   * usages cannot derive at all: every one of them is a record this file
   * cannot vouch for, and all three land on the erase above. Not being
   * able to perform the test is not permission to skip it.
   *
   * The throwaway pair is non-extractable, lives in this frame, and is
   * never stored, returned or written down; the secrets die with the
   * frame too, and are compared by a counted XOR over a fixed thirty-two
   * bytes - no early return, and no base64 of a shared secret ever
   * built, since a string would outlive the comparison and be compared
   * by a path nobody here controls.
   */
  async function halvesAgree(record) {
    try {
      const stored = await subtle().importKey(
        "raw", record.publicKeyRaw,
        { name: "ECDH", namedCurve: CURVE }, false, []);
      const ephemeral = await subtle().generateKey(
        { name: "ECDH", namedCurve: CURVE }, false, ["deriveBits"]);
      const theirs = new Uint8Array(await subtle().deriveBits(
        { name: "ECDH", public: stored }, ephemeral.privateKey, SECRET_BITS));
      const ours = new Uint8Array(await subtle().deriveBits(
        { name: "ECDH", public: ephemeral.publicKey }, record.privateKey,
        SECRET_BITS));
      // The lengths ride in the accumulator rather than in a guard above
      // it, so there is no branch at all between here and the answer. A
      // short secret would otherwise leave the walk reading undefined
      // past its end, which is zero on both sides and would agree.
      let difference = (theirs.length ^ SECRET_BYTES) |
        (ours.length ^ SECRET_BYTES);
      for (let i = 0; i < SECRET_BYTES; i++) {
        difference |= theirs[i] ^ ours[i];
      }
      return difference === 0;
    } catch (error) {
      return false;
    }
  }

  /*
   * The verdict `ensure` acts on: the shape rule, and then - only for a
   * record the shape rule would adopt - the proof that its two halves
   * are two halves of one key.
   *
   * SPLIT IN TWO BECAUSE THE HALVES ANSWER DIFFERENTLY, and the split is
   * where the promises are. Everything above is provable without a
   * browser, a database or a key; this needs WebCrypto and therefore a
   * promise, and putting a promise into `custodyVerdict` would make the
   * cheapest rule in the file the most expensive one to test.
   *
   * NOTHING IS REMEMBERED - not on this module, not on the record. A
   * cached answer would be an answer that outlives the row it judged,
   * and the row is the thing an attacker replaces: a poisoned row would
   * inherit a clean row's verdict, and one poisoned row would condemn
   * every clean one after it. The whole test is a handful of
   * milliseconds against a page load.
   *
   * NOTHING NEW IS STORED either, which is what lets a key a member's
   * browser already holds be adopted with no migration: the proof is
   * computed from the two halves the record carries. A stored proof
   * field would make every record in the field unvouchable at once, and
   * "erase, never skip" would then destroy every legitimate key there
   * is - the fix costing more than the defect.
   */
  async function custodyRuling(record, accountId) {
    const verdict = custodyVerdict(record, accountId);
    if (verdict !== "use") return verdict;
    return (await halvesAgree(record)) ? "use" : "erase";
  }

  function usable(record) {
    return Object.freeze({
      accountId: record.accountId,
      privateKey: record.privateKey,
      publicKeyRaw: record.publicKeyRaw,
      publicKeyBase64: root.btoa(
        String.fromCharCode.apply(null, record.publicKeyRaw)),
      createdAt: record.createdAt,
    });
  }

  /*
   * This account's key, made if there is not one - and null if this
   * browser cannot hold one at all.
   *
   * Null is not an error and the caller must not treat it as one. The
   * entry still seals to the keyholder and still stores; what the member
   * loses is being able to read it back here, which is a smaller loss
   * than not being able to submit.
   *
   * Nothing is cached between calls. A module-level copy would be one
   * more place a key exists, would outlive the sign-out that is supposed
   * to destroy it, and would answer for whichever account asked first
   * on a browser two members share. Reading the store again costs a
   * microtask.
   */
  async function ensure(accountId) {
    if (unavailableReason()) return null;
    if (!ACCOUNT_ID.test(String(accountId))) return null;

    let record = null;
    try {
      record = await withStore("readonly", function (store) {
        return store.get(accountId);
      });
    } catch (error) {
      // A database that will not open is a browser that cannot hold a
      // key, which is the null case rather than a failure to report.
      return null;
    }

    const verdict = await custodyRuling(record, accountId);
    if (verdict === "use") return usable(record);

    try {
      if (verdict === "erase") {
        // Every record, not the one that was read. A store holding a
        // foreign key is a store this file did not write, and leaving
        // the others in place because only one was inspected is the
        // "skip" this module refuses to do.
        await withStore("readwrite", function (store) {
          return store.clear();
        });
      }
      const made = await generateFor(accountId);
      await withStore("readwrite", function (store) {
        return store.put(made);
      });
      await requestPersistence();
      return usable(made);
    } catch (error) {
      return null;
    }
  }

  /*
   * Sign out, and the answer is whether there was a database to destroy.
   *
   * DELETING THE DATABASE, not the row. A `delete` on one key leaves the
   * store, the database and anything else in it behind - and "anything
   * else" is precisely the foreign records the erase rule above exists
   * to remove. Sign out means this device retains nothing of this
   * member's, and a deleted database is a claim a reader can check.
   *
   * Never throws, for the same reason the revoke beside it does not
   * wait: the user-visible act is leaving, and a member cannot be left
   * on a page because a storage call failed. A key that survives a
   * failed delete is destroyed by the next sign-out or by clearing site
   * data, and DESIGN.md's recovery path covers the rest.
   */
  function forget() {
    return new Promise(function (resolve) {
      const factory = database();
      if (!factory) {
        resolve(false);
        return;
      }
      let request;
      try {
        request = factory.deleteDatabase(DB_NAME);
      } catch (error) {
        resolve(false);
        return;
      }
      request.onsuccess = function () { resolve(true); };
      request.onerror = function () { resolve(false); };
      // A delete blocks while another tab holds the database open. The
      // other tab closes its handle after every transaction, so this
      // resolves the moment it does; reporting false here instead would
      // tell a caller the key survived when it is about to go.
      request.onblocked = function () { resolve(false); };
    });
  }

  // Frozen because your-page.html loads this file while holding plaintext:
  // an export a later script can rewrite is an `ensure` that can be
  // swapped for one handing back an attacker's public key, which would
  // seal a member's next entry to it. Freezing does not stop the global
  // itself being reassigned - nothing in a page can - but it removes the
  // quiet edit, where the object every caller already holds a reference
  // to changes underneath them.
  root.BinderMemberKey = Object.freeze({
    DB_NAME: DB_NAME,
    STORE_NAME: STORE_NAME,
    ROW_KEY: ROW_KEY,
    unavailableReason: unavailableReason,
    custodyVerdict: custodyVerdict,
    // The async half of the same rule, exported for the same reason the
    // shape half is: a custody rule reachable only through `ensure` is a
    // custody rule testable only against a real IndexedDB. It answers
    // with a verdict string and hands back neither a key nor a byte of
    // any secret, so exporting it widens nothing a page could abuse.
    custodyRuling: custodyRuling,
    ensure: ensure,
    forget: forget,
  });
})(globalThis);
