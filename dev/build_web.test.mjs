/*
 * Contract checks for the generator that produces dist/ from apps/web.
 *
 * #181. The stakes here are not the byte count: this is the first tool in
 * the repository that WRITES a file the site is served from, so the
 * checks that matter are the ones proving it cannot write something the
 * repository did not notice. Three groups, in order of what they defend:
 *
 *  - the strippers remove comments and nothing else, including in the
 *    places a scanner gets wrong (a "/*" inside a string, inside a regex
 *    literal, inside a template) and in the place a careless one changes
 *    meaning (automatic semicolon insertion after `return`);
 *  - differences() reports a stale artifact in BOTH directions, so a
 *    source edited without rebuilding and a dist/ edited by hand are the
 *    same failure;
 *  - the token arm refuses a build that did more than remove comments,
 *    which is the scope wall #181 sets and the one a byte-comparison
 *    against a fresh build can never see.
 *
 * A fourth group joined them for #227, and it is about a claim rather
 * than a behavior. Three files declare this repository's line-ending
 * regime - .gitattributes for git, .editorconfig for editors, and MODE
 * in the generator for the build - and nothing compared any two of
 * them. The generator's table SAID it was the .gitattributes eol=lf
 * list and was not; .editorconfig told an editor to write run.cmd in
 * LF while .gitattributes pins it to CRLF. Both are the same defect: a
 * roster with no reader behind it.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync }
  from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { nodeTestSuite } from "./harness.mjs";
import { stripJs, stripCss, jsTokens, cssShape, plan, build, differences,
         write, SOURCE, REPO, MODE, PINNED_BUT_COPIED }
  from "../tools/build_web.mjs";

const { check, report } = nodeTestSuite("build_web.mjs", 57);

/* ---- the strippers ------------------------------------------------- */

check("a line comment goes and its code stays",
  stripJs("const a = 1; // why\nconst b = 2;\n")
    === "const a = 1;  \nconst b = 2;\n");

check("a block comment on one line becomes one space",
  stripJs("const a = /* why */ 1;") === "const a =   1;");

/*
 * The ASI case, which is the whole reason a comment becomes a newline
 * rather than nothing. `return` followed by a line terminator returns
 * undefined; a comment carrying that terminator does the same. Delete it
 * outright and the file starts returning 5.
 */
const asi = "function f() { return /*\n*/ 5; }";
check("a comment that spanned a line still ends the statement",
  stripJs(asi).includes("return \n"));
check("and the two files still say the same thing",
  String(jsTokens(asi)) === String(jsTokens(stripJs(asi))));

check("a comment opener inside a string is not a comment",
  stripJs('const a = "/* not a comment */";')
    === 'const a = "/* not a comment */";');

check("a comment opener inside a regex literal is not a comment",
  stripJs("const re = /\\/\\*x/g; // gone\n")
    === "const re = /\\/\\*x/g;  \n");

check("a comment opener inside a template literal is not a comment",
  stripJs("const a = `/* kept */ ${x} /* kept */`;")
    === "const a = `/* kept */ ${x} /* kept */`;");

/*
 * Trailing whitespace and blank lines inside a template literal are the
 * string, not formatting. This is why nothing here tidies: a pass that
 * cannot see token boundaries would change what a page renders.
 */
const template = "const a = `line   \n\n   end`; // why\n";
check("whitespace inside a template survives untouched",
  stripJs(template).includes("`line   \n\n   end`"));

check("a CSS comment between two selectors leaves a separator",
  stripCss("a/* why */b { color: red; }") === "a b { color: red; }");

check("a CSS comment spanning lines leaves a newline",
  stripCss(".a {\n/* why\n   more */\ncolor: red;\n}")
    === ".a {\n\n\ncolor: red;\n}");

check("a comment opener inside a CSS string is not a comment",
  stripCss('.a { content: "/* kept */"; }')
    === '.a { content: "/* kept */"; }');

check("an unterminated CSS comment takes the rest of the file",
  stripCss(".a { color: red; } /* and then nothing") === ".a { color: red; }  ");

/* ---- the strippers, against the real tree --------------------------- */

