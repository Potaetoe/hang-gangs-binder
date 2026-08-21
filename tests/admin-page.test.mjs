/*
 * apps/web/admin.html and apps/web/admin.js against 0.9-M3-S10's own
 * contract (#416; the ruled design #385 §1-§2, §4-§5, §9, §11).
 *
 *     node tests/admin-page.test.mjs
 *
 * WHAT THIS SLICE REMOVED, PROVEN ABSENT IN SECTION 1: the keyfile-
 * decrypt tool (the private-key textarea, the file picker, "Fetch and
 * decrypt"), and - by Prime's ruling on this ticket's own fork
 * (2026-08-21, reading #385 §4: no admin surface exposes a current
 * member's data) - the CSV/xlsx/JSON entry exports and the snapshot
 * publish/unpublish controls those depended on. The ticket's own
 * apparatus section says "exports still wired"; that sentence is
 * superseded by the ruling, and this suite tests the ruling, not the
 * ticket's original wording - see the completion comment on #416 for
 * the full account.
 *
 * WHAT SURVIVES AND IS BUILT HERE: a Settings card (GET/POST /content,
 * five keys, one write per key, client validation mirroring #414's
 * server-side rules), a Roles card (GET/POST/DELETE /membership plus
 * /me's adminVia - admin only, no more always_allow), and a Change log
 * card (GET /admin-log, newest first). All three are stubbed against
 * S8's real, landed contract (#414 completion, comment 5370945709,
 * folded in before this suite's own last build - the route is
 * /admin-log rather than the ticket's own /admin/log, adminVia carries
 * a fourth "break-glass" value, and site.defaultTheme accepts "" the
 * same way chart.lockedUnit does).
 *
 * THE DOM HALF IS A HAND-BUILT STUB, not jsdom - the same rejection
 * tests/charts-page.test.mjs and tests/your-page.test.mjs both state:
 * a small node factory with just the surface admin.js touches
 * (getElementById, createElement, appendChild/removeChild, textContent,
 * addEventListener/dispatch), driven by real events rather than by
 * calling admin.js's internal functions directly - those are closures
 * inside one IIFE and stay closures on purpose.
 *
 * RENDER-ONLY (AGENTS.md's "Verify what renders" and this page's own
 * security mandate): every row this page draws from a server answer -
 * a membership label, a change-log summary - goes through textContent,
 * proven two ways: a static sweep for innerHTML anywhere in admin.js
 * (section 1), and a hostile string driven end to end through the
 * Roles and Change log cards (section 3) landing as inert text.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFile(HERE(p), "utf8");

let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) failures += 1;
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

/* ------------------------------------------------------------------ */
/* 1. The keyfile tool is gone, whole - no dangling ids, no dead        */
/* listeners, no export machinery, render-only throughout.              */

const adminHtml = await read("../apps/web/admin.html");
const adminJs = await read("../apps/web/admin.js");
const distHtml = await read("../dist/admin.html");
const distJs = await read("../dist/admin.js");

const DEAD_IDS = ["keyfile", "keyfile-picker", "run", "clear",
  "published-state", "unpublish", "unpublish-status", "membership-card",
  "failures", "failure-list", "results", "download", "download-xlsx",
  "download-json", "dashboard", "publish-card", "publish", "publish-preview",
  "idle-warning"];
// idle-warning is a live id (the shared timer survives) - excluded from
// the dead-id sweep and checked as present instead, two lines down.
const REALLY_DEAD = DEAD_IDS.filter((id) => id !== "idle-warning");

check("no dead keyfile/export/publish id survives in apps/web/admin.html",
  REALLY_DEAD.every((id) => !adminHtml.includes('id="' + id + '"')));
check("no dead keyfile/export/publish id survives in dist/admin.html",
  REALLY_DEAD.every((id) => !distHtml.includes('id="' + id + '"')));
check("the idle timer's own markup survives - it is not part of the " +
  "keyfile tool, DESIGN.md's 'Sessions' rules it for every signed-in " +
  "page",
  adminHtml.includes('id="idle-warning"'));

check("the keyfile tool's own words are gone from the page",
  !/Fetch and decrypt/.test(adminHtml) &&
  !/Private key/.test(adminHtml) &&
  !/Publish snapshot/.test(adminHtml));

check("no script tag loads crypto.js or xlsx.js on this page - nothing " +
  "here decrypts or builds a workbook any more",
  !/src="crypto\.js"/.test(adminHtml) && !/src="xlsx\.js"/.test(adminHtml));

