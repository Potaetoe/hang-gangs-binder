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
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync }
  from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeTestSuite } from "./harness.mjs";
import { stripJs, stripCss, jsTokens, cssShape, plan, build, differences,
         write, SOURCE } from "../tools/build_web.mjs";

const { check, report } = nodeTestSuite("build_web.mjs", 39);

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

const dashboardSource = readFileSync(join(SOURCE, "dashboard.js"), "utf8");
check("the heaviest script loses its comments",
  !/\/\*|(^|[^:])\/\//.test(stripJs(dashboardSource).replace(/`[^`]*`/g, "")));
check("and its token stream is unchanged",
  String(jsTokens(dashboardSource))
    === String(jsTokens(stripJs(dashboardSource))));

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
 * rather than because somebody imagined it. .gitattributes stores this
 * repository as LF and hands Windows CRLF, and git only rewrites a
 * working file whose blob changed - so a source can sit in CRLF beside
 * a freshly checked-out artifact in LF, on a machine where nothing is
 * wrong. A build that copied those bytes would fail its own
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

report();
