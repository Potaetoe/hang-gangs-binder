/*
 * your-page.html, stacked - 0.9-M2-S2 (#353), widened by fix wave 1
 * (#353 comment 5337542314) to close what the review of record found
 * unarmed or unproven: the record read-back's real (string) shape, the
 * delete flow, the download, form.js's own DOM half, and the pre-leave
 * slot's mechanism. Widened again for 0.9-M2-S9 (#370, section 10) and
 * its own review fix wave 1: the prefill's container-absent throw path
 * (F1), its mapping by spec KIND rather than field name (F2), the two
 * guards that mapping depends on (F4), and re-prefilling from the entry
 * a member just saved (F5, Prime's ruling).
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
 *      Sign-out click run, and it leaves no row, no trend node and no
 *      stale in-memory array behind - checked at the DOM AND,
 *      separately, at the private state a units toggle would otherwise
 *      re-render from with no fetch in between. The download's own
 *      object URL is proven where it is created, in the download block
 *      above (0.9-M2-S12, #373): the create-revoke pairing lives inside
 *      wireDownload()'s own click handler, so this function has nothing
 *      left to clear on that front.
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
 *   10. The prefill (#370): over18, gender, roles, country and every
 *      measured field except weight, from the newest CURRENT entry;
 *      nothing prefilled with no history or a failed load; a member's
 *      own edit takes and survives an ORDINARY reload (F4); Sign out
 *      clears it; and the forkability property extended from rendering
 *      to prefill, for a choice-kind, a length-kind AND a weight-kind
 *      field under names the shipped spec never uses (F2). Also: a
 *      throw with #entry-fields unreachable does not strand Sign out's
 *      own teardown (F1), and a successful submit's own reload
 *      re-prefills from what was just saved (F5).
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

// A real countries table, standing for the rest of the loaded file's
// life (every loadFormWired() call after this line, section 10's
// prefill harness included) - the country field's own value
// assignments elsewhere in this file go through .value= directly, so
// they never depended on real options existing, but the pin-order arm
// below (0.9-M2-S14, #380 ruling 4) needs a real table with all three
// pinned codes actually in it.
globalThis.BINDER_COUNTRIES = { US: "United States of America",
  GB: "United Kingdom", CA: "Canada", FR: "France", AL: "Albania" };

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
      // Real DOM reflects the value ATTRIBUTE onto the .value PROPERTY
      // for a checkbox this way (buildChoiceField's multiple branch
      // never sets .value directly, only setAttribute("value", ...)) -
      // without this, a stub checkbox's .value stays "" forever and
      // prefillFields()'s own input.value comparison could never match
      // one, which would be a gap in this harness rather than in the
      // module it is testing.
      if (key === "value") this.value = String(value);
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
// Two arrays, not one - a count of revokes alone cannot tell "every
// created URL got revoked" from "one URL got revoked twice and another
// leaked" (0.9-M2-S12, #373). The pairing check below reads both.
const created = [];
const revoked = [];
globalThis.URL.revokeObjectURL = (url) => revoked.push(url);
globalThis.URL.createObjectURL = () => {
  const url = "blob:test-" + Math.random();
  created.push(url);
  return url;
};
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
    // submit.js's own delete flow toasts its result now (0.9-M3-S33,
    // #454 item 8).
    showToast(message) { page.byId("toast").textContent = message; },
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

/*
 * 0.9-M2-S12 (#373): the create-revoke pairing IS the 0.9-M2-S2 security
 * mandate for the download's object URL - met by construction inside
 * wireDownload()'s own click handler, with no module-level variable
 * (dead scaffolding, deleted this slice) standing in for it. Reading
 * BOTH arrays, not just revoked.length, is what tells "the one URL this
 * click made got revoked" from "some URL got revoked" - dropping the
 * revoke call turns this red without touching what created pushed.
 */
check("every object URL the download click creates is revoked before " +
  "the handler returns - the whole pairing, inside one handler, is the " +
  "mandate's mechanism now",
  created.length === 1 && revoked.length === 1 &&
  revoked[0] === created[0]);

