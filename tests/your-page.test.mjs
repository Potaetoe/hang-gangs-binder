/*
 * your-page.html, stacked - 0.9-M2-S2 (#353), widened by fix wave 1
 * (#353 comment 5337542314) to close what the review of record found
 * unarmed or unproven: the record read-back's real (string) shape, the
 * delete flow, the download, form.js's own DOM half, and the pre-leave
 * slot's mechanism.
 *
 *     node tests/your-page.test.mjs
 *
 * Subject: apps/web/form.js (the spec-derived form, the record it
 * builds, and its own DOM wiring - the required-choice error slot and
 * the binder:submitted event) and apps/web/submit.js (the entries
 * list, the trend, delete, download and the one clearing function).
 * Idle expiry's SHARED clearing function is proven (section 5); its
 * own ten-minute timer is not - driving it would need clock-mocking
 * this suite has judged not worth its cost (see the comment beside
 * endForIdle()'s own check, below).
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
 *   3a. F1: submit.js actually PARSES the JSON STRING GET /my-entries
 *      sends for each row's record, against a fixture corrected to that
 *      real shape - a value cell, the trend figure, the conversion
 *      notice, the delete confirmation and the xlsx export all read a
 *      real value rather than the em-dash the unparsed bug produced.
 *   4. The entries list's correction reveal: replaced rows render muted,
 *      hidden, in their chronological position; one disclosure reveals
 *      all of them in place without moving anything; nothing is a
 *      per-row toggle.
 *   5. The one clearing function: it is what both idle expiry and a
 *      Sign-out click run, and it leaves no row, no trend node, no
 *      object URL and no stale in-memory array behind - checked at the
 *      DOM AND, separately, at the private state a units toggle would
 *      otherwise re-render from with no fetch in between.
 *   6. F8: a failed load writes its own honest sentence into BOTH the
 *      entries slot and the trend slot, never leaving the trend a bare
 *      runner around nothing - and each slot carries one control that
 *      re-fires the read in place, proven by a stub that fails once and
 *      then succeeds (0.9-M2-S8, #365).
 *   7. F3: the delete flow's 2xx guard and clearMemberData's abort, each
 *      armed both directions - a refused delete shows the retry message
 *      and requests no reload; a confirmed one does; an in-flight GET
 *      is aborted rather than left to resolve into a cleared page.
 *   8. form.js's own DOM half: binder:submitted fires only on a write
 *      the Worker actually accepted (re-homing the property
 *      dev/form.test.mjs proved before this file replaced the hand-kept
 *      form); and F6, a required choice's own error slot, present in
 *      the rendered tree and not merely registered by id.
 *   9. F7: the pre-leave notice's slot carries the door's own mechanism
 *      - a bracketed filler plus a data-pending-copy attribute an HTML
 *      comment cannot give, since ./run build strips comments and never
 *      touches attributes.
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
// Every element's scrollIntoView call, by id, in order - shared across
// every page this file builds. showProblems() (form.js) and the delete
// flow (submit.js) both scroll a specific slot into view on a failure;
// a check that only asked "did scrollIntoView run anywhere" could not
// tell that call apart from an unrelated one, so this records WHICH
// element, and the F6 arm below reads it by id.
const SCROLL_CALLS = [];

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
    // Returns what every listener returned, awaited together - an
    // async listener (the delete flow's own "Yes, delete" handler) has
    // to actually finish before a caller that awaits this can read what
    // it changed, and a caller that never awaits it (every synchronous
    // handler this file already tests) sees no difference at all.
    // preventDefault is a no-op rather than absent: form.js's own submit
    // listener calls it unconditionally, and every other listener this
    // file drives simply never reaches for it.
    dispatch(type) {
      const event = { type: type, preventDefault: function () {} };
      const results = [];
      for (const fn of listeners.get(type) || []) results.push(fn.call(this, event));
      return Promise.all(results);
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
    // form.js's own submit handler calls form.reset() on a successful
    // send; a no-op here for the same reason every other real-DOM
    // method on this stub is one - nothing in this file inspects
    // post-reset field values.
    reset() {},
    // submit.js's download flow appends a throwaway <a> to the body,
    // clicks it and removes it - a no-op is right here for the same
    // reason: nothing in this file inspects a real navigation.
    click() {},
    // The id ATTRIBUTE, not the constructor's `id` closure - an element
    // built via document.createElement and given an id afterward (every
    // field-error slot form.js builds) keeps its ORIGINAL "created-p"
    // for the `id` field forever; setAttribute("id", ...) only ever
    // updates the attribute and the registry (see the comment above
    // findById() for the same distinction). Reading the closure `id`
    // here would record which TAG scrolled, not which SLOT.
    scrollIntoView() { SCROLL_CALLS.push(node.getAttribute("id") || id); },
  };
  return node;
}

/*
 * A tiny selector engine. Started as just enough for submit.js's own
 * two shapes ("tr[data-superseded]", tag plus attribute presence, and
 * 'input[name="units"]', handled by the page-level stub rather than
 * here) and widened for form.js's wiring, which asks for a bare
 * attribute with no tag ("[data-units-group]") and an attribute VALUE
 * ("[data-field=\"weight\"]") - neither shape submit.js needed.
 */
