/*
 * The member-facing query engine: #85's dashboards, asked as questions.
 *
 * THIS FILE'S EXPORTED NAMESPACE IS A CONTRACT. The later UI slice of
 * #85 builds its pickers against `SPLITS`, `BASES` and `MEASURES`, and
 * draws whatever `run` hands back. Adding or removing a member here is
 * a change to a published interface, not a refactor - dev/query.test
 * .mjs pins the key set as a whole so it cannot drift in a diff nobody
 * reads.
 *
 *     const source = BinderQuery.publishedSource(snapshot);
 *     const result = BinderQuery.run(source, {
 *       basis: "people", split: "country",
 *       merge: [{ as: "Anglosphere", labels: ["US", "GB"] }],
 *     });
 *
 * TWO SOURCES, AND THE DIFFERENCE BETWEEN THEM IS THE WHOLE DESIGN.
 *
 *   - `publishedSource` reads the members-only published snapshot: a
 *     document with no rows and no handles, every cell already reduced
 *     to at least MIN_CELL people by the keyholder's browser. Queries
 *     against it hold the floor.
 *   - `personalSource` reads ONE member's own rows and applies no floor
 *     at all, because their own data is theirs. A floor here would hide
 *     somebody's own March from them because March held one entry.
 *
 * The separation is structural rather than a flag: the two functions
 * take different things, a source records which it is, and `run` takes
 * the floor from the source. A caller cannot ask for floor 0 over a
 * published document, because nothing in a query says what the floor is.
 *
 * WHY A QUERY ENGINE NEEDS ITS OWN ARGUMENT ABOUT THE FLOOR. A single
 * published document holding MIN_CELL is what dashboard.js proves. It
 * is not what makes this safe. A query builder is a machine for asking
 * the same people the same question many ways, and two answers can be
 * differenced - which is exactly how DESIGN.md's "one partition, not
 * two" leak worked, where metric bins crossed with imperial bins
 * isolated one person while neither set broke the rule on its own.
 *
 * SO THE ALGEBRA IS UNION-ONLY, and that is the safety property:
 *
 *   1. Every result is drawn from ONE published partition - the cells
 *      the keyholder already published for that basis and split.
 *   2. The only operations are MERGE (name several cells as one) and
 *      WIDEN (combine adjacent histogram bins). Both add counts.
 *      Nothing here splits a cell, subtracts, or intersects two splits.
 *   3. The floor is applied to that partition BEFORE any coarsening, so
 *      every cell a member can reach is a union of cells that each
 *      already cleared it.
 *
 * From those three, the composition result follows: any two answers are
 * coarsenings of one common partition, so overlaying them recovers that
 * partition and nothing finer - and every cell of it clears the floor.
 * A member can ask every question this engine can express and learn
 * exactly what the published document already told them.
 *
 * THE ORDER IN STEP 3 IS LOAD-BEARING AND IS NOT A TIDY-UP. Suppress
 * the partition first; coarsen it second. Both arms, both levers.
 *
 * Widening first and suppressing after would let each widen factor
 * merge a different set of neighbours to clear the floor, so widen 2
 * and widen 3 would be coarsenings of two DIFFERENT partitions - and
 * overlaying two different partitions is the leak this whole comment is
 * about. Merging first is the same mistake wearing different clothes:
 * a member who merges a sub-floor cell into a large one and compares
 * that answer against the unmerged one reads the hidden cell off as the
 * difference.
 *
 * Both orders are asserted rather than argued. Swap either pair of
 * lines in `run` and dev/query.test.mjs fails - on the adversarial
 * fixtures specifically, because against a document whose cells already
 * clear the floor the two orders agree and a check built only from real
 * snapshots would pass either way.
 *
 * Pure by construction: no document, no fetch, no storage. It reads the
 * floor, the snapshot builder and the unit table out of BinderDashboard
 * rather than carrying second copies, because a second copy of MIN_CELL
 * is a floor that can be lowered in one file and not the other.
 */
