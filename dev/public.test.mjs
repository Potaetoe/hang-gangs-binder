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

/*
 * The clock the staleness rows are measured against.
 *
 * public.js reads the clock once (public.js:119) and hands it to ageText,
 * so any single render is already deterministic. This harness is what is
 * not: a live Date.now() against a fixed fixture lets exactly one of
 * ageText's six arms run per day, and the calendar chooses which one.
 *
 * NOW is the instant the SNAPSHOT fixture below turns exactly 48 hours
 * old. That instant is also the one second in which the module's two
 * thresholds disagree - ageText switches to days at 2880 whole minutes,
 * while the banner wants strictly more than 48 fractional hours - so it
 * is the clock that puts the sharpest edge under the rows. Both lines are
 * asserted from both sides below; reconciling them cannot pass unnoticed.
 */
const NOW = Date.parse("2026-08-09T12:00:00.000Z");
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

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

/*
 * ageText's six arms and the staleness banner, pinned to the words on
 * screen.
 *
 * The copy is the contract, not an implementation detail: "an hour ago"
 * deliberately stops counting where "59 minutes ago" counts, and someone
 * deciding whether a scheduled refresh has died reads the parenthesized
 * timestamp rather than the phrase. Asserting a substring would let the
 * friendly half rot while the useful half still matched.
 */
const STALE_WARNING = " That is older than these are meant to be, so " +
  "treat them as out of date.";

function agedBy(ms) {
  return new Date(NOW - ms).toISOString();
}

async function freshnessPage(generated) {
  return loadPublic(MEMBER, response(200, {
    snapshot: { ...SNAPSHOT.snapshot, generated },
  }));
}

async function ageLine(ms) {
  return (await freshnessPage(agedBy(ms))).elements.freshness.textContent;
}

const unknownTime = await freshnessPage("the fifth of never");
check("an unparseable publication time says so in words rather than NaN",
  unknownTime.elements.freshness.textContent ===
    "Published at an unknown time.");

check("under two minutes old reads as just now and names no number",
  await ageLine(45 * SECOND) ===
    "Figures worked out just now (2026-08-09 11:59 UTC).");

check("under an hour old counts whole minutes",
  await ageLine(30 * MINUTE) ===
    "Figures worked out 30 minutes ago (2026-08-09 11:30 UTC).");

check("past the hour the count stops and it reads as an hour ago",
  await ageLine(90 * MINUTE) ===
    "Figures worked out an hour ago (2026-08-09 10:30 UTC).");

check("past two hours it counts whole hours",
  await ageLine(25 * HOUR) ===
    "Figures worked out 25 hours ago (2026-08-08 11:00 UTC).");

check("past the staleness line it counts whole days and says it is stale",
  await ageLine(5 * 24 * HOUR) ===
    "Figures worked out 5 days ago (2026-08-04 12:00 UTC)." + STALE_WARNING);

check("the two-minute line holds one second under and one second over",
  await ageLine(2 * MINUTE - SECOND) ===
    "Figures worked out just now (2026-08-09 11:58 UTC)." &&
  await ageLine(2 * MINUTE + SECOND) ===
    "Figures worked out 2 minutes ago (2026-08-09 11:57 UTC).");

check("the one-hour line holds one second under and one second over",
  await ageLine(60 * MINUTE - SECOND) ===
    "Figures worked out 59 minutes ago (2026-08-09 11:00 UTC)." &&
  await ageLine(60 * MINUTE + SECOND) ===
    "Figures worked out an hour ago (2026-08-09 10:59 UTC).");

check("the two-hour line holds one second under and one second over",
  await ageLine(120 * MINUTE - SECOND) ===
    "Figures worked out an hour ago (2026-08-09 10:00 UTC)." &&
  await ageLine(120 * MINUTE + SECOND) ===
    "Figures worked out 2 hours ago (2026-08-09 09:59 UTC).");

check("the 48-hour line holds, hours one second under and days one over",
  await ageLine(48 * HOUR - SECOND) ===
    "Figures worked out 47 hours ago (2026-08-07 12:00 UTC)." &&
  await ageLine(48 * HOUR + SECOND) ===
    "Figures worked out 2 days ago (2026-08-07 11:59 UTC)." + STALE_WARNING);

/* An empty className is the assertion, not a placeholder: makeElement
 * starts every stub at "" and the shipped page ships class="status", so
 * "" here means the staleness branch left the element alone. */
const fresh = await freshnessPage(agedBy(25 * HOUR));
check("inside the staleness line the status keeps its class and gains no warning",
  fresh.elements.status.className === "" &&
  fresh.elements.status.textContent === "12 entries from 10 people." &&
  !fresh.elements.freshness.textContent.includes(STALE_WARNING));

const stale = await freshnessPage(agedBy(48 * HOUR + SECOND));
check("past the staleness line the status takes the bad class and the sentence gains its warning",
  stale.elements.status.className === "status bad" &&
  stale.elements.freshness.textContent.endsWith(STALE_WARNING));

check("the warning renders on the panel the visitor is shown, not the hidden one",
  stale.elements.tool.hidden === false &&
  stale.elements.closed.hidden === true &&
  stale.elements.closed.reason.textContent === "" &&
  stale.renders.length === 1);

const onTheLine = await freshnessPage(agedBy(48 * HOUR));
check("at exactly 48 hours the phrase counts days while the warning stays silent",
  onTheLine.elements.freshness.textContent ===
    "Figures worked out 2 days ago (2026-08-07 12:00 UTC)." &&
  onTheLine.elements.status.className === "");

check("a snapshot that never arrives writes no staleness display at all",
  empty.elements.freshness.textContent === "" &&
  empty.elements.status.textContent === "" &&
  empty.elements.status.className === "" &&
  empty.elements.tool.hidden === true);

if (failures) {
  console.error(`\npublic dashboard FAILED ${failures} check(s)`);
  process.exit(1);
}
console.log("\npublic dashboard OK - 21 checks");