function queryAll(root, selector) {
  const found = /^(\w+)?\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
  if (!found) return [];
  const [, tag, attr, value] = found;
  const out = [];
  (function walk(node) {
    for (const child of node.children) {
      const held = child.getAttribute(attr);
      const tagOk = !tag || child.tag === tag;
      const attrOk = value === undefined ? held !== null : held === value;
      if (tagOk && attrOk) out.push(child);
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
  // The download flow's own throwaway anchor is appended to and removed
  // from document.body (real DOM's own idiom for a no-navigation
  // click); nothing else on this page's real markup routes through it.
  const body = makeElement("body", elements);
  const doc = {
    getElementById: byId,
    body: body,
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
 *
 * `record` is a JSON STRING, not an object - the review of record on
 * #353 (comment 5337542314, finding F1) caught this fixture handing
 * OBJECTS while GET /my-entries actually answers with each row's
 * record as the text store-crypto's openRow() decoded it to (the
 * Worker never parses it; handleCharts does, for its own reasons,
 * which is what made this suite's own gap invisible - every check
 * below stayed green against a shape the real endpoint never sends).
 * submit.js's loadEntries() now parses each row after the fetch
 * (parseRecord()); this fixture is what it parses FROM.
 *
 * Row 1's entered.units is "metric" and row 3's is "imperial" - on
 * purpose, so the two CURRENT rows disagree, which is what the
 * conversion notice below (F1) needs to fire.
 */
const ENTRIES = [
  { id: 3, receivedAt: "2026-08-19T00:00:00.000Z", superseded: false,
    record: JSON.stringify({ weight: { lb: 210, kg: 95.3 },
      height: { cm: 178, totalInches: 70 }, entered: { units: "imperial" } }) },
  { id: 2, receivedAt: "2026-08-18T00:00:00.000Z", superseded: true,
    record: JSON.stringify({ weight: { lb: 205, kg: 93.0 },
      height: { cm: 178, totalInches: 70 }, entered: { units: "imperial" } }) },
  { id: 1, receivedAt: "2026-08-17T00:00:00.000Z", superseded: false,
    record: JSON.stringify({ weight: { lb: 200, kg: 90.7 },
      height: { cm: 178, totalInches: 70 }, entered: { units: "metric" } }) },
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

/* ------------------------------------------------------------------ */
/* F1 (review of record on #353, comment 5337542314): the read-back.    */
/* GET /my-entries hands back a JSON STRING per row; parseRecord() in    */
/* submit.js turns it into an object before anything below reads it -    */
/* checked here against the SAME fixture the rest of this section uses,  */
/* which is now the real (stringified) shape. Reverting the parse (so    */
/* loadEntries() assigns payload.entries straight through, the shape     */
/* the branch shipped) turns every check in this block red against       */
/* this same fixture - the fixture alone proved nothing; the page has    */
/* to actually parse what it is handed.                                  */

check("a value cell renders the weight, not an em-dash - the parse " +
  "actually ran",
  trs[0].children[1].textContent === "210 lb" &&
  trs[2].children[1].textContent === "200 lb");
check("and the height and bmi cells too - not just weight",
  trs[0].children[2].textContent === "5 ft 10 in" &&
  trs[0].children[3].textContent !== "—");

const trendSlot = page.byId("trend-slot");
const trendFigure = findTag(trendSlot, "figure");
check("two current entries draw a <figure>, not the empty-state <p> - " +
  "children.length alone cannot tell those two apart",
  trendSlot.children.length > 0 && trendSlot.children[0].tag === "figure" &&
  Boolean(trendFigure));
check("the figure actually carries a drawn line",
  Boolean(trendFigure) && Boolean(findTag(trendFigure, "polyline")));
check("the conversion notice fires - row 1 was entered in metric, row 3 " +
  "in imperial, and imperial is the default view",
  trendSlot.children.some((c) => /were converted/.test(c.textContent)));

const deleteCell = trs[0].children[trs[0].children.length - 1];
const deleteButton = findTag(deleteCell, "button");
await deleteButton.dispatch("click");
const confirmText = deleteCell.children.map((c) => c.textContent).join(" ");
check("the delete confirmation names the row's own value, not a bare " +
  "'that entry' - the record parsed, so weightDisplay() has something " +
  "to read",
  confirmText.indexOf("210 lb") !== -1 && confirmText.indexOf("that entry") === -1);

let xlsxRows = null;
globalThis.BinderXlsx = {
  build(columns, rows) { xlsxRows = rows; return new Uint8Array([1]); },
};
page.byId("download").dispatch("click");
check("the xlsx export carries non-blank value columns for every row",
  Array.isArray(xlsxRows) && xlsxRows.length === ENTRIES.length &&
  xlsxRows.every((row) => row[1] !== "" && row[2] !== "" && row[4] !== "" &&
    row[5] !== ""));

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

/*
 * F3 (review of record on #353, finding F3): clearMemberData() resets
 * the `entries` ARRAY, not merely the DOM the array had already drawn -
 * a check that only reads the emptied slot (above) cannot tell "the
 * array was reset" from "the DOM was wiped and the array sits there
 * unread until the next render", and only the second of those is a
 * defect (mutating `entries = [];` away leaves every check above
 * green). A units toggle re-renders from whatever `entries` still
 * holds, with no fetch in between - the same real user action wired in
 * setUp() - so firing one after Sign out is the honest way to ask
 * whether the private state actually went with the DOM.
 */
await page.document.querySelectorAll('input[name="units"]')[0]
  .dispatch("change");
check("after Sign out, a stray units-change event does not resurrect the " +
  "cleared rows - the array was actually reset, not just the DOM",
  allRows(page.byId("entries-slot")).length === 0);

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
/* F8 (review of record on #353, finding F8): a failed GET /my-entries  */
/* must not leave the trend section a bare runner with nothing under    */
/* it - your-page.html's own comment on #trend-slot says the section    */
/* "stays in flow even with nothing to draw yet", and a load failure is */
/* exactly the kind of nothing-to-draw-yet that comment covers.         */

async function loadSubmitWithFailedFetch() {
  page = makePage();
  globalThis.document = page.document;
  globalThis.BINDER_CONFIG = { endpoint: "https://worker.example" };
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
  globalThis.BinderSignOut = { signOut() {} };
  globalThis.BinderXlsx = { build() { return new Uint8Array([1]); } };
  // Fails on the first call and succeeds on every one after it, so the
  // retry arm below can drive a real recovery rather than asserting a
  // click was merely wired to something.
  fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) return { ok: false, status: 500,
      async json() { return {}; } };
    return { ok: true, status: 200,
      async json() { return { ok: true, entries: ENTRIES }; } };
  };

  const submitSource = await read("../apps/web/submit.js");
  await import("data:text/javascript," +
    encodeURIComponent(submitSource) + "#failed-fetch-" + Math.random());
  await booted;
}

let fetchCalls = 0;

await loadSubmitWithFailedFetch();
const trendSlotOnFailure = page.byId("trend-slot");
const entriesSlotOnFailure = page.byId("entries-slot");

const sentenceIn = (slot) => slot.children
  .find((child) => /could not be loaded/.test(child.textContent));
const buttonIn = (slot) => slot.children.find((child) => child.tag === "button");

check("a failed load writes the entries slot's own honest sentence",
  Boolean(sentenceIn(entriesSlotOnFailure)));
check("and the trend slot too - not left bare while the runner stays in " +
  "flow around nothing",
  Boolean(sentenceIn(trendSlotOnFailure)));

/* ------------------------------------------------------------------ */
/* The retry control (0.9-M2-S8, #365, the owner's own request). The    */
/* sentence used to say "reload the page" and offer nothing to press -  */
/* a whole-page reload to recover from one failed read. Each failed     */
/* slot now carries exactly one button, in the page's existing          */
/* .secondary grammar, and pressing it re-fires the SAME load in place. */

for (const [name, slot] of [
  ["entries", entriesSlotOnFailure], ["trend", trendSlotOnFailure],
]) {
  const button = buttonIn(slot);
  check(`the ${name} slot's failed state carries exactly one control, a ` +
    "secondary button, and no longer tells anybody to reload the page",
    Boolean(button) &&
    slot.children.filter((c) => c.tag === "button").length === 1 &&
    button.className === "secondary" &&
    button.getAttribute("type") === "button" &&
    !/reload the page/.test(slot.children.map((c) => c.textContent).join(" ")));
}

const callsBeforeRetry = fetchCalls;
await buttonIn(entriesSlotOnFailure).dispatch("click");
check("pressing it re-fires the read - one more request, not a navigation",
  fetchCalls === callsBeforeRetry + 1);

check("and a successful retry replaces the failure with the real rows, " +
  "in place",
  allRows(page.byId("entries-slot")).length > 0 &&
  !sentenceIn(page.byId("entries-slot")));
check("the trend slot recovers with it - one read redraws both sections",
  page.byId("trend-slot").children.length > 0 &&
  !sentenceIn(page.byId("trend-slot")));

/* The trend slot's own button, proven separately: two slots each
   carrying a control that re-fires the same load is what the ticket
   asks for, and a check that only ever pressed one of them would not
   notice the other being inert. */
await loadSubmitWithFailedFetch();
const trendRetry = buttonIn(page.byId("trend-slot"));
const callsBeforeTrendRetry = fetchCalls;
await trendRetry.dispatch("click");
check("the trend slot's own control re-fires the read too",
  fetchCalls === callsBeforeTrendRetry + 1 &&
  allRows(page.byId("entries-slot")).length > 0);

/* ------------------------------------------------------------------ */
/* F3 (review of record on #353, finding F3): clearMemberData() aborts  */
/* an in-flight GET /my-entries rather than leaving it to resolve into  */
/* a page that was just told to hold nothing. The boot load resolves    */
/* normally; the SECOND load (fired by binder:submitted, exactly the    */
/* event a real submission dispatches) hangs forever, so it is still    */
/* in flight when Sign out runs.                                        */

const abortControllers = [];
globalThis.AbortController = class AbortController {
  constructor() { this.signal = {}; this.aborted = false; abortControllers.push(this); }
  abort() { this.aborted = true; }
};

async function loadSubmitForAbortTest() {
  page = makePage();
  globalThis.document = page.document;
  globalThis.BINDER_CONFIG = { endpoint: "https://worker.example" };
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
  globalThis.BinderSignOut = { signOut() {} };
  globalThis.BinderXlsx = { build() { return new Uint8Array([1]); } };
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) {
      return { ok: true, status: 200,
        async json() { return { ok: true, entries: ENTRIES }; } };
    }
    return new Promise(function () {}); // the second call never resolves
  };

  const submitSource = await read("../apps/web/submit.js");
  await import("data:text/javascript," +
    encodeURIComponent(submitSource) + "#abort-" + Math.random());
  await booted;
}

await loadSubmitForAbortTest();
page.document.dispatchEvent({ type: "binder:submitted" });
const pendingController = abortControllers[abortControllers.length - 1];
check("CONTROL: the second load's controller exists and has not aborted " +
  "itself",
  Boolean(pendingController) && pendingController.aborted === false);
page.byId("sign-out").dispatch("click");
check("clearMemberData aborts an in-flight GET /my-entries rather than " +
  "leaving it to resolve into a page it was just told to clear",
  pendingController.aborted === true);

/* ------------------------------------------------------------------ */
/* F3: the delete flow's 2xx guard, both directions - the review found  */
/* it correct but unarmed (a mutated `if (false)` left the suite green).*/

async function loadSubmitForDeleteTest(deleteStatus) {
  page = makePage();
  globalThis.document = page.document;
  globalThis.BINDER_CONFIG = { endpoint: "https://worker.example" };
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
  globalThis.BinderSignOut = { signOut() {} };
  globalThis.BinderXlsx = { build() { return new Uint8Array([1]); } };
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: (init && init.method) || "GET" });
    if (String(url).indexOf("/submission/") !== -1) {
      return { ok: deleteStatus >= 200 && deleteStatus < 300, status: deleteStatus,
        async json() { return {}; } };
    }
    return { ok: true, status: 200,
      async json() { return { ok: true, entries: ENTRIES }; } };
  };

  const submitSource = await read("../apps/web/submit.js");
  await import("data:text/javascript," +
    encodeURIComponent(submitSource) + "#delete-" + deleteStatus + "-" +
    Math.random());
  await booted;
  return calls;
}

