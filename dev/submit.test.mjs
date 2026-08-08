/*
 * Contract checks for the member panel on submit.html.
 *
 * The shipped page module runs unchanged under the same small browser stubs
 * as session.test.mjs and public.test.mjs. The missing module is treated as
 * an empty module so this contract reports every absent behavior on its first
 * red run instead of stopping at ENOENT before a check can run.
 */
import { readFile } from "node:fs/promises";

const sessionSource = await readFile(
  new URL("../apps/web/session.js", import.meta.url), "utf8");
const formSource = await readFile(
  new URL("../apps/web/form.js", import.meta.url), "utf8");
const submitHtml = await readFile(
  new URL("../apps/web/submit.html", import.meta.url), "utf8");
const submitSource = await readFile(
  new URL("../apps/web/submit.js", import.meta.url), "utf8")
  .catch((error) => {
    if (error && error.code === "ENOENT") return "";
    throw error;
  });

const PREFILL_KEY = "hgb-submit-prefill";
const SUBMITTED_EVENT = "binder:submitted";
const ADD_ENTRY_SHOWN_EVENT = "binder:add-entry-shown";

let failures = 0;
function check(label, condition) {
  if (!condition) failures++;
  console.log(condition ? "pass " : "FAIL ", label);
}

// Sign-out fires a request it does not wait for, so the promise it
// abandons has to be handled or the page logs a rejection nobody can
// act on. Collected rather than left to Node's default, which is to
// kill the process: a suite that dies mid-run reports one crash instead
// of one failed check and every check after it.
const unhandled = [];
process.on("unhandledRejection", function (reason) { unhandled.push(reason); });

