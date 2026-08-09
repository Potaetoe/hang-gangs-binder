/*
 * The demo console's wiring: press a card's action, stage the world it
 * needs, and put a shipped page in the frame.
 *
 * All wiring, no pure half. The cards, what each staging means, and
 * what the stubbed Worker answers live in dev/demo-stub.js, where
 * dev/demo.test.mjs drives them under Node - including the register
 * the cards are written in and the promise that every staging is
 * reachable from some card.
 *
 * Staging is three writes and nothing more: the staging id, the
 * session the tab should hold, and the data the stubbed snapshot
 * route serves. The frame then loads a real page at a real path, and
 * every enhancement it shows is the shipped code running.
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

  let active = null;
  let destination = null;

  // The frame opens at whatever the viewport table lists first, and that
  // one carries no size of its own, so nothing is written onto the frame
  // until somebody asks for a width.
  let viewport = Demo.VIEWPORTS[0].id;

  function say(message) {
    $("status").textContent = message || "";
  }

  /* ---------------------------------------------------------------- */
  /* Staging.                                                         */
  /* ---------------------------------------------------------------- */

  /*
   * The session is written straight into sessionStorage rather than
   * minted through a sign-in, because most cards start from a member
   * who is already in. It is the shape apps/web/session.js accepts and
   * nothing looser - a demo session that the shipped normalizer would
   * reject is a demo of the rejection.
   *
   * sessionStorage is per tab and per origin, and the frame shares both
   * with this page, so one write reaches the page in the frame.
   */
  function stage(action) {
    const chosen = Demo.scenarioFor(action.scenario);
    active = action;

    root.sessionStorage.setItem(SCENARIO_KEY, chosen.id);
    root.sessionStorage.removeItem(WORLD_KEY);

    if (chosen.session) {
      root.sessionStorage.setItem(SESSION_KEY, JSON.stringify(chosen.session));
    } else {
      root.sessionStorage.removeItem(SESSION_KEY);
    }

    /*
     * The prefill is device-local and lives in localStorage, scoped to an
     * account id - that scoping is #56 and it is the thing "The form
     * remembers you" exists to show. Every other card clears it, so
     * "already filled in" is never left over from the last press.
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

    paintFeatures();
    open(action.open || chosen.start);
  }

  function open(file) {
    destination = file;
    const path = MIRROR + file;
    $("stage").src = path;
    $("frame-path").textContent = root.location.origin + path;
    paintDestinations();
  }

  /*
   * The frame's size, and nothing else on the page.
   *
   * Written onto the frame element itself because that element's width
   * is the viewport the page inside it lays out against; a width on the
   * section around it would leave a desktop page in a phone-shaped hole,
   * which is the one thing this control can get wrong that still looks
   * right. What to write is demo-stub.js's, so dev/demo.test.mjs holds
   * the same function this does.
   *
   * A size rather than a reload, so the walk keeps its place: a form
   * half filled in is still half filled in on the other side of the
   * toggle, which is the whole reason to look at the page narrow.
   *
   * The id comes back off the button rather than out of the closure,
   * because a stale id is how this refusal gets reached - the same
   * shape as a staging id that outlived a rename.
   */
  function frame(id) {
    const style = Demo.frameStyleFor(id);
    if (style === null) {
      say("No frame size is named " + id + ", so the frame is unchanged.");
      return;
    }

    viewport = id;
    $("stage").style.width = style.width;
    $("stage").style.height = style.height;
    paintViewports();

    const view = Demo.viewportFor(id);
    say(view.width === null
      ? "The frame fills the stage again."
      : "The frame is " + view.width + " by " + view.height + " CSS " +
        "pixels, so the page in it is laying itself out at a phone's " +
        "width. It is a width, not a device - nothing here is emulated.");
  }

  /* ---------------------------------------------------------------- */
  /* Painting.                                                        */
  /* ---------------------------------------------------------------- */

  /*
   * One card per feature: the title, the blurb, and a button per
   * action. The pressed state follows the last action pressed, because
   * that is the world the frame is showing - a card is never "on" by
   * itself, only an action somebody took.
   */
  function paintFeatures() {
    const holder = $("features");
    holder.textContent = "";
    Demo.FEATURES.forEach(function (card) {
      const item = document.createElement("article");
      item.className = "card";

      const title = document.createElement("h3");
      title.textContent = card.title;
      const blurb = document.createElement("p");
      blurb.textContent = card.blurb;
      item.appendChild(title);
      item.appendChild(blurb);

      const row = document.createElement("p");
      row.className = "actions";
      card.actions.forEach(function (action) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = action.label;
        button.setAttribute("aria-pressed",
          action === active ? "true" : "false");
        button.addEventListener("click", function () { stage(action); });
        row.appendChild(button);
      });
      item.appendChild(row);

      holder.appendChild(item);
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

  function paintViewports() {
    const holder = $("viewports");
    holder.textContent = "";
    Demo.VIEWPORTS.forEach(function (one) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = one.label;
      button.dataset.viewport = one.id;
      button.title = one.width === null
        ? "The frame fills the stage."
        : one.width + " by " + one.height + " CSS pixels";
      button.setAttribute("aria-pressed",
        one.id === viewport ? "true" : "false");
      button.addEventListener("click", function (event) {
        frame(event.currentTarget.dataset.viewport);
      });
      holder.appendChild(button);
    });
  }

  /* ---------------------------------------------------------------- */
  /* The corpus.                                                      */
  /* ---------------------------------------------------------------- */

  /*
   * Both published snapshots, built by the shipped aggregation in a
   * worker, and parked where the stub can read them.
   *
   * The rich corpus is what makes the charts worth looking at: enough
   * repeat submitters to clear the floor the published series is held
   * to, so the hero, the deltas and the weight-over-time marquee all
   * draw. The sparse one is under that floor on purpose, and it is a
   * separate corpus because one dataset cannot be on both sides of a
   * threshold.
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
    paintFeatures();
    paintDestinations();
    paintViewports();

    say("Building the demo corpus from the shipped code…");
    const built = await buildCorpus();
    if (!built.ok) {
      say("The corpus could not be built (" + built.why + "), so the " +
        "charts will report no figures. Everything else still runs.");
    } else {
      root.sessionStorage.setItem(DATA_KEY, JSON.stringify({
        rich: built.rich,
        sparse: built.sparse,
      }));
      say(built.counts.rich + " entries staged for the full charts, " +
        built.counts.sparse + " for the held-back ones. Press any card.");
    }

    $("open-tab").addEventListener("click", function () {
      if (destination) root.open(MIRROR + destination, "_blank");
    });

    $("reset").addEventListener("click", function () {
      root.sessionStorage.removeItem(WORLD_KEY);
      if (active) stage(active);
      say("Demo state reset. The published snapshot and any revocation " +
        "are back to how the card's action starts.");
    });
  }

  setUp();
})(globalThis);
