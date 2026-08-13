/*
 * Checks for apps/web/query.js - the member-facing query engine.
 *
 *     node dev/query.test.mjs
 *
 * This suite exists for one hazard above all others, and most of its
 * length is spent on it: a query engine over a published snapshot is a
 * machine for asking the same people the same question many ways, and
 * the answers can be differenced. dev/dashboard.test.mjs proves that
 * ONE published document holds the floor. Nothing there says anything
 * about what a member can learn from a HUNDRED queries against it, and
 * that is the gap this file covers.
 *
 * The floor checks below are therefore written as properties over
 * generated corpora rather than as examples. An example says "this cell
 * was suppressed"; the hazard is a cell nobody thought to write an
 * example for. The generator is seeded, so a failure names a seed that
 * reproduces it.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { suite } from "./harness.mjs";

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));

const load = async (path) => {
  const src = await readFile(HERE(path), "utf8");
  await import("data:text/javascript," + encodeURIComponent(src));
};

/*
 * dashboard.js first, and that order is the contract rather than a
 * convenience: query.js reads the floor, the snapshot builder and the
 * unit table out of BinderDashboard instead of carrying second copies.
 * A second copy of the floor is a floor that can be lowered in one file
 * and not the other, which is the whole failure MIN_CELL exists to stop.
 */
await load("../apps/web/dashboard.js");
await load("../apps/web/query.js");

const { MIN_CELL, OTHER_LABEL, NOT_STATED, snapshotOf, DEFAULT_UNITS } =
  globalThis.BinderDashboard;
const Q = globalThis.BinderQuery;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sum = (cells) => cells.reduce((n, cell) => n + cell.count, 0);

const threw = (fn, fragment) => {
  try {
    fn();
  } catch (error) {
    return String(error && error.message).toLowerCase()
      .includes(fragment.toLowerCase());
  }
  return false;
};

/*
 * The count is asserted rather than only printed, per dev/harness.mjs.
 * It matters more here than in most suites: the properties below run
 * inside loops, and a loop that silently stops iterating still reports
 * every check it managed to reach as a pass.
 */
const { check, report } = suite("query.js", 54);

/* ------------------------------------------------------------------ */
/* The module shape, and the contract the UI slice builds against.     */

await check("the exported object is frozen", () =>
  // The engine decides the floor for every published query on the page.
  // An export a later script can rewrite is a floor that can be
  // rewritten - the same argument dev/dashboard.test.mjs makes for
  // BinderDashboard, one level up the call chain.
  Object.isFrozen(globalThis.BinderQuery));

await check("it publishes with no document", () =>
  // The seam every pure module here keeps. This file never installs a
  // DOM, so the module having loaded at all is the assertion.
  typeof document === "undefined" && Q !== undefined);

await check("the exported API is exactly the documented contract", () =>
  // Pinned as a set, not spot-checked. This namespace is the contract
  // the later UI slice of #85 builds against, so a member appearing or
  // vanishing is a change to a published interface and should be a
  // decision somebody made, not a diff nobody read.
  same(Object.keys(Q).slice().sort(),
    ["BASES", "MEASURES", "PERSONAL", "PUBLISHED", "SPLITS", "describe",
      "personalSource", "publishedSource", "run"]));

await check("the split table is frozen too", () =>
  // A shallow freeze on the namespace leaves this editable, and it is
  // the table that says which splits exist and which take units.
  Object.isFrozen(Q.SPLITS) && Object.isFrozen(Q.SPLITS.weight));

/* ------------------------------------------------------------------ */
/* Fixtures.                                                           */

let nextAccount = 0;
const entry = (over) => {
  nextAccount++;
  return Object.assign({
    accountId: "acct-" + nextAccount,
    telegram: "member" + nextAccount,
    submittedAt: "2026-05-0" + ((nextAccount % 9) + 1) + "T10:00:00.000Z",
    gender: "female",
    country: "US",
    roles: ["gainer"],
    kg: 80,
    lb: 176,
    cm: 170,
    totalInches: 67,
  }, over);
};

/*
 * A group large enough that a published snapshot has something to say.
 *
 * Every country here clears MIN_CELL on purpose. A published document
 * has already suppressed its own cells, so a country that did not clear
 * the floor would not be a label in the document at all - and the merge
 * checks below need labels that are really there to merge.
 */
