/*
 * Contract checks for the tab-scoped member session and sign-in transport.
 * The shipped files run unchanged under small browser stubs, matching the
 * pattern used for ui.js without teaching the product about a test runner.
 */
import { readFile } from "node:fs/promises";

const sessionSource = await readFile(
  new URL("../apps/web/session.js", import.meta.url), "utf8");
const authSource = await readFile(
  new URL("../apps/web/auth.js", import.meta.url), "utf8");
const formSource = await readFile(
  new URL("../apps/web/form.js", import.meta.url), "utf8");

let failures = 0;
function check(label, condition) {
  if (!condition) failures++;
  console.log(condition ? "pass " : "FAIL ", label);
}

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
globalThis.document = {
  readyState: "complete",
  querySelector(selector) {
    return selector === "[data-dev-session]" ? banner : null;
  },
  getElementById() { return null; },
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

Session.clear();
redirects.length = 0;
nextResponse = {
  ok: false,
  status: 403,
  async json() { return { error: "No entry." }; },
};
let refused = null;
try { await Auth.authenticate("/auth/dev", devPayload); }
catch (error) { refused = error; }
check("a refused sign-in is neither stored nor redirected",
  refused && refused.message === "No entry." &&
  Session.read() === null && redirects.length === 0);
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

for (const [label, pattern] of [
  ["session.js never touches persistent localStorage", /\blocalStorage\b/],
  ["session.js never puts a credential in a URL", /URLSearchParams|location\.hash/],
]) {
  check(label, !pattern.test(sessionSource));
}

if (failures) {
  console.error(`\nsession/auth FAILED ${failures} check(s)`);
  process.exit(1);
}
console.log("\nsession/auth OK - 27 checks");