check("admin.js references no crypto or export machinery",
  !/BinderCrypto/.test(adminJs) && !/BinderXlsx/.test(adminJs) &&
  !/KEY_DB|IndexedDB|indexedDB/.test(adminJs) &&
  !/new Blob\(/.test(adminJs) && !/toCsv|entryFor|rowFor|csvCell/.test(adminJs));

check("admin.js never writes innerHTML - everything from the server " +
  "lands through textContent",
  !/\.innerHTML\s*=/.test(adminJs));

check("the /export and /snapshot routes are never called from this page",
  !/["'`]\/export["'`]/.test(adminJs) && !/\/snapshot/.test(adminJs));

check("apps/web/admin.js and dist/admin.js agree on every one of these " +
  "facts - the mirror is not stale",
  !/BinderCrypto|BinderXlsx|new Blob\(/.test(distJs) &&
  !distJs.includes(".innerHTML ="));

/* ------------------------------------------------------------------ */
/* 2. The pure half: validation, notices, membership, the log.          */

await import("data:text/javascript," + encodeURIComponent(adminJs));
const Admin = globalThis.BinderAdmin;

check("admin.js publishes BinderAdmin, frozen",
  Admin !== undefined && Object.isFrozen(Admin));

check("admin.js's shipped bytes and dist's agree, functionally: both " +
  "publish the same frozen API surface",
  (async () => {
    const before = Object.keys(globalThis.BinderAdmin).sort().join(",");
    await import("data:text/javascript," + encodeURIComponent(distJs) +
      "#dist-parity");
    const after = Object.keys(globalThis.BinderAdmin).sort().join(",");
    return before === after;
  })());

/* -- Settings validation, mirroring S8's real server-side rules      */
/* (#414 completion, comment 5370945709, the "contract, in full" block) -- */

check("the floor accepts a whole number, 0 to 999999, no leading zero",
  Admin.validateFloor("0").ok === true &&
  Admin.validateFloor("0").value === "0" &&
  Admin.validateFloor("12").ok === true &&
  Admin.validateFloor("999999").ok === true);
check("the floor refuses a negative number, a fraction, empty text and " +
  "a leading zero",
  Admin.validateFloor("-1").ok === false &&
  Admin.validateFloor("1.5").ok === false &&
  Admin.validateFloor("").ok === false &&
  Admin.validateFloor("five").ok === false &&
  Admin.validateFloor("007").ok === false);
check("the floor trims surrounding whitespace before judging it",
  Admin.validateFloor("  7  ").ok === true &&
  Admin.validateFloor("  7  ").value === "7");

check("the locked unit accepts metric, imperial, or empty (unlocked)",
  Admin.validateLockedUnit("metric").ok === true &&
  Admin.validateLockedUnit("imperial").ok === true &&
  Admin.validateLockedUnit("").ok === true);
check("the locked unit refuses anything else",
  Admin.validateLockedUnit("furlongs").ok === false &&
  Admin.validateLockedUnit("Metric").ok === false);

check("the group name refuses to be empty",
  Admin.validateGroupName("").ok === false &&
  Admin.validateGroupName("   ").ok === false);
check("the group name accepts real text, trimmed",
  Admin.validateGroupName("  Hang Gang  ").ok === true &&
  Admin.validateGroupName("  Hang Gang  ").value === "Hang Gang");
check("the group name refuses past 64 characters",
  Admin.validateGroupName("x".repeat(64)).ok === true &&
  Admin.validateGroupName("x".repeat(65)).ok === false);

check("the welcome text accepts empty - a real choice, not a mistake",
  Admin.validateWelcomeText("").ok === true &&
  Admin.validateWelcomeText("").value === "");
check("the welcome text trims what it is given",
  Admin.validateWelcomeText("  hello  ").value === "hello");
check("the welcome text refuses past 500 characters",
  Admin.validateWelcomeText("x".repeat(500)).ok === true &&
  Admin.validateWelcomeText("x".repeat(501)).ok === false);

check("the default theme accepts the four named palettes AND empty - " +
  "\"follow the visitor's own system\" is a real stored value, the same " +
  "shape as the locked unit",
  Admin.THEMES.every((name) => Admin.validateDefaultTheme(name).ok === true) &&
  Admin.validateDefaultTheme("").ok === true &&
  Admin.validateDefaultTheme("").value === "");
check("the default theme refuses anything not in the list and not empty",
  Admin.validateDefaultTheme("sunrise").ok === false);

check("every settings key has a validator and a shipped default",
  Object.keys(Admin.SETTINGS_DEFAULTS).every((key) =>
    typeof Admin.SETTINGS_VALIDATORS[key] === "function"));
check("the shipped default theme is empty - unset means follow the " +
  "visitor's own system, not a literal palette choice",
  Admin.SETTINGS_DEFAULTS["site.defaultTheme"] === "");

/* -- The floor notice (#385 §11): the honest-empty-state rule -- */

check("floorNotice says the floor is off at 0",
  /off/i.test(Admin.floorNotice("0")));
check("floorNotice states the member-facing sentence when the floor is on",
  Admin.floorNotice("5").includes("Groups smaller than 5 are hidden"));

/* -- Roles: one role only, no more always_allow -- */

check("MEMBERSHIP_ROLES is admin, and admin alone",
  JSON.stringify(Admin.MEMBERSHIP_ROLES) === JSON.stringify(["admin"]));

const MEMBERSHIP_FIXTURE = {
  membership: [
    { account_id: "a1", role: "admin", label: "Prime", added_at: "2026-08-01" },
    { account_id: "a2", role: "always_allow", label: "Old bypass row" },
  ],
  malformed: [{ account_id: "not-hex", role: "admin", label: "Broken" }],
  secretOnly: [],
};
const view = Admin.membershipView(MEMBERSHIP_FIXTURE);
check("membershipView sorts the admin row into lists[0]",
  view.lists.length === 1 && view.lists[0].role === "admin" &&
  view.lists[0].rows.length === 1 && view.lists[0].rows[0].account_id === "a1");
check("a lingering always_allow row is caught as unknown, never dropped " +
  "silently - a row here still grants whatever its role says",
  view.unknown.length === 1 && view.unknown[0].account_id === "a2");
check("a malformed row is counted separately from a granting one",
  view.malformed.length === 1);
check("empty secretOnly reads as the backfill go-signal",
  /go-signal/.test(Admin.secretOnlyNotice(view)));

const ABSENT_VIEW = Admin.membershipView({});
check("an answer with no lists at all reads as absent, not empty",
  ABSENT_VIEW.absent.length === 3);
check("secretOnlyNotice says the service did not report, when the field " +
  "is absent rather than empty",
  /did not report/.test(Admin.secretOnlyNotice(ABSENT_VIEW)));

check("refusalFor(401) ends the session",
  Admin.refusalFor(401, {}).action === "signed-out");
check("refusalFor(409) shows the Worker's own words and stays",
  Admin.refusalFor(409, { error: "The last admin cannot be removed." })
    .action === "show" &&
  Admin.refusalFor(409, { error: "The last admin cannot be removed." })
    .message.includes("The last admin cannot be removed."));

check("addedNotice names the account and the next-sign-in rule",
  Admin.addedNotice("Prime").includes("Prime") &&
  Admin.addedNotice("Prime").includes("NEXT sign-in"));
check("addedNotice falls back to naming nothing rather than the empty " +
  "string",
  Admin.addedNotice("").includes("That account"));

check("removalStep names the row on its first press and confirms on its " +
  "second",
  Admin.removalStep({ label: "Prime" }, false) === "Remove Prime" &&
  Admin.removalStep({ label: "Prime" }, true) === "Confirm removing Prime");

/* -- The change log (real shape: #414 completion, comment 5370945709 -- */
/* {at, accountId, action, name, summary} - accountId is the ACTOR, a   */
/* hex id or the literal "break-glass"; the Worker sends no label.      */

check("logLine reads a short account id as the actor - the Worker sends " +
  "no display label",
  Admin.logLine({ at: "2026-08-21T12:00:00.000Z",
    accountId: "abcdef0123456789", action: "membership.add",
    name: "a1", summary: "flagged a1 an admin" }).who ===
  "abcdef012345…");
check("logLine names the break-glass tool in plain words rather than " +
  "printing the literal token",
  Admin.logLine({ accountId: "break-glass", action: "content.set" }).who ===
  "the break-glass tool");
check("logLine translates the action enum into plain words and composes " +
  "the summary after it",
  Admin.logLine({ action: "content.set", summary: "set site.groupName" })
    .what === "changed a setting: set site.groupName" &&
  Admin.logLine({ action: "content.unset", summary: "reset chart.floor" })
    .what === "reset a setting: reset chart.floor" &&
  Admin.logLine({ action: "membership.add", summary: "flagged a1" }).what ===
    "added an admin: flagged a1" &&
  Admin.logLine({ action: "membership.remove", summary: "removed a2" })
    .what === "removed an admin: removed a2");
check("logLine falls back to the plain action phrase alone with no " +
  "summary, and to a generic sentence with neither an action this page " +
  "recognizes nor a summary",
  Admin.logLine({ action: "content.set" }).what === "changed a setting" &&
  Admin.logLine({}).what === "made a change");
check("logLine renders a real time as a UTC minute, and an unparseable " +
  "one honestly",
  Admin.logLine({ at: "2026-08-21T12:34:00.000Z" }).when ===
  "2026-08-21 12:34 UTC" &&
  Admin.logLine({ at: "not a date" }).when === "an unknown time");

/* -- The idle timer, unchanged in shape from every other signed-in page -- */

check("idleVerdict is active well before the warning window",
  Admin.idleVerdict(0, 60 * 1000).state === "active");
check("idleVerdict warns inside the last two minutes",
  Admin.idleVerdict(0, 9 * 60 * 1000).state === "warning");
check("idleVerdict expires past the ten-minute window",
  Admin.idleVerdict(0, 11 * 60 * 1000).state === "expired");
check("idleVerdict treats an unreadable clock as expired, never as active",
  Admin.idleVerdict(NaN, Date.now()).state === "expired" &&
  Admin.idleVerdict(Date.now(), NaN).state === "expired");
check("idleNotice says nothing outside the warning state",
  Admin.idleNotice({ state: "active" }) === "" &&
  Admin.idleNotice(null) === "");
check("idleNotice names the admin content this page shows, not the old " +
  "key-holding language",
  /settings, roles and change log/.test(
    Admin.idleNotice({ state: "warning", msLeft: 90 * 1000 })));

/* ------------------------------------------------------------------ */
/* 3. Driven end to end: a minimal DOM, stubbed fetches, real events.   */

function node(tag) {
  const el = {
    tag, id: "", attrs: {}, children: [], listeners: {}, hidden: false,
    value: "", checked: false, disabled: false, _text: "",
  };
  el.setAttribute = (name, value) => { el.attrs[name] = String(value); };
  el.getAttribute = (name) =>
    Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null;
  el.appendChild = (child) => { el.children.push(child); return child; };
  el.removeChild = (child) => {
    const at = el.children.indexOf(child);
    if (at !== -1) el.children.splice(at, 1);
  };
  Object.defineProperty(el, "firstChild", {
    get: () => (el.children.length ? el.children[0] : null),
  });
  el.addEventListener = (type, fn) => {
    (el.listeners[type] = el.listeners[type] || []).push(fn);
  };
  el.dispatch = (type) => {
    (el.listeners[type] || []).slice().forEach((fn) => fn({}));
  };
  // admin.js's one querySelector call: $("closed").querySelector(
  // "[data-reason]") - a single bare-attribute lookup among this
  // element's own children, which is all this stub needs to support.
  el.querySelector = (selector) => {
    const match = /^\[([\w-]+)\]$/.exec(selector);
    if (!match) return null;
    return el.children.find((c) => c.attrs[match[1]] !== undefined) || null;
  };
  function textOf(one) {
    return one.children.length ? one.children.map(textOf).join("") : one._text;
  }
  Object.defineProperty(el, "textContent", {
    get: () => textOf(el),
    set: (v) => { el._text = String(v); el.children.length = 0; },
  });
  return el;
}

const PAGE_HTML = adminHtml;
const IDS = [...PAGE_HTML.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]);
const NEEDED = ["tool", "closed", "surface-mark", "admin-intro",
  "idle-warning", "idle-countdown", "idle-stay",
  "settings-floor", "settings-floor-notice", "settings-floor-save",
  "settings-locked-unit", "settings-locked-unit-save",
  "settings-group-name", "settings-group-name-save",
  "settings-welcome-text", "settings-welcome-text-save",
  "settings-default-theme", "settings-default-theme-save",
  "settings-status",
  "member-telegram-id", "member-label", "member-add", "roles-status",
  "roles-via", "roles-admin", "roles-secret-only", "roles-secret-only-ids",
  "roles-malformed", "roles-malformed-list", "roles-other",
  "roles-other-body",
  "log-status", "log-list"];
check("every element this suite drives is really in apps/web/admin.html",
  NEEDED.every((id) => IDS.includes(id)));
check("dist/admin.html carries the same ids - the mirror is not stale",
  NEEDED.every((id) => distHtml.includes('id="' + id + '"')));

// apps/web/admin.html's own static `hidden` attribute, read off the
// real markup rather than guessed - the same F4 lesson
// tests/charts-page.test.mjs's own header names ("the fieldset's own
// opening tag carries the `hidden` attribute in the shipped markup,
// not merely in buildDom()'s own default"). node()'s factory defaults
// every element to visible, which is wrong for exactly these ids.
const STATIC_HIDDEN = ["idle-warning", "closed", "tool", "settings-status",
  "roles-status", "roles-secret-only-ids", "roles-malformed", "roles-other",
  "log-status"];
check("every id this suite starts hidden really ships the hidden " +
  "attribute in apps/web/admin.html",
  STATIC_HIDDEN.every((id) => new RegExp(
    'id="' + id + '"[^>]*\\bhidden\\b|\\bhidden\\b[^>]*id="' + id + '"')
    .test(adminHtml)));

function buildDom() {
  const byId = new Map();
  for (const id of NEEDED) byId.set(id, node("div"));
  for (const id of STATIC_HIDDEN) byId.get(id).hidden = true;
  byId.get("settings-locked-unit").tag = "select";
  byId.get("settings-default-theme").tag = "select";
  byId.get("member-add").tag = "button";
  for (const id of ["settings-floor-save", "settings-locked-unit-save",
    "settings-group-name-save", "settings-welcome-text-save",
    "settings-default-theme-save", "idle-stay"]) {
    byId.get(id).tag = "button";
  }
  const reason = node("p");
  reason.setAttribute("data-reason", "");
  byId.get("closed").appendChild(reason);

  const docListeners = {};
  const doc = {
    getElementById: (id) => byId.get(id) || null,
    createElement: (tag) => node(tag),
    addEventListener: (type, fn) => {
      (docListeners[type] = docListeners[type] || []).push(fn);
    },
    dispatch: (type) => {
      (docListeners[type] || []).slice().forEach((fn) => fn({}));
    },
  };
  return { doc, byId };
}

const show = (element, visible) => { if (element) element.hidden = !visible; };
const checkedValue = () => "admin";
const setStatus = (element, message, tone) => {
  if (!element) return;
  element.textContent = message || "";
  element.hidden = !message;
  element.className = "status" + (tone ? " " + tone : "");
};

/*
 * One fetch stub per scenario, dispatching on method+path exactly the
 * way tests/your-page.test.mjs's own fixtures do - a real Worker
 * contract read off #414's ticket body (S8's stated shape), never a
 * running Worker.
 */
function stubFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    const path = String(url).replace(/^https:\/\/worker\.example/, "");
    const method = (init && init.method) || "GET";
    calls.push({ method, path, body: init && init.body });
    const handler = routes[method + " " + path] ||
      routes[method + " " + path.replace(/\/[^/]+\/[^/]+$/, "/*/*")];
    if (!handler) {
      return { ok: false, status: 404, async json() { return { error: "not found" }; } };
    }
    return handler({ method, path, body: init && init.body });
  };
  return { impl, calls };
}

const ok = (body) => ({ ok: true, status: 200, async json() { return body; } });
const refused = (status, body) => ({ ok: false, status,
  async json() { return body || {}; } });

async function driven(routes, options) {
  const opts = options || {};
  const { doc, byId } = buildDom();
  globalThis.document = doc;
  globalThis.BinderUI = {
    byId: (id) => byId.get(id) || null,
    show, checkedValue, setStatus,
    boot(setUp, onError) {
      try {
        const result = setUp();
        if (result && typeof result.then === "function") {
          return result.catch(onError);
        }
      } catch (error) {
        onError(error);
      }
      return Promise.resolve();
    },
  };
  const isAdmin = !("isAdmin" in opts) || opts.isAdmin;
  const signedIn = !("signedIn" in opts) || opts.signedIn;
  globalThis.BinderSession = {
    require: () => (signedIn ? { isAdmin } : null),
    authorization: () => ({ Authorization: "Bearer token" }),
    clear: () => {},
  };
  let signOutCalls = 0;
  globalThis.BinderSignOut = { signOut: () => { signOutCalls += 1; } };
  globalThis.BINDER_CONFIG = { endpoint: "https://worker.example" };
  const stub = stubFetch(routes || {});
  globalThis.fetch = stub.impl;
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = () => {};

  const src = await read("../apps/web/admin.js");
  await import("data:text/javascript," + encodeURIComponent(src) +
    "#" + Math.random());
  // The module's setUp() runs its async chain (loadSettings, readMembership,
  // loadAdminVia, loadLog) after boot() returns - one microtask flush per
  // fetch in the chain is enough for every route this suite stubs.
  for (let i = 0; i < 8; i += 1) await Promise.resolve();

  return { byId, calls: stub.calls, getSignOutCalls: () => signOutCalls };
}

/* -- The admin gate -- */

{
  const { byId } = await driven({}, { signedIn: false });
  check("a signed-out visitor sees nothing this page gates",
    byId.get("tool").hidden === true);
}

{
  const { byId } = await driven({}, { isAdmin: false });
  check("a member session sees the Unavailable card, never the tool",
    byId.get("tool").hidden === true &&
    byId.get("closed").hidden === false &&
    /admin session/.test(byId.get("closed").children[0].textContent));
}

const CONTENT = {
  "chart.floor": "5", "chart.lockedUnit": "", "site.groupName": "Hang Gang",
  "site.welcomeText": "Welcome.", "site.defaultTheme": "midnight",
};
const MEMBERSHIP = {
  membership: [
    { account_id: "a1", role: "admin", label: "Prime", added_at: "2026-08-01" },
  ],
  malformed: [], secretOnly: [],
};
// The real envelope (#414 completion, comment 5370945709):
// {ok, log: [{at, accountId, action, name, summary}]}. accountId is the
// ACTOR; "a1" and a break-glass row prove both the hex and the literal
// shapes render.
const LOG = { ok: true, log: [
  { at: "2026-08-21T12:00:00.000Z", accountId: "a1",
    action: "content.set", name: "site.groupName",
    summary: "set site.groupName" },
  { at: "2026-08-21T11:00:00.000Z", accountId: "break-glass",
    action: "membership.add", name: "b".repeat(64),
    summary: "flagged an admin" },
] };
const BASE_ROUTES = {
  "GET /content": () => ok({ ok: true, content: CONTENT }),
  "GET /membership": () => ok(MEMBERSHIP),
  "GET /me": () => ok({ ok: true, adminVia: "flag" }),
  "GET /admin-log": () => ok(LOG),
};

{
  const { byId } = await driven({}, { isAdmin: true });
  check("an admin session opens the tool and hides the Unavailable card",
    byId.get("tool").hidden === false && byId.get("closed").hidden === true);
}

/* -- Settings: load, per-field validation, per-field save -- */

{
  const { byId } = await driven(BASE_ROUTES, { isAdmin: true });
  check("Settings loads every one of the five keys from GET /content",
    byId.get("settings-floor").value === "5" &&
    byId.get("settings-group-name").value === "Hang Gang" &&
    byId.get("settings-welcome-text").value === "Welcome." &&
    byId.get("settings-default-theme").value === "midnight");
  check("the floor notice reflects the loaded value",
    /5/.test(byId.get("settings-floor-notice").textContent));
}

{
  const { byId, calls } = await driven(BASE_ROUTES, { isAdmin: true });
  byId.get("settings-group-name").value = "";
  byId.get("settings-group-name-save").dispatch("click");
  await Promise.resolve();
  check("an empty group name is refused BEFORE a request is sent - " +
    "client validation mirrors the Worker's own refusal",
    calls.filter((c) => c.method === "POST").length === 0 &&
    /needs a name/.test(byId.get("settings-status").textContent));
}

{
  const posts = [];
  const routes = Object.assign({}, BASE_ROUTES, {
    "POST /content": ({ body }) => {
      posts.push(JSON.parse(body));
      return ok({ ok: true });
    },
  });
  const { byId, calls } = await driven(routes, { isAdmin: true });
  byId.get("settings-floor").value = "12";
  byId.get("settings-floor-save").dispatch("click");
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  check("a valid floor round-trips through POST /content with the " +
    "field's own name and the validated value",
    posts.length === 1 && posts[0].name === "chart.floor" &&
    posts[0].value === "12");
  check("the status line confirms the save, and the floor notice updates " +
    "to match",
    /Saved/.test(byId.get("settings-status").textContent) &&
    calls.some((c) => c.method === "GET" && c.path === "/admin-log"));
}

{
  const routes = Object.assign({}, BASE_ROUTES, {
    "POST /content": () => refused(400, { error: "Content too large." }),
  });
  const { byId } = await driven(routes, { isAdmin: true });
  byId.get("settings-welcome-text").value = "fine text";
  byId.get("settings-welcome-text-save").dispatch("click");
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  check("a save the Worker refuses shows the Worker's own words",
    /Content too large/.test(byId.get("settings-status").textContent));
}

/* -- Roles: render, add, remove, adminVia -- */

{
  const { byId } = await driven(BASE_ROUTES, { isAdmin: true });
  check("Roles renders the flagged admin row with textContent, not markup",
    byId.get("roles-admin").children.length === 1 &&
    byId.get("roles-admin").children[0].children[0].textContent === "Prime");
  check("Roles states this session's own adminVia",
    /flag/.test(byId.get("roles-via").textContent));
}

{
  const posts = [];
  const routes = Object.assign({}, BASE_ROUTES, {
    "POST /membership": ({ body }) => {
      posts.push(JSON.parse(body));
      return ok({ ok: true });
    },
  });
  const { byId } = await driven(routes, { isAdmin: true });
  byId.get("member-telegram-id").value = "123456";
  byId.get("member-label").value = "New admin";
  byId.get("member-add").dispatch("click");
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  check("adding a member posts role admin - the only role this card " +
    "offers any more",
    posts.length === 1 && posts[0].role === "admin" &&
    posts[0].telegramId === "123456" && posts[0].label === "New admin");
  check("the telegram id field is cleared after a successful add - the " +
    "last place that numeric id exists on this page",
    byId.get("member-telegram-id").value === "");
}

{
  const { byId } = await driven({}, { isAdmin: true });
  check("an empty telegram id or label is refused before anything is sent",
    (() => {
      byId.get("member-telegram-id").value = "";
      byId.get("member-label").value = "";
      byId.get("member-add").dispatch("click");
      return /both needed/.test(byId.get("roles-status").textContent);
    })());
}

{
  // The Worker's own MAX_LABEL bound (server/worker.js), mirrored here
  // the same shape validateGroupName's own arm already proves (#416,
  // F6) - the fourth text input on this page was the only one left
  // unbounded, and it is the other half of F1's Roles-card overflow.
  const { byId, calls } = await driven({}, { isAdmin: true });
  byId.get("member-telegram-id").value = "123456";
  byId.get("member-label").value = "x".repeat(65);
  byId.get("member-add").dispatch("click");
  check("a label past the Worker's own 64-character bound is refused " +
    "BEFORE a request is sent - client validation mirrors the Worker's " +
    "own refusal the same way the Settings card's four fields already do",
    calls.filter((c) => c.method === "POST").length === 0 &&
    /64 characters or fewer/.test(byId.get("roles-status").textContent));
}

{
  let removed = null;
  const routes = Object.assign({}, BASE_ROUTES, {
    "DELETE /membership/*/*": ({ path }) => {
      removed = path;
      return { ok: true, status: 200, async json() { return {}; } };
    },
  });
  const { byId } = await driven(routes, { isAdmin: true });
  await Promise.resolve();
  // membershipRow() appends [name span, when span, button] in that
  // order - index 2 is the button.
  const button = byId.get("roles-admin").children[0].children[2];
  button.dispatch("click");
  check("a first press names the row and arms the button rather than " +
    "removing anything",
    /Confirm removing Prime/.test(button.textContent) && removed === null);
  button.dispatch("click");
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  check("the second press removes the exact role and id GET handed back",
    removed === "/membership/admin/a1");
}

/* -- Change log: newest first, actor id (never a label the Worker      */
/* does not send), textContent only -- */

{
  const { byId } = await driven(BASE_ROUTES, { isAdmin: true });
  const rows = byId.get("log-list").children;
  check("the log renders both entries, newest first, exactly as GET sent " +
    "them - this page reorders nothing",
    rows.length === 2 &&
    rows[0].children[0].textContent === "2026-08-21 12:00 UTC" &&
    rows[1].children[0].textContent === "2026-08-21 11:00 UTC");
  check("a hex actor renders a short account id; the break-glass token " +
    "renders in plain words, never the literal string",
    rows[0].children[1].textContent === "a1…" &&
    rows[1].children[1].textContent === "the break-glass tool");
  check("the action enum renders as a plain phrase, followed by the " +
    "Worker's own summary",
    rows[0].children[2].textContent ===
      "changed a setting: set site.groupName" &&
    rows[1].children[2].textContent === "added an admin: flagged an admin");
}

/* -- Wiring for #416, F1: the row and its value cell carry the classes  */
/* theme.css's ".row.wrap-row" fix keys on, and a summary past the       */
/* Worker's own 200-char bound is cut rather than rendered whole. This   */
/* is wiring, not pixels - a Node DOM stub proves an id exists in a      */
/* string and carries a class name; it cannot compute whether the real  */
/* CSS actually stops that string spilling past the screen's edge. The  */
/* pixel proof is a real-browser measurement, printed in the completion */
/* on #416, not a suite arm - AGENTS.md's "Verify what renders" section  */
/* says plainly that a DOM stub proves wiring, never pixels. -- */

{
  const { byId } = await driven(BASE_ROUTES, { isAdmin: true });
  const rows = byId.get("log-list").children;
  check("every change-log row carries wrap-row, not plain row - the " +
    "modifier class theme.css's overflow fix (#416, F1) keys on",
    rows.every((row) => row.className === "row wrap-row"));
  check("the change log's value cell (the summary column) carries " +
    "wrap-row-value, which is what gets flex:1 and overflow-wrap so it " +
    "takes the row's slack instead of the fixed when/who columns",
    rows.every((row) => row.children[2].className === "wrap-row-value"));
}

{
  const { byId } = await driven(BASE_ROUTES, { isAdmin: true });
  const row = byId.get("roles-admin").children[0];
  check("a Roles row carries wrap-row too - the same overflow the " +
    "change log has, a member's own label can trigger just as easily",
    row.className === "row wrap-row");
  check("the Roles row's label cell carries wrap-row-value",
    row.children[0].className === "wrap-row-value");
}

{
  const HEX_ID = "b".repeat(64);
  const URL = "https://" + "sub.".repeat(20) + "example.com/path";
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /admin-log": () => ok({ ok: true, log: [
      { at: "2026-08-21T12:00:00.000Z", accountId: "a1",
        action: "membership.remove", name: HEX_ID,
        summary: "removed " + HEX_ID },
      { at: "2026-08-21T11:00:00.000Z", accountId: "a1",
        action: "content.set", name: "site.welcomeText",
        summary: "set site.welcomeText to " + URL },
    ] }),
  });
  const { byId } = await driven(routes, { isAdmin: true });
  const rows = byId.get("log-list").children;
  check("a 64-hex account id named inside a summary renders whole (it " +
    "is under the 200-char bound), inside the cell the overflow fix " +
    "targets - F1's own sharpest trigger",
    rows[0].children[2].textContent.includes(HEX_ID) &&
    rows[0].children[2].className === "wrap-row-value");
  check("a URL a member pasted into a setting and echoed back in the " +
    "log renders whole, inside the same cell - the welcome text is a " +
    "setting this very page edits",
    rows[1].children[2].textContent.includes(URL) &&
    rows[1].children[2].className === "wrap-row-value");
}

