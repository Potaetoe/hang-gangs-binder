/*
 * A stand-in for Telegram's login widget, so the sign-in path is
 * drivable offline.
 *
 * The real widget is a third-party script bound by BotFather to the
 * published domain. On 127.0.0.1 it reaches the network and then renders
 * nothing, which leaves the sign-in page - the first thing anyone walks
 * through - as the one surface the demo cannot demonstrate.
 *
 * What it stands in for is small and worth naming, because the point of
 * the demo is that the rest is real: the widget supplies a payload and
 * calls the page's own `data-onauth`. Everything after that press is
 * apps/web/auth.js, apps/web/session.js and the page itself.
 *
 * All wiring, no pure half.
 */
(function (root) {
  "use strict";

  const script = document.currentScript;
  if (!script) return;

  /*
   * The callback is named in the attribute as a call expression -
   * `onTelegramAuth(user)` - and the real widget evaluates it. This
   * reads the name out of it and calls the function instead. The page's
   * policy does allow eval, so this is not working around a block; a
   * demo file that evaluates an attribute is simply a worse thing to
   * have in the tree than one that does not.
   */
  const attribute = script.getAttribute("data-onauth") || "";
  const name = attribute.split("(")[0].trim();

  /*
   * A payload of the shape the widget sends. The numeric id is the field
   * that matters here: apps/web/submit.js paints it on the member panel
   * (#58), so it has to travel the whole way from this press to that
   * line. It is a made-up number and belongs to nobody.
   */
  const payload = {
    id: Number(root.BinderDemo && root.BinderDemo.MEMBER_TELEGRAM_ID),
    first_name: "Demo",
    username: script.getAttribute("data-telegram-login") || "demo_member",
    auth_date: Math.floor(Date.now() / 1000),
    hash: "demo",
  };

  const button = document.createElement("button");
  button.type = "button";
  button.className = "demo-telegram-button";
  button.textContent = "Log in with Telegram (demo stand-in)";

  /*
   * Styled here rather than in theme.css, and that is the rule this file
   * follows throughout: apps/web is not touched by the demo, so a class
   * the shipped stylesheet has never heard of gets its appearance from
   * the file that invents it. It borrows the page's own custom
   * properties where they exist, so it changes with the palette instead
   * of sitting outside it.
   */
  button.style.cssText = [
    "font: inherit",
    "padding: 0.6em 1.1em",
    "border: 1px dashed currentColor",
    "border-radius: 0.5em",
    "background: transparent",
    "color: inherit",
    "cursor: pointer",
  ].join(";");

  button.addEventListener("click", function () {
    const callback = name ? root[name] : null;
    if (typeof callback !== "function") {
      button.textContent = "This page defines no " + name + " to call.";
      return;
    }
    callback(payload);
  });

  script.parentNode.insertBefore(button, script.nextSibling);
})(globalThis);
