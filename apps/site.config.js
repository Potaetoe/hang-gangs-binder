/*
 * YOUR SITE, AS DATA. This is the file to edit when you fork.
 *
 * Two things live here and nothing else: what your group is called,
 * and what your form asks. Everything the site shows about either -
 * the name over the door, the tab titles, the boxes on the weigh-in
 * form, the list of things the charts can draw - is derived from what
 * is written below. apps/fields.js is where the deriving happens; you
 * should not have to open it.
 *
 * HOW TO CHANGE THE GROUP'S NAME. Change `group.name`. That is the
 * whole of it. A name kept by hand in five pages and a checker fails
 * in one particular way, and it is not that somebody misses a copy -
 * it is that they miss one and nothing says so for a month.
 *
 * HOW TO ADD A FIELD. Copy one of the rows in `fields` and change it.
 * A row says its `name` (what the stored row calls it - short, no
 * spaces), its `kind` (below), its `label` (what a person reads), and
 * its `term` (the same thing inside a sentence, lower case). Set
 * `chart: true` if it is something worth drawing.
 *
 * THE KINDS, and what each one brings with it:
 *
 *   weight     a mass. Uses the `weight` unit table below, so it is
 *              typed in kg or lb and charted in either.
 *   length     a distance. Uses the `length` table - cm, or feet and
 *              inches.
 *   count      a plain number with no units at all. How many meals,
 *              how many miles walked, how many of anything.
 *   choice     one of a written list, or several of one when you set
 *              `multiple: true`.
 *   computed   not asked for at all: worked out from other fields.
 *              BMI is the one here. A computed row names the fields it
 *              is worked out `from` and the `derivation` that does the
 *              arithmetic, and the arithmetic itself lives in
 *              apps/fields.js - the one thing on this page that is
 *              code rather than data, because arbitrary arithmetic is
 *              not something a table can hold safely.
 *   consent    a box somebody ticks. Never charted.
 *
 * WHAT MAY BE WRITTEN HERE. Text, numbers, true/false, lists and
 * tables of them - and comments, as many as are useful. No functions,
 * no arithmetic, nothing computed: apps/fields.js reads this file as
 * DATA, and 0.9-M2 loads it with a <script> tag into the page that
 * handles cleartext, where anything cleverer than a value is code
 * running beside the encryption. Nothing refuses it for you yet - a
 * function written here is quietly ignored rather than rejected until
 * the new testing apparatus (0.9-M0-S4, #281) gives this file an arm -
 * so until then the discipline is yours, and it is worth keeping.
 *
 * CHANGING A `name` OR A CHOICE `value` REWRITES HISTORY, and changing
 * a `label` does not. The name and the value are what stored rows
 * carry; the label is only what is shown, which is why the affiliation
 * stored as `admirer` reads "Fat admirer" on the form. Rename labels
 * freely. Rename a `name` and the rows collected under the old one
 * stop being found.
 *
 * WHERE THIS FILE IS GOING. It is written as a browser script -
 * `globalThis.BINDER_SITE = ...` - so that when 0.9-M2 rebuilds the
 * member pages to render from it, it moves into apps/web/ and is
 * loaded with a <script> tag, unchanged. Today the gate and the
 * derivations read it and the pages do not; see #278.
 */
