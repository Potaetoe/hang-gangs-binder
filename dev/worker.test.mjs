/*
 * Round-trip checks for server/worker.js.
 *
 *     node dev/worker.test.mjs
 *
 * A Worker is a fetch handler over the same Request/Response/URL that
 * Node ships, so the real routing, validation and CORS logic runs here
 * against a stub D1 binding. No wrangler, no account, no network.
 *
 * The source is imported through a data: URL rather than by path
 * because server/worker.js uses ESM syntax and this repository has no
 * package.json - Node would otherwise read a bare .js as CommonJS and
 * choke on `export default`. Adding a package.json to a project whose
 * whole point is having no build step and no dependencies seemed a
 * worse trade than three lines here. This still tests the file's real
 * bytes, which is what matters.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { suite } from "./harness.mjs";

/* The Worker stores a session by the SHA-256 of its token, so a row this
   file seeds directly has to be keyed the same way. Only the seeded
   rows need it - every other session here arrives through a route that
   does its own hashing. */
const sha256Hex = (text) =>
  createHash("sha256").update(text, "utf8").digest("hex");

const SOURCE = fileURLToPath(new URL("../server/worker.js", import.meta.url));
const src = await readFile(SOURCE, "utf8");
/* server/worker.js imports its neighbours in server/ - ./store-crypto.js
   (0.9-M1-S6, #332) and ./charts-agg.js (0.9-M2-S0, #351) - and a data:
   module has no base URL to resolve a relative specifier against, so
   Node throws before a single check runs. Each specifier is rewritten to
   the real file's absolute URL, so this still tests the file's real
   bytes (the reason for the data: URL) while the imports resolve. The
   rewrite is general since a second relative import arrived and was
   handled deliberately, which is what the scoping was for; it stays
   anchored to `./<name>.js` in server/, so an import reaching outside
   that directory still fails loudly. */
const serverModule = (name) => pathToFileURL(
  fileURLToPath(new URL("../server/" + name, import.meta.url))).href;
const { default: worker } = await import(
  "data:text/javascript," + encodeURIComponent(src.replace(
    /(\bfrom\s*)"\.\/([\w.-]+\.js)"/g,
    (whole, from, name) => from + '"' + serverModule(name) + '"'))
);

/*
 * The schema is read for exactly one fact: whether `supersedes` carries a
 * UNIQUE index. The stub below enforces that constraint only if this file
 * says the database has it, which puts the index itself under test rather
 * than assuming it - delete the word UNIQUE in server/schema.sql and the
 * race check goes red instead of passing against a database carrying no
 * such rule. Nothing else here reads SQL off disk and nothing needs to:
 * every other statement under test arrives from the Worker.
 *
 * THE COMMENTS COME OUT FIRST, and that is the whole of what makes this
 * read a fact rather than a mood. server/schema.sql explains its own
 * index by quoting the statement - `CREATE UNIQUE INDEX IF NOT EXISTS`
 * appears in the prose above it - and a regex over the raw file cannot
 * tell the explanation from the rule. It is worse than a false positive
 * on the file as it stands: `[^;]*` stops at the first semicolon, so
 * whether the prose matches depends on which statements sit between it
 * and the index, and removing the DROP is what lets the match run out of
 * the comment and into a reverted, NON-unique `ON submissions(supersedes)`
 * below it. The arm therefore stayed green against exactly the schema it
 * exists to refuse. Strip `--` to end of line and the question is asked
 * of SQL only.
 */
const SCHEMA = await readFile(
  fileURLToPath(new URL("../server/schema.sql", import.meta.url)), "utf8");
const SUPERSEDES_IS_UNIQUE =
  /CREATE\s+UNIQUE\s+INDEX[^;]*\bON\s+submissions\s*\(\s*supersedes\s*\)/i
    .test(SCHEMA.replace(/--[^\n]*/g, ""));

/*
 * A REAL SQL ENGINE, LOADED HERE BECAUSE THE COUNT BELOW DEPENDS ON IT.
 * What it is for is at "The guard as SQLite runs it" near the end of
 * this file; it is loaded up here only because suite() takes the number
 * of checks to expect and that number is not the same on a runtime
 * without this module.
 *
 * `node:sqlite` arrived after Node 20, so this import fails on any
 * runner still pinned there and succeeds on the machine this repository
 * is developed on. Neither outcome may be quiet. When it is missing the
 * arms that execute the guard do not run, the expected count drops by
 * exactly their number, and the run says so on stdout - a check that
 * reported `pass` because it could not reach its subject is the
 * armed-looking failure this repository holds to be worse than having
 * no check, and a check that announces it did not run is the live
 * ledger's `never` row wearing a suite's clothes. Nothing here shims
 * around the absence.
 *
 * THE NOTE IS GATED ON THE VALUE, NOT ON THE THROW, because the arms
 * below are: `EXECUTED_GUARD_ARMS` reads `DatabaseSync`, so any absence
 * that leaves it unset skips six arms, and an absence that does not
 * throw would skip them without a word. Importing a module that loads
 * fine and does not export this name is exactly that third outcome, and
 * "neither outcome may be quiet" is an absolute the catch alone cannot
 * keep.
 */
let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  /* The note below covers this absence and every quieter one. */
}
if (!DatabaseSync) {
  console.log("note  node:sqlite is absent on " + process.version +
    " - the guard's SQL is pinned as text below and NOT executed here. " +
    "Its execution arms did not run and are not counted.");
}
const EXECUTED_GUARD_ARMS = DatabaseSync ? 6 : 0;

/*
 * A D1 binding that remembers what it was asked to store.
 *
 * It reads just enough of the SQL to tell the tables apart, because
 * they behave differently in the ways that matter: sessions is looked up
 * by one key, swept by expiry, and has one row's deadline moved forward
 * when it is used; submissions appends, counts per account, can lose a
 * row, and answers the two lookups a correction is checked against;
 * site_content and membership are keyed, so a second write of the same
 * row must replace it rather than sit beside it.
 *
 * A stub that ignored the statement entirely would let a publish that
 * appended a second row pass, and would let a delete that removed
 * everybody's rows pass too.
 */
let stored = [];
let sessions = [];
let content = [];
let roster = [];
// The member directory a verified sign-in refreshes (0.9-M1-S11, #340;
// server/schema.sql, `directory`). Its own bucket rather than the
// submissions default below, so a directory UPSERT does not land among
// the rows /me counts and /my-entries opens - which it would if it fell
// through to `stored`, since its ciphertext is sealed for purpose 'dir'
// and openRow refuses it. This suite does not assert on the directory
// (tests/roster-directory.test.mjs and tests/telegram-auth.test.mjs do);
// it only has to keep the write off the submissions path.
const directory = [];
// The change log every admin write appends to (0.9-M3-S8, #414;
// server/schema.sql, `admin_log`). Its own bucket for the same reason
// the directory has one: without it the table detection below falls
// through to the submissions default, and every admin write would put a
// row among the ones /me counts. This suite does not assert on the log;
// it only has to keep the write off the submissions path.
const adminLog = [];

/*
 * Payloads already spent (0.9-M1-S5, #331; server/schema.sql,
 * `auth_replay`).
 *
 * A Map rather than an array because the table's whole behavior is its
 * PRIMARY KEY: the Worker claims a payload with an INSERT carrying
 * ON CONFLICT DO NOTHING and reads `meta.changes` to learn whether it
 * won. Modelled with an array and a scan, a stub would answer the same
 * for a first claim and a second one, and an implementation that
 * dropped the guard entirely would stay green here.
 */
let replay = new Map();

/*
 * What was asked, as well as what was stored.
 *
 * `executed` is one entry per statement run, carrying the batch it
 * arrived in (0 for none); `batches` is one entry per batch() call,
 * holding those same entries. Together they are the only way to assert
 * the last-admin guard's MECHANISM rather than its outcome - see the
 * comment on batch() below for why the outcome is not enough.
 */
let executed = [];
let batches = [];

/*
 * Simultaneity, which a single-threaded stub cannot produce on its own.
 *
 * With a guard reading the table as it stands, the guard always wins the
 * race: whichever correction runs second sees the first one's row and
 * refuses, so the UNIQUE index never fires and an index that had silently
 * gone missing would look exactly like one that was there. Set this and a
 * batch's guard reads the table as it was when that batch BEGAN - which
 * is what either of two overlapping transactions sees from inside itself
 * - so both guards pass and the constraint is the only thing left that
 * can refuse. It is the difference between testing the belt and testing
 * the braces, and both are load-bearing here for different failures.
 */
let overlappingBatches = false;
let batchViews = [];

/*
 * A database failure this route did not cause, stated where D1 would
 * raise one.
 *
 * POST /submit catches exactly one error out of its correction batch -
 * the UNIQUE index on `supersedes` refusing a correction that lost a
 * race - and answers it as a refusal the member can act on. Every other
 * failure has to reach fetch()'s handler instead, because a refusal the
 * member is told to act on is the wrong sentence for a fault they cannot
 * do anything about.
 *
 * Nothing this stub can be driven into produces that case on its own:
 * `submissions` carries one unique constraint today, so every UNIQUE
 * violation reachable through these routes IS the one that is absorbed,
 * and the discrimination therefore sits unarmed - delete it outright and
 * every other arm in this file stays green. Naming the error is what
 * makes the second UNIQUE index somebody adds later a case this suite
 * has already been asked about rather than one it silently absorbs.
 *
 * The rows are put back rather than left, because a transaction that
 * rejects wrote nothing. A stub that kept the row would let this arm
 * pass against an implementation that stored one and then reported a
 * failure - which is the same success-with-no-row inversion the
 * read-back on this route exists to refuse.
 */
let batchRejects = null;

function reset() {
  stored = [];
  sessions = [];
  content = [];
  roster = [];
  replay = new Map();
  mintedPayloads = 0;
  executed = [];
  batches = [];
  overlappingBatches = false;
  batchViews = [];
  batchRejects = null;
}

/*
 * The EXISTS predicates a correction is checked against, read off the
 * statement in the order they appear rather than mapped by hand.
 *
 * Both statements POST /submit sends for a correction are built from the
 * same two SQL fragments in server/worker.js - one asks whether the
 * target is the caller's, the other whether something already corrects it
 * - so a stub that hand-modelled either rule would agree with whatever
 * this file expected rather than with what the Worker actually sent.
 * Reading them is what keeps the mutations visible: dropping
 * `AND account_id = ?` and its binding makes the ownership clause find
 * somebody else's row here exactly as it would in D1, and removing a
 * clause outright lets the write through.
 *
 * Parameters are consumed in textual order from `offset`, which is how
 * SQLite binds them - so a clause that loses a column takes one fewer and
 * every clause after it shifts, the same misalignment a real database
 * would report rather than a discrepancy this file papers over.
 */
function existsClauses(text) {
  return Array.from(text.matchAll(
    /(NOT\s+)?EXISTS\s*\(\s*SELECT 1 FROM submissions WHERE ([^)]+)\)/gi))
    .map((m) => ({
      negated: Boolean(m[1]),
      columns: Array.from(m[2].matchAll(/(\w+)\s*=\s*\?/g)).map((c) => c[1]),
    }));
}

function evaluateClauses(clauses, args, offset, rows) {
  let at = offset;
  return clauses.map((clause) => {
    const wanted = args.slice(at, at + clause.columns.length);
    at += clause.columns.length;
    const found = rows.some((row) =>
      clause.columns.every((column, index) => row[column] === wanted[index]));
    return clause.negated ? !found : found;
  });
}

