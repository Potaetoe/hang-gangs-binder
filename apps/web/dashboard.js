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
  function weightSeries(entries) {
    const byHandle = new Map();
    for (const entry of entries) {
      if (!entry.telegram) continue;
      const kg = num(entry.kg);
      if (kg === null) continue;
      const at = timeOf(entry);
      if (!at) continue;
      if (!byHandle.has(entry.telegram)) byHandle.set(entry.telegram, []);
      byHandle.get(entry.telegram).push({ at: at, kg: kg });
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
   */
  function heightDisagreements(entries) {
    const byHandle = new Map();
    for (const entry of entries) {
      const cm = num(entry.cm);
      if (!entry.telegram || cm === null) continue;
      if (!byHandle.has(entry.telegram)) byHandle.set(entry.telegram, []);
      byHandle.get(entry.telegram).push(cm);
    }
    const out = [];
    for (const pair of byHandle) {
      const values = pair[1];
      if (values.length < 2) continue;
      const low = Math.min.apply(null, values);
      const high = Math.max.apply(null, values);
      if (high - low > 1) {
        out.push({ telegram: pair[0], low: round(low, 1), high: round(high, 1) });
      }
    }
    return out.sort(function (a, b) {
      return (b.high - b.low) - (a.high - a.low);
    });
  }

  function summarise(entries) {
    const withBmi = [];
    for (const entry of entries) {
      const value = bmi(entry.kg, entry.cm);
      if (value !== null) withBmi.push(value);
    }
    const weights = numbers(entries, "kg");
    const heights = numbers(entries, "cm");
    return {
      entries: entries.length,
      people: peopleCount(entries),
      weightMedian: median(weights),
      weightMean: mean(weights),
      heightMedian: median(heights),
      heightMean: mean(heights),
      bmiMedian: median(withBmi),
      bmiMean: mean(withBmi),
    };
  }

  root.BinderDashboard = {
    NOT_STATED: NOT_STATED,
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
    summarise: summarise,
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

  function histogramChart(bins, unit) {
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
        }, "chart-label")).textContent = bin.from;
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

  function lineChart(series) {
    const width = 620;
    const height = 260;
    const pad = { top: 12, right: 12, bottom: 28, left: 44 };
    const node = canvas(width, height);

    let minAt = Infinity, maxAt = -Infinity, minKg = Infinity, maxKg = -Infinity;
    for (const line of series) {
      for (const point of line.points) {
        if (point.at < minAt) minAt = point.at;
        if (point.at > maxAt) maxAt = point.at;
        if (point.kg < minKg) minKg = point.kg;
        if (point.kg > maxKg) maxKg = point.kg;
      }
    }
    // A flat series would divide by zero; give it room to sit in.
    if (maxAt === minAt) maxAt = minAt + 1;
    if (maxKg === minKg) { minKg -= 1; maxKg += 1; }
    const padKg = (maxKg - minKg) * 0.1;
    minKg -= padKg;
    maxKg += padKg;

    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const x = (at) => pad.left + ((at - minAt) / (maxAt - minAt)) * plotW;
    const y = (kg) => pad.top + plotH - ((kg - minKg) / (maxKg - minKg)) * plotH;

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
    }, "chart-label")).textContent = round(maxKg, 0) + "kg";
    node.appendChild(svg("text", {
      x: pad.left - 6, y: pad.top + plotH, "text-anchor": "end",
    }, "chart-label")).textContent = round(minKg, 0) + "kg";

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
        return x(point.at) + "," + y(point.kg);
      }).join(" ");
      // fill is set by `polyline.chart-series` in theme.css, not here -
      // a presentation attribute would lose to the series colour rule.
      node.appendChild(svg("polyline", { points: points }, cls));
      line.points.forEach(function (point) {
        node.appendChild(svg("circle", {
          cx: x(point.at), cy: y(point.kg), r: 3,
        }, cls + " chart-dot"));
      });
      // The handle, at the end of its own line - a legend for six
      // series costs more room than the labels do.
      const last = line.points[line.points.length - 1];
      node.appendChild(svg("text", {
        x: Math.min(x(last.at) + 6, width - 4), y: y(last.kg) + 4,
        "text-anchor": x(last.at) > width - 60 ? "end" : "start",
      }, "chart-label " + cls.split(" ")[1] + " chart-series-label"))
        .textContent = line.telegram;
    });

    return node;
  }

  const ROLE_VOCABULARY = ["feeder", "feedee", "gainer", "admirer"];

  /*
   * `entries` is every decrypted row. `basis` picks what the snapshot
   * charts count - one row per person, or every row. The weight-over-
   * time chart ignores it and always uses everything, because the
   * repeats are the entire point of that chart.
   */
  function render(container, entries, basis) {
    container.textContent = "";
    const snapshot = basis === "entries" ? entries : latestPerPerson(entries);
    const stats = summarise(snapshot);

    const strip = document.createElement("div");
    strip.className = "stats";
    [
      ["Entries", entries.length],
      ["People", peopleCount(entries)],
      ["Median weight", stats.weightMedian === null ? "—" : stats.weightMedian + " kg"],
      ["Median height", stats.heightMedian === null ? "—" : stats.heightMedian + " cm"],
      ["Median BMI", stats.bmiMedian === null ? "—" : stats.bmiMedian],
      ["Mean weight", stats.weightMean === null ? "—" : stats.weightMean + " kg"],
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

    // Weight over time - every entry, always.
    const series = weightSeries(entries);
    const repeatNote = series.length
      ? series.length + " of " + peopleCount(entries) +
        " people have submitted more than once."
      : null;
    const timeWrap = figure("Weight over time", repeatNote);
    if (series.length) {
      timeWrap.appendChild(lineChart(series.slice(0, 12)));
      if (series.length > 12) {
        emptyNote(timeWrap, "Showing the 12 with the most entries.");
      }
    } else {
      emptyNote(timeWrap,
        "Nobody has submitted twice yet, so there is no history to plot. " +
        "This fills in as people resubmit.");
    }
    container.appendChild(timeWrap);

    const heightMoved = heightDisagreements(entries);
    if (heightMoved.length) {
      const wrap = figure("Heights that changed between entries",
        "Height does not change in adults, so these are typos, a unit " +
        "mix-up, or one handle used by two people. Worth checking before " +
        "trusting the height figures.");
      const list = document.createElement("pre");
      list.className = "failure-list";
      list.textContent = heightMoved.map(function (item) {
        return "@" + item.telegram + ": " + item.low + "cm to " + item.high + "cm";
      }).join("\n");
      wrap.appendChild(list);
      container.appendChild(wrap);
    }

    const weights = numbers(snapshot, "kg");
    const weightWrap = figure("Weight", "kg, in 10 kg bands");
    if (weights.length) weightWrap.appendChild(histogramChart(histogram(weights, 10), "kg"));
    else emptyNote(weightWrap, "No weights recorded.");
    container.appendChild(weightWrap);

    const heights = numbers(snapshot, "cm");
    const heightWrap = figure("Height", "cm, in 5 cm bands");
    if (heights.length) heightWrap.appendChild(histogramChart(histogram(heights, 5), "cm"));
    else emptyNote(heightWrap, "No heights recorded.");
    container.appendChild(heightWrap);

    const bmis = [];
    for (const entry of snapshot) {
      const value = bmi(entry.kg, entry.cm);
      if (value !== null) bmis.push(value);
    }
    const bmiWrap = figure("BMI",
      "Weight over height squared, and nothing more — the clinical " +
      "category labels are deliberately not shown.");
    if (bmis.length) bmiWrap.appendChild(histogramChart(histogram(bmis, 5), "BMI"));
    else emptyNote(bmiWrap, "Not enough data to compute BMI.");
    container.appendChild(bmiWrap);

    const genderWrap = figure("Gender");
    genderWrap.appendChild(barChart(
      countBy(snapshot, function (e) { return e.gender; }), snapshot.length));
    container.appendChild(genderWrap);

    const rolesWrap = figure("Feedism affiliations",
      "Multi-select, so these do not add up to the number of entries.");
    rolesWrap.appendChild(barChart(
      countRoles(snapshot, ROLE_VOCABULARY), snapshot.length));
    container.appendChild(rolesWrap);

    const countries = countBy(snapshot, function (e) { return e.country; });
    const countryWrap = figure("Country",
      countries.length > 12 ? "Top 12 by count." : null);
    countryWrap.appendChild(barChart(countries.slice(0, 12), snapshot.length));
    container.appendChild(countryWrap);
  }

  root.BinderDashboard.render = render;
})(globalThis);
