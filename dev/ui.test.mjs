/*
 * Contract checks for the small DOM helpers shared by every interactive page.
 *
 * ui.js deliberately has no browser or package dependency, so this suite uses
 * a tiny document stub and runs the shipped file unchanged under Node. Keeping
 * this test in dev/ means later wiring changes cannot silently lose the boot
 * guard, visibility behavior, or the no-network boundary.
 */
import { readFile } from "node:fs/promises";
import { nodeTestSuite } from "./harness.mjs";

const sourcePath = new URL("../apps/web/ui.js", import.meta.url);
const source = await readFile(sourcePath, "utf8");

let listener = null;
let listenerOptions = null;
let radioSelector = null;
let radioInputs = [];
const elements = new Map([["known", { id: "known" }]]);
globalThis.document = {
  readyState: "loading",
  getElementById(id) { return elements.get(id) || null; },
  querySelectorAll(selector) {
    radioSelector = selector;
    return radioInputs;
  },
  addEventListener(type, callback, options) {
    if (type === "DOMContentLoaded") {
      listener = callback;
      listenerOptions = options;
    }
  },
};

await import("data:text/javascript," + encodeURIComponent(source));
const UI = globalThis.BinderUI;

/*
 * The count is asserted, not merely printed. A printed number is a claim
 * nobody reads twice, and it drifts from the run it describes without
 * anything going red; a number the run compares against is what keeps a
 * check from disappearing behind a rename or an early return and leaving
 * a confident summary over the checks that still reached. See
 * dev/harness.mjs.
 */
const { check, report } = nodeTestSuite("ui.js", 36);

check("the shipped file exposes one frozen helper object",
  UI && Object.isFrozen(UI));
check("byId reads from the current document",
  UI.byId("known") === elements.get("known") && UI.byId("missing") === null);

const panel = { hidden: true };
UI.show(panel, true);
check("show reveals an element", panel.hidden === false);
UI.show(panel, false);
check("show hides an element", panel.hidden === true);
UI.show(null, true);
check("show tolerates an optional missing element", true);

const radios = [
  { value: "first", checked: false },
  { value: "second", checked: true },
];
radioInputs = radios;
check("checkedValue exposes only its global two-argument contract",
  UI.checkedValue.length === 2);
check("checkedValue returns the checked radio",
  UI.checkedValue("units", "fallback") === "second");
check("checkedValue queries document for the requested group",
  radioSelector === 'input[name="units"]');
radios[1].checked = false;
check("checkedValue returns its explicit fallback",
  UI.checkedValue("units", "fallback") === "fallback");

const status = { textContent: "old", hidden: true, className: "old" };
UI.setStatus(status, "Ready", "good");
check("setStatus shows text and tone",
  status.textContent === "Ready" && status.hidden === false &&
  status.className === "status good");
UI.setStatus(status, "");
check("setStatus clears and hides an empty status",
  status.textContent === "" && status.hidden === true &&
  status.className === "status");

/*
 * fadeIn and showToast (0.9-M3-S33, #457) - lifted here from admin.js's
 * own first build (0.9-M3-S30, #452) so every signed-in page shares one
 * copy. #toast is added to the same `elements` stub the rest of this
 * suite already reads through byId/getElementById.
 */
const toast = { textContent: "", hidden: true, className: "" };
elements.set("toast", toast);

UI.fadeIn(null);
check("fadeIn tolerates a missing element", true);

const fadeTarget = { className: "" };
UI.fadeIn(fadeTarget);
check("fadeIn adds and removes the fade-in class around one forced " +
  "reflow, leaving no trace once it returns",
  fadeTarget.className === "");

const fadeTargetWithClass = { className: "card" };
UI.fadeIn(fadeTargetWithClass);
check("fadeIn preserves a class already on the element",
  fadeTargetWithClass.className === "card");

/*
 * The two checks above (#457 review, F4) read only the END state, which
 * a no-op fadeIn (`if (!element) return;`) also leaves unchanged - a
 * gutted transition and a real one are the same story once it is over.
 * Caught here instead by watching what fadeIn does WHILE it runs: it
 * reads `element.offsetHeight` exactly once, to force the one reflow
 * that lets the browser paint the class it just added before the next
 * line removes it (ui.js's own comment on fadeIn carries the mechanism).
 * A getter on offsetHeight below records the className AT THAT MOMENT -
 * an applied-state assertion, never a wall-clock one (the S35 lesson
 * dev/ui.test.mjs's own header already lives by for showToast's timer).
 */
let reflowReads = 0;
let classNameDuringReflow = null;
const watchedFadeTarget = {
  className: "",
  get offsetHeight() {
    reflowReads += 1;
    classNameDuringReflow = this.className;
    return 0;
  },
};
UI.fadeIn(watchedFadeTarget);
check("fadeIn forces exactly one reflow read - a gutted fadeIn " +
  "reads offsetHeight zero times",
  reflowReads === 1);
check("and at that moment the fade-in class is actually applied, not " +
  "merely toggled on either side of a step that never ran",
  classNameDuringReflow === "fade-in");
check("and the class is gone again once the forced reflow returns, " +
  "the same end state a no-op fadeIn would also leave",
  watchedFadeTarget.className === "");

