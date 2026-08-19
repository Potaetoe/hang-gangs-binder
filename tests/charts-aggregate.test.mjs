/*
 * The Worker aggregates on request, armed. 0.9-M2-S0 (#351), over
 * server/charts-agg.js and the GET /charts-data route in server/worker.js.
 *
 *     node tests/charts-aggregate.test.mjs
 *
 * WHAT THIS ARM IS FOR. DESIGN.md, "Charts", rules that the Worker
 * aggregates live and that the disclosure rules which governed the
 * published document govern the live one, "because they were always
 * about what a reader can reconstruct rather than about publishing". The
 * floor IS the anti-differencing mechanism, so this arm attacks it rather
 * than confirming it: it asks whether a reader holding one response can
 * subtract a sub-floor cell back out of it, and whether any input a
 * caller controls can lower the floor.
 *
 * TWO HALVES, AND THE SPLIT IS DELIBERATE.
 *
 *   1. The aggregator as the pure function it is. Rows in, one floored
 *      answer out - no crypto, no D1, no session. Every disclosure rule
 *      is decided here, so this is where they are armed: the floor both
 *      directions, the Other-bucket fold, adjacent-bin merging, the
 *      one-partition property over random groups, and the
 *      one-line-is-one-person rule.
 *   2. The route end to end through the real fetch(), with real
 *      store-crypto seals and a D1 stub - the gate, the echo, the
 *      unknown-parameter refusal, the self overlay's keying, and the
 *      response headers.
 *
 * THE SECURITY MANDATES THIS ARM PINS (0.9-M2-S0, binder-security Mode 2,
 * 2026-08-18). Each mandate is a claim; the arm beside it is its proof.
 *   1. One module owns the only rows-to-series path and applies the floor
 *      before returning - the handler serializes what it is given and
 *      cannot compute a cell. Armed by aggregate() answering nothing but
 *      floored output, and by the route's body being that output.
 *   2. No floor input. FLOOR is a module constant; aggregate() takes no
 *      floor argument, and an unknown query parameter is refused rather
 *      than ignored, so `?floor=1` is a 400 rather than a silent no-op.
 *   3. The self overlay is keyed ONLY by the session's account, returns
 *      in its own field, and never routes through the group aggregator.
 *   4. Empty and sub-floor are one shape: same status, same sentence, no
 *      counts, no bin residue.
 *   5. Filters echo, never enumerate.
 *   6. One partition, binned once in the spec's default system and
 *      reported under converted edges; suppressed trend periods are
 *      dropped rather than zeroed; no extremes; no-store.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/* Loaded by path, not through a data: URL: server/charts-agg.js imports
   the site spec and its reader from apps/, and server/worker.js imports
   both store-crypto and charts-agg, so every relative specifier has to
   resolve against a real file. tests/entry-rows.test.mjs takes the same
   path for the same reason. */
const agg = await import(pathToFileURL(ROOT + "server/charts-agg.js").href);
const worker = await import(pathToFileURL(ROOT + "server/worker.js").href);
const fetchWorker = worker.default.fetch;

let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) failures += 1;
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

const sha256hex = (text) =>
  createHash("sha256").update(text, "utf8").digest("hex");

/* Every number anywhere in a value, so "this answer carries no counts"
   can be asked of the whole document rather than of the fields somebody
   remembered to look at. */
function everyNumber(value, found) {
  const out = found || [];
  if (typeof value === "number") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => everyNumber(v, out));
  else if (value && typeof value === "object") {
    Object.keys(value).forEach((k) => everyNumber(value[k], out));
  }
  return out;
}

