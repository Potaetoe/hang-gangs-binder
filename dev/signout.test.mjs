/*
 * What Sign out destroys, run rather than read.
 *
 * THIS FILE IS WHAT SURVIVED dev/memberkey.test.mjs (0.9-M2-S5, #356).
 * That suite's named subject was apps/web/memberkey.js, which is
 * deleted: DESIGN.md's "Trust model: the Worker reads" retired every
 * client-side key, and once your-page.html stopped sealing (0.9-M2-S2,
 * #353) no page loaded the module at all. Its custody rules, its key
 * generation and its storage arms went with it.
 *
 * WHAT DID NOT GO, AND WHY. signout.js still deletes that database, and
 * that is a ruling rather than an oversight: browsers the old pages
 * wrote to are still carrying `hgb-member-key`, and the only code that
 * can ever remove it is code those browsers load. So the erase paths
 * survive the mechanism that filled them, and so do the arms proving
 * they run - which is this file. The deferred-capture ratchet survives
 * for the same shape of reason: the row it refuses was signout.js's.
 *
 * WHAT THIS SUITE CAN AND CANNOT REACH. `indexedDB` is not real under
 * Node and this file does not invent one - a fake database proves a
 * fake database works. What it does instead is RUN the shipped bytes of
 * apps/web/signout.js under a recording context and ask what a member
 * gets, on browsers and pages that differ. The database name itself is
 * pinned here rather than read out of a second file, because there is
 * no second file any more; see MEMBER_DB below.
 *
 * WHAT EACH SECTION PROVES:
 *
 *   1. The name sign-out deletes is a constant, it is the member key's
 *      database, and it is not admin.html's keyholder database.
 *   2. tools/check_web.py's DEFERRED_CAPTURES is still empty, and a row
 *      coming back fails here.
 *   3. signOut() revokes, erases both local things and leaves - in that
 *      order, on a browser with no storage, on one where storage
 *      throws, on one whose delete refuses, and on a page that never
 *      loaded a key module.
 */
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { suite } from "./harness.mjs";

const HERE = (p) => new URL(p, import.meta.url);

const { check, report } = suite("signout.js", 18);

/* ------------------------------------------------------------------ */
/* 1. The database sign-out destroys, and the one it must not.         */

/*
 * DESIGN.md's Encryption section says signing out destroys the device
 * key, and names the price: a re-seal request later. The mechanism that
 * made the key is gone; the destruction is not, because the devices
 * that ran it are still out there.
 *
 * THE NAME IS PINNED HERE, and that is the whole of what makes the
 * arms below say anything. AGENTS.md's review bar: a check computed
 * entirely from the file it guards cannot detect that the file was
 * rearranged, so something outside signout.js has to say which database
 * it may delete. apps/web/memberkey.js was that second copy and it is
 * deleted, which leaves this file as the outside voice - and a rename
 * in signout.js reddens this suite instead of quietly deleting a
 * database nobody ever made while the real one survives.
 */
const MEMBER_DB = "hgb-member-key";

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
  () => KEYHOLDER_DB === "hgb-keyholder-key" && KEYHOLDER_DB !== MEMBER_DB);

await check("sign out destroys a database, and names it through a constant",
  () => /deleteDatabase\(\s*\w+\s*\)/.test(signOutSource));