const DB = {
  prepare: (sql) => {
    const table = /auth_replay/i.test(sql) ? "auth_replay"
      : /site_content/i.test(sql) ? "site_content"
      : /membership/i.test(sql) ? "membership"
      : /sessions/i.test(sql) ? "sessions"
      : /\bdirectory\b/i.test(sql) ? "directory"
      : /\badmin_log\b/i.test(sql) ? "admin_log"
      : "submissions";
    const verb = /^\s*(\w+)/.exec(sql)[1].toUpperCase();
    const counting = /COUNT\(\*\)/i.test(sql);

    /*
     * The keyed tables are modelled from the statement rather than by
     * hand: the columns an INSERT names, the ones its ON CONFLICT
     * clause re-writes, and the columns a WHERE binds.
     *
     * Reading them off the SQL is what keeps three mutations visible. A
     * stub that mapped parameters by hand would agree with whatever
     * this file expected rather than with what the Worker sent. One
     * that replaced every column on a conflict would pass an upsert
     * that resets `added_at`, so "when this row was added" would
     * quietly become "when its label was last typed". One that ignored
     * the WHERE would pass a delete that took the row out of both
     * roles, or out of somebody else's.
     */
    const insertInto = /INSERT INTO \w+\s*\(([^)]*)\)/i.exec(sql);
    const insertColumns = insertInto
      ? insertInto[1].split(",").map((c) => c.trim()) : [];
    const conflict = /DO UPDATE SET\s+([\s\S]+?)\s*$/i.exec(sql);
    const conflictColumns = conflict
      ? conflict[1].split(",").map((c) => c.trim().split(/\s*=\s*/)[0]) : [];
    const where = /WHERE\s+([\s\S]+?)(?:\s+ORDER BY[\s\S]*)?$/i.exec(sql);

    /*
     * `COLLATE NOCASE` is read off the statement beside the column it
     * applies to, because a stub that compared every bound column with
     * === would pass a DELETE that dropped the collation - and dropping
     * it is exactly the bug: an account id stored in upper-case hex by
     * `wrangler d1 execute` becomes a row that no request can remove.
     * SQLite applies the explicit collation of either operand, and here
     * only the parameter carries one.
     */
    /*
     * `LIKE ?` is read the same way and answered as SQLite answers it,
     * which since 0.9-M3-S11 (#419) is how `site_content` is split in
     * two: the field-spec namespace is one read and everything else is
     * its complement. Two properties of LIKE are written out rather
     * than approximated, and each is a mutation that would otherwise be
     * invisible - it is CASE-INSENSITIVE for ASCII, which is what puts
     * a hand-written `Field.Gender` row on the same side of the split
     * as `field.gender`, and a trailing `%` is a prefix rather than an
     * equality, which is what makes the split a namespace at all. Only
     * the trailing-wildcard shape both statements use is supported; a
     * pattern with a wildcard anywhere else throws rather than
     * pretending, for the reason every statement this stub does not
     * recognize does.
     */
    const clause = (m) => (m[2]
      ? { column: m[1], like: true, negated: /NOT/i.test(m[2]) }
      : { column: m[1], fold: Boolean(m[3]) });
    const bound = where
      ? Array.from(where[1].matchAll(
        /(\w+)\s*(?:(NOT\s+LIKE|LIKE)\s*\?|=\s*\?(\s+COLLATE\s+NOCASE)?)/gi))
        .map(clause) : [];
    const folded = (value, fold) =>
      (fold && typeof value === "string" ? value.toLowerCase() : value);
    const likeMatch = (value, pattern) => {
      const text = String(pattern);
      if (/[%_]/.test(text.slice(0, -1)) || !text.endsWith("%")) {
        throw new Error("a LIKE pattern this stub does not model: " + text);
      }
      return String(value).toLowerCase()
        .startsWith(text.slice(0, -1).toLowerCase());
    };
    const matches = (row, a) => bound.length > 0 &&
      bound.every((b, index) => (b.like
        ? likeMatch(row[b.column], a[index]) !== b.negated
        : folded(row[b.column], b.fold) === folded(a[index], b.fold)));

    /*
     * The last-admin guard, which is a subquery inside the DELETE
     * rather than a count the Worker reads first - that is what makes
     * it one statement and therefore atomic. It has no `?` in it, so
     * the parameter reading above cannot see it, and a stub that did
     * not model it would delete the row anyway and pass an
     * implementation carrying no guard at all.
     *
     * THREE THINGS READ OFF IT RATHER THAN ONE, because the guard has
     * three moving parts and hard-coding any of them here would pass an
     * implementation that dropped it. The count and its role come out
     * of `guard`; `countsGrantsOnly` is whether the subquery carries
     * the grants test, so a subquery that went back to counting every
     * row lets the dud inflate the count here exactly as it would in
     * D1; and `sparesADud` is whether the DELETE exempts a target that
     * grants nothing, so an implementation dropping that arm makes the
     * dud unremovable here rather than quietly staying green.
     *
     * The role and the alias are optional in the pattern on purpose:
     * the wide guard this replaced still parses, so reverting the
     * Worker to it is modelled rather than unrecognised - an
     * unrecognised statement would read as "no guard" and take the
     * arms down in the wrong direction.
     */
    const GRANTS_IN_SQL =
      /length\(\s*(?:\w+\.)?account_id\s*\)\s*=\s*64/i;
    const NOT_HEX_IN_SQL = /NOT GLOB '\*\[\^0-9a-f\]\*'/i;
    const guard =
      /(?:AND|OR) \(SELECT COUNT\(\*\) FROM membership(?: AS \w+)? WHERE (?:\w+\.)?role = '(\w+)'([\s\S]*?)\) > (\d+)/i
        .exec(sql);
    const countsGrantsOnly = Boolean(guard) &&
      GRANTS_IN_SQL.test(guard[2]) && NOT_HEX_IN_SQL.test(guard[2]);
    const spare = /AND \(NOT \(([\s\S]*?)\) OR \(SELECT COUNT\(\*\)/i.exec(sql);
    const sparesADud = Boolean(spare) &&
      GRANTS_IN_SQL.test(spare[1]) && NOT_HEX_IN_SQL.test(spare[1]);

    /* grantsAnything() as the statement above spells it, and the whole
     * question the narrowed guard asks: which rows the count can see. */
    const grantsInSql = (value) =>
      typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

    /*
     * A correction's two statements, neither of which looks like anything
     * else this stub is asked to run.
     *
     * The guarded INSERT carries its rules in its own WHERE, which is
     * what makes a refused correction store nothing even if the
     * diagnosis beside it were read wrong. The diagnosis is a SELECT
     * with no table at all - every FROM in it belongs to a subquery -
     * and that is how it is told apart here, rather than by keying on a
     * column alias that a rename would silently take away.
     */
    const clauses = existsClauses(sql);
    const diagnosis = verb === "SELECT" && clauses.length > 0 &&
      !/\bFROM\b/i.test(sql.replace(/\([^()]*\)/g, ""));
    const aliases = Array.from(sql.matchAll(/\bAS (\w+)/gi)).map((m) => m[1]);
    const viewFor = (batch) =>
      (batch && batchViews[batch - 1]) || stored;

    const upsert = (rows, key, a) => {
      const row = {};
      insertColumns.forEach((column, index) => { row[column] = a[index]; });
      const existing = rows.find((r) => key.every((k) => r[k] === row[k]));
      if (!existing) {
        rows.push(row);
        return;
      }
      for (const column of conflictColumns) existing[column] = row[column];
    };

    const exec = async (a, _batch) => {
      if (table === "auth_replay") {
        /*
         * The claim, and nothing else. `meta.changes` is what the Worker
         * reads to decide whether this payload was already spent, so it
         * is returned here rather than assumed: a stub answering 1 for
         * every INSERT would pass an implementation with no primary key
         * behind it, which is a replay guard that refuses nothing.
         */
        if (verb === "INSERT") {
          if (replay.has(a[0])) return { meta: { changes: 0 } };
          replay.set(a[0], a[1]);
          return { meta: { changes: 1 } };
        }
        // The sweep. Modelled rather than skipped, because a prune with
        // the comparison the wrong way round would empty the table on
        // every claim and turn the guard off without failing anything.
        for (const [key, expiresAt] of [...replay]) {
          if (expiresAt <= a[0]) replay.delete(key);
        }
        return { meta: { changes: 0 } };
      }
      if (table === "sessions") {
        if (verb === "DELETE") {
          if (/token_hash/i.test(sql)) {
            // Revoking removes exactly the row presented. A stub that
            // swept here instead would let a revoke that signed the
            // whole group out pass every assertion in this file.
            sessions = sessions.filter((s) => s.token_hash !== a[0]);
          } else if (/account_id/i.test(sql)) {
            // Ending every session one account holds. The rows are
            // chosen by the statement's own WHERE rather than by a rule
            // written here, so a WHERE that lost its account_id sweeps
            // this table exactly as it would sweep D1 - and the
            // bystander check below is what sees that happen.
            sessions = sessions.filter((s) => !matches(s, a));
          } else if (/expires_at/i.test(sql)) {
            const cutoff = Date.parse(a[0]);
            sessions = sessions.filter((s) => Date.parse(s.expires_at) > cutoff);
          } else {
            // The else that is not a silent skip. Three DELETEs are sent
            // against this table and they mean three different things -
            // one row, one account, everything expired. A fourth shape
            // arriving here without this arm would be modelled as
            // whichever branch happened to sit last and would pass.
            throw new Error("unmodelled DELETE against sessions: " + sql);
          }
        } else if (verb === "UPDATE") {
          // Sliding an idle window finds one row by token hash and moves
          // its deadline and nothing else. A stub that dropped the
          // UPDATE would let an implementation that never writes one
          // pass "using it is what slides the window back out".
          const row = sessions.find((s) => s.token_hash === a[1]);
          if (row) row.expires_at = a[0];
        } else {
          // The columns are read OFF THE STATEMENT rather than mapped
          // by hand: 0.9-M3-S8 (#414) inserted `admin_via` fifth, and a
          // positional map agrees with whatever this file expected
          // rather than with what the Worker sent - every session's
          // created_at silently became the source label, so every
          // deadline parsed to NaN and every credentialed route in the
          // matrix below answered 401.
          const row = {};
          insertColumns.forEach((column, index) => {
            row[column] = a[index];
          });
          sessions.push(row);
        }
      } else if (table === "directory") {
        // One UPSERT keyed by account_id, read off the statement the same
        // way membership is - joined_at kept, last_seen_at and the
        // ciphertext re-written - so the write is reproduced rather than
        // dropped, and kept out of `stored` where it would poison the
        // submissions reads.
        upsert(directory, ["account_id"], a);
      } else if (table === "admin_log") {
        // Append only, which is the table's whole shape - no key, no
        // conflict clause, nothing rewritten.
        adminLog.push(Object.fromEntries(
          insertColumns.map((column, index) => [column, a[index]])));
      } else if (table === "site_content") {
        // CASE IS FOLDED ON BOTH SIDES since 0.9-M3-S8 (#414): the
        // statements carry COLLATE NOCASE, and a stub matching byte for
        // byte would pass a delete that misses the row D1 would remove.
        if (verb === "DELETE") {
          const wanted = String(a[0]).toLowerCase();
          content = content.filter((r) =>
            String(r.name).toLowerCase() !== wanted);
        } else upsert(content, ["name"], a);
      } else if (table === "membership") {
        if (verb === "DELETE") {
          // The guard refuses by removing nothing, which is what a
          // conditional DELETE does in SQLite: the statement runs and
          // matches no row. Nothing here reports the refusal, and
          // nothing in D1 would either - the Worker learns it by
          // looking for the row afterwards, inside the same batch.
          //
          // Both halves read the table BEFORE the delete, because
          // SQLite evaluates a subquery against the snapshot the delete
          // applies to - that simultaneity is the whole reason the
          // guard is a subquery rather than a round trip, so a stub
          // that counted afterwards would model the race it closes.
          let blocked = false;
          if (guard) {
            const counted = roster.filter((r) => r.role === guard[1] &&
              (!countsGrantsOnly || grantsInSql(r.account_id)));
            const target = roster.find((r) => matches(r, a));
            const spared = sparesADud && target !== undefined &&
              !grantsInSql(target.account_id);
            blocked = !spared && counted.length <= Number(guard[3]);
          }
          if (!blocked) roster = roster.filter((r) => !matches(r, a));
        } else upsert(roster, ["account_id", "role"], a);
      } else if (verb === "DELETE") {
        /*
         * The rows the statement's own WHERE names, and nothing wider.
         * A member's delete binds `id AND account_id` and an admin's
         * binds `id` alone (0.9-M1-S6, #332), so reading the bound
         * columns rather than assuming `id` is what keeps the scoping
         * mutation visible: a member delete that lost its account clause
         * removes somebody else's row here exactly as it would in D1.
         */
        stored = stored.filter((r) => !matches(r, a));
      } else {
        /*
         * One INSERT of already-sealed bytes, with the row's id supplied
         * by the Worker rather than by AUTOINCREMENT (0.9-M1-S6, #332:
         * the id is bound into the ciphertext's AAD, so it has to exist
         * before the seal). The row is built from the columns the
         * statement NAMES, so a reordered or renamed column list is
         * modelled as D1 would model it rather than by a hand-written
         * position map that would agree with whatever this file expected.
         */
        const row = {};
        insertColumns.forEach((column, index) => {
          row[column] = a[index] === undefined ? null : a[index];
        });
        // A row with no pointer holds null rather than leaving the key
        // off, so a stub row answers `"supersedes" in row` the way a D1
        // row does - the export assertion reads exactly that.
        if (row.supersedes === undefined) row.supersedes = null;

        // The PRIMARY KEY. The Worker re-rolls its random id and re-seals
        // on this, so a stub that let a duplicate through would pass an
        // implementation with no collision handling at all.
        if (stored.some((r) => r.id === row.id)) {
          throw new Error("D1_ERROR: UNIQUE constraint failed: submissions.id");
        }

        /*
         * The UNIQUE index, enforced only where server/schema.sql says
         * the database carries one. NULLs are DISTINCT in a SQLite
         * UNIQUE index, so every ordinary submission - each of which
         * stores NULL here - sits beside every other one untouched;
         * modelling that is the difference between a stub that
         * reproduces the constraint and one that would refuse the second
         * plain submission anybody ever made.
         */
        if (SUPERSEDES_IS_UNIQUE && row.supersedes !== null &&
          stored.some((r) => r.supersedes === row.supersedes)) {
          throw new Error(
            "D1_ERROR: UNIQUE constraint failed: submissions.supersedes");
        }

        stored.push(row);
        return { meta: { changes: 1 }, changes: 1 };
      }
      return {};
    };

    // Which rows a correction hides. Whether a superseding row has to
    // belong to the same account is READ OFF the predicate rather than
    // decided here, because that is the whole of what makes scoping it
    // testable: with the rule hand-modelled, a Worker that stopped
    // scoping would still be counted the way this file expected, and the
    // mutation would be invisible in the only direction that matters.
    const sameAccountOnly =
      /newer\.account_id\s*=\s*mine\.account_id/i.test(sql);
    const namedByAnother = (row) =>
      stored.some((r) => r.supersedes === row.id &&
        (!sameAccountOnly || r.account_id === row.account_id));

    /*
     * The member-scoped listing, which is the one statement here that
     * projects columns AND computes one in the same select list.
     *
     * `project` above cannot read it, and the reason is worth stating
     * rather than working around: that regex takes everything up to the
     * first ` FROM `, and the first FROM in this statement belongs to
     * the subquery inside the computed column. It would hand back a
     * column list of fragments, every one of them absent from the row,
     * and the response would arrive empty while looking projected.
     *
     * So the select list is bounded and split at PAREN DEPTH ZERO. Split
     * on every comma instead and the computed column becomes three
     * fragments; bound at the first FROM instead and it becomes none.
     * Both failures are silent in the direction that matters - a column
     * this stub loses reads as a Worker that never sent it.
     */
    const depthZero = (text, find) => {
      let depth = 0;
      const at = [];
      for (let i = 0; i < text.length; i += 1) {
        if (text[i] === "(") depth += 1;
        else if (text[i] === ")") depth -= 1;
        else if (depth === 0 && find(text, i)) at.push(i);
      }
      return at;
    };

    const trimmed = sql.trim();
    const listing = verb === "SELECT" && !counting &&
      /\bFROM\s+submissions\s+AS\s+mine\b/i.test(sql);
    const listFrom = listing
      ? depthZero(trimmed, (t, i) => /^\s+FROM\s/i.test(t.slice(i, i + 6)))
      : [];
    const listItems = [];
    if (listing && listFrom.length) {
      const list = trimmed.slice("SELECT".length, listFrom[0]);
      let from = 0;
      for (const comma of depthZero(list, (t, i) => t[i] === ",")) {
        listItems.push(list.slice(from, comma).trim());
        from = comma + 1;
      }
      listItems.push(list.slice(from).trim());
    }

    /*
     * Each item modelled by what it IS, so the mutations stay visible.
     * A plain `mine.<column> AS <alias>` copies that column; an item
     * carrying an EXISTS over `supersedes` is answered by the same
     * namedByAnother() the count above uses, whose account scoping is
     * read off this statement rather than written here - so a listing
     * that stopped scoping its supersede question flags a row another
     * account corrected, exactly as D1 would.
     *
     * Anything else THROWS rather than being dropped. A computed column
     * this stub does not model would otherwise arrive as undefined, and
     * an arm asserting the entry's key set would pass against a Worker
     * whose new column is permanently absent.
     */
    const projectListing = (row) => {
      const out = {};
      for (const item of listItems) {
        const copied = /^mine\.(\w+)\s+AS\s+(\w+)$/i.exec(item);
        if (copied) {
          out[copied[2]] = row[copied[1]];
          continue;
        }
        const computed = /\bAS\s+(\w+)$/i.exec(item);
        if (computed && /EXISTS/i.test(item) && /supersedes/i.test(item)) {
          out[computed[1]] = namedByAnother(row) ? 1 : 0;
          continue;
        }
        throw new Error("unmodelled column in a listing: " + item);
      }
      return out;
    };

    const read = (a) => {
      if (table === "sessions") {
        return sessions.find((s) => s.token_hash === a[0]) || null;
      }
      // Answered from the bound WHERE rather than left null, so a
      // future lookup against either keyed table is visible here. A
      // stub that answered "no such row" whatever was asked would let
      // a Worker that reads the membership table pass the assertions
      // below that say it does not read it yet.
      if (table === "site_content") {
        return content.find((r) => matches(r, a)) || null;
      }
      if (table === "membership") {
        return roster.find((r) => matches(r, a)) || null;
      }
      if (counting) {
        const mine = stored.filter((r) => r.account_id === a[0]);
        const live = mine.filter((r) => !namedByAnother(r));
        return {
          total: mine.length,
          superseded: mine.length - live.length,
          last_at: live.length
            ? live.map((r) => r.received_at).sort().pop() : null,
        };
      }
      // The two lookups POST /submit makes before it stores anything,
      // modelled by their predicates rather than by a fixed answer. A
      // stub that always found a row would pass an implementation that
      // never checked ownership; one that never found a row would pass
      // an implementation whose checks refuse everything.
      //
      // The owner is matched only when the statement bound one, so a
      // lookup that drops `AND account_id = ?` finds somebody else's row
      // here exactly as it would in D1. Reading the parameter list is
      // what keeps that mutation visible rather than turning it into a
      // statement this stub simply fails to recognise.
      if (/WHERE id = \?/i.test(sql)) {
        return stored.find((r) => r.id === a[0] &&
          (a.length < 2 || r.account_id === a[1])) || null;
      }
      if (/WHERE supersedes = \?/i.test(sql)) {
        return stored.find((r) => r.supersedes === a[0]) || null;
      }
      return null;
    };

    // The column list the statement actually asked for. Handing back the
    // whole stored row whatever was selected would pass an export that
    // dropped `supersedes`, which is the one field the keyholder's
    // browser needs in order to tell a correction from a repeat.
    const selected = /^\s*SELECT\s+([\s\S]+?)\s+FROM/i.exec(sql);
    const columns = selected
      ? selected[1].split(",").map((c) => c.trim()) : null;
    const project = (row) => {
      if (!columns) return row;
      const out = {};
      for (const column of columns) {
        if (column in row) out[column] = row[column];
      }
      return out;
    };

    const rowsOf = () => (table === "site_content" ? content
      : table === "membership" ? roster : stored);

    /*
     * Every execution is recorded before it runs, so a check can ask
     * which statements a request sent and how they travelled. That
     * record is the whole of the last-admin guard's mechanism test: two
     * implementations with identical effects on `roster` differ only in
     * whether the count and the delete arrive together.
     */
    const note = (batch) => {
      const record = { sql: sql, table: table, batch: batch || 0 };
      executed.push(record);
      if (batch) batches[batch - 1].push(record);
    };

    return {
      bind: (...a) => ({
        run: () => { note(0); return exec(a); },
        first: async () => { note(0); return read(a); },
        /*
         * D1 answers .all() on a write by running it and handing back
         * an empty result set, which is what lets one shape carry every
         * statement in a batch. Both halves are load-bearing here: a
         * stub that answered reads only would turn the batched delete
         * into a no-op and pass an implementation that removes nothing,
         * and one that ran the write but answered the read from the
         * whole table would pass an implementation whose guard never
         * fires.
         *
         * The `batch` parameter belongs to this stub and not to D1,
         * which hands .all() nothing and is called with nothing. So a
         * statement run outside a batch records 0 without a
         * module-level flag that two overlapping requests would share.
         */
        all: async (batch) => {
          note(batch);
          if (verb !== "SELECT") {
            // `meta.changes` is how D1 reports whether a conditional
            // write did anything, and it is the only honest answer to
            // "did my row land" for a statement that may refuse itself.
            return { results: [], meta: await exec(a, batch) };
          }
          if (diagnosis) {
            // Each predicate answers 1 or 0 under the alias the
            // statement gave it, which is what SQLite returns for a bare
            // SELECT of an EXISTS.
            const values =
              evaluateClauses(clauses, a, 0, viewFor(batch));
            const row = {};
            aliases.forEach((name, index) => {
              row[name] = values[index] ? 1 : 0;
            });
            return { results: [row] };
          }
          if (listing) {
            if (!listItems.length) {
              throw new Error("a listing whose select list is unreadable, " +
                "which would answer empty and look scoped: " + sql);
            }
            /*
             * A statement whose WHERE binds nothing selects the WHOLE
             * table, because that is what D1 does with one. The generic
             * path below cannot say that - `matches` refuses every row
             * when nothing is bound - so a listing that lost its account
             * clause would read here as one that found nobody's rows
             * instead of as one that found everybody's. The mutation
             * that matters on this route has to produce the leak, not a
             * blank.
             */
            let visible = bound.length
              ? rowsOf().filter((r) => matches(r, a)) : rowsOf();
            /*
             * ORDER BY, modelled from the statement rather than left to
             * insertion order - COLUMN AND DIRECTION BOTH.
             *
             * Without the column the stub answers out of an array that
             * is already in id order, so the clause is unexercised - and
             * a route that ordered by something READ OFF THE ROW would
             * pass every arm here. That is not hypothetical: ordering a
             * member's listing by ciphertext length makes which rows are
             * member-readable inferable from the response, which is a
             * branch on row contents this route must not have. Sorting
             * by the named column is what lets an arm assert the exact
             * sequence and mean it.
             *
             * The direction is the same argument one step further in,
             * and it is the half a sorted-ascending stub silently
             * supplies: with it hard-coded, `ORDER BY mine.id DESC`
             * answers the same ids as `ORDER BY mine.id` and the arm
             * asserting the sequence agrees with both. What that hides
             * is the cap. server/worker.js promises a member who reaches
             * MAX_ENTRY_LISTING their OLDEST rows, so the direction
             * decides which 500 of them the response carries, and a
             * listing that started at the other end would be a different
             * answer no arm here could tell from this one.
             *
             * A statement naming neither keyword is ascending, which is
             * what SQLite does with one.
             */
            const order = /\bORDER BY\s+mine\.(\w+)(?:\s+(ASC|DESC))?\b/i
              .exec(trimmed);
            if (order) {
              const column = order[1];
              const sign = /^desc$/i.test(order[2] || "") ? -1 : 1;
              visible = visible.slice().sort((x, y) => sign *
                (x[column] > y[column] ? 1 : x[column] < y[column] ? -1 : 0));
            }
            /*
             * The row cap, read off the statement for the same reason
             * every other rule here is. Ignoring it would let a Worker
             * that dropped the clause answer the same rows this stub
             * already had in hand, so the arm asserting the cap would
             * pass against no cap at all; applying a number written
             * here instead would agree with this file rather than with
             * what was sent. A statement with no LIMIT is unbounded,
             * which is what D1 does with one.
             */
            const capped = /\bLIMIT\s+(\d+)\s*$/i.exec(trimmed);
            const rows = capped
              ? visible.slice(0, Number(capped[1])) : visible;
            return { results: rows.map(projectListing) };
          }
          return { results: rowsOf().filter((r) => matches(r, a)).map(project) };
        },
      }),
      // Statements with no parameters run straight off prepare().
      run: () => { note(0); return exec([]); },
      first: async () => { note(0); return read([]); },
      all: async () => {
        note(0);
        return { results: rowsOf().map(project) };
      },
    };
  },

  /*
   * D1 runs a batch as one transaction, statement by statement, and
   * answers with one result per statement in the shape .all() gives.
   *
   * THE TRANSACTION IS NOT MODELLED, and reading this loop as though it
   * were is how the mechanism went unasserted. Statements run here in
   * isolation, exactly as they would if the Worker had sent them one at
   * a time - so an implementation that counts the admins in one round
   * trip, decides in JavaScript, and then sends an unguarded DELETE
   * leaves `roster` in the same state as the batched one, and every
   * outcome assertion in this file agrees with both. That is the race
   * the guard exists to close, so it cannot be the thing no check can
   * see.
   *
   * What IS modelled is the invocation: which statements arrived in
   * which batch() call. The checks read `batches` and `executed` and
   * assert the mechanism directly - one batch call, both statements
   * inside it, and nothing counting admins outside it.
   */
  batch: async (statements) => {
    batches.push([]);
    const id = batches.length;
    // The table as this batch found it, kept only while two batches are
    // being made to overlap on purpose. Null the rest of the time, so
    // every other check in this file reads the table as it stands.
    batchViews[id - 1] = overlappingBatches ? stored.slice() : null;
    // What the table held before this transaction opened, kept so an
    // injected rejection can undo the statements that ran before it.
    const opened = stored.slice();
    const out = [];
    for (const statement of statements) out.push(await statement.all(id));
    if (batchRejects) {
      stored = opened;
      throw new Error(batchRejects);
    }
    return out;
  },
};

/*
 * A bot token, and payloads signed with it the way Telegram signs them.
 *
 * Signing here rather than committing a fixture is deliberate: a fixture
 * would carry a fixed auth_date and the freshness check would start
 * rejecting it five minutes after it was written. What IS committed is
 * the account-id fixture below, where a fixed answer is the whole point.
 */
const BOT_TOKEN = "8123456789:AAtest-bot-token-value-for-the-suite";

const hex = (buffer) => Array.from(new Uint8Array(buffer))
  .map((b) => b.toString(16).padStart(2, "0")).join("");

/*
 * One second older per payload minted, and this is not cosmetic
 * (0.9-M1-S5, #331).
 *
 * A payload may be spent once - claimPayload() in server/worker.js. Two
 * sign-ins as the same account in the same second produce byte-identical
 * payloads, which is a replay by the Worker's definition and by
 * Telegram's: pressing the button twice inside one second really does
 * sign the same fields. This suite fires far faster than a person can,
 * and what it means by two sign-ins is two SEPARATE ones, so each minted
 * payload is dated one second before the last. It only ever grows, and
 * eighty-odd sign-ins stay far inside the five-minute window.
 *
 * It restarts at reset(), and that is not a convenience - it is the only
 * safe place for it to restart, in both directions. It has to restart
 * SOMEWHERE, because this file signs in far more than three hundred
 * times and a counter that only grew would eventually date a payload
 * past the five-minute window and refuse it for a reason that has
 * nothing to do with the arm under test. And it may only restart where
 * the spent-payload table is emptied, or a re-minted payload would be
 * one the Worker has correctly recorded as already used. reset() is the
 * one place both are true: it is this suite's "a fresh database", and a
 * fresh database has spent nothing.
 */
let mintedPayloads = 0;

/* The epoch is read ONCE. Re-reading Date.now() per mint let the clock
 * tick a second between two mints, which cancels the counter's
 * decrement and hands two payloads the same auth_date - identical
 * payloads, so the second one hits the replay guard with a 401 where
 * the case under test expected its own refusal. It cost a real landing
 * (PR #342's CI red, 2026-08-18) before it was pinned. */
const MINT_EPOCH = Math.floor(Date.now() / 1000);

async function signed(user = {}, secondsAgo = 0) {
  const payload = {
    auth_date: MINT_EPOCH - secondsAgo - mintedPayloads++,
    first_name: "Test",
    id: 4242,
    username: "somehandle",
    ...user,
  };
  // An absent field is absent from the signature too, which is how
  // Telegram treats a user with no @username.
  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined) delete payload[key];
  }
  const fields = Object.keys(payload).sort()
    .map((k) => k + "=" + payload[k]).join("\n");
  const secret = await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(BOT_TOKEN));
  const key = await crypto.subtle.importKey(
    "raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  payload.hash = hex(await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(fields)));
  return payload;
}

