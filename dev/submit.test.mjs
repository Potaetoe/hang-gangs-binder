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

let failures = 0;
function check(label, condition) {
  if (!condition) failures++;
  console.log(condition ? "pass " : "FAIL ", label);
}

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
    "sign-out": makeElement("sign-out"),
    "weight-lb": makeElement("weight-lb"),
    "height-ft": makeElement("height-ft"),
    "height-in": makeElement("height-in"),
    "weight-kg": makeElement("weight-kg"),
    "height-cm": makeElement("height-cm"),
  };
  const documentListeners = new Map();
  const document = {
    readyState: "complete",
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
  globalThis.fetch = async function (url, options) {
    requests.push({ url, options: options || {} });
    return replies.shift() || response(500, { error: "No stub response." });
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
await tabs.elements["your-entries-tab"].dispatch("click");
check("switching back never leaves both panes painted",
  isPainted(tabs.elements["your-entries-pane"]) &&
  !isPainted(tabs.elements["add-entry-pane"]));

const signedOut = await loadSubmit({ member: null });
check("a signed-out visitor never reaches the panel or requests /me",
  redirects.includes("index.html") && signedOut.requests.length === 0 &&
  !isPainted(signedOut.elements["your-entries-pane"]) &&
  !isPainted(signedOut.elements["add-entry-pane"]));

const storedPrefill = JSON.stringify({
  units: "imperial",
  weightLb: "222.5",
  heightFeet: "6",
  heightInches: "1.5",
});
const prefilled = await loadSubmit({
  prefill: storedPrefill,
  replies: [response(200, { ok: true, entries: 1, lastAt: null })],
});
check("device-local prefill restores weight and height on load",
  prefilled.elements["weight-lb"].value === "222.5" &&
  prefilled.elements["height-ft"].value === "6" &&
  prefilled.elements["height-in"].value === "1.5");

const savingPrefill = await loadSubmit({
  replies: [response(200, { ok: true, entries: 1, lastAt: null })],
});
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

const absentPrefill = await loadSubmit({
  replies: [response(200, { ok: true, entries: 1, lastAt: null })],
});
check("an absent prefill does not prevent normal panel startup",
  absentPrefill.bootErrors.length === 0 &&
  absentPrefill.requests.length === 1);
const malformedPrefill = await loadSubmit({
  prefill: "{not-json",
  replies: [response(200, { ok: true, entries: 1, lastAt: null })],
});
check("a malformed prefill is ignored without breaking the page",
  malformedPrefill.bootErrors.length === 0 &&
  malformedPrefill.requests.length === 1 &&
  malformedPrefill.elements["weight-lb"].value === "" &&
  malformedPrefill.elements["height-ft"].value === "");

const signingOut = await loadSubmit({
  prefill: storedPrefill,
  replies: [response(200, { ok: true, entries: 1, lastAt: null })],
});
await signingOut.elements["sign-out"].dispatch("click");
check("sign out clears body-measurement prefill, session, and returns home",
  !localValues.has(PREFILL_KEY) && Session.read() === null &&
  redirects.at(-1) === "index.html");

if (failures) {
  console.error(`\nsubmit panel FAILED ${failures} check(s)`);
  process.exit(1);
}
console.log("\nsubmit panel OK - 15 checks");
