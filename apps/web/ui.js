/*
 * Small DOM operations shared by the pages in this directory.
 *
 * This file owns wiring only. Page-specific behavior stays in the page's
 * script, where its security boundary remains visible and checkable.
 */
(function (root) {
  "use strict";

  function byId(id) {
    return document.getElementById(id);
  }

  function show(element, visible) {
    if (element) element.hidden = !visible;
  }

  function checkedValue(name, fallback, scope) {
    const owner = scope || document;
    const inputs = Array.prototype.slice.call(
      owner.querySelectorAll('input[name="' + name + '"]'));
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
    checkedValue,
    setStatus,
    boot,
  });
})(globalThis);
