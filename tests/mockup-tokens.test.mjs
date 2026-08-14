/*
 * The mockup's color tokens are the stylesheet's color tokens.
 *
 *     node tests/mockup-tokens.test.mjs
 *
 * Subject: dev/mockup/binder-site-mockup.html, the design gate for
 * styling, and apps/web/theme.css, the four palettes the site actually
 * ships.
 *
 * WHY THIS LIVES IN tests/ AND CARRIES ITS OWN RUNNER. The 0.9 wave
 * treats the dev/ apparatus as ending with the surfaces it describes
 * (#228), and 0.9-M0-S4 builds what replaces it. So this file imports
 * nothing but node:fs: the twenty lines at the bottom are a runner, not
 * a framework, and adopting this file is a move plus a deletion of those
 * twenty lines rather than a rewrite. The other arms in this directory
 * are written the same way for the same reason.
 *
 * WHAT WOULD BE WRONG WITHOUT IT. The mockup has been hand-keeping 85
 * --color-* declarations that restate the stylesheet's, and until this
 * file nothing compared them. That is the duplication AGENTS.md's "one
 * home per fact" rule exists to prevent, in the one shape the rule
 * cannot forbid: the mockup genuinely has to carry its own copy, because
 * it is a single self-contained page that renders four palettes side by
 * side inside one document and cannot link the stylesheet that assumes
 * one palette per document root.
 *
 * So the copy stays and the drift is what gets caught. A drifted copy
 * does not throw and does not look wrong - it is a mockup showing the
 * owner a crimson the site does not have, in a review whose whole
 * purpose is that the site must look PRECISELY like it. The owner
 * approves the wrong color, the slice that implements it matches the
 * stylesheet instead, and the divergence is discovered by eye months
 * later or never. Both directions are equally bad and this arm refuses
 * both, naming the two values so the reader knows which file moved.
 *
 * WHAT IT DELIBERATELY DOES NOT ASK. Whether the values are any good:
 * tools/check_contrast.py measures every one of them against the WCAG
 * thresholds. This arm asks only whether the two files agree, which is
 * a question no old check asks and the reason it is a new file rather
 * than a widened one.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));

const MOCKUP = "../dev/mockup/binder-site-mockup.html";
const THEME = "../apps/web/theme.css";

/* ------------------------------------------------------------------ */
/* Reading the declarations out of both files.                         */

/*
 * A scanner rather than a regular expression over lines, because the
 * two files write the same declarations in two shapes: theme.css puts
 * one per line, the mockup packs two or three onto a line to keep a
 * palette block readable at a glance, and --color-accent-quiet wraps
 * across two lines in theme.css and not in the mockup. A line-oriented
 * reader would report those as differences that are not there.
 *
 * It tracks the selector nesting so a declaration knows which block it
 * came from, which is what makes theme.css's two @media blocks
 * addressable at all - they are the palettes a visitor gets from a
 * system preference rather than from a chip, and they are the copies
 * most likely to be forgotten in an edit.
 *
 * Quoted strings are skipped whole. Nothing in either file currently
 * puts a brace or a semicolon inside a string, so this costs nothing
 * today; it is here because a scanner that can be broken by a
 * `content: "{"` somebody adds later would go on reporting agreement
 * about the declarations it stopped finding.
 */
function declarations(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found = new Map();
  const stack = [];
  let buf = "";

  const flush = () => {
    const m = buf.match(/(--color-[A-Za-z0-9-]+)\s*:\s*([\s\S]+)/);
    if (m && stack.length) {
      const path = stack.join(" ");
      if (!found.has(path)) found.set(path, new Map());
      found.get(path).set(m[1], m[2].trim().replace(/\s+/g, " "));
    }
    buf = "";
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\"" || ch === "'") {
      const quote = ch;
      buf += ch;
      i += 1;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === "\\") { buf += text[i]; i += 1; }
        buf += text[i];
        i += 1;
      }
      buf += quote;
    } else if (ch === "{") {
      stack.push(buf.trim().replace(/\s+/g, " "));
      buf = "";
    } else if (ch === "}") {
      flush();
      stack.pop();
    } else if (ch === ";") {
      flush();
    } else {
      buf += ch;
    }
  }
  return found;
}

