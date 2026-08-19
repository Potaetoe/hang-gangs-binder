/*
 * The door's 0.9 face (0.9-M2-S4, #355; DESIGN.md, "Roles and
 * vocabulary"): the development-session card is structurally gone, the
 * privacy line's slot is in place awaiting its words, and the outsider
 * refusal renders through the existing #auth-status element.
 *
 *     node tests/door.test.mjs
 *
 * WHAT SECTION 3 DOES NOT DO. It does not simulate server/worker.js's
 * refusal logic - tests/telegram-auth.test.mjs already drives the real
 * Worker and proves the group check answers 403 with "This binder is
 * for members of the group only." This file starts one layer later:
 * given a Worker response shaped like that refusal, does the SHIPPED
 * client mechanism (apps/web/auth.js's say(), through
 * apps/web/ui.js's setStatus()) put it on screen in #auth-status?
 * apps/web/auth.js is untouched by this slice on purpose - the design
 * mandate that scopes this file says the refusal path already exists
 * and already renders through that element for every non-ok response -
 * so this arm's job is to prove that claim against the shipped bytes
 * rather than assert it in prose. No fake Worker is built; the real
 * apps/web/ui.js, apps/web/session.js and apps/web/auth.js run under
 * the small browser stubs the pattern in dev/session.test.mjs uses.
 *
 * A CANARY, NOT TODAY'S SENTENCE. The stub Worker answers with a
 * distinctive string nothing else in this repository uses, so a pass
 * proves the page relays whatever the server sends rather than having
 * hard-coded a fallback that happens to read the same as today's
 * refusal text.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (path) => readFile(HERE(path), "utf8");

const EXPECTED = 16;
let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) failures += 1;
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

/* ------------------------------------------------------------------ */
/* 1. The development-session card, and every hook it painted through, */
/*    are gone from the files this slice owns.                         */

const indexSource = await read("../apps/web/index.html");
const sessionSource = await read("../apps/web/session.js");
const submitSource = await read("../apps/web/submit.js");

check("index.html carries no data-dev-session hook",
  !/data-dev-session/.test(indexSource));
check("index.html carries no data-dev-identity hook",
  !/data-dev-identity/.test(indexSource));
check("index.html carries no \"Development session\" caption",
  !/Development session/.test(indexSource));
check("session.js carries no isDev field, in code or in comment",
  !/isDev/i.test(sessionSource));
check("session.js carries no query for the retired card's markup",
  !/data-dev-session|data-dev-identity/.test(sessionSource));
check("submit.js carries no reference to the retired local sign-in route",
  !/auth\/dev/.test(submitSource));

/* ------------------------------------------------------------------ */
/* 2. The privacy line's slot, present with its marker rather than     */
/*    authored words (Design Mandate 2, Mode 2 binder-designer,        */
/*    2026-08-18).                                                     */

const mainOpen = indexSource.indexOf('<main class="stack">');
const authStatusAt = indexSource.indexOf('id="auth-status"');
const privacyAt = indexSource.indexOf('id="privacy-line"');
const mainClose = indexSource.indexOf("</main>");

check("the sign-in page carries a privacy-line slot",
  privacyAt !== -1);
check("the slot is inside <main>, after the sign-in card and before " +
  "the close",
  mainOpen !== -1 && authStatusAt !== -1 && mainClose !== -1 &&
  mainOpen < authStatusAt && authStatusAt < privacyAt &&
  privacyAt < mainClose);

const betweenAuthAndPrivacy =
  indexSource.slice(authStatusAt, privacyAt === -1 ? authStatusAt : privacyAt);
check("the slot sits after the sign-in card closes, wrapped in nothing new",
  (betweenAuthAndPrivacy.match(/<div\b/g) || []).length === 0 &&
  (betweenAuthAndPrivacy.match(/<\/div>/g) || []).length === 1);

const privacyTag = /<p class="([^"]*)" id="privacy-line"[^>]*>/
  .exec(indexSource);
check("the slot is a <p class=\"muted\">, no card and no border",
  privacyTag !== null && privacyTag[1] === "muted");
check("the slot carries the pending-copy marker rather than a ruled " +
  "sentence",
  indexSource.includes('data-pending-copy="0.9-M4"'));

/* ------------------------------------------------------------------ */
/* 3. The outsider refusal renders through #auth-status - fixture-     */
/*    driven, against the shipped client files.                        */

globalThis.sessionStorage = (() => {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
})();
globalThis.location = { pathname: "/index.html", replace() {} };

const authStatusElement = { hidden: true, textContent: "", className: "" };
const elements = { "auth-status": authStatusElement };
globalThis.document = {
  readyState: "complete",
  getElementById(id) {
    return Object.prototype.hasOwnProperty.call(elements, id)
      ? elements[id] : null;
  },
  addEventListener() {},
};

// The real shipped scripts, loaded in the page's own <script> order
// (config.js is site data with nothing this test reads; BINDER_CONFIG
// is set directly below, the same shortcut dev/session.test.mjs takes).
const uiSource = await read("../apps/web/ui.js");
await import("data:text/javascript," + encodeURIComponent(uiSource));
await import("data:text/javascript," + encodeURIComponent(sessionSource));

const CANARY = "CANARY-9c2f4a: this binder belongs to a private group.";
globalThis.fetch = async () => ({
  ok: false,
  status: 403,
  async json() { return { error: CANARY }; },
});
globalThis.BINDER_CONFIG = { endpoint: "https://worker.example" };

const authSource = await read("../apps/web/auth.js");
await import("data:text/javascript," + encodeURIComponent(authSource));
const Auth = globalThis.BinderAuth;

let refused = null;
try {
  await Auth.authenticate("/auth/telegram", { id: 1, hash: "signed" });
} catch (error) {
  refused = error;
}

check("a refusal is thrown carrying the server's own sentence",
  refused !== null && refused.message === CANARY);
check("the refusal renders in #auth-status with the server's own words",
  authStatusElement.textContent === CANARY);
check("the refusal is visible, not the element's hidden resting state",
  authStatusElement.hidden === false);
check("the refusal carries the bad tone the shared status styling reads",
  authStatusElement.className === "status bad");

/* And the success path still leaves the element untouched by a refusal
   tone, so the two checks above are not vacuously true of any string
   this element happens to hold. */
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  async json() {
    return {
      ok: true, session: "tab-token", expiresAt: "2099-01-01T00:00:00.000Z",
      username: "member", isAdmin: false, telegramId: null,
    };
  },
});
authStatusElement.textContent = "";
authStatusElement.className = "";
authStatusElement.hidden = true;
await Auth.authenticate("/auth/telegram", { id: 2, hash: "signed" });
check("a successful sign-in does not leave the refusal's canary behind",
  authStatusElement.textContent !== CANARY &&
  authStatusElement.className !== "status bad");

console.log(failures
  ? `\ndoor FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\ndoor ran ${performed} checks, expected ${EXPECTED}`
    : `\ndoor OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
