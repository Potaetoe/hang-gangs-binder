/*
 * Lint rules for this repository.
 *
 * A LINTER IS A GATE, NOT A BUILD. DESIGN.md's test for tooling is
 * whether it can change what ships without the repository noticing, and
 * this config transforms no file at all: a lint failure blocks a release
 * rather than changing what gets released. That is the same shape as
 * tools/check_web.py, which has always been allowed for the same reason.
 *
 * There IS a step between the source and the published site now -
 * tools/build_web.mjs, which writes dist/ (#181) - and it meets that
 * same test rather than being an exception to it: its output is
 * committed and the gate rebuilds and byte-compares it in both
 * directions. See DESIGN.md, "What is deliberately not here".
 *
 * The three groups below are genuinely different environments and were
 * getting one set of assumptions applied to all of them by eye:
 *
 *   apps/web/*.js   classic scripts, loaded by <script> with no type. No
 *                   import, no export - the pages depend on these files
 *                   assigning to globalThis, and a stray `export` would
 *                   turn one into a module that silently stops defining
 *                   its global.
 *   dev/*.mjs       ES modules under Node, which load the shipped files
 *                   and read their real bytes.
 *   root config     ES modules under Node, this file and its neighbours.
 */

import js from "@eslint/js";
import globals from "globals";

