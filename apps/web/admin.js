/*
 * The admin page. Settings, Roles, Fields and the Change log - nothing
 * else.
 *
 * 0.9-M3-S10 (#416) rebuilds this page for the keyless world: the
 * keyfile-decrypt tool, the entry exports (CSV/xlsx/JSON) and the
 * publish/unpublish snapshot controls all depended on a private key or
 * a client-built dashboard that are both gone (DESIGN.md, "Trust
 * model: the Worker reads"; #354 retired dashboard.js). Prime's ruling
 * on this ticket's own fork (2026-08-21) took the exports out entirely
 * rather than reconnecting them to a plaintext /export: the M3 design
 * record (#385 §4) rules that no admin surface exposes a current
 * member's data, and a page handing an admin every member's entries is
 * exactly that. Nothing here fetches or renders a submission - Fields
 * (0.9-M3-S13, #433) is no exception: it draws the SPEC (GET /spec),
 * never a count of who picked what.
 *
 * What is left is four cards, each reading and writing through the
 * admin session alone: Settings (GET/POST /content), Roles (GET/POST/
 * DELETE /membership, plus /me's adminVia), Fields (GET /spec, PUT/
 * DELETE /admin-fields/<id> - the categorical form builder, #433
 * against 0.9-M3-S11's landed contract on #419), and the Change log
 * (GET /admin-log). Split like every other page here - the pure half
 * is exported as BinderAdmin and tested in tests/admin-page.test.mjs;
 * the wiring below returns early when there is no document.
 *
 * THE CONTRACT SOURCE, superseding the ticket's own §5 in three places
 * (S8's completion on #414, comment 5370945709, read before this build
 * was finished): the route is GET /admin-log, not /admin/log - "admin"
 * cannot be an API segment without colliding with this page's own URL
 * through html_handling, the same defect 0.9-M2-S8 (#365) found with
 * /charts. Its envelope is `{ok, log: [{at, accountId, action, name,
 * summary}]}` - `accountId` is the ACTOR (hex, or the literal string
 * "break-glass"), never a display label the Worker does not send, and
 * `name` is context-dependent: the content key for a content.set/unset
 * action, or the affected member's account id for a membership.add/
 * remove action. adminVia carries a fourth value, "break-glass" (the
 * export-token caller), alongside telegram/flag/secret and null (a
 * session written before the column existed). site.defaultTheme joins
 * chart.lockedUnit in accepting "" as a real stored value - "follow
 * the visitor's own choice" - not a state this page refuses.
 */
