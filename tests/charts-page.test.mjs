/*
 * apps/web/charts.html and apps/web/charts.js against the route's real
 * contract (0.9-M2-S3, #354).
 *
 *     node tests/charts-page.test.mjs
 *
 * THE PAGE IS RENDER-ONLY (security mandate 1), and that is what most
 * of this file checks. THE CLAIM IS BEHAVIORAL, NOT A NAME LIST
 * (0.9-M2-S3 fix wave 1, F1): every numeric label the distribution
 * figure draws has to appear verbatim in the fixture response, and the
 * rendered bin count has to equal the response's - so a pooler, a
 * merger or a second binning pass reddens this suite regardless of
 * what it calls its variables. The FORBIDDEN name grep below (section
 * 1) stays as a fast tripwire that catches an obvious reintroduction by
 * name before the slower behavioral arm has to - it is no longer the
 * proof by itself, since a real second partition wired under fresh
 * names passes it while still computing its own bins (the reviewer's
 * own finding, #354 comment 5342979192). server/charts-agg.js's
 * tests/charts-aggregate.test.mjs is where the disclosure rules
 * themselves are attacked; this file's job is that the PAGE prints
 * what the route hands back and computes nothing of its own.
 *
 * A FIXTURE ANSWER, NEVER A FETCH. This suite drives charts.js against
 * hand-built GET /charts response bodies shaped exactly like
 * server/charts-agg.js's real output (checked in the pure arm below
 * against that file's own exported shapes), never against a running
 * Worker and never against apps/web/dashboard.js's retired snapshot
 * document, which this page cannot reach at all - there is no
 * GET /snapshot left to ask.
 *
 * THE DOM HALF IS A HAND-BUILT STUB, not jsdom (#75's rejection
 * applies here too): a small node factory with just the surface
 * apps/web/charts.js touches - getElementById, createElement(NS),
 * appendChild/removeChild, textContent, class lists, addEventListener.
 * It is driven by dispatching real events (a click on Show me, an
 * input's change) exactly as a browser would, rather than by calling
 * charts.js's internal functions directly - those are closures inside
 * one IIFE and none of them escape it on purpose (AGENTS.md's "Exported
 * objects are frozen" pairs with "closures stay closures").
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
/* 1. Render-only: no line of dashboard.js's suppression logic         */
/* survives, anywhere in apps/web (security mandate 1).                */

const WEB_DIR = HERE("../apps/web");
const { readdir } = await import("node:fs/promises");
const webNames = (await readdir(WEB_DIR)).filter((n) => n.endsWith(".js") ||
  n.endsWith(".html"));
const webTexts = {};
for (const name of webNames) webTexts[name] = await read("../apps/web/" + name);

const FORBIDDEN = /MIN_CELL|suppressCounts|suppressBins|repartition|SNAPSHOT/;

check("dashboard.js, query.js and public.js are gone, not merely unlinked",
  !webNames.includes("dashboard.js") && !webNames.includes("query.js") &&
  !webNames.includes("public.js"));

/*
 * One named exception, not this slice's to close. admin.js is ruled
 * dead-in-water rather than patched (issue #354's own scope: "admin.html
 * stated dead, not patched") - its one MIN_CELL reference is checked as
 * dead code two arms below rather than excused silently.
 *
 * apps/web/submit.js and apps/web/your-page.html carried the pre-0.9
 * personal-query engine's own MIN_CELL reference before 0.9-M2-S2
 * retired it (#353); this slice's pre-ship rebase over S2's landed head
 * proved both clean (0.9-M2-S3 fix wave 1, F3 - the reviewer's own
 * probe: injecting a forbidden name into either file reddened this
 * check, 30/30), so neither is exempted here any longer.
 */
const NOT_MINE = new Set(["admin.js", "admin.html"]);
const dirty = Object.entries(webTexts)
  .filter(([name]) => !NOT_MINE.has(name))
  .filter(([, text]) => FORBIDDEN.test(text))
  .map(([name]) => name);
if (dirty.length) console.log("      dirty: " + dirty.join(", "));
check("no line of MIN_CELL/suppressCounts/suppressBins/repartition/" +
  "SNAPSHOT survives in apps/web outside the two named exceptions",
  dirty.length === 0);

