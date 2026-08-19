/*
 * apps/web/charts.html and apps/web/charts.js against the route's real
 * contract (0.9-M2-S3, #354; reshaped by the 2026-08-19 charts ruling,
 * #243 comment 5346978974, and 0.9-M2-S10/S11, #371/#372).
 *
 *     node tests/charts-page.test.mjs
 *
 * THE PAGE IS RENDER-ONLY (security mandate 1), and that is what most
 * of this file checks. THE CLAIM IS BEHAVIORAL, NOT A NAME LIST
 * (0.9-M2-S3 fix wave 1, F1): every numeric label the distribution
 * figure draws has to appear verbatim in the fixture response, and the
 * rendered bin count has to equal the response's - so a pooler, a
 * merger or a second binning pass reddens this suite regardless of
 * what it calls its variables. That property survives 0.9-M2-S11's
 * reshape and its own review's F1/F2 fix wave: the distribution figure
 * now draws every band the response sends (empty ones included) with
 * only some of them captioned - by GEOMETRY, not a fixed count - and
 * the arm below checks the count row and the caption row against
 * exactly the positions apps/web/charts.js's own
 * rangeCaptionPlan()/countCaptionPlan() say should carry one. The
 * FORBIDDEN name grep below (section 1)
 * stays as a fast tripwire that catches an obvious reintroduction by
 * name before the slower behavioral arm has to - it is no longer the
 * proof by itself, since a real second partition wired under fresh
 * names passes it while still computing its own bins (the reviewer's
 * own finding, #354 comment 5342979192). server/charts-agg.js's
 * tests/charts-aggregate.test.mjs is where the disclosure rules
 * themselves are attacked; this file's job is that the PAGE prints
 * what the route hands back and computes nothing of its own.
 *
 * THE NULL-EDGE FIXTURES ARE RETIRED WITH THIS SLICE. server/
 * charts-agg.js's openEdge() is gone (0.9-M2-S10, #371): every edge in
 * a real answer is now one of the field spec's own two range numbers or
 * a bin boundary between them, never null. The "under X"/"X and up"
 * arms this file used to carry are gone with it - binLabel() no longer
 * accepts a null edge at all, so there is nothing left to fixture.
 *
 * A FIXTURE ANSWER, NEVER A FETCH. This suite drives charts.js against
 * hand-built GET /charts response bodies shaped exactly like
 * server/charts-agg.js's real output, never against a running Worker
 * and never against apps/web/dashboard.js's retired snapshot document,
 * which this page cannot reach at all - there is no GET /snapshot left
 * to ask.
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

/* Owner ruling 5, #243: every edge is a plain number now. */
check("two closed edges read as a plain range",
  Charts.binLabel(130, 150, "lb") === "130 lb–150 lb");
check("a unitless measure's label carries no unit token",
  Charts.binLabel(20, 25, null) === "20–25");
check("binLabel never invents an open-edge shape for a real answer's " +
  "numbers - both edges print exactly as given",
  Charts.binLabel(0, 5, "kg") === "0 kg–5 kg");

/*
 * LEGIBILITY IS A GEOMETRY PROPERTY, NOT A COUNT TARGET (owner's F1/F2
 * ruling on 0.9-M2-S11's review, #372). The count-near-ten
 * edgeLabelStride() this replaces still overlapped on both the 120-band
 * BMI grid (F1) and the 53-band imperial-weight grid (F2) - the count
 * was near ten either way, the captions still collided. captionWidth(),
 * rangeCaptionPlan() and countCaptionPlan() below are checked three
 * ways: a controlled overlap case with hand-verifiable geometry, the
 * exact scenario the review reported (F2's own numbers), and the two
 * REAL shipped grids the review named (F1's, F2's) fed through the real
 * function, since this suite's own DOM stub cannot measure a painted
 * pixel.
 */
check("captionWidth is proportional to the text length - the estimate " +
  "basis is character count, stated in the function's own header",
  Charts.captionWidth("0") === 7 && Charts.captionWidth("12") === 14 &&
  Charts.captionWidth("") === 0);

/* A controlled, hand-verifiable case: three captions far enough apart
   that none can possibly overlap (a slot ten times any caption's own
   width) - every one paints, proving the plan is not "always thin". */
check("rangeCaptionPlan paints every caption when nothing overlaps",
  JSON.stringify(Charts.rangeCaptionPlan(["a", "bb", "ccc"], 1000)) ===
  JSON.stringify([0, 1, 2]));
check("countCaptionPlan paints every count when nothing overlaps",
  JSON.stringify(Charts.countCaptionPlan([0, 5, 12], 1000)) ===
  JSON.stringify([0, 1, 2]));

