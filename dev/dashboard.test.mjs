/*
 * Checks for the pure half of apps/web/dashboard.js.
 *
 *     node dev/dashboard.test.mjs
 *
 * Aggregation is where a dashboard lies quietly. A median taken over
 * the wrong rows, a person counted once per submission, a blank
 * silently dropped from a breakdown - none of them throw, and a chart
 * that is wrong is indistinguishable from a chart that is right. The
 * drawing is checked by looking at it; the arithmetic is checked here.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { nodeTestSuite } from "./harness.mjs";

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));

const load = async (path) => {
  const src = await readFile(HERE(path), "utf8");
  await import("data:text/javascript," + encodeURIComponent(src));
};

await load("../apps/web/dashboard.js");

const {
  NOT_STATED, DEFAULT_UNITS, unitsFor, formatInches, statText,
  median, mean, bmi, latestPerPerson, peopleCount,
  histogram, countBy, countRoles, weightSeries, heightDisagreements,
  handleDisagreements, summarise,
  suppressCounts, suppressBins, MIN_CELL, OTHER_LABEL,
} = globalThis.BinderDashboard;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/*
 * The count is asserted rather than only printed. Aggregation is where a
 * dashboard lies quietly, and a check that stops running here takes a
 * silent wrong number with it - the same failure the arithmetic below is
 * about, one level up. See dev/harness.mjs.
 */
const { check, report } = nodeTestSuite("dashboard.js", 138);

await check("the exported object is frozen", () =>
  // `suppressCounts` and MIN_CELL are the suppression floor standing
  // between an aggregate and a re-identifiable one, so an export a later
  // script can rewrite is a floor that can be lowered on the page that
  // publishes the numbers. tools/check_web.py check 15 holds the rule
  // across the whole directory; this asserts it for the shipped bytes.
  Object.isFrozen(globalThis.BinderDashboard));

await check("the headless export carries no drawing half", () =>
  // The other side of the seam dev/dashboard-render.test.mjs pins. This
  // file is what proves the arithmetic runs with no document, and the
  // freeze is taken on one object that already has every key it will
  // ever have - so `render` being absent HERE is what says the
  // conditional above the freeze is doing its job.
  globalThis.BinderDashboard.render === undefined);

await check("the headless export carries no per-surface drawing half either",
  () =>
    // The split gave the drawing half a second entry point, and a seam
    // pinned for one name and not the other is a seam half-pinned: the
    // new name is the one nothing had a habit of checking, so it is the
    // one that would have been exported under Node without anybody
    // noticing until it threw on its first `document`.
    globalThis.BinderDashboard.renderProgress === undefined);

/*
 * A row as entryFor() hands it to this file, carrying both identities.
 *
 * DESIGN.md, "The identifier is the whole problem": the account id is
 * the identity and the handle is a label the member's own browser
 * wrote. Unless a check says otherwise each handle gets an account of
 * its own, which is the ordinary case - nobody renamed, and nobody
 * typed somebody else's handle. The checks that are about this
 * distinction set `accountId` themselves, because the whole question is
 * what happens on the rows where the two disagree.
 *
 * Defaulting it from the handle rather than leaving it out is
 * deliberate: a fixture with no account ids anywhere would drive the
 * fallback on every check in the file and never the identity path that
 * ships.
 */
const entry = (over) => {
  const row = Object.assign({
    id: 1, receivedAt: "2026-08-05T00:00:00.000Z",
    submittedAt: "2026-08-05T00:00:00.000Z",
    telegram: "somehandle", kg: 90, lb: 198.4, cm: 180,
    totalInches: 70.9, feet: 5, inches: 10.9,
    enteredUnits: "metric", enteredWeight: "90 kg", enteredHeight: "180 cm",
    gender: "male", roles: ["feedee"], country: "US",
    over18: true, recordVersion: 1,
  }, over);
  if (!over || !("accountId" in over)) {
    row.accountId = row.telegram ? "acct-" + row.telegram : null;
  }
  return row;
};

/* Someone who submitted three times, gaining. Both unit systems move
 * together, the way a real row does - a fixture that changed only the
 * kg would make an imperial chart look like a flat line and the test
 * that noticed would be reporting on the fixture. */
const REPEATER = [
  entry({ id: 1, telegram: "gainer1", kg: 90, lb: 198.4, submittedAt: "2026-01-01T00:00:00.000Z" }),
  entry({ id: 2, telegram: "gainer1", kg: 96, lb: 211.6, submittedAt: "2026-04-01T00:00:00.000Z" }),
  entry({ id: 3, telegram: "gainer1", kg: 104, lb: 229.3, submittedAt: "2026-07-01T00:00:00.000Z" }),
];

/* ------------------------------------------------------------------ */
/* Averages.                                                           */

await check("the median of an odd count is the middle value", () =>
  median([1, 5, 100]) === 5);

await check("the median of an even count is the midpoint", () =>
  median([10, 20]) === 15);

await check("the median ignores the order it was given in", () =>
  median([100, 1, 5]) === 5);

/* Sorting numbers with the default comparator sorts them as strings,
 * which puts 100 before 20 and quietly returns the wrong median. */
await check("the median sorts numerically, not lexically", () =>
  median([9, 10, 100]) === 10);

await check("an average of nothing is nothing, not zero", () =>
  median([]) === null && mean([]) === null);

await check("the mean is rounded to one place", () =>
  mean([1, 2]) === 1.5 && mean([1, 1, 2]) === 1.3);

/* ------------------------------------------------------------------ */
/* BMI.                                                                */

await check("BMI is weight over height in metres squared", () =>
  bmi(90, 180) === 27.8);

await check("BMI needs both halves", () =>
  bmi(90, null) === null && bmi(null, 180) === null && bmi(90, "") === null);

/* A height of zero would divide by zero and report Infinity as a fact
 * about somebody. */
await check("a zero height does not produce a number", () =>
  bmi(90, 0) === null);

/* ------------------------------------------------------------------ */
/* People versus entries.                                              */

await check("a repeat submitter is one person", () =>
  peopleCount(REPEATER) === 1 && REPEATER.length === 3);

await check("the latest entry is the one kept", () =>
  latestPerPerson(REPEATER)[0].kg === 104);

await check("the latest is by time, not by position in the list", () => {
  const shuffled = [REPEATER[2], REPEATER[0], REPEATER[1]];
  return latestPerPerson(shuffled)[0].kg === 104;
});

/*
 * Who is one person, and who is two.
 *
 * These four are the contract this file exists to state, and they say
 * something different from what "one per person" said while the
 * grouping keyed on the handle. DESIGN.md, "The identifier is the whole
 * problem": the account id is set server-side from a verified sign-in
 * and cannot be forged by the page; the handle inside the encrypted
 * blob is a label written by the client. So the id decides, the handle
 * describes, and each of the two ways they can disagree is a person
 * miscounted.
 */
await check("different account ids are different people", () =>
  peopleCount([
    entry({ accountId: "acct-a", telegram: "a" }),
    entry({ accountId: "acct-b", telegram: "b" }),
  ]) === 2);

/* The rename. One member, one account, two spellings - and grouping on
 * the handle reports them as two people, halves both their histories
 * and double-counts them in every distribution. */
await check("a rename is one person, not two", () =>
  peopleCount([
    entry({ id: 1, accountId: "acct-one", telegram: "oldname",
            submittedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ id: 2, accountId: "acct-one", telegram: "newname",
            submittedAt: "2026-02-01T00:00:00.000Z" }),
  ]) === 1);

/* The other direction, and the worse one. Two members, two verified
 * accounts, one spelling between them - either a typo or somebody
 * writing a handle that is not theirs. Grouping on the handle merges
 * two strangers' measurements into one person's history. */
await check("two accounts that typed the same handle are two people", () =>
  peopleCount([
    entry({ id: 1, accountId: "acct-one", telegram: "same" }),
    entry({ id: 2, accountId: "acct-two", telegram: "same" }),
  ]) === 2);

