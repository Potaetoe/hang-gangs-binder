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

// 37 through 0.9-M3-S33 part B's own build; fix wave 1 (#457 review)
// adds 6 - one for F4's every-width trim, five for F2's move of the
// sign-out acknowledgement into the shared toast.
const EXPECTED = 43;
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

// The WHOLE opening tag, attribute order unconstrained - not just the
// class attribute - because a check that only reads class="muted" has
// nowhere to see a `hidden` or a display-suppressing `style` appended
// after it. `[^>]*` alone let exactly that slide through once already
// (review finding F4, #355): every structural check here stayed green
// with `hidden style="display:none"` added to this tag, because
// nothing was reading past the id before the closing `>`.
const privacyTagMatch = /<p\b[^>]*\bid="privacy-line"[^>]*>/
  .exec(indexSource);
const privacyTagText = privacyTagMatch === null ? "" : privacyTagMatch[0];
const privacyClass = /\bclass="([^"]*)"/.exec(privacyTagText);
check("the slot is a <p class=\"muted\">, no card and no border",
  privacyClass !== null && privacyClass[1] === "muted");
check("the slot carries the pending-copy marker rather than a ruled " +
  "sentence",
  indexSource.includes('data-pending-copy="0.9-M4"'));
check("the slot paints - no hidden attribute, no display-suppressing " +
  "inline style",
  privacyTagMatch !== null &&
  !/\bhidden\b/.test(privacyTagText) &&
  !/\bstyle\s*=\s*"[^"]*display\s*:\s*none/i.test(privacyTagText));

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

/* ------------------------------------------------------------------ */
/* 4. apps/web/site-content.js (0.9-M3-S12, #418): the group's name    */
/*    and the door's welcome text render from GET /config, with the   */
/*    shipped markup standing as the fallback in both directions, and */
/*    only ever through textContent, a created <br>, or a text node - */
/*    never through markup the server sent.                            */

check("index.html carries the id site-content.js targets for the " +
  "welcome sentence",
  indexSource.includes('id="welcome-text"'));

const siteContentSource = await read("../apps/web/site-content.js");

check("site-content.js never assigns innerHTML - every write from the " +
  "server is textContent, a text node this file creates, or a <br> " +
  "this file creates, never markup the server sent",
  !/\.innerHTML/.test(siteContentSource));

/* A plain element stub for the wordmark spans: renderGroupName() only
   ever reads and reassigns .textContent as a whole value, so a bare
   mutable property is the whole of what the real element offers it. */
function textElement(initial) {
  return { textContent: initial };
}

/* A structural stub for #welcome-text: renderWelcomeText() walks
   firstChild/removeChild to clear it and appendChild()s text nodes and
   <br> elements it asks `document` to create - childNodes is read back
   directly by the checks below, rather than reconstructed into a
   string, so a real line break (a <br> element) and a literal "\n"
   character are never mistaken for each other. */
function richElement(initial) {
  return { _initial: initial, childNodes: [],
    get firstChild() { return this.childNodes[0] || null; },
    appendChild(node) { this.childNodes.push(node); return node; },
    removeChild(node) {
      const at = this.childNodes.indexOf(node);
      if (at !== -1) this.childNodes.splice(at, 1);
      return node;
    },
  };
}

function siteContentDocumentStub(owners, names, welcome, title) {
  return {
    readyState: "complete",
    title: title,
    querySelectorAll(selector) {
      if (selector === ".wordmark-owner") return owners;
      if (selector === ".wordmark-name") return names;
      return [];
    },
    getElementById(id) { return id === "welcome-text" ? welcome : null; },
    createTextNode(text) { return { nodeType: 3, text: text }; },
    createElement(tag) { return { tagName: String(tag).toUpperCase() }; },
    addEventListener() {},
  };
}

