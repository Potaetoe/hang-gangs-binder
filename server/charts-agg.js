/*
 * THE ONE ROWS-TO-SERIES PATH. Opened rows in, one answer out.
 *
 * DESIGN.md, "Charts": the Worker aggregates on request, and this file is
 * where every disclosure rule is decided. server/worker.js's GET
 * /charts-data handler reads the database, opens the ciphertext and
 * serializes what this file returns - it computes no cell of its own, and
 * there is deliberately no second path a later route could reach for.
 *
 * THE FLOOR IS A SETTING AND ITS SHIPPED DEFAULT IS 0 (owner ruling,
 * #243 comment 5346978974, the 2026-08-19 charts sitting). It was a
 * constant of 5 here until that sitting re-took the whole regime across
 * five rounds including an adversarial one. The ruling, in the owner's
 * own words: members chose to share. Its consequence was put
 * adversarially and accepted - a filter isolating one member shows that
 * member's number to every signed-in member - so a one-person view
 * drawing its true value is the design here, not a hole in it.
 *
 * NOTHING WAS RIPPED OUT. The Other bucket, person-pooling, band merging
 * and the one-partition rule all still stand below and all obey whatever
 * floor they are given; at 0 every one of them is dormant. The way back
 * is a number, which is why tests/charts-aggregate.test.mjs still proves
 * the whole machinery at a floor of 5 rather than deleting those arms.
 *
 * THE FLOOR ARRIVES THROUGH ONE SEAM AND THE WIRE IS NOT IT.
 * aggregate()'s fourth argument is a SETTINGS OBJECT read on the server
 * side; floorOf() below is the only thing that interprets it, and it
 * takes a whole non-negative number or falls back to the default. 0.9-M3's
 * Settings page fills that object - server/worker.js's CHART_SETTINGS is
 * the single call site it edits. Nothing a caller sends can reach it:
 * askFor() refuses a query parameter it does not know rather than
 * ignoring one, so `?floor=1` is a refusal a caller can see. The shape
 * this deliberately does NOT copy is the pre-0.9 dashboard's
 * `floor = identify ? 0 : MIN_CELL` - a caller-chosen flag on the wire
 * that turned suppression off wholesale.
 *
 * THE FLOOR IS APPLIED BEFORE ANYTHING LEAVES. Every exported function
 * that touches a group returns output the floor has already reduced, so
 * a caller cannot hold an unfloored intermediate. That is the whole
 * reason the split is a module boundary rather than two functions in
 * worker.js: a handler holding raw counts is one `if` away from printing
 * them. At a floor of 0 that reduction is the identity, and the boundary
 * is what makes raising the setting a one-line change rather than a
 * rewrite.
 *
 * WHAT THE ANSWER CARRIES, since #371 reshaped it:
 *
 *   distribution   fixed bands over the field spec's own min, max and
 *                  bin width. Categories are never bands.
 *   trend          one point per month, the mean of the people who
 *                  submitted in it.
 *   groups         the GROUP-MAKEUP block: one entry per categorical
 *                  field, each a list of count lines. This is where
 *                  gender, affiliation and country live now - as plain
 *                  counts of unique members rather than as an axis.
 *
 * THE GROUP-MAKEUP BLOCK IS NOT THE FILTER ECHO, and the two are easy to
 * confuse into one rule. The echo hands a caller back the value THEY
 * sent and never says what the group holds (mandate 5, unchanged: a list
 * of which filter values exist would be a membership oracle reachable
 * with one request). The block lists the SPEC's own values with counts,
 * which is a chart: the same disclosure a drawn cell always was, ruled
 * explicitly at the sitting - exact counts, small ones included, zeros
 * listed. Each member counts once and their most recent current entry
 * decides their category, so the block describes the same people the
 * rest of the answer does.
 *
 * ------------------------------------------------------------------
 * THE RECORD CONTRACT, derived from apps/web/site.config.js.
 *
 * A row's plaintext is opaque to POST /submit on purpose, so this file
 * is the first thing that has an opinion about its shape - and it takes
 * that opinion from the spec rather than from a list written here. For a
 * field named N in apps/web/site.config.js:
 *
 *   weight / length   record[N] is an object keyed by the unit table's
 *                     own `store` names: record.weight.kg,
 *                     record.weight.lb, record.height.cm,
 *                     record.height.totalInches.
 *   choice            record[N] is the choice's `value`, or null.
 *   choice, multiple  record[N] is an array of `value` strings.
 *   count             record[N] is a number.
 *   computed          NOT stored. It is derived here, through the
 *                     measure's own compute(), from its `from` fields
 *                     read in their kind's BASE unit.
 *   consent           a boolean, and never charted.
 *
 * AND THE ENVELOPE THE SPEC DOES NOT NAME. A record carries four fields
 * that are not fields of the form, and a writer told only about the
 * measured half above would drop them (#351, fix wave 1, finding F3):
 *
 *   record            the RECORD's own version byte, 1 today. It is not
 *                     the envelope version the seal carries: that one
 *                     says how the bytes are sealed, this one says what
 *                     the fields inside mean, and they change for
 *                     different reasons. A stored format that changes
 *                     takes a new number and a decoder for both, never
 *                     a regenerated fixture - so 0.9-M2-S2, which
 *                     writes these records, walks into the stored-
 *                     format law the moment it omits this.
 *   submittedAt       an ISO timestamp from the SUBMITTER's clock. Not
 *                     the time anything here buckets on: see the
 *                     received_at paragraph below, which is the one a
 *                     submitter cannot choose.
 *   telegram          the handle the submitter signed in with.
 *   entered           { units, weight, height } - exactly what the
 *                     submitter typed, before any conversion.
 *
 * HOW THIS FILE HANDLES THEM: it reads SPEC-NAMED fields and nothing
 * else. valueFor() and heldValues() both look a measure's own name up
 * in the record, and none of the four is a measure, so no response can
 * carry one - the handle in particular is out of reach by construction
 * rather than by a filter somebody has to remember to keep.
 * tests/charts-aggregate.test.mjs seals rows carrying all four and
 * sweeps a drawn answer for the handle's own value, which is the pin.
 *
 * A value a record carries that the spec's choice list does not is
 * counted as unstated rather than drawn, which is what keeps a label in
 * a response from ever being something a member's browser wrote. A field
 * missing from a record is absent, never zero: somebody who gave a
 * weight and no height is one person with no BMI, and inventing one
 * would put a fabricated point in a chart drawn from real ones.
 *
 * TIME COMES FROM received_at AND NEVER FROM THE RECORD. DESIGN.md,
 * "Your page": there is no member backdating and the form has no date
 * field, so the receipt time this side attested to is both the honest
 * clock and the one a submitter cannot choose. It also means a trend
 * needs no record opened to be bucketed.
 *
 * ------------------------------------------------------------------
 * WHAT THE FLOOR DOES NOT BOUND, said out loud because a rule stated
 * without its limit reads as a stronger promise than it is.
 *
 * At the shipped floor of 0 the answer is the group's own figures, so
 * there is nothing here to subtract back out: the disclosure is the
 * ruled one and a reader keeping two responses learns what a reader
 * keeping one already knew. What the machinery below bounds is the
 * RAISED-floor world, and there the old limit still holds and is still
 * worth saying: every rule is about what ONE response discloses, and a
 * reader who keeps several can still difference two views of the same
 * measure under different filters, or the same view at two times.
 * DESIGN.md, "Charts", takes that channel knowingly - the owner ruled on
 * #153 to accept it rather than charge every member the mean's real
 * value to close it, and the #243 sitting subsumed the question by
 * ruling the visibility itself. Both rulings rest on a members-only
 * readership, which the session gate on GET /charts-data preserves. That
 * premise is the thing to re-take if the readership ever widens.
 */