const submitSourceForDownloadState = await read("../apps/web/submit.js");
check("submit.js declares no module-level object-URL state - the " +
  "create-use-revoke pairing above is the whole mechanism, so there is " +
  "no downloadUrl left for anything outside wireDownload() to hold or " +
  "null out",
  !/\bdownloadUrl\b/.test(submitSourceForDownloadState));

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
    // submit.js's own delete flow toasts its result now (0.9-M3-S33,
    // #454 item 8).
    showToast(message) { page.byId("toast").textContent = message; },
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

const entriesRetry = buttonIn(entriesSlotOnFailure);
const callsBeforeRetry = fetchCalls;
await entriesRetry.dispatch("click");
check("pressing it re-fires the read - one more request, not a navigation",
  fetchCalls === callsBeforeRetry + 1);

/* The node held above is the one that was pressed, not whatever the
   redraw put in the slot afterwards - which is the only way to see this
   at all, since a successful retry replaces the control outright. Its
   own comment in submit.js claims it is disabled for the life of the
   attempt; without this the claim is a sentence nothing falsifies, and
   a second press racing the first is what it exists to prevent. */
check("and the control disables itself as it fires, so a second press " +
  "cannot start a race against the read already running",
  entriesRetry.disabled === true);

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
    // submit.js's own delete flow toasts its result now (0.9-M3-S33,
    // #454 item 8).
    showToast(message) { page.byId("toast").textContent = message; },
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
  const toastCalls = [];
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
    // The delete result is a toast now, not a status paragraph inside
    // the row's own action cell (0.9-M3-S33, #454 item 8).
    showToast(message) { toastCalls.push(message); },
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
  return { calls, toastCalls };
}

const deleteRefused = await loadSubmitForDeleteTest(500);
const refusedRow = allRows(page.byId("entries-slot"))[0];
const refusedCell = refusedRow.children[refusedRow.children.length - 1];
await findTag(refusedCell, "button").dispatch("click");
const refusedButtons = refusedCell.children[1];
await refusedButtons.children[0].dispatch("click"); // "Yes, delete"
check("a delete refused with a non-2xx status toasts the retry message, " +
  "not a silent success (#454 item 8)",
  deleteRefused.toastCalls.length === 1 &&
  deleteRefused.toastCalls[0] === "That entry could not be removed — try again.");
check("and the confirm step reverts to the plain Delete button rather " +
  "than staying armed on a failure",
  refusedCell.children.length === 1 &&
  refusedCell.children[0].tag === "button");
check("and the row is not treated as deleted - no reload was requested",
  deleteRefused.calls.filter((c) => c.url.indexOf("/my-entries") !== -1).length === 1);

const deleteAccepted = await loadSubmitForDeleteTest(200);
const acceptedRow = allRows(page.byId("entries-slot"))[0];
const acceptedCell = acceptedRow.children[acceptedRow.children.length - 1];
await findTag(acceptedCell, "button").dispatch("click");
const acceptedButtons = acceptedCell.children[1];
await acceptedButtons.children[0].dispatch("click"); // "Yes, delete"
check("CONTROL: a delete confirmed with a 2xx status IS treated as " +
  "removed - a reload was requested, proving the guard reads the " +
  "status rather than always refusing",
  deleteAccepted.calls.filter((c) => c.url.indexOf("/my-entries") !== -1)
    .length === 2);
check("and toasts Removed. rather than staying silent on success",
  deleteAccepted.toastCalls.length === 1 &&
  deleteAccepted.toastCalls[0] === "Removed.");

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
    // F1, review fix wave 1: `body` already existed as a local variable
    // here (used to build the tree above) but was never attached to the
    // returned document stub - invisible until a check first drove
    // wireDownload()'s own `document.body.appendChild(...)` through this
    // harness, which nothing had before this fix wave's container-absent
    // arm.
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
  const toastCalls = [];
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
    // The result of a submit is a toast now, not the status line
    // (0.9-M3-S33, #454 item 8) - recorded the same way sayCalls
    // records setStatus, so section 6a below can tell the two apart.
    showToast(message) { toastCalls.push(message); },
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
  return { page: formPage, sent, sayCalls, toastCalls };
}

