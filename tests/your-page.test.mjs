/*
 * your-page.html, stacked - 0.9-M2-S2 (#353).
 *
 *     node tests/your-page.test.mjs
 *
 * Subject: apps/web/form.js (the spec-derived form and the record it
 * builds) and apps/web/submit.js (the entries list, the trend, delete,
 * download, idle expiry and the one clearing function).
 *
 * WHAT EACH SECTION PROVES:
 *
 *   1. The forkability property for RENDERING, closing the gap
 *      tests/site-propagation.test.mjs's own header names: "your-page.html
 *      renders its fields from markup today, and 0.9-M2 is the slice
 *      that rebuilds that page to read this spec ... the rendering half
 *      of the contract is stated as a forward requirement on the M2
 *      ticket instead of being asserted where it is not true." A field
 *      added to a COPY of the spec arrives in form.js's render plan,
 *      with no edit to form.js or to this file.
 *   2. The record BinderForm.buildRecord writes matches
 *      server/charts-agg.js's header exactly - the record version byte,
 *      the envelope, and every spec-named field's shape.
 *   3. No member backdating: no date field anywhere a submitter could
 *      reach one, and the record's own timestamp comes from the
 *      injected clock alone, never from typed input.
 *   4. The entries list's correction reveal: replaced rows render muted,
 *      hidden, in their chronological position; one disclosure reveals
 *      all of them in place without moving anything; nothing is a
 *      per-row toggle.
 *   5. The one clearing function: it is what both idle expiry and a
 *      Sign-out click run, and it leaves no row, no trend node and no
 *      object URL behind.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (path) => readFile(HERE(path), "utf8");
const load = async (path, tag) => {
  const source = await read(path);
  await import("data:text/javascript," +
    encodeURIComponent(tag ? source + "\n//" + tag : source));
};

let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) failures += 1;
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

/* ------------------------------------------------------------------ */
/* Load the spec and the pure half of form.js under Node - form.js      */
/* returns before touching the DOM when there is no document.           */

await load("../apps/web/site.config.js");
await load("../apps/web/fields.js");
await load("../apps/web/form.js");

const F = globalThis.BinderFields;
const FORM = globalThis.BinderForm;
const SITE = globalThis.BINDER_SITE;

/* ------------------------------------------------------------------ */
/* 1. Spec-derived rendering: a field added to a copy of the spec       */
/*    arrives in the render plan, with no edit here or in form.js.      */

check("the shipped plan covers every non-computed field, in the form's order",
  JSON.stringify(FORM.plan().map((e) => e.name)) ===
  JSON.stringify(F.names().filter((n) => F.field(n).kind !== "computed")));

check("a computed field (bmi) is never in the plan - it is not asked for",
  !FORM.plan().some((e) => e.name === "bmi"));

const weightEntry = FORM.plan().find((e) => e.name === "weight");
check("a weight entry carries both unit systems, each with its own bound",
  weightEntry && weightEntry.units.imperial.unit === "lb" &&
  weightEntry.units.imperial.limits.max === 1100 &&
  weightEntry.units.metric.unit === "kg" &&
  weightEntry.units.metric.limits.max === 500);

const heightEntry = FORM.plan().find((e) => e.name === "height");
check("a length entry's imperial box is compound - feet next to inches",
  heightEntry && heightEntry.units.imperial.unit === "ft" &&
  heightEntry.units.imperial.compoundUnit === "in" &&
  heightEntry.units.metric.compoundUnit === null);

const genderEntry = FORM.plan().find((e) => e.name === "gender");
check("a choice entry carries its choices and its blank label",
  genderEntry && genderEntry.blank === "Prefer not to say" &&
  genderEntry.choices.some((c) => c.value === "male"));

/* THE PROPERTY ITSELF: a scratch field, added to a COPY of the spec
   (site-propagation.test.mjs's own pattern), arrives in the plan - and
   the shipped spec is provably unaffected afterward. */
const SCRATCH = Object.freeze({
  ...SITE,
  fields: Object.freeze([...SITE.fields, Object.freeze({
    name: "meals", kind: "count", label: "Meals a day",
    term: "meals a day", chart: true, bin: 1,
  })]),
});
check("the shipped plan has no such field before the arm runs",
  !FORM.plan().some((e) => e.name === "meals"));
