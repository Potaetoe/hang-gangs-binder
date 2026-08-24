

(function (root) {
  "use strict";

   
   

  

  const UNIT_SYSTEMS = Object.freeze(["metric", "imperial"]);
  const THEMES = Object.freeze(["pink", "daylight", "midnight", "contrast"]);
  const MAX_GROUP_NAME = 64;
  const MAX_WELCOME_TEXT = 500;

  

  function validateFloor(raw) {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!/^(0|[1-9]\d{0,5})$/.test(text)) {
      return { ok: false,
        message: "The floor is a whole number, 0 to 999999, with no " +
          "leading zero." };
    }
    return { ok: true, value: text };
  }

   
  function validateLockedUnit(raw) {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (text !== "" && UNIT_SYSTEMS.indexOf(text) === -1) {
      return { ok: false, message: "Pick metric, imperial, or unlocked." };
    }
    return { ok: true, value: text };
  }

   
  function validateGroupName(raw) {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) {
      return { ok: false, message: "The group needs a name." };
    }
    if (text.length > MAX_GROUP_NAME) {
      return { ok: false,
        message: "The group name is " + MAX_GROUP_NAME + " characters or " +
          "fewer." };
    }
    return { ok: true, value: text };
  }

  

  function validateWelcomeText(raw) {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (text.length > MAX_WELCOME_TEXT) {
      return { ok: false,
        message: "The welcome text is " + MAX_WELCOME_TEXT + " characters " +
          "or fewer." };
    }
    return { ok: true, value: text };
  }

  

  function validateDefaultTheme(raw) {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (text !== "" && THEMES.indexOf(text) === -1) {
      return { ok: false, message: "Pick one of the four named themes, " +
        "or follow the visitor's own system." };
    }
    return { ok: true, value: text };
  }

  const SETTINGS_VALIDATORS = Object.freeze({
    "chart.floor": validateFloor,
    "chart.lockedUnit": validateLockedUnit,
    "site.groupName": validateGroupName,
    "site.welcomeText": validateWelcomeText,
    "site.defaultTheme": validateDefaultTheme,
  });

  

  const SETTINGS_DEFAULTS = Object.freeze({
    "chart.floor": "0",
    "chart.lockedUnit": "",
    "site.groupName": "",
    "site.welcomeText": "",
    "site.defaultTheme": "",
  });

  

  function floorNotice(floorText) {
    const n = Number(floorText);
    if (!Number.isFinite(n) || n <= 0) {
      return "Off — nothing is hidden for being a small group.";
    }
    return "On — members will see: \"Groups smaller than " + n +
      " are hidden.\"";
  }

   
   

  

  const MEMBERSHIP_ROLES = Object.freeze(["admin"]);

  

  const MAX_LABEL = 64;

  

  function validateLabel(raw) {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) {
      return { ok: false, message: "A label is needed." };
    }
    if (text.length > MAX_LABEL) {
      return { ok: false,
        message: "The label is " + MAX_LABEL + " characters or fewer." };
    }
    return { ok: true, value: text };
  }

  

  function isRow(row) {
    return Boolean(row) && typeof row === "object" &&
      typeof row.account_id === "string" && row.account_id !== "";
  }

  const MEMBERSHIP_FIELDS = ["membership", "malformed", "secretOnly"];

  

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
      return "This service did not report which admins the secret grants " +
        "on its own, so nothing here can say whether the backfill is " +
        "finished. Check the membership list at the service directly " +
        "before acting on this.";
    }
    if (!view.secretOnly.length) {
      return "Every admin the ADMIN_TELEGRAM_IDS secret grants also holds " +
        "a row above. That is the go-signal: dropping the secret arm now " +
        "would take nobody's authority away.";
    }
    const many = view.secretOnly.length !== 1;
    return view.secretOnly.length + (many ? " admins are" : " admin is") +
      " granted by the ADMIN_TELEGRAM_IDS secret and by no row above, so " +
      "the backfill is not finished. Their account ids are listed below, " +
      "and they name nobody: each is scrambled one-way, nothing on this " +
      "page can turn one back into a person. Add each of those people by " +
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
        message: "The admin session was not accepted — sign in again.",
      };
    }
    if (status === 409) {
      return {
        action: "show",
        message: (said || "That change was refused.") +
          " Nothing changed — the lists below are what it holds now.",
      };
    }
    return {
      action: "show",
      message: said || (status
        ? "The server answered " + status + "."
        : "The connection failed."),
    };
  }

  

  function addedNotice(label) {
    const named = typeof label === "string" && label.trim()
      ? label.trim()
      : "That account";
    return named + " is on the admin list, and becomes an admin at their " +
      "NEXT sign-in: the admin flag is minted when a session is created, " +
      "so a session they are already holding does not change. Ask them to " +
      "sign out and in again.";
  }

  

  function removalStep(row, armed) {
    const named = row && typeof row.label === "string" && row.label.trim()
      ? row.label.trim()
      : "";
    if (armed) {
      return named ? "Confirm removing " + named : "Confirm removing this row";
    }
    return named ? "Remove " + named : "Remove this row";
  }

   
   
   

  

  const FIELD_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;
  const MAX_FIELD_ID = 48;
  const MAX_FIELD_LABEL = 64;
  const MAX_FIELD_VALUES = 100;

  function validateFieldId(raw) {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!FIELD_ID_PATTERN.test(text)) {
      return { ok: false, message: "A field id is lowercase letters, " +
        "digits, hyphens and underscores, up to " + MAX_FIELD_ID +
        " characters, starting with a letter or digit." };
    }
    return { ok: true, value: text };
  }

  function validateFieldLabel(raw) {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) {
      return { ok: false, message: "A field needs a label - the words " +
        "a member reads beside the box." };
    }
    if (text.length > MAX_FIELD_LABEL) {
      return { ok: false, message: "A field's label is " +
        MAX_FIELD_LABEL + " characters or fewer." };
    }
    return { ok: true, value: text };
  }

  function validateValueLabel(raw) {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) {
      return { ok: false, message: "A value needs a label." };
    }
    if (text.length > MAX_FIELD_LABEL) {
      return { ok: false, message: "A value's label is " +
        MAX_FIELD_LABEL + " characters or fewer." };
    }
    return { ok: true, value: text };
  }

  

  function parseValueLines(raw) {
    const text = typeof raw === "string" ? raw : "";
    return text.split("\n").map((line) => line.trim())
      .filter((line) => line !== "");
  }

  

  function categoricalFields(spec) {
    const fields = spec && Array.isArray(spec.fields) ? spec.fields : [];
    return {
      choice: fields.filter((f) => f && f.kind === "choice"),
      other: fields.filter((f) => f && f.kind !== "choice"),
    };
  }

  const FIELD_READ_ONLY_REASON = "Its units and chart bands are part " +
    "of a release somebody read, not something to edit here.";

   
   
   
   
   
   
   
   
  const VALUES_OUTSIDE_REASON = "This field's choices live outside " +
    "the form spec, so they are not edited here.";

  

  const RENAME_MODE = "relabel";
  const RENAME_CONSEQUENCE = "Entries already saved follow the new word " +
    "instantly.";

  

  function retireValueSentence(label) {
    return "Members stop being offered \"" + label + "\"; entries " +
      "already saved keep it. Retire it?";
  }

  function retireFieldSentence(label) {
    return "It leaves the form for members; entries already saved keep " +
      "every value. Retire the \"" + label + "\" field?";
  }

  

  function shortDate(iso) {
    const parsed = Date.parse(iso);
    return Number.isFinite(parsed)
      ? new Date(parsed).toISOString().slice(0, 10)
      : "an unknown date";
  }

  

  function fieldView(field) {
    const values = (field.choices || []).map((v) => ({
      id: v.id, label: v.label, retired: v.retired === true }));
    return {
      id: field.name,
      label: field.label,
      active: field.retired !== true,
      outside: Boolean(field.choicesFrom),
      retiredAt: field.retired === true &&
        typeof field.retiredAt === "string" ? field.retiredAt : null,
      values: values,
    };
  }

   
   

  

  function shortAccountId(accountId) {
    if (accountId === "break-glass") return "the break-glass tool";
    return typeof accountId === "string" && accountId
      ? accountId.slice(0, 12) + "…"
      : "someone";
  }

  function logWho(entry) {
    return shortAccountId(entry && entry.accountId);
  }

  function logWhen(at) {
    const parsed = Date.parse(at);
    if (!Number.isFinite(parsed)) return "an unknown time";
    return new Date(parsed).toISOString().replace("T", " ").slice(0, 16) +
      " UTC";
  }

  

  const LOG_ACTIONS = Object.freeze({
    "content.set": "changed a setting",
    "content.unset": "reset a setting",
    "membership.add": "added an admin",
    "membership.remove": "removed an admin",
  });

  

  const MAX_LOG_SUMMARY = 200;
  const TRUNCATION_MARK = "…";

  function logWhat(entry) {
    const action = entry && typeof entry.action === "string"
      ? entry.action.trim() : "";
    const phrase = LOG_ACTIONS[action] || "made a change";
    let summary = entry && typeof entry.summary === "string"
      ? entry.summary.trim() : "";
    if (summary.length > MAX_LOG_SUMMARY) {
      summary = summary.slice(0, MAX_LOG_SUMMARY) + TRUNCATION_MARK;
    }
    return summary ? phrase + ": " + summary : phrase;
  }

  

  function logLine(entry) {
    return { when: logWhen(entry && entry.at), who: logWho(entry),
      what: logWhat(entry) };
  }

   
   
   

  

  function departedName(entry) {
    const label = entry && typeof entry.label === "string"
      ? entry.label.trim() : "";
    return label || shortAccountId(entry && entry.accountId);
  }

  

  function eraseDepartedSentence(name) {
    return "This removes the submissions, directory, membership and " +
      "sessions rows for " + name + ". Remove them?";
  }

  const DEPARTED_PAGE_SIZE = 20;
  const DEPARTED_KEYS = ["departed", "unknown", "allowed"];

  

  function departedSections(payload, revealed) {
    const groups = DEPARTED_KEYS.map((key) =>
      Array.isArray(payload && payload[key]) ? payload[key] : []);
    const total = groups[0].length + groups[1].length + groups[2].length;
    const limit = Number.isFinite(revealed) && revealed > 0
      ? revealed : DEPARTED_PAGE_SIZE;
    const shown = Math.min(limit, total);
    let used = 0;
    const sections = groups.map((rows, i) => {
      const remaining = shown - used;
      const slice = remaining > 0 ? rows.slice(0, remaining) : [];
      used += slice.length;
      return { key: DEPARTED_KEYS[i], rows: slice };
    });
    return { sections: sections, shown: shown, total: total,
      hasMore: shown < total };
  }

  

  function departedCapNote(payload, rows) {
    const total = payload && payload.total;
    const cap = payload && payload.cap;
    if (typeof total !== "number" || !Number.isFinite(total)) return "";
    if (typeof cap !== "number" || !Number.isFinite(cap)) return "";
    if (typeof rows !== "number" || !Number.isFinite(rows) || rows < 0) {
      return "";
    }
    if (!(total > cap)) return "";
    return "Showing " + rows + " (checked " + cap + " of " + total + ")";
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
    return "Nobody has touched this page for a while. It shows the " +
      "site's settings, roles and change log, so it will clear itself " +
      "and sign you out in " + Math.floor(seconds / 60) + ":" +
      (rest < 10 ? "0" : "") + rest +
      ". Any key, click, touch or wheel keeps it open.";
  }

   
   
   
  root.BinderAdmin = Object.freeze({
    UNIT_SYSTEMS: UNIT_SYSTEMS,
    THEMES: THEMES,
    validateFloor: validateFloor,
    validateLockedUnit: validateLockedUnit,
    validateGroupName: validateGroupName,
    validateWelcomeText: validateWelcomeText,
    validateDefaultTheme: validateDefaultTheme,
    SETTINGS_VALIDATORS: SETTINGS_VALIDATORS,
    SETTINGS_DEFAULTS: SETTINGS_DEFAULTS,
    floorNotice: floorNotice,
    MEMBERSHIP_ROLES: MEMBERSHIP_ROLES,
    validateLabel: validateLabel,
    membershipView: membershipView,
    secretOnlyNotice: secretOnlyNotice,
    refusalFor: refusalFor,
    addedNotice: addedNotice,
    removalStep: removalStep,
    FIELD_ID_PATTERN: FIELD_ID_PATTERN,
    validateFieldId: validateFieldId,
    validateFieldLabel: validateFieldLabel,
    validateValueLabel: validateValueLabel,
    parseValueLines: parseValueLines,
    categoricalFields: categoricalFields,
    FIELD_READ_ONLY_REASON: FIELD_READ_ONLY_REASON,
    VALUES_OUTSIDE_REASON: VALUES_OUTSIDE_REASON,
    RENAME_MODE: RENAME_MODE,
    RENAME_CONSEQUENCE: RENAME_CONSEQUENCE,
    retireValueSentence: retireValueSentence,
    retireFieldSentence: retireFieldSentence,
    shortDate: shortDate,
    fieldView: fieldView,
    logLine: logLine,
    departedName: departedName,
    eraseDepartedSentence: eraseDepartedSentence,
    DEPARTED_PAGE_SIZE: DEPARTED_PAGE_SIZE,
    departedSections: departedSections,
    departedCapNote: departedCapNote,
    IDLE_WINDOW: IDLE_WINDOW,
    idleVerdict: idleVerdict,
    idleNotice: idleNotice,
  });

   
   

  if (typeof document === "undefined") return;

  const UI = root.BinderUI;
  const $ = UI.byId;
  const show = UI.show;

  

  function detail(technical) {
    if (technical && root.console &&
        typeof root.console.warn === "function") {
      root.console.warn("binder: " + technical);
    }
  }

  function why(error) {
    return error && error.message ? error.message : "failed with no message";
  }

  

  function showInstrument(visible) {
    show($("tool"), visible);
    show($("surface-mark"), visible);
    show($("admin-intro"), visible);
  }

  UI.boot(setUp, function (error) {
    showInstrument(false);
    detail(why(error));
    const closed = $("closed");
    show(closed, true);
    if (closed) {
      closed.querySelector("[data-reason]").textContent =
        "This page did not start up correctly, so it is not safe to use.";
    }
  });

  function setUp() {
    if (!root.BinderSession) {
      throw new Error("This page did not load its session handling.");
    }
    const admin = root.BinderSession.require();

     
     
     
    if (!admin) {
      showInstrument(false);
      return;
    }
    if (!admin.isAdmin) {
      showInstrument(false);
      const closed = $("closed");
      show(closed, true);
      closed.querySelector("[data-reason]").textContent =
        "This page needs an admin session. Your current session is " +
        "signed in as a member only.";
      return;
    }
    showInstrument(true);

    const config = root.BINDER_CONFIG || {};

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

    async function refusalBody(response) {
      try {
        return await response.json();
      } catch (error) {
        return null;
      }
    }

     
     

    function saySettings(message, tone) {
      UI.setStatus($("settings-status"), message, tone);
    }

    const SETTINGS_FIELDS = Object.freeze({
      "chart.floor": "settings-floor",
      "chart.lockedUnit": "settings-locked-unit",
      "site.groupName": "settings-group-name",
      "site.welcomeText": "settings-welcome-text",
      "site.defaultTheme": "settings-default-theme",
    });

    async function loadSettings() {
      saySettings("Loading…", null);
      let payload;
      try {
        const response = await fetch(config.endpoint + "/content");
        if (!response.ok) {
          throw new Error("The server answered " + response.status + ".");
        }
        payload = await response.json();
      } catch (error) {
        detail(why(error));
        saySettings("The current settings could not be read.", "bad");
        return;
      }
      const content = (payload && payload.content) || {};
      for (const name of Object.keys(SETTINGS_FIELDS)) {
        const field = $(SETTINGS_FIELDS[name]);
        if (!field) continue;
        field.value = Object.prototype.hasOwnProperty.call(content, name)
          ? content[name]
          : root.BinderAdmin.SETTINGS_DEFAULTS[name];
      }
      $("settings-floor-notice").textContent =
        root.BinderAdmin.floorNotice($("settings-floor").value);
      saySettings("", null);
    }

    $("settings-floor").addEventListener("input", function () {
      $("settings-floor-notice").textContent =
        root.BinderAdmin.floorNotice(this.value);
    });

     
     
     
     
     
    for (const name of Object.keys(SETTINGS_FIELDS)) {
      const button = $(SETTINGS_FIELDS[name] + "-save");
      if (!button) continue;
      button.addEventListener("click", async function () {
        const field = $(SETTINGS_FIELDS[name]);
        const validator = root.BinderAdmin.SETTINGS_VALIDATORS[name];
        const verdict = validator(field.value);
        if (!verdict.ok) {
          saySettings(verdict.message, "bad");
          return;
        }
        button.disabled = true;
        saySettings("Saving…", null);
        try {
          const response = await fetch(config.endpoint + "/content", {
            method: "POST",
            headers: Object.assign(
              { "Content-Type": "application/json" },
              root.BinderSession.authorization()),
            body: JSON.stringify({ name: name, value: verdict.value }),
          });
          if (sessionRefused(response, saySettings)) return;
          if (!response.ok) {
            button.disabled = false;
            const refusal = refusalFor(response.status,
              await refusalBody(response));
             
             
             
             
            saySettings("", null);
            showToast(refusal.message);
            return;
          }
        } catch (error) {
          button.disabled = false;
          detail(why(error));
          saySettings("", null);
           
           
           
           
          showToast("Nothing was sent — try again.");
          return;
        }
        button.disabled = false;
        field.value = verdict.value;
        if (name === "chart.floor") {
          $("settings-floor-notice").textContent =
            root.BinderAdmin.floorNotice(verdict.value);
        }
         
         
         
         
         
        saySettings("", null);
        showToast("Saved.");
        loadLog();
      });
    }

     
     

    function sayRoles(message, tone) {
      UI.setStatus($("roles-status"), message, tone);
    }

    function membershipRow(row) {
      const line = document.createElement("div");
       
       
       
       
       
       
      line.className = "row wrap-row";

      const name = document.createElement("span");
      name.className = "wrap-row-value";
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
        return removeMembership(row, button);
      });
      line.appendChild(button);
      return line;
    }

    function drawRows(container, rows) {
      container.textContent = "";
      if (!rows.length) {
        const empty = document.createElement("p");
        empty.className = "hint";
        empty.textContent = "No rows.";
        container.appendChild(empty);
        return;
      }
      for (const row of rows) container.appendChild(membershipRow(row));
    }

    function drawMembership(view) {
      drawRows($("roles-admin"), view.lists[0].rows);

      drawRows($("roles-malformed-list"), view.malformed);
      show($("roles-malformed"), view.malformed.length > 0);

      $("roles-secret-only").textContent = secretOnlyNotice(view);
      $("roles-secret-only-ids").textContent = view.secretOnly.join("\n");
      show($("roles-secret-only-ids"), view.secretOnly.length > 0);

      const other = view.unknown.length > 0 || view.dropped > 0 ||
        view.absent.length > 0;
      show($("roles-other"), other);
      if (other) {
        const notes = view.unknown.map(function (row) {
          return "role " + String(row.role) + ": " + String(row.label || "") +
            " (" + String(row.account_id) + ")";
        });
        if (view.dropped) {
          notes.push(view.dropped === 1
            ? "1 entry in this answer was not a row this page could read."
            : view.dropped + " entries in this answer were not rows this " +
              "page could read.");
        }
        if (view.absent.length) {
          notes.push("this answer carried no " + view.absent.join(", ") +
            " list at all.");
        }
        $("roles-other-body").textContent = notes.join("\n");
      }
    }

     
     
     
     
     
    function handleRefusal(status, payload, where) {
      const say = where || sayRoles;
      const refusal = refusalFor(status, payload);
      if (refusal.action === "signed-out") {
        sessionEnded(sayRoles);
        return true;
      }
      if (say !== sayRoles) sayRoles("", null);
      say(refusal.message, "bad");
      return false;
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
        detail(why(error));
        sayRoles("The role list could not be read.", "bad");
        return;
      }
      drawMembership(membershipView(payload));
    }

    

    function drawDirectory(members) {
      const select = $("member-account");
      select.textContent = "";
      const first = document.createElement("option");
      first.value = "";
      first.textContent = members.length
        ? "Choose a member…"
        : "Nobody has signed in yet";
      select.appendChild(first);
      for (const member of members) {
        const option = document.createElement("option");
        option.value = member.accountId;
        option.textContent = member.displayName
          ? "@" + member.handle + " — " + member.displayName
          : "@" + member.handle;
        select.appendChild(option);
      }
    }

    async function loadDirectory() {
      let payload;
      try {
        const response = await fetch(config.endpoint + "/admin-directory", {
          headers: root.BinderSession.authorization(),
        });
        if (!response.ok) {
          if (sessionRefused(response, sayRoles)) return;
          drawDirectory([]);
          $("member-account").firstChild.textContent =
            "The member list could not be read";
          return;
        }
        payload = await response.json();
      } catch (error) {
        detail(why(error));
        drawDirectory([]);
        $("member-account").firstChild.textContent =
          "The member list could not be read";
        return;
      }
      const members = payload && Array.isArray(payload.members)
        ? payload.members.filter(function (m) {
          return m && typeof m.accountId === "string" &&
            typeof m.handle === "string" && m.handle;
        })
        : [];
      drawDirectory(members);
    }

    $("member-add").addEventListener("click", async function () {
       
       
       
       
      const accountId = $("member-account").value;
      const rawLabel = $("member-label").value;

      if (!accountId || !rawLabel.trim()) {
        sayRoles("Choose a member and give them a name you will " +
          "recognise.", "bad");
        return;
      }
       
       
       
      const verdict = validateLabel(rawLabel);
      if (!verdict.ok) {
        sayRoles(verdict.message, "bad");
        return;
      }
      const label = verdict.value;

      $("member-add").disabled = true;
      sayRoles("Adding…", null);
      try {
        const response = await fetch(config.endpoint + "/membership", {
          method: "POST",
          headers: Object.assign(
            { "Content-Type": "application/json" },
            root.BinderSession.authorization()),
          body: JSON.stringify({
            role: MEMBERSHIP_ROLES[0],
            accountId: accountId,
            label: label,
          }),
        });
        if (!response.ok) {
          $("member-add").disabled = false;
           
           
           
          handleRefusal(response.status, await refusalBody(response),
            showToast);
          return;
        }
      } catch (error) {
        $("member-add").disabled = false;
        detail(why(error));
        sayRoles("", null);
         
         
         
        showToast("Nothing was sent — try again.");
        return;
      }

      $("member-account").value = "";
      $("member-add").disabled = false;
      await readMembership();
       
       
      sayRoles("", null);
      showToast(addedNotice(label));
      loadLog();
    });

    async function removeMembership(row, button) {
      button.disabled = true;
      sayRoles("Removing…", null);
      try {
        const response = await fetch(
          config.endpoint + "/membership/" +
            encodeURIComponent(MEMBERSHIP_ROLES[0]) + "/" +
            encodeURIComponent(String(row.account_id)),
          {
            method: "DELETE",
            headers: root.BinderSession.authorization(),
          });
        if (!response.ok) {
          button.disabled = false;
           
           
           
          const left = handleRefusal(response.status,
            await refusalBody(response), showToast);
          if (!left) await readMembership();
          return;
        }
      } catch (error) {
        button.disabled = false;
        detail(why(error));
        sayRoles("", null);
         
         
         
        showToast("Nothing was removed — try again.");
        return;
      }

      await readMembership();
       
       
      sayRoles("", null);
      showToast("Removed.");
      loadLog();
    }

    

    async function loadAdminVia() {
      try {
        const response = await fetch(config.endpoint + "/me", {
          headers: root.BinderSession.authorization(),
        });
        if (!response.ok) return;
        const payload = await response.json();
        const via = payload && typeof payload.adminVia === "string"
          ? payload.adminVia.trim()
          : "";
        const words = { telegram: "your Telegram group role",
          flag: "being flagged an admin here", secret: "the bootstrap secret",
          "break-glass": "the break-glass export tool" };
        if (via && words[via]) {
          $("roles-via").textContent =
            "You are an admin through " + words[via] + ".";
        }
      } catch (error) {
         
         
      }
    }

     
     

     
     
     
     
     
    let currentSpec = null;

    function sayFields(message, tone) {
      UI.setStatus($("fields-status"), message, tone);
    }

    function handleFieldsRefusal(status, payload) {
      const refusal = refusalFor(status, payload);
      if (refusal.action === "signed-out") {
        sessionEnded(sayFields);
        return true;
      }
      sayFields(refusal.message, "bad");
      return false;
    }

     
     
     
     
     
     
     
     
     
     
     
     
     
     
     
     
    function fieldWriteValues(fieldId, includeRetired) {
      const fields = (currentSpec && currentSpec.fields) || [];
      const field = fields.filter((f) => f && f.name === fieldId)[0];
      const choices = field && Array.isArray(field.choices)
        ? field.choices : [];
      return choices
        .filter((v) => includeRetired || v.retired !== true)
        .map((v) => ({ id: v.id, label: v.label }));
    }

     
     
     
     
     
     
     
     
     
     
     
    function fieldWriteAllValues(fieldId) {
      const fields = (currentSpec && currentSpec.fields) || [];
      const field = fields.filter((f) => f && f.name === fieldId)[0];
      const choices = field && Array.isArray(field.choices)
        ? field.choices : [];
      return choices.map((v) => ({ id: v.id, label: v.label,
        retired: v.retired === true }));
    }

    function putField(id, body) {
      return fetch(
        config.endpoint + "/admin-fields/" + encodeURIComponent(id), {
          method: "PUT",
          headers: Object.assign(
            { "Content-Type": "application/json" },
            root.BinderSession.authorization()),
          body: JSON.stringify(body),
        });
    }

    function deleteField(id) {
      return fetch(
        config.endpoint + "/admin-fields/" + encodeURIComponent(id), {
          method: "DELETE",
          headers: root.BinderSession.authorization(),
        });
    }

     
     
     
     
     
    const STALE_AFTER_WRITE = "Saved, but the list could not be read " +
      "back afterward - what is shown below may be out of date.";

     
     
     
     
     
     
     
     
     
    async function sendFieldWrite(request, successMessage) {
      sayFields("Saving…", null);
      let response;
      try {
        response = await request();
      } catch (error) {
        detail(why(error));
         
         
         
         
         
        sayFields("Nothing was sent — try again.", "bad");
        return false;
      }
      if (sessionRefused(response, sayFields)) return false;
      if (!response.ok) {
        handleFieldsRefusal(response.status, await refusalBody(response));
        return false;
      }
      const reread = await loadFields();
      if (reread === "ok") {
         
         
         
         
        sayFields("", null);
        showToast(successMessage);
        loadLog();
      } else if (reread === "failed") {
        sayFields(STALE_AFTER_WRITE, "bad");
      }
       
       
      return true;
    }

    function retireField(id) {
      return sendFieldWrite(() => deleteField(id), "Retired.");
    }

     
     
     
     
     
    function unretireField(id) {
      return sendFieldWrite(() => putField(id, { retired: false }),
        "Restored.");
    }

     
     
     
     
     
     
     
     
     
     
     
     
    function retireValue(fieldId, valueId) {
      const values = fieldWriteAllValues(fieldId).map((v) =>
        v.id === valueId ? { id: v.id, label: v.label, retired: true } : v);
      return sendFieldWrite(() => putField(fieldId, { values: values }),
        "Retired.");
    }

     
     
     
     
     
     
     
     
     
     
    function unretireValue(fieldId, valueId, label) {
      const values = fieldWriteAllValues(fieldId).map((v) =>
        v.id === valueId ? { id: v.id, label: label, retired: false } : v);
      return sendFieldWrite(() => putField(fieldId, { values: values }),
        "Restored.");
    }

    function addValue(fieldId, label) {
      const values = fieldWriteValues(fieldId, false)
        .concat([{ label: label }]);
      return sendFieldWrite(() => putField(fieldId, { values: values }),
        "Added.");
    }

    function moveValue(fieldId, valueId, delta) {
      const values = fieldWriteValues(fieldId, false);
      const at = values.findIndex((v) => v.id === valueId);
      const to = at + delta;
      if (at === -1 || to < 0 || to >= values.length) return;
      const reordered = values.slice();
      const moved = reordered.splice(at, 1)[0];
      reordered.splice(to, 0, moved);
      return sendFieldWrite(() => putField(fieldId, { values: reordered }),
        "Reordered.");
    }

    function renameValue(fieldId, valueId, newLabel) {
      const values = fieldWriteValues(fieldId, false).map((v) =>
        v.id === valueId ? { id: v.id, label: newLabel } : v);
      return sendFieldWrite(
        () => putField(fieldId, { values: values, mode: RENAME_MODE }),
        "Renamed.");
    }

    function addField(id, label, valueLines) {
      const body = { label: label };
      if (valueLines.length) {
        body.values = valueLines.map((l) => ({ label: l }));
      }
      return sendFieldWrite(() => putField(id, body), "Added.");
    }

     

     
     
     
     
     
     
    function dangerousAction(container, trigger, sentence, onYes) {
      const block = document.createElement("div");
      block.className = "stack-tight";
      block.hidden = true;
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = sentence;
      block.appendChild(p);
      const row = document.createElement("div");
      row.className = "row";
      const yes = document.createElement("button");
      yes.type = "button";
      yes.className = "primary";
      yes.textContent = "Yes";
      yes.addEventListener("click", onYes);
      row.appendChild(yes);
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "secondary";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", function () {
        show(block, false);
      });
      row.appendChild(cancel);
      block.appendChild(row);
      container.appendChild(block);
      trigger.addEventListener("click", function () {
        show(block, block.hidden);
      });
      return block;
    }

     
     
     
     
     
     
     
     
     
     
     
     
     
    function fieldHeaderRow(view) {
      const row = document.createElement("div");
      row.className = "row wrap-row";
      const name = document.createElement("span");
      name.className = "hint";
      name.textContent = view.label + (view.active ? "" : " (retired)");
      row.appendChild(name);
      const id = document.createElement("span");
      id.className = "wrap-row-value";
      id.textContent = view.id;
      row.appendChild(id);
      return row;
    }

     
     
     
     
     
     
    function valueBlock(view, value, position) {
      const block = document.createElement("div");
      block.className = "stack-tight";

       
       
      const labelRow = document.createElement("div");
      labelRow.className = "row wrap-row";
      const name = document.createElement("span");
      name.className = "hint";
      name.textContent = value.label + (value.retired ? " (retired)" : "");
      labelRow.appendChild(name);
      const idSpan = document.createElement("span");
      idSpan.className = "wrap-row-value";
      idSpan.textContent = value.id;
      labelRow.appendChild(idSpan);
      block.appendChild(labelRow);

      const buttons = document.createElement("div");
      buttons.className = "row buttons";

      if (value.retired) {
        const restore = document.createElement("button");
        restore.type = "button";
        restore.className = "secondary";
        restore.textContent = "Bring back";
        restore.addEventListener("click", function () {
          unretireValue(view.id, value.id, value.label);
        });
        buttons.appendChild(restore);
        block.appendChild(buttons);
        return block;
      }

      const up = document.createElement("button");
      up.type = "button";
      up.className = "secondary";
      up.textContent = "Move up";
      up.disabled = position.index === 0;
      up.addEventListener("click", function () {
        moveValue(view.id, value.id, -1);
      });
      buttons.appendChild(up);

      const down = document.createElement("button");
      down.type = "button";
      down.className = "secondary";
      down.textContent = "Move down";
      down.disabled = position.index === position.count - 1;
      down.addEventListener("click", function () {
        moveValue(view.id, value.id, 1);
      });
      buttons.appendChild(down);

      const rename = document.createElement("button");
      rename.type = "button";
      rename.className = "secondary";
      rename.textContent = "Rename";
      buttons.appendChild(rename);

      const retire = document.createElement("button");
      retire.type = "button";
      retire.className = "secondary";
      retire.textContent = "Retire";
      buttons.appendChild(retire);

      block.appendChild(buttons);

       
       
       
       
       
      const form = document.createElement("div");
      form.className = "stack-tight";
      form.hidden = true;

      const input = document.createElement("input");
      input.type = "text";
      input.value = value.label;
      form.appendChild(input);

      const consequence = document.createElement("p");
      consequence.className = "hint";
      consequence.textContent = RENAME_CONSEQUENCE;
      form.appendChild(consequence);

      const send = document.createElement("button");
      send.type = "button";
      send.className = "primary";
      send.textContent = "Rename";
      send.addEventListener("click", function () {
        const verdict = validateValueLabel(input.value);
        if (!verdict.ok) {
          sayFields(verdict.message, "bad");
          return;
        }
        renameValue(view.id, value.id, verdict.value);
      });
      form.appendChild(send);

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "secondary";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", function () {
        show(form, false);
      });
      form.appendChild(cancel);
      block.appendChild(form);

      rename.addEventListener("click", function () {
        show(form, form.hidden);
      });

      dangerousAction(block, retire, retireValueSentence(value.label),
        function () {
          retireValue(view.id, value.id);
        });

      return block;
    }

    function fieldValuesSection(view) {
      const container = document.createElement("div");
      const activeValues = view.values.filter((v) => !v.retired);
      let index = 0;
      for (const value of view.values) {
        const position = value.retired ? null
          : { index: index, count: activeValues.length };
        if (!value.retired) index += 1;
        container.appendChild(valueBlock(view, value, position));
      }
      return container;
    }

    function fieldBlock(view) {
      const block = document.createElement("div");
      block.className = "stack-tight";
      block.appendChild(fieldHeaderRow(view));

      const buttons = document.createElement("div");
      buttons.className = "row buttons";

      if (!view.active) {
         
         
         
         
        if (view.retiredAt) {
          const when = document.createElement("p");
          when.className = "hint";
          when.textContent = "Last changed " + shortDate(view.retiredAt) +
            ".";
          block.appendChild(when);
        }
        const restore = document.createElement("button");
        restore.type = "button";
        restore.className = "secondary";
        restore.textContent = "Bring back";
        restore.addEventListener("click", function () {
          unretireField(view.id);
        });
        buttons.appendChild(restore);
        block.appendChild(buttons);
        return block;
      }

      if (view.outside) {
        const reason = document.createElement("p");
        reason.className = "hint";
        reason.textContent = VALUES_OUTSIDE_REASON;
        block.appendChild(reason);
      } else {
        block.appendChild(fieldValuesSection(view));

        const addRow = document.createElement("div");
        addRow.className = "row";
        const input = document.createElement("input");
        input.type = "text";
        input.setAttribute("aria-label", "New value for " + view.label);
        addRow.appendChild(input);
        const add = document.createElement("button");
        add.type = "button";
        add.className = "secondary";
        add.textContent = "Add value";
         
         
         
         
         
         
         
         
        add.addEventListener("click", async function () {
          const verdict = validateValueLabel(input.value);
          if (!verdict.ok) {
            sayFields(verdict.message, "bad");
            return;
          }
          if (fieldWriteValues(view.id, true).length >= MAX_FIELD_VALUES) {
            sayFields("A field carries up to " + MAX_FIELD_VALUES +
              " values, retired ones counted.", "bad");
            return;
          }
          add.disabled = true;
          const written = await addValue(view.id, verdict.value);
          add.disabled = false;
          if (written) input.value = "";
        });
        addRow.appendChild(add);
        block.appendChild(addRow);
      }

      const retire = document.createElement("button");
      retire.type = "button";
      retire.className = "secondary";
      retire.textContent = "Retire field";
      buttons.appendChild(retire);
      block.appendChild(buttons);
      dangerousAction(block, retire, retireFieldSentence(view.label),
        function () {
          retireField(view.id);
        });
      return block;
    }

     
     
     
    function readOnlyFieldBlock(field) {
      const block = document.createElement("div");
      block.className = "stack-tight";
      const row = document.createElement("div");
      row.className = "row wrap-row";
      const name = document.createElement("span");
      name.className = "wrap-row-value";
      name.textContent = field.label;
      row.appendChild(name);
      const kind = document.createElement("span");
      kind.className = "hint";
      kind.textContent = field.kind;
      row.appendChild(kind);
      block.appendChild(row);
      const reason = document.createElement("p");
      reason.className = "hint";
      reason.textContent = FIELD_READ_ONLY_REASON;
      block.appendChild(reason);
      return block;
    }

    function renderFields() {
      const list = $("fields-list");
      list.textContent = "";
      if (!currentSpec) return;
      const split = categoricalFields(currentSpec);
      for (const field of split.other) {
        list.appendChild(readOnlyFieldBlock(field));
      }
      for (const field of split.choice) {
        list.appendChild(fieldBlock(fieldView(field)));
      }
    }

     
     
     
     
     
     
     
     
     
     
    async function loadFields() {
      sayFields("Loading…", null);
      let payload;
      try {
        const response = await fetch(config.endpoint + "/admin-fields", {
          headers: root.BinderSession.authorization(),
        });
        if (sessionRefused(response, sayFields)) return "signed-out";
        if (!response.ok) {
          handleFieldsRefusal(response.status, await refusalBody(response));
          return "failed";
        }
        payload = await response.json();
      } catch (error) {
        detail(why(error));
        sayFields("The form's fields could not be read.", "bad");
        return "failed";
      }
      const spec = payload && payload.spec && typeof payload.spec === "object"
        ? payload.spec
        : { fields: [] };
      currentSpec = spec;
      renderFields();
      sayFields("", null);
      return "ok";
    }

     
     
     
     
    $("fields-new-add").addEventListener("click", async function () {
      const idVerdict = validateFieldId($("fields-new-id").value);
      if (!idVerdict.ok) {
        sayFields(idVerdict.message, "bad");
        return;
      }
      const labelVerdict = validateFieldLabel($("fields-new-label").value);
      if (!labelVerdict.ok) {
        sayFields(labelVerdict.message, "bad");
        return;
      }
      const lines = parseValueLines($("fields-new-values").value);
      if (lines.length > MAX_FIELD_VALUES) {
        sayFields("A field carries up to " + MAX_FIELD_VALUES +
          " values, retired ones counted.", "bad");
        return;
      }
      $("fields-new-add").disabled = true;
      const written = await addField(
        idVerdict.value, labelVerdict.value, lines);
      $("fields-new-add").disabled = false;
      if (written) {
        $("fields-new-id").value = "";
        $("fields-new-label").value = "";
        $("fields-new-values").value = "";
      }
    });

     
     

    function sayLog(message, tone) {
      UI.setStatus($("log-status"), message, tone);
    }

    

    const LOG_PAGE_SIZE = 20;
    let logEntries = [];
    let logRevealed = LOG_PAGE_SIZE;

    function drawLog() {
      const list = $("log-list");
      list.textContent = "";
      if (!logEntries.length) {
        const empty = document.createElement("p");
        empty.className = "hint";
        empty.textContent = "No changes yet.";
        list.appendChild(empty);
        return;
      }
      

      const scroller = document.createElement("div");
      scroller.className = "table-scroll";
      const table = document.createElement("table");
      table.className = "log-table";

      const head = document.createElement("thead");
      const headRow = document.createElement("tr");
      for (const heading of ["When", "Who", "What changed"]) {
        const th = document.createElement("th");
        th.scope = "col";
        th.textContent = heading;
        headRow.appendChild(th);
      }
      head.appendChild(headRow);
      table.appendChild(head);

      const body = document.createElement("tbody");
      const shown = logEntries.slice(0, logRevealed);
      for (const entry of shown) {
        const line = logLine(entry);
        const row = document.createElement("tr");

        const when = document.createElement("td");
        when.className = "log-when";
        when.textContent = line.when;
        row.appendChild(when);

        const who = document.createElement("td");
        who.textContent = line.who;
        row.appendChild(who);

        const what = document.createElement("td");
        what.className = "wrap-row-value";
        what.textContent = line.what;
        row.appendChild(what);

        body.appendChild(row);
      }
      table.appendChild(body);
      scroller.appendChild(table);
      list.appendChild(scroller);
      if (logEntries.length > logRevealed) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "secondary";
        more.textContent = "More";
        more.addEventListener("click", function () {
          logRevealed += LOG_PAGE_SIZE;
          drawLog();
        });
        list.appendChild(more);
      }
    }

    async function loadLog() {
      try {
        const response = await fetch(config.endpoint + "/admin-log", {
          headers: root.BinderSession.authorization(),
        });
        if (sessionRefused(response, sayLog)) return;
        if (!response.ok) {
          throw new Error("The server answered " + response.status + ".");
        }
        const payload = await response.json();
        const entries = Array.isArray(payload && payload.log)
          ? payload.log
          : [];
        logEntries = entries;
         
         
         
         
        logRevealed = LOG_PAGE_SIZE;
        drawLog();
        sayLog("", null);
      } catch (error) {
        detail(why(error));
        sayLog("The change log could not be read.", "bad");
      }
    }

     
     
     
     
     
     
     

    let departedPayload = null;
    let departedRevealed = DEPARTED_PAGE_SIZE;

    function sayDeparted(message, tone) {
      UI.setStatus($("departed-status"), message, tone);
    }

    const DEPARTED_TITLES = { departed: "Departed", unknown: "Unknown",
      allowed: "Allowed" };

    function departedRow(entry, sectionKey) {
      const label = departedName(entry);
      const block = document.createElement("div");
      block.className = "stack-tight";

      const row = document.createElement("div");
      row.className = "row wrap-row";
      const name = document.createElement("span");
      name.className = "wrap-row-value";
      name.textContent = label;
      row.appendChild(name);
      const info = document.createElement("span");
      info.className = "hint";
      const reason = sectionKey !== "departed" && entry &&
        typeof entry.reason === "string" ? entry.reason : "";
      info.textContent = "last seen " + shortDate(entry && entry.lastSeenAt) +
        (reason ? " - " + reason : "");
      row.appendChild(info);
      block.appendChild(row);

      const buttons = document.createElement("div");
      buttons.className = "row buttons";
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "secondary";
      trigger.textContent = "Remove";
      buttons.appendChild(trigger);
      block.appendChild(buttons);

      dangerousAction(block, trigger, eraseDepartedSentence(label),
        function () {
          eraseDeparted(entry && entry.accountId);
        });
      return block;
    }

    function renderDeparted() {
      const list = $("departed-list");
      list.textContent = "";
      const view = departedSections(departedPayload, departedRevealed);
      if (!view.total) {
        const empty = document.createElement("p");
        empty.className = "hint";
        empty.textContent = "Nobody has left - nothing to clean up.";
        list.appendChild(empty);
      } else {
        for (const section of view.sections) {
          if (!section.rows.length) continue;
          const heading = document.createElement("h2");
          heading.textContent = DEPARTED_TITLES[section.key];
          list.appendChild(heading);
          for (const entry of section.rows) {
            list.appendChild(departedRow(entry, section.key));
          }
        }
        if (view.hasMore) {
          const more = document.createElement("button");
          more.type = "button";
          more.className = "secondary";
          more.textContent = "More";
          more.addEventListener("click", function () {
            departedRevealed += DEPARTED_PAGE_SIZE;
            renderDeparted();
          });
          list.appendChild(more);
        }
      }
      

      const capNote = departedCapNote(departedPayload, view.total);
      if (!capNote) return;
      const footer = document.createElement("p");
      footer.className = "hint";
      footer.textContent = capNote;
      list.appendChild(footer);
    }

    async function loadDeparted() {
      try {
        const response = await fetch(config.endpoint + "/admin-departed", {
          headers: root.BinderSession.authorization(),
        });
        if (sessionRefused(response, sayDeparted)) return;
        if (!response.ok) {
          sayDeparted(refusalFor(response.status, await refusalBody(response))
            .message, "bad");
          return;
        }
        departedPayload = await response.json();
      } catch (error) {
        detail(why(error));
        sayDeparted("The departed list could not be read.", "bad");
        return;
      }
      departedRevealed = DEPARTED_PAGE_SIZE;
      renderDeparted();
      sayDeparted("", null);
    }

     
     
     
    async function eraseDeparted(accountId) {
      let response;
      try {
        response = await fetch(
          config.endpoint + "/admin-departed/" + encodeURIComponent(accountId),
          { method: "DELETE", headers: root.BinderSession.authorization() });
      } catch (error) {
        detail(why(error));
         
         
         
        showToast("Nothing was sent — try again.");
        return;
      }
      if (sessionRefused(response, showToast)) return;
      const payload = await refusalBody(response);
       
       
       
      showToast(response.ok ? "Removed." :
        (payload && payload.error) || "Nothing was removed — try again.");
      await loadDeparted();
    }

     
     
     

    function clearAdminData() {
      $("log-list").textContent = "";
      $("roles-admin").textContent = "";
      $("roles-malformed-list").textContent = "";
      $("roles-other-body").textContent = "";
      show($("roles-malformed"), false);
      show($("roles-other"), false);
      $("fields-list").textContent = "";
      currentSpec = null;
      $("departed-list").textContent = "";
      departedPayload = null;
      departedRevealed = DEPARTED_PAGE_SIZE;
    }

    function wireIdle() {
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
          capture: true, passive: true,
        });
      }

      function endForIdle() {
        root.clearInterval(ticker);
        clearAdminData();
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
    }

     
     
     
     
     
     
     
     
     
     
     
     

    const fadeIn = UI.fadeIn;

    const TABS = [
      { tab: "tab-settings", panel: "settings-card" },
      { tab: "tab-roles", panel: "roles-card" },
      { tab: "tab-fields", panel: "fields-card" },
      { tab: "tab-log", panel: "log-card" },
      { tab: "tab-departed", panel: "departed-card" },
    ];

    function selectTab(panelId) {
      for (const one of TABS) {
        const active = one.panel === panelId;
        $(one.tab).setAttribute("aria-selected", String(active));
        show($(one.panel), active);
        if (active) fadeIn($(one.panel));
      }
    }

    for (const one of TABS) {
      $(one.tab).addEventListener("click", function () {
        selectTab(one.panel);
      });
    }
     
     
     
    selectTab("settings-card");

     
     
     
     
     
     
     
     
     
     
     
     
     
     
     
     
     
     
     
     
    const showToast = UI.showToast;

    wireIdle();
    loadSettings();
    readMembership();
    loadDirectory();
    loadAdminVia();
    loadFields();
    loadLog();
    loadDeparted();
  }
})(globalThis);