function storage(values) {
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

const sessionValues = new Map();
const localValues = new Map();
globalThis.sessionStorage = storage(sessionValues);
globalThis.localStorage = storage(localValues);

const redirects = [];
globalThis.location = {
  pathname: "/submit.html",
  replace(target) { redirects.push(target); },
};

function makeElement(id, hidden = false) {
  const listeners = new Map();
  const attributes = new Map();
  return {
    id,
    hidden,
    textContent: "",
    value: "",
    checked: false,
    className: "",
    dateTime: "",
    addEventListener(type, listener) {
      const handlers = listeners.get(type) || [];
      handlers.push(listener);
      listeners.set(type, handlers);
    },
    async dispatch(type) {
      const event = {
        type,
        target: this,
        currentTarget: this,
        preventDefault() {},
      };
      for (const listener of listeners.get(type) || []) {
        await listener.call(this, event);
      }
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    removeAttribute(name) { attributes.delete(name); },
    getClientRects() { return this.hidden ? [] : [{}]; },
  };
}

function makePage() {
  const elements = {
    "your-entries-tab": makeElement("your-entries-tab"),
    "add-entry-tab": makeElement("add-entry-tab"),
    "your-entries-pane": makeElement("your-entries-pane", true),
    "add-entry-pane": makeElement("add-entry-pane", true),
    "member-entry-count": makeElement("member-entry-count"),
    "member-last-at": makeElement("member-last-at"),
    // Starts hidden, as the markup does. A line that begins painted
    // would let a page which never renders anything pass the check
    // that it is on screen.
    "member-telegram-id-line": makeElement("member-telegram-id-line", true),
    "member-telegram-id": makeElement("member-telegram-id"),
    // Present so a check can read what the panel said, rather than
    // watching setStatus write into a null that swallows every message.
    "member-panel-status": makeElement("member-panel-status", true),
    "sign-out": makeElement("sign-out"),
    "weight-lb": makeElement("weight-lb"),
    "height-ft": makeElement("height-ft"),
    "height-in": makeElement("height-in"),
    "weight-kg": makeElement("weight-kg"),
    "height-cm": makeElement("height-cm"),
  };
  const documentListeners = new Map();
  // Every type this page dispatched, so a check can assert the panel told
  // form.js the form is on screen again - #64. The panel must announce
  // rather than reach into #done and #submission, which belong to form.js.
  const dispatchedHere = [];
  const document = {
    readyState: "complete",
    dispatchedHere,
    dispatchEvent(event) {
      dispatchedHere.push(event && event.type);
      const handlers = documentListeners.get(event && event.type) || [];
      for (const listener of handlers) listener.call(document, event);
      return true;
    },
    getElementById(id) { return elements[id] || null; },
    querySelector(selector) {
      if (selector === "[data-dev-session]") return null;
      return null;
    },
    querySelectorAll() { return []; },
    addEventListener(type, listener) {
      const handlers = documentListeners.get(type) || [];
      handlers.push(listener);
      documentListeners.set(type, handlers);
    },
    async dispatch(type) {
      const event = { type, target: document, currentTarget: document };
      for (const listener of documentListeners.get(type) || []) {
        await listener.call(document, event);
      }
    },
  };
  return { document, elements };
}

globalThis.document = makePage().document;
await import("data:text/javascript," + encodeURIComponent(sessionSource));
const Session = globalThis.BinderSession;

globalThis.getComputedStyle = function (element) {
  return { display: element && element.hidden ? "none" : "flex" };
};

function response(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

const MEMBER = {
  ok: true,
  session: "member-session-token",
  expiresAt: "2099-01-02T03:04:05.000Z",
  username: "member",
  isAdmin: false,
  isDev: false,
  telegramId: "10",
};

let scenario = 0;
async function loadSubmit({ member = MEMBER, replies = [], prefill } = {}) {
  const page = makePage();
  const requests = [];
  const bootErrors = [];

  Session.clear();
  if (member) Session.write(member);
  localValues.clear();
  if (prefill !== undefined) localValues.set(PREFILL_KEY, prefill);
  redirects.length = 0;
  location.pathname = "/submit.html";

  globalThis.document = page.document;
  globalThis.BINDER_CONFIG = { endpoint: "https://worker.example" };
  globalThis.BinderUI = {
    byId(id) { return page.elements[id] || null; },
    show(element, visible) { if (element) element.hidden = !visible; },
    boot(setUp, failed) {
      try {
        const result = setUp();
        if (result && typeof result.then === "function") {
          result.catch((error) => {
            bootErrors.push(error);
            failed(error);
          });
        }
      } catch (error) {
        bootErrors.push(error);
        failed(error);
      }
    },
  };
  // A reply may be a function returning the promise itself, because the
  // two cases sign-out has to survive - a request that rejects and one
  // that never settles - are not expressible as a response object. The
  // stub is a plain function rather than an async one for the same
  // reason: `async` would turn a synchronous throw into a rejection and
  // hide the difference.
  globalThis.fetch = function (url, options) {
    requests.push({ url, options: options || {} });
    const next = replies.shift();
    if (typeof next === "function") return next();
    return Promise.resolve(
      next || response(500, { error: "No stub response." }));
  };

  scenario++;
  await import("data:text/javascript," + encodeURIComponent(submitSource) +
    "#submit-panel-" + scenario);
  await new Promise((resolve) => setImmediate(resolve));
  return { ...page, requests, bootErrors };
}

function isPainted(element) {
  return globalThis.getComputedStyle(element).display !== "none" &&
    element.getClientRects().length > 0;
}

function authorization(request) {
  return request && request.options.headers &&
    request.options.headers.Authorization;
}

const panelIds = [
  "your-entries-tab", "add-entry-tab", "your-entries-pane",
  "add-entry-pane", "member-entry-count", "member-last-at", "sign-out",
  "member-telegram-id-line", "member-telegram-id",
];
check("submit.html declares the panel controls and loads its shipped module",
  panelIds.every((id) => submitHtml.includes(`id="${id}"`)) &&
  /src="submit\.js"/.test(submitHtml));

const lastAt = "2026-08-07T14:30:00.000Z";
const panel = await loadSubmit({
  replies: [response(200, {
    ok: true,
    entries: 41,
    lastAt,
    isAdmin: false,
    isDev: false,
  })],
});
const panelRequest = panel.requests[0];
check("the panel GETs /me with the member authorization",
  panel.requests.length === 1 &&
  panelRequest.url === "https://worker.example/me" &&
  (panelRequest.options.method || "GET") === "GET" &&
  authorization(panelRequest) === "Bearer member-session-token");
check("the panel renders the route's exact count and last-submitted time",
  panel.elements["member-entry-count"].textContent === "41" &&
  panel.elements["member-last-at"].dateTime === lastAt &&
  panel.elements["member-last-at"].textContent ===
    new Date(lastAt).toLocaleString());

/*
 * #58. The Worker returns the caller's own numeric id at sign-in for
 * one stated purpose: somebody being made an admin has to put that id
 * in ADMIN_TELEGRAM_IDS, and a page showing it is what keeps them from
 * asking a third-party bot for it instead - which is how a real numeric
 * id reaches somebody nobody here controls.
 *
 * The value arriving and no page drawing it is the entire defect, so
 * what is asserted is that it PAINTS. `textContent` alone would pass on
 * a line written into a permanently hidden element, which is the same
 * amount of use to a first-time admin as not writing it at all.
 */
check("a signed-in member can read their own numeric id off the panel",
  panel.elements["member-telegram-id"].textContent === "10" &&
  isPainted(panel.elements["member-telegram-id-line"]));

/*
 * And where it comes from. The account summary has no business carrying
 * a Telegram id and does not: the sign-in response is the only thing
 * that ever saw it. A page that drew whatever /me happened to contain
 * would be telling somebody which number to configure on the word of a
 * route that never knew it, so the stub answers with a different id on
 * purpose - "the right number appeared" is equally true of both sources
 * until they disagree.
 */
const foreignId = await loadSubmit({
  replies: [response(200, {
    ok: true, entries: 1, lastAt: null, telegramId: "99999",
  })],
});
check("the id on screen is the session's, not whatever /me answered with",
  foreignId.elements["member-telegram-id"].textContent === "10");

/*
 * A development sign-in has none to show. POST /auth/dev mints an
 * account for a subject string rather than for a Telegram user, so it
 * answers with a null id, and both halves matter here: an empty field
 * with the line still painted reads as "Your Telegram id:" followed by
 * nothing, which looks like a broken page rather than like a session
 * that has no such id.
 */
const devPanel = await loadSubmit({
  member: { ...MEMBER, isDev: true, telegramId: null },
  replies: [response(200, { ok: true, entries: 0, lastAt: null })],
});
check("a development session shows no numeric id rather than an empty one",
  devPanel.elements["member-telegram-id"].textContent === "" &&
  !isPainted(devPanel.elements["member-telegram-id-line"]));

const refreshed = await loadSubmit({
  replies: [
    response(200, { ok: true, entries: 5, lastAt: null }),
    response(200, { ok: true, entries: 11, lastAt }),
  ],
});
await refreshed.document.dispatch(SUBMITTED_EVENT);
await new Promise((resolve) => setImmediate(resolve));
check("a successful submit re-reads /me instead of incrementing a local tally",
  refreshed.requests.length === 2 &&
  refreshed.requests.every((request) =>
    request.url === "https://worker.example/me") &&
  refreshed.elements["member-entry-count"].textContent === "11");
check("form.js announces success only after the Worker stores the entry",
  formSource.includes(`new CustomEvent("${SUBMITTED_EVENT}")`) &&
  formSource.indexOf(`new CustomEvent("${SUBMITTED_EVENT}")`) >
    formSource.indexOf("if (!response.ok)"));

const tabs = await loadSubmit({
  replies: [response(200, { ok: true, entries: 2, lastAt: null })],
});
check("a member with no submissions sees an honest empty timestamp",
  tabs.elements["member-last-at"].textContent === "No entries yet" &&
  tabs.elements["member-last-at"].dateTime === "");
check("the entries tab initially paints only the entries pane",
  isPainted(tabs.elements["your-entries-pane"]) &&
  !isPainted(tabs.elements["add-entry-pane"]));
await tabs.elements["add-entry-tab"].dispatch("click");
check("the add-entry tab paints exactly one pane",
  !isPainted(tabs.elements["your-entries-pane"]) &&
  isPainted(tabs.elements["add-entry-pane"]));
check("choosing Add entry announces that the form is on screen",
  tabs.document.dispatchedHere.includes(ADD_ENTRY_SHOWN_EVENT));
await tabs.elements["your-entries-tab"].dispatch("click");
check("switching back never leaves both panes painted",
  isPainted(tabs.elements["your-entries-pane"]) &&
  !isPainted(tabs.elements["add-entry-pane"]));
check("choosing Your entries announces nothing about the form",
  tabs.document.dispatchedHere.filter(
    (type) => type === ADD_ENTRY_SHOWN_EVENT).length === 1);

/*
 * The panel must not know that #done and #submission are a pair - #64.
 * Whoever owns the swap owns the un-swap, and that is form.js. If this file
 * ever starts touching those ids directly, the two files can disagree about
 * which one is showing, which is the defect in a different shape.
 */
check("the panel never reaches into the form's own elements",
  !submitSource.includes('"done"') && !submitSource.includes('"submission"'));
check("form.js is the file that reopens the form",
  formSource.includes(`"${ADD_ENTRY_SHOWN_EVENT}"`));

const signedOut = await loadSubmit({ member: null });
check("a signed-out visitor never reaches the panel or requests /me",
  redirects.includes("index.html") && signedOut.requests.length === 0 &&
  !isPainted(signedOut.elements["your-entries-pane"]) &&
  !isPainted(signedOut.elements["add-entry-pane"]));
/* The id is shown on the authenticated path and nowhere else, so it is
 * asserted on the path that has no session rather than left to follow
 * from the pane being hidden - a later change that draws the line
 * outside the pane would keep that check green. */
check("and is shown no numeric id on the way out",
  !isPainted(signedOut.elements["member-telegram-id-line"]) &&
  signedOut.elements["member-telegram-id"].textContent === "");

/* #56. The prefill belongs to one account, and /me is what says which. The
 * ids here are opaque on purpose - that is the property being relied on. */
const ACCOUNT = "a9246ad96523241df2d10c4f7c2b5e8f";
const OTHER_ACCOUNT = "1f0b7c3e5d8a49216b4e7f0c2a5d8e13";
const mine = (extra) => response(200, Object.assign(
  { ok: true, accountId: ACCOUNT, entries: 1, lastAt: null }, extra || {}));

const storedPrefill = JSON.stringify({
  accountId: ACCOUNT,
  units: "imperial",
  weightLb: "222.5",
  heightFeet: "6",
  heightInches: "1.5",
});
const prefilled = await loadSubmit({
  prefill: storedPrefill,
  replies: [mine()],
});
check("device-local prefill restores weight and height on load",
  prefilled.elements["weight-lb"].value === "222.5" &&
  prefilled.elements["height-ft"].value === "6" &&
  prefilled.elements["height-in"].value === "1.5");

const savingPrefill = await loadSubmit({ replies: [mine()] });
savingPrefill.elements["weight-lb"].value = "240";
savingPrefill.elements["height-ft"].value = "5";
savingPrefill.elements["height-in"].value = "11";
await savingPrefill.elements["weight-lb"].dispatch("input");
let savedPrefill = null;
try { savedPrefill = JSON.parse(localValues.get(PREFILL_KEY)); }
catch { /* a missing or malformed stored value is a failed check below */ }
check("editing body measurements writes the device-local prefill",
  savedPrefill && savedPrefill.weightLb === "240" &&
  savedPrefill.heightFeet === "5" && savedPrefill.heightInches === "11");
check("and stamps it with the account it belongs to",
  savedPrefill && savedPrefill.accountId === ACCOUNT);

/*
 * The leak #56 was filed for. Member A closes the tab rather than signing
 * out - the session dies with sessionStorage, the prefill does not - and
 * member B signs in on the same browser.
 *
 * Asserted in both directions, because "the fields are empty" would also be
 * true of a prefill feature that simply stopped working. The pair is what
 * distinguishes scoped from broken.
 */
const otherMember = await loadSubmit({
  prefill: storedPrefill,
  replies: [mine({ accountId: OTHER_ACCOUNT })],
});
check("another account's prefill is not shown to the member who signs in",
  otherMember.elements["weight-lb"].value === "" &&
  otherMember.elements["height-ft"].value === "" &&
  otherMember.elements["height-in"].value === "");
check("and it is erased rather than left readable on the device",
  !localValues.has(PREFILL_KEY));

/*
 * A prefill written before #56 has no accountId. It is the already-leaked
 * data on every device that ran step 5, so it must be discarded on the
 * first load rather than merely stopped from growing - keying by name
 * instead would have left it stranded and readable forever.
 */
const legacyPrefill = await loadSubmit({
  prefill: JSON.stringify({
    units: "imperial", weightLb: "199", heightFeet: "5", heightInches: "9",
  }),
  replies: [mine()],
});
check("an unscoped prefill from before this change is discarded, not read",
  legacyPrefill.elements["weight-lb"].value === "" &&
  !localValues.has(PREFILL_KEY));

/*
 * No account id - what a break-glass EXPORT_TOKEN caller gets from /me -
 * is not a licence to fall back to whatever is stored. Nor may a keystroke
 * write an unattributed prefill for the next person to inherit.
 */
const noAccount = await loadSubmit({
  prefill: storedPrefill,
  replies: [response(200, { ok: true, accountId: null, entries: 0,
    lastAt: null })],
});
noAccount.elements["weight-lb"].value = "300";
await noAccount.elements["weight-lb"].dispatch("input");
check("with no account id nothing is restored and nothing is written",
  noAccount.elements["height-ft"].value === "" &&
  !localValues.has(PREFILL_KEY));

/*
 * And the case that would make all of the above vacuous: if /me fails, the
 * page has no account id, so it must not fall back to the stored value.
 */
const meFailed = await loadSubmit({
  prefill: storedPrefill,
  replies: [response(500, { error: "down" })],
});
check("a failed /me restores no prefill rather than guessing whose it is",
  meFailed.elements["weight-lb"].value === "");

const absentPrefill = await loadSubmit({
  replies: [mine()],
});
check("an absent prefill does not prevent normal panel startup",
  absentPrefill.bootErrors.length === 0 &&
  absentPrefill.requests.length === 1);
const malformedPrefill = await loadSubmit({
  prefill: "{not-json",
  replies: [mine()],
});
check("a malformed prefill is ignored without breaking the page",
  malformedPrefill.bootErrors.length === 0 &&
  malformedPrefill.requests.length === 1 &&
  malformedPrefill.elements["weight-lb"].value === "" &&
  malformedPrefill.elements["height-ft"].value === "");

/*
 * #65. Erasure is the principle, and an account mismatch is only one of the
 * ways a stored prefill gets rejected.
 *
 * "The fields are empty and the page did not break" is the criterion the
 * check above holds, and a prefill left sitting in localStorage satisfies
 * it. That is the same gap A3.4 was written to close for the account case -
 * gone, not merely ignored - so it is asserted here for the other three.
 *
 * The third value below is the one that shows why this is worth a check
 * rather than tidiness: it is a real member's real weight and height, under
 * the right account, rejected only because a later format narrows what
 * `units` may hold. It fails an earlier guard than the mismatch does, and
 * the shared browser it is sitting on is the entire scenario #56 exists
 * for.
 */
const unusablePrefills = [
  ["it does not parse", "{not-json"],
  ["it is not an object", JSON.stringify("222.5|6|1.5")],
  ["its units are unreadable", JSON.stringify({
    accountId: ACCOUNT,
    units: "stone",
    weightLb: "222.5",
    heightFeet: "6",
    heightInches: "1.5",
  })],
];
for (const [why, stored] of unusablePrefills) {
  const rejected = await loadSubmit({ prefill: stored, replies: [mine()] });
  check(`a prefill rejected because ${why} is erased, not left readable`,
    !localValues.has(PREFILL_KEY) &&
    rejected.elements["weight-lb"].value === "" &&
    rejected.bootErrors.length === 0);
}

/*
 * #90. Signing out ends the session at the endpoint as well as in this
 * tab: without the request below the row survives to its natural expiry,
 * so a token captured beforehand stays a working credential for up to
 * seven days - which is the window the button is pressed to close.
 *
 * The local clear is the sign-out and the request is hardening on top of
 * it, and every check here asserts both halves. Asserting only the
 * request would pass on a page that revokes and then strands the member;
 * asserting only the clear is what the code did before the route existed.
 */
const signingOut = await loadSubmit({
  prefill: storedPrefill,
  replies: [mine(), response(200, { ok: true })],
});
await signingOut.elements["sign-out"].dispatch("click");
check("sign out clears body-measurement prefill, session, and returns home",
  !localValues.has(PREFILL_KEY) && Session.read() === null &&
  redirects.at(-1) === "index.html");

/* The header is the ordering check as well as the routing one: the token
 * only exists to be read before Session.clear() runs, so a revoke sent
 * after the local clear arrives with no credential and ends nothing. */
const revoke = signingOut.requests[1] || { url: null, options: {} };
check("sign out asks the endpoint to end the session it is leaving",
  signingOut.requests.length === 2 &&
  revoke.url === "https://worker.example/session" &&
  revoke.options.method === "DELETE" &&
  authorization(revoke) === "Bearer member-session-token");

/*
 * Source-level, and said plainly: this harness never navigates, so it
 * pins that the flag is sent rather than that a browser honors it. It is
 * worth pinning anyway. The redirect happens in the same turn as the
 * request, and a browser cancels in-flight fetches when the page goes -
 * so without `keepalive` the revoke is a request that reliably never
 * arrives, and the whole wiring passes its other checks while doing
 * nothing at all.
 */
check("and sends it in a form that survives the redirect that follows",
  revoke.options.keepalive === true);

/*
 * Pressing Sign out twice, which a redirect that has not repainted yet
 * makes easy. There is no token on the second press, and a DELETE with
 * no credential is one the endpoint refuses by design - nothing to end,
 * and nothing to authenticate ending it with.
 */
await signingOut.elements["sign-out"].dispatch("click");
check("pressing sign out again sends no unauthenticated revoke",
  signingOut.requests.length === 2);

/*
 * The property that makes this best-effort rather than a step: a member
 * on a dead connection still signs out. The race turns a hang into a
 * failed check - `dispatch` resolves through microtasks when signOut
 * returns without awaiting, and setImmediate runs only after those
 * drain, so the true branch wins whenever the request is not awaited and
 * loses whenever it is.
 */
const stalled = await loadSubmit({
  prefill: storedPrefill,
  replies: [mine(), function () { return new Promise(function () {}); }],
});
const leftPromptly = await Promise.race([
  stalled.elements["sign-out"].dispatch("click").then(function () {
    return true;
  }),
  new Promise(function (resolve) {
    setImmediate(function () { resolve(false); });
  }),
]);
check("a revoke that never answers does not hold the member in the session",
  leftPromptly === true && stalled.requests.length === 2 &&
  !localValues.has(PREFILL_KEY) && Session.read() === null &&
  redirects.at(-1) === "index.html");

/* And the failure a dead connection actually produces. Nothing is shown
 * for it either: the user-visible act is the local clear, which
 * succeeded, and an error about the half that is hardening would report
 * a sign-out that did not happen. */
const failedRevoke = await loadSubmit({
  prefill: storedPrefill,
  replies: [mine(), function () {
    return Promise.reject(new Error("the connection failed"));
  }],
});
const unhandledBefore = unhandled.length;
await failedRevoke.elements["sign-out"].dispatch("click");
await new Promise(function (resolve) { setImmediate(resolve); });
const revokeStatus = failedRevoke.elements["member-panel-status"];
check("a revoke the network refuses still signs the member out here",
  failedRevoke.requests.length === 2 &&
  !localValues.has(PREFILL_KEY) && Session.read() === null &&
  redirects.at(-1) === "index.html");
check("and says nothing about it, having signed the member out anyway",
  revokeStatus.textContent === "" && revokeStatus.hidden === true &&
  unhandled.length === unhandledBefore);

/*
 * The property this whole step is measured on, exercised rather than read.
 *
 * The two checks above that cover it - here and in dev/form.test.mjs - are
 * source-position assertions: the dispatch appears after `if (!response.ok)`,
 * and there is exactly one of it. Both are worth keeping and neither proves
 * the dispatch is UNREACHABLE on a failure. Convert a `catch { … return; }`
 * into a non-returning branch, or lift the send into a helper, and every
 * index assertion still passes while a refused submit refreshes the panel and
 * shows a count that disagrees with the table.
 *
 * That is the shape #34 paid for: a mutation written against the rule that
 * never reaches the path the rule is about. So the real form.js is driven
 * here, through a failing send, and the dispatches are counted.
 *
 * Added by Claude rather than Codex - the seam is in the commit above this
 * one, and in the handoff comment on #6.
 */
function makeInput(value, extra) {
  const input = {
    value: value,
    checked: false,
    attributes: {},
    setAttribute(name, v) { this.attributes[name] = v; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener() {},
    scrollIntoView() {},
    hidden: false,
    textContent: "",
  };
  return Object.assign(input, extra || {});
}

/* form.js reaches the network only for input `validate` accepts, so this is
 * a form filled in correctly - imperial, over 18, one role. A stub that
 * failed validation would never get near the dispatch and the check would
 * pass for the wrong reason. */
async function loadFormSubmit({ failWith }) {
  const ids = [
    "submission", "submit", "status", "closed", "done", "over18", "gender",
    "country", "weight-lb", "weight-kg", "height-ft", "height-in",
    "height-cm", "imperial-fields", "metric-fields", "key-fingerprint",
    "error-telegram", "error-weight", "error-height", "error-gender",
    "error-roles", "error-country", "error-over18",
  ];
  const elements = {};
  for (const id of ids) elements[id] = makeInput("");
  elements["weight-lb"].value = "200";
  elements["height-ft"].value = "5";
  elements["height-in"].value = "10";
  elements.gender.value = "male";
  elements.country.value = "US";
  elements.over18.checked = true;

  const units = [
    makeInput("imperial", { checked: true, name: "units" }),
    makeInput("metric", { checked: false, name: "units" }),
  ];
  const roles = [makeInput("gainer", { checked: true, name: "roles" })];

  let submitListener = null;
  elements.submission.addEventListener = function (type, listener) {
    if (type === "submit") submitListener = listener;
  };

  const dispatched = [];
  globalThis.document = {
    readyState: "complete",
    getElementById(id) { return elements[id] || null; },
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === 'input[name="units"]') return units;
      if (selector === 'input[name="roles"]:checked') return roles;
      return [];
    },
    addEventListener() {},
    dispatchEvent(event) { dispatched.push(event && event.type); return true; },
  };
  globalThis.CustomEvent = class {
    constructor(type) { this.type = type; }
  };
  globalThis.BINDER_CONFIG = {
    endpoint: "https://worker.example",
    publicKey: "a-public-key",
  };
  globalThis.BinderUI = {
    byId(id) { return elements[id] || null; },
    show(element, visible) { if (element) element.hidden = !visible; },
    setStatus() {},
    showFingerprint() {},
    checkedValue(name, fallback) {
      if (name !== "units") return fallback;
      const chosen = units.find((input) => input.checked);
      return chosen ? chosen.value : fallback;
    },
    boot(setUp) { setUp(); },
  };
  globalThis.BinderCrypto = {
    unavailableReason() { return null; },
    async encrypt() { return "QUFBQQ=="; },
  };
  Session.clear();
  Session.write(MEMBER);

  const sent = [];
  globalThis.fetch = async function (url) {
    sent.push(url);
    if (failWith === "reject") throw new Error("the connection failed");
    return response(failWith, { error: "refused" });
  };

  scenario++;
  await import("data:text/javascript," + encodeURIComponent(formSource) +
    "#form-failure-" + scenario);
  if (submitListener) {
    await submitListener({ preventDefault() {} });
  }
  await new Promise((resolve) => setImmediate(resolve));
  return { dispatched, sent, listener: Boolean(submitListener) };
}

/*
 * 403 rather than 500, and the difference is not cosmetic. Every refusal
 * handleSubmit actually produces is a 4xx - 400 for a malformed or non-base64
 * body, 413 for an oversize one, 401 with no member session. A 5xx is the
 * case the Worker does not deliberately return.
 *
 * Found by mutation while writing this: `if (!response.ok)` narrowed to
 * `if (response.status >= 500)` is caught by neither source-position check
 * AND was not caught by this one either while it sent a 500 - the mutation
 * still treats a 500 as failure. Testing the status the code is least likely
 * to receive is its own version of the null result this section is about.
 */
const refused = await loadFormSubmit({ failWith: 403 });
check("a submit the Worker refuses dispatches no stored event",
  refused.listener && refused.sent.length === 1 &&
  !refused.dispatched.includes(SUBMITTED_EVENT));

const serverError = await loadFormSubmit({ failWith: 500 });
check("a server error dispatches no stored event either",
  serverError.listener && !serverError.dispatched.includes(SUBMITTED_EVENT));

const unreachable = await loadFormSubmit({ failWith: "reject" });
check("a send that never completes dispatches no stored event",
  unreachable.listener && unreachable.sent.length === 1 &&
  !unreachable.dispatched.includes(SUBMITTED_EVENT));

/* And the control, without which the two above pass on a form that never
 * reached the network at all - a null result wearing a positive one's
 * clothes. */
const accepted = await loadFormSubmit({ failWith: 200 });
check("the same harness on a successful send does dispatch it",
  accepted.dispatched.filter((type) => type === SUBMITTED_EVENT).length === 1);

if (failures) {
  console.error(`\nsubmit panel FAILED ${failures} check(s)`);
  process.exit(1);
}
console.log("\nsubmit panel OK - 38 checks");
