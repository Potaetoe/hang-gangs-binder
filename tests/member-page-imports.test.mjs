/*
 * No member page loads a client-seal module, and the one page that
 * still does is named here with the line that ends it - 0.9-M2-S5
 * (#356).
 *
 *     node tests/member-page-imports.test.mjs
 *
 * Subject: which scripts each page in apps/web (and its built copy in
 * dist) actually loads, plus the two seal modules themselves as files
 * on disk.
 *
 * WHY A STRUCTURAL ARM RATHER THAN A REVIEWER'S EYE. DESIGN.md's
 * "Trust model: the Worker reads" retired client-side encryption
 * outright, and 0.9-M2-S2, S3 and S4 rebuilt the member pages without
 * it. Nothing in the rest of this repository then says a page may not
 * load `crypto.js` again: tools/check_web.py pins the markup a page
 * carries and where its scripts sit, and has no opinion about which
 * ones. So a page copied from an open tab, or a script run pasted back
 * during a merge, re-introduces the seal with every stage of both gates
 * green. That is the regression this file exists to name.
 *
 * THE REMAINDER IS DECLARED, NOT INFERRED - AGENTS.md's review-bar
 * corollary ("a check computed entirely from the file it guards cannot
 * detect that the file was rearranged"). Pre-0.9 `admin.html` still
 * imports `crypto.js` and admin.js still opens rows with it, so the
 * file cannot die in this slice; deleting it would ship a broken page
 * instead of an honest remainder. ALLOWED below is that exemption
 * written down outside every file it describes, with the condition
 * that retires it, and section 3 fails if the exemption stops being
 * used - an allowance for a load that is no longer there is a row a
 * later reader cannot tell from a live one.
 *
 * THE PAGE SET IS DERIVED AND THE EXEMPTION IS PINNED, in that
 * combination on purpose. A hand-kept list of member pages cannot fail
 * when a page is ADDED, and a page being added is exactly when a copied
 * script run arrives; a derived exemption would be no exemption at all.
 *
 * WHAT EACH SECTION PROVES:
 *
 *   1. memberkey.js is gone from the source tree and from dist. It had
 *      no consumer left at all - no page loaded it once your-page.html
 *      stopped sealing - so nothing here survives it.
 *   2. No page outside ALLOWED loads a seal module, in apps/web and in
 *      dist alike. dist is checked separately rather than trusted to
 *      follow, because it is committed and a hand edit there is exactly
 *      the shape ./run build's byte-compare is the other half of.
 *   3. The declared remainder is real: admin.html does load crypto.js,
 *      and crypto.js is on disk for it to load.
 *   4. No member page's own scripts reach for a seal namespace. A page
 *      that names `BinderCrypto` without loading the module captures
 *      undefined and goes quiet, which is the failure mode
 *      tools/check_web.py's ordering rule describes; here it is the
 *      earlier question of whether the name belongs on the page at all.
 */
import { readFile, readdir, access } from "node:fs/promises";
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

async function present(path) {
  try {
    await access(HERE(path));
    return true;
  } catch (error) {
    return false;
  }
}

/*
 * The modules the client seal was made of, named as the files a page
 * loads rather than as the namespaces they publish - a page imports a
 * path, and the path is what a copied script run carries.
 */
const SEAL_MODULES = ["crypto.js", "memberkey.js"];

/* The namespaces those two published, for section 4. */
const SEAL_NAMESPACES = ["BinderCrypto", "BinderMemberKey"];

/*
 * The remainder, with the condition that retires it (AGENTS.md, "How
 * documentation is written here", rule 5). 0.9-M3 rebuilds the admin
 * pages; the slice that replaces admin.html deletes apps/web/crypto.js,
 * dev/crypto.test.mjs and its fixtures, and removes this table with
 * them - at which point section 2 judges every page in the tree and
 * section 3 has nothing left to hold honest.
 */
const ALLOWED = {
  "admin.html": ["crypto.js"],
};

/*
 * Comments stripped before any script tag is read. A commented-out tag
 * is not a loaded script, and every page here carries a long comment
 * beside its run explaining the order - dev/check_web.test.py found the
 * same trap from the other direction, where a reader that counted a
 * commented tag called an unwired page wired.
 */
function scriptSources(html) {
  const live = html.replace(/<!--[\s\S]*?-->/g, "");
  const sources = [];
  const tag = /<script\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let match = tag.exec(live);
  while (match) {
    sources.push((match[2] === undefined ? match[3] : match[2]).trim());
    match = tag.exec(live);
  }
  return sources;
}