/* The handle is display, so the row kept for a renamed person is still
 * the newest one - the rename does not reset their history. */
await check("the latest entry wins across a rename", () =>
  latestPerPerson([
    entry({ id: 1, accountId: "acct-one", telegram: "oldname", kg: 90,
            submittedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ id: 2, accountId: "acct-one", telegram: "newname", kg: 104,
            submittedAt: "2026-02-01T00:00:00.000Z" }),
  ])[0].kg === 104);

/*
 * The fallback, decided and pinned rather than left to emerge.
 *
 * Every row the Worker stores carries an account id - server/schema.sql
 * declares the column NOT NULL and handleExport selects it - so a row
 * without one reached this page from somewhere else: an export file
 * saved from an earlier database, or a payload assembled by hand. The
 * rule is that an absent id must never act as a shared one, because
 * DESIGN.md makes the id the identity and nothing is not an identity.
 * So such a row falls back to its handle, and a row with neither stands
 * alone.
 */
await check("a row with no account id falls back to its handle", () =>
  peopleCount([
    entry({ id: 1, accountId: null, telegram: "x" }),
    entry({ id: 2, accountId: null, telegram: "x" }),
  ]) === 1 &&
  peopleCount([
    entry({ id: 1, accountId: null, telegram: "x" }),
    entry({ id: 2, accountId: null, telegram: "y" }),
  ]) === 2);

/* The merge that must not happen: everything the page cannot identify
 * gathered into one enormous submitter. */
await check("rows with neither an id nor a handle are not merged together",
  () => peopleCount([
    entry({ id: 1, accountId: null, telegram: null }),
    entry({ id: 2, accountId: null, telegram: null }),
  ]) === 2);

/* An identified row and an unidentified one are not the same person on
 * the strength of a handle the second one cannot vouch for. */
await check("a row with no id does not join an account by handle alone", () =>
  peopleCount([
    entry({ id: 1, accountId: "acct-one", telegram: "x" }),
    entry({ id: 2, accountId: null, telegram: "x" }),
  ]) === 2);

/* The two key spaces must not run into each other: an account id that
 * reads like a handle is still not that handle. */
await check("an account id cannot collide with a handle that spells it", () =>
  peopleCount([
    entry({ id: 1, accountId: "x", telegram: "somebody" }),
    entry({ id: 2, accountId: null, telegram: "x" }),
  ]) === 2);

await check("a person with no timestamps at all is still counted once", () =>
  peopleCount([
    entry({ id: 1, telegram: "x", submittedAt: null, receivedAt: null }),
    entry({ id: 2, telegram: "x", submittedAt: null, receivedAt: null }),
  ]) === 1);

/* ------------------------------------------------------------------ */
/* Bins.                                                               */

await check("every value lands in exactly one bin", () => {
  const values = [1, 9, 10, 11, 25, 39];
  const bins = histogram(values, 10);
  const total = bins.reduce((sum, bin) => sum + bin.count, 0);
  return total === values.length;
});

await check("bins start on a round multiple of their width", () => {
  const bins = histogram([13, 27], 10);
  return bins[0].from === 10 && bins[bins.length - 1].to === 30;
});

/* The topmost value sits exactly on the last bin's upper edge, and
 * floor() would put it in a bin that does not exist. Dropping it is
 * silent: the chart is simply short by the heaviest person. */
await check("the highest value is not lost off the top bin", () => {
  const bins = histogram([10, 20], 10);
  const total = bins.reduce((sum, bin) => sum + bin.count, 0);
  return total === 2;
});

await check("one value still produces one bin", () =>
  histogram([42], 10).length === 1);

await check("no values produce no bins rather than an error", () =>
  same(histogram([], 10), []) && same(histogram([1], 0), []));

/* ------------------------------------------------------------------ */
/* Breakdowns.                                                         */

await check("categories are counted and sorted by size", () => {
  const counts = countBy(
    [entry({ gender: "male" }), entry({ gender: "female" }),
     entry({ gender: "male" })],
    (e) => e.gender);
  return same(counts, [
    { label: "male", count: 2 },
    { label: "female", count: 1 },
  ]);
});

/*
 * Blanks are a bar, not a deletion. "60% male" reads very differently
 * from "60% of the third of people who answered", and a chart that
 * drops the blanks claims the first while meaning the second.
 */
await check("unanswered is kept as its own category", () => {
  const counts = countBy(
    [entry({ gender: "male" }), entry({ gender: null }), entry({ gender: "" })],
    (e) => e.gender);
  return counts.length === 2 &&
    counts[1].label === NOT_STATED && counts[1].count === 2;
});

await check("unanswered sorts last even when it is the biggest", () => {
  const counts = countBy(
    [entry({ gender: null }), entry({ gender: null }), entry({ gender: "male" })],
    (e) => e.gender);
  return counts[0].label === "male" && counts[1].label === NOT_STATED;
});

const VOCAB = ["feeder", "feedee", "gainer", "admirer"];

/* Multi-select, so these deliberately do not sum to the entry count. */
await check("someone with two affiliations is counted under both", () => {
  const counts = countRoles([entry({ roles: ["feeder", "gainer"] })], VOCAB);
  const of = (name) => counts.find((c) => c.label === name).count;
  return of("feeder") === 1 && of("gainer") === 1 && of("feedee") === 0;
});

await check("an affiliation nobody picked still appears, at zero", () =>
  countRoles([entry({ roles: [] })], VOCAB).length === VOCAB.length + 1);

await check("picking none is counted as not stated", () => {
  const counts = countRoles([entry({ roles: [] })], VOCAB);
  return counts[counts.length - 1].label === NOT_STATED &&
    counts[counts.length - 1].count === 1;
});

/* ------------------------------------------------------------------ */
/* Weight over time.                                                   */

await check("a repeat submitter becomes one series in order", () => {
  const series = weightSeries(REPEATER);
  return series.length === 1 &&
    same(series[0].points.map((p) => p.metric), [90, 96, 104]);
});

await check("points are sorted by time, not by arrival", () => {
  const series = weightSeries([REPEATER[2], REPEATER[0], REPEATER[1]]);
  return same(series[0].points.map((p) => p.metric), [90, 96, 104]);
});

/* One entry is a point, not a trend. Drawing it as a line implies a
 * history that does not exist. */
await check("someone with a single entry gets no line", () =>
  weightSeries([entry({ telegram: "once" })]).length === 0);

await check("an entry with no weight is left out of the series", () =>
  weightSeries([
    entry({ id: 1, telegram: "x", kg: 90, submittedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ id: 2, telegram: "x", kg: null, submittedAt: "2026-02-01T00:00:00.000Z" }),
  ]).length === 0);

/*
 * Every point carries both systems, which is what lets one series be
 * drawn in either. Building it twice - once per system - would be two
 * traversals free to disagree about which points exist, and the
 * disagreement would look like a line with a year missing from it.
 */
await check("one series carries both unit systems per point", () => {
  const points = weightSeries(REPEATER)[0].points;
  return same(points.map((p) => p.metric), [90, 96, 104]) &&
    same(points.map((p) => p.imperial), [198.4, 211.6, 229.3]);
});

/*
 * The series groups on the identity too, and this is where keying on
 * the handle did the most damage. A rename cut one rising line into two
 * short ones and the chart read as two members who each submitted
 * twice; a shared handle drew two strangers' weights as one person
 * gaining and losing.
 */
const RENAMED = [
  entry({ id: 1, accountId: "acct-one", telegram: "oldname",
          kg: 90, lb: 198.4, submittedAt: "2026-01-01T00:00:00.000Z" }),
  entry({ id: 2, accountId: "acct-one", telegram: "oldname",
          kg: 96, lb: 211.6, submittedAt: "2026-04-01T00:00:00.000Z" }),
  entry({ id: 3, accountId: "acct-one", telegram: "newname",
          kg: 104, lb: 229.3, submittedAt: "2026-07-01T00:00:00.000Z" }),
];