const corpus = [];
for (let i = 0; i < 30; i++) {
  corpus.push(entry({
    gender: i < 20 ? "female" : "male",
    country: i < 12 ? "US" : (i < 22 ? "GB" : "CA"),
    kg: 60 + i,
    lb: Math.round((60 + i) * 2.2046226218),
    cm: 160 + (i % 20),
    totalInches: Math.round((160 + (i % 20)) / 2.54),
  }));
}

const published = snapshotOf(corpus, { identify: false }, 0);
const keyholder = snapshotOf(corpus, { identify: true }, 0);

/* One member's own rows: same account id throughout. */
const mine = [];
for (let i = 0; i < 4; i++) {
  mine.push(entry({
    accountId: "mine", telegram: "me",
    submittedAt: "2026-0" + (i + 1) + "-01T10:00:00.000Z",
    kg: 90 - i, lb: Math.round((90 - i) * 2.2046226218),
  }));
}

/* ------------------------------------------------------------------ */
/* publishedSource - what may become a published source at all.        */

await check("a published snapshot makes a published source", () => {
  const source = Q.publishedSource(published);
  return source.kind === Q.PUBLISHED && source.floor === MIN_CELL;
});

await check("a keyholder snapshot is refused as a published source", () =>
  // The separation that matters most in this file. A snapshot built
  // with identify:true carries handles, the data-quality panel and
  // unquantized series, and every cell in it was built with floor 0
  // because it was never meant to leave the keyholder's tab. Serving it
  // through the published arm would publish all of that with the
  // engine's own floor logic reporting success.
  threw(() => Q.publishedSource(keyholder), "keyholder"));

await check("a snapshot of an unknown version is refused", () =>
  threw(() => Q.publishedSource(
    Object.assign({}, published, { snapshot: 99 })), "version"));

await check("a non-snapshot is refused as a published source", () =>
  threw(() => Q.publishedSource(null), "snapshot"));

await check("a published source is frozen", () =>
  Object.isFrozen(Q.publishedSource(published)));

/* ------------------------------------------------------------------ */
/* personalSource - one member's own rows, and nobody else's.          */

await check("one member's own rows make a personal source", () => {
  const source = Q.personalSource(mine, 0);
  return source.kind === Q.PERSONAL && source.floor === 0;
});

await check("rows belonging to more than one person are refused", () =>
  // The guard that makes "personal" mean something. A personal source
  // applies no floor, because a member's own data is theirs - so a bug
  // that hands this function the whole corpus would build an
  // unsuppressed cross-member dashboard and report it as personal. The
  // count comes from BinderDashboard.peopleCount, so "is this the same
  // person" still has exactly one answer in this codebase.
  threw(() => Q.personalSource(corpus, 0), "own rows"));

await check("a non-array is refused as a personal source", () =>
  threw(() => Q.personalSource("rows", 0), "rows"));

await check("no rows at all is refused rather than answered emptily", () =>
  threw(() => Q.personalSource([], 0), "rows"));

await check("a personal source keeps full precision", () => {
  // The other half of the separation, asserted positively. A published
  // series is quantized to a day and a bin edge; a member's own history
  // is not, because quantization exists to stop strangers joining two
  // documents and there are no strangers in one member's own tab.
  const source = Q.personalSource(mine, 0);
  const points = source.snapshot.series[0].points;
  return points.some((point) => point.at % 86400000 !== 0);
});

/* ------------------------------------------------------------------ */
/* run - query validation.                                             */

const pub = Q.publishedSource(published);
const own = Q.personalSource(mine, 0);

await check("an unknown basis is refused", () =>
  threw(() => Q.run(pub, { basis: "rows", split: "gender" }), "basis"));

await check("an unknown split is refused", () =>
  threw(() => Q.run(pub, { basis: "people", split: "handle" }), "split"));

await check("an unknown measure is refused", () =>
  threw(() => Q.run(pub, { split: "gender", measure: "mode" }), "measure"));

await check("a median over a categorical split is refused", () =>
  // "the median country" is not a question, and answering it with
  // something plausible is worse than refusing it.
  threw(() => Q.run(pub, { split: "country", measure: "median" }),
    "median"));

await check("a source this module did not build is refused", () =>
  // A hand-made object carrying kind:"personal" would otherwise select
  // floor 0 over a published snapshot, which is the floor being chosen
  // by the caller rather than by the source.
  threw(() => Q.run({ kind: "personal", floor: 0, snapshot: published },
    { split: "gender" }), "source"));

