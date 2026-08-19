/*
 * The contract 0.9 rests on: a field added to the data file arrives
 * everywhere that derives from it, with no other file edited.
 *
 *     node tests/site-propagation.test.mjs
 *
 * Subject: apps/web/site.config.js and apps/web/fields.js (#278; the 0.9
 * design record on #228, Part 3 - "a fork that edits fields gets
 * matching charts with zero chart code").
 *
 * WHAT THIS ARM CLAIMS, EXACTLY. A scratch field is added to a COPY of
 * the spec, its arrival is asserted in the chartable-measure list and
 * in the derived labels and names, and the copy is discarded. Nothing
 * in apps/web, in tools/ or in this directory is edited to make that
 * happen, which is the whole of the claim.
 *
 * WHAT IT DOES NOT CLAIM, and this is the half worth writing down. It
 * does NOT claim the field appears as a control on the entry form -
 * that is tests/your-page.test.mjs's claim now (0.9-M2-S2, #353), over
 * apps/web/form.js's own render plan. This arm and that one prove two
 * different links in the same chain: this one is the derivation layer
 * (site.config.js -> fields.js), that one is the rendering layer
 * (fields.js -> form.js's plan()) - and neither substitutes for the
 * other, because a field can arrive correctly in one and still be
 * dropped by the other.
 *
 * WHY A COUNT FIELD IS THE SCRATCH ONE. `count` is the kind with no
 * unit table and no consumer in the shipped tree - so it exercises the
 * path a fork most plausibly takes ("how many meals a day") and cannot
 * pass by accidentally matching something that already exists.
 *
 * The runner at the bottom is local for the reason tests/site-spec.
 * test.mjs gives at length: 0.9-M0-S4 adopts these files by moving
 * them, not by rewriting them.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));
const load = async (path) => {
  const source = await readFile(HERE(path), "utf8");
  await import("data:text/javascript," + encodeURIComponent(source));
};

await load("../apps/web/site.config.js");
await load("../apps/web/fields.js");

const SITE = globalThis.BINDER_SITE;
const F = globalThis.BinderFields;

const EXPECTED = 10;
let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) failures += 1;
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

/* The state before, asserted rather than assumed. An arm that adds a
   field and finds it has proved nothing if the field was already
   there. */
check("the shipped spec has no such field before the arm runs",
  !F.names().includes("meals") &&
  !F.measures().some((m) => m.name === "meals"));

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

check("the added field arrives in the field names",
  F.names(SCRATCH).includes("meals"));
check("the added field arrives in the labels",
  F.labels(SCRATCH).meals === "Meals a day");
check("the added field arrives in the chartable-measure list",
  F.measures(SCRATCH).some((m) => m.name === "meals"));
check("it arrives at the end, where the form asks it",
  F.measures(SCRATCH).map((m) => m.name).pop() === "meals");

const meals = F.measure("meals", SCRATCH);
check("it arrives as a histogram, because a count is a number",
  meals.kind === "bins");
check("it arrives with no unit system, because a count has no units",
  meals.unitful === false && meals.units === undefined);
check("it arrives with the band width the spec gave it", meals.bin === 1);
check("it arrives with its label and its sentence form",
  meals.label === "Meals a day" && meals.term === "meals a day");

/* And the scratch field is gone. A test that leaves its fixture behind
   in a frozen global is a test the next file inherits. */
check("removing it leaves the shipped spec exactly as it was",
  !F.names().includes("meals") &&
  !F.measures().some((m) => m.name === "meals") &&
  F.measures().length === 6);

console.log(failures
  ? `\nsite-propagation FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\nsite-propagation ran ${performed} checks, expected ${EXPECTED}`
    : `\nsite-propagation OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
