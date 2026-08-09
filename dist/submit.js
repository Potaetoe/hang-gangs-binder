

(function (root) {
  "use strict";

  if (typeof document === "undefined") return;

  const SignOut = root.BinderSignOut;

  

  const PREFILL_KEY = SignOut.prefillKey;
  const SUBMITTED_EVENT = "binder:submitted";

   
   
   
  const ADD_ENTRY_SHOWN_EVENT = "binder:add-entry-shown";

   
   
   
   
  const HEIGHT_BASELINE_EVENT = "binder:height-baseline";

   
  const FIELD_IDS = [
    "weight-lb", "height-ft", "height-in", "weight-kg", "height-cm",
  ];

   
   
   
   
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
       
       
       
    }
    clearPrefill();
    return null;
  }

   
   
   
   
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

  

  let lastHeightCm = null;

  function usableHeight(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

   
   
   
   
  function announceBaseline() {
    document.dispatchEvent(new CustomEvent(HEIGHT_BASELINE_EVENT, {
      detail: { lastHeightCm: lastHeightCm },
    }));
  }

  

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
      gender: fieldValue("gender"),
      country: fieldValue("country"),
      roles: checkedRoles(),
      over18: isChecked("over18"),
      lastHeightCm: lastHeightCm,
    };
    try { store.setItem(PREFILL_KEY, JSON.stringify(value)); }
    catch (error) {   }
  }

  function restorePrefill() {
    const value = readPrefill(account);
    if (!value) return;

    

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

    

    const over18 = value.over18 === true;
    if (over18) {
      const box = $("over18");
      if (box) box.checked = true;
    }

    

    show($("over18-remembered"), over18);
    show($("prefill-note"), true);

    

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

     
     
     
     
     
     
    await refreshPanel();
    restorePrefill();
  }
})(globalThis);
