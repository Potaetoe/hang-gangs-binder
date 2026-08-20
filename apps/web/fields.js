/*
 * Everything that follows from apps/web/site.config.js.
 *
 * The spec beside this file says what the group is called and what the
 * form asks. This file is the only thing that reads it and turns it
 * into the shapes the rest of the project wants: the wordmark and the
 * titles, the measure list the charts draw, the conversion factors,
 * the limits the form enforces, the labels the gate holds the pages
 * to. Nobody editing a fork should have to open this file; that is the
 * division of labor the two files exist to draw.
 *
 * WHY THE DERIVATIONS TAKE A SPEC. Every function here accepts an
 * optional spec and falls back to the shipped one. It is not
 * generality for its own sake - it is what lets a check hand this
 * module a spec with one extra field in it and watch the extra field
 * arrive in the measure list and in the labels, which is the whole
 * contract 0.9 rests on ("a fork edits fields in ONE place and the
 * site follows", #278). A module that could only read one global would
 * make that proof impossible to write.
 *
 * WHY THE SPEC IS FROZEN HERE RATHER THAN THERE. site.config.js is
 * data - a table with comments, no calls, nothing a non-expert has to
 * read past. The freeze is a property of USING it: a page holds this
 * object for a whole session, so a same-origin script that could push
 * a choice onto a list or move a limit would be editing the form after
 * it had been rendered. So the reader freezes what it reads, and the
 * table stays a table.
 *
 * AND IT FREEZES ON THE READ, NOT AT LOAD. 0.9-M2 loads these two
 * files with two <script> tags, and two tags have two orders. Freezing
 * once while this file evaluates worked in one of them and silently
 * did not in the other: with this file first, root.BINDER_SITE is not
 * there yet, deepFreeze returns on its first guard, every derivation
 * still works when the spec arrives a moment later, and the form stays
 * editable for the life of the page with nothing thrown and nothing
 * logged. Freezing inside spec() cannot be ordered wrong - whatever a
 * derivation is about to read is frozen before it reads it, whichever
 * tag came first - and it costs one Object.isFrozen after the first
 * call. Restoring the load-time freeze as the only one restores the
 * silent order.
 *
 * ARITHMETIC IS CODE AND STAYS CODE. A computed field in the spec
 * names a `derivation`; DERIVATIONS below is the list of the ones that
 * exist, and an unknown name throws rather than yielding a measure
 * that quietly computes nothing. Letting the table carry a formula
 * would mean evaluating a string a fork owner typed, on the page that
 * handles cleartext - which is the one thing this project's CSP is
 * written to prevent. A `kind` this file does not implement is refused
 * the same way and for the same reason: nothing downstream can ask
 * which unit table applies or what shape of chart it makes, so
 * answering would mean a histogram with no band width drawn from a
 * field the form never asked for.
 *
 * Pure. No document, no fetch, no storage: the wiring that draws these
 * fields belongs to the pages. your-page.html is the first one
 * (0.9-M2-S2, #353) - its own form.js is the wiring, and it reads the
 * two extra exports below (enterUnit, compoundUnit) for the one
 * question the chartable-measure list never had to answer: which unit
 * a MEMBER TYPES INTO, as opposed to which unit a chart draws in. They
 * differ for length - a member types feet, a chart draws inches - which
 * is exactly why `enter` and `chart` are two separate tables on the
 * spec's kind rather than one.
 */