/* Every string anywhere in a value, for the enumeration check. */
function everyString(value, found) {
  const out = found || [];
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => everyString(v, out));
  else if (value && typeof value === "object") {
    Object.keys(value).forEach((k) => {
      out.push(k);
      everyString(value[k], out);
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Rows, built to the record contract server/charts-agg.js states: a    */
/* measured field is an object keyed by the spec's own `store` names, a */
/* single choice is its value, a multiple choice is an array of them.   */

const FLOOR = agg.FLOOR;

function record(kg, cm, gender, roles, country) {
  return {
    /* The envelope apps/web/form.js really writes around the measured
       half, carried here so these rows are the whole shape
       server/charts-agg.js's header states rather than the charted part
       of it - and so the handle is genuinely present in a sealed row for
       the response sweep further down to fail to find. */
    record: 1,
    submittedAt: "2026-08-01T00:00:00.000Z",
    telegram: "arm_handle_" + Math.round(kg),
    entered: { units: "metric", weight: kg + " kg", height: cm + " cm" },
    weight: { kg: kg, lb: Math.round((kg / 0.45359237) * 10) / 10 },
    height: { cm: cm, totalInches: Math.round((cm / 2.54) * 10) / 10 },
    gender: gender === undefined ? null : gender,
    roles: roles || [],
    country: country === undefined ? null : country,
    over18: true,
  };
}

let nextRowId = 1;
function row(account, at, rec) {
  return {
    id: nextRowId += 1,
    accountId: account,
    receivedAt: at,
    record: rec,
  };
}

const acct = (n) => String(n).padStart(64, "a");

/*
 * A drawn answer's distribution, or an empty stand-in.
 *
 * Reading `.distribution.cells` straight off a not-enough answer throws
 * a TypeError that takes the whole run down and hides every check after
 * it - the FLOOR->9 mutation did exactly that, and a suite that reports
 * a crash instead of a red is a suite whose remaining arms nobody saw.
 * A corpus can stop clearing the floor for a reason that is not the
 * arm's own subject (the floor becomes an admin Setting at 0.9-M3, and
 * fix wave 1's people-not-holdings rule moved which corpora draw), so
 * every probe reads the answer through here and pairs it with its own
 * `enough` assertion. The stand-in carries both shapes empty, which is
 * why the pairing matters: `.every()` over nothing is true.
 */
const NOTHING_DRAWN = Object.freeze({
  kind: null, cells: [], bins: [],
  partition: { system: null, unit: null, band: null },
});
function drawnOf(answer) {
  return answer && answer.enough && answer.distribution
    ? answer.distribution : NOTHING_DRAWN;
}

/*
 * How many PEOPLE each drawn cell really stands for, counted from the
 * corpus rather than read off the answer - which is the only way to ask
 * whether the answer's own counts are people at all.
 *
 * A named cell stands for the members who hold that value. The bucket
 * stands for the members no named cell describes, which is what the
 * bucket is for. On a single-choice field the two readings coincide,
 * and that coincidence is why the count-pooling defect stayed invisible
 * until a multiple-choice corpus asked (#351, fix wave 1, finding F1).
 *
 * One row per account in the corpora this is used on, so a row is a
 * person here without a latest-per-account pass of its own, and every
 * value in them is one the spec allows - this reads a record straight
 * rather than through heldValues(), which is the point: it must not
 * share the code it is checking.
 *
 * The blank cell counts as a named one, keyed by null exactly as the
 * answer keys it. Somebody who stated nothing is described by "Not
 * stated" when that cell draws, and is hidden when it was pooled away.
 */
function peopleBehind(rows, field, cells) {
  const named = cells
    .filter((cell) => cell.bucket !== "other" && cell.count > 0)
    .map((cell) => cell.value);
  const per = new Map();
  const hidden = new Set();
  for (const one of rows) {
    const held = one.record[field];
    const values = Array.isArray(held)
      ? (held.length ? held : [null])
      : held === null || held === undefined || held === "" ? [null] : [held];
    let drawn = false;
    for (const value of values) {
      if (named.indexOf(value) === -1) continue;
      drawn = true;
      per.set(value, (per.get(value) || 0) + 1);
    }
    if (!drawn) hidden.add(one.accountId);
  }
  return { per: per, hidden: hidden };
}

/* Every drawn cell describes at least the floor's number of PEOPLE -
   the whole claim of the floor, asked of an answer against the corpus
   that produced it. A cell of zero describes nobody and is not a
   disclosure. */
function everyCellClearsTheFloor(rows, field, answer) {
  const cells = drawnOf(answer).cells;
  const behind = peopleBehind(rows, field, cells);
  return cells.every((cell) => cell.count === 0 || (cell.bucket === "other"
    ? behind.hidden.size >= FLOOR
    : behind.per.get(cell.value) >= FLOOR));
}

/* A group whose weights sit in one place, so the distribution's shape is
   decided by the floor rather than by the data being spread out. */
function evenGroup(people, at) {
  const rows = [];
  for (let i = 0; i < people; i += 1) {
    rows.push(row(acct(i), at || "2026-08-01T00:00:00.000Z",
      record(100 + i, 170 + (i % 5), i % 2 ? "female" : "male",
        ["feeder"], "US")));
  }
  return rows;
}

const askFor = (query, spec) =>
  agg.askFor(new URLSearchParams(query), spec);

function ask(query, spec) {
  const parsed = askFor(query, spec);
  if (!parsed.ok) throw new Error("the arm's own ask is invalid: " +
    parsed.error);
  return parsed.ask;
}

/* ================================================================== */
/* 1. The floor, both directions.                                      */

check("the floor is 5, carried from MIN_CELL in apps/web/dashboard.js " +
  "(DESIGN.md, \"Admin surfaces\")", FLOOR === 5);

const atFloor = agg.aggregate(evenGroup(FLOOR), ask("measure=weight"));
const belowFloor = agg.aggregate(evenGroup(FLOOR - 1), ask("measure=weight"));

check("floor: a view of exactly the floor's number of people draws",
  atFloor.enough === true && atFloor.distribution !== null);
check("floor: a view of one fewer than the floor draws nothing",
  belowFloor.enough === false && belowFloor.distribution === null &&
  belowFloor.trend === null);
check("floor: the cut answers the honest sentence rather than an error",
  typeof belowFloor.note === "string" &&
  /not enough people for this view/i.test(belowFloor.note));

/* Mandate 4: no counts, no bin residue. The only number a sub-floor
   answer may carry is the floor itself, which the caller may already read
   off any drawn view. */
check("floor: a sub-floor answer carries no count anywhere in it - the " +
  "floor is the only number in the whole document (mandate 4)",
  everyNumber(belowFloor).length === 1 && everyNumber(belowFloor)[0] === FLOOR);

/* Mandate 4: a filter nobody holds and a filter too few hold are one
   shape. The echoed value is the caller's own and is the one field
   allowed to differ, so it is blanked for the comparison and asserted
   separately below. */
const holders = evenGroup(FLOOR - 1);
const nobody = agg.aggregate(holders, ask("measure=weight&filter=country&value=JP"));
const tooFew = agg.aggregate(holders, ask("measure=weight&filter=country&value=US"));
const blanked = (answer) =>
  JSON.stringify(Object.assign({}, answer, { filter: null }));
check("floor: a filter value nobody holds and a filter value too few " +
  "hold answer the same document (mandate 4)",
  blanked(nobody) === blanked(tooFew) && nobody.enough === false);

/* ================================================================== */
/* 2. No floor input (mandate 2).                                      */

check("no floor input: aggregate() declares no floor parameter",
  agg.aggregate.length === 3);

const withExtra = agg.aggregate(evenGroup(FLOOR - 1),
  ask("measure=weight"), undefined, 1, 0, { floor: 1 });
check("no floor input: extra arguments cannot lower the floor",
  withExtra.enough === false);

check("no floor input: the answer reports the floor it applied",
  atFloor.floor === FLOOR && belowFloor.floor === FLOOR);

for (const attempt of ["floor", "min_cell", "minCell", "identify", "units",
  "system", "basis"]) {
  const refused = askFor("measure=weight&" + attempt + "=1");
  check("no floor input: an unknown query parameter (" + attempt + ") is " +
    "refused rather than ignored", refused.ok === false);
}

/* ================================================================== */
/* 3. Adjacent-bin merging, and the totals that make subtraction fail.  */

/* One heavy outlier and a crowd: the outlier's own bin is below the
   floor and has to merge backwards into the last drawn bin rather than
   be dropped, or the drawn counts would no longer sum to the people. */
const tailRows = evenGroup(FLOOR + 2);
tailRows.push(row(acct(90), "2026-08-01T00:00:00.000Z",
  record(300, 175, "male", ["gainer"], "US")));
const tail = agg.aggregate(tailRows, ask("measure=weight"));

check("bins: every drawn bin describes at least the floor's number of " +
  "people", tail.enough === true &&
  tail.distribution.bins.every((b) => b.count >= FLOOR));
check("bins: the drawn counts sum to the people with a value - a lone " +
  "outlier merges into its neighbour rather than being dropped, so " +
  "nothing is recoverable by subtracting the drawn cells from the total",
  tail.distribution.bins.reduce((n, b) => n + b.count, 0) === tailRows.length);
check("bins: no extremes - the answer carries no minimum or maximum " +
  "(mandate 6)",
  !everyString(tail).some((s) => /^(min|max|lowest|highest|extremes?)$/i
    .test(s)));

/* A group wide enough to draw SEVERAL bins, which the outlier corpus
   above cannot: its lone heavy member merges the whole upper range into
   one bin, so a contiguity check run on it was asking nothing of a
   single-element list. Five clusters twelve kilograms apart draw five
   bins, and the inner boundaries between them are what the contiguity
   and one-partition arms below are actually about. */
const wideRows = [];
for (let i = 0; i < 30; i += 1) {
  wideRows.push(row(acct(i), "2026-08-01T00:00:00.000Z",
    record(70 + Math.floor(i / 6) * 12, 170, i % 2 ? "female" : "male",
      ["feeder"], "US")));
}
const wide = agg.aggregate(wideRows, ask("measure=weight"));
const wideSystem = drawnOf(wide).partition.system;

check("bins: a widely spread group draws several bins rather than one",
  wide.enough === true && drawnOf(wide).bins.length >= 3);
check("bins: merging widens a bin rather than adding one - the drawn " +
  "edges stay contiguous",
  wide.enough === true && drawnOf(wide).bins.every((b, i, all) =>
    i === 0 || b.from[wideSystem] === all[i - 1].to[wideSystem]));

/* ================================================================== */
/* 3b. The drawn range's outer edges are OPEN.                         */
/*                                                                     */
/* Fix wave 1, finding F2 (#351, review of record, Prime's ruling).    */
/* Every drawn bin cleared the floor, but the range's outer edges came */
/* from exactly one person at each end, quantized to a band: the       */
/* criterion was met and the property was not. "A weight and a height  */
/* and a country is a person to anyone who knows her" is the test, and */
/* a top edge fitted to the heaviest member fails it however round the */
/* number is. So the response now carries no data-derived outer edge   */
/* at all; the inner edges are floor-cleared boundaries and stay.      */

const outlierRows = [];
for (let i = 0; i < 40; i += 1) {
  outlierRows.push(row(acct(i), "2026-08-01T00:00:00.000Z",
    record(80 + (i % 10), 170, i % 2 ? "female" : "male", ["feeder"], "US")));
}
/* The two the range used to report: one far above the crowd and one far
   below it, each alone in their band. */
const HEAVIEST = 203;
const LIGHTEST = 61;
outlierRows.push(row(acct(60), "2026-08-01T00:00:00.000Z",
  record(HEAVIEST, 178, "male", ["feeder"], "US")));
outlierRows.push(row(acct(61), "2026-08-01T00:00:00.000Z",
  record(LIGHTEST, 165, "female", ["feeder"], "US")));
const ends = agg.aggregate(outlierRows, ask("measure=weight"));
const endSystems = Object.keys(ends.units || {});
const endBins = drawnOf(ends).bins;

check("open edges: the first drawn bin opens below and the last opens " +
  "above - in every system, so a page reads one shape (F2)",
  ends.enough === true && endBins.length > 1 &&
  endSystems.every((s) => endBins[0].from[s] === null &&
    endBins[endBins.length - 1].to[s] === null));

check("open edges: the inner edges survive as numbers - opening the " +
  "ends is not deleting the axis (F2)",
  endSystems.length > 1 &&
  endBins.slice(1).every((b) =>
    endSystems.every((s) => typeof b.from[s] === "number")) &&
  endBins.slice(0, -1).every((b) =>
    endSystems.every((s) => typeof b.to[s] === "number")));

/*
 * The band one member's value sits in, computed from the spec's own
 * width rather than from the answer: it is the fact the response must
 * not let a reader recover, so it has to be derived somewhere the
 * answer cannot move.
 *
 * The sweep below is the WHOLE document rather than the edge fields,
 * because the leak this rule names would arrive as whatever field a
 * later slice added. That is affordable here because the corpus keeps
 * every legitimate figure clear of both brackets on purpose - its
 * counts and its average sit between them, not inside them - so a
 * number landing in a bracket can only be an edge that should not be
 * there.
 */
function bandOf(kg, system) {
  const kind = globalThis.BINDER_SITE.units.kinds.weight;
  const table = kind.units[kind.chart[system]];
  const value = kg / table.per;
  return [Math.floor(value / table.bin) * table.bin,
    Math.ceil((value + 1e-9) / table.bin) * table.bin];
}
const brackets = [];
for (const system of endSystems) {
  brackets.push(bandOf(HEAVIEST, system));
  brackets.push(bandOf(LIGHTEST, system));
}
check("open edges: no number anywhere in the answer falls inside the " +
  "band holding the heaviest member or the band holding the lightest - " +
  "no response field recovers either extreme's band (F2)",
  ends.enough === true && brackets.length === 4 &&
  everyNumber(ends).every((n) =>
    brackets.every((pair) => !(n >= pair[0] && n <= pair[1]))));

check("open edges: opening the ends costs no people - the drawn counts " +
  "still sum to everybody with a value (F2)",
  endBins.reduce((n, b) => n + b.count, 0) === outlierRows.length);

/* ================================================================== */
/* 4. The Other bucket: subtraction, not redaction.                    */

/* A crowd in one country and singletons elsewhere. The singletons must
   pool, and the pool must itself clear the floor or nothing is drawn. */
const spread = evenGroup(FLOOR + 3);
["JP", "FR", "DE", "IT", "ES", "PT"].forEach((code, i) => {
  spread.push(row(acct(40 + i), "2026-08-01T00:00:00.000Z",
    record(110 + i, 172, "female", ["feedee"], code)));
});
const byCountry = agg.aggregate(spread, ask("measure=country"));

check("Other: a categorical measure draws cells rather than bins",
  byCountry.enough === true && drawnOf(byCountry).kind === "cells");
check("Other: every drawn cell clears the floor",
  byCountry.enough === true &&
  drawnOf(byCountry).cells.every((c) => c.count === 0 || c.count >= FLOOR));
check("Other: the fold lands in one bucket that stands for at least the " +
  "floor's number of PEOPLE",
  byCountry.enough === true &&
  drawnOf(byCountry).cells.filter((c) => c.bucket === "other").length === 1 &&
  everyCellClearsTheFloor(spread, "country", byCountry));
check("Other: on a SINGLE-choice measure the drawn cells sum to the " +
  "population, so the remainder cannot be differenced back",
  drawnOf(byCountry).cells.reduce((n, c) => n + c.count, 0) ===
    spread.length);
check("Other: the bucket's label carries no member-typed value " +
  "(mandate 5)",
  drawnOf(byCountry).cells.filter((c) => c.bucket === "other")
    .every((c) => c.value === null &&
      !/JP|FR|DE|IT|ES|PT/.test(String(c.label))));

/* When the pool cannot clear the floor there is nothing safe to say, and
   the answer is the same not-enough document a sub-floor view gives. */
const scattered = [];
["JP", "FR", "DE", "IT", "ES", "PT"].forEach((code, i) => {
  scattered.push(row(acct(50 + i), "2026-08-01T00:00:00.000Z",
    record(110 + i, 172, "female", ["feedee"], code)));
});
const unpoolable = agg.aggregate(scattered, ask("measure=country"));
check("Other: a set of singletons that cannot pool draws nothing at all",
  unpoolable.enough === false && unpoolable.distribution === null);

/* ================================================================== */
/* 4b. The floor counts PEOPLE, never value-holdings.                  */
/*                                                                     */
/* Fix wave 1, finding F1 (#351, review of record) - the finding that  */
/* blocked the landing. `roles` is `multiple: true` and `chart: true`, */
/* live at GET /charts-data?measure=roles, and on such a field one member   */
/* feeds a count into EVERY value they hold. A bucket that pooled the  */
/* COUNTS of small cells therefore cleared a floor of five with two    */
/* people behind it, and the cell that exists to hide those two        */
/* described exactly them. The whole input class was unarmed: nothing  */
/* above this line ever asks for a multiple-choice measure.            */

/* One row per account, so a row is a person and peopleBehind() can
   count the corpus directly. */
function rolesRow(n, held) {
  return row(acct(n), "2026-08-01T00:00:00.000Z",
    record(100 + (n % 20), 170, "male", held, "US"));
}

/* The reviewer's probe, reproduced exactly: eight members, six holding
   one affiliation and two holding three. Pooled by count the bucket
   reads 6 and clears a floor of 5; pooled by person it stands for 2,
   and those two members' complete affiliation sets are what the bucket
   would have disclosed. */
const probeRows = [];
for (let i = 0; i < 6; i += 1) probeRows.push(rolesRow(i, ["feeder"]));
probeRows.push(rolesRow(6, ["feedee", "gainer", "admirer"]));
probeRows.push(rolesRow(7, ["feedee", "gainer", "admirer"]));
const probe = agg.aggregate(probeRows, ask("measure=roles"));

check("people not holdings: nothing the probe draws describes fewer " +
  "than the floor's number of PEOPLE - the bucket that pooled six " +
  "holdings stood for two members (F1)",
  everyCellClearsTheFloor(probeRows, "roles", probe));
check("people not holdings: the probe draws no bucket at all - six " +
  "holdings behind two members is not a cell (F1)",
  probe.enough === false && probe.distribution === null);
check("people not holdings: it answers the honest sub-floor sentence " +
  "rather than a bucket (F1)",
  typeof probe.note === "string" &&
  /not enough people for this view/i.test(probe.note));
check("people not holdings: no arithmetic over any field of that answer " +
  "recovers the two-member set - the floor is the only number in the " +
  "whole document (F1)",
  everyNumber(probe).length === 1 && everyNumber(probe)[0] === FLOOR);
check("people not holdings: no affiliation those two members hold is " +
  "named anywhere in the answer (F1)",
  !everyString(probe).some((s) => /^(feedee|gainer|admirer)$/.test(s)));

/*
 * The bucket's count is the number of people it stands for, and those
 * are the members no named cell describes.
 *
 * A member who holds a drawn value AND a suppressed one is already in
 * the picture, so they are not what the bucket is for; counting their
 * suppressed holding into it would inflate the bucket past the floor on
 * the strength of people who were never hidden. Here twelve hold
 * feeder, two hold feeder with a pair of rare affiliations, and five
 * hold feedee: pooled by count the bucket reads 9, pooled by person it
 * reads 5, and only the second is a number about anybody.
 */
const mixedRows = [];
for (let i = 0; i < 12; i += 1) mixedRows.push(rolesRow(i, ["feeder"]));
mixedRows.push(rolesRow(30, ["feeder", "gainer", "admirer"]));
mixedRows.push(rolesRow(31, ["feeder", "gainer", "admirer"]));
for (let i = 0; i < 5; i += 1) mixedRows.push(rolesRow(40 + i, ["feedee"]));
const mixed = agg.aggregate(mixedRows, ask("measure=roles"));
const mixedBehind = peopleBehind(mixedRows, "roles", drawnOf(mixed).cells);

check("people not holdings: every drawn cell of a multiple-choice " +
  "measure describes at least the floor's number of people, the bucket " +
  "included (F1)",
  mixed.enough === true &&
  everyCellClearsTheFloor(mixedRows, "roles", mixed));
check("people not holdings: the bucket's count IS the number of members " +
  "no named cell describes, never the holdings it swept up (F1)",
  drawnOf(mixed).cells.filter((c) => c.bucket === "other").length === 1 &&
  drawnOf(mixed).cells.filter((c) => c.bucket === "other")
    .every((c) => c.count === mixedBehind.hidden.size));
check("people not holdings: a member already drawn in a named cell is " +
  "not counted a second time into the bucket (F1)",
  mixedBehind.hidden.size === 5 &&
  !mixedBehind.hidden.has(acct(30)) && !mixedBehind.hidden.has(acct(31)));
check("people not holdings: no member falls out of the picture - every " +
  "one of them is described by a named cell they hold or by the bucket " +
  "(F1)",
  mixedRows.every((one) =>
    one.record.roles.some((v) => mixedBehind.per.has(v)) ||
    mixedBehind.hidden.has(one.accountId)));

/*
 * The boundary, both directions, measured in people.
 *
 * Twelve members hold feeder; five more hold one rare affiliation each,
 * so the pool stands for exactly the floor's number of people and the
 * bucket draws. Take one of those five away and the pool stands for
 * four: the cascade then absorbs the only named cell left, nothing
 * remains to draw beside the bucket, and the honest sub-floor sentence
 * is what comes back. That terminal case is the cost of counting people
 * and it is armed here on purpose rather than discovered later.
 */
const poolRows = [];
for (let i = 0; i < 12; i += 1) poolRows.push(rolesRow(i, ["feeder"]));
[["feedee"], ["feedee"], ["gainer"], ["gainer"], ["admirer"]]
  .forEach((held, i) => poolRows.push(rolesRow(20 + i, held)));
const atPool = agg.aggregate(poolRows, ask("measure=roles"));
const belowPool = agg.aggregate(poolRows.slice(0, poolRows.length - 1),
  ask("measure=roles"));

check("people not holdings: a bucket standing for exactly the floor's " +
  "number of people draws (F1)",
  atPool.enough === true &&
  drawnOf(atPool).cells.some((c) => c.bucket === "other" &&
    c.count === FLOOR));
check("people not holdings: one person fewer behind it and the absorb " +
  "cascade leaves nothing drawable - the honest sub-floor sentence is " +
  "what renders (F1)",
  belowPool.enough === false && belowPool.distribution === null &&
  /not enough people for this view/i.test(String(belowPool.note)));

/* What replaces "the drawn cells always sum to the population", which
   is simply untrue of a multiple-choice measure however the floor is
   applied: eighteen members here, twenty-six drawn counts, because
   eight of them hold two affiliations. Each count is still one person
   per value, which is why a NAMED cell needs no person-pooling of its
   own - heldValues() deduplicates, so a member reaches any one cell at
   most once. */
const doubledRows = [];
for (let i = 0; i < 10; i += 1) doubledRows.push(rolesRow(i, ["feeder"]));
for (let i = 0; i < 8; i += 1) {
  doubledRows.push(rolesRow(50 + i, ["feeder", "feedee"]));
}
const doubled = agg.aggregate(doubledRows, ask("measure=roles"));
const holdings = doubledRows.reduce((n, r) => n + r.record.roles.length, 0);

check("people not holdings: on a multiple-choice measure the drawn " +
  "counts sum to HOLDINGS and not to the population, and every one of " +
  "them is still a count of people (F1)",
  doubled.enough === true &&
  drawnOf(doubled).cells.reduce((n, c) => n + c.count, 0) === holdings &&
  holdings !== doubledRows.length &&
  everyCellClearsTheFloor(doubledRows, "roles", doubled));

/* A member cannot count twice in one cell by naming an affiliation
   twice - the same row-versus-person distinction, arriving through a
   record a browser wrote rather than through the corpus. */
const dupeRows = [];
for (let i = 0; i < 12; i += 1) dupeRows.push(rolesRow(i, ["feeder"]));
for (let i = 0; i < 5; i += 1) {
  dupeRows.push(rolesRow(70 + i, ["feedee", "feedee", "feedee"]));
}
const dupes = agg.aggregate(dupeRows, ask("measure=roles"));
check("people not holdings: a record naming one affiliation three times " +
  "is one person in that cell (F1)",
  dupes.enough === true &&
  drawnOf(dupes).cells.some((c) => c.value === "feedee" && c.count === 5));

/* The route reaches all of this: `roles` is chartable, so the defect
   was live rather than theoretical. */
check("people not holdings: a multiple-choice measure is a measure this " +
  "form charts - the input class the arm above covers is reachable (F1)",
  askFor("measure=roles").ok === true &&
  globalThis.BinderFields.measure("roles").multiple === true);

/* ================================================================== */
/* 5. One partition, not two (mandate 6).                              */

/* The widely spread group from section 3: with the outer edges open
   (F2) a corpus that draws a single bin leaves these arms nothing
   numeric to read, and every one of them would pass over an empty list.
   Five bins give four inner boundaries, which are the floor-cleared
   edges this rule is about. */
const partitioned = wide;
const systems = Object.keys(partitioned.units);

check("one partition: every unit system reports the same number of bins",
  systems.length > 1 &&
  systems.every((s) => drawnOf(partitioned).bins.every((b) =>
    Object.prototype.hasOwnProperty.call(b.from, s) &&
    Object.prototype.hasOwnProperty.call(b.to, s))));

check("one partition: the counts are one set of numbers, not one per " +
  "system - a bin carries a single count under every system's edges",
  drawnOf(partitioned).bins.every((b) => typeof b.count === "number"));

check("one partition: the partition names the system it was binned in " +
  "and that system is the spec's default",
  drawnOf(partitioned).partition.system ===
    globalThis.BINDER_SITE.units.default);

/* The edges are the partition's own edges CONVERTED through the spec's
   ratio and through nothing else. Checked against apps/web/fields.js rather
   than against the answer's other system, because the split check below
   compares the systems to each other and a conversion wrong by one
   constant in every system moves them together - true of the shape and
   wrong on the axis. Both questions are worth asking and only this one
   can see a second constant. */
{
  const part = drawnOf(partitioned).partition;

  /* The edges that carry a number at all. The drawn range's outer two
     are open since F2, so the arm reads the inner boundaries - and
     asserts there ARE some, because "every edge converts correctly" is
     true of no edges and would go quietly green if a later change
     opened them all. */
  const edges = [];
  for (const bin of drawnOf(partitioned).bins) {
    for (const side of ["from", "to"]) {
      if (typeof bin[side][part.system] === "number") edges.push(bin[side]);
    }
  }
  check("one partition: the drawn range has inner edges to read - the " +
    "checks below are asking something", edges.length >= 4);

  const off = edges.filter((edge) =>
    !systems.every((system) => {
      const unit = partitioned.units[system].unit;
      const factor = globalThis.BinderFields.factor(part.unit, unit);
      return typeof edge[system] === "number" &&
        Math.abs(edge[system] - edge[part.system] * factor) <= 0.06;
    }));
  check("one partition: every system's edges are the partition's edges " +
    "converted through the spec's own `per` ratio - no second binning " +
    "and no second constant", off.length === 0);

  /* The anchor that is not the answer's own arithmetic. Both checks
     above compare numbers this answer produced, so a conversion wrong by
     one constant EVERYWHERE moves all of them together and passes both -
     which its own mutation battery demonstrated. A partition edge is a
     multiple of the spec's band width by construction, and that is a
     fact about the spec rather than about the answer: it catches the
     uniform error, and it is also the privacy property in its own right,
     because an edge fitted to the smallest and largest values in a group
     reports somebody's real weight instead of a boundary. */
  const width = globalThis.BinderFields
    .measure(partitioned.measure.name).units[part.system].bin;
  const multiple = (edge) =>
    Math.abs(edge / width - Math.round(edge / width)) < 1e-6;
  check("one partition: every partition edge is a multiple of the " +
    "spec's own band width - the edges are the grid, never the group's " +
    "smallest and largest values",
    width > 0 && edges.length >= 4 &&
    edges.every((edge) => multiple(edge[part.system])));
}

/* The attack the rule exists for: overlay the two systems' edges and
   look for an intersection nobody drew. Because the edges are one
   partition converted, every metric edge is an imperial edge times a
   constant - so no boundary of one system ever falls strictly inside a
   bin of the other, and the intersection is always a whole bin. This is
   the differencing attempt, run over random groups rather than one. */
let splits = 0;
let checked = 0;
/* An open outer edge is unbounded, not zero (F2): read as a number it
   would be 0, which sits below every weight and would make the
   comparisons below answer about a boundary that is not there. Enough
   people that the groups draw SEVERAL bins, because a group that draws
   one bin now has two open ends and no boundary to test at all. */
const edgeAt = (edge, system, open) =>
  typeof edge[system] === "number" ? edge[system] : open;
for (let trial = 0; trial < 200; trial += 1) {
  const rows = [];
  const people = 20 + Math.floor(Math.random() * 40);
  for (let i = 0; i < people; i += 1) {
    rows.push(row(acct(i), "2026-08-01T00:00:00.000Z",
      record(60 + Math.random() * 140, 150 + Math.random() * 50,
        i % 2 ? "female" : "male", ["feeder"], "US")));
  }
  const answer = agg.aggregate(rows, ask("measure=weight"));
  if (!answer.enough) continue;
  const bins = drawnOf(answer).bins;
  const metric = bins.map((b) => [edgeAt(b.from, "metric", -Infinity),
    edgeAt(b.to, "metric", Infinity)]);
  const imperial = bins.map((b) => [edgeAt(b.from, "imperial", -Infinity),
    edgeAt(b.to, "imperial", Infinity)]);
  checked += 1;
  /* A split is a metric boundary strictly inside an imperial bin, which
     is what would let a reader intersect the two into a sub-floor cell.
     Compared through the ratio the spec itself carries, so a rounding of
     a tenth of a unit is not read as a split. */
  for (const [lo, hi] of imperial) {
    for (const [mlo] of metric) {
      const asImperial = mlo / 0.45359237;
      if (asImperial > lo + 0.5 && asImperial < hi - 0.5) splits += 1;
    }
  }
}
check("one partition: over " + checked + " random groups, no unit " +
  "system's bin boundary ever falls inside another system's bin - the " +
  "two cannot be differenced into a sub-floor cell (mandate 6)",
  checked > 50 && splits === 0);

/* ================================================================== */
/* 6. A trend of one line is a chart of one person.                    */

const overMonths = [];
/* August: the whole group. September: two of them. The September point
   is a chart of two people and must not be drawn at all. */
for (let i = 0; i < FLOOR + 2; i += 1) {
  overMonths.push(row(acct(i), "2026-08-1" + (i % 9) + "T00:00:00.000Z",
    record(100 + i, 170, "male", ["feeder"], "US")));
}
overMonths.push(row(acct(0), "2026-09-05T00:00:00.000Z",
  record(99, 170, "male", ["feeder"], "US")));
overMonths.push(row(acct(1), "2026-09-06T00:00:00.000Z",
  record(98, 170, "male", ["feeder"], "US")));

const trend = agg.aggregate(overMonths, ask("measure=weight"));
const periods = trend.trend.points.map((p) => p.period);

check("trend: a period the whole group submitted in is drawn",
  periods.includes("2026-08"));
check("trend: a period only two people submitted in is DROPPED, not " +
  "zeroed (mandate 6) - one line is one person",
  !periods.includes("2026-09"));
check("trend: the dropped period leaves no residue - its key appears " +
  "nowhere in the answer",
  !everyString(trend).includes("2026-09"));
check("trend: every drawn point describes at least the floor's number " +
  "of people",
  trend.trend.points.every((p) => p.people >= FLOOR));
check("trend: the line is the average and is called that - no " +
  "statistics vocabulary",
  trend.trend.points.every((p) =>
    p.average && typeof p.average.metric === "number") &&
  !everyString(trend).some((s) => /^(mean|median|stddev|sigma)$/i.test(s)));

/* One person submitting many times is one person, so a single member
   cannot draw a group line by submitting five times. */
const oneBusyPerson = [];
for (let i = 0; i < FLOOR + 3; i += 1) {
  oneBusyPerson.push(row(acct(7), "2026-08-0" + (i + 1) + "T00:00:00.000Z",
    record(120 + i, 170, "male", ["feeder"], "US")));
}
const busy = agg.aggregate(oneBusyPerson, ask("measure=weight"));
check("trend: one member submitting more than the floor's number of " +
  "times is still one person and draws nothing",
  busy.enough === false);

/* The same rule inside a view that DOES draw, which is the half the
   check above cannot reach: with five people the floor is cleared
   whatever the row count, so a distribution counting rows would draw
   there while the gate above stayed satisfied. One member's repeats
   would then be a cell of their own - the disclosure the row-versus-
   person distinction exists to refuse - and only their newest row is
   their current claim. */
const withRepeats = evenGroup(FLOOR);
[[200, "2026-08-02"], [225, "2026-08-03"], [250, "2026-08-04"]]
  .forEach((pair) => {
    withRepeats.push(row(acct(0), pair[1] + "T00:00:00.000Z",
      record(pair[0], 170, "male", ["feeder"], "US")));
  });
const repeats = agg.aggregate(withRepeats, ask("measure=weight"));
check("people, not rows: a member who submits four times is counted " +
  "once in the drawn distribution - the counts sum to the people, not " +
  "to the rows",
  repeats.enough === true &&
  drawnOf(repeats).bins.reduce((n, b) => n + b.count, 0) === FLOOR);
/* Read off the trend rather than off the top of the axis. The five
   people here merge into one drawn bin, whose every edge is an outer
   one and therefore open since F2 - so the axis no longer reports the
   250 kg claim, which is exactly what F2 is for. The August average
   still separates the readings cleanly: their newest row carries it
   past 120 kg, their corrected one would leave it near 102. */
check("people, not rows: it is their NEWEST row that stands - the " +
  "period's average reaches the weight they last claimed, not the one " +
  "they corrected",
  repeats.trend.points.length === 1 &&
  repeats.trend.points[0].average.metric > 120);

/* ================================================================== */
/* 7. The measure list derives from the spec (DESIGN.md, "Charts").     */

const forked = JSON.parse(JSON.stringify(globalThis.BINDER_SITE));
forked.fields.push({
  name: "meals", kind: "count", label: "Meals", term: "meals",
  bin: 2, chart: true,
});
check("derived: a fork adding a numeric field to its spec gets that " +
  "measure with no chart code written",
  askFor("measure=meals", forked).ok === true &&
  askFor("measure=meals").ok === false);

check("derived: a field the spec does not chart is not a measure",
  askFor("measure=over18").ok === false &&
  askFor("measure=nonesuch").ok === false);

/* ================================================================== */
/* 8. The route, end to end.                                           */

const ORIGIN = "http://localhost:8124";
const STORE_SECRET = "charts arm store secret / not a real one / v1";
const EXPORT_TOKEN = "charts-arm-export-token-belonging-to-nobody";

function makeDb() {
  const sessions = [];
  const submissions = [];
  const supersededBy = (r) =>
    submissions.some((x) =>
      x.supersedes === r.id && x.account_id === r.account_id);

  function first(sql, args) {
    if (/FROM sessions WHERE token_hash = \?/i.test(sql)) {
      return sessions.find((s) => s.token_hash === args[0]) || null;
    }
    /* POST /submit's correction pre-check, modelled so a member can
       really correct a row here and the aggregate can be watched
       counting them once. */
    if (/ AS mine/i.test(sql) && /AS corrected/i.test(sql)) {
      const [target, account, already] = [args[0], args[1], args[2]];
      return {
        mine: submissions.some((r) =>
          r.id === target && r.account_id === account) ? 1 : 0,
        corrected: submissions.some((r) => r.supersedes === already) ? 1 : 0,
      };
    }
    /* Modelled only so the non-scope check below can prove the route is
       still wired. Nothing here publishes one, so the read finds none. */
    if (/FROM snapshots WHERE id = 1/i.test(sql)) return null;
    throw new Error("unmodelled first(): " + sql);
  }
  function all(sql) {
    /* The charts read: every current row, no account scope, because the
       group is the subject. The tombstone predicate is APPLIED from the
       statement rather than assumed, so a read that stopped excluding
       superseded rows really does hand this stub the corrected row too -
       and a corrected member would then be counted twice, exactly as D1
       would count them. */
    if (/FROM submissions AS mine/i.test(sql)) {
      const excludes = /NOT EXISTS/i.test(sql);
      return {
        results: submissions.filter((r) => !excludes || !supersededBy(r))
          .map((r) => ({
            id: r.id, account_id: r.account_id,
            received_at: r.received_at, ciphertext: r.ciphertext,
          })),
      };
    }
    throw new Error("unmodelled all(): " + sql);
  }
  function run(sql, args) {
    if (/UPDATE sessions SET expires_at/i.test(sql)) {
      const s = sessions.find((x) => x.token_hash === args[1]);
      if (s) s.expires_at = args[0];
      return { meta: {} };
    }
    if (/INSERT INTO submissions/i.test(sql)) {
      const [id, account_id, ciphertext, received_at, supersedes] = args;
      submissions.push({ id, account_id, ciphertext, received_at,
        supersedes: supersedes === undefined ? null : supersedes });
      return { meta: { changes: 1 } };
    }
    throw new Error("unmodelled run(): " + sql);
  }
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => first(sql, args),
            all: async () => all(sql, args),
            run: async () => run(sql, args),
          };
        },
        first: async () => first(sql, []),
        all: async () => all(sql, []),
        run: async () => run(sql, []),
      };
    },
    _sessions: sessions,
    _submissions: submissions,
  };
}

