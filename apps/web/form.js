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
   * The entered height in cm, or null when there is nothing readable to
   * convert. Separate from validate() because two callers need the
   * number rather than the complaint: the guard below, and the wiring
   * that has to say what height a stored row actually carried.
   */
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

  /*
   * Is this height a big enough departure from the last one to be worth
   * asking about? A notice as { field, message }, or null for silence.
   *
   * A person's height does not move, so a large jump between entries is
   * a typo - and nothing in LIMITS can see it, because LIMITS asks
   * whether one number is a possible height and 3 ft is one. That is how
   * 91.4cm and 162.1cm reached the published document from a submitter
   * who is 175.3cm.
   *
   * Three properties this function must keep, each of which is a way for
   * a guard like this to become worthless:
   *
   *   - It is silent when it does not know. `previousCm` comes from this
   *     browser's own storage, so a device that has never submitted has
   *     nothing to compare and gets no guard at all. That is a real hole
   *     and the copy on the page says so rather than implying a standing
   *     protection; inventing a comparison here would be worse than the
   *     hole.
   *   - It is silent under HEIGHT_CHANGE_CM. Shoes, a different tape, a
   *     different time of day. A guard that fires on those is a guard
   *     people learn to press through, and then it is not there for the
   *     91.4cm case either.
   *   - It is a prompt, never a verdict. The remembered number may
   *     itself be the typo, so a hard refusal traps a member whose real
   *     height the form will not take - and being told they are wrong
   *     about their own height is how somebody stops trusting the form.
   *
   * Both heights are spoken in the units on screen. Someone looking at a
   * feet box, told their last entry was 175.3cm, has to do arithmetic
   * before they can judge the one thing being asked of them.
   */
  const HEIGHT_CHANGE_CM = 5;

  function heightChangeNotice(input, previousCm) {
    // Not a number is not a memory. This value crosses a document event
    // from a JSON store, so "175.3" and NaN both turn up here, and both
    // would compare in a way that silently never fires: "175.3" - 178
    // is arithmetic that works, and every comparison against NaN is
    // false.
    if (typeof previousCm !== "number" || !Number.isFinite(previousCm)) {
      return null;
    }
    const entered = enteredHeightCm(input);
    // An unreadable height is validate()'s complaint to make. A sentence
    // here about a number nobody typed would arrive alongside it.
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

  // Frozen because your-page.html holds the submission before it is sealed:
  // an export a later script can rewrite is a `validate` that waves
  // anything through, or a `buildRecord` that quietly adds a field to
  // what gets encrypted.
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

    // The fallback matches the radio your-page.html checks. It should be
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

    /*
     * The height guard's memory, and it is not this file's - #172.
     *
     * submit.js owns the device-local store and announces what is in it;
     * this file owns the form's boxes and announces what was accepted.
     * Neither reaches into the other, which is the same arrangement the
     * two events above already use, and it is what keeps the store's
     * account scoping in one file instead of two.
     *
     * Whatever arrives is held as it arrives. heightChangeNotice() is
     * where a baseline is judged usable, so a "175.3" that crossed a
     * JSON store is rejected in one place rather than in every reader.
     */
    let baselineCm = null;
    document.addEventListener("binder:height-baseline", function (event) {
      baselineCm = event && event.detail ? event.detail.lastHeightCm : null;
    });

    /*
     * The height this member has already been asked about and stood by.
     * Held as the number rather than as a flag: a flag would let one
     * confirmation license every later typo in the same sitting, so
     * editing the height to a different implausible value asks again.
     */
    let confirmedHeightCm = null;

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

      /*
       * The one question this form asks twice, and the reason it is here
       * rather than inside validate(): it is not a rule about the entry.
       * validate() judges the entry alone and its answer cannot change
       * between two identical presses, while this compares against a
       * number only this browser knows - and the answer to "are you
       * sure" is a second press.
       */
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
        /*
         * A dead session, which is not a refused entry - #166.
         *
         * Ahead of the branch below, because that one is written for a
         * Worker objecting to the submission: it quotes a status number
         * and tells the member to try again, which for a dead credential
         * fails identically for as long as the tab is open. Nothing about
         * the entry is wrong here, so nothing about the entry is said.
         *
         * The credential goes, because the Worker has just refused it and
         * session.js does not keep values that cannot work - and dropping
         * it here is also what takes the development banner down, so the
         * page stops claiming a session while telling the member it has
         * ended.
         *
         * THE PAGE STAYS, and that is the opposite of admin.js's rule on
         * the same status. Leaving is a security act there: that page
         * holds every submission in the clear and keeps the private key on
         * the device, so a session the Worker no longer accepts is not one
         * to leave the corpus sitting behind. Here there is nothing to
         * protect and something to lose - a member who has just typed an
         * entry and pressed Send, whose measurements are on screen. They
         * are told what happened and left holding it.
         */
        if (response.status === 401) {
          root.BinderSession.clear();
          submit.disabled = false;
          say("Your sign-in is no longer valid, so nothing was stored. " +
            "Sign in again.", "bad");
          return;
        }
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

      /*
       * The panel owns the account summary and responds by re-reading /me.
       * Dispatching only after the Worker accepts the row means a refused or
       * failed request can never make the panel claim something was stored.
       *
       * The height rides along because the next entry is measured against
       * it - #172. It is the record's own number rather than a second
       * reading of the boxes, so what the guard remembers is exactly what
       * was sealed; and it moves here, on the one path where a row exists,
       * rather than while the member types, because a baseline written on
       * every keystroke is one the entry is compared against itself.
       */
      document.dispatchEvent(new CustomEvent("binder:submitted", {
        detail: { heightCm: record.height.cm },
      }));

      show(form, false);
      say("", null);
      show(done, true);
      done.scrollIntoView({ block: "center", behavior: "smooth" });
    });

    /*
     * Putting the form back - #64.
     *
     * The swap above is one way, which was right for the pre-accounts page:
     * a one-shot public form where reloading was how you submitted again.
     * With tabs, "Weigh in" leads back to a confirmation card and no
     * form unless something puts the form back, and only a reload
     * recovers it - while that card's own text promises "just fill the
     * form again". The copy is right, so the code has to be.
     *
     * This listener is the counterpart to the `binder:submitted` dispatch
     * above, and the direction matters: submit.js owns the tabs and never
     * learns that #done and #submission are a pair, because that knowledge
     * belongs wherever the swap lives, which is here.
     *
     * Doing nothing when #done is already hidden is what keeps this from
     * clearing a note the member is still reading, or fighting the boot
     * path that hides the form for a signed-out visitor.
     */
    document.addEventListener("binder:add-entry-shown", function () {
      if (done.hidden) return;
      show(done, false);
      show(form, true);
      show($("repeat-note"), true);
    });
  }
})(globalThis);
