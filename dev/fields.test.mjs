/*
 * The form-as-data foundation: apps/site.config.js and apps/fields.js.
 *
 *     node dev/fields.test.mjs
 *
 * WHAT THIS SUITE IS FOR. 0.9 rules that the form's fields and the
 * group's name each live in ONE place a fork edits, and that everything
 * else derives - the charts' measure list, the form's arithmetic, the
 * wordmarks, the titles, and the gate's own expectations (#278, and the
 * 0.9 design record on #228, Parts 3 and 4). A second copy of any of
 * those facts is the defect this file exists to make impossible.
 *
 * TWO HALVES, AND THEY FAIL FOR DIFFERENT REASONS.
 *
 *   1. The spec is well-formed and its derivations are right. A wrong
 *      conversion factor here is the failure dev/form.test.mjs was
 *      written for one level up: it produces a plausible number rather
 *      than an error.
 *   2. The SHIPPED modules still agree with the spec. apps/web is not
 *      edited by this slice - 0.9-M2 rebuilds those pages and consumes
 *      the spec then - so today the agreement is MEASURED rather than
 *      structural. That is the whole value of the second half: the day
 *      somebody edits a limit in form.js instead of in the spec, this
 *      goes red and names both files.
 *
 * The measurement is deliberately made against the real bytes of the
 * shipped files, loaded the way dev/form.test.mjs loads them.
 *
 * THE DERIVATIONS TAKE A CONFIG. Every exported derivation accepts an
 * optional spec, defaulting to the shipped one. That is not generality
 * for its own sake: it is what lets the propagation arm below add a
 * field to a COPY of the spec and watch it arrive in the measure list
 * and in the check expectations, with no page code and no check code
 * edited. A derivation that could only read the one global would make
 * that arm impossible to write honestly.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { suite } from "./harness.mjs";

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));
const load = async (path) => {
  const source = await readFile(HERE(path), "utf8");
  await import("data:text/javascript," + encodeURIComponent(source));
};

await load("../apps/site.config.js");
await load("../apps/fields.js");
await load("../apps/web/form.js");
await load("../apps/web/dashboard.js");
await load("../apps/web/query.js");

const SITE = globalThis.BINDER_SITE;
const F = globalThis.BinderFields;
const FORM = globalThis.BinderForm;
const DASH = globalThis.BinderDashboard;
const QUERY = globalThis.BinderQuery;

const yourPage = await readFile(HERE("../apps/web/your-page.html"), "utf8");

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b) => Math.abs(a - b) < 1e-9;

const { check, report } = suite("fields.js", 51);

/* ------------------------------------------------------------------ */
/* 1. The data file itself.                                            */

check("the spec is one global object", SITE && typeof SITE === "object");

// Frozen all the way down. A page holds this object for the whole of a
// session, so a same-origin script that could push a choice onto a list
// or move a limit would be editing the form after it was rendered.
check("the spec is frozen", Object.isFrozen(SITE));
check("the spec is frozen all the way down",
  Object.isFrozen(SITE.group) && Object.isFrozen(SITE.fields) &&
  SITE.fields.every((field) => Object.isFrozen(field)));

check("the derivations are frozen", Object.isFrozen(F));

check("every field says its name, its kind and its label",
  SITE.fields.every((field) =>
    typeof field.name === "string" && field.name !== "" &&
    typeof field.kind === "string" && field.kind !== "" &&
    typeof field.label === "string" && field.label !== ""));

check("no two fields share a name",
  new Set(SITE.fields.map((f) => f.name)).size === SITE.fields.length);

check("every field's kind is one the spec defines",
  SITE.fields.every((field) => F.kinds().includes(field.kind)));

check("every measured field's kind carries a unit table",
  SITE.fields.filter((f) => F.isMeasured(f))
    .every((f) => Object.keys(F.unitsOf(f.kind)).length > 0));

/* ------------------------------------------------------------------ */
/* 2. The group's name, in one config place.                           */

check("the group's name is one string in the spec",
  SITE.group.name === "Hang Gang");

check("the site's title derives from it",
  F.siteTitle() === "Hang Gang Binder");

check("a page title derives from it",
  F.pageTitle("Your page") === "Your page — Hang Gang Binder");

check("the wordmark's two lines derive from it",
  same(F.wordmarkLines(), ["Hang Gang", "Binder"]));

// The one that matters for a fork: rename the group in the config and
// every derived string follows, with nothing else edited.
const RENAMED = { ...SITE, group: { name: "Bear Club", binder: "Binder" } };
check("renaming the group in the config moves the site title",
  F.siteTitle(RENAMED) === "Bear Club Binder");
check("renaming the group in the config moves every page title",
  F.pageTitle("Your page", RENAMED) === "Your page — Bear Club Binder");
check("renaming the group in the config moves the wordmark",
  same(F.wordmarkLines(RENAMED), ["Bear Club", "Binder"]));

/* ------------------------------------------------------------------ */
/* 3. The chartable-measure list, which 0.9-M2's charts consume.       */

check("the measures are the fields that can be charted",
  same(F.measures().map((m) => m.name),
    ["weight", "height", "bmi", "gender", "roles", "country"]));

check("a consent field is not a measure",
  !F.measures().some((m) => m.name === "over18"));

const weight = F.measure("weight");
check("a weight measure is binned rather than categorical",
  weight.kind === "bins" && weight.unitful === true);
check("a weight measure carries a unit per system",
  weight.units.metric.unit === "kg" && weight.units.imperial.unit === "lb");
check("a weight measure carries the stored property each unit reads",
  weight.units.metric.store === "kg" && weight.units.imperial.store === "lb");