const db = makeDb();
const env = {
  DB: db,
  STORE_SECRET,
  EXPORT_TOKEN,
  ALLOWED_ORIGINS: ORIGIN,
};

const future = new Date(Date.now() + 3600_000).toISOString();
function seedSession(token, accountId) {
  db._sessions.push({
    token_hash: sha256hex(token), account_id: accountId,
    is_admin: 0, is_dev: 0,
    created_at: new Date().toISOString(), expires_at: future,
  });
}

async function callOn(against, method, path, { token, body } = {}) {
  const headers = { Origin: ORIGIN };
  if (token) headers.Authorization = "Bearer " + token;
  const init = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  const res = await fetchWorker(
    new Request("https://sit.example" + path, init), against);
  let parsed = null;
  try { parsed = await res.json(); } catch { parsed = null; }
  return { status: res.status, body: parsed, headers: res.headers };
}

const call = (method, path, options) => callOn(env, method, path, options);

/* Seed through the real POST /submit, so the rows this route reads are
   sealed by the Worker's own store rather than by the arm. */
const TOKENS = [];
for (let i = 0; i < FLOOR + 2; i += 1) {
  const token = "charts-arm-session-" + i;
  TOKENS.push(token);
  seedSession(token, acct(i));
  await call("POST", "/submit", {
    token: token,
    body: { record: JSON.stringify(
      record(100 + i, 170 + (i % 5), i % 2 ? "female" : "male",
        ["feeder"], "US")) },
  });
}

