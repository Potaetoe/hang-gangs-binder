

(function (root) {
  "use strict";

   
   
   
  const KG_PER_LB = 0.45359237;
  const CM_PER_IN = 2.54;
  const IN_PER_FT = 12;

  


   
   
   
   
  const LIMITS = {
    kg: { min: 20, max: 500 },
    lb: { min: 44, max: 1100 },
    cm: { min: 100, max: 250 },
    ft: { min: 3, max: 8 },
  };

  const GENDERS = ["male", "female", "nonbinary", "other"];
  const ROLES = ["feeder", "feedee", "gainer", "admirer"];

   
   
   
   
  const HANDLE = /^[a-z0-9_]{5,32}$/;

  function round(value, places) {
    const factor = Math.pow(10, places);
    return Math.round(value * factor) / factor;
  }

  

  function normalizeTelegram(text) {
    let value = String(text == null ? "" : text).trim();
    value = value.replace(/^https?:\/\//i, "");
    value = value.replace(/^(?:www\.)?t(?:elegram)?\.me\//i, "");
    value = value.replace(/^@+/, "");
    return value.toLowerCase();
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

  function weightFromKg(kg) {
    return { kg: round(kg, 1), lb: round(kg / KG_PER_LB, 1) };
  }

  function weightFromLb(lb) {
    return { kg: round(lb * KG_PER_LB, 1), lb: round(lb, 1) };
  }

  

  function heightFrom(totalInches) {
    let feet = Math.floor(totalInches / IN_PER_FT);
    let inches = round(totalInches - feet * IN_PER_FT, 1);
     
     
    if (inches >= IN_PER_FT) {
      feet += 1;
      inches = 0;
    }
    return {
      cm: round(totalInches * CM_PER_IN, 1),
      totalInches: round(totalInches, 1),
      feet: feet,
      inches: inches,
    };
  }

  function heightFromCm(cm) {
    return heightFrom(cm / CM_PER_IN);
  }

  function heightFromFeetInches(feet, inches) {
    return heightFrom(feet * IN_PER_FT + inches);
  }

  function between(value, limit) {
    return value >= limit.min && value <= limit.max;
  }

  

  function validate(input, sessionUsername) {
    const problems = [];
    const imperial = input.units === "imperial";

    

    const fromSession = sessionUsername !== undefined;
    const handle = normalizeTelegram(
      fromSession ? sessionUsername : input.telegram);
    if (!handle) {
      problems.push({
        field: "telegram",
        message: fromSession
          ? "Your session no longer has a Telegram username. Sign in again " +
            "before submitting."
          : "Your Telegram username is needed - it is how you are " +
            "identified here.",
      });
    } else if (!fromSession && !HANDLE.test(handle)) {
      problems.push({
        field: "telegram",
        message: "That does not look like a Telegram username. They are 5 to " +
          "32 characters, using only letters, numbers and underscores.",
      });
    }

    const weightUnit = imperial ? "lb" : "kg";
    const weight = parseNumber(imperial ? input.weightLb : input.weightKg);
    if (weight === null) {
      problems.push({
        field: "weight",
        message: "Enter your weight in " + weightUnit + ", as a number.",
      });
    } else if (!between(weight, LIMITS[weightUnit])) {
      problems.push({
        field: "weight",
        message: "That weight is outside what this form accepts (" +
          LIMITS[weightUnit].min + " to " + LIMITS[weightUnit].max + " " +
          weightUnit + "). Check the units.",
      });
    }

    if (imperial) {
      const feet = parseNumber(input.heightFeet);
      const inches = isBlank(input.heightInches)
        ? 0 : parseNumber(input.heightInches);
      if (feet === null) {
        problems.push({
          field: "height",
          message: "Enter your height as feet and inches.",
        });
      } else if (inches === null) {
        problems.push({
          field: "height",
          message: "The inches part is not a number. Leave it empty for a " +
            "round number of feet.",
        });
      } else if (inches < 0 || inches >= IN_PER_FT) {
        problems.push({
          field: "height",
          message: "Inches go from 0 to 11 - anything more is another foot.",
        });
      } else if (!between(feet, LIMITS.ft)) {
        problems.push({
          field: "height",
          message: "That height is outside what this form accepts (" +
            LIMITS.ft.min + " to " + LIMITS.ft.max + " feet).",
        });
      }
    } else {
      const cm = parseNumber(input.heightCm);
      if (cm === null) {
        problems.push({
          field: "height",
          message: "Enter your height in cm, as a number.",
        });
      } else if (!between(cm, LIMITS.cm)) {
        problems.push({
          field: "height",
          message: "That height is outside what this form accepts (" +
            LIMITS.cm.min + " to " + LIMITS.cm.max + " cm). Check the units.",
        });
      }
    }

     
     
    if (input.over18 !== true) {
      problems.push({
        field: "over18",
        message: "This form is 18+ only. Please confirm.",
      });
    }

    return problems;
  }

  

  function enteredHeightCm(input) {
    if (input.units === "imperial") {
      const feet = parseNumber(input.heightFeet);
      const inches = isBlank(input.heightInches)
        ? 0 : parseNumber(input.heightInches);
      if (feet === null || inches === null) return null;
      return heightFromFeetInches(feet, inches).cm;
    }
    const cm = parseNumber(input.heightCm);
    return cm === null ? null : heightFromCm(cm).cm;
  }

  function spellHeight(height, imperial) {
    return imperial
      ? height.feet + " ft " + height.inches + " in"
      : height.cm + " cm";
  }

  

  const HEIGHT_CHANGE_CM = 5;

  function heightChangeNotice(input, previousCm) {
     
     
     
     
     
    if (typeof previousCm !== "number" || !Number.isFinite(previousCm)) {
      return null;
    }
    const entered = enteredHeightCm(input);
     
     
    if (entered === null) return null;
    if (Math.abs(entered - previousCm) <= HEIGHT_CHANGE_CM) return null;

    const imperial = input.units === "imperial";
    return {
      field: "height",
      message: "This browser remembers your last height here as " +
        spellHeight(heightFromCm(previousCm), imperial) +
        ", and this entry says " +
        spellHeight(heightFromCm(entered), imperial) +
        ". If that is right, add it again to confirm.",
    };
  }

  

  function buildRecord(input, now, sessionUsername) {
    const telegram = normalizeTelegram(sessionUsername);
    if (!telegram) {
      throw new Error("A verified session username is required.");
    }

    const imperial = input.units === "imperial";

    let weight;
    let height;
    let enteredWeight;
    let enteredHeight;

    if (imperial) {
      const lb = parseNumber(input.weightLb);
      const feet = parseNumber(input.heightFeet);
      const inches = isBlank(input.heightInches)
        ? 0 : parseNumber(input.heightInches);
      weight = weightFromLb(lb);
      height = heightFromFeetInches(feet, inches);
      enteredWeight = String(input.weightLb).trim() + " lb";
      enteredHeight = String(input.heightFeet).trim() + " ft " +
        (isBlank(input.heightInches) ? "0" : String(input.heightInches).trim()) +
        " in";
    } else {
      const kg = parseNumber(input.weightKg);
      const cm = parseNumber(input.heightCm);
      weight = weightFromKg(kg);
      height = heightFromCm(cm);
      enteredWeight = String(input.weightKg).trim() + " kg";
      enteredHeight = String(input.heightCm).trim() + " cm";
    }

    const roles = Array.isArray(input.roles)
      ? input.roles.filter(function (r) { return ROLES.indexOf(r) !== -1; })
      : [];

    const gender = GENDERS.indexOf(input.gender) !== -1 ? input.gender : null;
    const country = /^[A-Z]{2}$/.test(String(input.country || ""))
      ? input.country : null;

    return {
       
       
       
       
      record: 1,
      submittedAt: new Date(now).toISOString(),
      telegram: telegram,
      weight: weight,
      height: height,
      entered: {
        units: imperial ? "imperial" : "metric",
        weight: enteredWeight,
        height: enteredHeight,
      },
      gender: gender,
      roles: roles,
      country: country,
      over18: true,
    };
  }

   
   
   
   
  root.BinderForm = Object.freeze({
    KG_PER_LB: KG_PER_LB,
    CM_PER_IN: CM_PER_IN,
    LIMITS: LIMITS,
    GENDERS: GENDERS,
    ROLES: ROLES,
    normalizeTelegram: normalizeTelegram,
    parseNumber: parseNumber,
    weightFromKg: weightFromKg,
    weightFromLb: weightFromLb,
    heightFromCm: heightFromCm,
    heightFromFeetInches: heightFromFeetInches,
    validate: validate,
    heightChangeNotice: heightChangeNotice,
    buildRecord: buildRecord,
  });

   
   

  if (typeof document === "undefined") return;

  const UI = root.BinderUI;
  const $ = UI.byId;
  const show = UI.show;

  

  UI.boot(setUp, function (error) {
    show($("submission"), false);
    const closed = $("closed");
    show(closed, true);
    if (closed) {
      closed.querySelector("[data-reason]").textContent =
        "This page did not start up correctly, so the form is not safe " +
        "to use and has been hidden. Nothing you type would be sent. " +
        (error && error.message ? "(" + error.message + ")" : "");
    }
  });

  function setUp() {
    const form = $("submission");
    const submit = $("submit");
    const status = $("status");
    const closed = $("closed");
    const done = $("done");
    const config = root.BINDER_CONFIG || {};
    if (!root.BinderSession) {
      throw new Error("This page did not load its session handling.");
    }
    const member = root.BinderSession.require();

     
     
     
    if (!member) {
      show(form, false);
      return;
    }

    

    const unavailable = root.BinderCrypto
      ? root.BinderCrypto.unavailableReason()
      : "This page did not load its encryption, so nothing can be sent " +
        "safely. Reload, and if it persists the site is broken.";

     
     
     
     
    const noKey = !config.publicKey
      ? "This portal has no key published yet, so there is nothing to " +
        "encrypt to. Submissions are closed until there is."
      : null;

    

    UI.showFingerprint($("key-fingerprint"), config.publicKey);

    const blocked = unavailable || noKey;
    if (blocked) {
      show(form, false);
      show(closed, true);
      if (closed) closed.querySelector("[data-reason]").textContent = blocked;
      return;
    }

    

    const country = $("country");
    const countries = root.BINDER_COUNTRIES || {};

    function addOptions(parent, codes) {
      codes.forEach(function (code) {
         
         
         
        if (!countries[code]) return;
        const option = document.createElement("option");
        option.value = code;
        option.textContent = countries[code];
        parent.appendChild(option);
      });
    }

    function addGroup(label, codes) {
      const group = document.createElement("optgroup");
      group.label = label;
      addOptions(group, codes);
      country.appendChild(group);
    }

    const promoted = root.BINDER_COUNTRIES_PROMOTED || [];
    if (promoted.length) addGroup("Most common", promoted);

    const alphabetical = Object.keys(countries).sort(function (a, b) {
      return countries[a].localeCompare(countries[b]);
    });
    if (promoted.length) {
      addGroup("All countries", alphabetical);
    } else {
      addOptions(country, alphabetical);
    }

    

    const FIELDS = ["weight", "height", "over18"];

     
     
     
    function inputsFor(field) {
      return Array.prototype.slice.call(
        document.querySelectorAll('[data-field="' + field + '"]'));
    }

    function clearProblems() {
      FIELDS.forEach(function (field) {
        const slot = $("error-" + field);
        if (slot) {
          slot.textContent = "";
          slot.hidden = true;
        }
        inputsFor(field).forEach(function (input) {
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

    

    const groups = { metric: $("metric-fields"), imperial: $("imperial-fields") };
    const unitInputs = Array.prototype.slice.call(
      document.querySelectorAll('input[name="units"]'));

     
     
     
     
    function currentUnits() {
      return UI.checkedValue("units", "imperial");
    }

    function applyUnits() {
      const units = currentUnits();
      show(groups.metric, units === "metric");
      show(groups.imperial, units === "imperial");
      clearProblems();
    }

    unitInputs.forEach(function (input) {
      input.addEventListener("change", applyUnits);
    });
    applyUnits();

    function readForm() {
      const session = root.BinderSession.read();
      return {
        sessionUsername: session ? session.username : null,
        units: currentUnits(),
        weightKg: $("weight-kg").value,
        weightLb: $("weight-lb").value,
        heightCm: $("height-cm").value,
        heightFeet: $("height-ft").value,
        heightInches: $("height-in").value,
        gender: $("gender").value,
        roles: Array.prototype.slice
          .call(document.querySelectorAll('input[name="roles"]:checked'))
          .map(function (input) { return input.value; }),
        country: $("country").value,
        over18: $("over18").checked,
      };
    }

    function say(message, tone) {
      UI.setStatus(status, message, tone);
    }

    

    let baselineCm = null;
    document.addEventListener("binder:height-baseline", function (event) {
      baselineCm = event && event.detail ? event.detail.lastHeightCm : null;
    });

    

    let confirmedHeightCm = null;

    form.addEventListener("submit", async function (event) {
       
       
       
       
      event.preventDefault();

      const input = readForm();
      const problems = validate(input, input.sessionUsername);
      if (problems.length) {
        const sessionProblem = problems.find(function (problem) {
          return problem.field === "telegram";
        });
        say(sessionProblem ? sessionProblem.message : "",
          sessionProblem ? "bad" : null);
        showProblems(problems);
        return;
      }
      clearProblems();

      

      const notice = heightChangeNotice(input, baselineCm);
      const enteredCm = enteredHeightCm(input);
      if (notice && enteredCm !== confirmedHeightCm) {
        confirmedHeightCm = enteredCm;
        showProblems([notice]);
        return;
      }

      submit.disabled = true;
      say("Encrypting…", null);

      let record = null;
      let blob;
      try {
        record = buildRecord(input, Date.now(), input.sessionUsername);
        blob = await root.BinderCrypto.encrypt(record, config.publicKey);
      } catch (error) {
        submit.disabled = false;
         
         
        say("This could not be encrypted, so nothing was sent. " +
          (error && error.message ? error.message : "Unknown error."), "bad");
        return;
      }

      say("Sending…", null);
      try {
        const response = await fetch(config.endpoint + "/submit", {
          method: "POST",
          headers: Object.assign(
            { "Content-Type": "application/json" },
            root.BinderSession.authorization()),
          body: JSON.stringify({ ciphertext: blob }),
        });
        if (!response.ok) {
          let detail = "";
          try {
            const body = await response.json();
            detail = body && body.error ? " " + body.error : "";
          } catch (e) {   }
          throw new Error("The server refused it (" + response.status + ")." +
            detail);
        }
      } catch (error) {
        submit.disabled = false;
        say("It was encrypted, but it could not be sent. " +
          (error && error.message ? error.message : "The connection failed.") +
          " Nothing was stored - try again.", "bad");
        return;
      }

      

      document.dispatchEvent(new CustomEvent("binder:submitted", {
        detail: { heightCm: record.height.cm },
      }));

      show(form, false);
      say("", null);
      show(done, true);
      done.scrollIntoView({ block: "center", behavior: "smooth" });
    });

    

    document.addEventListener("binder:add-entry-shown", function () {
      if (done.hidden) return;
      show(done, false);
      show(form, true);
      show($("repeat-note"), true);
    });
  }
})(globalThis);
