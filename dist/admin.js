

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
    "the form spec, so they are not edited here. Its label still is.";

  

  const RENAME_CHOICES = Object.freeze([
    { mode: "relabel", label: "Same thing, new word",
      consequence: "Entries already saved follow the new word " +
        "instantly." },
    { mode: "replace", label: "A different thing",
      consequence: "The old value retires under the word it had; " +
        "entries keep it until someone re-picks." },
  ]);

  

  function mergeFieldsRoster(known, spec) {
    const next = new Map(known);
    for (const field of categoricalFields(spec).choice) {
      const existing = next.get(field.name);
      const values = new Map(existing ? existing.values : []);
      for (const v of field.choices || []) {
        if (v && typeof v.value === "string") values.set(v.value, v.label);
      }
      next.set(field.name, { label: field.label, values: values });
    }
    return next;
  }

  

  function fieldsRosterView(known, spec) {
    const active = categoricalFields(spec).choice;
    const activeIds = new Set(active.map((f) => f.name));
    const out = [];

    for (const field of active) {
      const entry = known.get(field.name);
      const knownValues = entry ? entry.values : new Map();
      const offeredIds = new Set(
        (field.choices || []).map((v) => v.value));
      const values = (field.choices || []).map((v) =>
        ({ id: v.value, label: v.label, retired: false }));
      for (const [id, label] of knownValues) {
        if (!offeredIds.has(id)) values.push({ id, label, retired: true });
      }
      out.push({ id: field.name, label: field.label, active: true,
        outside: Boolean(field.choicesFrom), values: values });
    }

    for (const [id, entry] of known) {
      if (activeIds.has(id)) continue;
      const values = [...entry.values].map(([vid, label]) =>
        ({ id: vid, label: label, retired: true }));
      out.push({ id: id, label: entry.label, active: false,
        outside: false, values: values });
    }

    return out;
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
    RENAME_CHOICES: RENAME_CHOICES,
    mergeFieldsRoster: mergeFieldsRoster,
    fieldsRosterView: fieldsRosterView,
    logLine: logLine,
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
            saySettings(refusal.message, "bad");
            return;
          }
        } catch (error) {
          button.disabled = false;
          detail(why(error));
          saySettings("That could not be sent.", "bad");
          return;
        }
        button.disabled = false;
        field.value = verdict.value;
        if (name === "chart.floor") {
          $("settings-floor-notice").textContent =
            root.BinderAdmin.floorNotice(verdict.value);
        }
        saySettings("Saved.", null);
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

    function handleRefusal(status, payload) {
      const refusal = refusalFor(status, payload);
      if (refusal.action === "signed-out") {
        sessionEnded(sayRoles);
        return true;
      }
      sayRoles(refusal.message, "bad");
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

    $("member-add").addEventListener("click", async function () {
      const telegramId = $("member-telegram-id").value.trim();
      const rawLabel = $("member-label").value;

      if (!telegramId || !rawLabel.trim()) {
        sayRoles("A numeric Telegram id and a label are both needed.", "bad");
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
        detail(why(error));
        sayRoles("That could not be sent.", "bad");
        return;
      }

      $("member-telegram-id").value = "";
      $("member-add").disabled = false;
      await readMembership();
      sayRoles(addedNotice(label), null);
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
            await refusalBody(response));
          if (!left) await readMembership();
          return;
        }
      } catch (error) {
        button.disabled = false;
        detail(why(error));
        sayRoles("That could not be removed.", "bad");
        return;
      }

      await readMembership();
      sayRoles("Removed.", null);
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
    let fieldsKnown = new Map();

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

     
     
     
     
     
    function liveChoices(fieldId) {
      const fields = (currentSpec && currentSpec.fields) || [];
      const field = fields.filter((f) => f && f.name === fieldId)[0];
      return field && Array.isArray(field.choices)
        ? field.choices.map((v) => ({ id: v.value, label: v.label }))
        : [];
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

     
     
     
     
    async function sendFieldWrite(request, successMessage) {
      sayFields("Saving…", null);
      let response;
      try {
        response = await request();
      } catch (error) {
        detail(why(error));
        sayFields("That could not be sent.", "bad");
        return;
      }
      if (sessionRefused(response, sayFields)) return;
      if (!response.ok) {
        handleFieldsRefusal(response.status, await refusalBody(response));
        return;
      }
      await loadFields();
      sayFields(successMessage, null);
      loadLog();
    }

    function retireField(id) {
      return sendFieldWrite(() => deleteField(id), "Retired.");
    }

     
     
     
     
     
    function unretireField(id) {
      return sendFieldWrite(() => putField(id, { retired: false }),
        "Restored.");
    }

    function retireValue(fieldId, valueId) {
      const remaining = liveChoices(fieldId)
        .filter((v) => v.id !== valueId);
      return sendFieldWrite(() => putField(fieldId, { values: remaining }),
        "Retired.");
    }

     
     
     
     
    function unretireValue(fieldId, valueId, label) {
      const values = liveChoices(fieldId)
        .concat([{ id: valueId, label: label, retired: false }]);
      return sendFieldWrite(() => putField(fieldId, { values: values }),
        "Restored.");
    }

    function addValue(fieldId, label) {
      const values = liveChoices(fieldId).concat([{ label: label }]);
      return sendFieldWrite(() => putField(fieldId, { values: values }),
        "Added.");
    }

    function moveValue(fieldId, valueId, delta) {
      const values = liveChoices(fieldId);
      const at = values.findIndex((v) => v.id === valueId);
      const to = at + delta;
      if (at === -1 || to < 0 || to >= values.length) return;
      const reordered = values.slice();
      const moved = reordered.splice(at, 1)[0];
      reordered.splice(to, 0, moved);
      return sendFieldWrite(() => putField(fieldId, { values: reordered }),
        "Reordered.");
    }

    function renameValue(fieldId, valueId, newLabel, mode) {
      const values = liveChoices(fieldId).map((v) =>
        v.id === valueId ? { id: v.id, label: newLabel } : v);
      return sendFieldWrite(
        () => putField(fieldId, { values: values, mode: mode }),
        "Renamed.");
    }

    function addField(id, label, valueLines) {
      const body = { label: label };
      if (valueLines.length) {
        body.values = valueLines.map((l) => ({ label: l }));
      }
      return sendFieldWrite(() => putField(id, body), "Added.");
    }

     

    function fieldHeaderRow(view) {
      const row = document.createElement("div");
      row.className = "row wrap-row";
      const name = document.createElement("span");
      name.className = "wrap-row-value";
      name.textContent = view.label + (view.active ? "" : " (retired)");
      row.appendChild(name);
      const id = document.createElement("span");
      id.className = "hint";
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
      name.className = "wrap-row-value";
      name.textContent = value.label + (value.retired ? " (retired)" : "");
      labelRow.appendChild(name);
      const idSpan = document.createElement("span");
      idSpan.className = "hint";
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
      retire.addEventListener("click", function () {
        retireValue(view.id, value.id);
      });
      buttons.appendChild(retire);

      block.appendChild(buttons);

       
       
       
      const form = document.createElement("div");
      form.className = "stack-tight";
      form.hidden = true;

      const input = document.createElement("input");
      input.type = "text";
      input.value = value.label;
      form.appendChild(input);

      for (const choice of RENAME_CHOICES) {
        const consequence = document.createElement("p");
        consequence.className = "hint";
        consequence.textContent = choice.consequence;
        form.appendChild(consequence);

        const modeButton = document.createElement("button");
        modeButton.type = "button";
        modeButton.className = "secondary";
        modeButton.textContent = choice.label;
        modeButton.addEventListener("click", function () {
          const verdict = validateValueLabel(input.value);
          if (!verdict.ok) {
            sayFields(verdict.message, "bad");
            return;
          }
          renameValue(view.id, value.id, verdict.value, choice.mode);
        });
        form.appendChild(modeButton);
      }

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
        add.addEventListener("click", function () {
          const verdict = validateValueLabel(input.value);
          if (!verdict.ok) {
            sayFields(verdict.message, "bad");
            return;
          }
          if (liveChoices(view.id).length >= MAX_FIELD_VALUES) {
            sayFields("A field carries up to " + MAX_FIELD_VALUES +
              " values, retired ones counted.", "bad");
            return;
          }
          addValue(view.id, verdict.value);
          input.value = "";
        });
        addRow.appendChild(add);
        block.appendChild(addRow);
      }

      let armed = false;
      const retire = document.createElement("button");
      retire.type = "button";
      retire.className = "secondary";
      retire.textContent = "Retire field";
      retire.addEventListener("click", function () {
        if (!armed) {
          armed = true;
          retire.textContent = "Confirm retiring this field";
          return;
        }
        retireField(view.id);
      });
      buttons.appendChild(retire);
      block.appendChild(buttons);
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
      for (const view of fieldsRosterView(fieldsKnown, currentSpec)) {
        list.appendChild(fieldBlock(view));
      }
    }

    async function loadFields() {
      sayFields("Loading…", null);
      let payload;
      try {
        const response = await fetch(config.endpoint + "/spec", {
          headers: root.BinderSession.authorization(),
        });
        if (sessionRefused(response, sayFields)) return;
        if (!response.ok) {
          handleFieldsRefusal(response.status, await refusalBody(response));
          return;
        }
        payload = await response.json();
      } catch (error) {
        detail(why(error));
        sayFields("The form's fields could not be read.", "bad");
        return;
      }
      const spec = payload && payload.spec && typeof payload.spec === "object"
        ? payload.spec
        : { fields: [] };
      fieldsKnown = mergeFieldsRoster(fieldsKnown, spec);
      currentSpec = spec;
      renderFields();
      sayFields("", null);
    }

    $("fields-new-add").addEventListener("click", function () {
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
      addField(idVerdict.value, labelVerdict.value, lines);
      $("fields-new-id").value = "";
      $("fields-new-label").value = "";
      $("fields-new-values").value = "";
    });

     
     

    function sayLog(message, tone) {
      UI.setStatus($("log-status"), message, tone);
    }

    function drawLog(entries) {
      const list = $("log-list");
      list.textContent = "";
      if (!entries.length) {
        const empty = document.createElement("p");
        empty.className = "hint";
        empty.textContent = "No changes yet.";
        list.appendChild(empty);
        return;
      }
      for (const entry of entries) {
        const line = logLine(entry);
        const row = document.createElement("div");
         
         
         
         
        row.className = "row wrap-row";

        const when = document.createElement("span");
        when.className = "hint";
        when.textContent = line.when;
        row.appendChild(when);

        const who = document.createElement("span");
        who.textContent = line.who;
        row.appendChild(who);

        const what = document.createElement("span");
        what.className = "wrap-row-value";
        what.textContent = line.what;
        row.appendChild(what);

        list.appendChild(row);
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
        drawLog(entries);
        sayLog("", null);
      } catch (error) {
        detail(why(error));
        sayLog("The change log could not be read.", "bad");
      }
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
      fieldsKnown = new Map();
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

    wireIdle();
    loadSettings();
    readMembership();
    loadAdminVia();
    loadFields();
    loadLog();
  }
})(globalThis);
