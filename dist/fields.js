

(function (root) {
  "use strict";

   
   
   
   
  const KINDS = Object.freeze([
    "weight", "length", "count", "choice", "computed", "consent",
  ]);

   
  const MEASURED = Object.freeze(["weight", "length"]);

   
  const NEVER_CHARTED = Object.freeze(["consent"]);

  function round(value, places) {
    const factor = Math.pow(10, places);
    return Math.round(value * factor) / factor;
  }

  function num(value) {
    return typeof value === "number" && Number.isFinite(value)
      ? value : null;
  }

  

  const DERIVATIONS = Object.freeze({
    bmi: function (values, places) {
      const kg = num(values.weight);
      const cm = num(values.height);
      if (kg === null || cm === null || cm <= 0) return null;
      const meters = cm / 100;
      return round(kg / (meters * meters), places);
    },
  });

   
   

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
      throw new Error("apps/web/site.config.js has not been loaded, so " +
        "nothing knows what this form asks: it goes in a <script> tag " +
        "before this file, or it is passed in.");
    }
    return deepFreeze(site);
  }

  

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

  

  function unitsOf(kind, given) {
    const found = kindSpec(kind, given);
    return found ? found.units : {};
  }

  function defaultSystem(given) {
    return spec(given).units.default;
  }

  

  function systems(given) {
    return spec(given).units.systems.slice();
  }

  

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

  

  function enterUnit(kind, system, given) {
    const found = kindSpec(kind, given);
    return found && found.enter ? found.enter[system] || null : null;
  }

  

  function compoundUnit(unit, given) {
    const home = unitHome(unit, given);
    if (!home) return null;
    const compound = spec(given).units.kinds[home.kind].compound;
    return compound && Object.prototype.hasOwnProperty.call(compound, unit)
      ? compound[unit] : null;
  }

  

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

  

  function pinnedCountries(given) {
    const countries = spec(given).countries;
    return countries && Array.isArray(countries.pinned)
      ? countries.pinned.slice() : [];
  }

  

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

   
   

  function siteTitle(given) {
    const group = spec(given).group;
    return group.name + " " + group.binder;
  }

  

  function pageTitle(page, given) {
    return page + " — " + siteTitle(given);
  }

  

  function wordmarkLines(given) {
    const group = spec(given).group;
    return [group.name, group.binder];
  }

   
   

  

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
       
       
      measure.compute = function (values) {
        return derivation(values, one.places);
      };
    }

    return measure;
  }

  

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

   
   
   
   
   
   
   
  if (root.BINDER_SITE) deepFreeze(root.BINDER_SITE);

   
   
   
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