import "../apps/web/site.config.js";
import "../apps/web/fields.js";

/*
 * The smallest number of PEOPLE a drawn cell, band or trend point may
 * describe, when nobody has set one: ZERO, so everything draws.
 *
 * DESIGN.md, "Admin surfaces", carries the setting and this default
 * together, per the #243 ruling. Zero is a real value of the setting
 * rather than an off switch, which is why every guard below compares
 * against it instead of branching on whether suppression is "on": one
 * code path, exercised at every floor, and nothing that only runs when
 * an admin raises the number.
 *
 * People rather than rows, everywhere, and the distinction IS the floor
 * once one is set. One member submitting five times is one member; a
 * floor that counted rows would let a single person clear it by filling
 * the form in five times, which is exactly the disclosure it exists to
 * prevent.
 */
const DEFAULT_FLOOR = 0;

/*
 * The floor this answer applies, from the settings the server holds.
 *
 * A WHOLE NON-NEGATIVE NUMBER OR NOTHING. Anything else - a bare
 * positional argument, a string, a fraction, a negative - is the default
 * rather than a floor, because the failure that matters now runs the
 * other way from the one mandate 2 was written against: nothing can be
 * lowered below zero, so what a sloppy read costs is a floor an admin
 * SET and this file silently did not apply. A validator that accepted
 * "5" would also accept whatever else a later caller passed by accident.
 */
function floorOf(settings) {
  if (!settings || typeof settings !== "object") return DEFAULT_FLOOR;
  const held = settings.floor;
  return typeof held === "number" && Number.isInteger(held) && held >= 0
    ? held : DEFAULT_FLOOR;
}

/*
 * What the fold is called - and the parenthetical is CONDITIONAL,
 * because it is a claim about the contents rather than part of the name.
 *
 * The name is the one DESIGN.md, "Charts", gives the bucket, and it
 * carries no value a member holds: mandate 5's "the Other label carries
 * no member-typed values". The parenthetical asserts something further -
 * that every value folded in here is held by fewer than the floor's
 * number of people. True of the pool, which takes only sub-floor cells.
 * FALSE the moment the absorb cascade in suppressCounts() feeds the
 * bucket a NAMED cell, because a named cell had cleared the floor
 * (0.9-M2-S3's review of record, F8, #362: 12 [feeder], 8 [feedee] and
 * 2 [feeder, gainer] drew "Other (fewer than 5)" beside a count of 8,
 * and the 8 was a feedee cell the cascade had absorbed).
 *
 * The count printed beside the label never was the parenthetical's
 * subject - a drawn bucket clears the floor by construction, so this
 * string has always sat next to a number of five or more. That is why
 * the false sentence took a corpus to see rather than a reading.
 *
 * DROPPING IT IS THE WHOLE DISCLOSURE, deliberately. A reader of a
 * plain "Other" learns that the sub-floor claim could not be made and
 * nothing else: not which named cell was absorbed, not how many were,
 * not what any of them counted. A label that said more - a count of
 * absorbed cells, a "one value above the floor" - would describe the
 * very cells the fold exists to stop describing, and DESIGN.md's
 * no-statistics-vocabulary rule bars the register it would say it in.
 */
const OTHER_LABEL = "Other";
const allSmallLabel = (floor) =>
  OTHER_LABEL + " (fewer than " + floor + ")";

/*
 * The blanks keep their own cell rather than being dropped. A chart
 * without them claims a completeness the data does not have: "60% male"
 * reads very differently from "60% of the third who answered".
 */
const NOT_STATED_LABEL = "Not stated";

/*
 * The honest sentence, and the ONLY thing a view that cannot draw says.
 *
 * DESIGN.md, "Charts": a view with nobody in it answers this rather than
 * an error, and at the shipped floor of 0 that empty view is the only
 * refusal left in the whole route. It stays ONE constant rather than a
 * string built per case, because at any raised floor a group too small
 * to draw and a filter value nobody in the group holds have to be
 * indistinguishable - same status, same sentence, same document - and a
 * second spelling for one of them would be the oracle. The page turns
 * this into the broader-filter hint; the route says only what it knows.
 */
const NOT_ENOUGH = "Not enough people for this view.";

