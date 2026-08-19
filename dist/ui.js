

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