const noSession = await call("GET", "/charts-data?measure=weight");
check("route: charts need a member session (401)", noSession.status === 401);

const breakGlass = await call("GET", "/charts-data?measure=weight",
  { token: EXPORT_TOKEN });
check("route: a break-glass caller has no account and is refused (401)",
  breakGlass.status === 401);

const drawn = await call("GET", "/charts-data?measure=weight",
  { token: TOKENS[0] });
check("route: a member session draws (200)", drawn.status === 200);
check("route: the response is private and never stored (mandate 6)",
  String(drawn.headers.get("Cache-Control")).toLowerCase()
    .includes("no-store") &&
  String(drawn.headers.get("Cache-Control")).toLowerCase()
    .includes("private"));
check("route: the drawn body carries a distribution built from the " +
  "sealed rows the Worker opened",
  Boolean(drawn.body) && drawn.body.enough === true &&
  drawn.body.distribution.bins.reduce((n, b) => n + b.count, 0) ===
    FLOOR + 2);

/* Mandate 2 at the route: a floor named on the wire is refused, and the
   floor in the answer is the module's own either way. */
const lowered = await call("GET", "/charts-data?measure=weight&floor=1",
  { token: TOKENS[0] });
check("route: a floor named on the wire is refused (400), not honored " +
  "and not ignored (mandate 2)", lowered.status === 400);
