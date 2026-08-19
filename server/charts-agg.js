/*
 * THE ONE ROWS-TO-SERIES PATH. Opened rows in, one floored answer out.
 *
 * DESIGN.md, "Charts": the Worker aggregates on request, and the
 * disclosure rules that governed the published document govern the live
 * one "because they were always about what a reader can reconstruct
 * rather than about publishing". This file is where every one of those
 * rules is decided. server/worker.js's GET /charts handler reads the
 * database, opens the ciphertext and serializes what this file returns -
 * it computes no cell of its own, and there is deliberately no second
 * path a later route could reach for.
 *
 * THE FLOOR IS APPLIED BEFORE ANYTHING LEAVES. Every exported function
 * that touches a group returns output the floor has already reduced, so
 * a caller cannot hold an unfloored intermediate. That is the whole
 * reason the split is a module boundary rather than two functions in
 * worker.js: a handler holding raw counts is one `if` away from printing
 * them.
 *
 * THE FLOOR IS A CONSTANT HERE AND TAKES NO INPUT. FLOOR below is 5,
 * carried across from MIN_CELL in apps/web/dashboard.js exactly as
 * DESIGN.md, "Admin surfaces", instructs the Worker's writer to carry it.
 * Nothing on the wire can lower it: aggregate() has no floor parameter,
 * askFor() refuses a query parameter it does not know rather than
 * ignoring one, and no helper below accepts a floor argument. The shape
 * this deliberately does NOT copy is the pre-0.9 dashboard's
 * `floor = identify ? 0 : MIN_CELL` - one caller-chosen flag that turned
 * suppression off wholesale. The floor becomes an admin-editable Setting
 * at 0.9-M3; until then it is this constant and nothing else.
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
 * Every rule here is about what ONE response discloses. A reader who
 * keeps several responses can still subtract one from another - two
 * views of the same measure under different filters, or the same view at
 * two times. DESIGN.md, "Charts", takes that channel knowingly: the
 * owner ruled on #153 to accept cumulative disclosure rather than charge
 * every member the mean's real value to close it, and the ruling's
 * premise is a members-only readership, which the session gate on
 * GET /charts preserves. The premise is the thing to re-take if that
 * readership ever widens.
 */
import "../apps/web/site.config.js";
import "../apps/web/fields.js";

/*
 * The smallest number of PEOPLE a drawn cell, bin or trend point may
 * describe. Five, carried from apps/web/dashboard.js's MIN_CELL per
 * DESIGN.md, "Admin surfaces" - the file holding it today is one the 0.9
 * rebuild deletes, and this is the copy that outlives it.
 *
 * People rather than rows, everywhere, and the distinction IS the floor.
 * One member submitting five times is one member; a floor that counted
 * rows would let a single person clear it by filling the form in five
 * times, which is exactly the disclosure it exists to prevent.
 */
const FLOOR = 5;

/*
 * What the fold is called. It names the floor rather than any value a
 * member holds - mandate 5's "the Other label carries no member-typed
 * values" - and the floor is in the answer beside it anyway.
 */
const OTHER_LABEL = "Other (fewer than " + FLOOR + ")";

/*
 * The blanks keep their own cell rather than being dropped. A chart
 * without them claims a completeness the data does not have: "60% male"
 * reads very differently from "60% of the third who answered".
 */
const NOT_STATED_LABEL = "Not stated";

/*
 * The honest sentence, and the ONLY thing a cut below the floor says.
 *
 * DESIGN.md, "Charts", rules that a cut below the floor answers this
 * rather than an error - "which is the honest sentence and not an
 * error". It is one
 * constant rather than a string built per case, because the whole point
 * is that a group too small to draw and a filter value nobody in the
 * group holds are indistinguishable - same status, same sentence, same
 * document. A second spelling for one of them would be the oracle.
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

  const measures = fields.measures(site);
  const wanted = params.get("measure");
  const measure = measures.filter((one) => one.name === wanted)[0];
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
 * Equal-width bins across the data's own range, rounded outward to the
 * bin width so the axis reads in round numbers. The edges are multiples
 * of the width rather than the smallest and largest values in the group:
 * an edge fitted to the data reports somebody's real weight, which is
 * the same leak the partition rule closes, arrived at from the opposite
 * direction.
 *
 * QUANTIZING IS NOT ENOUGH FOR THE TWO OUTER EDGES, and this comment
 * claimed it was. The bin an outer edge is rounded to still derives from
 * one person - the heaviest, the lightest - so it reports that member's
 * BAND rather than their number, and a band is a person to anyone who
 * knows her (#351, fix wave 1, finding F2). The range computed here is
 * therefore internal: binsOf() below reports the two ends as open and
 * only the inner boundaries as numbers. What quantizing does close is
 * every edge between two floor-cleared bins, which is all of them once
 * the ends are gone.
 */
