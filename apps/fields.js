/*
 * Everything that follows from apps/site.config.js.
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
 * ARITHMETIC IS CODE AND STAYS CODE. A computed field in the spec
 * names a `derivation`; DERIVATIONS below is the list of the ones that
 * exist, and an unknown name throws rather than yielding a measure
 * that quietly computes nothing. Letting the table carry a formula
 * would mean evaluating a string a fork owner typed, on the page that
 * handles cleartext - which is the one thing this project's CSP is
 * written to prevent.
 *
 * Pure. No document, no fetch, no storage: the wiring that will draw
 * these fields belongs to the pages, and 0.9-M2 is where they get it.
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

  function spec(given) {
    const site = given || root.BINDER_SITE;
    if (!site) {
      throw new Error("apps/site.config.js has not been loaded, so " +
        "nothing knows what this form asks.");
    }
    return site;
  }

  function fields(given) {
    return spec(given).fields;
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
          '" derivation on field "' + one.name + '", and apps/fields.js ' +
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

  deepFreeze(root.BINDER_SITE);

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
    factor: factor,
    convert: convert,
    limits: limits,
    choiceValues: choiceValues,
    siteTitle: siteTitle,
    pageTitle: pageTitle,
    wordmarkLines: wordmarkLines,
    measures: measures,
    measure: measure,
    splitNames: splitNames,
  });
})(globalThis);