/*
 * The default worker under test is a CONFIGURED one: it names its group.
 * groupStanding() fails closed when no chat id is set (2nd audit
 * BLOCKER1), so a base env without one would refuse every sign-in this
 * suite mints - the fixture carries the id, and the default fetch stub
 * below answers "member" so the ordinary sign-in path returns a member.
 * The no-chat-id case is asserted deliberately, against an env that drops
 * this binding, where "Missing group config fails closed" lives.
 */
const env = {
  EXPORT_TOKEN: "sekrit-token-value",
  TELEGRAM_BOT_TOKEN: BOT_TOKEN,
  ACCOUNT_SECRET: "account-secret-for-the-suite",
  ADMIN_TELEGRAM_IDS: "99",
  TELEGRAM_GROUP_CHAT_ID: "-1001234567890",
  // Rows are sealed at rest since 0.9-M1-S6 (#332), so any route that
  // stores or reads one needs this. A throwaway sentence, long enough
  // to clear store-crypto's own minimum, opening nothing real.
  STORE_SECRET: "worker suite store secret / opens nothing / v1",
  DB: DB,
};

const SITE = "https://potaetoe.github.io";
const LOCAL = "http://localhost:8124";
const LOCAL_IP = "http://127.0.0.1:8124";
const TYPE = { "Content-Type": "application/json" };
const good = { Origin: SITE, ...TYPE };
const evil = { Origin: "https://evil.example", ...TYPE };

const call = (method, path, opts = {}, e = env) =>
  worker.fetch(new Request("https://w.dev" + path, { method, ...opts }), e);

const bearer = (t, headers = good) =>
  ({ ...headers, Authorization: "Bearer " + t });

/*
 * The Worker asks Telegram whether a signer is in the group, and with a
 * configured chat id (base env carries one) every ordinary sign-in now
 * takes that path. The default answer is "member", so a plain sign-in
 * mints a member; the sections that test departures, outages and the
 * group check itself SAVE this stub, install their own, and restore it -
 * so "realFetch" throughout this file means this stub, not Node's, which
 * keeps the many base-env sign-ins working after each of those sections.
 */
globalThis.fetch = async () => new Response(
  JSON.stringify({ ok: true, result: { status: "member" } }),
  { headers: TYPE });

/*
 * The count is asserted rather than only printed. This file is the
 * gating matrix - the one place where a check that stops running reads
 * as "nothing refused anybody" rather than as a missing row, and where
 * a silently absent refusal is itself the compromise. See
 * dev/harness.mjs.
 *
 * The addend is the only part of this number that is not a constant,
 * and it is a constant per runtime: on a Node carrying `node:sqlite`
 * the guard's execution arms run and are counted, and on one without it
 * they neither run nor count. Both worlds still catch a check that
 * stops running, which is what this arm is for - what they cannot do is
 * hide one, because the two totals differ by exactly the arms named
 * above.
 */
const { check, report } = suite("worker.js", 294 + EXECUTED_GUARD_ARMS);

async function statusOf(label, promise, want) {
  const res = await promise;
  check(label, res.status === want, `${res.status} (want ${want})`);
  return res;
}

const signIn = async (user, e = env, headers = good) =>
  call("POST", "/auth/telegram",
    { headers, body: JSON.stringify(await signed(user)) }, e);

/* ------------------------------------------------------------------ */
/* Signing in.                                                         */

reset();

const first = await signIn({});
const firstBody = await first.clone().json();
check("a correctly signed payload issues a session",
  first.status === 200 && typeof firstBody.session === "string" &&
  firstBody.username === "somehandle" && firstBody.isAdmin === false &&
  firstBody.isDev === false);

/*
 * The arm that asserted `telegramId` in the sign-in answer is GONE with
 * the field, in the same change that removed it (0.9-M1-S5, #331). It
 * existed so a first-time admin could read their own numeric id off the
 * page and put it in ADMIN_TELEGRAM_IDS. That secret stays, and
 * DESIGN.md, "Admin accounts and deletion", is where it is ruled: it is
 * what the first flag starts from. The echo is what nobody needs.
 * Whoever sets that value holds this deployment's configuration and
 * reads the id from Telegram, and every admin after the first is made
 * by a `membership` flag that names no numeric id at all, so a route
 * handing back the one identifier that resolves to a person stands
 * without a reason. Replaced here by its opposite, because a field
 * removed is a field that must stay removed.
 */
check("sign-in does not echo the caller's Telegram numeric id",
  firstBody.telegramId === undefined);

/*
 * The same payload cannot be spent twice, which is what stops one
 * captured payload from minting a second session beside the member's
 * own inside the freshness window. Asserted here as well as in
 * tests/telegram-auth.test.mjs because this is the gating matrix - the
 * file where a refusal that stops refusing has to show up.
 */
const spent = await signed({});
await statusOf("a payload that has already been spent is refused",
  call("POST", "/auth/telegram",
    { headers: good, body: JSON.stringify(spent) }), 200);
await statusOf("and presenting the very same payload again is refused",
  call("POST", "/auth/telegram",
    { headers: good, body: JSON.stringify(spent) }), 401);

/*
 * Tampering, both halves. A verifier that accepts an altered payload has
 * failed at the only thing it does, and it fails silently - every status
 * in this file would still be right.
 */
const claimingSomeoneElse = await signed({});
claimingSomeoneElse.id = 5;
await statusOf("a payload signed for someone else is refused",
  call("POST", "/auth/telegram",
    { headers: good, body: JSON.stringify(claimingSomeoneElse) }), 401);

const badHash = await signed({});
badHash.hash = badHash.hash.replace(/^./, (c) => (c === "a" ? "b" : "a"));
await statusOf("a payload with a changed hash is refused",
  call("POST", "/auth/telegram",
    { headers: good, body: JSON.stringify(badHash) }), 401);

/*
 * Freshness. Without it a captured payload never expires, because
 * nothing else in one does. This is the check that is easiest to leave
 * out, since nothing looks wrong when it is missing.
 */
await statusOf("a payload older than five minutes is refused",
  call("POST", "/auth/telegram",
    { headers: good, body: JSON.stringify(await signed({}, 600)) }), 401);

await statusOf("an unsigned body is refused",
  call("POST", "/auth/telegram",
    { headers: good, body: JSON.stringify({ id: 1 }) }), 401);

/* This binder identifies people by @username, so it says which thing to
 * go and fix rather than storing a blank where a handle should be. */
await statusOf("an account with no Telegram username is turned away",
  call("POST", "/auth/telegram",
    { headers: good, body: JSON.stringify(await signed({ username: undefined })) }),
  403);

const adminBody = await (await signIn({ id: 99 })).clone().json();
check("an id in ADMIN_TELEGRAM_IDS gets an admin session",
  adminBody.isAdmin === true);

const MEMBER = firstBody.session;
const ADMIN = adminBody.session;

/* ------------------------------------------------------------------ */
/* The account id, as a committed fixture.                             */

/*
 * The same argument as the ciphertext fixture in dev/crypto.test.mjs,
 * and the same rule: IF THIS FAILS, DO NOT REGENERATE IT. A changed
 * account id means every stored row has detached from the person who
 * wrote it, with nothing anywhere reporting it. The fix is to find what
 * changed, not to bless it.
 */
const FIXTURE_4242 =
  "a9246ad96523241df2d1823e6d8237ca26fbd848fdb74d12db531abee875a20c";
/* A 64-hex account id shaped like a namespaced subject's HMAC, for the
   hand-written is_dev rows below. It is in neither admin list, which is
   the whole point: no such id can be a numeric Telegram id's HMAC. */
const FIXTURE_DEV_SUBJECT =
  "20f2d196dc50d92d29b687e4e6b0ab4f30d622e954715e6f97be07a76e3c8ee1";

await call("POST", "/submit",
  { headers: bearer(MEMBER), body: JSON.stringify({ record: "{\"w\":1}" }) });
check("the account id derivation is unchanged",
  stored.length === 1 && stored[0].account_id === FIXTURE_4242,
  stored.length ? stored[0].account_id.slice(0, 20) + "â€¦" : "no row");

/* ------------------------------------------------------------------ */
/* POST /auth/dev - retired, and the difference that makes.            */

/*
 * These are still the most important assertions in this file. Every
 * other test here protects the data; these protect the boundary that
 * protects the data.
 *
 * WHAT THEY ASSERT IS AN ABSENCE, not a set of conditions failing
 * closed, and that is the stronger claim of the two (0.9-M2-S1, #352).
 * A local sign-in door held shut by four guards is only as good as the
 * next edit to any of them; a route that is not there cannot be got
 * wrong. So each arm below arranges everything such a door would want -
 * DEV_LOGIN_SECRET set, a loopback origin, the matching secret, an admin
 * subject - and demands 404 with nothing written.
 *
 * `devEnv` sets DEV_LOGIN_SECRET precisely because the binding is
 * meaningless. An arm that only tried the empty case would go green
 * against a Worker that still carried the route.
 */
const devEnv = {
  ...env,
  DEV_LOGIN_SECRET: "dev-secret",
  ALLOWED_ORIGINS: `${SITE},${LOCAL},${LOCAL_IP}`,
};

const sessionsBeforeDoor = sessions.length;

await statusOf("POST /auth/dev is 404 with no DEV_LOGIN_SECRET at all",
  call("POST", "/auth/dev", { headers: { Origin: LOCAL, ...TYPE },
    body: JSON.stringify({ secret: "anything", subject: "alice" }) }), 404);

await statusOf("404 WITH the secret set, from the loopback origin, with " +
  "the right secret - every condition the old door wanted",
  call("POST", "/auth/dev", { headers: { Origin: LOCAL, ...TYPE },
    body: JSON.stringify({ secret: "dev-secret", subject: "alice" }) },
  devEnv), 404);

await statusOf("404 from the numeric loopback origin too",
  call("POST", "/auth/dev", { headers: { Origin: LOCAL_IP, ...TYPE },
    body: JSON.stringify({ secret: "dev-secret", subject: "bob" }) },
  devEnv), 404);

await statusOf("404 for an admin subject, the shape that handed out the " +
  "whole corpus",
  call("POST", "/auth/dev", { headers: { Origin: LOCAL, ...TYPE },
    body: JSON.stringify(
      { secret: "dev-secret", subject: "root", admin: true }) },
  devEnv), 404);

check("and none of those four minted anything - the session table is " +
  "exactly as they found it",
  sessions.length === sessionsBeforeDoor,
  `${sessions.length} row(s), was ${sessionsBeforeDoor}`);

/* The bytes, not just the status. A route that answered 404 with its own
   wording would still be advertising itself to anybody reading the body,
   and this is the router's closing refusal rather than a handler's. The
   control is another path under the same API segment, so both answers
   come from this Worker rather than one of them falling through to the
   asset binding. */
const goneBody = await (await call("POST", "/auth/dev",
  { headers: { Origin: LOCAL, ...TYPE },
    body: JSON.stringify({ secret: "dev-secret", subject: "alice" }) },
  devEnv)).text();
const nowhereBody = await (await call("POST", "/auth/nothing-here",
  { headers: { Origin: LOCAL, ...TYPE }, body: "{}" }, devEnv)).text();
check("byte-identical to a path this Worker never served",
  goneBody === nowhereBody && goneBody === JSON.stringify(
    { error: "Not found." }), goneBody);

/* ------------------------------------------------------------------ */
/* The gating matrix.                                                  */

/*
 * Every route against every kind of caller. Cheap to write as a table,
 * and it is the thing most likely to be quietly wrong after a refactor -
 * a route that forgets to ask who is calling is a route with no gate,
 * and it behaves perfectly right up until somebody notices.
 */
const who = (t) => t === null ? "nobody" : t === MEMBER ? "a member"
  : t === ADMIN ? "an admin" : "the export token";

const matrix = [
  ["POST", "/submit", null, 401],
  ["POST", "/submit", MEMBER, 200],
  ["POST", "/submit", "sekrit-token-value", 401],
  ["GET", "/me", null, 401],
  ["GET", "/me", MEMBER, 200],
  /*
   * Reading your own entries needs an account to own them, so this is
   * the second route the break-glass token cannot reach - it is admin
   * and it is nobody. The whole corpus is already its by GET /export,
   * so nothing is withheld from it; what is refused is the request to
   * pick a member for a caller that is not one.
   */
  ["GET", "/my-entries", null, 401],
  ["GET", "/my-entries", MEMBER, 200],
  ["GET", "/my-entries", "sekrit-token-value", 401],
  ["GET", "/export", null, 401],
  ["GET", "/export", MEMBER, 401],
  ["GET", "/export", ADMIN, 200],
  ["GET", "/export", "sekrit-token-value", 200],
  // The /snapshot route is gone (0.9-M2-S3, #354), deleted rather than
  // gated - it is no longer API-shaped at all, so a table row here
  // asking who is refused would be asking a question this route no
  // longer poses. tests/route-precedence.test.mjs is where that fact
  // now lives, driven against a real ASSETS stub this file's stub env
  // does not carry (see the comment on the /auth/whatever row below).
  ["DELETE", "/submission/1", null, 401],
  // A member may delete THEIR OWN row since 0.9-M1-S6 (#332; DESIGN.md,
  // "Admin accounts and deletion": their data, their delete), so this is
  // 200 rather than the 401 it answered while deletion was admin-only.
  // It deletes nothing here - row 1 is not this member's - and deleting
  // nothing succeeds, which is the same answer a member naming somebody
  // else's id gets. That the row SURVIVES is what the scoping arm in
  // tests/entry-rows.test.mjs asserts; this table is about who is
  // refused at the door, and a member is no longer refused at this one.
  ["DELETE", "/submission/1", MEMBER, 200],
  // Only the non-destructive halves of DELETE /session belong in the
  // table; a revoke that succeeded here would kill MEMBER or ADMIN for
  // every row below it. The rest of that route is its own section.
  ["DELETE", "/session", null, 401],
  ["DELETE", "/session", "sekrit-token-value", 401],
  /*
   * Site content is the one thing here that answers a caller with no
   * credential at all, and both halves of that are in this table. The
   * read is open because every page's shipped HTML is the fallback for
   * these values and the deploy copies dist/ - apps/web with the
   * comments taken out (#181) - to a public site, so the bytes this
   * route enhances are world-readable already; the write is an admin
   * session because an admin is who edits a site.
   */
  ["GET", "/content", null, 200],
  ["GET", "/content", MEMBER, 200],
  ["POST", "/content", null, 401],
  ["POST", "/content", MEMBER, 401],
  ["POST", "/content", ADMIN, 200],
  ["POST", "/content", "sekrit-token-value", 200],
  ["DELETE", "/content/matrix", null, 401],
  ["DELETE", "/content/matrix", MEMBER, 401],
  ["DELETE", "/content/matrix", ADMIN, 200],
  /*
   * Membership is admin in both directions and in every one. The list
   * of who administers is the list DESIGN.md's whole account design
   * exists to keep private, so a member reading it is the failure, and
   * so is a member learning anything by being refused - which the
   * byte-for-byte section below is what actually pins.
   */
  ["GET", "/membership", null, 401],
  ["GET", "/membership", MEMBER, 401],
  ["GET", "/membership", ADMIN, 200],
  ["GET", "/membership", "sekrit-token-value", 200],
  ["POST", "/membership", null, 401],
  ["POST", "/membership", MEMBER, 401],
  ["POST", "/membership", ADMIN, 200],
  ["DELETE", "/membership/admin/" + FIXTURE_4242, null, 401],
  ["DELETE", "/membership/admin/" + FIXTURE_4242, MEMBER, 401],
  ["DELETE", "/membership/admin/" + FIXTURE_4242, ADMIN, 200],
  // Not "/whatever" (0.9-M1-S3, #329): a path outside the API segment
  // set now falls to env.ASSETS.fetch rather than reaching this 404 -
  // see isApiPath in server/worker.js and tests/route-precedence.
  // test.mjs, which is where that fallback is exercised against a
  // stubbed ASSETS binding this file's stub env does not carry. This
  // row keeps testing what it always tested - the router's own refusal
  // when nothing dispatches - on a path that is still API-shaped
  // (the "auth" segment) but matches no registered route.
  ["GET", "/auth/whatever", ADMIN, 404],
];