function histogram(values, binWidth) {
  if (!values.length || !(binWidth > 0)) return [];
  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  const start = Math.floor(low / binWidth) * binWidth;
  const end = Math.ceil((high + 0.000001) / binWidth) * binWidth;
  const bins = [];
  for (let from = start; from < end; from += binWidth) {
    bins.push({ from: round(from, 4), to: round(from + binWidth, 4),
      count: 0 });
  }
  if (!bins.length) return [];
  for (const value of values) {
    let index = Math.floor((value - start) / binWidth);
    if (index >= bins.length) index = bins.length - 1;   // the top edge
    if (index < 0) index = 0;
    bins[index].count += 1;
  }
  return bins;
}

/*
 * Histogram bins MERGED rather than bucketed.
 *
 * A histogram is ordered and contiguous, so folding its small bins into
 * an "Other" would destroy the shape that makes it worth drawing.
 * Adjacent bins are combined instead until each clears the floor, which
 * keeps the total, keeps the order, and simply makes the tails wider -
 * and the tails are exactly where a lone heaviest or lightest person
 * sits. Widening is not the whole defense there: the two edges at the
 * very ends of the drawn range are reported as open rather than as
 * numbers, because however wide the tail bin is, its outer boundary
 * still derives from that one person. See openEdge() below.
 *
 * A trailing remainder merges BACKWARDS into the last emitted bin rather
 * than being dropped. Dropped, the drawn counts would no longer sum to
 * the people, and the difference is the tail - which is the subtraction
 * this whole file exists to refuse.
 */