globalThis.BINDER_SITE = {

  /* ---------------------------------------------------------------- */
  /* Your group.                                                       */

  group: {
    // The gang's name, as it appears over the door. This is the one
    // place it is written.
    name: "Hang Gang",

    // What the site itself is called, after the group's name. "Hang
    // Gang" + "Binder" is the wordmark, the tab titles, and the phrase
    // in the sentences.
    binder: "Binder",
  },

  /* ---------------------------------------------------------------- */
  /* Units, per kind of measurement.                                   */
  /*                                                                   */
  /* `per` is the ONE conversion number in the project: how many of    */
  /* the kind's base unit one of this unit is. A pound is 0.45359237   */
  /* kilograms and an inch is 2.54 centimeters - both exact by         */
  /* definition, the international pound and the international inch,   */
  /* and neither is an approximation to be tidied. Every other         */
  /* conversion is these divided by each other.                        */
  /*                                                                   */
  /* `min` and `max` are what the form will accept, in that unit and   */
  /* not translated from another one: somebody typing pounds should be */
  /* told the limit in pounds, or the form looks broken to them.       */
  /*                                                                   */
  /* `bin` and `band` are the charts' histogram width and how it is    */
  /* written. The pairs are matched rather than chosen independently - */
  /* 20 lb is about 10 kg and 2 in is about 5 cm - so switching units  */
  /* does not silently redraw a distribution into a different shape.   */
  /*                                                                   */
  /* `store` is which property of a stored row holds this unit's       */
  /* number. Every row carries both systems already, so switching      */
  /* units reads a different property rather than multiplying          */
  /* anything, and there is no second copy of the arithmetic to drift. */

  units: {
    // Which system the form and the charts start in. It decides what
    // people type, never what is stored.
    default: "imperial",
    systems: ["metric", "imperial"],

    kinds: {
      weight: {
        // What each system is typed in, and what it is charted in.
        // The same unit for both here; length below is where they
        // differ.
        enter: { metric: "kg", imperial: "lb" },
        chart: { metric: "kg", imperial: "lb" },
        base: "kg",
        units: {
          kg: { per: 1, min: 20, max: 500, bin: 10, band: "10 kg bands",
                store: "kg" },
          lb: { per: 0.45359237, min: 44, max: 1100, bin: 20,
                band: "20 lb bands", store: "lb" },
        },
      },

      length: {
        // Feet to type, inches to chart. Nobody says their height in
        // inches and no histogram can be drawn in feet-and-inches, so
        // the two are different units of one kind rather than one unit
        // pretending.
        enter: { metric: "cm", imperial: "ft" },
        chart: { metric: "cm", imperial: "in" },
        base: "cm",
        // `compound` is the second box beside the first: feet are
        // typed with inches next to them, and the pair is one answer.
        compound: { ft: "in" },
        units: {
          cm: { per: 1, min: 100, max: 250, bin: 5, band: "5 cm bands",
                store: "cm" },
          in: { per: 2.54, bin: 2, band: "2 in bands",
                store: "totalInches" },
          ft: { per: 30.48, min: 3, max: 8 },
        },
      },

      // A number with no units. Nothing uses it yet; it is here so
      // that "how many meals a day" is a row somebody adds rather than
      // a kind somebody has to invent.
      count: {
        base: null,
        units: {},
      },
    },
  },

  /* ---------------------------------------------------------------- */
  /* The form's fields, in the order the form asks them.               */

  fields: [
    {
      name: "over18",
      kind: "consent",
      label: "I confirm I am 18 or older.",
      term: "age confirmation",
      required: true,
      chart: false,
    },
    {
      name: "weight",
      kind: "weight",
      label: "Weight",
      term: "weight",
      required: true,
      chart: true,
    },
    {
      name: "height",
      kind: "length",
      label: "Height",
      term: "height",
      required: true,
      chart: true,
    },
    {
      // Reported as a number and nothing else. The WHO category labels
      // are deliberately not here and should not be added: they are a
      // clinical judgement this site has no business making about
      // people who filled in a form, and they would be the part
      // everybody read.
      name: "bmi",
      kind: "computed",
      label: "BMI",
      term: "BMI",
      derivation: "bmi",
      from: ["weight", "height"],
      // Unitless on purpose. BMI is defined in kilograms and meters;
      // an "imperial BMI" would either be the same number with a
      // different label or a different index with a 703 in it, and
      // both are worse than an index with no units at all.
      unitless: true,
      places: 1,
      bin: 5,
      chart: true,
    },
    {
      name: "gender",
      kind: "choice",
      label: "Gender",
      term: "gender",
      // What the box says when nobody has chosen. An optional field
      // with no such row forces an answer by accident.
      blank: "Prefer not to say",
      choices: [
        { value: "male", label: "Male" },
        { value: "female", label: "Female" },
        { value: "nonbinary", label: "Non-binary" },
        { value: "other", label: "Other" },
      ],
      chart: true,
    },
    {
      name: "roles",
      kind: "choice",
      multiple: true,
      label: "Feedism affiliations",
      // Singular inside a sentence: the charts say "split by
      // affiliation", not "split by feedism affiliations".
      term: "affiliation",
      choices: [
        { value: "feeder", label: "Feeder" },
        { value: "feedee", label: "Feedee" },
        { value: "gainer", label: "Gainer" },
        { value: "admirer", label: "Fat admirer" },
      ],
      chart: true,
    },
    {
      name: "country",
      kind: "choice",
      label: "Country",
      term: "country",
      blank: "Prefer not to say",
      // Two hundred and fifty rows would bury this file, so this one
      // list is kept where it already lives: apps/web/countries.js,
      // ISO 3166-1 keyed by code. Set `choices` instead if you want a
      // short list of your own.
      choicesFrom: "countries",
      chart: true,
    },
  ],
};
