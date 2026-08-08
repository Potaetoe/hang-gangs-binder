/*
 * Checks for the DRAWING half of apps/web/dashboard.js.
 *
 *     node dev/dashboard-render.test.mjs
 *
 * dev/dashboard.test.mjs covers the pure half - the aggregation, the
 * suppression floor, the quantization - and it cannot cover this half at
 * all. That file loads the module with no `document`, which is exactly
 * what proves the arithmetic runs under Node, and exactly what makes
 * everything below dashboard.js:971 unreachable from it: the module
 * returns there before `render` is defined. The first two checks in this
 * file pin that seam in both directions, because it is the reason the
 * two files exist separately rather than a fact to be remembered.
 *
 * WHAT THIS COSTS WHEN IT IS MISSING. ~390 lines across two pages had no
 * suite of any kind, `createElementNS` appeared nowhere under dev/, and
 * both consumers stub the module out rather than draw with it
 * (dev/admin-session.test.mjs, dev/public.test.mjs). #105's rewrite of
 * render() landed inside that gap - including the `|| []` at
 * dashboard.js:1282 that keeps a snapshot without a handle-changes field
 * from throwing, which nothing read. The coverage survey on #74 ranked
 * this first of nine for that reason: a chart that is wrong looks
 * exactly like a chart that is right, and here so does a chart that
 * never drew.
 *
 * WHAT IS ASSERTED. The tree, not the call. Every check reads structure
 * the browser would paint - element names, namespaces, the classes
 * theme.css styles against, attribute values, rendered text - rather
 * than asking whether a function ran. Two contracts stated in comments
 * and enforced by neither file are pinned here for the first time: that
 * a polyline carries no `fill` attribute (dashboard.js:1157 and
 * theme.css:915-923, which together are the only thing keeping a weight
 * history from painting as a filled wedge), and that nothing rendered
 * carries a `style` attribute, which admin.html's `style-src 'self'`
 * would drop on the floor.
 *
 * THE STUB IS ATTACKED, NOT TRUSTED. A DOM stub can make a check pass by
 * being wrong - a textContent that does not descend into children would
 * make the "no handle reaches a published document" check green against
 * a tree full of handles. The harness section at the top asserts the
 * stub's own fidelity on every behavior a later check leans on, so a
 * lying stub fails there first.
 */
import { readFile } from "node:fs/promises";

const SOURCE = await readFile(
  new URL("../apps/web/dashboard.js", import.meta.url), "utf8");
const THEME_CSS = await readFile(
  new URL("../apps/web/theme.css", import.meta.url), "utf8");

const SVG_NS = "http://www.w3.org/2000/svg";
const HTML_NS = "http://www.w3.org/1999/xhtml";

let failures = 0;
const results = [];

async function check(label, fn) {
  let ok = false;
  let note = "";
  try {
    ok = (await fn()) === true;
    if (!ok) note = "returned false";
  } catch (error) {
    note = "threw: " + (error && error.message ? error.message : error);
  }
  if (!ok) failures++;
  results.push([ok, label, note]);
}

/* ------------------------------------------------------------------ */
/* The smallest DOM the drawing half needs.                            */

/*
 * Two factory methods and a node, because that is the entire surface
 * dashboard.js touches: createElement, createElementNS, appendChild,
 * setAttribute, className, classList.add, textContent. Anything larger
 * would be a second implementation of the DOM for the suite to be wrong
 * about.
 *
 * The attribute bag takes any name rather than a known list - the same
 * auto-vivifying idea as dev/form-wiring.test.mjs's element factory,
 * applied to attributes rather than to ids, so a geometry attribute this
 * harness never thought of is recorded instead of failing the setup for
 * a reason no check is about.
 *
 * Three behaviors here are load-bearing and are asserted below rather
 * than assumed: appendChild returns the child (dashboard.js writes the
 * label text onto its return value, `node.appendChild(svg(...))
 * .textContent = ...`), textContent descends into children when read
 * and clears them when written (render's first act is
 * `container.textContent = ""`), and classList.add composes with a
 * className already set.
 */
function makeNode(tagName, namespace) {
  const attributes = new Map();
  let own = "";
  return {
    tagName,
    namespace,
    children: [],
    attributes,
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    hasAttribute(name) { return attributes.has(name); },
    classList: {
      add(name) {
        const tokens = (attributes.get("class") || "").split(/\s+/)
          .filter(Boolean);
        if (!tokens.includes(name)) tokens.push(name);
        attributes.set("class", tokens.join(" "));
      },
    },
    get className() { return attributes.get("class") || ""; },
    set className(value) { attributes.set("class", String(value)); },
    get textContent() {
      return own + this.children.map(function (child) {
        return child.textContent;
      }).join("");
    },
    set textContent(value) {
      this.children.length = 0;
      own = String(value);
    },
  };
}

function makeDocument() {
  return {
    createElement(tag) { return makeNode(String(tag), HTML_NS); },
    createElementNS(ns, tag) { return makeNode(String(tag), String(ns)); },
  };
}

/* ------------------------------------------------------------------ */
/* Reading the tree.                                                   */

function walk(node, visit) {
  for (const child of node.children) {
    visit(child);
    walk(child, visit);
  }
}

