/*
 * Applied before first paint so a saved theme does not flash the default
 * palette on the way in. theme.js, at the end of the body, does
 * everything else.
 *
 * This is a file rather than the inline <script> it started as. Inline
 * scripts require script-src 'unsafe-inline' (or a hash that breaks on
 * every edit), and this page will shortly be handling plaintext before
 * it is encrypted - the one page where an injected script is worth
 * spending a request to prevent. Same origin, no attributes: it blocks
 * rendering exactly like the inline version did.
 *
 * WHY THE CUSTOM-PALETTE MATH LIVES HERE (0.9-M2-S6, #82), and not in a
 * file of its own. tools/check_web.py's check 22 pins the head to
 * exactly one script - this one - because a head scripts live in is a
 * head where the next arrival goes unweighed. A second <script src> for
 * the derivation math would be exactly that arrival, so the math is
 * this file's own pure half instead: BinderCustomPalette, published
 * once, before the pre-paint side effect that was always this file's
 * whole job. theme.js, at the end of the body, reads the same object
 * off the global rather than carrying its own copy - one derivation,
 * the rule every file in this directory already follows, and the
 * ordering is safe because this script finishes before any body script
 * starts, which is check 22's own guarantee and is now stated in
 * tools/check_web.py's loading_problems() rather than merely assumed.
 *
 * WHAT "DERIVE" MEANS HERE. The 0.9-M2-S6 design mandate hands a member
 * exactly two colors, background and accent; theme.css's other four
 * palettes each hand-tune twenty-one tokens. derive() computes the
 * other nineteen from the two it is given, arguing each one in the
 * comment beside it so the next reader can check the reasoning against
 * theme.css's own palette blocks rather than trust it blind. It is
 * best-effort BY DESIGN - a member's own colors are not required to
 * clear WCAG, only to be told honestly when they do not - so
 * contrastProblems() below is the actual source of truth, run against
 * whatever derive() produced, never assumed from the fact that derive()
 * tried.
 */
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

  // sRGB channel-space blend. Not the oklab color-mix() theme.css itself
  // uses for --color-accent-quiet - that stays a stylesheet expression,
  // computed by the browser from whichever --color-accent this file
  // sets - but this is the same arithmetic tools/check_contrast.py
  // already holds every shipped palette to, so a color this function
  // produces is measured the same way a hand-tuned one is.
  function mix(hexA, hexB, weight) {
    const a = hexToRgb(hexA), b = hexToRgb(hexB);
    return rgbToHex(a.map((v, i) => v + (b[i] - v) * weight));
  }

  // WCAG 2.x relative luminance and contrast ratio - the exact formula
  // tools/check_contrast.py holds the four shipped palettes to, copied
  // rather than approximated so "the same rules the shipped palettes
  // pass" (the 0.9-M2-S6 mandate's own words) is literally true of the
  // number this computes.
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

  // Nudges `hex` one lightness point at a time, away from `against`'s
  // own average lightness, until every color in `against` clears
  // `minRatio` or the 0/100 rail is reached. BEST EFFORT: this loop's
  // say-so is never the thing a caller trusts - contrastProblems() below
  // re-measures the tokens this produces from scratch, which is what
  // lets a palette this loop could not fix still ship with an honest
  // warning instead of a silently wrong pass.
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

  /*
   * The twenty-one tokens theme.css's other four palettes hand-tune, in
   * the same order MOCKUP_PALETTES in tools/check_web.py lists them.
   * Each derivation is argued beside it against the pattern the four
   * shipped palettes already show - see theme.css's own palette blocks
   * for the values these comments are reading off.
   */
  function derive(bg, accent) {
    const dark = lightness(bg) < 50;
    const white = "#ffffff", black = "#000000";

    // Every shipped palette's surface reads lighter than its page, dark
    // or light alike (Midnight #120d10 -> #1c1417, Daylight #f3eadb ->
    // #fbf5ea) - "a hole in the card" moved toward the light rail by a
    // fixed step, never toward the dark one.
    const surface = mix(bg, white, 0.07);

    // Three of four shipped palettes set --color-field to exactly
    // --color-bg; Daylight's own #fffdf6 against #f3eadb is the one
    // exception, and a member's own field reading as their own
    // background is the simpler promise to keep across every input.
    const field = bg;

    const text = pushForContrast(
      dark ? mix(bg, white, 0.86) : mix(bg, black, 0.80),
      [bg, surface], 4.6);

    const textMuted = pushForContrast(mix(text, bg, 0.42), [bg, surface], 4.6);

    // Decorative, per theme.css's own EXEMPT comment on --color-border -
    // no pairing measures it, so no search is spent on it.
    const border = mix(bg, text, 0.16);

    const borderStrong = pushForContrast(
      mix(bg, text, 0.5), [surface, field], 3.1);

    // Every shipped palette's hover fill moves AWAY from its own accent's
    // half of the lightness range: Midnight's dark accent (#c73743) goes
    // darker on hover (#bd3440), Contrast's light one (#f08090) goes
    // lighter (#f8b0bc). The label sitting on the fill is what forces the
    // direction, and on-accent below picks its own side by the same rule.
    const accentDark = lightness(accent) < 50;
    const accentStrong = pushForContrast(
      setLightness(accent, lightness(accent) + (accentDark ? -8 : 8)),
      [bg], 3.1);

    const lightTone = mix(bg, white, 0.92);
    const darkTone = mix(bg, black, 0.85);
    const onAccent = pushForContrast(
      accentDark ? lightTone : darkTone, [accent, accentStrong], 4.6);

    const accentText = pushForContrast(accent, [bg, surface], 4.6);

    // The gold role sits at nearly the same amber hue in every shipped
    // palette - measured off theme.css's own --color-gold values:
    // Midnight and Pink 38.5, Daylight 39.6, Contrast 38.1, all within
    // two degrees of each other (0.9-M2-S6 fix wave 1, F5, #82: no
    // shipped --color-gold actually sits at 42 or 45, the values a
    // stale draft of this comment once split by palette pair). Fixed
    // rather than derived from the accent either way - "neither the
    // page's text nor its accent" is the whole point of the role. 42
    // below is close enough to the four measurements to read as the
    // same amber, not a literal reproduction of them.
    const goldSat = clamp(Math.max(sat(accent) * 0.6, 45), 0, 100);
    const gold = pushForContrast(
      rgbToHex(hslToRgb([42, goldSat, dark ? 62 : 38])), [bg, surface], 4.6);

    const focus = pushForContrast(
      setLightness(accent, dark ? 78 : 25), [bg], 3.1);

    // Warn is its own amber-brown, independent of the accent, in THREE
    // of the four shipped palettes - Midnight 31.8, Daylight 38.0,
    // Contrast 39.4, the same narrow band gold's comment measures
    // above. Pink is the exception (0.9-M2-S6 fix wave 1, F6, #82):
    // its own --color-warn-bg reads hue 5.8, nowhere near this band -
    // but also nowhere near Pink's own accent hue (336.6), so "Pink's
    // warn box does not turn pink" still holds even though Pink's own
    // warn hue does not match the other three's. 32 below sits inside
    // the band the majority share, not a literal reproduction of all
    // four measurements.
    const warnBg = rgbToHex(hslToRgb([32, dark ? 42 : 45, dark ? 16 : 88]));
    const warnText = pushForContrast(
      setLightness(dark ? lightTone : darkTone, dark ? 78 : 28),
      [warnBg], 4.6);

    // Series 0 is always the accent (theme.css's own convention, every
    // palette alike). The other five rotate the accent's hue by the same
    // five offsets in every mode; theme.css's own comment records that
    // the shipped palettes' ORDER is chosen against CVD simulation this
    // file cannot run, so a member's own series are held to WCAG contrast
    // only - the mandate's rule, not a gap in this one.
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

  // The same pairings tools/check_contrast.py's PAIRINGS holds every
  // shipped palette to, at the same AA thresholds and the same 0.1
  // margin - "the same rules the shipped palettes pass" read literally.
  // --color-accent-quiet and --color-border are absent for the reason
  // check_contrast.py's own EXEMPT set gives: one has no fixed luminance
  // to measure and the other is decorative by rule.
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

  // [problem] for a derived token set, never a bare pass/fail - the
  // 0.9-M2-S6 mandate's warning is honest words, and honest words need
  // the numbers behind them even though the UI itself never shows a
  // ratio. Empty means every pairing cleared its threshold plus margin.
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

  /*
   * The pre-paint side effect - this file's original whole job, and
   * still the only thing that runs unconditionally.
   *
   * "custom" is validated on read, not merely on write (the 0.9-M2-S6
   * security mandate): a hand-edited or truncated hgb-custom-colors
   * value paints NOTHING rather than guessing, which leaves data-theme
   * unset and the page falls through to theme.css's own system-preference
   * defaults - the same resting state a first-time visitor gets. That is
   * deliberate and it is the DoD's own words: a corrupted stored value
   * "falls back to the named palette", and with no named palette on
   * record either (custom overwrote it), the named palette a visitor
   * with no choice at all already gets is the honest answer.
   */
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
