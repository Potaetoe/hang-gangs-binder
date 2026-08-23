

(function (root) {
  "use strict";

  const F = root.BinderFields;

   
   
   
   
  const HANDLE = /^[a-z0-9_]{5,32}$/;

   
   
   
  const RECORD_VERSION = 1;

  function round(value, places) {
    const factor = Math.pow(10, places);
    return Math.round(value * factor) / factor;
  }

  function isBlank(text) {
    return String(text == null ? "" : text).trim() === "";
  }

  

  function parseNumber(text) {
    const value = String(text == null ? "" : text).trim().replace(",", ".");
    if (value === "" || !/^-?\d*\.?\d+$/.test(value)) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  

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

  

  function plan(given) {
    return F.names(given)
      .map(function (name) { return F.field(name, given); })
      .filter(function (field) { return field.kind !== "computed"; })
      .map(function (field) { return planField(field, given); });
  }

   
   

  

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
      if (field.kind === "computed") return;  

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
       
      const parsed = parseMeasuredAmount(field, input.units, input, given);
      record[name] = parsed.ok
        ? measuredValueFrom(field.kind, parsed.unit, parsed.amount, given)
        : {};
    });

     
     
    addHeightFeetInches(record);

     
     
     
    record.entered = {
      units: input.units,
      weight: enteredText("weight", input, given),
      height: enteredText("height", input, given),
    };

    return record;
  }

   
   
   
   
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
      const alphabetical = Object.keys(countries).sort(function (a, b) {
        return countries[a].localeCompare(countries[b]);
      }).map(function (code) {
        return { value: code, label: countries[code] };
      });
       
       
       
      F.orderedChoices(alphabetical, F.pinnedCountries(root.BINDER_SITE))
        .forEach(function (choice) {
          select.appendChild(
            el("option", { value: choice.value, text: choice.label }));
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
       
       
       
       
      event.preventDefault();

      const session = root.BinderSession.read();
      const input = {
        units: currentUnits(),
        values: readValues(container),
      };
      const problems = validate(input, session ? session.username : null);
      if (problems.length) {
        

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
        say("", null);
        UI.showToast("Nothing was sent — reload and try again.");
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
        

        if (response.status === 401) {
          root.BinderSession.clear();
          submit.disabled = false;
          say("", null);
          UI.showToast("Nothing was stored — your sign-in is no longer " +
            "valid, so sign in again.");
          return;
        }
        if (!response.ok) {
          let detail = "";
          try {
            const body = await response.json();
            detail = body && body.error ? " " + body.error : "";
          } catch (e) {   }
          logDetail("submission refused with " + response.status + "." +
            detail);
          throw new Error("The service could not answer just now." + detail);
        }
      } catch (error) {
        submit.disabled = false;
        logDetail(error && error.message ? error.message
          : "the submission could not be sent");
        say("", null);
        UI.showToast("Nothing was stored — try again.");
        return;
      }

      document.dispatchEvent(new CustomEvent("binder:submitted"));

      submit.disabled = false;
      form.reset();
      applyUnits(container);
      say("", null);
      UI.showToast("Added — it now shows in your entries below.");
    });
  }
})(globalThis);
