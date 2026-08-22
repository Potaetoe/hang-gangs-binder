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
   * A ~150ms fade-in for an element that just stopped being `hidden`
   * (#454 item 4) - moved here from admin.js (0.9-M3-S30, #452) so
   * 0.9-M3-S33 can give the toast to every page without a second copy.
   * Adds `.fade-in` (opacity: 0, theme.css's --motion-duration token),
   * forces one reflow so the browser paints that value before the next
   * line removes the class, then lets the element's own
   * `transition: opacity var(--motion-duration)` (theme.css, shared by
   * every `[role="tabpanel"]`, `.card` and `.toast`) carry it back to
   * opaque. Skipped harmlessly where there is no layout engine to force
   * (the suites' Node DOM stub) - void discards whatever `offsetHeight`
   * reads there. The site's blanket prefers-reduced-motion rule collapses
   * the transition to nothing for a member who asked for that.
   */
  function fadeIn(element) {
    if (!element) return;
    element.className = (element.className ? element.className + " " : "") +
      "fade-in";
    void element.offsetHeight;
    element.className = element.className.replace(/\s*fade-in\b/, "");
  }

  /*
   * The one toast (#454 item 8), one element (#toast, present on every
   * page BinderUI loads on) and one function - lifted here from
   * admin.js's own first build (0.9-M3-S30, #452) so 0.9-M3-S33 can give
   * every page the same brief, self-dismissing confirmation instead of
   * an inline status line that reports the result of an action. Finds
   * the element by id rather than taking one as an argument: every
   * caller on every page means the same #toast, the same way setStatus's
   * callers each already know their own element by id.
   */
  let toastTimer = null;
  function showToast(message) {
    const toast = byId("toast");
    if (!toast) return;
    root.clearTimeout(toastTimer);
    toast.textContent = message;
    show(toast, true);
    fadeIn(toast);
    toastTimer = root.setTimeout(function () {
      show(toast, false);
    }, 3000);
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
    fadeIn,
    showToast,
    boot,
  });
})(globalThis);
