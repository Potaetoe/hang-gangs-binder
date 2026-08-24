/*
 * Contract checks for the tab-scoped member session and sign-in transport.
 * The shipped files run unchanged under small browser stubs, matching the
 * pattern used for ui.js without teaching the product about a test runner.
 */
import { readFile } from "node:fs/promises";
import { nodeTestSuite } from "./harness.mjs";

const sessionSource = await readFile(
  new URL("../apps/web/session.js", import.meta.url), "utf8");
const authSource = await readFile(
  new URL("../apps/web/auth.js", import.meta.url), "utf8");
const formSource = await readFile(
  new URL("../apps/web/form.js", import.meta.url), "utf8");

// Counted AND asserted - see the note in dev/check_budget.test.py.
// Printing the number keeps it out of prose; comparing it catches a
// check that quietly stops running, which otherwise still prints "OK".
const { check, report } = nodeTestSuite("session/auth", 56);

const values = new Map();

/*
 * A store that can be told to refuse - #154's client partition, F-4.
 *
 * removeItem is not a call that always works. Hardened configurations
 * and an exhausted quota both throw, and until this suite could produce
 * that, the one condition under which the expiry path recursed through
 * its own readers was unreachable from here.
 */
let refuseRemoval = false;
globalThis.sessionStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) {
    if (refuseRemoval) throw new Error("this browser will not remove it");
    values.delete(key);
  },
};

const redirects = [];
globalThis.location = {
  pathname: "/your-page.html",
  replace(target) { redirects.push(target); },
};

/*
 * The rail's session home - the half of the shell session.js does not
 * paint and must not learn about. signout.js owns these three, and the
 * stub draws them because every signed-in page does.
 *
 * They start in the markup's own resting state: the name says nothing,
 * the door is open, the exit is hidden. A stub that started at the
 * signed-in reading would let a repaint that never ran look identical
 * to one that ran correctly.
 */
let railRegistrations = 0;
const rail = {
  "session-who": { textContent: "" },
  "sign-in": { hidden: false },
  "sign-out": {
    hidden: true,
    addEventListener() { railRegistrations += 1; },
  },
};

globalThis.document = {
  readyState: "complete",
  getElementById(id) {
    return Object.prototype.hasOwnProperty.call(rail, id) ? rail[id] : null;
  },
};

await import("data:text/javascript," + encodeURIComponent(sessionSource));
const Session = globalThis.BinderSession;

check("the shipped file exposes one frozen session object",
  Session && Object.isFrozen(Session));
Session.require();
check("requiring a signed-out member page sends it to sign-in",
  redirects.length === 1 && redirects[0] === "index.html");

redirects.length = 0;
location.pathname = "/index.html";
check("the sign-in page does not redirect itself",
  Session.require() === null && redirects.length === 0);

/*
 * The page's name, on a host that rewrites the URL - #188. Cloudflare
 * Pages serves "your-page.html" at "your-page" and 308s the full name away,
 * with no setting that refuses (#143's hosted bake is where this bit).
 * Compared raw, that segment matches no rail href, and a host that
 * strips the index name the same way turns requireSession()'s redirect
 * into a loop: the sign-in page arrives named "index", which is never
 * "index.html". So the answer lives in one exported place with the
 * suffix restored, and nav.js asks it rather than keeping a second
 * computation that can disagree with the sign-in gate.
 */
location.pathname = "/demo/your-page";
check("a host-stripped page name answers with its file's own name",
  Session.pageName() === "your-page.html");
location.pathname = "/demo/your-page.html";
check("a name the host left alone passes through untouched",
  Session.pageName() === "your-page.html");
location.pathname = "/demo/";
check("a directory index is the sign-in page",
  Session.pageName() === "index.html");
location.pathname = "/demo/index";
redirects.length = 0;
check("a signed-out sign-in page stays put when the host strips its name",
  Session.require() === null && redirects.length === 0);
location.pathname = "/index.html";