const refusedCalls = await loadSubmitForDeleteTest(500);
const refusedRow = allRows(page.byId("entries-slot"))[0];
const refusedCell = refusedRow.children[refusedRow.children.length - 1];
await findTag(refusedCell, "button").dispatch("click");
const refusedButtons = refusedCell.children[1];
await refusedButtons.children[0].dispatch("click"); // "Yes, delete"
check("a delete refused with a non-2xx status shows the retry message, " +
  "not a silent success",
  refusedCell.children[1].textContent ===
    "That entry could not be removed — try again." &&
  refusedCell.children[1].hidden === false);
check("and the row is not treated as deleted - no reload was requested",
  refusedCalls.filter((c) => c.url.indexOf("/my-entries") !== -1).length === 1);

const acceptedCalls = await loadSubmitForDeleteTest(200);
const acceptedRow = allRows(page.byId("entries-slot"))[0];
const acceptedCell = acceptedRow.children[acceptedRow.children.length - 1];
await findTag(acceptedCell, "button").dispatch("click");
const acceptedButtons = acceptedCell.children[1];
await acceptedButtons.children[0].dispatch("click"); // "Yes, delete"
check("CONTROL: a delete confirmed with a 2xx status IS treated as " +
  "removed - a reload was requested, proving the guard reads the " +
  "status rather than always refusing",
  acceptedCalls.filter((c) => c.url.indexOf("/my-entries") !== -1).length === 2);