function collect(node, predicate) {
  const out = [];
  walk(node, function (child) { if (predicate(child)) out.push(child); });
  return out;
}

const classesOf = (node) =>
  (node.getAttribute("class") || "").split(/\s+/).filter(Boolean);

const withClass = (node, name) =>
  collect(node, (child) => classesOf(child).includes(name));

const withTag = (node, tag) => collect(node, (child) => child.tagName === tag);

const captionOf = (figure) => {
  const first = figure.children[0];
  return first && first.tagName === "figcaption" ? first.textContent : null;
};

const figures = (container) =>
  container.children.filter((child) => child.tagName === "figure");

const figureNamed = (container, title) =>
  figures(container).find((child) => captionOf(child) === title) || null;

const captions = (container) => figures(container).map(captionOf);

/* The hint under a caption, which figure() adds only when given a note. */
const hintOf = (figure) => {
  const hint = figure.children.find((child) =>
    classesOf(child).includes("hint"));
  return hint ? hint.textContent : null;
};

/* The muted note emptyNote() appends in place of a chart. */
const emptyNotesOf = (figure) => figure.children
  .filter((child) => classesOf(child).includes("small"))
  .map((child) => child.textContent);

const textsOf = (nodes) => nodes.map((node) => node.textContent);

/* ------------------------------------------------------------------ */
/* Loading the shipped file, once per document state.                  */

async function load(withDocument) {
  if (withDocument) globalThis.document = makeDocument();
  else delete globalThis.document;
  // A fresh instance per load, so the two document states cannot be
  // reading each other's exports - the same data: URL trick
  // dev/form-wiring.test.mjs uses for listener isolation.
  await import("data:text/javascript," +
    encodeURIComponent(SOURCE) + "#" + Math.random());
  return globalThis.BinderDashboard;
}

const HEADLESS = await load(false);
const D = await load(true);

/*
 * One instance for every scenario below, which is safe here and would
 * not be in a wiring suite: the drawing half registers no listener and
 * holds no state between calls, and the document stub's two factories
 * are pure. Nothing accumulates for a later check to inherit.
 */
const draw = (snapshot, basis, units) => {
  const container = makeNode("div", HTML_NS);
  D.render(container, snapshot, basis, units);
  return container;
};

/*
 * A scenario is built at file scope so the checks that read it stay one
 * line each, and a throw at file scope would take the whole process down
 * before a single result printed - turning "render throws on a published
 * snapshot" into a suite that says nothing at all. So a throw is caught,
 * recorded, and answered with an empty container: the checks that were
 * going to read it fail on their own terms, and the last check in the
 * file names the exception. Found by mutation - three edits to
 * dashboard.js killed this file rather than reddening a named check.
 */
let sceneError = null;
const scene = (make) => {
  try {
    return make();
  } catch (error) {
    if (sceneError === null) sceneError = error;
    return makeNode("div", HTML_NS);
  }
};

/* ------------------------------------------------------------------ */
/* 0. The harness, attacked before anything leans on it.               */

await check("the stub's appendChild answers with the child, as the DOM does",
  () => {
    const parent = makeNode("div", HTML_NS);
    const child = makeNode("span", HTML_NS);
    return parent.appendChild(child) === child;
  });

await check("the stub's textContent descends into children when read", () => {
  const parent = makeNode("figure", HTML_NS);
  const child = makeNode("figcaption", HTML_NS);
  const grandchild = makeNode("em", HTML_NS);
  grandchild.textContent = "@buried";
  child.appendChild(grandchild);
  parent.appendChild(child);
  // The check that keeps "no handle reaches the published document"
  // from passing against a tree full of handles.
  return parent.textContent === "@buried";
});

await check("the stub's textContent clears children when written", () => {
  const parent = makeNode("div", HTML_NS);
  parent.appendChild(makeNode("p", HTML_NS));
  parent.textContent = "";
  return parent.children.length === 0;
});

await check("the stub's classList.add keeps a className already set", () => {
  const node = makeNode("figure", HTML_NS);
  node.className = "chart";
  node.classList.add("chart-wide");
  return node.className === "chart chart-wide";
});

await check("the stub keeps HTML and SVG nodes distinguishable", () => {
  const document = makeDocument();
  return document.createElement("div").namespace === HTML_NS &&
    document.createElementNS(SVG_NS, "rect").namespace === SVG_NS;
});

await check("the stub records an attribute it was never taught", () => {
  const node = makeNode("rect", SVG_NS);
  node.setAttribute("data-nothing-knows-this", 7);
  return node.getAttribute("data-nothing-knows-this") === "7" &&
    node.getAttribute("absent") === null;
});

/* ------------------------------------------------------------------ */
/* 1. The seam. Why this file is not part of dev/dashboard.test.mjs.   */

await check("loaded with no document the module exports no render", () =>
  typeof HEADLESS.summarise === "function" && HEADLESS.render === undefined);

await check("loaded with a document the module exports render", () =>
  typeof D.render === "function");