check("route: the answer reports the module's floor",
  drawn.body.floor === FLOOR);

const badMeasure = await call("GET", "/charts-data?measure=telegram",
  { token: TOKENS[0] });
check("route: a measure the spec does not chart is refused (400)",
  badMeasure.status === 400);

/* Mandate 5: the filter echoes the caller's own value and enumerates
   nothing. The group here is all US, so a JP filter is a value nobody
   holds - and the answer must not say so by naming what people do hold. */
const echoed = await call("GET", "/charts-data?measure=weight&filter=country&value=JP",
  { token: TOKENS[0] });
check("route: the filter echoes back exactly the caller's own value " +
  "(mandate 5)",
  echoed.status === 200 && echoed.body.filter.field === "country" &&
  echoed.body.filter.value === "JP");
check("route: a filter value nobody holds answers the same not-enough " +
  "document as a sub-floor group (mandate 4)",
  echoed.body.enough === false && echoed.body.distribution === null);
check("route: the answer never enumerates the values the group actually " +
  "holds (mandate 5)",
  !everyString(echoed.body).includes("US"));
/* The echo's SHAPE is the enumeration guard, because the leak this
   mandate names would arrive as a helpful third field - the values on
   offer, the values in the group - rather than as a wrong value in the
   two that belong. Exactly two keys, so anything added is a red. */