/* ------------------------------------------------------------------ */
/* 6. form.js's own DOM half - never exercised in tests/ before this    */
/* wave, since only its pure half (section 2 above) was. Two           */
/* properties: the binder:submitted event dev/form.test.mjs proved      */
/* before this file replaced the hand-kept form (fires on a stored      */
/* write and only then), re-homed against the spec-derived form; and    */
/* F6's required-choice error slot.                                     */

function makeFormPage() {
  const elements = new Map();
  const byId = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement(id, elements));
    return elements.get(id);
  };
  const body = makeElement("form-page-body", elements);
  const submission = byId("submission");
  submission.tag = "form";
  const entryFields = byId("entry-fields");
  const submitButton = byId("submit");
  const status = byId("status");
  const closed = byId("closed");
  body.appendChild(submission);
  submission.appendChild(entryFields);
  submission.appendChild(submitButton);
  submission.appendChild(status);
  body.appendChild(closed);

  const unitsImperial = byId("units-imperial");
  unitsImperial.setAttribute("name", "units");
  unitsImperial.value = "imperial";
  unitsImperial.checked = true;
  const unitsMetric = byId("units-metric");
  unitsMetric.setAttribute("name", "units");
  unitsMetric.value = "metric";
  body.appendChild(unitsImperial);
  body.appendChild(unitsMetric);

  const documentListeners = new Map();
  const dispatched = [];
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
    // form.js's own two shapes: the units toggle (hardcoded, matching
    // every other harness in this file) and everything queryAll's now-
    // widened pattern covers - applyUnits()'s "[data-units-group]" on a
    // CONTAINER reaches makeElement's own querySelectorAll instead of
    // this one, but inputsFor()'s document-level
    // '[data-field="name"]' has nowhere to walk from except here.
    querySelectorAll(selector) {
      if (selector === 'input[name="units"]') return [unitsImperial, unitsMetric];
      return queryAll(body, selector);
    },
    querySelector() { return null; },
    addEventListener(type, fn) {
      const list = documentListeners.get(type) || [];
      list.push(fn);
      documentListeners.set(type, list);
    },
    dispatchEvent(event) {
      dispatched.push(event.type);
      for (const fn of documentListeners.get(event.type) || []) fn.call(doc, event);
      return true;
    },
  };
  return { document: doc, byId, submission, dispatched, body };
}

