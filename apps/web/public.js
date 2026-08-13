/*
 * The members' dashboard. It needs a tab session, but no key or plaintext.
 *
 * The session authorizes one published aggregate read. The result goes to
 * dashboard.js, the same function that drew the charts on admin.html. There
 * is no second implementation of the charts, and no way for the member
 * numbers to disagree with the keyholder's, because one produced the other.
 *
 * It also has no decryption, deliberately. crypto.js is not loaded
 * here, so no amount of confusion about what this page is for can turn
 * it into something that opens submissions.
 *
 * All wiring, no pure half. Everything worth testing about a snapshot
 * lives in dashboard.js and query.js and is tested there; what is left
 * here is fetching one file, reporting when that fails, and turning the
 * question card's controls into queries the engine already validates.
 */
(function (root) {
  "use strict";

  if (typeof document === "undefined") return;

  const UI = root.BinderUI;
  const Session = root.BinderSession;
  const $ = UI.byId;
  const show = UI.show;

  /* Same guard as the other pages: a throw during setup leaves a page
   * that looks fine and does nothing, which is worse than a page that
   * says it is broken. */
  UI.boot(setUp, function (error) {
    show($("tool"), false);
    const closed = $("closed");
    show(closed, true);
    if (closed) {
      closed.querySelector("[data-reason]").textContent =
        "This page did not start up correctly, so there is nothing to " +
        "show. " + (error && error.message ? "(" + error.message + ")" : "");
    }
  });

  function unavailable(reason) {
    show($("tool"), false);
    show($("closed"), true);
    $("closed").querySelector("[data-reason]").textContent = reason;
  }

  /*
   * THE ENGINE'S OWN WORDS, KEPT AND MOVED - #265 rows 13 to 16.
   *
   * query.js writes its refusals for whoever is holding the document:
   * "snapshot version 3 is not the version this engine reads (2)",
   * "that is a keyholder snapshot ... it carries handles and
   * unsuppressed cells", "unknown split \"x\" - it is one of gender,
   * country, roles, bmi, weight, height". Every one of those is exactly
   * right for its reader, and this page showed all of them, word for
   * word, to somebody who came to read a chart. "document", "engine",
   * "split", "cell" and a raw split id are the engine's nouns; the
   * controls above this card say Count, Units, About and Combine.
   *
   * So the words are not lost, they are addressed. `detail` writes the
   * precise half where a developer looks, and `plainly` reads the half
   * query.js writes for a member off the refusal itself, so the two are
   * one claim in two registers rather than two sentences that can drift
   * apart. A refusal arriving with no plain half - a throw added there
   * tomorrow, or a path nobody expected a member to reach - gets the
   * caller's own sentence rather than the engine's, which is the whole
   * point: printing whatever this page is handed is what put an id on a
   * member's screen in the first place.
   */
  function detail(technical) {
    if (technical && root.console &&
        typeof root.console.warn === "function") {
      root.console.warn("binder: " + technical);
    }
  }

  function plainly(error, fallback) {
    detail(error && error.message ? error.message : "refused with no message");
    return error && typeof error.plain === "string" && error.plain
      ? error.plain
      : fallback;
  }

  /*
   * How old the figures are, in the words someone would use.
   *
   * The exact timestamp is there too, because "3 days ago" is friendly
   * and useless for deciding whether a scheduled refresh has stopped.
   */
  function ageText(generated, now) {
    const at = Date.parse(generated);
    if (!Number.isFinite(at)) return "Published at an unknown time.";

    const minutes = Math.floor((now - at) / 60000);
    let phrase;
    if (minutes < 2) phrase = "just now";
    else if (minutes < 60) phrase = minutes + " minutes ago";
    else if (minutes < 120) phrase = "an hour ago";
    else if (minutes < 48 * 60) phrase = Math.floor(minutes / 60) + " hours ago";
    else phrase = Math.floor(minutes / (60 * 24)) + " days ago";

    return "Figures worked out " + phrase + " (" +
      new Date(at).toISOString().replace("T", " ").slice(0, 16) + " UTC).";
  }

  /* Stale enough to say so out loud. Two days is a judgement, not a
   * fact: it is long enough that a daily refresh has plainly missed
   * one, and short enough that nobody reads month-old numbers as
   * current. */
  const STALE_AFTER_HOURS = 48;

  async function setUp() {
    if (!Session.require()) return;

    const config = root.BINDER_CONFIG || {};
    if (!config.endpoint) {
      unavailable("This site is not set up to reach the service these " +
        "figures come from, so there is nothing to show.");
      return;
    }

    let payload;
    try {
      const response = await fetch(config.endpoint + "/snapshot", {
        headers: Session.authorization(),
      });
      if (response.status === 401) {
        Session.clear();
        unavailable("Your sign-in is no longer valid. Sign in again to " +
          "see these charts.");
        return;
      }
      if (response.status === 404) {
        unavailable("No figures have been published yet. This fills in the " +
          "first time the keyholder publishes a snapshot.");
        return;
      }
      if (!response.ok) {
        // The number is what an operator acts on and admin.html still
        // quotes it; here it is a number in front of somebody who came
        // to read a chart - #265 row 13.
        detail("the snapshot route answered " + response.status);
        throw new Error("The service could not answer just now.");
      }
      payload = await response.json();
    } catch (error) {
      // The thrown message goes to the console, not into the sentence.
      // It is a fetch failure's own wording - "Failed to fetch", or
      // whatever a proxy put there - and pasting it between two clauses
      // gave a member three, of which the middle one was written for
      // nobody on this page (#275, rule 1).
      detail(error && error.message ? error.message : "the snapshot could " +
        "not be fetched");
      unavailable("The figures could not be fetched — try again shortly.");
      return;
    }

    const snapshot = payload && payload.snapshot;
    if (!snapshot || !snapshot.bases) {
      unavailable("These figures are not in a shape this page can draw. " +
        "They may have been published by a newer version of the site — " +
        "tell an admin.");
      return;
    }

    const now = Date.now();
    $("status").textContent = snapshot.counts.entries + " entries from " +
      snapshot.counts.people + " people.";
    $("freshness").textContent = ageText(snapshot.generated, now);

    const age = (now - Date.parse(snapshot.generated)) / 3600000;
    if (Number.isFinite(age) && age > STALE_AFTER_HOURS) {
      $("status").className = "status bad";
      $("freshness").textContent +=
        " That is older than these are meant to be, so treat them as out " +
        "of date.";
    }

    /* renderProgress, not render: this is the member-facing surface, and
     * it is the one that leads with the combined-weight hero. admin.js
     * names the instrument's entry point in the same way, so which
     * surface is being drawn is written at the call site rather than
     * sniffed from the page. */
    function draw() {
      root.BinderDashboard.renderProgress(
        $("charts"), snapshot,
        UI.checkedValue("basis", "people"),
        UI.checkedValue("units", root.BinderDashboard.DEFAULT_UNITS));
    }

    Array.prototype.forEach.call(
      document.querySelectorAll('input[name="basis"], input[name="units"]'),
      function (input) { input.addEventListener("change", draw); });

    show($("tool"), true);
    draw();
    askable(snapshot);
  }

  /*
   * The question card - #85's member-shaped dashboard, wired to
   * apps/web/query.js.
   *
   * WHICH SOURCE THIS PAGE BUILDS, AND WHY IT IS THE ONLY ONE IT CAN.
   * query.js has two. `publishedSource` reads the members-only published
   * document, every cell of which the keyholder's browser already reduced
   * to at least MIN_CELL people. `personalSource` reads ONE member's own
   * rows and applies no floor at all, because their own data is theirs.
   * This page holds a published document and nothing else, so it builds
   * exactly one source - and there is no source control, no floor
   * control, and no second call anywhere below.
   *
   * That is not a rule this file enforces. It is what the engine's shape
   * makes true: `run` takes the floor off the SOURCE, and a query has no
   * member that names a floor. A caller cannot ask for floor 0 over a
   * published document because there is no sentence in the language that
   * means it, which is why this file re-implements none of the
   * suppression it depends on.
   *
   * THE PERSONAL ARM IS ON your-page.html, AND ITS ABSENCE HERE IS NOT
   * WAITING ON ANYTHING. It ships: the device key is apps/web/
   * memberkey.js and the rows come from GET /my-entries. It is there
   * rather than here because that is the page holding a key, and this
   * page holds none - the only document in this tab is the published
   * one, and opening anything else would mean loading crypto onto a
   * page DESIGN.md's per-page table records as holding no plaintext.
   */
  function askable(snapshot) {
    const Query = root.BinderQuery;
    const card = $("question");

    /* No engine, no card, and the page carries on. The panels are what
     * this page is for and they do not need query.js; a member reading
     * correct aggregates beats a page that refuses to start because an
     * additive script did not arrive. */
    if (!Query || !card) return;
    show(card, true);

    const status = $("q-status");
    let source;
    try {
      source = Query.publishedSource(snapshot);
    } catch (error) {
      /* The engine refuses a document it does not read - a version it
       * does not know, or a keyholder snapshot arriving where a published
       * one belongs. Which of the two it was still reaches the card,
       * because the refusal carries its own plain half; what does not
       * reach it is the engine's vocabulary. The controls go away rather
       * than sitting there inert.
       *
       * THE MEMBER SENTENCE RENDERS ALONE - the register bar's rule 5
       * (#275). A house sentence in front of it would say the refusal
       * happened here, which the card the reader is standing in already
       * says, and would leave a member two clauses of which only the
       * second one told them anything. The fallback is that sentence
       * rather than a prefix, so the line is one clause on every path. */
      show($("q-controls"), false);
      status.className = "status bad";
      status.textContent =
        plainly(error, "These figures cannot be asked questions here.");
      return;
    }

    /*
     * The cells now on offer, paired with the boxes that tick them.
     *
     * Kept here rather than read back out of the DOM so that redrawing an
     * answer does not have to walk it, and rebuilt only when the
     * document's own labels change - a member ticking a box must not have
     * that box replaced underneath them, and every keystroke redraws.
     */
    let boxes = [];
    let builtFor = null;

    function choiceBox(label) {
      const wrap = document.createElement("label");
      wrap.className = "choice";
      const box = document.createElement("input");
      box.type = "checkbox";
      const words = document.createElement("span");
      words.textContent = label;
      wrap.appendChild(box);
      wrap.appendChild(words);
      boxes.push({ label: label, box: box });
      return wrap;
    }

    /*
     * The combine list, rebuilt from the answer the document actually
     * gave rather than from anything remembered.
     *
     * This is the union-only rule made visible. The only labels a member
     * can name are labels the floor already let through, so every group
     * they can build is a union of cells that each cleared it - and the
     * engine refuses a merge naming a cell this document does not have,
     * which is a refusal this list makes unreachable rather than one it
     * works around.
     */
    function offerMerge(cells) {
      const labels = cells.map(function (cell) { return cell.label; });
      const key = labels.join("\0");
      if (key === builtFor) return;
      builtFor = key;
      boxes = [];
      const list = $("q-merge-labels");
      list.textContent = "";
      labels.forEach(function (label) {
        list.appendChild(choiceBox(label));
      });
    }

    function ticked() {
      return boxes.filter(function (item) { return item.box.checked; })
        .map(function (item) { return item.label; });
    }

    function ask() {
      const split = $("q-split").value;
      const shape = Query.SPLITS[split];
      /* A split the engine does not know is a page and an engine that
       * have drifted apart, and dev/public.test.mjs pins the two lists
       * against each other in both directions so this is unreachable.
       * It is still said out loud rather than thrown from inside
       * normalize, because the person who reaches it is the one who
       * added an option and not the one who will read a stack trace. */
      if (!shape) {
        detail("this page offers a split the engine does not answer: " +
          split);
        status.className = "status bad";
        status.textContent =
          "That question is not one these figures can answer.";
        return;
      }

      const bins = shape.kind === "bins";
      /* Only a histogram has numbers to take a middle of, and only a
       * categorical split is coarsened by naming cells. Offering the
       * other combinations would be offering a question the engine
       * refuses by design - so they are not offered. */
      const measure = bins
        ? UI.checkedValue("q-measure", "count")
        : "count";
      show($("q-measure-field"), bins);
      show($("q-widen-field"), bins && measure === "count");
      show($("q-merge-field"), !bins && measure === "count");

      const query = {
        basis: UI.checkedValue("basis", "people"),
        split: split,
        measure: measure,
        units: UI.checkedValue("units", root.BinderDashboard.DEFAULT_UNITS),
      };
      if (bins) query.widen = Number(UI.checkedValue("q-widen", "1"));

      let answer;
      try {
        answer = Query.run(source, query);
        if (!bins && measure === "count") {
          /*
           * Asked twice on purpose: once plain, to learn which cells the
           * document published, and again naming only those. The first
           * answer is what fills the combine list, so a member changing
           * basis cannot carry a tick over to a split that has no such
           * cell - and the merged answer is a coarsening of the same
           * floored partition the plain one is, which is the property
           * that makes two answers safe to lay over each other.
           */
          offerMerge(answer.cells);
          const labels = ticked();
          if (labels.length > 1) {
            const named = $("q-merge-name").value.trim();
            answer = Query.run(source, Object.assign({}, query, {
              merge: [{ as: named || labels.join(" + "), labels: labels }],
            }));
          }
        }
        status.className = "status";
        status.textContent = "";
      } catch (error) {
        /* The engine's refusals are written to be read - they name the
         * question that is not a question, and the alternatives. What
         * reaches the card is that same claim in the card's own labels;
         * the engine's wording is on the console for whoever needs the
         * split's name. */
        status.className = "status bad";
        status.textContent =
          plainly(error, "That question could not be answered.");
        $("answer").textContent = "";
        return;
      }

      root.BinderDashboard.renderAnswer($("answer"), answer,
        Query.describe(query));
    }

    /*
     * One listener for the whole card. `input` bubbles and fires for
     * radios, selects, checkboxes and typing alike, so this covers the
     * merge boxes too - and those are rebuilt from every answer, which
     * per-control wiring would have to redo on each draw.
     */
    $("q-controls").addEventListener("input", ask);

    /* The Count and Units choices belong to the page, not to the card:
     * a question here is about the same people the panels are, which is
     * what the card's own copy promises. setUp already has those two
     * redrawing the panels, so this adds the answer to the same event
     * rather than giving the card a second pair of controls that could
     * disagree with the ones above it. */
    Array.prototype.forEach.call(
      document.querySelectorAll('input[name="basis"], input[name="units"]'),
      function (input) { input.addEventListener("change", ask); });

    ask();
  }
})(globalThis);
