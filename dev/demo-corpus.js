/*
 * Builds the demo's published snapshot, in a Web Worker.
 *
 * A worker rather than the console page itself, and the reason is the
 * pure/DOM split in AGENTS.md. apps/web/admin.js and
 * apps/web/dashboard.js both wire themselves to a document when there is
 * one, so importing them into an ordinary page would start the export
 * page's wiring against a page that has none of its elements. A worker
 * has no `document`, so those guards hold and only the halves this needs
 * are defined - which is exactly the condition dev/dashboard.test.mjs
 * relies on under Node.
 *
 * So the numbers on the demo's Progress page are computed by the shipped
 * aggregation, from records the shipped form built. Nothing here has an
 * opinion about what a snapshot contains.
 */
/*
 * Wrapped and immediately called, assigning no global. AGENTS.md,
 * "The module shape means something": `(function () { ... })()` is the
 * shape for a file that defines nothing for anybody else to read, and
 * the shipped files this imports are the ones doing the assigning.
 */
(function () {
  "use strict";

  importScripts(
    "/apps/web/form.js",
    "/apps/web/dashboard.js",
    "/apps/web/admin.js",
    "/dev/demo-stub.js"
  );

  self.addEventListener("message", function (event) {
    const Demo = self.BinderDemo;
    const Form = self.BinderForm;
    const Admin = self.BinderAdmin;
    const Dashboard = self.BinderDashboard;

    const asked = event.data || {};

    try {
      const deps = {
        buildRecord: Form.buildRecord,
        entryFor: Admin.entryFor,
        // The aggregation itself, passed in the same way and for the
        // same reason as the form's two halves: what a snapshot contains
        // is dashboard.js's answer, and this file asks for it rather
        // than having one.
        snapshotOf: Dashboard.snapshotOf,
      };
      /*
       * One document, for the corpus and the cut the toolbar asked for.
       * `identify` is left off in publishedFrom, so both generations go
       * through the floor and the labelling a published document gets.
       * The keyholder's own view is the identified one, and the admin
       * page draws that from the rows themselves rather than from this.
       */
      const rounds = asked.rounds === null || asked.rounds === undefined
        ? Demo.roundsIn(asked.corpus) : asked.rounds;
      const snapshot = Demo.publishedFrom(asked.corpus, deps, rounds);

      self.postMessage({
        ok: true,
        snapshot: snapshot,
        rounds: rounds,
        // Off the document rather than counted again here: a second
        // count is a number free to disagree with the one the charts
        // draw.
        entries: snapshot.counts.entries,
      });
    } catch (error) {
      self.postMessage({
        ok: false,
        why: (error && error.message) || String(error),
      });
    }
  });
})();
