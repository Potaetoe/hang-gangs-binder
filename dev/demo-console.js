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
  // The address the frame last reported, kept because a control that
  // cannot act on it still has to be able to name it.
  let shownAt = "";

  // The errand waiting on the next arrival of the frame, and the key
  // text once it has been read.
  let errand = null;
  let devKey = null;

  /*
   * WHICH NAVIGATION AN ERRAND BELONGS TO, AND WHY A COUNTER RATHER
   * THAN A FLAG.
   *
   * An errand waits up to five seconds for what it is about to touch,
   * and until this existed nothing could stop that wait: the walk moved
   * on, the wait ended on a page nobody was looking at any more, and the
   * errand's give-up sentence landed in the status line ON TOP of the
   * stop now on screen. Reproduced on the baked build - an admin walk
   * left at t=1.2s narrated "presses the page's run control..." over the
   * member journey's sign-in stop at t=6.2s and again at t=12.4s. The
   * status line is the one surface built to say what really happened, so
   * a report about a page that is not on screen is the worst thing it
   * can carry.
   *
   * Bumped in open() rather than in goTo(), so a viewer pressing a
   * destination cancels the running errand too - goTo() is only the
   * console's own arming path, and the rail button beside the frame is
   * how a viewer walks away without touching the journey at all.
   *
   * NOT bumped on the frame's own arrivals by itself, which is the half
   * that has to stay: a shipped page that redirects itself fires `load`
   * twice without anybody asking for a navigation, and an errand
   * cancelled by that is an errand that never finishes on the journeys
   * opening on the sign-in page. What DOES bump it on an arrival is
   * `tookTheWheel` below, and only when the viewer caused the arrival.
   */
  let era = 0;

  /*
   * THE THIRD WAY OUT OF A STOP: THE PAGE IN THE FRAME NAVIGATING
   * ITSELF, BECAUSE THE VIEWER PRESSED SOMETHING ON IT.
   *
   * open() covers Next, Back, the Go-anywhere rail and Reset, and
   * leaveTour() covers leaving - every path where the CONSOLE moves. The
   * product's own navigation is inside the frame, and this console's own
   * copy invites a viewer to use it, so a real click on a real link in
   * there walks away from the stop without touching any of them. Left
   * uncovered, the errand went on: the key-staging disclosure line
   * landed in the feed while the charts page - which has no key box at
   * all - was on screen, and the give-up sentence landed over whatever
   * the viewer had moved to. That is the same defect the era exists to
   * end, arriving through a door the era did not watch.
   *
   * AND THE OBVIOUS REPAIR IS WRONG. Bumping the era on every arrival
   * cancels the self-redirect case too, which is the half above; a page
   * that redirects itself would then cancel every errand armed for it.
   * The arrival cannot answer the question because both look identical
   * to the frame: one `load`, one new address, nobody to ask.
   *
   * So the question is not what moved or when, but WHOSE PRESS caused
   * it - and the browser already answers that. A press a person made
   * carries `isTrusted: true`; the console's own control.click(), the
   * keep-awake poke, and a page's script clicking something for itself
   * all carry false. Click alone is listened for: a link, a button and
   * a form's implicit submission all arrive as one, and a listener for
   * an event no navigation comes from would be a branch nothing could
   * falsify - which is the thing this whole change is about.
   *
   * Cleared when the console navigates, because the console's own press
   * is the newer instruction: a viewer who pokes a tab on the page and
   * then presses Next would otherwise cancel the errand of the stop they
   * just asked for, on its first arrival.
   */
  let handled = false;

  function tookTheWheel(event) {
    if (!event || event.isTrusted !== true) return;
    handled = true;
  }

  function watchFrame() {
    const doc = frameDocument();
    if (doc === null) return;
    // Capture, so a page that stops propagation on its own links is
    // still seen. Registering the same pair on the same document is one
    // registration, so re-arming on every arrival costs nothing.
    doc.addEventListener("click", tookTheWheel, true);
  }

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
   * feature rather than a story.
   *
   * AND THE SAME ERRAND A STOP GETS, BUILT THE SAME WAY. A card can
   * land on the wrong tab or in front of a locked box exactly as a stop
   * can, and the card that opens the keyholder's desk is the case: with
   * no errand it lands with the page's key box empty, and the pointer
   * telling a viewer to unlock the rows is a pointer at a dead end.
   * The two lines are deliberately identical to goToStop's - a free
   * drive with a staging path of its own is the drift the journeys'
   * own header warns about, one surface down.
   */
  function stage(action) {
    active = action;
    const chosen = stageWorld(action.scenario);
    $("try-next").textContent = action.try;
    paintFeatures();
    const todo = action.press || action.key || action.scroll
      ? { press: action.press, key: action.key, scroll: action.scroll }
      : null;
    goTo(action.open || chosen.start, todo);
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
    era += 1;
    handled = false;
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
    /*
     * Whether the viewer asked for this arrival, answered before
     * anything else because it decides whether there is still an errand.
     * The flag belongs to the document being left, so it is read and
     * cleared here whichever way it came out.
     */
    const byViewer = handled;
    handled = false;
    if (byViewer) {
      era += 1;
      // The errand still waiting was armed for the console's navigation,
      // not for the one the viewer just made - even if the page they
      // reached happens to be the page it was waiting for.
      errand = null;
    }
    watchFrame();

    const there = Demo.frameAddressOf(frameHref());
    destination = there.file;
    shownAt = there.shown;
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
  /*
   * ARRIVING IS NOT THE SAME AS BEING READY, and the frame's `load` is
   * the moment that difference is easiest to miss.
   *
   * Two ways it bites, both found by driving the baked demo behind a
   * clean-URL host rather than by reading anything:
   *
   *  - The admin page ships its decrypt button DISABLED and enables it
   *    when its own session check answers, about a frame later. A
   *    disabled button swallows click() silently - no event is
   *    dispatched at all - so the errand pressed nothing, reported
   *    nothing, and the stop narrated over a page where nothing had
   *    happened.
   *  - The publishing card that press reveals arrives later again,
   *    after a fetch and a few hundred unseals, and scrollIntoView on a
   *    section that is not rendering moves nothing just as quietly.
   *
   * So the errand waits for what it is about to touch, and says so when
   * the wait runs out. The budget is spent in TRIES rather than in a
   * duration because that is what a suite can spend all of at once: a
   * budget in real time is a budget the arms have to sit through.
   */
  const READY_TRIES = 100;
  const READY_EVERY = 50;

  /*
   * The element once `ready` holds of it, or whatever is there when the
   * budget runs out - which the caller reads for itself, because absent
   * and not-yet-ready are two different sentences to a viewer.
   */
  function waitFor(doc, id, ready, live) {
    return new Promise(function (resolve) {
      let left = READY_TRIES;
      const look = function () {
        // An abandoned errand stops WAITING as well as stops talking.
        // Five seconds of polling a document nobody is looking at costs
        // the walk nothing visible, which is exactly why it would be
        // left in place - and the caller checks again on the way out.
        if (!live()) {
          resolve(null);
          return;
        }
        const found = doc.getElementById(id);
        if (found && ready(found)) {
          resolve(found);
          return;
        }
        left -= 1;
        if (left <= 0) {
          resolve(found);
          return;
        }
        root.setTimeout(look, READY_EVERY);
      };
      look();
    });
  }

  // Rects rather than the attribute, per AGENTS.md: `hidden` can read
  // true while an element paints, and the inverse is what bites here.
  const PAINTS = function (node) {
    return node.getClientRects().length > 0;
  };
  const PRESSABLE = function (node) {
    return node.disabled !== true;
  };

  async function runErrand(todo) {
    const doc = frameDocument();
    if (doc === null) return;

    /*
     * The navigation this errand belongs to. Everything below is
     * suspended at least once, and each resumption asks whether the
     * viewer is still on the stop that armed it - because the answer
     * decides between reporting and interrupting.
     */
    const mine = era;
    const live = function () { return mine === era; };

    /*
     * WHAT THE ERRAND COULD NOT DO, KEPT RATHER THAN REPLACED.
     *
     * Each act said its own failure straight into the status line, and
     * the next act's sentence replaced it: a stop whose press found a
     * control the page never enabled and whose move then found a section
     * the page was not showing left the viewer reading "the page is not
     * showing that section" with the press that never happened already
     * gone. The cause is the half that explains why the screen does not
     * match the words, and the symptom without it reads as a different
     * defect.
     *
     * So the complaints accumulate and the line is rewritten from all of
     * them. Said as each one happens rather than gathered up and said at
     * the end, because a viewer watching the page do nothing deserves
     * the first sentence at the moment it is true.
     */
    const trouble = [];
    const complain = function (text) {
      trouble.push(text);
      say(trouble.join(" "));
    };

    /*
     * THE KEY GOES IN BEFORE ANYTHING IS PRESSED, and that ordering is
     * the errand rather than a coincidence of how this function is
     * written. The stop that reaches the publishing card gets there by
     * pressing the page's own Fetch and decrypt, and a key written after
     * that press leaves the product answering "paste or choose your key
     * file first" - a dead end reached by doing all three of the right
     * things in the wrong order.
     */
    if (todo.key) {
      const why = await stageKey(doc, live);
      if (!live()) return;
      if (why !== null) complain(why);
    }

    /*
     * A control that is not there is SAID, not skipped.
     *
     * The stop's promise is about what is on screen when it lands, so a
     * press that quietly found nothing leaves the narration describing a
     * tab the viewer is not looking at - which is the original defect,
     * arriving through a rename rather than through a missing
     * declaration. The suite holds every declared press to naming a
     * control the shipped page really carries, so reaching this line
     * means the page moved under the tour since the gate last ran.
     *
     * AND A CONTROL THE PAGE HAS NOT ENABLED YET IS THE QUIETER HALF.
     * click() on a disabled button dispatches NOTHING - no event, no
     * error, no way to tell it apart from a press that was received and
     * ignored - so a stop pressing one narrates over a page where its
     * press never happened. That is not hypothetical: the admin page
     * ships its decrypt button disabled and enables it when its own
     * session check answers, about a frame after the frame reports
     * `load`.
     */
    if (todo.press) {
      const control = await waitFor(doc, todo.press, PRESSABLE, live);
      if (!live()) return;
      if (control && PRESSABLE(control)) {
        control.click();
      } else if (control) {
        complain("This stop presses the page's " + todo.press +
          " control, and the page has not made it pressable in this " +
          "staging - so nothing was pressed, and what is on screen is " +
          "whatever the page opened on.");
      } else {
        complain("This stop opens the page's " + todo.press +
          " control, and the page in the frame has no such control - so " +
          "what is on screen is whatever the page opened on, not what " +
          "this stop describes.");
      }
    }

    /*
     * `scroll` is the same promise as `press`, one page-shape down: a
     * stop can land on the right page and the right tab and STILL
     * narrate something below the fold. The admin page carries the
     * publishing controls, the key box and the membership lists on one
     * long surface, so the stop about who holds admin opened on the key
     * box with its subject a screen and a half away.
     *
     * The page's own section is scrolled to by the page's own means -
     * this asks the element to bring itself into view, which is what a
     * link to it would do. Nothing is measured or positioned here; a
     * console computing an offset would be a console guessing at a
     * layout it does not own.
     */
    if (todo.scroll) {
      /*
       * PRESENT IS NOT THE SAME AS ON SCREEN, and this is the one place
       * that difference is invisible. Several of the admin surface's
       * sections start hidden and are revealed by the page's own code
       * once it knows what the session may do, and scrollIntoView on a
       * section that is not rendering moves nothing and reports nothing -
       * so the stop would narrate over the top of the page exactly as it
       * did before, with an errand that believes it ran.
       *
       * WAITED FOR rather than looked at once, because the press above
       * is what reveals it and the page's own work happens in between.
       */
      const section = await waitFor(doc, todo.scroll, PAINTS, live);
      if (!live()) return;
      if (section && PAINTS(section)) {
        section.scrollIntoView({ block: "start" });
      } else if (section) {
        complain("This stop moves the page to its " + todo.scroll +
          " section, and the page is not showing that section in this " +
          "staging - so what is on screen is wherever the page opened.");
      } else {
        complain("This stop moves the page to its " + todo.scroll +
          " section, and the page in the frame has no such section - so " +
          "what is on screen is wherever the page opened, not what this " +
          "stop describes.");
      }
    }

  }

  /*
   * The key text, read once and kept, so a journey walked twice reads
   * the file once.
   *
   * A failure is REPORTED rather than swallowed, and returned rather
   * than said: the errand owns the status line, because it is the errand
   * that knows whether the viewer is still on the stop this belongs to
   * and what else has already gone wrong on it. The staging's whole
   * promise is that the box is already filled, so a viewer who presses
   * Fetch and decrypt against an empty box would be told by the product
   * to paste a key file they have no way to obtain - the exact dead end
   * this exists to remove, arriving with an extra step in front of it.
   *
   * THE WRITE IS GUARDED, NOT ONLY THE SENTENCE. The read suspends, so
   * an abandoned errand resumes holding a document the frame has already
   * replaced - and writing a key into a page the viewer walked away from
   * puts key material where nothing asked for it and posts the
   * disclosure line into the feed of a staging that staged no key.
   */
  async function stageKey(doc, live) {
    const box = doc.getElementById("keyfile");
    if (!box) return null;
    try {
      if (devKey === null) {
        const answer = await root.fetch(Demo.DEV_KEY_FILE);
        devKey = await answer.text();
      }
    } catch (error) {
      return "The demo's throwaway key could not be read (" +
        ((error && error.message) || error) + "), so this stop could not " +
        "fill the key box for you.";
    }
    if (!live()) return null;
    box.value = devKey;
    /*
     * Said the moment it happens, and to the feed rather than the
     * status line, because the feed is the column a viewer is already
     * reading and this line has to be beside the key rather than
     * instead of the last thing that happened. The words are
     * demo-stub.js's: a key going into a box in front of the person
     * judging this design needs the sentence about what kind of key it
     * is to travel with the ACT, not with one stop's narration.
     */
    feedLine(Demo.KEY_STAGED_LINE);
    return null;
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
    const todo = stop.press || stop.key || stop.scroll
      ? { press: stop.press, key: stop.key, scroll: stop.scroll }
      : null;
    goTo(stop.open || chosen.start, todo);
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
    // Leaving is the one abandonment that moves no frame, so the era has
    // to be bumped here by hand: an errand already waiting would
    // otherwise finish and report about a stop the viewer has just left,
    // over the sentence this function ends on.
    era += 1;
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

    /*
     * A PRESS THAT CANNOT ACT STILL SAYS SO.
     *
     * This was the destination being non-null with no else at all. The
     * frame reaches pages that are none of the four - 404.html is a real
     * page of the product, reachable and deliberately no destination -
     * and there the press did nothing and reported nothing, which is the
     * same silent class the address readout above the frame exists to
     * end, on the one control UAT sends a driver through for every page
     * it holds against the mockup.
     *
     * The sentence names the address rather than the page, because the
     * address is what a viewer does next: asking for it by hand is the
     * only way to read that page at the window's own width, and naming
     * the page here would be this file keeping a second list of which
     * pages are destinations.
     */
    $("open-tab").addEventListener("click", function () {
      if (destination) {
        root.open(MIRROR + destination, "_blank");
        return;
      }
      say("This opens whichever of the four destinations the frame is " +
        "showing in a tab of its own, and " + shownAt + " is none of " +
        "them - so nothing was opened. Ask for that address by hand to " +
        "read the page at this window's own width.");
    });

    /*
     * Reset puts back the two things a press can change - the published
     * snapshot and a revocation - and then RESTAGES whatever is being
     * shown, so the frame is showing the world the console just claimed.
     *
     * A walk was the case that lied. Only a card press was restaged, and
     * during a walk there is no card, so the button dropped the world
     * key, said the state was reset, and left the frame standing in the
     * world from before it - with the walk card still on its stop. The
     * viewer is told something happened and can see that nothing did.
     * Walking the stop again is the same three writes it arrived by, so
     * the claim and the screen agree.
     *
     * The sentence names what was actually restaged rather than always
     * naming a card, because "back to how the card's action starts" is
     * a card the viewer never pressed on every stop of every journey.
     */
    $("reset").addEventListener("click", function () {
      root.sessionStorage.removeItem(WORLD_KEY);
      if (walk !== null) {
        goToStop(stopAt);
        say("Demo state reset, and this stop staged again from the " +
          "start. The published snapshot and any revocation are back to " +
          "how the stop begins.");
      } else if (active) {
        stage(active);
        say("Demo state reset. The published snapshot and any revocation " +
          "are back to how the card's action starts.");
      } else {
        say("Demo state reset. The published snapshot and any revocation " +
          "are back to how they start - pick a walk or a card to see it.");
      }
    });
  }

  setUp();
})(globalThis);