async function loadFormWired(fetchImpl) {
  const formPage = makeFormPage();
  globalThis.document = formPage.document;
  globalThis.BINDER_CONFIG = { endpoint: "https://worker.example" };
  let booted = null;
  const sayCalls = [];
  globalThis.BinderUI = {
    byId: formPage.byId,
    show(element, visible) { if (element) element.hidden = !visible; },
    checkedValue(name, fallback) {
      if (name !== "units") return fallback;
      const chosen = formPage.document.querySelectorAll('input[name="units"]')
        .find((input) => input.checked);
      return chosen ? chosen.value : fallback;
    },
    setStatus(element, message, tone) {
      sayCalls.push({ message: message, tone: tone });
      if (element) {
        element.textContent = message || "";
        element.hidden = !message;
      }
    },
    boot(setUp) { booted = Promise.resolve(setUp()); return booted; },
  };
  globalThis.BinderSession = {
    read() { return { username: "member" }; },
    require() { return { username: "member" }; },
    authorization() { return { Authorization: "Bearer token" }; },
    clear() {},
  };
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push(String(url));
    return fetchImpl ? fetchImpl(url, init)
      : { ok: true, status: 200, async json() { return { ok: true }; } };
  };

  const formSource = await read("../apps/web/form.js");
  await import("data:text/javascript," +
    encodeURIComponent(formSource) + "#form-wired-" + Math.random());
  await booted;
  return { page: formPage, sent, sayCalls };
}

