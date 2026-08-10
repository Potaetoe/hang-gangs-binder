

(function (root) {
  "use strict";

  

  const COLUMNS = [
    "id",
    "account_id",
    "received_at",
    "submitted_at",
    "telegram",
    "weight_kg",
    "weight_lb",
    "height_cm",
    "height_total_inches",
    "height_feet",
    "height_inches",
    "entered_units",
    "entered_weight",
    "entered_height",
    "gender",
    "roles",
    "country",
    "over18",
    "record_version",
  ];

  

  function at(object, path) {
    let value = object;
    for (const step of path) {
      if (value === null || value === undefined) return null;
      value = value[step];
    }
    return value === null || value === undefined ? null : value;
  }

  

  function entryFor(submission, record) {
    return {
      id: at(submission, ["id"]),
      accountId: at(submission, ["account_id"]),
      receivedAt: at(submission, ["received_at"]),
      submittedAt: at(record, ["submittedAt"]),
      telegram: at(record, ["telegram"]),
      kg: at(record, ["weight", "kg"]),
      lb: at(record, ["weight", "lb"]),
      cm: at(record, ["height", "cm"]),
      totalInches: at(record, ["height", "totalInches"]),
      feet: at(record, ["height", "feet"]),
      inches: at(record, ["height", "inches"]),
      enteredUnits: at(record, ["entered", "units"]),
      enteredWeight: at(record, ["entered", "weight"]),
      enteredHeight: at(record, ["entered", "height"]),
      gender: at(record, ["gender"]),
      roles: Array.isArray(record && record.roles) ? record.roles.slice() : [],
      country: at(record, ["country"]),
      over18: at(record, ["over18"]) === true,
      recordVersion: at(record, ["record"]),
    };
  }

  

  function blank(value) {
    return value === null || value === undefined ? "" : value;
  }

  function rowFor(entry) {
    return [
      blank(entry.id),
      blank(entry.accountId),
      blank(entry.receivedAt),
      blank(entry.submittedAt),
      blank(entry.telegram),
      blank(entry.kg),
      blank(entry.lb),
      blank(entry.cm),
      blank(entry.totalInches),
      blank(entry.feet),
      blank(entry.inches),
      blank(entry.enteredUnits),
      blank(entry.enteredWeight),
      blank(entry.enteredHeight),
      blank(entry.gender),
      entry.roles.join(";"),
      blank(entry.country),
      entry.over18 === true ? "yes" : "",
      blank(entry.recordVersion),
    ];
  }

  

  function csvCell(value) {
    let text = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    if (/[",\n\r]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  

  function toCsv(rows) {
    const lines = [COLUMNS.join(",")];
    for (const row of rows) lines.push(row.map(csvCell).join(","));
    return lines.join("\r\n") + "\r\n";
  }

  

  function toJson(entries) {
    return JSON.stringify({
      exported: new Date().toISOString(),
      count: entries.length,
      submissions: entries,
    }, null, 2) + "\n";
  }

  function fileName(now, extension) {
    const date = new Date(now).toISOString().slice(0, 10);
    return "hang-gangs-binder-" + date + "." + (extension || "csv");
  }

  

  const STORED_KEY_WRONG = "The key stored on this device is not the one " +
    "this site encrypts to, so it has been removed. Choose your key file.";
  const STORED_KEY_DAMAGED = "What was stored on this device is not a " +
    "usable key, so it has been removed. Choose your key file.";

  function storedKeyVerdict(record, expectedPublicKey) {
    if (record === null || record === undefined) {
      return { key: null, erase: false, why: null };
    }
    if (record && typeof record === "object" &&
        record.privateKey && record.privateKey.type === "private" &&
        record.privateKey.extractable === false &&
        typeof record.publicKey === "string" && record.publicKey &&
        typeof expectedPublicKey === "string" && expectedPublicKey &&
        record.publicKey === expectedPublicKey) {
      return { key: record.privateKey, erase: false, why: null };
    }
    const named = record && typeof record === "object" &&
      typeof record.publicKey === "string" && record.publicKey &&
      record.publicKey !== expectedPublicKey;
    return {
      key: null,
      erase: true,
      why: named ? STORED_KEY_WRONG : STORED_KEY_DAMAGED,
    };
  }

  

  function storedKeyNotice(persisted) {
    return persisted
      ? "Your key is kept on this device, and the browser has marked " +
        "this site's storage persistent, so ordinary cleanup leaves it " +
        "alone. Clearing this site's data removes it, and so does Clear."
      : "Your key is kept on this device, but the browser did not mark " +
        "this site's storage persistent, so it can be evicted - some " +
        "browsers drop it after about a week without a visit. Keep your " +
        "key file: it is what puts the key back.";
  }

   
   

  

  const MEMBERSHIP_ROLES = Object.freeze(["admin", "always_allow"]);

  

  const MEMBERSHIP_FIELDS = ["membership", "malformed", "secretOnly"];

  

  function isRow(row) {
    return Boolean(row) && typeof row === "object" &&
      typeof row.account_id === "string" && row.account_id !== "";
  }

  function membershipView(payload) {
    const body = payload && typeof payload === "object" ? payload : {};
    const lists = MEMBERSHIP_ROLES.map(function (role) {
      return { role: role, rows: [] };
    });
    const unknown = [];
    const malformed = [];
    const secretOnly = [];
    const absent = [];
    let dropped = 0;

    for (const field of MEMBERSHIP_FIELDS) {
      if (!Array.isArray(body[field])) absent.push(field);
    }

    for (const row of Array.isArray(body.membership) ? body.membership : []) {
      if (!isRow(row)) {
        dropped++;
        continue;
      }
      const known = lists.filter(function (list) {
        return list.role === row.role;
      })[0];
       
      if (known) known.rows.push(row);
      else unknown.push(row);
    }

    for (const row of Array.isArray(body.malformed) ? body.malformed : []) {
      if (isRow(row)) malformed.push(row);
      else dropped++;
    }

    for (const id of Array.isArray(body.secretOnly) ? body.secretOnly : []) {
      if (typeof id === "string" && id) secretOnly.push(id);
      else dropped++;
    }

    return {
      lists: lists,
      unknown: unknown,
      malformed: malformed,
      secretOnly: secretOnly,
      absent: absent,
      dropped: dropped,
    };
  }

  

  function secretOnlyNotice(view) {
    if (!view || view.absent.indexOf("secretOnly") !== -1) {
      return "This Worker did not report which admins the secret grants " +
        "on its own, so nothing here can say whether the backfill is " +
        "finished. Read GET /membership directly before acting on this.";
    }
    if (!view.secretOnly.length) {
      return "Every admin the ADMIN_TELEGRAM_IDS secret grants also holds " +
        "a row above. That is the go-signal: dropping the secret arm now " +
        "would take nobody's authority away.";
    }
    return view.secretOnly.length + " admin(s) are granted by the " +
      "ADMIN_TELEGRAM_IDS secret and by no row above, so the backfill is " +
      "not finished. Their account ids are listed below, and they name " +
      "nobody: each is a one-way hash, nothing on this page can turn one " +
      "back into a person, and the numeric ids behind them are inside a " +
      "secret that is unreadable by design. Add each of those people by " +
      "their numeric id above until this list is empty.";
  }

  

  const REFUSED = 401;

  

  function refusalFor(status, payload) {
    const said = payload && typeof payload === "object" &&
      typeof payload.error === "string" && payload.error.trim()
      ? payload.error.trim()
      : "";

    if (status === REFUSED) {
      return {
        action: "signed-out",
        message: "The admin session was not accepted, so it has been " +
          "discarded. Sign in again.",
      };
    }
    if (status === 409) {
      return {
        action: "show",
        message: (said || "The Worker refused that removal.") +
          " Nothing was removed; the lists below are what it holds now.",
      };
    }
    return {
      action: "show",
      message: said || (status
        ? "The server answered " + status + "."
        : "The connection failed."),
    };
  }

  

  function addedNotice(role, label) {
    const named = typeof label === "string" && label.trim()
      ? label.trim()
      : "That account";
    if (role === "admin") {
      return named + " is on the admin list, and becomes an admin at " +
        "their NEXT sign-in: the admin flag is minted when a session is " +
        "created, so a session they are already holding does not change. " +
        "Ask them to sign out and in again.";
    }
    return named + " is on the always-allow list, and is past the group " +
      "check from their next request. Removing this row later is not a " +
      "revocation while ALWAYS_ALLOW_TELEGRAM_IDS still names them - that " +
      "secret is checked first, and it is not managed from here.";
  }

  

  function removalStep(row, armed) {
    const named = row && typeof row.label === "string" && row.label.trim()
      ? row.label.trim()
      : "";
    if (armed) {
      return named
        ? "Confirm removing " + named
        : "Confirm removing this row";
    }
    return named ? "Remove " + named : "Remove this row";
  }

   
   

  

  const IDLE_WINDOW = Object.freeze({
    idleMs: 10 * 60 * 1000,
    warnMs: 2 * 60 * 1000,
  });

  

  function idleVerdict(lastInteraction, now, limits) {
    const bounds = limits || IDLE_WINDOW;
    const idle = now - lastInteraction;
    if (!Number.isFinite(lastInteraction) || !Number.isFinite(now) ||
        !(idle >= 0)) {
      return { state: "expired", msLeft: 0 };
    }
    const msLeft = bounds.idleMs - idle;
    if (msLeft <= 0) return { state: "expired", msLeft: 0 };
    return {
      state: msLeft <= bounds.warnMs ? "warning" : "active",
      msLeft: msLeft,
    };
  }

  

  function idleNotice(verdict) {
    if (!verdict || verdict.state !== "warning") return "";
    const seconds = Math.ceil(verdict.msLeft / 1000);
    const rest = seconds % 60;
    return "Nobody has touched this page for a while. It is the only " +
      "place the submissions exist in the clear, so it will clear itself " +
      "and sign you out in " + Math.floor(seconds / 60) + ":" +
      (rest < 10 ? "0" : "") + rest +
      ". Any key, click or scroll keeps it open.";
  }

   
   
   
   
  root.BinderAdmin = Object.freeze({
    COLUMNS: COLUMNS,
    entryFor: entryFor,
    rowFor: rowFor,
    csvCell: csvCell,
    toCsv: toCsv,
    toJson: toJson,
    fileName: fileName,
    storedKeyVerdict: storedKeyVerdict,
    storedKeyNotice: storedKeyNotice,
    MEMBERSHIP_ROLES: MEMBERSHIP_ROLES,
    membershipView: membershipView,
    secretOnlyNotice: secretOnlyNotice,
    refusalFor: refusalFor,
    addedNotice: addedNotice,
    removalStep: removalStep,
    IDLE_WINDOW: IDLE_WINDOW,
    idleVerdict: idleVerdict,
    idleNotice: idleNotice,
  });

   
   

  if (typeof document === "undefined") return;

  const UI = root.BinderUI;
  const $ = UI.byId;
  const show = UI.show;

  

  

  const DOWNLOAD_IDS = Object.freeze(
    ["download", "download-xlsx", "download-json"]);
  const PRESSED_MS = 4000;

  const KEY_DB = "hgb-keyholder-key";
  const KEY_STORE = "key";
  const KEY_ROW = "current";

  function openKeyDb() {
    return new Promise(function (resolve, reject) {
      if (!root.indexedDB) {
        reject(new Error("this browser keeps no database for this site"));
        return;
      }
      const request = root.indexedDB.open(KEY_DB, 1);
      request.onupgradeneeded = function () {
        request.result.createObjectStore(KEY_STORE);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

   
   
  async function withKeyStore(mode, act) {
    const db = await openKeyDb();
    try {
      return await new Promise(function (resolve, reject) {
        const transaction = db.transaction(KEY_STORE, mode);
        const request = act(transaction.objectStore(KEY_STORE));
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error); };
      });
    } finally {
      db.close();
    }
  }

  function readStoredKey() {
    return withKeyStore("readonly", function (store) {
      return store.get(KEY_ROW);
    });
  }

  function writeStoredKey(record) {
    return withKeyStore("readwrite", function (store) {
      return store.put(record, KEY_ROW);
    });
  }

  function forgetStoredKey() {
    return withKeyStore("readwrite", function (store) {
      return store.delete(KEY_ROW);
    });
  }

  

  UI.boot(setUp, function (error) {
    show($("tool"), false);
    const closed = $("closed");
    show(closed, true);
    if (closed) {
      closed.querySelector("[data-reason]").textContent =
        "This page did not start up correctly, so it is not safe to use. " +
        (error && error.message ? "(" + error.message + ")" : "");
    }
  });

  function setUp() {
    if (!root.BinderSession) {
      throw new Error("This page did not load its session handling.");
    }
    const admin = root.BinderSession.require();

     
     
     
    if (!admin) {
      show($("tool"), false);
      return;
    }
    if (!admin.isAdmin) {
      show($("tool"), false);
      const closed = $("closed");
      show(closed, true);
      closed.querySelector("[data-reason]").textContent =
        "This page needs an admin session. Your current session is " +
        "signed in as a member only.";
      return;
    }

    const config = root.BINDER_CONFIG || {};
    const unavailable = root.BinderCrypto
      ? root.BinderCrypto.unavailableReason()
      : "This page did not load its decryption code, so it cannot open " +
        "anything. Reload, and if it persists the site is broken.";

    if (unavailable) {
      show($("tool"), false);
      show($("closed"), true);
      $("closed").querySelector("[data-reason]").textContent = unavailable;
      return;
    }
    show($("tool"), true);

     
     
     
    let entries = [];
    let rows = [];
    let csv = "";
    let json = "";
    let xlsx = null;
    let urls = [];

     
     
     
    let pressedTimer = 0;

     
     
     
    let storedKey = null;
    let kept = "";

    function say(message, tone) {
      UI.setStatus($("status"), message, tone);
    }

     
     
     
     
    function finish(message, tone) {
       
       
       
       
       
      const text = message.trim();
      say(kept ? text + (/[.!?]$/.test(text) ? " " : ". ") + kept : message,
        tone);
      kept = "";
    }

    

    function sessionEnded(where) {
      where(refusalFor(REFUSED).message, "bad");
      root.BinderSession.clear();
      if (root.location && typeof root.location.replace === "function") {
        root.location.replace("index.html");
      }
    }

    

    function sessionRefused(response, where) {
      if (response.status !== REFUSED) return false;
      sessionEnded(where);
      return true;
    }

     
     
     
    function revoke() {
      for (const url of urls) URL.revokeObjectURL(url);
      urls = [];
    }

    

    function acknowledge(link, what) {
      link.classList.add("pressed");
      clearTimeout(pressedTimer);
      pressedTimer = setTimeout(function () {
        for (const id of DOWNLOAD_IDS) $(id).classList.remove("pressed");
      }, PRESSED_MS);
      UI.setStatus($("download-status"),
        what + " handed to the browser. Where it puts a download is the "
        + "browser's to decide, so this page cannot say whether it "
        + "arrived.", null);
    }

     
     
     
     
    function offer(id, content, type, extension) {
      const url = URL.createObjectURL(new Blob([content], { type: type }));
      urls.push(url);
      const link = $(id);
      link.href = url;
      link.download = fileName(Date.now(), extension);
    }

     
     
     
    function rebuildDerived() {
      rows = entries.map(rowFor);
      csv = toCsv(rows);
      json = toJson(entries);
       
       
       
       
       
      xlsx = root.BinderXlsx.build(
        COLUMNS, rows, "Submissions", Date.now());
    }

    function reset() {
      entries = [];
      rows = [];
      csv = "";
      json = "";
      xlsx = null;
      kept = "";
      revoke();
      $("tbody").textContent = "";
      $("summary").textContent = "";
      $("charts").textContent = "";
      show($("results"), false);
      show($("dashboard"), false);
      show($("publish-card"), false);
      show($("failures"), false);
      $("failure-list").textContent = "";
      $("publish-preview-body").textContent = "";
      show($("publish-preview-body"), false);
      $("publish-status").textContent = "";
      show($("publish-status"), false);
    }

    

    $("keyfile-picker").addEventListener("change", function () {
      const file = this.files && this.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        $("keyfile").value = String(reader.result || "");
        say("Key file loaded. It stays in this page.", null);
      };
      reader.onerror = function () {
        say("That file could not be read.", "bad");
      };
      reader.readAsText(file);
    });

    

    $("clear").addEventListener("click", async function () {
      $("keyfile").value = "";
      $("keyfile-picker").value = "";
      storedKey = null;
      reset();

      let removed;
      try {
        await forgetStoredKey();
        removed = true;
      } catch (error) {
         
         
         
        removed = !root.indexedDB;
      }

      say(removed
        ? "Cleared. Nothing from the last export is on this page, and no " +
          "key is stored on this device - the next export needs your key " +
          "file."
        : "This page is cleared, but the key stored on this device could " +
          "not be removed. Clear this site's data in the browser's " +
          "settings, and treat the key as still on this machine until " +
          "you have.",
        removed ? null : "bad");
    });

     
    


    

    const INTERACTION = ["pointerdown", "keydown", "wheel", "touchstart"];

    

    const TICK_MS = 1000;

    let lastInteraction = Date.now();
    let warned = false;
    let ticker = null;

    function hideWarning() {
      if (!warned) return;
      warned = false;
      show($("idle-warning"), false);
    }

     
     
     
    function markInteraction() {
      lastInteraction = Date.now();
      hideWarning();
    }

    for (const type of INTERACTION) {
      document.addEventListener(type, markInteraction, {
        capture: true,
        passive: true,
      });
    }

    

    function endForIdle() {
      root.clearInterval(ticker);
      $("keyfile").value = "";
      $("keyfile-picker").value = "";
      reset();
      root.BinderSignOut.signOut();
    }

    function checkAttention() {
      const verdict = idleVerdict(lastInteraction, Date.now());
      if (verdict.state === "expired") {
        endForIdle();
        return;
      }
      if (verdict.state !== "warning") {
        hideWarning();
        return;
      }
      $("idle-countdown").textContent = idleNotice(verdict);
      if (warned) return;
      warned = true;
      show($("idle-warning"), true);
       
       
       
       
       
      $("idle-stay").focus();
    }

    ticker = root.setInterval(checkAttention, TICK_MS);

     
     
     
     
    $("idle-stay").addEventListener("click", markInteraction);

     
     
     
     
    for (const id of DOWNLOAD_IDS) {
      const link = $(id);
      link.addEventListener("click", function () {
        acknowledge(link, link.textContent.trim());
      });
    }

    

    async function rememberKey(key) {
      

      let isSiteKey = false;
      try {
        if (config.publicKey) {
          const probe = await root.BinderCrypto.encrypt(
            { probe: true }, config.publicKey);
          const back = await root.BinderCrypto.decrypt(probe, key);
          isSiteKey = Boolean(back) && back.probe === true;
        }
      } catch (error) {
        isSiteKey = false;
      }

      if (!isSiteKey) {
        kept = "This is not the private half of the key this site " +
          "encrypts to, so it opens this export and is not kept on this " +
          "device.";
        return;
      }

      let persisted = false;
      try {
        if (root.navigator && root.navigator.storage &&
            root.navigator.storage.persist) {
          persisted = await root.navigator.storage.persist() === true;
        }
      } catch (error) {
        persisted = false;
      }

      try {
         
         
        await writeStoredKey({
          publicKey: config.publicKey,
          privateKey: key,
          storedAt: new Date().toISOString(),
        });
      } catch (error) {
        kept = "This key could not be kept on this device, so the next " +
          "export needs the file again.";
        return;
      }
      kept = storedKeyNotice(persisted);
    }

    $("run").addEventListener("click", async function () {
      reset();

      const keyText = $("keyfile").value.trim();
      let key;

      if (keyText) {
        

        try {
          say("Reading the key…", null);
          key = await root.BinderCrypto.importPrivateKey(keyText);
        } catch (error) {
          say("That key was not usable. " +
            (error && error.message ? error.message : ""), "bad");
          return;
        }
        storedKey = key;
        await rememberKey(key);
      } else if (storedKey) {
         
         
        key = storedKey;
      } else {
        say("Paste or choose your key file first - the one " +
          "tools/keygen.html saved.", "bad");
        return;
      }

      $("run").disabled = true;
      let payload;
      try {
        say("Fetching the rows…", null);
        const response = await fetch(config.endpoint + "/export", {
          headers: root.BinderSession.authorization(),
        });
        if (sessionRefused(response, say)) return;
        if (!response.ok) {
          throw new Error("The server answered " + response.status + ".");
        }
        payload = await response.json();
      } catch (error) {
        $("run").disabled = false;
        finish("The rows could not be fetched. " +
          (error && error.message ? error.message : "The connection failed."),
          "bad");
        return;
      }

      const submissions = (payload && payload.submissions) || [];
      if (!submissions.length) {
        $("run").disabled = false;
        finish("There are no submissions stored yet.", null);
        return;
      }

      

      say("Decrypting " + submissions.length + " row(s)…", null);
      const failures = [];
      for (const submission of submissions) {
        try {
          const record = await root.BinderCrypto.decrypt(
            submission.ciphertext, key);
          entries.push(entryFor(submission, record));
        } catch (error) {
          failures.push({
            id: submission.id,
            why: error && error.message ? error.message : "unknown error",
          });
        }
      }

      rebuildDerived();
      render(submissions.length, failures);
      $("run").disabled = false;
    });

    

    function currentBasis() {
      return UI.checkedValue("basis", "people");
    }

    

    function currentUnits() {
      return UI.checkedValue("units", root.BinderDashboard.DEFAULT_UNITS);
    }

    

    function localSnapshot() {
      return root.BinderDashboard.snapshotOf(entries, { identify: true });
    }

    function redraw() {
      if (entries.length) {
        root.BinderDashboard.render(
          $("charts"), localSnapshot(), currentBasis(), currentUnits());
      }
    }

    Array.prototype.forEach.call(
      document.querySelectorAll('input[name="basis"], input[name="units"]'),
      function (input) {
        input.addEventListener("change", redraw);
      });

    

    function sayUnpublish(message, tone) {
      UI.setStatus($("unpublish-status"), message, tone);
    }

    

    let publishedNow = null;

    async function refreshPublishedState() {
      const state = $("published-state");
      try {
        const response = await fetch(config.endpoint + "/snapshot", {
          headers: root.BinderSession.authorization(),
        });
        

        if (sessionRefused(response, function (message) {
          state.textContent = message;
        })) return;
        if (response.status === 404) {
          publishedNow = null;
          state.textContent = "Nothing is published. The public dashboard " +
            "shows an empty notice.";
          show($("unpublish"), false);
          return;
        }
        if (!response.ok) {
          throw new Error("The server answered " + response.status + ".");
        }
        const payload = await response.json();
        const snapshot = payload.snapshot || {};
        publishedNow = payload.snapshot || null;
        const counts = snapshot.counts || {};
        const when = snapshot.generated
          ? new Date(snapshot.generated).toISOString()
              .replace("T", " ").slice(0, 16) + " UTC"
          : "an unknown time";
        state.textContent = "Published: " + counts.entries + " entries from " +
          counts.people + " people, worked out " + when +
          (snapshot.series ? ", including weight over time." : ".");
        show($("unpublish"), true);
      } catch (error) {
        publishedNow = null;
        state.textContent = "Could not check what is published. " +
          (error && error.message ? error.message : "The connection failed.");
         
         
         
        show($("unpublish"), true);
      }
    }

    $("unpublish").addEventListener("click", async function () {
      $("unpublish").disabled = true;
      sayUnpublish("Taking it down…", null);
      try {
        const response = await fetch(config.endpoint + "/snapshot", {
          method: "DELETE",
          headers: root.BinderSession.authorization(),
        });
        if (sessionRefused(response, sayUnpublish)) return;
        if (!response.ok) {
          throw new Error("The server answered " + response.status + ".");
        }
      } catch (error) {
        $("unpublish").disabled = false;
        sayUnpublish("It could not be taken down. " +
          (error && error.message ? error.message : "The connection failed.") +
          " If this persists, the row can be removed from the D1 console: " +
          "DELETE FROM snapshots;", "bad");
        return;
      }

      $("unpublish").disabled = false;
      sayUnpublish("Taken down. The public dashboard shows nothing now.",
        null);
      await refreshPublishedState();
    });

    

    async function loadStoredKey() {
      $("run").disabled = true;
      try {
        let record = null;
        try {
          record = await readStoredKey();
        } catch (error) {
           
           
           
          return;
        }

        const verdict = storedKeyVerdict(record, config.publicKey);
        if (verdict.key) {
          storedKey = verdict.key;
          say("This device holds your key, so Fetch and decrypt needs no " +
            "file. Closing the tab leaves it here; Clear removes it.", null);
          return;
        }
        if (verdict.erase) {
          try { await forgetStoredKey(); } catch (error) {}
        }
        if (verdict.why) say(verdict.why, "bad");
      } finally {
        $("run").disabled = false;
      }
    }

     
    

    function sayMembership(message, tone) {
      UI.setStatus($("membership-status"), message, tone);
    }

     
     
     
    function membershipRow(row, role) {
      const line = document.createElement("div");
      line.className = "row";

      const name = document.createElement("span");
      name.textContent = row.label ? String(row.label) : "(no label)";
      line.appendChild(name);

      const when = document.createElement("span");
      when.className = "hint";
      when.textContent = row.added_at
        ? "added " + String(row.added_at).slice(0, 10)
        : "added at an unrecorded time";
      line.appendChild(when);

      

      const button = document.createElement("button");
      let armed = false;
      button.type = "button";
      button.className = "secondary";
      button.textContent = removalStep(row, false);
      button.addEventListener("click", function () {
        if (!armed) {
          armed = true;
          button.textContent = removalStep(row, true);
          return;
        }
        return removeMembership(row, role, button);
      });
      line.appendChild(button);
      return line;
    }

    function drawRows(container, rows, role) {
      container.textContent = "";
      if (!rows.length) {
        const empty = document.createElement("p");
        empty.className = "hint";
        empty.textContent = "No rows.";
        container.appendChild(empty);
        return;
      }
      for (const row of rows) container.appendChild(membershipRow(row, role));
    }

    function drawMembership(view) {
      for (const list of view.lists) {
        drawRows($("membership-" + list.role), list.rows, list.role);
      }

      drawRows($("membership-malformed-list"), view.malformed, "admin");
      show($("membership-malformed"), view.malformed.length > 0);

      $("secret-only").textContent = secretOnlyNotice(view);
       
       
       
       
       
       
      $("secret-only-ids").textContent = view.secretOnly.join("\n");
      show($("secret-only-ids"), view.secretOnly.length > 0);

       
       
      const other = view.unknown.length > 0 || view.dropped > 0 ||
        view.absent.length > 0;
      show($("membership-other"), other);
      if (other) {
        const notes = view.unknown.map(function (row) {
          return "role " + String(row.role) + ": " + String(row.label || "") +
            " (" + String(row.account_id) + ")";
        });
        if (view.dropped) {
          notes.push(view.dropped +
            " entrie(s) in this answer were not rows this page could read.");
        }
        if (view.absent.length) {
          notes.push("this answer carried no " + view.absent.join(", ") +
            " list at all.");
        }
        $("membership-other-body").textContent = notes.join("\n");
      }
    }

    

    function handleRefusal(status, payload) {
      const refusal = refusalFor(status, payload);
      if (refusal.action === "signed-out") {
        sessionEnded(sayMembership);
        return true;
      }
      sayMembership(refusal.message, "bad");
      return false;
    }

     
     
    async function refusalBody(response) {
      try {
        return await response.json();
      } catch (error) {
        return null;
      }
    }

    async function readMembership() {
      let payload;
      try {
        const response = await fetch(config.endpoint + "/membership", {
          headers: root.BinderSession.authorization(),
        });
        if (!response.ok) {
          handleRefusal(response.status, await refusalBody(response));
          return;
        }
        payload = await response.json();
      } catch (error) {
        sayMembership("The membership lists could not be read. " +
          (error && error.message ? error.message : "The connection failed."),
          "bad");
        return;
      }
      drawMembership(membershipView(payload));
    }

    $("member-add").addEventListener("click", async function () {
      const telegramId = $("member-telegram-id").value.trim();
      const label = $("member-label").value.trim();

      

      if (!telegramId || !label) {
        sayMembership("A numeric Telegram id and a label are both needed.",
          "bad");
        return;
      }

      const role = UI.checkedValue("member-role", MEMBERSHIP_ROLES[0]);
      $("member-add").disabled = true;
      sayMembership("Adding…", null);
      try {
        const response = await fetch(config.endpoint + "/membership", {
          method: "POST",
          headers: Object.assign(
            { "Content-Type": "application/json" },
            root.BinderSession.authorization()),
          body: JSON.stringify({
            role: role,
            telegramId: telegramId,
            label: label,
          }),
        });
        if (!response.ok) {
          $("member-add").disabled = false;
          handleRefusal(response.status, await refusalBody(response));
          return;
        }
      } catch (error) {
        $("member-add").disabled = false;
        sayMembership("That could not be sent. " +
          (error && error.message ? error.message : "The connection failed."),
          "bad");
        return;
      }

       
       
       
       
      $("member-telegram-id").value = "";
      $("member-add").disabled = false;
      await readMembership();
      sayMembership(addedNotice(role, label), null);
    });

    async function removeMembership(row, role, button) {
      button.disabled = true;
      sayMembership("Removing…", null);
      try {
         
         
         
        const response = await fetch(
          config.endpoint + "/membership/" +
            encodeURIComponent(role) + "/" +
            encodeURIComponent(String(row.account_id)),
          {
            method: "DELETE",
            headers: root.BinderSession.authorization(),
          });
        if (!response.ok) {
          button.disabled = false;
          const left = handleRefusal(response.status,
            await refusalBody(response));
           
           
           
          if (!left) await readMembership();
          return;
        }
      } catch (error) {
        button.disabled = false;
        sayMembership("That could not be removed. " +
          (error && error.message ? error.message : "The connection failed."),
          "bad");
        return;
      }

      await readMembership();
      sayMembership("Removed.", null);
    }

    loadStoredKey();
    refreshPublishedState();
    readMembership();

    

    function publishable() {
      return root.BinderDashboard.snapshotOf(entries, {
        identify: false,
        series: $("publish-series").checked,
         
         
         
         
         
         
        previous: publishedNow,
      });
    }

    function sayPublish(message, tone) {
      UI.setStatus($("publish-status"), message, tone);
    }

    

    function withheldNote(snapshot) {
      return snapshot.seriesWithheld
        ? " Weight over time is not in it: fewer than " +
          root.BinderDashboard.MIN_CELL +
          " people have more than one entry."
        : "";
    }

    

    $("publish-preview").addEventListener("click", function () {
      const body = $("publish-preview-body");
      if (!body.hidden) {
        body.hidden = true;
        body.textContent = "";
        return;
      }
      const preview = publishable();
      body.textContent = JSON.stringify(preview, null, 2);
      body.hidden = false;
       
       
       
      const missing = withheldNote(preview);
      if (missing) sayPublish(missing.trim(), null);
    });

    $("publish").addEventListener("click", async function () {
      if (!entries.length) {
        sayPublish("There is nothing decrypted to publish.", "bad");
        return;
      }
      $("publish").disabled = true;
      sayPublish("Publishing…", null);
       
       
       
      const sent = publishable();
      try {
        const response = await fetch(config.endpoint + "/snapshot", {
          method: "POST",
          headers: Object.assign(
            { "Content-Type": "application/json" },
            root.BinderSession.authorization()),
          body: JSON.stringify(sent),
        });
        if (sessionRefused(response, sayPublish)) return;
        if (!response.ok) {
          throw new Error("The server answered " + response.status + ".");
        }
      } catch (error) {
        $("publish").disabled = false;
        sayPublish("It could not be published. " +
          (error && error.message ? error.message : "The connection failed."),
          "bad");
        return;
      }

      $("publish").disabled = false;
      sayPublish("Published. The public dashboard now shows these numbers." +
        withheldNote(sent), null);
      await refreshPublishedState();
    });

    async function deleteEntry(entry, total, failures, button) {
      button.disabled = true;
      say("Deleting row " + entry.id + "…", null);
      try {
        const response = await fetch(
          config.endpoint + "/submission/" +
            encodeURIComponent(String(entry.id)),
          {
            method: "DELETE",
            headers: root.BinderSession.authorization(),
          });
        if (sessionRefused(response, say)) return;
        if (!response.ok) {
          throw new Error("The server answered " + response.status + ".");
        }
      } catch (error) {
        button.disabled = false;
        say("Row " + entry.id + " could not be deleted. " +
          (error && error.message ? error.message : "The connection failed."),
        "bad");
        return;
      }

      entries = entries.filter(function (candidate) {
        return candidate.id !== entry.id;
      });
      rebuildDerived();
      render(total - 1, failures);
      say("Row " + entry.id + " was deleted. The remaining rows and " +
        "downloads were rebuilt.", null);
    }

    const PREVIEW = 50;

    function render(total, failures) {
      $("summary").textContent = rows.length + " of " + total +
        " row(s) decrypted" +
        (rows.length > PREVIEW ? "; first " + PREVIEW + " shown below" : "") +
        ".";

      const head = $("thead");
      head.textContent = "";
      const headRow = document.createElement("tr");
      for (const name of COLUMNS) {
        const th = document.createElement("th");
        th.textContent = name;
        headRow.appendChild(th);
      }
      const actionHead = document.createElement("th");
      actionHead.textContent = "actions";
      headRow.appendChild(actionHead);
      head.appendChild(headRow);

      const body = $("tbody");
      body.textContent = "";
      rows.slice(0, PREVIEW).forEach(function (row, index) {
        const tr = document.createElement("tr");
        row.forEach(function (cell) {
          const td = document.createElement("td");
           
           
          td.textContent = String(cell);
          tr.appendChild(td);
        });
        const action = document.createElement("td");
        const button = document.createElement("button");
        const entry = entries[index];
        button.type = "button";
        button.className = "secondary";
        button.textContent = "Delete row " + entry.id;
        button.addEventListener("click", function () {
          return deleteEntry(entry, total, failures, button);
        });
        action.appendChild(button);
        tr.appendChild(action);
        body.appendChild(tr);
      });

      if (failures.length) {
        show($("failures"), true);
        $("failure-list").textContent = failures.map(function (f) {
          return "row " + f.id + ": " + f.why;
        }).join("\n");
      }

      revoke();
      offer("download", csv, "text/csv;charset=utf-8", "csv");
      offer("download-xlsx", xlsx,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xlsx");
      offer("download-json", json, "application/json;charset=utf-8", "json");

      show($("results"), true);

      if (rows.length) {
        redraw();
        show($("dashboard"), true);
        show($("publish-card"), true);
      } else {
        show($("dashboard"), false);
        show($("publish-card"), false);
      }

      finish(rows.length
        ? "Done. Both files are built in this page - nothing was uploaded."
        : "Nothing could be decrypted with this key.",
        rows.length ? null : "bad");
    }
  }
})(globalThis);
