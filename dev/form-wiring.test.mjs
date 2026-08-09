/*
 * Contract checks for the WIRING half of apps/web/form.js.
 *
 *     node dev/form-wiring.test.mjs
 *
 * dev/form.test.mjs covers the pure half - the conversions, the validation,
 * the record. It cannot cover this half at all, and says so: form.js returns
 * before touching the DOM when there is no document, which is exactly what
 * lets that file load the real module under Node.
 *
 * SO THE WIRING HAS NEVER BEEN TESTED, and #64 is what that cost. The
 * submit handler replaced the form with a confirmation card one way, with no
 * path back; once submit.html grew tabs, "New entry" leads to that card and no
 * form, recoverable only by reloading - while the card's own text said "just
 * fill the form again". Every existing suite passed throughout, because
 * dev/submit.test.mjs asserts the panes and this lives one level down inside
 * a pane.
 *
 * A source grep would have been the wrong fix. tools/check_web.py had the
 * same shape of gap (#34): rules exercised by mutation while the code that
 * had to reach them was never run. This file runs the shipped module.
 *
 * The stubs are deliberately small - just enough DOM for setUp to complete,
 * so its listeners are registered and can be driven.
 */
import { readFile } from "node:fs/promises";

const formSource = await readFile(
  new URL("../apps/web/form.js", import.meta.url), "utf8");
const submitHtml = await readFile(
  new URL("../apps/web/submit.html", import.meta.url), "utf8");

const SUBMITTED_EVENT = "binder:submitted";
const ADD_ENTRY_SHOWN_EVENT = "binder:add-entry-shown";
const HEIGHT_BASELINE_EVENT = "binder:height-baseline";

let failures = 0;
function check(label, condition) {
  if (!condition) failures++;
  console.log(condition ? "pass " : "FAIL ", label);
}

/* ------------------------------------------------------------------ */
/* The smallest DOM that lets setUp finish.                            */

function makeElement(id) {
  const listeners = new Map();
  return {
    id,
    hidden: false,
    textContent: "",
    value: "",
    checked: false,
    disabled: false,
    className: "",
    children: [],
    addEventListener(type, listener) {
      const handlers = listeners.get(type) || [];
      handlers.push(listener);
      listeners.set(type, handlers);
    },
    async dispatch(type) {
      const event = { type, target: this, currentTarget: this,
        preventDefault() {} };
      for (const listener of listeners.get(type) || []) {
        await listener.call(this, event);
      }
    },
    appendChild(child) { this.children.push(child); return child; },
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    querySelector() { return makeElement("data-reason"); },
    scrollIntoView() {},
    getClientRects() { return this.hidden ? [] : [{}]; },
  };
}

function makePage() {
  // Auto-vivifying, so an id this harness has not thought of - an error slot,
  // a field wrapper - does not fail the setup for a reason the test is not
  // about. Every element the assertions name is fetched through here too, so
  // they are reading the same objects form.js wrote to.
  const elements = new Map();
  const byId = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  };

  // These three ship with the `hidden` attribute, so the harness has to
  // start them hidden or every assertion about them measures the stub
  // rather than the module. That the page really does ship them that way is
  // asserted separately at the bottom of this file, against the HTML - the
  // seeding here must not be the only thing claiming it.
  ["done", "repeat-note", "closed"].forEach((id) => { byId(id).hidden = true; });

  const imperialRadio = byId("units-imperial");
  imperialRadio.value = "imperial";
  imperialRadio.checked = true;
  const metricRadio = byId("units-metric");
  metricRadio.value = "metric";

  const documentListeners = new Map();
  const document = {
    readyState: "complete",
    getElementById(id) { return byId(id); },
    createElement(tag) { return makeElement("created-" + tag); },
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === 'input[name="units"]') {
        return [imperialRadio, metricRadio];
      }
      // roles:checked and the data-field lookups are legitimately empty here
      return [];
    },
    addEventListener(type, listener) {
      const handlers = documentListeners.get(type) || [];
      handlers.push(listener);
      documentListeners.set(type, handlers);
    },
    dispatchEvent(event) {
      const handlers = documentListeners.get(event.type) || [];
      for (const listener of handlers) listener.call(document, event);
      return true;
    },
    async dispatch(type, detail) {
      const event = { type, detail, target: document,
        currentTarget: document };
      for (const listener of documentListeners.get(type) || []) {
        await listener.call(document, event);
      }
    },
  };
  return { document, byId, elements };
}

