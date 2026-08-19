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
const { check, report } = nodeTestSuite("ui.js", 22);

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
