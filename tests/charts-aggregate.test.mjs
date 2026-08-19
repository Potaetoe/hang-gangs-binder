/*
 * The Worker aggregates on request, armed. 0.9-M2-S0 (#351), reshaped by
 * 0.9-M2-S10 (#371) to the owner's charts ruling (#243 comment
 * 5346978974), over server/charts-agg.js and the GET /charts-data route
 * in server/worker.js.
 *
 *     node tests/charts-aggregate.test.mjs
 *
 * WHAT THIS ARM IS FOR, AND WHAT CHANGED UNDER IT. DESIGN.md, "Charts",
 * used to rule a suppression floor of five over every cell, band and
 * trend point. The owner re-took that at the 2026-08-19 charts sitting,
 * across five rounds including an adversarial one, and ruled the floor a
 * SETTING whose shipped default is 0: "members chose to share". So this
 * file arms two worlds at once and the split is the whole design of it.
 *
 *   1. THE SHIPPED WORLD, floor 0. Every cell, band and month draws its
 *      true value however few people are behind it. The one-person view
 *      is the accepted consequence, not a defect, and it is armed here
 *      as a positive claim so that a later change quietly reviving
 *      suppression reddens.
 *   2. THE MACHINERY, at floor 5. Nothing was ripped out - the Other
 *      bucket, person-pooling, band merging and the one-partition rule
 *      all still exist and still obey whatever floor the setting holds.
 *      Every proof of them survives here, parameterized on the raised
 *      floor rather than deleted, because the way back is a number and a
 *      number nobody proves is not a way back.
 *
 * THE FLOOR REACHES THIS FILE THROUGH THE SETTINGS SEAM AND NOWHERE
 * ELSE. aggregate()'s fourth argument is a settings object; 0.9-M3's
 * Settings page is what will fill it. Nothing on the wire can: askFor()
 * refuses a parameter it does not know, so `?floor=1` is a 400 rather
 * than a silent no-op, and that arm is unchanged from the day the floor
 * was a constant.
 *
 * TWO HALVES, AND THE SPLIT IS DELIBERATE.
 *
 *   1. The aggregator as the pure function it is. Rows in, one answer
 *      out - no crypto, no D1, no session. Every disclosure rule is
 *      decided there, so it is armed here.
 *   2. The route end to end through the real fetch(), with real
 *      store-crypto seals and a D1 stub - the gate, the echo, the
 *      unknown-parameter refusal, the self overlay's keying, and the
 *      response headers.
 *
 * THE SECURITY MANDATES THIS ARM PINS (0.9-M2-S0, binder-security Mode 2,
 * 2026-08-18), as the #243 ruling leaves them. Each mandate is a claim;
 * the arm beside it is its proof.
 *   1. One module owns the only rows-to-series path and applies the
 *      floor it was given before returning - the handler serializes what
 *      it is given and cannot compute a cell.
 *   2. No floor input FROM THE WIRE. The floor is a setting, read from
 *      the server side; an unknown query parameter is refused rather
 *      than ignored, so `?floor=1` is a 400.
 *   3. The self overlay is keyed ONLY by the session's account, returns
 *      in its own field, and never routes through the group aggregator.
 *   4. Empty and sub-floor are one shape: same status, same sentence, no
 *      counts, no residue. At floor 0 only the empty half can happen,
 *      which is ruling 7's "the only refusal state left".
 *   5. Filters echo, never enumerate. The group-makeup block is not that
 *      rule's subject and the distinction is load-bearing: it lists the
 *      SPEC's own values with counts, which is a chart, where the echo
 *      would be handing back what a caller asked about the group.
 *   6. One partition, binned once in the spec's default system and
 *      reported under converted edges; no data-derived edge anywhere;
 *      no-store.
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

const SHIPPED_FLOOR = agg.DEFAULT_FLOOR;

/*
 * The floor the MACHINERY is proven at, and the reason every arm below
 * that mentions suppression carries this object.
 *
 * Five is what the floor used to be as a constant, so parameterizing on
 * it keeps every proof written against that world exactly as strong as
 * it was - which is the point: the #243 ruling turned the machinery off
 * by default, it did not delete it, and a setting nobody can prove works
 * is not a setting anybody can turn back on.
 */
const RAISED = 5;
const raised = Object.freeze({ floor: RAISED });

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
 * Reading `.distribution.bins` straight off a not-enough answer throws a
 * TypeError that takes the whole run down and hides every check after it
 * - a mutation on the floor did exactly that, and a suite that reports a
 * crash instead of a red is a suite whose remaining arms nobody saw. A
 * corpus can stop drawing for a reason that is not the arm's own subject,
 * so every probe reads the answer through here and pairs it with its own
 * `enough` assertion. The stand-in carries the shape empty, which is why
 * the pairing matters: `.every()` over nothing is true.
 */
const NOTHING_DRAWN = Object.freeze({
  kind: null, bins: [],
  partition: { system: null, unit: null, band: null },
});
function drawnOf(answer) {
  return answer && answer.enough && answer.distribution
    ? answer.distribution : NOTHING_DRAWN;
}

/*
 * One category's count lines out of a drawn answer, or an empty list.
 *
 * The group-makeup block is where every categorical count lives since
 * #371 - `measure=<a category>` is no longer an ask at all - so the
 * suppression proofs that used to drive a categorical measure drive this
 * instead. Same cells, same machinery, different address.
 */
function groupBlock(answer, field) {
  if (!answer || !answer.enough || !Array.isArray(answer.groups)) return [];
  const found = answer.groups.filter((one) => one.field === field)[0];
  return found ? found.values : [];
}

/*
 * One line's count, or null when there is no such line - and null
 * rather than a throw for the same reason drawnOf() exists. Reading
 * `.filter(...)[0].count` off a block a mutation emptied throws a
 * TypeError that takes the whole run down and hides every arm after it,
 * so a suite that reports a crash instead of a red is a suite whose
 * remaining arms nobody saw. The mutation battery on this slice found
 * exactly that, three times.
 */
function countIn(cells, value) {
  const found = (cells || []).filter((one) => one.value === value)[0];
  return found ? found.count : null;
}

/* The same, straight off a route body, which carries the block beside a
   `self` field the pure aggregator knows nothing about. */
function bodyBlock(body, field) {
  if (!body || !Array.isArray(body.groups)) return [];
  const found = body.groups.filter((one) => one.field === field)[0];
  return found ? found.values : [];
}

/* An answer's trend points, or none - `trend` is null on every answer
   that draws nothing, for the same reason `distribution` is. */
function pointsOf(answer) {
  return answer && answer.trend && Array.isArray(answer.trend.points)
    ? answer.trend.points : [];
}

/*
 * How many PEOPLE each count line really stands for, counted from the
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

/* Every drawn count line describes at least the floor's number of
   PEOPLE - the whole claim of a raised floor, asked of an answer against
   the corpus that produced it. A cell of zero describes nobody and is
   not a disclosure. */
