/*
 * The spec is well-formed, and what derives from it is right.
 *
 *     node tests/site-spec.test.mjs
 *
 * Subject: apps/site.config.js, the file a fork edits, and
 * apps/fields.js, the only thing that reads it.
 *
 * WHY THIS LIVES IN tests/ AND CARRIES ITS OWN RUNNER. The 0.9 wave
 * treats the dev/ apparatus as ending with the surfaces it describes
 * (#228), and 0.9-M0-S4 builds what replaces it. So this file imports
 * nothing: the twenty lines at the bottom of this comment's file are a
 * runner, not a framework, and adopting this file into the new runner
 * is a move plus a deletion of those twenty lines rather than a
 * rewrite. Three files in this directory are written the same way for
 * the same reason.
 *
 * WHAT WOULD BE WRONG WITHOUT IT. A conversion factor is the kind of
 * mistake that does not throw and does not look wrong: it produces a
 * plausible number, stores it, and shows up on export day when every
 * row is quietly off by 2.2. Same for a histogram band, a rounding
 * place, a measure that silently computes nothing because its
 * derivation is spelled wrong, a field whose kind nothing implements,
 * and - section 5 - a spec that is never frozen at all because the two
 * <script> tags were written in the other order.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));

/* `tag` is not decoration: a data: URL is its own module specifier, so
   the same file imported twice with the same bytes is served from the
   module cache and evaluated once. Section 5 needs a SECOND, ignorant
   copy of apps/fields.js in this process, and the tag is what makes the
   specifier differ. */
const load = async (path, tag) => {
  const source = await readFile(HERE(path), "utf8");
  await import("data:text/javascript," +
    encodeURIComponent(tag ? source + "\n//" + tag : source));
};

await load("../apps/site.config.js");
await load("../apps/fields.js");

const SITE = globalThis.BINDER_SITE;
const F = globalThis.BinderFields;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b) => Math.abs(a - b) < 1e-9;

const EXPECTED = 44;
let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) failures += 1;
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

/* ------------------------------------------------------------------ */
/* 1. The data file is a data file.                                    */

check("the spec is one object", SITE && typeof SITE === "object");

// In the order the pages will load them - the config's <script> tag
// first - the spec is frozen before anything reads it at all. This is
// the narrower of the two guarantees and the reason apps/fields.js
// still freezes at load as well as on the read: the gap it closes is
// between that file evaluating and the page's first derivation, which
// is a whole page render. Nothing above this line reads the spec, so
// what is asserted here is genuinely the state at load.
check("the config loaded first is frozen before anything reads it",
  Object.isFrozen(SITE) && Object.isFrozen(SITE.fields));

// Frozen all the way down, by the first READ of it. A page will hold
// this object for a whole session, so a same-origin script that could
// push a choice onto a list or move a limit would be editing the form
// after it rendered. The read is written out rather than left to the
// checks below it: what freezes the spec is reading it, and a check
// that happened to run after some other check had read it would pass
// without saying so. Section 5 asserts the same property with the two
// files loaded the other way round.
F.names();
check("the spec is frozen all the way down once anything reads it",
  Object.isFrozen(SITE) && Object.isFrozen(SITE.group) &&
  Object.isFrozen(SITE.fields) &&
  SITE.fields.every((field) => Object.isFrozen(field)) &&
  Object.isFrozen(SITE.units.kinds.weight.units.kg));

// The property behind the criterion above, stated as what an injected
// script actually tries: not "is it frozen" but "can the form still be
// edited after it rendered".
check("a same-origin push onto a choice list changes nothing",
  (() => {
    const choices = F.field("gender").choices;
    const before = choices.map((choice) => choice.value).join(",");
    try {
      choices.push({ value: "injected", label: "Injected" });
    } catch (error) { /* a frozen list throws here, which is the point */ }
    return choices.map((choice) => choice.value).join(",") === before;
  })());

check("the derivations are frozen", Object.isFrozen(F));

check("every field says its name, its kind and its label",
  SITE.fields.every((field) =>
    typeof field.name === "string" && field.name !== "" &&
    typeof field.kind === "string" && field.kind !== "" &&
    typeof field.label === "string" && field.label !== ""));

check("every field says how it reads inside a sentence",
  SITE.fields.every((field) => typeof field.term === "string" &&
    field.term !== ""));

check("no two fields share a name",
  new Set(SITE.fields.map((f) => f.name)).size === SITE.fields.length);

check("every field's kind is one the derivations know",
  SITE.fields.every((field) => F.kinds().includes(field.kind)));

check("every measured field's kind carries a unit table",
  SITE.fields.filter((f) => F.isMeasured(f))
    .every((f) => Object.keys(F.unitsOf(f.kind)).length > 0));