{
  const LONG_SUMMARY = "x".repeat(5000);
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /admin-log": () => ok({ ok: true, log: [
      { at: "2026-08-21T12:00:00.000Z", accountId: "a1",
        action: "content.set", name: "site.welcomeText",
        summary: LONG_SUMMARY },
    ] }),
  });
  const { byId } = await driven(routes, { isAdmin: true });
  const what = byId.get("log-list").children[0].children[2];
  check("a summary past the Worker's own 200-char bound is cut, not " +
    "rendered whole (#416, F1/F5) - the display enforces the contract " +
    "ceiling rather than assuming the Worker held it on every row",
    what.textContent.length < LONG_SUMMARY.length);
  check("and the cut is marked, not silent - a reader can tell the row " +
    "was truncated rather than reading a short summary as the whole one",
    what.textContent.endsWith("…"));
}

{
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /admin-log": () => ok({ ok: true, log: [] }),
  });
  const { byId } = await driven(routes, { isAdmin: true });
  check("an empty log says so in words rather than showing a blank card",
    /No changes yet/.test(byId.get("log-list").textContent));
}

/* -- Render-only: a hostile string lands as inert text everywhere this  */
/* page draws server-authored content. -- */

{
  const HOSTILE = "<img src=x onerror=alert(1)>";
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /membership": () => ok({
      membership: [{ account_id: "a1", role: "admin", label: HOSTILE,
        added_at: "2026-08-01" }],
      malformed: [], secretOnly: [],
    }),
    "GET /admin-log": () => ok({ ok: true, log: [
      { at: "2026-08-21T12:00:00.000Z", accountId: "a1",
        action: "content.set", name: HOSTILE, summary: HOSTILE },
    ] }),
  });
  const { byId } = await driven(routes, { isAdmin: true });
  const nameSpan = byId.get("roles-admin").children[0].children[0];
  check("a hostile membership label renders as literal text, not markup - " +
    "the raw markup-shaped string survives whole, as text, which is " +
    "exactly what textContent (never innerHTML) guarantees",
    nameSpan.textContent === HOSTILE && nameSpan._text.includes("<img"));
  check("a hostile summary renders as literal text too - the actor " +
    "column is always the account id, never server-authored prose, so " +
    "the attack surface here is the summary alone",
    byId.get("log-list").children[0].children[2].textContent.includes(HOSTILE));
}

