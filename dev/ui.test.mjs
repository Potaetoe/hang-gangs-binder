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
const { check, report } = nodeTestSuite("ui.js", 28);

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

/*
 * The key fingerprint - #36.
 *
 * #29 published the production key's first 32 base64 characters to the
 * Telegram group as an out-of-band anchor. An anchor is only half a
 * mechanism: comparing against it needs the value the browser is actually
 * about to encrypt with, and that meant view-source on config.js.
 *
 * The length is not a free choice. Base64 carries 6 bits a character and
 * every uncompressed P-256 point starts 0x04, so a short prefix is ground
 * out by generating keys until one matches. 32 is what was published, and
 * matching it is the point - a fingerprint the group cannot compare
 * against is decorative.
 */
const KEY = "BEKFlvIzxk0/nOTskgzbKfYoqmMW3ds4EmUpn6rqx9rD1d5PhnxXT9kD"
  + "917khzW07MUT2yAX18Wc7rD4K0BTSQ8=";
const OTHER = "BL4L1Ap1ZybmyIfJ8wJuaV1hUMtTmtMPaE//xgG5GdS5tH8Atk24Mqkw"
  + "NaVx5OMST/OsDWMJ5l4fSsvlFKZKyrc=";

const slot = { textContent: "", hidden: true, className: "" };
UI.showFingerprint(slot, KEY);
check("the rendered fingerprint is the key's first 32 characters",
  slot.textContent === KEY.slice(0, 32));
check("a rendered fingerprint is 32 characters, the length #29 published",
  slot.textContent.length === 32);
check("rendering a fingerprint reveals its element",
  slot.hidden === false);

/*
 * The assertion that carries this slice. A hard-coded fingerprint - the
 * failure mode #36 names - satisfies every check above forever, and only
 * this one can tell the difference.
 */
const first = slot.textContent;
UI.showFingerprint(slot, OTHER);
check("changing the configured key changes what is rendered",
  slot.textContent === OTHER.slice(0, 32) && slot.textContent !== first);

/*
 * An unknown hostname gets no key at all - config.js has no production
 * fallback, deliberately. Showing "null" or an empty box beside the words
 * "compare this" is worse than showing nothing, because it invites a
 * comparison against a value that does not exist.
 */
UI.showFingerprint(slot, null);
check("no configured key renders nothing rather than an empty anchor",
  slot.textContent === "" && slot.hidden === true);
UI.showFingerprint(null, KEY);
check("showFingerprint tolerates an optional missing element", true);

const CRYPTO_ACCESS = /\bcrypto\s*\.\s*(?:subtle|getRandomValues|randomUUID)\b/;
const SUBTLE_CALL = /\bsubtle\s*\.\s*[A-Za-z_$][\w$]*\s*\(/;
check("ui.js contains no Web Crypto access",
  !CRYPTO_ACCESS.test(source) && !SUBTLE_CALL.test(source));

const submitSource = await readFile(
  new URL("../apps/web/your-page.html", import.meta.url), "utf8");
const signInSource = await readFile(
  new URL("../apps/web/index.html", import.meta.url), "utf8");
const formSource = await readFile(
  new URL("../apps/web/form.js", import.meta.url), "utf8");

check("the submission page carries a slot for the fingerprint",
  /id="key-fingerprint"/.test(submitSource));
check("the submission page says what to compare the fingerprint against",
  /pinned/i.test(submitSource) && /group/i.test(submitSource));
check("the page is filled from the configured key at runtime",
  /showFingerprint\(/.test(formSource)
  && /publicKey/.test(formSource));

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
