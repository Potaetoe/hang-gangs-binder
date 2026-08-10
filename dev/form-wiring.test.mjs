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
 * path back; once your-page.html grew tabs, "Weigh in" leads to that card and no
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
  new URL("../apps/web/your-page.html", import.meta.url), "utf8");

/*
 * The two modules the seal really runs through, read as bytes because
 * section 9 loads them instead of stubbing them. Everything above that
 * section keeps the small stub: those arms are about the form's
 * behavior around a seal, and a real one would make each of them wait
 * on WebCrypto for nothing.
 */
const cryptoSource = await readFile(
  new URL("../apps/web/crypto.js", import.meta.url), "utf8");
const memberKeySource = await readFile(
  new URL("../apps/web/memberkey.js", import.meta.url), "utf8");

/*
 * The keyholder's stand-in - throwaway, committed on purpose, opening
 * nothing real. dev/crypto.test.mjs reads the same file, and the
 * member's half is deliberately NOT read from its neighbour here: a
 * member key is generated inside the browser and is non-extractable, so
 * the only honest source for one is memberkey.js itself, which is what
 * section 9 makes it.
 */
const keyFile = JSON.parse(await readFile(
  new URL("test-key.json", import.meta.url), "utf8"));

/*
 * The Worker's entire opinion about a submission's bytes, read off the
 * Worker rather than restated here.
 *
 * This suite guards a client file, so a limit written down in this file
 * would be a limit that agrees with itself - AGENTS.md's review bar
 * names that exact shape ("something outside the file has to say what
 * it may contain"). The envelope the form writes has to survive the
 * route that already accepts what it writes today, and the only things
 * that route asks are the size cap and the alphabet. Extracted, so a
 * narrowing of either reddens section 9 instead of being remembered.
 */
const workerSource = await readFile(
  new URL("../server/worker.js", import.meta.url), "utf8");
const MAX_CIPHERTEXT =
  /const MAX_CIPHERTEXT = (\d+) \* (\d+);/.exec(workerSource).slice(1)
    .reduce((a, b) => Number(a) * Number(b));
// The alphabet the route tests the field against, taken whole. Written
// out here it would be a fourth copy of a pattern that already exists in
// the Worker, in crypto.js's header and in dev/crypto.test.mjs.
const WORKER_BASE64 = new RegExp(
  /if \(!\/(\^.+\$)\/\.test\(ciphertext\)\)/.exec(workerSource)[1]);

const SUBMITTED_EVENT = "binder:submitted";
const ADD_ENTRY_SHOWN_EVENT = "binder:add-entry-shown";
const HEIGHT_BASELINE_EVENT = "binder:height-baseline";
const ACCOUNT_EVENT = "binder:account";

// 64 lower-case hex, which is the only shape memberkey.js will file a
// record under - anything else is refused before it can select one.
const ACCOUNT = "a".repeat(64);

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

/* ------------------------------------------------------------------ */
/* A database for section 9, and what it is and is not standing in for. */

/*
 * dev/memberkey.test.mjs refuses to invent an IndexedDB, and it is right
 * to: the claim it makes is about the STORAGE - its own database, keyed
 * per account, erased rather than adopted - and a fake store would prove
 * a fake store works.
 *
 * The claim here is the opposite one. Section 9 asks whether the bytes
 * the form puts on the wire can be opened by the member who wrote them,
 * and every part of that is real: form.js's own submit handler,
 * crypto.js's `encryptTo`, WebCrypto's P-256 and AES-GCM, and a private
 * half that memberkey.js generated non-extractable and never let out.
 * The store is the one thing in that sentence that is scaffolding, so it
 * is the one thing stubbed - and it is stubbed at the browser's own API
 * rather than at memberkey.js's, so `ensure` runs its real bytes:
 * `generateKey` with `extractable: false`, `exportKey` for the 65-byte
 * point, `custodyVerdict` over what comes back, `put` under the key
 * path.
 *
 * What it does NOT reproduce, said plainly rather than left to be
 * discovered: a real store structure-clones what it is handed, and this
 * one keeps the reference. That difference cannot reach the seal - a
 * cloned CryptoKey and the original derive identically, which is the
 * property the whole design rests on - but it is why the round trip
 * through a real IndexedDB stays a browser claim, made in Chrome, and
 * not one this file may make.
 */