const themeSource = readFileSync(join(SOURCE, "theme.css"), "utf8");
const themeBuilt = stripCss(themeSource);
check("the shipped stylesheet loses its comments",
  themeSource.includes("/*") && !themeBuilt.includes("/*"));
check("and says the same thing afterwards",
  cssShape(themeSource) === cssShape(themeBuilt));
check("and it is the saving #181 was ruled on",
  themeSource.length - themeBuilt.length > 40000);

// dashboard.js was this file's subject until 0.9-M2-S3 (#354) deleted
// it - it was the heaviest script in apps/web at the time this arm was
// written. admin.js is the heaviest one left (bigger than dashboard.js
// ever was), so it takes the same two checks rather than the arm
// losing its "against the real tree, not a fixture" property.
const adminSource = readFileSync(join(SOURCE, "admin.js"), "utf8");
check("the heaviest script loses its comments",
  !/\/\*|(^|[^:])\/\//.test(stripJs(adminSource).replace(/`[^`]*`/g, "")));
check("and its token stream is unchanged",
  String(jsTokens(adminSource))
    === String(jsTokens(stripJs(adminSource))));

/*
 * Every shipped script, not only the big one. A generator that corrupts
 * one file in twenty is worse than one that corrupts all of them, because
 * the gate stays green everywhere somebody thinks to look.
 */
const scripts = plan().filter((entry) => entry.mode === "js");
check("every shipped script survives the strip with its meaning intact",
  scripts.length > 15 && scripts.every(({ rel }) => {
    const text = readFileSync(join(SOURCE, rel), "utf8");
    return String(jsTokens(text)) === String(jsTokens(stripJs(text)));
  }));

check("no comment is taken out of anything but JavaScript and CSS",
  plan().every((entry) =>
    ["copy", "text"].includes(entry.mode) || /\.(js|css)$/.test(entry.rel)));

check("an HTML page is text, so it keeps its comments and loses its CRLFs",
  plan().some((entry) => entry.rel.endsWith(".html") && entry.mode === "text")
  && build("<!-- kept -->\r\n<p>hi</p>\r\n", "text")
     === "<!-- kept -->\n<p>hi</p>\n");

check("the vendored faces are copied rather than read as text",
  plan().some((entry) =>
    entry.rel.endsWith(".woff2") && entry.mode === "copy"));

/*
 * The line-ending arm, and it is here because a rebase produced it
 * rather than because somebody imagined it. .gitattributes pins these
 * extensions to `eol=lf`, so a checkout made under the pins is LF on
 * every platform - but an attribute takes effect only when git writes
 * the file, and a rebase writes only the blobs it moved. A source can
 * therefore sit in CRLF, left over from a checkout that predates its
 * pin, beside a freshly written artifact in LF, on a machine where
 * nothing is wrong. A build that copied those bytes would fail its own
 * byte-compare and commit identically anyway.
 */
check("a CRLF source builds to the same bytes as an LF one",
  build("const a = 1; // why\r\nconst b = 2;\r\n", "js")
    === build("const a = 1; // why\nconst b = 2;\n", "js"));

check("and so does a stylesheet",
  build(".a {\r\n/* why */\r\ncolor: red;\r\n}\r\n", "css")
    === build(".a {\n/* why */\ncolor: red;\n}\n", "css"));

check("a lone carriage return is a line ending too",
  build("const a = 1;\rconst b = 2;\r", "js") === "const a = 1;\nconst b = 2;\n");

/* ---- staleness, in both directions ---------------------------------- */

const scratch = mkdtempSync(join(tmpdir(), "build-web-"));
const from = join(scratch, "web");
const into = join(scratch, "dist");
mkdirSync(from, { recursive: true });
writeFileSync(join(from, "a.js"), "const a = 1; // why\n");
writeFileSync(join(from, "b.css"), ".a { color: red; } /* why */");
writeFileSync(join(from, "page.html"), "<!-- kept --><p>hi</p>");
write(from, into);

check("a fresh build has nothing to report",
  differences(from, into).length === 0);

check("the HTML page is copied with its comments intact",
  readFileSync(join(into, "page.html"), "utf8") === "<!-- kept --><p>hi</p>");

writeFileSync(join(from, "a.js"), "const a = 2; // why\n");
const sourceMoved = differences(from, into);
check("a source edited without rebuilding FAILS",
  sourceMoved.length === 1 && /a\.js/.test(sourceMoved[0])
  && /builds to/.test(sourceMoved[0]));
check("and the message says which of the two ways it broke",
  /edited by hand/.test(sourceMoved[0]) && /rebuilt/.test(sourceMoved[0]));
write(from, into);
check("rebuilding clears it", differences(from, into).length === 0);

writeFileSync(join(into, "a.js"), "const a = 3;\n");
check("an artifact edited by hand FAILS",
  differences(from, into).some((line) => /a\.js/.test(line)));
write(from, into);

writeFileSync(join(into, "ghost.js"), "const ghost = 1;\n");
const ghost = differences(from, into);
check("a published file with no source behind it FAILS",
  ghost.length === 1 && /ghost\.js/.test(ghost[0]));
rmSync(join(into, "ghost.js"));

rmSync(join(into, "b.css"));
check("a source with nothing published for it FAILS",
  differences(from, into).some((line) => /b\.css.*missing/.test(line)));
write(from, into);

rmSync(into, { recursive: true });
const gone = differences(from, into);
check("no dist/ at all FAILS rather than passing on an empty set",
  gone.length === 1 && /not there at all/.test(gone[0]));
write(from, into);

/* ---- the scope wall ------------------------------------------------- */

/*
 * The arm a byte-comparison cannot have, exercised the only way that
 * proves anything: a generator that does more than remove comments, with
 * dist/ built BY that generator. Byte-comparison is satisfied - the
 * artifact is exactly what this build produces, and would be again
 * tomorrow - so the token stream is the only thing left that can object.
 */
const renaming = (text, mode) =>
  build(text, mode).replace(/\ba\b/g, "renamed");
write(from, into, renaming);
const rogue = differences(from, into, renaming);
check("a generator that renames something FAILS its own byte-compare",
  rogue.some((line) => /a\.js/.test(line) && /no renaming/.test(line)));
check("and the stylesheet half objects the same way",
  rogue.some((line) => /b\.css/.test(line) && /no renaming/.test(line)));

const spacing = (text, mode) => build(text, mode).replace(/ /g, "  ");
write(from, into, spacing);
check("but a generator that only moves whitespace is not a scope failure",
  !differences(from, into, spacing).some((line) => /no renaming/.test(line)));
write(from, into);
check("and the real generator leaves nothing to report",
  differences(from, into).length === 0);

rmSync(scratch, { recursive: true, force: true });

/* ---- the published tree itself -------------------------------------- */

check("the committed dist/ is exactly what apps/web builds to",
  differences().length === 0);

check("and it holds every page the source does",
  plan().filter((entry) => entry.rel.endsWith(".html")).length === 5);

/* ---- the line-ending regime, across the three files that declare it - */

/*
 * Every `eol=` pin in a .gitattributes text, as {pattern: ending}. A
 * commented-out pin is not a pin, and `* text=auto` states no ending at
 * all, so neither is read.
 */
function eolPins(text) {
  const pins = new Map();
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    const found = /^(\S+)\s+.*\beol=(\w+)/.exec(line);
    if (found) pins.set(found[1], found[2]);
  }
  return pins;
}