const GOOD = {
  ok: true,
  session: "tab-token",
  expiresAt: "2099-01-02T03:04:05.000Z",
  username: "SomeHandle",
  isAdmin: false,
  telegramId: null,
};
const written = Session.write(GOOD);
check("write keeps the response fields the pages need",
  written.session === "tab-token" && written.username === "somehandle" &&
  written.isAdmin === false && written.telegramId === null);
check("the stored session is immutable", Object.isFrozen(written));
check("read recovers the tab-scoped session",
  Session.read().session === "tab-token");
check("authorization builds the bearer header",
  Session.authorization().Authorization === "Bearer tab-token");

location.pathname = "/your-page.html";
redirects.length = 0;
check("a signed-in member page is not redirected",
  Session.require().session === "tab-token" && redirects.length === 0);

values.set("hgb-session", "not json");
check("malformed storage fails closed and is removed",
  Session.read() === null && !values.has("hgb-session"));
values.set("hgb-session", JSON.stringify({
  ...GOOD,
  expiresAt: "2000-01-01T00:00:00.000Z",
}));
check("an expired session fails closed and is removed",
  Session.read() === null && !values.has("hgb-session"));

let invalid = null;
try { Session.write({ ok: true, session: "only-a-token" }); }
catch (error) { invalid = error; }
check("an incomplete auth response is refused",
  invalid && /invalid or expired/.test(invalid.message));
let unsuccessful = null;
try { Session.write({ ...GOOD, ok: false }); }
catch (error) { unsuccessful = error; }
check("a response that does not say it succeeded is refused",
  unsuccessful && /invalid or expired/.test(unsuccessful.message));

Session.write(GOOD);
Session.clear();
check("clear removes the credential and its header",
  Session.read() === null && !Session.authorization().Authorization);

/*
 * The shell stops claiming a session the moment the credential goes - #166.
 *
 * Observed on the live dev-arm rehearsal, not argued from source: after a
 * Worker 401 the page said "Your sign-in is no longer valid" and, three
 * inches away, "Signed in as alice", with sessionStorage already null. The
 * announcement is the only thing on the page that knows a session exists,
 * and it ran once at load and never again - so every surface it paints was
 * describing a credential that had been thrown away.
 *
 * Both directions of that property - a direct clear() and read()'s own
 * disposal of a rotted value - are driven against the rail further down
 * this file rather than here: session.js painted its own surface once too,
 * a development-session card that would have proven the same property
 * with no other file loaded, and that card is retired (0.9-M2-S1, #352;
 * 0.9-M2-S4, #355). The rail section below is signout.js's surface, not
 * session.js's own, but it is the one still standing, and "the rail stops
 * naming a member whose credential has just gone" and "a credential that
 * rots under the tab repaints the rail as it goes" are exactly this
 * property, proven the other way.
 */

/* ------------------------------------------------------------------ */
/* The transport, and the future widget callback that rides it.        */

globalThis.BINDER_CONFIG = { endpoint: "https://worker.example" };
globalThis.BinderUI = {
  setStatus() {},
  boot(setUp) { setUp(); },
};
location.pathname = "/index.html";
redirects.length = 0;

const requests = [];
let nextResponse = {
  ok: true,
  status: 200,
  async json() { return GOOD; },
};
globalThis.fetch = async function (url, options) {
  requests.push({ url, options });
  return nextResponse;
};

await import("data:text/javascript," + encodeURIComponent(authSource));
const Auth = globalThis.BinderAuth;
check("the shipped file exposes one frozen auth object",
  Auth && Object.isFrozen(Auth));

const authPayload = { id: 4242, hash: "signed" };
const firstSession = await Auth.authenticate("/auth/telegram", authPayload);
check("auth POSTs the exact payload to the configured Worker",
  requests[0].url === "https://worker.example/auth/telegram" &&
  requests[0].options.method === "POST" &&
  requests[0].options.headers["Content-Type"] === "application/json" &&
  requests[0].options.body === JSON.stringify(authPayload));
