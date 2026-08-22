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
 *      bucket, person-pooling and band merging all still exist and still
 *      obey whatever floor the setting holds. Every proof of them
 *      survives here, parameterized on the raised floor rather than
 *      deleted, because the way back is a number and a number nobody
 *      proves is not a way back. The one-partition arms in section 3b
 *      belong to BOTH worlds now and the split runs through them: at the
 *      shipped floor of 0 both unit systems are served, each on its own
 *      nice grid, and there is nothing to difference back to because
 *      every band already draws its true count; at a raised floor the
 *      route serves ONE locked system whatever the caller asks for, so
 *      a second slicing of the same people does not exist to be
 *      overlaid (owner ruling, the 2026-08-21 axis sitting, #396).
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
 *   6. One partition per floor-protected view. Bands are binned in the
 *      unit the caller is LOOKING AT, on that unit's own nice grid; a
 *      raised floor LOCKS the answer to one system, so no group is ever
 *      sliced two ways while suppression is doing work. No data-derived
 *      edge anywhere; no-store.
 *
 * COMBINED FILTERS (section 10, 0.9-M3-S24, #438) are the chips the
 * owner ruled at #384, and they add no seventh mandate. They are armed
 * as the same six over fewer people: the population is an intersection,
 * mandate 5's echo becomes a list of the caller's own predicates and
 * still enumerates nothing, and mandate 4's one-shape rule does the work
 * it was written for - above a floor of 0, a combination matching ONE
 * member and a combination matching nobody come back as the same
 * document, so the response cannot say which value made the view narrow.
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

/*
 * apps/web/charts.js's own Pure half, loaded here too (0.9-M2-S16 fix
 * wave 1, F3) - not to re-test the page (tests/charts-page.test.mjs
 * does that), but because the raised-floor/trim interaction is a claim
 * about TWO files agreeing, and a claim about two files is not proven
 * by exercising either one alone. charts.js publishes BinderCharts
 * before its own `typeof document === "undefined"` guard (its own
 * header explains the split), so loading it under Node with no
 * document is exactly what tests/charts-page.test.mjs already does.
 */
await import(pathToFileURL(ROOT + "apps/web/charts.js").href);
const Charts = globalThis.BinderCharts;

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

/*
 * The spec's own grid for one unit system, computed here from the config
 * rather than from the answer - the whole claim of a fixed band is that
 * it does not come from the data, and an arm that read the edges off the
 * answer could not tell.
 *
 * THE SNAP IS PART OF THE SPEC (owner ruling 3, the 2026-08-21 axis
 * sitting, #396): a band edge is a multiple of the band's own width
 * measured from the unit's own anchor, and the outer bounds are rounded
 * OUTWARD onto that same grid.
 *
 * AND THE BOUNDS ARE THE UNION OF EVERY SYSTEM'S, CONVERTED (fix wave 1,
 * O2). "Outward so no value the form accepts is left off the axis" is a
 * claim about the FORM, and the form accepts a value typed in any unit
 * it offers: somebody typing 3 ft is 91.44 cm, below the 100 cm the
 * metric row declares, and an axis built from the metric row alone
 * clamps him into a band that is not his. So each system's declared
 * bounds are converted into the axis unit and the widest pair wins,
 * before the snap runs. These helpers are the arm's own copy of that
 * arithmetic, written out here rather than imported, so this file does
 * not check the grid with the code that builds it.
 */
const SITE = globalThis.BINDER_SITE;
const chartUnitName = (kindName, system) =>
  SITE.units.kinds[kindName].chart[system];
const chartUnit = (kindName, system) =>
  SITE.units.kinds[kindName].units[chartUnitName(kindName, system)];
const snapDown = (value, width, anchor) =>
  anchor + Math.floor((value - anchor) / width) * width;
const snapUp = (value, width, anchor) =>
  anchor + Math.ceil((value - anchor) / width) * width;

/* Every bound the form declares for one kind, in one of its units. The
   ratio is the spec's own two `per` numbers divided, which is the one
   conversion this project has - written out here rather than called, so
   the arm does not convert with the code it is checking. */
function formBoundsIn(kindName, unitName) {
  const table = SITE.units.kinds[kindName].units;
  const target = table[unitName];
  let low = null;
  let high = null;
  for (const name of Object.keys(table)) {
    const entry = table[name];
    if (typeof entry.min !== "number" || typeof entry.max !== "number") {
      continue;
    }
    const rate = entry.per / target.per;
    const a = entry.min * rate;
    const b = entry.max * rate;
    if (low === null || a < low) low = a;
    if (high === null || b > high) high = b;
  }
  return { min: low, max: high };
}

function gridIn(kindName, system) {
  const unit = chartUnit(kindName, system);
  const form = formBoundsIn(kindName, chartUnitName(kindName, system));
  const min = snapDown(form.min, unit.bin, unit.anchor);
  const max = snapUp(form.max, unit.bin, unit.anchor);
  return { unit: unit, form: form, min: min, max: max,
    bands: Math.round((max - min) / unit.bin) };
}

/* The grid every SHIPPED-floor answer about weight is drawn on, in the
   system the spec starts in. */
const W = gridIn("weight", SITE.units.default);
const WEIGHT_UNIT = W.unit;
const W_BIN = WEIGHT_UNIT.bin;
const W_ANCHOR = WEIGHT_UNIT.anchor;
const W_MIN = W.min;
const W_MAX = W.max;
const W_BANDS = W.bands;

/*
 * The grid a RAISED-floor answer is drawn on. The floor LOCKS the whole
 * answer to a single unit system (owner ruling, the 2026-08-21 axis
 * sitting's escalation, #396), and an unset lock is the spec's OWN
 * DECLARED DEFAULT - `units.default`, the field that already governs
 * what the form and the charts start in (fix wave 1, F1). Reading a
 * different field here would mean raising the floor silently moved every
 * member to a system nobody chose.
 *
 * These constants are computed from `units.default` and the ones above
 * from the same field, so today they agree - which is the point of
 * writing them separately rather than aliasing: they are two reads of
 * the spec that a fork can make differ, and an implementation reading
 * the wrong field reddens against whichever one it got wrong.
 */
const L = gridIn("weight", SITE.units.default);
const L_MIN = L.min;
const L_MAX = L.max;

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
   and the wire cannot name it. `units` left this list at #396 - it is a
   parameter of the view now (section 3b) - so the arms that keep it
   honest are its own allowlist checks below, not this one. */
for (const attempt of ["floor", "min_cell", "minCell", "identify",
  "system", "basis", "settings"]) {
  const refused = askFor("measure=weight&" + attempt + "=1");
  check("no floor input: an unknown query parameter (" + attempt + ") is " +
    "refused rather than ignored", refused.ok === false);
}

/*
 * THE UNIT PARAMETER IS CLOSED, exactly as every other one is (owner
 * ruling 4, #396). It names one of the spec's own two systems or it is
 * left off; anything else is a refusal a caller can see, so a typo can
 * never quietly fall back to a partition the caller did not ask for.
 * Refusing here discloses only what the fork's own config file already
 * says, which is the same standard every refusal in askFor() meets.
 */
for (const system of SITE.units.systems) {
  check("units: `units=" + system + "` is a question this view answers",
    askFor("measure=weight&units=" + system).ok === true);
}
for (const junk of ["Imperial", "metrics", "", "1", "kg"]) {
  check("units: `units=" + JSON.stringify(junk) + "` is refused rather " +
    "than falling back to a partition nobody asked for",
    askFor("measure=weight&units=" + junk).ok === false);
}
check("units: left off, the ask reads the spec's own default system - " +
  "the one the form and the charts start in",
  ask("measure=weight").system === SITE.units.default);

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
check("floor 0: their month draws with its true average over one person, " +
  "in the unit this answer is expressed in and no other (#396)",
  pointsOf(solo).length === 1 &&
  pointsOf(solo)[0].people === 1 &&
  typeof pointsOf(solo)[0].average === "number" &&
  Math.abs(pointsOf(solo)[0].average - lbOf(100)) < 0.6);
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
    JSON.stringify(Object.assign({}, emptyView, { filters: [] })));

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
/* 3. Fixed bands on a NICE grid, in the unit the answer is read in.    */
/*                                                                     */
/* Owner ruling 5 (#243): "Edges come from the field spec and never    */
/* move or merge." This kills the open outer edge that #351's fix wave */
/* 1 introduced as finding F2 - an outer edge derived from the         */
/* heaviest member reported her band, so it was reported as open       */
/* instead. A spec edge derives from nobody, so there is nothing left  */
/* to open: comparability is what the owner chose, and it is only      */
/* comparable if two groups get the same axis.                         */
/*                                                                     */
/* Owner ruling 3 (#396, the 2026-08-21 axis sitting) ADDS the shape   */
/* of that grid: a band is a NICE width in the unit viewed, its edges  */
/* are multiples of that width from the unit's own anchor, and the     */
/* spec's outer bounds snap OUTWARD onto the same grid. That is what   */
/* lets the page put round numbers on the axis without inventing one:  */
/* every tick it paints is an edge this file emitted.                  */

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

const lightBins = drawnOf(light).bins;
check("fixed bands: an edge is ONE number, in the unit this answer is " +
  "expressed in - not a table keyed by unit system (#396 ruling 4: one " +
  "answer, one system)",
  lightBins.every((b) => typeof b.from === "number" &&
    typeof b.to === "number"));
check("fixed bands: the first edge is the spec's own minimum snapped " +
  "onto the grid and the last is the spec's own maximum snapped onto " +
  "it - the outer edges are configuration",
  lightBins[0].from === W_MIN &&
  lightBins[lightBins.length - 1].to === W_MAX);
check("fixed bands: the snap runs OUTWARD, so the drawn axis covers " +
  "every value the FORM admits in any unit it offers and clips nobody " +
  "(#396 ruling 3, widened to the union at fix wave 1, O2)",
  W_MIN <= W.form.min && W_MAX >= W.form.max &&
  W_MIN > W.form.min - W_BIN && W_MAX < W.form.max + W_BIN);
check("fixed bands: the axis covers the bounds of EVERY system, not " +
  "just the one it is drawn in - a member typing the other system's " +
  "extreme is inside the axis rather than clamped into an end band",
  SITE.units.systems.every((system) => {
    const other = chartUnit("weight", system);
    if (typeof other.min !== "number") return true;
    const rate = other.per / WEIGHT_UNIT.per;
    return W_MIN <= other.min * rate + 1e-9 &&
      W_MAX >= other.max * rate - 1e-9;
  }));
check("fixed bands: EVERY edge is a whole number of band widths from " +
  "the unit's own anchor - the property that makes a round-number axis " +
  "possible at all (#396 ruling 3)",
  lightBins.every((b) =>
    Math.abs((b.from - W_ANCHOR) / W_BIN -
      Math.round((b.from - W_ANCHOR) / W_BIN)) < 1e-9 &&
    Math.abs((b.to - W_ANCHOR) / W_BIN -
      Math.round((b.to - W_ANCHOR) / W_BIN)) < 1e-9));
check("fixed bands: the grid spans the spec's whole snapped range at " +
  "the spec's own width", lightBins.length === W_BANDS);
check("fixed bands: no band is wider than the spec's band width - " +
  "nothing merges at floor 0 (ruling 5)",
  lightBins.every((b) => b.to - b.from <= W_BIN + 1e-9));
check("fixed bands: the edges are contiguous, so no member falls " +
  "between two bands",
  lightBins.every((b, i, all) => i === 0 || b.from === all[i - 1].to));
check("fixed bands: the drawn counts sum to the people with a value",
  lightBins.reduce((n, b) => n + b.count, 0) === lightCrowd.length);

/*
 * THE OWNER'S OWN DEFECT SCENARIO, IN NUMBERS (#396's opening): a lone
 * member near 500 lb. On the retired 44-anchored, 20-wide imperial grid
 * she landed in 504-524 and the page captioned that band "514"; on the
 * nice grid her band is 500-525, and both of its edges are numbers the
 * axis really prints. The arm asks for the band by its edges rather than
 * by an index, so a grid that moved for any other reason reddens here.
 */
const loneHeavy = evenGroup(3).concat([
  row(acct(70), "2026-08-01T00:00:00.000Z",
    record(505 * 0.45359237, 175, "female", ["gainer"], "US")),
]);
const lone = atShippedFloor(loneHeavy, "measure=weight");
const loneBand = drawnOf(lone).bins
  .filter((b) => b.count === 1 && b.from >= 400)[0];
check("#396's own defect scenario: a lone member near 500 lb draws in " +
  "a band whose edges are round numbers a reader can name - 500 to 525, " +
  "never 504 to 524",
  lone.enough === true && loneBand !== undefined &&
  loneBand.from === 500 && loneBand.to === 525);

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
   height is charted in inches and the spec bounds FEET and CENTIMETERS,
   neither of which is that unit. The grid still comes from the spec -
   every bounded unit of the kind converted through the spec's own
   ratios, the widest pair taken, then snapped onto the inch grid, never
   guessed. */
const HEIGHT_IMPERIAL = gridIn("length", "imperial");
const heights = atShippedFloor(evenGroup(6), "measure=height&units=imperial");
const heightBins = drawnOf(heights).bins;
check("fixed bands: a chart unit the spec gives no bound of its own is " +
  "drawn between every OTHER unit's bounds, converted - imperial height " +
  "is binned in inches over the union of the spec's feet and its " +
  "centimeters",
  heights.enough === true &&
  heightBins[0].from === HEIGHT_IMPERIAL.min &&
  heightBins[heightBins.length - 1].to === HEIGHT_IMPERIAL.max &&
  heightBins.length === HEIGHT_IMPERIAL.bands);

/*
 * O2's OWN MEMBER, and the reason the union is not a tidiness rule. The
 * form accepts 3 ft, which is 91.44 cm - below the 100 cm the metric row
 * declares. On an axis built from the metric row alone he is clamped
 * into the 100-105 band, which is not his: a shortest-possible member
 * reported as somebody else's height. The arm asks for the band that
 * CONTAINS his number rather than for an index, so a clamped answer has
 * no band to find.
 */
const THREE_FEET_CM = 3 * SITE.units.kinds.length.units.ft.per;
const shortRows = evenGroup(4).concat([
  row(acct(60), "2026-08-01T00:00:00.000Z",
    record(70, THREE_FEET_CM, "male", ["feeder"], "US")),
]);
const shortMetric = atShippedFloor(shortRows, "measure=height&units=metric");
const hisBand = drawnOf(shortMetric).bins.filter((b) =>
  b.from <= THREE_FEET_CM && b.to > THREE_FEET_CM)[0];
check("O2: the shortest member the form accepts draws in the band his " +
  "own number falls in on the METRIC axis - not clamped into a band " +
  "that reports a height he does not have",
  shortMetric.enough === true && hisBand !== undefined &&
  hisBand.count === 1 && hisBand.from === 90 && hisBand.to === 95);
check("O2: and the metric height axis therefore starts below three " +
  "feet, snapped outward onto its own 5 cm grid",
  drawnOf(shortMetric).bins[0].from <= THREE_FEET_CM &&
  drawnOf(shortMetric).bins[0].from === gridIn("length", "metric").min);

/*
 * EVERY CHARTED MEASURE, IN EVERY SYSTEM THE SPEC OFFERS, ON ITS OWN
 * UNIT'S GRID. The three arms above prove the property on weight; this
 * sweep proves it is the RULE rather than one measure's luck, reading
 * each unit's own width and anchor out of the spec and holding the real
 * answer to them. A fork that adds a unit gets swept for free.
 */
function gridSpecOf(measureName, system) {
  const field = SITE.fields.filter((one) => one.name === measureName)[0];
  const kind = SITE.units.kinds[field.kind];
  if (!kind) return { bin: field.bin, anchor: field.anchor };
  const unit = kind.units[kind.chart[system]];
  return { bin: unit.bin, anchor: unit.anchor };
}

const sweepRows = evenGroup(9);
for (const measureName of ["weight", "height", "bmi"]) {
  for (const system of SITE.units.systems) {
    const answer = atShippedFloor(sweepRows,
      "measure=" + measureName + "&units=" + system);
    const grid = gridSpecOf(measureName, system);
    const bins = drawnOf(answer).bins;
    check("nice grid: " + measureName + " in " + system + " - every " +
      "edge is a multiple of the " + grid.bin + "-wide band from the " +
      "anchor the spec writes, and the bands are contiguous and whole",
      answer.enough === true && bins.length > 0 &&
      bins.every((b) => Math.abs((b.from - grid.anchor) / grid.bin -
        Math.round((b.from - grid.anchor) / grid.bin)) < 1e-9) &&
      bins.every((b) => Math.abs(b.to - b.from - grid.bin) < 1e-9) &&
      bins.every((b, i, all) => i === 0 || b.from === all[i - 1].to));
  }
}

/* ================================================================== */
/* 3b. One partition per floor-protected view (mandate 6).             */
/*                                                                     */
/* Owner ruling 4 (#396) and the ruling that followed the escalation   */
/* on it (2026-08-21, carried by Prime): bands are binned in the unit  */
/* the member is LOOKING AT, unconditionally - and a RAISED FLOOR      */
/* LOCKS the whole answer to one unit system, so a group is never      */
/* sliced two ways while suppression is doing work. The protection the */
/* retired "one partition, not two" rule bought survives structurally: */
/* with one slicing in existence there is no second grid to overlay.   */

const bothSystems = {};
for (const system of SITE.units.systems) {
  bothSystems[system] = atShippedFloor(lightCrowd, "measure=weight&units=" +
    system);
}

check("floor 0: both unit systems are served, each one drawing and " +
  "naming itself as the partition it was binned in",
  SITE.units.systems.every((system) =>
    bothSystems[system].enough === true &&
    drawnOf(bothSystems[system]).partition.system === system &&
    bothSystems[system].units.system === system));
check("floor 0: the answer names ONE unit for its axis - the unit that " +
  "system charts in, and no table of the others",
  SITE.units.systems.every((system) =>
    bothSystems[system].units.unit ===
      SITE.units.kinds.weight.chart[system]));
check("floor 0: the two systems really are binned INDEPENDENTLY - the " +
  "grids differ in count and in edges, which is what makes each axis " +
  "round in its own unit rather than a conversion of the other's",
  drawnOf(bothSystems.metric).bins.length !==
    drawnOf(bothSystems.imperial).bins.length);
check("floor 0: independently binned or not, both answers describe the " +
  "same people - the counts sum to the same group",
  SITE.units.systems.every((system) =>
    drawnOf(bothSystems[system]).bins.reduce((n, b) => n + b.count, 0) ===
      lightCrowd.length));

/*
 * THE OVERLAY ATTACK, BUILT AS AN INSTRUMENT rather than described.
 *
 * Two grids over one group are two readings of one cumulative count. Put
 * their edges on a common axis and every gap between consecutive edges
 * gives up the number of people between them - which can be finer than
 * either grid's own bands, and that is exactly the differencing the
 * one-partition rule was written against (2899 of 3000 random groups,
 * when the floor was five).
 *
 * `knownCumulative` reads one answer as the step function it is: at each
 * band edge, how many people the answer says are below it. Every number
 * in it is the answer's own; nothing here reads the corpus.
 */
const kgPer = (unit) => SITE.units.kinds.weight.units[unit].per;

function knownCumulative(answer) {
  const per = kgPer(answer.units.unit);
  const bins = drawnOf(answer).bins;
  const points = [{ x: bins[0].from * per, cum: 0 }];
  let running = 0;
  for (const bin of bins) {
    running += bin.count;
    points.push({ x: bin.to * per, cum: running });
  }
  return points;
}

/* Every count an overlay of two answers hands back: sort both step
   functions onto one axis and difference each consecutive pair. A count
   below the floor here is a cell the floor was supposed to have hidden,
   recovered from two documents neither of which drew it. */
function recoveredCounts(a, b) {
  const points = a.concat(b).sort((p, q) => p.x - q.x);
  const out = [];
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].x - points[i - 1].x < 1e-6) continue;
    out.push(points[i].cum - points[i - 1].cum);
  }
  return out;
}