/* .editorconfig as ordered sections, each with the settings under it.
   Keys before the first section header - `root = true` - belong to no
   section and are dropped, which is what EditorConfig says of them. */
function editorconfigSections(text) {
  const sections = [];
  let current = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/[#;].*$/, "").trim();
    if (!line) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      current = { glob: header[1], settings: new Map() };
      sections.push(current);
      continue;
    }
    const pair = /^([A-Za-z_]+)\s*=\s*(\S+)$/.exec(line);
    if (pair && current) current.settings.set(pair[1], pair[2]);
  }
  return sections;
}

/*
 * Whether a section glob covers a file name: true, false, or null for a
 * glob shape this reader does not implement.
 *
 * Null rather than false, and the difference is the whole value of the
 * arm below. This is not an EditorConfig implementation - it answers one
 * question about the section shapes this repository's file actually uses
 * (a literal name, `*.ext`, and one brace list). A shape it cannot read
 * would silently answer "no rule covers this", which is indistinguishable
 * from a file with no rule and would let a real disagreement through.
 */
function globMatches(glob, name) {
  const braces = /^(.*)\{([^{}]*)\}(.*)$/.exec(glob);
  const alternatives = braces
    ? braces[2].split(",").map((part) => braces[1] + part.trim() + braces[3])
    : [glob];
  if (alternatives.some((one) => /[[\]{}?]/.test(one) || one.includes("**"))) {
    return null;
  }
  return alternatives.some((one) => new RegExp("^" + one.split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*") + "$").test(name));
}

/* The end_of_line an editor would apply to one file: the last matching
   section that states one wins, and a matching section that states none
   leaves the previous answer standing. */
function editorconfigEol(sections, name) {
  let answer = null;
  for (const section of sections) {
    if (globMatches(section.glob, name) === true
        && section.settings.has("end_of_line")) {
      answer = section.settings.get("end_of_line");
    }
  }
  return answer;
}

/* A .gitattributes pattern as a file name a glob can be tried against. */
const sampleName = (pattern) =>
  (pattern.startsWith("*.") ? "sample" + pattern.slice(1) : pattern);

check("a pin is read off a .gitattributes line",
  eolPins("*.x  text eol=crlf\n").get("*.x") === "crlf");
check("a commented-out pin is not a pin",
  eolPins("# *.y text eol=lf\n").size === 0);
check("a line stating no ending is not a pin",
  eolPins("* text=auto\n").size === 0);

check("a brace list in a section header is expanded",
  globMatches("*.{a,b}", "sample.b") === true
  && globMatches("*.{a,b}", "sample.c") === false);
check("a literal section name matches only itself",
  globMatches("Makefile", "Makefile") === true
  && globMatches("Makefile", "Makefile.in") === false);
check("a glob shape this reader cannot expand is null, not false",
  globMatches("**/x", "y") === null);

const madeUp = editorconfigSections(
  "root = true\n[*]\nend_of_line = lf\nindent_size = 2\n"
  + "[*.z]\nindent_size = 4\n[*.q]\nend_of_line = crlf\n");
check("a setting before the first section belongs to no section",
  madeUp.length === 3);
check("a later section overrides an earlier one",
  editorconfigEol(madeUp, "sample.q") === "crlf");
check("a matching section that states no ending does not override",
  editorconfigEol(madeUp, "sample.z") === "lf");

const attributes = readFileSync(join(REPO, ".gitattributes"), "utf8");
const editorconfig = readFileSync(join(REPO, ".editorconfig"), "utf8");
const pins = eolPins(attributes);
const sections = editorconfigSections(editorconfig);

/* The decisive arms. Two readers that find nothing report the same
   agreement as two files that agree, which is the failure every roster
   in this repository is written against. */
check("the real .gitattributes states line-ending pins",
  pins.size > 5);
check("the real .editorconfig states sections",
  sections.length > 2);
check("every .editorconfig section is a shape this reader understands",
  sections.every((section) => globMatches(section.glob, "sample.x") !== null));

check("every line-ending pin gets the same answer from .editorconfig",
  [...pins].every(([pattern, ending]) =>
    editorconfigEol(sections, sampleName(pattern)) === ending));

const pinnedLf = new Set([...pins]
  .filter(([pattern, ending]) => ending === "lf" && pattern.startsWith("*."))
  .map(([pattern]) => pattern.slice(1)));
const held = new Set(plan().map((entry) => extname(entry.rel).toLowerCase()));

check("every extension the build normalizes is pinned eol=lf",
  Object.keys(MODE).every((ext) => pinnedLf.has(ext)));

check("every pinned extension apps/web holds is normalized or excused",
  [...held].filter((ext) => pinnedLf.has(ext))
    .every((ext) => ext in MODE || ext in PINNED_BUT_COPIED));

check("an excused extension is one the pin actually covers",
  Object.keys(PINNED_BUT_COPIED).every((ext) => pinnedLf.has(ext)));
check("an excused extension is not also normalized",
  Object.keys(PINNED_BUT_COPIED).every((ext) => !(ext in MODE)));
check("an excused extension is one apps/web actually holds",
  Object.keys(PINNED_BUT_COPIED).every((ext) => held.has(ext)));

report();
