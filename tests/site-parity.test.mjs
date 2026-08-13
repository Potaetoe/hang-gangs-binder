/*
 * What apps/web ships today, measured against the spec it will read.
 *
 *     node tests/site-parity.test.mjs
 *
 * Subject: apps/site.config.js against apps/web - the pages' wordmarks,
 * titles and meta descriptions, favicon.svg's accessible name, form.js's
 * factors, limits and choices, dashboard.js's unit table, query.js's
 * splits, and your-page.html's own markup.
 *
 * A MEASUREMENT, NOT A DERIVATION, AND THAT IS THE POINT OF IT. 0.9-M0
 * adds the spec and changes not one byte of apps/web: the member pages
 * are rebuilt at 0.9-M2 and read the spec then (#278, and the fork
 * ruling on that ticket). Between now and then the two are two copies
 * of one set of facts, which is the condition this file exists for.
 * The day somebody moves a limit in form.js, renames a choice in
 * your-page.html, or spells the group's name a fifth way, this goes
 * red and names both sides.
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

await load("../apps/site.config.js");
await load("../apps/fields.js");
// The shipped modules, loaded as the bytes they ship as. dashboard.js
// before query.js: the query engine reads the floor and the unit table
// off BinderDashboard rather than carrying second copies, and says so
// in its own header.
await load("../apps/web/form.js");
await load("../apps/web/dashboard.js");
await load("../apps/web/query.js");

const F = globalThis.BinderFields;
const FORM = globalThis.BinderForm;
const DASH = globalThis.BinderDashboard;
const QUERY = globalThis.BinderQuery;

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

const EXPECTED = 21;
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
/* 2. The form's arithmetic and its choices.                           */

check("form.js's pound is the spec's pound",
  FORM.KG_PER_LB === F.factor("lb", "kg"));
check("form.js's inch is the spec's inch",
  FORM.CM_PER_IN === F.factor("in", "cm"));
check("form.js's limits are the spec's limits",
  same(FORM.LIMITS, F.limits()));
check("form.js's genders are the spec's gender choices",
  same(FORM.GENDERS, F.choiceValues("gender")));
check("form.js's affiliations are the spec's affiliation choices",
  same(FORM.ROLES, F.choiceValues("roles")));

/* ------------------------------------------------------------------ */
/* 3. The charts' half.                                                */

check("the dashboard's unit table is the spec's unit table",
  ["metric", "imperial"].every((system) =>
    ["weight", "height"].every((name) => {
      const there = DASH.UNITS[system][name];
      const here = F.measure(name).units[system];
      return there.field === here.store && there.suffix === here.unit &&
        there.bin === here.bin && there.band === here.band;
    })));

check("the dashboard starts in the unit system the spec starts in",
  DASH.DEFAULT_UNITS === F.defaultSystem());

// Compared as a set. The key order in query.js is neither the spec's
// nor the picker's - your-page.html offers weight, height, BMI,
// gender, country, affiliations - so pinning an order here would pin
// one nothing else keeps.
check("the query engine's splits are the spec's measures",
  same([...Object.keys(QUERY.SPLITS)].sort(), [...F.splitNames()].sort()));

check("every split carries the spec's shape and its sentence form",
  Object.entries(QUERY.SPLITS).every(([name, split]) =>
    split.kind === F.measure(name).kind &&
    split.unitful === F.measure(name).unitful &&
    split.label === F.measure(name).term));

/* ------------------------------------------------------------------ */
/* 4. The page that asks the questions.                                */

const yourPage = pages["your-page.html"];

// A computed field is not asked for, which is what makes it computed.
// The three spellings are the three this page uses: an id for a single
// control, `data-field` for a field spread over more than one input,
// and `name` for a group of checkboxes.
check("your-page.html still asks for every field the spec declares",
  F.names().filter((name) => F.field(name).kind !== "computed")
    .every((name) => yourPage.includes('id="' + name + '"') ||
      yourPage.includes('data-field="' + name + '"') ||
      yourPage.includes('name="' + name + '"')));

check("your-page.html still labels the measured fields as the spec does",
  ["weight", "height"].every((name) =>
    yourPage.includes(">" + F.labels()[name] + "</label>")));

check("your-page.html still offers every choice the spec declares",
  ["gender", "roles"].every((name) =>
    F.measure(name).choices.every((choice) =>
      yourPage.includes('value="' + choice.value + '"') &&
      yourPage.includes(">" + choice.label + "<"))));

console.log(failures
  ? `\nsite-parity FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\nsite-parity ran ${performed} checks, expected ${EXPECTED}`
    : `\nsite-parity OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