/* ------------------------------------------------------------------ */
/* The member's half of a refusal - #265 rows 14 to 16.                */

/*
 * WHY THIS TABLE IS IN THIS FILE AND NOT A PAGE SUITE.
 *
 * A refusal from this module has two readers: the console gets
 * `message`, with the version, the split and the cell in it, and a
 * member gets `plain`, which is the whole of what charts.html's refusal
 * card and your-page's history pane put on screen. Every page-side
 * suite stubs this module - dev/public.test.mjs builds its own error
 * objects - so those suites prove that a page PREFERS `plain` and can
 * say nothing at all about whether this file still produces one. The
 * two halves met nowhere, which meant deleting a `plain` argument here
 * left every suite and the whole gate green while the card silently
 * fell back to its house sentence for every refusal a member can reach.
 *
 * The pairing is the contract, and it is why the table is keyed on
 * `refuse()` rather than on a list of sentences somebody maintains:
 * `refuse()` is the constructor for a refusal a page may show and
 * `new Error()` is a programming fault, so a `refuse()` with no member
 * sentence is the first kind wearing the second kind's clothes. The
 * completeness arm below reads query.js's own bytes and fails if a
 * seventh `throw refuse(` appears without a row here, because a new
 * refusal added tomorrow is exactly the one nobody would think to add.
 *
 * The sentences are pinned verbatim rather than by fragment: they are
 * owner-ruled copy (#265 rows 14, 15, 16 and 42), and a paraphrase that
 * still contains the right keyword is the change this pin exists to
 * catch.
 */
const REFUSALS = [
  ["a snapshot from a newer version of the site",
    () => Q.publishedSource(Object.assign({}, published, { snapshot: 99 })),
    "They were published by a newer version of the site."],
  ["a keyholder snapshot offered as a published one",
    () => Q.publishedSource(keyholder),
    "What arrived is not the published copy this page may show."],
  ["rows belonging to more than one person",
    () => Q.personalSource(corpus, 0),
    "These do not all look like one person's entries, so nothing was " +
      "drawn."],
  ["one label claimed by two merge groups",
    () => Q.run(pub, {
      basis: "people", split: "country",
      merge: [{ as: "A", labels: ["US"] }, { as: "B", labels: ["US"] }],
    }),
    "That group is named twice — the same people would be counted twice."],
  ["a middle over a categorical split",
    () => Q.run(pub, { split: "country", measure: "median" }),
    "A middle needs numbers to work with, so it is only offered for " +
      "weight, height and BMI."],
  ["a merge naming something the figures do not show",
    () => Q.run(pub, {
      basis: "people", split: "country",
      merge: [{ as: "A", labels: ["Atlantis"] }],
    }),
    "One of those groups is not one these figures show."],
];

const errorFrom = (fn) => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
};

await check("every refusal a page may show carries the member's sentence",
  () => REFUSALS.every(([label, provoke, sentence]) => {
    const error = errorFrom(provoke);
    const ok = error !== null && error.plain === sentence;
    if (!ok) {
      console.log("  " + label + ": plain is " +
        JSON.stringify(error && error.plain));
    }
    return ok;
  }));

await check("the member's sentence never replaces the console's", () =>
  // Two registers of one claim, not one sentence doing both jobs. A
  // `plain` equal to `message` would mean the engine's nouns - split,
  // cell, snapshot version - had reached the card after all, and a
  // `message` equal to `plain` would mean whoever is debugging a
  // refused query lost the only precision they get.
  REFUSALS.every(([, provoke]) => {
    const error = errorFrom(provoke);
    return typeof error.message === "string" && error.message.length > 0 &&
      error.message !== error.plain;
  }));

await check("the table names every refusal query.js raises", async () => {
  // The arm that survives the next person's edit. Without it this table
  // guards six call sites forever while a seventh ships unpinned, which
  // is the shape of the gap it was written to close.
  const source = await readFile(HERE("../apps/web/query.js"), "utf8");
  return source.split("throw refuse(").length - 1 === REFUSALS.length;
});