const subFloor = (counts) =>
  counts.filter((n) => n > 0 && n < RAISED).length;

/*
 * THE ATTACK, PROVEN LIVE. Two settings objects, each a legal one, each
 * locking a DIFFERENT system - which is exactly the pair of documents an
 * unlocked route would have handed one caller. The ask deliberately
 * names the opposite system in both, so this is also the proof that the
 * lock overrides the wire rather than agreeing with it by luck.
 */
const spreadOut = [];
for (let i = 0; i < 34; i += 1) {
  spreadOut.push(row(acct(i), "2026-08-01T00:00:00.000Z",
    record(70 + i * 3, 170, i % 2 ? "female" : "male", ["feeder"], "US")));
}
const asMetric = agg.aggregate(spreadOut, ask("measure=weight&units=imperial"),
  undefined, { floor: RAISED, units: "metric" });
const asImperial = agg.aggregate(spreadOut, ask("measure=weight&units=metric"),
  undefined, { floor: RAISED, units: "imperial" });

check("the lock overrides the wire: an answer computed under a metric " +
  "lock is metric however the caller asked, and the same for imperial",
  asMetric.enough === true && asImperial.enough === true &&
  asMetric.units.system === "metric" &&
  asImperial.units.system === "imperial");
check("the lock says so in the answer, so the page can tell a member " +
  "why the toggle will not move",
  asMetric.units.locked === true && asImperial.units.locked === true &&
  bothSystems.metric.units.locked === false);
