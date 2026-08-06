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
  NOT_STATED, DEFAULT_UNITS, unitsFor, formatInches, statText,
  median, mean, bmi, latestPerPerson, peopleCount,
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
const { snapshotOf, SNAPSHOT_VERSION } = globalThis.BinderDashboard;

const CORPUS = REPEATER.concat([
  entry({ id: 10, telegram: "loner", kg: 70, lb: 154.3, cm: 165,
          totalInches: 65, gender: "female", country: "GB", roles: [],
          submittedAt: "2026-03-01T00:00:00.000Z" }),
  entry({ id: 11, telegram: "shifty", kg: 80, lb: 176.4, cm: 180,
          totalInches: 70.9, submittedAt: "2026-03-01T00:00:00.000Z" }),
  entry({ id: 12, telegram: "shifty", kg: 82, lb: 180.8, cm: 165,
          totalInches: 65, submittedAt: "2026-05-01T00:00:00.000Z" }),
]);

await check("a published snapshot contains no handle anywhere", () => {
  const text = JSON.stringify(snapshotOf(CORPUS, { identify: false }));
  return !text.includes("gainer1") && !text.includes("loner") &&
    !text.includes("shifty");
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

/* Off unless asked for. A weight history is the one part of a snapshot
 * that is still about individuals, pseudonyms or not. */
await check("weight over time can be left out entirely", () =>
  snapshotOf(CORPUS, { identify: false, series: false }).series === null);

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
 * REDESIGN.md Part 5 then specified the missing test as "two snapshots
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
  return first.length === 2 && first[0] === first[1];
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
  return snap.bases.entries.count === 6 && snap.bases.people.count === 3 &&
    snap.counts.entries === 6 && snap.counts.people === 3;
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

await check("a snapshot of nothing is still a drawable snapshot", () => {
  const snap = snapshotOf([], { identify: false });
  return snap.counts.entries === 0 && snap.counts.people === 0 &&
    same(snap.series, []) &&
    snap.bases.people.imperial.weight.median === null &&
    same(snap.bases.people.imperial.weight.bins, []);
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