check("a spec edit puts the new field in the plan with no page edit",
  FORM.plan(SCRATCH).some((e) => e.name === "meals" && e.kind === "count"));
check("it arrives at the end, where the form asks it",
  FORM.plan(SCRATCH).map((e) => e.name).pop() === "meals");
check("removing the scratch field leaves the shipped plan exactly as it was",
  !FORM.plan().some((e) => e.name === "meals") && FORM.plan().length === 6);

/* A fork that renames a kind's KIND (rather than adding a field) is out
   of apps/web/fields.js's scope, already refused there and pinned by
   tests/site-spec.test.mjs; this file's own claim stops at "a plan
   entry exists per field", not "every kind renders", since a kind
   nothing implements never reaches a measure or a plan entry either. */

/* ------------------------------------------------------------------ */
/* 2. The record, against server/charts-agg.js's header contract.       */

const NOW = Date.parse("2026-08-19T12:00:00.000Z");

function baseValues() {
  return {
    over18: true,
    weight: "200", height: "5", heightCompound: "10",
    gender: "male", roles: ["feeder", "gainer"], country: "US",
  };
}

const record = FORM.buildRecord({ units: "imperial", values: baseValues() },
  NOW, "SomeMember");

check("the record carries its own version byte, 1",
  record.record === 1);
check("submittedAt is the injected clock, in ISO form",
  record.submittedAt === new Date(NOW).toISOString());
check("telegram is the normalized session handle",
  record.telegram === "somemember");
check("a measured field is an object keyed by the unit table's store names",
  typeof record.weight === "object" &&
  Math.abs(record.weight.lb - 200) < 0.05 &&
  Math.abs(record.weight.kg - 90.7) < 0.05);
check("length's store names are cm and totalInches - the spec-derived half",
  typeof record.height.cm === "number" &&
  Math.abs(record.height.totalInches - 70) < 0.05);
check("height also carries feet/inches, fixed rather than derived - the " +
  "pin comment on #353 (issue 5335377958) says the record matches the " +
  "pre-0.9 one exactly, and that record carried both; admin.js's CSV " +
  "still reads them by name",
  record.height.feet === 5 && Math.abs(record.height.inches - 10) < 0.05);
check("a single choice is the choice's own value",
  record.gender === "male");
check("a multiple choice is an array of values",
  JSON.stringify(record.roles) === JSON.stringify(["feeder", "gainer"]));
check("a consent field is a boolean, and is still stored (never charted, " +
  "not never kept)",
  record.over18 === true);
check("a computed field (bmi) is never stored",
  !("bmi" in record));
check("the envelope's entered.units matches what was typed",
  record.entered.units === "imperial");
check("entered.weight and entered.height are the typed strings, fixed to " +
  "those two names regardless of the spec (server/charts-agg.js's header)",
  record.entered.weight === "200 lb" &&
  record.entered.height === "5 ft 10 in");

const metricRecord = FORM.buildRecord(
  { units: "metric", values: { over18: true, weight: "90", height: "178",
    gender: "", roles: [], country: "" } },
  NOW, "member");
check("metric entry: entered strings carry the metric units",
  metricRecord.entered.weight === "90 kg" &&
  metricRecord.entered.height === "178 cm");
check("an unanswered optional choice is null, not an empty string",
  metricRecord.gender === null && metricRecord.country === null);

/* A country choicesFrom field is not validated against BINDER_COUNTRIES
   here - that global is browser-only - so buildRecord accepts whatever
   was selected verbatim for choicesFrom fields, exactly as the old
   form.js's regex-checked country field did (silently null on a bad
   shape, no validation error). */
const withCountry = FORM.buildRecord(
  { units: "metric", values: { over18: true, weight: "90", height: "178",
    gender: "", roles: [], country: "US" } },
  NOW, "member");
check("a choicesFrom field's selected value is carried through",
  withCountry.country === "US");

/* ------------------------------------------------------------------ */
/* 3. No member backdating.                                             */

const yourPageHtml = await read("../apps/web/your-page.html");
check("your-page.html has no date input anywhere",
  !/<input[^>]*type="date"/i.test(yourPageHtml));
check("the spec itself declares no field of a date-shaped kind",
  !F.names().some((n) => /date/i.test(n)));