function fillValidEntry(byId) {
  byId("entry-over18").checked = true;
  byId("entry-weight-imperial").value = "150";
  byId("entry-height-imperial").value = "5";
  byId("entry-height-imperial-compound").value = "6";
}

/*
 * 6a. binder:submitted fires only on a write the Worker actually
 * accepted - the same four-scenario shape dev/form.test.mjs proved
 * against the hand-kept form (a refusal, a server error, an
 * unreachable network, and the control that confirms the harness can
 * observe a dispatch at all when one happens).
 */
async function submitAndObserve(fetchImpl) {
  const loaded = await loadFormWired(fetchImpl);
  fillValidEntry(loaded.page.byId);
  await loaded.page.submission.dispatch("submit");
  return { sent: loaded.sent, dispatched: loaded.page.dispatched };
}

const refused403 = await submitAndObserve(async () =>
  ({ ok: false, status: 403, async json() { return { error: "refused" }; } }));
check("a submit the Worker refuses (403) dispatches no stored event",
  refused403.sent.length === 1 && !refused403.dispatched.includes("binder:submitted"));

const refused500 = await submitAndObserve(async () =>
  ({ ok: false, status: 500, async json() { return {}; } }));
check("a server error (500) dispatches no stored event either",
  !refused500.dispatched.includes("binder:submitted"));

const unreachable = await submitAndObserve(async () => {
  throw new Error("the connection failed");
});
check("a send that never completes dispatches no stored event",
  unreachable.sent.length === 1 &&
  !unreachable.dispatched.includes("binder:submitted"));

const accepted = await submitAndObserve();
check("CONTROL: the same harness on a successful send DOES dispatch it - " +
  "the three refusals above prove absence against a harness proven to " +
  "notice presence",
  accepted.dispatched.filter((type) => type === "binder:submitted").length === 1);