/*
 * The allowlist for a choice field that keeps its list somewhere else.
 *
 * apps/web/site.config.js's `choicesFrom` points at a list a page loads -
 * apps/web/countries.js is the one that exists - and that file assigns
 * to `window`, which a Worker does not have. So the Worker's allowlist
 * for such a field is the SHAPE its list is keyed by, declared here in
 * one place: two upper-case ASCII letters is every ISO 3166-1 alpha-2
 * code and nothing a member could type.
 *
 * Shape rather than the list itself is enough for what the allowlist is
 * for. Its job is to stop free text reaching a response through the
 * filter echo, and a closed shape does that completely; a code nobody
 * holds answers the same not-enough document every other value nobody
 * holds gets, so admitting one discloses nothing.
 *
 * A `choicesFrom` name this file has never heard of THROWS rather than
 * being waved through, the same direction apps/web/fields.js refuses an
 * unknown derivation: answering would mean validating a filter against
 * no rule at all.
 */
const CHOICE_LIST_SHAPES = { countries: /^[A-Z]{2}$/ };

/*
 * The query parameters this route has, as a closed set. An unknown one
 * is REFUSED rather than ignored, and that is mandate 2's structural
 * half: `?floor=1` has to be a refusal a caller can see, not a silent
 * no-op that leaves them believing the floor moved. It also means a
 * parameter added by a later slice cannot arrive unvalidated.
 */
const ASK_PARAMS = new Set(["measure", "filter", "value", "self"]);

/* An account id as server/worker.js writes one: SHA-256 HMAC, hex. */
const ACCOUNT_ID = /^[0-9a-f]{64}$/;

/* The period a trend point covers: one calendar month, read straight off
   the receipt timestamp's own leading characters so no clock arithmetic
   and no time zone is involved. A month is coarse enough that a group of
   a few dozen can clear the floor within one. */
const PERIOD = /^(\d{4}-\d{2})/;

function round(value, places) {
  const factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
}

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/* apps/web/fields.js's exports, read at call time. Both imports above
   assign to globalThis, and reading them here rather than at module scope
   keeps this file indifferent to the order a bundler evaluates them in -
   the same reason apps/web/fields.js resolves its own spec inside spec(). */
function api() {
  return globalThis.BinderFields;
}

function siteSpec(given) {
  return given || globalThis.BINDER_SITE;
}

/* ------------------------------------------------------------------ */
/* Reading a record against the spec.                                   */

/*
 * Which unit table the group is binned in, and it is ONE table for the
 * whole answer.
 *
 * DESIGN.md, "One partition, not two": both unit systems report the same
 * groups under converted edges, because two independently-binned
 * partitions were differenced back into sub-floor cells in 2899 of 3000
 * random groups. The partition is the spec's own default system, so the
 * axis a group actually reads is the one with round numbers on it, and
 * every other system's edges are that partition converted.
 *
 * A unitless measure - a computed BMI, a plain count - has one number
 * for every system, so its partition is nominal and its `unit` is null.
 */
function partitionOf(measure, site) {
  const system = site.units.default;
  if (!measure.unitful) {
    return { system: system, unit: null, band: null, bin: measure.bin,
      store: null };
  }
  const chosen = measure.units[system];
  return { system: system, unit: chosen.unit, band: chosen.band,
    bin: chosen.bin, store: chosen.store };
}

/*
 * One number, expressed in every system, from ONE number.
 *
 * The conversion runs on the value the partition already fixed rather
 * than on the underlying data, so the systems cannot carry independent
 * information: rounding each system's own reading separately would leave
 * a reader two measurements of one quantity and a finer estimate than
 * either, which is the same overlay attack the partition rule closes,
 * arriving through the decimal point.
 *
 * The factor comes from apps/web/fields.js, which computes it from the
 * spec's own `per` numbers - so there is exactly one place a conversion
 * can be wrong and it is the spec's table.
 */
function spread(value, measure, site, part) {
  const out = {};
  for (const system of site.units.systems) {
    if (!measure.unitful) {
      out[system] = value;
      continue;
    }
    const factor = api().factor(part.unit, measure.units[system].unit, site);
    out[system] = factor === null ? null : round(value * factor, 1);
  }
  return out;
}

/* A source field's value in its kind's BASE unit, which is what a
   computed field's arithmetic is defined against (apps/web/fields.js's
   DERIVATIONS take kg and cm). The base's `store` name is read from the
   spec rather than assumed, so a fork that stores its base under another
   property still derives. */
function baseValue(fieldName, record, site) {
  const one = api().field(fieldName, site);
  const kind = site.units.kinds[one.kind];
  if (!kind || !kind.base) return num(record[fieldName]);
  const store = kind.units[kind.base].store;
  const held = record[fieldName];
  return held && typeof held === "object" ? num(held[store]) : null;
}

/*
 * One person's number for this measure, in the partition's unit, or null
 * when they have none.
 *
 * Null and never zero. A member who left a field blank is a member with
 * no value here, and folding that into a zero would put a person at the
 * bottom of a distribution they are not in.
 */
function valueFor(measure, record, site, part) {
  if (!record || typeof record !== "object") return null;

  if (measure.unitful) {
    const held = record[measure.name];
    return held && typeof held === "object" ? num(held[part.store]) : null;
  }

  if (typeof measure.compute === "function") {
    const values = {};
    for (const name of measure.from || []) {
      values[name] = baseValue(name, record, site);
    }
    return num(measure.compute(values));
  }

  return num(record[measure.name]);
}

/* The choice values the spec allows for one categorical measure, or null
   when the list lives elsewhere and the shape above is the rule. */
function allowedValues(measure) {
  if (measure.choicesFrom) {
    const shape = CHOICE_LIST_SHAPES[measure.choicesFrom];
    if (!shape) {
      throw new Error('The spec points field "' + measure.name +
        '" at a "' + measure.choicesFrom + '" choice list, and ' +
        "server/charts-agg.js knows no such list - so a filter on it " +
        "could be validated against nothing.");
    }
    return null;
  }
  return (measure.choices || []).map((choice) => choice.value);
}

function permits(measure, value) {
  const allowed = allowedValues(measure);
  return allowed === null
    ? CHOICE_LIST_SHAPES[measure.choicesFrom].test(value)
    : allowed.indexOf(value) !== -1;
}

/* What one person holds for a categorical measure: a list for a
   multiple-choice field, one value or null for a single one. A value the
   spec does not allow reads as unstated, which is what stops anything a
   member's browser wrote becoming a label in a response. */
