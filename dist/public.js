

(function (root) {
  "use strict";

  if (typeof document === "undefined") return;

  const UI = root.BinderUI;
  const Session = root.BinderSession;
  const $ = UI.byId;
  const show = UI.show;

  

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
         
         
         
        detail("the snapshot route answered " + response.status);
        throw new Error("The service could not answer just now.");
      }
      payload = await response.json();
    } catch (error) {
      unavailable("The figures could not be fetched. " +
        (error && error.message ? error.message : "The connection failed.") +
        " Try again shortly.");
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

  

  function askable(snapshot) {
    const Query = root.BinderQuery;
    const card = $("question");

    

    if (!Query || !card) return;
    show(card, true);

    const status = $("q-status");
    let source;
    try {
      source = Query.publishedSource(snapshot);
    } catch (error) {
      

      show($("q-controls"), false);
      status.className = "status bad";
      status.textContent = "These figures cannot be asked questions here. " +
        plainly(error, "They are not in a shape this page can ask about.");
      return;
    }

    

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
      

      if (!shape) {
        detail("this page offers a split the engine does not answer: " +
          split);
        status.className = "status bad";
        status.textContent =
          "That question is not one these figures can answer.";
        return;
      }

      const bins = shape.kind === "bins";
      

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
        

        status.className = "status bad";
        status.textContent =
          plainly(error, "That question could not be answered.");
        $("answer").textContent = "";
        return;
      }

      root.BinderDashboard.renderAnswer($("answer"), answer,
        Query.describe(query));
    }

    

    $("q-controls").addEventListener("input", ask);

    

    Array.prototype.forEach.call(
      document.querySelectorAll('input[name="basis"], input[name="units"]'),
      function (input) { input.addEventListener("change", ask); });

    ask();
  }
})(globalThis);