check("route: the filter echo carries the caller's own field and value " +
  "and nothing beside them (mandate 5)",
  JSON.stringify(Object.keys(echoed.body.filter)) ===
    JSON.stringify(["field", "value"]));

const badValue = await call("GET",
  "/charts-data?measure=weight&filter=country&value=not-a-country",
  { token: TOKENS[0] });
check("route: a filter value outside the config-derived allowlist is " +
  "refused (400) - the allowlist is a repository file, so this " +
  "discloses nothing about members", badValue.status === 400);

/* Mandate 3: the overlay is keyed by the session and by nothing on the
   wire. Two members ask the same question and get their own line. */
const mineA = await call("GET", "/charts-data?measure=weight&self=1",
  { token: TOKENS[0] });
const mineB = await call("GET", "/charts-data?measure=weight&self=1",
  { token: TOKENS[1] });
check("self: the overlay comes back in its own field, never merged into " +
  "the group series (mandate 3)",
  mineA.body.self !== null && mineA.body.self !== undefined &&
  Array.isArray(mineA.body.self.points) &&
  mineA.body.self.points.length === 1);
check("self: two members asking one question get their own lines",
  JSON.stringify(mineA.body.self) !== JSON.stringify(mineB.body.self));
check("self: the group half of both answers is identical - the overlay " +
  "changes nothing about what the group discloses",
  JSON.stringify(Object.assign({}, mineA.body, { self: null })) ===
    JSON.stringify(Object.assign({}, mineB.body, { self: null })));