function heldValues(measure, record) {
  if (!record || typeof record !== "object") return [];
  const held = record[measure.name];
  if (measure.multiple) {
    if (!Array.isArray(held)) return [];
    const seen = [];
    for (const one of held) {
      const value = String(one);
      if (permits(measure, value) && seen.indexOf(value) === -1) {
        seen.push(value);
      }
    }
    return seen;
  }
  if (held === null || held === undefined || held === "") return [];
  const value = String(held);
  return permits(measure, value) ? [value] : [];
}

/* ------------------------------------------------------------------ */
/* Reading the caller's question.                                       */

function fault(message) {
  return { ok: false, error: message };
}

/*
 * The caller's question, validated against the spec and against nothing
 * else.
 *
 * EVERY REFUSAL HERE IS ABOUT THE CONFIGURATION, NEVER ABOUT THE GROUP.
 * The measure list, the filter list and the choice values are all in
 * apps/web/site.config.js, which anybody may read in the repository - so a
 * 400 from this function discloses exactly what a fork's own config file
 * already says, and nothing about who is in the binder. What a caller
 * must never be able to tell apart is a filter value nobody holds from
 * one too few hold, and neither of those is refused here: both are valid
 * questions that aggregate() answers with the same document.
 */
function askFor(params, spec) {
  const site = siteSpec(spec);
  const fields = api();

  for (const name of params.keys()) {
    if (!ASK_PARAMS.has(name)) {
      return fault('"' + name + '" is not a parameter of this view.');
    }
    if (params.getAll(name).length > 1) {
      return fault('"' + name + '" is given more than once.');
    }
  }

  /*
   * A CATEGORY IS NOT A MEASURE ANY MORE (owner ruling 1, #243): gender,
   * affiliation and country are never charted as bars, so `measure=`
   * simply does not offer them and an ask for one is refused exactly as
   * an unknown name is - one sentence, one shape, nothing for a caller
   * to tell apart. Their counts did not go away; they moved to the
   * group-makeup block every drawn answer carries. They remain FILTERS,
   * which the ruling left untouched, and the filter half below still
   * reads the whole measure list for that reason.
   */
  const measures = fields.measures(site);
  const drawable = measures.filter((one) => one.kind !== "categorical");
  const wanted = params.get("measure");
  const measure = drawable.filter((one) => one.name === wanted)[0];
  if (!measure) {
    return fault("That is not a measure this form charts.");
  }

  let filter = null;
  const by = params.get("filter");
  const value = params.get("value");
  if (by !== null) {
    const on = measures.filter((one) =>
      one.name === by && one.kind === "categorical")[0];
    if (!on) return fault("That is not a filter this form offers.");
    if (value === null) return fault("That filter needs a value.");
    if (!permits(on, value)) {
      return fault("That is not a value of that filter.");
    }
    filter = { field: by, value: value, measure: on };
  } else if (value !== null) {
    return fault("A value needs a filter to belong to.");
  }

  /*
   * The overlay is a BOOLEAN and deliberately nothing richer. Mandate 3:
   * the caller's own line is keyed by the session's account, so there is
   * no identity to name here - and a parameter that accepted one would
   * be the place somebody later resolved it. "1" or absent; anything
   * else, including an account id, is a refusal.
   */
  const self = params.get("self");
  if (self !== null && self !== "1") {
    return fault("self is 1 or is left off - it names nobody.");
  }

  return { ok: true, ask: { measure: measure, filter: filter,
    self: self === "1" } };
}

/* ------------------------------------------------------------------ */
/* The floor's three shapes.                                            */

/*
 * The most bands one grid may hold, and a spec that asks for more is a
 * spec error rather than a big chart. It is a guard on the CONFIG, not
 * on the data: a fork that writes a range of a million and a width of
 * one gets a loud refusal instead of a Worker building a million objects
 * per request out of numbers a person typed once.
 */
const MAX_BANDS = 200;

/*
 * The range one measure's grid spans, IN THE PARTITION'S OWN UNIT, read
 * from the spec and never from the group.
 *
 * Owner ruling 5 (#243): "Edges come from the field spec and never move
 * or merge." This is where that is decided, and it is the whole answer
 * to the leak #351's fix wave 1 found (finding F2): an edge fitted to
 * the data reported the heaviest member's band, so the ends had to be
 * reported as open. A spec edge derives from nobody, so there is nothing
 * left to open - and two groups drawn on one grid are comparable, which
 * is what the owner chose it for.
 *
 * WHERE THE BOUNDS COME FROM, in order, all of them the spec's own:
 *
 *   1. The chart unit's own `min`/`max`, when it carries them. Weight
 *      charts in pounds under the shipped spec and pounds are bounded in
 *      pounds, so the axis reads in the round numbers the spec wrote.
 *   2. The same system's ENTRY unit, converted. Imperial height charts
 *      in inches, which carry no bound, because a member of that system
 *      types feet and the spec bounds the box they look at - so the
 *      inches axis runs between the same three and eight feet.
 *   3. The kind's base unit, converted, for a system the spec bounds
 *      nowhere else.
 *
 * A unitless measure - a computed BMI, a plain count - has no unit table
 * to read, so its bounds are fields of the spec row itself.
 *
 * AND A CHARTED FIELD WITH NO RANGE ANYWHERE THROWS, the same direction
 * apps/web/fields.js refuses an unknown derivation. The alternative is
 * fitting the grid to whoever happens to be in the group, which is the
 * exact thing this function exists to stop; a fork that adds a numeric
 * field says what range it is drawn over, and finds out at once if it
 * did not.
 */
function rangeOf(measure, part, site) {
  const one = api().field(measure.name, site);
  const complain = (why) => {
    throw new Error('The spec charts field "' + measure.name + '" and ' +
      why + ", so server/charts-agg.js has no fixed band edges to draw " +
      "it on: give the field a min and a max in the spec.");
  };

  if (!measure.unitful) {
    if (typeof one.min !== "number" || typeof one.max !== "number" ||
        !(one.max > one.min)) {
      complain("gives it no min and max of its own");
    }
    return { min: one.min, max: one.max };
  }

  const kind = site.units.kinds[one.kind];
  const table = kind.units;
  const tried = [part.unit, kind.enter ? kind.enter[part.system] : null,
    kind.base];
  for (const name of tried) {
    const entry = name ? table[name] : null;
    if (!entry || typeof entry.min !== "number" ||
        typeof entry.max !== "number") continue;
    const rate = name === part.unit
      ? 1 : api().factor(name, part.unit, site);
    if (rate === null) continue;
    const min = round(entry.min * rate, 4);
    const max = round(entry.max * rate, 4);
    if (max > min) return { min: min, max: max };
  }
  return complain("bounds no unit of its kind that converts to " +
    part.unit);
}

