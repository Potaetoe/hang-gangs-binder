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

/*
 * #182: the multi-select panel prints a count and no share.
 *
 * Roles are multi-select, so twelve people produce more than twelve
 * selections and there is no denominator a percentage could be taken
 * against - the published page printed `Other (fewer than 5) - 9 (180%)`
 * and a reader concluded the site cannot add up. The counts were right
 * the whole time; the share had nothing to be a share of.
 *
 * Both surfaces, and deliberately: this is arithmetic rather than
 * disclosure, so there is no `identify` distinction to make. The gender
 * arm above is the other direction - a single-select breakdown DOES sum
 * to the basis, and its share still prints.
 */
await check("the multi-select panel prints counts and no share", () =>
  textsOf(withClass(
    figureNamed(KEY_PEOPLE, "Feedism affiliations"), "chart-value"))
    .join("|") === "7|5|0|0");

await check("the multi-select caption says why there is no share", () =>
  hintOf(figureNamed(KEY_PEOPLE, "Feedism affiliations")) ===
  "Multi-select, so these do not add up to the number of entries — " +
  "which is why no share is shown beside them.");

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

/* The multi-select panel carries no share on any corpus - see the pair
   of arms in section 5. This is the zero case, and on its own it proves
   nothing: a total of nothing suppresses a percentage all by itself, so
   this line stays green whatever the share rule is. The arms in section
   5 are what hold it; this one holds the edge they do not reach. */
