/*
 * The member panel around the submission form.
 *
 * Counts come only from GET /me. The form announces when the Worker has
 * accepted a submission, and this file responds by reading /me again; it
 * never guesses that the count rose by one. It also owns the device-local
 * measurement prefill. That prefill is not a credential, but it is cleartext
 * body data, so the visible sign-out action removes it with the session.
 */
(function (root) {
  "use strict";

  if (typeof document === "undefined") return;

  const PREFILL_KEY = "hgb-submit-prefill";
  const SUBMITTED_EVENT = "binder:submitted";

  // The other direction: form.js tells this file a row was stored, and this
  // file tells form.js the form is on screen again. Two events rather than
  // one shared object, so neither file reaches into the other's elements.
  const ADD_ENTRY_SHOWN_EVENT = "binder:add-entry-shown";
  const FIELD_IDS = [
    "weight-lb", "height-ft", "height-in", "weight-kg", "height-cm",
  ];
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
   * sessionStorage dies with the tab and localStorage does not, so before
   * this a member who closed the tab instead of signing out left weight and
   * height behind for whoever signed in next on that browser. Sign out
   * cleared it, which is the path nobody actually takes.
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

  function clearPrefill() {
    const store = localStore();
    if (!store) return;
    try { store.removeItem(PREFILL_KEY); } catch (error) {}
  }

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

  /*
   * Whose device-local data this is, as reported by /me. Held rather than
   * re-read because savePrefill runs on every keystroke and must not write
   * an unattributed prefill: if /me has not answered, or answered with no
   * account, there is nothing to scope the data to and it is not stored.
   * Refusing to write is the safe direction - the cost is a lost
   * convenience, and the alternative cost is somebody else's measurements.
   */
  let account = null;

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
    };
    try { store.setItem(PREFILL_KEY, JSON.stringify(value)); }
    catch (error) { /* A blocked store leaves an ordinary empty prefill. */ }
  }

  function restorePrefill() {
    const value = readPrefill(account);
    if (!value) return;

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
    const selected = unitInputs.find(function (input) { return input.checked; });
    if (selected) selected.dispatchEvent(new Event("change", { bubbles: true }));
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

  function renderAccount(payload) {
    $("member-entry-count").textContent = String(payload.entries);
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
      renderAccount(payload);
      setStatus("", false);
    } catch (error) {
      setStatus("Your account summary could not be refreshed. " +
        (error && error.message ? error.message : "The connection failed."),
      true);
    }
  }

  /*
   * Ask the endpoint to delete the session row, and do not wait to hear
   * back - #90.
   *
   * Dropping this tab's copy of the token is not the end of a session.
   * The row is, and without this request it survives to its natural
   * expiry: a token captured beforehand stays a working credential for
   * up to seven days, which is exactly the window somebody pressing
   * Sign out is trying to close.
   *
   * Best-effort is the design and not a shortcut. Awaiting this would
   * put the network between a member and signing out - a dead
   * connection, or a Worker that never answers, and the button does
   * nothing while the credential sits in this tab. The row expires on
   * its own either way, so a failed revoke costs the hardening; a failed
   * sign-out costs the thing the button is for. Nothing is reported for
   * it either: the user-visible act is the local clear below, it always
   * succeeds, and a message about the other half would describe a
   * sign-out that did not happen.
   *
   * keepalive is load-bearing, not decoration. signOut() navigates in
   * the same turn, and a browser cancels in-flight fetches when the page
   * goes; without it this is a request that reliably never arrives.
   *
   * No session, no request. The endpoint refuses a DELETE it cannot
   * authenticate, and there is no row to end.
   */
  function revokeSession() {
    const config = root.BINDER_CONFIG || {};
    const headers = Session.authorization();
    if (!config.endpoint || !headers.Authorization) return;

    fetch(config.endpoint + "/session", {
      method: "DELETE",
      headers: headers,
      keepalive: true,
    }).catch(function () {
      // Handled so an abandoned promise cannot log a rejection about a
      // sign-out that, from here, worked.
    });
  }

  function signOut() {
    // Ordered: the revoke needs the token that the next two lines
    // destroy. The session is authority and the prefill is cleartext
    // body data, so both leave together - "Sign out" means this device
    // retains neither, and the endpoint keeps neither either.
    revokeSession();
    clearPrefill();
    Session.clear();
    if (root.location && typeof root.location.replace === "function") {
      root.location.replace("index.html");
    }
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

    const entriesTab = $("your-entries-tab");
    const addTab = $("add-entry-tab");
    const signOutButton = $("sign-out");
    if (entriesTab) {
      entriesTab.addEventListener("click", function () { chooseTab("entries"); });
    }
    if (addTab) {
      addTab.addEventListener("click", function () { chooseTab("add"); });
    }
    if (signOutButton) signOutButton.addEventListener("click", signOut);
    document.addEventListener(SUBMITTED_EVENT, refreshPanel);

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
  }
})(globalThis);