/*
 * The spec's own bands, empty, in the partition's unit.
 *
 * Anchored at the range's minimum rather than at a multiple of the width,
 * because the minimum is what the spec actually wrote and a grid that
 * started somewhere else would be this file inventing an edge again. The
 * last band is CLIPPED to the maximum rather than overshooting it, so
 * the two outer edges of the drawn axis are exactly the two numbers in
 * the spec.
 */
function gridOf(range, width) {
  if (!(width > 0)) {
    throw new Error("A charted measure needs a bin width in the spec, " +
      "and this one has none - there is no grid without it.");
  }
  if ((range.max - range.min) / width > MAX_BANDS) {
    throw new Error("The spec asks for more than " + MAX_BANDS +
      " bands between " + range.min + " and " + range.max +
      ": widen `bin`, or narrow the range.");
  }
  const bins = [];
  for (let from = range.min; from < range.max - 1e-9;
    from = round(from + width, 4)) {
    bins.push({ from: from, to: round(Math.min(from + width, range.max), 4),
      count: 0 });
  }
  return bins;
}

/*
 * People into bands. A value the spec's own range does not cover lands
 * in the outer band it is nearest rather than falling out of the count.
 *
 * The form refuses such a value, so a record carrying one was written by
 * something other than the form - but it is still somebody's row, and
 * dropping it would leave the drawn counts summing to fewer than the
 * people. The grid cannot grow to meet it either: an edge that moved for
 * one member's number would be that member's number.
 */
function fill(bins, values, range, width) {
  for (const value of values) {
    let index = Math.floor((value - range.min) / width);
    if (index >= bins.length) index = bins.length - 1;
    if (index < 0) index = 0;
    bins[index].count += 1;
  }
}

/*
 * Bands MERGED rather than bucketed, at a raised floor.
 *
 * AT A FLOOR OF 0 THIS IS THE IDENTITY, and deliberately so rather than
 * being skipped: every band clears a floor of zero on its own, so each
 * one is emitted alone and the drawn grid is the spec's grid, empty
 * bands included. One path, exercised at every floor, is why the shipped
 * world and the raised one cannot drift apart.
 *
 * A distribution is ordered and contiguous, so folding its small bands
 * into an "Other" would destroy the shape that makes it worth drawing.
 * Adjacent bands are combined instead until each clears the floor, which
 * keeps the total, keeps the order, and simply makes the tails wider -
 * and the tails are exactly where a lone heaviest or lightest person
 * sits. The outer edges need no further treatment since #371: they are
 * the spec's own two numbers, so a widened tail still ends where the
 * configuration ends and reports nobody.
 *
 * A trailing remainder merges BACKWARDS into the last emitted band
 * rather than being dropped. Dropped, the drawn counts would no longer
 * sum to the people, and the difference is the tail - which is the
 * subtraction this whole file exists to refuse.
 */
function suppressBins(bins, floor) {
  if (!bins.length) return [];
  const out = [];
  let open = null;
  for (const bin of bins) {
    open = open === null
      ? { from: bin.from, to: bin.to, count: bin.count }
      : { from: open.from, to: bin.to, count: open.count + bin.count };
    if (open.count >= floor) {
      out.push(open);
      open = null;
    }
  }
  if (open !== null) {
    if (!out.length) return [];        // the whole set is below the floor
    const last = out[out.length - 1];
    last.to = open.to;
    last.count += open.count;
  }
  return out;
}

/*
 * Categorical counts with every small cell folded into one bucket.
 *
 * THE BUCKET COUNTS PEOPLE, NEVER VALUE-HOLDINGS, and on a
 * multiple-choice field those are different numbers. One member who
 * holds three affiliations feeds a count into three cells, so pooling
 * the COUNTS of small cells clears a floor of five with two people
 * behind it - and the cell that exists to hide those two then describes
 * exactly them, their complete affiliation sets recoverable from it
 * (#351, fix wave 1, finding F1; `roles` is the live instance). So the
 * pool is a set of ACCOUNTS: the members whose every held value is
 * small, meaning no named cell would describe them at all. That set's
 * SIZE is what the floor is applied to, what the absorb loop terminates
 * on, and what the bucket reports.
 *
 * A NAMED CELL NEEDS NO SUCH TREATMENT and is deliberately left alone.
 * heldValues() deduplicates, so a member reaches any one cell at most
 * once and a named cell's count already IS the number of people it
 * describes - on a single-choice field and a multiple-choice one alike.
 * The asymmetry is multiplicity: a person reaches many cells, so only a
 * rule that spans cells has to count people rather than add counts.
 *
 * Subtraction is the attack this survives, not redaction. A reader knows
 * the population, so drawing US 8, GB 5, CA 3 against 24 people
 * discloses CA outright and would also disclose it if CA were simply
 * dropped and the rest left to sum to 21. Everything removed lands in
 * the bucket, so no member falls out of the picture: every one of them
 * is described by a named cell they hold or by the bucket.
 *
 * WHAT IS NOT TRUE, AND WAS CLAIMED HERE, is that the drawn cells sum
 * to the population. They do on a single-choice field, which is what
 * makes the CA subtraction above possible there and is why the bucket
 * exists at all. On a multiple-choice field they sum to HOLDINGS -
 * eighteen members holding twenty-six affiliations are twenty-six drawn
 * counts - and no floor rule changes that.
 *
 * A zero survives. "Nobody here is an admirer" describes no one, so it
 * is neither pooled nor absorbed.
 *
 * THE ABSORB CASCADE, and what it costs. When the pooled set is short
 * of the floor the smallest named cell is absorbed into it and the set
 * is recomputed, until it clears or nothing is left to absorb. Two ways
 * there is then nothing safe to say, and both answer with nothing: the
 * pool never reached the floor; or every cell went into it, leaving one
 * bucket and no breakdown at all. One named cell beside the bucket is
 * fine and is deliberately not rejected - "male 19, Other 5" identifies
 * nobody, and suppressing it would throw away a true and harmless
 * answer. It costs the label its parenthetical too: an absorbed cell
 * had cleared the floor, so the bucket can no longer say every value in
 * it is sub-floor and is named plainly instead - see OTHER_LABEL above,
 * which carries that argument.
 *
 * AN EMPTY POOL STILL RUNS THE CASCADE, which is a ruled choice and the
 * expensive one. On a multiple-choice field every holder of a rare value
 * may also hold a common one, so nobody is hidden and the pooled set is
 * empty - and an empty set is short of the floor, so the cascade eats
 * the named cells and the view answers not-enough. The alternative
 * considered and refused (Prime, 2026-08-18, on this file's fix wave):
 * treat an empty pool as nothing-to-hide and simply drop the small
 * cells. That is redaction, which DESIGN.md, "Charts", names as the
 * thing suppression is not, and the argument that it leaks nothing rests
 * on drawn cells not summing to the population - true here, but a
 * hypothesis about reader arithmetic that nobody has pressure-tested.
 * THE REVISIT TRIGGER: if 0.9-M2-S3 finds the affiliations chart dead on
 * realistic corpora, that evidence goes to the owner as a ruled
 * decision - it is one guard here and one arm in
 * tests/charts-aggregate.test.mjs to flip, and it is not a call a
 * builder makes quietly.
 */