await check("with nothing counted a bar's value is still a bare count", () =>
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

/* ------------------------------------------------------------------ */
/* 10a. A withheld thing says it was withheld - #177, #180.            */

/*
 * THE RULE, AND WHERE IT ALREADY LIVED. movementText() answers a
 * movement too few people drove with a sentence rather than a blank,
 * because a blank reads as "nothing changed" - a different claim, and a
 * false one. The weight series, the suppressed breakdowns and the
 * collapsed histograms never had that rule applied: they rendered as an
 * absent panel, a heading over nothing, and a full-width solid bar, all
 * three of which a member reads as breakage rather than as protection.
 *
 * WHAT DECIDES. The DOCUMENT, through its own `identified` flag, and not
 * which entry point is drawing. `identified` is the floor's own switch -
 * snapshotOf sets `floor = identify ? 0 : MIN_CELL` from it - so a
 * sentence about suppression is a fact about the data rather than about
 * the surface. Gating on render-versus-renderProgress instead would give
 * the two surfaces DIFFERENT panel sequences for one document, which is
 * the seam section 13 pins shut.
 *
 * WHAT THE SENTENCES MAY NOT DO. None of them may carry a number. The
 * count, the size of the cell, and how close it came to the floor are
 * exactly what the floor is holding back, and a chatty explanation would
 * publish in prose what suppression withheld in figures. They are
 * written out here rather than read off the module, because a check that
 * reads the copy it is checking cannot fail when the copy is deleted.
 */
const WITHHELD =
  "Too few people to show this without describing individual people.";
const SERIES_WITHHELD = "Too few people have more than one entry to " +
  "show this without identifying them.";
const ONE_BAND =
  "Everybody here falls in a single band, so there is no shape to show.";

/* The literals above hold no digit, which on its own is a statement
   about this file. What makes it a statement about the module is that
   every panel below is compared against them for equality, and the
   rendered sweep at the end of this section reads the drawn text. */
await check("the sentences these arms pin carry no digit", () =>
  [WITHHELD, SERIES_WITHHELD, ONE_BAND].every((line) => !/\d/.test(line)));

/* Fewer repeat submitters than MIN_CELL, from otherwise identical rows.
   snapshotOf drops the whole series rather than publishing four
   identifiable trajectories. */
const FEW_ROWS = BASE.concat(REPEATS.slice(0, 3));
const FEW = scene(() => draw(
  D.snapshotOf(FEW_ROWS, { identify: false }), "people", "imperial"));

await check("too few lines to hide in publishes no chart, and says so",
  () => {
    // The panel stays. What changes is that it holds a sentence instead
    // of a line chart: an absent panel and a panel about nothing that
    // happened are indistinguishable, and only one of them is true.
    const time = figureNamed(FEW, "Weight over time");
    return time !== null && withTag(time, "svg").length === 0 &&
      emptyNotesOf(time)[0] === SERIES_WITHHELD;
  });

await check("the withheld series names no count and no repeat submitter",
  () => {
    const time = figureNamed(FEW, "Weight over time");
    return !/\d/.test(time.textContent) && !/@/.test(time.textContent);
  });

await check("a series left out unasked is silent, not withheld", () =>
  // The other kind of null. The keyholder who never ticked the box is
  // not owed an explanation of a floor that was never reached, and a
  // sentence there would be the page apologizing for a choice.
  figureNamed(draw(D.snapshotOf(FEW_ROWS,
    { identify: false, series: false }), "people", "imperial"),
  "Weight over time") === null);

await check("the keyholder's own view of the same rows draws the lines",
  () => {
    const own = draw(
      D.snapshotOf(FEW_ROWS, { identify: true }), "people", "imperial");
    const time = figureNamed(own, "Weight over time");
    return withTag(time, "polyline").length === 3 &&
      !own.textContent.includes("Too few people");
  });

await check("the published histogram is coarser than the keyholder's own",
  () => withClass(figureNamed(PUBLIC_PEOPLE, "Weight"), "chart-bar").length
    === 2 &&
    withClass(figureNamed(KEY_PEOPLE, "Weight"), "chart-bar").length === 5);

/* Six people in six countries, spread across all four roles. Every cell
   is one or two people, the pooled bucket cannot save either breakdown,
   and suppressCounts publishes nothing for them. Gender is left uniform
   on purpose: one cell of six clears the floor, so the same scenario
   shows a breakdown that survives beside two that do not. */
const SCATTERED = D.snapshotOf(BODIES.slice(0, 6).map((body, index) =>
  entry(Object.assign({
    id: 40 + index, telegram: "far" + index, accountId: "acct-far" + index,
    country: ["US", "GB", "CA", "DE", "JP", "AU"][index],
    roles: [["feedee"], ["feedee"], ["feeder"], ["feeder"], ["gainer"],
      ["admirer"]][index],
  }, body))), { identify: false });
const SUPPRESSED = scene(() => draw(SCATTERED, "people", "imperial"));

await check("a breakdown suppressed to nothing says so instead of drawing",
  () => {
    // A bar chart with no bars in it is a heading over a blank region,
    // which is #180 exactly: the floor working and the page unable to
    // say so, so a member reads protection as a fault.
    const country = figureNamed(SUPPRESSED, "Country");
    return withTag(country, "svg").length === 0 &&
      emptyNotesOf(country)[0] === WITHHELD &&
      withClass(figureNamed(SUPPRESSED, "Gender"), "chart-bar").length === 1;
  });

await check("a suppressed breakdown's caption goes with its chart", () => {
  // "Multi-select, so these do not add up" over a panel holding nothing
  // describes a drawing that is not there - the same rule the band
  // caption obeys, and the roles panel is where it shows, because it is
  // the only breakdown carrying a caption on every corpus.
  const roles = figureNamed(SUPPRESSED, "Feedism affiliations");
  return hintOf(roles) === null && emptyNotesOf(roles)[0] === WITHHELD &&
    hintOf(figureNamed(KEY_PEOPLE, "Feedism affiliations")) !== null;
});

/*
 * Five people spread over three 20 lb bands, none of which holds five.
 * suppressBins merges adjacent bands until each clears the floor, so all
 * three become one - and drawn, that is a single bar filling the whole
 * chart area under a caption still promising 20 lb bands.
 */
const ONE_BIN_ROWS = BODIES.slice(0, 5).map((body, index) =>
  entry(Object.assign({
    id: 70 + index, telegram: "band" + index, accountId: "acct-band" + index,
  }, body)));
const COLLAPSED = scene(() => draw(
  D.snapshotOf(ONE_BIN_ROWS, { identify: false }), "people", "imperial"));

await check("a histogram collapsed to one band is not drawn as one bar",
  () => {
    const weight = figureNamed(COLLAPSED, "Weight");
    return withTag(weight, "svg").length === 0 &&
      emptyNotesOf(weight)[0] === ONE_BAND;
  });

await check("the band caption goes with the bar it was describing", () =>
  // "in 20 lb bands" over a picture that has no bands is the page
  // describing something it did not draw, which is the half of #180
  // that survives even if the bar is kept.
  hintOf(figureNamed(COLLAPSED, "Weight")) === null &&
  hintOf(figureNamed(COLLAPSED, "Height")) === null);

await check("the same collapse on the keyholder's own view still draws",
  () => {
    // The instrument has no floor, so nothing merged and there is a real
    // distribution to show. The sentence is about the published
    // document, and the published document is the only place it appears.
    const own = draw(
      D.snapshotOf(ONE_BIN_ROWS, { identify: true }), "people", "imperial");
    const weight = figureNamed(own, "Weight");
    return withClass(weight, "chart-bar").length === 3 &&
      hintOf(weight) === "in 20 lb bands" &&
      !own.textContent.includes("Everybody here");
  });

/* Five people, two of whom recorded a weight. The bins hold two between
   them, which is under the floor, so suppressBins publishes none at all
   - and "No weights recorded." is then a false sentence as well as an
   unhelpful one. */
const THIN_ROWS = ONE_BIN_ROWS.map((row, index) => index < 3
  ? Object.assign({}, row, { kg: null, lb: null })
  : row);
const THIN = scene(() => draw(
  D.snapshotOf(THIN_ROWS, { identify: false }), "people", "imperial"));

await check("a distribution suppressed to nothing is not called unrecorded",
  () => emptyNotesOf(figureNamed(THIN, "Weight"))[0] === WITHHELD &&
    // And its band caption goes too, for the same reason the collapsed
    // one's does - plus the caption is where the digit would be.
    hintOf(figureNamed(THIN, "Weight")) === null);

await check("the keyholder still sees the two weights that were recorded",
  () => {
    // The floor is what emptied this panel, not the data. Reading the
    // same rows without one draws them, which is the evidence that "No
    // weights recorded." would have been a false sentence rather than
    // an unhelpful one.
    const own = draw(
      D.snapshotOf(THIN_ROWS, { identify: true }), "people", "imperial");
    return withClass(figureNamed(own, "Weight"), "chart-bar").length > 0;
  });

/*
 * THE ARM THAT KEEPS THE INSTRUMENT AN INSTRUMENT - #73's ruling.
 *
 * admin.html draws `snapshotOf(entries, { identify: true })` and nothing
 * else, so no sentence about a floor may reach it. This is checked at
 * the rule rather than at the call site: every scenario the keyholder's
 * own view produces is swept for all three sentences at once, so making
 * snapshotOf set the withheld flag under `identify` - or making a panel
 * say "too few" without consulting the document - reddens THIS line
 * rather than passing because two functions happened to be called in
 * the right places.
 */
/*
 * THE WALL, READ OFF WHAT WAS DRAWN. Every panel a floored document
 * replaced with a sentence is swept for a digit, in the rendered text
 * rather than in the constant - so a sentence rewritten to name the
 * count, the cell size or how close it came to the floor reddens here
 * even if the arms above were updated to match it. That is the whole
 * reason these panels exist: publishing the number in prose would undo
 * the floor that removed it from the figures.
 */
const REPLACED_PANELS = [
  figureNamed(FEW, "Weight over time"),
  figureNamed(SUPPRESSED, "Country"),
  figureNamed(COLLAPSED, "Weight"),
  figureNamed(COLLAPSED, "Height"),
  figureNamed(THIN, "Weight"),
];

await check("nothing a suppression sentence replaced carries a digit", () =>
  REPLACED_PANELS.length === 5 &&
  REPLACED_PANELS.every((panel) => panel !== null &&
    emptyNotesOf(panel).length === 1 && !/\d/.test(panel.textContent)));

const IDENTIFIED_VIEWS = [KEY_PEOPLE, EMPTY, WIDE, CROWDED, FLAT, EDGES]
  .concat([FEW_ROWS, ONE_BIN_ROWS, THIN_ROWS, BASE.slice(0, 3)].map((rows) =>
    scene(() => draw(
      D.snapshotOf(rows, { identify: true }), "people", "imperial"))));

await check("no suppression sentence reaches the identified instrument",
  () => IDENTIFIED_VIEWS.length === 10 && IDENTIFIED_VIEWS.every(
    (container) => [WITHHELD, SERIES_WITHHELD, ONE_BAND].every(
      (line) => !container.textContent.includes(line))));

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
/* 13. The per-surface split, and the hero only one surface draws.     */

/*
 * ONE DRAWING BODY, TWO ENTRY POINTS. dashboard.js draws admin.html and
 * dashboard.html from the same code, which is what stops the member
 * numbers from ever disagreeing with the keyholder's. The hero belongs
 * to Progress alone - it is a member-facing payoff, and the admin page
 * is an instrument - so the split had to happen somewhere. It happens at
 * the entry point: `render` is the instrument's, `renderProgress` is
 * Progress's, and everything below the first child is one function
 * called by both. Two copies of the panel sequence is the failure mode
 * this shape exists to refuse, so section 2's order pins above are the
 * admin arm and the pins here are the Progress arm - the same assertions
 * per surface, never a relaxation to "something may come first".
 *
 * THE SEAM IS PINNED FOR BOTH NAMES. `renderProgress` is exported under
 * the same document guard as `render`, so the two checks that make this
 * file exist - no document, no drawing half; a document, a drawing half -
 * have to be made about it too. A seam pinned for one name and not the
 * other is a seam with a hole the shape of the newer name.
 */

await check("loaded with no document the module exports no Progress arm", () =>
  HEADLESS.renderProgress === undefined);

await check("loaded with a document the module exports the Progress arm", () =>
  typeof D.renderProgress === "function");

await check("both entry points are frozen onto one published object", () =>
  // The whole reason the conditional sits above the freeze rather than
  // below it. A second name bolted on after the publish would leave the
  // object every page holds a reference to editable for as long as the
  // module runs.
  Object.isFrozen(D) && Object.isFrozen(HEADLESS) &&
  Object.getOwnPropertyDescriptor(D, "renderProgress").writable === false);

const drawProgress = (snapshot, basis, units) => {
  const container = makeNode("div", HTML_NS);
  D.renderProgress(container, snapshot, basis, units);
  return container;
};

/* A prior document to move against: the same twelve people, five kg
   lighter each, published a month earlier. Twelve movers clears
   MIN_CELL, so the movement is a number rather than a refusal. */
const EARLIER_ROWS = BODIES.map((body, index) => entry(Object.assign({
  id: index + 1, telegram: "member" + (index + 1),
  accountId: "acct-" + (index + 1),
  submittedAt: "2026-01-01T00:00:00.000Z",
  gender: index < 7 ? "male" : "female",
  country: index < 7 ? "US" : "GB",
  roles: index < 7 ? ["feedee"] : ["feeder"],
}, body, { kg: body.kg - 5, lb: body.lb - 11 })));

const EARLIER = D.snapshotOf(EARLIER_ROWS, { identify: false },
  Date.parse("2026-02-01T00:00:00.000Z"));

const MOVED = D.snapshotOf(ENTRIES, { identify: false, previous: EARLIER },
  Date.parse("2026-08-01T00:00:00.000Z"));

const PROGRESS = scene(() => drawProgress(MOVED, "people", "imperial"));

const heroOf = (container) =>
  container.children.find((child) => classesOf(child).includes("hero")) || null;

const heroPart = (container, name) => {
  const hero = heroOf(container);
  if (!hero) return null;
  const part = withClass(hero, name)[0];
  return part ? part.textContent : null;
};

await check("Progress leads with the hero and the strip comes second", () => {
  const first = PROGRESS.children[0];
  const second = PROGRESS.children[1];
  return classesOf(first).includes("hero") &&
    second.tagName === "div" && second.className === "stats";
});

/* The same document drawn through the other entry point. Comparing the
   two surfaces on ONE snapshot is the comparison worth making: anything
   else is comparing two documents and calling the difference a
   surface. */
const AS_INSTRUMENT = scene(() => draw(MOVED, "people", "imperial"));

await check("the panels below the hero are the instrument's, in order", () =>
  // The split may move what comes FIRST and nothing else. A drifting
  // second copy of this sequence is what a duplicated drawing body would
  // eventually produce, and the copy that drifts is the one nobody
  // drives.
  JSON.stringify(captions(PROGRESS)) ===
    JSON.stringify(captions(AS_INSTRUMENT)) &&
  PROGRESS.children.length === AS_INSTRUMENT.children.length + 1 &&
  heroOf(AS_INSTRUMENT) === null);

await check("the instrument still leads with the strip and nothing else", () =>
  // The other arm of the same pin, restated here so a future edit that
  // gives the hero to both surfaces fails on this line rather than on a
  // count somebody adjusts.
  heroOf(KEY_PEOPLE) === null &&
  KEY_PEOPLE.children[0].className === "stats");

await check("the hero carries the group's combined weight in the unit shown",
  () => heroPart(PROGRESS, "hero-value") ===
    D.statText(MOVED.bases.people.imperial.weight.total,
      D.unitsFor("imperial").weight));

await check("the hero's number follows the units toggle without converting",
  () => heroPart(drawProgress(MOVED, "people", "metric"), "hero-value") ===
    D.statText(MOVED.bases.people.metric.weight.total,
      D.unitsFor("metric").weight));

await check("the hero's number follows the basis toggle", () =>
  heroPart(drawProgress(MOVED, "entries", "imperial"), "hero-value") ===
    D.statText(MOVED.bases.entries.imperial.weight.total,
      D.unitsFor("imperial").weight));

await check("the movement is drawn with its direction and its anchor date",
  () => {
    const text = heroPart(PROGRESS, "hero-delta");
    return text.startsWith("+") && text.includes(" lb ") &&
      text.includes(EARLIER.generated.slice(0, 10));
  });

await check("a movement downward is signed, not described", () => {
  // Which direction is good is not this page's opinion to hold. It
  // reports the sign and the date and stops there - a group whose
  // combined weight fell is told so in the same words as one whose rose.
  const down = D.snapshotOf(
    ENTRIES.concat(EARLIER_ROWS.map((row, i) => Object.assign({}, row, {
      id: 300 + i, submittedAt: "2026-08-15T00:00:00.000Z",
    }))),
    { identify: false, previous: MOVED },
    Date.parse("2026-09-01T00:00:00.000Z"));
  return heroPart(drawProgress(down, "people", "imperial"), "hero-delta")
    .startsWith("−");
});

await check("a movement too few people drove is said, not silently dropped",
  () => {
    // The owner's ruling: a delta driven by fewer members than the floor
    // renders as too-few-to-say, never as a number. A blank would read
    // as "nothing changed", which is a different and false claim.
    const oneMover = D.snapshotOf(
      ENTRIES.concat([entry({ id: 99, telegram: "member1",
        accountId: "acct-1", submittedAt: "2026-08-15T00:00:00.000Z",
        kg: 120, lb: 264.6 })]),
      { identify: false, previous: MOVED },
      Date.parse("2026-09-01T00:00:00.000Z"));
    const text = heroPart(drawProgress(oneMover, "people", "imperial"),
      "hero-delta");
    return oneMover.movement.bases === null &&
      text.includes("Too few") && !/\d/.test(text.replace(/\d{4}-\d\d-\d\d/, ""));
  });

await check("a document with nothing before it draws the hero and no movement",
  () => {
    const container = drawProgress(PUBLISHED, "people", "imperial");
    return heroOf(container) !== null &&
      heroPart(container, "hero-delta") === null;
  });

await check("a document published before any of this still draws", () => {
  // The live document for the whole interval between deploying this and
  // the keyholder's next publish. It has no movement field and no
  // combined weight, and it is already public.
  const old = JSON.parse(JSON.stringify(PUBLISHED));
  delete old.movement;
  for (const basis of ["people", "entries"]) {
    for (const system of ["imperial", "metric"]) {
      delete old.bases[basis][system].weight.total;
    }
  }
  const container = drawProgress(old, "people", "imperial");
  return captions(container).length === captions(PROGRESS).length &&
    heroOf(container) === null;
});

await check("a group too small to describe gets no hero either", () =>
  // The hero is a group figure and the group is below the floor. A
  // combined weight over four people beside a sentence explaining that
  // four people cannot be described would be the page arguing with
  // itself.
  heroOf(drawProgress(
    D.snapshotOf(BASE.slice(0, 3), { identify: false }), "people",
    "imperial")) === null);

await check("the hero paints through classes, like everything else here", () =>
  // theme.css styles this; a style attribute would be dropped by
  // dashboard.html's `style-src 'self'` and the hero would arrive naked.
  collect(PROGRESS, (node) => node.hasAttribute("style")).length === 0 &&
  classesOf(heroOf(PROGRESS)).includes("hero"));

/*
 * The member's own page, which is the surface all of section 10a is
 * about. It is a separate arm rather than a repeat: dashboard.html calls
 * renderProgress and nothing else, so a suppression sentence that
 * reached only `render` would be invisible to every member and green in
 * every check above.
 */
const PROGRESS_FEW = scene(() => drawProgress(
  D.snapshotOf(FEW_ROWS, { identify: false }), "people", "imperial"));

await check("Progress carries the same suppression sentences", () => {
  const time = figureNamed(PROGRESS_FEW, "Weight over time");
  return emptyNotesOf(time)[0] === SERIES_WITHHELD;
});

await check("a floored document draws the same panels on both surfaces", () =>
  // The seam this file pins is that the split may move what comes FIRST
  // and nothing else. Gating the sentences on the surface rather than on
  // the document would have given Progress a panel the instrument omits,
  // which is a widened seam wearing a bug fix's clothes.
  JSON.stringify(captions(PROGRESS_FEW)) ===
    JSON.stringify(captions(FEW)) &&
  PROGRESS_FEW.children.length === FEW.children.length + 1);

await check("a Progress redraw replaces the hero rather than stacking them",
  () => {
    const container = makeNode("div", HTML_NS);
    D.renderProgress(container, MOVED, "people", "imperial");
    D.renderProgress(container, MOVED, "people", "metric");
    return withClass(container, "hero").length === 1;
  });

/* ------------------------------------------------------------------ */
/* 14. #85's question card - the query engine's answers, drawn.        */

/*
 * WHY THE REAL ENGINE AND NOT A HAND-WRITTEN ANSWER. renderAnswer draws
 * whatever apps/web/query.js hands back, and an answer literal written
 * here would be this file's idea of that shape rather than the shape.
 * The two files would then agree with each other and with nothing else,
 * which is precisely how a drawing function keeps an arm for a `kind`
 * the engine stopped emitting - and how it loses the arm for one the
 * engine started. So every answer below comes out of the shipped module,
 * run against the same corpus the checks above read.
 *
 * THE SEAM IS PINNED FOR THIS NAME TOO. Three drawing names now hang off
 * one conditional and one freeze. A seam pinned for two of them is a
 * seam with a hole the shape of the third, and the hole is the same one
 * either way: a name exported under Node throws on its first `document`,
 * and a name attached after the publish leaves the object every page
 * holds a reference to editable for as long as the module runs.
 */

const QUERY_SOURCE = await readFile(
  new URL("../apps/web/query.js", import.meta.url), "utf8");
await import("data:text/javascript," + encodeURIComponent(QUERY_SOURCE) +
  "#" + Math.random());
const Q = globalThis.BinderQuery;

/*
 * Six people in three genders of two each: the smallest corpus where the
 * basis itself is publishable and one split inside it is not.
 * suppressCounts pools all three cells, the pool clears the floor, and
 * no named cell is left to stand beside it - so the document carries an
 * EMPTY gender breakdown rather than a suppressed one. That is the case
 * an empty chart would report as "nobody is anything", and it is
 * indistinguishable from a chart that never drew.
 */
const SPARSE = ["male", "male", "female", "female", "nonbinary", "nonbinary"]
  .map((gender, index) => entry(Object.assign({
    id: 40 + index, telegram: "sparse" + index,
    accountId: "acct-sparse-" + index, gender,
  }, BODIES[index])));

const ASKABLE = Q.publishedSource(PUBLISHED);
const ASKABLE_SPARSE = Q.publishedSource(
  D.snapshotOf(SPARSE, { identify: false }));
const ASKABLE_TINY = Q.publishedSource(
  D.snapshotOf(BASE.slice(0, 3), { identify: false }));

const asked = (source, query) => {
  const container = makeNode("div", HTML_NS);
  D.renderAnswer(container, Q.run(source, query), Q.describe(query));
  return container;
};

await check("loaded with no document the module exports no answer arm", () =>
  HEADLESS.renderAnswer === undefined);

await check("loaded with a document the module exports the answer arm", () =>
  typeof D.renderAnswer === "function");

await check("the answer arm is frozen onto the same published object", () => {
  const own = Object.getOwnPropertyDescriptor(D, "renderAnswer");
  return own.writable === false && own.configurable === false;
});

await check("a categorical answer is one captioned figure with a bar per cell",
  () => {
    const query = { basis: "people", split: "gender" };
    const cells = Q.run(ASKABLE, query).cells;
    const container = asked(ASKABLE, query);
    const drawn = figures(container);
    return container.children.length === 1 && drawn.length === 1 &&
      captionOf(drawn[0]) === "How many people, by gender" &&
      withClass(drawn[0], "chart-bar").length === cells.length &&
      JSON.stringify(textsOf(withClass(drawn[0], "chart-label"))) ===
        JSON.stringify(cells.map((cell) => cell.label));
  });

await check("a widened histogram draws the engine's bands, not the document's",
  () => {
    // The check that says renderAnswer draws the ANSWER. Reading the
    // snapshot's own bins instead would look identical at widen 1 and
    // would quietly ignore every coarsening a member asked for.
    const plain = { basis: "people", split: "weight", units: "metric" };
    const wide = Object.assign({ widen: 3 }, plain);
    const narrow = Q.run(ASKABLE, plain);
    const combined = Q.run(ASKABLE, wide);
    return combined.cells.length < narrow.cells.length &&
      withClass(asked(ASKABLE, wide), "chart-bar").length ===
        combined.cells.length &&
      withClass(asked(ASKABLE, plain), "chart-bar").length ===
        narrow.cells.length;
  });

await check("a merged answer draws the group under the name it was given",
  () => {
    const query = { basis: "people", split: "country",
      merge: [{ as: "Anglosphere", labels: ["US", "GB"] }] };
    const labels = textsOf(withClass(asked(ASKABLE, query), "chart-label"));
    return labels.includes("Anglosphere") &&
      !labels.includes("US") && !labels.includes("GB");
  });

await check("a middle is one stat cell carrying its unit, not a chart", () => {
  const query = { basis: "people", split: "weight", units: "imperial",
    measure: "median" };
  const container = asked(ASKABLE, query);
  const cells = withClass(container, "stat");
  return captionOf(figures(container)[0]) ===
      "The median weight across people (imperial)" &&
    withClass(container, "chart-bar").length === 0 &&
    cells.length === 1 && cells[0].children[0].textContent === "Median" &&
    cells[0].children[1].textContent ===
      D.statText(Q.run(ASKABLE, query).value, D.unitsFor("imperial").weight) &&
    /lb$/.test(cells[0].children[1].textContent);
});

await check("a BMI middle is written bare, because BMI has no unit", () => {
  // The strip beside it writes the median BMI the same way. A suffixed
  // BMI would be a number claiming to be a weight.
  const query = { basis: "people", split: "bmi", measure: "mean" };
  const value = Q.run(ASKABLE, query).value;
  const cells = withClass(asked(ASKABLE, query), "stat");
  return typeof value === "number" &&
    cells[0].children[1].textContent === String(value) &&
    !/[a-z]/.test(cells[0].children[1].textContent);
});

await check("an answer over a basis below the floor says so rather than blank",
  () => {
    // Three people. The engine reports available:false because basisOf
    // published no breakdown at all, and the page's whole answer has to
    // be the sentence - a figure with nothing in it reads as broken.
    const container = asked(ASKABLE_TINY, { basis: "people", split: "gender" });
    const drawn = figures(container)[0];
    return Q.run(ASKABLE_TINY, { basis: "people", split: "gender" })
        .available === false &&
      withClass(container, "chart-bar").length === 0 &&
      emptyNotesOf(drawn).length === 1 &&
      /too few entries here/.test(emptyNotesOf(drawn)[0]) &&
      emptyNotesOf(drawn)[0].includes("at least 5");
  });

await check("an answer the floor emptied says so, and names the order", () => {
  // available:true and no cells: the basis was publishable and this one
  // split inside it was not. The sentence has to say that the floor ran
  // BEFORE any combining, or a member reads the empty answer as an
  // invitation to widen their way past it.
  const query = { basis: "people", split: "gender" };
  const result = Q.run(ASKABLE_SPARSE, query);
  const drawn = figures(asked(ASKABLE_SPARSE, query))[0];
  return result.available === true && result.cells.length === 0 &&
    withClass(drawn, "chart-bar").length === 0 &&
    emptyNotesOf(drawn).length === 1 &&
    /before anything here is combined/.test(emptyNotesOf(drawn)[0]);
});

await check("the same document still answers a split the floor did not empty",
  () =>
    // The other half of the check above: an empty gender breakdown is a
    // fact about gender in that document, not a page that stopped
    // drawing.
    withClass(asked(ASKABLE_SPARSE, { basis: "people", split: "country" }),
      "chart-bar").length === 1);

await check("every published answer carries the floor in its own words", () =>
  ["gender", "country", "roles", "bmi", "weight", "height"].every((split) => {
    const hint = hintOf(figures(asked(ASKABLE, { basis: "people", split }))[0]);
    return hint !== null && hint.includes("smaller than 5") &&
      hint.includes("only adds them up");
  }));

await check("the floor sentence is the source's, not a number in this file",
  () => {
    // The one arm that would survive MIN_CELL moving and still be wrong.
    // renderAnswer reads answer.floor, which run() reads off the source,
    // which publishedSource reads off dashboard.js - so a floor of five
    // in the sentence is five because the module says so.
    const hint = hintOf(figures(asked(ASKABLE, { basis: "people",
      split: "gender" }))[0]);
    return hint.includes("smaller than " + D.MIN_CELL);
  });

await check("an answer redraw replaces the figure rather than stacking them",
  () => {
    const container = makeNode("div", HTML_NS);
    const first = { basis: "people", split: "gender" };
    const second = { basis: "entries", split: "country" };
    D.renderAnswer(container, Q.run(ASKABLE, first), Q.describe(first));
    D.renderAnswer(container, Q.run(ASKABLE, second), Q.describe(second));
    return container.children.length === 1 &&
      captionOf(figures(container)[0]) === "How many entries, by country";
  });

await check("nothing an answer draws paints itself or carries a style", () =>
  // The same two contracts every panel above obeys: dashboard.html's
  // `style-src 'self'` would drop a style attribute on the floor, and a
  // shape that fills itself cannot be themed.
  ["gender", "weight", "bmi"].every((split) => {
    const container = asked(ASKABLE, { basis: "people", split });
    return collect(container, (node) => node.hasAttribute("style"))
        .length === 0 &&
      collect(container, (node) => node.hasAttribute("fill") ||
        node.hasAttribute("stroke")).length === 0;
  }));

await check("an answer names no member, on any split this engine offers", () =>
  // The published document carries no handles at all, and the question
  // card cannot conjure one - but this is the assertion that would fail
  // if a later slice pointed the card at a keyholder snapshot, which has
  // the same shape and none of the properties.
  Object.keys(Q.SPLITS).every((split) =>
    ["people", "entries"].every((basis) =>
      !/@|member\d|acct-/.test(
        asked(ASKABLE, { basis, split }).textContent))));

/* ------------------------------------------------------------------ */
/* 15. And nothing above threw on the way to being drawn.              */

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