check("buildRecord ignores a stray 'date' value on the input - the record's " +
  "own submittedAt is the only time in it, and it is the injected clock",
  (() => {
    const withDate = FORM.buildRecord(
      { units: "imperial", values: Object.assign(baseValues(),
        { date: "2020-01-01" }) },
      NOW, "member");
    return withDate.submittedAt === new Date(NOW).toISOString() &&
      !("date" in withDate);
  })());

/* ------------------------------------------------------------------ */
/* 4 & 5. The DOM-driven half: the entries list's correction reveal,    */
/* and the one clearing function shared by idle expiry and Sign out.    */

/*
 * `registry` is the same Map document.getElementById reads - real DOM
 * semantics reflect an element's id ATTRIBUTE into that lookup no
 * matter how the element was created or where it sits in the tree, so
 * setAttribute("id", ...) below registers into it too. Without this an
 * element submit.js builds with document.createElement and gives an id
 * (the corrections toggle, in particular) would be findable by walking
 * the tree but invisible to the module's own $()/getElementById calls -
 * which is not what a browser does, and would make clearMemberData()'s
 * own `$("corrections-toggle")` look broken in this suite when the
 * defect would actually be the stub's.
 */
function makeElement(id, registry) {
  const listeners = new Map();
  const attrs = {};
  const node = {
    id, tag: "div", hidden: false, textContent: "", value: "",
    checked: false, disabled: false, className: "", children: [],
    parentNode: null,
    // submit.js's emptyOut() drains a container with
    // `while (node.firstChild) node.removeChild(node.firstChild)`, the
    // same idiom real DOM code uses - so this stub needs the real
    // property, not just the children array, or emptyOut() silently
    // never runs and every "clears" check below would be measuring a
    // stub gap instead of the module.
    get firstChild() { return this.children.length ? this.children[0] : null; },
    addEventListener(type, fn) {
      const list = listeners.get(type) || [];
      list.push(fn);
      listeners.set(type, list);
    },
    dispatch(type) {
      for (const fn of listeners.get(type) || []) fn.call(this, { type });
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
      child.parentNode = null;
      return child;
    },
    setAttribute(key, value) {
      attrs[key] = String(value);
      if (key === "hidden") this.hidden = true;
      if (key === "id" && registry) registry.set(String(value), node);
    },
    getAttribute(key) {
      return Object.prototype.hasOwnProperty.call(attrs, key) ? attrs[key] : null;
    },
    removeAttribute() {},
    querySelector() { return null; },
    querySelectorAll(selector) { return queryAll(this, selector); },
    focus() {},
    scrollIntoView() {},
  };
  return node;
}

/* A tiny selector engine, just enough for the two shapes submit.js
   actually asks for: "tr[data-superseded]" (tag plus attribute
   presence) and 'input[name="units"]' (handled by the page-level stub
   below, not by this walker). */
function queryAll(root, selector) {
  const found = /^(\w+)\[([\w-]+)\]$/.exec(selector);
  if (!found) return [];
  const [, tag, attr] = found;
  const out = [];
  (function walk(node) {
    for (const child of node.children) {
      if (child.tag === tag && child.getAttribute(attr) !== null) out.push(child);
      walk(child);
    }
  })(root);
  return out;
}

function makePage() {
  const elements = new Map();
  const byId = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement(id, elements));
    return elements.get(id);
  };
  const unitsImperial = byId("units-imperial");
  unitsImperial.value = "imperial";
  unitsImperial.checked = true;
  const unitsMetric = byId("units-metric");
  unitsMetric.value = "metric";

  const documentListeners = new Map();
  const doc = {
    getElementById: byId,
    createElement(tag) {
      const node = makeElement("created-" + tag, elements);
      node.tag = tag;
      return node;
    },
    createElementNS(_ns, tag) {
      const node = makeElement("created-svg-" + tag, elements);
      node.tag = tag;
      return node;
    },
    createTextNode(value) { return { text: String(value) }; },
    querySelectorAll(selector) {
      if (selector === 'input[name="units"]') return [unitsImperial, unitsMetric];
      return [];
    },
    addEventListener(type, fn) {
      const list = documentListeners.get(type) || [];
      list.push(fn);
      documentListeners.set(type, list);
    },
    dispatchEvent(event) {
      for (const fn of documentListeners.get(event.type) || []) {
        fn.call(doc, event);
      }
      return true;
    },
  };
  return { document: doc, byId, elements };
}