await check("the export is frozen on the side of the seam that draws", () =>
  // The half of the freeze rule this file is the only one able to see.
  // `render` is the sole member that exists on this side, so if the
  // module ever goes back to publishing a literal and bolting `render`
  // on afterwards, THIS is where it shows: a freeze at the assignment
  // would make that later line throw, and a freeze after it would leave
  // the headless path unfrozen. One object, every key it will ever have,
  // frozen once.
  Object.isFrozen(D) && Object.isFrozen(HEADLESS));

/* ------------------------------------------------------------------ */
/* The corpus. Twelve people, five of whom submitted twice.            */

/*
 * Both unit systems move together on every row, the way a real record
 * does. A fixture that changed only the kg would make every imperial
 * assertion below a statement about the fixture rather than about the
 * chart. The pairs are written out rather than computed: the conversion
 * lives in form.js exactly once, and a factor here would be a second
 * copy of it sitting in the suite that is meant to catch drift.
 */
const entry = (over) => Object.assign({
  id: 0, receivedAt: "2026-03-01T00:00:00.000Z",
  submittedAt: "2026-03-01T00:00:00.000Z",
  telegram: "someone", accountId: "acct-someone",
  kg: 90, lb: 198.4, cm: 175, totalInches: 68.9,
  gender: "male", roles: ["feedee"], country: "US",
  over18: true, recordVersion: 1,
}, over);

const BODIES = [
  { kg: 70, lb: 154.3, cm: 160, totalInches: 63.0 },
  { kg: 74, lb: 163.1, cm: 163, totalInches: 64.2 },
  { kg: 78, lb: 172.0, cm: 166, totalInches: 65.4 },
  { kg: 82, lb: 180.8, cm: 169, totalInches: 66.5 },
  { kg: 86, lb: 189.6, cm: 172, totalInches: 67.7 },
  { kg: 90, lb: 198.4, cm: 175, totalInches: 68.9 },
  { kg: 94, lb: 207.2, cm: 178, totalInches: 70.1 },
  { kg: 98, lb: 216.1, cm: 181, totalInches: 71.3 },
  { kg: 102, lb: 224.9, cm: 184, totalInches: 72.4 },
  { kg: 106, lb: 233.7, cm: 187, totalInches: 73.6 },
  { kg: 110, lb: 242.5, cm: 190, totalInches: 74.8 },
  { kg: 114, lb: 251.3, cm: 193, totalInches: 76.0 },
];

/* Seven male and five female, seven US and five GB, seven feedees and
   five feeders - so every published cell clears MIN_CELL and the
   breakdowns survive suppression. The scenarios where they do not are
   built separately and deliberately, below. */
const BASE = BODIES.map((body, index) => entry(Object.assign({
  id: index + 1,
  telegram: "member" + (index + 1),
  accountId: "acct-" + (index + 1),
  gender: index < 7 ? "male" : "female",
  country: index < 7 ? "US" : "GB",
  roles: index < 7 ? ["feedee"] : ["feeder"],
}, body)));

/*
 * The second rows. Five, because MIN_CELL is five and a published
 * snapshot drops the whole weight series below it (dashboard.js:910) -
 * so five is the smallest corpus where the published document and the
 * keyholder's own both carry one, which is what the pseudonym checks
 * need. Two of them carry the data-quality cases: a renamed handle on
 * one account, and a height that moved.
 */
const REPEATS = [
  entry({ id: 21, telegram: "member1", accountId: "acct-1",
    submittedAt: "2026-07-01T00:00:00.000Z",
    kg: 74, lb: 163.1, cm: 160, totalInches: 63.0,
    gender: "male", country: "US", roles: ["feedee"] }),
  entry({ id: 22, telegram: "member2new", accountId: "acct-2",
    submittedAt: "2026-07-01T00:00:00.000Z",
    kg: 78, lb: 172.0, cm: 163, totalInches: 64.2,
    gender: "male", country: "US", roles: ["feedee"] }),
  entry({ id: 23, telegram: "member3", accountId: "acct-3",
    submittedAt: "2026-07-01T00:00:00.000Z",
    kg: 82, lb: 180.8, cm: 175, totalInches: 68.9,
    gender: "male", country: "US", roles: ["feedee"] }),
  entry({ id: 24, telegram: "member4", accountId: "acct-4",
    submittedAt: "2026-07-01T00:00:00.000Z",
    kg: 86, lb: 189.6, cm: 169, totalInches: 66.5,
    gender: "male", country: "US", roles: ["feedee"] }),
  entry({ id: 25, telegram: "member5", accountId: "acct-5",
    submittedAt: "2026-07-01T00:00:00.000Z",
    kg: 90, lb: 198.4, cm: 172, totalInches: 67.7,
    gender: "male", country: "US", roles: ["feedee"] }),
];

const ENTRIES = BASE.concat(REPEATS);

const KEYHOLDER = D.snapshotOf(ENTRIES, { identify: true });
const PUBLISHED = D.snapshotOf(ENTRIES, { identify: false });

/* ------------------------------------------------------------------ */
/* 2. The shape of a drawn dashboard.                                  */

const KEY_PEOPLE = scene(() => draw(KEYHOLDER, "people", "imperial"));

await check("the panels are drawn in a fixed order, captions and all", () =>
  JSON.stringify(captions(KEY_PEOPLE)) === JSON.stringify([
    "Weight over time",
    "Accounts using more than one handle",
    "Heights that changed between entries",
    "Weight", "Height", "BMI", "Gender", "Feedism affiliations", "Country",
  ]));