check("a successful auth response is stored before redirecting",
  firstSession.session === "tab-token" &&
  Session.read().session === "tab-token" &&
  redirects.at(-1) === "your-page.html");

/* The allowlist is a list of one, and that is the assertion (0.9-M2-S1,
   #352). A second sign-in door has to be added here on purpose. */
let secondDoor = null;
try { await Auth.authenticate("/auth/dev", authPayload); }
catch (error) { secondDoor = error; }
check("the retired development sign-in route is not a route this " +
  "transport will post to",
  secondDoor && /not a sign-in route/.test(secondDoor.message));

requests.length = 0;
await globalThis.onTelegramAuth({ id: 42, hash: "signed" });
check("the future widget callback uses the Telegram auth route",
  requests[0].url === "https://worker.example/auth/telegram");

/*
 * #58. The caller's own numeric id exists in exactly one place - the
 * sign-in response - and the member panel that draws it reads it back
 * out of the session, so this handoff is the only place it can be lost.
 * A sign-in that carried everything else across and dropped this leaves
 * the panel with nothing to draw and a first-time admin back in
 * devtools, with the gate green the whole way.
 *
 * The stub answers with a number rather than a string on purpose: that
 * is the shape the Worker sends, and an id that reached a page as 4242
 * would compare unequal to every string beside it.
 */
Session.clear();
nextResponse = {
  ok: true,
  status: 200,
  async json() { return { ...GOOD, isDev: false, telegramId: 4242 }; },
};
const telegramSession = await Auth.authenticate("/auth/telegram", { id: 4242 });
check("a Telegram sign-in carries the caller's own numeric id into the session",
  telegramSession.telegramId === "4242" &&
  Session.read().telegramId === "4242");

Session.clear();
redirects.length = 0;
/*
 * A refusal whose body is a complete, well-formed session, id and all.
 * That is the shape the status has to be load-bearing against: a 403
 * for somebody outside the group is still an answer about a real
 * Telegram account, and a transport that read the body before it read
 * the status would mint a session from a refusal and hand a stranger
 * their own number beside "this binder is for members of the group
 * only". A stub carrying only an error message cannot tell the two
 * apart, because write() rejects it for being incomplete rather than
 * for being refused.
 */
nextResponse = {
  ok: false,
  status: 403,
  async json() {
    return { ...GOOD, isDev: false, telegramId: 4242, error: "No entry." };
  },
};
let refused = null;
try { await Auth.authenticate("/auth/telegram", { id: 4242 }); }
catch (error) { refused = error; }
check("a refused sign-in is neither stored nor redirected",
  refused && refused.message === "No entry." &&
  Session.read() === null && redirects.length === 0);
check("a refused sign-in leaves no id behind for any page to draw",
  Session.read() === null && !values.has("hgb-session"));
const callbackRefusal = await globalThis.onTelegramAuth({ id: 42 });
check("the widget callback reports refusal on-page without rejecting",
  callbackRefusal === null && Session.read() === null && redirects.length === 0);

let wrongRoute = null;
try { await Auth.authenticate("https://elsewhere.example", {}); }
catch (error) { wrongRoute = error; }
check("authentication cannot be pointed at an arbitrary route",
  wrongRoute && /not a sign-in route/.test(wrongRoute.message));

const memberPages = ["index.html", "your-page.html", "charts.html", "admin.html"];
const pageSources = await Promise.all(memberPages.map((page) =>
  readFile(new URL("../apps/web/" + page, import.meta.url), "utf8")));
check("every interactive page loads session.js",
  pageSources.every((source) => source.includes('src="session.js"')));
const notFoundSource = await readFile(
  new URL("../apps/web/404.html", import.meta.url), "utf8");
check("the inert 404 page does not load session.js",
  !notFoundSource.includes('src="session.js"'));
check("the submission request carries the session authorization header",
  formSource.includes("BinderSession.authorization()"));