function suppressCounts(cells, keysByAccount, floor) {
  if (!cells.length) return [];

  const kept = [];
  const pooled = new Set();
  for (const cell of cells) {
    if (cell.count === 0 || cell.count >= floor) kept.push(cell);
    else pooled.add(cell.value);
  }
  /* At a floor of 0 nothing is ever pooled, so this is where the whole
     fold turns itself off: the cells go out exactly as they were counted
     - every value of the spec, exact, zeros included - which is the
     group makeup the #243 ruling asks for. */
  if (!pooled.size) return cells;

  /* The members no named cell would describe: every value they hold is
     in the pool. Recomputed after each absorption rather than unioned
     in, so one predicate decides the whole thing and an absorbed cell's
     holders count only if the pool really covers everything they hold. */
  const hidden = () => {
    const out = new Set();
    for (const [account, keys] of keysByAccount) {
      if (keys.every((key) => pooled.has(key))) out.add(account);
    }
    return out;
  };

  let behind = hidden();
  /* Whether a floor-cleared value is now folded in here, which is
     exactly the condition the label's parenthetical is false under. The
     cascade is the only thing that can put one in the pool - everything
     above it was sub-floor when it went in - so the flag belongs to the
     loop rather than to a re-examination of the pool afterwards. */
  let absorbed = false;
  while (behind.size < floor) {
    let index = -1;
    for (let i = 0; i < kept.length; i += 1) {
      if (kept[i].count === 0) continue;
      if (index === -1 || kept[i].count < kept[index].count) index = i;
    }
    if (index === -1) break;
    pooled.add(kept[index].value);
    kept.splice(index, 1);
    absorbed = true;
    behind = hidden();
  }

  const named = kept.filter((cell) => cell.count > 0);
  if (behind.size < floor || !named.length) return [];

  return kept.concat([{ value: null,
    label: absorbed ? OTHER_LABEL : allSmallLabel(floor),
    count: behind.size, bucket: "other" }]);
}

/* ------------------------------------------------------------------ */
/* The answer.                                                          */

/* The caller's own question, handed back. Names and labels only: the
   spec's numbers - a bin width, a rounding place - stay out, so a
   not-enough answer carries no number but the floor. */
function echoMeasure(measure) {
  return { name: measure.name, label: measure.label, term: measure.term,
    kind: measure.kind };
}

/*
 * The filter, ECHOED AND NEVER ENUMERATED (mandate 5).
 *
 * The caller is handed back the value they sent and nothing beside it.
 * Listing the genders, affiliations or countries the group actually
 * holds would be the membership oracle DESIGN.md, "The identifier is the
 * whole problem", turns the whole store on - reachable with one request
 * and no floor in the way, because a list of which values EXIST is not a
 * cell and no suppression rule would ever have looked at it.
 *
 * A measure's own drawn cells do name values, and that is not the same
 * thing: a cell is the chart, and every drawn cell has already cleared
 * the floor.
 */
function echoFilter(filter) {
  return filter === null
    ? { field: null, value: null }
    : { field: filter.field, value: filter.value };
}

/*
 * What nothing to draw looks like, and it is ONE document (mandate 4).
 *
 * A view with nobody in it, a filter value nobody holds, a measure
 * nobody in the view answered - and, at any raised floor, a group below
 * it - all arrive here and leave with the same bytes: same status, same
 * sentence, no counts, no partition, no band residue, no group makeup.
 * Telling any two of those apart would answer "does anybody in this
 * group hold that value", which is the question a floor exists to
 * refuse, asked from outside the data. At the shipped floor of 0 only
 * the empty cases can reach it, and that is ruling 7's "the only refusal
 * state left" - but the shape is written for both worlds, because the
 * setting is a number an admin can move.
 *
 * The floor it reports is the floor it applied, which is the one number
 * in the document. A caller may read it off any drawn view anyway.
 */
function notEnough(ask, floor) {
  return {
    ok: true,
    measure: echoMeasure(ask.measure),
    filter: echoFilter(ask.filter),
    floor: floor,
    enough: false,
    note: NOT_ENOUGH,
    units: null,
    trend: null,
    distribution: null,
    groups: null,
  };
}

/* One row per person: the newest they have, by the receipt time this
   side attested to, with the row id as a stable tie-break. */
function latestPerAccount(rows) {
  const latest = new Map();
  for (const row of rows) {
    const held = latest.get(row.accountId);
    if (!held || row.receivedAt > held.receivedAt ||
        (row.receivedAt === held.receivedAt && row.id > held.id)) {
      latest.set(row.accountId, row);
    }
  }
  return latest;
}