const MEMBER = {
  session: "token", expiresAt: "2099-01-02T03:04:05.000Z",
  username: "member", isAdmin: false, isDev: false, telegramId: "10",
};

globalThis.CustomEvent = class CustomEvent {
  constructor(type, init) { this.type = type; this.detail = init && init.detail; }
};

async function loadForm({ submitStatus = 200 } = {}) {
  const page = makePage();
  const dispatched = [];
  // The whole event as well as its type. The panel remembers the height
  // this page just had accepted, and it can only learn it from the
  // announcement - so what rides on the announcement is part of the
  // contract, not an implementation detail of the dispatch.
  const events = [];
  const bootErrors = [];

  globalThis.document = page.document;
  globalThis.BINDER_CONFIG = {
    endpoint: "https://worker.example",
    publicKey: "BL4L1Ap1ZybmyIfJ8wJuaV1hUMtTmtMP",
  };
  // Counted rather than ignored - #166. Dropping the credential the Worker
  // has just refused is half of what this page owes a member whose session
  // died mid-entry; the other half is the sentence, and a stub with no
  // clear() would let a fix that only writes the sentence pass.
  const cleared = [];
  globalThis.BinderSession = {
    read() { return MEMBER; },
    require() { return MEMBER; },
    authorization() { return { Authorization: "Bearer token" }; },
    clear() { cleared.push(true); },
  };
  globalThis.BinderCrypto = {
    unavailableReason() { return null; },
    async encrypt() { return "AQIDBA=="; },
  };
  globalThis.BinderUI = {
    byId(id) { return page.byId(id); },
    show(element, visible) { if (element) element.hidden = !visible; },
    showFingerprint() {},
    checkedValue(name, fallback) {
      if (name !== "units") return fallback;
      const chosen = page.document
        .querySelectorAll('input[name="units"]')
        .find((input) => input.checked);
      return chosen ? chosen.value : fallback;
    },
    setStatus(element, message) { if (element) element.textContent = message; },
    boot(setUp, failed) {
      try {
        const result = setUp();
        if (result && typeof result.then === "function") {
          result.catch((error) => { bootErrors.push(error); failed(error); });
        }
      } catch (error) { bootErrors.push(error); failed(error); }
    },
  };
  globalThis.fetch = async function () {
    return {
      ok: submitStatus >= 200 && submitStatus < 300,
      status: submitStatus,
      async json() { return { ok: true }; },
    };
  };

  const original = page.document.dispatchEvent.bind(page.document);
  page.document.dispatchEvent = function (event) {
    dispatched.push(event.type);
    events.push(event);
    return original(event);
  };

  // A fresh module instance per scenario, so listeners never leak between
  // them - the same reason dev/submit.test.mjs re-imports with a query.
  await import("data:text/javascript," +
    encodeURIComponent(formSource) + "#" + Math.random());

  return { page, dispatched, events, bootErrors, cleared };
}

function fillValidEntry(byId) {
  byId("over18").checked = true;
  byId("weight-lb").value = "200";
  byId("height-ft").value = "5";
  byId("height-in").value = "10";
  byId("gender").value = "";
  byId("country").value = "";
}

/* ------------------------------------------------------------------ */
/* 1. The page starts with the form up and both notices down.          */

{
  const { page, bootErrors } = await loadForm();
  check("setUp completes with no boot error",
    bootErrors.length === 0);
  check("the form is shown on a member session",
    page.byId("submission").hidden === false);
  check("the confirmation starts hidden",
    page.byId("done").hidden === true);
  check("the repeat note starts hidden",
    page.byId("repeat-note").hidden === true);
}

