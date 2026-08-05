/*
 * The dashboard on admin.html: aggregation, and charts drawn by hand.
 *
 * No chart library, and not for tidiness. This is the page that holds
 * every submission in the clear, and admin.html's policy is
 * `default-src 'none'; script-src 'self'` - a CDN script here would see
 * the whole decrypted corpus. That rule is the design (see DESIGN.md,
 * "Encryption, concretely"), so the charts are inline SVG built from
 * the DOM, which costs about a hundred lines of arithmetic and nothing
 * else.
 *
 * Two consequences worth knowing before editing:
 *
 *   - Colour comes from CSS classes in theme.css, never from a `style`
 *     attribute. `style-src 'self'` has no 'unsafe-inline', so an
 *     inline style attribute would be dropped and the chart would
 *     render in the browser's defaults. fill and stroke are ordinary
 *     CSS properties, so a class works and themes for free.
 *   - Geometry goes in attributes (x, y, width, points), which are
 *     presentation attributes rather than CSS and are unaffected.
 *
 * Split like the rest: everything above the wiring line is pure and
 * tested in dev/dashboard.test.mjs. Aggregation is where a dashboard
 * lies quietly - a median off by one row, a person counted twice - and
 * a chart that is wrong looks exactly like a chart that is right.
 */
(function (root) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  function round(value, places) {
    const factor = Math.pow(10, places);
    return Math.round(value * factor) / factor;
  }

  /* Only real numbers reach a chart. A missing weight is not a zero. */
  function num(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function numbers(entries, field) {
    const out = [];
    for (const entry of entries) {
      const value = num(entry[field]);
      if (value !== null) out.push(value);
    }
    return out;
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = values.slice().sort(function (a, b) { return a - b; });
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[mid]
      : round((sorted[mid - 1] + sorted[mid]) / 2, 1);
  }

  function mean(values) {
    if (!values.length) return null;
    let total = 0;
    for (const value of values) total += value;
    return round(total / values.length, 1);
  }

  /*
   * BMI, as arithmetic and nothing more. The number is reported; the
   * WHO category labels are not. Those labels are a clinical judgement
   * this page has no business making about people who filled in a form,
   * and they would be the part everybody read.
   */
  function bmi(kg, cm) {
    const weight = num(kg);
    const height = num(cm);
    if (weight === null || height === null || height <= 0) return null;
    const metres = height / 100;
    return round(weight / (metres * metres), 1);
  }

  /*
   * Total inches as a person would say it: 68 becomes 5'8".
   *
   * This is display formatting and nothing else - it takes a number
   * that is already in the units being shown and writes it down. It is
   * not a unit conversion, and the rule in DESIGN.md about the
   * conversion existing exactly once is untouched by it: no stored
   * value passes through here, and there is no factor to get wrong.
   *
   * Rounding to whole inches first is what keeps the 5 ft 11.98 in
   * carry out of this function. Once the total is an integer,
   * divmod 12 cannot produce a twelfth inch.
   */
  function formatInches(totalInches) {
    const value = num(totalInches);
    if (value === null) return "";
    const total = Math.round(value);
    return Math.floor(total / 12) + "'" + (total % 12) + '"';
  }

  /*
   * Which stored field each unit system reads, and how it is written.
   *
   * The dashboard never converts. Every row carries both systems
   * already - see DESIGN.md, "Why every row carries both unit systems"
   * - so switching units picks a different field off the entry rather
   * than multiplying anything. A conversion here would be the second
   * copy of the arithmetic that the storage decision exists to avoid,
   * and it would be the copy nobody tested.
   *
   * Imperial is the default, deliberately and to match the form.
   *
   * The bin widths are matched pairs rather than independent choices:
   * 20 lb is about 10 kg and 2 in is about 5 cm, so the two versions of
   * a histogram have roughly the same shape and switching units does
   * not silently redraw the distribution.
   *
   * Each measure says three things about itself: `field` is which
   * property of an entry to read, `tick` writes a histogram bin edge -
   * the unit is already in the axis corner, so weights are bare numbers
   * - and `stat` writes a standalone figure, which has to carry its own
   * unit because nothing beside it does.
   */
  const plain = function (value) { return String(value); };
  const suffixed = function (unit) {
    return function (value) { return value + " " + unit; };
  };

  const UNITS = {
    imperial: {
      name: "imperial",
      weight: {
        field: "lb", suffix: "lb", bin: 20, band: "20 lb bands",
        tick: plain, stat: suffixed("lb"),
      },
      height: {
        field: "totalInches", suffix: "in", bin: 2, band: "2 in bands",
        tick: formatInches, stat: formatInches,
      },
    },
    metric: {
      name: "metric",
      weight: {
        field: "kg", suffix: "kg", bin: 10, band: "10 kg bands",
        tick: plain, stat: suffixed("kg"),
      },
      height: {
        field: "cm", suffix: "cm", bin: 5, band: "5 cm bands",
        tick: plain, stat: suffixed("cm"),
      },
    },
  };

  const DEFAULT_UNITS = "imperial";

  function unitsFor(name) {
    return UNITS[name] || UNITS[DEFAULT_UNITS];
  }

  /* A standalone figure, or an em dash. Nothing here invents a zero for
   * a measurement nobody gave. */
  function statText(value, spec) {
    return value === null || value === undefined ? "—" : spec.stat(value);
  }

  /* Newest first, by what the submitter's clock said, falling back to
   * the server's receipt when a record predates that field. */
  function timeOf(entry) {
    const stamp = entry.submittedAt || entry.receivedAt;
    const parsed = stamp ? Date.parse(stamp) : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /*
   * One entry per person, keeping the most recent.
   *
   * Storage is append-only and the form cannot detect a repeat, so a
   * resubmission is a new row - see DESIGN.md, "Duplicates". Counting
   * those rows as separate people would report the group as larger than
   * it is and drag every distribution toward whoever submits most
   * often.
   *
   * A row with no handle is its own person rather than being lumped in
   * with every other blank, which would invent one enormous submitter.
   */
  function latestPerPerson(entries) {
    const byHandle = new Map();
    for (const entry of entries) {
      const key = entry.telegram ? "@" + entry.telegram : "#" + entry.id;
      const previous = byHandle.get(key);
      if (!previous || timeOf(entry) >= timeOf(previous)) {
        byHandle.set(key, entry);
      }
    }
    return Array.from(byHandle.values());
  }

  function peopleCount(entries) {
    return latestPerPerson(entries).length;
  }

  /*
   * Equal-width bins across the data's own range, rounded outward to
   * the bin width so the axis reads in round numbers.
   */
  function histogram(values, binWidth) {
    if (!values.length || !(binWidth > 0)) return [];
    let low = Infinity;
    let high = -Infinity;
    for (const value of values) {
      if (value < low) low = value;
      if (value > high) high = value;
    }
    const start = Math.floor(low / binWidth) * binWidth;
    const end = Math.ceil((high + 0.000001) / binWidth) * binWidth;
    const bins = [];
    for (let from = start; from < end; from += binWidth) {
      bins.push({ from: round(from, 4), to: round(from + binWidth, 4), count: 0 });
    }
    if (!bins.length) return [];
    for (const value of values) {
      let index = Math.floor((value - start) / binWidth);
      if (index >= bins.length) index = bins.length - 1; // the top edge
      if (index < 0) index = 0;
      bins[index].count++;
    }
    return bins;
  }

  const NOT_STATED = "Not stated";

  /*
   * Counts per category, commonest first, with the blanks kept as their
   * own bar. Dropping them would make the chart claim a completeness
   * the data does not have - "60% male" reads very differently from
   * "60% of the third who answered".
   */
  function countBy(entries, pick) {
    const counts = new Map();
    for (const entry of entries) {
      const raw = pick(entry);
      const label = raw === null || raw === undefined || raw === ""
        ? NOT_STATED : String(raw);
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    return Array.from(counts, function (pair) {
      return { label: pair[0], count: pair[1] };
    }).sort(function (a, b) {
      if (a.label === NOT_STATED) return 1;   // always last, never first
      if (b.label === NOT_STATED) return -1;
      return b.count - a.count || a.label.localeCompare(b.label);
    });
  }

  /*
   * Affiliations are multi-select, so the counts deliberately do not
   * sum to the number of entries. Someone who ticked feeder and gainer
   * is in both bars, which is the honest answer to "how many gainers
   * are there".
   */
  function countRoles(entries, vocabulary) {
    const counts = new Map();
    for (const name of vocabulary) counts.set(name, 0);
    let none = 0;
    for (const entry of entries) {
      const roles = Array.isArray(entry.roles) ? entry.roles : [];
      if (!roles.length) none++;
      for (const role of roles) {
        counts.set(role, (counts.get(role) || 0) + 1);
      }
    }
    const out = Array.from(counts, function (pair) {
      return { label: pair[0], count: pair[1] };
    }).sort(function (a, b) { return b.count - a.count; });
    if (none) out.push({ label: NOT_STATED, count: none });
    return out;
  }

  /*
   * Weight against time, one series per person, for people who have
   * submitted more than once. A single entry is a point, not a trend,
   * and drawing it as a one-pixel line implies a history that does not
   * exist.
   */
  /*
   * A point carries both systems rather than the chosen one, so this
   * function takes no units argument and there is exactly one of it.
   * The alternative - building the series once per system - is two
   * traversals that must agree about which points exist, and the
   * disagreement would show up as a line with a missing year in it.
   *
   * A point needs both values or it is dropped. Every row this form
   * writes carries both, so the case is malformed data rather than an
   * old record, and dropping it beats threading a null through the
   * chart geometry.
   */
  function weightSeries(entries) {
    const byHandle = new Map();
    for (const entry of entries) {
      if (!entry.telegram) continue;
      const imperial = num(entry[UNITS.imperial.weight.field]);
      const metric = num(entry[UNITS.metric.weight.field]);
      if (imperial === null || metric === null) continue;
      const at = timeOf(entry);
      if (!at) continue;
      if (!byHandle.has(entry.telegram)) byHandle.set(entry.telegram, []);
      byHandle.get(entry.telegram).push({
        at: at, imperial: imperial, metric: metric,
      });
    }
    const series = [];
    for (const pair of byHandle) {
      if (pair[1].length < 2) continue;
      series.push({
        telegram: pair[0],
        points: pair[1].sort(function (a, b) { return a.at - b.at; }),
      });
    }
    return series.sort(function (a, b) {
      return b.points.length - a.points.length ||
        a.telegram.localeCompare(b.telegram);
    });
  }

  /*
   * People whose height moved between entries.
   *
   * Height does not change in adults, so a difference here is a typo, a
   * unit mix-up, or two people sharing a handle - all of them things
   * the keyholder wants to know before trusting a distribution. A
   * centimetre of slack absorbs the rounding between the two unit
   * systems; anything more was typed differently.
   *
   * The detection is always metric and takes no units argument, which
   * is the one thing in this file that must not follow the toggle. Who
   * appears on this list is a fact about the data; if the threshold
   * moved with the display, switching units would quietly add and drop
   * people from a data-quality panel, and the panel would be reporting
   * on itself. Only the two figures are shown in the chosen units, and
   * both are carried here so the caller never has to convert either.
   */
  function heightDisagreements(entries) {
    const byHandle = new Map();
    for (const entry of entries) {
      const cm = num(entry.cm);
      if (!entry.telegram || cm === null) continue;
      if (!byHandle.has(entry.telegram)) byHandle.set(entry.telegram, []);
      byHandle.get(entry.telegram).push({
        cm: cm,
        // The same height, as the row already stores it. Reading it
        // rather than dividing by 2.54 keeps the conversion where it
        // belongs, in form.js.
        totalInches: num(entry.totalInches),
      });
    }
    const out = [];
    for (const pair of byHandle) {
      const values = pair[1];
      if (values.length < 2) continue;
      const sorted = values.slice().sort(function (a, b) { return a.cm - b.cm; });
      const low = sorted[0];
      const high = sorted[sorted.length - 1];
      if (high.cm - low.cm > 1) {
        out.push({
          telegram: pair[0],
          low: round(low.cm, 1),
          high: round(high.cm, 1),
          lowInches: low.totalInches === null ? null : round(low.totalInches, 1),
          highInches:
            high.totalInches === null ? null : round(high.totalInches, 1),
        });
      }
    }
    return out.sort(function (a, b) {
      return (b.high - b.low) - (a.high - a.low);
    });
  }

  /*
   * BMI stays metric no matter what the toggle says, because BMI is
   * defined in kg and metres. Reporting "BMI in imperial" would mean
   * either a different number for the same person or a second formula
   * with a 703 in it, and both are worse than a unitless index that
   * every reader already knows how to compare.
   */
  function bmiValues(entries) {
    const out = [];
    for (const entry of entries) {
      const value = bmi(entry.kg, entry.cm);
      if (value !== null) out.push(value);
    }
    return out;
  }

  /* One measure - a middle, an average and a distribution - in one unit
   * system. Everything that reports a number goes through here, so the
   * stat strip and the histogram beside it cannot be computed two
   * different ways. */
  function measureFor(entries, spec) {
    const values = numbers(entries, spec.field);
    return {
      median: median(values),
      mean: mean(values),
      bins: histogram(values, spec.bin),
    };
  }

  function summarise(entries, units) {
    const spec = unitsFor(units);
    const weight = measureFor(entries, spec.weight);
    const height = measureFor(entries, spec.height);
    const bmis = bmiValues(entries);
    return {
      units: spec.name,
      entries: entries.length,
      people: peopleCount(entries),
      weightMedian: weight.median,
      weightMean: weight.mean,
      heightMedian: height.median,
      heightMean: height.mean,
      bmiMedian: median(bmis),
      bmiMean: mean(bmis),
    };
  }

  const ROLE_VOCABULARY = ["feeder", "feedee", "gainer", "admirer"];

  /* ---------------------------------------------------------------- */
  /* The snapshot.                                                     */

  /*
   * Everything the dashboard draws, with nobody's name in it.
   *
   * This is the document the public page reads, and the reason it
   * exists is that a public page cannot be given rows. A de-identified
   * *row* is not de-identified: "female, GB, 241 lb, 5 ft 8 in" is a
   * person to anyone who knows her. Aggregates are not, so the
   * aggregation happens in the keyholder's browser, where the plaintext
   * already is, and only the result is published.
   *
   * Two consequences shape the format:
   *
   *   - Both counting bases and both unit systems are precomputed. The
   *     public page has no rows, so it cannot recompute either, and a
   *     toggle it cannot honour is a toggle that has to be removed.
   *   - It carries the time it was made. A dashboard quietly showing
   *     last month's numbers is worse than one that says it is stale,
   *     and the ordinary failure of a scheduled job is silence.
   *
   * `identify` is what separates the keyholder's view from the
   * published one. With it, labels are Telegram handles and the
   * data-quality panel is included; without it, labels are pseudonyms
   * numbered within this one document and the panel is dropped
   * entirely. The keyholder's own dashboard is drawn from a snapshot
   * with identify on, which is what makes Publish a preview rather
   * than a leap: the same code drew what is on screen.
   */
  const SNAPSHOT_VERSION = 1;

  function basisOf(entries) {
    const bmis = bmiValues(entries);
    const out = {
      count: entries.length,
      bmi: {
        median: median(bmis),
        mean: mean(bmis),
        bins: histogram(bmis, 5),
      },
      gender: countBy(entries, function (e) { return e.gender; }),
      roles: countRoles(entries, ROLE_VOCABULARY),
      country: countBy(entries, function (e) { return e.country; }),
    };
    for (const name in UNITS) {
      if (!Object.prototype.hasOwnProperty.call(UNITS, name)) continue;
      out[name] = {
        weight: measureFor(entries, UNITS[name].weight),
        height: measureFor(entries, UNITS[name].height),
      };
    }
    return out;
  }

  /*
   * Handles, or pseudonyms numbered in the order the charts already
   * reveal. "Person 1" being the most frequent submitter is visible
   * from the chart itself, so the numbering gives nothing away that the
   * picture does not.
   *
   * It is assigned fresh each time, which prevents *label* continuity
   * between two documents - and nothing more than that. This comment
   * used to claim renumbering meant "two snapshots cannot be lined up
   * to follow one person across them", which was false: the points
   * themselves were the join key. See quantise() below, and DESIGN.md,
   * "Renumbering does not prevent linkage - a correction".
   */
  function labeller(identify) {
    if (identify) {
      return function (handle) { return "@" + handle; };
    }
    const seen = new Map();
    return function (handle) {
      if (!seen.has(handle)) seen.set(handle, "Person " + (seen.size + 1));
      return seen.get(handle);
    };
  }

  const DAY = 86400000;

  /*
   * A published point carries the date rather than the instant, and
   * each weight on the bin edge the histogram already uses.
   *
   * This is what stands between the published series and cross-snapshot
   * linkage. An exact millisecond plus a weight to a tenth was a join
   * key: publish twice and one person's line reappeared verbatim in the
   * second document with a point on the end, so following them across
   * was a join rather than an analysis. Renumbering the pseudonyms
   * never touched that - see labeller() above.
   *
   * What this buys is **ambiguity, not absence**. Quantising is
   * deterministic, so an entry that did not change still quantises the
   * same way in both documents; the two snapshots go on sharing points.
   * The difference is that a shared point no longer identifies a line,
   * because several people's measurements land on the same date and the
   * same bin. dev/dashboard.test.mjs asserts that directly, and records
   * why the criterion REDESIGN.md originally specified - "share no
   * exact series point" - is not achievable by any amount of rounding.
   *
   * Each system is floored on its own stored field rather than one
   * being converted into the other. Converting would put a second copy
   * of form.js's conversion here, free to drift from it; the same rule
   * the unit toggle already follows.
   *
   * The chart loses precision a 620-pixel plot could not draw anyway,
   * and the keyholder's own snapshot keeps every decimal, because it
   * never leaves their tab.
   */
  function quantise(point) {
    const lb = UNITS.imperial.weight.bin;
    const kg = UNITS.metric.weight.bin;
    return {
      at: Math.floor(point.at / DAY) * DAY,
      imperial: Math.floor(point.imperial / lb) * lb,
      metric: Math.floor(point.metric / kg) * kg,
    };
  }

  function snapshotOf(entries, options, now) {
    const opts = options || {};
    const identify = opts.identify === true;
    const label = labeller(identify);

    const series = opts.series === false ? null :
      weightSeries(entries).map(function (line) {
        return {
          label: label(line.telegram),
          points: identify ? line.points : line.points.map(quantise),
        };
      });

    return {
      snapshot: SNAPSHOT_VERSION,
      generated: new Date(now === undefined ? Date.now() : now).toISOString(),
      identified: identify,
      counts: {
        entries: entries.length,
        people: peopleCount(entries),
      },
      series: series,
      // A data-quality panel is for whoever can act on it. Published,
      // it would be a list of strangers' heights and no use to anyone.
      quality: identify
        ? { heightChanges: heightDisagreements(entries) }
        : null,
      bases: {
        people: basisOf(latestPerPerson(entries)),
        entries: basisOf(entries),
      },
    };
  }

  root.BinderDashboard = {
    NOT_STATED: NOT_STATED,
    UNITS: UNITS,
    DEFAULT_UNITS: DEFAULT_UNITS,
    unitsFor: unitsFor,
    formatInches: formatInches,
    statText: statText,
    num: num,
    median: median,
    mean: mean,
    bmi: bmi,
    latestPerPerson: latestPerPerson,
    peopleCount: peopleCount,
    histogram: histogram,
    countBy: countBy,
    countRoles: countRoles,
    weightSeries: weightSeries,
    heightDisagreements: heightDisagreements,
    measureFor: measureFor,
    summarise: summarise,
    SNAPSHOT_VERSION: SNAPSHOT_VERSION,
    ROLE_VOCABULARY: ROLE_VOCABULARY,
    basisOf: basisOf,
    snapshotOf: snapshotOf,
  };

  /* ---------------------------------------------------------------- */
  /* Drawing. Everything above this line runs under Node.             */

  if (typeof document === "undefined") return;

  function svg(name, attributes, className) {
    const node = document.createElementNS(SVG_NS, name);
    for (const key in attributes) {
      if (Object.prototype.hasOwnProperty.call(attributes, key)) {
        node.setAttribute(key, String(attributes[key]));
      }
    }
    if (className) node.setAttribute("class", className);
    return node;
  }

  function figure(title, note) {
    const wrap = document.createElement("figure");
    wrap.className = "chart";
    const caption = document.createElement("figcaption");
    caption.textContent = title;
    wrap.appendChild(caption);
    if (note) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = note;
      wrap.appendChild(p);
    }
    return wrap;
  }

  function emptyNote(wrap, message) {
    const p = document.createElement("p");
    p.className = "muted small";
    p.textContent = message;
    wrap.appendChild(p);
    return wrap;
  }

  function canvas(width, height) {
    const node = svg("svg", {
      viewBox: "0 0 " + width + " " + height,
      preserveAspectRatio: "xMidYMid meet",
      role: "img",
    });
    return node;
  }

  /* Horizontal bars: category names are words, and words read better
     along the axis they are written in than rotated 90 degrees. */
  function barChart(items, total) {
    const rowHeight = 26;
    const labelWidth = 150;
    const width = 620;
    const height = Math.max(1, items.length) * rowHeight + 8;
    const node = canvas(width, height);
    const most = items.reduce(function (max, item) {
      return Math.max(max, item.count);
    }, 0) || 1;
    const barArea = width - labelWidth - 70;

    items.forEach(function (item, index) {
      const y = index * rowHeight + 4;
      node.appendChild(svg("text", {
        x: labelWidth - 8, y: y + 14, "text-anchor": "end",
      }, "chart-label")).textContent = item.label;

      node.appendChild(svg("rect", {
        x: labelWidth, y: y + 3, width: barArea, height: 16, rx: 3,
      }, "chart-track"));

      node.appendChild(svg("rect", {
        x: labelWidth, y: y + 3,
        width: Math.max(1, (item.count / most) * barArea), height: 16, rx: 3,
      }, "chart-bar"));

      const share = total ? " (" + Math.round((item.count / total) * 100) + "%)" : "";
      node.appendChild(svg("text", {
        x: labelWidth + barArea + 8, y: y + 15,
      }, "chart-value")).textContent = item.count + share;
    });
    return node;
  }

  function histogramChart(bins, unit, tick) {
    const label = tick || function (value) { return String(value); };
    const width = 620;
    const height = 200;
    const bottom = 30;
    const node = canvas(width, height);
    const most = bins.reduce(function (max, bin) {
      return Math.max(max, bin.count);
    }, 0) || 1;
    const slot = (width - 10) / bins.length;

    bins.forEach(function (bin, index) {
      const barHeight = (bin.count / most) * (height - bottom - 14);
      const x = 5 + index * slot;
      const y = height - bottom - barHeight;
      node.appendChild(svg("rect", {
        x: x + 1, y: y, width: Math.max(1, slot - 2), height: Math.max(1, barHeight), rx: 2,
      }, "chart-bar"));

      if (bin.count) {
        node.appendChild(svg("text", {
          x: x + slot / 2, y: y - 4, "text-anchor": "middle",
        }, "chart-value")).textContent = bin.count;
      }

      // Every label would collide; thin them out by how many fit.
      const every = Math.ceil(bins.length / 8);
      if (index % every === 0) {
        node.appendChild(svg("text", {
          x: x + slot / 2, y: height - bottom + 16, "text-anchor": "middle",
        }, "chart-label")).textContent = label(bin.from);
      }
    });

    node.appendChild(svg("line", {
      x1: 5, y1: height - bottom, x2: width - 5, y2: height - bottom,
    }, "chart-axis"));

    node.appendChild(svg("text", {
      x: width - 5, y: height - 6, "text-anchor": "end",
    }, "chart-label")).textContent = unit;
    return node;
  }

  /* `system` names which of the two values each point carries - every
   * point has both, so switching units redraws from the same series
   * rather than rebuilding it. */
  function lineChart(series, spec, system) {
    const width = 620;
    const height = 260;
    const pad = { top: 12, right: 12, bottom: 28, left: 44 };
    const node = canvas(width, height);

    let minAt = Infinity, maxAt = -Infinity;
    let lowest = Infinity, highest = -Infinity;
    for (const line of series) {
      for (const point of line.points) {
        if (point.at < minAt) minAt = point.at;
        if (point.at > maxAt) maxAt = point.at;
        if (point[system] < lowest) lowest = point[system];
        if (point[system] > highest) highest = point[system];
      }
    }
    // A flat series would divide by zero; give it room to sit in.
    if (maxAt === minAt) maxAt = minAt + 1;
    if (highest === lowest) { lowest -= 1; highest += 1; }
    const slack = (highest - lowest) * 0.1;
    lowest -= slack;
    highest += slack;

    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const x = (at) => pad.left + ((at - minAt) / (maxAt - minAt)) * plotW;
    const y = (value) =>
      pad.top + plotH - ((value - lowest) / (highest - lowest)) * plotH;

    // Axes and two reference labels, which is all a chart this size
    // can carry without becoming a table.
    node.appendChild(svg("line", {
      x1: pad.left, y1: pad.top, x2: pad.left, y2: pad.top + plotH,
    }, "chart-axis"));
    node.appendChild(svg("line", {
      x1: pad.left, y1: pad.top + plotH, x2: pad.left + plotW, y2: pad.top + plotH,
    }, "chart-axis"));

    node.appendChild(svg("text", {
      x: pad.left - 6, y: pad.top + 10, "text-anchor": "end",
    }, "chart-label")).textContent = round(highest, 0) + spec.suffix;
    node.appendChild(svg("text", {
      x: pad.left - 6, y: pad.top + plotH, "text-anchor": "end",
    }, "chart-label")).textContent = round(lowest, 0) + spec.suffix;

    const dateOf = (at) => new Date(at).toISOString().slice(0, 10);
    node.appendChild(svg("text", {
      x: pad.left, y: height - 8,
    }, "chart-label")).textContent = dateOf(minAt);
    node.appendChild(svg("text", {
      x: pad.left + plotW, y: height - 8, "text-anchor": "end",
    }, "chart-label")).textContent = dateOf(maxAt);

    series.forEach(function (line, index) {
      const cls = "chart-series series-" + (index % 6);
      const points = line.points.map(function (point) {
        return x(point.at) + "," + y(point[system]);
      }).join(" ");
      // fill is set by `polyline.chart-series` in theme.css, not here -
      // a presentation attribute would lose to the series colour rule.
      node.appendChild(svg("polyline", { points: points }, cls));
      line.points.forEach(function (point) {
        node.appendChild(svg("circle", {
          cx: x(point.at), cy: y(point[system]), r: 3,
        }, cls + " chart-dot"));
      });
      // The label, at the end of its own line - a legend for six series
      // costs more room than the labels do. It is a handle on the
      // keyholder's page and a pseudonym on the published one; this
      // function is told which, and does not decide.
      //
      // A line that finishes at the right edge has no room to its
      // right, so the label is anchored the other way and lifted clear
      // of the line rather than being drawn along it.
      const last = line.points[line.points.length - 1];
      const atEdge = x(last.at) > width - 60;
      node.appendChild(svg("text", {
        x: atEdge ? x(last.at) - 6 : x(last.at) + 6,
        y: atEdge ? y(last[system]) - 8 : y(last[system]) + 4,
        "text-anchor": atEdge ? "end" : "start",
      }, "chart-label " + cls.split(" ")[1] + " chart-series-label"))
        .textContent = line.label;
    });

    return node;
  }

  /*
   * Draws a snapshot. Not rows - a snapshot, which is what makes the
   * keyholder's dashboard and the public one the same code rather than
   * two things that look alike.
   *
   * `basis` picks what the distributions count: one row per person, or
   * every row. The weight-over-time chart ignores it and always uses
   * everything, because the repeats are the entire point of it.
   * `units` picks which of the two precomputed systems is shown, and
   * nothing here converts anything.
   */
  function render(container, snapshot, basis, units) {
    container.textContent = "";
    const spec = unitsFor(units);
    const which = basis === "entries" ? "entries" : "people";
    const view = snapshot.bases[which];
    const measures = view[spec.name];

    const strip = document.createElement("div");
    strip.className = "stats";
    [
      ["Entries", snapshot.counts.entries],
      ["People", snapshot.counts.people],
      ["Median weight", statText(measures.weight.median, spec.weight)],
      ["Median height", statText(measures.height.median, spec.height)],
      ["Median BMI", view.bmi.median === null ? "—" : view.bmi.median],
      ["Mean weight", statText(measures.weight.mean, spec.weight)],
    ].forEach(function (pair) {
      const cell = document.createElement("div");
      cell.className = "stat";
      const label = document.createElement("span");
      label.className = "stat-label";
      label.textContent = pair[0];
      const value = document.createElement("strong");
      value.className = "stat-value tabular";
      value.textContent = String(pair[1]);
      cell.appendChild(label);
      cell.appendChild(value);
      strip.appendChild(cell);
    });
    container.appendChild(strip);

    // Weight over time - every entry, always. A null series means the
    // snapshot was published without it, which is a decision made at
    // publish time and not something this page can undo.
    const series = snapshot.series;
    if (series) {
      const repeatNote = series.length
        ? series.length + " of " + snapshot.counts.people +
          " people have submitted more than once."
        : null;
      // Full width in the chart grid: it is the only chart with a real
      // horizontal axis, and squeezing a year into half a column wastes
      // the one thing it has to show.
      const timeWrap = figure("Weight over time", repeatNote);
      timeWrap.classList.add("chart-wide");
      if (series.length) {
        timeWrap.appendChild(
          lineChart(series.slice(0, 12), spec.weight, spec.name));
        if (series.length > 12) {
          emptyNote(timeWrap, "Showing the 12 with the most entries.");
        }
      } else {
        emptyNote(timeWrap,
          "Nobody has submitted twice yet, so there is no history to plot. " +
          "This fills in as people resubmit.");
      }
      container.appendChild(timeWrap);
    }

    const heightMoved = snapshot.quality ? snapshot.quality.heightChanges : [];
    if (heightMoved.length) {
      const wrap = figure("Heights that changed between entries",
        "Height does not change in adults, so these are typos, a unit " +
        "mix-up, or one handle used by two people. Worth checking before " +
        "trusting the height figures.");
      wrap.classList.add("chart-wide");   // a list, not a chart
      const list = document.createElement("pre");
      list.className = "failure-list";
      list.textContent = heightMoved.map(function (item) {
        // Metric is the fallback when a row predates totalInches, not a
        // preference - an older record has a cm and nothing else, and
        // showing it is better than showing a blank.
        const imperial = spec.name === "imperial" &&
          item.lowInches !== null && item.highInches !== null;
        return imperial
          ? "@" + item.telegram + ": " + formatInches(item.lowInches) +
            " to " + formatInches(item.highInches)
          : "@" + item.telegram + ": " + item.low + "cm to " + item.high + "cm";
      }).join("\n");
      wrap.appendChild(list);
      container.appendChild(wrap);
    }

    const weightWrap = figure("Weight", "in " + spec.weight.band);
    if (measures.weight.bins.length) {
      weightWrap.appendChild(histogramChart(
        measures.weight.bins, spec.weight.suffix, spec.weight.tick));
    } else emptyNote(weightWrap, "No weights recorded.");
    container.appendChild(weightWrap);

    const heightWrap = figure("Height", "in " + spec.height.band);
    if (measures.height.bins.length) {
      heightWrap.appendChild(histogramChart(
        measures.height.bins, spec.height.suffix, spec.height.tick));
    } else emptyNote(heightWrap, "No heights recorded.");
    container.appendChild(heightWrap);

    const bmiWrap = figure("BMI",
      "Weight over height squared, and nothing more — the clinical " +
      "category labels are deliberately not shown.");
    if (view.bmi.bins.length) {
      bmiWrap.appendChild(histogramChart(view.bmi.bins, "BMI"));
    } else emptyNote(bmiWrap, "Not enough data to compute BMI.");
    container.appendChild(bmiWrap);

    const genderWrap = figure("Gender");
    genderWrap.appendChild(barChart(view.gender, view.count));
    container.appendChild(genderWrap);

    const rolesWrap = figure("Feedism affiliations",
      "Multi-select, so these do not add up to the number of entries.");
    rolesWrap.appendChild(barChart(view.roles, view.count));
    container.appendChild(rolesWrap);

    const countryWrap = figure("Country",
      view.country.length > 12 ? "Top 12 by count." : null);
    countryWrap.appendChild(barChart(view.country.slice(0, 12), view.count));
    container.appendChild(countryWrap);
  }

  root.BinderDashboard.render = render;
})(globalThis);