await check("the stat strip comes first and is the only thing before them",
  () => {
    const first = KEY_PEOPLE.children[0];
    return first.tagName === "div" && first.className === "stats" &&
      KEY_PEOPLE.children.length === 10;
  });

await check("the strip carries the six figures in order", () =>
  JSON.stringify(textsOf(withClass(KEY_PEOPLE, "stat-label"))) ===
  JSON.stringify(["Entries", "People", "Median weight", "Median height",
    "Median BMI", "Mean weight"]));

await check("each stat is a label and a value in one cell", () => {
  const cells = withClass(KEY_PEOPLE, "stat");
  return cells.length === 6 && cells.every((cell) =>
    cell.children.length === 2 &&
    cell.children[0].tagName === "span" &&
    classesOf(cell.children[0]).includes("stat-label") &&
    cell.children[1].tagName === "strong" &&
    classesOf(cell.children[1]).includes("stat-value") &&
    classesOf(cell.children[1]).includes("tabular"));
});

await check("the counts on the strip are the snapshot's, not the basis's",
  () => {
    const values = textsOf(withClass(KEY_PEOPLE, "stat-value"));
    return values[0] === "17" && values[1] === "12";
  });

await check("a figure with a note carries it as a hint under the caption",
  () => hintOf(figureNamed(KEY_PEOPLE, "Weight over time")) ===
    "5 of 12 people have submitted more than once.");

/* theme.css lays a panel out through `.chart` and captions it through
   `.chart figcaption`, so a figure without the class is a caption and a
   chart stacked however the browser feels. */
await check("every panel is a figure carrying the chart class", () =>
  figures(KEY_PEOPLE).length === 9 &&
  figures(KEY_PEOPLE).every((panel) =>
    classesOf(panel).includes("chart") &&
    panel.children[0].tagName === "figcaption"));

await check("the wide panels are the time series and the two lists", () =>
  figures(KEY_PEOPLE).filter((f) => classesOf(f).includes("chart-wide"))
    .map(captionOf).join("|") ===
  "Weight over time|Accounts using more than one handle|" +
  "Heights that changed between entries");

/* ------------------------------------------------------------------ */
/* 3. Every chart is SVG, built through createElementNS.               */

/* Seven, not nine: the two data-quality panels are figures without a
   chart in them, because a list of handles is a list. */
await check("every chart root is an svg element in the SVG namespace", () => {
  const roots = withTag(KEY_PEOPLE, "svg");
  return roots.length === 7 &&
    roots.every((root) => root.namespace === SVG_NS);
});

/* A bar chart is as tall as it has rows - two categories at 26 apiece
   plus 8 - so a viewBox pinned to one number is also pinning that the
   canvas grew with the data instead of clipping it. */
await check("a chart root declares its viewBox, scaling and role", () => {
  const root = withTag(figureNamed(KEY_PEOPLE, "Gender"), "svg")[0];
  return root.getAttribute("viewBox") === "0 0 620 60" &&
    root.getAttribute("preserveAspectRatio") === "xMidYMid meet" &&
    root.getAttribute("role") === "img";
});

await check("every node inside a chart is in the SVG namespace too", () => {
  const roots = withTag(KEY_PEOPLE, "svg");
  return roots.every((root) =>
    collect(root, () => true).every((node) => node.namespace === SVG_NS));
});

/* ------------------------------------------------------------------ */
/* 4. The two contracts stated in comments and enforced by neither.    */

/*
 * dashboard.js:1157 says fill is left to `polyline.chart-series` in
 * theme.css "not here - a presentation attribute would lose to the
 * series color rule", and theme.css:915-923 says a filled polyline
 * joins its first and last points and paints the area between. Half of
 * that contract is in each file, and until now nothing held either.
 */
await check("a drawn polyline sets no fill attribute of its own", () => {
  const lines = withTag(KEY_PEOPLE, "polyline");
  return lines.length === 5 &&
    lines.every((line) => line.getAttribute("fill") === null);
});

await check("theme.css still declares the rule that unfills it", () =>
  /polyline\.chart-series\s*\{[^}]*fill\s*:\s*none/.test(THEME_CSS));

/*
 * admin.html's policy is `default-src 'none'; style-src 'self'`, with no
 * 'unsafe-inline'. A style attribute anywhere in this tree is dropped by
 * the browser and the chart renders in its defaults, so color has to
 * arrive as a class and geometry as a presentation attribute - which is
 * the first thing dashboard.js's own header says about itself.
 */
await check("nothing rendered carries a style attribute", () =>
  collect(KEY_PEOPLE, (node) => node.hasAttribute("style")).length === 0);

await check("no shape paints itself - fill and stroke are left to CSS", () =>
  collect(KEY_PEOPLE, (node) =>
    node.hasAttribute("fill") || node.hasAttribute("stroke")).length === 0);

/* ------------------------------------------------------------------ */
/* 5. Bar charts.                                                      */

await check("a bar chart draws a track and a bar for every category", () => {
  const gender = figureNamed(KEY_PEOPLE, "Gender");
  return withClass(gender, "chart-track").length === 2 &&
    withClass(gender, "chart-bar").length === 2 &&
    withClass(gender, "chart-label").length === 2;
});

