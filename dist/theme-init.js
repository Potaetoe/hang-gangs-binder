

(function (root) {
  "use strict";

  const HEX_COLOR = /^#[0-9a-f]{6}$/i;

  function isValidHex(value) {
    return typeof value === "string" && HEX_COLOR.test(value);
  }

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function hexToRgb(hex) {
    const digits = hex.replace("#", "");
    return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16));
  }

  function toHexByte(value) {
    return clamp(Math.round(value), 0, 255).toString(16)
      .padStart(2, "0");
  }

  function rgbToHex(rgb) {
    return "#" + rgb.map(toHexByte).join("");
  }

  function rgbToHsl(rgb) {
    const [r, g, b] = rgb.map((v) => v / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return [0, 0, l * 100];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h;
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
    return [h, s * 100, l * 100];
  }

  function hslToRgb(hsl) {
    const h = hsl[0], s = hsl[1] / 100, l = hsl[2] / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let parts;
    if (h < 60) parts = [c, x, 0];
    else if (h < 120) parts = [x, c, 0];
    else if (h < 180) parts = [0, c, x];
    else if (h < 240) parts = [0, x, c];
    else if (h < 300) parts = [x, 0, c];
    else parts = [c, 0, x];
    return parts.map((v) => (v + m) * 255);
  }

  function hue(hex) { return rgbToHsl(hexToRgb(hex))[0]; }
  function sat(hex) { return rgbToHsl(hexToRgb(hex))[1]; }
  function lightness(hex) { return rgbToHsl(hexToRgb(hex))[2]; }

  function setLightness(hex, l) {
    const hsl = rgbToHsl(hexToRgb(hex));
    return rgbToHex(hslToRgb([hsl[0], hsl[1], clamp(l, 0, 100)]));
  }

   
   
   
   
   
   
  function mix(hexA, hexB, weight) {
    const a = hexToRgb(hexA), b = hexToRgb(hexB);
    return rgbToHex(a.map((v, i) => v + (b[i] - v) * weight));
  }

   
   
   
   
   
  function luminance(hex) {
    const channels = hexToRgb(hex).map((value) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function ratio(colorA, colorB) {
    const first = luminance(colorA), second = luminance(colorB);
    const lighter = Math.max(first, second), darker = Math.min(first, second);
    return (lighter + 0.05) / (darker + 0.05);
  }

   
   
   
   
   
   
   
  function pushForContrast(hex, against, minRatio) {
    const averageL = against.reduce((sum, c) => sum + lightness(c), 0)
      / against.length;
    const upward = lightness(hex) >= averageL;
    let current = hex;
    for (let step = 0; step < 100; step += 1) {
      if (against.every((c) => ratio(current, c) >= minRatio)) break;
      const next = setLightness(current, lightness(current) + (upward ? 1 : -1));
      if (next === current) break;
      current = next;
    }
    return current;
  }

  

  function derive(bg, accent) {
    const dark = lightness(bg) < 50;
    const white = "#ffffff", black = "#000000";

     
     
     
     
    const surface = mix(bg, white, 0.07);

     
     
     
     
    const field = bg;

    const text = pushForContrast(
      dark ? mix(bg, white, 0.86) : mix(bg, black, 0.80),
      [bg, surface], 4.6);

    const textMuted = pushForContrast(mix(text, bg, 0.42), [bg, surface], 4.6);

     
     
    const border = mix(bg, text, 0.16);

    const borderStrong = pushForContrast(
      mix(bg, text, 0.5), [surface, field], 3.1);

     
     
     
     
     
    const accentDark = lightness(accent) < 50;
    const accentStrong = pushForContrast(
      setLightness(accent, lightness(accent) + (accentDark ? -8 : 8)),
      [bg], 3.1);

    const lightTone = mix(bg, white, 0.92);
    const darkTone = mix(bg, black, 0.85);
    const onAccent = pushForContrast(
      accentDark ? lightTone : darkTone, [accent, accentStrong], 4.6);

    const accentText = pushForContrast(accent, [bg, surface], 4.6);

     
     
     
     
     
    const goldSat = clamp(Math.max(sat(accent) * 0.6, 45), 0, 100);
    const gold = pushForContrast(
      rgbToHex(hslToRgb([42, goldSat, dark ? 62 : 38])), [bg, surface], 4.6);

    const focus = pushForContrast(
      setLightness(accent, dark ? 78 : 25), [bg], 3.1);

     
     
     
     
    const warnBg = rgbToHex(hslToRgb([32, dark ? 42 : 45, dark ? 16 : 88]));
    const warnText = pushForContrast(
      setLightness(dark ? lightTone : darkTone, dark ? 78 : 28),
      [warnBg], 4.6);

     
     
     
     
     
     
    const seriesSat = clamp(Math.max(sat(accent), 45), 0, 100);
    const seriesL = dark ? 62 : 42;
    const series = [accent];
    [55, 110, 165, 220, 275].forEach((offset) => {
      const rotated = rgbToHex(hslToRgb([(hue(accent) + offset) % 360,
        seriesSat, seriesL]));
      series.push(pushForContrast(rotated, [bg, surface], 3.1));
    });

    return {
      "--color-bg": bg,
      "--color-surface": surface,
      "--color-accent": accent,
      "--color-accent-strong": accentStrong,
      "--color-text": text,
      "--color-text-muted": textMuted,
      "--color-border": border,
      "--color-border-strong": borderStrong,
      "--color-warn-bg": warnBg,
      "--color-warn-text": warnText,
      "--color-field": field,
      "--color-focus": focus,
      "--color-accent-text": accentText,
      "--color-gold": gold,
      "--color-on-accent": onAccent,
      "--color-series-0": series[0],
      "--color-series-1": series[1],
      "--color-series-2": series[2],
      "--color-series-3": series[3],
      "--color-series-4": series[4],
      "--color-series-5": series[5],
    };
  }

   
   
   
   
   
   
  const PAIRINGS = [
    ["--color-text", "--color-bg", "text"],
    ["--color-text", "--color-surface", "text"],
    ["--color-text-muted", "--color-bg", "text"],
    ["--color-text-muted", "--color-surface", "text"],
    ["--color-warn-text", "--color-warn-bg", "text"],
    ["--color-accent-text", "--color-bg", "text"],
    ["--color-accent-text", "--color-surface", "text"],
    ["--color-on-accent", "--color-accent", "text"],
    ["--color-accent-strong", "--color-bg", "mark"],
    ["--color-on-accent", "--color-accent-strong", "text"],
    ["--color-gold", "--color-bg", "text"],
    ["--color-gold", "--color-surface", "text"],
    ["--color-focus", "--color-bg", "mark"],
    ["--color-accent", "--color-bg", "mark"],
    ["--color-border-strong", "--color-surface", "mark"],
    ["--color-border-strong", "--color-field", "mark"],
  ];
  for (let slot = 0; slot < 6; slot += 1) {
    PAIRINGS.push(["--color-series-" + slot, "--color-bg", "mark"]);
    PAIRINGS.push(["--color-series-" + slot, "--color-surface", "mark"]);
  }

  const THRESHOLD = { text: 4.5, mark: 3.0 };
  const MARGIN = 0.1;

   
   
   
   
  function contrastProblems(tokens) {
    const problems = [];
    PAIRINGS.forEach(function (pairing) {
      const foreground = pairing[0], background = pairing[1], kind = pairing[2];
      const have = ratio(tokens[foreground], tokens[background]);
      const need = THRESHOLD[kind] + MARGIN;
      if (have < need) {
        problems.push(foreground + " on " + background + " measures " +
          have.toFixed(2) + ":1 and wants " + need.toFixed(1) + ":1");
      }
    });
    return problems;
  }

  root.BinderCustomPalette = Object.freeze({
    isValidHex: isValidHex,
    derive: derive,
    contrastProblems: contrastProblems,
    ratio: ratio,
    PAIRINGS: PAIRINGS,
    THRESHOLD: Object.freeze(THRESHOLD),
    MARGIN: MARGIN,
  });

  

  try {
    const chosen = localStorage.getItem("hgb-palette");
    if (chosen === "custom") {
      const raw = localStorage.getItem("hgb-custom-colors");
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && isValidHex(parsed.bg) && isValidHex(parsed.accent)) {
        const tokens = derive(parsed.bg, parsed.accent);
        const element = document.documentElement;
        element.setAttribute("data-theme", "custom");
        Object.keys(tokens).forEach(function (name) {
          element.style.setProperty(name, tokens[name]);
        });
      }
    } else if (chosen) {
      document.documentElement.setAttribute("data-theme", chosen);
    }
  } catch (e) {}
})(globalThis);