// The kinds with no units are as real as the ones with them, and a
// derivation that threw on them would make a plain count unspellable.
check("a kind with no units answers with an empty table rather than a throw",
  same(F.unitsOf("choice"), {}) && same(F.unitsOf("count"), {}));

check("a field the spec does not declare is refused rather than answered",
  (() => {
    try {
      F.field("waist");
      return false;
    } catch (error) {
      return String(error.message).includes("waist");
    }
  })());

/* ------------------------------------------------------------------ */
/* 2. The group's name, in one config place (#228, Part 4 close).      */

check("the group's name is one string in the spec",
  SITE.group.name === "Hang Gang");
check("the site's title derives from it",
  F.siteTitle() === "Hang Gang Binder");
check("a page title derives from it",
  F.pageTitle("Your page") === "Your page — Hang Gang Binder");
check("the wordmark's two lines derive from it",
  same(F.wordmarkLines(), ["Hang Gang", "Binder"]));

// The one that matters to a fork: rename the group in the config and
// every derived string follows, with nothing else edited anywhere.
const RENAMED = { ...SITE, group: { name: "Bear Club", binder: "Binder" } };
check("renaming the group moves the site title",
  F.siteTitle(RENAMED) === "Bear Club Binder");
check("renaming the group moves every page title",
  F.pageTitle("Your page", RENAMED) === "Your page — Bear Club Binder");
check("renaming the group moves the wordmark",
  same(F.wordmarkLines(RENAMED), ["Bear Club", "Binder"]));

/* ------------------------------------------------------------------ */
/* 3. The chartable-measure list, which 0.9-M2's charts consume.       */

check("the measures are the fields worth drawing, in the form's order",
  same(F.measures().map((m) => m.name),
    ["weight", "height", "bmi", "gender", "roles", "country"]));

// One bit, the same bit for everybody who got as far as submitting.
check("a consent field is never a measure",
  !F.measures().some((m) => m.name === "over18"));

const weight = F.measure("weight");
check("a weight measure is binned and reads a unit system",
  weight.kind === "bins" && weight.unitful === true);
check("a weight measure carries a unit per system",
  weight.units.metric.unit === "kg" && weight.units.imperial.unit === "lb");
check("a weight measure carries the stored property each unit reads",
  weight.units.metric.store === "kg" && weight.units.imperial.store === "lb");
check("a weight measure carries its histogram bands",
  weight.units.metric.bin === 10 && weight.units.imperial.bin === 20 &&
  weight.units.imperial.band === "20 lb bands");

// Nobody says their height in inches and no histogram can be drawn in
// feet-and-inches, so the unit typed and the unit charted differ.
const height = F.measure("height");
check("a length measure charts total inches where the form takes feet",
  height.units.imperial.store === "totalInches" &&
  height.units.imperial.unit === "in");

const bmi = F.measure("bmi");
check("a computed measure names what it is computed from",
  same(bmi.from, ["weight", "height"]) && bmi.unitful === false);
check("a computed measure carries its rounding and its band",
  bmi.places === 1 && bmi.bin === 5);
// Described AND executable. A measure list that only describes BMI
// leaves whoever draws the chart to write the arithmetic a second
// time, and that copy is the one that drifts.
check("a computed measure computes",
  bmi.compute({ weight: 90, height: 178 }) === 28.4);
check("a computed measure is silent about a row it cannot compute",
  bmi.compute({ weight: 90, height: null }) === null &&
  bmi.compute({ weight: null, height: 178 }) === null &&
  bmi.compute({ weight: 90, height: 0 }) === null);

const gender = F.measure("gender");
check("a choice measure is categorical and carries its choices",
  gender.kind === "categorical" &&
  same(gender.choices.map((c) => c.value),
    ["male", "female", "nonbinary", "other"]));
check("a multiple-choice measure says it takes more than one",
  F.measure("roles").multiple === true);
check("the country measure points at the list it reads",
  F.measure("country").choicesFrom === "countries");

// A derivation nothing implements is a measure that would quietly
// compute nothing, which is worse than a spec that will not load.
check("a computed field naming an unknown derivation is refused loudly",
  (() => {
    const broken = {
      ...SITE,
      fields: [{ name: "bmr", kind: "computed", label: "BMR", term: "BMR",
        derivation: "bmr", from: ["weight"], places: 0, chart: true }],
    };
    try {
      F.measures(broken);
      return false;
    } catch (error) {
      return String(error.message).includes("bmr");
    }
  })());

/*
 * The same doctrine one step earlier, and the case that matters to a
 * fork rather than to this repository: a KIND nothing implements.
 *
 * The shipped spec cannot have this typo - the check in section 1 holds
 * its six fields to the list - so the only spec that can is the one
 * somebody edits, which is the whole audience of these two files. Left
 * unguarded, "girth" fell through every branch of measureFor into the
 * unitless one and produced a histogram measure with an undefined band:
 * a chart with no bin width, drawn from a field the form never asked
 * for, and no error anywhere. A spec that will not load beats that.
 */
