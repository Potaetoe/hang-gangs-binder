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