function localStorageStub() {
  const values = new Map();
  return {
    _values: values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

/* Both arms, against the real module - a stub GET /config that answers
   (the live case) and one that does not (the fallback case), the same
   pairing tests/theme-fallback.test.mjs's own CONTROL/ARM split uses. */

{
  const localStore = localStorageStub();
  globalThis.localStorage = localStore;
  globalThis.BINDER_CONFIG = { endpoint: "https://worker.example" };

  const owners = [textElement("Hang Gang"), textElement("Hang Gang")];
  const names = [textElement("Binder")];
  const welcome = richElement("Sign in once for this tab.");
  const doc = siteContentDocumentStub(
    owners, names, welcome, "Sign in — Hang Gang Binder");
  globalThis.document = doc;

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        "site.groupName": "The Rebrand Gang",
        "site.welcomeText": "Line one.\nLine two.",
        "site.defaultTheme": "daylight",
      };
    },
  });

  await import("data:text/javascript," +
    encodeURIComponent(siteContentSource) + "#site-content-live-" +
    Math.random());

  // The module's own boot runs its async load() synchronously up to its
  // first `await fetch(...)`, then yields - so the DOM it writes is not
  // there yet the instant import() resolves. A macrotask (setTimeout)
  // guarantees every microtask load()'s own promise chain queued has
  // already drained by the time this resumes, which a bare `await` or
  // two does not reliably promise for a chain this many promises deep
  // (fetch, then .json(), then two more awaited helpers).
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  check("a live /config renders the fetched group name into every " +
    "wordmark-owner span, not just the first",
    owners.every((owner) => owner.textContent === "The Rebrand Gang"));
  check("...and rewrites the <title>'s own trailing \"Hang Gang Binder\"",
    doc.title === "Sign in — The Rebrand Gang Binder");
  check("...and the welcome sentence's \"\\n\" becomes a real <br> " +
    "element between two text nodes, not a literal backslash-n",
    welcome.childNodes.length === 3 &&
    welcome.childNodes[0].text === "Line one." &&
    welcome.childNodes[1].tagName === "BR" &&
    welcome.childNodes[2].text === "Line two.");
  check("...and caches the admin's default theme for theme.js's own " +
    "picker pre-selection on a later load (0.9-M3-S32, #456: theme-" +
    "init.js no longer reads this key)",
    localStore._values.get("hgb-default-theme") === "daylight");

  check("cacheDefaultTheme accepts a name theme.js's own BG object " +
    "answers to",
    (function () {
      localStore._values.delete("hgb-default-theme");
      globalThis.BinderSiteContent.cacheDefaultTheme("contrast");
      return localStore._values.get("hgb-default-theme") === "contrast";
    })());
  // Both checks below SEED a real cached value first, rather than
  // deleting the key before calling cacheDefaultTheme() - a fix-wave
  // correction (#418 comment 5371848229, finding F1). The delete-first
  // shape made the old checks pass whether or not the function ever
  // removed anything, since the key was already gone before the call;
  // seeding a value the admin previously set is the only way to prove
  // the function actually CLEARS what a member already learned, not
  // just that it declines to write a new bad value over nothing.
  check("...and CLEARS a previously cached value when the admin's " +
    "config answers with a name no palette answers to - a corrupted " +
    "or future config value, the same discipline theme-init.js and " +
    "theme.js hold their OWN stored value to",
    (function () {
      localStore._values.set("hgb-default-theme", "midnight");
      globalThis.BinderSiteContent.cacheDefaultTheme("neon");
      return !localStore._values.has("hgb-default-theme");
    })());
  check("...and clears a previously cached value on \"\" too - S8's " +
    "contract for GET /config (#414, comment 5370945709) states an " +
    "empty string means the admin turned the default back OFF, so a " +
    "member who already learned a palette must stop painting it on " +
    "the next load, not keep painting it forever",
    (function () {
      localStore._values.set("hgb-default-theme", "midnight");
      globalThis.BinderSiteContent.cacheDefaultTheme("");
      return !localStore._values.has("hgb-default-theme");
    })());
}

{
  const localStore = localStorageStub();
  globalThis.localStorage = localStore;
  globalThis.BINDER_CONFIG = { endpoint: "https://worker.example" };

  const owners = [textElement("Hang Gang")];
  const names = [textElement("Binder")];
  const welcome = richElement("Sign in once for this tab.");
  const doc = siteContentDocumentStub(
    owners, names, welcome, "Sign in — Hang Gang Binder");
  globalThis.document = doc;

  // Unreachable, the same shape the door's own refusal test above gives
  // a dead network: fetch itself rejects rather than answering non-ok,
  // so the SAME code path config.js's absence would take is exercised
  // too (endpoint() returning nothing is covered by BINDER_CONFIG being
  // unset entirely, which load() also returns from early - both are
  // "the route is unreachable" as far as this file's fallback promise
  // is concerned).
  globalThis.fetch = async () => { throw new Error("network down"); };

  await import("data:text/javascript," +
    encodeURIComponent(siteContentSource) + "#site-content-dead-" +
    Math.random());

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  check("an unreachable /config leaves the wordmark exactly as shipped - " +
    "the static fallback is the markup itself, untouched",
    owners[0].textContent === "Hang Gang");
  check("...and the <title> untouched",
    doc.title === "Sign in — Hang Gang Binder");
  check("...and the welcome sentence untouched - no children added over " +
    "the shipped text",
    welcome.childNodes.length === 0);
  check("...and nothing cached for the next load",
    !localStore._values.has("hgb-default-theme"));
}

