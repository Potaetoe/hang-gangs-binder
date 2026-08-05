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

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));

const load = async (path) => {
  const src = await readFile(HERE(path), "utf8");
  await import("data:text/javascript," + encodeURIComponent(src));
};

await load("../apps/web/dashboard.js");

const {
  NOT_STATED, median, mean, bmi, latestPerPerson, peopleCount,
  histogram, countBy, countRoles, weightSeries, heightDisagreements,
  summarise,
} = globalThis.BinderDashboard;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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

const entry = (over) => Object.assign({
  id: 1, receivedAt: "2026-08-05T00:00:00.000Z",
  submittedAt: "2026-08-05T00:00:00.000Z",
  telegram: "somehandle", kg: 90, lb: 198.4, cm: 180,
  totalInches: 70.9, feet: 5, inches: 10.9,
  enteredUnits: "metric", enteredWeight: "90 kg", enteredHeight: "180 cm",
  gender: "male", roles: ["feedee"], country: "US",
  over18: true, recordVersion: 1,
}, over);

/* Someone who submitted three times, gaining. */
const REPEATER = [
  entry({ id: 1, telegram: "gainer1", kg: 90, submittedAt: "2026-01-01T00:00:00.000Z" }),
  entry({ id: 2, telegram: "gainer1", kg: 96, submittedAt: "2026-04-01T00:00:00.000Z" }),
  entry({ id: 3, telegram: "gainer1", kg: 104, submittedAt: "2026-07-01T00:00:00.000Z" }),
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

await check("different handles are different people", () =>
  peopleCount([entry({ telegram: "a" }), entry({ telegram: "b" })]) === 2);

/*
 * Blank handles must not collapse into one enormous submitter. A row
 * with no handle is unusual - the form requires one - but a record
 * from a fork or an older version might lack it.
 */
await check("rows without a handle are not merged together", () =>
  peopleCount([
    entry({ id: 1, telegram: null }),
    entry({ id: 2, telegram: null }),
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
    same(series[0].points.map((p) => p.kg), [90, 96, 104]);
});

await check("points are sorted by time, not by arrival", () => {
  const series = weightSeries([REPEATER[2], REPEATER[0], REPEATER[1]]);
  return same(series[0].points.map((p) => p.kg), [90, 96, 104]);
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

/* ------------------------------------------------------------------ */
/* The summary strip.                                                  */

await check("the summary separates entries from people", () => {
  const stats = summarise(REPEATER);
  return stats.entries === 3 && stats.people === 1;
});

await check("the summary skips missing values rather than counting zeros",
  () => {
    const stats = summarise([entry({ kg: 90 }), entry({ id: 2, kg: null })]);
    return stats.weightMedian === 90;
  });

await check("a summary of nothing reports nothing, not zero", () => {
  const stats = summarise([]);
  return stats.entries === 0 && stats.people === 0 &&
    stats.weightMedian === null && stats.bmiMedian === null;
});

/* ------------------------------------------------------------------ */

for (const [ok, label, note] of results) {
  console.log((ok ? "  ok   " : "  FAIL ") + label + (note ? " - " + note : ""));
}
console.log(
  failures === 0
    ? "\ndashboard.js OK - " + results.length + " checks"
    : "\ndashboard.js FAILED " + failures + " of " + results.length + " checks");

process.exit(failures === 0 ? 0 : 1);