function makeIndexedDb() {
  const rows = new Map();     // database -> store -> Map(key, record)
  const paths = new Map();    // database -> store -> key path

  // Asynchronous, because the shipped file attaches its handlers after
  // the call returns. A stub that answered synchronously would run every
  // callback against a request nobody had wired up yet.
  function settle(produce) {
    const request = {};
    queueMicrotask(function () {
      try {
        request.result = produce();
        if (request.onsuccess) request.onsuccess();
      } catch (error) {
        request.error = error;
        if (request.onerror) request.onerror();
      }
    });
    return request;
  }

  function store(database, name) {
    const table = rows.get(database).get(name);
    const path = paths.get(database).get(name);
    return {
      get(key) {
        return settle(() => (table.has(key) ? table.get(key) : undefined));
      },
      // The key comes out of the record, exactly as an object store with
      // a keyPath does - which is the #56 property memberkey.js stands
      // on, so a stub that took the key as an argument would quietly
      // test a different store.
      put(record) {
        return settle(() => {
          table.set(record[path], record);
          return record[path];
        });
      },
      clear() { return settle(() => { table.clear(); return undefined; }); },
    };
  }

  return {
    open(database) {
      const fresh = !rows.has(database);
      if (fresh) {
        rows.set(database, new Map());
        paths.set(database, new Map());
      }
      const request = {};
      request.result = {
        close() {},
        // The store name arrives twice - once naming the transaction's
        // scope and once selecting within it - and this stub enforces no
        // scope, so the first is taken and dropped.
        transaction(_scope) {
          return { objectStore(which) { return store(database, which); } };
        },
        createObjectStore(name, options) {
          rows.get(database).set(name, new Map());
          paths.get(database).set(name, options.keyPath);
        },
      };
      queueMicrotask(function () {
        if (fresh && request.onupgradeneeded) request.onupgradeneeded();
        if (request.onsuccess) request.onsuccess();
      });
      return request;
    },
    deleteDatabase(database) {
      const request = {};
      queueMicrotask(function () {
        rows.delete(database);
        paths.delete(database);
        if (request.onsuccess) request.onsuccess();
      });
      return request;
    },
  };
}