/*
 * Pinned countries, on the FORM's own field (0.9-M2-S14, #380 ruling
 * 4) - the same Fields.orderedChoices()/pinnedCountries() pair the
 * charts filter uses (tests/charts-page.test.mjs), driven here through
 * buildChoiceField() on a real, rendered <select>.
 */
{
  const wired = await loadFormWired();
  const options = wired.page.byId("entry-country").children.map((o) => o.value);
  // The blank "Prefer not to say" option is buildChoiceField's own
  // first append, ahead of anything from countries.js - options[0].
  check("the country field pins the US, the UK and Canada right after " +
    "the blank option, in that order",
    options[1] === "US" && options[2] === "GB" && options[3] === "CA");
  check("the full alphabetical run still follows, pinned codes present " +
    "a second time",
    options.slice(4).join(",") === "AL,CA,FR,GB,US");
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
  return { sent: loaded.sent, dispatched: loaded.page.dispatched,
    toastCalls: loaded.toastCalls };
}

const refused403 = await submitAndObserve(async () =>
  ({ ok: false, status: 403, async json() { return { error: "refused" }; } }));
check("a submit the Worker refuses (403) dispatches no stored event",
  refused403.sent.length === 1 && !refused403.dispatched.includes("binder:submitted"));
check("and the refusal is a toast, naming the Worker's own reason (#454 " +
  "item 8) - never a silent refusal",
  refused403.toastCalls.length === 1 &&
  refused403.toastCalls[0] === "Nothing was stored — try again.");

const refused500 = await submitAndObserve(async () =>
  ({ ok: false, status: 500, async json() { return {}; } }));
check("a server error (500) dispatches no stored event either",
  !refused500.dispatched.includes("binder:submitted"));
check("and toasts the fallback sentence when the Worker sent no `error`",
  refused500.toastCalls.length === 1 &&
  refused500.toastCalls[0] === "Nothing was stored — try again.");

const unreachable = await submitAndObserve(async () => {
  throw new Error("the connection failed");
});
check("a send that never completes dispatches no stored event",
  unreachable.sent.length === 1 &&
  !unreachable.dispatched.includes("binder:submitted"));
check("and toasts the unreachable-network sentence",
  unreachable.toastCalls.length === 1 &&
  unreachable.toastCalls[0] === "Nothing was stored — try again.");

const accepted = await submitAndObserve();
check("CONTROL: the same harness on a successful send DOES dispatch it - " +
  "the three refusals above prove absence against a harness proven to " +
  "notice presence",
  accepted.dispatched.filter((type) => type === "binder:submitted").length === 1);
check("and a successful send toasts the confirmation, not a silent success",
  accepted.toastCalls.length === 1 &&
  accepted.toastCalls[0] === "Added — it now shows in your entries below.");

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
/* 10. The prefill (issue #370): over18, gender, roles, country and     */
/* height from the newest CURRENT entry - never weight - with the      */
/* units radio set from entered.units; nothing prefilled with no        */
/* history or a failed load; a member's own edit takes and stays; no    */
/* storage is touched; Sign out leaves nothing prefilled behind; and a  */
/* fork's added choice field flows through with no edit to form.js or   */
/* submit.js - the same forkability property section 1 proves for       */
/* rendering, extended to the values a control starts holding.          */

// Reset to the shipped spec - section 6b above leaves BINDER_SITE
// pointed at its own scratch copy, and nothing between there and here
// puts it back.
globalThis.BINDER_SITE = SITE;

/*
 * Row 23 is chronologically newest but SUPERSEDED - a prefill that read
 * entries[0] rather than the newest entry with superseded === false
 * would pick up its gender/country/height, and the CONTROL check below
 * proves that would actually be visible (23 and 22 disagree on every
 * prefilled field). Row 21 is the oldest CURRENT row, catching the same
 * class of bug from the other end (oldest-vs-newest). Row 22 is the one
 * every prefill check below expects.
 */