await check("and that constant holds the member key's database name",
  () => {
    const named = /deleteDatabase\(\s*(\w+)\s*\)/.exec(signOutSource);
    if (!named) return false;
    const literal = new RegExp(
      "\\b" + named[1] + '\\s*=\\s*"([^"]*)"').exec(signOutSource);
    return Boolean(literal) && literal[1] === MEMBER_DB;
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
 * THE BOUND IS COLUMN 0, and that is what makes the sentence above
 * true rather than aspirational. The assignment is matched at the start
 * of a line because that is where a module-level table lives, and the
 * block ends at the first line after the opening brace that begins in
 * column 0 - which has to be the dict's own `}` or there is no block
 * here to read. Python indents a statement's continuation lines and
 * puts nothing else at column 0 until the statement ends, so one rule
 * covers both legal shapes of an empty table: `{}` closing on the
 * opening line, and a `}` on a line of its own.
 *
 * A `}`-at-line-start terminator is the shape that does not work, and
 * it is worth naming because it is the obvious one. `DEFERRED_CAPTURES
 * = {}` gives it nothing to stop at, so the body runs on to the close
 * of whatever table comes next - check_web.py is four thousand lines
 * and holds several, some of them tuple-keyed - and the rows it then
 * reports as exemptions are somebody else's.
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
  const opened = /^DEFERRED_CAPTURES = \{/m.exec(python);
  if (!opened) return null;
  const after = python.slice(opened.index + opened[0].length);
  const closed = /^\S/m.exec(after);
  if (!closed || after[closed.index] !== "}") return null;
  return [...after.slice(0, closed.index).matchAll(
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
 * WHERE THE BLOCK ENDS, which is the part of the reader that has to be
 * right for any answer above to mean anything.
 *
 * An empty table is legal Python written `{}` on one line, and that
 * shape closes with no `}` at the start of any line - so a terminator
 * looking for one runs the body on until it finds the close of a
 * DIFFERENT table further down. check_web.py is four thousand lines and
 * holds several literal tables, including tuple-keyed ones; the rows
 * such a reader finds belong to something else entirely, and "no
 * exemptions" then depends on those rows happening not to match the row
 * pattern rather than on the table being empty.
 *
 * Both directions are wrong in their own way and both are pinned. A
 * reader that runs on reports an exemption this tree has not granted,
 * off an edit that has nothing to do with exemptions. A reader that
 * cannot find the close reports empty for a table it never read, which
 * is the failure the null answer above exists to keep separate.
 */
const EMPTY_ABOVE_ANOTHER_TABLE = [
  "DEFERRED_CAPTURES = {}",
  "",
  "",
  "UNRELATED = {",
  "    ('probe.js', 'BinderProbe'): 'not an exemption at all',",
  "}",
].join("\n");

await check("an empty table does not read the next table's rows as its own",
  () => {
    const declared = declaredCaptures(EMPTY_ABOVE_ANOTHER_TABLE);
    return declared !== null && declared.length === 0;
  });

const UNCLOSED_ABOVE_ANOTHER_TABLE = [
  "DEFERRED_CAPTURES = {",
  "    ('example.js', 'BinderExample'): 'a reason',",
  "UNRELATED = {",
  "}",
].join("\n");

await check("and a table with no close of its own is unreadable, not empty",
  () => declaredCaptures(UNCLOSED_ABOVE_ANOTHER_TABLE) === null);

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
 * on the context describes a page that publishes the retired key
 * module; with it absent, a destruction reached through the namespace
 * skips its guard and the member keeps the key that opens their whole
 * history. NO PAGE PUBLISHES IT NOW - apps/web/memberkey.js is deleted
 * (0.9-M2-S5, #356) - so the stub is no longer a page this site ships.
 * It stays because the property it buys is the one that outlives the
 * module: sign-out must destroy the database WITHOUT asking any
 * namespace whether to, and an arm driven only against the absent case
 * cannot tell "never consults it" from "consults it and it is not
 * there". Both cases are still run below, for that reason alone.
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
 * after vm.createContext() has contextified it, is not on the global
 * that script inside the context reads through V8's global proxy. The
 * getter is never invoked at all, so a body that throws never runs.
 * Measured on Node v24.19.0 with a getter whose whole body is `throw`,
 * read three ways: `root.x` and `globalThis.x` answer undefined, and
 * bare `x` throws ReferenceError because the name is not defined - a
 * different exception from a different place, and not the refusal this
 * mode exists to imitate.
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
 *
 * TWO THINGS BESIDE THE RECORDER, both there to make an absence
 * observable rather than assumed.
 *
 * The delete request is HANDED BACK to the host, because what the
 * shipped bytes put on that object - and what those handlers then do
 * when a browser fires them - is a property no sequence of recorded acts
 * can show. Nothing calls a handler in a browser this test ever reaches,
 * so the arms at the foot of this file call them.
 *
 * `setTimeout` and `setInterval` are published because a vm context has
 * neither, and a sign-out that scheduled anything would fail with a
 * TypeError that reads like a broken harness instead of like the wait it
 * is. Recorded, a scheduled timer is an act with a name, and "sign-out
 * never waits" becomes something an arm can ask.
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
        const request = {};
        handed.push(request);
        return request;
      },
    };
  },
});

globalThis.setTimeout = function () { record("timer"); return 0; };
globalThis.setInterval = function () { record("timer"); return 0; };

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
 * `keys` is the PAGE rather than the browser: it publishes a stub
 * `BinderMemberKey` or does not. No page ships that namespace any more,
 * so the true case is a hypothetical page - deliberately, because it is
 * the only setting in which a guarded destruction PASSES. It is a
 * getter that records the read, so "the namespace is never consulted"
 * is an observation rather than an inference, and running both cases is
 * what separates a guard that happens to be true from no guard at all.
 *
 * The delete records the NAME it was asked for. A recorder that noted
 * only that a delete happened would pass a sign-out that destroyed the
 * keyholder's working copy on admin.html.
 */
function runSignOut(
  { store = "working", keys = true, database = "working" } = {}) {
  const acts = [];
  const handed = [];
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
    // What the fakes above reach back through: what they may record,
    // where they leave the delete requests they hand out, and which
    // browser and page they are standing in.
    record(act) { acts.push(act); },
    handed,
    modes: { store, keys, database },
  };
  vm.createContext(context);
  vm.runInContext(SIGN_OUT_FAKES, context, { filename: "fakes.js" });

  vm.runInContext(signOutSource, context, { filename: "signout.js" });
  context.BinderSignOut.signOut();
  return { acts, handed };
}

