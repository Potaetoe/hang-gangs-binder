

(function (root) {
  "use strict";

  

  function isAdminVia(value) {
    return value === "telegram" || value === "flag" ||
      value === "secret" || value === "break-glass";
  }

  root.BinderNav = Object.freeze({ isAdminVia });

  if (typeof document === "undefined") return;

  

  function markCurrent() {
    const here = BinderSession.pageName();
    const links = document.querySelectorAll(".rail-links a, .tab-bar-item");
    Array.prototype.forEach.call(links, function (link) {
      const href = link.getAttribute("href");
      if (!href) return;  
      const target = href.split("/").pop();
      if (target === here) link.setAttribute("aria-current", "page");
    });
  }

  

  function gateAdminItem() {
    const barItem = document.getElementById("tab-bar-admin");
    const railItem = document.getElementById("rail-admin");
    if (!barItem && !railItem) return;
    const config = root.BINDER_CONFIG || {};
    const session = root.BinderSession && root.BinderSession.read();
    if (!config.endpoint || !session) return;
    root.fetch(config.endpoint + "/me", {
      headers: root.BinderSession.authorization(),
    }).then(function (response) {
      if (!response.ok) return null;
      return response.json();
    }).then(function (payload) {
      if (!payload || !isAdminVia(payload.adminVia)) return;
      if (barItem) barItem.hidden = false;
      if (railItem) railItem.hidden = false;
    }).catch(function () {
       
       
       
    });
  }

  

  function paintBarSignOut() {
    const button = document.getElementById("tab-bar-signout");
    if (!button) return;
    const session = root.BinderSession && root.BinderSession.read();
    button.hidden = !session;
    if (session && root.BinderSignOut) {
      button.addEventListener("click", root.BinderSignOut.signOut);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    markCurrent();
    gateAdminItem();
    paintBarSignOut();
  });

  if (root.BinderSession) root.BinderSession.onChange(paintBarSignOut);
})(globalThis);