await check("a rename is one line, not two", () => {
  const series = weightSeries(RENAMED);
  return series.length === 1 &&
    same(series[0].points.map((p) => p.metric), [90, 96, 104]);
});

/* The handle is the label, and the label is the one they answer to now.
 * A line captioned with a spelling its owner has abandoned is the
 * keyholder looking for somebody who is not in their contacts. */
await check("a renamed line is labelled with the most recent handle", () =>
  weightSeries(RENAMED)[0].telegram === "newname");

await check("two accounts sharing a handle are two lines", () =>
  weightSeries([
    entry({ id: 1, accountId: "acct-one", telegram: "same", kg: 90,
            lb: 198.4, submittedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ id: 2, accountId: "acct-one", telegram: "same", kg: 96,
            lb: 211.6, submittedAt: "2026-02-01T00:00:00.000Z" }),
    entry({ id: 3, accountId: "acct-two", telegram: "same", kg: 70,
            lb: 154.3, submittedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ id: 4, accountId: "acct-two", telegram: "same", kg: 68,
            lb: 149.9, submittedAt: "2026-02-01T00:00:00.000Z" }),
  ]).length === 2);

/* A row belongs to its account whether or not it carries a handle, so
 * its weight is that person's weight. Dropping the point would put a
 * gap in a line for a field that is only ever a caption. */
await check("a row with no handle still contributes a point to its account",
  () => {
    const series = weightSeries([
      entry({ id: 1, accountId: "acct-one", telegram: "named", kg: 90,
              lb: 198.4, submittedAt: "2026-01-01T00:00:00.000Z" }),
      entry({ id: 2, accountId: "acct-one", telegram: null, kg: 96,
              lb: 211.6, submittedAt: "2026-02-01T00:00:00.000Z" }),
    ]);
    return series.length === 1 && series[0].points.length === 2 &&
      series[0].telegram === "named";
  });

/* There is nothing to caption a line with, and "@undefined" on a chart
 * is worse than an absent line. */
await check("a person with no handle at all gets no line", () =>
  weightSeries([
    entry({ id: 1, accountId: "acct-one", telegram: null, kg: 90,
            lb: 198.4, submittedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ id: 2, accountId: "acct-one", telegram: null, kg: 96,
            lb: 211.6, submittedAt: "2026-02-01T00:00:00.000Z" }),
  ]).length === 0);

/* ------------------------------------------------------------------ */
/* Data quality.                                                       */

/*
 * Height does not change in adults, so a difference between two
 * entries is a typo, a unit mix-up, or one handle used by two people -
 * all things worth knowing before trusting the height figures.
 */
await check("a height that moved between entries is reported", () => {
  const found = heightDisagreements([
    entry({ id: 1, telegram: "x", cm: 180, submittedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ id: 2, telegram: "x", cm: 165, submittedAt: "2026-02-01T00:00:00.000Z" }),
  ]);
  return found.length === 1 && found[0].low === 165 && found[0].high === 180;
});

/* Converting 5 ft 11 in to cm and back does not land on the same
 * number twice; a centimetre of slack is rounding, not a discrepancy. */
await check("rounding between unit systems is not reported as a change", () =>
  heightDisagreements([
    entry({ id: 1, telegram: "x", cm: 177.8 }),
    entry({ id: 2, telegram: "x", cm: 178 }),
  ]).length === 0);

await check("a single entry cannot disagree with itself", () =>
  heightDisagreements([entry({ telegram: "x", cm: 180 })]).length === 0);

/* The panel reports on a person, and a person is an account. A rename
 * that hid a height change from this list would hide it in the one
 * place somebody was going to act on it. */
await check("a height that moved across a rename is still reported", () => {
  const found = heightDisagreements([
    entry({ id: 1, accountId: "acct-one", telegram: "oldname", cm: 180,
            submittedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ id: 2, accountId: "acct-one", telegram: "newname", cm: 165,
            submittedAt: "2026-02-01T00:00:00.000Z" }),
  ]);
  return found.length === 1 && found[0].telegram === "newname" &&
    found[0].low === 165 && found[0].high === 180;
});

/* Two people are not a discrepancy. Reporting them as one person whose
 * height moved sends the keyholder to correct a typo that does not
 * exist, and leaves the actual finding - two accounts, one handle -
 * unsaid. */
await check("two accounts sharing a handle are not a height discrepancy", () =>
  heightDisagreements([
    entry({ id: 1, accountId: "acct-one", telegram: "same", cm: 180 }),
    entry({ id: 2, accountId: "acct-two", telegram: "same", cm: 165 }),
  ]).length === 0);

/*
 * The finding DESIGN.md says is there to be made.
 *
 * "Two handles under one account id is a rename or a lie, and is
 * detectable." Detectable is not the same as detected, and the charts
 * draw the account as one person either way - so the keyholder, who is
 * the only person able to tell a rename from a lie, is told.
 */
await check("two handles under one account are reported", () => {
  const found = handleDisagreements([
    entry({ id: 1, accountId: "acct-one", telegram: "oldname",
            submittedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ id: 2, accountId: "acct-one", telegram: "newname",
            submittedAt: "2026-02-01T00:00:00.000Z" }),
  ]);
  return found.length === 1 && same(found[0].handles, ["newname", "oldname"]);
});

await check("one handle under one account is not reported", () =>
  handleDisagreements([
    entry({ id: 1, accountId: "acct-one", telegram: "steady",
            submittedAt: "2026-01-01T00:00:00.000Z" }),
    entry({ id: 2, accountId: "acct-one", telegram: "steady",
            submittedAt: "2026-02-01T00:00:00.000Z" }),
  ]).length === 0);

/* Two accounts with two handles is two ordinary people, and saying so
 * would bury the real finding under every member of the group. */
await check("two accounts with a handle each are not reported", () =>
  handleDisagreements([
    entry({ id: 1, accountId: "acct-one", telegram: "a" }),
    entry({ id: 2, accountId: "acct-two", telegram: "b" }),
  ]).length === 0);

/*
 * A group assembled by the handle fallback has exactly one handle by
 * construction, so it can never disagree with itself. Reporting it
 * would be the panel describing its own grouping rule rather than the
 * data.
 */
await check("rows with no account id are outside this panel entirely", () =>
  handleDisagreements([
    entry({ id: 1, accountId: null, telegram: "a" }),
    entry({ id: 2, accountId: null, telegram: "b" }),
  ]).length === 0);

/* ------------------------------------------------------------------ */
/* The summary strip.                                                  */

await check("the summary separates entries from people", () => {
  const stats = summarise(REPEATER, "metric");
  return stats.entries === 3 && stats.people === 1;
});

await check("the summary skips missing values rather than counting zeros",
  () => {
    const stats = summarise(
      [entry({ kg: 90 }), entry({ id: 2, kg: null })], "metric");
    return stats.weightMedian === 90;
  });

await check("a summary of nothing reports nothing, not zero", () => {
  const stats = summarise([]);
  return stats.entries === 0 && stats.people === 0 &&
    stats.weightMedian === null && stats.bmiMedian === null;
});

/* ------------------------------------------------------------------ */
/* Units.                                                              */

/*
 * The whole point of storing both systems is that this file never
 * converts. These checks are what would fail if somebody "tidied up"
 * by multiplying kg by 2.2 instead of reading the lb the row already
 * carries - the numbers would be close enough to look right and wrong
 * enough to be wrong.
 */
const MIXED = entry({ kg: 90, lb: 999, cm: 180, totalInches: 111 });

await check("imperial reads the stored pounds, it does not convert kg", () =>
  summarise([MIXED], "imperial").weightMedian === 999);

await check("metric reads the stored kg", () =>
  summarise([MIXED], "metric").weightMedian === 90);

await check("imperial reads the stored total inches", () =>
  summarise([MIXED], "imperial").heightMedian === 111);