check("every band of both raised-floor answers clears the floor on its " +
  "own - each document is individually safe, which is why the attack " +
  "needs two of them",
  drawnOf(asMetric).bins.every((b) => b.count >= RAISED) &&
  drawnOf(asImperial).bins.every((b) => b.count >= RAISED));
check("THE ATTACK IS REAL: overlaying those two independently merged " +
  "grids recovers cells below the floor that neither document drew - " +
  "the differencing the one-partition rule names, reproduced rather " +
  "than asserted",
  subFloor(recoveredCounts(knownCumulative(asMetric),
    knownCumulative(asImperial))) > 0);

/*
 * THE LOCK IS WHAT MAKES THAT PAIR UNREACHABLE. Inside one deployment
 * there is one settings object, so both asks answer with the SAME
 * partition - and overlaying an answer with itself recovers exactly the
 * bands it already drew, every one of which clears the floor.
 */
const lockedAsks = SITE.units.systems.map((system) =>
  agg.aggregate(spreadOut, ask("measure=weight&units=" + system),
    undefined, raised));

check("the lock: at a raised floor both asks answer with the identical " +
  "partition - the same system, the same edges, the same counts",
  lockedAsks.every((answer) => answer.enough === true) &&
  JSON.stringify(lockedAsks[0].distribution) ===
    JSON.stringify(lockedAsks[1].distribution) &&
  lockedAsks[0].units.system === lockedAsks[1].units.system);
check("the lock: the locked system is the settings seam's, defaulting " +
  "to the spec's OWN DECLARED DEFAULT when the setting names none - the " +
  "field that already governs what the form and the charts start in, so " +
  "raising the floor moves nobody to a system they did not choose",
  lockedAsks[0].units.system === SITE.units.default);
check("the lock: overlaying the two answers a caller CAN get at a " +
  "raised floor recovers nothing below the floor - there is only one " +
  "grid, so there is nothing to difference",
  subFloor(recoveredCounts(knownCumulative(lockedAsks[0]),
    knownCumulative(lockedAsks[1]))) === 0);
check("the lock: the whole answer moves with it, not just the bands - " +
  "the trend is in the locked system too, so no figure on the page is " +
  "in a unit the rest of it is not",
  pointsOf(lockedAsks[1]).length > 0 &&
  pointsOf(lockedAsks[1]).every((p) => typeof p.average === "number") &&
  JSON.stringify(pointsOf(lockedAsks[0])) ===
    JSON.stringify(pointsOf(lockedAsks[1])));

