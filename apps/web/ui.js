/*
 * Small DOM operations shared by the pages in this directory.
 *
 * This file owns wiring only. Page-specific behavior stays in the page's
 * script, where its security boundary remains visible and checkable.
 */
(function (root) {
  "use strict";

  /*
   * The pinned anchor contains 32 base64 characters, so this length is a
   * security parameter rather than presentation. Base64 carries six bits
   * per character and every uncompressed P-256 point starts with 0x04; a
   * shorter prefix, especially below the 16-character floor, can be ground
   * out by generating keys until one matches.
   */
  const KEY_FINGERPRINT_LENGTH = 32;

  function byId(id) {
    return document.getElementById(id);
  }

  function show(element, visible) {
    if (element) element.hidden = !visible;
  }

  function showFingerprint(element, publicKey) {
    if (!element) return;
    if (typeof publicKey !== "string" || !publicKey) {
      element.textContent = "";
      element.hidden = true;
      return;
    }
    element.textContent = publicKey.slice(0, KEY_FINGERPRINT_LENGTH);
    element.hidden = false;
  }

  function checkedValue(name, fallback) {
    const inputs = Array.prototype.slice.call(
      document.querySelectorAll('input[name="' + name + '"]'));
    const chosen = inputs.filter(function (input) {
      return input.checked;
    })[0];
    return chosen ? chosen.value : fallback;
  }

  function setStatus(element, message, tone) {
    element.textContent = message || "";
    element.hidden = !message;
    element.className = "status" + (tone ? " " + tone : "");
  }

  /*
   * Setup failures must become visible. A thrown setup leaves an ordinary-
   * looking page whose controls do nothing; a rejected async setup has the
   * same failure mode with an extra turn through the event loop.
   */
  function boot(setUp, onError) {
    if (typeof document === "undefined") return;

    function run() {
      let result;
      try {
        result = setUp();
      } catch (error) {
        onError(error);
        return;
      }
      if (result && typeof result.then === "function") {
        result.catch(onError);
      }
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run, { once: true });
    } else {
      run();
    }
  }

  root.BinderUI = Object.freeze({
    byId,
    show,
    showFingerprint,
    checkedValue,
    setStatus,
    boot,
  });
})(globalThis);