/*
 * F2's own reported scenario, reproduced: a caption shaped exactly like
 * the review's "1004 lb–1024 lb" at the review's own 72.45-unit pitch.
 * Three adjacent bands this wide overlap their immediate neighbor (the
 * review's finding), so the middle one - the interior candidate - is
 * the one dropped; the two ends still paint, per the ruling's own
 * words: "resolve their collisions by dropping interior neighbors,
 * never the ends".
 */
const f2Labels = [Charts.binLabel(1004, 1024, "lb"),
  Charts.binLabel(1024, 1044, "lb"), Charts.binLabel(1044, 1064, "lb")];
const f2Plan = Charts.rangeCaptionPlan(f2Labels, 72.45);
check("F2's own reported case: the interior caption collides with both " +
  "neighbors and is dropped",
  !f2Plan.includes(1));
check("F2's own reported case: the first and last captions still " +
  "paint, even though they are exactly the pair that collided before " +
  "thinning",
  f2Plan.includes(0) && f2Plan.includes(2));

/*
 * The two REAL shipped grids the review named, built the same way
 * server/charts-agg.js's gridOf() builds them (anchored at the spec's
 * own minimum, stepped by the spec's own bin width, the last band
 * clipped to the maximum) - so this is not a stand-in grid, it is the
 * one 0.9-M2-S10 actually ships. slot is drawBins()'s own 640-wide
 * figure divided evenly across the bands, matching what the page
 * itself would compute.
 */
function realGrid(min, max, width) {
  const edges = [];
  for (let from = min; from < max - 1e-9; from += width) {
    edges.push({ from, to: Math.min(from + width, max) });
  }
  return edges;
}

function noPaintedPairOverlaps(plan, texts, slot) {
  const box = (i) => {
    const center = i * slot + slot / 2;
    const half = Charts.captionWidth(texts[i]) / 2;
    return { left: center - half, right: center + half };
  };
  for (let k = 1; k < plan.length; k += 1) {
    const a = box(plan[k - 1]);
    const b = box(plan[k]);
    if (!(a.right <= b.left || a.left >= b.right)) return false;
  }
  return true;
}

const bmiGrid = realGrid(0, 600, 5);
check("the real shipped BMI grid is 120 bands, 0 to 600 at bin 5 - the " +
  "exact spec F1 was filed against",
  bmiGrid.length === 120);
const bmiLabels = bmiGrid.map((b) => Charts.binLabel(b.from, b.to, null));
const bmiSlot = 640 / bmiGrid.length;
const bmiRangePlan = Charts.rangeCaptionPlan(bmiLabels, bmiSlot);
check("F1: on the real 120-band BMI grid, no two painted range " +
  "captions overlap",
  noPaintedPairOverlaps(bmiRangePlan, bmiLabels, bmiSlot));
check("F1: the BMI grid is thinned, not painted whole - the fix is " +
  "fewer captions, not merely differently counted ones",
  bmiRangePlan.length < bmiGrid.length);
check("F1: the first and last BMI bands still caption their own edge",
  bmiRangePlan[0] === 0 && bmiRangePlan[bmiRangePlan.length - 1] ===
  bmiGrid.length - 1);

/* A count row over the same 120 bands - a handful of small nonzero
   counts scattered among mostly-zero bands, the shape a real BMI
   distribution actually has. */
const bmiCounts = bmiGrid.map((_, i) => (i % 11 === 0 ? i % 4 + 1 : 0));
const bmiCountPlan = Charts.countCaptionPlan(bmiCounts, bmiSlot);
check("F1: on the real 120-band BMI grid, no two painted count " +
  "captions overlap either",
  noPaintedPairOverlaps(bmiCountPlan.slice().sort((a, b) => a - b),
    bmiCounts.map(String), bmiSlot));

const weightGrid = realGrid(44, 1100, 20);
check("the real shipped imperial-weight grid is 53 bands - the exact " +
  "spec F2 was filed against",
  weightGrid.length === 53);
const weightLabels = weightGrid.map((b) => Charts.binLabel(b.from, b.to, "lb"));
const weightSlot = 640 / weightGrid.length;
const weightRangePlan = Charts.rangeCaptionPlan(weightLabels, weightSlot);
check("F2: on the real 53-band imperial-weight grid, no two painted " +
  "range captions overlap",
  noPaintedPairOverlaps(weightRangePlan, weightLabels, weightSlot));
check("F2: the weight grid is thinned too - a caption count near ten " +
  "is not the same property as captions that fit",
  weightRangePlan.length < weightGrid.length);
check("F2: the first and last weight bands still caption their own " +
  "edge, including the forced last one the review named specifically",
  weightRangePlan[0] === 0 && weightRangePlan[weightRangePlan.length - 1] ===
  weightGrid.length - 1);