const PREFILL_ENTRIES = [
  { id: 23, receivedAt: "2026-08-19T00:00:00.000Z", superseded: true,
    record: JSON.stringify({ over18: true, weight: { lb: 220, kg: 99.8 },
      height: { cm: 190, totalInches: 74.8, feet: 6, inches: 2.8 },
      gender: "other", roles: ["feeder"], country: "FR",
      entered: { units: "imperial" } }) },
  { id: 22, receivedAt: "2026-08-18T00:00:00.000Z", superseded: false,
    record: JSON.stringify({ over18: true, weight: { lb: 205, kg: 93.0 },
      height: { cm: 180, totalInches: 70.9, feet: 5, inches: 10.9 },
      gender: "nonbinary", roles: ["feeder", "admirer"], country: "CA",
      entered: { units: "metric" } }) },
  { id: 21, receivedAt: "2026-08-17T00:00:00.000Z", superseded: false,
    record: JSON.stringify({ over18: true, weight: { lb: 200, kg: 90.7 },
      height: { cm: 175, totalInches: 68.9, feet: 5, inches: 9 },
      gender: "male", roles: ["gainer"], country: "US",
      entered: { units: "imperial" } }) },
];

check("CONTROL: the superseded row (23) actually disagrees with the " +
  "newest current row (22) on every prefilled field - the currency " +
  "checks below are not vacuous",
  JSON.parse(PREFILL_ENTRIES[0].record).gender !==
    JSON.parse(PREFILL_ENTRIES[1].record).gender &&
  JSON.parse(PREFILL_ENTRIES[0].record).country !==
    JSON.parse(PREFILL_ENTRIES[1].record).country);

// Calls recorded against any storage this section's harness stubs -
// the direct probe for "ZERO storage writes anywhere in the feature"
// (the S2 storage mandate stands; this feature gains no sibling write).
const storageCalls = [];
function watchedStore() {
  return {
    setItem() { storageCalls.push("setItem"); },
    removeItem() { storageCalls.push("removeItem"); },
    getItem() { storageCalls.push("getItem"); return null; },
  };
}

/*
 * form.js and submit.js, loaded into ONE shared document - form.js
 * first (it renders the fields and, once this slice lands, defines the
 * prefill bridge), then submit.js (it fetches /my-entries and, once
 * this slice lands, calls that bridge with the newest current record).
 * Two separate BinderUI.boot captures because each file calls boot()
 * once at its own load time and this harness needs both promises, not
 * just the second one overwriting the first.
 */
async function loadCombinedForPrefill(options) {
  const opts = options || {};
  const formPage = makeFormPage();
  globalThis.document = formPage.document;
  globalThis.BINDER_CONFIG = { endpoint: "https://worker.example" };
  if (opts.site) globalThis.BINDER_SITE = opts.site;

  let formBooted = null;
  globalThis.BinderUI = {
    byId: formPage.byId,
    show(element, visible) { if (element) element.hidden = !visible; },
    checkedValue(name, fallback) {
      if (name !== "units") return fallback;
      const chosen = formPage.document.querySelectorAll('input[name="units"]')
        .find((input) => input.checked);
      return chosen ? chosen.value : fallback;
    },
    setStatus(element, message) {
      if (element) { element.textContent = message || ""; element.hidden = !message; }
    },
    // submit.js's own delete flow toasts its result now (0.9-M3-S33,
    // #454 item 8) - a harness with no showToast at all is how a
    // successful delete inside this loader's own pages first surfaced
    // "UI.showToast is not a function" as an uncaught rejection rather
    // than a failed check.
    showToast(message) { formPage.byId("toast").textContent = message; },
    boot(setUp) { formBooted = Promise.resolve(setUp()); return formBooted; },
  };
  globalThis.BinderSession = {
    read() { return { username: "member" }; },
    require() { return { username: "member" }; },
    authorization() { return { Authorization: "Bearer token" }; },
    clear() {},
  };

  const formSource = await read("../apps/web/form.js");
  await import("data:text/javascript," + encodeURIComponent(formSource) +
    "#prefill-form-" + Math.random());
  await formBooted;

  let submitBooted = null;
  globalThis.BinderUI.boot = function (setUp) {
    submitBooted = Promise.resolve(setUp());
    return submitBooted;
  };
  globalThis.BinderSignOut = { signOut() {} };
  globalThis.BinderXlsx = { build() { return new Uint8Array([1]); } };
  globalThis.fetch = async () => opts.failFetch
    ? { ok: false, status: 500, async json() { return {}; } }
    : { ok: true, status: 200,
        async json() { return { ok: true, entries: opts.entries || [] }; } };

  const submitSource = await read("../apps/web/submit.js");
  await import("data:text/javascript," + encodeURIComponent(submitSource) +
    "#prefill-submit-" + Math.random());
  await submitBooted;

  return formPage;
}

