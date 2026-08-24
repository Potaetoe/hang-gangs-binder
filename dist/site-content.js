

(function (root) {
  "use strict";

   
   
   
   
  const VALID_PALETTES = ["midnight", "pink", "daylight", "contrast"];

   
   
   
   
   
   
  const DEFAULT_THEME_KEY = "hgb-default-theme";

  function endpoint() {
    const config = root.BINDER_CONFIG || {};
    return config.endpoint || null;
  }

  

  function renderGroupName(name) {
    if (typeof name !== "string" || !name) return;
    const owners = document.querySelectorAll(".wordmark-owner");
    if (!owners.length) return;  

    const oldName = owners[0].textContent;
    if (oldName === name) return;  

    const nameEls = document.querySelectorAll(".wordmark-name");
    const suffix = nameEls.length ? nameEls[0].textContent : "";
    const oldTail = suffix ? oldName + " " + suffix : oldName;
    const newTail = suffix ? name + " " + suffix : name;

     
     
     
     
     
    if (document.title.slice(-oldTail.length) === oldTail) {
      document.title = document.title.slice(0, -oldTail.length) + newTail;
    }

    Array.prototype.forEach.call(owners, function (el) {
      el.textContent = name;
    });
  }

  

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
      return;  
    }
    if (!body || typeof body !== "object") return;

    

    const config = body.config;
    if (!config || typeof config !== "object") return;

    renderGroupName(config["site.groupName"]);
    renderWelcomeText(config["site.welcomeText"]);
    cacheDefaultTheme(config["site.defaultTheme"]);
  }

  const UI = root.BinderUI;
  if (typeof document !== "undefined" && UI) {
    UI.boot(load, function () {
       
       
       
       
    });
  }

  root.BinderSiteContent = Object.freeze({
    renderGroupName: renderGroupName,
    renderWelcomeText: renderWelcomeText,
    cacheDefaultTheme: cacheDefaultTheme,
  });
})(globalThis);
