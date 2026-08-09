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

globalThis.document = {
  querySelector() { return null; },
};
await import("data:text/javascript," + encodeURIComponent(sessionSource));
const Session = globalThis.BinderSession;

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
  const element = {
    id,
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
    "download-xlsx", "download-json", "published-state", "unpublish",
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
  ];
  const INPUTS = ["token", "keyfile-picker", "publish-series",
    "member-telegram-id", "member-label"];
  const elements = Object.fromEntries(ids.map((id) => [id, makeElement(
    INPUTS.includes(id) ? "input"
      : id === "keyfile" ? "textarea"
        : id === "member-add" ? "button" : "div",
    id,
  )]));
  for (const id of [
    "closed", "results", "dashboard", "publish-card", "failures",
    "unpublish", "publish-preview-body", "publish-status",
    "membership-status", "membership-malformed", "membership-other",
    "secret-only-ids",
  ]) elements[id].hidden = true;
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
  return {
    elements,
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

let scenario = 0;
async function loadAdmin(session, options = {}) {
  const page = makePage();
  const requests = [];
  const snapshots = [];
  const imported = [];
  const keysUsed = [];
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
      if (!RECORDS[ciphertext]) {
        throw new Error("could not be opened with this key");
      }
      return RECORDS[ciphertext];
    },
  };
  globalThis.BinderXlsx = {
    build() { return new Uint8Array([1, 2, 3]); },
  };
  globalThis.BinderDashboard = {
    DEFAULT_UNITS: "imperial",
    snapshotOf(entries, options) {
      const snapshot = {
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
    if (path.startsWith("/membership")) {
      const refused = refuse ? refuse(method, path) : null;
      if (refused) return response(refused.status, refused.body);
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
    rows: storage ? storage.rows : null,
  };
}

// The page reads its stored key without blocking setup, so every check
// below is about state that arrives a turn or two later.
function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

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
  /not kept on this device/.test(foreign.elements.status.textContent));

const refused = await loadAdmin(ADMIN, { persist: false });
await refused.elements.run.click();
await settle();
check("a refused persistence request says the key can go, and how to return",
  /evict/i.test(refused.elements.status.textContent) &&
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
  refuse: (method) => method === "POST"
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
  refuse: (method) => method === "DELETE"
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
  refuse: () => ({ status: 401, body: { error: "Unauthorized." } }),
});
await settle();
check("a membership call the session cannot make ends the session and leaves",
  Session.read() === null && redirects.includes("index.html") &&
  // And it says so rather than leaving a blank pane behind while the
  // navigation is still in flight.
  /discarded/.test(expired.elements["membership-status"].textContent));

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

if (failures) {
  console.error(`\nadmin session/delete FAILED ${failures} of ${checks}`);
  process.exit(1);
}
console.log(`\nadmin session/delete OK - ${checks} checks`);
