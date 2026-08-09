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
 *   - Color comes from CSS classes in theme.css, never from a `style`
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

  /* The same rule as every other figure here: nothing invents a zero for
   * a measurement nobody gave. An empty group has no combined weight,
   * which is not the same claim as a group that weighs nothing. */
  function sum(values) {
    if (!values.length) return null;
    let total = 0;
    for (const value of values) total += value;
    return round(total, 1);
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
   * already - see archive/DESIGN.md, "Why every row carries both unit systems"
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
   * Which person a row belongs to. Every grouping in this file goes
   * through here, so there is one answer to "is this the same person"
   * rather than one per chart.
   *
   * DESIGN.md, "The identifier is the whole problem": the account id is
   * set server-side from a verified sign-in and cannot be forged by the
   * page, while the handle inside the encrypted blob is a label the
   * member's own browser wrote. Grouping on the handle makes a rename
   * two people, and makes two members who typed the same handle one
   * person with a single impossible history. The id decides; the handle
   * is only ever a caption.
   *
   * The prefixes keep the three key spaces apart. Without them an
   * account id that happens to read like somebody's handle would group
   * with that handle, which is the merge this function exists to stop.
   *
   * A row with no account id falls back to its handle, and a row with
   * neither stands alone under its own row id. That is not a second
   * identity scheme - it is the rule that an absent id must never act
   * as a shared one, because the id is the identity and nothing is not
   * an identity. Rows the Worker stores always carry one
   * (`server/schema.sql` declares the column NOT NULL and
   * `handleExport` selects it), so a row without one arrived some other
   * way: an export file saved from an earlier database, or a payload
   * put together by hand. Letting them share a key would gather every
   * unidentifiable row into one enormous submitter, which is the same
   * failure the "#id" case exists to prevent for blank handles.
   */
  function identityOf(entry) {
    if (entry.accountId) return "a:" + entry.accountId;
    if (entry.telegram) return "@" + entry.telegram;
    return "#" + entry.id;
  }

  /*
   * One entry per person, keeping the most recent.
   *
   * Storage is append-only and the form cannot detect a repeat, so a
   * resubmission is a new row - see OPERATIONS.md, "Reading the submissions". Counting
   * those rows as separate people would report the group as larger than
   * it is and drag every distribution toward whoever submits most
   * often.
   */
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

  /*
   * Rows gathered per person, each group carrying the handle to caption
   * it with.
   *
   * `take` returns what the caller wants off a row, or null to leave
   * that row out. Grouping and captioning are the same problem for
   * every panel that is about a person rather than a measurement, and
   * two copies of it would be two chances for the charts to disagree
   * about who somebody is.
   *
   * The caption is the handle from that person's most recent row that
   * carries one. Where an account holds two handles the newer spelling
   * is the one the keyholder will recognize, and where a row holds none
   * an older row supplies it rather than the group going unlabelled - a
   * blank handle is a missing caption, not a missing person.
   */
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
  /*
   * A line needs a caption to sit at the end of it, so a person whose
   * rows carry no handle at all gets no line - "@undefined" on a chart
   * is worse than an absent one. That is the only thing the handle
   * decides here; which points belong to which line is decided by
   * identityOf.
   */
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

  /*
   * People whose height moved between entries.
   *
   * Height does not change in adults, so a difference here is a typo or
   * a unit mix-up - both things the keyholder wants to know before
   * trusting a distribution. A centimetre of slack absorbs the rounding
   * between the two unit systems; anything more was typed differently.
   *
   * Two members sharing a handle is not on that list and must not be,
   * because this groups by account: two accounts are two people, and
   * reporting them here would send the keyholder to correct a typo
   * nobody made while the real finding went unsaid.
   * handleDisagreements() below is where that one belongs.
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
    const groups = groupByPerson(entries, function (entry) {
      const cm = num(entry.cm);
      if (cm === null) return null;
      return {
        cm: cm,
        // The same height, as the row already stores it. Reading it
        // rather than dividing by 2.54 keeps the conversion where it
        // belongs, in form.js.
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

  /*
   * Accounts whose rows carry more than one handle.
   *
   * DESIGN.md, "The identifier is the whole problem", says this is
   * there to be found: "Two handles under one account id is a rename or
   * a lie, and is detectable." Detectable is not detected. Every chart
   * on this page draws such an account as one person, correctly and
   * silently, so the one reader who can tell a rename from somebody
   * writing a handle that is not theirs is told separately - the same
   * job the height panel does for a height that moved.
   *
   * Only rows carrying an account id can say anything here. A group
   * assembled by the handle fallback has one handle by construction and
   * can never disagree with itself, so including it would be the panel
   * reporting on its own grouping rule rather than on the data.
   *
   * Newest spelling first, because that is the one the keyholder can
   * look up.
   */
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

  /*
   * The smallest number of people a published cell may describe.
   *
   * Five is the usual starting point for this and it is a floor, not a
   * guarantee: for a group of a few dozen in a community this specific,
   * the keyholder may want it higher, and raising it costs only detail.
   *
   * What it is for. Before this existed, a published snapshot of a
   * two-dozen-person group said things like "exactly one member is in
   * Japan" and "exactly one member is nonbinary" - and ROLE_VOCABULARY
   * is feeder/feedee/gainer/admirer, so a singleton there published a
   * named person's kink role to the open web. The reasoning that let
   * that happen is worth naming because it was nearly right: rows are
   * dangerous and aggregates are safe. That holds for large N. At
   * twenty-four it is false, because an aggregate of one is a row.
   *
   * This applies only to the published document. The keyholder's own
   * view is their own data in their own tab and is never reduced.
   */
  const MIN_CELL = 5;
  const OTHER_LABEL = "Other (fewer than " + MIN_CELL + ")";

  /*
   * Categorical counts with every small cell folded into one bucket.
   *
   * The bucket has to clear the floor itself, or it is the singleton
   * wearing a hat - one country with one person in it becomes "Other:
   * 1", which discloses exactly what it was meant to hide. So small
   * cells are pooled, and if the pool is still short the next-smallest
   * *named* cell is absorbed until it clears.
   *
   * Subtraction is the attack this has to survive, not redaction. A
   * reader knows the group size, so publishing US 8, GB 5, CA 3 against
   * a total of 24 discloses CA outright and would also disclose it if
   * CA were simply dropped and the rest left to sum to 21. Everything
   * removed lands in the bucket, so the published cells always sum to
   * the total and nothing is recoverable by arithmetic.
   *
   * A zero survives. "Nobody here is an admirer" describes no one.
   */
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

    // Absorb the smallest named cells until the bucket clears the floor.
    // kept is in descending order, so the smallest non-zero is at the end
    // of the non-zero run.
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

    // Two ways there is nothing safe to say. The bucket never reached the
    // floor, so it is still describing too few people; or every cell went
    // into it, leaving a breakdown that is one bucket and no breakdown at
    // all.
    //
    // One named cell beside the bucket is fine and is deliberately not
    // rejected: "male 19, Other 5" identifies nobody, and suppressing it
    // would throw away a true and harmless answer. The test is whether a
    // cell describes too few people, not how many cells there are.
    const named = kept.filter(function (row) { return row.count > 0; });
    if (other < floor || !named.length) return [];

    return kept.concat([{ label: OTHER_LABEL, count: other }]);
  }

  /*
   * Histogram bins merged rather than bucketed.
   *
   * A histogram is ordered and contiguous, so folding its small bins
   * into an "Other" would destroy the shape that makes it worth
   * drawing. Adjacent bins are combined instead until each one clears
   * the floor, which keeps the total, keeps the order, and simply makes
   * the tails wider - and the tails are exactly where a lone heaviest
   * or lightest person sits.
   *
   * A trailing remainder merges backwards into the last emitted bin
   * rather than being dropped, for the subtraction reason above.
   */
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
      if (!out.length) return [];          // the whole set is below the floor
      const last = out[out.length - 1];
      last.to = open.to;
      last.count += open.count;
    }
    return out;
  }

  function basisOf(entries, floor) {
    // Below the floor there is no breakdown that is safe to publish, and
    // a median over four people is not either. Publishing nothing is the
    // honest answer, and the count above it already says how many there
    // are.
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
      /*
       * What everybody weighs, added together - the one figure on
       * Progress that is about the group rather than about a middle.
       *
       * Weight only, and that is not an oversight: a combined height is
       * arithmetic with no meaning behind it, and a figure nobody can
       * interpret is a figure that gets misread.
       *
       * It is summed from this system's own stored field, like every
       * other number in this file. Converting the other system's total
       * would be a second copy of form.js's arithmetic, free to drift
       * from it.
       *
       * On what it discloses: the count and the mean weight are both
       * already published beside it, and their product IS this number to
       * within rounding. So the total itself is not a new disclosure. Its
       * MOVEMENT between two documents is, which is what the floor in
       * movementOf() below is about.
       */
      out[name].weight.total =
        sum(numbers(entries, UNITS[name].weight.field));
    }

    /*
     * Both unit systems are published in the same document, and
     * suppressing each on its own is not enough - which is the second
     * thing found here, by attacking the floor rather than confirming it.
     *
     * The systems bin different stored fields at different widths, 10 kg
     * against 20 lb, so their boundaries do not line up. Each set can
     * satisfy the floor while their INTERSECTION does not: over random
     * groups, metric bins crossed with imperial bins produced a range of
     * 80.0-81.6 kg holding exactly one person. Nothing was published that
     * broke the rule; the rule was defeated by publishing two partitions
     * of the same people and letting a reader overlay them.
     *
     * So a published document carries ONE partition. The people are
     * grouped once, in the default system, and every other system reports
     * the same groups with its own edges read from its own stored field -
     * no conversion factor here, and nothing for a reader to intersect,
     * because there is only one partition to intersect with itself.
     */
    if (floor > 1) repartition(entries, out, floor);

    return out;
  }

  /*
   * Rewrite every unit system's bins to describe one shared grouping.
   *
   * The grouping is decided in the default system and then expressed in
   * each other one, with each system's edges taken from the values it
   * actually stores. A group's count is the same number in every system
   * because it is the same people.
   */
  /*
   * Edges are CONVERTED, never re-derived from the values inside a
   * group, and that distinction is the whole fix.
   *
   * The first attempt took each system's edges from the smallest and
   * largest value actually in the group, which reads like the honest
   * thing to do and is strictly worse: an edge fitted to the data is
   * tighter than the bin and reports someone's real weight. Overlaying
   * the two systems then isolated a single person again - the same leak,
   * arrived at from the opposite direction.
   *
   * Converting instead means every system draws the same boundaries in
   * different units, so an overlay recovers the partition and nothing
   * finer. These factors exist for axis labels on a published document
   * and for nothing else: no record is written through them, no export
   * reads them, and the stored fields are still what every count and
   * every median is computed from. That is the drift DESIGN.md was
   * guarding against, and it is not this.
   */
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
   * themselves were the join key. See quantize() below, and DESIGN.md,
   * "Renumbering does not prevent linkage - a correction".
   *
   * The pseudonym is keyed on the line, not on the handle captioning
   * it. A series line is one person, because weightSeries groups by
   * account - and two accounts are free to carry the same handle, which
   * is the case DESIGN.md calls "a rename or a lie". Numbering by the
   * caption would give both of those lines the label "Person 1", and
   * the published document would be claiming one person submitted two
   * contradictory histories.
   */
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
   * What this buys is **ambiguity, not absence**. Quantizing is
   * deterministic, so an entry that did not change still quantizes the
   * same way in both documents; the two snapshots go on sharing points.
   * The difference is that a shared point no longer identifies a line,
   * because several people's measurements land on the same date and the
   * same bin. dev/dashboard.test.mjs asserts that directly, and records
   * why the criterion archive/REDESIGN.md originally specified - "share no
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
  function quantize(point) {
    const lb = UNITS.imperial.weight.bin;
    const kg = UNITS.metric.weight.bin;
    return {
      at: Math.floor(point.at / DAY) * DAY,
      imperial: Math.floor(point.imperial / lb) * lb,
      metric: Math.floor(point.metric / kg) * kg,
    };
  }

  /*
   * How many PEOPLE have an entry no older than a moment.
   *
   * People rather than rows, and the distinction is the whole floor. One
   * member submitting five times is one member, and a floor that counted
   * rows would publish that member's gain the fifth time they filled the
   * form in - which is exactly the disclosure the floor exists to
   * prevent, arrived at by the member themselves.
   *
   * identityOf() rather than the handle, for the reason it always is
   * here: the account is the identity and the handle is a label the
   * member's own browser wrote.
   */
  function movedSince(entries, since) {
    const at = Date.parse(since);
    if (!Number.isFinite(at)) return 0;
    const people = new Set();
    for (const entry of entries) {
      if (timeOf(entry) >= at) people.add(identityOf(entry));
    }
    return people.size;
  }

  /* One basis's combined weight in every system, minus the same figures
   * in the document being replaced. Null when either side has nothing to
   * subtract - a basis suppressed below the floor, or a document
   * published before the combined weight existed. Absent is NOT zero:
   * treating a missing total as zero would report the whole group's
   * weight as this month's gain. */
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

  /*
   * How far the combined weight has moved since the document this one
   * replaces, and whether that is a thing this document may say.
   *
   * THE ANCHOR IS A PROPERTY OF THE DOCUMENT. `since` is the previous
   * document's own `generated`, never the reader's clock: two people
   * opening the same bytes an hour apart have to see the same movement,
   * or the figure is about when you looked rather than about the group.
   *
   * THE FLOOR IS ON HOW MANY PEOPLE MOVED IT, and it is the owner's
   * ruling on #73. A combined weight is a group figure and safe; its
   * DELTA can be one person. If one member submitted since the last
   * publish and nobody else did, "+4 lb" is that member's four pounds,
   * handed to everybody who reads the page. So the same discipline
   * MIN_CELL applies to every other published cell applies here, and the
   * keyholder's identified view floors at zero exactly as it does
   * everywhere else.
   *
   * SUPPRESSED MEANS ABSENT. When the floor is not cleared the numbers
   * are left out of the document rather than left in and undrawn - the
   * Worker serves this body verbatim to anybody with a member session,
   * so a figure the page declines to paint is still a figure.
   *
   * WHAT THIS DOES NOT CLOSE, stated rather than discovered. The count
   * and the mean weight are published in every document, and their
   * product is the combined weight. A reader who keeps two documents can
   * therefore compute this delta whatever the floor says. The floor
   * bounds what the page STATES; closing the arithmetic channel would
   * mean suppressing the mean, which is a larger decision than this one
   * and belongs to the owner. Recorded on #73 rather than left for the
   * next reader to find.
   */
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

    // The published document reduces every cell to at least MIN_CELL
    // people. The keyholder's own view does not: it is their data, it
    // never leaves the tab, and reducing it would only hide the thing
    // they opened the page to see.
    const floor = identify ? 0 : MIN_CELL;

    let series = opts.series === false ? null :
      weightSeries(entries).map(function (line) {
        return {
          label: label(line),
          points: identify ? line.points : line.points.map(quantize),
        };
      });

    /*
     * A series line is one person by construction, so the floor cannot
     * be applied to it the way it is applied to a cell - every line is
     * a cell of one. Quantisation makes a shared point ambiguous, which
     * is what it was built for, but it does nothing about how many
     * lines there are: four lines on a public chart is four identifiable
     * trajectories in a group where everybody knows everybody.
     *
     * So the panel publishes only when there are enough lines to hide
     * in, and otherwise not at all. It is already opt-in and off by
     * default; this is the second condition, not the first.
     *
     * WHICH KIND OF NULL THIS IS, recorded because nobody downstream can
     * work it out. `series: null` means either "nobody asked for one" or
     * "one was asked for and the floor took it out" - opposite claims,
     * and the reading side has no rows to tell them apart, so it showed
     * one silence for both (#177). A boolean and nothing more: how many
     * lines there would have been is what the floor holds back.
     */
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
      // Additive and absent-tolerant, for the reason `movement` is: a
      // document published before this field is already live, and a
      // missing flag reads as "nothing was withheld", which is what
      // every one of them means. SNAPSHOT_VERSION does not move.
      seriesWithheld: seriesWithheld,
      // A data-quality panel is for whoever can act on it. Published,
      // it would be a list of strangers' heights and the handles they
      // answer to, and no use to anyone.
      quality: identify
        ? {
            heightChanges: heightDisagreements(entries),
            handleChanges: handleDisagreements(entries),
          }
        : null,
      bases: bases,
      /*
       * Additive, which is why SNAPSHOT_VERSION does not move. A document
       * published before this field existed is already live and public.js
       * is already reading it; nothing about it became wrong, so bumping
       * the version would only strand a document that still renders
       * correctly for the whole interval between deploying this and the
       * keyholder's next publish. Null when there is nothing comparable
       * to measure from, which every reader here treats as "say nothing"
       * rather than "say zero".
       */
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

  // `render` is declared below the guard, and a function declaration is
  // hoisted, so it is already defined here - which is what lets this
  // module publish ONE object and freeze it once, instead of publishing
  // a literal and bolting `render` on afterwards. A member added after
  // the object is published cannot be covered by a freeze at the
  // assignment: freezing would make that later line throw, so the object
  // admin.html and dashboard.html both hold would have to stay editable
  // for as long as this file is still running.
  //
  // The conditional is load-bearing and is NOT a redundant second guard.
  // dev/dashboard-render.test.mjs pins this seam in both directions -
  // "loaded with no document the module exports no render" and "loaded
  // with a document the module exports render" - because it is the
  // reason the drawing suite exists apart from dev/dashboard.test.mjs.
  // Delete the conditional and `render` is exported under Node too,
  // where calling it throws on its first `document`; that is a tested
  // regression, not a tidy-up.
  //
  // BOTH drawing names go on here, inside the one conditional and before
  // the one freeze. `renderProgress` is the surface split, and the same
  // seam has to be pinned for it: a second name attached after the
  // publish is the exact shape check 15's member-assignment arm refuses,
  // and a second name attached outside this conditional would be
  // exported under Node where its first `document` throws.
  if (typeof document !== "undefined") {
    api.render = render;
    api.renderProgress = renderProgress;
  }
  root.BinderDashboard = Object.freeze(api);

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

  /*
   * What the page says where the floor removed something. A blank is a
   * claim - "nobody answered", "nothing here" - and the true one is that
   * enough people answered that the page will not say which.
   *
   * NONE CARRIES A NUMBER: the count, the cell size and how close it
   * came to the floor are what suppression holds back, so naming one
   * publishes in prose what the floor withheld in figures. Shared
   * constants, because four wordings are four chances to say too much.
   *
   * ONE_BAND is not a suppression - one band holds everybody by
   * construction, so it describes the picture rather than a reason.
   */
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
      // a presentation attribute would lose to the series color rule.
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
   * A categorical breakdown, or the sentence that stands in for it. No
   * rows means two opposite things: floored, suppressCounts found
   * nothing publishable without describing individuals; unfloored, the
   * group has no rows at all. Only the first is a withholding.
   *
   * The caption goes with the chart, for the reason the band caption
   * does below: "Multi-select, so these do not add up" over a panel with
   * nothing in it describes a drawing that is not there.
   *
   * A null `total` is how a panel says it has no denominator (#182).
   */
  function breakdown(title, note, rows, total, floored) {
    const drawn = rows.length > 0 || !floored;
    const wrap = figure(title, drawn ? note : null);
    if (drawn) wrap.appendChild(barChart(rows, total));
    else emptyNote(wrap, WITHHELD);
    return wrap;
  }

  /*
   * A histogram, or the sentence that stands in for it. No bins on a
   * floored document is suppressBins refusing a tail that would describe
   * one person - not the same claim as nothing having been recorded. One
   * bin is every band merged into a single bar filling the chart: no
   * information, and indistinguishable from a fault. THE BAND CAPTION
   * GOES WITH THE BAR in both: "in 20 lb bands" over a picture with no
   * bands describes what was not drawn, and it is a digit the sentence
   * beside it is careful not to carry.
   *
   * The instrument draws whatever it has, one band included: it has no
   * floor, so nothing there merged.
   */
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

  /* The minus sign, written as its own code point rather than as a
   * hyphen. It is the character that lines up with the digits and with
   * the plus beside it; a hyphen in a column of tabular figures is a
   * different width and reads as a dash. */
  const MINUS = "−";

  /*
   * How far the group's combined weight has moved, in words, or null if
   * this document has nothing to say about that.
   *
   * Three states, and the middle one is the one worth keeping. A
   * document with no comparable predecessor says nothing at all. A
   * document whose movement was driven by too few people SAYS SO - a
   * blank there would read as "nothing changed", which is a different
   * claim and a false one. And a movement over the floor is a signed
   * number, with the date it is measured from, because a delta with no
   * anchor is a number nobody can check.
   *
   * The direction is reported and never characterized. Which way is good
   * news is not this page's opinion to hold about anybody.
   */
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

  /*
   * The one figure on this page that is about the group rather than
   * about a middle, and the reason #73 calls the dashboard the payoff.
   *
   * Null rather than an em dash when there is no combined weight to
   * show: a hero reading "—" is a headline about nothing, and the panels
   * below already say what is missing in their own words.
   */
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

    /* Not `tabular`, which every other number on these pages takes. That
     * class is the mono face, for figures that have to line up in a
     * column; this one stands alone and is set in the display face the
     * wordmark uses, which is what makes it read as the page's headline
     * rather than as the loudest of ten equal figures. */
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

  /*
   * Draws a snapshot for the ADMIN INSTRUMENT. Not rows - a snapshot,
   * which is what makes the keyholder's dashboard and the public one the
   * same code rather than two things that look alike.
   *
   * This is one of two entry points into one drawing body. The other is
   * renderProgress() below, and the only difference between them is what
   * comes before the stat strip. Both call drawPanels(), so there is no
   * second copy of the panel sequence for the two surfaces to drift
   * apart on - which matters because only one of them is driven daily,
   * and the copy nobody drives is the copy that rots.
   *
   * Which surface is drawing is an argument at the call site
   * (apps/web/admin.js and apps/web/public.js each name the one they
   * want) rather than something inferred from a global. A module that
   * sniffs which page it is on is a module that behaves differently in
   * a test than in a browser.
   */
  function render(container, snapshot, basis, units) {
    container.textContent = "";
    drawPanels(container, snapshot, basis, units);
  }

  /*
   * Draws the same snapshot for PROGRESS, the member-facing page, which
   * leads with the combined-weight hero.
   *
   * The hero is deliberately not on the instrument. admin.html is a
   * panel for reading data, and a headline is a thing said to somebody -
   * the owner's decision on #73 is that the instrument stays plainly an
   * instrument.
   *
   * No hero when the basis is suppressed: below the floor the page's
   * whole answer is a sentence explaining that too few people are here
   * to describe, and a group figure printed above that sentence would be
   * the page arguing with itself.
   */
  function renderProgress(container, snapshot, basis, units) {
    container.textContent = "";
    const view = snapshot.bases[basisName(basis)];
    if (view !== null) {
      const hero = heroFor(snapshot, view, basis, unitsFor(units));
      if (hero !== null) container.appendChild(hero);
    }
    drawPanels(container, snapshot, basis, units);
  }

  /*
   * Everything both surfaces draw, in one order.
   *
   * `basis` picks what the distributions count: one row per person, or
   * every row. The weight-over-time chart ignores it and always uses
   * everything, because the repeats are the entire point of it.
   * `units` picks which of the two precomputed systems is shown, and
   * nothing here converts anything.
   *
   * It does not clear the container. Its callers do, before they add
   * whatever their surface puts first - which is what lets one of them
   * lead with a hero without this function knowing there is one.
   */
  function drawPanels(container, snapshot, basis, units) {
    const spec = unitsFor(units);
    const which = basisName(basis);
    const view = snapshot.bases[which];

    /*
     * Whether this document was reduced - read off the document, not the
     * caller. `identified` is the floor's own switch (snapshotOf takes
     * `floor = identify ? 0 : MIN_CELL` from the same argument), so it is
     * the one property saying whether an empty cell means suppressed or
     * empty. Deciding by entry point would give the two surfaces
     * different panel sequences for one document, and this split exists
     * on the rule that only what comes FIRST may differ.
     *
     * `=== false` so a document with no flag says nothing: claiming a
     * suppression that never happened is worse than saying nothing at
     * all.
     */
    const floored = snapshot.identified === false;

    /*
     * A basis is null when the group was too small to publish a
     * breakdown about. Say so, rather than drawing an empty page or
     * throwing - this is the ordinary state of a new group, not an
     * error, and a blank dashboard reads as broken.
     */
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
    } else if (snapshot.seriesWithheld === true) {
      /*
       * The keyholder asked for this chart and the floor took it out, so
       * the panel stays and holds the reason: from outside, "withheld"
       * and "never collected" are the same blank and mean opposite
       * things (#177). No `floored` test beside it - snapshotOf sets
       * this flag only on a document it reduced, so the instrument's own
       * snapshot can never carry it.
       */
      const withheldWrap = figure("Weight over time");
      withheldWrap.classList.add("chart-wide");
      emptyNote(withheldWrap, SERIES_WITHHELD);
      container.appendChild(withheldWrap);
    }

    /*
     * Two handles under one account. The charts above draw this as one
     * person, which is right - the account is the identity - so this is
     * the only place it is visible at all, and DESIGN.md says it is
     * either a rename or a lie and that the keyholder is the one who
     * can tell.
     */
    const handlesMoved =
      (snapshot.quality && snapshot.quality.handleChanges) || [];
    if (handlesMoved.length) {
      const wrap = figure("Accounts using more than one handle",
        "These rows are counted as one person, because the account is " +
        "the identity and the handle is only a label the member's own " +
        "browser wrote. Two handles under one account is a rename or a " +
        "lie; most recent spelling first.");
      wrap.classList.add("chart-wide");   // a list, not a chart
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

    /*
     * No share on this one - #182. Affiliations are multi-select, so
     * twelve people can produce twenty selections and no whole exists
     * for a percentage to be part of: the published page printed
     * `Other (fewer than 5) — 9 (180%)`. The counts are right; the share
     * had nothing to be a share of, so it is gone rather than relabelled.
     */
    container.appendChild(breakdown("Feedism affiliations",
      "Multi-select, so these do not add up to the number of entries — " +
      "which is why no share is shown beside them.",
      view.roles, null, floored));

    container.appendChild(breakdown("Country",
      view.country.length > 12 ? "Top 12 by count." : null,
      view.country.slice(0, 12), view.count, floored));
  }
})(globalThis);