const prefillPage = await loadCombinedForPrefill({ entries: PREFILL_ENTRIES });

check("the age confirmation prefills from the newest CURRENT entry (row " +
  "22), not the superseded row 23",
  prefillPage.byId("entry-over18").checked === true);
check("gender prefills from the newest CURRENT entry, not the superseded " +
  "or the older current one",
  prefillPage.byId("entry-gender").value === "nonbinary");
check("the multi-choice affiliations prefill as the newest CURRENT " +
  "entry's own set",
  JSON.stringify(prefillPage.document.querySelectorAll('input[name="roles"]')
    .filter((i) => i.checked).map((i) => i.value).sort()) ===
  JSON.stringify(["admirer", "feeder"]));
check("country prefills from the newest CURRENT entry",
  prefillPage.byId("entry-country").value === "CA");
check("height's metric box prefills from the newest CURRENT entry's cm",
  prefillPage.byId("entry-height-metric").value === "180");
check("height's imperial boxes prefill from the same record's fixed " +
  "feet/inches pair, the same one buildRecord's own addHeightFeetInches " +
  "computes",
  prefillPage.byId("entry-height-imperial").value === "5" &&
  prefillPage.byId("entry-height-imperial-compound").value === "10.9");
check("the units radio is set from the newest CURRENT entry's own " +
  "entered.units - metric here, not the imperial default this page ships",
  prefillPage.byId("units-metric").checked === true &&
  prefillPage.byId("units-imperial").checked === false);
check("weight is NEVER prefilled, in either unit system - it is the new " +
  "measurement this visit is for",
  prefillPage.byId("entry-weight-imperial").value === "" &&
  prefillPage.byId("entry-weight-metric").value === "");
check("nothing is locked: a prefilled field carries no disabled or " +
  "readonly attribute",
  !prefillPage.byId("entry-gender").disabled &&
  prefillPage.byId("entry-gender").getAttribute("readonly") === null &&
  !prefillPage.byId("entry-over18").disabled &&
  !prefillPage.byId("entry-height-imperial").disabled);

prefillPage.byId("entry-gender").value = "female";
check("editable after prefill: a member's own change actually takes and " +
  "nothing reverts it",
  prefillPage.byId("entry-gender").value === "female");

/*
 * F4 (review fix wave 1): the prefillApplied guard's real path. A
 * confirmed delete fires an ORDINARY reload through renderEntries()'s
 * own onChanged callback (loadEntries() again, same as a retry) - the
 * exact shape of second call the guard exists to survive. Deleting the
 * `if (prefillApplied) return;` line in prefillFromEntries() reddens
 * this specific check: without it, this same reload re-runs
 * prefillFields() and reverts the edit above back to record 22's own
 * "nonbinary".
 */
const prefillCurrentRows = allRows(prefillPage.byId("entries-slot"));
const prefillDeleteCell =
  prefillCurrentRows[1].children[prefillCurrentRows[1].children.length - 1];
await findTag(prefillDeleteCell, "button").dispatch("click"); // "Delete"
await prefillDeleteCell.children[1].children[0].dispatch("click"); // "Yes, delete"
await new Promise((resolve) => setTimeout(resolve, 0));
check("F4: the prefillApplied guard's real path - a later ORDINARY " +
  "reload (here, the one a confirmed delete fires through its own " +
  "onChanged callback) does not re-run the prefill and clobber the " +
  "member's own edit above",
  prefillPage.byId("entry-gender").value === "female");

