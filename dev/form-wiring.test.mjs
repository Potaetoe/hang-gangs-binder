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
    async dispatch(type) {
      const event = { type, target: document, currentTarget: document };
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
  const bootErrors = [];

  globalThis.document = page.document;
  globalThis.BINDER_CONFIG = {
    endpoint: "https://worker.example",
    publicKey: "BL4L1Ap1ZybmyIfJ8wJuaV1hUMtTmtMP",
  };
  globalThis.BinderSession = {
    read() { return MEMBER; },
    require() { return MEMBER; },
    authorization() { return { Authorization: "Bearer token" }; },
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
    return original(event);
  };

  // A fresh module instance per scenario, so listeners never leak between
  // them - the same reason dev/submit.test.mjs re-imports with a query.
  await import("data:text/javascript," +
    encodeURIComponent(formSource) + "#" + Math.random());

  return { page, dispatched, bootErrors };
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

console.log(failures === 0
  ? "\nform wiring: all checks passed"
  : "\nform wiring: " + failures + " check(s) FAILED");
process.exit(failures === 0 ? 0 : 1);