/*
 * Whether one person is in this view.
 *
 * Decided on their CURRENT record, for both pictures. Placing somebody
 * by whatever they held at the time of each row instead would let the
 * population move underneath the trend line, so a change in the group's
 * average could be a change in who is being averaged - a chart that
 * cannot be read is worse than one that is coarse.
 */
function matches(record, filter) {
  if (filter === null) return true;
  return heldValues(filter.measure, record).indexOf(filter.value) !== -1;
}

/* The unit each system labels its axis in. Config, not data. */
function unitsFor(measure, site) {
  const out = {};
  for (const system of site.units.systems) {
    out[system] = { unit: measure.unitful ? measure.units[system].unit : null };
  }
  return out;
}

/*
 * The distribution: the spec's own bands, filled, then reduced by
 * whatever floor was given.
 *
 * THE GRID IS BUILT BEFORE THE VALUES ARE READ, which is the order that
 * makes the edges independent of the group rather than merely intended
 * to be. It also means a spec that charts a field it gave no range
 * throws whether or not anybody answered that field, so a fork learns
 * about it from the first request rather than from the first member.
 *
 * A view where nobody has a value for this measure draws NOTHING rather
 * than a grid of zeros: an empty band inside a drawn chart says "nobody
 * here weighs that", and a whole chart of them would say "nobody
 * answered" in a shape that looks like an answer.
 */
function binsOf(people, measure, site, part, floor) {
  const range = rangeOf(measure, part, site);
  const bins = gridOf(range, part.bin);

  const values = [];
  for (const person of people) {
    const value = valueFor(measure, person.record, site, part);
    if (value !== null) values.push(value);
  }
  if (!values.length) return null;
  fill(bins, values, range, part.bin);

  const merged = suppressBins(bins, floor);
  if (!merged.length) return null;

  return {
    kind: "bins",
    partition: { system: part.system, unit: part.unit, band: part.band },
    bins: merged.map((bin) => ({
      count: bin.count,
      from: spread(bin.from, measure, site, part),
      to: spread(bin.to, measure, site, part),
    })),
  };
}

/*
 * One category's count lines: how many UNIQUE MEMBERS hold each value
 * the spec lists, by their most recent current entry.
 *
 * `people` is one row per account already, and it is the row that is
 * current for them - so a member with three entries is counted once and
 * the category their newest entry names is the one they are counted in.
 *
 * ZEROS ARE LINES (owner ruling 1, #243). "Nobody here is an admirer"
 * describes nobody, and printing it is what stops a reader inferring the
 * missing values themselves. A field whose choices live outside the spec
 * - the country list is the one - can have no zeros listed, because the
 * list is not here to enumerate; what the group holds is what it
 * carries, which is the same disclosure a drawn cell always was.
 *
 * THE BLANK IS ALWAYS A LINE TOO, even at zero. A chart without it
 * claims a completeness the data does not have: "60% male" reads very
 * differently from "60% of the third who answered".
 */
function cellsOf(people, measure, floor) {
  const counts = new Map();
  const labels = new Map();
  for (const choice of measure.choices || []) {
    counts.set(choice.value, 0);           // a zero survives
    labels.set(choice.value, choice.label);
  }

  /* Which cells each PERSON lands in, carried beside the counts because
     the floor is applied to people and a multiple-choice member lands in
     several. The blank cell is one of them, keyed by null exactly as the
     answer keys it, so somebody who stated nothing is a member the
     bucket can stand for rather than a hole in the bookkeeping. `people`
     is one row per account already, so the account is the key. */
  const keysByAccount = new Map();

  let blank = 0;
  for (const person of people) {
    const held = heldValues(measure, person.record);
    if (!held.length) {
      blank += 1;
      keysByAccount.set(person.accountId, [null]);
      continue;
    }
    keysByAccount.set(person.accountId, held);
    for (const value of held) counts.set(value, (counts.get(value) || 0) + 1);
  }

  const cells = Array.from(counts, (pair) => ({
    value: pair[0],
    /* A list that lives elsewhere has no label here, so the value stands
       in for it and the page that holds the list renders the name. That
       keeps 250 country names out of a response nobody needs them in. */
    label: labels.has(pair[0]) ? labels.get(pair[0]) : pair[0],
    count: pair[1],
    bucket: null,
  })).sort((a, b) => b.count - a.count ||
    String(a.value).localeCompare(String(b.value)));

  cells.push({ value: null, label: NOT_STATED_LABEL, count: blank,
    bucket: "blank" });

  return suppressCounts(cells, keysByAccount, floor);
}

/*
 * The group makeup: one block per categorical field, over the people
 * this view is about.
 *
 * IT DESCRIBES THE FILTERED VIEW, not the whole binder, because it is
 * part of one answer about one group - "who is in this view" beside
 * "what this view weighs". A block computed over everybody would be a
 * second population inside a document about the first, and a reader
 * could difference the two.
 *
 * `multiple` rides along because it changes how the numbers read: on a
 * field a member may answer more than once the lines sum to holdings
 * rather than to people, and a page that printed a total without knowing
 * which would print a wrong one. Every individual line is still a count
 * of people either way - heldValues() deduplicates, so a member reaches
 * any one line at most once.
 *
 * An empty list is a real answer at a raised floor: it means nothing
 * about that category could be said. At the shipped floor of 0 it cannot
 * happen, since nothing is ever pooled.
 */
function makeupOf(people, site, floor) {
  const out = [];
  for (const one of api().measures(site)) {
    if (one.kind !== "categorical") continue;
    out.push({
      field: one.name,
      label: one.label,
      term: one.term,
      multiple: one.multiple === true,
      values: cellsOf(people, one, floor),
    });
  }
  return out;
}