/* An absent file is a failed CHECK here rather than an uncaught throw,
   and that is not politeness: this arm was committed before the mockup
   was in the repository at all, so "the file is not where this arm says
   it is" is a state it has genuinely been in and will be in again the
   day something moves it. A stack trace says the arm is broken; a red
   check naming the path says the tree is. */
function read(path) {
  try {
    return readFileSync(HERE(path), "utf8");
  } catch (error) {
    return null;
  }
}

const html = read(MOCKUP);
const themeText = read(THEME);
const styles = (html ?? "").match(/<style>([\s\S]*?)<\/style>/g) || [];
const mockup = declarations(styles.map(
  (s) => s.replace(/^<style>/, "").replace(/<\/style>$/, "")).join("\n"));
const theme = declarations(themeText ?? "");

/*
 * The map from one file's blocks to the other's, written out rather
 * than derived, because it is the only thing in this arm that cannot be
 * computed from either file. AGENTS.md's review bar states the reason
 * in general: a check computed entirely from the file it guards cannot
 * detect that the file was rearranged, so something outside has to say
 * what it may contain. Here that something is this table.
 *
 * The selectors differ because the two documents are differently
 * shaped: theme.css sets a palette on the document root, and the mockup
 * paints four of them at once inside one page, so it scopes each to a
 * frame. What they mean is the same palette.
 */
const PALETTES = [
  { name: "Midnight",
    mockup: ".site",
    theme: ":root, :root[data-theme=\"midnight\"]" },
  { name: "Pink",
    mockup: ".frame[data-palette=\"pink\"] .site",
    theme: ":root[data-theme=\"pink\"]" },
  { name: "Daylight",
    mockup: ".frame[data-palette=\"daylight\"] .site",
    theme: ":root[data-theme=\"daylight\"]" },
  { name: "High contrast",
    mockup: ".frame[data-palette=\"contrast\"] .site",
    theme: ":root[data-theme=\"contrast\"]" },
];

/*
 * theme.css's palettes for a visitor who has expressed a system
 * preference and chosen no chip. Same values as the named palette,
 * stated twice because a media query cannot reference a selector - so
 * they are two more hand-kept copies, and the ones a palette edit is
 * most likely to miss.
 */
const SYSTEM = [
  { name: "a light-preferring system",
    block: "@media (prefers-color-scheme: light) :root:not([data-theme])",
    mirrors: ":root[data-theme=\"daylight\"]" },
  { name: "a contrast-preferring system",
    block: "@media (prefers-contrast: more) :root:not([data-theme])",
    mirrors: ":root[data-theme=\"contrast\"]" },
];

/*
 * --color-accent-quiet belongs to no palette: both files derive it from
 * whichever accent is in force, so both declare it once in a shared
 * block. Comparing it inside a palette would fail on three of the four
 * for a reason that is not drift.
 */
const DERIVED = "--color-accent-quiet";
const DERIVED_BLOCK = { mockup: ".site", theme: ":root" };

/* Every block either comparison reads. A --color-* declaration outside
   this list is a token nothing here measures, which is the exact
   condition this arm was written to end. */
const COVERED = {
  mockup: new Set(PALETTES.map((p) => p.mockup)),
  theme: new Set([...PALETTES.map((p) => p.theme),
    ...SYSTEM.map((s) => s.block), DERIVED_BLOCK.theme]),
};

/* ------------------------------------------------------------------ */

const EXPECTED = 19;
let performed = 0;
let failures = 0;

/* The tenant shape in this directory is check(label, condition). This
   one takes a third argument because the ticket's requirement is a red
   that NAMES BOTH VALUES: "they differ" sends the reader to diff two
   files by eye, which is the work the arm exists to have already done.
   It is a function so the detail is only computed on a failure. */
function check(label, condition, detail) {
  performed += 1;
  if (condition) {
    console.log("pass  " + label);
    return;
  }
  failures += 1;
  console.log("FAIL  " + label);
  const text = typeof detail === "function" ? detail() : detail;
  if (text) console.log(String(text).split("\n").map((l) => "        " + l)
    .join("\n"));
}

const names = (block) => [...(block ? block.keys() : [])]
  .filter((n) => n !== DERIVED).sort();

/* The two answers a comparison of two token tables can give, as data
   rather than as a printed sentence, so the negative controls at the
   bottom can assert on them. */