/*
 * NON-ZERO COUNTS WIN SLOTS OVER ZEROS (the ruling's own words). Two
 * adjacent bands, one zero and one not, close enough that only one of
 * their count captions can fit - the non-zero one is kept regardless of
 * which side of it the zero sits on.
 */
check("a non-zero count beats an adjacent zero for a contested slot " +
  "(zero first, non-zero second)",
  JSON.stringify(Charts.countCaptionPlan([0, 12], 10)) ===
  JSON.stringify([1]));
check("a non-zero count beats an adjacent zero for a contested slot " +
  "(non-zero first, zero second)",
  JSON.stringify(Charts.countCaptionPlan([12, 0], 10)) ===
  JSON.stringify([0]));
check("two non-zero counts that collide still keep exactly one - the " +
  "priority rule breaks the tie by position, deterministically",
  Charts.countCaptionPlan([12, 34], 10).length === 1);

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

/* categoricalMeasures / drawableMeasures / valueChoices, against a small
   fixture spec shaped like apps/fields.js's measureFor() output - never
   against a response, matching design mandate 2's "never from a
   response". */
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

/* Owner ruling 1, #243: categorical measures leave the `measure` list. */
const drawable = Charts.drawableMeasures(FieldsFixture, {});
check("only numeric measures are offered as a measure - gender and " +
  "country are never chartable any more",
  drawable.length === 1 && drawable[0].name === "weight");

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

/* groupCellLabel: the country carry (S12's review, #373; the wake to
   this file). server/charts-agg.js sends `label: value` (the code) as
   a placeholder for a choicesFrom field; this page derives the real
   name from `value` through its own countries table. */
const countryMeasureFixture = { name: "country", choicesFrom: "countries" };
const genderMeasureFixture = { name: "gender", choices: [] };
const COUNTRY_TABLE = { US: "United States" };
check("a country cell's display text is looked up by value, not " +
  "trusted from the response's own label placeholder",
  Charts.groupCellLabel(countryMeasureFixture,
    { value: "US", label: "US", count: 5, bucket: null }, COUNTRY_TABLE) ===
  "United States");
check("a code the table does not hold falls back to the response's " +
  "own label rather than rendering nothing",
  Charts.groupCellLabel(countryMeasureFixture,
    { value: "ZZ", label: "ZZ", count: 1, bucket: null }, COUNTRY_TABLE) ===
  "ZZ");
check("the blank cell keeps its own real label even on a choicesFrom " +
  "field - it is not a code to look up",
  Charts.groupCellLabel(countryMeasureFixture,
    { value: null, label: "Not stated", count: 3, bucket: "blank" },
    COUNTRY_TABLE) === "Not stated");
check("a field with real spec labels (gender) passes its label " +
  "straight through, untouched by the country table",
  Charts.groupCellLabel(genderMeasureFixture,
    { value: "male", label: "Male", count: 10, bucket: null },
    COUNTRY_TABLE) === "Male");

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
  // apps/web/charts.js's wireDownload() builds a throwaway <a>, appends
  // it, calls .click() and removes it (0.9-M2-S12, #373's pattern) - a
  // no-op here for the same reason every other real-DOM method on this
  // stub is one: nothing in this file inspects a real navigation.
  el.click = () => {};
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
  "figure-distribution", "groups", "groups-body", "results", "status",
  "show-me", "download"];
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

  // apps/web/charts.js's wireDownload() (0.9-M2-S12, #373's pattern)
  // builds a throwaway <a>, appends it to document.body, clicks it and
  // removes it - a stub with no body at all would leave that call
  // reading undefined, the same gap noted against your-page.test.mjs's
  // own makeFormPage() before it grew one.
  const body = node("body");
  const doc = {
    body,
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
    { name: "country", label: "Country", term: "country",
      kind: "categorical", choicesFrom: "countries" },
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
  // The create-revoke pairing (0.9-M2-S12, #373's pattern, carried to
  // this file's own rebuild): two arrays rather than a count, because a
  // count alone cannot tell "every created URL got revoked" from "one
  // got revoked twice and another leaked".
  const created = [];
  const revoked = [];
  const g = globalThis;
  g.document = doc;
  g.URL.createObjectURL = () => {
    const url = "blob:test-" + created.length;
    created.push(url);
    return url;
  };
  g.URL.revokeObjectURL = (url) => { revoked.push(url); };
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
  g.BINDER_COUNTRIES = { US: "United States", AL: "Albania" };
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
  await pressShowMe(byId);

  return { byId, doc, calls, unitsInputs, created, revoked };
}

