/*
 * What apps/web ships, measured against the spec it reads or is
 * measured against, page by page.
 *
 *     node tests/site-parity.test.mjs
 *
 * Subject: apps/web/site.config.js against apps/web - the pages'
 * wordmarks, titles and meta descriptions, favicon.svg's accessible
 * name, dashboard.js's unit table, query.js's splits.
 *
 * TWO KINDS OF CLAIM LIVE IN THIS FILE NOW, AND SECTION 2 IS WHERE THEY
 * SPLIT. Sections 1 and 3 are still A MEASUREMENT, NOT A DERIVATION:
 * admin.html, charts.html and index.html do not read the spec yet (0.9-M3
 * and 0.9-M2-S3 rebuild the ones that do), so dashboard.js and query.js
 * are two copies of one set of facts and this file is what keeps a
 * hand-moved limit or a renamed choice from drifting silently. Section 2
 * used to measure form.js and your-page.html the same way; 0.9-M2-S2
 * (#353) rebuilt both to READ apps/web/fields.js directly, so "does
 * form.js's hand-kept KG_PER_LB equal the spec's" stopped being an
 * honest question - form.js has no hand-kept constant left to compare.
 * What replaced it proves the derivation is REAL rather than trivial: a
 * scratch spec with different bounds and choices is handed to form.js's
 * own plan()/validate(), and the assertion is that its answers move with
 * the scratch spec rather than staying pinned to the shipped one -
 * tests/your-page.test.mjs is the file that owns the shipped-spec
 * rendering claim now, section 1 of its own header explains the split.
 *
 * WHAT IT DOES NOT DO IS EDIT THOSE PAGES, or the checks that already
 * pin them. The old apparatus keeps its own wordmark and label pins
 * exactly as they are and retires with the surfaces they describe;
 * this stands beside them and answers a question they cannot ask,
 * which is whether the pages agree with the CONFIG.
 *
 * THE ROSTERS ARE PINNED HERE rather than counted from whatever they
 * find. Four pages carry the wordmark; three say whose binder this is
 * in prose. Counting the copies it discovers would make a page that
 * silently lost its mark or its sentence a page this arm happily agrees
 * with - the failure those pins exist to catch is subtraction, and a
 * count derived from the tree cannot see it. Both rosters are written
 * out for that reason and not only the first: the sentence check was a
 * `.every` over the matches it found, and `.every` on no matches is
 * true, so deleting a meta description outright went green.
 *
 * The same reach problem, one file extension over: this arm reads the
 * *.html pages, and favicon.svg carries a thirteenth copy of the name
 * as the accessible label a screen reader announces for the tab's icon.
 * A rename that reached every page and not that attribute leaves the
 * icon announcing a group that no longer exists, so it is read here
 * too - read, never edited, like everything else under apps/web.
 *
 * The runner at the bottom is local for the reason tests/site-spec.
 * test.mjs gives: 0.9-M0-S4 adopts these files by moving them.
 */
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (path) => readFile(HERE(path), "utf8");
const load = async (path) => {
  await import("data:text/javascript," +
    encodeURIComponent(await read(path)));
};

await load("../apps/web/site.config.js");
await load("../apps/web/fields.js");
// The shipped modules, loaded as the bytes they ship as. dashboard.js
// and query.js are gone (0.9-M2-S3, #354, with the snapshot route
// they read) - form.js is the one shipped module left this file has
// anything to measure.
await load("../apps/web/form.js");

const SITE = globalThis.BINDER_SITE;
const F = globalThis.BinderFields;
const FORM = globalThis.BinderForm;

const WEB = HERE("../apps/web");
const pages = {};
for (const name of (await readdir(WEB)).filter((n) => n.endsWith(".html"))) {
  pages[name] = await readFile(WEB + "/" + name, "utf8");
}

// The pages that carry the mark over the door. Pinned; see the header.
const WORDMARK_PAGES = ["admin.html", "charts.html", "index.html",
  "your-page.html"];