/* ------------------------------------------------------------------ */
/* 2. A stored submission still swaps the form for the confirmation.   */
/*    #64 must not have loosened this.                                 */

{
  const { page, dispatched } = await loadForm();
  fillValidEntry(page.byId);
  await page.byId("submission").dispatch("submit");

  check("a stored submission hides the form",
    page.byId("submission").hidden === true);
  check("a stored submission shows the confirmation",
    page.byId("done").hidden === false);
  check("a stored submission announces itself to the panel",
    dispatched.includes(SUBMITTED_EVENT));
  check("the repeat note is not shown by submitting alone",
    page.byId("repeat-note").hidden === true);
}

/* ------------------------------------------------------------------ */
/* 3. THE DEFECT. Returning to the tab brings the form back.           */

{
  const { page } = await loadForm();
  fillValidEntry(page.byId);
  await page.byId("submission").dispatch("submit");
  await page.document.dispatch(ADD_ENTRY_SHOWN_EVENT);

  check("returning to New entry shows the form again",
    page.byId("submission").hidden === false);
  check("returning to New entry hides the confirmation",
    page.byId("done").hidden === true);
  check("returning to New entry explains that a repeat is kept",
    page.byId("repeat-note").hidden === false);
}

/* ------------------------------------------------------------------ */
/* 4. A control. Without a submission the event changes nothing.       */
/*    Check 3 would also pass if the listener simply showed everything */
/*    unconditionally, which would put the note in front of a member   */
/*    who has submitted nothing.                                       */

{
  const { page } = await loadForm();
  await page.document.dispatch(ADD_ENTRY_SHOWN_EVENT);

  check("with nothing submitted the form is untouched",
    page.byId("submission").hidden === false);
  check("with nothing submitted the confirmation stays hidden",
    page.byId("done").hidden === true);
  check("with nothing submitted no repeat note appears",
    page.byId("repeat-note").hidden === true);
}

/* ------------------------------------------------------------------ */
/* 5. A refused submission leaves the form up, and the event does not  */
/*    invent a confirmation to dismiss.                                */

{
  const { page, dispatched } = await loadForm({ submitStatus: 401 });
  fillValidEntry(page.byId);
  await page.byId("submission").dispatch("submit");

  check("a refused submission leaves the form in place",
    page.byId("submission").hidden === false);
  check("a refused submission shows no confirmation",
    page.byId("done").hidden === true);
  check("a refused submission is not announced as stored",
    !dispatched.includes(SUBMITTED_EVENT));

  await page.document.dispatch(ADD_ENTRY_SHOWN_EVENT);
  check("after a refusal, returning shows no repeat note",
    page.byId("repeat-note").hidden === true);
}

/* ------------------------------------------------------------------ */
/* 5b. The refusal that is not about the entry at all - #166.          */

/*
 * A 401 here is not a bad submission, and until now it read as one. The
 * member was told "It was encrypted, but it could not be sent. The server
 * refused it (401). Nothing was stored - try again." Every clause of that
 * is either raw HTTP or advice that cannot work: trying again with the same
 * dead credential fails identically, forever, and the one thing that would
 * help is not mentioned.
 *
 * Driven through the shipped handler rather than grepped, because the fix
 * has to sit inside the send path ahead of the generic !response.ok throw,
 * and a source check cannot tell a branch that runs from one that is
 * shadowed by the line above it.
 */
{
  const { page, cleared } = await loadForm({ submitStatus: 401 });
  fillValidEntry(page.byId);
  await page.byId("submission").dispatch("submit");
  const said = page.byId("status").textContent;

  check("a send refused for a dead session names the sign-in, not the number",
    /no longer valid/i.test(said) && /sign in again/i.test(said) &&
    !/\b401\b/.test(said));
  check("and does not tell the member to try what cannot work",
    !/try again/i.test(said));
  check("and the credential the Worker just refused is dropped",
    cleared.length === 1);
}