/*
 * THE MEMBER'S OWN OVERLAY FOLLOWS THE SAME SYSTEM, and it has to: it is
 * drawn OVER the group trend on one pair of axes, so a line in a unit
 * the rest of the figure is not in would be a second measurement wearing
 * the first one's scale. selfSeries() takes no floor - their data, their
 * line - but it reads the same seam the lock lives in, which is why it
 * takes the settings object at all.
 */
const myAsk = ask("measure=weight&units=imperial&self=1");
const mineFree = agg.selfSeries(spreadOut, acct(0), myAsk);
/* Locked to the system the ask did NOT name, so the two readings of one
   member's own weight cannot coincide by luck - which they would if this
   arm leaned on the default lock, since that default IS the system the
   ask names. */
const mineLocked = agg.selfSeries(spreadOut, acct(0), myAsk, undefined,
  { floor: RAISED, units: "metric" });
check("the lock: the member's own line is in the answer's own unit - " +
  "asked in imperial, drawn in imperial at the shipped floor and in the " +
  "locked system once the floor is raised",
  mineFree.points.length === 1 && mineLocked.points.length === 1 &&
  Math.abs(mineFree.points[0].value - lbOf(70)) < 0.2 &&
  Math.abs(mineLocked.points[0].value - 70) < 0.2);

/*
 * AND THE OTHER HALF: a settings object naming a system the spec does
 * not offer is a setting that failed to apply, not a partition nobody
 * has a grid for - so it reads as the default lock exactly as a floor
 * of "5" reads as the default floor.
 */
for (const junk of ["Metric", "furlongs", "", 1, null]) {
  const answer = agg.aggregate(spreadOut, ask("measure=weight"),
    undefined, { floor: RAISED, units: junk });
  check("the lock: a settings value of " + JSON.stringify(junk) + " is " +
    "the spec's own declared default rather than an unbinnable system",
    answer.enough === true &&
    answer.units.system === SITE.units.default);
}

/*
 * THE OVERLAY DETECTOR IS NOT VACUOUS, said at the shipped floor where
 * both systems really are served: overlay them and finer counts do come
 * back. At a floor of 0 that discloses nothing new - every band already
 * draws its true count, so a reader keeping two documents learns what a
 * reader keeping one already knew - and saying that out loud is the
 * premise the lock protects the moment an admin raises the number.
 */
check("the detector bites: at the shipped floor of 0 the two served " +
  "systems really do overlay into counts finer than either grid's own " +
  "bands - which is why a raised floor locks to one of them",
  recoveredCounts(knownCumulative(bothSystems.metric),
    knownCumulative(bothSystems.imperial)).length >
    Math.max(drawnOf(bothSystems.metric).bins.length,
      drawnOf(bothSystems.imperial).bins.length));

/* ================================================================== */
/* 3c. The BMI axis is DERIVED from the form's own bounds.             */
/*                                                                     */
/* Owner ruling, #371 comment 5347769320: the range derives from the   */
/* form's bounds so that NO form-valid member draws clipped - "in a    */
/* gaining community the high end IS the story". A hand-picked cap is  */
/* exactly what this refuses: BMI has no unit table to keep bounds in, */
/* so the numbers in the spec row are the whole axis, and a cap chosen */
/* for looking reasonable silently redraws everybody past it as the    */
/* top band's neighbor. These arms compute the bounds the form really  */
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
  BMI_SPEC.min === snapDown(BMI_LOW, BMI_SPEC.bin, BMI_SPEC.anchor) &&
  BMI_SPEC.max === snapUp(BMI_HIGH, BMI_SPEC.bin, BMI_SPEC.anchor));
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
  bin.from <= EXTREME_BMI && bin.to > EXTREME_BMI);

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
    Math.round((BMI_SPEC.max - BMI_SPEC.min) / BMI_SPEC.bin) &&
  extremeBins.reduce((n, b) => n + b.count, 0) === extremeRows.length);
check("derived BMI axis: a unitless measure names no unit for its axis " +
  "- the page has nothing to print beside the number, and a BMI in " +
  "pounds is not a thing",
  extreme.units.unit === null && extreme.units.system !== null);

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

/*
 * A CATEGORICAL FIELD THIS FILE HAS NEVER HEARD OF, handed in as a spec
 * rather than written into apps/web/site.config.js.
 *
 * This is the aggregation half of what an admin gains at 0.9-M3-S11
 * (#419): the Worker composes an effective spec out of the shipped file
 * and the admin's edits and hands it here, so a field that exists only
 * in a database row still becomes a makeup block and a filter. Nothing
 * below is a new capability - every derivation already takes a spec -
 * and that is exactly the claim worth pinning, because a slice that
 * quietly started reading the global instead would still pass every
 * other arm in this file.
 */
const invented = JSON.parse(JSON.stringify(SITE));
invented.fields.push({
  name: "mood", kind: "choice", label: "Mood", term: "mood",
  blank: "Prefer not to say", chart: true,
  choices: [{ value: "great", label: "Great" },
    { value: "grim", label: "Grim" }],
});
const moodRows = [
  row(acct(90), "2026-08-01T00:00:00.000Z",
    Object.assign(record(100, 170, "male", [], "US"), { mood: "great" })),
  row(acct(91), "2026-08-01T00:00:00.000Z",
    Object.assign(record(105, 172, "male", [], "US"), { mood: "great" })),
];
const inventedAnswer = atShippedFloor(moodRows, "measure=weight", invented);

check("a categorical field only the given spec knows about becomes a " +
  "makeup block, with no code here naming it",
  groupBlock(inventedAnswer, "mood").length > 0 &&
  countIn(groupBlock(inventedAnswer, "mood"), "great") === 2 &&
  countIn(groupBlock(inventedAnswer, "mood"), "grim") === 0);

check("and the SHIPPED spec still has no such block, so the arm above " +
  "read the spec it was handed rather than a global",
  groupBlock(atShippedFloor(moodRows, "measure=weight"), "mood").length === 0);

check("a field only the given spec knows about is a filter dimension " +
  "too, and is refused under the shipped spec",
  askFor("measure=weight&filter=mood&value=great", invented).ok === true &&
  askFor("measure=weight&filter=mood&value=great").ok === false);

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

/* Asked in metric so the arms below can compare against the kilograms
   these rows were written in without a conversion of their own - the
   answer is in the unit it was asked for now (#396 ruling 4). */
const months = atShippedFloor(overMonths, "measure=weight&units=metric");
const points = pointsOf(months);

check("trend: every month with an entry draws - the two-person month " +
  "and the one-person month both",
  points.map((p) => p.period).join() === "2026-08,2026-09,2026-10");
check("trend: a one-person month carries that person's true value",
  points.length === 3 && points[2].people === 1 &&
  Math.abs(points[2].average - 80) < 0.6);
check("trend: the line is the average and is called that - no " +
  "statistics vocabulary",
  points.every((p) => typeof p.average === "number") &&
  !everyString(months).some((s) => /^(mean|median|stddev|sigma)$/i.test(s)));
const twiceInAMonth = pointsOf(atShippedFloor(overMonths.concat([
  row(acct(0), "2026-09-20T00:00:00.000Z",
    record(70, 170, "male", ["feeder"], "US")),
]), "measure=weight&units=metric"));
check("trend: a month is one row per person, newest wins - somebody who " +
  "corrects twice in a month is one person in that month's average",
  twiceInAMonth.length === 3 && twiceInAMonth[1].people === 1 &&
  Math.abs(twiceInAMonth[1].average - 70) < 0.6);
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
   shape. The echoed predicates are the caller's own and are the one
   field allowed to differ, so they are blanked for the comparison.
   Section 10d runs this same instrument over combined filters, where
   the two cases are an intersection of one and an intersection of
   nobody. */
const holders = evenGroup(RAISED - 1);
const nobody = atRaisedFloor(holders,
  "measure=weight&filter=country&value=JP");