async function pagesIn(directory) {
  const names = (await readdir(HERE(directory)))
    .filter((name) => name.endsWith(".html"))
    .sort();
  const pages = [];
  for (const name of names) {
    pages.push([name, await read(directory + "/" + name)]);
  }
  return pages;
}

const SOURCE_PAGES = await pagesIn("../apps/web");
const BUILT_PAGES = await pagesIn("../dist");

/* ------------------------------------------------------------------ */
/* 1. memberkey.js is gone, both trees.                               */

check("apps/web/memberkey.js is gone - no page loaded it",
  !(await present("../apps/web/memberkey.js")));
check("and dist carries no built copy of it",
  !(await present("../dist/memberkey.js")));

/* The page set is worth an arm of its own: a walk that found nothing
   would pass every arm below by describing no page at all. */
check("the walk found the pages it is judging",
  SOURCE_PAGES.length >= 4 &&
  SOURCE_PAGES.length === BUILT_PAGES.length &&
  SOURCE_PAGES.map(([name]) => name).join(",") ===
    BUILT_PAGES.map(([name]) => name).join(","));

/* ------------------------------------------------------------------ */
/* 2. No page outside the declared remainder loads a seal module.     */

function sealLoads(pages) {
  const found = [];
  for (const [name, html] of pages) {
    const allowed = ALLOWED[name] || [];
    for (const source of scriptSources(html)) {
      if (SEAL_MODULES.includes(source) && !allowed.includes(source)) {
        found.push(name + " loads " + source);
      }
    }
  }
  return found;
}

check("no page in apps/web loads a seal module it is not declared for",
  sealLoads(SOURCE_PAGES).length === 0);
check("and no page in dist does either",
  sealLoads(BUILT_PAGES).length === 0);

/* The three member pages, asked by name as well. The derived arms above
   pass over a page that is not there; these fail if one goes missing,
   which is the direction a rename would otherwise slip through. */
for (const name of ["index.html", "your-page.html", "charts.html"]) {
  const page = SOURCE_PAGES.find(([found]) => found === name);
  check(name + " is present and loads no seal module at all",
    Boolean(page) &&
    scriptSources(page[1]).every((source) =>
      !SEAL_MODULES.includes(source)));
}

/* ------------------------------------------------------------------ */
/* 3. The declared remainder is real, in both directions.             */

for (const [name, modules] of Object.entries(ALLOWED)) {
  const page = SOURCE_PAGES.find(([found]) => found === name);
  check("the remainder names " + name + ", which is a page in this tree",
    Boolean(page));
  for (const module of modules) {
    check(name + " really loads " + module + " - an allowance for a " +
      "load that is gone is a row to delete",
      Boolean(page) && scriptSources(page[1]).includes(module));
    check("and apps/web/" + module + " is on disk for it to load",
      await present("../apps/web/" + module));
  }
}

/* ------------------------------------------------------------------ */
/* 4. No member page's scripts reach for a seal namespace.            */

/*
 * Read from the pages' own runs rather than from a list of files, so a
 * script added to a member page is judged the moment it is added. The
 * prefixed spelling is what tools/check_web.py's own capture rule uses
 * and for the same reason: these names appear in prose, and judging a
 * page against a sentence is a false failure that looks like a real one.
 */
const WEB = "../apps/web/";
for (const [name, html] of SOURCE_PAGES) {
  if (ALLOWED[name]) continue;
  const scripts = scriptSources(html)
    .filter((source) => source.endsWith(".js") && !source.includes("/"));
  const reaching = [];
  for (const source of scripts) {
    if (!(await present(WEB + source))) continue;
    const js = await read(WEB + source);
    for (const namespace of SEAL_NAMESPACES) {
      if (new RegExp(
        "(globalThis|window|root|self)\\s*\\.\\s*" + namespace + "\\b")
        .test(js)) {
        reaching.push(name + ": " + source + " reads " + namespace);
      }
    }
  }
  check(name + " loads no script that reads a seal namespace",
    reaching.length === 0);
}

/* ------------------------------------------------------------------ */

const EXPECTED = 15;
console.log(failures
  ? `\nmember-page-imports FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\nmember-page-imports ran ${performed} checks, expected ${EXPECTED}`
    : `\nmember-page-imports OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