await check("the series carries the same field the summary reads", () => {
  const series = weightSeries(REPEATER);
  return same(series[0].points.map((p) => p.imperial), [198.4, 211.6, 229.3]) &&
    summarise([REPEATER[2]], "imperial").weightMedian === 229.3;
});

/* The default is imperial everywhere - the form's default, and the one
 * this project asked for. Absent and unrecognized both mean it. */
await check("units default to imperial", () =>
  DEFAULT_UNITS === "imperial" &&
  summarise([MIXED]).weightMedian === 999 &&
  summarise([MIXED], "furlongs").weightMedian === 999 &&
  unitsFor(undefined).name === "imperial");

/*
 * BMI is defined in kg and metres, so it is the same number whatever
 * the toggle says. The alternative is either a different BMI for the
 * same person or a second formula carrying a 703.
 */
await check("BMI does not move when the units do", () =>
  summarise([MIXED], "imperial").bmiMedian ===
  summarise([MIXED], "metric").bmiMedian);

await check("a height reads as feet and inches", () =>
  formatInches(68) === "5'8\"" && formatInches(72) === "6'0\"" &&
  formatInches(63) === "5'3\"");

/* The carry that bit form.js: 71.98 in is 5 ft 11.98 in, which rounds
 * to a height nobody writes as 5 ft 12 in. Rounding to whole inches
 * before dividing is what keeps a twelfth inch impossible here. */
await check("a height that rounds up to a whole foot carries", () =>
  formatInches(71.98) === "6'0\"" && formatInches(71.6) === "6'0\"" &&
  formatInches(71.4) === "5'11\"");

await check("a missing measurement is a dash, not a zero", () =>
  statText(null, unitsFor("imperial").weight) === "—" &&
  statText(undefined, unitsFor("metric").height) === "—");

await check("a standalone figure carries its own unit", () =>
  statText(200, unitsFor("imperial").weight) === "200 lb" &&
  statText(90, unitsFor("metric").weight) === "90 kg" &&
  statText(180, unitsFor("metric").height) === "180 cm" &&
  statText(68, unitsFor("imperial").height) === "5'8\"");

/*
 * Who appears on the height panel must not depend on a display toggle.
 * If the 1 cm slack moved with the units, switching them would add and
 * drop people from a data-quality panel, which would make the panel a
 * report on itself.
 */
await check("the height panel carries both systems and detects in metric",
  () => {
    const found = heightDisagreements([
      entry({ id: 1, telegram: "x", cm: 180, totalInches: 70.9,
              submittedAt: "2026-01-01T00:00:00.000Z" }),
      entry({ id: 2, telegram: "x", cm: 165, totalInches: 65,
              submittedAt: "2026-02-01T00:00:00.000Z" }),
    ]);
    return found.length === 1 &&
      found[0].low === 165 && found[0].high === 180 &&
      found[0].lowInches === 65 && found[0].highInches === 70.9;
  });

/* A row written before totalInches existed has a cm and nothing else.
 * Reporting null inches is what lets the page fall back rather than
 * printing "null to null". */
await check("a row with no inches reports null rather than inventing them",
  () => {
    const found = heightDisagreements([
      entry({ id: 1, telegram: "x", cm: 180, totalInches: null }),
      entry({ id: 2, telegram: "x", cm: 165, totalInches: null }),
    ]);
    return found.length === 1 && found[0].lowInches === null;
  });

/* ------------------------------------------------------------------ */
/* The snapshot.                                                       */

/*
 * These are the checks that matter most in this file, because a
 * snapshot is the one thing here that gets published. Everything else
 * is wrong on a page one person looks at; this is wrong on the open
 * web, permanently, and a leak cannot be taken back by fixing the code
 * afterwards.
 *
 * So the central check is not that the numbers are right - it is that
 * no handle is anywhere in the document.
 */
const { snapshotOf, SNAPSHOT_VERSION, movedSince } = globalThis.BinderDashboard;

/*
 * Big enough to be publishable, which is a constraint the suppression
 * floor added and this fixture predates.
 *
 * It used to be three people and two series lines. Every check below it
 * was therefore asserting on a document that can no longer exist: under
 * the floor, a group that small publishes no breakdown and no series at
 * all. Growing the fixture is the honest fix - the alternative is
 * testing the published path with data that would never be published.
 *
 * Seven people, six of them repeat submitters, so both the bases and
 * the series clear MIN_CELL and the quantisation checks below are
 * exercising the real published document.
 */
const CORPUS = REPEATER.concat([
  entry({ id: 10, telegram: "loner", kg: 70, lb: 154.3, cm: 165,
          totalInches: 65, gender: "female", country: "GB", roles: [],
          submittedAt: "2026-03-01T00:00:00.000Z" }),
  entry({ id: 11, telegram: "shifty", kg: 80, lb: 176.4, cm: 180,
          totalInches: 70.9, submittedAt: "2026-03-01T00:00:00.000Z" }),
  entry({ id: 12, telegram: "shifty", kg: 82, lb: 180.8, cm: 165,
          totalInches: 65, submittedAt: "2026-05-01T00:00:00.000Z" }),
]).concat([2, 3, 4, 5].flatMap((n, i) => [
  entry({ id: 20 + i * 2, telegram: "gainer" + n,
          kg: 88 + n, lb: (88 + n) * 2.20462, cm: 175, totalInches: 68.9,
          submittedAt: "2026-02-0" + (n - 1) + "T00:00:00.000Z" }),
  entry({ id: 21 + i * 2, telegram: "gainer" + n,
          kg: 94 + n, lb: (94 + n) * 2.20462, cm: 175, totalInches: 68.9,
          submittedAt: "2026-06-0" + (n - 1) + "T00:00:00.000Z" }),
]));

const CORPUS_ENTRIES = CORPUS.length;              // 14
const CORPUS_PEOPLE = peopleCount(CORPUS);         // 7

await check("a published snapshot contains no handle anywhere", () => {
  const text = JSON.stringify(snapshotOf(CORPUS, { identify: false }));
  return !text.includes("gainer1") && !text.includes("loner") &&
    !text.includes("shifty");
});

/*
 * A corpus with a rename in it.
 *
 * The two checks below are about what a document may carry, and both of
 * them read the quality panel. Run against a corpus where no account
 * holds two handles, that panel is empty and the checks pass whatever
 * the panel would have put in it - which is what a first version of
 * them did, and two mutations that leaked an account id survived both.
 * So the fixture has to reach the branch, and each check says out loud
 * that it did.
 */
const CORPUS_RENAMED = CORPUS.concat([
  entry({ id: 40, accountId: "acct-gainer1", telegram: "gainer1_after",
          kg: 106, lb: 233.7, submittedAt: "2026-08-01T00:00:00.000Z" }),
]);

/*
 * And no account id either, which is a second thing to guard now that
 * the entries carry one.
 *
 * The handle check above would not catch it: an account id is not a
 * handle and does not spell like one. DESIGN.md accepts the id sitting
 * in the clear *in the database*, where it makes rows groupable and
 * reveals that some account submitted twelve times, never who. A
 * published document is a different place with a different reader, and
 * a stable per-person identifier in one is a join key across every
 * snapshot ever published - the exact linkage quantize() exists to
 * break, handed back whole.
 *
 * Written against the identifier itself rather than against a field
 * name, so a basis or a panel added later carries one at its own peril.
 */
await check("a published snapshot contains no account id anywhere", () => {
  const snap = snapshotOf(CORPUS_RENAMED, { identify: false });
  const text = JSON.stringify(snap);
  return snap.series.length > 0 &&
    CORPUS_RENAMED.every((row) => !text.includes(row.accountId));
});

/*
 * The keyholder's own document does not carry one either. Nothing on
 * the page needs it - the panel names handles, which is what they can
 * look up - and the preview they read before publishing should differ
 * from what goes out in its labels and its panel, not in which
 * identifiers happen to be lying in it.
 */
