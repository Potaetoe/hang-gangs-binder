/*
 * Everything on your-page.html besides the form itself: the trend line,
 * the entries list, a member's own delete, the download, idle expiry,
 * and the form's own prefill from the newest entry (#370).
 *
 * WHAT THIS FILE NO LONGER DOES. The tabs, the account-summary card, the
 * Telegram-id line and the personal history read through client-side
 * decryption are all gone with the client seal (DESIGN.md, "Trust
 * model: the Worker reads") - GET /my-entries now hands back plaintext
 * directly, because the Worker opened it. There is nothing left here to
 * decrypt: the device-memory store #172 built is dead with the
 * mechanism it existed to remember.
 *
 * WHAT IS HERE INSTEAD (#370) is a different kind of prefill from the
 * one #172 built: filled from the Worker's own answer to "what did this
 * member say last time", never from anything remembered on this device
 * - so it carries none of #172's privacy cost and needs no local store
 * to go dead alongside it.
 *
 * THE CLEARING FUNCTION. clearMemberData() below is the one place that
 * empties the in-memory rows, the trend, any in-flight fetch AND every
 * prefilled form field (#370) - called from idle expiry AND from a
 * listener on the rail's Sign out button, so a member's own history
 * cannot outlive either exit from this tab (security mandate,
 * 0.9-M2-S2). It does not touch the session or the device key;
 * BinderSignOut owns both of those and this file calls it rather than
 * duplicating it. The download's object URL is not in this list
 * (0.9-M2-S12, #373): wireDownload() below creates and revokes it
 * synchronously inside its own click handler, so no URL outlives that
 * handler and nothing here needs to know about it.
 */