check("self: the overlay is absent unless it is asked for",
  drawn.body.self === null);

const impersonated = await call("GET",
  "/charts-data?measure=weight&self=" + acct(1), { token: TOKENS[0] });
check("self: a caller-supplied identity cannot be named at all - the " +
  "flag is a boolean and anything else is refused (mandate 3)",
  impersonated.status === 400);

for (const attempt of ["account", "accountId", "subject", "handle", "member"]) {
  const named = await call("GET",
    "/charts-data?measure=weight&self=1&" + attempt + "=" + acct(1),
    { token: TOKENS[0] });
  check("self: naming another account through `" + attempt + "` is " +
    "refused (400) rather than resolved (mandate 3)", named.status === 400);
}

/* The record contract's envelope half, pinned at the route: every
   sealed row here really carries `telegram`, `submittedAt`, `entered`
   and the record's own version byte, and none of them is a measure - so
   none can reach a response through valueFor() or heldValues(). The
   handle is looked for by VALUE as well as by field name, because a
   leak would arrive as the handle itself and not as a key called
   "telegram". */
check("route: no account id, handle or row id appears anywhere in a " +
  "drawn answer - the record's envelope fields reach no response",
  !everyString(drawn.body).some((s) => /^[0-9a-f]{64}$/.test(s)) &&
  !everyString(drawn.body).some((s) =>
    /telegram|arm_handle_|submittedAt|entered/.test(s)) &&
  db._submissions.length > 0);