await check("the keyholder's snapshot carries no account id either", () => {
  const snap = snapshotOf(CORPUS_RENAMED, { identify: true });
  const text = JSON.stringify(snap);
  return snap.quality.handleChanges.length === 1 &&
    CORPUS_RENAMED.every((row) => !text.includes(row.accountId));
});

/* The rename does not add a person, and the panel says which account it
 * is - by the handles, the only names the keyholder has for it. */
await check("a rename inside the corpus is one person and one finding", () => {
  const snap = snapshotOf(CORPUS_RENAMED, { identify: true });
  return snap.counts.people === CORPUS_PEOPLE &&
    snap.counts.entries === CORPUS_ENTRIES + 1 &&
    same(snap.quality.handleChanges[0].handles,
      ["gainer1_after", "gainer1"]);
});

await check("a published snapshot labels people by number", () => {
  const snap = snapshotOf(CORPUS, { identify: false });
  return snap.series.every((line) => /^Person \d+$/.test(line.label));
});

/* The keyholder's own page draws an identified snapshot, which is what
 * makes Publish a preview rather than a leap - the same function drew
 * what is already on screen. */
await check("an identified snapshot keeps the handles", () => {
  const snap = snapshotOf(CORPUS, { identify: true });
  return snap.identified === true &&
    snap.series.some((line) => line.label === "@gainer1");
});

/* A data-quality panel is for whoever can act on it. Published, it is
 * a list of strangers' heights and no use to anybody. */
await check("the height panel is dropped when publishing", () => {
  const published = snapshotOf(CORPUS, { identify: false });
  const private_ = snapshotOf(CORPUS, { identify: true });
  return published.quality === null &&
    private_.quality.heightChanges.length === 1 &&
    private_.quality.heightChanges[0].telegram === "shifty";
});

/* The second half of the data-quality panel, and the reason it is in
 * the panel rather than in a chart: only the keyholder can tell a
 * rename from somebody writing a handle that is not theirs. */
await check("the identified snapshot names an account with two handles", () => {
  const snap = snapshotOf(RENAMED, { identify: true });
  return snap.quality.handleChanges.length === 1 &&
    same(snap.quality.handleChanges[0].handles, ["newname", "oldname"]);
});

await check("the handle panel is dropped when publishing too", () =>
  snapshotOf(RENAMED, { identify: false }).quality === null);

/*
 * Two accounts, one handle, and the published document has to describe
 * them as two people.
 *
 * The pseudonym is assigned per line rather than per handle for exactly
 * this case: numbering by handle gives both lines the label "Person 1",
 * which is a published document claiming that one person submitted two
 * contradictory histories. Grouping on the identity is what creates the
 * two lines in the first place, so the labelling has to keep up with it.
 */
const TWINS = CORPUS.map((row) =>
  row.telegram === "gainer4" || row.telegram === "gainer5"
    ? { ...row, telegram: "twin" }
    : row);

await check("two accounts sharing a handle are still two people", () =>
  snapshotOf(TWINS, { identify: false }).counts.people === CORPUS_PEOPLE);

await check("two accounts sharing a handle get a pseudonym each", () => {
  const labels = snapshotOf(TWINS, { identify: false }).series
    .map((line) => line.label);
  return labels.length >= MIN_CELL &&
    new Set(labels).size === labels.length;
});

/* The keyholder's own view shows the handle as written, twice, because
 * that is the finding: two people are answering to one name. */
await check("the keyholder sees both lines under the handle they share", () => {
  const snap = snapshotOf(TWINS, { identify: true });
  return snap.series.filter((line) => line.label === "@twin").length === 2 &&
    snap.quality.handleChanges.length === 0;
});

/* Off unless asked for. A weight history is the one part of a snapshot
 * that is still about individuals, pseudonyms or not. */
await check("weight over time can be left out entirely", () =>
  snapshotOf(CORPUS, { identify: false, series: false }).series === null);

/*
 * WHICH KIND OF NULL A NULL SERIES IS - #177.
 *
 * `series: null` means two opposite things. Left out, because nobody
 * asked for it; or asked for and taken out, because there were too few
 * lines to hide in. One is a choice and the other is the floor
 * protecting people, and until this field existed a reader of the
 * document could not tell them apart - which is why the keyholder's
 * Publish card and the member's page both showed silence.
 *
 * The reading side has no rows, so it cannot work this out for itself.
 * The document has to carry it, and it carries a boolean and nothing
 * else: how many lines there would have been is exactly what the floor
 * is holding back.
 */
const withheldRows = CORPUS.concat(
  /* Three repeat submitters, below MIN_CELL, from rows the corpus
     already has - so nothing but the number of lines changes. */
  CORPUS.slice(0, 3).map((row, index) => ({
    ...row,
    id: 900 + index,
    kg: row.kg + 3,
    lb: row.lb + 6.6,
    submittedAt: "2026-08-04T12:00:00.000Z",
  })));

await check("a series the floor removed says so in the document", () => {
  const snap = snapshotOf(withheldRows, { identify: false });
  return snap.series === null && snap.seriesWithheld === true;
});

await check("a series nobody asked for is not reported as withheld", () =>
  snapshotOf(withheldRows, { identify: false, series: false })
    .seriesWithheld === false);

await check("a series that cleared the floor is not reported as withheld",
  () => {
    const snap = snapshotOf(CORPUS, { identify: false });
    return snap.series.length >= MIN_CELL && snap.seriesWithheld === false;
  });

/* The keyholder has no floor, so nothing of theirs is ever withheld -
 * and this is the field the drawing half reads to decide whether to say
 * anything at all. If it could ever be true here, the instrument would
 * start explaining a suppression it does not perform. */
await check("the keyholder's own document never reports a withholding", () =>
  snapshotOf(withheldRows, { identify: true }).seriesWithheld === false &&
  snapshotOf(CORPUS.slice(0, 3), { identify: true }).seriesWithheld === false);

/* ------------------------------------------------------------------ */
/* Quantization of the published series.                               */

/*
 * Why these checks exist, and why they are not the check that was
 * specified.
 *
 * DESIGN.md once claimed renumbering pseudonyms stopped two snapshots
 * being lined up to follow one person. That was false: the series
 * carried an exact millisecond instant and a weight to a tenth, so
 * Person 3's line reappeared verbatim in the next document with one
 * point on the end. Matching was a join on an exact key.
 *
 * archive/REDESIGN.md Part 5 then specified the missing test as "two snapshots
 * of the same corpus, one with an extra entry, share no exact series
 * point". **That criterion cannot hold, and correcting it is part of
 * this step.** Quantization is a deterministic function of a point, so
 * an entry that did not change quantizes the same way in both
 * documents - the shared points are guaranteed, and coarsening makes
 * them *more* alike, not less. Only per-publication randomness could
 * satisfy the sentence as written, and that would make the chart lie
 * without stopping an approximate match anyway.
 *
 * What quantization actually buys is **ambiguity**: a published point
 * stops being a unique key, because several people's different
 * measurements land on the same date and the same bin. That is the
 * property worth asserting, and it is what these checks assert.
 */
const DAY = 86400000;

/* Two people whose raw measurements differ, on times of day that
 * differ, chosen so that both collapse onto one published point. A
 * fixture of midnight timestamps and bin-aligned weights would pass
 * every check below without quantization existing at all. */