// One body per POST route rather than one shape for all of them. A
// single "whatever this route wants" object would let a route that
// stopped reading its body pass every row above. Every POST row in the
// matrix names an entry here - there is deliberately no fallback, so a
// row added without one throws rather than posting a body that means
// nothing to the route it names.
const MATRIX_BODY = {
  "/submit": { record: "{\"w\":1}" },
  "/content": { name: "matrix", value: "A line of copy." },
  "/membership": { telegramId: "31337", role: "admin", label: "Sam" },
};

for (const [method, path, token, want] of matrix) {
  const headers = token === null ? good : bearer(token);
  const body = method === "POST"
    ? JSON.stringify(MATRIX_BODY[path])
    : undefined;
  await statusOf(`${method} ${path} as ${who(token)}`,
    call(method, path, { headers, body }), want);
}

/* The break-glass token is admin, but it is nobody - so it cannot
 * submit, because submitting needs an account to submit to. */
check("the break-glass token has admin rights but no account",
  stored.filter((r) => r.account_id === FIXTURE_4242).length === 2,
  "only the member's own two rows");

await statusOf("a foreign origin is refused even with a valid session",
  call("POST", "/submit", { headers: bearer(MEMBER, evil),
    body: JSON.stringify({ record: "{\"w\":1}" }) }), 403);

/* ------------------------------------------------------------------ */
/* GET /me, and removing one row.                                      */

const me = await (await call("GET", "/me", { headers: bearer(MEMBER) })).json();
check("/me counts this account's rows and nobody else's",
  me.entries === 2 && me.isAdmin === false && me.isDev === false,
  `entries=${me.entries}`);

/* #56 keys the device-local prefill on this value, so it has to be the
 * account's real id rather than anything derived on the page. Asserted
 * against the committed fixture rather than against itself: comparing it
 * to `stored[0].account_id` would pass even if both were wrong together,
 * which is the shape of check that #34 paid for. */
check("/me returns the account's own id, matching the committed fixture",
  me.accountId === FIXTURE_4242,
  me.accountId ? me.accountId.slice(0, 20) + "â€¦" : "absent");
check("and it is the id the rows were actually written under",
  me.accountId === stored[0].account_id);

/* The break-glass caller is admin and is nobody, so it has no account id
 * to report. Asserted because handleMe's comment claims it is reported
 * rather than special-cased, and a claim in a comment that nothing checks
 * is how the comment and the code drift apart. It also matters to the
 * page: submit.js must not restore a device-local prefill when there is
 * no account to attribute it to. */
const glass = await (await call("GET", "/me",
  { headers: bearer("sekrit-token-value") })).json();
check("/me reports no account id for the break-glass token",
  glass.ok === true && glass.accountId === null && glass.isAdmin === true,
  `accountId=${JSON.stringify(glass.accountId)}`);

const before = stored.length;
await call("DELETE", "/submission/" + stored[0].id, { headers: bearer(ADMIN) });
check("an admin can remove one submission",
  stored.length === before - 1, `${before} -> ${stored.length}`);

await statusOf("removing a row that is not there still succeeds",
  call("DELETE", "/submission/99999", { headers: bearer(ADMIN) }), 200);

await statusOf("a non-numeric submission id is not a route",
  call("DELETE", "/submission/abc", { headers: bearer(ADMIN) }), 404);

/* ------------------------------------------------------------------ */
/* Sessions expire, and an expired one is refused rather than swept.   */

sessions.find((s) => s.account_id === FIXTURE_4242).expires_at =
  new Date(Date.now() - 1000).toISOString();
await statusOf("an expired session is refused",
  call("GET", "/me", { headers: bearer(MEMBER) }), 401);
check("looking one up is what clears the expired rows out",
  !sessions.some((s) => Date.parse(s.expires_at) <= Date.now()));

/* ------------------------------------------------------------------ */
/* Group membership.                                                   */

/*
 * The widget proves somebody has a Telegram account, not that they are
 * one of yours. With a chat id configured the Worker asks Telegram, and
 * the allowlist is what gets you back in if the bot is ever removed from
 * the group - the failure that would otherwise lock out everybody at
 * once, including whoever could fix it.
 */
const realFetch = globalThis.fetch;
let membership = "member";
globalThis.fetch = async () => new Response(JSON.stringify(
  membership === null
    ? { ok: false, description: "user not found" }
    : { ok: true, result: { status: membership } }), { headers: TYPE });

const gated = { ...env, TELEGRAM_GROUP_CHAT_ID: "-1001234567890" };

await statusOf("a member of the group may sign in", signIn({}, gated), 200);

membership = "left";
await statusOf("somebody who has left the group may not",
  signIn({}, gated), 403);

membership = null;
await statusOf("a stranger to the group may not", signIn({}, gated), 403);

await statusOf("the allowlist overrides the group check",
  signIn({}, { ...gated, ALWAYS_ALLOW_TELEGRAM_IDS: "4242" }), 200);

globalThis.fetch = async () => { throw new Error("Telegram unreachable"); };
await statusOf("an unreachable Telegram refuses rather than admits",
  signIn({}, gated), 403);
globalThis.fetch = realFetch;

/* ------------------------------------------------------------------ */
/* Leaving the group ends the session it left behind (#136).           */

/*
 * The gap this closes: sign-in asked Telegram, and nothing asked again.
 * A member who left the group kept a live session until it expired.
 *
 * What is asserted here is the WHOLE of the bound, in both directions,
 * because the two directions fail differently and only one of them is
 * loud. Revoking too little leaves the defect in place, which is
 * invisible. Revoking too much signs the group out during a Telegram
 * outage, which is invisible until the outage.
 *
 * `answer` is what Telegram says, set per case; an Error means the call
 * itself fails. `telegramCalls` counts the round trips, which is the
 * only way to assert that break-glass short-circuits BEFORE the network
 * rather than merely arriving at the same verdict afterwards.
 */
reset();

let telegramCalls = 0;
let answer = { ok: true, result: { status: "member" } };
globalThis.fetch = async () => {
  telegramCalls += 1;
  if (answer instanceof Error) throw answer;
  return new Response(JSON.stringify(answer), { headers: TYPE });
};

/* A session minted while Telegram still says "member", whatever the
 * case under test is about to make it say. Restoring `answer` rather
 * than leaving it set is what keeps each case independent of the last. */
const mintFor = async (user) => {
  const was = answer;
  answer = { ok: true, result: { status: "member" } };
  const token = (await (await signIn(user, gated)).json()).session;
  answer = was;
  return token;
};

const leaver = await mintFor({});
const bystander = await mintFor({ id: 7, username: "bystander" });
check("two accounts hold live sessions before any of this",
  sessions.length === 2, `${sessions.length} sessions`);

answer = { ok: true, result: { status: "left" } };
await statusOf("a leaver is refused at their next sign-in",
  signIn({}, gated), 403);
await statusOf("and the session they were still holding is gone",
  call("GET", "/me", { headers: bearer(leaver) }), 401);
/* The control, and the reason it is here: a revocation that swept the
 * table would satisfy every assertion above it and sign out the group. */
await statusOf("while another account's session is untouched",
  call("GET", "/me", { headers: bearer(bystander) }), 200);

/*
 * A DEFINITIVE departure - Telegram answered, and the answer names a
 * status this Worker knows means gone. These end the session.
 */
const DEPARTURES = [
  ["left", { ok: true, result: { status: "left" } }],
  ["kicked", { ok: true, result: { status: "kicked" } }],
  ["a restricted member who has actually left",
    { ok: true, result: { status: "restricted", is_member: false } }],
];

for (const [what, reply] of DEPARTURES) {
  const token = await mintFor({});
  answer = reply;
  await statusOf(`${what}: the sign-in is refused`, signIn({}, gated), 403);
  await statusOf(`${what}: and the live session it left behind ends`,
    call("GET", "/me", { headers: bearer(token) }), 401);
}

/*
 * NOT a departure - the sign-in is refused just the same, because the
 * posture is fail-closed and this slice does not soften it, but nothing
 * is revoked. This is the arm most likely to be "simplified" later into
 * "refused means gone", and simplifying it means a Telegram outage plus
 * one sign-in attempt signs that member out of a session they still
 * hold. An unreadable answer is not evidence of anything.
 */
const NOT_DEPARTURES = [
  ["an unreachable Telegram", new Error("Telegram unreachable")],
  ["an answer Telegram could not give",
    { ok: false, description: "chat not found" }],
  ["a result carrying no status at all", { ok: true, result: {} }],
  ["a status this Worker has not been taught",
    { ok: true, result: { status: "wizard" } }],
];

for (const [what, reply] of NOT_DEPARTURES) {
  const token = await mintFor({});
  answer = reply;
  await statusOf(`${what}: the sign-in is refused just the same`,
    signIn({}, gated), 403);
  await statusOf(`${what}: and nothing is revoked`,
    call("GET", "/me", { headers: bearer(token) }), 200);
}

/*
 * Break-glass, unchanged and asserted at the network rather than at the
 * status code. ALWAYS_ALLOW_TELEGRAM_IDS exists for the case where the
 * group check itself has failed - the bot removed from the group, the
 * API down - so it has to be answered before any call is made.
 */
reset();
telegramCalls = 0;
answer = new Error("Telegram unreachable");
await statusOf("the allowlist signs in with Telegram unreachable",
  signIn({}, { ...gated, ALWAYS_ALLOW_TELEGRAM_IDS: "4242" }), 200);
check("and asked Telegram nothing at all",
  telegramCalls === 0, `${telegramCalls} round trips`);

/*
 * No group chat id FAILS CLOSED (2nd audit BLOCKER1). A Worker able to
 * verify a Telegram payload but missing its group config cannot know who
 * is a member, so it admits nobody - the pre-0.9 line returned "member"
 * here and turned a forgotten binding into an open door for every valid
 * Telegram identity. The break-glass allowlist, checked above this arm,
 * stays the documented way into a misconfigured deploy and is asserted
 * just below. Nothing is interpolated into a Telegram URL either: the
 * answer is reached before the fetch, so a Worker holding no bot token
 * never builds a request around one.
 */
const noChatId = { ...env, TELEGRAM_GROUP_CHAT_ID: undefined };
telegramCalls = 0;
await statusOf("no group chat id fails closed rather than admitting everyone",
  signIn({}, noChatId), 403);
check("and asked Telegram nothing, having no group to ask about",
  telegramCalls === 0, `${telegramCalls} round trips`);
await statusOf("break-glass still signs in when the group config is absent",
  signIn({}, { ...noChatId, ALWAYS_ALLOW_TELEGRAM_IDS: "4242" }), 200);

await statusOf("a Worker with no bot token refuses cleanly rather than throwing",
  signIn({}, { ...noChatId, TELEGRAM_BOT_TOKEN: undefined }), 401);

globalThis.fetch = realFetch;

/* ------------------------------------------------------------------ */
/* Submission validation, and ALLOWED_ORIGINS.                         */

reset();

const M = (await (await signIn({})).clone().json()).session;
const post = (body) => call("POST", "/submit", { headers: bearer(M), body });

/*
 * The body carries the record's PLAINTEXT and this Worker seals it
 * (0.9-M1-S6, #332), so the only shapes this route can refuse are a body
 * that is not JSON, a missing or empty record, and one past the ceiling.
 * There is no base64 alphabet or quantum to check: the shape of a sealed
 * blob is not anything a caller sends. The full sealed lifecycle is
 * tests/entry-rows.test.mjs.
 */
await statusOf("a submission with no record is refused",
  post(JSON.stringify({})), 400);
await statusOf("an empty record is refused",
  post(JSON.stringify({ record: "" })), 400);
await statusOf("a malformed body is refused", post("{{{"), 400);
await statusOf("an oversize submission is refused",
  post(JSON.stringify({ record: "A".repeat(17000) })), 413);

const rowsBefore = stored.length;
await statusOf("a valid submission is accepted",
  post(JSON.stringify({ record: "{\"weight_kg\":100}" })), 200);
check("only the valid submission reached the database",
  stored.length === rowsBefore + 1, `${rowsBefore} -> ${stored.length}`);

/*
 * ALLOWED_ORIGINS overrides the built-in list so a new owner points the
 * endpoint at their own site from the dashboard rather than editing and
 * re-pasting the Worker. Both directions matter: it must let their
 * origin in AND shut the old one out, or a handoff quietly leaves the
 * previous owner's site still writing to the new owner's database.
 */
const NEW_OWNER = "https://someone-else.example";
const inherited = { ...env, ALLOWED_ORIGINS: ` ${NEW_OWNER} , ${LOCAL} ` };
await statusOf("an override admits the new origin",
  signIn({}, inherited, { Origin: NEW_OWNER, ...TYPE }), 200);
await statusOf("an override shuts out the old origin",
  signIn({}, inherited), 403);

/*
 * A Worker with no EXPORT_TOKEN must refuse everybody rather than treat
 * an empty string as a match - the same shape as DEV_LOGIN_SECRET above,
 * and the reason both are written as "must be set" rather than "must not
 * differ".
 */
await statusOf("a Worker with no export token refuses the break-glass path",
  call("GET", "/export", { headers: bearer("") }, { ...env, EXPORT_TOKEN: "" }),
  401);

/* ------------------------------------------------------------------ */
/* Ending a session on purpose - DELETE /session.                      */

/*
 * Signing out has to end the session rather than forget it. Without this
 * route the row survives to its natural expiry - seven days for a member
 * - so a token captured before sign-out stays a working credential for
 * all of it, which is the one thing sign-out is pressed to stop.
 *
 * The route is authenticated by the token it destroys, so it needs no
 * new authority, and it refuses anything that is not a live session row:
 * an unknown token gets 401 rather than a courtesy 200. That refusal is
 * load-bearing in two directions. It keeps the route from being an
 * unauthenticated DELETE against `sessions` keyed on a string the caller
 * chose, and it stops the route ever answering "you are signed out" to
 * somebody who is not - the same failure this route exists to fix, moved
 * one level up. Nothing is trapped by the strictness: the page clears
 * its local copy whatever this answers.
 */
reset();

const REVOKE_ME = (await (await signIn({})).clone().json()).session;
const BYSTANDER = (await (await signIn({ id: 7777 })).clone().json()).session;
check("two sessions exist before either is revoked",
  sessions.length === 2, `${sessions.length} row(s)`);

await statusOf("a member can end their own session",
  call("DELETE", "/session", { headers: bearer(REVOKE_ME) }), 200);
check("the row is deleted rather than left to expire",
  sessions.length === 1 &&
  !sessions.some((s) => s.account_id === FIXTURE_4242),
  `${sessions.length} row(s) left`);

await statusOf("the revoked token is refused on the very next request",
  call("GET", "/me", { headers: bearer(REVOKE_ME) }), 401);
await statusOf("and on a route that writes, not only on one that reads",
  call("POST", "/submit", { headers: bearer(REVOKE_ME),
    body: JSON.stringify({ record: "{\"w\":1}" }) }), 401);

/* Revoking must not be a way to sign anybody else out, and must not be a
 * way to find out that anybody else is signed in. */
await statusOf("somebody else's session is untouched",
  call("GET", "/me", { headers: bearer(BYSTANDER) }), 200);

await statusOf("revoking an already-revoked token is refused, not blessed",
  call("DELETE", "/session", { headers: bearer(REVOKE_ME) }), 401);
await statusOf("a token that was never a session revokes nothing",
  call("DELETE", "/session", { headers: bearer("not-a-session-token") }), 401);
check("and neither refusal removed a row",
  sessions.length === 1, `${sessions.length} row(s) left`);

const ADMIN_REVOKE = (await (await signIn({ id: 99 })).clone().json()).session;
await statusOf("an admin can end their own session too",
  call("DELETE", "/session", { headers: bearer(ADMIN_REVOKE) }), 200);
await statusOf("and the admin token is dead on the next request",
  call("GET", "/export", { headers: bearer(ADMIN_REVOKE) }), 401);

/* An expired session is not a credential, so it cannot revoke either -
 * and the opportunistic sweep is what actually removes its row. */
const STALE_TOKEN = (await (await signIn({ id: 8888 })).clone().json()).session;
sessions[sessions.length - 1].expires_at =
  new Date(Date.now() - 1000).toISOString();
await statusOf("an expired session cannot revoke",
  call("DELETE", "/session", { headers: bearer(STALE_TOKEN) }), 401);

/* ------------------------------------------------------------------ */
/* An admin session is admin only while the id is still an admin.      */

/*
 * The admin flag is minted at sign-in. On its own that means taking an
 * id out of ADMIN_TELEGRAM_IDS does nothing until the session expires -
 * up to two hours of holding the whole corpus's ciphertext, with nothing
 * able to force it sooner. The flag on the row is now a necessary
 * condition rather than the whole answer, and the list is re-read on
 * every request that asks whether the caller is an admin.
 *
 * The re-read compares account ids, never Telegram ids: the Worker HMACs
 * each configured id under ACCOUNT_SECRET and looks for the value the
 * row already carries. Nothing new is stored, nothing is written down,
 * and the comparison is made in memory out of two things the Worker
 * already held.
 */
reset();

const staleAdmin = await (await signIn({ id: 99 })).clone().json();
check("the session was minted as an admin", staleAdmin.isAdmin === true);
const STALE_ADMIN = staleAdmin.session;

await statusOf("it exports while 99 is still in ADMIN_TELEGRAM_IDS",
  call("GET", "/export", { headers: bearer(STALE_ADMIN) }), 200);

const demoted = { ...env, ADMIN_TELEGRAM_IDS: "12345" };
await statusOf("the same session cannot export once 99 is off the list",
  call("GET", "/export", { headers: bearer(STALE_ADMIN) }, demoted), 401);
// The /snapshot route these two checks drove against is gone
// (0.9-M2-S3, #354); POST /content and DELETE /membership/... are the
// same admin gate on the two methods GET /export does not cover, so the
// demotion claim stays proved across POST and DELETE alike.
await statusOf("nor write the site copy",
  call("POST", "/content", { headers: bearer(STALE_ADMIN),
    body: JSON.stringify({ name: "matrix", value: "x" }) }, demoted), 401);
await statusOf("nor remove a membership row",
  call("DELETE", "/membership/admin/" + FIXTURE_4242,
    { headers: bearer(STALE_ADMIN) }, demoted), 401);
/*
 * Nor delete somebody else's row - and since 0.9-M1-S6 (#332) that is
 * proved by the row SURVIVING rather than by a 401. A demoted admin is
 * still an ordinary member, and a member's delete is a real route for
 * them: it is scoped to their own account, so naming a stranger's row
 * removes nothing and answers 200, exactly as it does for any member
 * naming an id that is not theirs. Asserting the status alone here would
 * now assert nothing about adminness at all - the row is the claim.
 */
const strangerRow = {
  id: 4242, account_id: "somebody-else", ciphertext: "not-this-caller's",
  received_at: new Date().toISOString(), supersedes: null,
};
stored.push(strangerRow);
await statusOf("a demoted admin's delete of a stranger's row is a member's " +
  "delete now, and a member's delete of a row that is not theirs succeeds",
  call("DELETE", "/submission/4242", { headers: bearer(STALE_ADMIN) },
    demoted), 200);
