

(function (root) {
  "use strict";

   
   

  function capitalize(word) {
    return typeof word === "string" && word
      ? word.charAt(0).toUpperCase() + word.slice(1)
      : word;
  }

  

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

  

  function scaleLinear(domainLow, domainHigh, rangeLow, rangeHigh) {
    const span = domainHigh - domainLow;
    return function (value) {
      if (!(span > 0)) return rangeLow;
      const t = (value - domainLow) / span;
      return rangeLow + t * (rangeHigh - rangeLow);
    };
  }

  

  function categoricalMeasures(Fields, site) {
    return Fields.measures(site).filter(function (one) {
      return one.kind === "categorical";
    });
  }

  

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

  

  function reactToMeasure(site) {
    const measure = Fields.measure($("measure").value, site);
    const categorical = measure.kind === "categorical";
    show($("picture-tab-trend"), !categorical);
    if (categorical && $("picture-tab-trend").getAttribute("aria-selected") === "true") {
      selectPicture("distribution");
    }
  }

   
   
   
   

  function selectPicture(which) {
    const trend = which === "trend";
    $("picture-tab-trend").setAttribute("aria-selected", String(trend));
    $("picture-tab-distribution").setAttribute("aria-selected", String(!trend));
    show($("picture-trend"), trend);
    show($("picture-distribution"), !trend);
  }

   
   
   
   

  

  function currentSystem() {
    return UI.checkedValue("units", Fields.defaultSystem());
  }

  function unitFor(answer, system) {
    return answer.units && answer.units[system] && answer.units[system].unit
      ? answer.units[system].unit
      : null;
  }

  

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
