/*
 * Renders admin-set content over the page's own shipped defaults, from
 * the Worker's public GET /config (0.9-M3-S8, #414 §4; the door/title/
 * resting-theme ruling, 0.9-M3-S12, #418): the group's name wherever the
 * wordmark or a <title> carries it, and - on the door alone - the
 * welcome sentence under the "Sign in" heading.
 *
 * THE FALLBACK IS THE SHIPPED HTML, NOT A SECOND COPY OF IT. This file
 * holds no static values of its own to fall back to. What DESIGN wants
 * ("a fork with no admin edits looks exactly as today") is already true
 * of the markup before this file runs a single line: apps/web/site.
 * config.js's group.name is hand-kept in step with every page's wordmark
 * by tools/check_web.py's wordmark-parity arm (check 10), so the text
 * already on the page IS the fallback. When /config is unreachable, or
 * answers with nothing usable, this file changes nothing, and the page
 * is byte-for-byte what a visitor got before it existed.
 *
 * RENDER-ONLY. Every value from the server lands through textContent, or
 * through text nodes and <br> elements this file builds itself for the
 * one field that may carry a line break - never through innerHTML, and
 * never parsed as markup. A group name of "<img onerror=...>" becomes
 * the literal six-odd characters of that string on screen, not an
 * element.
 *
 * THE RESTING THEME'S PART OF THIS FETCH IS A CACHE WRITE, NEVER A
 * REPAINT, and - since the owner's ruling in UX record #454 item 15
 * (2026-08-22; 0.9-M3-S32, #456, superseding 0.9-M3-S12's #418 "admin
 * default from the second load" rule) - never a paint at all. A
 * member's resting palette is decided before first frame by
 * theme-init.js's own synchronous read of the phone's light/dark
 * scheme (blocking, in <head>) and confirmed the same way by theme.js
 * (classic, at the end of the body) - both of which run and finish
 * before this script's fetch can possibly resolve, since fetch is
 * never synchronous, and neither one reads this file's cache to decide
 * what paints any more. So this file only writes the value to
 * localStorage, for theme.js to read on the NEXT load - not to repaint
 * the page, but to decide which swatch the picker shows as pre-
 * selected for a member who has made no choice of their own. See
 * theme-init.js and theme.js for the read side.
 */