await check("the track is full width and the bar is scaled to the biggest",
  () => {
    const gender = figureNamed(KEY_PEOPLE, "Gender");
    const track = withClass(gender, "chart-track")[0];
    const bars = withClass(gender, "chart-bar");
    // Seven of twelve against a track of 620 - 150 - 70.
    return track.getAttribute("width") === "400" &&
      bars[0].getAttribute("width") === "400" &&
      bars[1].getAttribute("width") === String((5 / 7) * 400);
  });

await check("a bar's value carries its share of the total", () =>
  JSON.stringify(textsOf(
    withClass(figureNamed(KEY_PEOPLE, "Gender"), "chart-value"))) ===
  JSON.stringify(["7 (58%)", "5 (42%)"]));

await check("the country panel is capped at twelve and says so only then",
  () => {
    const country = figureNamed(KEY_PEOPLE, "Country");
    return hintOf(country) === null &&
      withClass(country, "chart-bar").length === 2;
  });

/* ------------------------------------------------------------------ */
/* 6. Histograms.                                                      */

await check("a histogram draws one bar per bin, a baseline and the unit",
  () => {
    const weight = figureNamed(KEY_PEOPLE, "Weight");
    const labels = textsOf(withClass(weight, "chart-label"));
    return withClass(weight, "chart-bar").length === 5 &&
      withClass(weight, "chart-axis").length === 1 &&
      labels[labels.length - 1] === "lb";
  });

await check("a histogram's band is named in the caption's hint", () =>
  hintOf(figureNamed(KEY_PEOPLE, "Weight")) === "in 20 lb bands" &&
  hintOf(figureNamed(KEY_PEOPLE, "Height")) === "in 2 in bands");

await check("the BMI panel refuses to label the number it draws", () =>
  hintOf(figureNamed(KEY_PEOPLE, "BMI")) ===
  "Weight over height squared, and nothing more — the clinical " +
  "category labels are deliberately not shown.");

/*
 * Ten people spread over 200 lb with a gap in the middle: eleven bins,
 * more edges than a 620-wide axis can label without them colliding, and
 * one bin nobody is in. Both arms are decisions histogramChart makes
 * silently - a label every `Math.ceil(bins.length / 8)` bins, and no
 * number over an empty one - and a chart that got either wrong would
 * still look like a chart.
 */
const SPREAD = D.snapshotOf(
  [110, 130, 150, 170, 210, 230, 250, 270, 290, 310].map((lb, index) =>
    entry({
      id: 50 + index, telegram: "wide" + index, accountId: "acct-wide" + index,
      lb: lb,
      kg: [49.9, 59.0, 68.0, 77.1, 95.3, 104.3, 113.4, 122.5, 131.5,
        140.6][index],
      cm: 175, totalInches: 68.9,
    })), { identify: true });
const WIDE = scene(() => draw(SPREAD, "people", "imperial"));

await check("more bin edges than fit are labelled every other bin", () =>
  JSON.stringify(textsOf(withClass(figureNamed(WIDE, "Weight"),
    "chart-label"))) ===
  JSON.stringify(["100", "140", "180", "220", "260", "300", "lb"]));

await check("a bin nobody is in is drawn, and carries no number", () => {
  const weight = figureNamed(WIDE, "Weight");
  const bars = withClass(weight, "chart-bar");
  return bars.length === 11 &&
    withClass(weight, "chart-value").length === 10 &&
    bars[4].getAttribute("height") === "1" &&
    bars[0].getAttribute("height") === "156";
});

/* ------------------------------------------------------------------ */
/* 7. The empty corpus. Every "nothing to draw" arm at once.           */

const EMPTY = scene(() => draw(D.snapshotOf([], { identify: true }), "people", "imperial"));

await check("an empty corpus draws every panel rather than throwing", () =>
  captions(EMPTY).length === 7);

await check("an empty corpus writes an em dash, never a zero", () =>
  JSON.stringify(textsOf(withClass(EMPTY, "stat-value"))) ===
  JSON.stringify(["0", "0", "—", "—", "—", "—"]));

await check("each empty distribution says what is missing, in its own words",
  () => emptyNotesOf(figureNamed(EMPTY, "Weight"))[0] ===
    "No weights recorded." &&
    emptyNotesOf(figureNamed(EMPTY, "Height"))[0] ===
    "No heights recorded." &&
    emptyNotesOf(figureNamed(EMPTY, "BMI"))[0] ===
    "Not enough data to compute BMI.");

await check("an empty histogram is a note instead of a chart, not beside one",
  () => withTag(figureNamed(EMPTY, "Weight"), "svg").length === 0);

await check("a category counted zero times still gets a visible bar", () => {
  const roles = figureNamed(EMPTY, "Feedism affiliations");
  const bars = withClass(roles, "chart-bar");
  return bars.length === 4 && bars.every((bar) =>
    bar.getAttribute("width") === "1");
});

await check("with nothing counted a bar's value carries no percentage", () =>
  textsOf(withClass(figureNamed(EMPTY, "Feedism affiliations"),
    "chart-value")).join("|") === "0|0|0|0");

