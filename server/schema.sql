-- The whole database.
--
-- One row per submission. `ciphertext` is an opaque base64 blob that
-- nothing on this side can read; every field a submitter typed lives
-- inside it, including the timestamp their browser recorded.
--
-- `received_at` is the server's own receipt time, kept outside the blob
-- because it is the one fact the endpoint can honestly attest to. It is
-- also, deliberately, the only metadata stored - see DESIGN.md, "Data
-- collected", on why the Telegram handle is not a column.
--
-- Append-only in practice: there is no UPDATE and no DELETE anywhere in
-- the Worker. Duplicates are sorted out at export.

CREATE TABLE IF NOT EXISTS submissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ciphertext  TEXT NOT NULL,
  received_at TEXT NOT NULL
);

-- The published aggregate, and the only table anything can read without
-- a token. It holds counts, medians and histogram bins - no handles, no
-- rows - computed in the keyholder's browser and sent here as JSON.
--
-- Exactly one row, forced by the CHECK. A history of snapshots would be
-- more published data about the same people kept for nobody's benefit;
-- the current picture is the whole product, so publishing replaces
-- rather than appends. This is also the one table with an UPDATE path
-- in the Worker.
--
-- Nothing here can be turned back into a submission. If this table is
-- lost, the keyholder presses Publish again.
CREATE TABLE IF NOT EXISTS snapshots (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  body       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