(function (root) {
  "use strict";

  // Matches theme-init.js's own copy and theme.js's BG keys. Duplicated
  // rather than shared through a global, for the reason theme-init.js's
  // own copy gives: none of these three files may depend on another
  // having already run.
  const VALID_PALETTES = ["midnight", "pink", "daylight", "contrast"];

  // The key theme.js reads for its picker (0.9-M3-S32, #456: theme-
  // init.js no longer reads this key at all). Named separately from
  // apps/web/theme.js's "hgb-palette" because the two answer different
  // questions: that key is a member's OWN choice and always wins; this
  // one is the admin's configured resting palette, consulted only to
  // pre-select a swatch when the member has made no choice of their
  // own - never to decide what paints.
  const DEFAULT_THEME_KEY = "hgb-default-theme";

  function endpoint() {
    const config = root.BINDER_CONFIG || {};
    return config.endpoint || null;
  }

  /*
   * The group's name, wherever it renders: every .wordmark-owner span
   * (the door's own copy, and the rail's on every page that carries one)
   * and the tab title. Both are derived from what is ALREADY on the page
   * rather than from a second stored copy of "Binder" or the old name -
   * so this keeps working exactly as written if a later slice changes
   * the shipped wordmark text, the site's own title format, or which
   * pages carry a rail.
   */
  function renderGroupName(name) {
    if (typeof name !== "string" || !name) return;
    const owners = document.querySelectorAll(".wordmark-owner");
    if (!owners.length) return; // a page with no wordmark has nothing to do

    const oldName = owners[0].textContent;
    if (oldName === name) return; // already this value; touch nothing

    const nameEls = document.querySelectorAll(".wordmark-name");
    const suffix = nameEls.length ? nameEls[0].textContent : "";
    const oldTail = suffix ? oldName + " " + suffix : oldName;
    const newTail = suffix ? name + " " + suffix : name;

    // The title is rewritten BEFORE the wordmark spans, while oldName -
    // read off the page a moment ago - still describes what document.
    // title actually ends with. Rewriting the spans first would still
    // work (oldName is a local, not read again), but reading before
    // writing anything is the harder property to get wrong by accident.
    if (document.title.slice(-oldTail.length) === oldTail) {
      document.title = document.title.slice(0, -oldTail.length) + newTail;
    }

    Array.prototype.forEach.call(owners, function (el) {
      el.textContent = name;
    });
  }

  /*
   * The door's welcome sentence. id="welcome-text" is index.html's own
   * hook (see the comment beside it there); every other page has no such
   * element, and querying for one that is not there is exactly the
   * "nothing to do" case renderGroupName() above already handles the
   * same way.
   *
   * A "\n" in the fetched text becomes a real line break - a <br> this
   * script builds, never one parsed out of the server's string - because
   * the apparatus this slice ships proves a welcome sentence with a line
   * break renders as one, not as a single run-on line.
   */
  function renderWelcomeText(text) {
    if (typeof text !== "string" || !text) return;
    const element = document.getElementById("welcome-text");
    if (!element) return;

    const lines = text.split("\n");
    if (lines.length === 1 && lines[0] === element.textContent) return;

    while (element.firstChild) element.removeChild(element.firstChild);
    lines.forEach(function (line, index) {
      element.appendChild(document.createTextNode(line));
      if (index < lines.length - 1) {
        element.appendChild(document.createElement("br"));
      }
    });
  }

  /*
   * Learned, never painted - see this file's header comment for why a
   * value from THIS load never reaches THIS load's page, and 0.9-M3-S32
   * (#456) for why it now never reaches any page's paint at all, only
   * theme.js's picker. A name that is not one of the four palettes
   * clears whatever was cached rather than merely refusing to overwrite
   * it (0.9-M3-S12 fix wave, #418 comment 5371848229, finding F1): S8's
   * GET /config contract answers "" for "the admin turned the default
   * off", and a refuse-but-keep read of that answer left a member who
   * once learned a palette pre-selected in the picker forever - the
   * admin could never turn it back off. An absent key (the field
   * missing from /config's body entirely, so this runs as
   * cacheDefaultTheme(undefined)) and an unrecognized name (a corrupted
   * value, or one a future config predates this build) get the same
   * treatment: nothing on this origin should keep suggesting a resting
   * palette the admin's last answer does not stand behind. Clearing it
   * is exactly what lets the NEXT load fall through to theme.js's own
   * "nothing learned" branch, which pre-selects whatever the phone's
   * light/dark scheme already painted - see that file's header.
   */
  function cacheDefaultTheme(name) {
    try {
      if (VALID_PALETTES.indexOf(name) === -1) {
        root.localStorage.removeItem(DEFAULT_THEME_KEY);
      } else {
        root.localStorage.setItem(DEFAULT_THEME_KEY, name);
      }
    } catch (e) {}
  }

  async function load() {
    const base = endpoint();
    if (!base) return;

    let response;
    let body;
    try {
      response = await fetch(base + "/config");
      if (!response.ok) return;
      body = await response.json();
    } catch (e) {
      return; // unreachable: the shipped fallback stands, unmodified
    }
    if (!body || typeof body !== "object") return;

    /*
     * THE KEYS LIVE UNDER `config`, NOT AT THE TOP LEVEL. GET /config
     * answers `{ ok: true, config: { "site.groupName": ... } }` - the
     * envelope every route on this Worker uses (server/worker.js's
     * handler, `return json({ ok: true, config: config }, ...)`).
     *
     * This read used to take the keys off `body` itself, so all three
     * settings arrived undefined on every load: the group name and the
     * welcome sentence kept their shipped fallbacks, and the resting
     * palette was CLEARED rather than learned, because an undefined
     * name is not one of the four. An admin could set all three, see
     * them saved, and watch the site ignore every one of them - which
     * is what the owner found on the sit, 2026-08-24.
     *
     * A body without the envelope is treated like an unreachable
     * Worker above: leave the shipped fallbacks alone and cache
     * nothing, rather than clearing a palette on a malformed answer.
     * An absent KEY inside a good envelope still reaches the helpers
     * as undefined, which is the "the admin turned it off" case each
     * one already documents.
     */
    const config = body.config;
    if (!config || typeof config !== "object") return;

    renderGroupName(config["site.groupName"]);
    renderWelcomeText(config["site.welcomeText"]);
    cacheDefaultTheme(config["site.defaultTheme"]);
  }

  const UI = root.BinderUI;
  if (typeof document !== "undefined" && UI) {
    UI.boot(load, function () {
      // A content-render failure is silent by design: the page already
      // shows its shipped, correct fallback text, which is nothing a
      // member has to act on - unlike auth.js's boot failure, nothing
      // here blocks anything the page is for.
    });
  }

  root.BinderSiteContent = Object.freeze({
    renderGroupName: renderGroupName,
    renderWelcomeText: renderWelcomeText,
    cacheDefaultTheme: cacheDefaultTheme,
  });
})(globalThis);