async function pressShowMe(byId) {
  await byId.get("show-me").dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
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
 * emits, not an invented shape. 0.9-M2-S10's own note that these
 * fixtures were "deliberately behind the route" (null edges, no groups
 * block) retires here: this suite now drives the rebuilt page, so the
 * fixtures are the landed shape rather than a placeholder for it.
 */
const NOT_ENOUGH_FIXTURE = {
  ok: true, measure: { name: "weight", label: "Weight", term: "weight",
    kind: "bins" }, filter: { field: null, value: null }, floor: 0,
  enough: false, note: "Not enough people for this view.", units: null,
  trend: null, distribution: null, groups: null, self: null,
};

{
  const { byId, calls } = await driven(() => response(200, NOT_ENOUGH_FIXTURE));
  check("Show me fires exactly one GET /charts-data, never /snapshot " +
    "and never the page's own /charts URL",
    calls.length === 1 &&
    new URL(calls[0]).pathname === "/charts-data" &&
    !calls.some((u) => u.includes("/snapshot")));
  /*
   * Owner ruling 7, #243: the honest sentence plus a broader-filter
   * hint, the only refusal state left at the shipped floor of 0. The
   * route's own note still renders verbatim, as a leading substring -
   * the page adds the hint, it never replaces or rewords the route's
   * own sentence.
   */
  check("the empty view renders the route's own sentence verbatim, as " +
    "the start of the status line - never a string this page composed " +
    "in its place",
    byId.get("status")._text.indexOf(NOT_ENOUGH_FIXTURE.note) === 0);
  check("the empty view appends a broader-filter hint after the " +
    "route's sentence",
    byId.get("status")._text.includes("broader filter"));
  check("the not-enough state carries no error class - content on a " +
    "200, indistinguishable from any other state (security mandate 4)",
    byId.get("status").className === "status");
  check("nothing is drawn when there is nothing to draw",
    byId.get("picture-trend").hidden === true &&
    byId.get("picture-distribution").hidden === true);
  check("the group makeup block stays hidden on an empty view",
    byId.get("groups").hidden === true);
}

/*
 * A small, hand-picked distribution: three plain (never null) closed
 * bands. Used for the status line, download, units-toggle and F2
 * fallback arms below, where the point is the SYSTEM the numbers come
 * from rather than the shape of a large grid - BANDS_FIXTURE further
 * down is the dedicated fixture for the "every band draws, captions
 * sparse" property.
 */
const ENOUGH_FIXTURE = {
  ok: true,
  measure: { name: "weight", label: "Weight", term: "weight", kind: "bins" },
  filter: { field: null, value: null },
  floor: 0,
  enough: true,
  note: null,
  units: { metric: { unit: "kg" }, imperial: { unit: "lb" } },
  trend: { points: [
    { period: "2026-06", people: 6, average: { metric: 80, imperial: 176.4 } },
    { period: "2026-08", people: 7, average: { metric: 81, imperial: 178.6 } },
  ] },
  distribution: {
    kind: "bins",
    partition: { system: "imperial", unit: "lb", band: "20 lb bands" },
    bins: [
      { count: 6, from: { metric: 20, imperial: 44 },
        to: { metric: 70, imperial: 154 } },
      { count: 3, from: { metric: 70, imperial: 154 },
        to: { metric: 90, imperial: 198 } },
      { count: 7, from: { metric: 90, imperial: 198 },
        to: { metric: 227, imperial: 500 } },
    ],
  },
  groups: [
    { field: "gender", label: "Gender", term: "gender", multiple: false,
      values: [
        { value: "male", label: "Male", count: 10, bucket: null },
        { value: "female", label: "Female", count: 8, bucket: null },
        { value: "nonbinary", label: "Non-binary", count: 0, bucket: null },
        { value: null, label: "Not stated", count: 2, bucket: "blank" },
      ] },
    /*
     * Country: the hard case (server/charts-agg.js's own header, since
     * the 2026-08-19 sitting, #371 comment 5347769320). Its choices live
     * outside the spec, so the route lists no zeros - only the codes the
     * group really holds - and `label` is the code itself, a
     * placeholder the response's own comment says the page holding the
     * list is meant to replace. No "Other" entry, no non-binary-shaped
     * zero row: two codes present, the blank line always included.
     */
    { field: "country", label: "Country", term: "country", multiple: false,
      values: [
        { value: "US", label: "US", count: 5, bucket: null },
        { value: "AL", label: "AL", count: 1, bucket: null },
        { value: null, label: "Not stated", count: 3, bucket: "blank" },
      ] },
  ],
  self: { points: [
    { at: "2026-06-05T00:00:00.000Z", value: { metric: 79, imperial: 174.2 } },
    { at: "2026-08-11T00:00:00.000Z", value: { metric: 82, imperial: 180.8 } },
  ] },
};

{
  const { byId } = await driven(() => response(200, ENOUGH_FIXTURE));
  check("a real answer draws - the status line names the measure, " +
    "not an error",
    byId.get("status")._text.includes("Weight"));
  check("download is offered once a response exists - the button is " +
    "unhidden",
    byId.get("download").hidden === false);

  /*
   * Owner ruling 1, #243: the measure select itself offers only
   * drawableMeasures() - populateMeasure() is wired to it, not to
   * Fields.measures() directly. measureFixture() carries a categorical
   * "gender" entry beside "weight" precisely so a regression back to
   * the unfiltered list has something to catch here.
   */
  const measureOptions = byId.get("measure").children.map((c) => c.value);
  check("the measure select offers only numeric measures - the " +
    "categorical fixture entry (gender) is never one of its options",
    measureOptions.length === 1 && measureOptions[0] === "weight");

  const svg = byId.get("figure-distribution").querySelector("svg");
  const labels = svg.children.filter((c) => c.tag === "text")
    .map((c) => c._text);
  check("no rendered label uses the retired open-edge shape (\"under " +
    "X\"/\"X and up\") - server/charts-agg.js's openEdge() is gone " +
    "(0.9-M2-S10) and every edge here is a plain number",
    !labels.some((t) => /^under /.test(t) || / and up$/.test(t)));
  check("a distribution label reads as a plain closed range",
    labels.includes("154 lb–198 lb"));

  /*
   * F1's behavioral arm (0.9-M2-S3 fix wave 1, #354 comment
   * 5342979192), carried through the 0.9-M2-S11 reshape and its own
   * review's F1/F2 geometry fix: the rendered bin count and every bar's
   * count/range label are compared against the fixture's OWN bins,
   * index for index, in the response's own order. A client-side pooler
   * or merger reddens here regardless of what it calls itself, because
   * it is asked what actually painted. With only 3 bands spaced 213
   * user units apart and captions well under 100 units wide, nothing
   * here collides, so every caption still paints and this arm reads the
   * same as it always did; the sparse case - where rangeCaptionPlan()/
   * countCaptionPlan() actually drop some - is BANDS_FIXTURE's own arm
   * below.
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

  /* Owner ruling 6, #243: lines never break. Two trend points with a
     gap month (2026-07 carries no point at all) still draw as ONE
     polyline with exactly two vertices - the same segment shape a
     real, gapless pair would draw, no dashing for the missing month. */
  const trendSvg = byId.get("figure-trend").querySelector("svg");
  const groupLine = trendSvg.children.find((c) => c.tag === "polyline" &&
    c.attrs.class === "chart-series series-0");
  check("the group trend draws ONE unbroken polyline across the gap " +
    "month, with exactly the two real points as its vertices",
    groupLine !== undefined &&
    groupLine.attrs.points.trim().split(" ").length === 2);
  const selfLine = trendSvg.children.find((c) => c.tag === "polyline" &&
    c.attrs.class === "chart-series series-1");
  check("the You line bridges the same gap the same way - one " +
    "unbroken polyline, no separate style for the missing month",
    selfLine !== undefined &&
    selfLine.attrs.points.trim().split(" ").length === 2);

  /* Owner ruling 1, #243: the group-makeup block. Plain count lines,
     zeros included, from the response's own `groups` field. */
  const groupsBody = byId.get("groups-body");
  const groupsLines = groupsBody.children.filter((c) => c.tag === "p")
    .map((c) => c._text);
  check("the group makeup card is shown once a drawn answer arrives",
    byId.get("groups").hidden === false);
  check("the group makeup heading names each field, from the response, " +
    "one per categorical field",
    groupsBody.children.some((c) => c.tag === "h3" && c._text === "Gender") &&
    groupsBody.children.some((c) => c.tag === "h3" && c._text === "Country"));
  check("every gender value line reads \"<label>: <count>\" verbatim " +
    "from the response, zeros and the blank cell included, in the " +
    "response's own order - no chart machinery, no bars",
    groupsLines.length === 7 &&
    groupsLines[0] === "Male: 10" &&
    groupsLines[1] === "Female: 8" &&
    groupsLines[2] === "Non-binary: 0" &&
    groupsLines[3] === "Not stated: 2");
  /*
   * The country carry (Prime's wake, S12's review #373): the response
   * sends `label: "US"` (the code, a placeholder) for a choicesFrom
   * field, and this page is the one holding apps/web/countries.js's own
   * table - groupCellLabel() looks the real name up from `value`, never
   * trusting `label` for this field. The blank line keeps its own real
   * label untouched, because it is not a country code to look up.
   */
  check("country lines render the real name looked up from the code " +
    "(value), not the code the response's own label placeholder holds - " +
    "the blank line is untouched",
    groupsLines[4] === "United States: 5" &&
    groupsLines[5] === "Albania: 1" &&
    groupsLines[6] === "Not stated: 3");
}

/*
 * The download's create-use-revoke pairing (0.9-M2-S12, #373, and the
 * carry to this file's rebuild). apps/web/charts.js used to keep a
 * module-level `downloadUrl` assigned once a response arrived and
 * revoked only lazily on the NEXT press - a URL that could sit open for
 * the rest of the tab's life. wireDownload()'s click handler now
 * creates, uses and revokes the object URL synchronously, every press,
 * matching submit.js's own shape since #373 deleted its dead
 * downloadUrl scaffolding - so there is no module-level state left for
 * anything to leak on any exit, by construction rather than by a
 * clearing call this page would have to remember to make.
 */
{
  const { byId, doc, created, revoked } = await driven(() =>
    response(200, ENOUGH_FIXTURE));

  await byId.get("download").dispatch("click");

  // Two arrays, not a count (0.9-M2-S12, #373): a count alone cannot
  // tell "the one URL this click made got revoked" from "some URL,
  // possibly a stale one, got revoked" or "one got revoked twice while
  // another leaked" - dropping the revoke call turns this red without
  // touching what created pushed, which is the pairing a mutation has
  // to be able to break.
  check("clicking download creates exactly one object URL and revokes " +
    "exactly that same one before the handler returns - create, use, " +
    "revoke, all inside the one click",
    created.length === 1 && revoked.length === 1 &&
    revoked[0] === created[0]);
  check("the throwaway trigger anchor is removed from document.body " +
    "after the click - nothing outlives the handler",
    doc.body.children.length === 0);

  const chartsSourceForDownloadState = await read("../apps/web/charts.js");
  check("apps/web/charts.js declares no module-level downloadUrl - the " +
    "create-use-revoke pairing above is the whole mechanism, so there " +
    "is nothing left for anything outside wireDownload() to hold or " +
    "null out",
    !/\bdownloadUrl\b/.test(chartsSourceForDownloadState));
}

/*
 * DISTRIBUTION: NULL IS A DIFFERENT ANSWER FROM A GRID WHOSE BANDS ALL
 * READ ZERO (server/charts-agg.js's own header, since S10's fix wave,
 * #371 F3 - carried to this file on the S11 rebase wake). The two must
 * never render the same way: `distribution: null` (always paired with
 * `enough: false` on the wire, NOT_ENOUGH_FIXTURE above) is the honest
 * sentence with nothing drawn, and a real grid that happens to be
 * entirely zero-count is still a DRAWN answer - every band its own
 * zero-height slot, the every-band-draws property above, not the
 * not-enough state in disguise. The branch this page keys off is
 * `answer.enough` alone, never a read of the bins' own counts - this
 * arm is what would catch a regression to "an all-zero distribution
 * looks like enough:false" reasoning, which the response contract
 * explicitly forbids.
 */
{
  const allZero = Object.assign({}, ENOUGH_FIXTURE, {
    distribution: {
      kind: "bins",
      partition: { system: "imperial", unit: "lb", band: "20 lb bands" },
      bins: [
        { count: 0, from: { metric: 20, imperial: 44 },
          to: { metric: 70, imperial: 154 } },
        { count: 0, from: { metric: 70, imperial: 154 },
          to: { metric: 90, imperial: 198 } },
      ],
    },
  });
  const { byId } = await driven(() => response(200, allZero));
  check("an all-zero grid still draws - the figures are shown, never " +
    "the not-enough sentence",
    byId.get("status")._text.includes("Weight") &&
    !byId.get("status")._text.includes("Not enough"));
  const svg = byId.get("figure-distribution").querySelector("svg");
  const barCounts = svg.children.filter((c) => c.tag === "text" &&
    c.attrs.class === "chart-value").map((c) => c._text);
  check("both zero bands drew their own zero-height slot, index for " +
    "index - the same every-band-draws property, not a suppressed or " +
    "collapsed grid",
    barCounts.length === 2 && barCounts[0] === "0" && barCounts[1] === "0");
}

/*
 * Re-render with the filter (S10's contract: the group makeup describes
 * the FILTERED view). Two Show-me presses in the same session, each
 * answering with its own groups, prove both that a later answer's
 * counts really are the ones drawn and that they REPLACE the earlier
 * ones rather than sitting stale beside them - renderGroups() clears
 * #groups-body before it draws, and this is the arm that would catch a
 * regression to appending instead.
 */
{
  const filteredAnswer = Object.assign({}, ENOUGH_FIXTURE, {
    filter: { field: "gender", value: "male" },
    groups: [
      { field: "gender", label: "Gender", term: "gender", multiple: false,
        values: [{ value: "male", label: "Male", count: 10,
          bucket: null }] },
    ],
  });
  const everyoneAnswer = Object.assign({}, ENOUGH_FIXTURE, {
    groups: [
      { field: "gender", label: "Gender", term: "gender", multiple: false,
        values: [
          { value: "male", label: "Male", count: 10, bucket: null },
          { value: "female", label: "Female", count: 8, bucket: null },
        ] },
    ],
  });
  const answers = [filteredAnswer, everyoneAnswer];
  let served = 0;
  const { byId } = await driven(() => response(200, answers[served++]));

  const firstLines = byId.get("groups-body").children
    .filter((c) => c.tag === "p").map((c) => c._text);
  check("re-render with filter, part 1: a filtered answer's own " +
    "(smaller) group makeup renders",
    firstLines.length === 1 && firstLines[0] === "Male: 10");

  await pressShowMe(byId);
  const secondLines = byId.get("groups-body").children
    .filter((c) => c.tag === "p").map((c) => c._text);
  check("re-render with filter, part 2: pressing Show me again with a " +
    "broader answer REPLACES the group makeup with its own counts, " +
    "not appended beside the filtered view's",
    secondLines.length === 2 &&
    secondLines[0] === "Male: 10" && secondLines[1] === "Female: 8");
}

/*
 * F4 (0.9-M2-S11's review, #372): a category with nothing to say - a
 * raised floor's own absorb cascade emptied it entirely. Unreachable at
 * the shipped floor of 0, but server/charts-agg.js's makeupOf() carries
 * the shape deliberately, and a fixture is how a floor nobody has
 * raised yet still gets proven.
 */
{
  const bareHeading = Object.assign({}, ENOUGH_FIXTURE, {
    groups: [
      { field: "roles", label: "Feedism affiliations", term: "affiliation",
        multiple: true, values: [] },
    ],
  });
  const { byId } = await driven(() => response(200, bareHeading));
  const body = byId.get("groups-body");
  const heading = body.children.find((c) => c.tag === "h3");
  const lines = body.children.filter((c) => c.tag === "p");
  check("F4: a category with an empty values list still paints its " +
    "own heading, from the response",
    heading !== undefined && heading._text === "Feedism affiliations");
  check("F4: ...and exactly one status-tone line under it - the ruled " +
    "sentence, page-composed, nothing else appended (not even the " +
    "multiple hint, since there is nothing to sum)",
    lines.length === 1 &&
    lines[0]._text === "Not enough people to show this." &&
    lines[0].attrs.class === "status");
}

/*
 * F5 (0.9-M2-S11's review, #372): the response's own `multiple` flag,
 * read. Two categories in one answer, one multiple:true and one
 * multiple:false/absent, so the hint's presence tracks the flag alone -
 * never the field name, never whether the count happens to exceed the
 * member count.
 */
{
  const multipleFlag = Object.assign({}, ENOUGH_FIXTURE, {
    groups: [
      { field: "roles", label: "Feedism affiliations", term: "affiliation",
        multiple: true, values: [
          { value: "feeder", label: "Feeder", count: 6, bucket: null },
          { value: "feedee", label: "Feedee", count: 4, bucket: null },
        ] },
      { field: "gender", label: "Gender", term: "gender", multiple: false,
        values: [
          { value: "male", label: "Male", count: 10, bucket: null },
        ] },
    ],
  });
  const { byId } = await driven(() => response(200, multipleFlag));
  const body = byId.get("groups-body");
  const paragraphs = body.children.filter((c) => c.tag === "p");
  const texts = paragraphs.map((c) => c._text);
  const hintText = "Members can choose more than one here, so these " +
    "numbers can add up to more than the group.";
  check("F5: a multiple:true category's own value lines are followed " +
    "by the honest-reading hint",
    texts[0] === "Feeder: 6" && texts[1] === "Feedee: 4" &&
    texts[2] === hintText);
  check("F5: the hint line is render-only prose, not a count - it " +
    "carries a muted tone, distinct from an ordinary value line",
    paragraphs[2] !== undefined && paragraphs[2].attrs.class ===
    "muted small");
  check("F5: a multiple:false category shows no such hint - its own " +
    "last value line is the row's last line too, nothing appended " +
    "after it, even though the earlier multiple:true category's own " +
    "hint IS on the page (proving the flag decides per category, not " +
    "once for the whole answer)",
    texts.length === 4 && texts[3] === "Male: 10" &&
    texts[2].includes("more than one"));
}

/*
 * BANDS_FIXTURE: fourteen bands, one of them empty. Owner ruling 5,
 * #243: "an empty band is an empty slot" - every one of the fourteen
 * draws, the empty one at zero height. Captions are thinned by
 * GEOMETRY now (owner's F1/F2 ruling, #372's review), not by a fixed
 * stride, so this arm computes the expected caption row by calling the
 * same rangeCaptionPlan()/countCaptionPlan() the page itself calls -
 * proving the DOM matches the pure functions exactly, index for index,
 * rather than hardcoding an index list that would silently stop meaning
 * anything the moment either function's algorithm changed.
 */
function makeBands(zeroIndex) {
  const bins = [];
  for (let i = 0; i < 14; i += 1) {
    const from = 44 + i * 20;
    const to = from + 20;
    bins.push({
      count: i === zeroIndex ? 0 : i + 1,
      from: { metric: from, imperial: from },
      to: { metric: to, imperial: to },
    });
  }
  return bins;
}

const BANDS_FIXTURE = Object.assign({}, ENOUGH_FIXTURE, {
  distribution: {
    kind: "bins",
    partition: { system: "imperial", unit: "lb", band: "20 lb bands" },
    bins: makeBands(5),
  },
});

{
  const { byId } = await driven(() => response(200, BANDS_FIXTURE));
  const svg = byId.get("figure-distribution").querySelector("svg");
  const bars = svg.children.filter((c) => c.tag === "rect" &&
    c.attrs.class === "chart-bar");
  const barCounts = svg.children.filter((c) => c.tag === "text" &&
    c.attrs.class === "chart-value").map((c) => c._text);
  const rangeLabels = svg.children.filter((c) => c.tag === "text" &&
    c.attrs.class === "chart-label").map((c) => c._text);
  const bins = BANDS_FIXTURE.distribution.bins;

  check("every one of the 14 bands draws a bar - the empty one is not " +
    "skipped",
    bars.length === 14);
  check("the empty band's bar is a zero-height slot, present on the " +
    "axis rather than omitted",
    Number(bars[5].attrs.height) === 0);

  const slot14 = 640 / bins.length;
  const rangeTexts = bins.map((bin) =>
    Charts.binLabel(bin.from.imperial, bin.to.imperial, "lb"));
  const expectedRangeIndexes = Charts.rangeCaptionPlan(rangeTexts, slot14);
  const countTexts = bins.map((bin) => String(bin.count));
  const expectedCountIndexes = Charts.countCaptionPlan(
    bins.map((bin) => bin.count), slot14);

  check("F1 carried through the reshape: every PAINTED bar's count is " +
    "the response's own, at exactly the positions countCaptionPlan() " +
    "says should carry one - the page calls the same function this " +
    "arm does, so a drift between them reddens here",
    barCounts.length === expectedCountIndexes.length &&
    expectedCountIndexes.every((idx, j) =>
      barCounts[j] === countTexts[idx]));
  check("F1/F2: the rendered range-caption row is exactly the " +
    "positions rangeCaptionPlan() says should carry one, each the " +
    "fixture's own edge numbers, in order",
    rangeLabels.length === expectedRangeIndexes.length &&
    expectedRangeIndexes.every((idx, j) =>
      rangeLabels[j] === rangeTexts[idx]));
  check("F1/F2: on this fixture's own geometry, the range-caption row " +
    "is thinner than the full 14 bands, and the count row still holds " +
    "at least one caption - the fix removes overlapping captions, not " +
    "every caption",
    expectedRangeIndexes.length < 14 && expectedCountIndexes.length > 0);
  check("the first and last range captions are the ones this fixture's " +
    "own plan keeps, never dropped as interior collisions are",
    expectedRangeIndexes[0] === 0 &&
    expectedRangeIndexes[expectedRangeIndexes.length - 1] === 13);
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

/*
 * 0.9-M2-S10's fix wave (#371) carried a cross-check here that read
 * server/charts-agg.js's own source for shape markers (`openEdge()`
 * gone, `rangeOf()`/`gridOf()` present). It is dropped rather than
 * updated: tests/charts-aggregate.test.mjs is the real, exhaustive
 * proof of that file's contract, and a second, weaker proxy of it here
 * - string-matching function names rather than exercising behavior -
 * is exactly the kind of check this suite's own header warns against
 * (the F1 note above: a real second implementation can pass a name
 * check while still doing the wrong thing). This file's job stays what
 * apps/web/charts.js prints from a fixture, not what the server's
 * source text contains.
 */

const EXPECTED = 79;
console.log(failures
  ? `\ncharts-page FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\ncharts-page ran ${performed} checks, expected ${EXPECTED}`
    : `\ncharts-page OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
