/*
 * Contract checks for the admin session boundary and row deletion wiring.
 * The shipped page modules run unchanged under the same small browser stubs
 * as session.test.mjs; product code gets no test-only path.
 */
import { readFile } from "node:fs/promises";

const sessionSource = await readFile(
  new URL("../apps/web/session.js", import.meta.url), "utf8");
const adminSource = await readFile(
  new URL("../apps/web/admin.js", import.meta.url), "utf8");
/*
 * The real sign-out module, loaded rather than stubbed, because the
 * server-side half of the idle teardown IS this file's `DELETE /session`
 * (#90). A stub would let the page satisfy "it revoked" by calling
 * something the browser never loads, which is the one thing worth
 * proving here: the timer reaches the same revoke the button does.
 */
const signOutSource = await readFile(
  new URL("../apps/web/signout.js", import.meta.url), "utf8");
/*
 * Read for one number. `ADMIN_IDLE_MINUTES` is the Worker's sliding
 * window, and the page's own window has to stay INSIDE it - see the
 * check that compares them, which is the only thing this source is used
 * for. Parsed rather than restated, because a copy of that constant in
 * this file would be a second home for it and would go stale silently.
 */
const workerSource = await readFile(
  new URL("../server/worker.js", import.meta.url), "utf8");

let failures = 0;
let checks = 0;
function check(label, condition) {
  checks++;
  if (!condition) failures++;
  console.log(condition ? "pass " : "FAIL ", label);
}

/*
 * IndexedDB, small enough to drive and real enough to fail the way the
 * browser's does.
 *
 * Every operation answers on a later turn through `onsuccess` or
 * `onerror`, which is the part worth simulating: the page's read of the
 * stored key is a race against a keyholder pressing a button, and a
 * synchronous stub would make that race disappear from the suite while
 * leaving it in the product.
 *
 * `rows` is handed back to each scenario, because "Clear destroyed the
 * stored key" is a claim about the store rather than about the page,
 * and reading it off the status line would prove only that the page
 * says so.
 */
function makeIndexedDb(initial) {
  const rows = new Map(initial ? [["current", initial]] : []);
  let created = false;

  function request(compute) {
    const req = { result: undefined, error: null };
    queueMicrotask(() => {
      try {
        req.result = compute();
        if (req.onsuccess) req.onsuccess();
      } catch (error) {
        req.error = error;
        if (req.onerror) req.onerror();
      }
    });
    return req;
  }

  const store = {
    get(key) { return request(() => rows.get(key)); },
    put(value, key) { return request(() => { rows.set(key, value); }); },
    delete(key) { return request(() => { rows.delete(key); }); },
  };
  const db = {
    close() {},
    createObjectStore() { return store; },
    transaction() { return { objectStore() { return store; } }; },
  };

  return {
    rows,
    open() {
      const req = { result: undefined, error: null };
      queueMicrotask(() => {
        req.result = db;
        if (!created) {
          created = true;
          if (req.onupgradeneeded) req.onupgradeneeded();
        }
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
  };
}

/*
 * Node defines `navigator` as a getter, so the storage API this page
 * asks about has to be installed rather than assigned.
 */
let persistGrant = true;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    storage: {
      async persist() { return persistGrant; },
    },
  },
});

const values = new Map();
globalThis.sessionStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};

const redirects = [];
globalThis.location = {
  pathname: "/admin.html",
  replace(target) { redirects.push(target); },
};

/*
 * A clock and an interval the scenarios drive, installed on the global
 * rather than handed to the page.
 *
 * The page takes neither, and must not: `apps/web` carries no test hook
 * (AGENTS.md, "Boundaries"). What a suite is allowed to control is the
 * platform underneath the shipped bytes - `Date.now` and `setInterval`
 * are the browser's, so replacing them here is the same act as running
 * the file in a different browser.
 *
 * Driving the CLOCK rather than counting ticks is the part that matters.
 * A machine that sleeps for an hour does not deliver an hour of
 * intervals; it delivers one late one. A page that measured idleness by
 * how often it had been called would wake believing seconds had passed,
 * on the one page that holds every submission in the clear - so every
 * check below moves `Date.now` and then delivers a single tick, which is
 * exactly what a wake looks like.
 */
const realNow = Date.now;
let fakeNow = null;
Date.now = () => (fakeNow === null ? realNow.call(Date) : fakeNow);

let timers = [];
globalThis.setInterval = (fn, ms) => {
  timers.push({ fn, ms, stopped: false });
  return timers.length;
};
globalThis.clearInterval = (id) => {
  const timer = timers[id - 1];
  if (timer) timer.stopped = true;
};

/*
 * The one-shot timers, recorded rather than left to Node - the download
 * acknowledgement is the only user of these on this page.
 *
 * Two reasons, and the second is the one that matters. A real four-
 * second timer would hold the process open for four seconds after the
 * last check, on every gate run. And an acknowledgement that is
 * supposed to expire cannot be shown to expire unless something can
 * make it expire on demand; left real, the expiry would simply never
 * be exercised.
 */
let pending = [];
globalThis.setTimeout = (fn, ms) => {
  pending.push({ fn, ms, stopped: false });
  return pending.length;
};
globalThis.clearTimeout = (id) => {
  const timer = pending[id - 1];
  if (timer) timer.stopped = true;
};

globalThis.document = {
  readyState: "complete",
  querySelector() { return null; },
  // signout.js paints the rail the moment it loads. Nothing here has a
  // rail, so this answers the honest thing rather than throwing out of
  // the import.
  getElementById() { return null; },
  addEventListener() {},
};
await import("data:text/javascript," + encodeURIComponent(sessionSource));
const Session = globalThis.BinderSession;
await import("data:text/javascript," + encodeURIComponent(signOutSource));

/*
 * The `GET /export` reply, column for column - `handleExport` in
 * server/worker.js selects `id, account_id, ciphertext, received_at`.
 *
 * Rows 41 and 99 carry one account id between them and two different
 * handles, which is the shape this file is here to follow end to end:
 * the identity is a column beside the blob, the handle is inside it,
 * and only the column survives being sealed by somebody else's browser.
 */
const SUBMISSIONS = [
  {
    id: 73,
    account_id: "account-rotated",
    ciphertext: "ciphertext-from-rotated-key",
    received_at: "2026-08-04T11:59:05.000Z",
  },
  {
    id: 41,
    account_id: "account-one",
    ciphertext: "ciphertext-41",
    received_at: "2026-08-04T12:00:05.000Z",
  },
  {
    id: 99,
    account_id: "account-one",
    ciphertext: "ciphertext-99",
    received_at: "2026-08-04T12:01:05.000Z",
  },
];

const RECORDS = {
  "ciphertext-41": {
    record: 1,
    submittedAt: "2026-08-04T12:00:00.000Z",
    telegram: "first",
    weight: { kg: 90, lb: 198.4 },
    height: { cm: 180, totalInches: 70.9, feet: 5, inches: 10.9 },
    entered: { units: "metric", weight: "90 kg", height: "180 cm" },
    gender: "male",
    roles: ["gainer"],
    country: "US",
    over18: true,
  },
  "ciphertext-99": {
    record: 1,
    submittedAt: "2026-08-04T12:01:00.000Z",
    telegram: "second",
    weight: { kg: 80, lb: 176.4 },
    height: { cm: 170, totalInches: 66.9, feet: 5, inches: 6.9 },
    entered: { units: "metric", weight: "80 kg", height: "170 cm" },
    gender: "female",
    roles: ["feedee"],
    country: "CA",
    over18: true,
  },
};

function selectorMatches(element, selector) {
  if (selector === "button") return element.tagName === "BUTTON";
  const data = /^\[data-([a-z0-9-]+)(?:="([^"]*)")?\]$/.exec(selector);
  if (!data) return false;
  const name = data[1].replace(/-([a-z])/g, (_, letter) =>
    letter.toUpperCase());
  return Object.hasOwn(element.dataset, name) &&
    (data[2] === undefined || element.dataset[name] === data[2]);
}

function descendants(element) {
  return element.children.flatMap((child) =>
    [child].concat(descendants(child)));
}

