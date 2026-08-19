/*
 * The entry form, rendered from the spec rather than hand-kept.
 *
 * apps/web/site.config.js says which fields exist, of what kind, in
 * what units and within what bounds; apps/web/fields.js turns that into
 * shapes this file can read. Nothing here names "weight" or "height" as
 * a special case except the one place the record CONTRACT itself is
 * fixed regardless of the spec - see `enteredText` below and
 * server/charts-agg.js's header, "AND THE ENVELOPE THE SPEC DOES NOT
 * NAME". Everywhere else, a field the spec adds gets a box, a bound and
 * a place in the record with no edit to this file - that property is
 * what tests/site-propagation.test.mjs proves for the derivation layer
 * and tests/your-page.test.mjs proves for this file's rendering.
 *
 * Two halves, split on purpose:
 *
 *   1. Pure functions - the plan a form would render, validation, and
 *      the record. No DOM, no network, no clock beyond one injected
 *      timestamp. Exported as BinderForm so a suite can load this exact
 *      file under Node, the same arrangement server/worker.js's own
 *      pure half is loaded under.
 *   2. The wiring, which only runs when there is a document: it turns
 *      the plan into real elements and turns what a member typed back
 *      into the values the pure half reads.
 *
 * WHAT THIS FILE NO LONGER DOES. Sealing before send is gone with every
 * other client-side crypto (DESIGN.md, "Trust model: the Worker reads"):
 * this file posts the record as plain JSON and the Worker seals it at
 * rest. The device-memory prefill and the height-change guard built on
 * it are gone too (#172's whole mechanism) - the server now answers
 * "what did I say last time", so a local copy bought nothing but a
 * privacy cost. tools/check_web.py's UNENCRYPTED_SENDERS names this
 * file for the same reason auth.js is already named there.
 */
