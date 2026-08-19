/*
 * Charts: filter, measure, two pictures, no snapshot (0.9-M2-S3, #354).
 *
 * RENDER-ONLY, ON PURPOSE (security mandate 1). This file prints the
 * fields GET /charts hands back and does no suppression arithmetic of
 * its own: no floor threshold defined here under any name, no pooling
 * of small cells, no merging of bins, no second binning pass over
 * numbers the route already grouped. server/charts-agg.js is the one
 * rows-to-series path and every disclosure rule lives there; a second
 * implementation here - even a correct one - would be the second place
 * the floor could drift, which is the class of defect #351 found in
 * apps/web/dashboard.js's identical algorithm. That file, apps/web/
 * query.js and apps/web/public.js are deleted by this same change:
 * nothing of theirs is carried forward in any form.
 *
 * THE UNITS TOGGLE NEVER RE-BINS. GET /charts answers every unit
 * system in one document - a bin's `from`/`to` and a trend point's
 * `average` are both {metric: ..., imperial: ...} - so switching units
 * re-reads a different key of the SAME cached answer rather than
 * asking again or converting anything client-side (security mandate
 * 2). A second, independently-binned partition is the differencing
 * oracle DESIGN.md's "One partition, not two" refuses.
 *
 * THE FILTER AND MEASURE VALUE LISTS COME FROM apps/site.config.js,
 * never from a response (security mandate 2; design mandate 2). GET
 * /charts deliberately never enumerates which values a group holds -
 * DESIGN.md, "The identifier is the whole problem" - so rebuilding
 * that list from anything the server said would open the membership
 * oracle the route's own shape refuses.
 *
 * The pure half below is scale and label math with no document in it,
 * which is what tests/charts-page.test.mjs exercises under Node; the
 * DOM half is wiring, exactly as every other page's script splits.
 */
