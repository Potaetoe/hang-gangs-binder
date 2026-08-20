

(function (root) {
  "use strict";

   
   

  function capitalize(word) {
    return typeof word === "string" && word
      ? word.charAt(0).toUpperCase() + word.slice(1)
      : word;
  }

  

  function binLabel(from, to, unit) {
    const suffix = unit ? " " + unit : "";
    return String(from) + suffix + "–" + String(to) + suffix;
  }

  

  function midpointLabel(from, to) {
    return String(Math.round((from + to) / 2));
  }

  

  const CAPTION_CHAR_WIDTH = 8;

  function captionWidth(text) {
    return String(text).length * CAPTION_CHAR_WIDTH;
  }

  

  function captionBox(index, slot, text) {
    const center = index * slot + slot / 2;
    const half = captionWidth(text) / 2;
    return { left: center - half, right: center + half };
  }

  function boxesOverlap(a, b) {
    return !(a.right <= b.left || a.left >= b.right);
  }

  

  function containBox(box, lowerBound, upperBound) {
    if (box.left < lowerBound) {
      const shift = lowerBound - box.left;
      return { left: lowerBound, right: box.right + shift };
    }
    if (box.right > upperBound) {
      const shift = box.right - upperBound;
      return { left: box.left - shift, right: upperBound };
    }
    return box;
  }

  

  function rangeCaptionPlan(labels, slot, boxOf) {
    const n = labels.length;
    if (n === 0) return [];
    const box = boxOf || function (i) { return captionBox(i, slot, labels[i]); };
    if (n === 1) return [0];

    const painted = [0];
    let lastBox = box(0);
    for (let i = 1; i < n - 1; i += 1) {
      const candidate = box(i);
      if (!boxesOverlap(candidate, lastBox)) {
        painted.push(i);
        lastBox = candidate;
      }
    }
    const lastCandidate = box(n - 1);
    while (painted.length > 1 &&
        boxesOverlap(lastCandidate, box(painted[painted.length - 1]))) {
      painted.pop();
    }
    painted.push(n - 1);
    return painted;
  }

  

  function memberCount(count) {
    return String(count) + " member" + (count === 1 ? "" : "s");
  }

  

  function binTooltipParts(from, to, unit, count) {
    return { lead: binLabel(from, to, unit) + ": ", number: memberCount(count) };
  }

   
   
   
   
   
   
  const MONTH_NAMES = ["January", "February", "March", "April", "May",
    "June", "July", "August", "September", "October", "November",
    "December"];

  function monthLabel(atMillis) {
    const d = new Date(atMillis);
    return MONTH_NAMES[d.getUTCMonth()] + " " + d.getUTCFullYear();
  }

  

  function trendTooltipParts(atMillis, seriesLabel, value, unit) {
    const suffix = unit ? " " + unit : "";
    return { lead: monthLabel(atMillis) + " — " + seriesLabel + ": ",
      number: String(value) + suffix };
  }

  

  function countAxisTicks(maxCount) {
    if (!(maxCount > 0)) return [0];
    const target = 5;
    const raw = maxCount / target;
    const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
    const bases = [1, 2, 5, 10];
    let step = 10 * magnitude;
    for (let i = 0; i < bases.length; i += 1) {
      const candidate = bases[i] * magnitude;
      if (candidate >= raw) { step = candidate; break; }
    }
    step = Math.max(1, Math.round(step));
    const ticks = [];
    for (let v = 0; v <= maxCount + 1e-9; v += step) ticks.push(v);
    if (ticks[ticks.length - 1] < maxCount) {
      ticks.push(ticks[ticks.length - 1] + step);
    }
    return ticks;
  }

  

  function valueAxisTicks(minValue, maxValue) {
    if (!(maxValue > minValue)) return [minValue];
    return [minValue, (minValue + maxValue) / 2, maxValue];
  }

  

  function positionTooltipBox(anchorBox, figureBox, tipBox) {
    let left = anchorBox.left - figureBox.left +
      anchorBox.width / 2 - tipBox.width / 2;
    let top = anchorBox.top - figureBox.top - tipBox.height - 8;
    if (top < 0) top = anchorBox.bottom - figureBox.top + 8;  

    if (left < 0) left = 0;
    if (left + tipBox.width > figureBox.width) {
      left = figureBox.width - tipBox.width;
    }

    if (top + tipBox.height > figureBox.height) {
      top = figureBox.height - tipBox.height;
    }
    if (top < 0) top = 0;

    return { left: left, top: top };
  }

  

  function drawableMeasures(Fields, site) {
    return Fields.measures(site).filter(function (one) {
      return one.kind !== "categorical";
    });
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

  

  function groupCellLabel(measure, cell, countries) {
    if (measure && measure.choicesFrom === "countries" &&
        cell.bucket !== "blank") {
      const table = countries || {};
      return table[cell.value] || cell.label;
    }
    return cell.label;
  }

  

  function chartsURL(endpoint, ask) {
    const url = new URL(endpoint + "/charts-data");
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
    midpointLabel: midpointLabel,
    captionWidth: captionWidth,
    captionBox: captionBox,
    containBox: containBox,
    rangeCaptionPlan: rangeCaptionPlan,
    memberCount: memberCount,
    binTooltipParts: binTooltipParts,
    monthLabel: monthLabel,
    trendTooltipParts: trendTooltipParts,
    countAxisTicks: countAxisTicks,
    valueAxisTicks: valueAxisTicks,
    positionTooltipBox: positionTooltipBox,
    scaleLinear: scaleLinear,
    categoricalMeasures: categoricalMeasures,
    drawableMeasures: drawableMeasures,
    valueChoices: valueChoices,
    groupCellLabel: groupCellLabel,
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

   
   
   
   
   
   
   
   
   
   

  let pinnedTooltipTarget = null;
  let pinnedTooltipElement = null;

  

  function positionTooltip(tip, anchor, figure) {
    if (typeof anchor.getBoundingClientRect !== "function" ||
        typeof figure.getBoundingClientRect !== "function" ||
        typeof tip.getBoundingClientRect !== "function") {
      return;
    }
    const position = positionTooltipBox(
      anchor.getBoundingClientRect(), figure.getBoundingClientRect(),
      tip.getBoundingClientRect());
    tip.style.left = position.left + "px";
    tip.style.top = position.top + "px";
  }

  

  function showTooltip(tip, anchor, figure, parts) {
    if (!tip) return;
    tip.textContent = "";
    const lead = document.createElement("span");
    lead.textContent = parts.lead;
    const number = document.createElement("span");
    number.className = "chart-tooltip-number";
    number.textContent = parts.number;
    tip.appendChild(lead);
    tip.appendChild(number);
    show(tip, true);
    positionTooltip(tip, anchor, figure);
  }

  function hideTooltip(tip) {
    if (!tip) return;
    show(tip, false);
    tip.textContent = "";
  }

  

  function resetTooltip(tip) {
    pinnedTooltipTarget = null;
    pinnedTooltipElement = null;
    hideTooltip(tip);
  }

  

  function wireTooltip(el, figure, tip, parts) {
    el.addEventListener("mouseenter", function () {
      if (pinnedTooltipTarget) return;
      showTooltip(tip, el, figure, parts);
    });
    el.addEventListener("mouseleave", function () {
      if (pinnedTooltipTarget) return;
      hideTooltip(tip);
    });
    el.addEventListener("click", function (event) {
       
       
       
       
      if (event && typeof event.stopPropagation === "function") {
        event.stopPropagation();
      }
      pinnedTooltipTarget = el;
      pinnedTooltipElement = tip;
      showTooltip(tip, el, figure, parts);
    });
  }

  

  function dismissTooltipElsewhere() {
    if (!pinnedTooltipTarget) return;
    const tip = pinnedTooltipElement;
    pinnedTooltipTarget = null;
    pinnedTooltipElement = null;
    hideTooltip(tip);
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
    drawableMeasures(Fields, site).forEach(function (measure) {
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

  

  function drawBins(target, tip, bins, system, unit) {
    resetTooltip(tip);
    const width = 640;
    const height = 320;
    const baseline = height - 60;
    const top = 20;
     
     
     
     
    const left = 50;
    const node = target.querySelector("svg");
    node.setAttribute("viewBox", "0 0 " + width + " " + height);
    clearSvg(node);

    if (!bins.length) return;
    const tallest = bins.reduce(function (max, bin) {
      return Math.max(max, bin.count);
    }, 1);
    const countTicks = countAxisTicks(tallest);
     
     
     
     
     
     
     
     
     
     
     
     
     
     
    const most = countTicks[countTicks.length - 1];
    const plotWidth = width - left;
    const slot = plotWidth / bins.length;

    const midpointLabels = bins.map(function (bin) {
      return midpointLabel(bin.from[system], bin.to[system]);
    });

     
     
     
     
     
    const rightBound = unit
      ? width - captionWidth(unit) - CAPTION_CHAR_WIDTH
      : width;

     
     
     
     
    const boxOf = function (i) {
      const raw = captionBox(i, slot, midpointLabels[i]);
      return containBox(
        { left: left + raw.left, right: left + raw.right },
        left, rightBound);
    };
    const labeledIndexes = new Set(rangeCaptionPlan(midpointLabels, slot, boxOf));

    node.appendChild(svg("line", {
      x1: left, y1: baseline, x2: width, y2: baseline,
    }, "chart-axis"));

     
     
     
     
     
     
     
     
     
    countTicks.forEach(function (tick) {
      const y = baseline - (tick / most) * (baseline - top);
      node.appendChild(svg("text", {
        x: left - 8, y: y + 4, "text-anchor": "end",
      }, "chart-label")).textContent = String(tick);
    });

    bins.forEach(function (bin, index) {
      const barHeight = bin.count > 0
        ? Math.max(1, (bin.count / most) * (baseline - top))
        : 0;
      const x = left + index * slot;
      node.appendChild(svg("rect", {
        x: x + 2, y: baseline - barHeight,
        width: Math.max(1, slot - 4), height: barHeight, rx: 2,
      }, "chart-bar"));

      if (labeledIndexes.has(index)) {
        const box = boxOf(index);
        const text = svg("text", {
          x: (box.left + box.right) / 2, y: baseline + 16,
          "text-anchor": "middle",
        }, "chart-label");
        text.textContent = midpointLabels[index];
        node.appendChild(text);
      }

       
       
       
       
       
       
       
       
       
       
       
       
      const hit = svg("rect", {
        x: x, y: top, width: slot, height: baseline - top, fill: "transparent",
      }, "chart-hit");
      node.appendChild(hit);
      wireTooltip(hit, target, tip, binTooltipParts(
        bin.from[system], bin.to[system], unit, bin.count));
    });

     
     
     
     
     
     
    if (unit) {
      node.appendChild(svg("text", {
        x: width, y: baseline + 16, "text-anchor": "end",
      }, "chart-label")).textContent = unit;
    }
  }

  function drawDistribution(answer, system) {
    const target = $("figure-distribution");
    const tip = $("tooltip-distribution");
    const unit = unitFor(answer, system);
    drawBins(target, tip, answer.distribution.bins, system, unit);
  }

  

  

  const NOT_ENOUGH_FOR_CATEGORY = "Not enough people to show this.";

  

  const MULTIPLE_CHOICE_HINT = "Members can choose more than one here, " +
    "so these numbers can add up to more than the group.";

  

  function renderChip(name, count) {
    const chip = document.createElement("span");
    chip.className = count === 0 ? "chip chip-zero" : "chip";
    const nameEl = document.createElement("span");
    nameEl.className = "chip-name";
    nameEl.textContent = name;
    const countEl = document.createElement("span");
    countEl.className = "chip-count";
    countEl.textContent = String(count);
    chip.appendChild(nameEl);
    chip.appendChild(countEl);
    return chip;
  }

  function renderGroups(groups) {
    const card = $("groups");
    const body = $("groups-body");
    body.textContent = "";
    if (!groups || !groups.length) {
      show(card, false);
      return;
    }
    const site = root.BINDER_SITE;
    groups.forEach(function (group) {
      const heading = document.createElement("h3");
      heading.textContent = group.label;
      body.appendChild(heading);

      if (!group.values.length) {
        const empty = document.createElement("p");
        empty.className = "status";
        empty.textContent = NOT_ENOUGH_FOR_CATEGORY;
        body.appendChild(empty);
        return;
      }

      const measure = Fields.measure(group.field, site);
      const row = document.createElement("div");
      row.className = "chip-row";
      group.values.forEach(function (cell) {
        row.appendChild(renderChip(
          groupCellLabel(measure, cell, root.BINDER_COUNTRIES), cell.count));
      });
      body.appendChild(row);

      if (group.multiple) {
        const hint = document.createElement("p");
        hint.className = "muted small";
        hint.textContent = MULTIPLE_CHOICE_HINT;
        body.appendChild(hint);
      }
    });
    show(card, true);
  }

  

  function drawTrend(answer, system) {
    const target = $("figure-trend");
    const tip = $("tooltip-trend");
    resetTooltip(tip);
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

     
     
     
     
     
     
    valueAxisTicks(minValue, maxValue).forEach(function (tick) {
      node.appendChild(svg("text", {
        x: left - 8, y: y(tick) + 4, "text-anchor": "end",
      }, "chart-label")).textContent = String(tick);
    });

    

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
        const dot = svg("circle", {
          cx: x(p.at), cy: y(p.value), r: 3,
        }, dotClass);
        node.appendChild(dot);
         
         
         
         
         
        wireTooltip(dot, target, tip,
          trendTooltipParts(p.at, label, p.value, unit));
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

  

  const BROADER_FILTER_HINT = "Try Everyone or a broader filter.";

   
   
   
   
   
   

  function renderAnswer(answer) {
    const status = $("status");
    show($("results"), true);

    if (!answer.enough) {
      status.className = "status";
      status.textContent = answer.note + " " + BROADER_FILTER_HINT;
      show($("picture-trend"), false);
      show($("picture-distribution"), false);
      renderGroups(null);
      return;
    }

    status.className = "status";
    status.textContent = "Showing " + answer.measure.label + ".";

    const system = currentSystem();
    drawTrend(answer, system);
    drawDistribution(answer, system);

    const selected = $("picture-tab-trend").getAttribute("aria-selected") ===
      "true";
    show($("picture-trend"), selected);
    show($("picture-distribution"), !selected);

    renderGroups(answer.groups);
  }

  

  let lastAnswerText = null;

  function offerDownload(text) {
    lastAnswerText = text;
    $("download").hidden = false;
  }

  function wireDownload() {
    $("download").addEventListener("click", function () {
      if (!lastAnswerText) return;
      const url = URL.createObjectURL(
        new Blob([lastAnswerText], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "charts.json";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    });
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

    $("filter-field").addEventListener("change", function () {
      populateFilterValue(site);
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
    wireDownload();
     
     
     
     
    document.addEventListener("click", dismissTooltipElsewhere);
  }
})(globalThis);