check("nor delete somebody's row - the stranger's row is still there",
  stored.includes(strangerRow), `${stored.length} row(s) left`);
await statusOf("an empty admin list leaves nobody an admin",
  call("GET", "/export", { headers: bearer(STALE_ADMIN) },
    { ...env, ADMIN_TELEGRAM_IDS: "" }), 401);

/*
 * The re-read may take adminness away and must never hand it out. Adding
 * an id to ADMIN_TELEGRAM_IDS still needs a fresh sign-in, which is what
 * OPERATIONS.md tells a keyholder to do - and the reason it is worth
 * asserting is that the cheapest way to write the re-read is as the only
 * condition, which would silently promote every live member session
 * belonging to a newly-listed id. sessionFor()'s comment claims the
 * stored flag stays necessary; this is what stops that being a claim
 * nothing checks.
 */
const MEMBER_SESSION = (await (await signIn({})).clone().json()).session;
await statusOf("listing an id does not promote a session already issued",
  call("GET", "/export", { headers: bearer(MEMBER_SESSION) },
    { ...env, ADMIN_TELEGRAM_IDS: "4242" }), 401);

/* Demotion is not revocation. The person is still a member of the group,
 * and the session that stops being an admin session keeps working as the
 * member session it also is - so /me must say so rather than refuse. */
const demotedMe = await call("GET", "/me",
  { headers: bearer(STALE_ADMIN) }, demoted);
const demotedMeBody = await demotedMe.clone().json();
check("the demoted session still works as an ordinary member session",
  demotedMe.status === 200 && demotedMeBody.isAdmin === false,
  `${demotedMe.status}, isAdmin=${demotedMeBody.isAdmin}`);

/*
 * THE DEVELOPMENT SESSION HAS NO EXEMPTION, and that is the tightening
 * 0.9-M2-S1 (#352) landed with the route's removal. Nothing in this
 * Worker writes is_dev = 1 any more, so the only such row is one written
 * straight into the database - a `wrangler d1 execute`, a restored
 * backup - and the old code would have re-read its adminness out of
 * DEV_LOGIN_SECRET, handing that row the corpus on any deployment where
 * somebody set the binding. Adminness comes from the lists alone now,
 * and a "dev:"-namespaced account id cannot be a numeric id's HMAC, so
 * the hand-written row is a member.
 *
 * Seeded rather than minted, because seeding is what the case IS.
 */
const HAND_WRITTEN_DEV = "hand-written-dev-admin-session-token";
sessions.push({
  token_hash: await sha256Hex(HAND_WRITTEN_DEV),
  account_id: FIXTURE_DEV_SUBJECT,
  is_admin: 1, is_dev: 1,
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
});
await statusOf("a hand-written is_dev admin row is NOT an admin, even " +
  "with DEV_LOGIN_SECRET set",
  call("GET", "/export", { headers: bearer(HAND_WRITTEN_DEV) }, devEnv), 401);
await statusOf("and it still works as the member session it also is",
  call("GET", "/me", { headers: bearer(HAND_WRITTEN_DEV) }, devEnv), 200);

/* ------------------------------------------------------------------ */
/* An admin session also ends when nothing uses it.                    */

/*
 * The two-hour cap bounds an admin session that is being used. This is
 * what bounds one that is not: apps/web/admin.html is the only place the
 * whole corpus exists in the clear, and the cap runs whether the tab is
 * in use or not (ASD STIG V-222390).
 *
 * The window is the row's own expires_at moving forward on use and never
 * past the cap - no column, and no second sweep beside the one that
 * already clears expired rows. Three things have to hold at once and
 * each fails on its own: a fresh admin row carries the window rather
 * than the cap, using it moves the window, and no amount of use moves
 * the cap. Together they say a row's deadline is never more than one
 * window past the last request that presented it, which is the whole
 * property.
 *
 * The numbers are restated here rather than read out of the Worker. A
 * suite importing the constant would agree with whatever the Worker
 * said, which is the assertion that cannot fail.
 */
reset();

const IDLE_MS = 15 * 60 * 1000;
const ADMIN_CAP_MS = 2 * 3600 * 1000;
const MEMBER_CAP_MS = 7 * 24 * 3600 * 1000;

/*
 * Deadlines are asserted as windows rather than equalities: real time
 * passes between minting a session and reading its row, and an exact
 * match would fail on a slow machine for a reason that has nothing to do
 * with the rule under test. A minute is far tighter than any of the
 * intervals being told apart here.
 */
const SLACK_MS = 60 * 1000;
const near = (actual, want) => Math.abs(actual - want) < SLACK_MS;
const rowWhere = (isAdmin) =>
  sessions.find((s) => s.is_admin === (isAdmin ? 1 : 0));
const leftOn = (row) => Date.parse(row.expires_at) - Date.now();
const inMinutes = (ms) => Math.round(ms / 60000) + " min";

const idleAdmin = await (await signIn({ id: 99 })).clone().json();
const IDLE_ADMIN = idleAdmin.session;
const IDLE_MEMBER = (await (await signIn({})).clone().json()).session;

check("a fresh admin row expires on the idle window, not on the cap",
  near(leftOn(rowWhere(true)), IDLE_MS), inMinutes(leftOn(rowWhere(true))));

/*
 * The caller is still told the cap, and the two values differ on
 * purpose. apps/web/session.js keeps expiresAt and never rewrites it, so
 * handing it the window would drop an admin's own tab a quarter of an
 * hour after sign-in however busy they had been - a client-side timeout
 * nobody specified, arriving through the wrong value. The row is where
 * the window is enforced.
 */
check("but the caller is told the absolute expiry, not the window",
  near(Date.parse(idleAdmin.expiresAt) - Date.now(), ADMIN_CAP_MS),
  inMinutes(Date.parse(idleAdmin.expiresAt) - Date.now()));
check("so the row dies sooner than the expiry the caller was handed",
  Date.parse(rowWhere(true).expires_at) < Date.parse(idleAdmin.expiresAt));

/* A member row carries the same window since 0.9-M1-S5 (#331), which is
 * DESIGN.md, "Sessions": one rule everywhere. The seven days are still
 * the member's CAP and still differ from the admin's two hours - what is
 * gone is the exemption from having a window at all. */
check("a member row expires on the same idle window, not on its cap",
  near(leftOn(rowWhere(false)), IDLE_MS),
  inMinutes(leftOn(rowWhere(false))));

await statusOf("an admin session used inside the window is allowed",
  call("GET", "/export", { headers: bearer(IDLE_ADMIN) }), 200);

rowWhere(true).expires_at = new Date(Date.now() + 60 * 1000).toISOString();
await statusOf("and with a minute of the window left it still works",
  call("GET", "/export", { headers: bearer(IDLE_ADMIN) }), 200);
check("using it is what slides the window back out to full",
  near(leftOn(rowWhere(true)), IDLE_MS), inMinutes(leftOn(rowWhere(true))));

/* The cap is still nearly two hours away here, which is what makes the
 * refusal below an idle refusal rather than the ordinary expiry this
 * file already covers further up. */
rowWhere(true).expires_at = new Date(Date.now() - 1000).toISOString();
check("the cap is still hours off when the window runs out",
  Date.parse(rowWhere(true).created_at) + ADMIN_CAP_MS - Date.now() >
    ADMIN_CAP_MS - SLACK_MS);
await statusOf("an admin session idle past the window is refused",
  call("GET", "/export", { headers: bearer(IDLE_ADMIN) }), 401);
check("and the idle row is cleared rather than left to sit",
  !sessions.some((s) => s.is_admin === 1), `${sessions.length} row(s) left`);

/* The member row beside it is a SEPARATE row, and ending the admin's
 * must not reach it. What is asserted is survival, not stillness: using
 * the member session slides its own window now, exactly as using the
 * admin one slid that. */
rowWhere(false).expires_at = new Date(Date.now() + 60 * 1000).toISOString();
await statusOf("the member session beside it is untouched",
  call("GET", "/me", { headers: bearer(IDLE_MEMBER) }), 200);
check("and using that one slides its own window out to full",
  near(leftOn(rowWhere(false)), IDLE_MS),
  inMinutes(leftOn(rowWhere(false))));

/*
 * A row in continuous use for just under two hours: every request slid
 * the window, and the last of them ran into the cap. This is what a real
 * row looks like at that moment, and the cap is what stops an admin
 * session renewing itself a quarter of an hour at a time forever.
 */
reset();
const CAP_ADMIN = (await (await signIn({ id: 99 })).clone().json()).session;
const capped = rowWhere(true);
capped.created_at =
  new Date(Date.now() - ADMIN_CAP_MS + 60 * 1000).toISOString();
capped.expires_at = new Date(Date.now() + 60 * 1000).toISOString();

await statusOf("a session a minute short of the cap still works",
  call("GET", "/export", { headers: bearer(CAP_ADMIN) }), 200);
check("but no amount of use slides the deadline past the cap",
  near(leftOn(rowWhere(true)), 60 * 1000), inMinutes(leftOn(rowWhere(true))));

rowWhere(true).expires_at = new Date(Date.now() - 1000).toISOString();
await statusOf("so the cap still ends a session that never went idle",
  call("GET", "/export", { headers: bearer(CAP_ADMIN) }), 401);

/*
 * The window follows the flag on the row rather than the re-read above
 * it. This row was handed the whole corpus's ciphertext once, and taking
 * its owner off ADMIN_TELEGRAM_IDS does not un-hand it - so a demoted
 * session keeps the shorter window along with the member rights it also
 * keeps. Reading the re-read instead would hand a demoted session the
 * longer deadline, which is the wrong direction for a demotion.
 */
reset();
const DEMOTED_IDLE = (await (await signIn({ id: 99 })).clone().json()).session;
rowWhere(true).expires_at = new Date(Date.now() + 60 * 1000).toISOString();
await statusOf("a demoted admin session still works as a member session",
  call("GET", "/me", { headers: bearer(DEMOTED_IDLE) }, demoted), 200);
check("and keeps the admin window, because the row still opened the corpus",
  near(leftOn(rowWhere(true)), IDLE_MS), inMinutes(leftOn(rowWhere(true))));

/* THE WINDOW FOLLOWS THE STORED FLAG, not the re-read, and an is_dev row
 * is where those two answers differ most: it is refused adminness by the
 * lists (0.9-M2-S1, #352) while its row still says is_admin = 1, so a
 * slide computed from the re-read would hand it the member's seven days.
 * The row was handed the corpus's shape once and is bounded accordingly.
 * Seeded, because nothing mints one. */
const DEV_IDLE_TOKEN = "hand-written-dev-idle-session-token";
sessions.push({
  token_hash: await sha256Hex(DEV_IDLE_TOKEN),
  account_id: FIXTURE_DEV_SUBJECT,
  is_admin: 1, is_dev: 1,
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 60 * 1000).toISOString(),
});
const devRow = () => sessions.find((s) => s.is_dev === 1);
await statusOf("a hand-written is_dev admin row is a member session",
  call("GET", "/me", { headers: bearer(DEV_IDLE_TOKEN) }, devEnv), 200);
check("and gets the ADMIN window, because the stored flag is what the " +
  "slide reads",
  near(leftOn(devRow()), IDLE_MS), inMinutes(leftOn(devRow())));

/* The break-glass token is a secret rather than a row, so there is
 * nothing to slide and no row to find. Asserted because a slide written
 * one level too high would either move somebody else's deadline or fall
 * over on the row that is not there. */
const deadlinesBefore = sessions.map((s) => s.expires_at).join("|");
await statusOf("the break-glass token still exports",
  call("GET", "/export", { headers: bearer("sekrit-token-value") }), 200);
check("and it moved no session's deadline",
  sessions.map((s) => s.expires_at).join("|") === deadlinesBefore);

/*
 * A row whose created_at will not parse still gets an answer. Sliding a
 * deadline off it unguarded is `new Date(NaN).toISOString()`, which
 * throws - so a single unreadable row would turn every admin request
 * into a 500 rather than a refusal, and a crash is a worse way to find
 * out than a short session. It falls back to the window and never to
 * anything longer, the same failing-closed shape tokenMatches() carries
 * for an unset secret.
 */
reset();
const ODD_ADMIN = (await (await signIn({ id: 99 })).clone().json()).session;
rowWhere(true).created_at = "not a date";
await statusOf("an admin row with an unreadable created_at still answers",
  call("GET", "/export", { headers: bearer(ODD_ADMIN) }), 200);
check("and falls back to the window rather than to anything longer",
  near(leftOn(rowWhere(true)), IDLE_MS), inMinutes(leftOn(rowWhere(true))));

/*
 * The failing-closed shape one field over: an UNREADABLE expires_at
 * (2nd audit MINOR2). Date.parse() of a non-date is NaN, and the pre-0.9
 * check read `NaN <= now` - which is false - as "not yet expired", so a
 * row whose deadline could not be parsed was served forever. A deadline
 * must be FINITE and future; a row that is neither is deleted here and
 * the caller refused. Asserted for both roles, because both flow through
 * this check ahead of the admin-only slide above - an unreadable member
 * deadline was as permanent as an admin one.
 */
reset();
const ROT_ADMIN = (await (await signIn({ id: 99 })).clone().json()).session;
const ROT_MEMBER = (await (await signIn({})).clone().json()).session;
rowWhere(true).expires_at = "whenever";
rowWhere(false).expires_at = "whenever";
await statusOf("an admin session with an unparseable expiry is refused",
  call("GET", "/export", { headers: bearer(ROT_ADMIN) }), 401);
await statusOf("a member session with an unparseable expiry is refused",
  call("GET", "/me", { headers: bearer(ROT_MEMBER) }), 401);
check("and both unreadable rows are deleted rather than served again",
  sessions.length === 0, `${sessions.length} row(s) remain`);

/*
 * The member arm of the same decision, asserted rather than only
 * written down - and the residual that survives it.
 *
 * ONE WINDOW FOR EVERY SESSION, pinned here because it is the half of
 * DESIGN.md, "Sessions", that a reader is most likely to undo by
 * accident: a member exemption reads like a kindness, and restoring one
 * would be a behavior change no other arm in this file could see,
 * because every arm above this is about admins. Breaking these two is
 * what tells whoever tries that the record has to move with the code.
 *
 * Both halves are asserted, because they are separate claims and a
 * member exemption would have to break both:
 *
 *   1. The deadline. A member row idle past the window is refused, and
 *      it is refused while its seven-day cap is still days away - which
 *      is what makes it an IDLE refusal and not the ordinary expiry
 *      this file covers further up.
 *   2. The write. A member request slides the row, so it writes, and
 *      the count is what says so: the deadline alone cannot, because a
 *      slide and no slide can both leave a plausible-looking value.
 *
 * What the CAP still bounds on its own is #136's residual. A member
 * Telegram has definitively said is gone keeps the session they already
 * hold until they attempt to sign in again or a deadline ends it,
 * because the account id on the row is an HMAC and getChatMember needs
 * the numeric id - see revokeAccountSessions() in server/worker.js. The
 * window shortens that residual for a session nobody is using and
 * cannot touch one that is in use, which is why the residual is still
 * stated here rather than treated as closed.
 */
reset();

const SIX_DAYS = 6 * 24 * 3600 * 1000;
const memberRow = () => sessions.find((s) => s.is_admin === 0);
const sessionWrites = () => executed.filter(
  (s) => s.table === "sessions" && /^\s*UPDATE\b/i.test(s.sql)).length;

/*
 * A row minted six days ago and not touched since. Six days is chosen
 * against the CAP rather than against the window: it leaves a day of
 * cap, so the refusal below is unambiguously the idle window doing it.
 */
const QUIET_MEMBER = (await (await signIn({})).clone().json()).session;
memberRow().created_at = new Date(Date.now() - SIX_DAYS).toISOString();
memberRow().expires_at =
  new Date(Date.now() - SIX_DAYS + IDLE_MS).toISOString();

check("the cap is still a day off when the member's window runs out",
  Date.parse(memberRow().created_at) + MEMBER_CAP_MS - Date.now() >
    24 * 3600 * 1000 - SLACK_MS);
await statusOf("a member session unused for six days is refused",
  call("GET", "/me", { headers: bearer(QUIET_MEMBER) }), 401);
check("and the idle member row is cleared rather than left to sit",
  !sessions.some((s) => s.is_admin === 0), `${sessions.length} row(s) left`);

/*
 * The write, counted rather than inferred from the deadline. A slide
 * that never happened and one that wrote a value close to what the row
 * already held look the same in `expires_at`; only the count tells them
 * apart, which is why the count is what is asserted.
 */
reset();
const BUSY_MEMBER = (await (await signIn({})).clone().json()).session;
const beforeMember = sessionWrites();
await statusOf("a member request is answered from the row",
  call("GET", "/me", { headers: bearer(BUSY_MEMBER) }), 200);
check("and slides it, writing the new deadline back",
  sessionWrites() - beforeMember === 1,
  `${sessionWrites() - beforeMember} write(s)`);

/*
 * The control, and it reads the admin flag back rather than the status.
 * GET /me answers 200 for any session at all, so a status here would
 * hold for a member row and the count beside it would then be measuring
 * an implementation that slides nobody - which is the reading that makes
 * "writes nothing back" mean nothing.
 */
const BUSY_ADMIN = (await (await signIn({ id: 99 })).clone().json()).session;
const beforeAdmin = sessionWrites();
const busyMe = await (await call("GET", "/me",
  { headers: bearer(BUSY_ADMIN) })).clone().json();
check("the request beside it is served, and served as an admin",
  busyMe.isAdmin === true, `isAdmin=${busyMe.isAdmin}`);
check("and writes exactly one row back",
  sessionWrites() - beforeAdmin === 1,
  `${sessionWrites() - beforeAdmin} write(s)`);

/*
 * #136's residual as behavior. `gated` is what puts a group check in
 * front of sign-in at all; `answer` says what Telegram would reply if
 * anything asked, and the point of the first arm is that nothing does.
 *
 * The Telegram stub is re-installed here rather than assumed. The block
 * that first sets it puts the real fetch back when it is finished, so a
 * sign-in run here without this reaches the network and is refused for
 * a reason that has nothing to do with the rule under test - which is
 * how this arm read on its first run.
 */
reset();
const beforeResidual = globalThis.fetch;
globalThis.fetch = async () => {
  if (answer instanceof Error) throw answer;
  return new Response(JSON.stringify(answer), { headers: TYPE });
};

answer = { ok: true, result: { status: "member" } };
const LEAVER = await mintFor({});
answer = { ok: true, result: { status: "left" } };

await statusOf("a member Telegram calls gone keeps the session they hold",
  call("GET", "/me", { headers: bearer(LEAVER) }, gated), 200);

memberRow().created_at = new Date(Date.now() - SIX_DAYS).toISOString();
memberRow().expires_at =
  new Date(Date.now() - SIX_DAYS + MEMBER_CAP_MS).toISOString();