/*
 * admin.js is the one named, ruled exception (issue #354's own scope:
 * "admin.html stated dead, not patched"). It still reads
 * root.BinderDashboard.MIN_CELL in dead code the deleted dashboard.js
 * script tag can no longer reach - checked here rather than pretended
 * clean, so the exception is a fact this suite states rather than a
 * blind spot it has.
 */
check("admin.js's one surviving MIN_CELL reference is dead code - " +
  "dashboard.js, the only thing that could define BinderDashboard, " +
  "is gone",
  webTexts["admin.js"].includes("MIN_CELL") &&
  !webNames.includes("dashboard.js"));

check("charts.html loads no dashboard.js, query.js or public.js script",
  !/src="(dashboard|query|public)\.js"/.test(webTexts["charts.html"]));

/* ------------------------------------------------------------------ */
/* 2. The pure half: labels, scales, the request shape.                */

const src = await read("../apps/web/charts.js");
await import("data:text/javascript," + encodeURIComponent(src));
const Charts = globalThis.BinderCharts;

check("charts.js publishes BinderCharts, frozen",
  Charts !== undefined && Object.isFrozen(Charts));

/* Design mandate 3: open-ended labels. */
check("both ends open (the real single-bin case) names no number",
  Charts.binLabel(null, null, "lb") === "Everyone in this view");
check("an open first edge reads \"under X\", never a number for the " +
  "missing edge",
  Charts.binLabel(null, 150, "lb") === "under 150 lb");
check("an open last edge reads \"X and up\"",
  Charts.binLabel(130, null, "lb") === "130 lb and up");
check("two closed edges read as a normal range",
  Charts.binLabel(130, 150, "lb") === "130 lb–150 lb");
check("a unitless measure's label carries no unit token",
  Charts.binLabel(20, 25, null) === "20–25");

/* chartsURL: self=1 always, filter+value only together. */
const bare = new URL(Charts.chartsURL("https://w.example", { measure: "weight" }));
/* /charts-data, not /charts (0.9-M2-S8, #365): the route was renamed
   out of the way of this page's own basename, because the assets
   layer's html_handling redirects /charts.html to /charts and the
   router answered there. The PAGE keeps its name; the ROUTE moved. */
check("the bare request names the renamed route, plus measure and self",
  bare.pathname === "/charts-data" &&
  bare.searchParams.get("measure") === "weight" &&
  bare.searchParams.get("self") === "1" &&
  bare.searchParams.get("filter") === null);

const filtered = new URL(Charts.chartsURL("https://w.example",
  { measure: "weight", filter: "gender", value: "female" }));
check("a filtered request carries filter and value alongside self",
  filtered.searchParams.get("filter") === "gender" &&
  filtered.searchParams.get("value") === "female" &&
  filtered.searchParams.get("self") === "1");

check("no request ever names a floor or a units parameter - the wire " +
  "has neither (security mandate 2)",
  !bare.searchParams.has("floor") && !bare.searchParams.has("units") &&
  !filtered.searchParams.has("floor") && !filtered.searchParams.has("units"));

/* categoricalMeasures / valueChoices, against a small fixture spec
   shaped like apps/fields.js's measureFor() output - never against a
   response, matching design mandate 2's "never from a response". */
const FieldsFixture = {
  measures: () => [
    { name: "weight", kind: "bins" },
    { name: "gender", kind: "categorical", term: "gender",
      choices: [{ value: "male", label: "Male" },
                { value: "female", label: "Female" }] },
    { name: "country", kind: "categorical", term: "country",
      choicesFrom: "countries" },
  ],
};
const cats = Charts.categoricalMeasures(FieldsFixture, {});
check("only categorical measures are offered as a filter - a bins " +
  "measure like weight is never one",
  cats.length === 2 && cats.every((m) => m.kind === "categorical"));

const genderChoices = Charts.valueChoices(cats[0], null);
check("a plain choice field's values come from its own spec entry",
  genderChoices.length === 2 &&
  genderChoices[0].value === "male" && genderChoices[0].label === "Male");

const countryChoices = Charts.valueChoices(cats[1],
  { US: "United States", AL: "Albania" });
check("a choicesFrom field reads the page's own table, sorted by " +
  "label - never a value list the route enumerated",
  countryChoices.length === 2 &&
  countryChoices[0].label === "Albania" &&
  countryChoices[1].label === "United States");

/* ------------------------------------------------------------------ */
/* 3. Driven end to end: a minimal DOM, a fixture fetch, real events.   */