const QUANT = [
  entry({ id: 20, telegram: "alpha", lb: 201.3, kg: 91.3,
          submittedAt: "2026-02-03T13:47:12.345Z" }),
  entry({ id: 21, telegram: "alpha", lb: 231.7, kg: 105.1,
          submittedAt: "2026-06-11T08:15:00.000Z" }),
  entry({ id: 22, telegram: "beta", lb: 214.8, kg: 97.4,
          submittedAt: "2026-02-03T04:02:59.999Z" }),
  entry({ id: 23, telegram: "beta", lb: 250.0, kg: 113.4,
          submittedAt: "2026-09-20T19:30:00.000Z" }),
  /*
   * Padding, and nothing more. The suppression floor will not publish a
   * series with fewer than MIN_CELL lines, so alpha and beta alone now
   * produce no series at all and every check below would read null.
   *
   * These carry deliberately unremarkable values, well away from the
   * collision alpha and beta are here to create, so they raise the line
   * count without touching what the quantisation checks are measuring.
   * Their times and weights are off-midnight and off-bin like the rest,
   * so they cannot pass a check by accident either.
   */
  ...[["gamma", 176.2, 79.9], ["delta", 189.4, 85.9],
      ["epsilon", 262.6, 119.1]].flatMap(([who, lb, kg], i) => [
    entry({ id: 30 + i * 2, telegram: who, lb, kg,
            submittedAt: "2026-03-1" + i + "T11:23:45.678Z" }),
    entry({ id: 31 + i * 2, telegram: who, lb: lb + 13.7, kg: kg + 6.2,
            submittedAt: "2026-07-1" + i + "T16:05:33.210Z" }),
  ]),
];

const publishedPoints = (rows) =>
  snapshotOf(rows, { identify: false }).series
    .reduce((all, line) => all.concat(line.points), []);

await check("a published point carries the date, not the instant", () =>
  publishedPoints(QUANT).every((p) => p.at % DAY === 0));

/* The bin the histogram already uses - 20 lb and 10 kg. Each system
 * reads its own stored field and is floored on its own; converting one
 * into the other would put a second copy of the conversion here, free
 * to drift from form.js. */
await check("a published weight sits on the histogram's bin edge", () =>
  publishedPoints(QUANT).every((p) => p.imperial % 20 === 0 && p.metric % 10 === 0));

/* The exact time of a submission was never a thing anybody decided to
 * publish - it was simply what timeOf happened to return. */
await check("no published point carries a submission's exact time", () =>
  publishedPoints(QUANT).every((p) => p.at !== Date.parse("2026-02-03T13:47:12.345Z")));

/* It never leaves the keyholder's tab, so it keeps every decimal. */
await check("the keyholder's own snapshot keeps full precision", () => {
  const points = snapshotOf(QUANT, { identify: true }).series
    .reduce((all, line) => all.concat(line.points), []);
  return points.some((p) => p.at === Date.parse("2026-02-03T13:47:12.345Z")) &&
    points.some((p) => p.imperial === 201.3 && p.metric === 91.3);
});

/* The property the whole step is for. Two people, different weights,
 * different times of day - one published point. A reader joining on it
 * cannot tell which line it belonged to. */
await check("a published point is ambiguous rather than a unique key", () => {
  const snap = snapshotOf(QUANT, { identify: false });
  const key = (p) => [p.at, p.imperial, p.metric].join("|");
  const first = snap.series.map((line) => key(line.points[0]));
  // Two distinct lines sharing a first point is the property. Asserting
  // on the number of lines instead would only be describing the fixture,
  // and it broke the moment the fixture grew to clear the floor.
  const shared = first.filter((k, i) => first.indexOf(k) !== i);
  return snap.series.length >= MIN_CELL && shared.length >= 1;
});

/* Coarsening the points must not flatten what the chart is for. */
await check("the shape of a line survives quantization", () => {
  const line = snapshotOf(QUANT, { identify: false }).series
    .find((l) => l.points.length === 2);
  return line.points[0].imperial < line.points[1].imperial &&
    line.points[0].at < line.points[1].at;
});

/*
 * Both bases and both unit systems are precomputed. The public page has
 * no rows, so anything it cannot find in here is a toggle that would
 * have to be removed from it.
 */
await check("both counting bases are precomputed", () => {
  const snap = snapshotOf(CORPUS, { identify: false });
  return snap.bases.entries.count === CORPUS_ENTRIES &&
    snap.bases.people.count === CORPUS_PEOPLE &&
    snap.counts.entries === CORPUS_ENTRIES &&
    snap.counts.people === CORPUS_PEOPLE;
});

await check("both unit systems are precomputed, in both bases", () => {
  const snap = snapshotOf(CORPUS, { identify: false });
  for (const basis of ["people", "entries"]) {
    const view = snap.bases[basis];
    for (const system of ["imperial", "metric"]) {
      if (!view[system] || !view[system].weight || !view[system].height) {
        return false;
      }
    }
  }
  return true;
});

/* The snapshot must agree with the page it was computed from, or
 * publishing would quietly change the numbers. */
await check("a snapshot's figures match summarise on the same rows", () => {
  const snap = snapshotOf(CORPUS, { identify: false });
  const stats = summarise(latestPerPerson(CORPUS), "imperial");
  const view = snap.bases.people.imperial;
  return view.weight.median === stats.weightMedian &&
    view.height.median === stats.heightMedian &&
    snap.bases.people.bmi.median === stats.bmiMedian;
});

await check("a snapshot says when it was made and which format it is", () => {
  const snap = snapshotOf(CORPUS, { identify: false },
    Date.UTC(2026, 7, 5, 12, 0, 0));
  return snap.snapshot === SNAPSHOT_VERSION &&
    snap.generated === "2026-08-05T12:00:00.000Z";
});

/*
 * An empty corpus used to publish an empty-but-complete document. Under
 * the floor it publishes no basis at all, which is the same answer for
 * a better reason: zero people is below MIN_CELL, so there is nothing
 * that can be said about them. The shape still has to be coherent, and
 * render() has to draw it rather than dereference the null - that guard
 * is in dashboard.js and this is the check that it is needed.
 */
await check("a snapshot of nothing publishes no basis, coherently", () => {
  const snap = snapshotOf([], { identify: false });
  return snap.counts.entries === 0 && snap.counts.people === 0 &&
    snap.series === null &&
    snap.bases.people === null && snap.bases.entries === null;
});

/* The keyholder's own empty page is still fully formed - the floor is
 * off for them, so the shape they draw is the shape they always drew. */
await check("the keyholder's empty snapshot keeps its full shape", () => {
  const snap = snapshotOf([], { identify: true });
  return snap.bases.people.imperial.weight.median === null &&
    same(snap.bases.people.imperial.weight.bins, []);
});


/* ------------------------------------------------------------------ */
/* The suppression floor on a published snapshot.                      */

/*
 * These exist because a real reproduction beat the design's reasoning.
 * A published snapshot of a two-dozen-person group said "exactly one
 * member is in Japan" and "exactly one member is nonbinary", and
 * ROLE_VOCABULARY is feeder/feedee/gainer/admirer, so a singleton there
 * published a named person's kink role to the open web.
 *
 * The belief that allowed it was that rows are dangerous and aggregates
 * are safe. True for large N. At twenty-four an aggregate of one IS a
 * row, and the whole point of these checks is that they are written
 * against re-identification rather than against "the floor was applied".
 */

// A plausible private group: mostly US and GB, a long tail of one.
const GROUP = [
  "US", "US", "US", "US", "US", "US", "US", "US", "GB", "GB", "GB", "GB",
  "GB", "CA", "CA", "CA", "DE", "DE", "MX", "MX", "AU", "BR", "JP", "NO",
].map((country, i) => ({
  // An account each, which is what twenty-four members who have never
  // renamed look like. The suppression floor is what these checks are
  // about, and it has to be measured on rows grouped the way shipped
  // rows are grouped.
  accountId: "acct-user" + i,
  telegram: "user" + i,
  country,
  gender: i === 21 ? "nonbinary" : (i >= 18 && i <= 20 ? "female" : "male"),
  roles: i === 23 ? ["admirer"] : (i % 3 === 0 ? ["feedee"] : ["gainer"]),
  kg: 70 + i * 3.7,
  lb: (70 + i * 3.7) * 2.20462,
  cm: 165 + (i % 20),
  totalInches: (165 + (i % 20)) / 2.54,
  at: new Date(Date.UTC(2026, 7, 1, 12, i)).toISOString(),
}));

