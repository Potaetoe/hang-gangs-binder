/*
 * Build the published site: apps/web with the comments taken out.
 *
 *     node tools/build_web.mjs            write dist/
 *     node tools/build_web.mjs --check    verify dist/ and change nothing
 *
 * Issue #181. apps/web is the source a person reads and edits, comments
 * and all; dist/ is the byte stream a visitor downloads. theme.css is
 * 20,610 B gzipped and 4,589 B of that is CSS - the design record was
 * being shipped to every visitor, on every page, at four times the
 * weight of everything the per-surface split (#160) could have saved.
 *
 * WHY THIS IS NOT THE THING DESIGN.md REFUSES
 * -------------------------------------------
 * DESIGN.md's test for tooling is whether it can change what ships
 * WITHOUT THE REPOSITORY NOTICING. This cannot:
 *
 *  - dist/ is committed, so what ships is in the diff a reviewer reads.
 *  - --check regenerates from source and byte-compares, so a source
 *    edited without a rebuild and an artifact edited by hand are the
 *    same failure and neither can reach a release.
 *  - the token arm below proves the only difference is comments, so
 *    this cannot quietly grow into a minifier.
 *
 * It refuses a release rather than producing one that nobody checked,
 * which is the property that test was written to protect.
 *
 * WHY ACORN RATHER THAN A REGULAR EXPRESSION
 * ------------------------------------------
 * A `/*` inside a string or a regex literal is not a comment, and a
 * scanner that thinks it is deletes live code and ships it. Whether a
 * `/` opens a regex or divides depends on everything before it, which
 * is a parser's job and not a pattern's. This file therefore has one
 * third-party dependency, at build time only: nothing from node_modules
 * is ever published, and DESIGN.md's rule about third-party code is
 * positional - nothing third-party where plaintext is in reach - which
 * a tool that never runs in a browser cannot violate.
 *
 * WHITESPACE IS LEFT ALONE, AND THAT IS DELIBERATE
 * ------------------------------------------------
 * A comment becomes a newline if it spanned one and a space otherwise;
 * nothing else moves. Not even the blank lines it leaves behind.
 *
 * Trimming them was the first version and it is unsafe: a template
 * literal can hold trailing spaces and blank lines that are part of the
 * string, so a tidy-up pass that cannot see token boundaries changes
 * what a page renders. The newline rule is not cosmetic either - a
 * comment carrying a line terminator ends a statement under automatic
 * semicolon insertion, so `return /*\n*\/ 5` means `return;` and
 * deleting the comment outright would change it to `return 5`.
 *
 * Blank lines cost almost nothing compressed, which is the only size
 * that matters here, and leaving them is what keeps dist/ diffable
 * against apps/web by eye - the scope wall on #181.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync,
         statSync, existsSync } from "node:fs";
import { join, extname, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const acorn = require("acorn");

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, "..");
export const SOURCE = join(REPO, "apps", "web");
export const OUTPUT = join(REPO, "dist");

// Classic scripts, the same shape eslint.config.js pins for apps/web:
// an `import` or `export` in one of these is a parse error rather than a
// file that silently stops defining its global.
const PARSE = { ecmaVersion: 2022, sourceType: "script" };

/* One comment's replacement: a newline if it spanned one, else a space.
   Never nothing - see the automatic-semicolon-insertion note above, and
   `a/*x*\/b` in a CSS selector list, which is two selectors. */
const filler = (text) => (text.includes("\n") ? "\n" : " ");

/* Comment-free JavaScript, with every other byte where it was. */
export function stripJs(text) {
  const found = [];
  acorn.parse(text, { ...PARSE,
    onComment: (_block, _value, start, end) => found.push([start, end]) });

  let out = "";
  let at = 0;
  for (const [start, end] of found) {
    out += text.slice(at, start) + filler(text.slice(start, end));
    at = end;
  }
  return out + text.slice(at);
}

/* Comment-free CSS. Hand-scanned rather than parsed: CSS comments do not
   nest and cannot open inside a string, so the only thing this has to
   get right is not reading a `/*` that sits inside one. */