await check("a programming fault carries no member sentence", () =>
  // The deliberate other direction, stated so it cannot be "fixed" by
  // sprinkling plain halves everywhere. An unknown basis, split,
  // measure or unit system is this module and a page disagreeing about
  // their own tables; a member cannot provoke one, and inventing a
  // member's sentence for it would be inventing a member's situation.
  // The pages say their own thing when no plain half arrives, and that
  // is what stops a throw added here from printing itself on a chart.
  [
    () => Q.run(pub, { basis: "rows", split: "gender" }),
    () => Q.run(pub, { basis: "people", split: "handle" }),
    () => Q.run(pub, { split: "gender", measure: "mode" }),
    () => Q.run(pub, { split: "weight", units: "furlongs" }),
    () => Q.personalSource("rows", 0),
  ].every((provoke) => {
    const error = errorFrom(provoke);
    return error !== null && error.plain === undefined;
  }));

/* ------------------------------------------------------------------ */
/* Counts, merges, and bins.                                           */

await check("a categorical split comes back as counted cells", () => {
  const result = Q.run(pub, { basis: "people", split: "gender" });
  return result.kind === "categorical" && result.available === true &&
    result.source === Q.PUBLISHED && result.cells.length > 0;
});

await check("a result is frozen", () =>
  Object.isFrozen(Q.run(pub, { basis: "people", split: "gender" })));

await check("merging labels adds their counts and keeps the total", () => {
  const plain = Q.run(pub, { basis: "people", split: "country" });
  const merged = Q.run(pub, {
    basis: "people", split: "country",
    merge: [{ as: "Anglosphere", labels: ["US", "GB"] }],
  });
  const cell = merged.cells.find((c) => c.label === "Anglosphere");
  return cell !== undefined && sum(merged.cells) === sum(plain.cells) &&
    merged.cells.length < plain.cells.length;
});

await check("a label named twice in one merge is refused", () =>
  // Two groups claiming the same cell would count those people twice,
  // and a total that no longer matches the group size is the one signal
  // a reader has that a breakdown is complete.
  threw(() => Q.run(pub, {
    basis: "people", split: "country",
    merge: [{ as: "A", labels: ["US"] }, { as: "B", labels: ["US"] }],
  }), "twice"));

await check("a merge naming a label the split does not have is refused", () =>
  threw(() => Q.run(pub, {
    basis: "people", split: "country",
    merge: [{ as: "A", labels: ["Atlantis"] }],
  }), "atlantis"));

await check("a binned split comes back as bins", () => {
  const result = Q.run(pub,
    { basis: "people", split: "weight", units: "imperial" });
  return result.kind === "bins" && result.cells.length > 0 &&
    result.cells.every((bin) => bin.to > bin.from);
});

await check("widening merges adjacent bins and keeps the total", () => {
  const fine = Q.run(pub, { basis: "people", split: "weight" });
  const wide = Q.run(pub, { basis: "people", split: "weight", widen: 2 });
  return sum(wide.cells) === sum(fine.cells) &&
    wide.cells.length <= Math.ceil(fine.cells.length / 2) &&
    wide.cells.length >= 1;
});

await check("widening by one changes nothing", () =>
  same(Q.run(pub, { basis: "people", split: "weight", widen: 1 }).cells,
    Q.run(pub, { basis: "people", split: "weight" }).cells));

await check("a widen factor below one is refused", () =>
  threw(() => Q.run(pub, { split: "weight", widen: 0 }), "widen"));

await check("a merge on a binned split is refused", () =>
  // Merging by label is how a categorical split is coarsened; a
  // histogram is coarsened by widening, which cannot reorder it. Naming
  // arbitrary bins as one cell would let a member build a
  // non-contiguous "bin" and read the gap between its parts.
  threw(() => Q.run(pub, {
    split: "weight", merge: [{ as: "A", labels: ["0"] }],
  }), "merge"));

await check("a stat measure comes back as one value", () => {
  const result = Q.run(pub,
    { basis: "people", split: "weight", measure: "median" });
  return result.kind === "stat" && typeof result.value === "number" &&
    result.cells.length === 0;
});

await check("units default to the dashboard's default", () =>
  Q.run(pub, { basis: "people", split: "weight" }).units === DEFAULT_UNITS);

await check("a categorical split reports no units", () =>
  Q.run(pub, { basis: "people", split: "gender" }).units === null);

await check("a basis the snapshot suppressed reports unavailable", () => {
  // basisOf returns null below the floor, so the honest answer is that
  // there is nothing to show - not an empty breakdown, which reads as
  // "nobody is anything".
  const thin = snapshotOf(corpus.slice(0, 3), { identify: false }, 0);
  const result = Q.run(Q.publishedSource(thin), { split: "gender" });
  return result.available === false && result.cells.length === 0 &&
    result.total === 0;
});

