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
  pathname: "/admin.html",
  replace(target) { redirects.push(target); },
};

globalThis.document = {
  querySelector() { return null; },
};
await import("data:text/javascript," + encodeURIComponent(sessionSource));
const Session = globalThis.BinderSession;

const SUBMISSIONS = [
  {
    id: 73,
    ciphertext: "ciphertext-from-rotated-key",
    received_at: "2026-08-04T11:59:05.000Z",
  },
  {
    id: 41,
    ciphertext: "ciphertext-41",
    received_at: "2026-08-04T12:00:05.000Z",
  },
  {
    id: 99,
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

let scenario = 0;
async function loadAdmin(session) {
  const page = makePage();
  const requests = [];
  const snapshots = [];
  Session.clear();
  if (session) Session.write(session);
  redirects.length = 0;
  location.pathname = "/admin.html";

  globalThis.document = page.document;
  globalThis.BINDER_CONFIG = { endpoint: "https://worker.example" };
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
  globalThis.BinderCrypto = {
    unavailableReason() { return null; },
    async importPrivateKey() { return {}; },
    async decrypt(ciphertext) {
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
  await new Promise((resolve) => setImmediate(resolve));
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  return { ...page, requests, snapshots };
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

if (failures) {
  console.error(`\nadmin session/delete FAILED ${failures} check(s)`);
  process.exit(1);
}
console.log("\nadmin session/delete OK - 11 checks");