export function stripCss(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === "/*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      out += filler(text.slice(i, stop));
      i = stop;
      continue;
    }
    if (text[i] === '"' || text[i] === "'") {
      const quote = text[i];
      let j = i + 1;
      while (j < text.length && text[j] !== quote) {
        j += text[j] === "\\" ? 2 : 1;
      }
      out += text.slice(i, Math.min(j + 1, text.length));
      i = j + 1;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out;
}

/*
 * What a JavaScript file says, with everything a comment could hide
 * removed: the token stream, in order, as types and values.
 *
 * This is the arm that keeps the generator honest, and it is deliberately
 * computed WITHOUT the generator - it reads the two files and compares
 * them. Byte-comparing dist/ against a fresh build only proves the build
 * is repeatable; it says nothing about what the build does, so a
 * generator taught to rename a variable would pass it every time. Two
 * files with the same token stream differ in comments and whitespace and
 * in nothing else, which is the scope wall #181 sets.
 */
export function jsTokens(text) {
  const out = [];
  for (const token of acorn.tokenizer(text, PARSE)) {
    out.push(token.type.label + "\0" + String(token.value));
  }
  return out;
}

/* The same question for CSS, which has no tokenizer here: what is left
   after comments and after every run of whitespace becomes one space. */
export function cssShape(text) {
  return stripCss(text).replace(/\s+/g, " ").trim();
}

/*
 * What happens to each file, by extension.
 *
 * "text" is a line-ending normalization and nothing else - #181 rules on
 * CSS and JS, so the HTML pages keep every comment they have.
 *
 * WHY NORMALIZING IS NOT OPTIONAL, and it cost a rebase to find out.
 * .gitattributes stores this repository as LF and hands Windows working
 * copies CRLF, but git only rewrites a working file whose blob changed -
 * so after a rebase this tree held apps/web/countries.js in CRLF beside
 * a dist/countries.js that had just been checked out in LF. A generator
 * that copies whatever bytes it happens to read then produces an
 * artifact that fails its own byte-compare, on a machine where nothing
 * is actually wrong, and commits identically anyway because git
 * normalizes on the way in. That is a check that cries wolf, and a check
 * nobody believes is worse than one that is absent.
 *
 * So the build reads text as text and writes LF, which is what the
 * repository stores and therefore what a fresh checkout of dist/ holds
 * either way. The shipped bytes do not move; the build stops depending
 * on which machine ran the last checkout.
 *
 * The listed extensions are the ones .gitattributes pins to `eol=lf`
 * AND normalizes here. `*.txt` - robots.txt and the three OFL licenses -
 * is pinned there too and is deliberately absent from this table, which
 * is the part to leave alone. An attribute only takes effect when git
 * writes the file, so a working tree checked out before that pin still
 * holds those files in CRLF in BOTH trees, where they agree with each
 * other and the byte-compare below passes. Copying them is what keeps
 * that tree honest; normalizing would write LF into dist/ beside a CRLF
 * source and fail the compare on a machine where nothing is wrong.
 *
 * Anything not listed is copied byte for byte, and the default is that
 * way round on purpose: woff2 is a compressed container, and "normalize
 * the line endings" inside one produces a font no browser will parse.
 */
const MODE = {
  ".js": "js", ".css": "css", ".html": "text", ".svg": "text",
};

const LINE_ENDINGS = /\r\n?/g;
export function plan(from = SOURCE, into = OUTPUT, at = "") {
  const out = [];
  for (const name of readdirSync(join(from, at)).sort()) {
    const rel = at ? at + "/" + name : name;
    if (statSync(join(from, rel)).isDirectory()) {
      out.push(...plan(from, into, rel));
      continue;
    }
    out.push({ rel, mode: MODE[extname(name).toLowerCase()] || "copy" });
  }
  return out;
}

export function build(text, mode) {
  const source = text.replace(LINE_ENDINGS, "\n");
  if (mode === "js") return stripJs(source);
  if (mode === "css") return stripCss(source);
  return source;
}

