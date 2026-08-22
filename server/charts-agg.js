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
 * COMBINED FILTERS SHARPEN THAT AND WERE RULED THE SAME WAY. #384's
 * chips AND several predicates together, and two chips can isolate a
 * member a single one cannot. Put to the owner adversarially at that
 * sitting and re-accepted in the same words: the same rule, exact at
 * floor 0, and the floor SETTING is the protection any group can choose.
 * There is deliberately no second privacy rule for a combined view - it
 * is this one over fewer people, and above a floor of 0 an intersection
 * too small to draw gets the identical document a whole population that
 * small gets.
 *
 * NOTHING WAS RIPPED OUT. The Other bucket, person-pooling and band
 * merging all still stand below and all obey whatever floor they are
 * given; at 0 each of them is the IDENTITY - reached by the same code
 * path a raised floor takes, rather than skipped. The way back is a
 * number, which is why tests/charts-aggregate.test.mjs still proves the
 * whole machinery at a floor of 5 rather than deleting those arms.
 *
 * THE ONE-PARTITION RULE IS STILL HERE AND IT IS NOW ENFORCED BY A
 * LOCK. Its subject never changes: a group must never be sliced two
 * ways at once, because two independently-binned unit systems can be
 * overlaid into a finer reading than either of them gives - two step
 * functions on one axis, differenced at every interleaved edge.
 *
 * What changed is HOW it is held (owner ruling, the 2026-08-21 axis
 * sitting, #396, and the ruling that followed the escalation on it).
 * Bands are binned in the unit a member is LOOKING AT, so that the
 * numbers under the axis are round in the unit they are read in - which
 * means both systems really are their own grids, and the old shape (one
 * partition reported under converted edges) is gone. In its place:
 *
 *   floor 0    both systems are served. There is nothing to difference
 *              back to, because every band already draws its true
 *              count: a reader keeping two documents learns what a
 *              reader keeping one already knew.
 *   floor > 0  systemFor() below LOCKS the answer to a single system,
 *              read from the same settings object the floor arrives
 *              through, whatever the ask says. One slicing exists, so
 *              there is no second grid to overlay - the protection is
 *              structural rather than a rule about what a caller may
 *              request.
 *
 * The lock is therefore a suppression-machinery rule after all, which
 * is the opposite of what #371's finding F1 concluded about the shape
 * that stood here - and correctly so of THAT shape, which took no floor
 * at all. tests/charts-aggregate.test.mjs runs the overlay attack as an
 * instrument rather than describing it: it recovers sub-floor cells
 * from two answers computed under two different locks, then turns the
 * same instrument on the pair a caller can actually obtain inside one
 * deployment and finds nothing.
 *
 * THE FLOOR ARRIVES THROUGH ONE SEAM AND THE WIRE IS NOT IT.
 * aggregate()'s fourth argument is a SETTINGS OBJECT read on the server
 * side; floorOf() below is the only thing that interprets `floor`, and
 * it takes a whole non-negative number or falls back to the default.
 * lockedSystem() reads the second setting the same object carries -
 * which unit system a floor-protected view is served in - by the same
 * rule: a name the spec offers, or the default. The Settings page
 * carries the two side by side, because they are one decision, and what
 * fills the object is server/worker.js's chartSettings(env), which
 * reads both from `site_content` - the single call site an admin's
 * write reaches. Nothing a caller sends can reach either: askFor()
 * refuses a query parameter it does not know rather than ignoring one,
 * so `?floor=1` is a refusal a caller can see, and the `units`
 * parameter it DOES accept is overridden by the lock rather than
 * honored. The shape this deliberately does NOT copy is the pre-0.9
 * dashboard's `floor = identify ? 0 : MIN_CELL` - a caller-chosen flag
 * on the wire that turned suppression off wholesale.
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
 * WHAT THE ANSWER CARRIES, reshaped by #371, again by #396 and again by
 * #438. This is the RESPONSE CONTRACT, stated whole here rather than
 * only inside the functions that build it: the page's builder reads this
 * header, and a shape they have to reconstruct from suppressBins() and a
 * spec comment is a shape they will get wrong (#371, the S10 review,
 * finding F3).
 *
 *   filters        THE CALLER'S OWN PREDICATES, HANDED BACK - a LIST of
 *                  `{ field, value }` in the order they were asked, and
 *                  EMPTY for Everyone. Every count uses this one shape,
 *                  including none and one, so a page never reads a key
 *                  that exists only at a particular count (#438; it
 *                  replaced a single `filter` pair that read
 *                  `{ field: null, value: null }` when nothing was
 *                  filtered). It is an echo and never an enumeration -
 *                  echoFilters() below carries why that distinction is
 *                  the whole of mandate 5.
 *
 *   ONE ANSWER IS IN ONE UNIT SYSTEM AND CARRIES NO OTHER READING OF
 *   ITSELF. Every number below - a band edge, a trend average, a self
 *   point - is a plain number in the unit `units` names, never a table
 *   keyed by unit system. The system rides the ASK (`units=metric`,
 *   `units=imperial`, or absent for the spec's default), so switching
 *   units is a fresh question rather than a different key of the same
 *   document, and the page NEVER re-bins: every drawn number is one of
 *   these, verbatim, index for index. A raised floor overrides the ask
 *   and serves the locked system instead - see the one-partition
 *   paragraph above.
 *
 *   units          `{ system, unit, locked }` on a drawn answer, null
 *                  on one that draws nothing. `system` is the system
 *                  this answer is expressed in - the ask's, or the
 *                  lock's. `unit` is what its axis is labeled in, and
 *                  is null for a unitless measure (a computed BMI, a
 *                  plain count). `locked` is true when a raised floor
 *                  chose the system rather than the caller, which is
 *                  what lets a page disable its units toggle and say
 *                  why instead of leaving a control that cannot move.
 *
 *   distribution   fixed bands over the field spec's own min, max and
 *                  bin width, IN THE UNIT ABOVE. Categories are never
 *                  bands.
 *
 *                  BAND EDGES ARE MULTIPLES OF THE BAND WIDTH, measured
 *                  from that unit's own `anchor` in
 *                  apps/web/site.config.js - and the spec's outer
 *                  bounds are SNAPPED OUTWARD onto the same grid before
 *                  any band is built. Outward, so the drawn axis still
 *                  covers every value the spec's bounds admit. This is
 *                  what lets a page put round numbers under the axis
 *                  without inventing one: every tick it paints is an
 *                  edge that arrived here (owner ruling 3, #396).
 *
 *                  EVERY BAND THE SPEC ASKS FOR IS PRESENT, THE EMPTY
 *                  ONES INCLUDED, each reading `count: 0` - THIS FILE'S
 *                  OWN CONTRACT NEVER DROPS OR REBUILDS A BAND, at any
 *                  floor: the answer is the whole spec grid, always.
 *
 *                  WHAT THE PAGE DRAWS FROM IT IS A LATER, PAGE-SIDE
 *                  DECISION (owner ruling, the 2026-08-20 sitting,
 *                  #390): at the shipped floor of 0, apps/web/charts.js
 *                  stops PAINTING past the band holding the data's own
 *                  maximum - it drops the trailing empty bands off the
 *                  back, keeps every leading empty band (the chart
 *                  still starts at the spec minimum), and draws the
 *                  whole grid when no band has a count (nothing to
 *                  anchor a trim on). A RAISED FLOOR MAKES THAT TRIM A
 *                  NO-OP: suppressBins() below merges a trailing
 *                  remainder BACKWARDS into the last emitted band
 *                  rather than dropping it, so once the floor is above
 *                  0 the last band in the answer always carries a
 *                  nonzero count and the page's own trim finds nothing
 *                  to drop - which is exactly how a raised floor hides
 *                  whether the group's single heaviest member sits near
 *                  the spec ceiling or far below it.
 *
 *                  THE TWO OUTER EDGES ARE THE SPEC'S OWN MINIMUM AND
 *                  MAXIMUM SNAPPED ONTO THE GRID - `bins[0].from` and
 *                  the last band's `to` - and no edge is ever null: the
 *                  open edge #351 needed died with the data-derived
 *                  edge that made it necessary.
 *
 *                  A view where nobody has a value for the measure
 *                  draws NOTHING - `distribution: null` and the honest
 *                  sentence - which is a different answer from a grid
 *                  whose bands all read zero, and the page has to tell
 *                  them apart.
 *
 *   trend          one point per month, the mean of the people who
 *                  submitted in it. A month nobody submitted in carries
 *                  NO POINT; bridging the gap so the line is unbroken
 *                  is the page's job, because a value invented here
 *                  would be indistinguishable from a measured one.
 *
 *   groups         the GROUP-MAKEUP block: one entry per categorical
 *                  field, `{ field, label, term, multiple, values }`,
 *                  and `values` is that field's count lines. This is
 *                  where gender, affiliation and country live now - as
 *                  plain counts of unique members rather than as an
 *                  axis. `multiple` is there because it changes how the
 *                  lines read: on a field a member may answer more than
 *                  once they sum to holdings rather than to people.
 *
 *                  EVERY VALUE THE SPEC LISTS IS A LINE, the ones
 *                  nobody holds included, reading `count: 0` - printing
 *                  them is what stops a reader inferring the missing
 *                  values themselves. A line is
 *                  `{ value, label, count, bucket }`.
 *
 *                  THE BLANK IS ALWAYS A LINE TOO, `value: null` with
 *                  `bucket: "blank"`, even at zero: a chart without it
 *                  claims a completeness the data does not have.
 *
 *                  A field whose choices live outside the spec lists no
 *                  zeros - `country` is the one - because the list is
 *                  not here to enumerate. Those lines are the codes the
 *                  group really holds, and they carry no label, so the
 *                  page holding the list renders the name.
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
 * THE COUNTRY LINES ARE THE HARD CASE AND THEY HAVE THEIR OWN YES. That
 * field's choices live outside the spec, so its lines can only be the
 * codes the group actually holds - which is the one place the block
 * comes closest to the enumeration mandate 5 refuses, and it does it in
 * every filtered view as well. The owner ruled it explicitly on
 * 2026-08-19 (#371 comment 5347769320): "the group sees its own makeup;
 * the members-only door is what protects it". So the protection here is
 * the session gate on GET /charts-data and not a rule inside this file,
 * and widening the readership is what would re-take the question.
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
 * The ONE unit system a floor-protected view is served in.
 *
 * A name the spec offers, or - when the setting names none - THE SPEC'S
 * OWN DECLARED DEFAULT. `units.default` is the field that already
 * decides what the form and the charts start in, so a view that falls
 * back to it moves nobody: raising the floor changes how much is drawn,
 * not which unit a member reads. Falling back to some other field, such
 * as whichever system the spec happens to list first, would mean an
 * admin typing a number into the floor silently re-expressed every
 * chart in a system nobody chose - a change to what members see, made
 * by a setting that is not about units at all.
 *
 * READ THE SAME WAY THE FLOOR IS, and for the same reason: a value the
 * spec does not offer is a setting that failed to apply, not a reason to
 * refuse the whole view. Answering on a grid nobody has would be worse
 * than answering on the default one.
 */
function lockedSystem(site, settings) {
  const offered = site.units.systems;
  const held = settings && typeof settings === "object"
    ? settings.units : null;
  return offered.indexOf(held) !== -1 ? held : site.units.default;
}

/*
 * Which system THIS answer is expressed in, and the whole of the lock.
 *
 * At a floor of 0 it is the caller's own question. Above it, the setting
 * decides and the ask is overridden - SUBSTITUTED rather than refused,
 * because a page whose member toggles units should redraw in the system
 * the group is actually served in rather than meet an error for asking a
 * question the spec allows. The answer says which system it got and that
 * the choice was not the caller's (`units.locked`), so nothing about the
 * substitution is silent.
 *
 * ONE FUNCTION DECIDES IT FOR THE WHOLE ANSWER. aggregate() and
 * selfSeries() both call this rather than each reading the settings
 * themselves, so a member's own line can never end up in a different
 * unit from the group trend it is drawn over.
 */
function systemFor(ask, site, settings) {
  return floorOf(settings) > 0
    ? lockedSystem(site, settings)
    : ask.system;
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
 *
 * `units` joined the set at #396 and is the only one that a SETTING can
 * override: the floor's lock decides the system when there is a floor,
 * which is systemFor()'s job above and not this set's. What this set
 * still guarantees about it is the same thing it guarantees about every
 * other name here - the value is checked against the spec before
 * anything reads it.
 */
const ASK_PARAMS = new Set(["measure", "filter", "value", "self", "units"]);

/*
 * The two names that may appear MORE THAN ONCE, and the pairing rule.
 *
 * A CHIP IS A `filter=`/`value=` PAIR AND THE PAIRING IS POSITIONAL
 * (0.9-M3-S24, #438, building the chips ruled at #384): the nth
 * `filter=` owns the nth `value=`, so
 * `filter=gender&value=male&filter=roles&value=feedee` is two predicates
 * ANDed. The names did not change when the count did, because the page
 * sending one chip and the page sending three are the same page sending
 * more of the same thing.
 *
 * WHAT WAS REJECTED AND WHY, since a wire format is the hardest thing to
 * change later. A `filters=` parameter of its own would leave two
 * spellings of one idea for a page to get wrong. A compound
 * `filter=gender:male` would put a separator inside a value the SPEC
 * owns, so a fork whose choice value contains that character would have
 * a filter nobody could ask for.
 *
 * EVERY OTHER NAME KEEPS THE GIVEN-TWICE REFUSAL. `measure`, `self` and
 * `units` each decide one thing about the whole answer, so a second copy
 * is a caller contradicting themselves and honoring either would be this
 * route guessing which they meant.
 *
 * A FIELD STILL MAY NOT REPEAT. That refusal survives from the
 * single-filter world in its own words, raised against the FIELD rather
 * than against the parameter: #384 ruled ONE value per dimension, so two
 * values for one field would be an OR inside an AND - a different
 * question, and one no chip in the ruled design can express.
 */
const REPEATABLE = new Set(["filter", "value"]);

/*
 * The most predicates one request may carry.
 *
 * A BOUND ON THE REQUEST, NOT ON THE FORM. The spec's categorical fields
 * are admin data since 0.9-M3-S11 (#419) - an admin may add as many as
 * they like, and #384 ruling 3 is that a field they add becomes a chip
 * with no code change - so a cap read off the spec would be no cap at
 * all. Four is a fixed number: one more than the shipped form's three
 * categorical fields (gender, roles, country), so nothing the shipped
 * chips can build is out of reach, and the work one request may ask for
 * stays constant however far a fork's form grows.
 *
 * WHAT IT BOUNDS IS THE SWEEP, NOT THE ARITHMETIC. Matching costs one
 * heldValues() read per predicate per person, which is small; what grows
 * without a cap is how finely a single request may cut the group, and a
 * caller walking the product of every field's values is the shape this
 * declines to serve one request at a time.
 *
 * IT IS NOT A PRIVACY RULE AND MUST NOT BE READ AS ONE. The floor is
 * that rule, and it applies to an intersection exactly as it applies to
 * the whole - #384 ruling 2, "the same rule, exact at floor 0". Raising
 * this number would cost nothing in disclosure that the floor does not
 * already answer for; lowering it would not protect anybody the floor
 * leaves exposed.
 */
const MAX_FILTERS = 4;

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
 * DESIGN.md, "One partition, not two": a group is never sliced two ways
 * at once, because two independently-binned unit systems can be
 * overlaid into a finer reading than either gives - differenced back
 * into sub-floor cells in 2899 of 3000 random groups when the floor was
 * five. What holds that now is the LOCK (systemFor() above), not a
 * single partition for everybody: `system` here is whichever system the
 * answer is being built for, so the axis a member reads is round in the
 * unit they are reading it in (owner ruling 4, #396).
 *
 * `anchor` rides along because a band edge is a multiple of `bin`
 * measured from it, and gridOf() below needs both to build a single
 * edge. A spec that names no anchor is anchored at zero - which is
 * every shipped unit, and the only value that makes "25, 50, 75" fall
 * out of a 25-wide band.
 *
 * A unitless measure - a computed BMI, a plain count - has one number
 * for every system, so its partition is nominal and its `unit` is null.
 */
function anchorOf(given) {
  return typeof given === "number" && Number.isFinite(given) ? given : 0;
}

function partitionOf(measure, site, system) {
  if (!measure.unitful) {
    return { system: system, unit: null, band: null, bin: measure.bin,
      anchor: anchorOf(measure.anchor), store: null };
  }
  const chosen = measure.units[system];
  return { system: system, unit: chosen.unit, band: chosen.band,
    bin: chosen.bin, anchor: anchorOf(chosen.anchor),
    store: chosen.store };
}

/*
 * One number as the answer states it: in the partition's own unit,
 * rounded where a unit makes rounding meaningful.
 *
 * There is no conversion to do: the answer is in one system and carries
 * no second reading of itself (#396 ruling 4), so a number leaves here
 * in the unit it was read in. The rounding is one decimal place for a
 * measured value and none for a unitless one, whose own compute()
 * already rounded it to the places the spec asked for - rounding a
 * second time there would be this file overriding the spec.
 */
function stated(value, measure) {
  return measure.unitful ? round(value, 1) : value;
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
 * The measure list, the filter list and the choice values are all the
 * spec's, and since 0.9-M3-S11 (#419) the spec this reads is the
 * EFFECTIVE one: apps/web/site.config.js overlaid by what admins have
 * edited. That widens what a 400 stands for and discloses nothing new,
 * because the same caller may read the whole effective spec at GET
 * /spec, behind the same session gate this route is behind. A refusal
 * says what that document already says, and nothing about who is in the
 * binder. What a caller must never be able to tell apart is a filter
 * value nobody holds from one too few hold, and neither of those is
 * refused here: both are valid questions that aggregate() answers with
 * the same document.
 */
function askFor(params, spec) {
  const site = siteSpec(spec);
  const fields = api();

  for (const name of params.keys()) {
    if (!ASK_PARAMS.has(name)) {
      return fault('"' + name + '" is not a parameter of this view.');
    }
    if (!REPEATABLE.has(name) && params.getAll(name).length > 1) {
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

  /*
   * THE PREDICATES: one value per categorical field, ANDed (#438,
   * building #384's chips). Read as two positional lists, so the nth
   * filter owns the nth value - REPEATABLE above carries why the names
   * repeat rather than a new parameter arriving.
   *
   * THE COUNT IS CHECKED BEFORE ANY NAME IS RESOLVED. An over-cap
   * request then costs one comparison whatever it names, and - the part
   * that matters - a caller cannot read the ordering of these refusals
   * to learn which of the fields they invented this form happens to
   * have. The cap's refusal is about the request's shape alone.
   *
   * ONE BAD PREDICATE REFUSES THE WHOLE ASK rather than the good half
   * being honored. Answering a narrower question than the one asked
   * would describe a population the caller never named, and the
   * response gives them no way to tell that apart from the one they did
   * name - which is the same reason a single bad filter has always been
   * a refusal rather than a silently dropped clause.
   *
   * EVERY REFUSAL BELOW IS STILL ABOUT THE CONFIGURATION. A value an
   * admin RETIRED is simply not in the effective spec's choice list
   * (#385 rule 7; server/worker.js's offeredValues() is what drops it),
   * so it is refused in the same sentence a value that never existed
   * gets - a caller cannot read a refusal for the group's own history.
   */
  const by = params.getAll("filter");
  const values = params.getAll("value");
  if (by.length > MAX_FILTERS) {
    return fault("This view takes at most " + MAX_FILTERS +
      " filters at once.");
  }
  if (by.length > values.length) {
    return fault("That filter needs a value.");
  }
  if (values.length > by.length) {
    return fault("A value needs a filter to belong to.");
  }

  const filters = [];
  for (let i = 0; i < by.length; i += 1) {
    const field = by[i];
    const on = measures.filter((one) =>
      one.name === field && one.kind === "categorical")[0];
    if (!on) return fault("That is not a filter this form offers.");
    if (filters.some((one) => one.field === field)) {
      return fault('"' + field + '" is given more than once.');
    }
    if (!permits(on, values[i])) {
      return fault("That is not a value of that filter.");
    }
    filters.push({ field: field, value: values[i], measure: on });
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

  /*
   * WHICH UNIT SYSTEM THE ANSWER IS BINNED IN (owner ruling 4, #396).
   * Closed exactly as every other parameter is: one of the spec's own
   * systems, or left off for the spec's default. A typo is a refusal
   * rather than a quiet fallback, because falling back would draw a
   * member a grid they did not ask for and give them no way to tell.
   * What this refusal discloses is the fork's own config file.
   */
  const asked = params.get("units");
  if (asked !== null && site.units.systems.indexOf(asked) === -1) {
    return fault("That is not a unit system this form offers.");
  }

  return { ok: true, ask: { measure: measure, filters: filters,
    self: self === "1",
    system: asked === null ? site.units.default : asked } };
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
 * THE BOUNDS ARE THE UNION OF EVERY BOUND THE KIND DECLARES, each one
 * converted into the unit this answer is drawn in, and the widest pair
 * wins. THE FORM IS WHAT THEY ARE A CLAIM ABOUT: a member may type in
 * any unit the spec offers, so the values the form accepts are the union
 * of every row's own limits, not the limits of the row that happens to
 * match the axis. Reading one row alone is how a metric height axis came
 * to start at 100 cm while the form accepted 3 ft - 91.44 cm - and the
 * shortest member the form admits was clamped into a band reporting a
 * height he does not have (fix wave 1, O2).
 *
 * A ROW WITH NO BOUNDS CONTRIBUTES NOTHING rather than blocking the
 * union: inches carry none, because imperial height is typed as feet
 * with inches beside them and the bound belongs to the feet box a person
 * is looking at. So the inch axis is drawn between the feet row and the
 * centimeter row, both converted, and it covers a member of either
 * system.
 *
 * WIDER THAN NECESSARY IS THE SAFE DIRECTION and the only one available.
 * The union can only add empty bands at the ends; reading one row alone
 * can only lose members into a band that is not theirs, and it does so
 * silently, because a clamped value still counts and still sums.
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

  const table = site.units.kinds[one.kind].units;
  let min = null;
  let max = null;
  for (const name of Object.keys(table)) {
    const entry = table[name];
    if (typeof entry.min !== "number" || typeof entry.max !== "number") {
      continue;
    }
    const rate = name === part.unit
      ? 1 : api().factor(name, part.unit, site);
    if (rate === null) continue;
    const low = round(entry.min * rate, 4);
    const high = round(entry.max * rate, 4);
    if (!(high > low)) continue;
    if (min === null || low < min) min = low;
    if (max === null || high > max) max = high;
  }
  if (min === null || !(max > min)) {
    return complain("bounds no unit of its kind that converts to " +
      part.unit);
  }
  return { min: min, max: max };
}

/*
 * The spec's own bounds, SNAPPED OUTWARD onto the band grid.
 *
 * Owner ruling 3 (#396): band edges are multiples of the band width
 * measured from the unit's own anchor, so that the numbers a page puts
 * under the axis are round in the unit being read. The bounds have to
 * land on that grid too, or the first and last edge would be the two
 * numbers the grid is NOT made of - which is exactly where 44, 64, 84
 * came from.
 *
 * OUTWARD IN BOTH DIRECTIONS, never inward. The range this is handed is
 * rangeOf()'s union - every value the form accepts in any unit it
 * offers, converted - so rounding either bound in would leave a
 * form-valid member outside the axis and piled into an end band, the
 * same defect the derived BMI range exists to prevent, arriving through
 * the snap instead of through a hand-picked cap. That the range is the
 * UNION is what makes this sentence true rather than nearly true: over
 * one row's own limits it would only cover the members who typed in
 * that row's unit. Outward costs at most one empty band at each end and
 * costs nobody their own band.
 *
 * The division is rounded to nine places before the floor and the
 * ceiling read it: a bound that sits exactly on the grid can compute to
 * 4.999999999 in binary floating point, and a floor() over that would
 * push the axis a whole band wider than the spec asked for.
 */
function snapToGrid(range, width, anchor) {
  const steps = (value) => round((value - anchor) / width, 9);
  return {
    min: round(anchor + Math.floor(steps(range.min)) * width, 4),
    max: round(anchor + Math.ceil(steps(range.max)) * width, 4),
  };
}

/*
 * The spec's own bands, empty, in the partition's unit.
 *
 * Every band is exactly one width wide and every edge is a multiple of
 * that width from the anchor - which is only true because the range
 * arrives already snapped (snapToGrid() above). The last band is not
 * clipped any more: there is nothing to clip it to, since the maximum is
 * itself on the grid.
 *
 * EACH EDGE IS COMPUTED FROM THE MINIMUM RATHER THAN ACCUMULATED. Adding
 * the width repeatedly drifts in binary floating point, and a drifted
 * edge is a number the page would print as an axis label - "174.99999"
 * under a bar. Computing `min + i * width` keeps every edge exact and
 * makes each band's `to` byte-identical to the next band's `from`, which
 * is what lets a page read the whole axis as one list of edges.
 */
function gridOf(range, width) {
  if (!(width > 0)) {
    throw new Error("A charted measure needs a bin width in the spec, " +
      "and this one has none - there is no grid without it.");
  }
  const count = Math.round((range.max - range.min) / width);
  if (count > MAX_BANDS) {
    throw new Error("The spec asks for more than " + MAX_BANDS +
      " bands between " + range.min + " and " + range.max +
      ": widen `bin`, or narrow the range.");
  }
  const bins = [];
  for (let i = 0; i < count; i += 1) {
    bins.push({ from: round(range.min + i * width, 4),
      to: round(range.min + (i + 1) * width, 4), count: 0 });
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
 * one is emitted alone. One path, exercised at every floor, is why the
 * shipped world and the raised one cannot drift apart. What that leaves
 * on the wire - every band the spec asks for, the empty ones reading
 * zero - is part of the response contract, and that contract is stated
 * whole in this file's header under WHAT THE ANSWER CARRIES, where a
 * page's builder reads it.
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
 * The filters, ECHOED AND NEVER ENUMERATED (mandate 5).
 *
 * The caller is handed back the predicates THEY sent and nothing beside
 * them. Listing the genders, affiliations or countries the group
 * actually holds would be the membership oracle DESIGN.md, "The
 * identifier is the whole problem", turns the whole store on - reachable
 * with one request and no floor in the way, because a list of which
 * values EXIST is not a cell and no suppression rule would ever have
 * looked at it.
 *
 * A measure's own drawn cells do name values, and that is not the same
 * thing: a cell is the chart, and every drawn cell has already cleared
 * the floor.
 *
 * ONE SHAPE AT EVERY COUNT: a LIST, empty for Everyone (#438). The
 * single-filter world echoed `{ field: null, value: null }` for no
 * filter and a pair for one, and carrying that forward beside a list
 * would have left a page reading a key that exists only at one
 * particular count. The caller's own order is kept, because this is
 * their question handed back - and the answer around it does not depend
 * on that order, since AND is commutative.
 */
function echoFilters(filters) {
  return filters.map((one) => ({ field: one.field, value: one.value }));
}

/*
 * What nothing to draw looks like, and it is ONE document (mandate 4).
 *
 * A view with nobody in it, a filter value nobody holds, an
 * INTERSECTION OF SEVERAL FILTERS nobody is in, a measure nobody in the
 * view answered - and, at any raised floor, a group below it - all
 * arrive here and leave with the same bytes: same status, same sentence,
 * no counts, no partition, no band residue, no group makeup.
 *
 * THE COMBINED CASE IS THE ONE THIS NOW EARNS ITS KEEP ON (#438). Two
 * chips can cut the group to one member where one chip could not, so at
 * any floor above 0 the isolating combination and the combination
 * nobody is in have to be the same document - otherwise the difference
 * between them answers "is there exactly one person who is both of
 * these", which is the question the floor exists to refuse. The only
 * thing that varies between them is the echo, which is the caller's own
 * question and tells them nothing they did not send.
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
    filters: echoFilters(ask.filters),
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
 * Whether one person is in this view: they hold EVERY predicate's value.
 *
 * Decided on their CURRENT record, for both pictures. Placing somebody
 * by whatever they held at the time of each row instead would let the
 * population move underneath the trend line, so a change in the group's
 * average could be a change in who is being averaged - a chart that
 * cannot be read is worse than one that is coarse.
 *
 * AND, ACROSS FIELDS, AND THE EMPTY SET IS EVERYONE (#438, #384's
 * chips). A member holding a value on a multiple-choice field satisfies
 * that field's predicate once however many values they hold, so nobody
 * is counted twice by combining - the person-rule the whole file runs on
 * is untouched by there being more predicates.
 *
 * Everyone is the empty list rather than a null, which is why there is
 * no special case here to get wrong: a loop over no predicates is
 * vacuously true, so "no chips" reaches the same code every other count
 * reaches.
 */
function matchesAll(record, filters) {
  for (const filter of filters) {
    if (heldValues(filter.measure, record).indexOf(filter.value) === -1) {
      return false;
    }
  }
  return true;
}

/*
 * Which system this answer is in, what its axis is labeled in, and
 * whether the caller got to choose. Config, not data - the only number
 * near it is the floor, which every answer already reports.
 *
 * `locked` is the page's whole instruction: a members' page that hides
 * the flag would leave a units toggle that silently does nothing, and a
 * member pressing it twice would conclude the page is broken rather
 * than that the group's figures are only served one way.
 */
function unitsFor(part, locked) {
  return { system: part.system, unit: part.unit, locked: locked };
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
  const range = snapToGrid(rangeOf(measure, part, site), part.bin,
    part.anchor);
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
      count: bin.count, from: bin.from, to: bin.to,
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
 *
 * The reasons are here; the SHAPE these lines arrive in is in this
 * file's header under WHAT THE ANSWER CARRIES, which is the one place a
 * page's builder has to read.
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
 * could difference the two. With several filters set that view is the
 * INTERSECTION (#438), and this needs no code of its own: `people` is
 * already whoever matched every predicate, so the block describes them
 * and the floor reduces their cells by the same rule it reduces the
 * whole binder's - which is what stops a two-chip cut naming a value
 * only one of the people behind it holds.
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
      average: stated(round(total / values.length, 1), measure),
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
 * ZERO PEOPLE IS ALWAYS NOTHING TO DRAW, whatever the floor, and at the
 * shipped default it is the one refusal left (ruling 7). It is NOT a
 * second guard here, and the missing `if` is the point: at a floor of 0
 * the comparison below cannot catch it, and what does is binsOf()
 * refusing a view where nobody has a value for the measure. Nobody at
 * all is a special case of that, so one path answers both and there is
 * no branch that only an empty group reaches. A guard added here would
 * be a line no test could redden, which is a worse thing to carry than
 * the sentence explaining its absence - and
 * tests/charts-aggregate.test.mjs arms the pair: an empty view answers
 * the honest sentence, and a view where nobody answered this measure
 * draws nothing rather than a grid of zeros.
 *
 * `rows` are ALREADY-OPENED, already-current rows - the tombstones are
 * excluded by the statement that read them, because whether a row is
 * superseded is answerable in the clear and opening a corrected row to
 * throw it away is work for nothing.
 */
function aggregate(rows, ask, spec, settings) {
  const site = siteSpec(spec);
  const floor = floorOf(settings);
  const system = systemFor(ask, site, settings);
  const part = partitionOf(ask.measure, site, system);

  const people = [];
  const accounts = new Set();
  for (const row of latestPerAccount(rows).values()) {
    if (!matchesAll(row.record, ask.filters)) continue;
    people.push(row);
    accounts.add(row.accountId);
  }
  if (accounts.size < floor) return notEnough(ask, floor);

  const distribution = binsOf(people, ask.measure, site, part, floor);
  if (distribution === null) return notEnough(ask, floor);

  return {
    ok: true,
    measure: echoMeasure(ask.measure),
    filters: echoFilters(ask.filters),
    floor: floor,
    enough: true,
    note: null,
    units: unitsFor(part, floor > 0),
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
 * THE FILTERS ARE NOT APPLIED, however many are set. The overlay is the
 * caller's own history, which they can already read in full at GET
 * /my-entries, so narrowing it by the group's filters would buy no
 * privacy and would make their line appear and disappear as they
 * changed the group they were comparing themselves to.
 *
 * IT TAKES THE SETTINGS ANYWAY, AND NOT FOR THE FLOOR. This line is
 * drawn OVER the group trend on one pair of axes, so it has to be in
 * the same unit the rest of the answer is - which the settings decide
 * whenever a floor is set (systemFor()). A member's own line in pounds
 * over a group line in kilograms would be two measurements sharing one
 * scale, which is a worse chart than no overlay at all. Nothing here
 * reads `floor` itself: their data, their line.
 */
function selfSeries(rows, accountId, ask, spec, settings) {
  if (!ask.self) return null;
  if (typeof accountId !== "string" || !ACCOUNT_ID.test(accountId)) {
    throw new Error("the overlay's identity is not an account-id HMAC");
  }
  const site = siteSpec(spec);
  const part = partitionOf(ask.measure, site,
    systemFor(ask, site, settings));
  const mine = rows.filter((row) => row.accountId === accountId)
    .sort((a, b) => a.receivedAt < b.receivedAt ? -1
      : a.receivedAt > b.receivedAt ? 1 : a.id - b.id);

  const points = [];
  for (const row of mine) {
    const value = valueFor(ask.measure, row.record, site, part);
    if (value === null) continue;
    points.push({ at: row.receivedAt, value: stated(value, ask.measure) });
  }
  return { points: points };
}

export { DEFAULT_FLOOR, MAX_FILTERS, askFor, aggregate, selfSeries };