/*
 * How many times each page says whose binder this is, in prose. Pinned
 * for the same reason and stated for EVERY page including the two that
 * say it no times: a bare list of the pages that have a sentence could
 * not tell "admin.html never had one" from "admin.html just lost one",
 * and a page appearing here that this arm did not find at all is the
 * subtraction case in its loudest form - the whole map is compared, so
 * a page gaining a sentence, losing one, or arriving new is red.
 */
const POSSESSIVE_SENTENCES = {
  "404.html": 1,
  "admin.html": 0,
  "charts.html": 0,
  "index.html": 1,
  "your-page.html": 1,
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const line = (text, part) => {
  const found = new RegExp(
    '<span class="wordmark-' + part + '">([^<]*)</span>').exec(text);
  return found ? found[1] : null;
};
const title = (text) => {
  const found = /<title[^>]*>([^<]*)<\/title>/.exec(text);
  return found ? found[1] : null;
};

const EXPECTED = 13;
let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) failures += 1;
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

/* ------------------------------------------------------------------ */
/* 1. The group's name, against every hand-kept copy of it.            */

const [owner, binder] = F.wordmarkLines();

check("every page that should carry the wordmark still has one",
  WORDMARK_PAGES.every((name) => pages[name] &&
    pages[name].includes('class="wordmark')));

check("no other page has grown one",
  Object.keys(pages).filter((name) => pages[name].includes('class="wordmark'))
    .sort().join(",") === WORDMARK_PAGES.join(","));

check("every wordmark's first line is the group the config names",
  WORDMARK_PAGES.every((name) => line(pages[name], "owner") === owner));

check("every wordmark's second line is what the config calls the site",
  WORDMARK_PAGES.every((name) => line(pages[name], "name") === binder));

check("every page has a title",
  Object.keys(pages).every((name) => title(pages[name])));

check("every page's title ends in the site title the config derives",
  Object.keys(pages).every((name) =>
    title(pages[name]).endsWith(" — " + F.siteTitle())));

/*
 * The sentences, which are the copies a wordmark arm cannot see: the
 * meta descriptions say whose binder this is in prose, and a rename
 * that reached the mark and not the sentence leaves a page describing
 * a group that no longer exists to anyone who reads a search result.
 */
const POSSESSIVE = /([A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*)*)'s [Bb]inder/g;
check("every sentence naming whose binder this is names the config's group",
  Object.keys(pages).every((name) =>
    [...pages[name].matchAll(POSSESSIVE)]
      .every((found) => found[1] === owner)));

// The subtraction half of the same question. The check above asks what
// the sentences say; this one asks that they are still there to say it,
// which is the failure the pin above exists for - a page whose meta
// description quietly loses the sentence answers the first check with
// an empty list, and an empty list satisfies `.every`.
const possessives = {};
Object.keys(pages).sort().forEach((name) => {
  possessives[name] = [...pages[name].matchAll(POSSESSIVE)].length;
});
check("every page still says whose binder this is as often as it did",
  same(possessives, POSSESSIVE_SENTENCES));

/*
 * The favicon's accessible name: the copy of the group's name that is
 * an attribute in an SVG rather than text in a page, announced by a
 * screen reader for the tab's icon and read by nothing else in this
 * arm. Extracted rather than pattern-matched so that REMOVING the
 * attribute is red too - a missing aria-label is a decorative icon
 * where a named one shipped.
 */
const favicon = await read("../apps/web/favicon.svg");
const faviconName = /<svg[^>]*aria-label="([^"]*)"/.exec(favicon);
check("the favicon's accessible name is the config's group and site",
  faviconName !== null && faviconName[1] === owner + "'s " + binder);

/* ------------------------------------------------------------------ */
/* 2. form.js's rendering and validation really derive from the spec -  */
/*    proved by handing it a spec that disagrees with the shipped one   */
/*    and watching its answers move, not by comparing two readings of   */
/*    the same file (which a hardcoded constant would also pass).       */