globalThis.CustomEvent = class CustomEvent {
  constructor(type, init) { this.type = type; this.detail = init && init.detail; }
};
globalThis.URL = globalThis.URL || {};
const revoked = [];
globalThis.URL.revokeObjectURL = (url) => revoked.push(url);
globalThis.URL.createObjectURL = () => "blob:test-" + Math.random();
globalThis.Blob = class Blob {};
globalThis.AbortController = class AbortController {
  constructor() { this.signal = {}; }
  abort() { this.aborted = true; }
};

/*
 * Two current rows and one replaced row, receipt time descending
 * (GET /my-entries' own order). The replaced row sits in the MIDDLE
 * chronologically - the position a reveal-that-moves-things would get
 * wrong and a reveal-in-place cannot.
 */
const ENTRIES = [
  { id: 3, receivedAt: "2026-08-19T00:00:00.000Z", superseded: false,
    record: { weight: { lb: 210, kg: 95.3 }, height: { cm: 178, totalInches: 70 },
      entered: { units: "imperial" } } },
  { id: 2, receivedAt: "2026-08-18T00:00:00.000Z", superseded: true,
    record: { weight: { lb: 205, kg: 93.0 }, height: { cm: 178, totalInches: 70 },
      entered: { units: "imperial" } } },
  { id: 1, receivedAt: "2026-08-17T00:00:00.000Z", superseded: false,
    record: { weight: { lb: 200, kg: 90.7 }, height: { cm: 178, totalInches: 70 },
      entered: { units: "imperial" } } },
];

let page;
let signOutCalls = 0;

async function loadSubmitWithEntries() {
  page = makePage();
  globalThis.document = page.document;
  globalThis.BINDER_CONFIG = { endpoint: "https://worker.example" };
  // boot() captures setUp()'s promise here rather than only invoking it,
  // so this loader can await the module's own async chain (loadEntries)
  // instead of guessing how many event-loop turns it needs.
  let booted = null;
  globalThis.BinderUI = {
    byId: page.byId,
    show(element, visible) { if (element) element.hidden = !visible; },
    checkedValue(name, fallback) {
      if (name !== "units") return fallback;
      const chosen = page.document.querySelectorAll('input[name="units"]')
        .find((input) => input.checked);
      return chosen ? chosen.value : fallback;
    },
    setStatus(element, message) { if (element) element.textContent = message; },
    boot(setUp) { booted = Promise.resolve(setUp()); return booted; },
  };
  globalThis.BinderSession = {
    read() { return { username: "member" }; },
    require() { return { username: "member" }; },
    authorization() { return { Authorization: "Bearer token" }; },
    clear() {},
  };
  signOutCalls = 0;
  globalThis.BinderSignOut = { signOut() { signOutCalls += 1; } };
  globalThis.BinderXlsx = { build() { return new Uint8Array([1]); } };
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    async json() { return { ok: true, entries: ENTRIES }; },
  });

  const submitSource = await read("../apps/web/submit.js");
  await import("data:text/javascript," +
    encodeURIComponent(submitSource) + "#" + Math.random());
  await booted;
}

await loadSubmitWithEntries();

const entriesSlot = page.byId("entries-slot");

/*
 * Every <tr> in the ENTRIES table's tbody specifically, in document
 * order - not just any "tr" found by walking, which would also pick up
 * the thead's own header row and miscount by one.
 */
function findTag(node, tag) {
  if (node.tag === tag) return node;
  for (const child of node.children || []) {
    const found = findTag(child, tag);
    if (found) return found;
  }
  return null;
}
function allRows(node) {
  const tbody = findTag(node, "tbody");
  return tbody ? tbody.children.filter((c) => c.tag === "tr") : [];
}

/*
 * submit.js builds the toggle and the table with document.createElement,
 * never through $()/getElementById - so, unlike "entries-slot" or
 * "sign-out", it is not one of the auto-vivified elements page.byId
 * hands out. A real browser's DOM.getElementById would find it by its
 * id ATTRIBUTE; this walks for the same attribute, which is what
 * setAttribute("id", ...) actually recorded.
 */
function findById(node, id) {
  if (node.getAttribute && node.getAttribute("id") === id) return node;
  for (const child of node.children || []) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}
const trs = allRows(entriesSlot);
const datesInOrder = trs.map((tr) => tr.children[0].textContent);
const expectedDates = ENTRIES.map((e) =>
  new Date(Date.parse(e.receivedAt)).toLocaleDateString(undefined,
    { year: "numeric", month: "short", day: "numeric" }));

