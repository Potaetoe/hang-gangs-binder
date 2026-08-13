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
  new URL("../apps/web/charts.html", import.meta.url), "utf8");

let failures = 0;
let ran = 0;

/*
 * A condition, or a function returning one.
 *
 * The thunk arm is not a style choice. A bare expression is evaluated
 * BEFORE check() is called, so a check that reaches into something the
 * page did not build takes the whole process down - and the first red
 * run of a contract then prints four results and a stack trace instead
 * of the twenty-odd failures it knows about. That is the shape this
 * repository has already paid for; a contract has to say everything it
 * knows on the run where nothing is implemented yet.
 */
function check(label, condition) {
  ran++;
  let ok = false;
  let note = "";
  try {
    ok = Boolean(typeof condition === "function" ? condition() : condition);
  } catch (error) {
    note = " - threw: " + (error && error.message ? error.message : error);
  }
  if (!ok) failures++;
  console.log((ok ? "pass  " : "FAIL  ") + label + note);
}

const values = new Map();
globalThis.sessionStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};

const redirects = [];
globalThis.location = {
  pathname: "/charts.html",
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
 * Pinning Date.now is the same move this file already makes for fetch,
 * document, sessionStorage and location, and it is the one the shipped
 * module can be held to: ageText takes the clock as an argument, and
 * setUp reads it once and hands it in, so nothing here needs a test-only
 * path in a file the published site is built from - which would ship in
 * dist/ as surely as in apps/web (#181).
 *
 * NOW is the instant the SNAPSHOT fixture below turns exactly 48 hours
 * old. That instant is also the one second in which the module's two
 * thresholds disagree - ageText switches to days at 2880 whole minutes,
 * while the banner wants strictly more than 48 fractional hours - so it
 * is the clock that puts the sharpest edge under the rows. Both lines are
 * asserted from both sides below; reconciling them cannot pass unnoticed.
 *
 * Every session fixture here expires in 2099, so a pinned clock in 2026
 * leaves session.js's expiry arm reading exactly as it does live.
 */
const NOW = Date.parse("2026-08-09T12:00:00.000Z");
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
Date.now = function () { return NOW; };

globalThis.document = {
  querySelector() { return null; },
};
await import("data:text/javascript," + encodeURIComponent(sessionSource));
const Session = globalThis.BinderSession;

/*
 * An element with enough DOM to be wired to.
 *
 * The question card is built rather than only read - public.js creates a
 * checkbox per published cell and hangs one listener on the card - so
 * this stub carries children, listeners and a textContent that CLEARS
 * its children when written, the way the real one does. Without that
 * last part `list.textContent = ""` would leave every rebuild stacked on
 * the last, and "the combine list is rebuilt from the answer" would pass
 * against a list that only ever grows.
 */
function makeElement(id, hidden = false) {
  const reason = { textContent: "" };
  let own = "";
  const element = {
    id,
    hidden,
    className: "",
    value: "",
    type: "",
    checked: false,
    children: [],
    listeners: {},
    appendChild(child) { element.children.push(child); return child; },
    addEventListener(name, fn) {
      (element.listeners[name] = element.listeners[name] || []).push(fn);
    },
    /* Listeners on the card itself, plus the ones a bubbling `input`
     * would reach it through. public.js relies on that bubble for the
     * merge boxes, so firing here is firing what the browser fires. */
    fire(name) {
      (element.listeners[name] || []).forEach((fn) => fn());
    },
    querySelector(selector) {
      return selector === "[data-reason]" ? reason : null;
    },
    reason,
  };
  Object.defineProperty(element, "textContent", {
    get() {
      return own + element.children.map((child) => child.textContent).join("");
    },
    set(value) { element.children.length = 0; own = String(value); },
  });
  return element;
}

const PAGE_IDS = [
  "tool", "closed", "status", "freshness", "charts",
  "question", "q-controls", "q-status", "q-split", "q-measure-field",
  "q-widen-field", "q-merge-field", "q-merge-labels", "q-merge-name",
  "answer",
];

function makePage() {
  const elements = {};
  for (const id of PAGE_IDS) {
    elements[id] = makeElement(id, id === "tool" || id === "closed" ||
      id === "question");
  }
  /* The card starts on a split the engine knows, because a <select> with
   * no value selected is a state the shipped page cannot be in - its
   * first option is selected by the browser. */
  elements["q-split"].value = "gender";
  /* The page's own Count and Units choices, which belong to the panels
     and which the question card rides along on rather than duplicating.
     Returned from the one selector public.js asks for them by. */
  const shared = [makeElement("basis-input"), makeElement("units-input")];
  return {
    elements,
    shared,
    document: {
      readyState: "complete",
      getElementById(id) { return elements[id] || null; },
      createElement(tag) { return makeElement(tag); },
      querySelector() { return null; },
      querySelectorAll(selector) {
        return /name="basis"/.test(selector) ? shared : [];
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

const SNAPSHOT = {
  snapshot: {
    generated: "2026-08-07T12:00:00.000Z",
    counts: { entries: 12, people: 10 },
    bases: { people: {}, entries: {} },
  },
};

/*
 * The shipped engine, loaded for its tables rather than stubbed.
 *
 * SPLITS, BASES and MEASURES are the contract query.js's own header calls
 * a contract, and the page's pickers are built against them. A copy of
 * those key sets written here would be a third list for the first two to
 * drift away from - so the checks below read the real ones, and the
 * page-versus-engine pin has exactly two sides.
 *
 * Loading it defines the namespace and calls nothing: query.js reaches
 * for BinderDashboard only when a source is built or a query normalized,
 * which is why this needs no dashboard.js beside it.
 */
const querySource = await readFile(
  new URL("../apps/web/query.js", import.meta.url), "utf8");
await import("data:text/javascript," + encodeURIComponent(querySource));
const Engine = globalThis.BinderQuery;

/* An answer of the shape run() returns, for the wiring checks. The
   drawing of these is dev/dashboard-render.test.mjs's job, against the
   real engine; what is asserted here is which query produced them. */
function answerOf(query, cells) {
  return {
    source: "published", basis: query.basis, split: query.split,
    units: query.units, measure: query.measure,
    kind: query.measure === "count" ? "categorical" : "stat",
    available: true, floor: 5, cells, total: 0, value: 0,
  };
}

/*
 * A refusal the way the engine actually raises one - #265 rows 14-16.
 *
 * query.js keeps its precise message, which is written for whoever is
 * holding the document, and carries a `plain` half written for whoever
 * is holding the page. The two are one claim in two registers, so a
 * fixture that could only produce the message could not tell a card
 * showing the plain half from a card showing nothing at all.
 */
function refusalOf(spec) {
  const error = new Error(typeof spec === "string" ? spec : spec.message);
  if (spec && spec.plain) error.plain = spec.plain;
  return error;
}

let scenario = 0;
async function loadPublic(session, nextResponse, options = {}) {
  const page = makePage();
  if (options.split) page.elements["q-split"].value = options.split;
  if (options.groupName) page.elements["q-merge-name"].value = options.groupName;
  const requests = [];
  const renders = [];
  const answers = [];
  const engine = {
    sources: [],
    runs: [],
    personal: 0,
    captions: [],
  };
  Session.clear();
  if (session) Session.write(session);
  redirects.length = 0;
  location.pathname = "/charts.html";

  globalThis.document = page.document;
  globalThis.BINDER_CONFIG = { endpoint: "https://worker.example" };
  globalThis.BinderUI = {
    byId(id) { return page.elements[id] || null; },
    show(element, visible) { if (element) element.hidden = !visible; },
    checkedValue(name, fallback) {
      return Object.prototype.hasOwnProperty.call(options.checked || {}, name)
        ? options.checked[name]
        : fallback;
    },
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
  /*
   * The stub carries BOTH drawing names, and only one of them records.
   *
   * dashboard.js splits its entry points by surface, and this page is
   * the member-facing one - so a `render` call from here is the page
   * drawing itself as the admin instrument, with no hero and the wrong
   * clothes. Stubbing only `renderProgress` would make that a throw,
   * which UI.boot() would turn into "this page did not start up
   * correctly" and every check below would fail for a reason none of
   * them is about. Recording only the Progress arm is what keeps the
   * render count an assertion about which surface was drawn.
   */
  globalThis.BinderDashboard = {
    DEFAULT_UNITS: "imperial",
    renderProgress(element, snapshot, basis, units) {
      renders.push({ element, snapshot, basis, units, surface: "progress" });
    },
    render(element, snapshot, basis, units) {
      renders.push({ element, snapshot, basis, units, surface: "instrument" });
    },
    renderAnswer(element, answer, caption) {
      answers.push({ element, answer, caption });
    },
  };

  /*
   * The engine, recorded rather than replayed.
   *
   * SPLITS comes from the shipped module, so a page offering a split the
   * engine does not have fails here for the reason it would fail live.
   * publishedSource hands back a marked object and personalSource COUNTS
   * ITS CALLS - the check that matters is not that the personal arm
   * behaves, it is that this page never reaches it at all.
   */
  globalThis.BinderQuery = options.noEngine ? undefined : {
    SPLITS: Engine.SPLITS,
    BASES: Engine.BASES,
    MEASURES: Engine.MEASURES,
    publishedSource(snapshot) {
      if (options.sourceRefuses) throw refusalOf(options.sourceRefuses);
      const source = { published: snapshot };
      engine.sources.push(source);
      return source;
    },
    personalSource() {
      engine.personal++;
      return { personal: true };
    },
    run(source, query) {
      engine.runs.push({ source, query });
      if (options.runThrows) throw refusalOf(options.runThrows);
      return answerOf(query, query.merge
        ? [{ label: query.merge[0].as, count: 9 }]
        : (options.cells || [{ label: "male", count: 7 },
          { label: "female", count: 5 }]));
    },
    describe(query) {
      engine.captions.push(query);
      return "asked: " + query.split;
    },
  };

  globalThis.fetch = async function (url, fetchOptions) {
    requests.push({ url, options: fetchOptions || {} });
    return nextResponse;
  };

  /*
   * The console, recorded rather than silenced.
   *
   * The engine's own words are the only explanation anybody debugging a
   * refused document gets, and #265 moved them off the member's card -
   * so where they went has to be provable, or "kept for the console" is
   * a claim nothing carries. Restored before this returns, because the
   * harness prints its own results through the real one.
   */
  const logged = [];
  const realConsole = globalThis.console;
  globalThis.console = {
    ...realConsole,
    warn(...args) { logged.push(args.join(" ")); },
  };

  scenario++;
  try {
    await import("data:text/javascript," + encodeURIComponent(publicSource) +
      "#public-session-" + scenario);
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    globalThis.console = realConsole;
  }
  return { ...page, requests, renders, answers, engine, logged };
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

/* dashboard.js draws two surfaces from one body, and which one a page
   gets is decided HERE rather than sniffed inside the module. Calling
   the instrument's entry point would silently drop the combined-weight
   hero this page exists to lead with - and a missing headline looks
   exactly like a page that has nothing to headline. */
check("this page draws itself as the member surface, not as the instrument",
  member.renders.length === 1 && member.renders[0].surface === "progress");

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

/* Who these numbers are for, said in the page's own HTML rather than by
 * a script - the audience is the one thing a visitor should not have to
 * wait to learn. The section name carries it, which is the running-head
 * role of #68's label split; "Everyone" is the wrong answer and is
 * checked for by name because it is the plausible one to reach for. */
check("the page identifies itself as a member view before scripts run",
  /<p class="runner"><span>Members<\/span><\/p>/.test(dashboardHtml) &&
  !/>Everyone</.test(dashboardHtml));

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

/* Every other days fixture here is a whole number of days, and floor and
 * round agree on those. Sixty-eight hours is the one that separates them,
 * which is the difference between a page saying two days and three. */
check("the days arm truncates rather than rounds, so 68 hours reads as two days",
  await ageLine(68 * HOUR) ===
    "Figures worked out 2 days ago (2026-08-06 16:00 UTC)." + STALE_WARNING);

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

/* ------------------------------------------------------------------ */
/* #85's question card: which source it builds, and what it can ask.   */

/*
 * THE BOUNDARY THIS SECTION EXISTS FOR. apps/web/query.js has two
 * sources. `publishedSource` reads the members-only document, every cell
 * of which was already reduced to at least MIN_CELL people before it was
 * published. `personalSource` reads ONE member's own rows and applies no
 * floor at all, because their own data is theirs.
 *
 * This page holds a published document, so it may build exactly one of
 * those and it is checked here for exactly that - by counting calls to
 * the arm it must never reach, not by asserting that the arm it does
 * reach behaves. `run` takes the floor off the SOURCE and a query has no
 * member naming a floor, so "a caller cannot ask for floor 0 over a
 * published document" is a property of the engine's shape; what this
 * page can get wrong is handing that shape the wrong document, and that
 * is what is asserted.
 */

const asking = await loadPublic(MEMBER, response(200, SNAPSHOT));

check("the question card is opened once the engine is on the page",
  asking.elements.question.hidden === false &&
  asking.elements["q-controls"].hidden === false &&
  asking.answers.length === 1);

check("the page builds the floored published source and no other",
  asking.engine.sources.length === 1 && asking.engine.personal === 0 &&
  asking.engine.sources[0].published === SNAPSHOT.snapshot &&
  asking.engine.runs.length > 0 &&
  asking.engine.runs.every((call) => call.source === asking.engine.sources[0]));

check("no query this page builds names a floor or a source",
  // The engine would ignore such a member, which is the point: if one
  // ever appears here it is somebody reaching for a lever that does not
  // exist, and the reach is the thing worth catching.
  asking.engine.runs.every((call) =>
    !("floor" in call.query) && !("source" in call.query) &&
    !("identify" in call.query)));

/*
 * Both of the next two read the file with its COMMENTS REMOVED, and the
 * scope is the whole point rather than a convenience.
 *
 * The boundary is explained at length in both files, by name - that is
 * the explanation a reader arriving in a year needs, and it names the arm
 * this page must never reach. A check run over the raw bytes would make
 * writing that explanation the thing it forbids, which is a check that
 * punishes the documentation it depends on. So: say it in prose freely,
 * reach for it in code never.
 */
const withoutComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/<!--[\s\S]*?-->/g, " ");

check("the shipped page script reaches for the published arm and no other",
  /\bpublishedSource\b/.test(withoutComments(publicSource)) &&
  !/\bpersonalSource\b/.test(withoutComments(publicSource)));

check("the page offers no control that could name a source or a floor",
  // Read off the markup, because the absence has to hold for a member
  // with a devtools console open as much as for the wiring above. There
  // is no id, name, value or word of copy on this page that could be
  // mistaken for a lever over the suppression floor, because there is no
  // lever.
  //
  // The word list is the limit worth stating: it catches a control named
  // after the thing, not one that reaches it under some other name. The
  // wiring checks above cover that by counting the calls; this arm is
  // the one that survives the wiring being rewritten.
  !/\b(floor|min-?cell|personal|unsuppress)/i
    .test(withoutComments(dashboardHtml)));

/*
 * The page's pickers against the engine's tables, both directions.
 *
 * Same shape as check 16's naming pins and for the same reason: an
 * option the engine does not know throws where a member clicks, and a
 * split the engine grows with nothing offering it is a question nobody
 * on the site can ask. Neither direction is visible from one file.
 */
const optionValues = (dashboardHtml.match(
  /<select id="q-split">([\s\S]*?)<\/select>/) || ["", ""])[1]
  .match(/value="([^"]*)"/g) || [];
const splitOptions = optionValues.map((raw) => raw.slice(7, -1));

const radioValues = (name) =>
  (dashboardHtml.match(
    new RegExp('name="' + name + '"[^>]*value="([^"]*)"', "g")) || [])
    .map((raw) => raw.match(/value="([^"]*)"/)[1]);

check("every split the page offers is a split the engine answers",
  splitOptions.length > 0 &&
  splitOptions.every((split) => Object.prototype.hasOwnProperty.call(
    Engine.SPLITS, split)));

check("every split the engine answers is a split the page offers",
  Object.keys(Engine.SPLITS).every((split) => splitOptions.includes(split)));

check("the page's Count choices are exactly the engine's bases",
  JSON.stringify(radioValues("basis").slice().sort()) ===
  JSON.stringify(Engine.BASES.slice().sort()));

check("the page's Measure choices are exactly the engine's measures",
  JSON.stringify(radioValues("q-measure").slice().sort()) ===
  JSON.stringify(Engine.MEASURES.slice().sort()));

/* ------------------------------------------------------------------ */
/* What the controls become, and what they cannot become.              */

/*
 * The queries a scenario asked, read so that a page which asked NONE
 * fails the checks below rather than ending the process on a
 * dereference. A file-scope throw here would turn "the question card
 * does not work" into a suite that prints four results and dies, which
 * is the shape this repository has already paid for twice - a contract
 * has to say everything it knows on the first red run, or it is not
 * doing the job a contract is for.
 */
const queryAt = (page, index) => {
  const runs = page.engine.runs;
  const call = index < 0 ? runs[runs.length + index] : runs[index];
  return (call && call.query) || {};
};

const categorical = queryAt(asking, 0);

check("a categorical split is asked as a count, with no band to widen",
  // normalize() refuses a middle over a split with no numbers and
  // refuses widen over one that is not a histogram. The card does not
  // offer either, so the refusal is unreachable rather than routed
  // around - and the fields that would offer them are hidden.
  categorical.split === "gender" && categorical.measure === "count" &&
  !("widen" in categorical) &&
  asking.elements["q-measure-field"].hidden === true &&
  asking.elements["q-widen-field"].hidden === true &&
  asking.elements["q-merge-field"].hidden === false);

const histogram = await loadPublic(MEMBER, response(200, SNAPSHOT), {
  split: "weight",
  checked: { "q-measure": "count", "q-widen": "3", units: "metric" },
});
const widened = queryAt(histogram, 0);

check("a histogram split carries the widen factor as a whole number",
  widened.split === "weight" && widened.widen === 3 &&
  typeof widened.widen === "number" && widened.units === "metric" &&
  histogram.elements["q-widen-field"].hidden === false &&
  histogram.elements["q-merge-field"].hidden === true);

const middle = await loadPublic(MEMBER, response(200, SNAPSHOT), {
  split: "bmi", checked: { "q-measure": "median" },
});

check("a middle over a histogram hides the levers that do not apply to it",
  queryAt(middle, 0).measure === "median" &&
  middle.elements["q-measure-field"].hidden === false &&
  middle.elements["q-widen-field"].hidden === true &&
  middle.elements["q-merge-field"].hidden === true);

check("the caption drawn is the engine's own, from the query it just ran",
  () =>
  // describe() runs the same validator run() does, so a caption can
  // never describe a question that would have thrown. A caption built
  // here from the control labels would be free to.
  asking.answers[0].caption === "asked: gender" &&
  asking.answers[0].element === asking.elements.answer &&
  middle.answers[middle.answers.length - 1].caption === "asked: bmi");

/* ------------------------------------------------------------------ */
/* Combining, which is the lever the union-only rule is about.         */

/* The checkbox inside each built label, and only the ones really there:
   a page that built no list must fail the checks below rather than throw
   past them. */
const boxesOf = (page) => page.elements["q-merge-labels"].children
  .map((label) => label.children[0]).filter(Boolean);

/* Tick the first `count` cells and let the card hear it, without
   assuming the card built any. A page that built no list has to fail the
   checks below, not end the run before they print. */
const tick = (page, count) => {
  boxesOf(page).slice(0, count).forEach((box) => { box.checked = true; });
  page.elements["q-controls"].fire("input");
};

check("the combine list is built from the answer, one box per published cell",
  boxesOf(asking).length === 2 &&
  asking.elements["q-merge-labels"].textContent === "malefemale");

const combining = await loadPublic(MEMBER, response(200, SNAPSHOT), {
  groupName: "Anglosphere",
});
tick(combining, 2);
const merged = queryAt(combining, -1);

check("ticking two cells asks again, naming only cells the document gave",
  () => merged.merge.length === 1 && merged.merge[0].as === "Anglosphere" &&
  JSON.stringify(merged.merge[0].labels) === JSON.stringify(["male", "female"]) &&
  // Asked twice on purpose: plain first, to learn which cells exist, then
  // merged. The plain answer is what the tick list was built from, which
  // is why a member can only ever name a cell that cleared the floor.
  combining.engine.runs.length >= 3 &&
  !("merge" in queryAt(combining, -2)));

const alone = await loadPublic(MEMBER, response(200, SNAPSHOT));
tick(alone, 1);

check("one cell on its own is not a group and is not asked as one",
  alone.engine.runs.every((call) => !("merge" in call.query)));

const unnamed = await loadPublic(MEMBER, response(200, SNAPSHOT));
tick(unnamed, 2);

check("a group with no name is called by its parts rather than refused",
  // normalize() needs a non-empty name, and an empty text field is the
  // ordinary state of that control. Inventing a word would be inventing
  // a claim about the group; joining its parts describes it exactly.
  (queryAt(unnamed, -1).merge || [{}])[0].as === "male + female");

/* ------------------------------------------------------------------ */
/* When the engine is not there, and when it refuses.                  */

const engineless = await loadPublic(MEMBER, response(200, SNAPSHOT),
  { noEngine: true });

check("without the engine the card stays shut and the panels still draw",
  // The panels are what this page is for. A member reading correct
  // aggregates beats a page that refuses to start because an additive
  // script did not arrive.
  engineless.elements.question.hidden === true &&
  engineless.renders.length === 1 &&
  engineless.elements.tool.hidden === false &&
  engineless.elements.closed.hidden === true);

const refused = await loadPublic(MEMBER, response(200, SNAPSHOT), {
  sourceRefuses: {
    message: "that is a keyholder snapshot, not a published one - it " +
      "carries handles and unsuppressed cells",
    plain: "These are not the published figures.",
  },
});

check("a document the engine refuses takes the controls away and says why",
  // The refusal still names WHICH refusal it was - a version this engine
  // does not read, or a keyholder snapshot arriving where a published one
  // belongs - but it names it in the page's own register: #265 row 14.
  // "document", "queried", "engine", "unsuppressed cells" are the
  // engine's nouns, and this is a member's screen. Inert controls would
  // invite a member to keep clicking, so they still go away.
  //
  // THE MEMBER SENTENCE IS THE WHOLE LINE - the register bar's rule 5
  // (#275). Equality rather than a containment test, because what this
  // arm now refuses is a house sentence in front of the plain half, and
  // a containment test cannot see one.
  refused.elements.question.hidden === false &&
  refused.elements["q-controls"].hidden === true &&
  refused.elements["q-status"].className === "status bad" &&
  refused.elements["q-status"].textContent ===
    "These are not the published figures." &&
  refused.answers.length === 0 &&
  refused.renders.length === 1);

check("and the engine's own words go to the console, not to the member",
  // Losing them entirely would lose the only explanation anybody
  // debugging a refused document gets. They are not lost; they are
  // somewhere a member never looks.
  !/keyholder snapshot|unsuppressed/.test(
    refused.elements["q-status"].textContent) &&
  refused.logged.some((line) => /keyholder snapshot/.test(line)));

const throwing = await loadPublic(MEMBER, response(200, SNAPSHOT), {
  runThrows: {
    message: "a median over \"gender\" is not a question - a middle needs " +
      "numbers to take the middle of",
    plain: "Only weight, height and BMI can be averaged.",
  },
});

check("a question the engine refuses is reported in the card's own words",
  // #265 row 16. The engine's refusals are precise and are written in
  // the engine's nouns - "split", "cell", "merge" - none of which this
  // page ever puts on screen. What the member reads is the same claim
  // in the words the controls above it use.
  throwing.elements["q-status"].className === "status bad" &&
  throwing.elements["q-status"].textContent ===
    "Only weight, height and BMI can be averaged." &&
  throwing.logged.some((line) => /is not a question/.test(line)) &&
  throwing.answers.length === 0 &&
  // and the page is still a page
  throwing.elements.tool.hidden === false &&
  throwing.renders.length === 1);

/*
 * A refusal the engine raised with no plain half - #265 row 16's other
 * direction, and the one with teeth.
 *
 * Every member-reachable throw in query.js carries one, but the page
 * cannot be built on that promise: a throw added there tomorrow, or one
 * from a path nobody expected a member to reach, arrives here bare. The
 * old page printed whatever it was handed, which is how "unknown split
 * \"x\" - it is one of gender, country, roles, bmi, weight, height"
 * reached a member's screen. A house sentence is what a bare refusal
 * gets now, and the engine's words still reach the console.
 */
const bare = await loadPublic(MEMBER, response(200, SNAPSHOT), {
  runThrows: "unknown unit system \"furlongs\"",
});

check("a refusal with no plain half gets a house sentence, not the engine's",
  bare.elements["q-status"].className === "status bad" &&
  bare.elements["q-status"].textContent ===
    "That question could not be answered." &&
  bare.logged.some((line) => /furlongs/.test(line)) &&
  bare.answers.length === 0);

/*
 * The option the engine does not know - #265 row 15.
 *
 * The pin above makes this unreachable in the shipped pair, and the
 * sentence is still said out loud rather than thrown, because whoever
 * reaches it added an option and will not read a stack trace. What
 * changed is who it was addressed to: "This page offers a question the
 * engine does not answer: bmi." names a module and a raw split id on a
 * member's screen. The id is what the developer needs, so the id goes
 * to the console and the member gets a sentence about their question.
 */
const stranger = await loadPublic(MEMBER, response(200, SNAPSHOT), {
  split: "handle",
});

check("a split the engine does not answer says so without naming the id",
  stranger.elements["q-status"].className === "status bad" &&
  stranger.elements["q-status"].textContent ===
    "That question is not one these figures can answer." &&
  !/handle/.test(stranger.elements["q-status"].textContent) &&
  stranger.logged.some((line) => /handle/.test(line)) &&
  stranger.answers.length === 0);

/* ------------------------------------------------------------------ */

const shared = await loadPublic(MEMBER, response(200, SNAPSHOT));
const beforeShared = { panels: shared.renders.length,
  answers: shared.answers.length };
shared.shared[0].fire("change");

check("the page's own Count and Units choices move the answer with the panels",
  // The card's copy promises a question here is about the same people
  // the panels are. A second pair of controls could disagree with the
  // first; sharing one pair cannot.
  shared.renders.length === beforeShared.panels + 1 &&
  shared.answers.length === beforeShared.answers + 1);

if (failures) {
  console.error(`\npublic dashboard FAILED ${failures} check(s)`);
  process.exit(1);
}
console.log(`\npublic dashboard OK - ${ran} checks`);
