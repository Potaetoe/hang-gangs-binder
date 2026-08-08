-- The whole database.
--
-- One row per submission. `ciphertext` is an opaque base64 blob that
-- nothing on this side can read; every field a submitter typed lives
-- inside it, including the timestamp their browser recorded.
--
-- `received_at` is the server's own receipt time, kept outside the blob
-- because it is the one fact the endpoint can honestly attest to. It and
-- `account_id` are the only metadata stored - see DESIGN.md, "Data
-- collected", on why the Telegram handle is not a column, and
-- "Accounts" on why an account id can sit in the clear where a handle
-- cannot.
--
-- ---------------------------------------------------------------------
-- AHEAD OF THE LIVE DATABASE, as of 2026-08-05.
--
-- Running this file against the current production database will NOT
-- migrate it, and will not say so: `submissions` already exists, so
-- CREATE TABLE IF NOT EXISTS skips it and `account_id` never appears.
-- What you would get is a `sessions` table beside an unchanged
-- `submissions` - half a migration, quietly.
--
-- The real migration DROPs and recreates, because SQLite cannot add a
-- NOT NULL column to a table with rows in it. That is destructive and
-- deliberate; it is step 2 of archive/REDESIGN.md's build order, and it comes
-- after the dev database has been used to rehearse it.
-- ---------------------------------------------------------------------
--
-- `account_id` is an HMAC of a Telegram numeric id under a Worker
-- secret. It is the one identity on a row a client cannot influence -
-- the handle inside the blob is written by the member's own browser and
-- is a label rather than a fact. See DESIGN.md, "Accounts", including
-- why a plain hash of the handle would have been a disaster.
--
-- No UPDATE: an update writes a new row, which is what the
-- weight-over-time history is made of. There IS a DELETE, added
-- 2026-08-05 - an admin can remove one submission, which is what
-- answers "please take mine down" and what makes junk recoverable.
--
-- Adding account_id to a table that already has rows is not possible in
-- SQLite for a NOT NULL column, so the accounts migration DROPs and
-- recreates. That is deliberate and destructive; archive/REDESIGN.md, Part 2.

CREATE TABLE IF NOT EXISTS submissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  TEXT NOT NULL,
  ciphertext  TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS submissions_account
  ON submissions(account_id);

-- Sessions. Only the SHA-256 of a token is kept, so reading this table
-- yields nothing that can be used as a session - the same reasoning that
-- keeps plaintext out of `submissions`, applied to a much smaller
-- secret.
--
-- `is_dev` marks a session minted by POST /auth/dev rather than by
-- Telegram. It defaults to 0, so a session is only ever a development
-- one by having said so, and the pages show a banner while one is in
-- use. A development session that looks real is worse than none.
--
-- Expired rows are cleared when one is looked up rather than on a
-- schedule. The ordinary failure of a scheduled job is silence.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  is_admin   INTEGER NOT NULL DEFAULT 0,
  is_dev     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_expiry
  ON sessions(expires_at);

-- The published aggregate. It holds counts, medians and histogram bins -
-- no handles, no rows - computed in the keyholder's browser and sent here
-- as JSON.
--
-- This used to say it was "the only table anything can read without a
-- token", and that stopped being true on 2026-08-05: GET /snapshot needs
-- a member session, so every table now requires a credential to read.
-- Gating it was not a reason to relax what goes in it, and nothing did -
-- the document still carries no handles and no rows, which is why losing
-- the session check would be a smaller failure here than anywhere else
-- and is still a failure. See DESIGN.md, "The members' dashboard".
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