/*
 * The third pin is a module boundary rather than a style rule - #90.
 *
 * `clear()` is also what `read()` calls on a malformed or expired stored
 * value, and what the member panel calls when `/me` answers 401. A revoke
 * living in here would fire a doomed `DELETE` on both of those, one of
 * them for a session the endpoint has just refused. Ending a session is
 * an act somebody performs, so that request belongs at the sign-out call
 * site; this file stays the credential store, with no endpoint of its own
 * and no knowledge of BINDER_CONFIG.
 */
for (const [label, pattern] of [
  ["session.js never touches persistent localStorage", /\blocalStorage\b/],
  ["session.js never puts a credential in a URL", /URLSearchParams|location\.hash/],
  ["session.js keeps no network surface of its own", /\bfetch\s*\(|sendBeacon/],
]) {
  check(label, !pattern.test(sessionSource));
}

/*
 * The fourth arm, and the one that says where the act went - #73.
 *
 * The three above are satisfied by a file that does nothing at all, so
 * on their own they would keep passing if the revoke simply vanished
 * from the site. They say where the act may not live; this one says
 * where it does. signout.js holds the network session.js refuses, and
 * every page whose rail offers the button loads it.
 */
const signOutSource = await readFile(
  new URL("../apps/web/signout.js", import.meta.url), "utf8");

check("the sign-out act keeps the network session.js refuses to hold",
  /\bfetch\s*\(/.test(signOutSource) && /"DELETE"/.test(signOutSource) &&
  /keepalive/.test(signOutSource));

const railPages = ["your-page.html", "charts.html", "admin.html"];
const railSources = await Promise.all(railPages.map((page) =>
  readFile(new URL("../apps/web/" + page, import.meta.url), "utf8")));
check("every page whose rail offers Sign out loads the file that does it",
  railSources.every((source) => source.includes('src="signout.js"')));

/*
 * The page that must NOT load it, and the reason is the same one that
 * keeps the rail off this page: there is no session to end on the page
 * that mints one. A cover offering Sign out is the copy-paste accident
 * tools/check_web.py refuses in markup; this refuses it in scripts.
 */
const coverSource = await readFile(
  new URL("../apps/web/index.html", import.meta.url), "utf8");
check("the sign-in page does not load the sign-out act",
  !coverSource.includes('src="signout.js"'));

/*
 * apps/web/submit.js does not touch the prefill key (#172's whole
 * device-memory mechanism is not part of it): the Worker answers "what
 * did I say last time" itself, so there is nothing left for a page to
 * read back from a local store. apps/web/signout.js still declares the
 * constant and still erases it on Sign out (clearPrefill() is
 * unconditional best-effort cleanup, harmless whether anything ever
 * wrote the key or not), so the erase is still checked below.
 * apps/web/submit.js DOES call root.BinderSignOut.signOut() from its own
 * clearing function, for a reason that has nothing to do with the
 * prefill key - and a regex that only asked "does 'BinderSignOut' appear
 * in submit.js" cannot tell that call apart from a genuine borrow of the
 * key, which is why the check below asks about the key by name instead.
 */
const submitSource = await readFile(
  new URL("../apps/web/submit.js", import.meta.url), "utf8");
check("the prefill key is declared in signout.js",
  /const PREFILL_KEY = "hgb-submit-prefill";/.test(signOutSource));
check("submit.js no longer touches the prefill key at all - #172's " +
  "device-memory mechanism is retired from this file (0.9-M2-S2)",
  !/"hgb-submit-prefill"/.test(submitSource) &&
  !/prefillKey/.test(submitSource));

/* ------------------------------------------------------------------ */
/* The rail, which is the shell half this file must not paint - #166.  */

/*
 * The rail is painted once by signout.js at load and, until this, never
 * again. So a credential dropped under the tab left the rail describing
 * it, and the page said "your sign-in is no longer valid" three inches
 * from "Signed in as alice" with nothing on screen to say which half
 * was true.
 *
 * THE DIRECTION IS THE CONTRACT, NOT JUST THE EFFECT. The store
 * announces that its credential changed and says nothing about what
 * paints; a surface subscribes and re-reads. Wired the other way round -
 * session.js reaching for #session-who - every behavioral arm below
 * still passes, and the credential store has acquired the rail's markup,
 * so the next surface that needs the same treatment is another edit to
 * the store. The last two arms are what refuse that shape.
 *
 * The notification carries no value on purpose. A listener handed a copy
 * can act on a credential the store has already moved past; one that
 * re-reads cannot, and the store stays the single home of what is true.
 *
 * signout.js is loaded here rather than at the top because loading it
 * earlier would have it repainting through every clear() above, and an
 * arm that passes because some unrelated line happened to leave the rail
 * blank is not an arm.
 */
check("the credential store names no rail element of its own",
  !/session-who/.test(sessionSource));
check("the rail subscribes rather than the store reaching for the rail",
  /onChange\s*\(/.test(signOutSource) && /onChange/.test(sessionSource));

// Cleared before the file is loaded so the paint it does on the way in is
// the signed-out one. Inheriting whatever session the section above left
// behind would make the first reading below depend on test order.
Session.clear();
await import("data:text/javascript," + encodeURIComponent(signOutSource));

location.pathname = "/your-page.html";
redirects.length = 0;
Session.write(GOOD);
Session.require();

// Captured before the act: "Not signed in" after the fact is also what
// a repaint that never happened leaves behind, and the door standing
// open is the state the markup ships in. Each arm below carries this,
// so none of them can pass on a rail that was never painted at all.
const railHeld =
  rail["session-who"].textContent === "Signed in as somehandle" &&
  rail["sign-out"].hidden === false && rail["sign-in"].hidden === true;
const registrationsHeld = railRegistrations;

Session.clear();
check("the rail stops naming a member whose credential has just gone",
  railHeld && rail["session-who"].textContent === "Not signed in");
check("and the way back in is offered again in the same breath",
  railHeld && rail["sign-in"].hidden === false &&
  rail["sign-out"].hidden === true);
/*
 * A browser drops a repeat addEventListener with the same type and the
 * same function reference, so re-registering is a no-op there and this
 * stub cannot prove that - it has no such rule. What it can prove is the
 * thing that makes the question moot: the death repaint takes the
 * no-session branch and never reaches the registration at all. The first
 * half is what stops that reading from being free - the signed-in
 * repaint has to have wired the button before its absence means
 * anything. How often it wired it is deliberately left open: that count
 * is how many signed-in paints happened, which is not the contract, and
 * pinning it would break this arm every time an announcement is added
 * somewhere the rail is right to react to.
 */
check("a repaint for a dead session wires no second sign-out handler",
  registrationsHeld >= 1 && railRegistrations === registrationsHeld);

/*
 * The caller nobody writes: read() disposing of a value it will not use.
 * A subscription bolted to the pages that act on a 401 leaves this path
 * repainting nothing, and this is the path that runs when a tab is left
 * open past the session's expiry - the common way to meet the bug.
 */
Session.write(GOOD);
Session.require();
let notices = 0;
Session.onChange(function () { notices += 1; });
values.set("hgb-session", "not json");
check("a credential that rots under the tab repaints the rail as it goes",
  Session.read() === null &&
  rail["session-who"].textContent === "Not signed in");
/*
 * Once, and the count is the point rather than a tidiness check. Every
 * listener re-reads, and read() is itself a caller of clear(): a store
 * that announced again from inside its own announcement would recurse
 * through its readers until the stack gave out, in the browser, on the
 * expiry path.
 */
check("and the store announces that once, not once per reader that looks",
  notices === 1);

/*
 * THE SAME PATH ON A BROWSER THAT WILL NOT LET GO - F-4, and the arm
 * above cannot reach it.
 *
 * That arm terminates because the removal worked: the listeners re-read,
 * find nothing, and leave. The whole no-recursion argument rested on
 * that, and removeItem throws in hardened configurations and under an
 * exhausted quota. When it does, the expired value is still sitting
 * there, so every re-read disposes of it again - measured at roughly two
 * thousand frames before the stack gave out, two thousand repaints, and
 * the RangeError swallowed by the listener guard, on the expiry path
 * that a tab left open overnight takes.
 *
 * Three separate promises, because a fix could keep any two and break
 * the third: the verdict is still "no session" (fail open to expired,
 * never fail closed onto a dead credential), the disposal does not
 * recurse, and the refusal is not silent. The count is asserted rather
 * than the mere absence of a crash - a stack that survives because the
 * announcement was dropped altogether would leave every surface on the
 * page painting a session that is gone, which is the bug #166 fixed.
 */
Session.write(GOOD);
Session.require();
let refusedNotices = 0;
Session.onChange(function () { refusedNotices += 1; });
values.set("hgb-session", JSON.stringify({
  ...GOOD,
  expiresAt: "2000-01-01T00:00:00.000Z",
}));

const warned = [];
const realWarn = console.warn;
console.warn = function (...args) { warned.push(args); };
refuseRemoval = true;
let overflowed = null;
let refusedVerdict;
try { refusedVerdict = Session.read(); }
catch (error) { overflowed = error; }
refuseRemoval = false;
console.warn = realWarn;

check("an expiry the browser refuses to release still reads as no session",
  overflowed === null && refusedVerdict === null);
check("and disposing of it does not recurse through its own readers",
  refusedNotices === 1);
check("and the rail is repainted for the credential that is gone",
  rail["session-who"].textContent === "Not signed in");
check("and the browser's refusal is reported rather than swallowed",
  warned.length === 1 && /sessionStorage/.test(String(warned[0][0])));

// The refused value is still in the store, which is the honest state
// this leaves behind; the arms below write their own credential over it
// rather than inheriting it.
values.delete("hgb-session");

/*
 * A reader that throws is a painting bug. Letting it out of clear() would
 * make it a credential bug: clear() is called from read() and from the
 * refusal paths, and an exception escaping it turns disposal of a dead
 * token into a page-breaking error at a moment nobody chose.
 */
Session.write(GOOD);
Session.require();
let reached = false;
Session.onChange(function () { throw new Error("a paint that failed"); });
Session.onChange(function () { reached = true; });
// Caught here rather than left to the runner, so a store that stops
// containing this reports as a named failure. Uncaught, it lands as an
// exception mid-suite and takes every check after it down with no line
// saying which promise the store broke.
let escaped = null;
try { Session.clear(); } catch (error) { escaped = error; }
check("a reader that throws costs neither the drop nor the next reader",
  escaped === null && Session.read() === null && reached === true &&
  rail["session-who"].textContent === "Not signed in");

/*
 * The other direction, and it is what keeps the exported name honest.
 * A store that announced only losses would call itself onChange while
 * reporting half of what it says, and the next surface to subscribe
 * would react to sign-out and silently not to sign-in - a shell wired
 * for one edge, which is the shape of the bug this all started as.
 *
 * Nothing has re-required the page here: the drop above left the rail
 * reading "Not signed in", and write() alone has to move it.
 */
const railEmptied = rail["session-who"].textContent === "Not signed in";
Session.write(GOOD);
check("gaining a credential is announced as much as losing one",
  railEmptied &&
  rail["session-who"].textContent === "Signed in as somehandle" &&
  rail["sign-in"].hidden === true && rail["sign-out"].hidden === false);

/* ------------------------------------------------------------------ */
/* The sign-out acknowledgement - #265, owner-ruled, mockup-gated.     */

/*
 * SIGNING OUT AND ARRIVING FRESH LOOKED IDENTICAL, and that is what
 * this pair fixes.
 *
 * signOut() revokes the session, erases the prefill, deletes the device
 * key and replaces the page with index.html - four acts, and the member
 * was shown none of them. They landed on an unchanged sign-in page,
 * indistinguishable from opening the site for the first time, having
 * just been told nothing about the browser they are handing back.
 *
 * The mechanism is the smallest honest one: a flag in sessionStorage,
 * written immediately before the navigation and CONSUMED by the page
 * that reads it. Consumed, not merely read - the line is an
 * acknowledgement of an act, so the second load of that page must show
 * nothing, and a flag that outlived its reading would turn "you just
 * signed out" into a permanent notice on a page nobody signed out from.
 *
 * sessionStorage rather than localStorage for the reason the session
 * itself uses it: the fact is about this tab. A second tab of this
 * origin never signed anybody out and must not be told it did.
 *
 * WHY ORDER IS PINNED. location.replace() ends the page, so a flag
 * written after it is a flag written by nobody. The stub records the
 * store as it stood at the moment of the navigation, which is the only
 * moment that can prove it.
 */
const SignOut = globalThis.BinderSignOut;

let flagAtNavigation = null;
const realReplace = location.replace;
location.replace = function (target) {
  flagAtNavigation = values.has("hgb-signed-out")
    ? values.get("hgb-signed-out") : null;
  return realReplace.call(this, target);
};

Session.write(GOOD);
redirects.length = 0;
SignOut.signOut();
location.replace = realReplace;

check("signing out leaves a mark for the page it is sending the member to",
  flagAtNavigation !== null && redirects.at(-1) === "index.html");

/*
 * And the door reads it exactly once. Two loads of the same file, the
 * second differing from the first only in what the first left behind -
 * which is the whole claim, so both halves are one arm's business.
 *
 * THE VEHICLE IS A TOAST NOW (owner ruling 2026-08-23, UX record #454
 * comment 5389445914, raised as F2 by the 0.9-M3-S33b review on #457):
 * the acknowledgement used to reveal an inline <p id="signed-out">,
 * which made it a fourth thing painting above the sign-in button on
 * the commonest way back to this page. The ruled WORDS are unchanged
 * and are asserted here, so this arm proves the sentence a member
 * actually reads rather than only that something was revealed.
 */
const ack = { hidden: true, textContent: "" };
const realShowToast = globalThis.BinderUI.showToast;
globalThis.BinderUI.showToast = function (message) {
  ack.hidden = false;
  ack.textContent = String(message);
};

Session.clear();
redirects.length = 0;
await import("data:text/javascript," + encodeURIComponent(authSource) +
  "#signed-out-arrival");
const revealed = ack.hidden === false;
const consumed = !values.has("hgb-signed-out");

ack.hidden = true;
await import("data:text/javascript," + encodeURIComponent(authSource) +
  "#ordinary-arrival");

check("the sign-in page says so on arrival from a sign-out",
  revealed && redirects.length === 0);
check("and it says it in the owner's own ruled words, through the " +
  "shared toast rather than an inline line above the button",
  ack.textContent === "Signed out.");
check("and the mark is spent, so an ordinary visit says nothing",
  consumed && ack.hidden === true);

/*
 * TWO FILES, ONE NAME, AND NO IMPORT BETWEEN THEM. index.html does not
 * load signout.js - the sign-in page must not offer an act there is no
 * session for - so the writer and the reader cannot share a constant
 * the way submit.js borrows the prefill key. This is the KEY_DB_NAME
 * arrangement instead: two literals, compared here, because a rename on
 * one side alone is a sign-out that marks a page nobody reads and a
 * door that waits for a mark nobody writes. Both halves fail silently,
 * and the visible result is the exact absence #265 filed.
 */
const signOutMark = /"(hgb-signed-out)"/.exec(signOutSource);
check("the sign-out mark is one name written the same way in both files",
  signOutMark !== null && authSource.includes('"' + signOutMark[1] + '"'));

if (globalThis.BinderUI) globalThis.BinderUI.showToast = realShowToast;

report();
