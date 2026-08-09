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
const { check, report } = nodeTestSuite("session/auth", 49);

const values = new Map();
globalThis.sessionStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};

const redirects = [];
globalThis.location = {
  pathname: "/submit.html",
  replace(target) { redirects.push(target); },
};

const identity = { textContent: "" };
const banner = {
  hidden: true,
  querySelector(selector) {
    return selector === "[data-dev-identity]" ? identity : null;
  },
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
  querySelector(selector) {
    return selector === "[data-dev-session]" ? banner : null;
  },
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
 * Pages serves "submit.html" at "submit" and 308s the full name away,
 * with no setting that refuses (#143's hosted bake is where this bit).
 * Compared raw, that segment matches no rail href, and a host that
 * strips the index name the same way turns requireSession()'s redirect
 * into a loop: the sign-in page arrives named "index", which is never
 * "index.html". So the answer lives in one exported place with the
 * suffix restored, and nav.js asks it rather than keeping a second
 * computation that can disagree with the sign-in gate.
 */
location.pathname = "/demo/submit";
check("a host-stripped page name answers with its file's own name",
  Session.pageName() === "submit.html");
location.pathname = "/demo/submit.html";
check("a name the host left alone passes through untouched",
  Session.pageName() === "submit.html");
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
  isDev: true,
  telegramId: null,
};
const written = Session.write(GOOD);
check("write keeps the response fields the pages need",
  written.session === "tab-token" && written.username === "somehandle" &&
  written.isAdmin === false && written.isDev === true &&
  written.telegramId === null);
check("the stored session is immutable", Object.isFrozen(written));
check("read recovers the tab-scoped session",
  Session.read().session === "tab-token");
check("authorization builds the bearer header",
  Session.authorization().Authorization === "Bearer tab-token");

location.pathname = "/submit.html";
redirects.length = 0;
check("a signed-in member page is not redirected",
  Session.require().session === "tab-token" && redirects.length === 0);
check("a development session is visibly labelled",
  banner.hidden === false && identity.textContent === "somehandle");

Session.write({ ...GOOD, session: "real-token", isDev: false });
Session.require();
check("a real session does not show the development banner",
  banner.hidden === true && identity.textContent === "");

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
 * Both directions are driven here because clear() has two callers with
 * nothing in common: a page acting on a refusal, and read() disposing of a
 * value it will not use. A fix wired into only the first leaves the second
 * painting a dead session for the rest of the tab's life, and the second is
 * the one no page calls on purpose.
 */
Session.write(GOOD);
Session.require();
// The precondition is captured before the act rather than asserted inside
// the check, so a failure cannot be read two ways: this says the banner was
// up and then came down, not merely that it is down now - which is also
// true of an announcement that never ran at all.
const announced = banner.hidden === false && identity.textContent === "somehandle";
Session.clear();
check("a session announced and then discarded leaves nothing announced",
  announced && banner.hidden === true && identity.textContent === "");

Session.write(GOOD);
Session.require();
values.set("hgb-session", "not json");
check("a credential that rots under the tab is un-announced as it is dropped",
  Session.read() === null && banner.hidden === true &&
  identity.textContent === "");

/* ------------------------------------------------------------------ */
/* The common half of /auth/dev and the future widget callback.        */

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

const devPayload = {
  secret: "test-only-secret",
  subject: "alice",
  admin: false,
};
const devSession = await Auth.authenticate("/auth/dev", devPayload);
check("development auth POSTs the exact payload to the configured Worker",
  requests[0].url === "https://worker.example/auth/dev" &&
  requests[0].options.method === "POST" &&
  requests[0].options.headers["Content-Type"] === "application/json" &&
  requests[0].options.body === JSON.stringify(devPayload));
check("a successful auth response is stored before redirecting",
  devSession.session === "tab-token" &&
  Session.read().session === "tab-token" &&
  redirects.at(-1) === "submit.html");

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
try { await Auth.authenticate("/auth/dev", devPayload); }
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

const memberPages = ["index.html", "submit.html", "dashboard.html", "admin.html"];
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

const railPages = ["submit.html", "dashboard.html", "admin.html"];
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
 * The prefill key exists in two files' orbit now: signout.js declares
 * it and erases it, submit.js borrows it to read and write. Two
 * literals would be a rename away from a sign-out that erases a key
 * nobody writes any more - silent, and only visible as somebody else's
 * measurements on a shared browser, which is exactly what #56 was
 * filed for.
 *
 * So the constant is asserted to have ONE home. The negative half is
 * the load-bearing one: a second copy in submit.js is what this
 * forbids, and it would pass every behavioral check in the suite next
 * door for as long as the two strings happened to agree.
 */
const submitSource = await readFile(
  new URL("../apps/web/submit.js", import.meta.url), "utf8");
check("the prefill key is declared in signout.js",
  /const PREFILL_KEY = "hgb-submit-prefill";/.test(signOutSource));
check("submit.js borrows that key rather than declaring a second copy",
  !/"hgb-submit-prefill"/.test(submitSource) &&
  /BinderSignOut|SignOut\.prefillKey/.test(submitSource));

/* ------------------------------------------------------------------ */
/* The rail, which is the shell half this file must not paint - #166.  */

/*
 * The development-session card above is session.js's own surface and is
 * already un-announced when the credential goes. The rail is not: it is
 * painted once by signout.js at load and, until this, never again. So a
 * credential dropped under the tab left the rail describing it, and the
 * page said "your sign-in is no longer valid" three inches from "Signed
 * in as alice" with nothing on screen to say which half was true.
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

location.pathname = "/submit.html";
redirects.length = 0;
Session.write(GOOD);
Session.require();

// Captured before the act, for the reason the banner's arm gives: "Not
// signed in" after the fact is also what a repaint that never happened
// leaves behind, and the door standing open is the state the markup
// ships in. Each arm below carries this, so none of them can pass on a
// rail that was never painted at all.
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
 * repaint has to have wired the button before its absence means anything.
 */
check("a repaint for a dead session wires no second sign-out handler",
  registrationsHeld === 1 && railRegistrations === registrationsHeld);

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
Session.clear();
check("a reader that throws costs neither the drop nor the next reader",
  Session.read() === null && reached === true &&
  rail["session-who"].textContent === "Not signed in");

report();
