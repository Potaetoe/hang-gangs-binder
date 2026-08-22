

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

  

  function trimTrailingEmptyBins(bins) {
    let lastNonEmpty = -1;
    for (let i = 0; i < bins.length; i += 1) {
      if (bins[i].count > 0) lastNonEmpty = i;
    }
    return lastNonEmpty === -1 ? bins : bins.slice(0, lastNonEmpty + 1);
  }

  

  function tickLabel(edge) {
    return String(edge);
  }

  

  function showingLine(measureLabel, unit, filterWords) {
    const lead = filterWords ? filterWords + " - " : "";
    return "Showing " + lead + measureLabel + (unit ? " (" + unit + ")" : "") +
      ".";
  }

  

  function unitLockNote(unit) {
    return "These figures are only shown in " + unit + ".";
  }

  

  const CAPTION_CHAR_WIDTH = 8;

  function captionWidth(text) {
    return String(text).length * CAPTION_CHAR_WIDTH;
  }

  

  function tickBox(index, slot, text) {
    const center = index * slot;
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

  

  function labelRowPlan(labels, slot, boxOf) {
    const n = labels.length;
    if (n === 0) return [];
    const box = boxOf || function (i) { return tickBox(i, slot, labels[i]); };
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
    (ask.filters || []).forEach(function (pair) {
      url.searchParams.append("filter", pair.field);
      url.searchParams.append("value", pair.value);
    });
    

    url.searchParams.set("units", ask.units);
    url.searchParams.set("self", "1");
    return url.toString();
  }

  

  const COMBINED_FILTERS_ENABLED = false;

  

  function presentValuesOf(groupEntry, measure, countries) {
    return (groupEntry && groupEntry.values ? groupEntry.values : [])
      .filter(function (cell) { return cell.count > 0 && cell.value !== null; })
      .map(function (cell) {
        return { value: cell.value, label: groupCellLabel(measure, cell, countries) };
      });
  }

  

  function pinFirst(list, pinnedCodes) {
    const present = {};
    list.forEach(function (c) { present[c.value] = c; });
    const pinnedSeen = {};
    const front = (pinnedCodes || [])
      .filter(function (code) {
        return Object.prototype.hasOwnProperty.call(present, code) &&
          !pinnedSeen[code];
      })
      .map(function (code) { pinnedSeen[code] = true; return present[code]; });
    const rest = list.filter(function (c) {
      return !Object.prototype.hasOwnProperty.call(pinnedSeen, c.value);
    });
    return front.concat(rest);
  }

  

  function rowsUsed(tops) {
    if (!tops || !tops.length) return 0;
    const rounded = tops.map(function (t) { return Math.round(t); });
    return new Set(rounded).size;
  }

  function fitsTwoRows(tops) {
    return rowsUsed(tops) <= 2;
  }

  

  function decideMode(tops) {
    if (tops.some(function (t) { return typeof t !== "number"; })) return "chips";
    return fitsTwoRows(tops) ? "chips" : "list";
  }

  const WITHIN_FIELD_GATE_NOTICE = "Choosing several at once is being " +
    "reviewed.";
  const CROSS_FIELD_GATE_NOTICE = "Combining filters is being reviewed.";

  

  function fieldIsRestricted(fieldState) {
    return fieldState.selected.length > 0 &&
      fieldState.selected.length < fieldState.candidateValues.length;
  }

  

  function nextFieldSelection(fieldState, tappedValue, anyOtherFieldRestricted,
      combinedEnabled) {
    const wasSelected = fieldState.selected.indexOf(tappedValue) !== -1;
    const allValues = fieldState.candidateValues.map(function (c) {
      return c.value;
    });

    if (combinedEnabled) {
      if (wasSelected) {
        if (fieldState.selected.length === 1) {
          return { selected: fieldState.selected, notice: null };
        }
        return { selected: fieldState.selected.filter(function (v) {
          return v !== tappedValue;
        }), notice: null };
      }
      return { selected: fieldState.selected.concat([tappedValue]),
        notice: null };
    }

    if (fieldIsRestricted(fieldState)) {
      if (wasSelected) return { selected: allValues, notice: null };
      return { selected: fieldState.selected, notice: WITHIN_FIELD_GATE_NOTICE };
    }
    if (anyOtherFieldRestricted) {
      return { selected: fieldState.selected, notice: CROSS_FIELD_GATE_NOTICE };
    }
    return { selected: [tappedValue], notice: null };
  }

  

  function activeFilterPairs(fieldStates) {
    const pairs = [];
    (fieldStates || []).forEach(function (state) {
      if (state.selected.length === state.candidateValues.length) return;
      state.candidateValues.forEach(function (c) {
        if (state.selected.indexOf(c.value) !== -1) {
          pairs.push({ field: state.field, value: c.value });
        }
      });
    });
    return pairs;
  }

  

  function filterValueLabel(pair, measureFor, countries) {
    const measure = measureFor(pair.field);
    if (measure && measure.choicesFrom === "countries") {
      const table = countries || {};
      return table[pair.value] || pair.value;
    }
    const choices = (measure && measure.choices) || [];
    const found = choices.filter(function (c) { return c.value === pair.value; })[0];
    const label = found ? found.label : pair.value;
    return label.toLowerCase();
  }

  

  function activeFilterWords(filters, measureFor, countries) {
    if (!filters || !filters.length) return "";
    const order = [];
    const byField = {};
    filters.forEach(function (pair) {
      if (!Object.prototype.hasOwnProperty.call(byField, pair.field)) {
        byField[pair.field] = [];
        order.push(pair.field);
      }
      byField[pair.field].push(filterValueLabel(pair, measureFor, countries));
    });
    return order.map(function (field) { return byField[field].join("/"); })
      .join(" ");
  }

  

  const BROADER_FILTER_HINT = "Try Everyone or a broader filter.";

  

  function unitFor(answer) {
    return answer.units && answer.units.unit ? answer.units.unit : null;
  }

  

  function unitLocked(answer) {
    return Boolean(answer.units && answer.units.locked);
  }

  

  function workbookColumns(unit) {
    const suffix = unit ? " (" + unit + ")" : "";
    return ["Section", "Label", "Count", "Average" + suffix, "You" + suffix];
  }

  

  function workbookRows(answer, countries, measureFor) {
    const words = activeFilterWords(answer.filters, measureFor, countries);
    const filterRow = ["Filters", words || "Everyone", "", "", ""];

    if (!answer.enough) {
      return [filterRow, ["Status", answer.note + " " + BROADER_FILTER_HINT,
        "", "", ""]];
    }

    const unit = unitFor(answer);
    const rows = [filterRow];

    trimTrailingEmptyBins(
      answer.distribution ? answer.distribution.bins : []).forEach(
      function (bin) {
        rows.push(["Distribution", binLabel(bin.from, bin.to, unit),
          bin.count, "", ""]);
      });

    (answer.trend && answer.trend.points ? answer.trend.points : [])
      .forEach(function (point) {
        const at = new Date(point.period + "-01T00:00:00Z").getTime();
        rows.push(["Trend", monthLabel(at), "", point.average, ""]);
      });
    (answer.self && answer.self.points ? answer.self.points : [])
      .forEach(function (point) {
        rows.push(["Trend", monthLabel(new Date(point.at).getTime()), "",
          "", point.value]);
      });

    (answer.groups || []).forEach(function (group) {
      const measure = measureFor(group.field);
      (group.values || []).forEach(function (cell) {
        rows.push(["Group makeup — " + group.label,
          groupCellLabel(measure, cell, countries), cell.count, "", ""]);
      });
    });

    return rows;
  }

  const Pure = {
    capitalize: capitalize,
    binLabel: binLabel,
    trimTrailingEmptyBins: trimTrailingEmptyBins,
    tickLabel: tickLabel,
    showingLine: showingLine,
    UNIT_LOCK_NOTE: unitLockNote,
    captionWidth: captionWidth,
    tickBox: tickBox,
    containBox: containBox,
    labelRowPlan: labelRowPlan,
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
    unitFor: unitFor,
    unitLocked: unitLocked,
    workbookColumns: workbookColumns,
    workbookRows: workbookRows,
    BROADER_FILTER_HINT: BROADER_FILTER_HINT,
    COMBINED_FILTERS_ENABLED: COMBINED_FILTERS_ENABLED,
    presentValuesOf: presentValuesOf,
    pinFirst: pinFirst,
    rowsUsed: rowsUsed,
    fitsTwoRows: fitsTwoRows,
    decideMode: decideMode,
    fieldIsRestricted: fieldIsRestricted,
    nextFieldSelection: nextFieldSelection,
    activeFilterPairs: activeFilterPairs,
    filterValueLabel: filterValueLabel,
    activeFilterWords: activeFilterWords,
    WITHIN_FIELD_GATE_NOTICE: WITHIN_FIELD_GATE_NOTICE,
    CROSS_FIELD_GATE_NOTICE: CROSS_FIELD_GATE_NOTICE,
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

   
   

  function populateMeasure(site) {
    const select = $("measure");
    drawableMeasures(Fields, site).forEach(function (measure) {
      const option = document.createElement("option");
      option.value = measure.name;
      option.textContent = measure.label;
      select.appendChild(option);
    });
  }

   
   
   
   

  

  function buildFieldStates(site, groups) {
    return categoricalMeasures(Fields, site).map(function (measure) {
      const entry = (groups || []).filter(function (g) {
        return g.field === measure.name;
      })[0];
      let candidates = entry
        ? presentValuesOf(entry, measure, root.BINDER_COUNTRIES) : [];
      if (measure.choicesFrom === "countries") {
        candidates = pinFirst(candidates, Fields.pinnedCountries(site));
      }
      return {
        field: measure.name,
        label: measure.label,
        candidateValues: candidates,
         
         
         
        selected: candidates.map(function (c) { return c.value; }),
      };
    }).filter(function (state) { return state.candidateValues.length > 0; });
  }

  function fieldState(fieldName) {
    return fieldStates.filter(function (s) { return s.field === fieldName; })[0]
      || null;
  }

  

  function anyOtherFieldRestricted(exceptField) {
    return fieldStates.some(function (s) {
      return s.field !== exceptField && fieldIsRestricted(s);
    });
  }

  function buildChipButtons(state) {
    return state.candidateValues.map(function (choice) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "filter-chip";
      button.setAttribute("data-value", choice.value);
      button.textContent = choice.label;
      button.setAttribute("aria-pressed",
        String(state.selected.indexOf(choice.value) !== -1));
      return button;
    });
  }

  

  function measuredTops(elements) {
    return elements.map(function (el) {
      return typeof el.getBoundingClientRect === "function"
        ? el.getBoundingClientRect().top : null;
    });
  }

  function wireChipRow(state, chips, notice) {
    const crossRestricted = anyOtherFieldRestricted(state.field);
    const thisRestricted = fieldIsRestricted(state);
    chips.forEach(function (chip) {
      const value = chip.getAttribute("data-value");
      const selected = state.selected.indexOf(value) !== -1;
      let disabled = false;
      if (!COMBINED_FILTERS_ENABLED) {
        if (crossRestricted && !thisRestricted) disabled = true;
        else if (thisRestricted && !selected) disabled = true;
      }
      chip.disabled = disabled;
      chip.addEventListener("click", function () {
        const field = fieldState(state.field);
        if (!field) return;
        const result = nextFieldSelection(field, value,
          anyOtherFieldRestricted(field.field), COMBINED_FILTERS_ENABLED);
        field.selected = result.selected;
        if (result.notice) {
          notice.textContent = result.notice;
          notice.hidden = false;
          return;
        }
        renderFilterRows();
      });
    });
    if (!COMBINED_FILTERS_ENABLED) {
      if (crossRestricted && !thisRestricted) {
        notice.textContent = CROSS_FIELD_GATE_NOTICE;
        notice.hidden = false;
      } else if (thisRestricted) {
        notice.textContent = WITHIN_FIELD_GATE_NOTICE;
        notice.hidden = false;
      }
    }
  }

  

  function buildFilterSelect(state) {
    const select = document.createElement("select");
    select.id = "filter-select-" + state.field;
    if (COMBINED_FILTERS_ENABLED) {
      select.multiple = true;
    } else {
      const everyone = document.createElement("option");
      everyone.value = "";
      everyone.textContent = "Everyone";
      select.appendChild(everyone);
    }
    state.candidateValues.forEach(function (choice) {
      const option = document.createElement("option");
      option.value = choice.value;
      option.textContent = choice.label;
      if (COMBINED_FILTERS_ENABLED) {
        option.selected = state.selected.indexOf(choice.value) !== -1;
      } else if (state.selected.length === 1 &&
          state.selected[0] === choice.value) {
        option.selected = true;
      }
      select.appendChild(option);
    });
    return select;
  }

  function wireFilterSelect(state, select, notice) {
    if (COMBINED_FILTERS_ENABLED) {
      select.addEventListener("change", function () {
        const field = fieldState(state.field);
        if (!field) return;
         
         
         
        const chosen = Array.prototype.filter.call(select.children,
          function (o) { return o.selected; })
          .map(function (o) { return o.value; });
         
         
         
        field.selected = chosen.length ? chosen : field.selected;
        renderFilterRows();
      });
      return;
    }
    const crossRestricted = anyOtherFieldRestricted(state.field);
    select.disabled = crossRestricted;
    if (crossRestricted) {
      notice.textContent = CROSS_FIELD_GATE_NOTICE;
      notice.hidden = false;
    }
    select.addEventListener("change", function () {
      const field = fieldState(state.field);
      if (!field) return;
      const value = select.value;
      if (value === "") {
        field.selected = field.candidateValues.map(function (c) {
          return c.value;
        });
        renderFilterRows();
        return;
      }
      if (anyOtherFieldRestricted(field.field)) {
         
         
         
        select.value = field.selected.length === 1 ? field.selected[0] : "";
        notice.textContent = CROSS_FIELD_GATE_NOTICE;
        notice.hidden = false;
        return;
      }
      field.selected = [value];
      renderFilterRows();
    });
  }

  

  function buildFilterRow(container, state) {
    const row = document.createElement("div");
    row.className = "field filter-row";
    row.setAttribute("data-field", state.field);

    const label = document.createElement("label");
    label.id = "filter-label-" + state.field;
    label.textContent = state.label;
    row.appendChild(label);
    container.appendChild(row);

    const chips = buildChipButtons(state);
    const chipRow = document.createElement("div");
    chipRow.className = "chip-row filter-chip-row";
    chipRow.setAttribute("role", "group");
    chipRow.setAttribute("aria-labelledby", label.id);
    chips.forEach(function (chip) { chipRow.appendChild(chip); });
    row.appendChild(chipRow);

    const notice = document.createElement("p");
    notice.className = "hint filter-notice";
    notice.hidden = true;

    const mode = decideMode(measuredTops(chips));
    if (mode === "chips") {
      row.appendChild(notice);
      wireChipRow(state, chips, notice);
    } else {
      row.removeChild(chipRow);
      const select = buildFilterSelect(state);
      label.setAttribute("for", select.id);
      row.appendChild(select);
      row.appendChild(notice);
      wireFilterSelect(state, select, notice);
    }
  }

  function renderFilterRows() {
    const container = $("filter-rows");
    container.textContent = "";
    fieldStates.forEach(function (state) {
      buildFilterRow(container, state);
    });
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

  

  function drawBins(target, tip, bins, unit) {
    resetTooltip(tip);
    const width = 640;
    const height = 320;
    const baseline = height - 60;
    const top = 20;
     
     
     
     
    const left = 50;
     
     
     
     
     
     
    const right = 20;
    const node = target.querySelector("svg");
    node.setAttribute("viewBox", "0 0 " + width + " " + height);
    clearSvg(node);

    if (!bins.length) return;
    const tallest = bins.reduce(function (max, bin) {
      return Math.max(max, bin.count);
    }, 1);
    const countTicks = countAxisTicks(tallest);
     
     
     
     
     
     
     
     
     
     
     
     
     
     
    const most = countTicks[countTicks.length - 1];
    const plotWidth = width - left - right;
    const slot = plotWidth / bins.length;

     
     
     
     
    const edges = [bins[0].from].concat(bins.map(function (bin) {
      return bin.to;
    }));
    const tickLabels = edges.map(tickLabel);

     
     
     
     
    const boxOf = function (i) {
      const raw = tickBox(i, slot, tickLabels[i]);
      return containBox(
        { left: left + raw.left, right: left + raw.right }, 0, width);
    };
    const labeledIndexes = new Set(labelRowPlan(tickLabels, slot, boxOf));

    node.appendChild(svg("line", {
      x1: left, y1: baseline, x2: left + plotWidth, y2: baseline,
    }, "chart-axis"));

     
     
     
     
     
     
     
    tickLabels.forEach(function (label, index) {
      if (!labeledIndexes.has(index)) return;
      const x = left + index * slot;
      node.appendChild(svg("line", {
        x1: x, y1: baseline, x2: x, y2: baseline + 5,
      }, "chart-axis"));
      const box = boxOf(index);
      const text = svg("text", {
        x: (box.left + box.right) / 2, y: baseline + 18,
        "text-anchor": "middle",
      }, "chart-label");
      text.textContent = label;
      node.appendChild(text);
    });

     
     
     
     
     
     
     
     
     
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

       
       
       
       
       
       
       
       
       
       
       
       
      const hit = svg("rect", {
        x: x, y: top, width: slot, height: baseline - top, fill: "transparent",
      }, "chart-hit");
      node.appendChild(hit);
      wireTooltip(hit, target, tip, binTooltipParts(
        bin.from, bin.to, unit, bin.count));
    });
  }

  function drawDistribution(answer) {
    const target = $("figure-distribution");
    const tip = $("tooltip-distribution");
    const unit = unitFor(answer);
     
     
     
     
    const bins = trimTrailingEmptyBins(answer.distribution.bins);
    drawBins(target, tip, bins, unit);
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
    const site = effectiveSite;
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

  

  function drawTrend(answer) {
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

    const unit = unitFor(answer);
    const groupPoints = (answer.trend ? answer.trend.points : [])
      .map(function (point) {
        return { at: new Date(point.period + "-01T00:00:00Z").getTime(),
          value: point.average };
      })
      .filter(function (point) { return typeof point.value === "number"; });
    const selfPoints = (answer.self && answer.self.points ? answer.self.points
      : [])
      .map(function (point) {
        return { at: new Date(point.at).getTime(), value: point.value };
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

     
     
     
     
     
  }

   
   
   
   
   
   

  

  function applyUnitLock(answer) {
    const locked = unitLocked(answer);
    const system = answer.units ? answer.units.system : null;
    Array.prototype.forEach.call(
      document.querySelectorAll('input[name="units"]'),
      function (input) {
        input.disabled = locked;
        if (locked) {
          input.onchange = null;
          if (system) input.checked = input.value === system;
        } else {
          

          input.onchange = function () {
            dismissTooltipElsewhere();
            showMe();
          };
        }
      });
  }

  function renderAnswer(answer) {
    const status = $("status");
    show($("results"), true);
     
     
     
    applyUnitLock(answer);

    if (!answer.enough) {
      status.className = "status";
      status.textContent = answer.note + " " + BROADER_FILTER_HINT;
       
       
       
       
      show($("picture-field"), false);
      show($("picture-trend"), false);
      show($("picture-distribution"), false);
      renderGroups(null);
      return;
    }

    

    status.className = "status";
    const unit = unitFor(answer);
    const filterWords = activeFilterWords(answer.filters,
      function (fieldName) { return Fields.measure(fieldName, effectiveSite); },
      root.BINDER_COUNTRIES);
    status.textContent = showingLine(answer.measure.label, unit, filterWords) +
      (unitLocked(answer) && unit ? " " + unitLockNote(unit) : "");

    drawTrend(answer);
    drawDistribution(answer);

     
     
     
     
     
    show($("picture-field"), true);
    const selected = $("picture-tab-trend").getAttribute("aria-selected") ===
      "true";
    show($("picture-trend"), selected);
    show($("picture-distribution"), !selected);

    renderGroups(answer.groups);
  }

  

  let lastAnswer = null;

  function offerDownload(answer) {
    lastAnswer = answer;
    $("download").hidden = false;
  }

  function wireDownload() {
    $("download").addEventListener("click", function () {
      if (!lastAnswer) return;
      const columns = workbookColumns(unitFor(lastAnswer));
      const rows = workbookRows(lastAnswer, root.BINDER_COUNTRIES,
        function (fieldName) { return Fields.measure(fieldName, effectiveSite); });
      const bytes = root.BinderXlsx.build(columns, rows, "Charts",
        Date.now());
      const url = URL.createObjectURL(new Blob([bytes], { type:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "charts.xlsx";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    });
  }

   
   
   
   
   

  

  let effectiveSite = null;
  let fieldStates = [];

  

  async function fetchAnswer(config, ask) {
    let response;
    try {
      response = await fetch(chartsURL(config.endpoint, ask),
        { headers: Session.authorization() });
    } catch (error) {
      detail(error && error.message ? error.message : "the charts route " +
        "could not be fetched");
      return { ok: false, message: "The figures could not be fetched — " +
        "try again shortly." };
    }
    if (response.status === 401) {
      Session.clear();
      return { ok: false, message: "Your sign-in is no longer valid. " +
        "Sign in again to see these charts." };
    }
    if (!response.ok) {
      detail("the charts route answered " + response.status);
      return { ok: false, message: "The service could not answer just now." };
    }
    const text = await response.text();
    let answer;
    try {
      answer = JSON.parse(text);
    } catch (error) {
      return { ok: false, message: "These figures are not in a shape " +
        "this page can draw. They may have been published by a newer " +
        "version of the site — tell an admin." };
    }
    return { ok: true, answer: answer };
  }

  

  async function fetchSpec(config) {
    let response;
    try {
      response = await fetch(config.endpoint + "/spec",
        { headers: Session.authorization() });
    } catch (error) {
      detail(error && error.message ? error.message : "the spec route " +
        "could not be fetched");
      return { ok: false, message: "This page could not load its own " +
        "field spec, so there is nothing it can chart." };
    }
    if (response.status === 401) {
      Session.clear();
      return { ok: false, message: "Your sign-in is no longer valid. " +
        "Sign in again to see these charts." };
    }
    if (!response.ok) {
      detail("the spec route answered " + response.status);
      return { ok: false, message: "This page could not load its own " +
        "field spec, so there is nothing it can chart." };
    }
    let payload;
    try {
      payload = JSON.parse(await response.text());
    } catch (error) {
      return { ok: false, message: "This page could not load its own " +
        "field spec, so there is nothing it can chart." };
    }
    const spec = payload && payload.spec && typeof payload.spec === "object"
      ? payload.spec : null;
    if (!spec) {
      return { ok: false, message: "This page could not load its own " +
        "field spec, so there is nothing it can chart." };
    }
    return { ok: true, spec: spec };
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

    const ask = { measure: $("measure").value, units: currentSystem(),
      filters: activeFilterPairs(fieldStates) };
    const result = await fetchAnswer(config, ask);
    if (!result.ok) {
      status.textContent = result.message;
      return;
    }

    renderAnswer(result.answer);
     
     
     
     
     
     
    offerDownload(result.answer);
    

  }

  async function setUp() {
    if (!Session.require()) return;

    const config = root.BINDER_CONFIG || {};
    if (!config.endpoint) {
      $("status").textContent = "This site is not set up to reach the " +
        "service these figures come from.";
      show($("status"), true);
      return;
    }

    const specResult = await fetchSpec(config);
    if (!specResult.ok) {
      $("status").textContent = specResult.message;
      show($("status"), true);
      return;
    }
    effectiveSite = specResult.spec;
    if (!Fields) {
      $("status").textContent = "This page could not load its own " +
        "field spec, so there is nothing it can chart.";
      show($("status"), true);
      return;
    }

    populateMeasure(effectiveSite);

    

    const drawable = drawableMeasures(Fields, effectiveSite);
    let baselineGroups = null;
    if (drawable.length) {
      const baseline = await fetchAnswer(config,
        { measure: drawable[0].name, units: currentSystem(), filters: [] });
      if (baseline.ok && baseline.answer.enough) {
        baselineGroups = baseline.answer.groups;
      }
    }
    fieldStates = buildFieldStates(effectiveSite, baselineGroups);
    renderFilterRows();

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

     
     
     
    let resizeTimer = null;
    root.addEventListener("resize", function () {
      if (resizeTimer !== null) root.clearTimeout(resizeTimer);
      resizeTimer = root.setTimeout(renderFilterRows, 150);
    });
  }
})(globalThis);