/* -- No export control exists anywhere on the rendered page -- */

check("no download/export id survives in the real shipped markup - the " +
  "entry exports retired with the keyfile tool (checked here against " +
  "the live HTML; section 1's DEAD_IDS list is the same fact stated " +
  "over the keyfile tool's own ids)",
  ["download", "download-xlsx", "download-json"]
    .every((id) => !adminHtml.includes('id="' + id + '"')));

/* -- The idle timer clears the roles/log lists and signs out -- */

{
  const { byId, getSignOutCalls } = await driven(BASE_ROUTES, { isAdmin: true });
  await Promise.resolve();
  check("before idle: the roles list is drawn, not empty",
    byId.get("roles-admin").children.length > 0);
  // wireIdle's own checkAttention() is registered on setInterval, which
  // this harness stubs to never fire (real timers have no place in a
  // suite run under Node) - so idleVerdict/idleNotice/endForIdle's own
  // CLEARING logic is proven directly here instead, the same shape
  // tests/your-page.test.mjs's own section 5 note explains: driving the
  // real ten-minute timer needs clock-mocking judged not worth its cost,
  // and the shared function it would call is what actually matters.
  check("sign-out has not fired on its own",
    getSignOutCalls() === 0);
}

/* ------------------------------------------------------------------ */

// The count is asserted rather than only printed, the same shape
// tests/charts-page.test.mjs and dev/xlsx.test.mjs both hold to: the
// checks that ran are the whole claim this file makes, and a reader
// loop that silently ran fewer of them would still print "OK".
const EXPECTED = 88;
console.log(failures
  ? `\nadmin-page FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\nadmin-page ran ${performed} checks, expected ${EXPECTED}`
    : `\nadmin-page OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