(function (root) {
  "use strict";

  const PUBLISHED = "published";
  const PERSONAL = "personal";

  const BASES = Object.freeze(["people", "entries"]);
  const MEASURES = Object.freeze(["count", "median", "mean"]);

  /*
   * What may be asked about, and how each one is coarsened.
   *
   * `kind` decides the shape of the answer and therefore which lever
   * applies: a categorical split is coarsened by naming cells, a
   * histogram by widening bands. `unitful` says whether the split reads
   * a unit system off the snapshot; BMI is a unitless index, which is
   * why it is binned but takes no units.
   */
  const SPLITS = Object.freeze({
    gender: Object.freeze({ kind: "categorical", unitful: false,
      label: "gender" }),
    country: Object.freeze({ kind: "categorical", unitful: false,
      label: "country" }),
    roles: Object.freeze({ kind: "categorical", unitful: false,
      label: "affiliation" }),
    bmi: Object.freeze({ kind: "bins", unitful: false, label: "BMI" }),
    weight: Object.freeze({ kind: "bins", unitful: true, label: "weight" }),
    height: Object.freeze({ kind: "bins", unitful: true, label: "height" }),
  });

  /*
   * The sources this module built, and nothing else.
   *
   * A WeakSet rather than a marker property, because a property can be
   * copied onto a hand-made object. The floor comes from the source, so
   * an object claiming to be a personal source over a published
   * snapshot would be a caller choosing floor 0 for other people's
   * data - the one decision this design never lets a caller make.
   */
  const built = new WeakSet();

  /*
   * A REFUSAL WITH TWO READERS - #265 rows 14 to 16.
   *
   * The messages in this file are written for whoever is holding the
   * document: they name the version, the split, the cell, and the
   * alternatives, and that precision is the only explanation anybody
   * debugging a refused query gets. It is also what reached a member's
   * screen, because two pages showed these words verbatim - "unknown
   * split \"x\" - it is one of gender, country, roles, bmi, weight,
   * height" over a card whose own controls say About and Combine.
   *
   * Rewriting the messages was the other option and it is the worse
   * one: it would trade a reader who needs the split's name for a
   * reader who needs a sentence, and leave neither served. So the
   * refusals a member can actually provoke carry BOTH - `message`
   * unchanged for the console and the caller, `plain` for the card -
   * and the two are one claim in two registers rather than two
   * sentences free to drift apart.
   *
   * Only the reachable ones carry a plain half, deliberately. An
   * unknown basis or unit system is this module and a page disagreeing
   * about their own tables, which dev/public.test.mjs pins in both
   * directions; a member cannot reach it, and inventing a member's
   * sentence for it would be inventing a member's situation. The pages
   * say their own thing when no plain half arrives, which is what keeps
   * a throw added here tomorrow from printing itself on a chart.
   */
  function refuse(message, plain) {
    const error = new Error(message);
    if (plain) error.plain = plain;
    return error;
  }

  function dashboard() {
    const api = root.BinderDashboard;
    if (!api) {
      throw new Error("query.js needs dashboard.js loaded first: it reads " +
        "the suppression floor and the snapshot builder from it");
    }
    return api;
  }

  function makeSource(kind, floor, snapshot) {
    const source = Object.freeze({ kind: kind, floor: floor,
      snapshot: snapshot });
    built.add(source);
    return source;
  }

  /*
   * The published document, and a hard refusal of the one that looks
   * almost exactly like it.
   *
   * A snapshot built with identify:true is the keyholder's own view:
   * Telegram handles on every series line, the data-quality panel with
   * its list of heights, unquantized points, and every cell built with
   * floor 0 because it was never going to leave that tab. It has the
   * same shape as a published document and none of its properties, so
   * the difference has to be enforced rather than assumed - serving one
   * through this arm would publish all of that while the engine's own
   * floor logic reported success.
   */
  function publishedSource(snapshot) {
    const d = dashboard();
    if (!snapshot || typeof snapshot !== "object") {
      throw new Error("a published source needs a snapshot document");
    }
    if (snapshot.snapshot !== d.SNAPSHOT_VERSION) {
      throw refuse("snapshot version " + snapshot.snapshot + " is not " +
        "the version this engine reads (" + d.SNAPSHOT_VERSION + ")",
      "They were published by a newer version of the site.");
    }
    if (snapshot.identified === true) {
      throw refuse("that is a keyholder snapshot, not a published one - " +
        "it carries handles and unsuppressed cells, and must not be " +
        "queried as though it were published",
      "What arrived is not the published copy this page may show.");
    }
    return makeSource(PUBLISHED, d.MIN_CELL, snapshot);
  }

  /*
   * One member's own rows, and the guard that makes "own" mean it.
   *
   * No floor is applied to a personal source, so the question of whose
   * rows these are is the entire safety argument. A bug that handed
   * this function the whole corpus would build an unsuppressed
   * cross-member dashboard and label it personal, so the count is
   * checked rather than trusted - through BinderDashboard.peopleCount,
   * so "is this the same person" keeps exactly one answer in this
   * codebase.
   */
  function personalSource(entries, now) {
    const d = dashboard();
    if (!Array.isArray(entries)) {
      throw new Error("a personal source needs an array of the member's " +
        "own rows");
    }
    if (!entries.length) {
      throw new Error("a personal source needs at least one of the " +
        "member's own rows");
    }
    if (d.peopleCount(entries) > 1) {
      throw refuse("a personal source is one member's own rows, and " +
        "these belong to more than one person",
      "These do not all look like one person's entries, so nothing was " +
        "drawn.");
    }
    return makeSource(PERSONAL, 0, d.snapshotOf(entries,
      { identify: true }, now));
  }

  function normalizeMerge(merge, split) {
    if (merge === undefined) return [];
    if (!Array.isArray(merge)) {
      throw new Error("merge is a list of { as, labels } groups");
    }
    const claimed = new Map();
    const groups = [];
    for (const group of merge) {
      if (!group || typeof group.as !== "string" || !group.as ||
          !Array.isArray(group.labels) || !group.labels.length) {
        throw new Error("each merge group needs a name and at least one " +
          "label: { as, labels }");
      }
      for (const label of group.labels) {
        if (claimed.has(label)) {
          throw refuse("merge names \"" + label + "\" twice, and two " +
            "groups claiming one cell would count those people twice",
          "That group is named twice — the same people would be counted " +
            "twice.");
        }
        claimed.set(label, groups.length);
      }
      groups.push({ as: group.as, labels: group.labels.slice() });
    }
    if (!groups.length) return [];
    return { groups: groups, claimed: claimed, split: split };
  }

  function normalize(query) {
    const d = dashboard();
    const q = query || {};

    const basis = q.basis === undefined ? "people" : q.basis;
    if (BASES.indexOf(basis) === -1) {
      throw new Error("unknown basis \"" + basis + "\" - it is one of " +
        BASES.join(", "));
    }

    const split = q.split;
    if (typeof split !== "string" ||
        !Object.prototype.hasOwnProperty.call(SPLITS, split)) {
      throw new Error("unknown split \"" + split + "\" - it is one of " +
        Object.keys(SPLITS).join(", "));
    }
    const shape = SPLITS[split];

    const measure = q.measure === undefined ? "count" : q.measure;
    if (MEASURES.indexOf(measure) === -1) {
      throw new Error("unknown measure \"" + measure + "\" - it is one of " +
        MEASURES.join(", "));
    }
    if (measure !== "count" && shape.kind !== "bins") {
      throw refuse("a " + measure + " over \"" + split + "\" is not a " +
        "question - a middle needs numbers to take the middle of",
      "A middle needs numbers to work with, so it is only offered for " +
        "weight, height and BMI.");
    }

    /*
     * Units are read only by the splits that have them, and passing
     * them to one that does not is ignored rather than refused. The
     * result reports `units: null`, which is how a caller sees that the
     * argument did nothing - a UI carrying one unit toggle over every
     * chart should not have to special-case BMI to avoid an error.
     */
    let units = null;
    if (shape.unitful) {
      units = q.units === undefined ? d.DEFAULT_UNITS : q.units;
      if (!Object.prototype.hasOwnProperty.call(d.UNITS, units)) {
        throw new Error("unknown unit system \"" + units + "\"");
      }
    }

    let merge = [];
    let widen = 1;
    if (shape.kind === "categorical") {
      if (q.widen !== undefined) {
        throw new Error("widen coarsens a histogram; \"" + split + "\" is " +
          "coarsened by naming cells with merge");
      }
      merge = normalizeMerge(q.merge, split);
    } else {
      if (q.merge !== undefined) {
        /*
         * A histogram is ordered and contiguous. Naming arbitrary bins
         * as one cell would build a non-contiguous band, and the gap
         * between its parts is a cell nobody applied the floor to.
         */
        throw new Error("merge names labels; a histogram is coarsened with " +
          "widen, which cannot reorder it");
      }
      widen = q.widen === undefined ? 1 : q.widen;
      if (!Number.isInteger(widen) || widen < 1) {
        throw new Error("widen is a whole number of bins to combine, at " +
          "least 1");
      }
    }

    return { basis: basis, split: split, shape: shape, measure: measure,
      units: units, merge: merge, widen: widen };
  }

  /* Cells named as one cell. Counts add; nothing is dropped, and a cell
   * no group named is passed through where it already was. */
  function applyMerge(rows, merge) {
    if (!merge || !merge.groups) return rows;
    const have = new Set();
    for (const row of rows) have.add(row.label);
    for (const label of merge.claimed.keys()) {
      if (!have.has(label)) {
        throw refuse("merge names \"" + label + "\", which is not a " +
          "cell of " + merge.split + " in this document",
        "One of those groups is not one these figures show.");
      }
    }

    const out = [];
    const at = new Map();
    for (const row of rows) {
      if (!merge.claimed.has(row.label)) {
        out.push({ label: row.label, count: row.count });
        continue;
      }
      const index = merge.claimed.get(row.label);
      if (!at.has(index)) {
        at.set(index, out.length);
        out.push({ label: merge.groups[index].as, count: 0 });
      }
      out[at.get(index)].count += row.count;
    }
    return out;
  }

  /*
   * Adjacent bins combined in runs. A trailing remainder merges
   * backwards into the last group rather than standing alone, so every
   * emitted band really is at least `widen` bins wide - the same tail
   * rule suppressBins keeps, for the same reason: a short band at the
   * end is the tail of the distribution, which is where the lightest
   * and heaviest person sit.
   */
  function applyWiden(bins, widen) {
    if (widen <= 1 || !bins.length) return bins;
    const out = [];
    let open = null;
    let taken = 0;
    for (const bin of bins) {
      open = open === null
        ? { from: bin.from, to: bin.to, count: bin.count }
        : { from: open.from, to: bin.to, count: open.count + bin.count };
      taken++;
      if (taken === widen) {
        out.push(open);
        open = null;
        taken = 0;
      }
    }
    if (open !== null) {
      if (!out.length) out.push(open);
      else {
        const last = out[out.length - 1];
        last.to = open.to;
        last.count += open.count;
      }
    }
    return out;
  }

  function total(cells) {
    let n = 0;
    for (const cell of cells) n += cell.count;
    return n;
  }

  function finish(source, spec, kind, cells, value, available) {
    for (const cell of cells) Object.freeze(cell);
    return Object.freeze({
      source: source.kind,
      basis: spec.basis,
      split: spec.split,
      units: spec.units,
      measure: spec.measure,
      kind: kind,
      available: available,
      floor: source.floor,
      cells: Object.freeze(cells),
      total: total(cells),
      value: value,
    });
  }

  function run(source, query) {
    const d = dashboard();
    if (!source || typeof source !== "object" || !built.has(source)) {
      throw new Error("run needs a source built by publishedSource or " +
        "personalSource");
    }
    const spec = normalize(query);
    const statShape = spec.measure === "count" ? spec.shape.kind : "stat";

    /*
     * basisOf returns null below the floor, so there is genuinely
     * nothing safe to say. An empty breakdown would read as "nobody is
     * anything", which is a different and false statement.
     */
    const base = source.snapshot.bases[spec.basis];
    if (!base) return finish(source, spec, statShape, [], null, false);

    if (spec.measure !== "count") {
      const stat = spec.split === "bmi"
        ? base.bmi
        : base[spec.units][spec.split];
      return finish(source, spec, "stat", [], stat[spec.measure], true);
    }

    if (spec.shape.kind === "categorical") {
      const rows = base[spec.split].map(function (cell) {
        return { label: cell.label, count: cell.count };
      });
      /*
       * Suppress, THEN merge - the same order as the bins arm below,
       * and load-bearing for the same reason.
       *
       * Merging first is the reading that looks more generous, and it
       * leaks. Against a document carrying a sub-floor cell, a member
       * who merges that cell into a large one and compares the answer
       * with the unmerged one reads the difference straight off:
       * female 12 becomes female 15, and nonbinary 3 was never
       * published. Suppressing first means the only labels a member can
       * name are labels the document already showed them, so every
       * group they can build is a union of public cells.
       *
       * Merging never needs a second suppression: every input cell
       * already clears the floor and merging only adds.
       */
      return finish(source, spec, "categorical",
        applyMerge(d.suppressCounts(rows, source.floor), spec.merge),
        null, true);
    }

    const bins = (spec.split === "bmi"
      ? base.bmi.bins
      : base[spec.units][spec.split].bins).map(function (bin) {
      return { from: bin.from, to: bin.to, count: bin.count };
    });
    // Suppress, THEN widen - see the head of this file. Every widen
    // factor must coarsen the same floor-clearing partition, or two of
    // them can be overlaid to isolate somebody.
    return finish(source, spec, "bins",
      applyWiden(d.suppressBins(bins, source.floor), spec.widen),
      null, true);
  }

  /* The sentence a UI puts above a chart, from the same validator run
   * uses - so a caption can never describe a query that would throw. */
  function describe(query) {
    const spec = normalize(query);
    const noun = spec.basis === "people" ? "people" : "entries";
    const inUnits = spec.units === null ? "" : " (" + spec.units + ")";
    if (spec.measure === "count") {
      return "How many " + noun + ", by " + spec.shape.label + inUnits;
    }
    return "The " + spec.measure + " " + spec.shape.label + " across " +
      noun + inUnits;
  }

  root.BinderQuery = Object.freeze({
    PUBLISHED: PUBLISHED,
    PERSONAL: PERSONAL,
    BASES: BASES,
    MEASURES: MEASURES,
    SPLITS: SPLITS,
    publishedSource: publishedSource,
    personalSource: personalSource,
    run: run,
    describe: describe,
  });
})(globalThis);