(function (root) {
  "use strict";

  const F = root.BinderFields;

  // Telegram's own rule: 5-32 characters, letters, digits and
  // underscores. Checking it here means a typo is caught while the
  // submitter can still fix it, rather than becoming a handle nobody can
  // message four months later.
  const HANDLE = /^[a-z0-9_]{5,32}$/;

  // The record's own contract, exported so a mismatch against
  // server/charts-agg.js's header is a constant compared once rather
  // than a shape rebuilt in every reader.
  const RECORD_VERSION = 1;

  function round(value, places) {
    const factor = Math.pow(10, places);
    return Math.round(value * factor) / factor;
  }

  function isBlank(text) {
    return String(text == null ? "" : text).trim() === "";
  }

  /*
   * A number, or null. Deliberately strict: Number("") is 0 and
   * parseFloat("5kg") is 5, and both would sail through as a weight
   * nobody meant. A comma decimal is accepted because half the world
   * types one.
   */
  function parseNumber(text) {
    const value = String(text == null ? "" : text).trim().replace(",", ".");
    if (value === "" || !/^-?\d*\.?\d+$/.test(value)) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  /*
   * "@Handle", "handle", "t.me/handle" and "https://t.me/handle" all
   * name the same person, and all four get pasted. Everything below is
   * removal only - nothing is invented, so a handle that survives is
   * one the submitter actually typed.
   */
  function normalizeTelegram(text) {
    let value = String(text == null ? "" : text).trim();
    value = value.replace(/^https?:\/\//i, "");
    value = value.replace(/^(?:www\.)?t(?:elegram)?\.me\//i, "");
    value = value.replace(/^@+/, "");
    return value.toLowerCase();
  }

  function between(value, limit) {
    return value >= limit.min && value <= limit.max;
  }

  /* ------------------------------------------------------------------ */
  /* The plan: what the form must ask, derived from the spec alone.      */

  /*
   * One field's shape, in the vocabulary the wiring below builds a
   * control from. `kind` here is the spec's own kind, unlike
   * apps/web/fields.js's `measures()` which folds several kinds into
   * "bins" / "categorical" for a chart's purposes - this file needs to
   * know whether a field takes one box or two, which is a rendering
   * question rather than a charting one.
   */
  function planField(field, given) {
    const base = {
      name: field.name,
      kind: field.kind,
      label: field.label,
      term: field.term,
      required: field.required === true,
    };

    if (field.kind === "consent" || field.kind === "count") return base;

    if (field.kind === "choice") {
      return Object.assign(base, {
        multiple: field.multiple === true,
        blank: typeof field.blank === "string" ? field.blank : null,
        choicesFrom: field.choicesFrom || null,
        choices: field.choicesFrom ? null : (field.choices || []).slice(),
      });
    }

    // weight / length: one box per unit system, a second beside it when
    // the system's unit is compound (feet next to inches).
    const limits = F.limits(given);
    const units = {};
    F.systems(given).forEach(function (system) {
      const unit = F.enterUnit(field.kind, system, given);
      const compoundUnit = F.compoundUnit(unit, given);
      units[system] = {
        unit: unit,
        limits: limits[unit] || null,
        compoundUnit: compoundUnit,
        compoundLimits: compoundUnit ? limits[compoundUnit] || null : null,
      };
    });
    return Object.assign(base, { unitKind: field.kind, units: units });
  }

  /*
   * Every field worth a control, in the form's order - a computed field
   * is never asked for, which is what makes it computed (#278's own
   * rule, restated for rendering rather than for charting).
   */
  function plan(given) {
    return F.names(given)
      .map(function (name) { return F.field(name, given); })
      .filter(function (field) { return field.kind !== "computed"; })
      .map(function (field) { return planField(field, given); });
  }

  /* ------------------------------------------------------------------ */
  /* Reading one measured field's typed amount, in its own enter unit.   */

  /*
   * `input.values` carries whatever the wiring collected: `values[name]`
   * for a field's main box, `values[name + "Compound"]` for the second
   * one when the field's plan entry says there is one. This is the one
   * function both validate() and buildRecord() call, so the two can
   * never disagree about what was typed.
   */
  function parseMeasuredAmount(field, system, input, given) {
    const unit = F.enterUnit(field.kind, system, given);
    const compoundUnit = F.compoundUnit(unit, given);
    const main = parseNumber(input.values[field.name]);
    if (main === null) return { ok: false, unit: unit, compoundUnit: compoundUnit };

    if (!compoundUnit) {
      return { ok: true, unit: unit, compoundUnit: null, amount: main,
        mainValue: main };
    }

    const compoundRaw = input.values[field.name + "Compound"];
    const compoundValue = isBlank(compoundRaw) ? 0 : parseNumber(compoundRaw);
    if (compoundValue === null) {
      return { ok: false, unit: unit, compoundUnit: compoundUnit,
        compoundBad: true };
    }
    const compoundInMain = F.convert(compoundValue, compoundUnit, unit, given);
    return { ok: true, unit: unit, compoundUnit: compoundUnit,
      amount: main + (compoundInMain || 0), mainValue: main,
      compoundValue: compoundValue };
  }

  /*
   * A measured amount, converted to every unit the kind's table names -
   * apps/web/site.config.js's `store` property says which key each one
   * writes, exactly as server/charts-agg.js's header requires
   * (record[name].kg, record[name].lb, and so on). A unit with no
   * `store` - imperial length's "ft" - is compound-only and is never a
   * key of its own; the total it describes already reached this
   * function as `amount` in `unit`.
   */
  function measuredValueFrom(kind, unit, amount, given) {
    const table = F.unitsOf(kind, given);
    const out = {};
    Object.keys(table).forEach(function (candidate) {
      if (!table[candidate].store) return;
      const value = F.convert(amount, unit, candidate, given);
      if (value !== null) out[table[candidate].store] = round(value, 1);
    });
    return out;
  }

  /*
   * height.feet / height.inches, added to the "height" field's own
   * value only - not derived from the spec's unit table, because
   * neither is a `store` name any unit there declares: a compound entry
   * (feet next to inches) is a way to TYPE an amount, not a second
   * property every length-kind field owes a reader. This one field
   * keeps them anyway because the pin comment on #353 (issue 5335377958)
   * is explicit that the record matches the pre-0.9 one exactly, and
   * the pre-0.9 record carried both alongside cm and totalInches -
   * admin.js's CSV still reads them by name. Silent no-op on a fork
   * that renamed "height" away, same as enteredText() above.
   */
  function addHeightFeetInches(record) {
    if (!record || typeof record.height !== "object") return;
    const totalInches = record.height.totalInches;
    if (typeof totalInches !== "number") return;
    let feet = Math.floor(totalInches / 12);
    let inches = round(totalInches - feet * 12, 1);
    if (inches >= 12) { feet += 1; inches = 0; }
    record.height.feet = feet;
    record.height.inches = inches;
  }

  /*
   * The typed string a record's `entered` envelope keeps for weight and
   * height - "200 lb", "5 ft 10 in", "90 kg". Fixed to these two names
   * regardless of the spec: server/charts-agg.js's header lists `entered
   * {units, weight, height}` as part of the envelope the spec does not
   * name, matching the pre-0.9 record exactly, so this is not derived
   * the way the rest of buildRecord is. A spec with no field named
   * "weight" or "height" gets an empty string here rather than a throw -
   * the envelope is best-effort on a fork that renamed them, and the
   * spec-named half of the record is unaffected either way.
   */
  function enteredText(name, input, given) {
    let field;
    try { field = F.field(name, given); } catch (error) { return ""; }
    const parsed = parseMeasuredAmount(field, input.units, input, given);
    if (!parsed.ok) return "";
    const main = String(input.values[name]).trim() + " " + parsed.unit;
    if (!parsed.compoundUnit) return main;
    const compoundRaw = input.values[name + "Compound"];
    return main + " " +
      (isBlank(compoundRaw) ? "0" : String(compoundRaw).trim()) + " " +
      parsed.compoundUnit;
  }

  /* ------------------------------------------------------------------ */
  /* Validation: every problem with a filled-in form, as                */
  /* [{ field, message }]. All of them at once rather than the first -   */
  /* a form that reveals one fault per attempt is three round trips for  */
  /* someone who mistyped two things.                                   */

  function validateMeasured(field, input, given) {
    const system = input.units;
    const unit = F.enterUnit(field.kind, system, given);
    const compoundUnit = F.compoundUnit(unit, given);
    const limits = F.limits(given);
    const main = parseNumber(input.values[field.name]);

    if (!compoundUnit) {
      if (main === null) {
        return [{ field: field.name,
          message: "Enter " + field.term + " in " + unit + ", as a number." }];
      }
      if (limits[unit] && !between(main, limits[unit])) {
        return [{ field: field.name,
          message: "That " + field.term + " is outside what this form " +
            "accepts (" + limits[unit].min + " to " + limits[unit].max +
            " " + unit + ") — check the units." }];
      }
      return [];
    }

    if (main === null) {
      return [{ field: field.name,
        message: "Enter " + field.term + " as " + unit + " and " +
          compoundUnit + "." }];
    }
    const compoundRaw = input.values[field.name + "Compound"];
    const compoundBlank = isBlank(compoundRaw);
    const compound = compoundBlank ? 0 : parseNumber(compoundRaw);
    if (compound === null) {
      return [{ field: field.name,
        message: "The " + compoundUnit + " part is not a number — leave " +
          "it empty for a round number of " + unit + "." }];
    }
    const perMain = F.convert(1, unit, compoundUnit, given);
    if (Number.isFinite(perMain) && (compound < 0 || compound >= perMain)) {
      return [{ field: field.name,
        message: compoundUnit[0].toUpperCase() + compoundUnit.slice(1) +
          "s go from 0 to " + (perMain - 1) + " - anything more is " +
          "another " + unit + "." }];
    }
    if (limits[unit] && !between(main, limits[unit])) {
      return [{ field: field.name,
        message: "That " + field.term + " is outside what this form " +
          "accepts (" + limits[unit].min + " to " + limits[unit].max +
          " " + unit + ")." }];
    }
    return [];
  }

  function validateOne(field, input, given) {
    if (field.kind === "consent") {
      if (field.required && input.values[field.name] !== true) {
        return [{ field: field.name,
          message: field.label + " — tick the box to continue." }];
      }
      return [];
    }
    if (field.kind === "choice") {
      if (!field.required) return [];
      const value = input.values[field.name];
      const empty = field.multiple
        ? !(Array.isArray(value) && value.length)
        : (value === undefined || value === null || value === "");
      return empty
        ? [{ field: field.name, message: field.label + " is required." }]
        : [];
    }
    if (field.kind === "count") {
      if (!field.required) return [];
      return parseNumber(input.values[field.name]) === null
        ? [{ field: field.name, message: field.label + " is required." }]
        : [];
    }
    return validateMeasured(field, input, given);
  }

  function validate(input, sessionUsername, given) {
    const problems = [];

    /*
     * The one-argument form preserves validation for unverified input in
     * the pure API. The page passes the Worker's verified session
     * username explicitly: it must exist, but this page must not reject
     * a real Telegram account merely because its local HANDLE rule is
     * narrower than the identity provider's.
     */
    const fromSession = sessionUsername !== undefined;
    const handle = normalizeTelegram(
      fromSession ? sessionUsername : input.telegram);
    if (!handle) {
      problems.push({
        field: "telegram",
        message: fromSession
          ? "Your session no longer has a Telegram username — sign in " +
            "again."
          : "Your Telegram username is needed — it is how you are " +
            "identified here.",
      });
    } else if (!fromSession && !HANDLE.test(handle)) {
      problems.push({
        field: "telegram",
        message: "That does not look like a Telegram username — 5 to 32 " +
          "letters, numbers and underscores.",
      });
    }

    F.names(given).forEach(function (name) {
      const field = F.field(name, given);
      if (field.kind === "computed") return;
      problems.push.apply(problems, validateOne(field, input, given));
    });

    return problems;
  }

  /* ------------------------------------------------------------------ */
  /* The record, matching server/charts-agg.js's header exactly.         */

  /*
   * Assumes validate() came back empty; callers that skip it get
   * whatever they deserve. The session username is mandatory even then:
   * without it the record builder refuses rather than falling back to
   * member-editable input.
   *
   * `now` is a parameter rather than a call to Date.now() so a caller
   * can assert on a fixed record. It is also the only clock in the
   * record the submitter's machine controls - the Worker adds its own
   * receipt timestamp (`received_at`), and the two disagreeing is
   * information rather than a bug.
   */
  function buildRecord(input, now, sessionUsername, given) {
    const telegram = normalizeTelegram(sessionUsername);
    if (!telegram) {
      throw new Error("A verified session username is required.");
    }

    const record = {
      record: RECORD_VERSION,
      submittedAt: new Date(now).toISOString(),
      telegram: telegram,
    };

    F.names(given).forEach(function (name) {
      const field = F.field(name, given);
      if (field.kind === "computed") return; // never stored

      if (field.kind === "consent") {
        record[name] = input.values[name] === true;
        return;
      }
      if (field.kind === "count") {
        record[name] = parseNumber(input.values[name]);
        return;
      }
      if (field.kind === "choice") {
        if (field.multiple) {
          const chosen = Array.isArray(input.values[name])
            ? input.values[name] : [];
          const allowed = field.choicesFrom ? null : F.choiceValues(name, given);
          record[name] = allowed
            ? chosen.filter(function (v) { return allowed.indexOf(v) !== -1; })
            : chosen.slice();
          return;
        }
        const raw = input.values[name];
        const allowed = field.choicesFrom ? null : F.choiceValues(name, given);
        record[name] = (raw && (allowed === null || allowed.indexOf(raw) !== -1))
          ? raw : null;
        return;
      }
      // weight / length.
      const parsed = parseMeasuredAmount(field, input.units, input, given);
      record[name] = parsed.ok
        ? measuredValueFrom(field.kind, parsed.unit, parsed.amount, given)
        : {};
    });

    // "height" only, and fixed rather than derived - see
    // addHeightFeetInches()'s own header for why.
    addHeightFeetInches(record);

    // The envelope the spec does not name (server/charts-agg.js's
    // header) - see enteredText() above for why this half is fixed
    // rather than derived.
    record.entered = {
      units: input.units,
      weight: enteredText("weight", input, given),
      height: enteredText("height", input, given),
    };

    return record;
  }

  // Frozen because your-page.html holds the submission before it is
  // posted: an export a later script can rewrite is a `validate` that
  // waves anything through, or a `buildRecord` that quietly adds a field
  // to what gets stored.
  root.BinderForm = Object.freeze({
    RECORD_VERSION: RECORD_VERSION,
    HANDLE: HANDLE,
    normalizeTelegram: normalizeTelegram,
    parseNumber: parseNumber,
    plan: plan,
    measuredValueFrom: measuredValueFrom,
    parseMeasuredAmount: parseMeasuredAmount,
    validate: validate,
    buildRecord: buildRecord,
  });

  /* ---------------------------------------------------------------- */
  /* The wiring. Everything above this line runs under Node.          */

  if (typeof document === "undefined") return;

  const UI = root.BinderUI;
  const $ = UI.byId;
  const show = UI.show;

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    (children || []).forEach(function (child) {
      if (child) node.appendChild(child);
    });
    if (!attrs) return node;
    Object.keys(attrs).forEach(function (key) {
      if (key === "text") node.textContent = attrs[key];
      else if (key === "class") node.className = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    return node;
  }

  /*
   * One measured field's markup: a labeled row per unit system, the
   * units toggle hides one of the two. `data-units="<system>"` is what
   * applyUnits() below reads to decide which row to show - written as
   * data on the row itself rather than inferred from a fixed id pair,
   * so a third unit system in `apps/web/site.config.js` would render a
   * third row with nothing here to edit.
   */
  function buildMeasuredField(entry) {
    const wrap = el("div", { class: "field" });
    F.systems().forEach(function (system) {
      const spec = entry.units[system];
      const row = el("div", { class: "row", "data-units": system });
      const mainId = "entry-" + entry.name + "-" + system;
      row.appendChild(el("input", {
        type: "text", id: mainId, "data-field": entry.name,
        "data-system": system, inputmode: "decimal", autocomplete: "off",
        "aria-describedby": "error-" + entry.name,
      }));
      row.appendChild(el("span", { class: "suffix", text: spec.unit }));
      if (spec.compoundUnit) {
        row.appendChild(el("input", {
          type: "text", id: mainId + "-compound", "data-field": entry.name,
          "data-system": system, "data-compound": "true",
          inputmode: "decimal", autocomplete: "off",
          "aria-describedby": "error-" + entry.name,
        }));
        row.appendChild(el("span", { class: "suffix", text: spec.compoundUnit }));
      }
      const labeled = el("div", {}, [
        el("label", { for: mainId, text: entry.label }),
        row,
      ]);
      labeled.setAttribute("data-units-group", system);
      wrap.appendChild(labeled);
    });
    wrap.appendChild(el("p", {
      class: "field-error", id: "error-" + entry.name, hidden: "",
    }));
    return wrap;
  }

  /*
   * Both branches gain the same <p class="field-error"> slot
   * buildMeasuredField, buildConsentField and buildCountField already
   * carry (0.9-M2-S2 fix wave 1, finding F6). Before this, a required
   * choice with nothing selected had NOWHERE for showProblems() to
   * write its message: $("error-" + name) found no element, so the
   * refusal was total silence - latent today because no shipped choice
   * is required, and exactly the property a fork setting one would hit
   * first.
   */
  function buildChoiceField(entry) {
    if (entry.multiple) {
      const fieldset = el("fieldset", { class: "field" }, [
        el("legend", { text: entry.label }),
      ]);
      const choices = el("div", { class: "choices" });
      (entry.choices || []).forEach(function (choice) {
        choices.appendChild(el("label", { class: "choice" }, [
          el("input", { type: "checkbox", name: entry.name,
            value: choice.value }),
          el("span", { text: choice.label }),
        ]));
      });
      fieldset.appendChild(choices);
      fieldset.appendChild(el("p", {
        class: "field-error", id: "error-" + entry.name, hidden: "",
      }));
      return fieldset;
    }

    const select = el("select", { id: "entry-" + entry.name });
    select.appendChild(el("option", { value: "", text: entry.blank || "" }));
    if (entry.choicesFrom) {
      const countries = root.BINDER_COUNTRIES || {};
      Object.keys(countries).sort(function (a, b) {
        return countries[a].localeCompare(countries[b]);
      }).forEach(function (code) {
        select.appendChild(el("option", { value: code, text: countries[code] }));
      });
    } else {
      (entry.choices || []).forEach(function (choice) {
        select.appendChild(el("option", { value: choice.value,
          text: choice.label }));
      });
    }
    return el("div", { class: "field" }, [
      el("label", { for: "entry-" + entry.name, text: entry.label }),
      select,
      el("p", { class: "field-error", id: "error-" + entry.name, hidden: "" }),
    ]);
  }

  function buildConsentField(entry) {
    return el("div", { class: "field" }, [
      el("label", { class: "choice" }, [
        el("input", { type: "checkbox", id: "entry-" + entry.name,
          "data-field": entry.name,
          "aria-describedby": "error-" + entry.name }),
        el("span", { text: entry.label }),
      ]),
      el("p", { class: "field-error", id: "error-" + entry.name, hidden: "" }),
    ]);
  }

  function buildCountField(entry) {
    return el("div", { class: "field" }, [
      el("label", { for: "entry-" + entry.name, text: entry.label }),
      el("input", { type: "text", id: "entry-" + entry.name,
        "data-field": entry.name, inputmode: "numeric", autocomplete: "off",
        "aria-describedby": "error-" + entry.name }),
      el("p", { class: "field-error", id: "error-" + entry.name, hidden: "" }),
    ]);
  }

  /*
   * The whole form, one control per plan entry, in the spec's order.
   * Nothing here is a field name: a fork that adds a row to
   * apps/web/site.config.js gets a control for it with this function
   * unedited.
   */
  function renderFields(container) {
    while (container.firstChild) container.removeChild(container.firstChild);
    plan().forEach(function (entry) {
      let node;
      if (entry.kind === "consent") node = buildConsentField(entry);
      else if (entry.kind === "choice") node = buildChoiceField(entry);
      else if (entry.kind === "count") node = buildCountField(entry);
      else node = buildMeasuredField(entry);
      container.appendChild(node);
    });
  }

  function currentUnits() {
    return UI.checkedValue("units", F.defaultSystem());
  }

  /* Shows the row for the chosen unit system and hides every other one,
     for every measured field at once - one loop rather than one call
     per field, so a field the spec adds is covered with nothing here to
     edit. */
  function applyUnits(container) {
    const units = currentUnits();
    Array.prototype.forEach.call(
      container.querySelectorAll("[data-units-group]"),
      function (group) {
        show(group, group.getAttribute("data-units-group") === units);
      });
  }

  function readValues(container) {
    const values = {};
    plan().forEach(function (entry) {
      if (entry.kind === "consent") {
        const box = $("entry-" + entry.name);
        values[entry.name] = Boolean(box && box.checked);
        return;
      }
      if (entry.kind === "choice" && entry.multiple) {
        values[entry.name] = Array.prototype.map.call(
          container.querySelectorAll(
            'input[name="' + entry.name + '"]:checked'),
          function (input) { return input.value; });
        return;
      }
      if (entry.kind === "choice" || entry.kind === "count") {
        const field = $("entry-" + entry.name);
        values[entry.name] = field ? field.value : "";
        return;
      }
      const units = currentUnits();
      const main = $("entry-" + entry.name + "-" + units);
      values[entry.name] = main ? main.value : "";
      const compoundField = $("entry-" + entry.name + "-" + units + "-compound");
      if (compoundField) values[entry.name + "Compound"] = compoundField.value;
    });
    return values;
  }

  function inputsFor(name) {
    return Array.prototype.slice.call(
      document.querySelectorAll('[data-field="' + name + '"]'));
  }

  function clearProblems() {
    plan().forEach(function (entry) {
      const slot = $("error-" + entry.name);
      if (slot) {
        slot.textContent = "";
        slot.hidden = true;
      }
      inputsFor(entry.name).forEach(function (input) {
        input.removeAttribute("aria-invalid");
      });
    });
  }

  function showProblems(problems) {
    clearProblems();
    problems.forEach(function (problem) {
      const slot = $("error-" + problem.field);
      if (slot) {
        slot.textContent = problem.message;
        slot.hidden = false;
      }
      inputsFor(problem.field).forEach(function (input) {
        input.setAttribute("aria-invalid", "true");
      });
    });
    const first = problems[0] && $("error-" + problems[0].field);
    if (first) first.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  /*
   * The technical half of a failure, written where a developer looks -
   * #265 rows 13 and 50. A refused POST names a status number; none of
   * it is anything a member can act on.
   */
  function logDetail(detail) {
    if (detail && root.console && typeof root.console.warn === "function") {
      root.console.warn("binder: " + detail);
    }
  }

  UI.boot(setUp, function (error) {
    show($("submission"), false);
    const closed = $("closed");
    show(closed, true);
    if (closed) {
      const reason = closed.querySelector("[data-reason]");
      if (reason) {
        reason.textContent = "This page did not start up correctly, so " +
          "the form is hidden — nothing you type would be sent." +
          (error && error.message ? " (" + error.message + ")" : "");
      }
    }
  });

  function setUp() {
    const form = $("submission");
    const container = $("entry-fields");
    const submit = $("submit");
    const status = $("status");
    const config = root.BINDER_CONFIG || {};
    if (!root.BinderSession) {
      throw new Error("This page did not load its session handling.");
    }
    const member = root.BinderSession.require();

    // session.js starts the redirect before this setup runs. Keep the
    // form hidden as well: if navigation is delayed, a signed-out
    // visitor must not get a usable-looking form whose request the
    // Worker will refuse.
    if (!member) {
      show(form, false);
      return;
    }

    if (!config.endpoint) {
      show(form, false);
      show($("closed"), true);
      const reason = $("closed") && $("closed").querySelector("[data-reason]");
      if (reason) {
        reason.textContent = "This site is not set up to reach the " +
          "service that keeps your entries.";
      }
      return;
    }

    renderFields(container);
    Array.prototype.forEach.call(
      document.querySelectorAll('input[name="units"]'),
      function (input) { input.addEventListener("change", function () {
        applyUnits(container);
        clearProblems();
      }); });
    applyUnits(container);

    function say(message, tone) {
      UI.setStatus(status, message, tone);
    }

    form.addEventListener("submit", async function (event) {
      // The page never does a native submit - the CSP's form-action
      // 'none' would block it anyway - but preventing it first means a
      // thrown error below cannot turn into a navigation that discards
      // what was typed.
      event.preventDefault();

      const session = root.BinderSession.read();
      const input = {
        units: currentUnits(),
        values: readValues(container),
      };
      const problems = validate(input, session ? session.username : null);
      if (problems.length) {
        /*
         * The session problem, when there is one, over every other
         * problem - it has no field-level slot of its own (there is no
         * visible "telegram" control on this page for showProblems() to
         * write into), so the general status line is the only place a
         * member ever sees it. Every other problem DOES get its own
         * inline slot from showProblems() below, but the status line
         * still says something rather than nothing (0.9-M2-S2 fix wave
         * 1, finding F6): a required choice with no error slot used to
         * refuse in total silence, and closing that gap at the field
         * means nothing if the general status stays blank too - a
         * member scanning the top of the form for what went wrong
         * would see no acknowledgment that anything did.
         */
        const sessionProblem = problems.find(function (problem) {
          return problem.field === "telegram";
        });
        say((sessionProblem || problems[0]).message, "bad");
        showProblems(problems);
        return;
      }
      clearProblems();

      submit.disabled = true;
      say("Sending…", null);

      let record = null;
      try {
        record = buildRecord(input, Date.now(),
          session ? session.username : null);
      } catch (error) {
        submit.disabled = false;
        logDetail(error && error.message ? error.message
          : "record building failed with no message");
        say("Nothing was sent — reload and try again.", "bad");
        return;
      }

      try {
        const response = await fetch(config.endpoint + "/submit", {
          method: "POST",
          headers: Object.assign(
            { "Content-Type": "application/json" },
            root.BinderSession.authorization()),
          body: JSON.stringify({ record: JSON.stringify(record) }),
        });
        /*
         * A dead session, which is not a refused entry - #166. The page
         * stays: a member who has just typed an entry and pressed Send
         * is told what happened and left holding it, rather than
         * navigated away.
         */
        if (response.status === 401) {
          root.BinderSession.clear();
          submit.disabled = false;
          say("Nothing was stored — your sign-in is no longer valid, so " +
            "sign in again.", "bad");
          return;
        }
        if (!response.ok) {
          let detail = "";
          try {
            const body = await response.json();
            detail = body && body.error ? " " + body.error : "";
          } catch (e) { /* a non-JSON error page says enough by its status */ }
          logDetail("submission refused with " + response.status + "." +
            detail);
          throw new Error("The service could not answer just now." + detail);
        }
      } catch (error) {
        submit.disabled = false;
        logDetail(error && error.message ? error.message
          : "the submission could not be sent");
        say("Nothing was stored — try again.", "bad");
        return;
      }

      document.dispatchEvent(new CustomEvent("binder:submitted"));

      submit.disabled = false;
      form.reset();
      applyUnits(container);
      say("Added — it now shows in your entries below.", null);
    });
  }
})(globalThis);
