/*
 * Contract checks for the small DOM helpers shared by every interactive page.
 *
 * ui.js deliberately has no browser or package dependency, so this suite uses
 * a tiny document stub and runs the shipped file unchanged under Node. Keeping
 * this test in dev/ means later wiring changes cannot silently lose the boot
 * guard, visibility behavior, or the no-network boundary.
 */
import { readFile } from "node:fs/promises";

const sourcePath = new URL("../apps/web/ui.js", import.meta.url);
const source = await readFile(sourcePath, "utf8");

let listener = null;
let listenerOptions = null;
const elements = new Map([["known", { id: "known" }]]);
globalThis.document = {
  readyState: "loading",
  getElementById(id) { return elements.get(id) || null; },
  querySelectorAll() { return []; },
  addEventListener(type, callback, options) {
    if (type === "DOMContentLoaded") {
      listener = callback;
      listenerOptions = options;
    }
  },
};

await import("data:text/javascript," + encodeURIComponent(source));
const UI = globalThis.BinderUI;

let failures = 0;
function check(label, condition) {
  if (!condition) failures++;
  console.log(condition ? "pass " : "FAIL ", label);
}

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
const scope = {
  selector: null,
  querySelectorAll(selector) {
    this.selector = selector;
    return radios;
  },
};
check("checkedValue returns the checked radio",
  UI.checkedValue("units", "fallback", scope) === "second");
check("checkedValue scopes the requested group",
  scope.selector === 'input[name="units"]');
radios[1].checked = false;
check("checkedValue returns its explicit fallback",
  UI.checkedValue("units", "fallback", scope) === "fallback");

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

if (failures) {
  console.error(`\nui.js FAILED ${failures} check(s)`);
  process.exit(1);
}
console.log("\nui.js OK - 16 checks");