/* ------------------------------------------------------------------ */
/* The floor - examples first, then the properties.                    */

/*
 * A published snapshot that already breaks the rule.
 *
 * This is the fixture that arms the engine's own re-suppression. Every
 * snapshot snapshotOf() builds has already cleared the floor, so a
 * floor applied a second time in run() would be dead code against real
 * input and a mutation would not fail. The threat it answers is real
 * rather than theoretical: the engine is one page load away from any
 * document a keyholder published, including one written by an older
 * version of dashboard.js.
 */
const leaky = {
  snapshot: published.snapshot,
  generated: published.generated,
  identified: false,
  counts: { entries: 24, people: 24 },
  series: null,
  quality: null,
  bases: {
    people: {
      count: 24,
      bmi: { median: 27, mean: 27, bins: [{ from: 20, to: 25, count: 24 }] },
      /*
       * Sized so that suppressing it leaves something to look at. Fold
       * the two small cells together and the bucket holds 4, short of
       * the floor, so suppressCounts absorbs the smallest named cell -
       * male 8 - and the document reports female 12 beside Other 12.
       * Had the small cells been smaller still, absorbing would have
       * eaten every named cell and the honest answer would be an empty
       * breakdown, which is a different check.
       */
      gender: [
        { label: "female", count: 12 },
        { label: "male", count: 8 },
        { label: "nonbinary", count: 3 },
        { label: "agender", count: 1 },
      ],
      roles: [{ label: "gainer", count: 24 }],
      country: [{ label: "US", count: 23 }, { label: "JP", count: 1 }],
      imperial: {
        weight: {
          median: 200, mean: 200,
          bins: [{ from: 100, to: 120, count: 1 },
            { from: 120, to: 140, count: 22 },
            { from: 140, to: 160, count: 1 }],
        },
        height: { median: 67, mean: 67, bins: [] },
      },
      metric: {
        weight: { median: 90, mean: 90, bins: [] },
        height: { median: 170, mean: 170, bins: [] },
      },
    },
    entries: null,
  },
};

await check("a sub-floor cell in the source document is not returned", () => {
  const result = Q.run(Q.publishedSource(leaky),
    { basis: "people", split: "gender" });
  return result.cells.every((cell) => cell.count === 0 ||
    cell.count >= MIN_CELL);
});

await check("what it removes folds into Other rather than vanishing", () => {
  // Subtraction, not redaction - the rule suppressCounts already keeps.
  // Dropping "nonbinary 1" and leaving the rest to sum to 23 against a
  // stated group of 24 discloses it exactly as plainly as printing it.
  const result = Q.run(Q.publishedSource(leaky),
    { basis: "people", split: "gender" });
  return sum(result.cells) === 24 &&
    result.cells.some((cell) => cell.label === OTHER_LABEL);
});

await check("a sub-floor bin in the source document is not returned", () => {
  const result = Q.run(Q.publishedSource(leaky),
    { basis: "people", split: "weight", units: "imperial" });
  return result.cells.every((bin) => bin.count >= MIN_CELL) &&
    sum(result.cells) === 24;
});

await check("a merge naming a cell the floor removed is refused", () =>
  /*
   * What arms the suppress-before-merge order, and the only check here
   * that can tell the two orders apart.
   *
   * Merge first and "nonbinary" is a cell, so the merge succeeds and
   * the answer differs from the unmerged one by exactly the count that
   * was never published - the composition leak, reachable with two
   * clicks. Suppress first and the label is simply not in the document
   * the member was given, which is the honest answer and the safe one.
   *
   * Against a real published snapshot both orders agree, because every
   * cell in one already clears the floor. That is precisely why this
   * check needs the adversarial fixture.
   */
  threw(() => Q.run(Q.publishedSource(leaky), {
    basis: "people", split: "gender",
    merge: [{ as: "smaller groups", labels: ["nonbinary", "agender"] }],
  }), "nonbinary"));

await check("the personal arm returns a cell of one", () => {
  // The floor is not a global truth about counting - it is a property
  // of publishing. A member's own dashboard saying "you submitted once
  // in March" is the entire point of the personal arm, and an engine
  // that applied MIN_CELL here would show them nothing at all.
  const result = Q.run(own, { basis: "entries", split: "country" });
  return result.floor === 0 && result.available === true &&
    result.cells.some((cell) => cell.count < MIN_CELL) &&
    result.cells.every((cell) => cell.label !== OTHER_LABEL);
});

