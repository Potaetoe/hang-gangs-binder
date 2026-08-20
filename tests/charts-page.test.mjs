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
 * the arm below checks the caption row against exactly the positions
 * apps/web/charts.js's own rangeCaptionPlan() says should carry one.
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
 * and rangeCaptionPlan() below are checked three ways: a controlled
 * overlap case with hand-verifiable geometry, the exact scenario the
 * review reported (F2's own numbers), and the real shipped grids the
 * review named fed through the real function, since this suite's own
 * DOM stub cannot measure a painted pixel. These arms all use
 * rangeCaptionPlan()'s plain, UNCLAMPED 2-argument mode - the geometry
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
 * record on #372 (the F7 finding). "0" is the narrowest digit a count
 * caption ever prints alone; "–" is the dash binLabel() joins every
 * range caption with, so both sit on the actual hot path.
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
 * (owner ruling, the 2026-08-19 late sitting) and rangeCaptionPlan() is
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
  Charts.rangeCaptionPlan(repro88Labels, repro88Slot).length < 88);

/* A controlled, hand-verifiable case: three captions far enough apart
   that none can possibly overlap (a slot ten times any caption's own
   width) - every one paints, proving the plan is not "always thin". */
check("rangeCaptionPlan paints every caption when nothing overlaps",
  JSON.stringify(Charts.rangeCaptionPlan(["a", "bb", "ccc"], 1000)) ===
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

/* The metric weight grid (apps/web/site.config.js's kg unit: min 20,
   max 500, bin 10) - the second of fix wave 1's three regression
   fixtures (finding F1, #378), 48 bands. */
const metricWeightGrid = realGrid(20, 500, 10);
check("the real shipped metric-weight grid is 48 bands - " +
  "apps/web/site.config.js's kg unit (min 20, max 500, bin 10)",
  metricWeightGrid.length === 48);

/*
 * MIDPOINT CAPTIONS (0.9-M2-S13, #378, owner ruling 1). Plain rounding,
 * a whole number, no unit - the ruling's own examples are the spec-fed
 * arm below.
 */
check("midpointLabel rounds a band's own midpoint to a whole number - " +
  "the ruling's own examples",
  Charts.midpointLabel(152.5, 157.5) === "155" &&
  Charts.midpointLabel(182.5, 187.5) === "185");
check("midpointLabel rounds .5 up, plainly - Math.round's own rule, " +
  "nothing fancier asked for",
  Charts.midpointLabel(0, 5) === "3" && Charts.midpointLabel(0, 1) === "1");
check("midpointLabel carries no unit token, ever - the unit is stated " +
  "once at the axis edge, never per caption (owner ruling 1)",
  !/[a-zA-Z]/.test(Charts.midpointLabel(20, 25)));

/* UNIQUENESS on the shipped grids: a fixed-width grid's midpoints are
   strictly increasing by the band width, so no two bands ever share a
   caption - checked on the real spec rather than assumed from the
   arithmetic. */
const bmiMidpoints = bmiGrid.map((b) => Charts.midpointLabel(b.from, b.to));
check("every midpoint caption on the real 120-band BMI grid is unique",
  new Set(bmiMidpoints).size === bmiMidpoints.length);
const weightMidpoints = weightGrid.map((b) =>
  Charts.midpointLabel(b.from, b.to));
check("every midpoint caption on the real 53-band imperial-weight " +
  "grid is unique",
  new Set(weightMidpoints).size === weightMidpoints.length);
const metricWeightMidpoints = metricWeightGrid.map((b) =>
  Charts.midpointLabel(b.from, b.to));
check("every midpoint caption on the real 48-band metric-weight grid " +
  "is unique",
  new Set(metricWeightMidpoints).size === metricWeightMidpoints.length);

/*
 * CONTAINMENT, THE PRIMITIVE (0.9-M2-S13, #378, owner ruling 1;
 * containBox()'s own 3-argument signature is fix wave 1's, finding F1,
 * #378: `lowerBound` used to be hardcoded 0, and is now the plot's own
 * left edge, since drawBins() reserves a left gutter for the count
 * axis - owner ruling 2, the 2026-08-19 late sitting).
 */
check("containBox leaves a box that already fits inside " +
  "[lowerBound, upperBound] unchanged - the no-op case every interior " +
  "caption hits",
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

/* An adversarial hand-built case: a caption wide enough that its own
   box, centered in its slot, overshoots BOTH bounds by construction -
   the property has to hold even here, not merely on the real grids
   where it happens to. */
check("containBox clamps a caption wider than the whole row to the " +
  "left edge (left takes priority, matching the left-then-right order " +
  "the function itself reads in)",
  JSON.stringify(Charts.containBox({ left: 0, right: 750 }, 50, 640)) ===
  JSON.stringify({ left: 50, right: 800 }));

/*
 * F1, FIX WAVE 1'S OWN FINDING (#378, the review of record on the head
 * this suite's own previous build shipped): containBox() shifting the
 * forced last caption AFTER rangeCaptionPlan() had already ruled the
 * row collision-free recreated exactly the overlap the plan exists to
 * prevent - owner-found live (a real overlapping caption pair, on the
 * real page), reviewer-confirmed by geometry. "resolved by dropping
 * interior neighbours, never an end" is the ruling; rangeCaptionPlan()'s
 * optional third argument (`boxOf`) is the fix - the SAME final,
 * contained, offset boxes are what the plan now compares for overlap
 * AND what the render loop paints from, so there is exactly one
 * definition of where a caption ends up.
 *
 * The three regression fixtures below are the real shipped grids under
 * drawBins()'s own real geometry (a 640-wide row, the new 50-unit left
 * gutter, and - where the measure has a unit - the axis-edge marker's
 * own reserve): imperial weight (53 bands), metric weight (48 bands),
 * BMI (120 bands, unitless). `finalBoxOf` mirrors drawBins()'s own
 * `boxOf` closure exactly, built from the same exported primitives
 * (captionBox(), containBox()) rather than a second reimplementation of
 * either.
 */
const PLOT_LEFT = 50;
const VIEW_WIDTH = 640;

function rightBoundFor(unit) {
  return unit ? VIEW_WIDTH - Charts.captionWidth(unit) - 8 : VIEW_WIDTH;
}

function finalBoxOf(midpoints, slot, rightBound) {
  return function (i) {
    const raw = Charts.captionBox(i, slot, midpoints[i]);
    return Charts.containBox(
      { left: PLOT_LEFT + raw.left, right: PLOT_LEFT + raw.right },
      PLOT_LEFT, rightBound);
  };
}

function localBoxesOverlap(a, b) {
  return !(a.right <= b.left || a.left >= b.right);
}

/* THE BUG, REPRODUCED: the plan computed on UNCLAMPED boxes (the old,
   2-argument shape), each painted index then clamped SEPARATELY at
   render time - exactly the two-stage shape the review found broken.
   All three real grids reproduce it under the real geometry above,
   which is the fixture proving fix wave 1's own regression is real and
   not moot against the (unrelated) left-gutter change in the same
   wave. */
function oldBuggyOverlapCount(midpoints, slot, rightBound) {
  const unclampedPlan = Charts.rangeCaptionPlan(midpoints, slot);
  const box = finalBoxOf(midpoints, slot, rightBound);
  const finalBoxes = unclampedPlan.map(box);
  let overlaps = 0;
  for (let k = 1; k < finalBoxes.length; k += 1) {
    if (localBoxesOverlap(finalBoxes[k - 1], finalBoxes[k])) overlaps += 1;
  }
  return overlaps;
}

/* THE FIX: the SAME boxOf fed into rangeCaptionPlan() itself, so the
   plan and the paint agree on where things actually end up. */
function newFixedOverlapCount(midpoints, slot, rightBound) {
  const box = finalBoxOf(midpoints, slot, rightBound);
  const plan = Charts.rangeCaptionPlan(midpoints, slot, box);
  const finalBoxes = plan.map(box);
  let overlaps = 0;
  for (let k = 1; k < finalBoxes.length; k += 1) {
    if (localBoxesOverlap(finalBoxes[k - 1], finalBoxes[k])) overlaps += 1;
  }
  return overlaps;
}

const FIXTURES = [
  { name: "BMI (120 bands, unitless)", grid: bmiGrid, mids: bmiMidpoints,
    slot: bmiSlot, unit: null },
  { name: "imperial weight (53 bands)", grid: weightGrid,
    mids: weightMidpoints, slot: weightSlot, unit: "lb" },
  { name: "metric weight (48 bands)", grid: metricWeightGrid,
    mids: metricWeightMidpoints, slot: VIEW_WIDTH / metricWeightGrid.length,
    unit: "kg" },
];

for (const f of FIXTURES) {
  const rightBound = rightBoundFor(f.unit);
  const oldOverlaps = oldBuggyOverlapCount(f.mids, f.slot, rightBound);
  check("F1/#378: " + f.name + " - the OLD two-stage shape (plan " +
    "unclamped, clamp separately at render) really does overlap under " +
    "the real geometry, proving this regression is live here and not " +
    "moot against the same wave's left-gutter change",
    oldOverlaps > 0);

  const newOverlaps = newFixedOverlapCount(f.mids, f.slot, rightBound);
  check("F1/#378: " + f.name + " - the FIX (rangeCaptionPlan() fed the " +
    "final, contained boxes directly) leaves zero overlaps among the " +
    "FINAL painted positions",
    newOverlaps === 0);
}

/* THE LEFT EDGE SPECIFICALLY (the ruling's own words: "the left edge
   has the same latent hole ... the final-position property must cover
   both ends"). Index 0's own final box is always the one containBox()
   clamps against the LOWER bound when it needs clamping at all - this
   asserts the fixed plan's first painted caption sits with its left
   edge exactly AT the gutter, never spilling past it into the axis
   labels, on the densest of the three real grids. */
{
  const box = finalBoxOf(bmiMidpoints, bmiSlot, rightBoundFor(null));
  const first = box(0);
  check("F1/#378: the BMI grid's own first (index 0) painted caption " +
    "sits with its left edge exactly at the plot's own left bound - " +
    "the left-edge half of the final-position property, not merely " +
    "the right",
    Math.abs(first.left - PLOT_LEFT) < 1e-9);
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
/* 2b. The xlsx workbook (0.9-M2-S14, #380 ruling 3): workbookColumns() */
/* and workbookRows() are the row-marshaling this file adds; the bytes  */
/* themselves are BinderXlsx.build()'s, reused rather than reimplemented. */

check("workbookColumns names the unit inline, once, when there is one",
  JSON.stringify(Charts.workbookColumns("lb")) ===
  JSON.stringify(["Section", "Label", "Count", "Average (lb)", "You (lb)"]));
check("and carries no unit token when the measure is unitless",
  JSON.stringify(Charts.workbookColumns(null)) ===
  JSON.stringify(["Section", "Label", "Count", "Average", "You"]));

check("a not-enough answer's whole workbook is one Status row - the " +
  "same honest sentence the page prints, plus the same broader-filter " +
  "hint",
  JSON.stringify(Charts.workbookRows(
    { enough: false, note: "Not enough people for this view." },
    "imperial", {}, () => null)) ===
  JSON.stringify([["Status",
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
  units: { metric: { unit: "kg" }, imperial: { unit: "lb" } },
  distribution: { bins: [
    { count: 3, from: { metric: 20, imperial: 44 },
      to: { metric: 70, imperial: 154 } },
  ] },
  trend: { points: [
    { period: "2026-08", average: { metric: 81, imperial: 178.6 } },
  ] },
  self: { points: [
    { at: "2026-08-11T00:00:00.000Z", value: { metric: 82, imperial: 180.8 } },
  ] },
  groups: [
    { field: "country", label: "Country", multiple: false, values: [
      { value: "US", label: "US", count: 5, bucket: null },
    ] },
  ],
};
const workbookMeasureFor = (name) => (name === "country"
  ? { name: "country", choicesFrom: "countries" } : null);

const workbookRows = Charts.workbookRows(WORKBOOK_ANSWER, "imperial",
  WORKBOOK_COUNTRIES, workbookMeasureFor);

check("the distribution row carries the exact band range, not the " +
  "rounded on-screen caption, and the raw count as a NUMBER",
  workbookRows[0][0] === "Distribution" &&
  workbookRows[0][1] === "44 lb–154 lb" && workbookRows[0][2] === 3 &&
  typeof workbookRows[0][2] === "number");
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
const NEEDED = ["filter-field", "filter-value-field", "filter-value",
  "measure", "picture-tab-trend", "picture-tab-distribution",
  "picture-trend", "picture-distribution", "figure-trend",
  "figure-distribution", "groups", "groups-body", "results", "status",
  "show-me", "download", "tooltip-trend", "tooltip-distribution"];
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
  doc.createElement = (tag) => {
    const el = rawCreateElement(tag);
    if (tag === "a") createdAnchors.push(el);
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
 * `opts.defaultSystem` stands in for apps/web/site.config.js's
 * units.default, read through apps/fields.js's defaultSystem() (F2's
 * arm below flips it both directions). It is a fixture value here for
 * the same reason BinderFields itself is fixtured throughout this
 * file - never the real site.config.js/fields.js pair - but it is
 * standing in for the exact same fact currentSystem() now derives from.
 */
async function driven(fetchImpl, opts) {
  const options = opts || {};
  const { doc, byId, unitsInputs, createdAnchors } = buildDom(options);
  const calls = [];
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
  // for the same reason.
  g.BinderFields = {
    measures: () => measureFixture(),
    measure: (name) => measureFixture().find((m) => m.name === name),
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
  // name behind them, so the filter-field arm below can prove the
  // pinned block lands at indexes 0-2 exactly, not merely "some of it".
  g.BINDER_COUNTRIES = { US: "United States", AL: "Albania",
    GB: "United Kingdom", CA: "Canada" };
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

  return { byId, doc, calls, unitsInputs, created, revoked, blobs,
    createdAnchors };
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
  const allText = svg.children.filter((c) => c.tag === "text");
  const labels = allText.map((c) => c._text);
  check("no rendered label uses the retired open-edge shape (\"under " +
    "X\"/\"X and up\") - server/charts-agg.js's openEdge() is gone " +
    "(0.9-M2-S10) and every edge here is a plain number",
    !labels.some((t) => /^under /.test(t) || / and up$/.test(t)));

  /*
   * F1's behavioral arm (0.9-M2-S3 fix wave 1, #354 comment 5342979192),
   * carried through the 0.9-M2-S11 reshape, its own review's F1/F2
   * geometry fix, the 0.9-M2-S13 midpoint-caption reshape, and fix wave
   * 1's own count-row removal and count axis (#378): the rendered BAR
   * count and every caption are compared against the fixture's OWN
   * bins, index for index, in the response's own order. A client-side
   * pooler or merger reddens here regardless of what it calls itself,
   * because it is asked what actually painted. With only 3 bands spaced
   * 213 user units apart and captions well under 100 units wide,
   * nothing here collides, so every caption still paints and this arm
   * reads the same as it always did; the sparse case - where
   * rangeCaptionPlan() actually drops some - is BANDS_FIXTURE's own arm
   * below. The exact COUNT VALUE per bin is no longer painted at all
   * (owner ruling, the 2026-08-19 late sitting) - that half of the
   * proof is the tooltip block's, further down.
   *
   * The unit marker and the new count-axis ticks share .chart-label's
   * class AND text-anchor="end" (design mandate 1: same tone; both sit
   * right-aligned) - told apart by their own x position instead: the
   * unit marker sits at the row's true right edge (x === width), the
   * axis ticks sit in the left gutter (x === left - 8).
   */
  const captionEls = allText.filter((c) => c.attrs.class === "chart-label" &&
    c.attrs["text-anchor"] === "middle");
  const captionLabels = captionEls.map((c) => c._text);
  const endAnchored = allText.filter((c) => c.attrs.class === "chart-label" &&
    c.attrs["text-anchor"] === "end");
  const unitMarkers = endAnchored.filter((c) => Number(c.attrs.x) === 640)
    .map((c) => c._text);
  const axisTicks = endAnchored.filter((c) => Number(c.attrs.x) !== 640);
  const bars = svg.children.filter((c) => c.tag === "rect" &&
    c.attrs.class === "chart-bar");
  const fixtureBins = ENOUGH_FIXTURE.distribution.bins;
  const fixtureUnit = ENOUGH_FIXTURE.units.imperial.unit;
  check("F1: the rendered bar count equals the response's bin count " +
    "exactly - a client-side pooler that merges adjacent bins reddens " +
    "here regardless of what it calls itself",
    bars.length === fixtureBins.length &&
    captionLabels.length === fixtureBins.length);
  check("F1/#378: every caption is that bin's own MIDPOINT (never the " +
    "full range any more), in the response's own order - a pooled or " +
    "re-binned draw shows a spanning caption no fixture bin has",
    fixtureBins.every(function (bin, i) {
      return captionLabels[i] === Charts.midpointLabel(bin.from.imperial,
        bin.to.imperial);
    }));
  check("#378 owner ruling: each bar's height reflects its own count, " +
    "in the response's own order (the largest fixture count, 7, draws " +
    "the tallest bar; every non-zero count draws a positive height) - " +
    "the height a pooled/re-summed draw could not reproduce in order",
    fixtureBins.every((bin, i) => bin.count > 0
      ? Number(bars[i].attrs.height) > 0
      : Number(bars[i].attrs.height) === 0) &&
    Number(bars[2].attrs.height) > Number(bars[1].attrs.height) &&
    Number(bars[0].attrs.height) > Number(bars[1].attrs.height));
  check("#378 owner ruling 1: the unit is stated exactly once, at the " +
    "axis edge - never per caption. No caption carries a unit letter " +
    "any more, and the row's own axis mark is the response's real unit",
    unitMarkers.length === 1 && unitMarkers[0] === fixtureUnit &&
    captionLabels.every((t) => !/[a-zA-Z]/.test(t)));
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

  /* Owner ruling 1, #243, reshaped as chips by 0.9-M2-S13 (#378): the
     group-makeup block. One chip per value, zeros included, from the
     response's own `groups` field - no chart machinery, no bars. */
  const groupsBody = byId.get("groups-body");
  const chipRows = groupsBody.children.filter((c) =>
    c.className.split(" ").includes("chip-row"));
  check("the group makeup card is shown once a drawn answer arrives",
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
 * Pinned countries, driven end to end (0.9-M2-S14, #380 ruling 4):
 * selecting the country filter field fires populateFilterValue(),
 * which now runs the alphabetical option list through
 * Fields.orderedChoices() before appending it. The fixture BinderFields
 * above replicates the real algorithm; this proves charts.js actually
 * calls it, at the right moment, on the right field.
 */
{
  const { byId } = await driven(() => response(200, ENOUGH_FIXTURE));
  byId.get("filter-field").value = "country";
  await byId.get("filter-field").dispatch("change");

  const options = byId.get("filter-value").children.map((o) => o.value);
  check("the country filter's pinned block is exactly US, GB, CA, in " +
    "that order, at indexes 0-2",
    options[0] === "US" && options[1] === "GB" && options[2] === "CA");
  check("the full alphabetical run still follows, pinned codes present " +
    "a second time - a reader scanning either way finds them",
    options.slice(3).join(",") === "AL,CA,GB,US");
  byId.get("filter-field").value = "gender";
  await byId.get("filter-field").dispatch("change");
  check("a non-country categorical field is never reordered - the " +
    "pinning is positional (measure.choicesFrom === \"countries\"), " +
    "not applied to every filter value list",
    byId.get("filter-value").children.map((o) => o.value).join(",") ===
    "male,female");
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
    clickedSheet.includes("44 lb") && clickedSheet.includes("154 lb"));
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
 * empty one at zero height. Captions are thinned by GEOMETRY now
 * (owner's F1/F2 ruling, #372's review), not by a fixed stride, so this
 * arm computes the expected caption row by calling the same
 * rangeCaptionPlan()/countCaptionPlan() the page itself calls - proving
 * the DOM matches the pure functions exactly, index for index, rather
 * than hardcoding an index list that would silently stop meaning
 * anything the moment either function's algorithm changed.
 *
 * FORTY, NOT FOURTEEN (0.9-M2-S13, #378): midpointLabel()'s captions
 * are shorter than the retired full-range ones - at 14 bands, every
 * midpoint caption now clears its own slot with room to spare and
 * nothing thins at all, which would leave this arm's own "the row
 * really does thin sometimes" property unproven at the DOM level (the
 * pure-function containment checks above already prove thinning still
 * happens on the real BMI/imperial grids; this arm's OWN job is
 * proving the rendered DOM tracks the plan, and that needs a fixture
 * dense enough for the plan to actually drop something). Forty bands
 * over the same 20-unit-wide spacing pushes 3-digit midpoints (up to
 * 24 user units) into a 16-unit slot, where they collide again.
 */
function makeBands(zeroIndex, count) {
  const bins = [];
  for (let i = 0; i < count; i += 1) {
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

const BAND_COUNT = 40;

const BANDS_FIXTURE = Object.assign({}, ENOUGH_FIXTURE, {
  distribution: {
    kind: "bins",
    partition: { system: "imperial", unit: "lb", band: "20 lb bands" },
    bins: makeBands(5, BAND_COUNT),
  },
});

{
  const { byId } = await driven(() => response(200, BANDS_FIXTURE));
  const svg = byId.get("figure-distribution").querySelector("svg");
  const bars = svg.children.filter((c) => c.tag === "rect" &&
    c.attrs.class === "chart-bar");
  // The unit marker and the count-axis ticks share .chart-label's class
  // AND text-anchor="end" - told apart by x position exactly as the
  // ENOUGH_FIXTURE arm above does (the marker sits at x === width; the
  // axis ticks sit in the left gutter, x === left - 8).
  const captionEls = svg.children.filter((c) => c.tag === "text" &&
    c.attrs.class === "chart-label" && c.attrs["text-anchor"] === "middle");
  const captionLabels = captionEls.map((c) => c._text);
  const endAnchored = svg.children.filter((c) => c.tag === "text" &&
    c.attrs.class === "chart-label" && c.attrs["text-anchor"] === "end");
  const unitMarkers = endAnchored.filter((c) => Number(c.attrs.x) === 640)
    .map((c) => c._text);
  const bins = BANDS_FIXTURE.distribution.bins;

  check("every one of the " + BAND_COUNT + " bands draws a bar - the " +
    "empty one is not skipped",
    bars.length === BAND_COUNT);
  check("the empty band's bar is a zero-height slot, present on the " +
    "axis rather than omitted",
    Number(bars[5].attrs.height) === 0);

  // The SAME boxOf drawBins() itself builds - left-offset, contained -
  // fed into rangeCaptionPlan()'s own 3-argument mode (fix wave 1, F1,
  // #378), so this expectation is computed the identical way the page
  // computes its own, not the retired 2-argument (unclamped) shape.
  const slot40 = (640 - PLOT_LEFT) / bins.length;
  const midpointTexts = bins.map((bin) =>
    Charts.midpointLabel(bin.from.imperial, bin.to.imperial));
  const bandsBoxOf = finalBoxOf(midpointTexts, slot40, rightBoundFor("lb"));
  const expectedCaptionIndexes =
    Charts.rangeCaptionPlan(midpointTexts, slot40, bandsBoxOf);

  check("F1/F2/#378: the rendered caption row is exactly the positions " +
    "rangeCaptionPlan() says should carry one, each that bin's own " +
    "MIDPOINT, in order - the page's own boxOf (offset + contained) is " +
    "what both this arm and drawBins() itself plan against",
    captionLabels.length === expectedCaptionIndexes.length &&
    expectedCaptionIndexes.every((idx, j) =>
      captionLabels[j] === midpointTexts[idx]));
  check("F1/F2: on this fixture's own geometry, the caption row is " +
    "thinner than the full " + BAND_COUNT + " bands - the fix removes " +
    "overlapping captions, not every caption",
    expectedCaptionIndexes.length < BAND_COUNT &&
    expectedCaptionIndexes.length > 0);
  check("the first and last captions are the ones this fixture's own " +
    "plan keeps, never dropped as interior collisions are",
    expectedCaptionIndexes[0] === 0 &&
    expectedCaptionIndexes[expectedCaptionIndexes.length - 1] ===
    BAND_COUNT - 1);
  check("#378 owner ruling 1: the unit still paints exactly once on " +
    "this dense a row too, and no painted caption carries a unit letter",
    unitMarkers.length === 1 && unitMarkers[0] === "lb" &&
    captionLabels.every((t) => !/[a-zA-Z]/.test(t)));

  /*
   * CONTAINMENT AND NO-OVERLAP TOGETHER (fix wave 1, F1, #378): with
   * forty bands the end slots do need the clamp - this checks both
   * properties directly off the actual rendered x-positions rather than
   * trusting the pure-function arms alone: every painted caption sits
   * inside [left, rightBound], AND no two adjacent painted captions'
   * own rendered boxes overlap.
   */
  const rightBound40 = rightBoundFor("lb");
  check("no painted caption's own x-position, read back from the SVG, " +
    "sits outside [left, rightBound]",
    captionEls.every((el) => {
      const x = Number(el.attrs.x);
      const half = Charts.captionWidth(el._text) / 2;
      return x - half >= PLOT_LEFT - 1e-6 && x + half <= rightBound40 + 1e-6;
    }));
  check("F1/#378: no two adjacent painted captions' own rendered " +
    "positions overlap - the final-position property, read back from " +
    "the SVG rather than recomputed",
    captionEls.every((el, j) => {
      if (j === 0) return true;
      const prev = captionEls[j - 1];
      const half = Charts.captionWidth(el._text) / 2;
      const prevHalf = Charts.captionWidth(prev._text) / 2;
      const box = { left: Number(el.attrs.x) - half, right: Number(el.attrs.x) + half };
      const prevBox = { left: Number(prev.attrs.x) - prevHalf,
        right: Number(prev.attrs.x) + prevHalf };
      return !localBoxesOverlap(prevBox, box);
    }));
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
  const fixtureUnit = ENOUGH_FIXTURE.units.imperial.unit;

  check("the distribution tooltip starts hidden",
    hits.length === fixtureBins.length && distTip.hidden === true);

  await hits[0].dispatch("mouseenter");
  const parts0 = Charts.binTooltipParts(fixtureBins[0].from.imperial,
    fixtureBins[0].to.imperial, fixtureUnit, fixtureBins[0].count);
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
    groupPoint.average.imperial, fixtureUnit);

  await groupDots[0].dispatch("mouseenter");
  check("hovering the group's own trend point shows the month and " +
    "\"Average\" - the group mean, verbatim",
    trendTip.hidden === false &&
    trendTip.textContent === groupParts.lead + groupParts.number);

  const selfPoint = ENOUGH_FIXTURE.self.points[0];
  const selfAt = new Date(selfPoint.at).getTime();
  const selfParts = Charts.trendTooltipParts(selfAt, "You",
    selfPoint.value.imperial, fixtureUnit);

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
  const zeroParts = Charts.binTooltipParts(zeroBin.from.imperial,
    zeroBin.to.imperial, BANDS_FIXTURE.units.imperial.unit, zeroBin.count);
  check("hovering an EMPTY band's own hit target (the zero-height bar " +
    "has no area of its own to hover, so this is the full-column hit " +
    "rect doing its job) shows the exact range and \"0 members\", " +
    "never a suppressed or different sentence for the zero case",
    zeroParts.number === "0 members" &&
    distTip.hidden === false &&
    distTip.textContent === zeroParts.lead + zeroParts.number);
}

/*
 * The units toggle: re-render from the SAME cached answer, with no
 * second fetch (security mandate 2 - "reads the per-system key the
 * route already returned"). Distinguishing this from a re-bin requires
 * a number that differs between the two systems' MIDPOINTS (0.9-M2-S13
 * retired the full range as the caption, so the raw edges 90/198 no
 * longer appear anywhere in the SVG - the second bin's own midpoints,
 * 80 metric and 176 imperial, are the ruled equivalent for this arm).
 */
const SECOND_BIN_MIDPOINT_METRIC = Charts.midpointLabel(70, 90);
const SECOND_BIN_MIDPOINT_IMPERIAL = Charts.midpointLabel(154, 198);

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
  check("the redrawn captions carry the metric midpoint, not the " +
    "imperial one - a real re-render, not a no-op",
    labels.includes(SECOND_BIN_MIDPOINT_METRIC) &&
    !labels.includes(SECOND_BIN_MIDPOINT_IMPERIAL));
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
    "the spec's defaultSystem() (imperial here) - the imperial " +
    "midpoint is drawn, not the metric one",
    labels.includes(SECOND_BIN_MIDPOINT_IMPERIAL) &&
    !labels.includes(SECOND_BIN_MIDPOINT_METRIC));
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
    labels.includes(SECOND_BIN_MIDPOINT_METRIC) &&
    !labels.includes(SECOND_BIN_MIDPOINT_IMPERIAL));
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

const EXPECTED = 170;
console.log(failures
  ? `\ncharts-page FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\ncharts-page ran ${performed} checks, expected ${EXPECTED}`
    : `\ncharts-page OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
