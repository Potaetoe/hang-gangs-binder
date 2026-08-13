/*
 * Contract checks for the member panel on your-page.html.
 *
 * The shipped page module runs unchanged under the same small browser stubs
 * as session.test.mjs and public.test.mjs. The missing module is treated as
 * an empty module so this contract reports every absent behavior on its first
 * red run instead of stopping at ENOENT before a check can run.
 */
import { readFile } from "node:fs/promises";

const sessionSource = await readFile(
  new URL("../apps/web/session.js", import.meta.url), "utf8");
const signOutSource = await readFile(
  new URL("../apps/web/signout.js", import.meta.url), "utf8");
const formSource = await readFile(
  new URL("../apps/web/form.js", import.meta.url), "utf8");
const submitHtml = await readFile(
  new URL("../apps/web/your-page.html", import.meta.url), "utf8");
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
let performed = 0;

// Counted AND asserted, which are two different jobs. Printing the count
// keeps a machine-knowable number out of prose - AGENTS.md's rule 4 - and
// comparing it catches the other direction: a check that stops running,
// behind an early return or a renamed helper, still prints a confident
// "OK" for every check that remains. dev/check_budget.test.py argues this
// at length and is where the pattern comes from.
const EXPECTED = 103;

function check(label, condition) {
  performed++;
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
  pathname: "/your-page.html",
  replace(target) { redirects.push(target); },
};

/*
 * Everything ever written to any element's `dataset`, across the whole
 * page - mandate 9's second sink, and it is collected globally rather
 * than per element because the rule is about the PAGE retaining
 * decrypted content, not about one node.
 *
 * A `data-` attribute is the tempting place to park an opened row:
 * it survives the frame, it is one line, and it is invisible until
 * somebody opens devtools on a screen that is showing a member's whole
 * history in the clear. Nothing in apps/web uses `dataset` at all
 * today, so an empty record is the honest resting state and any entry
 * at all is worth reading.
 */
const datasetWrites = [];

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
    // A Proxy rather than a plain object, because a plain one would
    // record nothing and read as clean however much was written to it.
    dataset: new Proxy({}, {
      set(target, name, value) {
        datasetWrites.push({ id, name, value });
        target[name] = value;
        return true;
      },
    }),
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
    // The page's own dispatch, synchronous the way a browser's is.
    // restorePrefill fires `change` on the units radio it selected, so
    // that the group's listeners see the restored choice rather than
    // the one the markup shipped - and a stub without this method turns
    // that line into a TypeError inside setUp, which reads as the whole
    // panel failing to start.
    dispatchEvent(event) {
      for (const listener of listeners.get(event && event.type) || []) {
        listener.call(this, event);
      }
      return true;
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
    // Starts hidden, as the markup does, and for the same reason the
    // Telegram line does: the resting state is the one a member with
    // nothing corrected sees, and a stub that began painted would let
    // a line that never hides pass every check below.
    "member-corrections-line": makeElement("member-corrections-line", true),
    "member-corrections": makeElement("member-corrections"),
    // Starts hidden, as the markup does. A line that begins painted
    // would let a page which never renders anything pass the check
    // that it is on screen.
    "member-telegram-id-line": makeElement("member-telegram-id-line", true),
    "member-telegram-id": makeElement("member-telegram-id"),
    // Present so a check can read what the panel said, rather than
    // watching setStatus write into a null that swallows every message.
    "member-panel-status": makeElement("member-panel-status", true),
    // The rail's session home. Sign out moved off this page's tab strip
    // into the rail, which is on every signed-in page - so these two are
    // signout.js's elements now, not the panel's, and the harness draws
    // them because the shipped page does.
    //
    // The button starts hidden, as the markup does: signout.js reveals
    // it only once a session is confirmed, and a stub that began painted
    // would let that reveal stop happening without a check noticing.
    //
    // The door is the reverse of the exit (#187). The Sign in route
    // ships visible - with scripts dead the rail must still carry the
    // way back to the page that mints a session - so the stub starts
    // painted, and it is the confirmed session that hides it.
    "session-who": makeElement("session-who"),
    "sign-in": makeElement("sign-in"),
    "sign-out": makeElement("sign-out", true),
    "weight-lb": makeElement("weight-lb"),
    "height-ft": makeElement("height-ft"),
    "height-in": makeElement("height-in"),
    "weight-kg": makeElement("weight-kg"),
    "height-cm": makeElement("height-cm"),
    // #172's optional half. These are the fields a returning member
    // re-enters unchanged every week, and the two lines that admit the
    // memory is this browser's rather than the account's. Both lines
    // start hidden, as the markup does: a stub that began painted would
    // let the reveal stop happening without a check noticing, and the
    // note is the one thing standing between a prefilled form and a
    // member who believes their account followed them here.
    gender: makeElement("gender"),
    country: makeElement("country"),
    over18: makeElement("over18"),
    "prefill-note": makeElement("prefill-note", true),
    "over18-remembered": makeElement("over18-remembered", true),
    // #85's personal arm. Every one of these ships hidden, and the
    // resting state is what most of the arms below turn on: a member
    // whose browser holds no key, or whose rows were all sealed
    // elsewhere, must see the card and its sentence WITHOUT the
    // controls or an empty answer beneath them. A stub that began
    // painted would let a reveal stop happening unnoticed.
    "your-history": makeElement("your-history", true),
    "history-status": makeElement("history-status", true),
    "history-controls": makeElement("history-controls", true),
    "h-split": makeElement("h-split"),
    "h-measure-field": makeElement("h-measure-field"),
    "history-answer": makeElement("history-answer"),
    "history-sealed": makeElement("history-sealed", true),
    "history-sealed-count": makeElement("history-sealed-count"),
  };
  elements["h-split"].value = "weight";
  // Radio and checkbox groups are reached by name rather than by id, so
  // they live beside `elements` rather than in it. Imperial is checked
  // because the shipped markup ships it checked.
  const units = [
    makeElement("units-imperial"), makeElement("units-metric"),
  ];
  units[0].value = "imperial";
  units[0].checked = true;
  units[1].value = "metric";
  const measures = ["count", "median", "mean"].map((value) => {
    const input = makeElement("h-measure-" + value);
    input.value = value;
    return input;
  });
  measures[0].checked = true;
  const roles = ["feeder", "feedee", "gainer", "admirer"].map((value) => {
    const input = makeElement("role-" + value);
    input.value = value;
    return input;
  });
  const documentListeners = new Map();
  // Every type this page dispatched, so a check can assert the panel told
  // form.js the form is on screen again - #64. The panel must announce
  // rather than reach into #done and #submission, which belong to form.js.
  const dispatchedHere = [];
  // And the events themselves. What rides on the height announcement is
  // the contract - form.js cannot read this store and the panel cannot
  // read form.js's boxes, so the number crossing between them is the
  // whole of the guard's memory.
  const eventsHere = [];
  const document = {
    readyState: "complete",
    dispatchedHere,
    eventsHere,
    dispatchEvent(event) {
      dispatchedHere.push(event && event.type);
      eventsHere.push(event);
      const handlers = documentListeners.get(event && event.type) || [];
      for (const listener of handlers) listener.call(document, event);
      return true;
    },
    getElementById(id) { return elements[id] || null; },
    querySelector(selector) {
      if (selector === "[data-dev-session]") return null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'input[name="units"]') return units;
      if (selector === 'input[name="h-measure"]') return measures;
      if (selector === 'input[name="roles"]') return roles;
      if (selector === 'input[name="roles"]:checked') {
        return roles.filter((input) => input.checked);
      }
      return [];
    },
    addEventListener(type, listener) {
      const handlers = documentListeners.get(type) || [];
      handlers.push(listener);
      documentListeners.set(type, handlers);
    },
    async dispatch(type, detail) {
      const event = { type, detail, target: document,
        currentTarget: document };
      for (const listener of documentListeners.get(type) || []) {
        await listener.call(document, event);
      }
    },
  };
  return { document, elements, units, roles, measures };
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