function node(tag) {
  const el = {
    tag,
    id: "",
    attrs: {},
    children: [],
    listeners: {},
    hidden: false,
    value: "",
    checked: false,
    _text: "",
  };
  el.setAttribute = (name, value) => { el.attrs[name] = String(value); };
  el.getAttribute = (name) =>
    Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null;
  el.appendChild = (child) => {
    el.children.push(child);
    // A real <select> auto-selects its first <option> the moment one
    // exists - apps/web/charts.js relies on this exactly as a browser
    // does (it never sets .value itself after populating a select).
    if (el.tag === "select" && el.children.length === 1) {
      el.value = child.value;
    }
    return child;
  };
  el.removeChild = (child) => {
    const at = el.children.indexOf(child);
    if (at !== -1) el.children.splice(at, 1);
  };
  // apps/web/charts.js's clearSvg() clears a node by walking
  // firstChild/removeChild, the DOM's own idiom - a stub with
  // children[] but no firstChild would leave that loop believing an
  // occupied node is already empty.
  Object.defineProperty(el, "firstChild", {
    get: () => (el.children.length ? el.children[0] : null),
  });
  el.addEventListener = (type, fn) => {
    (el.listeners[type] = el.listeners[type] || []).push(fn);
  };
  el.dispatch = (type) => {
    // apps/web/charts.js sets .onchange directly on the units radios
    // (rather than addEventListener) to re-wire the listener fresh
    // per successful draw - both forms fire on a real event and both
    // fire here.
    const direct = el["on" + type];
    if (typeof direct === "function") direct({});
    (el.listeners[type] || []).slice().forEach((fn) => fn({}));
  };
  el.querySelector = (selector) => {
    if (selector === "svg") {
      return el.children.find((c) => c.tag === "svg") || null;
    }
    return null;
  };
  Object.defineProperty(el, "textContent", {
    get: () => el._text,
    set: (v) => { el._text = String(v); el.children.length = 0; },
  });
  Object.defineProperty(el, "className", {
    get: () => el.attrs.class || "",
    set: (v) => { el.attrs.class = String(v); },
  });
  return el;
}

/*
 * The registry apps/web/charts.html actually declares, read off the
 * shipped file's ids rather than hand-copied - so a page that drops or
 * renames an id this suite depends on fails here (as a missing
 * element) instead of in a browser nobody is looking at.
 */
const PAGE_HTML = webTexts["charts.html"];
const IDS = [...PAGE_HTML.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]);
const NEEDED = ["filter-field", "filter-value-field", "filter-value",
  "measure", "picture-tab-trend", "picture-tab-distribution",
  "picture-trend", "picture-distribution", "figure-trend",
  "figure-distribution", "results", "status", "show-me", "download"];
check("every element this suite drives is really in apps/web/charts.html",
  NEEDED.every((id) => IDS.includes(id)));

/*
 * `noUnitsChecked` stands in for the static HTML's own `checked`
 * attribute being absent - the shape currentSystem()'s fallback
 * actually reads (F2's arm below). apps/web/charts.html always ships
 * the imperial radio checked today (a separate, pre-existing gap, not
 * this wave's), so this is the only way to drive the fallback path at
 * all under this stub.
 */
function buildDom(opts) {
  const options = opts || {};
  const byId = new Map();
  for (const id of NEEDED) byId.set(id, node("div"));

  byId.get("filter-field").tag = "select";
  byId.get("filter-value").tag = "select";
  byId.get("measure").tag = "select";
  byId.get("show-me").tag = "button";
  // The static "Everyone" option apps/web/charts.html ships in the
  // markup itself, ahead of anything charts.js appends - so "Everyone"
  // (an empty filter) is the default selection, exactly as a browser
  // starts it.
  const everyone = node("option");
  everyone.value = "";
  byId.get("filter-field").appendChild(everyone);
  byId.get("download").tag = "a";
  // apps/web/charts.html ships the download anchor `hidden` by default;
  // offerDownload() is what reveals it once a response exists.
  byId.get("download").hidden = true;
  const svgTrend = node("svg");
  const svgDist = node("svg");
  byId.get("figure-trend").appendChild(svgTrend);
  byId.get("figure-distribution").appendChild(svgDist);

  const unitsImperial = node("input");
  unitsImperial.value = "imperial";
  unitsImperial.checked = !options.noUnitsChecked;
  const unitsMetric = node("input");
  unitsMetric.value = "metric";
  const unitsInputs = [unitsImperial, unitsMetric];

  const doc = {
    getElementById: (id) => byId.get(id) || null,
    createElement: (tag) => node(tag),
    createElementNS: (_ns, tag) => node(tag),
    querySelectorAll: (selector) => {
      if (selector === 'input[name="units"]') return unitsInputs;
      return [];
    },
  };
  return { doc, byId, unitsInputs };
}