function suppressBins(bins) {
  if (!bins.length) return [];
  const out = [];
  let open = null;
  for (const bin of bins) {
    open = open === null
      ? { from: bin.from, to: bin.to, count: bin.count }
      : { from: open.from, to: bin.to, count: open.count + bin.count };
    if (open.count >= FLOOR) {
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
 * answer.
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
function suppressCounts(cells, keysByAccount) {
  if (!cells.length) return [];

  const kept = [];
  const pooled = new Set();
  for (const cell of cells) {
    if (cell.count === 0 || cell.count >= FLOOR) kept.push(cell);
    else pooled.add(cell.value);
  }
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
  while (behind.size < FLOOR) {
    let index = -1;
    for (let i = 0; i < kept.length; i += 1) {
      if (kept[i].count === 0) continue;
      if (index === -1 || kept[i].count < kept[index].count) index = i;
    }
    if (index === -1) break;
    pooled.add(kept[index].value);
    kept.splice(index, 1);
    behind = hidden();
  }

  const named = kept.filter((cell) => cell.count > 0);
  if (behind.size < FLOOR || !named.length) return [];

  return kept.concat([{ value: null, label: OTHER_LABEL, count: behind.size,
    bucket: "other" }]);
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
 * What too few people looks like, and it is ONE document (mandate 4).
 *
 * A group below the floor, a filter value nobody holds, and a measure
 * nobody in the view answered all arrive here and leave with the same
 * bytes: same status, same sentence, no counts, no partition, no bin
 * residue. Telling any two of those apart would answer "does anybody in
 * this group hold that value" - which is the question the floor exists
 * to refuse, asked from outside the data.
 */
function notEnough(ask) {
  return {
    ok: true,
    measure: echoMeasure(ask.measure),
    filter: echoFilter(ask.filter),
    floor: FLOOR,
    enough: false,
    note: NOT_ENOUGH,
    units: null,
    trend: null,
    distribution: null,
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
 * The edge that says nothing, for the two ends of the drawn range.
 *
 * Every drawn bin clears the floor, but the range's OUTER edges derive
 * from exactly one person at each end: a top edge of 460 lb over a group
 * whose next heaviest is 200 reports one member's band, and rounding it
 * to the grid only decides how wide that band is (#351, fix wave 1,
 * finding F2, ruled by Prime). "A weight and a height and a country is a
 * person to anyone who knows her" is the test, and an outer edge fails
 * it while meeting every counting criterion.
 *
 * The INNER edges stay. Each is a boundary between two bins that each
 * cleared the floor, so it says only that at least the floor's number of
 * people sit on either side of it.
 *
 * SAME SHAPE, NULL CONTENTS, in every system - so a page reads
 * `to[system] === null` and prints "and up" rather than switching on a
 * missing field, and so nothing downstream has to learn a second edge
 * type. 0.9-M2-S3 renders these as "under X" and "X and up".
 *
 * A single drawn bin therefore has two open ends and no numbers at all:
 * it says how many people answered and nothing about where they sit,
 * which is the honest reading of a range whose every edge is an outer
 * one.
 */
function openEdge(site) {
  const out = {};
  for (const system of site.units.systems) out[system] = null;
  return out;
}

function binsOf(people, measure, site, part) {
  const values = [];
  for (const person of people) {
    const value = valueFor(measure, person.record, site, part);
    if (value !== null) values.push(value);
  }
  const merged = suppressBins(histogram(values, part.bin));
  if (!merged.length) return null;

  const last = merged.length - 1;
  return {
    kind: "bins",
    partition: { system: part.system, unit: part.unit, band: part.band },
    bins: merged.map((bin, index) => ({
      count: bin.count,
      from: index === 0
        ? openEdge(site) : spread(bin.from, measure, site, part),
      to: index === last
        ? openEdge(site) : spread(bin.to, measure, site, part),
    })),
  };
}

function cellsOf(people, measure) {
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

  if (blank > 0) {
    cells.push({ value: null, label: NOT_STATED_LABEL, count: blank,
      bucket: "blank" });
  }

  const drawn = suppressCounts(cells, keysByAccount);
  return drawn.length ? { kind: "cells", cells: drawn } : null;
}

/*
 * The trend: one point per period, and the floor applies to a point
 * exactly as it does to a cell.
 *
 * A trend of one line is a chart of one person - DESIGN.md, "Charts",
 * puts it as "so the floor applies to lines as it does to cells". A
 * point is an average over the
 * people who submitted in that period, so a period fewer than the floor
 * submitted in IS that chart of one person, and it is DROPPED rather
 * than zeroed - a zero would be a drawn cell asserting something about
 * those people, and a gap in the key sequence would tell a reader
 * exactly which periods were withheld.
 *
 * One row per person per period, newest wins. Somebody who corrects
 * twice in a month is one person in that month's average, for the same
 * reason they are one person in a cell.
 */
function trendOf(rows, accounts, measure, site, part) {
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
    if (values.length < FLOOR) continue;
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
 * The group's answer, floored.
 *
 * THREE ARGUMENTS AND NO FOURTH. There is no floor parameter and there
 * is deliberately no room for one: the signature is the mandate in a
 * form a reader cannot miss, and every helper above reads FLOOR directly
 * rather than taking it, so no caller anywhere in this file can pass a
 * different one.
 *
 * `rows` are ALREADY-OPENED, already-current rows - the tombstones are
 * excluded by the statement that read them, because whether a row is
 * superseded is answerable in the clear and opening a corrected row to
 * throw it away is work for nothing.
 */
function aggregate(rows, ask, spec) {
  const site = siteSpec(spec);
  const part = partitionOf(ask.measure, site);

  const people = [];
  const accounts = new Set();
  for (const row of latestPerAccount(rows).values()) {
    if (!matches(row.record, ask.filter)) continue;
    people.push(row);
    accounts.add(row.accountId);
  }
  if (accounts.size < FLOOR) return notEnough(ask);

  const distribution = ask.measure.kind === "categorical"
    ? cellsOf(people, ask.measure)
    : binsOf(people, ask.measure, site, part);
  if (distribution === null) return notEnough(ask);

  return {
    ok: true,
    measure: echoMeasure(ask.measure),
    filter: echoFilter(ask.filter),
    floor: FLOOR,
    enough: true,
    note: null,
    units: unitsFor(ask.measure, site),
    /* A category has no average over time, so there is no line to draw
       and the honest answer is that there is none - not an empty one,
       which a page would render as a chart with nothing in it. */
    trend: ask.measure.kind === "categorical"
      ? null : trendOf(rows, accounts, ask.measure, site, part),
    distribution: distribution,
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
  /* A category is not a line. An empty series rather than null, so the
     page can tell "asked for and there is nothing" from "not asked". */
  if (ask.measure.kind === "categorical") return { points: [] };

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

export { FLOOR, askFor, aggregate, selfSeries };