/*
 * The three modules #85's personal arm calls, stubbed so that what is
 * asserted is WHAT THIS PAGE DOES WITH THEM rather than what they do.
 *
 * Each records its calls, and the recordings are the contract:
 *
 *  - `personalSource` counts its calls and keeps the entries it was
 *    handed. That is the boundary from this side - dev/public.test.mjs
 *    counts the same function to prove charts.html never reaches it,
 *    and this file proves the page that MAY reach it hands it only what
 *    opened.
 *  - `run` keeps every query. The basis and the units are read off those
 *    recordings rather than off the page, because a control that exists
 *    and a value that reaches the engine are different claims.
 *  - `decrypt` opens the blobs a scenario says are openable and throws
 *    on the rest, which is exactly what crypto.js does with a row sealed
 *    to a key this browser is not.
 *
 * `personalSource` returning a marked object rather than a real source
 * is deliberate: a real one would need the whole snapshot builder, and
 * what this file is for is the wiring around it.
 */
function engineStubs(history) {
  const engine = {
    ensured: [], sources: [], queries: [], drawn: [], decrypted: [],
    described: [],
  };
  /*
   * No argument means the modules are NOT on the page, which is the
   * state every arm above this section was written against and the
   * state two of the three signed-in pages are really in. The personal
   * arm stops before its first fetch, and those arms keep counting the
   * one request they always counted.
   */
  if (!history) {
    delete globalThis.BinderMemberKey;
    delete globalThis.BinderCrypto;
    delete globalThis.BinderQuery;
    delete globalThis.BinderDashboard;
    return engine;
  }
  const key = "key" in history ? history.key : { privateKey: "device-key" };
  const opens = history.opens || [];
  const unavailable = history.unavailable || "no database here";
  globalThis.BinderMemberKey = Object.freeze({
    DB_NAME: "hgb-member-key",
    unavailableReason() { return key ? null : unavailable; },
    async ensure(accountId) {
      engine.ensured.push(accountId);
      return key;
    },
  });
  globalThis.BinderCrypto = Object.freeze({
    async decrypt(blob, withKey) {
      engine.decrypted.push({ blob, withKey });
      if (opens.indexOf(blob) === -1) {
        throw new Error("none of this row's recipient blocks opened " +
          "with this key");
      }
      return {
        submittedAt: "2026-07-0" + (opens.indexOf(blob) + 1) +
          "T00:00:00.000Z",
        telegram: "member",
        weight: { kg: 90 + opens.indexOf(blob), lb: 198 },
        height: { cm: 175, totalInches: 68.9, feet: 5, inches: 8.9 },
        entered: { units: "metric", weight: "90", height: "175" },
        gender: "man", roles: ["gainer"], country: "US", over18: true,
        record: 1,
      };
    },
  });
  globalThis.BinderDashboard = Object.freeze({
    DEFAULT_UNITS: "imperial",
    renderAnswer(container, answer, caption) {
      engine.drawn.push({ container, answer, caption });
    },
  });
  globalThis.BinderQuery = Object.freeze({
    SPLITS: Object.freeze({
      gender: { kind: "categorical" }, country: { kind: "categorical" },
      roles: { kind: "categorical" }, bmi: { kind: "bins" },
      weight: { kind: "bins" }, height: { kind: "bins" },
    }),
    /*
     * The snapshot is shaped like the one apps/web/dashboard.js really
     * builds under `identify: true` - the members the page is supposed
     * to drop as well as the one it keeps. A stub handing back only
     * `bases` could not tell a page that scrubs from a page that never
     * had anything to scrub, which is the whole of what the arm below
     * asks.
     */
    personalSource(entries, now) {
      const source = {
        personal: true, entries: entries, now: now,
        /*
         * THE REAL ENGINE'S MEMBER SET, read off a live
         * BinderQuery.personalSource in a browser rather than guessed.
         * A stub carrying fewer members than dashboard.js really builds
         * would let the arm below assert a smaller surviving set than
         * the page actually retains - which is the stub agreeing with
         * this file instead of with the site, and it is how the first
         * draft of that arm was wrong.
         */
        snapshot: {
          snapshot: 3,
          identified: true,
          generated: "2026-08-09T00:00:00.000Z",
          counts: { entries: entries.length, people: 1 },
          series: [{ label: "@member", points: [{ at: 1, kg: 90 }] }],
          seriesWithheld: false,
          quality: { heightChanges: [], handleChanges: [{ was: "@old" }] },
          bases: { people: {}, entries: {} },
          movement: { kg: 1 },
        },
      };
      engine.sources.push(source);
      return source;
    },
    run(source, query) {
      engine.queries.push({ source, query });
      return { available: true, kind: "bins", cells: [], floor: 0 };
    },
    // Records the object it was handed, not just its words. What has to
    // hold is that the caption and the answer describe ONE question -
    // the identity, not a string this file could keep agreeing with.
    describe(query) {
      engine.described.push(query);
      return "described " + query.split;
    },
  });
  return engine;
}

