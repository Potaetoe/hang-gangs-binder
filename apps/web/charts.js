/*
 * Charts: filter, measure, two pictures, a group-makeup block, no
 * snapshot (0.9-M2-S3, #354; reshaped by the 2026-08-19 charts ruling,
 * #243 comment 5346978974, and 0.9-M2-S10/S11).
 *
 * RENDER-ONLY, ON PURPOSE (security mandate 1). This file prints the
 * fields GET /charts-data hands back and does no suppression arithmetic of
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
 * WHAT THE RULING CHANGED HERE. Categorical measures (gender,
 * affiliation, country) left the `measure` list - drawableMeasures()
 * below is the filter that keeps them out, mirroring
 * server/charts-agg.js's askFor() so the two lists cannot drift apart.
 * Their counts did not disappear: they render as the group-makeup
 * block, plain count lines with no chart machinery, from the response's
 * own `groups` field. Distributions draw the spec's fixed bands
 * whole - every band the response sends gets a bar, empty ones
 * included - and no edge is ever open any more, so binLabel() below
 * takes two plain numbers and nothing else.
 *
 * THE UNITS TOGGLE NEVER RE-BINS. GET /charts-data answers every unit
 * system in one document - a bin's `from`/`to` and a trend point's
 * `average` are both {metric: ..., imperial: ...} - so switching units
 * re-reads a different key of the SAME cached answer rather than
 * asking again or converting anything client-side (security mandate
 * 2). A second, independently-binned partition is the differencing
 * oracle DESIGN.md's "One partition, not two" refuses.
 *
 * THE FILTER AND MEASURE VALUE LISTS COME FROM apps/site.config.js,
 * never from a response (security mandate 2; design mandate 2). GET
 * /charts-data deliberately never enumerates which values a group holds -
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
   * One bin's range label, from the ALREADY-CHOSEN system's numbers.
   *
   * NEVER OPEN (owner ruling 5, #243: "Edges come from the field spec
   * and never move or merge"). Every edge server/charts-agg.js sends is
   * one of the spec's own two range numbers or a bin boundary between
   * them, so `from` and `to` are always numbers here - there is no edge
   * left that was fitted to a member rather than to the spec, and
   * nothing here takes null for either argument any more (0.9-M2-S10,
   * #371).
   */
  function binLabel(from, to, unit) {
    const suffix = unit ? " " + unit : "";
    return String(from) + suffix + "–" + String(to) + suffix;
  }

  /*
   * A band's caption, since the 2026-08-19 charts sitting round two
   * (#378): its midpoint, rounded to a whole number - "155", never a
   * range and never a unit. binLabel() above is not retired by this;
   * it is what the tooltip below composes the EXACT range from
   * (attachTooltip()'s own bin text), so the caption can orient at a
   * glance while the true edges stay one hover away. Plain rounding
   * (Math.round: .5 rounds up), because the ruling's own examples
   * (155, 185, 244) are exactly that and nothing fancier was asked for.
   */
  function midpointLabel(from, to) {
    return String(Math.round((from + to) / 2));
  }

  /*
   * A caption's estimated width, in the SAME SVG user-unit space
   * drawBins() paints in (a 640-wide viewBox) - conservatively, because
   * there is no real text layout available to a pure function (owner's
   * F1/F2 ruling on #372's review: "measured, or estimated conservatively
   * from the caption text"). The chart figures paint captions at 11px
   * (theme.css's .chart-label/.chart-value) in a condensed system stack.
   *
   * CAPTION_CHAR_WIDTH IS ABOVE THE WIDEST DIGIT AND THE DASH THIS FACE
   * ACTUALLY PAINTS; EVERY REAL CAPTION CLEARS WITH MARGIN (owner's F7
   * ruling on #372's review, corrected 0.9-M2-S13: the original wording
   * claimed the widest glyph outright, and it is not - "m" measures
   * 9.81 user units in this same face, above the constant below). The
   * reviewer read getComputedTextLength() off the shipped face and
   * found "0" at 7.53 user units and "–" (the dash binLabel() joins
   * every range with) at 7.36 - a constant of 7 was BELOW both, so a
   * caption made mostly of zeros and dashes under-stated its own width
   * and the plan could approve a row that truly overlapped (reproduced
   * at 88 bands, where the 7-unit estimate said a one-character count
   * fits a 7.273-unit slot and the real 7.53-unit zero did not - 87 of
   * 88 adjacent count captions actually overlapped while the plan
   * reported clean). 8 is above both measured glyphs, which is the
   * whole property this constant has to hold for the captions that
   * actually reach it: every caption this row or the count row above it
   * ever paints is digits only (0.9-M2-S13 retired the range caption's
   * letters and its own dash from the bottom row - see midpointLabel()
   * below), so a ceiling proven against the widest digit and the dash
   * is a ceiling against everything captionWidth() is ever asked to
   * measure, not merely against the cases a reviewer happened to try.
   */
  const CAPTION_CHAR_WIDTH = 8;

  function captionWidth(text) {
    return String(text).length * CAPTION_CHAR_WIDTH;
  }

  /* One caption's box, centered in its own slot of an evenly-spaced row
     - shared by both plans below, so a slot's index is always read the
     same way regardless of which row it is thinning. */
  function captionBox(index, slot, text) {
    const center = index * slot + slot / 2;
    const half = captionWidth(text) / 2;
    return { left: center - half, right: center + half };
  }

  function boxesOverlap(a, b) {
    return !(a.right <= b.left || a.left >= b.right);
  }

  /*
   * Shifts one caption's box inward just far enough that it sits inside
   * [0, width] - the containment rule from the same 2026-08-19 sitting
   * that added midpointLabel() above: no caption may paint outside the
   * plot bounds. An interior caption never needs this - captionBox()
   * centers it in its own slot, so it has room on both sides by
   * construction, and a caption too wide for its slot lost the overlap
   * contest before rangeCaptionPlan() ever kept it. Only the two
   * protected ends can reach here: rangeCaptionPlan() always paints
   * index 0 and the last index (owner ruling 5's own words), and an end
   * sits at the row's own edge, where there is no slot on one side to
   * borrow room from. Never widens a box that already fits - a caption
   * that clears both edges on its own comes back unchanged, which is
   * what lets drawBins() below run every painted caption through this
   * unconditionally rather than branching on which end it is.
   */
  function containBox(box, width) {
    if (box.left < 0) {
      const shift = -box.left;
      return { left: 0, right: box.right + shift };
    }
    if (box.right > width) {
      const shift = box.right - width;
      return { left: box.left - shift, right: width };
    }
    return box;
  }

  /*
   * Which range-caption indices to paint under a row of bars, so that NO
   * TWO PAINTED CAPTIONS OVERLAP (owner's F1/F2 ruling: "legibility is a
   * geometry property, not a count target" - a caption COUNT near ten
   * says nothing about caption WIDTH, and both the 120-band BMI grid and
   * the 53-band imperial-weight grid overlapped at that count).
   *
   * THE FIRST AND LAST ALWAYS PAINT - they are the spec's own two
   * bounding numbers, the axis's own start and end, so a collision is
   * resolved by dropping an INTERIOR neighbor, never an end. The walk is
   * a single greedy pass left to right (each interior candidate paints
   * only if it clears the last-painted box), then a short cleanup that
   * forces the last index in and drops back any interior captions it
   * would otherwise collide with - so the property holds at both ends of
   * the row, not just walking forward.
   */
  function rangeCaptionPlan(labels, slot) {
    const n = labels.length;
    if (n === 0) return [];
    const box = function (i) { return captionBox(i, slot, labels[i]); };
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

  /*
   * Which count-caption indices to paint above the bars - the same
   * no-overlap rule, but with no protected ends: a count caption that
   * cannot fit simply does not paint (owner's F1/F2 ruling). NON-ZERO
   * COUNTS WIN SLOTS OVER ZEROS: candidates are claimed in priority
   * order (every non-zero count first, left to right, then every zero
   * count left to right) rather than in position order, so a zero
   * sitting between two non-zero neighbors loses its slot to whichever
   * of them is processed first, and a non-zero band is never crowded out
   * by a zero one reading earlier in the row.
   */
  function countCaptionPlan(counts, slot) {
    const box = function (i) { return captionBox(i, slot, String(counts[i])); };
    const order = counts.map(function (_, i) { return i; }).sort(
      function (a, b) {
        const priority = function (i) { return counts[i] > 0 ? 1 : 0; };
        return priority(b) - priority(a) || a - b;
      });

    const kept = [];
    order.forEach(function (i) {
      const candidate = box(i);
      const collides = kept.some(function (j) {
        return boxesOverlap(candidate, box(j));
      });
      if (!collides) kept.push(i);
    });
    return kept.sort(function (a, b) { return a - b; });
  }

  /*
   * The tooltip's own text (0.9-M2-S13, #378, "a tooltip verifies any
   * value"). Every string below is composed from the response's own
   * numbers plus fixed English the spec never reaches - security
   * mandate: render-only, nothing invented, no markup. Each of the two
   * functions below returns `{lead, number}` rather than one flat
   * string, because design mandate 2 puts them in two different faces
   * ("--font-mono for the number, --font-body for range text") - the
   * DOM half sets each half with its own textContent assignment onto
   * its own child span, never innerHTML, and `lead + number` is the
   * tooltip's whole rendered sentence, verbatim.
   *
   * "N member(s)" rather than a bare count, because a bare number under
   * a bar with no other word on it reads as a second count row rather
   * than an answer to "how many people are in this band" - the
   * question a hover asks.
   */
  function memberCount(count) {
    return String(count) + " member" + (count === 1 ? "" : "s");
  }

  /*
   * One distribution bar's tooltip parts, exact - binLabel()'s own
   * range text as the lead, memberCount() as the number, for BOTH a
   * filled band and an empty one (owner ruling 2, #378: "including an
   * empty slot"). The caption under the bar is midpointLabel()'s
   * rounded whole number; this is where the true edges the caption
   * traded away for legibility still live, one hover or tap away.
   */
  function binTooltipParts(from, to, unit, count) {
    return { lead: binLabel(from, to, unit) + ": ", number: memberCount(count) };
  }

  // "August 2026", never a locale-dependent format: toLocaleString()
  // reads the visitor's own locale and timezone, which is one browser
  // rendering the same instant as two different months near a
  // boundary. UTC and a fixed table are the same determinism drawTrend()
  // already relies on to place a point on the x-axis at all (its own
  // "2026-08-01T00:00:00Z" parse).
  const MONTH_NAMES = ["January", "February", "March", "April", "May",
    "June", "July", "August", "September", "October", "November",
    "December"];

  function monthLabel(atMillis) {
    const d = new Date(atMillis);
    return MONTH_NAMES[d.getUTCMonth()] + " " + d.getUTCFullYear();
  }

  /*
   * One trend point's tooltip parts: the month and series name as the
   * lead, that point's own value as the number (owner ruling 2, #378:
   * "the month and the values that point carries - group mean; the You
   * point its own value"). `seriesLabel` is drawSeries()'s own
   * "Average"/"You" - the same word already painted as that line's
   * on-chart label, reused rather than a second name for the same
   * series.
   */
  function trendTooltipParts(atMillis, seriesLabel, value, unit) {
    const suffix = unit ? " " + unit : "";
    return { lead: monthLabel(atMillis) + " — " + seriesLabel + ": ",
      number: String(value) + suffix };
  }

  /*
   * The chartable measures - numeric ones only (owner ruling 1, #243).
   * Gender, affiliation and country left the measure list; their counts
   * moved to the group-makeup block instead (renderGroups() below).
   * Mirrors server/charts-agg.js's askFor() - `measures.filter(m => m.kind
   * !== "categorical")` - so a measure this page offers and a measure the
   * route accepts can never drift apart.
   */
  function drawableMeasures(Fields, site) {
    return Fields.measures(site).filter(function (one) {
      return one.kind !== "categorical";
    });
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

  /*
   * One group-makeup cell's own display text.
   *
   * A field whose choices live outside the spec - country is the one -
   * sends no real label of its own: server/charts-agg.js's cellsOf()
   * puts the code in `label` as a placeholder ("the value stands in for
   * it and the page that holds the list renders the name"), so this is
   * where that rendering happens - the same country table
   * apps/web/countries.js loads for the filter-value control, looked up
   * by the code the response actually holds. The blank cell keeps its
   * own real label ("Not stated") on every field, country included, so
   * it is excluded here rather than looked up against a table that was
   * never going to hold a null key.
   */
  function groupCellLabel(measure, cell, countries) {
    if (measure && measure.choicesFrom === "countries" &&
        cell.bucket !== "blank") {
      const table = countries || {};
      return table[cell.value] || cell.label;
    }
    return cell.label;
  }

  /* The request GET /charts-data answers to. `self=1` always: there is
     no separate control for the member's own overlay (design mandate 2
     names six controls and this is not one of them) - DESIGN.md,
     "Charts", has it as a property of the Trend picture, not a toggle.

     THE ROUTE IS NOT NAMED /charts, and must never be renamed to it:
     this page is charts.html, the assets layer redirects /charts.html
     to /charts, and a route sitting there answers in the page's place -
     which is what made this page unreachable until 0.9-M2-S8 (#365).
     server/worker.js's API_SEGMENTS comment carries the whole rule. */
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
    containBox: containBox,
    rangeCaptionPlan: rangeCaptionPlan,
    countCaptionPlan: countCaptionPlan,
    memberCount: memberCount,
    binTooltipParts: binTooltipParts,
    monthLabel: monthLabel,
    trendTooltipParts: trendTooltipParts,
    scaleLinear: scaleLinear,
    categoricalMeasures: categoricalMeasures,
    drawableMeasures: drawableMeasures,
    valueChoices: valueChoices,
    groupCellLabel: groupCellLabel,
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
  /* The tooltip: one floating element per figure (#tooltip-distribution */
  /* and #tooltip-trend in the markup) - hover previews it, a tap/click  */
  /* pins it, a tap/click elsewhere dismisses it (owner ruling 2, #378). */
  /* Every string it shows comes from binTooltipParts()/trendTooltipParts()*/
  /* above, textContent only - see this file's own header. Two elements  */
  /* rather than one shared node reparented between figures: each is a   */
  /* direct child of the <figure> it belongs to, so positionTooltip()    */
  /* below can clamp against that figure's own box with no reparenting   */
  /* step to get wrong, even though only one figure is ever visible.     */

  let pinnedTooltipTarget = null;
  let pinnedTooltipElement = null;

  /*
   * Clamped inside the figure's own box (design mandate 2: "clamp
   * inside the chart figure's bounding box - flip above/below, shift
   * horizontally - never overflow the card"). getBoundingClientRect()
   * is a real layout measurement no hand-built DOM stub can produce
   * (tests/charts-page.test.mjs's own header: a small node factory,
   * not jsdom), so this is skipped rather than guessed at when it is
   * absent - the tooltip still shows, unpositioned, and the completion
   * record labels the clamp itself as verified in a real browser only.
   */
  function positionTooltip(tip, anchor, figure) {
    if (typeof anchor.getBoundingClientRect !== "function" ||
        typeof figure.getBoundingClientRect !== "function" ||
        typeof tip.getBoundingClientRect !== "function") {
      return;
    }
    const figureBox = figure.getBoundingClientRect();
    const anchorBox = anchor.getBoundingClientRect();
    const tipBox = tip.getBoundingClientRect();

    let left = anchorBox.left - figureBox.left +
      anchorBox.width / 2 - tipBox.width / 2;
    let top = anchorBox.top - figureBox.top - tipBox.height - 8;
    if (top < 0) top = anchorBox.bottom - figureBox.top + 8; // flip below
    if (left < 0) left = 0;
    if (left + tipBox.width > figureBox.width) {
      left = figureBox.width - tipBox.width;
    }

    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }

  /*
   * Two children, two faces (design mandate 2: "--font-mono for the
   * number, --font-body for range text"). Both text nodes are set by
   * textContent alone - `parts` is always one of binTooltipParts()'s or
   * trendTooltipParts()'s own return values, composed only from the
   * response's own numbers and this file's fixed English, so there is
   * no path from here to markup the response could ever choose.
   */
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

  /* Every redraw clears the SVG that holds this tooltip's own targets
     (clearSvg() above) - carrying a pin past that point would leave it
     pointing at a removed element. Called once per figure, with that
     figure's own tooltip element, at the top of its own draw. */
  function resetTooltip(tip) {
    pinnedTooltipTarget = null;
    pinnedTooltipElement = null;
    hideTooltip(tip);
  }

  /*
   * One hover/tap target wired to one tooltip string (owner ruling 2,
   * #378: a distribution bar - including an empty slot - or a trend
   * point). Hover previews; a click PINS it to the element and a tap on
   * a touchscreen fires nothing else, so the same handler is "the
   * whole of tap" too. Pinning is what survives the pointer leaving -
   * dismissTooltipElsewhere() below, wired once in setUp(), is the
   * other half: "tapping elsewhere dismisses".
   */
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
      // Stops this same click from reaching the document-level listener
      // below, which is what makes "click a target" and "click
      // elsewhere" two different things rather than a pin immediately
      // undone by its own click.
      if (event && typeof event.stopPropagation === "function") {
        event.stopPropagation();
      }
      pinnedTooltipTarget = el;
      pinnedTooltipElement = tip;
      showTooltip(tip, el, figure, parts);
    });
  }

  /* Wired once, on the document, in setUp() - every wireTooltip() click
     above stops its own click from reaching here, so this only ever
     fires for a tap/click that landed somewhere else. */
  function dismissTooltipElsewhere() {
    if (!pinnedTooltipTarget) return;
    const tip = pinnedTooltipElement;
    pinnedTooltipTarget = null;
    pinnedTooltipElement = null;
    hideTooltip(tip);
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

  /*
   * A histogram: vertical bars along a baseline, one per band the
   * response sends, in the response's own order - never pooled, merged
   * or dropped (render-only, security mandate 1).
   *
   * EVERY BAND DRAWS (owner ruling 5, #243). A band with at least one
   * person gets its true bar; a band with nobody is a ZERO-HEIGHT SLOT
   * still holding its place on the axis, rather than a bar skipped or a
   * suppression note in its place - there is no such note to print, the
   * same render-only rule that keeps this file from inventing any other
   * text the response did not send. THE BAR ALWAYS DRAWS; ITS TWO
   * CAPTIONS DO NOT (owner's F1/F2 ruling on #372's review). The count
   * text above a bar and the range caption below it are each thinned by
   * countCaptionPlan()/rangeCaptionPlan() so no two painted captions in
   * a row overlap - at the 120-band BMI grid or the 53-band imperial-
   * weight grid, most bars carry no caption at all, and that is the
   * fix: a caption nobody can read is worse than no caption. Nothing
   * about which BAND is drawn changes; only some of the text under or
   * over it does.
   *
   * THE BOTTOM CAPTION IS A MIDPOINT, NOT A RANGE (0.9-M2-S13, #378).
   * rangeCaptionPlan() still decides which indices paint - the "new
   * shorter texts" are midpointLabel()'s, fed through the same
   * geometry - and the true edges move to the tooltip (wireTooltip()
   * below), never lost, one hover or tap away. Every painted caption is
   * run through containBox() before it renders, so an end caption whose
   * own box would cross the viewBox edge shifts inward rather than
   * spilling or dropping (the containment rule, same ruling) - a no-op
   * for every interior caption, which already has room on both sides.
   */
  function drawBins(target, tip, bins, system, unit) {
    resetTooltip(tip);
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

    const counts = bins.map(function (bin) { return bin.count; });
    const midpointLabels = bins.map(function (bin) {
      return midpointLabel(bin.from[system], bin.to[system]);
    });
    const countedIndexes = new Set(countCaptionPlan(counts, slot));
    const labeledIndexes = new Set(rangeCaptionPlan(midpointLabels, slot));

    // The unit marker's own reserved strip at the row's right end - one
    // caption-width of the unit text plus one character of gap. The
    // containment bound a painted caption clamps against (below) stops
    // short of it, so the marker and the last band's own clamped
    // caption are never asked to occupy the same pixels at once; the
    // marker is not itself a caption rangeCaptionPlan() ever placed or
    // dropped, so it is not what the containment rule's own "plot
    // bounds" describes - this is the row leaving it room rather than
    // the rule reaching around it.
    const rightBound = unit
      ? width - captionWidth(unit) - CAPTION_CHAR_WIDTH
      : width;

    node.appendChild(svg("line", {
      x1: 0, y1: baseline, x2: width, y2: baseline,
    }, "chart-axis"));

    bins.forEach(function (bin, index) {
      const barHeight = bin.count > 0
        ? Math.max(1, (bin.count / most) * (baseline - top))
        : 0;
      const x = index * slot;
      node.appendChild(svg("rect", {
        x: x + 2, y: baseline - barHeight,
        width: Math.max(1, slot - 4), height: barHeight, rx: 2,
      }, "chart-bar"));

      if (countedIndexes.has(index)) {
        node.appendChild(svg("text", {
          x: x + slot / 2, y: baseline - barHeight - 6, "text-anchor": "middle",
        }, "chart-value")).textContent = String(bin.count);
      }

      if (labeledIndexes.has(index)) {
        const box = containBox(
          captionBox(index, slot, midpointLabels[index]), rightBound);
        const text = svg("text", {
          x: (box.left + box.right) / 2, y: baseline + 16,
          "text-anchor": "middle",
        }, "chart-label");
        text.textContent = midpointLabels[index];
        node.appendChild(text);
      }

      // The hit target: the WHOLE column, top to baseline, regardless
      // of the bar's own height - a zero-height bar (bin.count === 0)
      // has no area of its own to hover, and owner ruling 2 names an
      // empty slot as one of the two things a tooltip has to verify.
      // fill="transparent" (a color, not `none`) keeps it hit-testable
      // under SVG's default pointer-events (visiblePainted looks at
      // whether fill is `none`, never at fill-opacity or the color
      // itself) without a stylesheet rule to carry that fact instead.
      // Appended LAST, after the bar and both captions, so it paints on
      // top and is what actually receives the pointer over the whole
      // column - the visible bar underneath never has to compete with
      // it for events.
      const hit = svg("rect", {
        x: x, y: top, width: slot, height: baseline - top, fill: "transparent",
      }, "chart-hit");
      node.appendChild(hit);
      wireTooltip(hit, target, tip, binTooltipParts(
        bin.from[system], bin.to[system], unit, bin.count));
    });

    // The unit, stated once at the axis edge rather than once per
    // caption (owner ruling 1, #378) - same row, same class/tone as the
    // captions themselves (design mandate 1).
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

  /*
   * The group-makeup block: no chart machinery (owner ruling 1, #243) -
   * no bars, no track, no .chart-* classes, just the response's own
   * `groups` printed as text. One heading per categorical field, one
   * CHIP per value since the 2026-08-19 charts sitting round two
   * (#378) - the name and the bold exact count, wrapped into a row
   * rather than stacked as lines - zeros included and dimmed rather
   * than dropped, because a zero here is the response's own line and
   * not this page's to drop or to hide. The count is always the
   * response's own number, untouched; the LABEL is groupCellLabel()'s
   * call, verbatim for every field except country's real names, which
   * this page derives (see its own header). Re-runs on every render, so
   * a filtered answer's counts replace an unfiltered one's rather than
   * sitting stale beside it (server/charts-agg.js's makeupOf(): the
   * block describes the FILTERED view, not the whole binder).
   */
  /*
   * F4 (0.9-M2-S11's review, #372): what a category with nothing to say
   * looks like. server/charts-agg.js's makeupOf() deliberately sends a
   * category with an empty `values` list when a raised floor pooled
   * every one of its cells and the pool itself never cleared the floor
   * either - the server's own absorb cascade ran out of named cells to
   * fold in and gave up rather than answer a false breakdown. Unreachable
   * at the shipped floor of 0, reachable once 0.9-M3 ships the floor as
   * an editable setting - a bare heading with nothing under it would read
   * as a bug rather than an honest silence, so this is the one line
   * that fills it: the empty-view vocabulary, page-composed, exactly
   * like the main not-enough sentence's own tone.
   */
  const NOT_ENOUGH_FOR_CATEGORY = "Not enough people to show this.";

  /*
   * F5 (0.9-M2-S11's review, #372): the response's own `multiple` flag,
   * read. A field a member may answer more than once (server/
   * charts-agg.js's own header: "on a field a member may answer more
   * than once the lines sum to holdings rather than to people") can
   * print a total taller than the group itself, and a reader who does
   * not know that reads it as a miscount rather than as multiple
   * answers. This line is the honest reading, render-only - it states a
   * fact about the FIELD's shape, never a number the response did not
   * already send.
   */
  const MULTIPLE_CHOICE_HINT = "Members can choose more than one here, " +
    "so these numbers can add up to more than the group.";

  /*
   * One value's own chip: the name and its exact count, both set by
   * textContent alone (render-only holds here exactly as everywhere
   * else in this file - the name and the count are both the response's
   * own, through groupCellLabel()). `.chip-zero` is the whole of what
   * dims a zero - CSS reads it, this file does not compute a color.
   */
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

  /* The trend line: the group average on series-0 (the accent slot)
     and, when the member asked for it and has one, their own line on
     series-1 - never floor-gated, never merged into the group series
     (design mandate 6; server/charts-agg.js's selfSeries()). One
     shared chronological axis: a trend point's period ("2026-08")
     becomes the first of that month, a self point's `at` is its own
     receipt timestamp.

     LINES NEVER BREAK (owner ruling 6, #243). server/charts-agg.js's
     trendOf() sends one point per period that actually has an entry - a
     month nobody submitted in carries no point at all, never a null one
     - so groupPoints/selfPoints below are already just the real points,
     in order. drawSeries() draws ONE polyline through whatever arrives,
     with no per-segment styling, so a gap of one month and a gap of six
     produce the identical unbroken segment: the bridging IS drawing what
     the response sent, nothing dashed or faded for the months between. */
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
        const dot = svg("circle", {
          cx: x(p.at), cy: y(p.value), r: 3,
        }, dotClass);
        node.appendChild(dot);
        // `label` is drawSeries()'s own "Average"/"You" - the same word
        // already painted on the line's end (below) - so the tooltip
        // names the series the same way the chart already does, never
        // a second name for it (owner ruling 2, #378: "the values that
        // point carries - group mean; the You point its own value").
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

  /*
   * The only refusal left at the shipped floor of 0 (owner ruling 7,
   * #243): zero matching entries. server/charts-agg.js's note is the
   * honest sentence, printed verbatim exactly as before - it never
   * varies with the cause, so this page still cannot compose it. What
   * ruling 7 adds is a broader-filter hint alongside it: fixed text,
   * naming no filter value and no count, so it discloses nothing the
   * route's own silence did not already withhold.
   */
  const BROADER_FILTER_HINT = "Try Everyone or a broader filter.";

  /* ------------------------------------------------------------------ */
  /* The not-enough state and the drawn state. Design mandate 4: one     */
  /* document for the one too-few cause left, a plain paragraph inside   */
  /* this card, replacing the figures in place, no icon, no red, no      */
  /* dismiss - and security mandate 4: content on a 200, indistinguish-  */
  /* able from the drawn state in markup or timing.                     */

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

  /*
   * Download: the route's own bytes, unparsed and unreformatted
   * (security mandate 6). The same object is offered whether the cut
   * was enough or not - a not-enough answer is a small, honest document
   * and there is no reason to withhold it.
   *
   * CREATE, USE, REVOKE - ALL INSIDE THE CLICK HANDLER (0.9-M2-S12,
   * #373, carried to this file's rebuild). The route's own answer text
   * is remembered so the handler has bytes to build a Blob from, but the
   * object URL itself never outlives the click that made it: no
   * persisted object-URL variable at module scope, nothing left for a
   * future exit handler to clear - the same shape submit.js's own
   * download uses since #373 deleted its dead scaffolding of that kind.
   */
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
    // The other half of "tap pins, tap elsewhere dismisses" (owner
    // ruling 2, #378) - wired once, on the document, rather than once
    // per draw: it outlives every redraw and every wireTooltip() click
    // above already stops its own click from reaching here.
    document.addEventListener("click", dismissTooltipElsewhere);
  }
})(globalThis);
