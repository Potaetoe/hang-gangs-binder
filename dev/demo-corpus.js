/*
 * RETIRED (0.9-M2-S3, #354): this Web Worker built the demo's
 * published snapshot from apps/web/dashboard.js's own aggregation - the
 * same file server/worker.js's real POST /snapshot handler stored,
 * byte for byte. That route is deleted, not gated, on the real
 * Worker: DESIGN.md, "Charts", "The Worker aggregates on request" -
 * publish, unpublish and the published document are all gone. There is
 * no shipped file left that computes a snapshot for this worker to
 * import, and nothing in dev/demo-toolbar.js calls it any more (its own
 * "published snapshot" control group is retired the same way, with one
 * plain line pointing at the 0.9-M4 demo rebuild).
 *
 * Left in place, rather than deleted, because dev/demo-bake.mjs still
 * bakes the static demo's own files whole and dev/demo-bake.test.mjs
 * checks the manifest names them - the file staying importable and
 * answering honestly is cheaper than teaching two more files that it is
 * gone, for a worker nothing invokes. Whichever slice decides the
 * demo's charts story for 0.9-M4 (simulate live aggregation, or keep an
 * honest note permanently - flagged in this slice's completion) is
 * free to delete this file outright.
 */
(function () {
  "use strict";

  self.addEventListener("message", function () {
    self.postMessage({
      ok: false,
      why: "The demo's snapshot simulation retired with the route it " +
        "mirrored (0.9-M2-S3, #354). Charts return in the 0.9-M4 demo " +
        "rebuild.",
    });
  });
})();