const BAD_KIND = Object.freeze({
  ...SITE,
  fields: [{ name: "waist", kind: "girth", label: "Waist", term: "waist",
    chart: true }],
});
check("a field of a kind nothing implements is refused, not measured",
  (() => {
    try {
      F.measures(BAD_KIND);
      return false;
    } catch (error) {
      return String(error.message).includes("girth") &&
        String(error.message).includes("waist");
    }
  })());

// And refused on the read rather than only on the chart path: an
// unknown kind on a field nobody charts is the same unrenderable spec,
// and a guard living in the measure list would hand out names, labels
// and limits for it and refuse only where a chart asked.
const BAD_KIND_UNCHARTED = Object.freeze({
  ...SITE,
  fields: [{ name: "waist", kind: "girth", label: "Waist", term: "waist",
    chart: false }],
});
check("an unknown kind is refused even where nothing would chart it",
  (() => {
    try {
      F.names(BAD_KIND_UNCHARTED);
      return false;
    } catch (error) {
      return String(error.message).includes("girth");
    }
  })());

/* ------------------------------------------------------------------ */
/* 4. Conversion, derived from the unit table rather than restated.    */

check("a pound converts to kilograms by the spec's own factor",
  near(F.convert(1, "lb", "kg"), 0.45359237));
check("an inch converts to centimeters by the spec's own factor",
  near(F.convert(1, "in", "cm"), 2.54));
// Twelve is not a number this arithmetic has to remember: both feet
// and inches are exact against the same base.
check("a foot is twelve inches without twelve being written down",
  near(F.convert(1, "ft", "in"), 12));
check("converting a unit to itself changes nothing",
  F.convert(200, "lb", "lb") === 200);
check("converting across kinds is refused rather than answered",
  F.convert(1, "lb", "cm") === null && F.factor("lb", "cm") === null);

/* ------------------------------------------------------------------ */
/* 5. Both <script> orders, because two tags have two of them.         */

/*
 * 0.9-M2 loads these two files with two <script> tags, and nothing in
 * either file pins which comes first. Everything above loads the config
 * first, which is the safe order and therefore the one that cannot
 * catch this: with the reader first, the freeze used to happen while
 * apps/fields.js evaluated and root.BINDER_SITE was not there yet, so
 * deepFreeze returned on its first guard, nothing threw, every
 * derivation went on working, and the spec stayed editable for the life
 * of the page. A conditional property with no error behind it is the
 * shape of failure the review bar names: the criterion (Object.isFrozen
 * on the shipped order) held while the property (the form cannot be
 * edited after it renders) did not.
 *
 * So this section loads them the other way round in this same process.
 * The shipped pair is put aside, a second copy of apps/fields.js is
 * evaluated with no spec in sight, and both halves are asserted: a read
 * before any spec exists is refused loudly, and a read after the spec
 * arrives freezes it exactly as the shipped order does.
 */
const SHIPPED_SITE = globalThis.BINDER_SITE;
const SHIPPED_FIELDS = globalThis.BinderFields;
delete globalThis.BINDER_SITE;
delete globalThis.BinderFields;

await load("../apps/fields.js", "reader-first");
const EARLY = globalThis.BinderFields;

check("the reader loaded first derives nothing, and says so loudly",
  (() => {
    try {
      EARLY.measures();
      return false;
    } catch (error) {
      return String(error.message).includes("apps/site.config.js");
    }
  })());

await load("../apps/site.config.js", "reader-first");
const LATE = globalThis.BINDER_SITE;
EARLY.names();

check("the spec is frozen all the way down in that order too",
  Object.isFrozen(LATE) && Object.isFrozen(LATE.group) &&
  Object.isFrozen(LATE.fields) &&
  LATE.fields.every((field) => Object.isFrozen(field)) &&
  Object.isFrozen(LATE.units.kinds.weight.units.kg));

check("and a same-origin push onto its choice list changes nothing either",
  (() => {
    const choices = EARLY.field("gender").choices;
    const before = choices.map((choice) => choice.value).join(",");
    try {
      choices.push({ value: "injected", label: "Injected" });
    } catch (error) { /* a frozen list throws here, which is the point */ }
    return choices.map((choice) => choice.value).join(",") === before;
  })());

/* Back to the shipped pair. A file that leaves a second copy of the
   module in the globals is a file the next one inherits - and this
   directory's arms are written to be run together by 0.9-M0-S4's
   runner as much as one at a time. */
globalThis.BINDER_SITE = SHIPPED_SITE;
globalThis.BinderFields = SHIPPED_FIELDS;

console.log(failures
  ? `\nsite-spec FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\nsite-spec ran ${performed} checks, expected ${EXPECTED}`
    : `\nsite-spec OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
