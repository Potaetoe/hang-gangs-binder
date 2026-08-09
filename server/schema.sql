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
-- the block above describes.
--
-- Re-running this file is safe to repeat and is NOT purely additive, and
-- the difference matters to whoever runs it. Every run DROPs the old
-- `supersedes` index before creating the unique one under its new name -
-- see that statement's own block below for why a rename is the only
-- honest way to make an existing index unique - so a run is idempotent
-- in its result and destructive on the way there. Against a database
-- holding two rows that name one target the CREATE fails, and the DROP
-- that preceded it has already committed: the table is left with no
-- index on `supersedes` at all, which is a working database with a
-- silently slower GET /me and no chain rule under it. OPERATIONS.md
-- carries the pre-flight query that stops that happening and the
-- recovery if it has.
--
-- A whole new table is the easy case of the same rule: re-running this
-- file creates `site_content` and `membership` where they are absent and
-- skips them where they exist, which is the one thing CREATE TABLE IF
-- NOT EXISTS is safe for. The trap is only ever a table that exists
-- already in a different shape - which is the block above.

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

-- Two questions are asked about a submission id, and they are NOT the
-- same question - which is the thing to know before changing either one
-- to match the other. GET /me counts the rows nobody names, scoped to
-- one account: a superseding row has to belong to the member being
-- counted. POST /submit refuses a correction of a row ANY row already
-- names, scoped to nothing. The first runs on an ordinary page load,
-- which is what this index is for.
--
-- Each scope is chosen against a different failure. /me is a member's
-- own panel, so a row they did not write and cannot see must not be able
-- to remove one of their entries from it - and rows written by another
-- account do reach this table, through `wrangler d1 execute` and through
-- an ACCOUNT_SECRET rotation that renames every account in the clear
-- column and leaves the pointers untouched. /submit's rule is the one
-- below: a UNIQUE index on `supersedes` alone asks about the whole
-- table, so an endpoint asking a narrower question would accept writes
-- the database then refuses, and the member's answer would come from an
-- exception handler matching on an error string rather than from a check
-- that diagnosed it. Making that pair agree is worth more than making
-- the two endpoints agree with each other.
--
-- UNIQUE is the chain shape enforced by the database instead of only by
-- the endpoint that checks it. A row may be superseded ONCE, which is
-- what keeps "current" meaning "the rows nobody names" - a total
-- function needing no tie-break in a client this side cannot see. Two
-- rows naming one target are both current, and the member holds two
-- claims where they meant one. POST /submit asks the question and then
-- writes; between those there is a gap, and a second correction of the
-- same entry - two tabs, or one retried request - lands in it. The
-- endpoint closes the gap by sending its question and its write as one
-- batch, and this index is what stays true if that ever comes apart.
--
-- NULLs are DISTINCT in a SQLite UNIQUE index, so this constrains
-- corrections only: every ordinary submission stores NULL here and any
-- number of them sit beside each other untouched. That is the property
-- this line depends on, not an oversight to be tidied up later.
--
-- RENAMED rather than made unique in place, and the DROP below is half
-- of the same act. `CREATE UNIQUE INDEX IF NOT EXISTS` under the old
-- name does NOTHING against a database that already carries the
-- non-unique index - it skips, says nothing, and leaves the constraint
-- absent - which is precisely the half-migration the block at the top of
-- this file exists to warn about. Under a new name the statement runs.
-- Against a database that already holds two rows naming one target it
-- fails loudly, and that is the correct outcome rather than a problem
-- with this file: those rows have to be resolved before the rule can be
-- true of them.
DROP INDEX IF EXISTS submissions_supersedes;

CREATE UNIQUE INDEX IF NOT EXISTS submissions_supersedes_unique
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
-- GET /snapshot needs a member session. That gate decides who reads
-- this document and not what may go in it: it carries no handles and no
-- rows, which is why losing the session check here would be a smaller
-- failure than losing one anywhere else and is still a failure. The one
-- table served without a credential is `site_content`, and the
-- difference is what each one holds - counts about people here, site
-- copy there. See DESIGN.md, "The dashboard and the snapshot".
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