(function (root) {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* Pure: label and scale math. No document, no fetch, no storage.      */

  function capitalize(word) {
    return typeof word === "string" && word
      ? word.charAt(0).toUpperCase() + word.slice(1)
      : word;
  }

  /*
   * The open-ended edge labels (design mandate 3; server/charts-agg.js's
   * openEdge()). `from` and `to` are the ALREADY-CHOSEN system's numbers
   * for one bin - null means that edge is open, and an open edge never
   * gets a number, invented or otherwise.
   *
   * Both open at once is the real single-bin case, not a bug
   * (server/charts-agg.js's own header): the honest label names no
   * numeric edge at all.
   */
  function binLabel(from, to, unit) {
    const suffix = unit ? " " + unit : "";
    if (from === null && to === null) {
      return "Everyone in this view";
    }
    if (from === null) {
      return "under " + String(to) + suffix;
    }
    if (to === null) {
      return String(from) + suffix + " and up";
    }
    return String(from) + suffix + "–" + String(to) + suffix;
  }

  /* A linear map from one closed interval to another. Degenerate domains
     (every value equal) map to the range's low end rather than dividing
     by zero - one bar or one point still has to land somewhere. */
  function scaleLinear(domainLow, domainHigh, rangeLow, rangeHigh) {
    const span = domainHigh - domainLow;
    return function (value) {
      if (!(span > 0)) return rangeLow;
      const t = (value - domainLow) / span;
      return rangeLow + t * (rangeHigh - rangeLow);
    };
  }

  /*
   * The categorical measures - the only ones a filter can name
   * (server/charts-agg.js's askFor(): `one.kind === "categorical"`).
   */
  function categoricalMeasures(Fields, site) {
    return Fields.measures(site).filter(function (one) {
      return one.kind === "categorical";
    });
  }

  /*
   * One field's value list, from the spec and nothing else. A
   * `choicesFrom` field reads its list from the page global that spec
   * points at (apps/web/countries.js is the one that exists), matching
   * server/charts-agg.js's own CHOICE_LIST_SHAPES comment: the Worker
   * has no such list to enumerate, so the page holding one is what
   * makes the value control possible at all.
   */
  function valueChoices(measure, countries) {
    if (measure.choicesFrom === "countries") {
      const table = countries || {};
      return Object.keys(table)
        .sort(function (a, b) { return table[a].localeCompare(table[b]); })
        .map(function (code) { return { value: code, label: table[code] }; });
    }
    return (measure.choices || []).map(function (choice) {
      return { value: choice.value, label: choice.label };
    });
  }

  /* The request GET /charts answers to. `self=1` always: there is no
     separate control for the member's own overlay (design mandate 2
     names six controls and this is not one of them) - DESIGN.md,
     "Charts", has it as a property of the Trend picture, not a toggle,
     and asking for it costs nothing on a categorical measure, which
     answers {points: []}. */
  function chartsURL(endpoint, ask) {
    const url = new URL(endpoint + "/charts");
    url.searchParams.set("measure", ask.measure);
    if (ask.filter) {
      url.searchParams.set("filter", ask.filter);
      url.searchParams.set("value", ask.value);
    }
    url.searchParams.set("self", "1");
    return url.toString();
  }

  const Pure = {
    capitalize: capitalize,
    binLabel: binLabel,
    scaleLinear: scaleLinear,
    categoricalMeasures: categoricalMeasures,
    valueChoices: valueChoices,
    chartsURL: chartsURL,
  };

  root.BinderCharts = Object.freeze(Pure);

  /* ------------------------------------------------------------------ */
  /* DOM: fetching, wiring, drawing. Nothing above this line touches a   */
  /* document, a fetch or storage - see the module header.               */

  if (typeof document === "undefined") return;

  const UI = root.BinderUI;
  const Session = root.BinderSession;
  const Fields = root.BinderFields;
  const $ = UI.byId;
  const show = UI.show;
  const SVG_NS = "http://www.w3.org/2000/svg";

  UI.boot(setUp, function (error) {
    show($("results"), false);
    const status = $("status");
    if (status) {
      status.textContent = "This page did not start up correctly, so " +
        "there is nothing to show." +
        (error && error.message ? " (" + error.message + ")" : "");
      status.hidden = false;
    }
  });

  function detail(technical) {
    if (technical && root.console && typeof root.console.warn === "function") {
      root.console.warn("binder: " + technical);
    }
  }

  function svg(tag, attrs, className) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (key) {
      el.setAttribute(key, String(attrs[key]));
    });
    if (className) el.setAttribute("class", className);
    return el;
  }

  function clearSvg(root_) {
    while (root_.firstChild) root_.removeChild(root_.firstChild);
  }

  /* ------------------------------------------------------------------ */
  /* Building the controls from the spec.                                */

  function populateFilterField(site) {
    const select = $("filter-field");
    categoricalMeasures(Fields, site).forEach(function (measure) {
      const option = document.createElement("option");
      option.value = measure.name;
      option.textContent = capitalize(measure.term);
      select.appendChild(option);
    });
  }

  function populateMeasure(site) {
    const select = $("measure");
    Fields.measures(site).forEach(function (measure) {
      const option = document.createElement("option");
      option.value = measure.name;
      option.textContent = measure.label;
      select.appendChild(option);
    });
  }

  function populateFilterValue(site) {
    const fieldName = $("filter-field").value;
    const wrap = $("filter-value-field");
    const select = $("filter-value");
    select.textContent = "";

    if (!fieldName) {
      show(wrap, false);
      return;
    }
    const measure = Fields.measure(fieldName, site);
    valueChoices(measure, root.BINDER_COUNTRIES).forEach(function (choice) {
      const option = document.createElement("option");
      option.value = choice.value;
      option.textContent = choice.label;
      select.appendChild(option);
    });
    show(wrap, true);
  }

  /* The Trend tab, hidden rather than shown empty for a categorical
     measure - GET /charts answers trend: null for one (design mandate
     5), and this reacts to the measure select alone, with no fetch. */
  function reactToMeasure(site) {
    const measure = Fields.measure($("measure").value, site);
    const categorical = measure.kind === "categorical";
    show($("picture-tab-trend"), !categorical);
    if (categorical && $("picture-tab-trend").getAttribute("aria-selected") === "true") {
      selectPicture("distribution");
    }
  }

  /* ------------------------------------------------------------------ */
  /* The picture toggle - two views of one figure, wired by hand rather  */
  /* than a shared tab component: two tabs on one page, and the site's   */
  /* other tab grammar is retiring as page structure (0.9-M2-S2).        */

  function selectPicture(which) {
    const trend = which === "trend";
    $("picture-tab-trend").setAttribute("aria-selected", String(trend));
    $("picture-tab-distribution").setAttribute("aria-selected", String(!trend));
    show($("picture-trend"), trend);
    show($("picture-distribution"), !trend);
  }

  /* ------------------------------------------------------------------ */
  /* Drawing. Every number placed on the page is a field the route       */
  /* handed back or a pixel position derived from one - never a re-      */
  /* rounding, a re-bin, or a value this page computed from raw data.    */

  /* The fallback for no radio checked at all derives from the spec,
     exactly as apps/web/form.js's currentUnits() and apps/web/submit.js's
     currentUnits() both do (tests/charts-page.test.mjs's F2 arm: flip
     the spec's units.default, the page's initial reading follows) - a
     hardcoded literal here would be a second, driftable copy of a fact
     apps/fields.js already owns. The static HTML's own checked attribute
     on the imperial radio is a separate, pre-existing gap (noted for the
     fleet review, not this file's to close). */
  function currentSystem() {
    return UI.checkedValue("units", Fields.defaultSystem());
  }

  function unitFor(answer, system) {
    return answer.units && answer.units[system] && answer.units[system].unit
      ? answer.units[system].unit
      : null;
  }

  /* Categorical cells: a horizontal meter per cell, the shape
     .chart-track/.chart-bar already carry site-wide. Every label is
     printed verbatim from the response - "Other (fewer than 5)" and
     "Not stated" are the route's own words, not this page's. */
  function drawCells(target, cells) {
    const width = 640;
    const rowHeight = 30;
    const labelWidth = 190;
    const rightMargin = 56;
    const top = 10;
    const barArea = width - labelWidth - rightMargin;
    const height = top * 2 + cells.length * rowHeight;
    const node = target.querySelector("svg");
    node.setAttribute("viewBox", "0 0 " + width + " " + height);
    clearSvg(node);

    const most = cells.reduce(function (max, cell) {
      return Math.max(max, cell.count);
    }, 1);

    cells.forEach(function (cell, index) {
      const y = top + index * rowHeight;
      node.appendChild(svg("text", { x: 0, y: y + 15 }, "chart-label"))
        .textContent = cell.label;
      node.appendChild(svg("rect", {
        x: labelWidth, y: y + 3, width: barArea, height: 16, rx: 3,
      }, "chart-track"));
      node.appendChild(svg("rect", {
        x: labelWidth, y: y + 3,
        width: Math.max(1, (cell.count / most) * barArea),
        height: 16, rx: 3,
      }, "chart-bar"));
      node.appendChild(svg("text", {
        x: labelWidth + barArea + 8, y: y + 15,
      }, "chart-value")).textContent = String(cell.count);
    });
  }

  /* A histogram: vertical bars along a baseline, with the open-ended
     edge labels design mandate 3 asks for underneath. */
  function drawBins(target, bins, system, unit) {
    const width = 640;
    const height = 320;
    const baseline = height - 60;
    const top = 20;
    const node = target.querySelector("svg");
    node.setAttribute("viewBox", "0 0 " + width + " " + height);
    clearSvg(node);

    if (!bins.length) return;
    const most = bins.reduce(function (max, bin) {
      return Math.max(max, bin.count);
    }, 1);
    const slot = width / bins.length;

    node.appendChild(svg("line", {
      x1: 0, y1: baseline, x2: width, y2: baseline,
    }, "chart-axis"));

    bins.forEach(function (bin, index) {
      const barHeight = Math.max(1, (bin.count / most) * (baseline - top));
      const x = index * slot;
      node.appendChild(svg("rect", {
        x: x + 2, y: baseline - barHeight,
        width: Math.max(1, slot - 4), height: barHeight, rx: 2,
      }, "chart-bar"));
      node.appendChild(svg("text", {
        x: x + slot / 2, y: baseline - barHeight - 6, "text-anchor": "middle",
      }, "chart-value")).textContent = String(bin.count);

      const from = bin.from[system];
      const to = bin.to[system];
      const label = binLabel(from, to, unit);
      const text = svg("text", {
        x: x + slot / 2, y: baseline + 16, "text-anchor": "middle",
      }, "chart-label");
      text.textContent = label;
      node.appendChild(text);
    });
  }

  function drawDistribution(answer, system) {
    const target = $("figure-distribution");
    const distribution = answer.distribution;
    const unit = unitFor(answer, system);
    if (distribution.kind === "cells") {
      drawCells(target, distribution.cells);
    } else {
      drawBins(target, distribution.bins, system, unit);
    }
  }

  /* The trend line: the group average on series-0 (the accent slot)
     and, when the member asked for it and has one, their own line on
     series-1 - never floor-gated, never merged into the group series
     (design mandate 6; server/charts-agg.js's selfSeries()). One
     shared chronological axis: a trend point's period ("2026-08")
     becomes the first of that month, a self point's `at` is its own
     receipt timestamp. */
  function drawTrend(answer, system) {
    const target = $("figure-trend");
    const node = target.querySelector("svg");
    const width = 640;
    const height = 280;
    const left = 50;
    const right = 20;
    const top = 20;
    const bottom = 40;
    node.setAttribute("viewBox", "0 0 " + width + " " + height);
    clearSvg(node);

    const unit = unitFor(answer, system);
    const groupPoints = (answer.trend ? answer.trend.points : [])
      .map(function (point) {
        return { at: new Date(point.period + "-01T00:00:00Z").getTime(),
          value: point.average[system] };
      })
      .filter(function (point) { return typeof point.value === "number"; });
    const selfPoints = (answer.self && answer.self.points ? answer.self.points
      : [])
      .map(function (point) {
        return { at: new Date(point.at).getTime(), value: point.value[system] };
      })
      .filter(function (point) {
        return Number.isFinite(point.at) && typeof point.value === "number";
      });

    const all = groupPoints.concat(selfPoints);
    if (!all.length) {
      node.appendChild(svg("text", { x: width / 2, y: height / 2,
        "text-anchor": "middle" }, "chart-label")).textContent =
        "Nothing to draw yet.";
      return;
    }

    const minAt = Math.min.apply(null, all.map(function (p) { return p.at; }));
    const maxAt = Math.max.apply(null, all.map(function (p) { return p.at; }));
    const minValue = Math.min.apply(null, all.map(function (p) { return p.value; }));
    const maxValue = Math.max.apply(null, all.map(function (p) { return p.value; }));

    const x = scaleLinear(minAt, maxAt, left, width - right);
    const y = scaleLinear(minValue, maxValue, height - bottom, top);

    node.appendChild(svg("line", {
      x1: left, y1: height - bottom, x2: width - right, y2: height - bottom,
    }, "chart-axis"));

    /*
     * Two lines, two literal slots, and no cycle - design mandate 6
     * fixes the shape at exactly two: the group average on series-0
     * (the accent slot) and a member's own line on series-1. Unlike
     * apps/web/dashboard.js, which built "series-" + (index % 6) so
     * that no .series-N name ever appeared as a literal string
     * (tools/check_web.py check 21's own header explains why), this
     * page has nothing to hide from a dead-code search: the class
     * names are written out whole, which is also what lets that same
     * check read them with a plain string search instead of a cycle
     * pattern.
     */
    function drawSeries(points, seriesClass, dotClass, labelClass, label) {
      if (!points.length) return;
      if (points.length > 1) {
        const line = svg("polyline", {
          points: points.map(function (p) { return x(p.at) + "," + y(p.value); })
            .join(" "),
        }, seriesClass);
        node.appendChild(line);
      }
      points.forEach(function (p) {
        node.appendChild(svg("circle", {
          cx: x(p.at), cy: y(p.value), r: 3,
        }, dotClass));
      });
      const last = points[points.length - 1];
      const text = svg("text", {
        x: x(last.at) + 6, y: y(last.value) - 6,
      }, labelClass);
      text.textContent = label;
      node.appendChild(text);
    }

    drawSeries(groupPoints, "chart-series series-0", "chart-dot series-0",
      "chart-series-label series-0", "Average");
    if (selfPoints.length) {
      drawSeries(selfPoints, "chart-series series-1", "chart-dot series-1",
        "chart-series-label series-1", "You");
    }

    if (unit) {
      node.appendChild(svg("text", { x: left, y: top - 6 }, "chart-label"))
        .textContent = unit;
    }
  }

  /* ------------------------------------------------------------------ */
  /* The not-enough state and the drawn state. Design mandate 4: one     */
  /* document for every too-few cause, a plain paragraph inside this     */
  /* card, replacing the figure in place, no icon, no red, no dismiss -  */
  /* and security mandate 4: content on a 200, indistinguishable from    */
  /* any other floored cut in markup or timing.                          */

  function renderAnswer(answer) {
    const status = $("status");
    show($("results"), true);

    if (!answer.enough) {
      status.className = "status";
      status.textContent = answer.note;
      show($("picture-trend"), false);
      show($("picture-distribution"), false);
      return;
    }

    status.className = "status";
    status.textContent = "Showing " + answer.measure.label + ".";

    const system = currentSystem();
    const categorical = answer.measure.kind === "categorical";
    show($("picture-tab-trend"), !categorical);
    if (categorical) selectPicture("distribution");

    if (!categorical) drawTrend(answer, system);
    drawDistribution(answer, system);

    const selected = $("picture-tab-trend").getAttribute("aria-selected") ===
      "true";
    show($("picture-trend"), selected && !categorical);
    show($("picture-distribution"), !selected || categorical);
  }

  /* Download: the route's own bytes, unparsed and unreformatted
     (security mandate 6). The same object is offered whether the cut
     was enough or not - a not-enough answer is a small, honest
     document and there is no reason to withhold it. */
  let downloadUrl = null;

  function offerDownload(text) {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(
      new Blob([text], { type: "application/json" }));
    const link = $("download");
    link.href = downloadUrl;
    link.download = "charts.json";
    link.hidden = false;
  }

  /* ------------------------------------------------------------------ */
  /* Fetching. One request per Show-me press; nothing else on this page  */
  /* ever calls fetch (design mandate 2: "controls inert until pressed,  */
  /* no per-keystroke fetch").                                           */

  async function showMe() {
    const config = root.BINDER_CONFIG || {};
    const status = $("status");
    show($("results"), true);
    status.className = "status";
    status.textContent = "Loading…";

    if (!config.endpoint) {
      status.textContent = "This site is not set up to reach the " +
        "service these figures come from.";
      return;
    }

    const measureName = $("measure").value;
    const filterField = $("filter-field").value;
    const ask = { measure: measureName };
    if (filterField) {
      ask.filter = filterField;
      ask.value = $("filter-value").value;
    }

    let response;
    try {
      response = await fetch(chartsURL(config.endpoint, ask),
        { headers: Session.authorization() });
    } catch (error) {
      detail(error && error.message ? error.message : "the charts route " +
        "could not be fetched");
      status.textContent = "The figures could not be fetched — try again " +
        "shortly.";
      return;
    }

    if (response.status === 401) {
      Session.clear();
      status.textContent = "Your sign-in is no longer valid. Sign in " +
        "again to see these charts.";
      return;
    }
    if (!response.ok) {
      detail("the charts route answered " + response.status);
      status.textContent = "The service could not answer just now.";
      return;
    }

    const text = await response.text();
    offerDownload(text);

    let answer;
    try {
      answer = JSON.parse(text);
    } catch (error) {
      status.textContent = "These figures are not in a shape this page " +
        "can draw. They may have been published by a newer version of " +
        "the site — tell an admin.";
      return;
    }

    renderAnswer(answer);

    /* Re-render is free (design mandate 3: the units toggle reads a
       different key of the SAME answer). Wired here, per successful
       draw, rather than once at load, so a listener never fires
       against an answer that has not arrived yet. */
    Array.prototype.forEach.call(
      document.querySelectorAll('input[name="units"]'),
      function (input) {
        input.onchange = function () { renderAnswer(answer); };
      });
  }

  async function setUp() {
    if (!Session.require()) return;

    const site = root.BINDER_SITE;
    if (!site || !Fields) {
      $("status").textContent = "This page could not load its own " +
        "field spec, so there is nothing it can chart.";
      show($("status"), true);
      return;
    }

    populateFilterField(site);
    populateMeasure(site);
    reactToMeasure(site);

    $("filter-field").addEventListener("change", function () {
      populateFilterValue(site);
    });
    $("measure").addEventListener("change", function () {
      reactToMeasure(site);
    });
    $("picture-tab-trend").addEventListener("click", function () {
      selectPicture("trend");
    });
    $("picture-tab-distribution").addEventListener("click", function () {
      selectPicture("distribution");
    });
    $("show-me").addEventListener("click", function () {
      showMe();
    });
  }
})(globalThis);
