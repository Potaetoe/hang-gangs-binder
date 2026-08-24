/*
 * The admin page. Settings, Roles, Fields, the Change log and Departed -
 * one tab per area (#385 item (b), #454 item 20, owner ruling
 * 2026-08-22). Departed (0.9-M3-S34, #458) is the page half of 0.9-M3-S15's
 * Worker (#420): GET /admin-departed lists accounts in three states -
 * departed, unknown (each with its own reason), allowed (the operator's
 * list) - and DELETE /admin-departed/<id> erases a departed account's
 * rows, admin only, one per-member power beside flag/un-flag (#385 rule
 * 4). This card decides no state itself; it renders what the Worker
 * says and offers Remove on every row, since only the Worker's own
 * re-check at erase time knows whether a given row may go.
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
 * (0.9-M3-S13, #433; the bring-back rebuild is 0.9-M3-S30, #452) is no
 * exception: it draws the SPEC, never a count of who picked what.
 *
 * What is left is five cards, one per tab, each reading and writing
 * through the admin session alone: Settings (GET/POST /content), Roles
 * (GET/POST/DELETE /membership, plus /me's adminVia), Fields (GET
 * /admin-fields, PUT/DELETE /admin-fields/<id> - the categorical form
 * builder, #433 against 0.9-M3-S11's landed contract on #419, reading
 * the admin-only overlay 0.9-M3-S25 added on #440 so a retired field or
 * value can be brought back from any session), the Change log (GET
 * /admin-log), and Departed (GET /admin-departed, DELETE
 * /admin-departed/<id> - see the paragraph above). Split like every
 * other page here - the pure half is
 * exported as BinderAdmin and tested in tests/admin-page.test.mjs; the
 * wiring below returns early when there is no document.
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

  // F5 (#433 fix wave): says nothing about a label editor, because
  // fieldBlock draws none for any field. server/worker.js's own
  // refusal for a choicesFrom write says its VALUES are not edited but
  // its label is - true of the route; carrying that same shape onto
  // this page made it a promise about the CARD, which is false, since
  // no field's label is editable here. Not built, because renaming a
  // field's label was never in this ticket's scope (#385 §6-§8 name
  // values, not the field label itself).
  const VALUES_OUTSIDE_REASON = "This field's choices live outside " +
    "the form spec, so they are not edited here.";

  /* ONE BUTTON, THE SMARTER DEFAULT (owner ruling, #385 item (b) and
   * #454 item 20, carried onto this ticket's own scope on #452,
   * comment "Scope grows by two owner UX rulings"): a rename always
   * means "same thing, new word" - this card sends mode "relabel" and
   * nothing else. Retiring a value under the word it had and adding a
   * new one is its own action (the Retire button, never a second
   * rename mode to choose between). RENAME_MODE names the one string
   * every rename sends; RENAME_CONSEQUENCE is the one sentence this
   * card shows before it sends, mirroring server/worker.js's own
   * RENAME_NEEDS_MODE rather than inventing a second account of the
   * same rule. */
  const RENAME_MODE = "relabel";
  const RENAME_CONSEQUENCE = "Entries already saved follow the new word " +
    "instantly.";

  /* DANGEROUS ACTIONS CONFIRM IN PLACE (#454 item 9, applied here to
   * retiring a field and retiring a value) - the button becomes a
   * sentence naming the real consequence, with Yes and Cancel right
   * there, never a same-button double-press that said nothing about
   * what pressing it again would do. */
  function retireValueSentence(label) {
    return "Members stop being offered \"" + label + "\"; entries " +
      "already saved keep it. Retire it?";
  }

  function retireFieldSentence(label) {
    return "It leaves the form for members; entries already saved keep " +
      "every value. Retire the \"" + label + "\" field?";
  }

  /* A short, honest date - the field row's own last write
   * (server/worker.js's markRetired(), 0.9-M3-S25/#440: `retiredAt` is
   * `site_content.updated_at`, never minted here), never stronger than
   * that. This card's own words say last changed rather than retired
   * on, per the reviewer's recommendation on #440 (F3): an admin who
   * edits a retired field's values moves this same stamp, so it is an
   * upper bound on the retirement, not the retirement itself. */
  function shortDate(iso) {
    const parsed = Date.parse(iso);
    return Number.isFinite(parsed)
      ? new Date(parsed).toISOString().slice(0, 10)
      : "an unknown date";
  }

  /*
   * BRING BACK, FROM ANY SESSION (0.9-M3-S30, #452, against 0.9-M3-S25's
   * landed GET /admin-fields on #440). No client-side roster is kept:
   * the admin read now carries a retired field marked `retired: true`
   * with `retiredAt`, and a retired value marked `retired: true` inside
   * its field's `choices` - from any session, not only one this page
   * watched retire something in - so there is nothing left for a
   * client-side memory to remember that the read does not already say.
   * This is the one place a field from that read is reshaped for the
   * card to draw; `retiredAt` reads FIELD-level only, because that is
   * the only level the stored row has a stamp for - a value retired
   * inside a field that is still active shares that field's row and
   * carries no stamp of its own (server/worker.js's offeredValues()
   * never puts one on a value), so a retired value alone shows with no
   * date rather than one invented here.
   */
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
   *
   * Reused by departedName() below (0.9-M3-S34, #458): the same "shorten
   * a hex account id for display" fact, one home rather than two.
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
  /* Departed (S15's Worker, #420; #385 rule 4 - the one per-member power */
  /* beside flag/un-flag; #454 items 8, 9, 10, 13, 20).                   */

  /* #385 rule 1 (never a handle, never a numeric id) and item 13 (the
   * label from membership where one exists, else the short id): GET
   * /admin-departed sends a `label` straight off `membership` when a
   * row is there, and null otherwise. */
  function departedName(entry) {
    const label = entry && typeof entry.label === "string"
      ? entry.label.trim() : "";
    return label || shortAccountId(entry && entry.accountId);
  }

  /* Item 9's own shape ("the button becomes a sentence... Yes/Cancel"),
   * with no count: the landed Worker offers no dry-run answer for the
   * erase (server/worker.js's DELETE /admin-departed/<id> has no query
   * param and no separate route for one), so this names the four row
   * classes eraseAccount() actually deletes instead of a number - the
   * ticket's own fallback for "if the route offers no dry answer". */
  function eraseDepartedSentence(name) {
    return "This removes the submissions, directory, membership and " +
      "sessions rows for " + name + ". Remove them?";
  }

  const DEPARTED_PAGE_SIZE = 20;
  const DEPARTED_KEYS = ["departed", "unknown", "allowed"];

  /* Item 13 ("newest 20, then more") over ONE list, not three: GET
   * /admin-departed's rows already arrive in the Worker's own order
   * (oldest-stale-first, DEPARTED_LIST_CAP), so this windows how much of
   * what it sent is shown right now, in the ticket's own section order,
   * without reordering or re-deriving anything the Worker did not say. */
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

  /* Item 23 in the owner's own refined words (2026-08-22): "Showing 43
   * (checked 50 of 120)" - the rows on the page, the accounts the route
   * examined, the candidates there were. GET /admin-departed asks the
   * bot about at most its own DEPARTED_LIST_CAP accounts, so a group
   * with more stale rows than that has an answer that stopped short -
   * and the More button above windows what arrived, which is why it can
   * never reach past the cap and why only the Worker's own counts can
   * say so.
   *
   * THE FIRST NUMBER IS NOT THE SECOND, and that is the whole reason
   * the sentence has three of them. The route drops a candidate the bot
   * calls a current member, so fifty examined can be five rows drawn -
   * or none, when every candidate is still a member. `rows` is
   * therefore counted off the three lists the card rendered and is
   * never derived from `cap`; a line printing the cap in that place
   * promises an admin rows that are not on the page.
   *
   * THE OTHER TWO COME OFF THE RESPONSE. A page holding its own copy of
   * the cap would go on printing 50 after the Worker's constant moved,
   * and a page deriving the total from the rows it received would print
   * the cap twice.
   *
   * `rows` IS NOT departedSections()'s `shown` either. That one is the
   * twenty-at-a-time window the More button walks, which is about
   * scrolling; this line is about what the route did not look at, so it
   * counts everything that arrived whether it is revealed yet or not.
   *
   * Numbers or nothing: an answer that carries no counts - one from a
   * Worker without them, or a malformed read - draws no line at all
   * rather than "Showing 3 (checked undefined of NaN)", and a caller
   * that hands over no usable row count gets the same silence, since
   * that number is the one the response cannot supply. */
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
            // A toast, not the inline line, for the Worker's own
            // refusal (0.9-M3-S33 fix wave 1, #457, F7) - the exact
            // reason it gave, verbatim, the same shape the Departed
            // card's own eraseDeparted() already puts in a toast.
            saySettings("", null);
            showToast(refusal.message);
            return;
          }
        } catch (error) {
          button.disabled = false;
          detail(why(error));
          saySettings("", null);
          // #454 item 7 (owner ruling 2026-08-22), DESIGN.md's own
          // words: "The voice is plain and warm" - matches form.js's
          // own "Nothing was sent" for the identical situation (a write
          // that never reached the Worker at all).
          showToast("Nothing was sent — try again.");
          return;
        }
        button.disabled = false;
        field.value = verdict.value;
        if (name === "chart.floor") {
          $("settings-floor-notice").textContent =
            root.BinderAdmin.floorNotice(verdict.value);
        }
        // A brief toast, not an inline status line, for the result of
        // this save (0.9-M3-S33, #454 item 8) - saySettings still
        // carries "Saving…" above; a refusal now goes to the toast too
        // (fix wave 1, #457, F7), matching the Fields card's own split
        // (see the toast's own comment, below this card).
        saySettings("", null);
        showToast("Saved.");
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

    // `where` is the informational default (sayRoles, the card's own
    // inline status line) for readMembership's own load failure; the
    // Roles card's two ACTIONS (add, remove) pass showToast instead
    // (0.9-M3-S33 fix wave 1, #457, F7) - the same signed-out/refused
    // split either way, only where the "show" branch says it changes.
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

    /*
     * The member picker's own options (owner ruling 2026-08-24: pick a
     * person, never type a Telegram id). Everyone who has signed in,
     * newest first, as GET /admin-directory sends them - this reorders
     * nothing and shows what it was given.
     *
     * The option's VALUE is the account id and its TEXT is the handle,
     * so the numeric id is nowhere on the page: the Worker unseals a
     * handle and a display name for this list and leaves the number
     * sealed, which is the whole point of the ruling that asked for
     * the picker.
     *
     * A failure leaves the select saying so rather than empty. An
     * empty dropdown is indistinguishable from a group with no members
     * yet, and the two want opposite things from the admin.
     */
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
      // The picked member's account id, not a hand-typed number (owner
      // ruling 2026-08-24) - loadDirectory() below puts the options
      // there, and each option's value is the account id the
      // membership table keys on.
      const accountId = $("member-account").value;
      const rawLabel = $("member-label").value;

      if (!accountId || !rawLabel.trim()) {
        sayRoles("Choose a member and give them a name you will " +
          "recognize.", "bad");
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
            accountId: accountId,
            label: label,
          }),
        });
        if (!response.ok) {
          $("member-add").disabled = false;
          // The Worker's own refusal reason, verbatim, in a toast
          // (0.9-M3-S33 fix wave 1, #457, F7) - handleRefusal still
          // ends the session inline for the signed-out case.
          handleRefusal(response.status, await refusalBody(response),
            showToast);
          return;
        }
      } catch (error) {
        $("member-add").disabled = false;
        detail(why(error));
        sayRoles("", null);
        // #454 item 7, DESIGN.md's own words: "The voice is plain and
        // warm" - see the Settings save catch above for the full
        // reasoning; same situation, same reworded text.
        showToast("Nothing was sent — try again.");
        return;
      }

      $("member-account").value = "";
      $("member-add").disabled = false;
      await readMembership();
      // A brief toast for the result, not an inline line (0.9-M3-S33,
      // #454 item 8) - see the toast's own comment, below this card.
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
          // The Worker's own refusal reason, verbatim, in a toast
          // (0.9-M3-S33 fix wave 1, #457, F7) - same shape as add's own
          // refusal, above.
          const left = handleRefusal(response.status,
            await refusalBody(response), showToast);
          if (!left) await readMembership();
          return;
        }
      } catch (error) {
        button.disabled = false;
        detail(why(error));
        sayRoles("", null);
        // #454 item 7, DESIGN.md's own words: "The voice is plain and
        // warm" - matches form.js's own "Nothing was stored" for the
        // same never-reached-the-Worker situation.
        showToast("Nothing was removed — try again.");
        return;
      }

      await readMembership();
      // A brief toast for the result, not an inline line (0.9-M3-S33,
      // #454 item 8) - see the toast's own comment, below this card.
      sayRoles("", null);
      showToast("Removed.");
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
    /* Fields (#433; the bring-back rebuild is 0.9-M3-S30, #452).     */

    // The live admin-fields read (GET /admin-fields, 0.9-M3-S25/#440) -
    // what is retired is already IN it, marked, from any session, so
    // there is no roster to keep beside it any more. Reset on idle
    // sign-out (clearAdminData, below), the same as every other cache
    // this page keeps.
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

    // THE CONTAINER-KEY TRANSLATION THIS TICKET OWES (F7, 0.9-M3-S25's
    // review on #440, comment 5377697322 - ruled into this ticket's
    // scope by Prime's ruling comment 5378228358): GET /admin-fields
    // names a field's list `choices`; PUT /admin-fields/<id> reads the
    // same list under `values`, and the field's own id is the URL
    // segment, never a body key. The VALUES THEMSELVES need no further
    // rename any more - 0.9-M3-S25's fix wave already spells each one
    // {id, label, retired}, the write's own shape - so renaming the
    // CONTAINER is the whole of what is left, done at this ONE place:
    // every write below reads a field's current values through here,
    // never through `.choices` directly, so a write body built from the
    // read's own field object (`{name, kind, label, choices, ...}`, the
    // untranslated echo F7 found silently doing nothing) cannot happen
    // by accident - tests/admin-page.test.mjs's "untranslated echo" arm
    // drives the hazard this avoids, and the mutation battery arms this
    // function's own use at every call site.
    function fieldWriteValues(fieldId, includeRetired) {
      const fields = (currentSpec && currentSpec.fields) || [];
      const field = fields.filter((f) => f && f.name === fieldId)[0];
      const choices = field && Array.isArray(field.choices)
        ? field.choices : [];
      return choices
        .filter((v) => includeRetired || v.retired !== true)
        .map((v) => ({ id: v.id, label: v.label }));
    }

    // EVERY value the read shows for this field, active and already-
    // retired alike, in the read's own order, each carrying its own
    // `retired` marker (F1, 0.9-M3-S30 fix wave 1, #452, review comment
    // 5379370482). fieldWriteValues() above drops that marker on
    // purpose - every caller of it either wants actives only or is
    // about to set the marker itself - but retiring and un-retiring
    // need to hand the WHOLE list straight back with one marker
    // flipped, because server/worker.js's mergeValues() builds its
    // output in REQUEST order and appends anything the request left
    // out, retired, past everything the request DID list. A value
    // this function omits is a value that function moves.
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

    // The write went through but the read that was meant to confirm it
    // failed - F4, #433 fix wave. The card still shows whatever the
    // LAST successful read drew, which is now stale, and the point of
    // this sentence is to say so rather than let the write's own
    // successMessage ("Added.", "Retired." …) print over the silence.
    const STALE_AFTER_WRITE = "Saved, but the list could not be read " +
      "back afterward - what is shown below may be out of date.";

    // Every field/value write on this card is: send, re-read GET
    // /admin-fields so what is shown is what is stored (ticket item 4),
    // say what happened. One function so no call site invents its own
    // order of those three steps. Returns whether the WRITE itself was
    // accepted (true/false) - never the re-read's own outcome - so a
    // caller like addValue's click handler (F2/F3, #433 fix wave) knows
    // whether to clear what the admin typed: only a write the Worker
    // actually accepted earns that, a refusal keeps it exactly as the
    // Roles card's own "Add" already does.
    async function sendFieldWrite(request, successMessage) {
      sayFields("Saving…", null);
      let response;
      try {
        response = await request();
      } catch (error) {
        detail(why(error));
        // #454 item 7, DESIGN.md's own words: "The voice is plain and
        // warm" - matches form.js's own "Nothing was sent" for the
        // same never-reached-the-Worker situation. This one stays
        // inline (sayFields), not a toast - the Fields card's own
        // refusal shape, untouched by this slice.
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
        // Feedback after an action is a brief toast, not an inline
        // status line (#454 item 8) - sayFields still carries the
        // "Saving…" state above and a refusal below, since both of
        // those need to stay put and readable rather than fade.
        sayFields("", null);
        showToast(successMessage);
        loadLog();
      } else if (reread === "failed") {
        sayFields(STALE_AFTER_WRITE, "bad");
      }
      // reread === "signed-out": loadFields already said so and is
      // navigating away - nothing here should say anything more.
      return true;
    }

    function retireField(id) {
      return sendFieldWrite(() => deleteField(id), "Retired.");
    }

    // Un-retiring a FIELD sends no `values` - handleWriteField then
    // keeps currentValues(shipped, held), which is exactly what the
    // field held at the moment it was retired (server/worker.js,
    // handleRetireField). Reachable for any field the admin read
    // offers back marked retired, from any session (0.9-M3-S25, #440).
    function unretireField(id) {
      return sendFieldWrite(() => putField(id, { retired: false }),
        "Restored.");
    }

    // RETIRING KEEPS THE VALUE IN ITS OWN PLACE (F1, 0.9-M3-S30 fix
    // wave 1, #452, review comment 5379370482). The request is the
    // read's whole list, unchanged, with only this one value's marker
    // turned on - never the old shape (the actives alone, the target
    // left out), which handed mergeValues() a request with a hole in
    // it and let the Worker's own "an omitted value is retired, past
    // everything the request DID list" rule decide where the value
    // landed. That rule is real (0.9-M3-S25's own fields-overlay suite
    // relies on it for the plain "omit to retire" case) but it answers
    // a question this function should never be asking: bring-back could
    // only ever hand back a place this function had already thrown
    // away.
    function retireValue(fieldId, valueId) {
      const values = fieldWriteAllValues(fieldId).map((v) =>
        v.id === valueId ? { id: v.id, label: v.label, retired: true } : v);
      return sendFieldWrite(() => putField(fieldId, { values: values }),
        "Retired.");
    }

    // The value's id and label come from the admin read itself (GET
    // /admin-fields, 0.9-M3-S25/#440) - never invented, never
    // re-minted, so the entries members already saved under that id
    // are the ones this brings back, from any session that retired it.
    // BROUGHT BACK IN THE PLACE IT HELD (F1, fix wave 1): the request
    // is the read's whole list, unchanged, with only this one value's
    // marker turned off - so a value retireValue() above kept in place
    // is restored to that same place, the property 0.9-M3-S25's own
    // "in the place it held" arm (tests/fields-overlay.test.mjs) checks
    // by constructing its own request the same way.
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

    /* -- Drawing. -- */

    // The in-place confirm every dangerous action on this card uses
    // (#454 item 9): `trigger`'s click reveals a hidden sentence naming
    // the real consequence, plus Yes and Cancel right there - Yes runs
    // `onYes`, Cancel only hides the block again. One function so
    // retire-a-field and retire-a-value share one shape rather than two
    // near-identical ones.
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

    // F1 (#433 fix wave): `wrap-row-value` belongs on the id, not the
    // label. theme.css's own comment on ".row.wrap-row > .wrap-row-value"
    // says what that class is for - "a value nobody bounded to a single
    // word" - and that is the id, not the label: FIELD_ID_PATTERN never
    // allows a space (lowercase letters, digits, hyphens, underscores
    // only), so a field id near its 48-character maximum is one
    // unbroken run with no natural break point, exactly like the
    // 64-hex account id the comment names. A label is admin-typed
    // prose that almost always wraps on its own spaces. Putting the id
    // in the flex:1 slot (rather than in plain `.hint`, which does not
    // grow to claim the row's slack) is what let the id spill: `.hint`
    // took its own untouched max-content width, and the flex:1 label
    // beside it - basis 0% - was left with nothing, rendering 0px wide.
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

    // One value's own row plus its buttons plus its (hidden until
    // asked for) rename mini-form. `position` is this value's index
    // and the count of OFFERED values, among offered ones only - "Move
    // up"/"Move down" reorder what is actually sent, so a retired
    // value (already excluded from that list) never takes a slot in
    // it.
    function valueBlock(view, value, position) {
      const block = document.createElement("div");
      block.className = "stack-tight";

      // Same swap as fieldHeaderRow, same reason (F1, #433 fix wave):
      // the id is the one string here with no natural break point.
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

      // ONE BUTTON, THE SMARTER DEFAULT (#385/#454 item 20): the form
      // asks for the new word and sends - there is no mode to choose
      // between any more, RENAME_MODE is always what this page sends.
      // Retiring a value under the word it had is the Retire button
      // above, its own action.
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
        // "Last changed", never "retired on" - the reviewer's own
        // wording recommendation on #440 (F3): the stamp is the row's
        // last write, an honest upper bound on the retirement rather
        // than the retirement instant itself.
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
        // F2/F3 (#433 fix wave): clear ONLY on a write the Worker
        // actually accepted - the Roles card's own "Add" precedent
        // (member-account, the picker that replaced the typed
        // Telegram id). The input surviving a refusal reopens a
        // double-click race a synchronous clear would otherwise have
        // closed by accident, so the button stays disabled for the
        // write's whole duration: a second click before the first
        // write lands would mint the same value twice under two ids.
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
      for (const field of split.choice) {
        list.appendChild(fieldBlock(fieldView(field)));
      }
    }

    // Returns "ok", "failed" or "signed-out" rather than nothing (F4,
    // #433 fix wave) - sendFieldWrite calls this to re-read after a
    // write, and needs to tell a real refresh apart from a read that
    // failed, so it never prints the write's own success message over
    // a status line this function already set to something truer.
    //
    // GET /admin-fields, NOT /spec (0.9-M3-S30, #452, against 0.9-M3-S25
    // on #440): the admin-only read that answers with what is retired
    // still in it, marked - the whole reason this card no longer needs
    // a session-scoped memory of anything a member-facing read hides.
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

    // F2/F3 (#433 fix wave): same clear-on-success-only shape as the
    // "Add value" handler above, same reason - a refused add-field used
    // to throw away an id, a label and a whole pasted value list at
    // once, the worst case of the two.
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

    /* ------------------------------------------------------------ */
    /* Change log.                                                   */

    function sayLog(message, tone) {
      UI.setStatus($("log-status"), message, tone);
    }

    /*
     * #454 item 13 (owner ruling, 2026-08-22), DESIGN.md's own words:
     * "A long list ... shows the newest 20 with a 'more' button." The
     * same LOG_PAGE_SIZE/logRevealed/More shape Departed's own
     * DEPARTED_PAGE_SIZE/departedRevealed already uses below - one
     * pattern, not two, for the one property both lists need. GET
     * /admin-log already answers newest-first (server/worker.js's own
     * "ORDER BY at DESC, id DESC"), so windowing here never reorders
     * anything; it only decides how much of an already-sorted list to
     * show.
     */
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
      /*
       * A REAL TABLE (owner, walking the sit 2026-08-24). This was three
       * spans in a flex row per entry, which read as a wall: nothing
       * lined up down the page, so an admin scanning for "when did that
       * change" had to re-find the date column on every line. Three
       * columns of the same three things are a table, and saying so in
       * markup is what gives a screen reader the header for each cell
       * as it reads across.
       *
       * The scroller around it is not decoration: this table's own
       * contract data is exactly where the overflow lives (#416, F1) -
       * a 64-hex account id, a URL a member pasted into the welcome
       * text, up to 200 characters of summary - and the admin page is
       * checked at 375px. A table that cannot shrink past its widest
       * cell scrolls inside this box rather than pushing the page
       * sideways.
       */
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
        // Reset the window on every fresh load - the same rule
        // loadDeparted() holds departedRevealed to below, so a member
        // who pressed More, then re-opened this tab, sees the newest 20
        // again rather than however far they had scrolled last time.
        logRevealed = LOG_PAGE_SIZE;
        drawLog();
        sayLog("", null);
      } catch (error) {
        detail(why(error));
        sayLog("The change log could not be read.", "bad");
      }
    }

    /* ------------------------------------------------------------ */
    /* Departed. THE PAGE RENDERS WHAT THE WORKER STATES AND DECIDES    */
    /* NOTHING ITSELF: Remove is offered on every row regardless of      */
    /* section, because handleEraseDeparted() re-asks the bot itself and */
    /* is the only source of truth for whether a row may be erased right */
    /* now - a button withheld here on the strength of a list that may   */
    /* be an hour stale would be this page deciding a state.             */

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
      /* The footer is the last line of the card in EVERY state,
       * including the empty one: a group whose fifty candidates are all
       * still members shows no rows at all, and the empty sentence on
       * its own would read as the whole group checked and cleared -
       * "Showing 0 (checked 50 of 120)" is exactly the case the three
       * numbers exist for.
       *
       * view.total is the count of rows that ARRIVED, not the twenty
       * this render revealed, which is the number the owner's first
       * word is about. */
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

    // The result is a toast either way (#454 item 8), never the inline
    // status line - refusalBody's own null-on-unparseable fallback is
    // reused here exactly as it is for every other card's refusal read.
    async function eraseDeparted(accountId) {
      let response;
      try {
        response = await fetch(
          config.endpoint + "/admin-departed/" + encodeURIComponent(accountId),
          { method: "DELETE", headers: root.BinderSession.authorization() });
      } catch (error) {
        detail(why(error));
        // #454 item 7, DESIGN.md's own words: "The voice is plain and
        // warm" - matches form.js's own "Nothing was sent" for the
        // same never-reached-the-Worker situation.
        showToast("Nothing was sent — try again.");
        return;
      }
      if (sessionRefused(response, showToast)) return;
      const payload = await refusalBody(response);
      // The Worker's own reason wins when it sent one; the fallback
      // below is reworded the same way as every other generic-catch
      // fallback on this page (#454 item 7).
      showToast(response.ok ? "Removed." :
        (payload && payload.error) || "Nothing was removed — try again.");
      await loadDeparted();
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

    /* ------------------------------------------------------------ */
    /* Tabs (#385 item (b) and #454 item 20): one area on screen at a   */
    /* time. Click only, the same hand-wired shape apps/web/charts.js's */
    /* own picture toggle already uses rather than a shared component - */
    /* the [role="tab"]/[role="tablist"] family and the selected-mark   */
    /* rule are theme.css's own, built for exactly this. The ~150ms     */
    /* fade on the panel that appears is UI.fadeIn() (0.9-M3-S33, #457, */
    /* lifted from this page's own first build to apps/web/ui.js, whose */
    /* own comment on fadeIn() carries the mechanism), using a          */
    /* transition rather than a refused @keyframes (#273); the site's   */
    /* blanket prefers-reduced-motion rule already collapses it to      */
    /* nothing.                                                         */

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
    // Established here rather than trusted to the static markup alone,
    // so the shipped page and this line agree by decision rather than
    // by coincidence.
    selectTab("settings-card");

    /* ------------------------------------------------------------ */
    /* The toast (#454 item 8): apps/web/ui.js's BinderUI.showToast(),  */
    /* not a second copy of it. This page minted the one element        */
    /* (#toast) and the one function (0.9-M3-S30, #452); 0.9-M3-S33     */
    /* (#457) lifted the function itself to ui.js so every page could   */
    /* use it with no second copy, and aliases it back to the name      */
    /* every call site on this page already used rather than touching   */
    /* each of them. Used for this card's own write confirmations       */
    /* (Added./Retired./Restored./Renamed./Reordered.), for the         */
    /* Departed card's own erase result, success or the Worker's        */
    /* refusal verbatim (#458), and - since 0.9-M3-S33's fix wave 1,    */
    /* #457, F7 - for Settings' and Roles' own save/add/remove results  */
    /* too (both success and refusal, the Worker's reason verbatim the  */
    /* same way Departed's already was): loading states ("Saving…",     */
    /* "Adding…", "Removing…") and                                      */
    /* CLIENT validation caught before a request is even sent stay on   */
    /* the inline status line beside the control, since a pending state */
    /* has nothing to hand a toast yet and a field-level validation note */
    /* is #454 items 11-12's concern, not item 8's - what moved to the  */
    /* toast is the answer a request actually came back with.           */
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
