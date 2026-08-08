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
   * that has never done an export, and erasing there would create the
   * database it claims to be cleaning.
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

  root.BinderAdmin = {
    COLUMNS: COLUMNS,
    entryFor: entryFor,
    rowFor: rowFor,
    csvCell: csvCell,
    toCsv: toCsv,
    toJson: toJson,
    fileName: fileName,
    storedKeyVerdict: storedKeyVerdict,
    storedKeyNotice: storedKeyNotice,
  };

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
      say(kept ? message + " " + kept : message, tone);
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

    async function refreshPublishedState() {
      const state = $("published-state");
      try {
        const response = await fetch(config.endpoint + "/snapshot", {
          headers: root.BinderSession.authorization(),
        });
        if (response.status === 404) {
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

    loadStoredKey();
    refreshPublishedState();

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