function makeElement(tagName = "div", id = "") {
  const listeners = new Map();
  let text = "";
  /*
   * A real class list rather than a string, because the page adds and
   * removes one class among others and a stub that swallowed those
   * calls would let the download acknowledgement light every button at
   * once with every arm here green - which is what it did (#174, and
   * the #154 sweep's client partition F-5).
   */
  const classes = new Set();
  const element = {
    id,
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    tagName: tagName.toUpperCase(),
    hidden: false,
    disabled: false,
    checked: false,
    value: "",
    files: null,
    children: [],
    dataset: {},
    parentNode: null,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    replaceChildren(...children) {
      this.children = [];
      for (const child of children) this.appendChild(child);
    },
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter(
        (child) => child !== this);
      this.parentNode = null;
    },
    querySelector(selector) {
      return descendants(this).find((child) =>
        selectorMatches(child, selector)) || null;
    },
    closest(selector) {
      let current = this;
      while (current) {
        if (selectorMatches(current, selector)) return current;
        current = current.parentNode;
      }
      return null;
    },
    async dispatch(type) {
      const event = {
        type,
        target: this,
        currentTarget: this,
        preventDefault() {},
      };
      let current = this;
      while (current) {
        event.currentTarget = current;
        for (const listener of listenersFor(current, type)) {
          await listener.call(current, event);
        }
        current = current.parentNode;
      }
    },
    async click() { await this.dispatch("click"); },
  };
  Object.defineProperty(element, "textContent", {
    get() { return text; },
    set(value) {
      text = String(value);
      if (text === "") element.children = [];
    },
  });
  Object.defineProperty(element, "_listeners", { value: listeners });
  return element;
}

function listenersFor(element, type) {
  return element._listeners && element._listeners.get(type) || [];
}

function makePage() {
  const ids = [
    "tool", "closed", "token", "keyfile", "keyfile-picker", "run", "clear",
    "status", "results", "dashboard", "publish-card", "failures",
    "failure-list", "summary", "thead", "tbody", "charts", "download",
    "download-xlsx", "download-json", "download-status", "published-state",
    "unpublish",
    "unpublish-status", "publish-series", "publish", "publish-preview",
    "publish-preview-body", "publish-status",
    // The membership pane. `membership-admin` and `membership-always_allow`
    // carry the Worker's own role names, because the page looks its
    // containers up by role - see the note in admin.html.
    "membership-card", "member-telegram-id", "member-label", "member-add",
    "membership-status", "membership-admin", "membership-always_allow",
    "secret-only", "secret-only-ids",
    "membership-malformed", "membership-malformed-list",
    "membership-other", "membership-other-body",
    // The attention warning - #91. It ships hidden, like every other
    // card here that speaks only when it has something to say.
    "idle-warning", "idle-countdown", "idle-stay",
  ];
  const INPUTS = ["token", "keyfile-picker", "publish-series",
    "member-telegram-id", "member-label"];
  const elements = Object.fromEntries(ids.map((id) => [id, makeElement(
    INPUTS.includes(id) ? "input"
      : id === "keyfile" ? "textarea"
        : id === "member-add" || id === "idle-stay" ? "button" : "div",
    id,
  )]));
  for (const id of [
    "closed", "results", "dashboard", "publish-card", "failures",
    "unpublish", "publish-preview-body", "publish-status",
    "membership-status", "membership-malformed", "membership-other",
    "secret-only-ids", "idle-warning",
  ]) elements[id].hidden = true;
  // The one control on this page that has to be reachable without a
  // mouse the moment it appears, so the page moves focus to it and the
  // stub has to be able to say whether it did.
  let focused = null;
  elements["idle-stay"].focus = function () { focused = this; };
  elements.token.value = "DOM_INPUT_EXPORT_TOKEN";
  elements.keyfile.value = "DOM_INPUT_PRIVATE_KEY";

  const reason = makeElement("p");
  reason.dataset.reason = "";
  elements.closed.appendChild(reason);
  const identity = makeElement("strong");
  identity.dataset.devIdentity = "";
  const banner = makeElement("div");
  banner.dataset.devSession = "";
  banner.appendChild(identity);

  const radios = [makeElement("input"), makeElement("input")];
  /*
   * What the page asked the document to tell it about, kept as the raw
   * registrations rather than as a set of names.
   *
   * The options matter as much as the type. A listener registered
   * without `capture` can be hidden by anything that stops propagation
   * on the way down, and an attention timer that a stray handler can
   * blind is worse than none - it reports attention it never saw.
   */
  const documentListeners = [];
  return {
    elements,
    listeners: documentListeners,
    focusedNow: () => focused,
    document: {
      readyState: "complete",
      getElementById(id) { return elements[id] || null; },
      querySelector(selector) {
        if (selector === "[data-dev-session]") return banner;
        return null;
      },
      querySelectorAll(selector) {
        return selector ===
          'input[name="basis"], input[name="units"]' ? radios : [];
      },
      createElement(tagName) { return makeElement(tagName); },
      addEventListener(type, listener, options) {
        documentListeners.push({ type, listener, options });
      },
    },
  };
}

