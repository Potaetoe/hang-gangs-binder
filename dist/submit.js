

(function (root) {
  "use strict";

  if (typeof document === "undefined") return;

  const SignOut = root.BinderSignOut;

  

  const PREFILL_KEY = SignOut.prefillKey;
  const SUBMITTED_EVENT = "binder:submitted";

   
   
   
  const ADD_ENTRY_SHOWN_EVENT = "binder:add-entry-shown";

   
   
   
   
  const HEIGHT_BASELINE_EVENT = "binder:height-baseline";

   
   
   
   
   
  const ACCOUNT_EVENT = "binder:account";

   
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
    detail(error && error.message ? error.message : "boot failed with no " +
      "message");
    setStatus("This page did not start correctly, so what is on record " +
      "may be missing.", true);
  });

  

  function detail(technical) {
    if (technical && root.console &&
        typeof root.console.warn === "function") {
      root.console.warn("binder: " + technical);
    }
  }

  

  function plainly(error, fallback) {
    detail(error && error.message ? error.message : "refused with no message");
    return error && typeof error.plain === "string" && error.plain
      ? error.plain
      : fallback;
  }

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
      last.textContent = "We cannot read when that was";
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
      setStatus("This site is not set up to reach the service that keeps " +
        "your entries.", true);
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
        detail("the /me route answered " + response.status);
        throw new Error("");
      }
      const payload = await response.json();
      if (!payload || payload.ok !== true ||
          !Number.isInteger(payload.entries) || payload.entries < 0) {
        detail("the /me route answered with no usable account summary");
        throw new Error("");
      }
       
       
       
      account = typeof payload.accountId === "string" && payload.accountId
        ? payload.accountId
        : null;
      announceAccount();
      renderAccount(payload);
      setStatus("", false);
    } catch (error) {
       
       
       
      detail(error && error.message ? error.message : "the /me route " +
        "could not be reached");
      setStatus("Your entry count could not be refreshed — reload the " +
        "page.", true);
    }
  }

   
   

  

  function historyStatus(message, bad) {
    const line = $("history-status");
    if (!line) return;
    line.textContent = message || "";
    line.className = bad ? "status bad" : "status";
    show(line, Boolean(message));
  }

  

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

  

  function scrub(snapshot) {
    delete snapshot.quality;
    delete snapshot.series;
    delete snapshot.counts;
    delete snapshot.movement;
  }

  

  function askHistory(source) {
    const Query = root.BinderQuery;
    const answerAt = $("history-answer");
    const split = $("h-split").value;
    const shape = Query.SPLITS[split];
    if (!shape || !answerAt) return;

    const bins = shape.kind === "bins";
    

    const measure = bins ? UI.checkedValue("h-measure", "count") : "count";
    show($("h-measure-field"), bins);

    

    const query = {
       
       
       
       
      basis: "entries",
      split: split,
      measure: measure,
       
       
       
      units: UI.checkedValue("units", root.BinderDashboard.DEFAULT_UNITS),
    };

    let answer;
    try {
      answer = Query.run(source, query);
    } catch (error) {
       
       
       
       
      historyStatus(plainly(error, "That question could not be asked."),
        true);
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

    

    if (!card || !Keys || !Crypto || !Query || !root.BinderDashboard ||
        !config.endpoint || !account) {
      return;
    }
    show(card, true);

    const key = await Keys.ensure(account);
    if (!key) {
       
       
       
       
      detail(Keys.unavailableReason() || "this browser keeps no key");
      historyStatus("This browser cannot keep a key of your own, so your " +
        "entries stay sealed here.", false);
      return;
    }

    let rows;
    try {
      const response = await fetch(config.endpoint + "/my-entries", {
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
        detail("the /my-entries route answered " + response.status);
        throw new Error("");
      }
      const payload = await response.json();
      rows = payload && payload.ok === true && Array.isArray(payload.entries)
        ? payload.entries : null;
      if (!rows) {
        detail("the /my-entries route answered with no usable listing");
        throw new Error("");
      }
    } catch (error) {
      detail(error && error.message ? error.message : "the /my-entries " +
        "route could not be reached");
      historyStatus("Your entries could not be fetched — reload the page.",
        true);
      return;
    }

    if (!rows.length) {
      historyStatus("No entries yet — weigh in and this fills up.", false);
      return;
    }

    

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
    if (sealedCount) {
      sealedCount.textContent = sealed === 1 ? "1 row" : sealed + " rows";
    }
    

    show($("history-sealed"), sealed > 0 && entries.length > 0);

    if (!entries.length) {
      

      historyStatus("None of your entries can be opened here. " +
        "Ask an admin.", false);
      return;
    }

    let source;
    try {
      source = Query.personalSource(entries, Date.now());
      scrub(source.snapshot);
    } catch (error) {
       
       
       
       
      historyStatus(
        plainly(error, "Your entries could not be read as a history."),
        true);
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
     
     
     
     
     
     
    await openHistory();
  }
})(globalThis);