await statusOf("and six days of never touching it does not end that one",
  call("GET", "/me", { headers: bearer(LEAVER) }, gated), 200);

/* The control on the arms above, and the reason they mean what they
 * say: the same account, the same answer, at the one place that does
 * ask - so "nothing re-checks" is asserted against a lever that is
 * demonstrably live rather than against one that might be broken. */
await statusOf("while the sign-in attempt they never make would end it",
  signIn({}, gated), 403);
await statusOf("and it is that attempt, not the passage of time, that does",
  call("GET", "/me", { headers: bearer(LEAVER) }, gated), 401);

globalThis.fetch = beforeResidual;

/* ------------------------------------------------------------------ */
/* Site content - the one document served without a credential (#87).  */

/*
 * The read is open and the write is an admin session, and the asymmetry
 * is the design rather than an oversight.
 *
 * Each page's shipped HTML is the fallback for these values, and the
 * deploy copies dist/ - apps/web with the comments taken out (#181) -
 * to a public site, so the bytes this route enhances can be fetched by
 * anybody already. A session gate here
 * would promise a confidentiality the fallback does not have, and the
 * cost of promising it is that somebody eventually puts something
 * private in a table designed for site copy. What follows from the open
 * read is the rule the membership section below enforces structurally:
 * nothing about a person goes in this table, and the list of people has
 * a table and a gate of its own.
 */
reset();

const CONTENT_ADMIN = (await (await signIn({ id: 99 })).clone().json()).session;
const editorId = (await (await call("GET", "/me",
  { headers: bearer(CONTENT_ADMIN) })).json()).accountId;

const setContent = (token, body) =>
  call("POST", "/content",
    { headers: bearer(token), body: JSON.stringify(body) });
const readContent = () => call("GET", "/content", { headers: good });

const blank = await readContent();
const blankBody = await blank.clone().json();
check("an absent site content document is not an error",
  blank.status === 200 && blankBody.ok === true &&
  JSON.stringify(blankBody.content) === "{}",
  `${blank.status} ${JSON.stringify(blankBody.content)}`);

await setContent(CONTENT_ADMIN, { name: "welcome", value: "Weigh in." });
const written = await (await readContent()).json();
check("a value an admin set reads back under its name, to anybody",
  written.content.welcome === "Weigh in.", JSON.stringify(written.content));

await setContent(CONTENT_ADMIN, { name: "welcome", value: "Weigh in weekly." });
const replaced = await (await readContent()).json();
check("writing a name again replaces it rather than adding a row",
  content.length === 1 && replaced.content.welcome === "Weigh in weekly.",
  `${content.length} row(s)`);

await setContent(CONTENT_ADMIN,
  { name: "dashboard.note", value: "Updated Fridays." });
const both = await (await readContent()).json();
check("a second name sits beside the first",
  Object.keys(both.content).length === 2 &&
  both.content["dashboard.note"] === "Updated Fridays.",
  JSON.stringify(both.content));

/*
 * The document carries names and values and nothing else. `updated_by`
 * is an account id, and a document anybody may fetch is the wrong place
 * to publish which account did anything - the audit belongs to the
 * table and to whatever admin surface reads it behind a gate.
 */
const publicText = await (await readContent()).text();
check("the public document names no writer and no time",
  !publicText.includes(editorId) && !publicText.includes("updated_by") &&
  !publicText.includes("updated_at"), publicText.slice(0, 50) + "â€¦");

check("but the row records the admin who wrote it",
  content[0].updated_by === editorId,
  content[0].updated_by ? content[0].updated_by.slice(0, 20) + "â€¦" : "absent");

/* The break-glass caller is an admin and is nobody, so an audit column
 * has to say that rather than invent an account or store a null that
 * reads as "nobody knows". */
await setContent("sekrit-token-value", { name: "welcome", value: "Back in." });
const glassWrite = content.find((r) => r.name === "welcome");
check("a break-glass write is recorded as break-glass, not as an account",
  glassWrite.updated_by === "break-glass", glassWrite.updated_by);

const contentBefore = content.length;
for (const [label, name] of [
  ["upper case", "Welcome"],
  ["a path", "a/b"],
  ["empty", ""],
  ["a leading dash", "-lead"],
  ["longer than sixty-four characters", "a".repeat(65)],
]) {
  await statusOf(`a content name that is ${label} is refused`,
    setContent(CONTENT_ADMIN, { name: name, value: "x" }), 400);
}

await statusOf("a content value that is not text is refused",
  setContent(CONTENT_ADMIN, { name: "welcome", value: { html: "<b>" } }), 400);
await statusOf("an oversize content value is refused",
  setContent(CONTENT_ADMIN, { name: "welcome", value: "A".repeat(9000) }), 413);
await statusOf("a malformed content body is refused",
  call("POST", "/content",
    { headers: bearer(CONTENT_ADMIN), body: "{{{" }), 400);

check("and not one refused write reached the table",
  content.length === contentBefore &&
  content.find((r) => r.name === "welcome").value === "Back in.",
  `${contentBefore} -> ${content.length}`);

/* Unsetting a name is how a page goes back to the copy it ships with.
 * Without it a typo can only be written over, and the shipped fallback
 * becomes unreachable for as long as any value sits on top of it. */
await statusOf("an admin can unset a name",
  call("DELETE", "/content/welcome",
    { headers: bearer(CONTENT_ADMIN) }), 200);
const afterUnset = await (await readContent()).json();
check("that name is gone from the document and the others are not",
  afterUnset.content.welcome === undefined &&
  afterUnset.content["dashboard.note"] === "Updated Fridays.",
  JSON.stringify(afterUnset.content));

await statusOf("unsetting a name that is not there still succeeds",
  call("DELETE", "/content/nothing.here",
    { headers: bearer(CONTENT_ADMIN) }), 200);
check("and removed nothing", content.length === 1, `${content.length} row(s)`);

await statusOf("a content name that is not a name is not a route",
  call("DELETE", "/content/Welcome",
    { headers: bearer(CONTENT_ADMIN) }), 404);

await statusOf("a session off the admin list cannot write content",
  call("POST", "/content", { headers: bearer(CONTENT_ADMIN),
    body: JSON.stringify({ name: "welcome", value: "x" }) }, demoted), 401);

/* ------------------------------------------------------------------ */
/* Membership - the list the account design exists to keep private.    */

/*
 * #69's id lists as rows, keyed by the account id rather than by the
 * numeric Telegram id. A numeric id resolves to a person for anyone who
 * can point a bot at it, so a table of them would turn a database
 * breach from "some account submitted twelve times" - the grouping
 * DESIGN.md accepts knowingly - into "here are the group's admins, by
 * name". The HMAC is exactly as un-invertible as the ids stored beside
 * it in `submissions`, under the same secret, for the same reason.
 *
 * The numeric id arrives in the request body and the Worker HMACs it on
 * receipt. Taking the account id from the caller instead would move a
 * 64-character string nobody can check through a human being: a typo in
 * it produces a row that grants nothing and looks completely right,
 * which is the undetectable-wrong-value complaint #69 opens with, moved
 * into the table it asked for.
 */
reset();

const ROOT = (await (await signIn({ id: 99 })).clone().json()).session;
const ORDINARY = (await (await signIn({})).clone().json()).session;

const addMember = (token, body) =>
  call("POST", "/membership",
    { headers: bearer(token), body: JSON.stringify(body) });

/*
 * An admin writing their own row emits a record, which the last section
 * of this file is about. Where such a write is only scaffolding for a
 * different assertion, it goes through here - a log line printed into
 * the middle of a check list is the kind of noise that teaches people to
 * skim the output, and skimmed output is how a FAIL gets missed.
 */
const quietly = async (run) => {
  const before = console.log;
  console.log = () => {};
  try {
    return await run();
  } finally {
    console.log = before;
  }
};

await statusOf("an admin adds somebody by their numeric Telegram id",
  addMember(ROOT, { telegramId: "4242", role: "admin", label: "Alex" }), 200);

/* Against the committed fixture rather than against whatever the Worker
 * computed a moment ago: comparing the row to a value derived the same
 * way would pass even if both were wrong together. */
check("the row is keyed by the account id, not by the numeric id",
  roster.length === 1 && roster[0].account_id === FIXTURE_4242,
  roster.length ? roster[0].account_id.slice(0, 20) + "â€¦" : "no row");
check("and the numeric id is nowhere in the row",
  !JSON.stringify(roster[0]).includes("4242"), JSON.stringify(roster[0]));

const listed = await (await call("GET", "/membership",
  { headers: bearer(ROOT) })).json();
check("the list an admin reads carries the label somebody typed",
  listed.membership.length === 1 && listed.membership[0].label === "Alex" &&
  listed.membership[0].account_id === FIXTURE_4242,
  JSON.stringify(listed.membership[0]));
check("and no numeric id travels back out with it",
  !JSON.stringify(listed).includes("4242"));

/* Backdated because two writes inside one millisecond carry the same
 * timestamp, and an assertion about which one survived would hold
 * whatever the upsert did. The constant is declared here, beside its one
 * use, so that it travels with this section rather than with a distant
 * one that may retire on its own schedule. */
const DAY = 24 * 3600 * 1000;
roster[0].added_at = new Date(Date.now() - 3 * DAY).toISOString();
const addedAt = roster[0].added_at;
await statusOf("adding the same account and role again relabels it",
  addMember(ROOT,
    { telegramId: "4242", role: "admin", label: "Alexandra" }), 200);
check("one row, the new label, and the date it was added left alone",
  roster.length === 1 && roster[0].label === "Alexandra" &&
  roster[0].added_at === addedAt,
  `${roster.length} row(s), label=${roster[0].label}`);

await statusOf("the same account can hold both roles",
  addMember(ROOT,
    { telegramId: "4242", role: "always_allow", label: "Alexandra" }), 200);
check("which is two rows rather than one being written over",
  roster.length === 2 &&
  roster.filter((r) => r.account_id === FIXTURE_4242).length === 2,
  `${roster.length} row(s)`);

const rosterBefore = roster.length;
for (const [label, body] of [
  ["an unknown role", { telegramId: "4242", role: "moderator", label: "A" }],
  ["a role that is not a string", { telegramId: "4242", role: 1, label: "A" }],
  ["a handle instead of an id", { telegramId: "@alex", role: "admin", label: "A" }],
  ["an account id instead of an id",
    { telegramId: FIXTURE_4242, role: "admin", label: "A" }],
  ["no Telegram id at all", { role: "admin", label: "A" }],
  ["an id inside an array", { telegramId: ["4242"], role: "admin", label: "A" }],
  ["no label", { telegramId: "4242", role: "admin" }],
  ["a label of spaces", { telegramId: "4242", role: "admin", label: "   " }],
  ["an oversize label",
    { telegramId: "4242", role: "admin", label: "N".repeat(65) }],
]) {
  await statusOf(`adding with ${label} is refused`,
    addMember(ROOT, body), 400);
}
await statusOf("a malformed membership body is refused",
  call("POST", "/membership", { headers: bearer(ROOT), body: "{{{" }), 400);
check("and not one refused add reached the table",
  roster.length === rosterBefore, `${rosterBefore} -> ${roster.length}`);

/*
 * A second admin before any admin row is removed, because the guard
 * below refuses to remove the last one. Without this the delete that
 * follows would be asserting the guard's refusal while calling itself a
 * successful removal - the same row count, the wrong reason.
 *
 * ROOT's own account, which is also what the demotion probe further
 * down needs: a session whose authority the table carries and the
 * secret does not have to.
 */
await statusOf("a second admin joins the list",
  quietly(() =>
    addMember(ROOT, { telegramId: "99", role: "admin", label: "Root" })), 200);

await statusOf("an admin removes one role and leaves the other",
  call("DELETE", "/membership/admin/" + FIXTURE_4242,
    { headers: bearer(ROOT) }), 200);
check("exactly that row is gone",
  roster.length === 2 &&
  !roster.some((r) => r.account_id === FIXTURE_4242 && r.role === "admin"),
  `${roster.length} row(s)`);

await statusOf("removing a membership row that is not there still succeeds",
  call("DELETE", "/membership/admin/" + FIXTURE_4242,
    { headers: bearer(ROOT) }), 200);
check("and removed nothing else", roster.length === 2);

await statusOf("a role that is not a role is not a route",
  call("DELETE", "/membership/moderator/" + FIXTURE_4242,
    { headers: bearer(ROOT) }), 404);
await statusOf("an account id that is not one is not a route",
  call("DELETE", "/membership/admin/4242", { headers: bearer(ROOT) }), 404);
check("and neither refusal removed a row", roster.length === 2);

/*
 * Dual-read on the enforcing side, asserted where it is easiest to get
 * backwards: taking somebody out of the secret is no longer a demotion
 * on its own, because the row still says they administer. Both arms
 * have to stop saying so, and the section further down removes the row
 * to show the other direction.
 */
await statusOf("dropping out of the secret is not a demotion while the row stands",
  call("GET", "/membership", { headers: bearer(ROOT) }, demoted), 200);
await statusOf("and the row carries the write as well as the read",
  call("POST", "/membership", { headers: bearer(ROOT),
    body: JSON.stringify({ telegramId: "5", role: "always_allow", label: "S" }) },
  demoted), 200);
check("which is the row it says it is",
  roster.some((r) => r.role === "always_allow" && r.label === "S"),
  `${roster.length} row(s)`);

/*
 * The refusals, byte for byte, the way POST /submit's two are.
 *
 * A membership route that answered a member differently from a stranger
 * would say the route is worth pressing. One that answered differently
 * for an account that is on the list than for one that is not would be
 * the membership oracle itself, reachable with any member session
 * rather than with the database. The shape checks are in here too - a
 * role that is not a role answers an admin with 404, and a non-admin
 * must not be able to tell that from anything else, which is only true
 * if the gate runs before the shape check rather than after it.
 */
const refusalTo = async (token, method, path) => {
  const res = await call(method, path, {
    headers: token === null ? good : bearer(token),
    body: method === "POST" ? JSON.stringify({}) : undefined,
  });
  return res.status + " " + (await res.text());
};

const UNLISTED = "0".repeat(64);
const answers = [];
for (const [method, path] of [
  ["GET", "/membership"],
  ["POST", "/membership"],
  ["DELETE", "/membership/always_allow/" + FIXTURE_4242],
  ["DELETE", "/membership/always_allow/" + UNLISTED],
  ["DELETE", "/membership/admin/" + FIXTURE_4242],
  ["DELETE", "/membership/moderator/" + FIXTURE_4242],
]) {
  answers.push(await refusalTo(null, method, path));
  answers.push(await refusalTo(ORDINARY, method, path));
}
check("every membership route refuses a non-admin with the same bytes",
  new Set(answers).size === 1, JSON.stringify(answers[0]));
check("and it is the refusal every other admin route already gives",
  answers[0] === await refusalTo(ORDINARY, "GET", "/export"), answers[0]);
check("no refused call touched the list",
  roster.length === 3 &&
  roster.filter((r) => r.role === "admin").length === 1,
  `${roster.length} row(s)`);

/*
 * Two tables and two routes rather than one route with a filter: a
 * filter is one `if` away from serving the list to a member session,
 * and that mistake would look like nothing at all. Asserted against a
 * document that has something in it, because a route serving an empty
 * document mentions no membership either.
 */
await setContent(ROOT, { name: "welcome", value: "Weigh in." });
const publicAfter = await (await call("GET", "/content",
  { headers: good })).text();
check("the public content document carries copy and knows no membership",
  publicAfter.includes("Weigh in.") &&
  !publicAfter.includes(FIXTURE_4242) && !publicAfter.includes("Alexandra"),
  publicAfter.slice(0, 60) + "â€¦");

/* ------------------------------------------------------------------ */
/* The table is the enforcing truth now, beside the secret.            */

/*
 * The seam #69 was filed about, closed and asserted from both sides.
 *
 * The shipped posture is dual-read: a caller administers if the secret
 * says so OR the table does, and each of the four places the answer is
 * asked has to agree, because they are four separate decisions and no
 * one probe sees them all - what a sign-in mints, what the router
 * gates, what a per-request re-check reads, and what the group check
 * accepts. The flip to table-only is a later decision the owner takes
 * after a backfill; what makes it takeable is `secretOnly` below, not a
 * promise here.
 */
reset();

const KEEPER = (await (await signIn({ id: 99 })).clone().json()).session;
const HOPEFUL = (await (await signIn({})).clone().json()).session;

await addMember(KEEPER, { telegramId: "4242", role: "admin", label: "Alex" });
check("the account is listed as an admin in the table",
  roster.length === 1 && roster[0].role === "admin" &&
  roster[0].account_id === FIXTURE_4242, `${roster.length} row(s)`);

/*
 * A row does not promote a session that is already open. The stored
 * flag stays a necessary condition and the lists only ever turn it off:
 * a member session promoted by somebody else's edit is a promotion
 * nobody signed in for, and the session's own bounds - seven member
 * days rather than two admin hours - were set for the authority it had
 * when it was minted.
 */
await statusOf("the row does not promote a session already open",
  call("GET", "/export", { headers: bearer(HOPEFUL) }), 401);
await statusOf("nor hand it the list it is on",
  call("GET", "/membership", { headers: bearer(HOPEFUL) }), 401);

const rejoined = await (await signIn({})).clone().json();
check("but signing in again reads the table and mints an admin",
  rejoined.isAdmin === true, `isAdmin=${rejoined.isAdmin}`);
await statusOf("and that session administers",
  call("GET", "/membership", { headers: bearer(rejoined.session) }), 200);

/*
 * The group check reads the table too. `ALWAYS_ALLOW_TELEGRAM_IDS` is
 * NOT being migrated - it stays the secret-side break-glass, the way
 * back in when the bot is gone from the group - so this arm is an
 * addition beside it and never a replacement for it.
 */
const beforeGroupStub = globalThis.fetch;
globalThis.fetch = async () => new Response(
  JSON.stringify({ ok: true, result: { status: "left" } }), { headers: TYPE });
await statusOf("somebody the group has lost is refused",
  signIn({ id: 777, username: "outsider" }, gated), 403);
await addMember(KEEPER,
  { telegramId: "777", role: "always_allow", label: "Outsider" });
await statusOf("and an always_allow row is what lets them back in",
  signIn({ id: 777, username: "outsider" }, gated), 200);
check("the secret still does it too, with no row of its own",
  (await signIn({ id: 555, username: "bypass" },
    { ...gated, ALWAYS_ALLOW_TELEGRAM_IDS: "555" })).status === 200 &&
  !roster.some((r) => r.label === "bypass"));
globalThis.fetch = beforeGroupStub;

/* ------------------------------------------------------------------ */
/* Removing a row takes effect on the next request.                    */

/*
 * The whole reason the re-check reads the table rather than trusting
 * the flag on the session row: an admin taken off the list keeps the
 * ciphertext they already hold, and there has to be a lever that stops
 * the next request without waiting two hours for a clock. Demotion is
 * still not revocation - the member session underneath goes on working.
 */
reset();

