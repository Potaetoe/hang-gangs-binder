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

  const MIRROR = Demo.MIRROR_PATH;

  let active = null;
  let destination = null;

  // The errand waiting on the next arrival of the frame, and the key
  // text once it has been read.
  let errand = null;
  let devKey = null;

  // The journey being walked, and how far along it. Null is the free
  // drive: the table of contents on screen, the glass away, the cards
  // behind their disclosure for anybody who wants one.
  let walk = null;
  let stopAt = 0;
  let awake = null;

  // The frame opens at whatever the viewport table lists first, and that
  // one carries no size of its own, so nothing is written onto the frame
  // until somebody asks for a width.
  let viewport = Demo.VIEWPORTS[0].id;

  function say(message) {
    $("status").textContent = message || "";
  }

  /* ---------------------------------------------------------------- */
  /* The feed.                                                        */
  /* ---------------------------------------------------------------- */

  /*
   * The console never composes a feed line of its own. The staging
   * lines come from Demo.stagingStory, computed from the staging's
   * fields; everything after them arrives on the channel from the page
   * in the frame, computed by Demo.narrate from an answer the stub
   * really gave. Painting is all that happens here, and that is what
   * keeps the feed honest: a line the console invented would be a
   * script of what should happen, in the one place built to show what
   * did.
   */
  function feedLine(text) {
    const holder = $("feed");
    const item = document.createElement("li");
    item.textContent = text;
    holder.appendChild(item);
    // The newest line narrates the press just made, so it is the one
    // the feed keeps on screen.
    holder.scrollTop = holder.scrollHeight;
  }

  // Guarded the same way the posting side is: a browser without the
  // channel gets a console whose feed carries the staging stories
  // alone, not a console that fails to boot.
  if (typeof root.BroadcastChannel === "function") {
    const events = new root.BroadcastChannel(Demo.EVENT_CHANNEL);
    events.addEventListener("message", function (event) {
      if (event.data && typeof event.data.line === "string") {
        feedLine(event.data.line);
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* Staging.                                                         */
  /* ---------------------------------------------------------------- */

  /*
   * The world a staging asks for, written into this tab.
   *
   * The session goes straight into sessionStorage rather than being
   * minted through a sign-in, because most stagings start from a member
   * who is already in. It is the shape apps/web/session.js accepts and
   * nothing looser - a demo session the shipped normalizer would reject
   * is a demo of the rejection. sessionStorage is per tab and per
   * origin, and the frame shares both with this page, so one write
   * reaches the page in the frame.
   *
   * Split out of stage() so a journey stop and a card action reach the
   * same three writes rather than each having its own. A scripted layer
   * with a staging path of its own is the one way a tour over a working
   * console goes wrong: the two drift, and the walk shows a world the
   * cards cannot reproduce.
   */
  function stageWorld(scenarioId) {
    const chosen = Demo.scenarioFor(scenarioId);

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

    /*
     * The feed starts over at the press. What stands in it afterwards
     * is this press's own story, then whatever the page in the frame
     * does about it as the narrations arrive - so everything on screen
     * belongs to the world the frame is actually showing.
     */
    $("feed").textContent = "";
    Demo.stagingStory(chosen).forEach(feedLine);

    return chosen;
  }

  /*
   * A card press: the world, the pointer, and the page it opens. The
   * cards are the free drive now (#238) - a tester who wants one
   * feature rather than a story - and they keep the behavior they had.
   */
  function stage(action) {
    active = action;
    const chosen = stageWorld(action.scenario);
    $("try-next").textContent = action.try;
    paintFeatures();
    goTo(action.open || chosen.start, null);
  }

  /*
   * A press is a REQUEST to move the frame, and nothing is painted from
   * it. What the console shows is painted when the frame ARRIVES, by
   * resync below, because the pages in the frame decide where a request
   * lands: a revoked session bounces back to Sign in, an auth guard
   * refuses a gated page, and a signed-in visitor at Sign in is
   * redirected onward. Painting here is how the console came to name
   * pages nobody was looking at.
   *
   * AND THE FRAME HAS TO MOVE EVEN WHEN IT ALREADY HOLDS THAT PATH.
   * Setting an iframe's src to the string it already carries reloads
   * nothing in any browser, and once a page has redirected itself the
   * string it still carries is the page somebody wants back - so that
   * button was the one press that did nothing, with no way for the
   * console to say so. Replacing the frame's own location is the
   * navigation that always happens; the attribute is what opens the
   * first one, before there is a document to talk to.
   */
  function open(file) {
    const path = MIRROR + file;
    const frame = $("stage");
    if (frame.getAttribute("src") === path) {
      frame.contentWindow.location.replace(path);
    } else {
      frame.setAttribute("src", path);
    }
  }

  /*
   * The frame's own address, or null when it refuses to be read.
   *
   * A cross-origin location throws rather than answering, so the catch
   * is the frame having left the demo entirely. The mirror's link edit
   * is what stops that happening at all; this is what the viewer sees if
   * anything ever gets past it, and it is a stated departure rather than
   * the last page the console asked for left standing on screen.
   */
  function frameHref() {
    try {
      return $("stage").contentWindow.location.href;
    } catch (error) {
      return null;
    }
  }

  function resync() {
    const there = Demo.frameAddressOf(frameHref());
    destination = there.file;
    $("frame-path").textContent = there.shown;
    paintDestinations();
    if (!there.inside) {
      say("The frame is showing something from outside the demo. Press a " +
        "destination to come back.");
    }

    /*
     * An errand waits for the page it was meant for and no other. A
     * stop that presses a tab arms this before the navigation, and a
     * shipped page that redirects itself on load fires `load` twice -
     * so an errand consumed on the first arrival would press a control
     * on whichever page happened to answer first, or press nothing and
     * report success. Matching the file is what makes it the errand for
     * this page rather than the next one.
     */
    if (errand !== null && there.file === errand.file) {
      const todo = errand;
      errand = null;
      runErrand(todo);
    }
  }

  /*
   * The frame's document, or null when the frame is not ours to touch.
   * Same-origin by construction - these are the mirrored pages this
   * console serves - and the guard is for the moment before the first
   * one has loaded.
   */
  function frameDocument() {
    try {
      return $("stage").contentDocument;
    } catch (error) {
      return null;
    }
  }

  function goTo(file, todo) {
    errand = todo === null ? null : Object.assign({ file: file }, todo);
    open(file);
  }

  /*
   * What a stop does to the page once it is there, and why either of
   * these is the console's business at all.
   *
   * `press` exists because a staging can be right and still land on the
   * wrong TAB: the prefilled form is staged correctly and Your page
   * opens on the list of past entries, so a stop promising "your last
   * measurements are already in it" showed a list instead. Pressing the
   * tab is exactly what the card's own pointer asked a person to do by
   * hand, done for them so the promise is true when the stop lands.
   *
   * `key` puts the committed throwaway key into the page's own key box.
   * The keyholder's headline act - sealed rows coming back and opening
   * - was not performable by anybody who had not cloned this
   * repository, because nothing anywhere surfaced the key the page asks
   * for. The console reads the committed file and writes the text; the
   * page's own code does every part that matters, exactly as it would
   * for a paste.
   *
   * Both write into a page this console serves, and neither changes a
   * byte of it.
   */
  function runErrand(todo) {
    const doc = frameDocument();
    if (doc === null) return;

    if (todo.press) {
      const control = doc.getElementById(todo.press);
      if (control) control.click();
    }

    if (todo.key) stageKey(doc);
  }

  /*
   * The key text, read once and kept, so a journey walked twice reads
   * the file once.
   *
   * A failure is SAID rather than swallowed. The stop's whole promise
   * is that the box is already filled, so a viewer who presses Fetch
   * and decrypt against an empty box would be told by the product to
   * paste a key file they have no way to obtain - which is the exact
   * dead end this stop exists to remove, arriving with an extra step in
   * front of it.
   */
  async function stageKey(doc) {
    const box = doc.getElementById("keyfile");
    if (!box) return;
    try {
      if (devKey === null) {
        const answer = await root.fetch(Demo.DEV_KEY_FILE);
        devKey = await answer.text();
      }
      box.value = devKey;
    } catch (error) {
      say("The demo's throwaway key could not be read (" +
        ((error && error.message) || error) + "), so this stop could not " +
        "fill the key box for you.");
    }
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
  /* The journeys (#238).                                             */
  /* ---------------------------------------------------------------- */

  /*
   * The table of contents, which is what the console opens on.
   *
   * One card per journey, and the one to start with says so. A reader
   * handed four equal doors picks at random, which is the problem the
   * journeys exist to solve arriving one level up.
   */
  function paintTours() {
    const holder = $("tours");
    holder.textContent = "";
    Demo.TOURS.forEach(function (one) {
      const item = document.createElement("article");
      item.className = one.first === true ? "tour tour-first" : "tour";

      if (one.first === true) {
        const flag = document.createElement("p");
        flag.className = "tour-flag";
        flag.textContent = "Start here";
        item.appendChild(flag);
      }

      const title = document.createElement("h3");
      title.textContent = one.title;
      const blurb = document.createElement("p");
      blurb.textContent = one.blurb;
      item.appendChild(title);
      item.appendChild(blurb);

      const button = document.createElement("button");
      button.type = "button";
      button.dataset.tour = one.id;
      button.textContent = "Walk this one (" + one.stops.length + " stops)";
      button.addEventListener("click", function (event) {
        startTour(event.currentTarget.dataset.tour);
      });
      item.appendChild(button);

      holder.appendChild(item);
    });
  }

  function tourFor(id) {
    for (const one of Demo.TOURS) {
      if (one.id === id) return one;
    }
    return null;
  }

  /*
   * The glass, and why it is an attribute and a stylesheet rule rather
   * than a property.
   *
   * `element.hidden` can read true while the element still paints, and
   * a read-only promise the first click disproves would be disproved in
   * front of the owner. The attribute plus `[hidden] { display: none }`
   * in dev/demo.css is what actually takes it off the page, and
   * dev/demo.test.mjs holds the stylesheet to carrying that rule.
   */
  function lock(on) {
    if (on) {
      $("glass").removeAttribute("hidden");
    } else {
      $("glass").setAttribute("hidden", "");
    }
  }

  /*
   * The product's own ten-minute idle timer is real, correct, and
   * measured against interaction with the FRAME's document - so a
   * presenter talking over the console, mouse never inside the frame,
   * does not count as being there. Ten minutes into a narrated walk the
   * admin page would sign itself out and throw away what it had
   * decrypted, mid-sentence.
   *
   * The product's timer is not touched. What happens instead is that
   * the console tells the frame somebody is here, once a minute, for
   * exactly as long as a journey is being NARRATED - and stops at the
   * stop that hands the frame over, so from the moment the viewer is
   * driving, the clock they were just told about is the real one. The
   * admin journey says all of this out loud at its own stop rather than
   * quietly disabling something and hoping nobody asks.
   */
  const AWAKE_EVERY = 60 * 1000;

  function keepAwake(on) {
    if (awake !== null) {
      root.clearInterval(awake);
      awake = null;
    }
    if (!on) return;
    awake = root.setInterval(function () {
      const doc = frameDocument();
      if (doc === null) return;
      doc.dispatchEvent(new root.Event("pointerdown", { bubbles: true }));
    }, AWAKE_EVERY);
  }

  /*
   * The table of contents is the LANDING screen, not a permanent rail.
   * Four journey cards above the walk panel push the narration - the
   * one thing a viewer is here to read - below the fold on an ordinary
   * window, so the contents step aside while a walk is running and
   * "Leave this walk" is what brings them back.
   */
  function paintTour() {
    const stop = walk.stops[stopAt];
    $("tours").setAttribute("hidden", "");
    $("tour-run").removeAttribute("hidden");
    $("tour-where").textContent = walk.title + " - stop " + (stopAt + 1) +
      " of " + walk.stops.length;
    $("tour-title").textContent = stop.title;
    $("tour-narration").textContent = stop.narration;
    $("tour-back").disabled = stopAt === 0;
    $("tour-next").disabled = stopAt === walk.stops.length - 1;
    $("try-next").textContent = stop.free === true
      ? "The frame is yours - press anything on the page."
      : "Reading stop. The page is behind glass until the end of this walk.";
  }

  function goToStop(index) {
    const stop = walk.stops[index];
    stopAt = index;

    // No card is pressed during a walk, and the cards say so rather
    // than leaving whichever one was pressed last lit under a journey
    // that has moved somewhere else entirely.
    active = null;

    const chosen = stageWorld(stop.scenario);
    paintFeatures();
    paintTour();
    lock(stop.free !== true);
    keepAwake(stop.free !== true);
    goTo(stop.open || chosen.start,
      stop.press || stop.key ? { press: stop.press, key: stop.key } : null);
  }

  function startTour(id) {
    const chosen = tourFor(id);
    if (chosen === null) {
      say("No journey is named " + id + ", so nothing was started.");
      return;
    }
    walk = chosen;
    // The status line is the last thing that happened, and starting a
    // walk makes whatever it was stale - leaving the previous walk's
    // farewell standing over the first stop of the next one reads as a
    // message about the stop being shown.
    say("");
    goToStop(0);
  }

  function leaveTour() {
    walk = null;
    errand = null;
    keepAwake(false);
    lock(false);
    $("tour-run").setAttribute("hidden", "");
    $("tours").removeAttribute("hidden");
    $("try-next").textContent = "";
    say("Back to the table of contents. The frame is yours - or open " +
      "the free drive below for one feature at a time.");
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

  /*
   * The one listener that keeps this console honest, and the reason it
   * is registered here rather than inside setUp: it has to be watching
   * before anything can move the frame, and setUp waits on the corpus.
   *
   * `load` fires on every COMPLETED navigation of the frame - the ones
   * this console asked for and the ones the shipped pages perform on
   * their own - which is the whole difference between showing where
   * somebody was sent and showing where they are.
   */
  $("stage").addEventListener("load", resync);

  async function setUp() {
    paintTours();
    paintFeatures();
    paintDestinations();
    paintViewports();

    /*
     * The free drive is the resting state, and it is asserted here
     * rather than left to the page's own markup. demo.html carries the
     * same two facts, and a console that only inherited them would be
     * one refresh away from opening mid-walk with the glass on if a
     * later slice moved the panel - so the script says what state it
     * starts in.
     */
    lock(false);
    $("tour-run").setAttribute("hidden", "");

    $("tour-next").addEventListener("click", function () {
      if (walk !== null && stopAt < walk.stops.length - 1) {
        goToStop(stopAt + 1);
      }
    });
    $("tour-back").addEventListener("click", function () {
      if (walk !== null && stopAt > 0) goToStop(stopAt - 1);
    });
    $("tour-leave").addEventListener("click", leaveTour);

    // A click that does nothing is a control that looks broken, and the
    // glass is deliberately invisible. Saying why is what turns a dead
    // click into an explanation of the walk.
    $("glass").addEventListener("click", function () {
      say("This stop is for reading - the page is behind glass so the " +
        "walk keeps its place. The last stop of every journey hands the " +
        "frame over.");
    });

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
        built.counts.sparse + " for the held-back ones. Pick a walk to " +
        "start.");
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