/* ------------------------------------------------------------------ */
/* 5. The fold (#454 item 14, owner ruling 2026-08-22): "the group's    */
/* name, the welcome sentence the admin wrote, and the Telegram sign-in */
/* button. Nothing else above the fold." A structural check, not a      */
/* geometry one - the real pixel measurement is a browser-time claim    */
/* this suite cannot make (AGENTS.md, "Verification": "a geometry claim */
/* needs geometry evidence from a real rendering engine"). What this    */
/* CAN prove from source: every piece of masthead/card copy besides the */
/* welcome sentence carries sr-only (paints nothing), and the welcome   */
/* sentence itself does not (it is one of the three named things).      */

check("the masthead's runner carries sr-only - real for a screen " +
  "reader, painting nothing at any width",
  /<p class="runner sr-only"><span>Members<\/span><\/p>/.test(indexSource));
check("...and the masthead's own <h1> too",
  /<h1 class="sr-only">Sign in<\/h1>/.test(indexSource));
check("the welcome sentence itself carries NO sr-only - it is one of " +
  "the three things the ruling names",
  !/id="welcome-text"[^>]*class="[^"]*sr-only/.test(indexSource) &&
  !/class="[^"]*sr-only[^"]*"[^>]*id="welcome-text"/.test(indexSource));
check("the sign-in card's own runner carries sr-only",
  /<p class="runner sr-only"><span>Telegram<\/span><\/p>/.test(indexSource));
check("...and its <h2>",
  /<h2 class="sr-only">Member sign-in<\/h2>/.test(indexSource));
check("...and its explanation paragraph",
  /<p class="sr-only">\s*Use the Telegram account this group knows you/
    .test(indexSource));

const themeCssSource = await read("../apps/web/theme.css");
check(".sr-only is defined as the real visually-hidden-but-accessible " +
  "shape, not `display:none` (which a screen reader also skips) and " +
  "not merely a class name with no rule behind it",
  /\.sr-only\s*\{[^}]*clip:\s*rect\(0,\s*0,\s*0,\s*0\)/.test(themeCssSource));

/*
 * The trim is minimal AT EVERY WIDTH, not phone-only (owner ruling
 * 2026-08-23, UX record #454 comment 5389445914, raised as F4 by the
 * #457 review). The shipped behavior was already this - `.sr-only`
 * carries no media query - and the ruling settled that it is the
 * intent rather than an overreach. This pins the CODE that makes it
 * true, so a later "fix" wrapping the rule in a width query has to
 * argue with a check rather than sail past one.
 */
check(".sr-only is not scoped to a width - the door is this minimal at " +
  "every size, and a media query around this rule would quietly " +
  "restore the desktop copy the ruling removed",
  /(^|\n)\.sr-only\s*\{/.test(themeCssSource));

/* ------------------------------------------------------------------ */
/* 6. The sign-out acknowledgement is a TOAST (owner ruling 2026-08-23, */
/* #454 comment 5389445914; #457 review, F2). Item 8 already sends the  */
/* result of an act to the shared toast, and a sign-out is an act -     */
/* so the ruled words move into that vehicle and the inline status      */
/* line goes, which is what makes item 14's fold hold in the return-    */
/* from-sign-out state as well as on a first arrival. The WORDS are     */
/* unchanged (#265/#275) and tools/check_web.py's RULED_TOAST_LINES     */
/* pins them; this suite pins the wiring around them.                   */

check("index.html no longer ships an inline #signed-out line - the " +
  "fourth thing that used to paint above the sign-in button on a " +
  "return from Sign out",
  !/id="signed-out"/.test(indexSource));
check("...and carries the shared #toast instead, the element " +
  "BinderUI.showToast() finds by id",
  /<p class="toast" id="toast" role="status" aria-live="polite" hidden>/
    .test(indexSource));
check("auth.js holds the owner's ruled words as one constant rather " +
  "than composing them at the call site",
  /const SIGNED_OUT_LINE = "Signed out\.";/.test(authSource));
check("...and hands that constant, and nothing read from storage or " +
  "the URL, to the toast",
  /showToast\(SIGNED_OUT_LINE\)/.test(authSource));
check("the mark is still the only trigger, and is still spent on " +
  "sight - a reload after a sign-out says nothing",
  /removeItem\(SIGNED_OUT_KEY\)/.test(authSource));

console.log(failures
  ? `\ndoor FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\ndoor ran ${performed} checks, expected ${EXPECTED}`
    : `\ndoor OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