const emptyPage = await loadCombinedForPrefill({ entries: [] });
check("no history: the form renders exactly as today - nothing prefills",
  emptyPage.byId("entry-over18").checked === false &&
  emptyPage.byId("entry-gender").value === "" &&
  emptyPage.byId("entry-country").value === "" &&
  emptyPage.byId("entry-height-metric").value === "" &&
  emptyPage.byId("units-imperial").checked === true);

const failedPage = await loadCombinedForPrefill(
  { entries: PREFILL_ENTRIES, failFetch: true });
check("a failed load: the form renders exactly as today - the prefill is " +
  "a bonus on success, never a dependency, and the failed-load state and " +
  "retry control are untouched by this feature",
  failedPage.byId("entry-over18").checked === false &&
  failedPage.byId("entry-gender").value === "" &&
  failedPage.byId("units-imperial").checked === true &&
  Boolean(failedPage.byId("entries-slot").children
    .find((c) => /could not be loaded/.test(c.textContent))));

const originalLocalStorage = globalThis.localStorage;
const originalSessionStorage = globalThis.sessionStorage;
const originalIndexedDB = globalThis.indexedDB;
storageCalls.length = 0;
globalThis.localStorage = watchedStore();
globalThis.sessionStorage = watchedStore();
globalThis.indexedDB = { open() { storageCalls.push("indexedDB.open"); return {}; } };
await loadCombinedForPrefill({ entries: PREFILL_ENTRIES });
check("the whole prefill flow - fetch, fill, and a member's own edit - " +
  "writes nothing to localStorage, sessionStorage or IndexedDB",
  storageCalls.length === 0);
globalThis.localStorage = originalLocalStorage;
globalThis.sessionStorage = originalSessionStorage;
globalThis.indexedDB = originalIndexedDB;

const clearPage = await loadCombinedForPrefill({ entries: PREFILL_ENTRIES });
check("CONTROL: before Sign out, the prefilled fields actually hold the " +
  "newest entry's values",
  clearPage.byId("entry-gender").value === "nonbinary");
clearPage.byId("sign-out").dispatch("click");
check("Sign out clears every prefilled field - idle expiry runs the same " +
  "clearMemberData(), so no prefilled value outlives either exit",
  clearPage.byId("entry-over18").checked === false &&
  clearPage.byId("entry-gender").value === "" &&
  clearPage.byId("entry-country").value === "" &&
  clearPage.byId("entry-height-metric").value === "" &&
  clearPage.byId("entry-height-imperial").value === "" &&
  clearPage.byId("entry-height-imperial-compound").value === "" &&
  clearPage.document.querySelectorAll('input[name="roles"]')
    .every((i) => i.checked === false) &&
  clearPage.byId("units-imperial").checked === true);

/* THE PROPERTY ITSELF, for prefill: a scratch field added to a copy of
   the spec (the same SCRATCH pattern section 1 and 6b use) prefills
   with no edit to form.js or submit.js - the mapping walks the spec's
   own field list rather than naming "gender" or "country" anywhere.
   Widened for F2 (review fix wave 1) with the reviewer's own fork rig
   shape: a length-kind field and a weight-kind field, both under names
   the shipped spec never uses, proving the mapping is read from KIND
   rather than from "height" or "weight" as literal strings. */
const SCRATCH_PREFILL_FIELD = Object.freeze({
  ...SITE,
  fields: Object.freeze([...SITE.fields,
    Object.freeze({
      name: "vibe", kind: "choice", label: "Vibe check", term: "vibe",
      blank: "Prefer not to say",
      choices: [{ value: "chill", label: "Chill" }, { value: "hype", label: "Hype" }],
      chart: true,
    }),
    Object.freeze({
      name: "waist", kind: "length", label: "Waist", term: "waist",
      chart: true,
    }),
    Object.freeze({
      name: "grip", kind: "weight", label: "Grip load", term: "grip load",
      chart: true,
    }),
  ]),
});
const SCRATCH_ENTRIES = [
  { id: 31, receivedAt: "2026-08-19T00:00:00.000Z", superseded: false,
    record: JSON.stringify({ over18: true, weight: { lb: 150, kg: 68.0 },
      height: { cm: 165, totalInches: 65, feet: 5, inches: 5 },
      gender: "female", roles: [], country: "US", vibe: "hype",
      waist: { cm: 90, totalInches: 35.4 }, grip: { kg: 45, lb: 99.2 },
      entered: { units: "imperial" } }) },
];
const scratchPage = await loadCombinedForPrefill(
  { entries: SCRATCH_ENTRIES, site: SCRATCH_PREFILL_FIELD });
