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
 * figure draws has to appear verbatim in the fixture response - so a
 * pooler, a merger or a second binning pass still reddens this suite
 * regardless of what it calls its variables.
 *
 * THE RENDERED BIN COUNT IS NO LONGER THE RESPONSE'S OWN COUNT, FLAT
 * (owner ruling, the 2026-08-20 sitting, #390): at the shipped floor
 * of 0 it is the response's count MINUS its trailing empty bands - the
 * page trims the empty tail past the band holding the data's own
 * maximum, keeps every leading and interior band (empty ones
 * included), and draws the whole grid when every band is empty. That
 * property survives 0.9-M2-S11's reshape and its own review's F1/F2
 * fix wave: the distribution figure draws every band it is HANDED
 * (empty ones included).
 *
 * THE X-AXIS IS A ROUND-NUMBER TICK ROW (owner ruling 1, the 2026-08-21
 * axis sitting, #396). Midpoint captions are gone: the numbers under
 * the figure are the BAND EDGES, one per boundary rather than one per
 * bar, thinned by measured width with the first and last always
 * painted. The thinning law itself is unchanged - no two painted
 * labels may overlap at their FINAL, contained positions - and the arms
 * below check the rendered row against exactly the positions
 * apps/web/charts.js's own labelRowPlan() says should carry one.
 *
 * NO UNIT ANYWHERE IN THE FIGURE (owner ruling 2, #396): the unit is
 * stated once, in the status line ("Showing Weight (lb)."), and the
 * axis-edge unit marker the 2026-08-19 sitting put at the row's right
 * end is retired with the midpoint captions. The arms that used to
 * find exactly one marker now assert there is none.
 * The FORBIDDEN name grep below (section 1) stays as a fast tripwire
 * that catches an obvious reintroduction by name before the slower
 * behavioral arm has to - it is no longer the proof by itself, since a
 * real second partition wired under fresh names passes it while still
 * computing its own bins (the reviewer's own finding, #354 comment
 * 5342979192). server/charts-agg.js's tests/charts-aggregate.test.mjs
 * is where the disclosure rules themselves are attacked; this file's
 * job is that the PAGE prints what the route hands back and computes
 * nothing of its own.
 *
 * NO PER-BAR COUNT ROW ANY MORE (owner ruling, the 2026-08-19 late
 * sitting, folded into fix wave 1, #378): no number ever paints over a
 * bar, zeros included - the exact count is the tooltip's job and the
 * new count axis's scale, never a caption. countCaptionPlan() and every
 * arm this file built against it are gone with it.
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
 * NO NAMED EXCEPTION ANY MORE. admin.js carried one MIN_CELL reference
 * as dead code, tolerated rather than excused silently while admin.html
 * stood "dead-in-water rather than patched" (#354's own scope) - and
 * 0.9-M3-S10 (#416) is the slice that finally patched it: the whole
 * publish/unpublish card and the local snapshot preview it built with
 * BinderDashboard left admin.js in the same change that retired the
 * keyfile-decrypt tool, taking the one MIN_CELL reference with them.
 * Nothing in apps/web reads a name off this list any more, so the check
 * two arms below - which asserted that ONE reference and named why it
 * was safe - has nothing left to assert and is retired with it.
 *
 * apps/web/submit.js and apps/web/your-page.html carried the pre-0.9
 * personal-query engine's own MIN_CELL reference before 0.9-M2-S2
 * retired it (#353); this slice's pre-ship rebase over S2's landed head
 * proved both clean (0.9-M2-S3 fix wave 1, F3 - the reviewer's own
 * probe: injecting a forbidden name into either file reddened this
 * check, 30/30), so neither was exempted here even before this.
 */
const dirty = Object.entries(webTexts)
  .filter(([, text]) => FORBIDDEN.test(text))
  .map(([name]) => name);
if (dirty.length) console.log("      dirty: " + dirty.join(", "));
check("no line of MIN_CELL/suppressCounts/suppressBins/repartition/" +
  "SNAPSHOT survives anywhere in apps/web",
  dirty.length === 0);

check("charts.html loads no dashboard.js, query.js or public.js script",
  !/src="(dashboard|query|public)\.js"/.test(webTexts["charts.html"]));

/* ------------------------------------------------------------------ */
/* 2. The pure half: labels, scales, the request shape.                */

const src = await read("../apps/web/charts.js");
await import("data:text/javascript," + encodeURIComponent(src));
const Charts = globalThis.BinderCharts;

check("charts.js publishes BinderCharts, frozen",
  Charts !== undefined && Object.isFrozen(Charts));

/*
 * BinderXlsx, loaded once rather than per driven() call - unlike ui.js
 * (loaded further down) it has no per-page state and no DOM dependency
 * at all (xlsx.js's own IIFE takes no `typeof document` guard), so one
 * load leaves globalThis.BinderXlsx standing for both the pure
 * workbookRows() checks right below and every later driven() call.
 * wireDownload() (0.9-M2-S14, #380 ruling 3) reads root.BinderXlsx.
 * build() directly - the repository's one xlsx writer, reused rather
 * than reimplemented.
 */
await import("data:text/javascript," +
  encodeURIComponent(await read("../apps/web/xlsx.js")));
const Xlsx = globalThis.BinderXlsx;
check("apps/web/xlsx.js is loadable standalone and publishes BinderXlsx, "
  + "frozen - the writer this page's download reuses, not a second one",
  Xlsx !== undefined && Object.isFrozen(Xlsx));

/*
 * F3 (fix wave 1 review of 0.9-M2-S14, #380): driven() below stubs
 * BinderFields.orderedChoices()/pinnedCountries() - a reimplementation
 * of apps/web/fields.js's own algorithm, the same fixture-not-import
 * shape every BinderFields member in this file already takes - and
 * nothing tied that stub to the real function. The reviewer's own
 * attack proved the gap: break the real orderedChoices() in apps/web/
 * fields.js, and tests/site-spec.test.mjs and tests/your-page.test.mjs
 * both red (they load the real module) while this file's own pinned-
 * country checks in section 3 stay green, because they exercise the
 * stub, never the real code. This loads the real module fresh, under
 * its own tag so it never collides with anything driven() later sets
 * on globalThis, and asserts the stub's answer is byte-identical to
 * the real one on the same input.
 */
const realFieldsSrc = await read("../apps/web/fields.js");
await import("data:text/javascript," + encodeURIComponent(realFieldsSrc) +
  "#real-fields-for-parity");
const RealFields = globalThis.BinderFields;

// The stub's own algorithm, copied here rather than imported from
// inside driven() below - the parity check has to hold its OWN copy
// of what the stub does, independent of driven()'s closure, or a
// change to both at once would still agree with itself while drifting
// from the real file.
function stubOrderedChoices(choices, pinned) {
  const byValue = {};
  choices.forEach((c) => { byValue[c.value] = c; });
  const front = (pinned || [])
    .filter((code) => Object.prototype.hasOwnProperty.call(byValue, code))
    .map((code) => byValue[code]);
  return front.concat(choices);
}

const PARITY_CHOICES = [
  { value: "AL", label: "Albania" }, { value: "CA", label: "Canada" },
  { value: "GB", label: "United Kingdom" },
  { value: "US", label: "United States of America" },
];
const PARITY_PINNED = ["US", "GB", "CA"];

check("F3: driven()'s BinderFields.orderedChoices stub agrees with the "
  + "real apps/web/fields.js implementation, byte for byte, on the same "
  + "input - a broken real function now reds here too",
  JSON.stringify(RealFields.orderedChoices(PARITY_CHOICES, PARITY_PINNED)) ===
  JSON.stringify(stubOrderedChoices(PARITY_CHOICES, PARITY_PINNED)));
check("F3: and with an empty pin, so the parity does not rest on the "
  + "one input both algorithms happen to have been written against",
  JSON.stringify(RealFields.orderedChoices(PARITY_CHOICES, [])) ===
  JSON.stringify(stubOrderedChoices(PARITY_CHOICES, [])));
check("F3: pinnedCountries() parity too - the real function, reading a "
  + "spec shaped like driven()'s own BINDER_SITE fixture with a real "
  + "countries.pinned block, agrees with the stub's hardcoded answer",
  JSON.stringify(RealFields.pinnedCountries(
    { countries: { pinned: ["US", "GB", "CA"] } })) ===
  JSON.stringify(["US", "GB", "CA"]));

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
 * was near ten either way, the captions still collided. captionWidth()
 * and labelRowPlan() below are checked three ways: a controlled
 * overlap case with hand-verifiable geometry, the exact scenario the
 * review reported (F2's own numbers), and the real shipped grids the
 * review named fed through the real function, since this suite's own
 * DOM stub cannot measure a painted pixel. These arms all use
 * labelRowPlan()'s plain, UNCLAMPED 2-argument mode - the geometry
 * primitive's own correctness, independent of where the row happens to
 * sit; fix wave 1 (#378)'s own arm, further down, is what proves the
 * FINAL, contained positions the real page actually paints.
 */
check("captionWidth is proportional to the text length - the estimate " +
  "basis is character count, stated in the function's own header",
  Charts.captionWidth("0") === 8 && Charts.captionWidth("12") === 16 &&
  Charts.captionWidth("") === 0);

/*
 * F7 (0.9-M2-S11's second review, #372): the estimate has to stay ABOVE
 * every glyph the shipped face actually paints, not just above a
 * plausible-looking round number - CAPTION_CHAR_WIDTH === 7 passed
 * every hand-picked case above while sitting BELOW the real "0" and "–"
 * the reviewer measured with getComputedTextLength() in the shipped
 * face, which is exactly how a conservative-by-construction claim went
 * quietly false. This fixture is that outside measurement, not this
 * file's own guess: it is the reviewer's reported data, kept here as
 * data rather than re-derived, so this arm cannot be satisfied by
 * captionWidth() grading its own homework the way noPaintedPairOverlaps()
 * used to (F7's own second half - that helper computed its boxes with
 * captionWidth() itself, so a wrong constant could never fail the check
 * built from it).
 *
 * PROVENANCE: getComputedTextLength() read off the shipped chart face
 * at the .chart-label/.chart-value 11px size, reported in the review of
 * record on #372 (the F7 finding). "0" is the narrowest digit an axis
 * label ever prints alone; "–" is the dash binLabel() joins a tooltip's
 * own range with, so both sit on the actual hot path.
 */
const MEASURED_GLYPH_WIDTHS = { "0": 7.53, "–": 7.36 };
check("CAPTION_CHAR_WIDTH sits at or above every real glyph width the " +
  "reviewer measured in the shipped face - the estimate is a ceiling " +
  "on the widest glyph, not a guess that happened to clear the old " +
  "hand-picked cases",
  Charts.captionWidth("x") >= Math.max(MEASURED_GLYPH_WIDTHS["0"],
    MEASURED_GLYPH_WIDTHS["–"]));

/*
 * The reviewer's own reproduction, driven through the real plan: 88
 * bands is the exact band count where a 7-unit estimate approved a row
 * that truly overlapped (slot 7.273 u; the real "0" measures 7.53 u,
 * wider than its own slot). A single-character caption ("0") in every
 * band is the worst case for THIS regression specifically - the
 * shortest possible caption, which is exactly what let 7 pass unnoticed
 * where a longer caption would have tripped some other check first.
 * Originally reproduced against countCaptionPlan() (the count row this
 * fixture's own all-zero shape was built for); the count row is gone
 * (owner ruling, the 2026-08-19 late sitting) and labelRowPlan() is
 * the only plan left to carry the same glyph-width property forward on.
 */
const repro88Slot = 640 / 88;
const repro88Labels = new Array(88).fill("0");

/* The regression's own arithmetic, stated as two plain facts before
   the plan is asked to do anything: the real glyph (7.53 u) does not
   fit beside a copy of itself in an 88-band slot (7.273 u), so two
   adjacent all-zero captions truly overlap - but the OLD constant (7)
   sits below the slot too, which is exactly how it missed this. */
check("F7: the real measured glyph does not clear the 88-band slot - " +
  "two adjacent zero captions truly overlap at this band count",
  MEASURED_GLYPH_WIDTHS["0"] > repro88Slot);
check("F7: the pre-fix constant (7) sat BELOW that same slot, which is " +
  "how it approved a row that really overlapped",
  7 <= repro88Slot);

check("F7's own 88-band repro, driven through the real plan: the " +
  "fixed constant refuses to approve 88 all-\"0\" captions in a row - " +
  "the false-clean result the review reported is closed",
  Charts.labelRowPlan(repro88Labels, repro88Slot).length < 88);

/* A controlled, hand-verifiable case: three captions far enough apart
   that none can possibly overlap (a slot ten times any caption's own
   width) - every one paints, proving the plan is not "always thin". */
check("labelRowPlan paints every caption when nothing overlaps",
  JSON.stringify(Charts.labelRowPlan(["a", "bb", "ccc"], 1000)) ===
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
const f2Plan = Charts.labelRowPlan(f2Labels, 72.45);
check("F2's own reported case: the interior caption collides with both " +
  "neighbors and is dropped",
  !f2Plan.includes(1));
check("F2's own reported case: the first and last captions still " +
  "paint, even though they are exactly the pair that collided before " +
  "thinning",
  f2Plan.includes(0) && f2Plan.includes(2));

/*
 * THE REAL SHIPPED GRIDS, built the same way server/charts-agg.js's
 * gridOf() builds them since #396: the spec's bounds snapped OUTWARD
 * onto a grid of the unit's own nice width, then stepped by that width -
 * every band exactly one width wide and every edge a multiple of it.
 * These are not stand-in grids; they are what apps/web/site.config.js
 * ships. `slot` is drawBins()'s own geometry - a 640-wide viewBox less
 * the 50-unit count-axis gutter, divided evenly across the bands.
 */
const PLOT_LEFT = 50;
const PLOT_RIGHT = 20;
const VIEW_WIDTH = 640;
const PLOT_WIDTH = VIEW_WIDTH - PLOT_LEFT - PLOT_RIGHT;
const slotFor = (bandCount) => PLOT_WIDTH / bandCount;

function realGrid(min, max, width) {
  const bands = [];
  const count = Math.round((max - min) / width);
  for (let i = 0; i < count; i += 1) {
    bands.push({ from: min + i * width, to: min + (i + 1) * width });
  }
  return bands;
}

/*
 * The axis's own numbers: a band edge each, one more of them than there
 * are bands. drawBins() reads exactly this off the bins it is handed -
 * `bins[0].from` and then every band's `to` - so a grid of n bands
 * carries n+1 ticks, at x = index * slot.
 */
function edgesOf(grid) {
  return [grid[0].from].concat(grid.map((b) => b.to));
}

/*
 * TICK LABELS (owner ruling 1, #396). The edge's own number, printed as
 * it stands - no unit, no rounding, nothing composed. The whole point of
 * the nice grid is that this needs no cleverness: the number is already
 * round because the edge is.
 */
check("tickLabel prints the edge's own number and nothing else",
  Charts.tickLabel(500) === "500" && Charts.tickLabel(25) === "25" &&
  Charts.tickLabel(0) === "0");
check("tickLabel carries no unit token, ever - the unit is stated once " +
  "in the status line (owner ruling 2, #396)",
  !/[a-zA-Z]/.test(Charts.tickLabel(525)));
check("tickLabel does not round - a fork whose nice width is a fraction " +
  "gets its own edge printed, not a whole number this file invented",
  Charts.tickLabel(2.5) === "2.5");

/*
 * TICK BOXES sit ON an edge, not in the middle of a slot - which is the
 * one geometric difference between this row and a caption row under
 * bars. Index i is centered at i * slot exactly, so index 0 is centered
 * on the axis's own left end and index n on its right end, and half of
 * each end label therefore hangs past the plot by construction. That
 * overhang is why the plot ends one margin short of the viewBox: it has
 * somewhere to go, so the number never has to move off its own tick.
 */
check("tickBox centers a label on its own edge, at index * slot",
  JSON.stringify(Charts.tickBox(2, 100, "50")) ===
  JSON.stringify({ left: 200 - Charts.captionWidth("50") / 2,
    right: 200 + Charts.captionWidth("50") / 2 }));
check("tickBox at index 0 straddles zero - half its width hangs off the " +
  "left end of the plot, which is the overhang the margins exist to " +
  "hold at both ends of a tick row",
  Charts.tickBox(0, 100, "25").left < 0);

const bmiGrid = realGrid(0, 600, 5);
check("the real shipped BMI grid is 120 bands, 0 to 600 at bin 5 - the " +
  "exact spec F1 was filed against",
  bmiGrid.length === 120);
const bmiEdges = edgesOf(bmiGrid);
const bmiTicks = bmiEdges.map(Charts.tickLabel);
const bmiSlot = slotFor(bmiGrid.length);

const weightGrid = realGrid(25, 1125, 25);
check("the real shipped imperial-weight grid is 44 bands of 25 lb - the " +
  "nice grid #396 ruled, over the union of the form's own pound and " +
  "kilogram bounds (fix wave 1, O2: 500 kg is 1102.3 lb, so the axis " +
  "reaches 1125 rather than stopping at the pound row's 1100)",
  weightGrid.length === 44);
const weightEdges = edgesOf(weightGrid);
const weightTicks = weightEdges.map(Charts.tickLabel);
const weightSlot = slotFor(weightGrid.length);

/* The metric weight grid: the kg row's own 10 kg bands, over the union
   of every weight bound the form declares converted into kilograms (the
   pound row's 44 lb is 19.96 kg, which is what pulls the low end below
   the kg row's own 20). */
const metricWeightGrid = realGrid(10, 500, 10);
check("the real shipped metric-weight grid is 49 bands - the union of " +
  "the kg row's own 20 and the 44 lb the pound row admits (19.96 kg), " +
  "snapped outward onto the 10 kg grid (fix wave 1, O2)",
  metricWeightGrid.length === 49);
const metricWeightEdges = edgesOf(metricWeightGrid);
const metricWeightTicks = metricWeightEdges.map(Charts.tickLabel);
const metricWeightSlot = slotFor(metricWeightGrid.length);

/*
 * ROUND NUMBERS ON BAND EDGES, WHICH IS WHAT MAKES OPTION C HONEST
 * (owner ruling 3, #396): every number this axis prints is an edge the
 * response actually sent, and every edge is a multiple of the band
 * width. A tick that were anything else would be the page inventing a
 * number - the thing render-only forbids.
 */
for (const g of [{ name: "BMI", edges: bmiEdges, width: 5 },
  { name: "imperial weight", edges: weightEdges, width: 25 },
  { name: "metric weight", edges: metricWeightEdges, width: 10 }]) {
  check("#396 ruling 3: every " + g.name + " tick is a whole number of " +
    "band widths from zero - the axis reads in round numbers because " +
    "the bands do, not because anything rounded them",
    g.edges.every((e) => Math.abs(e / g.width -
      Math.round(e / g.width)) < 1e-9));
  check("#396: there is exactly one more " + g.name + " tick than there " +
    "are bands - a boundary each, never a label per bar",
    g.edges.length === realGrid(g.edges[0],
      g.edges[g.edges.length - 1], g.width).length + 1);
}

function noPaintedPairOverlaps(plan, texts, slot) {
  const box = (i) => Charts.tickBox(i, slot, texts[i]);
  for (let k = 1; k < plan.length; k += 1) {
    const a = box(plan[k - 1]);
    const b = box(plan[k]);
    if (!(a.right <= b.left || a.left >= b.right)) return false;
  }
  return true;
}

const bmiRangePlan = Charts.labelRowPlan(bmiTicks, bmiSlot);
check("F1: on the real 120-band BMI grid's own tick row, no two painted " +
  "labels overlap",
  noPaintedPairOverlaps(bmiRangePlan, bmiTicks, bmiSlot));
check("F1: the BMI tick row is thinned, not painted whole - the fix is " +
  "fewer labels, not merely differently counted ones",
  bmiRangePlan.length < bmiTicks.length);
check("F1: the first and last BMI ticks always paint - they are the " +
  "axis's own two ends",
  bmiRangePlan[0] === 0 &&
  bmiRangePlan[bmiRangePlan.length - 1] === bmiTicks.length - 1);

const weightRangePlan = Charts.labelRowPlan(weightTicks, weightSlot);
check("F2: on the real imperial-weight grid's own tick row, no two " +
  "painted labels overlap",
  noPaintedPairOverlaps(weightRangePlan, weightTicks, weightSlot));
check("F2: the weight tick row is thinned too - a label count near ten " +
  "is not the same property as labels that fit",
  weightRangePlan.length < weightTicks.length);
check("F2: the first and last weight ticks still paint, including the " +
  "forced last one the review named specifically",
  weightRangePlan[0] === 0 &&
  weightRangePlan[weightRangePlan.length - 1] === weightTicks.length - 1);

/* UNIQUENESS on the shipped grids: a fixed-width grid's edges are
   strictly increasing by the band width, so no two ticks ever share a
   number - checked on the real spec rather than assumed from the
   arithmetic. A repeated tick would read as an axis that stalls. */
check("every tick on the real 120-band BMI grid is unique",
  new Set(bmiTicks).size === bmiTicks.length);
check("every tick on the real imperial-weight grid is unique",
  new Set(weightTicks).size === weightTicks.length);
check("every tick on the real 48-band metric-weight grid is unique",
  new Set(metricWeightTicks).size === metricWeightTicks.length);

/*
 * CONTAINMENT, THE PRIMITIVE (0.9-M2-S13, #378, owner ruling 1;
 * containBox()'s own 3-argument signature is fix wave 1's, finding F1,
 * #378: `lowerBound` used to be hardcoded 0, and is now the plot's own
 * left edge, since drawBins() reserves a left gutter for the count
 * axis - owner ruling 2, the 2026-08-19 late sitting).
 */
check("containBox leaves a box that already fits inside " +
  "[lowerBound, upperBound] unchanged - the no-op case every interior " +
  "label hits",
  JSON.stringify(Charts.containBox({ left: 60, right: 70 }, 50, 150)) ===
  JSON.stringify({ left: 60, right: 70 }));
check("containBox shifts a box whose left edge crosses lowerBound " +
  "inward until it touches lowerBound, preserving the box's own width",
  JSON.stringify(Charts.containBox({ left: 45, right: 65 }, 50, 150)) ===
  JSON.stringify({ left: 50, right: 70 }));
check("containBox shifts a box whose right edge crosses upperBound " +
  "inward until it touches upperBound, preserving the box's own width",
  JSON.stringify(Charts.containBox({ left: 140, right: 160 }, 50, 150)) ===
  JSON.stringify({ left: 130, right: 150 }));

/* An adversarial hand-built case: a label wide enough that its own box,
   centered on its edge, overshoots BOTH bounds by construction - the
   property has to hold even here, not merely on the real grids where it
   happens to. */
check("containBox clamps a label wider than the whole row to the " +
  "left edge (left takes priority, matching the left-then-right order " +
  "the function itself reads in)",
  JSON.stringify(Charts.containBox({ left: 0, right: 750 }, 50, 640)) ===
  JSON.stringify({ left: 50, right: 800 }));

/*
 * F1, FIX WAVE 1'S OWN FINDING (#378, the review of record on the head
 * this suite's own previous build shipped): containBox() shifting the
 * forced last label AFTER labelRowPlan() had already ruled the row
 * collision-free recreated exactly the overlap the plan exists to
 * prevent - owner-found live (a real overlapping pair, on the real
 * page), reviewer-confirmed by geometry. "resolved by dropping interior
 * neighbours, never an end" is the ruling; labelRowPlan()'s optional
 * third argument (`boxOf`) is the fix - the SAME final, contained,
 * offset boxes are what the plan compares for overlap AND what the
 * render loop paints from, so there is exactly one definition of where
 * a label ends up. #396 moved the row from slot midpoints to band
 * edges, and fix wave 1 (F2/F3) gave the plot a right margin so that
 * clamping stops being what happens to an END label at all.
 *
 * NO LABEL EVER PAINTS SHIFTED FROM ITS TICK. An end label is centered
 * on the axis's own end, so half of it hangs past that end by
 * construction; clamping it inward moves the number away from the mark
 * it names, which reads as the midpoint convention ruling 1 killed. The
 * plot therefore ends one margin short of the viewBox (PLOT_RIGHT, the
 * mirror of the count-axis gutter on the left), the end label overhangs
 * into that margin, and containment is measured against the VIEWBOX -
 * a backstop for a pathological label, never the ordinary case.
 */
function finalBoxOf(texts, slot) {
  return function (i) {
    const raw = Charts.tickBox(i, slot, texts[i]);
    return Charts.containBox(
      { left: PLOT_LEFT + raw.left, right: PLOT_LEFT + raw.right },
      0, VIEW_WIDTH);
  };
}

/* Where a tick's mark actually stands, which is what its number has to
   be centered on. */
function tickXOf(slot) {
  return function (i) { return PLOT_LEFT + i * slot; };
}

function localBoxesOverlap(a, b) {
  return !(a.right <= b.left || a.left >= b.right);
}

/*
 * NO PAINTED LABEL IS EVER SHIFTED OFF ITS TICK (fix wave 1, F2/F3).
 *
 * This is the property the right margin buys, and it is what the two
 * findings were really about. Clamping an end label inward moves the
 * number away from the mark it names; on the owner's own scenario the
 * clamped "525" sat almost entirely over the last BAR, and the cleanup
 * dropped that bar's lower edge ("500") as its collision - so the last
 * band was captioned by one number sitting over the middle of it, which
 * is the midpoint convention ruling 1 killed, rebuilt out of geometry.
 *
 * The arm is exact rather than tolerant: a label's own center must EQUAL
 * its tick's x. A shift of any size is a number pointing somewhere it
 * does not belong.
 */
function paintedCenters(texts, slot) {
  const box = finalBoxOf(texts, slot);
  const tickX = tickXOf(slot);
  return Charts.labelRowPlan(texts, slot, box).map(function (i) {
    const b = box(i);
    return { index: i, center: (b.left + b.right) / 2, tick: tickX(i) };
  });
}

function overlapsAmong(texts, slot) {
  const box = finalBoxOf(texts, slot);
  const boxes = Charts.labelRowPlan(texts, slot, box).map(box);
  let overlaps = 0;
  for (let k = 1; k < boxes.length; k += 1) {
    const a = boxes[k - 1];
    const b = boxes[k];
    if (!(a.right <= b.left || a.left >= b.right)) overlaps += 1;
  }
  return overlaps;
}

/* What the PRE-MARGIN bound would have done to the same rows: contained
   against the plot's own edges rather than the viewBox's. Kept as the
   proof that the margin is load-bearing - without this fixture the arm
   above could be satisfied by a row that simply never needed clamping
   for some other reason. */
function shiftedUnderPlotBound(texts, slot) {
  const tickX = tickXOf(slot);
  let shifted = 0;
  for (let i = 0; i < texts.length; i += 1) {
    const raw = Charts.tickBox(i, slot, texts[i]);
    const b = Charts.containBox(
      { left: PLOT_LEFT + raw.left, right: PLOT_LEFT + raw.right },
      PLOT_LEFT, VIEW_WIDTH);
    if (Math.abs((b.left + b.right) / 2 - tickX(i)) > 1e-9) shifted += 1;
  }
  return shifted;
}

const FIXTURES = [
  { name: "BMI (120 bands, unitless)", ticks: bmiTicks, slot: bmiSlot },
  { name: "imperial weight (44 bands)", ticks: weightTicks,
    slot: weightSlot },
  { name: "metric weight (49 bands)", ticks: metricWeightTicks,
    slot: metricWeightSlot },
];

for (const f of FIXTURES) {
  const painted = paintedCenters(f.ticks, f.slot);
  check("F2/F3/#396: " + f.name + " - every painted number is centered " +
    "EXACTLY on its own tick, to the last decimal. A shifted label is a " +
    "number pointing at a boundary that is not the one it names",
    painted.length > 0 &&
    painted.every((one) => Math.abs(one.center - one.tick) < 1e-9));

  check("F2/F3/#396: " + f.name + " - and no two painted numbers " +
    "overlap at those unshifted positions, so the no-overlap law is " +
    "met without moving anything",
    overlapsAmong(f.ticks, f.slot) === 0);

  check("F2/F3/#396: " + f.name + " - the right margin is what buys " +
    "that: contained against the PLOT's edges instead of the viewBox's, " +
    "this same row really does shift labels off their ticks",
    shiftedUnderPlotBound(f.ticks, f.slot) > 0);
}

/*
 * BOTH ENDS SPECIFICALLY. An end label straddles the axis's own end by
 * half its width, so index 0 and index n are exactly the two the old
 * bound clamped. Under the margin both sit centered on their ticks and
 * inside the viewBox, which is the pair of facts the fix has to hold at
 * once - centered is useless if the ink leaves the picture.
 */
{
  const box = finalBoxOf(bmiTicks, bmiSlot);
  const tickX = tickXOf(bmiSlot);
  const first = box(0);
  const last = box(bmiTicks.length - 1);
  check("F2/F3: the BMI row's first number is centered on the plot's " +
    "own left edge and its ink stays inside the viewBox",
    Math.abs((first.left + first.right) / 2 - tickX(0)) < 1e-9 &&
    first.left >= -1e-9);
  check("F2/F3: and its last number is centered on the plot's own right " +
    "edge, overhanging into the margin rather than being pushed off it",
    Math.abs((last.left + last.right) / 2 -
      tickX(bmiTicks.length - 1)) < 1e-9 &&
    last.right <= VIEW_WIDTH + 1e-9 &&
    last.right > VIEW_WIDTH - PLOT_RIGHT);
}

/*
 * THE TOOLTIP'S OWN TEXT (0.9-M2-S13, #378, owner ruling 2): pure,
 * checked here independent of any DOM - section 3's driven arms check
 * that the page actually wires these onto a hover/tap target.
 */
check("memberCount reads singular for exactly one",
  Charts.memberCount(1) === "1 member");
check("memberCount reads plural for zero and for more than one - " +
  "the ruling's own examples",
  Charts.memberCount(0) === "0 members" &&
  Charts.memberCount(2) === "2 members");

check("binTooltipParts, a filled band: the exact range as the lead, " +
  "the exact count as the number - the ruling's own example",
  JSON.stringify(Charts.binTooltipParts(152.4, 157.5, "cm", 2)) ===
  JSON.stringify({ lead: "152.4 cm–157.5 cm: ", number: "2 members" }));
check("binTooltipParts, an empty slot (owner ruling 2's own words: " +
  "\"including an empty slot\"): the same shape, zero as the number, " +
  "never a suppressed or different sentence for the zero case",
  JSON.stringify(Charts.binTooltipParts(157.5, 162.5, "cm", 0)) ===
  JSON.stringify({ lead: "157.5 cm–162.5 cm: ", number: "0 members" }));
check("binTooltipParts carries no unit token when the measure has none",
  Charts.binTooltipParts(20, 25, null, 3).lead === "20–25: ");

check("monthLabel reads a UTC month/year, never a locale-dependent " +
  "format",
  Charts.monthLabel(new Date("2026-08-15T00:00:00Z").getTime()) ===
  "August 2026");
check("monthLabel reads the year that instant's OWN UTC month falls " +
  "in, across a year boundary",
  Charts.monthLabel(new Date("2026-01-01T00:00:00Z").getTime()) ===
  "January 2026");

check("trendTooltipParts for the group's own point: the month and " +
  "\"Average\" as the lead, the exact value and unit as the number",
  JSON.stringify(Charts.trendTooltipParts(
    new Date("2026-08-01T00:00:00Z").getTime(), "Average", 178.6, "lb")) ===
  JSON.stringify({ lead: "August 2026 — Average: ", number: "178.6 lb" }));
check("trendTooltipParts for the You point: the same month, \"You\" as " +
  "the lead, that point's own value - owner ruling 2's own words " +
  "(\"the You point its own value\")",
  JSON.stringify(Charts.trendTooltipParts(
    new Date("2026-08-11T00:00:00Z").getTime(), "You", 180.8, "lb")) ===
  JSON.stringify({ lead: "August 2026 — You: ", number: "180.8 lb" }));
check("trendTooltipParts carries no unit token when the measure has " +
  "none",
  Charts.trendTooltipParts(0, "Average", 5, null).number === "5");

/*
 * THE COUNT AXIS (owner ruling, the 2026-08-19 late sitting, folded
 * into fix wave 1, #378): "a count scale in whole people (integer
 * ticks only)". Every tick countAxisTicks() returns is a plain
 * non-negative integer, ascending, starting at 0, reaching at least the
 * real maximum.
 */
check("countAxisTicks degenerates to the single tick 0 when every band " +
  "is empty - the whole truth of an empty axis",
  JSON.stringify(Charts.countAxisTicks(0)) === "[0]");
check("countAxisTicks always starts at 0 and reaches at least maxCount",
  Charts.countAxisTicks(37)[0] === 0 &&
  Charts.countAxisTicks(37)[Charts.countAxisTicks(37).length - 1] >= 37);
check("every countAxisTicks value is a whole number - never a fraction " +
  "of a person",
  Charts.countAxisTicks(37).every((t) => Number.isInteger(t)) &&
  Charts.countAxisTicks(3).every((t) => Number.isInteger(t)) &&
  Charts.countAxisTicks(1000).every((t) => Number.isInteger(t)));
check("countAxisTicks steps evenly - the gap between every pair of " +
  "adjacent ticks is the same",
  new Set(Charts.countAxisTicks(37).slice(1)
    .map((t, i) => t - Charts.countAxisTicks(37)[i])).size === 1);
check("countAxisTicks picks roughly five ticks, not one per unit and " +
  "not a whole different density - a 1000-person axis prints a " +
  "handful of round numbers, never 1001 labels nor twice as many " +
  "steps as the target",
  Charts.countAxisTicks(1000).length >= 4 &&
  Charts.countAxisTicks(1000).length <= 7 &&
  Charts.countAxisTicks(37).length >= 4 &&
  Charts.countAxisTicks(37).length <= 7);

/*
 * FIX WAVE 2 (#378, the finding): countAxisTicks() can push a tick past
 * `tallest` itself (tallest=7 gives ticks 0,2,4,6,8) - measured live,
 * scaling the plot to `tallest` left that pushed tick's own y ABOVE
 * `top`, painting outside the plot box (the figure's <svg> is
 * overflow:visible, so the ink lands on whatever sits above the card -
 * the owner saw the status line read "Showin8g Weight."). The ruled
 * fix is to scale to the TOP TICK instead: `most = ticks[ticks.length -
 * 1]`. This is the property itself, mapped exactly the way drawBins()
 * maps a tick to a y position, so a drift between this arm and the
 * page's own math would show up as this arm no longer describing what
 * renders - not as a hardcoded y value it would silently stop meaning.
 */
const PLOT_TOP = 20;
const PLOT_BASELINE = 260;

function tickYInsidePlot(tallest) {
  const ticks = Charts.countAxisTicks(tallest);
  const most = ticks[ticks.length - 1];
  return ticks.every(function (tick) {
    const y = PLOT_BASELINE - (tick / most) * (PLOT_BASELINE - PLOT_TOP);
    return y >= PLOT_TOP - 1e-9 && y <= PLOT_BASELINE + 1e-9;
  });
}

check("fix wave 2/#378: the reviewer's own first failing shape " +
  "(tallest=7, which pushes a tick to 8) - every tick lands inside " +
  "the plot once the scale uses the TOP tick rather than the tallest " +
  "band",
  tickYInsidePlot(7));
check("fix wave 2/#378: the reviewer's other failing shape (tallest=" +
  "14, tick 15)",
  tickYInsidePlot(14));
check("fix wave 2/#378: the property holds across every tallest-band " +
  "count from 1 through 300 - the reviewer's own sweep (216 of 300 " +
  "painted over the card before this fix), not just the two shapes " +
  "named",
  Array.from({ length: 300 }, function (_, i) { return i + 1; })
    .every(tickYInsidePlot));
check("fix wave 2/#378: the property holds on the real 120-band BMI " +
  "and 53-band imperial-weight grids' own plausible tallest-band " +
  "shapes too - not merely the small hand-picked cases",
  tickYInsidePlot(bmiGrid.length) && tickYInsidePlot(weightGrid.length));

/*
 * THE DISTRIBUTION'S TOP TRIM (owner ruling, the 2026-08-20 sitting,
 * #390): "the last painted band is the band CONTAINING the data's
 * maximum; its upper spec edge is the axis end." trimTrailingEmptyBins()
 * is the whole of the ruling as a pure function - drawDistribution() and
 * workbookRows() both call it on the response's own bins before either
 * one draws or writes a row, so THIS is where "which bins survive" is
 * decided once, for both.
 */
function bandsOf(counts) {
  return counts.map(function (count, i) {
    return { count: count, from: { imperial: i * 20 + 44 },
      to: { imperial: i * 20 + 64 } };
  });
}
function countsOf(bins) {
  return bins.map(function (b) { return b.count; });
}

check("#390: everything after the band holding the data's maximum is " +
  "dropped - a nonzero band, then two empty tail bands, keeps only " +
  "through the nonzero one",
  JSON.stringify(countsOf(Charts.trimTrailingEmptyBins(
    bandsOf([2, 0, 5, 0, 0])))) === JSON.stringify([2, 0, 5]));
check("#390 ruling 2, TOP ONLY: a leading empty stretch below the " +
  "lightest member is never trimmed - only the TAIL past the maximum " +
  "is",
  JSON.stringify(countsOf(Charts.trimTrailingEmptyBins(
    bandsOf([0, 0, 3, 0, 0])))) === JSON.stringify([0, 0, 3]));
check("#390 ruling 3: a zero grid (no band has a count) keeps drawing " +
  "whole - there is no nonzero band to anchor the trim on",
  JSON.stringify(countsOf(Charts.trimTrailingEmptyBins(
    bandsOf([0, 0, 0])))) === JSON.stringify([0, 0, 0]));
check("#390: when the last band already holds data, nothing is " +
  "trimmed - the identity case every already-full grid hits",
  Charts.trimTrailingEmptyBins(bandsOf([1, 0, 4])).length === 3);
check("#390: a single band, whatever its count, is returned whole - " +
  "trivially the band holding the maximum whenever there is only one",
  Charts.trimTrailingEmptyBins(bandsOf([0])).length === 1 &&
  Charts.trimTrailingEmptyBins(bandsOf([5])).length === 1);
check("#390: band edges never move - the surviving bins are the SAME " +
  "objects the response sent, not re-binned or rebuilt",
  (function () {
    const bins = bandsOf([2, 0, 5, 0]);
    const trimmed = Charts.trimTrailingEmptyBins(bins);
    return trimmed.every(function (b, i) { return b === bins[i]; });
  })());
check("#390: an empty bins array trims to an empty array, not an " +
  "error - drawBins()'s own no-bins early return still applies",
  Charts.trimTrailingEmptyBins([]).length === 0);

/*
 * THE TREND'S VALUE AXIS (same ruling: "if its reserved gutter carries
 * no value labels today, add them"). Exact domain values only - never a
 * "nice" number this file invented for the axis.
 */
check("valueAxisTicks returns the low value, the high value and their " +
  "exact midpoint - three real numbers, none of them rounded",
  JSON.stringify(Charts.valueAxisTicks(170, 180)) ===
  JSON.stringify([170, 175, 180]));
check("valueAxisTicks degenerates to the single value when the domain " +
  "is flat (every point equal) - nothing to interpolate between",
  JSON.stringify(Charts.valueAxisTicks(174, 174)) === "[174]");

/*
 * THE TOOLTIP'S OWN POSITION, PURE (fix wave 1, #378, finding F2). The
 * horizontal clamps were already sound (forced at both edges); the
 * bottom clamp is new. Fixtures use the reviewer's own measured figure
 * widths (702, 500, 440, 320, 220 px) at the distribution's 640:320
 * (2:1) viewBox aspect ratio, since a real figure's rendered height is
 * always exactly half its own rendered width (`width:100%; height:auto`
 * over a 640-wide, 320-tall viewBox).
 */
function distributionFigureBox(widthPx) {
  return { left: 0, top: 0, right: widthPx, bottom: widthPx / 2,
    width: widthPx, height: widthPx / 2 };
}

check("positionTooltipBox shows the tooltip ABOVE the anchor when " +
  "there is room - the ordinary case, unchanged by this fix",
  Charts.positionTooltipBox(
    { left: 100, top: 100, right: 140, bottom: 120, width: 40, height: 20 },
    distributionFigureBox(702), { width: 60, height: 30 }
  ).top < 100);

check("positionTooltipBox FLIPS BELOW when there is no room above - " +
  "the reviewer's own finding, unchanged: this branch was already " +
  "sound going down, only unbounded coming back up",
  Charts.positionTooltipBox(
    { left: 100, top: 2, right: 140, bottom: 20, width: 40, height: 18 },
    distributionFigureBox(702), { width: 60, height: 30 }
  ).top > 20);

/*
 * F2's OWN FINDING, ARMED AT EVERY MEASURED WIDTH. A distribution bar's
 * hit rect (drawBins()'s own "chart-hit") runs the FULL column height -
 * top to baseline, y 20 to 260 of the 320-tall viewBox - regardless of
 * where in it the pointer actually sits, so getBoundingClientRect()
 * returns THAT WHOLE SPAN as the anchor box for every single bar, on
 * every hover. Its own top sits near the figure's own top (small) and
 * its own bottom sits near the figure's own bottom (large) - which is
 * exactly why the old code's flip-below branch fired for every bar
 * (anchorBox.top is always small, so "place it above" never has room)
 * and why the flipped position landed with nothing left to clamp
 * against (anchorBox.bottom is always large, so "place it just below
 * the anchor" lands just below the WHOLE figure). Modeled here at the
 * viewBox's own scale (20/320 to 260/320 of the figure's height) rather
 * than picked to make the bug happen; every one of the five reviewer-
 * measured widths must now keep the WHOLE tooltip inside the figure
 * box: top >= 0 and top + tip.height <= figure.height.
 */
const F2_WIDTHS = [702, 500, 440, 320, 220];
for (const widthPx of F2_WIDTHS) {
  const figureBox = distributionFigureBox(widthPx);
  const tipBox = { width: 90, height: 34 };
  const scale = widthPx / 640;
  const anchorTop = 20 * scale;
  const anchorBottom = 260 * scale;
  const anchorBox = { left: figureBox.width / 2 - 20 * scale,
    top: anchorTop, right: figureBox.width / 2 + 20 * scale,
    bottom: anchorBottom, width: 40 * scale,
    height: anchorBottom - anchorTop };
  const position = Charts.positionTooltipBox(anchorBox, figureBox, tipBox);
  check("F2/#378: at " + widthPx + "px wide, the tooltip's top never " +
    "goes negative",
    position.top >= 0);
  check("F2/#378: at " + widthPx + "px wide, the tooltip never spills " +
    "past the figure's own bottom edge - the exact bug the review " +
    "reported (17.7px of overflow at a 320px figure)",
    position.top + tipBox.height <= figureBox.height + 1e-9);
}

/* The horizontal clamps, re-armed after the extraction into a pure
   function (still forced at both edges, unchanged behavior). */
check("positionTooltipBox clamps the left edge rather than letting the " +
  "tooltip's own left run negative",
  Charts.positionTooltipBox(
    { left: 2, top: 100, right: 10, bottom: 110, width: 8, height: 10 },
    distributionFigureBox(320), { width: 60, height: 20 }
  ).left === 0);
check("positionTooltipBox clamps the right edge rather than letting " +
  "the tooltip's own right run past the figure's own width",
  Charts.positionTooltipBox(
    { left: 300, top: 100, right: 315, bottom: 110, width: 15, height: 10 },
    distributionFigureBox(320), { width: 60, height: 20 }
  ).left === 320 - 60);

/* chartsURL: self=1 always, units always, filters (a LIST of {field,
   value} pairs, 0.9-M3-S14 against 0.9-M3-S31's landed contract, #455)
   only when there is at least one. */
const bare = new URL(Charts.chartsURL("https://w.example",
  { measure: "weight", units: "imperial", filters: [] }));
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
  { measure: "weight", units: "metric",
    filters: [{ field: "gender", value: "female" }] }));
check("a filtered request carries filter and value alongside self",
  filtered.searchParams.get("filter") === "gender" &&
  filtered.searchParams.get("value") === "female" &&
  filtered.searchParams.get("self") === "1");

/*
 * SEVERAL PAIRS NAMING ONE FIELD ARE THAT FIELD'S SET (0.9-M3-S31,
 * #455) - PAIRED BY POSITION, so getAll("filter")[i] must line up with
 * getAll("value")[i] for every i, not merely contain the same bag of
 * strings. Two fields, one of them carrying two values, interleaved in
 * the order activeFilterPairs() would build them (field order, then
 * candidate order within a field) - the shape the real ask sends.
 */
const setUrl = new URL(Charts.chartsURL("https://w.example",
  { measure: "weight", units: "imperial", filters: [
    { field: "gender", value: "male" },
    { field: "gender", value: "female" },
    { field: "country", value: "US" },
  ] }));
check("several pairs naming one field arrive as that field's own " +
  "positional set - every filter= paired with the value= at the same " +
  "index, not merely present somewhere in the query",
  JSON.stringify(setUrl.searchParams.getAll("filter")) ===
  JSON.stringify(["gender", "gender", "country"]) &&
  JSON.stringify(setUrl.searchParams.getAll("value")) ===
  JSON.stringify(["male", "female", "US"]));
check("an empty filters list sends neither filter= nor value= at all - " +
  "Everyone, not an empty pair",
  bare.searchParams.getAll("filter").length === 0 &&
  bare.searchParams.getAll("value").length === 0);

/*
 * THE ASK CARRIES THE UNIT SYSTEM NOW (owner ruling 4, #396): the Worker
 * bins on that unit's own grid, so the page has to say which one it is
 * looking at - and the page NEVER re-bins, which is why this had to
 * become a question rather than a client-side conversion.
 */
check("every request names the unit system the member is looking at",
  bare.searchParams.get("units") === "imperial" &&
  filtered.searchParams.get("units") === "metric");
check("no request ever names a floor - the floor is a server-side " +
  "setting and the wire cannot reach it (security mandate 2)",
  !bare.searchParams.has("floor") && !filtered.searchParams.has("floor"));

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
/* 2a-bis. The filter chips, pure (0.9-M3-S14, #454 items 16-18; the    */
/* gate, Prime's ruling on #455 comment 5378956164).                    */

/*
 * presentValuesOf: the one place a value list is built from an answer's
 * own group-makeup block rather than the spec alone (#454 item 18).
 */
const genderGroupEntry = { field: "gender", label: "Gender",
  values: [
    { value: "male", label: "Male", count: 10, bucket: null },
    { value: "female", label: "Female", count: 0, bucket: null },
    { value: null, label: "Not stated", count: 3, bucket: "blank" },
  ] };
check("presentValuesOf offers only a cell that cleared the floor - a " +
  "zero-count value is not offered as a filter, exactly as it is not " +
  "offered as one anywhere else on this page",
  JSON.stringify(Charts.presentValuesOf(genderGroupEntry,
    genderMeasureFixture, null)) ===
  JSON.stringify([{ value: "male", label: "Male" }]));
check("presentValuesOf never offers the blank/pooled bucket - both are " +
  "keyed by null, and neither is a real value a filter can name",
  Charts.presentValuesOf(
    { field: "gender", values: [{ value: null, label: "Not stated",
      count: 50, bucket: "blank" }] }, genderMeasureFixture, null).length
  === 0);
check("presentValuesOf resolves a country cell's real name through the " +
  "same table groupCellLabel() already uses - one lookup, not a second",
  JSON.stringify(Charts.presentValuesOf(
    { field: "country", values: [
      { value: "US", label: "US", count: 5, bucket: null }] },
    countryMeasureFixture, COUNTRY_TABLE)) ===
  JSON.stringify([{ value: "US", label: "United States" }]));

/*
 * pinFirst: pinned codes to the front, in the PINNED list's own order,
 * WITHOUT duplication (#454 item 18; the superseded build's own review,
 * #434 comment 5378073973, finding F5 - a duplicated entry lit two
 * chips for one selection).
 */
const pinFirstInput = [
  { value: "AL", label: "Albania" }, { value: "GB", label: "United Kingdom" },
  { value: "US", label: "United States" },
];
check("pinFirst moves every pinned code to the front, in the PINNED " +
  "list's own order - not the input's",
  JSON.stringify(Charts.pinFirst(pinFirstInput, ["US", "GB", "CA"])) ===
  JSON.stringify([
    { value: "US", label: "United States" },
    { value: "GB", label: "United Kingdom" },
    { value: "AL", label: "Albania" },
  ]));
check("pinFirst never duplicates a pinned entry - each value appears " +
  "exactly once in the output, not once at the front and again in its " +
  "alphabetical place",
  Charts.pinFirst(pinFirstInput, ["US", "GB", "CA"]).length === 3);
check("pinFirst skips a pinned code the list does not carry (CA here) " +
  "rather than inventing an entry for it",
  !Charts.pinFirst(pinFirstInput, ["US", "GB", "CA"])
    .some((c) => c.value === "CA"));
check("pinFirst with no pinned codes at all returns the input untouched",
  JSON.stringify(Charts.pinFirst(pinFirstInput, [])) ===
  JSON.stringify(pinFirstInput));

/*
 * rowsUsed / fitsTwoRows / decideMode: the two-row measurement (#454
 * item 17: "measured on the device... not a count"), proven here as
 * plain arithmetic over already-measured numbers - the real
 * measurement itself is a browser-time claim (this file's own driven()
 * harness has no real layout engine; see the completion's browser
 * section).
 */
check("rowsUsed counts DISTINCT rows, not chips - four chips at the " +
  "same top offset (one row that wrapped nothing) is one row",
  Charts.rowsUsed([12, 12, 12, 12]) === 1);
check("rowsUsed reads a genuine two-row wrap as 2, never more just " +
  "because there were many chips in each row",
  Charts.rowsUsed([12, 12, 12, 52, 52, 52, 52, 52]) === 2);
check("rowsUsed reads a three-row wrap (the twelve-value, 360px-wide " +
  "case this file's browser section measures) as 3, past the two-row " +
  "budget",
  Charts.rowsUsed([12, 12, 12, 12, 52, 52, 52, 52, 92, 92, 92, 92]) === 3);
check("rowsUsed tolerates a sub-pixel difference within the same row - " +
  "rounds before counting distinct values, so 12.0 and 12.4 read as one",
  Charts.rowsUsed([12.0, 12.4, 11.6]) === 1);
check("rowsUsed of an empty row is 0 - no chips, nothing to measure",
  Charts.rowsUsed([]) === 0);
check("fitsTwoRows is exactly rowsUsed(tops) <= 2",
  Charts.fitsTwoRows([12, 12]) === true &&
  Charts.fitsTwoRows([12, 52]) === true &&
  Charts.fitsTwoRows([12, 52, 92]) === false);
check("decideMode falls to chips when any offset is unmeasured (no real " +
  "getBoundingClientRect - the Node DOM stub's own shape) rather than " +
  "guessing at a real answer",
  Charts.decideMode([12, null, 52]) === "chips" &&
  Charts.decideMode([]) === "chips");
check("decideMode with real geometry that fits two rows renders chips",
  Charts.decideMode([12, 12, 52, 52]) === "chips");
check("0.9-M3-S14: decideMode with real geometry past two rows falls to " +
  "the drop list - the twelve-value, 360px-wide arm this file's own " +
  "browser section measures, reproduced as plain numbers here",
  Charts.decideMode([12, 12, 12, 12, 52, 52, 52, 52, 92, 92, 92, 92]) ===
  "list");

/*
 * fieldIsRestricted / nextFieldSelection: the gate's whole decision
 * (Prime's ruling on #455, comment 5378956164). `field(candidates,
 * selected)` below is this suite's own shorthand for the {candidateValues,
 * selected} shape buildFieldStates() produces.
 */
function field(candidateValues, selected) {
  return { field: "gender", candidateValues: candidateValues.map((v) =>
    ({ value: v, label: v })), selected };
}
const ABCD = ["a", "b", "c", "d"];

check("fieldIsRestricted is false at Everyone (every candidate selected)",
  Charts.fieldIsRestricted(field(ABCD, ABCD)) === false);
check("fieldIsRestricted is true with some but not all selected",
  Charts.fieldIsRestricted(field(ABCD, ["a"])) === true);

/* GATED (combinedEnabled === false): everyone <-> exactly one, nothing
   in between - the shape the shipped constant carries today. */
check("gated: tapping a chip from Everyone narrows STRAIGHT to that one " +
  "value - never merely turning the tapped one off, which would still " +
  "leave a three-value set",
  JSON.stringify(Charts.nextFieldSelection(field(ABCD, ABCD), "b", false,
    false)) === JSON.stringify({ selected: ["b"], notice: null }));
check("gated: tapping the field's own already-active value clears it " +
  "back to Everyone - every candidate relights",
  JSON.stringify(Charts.nextFieldSelection(field(ABCD, ["b"]), "b", false,
    false).selected.sort()) === JSON.stringify(ABCD));
check("0.9-M3-S14: gated, a SECOND chip in the SAME already-restricted " +
  "field is refused in place - the selection does not change and the " +
  "field's own notice is the within-field sentence",
  JSON.stringify(Charts.nextFieldSelection(field(ABCD, ["b"]), "c", false,
    false)) === JSON.stringify({ selected: ["b"],
    notice: Charts.WITHIN_FIELD_GATE_NOTICE }));
check("0.9-M3-S14: gated, any tap while ANOTHER field already holds one " +
  "value is refused with the cross-field sentence, changing nothing - " +
  "even a field currently at Everyone",
  JSON.stringify(Charts.nextFieldSelection(field(ABCD, ABCD), "a", true,
    false)) === JSON.stringify({ selected: ABCD,
    notice: Charts.CROSS_FIELD_GATE_NOTICE }));
check("the two gate notices are distinct plain-word sentences, never " +
  "the same string reused for both refusals",
  Charts.WITHIN_FIELD_GATE_NOTICE !== Charts.CROSS_FIELD_GATE_NOTICE &&
  /reviewed/.test(Charts.WITHIN_FIELD_GATE_NOTICE) &&
  /reviewed/.test(Charts.CROSS_FIELD_GATE_NOTICE));

/* FULL MULTI-SELECT (combinedEnabled === true) - armed here directly,
   since the shipped page never reaches this branch at all (this file's
   header: "a test arms both states by calling the pure function
   twice"). */
check("combined: tapping an UNselected value adds it to the set - real " +
  "multi-select, several values live at once",
  JSON.stringify(Charts.nextFieldSelection(field(ABCD, ["a"]), "b", false,
    true).selected.sort()) === JSON.stringify(["a", "b"]));
check("combined: tapping a SELECTED value with others still selected " +
  "removes just that one",
  JSON.stringify(Charts.nextFieldSelection(field(ABCD, ["a", "b"]), "b",
    false, true).selected) === JSON.stringify(["a"]));
check("0.9-M3-S14: combined, the LAST selected value cannot be tapped " +
  "off - \"at least one chip stays lit\" (#454 item 16) - a no-op, not " +
  "a jump to Everyone",
  JSON.stringify(Charts.nextFieldSelection(field(ABCD, ["a"]), "a", false,
    true)) === JSON.stringify({ selected: ["a"], notice: null }));
check("combined: cross-field restriction never gates anything - the " +
  "third argument is ignored entirely when the constant is true",
  Charts.nextFieldSelection(field(ABCD, ["a"]), "b", true, true).notice ===
  null);

/* activeFilterPairs: the whole ask, field order then candidate order -
   never click order, which a re-render would lose. */
const everyoneField = { field: "gender",
  candidateValues: [{ value: "male" }, { value: "female" }],
  selected: ["male", "female"] };
const oneField = { field: "gender",
  candidateValues: [{ value: "male" }, { value: "female" }],
  selected: ["female"] };
const countryTwoField = { field: "country",
  candidateValues: [{ value: "US" }, { value: "GB" }, { value: "AL" }],
  selected: ["AL", "US"] };
check("activeFilterPairs sends NO pair for a field at Everyone - the " +
  "identity 0.9-M3-S31 built the Worker side to hold (#455)",
  JSON.stringify(Charts.activeFilterPairs([everyoneField])) ===
  JSON.stringify([]));
check("activeFilterPairs sends exactly one pair for a field narrowed to " +
  "one value",
  JSON.stringify(Charts.activeFilterPairs([oneField])) ===
  JSON.stringify([{ field: "gender", value: "female" }]));
check("0.9-M3-S14: with the constant true, a field with TWO selected " +
  "values sends TWO pairs for that one field, in the field's own " +
  "candidate order (US before GB before AL) - never click order",
  JSON.stringify(Charts.activeFilterPairs([countryTwoField])) ===
  JSON.stringify([{ field: "country", value: "US" },
    { field: "country", value: "AL" }]));
check("0.9-M3-S14: two fields each narrowed send pairs for BOTH, one " +
  "field at Everyone in the mix sends nothing for itself",
  JSON.stringify(Charts.activeFilterPairs(
    [oneField, everyoneField, countryTwoField])) ===
  JSON.stringify([
    { field: "gender", value: "female" },
    { field: "country", value: "US" },
    { field: "country", value: "AL" },
  ]));

/* filterValueLabel / activeFilterWords: the status line and the xlsx's
   own filter phrase - F3's fix, this file's own header (#434 comment
   5378073973): a plain choice reads lowercase, a country name never
   does. */
const wordsMeasureFor = (name) => (name === "country" ?
  { name: "country", choicesFrom: "countries" } :
  { name: "gender", choices: [{ value: "female", label: "Female" }] });
check("filterValueLabel lowercases a PLAIN choice's own label - \"female\"," +
  " matching the owner's own #454 item 19 example (\"male feeders, weight\")",
  Charts.filterValueLabel({ field: "gender", value: "female" },
    wordsMeasureFor, null) === "female");
check("0.9-M3-S14: filterValueLabel NEVER lowercases a country's real " +
  "name - \"United States of America\", not \"united states of america\" " +
  "(F3's own fix)",
  Charts.filterValueLabel({ field: "country", value: "US" },
    wordsMeasureFor, { US: "United States of America" }) ===
  "United States of America");
check("activeFilterWords is empty for no filters at all",
  Charts.activeFilterWords([], wordsMeasureFor, null) === "");
check("activeFilterWords joins several values of ONE field with \"/\"",
  Charts.activeFilterWords(
    [{ field: "gender", value: "female" }], wordsMeasureFor, null) ===
  "female");
check("0.9-M3-S14: activeFilterWords joins several FIELDS with a space, " +
  "each field's own values \"/\"-joined first",
  Charts.activeFilterWords(
    [{ field: "gender", value: "female" },
      { field: "country", value: "US" }],
    wordsMeasureFor, { US: "United States of America" }) ===
  "female United States of America");

/* ------------------------------------------------------------------ */
/* 2b. The xlsx workbook (0.9-M2-S14, #380 ruling 3): workbookColumns() */
/* and workbookRows() are the row-marshaling this file adds; the bytes  */
/* themselves are BinderXlsx.build()'s, reused rather than reimplemented. */

check("workbookColumns names the unit inline, once, when there is one",
  JSON.stringify(Charts.workbookColumns("lb")) ===
  JSON.stringify(["Section", "Label", "Count", "Average (lb)", "You (lb)"]));
check("and carries no unit token when the measure is unitless",
  JSON.stringify(Charts.workbookColumns(null)) ===
  JSON.stringify(["Section", "Label", "Count", "Average", "You"]));

/*
 * THE WORKBOOK LEADS WITH A FILTERS ROW (0.9-M3-S14, this file's own
 * header) - "Everyone" with no filters, ahead of the not-enough
 * sentence itself, which stays the route's own words verbatim
 * (unchanged by this slice: workbookRows() never composes a variant of
 * `answer.note`, only prepends a row ahead of it).
 */
check("a not-enough answer's workbook leads with a Filters row (Everyone, " +
  "no filters on the ask), then the same honest sentence the page " +
  "prints plus the same broader-filter hint",
  JSON.stringify(Charts.workbookRows(
    { enough: false, note: "Not enough people for this view.", filters: [] },
    {}, () => null)) ===
  JSON.stringify([
    ["Filters", "Everyone", "", "", ""],
    ["Status",
      "Not enough people for this view. " + Charts.BROADER_FILTER_HINT,
      "", "", ""]]));

const NOT_ENOUGH_FILTER_FOR = (name) => (name === "gender"
  ? { name: "gender", choices: [{ value: "female", label: "Female" }] }
  : null);
check("a not-enough answer WITH a filter still leads with a Filters row " +
  "naming it, ahead of the unchanged route sentence",
  JSON.stringify(Charts.workbookRows(
    { enough: false, note: "Not enough people for this view.",
      filters: [{ field: "gender", value: "female" }] },
    {}, NOT_ENOUGH_FILTER_FOR)) ===
  JSON.stringify([
    ["Filters", "female", "", "", ""],
    ["Status",
      "Not enough people for this view. " + Charts.BROADER_FILTER_HINT,
      "", "", ""]]));

/*
 * A fixture shaped exactly like server/charts-agg.js's real answer -
 * ENOUGH_FIXTURE further down (section 3) is the same shape but this
 * one stands alone here since it is needed before that one is declared.
 * The country group's own label doubles as the hostile-string proof:
 * server/charts-agg.js sends the CODE as a placeholder label
 * (groupCellLabel()'s own header) and this page substitutes the real
 * name - here, deliberately, a formula-shaped one - through its own
 * countries table, exactly the injection surface ruling 3's apparatus
 * names ("country names and labels are member-influenced text").
 */
const WORKBOOK_COUNTRIES = { US: "=SUM(A1:A10)" };
const WORKBOOK_ANSWER = {
  enough: true,
  filters: [{ field: "country", value: "US" }],
  units: { system: "imperial", unit: "lb", locked: false },
  distribution: { bins: [
    { count: 3, from: 25, to: 150 },
  ] },
  trend: { points: [
    { period: "2026-08", average: 178.6 },
  ] },
  self: { points: [
    { at: "2026-08-11T00:00:00.000Z", value: 180.8 },
  ] },
  groups: [
    { field: "country", label: "Country", multiple: false, values: [
      { value: "US", label: "US", count: 5, bucket: null },
    ] },
  ],
};
const workbookMeasureFor = (name) => (name === "country"
  ? { name: "country", choicesFrom: "countries" } : null);

const workbookRows = Charts.workbookRows(WORKBOOK_ANSWER,
  WORKBOOK_COUNTRIES, workbookMeasureFor);

check("0.9-M3-S14: the workbook's very first row is Filters, ahead of " +
  "every other section - the same words the status line would print, " +
  "resolved through the same country table the group-makeup row below " +
  "uses (the hostile-string proof applies here too: a country name " +
  "shaped like a formula arrives as that literal text, not as row 0's " +
  "own special case)",
  workbookRows[0][0] === "Filters" && workbookRows[0][1] === "=SUM(A1:A10)");
check("the distribution row carries the exact band range in the unit " +
  "the answer is expressed in, and the raw count as a NUMBER",
  workbookRows.some((r) => r[0] === "Distribution" &&
    r[1] === "25 lb–150 lb" && r[2] === 3 && typeof r[2] === "number"));
check("the group's own average trend point lands in the Average column, "
  + "the You column blank",
  workbookRows.some((r) => r[0] === "Trend" && r[3] === 178.6 && r[4] === ""));
check("the self point lands in the You column, the Average column blank",
  workbookRows.some((r) => r[0] === "Trend" && r[4] === 180.8 && r[3] === ""));
check("the group-makeup row carries the field's own label in its " +
  "section and the looked-up country name, not the response's code " +
  "placeholder",
  workbookRows.some((r) => r[0] === "Group makeup — Country" &&
    r[1] === "=SUM(A1:A10)" && r[2] === 5));

/*
 * #390 ruling 6: the workbook's distribution rows end at the same band
 * the chart ends at - workbookRows() calls the identical
 * trimTrailingEmptyBins() on the identical `answer.distribution.bins`,
 * so a download can never carry a tail the screen does not show.
 */
const WORKBOOK_TRIM_ANSWER = {
  enough: true,
  filters: [],
  units: { system: "imperial", unit: "lb", locked: false },
  distribution: { bins: [
    { count: 2, from: 25, to: 50 },
    { count: 0, from: 50, to: 75 },
    { count: 5, from: 75, to: 100 },
    { count: 0, from: 100, to: 125 },
    { count: 0, from: 125, to: 150 },
  ] },
  trend: null, self: null, groups: [],
};
const workbookTrimRows = Charts.workbookRows(WORKBOOK_TRIM_ANSWER,
  {}, () => null);
const workbookTrimDistRows = workbookTrimRows.filter((r) => r[0] === "Distribution");
check("#390 ruling 6: the workbook's distribution rows stop at the same " +
  "band the chart stops at - three rows, not five, for a grid whose " +
  "last two bands are an empty tail past the maximum",
  workbookTrimDistRows.length === 3);
check("#390: the workbook's LAST distribution row is the band holding " +
  "the maximum (75 lb-100 lb, count 5), never the spec's own trailing " +
  "empty bands - read by `.length - 1`, not a fixed index, so a trim " +
  "that runs but stops one band early or late still reddens this " +
  "(fix wave 1, F4: a hardcoded index [2] passed even with the trim " +
  "unwired, since the fixture's own untrimmed row 2 is also this band)",
  workbookTrimDistRows[workbookTrimDistRows.length - 1][1] ===
  "75 lb–100 lb" &&
  workbookTrimDistRows[workbookTrimDistRows.length - 1][2] === 5);

/*
 * THE PROOF: a hostile "=SUM(...)"-style country name arrives INERT
 * through the whole pipeline - workbookRows() above composed it as a
 * plain string, and BinderXlsx.build()'s own cellXml() (dev/xlsx.test.
 * mjs: "a formula-looking value is a string, not defused") types every
 * non-numeric cell as an inline string with no <f> formula element,
 * ever. Read back with the same minimal ZIP reader dev/xlsx.test.mjs
 * uses to prove its own writer (a reader written to check a writer,
 * copied here rather than imported across the dev/tests boundary - see
 * AGENTS.md on re-using an old testing artifact needing a stated
 * reason: this is test-only plumbing, not a check being reused).
 */
function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("no end-of-central-directory record");
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = [];
  for (let i = 0; i < count; i++) {
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const compressed = view.getUint32(at + 20, true);
    const offset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    const localNameLen = view.getUint16(offset + 26, true);
    const localExtraLen = view.getUint16(offset + 28, true);
    const start = offset + 30 + localNameLen + localExtraLen;
    entries.push({ name, data: bytes.subarray(start, start + compressed) });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const WORKBOOK_BYTES = Xlsx.build(
  Charts.workbookColumns("lb"), workbookRows, "Charts",
  Date.UTC(2026, 7, 20, 12, 0, 0));
const sheet = unzip(WORKBOOK_BYTES)
  .find((e) => e.name === "xl/worksheets/sheet1.xml");
const sheetXml = new TextDecoder().decode(sheet.data);

check("the hostile country name reaches the sheet as an inline STRING, "
  + "no <f> formula element anywhere in the workbook - inert by the "
  + "writer's own cell typing, exactly the way dev/xlsx.test.mjs proves "
  + "it for admin.js's export",
  sheetXml.includes('t="inlineStr"') &&
  sheetXml.includes("=SUM(A1:A10)") && !sheetXml.includes("<f>"));
check("and it opens under the same ZIP reader dev/xlsx.test.mjs holds "
  + "the admin export to - every part present, nothing truncated",
  unzip(WORKBOOK_BYTES).map((e) => e.name).sort().join(",") ===
  ["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels",
    "xl/workbook.xml", "xl/worksheets/sheet1.xml"].join(","));

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
    // A real radio with no `disabled` attribute reads false, not
    // undefined - apps/web/charts.html ships both units radios that way,
    // and #396 unit lock is the first thing that ever writes this
    // property, so an `undefined` default would let a page that never
    // re-enables them still read as correct.
    disabled: false,
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
  // A real element's textContent reads every descendant text node
  // concatenated, not merely its own leaf text - 0.9-M2-S13's tooltip
  // (#378, showTooltip()) sets textContent on two CHILD spans rather
  // than on the tooltip div itself, and a getter that only ever
  // returned this element's own `_text` would read that div as
  // permanently empty (the setter below clears `_text` to "" and wipes
  // any prior children the moment the div's own textContent was last
  // assigned, and nothing after that touches `_text` again once real
  // children exist). `_text` is only ever meaningful with no children -
  // the setter's own invariant - so recursing over children when there
  // are any, falling back to `_text` otherwise, matches a real DOM
  // element exactly for every shape this suite builds.
  function textOf(node) {
    return node.children.length
      ? node.children.map(textOf).join("")
      : node._text;
  }
  Object.defineProperty(el, "textContent", {
    get: () => textOf(el),
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
const NEEDED = ["filter-rows",
  "measure", "picture-field", "picture-tab-trend",
  "picture-tab-distribution", "picture-trend", "picture-distribution",
  "figure-trend", "figure-distribution", "groups", "groups-body",
  "results", "status", "show-me", "download", "tooltip-trend",
  "tooltip-distribution"];
check("every element this suite drives is really in apps/web/charts.html",
  NEEDED.every((id) => IDS.includes(id)));

/*
 * 0.9-M2-S15 fix wave 1 (#383), F1 and F4: the stub DOM above is built by
 * hand (buildDom(), below) - it invents its own element tree from the
 * NEEDED id list, so it has no opinion on WHERE an id sits in the real
 * page or WHETHER the real markup ships it hidden. The review's own
 * proof: moving the picture-field fieldset back into the controls card
 * left every stub-driven check green, because the stub never asked
 * where it was. These two checks read the real markup TEXT instead -
 * both apps/web/charts.html and its dist/ mirror, since 0.9-M2-S15's
 * own ruling (point 6) is "both trees".
 *
 * F1: the fieldset sits inside #results (after it opens) and above
 * #status (before that paragraph) - the two id strings are unique in
 * this page (grepped), so their raw string positions are the ordering.
 *
 * F4: the fieldset's own opening tag carries the `hidden` attribute in
 * the shipped markup - not merely in buildDom()'s own default, which
 * F4 found was the only thing the old "absent before any press" check
 * actually read.
 */
const distCharts = await read("../dist/charts.html");

function pictureFieldOrder(text) {
  return {
    results: text.indexOf('id="results"'),
    picture: text.indexOf('id="picture-field"'),
    status: text.indexOf('id="status"'),
  };
}

function fieldsetOpeningTag(text, id) {
  const found = text.match(new RegExp('<fieldset\\b[^>]*\\bid="' + id + '"[^>]*>'));
  return found ? found[0] : null;
}

for (const [label, text] of
    [["apps/web/charts.html", PAGE_HTML], ["dist/charts.html", distCharts]]) {
  const order = pictureFieldOrder(text);
  check("0.9-M2-S15 F1 (#383 fix wave 1): " + label + "'s own real markup " +
    "places the picture-field fieldset inside #results and above #status " +
    "- read from the shipped text, not the stub DOM",
    order.results !== -1 && order.picture !== -1 && order.status !== -1 &&
    order.results < order.picture && order.picture < order.status);

  const tag = fieldsetOpeningTag(text, "picture-field");
  check("0.9-M2-S15 F4 (#383 fix wave 1): " + label + "'s own shipped " +
    "fieldset carries the hidden attribute - read from the real opening " +
    "tag, not buildDom()'s default",
    tag !== null && /\bhidden\b/.test(tag));
}

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

  byId.get("measure").tag = "select";
  byId.get("show-me").tag = "button";
  byId.get("download").tag = "a";
  // apps/web/charts.html ships the download anchor `hidden` by default;
  // offerDownload() is what reveals it once a response exists.
  byId.get("download").hidden = true;
  // 0.9-M2-S15 (#383): apps/web/charts.html ships the picture toggle's
  // own fieldset `hidden` by default too, same as the download anchor
  // above - there is nothing to choose a picture of before a drawn
  // answer exists. renderAnswer() is the only thing that ever flips it.
  byId.get("picture-field").hidden = true;
  // The shipped markup's own default selection: Trend's tab carries
  // aria-selected="true" and Distribution's carries "false" as static
  // HTML, which is what renderAnswer()'s `selected` read (charts.js)
  // actually reads on a page nobody has clicked a tab on yet.
  // picture-distribution ships `hidden` in the markup for the same
  // reason - a stub `node("div")` defaults hidden=false, which would
  // read as "both panels visible" and hide a regression to this file's
  // own read of the DOM's aria-selected default.
  byId.get("picture-tab-trend").setAttribute("aria-selected", "true");
  byId.get("picture-tab-distribution").setAttribute("aria-selected", "false");
  byId.get("picture-distribution").hidden = true;
  const svgTrend = node("svg");
  const svgDist = node("svg");
  byId.get("figure-trend").appendChild(svgTrend);
  byId.get("figure-distribution").appendChild(svgDist);
  // apps/web/charts.html ships both tooltips `hidden` by default too -
  // showTooltip()/hideTooltip() are what flip that (0.9-M2-S13, #378).
  byId.get("tooltip-trend").hidden = true;
  byId.get("tooltip-distribution").hidden = true;

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
  // The document itself needs to be a listenable target too, since
  // 0.9-M2-S13 (#378) wires dismissTooltipElsewhere() onto it once in
  // setUp() (owner ruling 2: "tapping elsewhere dismisses") - the same
  // addEventListener/dispatch shape node() gives every element, so
  // `doc.dispatch("click")` below can stand in for a tap that landed
  // somewhere this suite never built an element for.
  const docListeners = {};
  const doc = {
    body,
    getElementById: (id) => byId.get(id) || null,
    createElement: (tag) => node(tag),
    createElementNS: (_ns, tag) => node(tag),
    querySelectorAll: (selector) => {
      if (selector === 'input[name="units"]') return unitsInputs;
      return [];
    },
    addEventListener: (type, fn) => {
      (docListeners[type] = docListeners[type] || []).push(fn);
    },
    dispatch: (type) => {
      (docListeners[type] || []).slice().forEach((fn) => fn({}));
    },
  };
  // Every "a" this page creates, in creation order - wireDownload()'s
  // own throwaway trigger is the only one, and it is removed from
  // document.body immediately after its click (this array is what lets
  // a test still read its .download/.href after that removal).
  const createdAnchors = [];
  const rawCreateElement = doc.createElement;
  // `options.simulateChipWrap`, a chips-per-row count: this stub has no
  // real layout engine (AGENTS.md: "the Node DOM stub proves wiring,
  // never pixels"), so decideMode() falls back to chips for every field
  // by design (this file's header, section 2a-bis) UNLESS something
  // gives its chip <button>s a getBoundingClientRect() to read. Every
  // dynamically created button gets one here, in GLOBAL creation order -
  // buildChipButtons() is the only caller that ever makes a "button"
  // (the picture tabs and Show-me are static markup, node("button") in
  // buildDom() above, never document.createElement) - so a field with
  // few candidates still lands in one simulated row while a field with
  // many wraps into several, proving the DOM's own switch to a native
  // drop list, not merely the pure decideMode() function in isolation.
  let chipCreateCount = 0;
  doc.createElement = (tag) => {
    const el = rawCreateElement(tag);
    if (tag === "a") createdAnchors.push(el);
    if (tag === "button" && options.simulateChipWrap) {
      const index = chipCreateCount;
      chipCreateCount += 1;
      const row = Math.floor(index / options.simulateChipWrap);
      el.getBoundingClientRect = () => ({ top: row * 40 });
    }
    return el;
  };

  return { doc, byId, unitsInputs, createdAnchors };
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
 * The baseline (unfiltered) GET /charts-data answer setUp() reads
 * `groups` off to build the filter rows (0.9-M3-S14; this file's own
 * header). A real value in each categorical field's own present-value
 * list - never zero-candidate rows a driven() caller would then have
 * to special-case just to exercise a click.
 */
function defaultBaselineAnswer() {
  return {
    ok: true, enough: true, filters: [],
    groups: [
      { field: "gender", label: "Gender", term: "gender", multiple: false,
        values: [
          { value: "male", label: "Male", count: 10, bucket: null },
          { value: "female", label: "Female", count: 8, bucket: null },
          { value: null, label: "Not stated", count: 2, bucket: "blank" },
        ] },
      { field: "country", label: "Country", term: "country", multiple: false,
        values: [
          { value: "US", label: "US", count: 5, bucket: null },
          { value: "AL", label: "AL", count: 1, bucket: null },
          { value: null, label: "Not stated", count: 3, bucket: "blank" },
        ] },
    ],
  };
}

/*
 * `opts.defaultSystem` stands in for apps/web/site.config.js's
 * units.default, read through apps/fields.js's defaultSystem() (F2's
 * arm below flips it both directions). It is a fixture value here for
 * the same reason BinderFields itself is fixtured throughout this
 * file - never the real site.config.js/fields.js pair - but it is
 * standing in for the exact same fact currentSystem() now derives from.
 *
 * SETUP NOW MAKES TWO FETCHES OF ITS OWN, AHEAD OF ANY SHOW-ME PRESS
 * (0.9-M3-S14, this file's own header): GET /spec (the effective spec)
 * and one unfiltered GET /charts-data (to learn which filter values are
 * present). `fetchImpl`, the caller's own argument, answers ONLY calls
 * beyond those two - which for every existing call site means exactly
 * what it always meant, the Show-me press's own response - so the huge
 * majority of this file's driven() calls needed no change at all.
 * `opts.spec`/`opts.baseline` override the two setup answers when a
 * test is specifically about them; `opts.captureFieldsArgs` records
 * every `given` argument BinderFields.measures()/measure() was called
 * with, which is how this file proves charts.js is really reading the
 * EFFECTIVE spec GET /spec returned rather than some fixed global (the
 * gap DESIGN.md's "Where configuration lives" named: "Charts... do not
 * yet").
 */
async function driven(fetchImpl, opts) {
  const options = opts || {};
  const { doc, byId, unitsInputs, createdAnchors } = buildDom(options);
  const calls = [];
  const fieldsCalls = [];
  // The create-revoke pairing (0.9-M2-S12, #373's pattern, carried to
  // this file's own rebuild): two arrays rather than a count, because a
  // count alone cannot tell "every created URL got revoked" from "one
  // got revoked twice and another leaked".
  const created = [];
  const revoked = [];
  // The real Blob wireDownload() built, one per created URL - a plain
  // array rather than a Map keyed by url, matching `created`/`revoked`
  // above (0.9-M2-S12, #373's own pairing shape). Node's global Blob is
  // real (no stub needed), so `blobs[i].arrayBuffer()` below reads back
  // the exact bytes BinderXlsx.build() wrote.
  const blobs = [];
  const g = globalThis;
  g.document = doc;
  g.URL.createObjectURL = (blob) => {
    const url = "blob:test-" + created.length;
    created.push(url);
    blobs.push(blob);
    return url;
  };
  g.URL.revokeObjectURL = (url) => { revoked.push(url); };
  g.BinderUI = undefined;
  g.BinderSession = {
    require: () => ({ session: "tok" }),
    authorization: () => ({ Authorization: "Bearer tok" }),
    clear: () => { calls.push("session-cleared"); },
  };
  // orderedChoices() replicates apps/web/fields.js's own algorithm
  // (0.9-M2-S14, #380 ruling 4) rather than importing that file, the
  // same fixture-not-import shape every other BinderFields member here
  // already takes - pinnedCountries() ignores the `site` it is handed
  // for the same reason. `given` is the effective spec (GET /spec's
  // own body, or the default fixture below) - measures()/measure()
  // themselves still ignore it and answer measureFixture() regardless,
  // matching the fixture-not-import shape, but `given` is RECORDED when
  // `captureFieldsArgs` asks for it, which is what proves the SAME
  // object /spec returned is what reaches every call.
  const specFixtureMeasures = options.measures || measureFixture();
  g.BinderFields = {
    measures: (given) => {
      if (options.captureFieldsArgs) fieldsCalls.push({ fn: "measures", given });
      return specFixtureMeasures;
    },
    measure: (name, given) => {
      if (options.captureFieldsArgs) fieldsCalls.push({ fn: "measure", given });
      return specFixtureMeasures.find((m) => m.name === name);
    },
    defaultSystem: () => options.defaultSystem || "imperial",
    pinnedCountries: () => ["US", "GB", "CA"],
    orderedChoices: (choices, pinned) => {
      const byValue = {};
      choices.forEach((c) => { byValue[c.value] = c; });
      const front = (pinned || [])
        .filter((code) => Object.prototype.hasOwnProperty.call(byValue, code))
        .map((code) => byValue[code]);
      return front.concat(choices);
    },
  };
  g.BINDER_SITE = { fields: [] };
  // GB and CA join the two countries already here (0.9-M2-S14, #380
  // ruling 4's own fixture): all three pinned codes now have a real
  // name behind them, so the pin-ordering arm below can prove the
  // pinned block lands at the front in full, not merely "some of it".
  g.BINDER_COUNTRIES = { US: "United States", AL: "Albania",
    GB: "United Kingdom", CA: "Canada" };
  g.BINDER_CONFIG = { endpoint: "https://w.example" };

  // The effective spec GET /spec answers with, as a distinct OBJECT
  // (not merely equal JSON) when `opts.spec` names one - object
  // identity is what fieldsCalls above can prove reached BinderFields,
  // which JSON equality could not tell apart from a coincidence.
  const specBody = Object.prototype.hasOwnProperty.call(options, "spec")
    ? options.spec : {};
  let baselineServed = false;
  g.fetch = async (url, init) => {
    calls.push(String(url));
    const target = new URL(String(url));
    if (target.pathname === "/spec") {
      return response(200, { spec: specBody });
    }
    if (!baselineServed) {
      baselineServed = true;
      const baseline = Object.prototype.hasOwnProperty.call(options, "baseline")
        ? options.baseline : defaultBaselineAnswer();
      return response(200, baseline === null
        ? { ok: true, enough: false, filters: [],
          note: "Not enough people for this view.", groups: null }
        : baseline);
    }
    return fetchImpl(url, init);
  };

  await import("data:text/javascript," + encodeURIComponent(uiSrc) +
    "#charts-ui-" + Math.random());
  // `options.source` is the combined-mode arms' own escape hatch (this
  // file's own header, section 3b): the REAL file's bytes with exactly
  // one line's constant flipped, in memory only - apps/web/charts.js on
  // disk is never touched.
  await import("data:text/javascript," +
    encodeURIComponent(options.source || src) + "#charts-page-" +
    Math.random());

  // Two ticks rather than one: setUp() now chains TWO sequential
  // fetches (GET /spec, then the baseline GET /charts-data) ahead of
  // any wiring - still pure microtasks under this stub's synchronous
  // fetch, which drain fully before either timer fires, but the extra
  // tick is cheap insurance against a future await this chain grows.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  // 0.9-M2-S15 (#383): `skipPress` leaves setUp() run but Show me
  // unpressed - the one way this harness can inspect the page's own
  // BEFORE-any-answer state (the picture toggle's own default-hidden
  // arm below), since every other caller wants the post-press page.
  if (!options.skipPress) await pressShowMe(byId);

  return { byId, doc, calls, fieldsCalls, unitsInputs, created, revoked,
    blobs, createdAnchors };
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
 * 0.9-M2-S15 (#383), apparatus point 1: "before the first successful
 * Show me: the control is absent from view (hidden, not merely
 * disabled)". `skipPress` leaves setUp() wired but never presses Show
 * me, so this is the page exactly as a member who has not pressed
 * anything yet sees it - fetch is never called, and the only fixture
 * that matters is that no fixture is ever served.
 */
{
  const { byId, calls } = await driven(() => {
    throw new Error("Show me was never pressed - GET /charts-data should " +
      "not fire a second time");
  }, { skipPress: true });
  // setUp() itself fetches GET /spec and one unfiltered GET /charts-data
  // now (0.9-M3-S14, this file's own header, to build the filter rows) -
  // "nothing fetched to get there" now means no THIRD call, never that
  // setup itself fetched nothing.
  check("0.9-M2-S15: the picture toggle is absent before any Show me " +
    "press - hidden, not merely disabled - and setUp()'s own two " +
    "fetches (GET /spec, one baseline GET /charts-data) are the whole " +
    "of what fired",
    byId.get("picture-field").hidden === true && calls.length === 2 &&
    new URL(calls[0]).pathname === "/spec" &&
    new URL(calls[1]).pathname === "/charts-data");
}

/*
 * One `.chip-row`'s own chips, read the same way page_chips() reads a
 * theme swatch elsewhere on this site: the two child spans' own text,
 * never trusted as one flat string this suite would have to re-split.
 * apps/web/charts.js's renderChip() is the only thing that ever builds
 * one (0.9-M2-S13, #378) - `.chip-name`'s textContent, `.chip-count`'s,
 * and whether the chip's own class carries "chip-zero".
 */
function chipsOf(row) {
  return row.children.filter((c) => c.tag === "span").map((chip) => ({
    name: chip.children.find((c) => c.attrs.class === "chip-name")._text,
    count: chip.children.find((c) => c.attrs.class === "chip-count")._text,
    zero: chip.className.split(" ").includes("chip-zero"),
  }));
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
    kind: "bins" },
  // The LIST echo (0.9-M3-S31, #455), superseding the old single
  // {field,value} pair - empty for Everyone, exactly what
  // activeFilterPairs() sends when every chip is lit.
  filters: [], floor: 0,
  enough: false, note: "Not enough people for this view.", units: null,
  trend: null, distribution: null, groups: null, self: null,
};

{
  const { byId, calls } = await driven(() => response(200, NOT_ENOUGH_FIXTURE));
  // Three calls total now: GET /spec, the baseline GET /charts-data
  // (0.9-M3-S14, this file's own header) and the Show-me press's own -
  // "exactly one" narrows to the press itself, the last of the three.
  check("Show me fires exactly one GET /charts-data of its own beyond " +
    "setUp()'s baseline read, never /snapshot and never the page's own " +
    "/charts URL",
    calls.length === 3 &&
    calls.filter((u) => new URL(u).pathname === "/charts-data").length === 2 &&
    new URL(calls[calls.length - 1]).pathname === "/charts-data" &&
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

  /*
   * 0.9-M2-S15 fix wave 1 (#383), F2: the check above is true trivially
   * for picture-distribution if renderAnswer()'s not-enough branch never
   * hides it at all - buildDom() (this slice's own GREEN wave) now
   * starts picture-distribution hidden by default too, for a DIFFERENT
   * reason (matching the shipped markup's own aria-selected pair, F4's
   * neighbor), and that default alone was enough to keep this check
   * green with the real hide call deleted (the review's own finding,
   * undisclosed in the original wave). Forcing both panels visible
   * first, then pressing again against the SAME not-enough fixture,
   * proves the hide calls actually fire rather than proving the stub's
   * own starting state.
   */
  byId.get("picture-trend").hidden = false;
  byId.get("picture-distribution").hidden = false;
  await pressShowMe(byId);
  check("0.9-M2-S15 F2 (#383 fix wave 1): the not-enough branch actively " +
    "hides both figures - forced visible first, so this fails if either " +
    "hide call is ever deleted",
    byId.get("picture-trend").hidden === true &&
    byId.get("picture-distribution").hidden === true);
  check("0.9-M2-S15, apparatus point 3: the picture toggle hides again " +
    "on the not-enough view - there is no picture left to choose " +
    "between",
    byId.get("picture-field").hidden === true);
  check("the group makeup block stays hidden on an empty view",
    byId.get("groups").hidden === true);

  /*
   * The check above is true trivially if renderAnswer()'s not-enough
   * branch never touches picture-field at all - it ships hidden by
   * default (buildDom()'s own mirror of the real markup), so a missing
   * hide call would still read hidden here. Forcing it visible first,
   * THEN pressing Show me again against the same not-enough fixture,
   * proves the hide call itself fires rather than merely proving the
   * field started hidden and nothing ever touched it.
   */
  byId.get("picture-field").hidden = false;
  await pressShowMe(byId);
  check("0.9-M2-S15: the not-enough branch actively hides the picture " +
    "toggle - forced visible first, so this fails if renderAnswer() " +
    "never calls show($(\"picture-field\"), false) at all",
    byId.get("picture-field").hidden === true);
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
  filters: [],
  floor: 0,
  enough: true,
  note: null,
  units: { system: "imperial", unit: "lb", locked: false },
  trend: { points: [
    { period: "2026-06", people: 6, average: 176.4 },
    { period: "2026-08", people: 7, average: 178.6 },
  ] },
  distribution: {
    kind: "bins",
    partition: { system: "imperial", unit: "lb", band: "25 lb bands" },
    bins: [
      { count: 6, from: 150, to: 175 },
      { count: 3, from: 175, to: 200 },
      { count: 7, from: 200, to: 225 },
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
    { at: "2026-06-05T00:00:00.000Z", value: 174.2 },
    { at: "2026-08-11T00:00:00.000Z", value: 180.8 },
  ] },
};

/*
 * THE SAME ANSWER, ASKED IN THE OTHER SYSTEM (owner ruling 4, #396).
 * Switching units is a fresh question now, so the metric view is a
 * SEPARATE response with its own grid - not a second key of this one.
 * Every number in it is deliberately unlike its imperial counterpart,
 * which is what lets the toggle arm tell a real re-ask from a no-op.
 */
const ENOUGH_FIXTURE_METRIC = Object.assign({}, ENOUGH_FIXTURE, {
  units: { system: "metric", unit: "kg", locked: false },
  trend: { points: [
    { period: "2026-06", people: 6, average: 80 },
    { period: "2026-08", people: 7, average: 81 },
  ] },
  distribution: {
    kind: "bins",
    partition: { system: "metric", unit: "kg", band: "10 kg bands" },
    bins: [
      { count: 6, from: 70, to: 80 },
      { count: 3, from: 80, to: 90 },
      { count: 7, from: 90, to: 100 },
    ],
  },
  self: { points: [
    { at: "2026-06-05T00:00:00.000Z", value: 79 },
    { at: "2026-08-11T00:00:00.000Z", value: 82 },
  ] },
});

/*
 * AND THE SAME ANSWER UNDER A RAISED FLOOR'S UNIT LOCK (the 2026-08-21
 * axis sitting's escalation, #396): one system is served, the answer
 * says so, and the page has to make the toggle inert rather than let a
 * member press something that cannot move.
 */
const LOCKED_FIXTURE = Object.assign({}, ENOUGH_FIXTURE_METRIC, {
  floor: 5,
  units: { system: "metric", unit: "kg", locked: true },
});

{
  const { byId } = await driven(() => response(200, ENOUGH_FIXTURE));
  /*
   * OWNER RULING 2 (#396): the unit lives in the status line and
   * nowhere else on the page. The sentence is showingLine()'s own
   * answer, composed from the response's measure label and its one
   * unit - so a page that stopped naming the unit, or named a unit the
   * answer did not send, reddens here rather than in a figure whose
   * numbers no longer say what they are counting.
   */
  check("a real answer draws - the status line names the measure and " +
    "its unit, not an error",
    byId.get("status")._text === Charts.showingLine("Weight", "lb"));
  check("the status line is the ruling's own sentence, verbatim",
    byId.get("status")._text === "Showing Weight (lb).");
  check("download is offered once a response exists - the button is " +
    "unhidden",
    byId.get("download").hidden === false);
  check("0.9-M2-S15, apparatus point 2: the picture toggle appears once " +
    "a drawn answer exists",
    byId.get("picture-field").hidden === false);
  check("0.9-M2-S15: the flip shows exactly one figure at a time - the " +
    "default selection (Trend, aria-selected=true in the shipped " +
    "markup) draws the trend figure and hides the distribution one",
    byId.get("picture-trend").hidden === false &&
    byId.get("picture-distribution").hidden === true);

  /*
   * 0.9-M2-S15 fix wave 1 (#383), sibling sweep (found while fixing F2
   * and F4 - the same disease, a third sibling): the check above is
   * true trivially too. buildDom() starts picture-trend hidden=false
   * and picture-distribution hidden=true by default, to match the
   * shipped markup's own default selection (Trend) - which is exactly
   * the state a CORRECT draw also produces on that same default. Delete
   * both show() calls in renderAnswer()'s enough branch and this check
   * would stay green, reading the stub's starting state rather than
   * anything renderAnswer() did. Forcing the opposite state first, then
   * pressing again against the SAME fixture, proves the calls fire.
   */
  byId.get("picture-trend").hidden = true;
  byId.get("picture-distribution").hidden = false;
  await pressShowMe(byId);
  check("0.9-M2-S15 (#383 fix wave 1, sibling sweep): renderAnswer() " +
    "actively draws the default selection - forced to the opposite " +
    "state first, so this fails if the two show() calls are ever " +
    "deleted",
    byId.get("picture-trend").hidden === false &&
    byId.get("picture-distribution").hidden === true);

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
  const allText = svg.children.filter((c) => c.tag === "text");
  const labels = allText.map((c) => c._text);
  check("no rendered label uses the retired open-edge shape (\"under " +
    "X\"/\"X and up\") - server/charts-agg.js's openEdge() is gone " +
    "(0.9-M2-S10) and every edge here is a plain number",
    !labels.some((t) => /^under /.test(t) || / and up$/.test(t)));

  /*
   * F1's behavioral arm (0.9-M2-S3 fix wave 1, #354 comment 5342979192),
   * carried through the 0.9-M2-S11 reshape, its own review's F1/F2
   * geometry fix, and the #396 axis reshape: the rendered BAR count is
   * compared against the fixture's OWN bins, index for index, in the
   * response's own order, and every number under the axis is one of
   * that same response's own EDGES. A client-side pooler, merger or
   * re-binner reddens here regardless of what it calls itself, because
   * it is asked what actually painted. With only 3 bands there are 4
   * ticks spaced 196 user units apart, so nothing collides and every
   * tick paints; the sparse case - where labelRowPlan() actually drops
   * some - is BANDS_FIXTURE's own arm below.
   *
   * The count-axis ticks are the only end-anchored labels in this
   * figure now (#396 retired the axis-edge unit marker that used to
   * share their class and anchor), which is why `endAnchored` needs no
   * x-position split any more - and the arm below asserts exactly that
   * absence rather than assuming it.
   */
  const tickEls = allText.filter((c) => c.attrs.class === "chart-label" &&
    c.attrs["text-anchor"] === "middle");
  const tickLabels = tickEls.map((c) => c._text);
  const axisTicks = allText.filter((c) => c.attrs.class === "chart-label" &&
    c.attrs["text-anchor"] === "end");
  const bars = svg.children.filter((c) => c.tag === "rect" &&
    c.attrs.class === "chart-bar");
  const tickMarks = svg.children.filter((c) => c.tag === "line" &&
    c.attrs.class === "chart-axis" && Number(c.attrs.y1) !== Number(c.attrs.y2));
  const fixtureBins = ENOUGH_FIXTURE.distribution.bins;
  const fixtureUnit = ENOUGH_FIXTURE.units.unit;
  const fixtureEdges = [fixtureBins[0].from]
    .concat(fixtureBins.map((b) => b.to));
  check("F1: the rendered bar count equals the response's bin count " +
    "exactly - a client-side pooler that merges adjacent bins reddens " +
    "here regardless of what it calls itself",
    bars.length === fixtureBins.length);
  check("#396 ruling 1: the number row is the response's own BAND " +
    "EDGES, in order - one more label than there are bars, each one a " +
    "boundary the answer really sent, never a midpoint or anything " +
    "else this page computed",
    tickLabels.length === fixtureEdges.length &&
    fixtureEdges.every((edge, i) => tickLabels[i] === Charts.tickLabel(edge)));
  check("#396 ruling 1: every painted number carries a tick MARK on the " +
    "axis at its own position - a number floating with no mark under it " +
    "is what made the old caption row ambiguous",
    tickMarks.length === tickLabels.length);
  /*
   * F2/F3, READ BACK OFF THE RENDERED SVG: each number's own x attribute
   * equals its mark's x, exactly. The pure arms above prove the plan
   * produces unshifted boxes; this proves the page PAINTS from them, on
   * the same nodes a member would be looking at.
   */
  check("F2/F3/#396: every rendered number's x is its own tick mark's " +
    "x, exactly - the page paints each number on the boundary it names " +
    "and never beside it",
    tickMarks.length > 0 &&
    tickLabels.length === tickMarks.length &&
    tickEls.every((el, i) =>
      Math.abs(Number(el.attrs.x) - Number(tickMarks[i].attrs.x1)) < 1e-9));
  check("#378 owner ruling: each bar's height reflects its own count, " +
    "in the response's own order (the largest fixture count, 7, draws " +
    "the tallest bar; every non-zero count draws a positive height) - " +
    "the height a pooled/re-summed draw could not reproduce in order",
    fixtureBins.every((bin, i) => bin.count > 0
      ? Number(bars[i].attrs.height) > 0
      : Number(bars[i].attrs.height) === 0) &&
    Number(bars[2].attrs.height) > Number(bars[1].attrs.height) &&
    Number(bars[0].attrs.height) > Number(bars[1].attrs.height));
  check("#396 ruling 2: the unit appears NOWHERE in the figure - not " +
    "per label, not at the axis edge, nowhere. The status line is the " +
    "one place it is stated, and this fixture's own unit really is a " +
    "string that would be findable if it were painted",
    fixtureUnit === "lb" &&
    allText.every((c) => !/[a-zA-Z]/.test(c._text)) &&
    byId.get("status")._text.includes(fixtureUnit));
  check("owner ruling 2 (the 2026-08-19 late sitting): the distribution " +
    "grew a count axis - at least one whole-number tick paints in the " +
    "left gutter, and every one of them is a plain integer, never a " +
    "fraction of a person",
    axisTicks.length > 0 &&
    axisTicks.every((t) => /^\d+$/.test(t._text)));
  /*
   * FIX WAVE 2 (#378): ENOUGH_FIXTURE's own tallest band is 7 - the
   * reviewer's exact first failing shape (countAxisTicks(7) pushes a
   * tick to 8). Read back from the real rendered SVG rather than
   * recomputed, so this is proof the PAGE fixed it, not merely that the
   * pure function did: every axis tick's own y (the "+4" baseline nudge
   * subtracted back out) sits inside [top, baseline] - 20 to 260 in
   * this figure's own viewBox - and the top tick ("8") lands exactly at
   * top, never above it.
   */
  const axisTickYs = axisTicks.map((t) => Number(t.attrs.y) - 4);
  check("fix wave 2/#378: every rendered count-axis tick's own y sits " +
    "inside the plot box, read straight off the SVG this fixture's " +
    "own tallest band (7, the reviewer's exact case) actually drew",
    axisTickYs.every((y) => y >= 20 - 1e-6 && y <= 260 + 1e-6));
  check("fix wave 2/#378: the top tick (\"8\", pushed past the real " +
    "max of 7) lands exactly at the plot's own top - not above it, " +
    "which is where the review found it painting over the status line",
    axisTicks.some((t, i) => t._text === "8" &&
      Math.abs(axisTickYs[i] - 20) < 1e-6));
  check("owner ruling (the 2026-08-19 late sitting): no per-bar count " +
    "ever paints again - .chart-value is retired with the row it " +
    "belonged to, a regression guard independent of what any caption " +
    "or axis check happens to look for",
    svg.children.every((c) => c.attrs.class !== "chart-value"));

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

  /*
   * The trend's own value axis (owner ruling, the 2026-08-19 late
   * sitting: "if its reserved gutter carries no value labels today, add
   * them"). ENOUGH_FIXTURE's own domain across BOTH series (group and
   * You combined, the same `all` drawTrend() itself scales against) is
   * 174.2 to 180.8 imperial - valueAxisTicks()'s own exact answer, not
   * a re-derived string.
   */
  const trendTicks = trendSvg.children.filter((c) => c.tag === "text" &&
    c.attrs.class === "chart-label" && c.attrs["text-anchor"] === "end")
    .map((c) => c._text);
  const expectedTrendTicks = Charts.valueAxisTicks(174.2, 180.8)
    .map((t) => String(t));
  check("owner ruling (the 2026-08-19 late sitting): the trend figure's " +
    "gutter now carries value-axis labels, exactly valueAxisTicks()'s " +
    "own answer over the real domain both series share",
    JSON.stringify(trendTicks) === JSON.stringify(expectedTrendTicks));
  check("#396 ruling 2: the trend figure names no unit either - the " +
    "marker that used to sit over its own gutter is retired with the " +
    "distribution's, because the status line is the one place a unit " +
    "is written",
    trendSvg.children.filter((c) => c.tag === "text")
      .every((c) => c._text !== "lb" && c._text !== "kg"));

  /* Owner ruling 1, #243, reshaped as chips by 0.9-M2-S13 (#378): the
     group-makeup block. One chip per value, zeros included, from the
     response's own `groups` field - no chart machinery, no bars. */
  const groupsBody = byId.get("groups-body");
  const chipRows = groupsBody.children.filter((c) =>
    c.className.split(" ").includes("chip-row"));
  check("the group makeup card is shown once a drawn answer arrives",
    byId.get("groups").hidden === false);

  /*
   * 0.9-M2-S15 fix wave 1 (#383), sibling sweep: the check above is
   * true trivially too - buildDom() (unrelated to this slice) never
   * sets a default for "groups", so the stub's own node() default
   * (hidden=false) already matches what a correct draw produces here.
   * Deleting renderGroups()'s own `show(card, true)` call was proven,
   * by mutation, to leave the check above green (0 failures with the
   * call removed, restored after). Forcing it hidden first, then
   * pressing again against the same fixture, proves the call fires.
   */
  byId.get("groups").hidden = true;
  await pressShowMe(byId);
  check("0.9-M2-S15 (#383 fix wave 1, sibling sweep): renderGroups() " +
    "actively unhides the card - forced hidden first, so this fails if " +
    "show(card, true) is ever deleted",
    byId.get("groups").hidden === false);
  check("the group makeup heading names each field, from the response, " +
    "one per categorical field",
    groupsBody.children.some((c) => c.tag === "h3" && c._text === "Gender") &&
    groupsBody.children.some((c) => c.tag === "h3" && c._text === "Country"));
  check("one .chip-row per categorical field in the response",
    chipRows.length === 2);

  const genderChips = chipsOf(chipRows[0]);
  check("every gender chip carries the response's own label and exact " +
    "count verbatim, zeros and the blank cell included, in the " +
    "response's own order - one chip per value, index for index",
    genderChips.length === 4 &&
    genderChips[0].name === "Male" && genderChips[0].count === "10" &&
    genderChips[1].name === "Female" && genderChips[1].count === "8" &&
    genderChips[2].name === "Non-binary" && genderChips[2].count === "0" &&
    genderChips[3].name === "Not stated" && genderChips[3].count === "2");
  check("owner ruling 3, #378: the zero chip (and only the zero chip) " +
    "carries the dimmed class - order stays the ruled order, it is not " +
    "moved or dropped",
    !genderChips[0].zero && !genderChips[1].zero && genderChips[2].zero &&
    !genderChips[3].zero);

  /*
   * The country carry (Prime's wake, S12's review #373): the response
   * sends `label: "US"` (the code, a placeholder) for a choicesFrom
   * field, and this page is the one holding apps/web/countries.js's own
   * table - groupCellLabel() looks the real name up from `value`, never
   * trusting `label` for this field. The blank cell keeps its own real
   * label untouched, because it is not a country code to look up.
   */
  const countryChips = chipsOf(chipRows[1]);
  check("country chips render the real name looked up from the code " +
    "(value), not the code the response's own label placeholder holds - " +
    "the blank cell is untouched, and its count is verbatim too",
    countryChips.length === 3 &&
    countryChips[0].name === "United States" && countryChips[0].count === "5" &&
    countryChips[1].name === "Albania" && countryChips[1].count === "1" &&
    countryChips[2].name === "Not stated" && countryChips[2].count === "3");
}

/*
 * 0.9-M2-S15 (#383), apparatus points 4 and 5 together: the choice
 * persists across a second (and third) Show me press, and the toggle
 * hides again on a not-enough answer WITHOUT resetting what the member
 * had chosen - so a later drawn answer picks the flip back up rather
 * than defaulting back to Trend. Three presses against the same `byId`,
 * a served answer per press exactly like the "re-render with filter"
 * arm above.
 */
{
  const served = [ENOUGH_FIXTURE, ENOUGH_FIXTURE, NOT_ENOUGH_FIXTURE];
  let at = 0;
  const { byId } = await driven(() => response(200, served[at++]));

  check("first press: the shipped default is Trend selected",
    byId.get("picture-tab-trend").getAttribute("aria-selected") === "true" &&
    byId.get("picture-tab-distribution").getAttribute("aria-selected") ===
      "false");

  await byId.get("picture-tab-distribution").dispatch("click");
  check("clicking Distribution flips aria-selected on both tabs and " +
    "shows exactly one figure - Distribution in, Trend out",
    byId.get("picture-tab-trend").getAttribute("aria-selected") === "false" &&
    byId.get("picture-tab-distribution").getAttribute("aria-selected") ===
      "true" &&
    byId.get("picture-trend").hidden === true &&
    byId.get("picture-distribution").hidden === false);

  await pressShowMe(byId);
  check("second press (apparatus point 4): the Distribution choice " +
    "survives a fresh drawn answer - renderAnswer() reads the tabs' own " +
    "aria-selected rather than resetting to Trend, and the toggle is " +
    "still shown",
    byId.get("picture-tab-distribution").getAttribute("aria-selected") ===
      "true" &&
    byId.get("picture-distribution").hidden === false &&
    byId.get("picture-trend").hidden === true &&
    byId.get("picture-field").hidden === false);

  await pressShowMe(byId);
  check("third press, a not-enough answer (apparatus points 3 and 4 " +
    "together): the toggle hides again, but the Distribution choice " +
    "itself is untouched - nothing here resets aria-selected, only " +
    "visibility",
    byId.get("picture-field").hidden === true &&
    byId.get("picture-tab-distribution").getAttribute("aria-selected") ===
      "true");
}

/*
 * The new filter rows (0.9-M3-S14, #454 items 16-18): one entry per
 * categorical field in `#filter-rows`, each carrying `data-field` -
 * these three helpers read them the same disciplined way chipsOf()
 * above reads the read-only group-makeup chips, never trusting a flat
 * string this suite would have to re-split.
 */
function filterRowFor(byId, field) {
  return byId.get("filter-rows").children.find(
    (row) => row.getAttribute("data-field") === field) || null;
}

function filterChipsOf(row) {
  const chipRow = row.children.find((c) =>
    c.className.split(" ").includes("filter-chip-row"));
  if (!chipRow) return null;
  return chipRow.children.map((chip) => ({
    value: chip.getAttribute("data-value"),
    label: chip.textContent,
    pressed: chip.getAttribute("aria-pressed") === "true",
    disabled: chip.disabled === true,
  }));
}

function filterSelectOf(row) {
  return row.children.find((c) => c.tag === "select") || null;
}

function filterNoticeOf(row) {
  return row.children.find((c) =>
    c.className.split(" ").includes("filter-notice")) || null;
}

/* The LIVE button node for one field's own chip - re-fetch `row` fresh
   (filterRowFor()) after any click that changes state, since
   renderFilterRows() rebuilds the whole #filter-rows subtree; a cached
   row from before such a click points at a detached tree. */
function chipButtonFor(row, value) {
  const chipRow = row.children.find((c) =>
    c.className.split(" ").includes("filter-chip-row"));
  if (!chipRow) return null;
  return chipRow.children.find((b) => b.getAttribute("data-value") === value)
    || null;
}

/* The most recent GET /charts-data call in `calls` - setUp()'s own
   baseline read and every Show-me press are both this pathname, so
   "the request the last press made" is the last match, never calls[0]
   (GET /spec) or a fixed index. */
function lastChartsDataCall(calls) {
  const matches = calls.filter((u) => new URL(u).pathname === "/charts-data");
  return matches.length ? new URL(matches[matches.length - 1]) : null;
}

/*
 * Pinned countries, driven end to end (owner ruling, 0.9-M2-S14, #380
 * ruling 4, carried into the chip row by #454 item 18: "pinned US/GB/CA
 * order kept") - WITHOUT duplication (pinFirst()'s own header; the
 * superseded build's own review, #434 comment 5378073973, finding F5,
 * is the reason it must not duplicate: two lit chips for one selection).
 * The baseline's own country cells arrive in the RESPONSE's count-desc
 * order (AL, GB, US - server/charts-agg.js's cellsOf(), never
 * alphabetical) precisely so this proves a real reorder happened rather
 * than the fixture already being pin-first by luck.
 */
{
  const pinnedBaseline = {
    ok: true, enough: true, filters: [],
    groups: [
      { field: "gender", label: "Gender", term: "gender", multiple: false,
        values: [
          { value: "male", label: "Male", count: 10, bucket: null },
          { value: "female", label: "Female", count: 8, bucket: null },
        ] },
      { field: "country", label: "Country", term: "country", multiple: false,
        values: [
          { value: "AL", label: "AL", count: 9, bucket: null },
          { value: "GB", label: "GB", count: 6, bucket: null },
          { value: "US", label: "US", count: 5, bucket: null },
        ] },
    ],
  };
  const { byId } = await driven(() => response(200, ENOUGH_FIXTURE),
    { baseline: pinnedBaseline });

  const countryChips = filterChipsOf(filterRowFor(byId, "country"));
  check("the country filter chips lead with US then GB, pinned - not " +
    "the response's own AL/GB/US count-desc order",
    countryChips[0].value === "US" && countryChips[1].value === "GB");
  check("AL (not pinned) follows, exactly once - no chip appears twice " +
    "for one value (pinFirst() does not duplicate, unlike the pattern " +
    "that lit two chips for one selection in the superseded build)",
    countryChips.length === 3 && countryChips[2].value === "AL" &&
    countryChips.filter((c) => c.value === "US").length === 1);
  check("the chip labels resolve through the countries table, not the " +
    "response's own code placeholder",
    countryChips[0].label === "United States" &&
    countryChips[1].label === "United Kingdom" &&
    countryChips[2].label === "Albania");

  const genderChips = filterChipsOf(filterRowFor(byId, "gender"));
  check("a non-country categorical field is never reordered - the " +
    "pinning is positional (measure.choicesFrom === \"countries\"), " +
    "never applied to every filter value list",
    genderChips.map((c) => c.value).join(",") === "male,female");
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
  const { byId, doc, created, revoked, blobs, createdAnchors } =
    await driven(() => response(200, ENOUGH_FIXTURE));

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

  // 0.9-M2-S14, #380 ruling 3: the format itself, driven end to end -
  // filename, MIME type, and the actual bytes read back through the
  // same reader section 2b proves the writer's own inertness with.
  check("the throwaway anchor's filename is charts.xlsx, not the " +
    "retired charts.json",
    createdAnchors.length === 1 &&
    createdAnchors[0].download === "charts.xlsx");
  check("the Blob carries the xlsx MIME type",
    blobs.length === 1 && blobs[0].type ===
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const clickedBytes = new Uint8Array(await blobs[0].arrayBuffer());
  const clickedNames = unzip(clickedBytes).map((e) => e.name).sort();
  check("the downloaded bytes are themselves a real, complete workbook " +
    "- not an empty or truncated one",
    clickedNames.join(",") === ["[Content_Types].xml", "_rels/.rels",
      "xl/_rels/workbook.xml.rels", "xl/workbook.xml",
      "xl/worksheets/sheet1.xml"].join(","));
  const clickedSheet = new TextDecoder().decode(
    unzip(clickedBytes).find((e) => e.name === "xl/worksheets/sheet1.xml")
      .data);
  check("the clicked workbook's sheet carries the fixture's own " +
    "distribution band, in the CURRENT unit system - the same figures "
    + "on screen, nothing refetched",
    clickedSheet.includes("150 lb") && clickedSheet.includes("175 lb"));
}

/* ------------------------------------------------------------------ */
/* 3b. The filter chips, driven end to end (0.9-M3-S14, #384; #454      */
/* items 16-18; the gate, Prime's ruling on #455, comment 5378956164).  */

/*
 * Chips come from the EFFECTIVE spec (GET /spec, 0.9-M3-S11, #419) -
 * never root.BINDER_SITE and never a hard-coded field list (this
 * file's header). `specMarker` is a distinct OBJECT (not merely equal
 * JSON), which is what proves the SAME thing GET /spec answered
 * reaches BinderFields, not a coincidence of two objects that happen
 * to look alike. The admin-added "mood" field - present only in this
 * test's own fixture, named nowhere in apps/web/charts.js's source -
 * renders its own row with zero code changes (#384 ruling 3).
 */
{
  const specMarker = { marker: "0.9-M3-S14-admin-added-field-fixture" };
  const measuresWithMood = measureFixture().concat([
    { name: "mood", label: "Mood", term: "mood", kind: "categorical",
      choices: [{ value: "great", label: "Great" },
                { value: "flat", label: "Flat" }] },
  ]);
  const moodBaseline = {
    ok: true, enough: true, filters: [],
    groups: [
      { field: "gender", label: "Gender", term: "gender", multiple: false,
        values: [{ value: "male", label: "Male", count: 10, bucket: null }] },
      { field: "country", label: "Country", term: "country", multiple: false,
        values: [{ value: "US", label: "US", count: 5, bucket: null }] },
      { field: "mood", label: "Mood", term: "mood", multiple: false,
        values: [
          { value: "great", label: "Great", count: 6, bucket: null },
          { value: "flat", label: "Flat", count: 4, bucket: null },
        ] },
    ],
  };
  const { byId, fieldsCalls } = await driven(
    () => response(200, ENOUGH_FIXTURE),
    { spec: specMarker, measures: measuresWithMood, baseline: moodBaseline,
      captureFieldsArgs: true });

  // A real fetch round-trips through JSON, so `given` can never be the
  // SAME object `specMarker` is - a plain HTTP response has no way to
  // preserve identity. The deep-equal fixture value is the whole of
  // what a wire response could ever carry, so that is the proof this
  // page reads the fetched effective spec rather than a fixed global.
  const specJson = JSON.stringify(specMarker);
  check("0.9-M3-S14: every BinderFields.measures()/measure() call this " +
    "session made was handed the SAME body GET /spec answered with - " +
    "proof this page reads the fetched effective spec, not a fixed " +
    "global (DESIGN.md, \"Where configuration lives\": \"Charts... do " +
    "not yet\" - this slice closes that)",
    fieldsCalls.length > 0 &&
    fieldsCalls.every((c) => JSON.stringify(c.given) === specJson));
  check("apps/web/charts.js's own source names the admin-added field " +
    "nowhere - the row below is derived, not hard-coded",
    !src.includes("mood"));

  const moodRow = filterRowFor(byId, "mood");
  check("0.9-M3-S14: an admin-added categorical field renders its own " +
    "filter row with zero code changes",
    moodRow !== null);
  check("its chips come from the baseline answer's own present values",
    filterChipsOf(moodRow).map((c) => c.value).sort().join(",") ===
    "flat,great");
}

/*
 * Resting state (0.9-M3-S14; #454 item 16): driven()'s own default
 * press, nothing tapped - every candidate lit in every field.
 */
{
  const { byId, calls } = await driven(() => response(200, ENOUGH_FIXTURE));
  const genderChips = filterChipsOf(filterRowFor(byId, "gender"));
  check("0.9-M3-S14: at rest, every chip in every field is lit " +
    "(aria-pressed=true) - Everyone, with no \"All\" chip anywhere",
    genderChips.every((c) => c.pressed === true));
  const call = lastChartsDataCall(calls);
  check("0.9-M3-S14: all-lit sends NO filter/value pair at all - the " +
    "identity 0.9-M3-S31 built the Worker side to hold (#455)",
    call.searchParams.getAll("filter").length === 0 &&
    call.searchParams.getAll("value").length === 0);
}

/* One chip lit sends one pair. */
{
  const { byId, calls } = await driven(() => response(200, ENOUGH_FIXTURE),
    { skipPress: true });
  await chipButtonFor(filterRowFor(byId, "gender"), "male")
    .dispatch("click");
  await pressShowMe(byId);
  const call = lastChartsDataCall(calls);
  check("0.9-M3-S14: tapping one chip from Everyone sends exactly one " +
    "filter/value pair for that field",
    call.searchParams.getAll("filter").join(",") === "gender" &&
    call.searchParams.getAll("value").join(",") === "male");
  const genderChips = filterChipsOf(filterRowFor(byId, "gender"));
  check("and only that one chip reads pressed - the rest went dark, not " +
    "merely disabled",
    genderChips.filter((c) => c.pressed).map((c) => c.value).join(",") ===
    "male");
}

/*
 * Under the gate, a SECOND chip in the SAME already-restricted field is
 * refused in place - the shipped COMBINED_FILTERS_ENABLED === false
 * path (Prime's ruling on #455, comment 5378956164).
 */
{
  const { byId, calls } = await driven(() => response(200, ENOUGH_FIXTURE),
    { skipPress: true });
  await chipButtonFor(filterRowFor(byId, "gender"), "male")
    .dispatch("click");
  const before = calls.length;
  await chipButtonFor(filterRowFor(byId, "gender"), "female")
    .dispatch("click");
  check("0.9-M3-S14: a second chip in the same restricted field sends " +
    "nothing new - no fetch fired for the refused tap",
    calls.length === before);
  const genderChips = filterChipsOf(filterRowFor(byId, "gender"));
  check("the selection is unchanged - male stays the only lit chip",
    genderChips.filter((c) => c.pressed).map((c) => c.value).join(",") ===
    "male");
  const notice = filterNoticeOf(filterRowFor(byId, "gender"));
  check("0.9-M3-S14: the refusal reason renders in plain words, in " +
    "place, in the field's own row",
    notice !== null && notice.hidden === false &&
    notice.textContent === Charts.WITHIN_FIELD_GATE_NOTICE);
}

/*
 * Under the gate, a selection in a SECOND field while another already
 * holds one value is refused the same way, and disables the other
 * field's whole row.
 */
{
  const { byId, calls } = await driven(() => response(200, ENOUGH_FIXTURE),
    { skipPress: true });
  await chipButtonFor(filterRowFor(byId, "gender"), "male")
    .dispatch("click");
  const before = calls.length;
  await chipButtonFor(filterRowFor(byId, "country"), "US")
    .dispatch("click");
  check("0.9-M3-S14: a tap in a second field while another is already " +
    "restricted sends nothing new either",
    calls.length === before);
  const countryChips = filterChipsOf(filterRowFor(byId, "country"));
  check("every chip in the OTHER field disables while a field elsewhere " +
    "is restricted",
    countryChips.every((c) => c.disabled === true) &&
    countryChips.every((c) => c.pressed === true));
  const countryNotice = filterNoticeOf(filterRowFor(byId, "country"));
  check("0.9-M3-S14: the cross-field refusal carries its OWN distinct " +
    "sentence, in the other field's own row",
    countryNotice !== null && countryNotice.hidden === false &&
    countryNotice.textContent === Charts.CROSS_FIELD_GATE_NOTICE &&
    Charts.CROSS_FIELD_GATE_NOTICE !== Charts.WITHIN_FIELD_GATE_NOTICE);
}

/* The last lit chip cannot be unlit (#454 item 16) - tapping the field's
   own already-active chip clears it back to Everyone instead, which is
   what re-enables every other field's row. */
{
  const { byId, calls } = await driven(() => response(200, ENOUGH_FIXTURE),
    { skipPress: true });
  await chipButtonFor(filterRowFor(byId, "gender"), "male")
    .dispatch("click");
  await chipButtonFor(filterRowFor(byId, "gender"), "male")
    .dispatch("click");
  const genderChips = filterChipsOf(filterRowFor(byId, "gender"));
  check("0.9-M3-S14: tapping the field's own sole active chip clears it " +
    "back to Everyone - every chip in the row relights",
    genderChips.every((c) => c.pressed === true));
  const countryChips = filterChipsOf(filterRowFor(byId, "country"));
  check("clearing the active field's own restriction re-enables every " +
    "other field's row",
    countryChips.every((c) => c.disabled === false));
  await pressShowMe(byId);
  const call = lastChartsDataCall(calls);
  check("and the next Show-me press sends no pair at all again",
    call.searchParams.getAll("filter").length === 0);
}

/* A retired value never renders - this page reads candidates from the
   baseline's own present-value list and nothing else, so a value the
   Worker never lists (server/worker.js's offeredValues(), #385 rule 7)
   simply is not there for this page to re-add. */
{
  const retiredBaseline = {
    ok: true, enough: true, filters: [],
    groups: [
      { field: "gender", label: "Gender", term: "gender", multiple: false,
        values: [
          { value: "male", label: "Male", count: 10, bucket: null },
          { value: "female", label: "Female", count: 8, bucket: null },
          { value: null, label: "Not stated", count: 2, bucket: "blank" },
        ] },
    ],
  };
  const { byId } = await driven(() => response(200, ENOUGH_FIXTURE),
    { baseline: retiredBaseline, measures: [measureFixture()[0],
      measureFixture()[1]] });
  const genderChips = filterChipsOf(filterRowFor(byId, "gender"));
  check("0.9-M3-S14: a retired value (\"nonbinary\", named in the " +
    "measure fixture's own choices but absent from this baseline's own " +
    "makeup block) never renders as a filter chip",
    genderChips.map((c) => c.value).sort().join(",") === "female,male" &&
    !genderChips.some((c) => c.value === "nonbinary"));
}

/*
 * The two-row measurement falling to a native drop list, driven -
 * `simulateChipWrap` (buildDom()'s own comment, above) gives every
 * dynamically created chip <button> a real getBoundingClientRect() this
 * suite's DOM stub could not otherwise produce, proving the actual
 * SWITCH (decideMode() -> buildFilterSelect()), not only the pure
 * decision in isolation. Twelve country candidates at four simulated
 * per row is three rows - past the two-row budget - while gender's two
 * candidates stay one row.
 */
const manyCountryBaseline = {
  ok: true, enough: true, filters: [],
  groups: [
    { field: "gender", label: "Gender", term: "gender", multiple: false,
      values: [
        { value: "male", label: "Male", count: 10, bucket: null },
        { value: "female", label: "Female", count: 8, bucket: null },
      ] },
    { field: "country", label: "Country", term: "country", multiple: false,
      values: [
        { value: "DE", label: "DE", count: 9, bucket: null },
        { value: "AL", label: "AL", count: 8, bucket: null },
        { value: "FR", label: "FR", count: 7, bucket: null },
        { value: "US", label: "US", count: 6, bucket: null },
        { value: "IT", label: "IT", count: 5, bucket: null },
        { value: "ES", label: "ES", count: 4, bucket: null },
        { value: "GB", label: "GB", count: 3, bucket: null },
        { value: "JP", label: "JP", count: 2, bucket: null },
        { value: "MX", label: "MX", count: 2, bucket: null },
        { value: "BR", label: "BR", count: 1, bucket: null },
        { value: "IN", label: "IN", count: 1, bucket: null },
        { value: "CA", label: "CA", count: 1, bucket: null },
      ] },
  ],
};

{
  const { byId, calls } = await driven(() => response(200, ENOUGH_FIXTURE),
    { skipPress: true, baseline: manyCountryBaseline, simulateChipWrap: 4 });

  const genderRow = filterRowFor(byId, "gender");
  check("0.9-M3-S14: a field with few candidates (gender, two) still " +
    "renders chips under this simulated geometry - not every field " +
    "falls to a list just because ONE did",
    filterChipsOf(genderRow) !== null && filterSelectOf(genderRow) === null);

  const countryRow = filterRowFor(byId, "country");
  const countrySelect = filterSelectOf(countryRow);
  check("0.9-M3-S14: a field with many candidates (country, twelve) " +
    "measures past two simulated rows and falls to a native drop list",
    countrySelect !== null && filterChipsOf(countryRow) === null);

  const optionValues = countrySelect.children.filter((o) => o.value !== "")
    .map((o) => o.value);
  check("the drop list holds every present value, none invented and " +
    "none missing",
    optionValues.length === 12);
  check("0.9-M3-S14: the drop list's own pinned block is US, GB, CA, in " +
    "that order, at the front - not the response's own count-desc order " +
    "(DE, AL, FR, US, ...)",
    optionValues[0] === "US" && optionValues[1] === "GB" &&
    optionValues[2] === "CA");
  check("0.9-M3-S14: under the gate, the drop list's own first option " +
    "is Everyone, the resting state",
    countrySelect.children[0].value === "" &&
    countrySelect.children[0].textContent === "Everyone" &&
    countrySelect.value === "");

  countrySelect.value = "US";
  await countrySelect.dispatch("change");
  await pressShowMe(byId);
  const call = lastChartsDataCall(calls);
  check("0.9-M3-S14: picking one value in the drop list sends exactly " +
    "one pair - the drop-list form allows one value under the gate",
    call.searchParams.getAll("filter").join(",") === "country" &&
    call.searchParams.getAll("value").join(",") === "US");
}

{
  const { byId } = await driven(() => response(200, ENOUGH_FIXTURE),
    { skipPress: true, baseline: manyCountryBaseline, simulateChipWrap: 4 });
  await chipButtonFor(filterRowFor(byId, "gender"), "male")
    .dispatch("click");
  const countrySelect = filterSelectOf(filterRowFor(byId, "country"));
  check("0.9-M3-S14: the drop-list control disables too, while another " +
    "field is restricted - the cross-field gate applies to both control " +
    "shapes alike",
    countrySelect.disabled === true);
  const notice = filterNoticeOf(filterRowFor(byId, "country"));
  check("and carries the same cross-field notice the chip form does",
    notice !== null && notice.hidden === false &&
    notice.textContent === Charts.CROSS_FIELD_GATE_NOTICE);
}

/* The status line and the makeup block both follow the active filter -
   one tap, one press, one served answer whose own echo names it. */
{
  const servedAnswer = Object.assign({}, ENOUGH_FIXTURE, {
    filters: [{ field: "gender", value: "male" }],
    groups: [
      { field: "gender", label: "Gender", term: "gender", multiple: false,
        values: [{ value: "male", label: "Male", count: 10, bucket: null }] },
    ],
  });
  const { byId } = await driven(() => response(200, servedAnswer),
    { skipPress: true });
  await chipButtonFor(filterRowFor(byId, "gender"), "male")
    .dispatch("click");
  await pressShowMe(byId);
  check("0.9-M3-S14: the status line names the filter in words, ahead " +
    "of the measure sentence",
    byId.get("status")._text === "Showing male - Weight (lb).");
  const groupsChips = chipsOf(byId.get("groups-body").children
    .find((c) => c.tag === "div"));
  check("0.9-M3-S14: the group-makeup block follows the SAME filtered " +
    "answer - one chip, Male's own count, not the whole group's",
    groupsChips.length === 1 && groupsChips[0].name === "Male" &&
    groupsChips[0].count === "10");
}

/* The xlsx download carries the same filter label as the status line. */
{
  const servedAnswer = Object.assign({}, ENOUGH_FIXTURE, {
    filters: [{ field: "gender", value: "male" }],
  });
  const { byId, blobs } = await driven(() => response(200, servedAnswer),
    { skipPress: true });
  await chipButtonFor(filterRowFor(byId, "gender"), "male")
    .dispatch("click");
  await pressShowMe(byId);
  await byId.get("download").dispatch("click");
  const bytes = new Uint8Array(await blobs[blobs.length - 1].arrayBuffer());
  const xml = new TextDecoder().decode(
    unzip(bytes).find((e) => e.name === "xl/worksheets/sheet1.xml").data);
  check("0.9-M3-S14: the downloaded workbook's own Filters row carries " +
    "the same word the status line printed - \"male\", inline text",
    xml.includes(">male<"));
}

/*
 * NOTHING IS PRESS-TIME EITHER (design mandate 2): every fetch above is
 * traced to a click (a chip's own click event or Show-me's), never a
 * change this suite made by writing state onto the field objects
 * directly.
 */

/*
 * ARMED BOTH STATES (this file's header; "a test arms both states by
 * calling the pure function twice, never by mutating a frozen module
 * constant" - the DOM WIRING itself gets the same proof here, on a
 * SEPARATE loaded copy of the real source with the one line flipped,
 * exactly the technique the superseded build's own review used
 * ("flipping that one line to true in my checkout, nothing committed") -
 * apps/web/charts.js on disk is untouched; only this in-memory string
 * differs.
 */
const combinedSrc = src.replace(
  "const COMBINED_FILTERS_ENABLED = false;",
  "const COMBINED_FILTERS_ENABLED = true;");
check("0.9-M3-S14 test-apparatus check: the flip target string is " +
  "present exactly once in the real file, so this suite's own combined-" +
  "mode arms below are really testing the shipped gate, not a typo that " +
  "silently no-opped",
  src.split("const COMBINED_FILTERS_ENABLED = false;").length === 2 &&
  combinedSrc !== src);

async function drivenCombined(fetchImpl, opts) {
  return driven(fetchImpl, Object.assign({}, opts, { source: combinedSrc }));
}

/*
 * REST IS EVERY CANDIDATE LIT (#454 item 16), so combined mode's own
 * tap TURNS A LIT CHIP OFF - it narrows AWAY from the tapped value,
 * never toward it. Building a real "two of three selected" state by
 * TAPS therefore means turning the ONE UNWANTED candidate off, not
 * tapping the two that are wanted (which start lit already) - the
 * three-candidate country fixture below is what makes that a genuine
 * subset rather than degenerating back to Everyone on a two-candidate
 * field.
 */
const threeCountryBaseline = {
  ok: true, enough: true, filters: [],
  groups: [
    { field: "gender", label: "Gender", term: "gender", multiple: false,
      values: [
        { value: "male", label: "Male", count: 10, bucket: null },
        { value: "female", label: "Female", count: 8, bucket: null },
      ] },
    { field: "country", label: "Country", term: "country", multiple: false,
      values: [
        { value: "US", label: "US", count: 5, bucket: null },
        { value: "AL", label: "AL", count: 1, bucket: null },
        { value: "GB", label: "GB", count: 2, bucket: null },
      ] },
  ],
};

{
  const { byId, calls } = await drivenCombined(
    () => response(200, ENOUGH_FIXTURE),
    { skipPress: true, baseline: threeCountryBaseline });
  // Turn GB off, leaving US and AL both still lit - a real two-of-three
  // set, not Everyone in disguise.
  await chipButtonFor(filterRowFor(byId, "country"), "GB")
    .dispatch("click");
  await pressShowMe(byId);
  const call = lastChartsDataCall(calls);
  check("0.9-M3-S14: with the constant true, two chips left lit in ONE " +
    "field send TWO pairs for that field",
    call.searchParams.getAll("filter").join(",") === "country,country" &&
    call.searchParams.getAll("value").sort().join(",") === "AL,US");
}

{
  const { byId, calls } = await drivenCombined(
    () => response(200, ENOUGH_FIXTURE), { skipPress: true });
  // Turn the UNwanted candidate off in each field, leaving exactly one
  // lit in each - "male" and "US" respectively.
  await chipButtonFor(filterRowFor(byId, "gender"), "female")
    .dispatch("click");
  await chipButtonFor(filterRowFor(byId, "country"), "AL")
    .dispatch("click");
  await pressShowMe(byId);
  const call = lastChartsDataCall(calls);
  check("0.9-M3-S14: with the constant true, TWO FIELDS each narrowed " +
    "send pairs for BOTH - real combining, never the gate's refusal",
    call.searchParams.getAll("filter").sort().join(",") ===
    "country,gender" &&
    call.searchParams.getAll("value").sort().join(",") === "US,male");
  const genderChips = filterChipsOf(filterRowFor(byId, "gender"));
  check("neither field disabled the other - the cross-field gate does " +
    "not apply when the constant is true",
    genderChips.every((c) => c.disabled === false));
}

{
  // The last-chip invariant holds in combined mode too, by a different
  // mechanism than the gate's clear-to-Everyone (a real toggle-off
  // refusal): narrow gender to "male" alone, then try to turn that
  // last lit chip off too.
  const { byId } = await drivenCombined(
    () => response(200, ENOUGH_FIXTURE), { skipPress: true });
  await chipButtonFor(filterRowFor(byId, "gender"), "female")
    .dispatch("click");
  await chipButtonFor(filterRowFor(byId, "gender"), "male")
    .dispatch("click");
  const genderChips = filterChipsOf(filterRowFor(byId, "gender"));
  check("0.9-M3-S14: combined mode's own last-chip invariant - with " +
    "\"male\" the sole remaining lit chip, tapping it again is a no-op, " +
    "not a jump back to Everyone",
    genderChips.filter((c) => c.pressed).map((c) => c.value).join(",") ===
    "male");
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
 *
 * THIS IS ALSO #390 RULING 3'S OWN ARM (the 2026-08-20 sitting): a zero
 * grid has no nonzero band to anchor a top trim on, so
 * trimTrailingEmptyBins() returns it unchanged and both bands below
 * still draw - `bars.length === 2` is the same assertion either ruling
 * would make, which is exactly why one fixture proves both.
 */
{
  const allZero = Object.assign({}, ENOUGH_FIXTURE, {
    distribution: {
      kind: "bins",
      partition: { system: "imperial", unit: "lb", band: "25 lb bands" },
      bins: [
        { count: 0, from: 25, to: 50 },
        { count: 0, from: 50, to: 75 },
      ],
    },
  });
  const { byId } = await driven(() => response(200, allZero));
  check("an all-zero grid still draws - the figures are shown, never " +
    "the not-enough sentence",
    byId.get("status")._text.includes("Weight") &&
    !byId.get("status")._text.includes("Not enough"));
  const svg = byId.get("figure-distribution").querySelector("svg");
  const bars = svg.children.filter((c) => c.tag === "rect" &&
    c.attrs.class === "chart-bar");
  check("both zero bands drew their own zero-height slot, index for " +
    "index - the same every-band-draws property, not a suppressed or " +
    "collapsed grid",
    bars.length === 2 && Number(bars[0].attrs.height) === 0 &&
    Number(bars[1].attrs.height) === 0);
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
    filters: [{ field: "gender", value: "male" }],
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

  function firstRowChips(byIdMap) {
    const row = byIdMap.get("groups-body").children.find((c) =>
      c.className.split(" ").includes("chip-row"));
    return row ? chipsOf(row) : [];
  }

  const firstChips = firstRowChips(byId);
  check("re-render with filter, part 1: a filtered answer's own " +
    "(smaller) group makeup renders",
    firstChips.length === 1 && firstChips[0].name === "Male" &&
    firstChips[0].count === "10");

  await pressShowMe(byId);
  const secondChips = firstRowChips(byId);
  check("re-render with filter, part 2: pressing Show me again with a " +
    "broader answer REPLACES the group makeup with its own counts, " +
    "not appended beside the filtered view's",
    secondChips.length === 2 &&
    secondChips[0].name === "Male" && secondChips[0].count === "10" &&
    secondChips[1].name === "Female" && secondChips[1].count === "8");
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
  const chipRows = body.children.filter((c) =>
    c.className.split(" ").includes("chip-row"));
  const hints = body.children.filter((c) => c.tag === "p");
  const hintText = "Members can choose more than one here, so these " +
    "numbers can add up to more than the group.";
  check("F5: a multiple:true category's own chips render verbatim",
    chipsOf(chipRows[0]).length === 2 &&
    chipsOf(chipRows[0])[0].name === "Feeder" &&
    chipsOf(chipRows[0])[0].count === "6" &&
    chipsOf(chipRows[0])[1].name === "Feedee" &&
    chipsOf(chipRows[0])[1].count === "4");
  check("F5: ...followed by the honest-reading hint, exactly one line, " +
    "render-only prose distinct in tone from an ordinary chip",
    hints.length === 1 && hints[0]._text === hintText &&
    hints[0].attrs.class === "muted small");
  check("F5: a multiple:false category shows no such hint - its own " +
    "chip row is the last thing this answer renders, nothing appended " +
    "after it, even though the earlier multiple:true category's own " +
    "hint IS on the page (proving the flag decides per category, not " +
    "once for the whole answer)",
    chipsOf(chipRows[1]).length === 1 &&
    chipsOf(chipRows[1])[0].name === "Male" &&
    chipsOf(chipRows[1])[0].count === "10" &&
    body.children[body.children.length - 1] === chipRows[1]);
}

/*
 * BANDS_FIXTURE: forty bands, one of them empty. Owner ruling 5, #243:
 * "an empty band is an empty slot" - every one of the forty draws, the
 * empty one at zero height. The number row is thinned by GEOMETRY
 * (owner's F1/F2 ruling, #372's review, carried onto the tick row by
 * #396), not by a fixed stride, so this arm computes the expected row
 * by calling the same labelRowPlan() the page itself calls - proving
 * the DOM matches the pure function exactly, index for index, rather
 * than hardcoding an index list that would silently stop meaning
 * anything the moment the algorithm changed.
 *
 * FORTY BANDS IS FORTY-ONE TICKS at a 14.75-unit slot, and three- and
 * four-digit edge numbers (24 to 32 user units wide) do not fit beside
 * each other there - so the plan really does drop some. That is this
 * arm own job: the pure-function arms above already prove thinning on
 * the real BMI and weight grids; what needs a dense fixture here is
 * proof that the RENDERED row tracks the plan.
 */
function makeBands(zeroIndex, count) {
  const bins = [];
  for (let i = 0; i < count; i += 1) {
    const from = 25 + i * 25;
    bins.push({
      count: i === zeroIndex ? 0 : i + 1,
      from: from,
      to: from + 25,
    });
  }
  return bins;
}

const BAND_COUNT = 40;

const BANDS_FIXTURE = Object.assign({}, ENOUGH_FIXTURE, {
  distribution: {
    kind: "bins",
    partition: { system: "imperial", unit: "lb", band: "25 lb bands" },
    bins: makeBands(5, BAND_COUNT),
  },
});

{
  const { byId } = await driven(() => response(200, BANDS_FIXTURE));
  const svg = byId.get("figure-distribution").querySelector("svg");
  const bars = svg.children.filter((c) => c.tag === "rect" &&
    c.attrs.class === "chart-bar");
  // Only the x-axis numbers are anchored "middle" in this figure - the
  // count-axis ticks are anchored "end" in the left gutter - so the
  // anchor alone separates the two rows, with no x-position split to
  // get wrong (#396 left no third text row in the figure).
  const tickEls = svg.children.filter((c) => c.tag === "text" &&
    c.attrs.class === "chart-label" && c.attrs["text-anchor"] === "middle");
  const tickTexts = tickEls.map((c) => c._text);
  const bins = BANDS_FIXTURE.distribution.bins;

  check("every one of the " + BAND_COUNT + " bands draws a bar - the " +
    "empty one is not skipped",
    bars.length === BAND_COUNT);
  check("the empty band's bar is a zero-height slot, present on the " +
    "axis rather than omitted",
    Number(bars[5].attrs.height) === 0);

  // The SAME boxOf drawBins() itself builds - left-offset, contained -
  // fed into labelRowPlan()'s own 3-argument mode (fix wave 1, F1,
  // #378), so this expectation is computed the identical way the page
  // computes its own, not the retired 2-argument (unclamped) shape.
  const slot40 = slotFor(bins.length);
  const bandEdges = [bins[0].from].concat(bins.map((b) => b.to));
  const edgeTexts = bandEdges.map(Charts.tickLabel);
  const bandsBoxOf = finalBoxOf(edgeTexts, slot40);
  const expectedTickIndexes =
    Charts.labelRowPlan(edgeTexts, slot40, bandsBoxOf);

  check("#396: the rendered number row is exactly the positions " +
    "labelRowPlan() says should carry one, each an EDGE of the " +
    "response own grid, in order - the page own boxOf (offset + " +
    "contained) is what both this arm and drawBins() itself plan against",
    tickTexts.length === expectedTickIndexes.length &&
    expectedTickIndexes.every((idx, j) => tickTexts[j] === edgeTexts[idx]));
  check("#396: on this fixture own geometry the number row is thinner " +
    "than the full " + (BAND_COUNT + 1) + " ticks - the thinning drops " +
    "overlapping labels, not every label",
    expectedTickIndexes.length < BAND_COUNT + 1 &&
    expectedTickIndexes.length > 0);
  check("#396: the first and last ticks are the ones this fixture own " +
    "plan keeps, never dropped as interior collisions are - the axis " +
    "two ends are always readable",
    expectedTickIndexes[0] === 0 &&
    expectedTickIndexes[expectedTickIndexes.length - 1] === BAND_COUNT);
  check("#396 ruling 2: no unit paints on this dense a row either - " +
    "every number under the axis is digits alone",
    tickTexts.length > 0 && tickTexts.every((t) => !/[a-zA-Z]/.test(t)));

  /*
   * CONTAINMENT AND NO-OVERLAP TOGETHER (0.9-M2-S13 fix wave 1, F1,
   * #378, carried to the tick row by #396): on a tick row an end label
   * is centered on the axis own end and overhangs it, so the pair of
   * facts to hold at once is that nothing leaves the viewBox and
   * nothing overlaps. Checked directly off the actual rendered
   * x-positions rather than trusting the pure-function arms alone.
   */
  check("no painted number x-position, read back from the SVG, leaves " +
    "the viewBox - an end label overhangs its own end of the PLOT into " +
    "the margin beside it, which is what keeps it on its tick, but the " +
    "ink never leaves the picture",
    tickEls.every((el) => {
      const x = Number(el.attrs.x);
      const half = Charts.captionWidth(el._text) / 2;
      return x - half >= -1e-6 && x + half <= VIEW_WIDTH + 1e-6;
    }));
  check("F1/#378: no two adjacent painted numbers own rendered " +
    "positions overlap - the final-position property, read back from " +
    "the SVG rather than recomputed",
    tickEls.every((el, j) => {
      if (j === 0) return true;
      const prev = tickEls[j - 1];
      const half = Charts.captionWidth(el._text) / 2;
      const prevHalf = Charts.captionWidth(prev._text) / 2;
      const box = { left: Number(el.attrs.x) - half, right: Number(el.attrs.x) + half };
      const prevBox = { left: Number(prev.attrs.x) - prevHalf,
        right: Number(prev.attrs.x) + prevHalf };
      return !localBoxesOverlap(prevBox, box);
    }));
}

/*
 * #390 ruling 2, TOP ONLY, DRIVEN THROUGH A REAL RENDER: a leading empty
 * stretch below the lightest member still draws in full - the chart
 * still starts at the spec minimum - while a TRAILING empty stretch past
 * the heaviest member is dropped. Both directions in one fixture, so a
 * trim that (wrongly) also ate the front is caught by the same arm that
 * proves the back trims.
 */
{
  const topOnlyBins = [0, 0, 2, 0, 5, 0, 0].map(function (count, i) {
    return { count: count, from: i * 25 + 25, to: i * 25 + 50 };
  });
  const TOP_ONLY_ANSWER = Object.assign({}, ENOUGH_FIXTURE, {
    distribution: {
      kind: "bins",
      partition: { system: "imperial", unit: "lb", band: "25 lb bands" },
      bins: topOnlyBins,
    },
  });
  const { byId } = await driven(() => response(200, TOP_ONLY_ANSWER));
  const svg = byId.get("figure-distribution").querySelector("svg");
  const bars = svg.children.filter((c) => c.tag === "rect" &&
    c.attrs.class === "chart-bar");
  check("#390 ruling 2: the leading empty pair still draws (the chart " +
    "still starts at the spec minimum) while the trailing empty pair " +
    "is dropped - 5 bars, not 7 and not 3",
    bars.length === 5);
  check("#390 ruling 2: the leading two bars are still the ZERO-height " +
    "slots they always were - top-only never turns a leading empty " +
    "band into a bar that is simply missing",
    Number(bars[0].attrs.height) === 0 && Number(bars[1].attrs.height) === 0);
  check("#390: the LAST drawn bar is the band holding the maximum - " +
    "read by `.length - 1`, not a fixed index, so a trim that draws " +
    "the right COUNT of bars for the wrong reason still reddens this " +
    "(fix wave 1, F4: a hardcoded bars[4] passed even with the trim " +
    "disabled, since the fixture's own untrimmed index 4 is also this " +
    "band - bars[bars.length - 1] is 0-height whenever the trailing " +
    "empty tail is still attached)",
    Number(bars[bars.length - 1].attrs.height) > 0);
}

/*
 * #390 MOTIVATING SHAPE, DRIVEN FOR REAL: the 44-band imperial-weight
 * grid (weightGrid, above - the shipped spec as #396 and its fix wave
 * reshaped it), with a real member heaviest weight far below the axis
 * own 1125 lb ceiling - only the first 18 bands (through band 17,
 * 450-475 lb) hold anyone; bands 18 through 43 are the empty tail the
 * ruling trims. EVERYTHING drawBins() computes from `bins.length` -
 * slot width, the tick plan, the count axis, the hit rects - has to
 * re-derive from 18, never 44, with no special case: it is
 * drawDistribution() alone, upstream, that decides the count at all
 * (trimTrailingEmptyBins()).
 *
 * AND THE TRIM COMPOSES WITH THE TICK ROW (#396 apparatus): the trimmed
 * grid own last EDGE is the axis end, and an end always paints - so the
 * number a reader sees at the right of a trimmed chart is 475, the
 * upper edge of the band holding the maximum, never the spec 1100.
 */
const WEIGHT_TRIM_LAST_NONZERO = 17;
const weightTrimBins = weightGrid.map(function (b, i) {
  return { count: i <= WEIGHT_TRIM_LAST_NONZERO ? i + 1 : 0,
    from: b.from, to: b.to };
});
const WEIGHT_TRIM_ANSWER = Object.assign({}, ENOUGH_FIXTURE, {
  distribution: {
    kind: "bins",
    partition: { system: "imperial", unit: "lb", band: "25 lb bands" },
    bins: weightTrimBins,
  },
});

{
  const { byId } = await driven(() => response(200, WEIGHT_TRIM_ANSWER));
  const svg = byId.get("figure-distribution").querySelector("svg");
  const bars = svg.children.filter((c) => c.tag === "rect" &&
    c.attrs.class === "chart-bar");
  const hits = svg.children.filter((c) => c.tag === "rect" &&
    c.attrs.class === "chart-hit");
  const TRIMMED_COUNT = WEIGHT_TRIM_LAST_NONZERO + 1;

  check("#390: the real 44-band imperial-weight grid draws only " +
    "through the band holding the data maximum (18 of 44) - a " +
    "client-side trim that stops early regardless of what it calls " +
    "itself reddens here on the exact spec grid the ticket names",
    bars.length === TRIMMED_COUNT && hits.length === TRIMMED_COUNT);

  const tickEls = svg.children.filter((c) => c.tag === "text" &&
    c.attrs.class === "chart-label" && c.attrs["text-anchor"] === "middle");
  const tickTexts = tickEls.map((c) => c._text);
  const lastBand = weightTrimBins[WEIGHT_TRIM_LAST_NONZERO];
  check("#390 and #396 together: the last painted number is the trimmed " +
    "grid own last EDGE - the upper edge of the band holding the " +
    "maximum (475 lb) is the axis end, never 1100 lb, and an end always " +
    "paints so a trimmed chart can never end in an unlabeled tick",
    tickTexts[tickTexts.length - 1] === Charts.tickLabel(lastBand.to) &&
    lastBand.to === 475);

  const trimSlot = slotFor(TRIMMED_COUNT);
  const trimBins = weightTrimBins.slice(0, TRIMMED_COUNT);
  const trimTexts = [trimBins[0].from].concat(trimBins.map((b) => b.to))
    .map(Charts.tickLabel);
  const trimBoxOf = finalBoxOf(trimTexts, trimSlot);
  const expectedTrimTicks =
    Charts.labelRowPlan(trimTexts, trimSlot, trimBoxOf);
  check("#390: the tick plan re-derives at the TRIMMED slot width " +
    "(the plot's own width divided by 18, not 44) - the rendered " +
    "number row matches " +
    "labelRowPlan() computed on the trimmed count exactly",
    tickTexts.length === expectedTrimTicks.length &&
    expectedTrimTicks.every((idx, j) => tickTexts[j] === trimTexts[idx]));
  check("#390: no painted number on the trimmed grid leaves the viewBox, " +
    "and no two adjacent ones overlap - the same containment/no-overlap " +
    "property the untrimmed grids already hold, now proven at the " +
    "trimmed count",
    tickEls.every((el) => {
      const x = Number(el.attrs.x);
      const half = Charts.captionWidth(el._text) / 2;
      return x - half >= -1e-6 && x + half <= VIEW_WIDTH + 1e-6;
    }) &&
    tickEls.every((el, j) => {
      if (j === 0) return true;
      const prev = tickEls[j - 1];
      const half = Charts.captionWidth(el._text) / 2;
      const prevHalf = Charts.captionWidth(prev._text) / 2;
      const box = { left: Number(el.attrs.x) - half,
        right: Number(el.attrs.x) + half };
      const prevBox = { left: Number(prev.attrs.x) - prevHalf,
        right: Number(prev.attrs.x) + prevHalf };
      return !localBoxesOverlap(prevBox, box);
    }));

  /*
   * NO COUNT-AXIS ARM HERE (fix wave 1, F4, #390 review): drawBins()
   * computes the count axis from `bins.reduce(max, ...)` over WHATEVER
   * bins it is handed, and trimTrailingEmptyBins() only ever removes
   * TRAILING ZERO-COUNT bins - by construction, that can never change
   * the maximum count, so the trimmed and untrimmed axis are provably
   * the identical ticks on this fixture (and on every fixture the trim
   * can apply to). An assertion here would pass with the trim fully
   * disabled - the reviewer's own live check on the fix wave 1 review
   * confirmed exactly that on this file's first draft - so it is
   * deleted rather than kept as a check that cannot fail. The trimmed
   * caption/containment/bar-count checks above are what the trimmed
   * grid actually changes; count-axis coverage for the axis itself
   * lives in the fix-wave-2 (#378) arms further up this file, against
   * the untrimmed geometry, which is the only geometry that ever moves
   * the axis's own scale.
   */
}

/*
 * THE TOOLTIP, DRIVEN END TO END (0.9-M2-S13, #378, owner ruling 2):
 * hover shows it, a click/tap pins it, a click/tap elsewhere dismisses
 * it - one behavior for both a distribution band (filled or empty) and
 * a trend point. Content is checked against binTooltipParts()/
 * trendTooltipParts() (already proven correct as pure functions above),
 * never against a hand-typed string this arm would have to keep in
 * sync by hand.
 */
{
  const { byId, doc } = await driven(() => response(200, ENOUGH_FIXTURE));
  const distTip = byId.get("tooltip-distribution");
  const distSvg = byId.get("figure-distribution").querySelector("svg");
  const hits = distSvg.children.filter((c) => c.tag === "rect" &&
    c.attrs.class === "chart-hit");
  const fixtureBins = ENOUGH_FIXTURE.distribution.bins;
  const fixtureUnit = ENOUGH_FIXTURE.units.unit;

  // MECHANICAL SWEEP (0.9-M3-S3, #388) of every hidden===true assertion
  // against a tooltip node in this file, done fully before this slice's
  // own additions below: buildDom() pre-hides both tooltip nodes
  // (comment above, "apps/web/charts.html ships both tooltips hidden by
  // default"), so a hidden===true check right here proves nothing about
  // hideTooltip() actually running - deleting hideTooltip(tip) from
  // resetTooltip() (apps/web/charts.js) leaves it green regardless
  // (#388's own finding, proven at 7dcd971, 186/186). The two other
  // hidden===true checks in this file (below, "moving off an unpinned
  // tooltip hides it again" and "tapping/clicking elsewhere dismisses a
  // pinned tooltip") are NOT this disease - each is immediately preceded
  // by a real transition INTO the shown state within the same block, so
  // the harness default cannot satisfy them. This one is the only
  // survivor of the sweep, and it stays as a real (if weak) check of the
  // shipped markup's own default - the genuine proof that resetTooltip()
  // hides a SHOWN tooltip now lives in the force-to-opposite arm this
  // slice adds after the empty-slot arm below.
  check("the distribution tooltip starts hidden",
    hits.length === fixtureBins.length && distTip.hidden === true);

  await hits[0].dispatch("mouseenter");
  const parts0 = Charts.binTooltipParts(fixtureBins[0].from,
    fixtureBins[0].to, fixtureUnit, fixtureBins[0].count);
  check("hovering a filled distribution band shows the tooltip with " +
    "the exact range and count, verbatim - binTooltipParts()'s own " +
    "answer, not a re-derived string",
    distTip.hidden === false &&
    distTip.textContent === parts0.lead + parts0.number);

  await hits[0].dispatch("mouseleave");
  check("moving off an unpinned tooltip hides it again",
    distTip.hidden === true);

  await hits[1].dispatch("click");
  check("clicking/tapping a band PINS the tooltip to it - the same " +
    "content a hover would have shown",
    distTip.hidden === false);
  await hits[1].dispatch("mouseleave");
  check("a pinned tooltip survives the pointer leaving - pinning is " +
    "what makes tap-to-pin mean something on a touchscreen with no " +
    "hover at all",
    distTip.hidden === false);

  await doc.dispatch("click");
  check("owner ruling 2: tapping/clicking elsewhere dismisses a " +
    "pinned tooltip",
    distTip.hidden === true);

  const trendTip = byId.get("tooltip-trend");
  const trendSvg = byId.get("figure-trend").querySelector("svg");
  const groupDots = trendSvg.children.filter((c) => c.tag === "circle" &&
    c.attrs.class === "chart-dot series-0");
  const selfDots = trendSvg.children.filter((c) => c.tag === "circle" &&
    c.attrs.class === "chart-dot series-1");
  const groupPoint = ENOUGH_FIXTURE.trend.points[0];
  const groupAt = new Date(groupPoint.period + "-01T00:00:00Z").getTime();
  const groupParts = Charts.trendTooltipParts(groupAt, "Average",
    groupPoint.average, fixtureUnit);

  await groupDots[0].dispatch("mouseenter");
  check("hovering the group's own trend point shows the month and " +
    "\"Average\" - the group mean, verbatim",
    trendTip.hidden === false &&
    trendTip.textContent === groupParts.lead + groupParts.number);

  const selfPoint = ENOUGH_FIXTURE.self.points[0];
  const selfAt = new Date(selfPoint.at).getTime();
  const selfParts = Charts.trendTooltipParts(selfAt, "You",
    selfPoint.value, fixtureUnit);

  await selfDots[0].dispatch("mouseenter");
  check("hovering the You point shows the same month with the You " +
    "series' own value, not the group's - owner ruling 2's own words " +
    "(\"the You point its own value\")",
    trendTip.hidden === false &&
    trendTip.textContent === selfParts.lead + selfParts.number);
}

/*
 * The tooltip's other required shape: an empty slot still verifies
 * (owner ruling 2's own words, "including an empty slot"). BANDS_FIXTURE
 * carries the zero band this arm needs (index 5).
 */
{
  const { byId } = await driven(() => response(200, BANDS_FIXTURE));
  const distTip = byId.get("tooltip-distribution");
  const distSvg = byId.get("figure-distribution").querySelector("svg");
  const hits = distSvg.children.filter((c) => c.tag === "rect" &&
    c.attrs.class === "chart-hit");
  const zeroBin = BANDS_FIXTURE.distribution.bins[5];

  await hits[5].dispatch("mouseenter");
  const zeroParts = Charts.binTooltipParts(zeroBin.from, zeroBin.to,
    BANDS_FIXTURE.units.unit, zeroBin.count);
  check("hovering an EMPTY band's own hit target (the zero-height bar " +
    "has no area of its own to hover, so this is the full-column hit " +
    "rect doing its job) shows the exact range and \"0 members\", " +
    "never a suppressed or different sentence for the zero case",
    zeroParts.number === "0 members" &&
    distTip.hidden === false &&
    distTip.textContent === zeroParts.lead + zeroParts.number);
}

/*
 * A REDRAW DISMISSES A PINNED TOOLTIP - FORCED TO OPPOSITE FIRST
 * (0.9-M3-S3, #388, found by 0.9-M2-S15's fix-wave re-fire, #383). The
 * sweep above found no existing arm actually proved this: the closest
 * one ("the distribution tooltip starts hidden") runs against a FRESH
 * page whose tooltip node was never shown, so buildDom()'s own
 * hidden=true default satisfies it whether or not resetTooltip()'s
 * hideTooltip(tip) call ever runs. This arm pins the tooltip FIRST (the
 * opposite of what it is about to assert), presses Show me again for a
 * real second draw - drawDistribution()/drawTrend()'s own
 * resetTooltip(tip) call, at the top of each - and only then checks
 * hidden. Deleting hideTooltip(tip) from resetTooltip() fails this and
 * only this arm; the "starts hidden" arm above stays green throughout.
 *
 * F1 (review, comment 5368921505): the two checks above proved only
 * that the tooltip NODE hides after the redraw - resetTooltip() also
 * clears pinnedTooltipTarget/pinnedTooltipElement, and nothing here
 * touched those two lines. Deleting them (keeping hideTooltip(tip))
 * left this file green at 236: wireTooltip()'s own mouseenter starts
 * with `if (pinnedTooltipTarget) return;`, so a stale pin left pointing
 * at a bar/point the redraw already discarded kills hover preview
 * PAGE-WIDE from that moment on - a member sees no tooltip on anything,
 * with no error and no visible cause, until they happen to click blank
 * space. Each block now dispatches mouseenter on a FRESH hit (queried
 * off the same svg reference AFTER the redraw - target.querySelector()
 * inside drawDistribution()/drawTrend() returns the same svg element
 * with its children replaced, never a new element, so `distSvg`/
 * `trendSvg` stay valid) and asserts the tooltip shows again. That
 * check is what fails under the pin-state mutation; the hidden-check
 * above it does not.
 */
{
  const { byId } = await driven(() => response(200, ENOUGH_FIXTURE));
  const distTip = byId.get("tooltip-distribution");
  const distSvg = byId.get("figure-distribution").querySelector("svg");
  const hits = distSvg.children.filter((c) => c.tag === "rect" &&
    c.attrs.class === "chart-hit");

  await hits[1].dispatch("click");
  check("0.9-M3-S3 (#388) setup: the distribution tooltip is pinned and " +
    "shown before the redraw below - the opposite of what the next " +
    "check asserts, which is the whole point of forcing it",
    distTip.hidden === false);

  await pressShowMe(byId);
  check("0.9-M3-S3 (#388): a real redraw (a second Show me press) " +
    "dismisses a PINNED tooltip - forced to shown first, so a stub " +
    "default of hidden could not have satisfied this the way it " +
    "satisfied the old arm",
    distTip.hidden === true);

  const freshHits = distSvg.children.filter((c) => c.tag === "rect" &&
    c.attrs.class === "chart-hit");
  await freshHits[0].dispatch("mouseenter");
  check("0.9-M3-S3 F1 (#388, review 5368921505): the redraw cleared the " +
    "PIN STATE too, not just the node - hovering a FRESH hit target " +
    "shows a tooltip. A stale pinnedTooltipTarget left over from the " +
    "click above would make wireTooltip()'s mouseenter early-return " +
    "here and this would fail even though the check above passed",
    distTip.hidden === false);
}

{
  const { byId } = await driven(() => response(200, ENOUGH_FIXTURE));
  const trendTip = byId.get("tooltip-trend");
  const trendSvg = byId.get("figure-trend").querySelector("svg");
  const groupDots = trendSvg.children.filter((c) => c.tag === "circle" &&
    c.attrs.class === "chart-dot series-0");

  await groupDots[0].dispatch("click");
  check("0.9-M3-S3 (#388) setup: the trend tooltip is pinned and shown " +
    "before the redraw below",
    trendTip.hidden === false);

  await pressShowMe(byId);
  check("0.9-M3-S3 (#388): a real redraw dismisses a PINNED trend " +
    "tooltip too - the same force-to-opposite proof as the " +
    "distribution figure above, run against the other figure so the " +
    "sweep covers both tooltip nodes this file drives",
    trendTip.hidden === true);

  const freshDots = trendSvg.children.filter((c) => c.tag === "circle" &&
    c.attrs.class === "chart-dot series-0");
  await freshDots[0].dispatch("mouseenter");
  check("0.9-M3-S3 F1 (#388, review 5368921505): same pin-state proof " +
    "against the trend figure - a fresh hover after the redraw shows " +
    "a tooltip, which a leftover pin pointing at a discarded point " +
    "would silently block",
    trendTip.hidden === false);
}

/*
 * F2 (review, comment 5368921505): the completion and this file's own
 * applyUnitLock() comment used to claim the keyboard-dismiss fix
 * "closes the gap a not-enough answer's early return leaves open", as
 * if a stale PINNED TOOLTIP would otherwise paint over a not-enough
 * answer. Neither half of that held up: no arm ever drove a pin into
 * the not-enough branch at all, and that branch hides picture-trend/
 * picture-distribution (renderAnswer()'s own show(..., false) calls,
 * ahead of its early return) - a tooltip nested inside either figure
 * paints NOTHING there whether or not the fix exists, so there was
 * never a visible stale tooltip on this branch to close.
 *
 * What the fix actually buys, armed honestly: dismissTooltipElsewhere()
 * runs SYNCHRONOUSLY in the onchange handler, ahead of the fetch, so
 * pinnedTooltipTarget is already null by the time a not-enough answer's
 * early return skips resetTooltip() (that branch calls neither
 * drawTrend() nor drawDistribution(), so it never reaches
 * resetTooltip() either way). The observable difference is PIN STATE,
 * not the tooltip's own hidden flag - both are already hidden either
 * way, since dismissTooltipElsewhere() hides distTip regardless. So
 * this arm pins a target, drives a keyboard-driven not-enough answer,
 * and then hovers a DIFFERENT pre-existing chart element (the SVG from
 * the first draw is untouched - drawDistribution() never runs a second
 * time on this branch) and checks its CONTENT, not just `hidden`: a
 * stale pin left pointing at the first target would block
 * wireTooltip()'s mouseenter on the second one and the tooltip would
 * keep showing the FIRST target's old text (still not hidden from the
 * pin) rather than switching to the second target's own.
 */
{
  const served = [ENOUGH_FIXTURE, NOT_ENOUGH_FIXTURE];
  let at = 0;
  const { byId, unitsInputs } = await driven(() =>
    response(200, served[Math.min(at++, served.length - 1)]));
  const distTip = byId.get("tooltip-distribution");
  const distSvg = byId.get("figure-distribution").querySelector("svg");
  const hits = distSvg.children.filter((c) => c.tag === "rect" &&
    c.attrs.class === "chart-hit");
  const fixtureBins = ENOUGH_FIXTURE.distribution.bins;
  const fixtureUnit = ENOUGH_FIXTURE.units.unit;

  await hits[1].dispatch("click");
  check("0.9-M3-S3 F2 (#388, review 5368921505) setup: the distribution " +
    "tooltip is pinned to hits[1] before the not-enough answer below",
    distTip.hidden === false);

  unitsInputs[0].checked = false;
  unitsInputs[1].checked = true;
  unitsInputs[1].dispatch("change");
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  check("0.9-M3-S3 F2 (#388) setup: the answer that came back really is " +
    "the not-enough one - its own early return hid the picture, the " +
    "branch renderAnswer() never calls resetTooltip() from",
    byId.get("picture-distribution").hidden === true &&
    byId.get("status")._text.indexOf(NOT_ENOUGH_FIXTURE.note) === 0);

  // hits[0] is a DIFFERENT target than the one pinned above, still
  // wired from the FIRST draw - drawDistribution() never ran a second
  // time (the not-enough branch returns before it), so this is a real
  // pre-existing hit target, not a fresh one the second draw made.
  const parts0 = Charts.binTooltipParts(fixtureBins[0].from,
    fixtureBins[0].to, fixtureUnit, fixtureBins[0].count);
  await hits[0].dispatch("mouseenter");
  check("0.9-M3-S3 F2 (#388, review 5368921505): hovering a DIFFERENT " +
    "pre-existing target while the not-enough answer is showing " +
    "switches the tooltip to THAT target's own content - proof the " +
    "PIN STATE cleared (a stale pinnedTooltipTarget from the click " +
    "above would block wireTooltip()'s mouseenter here and leave the " +
    "FIRST target's old text showing, still not hidden, rather than " +
    "switching)",
    distTip.hidden === false &&
    distTip.textContent === parts0.lead + parts0.number);
}

/*
 * A KEYBOARD-DRIVEN UNITS CHANGE DISMISSES A PIN TOO (0.9-M3-S3, #388).
 * dismissTooltipElsewhere() - the "tap elsewhere" half of owner ruling 2
 * - is wired to the document's own "click" (setUp(), apps/web/charts.js)
 * and nothing else, so an arrow-key change on the units radios, which
 * fires a "change" event with no click at all, never reached it before
 * this slice. applyUnitLock()'s onchange handler now calls
 * dismissTooltipElsewhere() itself, ahead of showMe() - the same
 * function the click path already uses, so there is no second dismiss
 * rule to keep in sync. The assertion checks hidden right after
 * dispatch("change") with NO await on the fetch/redraw that follows -
 * proof this is the change handler's own synchronous dismiss, not the
 * eventual redraw's (which the arm above already covers separately).
 */
{
  const { byId, unitsInputs } = await driven(() =>
    response(200, ENOUGH_FIXTURE));
  const distTip = byId.get("tooltip-distribution");
  const distSvg = byId.get("figure-distribution").querySelector("svg");
  const hits = distSvg.children.filter((c) => c.tag === "rect" &&
    c.attrs.class === "chart-hit");

  await hits[1].dispatch("click");
  check("0.9-M3-S3 (#388) setup: the distribution tooltip is pinned " +
    "before the keyboard-driven change below",
    distTip.hidden === false);

  unitsInputs[0].checked = false;
  unitsInputs[1].checked = true;
  unitsInputs[1].dispatch("change");
  check("0.9-M3-S3 (#388): a keyboard-driven units change - a " +
    "\"change\" event with no click at all, exactly what an arrow key " +
    "fires - dismisses a pinned tooltip SYNCHRONOUSLY, before the " +
    "fetch this same handler starts has any chance to resolve and " +
    "redraw",
    distTip.hidden === true);

  // Drained rather than left dangling: each driven() call reassigns
  // document/fetch on globalThis, and an unresolved promise from this
  // change's own showMe() call would otherwise write into whatever the
  // NEXT test block installs once it eventually resolves.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/*
 * O1 (fix wave 1): THE UNITS TOGGLE SURVIVES A NOT-ENOUGH ANSWER.
 *
 * The toggle's own handler is wired per drawn answer, so anything that
 * wires it BELOW renderAnswer()'s early return leaves it dead for the
 * whole session whenever the first answer a member gets is the honest
 * not-enough sentence - and switching units is exactly what somebody
 * looking at "not enough people for this view" would try next. The
 * sequence below is the one that catches it: fresh page, one press, a
 * not-enough answer, then a toggle that has to reach the route.
 */
{
  const served = [NOT_ENOUGH_FIXTURE, ENOUGH_FIXTURE_METRIC];
  let at = 0;
  const { byId, calls, unitsInputs } = await driven(() =>
    response(200, served[Math.min(at++, served.length - 1)]));

  check("O1: the session's first answer really is the not-enough one - " +
    "the state this arm is about",
    byId.get("status")._text.indexOf(NOT_ENOUGH_FIXTURE.note) === 0);

  const before = calls.length;
  unitsInputs[0].checked = false;
  unitsInputs[1].checked = true;
  await unitsInputs[1].dispatch("change");
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  check("O1: switching units after a not-enough answer still asks the " +
    "route - the toggle is wired ahead of renderAnswer()'s early " +
    "return, so an empty first view does not kill it for the session",
    calls.length === before + 1 &&
    new URL(calls[calls.length - 1]).searchParams.get("units") === "metric");
  check("O1: and the answer that comes back draws, in its own unit - " +
    "the member is out of the empty view without touching Show me again",
    byId.get("status")._text === "Showing Weight (kg).");
}

/*
 * THE UNITS TOGGLE RE-ASKS NOW (owner ruling 4, #396). Binning happens
 * in the displayed unit, so the other system is a different grid the
 * page has no way to compute and must not try: switching units fires a
 * fresh GET /charts-data carrying the new system, and every number
 * drawn afterwards comes out of THAT response, index for index. The
 * shape this replaces - "read a different key of the same answer" -
 * only worked while both systems were one partition converted, which
 * is exactly what ruling 4 retired.
 */
{
  const served = [ENOUGH_FIXTURE, ENOUGH_FIXTURE_METRIC];
  let at = 0;
  const { byId, calls, unitsInputs } = await driven(() =>
    response(200, served[Math.min(at++, served.length - 1)]));
  const callsBeforeToggle = calls.length;
  unitsInputs[0].checked = false;
  unitsInputs[1].checked = true;
  await unitsInputs[1].dispatch("change");
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  check("#396 ruling 4: switching units asks the Worker again - the " +
    "page cannot re-bin, so the other system has to be a fresh question",
    calls.length === callsBeforeToggle + 1);
  check("#396 ruling 4: the second request names the system the member " +
    "just chose",
    new URL(calls[calls.length - 1]).searchParams.get("units") === "metric");

  const svg = byId.get("figure-distribution").querySelector("svg");
  const labels = svg.children.filter((c) => c.tag === "text")
    .map((c) => c._text);
  check("#396: the redrawn axis carries the METRIC answer own edges " +
    "(70, 80, 90, 100) and none of the imperial ones - a real re-ask, " +
    "not a no-op and not a conversion",
    ["70", "80", "90", "100"].every((t) => labels.includes(t)) &&
    !["150", "175", "200", "225"].some((t) => labels.includes(t)));
  check("#396 ruling 2: the status line follows the new answer own " +
    "unit, which is the one place the page names it",
    byId.get("status")._text === "Showing Weight (kg).");
}

/*
 * F2 arm (0.9-M2-S3 fix wave 1, #354 comment 5342979192): with no units
 * radio checked - standing in for the static HTML own `checked`
 * attribute being absent - currentSystem() fallback has to be
 * apps/fields.js defaultSystem() (form.js and submit.js own pattern),
 * never a literal this file invents. Since #396 that fallback decides
 * what the page ASKS FOR, so the proof reads the request rather than
 * the drawing: flipped both directions, only the fallback source can
 * explain the difference.
 */
{
  const { calls } = await driven(() => response(200, ENOUGH_FIXTURE),
    { noUnitsChecked: true, defaultSystem: "imperial" });
  check("F2: with no units radio checked, the request follows the spec " +
    "defaultSystem() - imperial here",
    new URL(calls[calls.length - 1]).searchParams.get("units") ===
    "imperial");
}

{
  const { calls } = await driven(() => response(200, ENOUGH_FIXTURE_METRIC),
    { noUnitsChecked: true, defaultSystem: "metric" });
  check("F2: flipping the spec defaultSystem() to metric flips the ask " +
    "too - the page derives the fallback from the spec, it does not " +
    "hardcode one",
    new URL(calls[calls.length - 1]).searchParams.get("units") === "metric");
}

/*
 * THE UNIT LOCK, DRIVEN (the 2026-08-21 axis sitting escalation, #396).
 * A raised floor serves one system, and the answer says so - so the page
 * has to make the toggle inert and say why, rather than leave a member
 * pressing a control that cannot move. Both halves are read off the
 * response own `locked` flag; nothing here knows what a floor is.
 */
{
  const { byId, unitsInputs, calls } = await driven(() =>
    response(200, LOCKED_FIXTURE));
  check("#396 lock: a locked answer disables both units radios - the " +
    "control is visibly inert rather than silently ineffective",
    unitsInputs.every((input) => input.disabled === true));
  check("#396 lock: the radio matching the answer own system is the " +
    "one checked, so the control never claims a unit the figures are " +
    "not in",
    unitsInputs.filter((input) => input.checked)
      .map((input) => input.value).join() === "metric");
  check("#396 lock: the status line says so in plain words, after the " +
    "measure sentence and composed from the answer own unit",
    byId.get("status")._text ===
      "Showing Weight (kg). " + Charts.UNIT_LOCK_NOTE("kg"));
  const before = calls.length;
  await unitsInputs[0].dispatch("change");
  await new Promise((resolve) => setTimeout(resolve, 0));
  check("#396 lock: pressing the disabled radio asks nothing - a locked " +
    "view cannot be talked into a second partition from the page",
    calls.length === before);
}

{
  const { byId, unitsInputs } = await driven(() =>
    response(200, ENOUGH_FIXTURE));
  // Forced to the LOCKED state first, then drawn again against an
  // unlocked answer - so this fails if the page only ever disables and
  // never re-enables, which a stub default of false would have hidden.
  unitsInputs.forEach((input) => { input.disabled = true; });
  await pressShowMe(byId);
  check("#396 lock: an UNLOCKED answer actively re-enables both radios " +
    "- forced disabled first, so a page that never turns the lock off " +
    "again reddens here",
    unitsInputs.every((input) => input.disabled === false));
  check("#396 lock: and its status line carries no lock sentence - the " +
    "note is the response own flag, never a fixed suffix",
    byId.get("status")._text === "Showing Weight (lb).");
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

const EXPECTED = 315;
console.log(failures
  ? `\ncharts-page FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\ncharts-page ran ${performed} checks, expected ${EXPECTED}`
    : `\ncharts-page OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