function everyCellClearsTheFloor(rows, field, answer) {
  const cells = groupBlock(answer, field);
  const behind = peopleBehind(rows, field, cells);
  return cells.length > 0 && cells.every((cell) =>
    cell.count === 0 || (cell.bucket === "other"
      ? behind.hidden.size >= RAISED
      : behind.per.get(cell.value) >= RAISED));
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

/* The two worlds, spelled out at every call site so no arm is ambiguous
   about which floor it is asking under. */
const atShippedFloor = (rows, query, spec) =>
  agg.aggregate(rows, ask(query, spec), spec);
const atRaisedFloor = (rows, query, spec) =>
  agg.aggregate(rows, ask(query, spec), spec, raised);

/* The spec's own grid for the default partition, computed here from the
   config rather than from the answer - the whole claim of a fixed band
   is that it does not come from the data, and an arm that read the
   edges off the answer could not tell. */
const SITE = globalThis.BINDER_SITE;
const WEIGHT_UNIT = SITE.units.kinds.weight.units[
  SITE.units.kinds.weight.chart[SITE.units.default]];
const W_MIN = WEIGHT_UNIT.min;
const W_MAX = WEIGHT_UNIT.max;
const W_BIN = WEIGHT_UNIT.bin;
const W_BANDS = Math.ceil((W_MAX - W_MIN) / W_BIN);
const lbOf = (kg) => kg / 0.45359237;
const bandIndex = (kg) =>
  Math.min(W_BANDS - 1, Math.max(0, Math.floor((lbOf(kg) - W_MIN) / W_BIN)));

/* ================================================================== */
/* 0. The floor is a setting, its shipped default is 0, and the only    */
/*    way in is the settings seam.                                      */

check("the shipped floor is 0 - the #243 ruling's default, not the 5 " +
  "the machinery used to hold as a constant", SHIPPED_FLOOR === 0);

check("the floor arrives through a settings object and nothing else - " +
  "aggregate() takes rows, the ask, the spec and the settings",
  agg.aggregate.length === 4);

const onePerson = [row(acct(1), "2026-08-01T00:00:00.000Z",
  record(100, 170, "male", ["feeder"], "US"))];

check("the settings seam raises the floor: the same one-person corpus " +
  "draws at the shipped floor and answers not-enough at 5",
  atShippedFloor(onePerson, "measure=weight").enough === true &&
  atRaisedFloor(onePerson, "measure=weight").enough === false);

/* A settings object is the seam; a stray positional or a junk value is
   not, and each falls back to the shipped default rather than being read
   as a floor. The risk direction has flipped since the floor was a
   constant - nothing can be lowered below 0 - so what this guards is a
   setting that silently fails to APPLY. */
for (const junk of [5, "5", null, { floor: "5" }, { floor: -1 },
  { floor: 2.5 }, { floor: NaN }, { min: 5 }]) {
  const answer = agg.aggregate(onePerson, ask("measure=weight"),
    undefined, junk);
  check("the seam takes a whole non-negative number in a settings " +
    "object and nothing else (" + JSON.stringify(junk) + " reads as the " +
    "shipped default)", answer.floor === SHIPPED_FLOOR &&
    answer.enough === true);
}

check("the answer reports the floor it applied, both ways",
  atShippedFloor(onePerson, "measure=weight").floor === SHIPPED_FLOOR &&
  atRaisedFloor(evenGroup(RAISED), "measure=weight").floor === RAISED);

/* Mandate 2, unchanged by the ruling: the setting is read server-side
   and the wire cannot name it. */
for (const attempt of ["floor", "min_cell", "minCell", "identify", "units",
  "system", "basis", "settings"]) {
  const refused = askFor("measure=weight&" + attempt + "=1");
  check("no floor input: an unknown query parameter (" + attempt + ") is " +
    "refused rather than ignored", refused.ok === false);
}

/* ================================================================== */
/* 1. Floor 0 draws everything, and that is the ruling.                 */
/*                                                                     */
/* Put adversarially to the owner and accepted in their own words -    */
/* "members chose to share" - with the one-person-view consequence     */
/* stated plainly: a filter isolating one member shows that member's   */
/* number to every signed-in member. These arms are that consequence   */
/* written as a positive claim, so suppression cannot creep back in    */
/* under a raised default without a red.                               */

const solo = atShippedFloor(onePerson, "measure=weight");
const soloBins = drawnOf(solo).bins;

check("floor 0: a view of one person draws rather than refusing",
  solo.enough === true && solo.note === null);
check("floor 0: the band that member sits in carries the true count of " +
  "one, and it is the only band that carries anybody",
  soloBins.length === W_BANDS &&
  soloBins[bandIndex(100)].count === 1 &&
  soloBins.reduce((n, b) => n + b.count, 0) === 1);
check("floor 0: every other band is present and reads zero - an empty " +
  "band is an empty slot, never a hole in the axis",
  soloBins.filter((b) => b.count === 0).length === W_BANDS - 1);
check("floor 0: their month draws with its true average over one person",
  pointsOf(solo).length === 1 &&
  pointsOf(solo)[0].people === 1 &&
  Math.abs(pointsOf(solo)[0].average.metric - 100) < 0.6);
check("floor 0: the group makeup counts that one member exactly, and " +
  "lists every other value of the spec at zero",
  countIn(groupBlock(solo, "gender"), "male") === 1 &&
  groupBlock(solo, "gender").filter((c) => c.value !== "male")
    .every((c) => c.count === 0));

/* Ruling 7: the only refusal state left. Zero matching entries is not a
   sub-floor group at floor 0 - there is nobody at all - and the honest
   sentence is what the page turns into "try a broader filter". */
const emptyView = atShippedFloor(onePerson,
  "measure=weight&filter=country&value=JP");
check("floor 0: a view with nobody in it is the ONE refusal left, and " +
  "it answers the honest sentence rather than an error",
  emptyView.enough === false && emptyView.distribution === null &&
  emptyView.trend === null && emptyView.groups === null &&
  /not enough people for this view/i.test(String(emptyView.note)));
check("floor 0: the empty answer carries no count anywhere - the floor " +
  "is the only number in the whole document (mandate 4)",
  everyNumber(emptyView).length === 1 &&
  everyNumber(emptyView)[0] === SHIPPED_FLOOR);
check("floor 0: an empty corpus answers the same document",
  JSON.stringify(atShippedFloor([], "measure=weight")) ===
    JSON.stringify(Object.assign({}, emptyView,
      { filter: { field: null, value: null } })));

/* A measure nobody in the view answered is the other honest nothing: a
   BMI needs a height, so a corpus of weights alone draws no BMI. */
const noHeight = [row(acct(3), "2026-08-01T00:00:00.000Z",
  { record: 1, weight: { kg: 90, lb: 198.4 }, gender: "male", roles: [],
    country: "US" })];
check("floor 0: a measure nobody in the view answered draws nothing " +
  "rather than a grid of zeros",
  atShippedFloor(noHeight, "measure=bmi").enough === false);

/* ================================================================== */
/* 2. One member is one member, decided on their MOST RECENT entry.     */

const threeEntries = [
  row(acct(5), "2026-06-01T00:00:00.000Z",
    record(100, 170, "male", ["feeder"], "US")),
  row(acct(5), "2026-07-01T00:00:00.000Z",
    record(101, 170, "female", ["feedee"], "FR")),
  row(acct(5), "2026-08-01T00:00:00.000Z",
    record(102, 170, "nonbinary", ["gainer"], "JP")),
];
const latest = atShippedFloor(threeEntries, "measure=weight");

check("unique by latest: three entries from one member are one member " +
  "in the distribution",
  latest.enough === true &&
  drawnOf(latest).bins.reduce((n, b) => n + b.count, 0) === 1);
check("unique by latest: their MOST RECENT entry decides their category " +
  "- the two they superseded count nowhere",
  groupBlock(latest, "gender")
    .filter((c) => c.count > 0).map((c) => c.value).join() === "nonbinary" &&
  groupBlock(latest, "country")
    .filter((c) => c.count > 0).map((c) => c.value).join() === "JP" &&
  groupBlock(latest, "roles")
    .filter((c) => c.count > 0).map((c) => c.value).join() === "gainer");
check("unique by latest: the filter reads the same current entry - a " +
  "value they have moved on from matches nobody",
  atShippedFloor(threeEntries,
    "measure=weight&filter=country&value=JP").enough === true &&
  atShippedFloor(threeEntries,
    "measure=weight&filter=country&value=FR").enough === false);

/* Two rows stamped at the same instant: the higher row id is the later
   one, because a receipt clock can tie and a row id cannot. */
const tied = [
  row(acct(6), "2026-08-01T00:00:00.000Z",
    record(100, 170, "male", ["feeder"], "US")),
  row(acct(6), "2026-08-01T00:00:00.000Z",
    record(100, 170, "female", ["feeder"], "US")),
];
check("unique by latest: two entries at the same instant break the tie " +
  "on the row id, so one of them is still the current one",
  groupBlock(atShippedFloor(tied, "measure=weight"), "gender")
    .filter((c) => c.count > 0).map((c) => c.value).join() === "female");

/* ================================================================== */
/* 3. Fixed bands: the edges come from the spec and never from the data.*/
/*                                                                     */
/* Owner ruling 5 (#243): "Edges come from the field spec and never    */
/* move or merge." This kills the open outer edge that #351's fix wave */
/* 1 introduced as finding F2 - an outer edge derived from the         */
/* heaviest member reported her band, so it was reported as open       */
/* instead. A spec edge derives from nobody, so there is nothing left  */
/* to open: comparability is what the owner chose, and it is only      */
/* comparable if two groups get the same axis.                         */

const lightCrowd = [];
const heavyCrowd = [];
for (let i = 0; i < 12; i += 1) {
  lightCrowd.push(row(acct(i), "2026-08-01T00:00:00.000Z",
    record(60 + i, 170, "male", ["feeder"], "US")));
  heavyCrowd.push(row(acct(i), "2026-08-01T00:00:00.000Z",
    record(200 + i, 170, "male", ["feeder"], "US")));
}
const light = atShippedFloor(lightCrowd, "measure=weight");
const heavy = atShippedFloor(heavyCrowd, "measure=weight");
const edgesOf = (answer) => drawnOf(answer).bins
  .map((b) => JSON.stringify([b.from, b.to]));

check("fixed bands: two groups with nothing in common draw the SAME " +
  "edges - the axis is the spec's, so the two charts are comparable",
  light.enough === true && heavy.enough === true &&
  JSON.stringify(edgesOf(light)) === JSON.stringify(edgesOf(heavy)));
check("fixed bands: only the counts differ between them",
  JSON.stringify(drawnOf(light).bins.map((b) => b.count)) !==
    JSON.stringify(drawnOf(heavy).bins.map((b) => b.count)));

const partitionSystem = drawnOf(light).partition.system;
const lightBins = drawnOf(light).bins;
check("fixed bands: the first edge is the spec's own minimum and the " +
  "last is the spec's own maximum - the outer edges are configuration",
  lightBins[0].from[partitionSystem] === W_MIN &&
  lightBins[lightBins.length - 1].to[partitionSystem] === W_MAX);
check("fixed bands: no edge is open - the null edge #351 needed is gone " +
  "with the data-derived edge that made it necessary (F2)",
  lightBins.every((b) => Object.keys(b.from).every((s) =>
    typeof b.from[s] === "number" && typeof b.to[s] === "number")));
check("fixed bands: every inner edge is the spec's minimum plus a whole " +
  "number of the spec's own band widths",
  lightBins.slice(1).every((b) =>
    Math.abs((b.from[partitionSystem] - W_MIN) / W_BIN -
      Math.round((b.from[partitionSystem] - W_MIN) / W_BIN)) < 1e-9));
check("fixed bands: the grid spans the spec's whole range at the spec's " +
  "own width", lightBins.length === W_BANDS);
check("fixed bands: no band is wider than the spec's band width - " +
  "nothing merges at floor 0 (ruling 5)",
  lightBins.every((b) =>
    b.to[partitionSystem] - b.from[partitionSystem] <= W_BIN + 1e-9));
check("fixed bands: the edges are contiguous, so no member falls " +
  "between two bands",
  lightBins.every((b, i, all) =>
    i === 0 || b.from[partitionSystem] === all[i - 1].to[partitionSystem]));
check("fixed bands: the drawn counts sum to the people with a value",
  lightBins.reduce((n, b) => n + b.count, 0) === lightCrowd.length);

/* A record carrying a value the FORM would have refused still belongs to
   somebody, so it lands in the outer band rather than falling out of the
   count. The grid cannot grow to meet it: an edge that moved for one
   member's number would be that member's number. */
const outsideRows = evenGroup(4).concat([
  row(acct(80), "2026-08-01T00:00:00.000Z",
    record(900, 175, "male", ["feeder"], "US")),
]);
const outside = atShippedFloor(outsideRows, "measure=weight");
check("fixed bands: a value beyond the spec's own range lands in the " +
  "outer band and is still counted - the grid does not move for it",
  outside.enough === true &&
  drawnOf(outside).bins.length === W_BANDS &&
  drawnOf(outside).bins.reduce((n, b) => n + b.count, 0) ===
    outsideRows.length &&
  drawnOf(outside).bins[W_BANDS - 1].count === 1);

/* A measure whose chart unit carries no bound of its own: imperial
   height is charted in inches and the spec bounds FEET, which is the
   unit a member of that system types into. The grid still comes from the
   spec - converted through the spec's own ratio, never guessed. */
const heights = atShippedFloor(evenGroup(6), "measure=height");
const heightBins = drawnOf(heights).bins;
const FT = SITE.units.kinds.length.units.ft;
check("fixed bands: a chart unit the spec gives no bound falls back to " +
  "the same system's own entry unit, converted - imperial height is " +
  "binned in inches between the spec's feet",
  heights.enough === true &&
  Math.abs(heightBins[0].from.imperial - FT.min * 12) < 1e-6 &&
  Math.abs(heightBins[heightBins.length - 1].to.imperial -
    FT.max * 12) < 1e-6);

/* ================================================================== */
/* 3b. One partition, not two (mandate 6).                             */

const systems = Object.keys(light.units);
check("one partition: every unit system reports the same bands",
  systems.length > 1 &&
  systems.every((s) => lightBins.every((b) =>
    Object.prototype.hasOwnProperty.call(b.from, s) &&
    Object.prototype.hasOwnProperty.call(b.to, s))));
check("one partition: a band carries a single count under every " +
  "system's edges, not one count per system",
  lightBins.every((b) => typeof b.count === "number"));
check("one partition: the partition names the system it was binned in " +
  "and that system is the spec's default",
  drawnOf(light).partition.system === SITE.units.default);

{
  const part = drawnOf(light).partition;
  const off = lightBins.filter((bin) =>
    !systems.every((system) => {
      const unit = light.units[system].unit;
      const factor = globalThis.BinderFields.factor(part.unit, unit);
      return Math.abs(bin.from[system] -
        bin.from[part.system] * factor) <= 0.06;
    }));
  check("one partition: every system's edges are the partition's edges " +
    "converted through the spec's own `per` ratio - no second binning " +
    "and no second constant", off.length === 0);
}

/* The attack the rule exists for: overlay the two systems' edges and
   look for an intersection nobody drew. Because the edges are one
   partition converted, every metric edge is an imperial edge times a
   constant - so no boundary of one system ever falls strictly inside a
   band of the other. Run at the RAISED floor, where merging is live and
   the drawn edges are a subset of the grid chosen per group: a fixed
   grid alone could not fail this, and the merged case is the one that
   could. */
let splits = 0;
let checked = 0;
for (let trial = 0; trial < 60; trial += 1) {
  const rows = [];
  const people = 20 + Math.floor(Math.random() * 40);
  for (let i = 0; i < people; i += 1) {
    rows.push(row(acct(i), "2026-08-01T00:00:00.000Z",
      record(60 + Math.random() * 140, 150 + Math.random() * 50,
        i % 2 ? "female" : "male", ["feeder"], "US")));
  }
  const answer = atRaisedFloor(rows, "measure=weight");
  if (!answer.enough) continue;
  const bins = drawnOf(answer).bins;
  checked += 1;
  for (const bin of bins) {
    for (const other of bins) {
      const asImperial = other.from.metric / 0.45359237;
      if (asImperial > bin.from.imperial + 0.5 &&
          asImperial < bin.to.imperial - 0.5) splits += 1;
    }
  }
}
check("one partition: over " + checked + " random groups at the raised " +
  "floor, no unit system's band boundary ever falls inside another " +
  "system's band (mandate 6)", checked > 20 && splits === 0);

/* ================================================================== */
/* 3c. The BMI axis is DERIVED from the form's own bounds.             */
/*                                                                     */
/* Owner ruling, #371 comment 5347769320: the range derives from the   */
/* form's bounds so that NO form-valid member draws clipped - "in a    */
/* gaining community the high end IS the story". A hand-picked cap is  */
/* exactly what this refuses: BMI has no unit table to keep bounds in, */
/* so the numbers in the spec row are the whole axis, and a cap chosen */
/* for looking reasonable silently redraws everybody past it as the    */
/* top band's neighbour. These arms compute the bounds the form really */
/* admits and hold the spec to covering them, so a later narrowing     */
/* reddens here rather than in a chart nobody checks.                  */

/*
 * The widest value the FORM would accept for one kind, in that kind's
 * base unit.
 *
 * Every unit of the kind is asked, not just the one this system charts:
 * a member types kilograms or pounds, feet or centimeters, and each unit
 * carries its own bounds in its own numbers (44 lb is not 20 kg). The
 * widest of them is what "form-valid" means, so it is what an axis has
 * to cover.
 */
function formBounds(kindName) {
  const kind = SITE.units.kinds[kindName];
  let low = null;
  let high = null;
  for (const name of Object.keys(kind.units)) {
    const unit = kind.units[name];
    if (typeof unit.min === "number") {
      const value = unit.min * unit.per;
      if (low === null || value < low) low = value;
    }
    if (typeof unit.max === "number") {
      const value = unit.max * unit.per;
      if (high === null || value > high) high = value;
    }
  }
  return { min: low, max: high };
}

const KG = formBounds("weight");
const CM = formBounds("length");
const BMI_SPEC = SITE.fields.filter((one) => one.name === "bmi")[0];

/* apps/web/fields.js's own derivation, written out here rather than
   called, so this arm does not check the spec with the code it is
   checking the spec against. */
const bmiOf = (kg, cm) => kg / ((cm / 100) * (cm / 100));

/* The lightest form-valid member at the tallest form-valid height, and
   the heaviest at the shortest - the two ends of what the form can
   produce. */
const BMI_LOW = bmiOf(KG.min, CM.max);
const BMI_HIGH = bmiOf(KG.max, CM.min);

check("derived BMI axis: the spec's range covers every BMI the form " +
  "itself will accept, so no form-valid member is drawn outside it",
  BMI_SPEC.min <= BMI_LOW && BMI_SPEC.max >= BMI_HIGH);
check("derived BMI axis: the two ends are those bounds rounded OUTWARD " +
  "onto the spec's own band grid - a whole number of bands, and no end " +
  "rounded in past a value the form allows",
  BMI_SPEC.min === Math.floor(BMI_LOW / BMI_SPEC.bin) * BMI_SPEC.bin &&
  BMI_SPEC.max === Math.ceil(BMI_HIGH / BMI_SPEC.bin) * BMI_SPEC.bin);
check("derived BMI axis: the band width keeps the grid under the " +
  "MAX_BANDS guard in server/charts-agg.js, so the derived range is a " +
  "chart the Worker will actually build rather than a spec error",
  (BMI_SPEC.max - BMI_SPEC.min) / BMI_SPEC.bin <= 200);

/*
 * The member the cap used to lose. 320 kg at 1.70 m is a BMI near 111 -
 * every part of it inside what the form accepts - and under a range that
 * stopped at 100 she was counted in the top band beside people forty
 * points lighter. Her band is now her own.
 */
const extremeRows = evenGroup(4).concat([
  row(acct(90), "2026-08-01T00:00:00.000Z",
    record(320, 170, "female", ["gainer"], "US")),
]);
const extreme = atShippedFloor(extremeRows, "measure=bmi");
const extremeBins = drawnOf(extreme).bins;
const EXTREME_BMI = bmiOf(320, 170);
const hers = extremeBins.filter((bin) =>
  bin.from.metric <= EXTREME_BMI && bin.to.metric > EXTREME_BMI);

check("derived BMI axis: a form-valid extreme member draws in the band " +
  "her own number falls in, and that band is not the last one on the axis",
  extreme.enough === true && hers.length === 1 && hers[0].count === 1 &&
  extremeBins.indexOf(hers[0]) < extremeBins.length - 1);
check("derived BMI axis: the top band counts nobody - nothing is piled " +
  "against the end of the axis by a range too short for the form",
  extremeBins.length > 0 && extremeBins[extremeBins.length - 1].count === 0);
check("derived BMI axis: the grid spans the spec's whole range at the " +
  "spec's own width, and everybody with a BMI is counted once in it",
  extremeBins.length ===
    Math.ceil((BMI_SPEC.max - BMI_SPEC.min) / BMI_SPEC.bin) &&
  extremeBins.reduce((n, b) => n + b.count, 0) === extremeRows.length);

/* ================================================================== */
/* 4. The group makeup: exact counts of unique members, zeros listed.   */
/*                                                                     */
/* Owner ruling 1 (#243): gender, affiliation and country are never    */
/* charted as bars. In their place the answer carries plain count      */
/* lines - one per category value, EXACT including small ones and      */
/* zeros. Each member counts ONCE and their most recent entry decides. */

const mixedGroup = evenGroup(9);
["JP", "FR", "DE"].forEach((code, i) => {
  mixedGroup.push(row(acct(40 + i), "2026-08-01T00:00:00.000Z",
    record(110 + i, 172, "nonbinary", ["feedee", "gainer"], code)));
});
const makeup = atShippedFloor(mixedGroup, "measure=weight");

check("group makeup: one block per categorical measure the spec " +
  "carries, in the spec's own order",
  Array.isArray(makeup.groups) &&
  makeup.groups.map((one) => one.field).join() === "gender,roles,country");
check("group makeup: a block names its field, its label and whether a " +
  "member may hold more than one value",
  makeup.groups.every((one) => typeof one.label === "string" &&
    typeof one.term === "string" && typeof one.multiple === "boolean") &&
  makeup.groups.filter((one) => one.field === "roles")[0].multiple === true);
check("group makeup: exact counts, small ones included - three people " +
  "is a line reading three, not a suppression note",
  countIn(groupBlock(makeup, "gender"), "nonbinary") === 3);
check("group makeup: every value the spec lists is a line, including " +
  "the ones nobody holds",
  JSON.stringify(groupBlock(makeup, "gender").map((c) => c.value).sort()) ===
    JSON.stringify(["female", "male", "nonbinary", "other", null].sort()) &&
  countIn(groupBlock(makeup, "gender"), "other") === 0);
check("group makeup: the named lines are ordered by how many people " +
  "hold them, the way the ruling's own example reads them out, and the " +
  "blank comes last",
  groupBlock(makeup, "gender").filter((c) => c.bucket !== "blank")
    .map((c) => c.count).every((n, i, all) => i === 0 || all[i - 1] >= n) &&
  groupBlock(makeup, "gender").length === 5 &&
  groupBlock(makeup, "gender").slice(-1)[0].bucket === "blank");
check("group makeup: the blank is its own line and is always present - " +
  "a chart without it claims a completeness the data does not have",
  groupBlock(makeup, "gender").filter((c) => c.bucket === "blank")
    .length === 1);
check("group makeup: a category counts each member ONCE, so a " +
  "single-choice block sums to the people in the view",
  groupBlock(makeup, "gender").reduce((n, c) => n + c.count, 0) ===
    mixedGroup.length);
check("group makeup: a member holding two affiliations is one member in " +
  "each of them - the lines sum to holdings and every one of them is a " +
  "count of people",
  countIn(groupBlock(makeup, "roles"), "feedee") === 3 &&
  countIn(groupBlock(makeup, "roles"), "gainer") === 3 &&
  groupBlock(makeup, "roles").reduce((n, c) => n + c.count, 0) >
    mixedGroup.length);

/* A list that lives outside the spec cannot have its zeros listed -
   there are two hundred and fifty of them and the response is not where
   a country list belongs. What the group holds is what it carries, which
   is the same disclosure a drawn cell always was. */
check("group makeup: a field whose choices live elsewhere lists what " +
  "the group holds rather than two hundred and fifty zeros",
  groupBlock(makeup, "country").length <= 5 &&
  countIn(groupBlock(makeup, "country"), "US") === 9);

check("group makeup: the block describes the FILTERED view, not the " +
  "whole binder",
  groupBlock(atShippedFloor(mixedGroup,
    "measure=weight&filter=gender&value=nonbinary"), "country")
    .filter((c) => c.value === "US").length === 0);

/* A member cannot count twice in one line by naming a value twice - the
   row-versus-person distinction arriving through a record a browser
   wrote rather than through the corpus. */
const dupeRows = [row(acct(9), "2026-08-01T00:00:00.000Z",
  record(100, 170, "male", ["feedee", "feedee", "feedee"], "US"))];
check("group makeup: a record naming one affiliation three times is one " +
  "member in that line",
  countIn(groupBlock(atShippedFloor(dupeRows, "measure=weight"), "roles"),
    "feedee") === 1);

/* A value the spec does not allow reads as unstated rather than drawn,
   which is what keeps a label in a response from ever being something a
   member's browser wrote. */
const typedRows = [row(acct(10), "2026-08-01T00:00:00.000Z",
  record(100, 170, "<script>", ["not-a-role"], "not-a-country"))];
const typed = atShippedFloor(typedRows, "measure=weight");
check("group makeup: a value the spec does not list is unstated, never " +
  "a label - nothing a member typed reaches a response",
  !everyString(typed).some((s) => /script|not-a-/.test(s)) &&
  countIn(groupBlock(typed, "gender"), null) === 1);

/* ================================================================== */
/* 5. A category is not a measure any more (ruling 1).                  */

for (const name of ["gender", "roles", "country"]) {
  const refused = askFor("measure=" + name);
  check("categories: `measure=" + name + "` is refused exactly as an " +
    "unknown measure is - one refusal, one sentence",
    refused.ok === false &&
    refused.error === askFor("measure=nonesuch").error);
}
check("categories: they are still FILTERS, which the ruling left " +
  "untouched",
  askFor("measure=weight&filter=gender&value=male").ok === true &&
  askFor("measure=weight&filter=country&value=US").ok === true);
check("categories: a numeric measure is still a measure",
  askFor("measure=weight").ok === true &&
  askFor("measure=height").ok === true && askFor("measure=bmi").ok === true);

/* ================================================================== */
/* 6. Trends: every month with an entry draws its true mean.            */

const overMonths = [];
for (let i = 0; i < 6; i += 1) {
  overMonths.push(row(acct(i), "2026-08-1" + i + "T00:00:00.000Z",
    record(100 + i, 170, "male", ["feeder"], "US")));
}
overMonths.push(row(acct(0), "2026-09-05T00:00:00.000Z",
  record(90, 170, "male", ["feeder"], "US")));
overMonths.push(row(acct(1), "2026-10-06T00:00:00.000Z",
  record(80, 170, "male", ["feeder"], "US")));

const months = atShippedFloor(overMonths, "measure=weight");
const points = pointsOf(months);

check("trend: every month with an entry draws - the two-person month " +
  "and the one-person month both",
  points.map((p) => p.period).join() === "2026-08,2026-09,2026-10");
check("trend: a one-person month carries that person's true value",
  points.length === 3 && points[2].people === 1 &&
  Math.abs(points[2].average.metric - 80) < 0.6);
check("trend: the line is the average and is called that - no " +
  "statistics vocabulary",
  points.every((p) => p.average && typeof p.average.metric === "number") &&
  !everyString(months).some((s) => /^(mean|median|stddev|sigma)$/i.test(s)));
const twiceInAMonth = pointsOf(atShippedFloor(overMonths.concat([
  row(acct(0), "2026-09-20T00:00:00.000Z",
    record(70, 170, "male", ["feeder"], "US")),
]), "measure=weight"));
check("trend: a month is one row per person, newest wins - somebody who " +
  "corrects twice in a month is one person in that month's average",
  twiceInAMonth.length === 3 && twiceInAMonth[1].people === 1 &&
  Math.abs(twiceInAMonth[1].average.metric - 70) < 0.6);
check("trend: a month nobody submitted in is absent rather than zeroed " +
  "- the page bridges it and the route says nothing it does not know",
  !points.some((p) => p.period === "2026-07"));

/* ================================================================== */
/* 7. THE MACHINERY, at floor 5. Every proof of the suppression world   */
/*    the ruling made dormant, parameterized rather than deleted.       */

const atFloor = atRaisedFloor(evenGroup(RAISED), "measure=weight");
const belowFloor = atRaisedFloor(evenGroup(RAISED - 1), "measure=weight");

check("floor 5: a view of exactly the floor's number of people draws",
  atFloor.enough === true && atFloor.distribution !== null);
check("floor 5: a view of one fewer than the floor draws nothing",
  belowFloor.enough === false && belowFloor.distribution === null &&
  belowFloor.trend === null && belowFloor.groups === null);
check("floor 5: the cut answers the honest sentence rather than an error",
  /not enough people for this view/i.test(String(belowFloor.note)));
check("floor 5: a sub-floor answer carries no count anywhere in it - " +
  "the floor is the only number in the whole document (mandate 4)",
  everyNumber(belowFloor).length === 1 &&
  everyNumber(belowFloor)[0] === RAISED);

/* Mandate 4: a filter nobody holds and a filter too few hold are one
   shape. The echoed value is the caller's own and is the one field
   allowed to differ, so it is blanked for the comparison. */
const holders = evenGroup(RAISED - 1);
const nobody = atRaisedFloor(holders,
  "measure=weight&filter=country&value=JP");
const tooFew = atRaisedFloor(holders,
  "measure=weight&filter=country&value=US");
const blanked = (answer) =>
  JSON.stringify(Object.assign({}, answer, { filter: null }));
check("floor 5: a filter value nobody holds and a filter value too few " +
  "hold answer the same document (mandate 4)",
  blanked(nobody) === blanked(tooFew) && nobody.enough === false);

/* Merging is the raised floor's answer to a thin band, and the totals
   are what make subtraction fail. */
const tailRows = evenGroup(RAISED + 2);
tailRows.push(row(acct(90), "2026-08-01T00:00:00.000Z",
  record(300, 175, "male", ["gainer"], "US")));
const tail = atRaisedFloor(tailRows, "measure=weight");
check("floor 5: every drawn band describes at least the floor's number " +
  "of people - thin bands merge into their neighbours",
  tail.enough === true &&
  drawnOf(tail).bins.every((b) => b.count >= RAISED));
check("floor 5: the drawn counts still sum to the people - a lone " +
  "outlier merges rather than being dropped, so nothing is recoverable " +
  "by subtracting the drawn bands from the total",
  drawnOf(tail).bins.reduce((n, b) => n + b.count, 0) === tailRows.length);
check("floor 5: merging widens a band rather than adding one - the " +
  "drawn edges stay contiguous and still start and end on the spec's " +
  "own outer edges",
  drawnOf(tail).bins[0].from[partitionSystem] === W_MIN &&
  drawnOf(tail).bins[drawnOf(tail).bins.length - 1]
    .to[partitionSystem] === W_MAX &&
  drawnOf(tail).bins.every((b, i, all) =>
    i === 0 || b.from[partitionSystem] === all[i - 1].to[partitionSystem]));
check("floor 5: the outlier's own band is gone - a band of one is " +
  "exactly what a raised floor exists to refuse",
  !drawnOf(tail).bins.some((b) => b.count > 0 && b.count < RAISED));

/* The wide corpus: five clusters far enough apart to draw several bands
   even once merging has run. */
const wideRows = [];
for (let i = 0; i < 30; i += 1) {
  wideRows.push(row(acct(i), "2026-08-01T00:00:00.000Z",
    record(70 + Math.floor(i / 6) * 12, 170, i % 2 ? "female" : "male",
      ["feeder"], "US")));
}
const wide = atRaisedFloor(wideRows, "measure=weight");
check("floor 5: a widely spread group still draws several bands",
  wide.enough === true && drawnOf(wide).bins.length >= 3);

/* One member submitting many times is one member, so a single person
   cannot draw a group line by submitting five times. */
const oneBusyPerson = [];
for (let i = 0; i < RAISED + 3; i += 1) {
  oneBusyPerson.push(row(acct(7), "2026-08-0" + (i + 1) + "T00:00:00.000Z",
    record(120 + i, 170, "male", ["feeder"], "US")));
}
check("floor 5: one member submitting more than the floor's number of " +
  "times is still one person and draws nothing",
  atRaisedFloor(oneBusyPerson, "measure=weight").enough === false);

/* The trend's own floor: a period fewer than the floor submitted in is
   DROPPED rather than zeroed, and leaves no residue. */
const sparseMonths = evenGroup(RAISED + 2);
sparseMonths.push(row(acct(0), "2026-09-05T00:00:00.000Z",
  record(99, 170, "male", ["feeder"], "US")));
sparseMonths.push(row(acct(1), "2026-09-06T00:00:00.000Z",
  record(98, 170, "male", ["feeder"], "US")));
const sparse = atRaisedFloor(sparseMonths, "measure=weight");
check("floor 5: a period only two people submitted in is dropped, not " +
  "zeroed - one line is one person",
  sparse.enough === true &&
  !pointsOf(sparse).some((p) => p.period === "2026-09") &&
  pointsOf(sparse).some((p) => p.period === "2026-08"));
check("floor 5: the dropped period leaves no residue - its key appears " +
  "nowhere in the answer",
  !everyString(sparse).includes("2026-09"));
check("floor 5: every drawn point describes at least the floor's number " +
  "of people",
  pointsOf(sparse).length > 0 &&
  pointsOf(sparse).every((p) => p.people >= RAISED));

/* -------------------------------------------------------------- */
/* 7b. The Other bucket, over the group-makeup block that carries  */
/* the cells a categorical MEASURE used to.                        */

const spreadRows = evenGroup(RAISED + 3);
["JP", "FR", "DE", "IT", "ES", "PT"].forEach((code, i) => {
  spreadRows.push(row(acct(40 + i), "2026-08-01T00:00:00.000Z",
    record(110 + i, 172, "female", ["feedee"], code)));
});
const byCountry = atRaisedFloor(spreadRows, "measure=weight");

check("floor 5: every count line clears the floor and the fold lands in " +
  "one bucket standing for at least the floor's number of PEOPLE",
  byCountry.enough === true &&
  groupBlock(byCountry, "country").filter((c) => c.bucket === "other")
    .length === 1 &&
  everyCellClearsTheFloor(spreadRows, "country", byCountry));
check("floor 5: on a single-choice category the drawn lines still sum " +
  "to the population, so the remainder cannot be differenced back",
  groupBlock(byCountry, "country").reduce((n, c) => n + c.count, 0) ===
    spreadRows.length);
check("floor 5: the bucket's label carries no member-typed value " +
  "(mandate 5)",
  groupBlock(byCountry, "country").filter((c) => c.bucket === "other")
    .every((c) => c.value === null &&
      !/JP|FR|DE|IT|ES|PT/.test(String(c.label))));
check("floor 5: no value the bucket swept up is named anywhere in the " +
  "answer", !everyString(byCountry.groups).some((s) =>
  /^(JP|FR|DE|IT|ES|PT)$/.test(s)));

/* When the pool cannot clear the floor there is nothing safe to say
   about that category at all, and the block for it is empty - while the
   view itself still draws, because the measure is not the category. */
const scatteredRows = [];
["JP", "FR", "DE", "IT", "ES", "PT"].forEach((code, i) => {
  scatteredRows.push(row(acct(50 + i), "2026-08-01T00:00:00.000Z",
    record(110 + i, 172, "female", ["feedee"], code)));
});
const scattered = atRaisedFloor(scatteredRows, "measure=weight");
check("floor 5: a set of singletons that cannot pool says nothing at " +
  "all about that category",
  scattered.enough === true &&
  groupBlock(scattered, "country").length === 0);

/* -------------------------------------------------------------- */
/* 7c. The floor counts PEOPLE, never value-holdings (#351, fix    */
/* wave 1, finding F1 - the finding that blocked that landing).    */
/* `roles` is `multiple: true`, so one member feeds a count into   */
/* every value they hold; a bucket that pooled the COUNTS of small */
/* cells cleared a floor of five with two people behind it, and    */
/* the cell that exists to hide those two described exactly them.  */

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
const probe = atRaisedFloor(probeRows, "measure=weight");

check("floor 5, people not holdings: the probe draws no affiliation " +
  "line at all - six holdings behind two members is not a cell (F1)",
  probe.enough === true && groupBlock(probe, "roles").length === 0);
check("floor 5, people not holdings: no affiliation those two members " +
  "hold is named anywhere in the answer (F1)",
  !everyString(probe).some((s) => /^(feedee|gainer|admirer)$/.test(s)));
check("floor 5, people not holdings: the affiliation block carries no " +
  "number of its own - no arithmetic over it recovers the two-member " +
  "set (F1)",
  everyNumber(probe.groups.filter((g) => g.field === "roles"))
    .length === 0);

/* Twelve hold feeder, two hold feeder with a pair of rare affiliations,
   five hold feedee: pooled by count the bucket reads 9, pooled by person
   it reads 5, and only the second is a number about anybody. */
const mixedRows = [];
for (let i = 0; i < 12; i += 1) mixedRows.push(rolesRow(i, ["feeder"]));
mixedRows.push(rolesRow(30, ["feeder", "gainer", "admirer"]));
mixedRows.push(rolesRow(31, ["feeder", "gainer", "admirer"]));
for (let i = 0; i < 5; i += 1) mixedRows.push(rolesRow(40 + i, ["feedee"]));
const mixed = atRaisedFloor(mixedRows, "measure=weight");
const mixedCells = groupBlock(mixed, "roles");
const mixedBehind = peopleBehind(mixedRows, "roles", mixedCells);

check("floor 5, people not holdings: every drawn line of a " +
  "multiple-choice category describes at least the floor's number of " +
  "people, the bucket included (F1)",
  mixed.enough === true &&
  everyCellClearsTheFloor(mixedRows, "roles", mixed));
check("floor 5, people not holdings: the bucket's count IS the number " +
  "of members no named line describes, never the holdings it swept up " +
  "(F1)",
  mixedCells.filter((c) => c.bucket === "other").length === 1 &&
  mixedCells.filter((c) => c.bucket === "other")
    .every((c) => c.count === mixedBehind.hidden.size));
check("floor 5, people not holdings: a member already drawn in a named " +
  "line is not counted a second time into the bucket (F1)",
  mixedBehind.hidden.size === 5 &&
  !mixedBehind.hidden.has(acct(30)) && !mixedBehind.hidden.has(acct(31)));
check("floor 5, people not holdings: no member falls out of the picture " +
  "- every one of them is described by a named line they hold or by the " +
  "bucket (F1)",
  mixedRows.every((one) =>
    one.record.roles.some((v) => mixedBehind.per.has(v)) ||
    mixedBehind.hidden.has(one.accountId)));

/* The boundary, both directions, measured in people. */
const poolRows = [];
for (let i = 0; i < 12; i += 1) poolRows.push(rolesRow(i, ["feeder"]));
[["feedee"], ["feedee"], ["gainer"], ["gainer"], ["admirer"]]
  .forEach((held, i) => poolRows.push(rolesRow(20 + i, held)));
const atPool = atRaisedFloor(poolRows, "measure=weight");
const belowPool = atRaisedFloor(poolRows.slice(0, poolRows.length - 1),
  "measure=weight");

check("floor 5, people not holdings: a bucket standing for exactly the " +
  "floor's number of people draws (F1)",
  groupBlock(atPool, "roles").some((c) => c.bucket === "other" &&
    c.count === RAISED));
check("floor 5, people not holdings: one person fewer behind it and the " +
  "absorb cascade leaves nothing drawable about that category (F1)",
  belowPool.enough === true && groupBlock(belowPool, "roles").length === 0);

/* -------------------------------------------------------------- */
/* 7d. The bucket's label describes what the bucket actually holds  */
/* (0.9-M2-S7, #362, raised by 0.9-M2-S3's review of record as F8). */
/* The parenthetical is a claim about the values folded in: each is */
/* held by fewer than the floor's number of people. Pooling alone   */
/* cannot break it. The ABSORB CASCADE can: it takes the smallest   */
/* NAMED cell, which had cleared the floor.                        */

const absorbedRows = [];
for (let i = 0; i < 12; i += 1) absorbedRows.push(rolesRow(i, ["feeder"]));
for (let i = 0; i < 8; i += 1) absorbedRows.push(rolesRow(20 + i, ["feedee"]));
for (let i = 0; i < 2; i += 1) {
  absorbedRows.push(rolesRow(40 + i, ["feeder", "gainer"]));
}
const absorbed = atRaisedFloor(absorbedRows, "measure=weight");
const absorbedCells = groupBlock(absorbed, "roles");
const absorbedOther = absorbedCells.filter((c) => c.bucket === "other");

check("floor 5, the label: the reviewer's corpus draws what the review " +
  "reported - one named line of fourteen beside a bucket of eight (F8)",
  absorbed.enough === true && absorbedOther.length === 1 &&
  absorbedOther[0].count === 8 &&
  absorbedCells.some((c) => c.value === "feeder" && c.count === 14));
check("floor 5, the label: a bucket the cascade fed a named cell no " +
  "longer claims every value in it is sub-floor - the parenthetical is " +
  "gone, and with it the only number the label ever carried (F8)",
  absorbedOther.length === 1 &&
  !/fewer/i.test(String(absorbedOther[0].label)) &&
  !/\d/.test(String(absorbedOther[0].label)));
check("floor 5, the label: the bucket is still named, and named what " +
  "DESIGN.md, \"Charts\", calls it (F8)",
  absorbedOther.length === 1 && absorbedOther[0].label === "Other");
check("floor 5, the label: it discloses neither which named cell was " +
  "absorbed nor how many were - no folded value is named anywhere in " +
  "the block and the bucket carries no count of its own contents (F8)",
  absorbedOther.length === 1 &&
  !everyString(absorbed.groups).some((s) => /feedee|gainer/i.test(s)) &&
  everyNumber(absorbedOther[0]).length === 1 &&
  everyNumber(absorbedOther[0])[0] === absorbedOther[0].count);
check("floor 5, the label: a bucket holding only sub-floor remainders " +
  "keeps the parenthetical, which is true of it (F8)",
  groupBlock(atPool, "roles").filter((c) => c.bucket === "other")
    .every((c) => c.label === "Other (fewer than " + RAISED + ")"));
check("floor 5, the label: naming the bucket honestly moved no cell - " +
  "every drawn line still describes at least the floor's number of " +
  "people, and the bucket still counts the members no named line " +
  "describes (F8)",
  absorbedOther.length === 1 &&
  everyCellClearsTheFloor(absorbedRows, "roles", absorbed) &&
  absorbedOther[0].count ===
    peopleBehind(absorbedRows, "roles", absorbedCells).hidden.size);

/* ================================================================== */
/* 8. The measure list derives from the spec (DESIGN.md, "Charts").     */

const forked = JSON.parse(JSON.stringify(SITE));
forked.fields.push({
  name: "meals", kind: "count", label: "Meals", term: "meals",
  bin: 2, min: 0, max: 10, chart: true,
});
const forkRows = [row(acct(1), "2026-08-01T00:00:00.000Z",
  Object.assign(record(100, 170, "male", ["feeder"], "US"), { meals: 5 }))];
const forkAnswer = atShippedFloor(forkRows, "measure=meals", forked);

check("derived: a fork adding a numeric field to its spec gets that " +
  "measure with no chart code written",
  askFor("measure=meals", forked).ok === true &&
  askFor("measure=meals").ok === false);
check("derived: the fork's field draws on the grid its own spec asked " +
  "for - five bands of two between nought and ten",
  forkAnswer.enough === true &&
  drawnOf(forkAnswer).bins.length === 5 &&
  drawnOf(forkAnswer).bins[2].count === 1);
check("derived: a field the spec does not chart is not a measure",
  askFor("measure=over18").ok === false &&
  askFor("measure=nonesuch").ok === false);

/* A numeric field the spec charts but gives no range is a spec that
   cannot be drawn, and it says so loudly rather than inventing a grid
   from the data - the same direction apps/web/fields.js refuses an
   unknown derivation. */
const rangeless = JSON.parse(JSON.stringify(SITE));
rangeless.fields.push({
  name: "steps", kind: "count", label: "Steps", term: "steps",
  bin: 100, chart: true,
});
let threw = "";
try {
  atShippedFloor(forkRows, "measure=steps", rangeless);
} catch (e) {
  threw = String(e.message);
}
check("derived: a charted field the spec gives no range throws rather " +
  "than fitting a grid to whoever is in the group",
  /steps/.test(threw) && /min/.test(threw) && /max/.test(threw));

/* ================================================================== */
/* 9. The route, end to end.                                           */

const ORIGIN = "http://localhost:8124";
const STORE_SECRET = "charts arm store secret / not a real one / v1";
const EXPORT_TOKEN = "charts-arm-export-token-belonging-to-nobody";
const SEEDED = 7;

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
for (let i = 0; i < SEEDED; i += 1) {
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
  drawn.body.distribution.bins.reduce((n, b) => n + b.count, 0) === SEEDED);
check("route: the answer reports the shipped floor, which is 0",
  drawn.body.floor === SHIPPED_FLOOR);
check("route: the group makeup rides along with the drawn answer",
  countIn(bodyBlock(drawn.body, "gender"), "male") === 4);

/* Mandate 2 at the route: a floor named on the wire is refused. */
const lowered = await call("GET", "/charts-data?measure=weight&floor=1",
  { token: TOKENS[0] });
check("route: a floor named on the wire is refused (400), not honored " +
  "and not ignored (mandate 2)", lowered.status === 400);

const badMeasure = await call("GET", "/charts-data?measure=telegram",
  { token: TOKENS[0] });
check("route: a measure the spec does not chart is refused (400)",
  badMeasure.status === 400);

const categorical = await call("GET", "/charts-data?measure=gender",
  { token: TOKENS[0] });
check("route: a category asked for as a measure is refused (400) - the " +
  "count lines are in the group block, not on an axis (ruling 1)",
  categorical.status === 400);

/* Mandate 5: the filter echoes the caller's own value and enumerates
   nothing. The group here is all US, so a JP filter is a value nobody
   holds - and the answer must not say so by naming what people do hold. */
const echoed = await call("GET",
  "/charts-data?measure=weight&filter=country&value=JP",
  { token: TOKENS[0] });
check("route: the filter echoes back exactly the caller's own value " +
  "(mandate 5)",
  echoed.status === 200 && echoed.body.filter.field === "country" &&
  echoed.body.filter.value === "JP");
check("route: a filter value nobody holds answers the honest empty " +
  "document (ruling 7)",
  echoed.body.enough === false && echoed.body.distribution === null &&
  echoed.body.groups === null);
check("route: that empty answer names no value the group actually " +
  "holds (mandate 5)", !everyString(echoed.body).includes("US"));
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
   handle is looked for by VALUE as well as by field name, because a leak
   would arrive as the handle itself and not as a key called "telegram".
   The group block is where a handle would newly be able to surface, so
   this sweep matters more now than it did, not less. */
check("route: no account id, handle or row id appears anywhere in a " +
  "drawn answer - the record's envelope fields reach no response",
  !everyString(drawn.body).some((s) => /^[0-9a-f]{64}$/.test(s)) &&
  !everyString(drawn.body).some((s) =>
    /telegram|arm_handle_|submittedAt|entered/.test(s)) &&
  db._submissions.length > 0);

/* The floor-0 consequence at the route, in the owner's own terms: a
   member alone in the binder sees the group of one, and it is theirs. */
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
  body: JSON.stringify({ record: JSON.stringify(record(88, 168, "female")) }),
}), loneEnv);
const lonely = await loneCall("/charts-data?measure=weight&self=1");
check("route: a member alone in the binder draws the group of one - " +
  "the ruled consequence, accepted in the owner's own words (ruling 3)",
  lonely.status === 200 && lonely.body.enough === true &&
  lonely.body.distribution.bins.reduce((n, b) => n + b.count, 0) === 1 &&
  countIn(bodyBlock(lonely.body, "gender"), "female") === 1);