(function (root) {
  "use strict";

  if (typeof document === "undefined") return;

  const UI = root.BinderUI;
  const Session = root.BinderSession;
  const Form = root.BinderForm;
  const $ = UI.byId;
  const show = UI.show;

  function detail(technical) {
    if (technical && root.console && typeof root.console.warn === "function") {
      root.console.warn("binder: " + technical);
    }
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    (children || []).forEach(function (child) {
      if (child) node.appendChild(child);
    });
    if (!attrs) return node;
    Object.keys(attrs).forEach(function (key) {
      if (key === "text") node.textContent = attrs[key];
      else if (key === "class") node.className = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    return node;
  }

  function emptyOut(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /* ------------------------------------------------------------------ */
  /* State held for the life of the tab, and the one function that       */
  /* clears every bit of it - shared by idle expiry and Sign out.        */

  let entries = [];
  let inflight = null;
  // Prefill (#370) runs once per sign-in AND once more after every
  // successful submit (F5, review fix wave 1, Prime's ruling on #370):
  // a member's own edits in between must never be clobbered by an
  // ORDINARY reload (a retry, a delete's own refresh), which is what
  // this guard is for - but the entry a member just saved becomes the
  // newest CURRENT one, and re-typing what did not change on their next
  // entry is exactly what the owner asked this feature to stop, so the
  // binder:submitted listener below resets this guard on its own,
  // deliberately, rather than leaving it blocked until the next sign-in.
  // Reset alongside `entries` here too, which is what "the clearing
  // function's coverage extends to any prefill state it holds" means:
  // idle expiry or Sign out leaves this tab able to prefill again for
  // whoever signs in next, rather than stuck refusing to.
  let prefillApplied = false;

  function clearMemberData() {
    if (inflight) {
      inflight.abort();
      inflight = null;
    }
    entries = [];
    prefillApplied = false;
    emptyOut($("entries-slot"));
    emptyOut($("trend-slot"));
    const toggle = $("corrections-toggle");
    if (toggle && toggle.parentNode) toggle.parentNode.removeChild(toggle);
    // Last, not first (F1, review fix wave 1): a throw inside this call -
    // #entry-fields itself gone, or Form.plan() throwing on a malformed
    // fork spec (form.js's own onError already hid the form; this file
    // still fetched) - must never strand the erasure above it. The null
    // guard on the container inside clearPrefilledFields() covers the
    // common case; this ordering covers every OTHER way it could throw.
    clearPrefilledFields();
  }

  /*
   * The newest CURRENT entry - the same currency the entries list
   * itself renders by (renderEntries()'s own `!e.superseded` filter,
   * and GET /my-entries' own newest-first order, which this file never
   * re-sorts). A superseded row is not the newest truth even when it
   * sits first in the list, so this is `.find()`, not `entries[0]`.
   */
  function newestCurrentRecord() {
    const current = entries.find(function (e) { return !e.superseded; });
    return current && current.record && typeof current.record === "object"
      ? current.record : null;
  }

  function prefillFromEntries() {
    if (prefillApplied) return;
    const record = newestCurrentRecord();
    if (!record) return;
    prefillApplied = true;
    prefillFields(record);
  }

  /* ------------------------------------------------------------------ */
  /* The prefill itself (issue #370): over18, gender, roles, country and */
  /* every measured field EXCEPT weight, from the newest CURRENT entry   */
  /* above. Lives here rather than in form.js because form.js's own      */
  /* frozen export (BinderForm) is the PURE half its header describes,   */
  /* loaded under Node with no document by tests/your-page.test.mjs      */
  /* section 1-3 - a second DOM-touching global from that file would     */
  /* need its own line in tools/check_web.py's MODULE_EXPORTS, for one   */
  /* caller. This file already publishes nothing (NO_MODULE_EXPORT's own  */
  /* entry for it), so these stay ordinary unexported functions, reach-   */
  /* ing form.js only through BinderForm.plan() - already frozen,         */
  /* already exported, already the spec-derived field list renderFields()*/
  /* builds controls from.                                                */
  /*                                                                        */
  /* WHY THIS WALKS Form.plan() AND ITS OWN KIND, NEVER A FIELD NAME (F2,   */
  /* review fix wave 1). Every kind is filled by one generic branch keyed   */
  /* on the SPEC's own kind - consent, choice (single or multiple), count,  */
  /* and weight/length together as "measured" (F.isMeasured) - which is     */
  /* what makes a fork's added field of ANY of those kinds prefill with no  */
  /* edit here, the same forkability property renderFields() gives to       */
  /* rendering itself (tests/your-page.test.mjs section 1, widened in       */
  /* section 10 to prove it for prefill too, for a length-kind field AND a  */
  /* weight-kind one under names the shipped spec never used). The earlier  */
  /* shape checked `entry.name === "height"` and `entry.name === "weight"`  */
  /* literally, which rendered correctly for the shipped spec but never     */
  /* fired for a fork's field of the same KIND under a different name -     */
  /* falsifying this file's own forkability claim: a fork's length-kind     */
  /* field never got a fill call at all, and a fork's weight-kind field was */
  /* only ever skipped by accident (no branch matched it), not by rule.     */
  /* Weight is still excluded categorically - the ticket rules it out - but */
  /* by `entry.kind === "weight"`, checked from INSIDE the measured branch  */
  /* rather than as an earlier standalone return, so a mutation that        */
  /* deletes the one line watches weight actually get filled by the same    */
  /* code length does, rather than silently falling through to nothing      */
  /* changing (F4: a guard a mutation cannot see fail is not armed).        */

  /*
   * Any weight- or length-kind field's boxes, filled from its own record
   * value - driven entirely by the spec's own unit/store metadata
   * (F.unitsOf, F.systems, F.convert), the same tables buildMeasuredField()
   * (form.js) reads to build the boxes in the first place. A compound unit
   * (feet next to inches) has no store of its own - its total lives under
   * the OTHER unit's store - and the split back into the two boxes uses
   * the spec's own conversion factor rather than a hardcoded 12, with the
   * same carry-over guard form.js's own addHeightFeetInches() applies for
   * "height" specifically: a generic field gets the same correctness with
   * nothing here naming it.
   */
  function fillMeasured(entry, value) {
    if (!value || typeof value !== "object") return;
    const F = root.BinderFields;
    const table = F.unitsOf(entry.kind);
    F.systems().forEach(function (system) {
      const spec = entry.units[system];
      if (!spec) return;
      const mainBox = $("entry-" + entry.name + "-" + system);
      if (!spec.compoundUnit) {
        const store = table[spec.unit] && table[spec.unit].store;
        if (mainBox && store && typeof value[store] === "number") {
          mainBox.value = String(value[store]);
        }
        return;
      }
      const compoundStore = table[spec.compoundUnit] &&
        table[spec.compoundUnit].store;
      const total = compoundStore ? value[compoundStore] : null;
      if (typeof total !== "number") return;
      const perMain = F.convert(1, spec.unit, spec.compoundUnit);
      if (!Number.isFinite(perMain) || perMain <= 0) return;
      let mainAmount = Math.floor(total / perMain);
      let compoundAmount = Math.round((total - mainAmount * perMain) * 10) / 10;
      if (compoundAmount >= perMain) { mainAmount += 1; compoundAmount = 0; }
      if (mainBox) mainBox.value = String(mainAmount);
      const compoundBox = $("entry-" + entry.name + "-" + system + "-compound");
      if (compoundBox) compoundBox.value = String(compoundAmount);
    });
  }

  /* The reverse of fillMeasured() above - every box it could have set,
     back to empty, for the same weight-or-length entry. */
  function clearMeasured(entry) {
    const F = root.BinderFields;
    F.systems().forEach(function (system) {
      const spec = entry.units[system];
      if (!spec) return;
      const mainBox = $("entry-" + entry.name + "-" + system);
      if (mainBox) mainBox.value = "";
      if (spec.compoundUnit) {
        const compoundBox = $("entry-" + entry.name + "-" + system + "-compound");
        if (compoundBox) compoundBox.value = "";
      }
    });
  }

  /*
   * Mirrors form.js's own applyUnits(): the row for the checked unit
   * system shown, every other one hidden, via the same data-units-group
   * attribute buildMeasuredField() writes. Needed here because setting
   * `.checked` on a radio programmatically fires no "change" event in a
   * real browser, so form.js's own listener (wired to that event) never
   * runs on its own - and duplicating five lines is cheaper than a
   * second cross-file global for the one caller that needs them.
   */
  function applyUnitsVisibility() {
    const container = $("entry-fields");
    if (!container) return;
    const units = currentUnits();
    Array.prototype.forEach.call(
      container.querySelectorAll("[data-units-group]"),
      function (group) {
        show(group, group.getAttribute("data-units-group") === units);
      });
  }

  function prefillFields(record) {
    if (!Form || !record || typeof record !== "object") return;
    const container = $("entry-fields");
    // Same guard as clearPrefilledFields() below, for the same reason
    // (F1, review fix wave 1): a container this absent means there is no
    // form here to fill, and prefillFromEntries() runs from inside
    // loadEntries() - a throw here would propagate out of setUp()'s own
    // await and skip wireDownload()/wireIdle() entirely, not merely fail
    // to prefill.
    if (!container) return;
    const F = root.BinderFields;
    Form.plan().forEach(function (entry) {
      if (F.isMeasured(entry)) {
        // Never the measurement this visit is FOR - #370's ruling, by
        // kind rather than by name (F2/F4, review fix wave 1).
        if (entry.kind === "weight") return;
        fillMeasured(entry, record[entry.name]);
        return;
      }
      if (!(entry.name in record)) return;
      const value = record[entry.name];
      if (entry.kind === "consent") {
        const box = $("entry-" + entry.name);
        if (box) box.checked = value === true;
        return;
      }
      if (entry.kind === "choice" && entry.multiple) {
        const chosen = Array.isArray(value) ? value : [];
        Array.prototype.forEach.call(
          container.querySelectorAll('input[name="' + entry.name + '"]'),
          function (input) { input.checked = chosen.indexOf(input.value) !== -1; });
        return;
      }
      if (entry.kind === "choice" || entry.kind === "count") {
        const field = $("entry-" + entry.name);
        if (field) {
          field.value = value === null || value === undefined ? "" : String(value);
        }
      }
    });

    const units = record.entered && record.entered.units;
    if (units === "metric" || units === "imperial") {
      Array.prototype.forEach.call(
        document.querySelectorAll('input[name="units"]'),
        function (input) { input.checked = input.value === units; });
      applyUnitsVisibility();
    }
  }

  /*
   * The reverse: what a member's own prior answers must not survive
   * past, on a device somebody else might sit down at next. Called from
   * clearMemberData() above - the one function idle expiry and Sign out
   * both run - so this is "the clearing function's coverage extends to
   * any prefill state it holds" from the ticket, not a second clearing
   * mechanism. Clears exactly what prefillFields() can set and nothing
   * else: a member's own not-yet-submitted weight was never prefilled,
   * so it is not reset here either.
   */
  function clearPrefilledFields() {
    if (!Form) return;
    const container = $("entry-fields");
    // Matches applyUnitsVisibility()'s own guard, a dozen lines up -
    // #entry-fields absent (form.js's own onError hid the form; this
    // file still fetched) is a throw waiting here without it, ahead of
    // the entries-slot/trend-slot/download-URL erasure clearMemberData()
    // runs alongside this call; a real sign-out would leave all three
    // behind with the session already gone. clearMemberData() calls this
    // LAST, so even a throw this guard does not catch (Form.plan()
    // itself, on a malformed fork spec) cannot strand that erasure - the
    // ordering is the whole guarantee; this guard only removes the most
    // common way there was ever anything to catch.
    if (!container) return;
    const F = root.BinderFields;
    Form.plan().forEach(function (entry) {
      if (F.isMeasured(entry)) {
        if (entry.kind === "weight") return; // never touched - never
        // prefilled either, so there is nothing of it to clear.
        clearMeasured(entry);
        return;
      }
      if (entry.kind === "consent") {
        const box = $("entry-" + entry.name);
        if (box) box.checked = false;
        return;
      }
      if (entry.kind === "choice" && entry.multiple) {
        Array.prototype.forEach.call(
          container.querySelectorAll('input[name="' + entry.name + '"]'),
          function (input) { input.checked = false; });
        return;
      }
      if (entry.kind === "choice" || entry.kind === "count") {
        const field = $("entry-" + entry.name);
        if (field) field.value = "";
      }
    });

    const fallback = F.defaultSystem();
    Array.prototype.forEach.call(
      document.querySelectorAll('input[name="units"]'),
      function (input) { input.checked = input.value === fallback; });
    applyUnitsVisibility();
  }

  /* ------------------------------------------------------------------ */
  /* Reading a record back, in the member's chosen units.                */

  /*
   * GET /my-entries hands back each row's `record` as the JSON STRING
   * store-crypto's openRow() decoded it to (server/worker.js's own
   * handleMyEntries never parses it - handleCharts does, for its own
   * reasons, and that is what made this file's omission invisible: the
   * suite's own fixture handed objects, never the string shape the
   * Worker actually sends). Parsed HERE, once, right after the fetch, so
   * every reader below (weightDisplay, heightDisplay, bmiOf, the trend,
   * the delete confirmation, the xlsx export) sees an object exactly as
   * it always assumed.
   *
   * A row that will not parse is not a reason to fail the whole listing
   * - the Worker already fails closed on a row that will not DECRYPT
   * (openRow throws and the request answers 500), so a plaintext string
   * this file cannot read as JSON is a narrower, later failure with a
   * narrower, honest answer: that one row's record becomes null, which
   * every existing reader below already treats as "nothing to show"
   * (the em-dash cells, the trend's own filter(Boolean)) rather than a
   * crash. The row itself still renders - its date, its delete control -
   * because a member's ability to see and remove a row must not depend
   * on this file being able to read its contents back.
   */
  function parseRecord(raw) {
    if (typeof raw !== "string") return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      detail("a stored record did not parse as JSON");
      return null;
    }
  }

  function currentUnits() {
    return UI.checkedValue("units", root.BinderFields.defaultSystem());
  }

  function weightDisplay(record, system) {
    const F = root.BinderFields;
    const held = record && record.weight;
    if (!held || typeof held !== "object") return null;
    const unit = F.measure("weight").units[system].unit;
    const store = F.measure("weight").units[system].store;
    const value = held[store];
    return typeof value === "number" ? { value: value, unit: unit } : null;
  }

  function heightDisplay(record, system) {
    const F = root.BinderFields;
    const held = record && record.height;
    if (!held || typeof held !== "object") return null;
    const unit = F.measure("height").units[system].unit;
    const store = F.measure("height").units[system].store;
    const value = held[store];
    if (typeof value !== "number") return null;
    if (system === "imperial") {
      const feet = Math.floor(value / 12);
      const inches = Math.round((value - feet * 12) * 10) / 10;
      return { value: value, unit: unit, text: feet + " ft " + inches + " in" };
    }
    return { value: value, unit: unit, text: value + " " + unit };
  }

  function bmiOf(record) {
    const F = root.BinderFields;
    const weight = record && record.weight;
    const height = record && record.height;
    const kg = weight && typeof weight.kg === "number" ? weight.kg : null;
    const cm = height && typeof height.cm === "number" ? height.cm : null;
    if (kg === null || cm === null || cm <= 0) return null;
    const bmi = F.measure("bmi");
    return bmi.compute({ weight: kg, height: cm });
  }

  function formatDate(iso) {
    const at = Date.parse(iso);
    if (!Number.isFinite(at)) return "—";
    return new Date(at).toLocaleDateString(undefined,
      { year: "numeric", month: "short", day: "numeric" });
  }

  /* ------------------------------------------------------------------ */
  /* Delete: two-step, row-scoped, naming the row's own date and value.  */

  // The result is a brief toast (0.9-M3-S33, #454 item 8), not a
  // per-row status paragraph beside the button - a deleted row simply
  // leaves the list via onDeleted(), which is feedback enough for the
  // success case, so this is the one path that ever had anything to
  // say and it says it in the toast. Both failure branches below read
  // "Nothing was removed — try again." (#454 item 7, DESIGN.md's own
  // words: "The voice is plain and warm") - matching the shape
  // form.js's own submit failures already use ("Nothing was sent",
  // "Nothing was stored") rather than the older, passive "That entry
  // could not be removed."
  async function deleteEntry(id) {
    const config = root.BINDER_CONFIG || {};
    if (!config.endpoint) return false;
    try {
      const response = await fetch(config.endpoint + "/submission/" + id, {
        method: "DELETE",
        headers: Session.authorization(),
      });
      if (response.status === 401) {
        Session.clear();
        if (root.location && typeof root.location.replace === "function") {
          root.location.replace("index.html");
        }
        return false;
      }
      if (response.status < 200 || response.status >= 300) {
        detail("DELETE /submission/" + id + " answered " + response.status);
        UI.showToast("Nothing was removed — try again.");
        return false;
      }
      return true;
    } catch (error) {
      detail(error && error.message ? error.message : "the delete could not " +
        "be sent");
      UI.showToast("Nothing was removed — try again.");
      return false;
    }
  }

  /*
   * The confirm step replaces the row's action cell in place - no
   * modal, no <form> around it so there is no default-submit button for
   * Enter to reach, and the id travels as a path segment rather than a
   * query string.
   */
  function buildActionCell(row, system, onDeleted) {
    const cell = el("td");

    function showConfirm() {
      emptyOut(cell);
      const weight = weightDisplay(row.record, system);
      const named = (weight ? weight.value + " " + weight.unit : "that entry") +
        " from " + formatDate(row.receivedAt);
      cell.appendChild(el("p", { class: "muted small",
        text: "Delete the entry (" + named + ")? This cannot be undone." }));
      const yes = el("button", { type: "button", class: "secondary",
        text: "Yes, delete" });
      const no = el("button", { type: "button", class: "secondary",
        text: "Cancel" });
      yes.addEventListener("click", async function () {
        yes.disabled = true;
        no.disabled = true;
        const ok = await deleteEntry(row.id);
        if (ok) {
          UI.showToast("Removed.");
          onDeleted();
        } else {
          showButton();
        }
      });
      no.addEventListener("click", showButton);
      cell.appendChild(el("div", { class: "row buttons" }, [yes, no]));
    }

    function showButton() {
      emptyOut(cell);
      const button = el("button", { type: "button", class: "secondary",
        text: "Delete" });
      button.addEventListener("click", showConfirm);
      cell.appendChild(button);
    }

    showButton();
    return cell;
  }

  /* ------------------------------------------------------------------ */
  /* The entries list: current rows in flow, replaced ones muted in      */
  /* place, one disclosure for the whole list.                           */

  function renderEntries(container, onChanged) {
    emptyOut(container);
    const system = currentUnits();

    if (!entries.length) {
      // #454 item 10 (owner ruling, 2026-08-22), DESIGN.md's own words:
      // "An empty state is one friendly sentence and the next step" - a
      // real button, not prose asking the member to scroll up and find
      // the form themselves. #entry-section is the form's own card,
      // above this one in the page's stack.
      container.appendChild(el("p", { class: "muted",
        text: "No entries yet." }));
      container.appendChild(el("a", { class: "primary",
        href: "#entry-section", text: "Add your first one" }));
      return;
    }

    const supersededCount = entries.filter(function (e) { return e.superseded; })
      .length;
    if (supersededCount > 0) {
      const toggle = el("button", { type: "button", id: "corrections-toggle",
        class: "secondary",
        text: "Show " + supersededCount +
          (supersededCount === 1 ? " replaced row" : " replaced rows") });
      let revealed = false;
      toggle.addEventListener("click", function () {
        revealed = !revealed;
        toggle.textContent = revealed
          ? "Hide replaced rows"
          : "Show " + supersededCount +
            (supersededCount === 1 ? " replaced row" : " replaced rows");
        Array.prototype.forEach.call(
          container.querySelectorAll("tr[data-superseded]"),
          function (row) { row.hidden = !revealed; });
      });
      container.appendChild(toggle);
    }

    const wrap = el("div", { class: "table-scroll" });
    const table = el("table", { class: "tabular" });
    table.appendChild(el("thead", {}, [
      el("tr", {}, [
        el("th", { text: "date" }), el("th", { text: "weight" }),
        el("th", { text: "height" }), el("th", { text: "bmi" }),
        el("th", { text: "" }),
      ]),
    ]));
    const tbody = el("tbody");

    entries.forEach(function (row) {
      const weight = weightDisplay(row.record, system);
      const height = heightDisplay(row.record, system);
      const bmi = bmiOf(row.record);
      const tr = el("tr", row.superseded
        ? { class: "muted", "data-superseded": "1", hidden: "" } : {});
      tr.appendChild(el("td", { text: formatDate(row.receivedAt) }));
      tr.appendChild(el("td", { text: weight ? weight.value + " " + weight.unit : "—" }));
      tr.appendChild(el("td", { text: height ? height.text : "—" }));
      tr.appendChild(el("td", { text: bmi === null ? "—" : String(bmi) }));
      tr.appendChild(buildActionCell(row, system, onChanged));
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  /* ------------------------------------------------------------------ */
  /* The trend: one hand-rolled SVG line over the current rows' weight.  */

  function renderTrend(container) {
    emptyOut(container);
    const system = currentUnits();
    const current = entries.filter(function (e) { return !e.superseded; });
    const points = current
      .map(function (e) {
        const at = Date.parse(e.receivedAt);
        const w = weightDisplay(e.record, system);
        return Number.isFinite(at) && w ? { t: at, v: w.value, unit: w.unit }
          : null;
      })
      .filter(Boolean)
      .sort(function (a, b) { return a.t - b.t; });

    if (points.length < 2) {
      container.appendChild(el("p", { class: "muted",
        text: current.length
          ? "One entry isn't a trend yet — add another and a line " +
            "appears here."
          : "Nothing recorded yet — fill in the form above and it " +
            "starts here." }));
      return;
    }

    const W = 600, H = 200, MARGIN_L = 40, MARGIN_B = 20, MARGIN_T = 10;
    const minT = points[0].t, maxT = points[points.length - 1].t;
    const values = points.map(function (p) { return p.v; });
    let minV = Math.min.apply(null, values), maxV = Math.max.apply(null, values);
    if (minV === maxV) { minV -= 1; maxV += 1; }

    function x(t) {
      return maxT === minT ? MARGIN_L
        : MARGIN_L + (t - minT) / (maxT - minT) * (W - MARGIN_L - 10);
    }
    function y(v) {
      return MARGIN_T + (1 - (v - minV) / (maxV - minV)) * (H - MARGIN_T - MARGIN_B);
    }

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Your weight trend, " + points.length +
      " entries");

    function line(x1, y1, x2, y2, cls) {
      const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
      l.setAttribute("x1", x1); l.setAttribute("y1", y1);
      l.setAttribute("x2", x2); l.setAttribute("y2", y2);
      l.setAttribute("class", cls);
      return l;
    }
    svg.appendChild(line(MARGIN_L, MARGIN_T, MARGIN_L, H - MARGIN_B, "chart-axis"));
    svg.appendChild(line(MARGIN_L, H - MARGIN_B, W - 10, H - MARGIN_B, "chart-axis"));

    function labelAt(px, py, value, anchor) {
      const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.setAttribute("x", px); t.setAttribute("y", py);
      t.setAttribute("class", "chart-label");
      if (anchor) t.setAttribute("text-anchor", anchor);
      t.textContent = value;
      return t;
    }
    svg.appendChild(labelAt(MARGIN_L - 6, y(maxV) + 4, Math.round(maxV), "end"));
    svg.appendChild(labelAt(MARGIN_L - 6, y(minV) + 4, Math.round(minV), "end"));

    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("class", "chart-series series-0");
    polyline.setAttribute("points",
      points.map(function (p) { return x(p.t) + "," + y(p.v); }).join(" "));
    svg.appendChild(polyline);

    const last = points[points.length - 1];
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", x(last.t)); dot.setAttribute("cy", y(last.v));
    dot.setAttribute("r", 3);
    dot.setAttribute("class", "chart-dot series-0");
    svg.appendChild(dot);

    const figure = el("figure", { class: "chart chart-wide" }, [
      el("figcaption", { text: "Your weight" }),
      svg,
    ]);
    container.appendChild(figure);

    /*
     * The one-line conversion notice (design mandate 3): shown only when
     * some charted entry was typed in a different system than it is
     * being drawn in now.
     */
    const other = system === "metric" ? "imperial" : "metric";
    const otherUnit = root.BinderFields.measure("weight").units[other].unit;
    const converted = current.some(function (e) {
      return e.record && e.record.entered && e.record.entered.units === other;
    });
    if (converted) {
      container.appendChild(el("p", { class: "hint",
        text: "Shown in " + points[0].unit + " — entries logged in " +
          otherUnit + " were converted." }));
    }
  }

  /* ------------------------------------------------------------------ */
  /* The download: built in-page from rows already fetched, via          */
  /* xlsx.js only. Revoked immediately, filename date-stamped.           */

  const DOWNLOAD_COLUMNS = [
    "date", "weight_lb", "weight_kg", "height_ft_in", "height_cm", "bmi",
    "corrected",
  ];

  function downloadRow(entry) {
    const weight = entry.record && entry.record.weight;
    const height = entry.record && entry.record.height;
    const feetInches = heightDisplay(entry.record, "imperial");
    const bmi = bmiOf(entry.record);
    return [
      formatDate(entry.receivedAt),
      weight && typeof weight.lb === "number" ? weight.lb : "",
      weight && typeof weight.kg === "number" ? weight.kg : "",
      feetInches ? feetInches.text : "",
      height && typeof height.cm === "number" ? height.cm : "",
      bmi === null ? "" : bmi,
      entry.superseded ? "yes" : "",
    ];
  }

  function fileName(now) {
    const date = new Date(now).toISOString().slice(0, 10);
    return "your-entries-" + date + ".xlsx";
  }

  function wireDownload() {
    const button = $("download");
    if (!button) return;
    button.addEventListener("click", function () {
      if (!entries.length || !root.BinderXlsx) return;
      const rows = entries.map(downloadRow);
      const bytes = root.BinderXlsx.build(DOWNLOAD_COLUMNS, rows, "Entries",
        Date.now());
      // Create, use, revoke - all inside this one handler. This IS the
      // security mandate 0.9-M2-S2 rules for the object URL, met by
      // construction: no URL outlives the click that made it, so there
      // is nothing for a module-level variable to hold or for
      // clearMemberData() to clear (0.9-M2-S12, #373).
      const url = URL.createObjectURL(new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }));
      const link = el("a", { href: url, download: fileName(Date.now()) });
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Fetching the list and drawing both sections from one response.      */

  /*
   * What a failed load leaves in a slot: the honest sentence, and one
   * control that re-fires THIS read (0.9-M2-S8, #365, the owner's own
   * request from the first M2 sitting).
   *
   * The sentence names no remedy of its own - no "reload the page" -
   * because the control beside it is the remedy, and a whole-page
   * reload is not one this page can ask for: it would throw away the
   * form a member may have half-filled to recover from one failed read.
   * BOTH slots carry a control rather than one, because either one is
   * where a member happens to be looking when the failure appears, and
   * both re-fire the same single read: GET /my-entries answers this
   * page's entries AND its trend, so there is nothing narrower to
   * retry and no way for the two controls to disagree.
   *
   * The button is built here rather than shipped hidden in the markup
   * because the slot is emptied on every draw - a control in the HTML
   * would be removed by the first emptyOut() and never come back.
   */
  function failedLoad(slot, sentence) {
    if (!slot) return;
    emptyOut(slot);
    slot.appendChild(el("p", { class: "muted", text: sentence }));
    const again = el("button", { type: "button", class: "secondary",
      text: "Try again" });
    again.addEventListener("click", function () {
      // Disabled for the life of this attempt, so a second press cannot
      // start a race against the first - loadEntries() aborts an
      // in-flight read, and this node is replaced outright by whatever
      // the next draw writes into the slot, success or failure alike.
      again.disabled = true;
      loadEntries();
    });
    slot.appendChild(again);
  }

  async function loadEntries() {
    const config = root.BINDER_CONFIG || {};
    if (!config.endpoint) return;
    const trendSlot = $("trend-slot");
    const entriesSlot = $("entries-slot");
    if (inflight) inflight.abort();
    const controller = new AbortController();
    inflight = controller;
    try {
      const response = await fetch(config.endpoint + "/my-entries", {
        headers: Session.authorization(),
        signal: controller.signal,
      });
      if (inflight !== controller) return; // superseded by a later call
      if (response.status === 401) {
        Session.clear();
        if (root.location && typeof root.location.replace === "function") {
          root.location.replace("index.html");
        }
        return;
      }
      if (!response.ok) {
        detail("GET /my-entries answered " + response.status);
        throw new Error("");
      }
      const payload = await response.json();
      if (!payload || payload.ok !== true || !Array.isArray(payload.entries)) {
        detail("GET /my-entries answered with no usable listing");
        throw new Error("");
      }
      entries = payload.entries.map(function (entry) {
        return Object.assign({}, entry, { record: parseRecord(entry.record) });
      });
    } catch (error) {
      if (error && error.name === "AbortError") return;
      detail(error && error.message ? error.message : "the entries listing " +
        "could not be fetched");
      failedLoad(entriesSlot, "Your entries could not be loaded.");
      // The trend section stays in flow even on a failed load - its own
      // comment on your-page.html says so ("the empty-state sentence
      // lives in the slot rather than an axis with no line on it"), and
      // a bare runner with nothing under it is exactly the state that
      // comment rules out. Writing here rather than leaving whatever the
      // slot held before this call - a stale trend from a prior success
      // would read as current data about a request that just failed.
      failedLoad(trendSlot, "Your trend could not be loaded.");
      return;
    } finally {
      if (inflight === controller) inflight = null;
    }

    renderTrend(trendSlot);
    renderEntries(entriesSlot, function () { loadEntries(); });
    prefillFromEntries();
  }

  /* ------------------------------------------------------------------ */
  /* Walking away from the machine - the same warn-then-expire timer     */
  /* admin.html carries (DESIGN.md, "Sessions": "Idle expiry is one      */
  /* rule everywhere"). Ten minutes idle, two minutes' warning, shorter  */
  /* than the Worker's own SESSION_IDLE_MINUTES window so this page      */
  /* always acts first, on its own initiative.                          */

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
    return "Nobody has touched this page for a while. It shows your own " +
      "entries, so it will clear itself and sign you out in " +
      Math.floor(seconds / 60) + ":" + (rest < 10 ? "0" : "") + rest +
      ". Any key, click, touch or wheel keeps it open.";
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
      clearMemberData();
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
      const countdown = $("idle-countdown");
      if (countdown) countdown.textContent = idleNotice(verdict);
      if (warned) return;
      warned = true;
      show($("idle-warning"), true);
      const stay = $("idle-stay");
      if (stay) stay.focus();
    }

    ticker = root.setInterval(checkAttention, TICK_MS);
    const stay = $("idle-stay");
    if (stay) stay.addEventListener("click", markInteraction);
  }

  /* ------------------------------------------------------------------ */

  UI.boot(setUp, function (error) {
    detail(error && error.message ? error.message : "boot failed with no " +
      "message");
  });

  async function setUp() {
    if (!Session) throw new Error("This page did not load session handling.");
    const session = Session.require();
    if (!session) return;

    // Sign out clears the session and the device key on its own
    // (signout.js); this page's own data goes with the same click,
    // ahead of the navigation - both listeners are on the same button
    // and neither depends on the other's order.
    const signOutButton = $("sign-out");
    if (signOutButton) signOutButton.addEventListener("click", clearMemberData);

    Array.prototype.forEach.call(
      document.querySelectorAll('input[name="units"]'),
      function (input) {
        input.addEventListener("change", function () {
          renderTrend($("trend-slot"));
          renderEntries($("entries-slot"), function () { loadEntries(); });
        });
      });

    // form.js owns the record and the POST; this file owns the list.
    // Refreshing from the server rather than splicing the new row in
    // locally means the list always reflects what the Worker actually
    // stored, including the receipt time it stamped.
    document.addEventListener("binder:submitted", function () {
      // A successful submit is the ONE reload allowed to re-prefill (F5,
      // review fix wave 1, Prime's ruling on #370): form.js dispatches
      // this event only once the Worker has actually accepted the write
      // (tests/your-page.test.mjs section 6a proves the three refusals
      // fire no event), so the entry just saved really is the newest
      // CURRENT one by the time this runs. Every OTHER reload (a retry,
      // a delete) leaves the guard alone, so an edit typed since the
      // first prefill still survives those.
      prefillApplied = false;
      loadEntries();
    });

    wireDownload();
    wireIdle();
    await loadEntries();
  }
})(globalThis);
