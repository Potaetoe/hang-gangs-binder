/*
 * The form. The only page in this project that holds cleartext.
 *
 * It reads what was typed, turns it into a record, hands that record to
 * crypto.js, and posts the base64 that comes back. Nothing else leaves
 * this file - in particular the fields themselves never touch fetch().
 * tools/check_web.py enforces the weaker, checkable version of that
 * rule: anything here that can reach the network must also name
 * BinderCrypto.
 *
 * Two halves, split on purpose:
 *
 *   1. Pure functions - normalizing, converting, validating, building
 *      the record. No DOM, no network, no clock beyond one injected
 *      timestamp. Exported as BinderForm so dev/form.test.mjs can load
 *      this exact file under Node, the same arrangement crypto.js and
 *      server/worker.js already use.
 *   2. The wiring, which only runs when there is a document.
 *
 * The split is not tidiness. The conversion arithmetic is the part that
 * can be wrong without anything looking wrong: a bad factor produces a
 * plausible number, seals it, and the mistake is only visible on export
 * day when every row is quietly off by 2.2. That half is testable, so
 * it is tested.
 */
(function (root) {
  "use strict";

  // Exact by definition, both of them - the international pound and the
  // international inch. No approximations here: these two numbers decide
  // what every stored row says.
  const KG_PER_LB = 0.45359237;
  const CM_PER_IN = 2.54;
  const IN_PER_FT = 12;

  /*
   * Every row carries both unit systems, whichever one was typed.
   *
   * The alternative was storing the canonical metric value plus the raw
   * text and converting at export. That puts this same arithmetic in
   * admin.html, where it would be a second copy free to drift from this
   * one, and it makes a CSV that cannot be read without running the
   * conversion again. Storing both costs a few bytes inside a blob that
   * is already padded to an AES block.
   *
   * What is NOT derived is `entered`: exactly what the submitter typed,
   * kept verbatim. Rounding is lossy in both directions, and the honest
   * answer to "what did they actually say" is worth one string.
   */

  // Bounds are per unit system rather than derived from one canonical
  // pair, so the message a submitter reads is in the units they are
  // looking at. A form that answers "between 20 and 500" to someone
  // typing pounds is a form that looks broken.
  const LIMITS = {
    kg: { min: 20, max: 500 },
    lb: { min: 44, max: 1100 },
    cm: { min: 100, max: 250 },
    ft: { min: 3, max: 8 },
  };

  const GENDERS = ["male", "female", "nonbinary", "other"];
  const ROLES = ["feeder", "feedee", "gainer", "admirer"];

  // Telegram's own rule: 5-32 characters, letters, digits and
  // underscores. Checking it here means a typo is caught while the
  // submitter can still fix it, rather than becoming a handle nobody can
  // message four months later.
  const HANDLE = /^[a-z0-9_]{5,32}$/;

  function round(value, places) {
    const factor = Math.pow(10, places);
    return Math.round(value * factor) / factor;
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

  function weightFromKg(kg) {
    return { kg: round(kg, 1), lb: round(kg / KG_PER_LB, 1) };
  }

  function weightFromLb(lb) {
    return { kg: round(lb * KG_PER_LB, 1), lb: round(lb, 1) };
  }

  /*
   * One height, spelled four ways. feet/inches are derived from the
   * total rather than carried alongside it, so they cannot disagree
   * with it.
   */
  function heightFrom(totalInches) {
    let feet = Math.floor(totalInches / IN_PER_FT);
    let inches = round(totalInches - feet * IN_PER_FT, 1);
    // Rounding the remainder can reach a full foot - 71.98in is 5ft
    // 11.98in, which rounds to 5ft 12in. Carry it.
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

  /*
   * Every problem with a filled-in form, as [{ field, message }].
   *
   * All of them at once rather than the first: a form that reveals one
   * fault per attempt is three round trips for someone who mistyped
   * two things.
   */
  function validate(input, sessionUsername) {
    const problems = [];
    const imperial = input.units === "imperial";

    /*
     * The one-argument form preserves validation for unverified input in
     * the pure API. The page passes the Worker's verified session username
     * explicitly: it must exist, but this page must not reject a real
     * Telegram account merely because its local HANDLE rule is narrower
     * than the identity provider's.
     */
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

    // Not a formality. It is recorded with the row because the row is
    // the only place it can be recorded - there are no accounts here.
    if (input.over18 !== true) {
      problems.push({
        field: "over18",
        message: "This form is 18+ only. Please confirm.",
      });
    }

    return problems;
  }

  /*
   * A valid input to the record that gets encrypted. Assumes validate()
   * came back empty; callers that skip it get whatever they deserve.
   * The session username is mandatory even then: without it the record
   * builder refuses rather than falling back to member-editable input.
   *
   * `now` is a parameter rather than a call to Date.now() so the test
   * can assert on a fixed record. It is also the only clock in the
   * record the submitter's machine controls - the server adds its own
   * receipt timestamp, and the two disagreeing is information rather
   * than a bug.
   */
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
      // The record's own shape, separate from the envelope version byte
      // crypto.js writes. That one says how the bytes are sealed; this
      // one says what the fields inside mean. They change for different
      // reasons, so they are different numbers.
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

  root.BinderForm = {
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
    buildRecord: buildRecord,
  };

  /* ---------------------------------------------------------------- */
  /* The wiring. Everything above this line runs under Node.          */

  if (typeof document === "undefined") return;

  const UI = root.BinderUI;
  const $ = UI.byId;
  const show = UI.show;

  /*
   * Setup runs inside a guard.
   *
   * A throw anywhere in here leaves every listener registered after it
   * unattached, on a page that otherwise looks completely normal - no
   * broken layout, no missing text, just a Submit button that silently
   * does nothing. This happened during development, from a `const` used
   * by a function called above its own declaration, and nothing about
   * the page revealed it.
   *
   * That failure is worse than a dead page, because a submitter cannot
   * tell it from a working one. So a page that cannot wire itself up
   * says so, and shows no form at all.
   */
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

    // session.js starts the redirect before this setup runs. Keep the form
    // hidden as well: if navigation is delayed, a signed-out visitor must not
    // get a usable-looking form whose request the Worker will refuse.
    if (!member) {
      show(form, false);
      return;
    }

    /*
     * Two reasons this form cannot run, both checked before it is shown
     * rather than when the button is pressed. A submitter who fills in
     * six fields and then learns the page never worked is a submitter
     * who does not come back.
     */
    const unavailable = root.BinderCrypto
      ? root.BinderCrypto.unavailableReason()
      : "This page did not load its encryption, so nothing can be sent " +
        "safely. Reload, and if it persists the site is broken.";

    // publicKey: null is the honest state of a fork that has not
    // generated a key yet. Submitting anyway would mean either plaintext
    // on the wire or ciphertext nobody can open - both worse than a
    // closed form.
    const noKey = !config.publicKey
      ? "This portal has no key published yet, so there is nothing to " +
        "encrypt to. Submissions are closed until there is."
      : null;

    /*
     * A signed-out visitor has no submission to verify, so their return
     * stays above this. The blocked-form return stays below it because a
     * member can still compare a configured key when local encryption is
     * unavailable; with no key, the helper keeps the slot hidden.
     */
    UI.showFingerprint($("key-fingerprint"), config.publicKey);

    const blocked = unavailable || noKey;
    if (blocked) {
      show(form, false);
      show(closed, true);
      if (closed) closed.querySelector("[data-reason]").textContent = blocked;
      return;
    }

    /*
     * The country list, built here rather than in the HTML: 250
     * <option> tags would bury the six fields that matter in the page a
     * reviewer most needs to read.
     *
     * Two groups. A short promoted block first, then everyone
     * alphabetically - and the promoted countries appear in both, which
     * is deliberate: a country missing from the A-Z run reads as a bug
     * to whoever is scrolling for it, and both options carry the same
     * value so the record cannot tell which was used.
     *
     * <optgroup> rather than a drawn separator. Its label is not
     * selectable, a screen reader announces which group an option is
     * in, and it needs no styling to be understood - a "--------" row
     * is an option that can be chosen and stored.
     */
    const country = $("country");
    const countries = root.BINDER_COUNTRIES || {};

    function addOptions(parent, codes) {
      codes.forEach(function (code) {
        // A promoted code with no country behind it is skipped rather
        // than rendered as an empty row. tools/check_web.py fails the
        // build on one, so this is the safe half of that pair.
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

    /*
     * Reporting problems. Declared before the unit toggle because
     * applyUnits() runs during setup and clears them, and a `const` used
     * from a function called above its own declaration is a reference
     * error at load - which would take every listener registered after
     * it down with it, silently.
     */
    const FIELDS = ["weight", "height", "over18"];

    // A field can be more than one input - height in imperial is two -
    // and both halves should be marked, so this returns all of them
    // rather than the first.
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

    /*
     * The unit toggle swaps which inputs exist rather than reinterpreting
     * one pair of numbers. Someone who types 200 into a pounds box and
     * then switches to metric has not just become 200 kg, and a form
     * that quietly says they have is a form that stores a lie.
     */
    const groups = { metric: $("metric-fields"), imperial: $("imperial-fields") };
    const unitInputs = Array.prototype.slice.call(
      document.querySelectorAll('input[name="units"]'));

    // The fallback matches the radio submit.html checks. It should be
    // unreachable - a radio group with a `checked` member always has
    // one - but if the markup ever loses that attribute, the page and
    // this function should at least be wrong about the same thing.
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

    form.addEventListener("submit", async function (event) {
      // The page never does a native submit - the CSP's form-action
      // 'none' would block it anyway - but preventing it first means a
      // thrown error below cannot turn into a navigation that discards
      // what was typed.
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

      submit.disabled = true;
      say("Encrypting…", null);

      let blob;
      try {
        const record = buildRecord(input, Date.now(), input.sessionUsername);
        blob = await root.BinderCrypto.encrypt(record, config.publicKey);
      } catch (error) {
        submit.disabled = false;
        // Nothing has left the browser at this point, which is worth
        // saying: a failure here is not a half-submission.
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
          } catch (e) { /* a non-JSON error page says enough by its status */ }
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

      // The panel owns the account summary and responds by re-reading /me.
      // Dispatching only after the Worker accepts the row means a refused or
      // failed request can never make the panel claim something was stored.
      document.dispatchEvent(new CustomEvent("binder:submitted"));

      show(form, false);
      say("", null);
      show(done, true);
      done.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }
})(globalThis);