check("a fork's added choice field prefills too, with no edit to form.js " +
  "or submit.js - the forkability property, extended from rendering " +
  "(section 1) to the values a control starts holding",
  scratchPage.byId("entry-vibe").value === "hype");
check("F2: a fork's added LENGTH-kind field prefills too, mapped by kind " +
  "- not a second literal name check standing beside \"height\"",
  scratchPage.byId("entry-waist-metric").value === "90");
check("F2: ...its imperial boxes too, split via the spec's own ft/in " +
  "conversion factor rather than anything specific to \"height\"",
  scratchPage.byId("entry-waist-imperial").value === "2" &&
  scratchPage.byId("entry-waist-imperial-compound").value === "11.4");
check("F2: a fork's added WEIGHT-kind field is skipped BY KIND, not by " +
  "the literal name \"weight\" - it stays empty even though its own " +
  "record carries a value, the same rule the shipped weight field " +
  "follows",
  scratchPage.byId("entry-grip-metric").value === "" &&
  scratchPage.byId("entry-grip-imperial").value === "");
globalThis.BINDER_SITE = SITE;

/* ------------------------------------------------------------------ */
/* F1 (review fix wave 1): a throw inside clearPrefilledFields() must    */
/* never strand the rest of clearMemberData()'s own teardown - the       */
/* reviewer's own scenario is #entry-fields itself unreachable to        */
/* submit.js (form.js's own onError hid the form; submit.js still        */
/* fetched and still owns Sign out). Simulated by swapping BinderUI.byId */
/* to one that answers null for "entry-fields" ONLY once submit.js loads */
/* - form.js loads first, against the real container, so its own         */
/* renderFields() still succeeds; this arm is about submit.js's own read */
/* of a container it can no longer find, not a form that never rendered. */

async function loadForContainerAbsent() {
  const formPage = makeFormPage();
  globalThis.document = formPage.document;
  globalThis.BINDER_CONFIG = { endpoint: "https://worker.example" };
  let formBooted = null;
  globalThis.BinderUI = {
    byId: formPage.byId,
    show(element, visible) { if (element) element.hidden = !visible; },
    checkedValue(name, fallback) {
      if (name !== "units") return fallback;
      const chosen = formPage.document.querySelectorAll('input[name="units"]')
        .find((input) => input.checked);
      return chosen ? chosen.value : fallback;
    },
    setStatus(element, message) {
      if (element) { element.textContent = message || ""; element.hidden = !message; }
    },
    // submit.js's own delete flow toasts its result now (0.9-M3-S33,
    // #454 item 8) - a harness with no showToast at all is how a
    // successful delete inside this loader's own pages first surfaced
    // "UI.showToast is not a function" as an uncaught rejection rather
    // than a failed check.
    showToast(message) { formPage.byId("toast").textContent = message; },
    boot(setUp) { formBooted = Promise.resolve(setUp()); return formBooted; },
  };
  globalThis.BinderSession = {
    read() { return { username: "member" }; },
    require() { return { username: "member" }; },
    authorization() { return { Authorization: "Bearer token" }; },
    clear() {},
  };
  const formSource = await read("../apps/web/form.js");
  await import("data:text/javascript," + encodeURIComponent(formSource) +
    "#container-absent-form-" + Math.random());
  await formBooted;

  // submit.js's own $ is captured from HERE on - "entry-fields" now
  // reads null for it, the reviewer's own scenario (F1), while form.js
  // (already loaded, above) keeps working from what it already rendered.
  let submitBooted = null;
  globalThis.BinderUI.byId = (id) =>
    id === "entry-fields" ? null : formPage.byId(id);
  globalThis.BinderUI.boot = function (setUp) {
    submitBooted = Promise.resolve(setUp());
    return submitBooted;
  };
  globalThis.BinderSignOut = { signOut() {} };
  globalThis.BinderXlsx = { build() { return new Uint8Array([1]); } };
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    async json() { return { ok: true, entries: PREFILL_ENTRIES }; },
  });

  const submitSource = await read("../apps/web/submit.js");
  await import("data:text/javascript," + encodeURIComponent(submitSource) +
    "#container-absent-submit-" + Math.random());
  await submitBooted;
  return formPage;
}

