/*
 * The export page. The only place the submissions exist as plaintext.
 *
 * Two secrets meet here and they keep different company: the admin
 * session fetches the ciphertext and dies with the tab, and the private
 * key opens it and stays on the device. The session lives only in
 * sessionStorage because it is revocable authority; the key lives in
 * IndexedDB as a non-extractable CryptoKey because it is not authority
 * at all, and the note on KEY_DB below carries that reasoning in full.
 * Neither is ever sent anywhere. See DESIGN.md, "Key custody".
 *
 * Split like form.js, and for the same reason. The pure half - turning
 * a decrypted record into a CSV row, and rows into a file - is exported
 * as BinderAdmin and tested in dev/admin.test.mjs. The CSV *is* the
 * deliverable here; a quoting bug that shifts one column produces a
 * file that opens cleanly in a spreadsheet and is quietly wrong, which
 * is the same failure mode the conversion tests exist for.
 *
 * The wiring below returns early when there is no document.
 */
(function (root) {
  "use strict";

  /*
   * One column per thing worth having, flattened. The nesting that
   * makes sense inside a record does not survive a spreadsheet, and a
   * keyholder sorting by weight should not have to parse JSON.
   *
   * Both unit systems are here because both are stored - see DESIGN.md,
   * "Why every row carries both unit systems". `entered_*` is what the
   * submitter actually typed, which is the column to trust when a
   * rounded value looks odd.
   *
   * `account_id` sits beside `telegram` because they are two different
   * kinds of thing and the file has to let a reader tell them apart:
   * the id is the identity the Worker set from a verified sign-in, the
   * handle is a label the member's browser wrote. Whoever deduplicates
   * this file in a spreadsheet needs the one the charts group on, or
   * they will group on the handle and get a different answer from the
   * dashboard about the same rows. The JSON download serializes the
   * whole entry anyway, so leaving the column out would only make the
   * two files disagree.
   */
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

  /* Missing rather than guessed. A record written by an older version of
   * the form may not carry every field, and an absent value is honest
   * where a zero would be a claim. */
  function at(object, path) {
    let value = object;
    for (const step of path) {
      if (value === null || value === undefined) return null;
      value = value[step];
    }
    return value === null || value === undefined ? null : value;
  }

  /*
   * One decrypted row, flattened, with the names the rest of this page
   * uses. Both consumers read this and only this: the CSV writer below
   * and dashboard.js.
   *
   * That is the point of it existing. Two independent readings of a
   * record would be two chances to disagree, and the disagreement that
   * matters - the table saying one thing and the chart another - is
   * exactly the kind nobody notices, because each looks right on its
   * own.
   *
   * Which half a field is read from is the load-bearing part. `id`,
   * `account_id` and `received_at` come off the submission - they are
   * the Worker's own facts about the row. Everything else comes out of
   * the decrypted record, which is whatever the submitter's browser
   * sealed. So an `accountId` written inside a record is ignored here,
   * and it has to be: DESIGN.md, "The identifier is the whole problem"
   * makes the id the one identity on a row a client cannot influence,
   * and reading it from the blob would hand that back to the client and
   * let one member file rows into another member's history.
   */
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

  /* null is an absent value everywhere else; in a CSV it is an empty
   * cell, and the string "null" would be a lie in a spreadsheet. */
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

  /*
   * A cell that a spreadsheet cannot mistake for a formula.
   *
   * This file is going to be opened in Excel, Numbers or Sheets, and a
   * cell beginning =, +, - or @ is executed there rather than shown.
   * Everything in a record went through the form's validation, so
   * nothing legitimate starts with those characters - but the whole
   * design assumes the submitter's browser is the submitter's, and a
   * record is whatever arrived. The one honest false positive would be
   * a negative number, and no field here can be negative.
   *
   * A leading apostrophe is the conventional defusing: spreadsheets
   * treat the rest as text and do not display it.
   */
  function csvCell(value) {
    let text = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    if (/[",\n\r]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  /*
   * CRLF line endings, per RFC 4180. Excel on Windows is the likeliest
   * thing to open this, and it is the one that cares.
   */
  function toCsv(rows) {
    const lines = [COLUMNS.join(",")];
    for (const row of rows) lines.push(row.map(csvCell).join(","));
    return lines.join("\r\n") + "\r\n";
  }

  /*
   * The same data as JSON, for anything that is not a spreadsheet.
   *
   * It keeps the shape the CSV has to flatten, has no quoting rules to
   * get wrong, and does not need the formula guard - nothing executes a
   * string in a JSON file. The CSV remains the default because the
   * likeliest thing anyone does with this is open it.
   */
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

  /*
   * Whether a key this device kept is the key this device should use.
   *
   * What comes back out of IndexedDB is a `CryptoKey` object rather
   * than a JWK or bytes, so there are only two properties worth
   * trusting about it and both are checked: it is a private key, and it
   * cannot be exported. `importPrivateKey` in crypto.js is the only
   * thing here that mints one, and it mints them non-extractable - so a
   * stored key that *can* be exported was not written by this page, and
   * accepting it would hand an exportable key to the one page that also
   * holds every submission in the clear.
   *
   * The record names which key it is by carrying the public half, and
   * the comparison against `config.js` is the whole scope rule. Origin
   * separation already keeps the development and production arms apart
   * - they are different hosts, so different stores - which leaves
   * rotation as the case this catches: a `config.js` naming a new key
   * means the stored private half is the previous one, and it opens
   * everything written before the rotation and nothing since. That is
   * an export that looks complete and is not, so it is refused out
   * loud rather than used.
   *
   * The shape is the prefill's, for the prefill's reason (#65): one
   * accept and one exit, so every rejection erases and the guard
   * somebody adds next cannot silently keep what it refused. Nothing
   * stored is not a rejection - it is the ordinary state of a device
   * that has never done an export, so it erases nothing and says
   * nothing. Treating it as one would mean a delete that matches
   * nothing, under a message announcing that something was removed.
   */
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

  /*
   * What the keyholder is told about how long the key will be there,
   * which is the half of this that can only be got wrong in words.
   *
   * `navigator.storage.persist()` is a request rather than a setting:
   * Chrome and Safari answer it from their own record of how the site
   * is used and show nothing, Firefox asks. Granted, the origin is
   * exempt from eviction under storage pressure and from the seven-day
   * rule WebKit applies to origins without it. Refused is not a
   * failure - it is the ordinary answer for a site somebody has just
   * started using, and the copy has to say so, because a keyholder who
   * reads "stored" as "safe" is the one who finds out otherwise on the
   * day the file is not in reach. The measurements are in #85's spike.
   */
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

  /* ---------------------------------------------------------------- */
  /* The membership lists (#69).                                      */

  /*
   * The two lists this page draws, in the order it draws them.
   *
   * These are `MEMBERSHIP_ROLES` in server/worker.js, and the page holds
   * its own copy rather than learning them from a response, because the
   * page has to be able to draw an EMPTY admin list. A page that
   * discovered its sections from the rows it was sent would render
   * nothing at all on the day the admin list is empty - which is the one
   * state that most needs a screen, since it is the lockout #69 opens
   * with.
   *
   * The order is not alphabetical and is not arbitrary: `admin` is the
   * list this page manages outright, and `always_allow` is the one it
   * can only add to. The consequential list goes first.
   */
  const MEMBERSHIP_ROLES = Object.freeze(["admin", "always_allow"]);

  /*
   * What `GET /membership` answered, sorted into what the page draws.
   *
   * FOUR OUTPUTS RATHER THAN TWO, and the two extra ones are the reason
   * this is a function with a suite rather than a loop inside the
   * renderer.
   *
   * `unknown` is the else-branch of the role test, and it is the arm
   * that stops this reader failing open. Every row in `membership` has
   * already passed the Worker's own `grantsAnything()` - the same
   * predicate its authority read uses - so a row here GRANTS whatever
   * its role says. A renderer that sorted rows into `admin`,
   * `always_allow` and silence would hide a live grant from the one
   * screen that exists to show them, and the gate would stay green
   * because nothing counts rows that were never drawn. A membership test
   * with no else is a silent skip; what this one would skip is
   * authority.
   *
   * `absent` is the difference between a field that came back empty and
   * one that did not come back at all, and it is not a nicety.
   * `secretOnly` reading empty is the flip's go-signal (OPERATIONS.md,
   * "Making someone an admin"), so a page that renders a missing field
   * as an empty one prints that go-signal from a Worker that never gave
   * it. Absent is never empty anywhere in this file.
   *
   * `dropped` counts entries that were not rows at all. They cannot be
   * drawn - there is nothing to draw - so the count is what keeps them
   * from being silently discarded.
   */
  const MEMBERSHIP_FIELDS = ["membership", "malformed", "secretOnly"];

  /* A row this page can draw: an object carrying an account id it can
   * put on a button. Anything else is counted rather than drawn, because
   * there is nothing to draw. */
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
      // The else, said out loud. See the note above this function.
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
   *
   * Three states and not two. Empty is the go-signal; non-empty is a
   * backfill that is not finished; ABSENT is a Worker that did not
   * answer the question, and saying "the backfill is complete" there
   * would be inventing the one fact this page exists to report.
   *
   * The ids themselves are HMACs and the sentence says so. An admin may
   * see them - they are the same un-invertible values sitting in the
   * rows above, going to a caller who may read every one of those rows
   * anyway - but a reader who thinks a 64-character hex string is
   * something they can look up will go looking, so the copy closes that
   * door explicitly.
   */
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

  /*
   * What the page does about a refusal, and what it says.
   *
   * One function because the three membership calls must not each invent
   * their own answer to the same three questions, and because the
   * answers are not interchangeable:
   *
   *   401 - the session is gone. Discard it and leave. This page holds
   *         every submission in the clear, so a session the Worker no
   *         longer accepts is a tab that should not stay open on it.
   *   409 - the Worker refused a removal that would have emptied the
   *         admin list. NOTHING was removed, so the page must re-read
   *         rather than drop a row locally: a page that removed the row
   *         from its own list first would show the lockout it was just
   *         prevented from causing.
   *   else - show what the Worker said. Its `{error}` is written for the
   *         admin who provoked it and is more specific than anything
   *         this side could guess.
   */
  function refusalFor(status, payload) {
    const said = payload && typeof payload === "object" &&
      typeof payload.error === "string" && payload.error.trim()
      ? payload.error.trim()
      : "";

    if (status === 401) {
      return {
        action: "signed-out",
        message: "The admin session was not accepted, so it has been " +
          "discarded. Sign in again.",
      };
    }
    if (status === 409) {
      return {
        action: "reread",
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

  /*
   * What to say after a row is added, which is the half of this that can
   * only be got wrong in words.
   *
   * ADDING AN ADMIN ROW DOES NOTHING FOR A SESSION THAT ALREADY EXISTS.
   * `is_admin` is minted at sign-in and the per-request re-read can only
   * take adminness away (server/schema.sql, the `sessions` block), so
   * the new admin sees no change until they sign out and in again. An
   * admin who is not told that reads the unchanged screen as the add
   * having failed, and adds it again.
   *
   * For `always_allow` the sentence that has to be said is the other
   * one: this row is an ADDITION beside ALWAYS_ALLOW_TELEGRAM_IDS, which
   * is checked first and by numeric id and is not managed from here - so
   * removing this row later is not a revocation.
   */
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

  /*
   * A removal button's text, on each of its two presses.
   *
   * The removal is two presses of the same button rather than one, and
   * the second press names the row. This is a courtesy and NOT a guard:
   * the thing that actually stops the admin list being emptied is the
   * Worker's last-admin subquery, which is inside the DELETE and cannot
   * be raced. A browser-side confirmation protects nothing - anything
   * that can reach this page can issue the request without it - so it is
   * built as what it is: a second look before an irreversible act, in
   * the page's own components rather than in a platform dialog.
   *
   * The label rather than the account id, because the account id is a
   * 64-character HMAC and nobody can tell two of them apart at a glance.
   * A row with no readable label falls back to naming nothing rather
   * than to naming the hex, since a confirmation that reads as noise is
   * a confirmation nobody reads.
   */
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

  // Frozen because admin.html is where decrypt output becomes a CSV: an
  // export a later script can rewrite is a `toCsv` that can be swapped
  // for one that keeps a copy, on the one page in this site that holds
  // every submitter's plaintext at once.
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
  });

  /* ---------------------------------------------------------------- */
  /* The wiring. Everything above this line runs under Node.          */

  if (typeof document === "undefined") return;

  const UI = root.BinderUI;
  const $ = UI.byId;
  const show = UI.show;

  /*
   * Where the keyholder's key lives between visits.
   *
   * The stored value is the `CryptoKey` object itself, structure-cloned
   * into IndexedDB - never a JWK, never bytes, nothing this page could
   * write down again. crypto.js imports the private half
   * non-extractable, so what comes back can derive and cannot be
   * exported by anything that gets script execution here. That is
   * strictly better than the textarea it replaces, where the same key
   * sat as a plain string for the life of the tab.
   *
   * NOT sessionStorage, and the distinction is a reason rather than a
   * convenience. Session material is authority the Worker issued and
   * can revoke, which is why DESIGN.md bounds it to the tab and why
   * signing out destroys it. This key is not authority: nothing issued
   * it, nothing can revoke it, it opens rows that are already stored,
   * and it is the keyholder's own property rather than the site's. So
   * the session rules have nothing to say about it, and moving it under
   * them would mean storing exportable bytes - the one property this
   * whole design exists to avoid. The levers that end it are Clear and
   * clearing site data; the recovery root is the offline file.
   *
   * Its own database rather than a store inside a shared one, because
   * two features sharing a database have to agree on a version number
   * to add a store, and the member device key (#85) is a separate
   * feature on a separate page with a separate lifetime.
   */
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

  // close() waits for outstanding transactions before it takes effect,
  // so a write resolved here is still committed after this returns.
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

  /* Same guard as form.js: a throw during setup would leave a page that
   * looks fine and a button that does nothing. */
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

    // session.js starts the redirect for a signed-out visitor. Hide the
    // tool as well in case navigation is delayed; none of its wiring or
    // requests should run without an authenticated admin in this tab.
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

    // Everything decrypted so far, held only for as long as this tab is
    // open. Clear discards it and the key; the admin session remains the
    // tab-scoped credential shared by the site's member pages.
    let entries = [];
    let rows = [];
    let csv = "";
    let json = "";
    let xlsx = null;
    let urls = [];

    // The key this device kept, if it kept one, and what to tell the
    // keyholder about having kept it. Unlike everything above, the
    // first of these outlives the tab - see the note on KEY_DB.
    let storedKey = null;
    let kept = "";

    function say(message, tone) {
      UI.setStatus($("status"), message, tone);
    }

    // The last thing said in a click, which is where the storage
    // sentence has to go: every message before it is replaced within
    // the same click, and a disclosure nobody is left looking at is not
    // a disclosure.
    function finish(message, tone) {
      // The stop is added rather than assumed. This is the one line that
      // carries two facts at once, and the message in front is often a
      // browser's own error text, which does not reliably end in one -
      // without this the storage sentence runs into whatever the
      // platform said and both read as one garbled claim.
      const text = message.trim();
      say(kept ? text + (/[.!?]$/.test(text) ? " " : ". ") + kept : message,
        tone);
      kept = "";
    }

    // Object URLs pin their blob in memory until revoked, and the blob
    // here is everyone's data in the clear. Re-running the export
    // should not leave the previous one alive.
    function revoke() {
      for (const url of urls) URL.revokeObjectURL(url);
      urls = [];
    }

    // `content` is a string for the text formats and a Uint8Array for
    // the spreadsheet. Blob takes either, which is the whole reason
    // this needed no other change to gain a binary download.
    function offer(id, content, type, extension) {
      const url = URL.createObjectURL(new Blob([content], { type: type }));
      urls.push(url);
      const link = $(id);
      link.href = url;
      link.download = fileName(Date.now(), extension);
    }

    // Every consumer is rebuilt from entries. Keeping this in one place is
    // what makes deletion remove a row from the downloads and a later
    // published snapshot as well as from the visible table.
    function rebuildDerived() {
      rows = entries.map(rowFor);
      csv = toCsv(rows);
      json = toJson(entries);
      // The rows as they are, not as the CSV writes them: csvCell's
      // formula guard must not reach this file. A cell typed as a
      // string in a spreadsheet is a string, so the leading apostrophe
      // that stops Excel executing a CSV cell would just be an
      // apostrophe here. See apps/web/xlsx.js.
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

    /*
     * Reading the key file from disk rather than making them paste it.
     * tools/keygen.html saves a file; opening it in an editor to copy
     * the contents is a step where the wrong half gets copied. Nothing
     * leaves the page - FileReader is local.
     */
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

    /*
     * Clear means two things now and has to do both: end this page, and
     * end the key this device kept. OPERATIONS.md names it as a lever in
     * the departure and compromise procedures, which is why the failure
     * to remove is said out loud rather than swallowed - a lever that
     * silently did nothing is worse than no lever, because it gets
     * ticked off a list.
     */
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
        // A browser with no database for this site never kept a key, so
        // there is nothing left behind to warn about. Any other failure
        // is a key still on this machine.
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

    /*
     * Keeping the key, and reporting honestly what keeping it is worth.
     *
     * The persistence request goes first because its answer is part of
     * what the keyholder is told: asking after the write would mean
     * describing durability the browser has not agreed to yet. A refused
     * request is not a failure and does not stop the write - the key is
     * best-effort then, which is the ordinary state and the reason the
     * offline file stays the recovery root.
     */
    async function rememberKey(key) {
      /*
       * Which key this is, established by using it rather than by
       * taking the page's own word for it.
       *
       * The record has to name the key it holds, and a non-extractable
       * CryptoKey cannot be asked what it is - that is the property
       * being bought. What it can do is open something sealed to the
       * public half `config.js` publishes, which asks the same question
       * the one way that cannot be wrong. Writing `config.publicKey`
       * beside whatever was imported would record what this site was
       * configured with rather than which key is in the store, and the
       * two come apart in exactly the case the check exists for.
       *
       * This gates KEEPING the key and never using it. A rotated key
       * still opens every row written before the rotation, and the file
       * is how a keyholder reaches them; refusing it here would take
       * away the recovery path the issue asks to keep.
       */
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
        // Sound only because the probe above proved it: this key is the
        // private half of that public one.
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
        /*
         * Import the key before asking the network for anything. A bad
         * key is the admin's own mistake and can be reported instantly;
         * spending a request first would report it as a failure of the
         * fetch, which is the wrong thing to go and check.
         */
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
        // Nothing to import: this device already holds the key, which is
        // the whole point of holding it.
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
        if (response.status === 401) {
          throw new Error("The admin session was not accepted.");
        }
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

      /*
       * Decrypt one at a time and keep going. crypto.js throws on a row
       * it cannot open, which is right - but stopping the whole export
       * on the first failure is not, because the ordinary cause is a
       * rotated key, where the old rows fail and the new ones are
       * exactly what is wanted. Failures are counted and named instead
       * of being skipped quietly.
       */
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

    /*
     * Which rows the snapshot charts count. Storage is append-only, so
     * "how many people" and "how many entries" are different questions
     * and both are legitimate - one per person answers what the group
     * looks like, every entry answers what was submitted. The toggle
     * costs a redraw and saves an argument.
     */
    function currentBasis() {
      return UI.checkedValue("basis", "people");
    }

    /*
     * Which units the charts read. Imperial unless the radio says
     * otherwise, matching the form's default - and the fallback here
     * agrees with dashboard.js's own, so a missing radio cannot make
     * the two disagree about what "no answer" means.
     *
     * This never reaches the CSV or the JSON. Both of those carry every
     * row in both systems, which is what makes an export readable
     * without this page.
     */
    function currentUnits() {
      return UI.checkedValue("units", root.BinderDashboard.DEFAULT_UNITS);
    }

    /*
     * This page draws a snapshot of its own rows, with the handles
     * left in. That is not a detour - it is what makes Publish a
     * preview rather than a leap of faith: the charts on screen were
     * drawn by the same function, from the same shape of document, as
     * the ones the public page will draw. The only difference between
     * this snapshot and the published one is what `identify` does to
     * the labels and the data-quality panel.
     */
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

    /*
     * What is currently published, and taking it down.
     *
     * Both live outside everything the key gates. Since 2026-08-05 the
     * snapshot read has required a member session; an admin already has
     * one, so checking and unpublishing still need no private key. The
     * moment someone wants a snapshot gone is not the moment to make them
     * find a key file and decrypt the corpus first.
     */
    function sayUnpublish(message, tone) {
      UI.setStatus($("unpublish-status"), message, tone);
    }

    /*
     * The document currently on the public page, or null.
     *
     * It is kept because the next one has to be able to say how far the
     * group's combined weight has moved SINCE it, and a delta measured
     * from anything else is a delta about the reader's clock rather than
     * about the group. Only this page can supply it: the public page
     * holds one document and has nothing to compare it against, and the
     * Worker never parses what it stores.
     *
     * Cleared on 404 and on a failed read, both deliberately. A stale
     * anchor is worse than no anchor - the next publish would measure
     * from a document nobody is looking at any more and print the
     * difference as this month's movement.
     */
    let publishedNow = null;

    async function refreshPublishedState() {
      const state = $("published-state");
      try {
        const response = await fetch(config.endpoint + "/snapshot", {
          headers: root.BinderSession.authorization(),
        });
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
        // Offered anyway. If the check failed because the network is
        // unreliable rather than because nothing is published, hiding
        // the button would remove the way out at the worst moment.
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
        if (response.status === 401) {
          throw new Error("The admin session was not accepted.");
        }
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

    /*
     * What this device already holds, read before the page can be used.
     *
     * Fetch and decrypt waits for the answer rather than racing it: a
     * keyholder who presses it in the moment before this settles would
     * be told to go and find a file they no longer need, and the second
     * press would work, which is the shape of bug that gets reported as
     * "it is flaky".
     */
    async function loadStoredKey() {
      $("run").disabled = true;
      try {
        let record = null;
        try {
          record = await readStoredKey();
        } catch (error) {
          // No database for this site, or one this browser refuses to
          // open. There is no stored key, which is the state this page
          // has always started in.
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

    /* -------------------------------------------------------------- */
    /*
     * The membership lists (#69).
     *
     * Everything here goes through one function that reads
     * `GET /membership` and redraws from the answer. There is no local
     * model of the table and no optimistic update, and that is the whole
     * design rather than laziness: the Worker refuses some removals
     * (the last admin row), silently relabels some adds, and folds case
     * on the ids it matches - so a page keeping its own copy would draw
     * a table the Worker does not have, and the case it would get wrong
     * is the lockout this issue opens with.
     *
     * Read once when the page starts and once after every write. No
     * timer and no keepalive: #91 ends an admin session on idle, and a
     * pane that polled would hold that session open on the one page in
     * this site that shows every submission in the clear.
     */
    function sayMembership(message, tone) {
      UI.setStatus($("membership-status"), message, tone);
    }

    // A row's own line: what it is called, when it arrived, and the way
    // to take it off. The label is somebody's typing and goes on through
    // textContent - see the note on the table renderer above.
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

      /*
       * Two presses, and the second one names the row.
       *
       * This is a second look before an irreversible act, and it is NOT
       * a guard: what actually stops the admin list being emptied is the
       * Worker's subquery inside the DELETE, which cannot be raced by
       * two admins tidying the list at once. Anything that can reach
       * this page can issue the request without pressing anything here.
       *
       * Armed state lives on the button rather than in a variable
       * outside it, so a redraw disarms every button by replacing it -
       * an armed button left over from the previous answer would be one
       * press away from removing a row the admin never looked at.
       */
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
      // The ids themselves, as machine text in a block that scrolls
      // inside itself. An admin may see them - they are the same
      // un-invertible values the rows above already carry - and seeing
      // them is what makes "one remains" checkable against a re-read
      // rather than a number to be trusted. They go nowhere else: no
      // download, no clipboard, no storage.
      $("secret-only-ids").textContent = view.secretOnly.join("\n");
      show($("secret-only-ids"), view.secretOnly.length > 0);

      // Anything the reader could not place. A row here still grants
      // whatever its role says, so it is shown rather than dropped.
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

    /*
     * One refusal handler for all three calls, because they are three
     * different acts and only one of them is "print the message".
     *
     * A 401 ends the tab: this page holds every submission in the clear,
     * and a session the Worker no longer accepts is not one to keep a
     * key and a corpus sitting behind. Returning true means the caller
     * should stop - the page is leaving.
     */
    function handleRefusal(status, payload) {
      const refusal = refusalFor(status, payload);
      sayMembership(refusal.message, "bad");
      if (refusal.action !== "signed-out") return false;
      root.BinderSession.clear();
      if (root.location && typeof root.location.replace === "function") {
        root.location.replace("index.html");
      }
      return true;
    }

    // The body of a refusal, or null. A Worker that answered something
    // other than JSON is a refusal with nothing to quote, not a crash.
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

      /*
       * The only thing checked on this side, and it is not a validator.
       * The shape rules - how many digits, how long a label - live in
       * server/worker.js and are deliberately not restated here: two
       * copies of a rule drift, and the copy in the browser is the one
       * that cannot be trusted anyway. This is the difference between a
       * round trip and no round trip on an empty field, nothing more,
       * and every other refusal is shown in the Worker's own words.
       */
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

      // Cleared only now, and only the id. A refused add keeps what was
      // typed so a typo is corrected rather than retyped; a sent one
      // leaves nothing behind, because this page is the last place that
      // numeric id exists.
      $("member-telegram-id").value = "";
      $("member-add").disabled = false;
      await readMembership();
      sayMembership(addedNotice(role, label), null);
    });

    async function removeMembership(row, role, button) {
      button.disabled = true;
      sayMembership("Removing…", null);
      try {
        // The account id exactly as GET handed it back. The Worker folds
        // case on both sides so a malformed row can be removed at all;
        // lower-casing here would ask it to remove a different row.
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
          // A refusal means the table is whatever it already was. Nothing
          // is dropped from this page first - a page that removed the row
          // locally would draw the lockout the Worker just prevented.
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

    /*
     * Publishing.
     *
     * The snapshot that goes out is built with identify off, which is
     * what strips the handles and drops the data-quality panel. It is
     * built here, at the moment the button is pressed, rather than
     * being kept around - there is no state to go stale and nothing to
     * publish by accident after Clear.
     *
     * Publishing is an admin action and the Worker gates it with the same
     * tab-scoped session as the export. Reading the result needs a member
     * session too, but still no private key.
     */
    function publishable() {
      return root.BinderDashboard.snapshotOf(entries, {
        identify: false,
        series: $("publish-series").checked,
        // The document this one replaces, so the new one can say how far
        // the combined weight has moved since it. snapshotOf floors that
        // movement on how many people drove it and leaves the numbers
        // out entirely when too few did; a null here simply means there
        // is nothing to measure from, and the document says nothing
        // rather than saying zero.
        previous: publishedNow,
      });
    }

    function sayPublish(message, tone) {
      UI.setStatus($("publish-status"), message, tone);
    }

    /* Shown on demand, because "trust me, there are no handles in it"
     * is not something a keyholder should have to take on faith about
     * a thing they are making public. */
    $("publish-preview").addEventListener("click", function () {
      const body = $("publish-preview-body");
      if (!body.hidden) {
        body.hidden = true;
        body.textContent = "";
        return;
      }
      body.textContent = JSON.stringify(publishable(), null, 2);
      body.hidden = false;
    });

    $("publish").addEventListener("click", async function () {
      if (!entries.length) {
        sayPublish("There is nothing decrypted to publish.", "bad");
        return;
      }
      $("publish").disabled = true;
      sayPublish("Publishing…", null);
      try {
        const response = await fetch(config.endpoint + "/snapshot", {
          method: "POST",
          headers: Object.assign(
            { "Content-Type": "application/json" },
            root.BinderSession.authorization()),
          body: JSON.stringify(publishable()),
        });
        if (response.status === 401) {
          throw new Error("The admin session was not accepted.");
        }
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
      sayPublish("Published. The public dashboard now shows these numbers.",
        null);
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
        if (response.status === 401) {
          throw new Error("The admin session was not accepted.");
        }
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
          // textContent, never innerHTML. This is decrypted submitter
          // input being put back on a page.
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