/* ------------------------------------------------------------------ */
/* The properties.                                                     */

/* Seeded so a failure is reproducible. mulberry32. */
const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const GENDERS = ["female", "male", "nonbinary", "", "agender"];
const COUNTRIES = ["US", "GB", "JP", "CA", "DE", "AU", "", "BR"];
const ROLES = ["feeder", "feedee", "gainer", "admirer"];

const corpusFor = (seed) => {
  const random = rng(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const size = 5 + Math.floor(random() * 60);
  const rows = [];
  for (let i = 0; i < size; i++) {
    const kg = 45 + Math.floor(random() * 120);
    const cm = 145 + Math.floor(random() * 55);
    const roles = ROLES.filter(() => random() < 0.4);
    rows.push({
      accountId: "a" + Math.floor(random() * size),
      telegram: "h" + Math.floor(random() * size),
      submittedAt: new Date(1735689600000 +
        Math.floor(random() * 20000000000)).toISOString(),
      gender: pick(GENDERS),
      country: pick(COUNTRIES),
      roles: roles,
      kg: kg,
      lb: Math.round(kg * 2.2046226218),
      cm: cm,
      totalInches: Math.round(cm / 2.54),
    });
  }
  return rows;
};

/*
 * Every query the engine can express over one source, as results.
 *
 * The merge and widen specs are what make this a composition test
 * rather than a repetition of the example checks: each one is a
 * different coarsening of the SAME people, and differencing two
 * coarsenings is exactly how a floor gets defeated.
 */
const CATEGORICAL = ["gender", "country", "roles"];
const BINNED = ["bmi", "weight", "height"];

const allResults = (source) => {
  const out = [];
  for (const basis of Q.BASES) {
    for (const split of CATEGORICAL) {
      out.push(Q.run(source, { basis: basis, split: split }));
      const plain = out[out.length - 1];
      if (plain.cells.length >= 2) {
        out.push(Q.run(source, {
          basis: basis, split: split,
          merge: [{
            as: "merged",
            labels: [plain.cells[0].label, plain.cells[1].label],
          }],
        }));
      }
    }
    for (const split of BINNED) {
      for (const units of ["imperial", "metric"]) {
        for (const widen of [1, 2, 3, 5]) {
          out.push(Q.run(source, {
            basis: basis, split: split, units: units, widen: widen,
          }));
        }
      }
    }
  }
  return out;
};

const SEEDS = 60;

await check("PROPERTY every published cell clears the floor or is zero",
  () => {
    // The headline property, and the reason this file is written as
    // properties. It is asserted over every query the engine can
    // express, not over the handful anybody thought to write down.
    for (let seed = 1; seed <= SEEDS; seed++) {
      const source = Q.publishedSource(
        snapshotOf(corpusFor(seed), { identify: false }, 0));
      for (const result of allResults(source)) {
        for (const cell of result.cells) {
          if (cell.count !== 0 && cell.count < MIN_CELL) {
            console.error("seed " + seed + " cell " + JSON.stringify(cell));
            return false;
          }
        }
      }
    }
    return true;
  });

await check("PROPERTY no query narrows the published partition", () => {
  // Union-only, stated as a count. A coarsening cannot have more cells
  // than what it coarsens, so a result with more cells than its source
  // partition is the engine having split a published cell - the one
  // operation that could produce a number the keyholder never
  // published.
  for (let seed = 1; seed <= SEEDS; seed++) {
    const snapshot = snapshotOf(corpusFor(seed), { identify: false }, 0);
    const source = Q.publishedSource(snapshot);
    for (const basis of Q.BASES) {
      const base = snapshot.bases[basis];
      if (!base) continue;
      for (const split of CATEGORICAL) {
        const result = Q.run(source, { basis: basis, split: split });
        if (result.cells.length > base[split].length) return false;
      }
      for (const units of ["imperial", "metric"]) {
        for (const split of ["weight", "height"]) {
          for (const widen of [1, 2, 3, 5]) {
            const result = Q.run(source,
              { basis: basis, split: split, units: units, widen: widen });
            if (result.cells.length > base[units][split].bins.length) {
              return false;
            }
          }
        }
      }
    }
  }
  return true;
});

await check("PROPERTY a result is empty or conserves its total", () => {
  // Nothing may quietly leave a breakdown. A published cell set that
  // sums to less than the partition it came from hands a reader the
  // remainder, which is the suppressed cell by another name.
  for (let seed = 1; seed <= SEEDS; seed++) {
    const snapshot = snapshotOf(corpusFor(seed), { identify: false }, 0);
    const source = Q.publishedSource(snapshot);
    for (const basis of Q.BASES) {
      const base = snapshot.bases[basis];
      if (!base) continue;
      for (const split of CATEGORICAL) {
        const result = Q.run(source, { basis: basis, split: split });
        const want = sum(base[split]);
        if (result.cells.length && sum(result.cells) !== want) return false;
      }
    }
  }
  return true;
});

await check("PROPERTY two coarsenings of one split agree on the total",
  () => {
    // The composition statement in its plainest form. If two ways of
    // asking the same question returned different totals, the
    // difference would be a number describing the people in the gap -
    // and nobody ever applied a floor to the gap.
    for (let seed = 1; seed <= SEEDS; seed++) {
      const source = Q.publishedSource(
        snapshotOf(corpusFor(seed), { identify: false }, 0));
      for (const basis of Q.BASES) {
        for (const split of BINNED) {
          const totals = [1, 2, 3, 5].map((widen) => sum(Q.run(source,
            { basis: basis, split: split, widen: widen }).cells));
          if (totals.some((total) => total !== totals[0])) return false;
        }
      }
    }
    return true;
  });

await check("PROPERTY overlaying two widenings cannot isolate anybody",
  () => {
    /*
     * The attack DESIGN.md's "one partition, not two" was written for,
     * aimed at this engine instead of at the unit toggle.
     *
     * A member widens the same histogram two different ways and lays
     * the results over each other. Every boundary in one is a boundary
     * the other may not share, so the overlay is a FINER partition than
     * either - and the question is whether it is finer than what was
     * published. It is not, and the reason is structural: both results
     * are unions of the same published bins, so every non-empty region
     * of the overlay contains at least one whole published bin, and
     * every published bin already cleared the floor.
     *
     * Asserted against real engine output rather than against a model
     * of it, because a model would prove the model right.
     */
    for (let seed = 1; seed <= SEEDS; seed++) {
      const source = Q.publishedSource(
        snapshotOf(corpusFor(seed), { identify: false }, 0));
      for (const basis of Q.BASES) {
        for (const split of BINNED) {
          const a = Q.run(source, { basis: basis, split: split, widen: 2 });
          const b = Q.run(source, { basis: basis, split: split, widen: 3 });
          if (!a.available || !b.available) continue;
          for (const one of a.cells) {
            for (const other of b.cells) {
              const from = Math.max(one.from, other.from);
              const to = Math.min(one.to, other.to);
              if (!(to > from)) continue;          // they do not overlap
              // The overlap is a whole number of published bins, so the
              // smallest thing it can describe is one of them.
              const smallest = Math.min(one.count, other.count);
              if (smallest < MIN_CELL) return false;
            }
          }
        }
      }
    }
    return true;
  });

/*
 * A published document carrying whatever bins a check wants to hand it.
 *
 * The properties above run over documents snapshotOf() built, and every
 * bin in one of those already clears the floor - which makes the two
 * possible orderings inside run() indistinguishable. Distinguishing
 * them needs a document whose bins do not, and that document has to be
 * written by hand.
 */
const binsSnapshot = (counts) => ({
  snapshot: published.snapshot,
  generated: published.generated,
  identified: false,
  counts: { entries: 0, people: 0 },
  series: null,
  quality: null,
  bases: {
    people: {
      count: 0,
      bmi: { median: null, mean: null, bins: [] },
      gender: [], roles: [], country: [],
      imperial: {
        weight: {
          median: null, mean: null,
          bins: counts.map((count, i) => ({
            from: i * 20, to: (i + 1) * 20, count: count,
          })),
        },
        height: { median: null, mean: null, bins: [] },
      },
      metric: {
        weight: { median: null, mean: null, bins: [] },
        height: { median: null, mean: null, bins: [] },
      },
    },
    entries: null,
  },
});

await check("PROPERTY every widening is a coarsening of one partition",
  () => {
    /*
     * The safety theorem stated exactly, and the check that arms the
     * suppress-before-widen order.
     *
     * Every answer must be a coarsening of ONE partition, so every band
     * edge any widening produces has to be an edge of the unwidened
     * answer. Widen first and suppress after, and each factor clears
     * the floor by merging a different set of neighbours - widen 3 over
     * six bins of three yields a boundary in the middle of a band that
     * widen 2 reported whole, and two partitions that cut each other is
     * the overlay DESIGN.md's "one partition, not two" was written
     * about.
     *
     * Asserted on edges rather than on counts because counts hide it:
     * both orderings return bands that individually clear the floor,
     * and it is where the boundaries fall that says whether they can be
     * laid over each other.
     */
    const vectors = [
      [3, 3, 3, 3, 3, 3],
      [1, 1, 9, 1, 1, 1, 9],
      [2, 2, 2, 2, 2, 2, 2, 2, 2],
      [7, 1, 1, 7, 1, 1, 7],
      [4, 4, 4, 4],
      [1, 2, 3, 4, 5, 6, 7],
    ];
    for (const counts of vectors) {
      const source = Q.publishedSource(binsSnapshot(counts));
      const ask = (widen) => Q.run(source, {
        basis: "people", split: "weight", units: "imperial", widen: widen,
      });
      const edges = new Set();
      for (const bin of ask(1).cells) {
        edges.add(bin.from);
        edges.add(bin.to);
      }
      for (const widen of [2, 3, 4, 5]) {
        for (const bin of ask(widen).cells) {
          if (!edges.has(bin.from) || !edges.has(bin.to)) {
            console.error("counts " + JSON.stringify(counts) + " widen " +
              widen + " band " + JSON.stringify(bin));
            return false;
          }
        }
      }
    }
    return true;
  });

await check("PROPERTY both unit systems report one partition", () => {
  // The engine's safety argument rests on this being true of the
  // document it reads: imperial and metric are the same grouping with
  // converted edges, so widening them differently cannot produce two
  // partitions to intersect. dashboard.js's repartition() is what makes
  // it true; this is the engine pinning the assumption it depends on,
  // rather than trusting a neighbour's comment.
  for (let seed = 1; seed <= SEEDS; seed++) {
    const source = Q.publishedSource(
      snapshotOf(corpusFor(seed), { identify: false }, 0));
    for (const basis of Q.BASES) {
      for (const split of ["weight", "height"]) {
        const a = Q.run(source,
          { basis: basis, split: split, units: "imperial" });
        const b = Q.run(source,
          { basis: basis, split: split, units: "metric" });
        if (!same(a.cells.map((c) => c.count),
          b.cells.map((c) => c.count))) return false;
      }
    }
  }
  return true;
});

await check("PROPERTY a personal source never suppresses", () => {
  // The separation, over generated input. A member's own rows are
  // theirs, and an engine that hid their own March from them because
  // March held one entry would be applying a rule about strangers to
  // somebody's own diary.
  for (let seed = 1; seed <= SEEDS; seed++) {
    const rows = corpusFor(seed).map((row) =>
      Object.assign({}, row, { accountId: "one", telegram: "one" }));
    const source = Q.personalSource(rows, 0);
    for (const result of allResults(source)) {
      if (result.cells.some((cell) => cell.label === OTHER_LABEL)) {
        return false;
      }
    }
  }
  return true;
});

/* ------------------------------------------------------------------ */
/* describe - the sentence the UI puts above a chart.                  */

await check("describe names the measure, the split and the basis", () => {
  const text = Q.describe({ basis: "people", split: "country" });
  return text.includes("country") && text.includes("people");
});

await check("describe says which unit system a binned split used", () =>
  Q.describe({ basis: "people", split: "weight", units: "metric" })
    .includes("metric"));

await check("describe refuses a query run would refuse", () =>
  // One validator, not two. A UI that can describe a query it cannot
  // run will print a caption above an error.
  threw(() => Q.describe({ basis: "people", split: "handle" }), "split"));

await check("NOT_STATED survives as its own cell where it clears the floor",
  () => {
    // Blanks are a bar, not a gap - countBy's rule, and the engine must
    // not quietly fold them away while claiming to report a breakdown.
    const rows = [];
    for (let i = 0; i < 30; i++) {
      rows.push(entry({ gender: i < 20 ? "female" : "", country: "US" }));
    }
    const result = Q.run(
      Q.publishedSource(snapshotOf(rows, { identify: false }, 0)),
      { basis: "people", split: "gender" });
    return result.cells.some((cell) => cell.label === NOT_STATED);
  });

report();
