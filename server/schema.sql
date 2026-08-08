-- The whole database.
--
-- One row per submission. `ciphertext` is an opaque base64 blob that
-- nothing on this side can read; every field a submitter typed lives
-- inside it, including the timestamp their browser recorded.
--
-- `received_at` is the server's own receipt time, kept outside the blob
-- because it is the one fact the endpoint can honestly attest to. It,
-- `account_id` and `supersedes` are the only metadata stored, and each
-- of the three is in the clear because a pointer or an id the Worker
-- cannot read is one it can neither check nor count - see DESIGN.md,
-- "Data collected", on why the Telegram handle is not a column, and
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
-- No UPDATE: a correction is a new row that names the row it supersedes
-- in `supersedes`, and the superseded row stays as a tombstone. Which of
-- two rows is the current claim is therefore a fact this side can see,
-- while what either of them says stays unreadable here - so resolving a
-- correction, which means dropping tombstones from a series, happens in
-- the keyholder's browser where the plaintext is. DESIGN.md, "Admin
-- accounts and deletion", is the home of that rule. There IS a DELETE -
-- an admin can remove one submission, which is what answers "please take
-- mine down", what makes junk recoverable, and the only thing that
-- erases a tombstone.
--
-- Adding account_id to a table that already has rows is not possible in
-- SQLite for a NOT NULL column, so the accounts migration DROPs and
-- recreates. That is deliberate and destructive; archive/REDESIGN.md, Part 2.
--
-- That warning is about a NOT NULL column and reads as a general
-- prohibition, which it is not. A nullable column adds cleanly and
-- without losing a row:
--
--     ALTER TABLE submissions ADD COLUMN supersedes INTEGER;
--
-- A database that already holds rows needs that statement before a
-- Worker which reads `supersedes` is deployed against it; there is no
-- graceful degradation on the other side, deliberately, because a
-- fallback would make a forgotten migration invisible in exactly the way
-- the block above describes. Re-running this file afterwards adds the
-- index, which is IF NOT EXISTS.

-- `supersedes` is the id of the row this one replaces, or NULL. It sits
-- last because that is where ALTER TABLE puts it, so a database migrated
-- with the statement above and one created from this file are the same
-- table rather than two that agree only by name.
--
-- Deliberately not a FOREIGN KEY. The pointer is advisory: an admin
-- removing a correction has to put the row it corrected back among the
-- current ones, so a pointer at a row that is gone must resolve as no
-- pointer. A constraint here would instead refuse that deletion or
-- cascade into a second one, and nothing may turn "please take mine
-- down" into two rows disappearing.
CREATE TABLE IF NOT EXISTS submissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  TEXT NOT NULL,
  ciphertext  TEXT NOT NULL,
  received_at TEXT NOT NULL,
  supersedes  INTEGER
);

CREATE INDEX IF NOT EXISTS submissions_account
  ON submissions(account_id);

-- Both of the questions asked about a submission id are "does any row
-- name it": GET /me counts the rows nobody names, and POST /submit
-- refuses a second correction of a row already corrected. The first runs
-- on an ordinary page load.
CREATE INDEX IF NOT EXISTS submissions_supersedes
  ON submissions(supersedes);

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
--
-- `expires_at` is not fixed at sign-in for every session: an admin row's
-- deadline moves forward each time the session is used, and never past a
-- cap derived from `created_at`. Anything reading this table that
-- assumes expires_at = created_at + a constant will be wrong about admin
-- rows - see DESIGN.md, "Sessions".
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
