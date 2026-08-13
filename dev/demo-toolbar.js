/*
 * The demo's strip: the controls a visitor could not produce for
 * themselves, riding above the product's own page.
 *
 * THE DEMO IS THE SITE. There is no console beside the product and no
 * frame around it - the pages here are the shipped bytes, laid out
 * against the real window, and a driver resizes the browser the way
 * anybody would. What this file adds is one row at the top and nothing
 * else; it appends its own element and reads none of the page's.
 *
 * All wiring, no pure half. What the strip offers, what each control
 * stages, which page carries a key box, how far the clock moves and
 * what a reset takes are all decided in dev/demo-stub.js, where
 * dev/demo.test.mjs drives them under Node. What is left here is
 * building elements, writing storage and navigating.
 *
 * EVERY PRESS ENDS IN A REAL NAVIGATION, and that is deliberate rather
 * than lazy. The product's pages read their world once, on load - the
 * session, the published snapshot, the site copy - so a control that
 * wrote storage and left the page standing would claim a world the
 * screen is not showing. That failure is silent, and it is the one this
 * whole demo exists to refuse.
 */
(function (root) {
  "use strict";

  const Demo = root.BinderDemo;
  const Boot = root.BinderDemoBoot;
  if (!Demo || !Boot) {
    throw new Error("demo-toolbar.js loaded without demo-boot.js.");
  }

  const [WHO_KEY, DATA_KEY, WORLD_KEY] = Demo.STORAGE_KEYS;

  /*
   * The product's own two keys, written out here because they are the
   * PRODUCT'S: apps/web names them because they are its own, and
   * demo-stub.js's list is deliberately the demo's names only, so that
   * the scan for demo hooks in shipped bytes does not fail on the
   * shipped code doing its job.
   *
   * Reset does not read this pair - it empties both stores whole - and
   * that is the point of naming them nowhere else: a reset built from a
   * list is a reset that misses whatever the next slice stores.
   */
  const SESSION_KEY = "hgb-session";

  let status = null;

  function say(message) {
    if (status !== null) status.textContent = message || "";
  }

  /* ------------------------------------------------------------------ */
  /* The world this tab is holding.                                      */

  function readWorld() {
    try {
      const raw = root.sessionStorage.getItem(WORLD_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (error) {
      return {};
    }
  }

  function writeWorld(next) {
    try {
      root.sessionStorage.setItem(WORLD_KEY, JSON.stringify(next));
    } catch (error) {
      say("This browser refused to store the demo's world, so that press " +
        "changed nothing. Everything else still runs.");
    }
  }

  function patchWorld(fields) {
    writeWorld(Object.assign(readWorld(), fields));
  }

  function here() {
    return Demo.pageAddressOf(root.location.href);
  }

  function goTo(file) {
    root.location.assign(Demo.MIRROR_PATH + file);
  }

  /*
   * A press that changes the world and then shows it.
   *
   * `location.reload()` rather than assigning the same address: a page
   * that has redirected itself is no longer at the address the driver
   * asked for, and reload is the one navigation that always happens.
   */
  function again() {
    root.location.reload();
  }

  /* ------------------------------------------------------------------ */
  /* Reset.                                                              */

  /*
   * Everything, and the inventory is ENUMERATED rather than listed.
   *
   * The names of the product's storage keys and of the two key
   * databases belong to apps/web. A copy of them here would be a second
   * home for a fact that moves, and the failure is silent in the worst
   * direction: a reset that spares the database a later slice adds
   * leaves key material in a tab that has just told the driver it holds
   * nothing.
   *
   * `indexedDB.databases()` is what makes that enumeration possible. A
   * browser without it gets a stated refusal rather than a partial
   * reset called a whole one - the honest half of a promise this button
   * cannot keep.
   */
  async function inventory() {
    const names = (store) => {
      const out = [];
      try {
        for (let i = 0; i < store.length; i += 1) out.push(store.key(i));
      } catch (error) {
        return out;
      }
      return out;
    };

    let databases = [];
    if (root.indexedDB && typeof root.indexedDB.databases === "function") {
      try {
        databases = (await root.indexedDB.databases())
          .map((one) => one && one.name)
          .filter((name) => typeof name === "string" && name.length > 0);
      } catch (error) {
        databases = [];
      }
    }

    return {
      session: names(root.sessionStorage),
      local: names(root.localStorage),
      databases: databases,
    };
  }

  function dropDatabase(name) {
    return new Promise(function (resolve) {
      let request;
      try {
        request = root.indexedDB.deleteDatabase(name);
      } catch (error) {
        resolve();
        return;
      }
      // Resolved on every outcome, including `blocked`: another tab
      // holding this database open would otherwise hang the reset
      // forever, and a reset that never finishes is worse than one that
      // says what it could not take.
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }

  async function resetEverything() {
    if (!root.indexedDB || typeof root.indexedDB.databases !== "function") {
      say("This browser cannot list its own databases, so a reset here " +
        "would leave the stored keys behind and claim otherwise. Clear " +
        "the site's data from the browser's own settings instead.");
      return;
    }

    const plan = Demo.resetPlan(await inventory());
    plan.session.forEach((name) => root.sessionStorage.removeItem(name));
    plan.local.forEach((name) => root.localStorage.removeItem(name));
    for (const name of plan.databases) await dropDatabase(name);
    root.location.assign(plan.open);
  }

  /* ------------------------------------------------------------------ */
  /* Signing in as somebody.                                             */

  /*
   * The shortcut writes the session itself, and that is the difference
   * between it and the picker on the sign-in page.
   *
   * Both doors are wanted (the owner ruled both). This one is for a
   * driver who is three pages into the product and wants to be
   * somebody else without walking back to sign in; the picker is for
   * watching the product's own sign-in happen. The session written here
   * is the shape apps/web/session.js accepts and nothing looser - a
   * demo session the shipped normalizer would reject is a demo of the
   * rejection.
   */
  function signInAs(id) {
    const who = Demo.signInFor(id);
    if (who === null) {
      say("The demo has nobody called " + id + ", so nothing changed.");
      return;
    }
    root.sessionStorage.setItem(WHO_KEY, who.id);
    root.sessionStorage.setItem(SESSION_KEY,
      JSON.stringify(Demo.sessionFor(who)));
    // A fresh credential is a live one, whatever the last sign-out did.
    patchWorld({ revoked: false });
    goTo(who.lands);
  }

  /* ------------------------------------------------------------------ */
  /* The key.                                                            */

  async function fillKeyBox() {
    const box = Demo.keyBoxFor(here().file);
    if (box === null) {
      say("This page has no key box. The one that does is " +
        Demo.KEY_BOXES.map((one) => one.page).join(", ") + ".");
      return;
    }
    const field = document.getElementById(box.box);
    if (!field) {
      say("This page carries no " + box.box + " box, so the key went " +
        "nowhere. The page has moved under the demo.");
      return;
    }
    let text;
    try {
      text = await (await Boot.read(box.key)).text();
    } catch (error) {
      say("The demo's throwaway key could not be read (" +
        ((error && error.message) || error) + "), so the box is empty.");
      return;
    }
    field.value = text;
    /*
     * Said by the control that performs the act, in the same breath.
     * A private key appearing in a box in front of the person judging
     * this design teaches the wrong lesson unless the same moment says
     * what kind of key it is.
     */
    say(Demo.KEY_STAGED_LINE);
  }

  /* ------------------------------------------------------------------ */
  /* The published snapshot.                                             */

  /*
   * Built by the shipped aggregation in a worker, for the reason
   * dev/demo-corpus.js opens with: apps/web/admin.js and
   * apps/web/dashboard.js wire themselves to a document when there is
   * one, and a worker has none - so only the pure halves run, and what
   * the charts draw is what the product computes.
   */
  function buildSnapshot(corpus, rounds) {
    return new Promise(function (resolve) {
      let worker;
      try {
        worker = new Worker("/dev/demo-corpus.js");
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
      worker.postMessage({ corpus: corpus, rounds: rounds });
    });
  }

  async function publish(corpus, rounds) {
    if (corpus === null) {
      /*
       * Emptying is a write of the DATA, not of `published`.
       *
       * demo-stub.js reads `published: undefined` as never-touched and
       * `published: null` as taken-down, and those two are a property
       * the product really has. Writing null here to mean "no preset"
       * would collapse them, and a takedown pressed on the admin page
       * would stop being distinguishable from a binder nobody has
       * published in.
       */
      try {
        root.sessionStorage.removeItem(DATA_KEY);
      } catch (error) {
        say("This browser refused to clear the staged snapshot.");
        return;
      }
      patchWorld({ staged: null });
      again();
      return;
    }

    say("Building the snapshot from the shipped code…");
    const built = await buildSnapshot(corpus, rounds);
    if (!built.ok) {
      say("The snapshot could not be built (" + built.why + "), so the " +
        "charts report no figures. Everything else still runs.");
      return;
    }
    try {
      root.sessionStorage.setItem(DATA_KEY, JSON.stringify({
        staged: built.snapshot,
        at: new Date().toISOString(),
      }));
    } catch (error) {
      say("The snapshot is too large for this browser's session storage, " +
        "so nothing was staged.");
      return;
    }
    patchWorld({ staged: { corpus: corpus, rounds: built.rounds } });
    again();
  }

  function stagedNow() {
    const staged = readWorld().staged;
    return staged && staged.corpus ? staged : null;
  }

  async function addEntries() {
    const staged = stagedNow();
    const corpus = staged === null ? "rich" : staged.corpus;
    const at = staged === null ? 0 : Number(staged.rounds) || 0;
    const of = Demo.roundsIn(corpus);
    if (at >= of) {
      say("Every round this corpus has is already published - " + of +
        " of " + of + ". Press a snapshot row to start over.");
      return;
    }
    await publish(corpus, at + 1);
  }

  /* ------------------------------------------------------------------ */
  /* Corrections, and the clock.                                         */

  function seedCorrections() {
    const on = readWorld().corrections !== true;
    patchWorld({ corrections: on });
    again();
  }

  function jumpClock(step) {
    /*
     * The window comes off the page that measures it, never from a
     * number written here. apps/web/admin.js owns those two figures and
     * is free to change them; a demo carrying its own copy would jump
     * to a warning the page has stopped showing, in front of the person
     * deciding whether the timer is right.
     */
    const admin = root.BinderAdmin;
    const bounds = admin ? admin.IDLE_WINDOW : null;
    const by = Demo.clockJumpFor(step, bounds);
    if (by === null) {
      say("This page runs no idle timer, so there is no clock here to " +
        "move. The admin page is the one that has one.");
      return;
    }
    patchWorld({ clock: (Number(readWorld().clock) || 0) + by });
    again();
  }

  /* ------------------------------------------------------------------ */
  /* Painting.                                                           */

  function button(label, title, onPress) {
    const control = document.createElement("button");
    control.type = "button";
    control.textContent = label;
    if (title) control.title = title;
    control.addEventListener("click", onPress);
    return control;
  }

  function group(bar, label) {
    const box = document.createElement("span");
    box.className = "demo-group";
    const name = document.createElement("span");
    name.className = "demo-group-name";
    name.textContent = label;
    box.appendChild(name);
    bar.appendChild(box);
    return box;
  }

  function enablerFor(id) {
    for (const one of Demo.ENABLERS) {
      if (one.id === id) return one;
    }
    return null;
  }

  function paint() {
    const bar = document.createElement("div");
    bar.className = "demo-bar";
    // Marked as the demo's own furniture so a driver reading the DOM
    // can tell in one look which of it is the product.
    bar.setAttribute("data-demo-toolbar", "");

    const title = document.createElement("span");
    title.className = "demo-title";
    title.textContent = Demo.TOOLBAR.title;
    bar.appendChild(title);

    const honesty = document.createElement("span");
    honesty.className = "demo-honesty";
    honesty.textContent = Demo.TOOLBAR.honesty;
    bar.appendChild(honesty);

    const state = group(bar, "");
    const reset = enablerFor("reset");
    state.appendChild(button(reset.label, reset.what, resetEverything));

    const who = group(bar, enablerFor("sign-in").label);
    Demo.SIGN_INS.forEach(function (one) {
      who.appendChild(button(one.label, one.what, function () {
        signInAs(one.id);
      }));
    });

    const key = enablerFor("key");
    who.appendChild(button(key.label, key.what, fillKeyBox));

    const data = group(bar, enablerFor("snapshot").label);
    Demo.PRESETS.forEach(function (preset) {
      const counts = Demo.countsFor(preset.corpus, preset.rounds);
      // The numbers are read off the corpus rather than written on the
      // control, so a label cannot disagree with the charts under it.
      const label = preset.corpus === null ? preset.label
        : preset.label + " " + counts.entries + "/" + counts.people;
      data.appendChild(button(label, preset.what, function () {
        publish(preset.corpus, preset.rounds);
      }));
    });

    const grow = enablerFor("grow");
    data.appendChild(button(grow.label, grow.what, addEntries));

    const corrections = enablerFor("corrections");
    data.appendChild(button(corrections.label, corrections.what,
      seedCorrections));

    const clock = group(bar, enablerFor("clock").label);
    Demo.CLOCK_STEPS.forEach(function (step) {
      clock.appendChild(button(step.label, enablerFor("clock").what,
        function () { jumpClock(step.id); }));
    });

    status = document.createElement("span");
    status.className = "demo-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    bar.appendChild(status);

    // Appended to the body rather than inserted at its head: the signed-in
    // pages lay their body out as a grid, and a new first child would
    // become a grid item and move the rail. Fixed positioning is what
    // puts it at the top, and dev/demo-toolbar.css makes room for it.
    document.body.appendChild(bar);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", paint);
  } else {
    paint();
  }
})(globalThis);