/*
 * checkedValue("units", ...) reads .checked off document.querySelectorAll
 * results - apps/web/ui.js's own implementation - so this harness needs
 * the real module rather than a second copy of that logic.
 */
const uiSrc = await read("../apps/web/ui.js");

function measureFixture() {
  return [
    { name: "weight", label: "Weight", term: "weight", kind: "bins",
      unitful: true },
    { name: "gender", label: "Gender", term: "gender", kind: "categorical",
      choices: [{ value: "male", label: "Male" },
                { value: "female", label: "Female" }] },
  ];
}

/*
 * `opts.defaultSystem` stands in for apps/web/site.config.js's
 * units.default, read through apps/fields.js's defaultSystem() (F2's
 * arm below flips it both directions). It is a fixture value here for
 * the same reason BinderFields itself is fixtured throughout this
 * file - never the real site.config.js/fields.js pair - but it is
 * standing in for the exact same fact currentSystem() now derives from.
 */
async function driven(fetchImpl, opts) {
  const options = opts || {};
  const { doc, byId, unitsInputs } = buildDom(options);
  const calls = [];
  const g = globalThis;
  g.document = doc;
  g.URL.createObjectURL = () => "blob:test";
  g.URL.revokeObjectURL = () => {};
  g.BinderUI = undefined;
  g.BinderSession = {
    require: () => ({ session: "tok" }),
    authorization: () => ({ Authorization: "Bearer tok" }),
    clear: () => { calls.push("session-cleared"); },
  };
  g.BinderFields = {
    measures: () => measureFixture(),
    measure: (name) => measureFixture().find((m) => m.name === name),
    defaultSystem: () => options.defaultSystem || "imperial",
  };
  g.BINDER_SITE = { fields: [] };
  g.BINDER_COUNTRIES = {};
  g.BINDER_CONFIG = { endpoint: "https://w.example" };
  g.fetch = async (url, init) => {
    calls.push(String(url));
    return fetchImpl(url, init);
  };

  await import("data:text/javascript," + encodeURIComponent(uiSrc) +
    "#charts-ui-" + Math.random());
  await import("data:text/javascript," + encodeURIComponent(src) +
    "#charts-page-" + Math.random());

  await new Promise((resolve) => setTimeout(resolve, 0));
  await byId.get("show-me").dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  return { byId, calls, unitsInputs };
}

function response(status, body) {
  const text = JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => text,
  };
}

/*
 * A fixture shaped exactly like server/charts-agg.js's real answer -
 * every field this suite reads is one that file's aggregate() actually
 * emits, not an invented shape (checked against its own exports below).
 */
const NOT_ENOUGH_FIXTURE = {
  ok: true, measure: { name: "weight", label: "Weight", term: "weight",
    kind: "bins" }, filter: { field: null, value: null }, floor: 5,
  enough: false, note: "Not enough people for this view.", units: null,
  trend: null, distribution: null, self: null,
};

{
  const { byId, calls } = await driven(() => response(200, NOT_ENOUGH_FIXTURE));
  check("Show me fires exactly one GET /charts-data, never /snapshot " +
    "and never the page's own /charts URL",
    calls.length === 1 &&
    new URL(calls[0]).pathname === "/charts-data" &&
    !calls.some((u) => u.includes("/snapshot")));
  check("a floored cut renders the route's own sentence as content, " +
    "verbatim - never a string this page composed",
    byId.get("status")._text === NOT_ENOUGH_FIXTURE.note);
  check("the not-enough state carries no error class - content on a " +
    "200, indistinguishable from any other state (security mandate 4)",
    byId.get("status").className === "status");
  check("nothing is drawn when there is nothing to draw",
    byId.get("picture-trend").hidden === true &&
    byId.get("picture-distribution").hidden === true);
}