const containerAbsentPage = await loadForContainerAbsent();
check("CONTROL: before Sign out, the trend and entries slots hold the " +
  "loaded rows - the clear below actually has something to erase",
  containerAbsentPage.byId("trend-slot").children.length > 0 &&
  containerAbsentPage.byId("entries-slot").children.length > 0);
containerAbsentPage.byId("sign-out").dispatch("click");
check("F1: with #entry-fields unreachable, Sign out still empties the " +
  "entries slot - a throw inside clearPrefilledFields() no longer " +
  "strands the teardown ahead of it in clearMemberData()",
  containerAbsentPage.byId("entries-slot").children.length === 0);
check("F1: and the trend slot too",
  containerAbsentPage.byId("trend-slot").children.length === 0);

/* ------------------------------------------------------------------ */
/* F5 (Prime's ruling on #370, review fix wave 1): a successful submit  */
/* is the ONE reload allowed to re-prefill - form.js dispatches         */
/* binder:submitted only once the Worker has actually accepted the      */
/* write (section 6a above), so this is the one signal trustworthy      */
/* enough to let the guard run again. Driven here by dispatching that    */
/* same event directly against a fetch mock swapped to answer the entry  */
/* just saved as the newest CURRENT row - the member's own next reload,  */
/* not form.js's submit wiring, is what this file is answerable for.     */

const resubmitPage = await loadCombinedForPrefill({ entries: PREFILL_ENTRIES });
check("CONTROL: before any resubmit, the ORIGINAL newest entry prefilled",
  resubmitPage.byId("entry-gender").value === "nonbinary" &&
  resubmitPage.byId("units-metric").checked === true);

const JUST_SAVED_ENTRY = {
  id: 99, receivedAt: "2026-08-19T13:00:00.000Z", superseded: false,
  record: JSON.stringify({ over18: true, weight: { lb: 180, kg: 81.6 },
    height: { cm: 185, totalInches: 72.8 }, gender: "male",
    roles: ["admirer"], country: "FR", entered: { units: "imperial" } }),
};
globalThis.fetch = async () => ({ ok: true, status: 200,
  async json() { return { ok: true,
    entries: [JUST_SAVED_ENTRY].concat(
      PREFILL_ENTRIES.map((e) => Object.assign({}, e, { superseded: true }))) }; } });
resubmitPage.document.dispatchEvent({ type: "binder:submitted" });
await new Promise((resolve) => setTimeout(resolve, 0));

check("F5: after a successful submit, the stable fields re-prefill from " +
  "the entry JUST SAVED, not the one that prefilled before it",
  resubmitPage.byId("entry-gender").value === "male" &&
  resubmitPage.byId("entry-country").value === "FR" &&
  resubmitPage.byId("entry-height-metric").value === "185");
check("F5: and the units radio follows what was actually just submitted",
  resubmitPage.byId("units-imperial").checked === true &&
  resubmitPage.byId("units-metric").checked === false);
check("F5: weight stays blank for the next measurement, even right after " +
  "a submit that carried one",
  resubmitPage.byId("entry-weight-imperial").value === "" &&
  resubmitPage.byId("entry-weight-metric").value === "");

/* ------------------------------------------------------------------ */
const EXPECTED = 116;
console.log(failures
  ? `\nyour-page FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\nyour-page ran ${performed} checks, expected ${EXPECTED}`
    : `\nyour-page OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