const RESHAPED = Object.freeze({
  ...SITE,
  fields: SITE.fields.map((field) => field.name !== "gender" ? field
    : Object.freeze({ ...field, blank: "Not answering",
      choices: Object.freeze([{ value: "x", label: "X" }]) })),
  units: {
    ...SITE.units,
    kinds: {
      ...SITE.units.kinds,
      weight: { ...SITE.units.kinds.weight,
        units: { ...SITE.units.kinds.weight.units,
          lb: { ...SITE.units.kinds.weight.units.lb, min: 1, max: 2 } } },
    },
  },
});

check("form.js's weight bound moves with a spec that changes it",
  FORM.plan(RESHAPED).find((e) => e.name === "weight")
    .units.imperial.limits.max === 2 &&
  FORM.plan().find((e) => e.name === "weight").units.imperial.limits.max
    === F.limits().lb.max);

check("form.js's choice list moves with a spec that changes it",
  same(FORM.plan(RESHAPED).find((e) => e.name === "gender").choices,
    [{ value: "x", label: "X" }]) &&
  same(FORM.plan().find((e) => e.name === "gender").choices,
    SITE.fields.find((f) => f.name === "gender").choices));

check("validate() enforces whichever spec it is given, not a bound baked " +
  "into form.js - 1.5 lb is within RESHAPED's 1-2 lb bound and far below " +
  "the shipped spec's 44 lb floor, so it tells the two apart",
  (() => {
    const input = { units: "imperial", values: { over18: true,
      weight: "1.5", height: "5", heightCompound: "10", gender: "male",
      roles: [], country: "" } };
    const underShipped = FORM.validate(input, "member")
      .some((p) => p.field === "weight");
    const okReshaped = !FORM.validate(input, "member", RESHAPED)
      .some((p) => p.field === "weight");
    return underShipped && okReshaped;
  })());

/*
 * RETIRED (0.9-M2-S3, #354): "3. The charts' half" stood here, four
 * checks measuring apps/web/dashboard.js's unit table and apps/web/
 * query.js's splits against apps/site.config.js - "the dashboard's
 * unit table is the spec's unit table", "the dashboard starts in the
 * unit system the spec starts in", "the query engine's splits are the
 * spec's measures", "every split carries the spec's shape and its
 * sentence form". Both files are gone with the snapshot route they
 * read. apps/web/charts.js reads apps/fields.js directly now - there
 * is no second copy of the unit table or the measure list left to
 * measure against the spec, which is the property tests/site-
 * propagation.test.mjs already covers for the derivation itself.
 */

/*
 * 4. The page that asks the questions - RETIRED as a markup grep.
 *
 * your-page.html no longer carries a hand-kept field list to grep: its
 * fields are rendered at runtime by form.js's renderFields(), reading
 * apps/web/fields.js exactly as section 2 above just proved. Asking
 * whether the SHIPPED HTML mentions 'id="weight"' would be asking about
 * bytes this page no longer ships - the field markup does not exist
 * until a browser runs the script - so the honest version of this
 * question is "does your-page.html load the two files it renders from,
 * in an order that works", which is what is left of it.
 */
check("your-page.html loads the spec before the reader that renders it, " +
  "and both before form.js",
  (() => {
    const order = [...pages["your-page.html"]
      .matchAll(/<script src="([^"]+)">/g)]
      .map((m) => m[1]);
    const at = (name) => order.indexOf(name);
    return at("site.config.js") !== -1 && at("fields.js") !== -1 &&
      at("form.js") !== -1 &&
      at("site.config.js") < at("form.js") && at("fields.js") < at("form.js");
  })());

console.log(failures
  ? `\nsite-parity FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\nsite-parity ran ${performed} checks, expected ${EXPECTED}`
    : `\nsite-parity OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