const tooFew = atRaisedFloor(holders,
  "measure=weight&filter=country&value=US");
const blanked = (answer) =>
  JSON.stringify(Object.assign({}, answer, { filters: null }));
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
  drawnOf(tail).bins[0].from === L_MIN &&
  drawnOf(tail).bins[drawnOf(tail).bins.length - 1].to === L_MAX &&
  drawnOf(tail).bins.every((b, i, all) =>
    i === 0 || b.from === all[i - 1].to));
check("floor 5: the outlier's own band is gone - a band of one is " +
  "exactly what a raised floor exists to refuse",
  !drawnOf(tail).bins.some((b) => b.count > 0 && b.count < RAISED));

/*
 * A RAISED FLOOR MAKES THE PAGE'S OWN TRIM A NO-OP (0.9-M2-S16 fix wave
 * 1, F3, #390): suppressBins() above merges the trailing remainder
 * BACKWARDS into the last emitted band rather than dropping it, so the
 * last band in ANY answer drawn at a floor above 0 already carries the
 * floor's own count or more - never zero. Fed into apps/web/charts.js's
 * own trimTrailingEmptyBins() (imported above, not reimplemented), that
 * means there is no trailing empty band left to find: the trim returns
 * the SAME bins, unchanged, and the drawn axis still reaches the locked
 * system's own ceiling (L_MAX) exactly as it did before #390 - which is
 * how a raised floor hides whether the group's heaviest member (the
 * `tail` fixture's own 300 kg outlier, absorbed into the merged band
 * above) sits near that ceiling or far below it. This is the real
 * server output and the real page function, not a hand-shaped stand-in
 * for either.
 */
const tailBins = drawnOf(tail).bins;
const tailTrimmed = Charts.trimTrailingEmptyBins(tailBins);
check("floor 5: the trim is a no-op on a real raised-floor answer - " +
  "same length, same last band, because the last band already carries " +
  "the floor's own count",
  tailTrimmed.length === tailBins.length &&
  tailTrimmed[tailTrimmed.length - 1] === tailBins[tailBins.length - 1]);
check("floor 5: the drawn axis still reaches the spec's own ceiling " +
  "after the trim runs - a raised floor, not the trim, is what would " +
  "hide the heaviest member",
  tailTrimmed[tailTrimmed.length - 1].to === L_MAX &&
  tailTrimmed[tailTrimmed.length - 1].count > 0);

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

/* `content` is the `site_content` rows this database holds, and it
   defaults to none - which is the state every arm written before
   0.9-M3-S24 was written against, so passing nothing leaves them at the
   shipped floor of 0 exactly as before. Section 10e passes a real
   `chart.floor` row so the settings seam is driven the way a deployment
   drives it rather than by handing aggregate() an object. */