/*
 * 6b (F6). A required choice, and only it, left unanswered - every
 * other required field is filled, so the ONE problem validate() finds
 * is the choice's own. SCRATCH_REQUIRED_CHOICE reuses the shipped
 * spec's own "gender" field (already single-select, already carrying
 * a blank option) with required:true added - the smallest edit that
 * makes the fork property (#278) apply to a choice for the first time.
 */
const SCRATCH_REQUIRED_CHOICE = Object.freeze({
  ...SITE,
  fields: Object.freeze(SITE.fields.map((field) =>
    field.name === "gender"
      ? Object.freeze({ ...field, required: true })
      : field)),
});
globalThis.BINDER_SITE = SCRATCH_REQUIRED_CHOICE;

const choiceResult = await loadFormWired();
fillValidEntry(choiceResult.page.byId);
// gender left at its stub default ("") - nothing selected.
await choiceResult.page.submission.dispatch("submit");

/*
 * Read back through findById() - a WALK of the actually-appended tree -
 * rather than $()/byId(), which auto-vivifies a phantom placeholder for
 * any id nothing has registered yet (the same mechanism that lets this
 * file's own $() stand in for a real getElementById elsewhere). Under
 * the unfixed buildChoiceField, showProblems()'s own $("error-gender")
 * would auto-vivify that phantom and write the message onto it - correct
 * text, hidden correctly, and never attached to anything a member could
 * see. Only a tree walk tells a slot that exists from one that doesn't.
 */
const genderErrorInTree = findById(choiceResult.page.body, "error-gender");
check("a required choice left blank shows the named message in its own " +
  "error slot, actually present in the rendered tree - F6's fix, " +
  "buildChoiceField gaining what its three siblings already had",
  Boolean(genderErrorInTree) &&
  genderErrorInTree.textContent === "Gender is required." &&
  genderErrorInTree.hidden === false);
check("and the page scrolls to that slot specifically",
  SCROLL_CALLS[SCROLL_CALLS.length - 1] === "error-gender");
check("and say() carries text - the general status is never left blank " +
  "on a refused submit, field-level slot or not",
  choiceResult.sayCalls.length > 0 &&
  choiceResult.sayCalls[choiceResult.sayCalls.length - 1].message ===
    "Gender is required.");

/* ------------------------------------------------------------------ */
/* F7 (owner ruling on #355, comment 5337476261, carried into this      */
/* page by the #353 fix-wave review, finding F7): the pre-leave slot    */
/* adopts the door's own mechanism - mirrors tests/door.test.mjs's own  */
/* structural check for index.html's privacy-line, the pin this one     */
/* now shares in tools/check_web.py's RULED_LINES.                      */

const preLeaveTagMatch = /<p\b[^>]*\bid="pre-leave-notice"[^>]*>/
  .exec(yourPageHtml);
const preLeaveTagText = preLeaveTagMatch === null ? "" : preLeaveTagMatch[0];

check("the pre-leave slot carries the pending-copy marker, not unmarked " +
  "invented copy - a comment cannot give this, because ./run build " +
  "strips comments and never touches attributes",
  /\bdata-pending-copy="0\.9-M4"/.test(preLeaveTagText));
check("the slot paints - no hidden attribute, no display-suppressing " +
  "inline style",
  preLeaveTagMatch !== null &&
  !/\bhidden\b/.test(preLeaveTagText) &&
  !/\bstyle\s*=\s*"[^"]*display\s*:\s*none/i.test(preLeaveTagText));
check("the filler reads as a placeholder, not shipped copy - bracketed, " +
  "naming the 0.9-M4 register sitting",
  /\[Pre-leave notice[\s\S]*?0\.9-M4\s+register sitting\.\]/.test(yourPageHtml));
check("your-page.html carries no data-dev-session hook - 0.9-M2-S4 owns " +
  "the painter it would have called; this page never got its own back",
  !/data-dev-session/.test(yourPageHtml));

/* ------------------------------------------------------------------ */
const EXPECTED = 77;
console.log(failures
  ? `\nyour-page FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\nyour-page ran ${performed} checks, expected ${EXPECTED}`
    : `\nyour-page OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
