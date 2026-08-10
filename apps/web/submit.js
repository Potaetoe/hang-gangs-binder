/*
 * The member panel around the submission form.
 *
 * Counts come only from GET /me. The form announces when the Worker has
 * accepted a submission, and this file responds by reading /me again; it
 * never guesses that the count rose by one. It also reads and writes the
 * device-local prefill: the measurements, the optional fields, the age
 * confirmation, and the height the last stored row carried. That prefill
 * is not a credential, but it is cleartext body data - the same fields
 * the encryption exists to protect - so signing out removes it with the
 * session, and the erasing is signout.js's, because Sign out is in the
 * rail on three pages and this file is loaded on one of them.
 *
 * A member cannot read their own previous entry: every submission is
 * sealed to the keyholder before it leaves the browser, so there is no
 * server-side answer to "what did I say last time" and this store is the
 * only place an answer can come from. That is why the page says out loud
 * that it is this browser remembering rather than the account - see
 * #172, and #173 for the durable version.
 */
(function (root) {
  "use strict";

  if (typeof document === "undefined") return;

  const SignOut = root.BinderSignOut;

  /*
   * Borrowed rather than declared. Two files touch this value - the one
   * that writes it and the one that erases it on sign-out - and a
   * second copy of the name is a rename waiting to leave the erase
   * pointing at a key nobody writes any more. dev/session.test.mjs
   * asserts the two are the same constant.
   */
  const PREFILL_KEY = SignOut.prefillKey;
  const SUBMITTED_EVENT = "binder:submitted";

  // The other direction: form.js tells this file a row was stored, and this
  // file tells form.js the form is on screen again. Two events rather than
  // one shared object, so neither file reaches into the other's elements.
  const ADD_ENTRY_SHOWN_EVENT = "binder:add-entry-shown";

  // The third direction: what this browser remembers, told to the guard
  // that compares against it. form.js cannot read this store - the
  // account scoping that decides whether the value may be shown at all
  // lives here - so the number crosses on an event like the other two.
  const HEIGHT_BASELINE_EVENT = "binder:height-baseline";

  // The fourth: whose account this is, told to the file that seals the
  // entry - #85. GET /me is this file's request and the id is the only
  // thing memberkey.js will file a key under, so form.js can neither
  // fetch it nor derive it; it crosses the same way the height does,
  // rather than either file reaching into the other.
  const ACCOUNT_EVENT = "binder:account";

  // Typed into, so they save on `input`.
  const FIELD_IDS = [
    "weight-lb", "height-ft", "height-in", "weight-kg", "height-cm",
  ];

  // Chosen rather than typed, so they save on `change` - a select and a
  // checkbox change rather than take input. Wiring them to the list
  // above is the mistake to avoid: it restores these fields forever
  // while recording nothing a member does to them.
  const CHOICE_IDS = ["gender", "country", "over18"];
  const UI = root.BinderUI;
  const Session = root.BinderSession;
  const $ = UI.byId;
  const show = UI.show;

  UI.boot(setUp, function (error) {
    show($("member-tabs"), false);
    show($("your-entries-pane"), false);
    show($("add-entry-pane"), false);
    setStatus("This member panel did not start correctly. " +
      (error && error.message ? "(" + error.message + ")" : ""), true);
  });

  function localStore() {
    try {
      return root.localStorage || null;
    } catch (error) {
      return null;
    }
  }

  /*
   * The prefill belongs to one account, and the check is here rather than
   * in the key name - #56.
   *
   * sessionStorage dies with the tab and localStorage does not, so without
   * this check a member who closes the tab instead of signing out leaves
   * their entry behind for whoever signs in next on that browser - not
   * only weight and height, but gender, country, affiliations and an age
   * confirmation. Sign out erases it, which is the path nobody takes.
   *
   * Carrying the id inside the value rather than in the key is what makes
   * the migration fall out of the comparison: a prefill written before this
   * existed has no `accountId`, does not match, and is discarded on the
   * first load. Keying by name would have left that one stranded and
   * readable forever, which is the exposure rather than a tidiness problem.
   *
   * `expected` of null - no account to attribute it to, which is what a
   * break-glass caller gets from /me - discards rather than restores. A
   * prefill shown without knowing whose it is IS the bug.
   *
   * Every rejection erases, and there is one place that does it - #65.
   * A value this page will not read is unusable by definition, so nothing
   * is weighed against removing it, and a rejection that merely returns
   * leaves weight and height readable on a shared device for the next
   * person. Spreading the erase across the guards is what makes the fifth
   * guard somebody adds silently keep the data, so the shape here is a
   * single accept and one exit: to keep a prefill it has to pass all of
   * them at once.
   */
  function readPrefill(expected) {
    const store = localStore();
    if (!store) return null;
    try {
      const value = JSON.parse(store.getItem(PREFILL_KEY));
      if (value && typeof value === "object" && expected &&
          value.accountId === expected &&
          (value.units === "imperial" || value.units === "metric")) {
        return value;
      }
    } catch (error) {
      // A value that will not parse is erased below with every other
      // rejection; the catch is here so a hostile store cannot throw
      // past it.
    }
    clearPrefill();
    return null;
  }

  // The same erase the sign-out performs, called here whenever a stored
  // prefill is rejected. One implementation rather than two, so a
  // rejection on this page and a sign-out from any page cannot end up
  // meaning different things.
  const clearPrefill = SignOut.clearPrefill;

  function fieldValue(id) {
    const field = $(id);
    return field && typeof field.value === "string" ? field.value : "";
  }

  function currentUnits() {
    const chosen = Array.prototype.find.call(
      document.querySelectorAll('input[name="units"]'),
      function (input) { return input.checked; });
    return chosen ? chosen.value : "imperial";
  }

  function checkedRoles() {
    return Array.prototype.map.call(
      document.querySelectorAll('input[name="roles"]:checked'),
      function (input) { return input.value; });
  }

  function isChecked(id) {
    const field = $(id);
    return Boolean(field && field.checked);
  }

  /*
   * The height the last accepted row carried, in cm, or null on a device
   * that has never had one accepted here.
   *
   * The only value in this store that is not a draft of the form. Every
   * other field is whatever is in the boxes right now; this one moves on
   * the announcement that a row was stored and at no other time, which
   * is what keeps the guard from comparing an entry against itself. Held
   * in a variable as well as in the store because savePrefill rewrites
   * the whole record on every keystroke and would otherwise drop it.
   */
  let lastHeightCm = null;

  function usableHeight(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  // Announced rather than returned: form.js owns the guard and this file
  // owns the store, and neither reads the other's state. A baseline of
  // null is still worth saying - it is the honest answer for a fresh
  // device, and form.js treats it as no guard at all.
  function announceBaseline() {
    document.dispatchEvent(new CustomEvent(HEIGHT_BASELINE_EVENT, {
      detail: { lastHeightCm: lastHeightCm },
    }));
  }

  /*
   * Whose device-local data this is, as reported by /me. Held rather than
   * re-read because savePrefill runs on every keystroke and must not write
   * an unattributed prefill: if /me has not answered, or answered with no
   * account, there is nothing to scope the data to and it is not stored.
   * Refusing to write is the safe direction - the cost is a lost
   * convenience, and the alternative cost is handing somebody else's
   * body data to whoever is at this browser.
   */
  let account = null;

  /*
   * Announced rather than exposed, and announced on every /me that
   * answers rather than once.
   *
   * form.js holds whatever arrives and asks memberkey.js for a key under
   * it at seal time, so what has to be true is that the id is known
   * before somebody presses Send - not that it was known at load. A
   * refresh that comes back with no account announces null, which is the
   * honest answer and the one that costs an entry its second recipient
   * rather than sealing it to the wrong member.
   */
  function announceAccount() {
    document.dispatchEvent(new CustomEvent(ACCOUNT_EVENT, {
      detail: { accountId: account },
    }));
  }

  function savePrefill() {
    const store = localStore();
    if (!store || !account) return;
    const value = {
      accountId: account,
      units: currentUnits(),
      weightLb: fieldValue("weight-lb"),
      heightFeet: fieldValue("height-ft"),
      heightInches: fieldValue("height-in"),
      weightKg: fieldValue("weight-kg"),
      heightCm: fieldValue("height-cm"),
      gender: fieldValue("gender"),
      country: fieldValue("country"),
      roles: checkedRoles(),
      over18: isChecked("over18"),
      lastHeightCm: lastHeightCm,
    };
    try { store.setItem(PREFILL_KEY, JSON.stringify(value)); }
    catch (error) { /* A blocked store leaves an ordinary empty prefill. */ }
  }

  function restorePrefill() {
    const value = readPrefill(account);
    if (!value) return;

    /*
     * Restoring writes, and the order below is what keeps it from
     * writing over what it is restoring.
     *
     * Selecting the units radio fires `change`, and `change` saves - so
     * that dispatch is the LAST thing this function does, after every
     * field it is going to set. A save that runs part-way through reads
     * the boxes it has not reached yet, finds them empty, and stores
     * that: the member's gender, country and affiliations are erased by
     * the act of restoring them. `lastHeightCm` is worse, because the
     * form has no box for it and nothing can recover it afterwards.
     */
    lastHeightCm = usableHeight(value.lastHeightCm);

    const fields = {
      "weight-lb": value.weightLb,
      "height-ft": value.heightFeet,
      "height-in": value.heightInches,
      "weight-kg": value.weightKg,
      "height-cm": value.heightCm,
    };
    Object.keys(fields).forEach(function (id) {
      const field = $(id);
      if (field && typeof fields[id] === "string") field.value = fields[id];
    });

    const unitInputs = Array.prototype.slice.call(
      document.querySelectorAll('input[name="units"]'));
    unitInputs.forEach(function (input) {
      input.checked = input.value === value.units;
    });

    const gender = $("gender");
    if (gender && typeof value.gender === "string") gender.value = value.gender;
    const country = $("country");
    if (country && typeof value.country === "string") {
      country.value = value.country;
    }
    const roles = Array.isArray(value.roles) ? value.roles : [];
    Array.prototype.forEach.call(
      document.querySelectorAll('input[name="roles"]'),
      function (input) { input.checked = roles.indexOf(input.value) !== -1; });

    /*
     * The 18+ bit is restored in one direction only. A stored `false` is
     * indistinguishable from a member who has not answered yet, and this
     * is the one assertion the form still asks them to make - so the
     * absence of a memory leaves the box exactly as the markup ships it.
     */
    const over18 = value.over18 === true;
    if (over18) {
      const box = $("over18");
      if (box) box.checked = true;
    }

    /*
     * The two sentences that keep a prefilled form from reading as an
     * account that followed the member here. They are revealed only when
     * something was restored, and the 18+ line only when the box was
     * actually ticked for them - an explanation of a tick that did not
     * happen is its own small lie.
     */
    show($("over18-remembered"), over18);
    show($("prefill-note"), true);

    /*
     * Last, for the reason at the top of this function: this is the one
     * line here that triggers a save, and it must find every restored
     * field already in place. It is also how form.js learns which pair
     * of measurement boxes to show, so it cannot simply be dropped.
     */
    const selected = unitInputs.find(function (input) { return input.checked; });
    if (selected) selected.dispatchEvent(new Event("change", { bubbles: true }));

    announceBaseline();
  }

  function setStatus(message, bad) {
    const status = $("member-panel-status");
    if (!status) return;
    status.textContent = message || "";
    status.className = "status" + (bad ? " bad" : "");
    status.hidden = !message;
  }

  function chooseTab(name) {
    const entries = name === "entries";
    show($("your-entries-pane"), entries);
    show($("add-entry-pane"), !entries);

    /*
     * Announce that the form is being shown, rather than reaching into it -
     * #64. After a submission form.js replaces the form with a confirmation
     * card, and before this the tab led back to that card with no way to the
     * form but a reload. What to do about it is form.js's decision: it owns
     * that swap, and this file does not know those two elements exist.
     */
    if (!entries) {
      document.dispatchEvent(new CustomEvent(ADD_ENTRY_SHOWN_EVENT));
    }

    const entriesTab = $("your-entries-tab");
    const addTab = $("add-entry-tab");
    if (entriesTab) {
      entriesTab.setAttribute("aria-selected", String(entries));
      entriesTab.setAttribute("tabindex", entries ? "0" : "-1");
    }
    if (addTab) {
      addTab.setAttribute("aria-selected", String(!entries));
      addTab.setAttribute("tabindex", entries ? "-1" : "0");
    }
  }

  /*
   * The rows a correction replaced - #193.
   *
   * GET /me reports them beside the effective count rather than
   * subtracting them in silence, and the reason is in handleMe: a count
   * that does not move looks the same whether a correction landed or
   * was refused. That argument only reaches the member if a screen
   * carries the second number. Drop this function and the count goes
   * back to shrinking with nothing on the page accounting for the
   * difference, which is the member reading it as the correction
   * having eaten an entry.
   *
   * Not validated the way `entries` is. A missing or malformed field
   * hides the line and leaves the rest of the panel alone, because
   * refusing to draw a count over a second number the page does not
   * control turns an older Worker into a dead panel - and the count is
   * what the member came for. Zero is the same silence for the same
   * reason it is on screen: there is nothing to say.
   *
   * The noun is written here rather than in the markup so that one row
   * reads as one correction.
   */
  function renderCorrections(payload) {
    const count = Number.isInteger(payload.superseded) && payload.superseded > 0
      ? payload.superseded
      : 0;
    const field = $("member-corrections");
    if (field) {
      field.textContent = count === 0
        ? ""
        : String(count) + (count === 1 ? " correction" : " corrections");
    }
    show($("member-corrections-line"), count > 0);
  }

  function renderAccount(payload) {
    $("member-entry-count").textContent = String(payload.entries);
    renderCorrections(payload);
    const last = $("member-last-at");
    if (payload.lastAt == null) {
      last.dateTime = "";
      last.textContent = "No entries yet";
      return;
    }

    const at = Date.parse(payload.lastAt);
    if (!Number.isFinite(at)) {
      last.dateTime = "";
      last.textContent = "Submission time unavailable";
      return;
    }
    last.dateTime = payload.lastAt;
    last.textContent = new Date(at).toLocaleString();
  }

  /*
   * The member's own numeric Telegram id, from the session and from
   * nowhere else - #58.
   *
   * The Worker returns it at sign-in for one purpose: somebody being
   * made an admin has to put that number in ADMIN_TELEGRAM_IDS, and a
   * page showing it is what keeps them from asking a third-party bot
   * for it - which is how a real numeric id reaches somebody nobody
   * here controls. Leaving it unrendered is what sends people there.
   *
   * The session is the source because the sign-in response is the only
   * thing that ever saw the id. Nothing on this page can derive it, and
   * /me deliberately does not carry it: a page drawing a number from
   * the account summary would be telling somebody what to configure on
   * the word of a route that never knew it.
   *
   * A development session has none - POST /auth/dev mints an account
   * for a subject string rather than for a Telegram user, so it answers
   * with null - and the line stays hidden for it. "Your Telegram id:"
   * followed by nothing reads as a broken page, and the person reading
   * it is on their way to configure something.
   */
  function showTelegramId(session) {
    const numeric = session && session.telegramId;
    const field = $("member-telegram-id");
    if (field) field.textContent = numeric || "";
    show($("member-telegram-id-line"), Boolean(numeric));
  }

  async function refreshPanel() {
    const config = root.BINDER_CONFIG || {};
    if (!config.endpoint) {
      setStatus("This site has no endpoint configured for your account.", true);
      return;
    }

    try {
      const response = await fetch(config.endpoint + "/me", {
        headers: Session.authorization(),
      });
      if (response.status === 401) {
        Session.clear();
        if (root.location && typeof root.location.replace === "function") {
          root.location.replace("index.html");
        }
        return;
      }
      if (!response.ok) {
        throw new Error("The server answered " + response.status + ".");
      }
      const payload = await response.json();
      if (!payload || payload.ok !== true ||
          !Number.isInteger(payload.entries) || payload.entries < 0) {
        throw new Error("The server returned an invalid account summary.");
      }
      // Validated like the count is, rather than trusted: a non-string here
      // would silently scope the prefill to nothing and read as "not my
      // data" forever, which looks like the feature simply not working.
      account = typeof payload.accountId === "string" && payload.accountId
        ? payload.accountId
        : null;
      announceAccount();
      renderAccount(payload);
      setStatus("", false);
    } catch (error) {
      setStatus("Your account summary could not be refreshed. " +
        (error && error.message ? error.message : "The connection failed."),
      true);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Your own history, opened in this browser - #85's personal arm.    */

  /*
   * The member's own rows, fetched sealed and opened here.
   *
   * THE WHOLE SHAPE IN ONE PARAGRAPH. GET /my-entries answers with this
   * account's rows and their ciphertext; memberkey.js holds a P-256 key
   * this browser generated and cannot export; crypto.js tries that key
   * against each row and opens the ones it was a recipient of;
   * query.js's `personalSource` turns what opened into a source with no
   * floor; `BinderDashboard.renderAnswer` draws the answer. Nothing
   * decrypted leaves this function's own frame, nothing decrypted is
   * stored anywhere, and the service saw none of it.
   *
   * WHY THE FLOOR IS ZERO HERE AND IS NOT ON charts.html. The
   * published document is other people, so every cell of it was reduced
   * to at least MIN_CELL before it was published. These rows are one
   * person's own, and suppressing a member's own March because March
   * held one entry would be hiding somebody's data from themselves. The
   * difference is structural rather than a flag: two different builder
   * functions, and `run` takes the floor from the source, so there is
   * no sentence in the engine's language that asks for floor 0 over
   * anybody else's data.
   *
   * EVERY WAY THIS CAN COME UP EMPTY HAS ITS OWN SENTENCE, because they
   * are not the same event to the person reading them: a browser that
   * cannot keep a key, a browser whose key is new, a history sealed
   * before this feature existed, and a page that could not reach the
   * service are four different things to do next. A single "nothing to
   * show" would be one answer to four questions.
   */
  function historyStatus(message, bad) {
    const line = $("history-status");
    if (!line) return;
    line.textContent = message || "";
    line.className = bad ? "status bad" : "status";
    show(line, Boolean(message));
  }

  /*
   * A stored row and its opened record, in the shape the snapshot
   * builder reads.
   *
   * NO HANDLE. The record carries one and this deliberately drops it.
   * `personalSource` builds its snapshot with `identify: true`, which
   * captions every series line "@" + telegram - and a caption naming
   * the one person looking at it tells them nothing they do not know
   * while putting a handle in a structure the listeners below hold for
   * the life of the tab. The pane is the member's own; a label does not
   * need the handle. It also empties `quality.handleChanges` at the
   * source rather than only scrubbing it afterwards.
   *
   * WHAT ACTUALLY MAKES THESE ROWS THEIRS, said plainly because the
   * obvious answer is wrong. `personalSource` refuses a list belonging
   * to more than one person, and that guard CANNOT FIRE from this call
   * site: it counts through BinderDashboard.peopleCount, which keys on
   * `accountId` first, and the line below stamps every row with the one
   * account unconditionally - so the count is one however many members'
   * rows arrived. The guard is real for a caller that passes rows
   * through; here it is a tautology.
   *
   * The mechanism that does the work is server-side: the account clause
   * in GET /my-entries' statement, bound from the session and with
   * nothing on the wire to point it elsewhere. dev/worker.test.mjs
   * proves it by partition - the two accounts' listings are disjoint
   * and together they are the whole table. Do not read the guard below
   * as a second line of defence, because from here it is not one.
   */
  function historyEntry(row, record) {
    const weight = record.weight || {};
    const height = record.height || {};
    const entered = record.entered || {};
    return {
      id: row.id,
      accountId: account,
      receivedAt: row.receivedAt,
      submittedAt: record.submittedAt,
      kg: weight.kg, lb: weight.lb,
      cm: height.cm, totalInches: height.totalInches,
      feet: height.feet, inches: height.inches,
      enteredUnits: entered.units,
      enteredWeight: entered.weight,
      enteredHeight: entered.height,
      gender: record.gender,
      roles: Array.isArray(record.roles) ? record.roles.slice() : [],
      country: record.country,
      over18: record.over18 === true,
      recordVersion: record.record,
    };
  }

  /*
   * What the listeners are allowed to keep, and nothing else.
   *
   * The source below outlives this function: every control's handler
   * closes over it, so whatever is in it sits in memory for the life of
   * the tab. `personalSource` builds its snapshot with `identify: true`
   * - the keyholder's own setting - which is right for the numbers and
   * wrong for everything beside them, because that setting also fills
   * in a data-quality panel and a per-person series that exist for
   * somebody auditing OTHER people's rows.
   *
   * `run` reads exactly one member of this document: `bases[basis]`.
   * That is checkable rather than asserted - it is the only
   * `source.snapshot.` read in apps/web/query.js. So everything else
   * goes, and what survives the frame that decrypted these rows is the
   * partitions the chart is drawn from: counts by category and
   * histogram bins, already reduced from the rows rather than being
   * them.
   *
   * WHAT IS DELETED AND WHY EACH ONE. `quality` is heightChanges and
   * handleChanges - a member's measurement disagreements listed out,
   * which the pane never draws. `series` is the per-person line, whose
   * points are unquantized under `identify` and whose label is the
   * handle. `counts` and `movement` are summary numbers nothing here
   * renders. None of it is a secret from the member; all of it is
   * retained plaintext with no reader, and the rule this follows is
   * DESIGN.md's positional one at the smallest scale - plaintext exists
   * where it must and nowhere else.
   *
   * Deleting rather than rebuilding, because the object has to stay the
   * one `personalSource` made: `run` refuses a source it did not build,
   * which is what stops a caller hand-making a floor-0 source over
   * somebody else's document. A copy would not be that object.
   */
  function scrub(snapshot) {
    delete snapshot.quality;
    delete snapshot.series;
    delete snapshot.counts;
    delete snapshot.movement;
  }

  /*
   * Ask the engine, draw the answer.
   *
   * The source is built ONCE and kept, because rebuilding it per
   * question would decrypt the rows again for every keystroke - and
   * because the plaintext that built it is already gone by then. What
   * survives this function is a snapshot: counts, medians and bins over
   * the member's own numbers, which is what they came to read.
   */
  function askHistory(source) {
    const Query = root.BinderQuery;
    const answerAt = $("history-answer");
    const split = $("h-split").value;
    const shape = Query.SPLITS[split];
    if (!shape || !answerAt) return;

    const bins = shape.kind === "bins";
    /* A middle needs numbers to take the middle of, so the measure only
     * offers itself for the binned splits - the same rule the published
     * card follows, because it is the engine's rule and not a page's. */
    const measure = bins ? UI.checkedValue("h-measure", "count") : "count";
    show($("h-measure-field"), bins);

    /*
     * ONE QUERY OBJECT, ASKED AND DESCRIBED. Two literals here would be
     * two questions - and the one that draws the chart and the one that
     * captions it would drift on whichever member was omitted from the
     * second. That is not hypothetical: a caption built without `units`
     * reads "(imperial)" over a metric chart, because `describe`
     * normalizes an absent units the same way `run` does and neither
     * has any way to know the other was asked something else.
     */
    const query = {
      // Entries, always. "How many people" over one person's own rows is
      // one person, and their history is the thing being asked about -
      // so the basis follows from what the source is rather than from a
      // control offering a question with one answer.
      basis: "entries",
      split: split,
      measure: measure,
      // The form's own units choice, which is this page's only one. A
      // second control here would let one page hold two answers to the
      // same question.
      units: UI.checkedValue("units", root.BinderDashboard.DEFAULT_UNITS),
    };

    let answer;
    try {
      answer = Query.run(source, query);
    } catch (error) {
      historyStatus("That question could not be asked. " +
        (error && error.message ? error.message : ""), true);
      return;
    }
    historyStatus("", false);
    root.BinderDashboard.renderAnswer(answerAt, answer, Query.describe(query));
  }

  async function openHistory() {
    const config = root.BINDER_CONFIG || {};
    const Keys = root.BinderMemberKey;
    const Crypto = root.BinderCrypto;
    const Query = root.BinderQuery;
    const card = $("your-history");

    /* Any of these missing is a page that did not fully load, not a
     * member with nothing to read. The account card above still paints,
     * because counts do not need a key. */
    if (!card || !Keys || !Crypto || !Query || !root.BinderDashboard ||
        !config.endpoint || !account) {
      return;
    }
    show(card, true);

    const key = await Keys.ensure(account);
    if (!key) {
      historyStatus("This browser cannot keep a key of your own, so your " +
        "entries stay sealed here. " + (Keys.unavailableReason() || ""), false);
      return;
    }

    let rows;
    try {
      const response = await fetch(config.endpoint + "/my-entries", {
        headers: Session.authorization(),
      });
      if (response.status === 401) {
        // The same handling the account summary above uses, and for the
        // same reason: a credential the endpoint refuses is one this tab
        // must stop holding.
        Session.clear();
        if (root.location && typeof root.location.replace === "function") {
          root.location.replace("index.html");
        }
        return;
      }
      if (!response.ok) throw new Error("The server answered " +
        response.status + ".");
      const payload = await response.json();
      rows = payload && payload.ok === true && Array.isArray(payload.entries)
        ? payload.entries : null;
      if (!rows) throw new Error("The server returned an invalid listing.");
    } catch (error) {
      historyStatus("Your entries could not be fetched. " +
        (error && error.message ? error.message : "The connection failed."),
      true);
      return;
    }

    if (!rows.length) {
      historyStatus("You have no entries yet. Weigh in and this fills up.",
        false);
      return;
    }

    /*
     * One at a time, and a row that will not open is COUNTED rather than
     * skipped. Three causes, and all three are ordinary: a row stored
     * before this browser had a key, a row from a device that is gone,
     * and a row from before a sign-out here destroyed the key that would
     * have opened it - the last is a documented price rather than a
     * fault, and it is the one a member is most likely to meet. All
     * three are exactly the rows an admin can unseal. Dropping them
     * silently would leave a member reading an answer over fewer entries
     * than they have, with nothing on the page saying so.
     */
    const entries = [];
    let sealed = 0;
    for (const row of rows) {
      try {
        entries.push(historyEntry(row,
          await Crypto.decrypt(row.ciphertext, key.privateKey)));
      } catch (error) {
        sealed += 1;
      }
    }

    const sealedCount = $("history-sealed-count");
    if (sealedCount) sealedCount.textContent = String(sealed);
    show($("history-sealed"), sealed > 0);

    if (!entries.length) {
      /*
       * FOUR CAUSES, AND THE LAST TWO ARE THE ONES THIS PAGE OWES AN
       * EXPLANATION FOR, because both happen on the very device the
       * member is holding and both otherwise read as a fault.
       *
       * Signing out destroys the device key on purpose - the whole point
       * is that a shared browser hands nobody the previous member's
       * history - so a member who signs out and back in finds everything
       * sealed where they are sitting.
       *
       * The fourth is this page's own timing. form.js can only widen a
       * seal to an account it has been told about, and it is told on the
       * event this module fires once /me answers; nothing gates Send on
       * that answer, deliberately, because blocking a submission on a
       * request that may never return is the worse failure. So a member
       * on a slow connection who fills the form and presses Send
       * immediately gets a keyholder-only row, permanently, on a browser
       * that holds a perfectly good key.
       *
       * The remedy sentence is the one the partial-history line already
       * uses, word for word: a member who reads either of them is in the
       * same position and there is no reason for two answers.
       */
      historyStatus("None of your entries were sealed to this browser. " +
        "They were stored before this browser had a key of its own, on a " +
        "device this is not, before signing out here destroyed the key " +
        "that would have opened them, or before this page had finished " +
        "loading your account. Ask an admin to unlock them.", false);
      return;
    }

    let source;
    try {
      source = Query.personalSource(entries, Date.now());
      scrub(source.snapshot);
    } catch (error) {
      historyStatus("Your entries could not be read as a history. " +
        (error && error.message ? error.message : ""), true);
      return;
    }

    show($("history-controls"), true);
    $("h-split").addEventListener("change", function () { askHistory(source); });
    Array.prototype.forEach.call(
      document.querySelectorAll('input[name="h-measure"]'),
      function (input) {
        input.addEventListener("change", function () { askHistory(source); });
      });
    Array.prototype.forEach.call(
      document.querySelectorAll('input[name="units"]'),
      function (input) {
        input.addEventListener("change", function () { askHistory(source); });
      });
    askHistory(source);
  }

  /*
   * The one path that moves the baseline: a row the Worker accepted.
   *
   * form.js announces the height the stored record actually carried, so
   * what the next entry is measured against is what was sealed rather
   * than a second reading of the boxes. A send that was refused
   * announces nothing and therefore moves nothing - the same property
   * the confirmation card already relies on, applied to the value that
   * decides whether a member gets asked about their next height.
   */
  function rememberHeight(event) {
    const cm = usableHeight(event && event.detail
      ? event.detail.heightCm : null);
    if (cm === null) return;
    lastHeightCm = cm;
    savePrefill();
    announceBaseline();
  }

  async function setUp() {
    if (!Session) throw new Error("This page did not load session handling.");
    const session = Session.require();
    if (!session) return;

    FIELD_IDS.forEach(function (id) {
      const field = $(id);
      if (field) field.addEventListener("input", savePrefill);
    });
    Array.prototype.forEach.call(
      document.querySelectorAll('input[name="units"]'),
      function (input) { input.addEventListener("change", savePrefill); });
    CHOICE_IDS.forEach(function (id) {
      const field = $(id);
      if (field) field.addEventListener("change", savePrefill);
    });
    Array.prototype.forEach.call(
      document.querySelectorAll('input[name="roles"]'),
      function (input) { input.addEventListener("change", savePrefill); });

    const entriesTab = $("your-entries-tab");
    const addTab = $("add-entry-tab");
    if (entriesTab) {
      entriesTab.addEventListener("click", function () { chooseTab("entries"); });
    }
    if (addTab) {
      addTab.addEventListener("click", function () { chooseTab("add"); });
    }
    document.addEventListener(SUBMITTED_EVENT, refreshPanel);
    document.addEventListener(SUBMITTED_EVENT, rememberHeight);

    show($("member-tabs"), true);
    chooseTab("entries");
    showTelegramId(session);

    // The prefill is restored AFTER /me, not before, and the order is the
    // whole point of #56: the account id that says whose data this is only
    // arrives with that response. Restoring first would paint the previous
    // member's measurements for as long as the request takes, which is the
    // exposure this closed - briefly, but into a screen somebody is looking
    // at.
    await refreshPanel();
    restorePrefill();
    // After refreshPanel(), because the account id it validates is what
    // says whose key this is - and #56's rule is that a key or a value
    // scoped to nobody is a key or a value shown to the wrong member.
    // Not awaited by setUp's own callers: opening a history is a read
    // that can take as long as it takes, and the form above it must not
    // wait on it to become usable.
    await openHistory();
  }
})(globalThis);