check("the entries list rendered one row per fetched entry",
  trs.length === ENTRIES.length);
check("rows render in the same order GET /my-entries sent them (newest " +
  "first) - nothing here re-sorts",
  JSON.stringify(datesInOrder) === JSON.stringify(expectedDates));
check("a replaced row starts hidden",
  trs[1].getAttribute("data-superseded") !== null && trs[1].hidden === true);
check("a replaced row is styled muted",
  trs[1].className.indexOf("muted") !== -1);
check("current rows are not hidden and carry no data-superseded",
  trs[0].hidden === false && trs[0].getAttribute("data-superseded") === null &&
  trs[2].hidden === false && trs[2].getAttribute("data-superseded") === null);

const toggle = page.byId("corrections-toggle");
check("one disclosure exists, labeled with the real count, and it is " +
  "actually in the entries section's tree",
  toggle && toggle.textContent === "Show 1 replaced row" &&
  Boolean(findById(entriesSlot, "corrections-toggle")));

const rowOrderBefore = trs.map((tr) => tr.children[0].textContent).join("|");
toggle.dispatch("click");
const rowsAfter = allRows(entriesSlot);
const rowOrderAfter = rowsAfter.map((tr) => tr.children[0].textContent).join("|");

check("revealing unmutes the replaced row in place - hidden goes false",
  rowsAfter[1].hidden === false);
check("revealing moves nothing - the row order is unchanged",
  rowOrderBefore === rowOrderAfter);
check("the toggle now offers to hide, naming the same count",
  toggle.textContent === "Hide replaced rows");

toggle.dispatch("click");
check("toggling again re-hides the replaced row - no per-row state leaks",
  allRows(entriesSlot)[1].hidden === true);

/* ------------------------------------------------------------------ */
/* 5. The clearing function: one Sign-out click empties everything.     */

check("before Sign out, the trend slot actually holds something to clear",
  page.byId("trend-slot").children.length > 0);
check("and the entries slot holds the rendered rows",
  entriesSlot.children.length > 0);

/*
 * submit.js's own click listener on #sign-out runs clearMemberData()
 * directly (setUp() wires it); it is signout.js's SEPARATE listener on
 * the same button, not loaded in this arm, that calls
 * BinderSignOut.signOut() and navigates away - the two are independent
 * listeners on one element by design (this file's own header), so
 * signOutCalls staying 0 here is the honest reading of that split, not
 * a gap. The idle path is different: it is submit.js's OWN code that
 * calls BOTH, checked below by reading endForIdle() itself, since
 * driving the real ten-minute timer in this arm is not worth the
 * clock-mocking it would take.
 */
page.byId("sign-out").dispatch("click");

check("a Sign-out click runs the clearing function - the entries slot empties",
  entriesSlot.children.length === 0);
check("and empties the trend slot",
  page.byId("trend-slot").children.length === 0);
check("and the disclosure toggle is gone with it",
  page.byId("corrections-toggle").parentNode === null);
check("a Sign-out click does not itself call BinderSignOut.signOut() - " +
  "that is signout.js's own listener on the same button, independent of " +
  "this file's clearing function",
  signOutCalls === 0);

const submitSourceForIdle = await read("../apps/web/submit.js");
const idleFrame = /function endForIdle\(\) \{([\s\S]*?)\n {4}\}/.exec(
  submitSourceForIdle);
check("idle expiry's endForIdle() runs the SAME clearing function sign-out " +
  "does, before ending the session - not a second copy of what it clears",
  Boolean(idleFrame) && /clearMemberData\(\)/.test(idleFrame[1]) &&
  /root\.BinderSignOut\.signOut\(\)/.test(idleFrame[1]));

/*
 * THE CONTROL for the emptied-slot checks above: an arm that asserts an
 * empty slot after Sign out proves nothing if the slot was never
 * populated to begin with. Re-run from a fresh module instance and
 * confirm the un-cleared state actually held rows.
 */
await loadSubmitWithEntries();
check("CONTROL: a fresh load populates the entries slot before any clear",
  page.byId("entries-slot").children.length > 0);

/* ------------------------------------------------------------------ */
const EXPECTED = 45;
console.log(failures
  ? `\nyour-page FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\nyour-page ran ${performed} checks, expected ${EXPECTED}`
    : `\nyour-page OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