/*
 * The trend: one point per period, and whatever floor was given applies
 * to a point exactly as it does to a cell.
 *
 * AT THE SHIPPED FLOOR OF 0 EVERY MONTH WITH AN ENTRY DRAWS ITS TRUE
 * MEAN (owner ruling 6, #243), one-person months included. A month
 * nobody submitted in carries no point, because there is nothing to
 * average - that is an absence of data rather than a suppression, and
 * the ruling's unbroken line is drawn by bridging it on the page. The
 * route must not fake it: a bridged value invented here would be
 * indistinguishable from a real one in the response as well as on the
 * screen.
 *
 * AT A RAISED FLOOR a period fewer than the floor submitted in is the
 * chart of one person DESIGN.md, "Charts", refuses, and it is DROPPED
 * rather than zeroed - a zero would be a drawn point asserting something
 * about those people, and a gap in the key sequence would tell a reader
 * exactly which periods were withheld. Both cases are the one comparison
 * below, which is why they cannot come apart.
 *
 * One row per person per period, newest wins. Somebody who corrects
 * twice in a month is one person in that month's average, for the same
 * reason they are one person in a cell.
 */
function trendOf(rows, accounts, measure, site, part, floor) {
  const periods = new Map();
  for (const row of rows) {
    if (!accounts.has(row.accountId)) continue;
    const found = PERIOD.exec(String(row.receivedAt));
    if (!found) continue;
    let inPeriod = periods.get(found[1]);
    if (!inPeriod) {
      inPeriod = new Map();
      periods.set(found[1], inPeriod);
    }
    const held = inPeriod.get(row.accountId);
    if (!held || row.receivedAt > held.receivedAt ||
        (row.receivedAt === held.receivedAt && row.id > held.id)) {
      inPeriod.set(row.accountId, row);
    }
  }

  const points = [];
  for (const period of Array.from(periods.keys()).sort()) {
    const values = [];
    for (const row of periods.get(period).values()) {
      const value = valueFor(measure, row.record, site, part);
      if (value !== null) values.push(value);
    }
    if (!values.length || values.length < floor) continue;
    let total = 0;
    for (const value of values) total += value;
    points.push({
      period: period,
      people: values.length,
      /* The line is the mean and it is called "average" - DESIGN.md,
         "Charts": no statistics vocabulary anywhere on the page, and the
         name a route gives a field is what a page ends up printing. */
      average: spread(round(total / values.length, 1), measure, site, part),
    });
  }
  return { points: points };
}

/*
 * The group's answer, reduced by the floor it was given.
 *
 * FOUR ARGUMENTS, AND THE FOURTH IS THE WHOLE SEAM. `settings` is the
 * server's own settings object and floorOf() is the only thing that
 * reads it; every helper above takes the floor as an argument rather
 * than reaching for a module value, so one answer applies one floor from
 * end to end and a later caller cannot half-raise it. The mandate that
 * no caller may lower the floor is unchanged and is enforced where it
 * belongs rather than by the shape of this line: askFor()'s parameter
 * set is closed, so nothing anybody sends reaches this argument.
 *
 * ZERO PEOPLE IS ALWAYS NOTHING TO DRAW, whatever the floor, and it is
 * the one refusal left at the shipped default (ruling 7). It is written
 * as its own comparison rather than folded into the floor test, because
 * at a floor of 0 the floor test alone would let an empty view through
 * and answer a chart of nobody.
 *
 * `rows` are ALREADY-OPENED, already-current rows - the tombstones are
 * excluded by the statement that read them, because whether a row is
 * superseded is answerable in the clear and opening a corrected row to
 * throw it away is work for nothing.
 */
function aggregate(rows, ask, spec, settings) {
  const site = siteSpec(spec);
  const floor = floorOf(settings);
  const part = partitionOf(ask.measure, site);

  const people = [];
  const accounts = new Set();
  for (const row of latestPerAccount(rows).values()) {
    if (!matches(row.record, ask.filter)) continue;
    people.push(row);
    accounts.add(row.accountId);
  }
  if (!accounts.size || accounts.size < floor) return notEnough(ask, floor);

  const distribution = binsOf(people, ask.measure, site, part, floor);
  if (distribution === null) return notEnough(ask, floor);

  return {
    ok: true,
    measure: echoMeasure(ask.measure),
    filter: echoFilter(ask.filter),
    floor: floor,
    enough: true,
    note: null,
    units: unitsFor(ask.measure, site),
    trend: trendOf(rows, accounts, ask.measure, site, part, floor),
    distribution: distribution,
    groups: makeupOf(people, site, floor),
  };
}

/*
 * The member's own line, and the only function here with no floor.
 *
 * DESIGN.md, "Charts": "A member may draw their own line over the group
 * trend" - their data, their line, so no suppression applies to it.
 *
 * KEYED BY THE SESSION'S ACCOUNT AND BY NOTHING ELSE (mandate 3).
 * `accountId` comes from the session row and the shape is asserted here
 * rather than trusted: sixty-four lowercase hex characters, the same
 * account-id HMAC every stored row carries. Nothing on the wire reaches
 * this argument - askFor() refuses any parameter that could carry an
 * identity - and this throw is the second lock on that door. It throws
 * rather than refusing quietly because on a Worker serving real members
 * it can only fire on a bug, and a bug that draws somebody else's line
 * must be loud.
 *
 * IT DOES NOT ROUTE THROUGH THE GROUP AGGREGATOR and its result goes in
 * its own field. Merging one member's unfloored points into a group
 * series would put a cell of one person inside a document every other
 * rule here reduced.
 *
 * THE FILTER IS NOT APPLIED. The overlay is the caller's own history,
 * which they can already read in full at GET /my-entries, so narrowing
 * it by the group filter would buy no privacy and would make their line
 * appear and disappear as they changed the group they were comparing
 * themselves to.
 */
function selfSeries(rows, accountId, ask, spec) {
  if (!ask.self) return null;
  if (typeof accountId !== "string" || !ACCOUNT_ID.test(accountId)) {
    throw new Error("the overlay's identity is not an account-id HMAC");
  }
  const site = siteSpec(spec);
  const part = partitionOf(ask.measure, site);
  const mine = rows.filter((row) => row.accountId === accountId)
    .sort((a, b) => a.receivedAt < b.receivedAt ? -1
      : a.receivedAt > b.receivedAt ? 1 : a.id - b.id);

  const points = [];
  for (const row of mine) {
    const value = valueFor(ask.measure, row.record, site, part);
    if (value === null) continue;
    points.push({ at: row.receivedAt,
      value: spread(value, ask.measure, site, part) });
  }
  return { points: points };
}

export { DEFAULT_FLOOR, askFor, aggregate, selfSeries };