const published = snapshotOf(GROUP, { identify: false }, Date.UTC(2026, 7, 6));
const priv = snapshotOf(GROUP, { identify: true }, Date.UTC(2026, 7, 6));
const cells = (rows) => rows.filter((r) => r.count > 0 && r.count < MIN_CELL);
const total = (rows) => rows.reduce((s, r) => s + r.count, 0);

await check("no published categorical cell describes fewer than MIN_CELL people", () =>
  ["country", "gender", "roles"].every((k) =>
    cells(published.bases.people[k]).length === 0));

await check("the singleton country that started this is gone", () =>
  !published.bases.people.country.some((r) => r.label === "JP"));

await check("the singleton kink role is gone", () =>
  !published.bases.people.roles.some(
    (r) => r.label === "admirer" && r.count > 0 && r.count < MIN_CELL));

/*
 * The attack this has to survive is subtraction, not redaction. A reader
 * knows the group size, so dropping a cell and leaving the rest to sum
 * to 23 of 24 discloses the dropped one exactly.
 */
/*
 * A breakdown either publishes and accounts for everybody, or does not
 * publish. There is no third state, and the third state is the leak:
 * naming US 8 and GB 5 against a known total of 24 while quietly
 * dropping Japan discloses Japan by subtraction just as loudly as
 * printing it.
 *
 * gender is the empty case here on purpose. female 3 plus nonbinary 1
 * is four people, short of the floor, and the only cell left to absorb
 * is male - which would leave one bucket and no breakdown. So it
 * publishes nothing, and that is the correct answer rather than a gap.
 */
await check("a published breakdown either accounts for everybody or is empty", () =>
  ["country", "gender", "roles"].every((k) => {
    const rows = published.bases.people[k];
    return rows.length === 0 || total(rows) === published.counts.people;
  }));

await check("country publishes and accounts for the whole group", () =>
  published.bases.people.country.length > 0 &&
  total(published.bases.people.country) === published.counts.people);

await check("gender suppresses entirely rather than leaking by subtraction", () =>
  same(published.bases.people.gender, []));

await check("the Other bucket is itself at or above the floor", () => {
  const other = published.bases.people.country
    .find((r) => r.label === OTHER_LABEL);
  return other !== undefined && other.count >= MIN_CELL;
});

await check("a zero survives - it describes nobody", () =>
  published.bases.people.roles.some((r) => r.count === 0));

/*
 * Bins merge rather than bucket, so the shape and the total survive.
 *
 * Gathered rather than listed. The first version of this named
 * metric.weight and imperial.weight, and a mutation that removed
 * suppression from the BMI bins survived it untouched - the check was
 * describing the two places somebody thought of, not the property. Any
 * bin set added later is covered by this without being remembered.
 */
const allBinSets = (basis) => {
  const out = [{ what: "bmi", bins: basis.bmi.bins }];
  for (const system of ["metric", "imperial"]) {
    for (const measure of ["weight", "height"]) {
      out.push({ what: system + "." + measure, bins: basis[system][measure].bins });
    }
  }
  return out;
};

await check("no published histogram bin describes fewer than MIN_CELL people", () =>
  allBinSets(published.bases.people)
    .every((set) => cells(set.bins).length === 0));

await check("every published bin set still accounts for everybody", () =>
  allBinSets(published.bases.people)
    .every((set) => set.bins.length === 0 ||
      total(set.bins) === published.counts.people));

/*
 * The two unit systems must publish ONE partition, not two.
 *
 * Found by attacking the floor rather than confirming it, and it is the
 * same shape as the check 5 gap: each rule correctly applied, and the
 * composition defeating them. Metric bins at 10 kg and imperial bins at
 * 20 lb do not share boundaries, so both can satisfy the floor while a
 * reader who overlays them recovers a finer partition. Differencing the
 * cumulative counts of the two published sets produced sub-floor cells
 * in 2899 of 3000 random groups.
 *
 * Counts must agree elementwise. That is the property - not that the
 * edges look similar, which they cannot, being different units.
 */
await check("both unit systems publish the same partition, not two", () => {
  for (const measure of ["weight", "height"]) {
    const m = published.bases.people.metric[measure].bins;
    const i = published.bases.people.imperial[measure].bins;
    if (m.length !== i.length) return false;
    if (m.some((bin, at) => bin.count !== i[at].count)) return false;
  }
  return true;
});

/* The keyholder sees each system binned in its own units, as before -
 * there is nobody to hide from in their own tab. */
await check("the keyholder's two unit systems are still independent", () => {
  const own = snapshotOf(GROUP, { identify: true }, Date.UTC(2026, 7, 6));
  return own.bases.people.metric.weight.bins.length > 0 &&
    own.bases.people.imperial.weight.bins.length > 0;
});

await check("merged bins still account for everyone", () =>
  total(published.bases.people.metric.weight.bins) === published.counts.people);

await check("merged bins stay contiguous", () => {
  const bins = published.bases.people.metric.weight.bins;
  return bins.every((b, i) => i === 0 || b.from === bins[i - 1].to);
});

/* The keyholder is looking at their own data in their own tab. */
await check("the keyholder's own view is not reduced", () =>
  priv.bases.people.country.some((r) => r.label === "JP" && r.count === 1));

/* A series line is one person by construction. */
await check("a series with too few lines is not published at all", () => {
  const repeats = GROUP.slice(0, 3).flatMap((e, i) => [
    e, { ...e, kg: e.kg + 2, at: new Date(Date.UTC(2026, 7, 3, 12, i)).toISOString() },
  ]);
  const snap = snapshotOf(repeats, { identify: false }, Date.UTC(2026, 7, 6));
  return snap.series === null;
});

/* Below the floor there is no breakdown worth publishing. */
await check("a group smaller than the floor publishes no breakdown", () => {
  const tiny = GROUP.slice(0, 3);
  const snap = snapshotOf(tiny, { identify: false }, Date.UTC(2026, 7, 6));
  return snap.bases.people === null && snap.bases.entries === null;
});

/* The pure halves, driven directly. */
await check("a short bucket absorbs the smallest named cell until it clears", () => {
  const out = suppressCounts(
    [{ label: "a", count: 20 }, { label: "b", count: 6 },
     { label: "c", count: 1 }], MIN_CELL);
  const other = out.find((r) => r.label === OTHER_LABEL);
  // c alone is 1, short of 5, so b (6) is absorbed: Other = 7, a stays.
  return other.count === 7 && out.length === 2 &&
    out[0].label === "a" && total(out) === 27;
});

await check("nothing publishes when no cell can ever clear the floor", () =>
  same(suppressCounts(
    [{ label: "a", count: 1 }, { label: "b", count: 2 }], MIN_CELL), []));

await check("one named cell beside the bucket is allowed, not suppressed", () => {
  const out = suppressCounts(
    [{ label: "a", count: 19 }, { label: "b", count: 3 },
     { label: "c", count: 2 }], MIN_CELL);
  return out.length === 2 && out[0].label === "a" &&
    out[1].count === 5 && total(out) === 24;
});

await check("counts already above the floor are returned untouched", () => {
  const rows = [{ label: "a", count: 10 }, { label: "b", count: 8 }];
  return suppressCounts(rows, MIN_CELL) === rows;
});

await check("a trailing short bin merges backwards rather than vanishing", () => {
  const out = suppressBins(
    [{ from: 0, to: 10, count: 6 }, { from: 10, to: 20, count: 5 },
     { from: 20, to: 30, count: 1 }], MIN_CELL);
  return out.length === 2 && out[1].to === 30 && out[1].count === 6 &&
    total(out) === 12;
});

await check("bins below the floor in total publish nothing", () =>
  same(suppressBins([{ from: 0, to: 10, count: 2 }], MIN_CELL), []));

await check("the floor is off for the keyholder, on for everyone else", () =>
  same(suppressCounts([{ label: "a", count: 1 }], 0),
       [{ label: "a", count: 1 }]));


/* ------------------------------------------------------------------ */
/* The combined weight, and its movement between two documents.        */

