

(function (root) {
  "use strict";

  if (typeof document === "undefined") return;

  const UI = root.BinderUI;
  const Session = root.BinderSession;
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

   
   
   

  let entries = [];
  let downloadUrl = null;
  let inflight = null;

  function clearMemberData() {
    if (inflight) {
      inflight.abort();
      inflight = null;
    }
    entries = [];
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      downloadUrl = null;
    }
    emptyOut($("entries-slot"));
    emptyOut($("trend-slot"));
    const toggle = $("corrections-toggle");
    if (toggle && toggle.parentNode) toggle.parentNode.removeChild(toggle);
  }

   
   

  

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

   
   

  async function deleteEntry(id, statusLine) {
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
        statusLine.textContent = "That entry could not be removed — try again.";
        statusLine.hidden = false;
        return false;
      }
      return true;
    } catch (error) {
      detail(error && error.message ? error.message : "the delete could not " +
        "be sent");
      statusLine.textContent = "That entry could not be removed — try again.";
      statusLine.hidden = false;
      return false;
    }
  }

  

  function buildActionCell(row, system, onDeleted) {
    const cell = el("td");
    const status = el("p", { class: "status", hidden: "" });

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
        const ok = await deleteEntry(row.id, status);
        if (ok) onDeleted();
        else showButton();
      });
      no.addEventListener("click", showButton);
      cell.appendChild(el("div", { class: "row buttons" }, [yes, no]));
      cell.appendChild(status);
    }

    function showButton() {
      emptyOut(cell);
      const button = el("button", { type: "button", class: "secondary",
        text: "Delete" });
      button.addEventListener("click", showConfirm);
      cell.appendChild(button);
      cell.appendChild(status);
    }

    showButton();
    return cell;
  }

   
   
   

  function renderEntries(container, onChanged) {
    emptyOut(container);
    const system = currentUnits();

    if (!entries.length) {
      container.appendChild(el("p", { class: "muted",
        text: "Nothing recorded yet — fill in the form above and it " +
          "starts here." }));
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
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
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

   
   

  

  function failedLoad(slot, sentence) {
    if (!slot) return;
    emptyOut(slot);
    slot.appendChild(el("p", { class: "muted", text: sentence }));
    const again = el("button", { type: "button", class: "secondary",
      text: "Try again" });
    again.addEventListener("click", function () {
       
       
       
       
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
      if (inflight !== controller) return;  
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
       
       
       
       
       
       
       
      failedLoad(trendSlot, "Your trend could not be loaded.");
      return;
    } finally {
      if (inflight === controller) inflight = null;
    }

    renderTrend(trendSlot);
    renderEntries(entriesSlot, function () { loadEntries(); });
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

   

  UI.boot(setUp, function (error) {
    detail(error && error.message ? error.message : "boot failed with no " +
      "message");
  });

  async function setUp() {
    if (!Session) throw new Error("This page did not load session handling.");
    const session = Session.require();
    if (!session) return;

     
     
     
     
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

     
     
     
     
    document.addEventListener("binder:submitted", function () {
      loadEntries();
    });

    wireDownload();
    wireIdle();
    await loadEntries();
  }
})(globalThis);