/* ------------------------------------------------------------------ */
/* 6. The page carries the element, and the copy stays a reassurance.  */
/*    A caution here would suppress the repeat entries the published   */
/*    weight series is built out of - see #64.                         */

{
  // Collapsed, because the copy wraps across source lines and a raw
  // includes() would report a wording change that never happened.
  const flat = submitHtml.replace(/\s+/g, " ");

  check("submit.html carries the repeat note",
    submitHtml.includes('id="repeat-note"'));
  check("the repeat note ships hidden",
    /id="repeat-note"[^>]*hidden/.test(submitHtml));
  check("the confirmation ships hidden",
    /id="done"[^>]*hidden/.test(submitHtml));
  check("the note says the earlier entry is kept",
    /kept, not replaced/.test(flat));
  const noteCopy = flat.match(/id="repeat-note"[^>]*>(.*?)<\/p>/);
  check("the note is not phrased as a warning",
    !/\b(warning|careful|cannot|do not|error)\b/i.test(
      noteCopy ? noteCopy[1] : ""));
  check("the confirmation still promises the form can be filled again",
    flat.includes("just fill the form again"));
}

/* ------------------------------------------------------------------ */
/* 7. The height guard - #172. It lives here rather than in validate()  */
/*    because it is not a rule about the entry: it is a question about  */
/*    a number only this browser knows, and the answer to "are you      */
/*    sure" is a second press.                                          */

function setHeight(byId, feet, inches) {
  byId("height-ft").value = feet;
  byId("height-in").value = inches;
}

/* 7a. The fresh device. Nothing has been remembered here, so the entry
 *     that started #172 - 3 ft against a person who is 5 ft 9 - goes
 *     straight through. This is the bound the copy has to admit, and it
 *     is asserted rather than described: a guard that fired here would
 *     be inventing a comparison. */
{
  const { page, dispatched } = await loadForm();
  fillValidEntry(page.byId);
  setHeight(page.byId, "3", "0");
  await page.byId("submission").dispatch("submit");

  check("with nothing remembered an implausible height is sent on one press",
    dispatched.includes(SUBMITTED_EVENT) &&
    page.byId("submission").hidden === true);
  check("and no height notice is shown for a comparison that cannot be made",
    page.byId("error-height").hidden === true);
}

/* 7b. The same entry on a browser that remembers 175.3cm. */
{
  const { page, dispatched } = await loadForm();
  await page.document.dispatch(HEIGHT_BASELINE_EVENT, { lastHeightCm: 175.3 });
  fillValidEntry(page.byId);
  setHeight(page.byId, "3", "0");
  await page.byId("submission").dispatch("submit");

  check("a large height change stops the first press",
    !dispatched.includes(SUBMITTED_EVENT) &&
    page.byId("submission").hidden === false &&
    page.byId("done").hidden === true);
  check("and says so in the height field's own slot",
    page.byId("error-height").hidden === false &&
    page.byId("error-height").textContent.includes("5 ft 9 in") &&
    page.byId("error-height").textContent.includes("3 ft 0 in"));

  /* The second press. The point of a prompt rather than a refusal: the
   * remembered number may itself be the typo, and a member whose real
   * height the form will not accept has no way out of a hard block. */
  await page.byId("submission").dispatch("submit");
  check("pressing again sends the entry as typed",
    dispatched.includes(SUBMITTED_EVENT) &&
    page.byId("done").hidden === false);
}

/* 7c. The control that keeps 7b from passing on a guard that simply
 *     lets the second press through regardless. Changing the height to
 *     a different implausible value re-arms it - otherwise one confirm
 *     would license every later typo in the same sitting. */
{
  const { page, dispatched } = await loadForm();
  await page.document.dispatch(HEIGHT_BASELINE_EVENT, { lastHeightCm: 175.3 });
  fillValidEntry(page.byId);
  setHeight(page.byId, "3", "0");
  await page.byId("submission").dispatch("submit");
  setHeight(page.byId, "7", "6");
  await page.byId("submission").dispatch("submit");

  check("a different implausible height is asked about again",
    !dispatched.includes(SUBMITTED_EVENT) &&
    page.byId("error-height").hidden === false &&
    page.byId("error-height").textContent.includes("7 ft 6 in"));
}

