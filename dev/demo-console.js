/*
 * The demo console's wiring: choose a scenario, stage the world it needs,
 * and put a shipped page in the frame.
 *
 * All wiring, no pure half. What each scenario means, what the stub
 * answers and which acceptance box a probe reads live in
 * dev/demo-stub.js, where dev/demo.test.mjs drives them under Node.
 *
 * Staging is three writes and nothing more: the scenario id, the session
 * the tab should hold, and the corpus the stubbed snapshot route serves.
 * The frame then loads a real page at a real path, and every enhancement
 * it shows is the shipped code running.
 */
(function (root) {
  "use strict";

  const Demo = root.BinderDemo;
  const $ = function (id) { return document.getElementById(id); };

  // The demo's own three come from demo-stub.js, which is their one home
  // and the list dev/demo.test.mjs scans apps/web for. The other two are
  // the PRODUCT's keys: apps/web names them because they are its own, so
  // they are deliberately not in that list and are written out here.
  const [SCENARIO_KEY, DATA_KEY, WORLD_KEY] = Demo.STORAGE_KEYS;
  const SESSION_KEY = "hgb-session";
  const PREFILL_KEY = "hgb-submit-prefill";

  const MIRROR = "/demo/";

  let scenario = null;
  let destination = null;

  function say(message) {
    $("status").textContent = message || "";
  }

  /* ---------------------------------------------------------------- */
  /* Staging.                                                         */
  /* ---------------------------------------------------------------- */

  /*
   * The session is written straight into sessionStorage rather than
   * minted through a sign-in, because most scenarios start from a member
   * who is already in. It is the shape apps/web/session.js accepts and
   * nothing looser - a demo session that the shipped normalizer would
   * reject is a demo of the rejection.
   *
   * sessionStorage is per tab and per origin, and the frame shares both
   * with this page, so one write reaches the page in the frame.
   */
  function stage(chosen) {
    scenario = chosen;

    root.sessionStorage.setItem(SCENARIO_KEY, chosen.id);
    root.sessionStorage.removeItem(WORLD_KEY);

    if (chosen.session) {
      root.sessionStorage.setItem(SESSION_KEY, JSON.stringify(chosen.session));
    } else {
      root.sessionStorage.removeItem(SESSION_KEY);
    }

    /*
     * The prefill is device-local and lives in localStorage, scoped to an
     * account id - that scoping is #56 and it is the thing the
     * member-prefilled scenario exists to show. Every other scenario
     * clears it, so "already filled in" is never left over from the last
     * walk-through.
     */
    if (chosen.prefill) {
      root.localStorage.setItem(PREFILL_KEY, JSON.stringify({
        accountId: Demo.MEMBER_ACCOUNT,
        units: "imperial",
        weightLb: "203",
        heightFeet: "5",
        heightInches: "6",
        weightKg: "",
        heightCm: "",
      }));
    } else {
      root.localStorage.removeItem(PREFILL_KEY);
    }

    paintScenario();
    open(chosen.start);
  }

  function open(file) {
    destination = file;
    const path = MIRROR + file;
    $("stage").src = path;
    $("frame-path").textContent = root.location.origin + path;
    paintDestinations();
  }

  /* ---------------------------------------------------------------- */
  /* Painting.                                                        */
  /* ---------------------------------------------------------------- */

  function labelFor(file) {
    for (const one of Demo.DESTINATIONS) {
      if (one.file === file) return one.label;
    }
    return file;
  }

  function paintScenarios() {
    const list = $("scenarios");
    list.textContent = "";
    Demo.SCENARIOS.forEach(function (one) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-pressed", "false");
      button.dataset.scenario = one.id;

      const title = document.createElement("span");
      title.textContent = one.label;
      const id = document.createElement("span");
      id.className = "id";
      id.textContent = one.id + " · starts on " + labelFor(one.start);

      button.appendChild(title);
      button.appendChild(id);
      button.addEventListener("click", function () { stage(one); });
      item.appendChild(button);
      list.appendChild(item);
    });
  }

  function paintScenario() {
    $("scenario-label").textContent = scenario
      ? scenario.label + " (" + scenario.id + ")"
      : "No scenario chosen yet.";

    const steps = $("steps");
    steps.textContent = "";
    (scenario ? scenario.steps : []).forEach(function (text) {
      const item = document.createElement("li");
      item.textContent = text;
      steps.appendChild(item);
    });

    Array.prototype.forEach.call(
      document.querySelectorAll("#scenarios button"),
      function (button) {
        button.setAttribute("aria-pressed",
          scenario && button.dataset.scenario === scenario.id
            ? "true" : "false");
      });
  }

  function paintDestinations() {
    const holder = $("destinations");
    holder.textContent = "";
    Demo.DESTINATIONS.forEach(function (one) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = one.label;
      button.title = one.file;
      button.setAttribute("aria-pressed",
        one.file === destination ? "true" : "false");
      button.addEventListener("click", function () { open(one.file); });
      holder.appendChild(button);
    });
  }

  function paintEdits() {
    const body = $("edits");
    body.textContent = "";
    Demo.MIRROR_EDITS.forEach(function (edit) {
      const row = document.createElement("tr");
      const what = document.createElement("td");
      what.textContent = edit.what;
      const why = document.createElement("td");
      why.className = "why";
      why.textContent = edit.why;
      row.appendChild(what);
      row.appendChild(why);
      body.appendChild(row);
    });
  }

  /*
   * Whether each acceptance box is drivable, asked of the shipped bytes.
   *
   * Fetched rather than remembered: the answer has to change on the day
   * PR 4 or PR 5 lands, without anybody editing this file. A probe that
   * cannot read its file is reported as unreadable rather than as a
   * missing feature, because those are different facts and only one of
   * them is about the product.
   *
   * The verdict itself is demo-stub.js's, so this table and
   * dev/demo.test.mjs reason about one function. It used to be a raw
   * substring test written here, which meant a TODO comment mentioning
   * "instrument" painted admin-panel as drivable with nothing built -
   * a false PASS, on the table the owner reads while deciding the
   * cutover, produced by somebody writing about the work.
   */
  async function paintBoxes() {
    const body = $("boxes");
    body.textContent = "";

    for (const box of Demo.BOXES) {
      const row = document.createElement("tr");

      const verdict = document.createElement("td");
      verdict.className = "verdict";
      verdict.textContent = "reading…";

      const title = document.createElement("td");
      title.textContent = box.title;

      const where = document.createElement("td");
      where.className = "why";
      where.textContent = box.probe.file;

      row.appendChild(verdict);
      row.appendChild(title);
      row.appendChild(where);
      body.appendChild(row);

      let source = null;
      try {
        const response = await fetch("/" + box.probe.file);
        source = response.ok ? await response.text() : null;
      } catch (error) {
        source = null;
      }

      if (source === null) {
        verdict.textContent = "unreadable";
        where.textContent = box.probe.file + " could not be read.";
      } else if (Demo.probeHit(source, box.probe)) {
        verdict.textContent = "drivable";
        verdict.classList.add("yes");
      } else {
        verdict.textContent = "not yet";
        verdict.classList.add("no");
        where.textContent = box.probe.file + " does not carry " +
          box.probe.pattern + " yet.";
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* The corpus.                                                      */
  /* ---------------------------------------------------------------- */

  /*
   * Both published snapshots, built by the shipped aggregation in a
   * worker, and parked where the stub can read them.
   *
   * The rich corpus is what makes Progress worth looking at: enough
   * repeat submitters to clear the floor the published series is held to,
   * so the hero, the deltas and the weight-over-time marquee all draw.
   * The sparse one is under that floor on purpose, and it is a separate
   * corpus because one dataset cannot be on both sides of a threshold.
   */
  function buildCorpus() {
    return new Promise(function (resolve) {
      let worker;
      try {
        worker = new Worker("demo-corpus.js");
      } catch (error) {
        resolve({ ok: false, why: (error && error.message) || String(error) });
        return;
      }
      worker.addEventListener("message", function (event) {
        worker.terminate();
        resolve(event.data);
      });
      worker.addEventListener("error", function (event) {
        worker.terminate();
        resolve({ ok: false, why: event.message || "the worker failed" });
      });
      worker.postMessage("build");
    });
  }

  async function setUp() {
    paintScenarios();
    paintScenario();
    paintDestinations();
    paintEdits();

    say("Building the demo corpus from the shipped code…");
    const built = await buildCorpus();
    if (!built.ok) {
      say("The corpus could not be built (" + built.why + "), so Progress " +
        "will report no figures. Everything else still runs.");
    } else {
      root.sessionStorage.setItem(DATA_KEY, JSON.stringify({
        rich: built.rich,
        sparse: built.sparse,
      }));
      say(built.counts.rich + " entries staged for the full dashboard, " +
        built.counts.sparse + " for the suppressed one. Pick a scenario.");
    }

    paintBoxes();

    $("open-tab").addEventListener("click", function () {
      if (destination) root.open(MIRROR + destination, "_blank");
    });

    $("reset").addEventListener("click", function () {
      root.sessionStorage.removeItem(WORLD_KEY);
      if (scenario) stage(scenario);
      say("Demo state reset. The published snapshot and any revocation " +
        "are back to how the scenario starts.");
    });
  }

  setUp();
})(globalThis);