let scenario = 0;
async function loadSubmit({ member = MEMBER, replies = [], prefill,
  history } = {}) {
  const engine = engineStubs(history);
  const page = makePage();
  const requests = [];
  const bootErrors = [];

  Session.clear();
  if (member) Session.write(member);
  localValues.clear();
  if (prefill !== undefined) localValues.set(PREFILL_KEY, prefill);
  redirects.length = 0;
  location.pathname = "/your-page.html";

  globalThis.document = page.document;
  globalThis.BINDER_CONFIG = { endpoint: "https://worker.example" };
  globalThis.BinderUI = {
    byId(id) { return page.elements[id] || null; },
    show(element, visible) { if (element) element.hidden = !visible; },
    // ui.js's own body, over this page's groups. Written out rather
    // than returned from a fixed value because two of the arms below
    // turn on a member CHANGING a radio: a stub answering a constant
    // would let the page read a control it then ignores.
    checkedValue(name, fallback) {
      const chosen = Array.prototype.slice.call(
        page.document.querySelectorAll('input[name="' + name + '"]'))
        .filter((input) => input.checked)[0];
      return chosen ? chosen.value : fallback;
    },
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
  /*
   * In the page's own order: signout.js before submit.js, because
   * your-page.html loads them that way and submit.js reads the prefill key
   * off BinderSignOut at module scope. Loading them the other way round
   * here would test an arrangement the site does not ship, and would
   * fail for a reason no page can produce.
   */
  await import("data:text/javascript," + encodeURIComponent(signOutSource) +
    "#binder-signout-" + scenario);
  await import("data:text/javascript," + encodeURIComponent(submitSource) +
    "#submit-panel-" + scenario);
  // Two turns rather than one. The panel awaits /me, then the listing,
  // then decrypts row by row - so a single microtask drain settles the
  // account card and leaves the history half-open, which would read as
  // a personal arm that never runs.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return { ...page, requests, bootErrors, engine };
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
  "add-entry-pane", "member-entry-count", "member-last-at",
  "member-telegram-id-line", "member-telegram-id",
  "member-corrections-line", "member-corrections",
];
check("your-page.html declares the panel controls and loads its shipped module",
  panelIds.every((id) => submitHtml.includes(`id="${id}"`)) &&
  /src="submit\.js"/.test(submitHtml));

/*
 * The session home is in the rail now, and this page has to declare it
 * and load the file that wires it - #73. Both halves, because either
 * one alone is a Sign out that does nothing: markup with no module is a
 * dead button, and a module with no markup is a page whose rail cannot
 * end a session.
 */
check("your-page.html carries the rail's session home and loads signout.js",
  submitHtml.includes('id="sign-out"') &&
  submitHtml.includes('id="sign-in"') &&
  submitHtml.includes('id="session-who"') &&
  /src="signout\.js"/.test(submitHtml));

/* Load order, pinned because it is invisible until it breaks: the
 * revoke reads BINDER_CONFIG.endpoint, and submit.js reads the prefill
 * key off BinderSignOut while its module body runs. */
check("your-page.html loads signout.js after config.js and before submit.js",
  submitHtml.indexOf('src="config.js"') <
    submitHtml.indexOf('src="signout.js"') &&
  submitHtml.indexOf('src="signout.js"') <
    submitHtml.indexOf('src="submit.js"'));

/*
 * The relocation, asserted where somebody would put it back. The tab
 * strip is a tablist, and a third control in it that is not a tab is
 * what the rail took away - a plain button inside role="tablist" is
 * announced as a tab, so Sign out sitting there tells a screen-reader
 * user there are three panes.
 *
 * Read as "every control in the strip is a tab" rather than by naming
 * the classes the strip happens to wear. A regex pinned to the wrapper
 * markup fails when the strip is restyled and passes when a second
 * button is added beside the tabs, which is both directions the wrong
 * way round.
 */
/* Void elements close themselves, so they never open a level. Without
 * this list an <input> or an <img> in the strip would push everything
 * after it a level deeper and out of sight of the count below. */
const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr",
  "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

/*
 * The strip's element children, which is not the same list as its
 * buttons. Collecting <button> only made "tabs and nothing else" a
 * claim about the buttons present rather than about everything present:
 * a <span> or an <a> dropped in beside the tabs is still announced
 * inside role="tablist", which is the whole hazard, and it was invisible
 * here. Depth is tracked because an element nested inside a tab is not
 * a child of the strip and must not be counted as a third control.
 */
function elementChildren(html) {
  const children = [];
  const tag = /<(\/?)([a-z][\w-]*)\b[^>]*?(\/?)>/gi;
  let depth = 0;
  let match;
  while ((match = tag.exec(html)) !== null) {
    const [whole, closing, name, selfClosing] = match;
    if (closing) {
      depth -= 1;
      continue;
    }
    if (depth === 0) children.push(whole);
    if (!selfClosing && !VOID_ELEMENTS.has(name.toLowerCase())) depth += 1;
  }
  return children;
}

check("an element nested inside a tab is not a second control",
  elementChildren(
    '<button role="tab"><span>Entries</span></button><span>Sign out</span>'
  ).length === 2);

const tabStrip = submitHtml.match(/<div[^>]*role="tablist"[^>]*>([\s\S]*?)<\/div>/);
const stripControls = tabStrip ? elementChildren(tabStrip[1]) : [];
check("the tab strip holds tabs and nothing else",
  tabStrip !== null && stripControls.length === 2 &&
  stripControls.every((control) =>
    /^<button\b/i.test(control) && /role="tab"/.test(control)) &&
  !/id="sign-out"/.test(tabStrip[1]));

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
 * #193. GET /me reports corrected rows BESIDE the effective count
 * rather than subtracting them in silence, because a count that does
 * not move looks the same whether a correction landed or was refused -
 * server/worker.js says so at length above handleMe. The panel drew
 * `entries` and nothing else, so the second number arrived and no
 * screen carried it: a member who corrected a mistake watched their
 * count shrink with nothing on the page accounting for the difference.
 *
 * What is asserted is that the number PAINTS. `textContent` alone
 * would pass on a line written into a permanently hidden element,
 * which is the same amount of use to that member as not writing it -
 * the trap the Telegram-id check above names in the same words.
 *
 * The staging is the demo console's supersede scenario exactly - four
 * standing, two corrected - so the browser walk-through and this file
 * are looking at the same screen.
 */
const corrected = await loadSubmit({
  replies: [response(200, {
    ok: true, entries: 4, superseded: 2, lastAt,
  })],
});
check("a member who corrected rows reads the corrections beside the count",
  corrected.elements["member-entry-count"].textContent === "4" &&
  corrected.elements["member-corrections"].textContent === "2 corrections" &&
  isPainted(corrected.elements["member-corrections-line"]));

/*
 * Singular, because the line is a sentence a member reads and "1
 * corrections" is the tell of a number pasted into prose. Pinned
 * rather than left to review: the plural is correct for every count
 * this staging happens to use, so nothing else in this file would
 * ever go red for it.
 */
const oneCorrection = await loadSubmit({
  replies: [response(200, { ok: true, entries: 3, superseded: 1, lastAt })],
});
check("one corrected row is announced as one correction, not one corrections",
  oneCorrection.elements["member-corrections"].textContent === "1 correction" &&
  isPainted(oneCorrection.elements["member-corrections-line"]));

/*
 * And the absent case, which is most members on most days. A line
 * reading "0 corrections" is noise on a panel whose whole job is to be
 * the one place a member trusts about their own rows - it invites the
 * question of what a correction is from somebody who has never made
 * one. Both halves: hidden AND empty, because a hidden element still
 * holding "0 corrections" is one CSS change away from painting it.
 */
const uncorrected = await loadSubmit({
  replies: [response(200, { ok: true, entries: 4, superseded: 0, lastAt })],
});
check("a member with nothing corrected is told nothing, not told zero",
  // The count is asserted alongside so that a render which never ran
  // cannot satisfy this: the stub starts hidden and empty, so "hidden
  // and empty" is also what a dead panel looks like.
  uncorrected.elements["member-entry-count"].textContent === "4" &&
  !isPainted(uncorrected.elements["member-corrections-line"]) &&
  uncorrected.elements["member-corrections"].textContent === "");

/*
 * A summary that carries no such field at all, which is what an older
 * Worker answers. The panel degrades to the line it drew before this
 * change rather than throwing: a page that refuses to render its count
 * because a second number is missing turns a route it cannot control
 * into a dead panel, and the count is the part the member came for.
 * `panel` above is that response - its stub body names no `superseded`.
 */
check("a summary with no corrections field paints a count and no line",
  panel.elements["member-entry-count"].textContent === "41" &&
  !isPainted(panel.elements["member-corrections-line"]) &&
  panel.elements["member-corrections"].textContent === "");

/*
 * The register, asserted on what a member can actually read. `superseded`
 * is the column's name and `tombstone` is the design's word for the row
 * it leaves; both are how this repository talks to itself, and neither
 * is how the product talks to the person who fixed a typo - UAT A5 and
 * the demo console both say "correction". Comments are stripped first
 * because they are where those two words BELONG on this page: they name
 * the field the render reads, and a check that forbade them there would
 * push the explanation out of the file that needs it.
 */
const visibleMarkup = submitHtml.replace(/<!--[\s\S]*?-->/g, "");
check("the panel speaks of corrections, never of superseding or tombstones",
  /\bcorrection/i.test(visibleMarkup) &&
  !/superseded|tombstone/i.test(visibleMarkup));

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
 * The session home's two states, both directions (#187). The door and
 * the exit trade places: markup ships the Sign in route visible and the
 * Sign out button hidden, and a confirmed session is what swaps them.
 * Asserting only the signed-in half would pass on a page that hides the
 * door unconditionally - which strands the signed-out member the route
 * exists for, exactly the failure the stranding arm in
 * tools/check_web.py refuses at the markup level.
 */
check("a confirmed session hides the door and reveals the exit",
  panel.elements["sign-in"].hidden === true &&
  panel.elements["sign-out"].hidden === false);

const doorless = await loadSubmit({ member: null });
check("with no session the rail offers the door and no exit",
  doorless.elements["sign-in"].hidden === false &&
  doorless.elements["sign-out"].hidden === true);

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
/*
 * A source-position check, and the substring it looks for stops at the
 * event name rather than at the closing parenthesis. The announcement
 * carries the accepted height for the guard (#172), and `detail` is a
 * getter with no setter on CustomEvent.prototype - so a payload can only
 * arrive through the constructor's init argument, and no dispatch that
 * carries one can be spelled `new CustomEvent("binder:submitted")`.
 * Pinning the exact call shape would make this check fail for the arity
 * of a call rather than for the property it is about, which is where the
 * announcement stands relative to the response guard.
 */
const STORED_DISPATCH = `new CustomEvent("${SUBMITTED_EVENT}"`;
check("form.js announces success only after the Worker stores the entry",
  formSource.includes(STORED_DISPATCH) &&
  formSource.indexOf(STORED_DISPATCH) >
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
check("choosing Weigh in announces that the form is on screen",
  tabs.document.dispatchedHere.includes(ADD_ENTRY_SHOWN_EVENT));
await tabs.elements["your-entries-tab"].dispatch("click");
check("switching back never leaves both panes painted",
  isPainted(tabs.elements["your-entries-pane"]) &&
  !isPainted(tabs.elements["add-entry-pane"]));
check("choosing On record announces nothing about the form",
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

/* ------------------------------------------------------------------ */
/*
 * #172. The form remembers the person filling it - on this browser and
 * nowhere else.
 *
 * The store the arms above describe is the one this extends: same key,
 * same account scoping, same erase-on-rejection. What is new is what
 * rides in it. The optional fields are the ones a returning member
 * re-enters unchanged every week; the 18+ bit is a fact about a person
 * rather than a measurement; and `lastHeightCm` is the only value here
 * that is not a draft, because it moves when the Worker accepts a row
 * and at no other time.
 *
 * That last distinction is the one worth stating, because getting it
 * wrong produces a guard that passes every test and catches nothing: a
 * baseline written on every keystroke is a baseline the entry is
 * compared against itself.
 */
const rememberedEntry = JSON.stringify({
  accountId: ACCOUNT,
  units: "metric",
  weightLb: "", heightFeet: "", heightInches: "",
  weightKg: "104", heightCm: "175.3",
  gender: "female",
  country: "GB",
  roles: ["feedee", "gainer"],
  over18: true,
  lastHeightCm: 175.3,
});

const carried = await loadSubmit({
  prefill: rememberedEntry,
  replies: [mine()],
});
check("the optional fields carry forward from the last entry here",
  carried.elements.gender.value === "female" &&
  carried.elements.country.value === "GB");
check("and so do the affiliations, exactly the ones that were chosen",
  carried.roles.filter((input) => input.checked).map((input) => input.value)
    .join(",") === "feedee,gainer");
check("the 18+ confirmation is remembered rather than asked again",
  carried.elements.over18.checked === true);
check("and the page says why that box is ticked",
  isPainted(carried.elements["over18-remembered"]));
check("the note about what was carried forward is shown",
  isPainted(carried.elements["prefill-note"]));

/*
 * The other direction, and the one the owner's ruling turns on. A device
 * that has never submitted here has nothing to say, so it says nothing:
 * no ticked box, no note claiming a memory, and - asserted in the wiring
 * suite - no height guard at all.
 */
const firstVisit = await loadSubmit({ replies: [mine()] });
check("a device with nothing remembered ticks no box for the member",
  firstVisit.elements.over18.checked === false);
check("and shows no note claiming this browser remembers anything",
  !isPainted(firstVisit.elements["prefill-note"]) &&
  !isPainted(firstVisit.elements["over18-remembered"]));

/*
 * The third state, between the two above, and the one the two of them
 * cannot see between them: this member's own remembered entry, with the
 * 18+ bit not in it.
 *
 * Found by mutation - `show($("over18-remembered"), over18)` hard-wired
 * to `true` passed every other arm in this file. The arms above exercise
 * a record with the bit set and no record at all, and a device with no
 * memory never reaches the reveal, so nothing asked what happens when
 * the record is real and the bit is not.
 *
 * It matters because of what that line says: "Remembered from your last
 * entry on this browser." Printed under a box nothing ticked, it is an
 * invented memory sitting on the one assertion this form still asks a
 * member to make - and a member who reads it and presses on has been
 * told their age was confirmed by a device that never confirmed it. The
 * note above it is a different question and stays shown, because there
 * genuinely is a remembered entry to explain.
 */
const partlyRemembered = await loadSubmit({
  prefill: JSON.stringify({
    ...JSON.parse(rememberedEntry), over18: false,
  }),
  replies: [mine()],
});
check("a remembered entry without the 18+ bit ticks nothing",
  partlyRemembered.elements.over18.checked === false);
check("and explains no confirmation it did not make",
  !isPainted(partlyRemembered.elements["over18-remembered"]) &&
  isPainted(partlyRemembered.elements["prefill-note"]));

/*
 * The leak #56 was filed for, re-asked for the fields #172 adds. Gender,
 * country and affiliations are precisely the fields the encryption
 * exists to protect - shape C was rejected on sight for putting them in
 * the clear on the server - so a shared browser handing them to the next
 * member is the same exposure in a different place.
 */
const notMine = await loadSubmit({
  prefill: rememberedEntry,
  replies: [mine({ accountId: OTHER_ACCOUNT })],
});
check("another account's optional fields are not shown to whoever signs in",
  notMine.elements.gender.value === "" &&
  notMine.elements.country.value === "" &&
  notMine.roles.every((input) => input.checked === false) &&
  notMine.elements.over18.checked === false);
check("and their 18+ bit is not confirmed on their behalf",
  !isPainted(notMine.elements["over18-remembered"]) &&
  !localValues.has(PREFILL_KEY));

/* Writing them. A select and a checkbox change rather than take input,
 * so the listener is a different event from the measurement boxes' - and
 * a slice that wired only `input` would restore these forever without
 * ever recording a change to them. */
const writingChoices = await loadSubmit({ replies: [mine()] });
writingChoices.elements.gender.value = "nonbinary";
writingChoices.elements.country.value = "CA";
writingChoices.roles[0].checked = true;
writingChoices.elements.over18.checked = true;
await writingChoices.elements.gender.dispatch("change");
let savedChoices = null;
try { savedChoices = JSON.parse(localValues.get(PREFILL_KEY)); }
catch { /* a missing or malformed stored value is a failed check below */ }
check("changing an optional field records it for the next entry",
  savedChoices && savedChoices.gender === "nonbinary" &&
  savedChoices.country === "CA" &&
  JSON.stringify(savedChoices.roles) === JSON.stringify(["feeder"]));
check("and the 18+ bit is recorded with them",
  savedChoices && savedChoices.over18 === true);

/*
 * The baseline, and its one write path. form.js announces the height
 * that was accepted on the event that says a row was stored, because
 * this file cannot read that form's boxes and must not guess.
 */
const baseline = await loadSubmit({ replies: [mine(), mine({ entries: 2 })] });
await baseline.document.dispatch(SUBMITTED_EVENT, { heightCm: 177.8 });
let savedBaseline = null;
try { savedBaseline = JSON.parse(localValues.get(PREFILL_KEY)); }
catch { /* a missing or malformed stored value is a failed check below */ }
check("a stored row moves the remembered height",
  savedBaseline && savedBaseline.lastHeightCm === 177.8);
check("and the guard is told about it without waiting for a reload",
  baseline.document.eventsHere.some((event) =>
    event && event.type === "binder:height-baseline" &&
    event.detail && event.detail.lastHeightCm === 177.8));

/*
 * WHAT RIDES ON binder:account, asserted as the whole key set rather
 * than as the absence of whichever field worries us today.
 *
 * A `document` CustomEvent is a WIDER surface than this module's own
 * scope, and that is the reason the arm exists. An extension content
 * script running in an isolated world cannot read a closure in this
 * file, and it can listen on `document` - so every member added to this
 * payload is published to whatever the member has installed. The id is
 * the one thing form.js needs, because it is what memberkey.js files a
 * key under; the handle and the Telegram id this module also holds are
 * not, and nothing structural keeps them off the event.
 *
 * Compared as the sorted key set so a field cannot arrive quietly: the
 * mutation this reddens on is `telegramId` riding along beside the id,
 * which passed the whole gate when the #85 review tried it.
 */
const announced = baseline.document.eventsHere.filter((event) =>
  event && event.type === "binder:account");

check("form.js is told whose account this is, on every /me that answers",
  announced.length === 2 &&
  announced.every((event) => event.detail.accountId === ACCOUNT));

check("and the announcement carries the account id and nothing else",
  announced.length > 0 && announced.every((event) =>
    Object.keys(event.detail).slice().sort().join(",") === "accountId"));

/* Typing does not move it. This is the check that fails on the obvious
 * wrong implementation - saving the baseline beside the draft - and the
 * one that keeps the guard from comparing an entry against itself. */
const typing = await loadSubmit({
  prefill: rememberedEntry,
  replies: [mine()],
});
typing.elements["height-cm"].value = "91.4";
await typing.elements["height-cm"].dispatch("input");
let afterTyping = null;
try { afterTyping = JSON.parse(localValues.get(PREFILL_KEY)); }
catch { /* a missing or malformed stored value is a failed check below */ }
check("typing a new height does not move what it will be compared against",
  afterTyping && afterTyping.heightCm === "91.4" &&
  afterTyping.lastHeightCm === 175.3);

/* And the baseline reaches the guard on an ordinary load, which is the
 * only way a member who last submitted in a previous tab gets one. */
check("a remembered height is announced to the guard at startup",
  carried.document.eventsHere.some((event) =>
    event && event.type === "binder:height-baseline" &&
    event.detail && event.detail.lastHeightCm === 175.3));

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

/*
 * #172, and the reason this is its own arm rather than covered by the
 * one above. The record now holds gender, country, affiliations and an
 * age confirmation as well as measurements, and the erase is one
 * removeItem on one key - so the check that matters is not that the
 * erase still runs but that nothing was moved out from under it. A
 * second key, a second store, a field kept "because it is only a
 * boolean", and Sign out silently stops meaning what AGENTS.md says it
 * means: this device retains neither the session nor the body data.
 *
 * Asserted from a record that has every field in it, and asserted as
 * "the whole store is gone" rather than field by field, because a
 * field-by-field check is one somebody adding a field forgets to
 * extend.
 */
const signingOutFull = await loadSubmit({
  prefill: rememberedEntry,
  replies: [mine(), response(200, { ok: true })],
});
let beforeSignOut = null;
try { beforeSignOut = JSON.parse(localValues.get(PREFILL_KEY)); }
catch { /* an unreadable store is a failed check here */ }
check("the remembered entry is readable before the member signs out",
  Boolean(beforeSignOut) && beforeSignOut.gender === "female" &&
  beforeSignOut.over18 === true && beforeSignOut.lastHeightCm === 175.3 &&
  signingOutFull.elements.gender.value === "female");
await signingOutFull.elements["sign-out"].dispatch("click");
check("and signing out leaves nothing of it on the device",
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
    constructor(type, init) { this.type = type; this.detail = init && init.detail; }
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

/* ------------------------------------------------------------------ */
/* Your own history, opened in this browser - #85's personal arm.      */

const MINE = "a".repeat(64);
const SUMMARY = { ok: true, entries: 2, superseded: 0,
  lastAt: "2026-07-02T00:00:00.000Z", accountId: MINE };
const listing = (entries) => response(200, { ok: true, entries: entries });
const row = (id, ciphertext) => ({ id: id, receivedAt:
  "2026-07-0" + id + "T00:00:00.000Z", superseded: false,
ciphertext: ciphertext });

check("your-page.html declares the history card and loads what opens it",
  ['id="your-history"', 'id="history-status"', 'id="history-controls"',
    'id="h-split"', 'id="history-answer"', 'id="history-sealed"']
    .every((id) => submitHtml.includes(id)) &&
  /src="memberkey\.js"/.test(submitHtml) &&
  /src="query\.js"/.test(submitHtml) &&
  /src="dashboard\.js"/.test(submitHtml));

/*
 * Load order, which is not a preference. query.js reads the suppression
 * floor and the snapshot builder out of BinderDashboard as it runs and
 * says so in its own header, and submit.js asks memberkey.js for a key
 * while painting the panel - so each of the three has to be behind its
 * own dependency and ahead of its caller. The failure is silent in every
 * direction: a namespace captured too early is undefined, and these
 * modules guard on the captured value.
 */
check("the history's modules load in the order their dependencies need",
  submitHtml.indexOf('src="dashboard.js"') <
    submitHtml.indexOf('src="query.js"') &&
  submitHtml.indexOf('src="memberkey.js"') <
    submitHtml.indexOf('src="submit.js"') &&
  submitHtml.indexOf('src="crypto.js"') <
    submitHtml.indexOf('src="memberkey.js"'));

/*
 * The page's splits against the engine's, both directions, the way
 * dev/public.test.mjs pins the published card's. One direction catches
 * an option the engine cannot answer; the other catches a question the
 * engine grew that this page silently stopped offering.
 */
const offered = [...submitHtml.matchAll(
  /<select id="h-split">([\s\S]*?)<\/select>/g)]
  .flatMap((block) => [...block[1].matchAll(/value="(\w+)"/g)]
    .map((one) => one[1]));
/* From the SHIPPED engine, not the stub. A page pinned against a stub
 * agrees with this file rather than with apps/web/query.js, which is
 * the drift this arm exists to catch. */
const engineSource = await readFile(
  new URL("../apps/web/query.js", import.meta.url), "utf8");
const known = [...engineSource.matchAll(
  /^\s{4}(\w+): Object\.freeze\(\{ kind:/gm)].map((one) => one[1]);

check("every split the pane offers is one the engine answers, and back",
  offered.length === 6 && known.length === 6 &&
  offered.slice().sort().join(",") === known.slice().sort().join(","));

const opened = await loadSubmit({
  replies: [response(200, SUMMARY), listing([row(1, "one"), row(2, "two")])],
  history: { opens: ["one", "two"] },
});

check("the listing is fetched with the session, from the member's own route",
  opened.requests.length === 2 &&
  opened.requests[1].url === "https://worker.example/my-entries" &&
  authorization(opened.requests[1]) === "Bearer member-session-token");

check("the key is asked for by the account id /me validated",
  opened.engine.ensured.length === 1 &&
  opened.engine.ensured[0] === MINE);

/*
 * THE BOUNDARY FROM THE SIDE THAT MAY CROSS IT. dev/public.test.mjs
 * counts calls to personalSource to prove charts.html never reaches
 * it; this counts them to prove this page reaches it exactly once, with
 * exactly the rows that opened. A source built per question would
 * decrypt again on every keystroke, and a source built from the raw
 * listing would be a history over rows nobody read.
 */
check("one personal source is built, from the opened records",
  opened.engine.sources.length === 1 &&
  opened.engine.sources[0].entries.length === 2 &&
  opened.engine.sources[0].entries.every((entry) =>
    entry.accountId === MINE && typeof entry.kg === "number"));

check("and every row was tried against the device key, not the key file",
  opened.engine.decrypted.length === 2 &&
  opened.engine.decrypted.every((one) => one.withKey === "device-key"));

/*
 * The basis is not a control and must not become one. "How many people"
 * over one person's own rows is one person, and the answer to a question
 * with one possible answer is not a question. Read off the query that
 * reached the engine rather than off the markup, because a control that
 * is absent and a value that arrives are different claims.
 */
check("every question asks about entries, never about people",
  opened.engine.queries.length > 0 &&
  opened.engine.queries.every((one) => one.query.basis === "entries"));

check("and asks it of the personal source, never of anything else",
  opened.engine.queries.every((one) => one.source.personal === true));

check("the answer is drawn into the card's own container",
  opened.engine.drawn.length === 1 &&
  opened.engine.drawn[0].container ===
    opened.elements["history-answer"] &&
  opened.engine.drawn[0].caption === "described weight");

check("the controls are revealed only once there is something to ask about",
  isPainted(opened.elements["your-history"]) &&
  isPainted(opened.elements["history-controls"]));

check("nothing is said about rows sealed elsewhere when there are none",
  !isPainted(opened.elements["history-sealed"]) &&
  !isPainted(opened.elements["history-status"]));

/*
 * The units the answer is drawn in come from the form's own radio group,
 * which is this page's single unit control. Asserted through the engine
 * rather than through the DOM: what matters is the value that reached
 * the query, and a page reading a control it then ignores would pass any
 * check that only looked at the control.
 */
const metric = await loadSubmit({
  replies: [response(200, SUMMARY), listing([row(1, "one")])],
  history: { opens: ["one"] },
});
metric.units[0].checked = false;
metric.units[1].checked = true;
await metric.elements["h-split"].dispatch("change");

check("the answer follows the form's units rather than a second control",
  metric.engine.queries.length === 2 &&
  metric.engine.queries[0].query.units === "imperial" &&
  metric.engine.queries[1].query.units === "metric");

/*
 * The caption describes the question that was ASKED, and the identity is
 * what is asserted rather than the words.
 *
 * Found in a browser: a caption built from a second literal read
 * "(imperial)" over a chart drawn in metric, because `describe`
 * normalizes an absent `units` exactly as `run` does and neither can
 * know the other was handed something else. Comparing the strings would
 * pin today's wording; comparing the object pins that there is only one
 * question, which is the property that cannot drift.
 */
check("the caption describes the same query object the answer came from",
  metric.engine.described.length === 2 &&
  metric.engine.described.every((one, index) =>
    one === metric.engine.queries[index].query) &&
  metric.engine.described[1].units === "metric");

/*
 * A row that will not open is COUNTED and named, never dropped. The
 * ordinary cause is a row sealed before this browser had a key of its
 * own, which is every row stored before #85 - so this is the state most
 * members are in on their first visit, not an edge case. An answer
 * quietly computed over fewer rows than a member has is one they cannot
 * tell from a correct one.
 */
const partly = await loadSubmit({
  replies: [response(200, SUMMARY),
    listing([row(1, "one"), row(2, "elsewhere"), row(3, "also-elsewhere")])],
  history: { opens: ["one"] },
});

check("rows this browser cannot open are counted rather than dropped",
  isPainted(partly.elements["history-sealed"]) &&
  partly.elements["history-sealed-count"].textContent === "2" &&
  partly.engine.sources[0].entries.length === 1);

const noneOpen = await loadSubmit({
  replies: [response(200, SUMMARY), listing([row(1, "elsewhere")])],
  history: { opens: [] },
});

check("a history sealed entirely elsewhere is explained, not left blank",
  isPainted(noneOpen.elements["your-history"]) &&
  !isPainted(noneOpen.elements["history-controls"]) &&
  noneOpen.engine.sources.length === 0 &&
  /None of your entries can be opened on this browser/.test(
    noneOpen.elements["history-status"].textContent));

/*
 * THE CAUSE A MEMBER CANNOT POSSIBLY DEDUCE, pinned so the copy cannot
 * fall back to blaming a device.
 *
 * #85's seal widens to an account this module announces once /me
 * answers, and nothing gates Send on that answer - deliberately, since
 * blocking a submission on a request that may never return is the worse
 * failure. So an entry sent in the first moments of a slow load is
 * keyholder-only for good, on a browser holding a perfectly good key.
 * A sentence listing only devices blames the member's hardware for the
 * page's own timing.
 *
 * The MECHANISM is no longer spelled out on screen - #265's copy pass
 * (row 17, owner-ruled) collapsed four mechanisms into two causes a
 * member can act on, because all four printed at once, twice, in four
 * lines. What survives is the property the arm was written for: the
 * sentence must name a cause that happened on THIS browser as well as
 * one that happened elsewhere. "Sealed before it had a key of its own"
 * is the timing case in the member's terms - the row was sealed at a
 * moment this browser's key was not there to seal to - and it is what
 * this now pins, in both halves, so a rewrite back to a devices-only
 * sentence still fails here.
 */
check("and the cause on this browser is named, not only the devices",
  /before it had a key of its own/.test(
    noneOpen.elements["history-status"].textContent) &&
  /on another device/.test(
    noneOpen.elements["history-status"].textContent));

/*
 * And the partial line does not print underneath it - #265 row 17.
 *
 * Both sentences fired together before that: the four-cause line saying
 * nothing opened, and immediately below it "n sealed to a device this
 * browser is not - they are not in the answer above", claiming rows are
 * missing from an answer that was never drawn. The controls stay hidden
 * on this path, so there is no answer above for anything to be absent
 * from.
 */
check("nothing opened says so once, with no partial line under it",
  !isPainted(noneOpen.elements["history-sealed"]));

const noKey = await loadSubmit({
  replies: [response(200, SUMMARY), listing([row(1, "one")])],
  // The reason memberkey.js actually returns, word for word - a stub
  // that reads like the product string and is not it is a fixture that
  // lies to the next reader (#265 row 5 moved the real one off
  // "database").
  history: {
    key: null,
    unavailable: "It has nowhere to keep one that would last past this tab.",
  },
});

/*
 * A browser that cannot keep a key says so and stops - it does not fetch
 * the rows. Fetching them would download a member's whole sealed history
 * into a tab that provably cannot open a byte of it, which is transfer
 * and exposure bought for nothing.
 */
check("a browser with no key of its own asks the route for nothing",
  noKey.requests.length === 1 &&
  isPainted(noKey.elements["your-history"]) &&
  !isPainted(noKey.elements["history-controls"]) &&
  /nowhere to keep one/.test(noKey.elements["history-status"].textContent));

const noRows = await loadSubmit({
  replies: [response(200, { ok: true, entries: 0, superseded: 0,
    lastAt: null, accountId: MINE }), listing([])],
  history: { opens: [] },
});

check("a member with no entries is invited rather than told nothing",
  noRows.engine.sources.length === 0 &&
  /no entries yet/.test(noRows.elements["history-status"].textContent));

/*
 * A refused credential ends the tab's session here exactly as it does on
 * the account summary above. Two routes answering 401 differently would
 * be one page holding two opinions about whether it is still signed in.
 */
const gone = await loadSubmit({
  replies: [response(200, SUMMARY), response(401, { error: "no" })],
  history: { opens: [] },
});

check("a 401 from the listing clears the session and leaves the page",
  redirects.includes("index.html") && Session.read() === null &&
  gone.engine.sources.length === 0);

/*
 * And the failure that is not the member's session: the route is there,
 * the answer is not usable. The card says so rather than drawing an
 * empty chart, because an empty chart is a claim - that the answer is
 * nothing - and it is a different one from "this did not arrive".
 */
const broken = await loadSubmit({
  replies: [response(200, SUMMARY), response(200, { ok: true })],
  history: { opens: [] },
});

check("a listing the page cannot read is reported, not drawn as empty",
  broken.engine.drawn.length === 0 &&
  broken.elements["history-status"].className === "status bad" &&
  /could not be fetched/.test(
    broken.elements["history-status"].textContent));

/*
 * Nothing decrypted survives the frame that opened it. The rule is
 * DESIGN.md's positional one read at the smallest scale: plaintext
 * exists where it must and nowhere else. A module-level cache would
 * outlive the sign-out meant to end it, and a write to either store
 * would put a member's whole history where the prefill's own erasure
 * reasoning says nothing may sit.
 */
const historyCode = submitSource.replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

/*
 * WHAT SURVIVES THE FRAME THAT DECRYPTED THE ROWS, asserted as a key set
 * rather than as the absence of the members that happen to worry us
 * today.
 *
 * Every control's handler closes over the source, so the source is what
 * lives for the tab. `personalSource` builds its snapshot with
 * `identify: true`, which is the keyholder's setting: it fills in a
 * per-person series whose points are unquantized and whose label is a
 * handle, plus a data-quality panel listing a member's own measurement
 * disagreements. `run` reads exactly one member of that document -
 * `bases[basis]` - so everything else is retained plaintext with no
 * reader.
 *
 * The key set is compared whole so a future field cannot arrive and be
 * retained silently; checking only that `quality` is gone would say
 * nothing about the next one.
 */
check("only the partitions the chart is drawn from survive",
  opened.engine.sources.length === 1 &&
  Object.keys(opened.engine.sources[0].snapshot).slice().sort().join(",") ===
    ["bases", "generated", "identified", "seriesWithheld", "snapshot"]
      .join(","));

/*
 * The four that stay beside `bases`, named so the arm above is read as
 * a decision rather than as whatever happened to be left. `snapshot` is
 * a version integer, `identified` a boolean, `seriesWithheld` a
 * boolean, `generated` the timestamp of the build. None of them is
 * decrypted content or derived from any one row, which is the test the
 * scrub applies - the deleted members are the ones that carry a
 * member's own measurements, handle or history forward.
 */
check("and none of what stays came out of a decrypted row",
  ["snapshot", "identified", "seriesWithheld", "generated"].every((name) => {
    const value = opened.engine.sources[0].snapshot[name];
    return value === undefined || typeof value !== "object";
  }));

check("and the handle the record carried never entered the source at all",
  opened.engine.sources[0].entries.every((entry) =>
    !("telegram" in entry)) &&
  !JSON.stringify(opened.engine.sources[0].entries).includes("browser_check"));

check("no decrypted value is written to storage or hung on the global",
  !/(localStorage|sessionStorage)[\s\S]{0,40}(record|entries|decrypt)/i
    .test(historyCode) &&
  !/root\.\w+\s*=/.test(historyCode) &&
  !/setItem\([^)]*(entry|record|history)/i.test(historyCode));

/* ------------------------------------------------------------------ */
/* Mandate 9's other two sinks, which the arm above cannot see.        */

/*
 * WHY THE ARM ABOVE IS NOT ENOUGH, said plainly because it looks like
 * it is. It matches words near each other. The #154 sweep's client
 * partition wrote two mutations that keep a member's whole decrypted
 * history alive past the frame that opened it and match none of those
 * words:
 *
 *   - a module-level `let opened = null;` assigned inside openHistory,
 *     which outlives the sign-out meant to end it and answers for
 *     whichever account asked first on a shared browser;
 *   - `if (card) card.dataset.entries = JSON.stringify(entries);`,
 *     which hangs the same content off the DOM behind a guard that
 *     always passes.
 *
 * Neither names a storage API, neither assigns to `root.`, and neither
 * calls setItem. A third regex per sink is the wrong answer - the sinks
 * are unbounded and the words are not - so these two arms ask about the
 * ACT instead: what was written to the page, and what openHistory
 * leaves behind it.
 */

check("nothing decrypted is hung on the page's own elements",
  datasetWrites.length === 0);

/*
 * And the module's own scope. This one is structural rather than
 * executed, because a value cached inside a closure is not observable
 * from outside it by any means - which is exactly what makes the sink
 * attractive and what makes the rule worth stating as a rule.
 *
 * The question asked is narrow and total: does openHistory assign to
 * ANY name that outlives it? Not "does it assign something that looks
 * like a row" - a member's history reaches a cache under whatever name
 * somebody picked, and the surviving-name list is knowable while the
 * naming is not. `account` is assigned by refreshPanel and
 * `lastHeightCm` by rememberHeight, and both are outside this function
 * on purpose; the one frame that holds plaintext writes nothing that
 * survives it.
 *
 * Comments and string literals are removed BEFORE any brace is
 * counted. dev/memberkey.test.mjs records what an unbalanced brace
 * inside a string does to a raw counter: it inflates it permanently, so
 * everything after it reads as one level deeper and a rule about depth
 * silently stops applying to the rest of the file.
 */
const stripped = submitSource
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/.*$/gm, "$1")
  .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
  .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
  .replace(/`(?:[^`\\]|\\.)*`/g, "``");

// Every name the module declares at its own top level - the ones that
// live for the tab. Depth is counted as the file is walked, so a name
// declared inside any function is not one of these.
function survivingNames(code) {
  const names = new Set();
  let depth = 0;
  for (const line of code.split("\n")) {
    if (depth === 1) {
      const declared = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(line);
      if (declared) names.add(declared[1]);
    }
    for (const character of line) {
      if (character === "{") depth += 1;
      if (character === "}") depth -= 1;
    }
  }
  return names;
}

// One function's body, by matching braces from its own opening one.
function bodyOf(code, name) {
  const at = code.indexOf("function " + name + "(");
  if (at === -1) return null;
  const start = code.indexOf("{", at);
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    if (code[i] === "{") depth += 1;
    if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  return null;
}

const surviving = survivingNames(stripped);
const openHistoryBody = bodyOf(stripped, "openHistory");

check("the module really was read - openHistory found, and names with it",
  Boolean(openHistoryBody) && surviving.has("account") &&
  surviving.has("lastHeightCm"));

check("the frame that decrypts the rows assigns nothing that outlives it",
  Boolean(openHistoryBody) && [...surviving].every((name) =>
    !new RegExp("(^|[^.\\w$])" + name + "\\s*=(?!=)").test(openHistoryBody)));

if (failures) {
  console.error(`\nsubmit panel FAILED ${failures} check(s)`);
  process.exit(1);
}
if (performed !== EXPECTED) {
  console.error(`\nsubmit panel ran ${performed} checks, expected ` +
    `${EXPECTED} - a check stopped running, or one was added without ` +
    "updating EXPECTED");
  process.exit(1);
}
console.log(`\nsubmit panel OK - ${performed} checks`);