/* The overlay has no floor - their data, their line - and that is true
   even where the group has nothing to say. */
const loneDb = makeDb();
const loneEnv = Object.assign({}, env, { DB: loneDb });
loneDb._sessions.push({
  token_hash: sha256hex("charts-arm-lonely"), account_id: acct(99),
  is_admin: 0, is_dev: 0,
  created_at: new Date().toISOString(), expires_at: future,
});
const loneCall = async (path) => {
  const res = await fetchWorker(new Request("https://sit.example" + path, {
    method: "GET",
    headers: { Origin: ORIGIN, Authorization: "Bearer charts-arm-lonely" },
  }), loneEnv);
  return { status: res.status, body: await res.json() };
};
await fetchWorker(new Request("https://sit.example/submit", {
  method: "POST",
  headers: { Origin: ORIGIN, Authorization: "Bearer charts-arm-lonely",
    "Content-Type": "application/json" },
  body: JSON.stringify({ record: JSON.stringify(record(88, 168)) }),
}), loneEnv);
const lonely = await loneCall("/charts-data?measure=weight&self=1");
check("self: a member alone in the corpus still gets their own line " +
  "while the group answers not-enough - their data, their line",
  lonely.status === 200 && lonely.body.enough === false &&
  lonely.body.self.points.length === 1);

/* A correction is a second row for one person, and the corrected row is
   a tombstone the read excludes. Counted twice, one member would clear a
   floor of five by correcting themselves four times - which is the row-
   versus-person distinction the floor rests on, arriving through the
   database rather than through the aggregator. */
const corrected = db._submissions.find((r) => r.account_id === acct(0));
await call("POST", "/submit", {
  token: TOKENS[0],
  body: { record: JSON.stringify(record(140, 170, "male", ["feeder"], "US")),
    supersedes: corrected.id },
});
const afterCorrection = await call("GET", "/charts-data?measure=weight",
  { token: TOKENS[0] });
check("correction: a member who corrects a row is still one person in " +
  "the group - the tombstone is excluded by the read, not counted",
  afterCorrection.status === 200 && afterCorrection.body.enough === true &&
  drawnOf(afterCorrection.body).bins
    .reduce((n, b) => n + b.count, 0) === FLOOR + 2);

/* A tombstone in a PAST period is where excluding it can be seen at all.
   Inside one period, latest-per-account already picks the correction, so
   the read's own NOT EXISTS predicate changes nothing an arm could
   notice - which its own mutation battery proved by dropping the
   predicate and reddening nothing. Across periods it is a whole point:
   with the tombstones counted, a month every member has since corrected
   still draws a line from the values they retracted. */
const histDb = makeDb();
const histEnv = Object.assign({}, env, { DB: histDb });
const HIST_TOKENS = [];
for (let i = 0; i < FLOOR + 2; i += 1) {
  const token = "charts-arm-history-" + i;
  HIST_TOKENS.push(token);
  histDb._sessions.push({
    token_hash: sha256hex(token), account_id: acct(i),
    is_admin: 0, is_dev: 0,
    created_at: new Date().toISOString(), expires_at: future,
  });
  await callOn(histEnv, "POST", "/submit", {
    token: token,
    body: { record: JSON.stringify(record(100 + i, 170)) },
  });
}
/* Backdated in the stub rather than through the route, because the
   receipt time is the Worker's own clock and there is deliberately no
   way to choose it from the wire - which is the property under test one
   layer down. */
const original = histDb._submissions.map((r) => {
  r.received_at = "2026-05-1" + (r.id % 9) + "T00:00:00.000Z";
  return { id: r.id, account_id: r.account_id };
});
for (let i = 0; i < HIST_TOKENS.length; i += 1) {
  const mineRow = original.filter((r) => r.account_id === acct(i))[0];
  await callOn(histEnv, "POST", "/submit", {
    token: HIST_TOKENS[i],
    body: { record: JSON.stringify(record(150 + i, 170)),
      supersedes: mineRow.id },
  });
}
const history = await callOn(histEnv, "GET", "/charts-data?measure=weight",
  { token: HIST_TOKENS[0] });
check("tombstones: a month every member has since corrected draws no " +
  "point - the read excludes superseded rows rather than averaging " +
  "values people retracted",
  history.status === 200 && history.body.enough === true &&
  !history.body.trend.points.some((p) => p.period === "2026-05"));
check("tombstones: the correction's own month is the one that draws",
  history.body.enough === true && history.body.trend.points.length === 1);

/*
 * RETIRED (0.9-M2-S3, #354): section 9 stood here, "Not this slice's to
 * touch: the snapshot routes stay alive until the Charts page stops
 * reading them" - a deliberate non-scope pin from 0.9-M2-S0 pointing at
 * THIS slice as the one that closes it. It is closed: server/worker.js
 * no longer routes /snapshot at all (deletion, not gating), so a call
 * to it now falls to env.ASSETS.fetch exactly like any other unknown
 * path - this file stubs no ASSETS binding, on purpose, the same
 * reason tests/route-precedence.test.mjs gives for its own stub env
 * carrying none; that file is where the retired route's own checks
 * live now, driven against a real ASSETS stub.
 */

/* ------------------------------------------------------------------ */
const EXPECTED = 90;
console.log(failures
  ? `\ncharts-aggregate FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\ncharts-aggregate ran ${performed} checks, expected ${EXPECTED}`
    : `\ncharts-aggregate OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