/*
 * The acts alone, which is all that every arm but the last two wants.
 * The request objects are the answer to one narrow question and reading
 * them costs an arm nothing, so the ordinary spelling stays the short
 * one and the two arms that need more say so by calling the other name.
 */
async function performSignOut(options) {
  return runSignOut(options).acts;
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
 * THE ARM #257 TURNS ON, and 0.9-M2-S5 (#356) made it the only case
 * this site ships: no page loads a key module now, so the namespace is
 * absent on every one of the three that offer Sign out. IndexedDB is
 * origin-wide, and a key an earlier visit filed away is still in this
 * origin - which scripts the page happened to load has nothing to do
 * with whether it must go.
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
 * namespace is never even read. A guarded call passes the arm above
 * wherever the stub stands and fails it wherever it does not, so the
 * guard is what has to be absent - not merely arranged to be true on
 * the pages that exist today.
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

/*
 * THE OUTCOME HANDLERS ARE TERMINAL, which is the half of the destroying
 * act no ordering arm above can see.
 *
 * `onblocked` fires when another tab holds the database open, and every
 * tempting answer to it - retry on a timer, close the other connection,
 * give up after a timeout - puts a wait between a member and leaving,
 * for a delete that completes on its own the moment that tab's
 * transaction ends. Sign-out is a navigation the member asked for; the
 * erasure rides along with it and never gates it. The handlers exist at
 * all so that neither outcome surfaces as an unhandled error event in a
 * console a member has open, and that is the whole of their job.
 *
 * Assignment is READ and then the handlers are FIRED, because "no
 * retry" is a claim about what a handler does and nothing in a browser
 * this suite reaches ever calls one. A retry called straight from a
 * handler records a second delete and hands back a second request; one
 * scheduled from a handler records a timer. Both are silent to every
 * other arm in this file: the acts of an unblocked sign-out are
 * identical either way, which is exactly how a retry survived review as
 * a compliant no-op.
 */
await check("the delete's outcome handlers are all that is put on it",
  () => {
    const { handed } = runSignOut();
    if (handed.length !== 1) return false;
    const request = handed[0];
    return typeof request.onerror === "function" &&
      typeof request.onblocked === "function" &&
      Object.keys(request).sort().join(",") === "onblocked,onerror";
  });

/*
 * The whole list is compared above rather than the two names being
 * looked for, for the reason the delete list is: anything else assigned
 * to that request is a behavior on the way out of the site that nothing
 * here has agreed to, and "the two are among them" is what that passes.
 */
await check("and firing either one retries nothing and schedules nothing",
  () => {
    const { acts, handed } = runSignOut();
    if (acts.some((act) => act.startsWith("timer"))) return false;
    const settled = acts.length;
    handed[0].onblocked({});
    handed[0].onerror({});
    return handed.length === 1 && acts.length === settled;
  });

report();
