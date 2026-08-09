

(function (root) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  function round(value, places) {
    const factor = Math.pow(10, places);
    return Math.round(value * factor) / factor;
  }

   
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

  

  function sum(values) {
    if (!values.length) return null;
    let total = 0;
    for (const value of values) total += value;
    return round(total, 1);
  }

  

  function bmi(kg, cm) {
    const weight = num(kg);
    const height = num(cm);
    if (weight === null || height === null || height <= 0) return null;
    const metres = height / 100;
    return round(weight / (metres * metres), 1);
  }

  

  function formatInches(totalInches) {
    const value = num(totalInches);
    if (value === null) return "";
    const total = Math.round(value);
    return Math.floor(total / 12) + "'" + (total % 12) + '"';
  }

  

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

  

  function statText(value, spec) {
    return value === null || value === undefined ? "—" : spec.stat(value);
  }

  

  function timeOf(entry) {
    const stamp = entry.submittedAt || entry.receivedAt;
    const parsed = stamp ? Date.parse(stamp) : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  }

  

  function identityOf(entry) {
    if (entry.accountId) return "a:" + entry.accountId;
    if (entry.telegram) return "@" + entry.telegram;
    return "#" + entry.id;
  }

  

  function latestPerPerson(entries) {
    const byPerson = new Map();
    for (const entry of entries) {
      const key = identityOf(entry);
      const previous = byPerson.get(key);
      if (!previous || timeOf(entry) >= timeOf(previous)) {
        byPerson.set(key, entry);
      }
    }
    return Array.from(byPerson.values());
  }

  

  function groupByPerson(entries, take) {
    const groups = new Map();
    for (const entry of entries) {
      const value = take(entry);
      if (value === null) continue;
      const key = identityOf(entry);
      if (!groups.has(key)) {
        groups.set(key, { telegram: null, at: -Infinity, values: [] });
      }
      const group = groups.get(key);
      group.values.push(value);
      const at = timeOf(entry);
      if (entry.telegram && at >= group.at) {
        group.telegram = entry.telegram;
        group.at = at;
      }
    }
    return groups;
  }

  function peopleCount(entries) {
    return latestPerPerson(entries).length;
  }

  

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
      if (index >= bins.length) index = bins.length - 1;  
      if (index < 0) index = 0;
      bins[index].count++;
    }
    return bins;
  }

  const NOT_STATED = "Not stated";

  

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
      if (a.label === NOT_STATED) return 1;    
      if (b.label === NOT_STATED) return -1;
      return b.count - a.count || a.label.localeCompare(b.label);
    });
  }

  

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

  

  

  

  function weightSeries(entries) {
    const groups = groupByPerson(entries, function (entry) {
      const imperial = num(entry[UNITS.imperial.weight.field]);
      const metric = num(entry[UNITS.metric.weight.field]);
      const at = timeOf(entry);
      if (imperial === null || metric === null || !at) return null;
      return { at: at, imperial: imperial, metric: metric };
    });

    const series = [];
    for (const pair of groups) {
      const group = pair[1];
      if (group.values.length < 2 || !group.telegram) continue;
      series.push({
        telegram: group.telegram,
        points: group.values.sort(function (a, b) { return a.at - b.at; }),
      });
    }
    return series.sort(function (a, b) {
      return b.points.length - a.points.length ||
        a.telegram.localeCompare(b.telegram);
    });
  }

  

  function heightDisagreements(entries) {
    const groups = groupByPerson(entries, function (entry) {
      const cm = num(entry.cm);
      if (cm === null) return null;
      return {
        cm: cm,
         
         
         
        totalInches: num(entry.totalInches),
      };
    });
    const out = [];
    for (const pair of groups) {
      const group = pair[1];
      if (group.values.length < 2 || !group.telegram) continue;
      const sorted = group.values.slice().sort(
        function (a, b) { return a.cm - b.cm; });
      const low = sorted[0];
      const high = sorted[sorted.length - 1];
      if (high.cm - low.cm > 1) {
        out.push({
          telegram: group.telegram,
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

  

  function handleDisagreements(entries) {
    const byAccount = new Map();
    for (const entry of entries) {
      if (!entry.accountId || !entry.telegram) continue;
      if (!byAccount.has(entry.accountId)) {
        byAccount.set(entry.accountId, new Map());
      }
      const handles = byAccount.get(entry.accountId);
      const at = timeOf(entry);
      if (!handles.has(entry.telegram) || at > handles.get(entry.telegram)) {
        handles.set(entry.telegram, at);
      }
    }
    const out = [];
    for (const pair of byAccount) {
      if (pair[1].size < 2) continue;
      out.push({
        handles: Array.from(pair[1])
          .sort(function (a, b) { return b[1] - a[1]; })
          .map(function (seen) { return seen[0]; }),
      });
    }
    return out.sort(function (a, b) {
      return b.handles.length - a.handles.length;
    });
  }

  

  function bmiValues(entries) {
    const out = [];
    for (const entry of entries) {
      const value = bmi(entry.kg, entry.cm);
      if (value !== null) out.push(value);
    }
    return out;
  }

  

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

   
   

  

  const SNAPSHOT_VERSION = 1;

  

  const MIN_CELL = 5;
  const OTHER_LABEL = "Other (fewer than " + MIN_CELL + ")";

  

  function suppressCounts(rows, floor) {
    if (!(floor > 1) || !rows.length) return rows;

    const kept = [];
    const small = [];
    for (const row of rows) {
      if (row.count === 0 || row.count >= floor) kept.push(row);
      else small.push(row);
    }
    if (!small.length) return rows;

    let other = 0;
    for (const row of small) other += row.count;

     
     
     
    while (other < floor) {
      let index = -1;
      for (let i = 0; i < kept.length; i++) {
        if (kept[i].count === 0) continue;
        if (index === -1 || kept[i].count < kept[index].count) index = i;
      }
      if (index === -1) break;
      other += kept[index].count;
      kept.splice(index, 1);
    }

     
     
     
     
     
     
     
     
     
    const named = kept.filter(function (row) { return row.count > 0; });
    if (other < floor || !named.length) return [];

    return kept.concat([{ label: OTHER_LABEL, count: other }]);
  }

  

  function suppressBins(bins, floor) {
    if (!(floor > 1) || !bins.length) return bins;

    const out = [];
    let open = null;
    for (const bin of bins) {
      open = open === null
        ? { from: bin.from, to: bin.to, count: bin.count }
        : { from: open.from, to: bin.to, count: open.count + bin.count };
      if (open.count >= floor) {
        out.push(open);
        open = null;
      }
    }
    if (open !== null) {
      if (!out.length) return [];           
      const last = out[out.length - 1];
      last.to = open.to;
      last.count += open.count;
    }
    return out;
  }

  function basisOf(entries, floor) {
     
     
     
     
    if (floor > 1 && entries.length < floor) return null;

    const bmis = bmiValues(entries);
    const out = {
      count: entries.length,
      bmi: {
        median: median(bmis),
        mean: mean(bmis),
        bins: suppressBins(histogram(bmis, 5), floor),
      },
      gender: suppressCounts(
        countBy(entries, function (e) { return e.gender; }), floor),
      roles: suppressCounts(countRoles(entries, ROLE_VOCABULARY), floor),
      country: suppressCounts(
        countBy(entries, function (e) { return e.country; }), floor),
    };
    for (const name in UNITS) {
      if (!Object.prototype.hasOwnProperty.call(UNITS, name)) continue;
      out[name] = {
        weight: measureFor(entries, UNITS[name].weight),
        height: measureFor(entries, UNITS[name].height),
      };
      

      out[name].weight.total =
        sum(numbers(entries, UNITS[name].weight.field));
    }

    

    if (floor > 1) repartition(entries, out, floor);

    return out;
  }

  

  

  const LABEL_FACTOR = { kg: 1, lb: 2.2046226218, cm: 1, totalInches: 1 / 2.54 };

  function repartition(entries, out, floor) {
    const base = unitsFor(DEFAULT_UNITS);
    for (const measure of ["weight", "height"]) {
      const spec = base[measure];
      const merged = suppressBins(
        histogram(numbers(entries, spec.field), spec.bin), floor);

      for (const name in UNITS) {
        if (!Object.prototype.hasOwnProperty.call(UNITS, name)) continue;
        const field = UNITS[name][measure].field;
        const scale = LABEL_FACTOR[field] / LABEL_FACTOR[spec.field];
        out[name][measure].bins = merged.map(function (bin) {
          return {
            from: round(bin.from * scale, 1),
            to: round(bin.to * scale, 1),
            count: bin.count,
          };
        });
      }
    }
  }

  

  function labeller(identify) {
    if (identify) {
      return function (line) { return "@" + line.telegram; };
    }
    const seen = new Map();
    return function (line) {
      if (!seen.has(line)) seen.set(line, "Person " + (seen.size + 1));
      return seen.get(line);
    };
  }

  const DAY = 86400000;

  

  function quantize(point) {
    const lb = UNITS.imperial.weight.bin;
    const kg = UNITS.metric.weight.bin;
    return {
      at: Math.floor(point.at / DAY) * DAY,
      imperial: Math.floor(point.imperial / lb) * lb,
      metric: Math.floor(point.metric / kg) * kg,
    };
  }

  

  function movedSince(entries, since) {
    const at = Date.parse(since);
    if (!Number.isFinite(at)) return 0;
    const people = new Set();
    for (const entry of entries) {
      if (timeOf(entry) >= at) people.add(identityOf(entry));
    }
    return people.size;
  }

  

  function weightMovement(now, before) {
    if (!now || !before) return null;
    const out = {};
    for (const name in UNITS) {
      if (!Object.prototype.hasOwnProperty.call(UNITS, name)) continue;
      const here = now[name] ? num(now[name].weight.total) : null;
      const there = before[name] ? num(before[name].weight.total) : null;
      if (here === null || there === null) return null;
      out[name] = { weight: round(here - there, 1) };
    }
    return out;
  }

  

  function movementOf(entries, previous, bases, floor) {
    if (!previous || typeof previous !== "object") return null;
    const since = previous.generated;
    if (typeof since !== "string" || !Number.isFinite(Date.parse(since))) {
      return null;
    }
    if (!previous.bases) return null;

    const moved = {};
    let comparable = false;
    for (const basis in bases) {
      if (!Object.prototype.hasOwnProperty.call(bases, basis)) continue;
      moved[basis] = weightMovement(bases[basis], previous.bases[basis]);
      if (moved[basis] !== null) comparable = true;
    }
    if (!comparable) return null;

    if (floor > 1 && movedSince(entries, since) < floor) {
      return { since: since, bases: null };
    }
    return { since: since, bases: moved };
  }

  function snapshotOf(entries, options, now) {
    const opts = options || {};
    const identify = opts.identify === true;
    const label = labeller(identify);

     
     
     
     
    const floor = identify ? 0 : MIN_CELL;

    let series = opts.series === false ? null :
      weightSeries(entries).map(function (line) {
        return {
          label: label(line),
          points: identify ? line.points : line.points.map(quantize),
        };
      });

    

    let seriesWithheld = false;
    if (series && !identify && series.length < floor) {
      series = null;
      seriesWithheld = true;
    }

    const bases = {
      people: basisOf(latestPerPerson(entries), floor),
      entries: basisOf(entries, floor),
    };

    return {
      snapshot: SNAPSHOT_VERSION,
      generated: new Date(now === undefined ? Date.now() : now).toISOString(),
      identified: identify,
      counts: {
        entries: entries.length,
        people: peopleCount(entries),
      },
      series: series,
       
       
       
       
      seriesWithheld: seriesWithheld,
       
       
       
      quality: identify
        ? {
            heightChanges: heightDisagreements(entries),
            handleChanges: handleDisagreements(entries),
          }
        : null,
      bases: bases,
      

      movement: movementOf(entries, opts.previous, bases, floor),
    };
  }

  const api = {
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
    handleDisagreements: handleDisagreements,
    measureFor: measureFor,
    summarise: summarise,
    SNAPSHOT_VERSION: SNAPSHOT_VERSION,
    ROLE_VOCABULARY: ROLE_VOCABULARY,
    basisOf: basisOf,
    snapshotOf: snapshotOf,
    movedSince: movedSince,
    suppressCounts: suppressCounts,
    suppressBins: suppressBins,
    MIN_CELL: MIN_CELL,
    OTHER_LABEL: OTHER_LABEL,
  };

   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
  if (typeof document !== "undefined") {
    api.render = render;
    api.renderProgress = renderProgress;
  }
  root.BinderDashboard = Object.freeze(api);

   
   

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

  

  const WITHHELD =
    "Too few people to show this without describing individual people.";
  const SERIES_WITHHELD = "Too few people have more than one entry to " +
    "show this without identifying them.";
  const ONE_BAND =
    "Everybody here falls in a single band, so there is no shape to show.";

  function canvas(width, height) {
    const node = svg("svg", {
      viewBox: "0 0 " + width + " " + height,
      preserveAspectRatio: "xMidYMid meet",
      role: "img",
    });
    return node;
  }

  

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
       
       
      node.appendChild(svg("polyline", { points: points }, cls));
      line.points.forEach(function (point) {
        node.appendChild(svg("circle", {
          cx: x(point.at), cy: y(point[system]), r: 3,
        }, cls + " chart-dot"));
      });
       
       
       
       
       
       
       
       
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

  

  function breakdown(title, note, rows, total, floored) {
    const drawn = rows.length > 0 || !floored;
    const wrap = figure(title, drawn ? note : null);
    if (drawn) wrap.appendChild(barChart(rows, total));
    else emptyNote(wrap, WITHHELD);
    return wrap;
  }

  

  function distribution(title, note, bins, unit, tick, absent, floored) {
    const flat = floored && bins.length === 1;
    const drawn = bins.length > 0 && !flat;
    const wrap = figure(title, drawn || !floored ? note : null);
    if (!bins.length) emptyNote(wrap, floored ? WITHHELD : absent);
    else if (flat) emptyNote(wrap, ONE_BAND);
    else wrap.appendChild(histogramChart(bins, unit, tick));
    return wrap;
  }

  function basisName(basis) {
    return basis === "entries" ? "entries" : "people";
  }

  

  const MINUS = "−";

  

  function movementText(snapshot, basis, spec) {
    const movement = snapshot.movement;
    if (!movement || typeof movement.since !== "string") return null;
    const day = movement.since.slice(0, 10);

    if (movement.bases === null) {
      return "Too few entries have moved since " + day +
        " to say by how much.";
    }
    const moved = movement.bases[basisName(basis)];
    const value = moved ? num(moved[spec.name].weight) : null;
    if (value === null) return null;

    return (value < 0 ? MINUS : "+") +
      spec.weight.stat(round(Math.abs(value), 1)) + " since " + day + ".";
  }

  

  function heroFor(snapshot, view, basis, spec) {
    const total = view[spec.name] ? num(view[spec.name].weight.total) : null;
    if (total === null) return null;

    const wrap = document.createElement("div");
    wrap.className = "hero";

    const label = document.createElement("p");
    label.className = "hero-label";
    label.textContent = basisName(basis) === "entries"
      ? "Every entry, added up"
      : "What we weigh, together";
    wrap.appendChild(label);

    

    const value = document.createElement("p");
    value.className = "hero-value";
    value.textContent = statText(total, spec.weight);
    wrap.appendChild(value);

    const moved = movementText(snapshot, basis, spec);
    if (moved !== null) {
      const delta = document.createElement("p");
      delta.className = "hero-delta";
      delta.textContent = moved;
      wrap.appendChild(delta);
    }
    return wrap;
  }

  

  function render(container, snapshot, basis, units) {
    container.textContent = "";
    drawPanels(container, snapshot, basis, units);
  }

  

  function renderProgress(container, snapshot, basis, units) {
    container.textContent = "";
    const view = snapshot.bases[basisName(basis)];
    if (view !== null) {
      const hero = heroFor(snapshot, view, basis, unitsFor(units));
      if (hero !== null) container.appendChild(hero);
    }
    drawPanels(container, snapshot, basis, units);
  }

  

  function drawPanels(container, snapshot, basis, units) {
    const spec = unitsFor(units);
    const which = basisName(basis);
    const view = snapshot.bases[which];

    

    const floored = snapshot.identified === false;

    

    if (view === null) {
      const note = document.createElement("p");
      note.className = "muted";
      note.textContent =
        "There are too few entries here to publish a breakdown without " +
        "describing individual people. Nothing is shown until there are " +
        "at least " + MIN_CELL + ".";
      container.appendChild(note);
      return;
    }

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

     
     
     
    const series = snapshot.series;
    if (series) {
      const repeatNote = series.length
        ? series.length + " of " + snapshot.counts.people +
          " people have submitted more than once."
        : null;
       
       
       
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
    } else if (snapshot.seriesWithheld === true) {
      

      const withheldWrap = figure("Weight over time");
      withheldWrap.classList.add("chart-wide");
      emptyNote(withheldWrap, SERIES_WITHHELD);
      container.appendChild(withheldWrap);
    }

    

    const handlesMoved =
      (snapshot.quality && snapshot.quality.handleChanges) || [];
    if (handlesMoved.length) {
      const wrap = figure("Accounts using more than one handle",
        "These rows are counted as one person, because the account is " +
        "the identity and the handle is only a label the member's own " +
        "browser wrote. Two handles under one account is a rename or a " +
        "lie; most recent spelling first.");
      wrap.classList.add("chart-wide");    
      const list = document.createElement("pre");
      list.className = "failure-list";
      list.textContent = handlesMoved.map(function (item) {
        return item.handles.map(function (handle) {
          return "@" + handle;
        }).join(", ");
      }).join("\n");
      wrap.appendChild(list);
      container.appendChild(wrap);
    }

    const heightMoved = snapshot.quality ? snapshot.quality.heightChanges : [];
    if (heightMoved.length) {
      const wrap = figure("Heights that changed between entries",
        "Height does not change in adults, so these are typos or a unit " +
        "mix-up. Worth checking before trusting the height figures.");
      wrap.classList.add("chart-wide");    
      const list = document.createElement("pre");
      list.className = "failure-list";
      list.textContent = heightMoved.map(function (item) {
         
         
         
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

    container.appendChild(distribution("Weight", "in " + spec.weight.band,
      measures.weight.bins, spec.weight.suffix, spec.weight.tick,
      "No weights recorded.", floored));

    container.appendChild(distribution("Height", "in " + spec.height.band,
      measures.height.bins, spec.height.suffix, spec.height.tick,
      "No heights recorded.", floored));

    container.appendChild(distribution("BMI",
      "Weight over height squared, and nothing more — the clinical " +
      "category labels are deliberately not shown.",
      view.bmi.bins, "BMI", null,
      "Not enough data to compute BMI.", floored));

    container.appendChild(
      breakdown("Gender", null, view.gender, view.count, floored));

    

    container.appendChild(breakdown("Feedism affiliations",
      "Multi-select, so these do not add up to the number of entries — " +
      "which is why no share is shown beside them.",
      view.roles, null, floored));

    container.appendChild(breakdown("Country",
      view.country.length > 12 ? "Top 12 by count." : null,
      view.country.slice(0, 12), view.count, floored));
  }
})(globalThis);