function bytesOf(base64) {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const MEMBER = {
  session: "token", expiresAt: "2099-01-02T03:04:05.000Z",
  username: "member", isAdmin: false, isDev: false, telegramId: "10",
};

globalThis.CustomEvent = class CustomEvent {
  constructor(type, init) { this.type = type; this.detail = init && init.detail; }
};

let realLoads = 0;

async function loadForm({ submitStatus = 200, real = false,
  keyless = false } = {}) {
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
    // The real key only under `real`. The short string below is not a
    // point at all, which is the honest thing for a scenario whose
    // crypto is a stub: a scenario that carried a real key while
    // encrypting with a stub would look like it had proved something.
    publicKey: real ? keyFile.publicKey : "BL4L1Ap1ZybmyIfJ8wJuaV1hUMtTmtMP",
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
  /*
   * Either the small stub, or the two shipped modules themselves.
   *
   * Loaded here rather than once at the top because both assign a frozen
   * global and every scenario needs its own: memberkey.js hands back
   * whatever is in the database it can see, and a key generated for one
   * scenario turning up in the next would make an arm about a fresh
   * browser pass on a stale key.
   */
  delete globalThis.BinderMemberKey;
  if (real) {
    realLoads++;
    // The store is installed BEFORE the module, and removed for the
    // keyless scenario, because memberkey.js asks for `indexedDB` at
    // call time - which is what lets a browser that keeps no database
    // answer null rather than throw.
    globalThis.indexedDB = keyless ? undefined : makeIndexedDb();
    await import("data:text/javascript," + encodeURIComponent(cryptoSource) +
      "#real-crypto-" + realLoads);
    await import("data:text/javascript," +
      encodeURIComponent(memberKeySource) + "#real-memberkey-" + realLoads);
  } else {
    delete globalThis.indexedDB;
    globalThis.BinderCrypto = {
      unavailableReason() { return null; },
      async encrypt() { return "AQIDBA=="; },
    };
  }
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
  // The body as well as the fact of the request - #85. What the form
  // seals is only checkable from what it actually sent, and a stub that
  // discarded the body is how a seal half can go missing with every arm
  // in this file green.
  const posted = [];
  globalThis.fetch = async function (url, options) {
    posted.push({ url, options: options || {} });
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

  return { page, dispatched, events, bootErrors, cleared, posted };
}

// The one field the Worker is handed, out of the request the form really
// made. Reading it back through JSON.parse rather than a substring is
// deliberate: the body is what the endpoint parses, so anything this
// cannot get out of it is something the Worker could not either.
/*
 * What was put on the wire, or the empty string because nothing was.
 *
 * A submission that never happened is the exact failure the fail-open
 * arms exist to catch, so it has to arrive as a check that says "no" -
 * not as a subscript on undefined that takes the rest of the file with
 * it and names none of what it took. Reading the field back through
 * JSON.parse rather than a substring is the same discipline: the body is
 * what the endpoint parses, so anything this cannot get out of it is
 * something the Worker could not either.
 */
function sealedBy({ posted }) {
  if (!posted.length) return "";
  return JSON.parse(posted[0].options.body).ciphertext;
}

/*
 * A row opened, or null because it would not open.
 *
 * crypto.js throws on a refusal, which is right for a page that has to
 * say why - and wrong for an arm whose whole question is whether a
 * given key opens a given row. Unwrapped, "the member cannot open their
 * own entry" arrives as an unhandled rejection that takes every arm
 * after it down and names none of them, which is a worse report than
 * the failure it is reporting.
 */
async function openedWith(blob, key) {
  try {
    return await globalThis.BinderCrypto.decrypt(blob, key);
  } catch (error) {
    return null;
  }
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

  check("returning to Weigh in shows the form again",
    page.byId("submission").hidden === false);
  check("returning to Weigh in hides the confirmation",
    page.byId("done").hidden === true);
  check("returning to Weigh in explains that a repeat is kept",
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

  check("your-page.html carries the repeat note",
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

  check("your-page.html carries the note about what was carried forward",
    submitHtml.includes('id="prefill-note"'));
  check("the prefill note ships hidden, for a device with nothing to say",
    /id="prefill-note"[^>]*hidden/.test(submitHtml));
  const prefillCopy = flat.match(/id="prefill-note"[^>]*>(.*?)<\/p>/);
  check("the note says this browser remembers, not the account",
    /this browser/i.test(prefillCopy ? prefillCopy[1] : "") &&
    !/your account remembers/i.test(prefillCopy ? prefillCopy[1] : ""));
  check("and says signing out erases it",
    /sign(ing)? out/i.test(prefillCopy ? prefillCopy[1] : ""));

  check("your-page.html carries the line explaining a remembered 18+",
    submitHtml.includes('id="over18-remembered"'));
  check("the 18+ line ships hidden, so an unremembered box explains nothing",
    /id="over18-remembered"[^>]*hidden/.test(submitHtml));
  check("the 18+ box itself still ships unticked",
    /id="over18"(?![^>]*checked)/.test(submitHtml));
}

/* ------------------------------------------------------------------ */
/* 9. THE SEAL, driven end to end - #85's personal arm.                 */

/*
 * WHY THIS SECTION EXISTS, and why nothing above it could have caught
 * what it caught.
 *
 * The member's half of #85 shipped as two halves that never met. One
 * side generates a device key and offers to open rows with it; the other
 * side seals entries. Every suite covering either side was green, and
 * `encryptTo` had no caller anywhere in the published tree - so every
 * member's pane reported nothing openable, forever, under a sentence
 * blaming rows for predating a feature that had in fact never started.
 *
 * BOTH SIDES WERE DOUBLES, which is the actual defect in the coverage.
 * dev/submit.test.mjs stubs `decrypt`, so its "opened" rows open because
 * the stub says they do; the demo serves fixture rows, so its history
 * fills from bytes no form ever wrote. Two suites can agree perfectly
 * about a round trip neither of them performs. Nothing short of running
 * the real seal into the real opener closes that, so that is what this
 * section does: form.js's own submit handler, crypto.js's own
 * `encryptTo`, and a private half memberkey.js generated and never let
 * out of the browser.
 *
 * The record is not written here either - it is whatever buildRecord
 * made out of the boxes filled in above, which is the thing a member
 * would actually get back.
 */

{
  const scenario = await loadForm({ real: true });
  await scenario.page.document.dispatch(ACCOUNT_EVENT, { accountId: ACCOUNT });
  fillValidEntry(scenario.page.byId);
  await scenario.page.byId("submission").dispatch("submit");

  const blob = sealedBy(scenario);
  const bytes = bytesOf(blob);

  check("a member whose browser holds a key seals to two recipients",
    bytes[0] === 2 && bytes[1] === 2);

  /*
   * The keyholder first, because this is the half that must not have
   * been traded away. A change that sealed only to the member would open
   * here for the member and leave the export unreadable - discovered on
   * export day, over every row written in between.
   */
  const forKeyholder = await openedWith(blob, keyFile);
  check("and the keyholder opens it, which is the half that cannot be lost",
    Boolean(forKeyholder) && forKeyholder.telegram === "member" &&
    forKeyholder.weight.lb === 200 &&
    forKeyholder.height.feet === 5 && forKeyholder.height.inches === 10);

  /*
   * And the member, through the same store the page would use. `ensure`
   * is asked again rather than being remembered from the seal: what has
   * to be true is that the key a later visit finds opens what an earlier
   * one wrote, which is the whole of what the personal pane does.
   */
  const key = await globalThis.BinderMemberKey.ensure(ACCOUNT);
  const forMember = await openedWith(blob, key.privateKey);
  check("and the member's own device key opens it too - the half that was missing",
    Boolean(forMember) && forMember.telegram === "member" &&
    forMember.weight.lb === 200 &&
    JSON.stringify(forMember) === JSON.stringify(forKeyholder));

  check("the key that opened it is one nothing can read out of the browser",
    key.privateKey.extractable === false && key.privateKey.type === "private");

  /*
   * MANDATE 4, from this side. The Worker was proved to have no branch
   * on a row's contents; what is left to show is that the wider envelope
   * is not distinguishable by being REFUSED - a row the endpoint would
   * turn away is told apart from one it accepts by the most visible
   * signal there is. Both limits come off the Worker's own source above.
   */
  check("the wider envelope is one the endpoint carries verbatim",
    WORKER_BASE64.test(blob) && blob.length <= MAX_CIPHERTEXT);
}

/*
 * 9b. THE FAIL-OPEN DIRECTION, and it is three separate browsers rather
 *     than one, because they fail for three different reasons and a
 *     guard written for one of them can miss the others entirely.
 *
 *     Every one of them must submit exactly as the site did before this
 *     existed: a member is never blocked from recording an entry because
 *     a convenience key was unavailable. What they lose is breadth.
 */

{
  // The page has not heard from /me yet, so there is no account to ask
  // for a key under - the state every first paint passes through.
  const scenario = await loadForm({ real: true });
  fillValidEntry(scenario.page.byId);
  await scenario.page.byId("submission").dispatch("submit");

  const blob = sealedBy(scenario);
  check("with no account known the entry seals to the keyholder alone",
    bytesOf(blob)[0] === 1);
  check("and that entry is still stored, exactly as it was before #85",
    scenario.page.byId("done").hidden === false &&
    scenario.dispatched.includes(SUBMITTED_EVENT));
  const opened = await openedWith(blob, keyFile);
  check("and the keyholder opens it", opened.telegram === "member");
}

{
  // A browser that keeps no database: private browsing, storage blocked,
  // or one that simply has no IndexedDB. `ensure` answers null and the
  // form must treat that as an ordinary Tuesday.
  const scenario = await loadForm({ real: true, keyless: true });
  await scenario.page.document.dispatch(ACCOUNT_EVENT, { accountId: ACCOUNT });
  fillValidEntry(scenario.page.byId);
  await scenario.page.byId("submission").dispatch("submit");

  const blob = sealedBy(scenario);
  check("a browser that can keep no key of its own still submits",
    scenario.page.byId("done").hidden === false &&
    scenario.dispatched.includes(SUBMITTED_EVENT));
  check("and what it submits is the single-recipient row it always was",
    bytesOf(blob)[0] === 1);
  const opened = await openedWith(blob, keyFile);
  check("which the keyholder opens", opened.telegram === "member");
}

{
  // The module absent altogether - a page that failed to load it, and
  // the state form.js would be in on any page that does not ship it.
  const scenario = await loadForm({ real: true });
  delete globalThis.BinderMemberKey;
  await scenario.page.document.dispatch(ACCOUNT_EVENT, { accountId: ACCOUNT });
  fillValidEntry(scenario.page.byId);
  await scenario.page.byId("submission").dispatch("submit");

  check("a page with no member-key module submits a single-recipient row",
    bytesOf(sealedBy(scenario))[0] === 1 &&
    scenario.page.byId("done").hidden === false);
}

/*
 * 9c. The control that stops 9b passing on a form that gave up sealing
 *     widely altogether. Without it, every arm above is satisfied by a
 *     file that never calls `encryptTo` at all - which is precisely the
 *     state this section was written to end.
 */
{
  const scenario = await loadForm({ real: true });
  await scenario.page.document.dispatch(ACCOUNT_EVENT, { accountId: ACCOUNT });
  fillValidEntry(scenario.page.byId);
  await scenario.page.byId("submission").dispatch("submit");
  check("and the wide seal is what an account plus a database produces",
    bytesOf(sealedBy(scenario))[0] === 2);
}

/*
 * 9d. An account id the store will not file under. memberkey.js refuses
 *     anything that is not 64 hex characters, and the form has to read
 *     that refusal as "no key" rather than as an error worth stopping a
 *     submission for - the same fail-open the three browsers above get.
 */
{
  const scenario = await loadForm({ real: true });
  await scenario.page.document.dispatch(ACCOUNT_EVENT,
    { accountId: "not-an-account-id" });
  fillValidEntry(scenario.page.byId);
  await scenario.page.byId("submission").dispatch("submit");

  check("an account id the key store refuses costs breadth, not the entry",
    bytesOf(sealedBy(scenario))[0] === 1 &&
    scenario.page.byId("done").hidden === false);
}

/*
 * 9e. A crypto.js that does not carry `encryptTo` - the fifth browser,
 *     and the one the four above cannot reach because it is not the key
 *     that is missing but the function that would use it.
 *
 *     It is reachable by cache skew alone: no `_headers` file exists in
 *     this tree, so the two scripts are cached on the platform default
 *     and a browser can hold yesterday's crypto.js beside today's
 *     form.js. Every other way the second recipient goes missing is
 *     handled before a byte is encrypted; this one used to reach the
 *     call site as a TypeError, which turned a submission that had
 *     always worked into a blocked one - on the browsers that DO hold a
 *     device key, which is the wrong half of the population to fail.
 *
 *     The stale module is built by rebuilding the global from the real
 *     one rather than by deleting a member: crypto.js freezes its
 *     export, so a `delete` would throw here instead of modelling
 *     anything.
 */
{
  const scenario = await loadForm({ real: true });
  await scenario.page.document.dispatch(ACCOUNT_EVENT, { accountId: ACCOUNT });
  const current = globalThis.BinderCrypto;
  globalThis.BinderCrypto = Object.freeze({
    unavailableReason: current.unavailableReason,
    encrypt: current.encrypt,
  });
  fillValidEntry(scenario.page.byId);
  await scenario.page.byId("submission").dispatch("submit");
  globalThis.BinderCrypto = current;

  check("a crypto.js with no encryptTo costs breadth, not the entry",
    bytesOf(sealedBy(scenario))[0] === 1 &&
    scenario.page.byId("done").hidden === false &&
    scenario.dispatched.includes(SUBMITTED_EVENT));
}

console.log(failures === 0
  ? "\nform wiring: all checks passed"
  : "\nform wiring: " + failures + " check(s) FAILED");
process.exit(failures === 0 ? 0 : 1);