-- The site copy an admin can change without a release, and the one
-- table here that GET serves to a caller with no credential.
--
-- That is not a relaxation of the rule above it. Each page ships the
-- copy it needs in its own HTML and reads this table to override it,
-- and apps/web is copied verbatim to a public site - so these values
-- stand in for bytes anybody can already fetch. A gate here would
-- promise a confidentiality the fallback does not have, and the cost of
-- promising it is that somebody eventually puts something private in a
-- table meant for site copy. Nothing about a person goes here; the
-- lists of people are `membership` below, behind the admin gate.
--
-- `name` rather than `key`, because in this repository a key is a
-- cryptographic key and this table holds neither one nor anything
-- derived from one. One row per name, replaced in place: a pane that
-- re-posted a whole document would delete the names it never rendered,
-- so a write carries one name and the rest are untouched.
--
-- `updated_by` is an account id and is deliberately not served - a
-- document anybody may fetch is the wrong place to publish which
-- account did anything. It carries the literal "break-glass" for an
-- EXPORT_TOKEN write, which cannot collide with an account id because
-- an account id is sixty-four hex characters.
--
-- The form definition is NOT this table and is not coming to it. A
-- wrong bound there gets sealed into a record and is discovered on
-- export day, so it stays a repo file the gate reads before it ships.
-- DESIGN.md, "Where configuration lives", holds the rule and the reason
-- the line falls where it does.
CREATE TABLE IF NOT EXISTS site_content (
  name       TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

-- Who administers, and who bypasses the group check (#69). Readable and
-- writable by an admin session and by nothing else.
--
-- The key is the account id - HMAC(ACCOUNT_SECRET, numeric id), the same
-- value the rows in `submissions` carry - and never the numeric id
-- itself. DESIGN.md, "The identifier is the whole problem", states that
-- as a prohibition rather than a preference: a numeric id resolves to a
-- person for anyone who can point a bot at it, so a table of them would
-- turn a database breach from "some account submitted twelve times",
-- the grouping that document accepts knowingly, into "here are the
-- group's admins, by name". The HMAC is exactly as un-invertible as the
-- ids stored beside it.
--
-- `label` is the price of that: a list of HMACs answers nobody, so an
-- admin types a nickname when they add a row. It is a label somebody
-- wrote and not a verified handle, so it proves nothing about a Telegram
-- account - the id-is-identity, handle-is-display split a submission row
-- already carries.
--
-- THIS TABLE IS ENFORCING. A row here grants what it says it grants:
-- server/worker.js unions `admin` rows with ADMIN_TELEGRAM_IDS in
-- adminAccountIds(), and `always_allow` rows with
-- ALWAYS_ALLOW_TELEGRAM_IDS in isGroupMember(). Both arms are live, and
-- handleReadMembership carries the whole argument for why dual-read is
-- what ships rather than a step passed through.
--
-- Anybody reading this file to build an admin surface needs that before
-- anything else, and needs it PER DIRECTION, because the three do not
-- take effect together:
--
--   * REMOVING an `admin` row bites on that session's very next
--     request. sessionFor() re-reads this table on every request and
--     the re-read can only take adminness away, so nothing has to
--     expire first. That lever is what #69 asked for.
--   * ADDING an `admin` row changes nothing for a session that already
--     exists. The `is_admin` flag written at sign-in is a necessary
--     condition the re-read cannot switch on, so a new admin signs out
--     and back in. A surface reporting success while the person sees
--     no new powers is looking at this, not at a failed write.
--   * An `always_allow` row is consulted inside sign-in and nowhere
--     else, so neither adding nor removing one touches a session that
--     is already open; both land at the next sign-in.
--
-- OPERATIONS.md states the same three where an operator meets them.
--
-- Whatever else moves, the founding admin stays in the secret. A table
-- that could rewrite the whole list would leave no root of trust outside
-- itself, and an empty table would lock everybody out permanently -
-- which is why the last `admin` row cannot be deleted, guarded inside
-- the DELETE statement rather than by a count read beforehand.
--
-- TELEGRAM_GROUP_CHAT_ID does not belong here and is not coming. It has
-- to be recoverable in the clear because isGroupMember() interpolates it
-- into a URL, it is one value rather than a list, and it names a chat
-- rather than people.
CREATE TABLE IF NOT EXISTS membership (
  account_id TEXT NOT NULL,
  role       TEXT NOT NULL,
  label      TEXT NOT NULL,
  added_at   TEXT NOT NULL,
  added_by   TEXT NOT NULL,
  PRIMARY KEY (account_id, role)
);
