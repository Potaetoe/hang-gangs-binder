/*
 * The export page. The only place the submissions exist as plaintext.
 *
 * Two secrets meet here and neither is stored: the export token fetches
 * the ciphertext, and the key file opens it. Both are typed in, used,
 * and forgotten when the tab closes - nothing is written to
 * localStorage, nothing is sent anywhere, and the key never leaves the
 * page. See DESIGN.md, "Export" and "Key custody".
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
   */
  const COLUMNS = [
    "id",
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
   */
  function entryFor(submission, record) {
    return {
      id: at(submission, ["id"]),
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

  root.BinderAdmin = {
    COLUMNS: COLUMNS,
    entryFor: entryFor,
    rowFor: rowFor,
    csvCell: csvCell,
    toCsv: toCsv,
    toJson: toJson,
    fileName: fileName,
  };

  /* ---------------------------------------------------------------- */
  /* The wiring. Everything above this line runs under Node.          */

  if (typeof document === "undefined") return;

  function $(id) {
    return document.getElementById(id);
  }

  function show(element, visible) {
    if (element) element.hidden = !visible;
  }

  /* Same guard as form.js: a throw during setup would leave a page that
   * looks fine and a button that does nothing. */
  document.addEventListener("DOMContentLoaded", function () {
    try {
      setUp();
    } catch (error) {
      show($("tool"), false);
      const closed = $("closed");
      show(closed, true);
      if (closed) {
        closed.querySelector("[data-reason]").textContent =
          "This page did not start up correctly, so it is not safe to use. " +
          (error && error.message ? "(" + error.message + ")" : "");
      }
    }
  });

  function setUp() {
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

    // Everything decrypted so far, held only for as long as this tab is
    // open. Cleared by the Clear button along with the two secrets.
    let entries = [];
    let rows = [];
    let csv = "";
    let json = "";
    let urls = [];

    function say(message, tone) {
      const status = $("status");
      status.textContent = message || "";
      status.hidden = !message;
      status.className = "status" + (tone ? " " + tone : "");
    }

    // Object URLs pin their blob in memory until revoked, and the blob
    // here is everyone's data in the clear. Re-running the export
    // should not leave the previous one alive.
    function revoke() {
      for (const url of urls) URL.revokeObjectURL(url);
      urls = [];
    }

    function offer(id, text, type, extension) {
      const url = URL.createObjectURL(new Blob([text], { type: type }));
      urls.push(url);
      const link = $(id);
      link.href = url;
      link.download = fileName(Date.now(), extension);
    }

    function reset() {
      entries = [];
      rows = [];
      csv = "";
      json = "";
      revoke();
      $("tbody").textContent = "";
      $("summary").textContent = "";
      $("charts").textContent = "";
      show($("results"), false);
      show($("dashboard"), false);
      show($("failures"), false);
      $("failure-list").textContent = "";
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

    $("clear").addEventListener("click", function () {
      $("token").value = "";
      $("keyfile").value = "";
      $("keyfile-picker").value = "";
      reset();
      say("Cleared. Nothing from the last export is still on this page.",
        null);
    });

    $("run").addEventListener("click", async function () {
      reset();

      const tokenText = $("token").value.trim();
      const keyText = $("keyfile").value.trim();

      if (!keyText) {
        say("Paste or choose your key file first - the one " +
          "tools/keygen.html saved.", "bad");
        return;
      }
      if (!tokenText) {
        say("The export token is needed to fetch the rows.", "bad");
        return;
      }

      /*
       * Import the key before asking the network for anything. A bad
       * key is the admin's own mistake and can be reported instantly;
       * spending a request first would report it as a failure of the
       * fetch, which is the wrong thing to go and check.
       */
      let key;
      try {
        say("Reading the key…", null);
        key = await root.BinderCrypto.importPrivateKey(keyText);
      } catch (error) {
        say("That key was not usable. " +
          (error && error.message ? error.message : ""), "bad");
        return;
      }

      $("run").disabled = true;
      let payload;
      try {
        say("Fetching the rows…", null);
        const response = await fetch(config.endpoint + "/export", {
          headers: { Authorization: "Bearer " + tokenText },
        });
        if (response.status === 401) {
          throw new Error("The export token was not accepted.");
        }
        if (!response.ok) {
          throw new Error("The server answered " + response.status + ".");
        }
        payload = await response.json();
      } catch (error) {
        $("run").disabled = false;
        say("The rows could not be fetched. " +
          (error && error.message ? error.message : "The connection failed."),
          "bad");
        return;
      }

      const submissions = (payload && payload.submissions) || [];
      if (!submissions.length) {
        $("run").disabled = false;
        say("The token worked, but there are no submissions stored yet.",
          null);
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

      rows = entries.map(rowFor);
      csv = toCsv(rows);
      json = toJson(entries);
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
      const chosen = Array.prototype.slice
        .call(document.querySelectorAll('input[name="basis"]'))
        .filter(function (input) { return input.checked; })[0];
      return chosen ? chosen.value : "people";
    }

    Array.prototype.forEach.call(
      document.querySelectorAll('input[name="basis"]'),
      function (input) {
        input.addEventListener("change", function () {
          if (entries.length) {
            root.BinderDashboard.render($("charts"), entries, currentBasis());
          }
        });
      });

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
      head.appendChild(headRow);

      const body = $("tbody");
      body.textContent = "";
      rows.slice(0, PREVIEW).forEach(function (row) {
        const tr = document.createElement("tr");
        row.forEach(function (cell) {
          const td = document.createElement("td");
          // textContent, never innerHTML. This is decrypted submitter
          // input being put back on a page.
          td.textContent = String(cell);
          tr.appendChild(td);
        });
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
      offer("download-json", json, "application/json;charset=utf-8", "json");

      show($("results"), true);

      if (rows.length) {
        root.BinderDashboard.render($("charts"), entries, currentBasis());
        show($("dashboard"), true);
      }

      say(rows.length
        ? "Done. Both files are built in this page - nothing was uploaded."
        : "Nothing could be decrypted with this key.",
        rows.length ? null : "bad");
    }
  }
})(globalThis);
