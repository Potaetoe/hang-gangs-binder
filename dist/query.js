

(function (root) {
  "use strict";

  const PUBLISHED = "published";
  const PERSONAL = "personal";

  const BASES = Object.freeze(["people", "entries"]);
  const MEASURES = Object.freeze(["count", "median", "mean"]);

  

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

  

  const built = new WeakSet();

  

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
      "These are not the published figures.");
    }
    return makeSource(PUBLISHED, d.MIN_CELL, snapshot);
  }

  

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
      "These are not all one person's entries.");
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
      "Only weight, height and BMI can be averaged.");
    }

    

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
      

      return finish(source, spec, "categorical",
        applyMerge(d.suppressCounts(rows, source.floor), spec.merge),
        null, true);
    }

    const bins = (spec.split === "bmi"
      ? base.bmi.bins
      : base[spec.units][spec.split].bins).map(function (bin) {
      return { from: bin.from, to: bin.to, count: bin.count };
    });
     
     
     
    return finish(source, spec, "bins",
      applyWiden(d.suppressBins(bins, source.floor), spec.widen),
      null, true);
  }

  

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
