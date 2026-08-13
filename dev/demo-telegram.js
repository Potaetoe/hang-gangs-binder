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

  const Demo = root.BinderDemo;

  /*
   * A payload of the shape the widget sends. The numeric id is the field
   * that matters here: apps/web/submit.js paints it on the member panel
   * (#58), so it has to travel the whole way from this press to that
   * line. They are made-up numbers and belong to nobody.
   */
  function payloadFor(who) {
    return {
      id: Number(who.telegramId),
      first_name: who.label,
      username: who.handle,
      auth_date: Math.floor(Date.now() / 1000),
      hash: "demo",
    };
  }

  /*
   * THE PICKER IS THE ONE PLACE A DEMO-ONLY CONTROL SITS ON A PRODUCT
   * SURFACE, and the owner ruled it there: the sign-in page's own button
   * should offer whoever a driver wants to be, because walking back to a
   * strip to choose is not how anybody signs in.
   *
   * It stands in for the widget's account chooser, which is what the
   * real one puts behind that button - so the shape is the product's,
   * and what changes is that the accounts are fabricated. Everything
   * after the press is apps/web/auth.js posting the payload and
   * apps/web/session.js keeping what comes back.
   *
   * Styled here rather than in theme.css, and that is the rule this file
   * follows throughout: apps/web is not touched by the demo, so a class
   * the shipped stylesheet has never heard of gets its appearance from
   * the file that invents it. It borrows the page's own colors, so it
   * changes with the palette instead of sitting outside it.
   */
  const BUTTON_STYLE = [
    "font: inherit",
    "padding: 0.6em 1.1em",
    "border: 1px dashed currentColor",
    "border-radius: 0.5em",
    "background: transparent",
    "color: inherit",
    "cursor: pointer",
  ].join(";");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "demo-telegram-button";
  button.textContent = "Log in with Telegram (demo stand-in)";
  button.style.cssText = BUTTON_STYLE;
  button.setAttribute("aria-expanded", "false");

  const picker = document.createElement("div");
  picker.className = "demo-telegram-picker";
  picker.setAttribute("role", "group");
  picker.setAttribute("aria-label", "Sign in as");
  picker.hidden = true;
  picker.style.cssText = [
    "display: flex",
    "flex-wrap: wrap",
    "gap: 0.4em",
    "margin-top: 0.6em",
  ].join(";");

  function signIn(who) {
    const callback = name ? root[name] : null;
    if (typeof callback !== "function") {
      button.textContent = "This page defines no " + name + " to call.";
      return;
    }
    callback(payloadFor(who));
  }

  (Demo ? Demo.SIGN_INS : []).forEach(function (who) {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.className = "demo-telegram-choice";
    choice.textContent = who.label;
    choice.title = who.what;
    choice.style.cssText = BUTTON_STYLE;
    choice.addEventListener("click", function () { signIn(who); });
    picker.appendChild(choice);
  });

  button.addEventListener("click", function () {
    // Revealed by the attribute rather than by a class, because
    // `element.hidden` reading true while an element paints is the trap
    // AGENTS.md names - and here the inverse is what would bite: a
    // picker that is on screen while the page believes it is closed.
    const open = picker.hidden;
    picker.hidden = !open;
    button.setAttribute("aria-expanded", open ? "true" : "false");
  });

  script.parentNode.insertBefore(button, script.nextSibling);
  script.parentNode.insertBefore(picker, button.nextSibling);
})(globalThis);
