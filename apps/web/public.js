/*
 * The public dashboard. The only page here that needs nothing to work.
 *
 * No key, no token, no login: it fetches one published aggregate and
 * hands it to dashboard.js, which is the same function that drew the
 * charts on admin.html. That is the whole design of this page - there
 * is no second implementation of the charts, and no way for the public
 * numbers to disagree with the keyholder's, because one produced the
 * other.
 *
 * It also has no decryption, deliberately. crypto.js is not loaded
 * here, so no amount of confusion about what this page is for can turn
 * it into something that opens submissions.
 *
 * All wiring, no pure half. Everything worth testing about a snapshot
 * lives in dashboard.js and is tested there; what is left is fetching
 * one file and reporting when that fails.
 */
(function (root) {
  "use strict";

  if (typeof document === "undefined") return;

  function $(id) {
    return document.getElementById(id);
  }

  function show(element, visible) {
    if (element) element.hidden = !visible;
  }

  /* Same guard as the other pages: a throw during setup leaves a page
   * that looks fine and does nothing, which is worse than a page that
   * says it is broken. */
  document.addEventListener("DOMContentLoaded", function () {
    setUp().catch(function (error) {
      show($("tool"), false);
      const closed = $("closed");
      show(closed, true);
      if (closed) {
        closed.querySelector("[data-reason]").textContent =
          "This page did not start up correctly, so there is nothing to " +
          "show. " + (error && error.message ? "(" + error.message + ")" : "");
      }
    });
  });

  function unavailable(reason) {
    show($("tool"), false);
    show($("closed"), true);
    $("closed").querySelector("[data-reason]").textContent = reason;
  }

  /*
   * How old the figures are, in the words someone would use.
   *
   * The exact timestamp is there too, because "3 days ago" is friendly
   * and useless for deciding whether a scheduled refresh has stopped.
   */
  function ageText(generated, now) {
    const at = Date.parse(generated);
    if (!Number.isFinite(at)) return "Published at an unknown time.";

    const minutes = Math.floor((now - at) / 60000);
    let phrase;
    if (minutes < 2) phrase = "just now";
    else if (minutes < 60) phrase = minutes + " minutes ago";
    else if (minutes < 120) phrase = "an hour ago";
    else if (minutes < 48 * 60) phrase = Math.floor(minutes / 60) + " hours ago";
    else phrase = Math.floor(minutes / (60 * 24)) + " days ago";

    return "Figures worked out " + phrase + " (" +
      new Date(at).toISOString().replace("T", " ").slice(0, 16) + " UTC).";
  }

  /* Stale enough to say so out loud. Two days is a judgement, not a
   * fact: it is long enough that a daily refresh has plainly missed
   * one, and short enough that nobody reads month-old numbers as
   * current. */
  const STALE_AFTER_HOURS = 48;

  async function setUp() {
    const config = root.BINDER_CONFIG || {};
    if (!config.endpoint) {
      unavailable("This site has no endpoint configured, so there is " +
        "nothing to read a dashboard from.");
      return;
    }

    let payload;
    try {
      const response = await fetch(config.endpoint + "/snapshot");
      if (response.status === 404) {
        unavailable("No figures have been published yet. This fills in the " +
          "first time the keyholder publishes a snapshot.");
        return;
      }
      if (!response.ok) {
        throw new Error("The server answered " + response.status + ".");
      }
      payload = await response.json();
    } catch (error) {
      unavailable("The figures could not be fetched. " +
        (error && error.message ? error.message : "The connection failed.") +
        " Try again shortly.");
      return;
    }

    const snapshot = payload && payload.snapshot;
    if (!snapshot || !snapshot.bases) {
      unavailable("What came back is not a dashboard this page can draw. " +
        "It may have been published by a newer version of the site.");
      return;
    }

    const now = Date.now();
    $("status").textContent = snapshot.counts.entries + " entries from " +
      snapshot.counts.people + " people.";
    $("freshness").textContent = ageText(snapshot.generated, now);

    const age = (now - Date.parse(snapshot.generated)) / 3600000;
    if (Number.isFinite(age) && age > STALE_AFTER_HOURS) {
      $("status").className = "status bad";
      $("freshness").textContent +=
        " That is older than these are meant to be, so treat them as out " +
        "of date.";
    }

    function currentValue(name, fallback) {
      const chosen = Array.prototype.slice
        .call(document.querySelectorAll('input[name="' + name + '"]'))
        .filter(function (input) { return input.checked; })[0];
      return chosen ? chosen.value : fallback;
    }

    function draw() {
      root.BinderDashboard.render(
        $("charts"), snapshot,
        currentValue("basis", "people"),
        currentValue("units", root.BinderDashboard.DEFAULT_UNITS));
    }

    Array.prototype.forEach.call(
      document.querySelectorAll('input[name="basis"], input[name="units"]'),
      function (input) { input.addEventListener("change", draw); });

    show($("tool"), true);
    draw();
  }
})(globalThis);
