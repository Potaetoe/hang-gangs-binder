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
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, makeElement(
    id === "token" || id === "keyfile-picker" || id === "publish-series"
      ? "input"
      : id === "keyfile" ? "textarea" : "div",
    id,
  )]));
  for (const id of [
    "closed", "results", "dashboard", "publish-card", "failures",
    "unpublish", "publish-preview-body", "publish-status",
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
    checkedValue(name, fallback) { return fallback; },
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
  globalThis.fetch = async function (url, options) {
    const request = { url, options: options || {} };
    requests.push(request);
    const method = request.options.method || "GET";
    if (url.endsWith("/export") && method === "GET") {
      return response(200, { ok: true, submissions: SUBMISSIONS });
    }
    if (url.endsWith("/snapshot") && method === "GET") {
      return response(404, { error: "No snapshot." });
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

if (failures) {
  console.error(`\nadmin session/delete FAILED ${failures} of ${checks}`);
  process.exit(1);
}
console.log(`\nadmin session/delete OK - ${checks} checks`);