check("a weight measure carries its histogram bands",
  weight.units.metric.bin === 10 && weight.units.imperial.bin === 20);

const height = F.measure("height");
check("a length measure charts total inches, not feet",
  height.units.imperial.store === "totalInches" &&
  height.units.imperial.unit === "in");

const bmi = F.measure("bmi");
check("a computed measure names what it is computed from",
  same(bmi.from, ["weight", "height"]) && bmi.unitful === false);
check("a computed measure carries its rounding",
  bmi.places === 1);
// Described AND executable. A measure list that only describes BMI
// leaves whoever draws the chart to write the arithmetic a second time,
// which is the copy that drifts.
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

check("the country measure reads its choices from the country table",
  F.measure("country").choicesFrom === "countries");

/* ------------------------------------------------------------------ */
/* 4. Conversion, derived from the unit table rather than restated.    */

check("a pound converts to kilograms by the spec's own factor",
  near(F.convert(1, "lb", "kg"), 0.45359237));
check("an inch converts to centimetres by the spec's own factor",
  near(F.convert(1, "in", "cm"), 2.54));
check("a foot is twelve inches by the spec's own factors",
  near(F.convert(1, "ft", "in"), 12));
check("converting a unit to itself changes nothing",
  F.convert(200, "lb", "lb") === 200);
check("converting across kinds is refused rather than answered",
  F.convert(1, "lb", "cm") === null);

/* ------------------------------------------------------------------ */
/* 5. The propagation arm - the contract this slice ships (#278).      */
/*                                                                     */
/* A field added to the data file must reach the measure list and the  */
/* checks' expectations with ZERO page-code and ZERO check-code edits. */
/* The form-rendering half of this arm belongs to 0.9-M2, where the    */
/* page is rebuilt to consume the spec; it is deliberately NOT claimed */
/* here.                                                               */

const SCRATCH = Object.freeze({
  ...SITE,
  fields: Object.freeze([...SITE.fields, Object.freeze({
    name: "meals",
    kind: "count",
    label: "Meals a day",
    term: "meals a day",
    chart: true,
    bin: 1,
  })]),
});

check("a field added to the data file arrives in the measure list",
  F.measures(SCRATCH).some((m) => m.name === "meals"));
check("the added field arrives with its kind and its label",
  F.measure("meals", SCRATCH).kind === "bins" &&
  F.measure("meals", SCRATCH).label === "Meals a day");
check("the added field arrives in the labels the checks expect",
  F.labels(SCRATCH).meals === "Meals a day");
check("the added field arrives in the field names the checks expect",
  F.names(SCRATCH).includes("meals"));
check("removing it again leaves the shipped spec as it was",
  !F.names().includes("meals") &&
  !F.measures().some((m) => m.name === "meals"));

/* ------------------------------------------------------------------ */
/* 6. The shipped modules still agree with the spec.                   */
/*                                                                     */
/* apps/web is untouched by this slice, so these are MEASUREMENTS of   */
/* an agreement rather than proofs of a derivation. They are what      */
/* stops the two drifting before 0.9-M2 makes the pages read the spec. */

check("form.js's pound is the spec's pound",
  FORM.KG_PER_LB === F.factor("lb", "kg"));
check("form.js's inch is the spec's inch",
  FORM.CM_PER_IN === F.factor("in", "cm"));
check("form.js's limits are the spec's limits",
  same(FORM.LIMITS, F.limits()));
check("form.js's genders are the spec's gender choices",
  same(FORM.GENDERS, F.choiceValues("gender")));
check("form.js's roles are the spec's affiliation choices",
  same(FORM.ROLES, F.choiceValues("roles")));

check("the dashboard's unit table is the spec's unit table",
  ["metric", "imperial"].every((system) =>
    ["weight", "height"].every((name) => {
      const there = DASH.UNITS[system][name];
      const here = F.measure(name).units[system];
      return there.field === here.store && there.suffix === here.unit &&
        there.bin === here.bin && there.band === here.band;
    })));
check("the dashboard defaults to the unit system the spec defaults to",
  DASH.DEFAULT_UNITS === F.defaultSystem());

// Compared as a set rather than in order. The order of the keys in
// query.js is neither the spec's nor the picker's - your-page.html
// lists weight, height, BMI, gender, country, affiliations - so
// asserting one of them here would pin an order nothing else keeps.
check("the query engine's splits are the spec's measures",
  same([...Object.keys(QUERY.SPLITS)].sort(), [...F.splitNames()].sort()));
check("the query engine's splits carry the spec's kinds and terms",
  Object.entries(QUERY.SPLITS).every(([name, split]) =>
    split.kind === F.measure(name).kind &&
    split.unitful === F.measure(name).unitful &&
    split.label === F.measure(name).term));

// A computed field is not asked for, which is what makes it computed.
// The three spellings are the three this page actually uses: an id for
// a single control, `data-field` for a field spread over more than one
// input, and `name` for a group of checkboxes.
check("your-page.html still asks for every field the spec declares",
  F.names().filter((name) => F.field(name).kind !== "computed")
    .every((name) => yourPage.includes('id="' + name + '"') ||
      yourPage.includes('data-field="' + name + '"') ||
      yourPage.includes('name="' + name + '"')));
check("your-page.html still shows every choice the spec declares",
  ["gender", "roles"].every((name) =>
    F.measure(name).choices.every((choice) =>
      yourPage.includes('value="' + choice.value + '"') &&
      yourPage.includes(">" + choice.label + "<"))));
check("your-page.html still labels the measured fields as the spec does",
  ["weight", "height"].every((name) =>
    yourPage.includes(">" + F.labels()[name] + "</label>")));

report();