/* 7d. A remembered height the entry agrees with never interrupts. Without
 *     this, 7b passes on a guard that fires on every entry. */
{
  const { page, dispatched } = await loadForm();
  await page.document.dispatch(HEIGHT_BASELINE_EVENT, { lastHeightCm: 177.8 });
  fillValidEntry(page.byId);
  await page.byId("submission").dispatch("submit");

  check("an entry that agrees with the remembered height is not interrupted",
    dispatched.includes(SUBMITTED_EVENT) &&
    page.byId("error-height").hidden === true);
}

/* 7e. The announcement the panel needs back. The panel cannot read the
 *     form's boxes - form.js owns them - so the height that was actually
 *     accepted rides on the event that says a row was stored. Without
 *     it the baseline never moves, and a member who corrects a typo is
 *     asked about the correction forever. */
{
  const { page, events } = await loadForm();
  fillValidEntry(page.byId);
  await page.byId("submission").dispatch("submit");

  const stored = events.find((event) => event.type === SUBMITTED_EVENT);
  check("the stored announcement carries the height that was accepted",
    Boolean(stored) && stored.detail &&
    stored.detail.heightCm === 177.8);
}

/* 7f. A refused send announces nothing, so it moves no baseline either.
 *     The same property check 5 holds for the confirmation card, on the
 *     value that decides what the next entry is measured against. */
{
  const { page, events } = await loadForm({ submitStatus: 401 });
  fillValidEntry(page.byId);
  await page.byId("submission").dispatch("submit");

  check("a refused send carries no height into the browser's memory",
    !events.some((event) => event.type === SUBMITTED_EVENT));
}

/* 7g. A baseline that arrives unusable is no baseline. The value crosses
 *     a document event from a JSON store, so "175.3" and NaN are both
 *     things that can turn up, and both would compare in a way that
 *     silently never fires. */
{
  const { page, dispatched } = await loadForm();
  await page.document.dispatch(HEIGHT_BASELINE_EVENT, { lastHeightCm: "175.3" });
  fillValidEntry(page.byId);
  setHeight(page.byId, "3", "0");
  await page.byId("submission").dispatch("submit");

  check("a remembered height that is not a number is treated as none",
    dispatched.includes(SUBMITTED_EVENT));
}

/* ------------------------------------------------------------------ */
/* 8. The copy that admits what this device does and does not know.    */

{
  const flat = submitHtml.replace(/\s+/g, " ");

  check("submit.html carries the note about what was carried forward",
    submitHtml.includes('id="prefill-note"'));
  check("the prefill note ships hidden, for a device with nothing to say",
    /id="prefill-note"[^>]*hidden/.test(submitHtml));
  const prefillCopy = flat.match(/id="prefill-note"[^>]*>(.*?)<\/p>/);
  check("the note says this browser remembers, not the account",
    /this browser/i.test(prefillCopy ? prefillCopy[1] : "") &&
    !/your account remembers/i.test(prefillCopy ? prefillCopy[1] : ""));
  check("and says signing out erases it",
    /sign(ing)? out/i.test(prefillCopy ? prefillCopy[1] : ""));

  check("submit.html carries the line explaining a remembered 18+",
    submitHtml.includes('id="over18-remembered"'));
  check("the 18+ line ships hidden, so an unremembered box explains nothing",
    /id="over18-remembered"[^>]*hidden/.test(submitHtml));
  check("the 18+ box itself still ships unticked",
    /id="over18"(?![^>]*checked)/.test(submitHtml));
}

console.log(failures === 0
  ? "\nform wiring: all checks passed"
  : "\nform wiring: " + failures + " check(s) FAILED");
process.exit(failures === 0 ? 0 : 1);