export default [
  {
    // Never linted: not ours, or not source.
    //
    // .claude/** holds agent-tool state, and .claude/worktrees/ in
    // particular holds whole checkouts of this repository at other
    // commits. Without this the gate lints a second, older copy of the
    // tree and fails on code that is not the code being checked - which
    // happened on 2026-08-07, 168 errors from a worktree sitting at
    // main. A gate that fails for a reason the author cannot act on is
    // worse than a slow one: it teaches you to read red as noise, and
    // that is how a real failure gets waved through.
    // dist/ is generated (#181): it is apps/web with the comments taken
    // out, so every rule below has already been applied to the file it
    // was built from. Linting it would be linting the same code twice
    // and reporting the second copy's line numbers, which point at
    // nothing anybody can edit - the fix always belongs in apps/web.
    ignores: ["node_modules/**", "_site/**", "dist/**", ".wrangler/**",
              ".claude/**", "dev/sample-submissions.json",
              "dev/fixture.json"],
  },

  js.configs.recommended,

  {
    /* The published site. */
    files: ["apps/web/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      // Classic scripts. This is load-bearing rather than a preference:
      // sourceType "script" makes `import`/`export` a parse error, which
      // is the failure we want at lint time instead of a page whose
      // global quietly never appears.
      sourceType: "script",
      globals: {
        ...globals.browser,
        // The globals these files define for each other, all assigned
        // through globalThis and read by name across files.
        BinderCrypto: "readonly",
        BinderUI: "readonly",
        BinderForm: "readonly",
        BinderAdmin: "readonly",
        BinderDashboard: "readonly",
        BinderSession: "readonly",
        BinderAuth: "readonly",
        BinderXlsx: "readonly",
        BinderCountries: "readonly",
        BINDER_CONFIG: "readonly",
      },
    },
    rules: {
      strict: ["error", "function"],
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-implicit-globals": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
      quotes: ["error", "double", { avoidEscape: true }],
      semi: ["error", "always"],
      // An empty catch is a deliberate idiom here, not an oversight.
      // localStorage throws outright when storage is disabled or the page
      // is in private browsing, and every one of these sites wants "then
      // there is no saved theme" rather than a broken page. An empty if
      // or loop body still fails.
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        caughtErrors: "none",
      }],
    },
  },

  {
    /*
     * ui.js is DOM-only, and this is the rule that keeps it that way.
     *
     * The reason is not tidiness. tools/check_web.py's senders rule holds
     * every file that puts a body on the wire to also naming BinderCrypto,
     * which is how "plaintext never leaves the browser" is machine-checked.
     * A fetch() reaching ui.js would put a sender inside the one file every
     * page loads, and the rule would have to be widened for all of them.
     * dev/ui.test.mjs asserts the same thing; this catches it a step
     * earlier, while it is still being typed.
     */
    files: ["apps/web/ui.js"],
    rules: {
      "no-restricted-globals": ["error", {
        name: "fetch",
        message: "ui.js is DOM-only. Network behavior belongs in the " +
                 "page's own script - see check 6 in tools/check_web.py.",
      }],
      "no-restricted-properties": ["error", {
        object: "navigator",
        property: "sendBeacon",
        message: "ui.js is DOM-only. See check 6 in tools/check_web.py.",
      }],
    },
  },

  {
    /*
     * The one browser file that does not live in apps/web.
     *
     * dev/crypto-browser-check.js runs the crypto suite in a real browser
     * under the published CSP, which is the half dev/crypto.test.mjs
     * cannot reach from Node. It is a classic script like everything in
     * apps/web, and it is here rather than there because ./run build
     * takes apps/web whole into the published dist/ - it strips comments
     * and nothing else - and a test page is not something to publish.
     */
    files: ["dev/crypto-browser-check.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        BinderCrypto: "readonly",
        BINDER_CONFIG: "readonly",
      },
    },
    rules: {
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": "off",
      semi: ["error", "always"],
    },
  },

  {
    /*
     * The demo's browser files.
     *
     * Classic scripts like everything in apps/web, and in dev/ for the
     * same reason crypto-browser-check.js is: apps/web goes whole into
     * the published dist/ and a demo harness is not something to publish.
     *
     * The worker globals are not decoration. dev/demo-corpus.js runs in a
     * Web Worker precisely because a worker has no `document`, which is
     * what makes apps/web/admin.js and apps/web/dashboard.js define their
     * pure halves and skip their wiring - the same condition the Node
     * suites rely on. So `self` and `importScripts` are real here and
     * `document` is real in the others, and one block covers both rather
     * than splitting four files across two.
     */
    files: ["dev/demo-boot.js", "dev/demo-console.js", "dev/demo-corpus.js",
            "dev/demo-stub.js", "dev/demo-telegram.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.worker,
        BinderDemo: "readonly",
        BinderAdmin: "readonly",
        BinderDashboard: "readonly",
        BinderForm: "readonly",
        BINDER_CONFIG: "readonly",
      },
    },
    rules: {
      strict: ["error", "function"],
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      quotes: ["error", "double", { avoidEscape: true }],
      semi: ["error", "always"],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": ["error", { argsIgnorePattern: "^_",
                                    caughtErrors: "none" }],
    },
  },

  {
    /* The Node test suites, which load the shipped files. */
    files: ["dev/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        // The suites install a fake DOM and then drive it - ui.test.mjs
        // sets document.readyState to prove boot() handles a document
        // that is already loaded. Writable, not readonly: assigning to it
        // is the test, so flagging the assignment would be flagging the
        // point.
        document: "writable",
        window: "writable",
        location: "writable",
        localStorage: "writable",
        sessionStorage: "writable",
      },
    },
    rules: {
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      quotes: ["error", "double", { avoidEscape: true }],
      semi: ["error", "always"],
      // A suite prints its results. That is its whole job.
      "no-console": "off",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_",
                                    caughtErrors: "none" }],
    },
  },

  {
    /*
     * The one tool in tools/ that is not Python: tools/build_web.mjs,
     * which generates dist/ (#181). It is in tools/ rather than dev/
     * because it is not a test - `./run build` runs it, and `./run
     * check` runs its --check arm as a gate stage.
     *
     * console is on, and that is the same allowance dev/ gets: a tool
     * whose output is a report has to be able to print one.
     */
    files: ["tools/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      quotes: ["error", "double", { avoidEscape: true }],
      semi: ["error", "always"],
      "no-console": "off",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_",
                                    caughtErrors: "none" }],
    },
  },

  {
    /* The Worker. Not published by the deploy job, still ours. */
    files: ["server/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.serviceworker },
    },
    rules: {
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      quotes: ["error", "double", { avoidEscape: true }],
      semi: ["error", "always"],
      "no-unused-vars": ["error", { argsIgnorePattern: "^_",
                                    caughtErrors: "none" }],
    },
  },

  {
    /* This file and any other root-level tooling config. */
    files: ["*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
];