/*
 * The hero on Progress is one number - what everybody weighs, added up -
 * and under it how far that number has moved since the last publish.
 * The number is the easy half. The movement is the half that needed a
 * ruling, and these checks are written against the ruling rather than
 * against the implementation:
 *
 *   A GROUP DELTA CAN BE ONE PERSON. If the only member who submitted
 *   since the last document gained four pounds, "+4 lb" is that member's
 *   four pounds, published to anybody who reads the page. So the delta
 *   obeys a floor on HOW MANY PEOPLE MOVED IT, the same discipline
 *   MIN_CELL applies to every other published cell, and the keyholder's
 *   own view floors at zero exactly as it does everywhere else.
 *
 * THE PRIOR ANCHOR IS A PROPERTY OF THE DOCUMENT. A delta measured from
 * the reader's clock would show two readers different movements from the
 * same bytes. The document names the document it replaced, or it carries
 * no movement at all.
 *
 * ABSENT-TOLERANT IN BOTH DIRECTIONS. A document published before any of
 * this existed is already live and public.js will read it, so a snapshot
 * with no movement field and no combined weight has to draw. That is the
 * discipline already used for `series === null` and `bases.people ===
 * null`, and it is why SNAPSHOT_VERSION does not move: nothing here is
 * incompatible, so a version bump would only invalidate documents that
 * still render perfectly.
 */

/* Eight people, so every published cell clears MIN_CELL. Both systems
 * move together on every row, for the reason the fixture at the top of
 * this file gives. */
const WEIGHERS = [100, 101, 102, 103, 104, 105, 106, 107].map((kg, i) =>
  entry({
    id: i + 1, telegram: "w" + i, accountId: "acct-w" + i,
    kg, lb: kg * 2, cm: 175, totalInches: 68.9,
    submittedAt: "2026-06-01T00:00:00.000Z",
    gender: i < 5 ? "male" : "female",
    country: "US", roles: ["feedee"],
  }));

/* The same eight, `moved` of them heavier by 1 kg on a later row. The
 * later rows are what makes them movers; the untouched rows are what
 * keeps the group the same size. */
const laterBy = (moved) => WEIGHERS.concat(
  WEIGHERS.slice(0, moved).map((row, i) => Object.assign({}, row, {
    id: 100 + i, kg: row.kg + 1, lb: row.lb + 2,
    submittedAt: "2026-07-01T00:00:00.000Z",
  })));

const FIRST = snapshotOf(WEIGHERS, { identify: false },
  Date.parse("2026-06-15T00:00:00.000Z"));

const since = (entries, options) => snapshotOf(entries,
  Object.assign({ previous: FIRST }, options),
  Date.parse("2026-07-15T00:00:00.000Z"));

await check("the combined weight is the basis's rows added up", () =>
  // 100 through 107 is 828 kg, and the fixture's lb is exactly twice its
  // kg - so an imperial total taken by converting rather than by reading
  // the stored pounds would be 1825.5 rather than 1656.
  FIRST.bases.people.metric.weight.total === 828 &&
  FIRST.bases.people.imperial.weight.total === 1656);

await check("each basis adds up its own rows", () => {
  const both = since(laterBy(8), { identify: true });
  return both.bases.people.metric.weight.total === 836 &&
    both.bases.entries.metric.weight.total === 1664;
});

await check("a document with nothing before it carries no movement", () =>
  FIRST.movement === null);

await check("the movement names the document it was measured from", () =>
  since(laterBy(8)).movement.since === FIRST.generated);

await check("a movement above the floor is published as a number", () => {
  const now = since(laterBy(8));
  return now.movement.bases.people.metric.weight === 8 &&
    now.movement.bases.people.imperial.weight === 16;
});

await check("the entries basis reports its own movement", () =>
  // Eight new rows on top of eight, so the entries total moves by the
  // whole of the new rows rather than by the difference of the latest.
  since(laterBy(8)).movement.bases.entries.metric.weight === 836);

await check("a movement fewer people than the floor drove is not a number",
  () => {
    // Four movers, one under MIN_CELL. The figure is absent from the
    // document rather than present and undrawn: a number the page
    // declines to paint is still a number anybody can read out of the
    // JSON the Worker serves.
    const now = since(laterBy(MIN_CELL - 1));
    return now.movement !== null && now.movement.since === FIRST.generated &&
      now.movement.bases === null;
  });

await check("exactly the floor's worth of movers publishes", () =>
  since(laterBy(MIN_CELL)).movement.bases !== null);

await check("the keyholder's own view floors the movement at zero", () =>
  // The same asymmetry `identified` already has everywhere else: it is
  // their data, in their tab, and reducing it only hides what they
  // opened the page to see.
  since(laterBy(1), { identify: true }).movement.bases.people.metric
    .weight === 1);

await check("a mover is a person, not a row", () => {
  // Two rows from one account is one member moving, so a floor counting
  // rows would publish a single member's gain the moment they submitted
  // five times.
  const twice = WEIGHERS.concat([0, 1].map((n) => Object.assign(
    {}, WEIGHERS[0], { id: 200 + n, kg: 110 + n, lb: 220 + n * 2,
      submittedAt: "2026-07-0" + (n + 1) + "T00:00:00.000Z" })));
  return movedSince(twice, FIRST.generated) === 1;
});

await check("nobody counts as moved before the anchor", () =>
  movedSince(WEIGHERS, FIRST.generated) === 0);

await check("a movement measured against a document with no total is absent",
  () => {
    // Every document published before this change. The old one renders,
    // and the new one says nothing rather than treating an absent total
    // as a zero and reporting the whole group's weight as a gain.
    const old = JSON.parse(JSON.stringify(FIRST));
    delete old.bases.people.metric.weight.total;
    delete old.bases.people.imperial.weight.total;
    delete old.bases.entries.metric.weight.total;
    delete old.bases.entries.imperial.weight.total;
    return snapshotOf(laterBy(8), { identify: false, previous: old },
      Date.parse("2026-07-15T00:00:00.000Z")).movement === null;
  });

await check("a basis suppressed in one document reports no movement", () => {
  // Three people who each submitted twice: six rows clears the floor and
  // three people does not, so the earlier document publishes an entries
  // basis and no people basis. The half with nothing to subtract from
  // says nothing, and the half that has both still reports - a
  // per-basis answer rather than one verdict for the document.
  const three = WEIGHERS.slice(0, 3);
  const tiny = snapshotOf(three.concat(three.map((row, i) =>
    Object.assign({}, row, { id: 400 + i,
      submittedAt: "2026-06-05T00:00:00.000Z" }))),
    { identify: false }, Date.parse("2026-06-15T00:00:00.000Z"));
  const now = snapshotOf(laterBy(8), { identify: false, previous: tiny },
    Date.parse("2026-07-15T00:00:00.000Z"));
  return tiny.bases.people === null && tiny.bases.entries !== null &&
    now.movement.bases.people === null &&
    now.movement.bases.entries.metric.weight === 1058;
});

await check("the movement is measured in each system's own stored field",
  () => {
    // The fixture's pounds are exactly twice its kilograms, which no
    // conversion factor is. A delta converted from the metric one would
    // read 17.6 rather than 16.
    const now = since(laterBy(8));
    return now.movement.bases.people.imperial.weight ===
      now.movement.bases.people.metric.weight * 2;
  });

await check("a document carrying a movement is still version one", () =>
  // Additive, so every reader of a v1 document is still right about it.
  // A bump would strand the live document for the whole interval between
  // deploying this and the keyholder's next publish.
  since(laterBy(8)).snapshot === 1 && FIRST.snapshot === 1);

await check("a previous document that is not a snapshot is ignored, not thrown",
  () => [null, undefined, {}, { bases: null }, "nonsense"].every((junk) =>
    snapshotOf(WEIGHERS, { identify: false, previous: junk },
      Date.parse("2026-07-15T00:00:00.000Z")).movement === null));


/* ------------------------------------------------------------------ */

report();