function makeDb(content) {
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
    /*
     * `site_content`, and TWO different statements read it - which is
     * the whole reason this branch discriminates rather than answering
     * both (0.9-M3-S24 hit it: a stub handing every site_content read
     * the same rows fed `chart.floor` to the field-spec reader, which
     * correctly threw on a name outside its namespace and turned every
     * arm below into a 500).
     *
     *   name LIKE ?     the effective spec's field overlay
     *                   (FIELD_ROWS_SQL), whose reader REFUSES a row
     *                   outside the `FIELD.` namespace.
     *   name IN (?, ?)  the charts settings since 0.9-M3-S8 (#414) -
     *                   the floor and the locked unit, two rows an
     *                   admin sets rather than a frozen constant.
     *
     * Modelled by the namespace rather than by which statement asked,
     * so the split here is D1's own answer and not a guess about call
     * order. A database built with no rows runs at the shipped floor of
     * 0 with the shipped spec, which is the state section 9 was written
     * against; section 10e builds one holding a real `chart.floor` row.
     */
    if (/FROM site_content/i.test(sql)) {
      const held = (content || []).map((one) => Object.assign({}, one));
      const fieldRow = (one) => one.name.toLowerCase().startsWith("field.");
      return { results: /LIKE/i.test(sql)
        ? held.filter(fieldRow)
        : held.filter((one) => !fieldRow(one)) };
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

/* Ruling 4 at the route (#396): the unit system rides the ask, so the
   figures come back on the grid the member is actually looking at. */
const inMetric = await call("GET", "/charts-data?measure=weight&units=metric",
  { token: TOKENS[0] });
const inImperial = await call("GET",
  "/charts-data?measure=weight&units=imperial", { token: TOKENS[0] });
check("route: the ask carries the unit system and the answer comes back " +
  "binned on that unit's own grid",
  inMetric.status === 200 && inImperial.status === 200 &&
  inMetric.body.units.system === "metric" &&
  inMetric.body.units.unit === "kg" &&
  inImperial.body.units.system === "imperial" &&
  inImperial.body.units.unit === "lb");
check("route: at the shipped floor the two systems are genuinely " +
  "different grids - switching units is a fresh question, never the " +
  "same numbers relabeled",
  JSON.stringify(inMetric.body.distribution.bins) !==
    JSON.stringify(inImperial.body.distribution.bins) &&
  inMetric.body.units.locked === false);
check("route: an answer names exactly one system's numbers - no band, " +
  "no trend point and no self point carries a second reading of itself",
  inMetric.body.distribution.bins.every((b) =>
    typeof b.from === "number" && typeof b.to === "number") &&
  (inMetric.body.trend.points || []).every((p) =>
    typeof p.average === "number"));

const badUnits = await call("GET", "/charts-data?measure=weight&units=stones",
  { token: TOKENS[0] });
check("route: a unit system the spec does not offer is refused (400) - " +
  "the allowlist is a repository file, so this discloses nothing about " +
  "members", badUnits.status === 400);

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
  echoed.status === 200 && echoed.body.filters.length === 1 &&
  echoed.body.filters[0].field === "country" &&
  echoed.body.filters[0].value === "JP");
check("route: a filter value nobody holds answers the honest empty " +
  "document (ruling 7)",
  echoed.body.enough === false && echoed.body.distribution === null &&
  echoed.body.groups === null);
check("route: that empty answer names no value the group actually " +
  "holds (mandate 5)", !everyString(echoed.body).includes("US"));
/* The echo's SHAPE is the enumeration guard, because the leak this
   mandate names would arrive as a helpful third field - the values on
   offer, the values in the group - rather than as a wrong value in the
   two that belong. Exactly two keys per predicate, so anything added is
   a red, and the guard is asked of EVERY entry rather than of the first
   (#438: the list is where a per-entry extra would now hide). */
check("route: the filter echo carries the caller's own field and value " +
  "and nothing beside them (mandate 5)",
  echoed.body.filters.every((one) =>
    JSON.stringify(Object.keys(one)) ===
      JSON.stringify(["field", "value"])));

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

/* ================================================================== */
/* 10. COMBINED FILTERS: one value per categorical field, ANDed.       */
/*                                                                     */
/* 0.9-M3-S24 (#438), building the chips the owner ruled at #384. The  */
/* page half is 0.9-M3-S14; what is armed here is the whole Worker     */
/* half, because combining cannot happen on the page - a page only     */
/* ever receives already-floored counts, so an AND across two chips    */
/* has to be computed inside the same intersection the floor is        */
/* applied to.                                                         */
/*                                                                     */
/* THE RULING THIS SECTION ARMS, in the owner's own words (#384 ruling  */
/* 2): "the same rule - exact at floor 0". A combined view is not a    */
/* second privacy regime, it is the same one over fewer people. So     */
/* every claim below runs in BOTH worlds, the split section 7 draws:   */
/* at the shipped floor of 0 an intersection of one draws its true     */
/* number, and above 0 it is suppressed by the machinery that already  */
/* suppresses a whole population that small.                           */

/* -------------------------------------------------------------- */
/* 10a. The ask: pairing, the refusals, and the cap.               */

const TWO_CHIPS = "measure=weight&filter=gender&value=male" +
  "&filter=roles&value=feeder";

check("combined: two fields ANDed is a question this view answers, and " +
  "the ask carries both predicates in the caller's own order",
  askFor(TWO_CHIPS).ok === true &&
  ask(TWO_CHIPS).filters.length === 2 &&
  ask(TWO_CHIPS).filters[0].field === "gender" &&
  ask(TWO_CHIPS).filters[0].value === "male" &&
  ask(TWO_CHIPS).filters[1].field === "roles" &&
  ask(TWO_CHIPS).filters[1].value === "feeder");

/* Everyone is an EMPTY SET of predicates rather than a null one, which
   is why the AND below has no special case to get wrong: matching
   nothing against a record is vacuously true, so "no chips" reaches the
   same loop every other count reaches. */
check("combined: no filter at all is Everyone - an empty list of " +
  "predicates, not a null one",
  Array.isArray(ask("measure=weight").filters) &&
  ask("measure=weight").filters.length === 0);

check("combined: one filter is still one filter",
  ask("measure=weight&filter=gender&value=male").filters.length === 1);

check("combined: three fields ANDed",
  ask("measure=weight&filter=gender&value=male&filter=roles&value=feeder" +
    "&filter=country&value=US").filters.length === 3);

/*
 * A FIELD STILL MAY NOT REPEAT, and the refusal keeps the sentence the
 * single-filter world used - now raised against the FIELD rather than
 * against the query parameter, because the parameter is allowed to
 * repeat and the dimension is not. #384 ruled one value per dimension,
 * so a second value for one field would be an OR inside an AND.
 */
const dupeField = askFor("measure=weight&filter=gender&value=male" +
  "&filter=gender&value=female");
check("combined: two values for ONE field are refused, in the words the " +
  "single-filter world used, naming the field",
  dupeField.ok === false &&
  dupeField.error === '"gender" is given more than once.');

/* The other three parameters each decide one thing about the WHOLE
   answer, so a second copy is a caller contradicting themselves and
   honoring either would be this route guessing which they meant. Their
   given-twice refusal is unchanged, and that is what makes the two
   above a deliberate exemption rather than a loosened rule. */
check("combined: `measure` still refuses a second copy",
  askFor("measure=weight&measure=height").ok === false);
check("combined: `self` still refuses a second copy",
  askFor("measure=weight&self=1&self=1").ok === false);
check("combined: `units` still refuses a second copy",
  askFor("measure=weight&units=metric&units=imperial").ok === false);

/* The pairing is POSITIONAL, so an unpaired name on either side is the
   same two faults the single-filter world named, in the same words. */
check("combined: a filter with no value of its own is refused in the " +
  "sentence the single-filter world used",
  askFor("measure=weight&filter=gender&value=male&filter=roles").error ===
    "That filter needs a value.");
check("combined: a value with no filter of its own is refused in the " +
  "sentence the single-filter world used",
  askFor("measure=weight&filter=gender&value=male&value=feeder").error ===
    "A value needs a filter to belong to.");

/* One bad predicate refuses the WHOLE ask. Answering the good half
   would describe a population the caller never asked about, and they
   would have no way to tell that from the one they did. */
check("combined: one field the form does not offer, among good ones, " +
  "refuses the whole ask",
  askFor("measure=weight&filter=gender&value=male&filter=nope&value=x")
    .error === "That is not a filter this form offers.");
check("combined: one value outside the allowlist, among good ones, " +
  "refuses the whole ask",
  askFor("measure=weight&filter=gender&value=male&filter=country&value=zz")
    .error === "That is not a value of that filter.");
check("combined: a measured field is not a filter dimension, however " +
  "many chips are set",
  askFor("measure=height&filter=gender&value=male&filter=weight&value=100")
    .error === "That is not a filter this form offers.");

/*
 * A RETIRED VALUE IS NOT A VALUE OF THAT FILTER (#385 rule 7).
 *
 * The composition that drops one is server/worker.js's offeredValues(),
 * and the whole-field version of it is armed end to end in
 * tests/fields-overlay.test.mjs. What is armed HERE is this file's own
 * half: an effective spec whose choice list no longer carries a value
 * refuses a filter on it - in the SAME sentence a value that never
 * existed gets. Same sentence is the disclosure claim, not a tidiness
 * one: a caller must not be able to tell a value an admin retired from
 * one nobody ever offered, or the refusal would report the group's own
 * history.
 */
const retiredSpec = JSON.parse(JSON.stringify(invented));
retiredSpec.fields.filter((one) => one.name === "mood")[0].choices =
  [{ value: "great", label: "Great" }];
check("combined: a value the effective spec no longer offers is refused, " +
  "in the same words a value that never existed gets",
  askFor("measure=weight&filter=mood&value=grim", retiredSpec).ok === false &&
  askFor("measure=weight&filter=mood&value=grim", retiredSpec).error ===
    askFor("measure=weight&filter=mood&value=never-was", retiredSpec).error);
check("combined: the value that spec still offers is still a filter, so " +
  "the refusal above is about the retirement and not about the field",
  askFor("measure=weight&filter=mood&value=great", retiredSpec).ok === true);
check("combined: a retired value beside a live predicate refuses the " +
  "whole ask - a chip set cannot be half-honored",
  askFor("measure=weight&filter=gender&value=male&filter=mood&value=grim",
    retiredSpec).ok === false);

/*
 * THE CAP. A bound on the REQUEST, and the arm reads the shipped number
 * rather than carrying a copy of it.
 */
const capFields = JSON.parse(JSON.stringify(SITE));
for (const name of ["mood", "shift", "hue"]) {
  capFields.fields.push({
    name: name, kind: "choice", label: name, term: name, chart: true,
    choices: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
  });
}
const CAP_PAIRS = [["gender", "male"], ["roles", "feeder"],
  ["country", "US"], ["mood", "a"], ["shift", "a"], ["hue", "a"]];
const capQuery = (n) => "measure=weight" + CAP_PAIRS.slice(0, n)
  .map((pair) => "&filter=" + pair[0] + "&value=" + pair[1]).join("");

check("combined: the cap is a shipped constant this arm reads rather " +
  "than a number copied into it",
  typeof agg.MAX_FILTERS === "number" && Number.isInteger(agg.MAX_FILTERS) &&
  agg.MAX_FILTERS > 0);
check("combined: the cap covers every categorical field the shipped " +
  "form has, so nothing the shipped chips can build is out of reach",
  agg.MAX_FILTERS >= SITE.fields
    .filter((one) => one.kind === "choice" && one.chart === true).length);
check("combined: a request carrying exactly the cap's number of filters " +
  "is answered",
  askFor(capQuery(agg.MAX_FILTERS), capFields).ok === true);
const overCap = askFor(capQuery(agg.MAX_FILTERS + 1), capFields);
check("combined: one filter past the cap is refused, with a reason that " +
  "names the number - the bound is on the request, so a form an admin " +
  "grows does not grow it",
  overCap.ok === false &&
  overCap.error.indexOf(String(agg.MAX_FILTERS)) !== -1);
/* The count is checked BEFORE any field name is resolved, so an
   over-cap request costs one comparison whatever it names - and a
   caller cannot use the ordering to learn which of their invented
   fields the form happens to have. */
check("combined: past the cap is refused on the count alone, before any " +
  "field is looked up - the same refusal under the shipped spec, which " +
  "has three of those six fields and not the other three",
  askFor(capQuery(agg.MAX_FILTERS + 1)).error === overCap.error);

/* -------------------------------------------------------------- */
/* 10b. The AND itself, and the echo.                              */

/*
 * Five members chosen so the AND and the OR are different numbers.
 * Three are male, three are feeders, and TWO are both - so an
 * intersection of two is a positive proof of AND, where a union would
 * draw four and either predicate alone draws three.
 */
const COMBO_AT = "2026-08-01T00:00:00.000Z";
const CROWD = [
  row(acct(60), COMBO_AT, record(100, 170, "male", ["feeder"], "US")),
  row(acct(61), COMBO_AT, record(102, 171, "male", ["feeder"], "JP")),
  row(acct(62), COMBO_AT, record(104, 172, "male", ["feedee"], "US")),
  row(acct(63), COMBO_AT, record(106, 173, "female", ["feeder"], "US")),
  row(acct(64), COMBO_AT, record(108, 174, "female", ["feedee"], "JP")),
];
const drawnCount = (answer) =>
  drawnOf(answer).bins.reduce((n, band) => n + band.count, 0);

const both = atShippedFloor(CROWD, TWO_CHIPS);
check("combined: the population is the INTERSECTION and not the union - " +
  "three members are male, three are feeders, and the two who are both " +
  "are what draws",
  both.enough === true && drawnCount(both) === 2);
check("combined: and each predicate ALONE still draws its own three, so " +
  "the two above are an AND rather than a narrower reading of either " +
  "one - a union would have drawn four",
  drawnCount(atShippedFloor(CROWD,
    "measure=weight&filter=gender&value=male")) === 3 &&
  drawnCount(atShippedFloor(CROWD,
    "measure=weight&filter=roles&value=feeder")) === 3 &&
  drawnCount(atShippedFloor(CROWD, "measure=weight")) === 5);
check("combined: a third predicate narrows again - one member is male, " +
  "a feeder, and in the US",
  drawnCount(atShippedFloor(CROWD, TWO_CHIPS +
    "&filter=country&value=US")) === 1);

/* The echo is the caller's own question handed back, so the order is
   theirs; the ANSWER must not depend on it, because AND is commutative
   and a chip row a member reordered would otherwise redraw. */
const withoutEcho = (answer) => {
  const copy = Object.assign({}, answer);
  delete copy.filters;
  return JSON.stringify(copy);
};
const flipped = atShippedFloor(CROWD,
  "measure=weight&filter=roles&value=feeder&filter=gender&value=male");
check("combined: the order the chips arrive in changes the echo and " +
  "nothing else",
  withoutEcho(both) === withoutEcho(flipped) &&
  flipped.filters[0].field === "roles" &&
  flipped.filters[1].field === "gender");

check("combined: the echo is the caller's own predicates, in their own " +
  "order, each carrying its field and its value and nothing beside them " +
  "(mandate 5)",
  JSON.stringify(both.filters) === JSON.stringify([
    { field: "gender", value: "male" },
    { field: "roles", value: "feeder" }]));
check("combined: Everyone echoes an empty list rather than a null pair - " +
  "ONE shape at every count, so a page never reads a key that exists " +
  "only when exactly one chip is set",
  JSON.stringify(atShippedFloor(CROWD, "measure=weight").filters) === "[]" &&
  Object.prototype.hasOwnProperty.call(both, "filters") &&
  !Object.prototype.hasOwnProperty.call(both, "filter"));

check("combined: the group makeup describes the INTERSECTION - the two " +
  "members drawn above are both male feeders, so every cell neither of " +
  "them holds reads zero, and the countries are their own two",
  countIn(groupBlock(both, "gender"), "male") === 2 &&
  countIn(groupBlock(both, "gender"), "female") === 0 &&
  countIn(groupBlock(both, "roles"), "feeder") === 2 &&
  countIn(groupBlock(both, "roles"), "feedee") === 0 &&
  countIn(groupBlock(both, "country"), "US") === 1 &&
  countIn(groupBlock(both, "country"), "JP") === 1);

const emptyCross = atShippedFloor(CROWD,
  "measure=weight&filter=gender&value=female&filter=country&value=DE");
check("combined: an intersection nobody is in answers the honest empty " +
  "document - the same one a filter value nobody holds already got",
  emptyCross.enough === false && emptyCross.distribution === null &&
  emptyCross.groups === null && emptyCross.trend === null);
check("combined: and that empty answer names no value the group really " +
  "holds - only the two the caller sent (mandate 5)",
  !everyString(emptyCross).includes("US") &&
  !everyString(emptyCross).includes("JP") &&
  !everyString(emptyCross).includes("feeder"));

/* -------------------------------------------------------------- */
/* 10c. The floor applies to the intersection exactly as to the    */
/*      whole (#438 scope 2, #384 ruling 2).                       */

check("combined: at the shipped floor of 0 the intersection draws its " +
  "TRUE count - the same rule as the whole population, exact",
  both.floor === SHIPPED_FLOOR && drawnCount(both) === 2 &&
  countIn(groupBlock(both, "gender"), "male") === 2);

const raisedBoth = atRaisedFloor(CROWD, TWO_CHIPS);
check("combined: at a raised floor the same intersection of two is " +
  "below it and gets the honest empty document - never a smaller " +
  "number, never a different rule",
  raisedBoth.enough === false && raisedBoth.floor === RAISED &&
  raisedBoth.distribution === null && raisedBoth.groups === null &&
  raisedBoth.trend === null && raisedBoth.units === null);
check("combined: and the WHOLE population of five draws at that same " +
  "floor - what was suppressed above is the intersection's SIZE and not " +
  "the act of filtering",
  atRaisedFloor(CROWD, "measure=weight").enough === true);

/* -------------------------------------------------------------- */
/* 10d. Nothing about an individual leaks through a narrow filter  */
/*      (#438 scope 3 - the surface the batch's consult reads      */
/*      first).                                                    */
/*                                                                 */
/* Two members who differ on EVERY categorical field, so each pair */
/* of predicates drawn across two fields from one member isolates  */
/* exactly that member, and each pair that crosses the two matches */
/* nobody. The claim is that those two cases come back as the same */
/* bytes apart from the caller's own echo: a reader cannot tell    */
/* "one person is in here" from "nobody is", and so cannot learn   */
/* which value made the view narrow.                               */

const LONE_A = { gender: "male", roles: "feeder", country: "US" };
const LONE_B = { gender: "female", roles: "feedee", country: "JP" };
const TWO_MEMBERS = [
  row(acct(70), COMBO_AT,
    record(100, 170, LONE_A.gender, [LONE_A.roles], LONE_A.country)),
  row(acct(71), COMBO_AT,
    record(120, 180, LONE_B.gender, [LONE_B.roles], LONE_B.country)),
];
const CATEGORIES = ["gender", "roles", "country"];
const chipPair = (a, b, one, two) => "measure=weight" +
  "&filter=" + a + "&value=" + one[a] +
  "&filter=" + b + "&value=" + two[b];

const isolating = [];
const crossing = [];
for (let i = 0; i < CATEGORIES.length; i += 1) {
  for (let j = i + 1; j < CATEGORIES.length; j += 1) {
    const a = CATEGORIES[i];
    const b = CATEGORIES[j];
    isolating.push(chipPair(a, b, LONE_A, LONE_A));
    isolating.push(chipPair(a, b, LONE_B, LONE_B));
    crossing.push(chipPair(a, b, LONE_A, LONE_B));
    crossing.push(chipPair(a, b, LONE_B, LONE_A));
  }
}

/* The fixture's own premise, forced before anything is asserted about
   suppressing it: at the shipped floor of 0 every one of these pairs
   really does draw exactly ONE member. Without this the arm below would
   pass just as well on a fixture where nothing matched at all. */
check("combined: every pair of chips across two fields isolates exactly " +
  "one member at the shipped floor of 0 - the accepted disclosure #384 " +
  "ruling 2 re-took, armed as a positive claim (" + isolating.length +
  " pairs)",
  isolating.length === 6 && isolating.every((query) => {
    const drew = atShippedFloor(TWO_MEMBERS, query);
    return drew.enough === true && drawnCount(drew) === 1;
  }));
check("combined: and every pair that crosses the two members matches " +
  "nobody, so the two cases below are genuinely different questions (" +
  crossing.length + " pairs)",
  crossing.length === 6 && crossing.every((query) =>
    atShippedFloor(TWO_MEMBERS, query).enough === false));

check("combined: at a raised floor EVERY one of those one-member " +
  "combinations is suppressed - no view of a single member survives " +
  "above floor 0, whichever pair of chips built it (#438 scope 3)",
  isolating.every((query) => {
    const answer = atRaisedFloor(TWO_MEMBERS, query);
    return answer.enough === false && answer.distribution === null &&
      answer.groups === null && answer.trend === null &&
      answer.units === null;
  }));
check("combined: and each of those documents carries no number but the " +
  "floor - no count, no '0 of 1', no band residue",
  isolating.every((query) => {
    const numbers = everyNumber(atRaisedFloor(TWO_MEMBERS, query));
    return numbers.length === 1 && numbers[0] === RAISED;
  }));

const narrowShapes = new Set(isolating.concat(crossing)
  .map((query) => withoutEcho(atRaisedFloor(TWO_MEMBERS, query))));
check("combined: a one-member combination and a combination nobody is " +
  "in come back as the SAME document apart from the caller's own echo - " +
  "the response never says which value made the view narrow (#438 " +
  "scope 3)", narrowShapes.size === 1);

/*
 * The other half of scope 3, on a filtered view that DOES clear the
 * floor: no per-field count below the floor is ever named. Three
 * members, two of whom are male feeders and differ on country, at a
 * floor of two - so the intersection draws and the two country cells of
 * one person each do not.
 */
const NARROW = [
  row(acct(74), COMBO_AT, record(100, 170, "male", ["feeder"], "US")),
  row(acct(75), COMBO_AT, record(110, 175, "male", ["feeder"], "JP")),
  row(acct(76), COMBO_AT, record(130, 185, "female", ["feedee"], "US")),
];
const twoDeep = Object.freeze({ floor: 2 });
const narrowed = agg.aggregate(NARROW, ask(TWO_CHIPS), undefined, twoDeep);
check("combined: a filtered view that CLEARS the floor still names no " +
  "per-field count below it - the two members it draws differ on " +
  "country, and neither country cell is named (#438 scope 3)",
  narrowed.enough === true && narrowed.floor === 2 &&
  narrowed.groups.length > 0 &&
  narrowed.groups.every((block) => block.values.every((cell) =>
    cell.count === 0 || cell.count >= 2)) &&
  groupBlock(narrowed, "country").length === 0);
check("combined: and the cells that DO clear it are named at their true " +
  "value, so the arm above is suppression rather than an empty answer",
  countIn(groupBlock(narrowed, "gender"), "male") === 2 &&
  countIn(groupBlock(narrowed, "roles"), "feeder") === 2);

/* -------------------------------------------------------------- */
/* 10e. The route, end to end - the chips reach the aggregation.   */

const comboDb = makeDb();
const comboEnv = Object.assign({}, env, { DB: comboDb });
const COMBO_TOKENS = [];
for (let i = 0; i < CROWD.length; i += 1) {
  const token = "charts-arm-combo-" + i;
  COMBO_TOKENS.push(token);
  comboDb._sessions.push({
    token_hash: sha256hex(token), account_id: acct(60 + i),
    is_admin: 0, is_dev: 0,
    created_at: new Date().toISOString(), expires_at: future,
  });
  await callOn(comboEnv, "POST", "/submit", {
    token: token,
    body: { record: JSON.stringify(CROWD[i].record) },
  });
}

const routeBoth = await callOn(comboEnv, "GET",
  "/charts-data?" + TWO_CHIPS, { token: COMBO_TOKENS[0] });
check("route: two chips reach the aggregation as two predicates ANDed - " +
  "five members sealed, three male, three feeders, two of them both",
  routeBoth.status === 200 && routeBoth.body.enough === true &&
  routeBoth.body.distribution.bins
    .reduce((n, band) => n + band.count, 0) === 2);
check("route: and the echo hands back both predicates in the caller's " +
  "own order",
  JSON.stringify(routeBoth.body.filters) === JSON.stringify([
    { field: "gender", value: "male" },
    { field: "roles", value: "feeder" }]));
check("route: the makeup block that comes back with a filtered picture " +
  "describes the FILTERED population (#438 scope 2)",
  countIn(bodyBlock(routeBoth.body, "gender"), "male") === 2 &&
  countIn(bodyBlock(routeBoth.body, "gender"), "female") === 0);

const routeDupe = await callOn(comboEnv, "GET",
  "/charts-data?measure=weight&filter=gender&value=male" +
  "&filter=gender&value=female", { token: COMBO_TOKENS[0] });
check("route: two values for one field are a 400 at the door",
  routeDupe.status === 400);
const routeCap = await callOn(comboEnv, "GET",
  "/charts-data?" + capQuery(agg.MAX_FILTERS + 1),
  { token: COMBO_TOKENS[0] });
check("route: one filter past the cap is a 400 at the door",
  routeCap.status === 400);

/*
 * THE FLOOR REACHES A COMBINED VIEW THROUGH THE REAL SEAM. The pure
 * arms above hand aggregate() a settings object directly; this one sets
 * `chart.floor` in `site_content` and drives the route, so the whole
 * chain - chartSettings(env), the ask, the intersection, the floor -
 * is exercised the way a deployment runs it (0.9-M3-S8, #414).
 */
const flooredDb = makeDb([{ name: "chart.floor", value: String(RAISED) }]);
const flooredEnv = Object.assign({}, env, { DB: flooredDb });
const FLOOR_TOKENS = [];
for (let i = 0; i < CROWD.length; i += 1) {
  const token = "charts-arm-floored-" + i;
  FLOOR_TOKENS.push(token);
  flooredDb._sessions.push({
    token_hash: sha256hex(token), account_id: acct(60 + i),
    is_admin: 0, is_dev: 0,
    created_at: new Date().toISOString(), expires_at: future,
  });
  await callOn(flooredEnv, "POST", "/submit", {
    token: token,
    body: { record: JSON.stringify(CROWD[i].record) },
  });
}
const flooredAll = await callOn(flooredEnv, "GET",
  "/charts-data?measure=weight", { token: FLOOR_TOKENS[0] });
check("route: the admin's floor really is the one applied - five " +
  "members clear a floor of " + RAISED + " set in site_content",
  flooredAll.status === 200 && flooredAll.body.floor === RAISED &&
  flooredAll.body.enough === true);
const flooredBoth = await callOn(flooredEnv, "GET",
  "/charts-data?" + TWO_CHIPS, { token: FLOOR_TOKENS[0] });
check("route: and the same request that drew two members at floor 0 is " +
  "suppressed at that floor - one rule, applied to the intersection " +
  "exactly as it is applied to the whole",
  flooredBoth.status === 200 && flooredBoth.body.enough === false &&
  flooredBoth.body.distribution === null &&
  flooredBoth.body.groups === null &&
  flooredBoth.body.note === "Not enough people for this view.");
check("route: that suppressed answer still echoes the caller's own two " +
  "chips and carries no number but the floor",
  JSON.stringify(flooredBoth.body.filters) === JSON.stringify([
    { field: "gender", value: "male" },
    { field: "roles", value: "feeder" }]) &&
  everyNumber(Object.assign({}, flooredBoth.body, { filters: [] }))
    .join(",") === String(RAISED));

/* -------------------------------------------------------------- */
/* 10f. The trend's population is the INTERSECTION too - the same */
/*      claim 10b makes for the group makeup (S24's independent    */
/*      review, #438 comment 5377047859, finding F2).               */
/*                                                                 */
/* The group-makeup block above is already proved to describe the  */
/* filtered set (10b, 10c). Nothing proved the same for the trend, */
/* so a trend recomputed over the WHOLE binder inside a filtered    */
/* document passed every check in this file. `both` is the same    */
/* two-member intersection 10b drew from CROWD's five members, all  */
/* five of whom submitted in the same month - so the trend's one    */
/* point counts everyone unless the population it averages really   */
/* is the same two the distribution drew, and not the whole five.   */

check("combined: the trend's population is the INTERSECTION, not the " +
  "whole binder - the trend's one point counts the same two members " +
  "the distribution drew, not CROWD's other three (S24 review F2)",
  pointsOf(both).length === 1 &&
  pointsOf(both)[0].people === drawnCount(both) &&
  pointsOf(both)[0].people === 2);

/* ------------------------------------------------------------------ */
const EXPECTED = 238;
console.log(failures
  ? `\ncharts-aggregate FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\ncharts-aggregate ran ${performed} checks, expected ${EXPECTED}`
    : `\ncharts-aggregate OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