function response(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

/*
 * The public key `config.js` carries for this arm. A marker rather than
 * a point: the page compares it for exact equality against what a
 * stored record says it is, so what matters is that two of these are
 * distinguishable.
 */
const PUBLIC_KEY = "the-public-key-config-js-carries";

// What importPrivateKey hands back, and what a device holding a key
// already has. Two objects, because "the rows were opened with the
// stored key" is only checkable if the stored one is not the imported
// one.
const IMPORTED_KEY = { type: "private", extractable: false, from: "file" };
const DEVICE_KEY = { type: "private", extractable: false, from: "device" };

const storedRecord = (over) => Object.assign({
  publicKey: PUBLIC_KEY,
  privateKey: DEVICE_KEY,
  storedAt: "2026-08-08T09:00:00.000Z",
}, over || {});

// Where every scenario's clock starts. A fixed instant rather than the
// real one, so a check that moves time by ten minutes moves it from
// somewhere a failure message can name.
const START = Date.parse("2026-08-09T12:00:00.000Z");

let scenario = 0;
async function loadAdmin(session, options = {}) {
  const page = makePage();
  const requests = [];
  const snapshots = [];
  const imported = [];
  const keysUsed = [];
  timers = [];
  pending = [];
  fakeNow = START;
  Session.clear();
  if (session) Session.write(session);
  redirects.length = 0;
  location.pathname = "/admin.html";

  // `storage: null` is a browser that offers no IndexedDB at all. The
  // file path has to keep working there, which is the check that stops
  // this feature becoming a dependency rather than a convenience.
  const storage = options.storage === null
    ? null
    : makeIndexedDb(options.stored);
  if (storage) globalThis.indexedDB = storage;
  else delete globalThis.indexedDB;
  persistGrant = options.persist !== false;

  globalThis.document = page.document;
  globalThis.BINDER_CONFIG = {
    endpoint: "https://worker.example",
    publicKey: PUBLIC_KEY,
  };
  globalThis.BinderUI = {
    byId(id) { return page.elements[id] || null; },
    show(element, visible) { if (element) element.hidden = !visible; },
    setStatus(element, message) {
      element.textContent = message;
      element.hidden = false;
    },
    // The role radio is a real choice the pane reads, so a scenario has
    // to be able to make it. Anything the scenario did not stage keeps
    // the page's own fallback.
    checkedValue(name, fallback) {
      const staged = options.checked || {};
      return Object.hasOwn(staged, name) ? staged[name] : fallback;
    },
    boot(setUp, failed) {
      try { setUp(); } catch (error) { failed(error); }
    },
  };
  /*
   * The probe the page seals to config.js's public half and tries to
   * open with the key in hand - the only way to ask a non-extractable
   * CryptoKey which key it is. `opensSiteKey: false` is the key that
   * imports cleanly and belongs to a different keypair, which is the
   * one this page must use and must not keep.
   *
   * `opensRows: false` is the other half of that key's story - a foreign
   * key that opens NOTHING. It is separate from `opensSiteKey` because
   * the two facts are independent: the page examines the key first and
   * counts the rows afterwards, and the card it writes is chosen from
   * both. Without a scenario that can open zero rows, the branch that
   * must not claim an export is unreachable from this file.
   */
  const PROBE = "probe-sealed-to:";
  globalThis.BinderCrypto = {
    unavailableReason() { return null; },
    async importPrivateKey(text) {
      imported.push(text);
      return IMPORTED_KEY;
    },
    async encrypt(record, publicKey) { return PROBE + publicKey; },
    async decrypt(ciphertext, key) {
      if (String(ciphertext).startsWith(PROBE)) {
        if (options.opensSiteKey === false) {
          throw new Error("this row could not be opened with this key");
        }
        return { probe: true };
      }
      keysUsed.push(key);
      if (options.opensRows === false || !RECORDS[ciphertext]) {
        throw new Error("could not be opened with this key");
      }
      return RECORDS[ciphertext];
    },
  };
  globalThis.BinderXlsx = {
    build() { return new Uint8Array([1, 2, 3]); },
  };
  /*
   * Whether the document this stub builds reports the weight series as
   * withheld. Captured out here for the reason the `refuse` capture
   * below names: snapshotOf's own parameter is called `options` too, and
   * reading the scenario off it inside the stub is the mistake that
   * comment already records.
   *
   * The real floor is dashboard.js's and is attacked in
   * dev/dashboard.test.mjs. What this file is for is the WIRING - that
   * the card reads the document it just built rather than recounting
   * anybody, and that it stays silent when there is nothing to report.
   */
  const withheldSeries = options.seriesWithheld === true;
  globalThis.BinderDashboard = {
    DEFAULT_UNITS: "imperial",
    MIN_CELL: 5,
    snapshotOf(entries, options) {
      const snapshot = {
        seriesWithheld: withheldSeries && options.series === true,
        ids: entries.map((entry) => entry.id),
        // What the real dashboard groups on. Recording it here is what
        // makes "the identity reached the charts" checkable without
        // this file having to know how the charts count anybody.
        accountIds: entries.map((entry) => entry.accountId),
        counts: { entries: entries.length, people: entries.length },
        bases: {},
        options,
      };
      snapshots.push(snapshot);
      return snapshot;
    },
    render() {},
  };
  /*
   * What the public page is currently serving, which this stub has to
   * MODEL rather than pretend is constant.
   *
   * A stub that answered the same document to every read would say
   * "publishing changes nothing about what is published" and "taking the
   * page down leaves it up" - two false claims, and the checks that lean
   * on this would pass against a page that kept a dead anchor forever.
   * So a POST replaces it and a DELETE clears it, which is what the
   * Worker does.
   */
  let live = options.published || null;

  /*
   * What GET /membership answers, and what it answers NEXT.
   *
   * A list rather than a value, because half of what this pane promises
   * is about the SECOND read: a removal the Worker refused must leave
   * the row on screen, and an add must be followed by a re-read rather
   * than by a local guess. A stub that answered the same document
   * forever would make both of those unfalsifiable - the screen would
   * look right whether or not the page ever asked again.
   */
  const membershipAnswers = (Array.isArray(options.membership)
    ? options.membership.slice()
    : [options.membership || {
      ok: true, membership: [], malformed: [], secretOnly: [],
    }]);
  function nextMembership() {
    if (membershipAnswers.length > 1) membershipAnswers.shift();
    return membershipAnswers[0];
  }

  // Captured out here because `fetch`'s own second parameter is called
  // `options` too, and reading the scenario off it inside the stub is
  // the mistake the snapshot arm above already records in its comment.
  const refuse = typeof options.refuse === "function" ? options.refuse : null;

  globalThis.fetch = async function (url, options) {
    const request = { url, options: options || {} };
    requests.push(request);
    const method = request.options.method || "GET";
    const path = url.slice(url.indexOf("/", "https://".length));
    /*
     * Consulted for EVERY route rather than for /membership alone - #166.
     *
     * A refusal hook that only the membership calls could see made the
     * other five authenticated calls on this page untestable against the
     * one thing that matters about them, which is what they do when the
     * Worker stops accepting the session. Five of them did nothing, and
     * the suite could not say so. Every scenario below that names a path
     * relies on this being asked first.
     */
    const refused = refuse ? refuse(method, path) : null;
    if (refused) return response(refused.status, refused.body);
    if (path.startsWith("/membership")) {
      if (method === "GET") return response(200, nextMembership());
      return response(200, { ok: true });
    }
    if (url.endsWith("/export") && method === "GET") {
      return response(200, { ok: true, submissions: SUBMISSIONS });
    }
    if (url.endsWith("/snapshot") && method === "GET") {
      // 404 unless a scenario says something is already published. A
      // document on the public page is what the next one measures its
      // combined-weight movement against, and nothing else on this page
      // can supply it - the public page holds one document and the
      // Worker never parses what it stores.
      //
      // `live` rather than reaching for options.published here: this
      // function's own second parameter is called `options` too, and it
      // is the fetch init the page passed. Reading the scenario's
      // document off it silently answered 404 for every scenario and
      // made the anchor look like something the page never kept.
      return live
        ? response(200, { ok: true, snapshot: live })
        : response(404, { error: "No snapshot." });
    }
    if (url.endsWith("/snapshot") && method === "POST") {
      live = JSON.parse(request.options.body);
    }
    if (url.endsWith("/snapshot") && method === "DELETE") {
      live = null;
    }
    return response(200, { ok: true });
  };

  const createObjectURL = URL.createObjectURL;
  const revokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = () => "blob:admin-session-test";
  URL.revokeObjectURL = () => {};
  scenario++;
  await import("data:text/javascript," + encodeURIComponent(adminSource) +
    "#admin-session-" + scenario);
  await settle();
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  return {
    ...page, requests, snapshots, imported, keysUsed,
    timers: timers.slice(),
    pending: () => pending,
    rows: storage ? storage.rows : null,
  };
}

// The page reads its stored key without blocking setup, so every check
// below is about state that arrives a turn or two later.
function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

/*
 * Time passing with nobody touching anything: the clock moves, and the
 * page's interval is delivered once afterwards.
 *
 * Once, deliberately. Delivering one tick per elapsed second would let a
 * page that counts calls pass this file, and counting calls is the shape
 * that breaks on a machine coming back from sleep.
 */
async function idle(run, ms) {
  fakeNow += ms;
  for (const timer of run.timers) if (!timer.stopped) await timer.fn();
  await settle();
}

// A real input event arriving at the document, the way a browser
// delivers one - not a call into anything the page exported.
async function interact(run, type) {
  for (const registered of run.listeners) {
    if (registered.type === type) await registered.listener({ type });
  }
  await settle();
}

const MINUTE = 60 * 1000;

function requestsFor(run, suffix, method) {
  return run.requests.filter((request) =>
    request.url.endsWith(suffix) &&
    (request.options.method || "GET") === method);
}

function authorization(request) {
  return request && request.options.headers &&
    request.options.headers.Authorization;
}

function rowIds(run) {
  return run.elements.tbody.children.map((row) =>
    Number(row.children[0] && row.children[0].textContent));
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
const ADMIN = {
  ...MEMBER,
  session: "admin-session-token",
  username: "admin",
  isAdmin: true,
  telegramId: "11",
};
const SESSION_AUTH = "Bearer admin-session-token";

const signedOut = await loadAdmin(null);
check("a signed-out visitor does not reach the admin surface",
  signedOut.elements.tool.hidden && signedOut.requests.length === 0 &&
  redirects.includes("index.html"));

const member = await loadAdmin(MEMBER);
check("a member session does not reach the admin surface",
  member.elements.tool.hidden && member.requests.length === 0);

const admin = await loadAdmin(ADMIN);
await admin.elements.run.click();
await admin.elements.unpublish.click();
await admin.elements.publish.click();

const snapshotGets = requestsFor(admin, "/snapshot", "GET");
const exports = requestsFor(admin, "/export", "GET");
const snapshotDeletes = requestsFor(admin, "/snapshot", "DELETE");
let snapshotPosts = requestsFor(admin, "/snapshot", "POST");

check("every published-state read carries the admin session",
  snapshotGets.length >= 1 && snapshotGets.every((request) =>
    authorization(request) === SESSION_AUTH));
check("export carries the admin session",
  exports.length === 1 && authorization(exports[0]) === SESSION_AUTH);
check("unpublish carries the admin session",
  snapshotDeletes.length === 1 &&
  authorization(snapshotDeletes[0]) === SESSION_AUTH);
check("publish carries the admin session",
  snapshotPosts.length === 1 &&
  authorization(snapshotPosts[0]) === SESSION_AUTH);

/* Read here, before the deletion scenarios below publish again: this
   site had nothing on its public page, and the first document a site
   ever makes has nothing to measure from. A fabricated anchor would
   report the whole group's weight as its first month's gain (#73). */
const firstEverAnchor = admin.snapshots.at(-1).options.previous;
check("an undecryptable submission is listed by id without shifting rows",
  admin.elements["failure-list"].textContent.includes(
    "row 73: could not be opened with this key") &&
  JSON.stringify(rowIds(admin)) === JSON.stringify([41, 99]));

/*
 * The identity has to make the whole journey - fetched as a column,
 * carried past a decryption that only touches the blob, and handed to
 * whatever counts people. Every step of it exists already; the one that
 * dropped it is entryFor, and it drops it silently, because a chart
 * grouped by the wrong key looks exactly like a chart grouped by the
 * right one.
 */
check("the account id reaches the charts with the row it came on",
  admin.snapshots.length >= 1 &&
  JSON.stringify(admin.snapshots.at(-1).accountIds) ===
    JSON.stringify(["account-one", "account-one"]));

const inputValues = Object.values(admin.elements)
  .filter((element) => element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA")
  .map((element) => element.value)
  .filter(Boolean);
const authorizedRequests = admin.requests.filter(authorization);
check("no DOM input value becomes an Authorization header",
  authorizedRequests.length >= 3 && authorizedRequests.every((request) =>
    !inputValues.some((value) => authorization(request).includes(value))));
check("the shipped source does not claim snapshot reads need no credential",
  !adminSource.includes("needs no credentials at all"));

const targetRow = admin.elements.tbody.children.find((row) =>
  Number(row.children[0] && row.children[0].textContent) === 41);
const deleteButton = targetRow && descendants(targetRow).find((element) =>
  element.tagName === "BUTTON");
const exportsBeforeDelete = requestsFor(admin, "/export", "GET").length;
if (deleteButton) await deleteButton.click();

const rowDeletes = requestsFor(admin, "/submission/41", "DELETE");
check("row deletion sends the row's real id with the admin session",
  rowDeletes.length === 1 && authorization(rowDeletes[0]) === SESSION_AUTH);

await admin.elements.publish.click();
snapshotPosts = requestsFor(admin, "/snapshot", "POST");
const lastSnapshot = snapshotPosts.length
  ? JSON.parse(snapshotPosts.at(-1).options.body)
  : null;
check("deletion removes only that row from live state without refetching",
  JSON.stringify(rowIds(admin)) === JSON.stringify([99]) &&
  requestsFor(admin, "/export", "GET").length === exportsBeforeDelete &&
  lastSnapshot && JSON.stringify(lastSnapshot.ids) === JSON.stringify([99]));

/*
 * The publish pipeline carries the document it replaces - #73.
 *
 * A combined-weight delta needs an anchor, and the anchor has to be a
 * property of the document rather than the reader's clock, or two people
 * opening the same bytes an hour apart see different movements. Only
 * this page can supply it: the public page holds one document with
 * nothing to compare against, and the Worker stores the body verbatim
 * without ever parsing it.
 *
 * What is asserted here is the WIRING - that the current document
 * reaches snapshotOf as `previous`, and that a stale one never does.
 * Whether the delta it produces is safe to publish is dashboard.js's
 * floor, and dev/dashboard.test.mjs is where that is attacked.
 */
const LIVE = {
  snapshot: 1,
  generated: "2026-07-01T00:00:00.000Z",
  counts: { entries: 9, people: 9 },
  bases: { people: {}, entries: {} },
};

const republish = await loadAdmin(ADMIN, { published: LIVE });
await republish.elements.run.click();
await republish.elements.publish.click();
check("publishing measures from the document already on the public page",
  republish.snapshots.at(-1).options.previous === LIVE);

check("publishing with nothing published measures from nothing",
  firstEverAnchor === null);

await republish.elements.publish.click();
check("the next document measures from the one just published, not the old one",
  // The page re-reads what is live after publishing, so a second press
  // moves the anchor forward. A stuck anchor would publish the same
  // month's movement twice and then double it.
  republish.snapshots.at(-1).options.previous !== LIVE &&
  republish.snapshots.at(-1).options.previous !== null);

await republish.elements.unpublish.click();
await republish.elements.publish.click();
check("taking the page down drops the anchor with it",
  // The document is gone from the public page, so measuring the next
  // one from it would print the difference against something nobody can
  // see any more. Held as its own check because the failure is silent:
  // a kept anchor produces a perfectly plausible number.
  republish.snapshots.at(-1).options.previous === null);

/*
 * A ticked box that publishes nothing, and the card that said nothing
 * about it - #177.
 *
 * The keyholder ticked "Include weight over time", pressed "Show what
 * would be sent", and read `"series": null` in the preview. The card was
 * silent, so "I did not ask for it" and "the floor took it out" looked
 * the same from the one screen where the difference decides whether to
 * publish. The document already records which; the card reads it.
 *
 * It speaks through the status line the card already has rather than
 * through a new element: admin.html is at 94% of its byte ceiling, this
 * page is contended by #166 and #174, and a sentence is not worth a
 * fourth pass over the markup.
 */
const withheld = await loadAdmin(ADMIN, { seriesWithheld: true });
await withheld.elements.run.click();
withheld.elements["publish-series"].checked = true;
await withheld.elements["publish-preview"].click();

check("the preview says the series was withheld, not merely absent",
  withheld.elements["publish-status"].textContent.includes(
    "Weight over time is not in it") &&
  withheld.elements["publish-status"].textContent.includes(
    "more than one entry"));

check("the preview still shows the document it is describing",
  JSON.parse(withheld.elements["publish-preview-body"].textContent)
    .seriesWithheld === true);

await withheld.elements.publish.click();
check("publishing repeats what the document does not contain",
  // The keyholder may never press the preview. The moment they publish
  // is the last one at which the omission can still be told to them.
  withheld.elements["publish-status"].textContent.startsWith("Published.") &&
  withheld.elements["publish-status"].textContent.includes(
    "Weight over time is not in it"));

const included = await loadAdmin(ADMIN, { seriesWithheld: false });
await included.elements.run.click();
included.elements["publish-series"].checked = true;
await included.elements["publish-preview"].click();
await included.elements.publish.click();

check("a document that carries the series says nothing about withholding",
  // The other direction. A card that reported a withholding on every
  // publish would be noise, and noise is how a real one stops being read.
  !included.elements["publish-status"].textContent.includes("not in it") &&
  included.elements["publish-status"].textContent.startsWith("Published."));

/*
 * The key this device keeps - #70.
 *
 * The owner's decision is that the keyholder imports the key once and
 * the browser profile becomes the thing to protect. What that buys is
 * one thing - no file on the second export - and everything below is
 * the price of it being honest: the stored key has to be the site's
 * own, a damaged record has to be destroyed rather than puzzled over,
 * and Clear has to end both copies, because the departure and
 * compromise procedures name it as the lever that does.
 */
const returning = await loadAdmin(ADMIN, { stored: storedRecord() });
check("a key stored on this device makes the tool ready without a paste",
  /holds your key/.test(returning.elements.status.textContent) &&
  returning.elements.run.disabled === false);

returning.elements.keyfile.value = "";
await returning.elements.run.click();
await settle();
check("an export runs from the stored key with nothing pasted",
  requestsFor(returning, "/export", "GET").length === 1 &&
  JSON.stringify(rowIds(returning)) === JSON.stringify([41, 99]) &&
  returning.imported.length === 0);

/* Not "a key was used" but "that key was used". A page that quietly
 * fell back to importing something would pass every check above. */
check("the rows are opened with the key the store handed back",
  returning.keysUsed.length === 3 &&
  returning.keysUsed.every((key) => key === DEVICE_KEY));

/*
 * Each scenario is driven to the end before the next one loads. The
 * page reads `indexedDB` off the global at the moment it is called, so
 * a click on an earlier scenario's button after a later load would
 * write into the later scenario's store - and every check here would
 * still pass while proving nothing.
 */
const first = await loadAdmin(ADMIN, { persist: true });
check("a device holding nothing says nothing about a key",
  first.elements.status.textContent === "" && first.rows.size === 0);

await first.elements.run.click();
await settle();
check("importing a key keeps the key object on this device",
  first.rows.size === 1 &&
  first.rows.get("current").privateKey === IMPORTED_KEY &&
  first.rows.get("current").publicKey === PUBLIC_KEY);

/*
 * The property the whole option turns on: what is stored is the
 * non-extractable key object, so the text that produced it exists
 * nowhere afterwards. A record carrying the file's contents would look
 * identical from the page and be the thing #70 refused.
 */
check("nothing that could be written down is stored beside it",
  first.rows.size === 1 &&
  !JSON.stringify(first.rows.get("current")).includes("PRIVATE_KEY"));

check("a granted persistence request is reported without promising more",
  /on this device/.test(first.elements.status.textContent) &&
  !/evict/i.test(first.elements.status.textContent));

/* The key is not session material and does not follow the session's
 * rules; the reasoning is in admin.js. What is checkable here is that
 * it never lands in the store the session owns. */
check("the key does not enter sessionStorage",
  [...values.keys()].join(",") === "hgb-session");

await first.elements.clear.click();
await settle();
check("Clear destroys the stored key as well as this page's copy",
  first.rows.size === 0 &&
  /no key is stored on this device/.test(
    first.elements.status.textContent));

first.elements.keyfile.value = "";
const exportsBeforeCleared = requestsFor(first, "/export", "GET").length;
await first.elements.run.click();
await settle();
check("after Clear the page asks for the key file rather than fetching",
  requestsFor(first, "/export", "GET").length === exportsBeforeCleared &&
  /key file/i.test(first.elements.status.textContent));

/*
 * A key that imports cleanly and belongs to a different keypair - the
 * ordinary shape of a rotated key, or of the wrong file picked out of a
 * folder with two in it. It has to keep working, because the old key is
 * how pre-rotation rows are read; it must not be kept, because a record
 * naming a key it does not hold is a label rather than a fact, and the
 * next load would accept it.
 */
const foreign = await loadAdmin(ADMIN, { opensSiteKey: false });
await foreign.elements.run.click();
await settle();
check("a key that is not the site's opens the export and is not kept",
  requestsFor(foreign, "/export", "GET").length === 1 &&
  JSON.stringify(rowIds(foreign)) === JSON.stringify([41, 99]) &&
  foreign.rows.size === 0 &&
  /opens this export/.test(foreign.elements.status.textContent) &&
  /not kept on this device/.test(foreign.elements.status.textContent));

/*
 * The same foreign key, opening NOTHING - the other outcome the one
 * card has to cover, and the one #258 is about.
 *
 * Which sentence belongs to which count is settled in
 * dev/admin.test.mjs against the pure half. What is settled HERE is the
 * WIRING: the card is chosen from the count this run actually produced,
 * not from a constant. A count hardcoded truthy in finish() leaves every
 * pure check green and puts the export claim back on a card that opened
 * nothing, which is exactly the sentence a keyholder would act on.
 *
 * Both directions live in the pair: this one fails if the neutral branch
 * claims an export, and the check above fails if the branch that did
 * open one stops saying so.
 */
const foreignEmpty = await loadAdmin(ADMIN, {
  opensSiteKey: false,
  opensRows: false,
});
await foreignEmpty.elements.run.click();
await settle();
const emptyCard = foreignEmpty.elements.status.textContent;
check("a foreign key that opened nothing claims no export",
  /Nothing could be decrypted/.test(emptyCard) &&
  !/opens this export/.test(emptyCard) &&
  /not kept on this device/.test(emptyCard));

const refused = await loadAdmin(ADMIN, { persist: false });
await refused.elements.run.click();
await settle();
check("a refused persistence request says the key can go, and how to return",
  // "Evicted" was the browser's word for this and it went with the
  // compression (#275): the fact a keyholder acts on is that the key
  // can disappear, not the name of the mechanism that takes it. Both
  // halves are still pinned - the loss and the way back - because a
  // notice carrying only one of them is the notice this arm exists to
  // refuse.
  /may drop it/i.test(refused.elements.status.textContent) &&
  /key file/i.test(refused.elements.status.textContent));

/*
 * Rotation seen from the device: config.js names a key this stored one
 * is not. Using it would produce an export missing every row written
 * since the rotation, which reads exactly like a working export.
 */
const rotated = await loadAdmin(ADMIN, {
  stored: storedRecord({ publicKey: "a-key-this-site-does-not-use" }),
});
check("a stored key that is not the site's is surfaced and erased",
  /not the one this site encrypts to/.test(
    rotated.elements.status.textContent) && rotated.rows.size === 0);

rotated.elements.keyfile.value = "";
await rotated.elements.run.click();
await settle();
check("and the export does not run on it",
  requestsFor(rotated, "/export", "GET").length === 0);

/* The prefill's rule - #65 - on data with more at stake: a record this
 * page will not read is erased rather than left for the next reader to
 * puzzle over. */
const damaged = await loadAdmin(ADMIN, {
  stored: storedRecord({ privateKey: undefined }),
});
check("a stored record with no usable key is erased, not kept",
  damaged.rows.size === 0 &&
  /not a usable key/.test(damaged.elements.status.textContent));

const noStorage = await loadAdmin(ADMIN, { storage: null });
await noStorage.elements.run.click();
await settle();
check("with no storage at all the key file still opens the rows",
  requestsFor(noStorage, "/export", "GET").length === 1 &&
  JSON.stringify(rowIds(noStorage)) === JSON.stringify([41, 99]) &&
  noStorage.imported.length === 1);

/* ------------------------------------------------------------------ */
/* The membership pane - #69.                                         */

/*
 * The door that replaces a hand-issued curl carrying a credential.
 *
 * What is attacked here is not "does the pane draw". It is the four ways
 * this pane could lie to the admin operating it:
 *
 *   1. by putting a numeric Telegram id somewhere durable - a URL, the
 *      history, storage, a log. The Worker HMACs the id on receipt and
 *      stores only the HMAC, so this page is the last place a numeric id
 *      exists at all, and DESIGN.md's "the identifier is the whole
 *      problem" is what it would be undoing;
 *   2. by dropping a row locally that the Worker refused to remove,
 *      which shows the lockout the Worker just prevented;
 *   3. by rendering a missing field as an empty one, which prints the
 *      flip's go-signal from a Worker that never gave it;
 *   4. by keeping a session the Worker has stopped accepting, on the one
 *      page that holds every submission in the clear.
 */
const ADMIN_ROW = {
  account_id: "a".repeat(64),
  role: "admin",
  label: "The founder",
  added_at: "2026-08-08T09:00:00.000Z",
};
const ALWAYS_ROW = {
  account_id: "b".repeat(64),
  role: "always_allow",
  label: "Break glass",
  added_at: "2026-08-08T09:05:00.000Z",
};
// Sixty-four correct characters in the wrong case. `wrangler d1 execute`
// writes it without complaint, the Worker's authority read drops it, and
// GET hands it back in `malformed` - so Remove has to send back exactly
// the bytes it was given, because the Worker folds case on both sides
// and a page that lower-cased first would be removing a different row.
const MALFORMED_ROW = {
  account_id: "C".repeat(64),
  role: "admin",
  label: "pasted into the console",
  added_at: "2026-08-08T09:10:00.000Z",
};

const FULL = {
  ok: true,
  membership: [ADMIN_ROW, ALWAYS_ROW],
  malformed: [MALFORMED_ROW],
  secretOnly: ["d".repeat(64)],
};

const textOf = (element) =>
  descendants(element).map((child) => child.textContent).join(" ");
const buttonsIn = (element) =>
  descendants(element).filter((child) => child.tagName === "BUTTON");
/*
 * A press of a button that may not be there yet.
 *
 * A contract commit is a suite written against a page that does not draw
 * these controls at all, and `buttons[0].click()` on an empty list
 * throws out of the whole file - so the red run reports ONE failure
 * instead of every arm that is not implemented. The contract has to be
 * able to say what it knows.
 */
const press = async (button) => { if (button) await button.click(); };
const textIn = (button) => (button ? button.textContent : "");

const lists = await loadAdmin(ADMIN, { membership: FULL });
const membershipGets = requestsFor(lists, "/membership", "GET");
check("the pane reads the lists once, with the admin session, and does not poll",
  membershipGets.length === 1 &&
  authorization(membershipGets[0]) === SESSION_AUTH);

check("each row is drawn in its own list",
  textOf(lists.elements["membership-admin"]).includes("The founder") &&
  !textOf(lists.elements["membership-admin"]).includes("Break glass") &&
  textOf(lists.elements["membership-always_allow"]).includes("Break glass"));

check("a malformed row is drawn apart from the rows that grant",
  lists.elements["membership-malformed"].hidden === false &&
  textOf(lists.elements["membership-malformed-list"])
    .includes("pasted into the console") &&
  !textOf(lists.elements["membership-admin"])
    .includes("pasted into the console"));

check("the secret-only list is reported with its count and named un-resolvable",
  /\b1\b/.test(lists.elements["secret-only"].textContent) &&
  /name nobody/.test(lists.elements["secret-only"].textContent) &&
  // The ids themselves go in the machine-text block rather than in the
  // sentence: a 64-character hex string has no break opportunity in it,
  // and in a paragraph it pushes the whole page sideways at phone width
  // - the defect #148 had just finished removing from this page.
  lists.elements["secret-only-ids"].hidden === false &&
  lists.elements["secret-only-ids"].textContent === "d".repeat(64));

check("a label is put back on the page as text and never as markup",
  // The label is typed by an admin and verified by nothing
  // (server/schema.sql, the membership block). This page holds every
  // submission in the clear, so a label that could carry markup is the
  // whole corpus behind an injected script.
  !/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML/.test(adminSource));

/*
 * Adding somebody. The numeric id is the one value on this page that
 * must not survive the request that carries it.
 */
const added = await loadAdmin(ADMIN, {
  membership: [
    { ok: true, membership: [], malformed: [], secretOnly: [] },
    { ok: true, membership: [ADMIN_ROW], malformed: [], secretOnly: [] },
  ],
  checked: { "member-role": "admin" },
});
added.elements["member-telegram-id"].value = "8675309";
added.elements["member-label"].value = "The founder";
await added.elements["member-add"].click();
await settle();

const adds = requestsFor(added, "/membership", "POST");
const addBody = adds.length ? JSON.parse(adds[0].options.body) : null;
check("adding posts the numeric id, the role and the label, and nothing else",
  adds.length === 1 && authorization(adds[0]) === SESSION_AUTH &&
  addBody && addBody.telegramId === "8675309" &&
  addBody.role === "admin" && addBody.label === "The founder" &&
  Object.keys(addBody).sort().join(",") === "label,role,telegramId");

check("the numeric id is cleared from the page once it has been sent",
  added.elements["member-telegram-id"].value === "");

check("the numeric id reaches no URL, no storage and no second request",
  added.requests.every((request) => !request.url.includes("8675309")) &&
  ![...values.values()].some((value) => String(value).includes("8675309")) &&
  adds.length === 1);

check("adding an admin says the new admin must sign out and in",
  /sign out and in/.test(added.elements["membership-status"].textContent));

check("a successful add re-reads rather than guessing what the table holds",
  requestsFor(added, "/membership", "GET").length === 2 &&
  textOf(added.elements["membership-admin"]).includes("The founder"));

/* The Worker's own refusal, shown in its own words - and the id kept, so
 * a typo is corrected rather than retyped. */
const refusedAdd = await loadAdmin(ADMIN, {
  // Named by path as well as method since the hook went site-wide, so this
  // still says what it always said: the ADD was refused, not every POST.
  refuse: (method, path) => method === "POST" && path.startsWith("/membership")
    ? { status: 400, body: { error: "A numeric Telegram id is needed." } }
    : null,
});
refusedAdd.elements["member-telegram-id"].value = "not-a-number";
refusedAdd.elements["member-label"].value = "whoever";
await refusedAdd.elements["member-add"].click();
await settle();
check("a refused add shows what the Worker said and keeps what was typed",
  refusedAdd.elements["membership-status"].textContent ===
    "A numeric Telegram id is needed." &&
  refusedAdd.elements["member-telegram-id"].value === "not-a-number");

check("an empty field is not sent as a request at all",
  // Not a validator - the Worker owns the shape rules and this page
  // deliberately does not restate them, so they cannot drift. This is
  // only the difference between a round trip and no round trip.
  requestsFor(await (async () => {
    const blank = await loadAdmin(ADMIN);
    await blank.elements["member-add"].click();
    await settle();
    return blank;
  })(), "/membership", "POST").length === 0);

/*
 * Removal: two presses, and the Worker is the thing that decides.
 */
const removing = await loadAdmin(ADMIN, { membership: FULL });
const adminButtons = buttonsIn(removing.elements["membership-admin"]);
await press(adminButtons[0]);
await settle();
check("the first press asks rather than removes",
  requestsFor(removing, "/membership/", "DELETE").length === 0 &&
  /^Confirm removing The founder/.test(textIn(adminButtons[0])));

await press(adminButtons[0]);
await settle();
const removals = removing.requests.filter((request) =>
  (request.options.method || "GET") === "DELETE" &&
  request.url.includes("/membership/"));
check("the second press removes exactly that account from exactly that list",
  removals.length === 1 &&
  removals[0].url.endsWith("/membership/admin/" + "a".repeat(64)) &&
  authorization(removals[0]) === SESSION_AUTH);

const malformedRemoval = await loadAdmin(ADMIN, { membership: FULL });
const dudButtons = buttonsIn(
  malformedRemoval.elements["membership-malformed-list"]);
await press(dudButtons[0]);
await press(dudButtons[0]);
await settle();
const dudRemovals = malformedRemoval.requests.filter((request) =>
  (request.options.method || "GET") === "DELETE" &&
  request.url.includes("/membership/"));
check("a malformed row is removed by the bytes GET handed back",
  dudRemovals.length === 1 &&
  dudRemovals[0].url.endsWith("/membership/admin/" + "C".repeat(64)));

/* The last admin row. The Worker refuses inside the DELETE; this page's
 * job is to believe it. */
const refusedRemoval = await loadAdmin(ADMIN, {
  membership: FULL,
  refuse: (method, path) => method === "DELETE" && path.startsWith("/membership")
    ? {
      status: 409,
      body: {
        error: "That is the last admin row. Add another admin before " +
          "removing this one.",
      },
    }
    : null,
});
const lastButtons = buttonsIn(refusedRemoval.elements["membership-admin"]);
await press(lastButtons[0]);
await press(lastButtons[0]);
await settle();
check("a refused removal leaves the row on the page and re-reads",
  textOf(refusedRemoval.elements["membership-admin"]).includes("The founder") &&
  /last admin row/.test(
    refusedRemoval.elements["membership-status"].textContent) &&
  requestsFor(refusedRemoval, "/membership", "GET").length === 2);

/* A session the Worker has stopped accepting, on the page that holds
 * every submission in the clear. */
const expired = await loadAdmin(ADMIN, {
  refuse: (method, path) => path.startsWith("/membership")
    ? { status: 401, body: { error: "Unauthorized." } }
    : null,
});
await settle();
check("a membership call the session cannot make ends the session and leaves",
  Session.read() === null && redirects.includes("index.html") &&
  // And it says so rather than leaving a blank pane behind while the
  // navigation is still in flight. What it says is the session and the
  // way back - the compression to one clause (#275) took out the middle
  // clause naming what was done with the credential, which is a fact
  // about this page's housekeeping rather than about the admin.
  /session was not accepted/.test(
    expired.elements["membership-status"].textContent) &&
  /sign in again/i.test(expired.elements["membership-status"].textContent));

/* The go-signal, which is the one thing on this pane that a missing
 * field could turn into a lie. */
const quiet = await loadAdmin(ADMIN, {
  membership: { ok: true, membership: [ADMIN_ROW] },
});
check("a Worker that reported no secret-only list is not read as the signal",
  /did not report/.test(quiet.elements["secret-only"].textContent) &&
  !/go-signal/.test(quiet.elements["secret-only"].textContent) &&
  // And no id block is offered, because there is no list to put in one.
  quiet.elements["secret-only-ids"].hidden === true &&
  quiet.elements["membership-malformed"].hidden === true);

/* A granting row this page cannot name still has to appear somewhere. */
const future = await loadAdmin(ADMIN, {
  membership: {
    ok: true,
    membership: [ADMIN_ROW, { ...ADMIN_ROW, role: "auditor", label: "later" }],
    malformed: [],
    secretOnly: [],
  },
});
check("a row with a role this page cannot name is reported rather than hidden",
  future.elements["membership-other"].hidden === false &&
  future.elements["membership-other-body"].textContent.includes("later") &&
  future.elements["membership-other-body"].textContent.includes("auditor"));

/* The pane is behind the same gate as everything else here. */
check("a member session never reaches the membership routes",
  requestsFor(member, "/membership", "GET").length === 0);

/* ------------------------------------------------------------------ */
/* Every authenticated call, one answer to a refused session - #166.  */

/*
 * THE RULE THIS PAGE ALREADY WROTE DOWN, HONORED BY ONE CALL IN SIX.
 *
 * admin.js says it twice, in its own words: "a 401 ends the tab: this page
 * holds every submission in the clear, and a session the Worker no longer
 * accepts is not one to keep a key and a corpus sitting behind." Only the
 * membership family did it. Export, the published-status read, unpublish,
 * publish and row deletion each printed a sentence and stayed - on a page
 * holding the decrypted corpus, with the private key in IndexedDB beside
 * it. The gate was green throughout, because nothing had ever asked those
 * five what they do with a 401.
 *
 * So each of the six is driven separately rather than through one loop.
 * They are six different closures reached by six different acts, and a
 * loop over a shared helper would prove the helper works while saying
 * nothing about whether a given button reaches it - which is the exact
 * shape of the bug: the helper existed and five callers went around it.
 *
 * What each arm asserts is the whole answer, not the sentence alone:
 *   - the credential is gone (Session.read()),
 *   - the tab is leaving (redirects),
 *   - and the words name the session rather than the number, because
 *     "The server answered 401." is what F8 put in front of an admin who
 *     had clicked nothing.
 */
const DEAD = { status: 401, body: { error: "Unauthorized." } };
const named = (element) =>
  /sign in again/i.test(element.textContent) &&
  !/\b401\b/.test(element.textContent) &&
  !/server answered/i.test(element.textContent);

/*
 * The read that fires on page load, before the admin has touched
 * anything - F8's own case. It is also the only one of the six that had
 * no 401 branch at all, so it fell through to the raw-status sentence.
 */
const deadOnLoad = await loadAdmin(ADMIN, {
  refuse: (method, path) => method === "GET" && path === "/snapshot"
    ? DEAD : null,
});
await settle();
check("the published-state read answers a dead session in words, not a number",
  named(deadOnLoad.elements["published-state"]));
check("and the read nobody asked for still ends the session and leaves",
  Session.read() === null && redirects.includes("index.html"));

const deadExport = await loadAdmin(ADMIN, {
  refuse: (method, path) => path === "/export" ? DEAD : null,
});
await deadExport.elements.run.click();
await settle();
check("a refused export ends the session and leaves",
  named(deadExport.elements.status) && Session.read() === null &&
  redirects.includes("index.html"));

/* Unpublish and publish both need something on the public page first:
 * the button is only offered when there is a document to take down. */
const deadUnpublish = await loadAdmin(ADMIN, {
  published: LIVE,
  refuse: (method, path) => method === "DELETE" && path === "/snapshot"
    ? DEAD : null,
});
await deadUnpublish.elements.unpublish.click();
await settle();
check("a refused unpublish ends the session and leaves",
  named(deadUnpublish.elements["unpublish-status"]) &&
  Session.read() === null && redirects.includes("index.html"));

const deadPublish = await loadAdmin(ADMIN, {
  refuse: (method, path) => method === "POST" && path === "/snapshot"
    ? DEAD : null,
});
await deadPublish.elements.run.click();
await deadPublish.elements.publish.click();
await settle();
check("a refused publish ends the session and leaves",
  named(deadPublish.elements["publish-status"]) && Session.read() === null &&
  redirects.includes("index.html"));

/* Row deletion, which is reached only after an export has drawn rows -
 * so this scenario lets /export through and refuses the delete alone. */
const deadDelete = await loadAdmin(ADMIN, {
  refuse: (method, path) => path.startsWith("/submission/") ? DEAD : null,
});
await deadDelete.elements.run.click();
await settle();
const deadRow = deadDelete.elements.tbody.children.find((row) =>
  Number(row.children[0] && row.children[0].textContent) === 41);
const deadRowButton = deadRow && descendants(deadRow).find((element) =>
  element.tagName === "BUTTON");
await press(deadRowButton);
await settle();
check("a refused row deletion ends the session and leaves",
  named(deadDelete.elements.status) && Session.read() === null &&
  redirects.includes("index.html"));

/*
 * And the structural half, which is what stops the seventh caller from
 * being written the old way tomorrow.
 *
 * The six behavioral arms above cannot say this. They pass against a page
 * carrying six correct copies of the same branch, and six copies IS the
 * defect: the page had five, four of them disagreed about what to do, and
 * the fifth forgot to compare at all. What went wrong was not that a
 * caller got the answer wrong, it was that every caller was entitled to
 * have one.
 *
 * So the property is that the number is not in the call sites' hands.
 * Exactly two comparisons name the refusal - the one that decides what
 * the status means, and the guard the call sites ask instead - and no
 * call site compares a response status to it directly.
 *
 * Paired with the behavioral arms deliberately: a count computed from the
 * file it guards cannot tell a unified page from a rearranged one, and on
 * its own it would go green for a page where sessionRefused is never
 * called by anybody.
 */
check("no authenticated call site decides for itself what a refusal means",
  !/\.status === 401/.test(adminSource) &&
  (adminSource.match(/status [!=]== REFUSED/g) || []).length === 2);

/* ------------------------------------------------------------------ */
/* The attention timer - #91, V-222390.                               */

/*
 * THE PAGE IS THE ONLY THING THAT CAN SEE ATTENTION.
 *
 * The Worker bounds a session by requests: `ADMIN_IDLE_MINUTES` slides
 * on every authenticated call and the cap in `SESSION_HOURS` ends it
 * regardless. Neither measures whether anybody is at the machine, and
 * this is the page where that difference is the whole hazard - an admin
 * who decrypts, reads and walks away leaves a tab holding every
 * submitter's plaintext, with the private key in IndexedDB beside it.
 *
 * So what is attacked below is not "does a timer run". It is the five
 * ways a timer on this page could be worse than none:
 *
 *   1. by counting its own ticks instead of reading the clock, which
 *      makes a sleeping laptop look like an attentive admin;
 *   2. by treating its own repaints, or the absence of an answer, as
 *      attention - a timer fed by anything other than a person is a
 *      timer that never fires;
 *   3. by failing OPEN on a last-interaction time it cannot make sense
 *      of, which is the same thing arriving through a bug;
 *   4. by firing silently, so the page becomes useless mid-read and the
 *      admin's next act is to sign in again and decrypt the corpus a
 *      second time;
 *   5. by tearing down locally and leaving the credential alive, which
 *      is the half #90 exists to close.
 */
/*
 * Reached through the same kind of shim as `press` above, and for the
 * same reason: a contract commit runs against a page that exports none
 * of this, and `verdictAt(...)` on an undefined function throws
 * out of the whole file - so the red run would report ONE failure
 * instead of every arm that is not implemented yet. A missing export
 * still fails every check below; it just fails them out loud.
 */
const Admin = globalThis.BinderAdmin;
const WINDOW = Admin.IDLE_WINDOW || {};
const verdictAt = (last, now) =>
  (Admin.idleVerdict ? Admin.idleVerdict(last, now) : {});
const noticeAt = (last, now) =>
  (Admin.idleNotice ? Admin.idleNotice(verdictAt(last, now)) : null);

check("the page's window is ten minutes with two minutes of warning",
  WINDOW.idleMs === 10 * MINUTE && WINDOW.warnMs === 2 * MINUTE);

/*
 * The one number on this page that is only meaningful beside another
 * file's, so it is compared against that file rather than restated.
 *
 * `ADMIN_IDLE_MINUTES` is the Worker's sliding window. The page's has to
 * be SHORTER, and the ordering is the load-bearing part rather than
 * either value: at ten against fifteen the page always acts first, so
 * the tab discards its plaintext and revokes on its own initiative.
 * Reversed, this timer becomes unreachable - the credential dies first,
 * some call gets a 401, and the corpus stays on screen until it does.
 * Lowering the Worker's number is the change that would do it, and
 * nothing in `apps/web` can see that happen.
 */
const workerIdleMinutes = Number(
  (/const ADMIN_IDLE_MINUTES = (\d+);/.exec(workerSource) || [])[1]);
check("the page acts before the Worker's own idle window can",
  Number.isFinite(workerIdleMinutes) &&
  WINDOW.idleMs < workerIdleMinutes * MINUTE);

check("a fresh interaction reads as active",
  verdictAt(START, START).state === "active" &&
  verdictAt(START, START + MINUTE).state === "active");

check("the warning opens exactly two minutes before the end, not sooner",
  verdictAt(START, START + 8 * MINUTE - 1).state === "active" &&
  verdictAt(START, START + 8 * MINUTE).state === "warning" &&
  verdictAt(START, START + 9 * MINUTE).state === "warning");

check("the tenth minute is the end, and past it stays the end",
  verdictAt(START, START + 10 * MINUTE - 1).state === "warning" &&
  verdictAt(START, START + 10 * MINUTE).state === "expired" &&
  verdictAt(START, START + 400 * MINUTE).state === "expired");

/*
 * The wake. A machine that slept through the whole window delivers one
 * late tick and no others, so the verdict has to come from the clock
 * rather than from how many times anything ran. This is arm 1 of the
 * five above, asked of the pure half where it can be asked exactly.
 */
check("a clock that jumped the whole window reads expired, not missed",
  verdictAt(START, START + 3 * 60 * MINUTE).state === "expired" &&
  verdictAt(START, START + 3 * 60 * MINUTE).msLeft === 0);

/*
 * Arm 3: fail SAFE. A last-interaction time this function cannot read is
 * not evidence of attention, and the difference between "no evidence"
 * and "attention" is the whole corpus staying on a screen. There is no
 * honest active answer here, so there is no active answer.
 */
check("an unreadable last-interaction time expires rather than persists",
  [null, undefined, NaN, "just now", Infinity].every((value) =>
    verdictAt(value, START).state === "expired"));

check("a clock that ran backwards is not read as attention either",
  // Ahead-of-now is not fresher than now; it is a clock nobody should
  // trust. The safe reading of an untrustworthy clock is the same as the
  // safe reading of an unreadable time.
  verdictAt(START + MINUTE, START).state === "expired");

check("the warning says how long is left and how to keep the page",
  /\b1:00\b/.test(noticeAt(START, START + 9 * MINUTE)) &&
  /clear/i.test(noticeAt(START, START + 9 * MINUTE)) &&
  // And nothing to say while nobody needs telling.
  noticeAt(START, START) === "");

/*
 * WHAT THE SENTENCE PROMISES, AGAINST WHAT THE PAGE ACTUALLY LISTENS
 * FOR - and the two had drifted apart.
 *
 * The notice told a keyholder that "any key, click or scroll" keeps the
 * page open. `scroll` is not in INTERACTION and DESIGN.md excludes it BY
 * NAME, because this page fires one itself when it moves focus to this
 * very warning. So a scrollbar drag and a keyboard scroll kept nothing
 * open, on the one page that holds every submission in the clear, and
 * an admin who scrolled and looked away would return to a cleared page
 * having done exactly what the page told them to do.
 *
 * The event list is READ OFF THE SHIPPED FILE rather than written here.
 * A list restated in this suite would let the page's own set change
 * underneath a sentence that stayed green, which is the drift this arm
 * exists to end - and the word map is what turns four event names into
 * the four things a person would say they did.
 */
const interactionTypes =
  (/const INTERACTION = \[([^\]]*)\]/.exec(adminSource) || ["", ""])[1]
    .replace(/["'\s]/g, "").split(",").filter(Boolean);

const WORD_FOR = {
  pointerdown: "click", keydown: "key", wheel: "wheel", touchstart: "touch",
};

check("the page's interaction set is the four device events, off the file",
  interactionTypes.slice().sort().join(",") ===
    ["keydown", "pointerdown", "touchstart", "wheel"].join(",") &&
  interactionTypes.every((type) => WORD_FOR[type]));

const promise = noticeAt(START, START + 9 * MINUTE);
check("the notice names every event the page listens for",
  interactionTypes.every((type) => promise.includes(WORD_FOR[type])));
check("and promises no scroll, which the page produces itself and ignores",
  !/\bscroll/i.test(promise));

/* ------------------------------------------------------------------ */
/* The same rules, wired to the page.                                 */

const idling = await loadAdmin(ADMIN);
await idling.elements.run.click();
await settle();

/*
 * Arm 2, and the design fact this file is here to keep honest: what
 * counts as attention is a real input event from a device.
 *
 * `scroll` is named and refused rather than merely absent. It is the
 * tempting one - an admin reading a long table scrolls - but a scroll
 * event is a CONSEQUENCE, and this page produces scrolls itself:
 * focusing the warning's own button scrolls it into view, which would
 * make the warning cancel the timer that raised it. `wheel` and
 * `touchstart` are the device doing the scrolling, and they cannot be
 * produced by a repaint.
 */
const listenedFor = idling.listeners.map((entry) => entry.type).sort();
check("attention is real input events, and never a scroll or a timer",
  listenedFor.join(",") === "keydown,pointerdown,touchstart,wheel");

check("and it is listened for in the capture phase",
  // A listener anything can hide by stopping propagation is a timer that
  // reports attention it never saw.
  idling.listeners.every((entry) => entry.options &&
    entry.options.capture === true));

const requestsBeforeWarning = idling.requests.length;
await idle(idling, 8 * MINUTE);
check("the warning appears before anything is taken away",
  idling.elements["idle-warning"].hidden === false &&
  /2:00/.test(idling.elements["idle-countdown"].textContent) &&
  // Still signed in, still holding the rows it decrypted.
  Session.read() !== null &&
  idling.elements.tbody.children.length === 2);

check("and the warning is what gets the keyboard, not just the screen",
  idling.focusedNow() === idling.elements["idle-stay"]);

check("nothing is sent to hold the session open while it warns",
  // A page that pinged to keep itself alive would slide the Worker's
  // window forever, which is the pane comment's rule for the whole page.
  idling.requests.length === requestsBeforeWarning);

await idle(idling, MINUTE);
check("the countdown counts down rather than repeating itself",
  /1:00/.test(idling.elements["idle-countdown"].textContent));

await interact(idling, "keydown");
check("a keystroke puts the warning away and gives the window back",
  idling.elements["idle-warning"].hidden === true &&
  Session.read() !== null);

await idle(idling, 8 * MINUTE);
check("and the window it gives back is the whole window",
  // Not the remainder of the old one. A reset that only cancelled the
  // warning would expire this tab a minute later.
  idling.elements["idle-warning"].hidden === false &&
  Session.read() !== null);

/* The button, for whoever reaches for the mouse instead. */
await idling.elements["idle-stay"].click();
check("pressing Stay signed in is the same reprieve",
  idling.elements["idle-warning"].hidden === true &&
  Session.read() !== null);

/*
 * The teardown itself, which is the whole point and is asserted as all
 * five things at once rather than as a status line.
 */
const expiring = await loadAdmin(ADMIN);
await expiring.elements.run.click();
await settle();
check("the export this scenario tears down is really on the page",
  expiring.elements.tbody.children.length === 2 &&
  expiring.elements.results.hidden === false);

await idle(expiring, 10 * MINUTE);

const sessionDeletes = requestsFor(expiring, "/session", "DELETE");
check("expiry revokes the session at the Worker, not only in this tab",
  sessionDeletes.length === 1 &&
  authorization(sessionDeletes[0]) === SESSION_AUTH &&
  // keepalive, because the teardown navigates in the same turn and a
  // browser cancels in-flight fetches when the page goes.
  sessionDeletes[0].options.keepalive === true);

check("expiry discards the plaintext this page had decrypted",
  expiring.elements.tbody.children.length === 0 &&
  expiring.elements.summary.textContent === "" &&
  expiring.elements.results.hidden === true &&
  expiring.elements.dashboard.hidden === true &&
  expiring.elements["publish-card"].hidden === true);

check("expiry clears the key text out of the page as well",
  expiring.elements.keyfile.value === "");

check("expiry ends the local session and leaves the page",
  Session.read() === null && redirects.includes("index.html"));

/*
 * And the key on the DEVICE is not touched, which is the one thing here
 * that must NOT happen. It is not authority - nothing issued it, nothing
 * revokes it, and admin.js's note on KEY_DB is where that reasoning
 * lives. Clear is its lever; an idle timer that also erased it would
 * make walking away from a machine cost the keyholder their key.
 */
const keptThrough = await loadAdmin(ADMIN, { stored: storedRecord() });
await idle(keptThrough, 10 * MINUTE);
check("expiry does not take the keyholder's stored key with it",
  keptThrough.rows.size === 1 &&
  keptThrough.rows.get("current").privateKey === DEVICE_KEY);

check("the timer stops once it has fired",
  // Nothing left running against a page that has already been emptied,
  // and no second revoke of a session that is already gone.
  keptThrough.timers.every((timer) => timer.stopped) &&
  requestsFor(keptThrough, "/session", "DELETE").length === 1);

/* Not every session on this page gets one, because not every session
 * reaches the surface that holds the corpus. */
check("a member session that never reaches the tool starts no timer",
  member.timers.length === 0 && member.listeners.length === 0);
check("and neither does a signed-out visitor",
  signedOut.timers.length === 0 && signedOut.listeners.length === 0);

/* ------------------------------------------------------------------ */
/* The download acknowledgement - #174, and the #154 sweep's F-5.      */

/*
 * ONE LIT AT A TIME, DRIVEN RATHER THAN DESCRIBED.
 *
 * A download is the one act on this page whose result appears where the
 * page cannot see it: a shelf that may be collapsed, another monitor, a
 * folder. Press one, see nothing, press two more, and there are three
 * files with no way to tell them apart - at the exact moment the data is
 * decrypted and in the clear. The acknowledgement exists for that, and
 * the rule beside DOWNLOAD_IDS says the three are one set doing one job.
 *
 * It was broken and it had no coverage at all. The class was added on
 * press and removed only when the four-second timer ran out, so three
 * presses inside that window left three buttons lit - the page saying
 * three files are on their way. The sweep could produce it by hand and
 * nothing in this repository could.
 *
 * The reason nothing could is worth recording: `acknowledge` sits
 * behind the `typeof document === "undefined"` guard and is not
 * exported, so there is no pure half to call. Rather than invent an
 * export whose body would BE the assertion - a function returning
 * "exactly the pressed one" proves only that it returns what it
 * returns - the presses are performed through the real handlers the
 * page registered, and the classes are read off the real elements.
 *
 * The seam this needs is in the harness rather than in the product, and
 * it is `classList` on makeElement. Without one every `add` and
 * `remove` the page performs lands on nothing, so a stub that omits it
 * cannot fail this section however wrong the page is - which is why it
 * is a real Set there and not an ignored call.
 */
const exports_ = await loadAdmin(ADMIN);
const DOWNLOADS = ["download", "download-xlsx", "download-json"];
const lit = () => DOWNLOADS.filter((id) =>
  exports_.elements[id].classList.contains("pressed"));

check("no download is lit before anything is pressed", lit().length === 0);

await exports_.elements.download.click();
check("a press lights the button that was pressed, and only it",
  lit().join(",") === "download");

/*
 * The words on the press, pinned VERBATIM and as the whole of what the
 * line says - the owner ruled them at the delta sitting (#126 R5, and
 * the register bar on #265 names them again).
 *
 * Equality rather than a fragment, for this sentence in particular: the
 * line it replaced opened with the same act and then explained at
 * length what the page cannot know about a download, so every fragment
 * worth matching on is inside the copy the ruling removed.
 *
 * It says nothing about WHICH file, and that is the honesty floor
 * working rather than a gap: a short line may omit, and the one thing
 * it must never do is claim the file arrived - which is why the pointer
 * sends the reader to the browser's own shelf instead.
 */
check("the press is acknowledged in the owner's words and no others",
  exports_.elements["download-status"].textContent ===
    "Downloaded — check your downloads.");

await exports_.elements["download-xlsx"].click();
check("a second press inside the window moves the light rather than adding one",
  lit().join(",") === "download-xlsx");

await exports_.elements["download-json"].click();
check("and a third leaves one lit, not three",
  lit().join(",") === "download-json");

/*
 * The expiry, and the reason the timer is cleared before it is set
 * again: pressing two downloads in a row must leave the second one lit
 * for a full window rather than being darkened by the first one's
 * expiry. So exactly one timer is live after three presses, and it is
 * the last one.
 */
const live = exports_.pending().filter((timer) => !timer.stopped);
check("three presses leave one live timer, not three", live.length === 1);

await live[0].fn();
check("and when it runs out nothing is lit at all", lit().length === 0);

if (failures) {
  console.error(`\nadmin session/delete FAILED ${failures} of ${checks}`);
  process.exit(1);
}
console.log(`\nadmin session/delete OK - ${checks} checks`);