check("route: their own line is still their own field, unfloored and " +
  "unmerged (mandate 3)", Boolean(lonely.body.self) &&
  lonely.body.self.points.length === 1);

/* A correction is a second row for one person, and the corrected row is
   a tombstone the read excludes - so the superseded entry defers to its
   superseder in the group makeup as well as in the counts. */
const corrected = db._submissions.find((r) => r.account_id === acct(0));
await call("POST", "/submit", {
  token: TOKENS[0],
  body: { record: JSON.stringify(
    record(140, 170, "nonbinary", ["feeder"], "US")),
  supersedes: corrected.id },
});
const afterCorrection = await call("GET", "/charts-data?measure=weight",
  { token: TOKENS[0] });
const afterGender = bodyBlock(afterCorrection.body, "gender");
check("correction: a member who corrects a row is still one person in " +
  "the group - the tombstone is excluded by the read, not counted",
  afterCorrection.status === 200 && afterCorrection.body.enough === true &&
  drawnOf(afterCorrection.body).bins
    .reduce((n, b) => n + b.count, 0) === SEEDED);
check("correction: their superseded entry defers to its superseder in " +
  "the group makeup - the most recent current entry decides",
  countIn(afterGender, "male") === 3 &&
  countIn(afterGender, "nonbinary") === 1);

/* A tombstone in a PAST period is where excluding it can be seen at all.
   Inside one period, latest-per-account already picks the correction, so
   the read's own NOT EXISTS predicate changes nothing an arm could
   notice. Across periods it is a whole point: with the tombstones
   counted, a month every member has since corrected still draws a line
   from the values they retracted. */
const histDb = makeDb();
const histEnv = Object.assign({}, env, { DB: histDb });
const HIST_TOKENS = [];
for (let i = 0; i < SEEDED; i += 1) {
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
  !pointsOf(history.body).some((p) => p.period === "2026-05"));
check("tombstones: the correction's own month is the one that draws",
  history.body.enough === true && pointsOf(history.body).length === 1);

/* ------------------------------------------------------------------ */
const EXPECTED = 141;
console.log(failures
  ? `\ncharts-aggregate FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\ncharts-aggregate ran ${performed} checks, expected ${EXPECTED}`
    : `\ncharts-aggregate OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