let classNameDuringReflowWithClass = null;
const watchedFadeTargetWithClass = {
  className: "card",
  get offsetHeight() {
    classNameDuringReflowWithClass = this.className;
    return 0;
  },
};
UI.fadeIn(watchedFadeTargetWithClass);
check("and an existing class is still present beside fade-in at the " +
  "moment of that same reflow",
  classNameDuringReflowWithClass === "card fade-in");

const themeCssForFade = await readFile(
  new URL("../apps/web/theme.css", import.meta.url), "utf8");
check("theme.css's own .fade-in rule and the elements fadeIn is used " +
  "on read the same --motion-duration token this file's comment on " +
  "fadeIn names, never a second hard-coded duration",
  /\.fade-in\s*\{\s*opacity:\s*0;?\s*\}/.test(themeCssForFade) &&
  /transition:\s*opacity\s+var\(--motion-duration\)/.test(themeCssForFade));

// The dismissal timer, captured rather than awaited for real - 3s is
// real wall time this suite should not spend, and what matters is the
// contract (message, reveal, an eventual hide, one timer at a time)
// rather than the literal clock.
let capturedCallback = null;
let capturedDelay = null;
let clearedTimer = null;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = (cb, ms) => {
  capturedCallback = cb;
  capturedDelay = ms;
  return "timer-id";
};
globalThis.clearTimeout = (id) => { clearedTimer = id; };

UI.showToast("Saved.");
check("showToast writes the message and reveals #toast",
  toast.textContent === "Saved." && toast.hidden === false);
check("showToast times its own dismissal at three seconds",
  capturedDelay === 3000);

capturedCallback();
check("and the timer hides the toast when it fires - the toast clears " +
  "itself, not merely stays readable",
  toast.hidden === true);

UI.showToast("First.");
UI.showToast("Second.");
check("showToast replaces the previous message rather than stacking " +
  "two toasts",
  toast.textContent === "Second.");
check("and a second toast clears the first one's pending timer rather " +
  "than leaving it to hide the second toast early",
  clearedTimer === "timer-id");

elements.delete("toast");
UI.showToast("gone");
check("showToast tolerates a missing #toast element rather than " +
  "throwing", true);
elements.set("toast", toast);

globalThis.setTimeout = realSetTimeout;
globalThis.clearTimeout = realClearTimeout;

let booted = 0;
let bootError = null;
UI.boot(() => { booted++; }, (error) => { bootError = error; });
check("boot waits while the document is loading",
  booted === 0 && typeof listener === "function");
check("boot registers a one-shot DOMContentLoaded listener",
  listenerOptions && listenerOptions.once === true);
listener();
check("boot runs setup when the document becomes ready",
  booted === 1 && bootError === null);

document.readyState = "complete";
UI.boot(() => { throw new Error("sync"); }, (error) => { bootError = error; });
check("boot reports a synchronous setup failure",
  bootError && bootError.message === "sync");

bootError = null;
UI.boot(() => Promise.reject(new Error("async")),
  (error) => { bootError = error; });
await new Promise((resolve) => setTimeout(resolve, 0));
check("boot reports an asynchronous setup failure",
  bootError && bootError.message === "async");

check("ui.js contains no network operation",
  !source.includes("fetch") && !source.includes("POST"));

const CRYPTO_ACCESS = /\bcrypto\s*\.\s*(?:subtle|getRandomValues|randomUUID)\b/;
const SUBTLE_CALL = /\bsubtle\s*\.\s*[A-Za-z_$][\w$]*\s*\(/;
check("ui.js contains no Web Crypto access",
  !CRYPTO_ACCESS.test(source) && !SUBTLE_CALL.test(source));

const signInSource = await readFile(
  new URL("../apps/web/index.html", import.meta.url), "utf8");

/*
 * THE FINGERPRINT IS GONE FROM UI.JS TOO, and these are the arms that
 * keep it gone.
 *
 * 0.9-M2-S2 (#353) removed your-page.html's slot, its pinned-code
 * sentence and form.js's call, and left `showFingerprint` standing as a
 * generic truncate-and-reveal helper. 0.9-M2-S5 (#356) took the helper
 * as well: DESIGN.md, "Trust model: the Worker reads" ends the public
 * key a member would have compared, so the length it truncated to was a
 * security parameter about a comparison nobody makes and the helper had
 * no caller anywhere in the tree. A named helper with no caller is the
 * shape a page grows a new one from.
 *
 * What is checked here is the whole of what is left to check: the
 * export list does not carry it, and no page carries a slot for it.
 */
check("ui.js publishes no fingerprint helper at all",
  !Object.keys(UI).some((name) => /fingerprint/i.test(name)) &&
  !/fingerprint/i.test(source));
check("and your-page.html carries no key-fingerprint slot for one",
  !(await readFile(new URL("../apps/web/your-page.html", import.meta.url),
    "utf8")).includes("key-fingerprint"));
check("and theme.css styles no such slot either",
  !(await readFile(new URL("../apps/web/theme.css", import.meta.url),
    "utf8")).includes("key-fingerprint"));

/*
 * The base64-key-literal assertion used to live here, guarding your-page.html
 * alone while #34 held check_web.py. It has moved to check 14 in that file,
 * where it covers every page - #41. It moved rather than being copied: a
 * page suite cannot own a repository-wide boundary, and two checks making
 * the same claim in different files is how one of them gets quietly
 * weakened. Deleting it here is the point, not an oversight.
 */
check("the sign-in page does not gain the fingerprint",
  !/key-fingerprint/.test(signInSource));

report();