function missing(left, right) {
  const l = new Set(names(left));
  const r = new Set(names(right));
  return {
    onlyLeft: [...l].filter((n) => !r.has(n)),
    onlyRight: [...r].filter((n) => !l.has(n)),
  };
}

function differing(left, right) {
  const out = [];
  for (const name of names(left)) {
    if (!right || !right.has(name)) continue;
    if (left.get(name) !== right.get(name)) {
      out.push({ name, left: left.get(name), right: right.get(name) });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 1. The arm read what it thinks it read.                             */

/*
 * Every check below compares two token tables, and two tables that are
 * both EMPTY compare equal. A selector typed wrong in the map above, a
 * <style> tag the extraction missed, a scanner broken by a file that
 * grew a construct it cannot parse - each of those produces exactly
 * that, and the arm would print a full row of passes having measured
 * nothing. This section is what makes the passes below mean something.
 */

check("both files this arm compares are where it expects them",
  html !== null && themeText !== null,
  () => [html === null ? "not readable: " + MOCKUP : "",
    themeText === null ? "not readable: " + THEME : ""]
    .filter(Boolean).join("\n"));

check("the mockup keeps its palettes in one style block",
  styles.length === 1 && mockup.size > 0,
  () => "found " + styles.length + " <style> blocks and " + mockup.size +
    " blocks declaring color tokens");

check("every palette named in the map is present in both files",
  PALETTES.every((p) => mockup.get(p.mockup) && theme.get(p.theme)),
  () => PALETTES.filter((p) => !mockup.get(p.mockup) || !theme.get(p.theme))
    .map((p) => p.name + ": mockup block " +
      (mockup.get(p.mockup) ? "found" : "MISSING (" + p.mockup + ")") +
      ", theme.css block " +
      (theme.get(p.theme) ? "found" : "MISSING (" + p.theme + ")"))
    .join("\n"));

check("no palette is measured as an empty pair of blocks",
  PALETTES.every((p) => names(mockup.get(p.mockup)).length > 0 &&
    names(theme.get(p.theme)).length > 0),
  () => PALETTES.map((p) => p.name + ": " +
    names(mockup.get(p.mockup)).length + " mockup tokens, " +
    names(theme.get(p.theme)).length + " theme.css tokens").join("\n"));

// The coverage half, and the reason a fifth palette cannot arrive
// unmeasured: the ticket's complaint is not that the copies differ, it
// is that nothing was reading them.
const uncovered = (found, covered) =>
  [...found.keys()].filter((path) => !covered.has(path));

check("every color token the mockup declares sits in a compared block",
  uncovered(mockup, COVERED.mockup).length === 0,
  () => "unmeasured blocks in the mockup:\n" +
    uncovered(mockup, COVERED.mockup).map((p) => "  " + p).join("\n"));

check("every color token theme.css declares sits in a compared block",
  uncovered(theme, COVERED.theme).length === 0,
  () => "unmeasured blocks in theme.css:\n" +
    uncovered(theme, COVERED.theme).map((p) => "  " + p).join("\n"));

/* ------------------------------------------------------------------ */
/* 2. The four palettes, both directions.                              */

for (const palette of PALETTES) {
  const left = mockup.get(palette.mockup);
  const right = theme.get(palette.theme);
  const gap = missing(left, right);

  check(palette.name + ": the same roles are declared in both files",
    gap.onlyLeft.length === 0 && gap.onlyRight.length === 0,
    () => [
      gap.onlyLeft.length
        ? "in the mockup and not in theme.css: " + gap.onlyLeft.join(", ")
        : "",
      gap.onlyRight.length
        ? "in theme.css and not in the mockup: " + gap.onlyRight.join(", ")
        : "",
    ].filter(Boolean).join("\n"));

  const drift = differing(left, right);
  check(palette.name + ": every shared role carries the same value",
    drift.length === 0,
    () => drift.map((d) => d.name + "\n  mockup:    " + d.left +
      "\n  theme.css: " + d.right).join("\n"));
}

/* ------------------------------------------------------------------ */
/* 3. The one token that is derived rather than declared per palette.  */

check("the derived tint is declared once in each file, identically",
  mockup.get(DERIVED_BLOCK.mockup)?.get(DERIVED) !== undefined &&
  mockup.get(DERIVED_BLOCK.mockup)?.get(DERIVED) ===
    theme.get(DERIVED_BLOCK.theme)?.get(DERIVED),
  () => DERIVED + "\n  mockup:    " +
    (mockup.get(DERIVED_BLOCK.mockup)?.get(DERIVED) ?? "(absent)") +
    "\n  theme.css: " +
    (theme.get(DERIVED_BLOCK.theme)?.get(DERIVED) ?? "(absent)"));

/* ------------------------------------------------------------------ */
/* 4. The palettes a system preference selects, inside theme.css.      */

/*
 * Not the mockup's business directly, and measured here anyway. The
 * mockup is the gate for what Daylight looks like; theme.css states
 * Daylight twice, and only one of the two is what a light-preferring
 * visitor with no saved chip actually gets. An arm that held the mockup
 * to the [data-theme] copy alone would go green while the copy that
 * governs the default experience drifted - which is the criterion-held,
 * property-broken shape the review bar names.
 */
for (const system of SYSTEM) {
  const left = theme.get(system.block);
  const right = theme.get(system.mirrors);
  const gap = missing(left, right);
  const drift = differing(left, right);
  check(system.name + " gets exactly " + system.mirrors,
    left !== undefined && right !== undefined &&
    gap.onlyLeft.length === 0 && gap.onlyRight.length === 0 &&
    drift.length === 0,
    () => [
      left === undefined ? "block not found: " + system.block : "",
      right === undefined ? "block not found: " + system.mirrors : "",
      gap.onlyLeft.length ? "only in the media block: " +
        gap.onlyLeft.join(", ") : "",
      gap.onlyRight.length ? "only in the named palette: " +
        gap.onlyRight.join(", ") : "",
      ...drift.map((d) => d.name + "\n  media block:    " + d.left +
        "\n  named palette:  " + d.right),
    ].filter(Boolean).join("\n"));
}

/* ------------------------------------------------------------------ */
/* 5. The comparison can fail, asserted in this process.               */

/*
 * The mutation battery on the pull request proves this against the real
 * files; these two prove it to whoever runs the arm on its own, and
 * they cost nothing. An agreement check whose comparator silently
 * answers "equal" for every input is the armed-looking-but-not failure
 * this repository holds to be worse than no check at all, and it is a
 * plausible bug here: `differing` skips names the other side lacks, so
 * a comparator that lost its names would report no drift and no gap.
 */
/*
 * The control table is invented rather than lifted out of theme.css,
 * and the first draft of this arm did lift it. The mutation battery is
 * what caught it: nudging theme.css's --color-bg turned BOTH the
 * Midnight comparison and this control red, because the control was
 * asserting on the very hex it had just read. That is a false red
 * waiting for the first legitimate palette edit - a check that fails
 * for a reason that is not a defect teaches its reader to wave red
 * through, which is the cost this repository already pays attention to.
 * The comparator is generic over token tables, so nothing is lost by
 * handing it two that no file owns.
 */
const CONTROL = new Map([
  ["--color-bg", "#000001"],
  ["--color-gold", "#000002"],
  ["--color-text", "#000003"],
]);

const nudged = new Map(CONTROL);
nudged.set("--color-bg", "#000009");
check("a one-digit value difference is reported, with both values",
  (() => {
    const drift = differing(CONTROL, nudged);
    return drift.length === 1 && drift[0].name === "--color-bg" &&
      drift[0].left === "#000001" && drift[0].right === "#000009";
  })(),
  () => "differing() answered " + JSON.stringify(differing(CONTROL, nudged)));

const dropped = new Map(CONTROL);
dropped.delete("--color-gold");
check("a token present on one side only is reported, and named",
  (() => {
    const gap = missing(CONTROL, dropped);
    return gap.onlyLeft.length === 1 && gap.onlyLeft[0] === "--color-gold" &&
      gap.onlyRight.length === 0;
  })(),
  () => "missing() answered " + JSON.stringify(missing(CONTROL, dropped)));

/* ------------------------------------------------------------------ */

const declared = (map) => [...map.values()]
  .reduce((sum, block) => sum + block.size, 0);
console.log("\nread " + declared(mockup) + " color declarations in the " +
  "mockup and " + declared(theme) + " in theme.css");

console.log(failures
  ? `mockup-tokens FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `mockup-tokens ran ${performed} checks, expected ${EXPECTED}`
    : `mockup-tokens OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
