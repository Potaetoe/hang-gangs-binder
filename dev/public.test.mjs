/*
 * Contract checks for the member dashboard's session and fetch wiring.
 * The shipped page module runs unchanged under the same small browser stubs
 * as session.test.mjs; product code gets no test-only path.
 */
import { readFile } from "node:fs/promises";

const sessionSource = await readFile(
  new URL("../apps/web/session.js", import.meta.url), "utf8");
const publicSource = await readFile(
  new URL("../apps/web/public.js", import.meta.url), "utf8");
const dashboardHtml = await readFile(
  new URL("../apps/web/dashboard.html", import.meta.url), "utf8");

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
  pathname: "/dashboard.html",
  replace(target) { redirects.push(target); },
};

globalThis.document = {
  querySelector() { return null; },
};
await import("data:text/javascript," + encodeURIComponent(sessionSource));
const Session = globalThis.BinderSession;

function makeElement(id, hidden = false) {
  const reason = { textContent: "" };
  return {
    id,
    hidden,
    textContent: "",
    className: "",
    querySelector(selector) {
      return selector === "[data-reason]" ? reason : null;
    },
    reason,
  };
}

function makePage() {
  const elements = {
    tool: makeElement("tool", true),
    closed: makeElement("closed", true),
    status: makeElement("status"),
    freshness: makeElement("freshness"),
    charts: makeElement("charts"),
  };
  return {
    elements,
    document: {
      readyState: "complete",
      getElementById(id) { return elements[id] || null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
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

const SNAPSHOT = {
  snapshot: {
    generated: "2026-08-07T12:00:00.000Z",
    counts: { entries: 12, people: 10 },
    bases: { people: {}, entries: {} },
  },
};

let scenario = 0;
async function loadPublic(session, nextResponse) {
  const page = makePage();
  const requests = [];
  const renders = [];
  Session.clear();
  if (session) Session.write(session);
  redirects.length = 0;
  location.pathname = "/dashboard.html";

  globalThis.document = page.document;
  globalThis.BINDER_CONFIG = { endpoint: "https://worker.example" };
  globalThis.BinderUI = {
    byId(id) { return page.elements[id] || null; },
    show(element, visible) { if (element) element.hidden = !visible; },
    checkedValue(name, fallback) { return fallback; },
    boot(setUp, failed) {
      try {
        const result = setUp();
        if (result && typeof result.then === "function") {
          result.catch(failed);
        }
      } catch (error) {
        failed(error);
      }
    },
  };
  globalThis.BinderDashboard = {
    DEFAULT_UNITS: "imperial",
    render(element, snapshot, basis, units) {
      renders.push({ element, snapshot, basis, units });
    },
  };
  globalThis.fetch = async function (url, options) {
    requests.push({ url, options: options || {} });
    return nextResponse;
  };

  scenario++;
  await import("data:text/javascript," + encodeURIComponent(publicSource) +
    "#public-session-" + scenario);
  await new Promise((resolve) => setImmediate(resolve));
  return { ...page, requests, renders };
}

function authorization(request) {
  return request && request.options.headers &&
    request.options.headers.Authorization;
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

const signedOut = await loadPublic(null, response(401));
check("a signed-out visitor is sent to sign-in without painting an empty page",
  redirects.includes("index.html") && signedOut.requests.length === 0 &&
  signedOut.elements.tool.hidden && signedOut.elements.closed.hidden);

const member = await loadPublic(MEMBER, response(200, SNAPSHOT));
check("a member session authorizes the snapshot read and draws the dashboard",
  member.requests.length === 1 &&
  authorization(member.requests[0]) === "Bearer member-session-token" &&
  member.renders.length === 1 && !member.elements.tool.hidden &&
  redirects.length === 0);

const admin = await loadPublic(ADMIN, response(200, SNAPSHOT));
check("an admin's member session still opens the dashboard",
  admin.requests.length === 1 &&
  authorization(admin.requests[0]) === "Bearer admin-session-token" &&
  admin.renders.length === 1 && !admin.elements.tool.hidden &&
  redirects.length === 0);

const unauthorized = await loadPublic(MEMBER, response(401));
const unauthorizedReason = unauthorized.elements.closed.reason.textContent;
check("a Worker 401 says the visitor needs to sign in, not that the server broke",
  unauthorized.elements.closed.hidden === false &&
  /sign in/i.test(unauthorizedReason) &&
  !/server answered|first time the keyholder/i.test(unauthorizedReason) &&
  Session.read() === null);

const empty = await loadPublic(MEMBER, response(404));
const emptyReason = empty.elements.closed.reason.textContent;
check("an authorized empty snapshot keeps its distinct first-publication message",
  empty.requests.length === 1 &&
  authorization(empty.requests[0]) === "Bearer member-session-token" &&
  /first time the keyholder publishes a snapshot/i.test(emptyReason) &&
  !/sign in/i.test(emptyReason) && emptyReason !== unauthorizedReason);

check("the page identifies the dashboard as a member view before scripts run",
  /<p class="eyebrow">Members<\/p>/.test(dashboardHtml) &&
  !/<p class="eyebrow">Everyone<\/p>/.test(dashboardHtml));

if (failures) {
  console.error(`\npublic dashboard FAILED ${failures} check(s)`);
  process.exit(1);
}
console.log("\npublic dashboard OK - 6 checks");