const CHAIR = (await (await signIn({ id: 99 })).clone().json()).session;
await addMember(CHAIR, { telegramId: "4242", role: "admin", label: "Alex" });
// A second admin row, or the removal below meets the last-admin guard
// and this section would be testing that instead.
await addMember(CHAIR, { telegramId: "31337", role: "admin", label: "Sam" });
const PROMOTED = (await (await signIn({})).clone().json()).session;

await statusOf("a table admin can read the list",
  call("GET", "/membership", { headers: bearer(PROMOTED) }), 200);

await statusOf("the row is removed",
  call("DELETE", "/membership/admin/" + FIXTURE_4242,
    { headers: bearer(CHAIR) }), 200);

await statusOf("and the very next request is refused",
  call("GET", "/membership", { headers: bearer(PROMOTED) }), 401);
await statusOf("but the session still works as the member session it is",
  call("GET", "/me", { headers: bearer(PROMOTED) }), 200);

/* ------------------------------------------------------------------ */
/* The last admin row cannot be removed.                               */

/*
 * A lockout guard is only worth having where it can actually bite, and
 * the table becoming enforcing is what moves it there: a list that
 * grants nothing loses nothing by going empty, and a list that grants
 * everything loses everybody.
 *
 * Counted and deleted in ONE statement pair, inside one D1 batch. A
 * count read first and acted on second is a race with the other admin
 * pressing Remove at the same moment - both reads see two, both writes
 * succeed, and the table is empty with neither request having done
 * anything wrong. The guard is a subquery inside the DELETE, so SQLite
 * evaluates it against the same snapshot the delete applies to, and the
 * second statement is how the Worker finds out whether the row went.
 */
reset();

const SOLE = (await (await signIn({ id: 99 })).clone().json()).session;
await addMember(SOLE, { telegramId: "4242", role: "admin", label: "Alex" });

const lastAdmin = await call("DELETE", "/membership/admin/" + FIXTURE_4242,
  { headers: bearer(SOLE) });
check("removing the last admin row is refused",
  lastAdmin.status === 409, `${lastAdmin.status}`);
check("and the row is still there",
  roster.length === 1 && roster[0].role === "admin", `${roster.length} row(s)`);

/*
 * The refusal explains itself, and that is deliberate rather than an
 * exception to the identical-refusal rule above. Only somebody who may
 * already read the whole list can provoke it, so it tells them nothing
 * they could not read directly - while an admin who could not tell "the
 * last admin" from "no such row" would press Remove again, or start
 * looking for the bug.
 */
check("with a refusal that says which refusal it is",
  String((await lastAdmin.clone().json()).error).includes("last admin"),
  JSON.stringify(await lastAdmin.clone().json()));

await statusOf("an always_allow row has no such guard",
  addMember(SOLE, { telegramId: "4242", role: "always_allow", label: "Alex" }),
  200);
await statusOf("and comes off freely, even as the only one",
  call("DELETE", "/membership/always_allow/" + FIXTURE_4242,
    { headers: bearer(SOLE) }), 200);
check("which leaves the admin row untouched",
  roster.length === 1 && roster[0].role === "admin", `${roster.length} row(s)`);

await statusOf("a second admin is what unlocks the removal",
  addMember(SOLE, { telegramId: "31337", role: "admin", label: "Sam" }), 200);
await statusOf("and then the first one comes off",
  call("DELETE", "/membership/admin/" + FIXTURE_4242,
    { headers: bearer(SOLE) }), 200);
check("leaving exactly one admin row",
  roster.filter((r) => r.role === "admin").length === 1,
  `${roster.length} row(s)`);

/*
 * Removing a row that was never there still succeeds, and the guard
 * must not turn that into a refusal. The two are told apart by whether
 * the row is there afterwards rather than by counting admins, which is
 * why the batch asks for the row rather than for a number: with one
 * admin left, "delete nobody's row" and "delete the last admin's row"
 * have the same admin count on both sides of the statement.
 */
await statusOf("removing a row that is not there still succeeds",
  call("DELETE", "/membership/admin/" + "1".repeat(64),
    { headers: bearer(SOLE) }), 200);
check("and the last admin is still the last admin",
  roster.filter((r) => r.role === "admin").length === 1,
  `${roster.length} row(s)`);

/* ------------------------------------------------------------------ */
/* A row that grants nothing cannot stand in for the last admin.       */

/*
 * WHAT THE GUARD HAS TO COUNT, WHICH IS GRANTS AND NOT ROWS.
 *
 * `wrangler d1 execute` writes an account id in upper-case hex without
 * complaint and the authority read drops that row, so it sits in the
 * table granting nobody anything. A guard counting every row whose role
 * is `admin` counts that one: with one real admin beside one dud the
 * count reads two, the last granting row comes off, and the list is
 * empty with the refusal never firing. The dual-read is what keeps that
 * latent rather than live - the secret still grants - so the day
 * `ADMIN_TELEGRAM_IDS` goes table-only is the day it becomes a lockout
 * with no lever inside the product. OPERATIONS.md, "Making someone an
 * admin", is where that precondition is written down for the person who
 * performs the flip.
 *
 * BOTH DIRECTIONS IN ONE STAGING, because narrowing the count on its
 * own would trade the lockout for an unremovable dud. The row that
 * grants nothing has to keep coming off - GET's `malformed` list hands
 * an admin its id precisely so they can - and the refusal that says
 * "that is the last admin row" must never be given about a row that is
 * no admin at all.
 */
reset();

const MIXED = (await (await signIn({ id: 99 })).clone().json()).session;
await addMember(MIXED, { telegramId: "4242", role: "admin", label: "Alex" });
await addMember(MIXED, { telegramId: "31337", role: "admin", label: "Sam" });

/* Sixty-four correct characters in the wrong case: the one shape POST
 * cannot produce and the database console writes without complaint. */
const PASTED = "A".repeat(64);
const pastedByHand = () => roster.push({
  account_id: PASTED, role: "admin", label: "Pasted into the console",
  added_at: "2026-08-08T00:00:00.000Z", added_by: "by hand",
});
pastedByHand();

/* The ids are taken from the list rather than computed here, because
 * the list is what an admin presses Remove from - a test that removed
 * an id this file derived would be driving a door the pane does not
 * use. */
const mixed = await (await call("GET", "/membership",
  { headers: bearer(MIXED) })).json();
const samRow = mixed.membership.find((row) => row.label === "Sam");
check("two rows grant admin and the pasted one is not among them",
  mixed.membership.filter((row) => row.role === "admin").length === 2 &&
  mixed.malformed.length === 1 && mixed.malformed[0].account_id === PASTED,
  JSON.stringify({ grant: mixed.membership.length,
    dud: mixed.malformed.length }));

await statusOf("with two rows granting admin, the first still comes off",
  call("DELETE", "/membership/admin/" + FIXTURE_4242,
    { headers: bearer(MIXED) }), 200);

const inflated = await call("DELETE",
  "/membership/admin/" + (samRow ? samRow.account_id : UNLISTED),
  { headers: bearer(MIXED) });
check("but the last row that really grants admin is refused, dud or no dud",
  inflated.status === 409, `${inflated.status}`);
check("and it is still there to be refused again",
  roster.filter((r) => r.role === "admin" && r.account_id !== PASTED)
    .length === 1,
  JSON.stringify(roster.map((r) => r.label)));

/*
 * The other direction, on the same table: the dud is what the admin was
 * told to remove, so the narrowed guard must not have made it sticky.
 * The id goes back in the case the list handed it out in, since that is
 * what the pane's button carries.
 */
await statusOf("while the row that grants nothing comes off as it always did",
  call("DELETE", "/membership/admin/" + PASTED.toLowerCase(),
    { headers: bearer(MIXED) }), 200);
check("leaving one admin row, which is the one that grants",
  roster.length === 1 && roster[0].label === "Sam",
  JSON.stringify(roster.map((r) => r.label)));

/*
 * And the case that has nothing to fall back on inside the table: a
 * table whose only `admin` row grants nobody. Refusing that removal
 * would tell an admin they are looking at the last admin row while the
 * admin list is, in every sense the Worker honors, already empty.
 */
reset();

const DUD_ONLY = (await (await signIn({ id: 99 })).clone().json()).session;
pastedByHand();
await statusOf("a table whose only admin row grants nobody lets go of it",
  call("DELETE", "/membership/admin/" + PASTED.toLowerCase(),
    { headers: bearer(DUD_ONLY) }), 200);
check("and the table is empty, which is where it already stood",
  roster.length === 0, JSON.stringify(roster.map((r) => r.label)));

/*
 * The MECHANISM, and not only the outcome.
 *
 * Every assertion above survives an implementation that counts the
 * admins in one round trip, decides in JavaScript, and then sends an
 * unguarded DELETE - the exact read-then-write race the guard exists to
 * close. It survives because a table's state afterwards is the same
 * either way, and no stub short of a real database can make the race
 * happen on demand. So the statements themselves are the assertion:
 * both halves arrive through ONE batch() call, and no admin is counted
 * outside it.
 *
 * The one membership statement that legitimately runs alone is the
 * per-request authority read behind every admin route, which counts
 * nothing and decides nothing about this delete. Naming it rather than
 * excluding a pattern is what keeps a smuggled-in count visible.
 */
reset();

const PAIR = (await (await signIn({ id: 99 })).clone().json()).session;
await addMember(PAIR, { telegramId: "4242", role: "admin", label: "Alex" });
await addMember(PAIR, { telegramId: "31337", role: "admin", label: "Sam" });

executed = [];
batches = [];
await call("DELETE", "/membership/admin/" + FIXTURE_4242,
  { headers: bearer(PAIR) });

const together = batches.length === 1 ? batches[0] : [];
const alone = executed.filter((s) => s.table === "membership" && !s.batch);

check("removing a row makes exactly one batch() call",
  batches.length === 1, `${batches.length} batch call(s)`);
check("carrying exactly the two statements the guard is made of",
  together.length === 2, `${together.length} statement(s) in the batch`);
check("the first deletes with the count as a subquery, not as a round trip",
  together.length === 2 && /^\s*DELETE FROM membership/i.test(together[0].sql) &&
  /\(SELECT COUNT\(\*\) FROM membership AS \w+ WHERE \w+\.role = 'admin'/i
    .test(together[0].sql) &&
  /\) > 1\)/.test(together[0].sql),
  together.length ? together[0].sql : "no statement");

/*
 * The statement's own words, and not only what it did to `roster`.
 *
 * The outcome arms above are answered by a stub that models the guard,
 * so they hold the stub and the Worker to each other rather than either
 * to SQLite. What SQLite is actually sent is this string, and the two
 * clauses that matter are the ones the wide guard did not have: the
 * count is taken over rows carrying an account id of the right length
 * and the right alphabet, and the row being deleted is spared when it
 * does not. A regex over the statement is the only assertion that
 * survives the stub being wrong.
 */
check("the count it takes is over rows that grant, not every admin row",
  together.length === 2 &&
  /COUNT\(\*\)[\s\S]*length\(\w+\.account_id\) = 64[\s\S]*\w+\.account_id NOT GLOB '\*\[\^0-9a-f\]\*'/i
    .test(together[0].sql),
  together.length ? together[0].sql : "no statement");