(function (root) {
  "use strict";

  // The kinds a field may be. A kind is what decides which unit table
  // applies, whether the field is asked for at all, and what shape of
  // chart it can become - so an unknown one is a spec that cannot be
  // rendered rather than a field with a typo in it.
  const KINDS = Object.freeze([
    "weight", "length", "count", "choice", "computed", "consent",
  ]);

  // Kinds that are asked for as a number and therefore carry units.
  const MEASURED = Object.freeze(["weight", "length"]);

  // Kinds that never become a chart, whatever a spec says.
  const NEVER_CHARTED = Object.freeze(["consent"]);

  function round(value, places) {
    const factor = Math.pow(10, places);
    return Math.round(value * factor) / factor;
  }

  function num(value) {
    return typeof value === "number" && Number.isFinite(value)
      ? value : null;
  }

  /*
   * The arithmetic behind every computed field, by name.
   *
   * Each one takes the row's values in the kind's BASE unit - kg and
   * cm here - because a derivation that had to ask which unit system
   * it was looking at would be a second place the conversion could go
   * wrong. `places` comes from the spec, so the rounding is data even
   * though the formula is not.
   *
   * A missing input is null and never zero. Somebody who gave a weight
   * and no height has no BMI; inventing one would put a fabricated
   * point in a chart drawn from real ones.
   */
  const DERIVATIONS = Object.freeze({
    bmi: function (values, places) {
      const kg = num(values.weight);
      const cm = num(values.height);
      if (kg === null || cm === null || cm <= 0) return null;
      const meters = cm / 100;
      return round(kg / (meters * meters), places);
    },
  });

  /* ---------------------------------------------------------------- */
  /* Reading the spec.                                                 */

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) {
      return value;
    }
    Object.freeze(value);
    Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
    return value;
  }

  /*
   * The spec, frozen, whichever <script> tag came first.
   *
   * Every read in this file goes through here, which is what makes the
   * freeze a property of the spec rather than of the load order (see
   * the header). deepFreeze returns immediately on an object it has
   * already frozen, so this is one type check per call after the first.
   *
   * The throw is the loud half. A page whose tags are in the wrong
   * order and reads a field before the spec has run gets this sentence
   * rather than a measure list built out of undefineds - a spec that
   * will not load beats a form that quietly asks nothing.
   */
  function spec(given) {
    const site = given || root.BINDER_SITE;
    if (!site) {
      throw new Error("apps/web/site.config.js has not been loaded, so " +
        "nothing knows what this form asks: it goes in a <script> tag " +
        "before this file, or it is passed in.");
    }
    return deepFreeze(site);
  }

  /*
   * The fields, with every kind held to the list above.
   *
   * Checked here rather than where a measure is built because a kind
   * with a typo in it is a spec that cannot be rendered, not a field
   * that is merely never charted: a guard living in measureFor would
   * hand out names, labels and limits for "girth" and refuse only where
   * a chart asked for it. One guard on the one read path is also the
   * only place that catches it once rather than per consumer.
   */
  function fields(given) {
    const all = spec(given).fields;
    all.forEach(function (one) {
      if (KINDS.indexOf(one.kind) === -1) {
        throw new Error('The spec gives field "' + one.name + '" the kind "' +
          one.kind + '", and apps/web/fields.js implements only: ' +
          KINDS.join(", ") + ".");
      }
    });
    return all;
  }

  function field(name, given) {
    const found = fields(given).filter(function (one) {
      return one.name === name;
    })[0];
    if (!found) {
      throw new Error('No field named "' + name + '" in the spec.');
    }
    return found;
  }

  function names(given) {
    return fields(given).map(function (one) { return one.name; });
  }

  /* {name: label}, which is what a check comparing a page against the
     spec wants: the page has the label and needs the field it belongs
     to. */
  function labels(given) {
    const out = {};
    fields(given).forEach(function (one) { out[one.name] = one.label; });
    return out;
  }

  function isMeasured(one) {
    return MEASURED.indexOf(one.kind) !== -1;
  }

  function kindSpec(kind, given) {
    const kinds = spec(given).units.kinds;
    return Object.prototype.hasOwnProperty.call(kinds, kind)
      ? kinds[kind] : null;
  }

  /* Every unit a kind has, or an empty table for a kind that has
     none - a choice has no units and neither does a count, and both
     are ordinary rather than an error. */
  function unitsOf(kind, given) {
    const found = kindSpec(kind, given);
    return found ? found.units : {};
  }

  function defaultSystem(given) {
    return spec(given).units.default;
  }

  /* Every unit system this spec offers, in the order it lists them - the
     order a units toggle presents them in. */
  function systems(given) {
    return spec(given).units.systems.slice();
  }

  /* The unit table one unit name belongs to, with the kind it is part
     of - so a conversion can refuse two units that are not the same
     kind of thing rather than multiplying them together. */
  function unitHome(unit, given) {
    const kinds = spec(given).units.kinds;
    let home = null;
    Object.keys(kinds).forEach(function (kind) {
      if (Object.prototype.hasOwnProperty.call(kinds[kind].units, unit)) {
        home = { kind: kind, unit: kinds[kind].units[unit] };
      }
    });
    return home;
  }

  /*
   * How many of `to` one `from` is, or null when the question does not
   * mean anything.
   *
   * Every factor in the project is this ratio of two `per` numbers, so
   * there is exactly one place a conversion can be wrong and it is the
   * spec's own table. Feet to inches is 30.48 / 2.54, which is 12
   * because both of those are exact - the arithmetic is not asked to
   * remember that twelve is a number worth knowing.
   */
  function factor(from, to, given) {
    const here = unitHome(from, given);
    const there = unitHome(to, given);
    if (!here || !there || here.kind !== there.kind) return null;
    return here.unit.per / there.unit.per;
  }

  function convert(value, from, to, given) {
    const rate = factor(from, to, given);
    return rate === null ? null : value * rate;
  }

  /*
   * The unit a member TYPES a measured field's value in, for one unit
   * system - as opposed to `measureFor`'s `units[system].unit`, which is
   * the unit a CHART draws it in. The two agree for weight (kg/lb both
   * ways) and differ for length: a member types feet, and no histogram
   * is drawn in feet-and-inches, so the chart reads inches instead
   * (site.config.js's own comment on `enter`/`chart` says why). null for
   * a kind the spec's units table does not carry an `enter` row for -
   * choice, count and consent all have no unit to type into.
   */
  function enterUnit(kind, system, given) {
    const found = kindSpec(kind, given);
    return found && found.enter ? found.enter[system] || null : null;
  }

  /*
   * The SECOND unit typed beside one unit's box, or null when there
   * isn't one - inches beside feet, and nothing beside every other unit
   * this spec carries. `compound` on a kind is the table this reads;
   * see site.config.js's own comment on it. Keyed by unit name rather
   * than by kind: a form field asks "what goes beside THIS box", not
   * "does this kind of thing ever have a compound".
   */
  function compoundUnit(unit, given) {
    const home = unitHome(unit, given);
    if (!home) return null;
    const compound = spec(given).units.kinds[home.kind].compound;
    return compound && Object.prototype.hasOwnProperty.call(compound, unit)
      ? compound[unit] : null;
  }

  /*
   * What the form will accept, per unit, as {unit: {min, max}}.
   *
   * Only the units that carry a bound: an inch has none, because
   * imperial height is typed as feet with inches beside them and the
   * bound belongs to the feet box a person is looking at.
   */
  function limits(given) {
    const out = {};
    const kinds = spec(given).units.kinds;
    Object.keys(kinds).forEach(function (kind) {
      const table = kinds[kind].units;
      Object.keys(table).forEach(function (unit) {
        if (typeof table[unit].min === "number" &&
            typeof table[unit].max === "number") {
          out[unit] = { min: table[unit].min, max: table[unit].max };
        }
      });
    });
    return out;
  }

  function choiceValues(name, given) {
    const one = field(name, given);
    return (one.choices || []).map(function (choice) {
      return choice.value;
    });
  }

  /*
   * The codes pinned at the top of every country dropdown, in the order
   * site.config.js lists them (owner ruling, 0.9-M2-S14, #380 ruling
   * 4). A spec written with no `countries` block at all - a fork that
   * has not touched this - pins nothing rather than throwing, the same
   * "ordinary rather than an error" shape unitsOf() gives a kind with
   * no units.
   */
  function pinnedCountries(given) {
    const countries = spec(given).countries;
    return countries && Array.isArray(countries.pinned)
      ? countries.pinned.slice() : [];
  }

  /*
   * `choices` - already in the order a page wants to offer them - with
   * every code in `pinned` moved to the FRONT as well, in `pinned`'s own
   * order. Nothing is removed: a pinned entry keeps its original place
   * too, so a reader scanning the alphabetical run still finds it there
   * (owner ruling, 0.9-M2-S14, #380 ruling 4 - "remain in their
   * alphabetical place below"). Setting a <select>'s value to a pinned
   * code lands on the FIRST matching <option>, which is the pinned one -
   * both options carry the same value, so it makes no difference which
   * is picked.
   *
   * A pinned code `choices` does not carry is skipped rather than
   * inserted with no label: this function only reorders what is
   * already offered, it does not invent an entry the underlying table
   * has no name for.
   */
  function orderedChoices(choices, pinned) {
    const byValue = {};
    choices.forEach(function (choice) { byValue[choice.value] = choice; });
    const front = (pinned || [])
      .filter(function (code) {
        return Object.prototype.hasOwnProperty.call(byValue, code);
      })
      .map(function (code) { return byValue[code]; });
    return front.concat(choices);
  }

  /* ---------------------------------------------------------------- */
  /* The group's name, and everything spelled out of it.               */

  function siteTitle(given) {
    const group = spec(given).group;
    return group.name + " " + group.binder;
  }

  /* The em dash is the separator every page's <title> uses, and it is
     written once here so a rename cannot leave five pages spelling the
     join five ways. */
  function pageTitle(page, given) {
    return page + " — " + siteTitle(given);
  }

  /* The two lines of the wordmark, top to bottom. A sequence rather
     than a pair of named values because the order is the mark: the
     group's name stands above the site's. */
  function wordmarkLines(given) {
    const group = spec(given).group;
    return [group.name, group.binder];
  }

  /* ---------------------------------------------------------------- */
  /* The measure list, which the charts draw.                          */

  /*
   * One chartable field, with everything a chart needs to draw it and
   * nothing about how it is drawn.
   *
   * `kind` here is the CHART's word, not the spec's: "bins" for
   * anything numeric and "categorical" for a list of choices. The two
   * vocabularies are separate on purpose - a spec says what a field IS
   * (a weight, a count, a choice) and a chart asks what shape of
   * answer it makes, and collapsing them would mean a new kind of
   * field could not be added without teaching the charts a new word.
   *
   * `unitful` says whether the measure reads a unit system at all. BMI
   * is binned and unitless; a count is binned and unitless too.
   */
  function measureFor(one, given) {
    const categorical = one.kind === "choice";
    const measure = {
      name: one.name,
      label: one.label,
      term: one.term,
      kind: categorical ? "categorical" : "bins",
      unitful: isMeasured(one),
    };

    if (categorical) {
      measure.choices = one.choices || [];
      measure.multiple = one.multiple === true;
      if (one.choicesFrom) measure.choicesFrom = one.choicesFrom;
      return measure;
    }

    if (measure.unitful) {
      const kind = kindSpec(one.kind, given);
      measure.units = {};
      Object.keys(kind.chart).forEach(function (system) {
        const unit = kind.chart[system];
        const entry = kind.units[unit];
        measure.units[system] = {
          unit: unit,
          store: entry.store,
          bin: entry.bin,
          band: entry.band,
        };
      });
      measure.base = kind.base;
      return measure;
    }

    // Unitless and numeric: a computed field, or a plain count. Both
    // carry their own band width, because there is no unit table to
    // read one off.
    measure.bin = one.bin;

    if (one.kind === "computed") {
      const derivation = DERIVATIONS[one.derivation];
      if (!derivation) {
        throw new Error('The spec asks for a "' + one.derivation +
          '" derivation on field "' + one.name + '", and apps/web/fields.js ' +
          "implements no such thing.");
      }
      measure.from = one.from;
      measure.places = one.places;
      // Bound to the field's own rounding, so a caller cannot get the
      // number at a precision the spec did not ask for.
      measure.compute = function (values) {
        return derivation(values, one.places);
      };
    }

    return measure;
  }

  /* Every field worth drawing, in the order the form asks them. A
     consent box is never one of them however a spec is edited: it is
     one bit, the same bit for everybody who got as far as submitting,
     and a chart of it says nothing about anybody. */
  function measures(given) {
    return fields(given)
      .filter(function (one) {
        return one.chart === true && NEVER_CHARTED.indexOf(one.kind) === -1;
      })
      .map(function (one) { return measureFor(one, given); });
  }

  function measure(name, given) {
    const found = measures(given).filter(function (one) {
      return one.name === name;
    })[0];
    if (!found) {
      throw new Error('No measure named "' + name + '" in the spec.');
    }
    return found;
  }

  function splitNames(given) {
    return measures(given).map(function (one) { return one.name; });
  }

  // The shipped spec, frozen now if it is already here. This is NOT
  // what guarantees the freeze - spec() is, on every read - and it must
  // not be read as the guarantee: on its own it holds in one <script>
  // order and silently not in the other, which is the defect this line
  // used to be. It stays because in the order where the spec is already
  // loaded it closes the gap between this file evaluating and the
  // page's first derivation, and that gap is a whole page render.
  if (root.BINDER_SITE) deepFreeze(root.BINDER_SITE);

  // Frozen for the reason every export here is: a page holds this
  // module for a session, and a helper another page could redefine is
  // a limit or a conversion factor another page could redefine.
  root.BinderFields = Object.freeze({
    kinds: function () { return KINDS.slice(); },
    field: field,
    names: names,
    labels: labels,
    isMeasured: isMeasured,
    unitsOf: unitsOf,
    defaultSystem: defaultSystem,
    systems: systems,
    factor: factor,
    convert: convert,
    enterUnit: enterUnit,
    compoundUnit: compoundUnit,
    limits: limits,
    choiceValues: choiceValues,
    pinnedCountries: pinnedCountries,
    orderedChoices: orderedChoices,
    siteTitle: siteTitle,
    pageTitle: pageTitle,
    wordmarkLines: wordmarkLines,
    measures: measures,
    measure: measure,
    splitNames: splitNames,
  });
})(globalThis);
