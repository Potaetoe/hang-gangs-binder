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
 * own `groups` field. Distributions draw the spec's fixed bands - every
 * edge is one of the spec's own two range numbers or a bin boundary
 * between them, never open, so binLabel() below takes two plain numbers
 * and nothing else.
 *
 * THE PAGE STOPS DRAWING PAST THE BAND HOLDING THE DATA'S OWN MAXIMUM
 * (owner ruling, the 2026-08-20 sitting, #390) - trimTrailingEmptyBins()
 * below is the whole of it: top only (the chart still starts at the
 * spec minimum; the empty TAIL past the heaviest member is what drops),
 * and a wholly-empty grid, with no nonzero band to anchor a trim on,
 * still draws whole. This is a page-side draw decision, never a second
 * partition - the response still carries every band the spec has, and
 * workbookRows() below applies the identical trim so the download never
 * shows a tail the screen does not.
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
   * THE DISTRIBUTION'S TOP TRIM (owner ruling, the 2026-08-20 sitting,
   * #390): "the last painted band is the band CONTAINING the data's
   * maximum; its upper spec edge is the axis end." Everything after the
   * last band that holds anyone is dropped - the empty TAIL, never the
   * front. Band edges never move (#371's own ruling, restated by this
   * one): this drops whole bins, it never touches a `from`/`to` pair,
   * and the surviving bins are the SAME objects the response sent.
   *
   * TOP ONLY (owner ruling 2, put to the owner as a both-ends option and
   * ruled explicitly against it): the chart still starts at the spec
   * minimum, so a leading empty stretch below the lightest member is
   * never touched - only `Array.prototype.slice` off the BACK, never a
   * filter that could drop an interior or leading zero.
   *
   * A ZERO GRID KEEPS DRAWING WHOLE (owner ruling 3): when no band has a
   * count, there is no nonzero band to anchor the trim on, so `bins` is
   * returned exactly as it arrived - the enough-but-all-zero shape draws
   * its full spec grid, exactly as it always has.
   *
   * RENDER-ONLY (security mandate 1, restated for this ruling): the
   * caller hands in the SAME `bins` array GET /charts-data sent - every
   * band, in the response's own order - and gets back a shorter slice of
   * the same objects. No band is re-binned, re-counted or invented; the
   * route's contract is untouched. drawDistribution() below feeds the
   * result into drawBins(), and workbookRows() further down calls this
   * same function on the same field, so the chart and the download can
   * never disagree about where the drawn range ends.
   *
   * A RAISED FLOOR MAKES THIS A NO-OP (fix wave 1, F3, #390 - this
   * function has no idea what the floor is, and that is the point).
   * server/charts-agg.js's own merge machinery (this file's header
   * names no server function by name - security mandate 1, this is a
   * render-only file) folds a trailing remainder BACKWARDS into the
   * last band it emits rather than dropping it, so at any floor above
   * the shipped 0, the last band in a real answer ALWAYS carries a
   * nonzero count - `lastNonEmpty` above always lands on the final
   * index, and `bins.slice(0, lastNonEmpty + 1)` returns the whole
   * array back. The trimmed range only ever shrinks at the shipped
   * floor of 0; a raised floor is what hides whether the group's
   * single heaviest member sits near the spec ceiling or far below it,
   * never this function choosing not to draw them.
   * tests/charts-aggregate.test.mjs pins the real mechanism end to
   * end, against the server's own real merged output.
   */
  function trimTrailingEmptyBins(bins) {
    let lastNonEmpty = -1;
    for (let i = 0; i < bins.length; i += 1) {
      if (bins[i].count > 0) lastNonEmpty = i;
    }
    return lastNonEmpty === -1 ? bins : bins.slice(0, lastNonEmpty + 1);
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
   * (theme.css's .chart-label) in a condensed system stack.
   *
   * CAPTION_CHAR_WIDTH IS ABOVE THE WIDEST DIGIT AND THE DASH THIS FACE
   * ACTUALLY PAINTS, MEASURED (owner's F7 ruling on #372's review,
   * corrected twice now - 0.9-M2-S13's own build claimed the widest
   * glyph outright, and "m" at 9.81 user units disproves that; fix wave
   * 1's F4 finding is that "digits only" overstates it the OTHER way).
   * The reviewer read getComputedTextLength() off the shipped face and
   * found "0" at 7.53 user units and "–" (the dash binLabel() joins
   * every range with) at 7.36 - a constant of 7 was BELOW both, so a
   * caption made mostly of zeros and dashes under-stated its own width
   * and the plan could approve a row that truly overlapped (reproduced
   * at 88 bands, where the 7-unit estimate said a one-character count
   * fits a 7.273-unit slot and the real 7.53-unit zero did not). 8 is
   * above both measured glyphs, which is the property the bottom
   * caption row actually needs: every caption it paints is midpointLabel()'s
   * digits only, since 0.9-M2-S13 retired the range and its dash from
   * that row. captionWidth() ALSO measures the axis-edge unit marker
   * (drawBins() below, the rightBound reserve) and a y-axis tick label
   * that happens to carry a unit-free number - the unit marker's own
   * text is letters, not digits, and 8 is NOT proven above every
   * letter this face paints ("cm" measured 16.10 against this
   * constant's own 16-unit estimate for two characters, fix wave 1's
   * F4 finding - narrowly under, not over). That case is covered by
   * a DIFFERENT margin: the reserve drawBins() carves out is one whole
   * extra CAPTION_CHAR_WIDTH-unit wider than the unit text's own
   * estimate, which swallows a few tenths of a unit of estimation
   * error with room left over - not this constant being a ceiling on
   * letters, which it is not proven to be.
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
   * Shifts one box inward just far enough that it sits inside
   * [lowerBound, upperBound] - the containment rule from the 2026-08-19
   * sitting: no caption may paint outside the plot bounds. `lowerBound`
   * was always literally 0 before fix wave 1 (#378); it is now the
   * plot's own left edge (drawBins() below reserves a left gutter for
   * the new count axis, ruling 2 of the same sitting's late round), so
   * this takes it as a parameter rather than assuming zero.
   */
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

  /*
   * Which caption indices to paint under a row of bars, so that NO TWO
   * PAINTED CAPTIONS OVERLAP (owner's F1/F2 ruling on #372's review:
   * "legibility is a geometry property, not a count target").
   *
   * `boxOf`, OPTIONAL, IS WHAT FIX WAVE 1 (#378, finding F1) ADDS. Left
   * undefined, `box(i)` falls back to the plain, unclamped
   * captionBox(i, slot, labels[i]) - every caller before this fix wave
   * relied on exactly that shape, and the arm below keeps it working
   * for a caller that only cares about the raw geometry. But
   * drawBins() below MUST pass a `boxOf` that returns each caption's
   * own FINAL, CONTAINED position (offset by the plot's left edge, run
   * through containBox()) - the reviewer's own finding, confirmed live,
   * was that the old two-stage shape (plan on raw boxes, THEN clamp the
   * ends at render time) let a clamped end caption collide with its
   * nearest kept neighbor, because nothing ever re-checked the position
   * the clamp actually produced. Feeding the SAME final-position boxes
   * into THIS function's own overlap test is the fix: the algorithm
   * below already resolves a collision by dropping an interior
   * neighbor and never an end (owner ruling 5's words, restated by the
   * fix-wave ruling: "resolved by dropping interior neighbours, never
   * an end") - it was only ever being asked the wrong question before.
   *
   * THE FIRST AND LAST ALWAYS PAINT - they are the spec's own two
   * bounding numbers, the axis's own start and end. The walk is a
   * single greedy pass left to right (each interior candidate paints
   * only if it clears the last-painted box), then a short cleanup that
   * forces the last index in and drops back any interior captions it
   * would otherwise collide with - so the property holds at both ends
   * of the row, not just walking forward, and now holds on whichever
   * geometry `boxOf` actually describes.
   */
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
   * The distribution's new count axis (owner ruling 2, the 2026-08-19
   * late sitting, folded into fix wave 1, #378): "a count scale in
   * whole people (integer ticks only)". A fraction of a person is never
   * a value this axis may print, so the step between ticks is always a
   * whole number too - a "nice" one (1, 2, 5 or 10 times a power of
   * ten), the same family every ordinary chart axis uses, chosen so
   * roughly five ticks span the row. maxCount <= 0 (every band empty)
   * degenerates to the single tick "0", which is the whole truth of an
   * empty axis and needs no step at all.
   */
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

  /*
   * The trend's value axis (same ruling: "if its reserved gutter
   * carries no value labels today, add them - measure values"). Three
   * exact points from the domain already on screen - the lowest value,
   * the highest, and their midpoint - never a "nice" rounded number
   * invented for the axis: every number here is either one the response
   * sent or the plain average of two that were, which is the same
   * render-only standard the tooltip holds to. A flat domain (every
   * point equal, or one point) has nothing to interpolate and prints
   * its one value once rather than the same number three times over.
   */
  function valueAxisTicks(minValue, maxValue) {
    if (!(maxValue > minValue)) return [minValue];
    return [minValue, (minValue + maxValue) / 2, maxValue];
  }

  /*
   * The tooltip's own position (design mandate 2: "clamp inside the
   * chart figure's bounding box - flip above/below, shift horizontally
   * - never overflow the card"), extracted as a pure function of three
   * boxes so it can be armed without a browser (fix wave 1, #378,
   * finding F2: the flip-below branch was unbounded below, so any
   * figure under roughly 505px wide spilled the tooltip past the
   * figure's own bottom edge - 17.7px of it, at a 320px-wide figure,
   * onto the group-makeup block beneath). Each box is
   * {left, top, right, bottom, width, height} in one shared coordinate
   * space (a real caller passes getBoundingClientRect() results, which
   * already share the viewport's); this function does no measuring of
   * its own; it only turns three boxes into the fourth, {left, top}, in
   * `figure`-relative pixels.
   *
   * The horizontal clamps were already exact (forced at both edges,
   * the reviewer's own finding) and are unchanged. What is new is the
   * bottom clamp: after deciding above-or-below, `top` is pulled up
   * just far enough that `top + tip.height` never exceeds the figure's
   * own height, and a defensive top clamp catches the one case even
   * that cannot fix - a tooltip taller than the whole figure.
   */
  function positionTooltipBox(anchorBox, figureBox, tipBox) {
    let left = anchorBox.left - figureBox.left +
      anchorBox.width / 2 - tipBox.width / 2;
    let top = anchorBox.top - figureBox.top - tipBox.height - 8;
    if (top < 0) top = anchorBox.bottom - figureBox.top + 8; // flip below

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

  /*
   * The only refusal left at the shipped floor of 0 (owner ruling 7,
   * #243): zero matching entries. server/charts-agg.js's note is the
   * honest sentence, printed verbatim exactly as before - it never
   * varies with the cause, so this page still cannot compose it. What
   * ruling 7 adds is a broader-filter hint alongside it: fixed text,
   * naming no filter value and no count, so it discloses nothing the
   * route's own silence did not already withhold.
   *
   * Moved here from the DOM section (0.9-M2-S14, #380 ruling 3): the
   * not-enough workbook row (workbookRows() below) is the same sentence
   * renderAnswer() prints on screen, and a Pure function loaded under
   * Node has no DOM section to read this constant out of - see this
   * file's own header on why nothing below the document guard runs
   * there.
   */
  const BROADER_FILTER_HINT = "Try Everyone or a broader filter.";

  /* The one unit system's own reserved property, off the response's own
     {metric, imperial} pair - moved here from the DOM section (it
     touches no document) so workbookColumns()/workbookRows() below can
     read it too. */
  function unitFor(answer, system) {
    return answer.units && answer.units[system] && answer.units[system].unit
      ? answer.units[system].unit
      : null;
  }

  /*
   * The workbook's own columns and rows (0.9-M2-S14, #380 ruling 3):
   * exactly the answer already on screen, in the same label vocabulary
   * this file already paints it with - binLabel() for a band's own
   * exact range (not midpointLabel()'s rounded caption; a download
   * benefits from the same precise edges a hover already reveals),
   * monthLabel() for a trend point, groupCellLabel() for a group-makeup
   * value. RENDER-ONLY, exactly like the rest of this file (security
   * mandate 1): every cell is composed from `answer`'s own numbers,
   * nothing refetched and nothing computed that the response did not
   * already send.
   *
   * Counts are written as NUMBERS, not memberCount()'s "N members" text
   * - a spreadsheet cell is for arithmetic, and "5 members" is a string
   * no formula can sum. `measureFor`, a plain lookup function rather
   * than the Fields module itself, is what keeps this pure: the DOM
   * caller hands in `function (name) { return Fields.measure(name,
   * site); }`, the same lookup renderGroups() already does per group.
   *
   * THE DISTRIBUTION ROWS END AT THE SAME BAND THE CHART ENDS AT (owner
   * ruling, #390, ruling 6: "the workbook carries exactly the answer on
   * screen") - workbookRows() calls trimTrailingEmptyBins() on the same
   * `answer.distribution.bins` drawDistribution() does, so a download
   * can never show a tail past the data's maximum that the figure does
   * not.
   */
  function workbookColumns(unit) {
    const suffix = unit ? " (" + unit + ")" : "";
    return ["Section", "Label", "Count", "Average" + suffix, "You" + suffix];
  }

  function workbookRows(answer, system, countries, measureFor) {
    if (!answer.enough) {
      return [["Status", answer.note + " " + BROADER_FILTER_HINT,
        "", "", ""]];
    }

    const unit = unitFor(answer, system);
    const rows = [];

    trimTrailingEmptyBins(
      answer.distribution ? answer.distribution.bins : []).forEach(
      function (bin) {
        rows.push(["Distribution",
          binLabel(bin.from[system], bin.to[system], unit), bin.count,
          "", ""]);
      });

    (answer.trend && answer.trend.points ? answer.trend.points : [])
      .forEach(function (point) {
        const at = new Date(point.period + "-01T00:00:00Z").getTime();
        rows.push(["Trend", monthLabel(at), "", point.average[system], ""]);
      });
    (answer.self && answer.self.points ? answer.self.points : [])
      .forEach(function (point) {
        rows.push(["Trend", monthLabel(new Date(point.at).getTime()), "",
          "", point.value[system]]);
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
    unitFor: unitFor,
    workbookColumns: workbookColumns,
    workbookRows: workbookRows,
    BROADER_FILTER_HINT: BROADER_FILTER_HINT,
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
   * The thin DOM caller (fix wave 1, #378, finding F2): the whole of
   * the clamp/flip arithmetic now lives in positionTooltipBox() above,
   * a pure function of three boxes, armed by its own fixtures - this
   * function's only job is measuring the three real boxes and writing
   * the two numbers positionTooltipBox() returns back onto the style.
   * getBoundingClientRect() is a real layout measurement no hand-built
   * DOM stub can produce (tests/charts-page.test.mjs's own header: a
   * small node factory, not jsdom), so this is skipped rather than
   * guessed at when it is absent - the tooltip still shows,
   * unpositioned, and the completion record labels the measuring half
   * (never the arithmetic, which is unit-tested directly) as verified
   * in a real browser only.
   */
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
    let choices = valueChoices(measure, root.BINDER_COUNTRIES);
    // Pinned codes first, in site.config.js's own order (owner ruling,
    // 0.9-M2-S14, #380 ruling 4) - a client-side reorder of the same
    // value list valueChoices() already built from the spec, never a
    // second source for what the filter offers.
    if (measure.choicesFrom === "countries") {
      choices = Fields.orderedChoices(choices, Fields.pinnedCountries(site));
    }
    choices.forEach(function (choice) {
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

  /*
   * A histogram: vertical bars along a baseline, one per band this
   * function is HANDED, in that order - never pooled, merged or dropped
   * (render-only, security mandate 1). `bins` is drawDistribution()'s
   * own ALREADY-TRIMMED array (trimTrailingEmptyBins() above, owner
   * ruling, #390: the drawn range stops at the band holding the data's
   * maximum) - this function draws every band it is handed, whole, and
   * has no opinion of its own about where the range ends. Every number
   * it computes from `bins.length` - slot width, the caption plan, the
   * count axis, the hit rects - re-derives from whatever count it was
   * handed, with no special case for a trimmed count versus a full spec
   * grid; that band-count-generic property is what #390 relies on.
   *
   * EVERY BAND DRAWS (owner ruling 5, #243). A band with at least one
   * person gets its true bar; a band with nobody is a ZERO-HEIGHT SLOT
   * still holding its place on the axis, rather than a bar skipped or a
   * suppression note in its place - there is no such note to print, the
   * same render-only rule that keeps this file from inventing any other
   * text the response did not send. THE BAR ALWAYS DRAWS; ITS CAPTION
   * DOES NOT (owner's F1/F2 ruling on #372's review). The caption under
   * a bar is thinned by rangeCaptionPlan() so no two painted captions in
   * a row overlap - at the 120-band BMI grid or the 53-band imperial-
   * weight grid, most bars carry no caption at all, and that is the
   * fix: a caption nobody can read is worse than no caption. Nothing
   * about which BAND is drawn changes; only some of the text under it
   * does.
   *
   * NO COUNT ROW ANY MORE (owner ruling, the 2026-08-19 late sitting,
   * folded into fix wave 1, #378: "no numbers over bars, ever"). The
   * exact count is the count axis's own scale plus the tooltip, never a
   * number painted per bar - countCaptionPlan() and everything it
   * touched is gone with it.
   *
   * THE BOTTOM CAPTION IS A MIDPOINT, NOT A RANGE (0.9-M2-S13, #378).
   * rangeCaptionPlan() still decides which indices paint - the "new
   * shorter texts" are midpointLabel()'s, fed through the same
   * geometry - and the true edges move to the tooltip (wireTooltip()
   * below), never lost, one hover or tap away.
   *
   * THE PLAN IS FED FINAL POSITIONS NOW, NOT RAW ONES (fix wave 1,
   * finding F1). `boxOf` below computes each caption's own contained,
   * offset box and is the SAME function rangeCaptionPlan() plans
   * against and the render loop paints from - there is exactly one
   * definition of where a caption ends up, so a clamped end caption
   * that would collide with its nearest kept neighbor is caught by the
   * plan itself rather than discovered on screen.
   */
  function drawBins(target, tip, bins, system, unit) {
    resetTooltip(tip);
    const width = 640;
    const height = 320;
    const baseline = height - 60;
    const top = 20;
    // The left gutter for the new count axis (owner ruling, the
    // 2026-08-19 late sitting): the same 50-unit reserve drawTrend()
    // already uses for its own value axis, so the two figures share one
    // gutter width rather than each picking its own.
    const left = 50;
    const node = target.querySelector("svg");
    node.setAttribute("viewBox", "0 0 " + width + " " + height);
    clearSvg(node);

    if (!bins.length) return;
    const tallest = bins.reduce(function (max, bin) {
      return Math.max(max, bin.count);
    }, 1);
    const countTicks = countAxisTicks(tallest);
    // SCALE TO THE TOP TICK, NOT THE TALLEST BAND (fix wave 2, #378).
    // countAxisTicks() can push a tick past `tallest` itself - a "nice"
    // step rarely lands exactly on the real maximum (tallest=7 gives
    // ticks 0,2,4,6,8) - and scaling to `tallest` left that pushed
    // tick's own y position ABOVE `top`, painting outside the plot box:
    // measured live, the "8" landed 23.3px above the figure and its ink
    // collided with the status line above the card, because this
    // figure's <svg> is overflow:visible. The top tick is always the
    // axis's own ceiling by construction (countAxisTicks() never
    // returns a value below `tallest`), so scaling both the ticks AND
    // the bars to IT - the same `most` denominator for both - keeps
    // everything inside [top, baseline] together. The tallest bar no
    // longer quite touching the plot's own top edge is the ruling's own
    // named bonus, not a defect.
    const most = countTicks[countTicks.length - 1];
    const plotWidth = width - left;
    const slot = plotWidth / bins.length;

    const midpointLabels = bins.map(function (bin) {
      return midpointLabel(bin.from[system], bin.to[system]);
    });

    // The unit marker's own reserved strip at the row's right end - one
    // caption-width of the unit text plus one character of gap, so the
    // marker and a clamped last caption never occupy the same pixels
    // (the marker is not itself a caption anything plans or drops - see
    // the marker's own comment below).
    const rightBound = unit
      ? width - captionWidth(unit) - CAPTION_CHAR_WIDTH
      : width;

    // Every painted caption's FINAL box - offset into the plot (the
    // left gutter) and run through containBox() - is what
    // rangeCaptionPlan() below plans against AND what the render loop
    // paints from, the same function both times (fix wave 1, F1).
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

    // The count axis (owner ruling, the 2026-08-19 late sitting): whole
    // people only, in the .chart-label tone, right-aligned into the
    // left gutter. `countTicks` (computed above, off `tallest` - the
    // real max) is reused here rather than re-derived from `most` (the
    // top tick): re-deriving from the top tick can pick a DIFFERENT
    // step (countAxisTicks(8) need not equal countAxisTicks(7)'s own
    // answer), which is exactly the kind of drift fix wave 2 exists to
    // close - one set of ticks, computed once, is what both this loop
    // and `most` above answer to.
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

      // The hit target: the WHOLE column, top to baseline, regardless
      // of the bar's own height - a zero-height bar (bin.count === 0)
      // has no area of its own to hover, and owner ruling 2 names an
      // empty slot as one of the two things a tooltip has to verify.
      // fill="transparent" (a color, not `none`) keeps it hit-testable
      // under SVG's default pointer-events (visiblePainted looks at
      // whether fill is `none`, never at fill-opacity or the color
      // itself) without a stylesheet rule to carry that fact instead.
      // Appended LAST, after the bar and its caption, so it paints on
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
    // captions themselves (design mandate 1). It names the MEASURE's
    // own unit on the x-axis; the count axis this same figure grew
    // (owner ruling, the 2026-08-19 late sitting) is never in that
    // unit, so it stays on its own row rather than moving to the gutter.
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
    // trimTrailingEmptyBins() (owner ruling, #390) is the whole of the
    // draw-range decision - drawBins() below draws every band it is
    // handed, whole, with no idea where the spec's own grid actually
    // ends.
    const bins = trimTrailingEmptyBins(answer.distribution.bins);
    drawBins(target, tip, bins, system, unit);
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

    // The value axis (owner ruling, the 2026-08-19 late sitting: "if
    // its reserved gutter carries no value labels today, add them") -
    // the left gutter above already existed for this; it just never
    // carried anything. valueAxisTicks() returns exact domain values
    // (the lowest, highest and their midpoint), never a rounded number
    // this file invented for the axis.
    valueAxisTicks(minValue, maxValue).forEach(function (tick) {
      node.appendChild(svg("text", {
        x: left - 8, y: y(tick) + 4, "text-anchor": "end",
      }, "chart-label")).textContent = String(tick);
    });

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
      // The picture toggle goes with its pictures (0.9-M2-S15, #383):
      // there is nothing left to choose a view OF on the honest
      // not-enough sentence, so it hides along with both figures rather
      // than sitting above an empty card.
      show($("picture-field"), false);
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

    // Unhidden here, and only here (0.9-M2-S15, #383): a picture exists
    // to choose between only once a picture has actually drawn. The tab
    // buttons themselves are never rebuilt or moved by this call, so
    // aria-selected - read below - carries whatever the member last
    // chose across every earlier press this visit.
    show($("picture-field"), true);
    const selected = $("picture-tab-trend").getAttribute("aria-selected") ===
      "true";
    show($("picture-trend"), selected);
    show($("picture-distribution"), !selected);

    renderGroups(answer.groups);
  }

  /*
   * Download: a real workbook, built by BinderXlsx.build() from exactly
   * the answer already drawn on screen - not the route's own bytes any
   * more (0.9-M2-S14, #380 ruling 3, superseding the JSON download
   * 0.9-M2-S12/#373 shipped). workbookColumns()/workbookRows() above
   * compose the same numbers renderAnswer() painted, at the CURRENT
   * unit system read fresh on each click - so toggling units after a
   * fetch and then pressing Download gets the workbook in the units
   * actually on screen, the same live behavior the figures themselves
   * already have. The same workbook is offered whether the cut was
   * enough or not - a not-enough answer is a small, honest document and
   * there is no reason to withhold it.
   *
   * REUSES THE REPOSITORY'S ONE XLSX WRITER (apps/web/xlsx.js,
   * BinderXlsx) rather than a second one - the admin export's own
   * machinery, xlsx.js's own header explains why the CSV's leading-
   * apostrophe formula guard is deliberately NOT layered on top here: a
   * cell BinderXlsx.build() writes for anything but a number is typed
   * `t="inlineStr"`, an inline STRING, and a formula lives only in an
   * `<f>` element this writer never emits - so a hostile country name
   * or group label such as "=SUM(A1:A10)" arrives on the sheet as that
   * exact literal text, never evaluated. That typing IS the guard;
   * dev/xlsx.test.mjs already proves it on admin.js's own export
   * ("a formula-looking value is a string, not defused"), and this
   * file's own suite proves it again on THIS workbook - see
   * tests/charts-page.test.mjs.
   *
   * CREATE, USE, REVOKE - ALL INSIDE THE CLICK HANDLER (0.9-M2-S12,
   * #373, carried to this file's rebuild and unchanged by the format
   * swap). The route's own parsed answer is remembered so the handler
   * has something to build a workbook from, but the object URL itself
   * never outlives the click that made it: no persisted object-URL
   * variable at module scope, nothing left for a future exit handler to
   * clear - the same shape submit.js's own download uses since #373
   * deleted its dead scaffolding of that kind.
   */
  let lastAnswer = null;

  function offerDownload(answer) {
    lastAnswer = answer;
    $("download").hidden = false;
  }

  function wireDownload() {
    $("download").addEventListener("click", function () {
      if (!lastAnswer) return;
      const site = root.BINDER_SITE;
      const system = currentSystem();
      const columns = workbookColumns(unitFor(lastAnswer, system));
      const rows = workbookRows(lastAnswer, system, root.BINDER_COUNTRIES,
        function (fieldName) { return Fields.measure(fieldName, site); });
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
    // After render, not before: the workbook is built from the PARSED
    // answer now (0.9-M2-S14, #380 ruling 3). A parse failure above
    // returns before this line runs, so the download is simply not
    // refreshed on that press - whatever workbook a PRIOR successful
    // press offered stays offered, matching the prior picture that is
    // also still on screen (the early return above leaves both alone).
    offerDownload(answer);

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