/*
 * The middle bin's count (3) sits BELOW server/charts-agg.js's own
 * FLOOR (5) - not a real route answer at all (that route absorbs a
 * sub-floor bin before it ever reaches the wire, per its own suppression
 * cascade). It is planted here on purpose, per re-fire diagnosis F1
 * (0.9-M2-S3 fix wave 2, #354): the F1 arm below compares rendered bins
 * against the fixture's own bins index for index, so a fixture built
 * entirely of already-legal counts (the original 6/7 pair, both clearing
 * the floor on their own) can never tell a real second binning pass
 * apart from a no-op - the reviewer's own mergeThinBands() mutation
 * proved exactly that, shipping fully green because it had nothing left
 * to merge. A sub-floor bin gives a client-side pooler something to act
 * on; charts.js itself is render-only and prints whatever three bins
 * arrive here without complaint, which is the point being proved.
 */
const ENOUGH_FIXTURE = {
  ok: true,
  measure: { name: "weight", label: "Weight", term: "weight", kind: "bins" },
  filter: { field: null, value: null },
  floor: 5,
  enough: true,
  note: null,
  units: { metric: { unit: "kg" }, imperial: { unit: "lb" } },
  trend: { points: [
    { period: "2026-06", people: 6,
      average: { metric: { kg: 80 }, imperial: { lb: 176.4 } } },
    { period: "2026-07", people: 7,
      average: { metric: { kg: 81 }, imperial: { lb: 178.6 } } },
  ] },
  distribution: {
    kind: "bins",
    partition: { system: "imperial", unit: "lb", band: "20 lb bands" },
    bins: [
      { count: 6, from: { metric: null, imperial: null },
        to: { metric: 70, imperial: 154 } },
      { count: 3, from: { metric: 70, imperial: 154 },
        to: { metric: 90, imperial: 198 } },
      { count: 7, from: { metric: 90, imperial: 198 },
        to: { metric: null, imperial: null } },
    ],
  },
  self: { points: [] },
};

{
  const { byId } = await driven(() => response(200, ENOUGH_FIXTURE));
  check("a real answer draws - the status line names the measure, " +
    "not an error",
    byId.get("status")._text.includes("Weight"));
  check("download is offered once a response exists, holding the " +
    "route's own bytes",
    byId.get("download").hidden === false &&
    byId.get("download").download === "charts.json");

  const svg = byId.get("figure-distribution").querySelector("svg");
  const labels = svg.children.filter((c) => c.tag === "text")
    .map((c) => c._text);
  check("the open first bin reads \"under\", the open last bin reads " +
    "\"and up\" - no invented number at either open edge",
    labels.some((t) => /^under /.test(t)) &&
    labels.some((t) => / and up$/.test(t)));

  /*
   * F1's behavioral arm (0.9-M2-S3 fix wave 1, #354 comment
   * 5342979192): the rendered bin count and every bar's count/range
   * label are compared against the fixture's OWN bins, index for
   * index, in the response's own order. The reviewer's mutation - a
   * mergeThinBands()-shaped adjacent-bin pooler wired into
   * drawDistribution - pools bins under fresh names, so a check that
   * only greps source for known names passes it while the pooler still
   * runs; this check instead asks what actually painted, which a
   * pooler changes no matter what it is called: fewer bars than the
   * response sent, a re-summed count, or a spanning label no single
   * fixture bin has.
   */
  const barCounts = svg.children.filter((c) => c.tag === "text" &&
    c.attrs.class === "chart-value").map((c) => c._text);
  const rangeLabels = svg.children.filter((c) => c.tag === "text" &&
    c.attrs.class === "chart-label").map((c) => c._text);
  const fixtureBins = ENOUGH_FIXTURE.distribution.bins;
  const fixtureUnit = ENOUGH_FIXTURE.units.imperial.unit;
  check("F1: the rendered bin count equals the response's bin count " +
    "exactly - a client-side pooler that merges adjacent bins reddens " +
    "here regardless of what it calls itself",
    barCounts.length === fixtureBins.length &&
    rangeLabels.length === fixtureBins.length);
  check("F1: every rendered bar's count and range label is the " +
    "fixture's own value for that bin, in the response's own order - " +
    "a pooled or re-binned draw shows a re-summed count or a spanning " +
    "label no fixture bin has",
    fixtureBins.every(function (bin, i) {
      return barCounts[i] === String(bin.count) &&
        rangeLabels[i] === Charts.binLabel(bin.from.imperial,
          bin.to.imperial, fixtureUnit);
    }));
}

