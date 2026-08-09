

(function (root) {
  "use strict";

  

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