check("and the row being removed is spared that count when it grants nothing",
  together.length === 2 &&
  /AND \(NOT \(length\(account_id\) = 64 AND account_id NOT GLOB '\*\[\^0-9a-f\]\*'\) OR \(SELECT COUNT/i
    .test(together[0].sql),
  together.length ? together[0].sql : "no statement");
check("the second asks for the row, which is what a count cannot answer",
  together.length === 2 &&
  /^\s*SELECT account_id FROM membership WHERE/i.test(together[1].sql) &&
  !/COUNT\(\*\)/i.test(together[1].sql),
  together.length > 1 ? together[1].sql : "no statement");
check("and the only membership statement outside it is the authority read",
  alone.length === 1 &&
  alone[0].sql === "SELECT account_id FROM membership WHERE role = ?",
  JSON.stringify(alone.map((s) => s.sql)));

/* ------------------------------------------------------------------ */
/* The guard as SQLite runs it, and not as a string.                   */

/*
 * WHAT EVERY ARM ABOVE STILL CANNOT SEE.
 *
 * The outcome arms hold the Worker and the stub to each other, and the
 * stub's model of the guard is a JavaScript re-implementation of the
 * statement rather than the statement. The two arms after them hold the
 * Worker to a regex over its own text. Between them nothing has asked
 * an SQL engine anything, so every belief the statement is built on is
 * unchecked: that GLOB takes a negated character class at all, that
 * GLOB is case-sensitive where LIKE is not - which is the whole reason
 * an upper-case paste reads as a dud - and that length() counts what
 * grantsAnything() counts. If any of them were wrong, every row above
 * would still read `pass` and the guard would be wrong in D1. That is
 * the armed-looking shape, arriving through the one door a text pin
 * cannot close.
 *
 * So these arms EXECUTE the statement the Worker actually sent -
 * captured from the batch above - against server/schema.sql's own
 * membership table. Neither is retyped here: a retyped statement is a
 * test of the typing, and a hand-written table is a test of a table
 * nothing deploys.
 *
 * NOT D1, AND SAYING SO IS THE POINT. D1 is SQLite with a network in
 * front of it, so the dialect is the same and the concurrency is not.
 * These settle the dialect half, which nothing else in this repository
 * touches; the batch arms above settle the atomicity half, which this
 * cannot. Neither is sufficient alone, which is why both are here.
 *
 * THE IDS ARE DELIBERATELY NOT CASE-VARIANTS OF EACH OTHER. The DELETE
 * matches through COLLATE NOCASE while the primary key does not carry
 * it, so `aaa...` and `AAA...` can both sit in the table and one press
 * reaches both rows. That staging is a known residual and belongs to
 * its own change; staging it here by accident would make these arms
 * assert it silently.
 */
if (DatabaseSync) {
  /*
   * The comments come out for the reason the SUPERSEDES read at the top
   * of this file gives at length: a regex over the raw schema cannot
   * tell the prose explaining a statement from the statement.
   */
  const membershipTable =
    /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+membership\s*\([^;]*\);/i
      .exec(SCHEMA.replace(/--[^\n]*/g, ""));

  /*
   * THE WORKER'S OWN STATEMENT, taken off the batch it travelled in
   * rather than typed here. Its two placeholders are the id and the
   * role the route binds, in that order, which is why the staging
   * below binds exactly those two and nothing else.
   */
  const guardStatement = together.length === 2 ? together[0].sql : "";
  const binds = (guardStatement.match(/\?/g) || []).length;

  const GRANTS_ONE = "a".repeat(64);
  const GRANTS_TWO = "b".repeat(64);
  const WRONG_CASE = "C".repeat(64);
  const TOO_SHORT = "d".repeat(63);
  const NOT_HEX = "z".repeat(64);

  /*
   * One staging, start to finish: rows in, the captured DELETE run over
   * the real engine, and what is left read back. A fresh database per
   * staging, because a guard that refuses is a statement that matched
   * no row, and a leftover row from the staging before would be
   * indistinguishable from one the guard held back.
   */
  const staging = (rows, remove) => {
    const db = new DatabaseSync(":memory:");
    db.exec(membershipTable[0]);
    const insert = db.prepare(
      "INSERT INTO membership (account_id, role, label, added_at, added_by)" +
      " VALUES (?, 'admin', 'by hand', '2026-08-08T00:00:00.000Z', 'console')");
    for (const id of rows) insert.run(id);
    db.prepare(guardStatement).run(remove, "admin");
    const left = db.prepare("SELECT account_id FROM membership").all()
      .map((row) => row.account_id).sort();
    db.close();
    return left;
  };

  const held = (rows, remove) => JSON.stringify(staging(rows, remove));

  /*
   * THE TWO THINGS THE STAGING ASSUMES, ASSERTED BEFORE IT RUNS.
   *
   * That the table came out of the schema at all and carries the
   * composite key. Nothing below would notice it going: the rows these
   * arms stage carry pairwise distinct account ids, so a table keyed on
   * account_id alone accepts every one of them and all six stagings
   * still pass - while the guard's DELETE names a role that such a
   * table can hold only one of per account, which makes every one of
   * those arms a question about a table nothing deploys. This conjunct
   * is the only thing in this file that reds when the key changes.
   *
   * And that the Worker's statement takes exactly the two binds the
   * staging hands it. Nothing else here says so, and node:sqlite will
   * not say it either: handed fewer values than the statement has
   * placeholders, it binds the rest NULL and runs the statement anyway.
   * A third placeholder in the Worker's DELETE therefore runs down
   * there as a quietly different statement that the arms below can
   * still pass, and this arm is the sole detector of it - which is why
   * it stands first. The throw runs the other way: more values than
   * placeholders raises "column index out of range", so a placeholder
   * taken OUT of the DELETE reds this arm by name and then crashes the
   * staging, and that crash arrives already diagnosed. What this arm
   * deliberately does NOT assert is that the captured string is the one
   * captured - the line above defines it that way, and a conjunct
   * restating its own definition reds for no reason that ships.
   */
  check("the table is the schema's own and the statement takes two binds",
    membershipTable !== null &&
    /PRIMARY KEY\s*\(\s*account_id\s*,\s*role\s*\)/i.test(membershipTable[0]) &&
    binds === 2,
    `${binds} bind(s): ` + guardStatement.slice(0, 60));

  check("SQLite really deletes: of two rows that grant, the first comes off",
    held([GRANTS_ONE, GRANTS_TWO], GRANTS_ONE) ===
    JSON.stringify([GRANTS_TWO]),
    held([GRANTS_ONE, GRANTS_TWO], GRANTS_ONE));

  check("and the last row that grants is refused by the engine itself",
    held([GRANTS_ONE], GRANTS_ONE) === JSON.stringify([GRANTS_ONE]),
    held([GRANTS_ONE], GRANTS_ONE));

  check("three rows that grant nothing do not add up to a second admin",
    held([GRANTS_ONE, WRONG_CASE, TOO_SHORT, NOT_HEX], GRANTS_ONE) ===
    JSON.stringify([WRONG_CASE, GRANTS_ONE, TOO_SHORT, NOT_HEX].sort()),
    held([GRANTS_ONE, WRONG_CASE, TOO_SHORT, NOT_HEX], GRANTS_ONE));

  check("while the engine spares the dud the same statement is refusing for",
    held([GRANTS_ONE, WRONG_CASE], WRONG_CASE.toLowerCase()) ===
    JSON.stringify([GRANTS_ONE]),
    held([GRANTS_ONE, WRONG_CASE], WRONG_CASE.toLowerCase()));

  check("and it empties a table whose only admin row grants nobody",
    held([WRONG_CASE], WRONG_CASE.toLowerCase()) === JSON.stringify([]),
    held([WRONG_CASE], WRONG_CASE.toLowerCase()));
}

/* ------------------------------------------------------------------ */
/* A development session may not write an admin row.                   */

/*
 * A row written from a development session is a real admin row, and
 * after the flip to table-only it is the whole authority. So such a
 * session keeps every power it has over the data and loses this one - it
 * may still manage the always-allow list, which is what makes a local
 * admin page workable at all.
 *
 * There is deliberately no escape hatch. "Unless the gating is explicit"
 * is satisfied by a refusal, not by a second secret to forget.
 *
 * REACHING THIS GUARD NOW TAKES TWO HAND-WRITTEN ROWS, and that is the
 * measure of how narrow it has become rather than a reason to drop it
 * (0.9-M2-S1, #352). Nothing mints an is_dev session, and adminness
 * comes from the lists, so the caller this refuses is somebody who has
 * written both a session row and a `membership` row straight into D1.
 * That caller is exactly the one who should not be able to turn a
 * session into a durable admin row - the session expires, the row does
 * not.
 */
reset();

const DEV_ADMIN = "hand-written-dev-admin-for-the-membership-guard";
roster.push({
  account_id: FIXTURE_DEV_SUBJECT, role: "admin", label: "Seeded",
  added_at: new Date().toISOString(), added_by: "seed",
});
sessions.push({
  token_hash: await sha256Hex(DEV_ADMIN),
  account_id: FIXTURE_DEV_SUBJECT,
  is_admin: 1, is_dev: 1,
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
});

await statusOf("the dev session administers",
  call("GET", "/membership", { headers: bearer(DEV_ADMIN) }, devEnv), 200);
await statusOf("and may write the always-allow list",
  call("POST", "/membership", { headers: bearer(DEV_ADMIN),
    body: JSON.stringify(
      { telegramId: "4242", role: "always_allow", label: "Alex" }) },
  devEnv), 200);

const devWrite = await call("POST", "/membership",
  { headers: bearer(DEV_ADMIN),
    body: JSON.stringify({ telegramId: "4242", role: "admin", label: "Alex" }) },
  devEnv);
check("but an admin row from a dev session is refused", devWrite.status === 401,
  `${devWrite.status}`);
check("with the refusal every other one gives, byte for byte",
  (await devWrite.text()) === JSON.stringify({ error: "Not authorized." }));
check("and nothing reached the table - the seeded row is the only admin " +
  "row there is",
  roster.filter((r) => r.role === "admin").length === 1 &&
  !roster.some((r) => r.role === "admin" && r.account_id === FIXTURE_4242),
  `${roster.filter((r) => r.role === "admin").length} admin row(s)`);

/*
 * The refusal stands ahead of every shape check, which is what its
 * comment claims and what this asserts. A malformed body that would
 * otherwise earn a 400 gets the same 401: a caller who may not write
 * this row cannot use the route to find out what it would have said
 * next. The gain is small - the same rule is reachable with a
 * well-formed body - and the comment is load-bearing for whoever
 * reorders these checks later.
 */
const devEarly = await call("POST", "/membership",
  { headers: bearer(DEV_ADMIN),
    body: JSON.stringify({ telegramId: "not-a-number", role: "admin" }) },
  devEnv);
check("and a malformed body earns that refusal rather than a shape complaint",
  devEarly.status === 401 &&
  (await devEarly.text()) === JSON.stringify({ error: "Not authorized." }),
  `${devEarly.status}`);

await addMember(
  (await (await signIn({ id: 99 })).clone().json()).session,
  { telegramId: "4242", role: "admin", label: "Alex" });
await statusOf("nor may a dev session remove one",
  call("DELETE", "/membership/admin/" + FIXTURE_4242,
    { headers: bearer(DEV_ADMIN) }, devEnv), 401);
check("that row is still there",
  roster.some((r) => r.role === "admin"), `${roster.length} row(s)`);

/* ------------------------------------------------------------------ */
/* A row this side cannot honor is shown as a dud, and comes off.      */

/*
 * POST is not the only way into this table. `wrangler d1 execute` is the
 * other, OPERATIONS.md reaches for it by name, and it validates nothing
 * - so an account id pasted there in upper-case hex is sixty-four
 * correct characters that are not the string the Worker compares
 * against. The authority read drops it, so the row grants exactly
 * nothing, while the list would show it beside the rows that do. That is
 * the undetectable-wrong-value failure #69 opens with, arriving by the
 * one door POST cannot guard.
 *
 * Two directions, because either alone leaves the trap open. The list
 * has to tell a granting row from a dud, or nobody learns the row is
 * broken; and DELETE has to fold case rather than refuse the id, or the
 * only thing an admin can do about the dud is open a database console.
 */
reset();

const WARDEN = (await (await signIn({ id: 99 })).clone().json()).session;
await addMember(WARDEN, { telegramId: "4242", role: "admin", label: "Alex" });

const SHOUTER = { id: 31337, username: "shouted" };
const shoutedFor = (await (await call("GET", "/me", {
  headers: bearer((await (await signIn(SHOUTER)).clone().json()).session),
})).json()).accountId;
const SHOUTED = shoutedFor.toUpperCase();

const handWritten = () => roster.push({
  account_id: SHOUTED, role: "admin", label: "Shouted",
  added_at: "2026-08-08T00:00:00.000Z", added_by: "by hand",
});
handWritten();

const shoutedIn = await (await signIn(SHOUTER)).clone().json();
check("an upper-case row grants nothing, the way every unreadable row does",
  shoutedIn.isAdmin === false, `isAdmin=${shoutedIn.isAdmin}`);

const dudList = await (await call("GET", "/membership",
  { headers: bearer(WARDEN) })).json();
check("so it is kept out of the list of rows that do grant",
  dudList.membership.length === 1 &&
  dudList.membership[0].account_id === FIXTURE_4242,
  JSON.stringify(dudList.membership.map((r) => r.account_id)));
check("and named as malformed instead, with the label that says which row",
  Array.isArray(dudList.malformed) && dudList.malformed.length === 1 &&
  dudList.malformed[0].account_id === SHOUTED &&
  dudList.malformed[0].label === "Shouted",
  JSON.stringify(dudList.malformed));

await statusOf("the id the list handed back is an id that removes it",
  call("DELETE", "/membership/admin/" + SHOUTED,
    { headers: bearer(WARDEN) }), 200);
check("and the row is gone",
  !roster.some((r) => r.account_id === SHOUTED), JSON.stringify(roster));

handWritten();
await statusOf("so is the canonical spelling of the same sixty-four characters",
  call("DELETE", "/membership/admin/" + shoutedFor,
    { headers: bearer(WARDEN) }), 200);
check("which is one row normalized, not two rows that happen to agree",
  !roster.some((r) => r.account_id === SHOUTED) &&
  roster.filter((r) => r.role === "admin").length === 1,
  JSON.stringify(roster.map((r) => r.account_id)));

/*
 * The list and the authority read have to agree about every row, so the
 * row that separates a pattern test from a typeof one is asked of the
 * list as well. RegExp.test() stringifies whatever it is handed: a value
 * that is not a string but spells a valid account id passes the pattern
 * alone, and a list that showed it as a grant would be describing
 * authority that no request will honor.
 */
roster.push({ account_id: { toString: () => shoutedFor }, role: "admin",
  label: "Spelled", added_at: "2026-08-08T00:00:00.000Z", added_by: "by hand" });
const spelledList = await (await call("GET", "/membership",
  { headers: bearer(WARDEN) })).json();
check("a row that only spells an account id is a dud to the list too",
  spelledList.membership.every((r) => r.label !== "Spelled") &&
  spelledList.malformed.length === 1 &&
  spelledList.malformed[0].label === "Spelled",
  JSON.stringify(spelledList.malformed.map((r) => r.label)));
roster.pop();

/* An ordinary list still answers with the field, so a reader that looks
 * for duds is not left guessing whether the Worker computes them. */
const cleanList = await (await call("GET", "/membership",
  { headers: bearer(WARDEN) })).json();
check("a list with no duds in it says so rather than leaving the field off",
  Array.isArray(cleanList.malformed) && cleanList.malformed.length === 0,
  JSON.stringify(cleanList.malformed));

/* ------------------------------------------------------------------ */
/* A D1 failure closes.                                                */

/*
 * The table is a grant now, so every way of failing to read it has to
 * end in "not an admin, not a member". Asserted against a binding that
 * throws on the membership read only: an error swallowed into a
 * permissive default is the failure mode nothing else here would catch,
 * because it looks exactly like a working list on a working database.
 *
 * The refusal is the ordinary one rather than a 500. A 500 carries no
 * CORS headers, so the page would report a network failure - and "the
 * database is unwell" is not something a refusal should be telling an
 * unauthenticated caller in any case.
 */
reset();

const CHAIR2 = (await (await signIn({ id: 99 })).clone().json()).session;
await addMember(CHAIR2, { telegramId: "4242", role: "admin", label: "Alex" });
const TABLE_ONLY = (await (await signIn({})).clone().json()).session;

await statusOf("the table-granted session administers while D1 answers",
  call("GET", "/membership", { headers: bearer(TABLE_ONLY) }), 200);

// Every other statement still works, so this is the membership read
// failing rather than the database being gone - which is the harder
// case and the one a fallback would quietly survive.
const brokenRoster = {
  ...env,
  DB: {
    ...DB,
    prepare: (sql) => (/FROM membership/i.test(sql)
      ? {
        bind: () => ({
          run: () => { throw new Error("D1_ERROR"); },
          first: () => { throw new Error("D1_ERROR"); },
          all: () => { throw new Error("D1_ERROR"); },
        }),
        run: () => { throw new Error("D1_ERROR"); },
        first: () => { throw new Error("D1_ERROR"); },
        all: () => { throw new Error("D1_ERROR"); },
      }
      : DB.prepare(sql)),
  },
};

await statusOf("a membership read that throws refuses the session it granted",
  call("GET", "/membership", { headers: bearer(TABLE_ONLY) }, brokenRoster),
  401);
await statusOf("and refuses it everywhere else too",
  call("GET", "/export", { headers: bearer(TABLE_ONLY) }, brokenRoster), 401);
await statusOf("the secret-side admin is unaffected, which is the dual-read",
  call("GET", "/export", { headers: bearer(CHAIR2) }, brokenRoster), 200);

const brokenSignIn = await (await signIn({}, brokenRoster)).clone().json();
check("and a sign-in that cannot read the table mints a member",
  brokenSignIn.isAdmin === false, `isAdmin=${brokenSignIn.isAdmin}`);

/*
 * The routes fail closed too, and not only the authority read.
 *
 * A caller whose adminness comes from the secret gets past the gate on a
 * database whose membership table throws, and then the handler's own
 * query is the thing that fails. Unhandled, that leaves the Worker with
 * a status and nothing else: no CORS headers, so a browser reports a
 * network error rather than a refusal, and no `{error}` body, so the
 * page has nothing to show. Every other refusal on this Worker is the
 * same shape, and a 500 is the one an admin is most likely to meet on a
 * bad day.
 *
 * The header list is compared against a real refusal rather than
 * asserted item by item, because "the same shape" is the claim and a
 * hand-written list would drift away from corsHeaders() silently.
 */
const shapeOf = async (res) => {
  // A body that is not JSON is reported rather than thrown, so a refusal
  // that answers a bare status fails this check instead of ending the
  // run - a crashed suite says less about which claim broke.
  let keys;
  try {
    keys = Object.keys(await res.clone().json());
  } catch (e) {
    keys = "no JSON body";
  }
  return JSON.stringify({
    cors: ["Access-Control-Allow-Origin", "Access-Control-Allow-Methods",
      "Access-Control-Allow-Headers", "Access-Control-Max-Age", "Vary",
      "Content-Type"].map((h) => res.headers.get(h)),
    keys: keys,
  });
};

const ordinaryRefusal = await shapeOf(
  await call("GET", "/membership", { headers: bearer("nobody") }));

const escaped = await call("GET", "/membership",
  { headers: bearer(CHAIR2) }, brokenRoster).catch((e) => e);
check("a D1 throw inside GET is answered rather than escaping the Worker",
  escaped instanceof Response && escaped.status === 500,
  escaped instanceof Response ? `${escaped.status}` : `threw ${escaped}`);
check("in the same shape every other refusal here has",
  escaped instanceof Response && (await shapeOf(escaped)) === ordinaryRefusal,
  escaped instanceof Response
    ? `${await shapeOf(escaped)} want ${ordinaryRefusal}` : "no response");

const escapedDelete = await call("DELETE", "/membership/admin/" + FIXTURE_4242,
  { headers: bearer(CHAIR2) }, brokenRoster).catch((e) => e);
check("and a D1 throw inside DELETE is answered the same way",
  escapedDelete instanceof Response && escapedDelete.status === 500 &&
  (await shapeOf(escapedDelete)) === ordinaryRefusal,
  escapedDelete instanceof Response
    ? `${escapedDelete.status} ${await shapeOf(escapedDelete)}` : "no response");

/*
 * The other two ways a read comes back wrong, armed separately from the
 * throw above. An absent `rows` and a `results` that is not a list both
 * reach the loop that walks the rows, and iterating either one throws -
 * so without the guards a database answering oddly turns every sign-in
 * into a 500 rather than into a session with no authority. The shapes
 * are asserted through sign-in because that is where the loop runs
 * before anything else can refuse.
 */
const answeredWith = (results) => ({
  ...env,
  DB: {
    ...DB,
    prepare: (sql) => (/FROM membership WHERE role = \?/i.test(sql)
      ? { bind: () => ({ all: async () => results }) }
      : DB.prepare(sql)),
  },
});

await statusOf("a membership read answering nothing still signs somebody in",
  signIn({}, answeredWith(undefined)), 200);
await statusOf("and so does one whose `results` is not a list at all",
  signIn({}, answeredWith({ results: { length: 1, 0: { account_id: "x" } } })),
  200);

/*
 * An unreadable row grants nothing either, and is dropped rather than
 * coerced.
 *
 * The third row is the one that makes this check worth running, and it
 * is why the guard tests `typeof` and not only the pattern:
 * RegExp.test() stringifies whatever it is handed, so a value that is
 * not a string but spells one passes a check written with the pattern
 * alone. The first two rows are the ordinary junk - and on their own
 * they prove nothing, because "null" and "not-an-account-id" are
 * perfectly good Set members that simply match nobody. A check that
 * only had those would pass whether the guard existed or not.
 */
const OUTSIDER = { id: 31337, username: "junk" };
const strangerId = (await (await call("GET", "/me",
  { headers: bearer(
    (await (await signIn(OUTSIDER)).clone().json()).session) })).json())
  .accountId;

roster.push({ account_id: null, role: "admin", label: "Broken",
  added_at: "", added_by: "" });
roster.push({ account_id: "not-an-account-id", role: "admin", label: "Broken",
  added_at: "", added_by: "" });
roster.push({ account_id: { toString: () => strangerId }, role: "admin",
  label: "Broken", added_at: "", added_by: "" });

const afterJunk = await (await signIn(OUTSIDER)).json();
check("a row this side cannot read grants nobody anything",
  afterJunk.isAdmin === false, `isAdmin=${afterJunk.isAdmin}`);

/* ------------------------------------------------------------------ */
/* Dual-read equivalence, and the signal that makes the flip takeable. */

/*
 * The three configurations that must answer identically while both arms
 * are live: the secret alone, the table alone, and both together. If
 * they ever diverge, the flip to table-only is not a migration but a
 * change of who administers - and the point of shipping dual-read
 * rather than table-only is that this is checkable before anybody's
 * authority moves.
 *
 * `secretOnly` is the live half of the same question. The secret holds
 * numeric ids and the table holds HMACs of them, so nobody can compare
 * the two by reading a dashboard - only the Worker holds ACCOUNT_SECRET
 * and can. An empty `secretOnly` is what says the backfill is complete
 * and the flip would take nobody's authority away.
 */
const secretOnly = { ...env, ADMIN_TELEGRAM_IDS: "99" };
const tableOnly = { ...env, ADMIN_TELEGRAM_IDS: "" };

const equivalent = [];
for (const [label, e, seed] of [
  ["the secret alone", secretOnly, false],
  ["the table alone", tableOnly, true],
  ["both at once", secretOnly, true],
]) {
  reset();
  if (seed) {
    // Seeded through the break-glass token, because with an empty
    // secret and an empty table there is no admin session to seed with
    // - which is the state a real backfill starts from.
    await call("POST", "/membership", { headers: bearer("sekrit-token-value"),
      body: JSON.stringify({ telegramId: "99", role: "admin", label: "Root" }) },
    e);
  }
  const who = await (await signIn({ id: 99, username: "root" }, e)).clone().json();
  const list = await call("GET", "/membership",
    { headers: bearer(who.session) }, e);
  equivalent.push([label, who.isAdmin, list.status].join(" "));
}
check("the secret alone, the table alone and both agree exactly",
  new Set(equivalent.map((a) => a.split(" ").slice(-2).join(" "))).size === 1,
  JSON.stringify(equivalent));

reset();
const AUDITOR = (await (await signIn({ id: 99 })).clone().json()).session;
const notYet = await (await call("GET", "/membership",
  { headers: bearer(AUDITOR) })).json();
check("an un-backfilled secret admin is named as one",
  Array.isArray(notYet.secretOnly) && notYet.secretOnly.length === 1,
  JSON.stringify(notYet.secretOnly));
check("and never as the numeric id it was derived from",
  !String(JSON.stringify(notYet.secretOnly)).includes("99"),
  JSON.stringify(notYet.secretOnly));

await quietly(() =>
  addMember(AUDITOR, { telegramId: "99", role: "admin", label: "Root" }));
const backfilled = await (await call("GET", "/membership",
  { headers: bearer(AUDITOR) })).json();
check("and once the row exists the list is empty, which is the go-signal",
  Array.isArray(backfilled.secretOnly) && backfilled.secretOnly.length === 0,
  JSON.stringify(backfilled.secretOnly));

/* ------------------------------------------------------------------ */
/* An admin changing their own row is recorded.                        */

/*
 * `added_by` answers who wrote a row that exists. A removal leaves no
 * row to carry it, and the removal worth recording most is an admin
 * taking their own authority away or handing themselves somebody
 * else's. So the record is a log line carrying account ids and nothing
 * else - the same HMAC already sitting in the clear in the table beside
 * it, never the numeric id, and never echoed back in a response where
 * anything holding the session could read it.
 */
reset();

const SELF = (await (await signIn({ id: 99 })).clone().json()).session;
const selfId = (await (await call("GET", "/me",
  { headers: bearer(SELF) })).json()).accountId;

const recorded = [];
const beforeLog = console.log;
console.log = (line) => recorded.push(String(line));
const selfWrite = await addMember(SELF,
  { telegramId: "99", role: "always_allow", label: "Root" });
const otherWrite = await addMember(SELF,
  { telegramId: "4242", role: "always_allow", label: "Alex" });
const selfBody = await selfWrite.clone().text();
console.log = beforeLog;

check("an admin adding their own row is recorded, by account id",
  recorded.length === 1 && recorded[0].includes(selfId),
  JSON.stringify(recorded));
check("a row about somebody else is not that record",
  !recorded.join("").includes(FIXTURE_4242) && otherWrite.status === 200,
  JSON.stringify(recorded));
check("and the record carries no numeric id",
  !recorded.join("").includes("\"99\"") && !recorded.join("").includes(":99"),
  JSON.stringify(recorded));
check("nor is any of it echoed back to the caller",
  selfBody === JSON.stringify({ ok: true }), selfBody);

report();