/* ------------------------------------------------------------------ */
/* 8. The weight series.                                               */

await check("a series draws a line, a dot per point and a label", () => {
  const time = figureNamed(KEY_PEOPLE, "Weight over time");
  return withTag(time, "polyline").length === 5 &&
    withClass(time, "chart-dot").length === 10 &&
    withClass(time, "chart-series-label").length === 5;
});

await check("each line takes the next series color", () =>
  withTag(figureNamed(KEY_PEOPLE, "Weight over time"), "polyline")
    .map((line) => line.getAttribute("class")).join("|") ===
  "chart-series series-0|chart-series series-1|chart-series series-2|" +
  "chart-series series-3|chart-series series-4");

await check("a line's points are a coordinate pair per entry", () => {
  const line = withTag(
    figureNamed(KEY_PEOPLE, "Weight over time"), "polyline")[0];
  const points = line.getAttribute("points").split(" ");
  return points.length === 2 &&
    points.every((point) => /^-?[\d.]+,-?[\d.]+$/.test(point));
});

await check("a line is captioned with the handle it belongs to", () =>
  textsOf(withClass(
    figureNamed(KEY_PEOPLE, "Weight over time"), "chart-series-label"))
    .join("|") === "@member1|@member2new|@member3|@member4|@member5");

await check("the axes and their two reference labels are drawn", () => {
  const time = figureNamed(KEY_PEOPLE, "Weight over time");
  const labels = textsOf(withClass(time, "chart-label"));
  return withClass(time, "chart-axis").length === 2 &&
    labels[0].endsWith("lb") && labels[1].endsWith("lb") &&
    labels[2] === "2026-03-01" && labels[3] === "2026-07-01";
});

/* A single flat line: every point the same weight on the same day. Both
   divide-by-zero guards (dashboard.js:1116-1117) fire at once, and the
   failure they prevent is silent - a points attribute full of NaN draws
   nothing and throws nothing. */
const FLAT_SNAPSHOT = D.snapshotOf([
  entry({ id: 31, telegram: "flat", accountId: "acct-flat",
    submittedAt: "2026-05-01T00:00:00.000Z" }),
  entry({ id: 32, telegram: "flat", accountId: "acct-flat",
    submittedAt: "2026-05-01T00:00:00.000Z" }),
], { identify: true });
const FLAT = scene(() => draw(FLAT_SNAPSHOT, "people", "imperial"));

await check("a series that never moves still plots real coordinates", () => {
  const line = withTag(figureNamed(FLAT, "Weight over time"), "polyline")[0];
  return !line.getAttribute("points").includes("NaN");
});

await check("a flat series is given a range to sit in", () => {
  const labels = textsOf(
    withClass(figureNamed(FLAT, "Weight over time"), "chart-label"));
  return labels[0] !== labels[1];
});

/*
 * Two people, one finishing at the right edge of the plot and one
 * finishing early. dashboard.js:1170-1172 says a line with no room to
 * its right takes its label the other way and lifted clear of the line,
 * and both arms decide only an anchor and an offset - so getting one
 * wrong writes a caption off the edge of the chart, where it renders
 * perfectly and is not there.
 */
const EDGES = scene(() => draw(D.snapshotOf([
  entry({ id: 61, telegram: "edgea", accountId: "acct-edgea",
    submittedAt: "2026-01-01T00:00:00.000Z", kg: 80, lb: 176.4 }),
  entry({ id: 62, telegram: "edgea", accountId: "acct-edgea",
    submittedAt: "2026-07-01T00:00:00.000Z", kg: 84, lb: 185.2 }),
  entry({ id: 63, telegram: "edgeb", accountId: "acct-edgeb",
    submittedAt: "2026-01-01T00:00:00.000Z", kg: 90, lb: 198.4 }),
  entry({ id: 64, telegram: "edgeb", accountId: "acct-edgeb",
    submittedAt: "2026-03-01T00:00:00.000Z", kg: 94, lb: 207.2 }),
], { identify: true }), "people", "imperial"));

await check("a caption at the right edge is anchored back into the chart",
  () => {
    const labels = withClass(
      figureNamed(EDGES, "Weight over time"), "chart-series-label");
    return textsOf(labels).join("|") === "@edgea|@edgeb" &&
      labels[0].getAttribute("text-anchor") === "end" &&
      labels[1].getAttribute("text-anchor") === "start";
  });

/* Thirteen repeat submitters, so the twelve-line cap and the six-color
   cycle are both crossed. */
const MANY = [];
for (let n = 1; n <= 13; n++) {
  const tag = "rep" + String(n).padStart(2, "0");
  MANY.push(entry({ id: 100 + n, telegram: tag, accountId: "many-" + n,
    kg: 80, lb: 176.4, cm: 170, totalInches: 66.9,
    submittedAt: "2026-01-01T00:00:00.000Z" }));
  MANY.push(entry({ id: 200 + n, telegram: tag, accountId: "many-" + n,
    kg: 84, lb: 185.2, cm: 170, totalInches: 66.9,
    submittedAt: "2026-06-01T00:00:00.000Z" }));
}
const CROWDED = scene(() => draw(
  D.snapshotOf(MANY, { identify: true }), "people", "imperial"));