(function (root) {
  "use strict";

  /* ---------------------------------------------------------------- */
  /* Settings (#416 item 2; #385 §9, §11).                             */

  /*
   * The five keys, validated exactly as server/worker.js validates them
   * on write (S8's completion on #414, the "contract, in full" block).
   * Client validation MIRRORS that ruling rather than re-deriving it -
   * refusing before a round trip is a courtesy, and the Worker's own
   * refusal (400 naming the canonical spelling or what a value accepts,
   * 409 on a case collision) is still what a mismatch here falls back
   * to.
   */
  const UNIT_SYSTEMS = Object.freeze(["metric", "imperial"]);
  const THEMES = Object.freeze(["pink", "daylight", "midnight", "contrast"]);
  const MAX_GROUP_NAME = 64;
  const MAX_WELCOME_TEXT = 500;

  /* Digits, 0 to 999999, no leading zero, no fraction - the Worker's
   * own bound, not a client invention. */
  function validateFloor(raw) {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!/^(0|[1-9]\d{0,5})$/.test(text)) {
      return { ok: false,
        message: "The floor is a whole number, 0 to 999999, with no " +
          "leading zero." };
    }
    return { ok: true, value: text };
  }

  /* Empty means "follow each member's own choice" - unlocked. */
  function validateLockedUnit(raw) {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (text !== "" && UNIT_SYSTEMS.indexOf(text) === -1) {
      return { ok: false, message: "Pick metric, imperial, or unlocked." };
    }
    return { ok: true, value: text };
  }

  /* A site with no name cannot paint its own wordmark (#385 §10). */
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

  /* Optional prose - an empty welcome text is a real choice (the door
   * page shows its own default copy instead), not a mistake. */
  function validateWelcomeText(raw) {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (text.length > MAX_WELCOME_TEXT) {
      return { ok: false,
        message: "The welcome text is " + MAX_WELCOME_TEXT + " characters " +
          "or fewer." };
    }
    return { ok: true, value: text };
  }

  /* Empty means "follow the visitor's own system" - the same shape as
   * the locked unit, and a real stored value rather than a state this
   * page refuses. */
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

  /* What GET /content ships when a name has never been set - the same
   * shipped defaults the contract names for the floor and the lock,
   * extended to the three content keys with the honest "nothing set
   * yet" answer: empty text, and "follow the visitor's own system" for
   * the theme, matching the lock's own unset shape. */
  const SETTINGS_DEFAULTS = Object.freeze({
    "chart.floor": "0",
    "chart.lockedUnit": "",
    "site.groupName": "",
    "site.welcomeText": "",
    "site.defaultTheme": "",
  });

  /*
   * What a member sees, stated back to the admin setting it (#385 §11
   * rules that the page says when the floor is active - the honest-
   * empty-state rule extended to it). Read off the SAME validated
   * value the save button is about to send, never recomputed from a
   * second parse.
   */
  function floorNotice(floorText) {
    const n = Number(floorText);
    if (!Number.isFinite(n) || n <= 0) {
      return "Off — nothing is hidden for being a small group.";
    }
    return "On — members will see: \"Groups smaller than " + n +
      " are hidden.\"";
  }

  /* ---------------------------------------------------------------- */
  /* Roles (#416 item 3; #385 §1-§2).                                  */

  /*
   * One role only. The pre-0.9-M3 page also managed `always_allow`, a
   * bypass DESIGN.md's "What is deliberately not here" retires with
   * this same milestone (server/worker.js's own MEMBERSHIP_ROLES
   * comment names it) - this page never offers to add one, and a row
   * GET /membership still hands back under that name is caught by the
   * `unknown` branch below rather than silently dropped.
   */
  const MEMBERSHIP_ROLES = Object.freeze(["admin"]);

  /* The Worker's own bound on a membership label (server/worker.js's
   * MAX_LABEL), mirrored the same way MAX_GROUP_NAME and
   * MAX_WELCOME_TEXT already mirror the Settings card's bounds (#416,
   * F6) - the fourth text input on this page was the only one left
   * unbounded, and an admin label is exactly the kind of unbroken run
   * (a pasted handle, a long name with no spaces) that overflows a
   * `.row` the same way a change-log summary does (F1). */
  const MAX_LABEL = 64;

  /* Trim, refuse empty or over-length, matching validateGroupName's own
   * shape - a courtesy ahead of the Worker's own 400. */
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

  /* A row this page can draw: an object carrying an account id it can
   * put on a button. Anything else is counted rather than drawn. */
  function isRow(row) {
    return Boolean(row) && typeof row === "object" &&
      typeof row.account_id === "string" && row.account_id !== "";
  }

  const MEMBERSHIP_FIELDS = ["membership", "malformed", "secretOnly"];

  /*
   * What GET /membership answered, sorted into what the page draws.
   *
   * `unknown` catches any row whose role is not `admin` - including a
   * lingering `always_allow` row, if the Worker still sends one. Every
   * row here already passed the Worker's own grantsAnything() (the same
   * predicate its authority read uses), so a row here GRANTS whatever
   * its role says; sorting it into silence would hide a live grant from
   * the one screen that exists to show them.
   *
   * `absent` is the difference between a field that came back empty and
   * one that did not come back at all - `secretOnly` reading empty is
   * the backfill's go-signal (OPERATIONS.md), so a page that renders a
   * missing field as an empty one prints that go-signal from a Worker
   * that never gave it.
   */
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

  /*
   * What the `secretOnly` list means, in the words the runbook uses.
   * Unchanged from the pre-0.9-M3 page other than the vocabulary shift
   * from "the Worker" to "this service" (#265 rows 33/36).
   */
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

  /*
   * The status that means the session is over, named once so that no
   * call site has to hold the number.
   */
  const REFUSED = 401;

  /*
   * What the page does about a refusal, and what it says. One function
   * because no authenticated call on this page may invent its own
   * answer to the same two questions - does the page stay, and what
   * does it say.
   */
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

  /*
   * What to say after a row is added. ADDING AN ADMIN ROW DOES NOTHING
   * FOR A SESSION THAT ALREADY EXISTS - `is_admin` is minted at sign-in,
   * so the new admin sees no change until they sign out and in again. An
   * admin who is not told that reads the unchanged screen as the add
   * having failed, and adds it again.
   */
  function addedNotice(label) {
    const named = typeof label === "string" && label.trim()
      ? label.trim()
      : "That account";
    return named + " is on the admin list, and becomes an admin at their " +
      "NEXT sign-in: the admin flag is minted when a session is created, " +
      "so a session they are already holding does not change. Ask them to " +
      "sign out and in again.";
  }

  /*
   * A removal button's text, on each of its two presses. This is a
   * courtesy and NOT a guard: the thing that actually stops the admin
   * list being emptied is the Worker's last-admin subquery inside the
   * DELETE.
   */
  function removalStep(row, armed) {
    const named = row && typeof row.label === "string" && row.label.trim()
      ? row.label.trim()
      : "";
    if (armed) {
      return named ? "Confirm removing " + named : "Confirm removing this row";
    }
    return named ? "Remove " + named : "Remove this row";
  }

  /* ---------------------------------------------------------------- */
  /* Fields (#433; the ruled design #385 §6-§8, against 0.9-M3-S11's     */
  /* landed Worker contract on #419).                                    */

  /*
   * The id charset and the two bounds, mirrored from server/worker.js's
   * own SPEC_ID, MAX_FIELD_LABEL and MAX_FIELD_VALUES (0.9-M3-S11,
   * #419) - the same courtesy every other validator on this page
   * already takes: refusing before a round trip, never inventing a
   * rule the Worker does not also hold.
   */
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

  /* One label per line, trimmed, empty lines dropped - the "starting
   * values" box on the add-a-field form. MAX_FIELD_VALUES is read
   * where the list is actually sent, not here, so a paste past it is
   * refused with the Worker's own sentence rather than a second,
   * possibly-different one. */
  function parseValueLines(raw) {
    const text = typeof raw === "string" ? raw : "";
    return text.split("\n").map((line) => line.trim())
      .filter((line) => line !== "");
  }

  /*
   * Which of the effective spec's fields this card can build (#385
   * §6): choice fields only. Everything else - weight, height, bmi,
   * over18, and any future numeric or consent kind - is shown, never
   * edited, for the one sentence server/worker.js's NOT_A_CHOICE_FIELD
   * already gives a refused write.
   */
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

  /* A rename's two plain-words choices and the one-sentence
   * consequence of each (#385 §8) - the words THIS CARD shows before
   * it sends, mirroring server/worker.js's own RENAME_NEEDS_MODE
   * sentence rather than inventing a second account of the same rule. */
  const RENAME_CHOICES = Object.freeze([
    { mode: "relabel", label: "Same thing, new word",
      consequence: "Entries already saved follow the new word " +
        "instantly." },
    { mode: "replace", label: "A different thing",
      consequence: "The old value retires under the word it had; " +
        "entries keep it until someone re-picks." },
  ]);

  /*
   * WHY UN-RETIRE IS SESSION-SCOPED (the judgment call in the
   * completion on #433). GET /spec answers the EFFECTIVE spec - what a
   * member reads - and server/worker.js's own applyOverlay() splices a
   * retired field out of it; offeredValues() filters a retired value
   * out of `choices` the same way. #419's own completion proves an
   * admin session reads the SAME bytes as a member - there is no
   * admin view of the spec, only the one view. So no route ever hands
   * this page a retired item's id once it has left that response: the
   * Worker's own internal bookkeeping (server/worker.js's
   * currentValues()) keeps it, but nothing serves it out.
   *
   * What follows is the most this card can honestly do about that: a
   * roster of every choice field and value THIS PAGE has itself seen
   * offered THIS SESSION, kept even after a later read stops offering
   * it. mergeFieldsRoster ADDS and UPDATES; it never DROPS an id that
   * disappears, because the disappearance is exactly the fact
   * "retired, as far as this page knows" needs to survive. A field or
   * value retired before this page was ever opened - by this admin
   * last week, or by another admin just now in a different tab - never
   * enters the roster and is not offered back; typing the same words
   * again makes a NEW value under a NEW id (server/worker.js's mintId
   * steps around every id a field has ever had, retired ones
   * included), which is a real limit of the contract, not a bug here.
   */
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

  /*
   * The roster plus the live spec, turned into what the card draws:
   * one entry per field this page has ever offered this session, each
   * carrying every value it has ever offered - offered ones first, in
   * the order the Worker sent them, retired-as-known ones after.
   * Active fields render in the spec's own order; fields this session
   * has retired (not present in `spec` any more, but still in `known`)
   * render after them, in the order this roster first met them.
   */
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

  /* ---------------------------------------------------------------- */
  /* The Change log (#416 item 4; #385 §5).                            */

  /*
   * GET /admin-log's real shape (S8's completion on #414, comment
   * 5370945709): { ok, log: [{at, accountId, action, name, summary}] }.
   * `accountId` is the ACTOR who made the change - a 64-hex account id,
   * or the literal string "break-glass" for the export-token caller -
   * never a display label, since the Worker sends none. `name` is
   * context-dependent (a content key, or the affected member's account
   * id) and folded into `summary`'s own prose rather than shown as a
   * fourth column that would need its own translation per action.
   */
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

  /* The action enum, in plain words - #414's four values, and a
   * fallback for anything this page does not recognize rather than a
   * raw dotted code a reader has to decode. */
  const LOG_ACTIONS = Object.freeze({
    "content.set": "changed a setting",
    "content.unset": "reset a setting",
    "membership.add": "added an admin",
    "membership.remove": "removed an admin",
  });

  /* The Worker's own bound on a summary - S8's completion on #414 says
   * up to 200 characters of a written value - assumed and never
   * enforced here before #416's fix wave (F1/F5). This page has no way
   * to confirm the Worker held its own contract on any given row, so
   * the display enforces it too: a summary past the ceiling is cut and
   * marked, never rendered whole. That also bounds the worst case of
   * the overflow F1 found - a long run inside the cap still needs
   * ".row.wrap-row" (theme.css) to wrap rather than spill, but nothing
   * arriving after this page's own build can hand the row an unbounded
   * one. */
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

  /* One line per entry, three plain strings - the render loop below
   * writes each through textContent and composes nothing else. */
  function logLine(entry) {
    return { when: logWhen(entry && entry.at), who: logWho(entry),
      what: logWhat(entry) };
  }

  /* ---------------------------------------------------------------- */
  /* Walking away from the machine (DESIGN.md, "Sessions": "Idle expiry */
  /* is one rule everywhere") - the same window every signed-in page   */
  /* carries. See apps/web/submit.js for the twin copy.                */

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

  // Frozen for the reason every other exported object here is: a page
  // that can quietly redefine BinderAdmin is a page whose validation
  // and rendering rules a later script can silently swap out.
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

  /* ---------------------------------------------------------------- */
  /* The wiring. Everything above this line runs under Node.          */

  if (typeof document === "undefined") return;

  const UI = root.BinderUI;
  const $ = UI.byId;
  const show = UI.show;

  /* The technical half of a failure, written where a developer looks -
   * the register bar's rules 1 and 5 (#275). */
  function detail(technical) {
    if (technical && root.console &&
        typeof root.console.warn === "function") {
      root.console.warn("binder: " + technical);
    }
  }

  function why(error) {
    return error && error.message ? error.message : "failed with no message";
  }

  /*
   * The nameplate and the intro, which are claims about what is below
   * them - #265 row 23, carried forward unchanged.
   */
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

    // session.js starts the redirect for a signed-out visitor. Hide the
    // tool as well in case navigation is delayed; none of its wiring or
    // requests should run without an authenticated admin in this tab.
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

    /* ------------------------------------------------------------ */
    /* Settings.                                                     */

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

    // Wired by id, one field at a time, rather than through a compound
    // selector over data-save - every other control on this page reads
    // by id through $(), and a page whose Save buttons are the one
    // thing found by walking the DOM is a page a test harness has to
    // grow a small CSS engine just to drive.
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

    /* ------------------------------------------------------------ */
    /* Roles.                                                        */

    function sayRoles(message, tone) {
      UI.setStatus($("roles-status"), message, tone);
    }

    function membershipRow(row) {
      const line = document.createElement("div");
      // "row wrap-row", not plain "row" - a member's own label is
      // unbounded prose from this page's point of view (up to
      // MAX_LABEL, but nothing here enforced that until #416, F1/F6),
      // and `.row`'s default flex-child min-width pushes the whole
      // document wider than the screen the moment one arrives as a
      // single unbroken run. See apps/web/theme.css, ".row.wrap-row".
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
      // The Worker's own MAX_LABEL bound (#416, F6) - mirrors
      // validateGroupName's own shape, refused before any request is
      // sent, the same way the Settings card's four fields already are.
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

    /* This session's own reason for being an admin, from /me rather
     * than from anything cached at sign-in - `adminVia` is minted fresh
     * on each read (#414 item 5), and a flagged admin who is later made
     * a Telegram group admin should see the truer of the two without
     * signing out first. Absent (a Worker that predates the field, or a
     * network failure) says nothing rather than guessing. */
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
        // Silence, matching the rest of this page: a fact this line
        // could not confirm is a fact this line says nothing about.
      }
    }

    /* ------------------------------------------------------------ */
    /* Fields (#433).                                                */

    // The live effective spec and this session's own roster of what it
    // has ever offered - see the block comment above
    // mergeFieldsRoster/fieldsRosterView in the pure half for why the
    // roster exists at all. Both reset on idle sign-out
    // (clearAdminData, below), the same as every other cache this page
    // keeps.
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

    // The field's CURRENT offered list, read fresh from the live spec
    // rather than from the roster - a write sends the whole desired
    // state (server/worker.js's own mergeValues), so what a value edit
    // builds on has to be what is actually stored now, never a memory
    // that may have drifted.
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

    // Every field/value write on this card is: send, re-read /spec so
    // what is shown is what is stored (ticket item 4), say what
    // happened. One function so no call site invents its own order of
    // those three steps.
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

    // Un-retiring a FIELD sends no `values` - handleWriteField then
    // keeps currentValues(shipped, held), which is exactly what the
    // field held at the moment it was retired (server/worker.js,
    // handleRetireField). Reachable only for a field this roster still
    // knows the id of.
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

    // The value's id and label come from THIS SESSION'S roster (the
    // one place either survives once the Worker stops offering it) -
    // never invented, never re-minted, so the entries members already
    // saved under that id are the ones this brings back.
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

    /* -- Drawing. -- */

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

    // One value's own row plus its buttons plus its (hidden until
    // asked for) rename mini-form. `position` is this value's index
    // and the count of OFFERED values, among offered ones only - "Move
    // up"/"Move down" reorder what is actually sent, so a retired
    // value (already excluded from that list) never takes a slot in
    // it.
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

      // #385 §8: the rename form asks what the new word means BEFORE
      // it sends anything - the two buttons below ARE the send, since
      // picking a mode is picking an action, not a third step after it.
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

    // The read-only half (#385 §6): weight, height, bmi, over18, and
    // any future non-choice kind. No buttons at all - the reason IS
    // the whole of what this row offers.
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

    /* ------------------------------------------------------------ */
    /* Change log.                                                   */

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
        // "row wrap-row" - this row's own contract data is exactly
        // where the overflow lives (#416, F1): a 64-hex account id, a
        // URL a member pasted into the welcome text, up to 200
        // characters of summary. See apps/web/theme.css, ".row.wrap-row".
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

    /* ------------------------------------------------------------ */
    /* Walking away from the machine, matching apps/web/submit.js's own */
    /* wireIdle() shape.                                                */

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