/*
 * The units toggle: re-render from the SAME cached answer, with no
 * second fetch (security mandate 2 - "reads the per-system key the
 * route already returned"). Distinguishing this from a re-bin requires
 * the metric numbers to differ from the imperial ones in the redrawn
 * labels, which they do in the fixture (90 kg vs 198 lb).
 */

{
  const { byId, calls, unitsInputs } = await driven(() =>
    response(200, ENOUGH_FIXTURE));
  const callsBeforeToggle = calls.length;
  unitsInputs[0].checked = false;
  unitsInputs[1].checked = true;
  await unitsInputs[1].dispatch("change");
  await new Promise((resolve) => setTimeout(resolve, 0));

  check("switching units re-renders with no new fetch - the units " +
    "toggle re-asks nothing, it reads a different key of the same " +
    "answer (security mandate 2)",
    calls.length === callsBeforeToggle);

  const svg = byId.get("figure-distribution").querySelector("svg");
  const labels = svg.children.filter((c) => c.tag === "text")
    .map((c) => c._text);
  check("the redrawn labels carry the metric edge (90), not the " +
    "imperial one (198) - a real re-render, not a no-op",
    labels.some((t) => t.includes("90")) &&
    !labels.some((t) => t.includes("198")));
}

/*
 * F2's arm (0.9-M2-S3 fix wave 1, #354 comment 5342979192): with no
 * units radio checked - standing in for the static HTML's own `checked`
 * attribute being absent - currentSystem()'s fallback has to be
 * apps/fields.js's defaultSystem() (form.js and submit.js's own
 * pattern), never a literal this file invents. Flipped both directions
 * against the SAME fixture answer, so only the fallback's source can
 * explain the difference: nothing else about the draw changes between
 * the two calls.
 */
{
  const { byId } = await driven(() => response(200, ENOUGH_FIXTURE),
    { noUnitsChecked: true, defaultSystem: "imperial" });
  const svg = byId.get("figure-distribution").querySelector("svg");
  const labels = svg.children.filter((c) => c.tag === "text")
    .map((c) => c._text);
  check("F2: with no units radio checked, the initial draw follows " +
    "the spec's defaultSystem() (imperial here) - the imperial edge " +
    "(198) is drawn, not the metric one (90)",
    labels.some((t) => t.includes("198")) &&
    !labels.some((t) => t.includes("90")));
}

{
  const { byId } = await driven(() => response(200, ENOUGH_FIXTURE),
    { noUnitsChecked: true, defaultSystem: "metric" });
  const svg = byId.get("figure-distribution").querySelector("svg");
  const labels = svg.children.filter((c) => c.tag === "text")
    .map((c) => c._text);
  check("F2: flipping the spec's defaultSystem() to metric flips the " +
    "initial draw too - the page derives the fallback from the spec, " +
    "it does not hardcode one",
    labels.some((t) => t.includes("90")) &&
    !labels.some((t) => t.includes("198")));
}

{
  const { byId } = await driven(() => response(401, { error: "Not authorized." }));
  check("a 401 says the session is invalid and stays put, matching " +
    "every other member page's live-401 wording",
    byId.get("status")._text.includes("no longer valid"));
}

/* ------------------------------------------------------------------ */
/* 4. The response shape this suite fixtures against is the real one:  */
/* every field NOT_ENOUGH_FIXTURE/ENOUGH_FIXTURE read is a field       */
/* server/charts-agg.js's aggregate()/notEnough() actually emit.       */

const aggSrc = await read("../server/charts-agg.js");
check("server/charts-agg.js's notEnough() emits exactly the fields " +
  "the not-enough fixture above assumes",
  /ok: true,/.test(aggSrc) && /enough: false,/.test(aggSrc) &&
  /note: NOT_ENOUGH,/.test(aggSrc) && /units: null,/.test(aggSrc) &&
  /trend: null,/.test(aggSrc) && /distribution: null,/.test(aggSrc));
check("aggregate()'s success shape carries the fields the enough " +
  "fixture assumes",
  /enough: true,/.test(aggSrc) && /note: null,/.test(aggSrc));
check("openEdge() is what produces the null from/to this suite reads " +
  "as the open-edge case",
  /function openEdge\(/.test(aggSrc));

/* ------------------------------------------------------------------ */

const EXPECTED = 34;
console.log(failures
  ? `\ncharts-page FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\ncharts-page ran ${performed} checks, expected ${EXPECTED}`
    : `\ncharts-page OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