await check("more lines than fit are cut to twelve and the cut is stated",
  () => {
    const time = figureNamed(CROWDED, "Weight over time");
    return withTag(time, "polyline").length === 12 &&
      emptyNotesOf(time)[0] === "Showing the 12 with the most entries.";
  });

await check("the thirteenth person is absent, not merely undrawn", () =>
  !CROWDED.textContent.includes("rep13"));

await check("the series colors cycle rather than running out", () => {
  const lines = withTag(figureNamed(CROWDED, "Weight over time"), "polyline");
  return lines[6].getAttribute("class") === "chart-series series-0" &&
    lines[11].getAttribute("class") === "chart-series series-5";
});

/* ------------------------------------------------------------------ */
/* 9. The data-quality panels, including #105's `|| []`.               */

await check("two handles on one account are listed, newest spelling first",
  () => {
    const panel = figureNamed(KEY_PEOPLE, "Accounts using more than one handle");
    const list = withClass(panel, "failure-list")[0];
    return list.tagName === "pre" && list.textContent === "@member2new, @member2";
  });

await check("a height that moved is listed in the units on screen", () => {
  const imperial = withClass(
    figureNamed(KEY_PEOPLE, "Heights that changed between entries"),
    "failure-list")[0].textContent;
  const metric = withClass(
    figureNamed(draw(KEYHOLDER, "people", "metric"),
      "Heights that changed between entries"),
    "failure-list")[0].textContent;
  return imperial === "@member3: 5'5\" to 5'9\"" &&
    metric === "@member3: 166cm to 175cm";
});

/*
 * The arm #105 added and nothing read. A snapshot written before the
 * handle panel existed has a quality object with no handleChanges in it,
 * and the `|| []` at dashboard.js:1282 is the whole of what keeps that
 * from throwing on `.length`. Building it by editing a real snapshot
 * rather than by hand, so it stays a real snapshot in every other way.
 */
const older = JSON.parse(JSON.stringify(KEYHOLDER));
delete older.quality.handleChanges;

await check("a snapshot with no handle-changes field draws the rest of the page",
  () => {
    const drawn = draw(older, "people", "imperial");
    return figureNamed(drawn, "Accounts using more than one handle") === null &&
      figureNamed(drawn, "Heights that changed between entries") !== null &&
      captions(drawn).length === 8;
  });

const unqualified = JSON.parse(JSON.stringify(KEYHOLDER));
delete unqualified.quality;

await check("a snapshot with no quality object at all draws the rest too",
  () => captions(draw(unqualified, "people", "imperial")).length === 7);

/* ------------------------------------------------------------------ */
/* 10. What the published document may not contain.                    */

const PUBLIC_PEOPLE = scene(() => draw(PUBLISHED, "people", "imperial"));

await check("a published snapshot carries no data-quality panel", () =>
  figureNamed(PUBLIC_PEOPLE, "Accounts using more than one handle") === null &&
  figureNamed(PUBLIC_PEOPLE, "Heights that changed between entries") === null &&
  withClass(PUBLIC_PEOPLE, "failure-list").length === 0);

await check("no handle survives into a published rendering", () =>
  !/@member/.test(PUBLIC_PEOPLE.textContent) &&
  !/@rep/.test(PUBLIC_PEOPLE.textContent));

await check("the published lines are captioned with pseudonyms instead", () =>
  textsOf(withClass(
    figureNamed(PUBLIC_PEOPLE, "Weight over time"), "chart-series-label"))
    .join("|") === "Person 1|Person 2|Person 3|Person 4|Person 5");

/* Fewer repeat submitters than MIN_CELL, from otherwise identical rows.
   dashboard.js:910 drops the whole panel rather than publishing four
   identifiable trajectories. */
const FEW = scene(() => draw(
  D.snapshotOf(BASE.concat(REPEATS.slice(0, 3)), { identify: false }),
  "people", "imperial"));

await check("too few lines to hide in publishes no time chart at all", () =>
  figureNamed(FEW, "Weight over time") === null &&
  figureNamed(draw(D.snapshotOf(BASE.concat(REPEATS.slice(0, 3)),
    { identify: true }), "people", "imperial"), "Weight over time") !== null);

await check("the published histogram is coarser than the keyholder's own",
  () => withClass(figureNamed(PUBLIC_PEOPLE, "Weight"), "chart-bar").length
    === 2 &&
    withClass(figureNamed(KEY_PEOPLE, "Weight"), "chart-bar").length === 5);

/* Six people in six countries. Every cell is one person, the pooled
   bucket cannot save it, and suppressCounts publishes nothing. */
const SCATTERED = D.snapshotOf(BODIES.slice(0, 6).map((body, index) =>
  entry(Object.assign({
    id: 40 + index, telegram: "far" + index, accountId: "acct-far" + index,
    country: ["US", "GB", "CA", "DE", "JP", "AU"][index],
  }, body))), { identify: false });
const SUPPRESSED = scene(() => draw(SCATTERED, "people", "imperial"));