function read(path) {
  return readFileSync(path);
}

/*
 * Every way dist/ can be wrong, as readable lines.
 *
 * Both directions in one walk, which is the point rather than a saving:
 * "source edited without rebuilding" and "artifact edited by hand"
 * produce the same mismatch, so there is no arm for one that could be
 * satisfied while the other is not.
 */
export function differences(from = SOURCE, into = OUTPUT, builder = build) {
  const problems = [];
  if (!existsSync(into)) {
    return ["dist/ is not there at all. Run `./run build` - it is the " +
            "published site and it is committed, so a missing one is a " +
            "release nobody could review."];
  }

  const wanted = plan(from, into);
  const have = new Set(plan(into, into).map((entry) => entry.rel));
  const settled = new Set();

  for (const { rel, mode } of wanted) {
    have.delete(rel);
    const target = join(into, rel);
    if (!existsSync(target)) {
      settled.add(rel);
      problems.push("dist/" + rel + " is missing. apps/web/" + rel +
                    " is published and nothing generated it.");
      continue;
    }
    const source = read(join(from, rel));
    const built = mode === "copy"
      ? source
      : Buffer.from(builder(source.toString("utf8"), mode), "utf8");
    if (!built.equals(read(target))) {
      settled.add(rel);
      problems.push("dist/" + rel + " is not what apps/web/" + rel +
                    " builds to. Either the source moved and nothing " +
                    "rebuilt, or dist/ was edited by hand; both are the " +
                    "same failure. Run `./run build`.");
    }
  }

  for (const rel of [...have].sort()) {
    problems.push("dist/" + rel + " has no file behind it in apps/web. A " +
                  "page published from nothing is the one thing this " +
                  "directory must never hold - delete it, or add its " +
                  "source.");
  }

  // The scope wall, checked rather than promised. Files already reported
  // above are skipped: a stale artifact would trip this too, and two
  // messages for one cause sends the reader after the wrong fix.
  for (const { rel, mode } of wanted) {
    if (mode === "copy" || settled.has(rel)) continue;
    const source = read(join(from, rel)).toString("utf8");
    const shipped = read(join(into, rel)).toString("utf8");
    const same = mode === "js"
      ? String(jsTokens(source)) === String(jsTokens(shipped))
      : cssShape(source) === cssShape(shipped);
    if (!same) {
      problems.push("dist/" + rel + " does not say the same thing as " +
                    "apps/web/" + rel + ". #181 permits removing comments " +
                    "and nothing else - no renaming, no minifying, no " +
                    "reordering - and this file differs by more than that.");
    }
  }
  return problems;
}

/* `builder` is here so the suite can stand up a generator that does MORE
   than remove comments and watch the token arm refuse it. That is the
   one failure a byte-comparison against a fresh build cannot reach: a
   generator taught to rename something rebuilds identically forever. */
export function write(from = SOURCE, into = OUTPUT, builder = build) {
  if (existsSync(into)) rmSync(into, { recursive: true });
  for (const { rel, mode } of plan(from, into)) {
    const target = join(into, rel);
    mkdirSync(dirname(target), { recursive: true });
    const source = read(join(from, rel));
    writeFileSync(target, mode === "copy"
      ? source
      : Buffer.from(builder(source.toString("utf8"), mode), "utf8"));
  }
}

function main() {
  const checking = process.argv.includes("--check");
  if (!checking) {
    write();
    console.log("build_web: dist/ written from apps/web (" +
                plan().length + " files).");
    return 0;
  }
  const problems = differences();
  if (problems.length) {
    for (const problem of problems) console.log("::error::" + problem);
    console.log("\nbuild_web FAILED " + problems.length + " check(s)");
    return 1;
  }
  console.log("build_web: dist/ is apps/web with the comments removed, " +
              "and nothing else (" + plan().length + " files).");
  return 0;
}

if (relative(process.argv[1] || "", fileURLToPath(import.meta.url)) === "") {
  process.exit(main());
}