await check("a breakdown suppressed to nothing draws a chart with no bars",
  () => {
    const country = figureNamed(SUPPRESSED, "Country");
    return withTag(country, "svg").length === 1 &&
      withClass(country, "chart-bar").length === 0 &&
      withClass(figureNamed(SUPPRESSED, "Gender"), "chart-bar").length === 1;
  });

/* Below the floor there is no breakdown at all, and saying so is the
   ordinary state of a new group rather than an error. */
const TOO_FEW = scene(() => draw(
  D.snapshotOf(BASE.slice(0, 3), { identify: false }), "people", "imperial"));

await check("a group too small to describe gets a sentence, not a blank page",
  () => TOO_FEW.children.length === 1 &&
    TOO_FEW.children[0].tagName === "p" &&
    TOO_FEW.children[0].className === "muted");

await check("that sentence names the floor the module actually enforces", () =>
  TOO_FEW.textContent.includes("at least " + D.MIN_CELL + ".") &&
  TOO_FEW.textContent.startsWith("There are too few entries here"));

await check("nothing else is drawn beside it", () =>
  withTag(TOO_FEW, "svg").length === 0 &&
  withClass(TOO_FEW, "stats").length === 0);

/* ------------------------------------------------------------------ */
/* 11. The two toggles, which decide what is read and never convert.   */

const KEY_ENTRIES = scene(() => draw(KEYHOLDER, "entries", "imperial"));

await check("the basis decides which rows the breakdowns count", () =>
  textsOf(withClass(figureNamed(KEY_ENTRIES, "Gender"), "chart-value"))
    .join("|") === "12 (71%)|5 (29%)");

await check("the strip's counts are the same on either basis", () =>
  JSON.stringify(textsOf(withClass(KEY_ENTRIES, "stat-value")).slice(0, 2)) ===
  JSON.stringify(["17", "12"]));

await check("an unrecognized basis falls back to one row per person", () =>
  textsOf(withClass(
    figureNamed(draw(KEYHOLDER, "everything", "imperial"), "Gender"),
    "chart-value")).join("|") === "7 (58%)|5 (42%)");

const KEY_METRIC = scene(() => draw(KEYHOLDER, "people", "metric"));

await check("the units decide which stored field is written down", () => {
  const imperial = textsOf(withClass(KEY_PEOPLE, "stat-value"));
  const metric = textsOf(withClass(KEY_METRIC, "stat-value"));
  return imperial[2].endsWith(" lb") && metric[2].endsWith(" kg") &&
    /^\d+'\d+"$/.test(imperial[3]) && metric[3].endsWith(" cm") &&
    imperial[5].endsWith(" lb") && metric[5].endsWith(" kg");
});

await check("BMI is the one figure the toggle does not touch", () => {
  const imperial = textsOf(withClass(KEY_PEOPLE, "stat-value"))[4];
  const metric = textsOf(withClass(KEY_METRIC, "stat-value"))[4];
  return imperial === metric && imperial !== "—";
});

await check("the histogram's unit corner and band move with the toggle", () => {
  const labels = textsOf(withClass(figureNamed(KEY_METRIC, "Height"),
    "chart-label"));
  return labels[labels.length - 1] === "cm" &&
    hintOf(figureNamed(KEY_METRIC, "Height")) === "in 5 cm bands";
});

await check("an unrecognized unit system falls back to imperial", () =>
  textsOf(withClass(draw(KEYHOLDER, "people", "furlongs"), "stat-value"))
    .join("|") === textsOf(withClass(KEY_PEOPLE, "stat-value")).join("|"));

/* ------------------------------------------------------------------ */
/* 12. Redrawing.                                                      */

/* Both consumers call render on every toggle change, into the container
   already holding the last drawing. */
await check("a redraw replaces what is there rather than adding to it", () => {
  const container = makeNode("div", HTML_NS);
  D.render(container, KEYHOLDER, "people", "imperial");
  const first = container.children.length;
  D.render(container, KEYHOLDER, "people", "metric");
  return first === 10 && container.children.length === 10;
});

await check("a redraw into a smaller state leaves nothing of the larger", () => {
  const container = makeNode("div", HTML_NS);
  D.render(container, KEYHOLDER, "people", "imperial");
  D.render(container, D.snapshotOf(BASE.slice(0, 3), { identify: false }),
    "people", "imperial");
  return container.children.length === 1 &&
    withTag(container, "svg").length === 0;
});

/* ------------------------------------------------------------------ */
/* 13. And nothing above threw on the way to being drawn.              */

/*
 * Last, because it is about the file rather than about the module: every
 * scenario built at file scope went through scene(), so this is the one
 * place an exception raised while drawing is reported instead of ending
 * the process. The checks that were going to read that scenario have
 * already failed on their own terms; this says what went wrong.
 */
await check("no scenario threw while drawing", () => sceneError === null ||
  (console.log("       " + (sceneError.stack || sceneError)), false));

/* ------------------------------------------------------------------ */

for (const [ok, label, note] of results) {
  console.log((ok ? "  ok   " : "  FAIL ") + label + (note ? " - " + note : ""));
}
console.log(
  failures === 0
    ? "\ndashboard.js drawing OK - " + results.length + " checks"
    : "\ndashboard.js drawing FAILED " + failures + " of " +
      results.length + " checks");

process.exit(failures === 0 ? 0 : 1);
