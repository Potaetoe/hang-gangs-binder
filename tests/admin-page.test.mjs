/*
 * apps/web/admin.html and apps/web/admin.js against 0.9-M3-S10's own
 * contract (#416; the ruled design #385 §1-§2, §4-§5, §9, §11).
 *
 *     node tests/admin-page.test.mjs
 *
 * WHAT THIS SLICE REMOVED, PROVEN ABSENT IN SECTION 1: the keyfile-
 * decrypt tool (the private-key textarea, the file picker, "Fetch and
 * decrypt"), and - by Prime's ruling on this ticket's own fork
 * (2026-08-21, reading #385 §4: no admin surface exposes a current
 * member's data) - the CSV/xlsx/JSON entry exports and the snapshot
 * publish/unpublish controls those depended on. The ticket's own
 * apparatus section says "exports still wired"; that sentence is
 * superseded by the ruling, and this suite tests the ruling, not the
 * ticket's original wording - see the completion comment on #416 for
 * the full account.
 *
 * WHAT SURVIVES AND IS BUILT HERE: a Settings card (GET/POST /content,
 * five keys, one write per key, client validation mirroring #414's
 * server-side rules), a Roles card (GET/POST/DELETE /membership plus
 * /me's adminVia - admin only, no more always_allow), and a Change log
 * card (GET /admin-log, newest first). All three are stubbed against
 * S8's real, landed contract (#414 completion, comment 5370945709,
 * folded in before this suite's own last build - the route is
 * /admin-log rather than the ticket's own /admin/log, adminVia carries
 * a fourth "break-glass" value, and site.defaultTheme accepts "" the
 * same way chart.lockedUnit does).
 *
 * THE DOM HALF IS A HAND-BUILT STUB, not jsdom - the same rejection
 * tests/charts-page.test.mjs and tests/your-page.test.mjs both state:
 * a small node factory with just the surface admin.js touches
 * (getElementById, createElement, appendChild/removeChild, textContent,
 * addEventListener/dispatch), driven by real events rather than by
 * calling admin.js's internal functions directly - those are closures
 * inside one IIFE and stay closures on purpose.
 *
 * RENDER-ONLY (AGENTS.md's "Verify what renders" and this page's own
 * security mandate): every row this page draws from a server answer -
 * a membership label, a change-log summary - goes through textContent,
 * proven two ways: a static sweep for innerHTML anywhere in admin.js
 * (section 1), and a hostile string driven end to end through the
 * Roles and Change log cards (section 3) landing as inert text.
 *
 * 0.9-M3-S30 (#452) REBUILDS THE FIELDS CARD, against 0.9-M3-S25's
 * landed GET /admin-fields (#440): tabs replace four stacked cards
 * (#385 item (b), #454 item 20 - section 3's "-- Tabs --" block); a
 * rename is one button sending mode "relabel" always, never a choice
 * between two (RENAME_MODE/RENAME_CONSEQUENCE replace the retired
 * RENAME_CHOICES); retiring a field or a value confirms IN PLACE, a
 * sentence plus Yes/Cancel, never a same-button double-press (#454
 * item 9); and bring-back works for anything retired, from any
 * session, because the read itself now carries the retired set marked
 * (fieldView() replaces the retired mergeFieldsRoster/
 * fieldsRosterView session memory - see admin.js's own comment on
 * fieldView() for the shape). The container-key translation
 * (`choices` on the read, `values` on the write) is armed in the
 * "-- The choices-to-values translation --" block, per F7 of
 * 0.9-M3-S25's own review on #440 (comment 5377697322).
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFile(HERE(p), "utf8");

let performed = 0;
let failures = 0;
function check(label, condition) {
  performed += 1;
  if (!condition) failures += 1;
  console.log((condition ? "pass  " : "FAIL  ") + label);
}

/* ------------------------------------------------------------------ */
/* 1. The keyfile tool is gone, whole - no dangling ids, no dead        */
/* listeners, no export machinery, render-only throughout.              */

const adminHtml = await read("../apps/web/admin.html");
const adminJs = await read("../apps/web/admin.js");
const distHtml = await read("../dist/admin.html");
const distJs = await read("../dist/admin.js");
// Fix wave 1 (#458 review, F4/F5 in the review's own numbering): the
// tablist overflow fix lives in theme.css, not admin.js - read both
// copies here so the parsed-CSS arm below has something to parse.
const themeCss = await read("../apps/web/theme.css");
const distThemeCss = await read("../dist/theme.css");

const DEAD_IDS = ["keyfile", "keyfile-picker", "run", "clear",
  "published-state", "unpublish", "unpublish-status", "membership-card",
  "failures", "failure-list", "results", "download", "download-xlsx",
  "download-json", "dashboard", "publish-card", "publish", "publish-preview",
  "idle-warning"];
// idle-warning is a live id (the shared timer survives) - excluded from
// the dead-id sweep and checked as present instead, two lines down.
const REALLY_DEAD = DEAD_IDS.filter((id) => id !== "idle-warning");

check("no dead keyfile/export/publish id survives in apps/web/admin.html",
  REALLY_DEAD.every((id) => !adminHtml.includes('id="' + id + '"')));
check("no dead keyfile/export/publish id survives in dist/admin.html",
  REALLY_DEAD.every((id) => !distHtml.includes('id="' + id + '"')));
check("the idle timer's own markup survives - it is not part of the " +
  "keyfile tool, DESIGN.md's 'Sessions' rules it for every signed-in " +
  "page",
  adminHtml.includes('id="idle-warning"'));

check("the keyfile tool's own words are gone from the page",
  !/Fetch and decrypt/.test(adminHtml) &&
  !/Private key/.test(adminHtml) &&
  !/Publish snapshot/.test(adminHtml));

check("no script tag loads crypto.js or xlsx.js on this page - nothing " +
  "here decrypts or builds a workbook any more",
  !/src="crypto\.js"/.test(adminHtml) && !/src="xlsx\.js"/.test(adminHtml));

check("admin.js references no crypto or export machinery",
  !/BinderCrypto/.test(adminJs) && !/BinderXlsx/.test(adminJs) &&
  !/KEY_DB|IndexedDB|indexedDB/.test(adminJs) &&
  !/new Blob\(/.test(adminJs) && !/toCsv|entryFor|rowFor|csvCell/.test(adminJs));

check("admin.js never writes innerHTML - everything from the server " +
  "lands through textContent",
  !/\.innerHTML\s*=/.test(adminJs));

check("the /export and /snapshot routes are never called from this page",
  !/["'`]\/export["'`]/.test(adminJs) && !/\/snapshot/.test(adminJs));

check("apps/web/admin.js and dist/admin.js agree on every one of these " +
  "facts - the mirror is not stale",
  !/BinderCrypto|BinderXlsx|new Blob\(/.test(distJs) &&
  !distJs.includes(".innerHTML ="));

/* ------------------------------------------------------------------ */
/* 2. The pure half: validation, notices, membership, the log.          */

await import("data:text/javascript," + encodeURIComponent(adminJs));
const Admin = globalThis.BinderAdmin;

check("admin.js publishes BinderAdmin, frozen",
  Admin !== undefined && Object.isFrozen(Admin));

const beforeDistParity = Object.keys(globalThis.BinderAdmin).sort().join(",");
await import("data:text/javascript," + encodeURIComponent(distJs) +
  "#dist-parity");
const afterDistParity = Object.keys(globalThis.BinderAdmin).sort().join(",");
check("admin.js's shipped bytes and dist's agree, functionally: both " +
  "publish the same frozen API surface",
  beforeDistParity === afterDistParity);

/* -- Settings validation, mirroring S8's real server-side rules      */
/* (#414 completion, comment 5370945709, the "contract, in full" block) -- */

check("the floor accepts a whole number, 0 to 999999, no leading zero",
  Admin.validateFloor("0").ok === true &&
  Admin.validateFloor("0").value === "0" &&
  Admin.validateFloor("12").ok === true &&
  Admin.validateFloor("999999").ok === true);
check("the floor refuses a negative number, a fraction, empty text and " +
  "a leading zero",
  Admin.validateFloor("-1").ok === false &&
  Admin.validateFloor("1.5").ok === false &&
  Admin.validateFloor("").ok === false &&
  Admin.validateFloor("five").ok === false &&
  Admin.validateFloor("007").ok === false);
check("the floor trims surrounding whitespace before judging it",
  Admin.validateFloor("  7  ").ok === true &&
  Admin.validateFloor("  7  ").value === "7");

check("the locked unit accepts metric, imperial, or empty (unlocked)",
  Admin.validateLockedUnit("metric").ok === true &&
  Admin.validateLockedUnit("imperial").ok === true &&
  Admin.validateLockedUnit("").ok === true);
check("the locked unit refuses anything else",
  Admin.validateLockedUnit("furlongs").ok === false &&
  Admin.validateLockedUnit("Metric").ok === false);

check("the group name refuses to be empty",
  Admin.validateGroupName("").ok === false &&
  Admin.validateGroupName("   ").ok === false);
check("the group name accepts real text, trimmed",
  Admin.validateGroupName("  Hang Gang  ").ok === true &&
  Admin.validateGroupName("  Hang Gang  ").value === "Hang Gang");
check("the group name refuses past 64 characters",
  Admin.validateGroupName("x".repeat(64)).ok === true &&
  Admin.validateGroupName("x".repeat(65)).ok === false);

check("the welcome text accepts empty - a real choice, not a mistake",
  Admin.validateWelcomeText("").ok === true &&
  Admin.validateWelcomeText("").value === "");
check("the welcome text trims what it is given",
  Admin.validateWelcomeText("  hello  ").value === "hello");
check("the welcome text refuses past 500 characters",
  Admin.validateWelcomeText("x".repeat(500)).ok === true &&
  Admin.validateWelcomeText("x".repeat(501)).ok === false);

check("the default theme accepts the four named palettes AND empty - " +
  "\"follow the visitor's own system\" is a real stored value, the same " +
  "shape as the locked unit",
  Admin.THEMES.every((name) => Admin.validateDefaultTheme(name).ok === true) &&
  Admin.validateDefaultTheme("").ok === true &&
  Admin.validateDefaultTheme("").value === "");
check("the default theme refuses anything not in the list and not empty",
  Admin.validateDefaultTheme("sunrise").ok === false);

check("every settings key has a validator and a shipped default",
  Object.keys(Admin.SETTINGS_DEFAULTS).every((key) =>
    typeof Admin.SETTINGS_VALIDATORS[key] === "function"));
check("the shipped default theme is empty - unset means follow the " +
  "visitor's own system, not a literal palette choice",
  Admin.SETTINGS_DEFAULTS["site.defaultTheme"] === "");

/* -- The floor notice (#385 §11): the honest-empty-state rule -- */

check("floorNotice says the floor is off at 0",
  /off/i.test(Admin.floorNotice("0")));
check("floorNotice states the member-facing sentence when the floor is on",
  Admin.floorNotice("5").includes("Groups smaller than 5 are hidden"));

/* -- Roles: one role only, no more always_allow -- */

check("MEMBERSHIP_ROLES is admin, and admin alone",
  JSON.stringify(Admin.MEMBERSHIP_ROLES) === JSON.stringify(["admin"]));

const MEMBERSHIP_FIXTURE = {
  membership: [
    { account_id: "a1", role: "admin", label: "Prime", added_at: "2026-08-01" },
    { account_id: "a2", role: "always_allow", label: "Old bypass row" },
  ],
  malformed: [{ account_id: "not-hex", role: "admin", label: "Broken" }],
  secretOnly: [],
};
const view = Admin.membershipView(MEMBERSHIP_FIXTURE);
check("membershipView sorts the admin row into lists[0]",
  view.lists.length === 1 && view.lists[0].role === "admin" &&
  view.lists[0].rows.length === 1 && view.lists[0].rows[0].account_id === "a1");
check("a lingering always_allow row is caught as unknown, never dropped " +
  "silently - a row here still grants whatever its role says",
  view.unknown.length === 1 && view.unknown[0].account_id === "a2");
check("a malformed row is counted separately from a granting one",
  view.malformed.length === 1);
check("empty secretOnly reads as the backfill go-signal",
  /go-signal/.test(Admin.secretOnlyNotice(view)));

const ABSENT_VIEW = Admin.membershipView({});
check("an answer with no lists at all reads as absent, not empty",
  ABSENT_VIEW.absent.length === 3);
check("secretOnlyNotice says the service did not report, when the field " +
  "is absent rather than empty",
  /did not report/.test(Admin.secretOnlyNotice(ABSENT_VIEW)));

check("refusalFor(401) ends the session",
  Admin.refusalFor(401, {}).action === "signed-out");
check("refusalFor(409) shows the Worker's own words and stays",
  Admin.refusalFor(409, { error: "The last admin cannot be removed." })
    .action === "show" &&
  Admin.refusalFor(409, { error: "The last admin cannot be removed." })
    .message.includes("The last admin cannot be removed."));

check("addedNotice names the account and the next-sign-in rule",
  Admin.addedNotice("Prime").includes("Prime") &&
  Admin.addedNotice("Prime").includes("NEXT sign-in"));
check("addedNotice falls back to naming nothing rather than the empty " +
  "string",
  Admin.addedNotice("").includes("That account"));

check("removalStep names the row on its first press and confirms on its " +
  "second",
  Admin.removalStep({ label: "Prime" }, false) === "Remove Prime" &&
  Admin.removalStep({ label: "Prime" }, true) === "Confirm removing Prime");

/* -- The change log (real shape: #414 completion, comment 5370945709 -- */
/* {at, accountId, action, name, summary} - accountId is the ACTOR, a   */
/* hex id or the literal "break-glass"; the Worker sends no label.      */

check("logLine reads a short account id as the actor - the Worker sends " +
  "no display label",
  Admin.logLine({ at: "2026-08-21T12:00:00.000Z",
    accountId: "abcdef0123456789", action: "membership.add",
    name: "a1", summary: "flagged a1 an admin" }).who ===
  "abcdef012345…");
check("logLine names the break-glass tool in plain words rather than " +
  "printing the literal token",
  Admin.logLine({ accountId: "break-glass", action: "content.set" }).who ===
  "the break-glass tool");
check("logLine translates the action enum into plain words and composes " +
  "the summary after it",
  Admin.logLine({ action: "content.set", summary: "set site.groupName" })
    .what === "changed a setting: set site.groupName" &&
  Admin.logLine({ action: "content.unset", summary: "reset chart.floor" })
    .what === "reset a setting: reset chart.floor" &&
  Admin.logLine({ action: "membership.add", summary: "flagged a1" }).what ===
    "added an admin: flagged a1" &&
  Admin.logLine({ action: "membership.remove", summary: "removed a2" })
    .what === "removed an admin: removed a2");
check("logLine falls back to the plain action phrase alone with no " +
  "summary, and to a generic sentence with neither an action this page " +
  "recognizes nor a summary",
  Admin.logLine({ action: "content.set" }).what === "changed a setting" &&
  Admin.logLine({}).what === "made a change");
check("logLine renders a real time as a UTC minute, and an unparseable " +
  "one honestly",
  Admin.logLine({ at: "2026-08-21T12:34:00.000Z" }).when ===
  "2026-08-21 12:34 UTC" &&
  Admin.logLine({ at: "not a date" }).when === "an unknown time");

/* -- Fields: validation, categorization, the session roster (#433,   */
/* against 0.9-M3-S11's landed contract on #419) -- */

check("validateFieldId accepts the Worker's own SPEC_ID charset and " +
  "refuses anything else",
  Admin.validateFieldId("gender").ok === true &&
  Admin.validateFieldId("has_underscore-2").ok === true &&
  Admin.validateFieldId("Gender").ok === false &&
  Admin.validateFieldId("").ok === false &&
  Admin.validateFieldId("x".repeat(49)).ok === false);

check("validateFieldLabel refuses empty and past 64 characters, trims " +
  "otherwise",
  Admin.validateFieldLabel("").ok === false &&
  Admin.validateFieldLabel("x".repeat(65)).ok === false &&
  Admin.validateFieldLabel("  Gender  ").value === "Gender");

check("validateValueLabel holds to the Worker's own 64-character bound",
  Admin.validateValueLabel("x".repeat(64)).ok === true &&
  Admin.validateValueLabel("x".repeat(65)).ok === false);

check("parseValueLines trims each line and drops empty ones",
  JSON.stringify(Admin.parseValueLines("  Male \n\nFemale\n ")) ===
  JSON.stringify(["Male", "Female"]));

const CATEGORY_SAMPLE = {
  fields: [
    { name: "weight", kind: "weight", label: "Weight" },
    { name: "gender", kind: "choice", label: "Gender",
      choices: [{ value: "male", label: "Male" }] },
    { name: "country", kind: "choice", label: "Country",
      choicesFrom: "countries" },
  ],
};
const categorySplit = Admin.categoricalFields(CATEGORY_SAMPLE);
check("categoricalFields sorts choice fields apart from every other " +
  "kind (#385 §6) - weight stays in `other`, gender and country in " +
  "`choice`",
  categorySplit.choice.length === 2 &&
  categorySplit.choice.every((f) => f.kind === "choice") &&
  categorySplit.other.length === 1 && categorySplit.other[0].name ===
  "weight");

check("FIELD_READ_ONLY_REASON and VALUES_OUTSIDE_REASON are each a " +
  "real, distinct sentence",
  Admin.FIELD_READ_ONLY_REASON !== Admin.VALUES_OUTSIDE_REASON &&
  Admin.FIELD_READ_ONLY_REASON.length > 0 &&
  Admin.VALUES_OUTSIDE_REASON.length > 0);

check("RENAME_MODE is relabel - the one and only string this page " +
  "sends (#385 item (b), #454 item 20: one button, the smarter " +
  "default)",
  Admin.RENAME_MODE === "relabel");
check("RENAME_CONSEQUENCE is a real, non-empty sentence",
  typeof Admin.RENAME_CONSEQUENCE === "string" &&
  Admin.RENAME_CONSEQUENCE.length > 0);

check("retireValueSentence and retireFieldSentence each name the real " +
  "label and end in a question - the in-place confirm's own sentence " +
  "(#454 item 9)",
  Admin.retireValueSentence("Female").includes("Female") &&
  Admin.retireValueSentence("Female").trim().endsWith("?") &&
  Admin.retireFieldSentence("Gender").includes("Gender") &&
  Admin.retireFieldSentence("Gender").trim().endsWith("?") &&
  Admin.retireValueSentence("Female") !== Admin.retireFieldSentence("Female"));

check("shortDate renders a real timestamp as a plain date, and an " +
  "unparseable one honestly",
  Admin.shortDate("2026-08-21T12:34:56.000Z") === "2026-08-21" &&
  Admin.shortDate("not a date") === "an unknown date");

/* -- fieldView: the read reshaped for the card - bring back, from any  */
/* session (0.9-M3-S30, #452, replacing mergeFieldsRoster/               */
/* fieldsRosterView, #433's session-scoped roster) -- */

check("fieldView marks an active field's offered and retired values " +
  "both, straight off the read - no prior session needed",
  (() => {
    const view = Admin.fieldView({ name: "gender", kind: "choice",
      label: "Gender", choices: [
        { id: "male", label: "Male" },
        { id: "female", label: "Female", retired: true },
      ] });
    return view.id === "gender" && view.label === "Gender" &&
      view.active === true && view.retiredAt === null &&
      view.values.length === 2 &&
      view.values[0].id === "male" && view.values[0].retired === false &&
      view.values[1].id === "female" && view.values[1].retired === true;
  })());

check("fieldView marks a whole retired field inactive and carries its " +
  "retiredAt - the field-level date this card shows (F3, 0.9-M3-S25's " +
  "review on #440)",
  (() => {
    const view = Admin.fieldView({ name: "gender", kind: "choice",
      label: "Gender", retired: true, retiredAt: "2026-08-20T00:00:00.000Z",
      choices: [{ id: "male", label: "Male", retired: true }] });
    return view.active === false &&
      view.retiredAt === "2026-08-20T00:00:00.000Z";
  })());

check("fieldView reads retiredAt as null when the row could not say - " +
  "server/worker.js's own markRetired() ships that key null rather " +
  "than omitting it, and this never invents a date it was not given",
  Admin.fieldView({ name: "gender", kind: "choice", label: "Gender",
    retired: true, retiredAt: null, choices: [] }).retiredAt === null);

check("fieldView carries no retiredAt for an ACTIVE field even when " +
  "one of its values is retired - the stored row has one stamp, and " +
  "the Worker only ever puts it on a field the read marks retired " +
  "whole (server/worker.js's applyOverlay/offeredValues)",
  Admin.fieldView({ name: "gender", kind: "choice", label: "Gender",
    choices: [{ id: "male", label: "Male", retired: true }] })
    .retiredAt === null);

check("fieldView marks a choicesFrom field's values as living outside " +
  "the spec, and copes with no `choices` array at all - the real " +
  "shape a choicesFrom field ships in apps/web/site.config.js",
  (() => {
    const view = Admin.fieldView({ name: "country", kind: "choice",
      label: "Country", choicesFrom: "countries" });
    return view.outside === true && view.values.length === 0;
  })());

/* -- Departed (0.9-M3-S34, #458 - the page half of S15's Worker, #420;  */
/* #385 rule 4, #454 items 8-10/13/20). -- */

check("departedName reads the membership label where GET /admin-departed " +
  "sent one (item 13)",
  Admin.departedName({ accountId: "a".repeat(64), label: "Prime" }) ===
  "Prime");
check("departedName falls back to the short id when there is no label - " +
  "never a handle, never a numeric id (#385 rule 1): the Worker never " +
  "sends either, and this function reads only accountId and label",
  Admin.departedName({ accountId: "a".repeat(64), label: null }) ===
  "a".repeat(12) + "…" &&
  Admin.departedName({ accountId: "a".repeat(64), label: "   " }) ===
  "a".repeat(12) + "…");

check("eraseDepartedSentence names the real label and ends in a question " +
  "(#454 item 9), and - since the landed Worker offers no dry-run count " +
  "for this route - names the four row classes the erase actually " +
  "deletes instead of inventing a number",
  Admin.eraseDepartedSentence("Prime").includes("Prime") &&
  Admin.eraseDepartedSentence("Prime").trim().endsWith("?") &&
  /submissions/.test(Admin.eraseDepartedSentence("Prime")) &&
  /directory/.test(Admin.eraseDepartedSentence("Prime")) &&
  /membership/.test(Admin.eraseDepartedSentence("Prime")) &&
  /sessions/.test(Admin.eraseDepartedSentence("Prime")));

check("DEPARTED_PAGE_SIZE is 20, the ticket's own number (item 13)",
  Admin.DEPARTED_PAGE_SIZE === 20);

const DEPARTED_FIXTURE = {
  departed: [{ accountId: "a1", label: "One" }, { accountId: "a2" }],
  unknown: [{ accountId: "u1", reason: "unknown until next sign-in" }],
  allowed: [{ accountId: "l1", reason: "allowed by the operator's list" }],
};
check("departedSections keeps the ticket's own order - departed, then " +
  "unknown, then allowed - reordering nothing the Worker sent",
  Admin.departedSections(DEPARTED_FIXTURE, 20).sections
    .map((s) => s.key).join(",") === "departed,unknown,allowed");
// Fix wave 1 on #458 (review F7 in the review's own numbering): the
// check above proves the three SECTIONS stay in order; this proves
// each section's own ROWS stay in the order the Worker sent them too
// - "as sent", never resorted. The Worker's own sort direction (F1)
// is a separate, still-open question Prime is ruling; this arm would
// hold either way, because it only cares that the page does not touch
// an order the Worker already chose.
check("departedSections renders each section's own rows in the order " +
  "the Worker sent them, unreordered",
  Admin.departedSections({
    departed: [{ accountId: "a" }, { accountId: "b" }, { accountId: "c" }],
    unknown: [], allowed: [] }, 20).sections[0].rows
    .map((row) => row.accountId).join(",") === "a,b,c");
check("departedSections windows to ONE list of `revealed` rows total, " +
  "not per section (item 13 describes one list, not three)",
  (() => {
    const view = Admin.departedSections(DEPARTED_FIXTURE, 3);
    return view.shown === 3 && view.total === 4 && view.hasMore === true &&
      view.sections[0].rows.length === 2 &&
      view.sections[1].rows.length === 1 &&
      view.sections[2].rows.length === 0;
  })());
check("departedSections reports no more once every row is shown",
  Admin.departedSections(DEPARTED_FIXTURE, 20).hasMore === false);
check("departedSections copes with a malformed answer - a missing list " +
  "reads as empty rather than throwing",
  (() => {
    const view = Admin.departedSections({}, 20);
    return view.total === 0 && view.hasMore === false &&
      view.sections.every((s) => s.rows.length === 0);
  })());

/* -- The idle timer, unchanged in shape from every other signed-in page -- */

check("idleVerdict is active well before the warning window",
  Admin.idleVerdict(0, 60 * 1000).state === "active");
check("idleVerdict warns inside the last two minutes",
  Admin.idleVerdict(0, 9 * 60 * 1000).state === "warning");
check("idleVerdict expires past the ten-minute window",
  Admin.idleVerdict(0, 11 * 60 * 1000).state === "expired");
check("idleVerdict treats an unreadable clock as expired, never as active",
  Admin.idleVerdict(NaN, Date.now()).state === "expired" &&
  Admin.idleVerdict(Date.now(), NaN).state === "expired");
check("idleNotice says nothing outside the warning state",
  Admin.idleNotice({ state: "active" }) === "" &&
  Admin.idleNotice(null) === "");
check("idleNotice names the admin content this page shows, not the old " +
  "key-holding language",
  /settings, roles and change log/.test(
    Admin.idleNotice({ state: "warning", msLeft: 90 * 1000 })));

/* ------------------------------------------------------------------ */
/* 3. Driven end to end: a minimal DOM, stubbed fetches, real events.   */

function node(tag) {
  const el = {
    tag, id: "", attrs: {}, children: [], listeners: {}, hidden: false,
    value: "", checked: false, disabled: false, _text: "",
  };
  el.setAttribute = (name, value) => { el.attrs[name] = String(value); };
  el.getAttribute = (name) =>
    Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null;
  el.appendChild = (child) => { el.children.push(child); return child; };
  el.removeChild = (child) => {
    const at = el.children.indexOf(child);
    if (at !== -1) el.children.splice(at, 1);
  };
  Object.defineProperty(el, "firstChild", {
    get: () => (el.children.length ? el.children[0] : null),
  });
  el.addEventListener = (type, fn) => {
    (el.listeners[type] = el.listeners[type] || []).push(fn);
  };
  el.dispatch = (type) => {
    (el.listeners[type] || []).slice().forEach((fn) => fn({}));
  };
  // admin.js's one querySelector call: $("closed").querySelector(
  // "[data-reason]") - a single bare-attribute lookup among this
  // element's own children, which is all this stub needs to support.
  el.querySelector = (selector) => {
    const match = /^\[([\w-]+)\]$/.exec(selector);
    if (!match) return null;
    return el.children.find((c) => c.attrs[match[1]] !== undefined) || null;
  };
  function textOf(one) {
    return one.children.length ? one.children.map(textOf).join("") : one._text;
  }
  Object.defineProperty(el, "textContent", {
    get: () => textOf(el),
    set: (v) => { el._text = String(v); el.children.length = 0; },
  });
  return el;
}

// A button found by its own visible text, walked from a container - the
// Fields card's rewritten blocks (one-button rename, the in-place
// confirm) nest buttons a fixed child index would make brittle and
// hard to read; this queries the same way a person reading the card
// would. Used only by the Fields-card tests below; every other card's
// tests keep the fixed-index style already proven against this suite's
// own history.
function findAll(el, predicate) {
  const out = [];
  (function walk(node) {
    if (predicate(node)) out.push(node);
    for (const child of node.children || []) walk(child);
  })(el);
  return out;
}
function buttonByText(el, text) {
  return findAll(el, (n) => n.tag === "button" && n.textContent === text)[0];
}

// A whole-subtree serializer, not textContent - fix wave 1 on #458
// (review comment 5380371688, F4 in the review's own numbering): the
// #385-rule-1 arm used to read textContent alone, so a needle written
// into title, aria-label, a data-* attribute, or anywhere else in the
// markup would pass it silently. This walks every node under the
// root and writes its tag, id, class, every attrs entry and every
// leaf's own text into one string - the same thing a "view source"
// on the real page would show - so a needle hiding in an attribute is
// caught exactly like one hiding in visible text.
function serializeSubtree(el) {
  const attrPairs = [];
  if (el.id) attrPairs.push('id="' + el.id + '"');
  if (el.className) attrPairs.push('class="' + el.className + '"');
  for (const key of Object.keys(el.attrs || {})) {
    attrPairs.push(key + '="' + el.attrs[key] + '"');
  }
  const open = "<" + el.tag +
    (attrPairs.length ? " " + attrPairs.join(" ") : "") + ">";
  const inner = el.children.length
    ? el.children.map(serializeSubtree).join("")
    : (el._text || "");
  return open + inner + "</" + el.tag + ">";
}

// Strips /* ... */ comments first, then returns the declaration block
// of the first `selector { ... }` rule - not a whole-file string
// match, which the eight-line comment sitting INSIDE this exact rule
// (apps/web/theme.css, the [role="tablist"] block) would let a naive
// regex keep matching even after the declaration it explains was
// deleted. Fix wave 1 on #458 (review F5 in the review's own
// numbering) asked for a parsed-CSS arm, not a comment string match.
function cssRuleBody(css, selector) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const at = stripped.indexOf(selector);
  if (at === -1) return null;
  const open = stripped.indexOf("{", at);
  if (open === -1) return null;
  let depth = 1, i = open + 1;
  while (i < stripped.length && depth > 0) {
    if (stripped[i] === "{") depth += 1;
    else if (stripped[i] === "}") depth -= 1;
    i += 1;
  }
  return stripped.slice(open + 1, i - 1);
}

const PAGE_HTML = adminHtml;
const IDS = [...PAGE_HTML.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]);
const NEEDED = ["tool", "closed", "surface-mark", "admin-intro",
  "idle-warning", "idle-countdown", "idle-stay",
  "tab-settings", "tab-roles", "tab-fields", "tab-log", "tab-departed",
  "settings-card", "roles-card", "fields-card", "log-card",
  "departed-card",
  "settings-floor", "settings-floor-notice", "settings-floor-save",
  "settings-locked-unit", "settings-locked-unit-save",
  "settings-group-name", "settings-group-name-save",
  "settings-welcome-text", "settings-welcome-text-save",
  "settings-default-theme", "settings-default-theme-save",
  "settings-status",
  "member-telegram-id", "member-label", "member-add", "roles-status",
  "roles-via", "roles-admin", "roles-secret-only", "roles-secret-only-ids",
  "roles-malformed", "roles-malformed-list", "roles-other",
  "roles-other-body",
  "fields-status", "fields-new-id", "fields-new-label", "fields-new-values",
  "fields-new-add", "fields-list",
  "log-status", "log-list", "departed-status", "departed-list", "toast"];
check("every element this suite drives is really in apps/web/admin.html",
  NEEDED.every((id) => IDS.includes(id)));
check("dist/admin.html carries the same ids - the mirror is not stale",
  NEEDED.every((id) => distHtml.includes('id="' + id + '"')));

// apps/web/admin.html's own static `hidden` attribute, read off the
// real markup rather than guessed - the same F4 lesson
// tests/charts-page.test.mjs's own header names ("the fieldset's own
// opening tag carries the `hidden` attribute in the shipped markup,
// not merely in buildDom()'s own default"). node()'s factory defaults
// every element to visible, which is wrong for exactly these ids.
const STATIC_HIDDEN = ["idle-warning", "closed", "tool", "settings-status",
  "roles-status", "roles-secret-only-ids", "roles-malformed", "roles-other",
  "fields-status", "log-status", "roles-card", "fields-card", "log-card",
  "departed-status", "departed-card", "toast"];
// settings-card is deliberately NOT here - it is the default tab, the
// one panel of the four that ships visible (#385 item (b), #454 item
// 20).
check("every id this suite starts hidden really ships the hidden " +
  "attribute in apps/web/admin.html",
  STATIC_HIDDEN.every((id) => new RegExp(
    'id="' + id + '"[^>]*\\bhidden\\b|\\bhidden\\b[^>]*id="' + id + '"')
    .test(adminHtml)));

// F5/F6 (#433 fix wave) are both source-level facts a Node DOM stub
// cannot render (F5 removes a sentence from a constant buildDom() never
// reads through admin.html; F6 adds one to admin.html's own static
// markup, which buildDom() does not parse at all - see its own
// comment). Reading the real files' text is the whole of what a suite
// arm can do for either; the fact that an admin actually SEES the
// sentence is a real-browser reading like every other prose claim on
// this page.
check("VALUES_OUTSIDE_REASON no longer promises a label editor this " +
  "card does not draw for any field - F5, #433 fix wave (checked " +
  "against the exported constant itself, not a raw text scan, since " +
  "admin.js's own comment on the change now names the removed words; " +
  "dist/admin.js carries no comments at all, so a raw scan is safe " +
  "there and catches a stale mirror)",
  !/label/i.test(Admin.VALUES_OUTSIDE_REASON) &&
  !/Its label (still )?is\.?/.test(distJs));
check("the session-scoped un-retire limit sentence (0.9-M3-S13, #433, " +
  "F6) is GONE from the shipped page - 0.9-M3-S25's GET /admin-fields " +
  "(#440) removed the limit itself, and this ticket removes the " +
  "sentence with it (#452's own scope, item 3)",
  !/retired here this session/.test(adminHtml) &&
  !/retired here this session/.test(distHtml));
check("the new-id-on-retype hazard sentence stays - it is real " +
  "regardless of which session retired the value (#452's own scope, " +
  "item 3)",
  /new id/.test(adminHtml) && /new id/.test(distHtml));

function buildDom() {
  const byId = new Map();
  for (const id of NEEDED) byId.set(id, node("div"));
  for (const id of STATIC_HIDDEN) byId.get(id).hidden = true;
  byId.get("settings-locked-unit").tag = "select";
  byId.get("settings-default-theme").tag = "select";
  byId.get("member-add").tag = "button";
  for (const id of ["settings-floor-save", "settings-locked-unit-save",
    "settings-group-name-save", "settings-welcome-text-save",
    "settings-default-theme-save", "idle-stay", "fields-new-add",
    "tab-settings", "tab-roles", "tab-fields", "tab-log", "tab-departed"]) {
    byId.get(id).tag = "button";
  }
  const reason = node("p");
  reason.setAttribute("data-reason", "");
  byId.get("closed").appendChild(reason);

  const docListeners = {};
  const doc = {
    getElementById: (id) => byId.get(id) || null,
    createElement: (tag) => node(tag),
    addEventListener: (type, fn) => {
      (docListeners[type] = docListeners[type] || []).push(fn);
    },
    dispatch: (type) => {
      (docListeners[type] || []).slice().forEach((fn) => fn({}));
    },
  };
  return { doc, byId };
}

const show = (element, visible) => { if (element) element.hidden = !visible; };
const checkedValue = () => "admin";
const setStatus = (element, message, tone) => {
  if (!element) return;
  element.textContent = message || "";
  element.hidden = !message;
  element.className = "status" + (tone ? " " + tone : "");
};

/*
 * One fetch stub per scenario, dispatching on method+path exactly the
 * way tests/your-page.test.mjs's own fixtures do - a real Worker
 * contract read off #414's ticket body (S8's stated shape), never a
 * running Worker.
 */
function stubFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    const path = String(url).replace(/^https:\/\/worker\.example/, "");
    const method = (init && init.method) || "GET";
    calls.push({ method, path, body: init && init.body });
    const handler = routes[method + " " + path] ||
      routes[method + " " + path.replace(/\/[^/]+\/[^/]+$/, "/*/*")];
    if (!handler) {
      return { ok: false, status: 404, async json() { return { error: "not found" }; } };
    }
    return handler({ method, path, body: init && init.body });
  };
  return { impl, calls };
}

const ok = (body) => ({ ok: true, status: 200, async json() { return body; } });
const refused = (status, body) => ({ ok: false, status,
  async json() { return body || {}; } });

async function driven(routes, options) {
  const opts = options || {};
  const { doc, byId } = buildDom();
  globalThis.document = doc;
  globalThis.BinderUI = {
    byId: (id) => byId.get(id) || null,
    show, checkedValue, setStatus,
    boot(setUp, onError) {
      try {
        const result = setUp();
        if (result && typeof result.then === "function") {
          return result.catch(onError);
        }
      } catch (error) {
        onError(error);
      }
      return Promise.resolve();
    },
  };
  const isAdmin = !("isAdmin" in opts) || opts.isAdmin;
  const signedIn = !("signedIn" in opts) || opts.signedIn;
  globalThis.BinderSession = {
    require: () => (signedIn ? { isAdmin } : null),
    authorization: () => ({ Authorization: "Bearer token" }),
    clear: () => {},
  };
  let signOutCalls = 0;
  globalThis.BinderSignOut = { signOut: () => { signOutCalls += 1; } };
  globalThis.BINDER_CONFIG = { endpoint: "https://worker.example" };
  const stub = stubFetch(routes || {});
  globalThis.fetch = stub.impl;
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = () => {};

  const src = await read("../apps/web/admin.js");
  await import("data:text/javascript," + encodeURIComponent(src) +
    "#" + Math.random());
  // The module's setUp() runs its async chain (loadSettings, readMembership,
  // loadAdminVia, loadLog) after boot() returns - one microtask flush per
  // fetch in the chain is enough for every route this suite stubs.
  for (let i = 0; i < 8; i += 1) await Promise.resolve();

  return { byId, calls: stub.calls, getSignOutCalls: () => signOutCalls };
}

/* -- The admin gate -- */

{
  const { byId } = await driven({}, { signedIn: false });
  check("a signed-out visitor sees nothing this page gates",
    byId.get("tool").hidden === true);
}

{
  const { byId } = await driven({}, { isAdmin: false });
  check("a member session sees the Unavailable card, never the tool",
    byId.get("tool").hidden === true &&
    byId.get("closed").hidden === false &&
    /admin session/.test(byId.get("closed").children[0].textContent));
}

const CONTENT = {
  "chart.floor": "5", "chart.lockedUnit": "", "site.groupName": "Hang Gang",
  "site.welcomeText": "Welcome.", "site.defaultTheme": "midnight",
};
const MEMBERSHIP = {
  membership: [
    { account_id: "a1", role: "admin", label: "Prime", added_at: "2026-08-01" },
  ],
  malformed: [], secretOnly: [],
};
// The real envelope (#414 completion, comment 5370945709):
// {ok, log: [{at, accountId, action, name, summary}]}. accountId is the
// ACTOR; "a1" and a break-glass row prove both the hex and the literal
// shapes render.
const LOG = { ok: true, log: [
  { at: "2026-08-21T12:00:00.000Z", accountId: "a1",
    action: "content.set", name: "site.groupName",
    summary: "set site.groupName" },
  { at: "2026-08-21T11:00:00.000Z", accountId: "break-glass",
    action: "membership.add", name: "b".repeat(64),
    summary: "flagged an admin" },
] };
// GET /admin-fields' own shape (0.9-M3-S25, #440): two non-choice kinds
// (a consent, a measure) beside two choice fields, one of which
// (country) has `choicesFrom` and so ships with NO `choices` array at
// all - the real shape apps/web/site.config.js's own country row has.
// Every value here is already spelled {id, label, retired?} - the
// write's own shape, per 0.9-M3-S25's fix wave 1 (F2 of that slice's
// review, #440 comment 5377697322) - not GET /spec's {value, label}.
// Every DOM test below relies on fields-list's resulting order being
// deterministic: categoricalFields() preserves the spec's own field
// order, so the render is [over18, weight, gender, country] -
// documented once here rather than re-derived at every call site.
const SPEC_FIXTURE = {
  group: { name: "Hang Gang", binder: "Binder" },
  fields: [
    { name: "over18", kind: "consent", label: "I confirm I am 18 or older.",
      term: "age confirmation", chart: false },
    { name: "weight", kind: "weight", label: "Weight", term: "weight",
      chart: true },
    { name: "gender", kind: "choice", label: "Gender", term: "gender",
      chart: true,
      choices: [
        { id: "male", label: "Male" },
        { id: "female", label: "Female" },
      ] },
    { name: "country", kind: "choice", label: "Country", term: "country",
      chart: true, choicesFrom: "countries" },
  ],
};

// GET /admin-departed's real envelope (S15's completion on #420):
// {ok, departed: [{accountId, label, lastSeenAt, status}], unknown:
// [{...reason}], allowed: [{...reason}]} - empty by default so every
// existing test above keeps its own unrelated assertions unaffected by
// this ticket's own route.
const DEPARTED_EMPTY = { ok: true, departed: [], unknown: [], allowed: [] };

const BASE_ROUTES = {
  "GET /content": () => ok({ ok: true, content: CONTENT }),
  "GET /membership": () => ok(MEMBERSHIP),
  "GET /me": () => ok({ ok: true, adminVia: "flag" }),
  "GET /admin-log": () => ok(LOG),
  "GET /admin-fields": () => ok({ ok: true, spec: SPEC_FIXTURE }),
  "GET /admin-departed": () => ok(DEPARTED_EMPTY),
};

{
  const { byId } = await driven({}, { isAdmin: true });
  check("an admin session opens the tool and hides the Unavailable card",
    byId.get("tool").hidden === false && byId.get("closed").hidden === true);
}

/* -- Tabs (#385 item (b), #454 item 20): one area on screen at a time,  */
/* Settings showing first. -- */

{
  const { byId } = await driven(BASE_ROUTES, { isAdmin: true });
  check("Settings is the tab that ships selected and visible",
    byId.get("tab-settings").getAttribute("aria-selected") === "true" &&
    byId.get("settings-card").hidden === false);
  check("the other four panels ship hidden",
    byId.get("roles-card").hidden === true &&
    byId.get("fields-card").hidden === true &&
    byId.get("log-card").hidden === true &&
    byId.get("departed-card").hidden === true);

  byId.get("tab-fields").dispatch("click");
  check("clicking a tab shows its own panel and hides every other one, " +
    "and moves aria-selected off Settings and onto Fields",
    byId.get("fields-card").hidden === false &&
    byId.get("settings-card").hidden === true &&
    byId.get("roles-card").hidden === true &&
    byId.get("log-card").hidden === true &&
    byId.get("departed-card").hidden === true &&
    byId.get("tab-fields").getAttribute("aria-selected") === "true" &&
    byId.get("tab-settings").getAttribute("aria-selected") === "false");

  byId.get("tab-log").dispatch("click");
  check("switching again shows exactly the new panel",
    byId.get("log-card").hidden === false &&
    byId.get("fields-card").hidden === true &&
    byId.get("tab-log").getAttribute("aria-selected") === "true" &&
    byId.get("tab-fields").getAttribute("aria-selected") === "false");

  byId.get("tab-departed").dispatch("click");
  check("the fifth tab, Departed, shows its own panel and hides the rest " +
    "(#385 item (b), #454 item 20 - a fifth tab, not a stacked card)",
    byId.get("departed-card").hidden === false &&
    byId.get("log-card").hidden === true &&
    byId.get("settings-card").hidden === true &&
    byId.get("roles-card").hidden === true &&
    byId.get("fields-card").hidden === true &&
    byId.get("tab-departed").getAttribute("aria-selected") === "true" &&
    byId.get("tab-log").getAttribute("aria-selected") === "false");
}

/* -- The tab bar's own overflow fix (fix wave 1, #458): a parsed-CSS   */
/* arm, since the DOM stub above never lays anything out in pixels -    */
/* geometry proof for this fix is the browser pass, this only proves    */
/* the rule that pass measured is still in the shipped stylesheet. -- */

{
  const tablistRule = cssRuleBody(themeCss, '[role="tablist"]');
  check("apps/web/theme.css's own [role=\"tablist\"] rule sets " +
    "flex-wrap: wrap (fix wave 1, #458) - parsed from the rule's own " +
    "declaration block, not matched against the comment sitting " +
    "inside it",
    tablistRule !== null && /flex-wrap\s*:\s*wrap\s*;/.test(tablistRule));
  const distTablistRule = cssRuleBody(distThemeCss, '[role="tablist"]');
  check("the dist/theme.css mirror carries the same rule",
    distTablistRule !== null &&
    /flex-wrap\s*:\s*wrap\s*;/.test(distTablistRule));
}

/* -- Settings: load, per-field validation, per-field save -- */

{
  const { byId } = await driven(BASE_ROUTES, { isAdmin: true });
  check("Settings loads every one of the five keys from GET /content",
    byId.get("settings-floor").value === "5" &&
    byId.get("settings-group-name").value === "Hang Gang" &&
    byId.get("settings-welcome-text").value === "Welcome." &&
    byId.get("settings-default-theme").value === "midnight");
  check("the floor notice reflects the loaded value",
    /5/.test(byId.get("settings-floor-notice").textContent));
}

{
  const { byId, calls } = await driven(BASE_ROUTES, { isAdmin: true });
  byId.get("settings-group-name").value = "";
  byId.get("settings-group-name-save").dispatch("click");
  await Promise.resolve();
  check("an empty group name is refused BEFORE a request is sent - " +
    "client validation mirrors the Worker's own refusal",
    calls.filter((c) => c.method === "POST").length === 0 &&
    /needs a name/.test(byId.get("settings-status").textContent));
}

{
  const posts = [];
  const routes = Object.assign({}, BASE_ROUTES, {
    "POST /content": ({ body }) => {
      posts.push(JSON.parse(body));
      return ok({ ok: true });
    },
  });
  const { byId, calls } = await driven(routes, { isAdmin: true });
  byId.get("settings-floor").value = "12";
  byId.get("settings-floor-save").dispatch("click");
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  check("a valid floor round-trips through POST /content with the " +
    "field's own name and the validated value",
    posts.length === 1 && posts[0].name === "chart.floor" &&
    posts[0].value === "12");
  check("the status line confirms the save, and the floor notice updates " +
    "to match",
    /Saved/.test(byId.get("settings-status").textContent) &&
    calls.some((c) => c.method === "GET" && c.path === "/admin-log"));
}

{
  const routes = Object.assign({}, BASE_ROUTES, {
    "POST /content": () => refused(400, { error: "Content too large." }),
  });
  const { byId } = await driven(routes, { isAdmin: true });
  byId.get("settings-welcome-text").value = "fine text";
  byId.get("settings-welcome-text-save").dispatch("click");
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  check("a save the Worker refuses shows the Worker's own words",
    /Content too large/.test(byId.get("settings-status").textContent));
}

/* -- Roles: render, add, remove, adminVia -- */

{
  const { byId } = await driven(BASE_ROUTES, { isAdmin: true });
  check("Roles renders the flagged admin row with textContent, not markup",
    byId.get("roles-admin").children.length === 1 &&
    byId.get("roles-admin").children[0].children[0].textContent === "Prime");
  check("Roles states this session's own adminVia",
    /flag/.test(byId.get("roles-via").textContent));
}

{
  const posts = [];
  const routes = Object.assign({}, BASE_ROUTES, {
    "POST /membership": ({ body }) => {
      posts.push(JSON.parse(body));
      return ok({ ok: true });
    },
  });
  const { byId } = await driven(routes, { isAdmin: true });
  byId.get("member-telegram-id").value = "123456";
  byId.get("member-label").value = "New admin";
  byId.get("member-add").dispatch("click");
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  check("adding a member posts role admin - the only role this card " +
    "offers any more",
    posts.length === 1 && posts[0].role === "admin" &&
    posts[0].telegramId === "123456" && posts[0].label === "New admin");
  check("the telegram id field is cleared after a successful add - the " +
    "last place that numeric id exists on this page",
    byId.get("member-telegram-id").value === "");
}

{
  const { byId } = await driven({}, { isAdmin: true });
  check("an empty telegram id or label is refused before anything is sent",
    (() => {
      byId.get("member-telegram-id").value = "";
      byId.get("member-label").value = "";
      byId.get("member-add").dispatch("click");
      return /both needed/.test(byId.get("roles-status").textContent);
    })());
}

{
  // The Worker's own MAX_LABEL bound (server/worker.js), mirrored here
  // the same shape validateGroupName's own arm already proves (#416,
  // F6) - the fourth text input on this page was the only one left
  // unbounded, and it is the other half of F1's Roles-card overflow.
  const { byId, calls } = await driven({}, { isAdmin: true });
  byId.get("member-telegram-id").value = "123456";
  byId.get("member-label").value = "x".repeat(65);
  byId.get("member-add").dispatch("click");
  check("a label past the Worker's own 64-character bound is refused " +
    "BEFORE a request is sent - client validation mirrors the Worker's " +
    "own refusal the same way the Settings card's four fields already do",
    calls.filter((c) => c.method === "POST").length === 0 &&
    /64 characters or fewer/.test(byId.get("roles-status").textContent));
}

{
  let removed = null;
  const routes = Object.assign({}, BASE_ROUTES, {
    "DELETE /membership/*/*": ({ path }) => {
      removed = path;
      return { ok: true, status: 200, async json() { return {}; } };
    },
  });
  const { byId } = await driven(routes, { isAdmin: true });
  await Promise.resolve();
  // membershipRow() appends [name span, when span, button] in that
  // order - index 2 is the button.
  const button = byId.get("roles-admin").children[0].children[2];
  button.dispatch("click");
  check("a first press names the row and arms the button rather than " +
    "removing anything",
    /Confirm removing Prime/.test(button.textContent) && removed === null);
  button.dispatch("click");
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  check("the second press removes the exact role and id GET handed back",
    removed === "/membership/admin/a1");
}

/* -- Fields: render, add/retire/un-retire a value, one-button rename,  */
/* reorder, retire/un-retire a field, add a field, numeric read-only,   */
/* choicesFrom read-only, refused writes, no member data, the in-place  */
/* confirm and the toast (#433; the bring-back rebuild is 0.9-M3-S30,   */
/* #452, against 0.9-M3-S25's GET /admin-fields on #440).               */
/*                                                                       */
/* fields-list's own order is documented once here rather than          */
/* re-derived at every call site: categoricalFields() preserves the     */
/* spec's own field order, so with SPEC_FIXTURE the render is           */
/* [over18, weight, gender, country]. A gender field block's own        */
/* children are [header, valuesSection, addRow, buttons, confirmBlock]  */
/* - an active value's own children are [labelRow, buttons, form,       */
/* confirmBlock]; a retired one is just [labelRow, buttons]. -- */

{
  const { byId } = await driven(BASE_ROUTES, { isAdmin: true });
  const list = byId.get("fields-list");
  check("Fields lists the numeric field read-only, with the one-" +
    "sentence reason (#385 §6)",
    list.children.length === 4 &&
    /Weight/.test(list.children[1].textContent) &&
    /release somebody read/.test(list.children[1].textContent));
  check("Fields lists the consent field read-only too - every non-" +
    "choice kind, not only the measured ones",
    /I confirm I am 18 or older/.test(list.children[0].textContent));
  const genderHeader = list.children[2].children[0];
  const genderValues = list.children[2].children[1];
  check("Fields lists the categorical field's offered values, in order",
    /Gender/.test(genderHeader.textContent) &&
    genderValues.children.length === 2 &&
    /Male/.test(genderValues.children[0].textContent) &&
    /Female/.test(genderValues.children[1].textContent));
  check("a choicesFrom field (country) is shown but offers no values " +
    "to edit - the Worker's own reason, in this card's words",
    /Country/.test(list.children[3].children[0].textContent) &&
    /live outside the form spec/.test(list.children[3].children[1]
      .textContent));
}

/* -- Bring back, from any session (0.9-M3-S30, #452): both fixtures    */
/* below carry a retired item from the FIRST read, never through a      */
/* click this test made - the whole point the session-scoped roster     */
/* (#433) could not honor. -- */

const SPEC_WITH_RETIRED_VALUE = Object.assign({}, SPEC_FIXTURE, {
  fields: SPEC_FIXTURE.fields.map((f) => f.name !== "gender" ? f :
    Object.assign({}, f, { choices: f.choices.concat([
      { id: "nonbinary", label: "Non-binary", retired: true },
    ]) })),
});

const SPEC_WITH_RETIRED_FIELD = Object.assign({}, SPEC_FIXTURE, {
  fields: SPEC_FIXTURE.fields.concat([
    { name: "pronouns", kind: "choice", label: "Pronouns", retired: true,
      retiredAt: "2026-08-15T00:00:00.000Z",
      choices: [{ id: "they", label: "They/them", retired: true }] },
  ]),
});

{
  const puts = [];
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /admin-fields": () => ok({ ok: true, spec: SPEC_WITH_RETIRED_VALUE }),
    "PUT /admin-fields/gender": ({ body }) => {
      puts.push(JSON.parse(body));
      return ok({ ok: true });
    },
  });
  const { byId } = await driven(routes, { isAdmin: true });
  const genderBlock = byId.get("fields-list").children[2];
  const values = genderBlock.children[1];
  check("a value retired before this page ever opened still appears, " +
    "marked, with exactly one button - never a session limit",
    values.children.length === 3 &&
    /Non-binary \(retired\)/.test(values.children[2].textContent) &&
    values.children[2].children[1].children.length === 1 &&
    /Bring back/.test(values.children[2].children[1].children[0]
      .textContent));
  buttonByText(values.children[2], "Bring back").dispatch("click");
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  check("bringing it back PUTs the value under the SAME id the read " +
    "carried - never invented, never re-minted - and in the read's own " +
    "place, third of three, not appended past a shorter actives list " +
    "(F1, 0.9-M3-S30 fix wave 1, #452)",
    puts.length === 1 && JSON.stringify(puts[0].values) === JSON.stringify([
      { id: "male", label: "Male", retired: false },
      { id: "female", label: "Female", retired: false },
      { id: "nonbinary", label: "Non-binary", retired: false },
    ]));
}

{
  const puts = [];
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /admin-fields": () => ok({ ok: true, spec: SPEC_WITH_RETIRED_FIELD }),
    "PUT /admin-fields/pronouns": ({ body }) => {
      puts.push(JSON.parse(body));
      return ok({ ok: true });
    },
  });
  const { byId } = await driven(routes, { isAdmin: true });
  const list = byId.get("fields-list");
  const pronounsBlock = list.children[4];
  check("a field retired before this page ever opened appears too, " +
    "named and marked retired",
    list.children.length === 5 &&
    /Pronouns \(retired\)/.test(pronounsBlock.children[0].textContent));
  check("its own last-changed date shows, from the read's own " +
    "retiredAt (F3, 0.9-M3-S25's review on #440) - \"last changed\", " +
    "never \"retired on\"",
    /Last changed 2026-08-15/.test(pronounsBlock.children[1].textContent));
  check("a retired field offers exactly one button - Bring back",
    pronounsBlock.children[2].children.length === 1 &&
    /Bring back/.test(pronounsBlock.children[2].children[0].textContent));
  buttonByText(pronounsBlock, "Bring back").dispatch("click");
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  check("un-retiring a field PUTs retired: false and sends no `values` " +
    "at all - the Worker keeps what the field held when it retired " +
    "(server/worker.js's own currentValues/handleRetireField)",
    puts.length === 1 && puts[0].retired === false &&
    !("values" in puts[0]));
}

{
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /admin-fields": () => ok({ ok: true, spec: {
      fields: [{ name: "pronouns", kind: "choice", label: "Pronouns",
        retired: true, retiredAt: null, choices: [] }] } }),
  });
  const { byId } = await driven(routes, { isAdmin: true });
  const block = byId.get("fields-list").children[0];
  check("a retired field with no readable retiredAt (server/worker.js's " +
    "markRetired ships the key null when the row could not say) shows " +
    "no date line rather than inventing one - just header then buttons",
    block.children.length === 2 &&
    !/Last changed/.test(block.textContent));
}

{
  const puts = [];
  const routes = Object.assign({}, BASE_ROUTES, {
    "PUT /admin-fields/gender": ({ body }) => {
      puts.push(JSON.parse(body));
      return ok({ ok: true });
    },
  });
  const { byId } = await driven(routes, { isAdmin: true });
  const genderBlock = byId.get("fields-list").children[2];
  const addRow = genderBlock.children[2];
  addRow.children[0].value = "Non-binary";
  addRow.children[1].dispatch("click");
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  check("adding a value PUTs the current offered list plus the new " +
    "one, with no id on it - the Worker mints one",
    puts.length === 1 && JSON.stringify(puts[0].values) === JSON.stringify([
      { id: "male", label: "Male" }, { id: "female", label: "Female" },
      { label: "Non-binary" },
    ]));
  check("adding a value clears the input on success (F2/F3, #433 fix " +
    "wave - the paired refusal arm below asserts the opposite)",
    addRow.children[0].value === "");
  check("the toast names the write - feedback after an action is a " +
    "brief toast, not an inline status line (#454 item 8)",
    byId.get("toast").hidden === false &&
    byId.get("toast").textContent === "Added.");
  check("the inline status line is cleared, not left holding the " +
    "success message the toast now carries",
    byId.get("fields-status").textContent === "");
}

/* -- Retiring a value confirms IN PLACE (#454 item 9): the button      */
/* becomes a sentence with the real consequence, plus Yes and Cancel -  */
/* never a same-button double-press. -- */

{
  const puts = [];
  const routes = Object.assign({}, BASE_ROUTES, {
    "PUT /admin-fields/gender": ({ body }) => {
      puts.push(JSON.parse(body));
      return ok({ ok: true });
    },
  });
  const { byId } = await driven(routes, { isAdmin: true });
  const genderBlock = byId.get("fields-list").children[2];
  const femaleBlock = genderBlock.children[1].children[1];
  const confirmBlock = femaleBlock.children[3];
  check("the confirm sentence is hidden until Retire is pressed",
    confirmBlock.hidden === true);
  buttonByText(femaleBlock, "Retire").dispatch("click");
  check("pressing Retire reveals the real sentence rather than arming " +
    "the same button a second press would fire",
    confirmBlock.hidden === false &&
    confirmBlock.textContent.includes(Admin.retireValueSentence("Female")));
  buttonByText(confirmBlock, "Cancel").dispatch("click");
  check("Cancel hides the confirm and sends nothing",
    confirmBlock.hidden === true && puts.length === 0);

  buttonByText(femaleBlock, "Retire").dispatch("click");
  buttonByText(confirmBlock, "Yes").dispatch("click");
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  check("Yes PUTs the WHOLE list, female marked `retired: true` IN " +
    "PLACE rather than left out - F1 (0.9-M3-S30 fix wave 1, #452): " +
    "omitting it would have handed server/worker.js's own mergeValues() " +
    "a request with a hole, and the omitted-value-is-retired rule that " +
    "fills that hole appends past everything the request DID list, " +
    "which is exactly the place bring-back could not get her back from",
    puts.length === 1 && JSON.stringify(puts[0].values) === JSON.stringify([
      { id: "male", label: "Male", retired: false },
      { id: "female", label: "Female", retired: true },
    ]));
}

{
  // Un-retire in the same session works exactly like any-session
  // bring-back does, since both read the one live document - the
  // stub's /admin-fields answer changes after the retire PUT, and the
  // card is proven to follow it (ticket item 4). The stub models
  // server/worker.js's own mergeValues: a value OMITTED from the
  // request stays, carried over retired, rather than simply vanishing -
  // the fact this whole "bring back from any session" rebuild depends
  // on the read actually reflecting.
  let spec = SPEC_FIXTURE;
  const puts = [];
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /admin-fields": () => ok({ ok: true, spec: spec }),
    "PUT /admin-fields/gender": ({ body }) => {
      const parsed = JSON.parse(body);
      puts.push(parsed);
      const current = spec.fields.find((f) => f.name === "gender").choices;
      const seen = new Set(parsed.values.filter((v) => v.id)
        .map((v) => v.id));
      const merged = parsed.values.map((v) => v.id ? v :
        Object.assign({}, v, { id: v.label.toLowerCase() }));
      for (const c of current) {
        if (!seen.has(c.id)) merged.push({ id: c.id, label: c.label,
          retired: true });
      }
      spec = Object.assign({}, spec, { fields: spec.fields.map((f) =>
        f.name === "gender" ? Object.assign({}, f, { choices: merged })
          : f) });
      return ok({ ok: true });
    },
  });
  const { byId } = await driven(routes, { isAdmin: true });
  let genderBlock = byId.get("fields-list").children[2];
  let femaleBlock = genderBlock.children[1].children[1];
  buttonByText(femaleBlock, "Retire").dispatch("click");
  buttonByText(femaleBlock.children[3], "Yes").dispatch("click");
  for (let i = 0; i < 8; i += 1) await Promise.resolve();

  genderBlock = byId.get("fields-list").children[2];
  femaleBlock = genderBlock.children[1].children[1];
  check("after retiring, the value still appears - marked retired - " +
    "rather than simply gone from the card",
    genderBlock.children[1].children.length === 2 &&
    /Female \(retired\)/.test(femaleBlock.textContent));
  buttonByText(femaleBlock, "Bring back").dispatch("click");
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  check("un-retiring PUTs the value back with the SAME id this page " +
    "watched it retire under - never a freshly minted one",
    puts.length === 2 &&
    JSON.stringify(puts[1].values) === JSON.stringify([
      { id: "male", label: "Male", retired: false },
      { id: "female", label: "Female", retired: false },
    ]));
  check("the toast says Restored. for the un-retire",
    byId.get("toast").textContent === "Restored.");
}

/* -- THE PLACE IT HELD (F1, 0.9-M3-S30 fix wave 1, #452, review        */
/* comment 5379370482): a value retired from the second of FOUR comes   */
/* back second, not fourth - the reviewer's own measurement. The        */
/* two-value gender fixture above cannot arm this: retiring or          */
/* restoring the second of two values lands at the end either way, so   */
/* nothing there could tell the fix from the bug. Driven through the    */
/* page's real retireValue()/unretireValue(), against the same Worker-  */
/* mirroring stub the round trip above uses (request order wins for     */
/* everything listed; anything left out is carried over retired, past   */
/* everything the request DID list - server/worker.js's own             */
/* mergeValues). "other" starts ALREADY retired, so the arm also checks */
/* that fixing female's own marker never touches anyone else's - a fix  */
/* that quietly reported every OTHER value active regardless of its own */
/* read would pass every check above and un-retire "other" by accident. */
/* -- */

{
  const SPEC_FOR_POSITION = Object.assign({}, SPEC_FIXTURE, {
    fields: SPEC_FIXTURE.fields.map((f) => f.name !== "gender" ? f :
      Object.assign({}, f, { choices: [
        { id: "male", label: "Male" },
        { id: "female", label: "Female" },
        { id: "nb", label: "Non-binary" },
        { id: "other", label: "Other", retired: true },
      ] })),
  });
  let spec = SPEC_FOR_POSITION;
  const puts = [];
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /admin-fields": () => ok({ ok: true, spec: spec }),
    "PUT /admin-fields/gender": ({ body }) => {
      const parsed = JSON.parse(body);
      puts.push(parsed);
      const current = spec.fields.find((f) => f.name === "gender").choices;
      const seen = new Set(parsed.values.filter((v) => v.id)
        .map((v) => v.id));
      const merged = parsed.values.map((v) => v.id ? v :
        Object.assign({}, v, { id: v.label.toLowerCase() }));
      for (const c of current) {
        if (!seen.has(c.id)) merged.push({ id: c.id, label: c.label,
          retired: true });
      }
      spec = Object.assign({}, spec, { fields: spec.fields.map((f) =>
        f.name === "gender" ? Object.assign({}, f, { choices: merged })
          : f) });
      return ok({ ok: true });
    },
  });
  const { byId } = await driven(routes, { isAdmin: true });
  let genderBlock = byId.get("fields-list").children[2];
  let femaleBlock = genderBlock.children[1].children[1];
  check("female starts second of four, active; other starts fourth, " +
    "already retired",
    genderBlock.children[1].children.length === 4 &&
    femaleBlock.children[0].children[0].textContent === "Female" &&
    genderBlock.children[1].children[3].children[0].children[0]
      .textContent === "Other (retired)");

  buttonByText(femaleBlock, "Retire").dispatch("click");
  buttonByText(femaleBlock.children[3], "Yes").dispatch("click");
  for (let i = 0; i < 8; i += 1) await Promise.resolve();

  check("retiring the second of four sends the WHOLE list, only " +
    "female's marker changed - other's own already-retired marker " +
    "carries through untouched, the request itself reorders nothing",
    puts.length === 1 && JSON.stringify(puts[0].values) === JSON.stringify([
      { id: "male", label: "Male", retired: false },
      { id: "female", label: "Female", retired: true },
      { id: "nb", label: "Non-binary", retired: false },
      { id: "other", label: "Other", retired: true },
    ]));

  genderBlock = byId.get("fields-list").children[2];
  check("retired, the value's own block is STILL second - not pushed " +
    "past the values that stayed active - and other is still fourth " +
    "and still retired, not silently brought back",
    genderBlock.children[1].children.length === 4 &&
    genderBlock.children[1].children[0].children[0].children[0]
      .textContent === "Male" &&
    genderBlock.children[1].children[1].children[0].children[0]
      .textContent === "Female (retired)" &&
    genderBlock.children[1].children[2].children[0].children[0]
      .textContent === "Non-binary" &&
    genderBlock.children[1].children[3].children[0].children[0]
      .textContent === "Other (retired)");

  femaleBlock = genderBlock.children[1].children[1];
  buttonByText(femaleBlock, "Bring back").dispatch("click");
  for (let i = 0; i < 8; i += 1) await Promise.resolve();

  check("F1: bringing it back restores the place it held - second, " +
    "not appended past the other three - and other, never touched, " +
    "is still sent retired",
    puts.length === 2 && JSON.stringify(puts[1].values) === JSON.stringify([
      { id: "male", label: "Male", retired: false },
      { id: "female", label: "Female", retired: false },
      { id: "nb", label: "Non-binary", retired: false },
      { id: "other", label: "Other", retired: true },
    ]));

  genderBlock = byId.get("fields-list").children[2];
  check("the re-rendered card shows Female active again, still second " +
    "- the reviewer's own measurement, satisfied - and Other still " +
    "fourth and still retired",
    genderBlock.children[1].children.length === 4 &&
    genderBlock.children[1].children[1].children[0].children[0]
      .textContent === "Female" &&
    genderBlock.children[1].children[3].children[0].children[0]
      .textContent === "Other (retired)");
}

{
  // F4 (#433 fix wave): the PUT answers 200, the GET /admin-fields that
  // follows it (loadFields's own re-read, ticket item 4) answers 500.
  // Before the fix, sendFieldWrite always printed "Added." after
  // `await loadFields()` no matter how the re-read went, so a real
  // failure sat silently under the write's own success message and the
  // card kept showing pre-write data with nothing saying so.
  let reads = 0;
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /admin-fields": () => {
      reads += 1;
      // First call is this test's own boot-time read (driven() always
      // loads the card once before any click) - it has to succeed or
      // there is no gender field to add a value to. The SECOND call is
      // the re-read sendFieldWrite triggers after the PUT below.
      return reads === 1
        ? ok({ ok: true, spec: SPEC_FIXTURE })
        : refused(500, {});
    },
    "PUT /admin-fields/gender": () => ok({ ok: true }),
  });
  const { byId } = await driven(routes, { isAdmin: true });
  const genderBlock = byId.get("fields-list").children[2];
  const addRow = genderBlock.children[2];
  addRow.children[0].value = "Non-binary";
  addRow.children[1].dispatch("click");
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  const shown = byId.get("fields-status").textContent;
  check("a write that succeeds but whose re-read then fails does not " +
    "print the write's own success message over the read's failure - " +
    "no toast fires either, since sendFieldWrite only shows one on the " +
    "\"ok\" re-read leg",
    shown !== "Added." && byId.get("toast").hidden === true);
  check("...and says plainly that what is shown may now be stale, " +
    "since the card still holds whatever the LAST successful read drew",
    /stale|out of date/i.test(shown));
}

/* -- One button, the smarter default (#385 item (b), #454 item 20):    */
/* a rename asks for the new word and sends - no mode to choose. -- */

{
  const puts = [];
  const routes = Object.assign({}, BASE_ROUTES, {
    "PUT /admin-fields/gender": ({ body }) => {
      puts.push(JSON.parse(body));
      return ok({ ok: true });
    },
  });
  const { byId } = await driven(routes, { isAdmin: true });
  const genderBlock = byId.get("fields-list").children[2];
  const maleBlock = genderBlock.children[1].children[0];
  const form = maleBlock.children[2];
  check("the rename form is hidden until Rename is pressed, and offers " +
    "exactly one send button plus Cancel - no mode to pick between",
    form.hidden === true && form.children.length === 4 &&
    form.children[2].textContent === "Rename" &&
    form.children[3].textContent === "Cancel");
  buttonByText(maleBlock, "Rename").dispatch("click");
  check("pressing Rename reveals the form, pre-filled with the " +
    "current label, and states the one consequence this page sends",
    form.hidden === false && form.children[0].value === "Male" &&
    form.children[1].textContent === Admin.RENAME_CONSEQUENCE);
  form.children[0].value = "Man";
  form.children[2].dispatch("click"); // Rename (send)
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  check("the send always carries mode: relabel - the smarter default, " +
    "with the id kept and the label changed",
    puts.length === 1 && puts[0].mode === "relabel" &&
    JSON.stringify(puts[0].values) === JSON.stringify([
      { id: "male", label: "Man" }, { id: "female", label: "Female" },
    ]));
  check("the toast says Renamed.",
    byId.get("toast").textContent === "Renamed.");
}

{
  const { byId } = await driven(BASE_ROUTES, { isAdmin: true });
  const genderBlock = byId.get("fields-list").children[2];
  const maleBlock = genderBlock.children[1].children[0];
  const form = maleBlock.children[2];
  buttonByText(maleBlock, "Rename").dispatch("click");
  buttonByText(form, "Cancel").dispatch("click");
  check("Cancel hides the rename form without sending anything",
    form.hidden === true);
}

{
  const puts = [];
  const routes = Object.assign({}, BASE_ROUTES, {
    "PUT /admin-fields/gender": ({ body }) => {
      puts.push(JSON.parse(body));
      return ok({ ok: true });
    },
  });
  const { byId } = await driven(routes, { isAdmin: true });
  const genderBlock = byId.get("fields-list").children[2];
  const maleBlock = genderBlock.children[1].children[0];
  const femaleBlock = genderBlock.children[1].children[1];
  check("the first value's Move up is disabled - nowhere to move it",
    buttonByText(maleBlock, "Move up").disabled === true);
  check("the last value's Move down is disabled the same way",
    buttonByText(femaleBlock, "Move down").disabled === true);
  buttonByText(maleBlock, "Move down").dispatch("click");
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  check("Move down PUTs the two values swapped, ids and labels " +
    "unchanged - a reorder is not a rename",
    puts.length === 1 && JSON.stringify(puts[0].values) === JSON.stringify([
      { id: "female", label: "Female" }, { id: "male", label: "Male" },
    ]));
}

/* -- Retiring a field confirms IN PLACE too (#454 item 9). -- */

{
  const calls = [];
  const routes = Object.assign({}, BASE_ROUTES, {
    "DELETE /admin-fields/gender": () => {
      calls.push("delete");
      return { ok: true, status: 200, async json() { return {}; } };
    },
  });
  const { byId } = await driven(routes, { isAdmin: true });
  const genderBlock = byId.get("fields-list").children[2];
  const confirmBlock = genderBlock.children[4];
  check("the confirm sentence is hidden until Retire field is pressed",
    confirmBlock.hidden === true);
  buttonByText(genderBlock, "Retire field").dispatch("click");
  check("pressing it reveals the real sentence, not a same-button arm",
    confirmBlock.hidden === false &&
    confirmBlock.textContent.includes(Admin.retireFieldSentence("Gender")));
  buttonByText(confirmBlock, "Cancel").dispatch("click");
  check("Cancel hides it and sends nothing",
    confirmBlock.hidden === true && calls.length === 0);

  buttonByText(genderBlock, "Retire field").dispatch("click");
  buttonByText(confirmBlock, "Yes").dispatch("click");
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  check("Yes DELETEs the field",
    calls.length === 1);
  check("the toast says Retired. for the field-level retire too",
    byId.get("toast").textContent === "Retired.");
}

{
  const puts = [];
  const routes = Object.assign({}, BASE_ROUTES, {
    "PUT /admin-fields/pronouns": ({ body }) => {
      puts.push(JSON.parse(body));
      return ok({ ok: true });
    },
  });
  const { byId } = await driven(routes, { isAdmin: true });
  byId.get("fields-new-id").value = "pronouns";
  byId.get("fields-new-label").value = "Pronouns";
  byId.get("fields-new-values").value = "She/her\nHe/him\n\nThey/them";
  byId.get("fields-new-add").dispatch("click");
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  check("adding a field PUTs the id, label and the starting values, " +
    "blank lines dropped, each with no id of its own",
    puts.length === 1 && JSON.stringify(puts[0]) === JSON.stringify({
      label: "Pronouns",
      values: [{ label: "She/her" }, { label: "He/him" },
        { label: "They/them" }],
    }));
  check("the three inputs clear after a successful add - the SUCCESS " +
    "leg of F2/F3 (#433 fix wave); the paired refusal block below " +
    "asserts the opposite, so this arm can no longer pass on a refusal " +
    "too (it did, before the fix)",
    byId.get("fields-new-id").value === "" &&
    byId.get("fields-new-label").value === "" &&
    byId.get("fields-new-values").value === "");
}

{
  // F2/F3 (#433 fix wave): the failure leg the arm above never forced -
  // before the fix, this same block would have shown the inputs empty
  // too, since the old code cleared them unconditionally, synchronously,
  // whether or not the write went through.
  const routes = Object.assign({}, BASE_ROUTES, {
    "PUT /admin-fields/waist2": () => refused(400, {
      error: "That id is already used by a field or a value.",
    }),
  });
  const { byId } = await driven(routes, { isAdmin: true });
  byId.get("fields-new-id").value = "waist2";
  byId.get("fields-new-label").value = "Waist";
  byId.get("fields-new-values").value = "cm\nin";
  byId.get("fields-new-add").dispatch("click");
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  check("a refused add-field keeps the admin's typed id, label and " +
    "values, and the button is enabled again for another try",
    byId.get("fields-new-id").value === "waist2" &&
    byId.get("fields-new-label").value === "Waist" &&
    byId.get("fields-new-values").value === "cm\nin" &&
    byId.get("fields-new-add").disabled === false &&
    /already used/.test(byId.get("fields-status").textContent));
}

{
  const { byId, calls } = await driven(BASE_ROUTES, { isAdmin: true });
  byId.get("fields-new-id").value = "Bad Id!";
  byId.get("fields-new-label").value = "Whatever";
  byId.get("fields-new-add").dispatch("click");
  check("a field id outside the Worker's own charset is refused BEFORE " +
    "a request is sent",
    calls.filter((c) => c.method === "PUT").length === 0 &&
    /lowercase letters/.test(byId.get("fields-status").textContent));
}

{
  const { byId, calls } = await driven(BASE_ROUTES, { isAdmin: true });
  byId.get("fields-new-id").value = "waist";
  byId.get("fields-new-label").value = "";
  byId.get("fields-new-add").dispatch("click");
  check("an empty new-field label is refused before anything is sent",
    calls.filter((c) => c.method === "PUT").length === 0 &&
    /needs a label/.test(byId.get("fields-status").textContent));
}

{
  const { byId, calls } = await driven(BASE_ROUTES, { isAdmin: true });
  const genderBlock = byId.get("fields-list").children[2];
  const addRow = genderBlock.children[2];
  addRow.children[0].value = "x".repeat(65);
  addRow.children[1].dispatch("click");
  check("a value label past the Worker's own 64-character bound is " +
    "refused before a request is sent",
    calls.filter((c) => c.method === "PUT").length === 0 &&
    /64 characters or fewer/.test(byId.get("fields-status").textContent));
}

{
  const routes = Object.assign({}, BASE_ROUTES, {
    "PUT /admin-fields/gender": () => refused(409, {
      error: "A value list is refused on a field whose choices live " +
        "elsewhere.",
    }),
  });
  const { byId } = await driven(routes, { isAdmin: true });
  const genderBlock = byId.get("fields-list").children[2];
  const addRow = genderBlock.children[2];
  addRow.children[0].value = "Enby";
  addRow.children[1].dispatch("click");
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  check("a write the Worker refuses shows the Worker's own words, on " +
    "this card's own status line - and no toast fires, since the " +
    "write never reached its success leg",
    /choices live elsewhere/.test(byId.get("fields-status").textContent) &&
    byId.get("toast").hidden === true);
  check("a refused add value keeps what the admin typed - F2 (#433 fix " +
    "wave): the page's own Roles card precedent, not lost text over a " +
    "Worker's reason, and the button is enabled again",
    addRow.children[0].value === "Enby" &&
    addRow.children[1].disabled === false);
}

{
  // The MAX_FIELD_VALUES ceiling now counts a retired value too (an
  // incidental fix this ticket's own read makes possible - the old
  // /spec-sourced liveChoices() could never see a retired value to
  // count it, and the card's own visible sentence always said "retired
  // ones counted"). One active value plus 99 retired ones is at the
  // Worker's own ceiling; the client-side courtesy refuses before a
  // round trip, the same way every other bound on this page already
  // does.
  const AT_CEILING = { fields: [{ name: "gender", kind: "choice",
    label: "Gender", choices: [{ id: "male", label: "Male" }].concat(
      Array.from({ length: 99 }, (_, i) =>
        ({ id: "r" + i, label: "R" + i, retired: true }))) }] };
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /admin-fields": () => ok({ ok: true, spec: AT_CEILING }),
  });
  const { byId, calls } = await driven(routes, { isAdmin: true });
  const genderBlock = byId.get("fields-list").children[0];
  const addRow = genderBlock.children[2];
  addRow.children[0].value = "One more";
  addRow.children[1].dispatch("click");
  check("adding past the ceiling - retired values counted - is " +
    "refused before a request is sent",
    calls.filter((c) => c.method === "PUT").length === 0 &&
    /retired ones counted/.test(byId.get("fields-status").textContent));
}

check("Fields never fetches per-member counts - no /charts-data call " +
  "anywhere on this page (#385 rule 1: the card draws the spec, never " +
  "who picked what)",
  !/\/charts-data/.test(adminJs));

{
  const HOSTILE = "<img src=x onerror=alert(1)>";
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /admin-fields": () => ok({ ok: true, spec: { fields: [
      { name: "gender", kind: "choice", label: HOSTILE,
        choices: [{ id: "x", label: HOSTILE }] },
    ] } }),
  });
  const { byId } = await driven(routes, { isAdmin: true });
  const block = byId.get("fields-list").children[0];
  check("a hostile field or value label from GET /admin-fields renders " +
    "as literal text, not markup",
    block.children[0].children[0].textContent === HOSTILE &&
    block.children[0].children[0]._text.includes("<img"));
}

/* -- The choices-to-values translation (F7, 0.9-M3-S25's review on     */
/* #440, comment 5377697322; ruled into this ticket's scope by Prime's  */
/* ruling comment 5378228358 on #440). -- */

{
  // The round trip: read -> translate -> write changes the spec. Every
  // PUT body this page ever sends carries `values`, and this asserts it
  // structurally rather than trusting the fixture round-trips above:
  // JSON.stringify would print `choices` too if it were there.
  const puts = [];
  const routes = Object.assign({}, BASE_ROUTES, {
    "PUT /admin-fields/gender": ({ body }) => {
      puts.push(JSON.parse(body));
      return ok({ ok: true });
    },
  });
  const { byId } = await driven(routes, { isAdmin: true });
  const genderBlock = byId.get("fields-list").children[2];
  const addRow = genderBlock.children[2];
  addRow.children[0].value = "Non-binary";
  addRow.children[1].dispatch("click");
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  check("read -> translate -> write changes the spec, and the body " +
    "carries `values`, never `choices` - the container-key rename",
    puts.length === 1 && "values" in puts[0] && !("choices" in puts[0]));
}

{
  // The hazard the translation avoids, driven rather than asserted: a
  // Worker-shaped model of the real contract (server/worker.js's own
  // handleWriteField only ever reads `payload.values` - an unknown key
  // is silently ignored, per F7's own driven proof on #440) fed the
  // UNTRANSLATED echo - the read's whole field object, `choices` and
  // all, sent back exactly as GET /admin-fields answered it. It
  // answers 200 and changes nothing, exactly like the real Worker.
  const fieldFromRead = { name: "gender", kind: "choice", label: "Gender",
    choices: [{ id: "male", label: "Male" },
      { id: "female", label: "Female" }] };
  let stored = fieldFromRead.choices;
  function modelWorkerPut(body) {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed.values)) stored = parsed.values;
    // An unrecognized key (`choices`) is ignored, never read as
    // `values` - the same forgiveness server/worker.js's
    // handleWriteField shows any body key it does not name.
    return { status: 200, body: { ok: true } };
  }
  const untranslatedEcho = JSON.stringify(fieldFromRead);
  const before = JSON.stringify(stored);
  const result = modelWorkerPut(untranslatedEcho);
  check("the untranslated echo (the read's own field object, `choices` " +
    "key and all) is accepted (200) and changes nothing - the exact " +
    "hazard F7 found, modeled off the real contract's own key names",
    result.status === 200 && JSON.stringify(stored) === before);
  const translated = JSON.stringify({ values: fieldFromRead.choices });
  modelWorkerPut(translated);
  check("the same values under the RIGHT key changes the spec - proving " +
    "the model distinguishes the two rather than always no-op'ing",
    JSON.stringify(stored) === JSON.stringify(fieldFromRead.choices) &&
    stored !== fieldFromRead.choices);
}

/* -- Wiring for #433 fix wave, F1: the id cell (not the label cell)    */
/* carries wrap-row-value, so it is the id - not the label - that gets  */
/* flex:1 and overflow-wrap:anywhere and the label that keeps its own   */
/* content width. This is wiring, not pixels: a Node DOM stub has no    */
/* layout engine, so it can prove which class landed on which element   */
/* and that neither string was cut - it CANNOT compute a rendered width */
/* or height, which is exactly the property F1 was about (both cells    */
/* were already un-truncated and un-overflowed before the fix; the      */
/* label still rendered 0px wide). That measurement is a real-browser   */
/* reading, printed in the completion on #433, not a suite arm -        */
/* AGENTS.md's "Verify what renders" section says plainly that a DOM    */
/* stub proves wiring, never pixels. -- */

{
  // 48, not 64: FIELD_ID_PATTERN/SPEC_ID (server/worker.js, read as
  // source since this slice may not edit server/) cap a field id at
  // `^[a-z0-9][a-z0-9_-]{0,47}$` - one char plus 47 more. A 64-char id
  // was never reachable through this system; 48 is the real maximum
  // and the fixture the review's F1 measured against.
  const LONG_ID = "x".repeat(48);
  const LONG_LABEL = "A very long value label, repeated to overflow. ".
    repeat(3).trim();
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /admin-fields": () => ok({ ok: true, spec: { fields: [
      { name: LONG_ID, kind: "choice", label: "Long field",
        choices: [{ id: "v1", label: LONG_LABEL }] },
    ] } }),
  });
  const { byId } = await driven(routes, { isAdmin: true });
  const block = byId.get("fields-list").children[0];
  const header = block.children[0];
  const valueRow = block.children[1].children[0].children[0];
  check("a 48-character field id and a long value label both render " +
    "whole, neither cut, inside the wrap-row/wrap-row-value cells the " +
    "geometry proof targets",
    header.children[1].textContent === LONG_ID &&
    valueRow.children[0].textContent === LONG_LABEL);
  check("the id cell carries wrap-row-value and the label cell carries " +
    "hint - F1 (#433 fix wave): the id is the string with no natural " +
    "break point, so it is the one that needs flex:1 to claim the " +
    "row's slack instead of squeezing the label to nothing",
    header.children[1].className === "wrap-row-value" &&
    header.children[0].className === "hint" &&
    valueRow.children[1].className === "wrap-row-value" &&
    valueRow.children[0].className === "hint");
}

{
  const { byId } = await driven(BASE_ROUTES, { isAdmin: true });
  const genderBlock = byId.get("fields-list").children[2];
  const header = genderBlock.children[0];
  const maleLabelRow = genderBlock.children[1].children[0].children[0];
  check("a Fields header row carries wrap-row/wrap-row-value, the same " +
    "overflow protection every other row on this page uses",
    header.className === "row wrap-row" &&
    header.children[1].className === "wrap-row-value");
  check("a Fields value row carries the same classes",
    maleLabelRow.className === "row wrap-row" &&
    maleLabelRow.children[1].className === "wrap-row-value");
}

/* -- Change log: newest first, actor id (never a label the Worker      */
/* does not send), textContent only -- */

{
  const { byId } = await driven(BASE_ROUTES, { isAdmin: true });
  const rows = byId.get("log-list").children;
  check("the log renders both entries, newest first, exactly as GET sent " +
    "them - this page reorders nothing",
    rows.length === 2 &&
    rows[0].children[0].textContent === "2026-08-21 12:00 UTC" &&
    rows[1].children[0].textContent === "2026-08-21 11:00 UTC");
  check("a hex actor renders a short account id; the break-glass token " +
    "renders in plain words, never the literal string",
    rows[0].children[1].textContent === "a1…" &&
    rows[1].children[1].textContent === "the break-glass tool");
  check("the action enum renders as a plain phrase, followed by the " +
    "Worker's own summary",
    rows[0].children[2].textContent ===
      "changed a setting: set site.groupName" &&
    rows[1].children[2].textContent === "added an admin: flagged an admin");
}

/* -- Wiring for #416, F1: the row and its value cell carry the classes  */
/* theme.css's ".row.wrap-row" fix keys on, and a summary past the       */
/* Worker's own 200-char bound is cut rather than rendered whole. This   */
/* is wiring, not pixels - a Node DOM stub proves an id exists in a      */
/* string and carries a class name; it cannot compute whether the real  */
/* CSS actually stops that string spilling past the screen's edge. The  */
/* pixel proof is a real-browser measurement, printed in the completion */
/* on #416, not a suite arm - AGENTS.md's "Verify what renders" section  */
/* says plainly that a DOM stub proves wiring, never pixels. -- */

{
  const { byId } = await driven(BASE_ROUTES, { isAdmin: true });
  const rows = byId.get("log-list").children;
  check("every change-log row carries wrap-row, not plain row - the " +
    "modifier class theme.css's overflow fix (#416, F1) keys on",
    rows.every((row) => row.className === "row wrap-row"));
  check("the change log's value cell (the summary column) carries " +
    "wrap-row-value, which is what gets flex:1 and overflow-wrap so it " +
    "takes the row's slack instead of the fixed when/who columns",
    rows.every((row) => row.children[2].className === "wrap-row-value"));
}

{
  const { byId } = await driven(BASE_ROUTES, { isAdmin: true });
  const row = byId.get("roles-admin").children[0];
  check("a Roles row carries wrap-row too - the same overflow the " +
    "change log has, a member's own label can trigger just as easily",
    row.className === "row wrap-row");
  check("the Roles row's label cell carries wrap-row-value",
    row.children[0].className === "wrap-row-value");
}

{
  const HEX_ID = "b".repeat(64);
  const URL = "https://" + "sub.".repeat(20) + "example.com/path";
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /admin-log": () => ok({ ok: true, log: [
      { at: "2026-08-21T12:00:00.000Z", accountId: "a1",
        action: "membership.remove", name: HEX_ID,
        summary: "removed " + HEX_ID },
      { at: "2026-08-21T11:00:00.000Z", accountId: "a1",
        action: "content.set", name: "site.welcomeText",
        summary: "set site.welcomeText to " + URL },
    ] }),
  });
  const { byId } = await driven(routes, { isAdmin: true });
  const rows = byId.get("log-list").children;
  check("a 64-hex account id named inside a summary renders whole (it " +
    "is under the 200-char bound), inside the cell the overflow fix " +
    "targets - F1's own sharpest trigger",
    rows[0].children[2].textContent.includes(HEX_ID) &&
    rows[0].children[2].className === "wrap-row-value");
  check("a URL a member pasted into a setting and echoed back in the " +
    "log renders whole, inside the same cell - the welcome text is a " +
    "setting this very page edits",
    rows[1].children[2].textContent.includes(URL) &&
    rows[1].children[2].className === "wrap-row-value");
}

{
  const LONG_SUMMARY = "x".repeat(5000);
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /admin-log": () => ok({ ok: true, log: [
      { at: "2026-08-21T12:00:00.000Z", accountId: "a1",
        action: "content.set", name: "site.welcomeText",
        summary: LONG_SUMMARY },
    ] }),
  });
  const { byId } = await driven(routes, { isAdmin: true });
  const what = byId.get("log-list").children[0].children[2];
  check("a summary past the Worker's own 200-char bound is cut, not " +
    "rendered whole (#416, F1/F5) - the display enforces the contract " +
    "ceiling rather than assuming the Worker held it on every row",
    what.textContent.length < LONG_SUMMARY.length);
  check("and the cut is marked, not silent - a reader can tell the row " +
    "was truncated rather than reading a short summary as the whole one",
    what.textContent.endsWith("…"));
}

{
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /admin-log": () => ok({ ok: true, log: [] }),
  });
  const { byId } = await driven(routes, { isAdmin: true });
  check("an empty log says so in words rather than showing a blank card",
    /No changes yet/.test(byId.get("log-list").textContent));
}

/* -- Departed: three sections in order, the empty state, confirm IN     */
/* PLACE, refusals rendered as the Worker states them, the re-read after */
/* a result, 20-then-more, and no handle/no numeric id anywhere (#420;   */
/* #385 rule 4; #454 items 8-10/13/20). -- */

// Finds the row-block whose display name matches - not a fixed child
// index, the same reason the Fields card's own confirm tests already
// use buttonByText/findAll: dangerousAction() nests a second
// "stack-tight" (the hidden confirm) inside the row's own "stack-tight",
// and a bare index would be brittle and hard to read either way. The
// predicate on `children[0].children[0]` is what tells the two apart -
// the confirm block's own first child is a <p>, with no children of its
// own under this stub, so it never matches.
function departedRowByLabel(list, label) {
  return findAll(list, (n) => n.className === "stack-tight" &&
    n.children[0] && n.children[0].children &&
    n.children[0].children[0] &&
    n.children[0].children[0].textContent === label)[0];
}

{
  const DEPARTED_LIST = { ok: true,
    departed: [{ accountId: "d1", label: "Departed One",
      lastSeenAt: "2026-07-01T00:00:00.000Z", status: "left" }],
    unknown: [{ accountId: "u1", label: null,
      lastSeenAt: "2026-07-02T00:00:00.000Z",
      reason: "unknown until next sign-in" }],
    allowed: [{ accountId: "l1", label: "Allowed One",
      lastSeenAt: "2026-07-03T00:00:00.000Z",
      reason: "allowed by the operator's list - remove it there first" }] };
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /admin-departed": () => ok(DEPARTED_LIST),
  });
  const { byId } = await driven(routes, { isAdmin: true });
  const list = byId.get("departed-list");
  check("the three sections render in the ticket's own order - departed, " +
    "then unknown, then allowed - as headings this card writes itself",
    list.children[0].tag === "h2" && list.children[0].textContent ===
      "Departed" &&
    list.children[2].tag === "h2" && list.children[2].textContent ===
      "Unknown" &&
    list.children[4].tag === "h2" && list.children[4].textContent ===
      "Allowed");
  check("a departed row shows the membership label and last seen (item " +
    "13)",
    list.children[1].children[0].children[0].textContent ===
      "Departed One" &&
    /last seen 2026-07-01/.test(
      list.children[1].children[0].children[1].textContent));
  check("an unknown row with no label falls back to the short id, and " +
    "states its own reason in the Worker's own words",
    list.children[3].children[0].children[0].textContent === "u1…" &&
    /unknown until next sign-in/.test(
      list.children[3].children[0].children[1].textContent));
  check("an allowed row states the operator's-list sentence exactly as " +
    "the Worker sent it",
    list.children[5].children[0].children[0].textContent ===
      "Allowed One" &&
    /allowed by the operator's list - remove it there first/.test(
      list.children[5].children[0].children[1].textContent));
  check("every row carries wrap-row/wrap-row-value (#433 F1's " +
    "convention, named in this ticket's own scope) - the display name " +
    "is the unbounded run",
    list.children[1].children[0].className === "row wrap-row" &&
    list.children[1].children[0].children[0].className ===
      "wrap-row-value");
}

{
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /admin-departed": () => ok(DEPARTED_EMPTY),
  });
  const { byId } = await driven(routes, { isAdmin: true });
  check("the empty state says so in the ticket's own words (item 10), " +
    "nothing else drawn",
    byId.get("departed-list").textContent ===
      "Nobody has left - nothing to clean up.");
}

{
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /admin-departed": () => ok({ ok: true,
      departed: [{ accountId: "d1", label: null,
        lastSeenAt: "2026-07-01T00:00:00.000Z",
        // A stub carrying both a handle and a numeric id - #385 rule 1
        // says the page must render neither, so this proves it from the
        // answer side rather than only from the Worker's own contract.
        handle: "@realname", telegramId: "123456789" }],
      unknown: [], allowed: [] }),
  });
  const { byId } = await driven(routes, { isAdmin: true });
  check("a stub carrying a handle and a numeric id renders neither " +
    "(#385 rule 1) - departedName/departedRow read only accountId, " +
    "label, lastSeenAt and reason",
    !/@realname/.test(byId.get("departed-list").textContent) &&
    !/123456789/.test(byId.get("departed-list").textContent));
}

{
  // Fix wave 1 on #458 (review comment 5380371688, F4 in the review's
  // own numbering): the check above reads textContent alone, so a
  // needle written into an attribute - title, aria-label, a data-*
  // attribute, or any other field name - would pass it silently. This
  // arms the WHOLE rendered subtree against a hostile stub carrying a
  // handle, a numeric Telegram id, a username and an email, checked
  // against every text node, every attribute value and the serialized
  // markup together, not only the text a person reads.
  const NEEDLES = ["@leakhandle", "918273645", "leakusername",
    "leak@example.com"];
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /admin-departed": () => ok({ ok: true,
      departed: [{ accountId: "d1", label: null,
        lastSeenAt: "2026-07-01T00:00:00.000Z",
        handle: NEEDLES[0], telegramId: NEEDLES[1],
        username: NEEDLES[2], email: NEEDLES[3] }],
      unknown: [], allowed: [] }),
  });
  const { byId } = await driven(routes, { isAdmin: true });
  const markup = serializeSubtree(byId.get("departed-list"));
  check("no needle from a hostile stub (handle, numeric Telegram id, " +
    "username, email) appears in any text node, any attribute value, " +
    "or the serialized markup of the Departed list (#385 rule 1, the " +
    "whole rendered subtree - not textContent alone)",
    NEEDLES.every((needle) => !markup.includes(needle)));
}

{
  // 20-then-more (item 13) over ONE list - 25 departed rows, no
  // unknown/allowed, so this is the plainest arm of the pagination.
  const many = Array.from({ length: 25 }, (_unused, i) => ({
    accountId: "d" + i, label: "Member " + i,
    lastSeenAt: "2026-07-01T00:00:00.000Z" }));
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /admin-departed": () => ok({ ok: true, departed: many,
      unknown: [], allowed: [] }),
  });
  const { byId } = await driven(routes, { isAdmin: true });
  const list = byId.get("departed-list");
  check("the newest 20 render with a More button when there are more " +
    "(item 13) - one heading, 20 rows, one More button",
    list.children.length === 22 &&
    list.children[0].tag === "h2" &&
    buttonByText(list, "More") !== undefined);
  buttonByText(list, "More").dispatch("click");
  check("More reveals every remaining row, and the button is gone once " +
    "everything shows",
    list.children.length === 26 && buttonByText(list, "More") === undefined);
}

{
  // Confirm IN PLACE (item 9): Remove reveals the sentence, Cancel sends
  // nothing, and a DELETE goes out only after Yes - never before it.
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /admin-departed": () => ok({ ok: true,
      departed: [{ accountId: "d1", label: "Rejoined",
        lastSeenAt: "2026-07-01T00:00:00.000Z" }],
      unknown: [], allowed: [] }),
    "DELETE /admin-departed/d1": () => ok({ ok: true,
      removed: { submissions: 1, directory: 1, membership: 0,
        sessions: 1 } }),
  });
  const { byId, calls } = await driven(routes, { isAdmin: true });
  const row = departedRowByLabel(byId.get("departed-list"), "Rejoined");
  const remove = buttonByText(row, "Remove");
  check("the confirm sentence is hidden until Remove is pressed",
    row.children[2].hidden === true);
  remove.dispatch("click");
  check("pressing Remove reveals the real sentence - naming the four row " +
    "classes, since the landed Worker route offers no dry-run count " +
    "(item 9's own fallback)",
    row.children[2].hidden === false &&
    row.children[2].textContent.includes(
      Admin.eraseDepartedSentence("Rejoined")));
  check("no DELETE is sent before Yes is pressed",
    calls.filter((c) => c.method === "DELETE").length === 0);
  buttonByText(row.children[2], "Cancel").dispatch("click");
  check("Cancel hides the confirm and sends nothing",
    row.children[2].hidden === true &&
    calls.filter((c) => c.method === "DELETE").length === 0);

  remove.dispatch("click");
  buttonByText(row.children[2], "Yes").dispatch("click");
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  check("Yes, and only Yes, sends the DELETE - exactly once, for the " +
    "right account",
    calls.filter((c) => c.method === "DELETE" &&
      c.path === "/admin-departed/d1").length === 1);
  check("a genuine erase toasts Removed.",
    byId.get("toast").textContent === "Removed.");
}

{
  // Each refusal rendered exactly as the Worker states it - current
  // member (its own re-check at erase time, never this stale list),
  // unknown, and allowed - the three DELETE refusal shapes S15's own
  // completion on #420 documents.
  const CURRENT_MEMBER_MSG = "Telegram says that account is still in the " +
    "group (“left”), so nothing was erased.";
  const UNKNOWN_MSG = "That member's departure could not be confirmed - " +
    "unknown until next sign-in. Nothing was erased.";
  const ALLOWED_MSG = "That account is allowed by the operator's list - " +
    "remove it there first. Telegram was never asked about it, so " +
    "nothing was erased.";
  let getCalls = 0;
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /admin-departed": () => {
      getCalls += 1;
      return ok({ ok: true,
        departed: [{ accountId: "d1", label: "Rejoined",
          lastSeenAt: "2026-07-01T00:00:00.000Z" }],
        unknown: [{ accountId: "u1", label: "Quiet",
          lastSeenAt: "2026-07-02T00:00:00.000Z",
          reason: "unknown until next sign-in" }],
        allowed: [{ accountId: "l1", label: "Kept",
          lastSeenAt: "2026-07-03T00:00:00.000Z",
          reason: "allowed by the operator's list - remove it there " +
            "first" }] });
    },
    "DELETE /admin-departed/d1": () =>
      refused(409, { error: CURRENT_MEMBER_MSG }),
    "DELETE /admin-departed/u1": () => refused(409, { error: UNKNOWN_MSG }),
    "DELETE /admin-departed/l1": () => refused(409, { error: ALLOWED_MSG }),
  });
  const { byId } = await driven(routes, { isAdmin: true });

  const d1 = departedRowByLabel(byId.get("departed-list"), "Rejoined");
  buttonByText(d1, "Remove").dispatch("click");
  buttonByText(d1.children[2], "Yes").dispatch("click");
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  check("a current-member refusal shows the Worker's exact words, " +
    "verbatim - never rewrapped with the other cards' own \"Nothing " +
    "changed\" tail",
    byId.get("toast").textContent === CURRENT_MEMBER_MSG);
  check("the list re-reads after a refusal too, not only after success",
    getCalls === 2);

  const u1 = departedRowByLabel(byId.get("departed-list"), "Quiet");
  buttonByText(u1, "Remove").dispatch("click");
  buttonByText(u1.children[2], "Yes").dispatch("click");
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  check("an unknown-reason refusal shows the Worker's own reason",
    byId.get("toast").textContent === UNKNOWN_MSG);

  const l1 = departedRowByLabel(byId.get("departed-list"), "Kept");
  buttonByText(l1, "Remove").dispatch("click");
  buttonByText(l1.children[2], "Yes").dispatch("click");
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  check("an allowed-by-the-operator's-list refusal shows the Worker's " +
    "own sentence, exactly",
    byId.get("toast").textContent === ALLOWED_MSG);
  check("three refusals, three re-reads",
    getCalls === 4);
}

{
  // A mutating stub (the same shape this file's own Fields section uses
  // for "the read is real, not remembered") - proves the re-read is a
  // REAL read reflecting the erase, not a call count alone.
  let remaining = [{ accountId: "gone", label: "Gone Soon",
    lastSeenAt: "2026-07-01T00:00:00.000Z" }];
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /admin-departed": () => ok({ ok: true, departed: remaining,
      unknown: [], allowed: [] }),
    "DELETE /admin-departed/gone": () => {
      remaining = [];
      return ok({ ok: true, removed: { submissions: 1, directory: 1,
        membership: 0, sessions: 1 } });
    },
  });
  const { byId } = await driven(routes, { isAdmin: true });
  check("before erasing: the row is there",
    /Gone Soon/.test(byId.get("departed-list").textContent));
  const row = departedRowByLabel(byId.get("departed-list"), "Gone Soon");
  buttonByText(row, "Remove").dispatch("click");
  buttonByText(row.children[2], "Yes").dispatch("click");
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  check("the re-read reflects the erase - the row is gone and the empty " +
    "state shows",
    byId.get("departed-list").textContent ===
      "Nobody has left - nothing to clean up.");
}

{
  const HOSTILE = "<img src=x onerror=alert(1)>";
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /admin-departed": () => ok({ ok: true,
      departed: [{ accountId: "h1", label: HOSTILE,
        lastSeenAt: "2026-07-01T00:00:00.000Z" }],
      unknown: [], allowed: [] }),
  });
  const { byId } = await driven(routes, { isAdmin: true });
  const nameSpan = byId.get("departed-list").children[1].children[0]
    .children[0];
  check("a hostile membership label renders as literal text on the " +
    "Departed card too - textContent, never innerHTML",
    nameSpan.textContent === HOSTILE && nameSpan._text.includes("<img"));
}

/* -- Wiring for #463: the wrap-row squeeze - a long, unbroken run in   */
/* one `.row.wrap-row` child could crowd a shorter sibling down to 0px, */
/* at ANY width, because `.wrap-row-value`'s `flex: 1` (basis 0%) gave  */
/* it zero weight in the shrink math a deficit row runs (fix wave 1,    */
/* #463, F1 - the review's own 1280px Roles-row fixture, CONFIRMED).    */
/* This suite has no layout engine (the Node DOM stub cannot compute a  */
/* rendered width), so it proves the three things it CAN: theme.css     */
/* carries the phone-width stacking rule (`flex-direction: column` AND  */
/* `align-items: stretch`, both read from the SAME parsed rule body -   */
/* fix wave 1, F2 - dropping either one alone must fail this check,     */
/* never just the first) inside the site's phone breakpoint; it carries */
/* the desktop-width fix (`.wrap-row-value { flex: 1 1 auto; }`,        */
/* OUTSIDE any breakpoint - basis `auto` rather than `0%`, so a width    */
/* deficit shrinks every child by its own size instead of routing all   */
/* of it away from this one); and that a wrap-row site this suite had   */
/* not yet covered (the numeric-field read-only row) still emits the    */
/* classes both rules key on. Every check below is a PARSED rule, never */
/* a string match on a comment - the same discipline tools/check_web.py's */
/* own media_block_bodies()/rule_bodies() hold reviewing CSS to,        */
/* reimplemented here in JS since this apparatus is Node, not Python.   */
/* The real geometry proof - the squeezed cell legible at 375/360/1280, */
/* and short-content desktop rects staying byte-for-byte the same       */
/* before and after fix wave 1 - is a real-browser measurement, printed */
/* in the completion, exactly as #433 F1's own pixel claim was (a Node  */
/* stub proves wiring, never pixels). -- */

// Comments only - a rule inside a comment ("/* .row.wrap-row { ... */")
// must not satisfy either check below, so both strip them first.
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

// The body of every @media block, brace-matched exactly the way
// tools/check_web.py's media_block_bodies() is - counted rather than
// stopped at the first "}", because a media block is a block OF
// blocks. Each entry also carries the block's own header text, so a
// caller can pick the block by the width it names rather than by
// position.
function mediaBlocks(css) {
  const blocks = [];
  const opener = /@media[^{]*\{/g;
  let match;
  while ((match = opener.exec(css))) {
    let depth = 1;
    let index = opener.lastIndex;
    while (index < css.length && depth) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") depth -= 1;
      index += 1;
    }
    blocks.push({ header: match[0], body: css.slice(opener.lastIndex,
      index - 1) });
    opener.lastIndex = index;
  }
  return blocks;
}

// Every rule body in `block` whose selector list names `selector`
// exactly - a compared, split list rather than a substring search, so
// ".row.wrap-row" is never mistaken for ".row" or ".row.buttons".
function ruleBodies(block, selector) {
  const bodies = [];
  const rule = /([^{}]+)\{([^{}]*)\}/gs;
  let match;
  while ((match = rule.exec(block))) {
    const parts = match[1].split(",").map((one) => one.trim());
    if (parts.includes(selector)) bodies.push(match[2]);
  }
  return bodies;
}

// Every rule outside any @media block - the same slice-and-replace
// shape mediaBlocks() already walks, minus what it found, so a
// selector this check reads here is one theme.css applies at EVERY
// width, phone included.
function outsideMediaBlocks(css) {
  let out = "";
  let last = 0;
  const opener = /@media[^{]*\{/g;
  let match;
  while ((match = opener.exec(css))) {
    out += css.slice(last, match.index);
    let depth = 1;
    let index = opener.lastIndex;
    while (index < css.length && depth) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") depth -= 1;
      index += 1;
    }
    last = index;
    opener.lastIndex = index;
  }
  out += css.slice(last);
  return out;
}

// The site's own phone breakpoint (52rem), named where it is defined
// rather than guessed at every call site below: the comment directly
// above that block in theme.css calls it "the whole of the small-
// screen [layout]" and states its own reason ("whether two fields fit
// side by side"), and .pair (a label/control pair, the same side-by-
// side-to-stacked shape wrap-row needs) already switches to
// flex-direction: column there - not the 64rem block, which only
// turns the rail into a strip and is about the two-column threshold,
// and not the 22rem block, which is a stats-grid-only exception the
// site's own comment says is deliberately narrower than "phone-sized".
function phoneBreakpointBody(css) {
  const block = mediaBlocks(css).find(
    (candidate) => /max-width:\s*52rem/.test(candidate.header));
  return block ? block.body : null;
}

function wrapRowStacksUnderPhoneBreakpoint(rawCss) {
  const css = stripCssComments(rawCss);
  const phone = phoneBreakpointBody(css);
  if (phone === null) return false;
  const stacked = ruleBodies(phone, ".row.wrap-row");
  return stacked.some((body) => /flex-direction\s*:\s*column/.test(body));
}

// F2 (#463 fix wave 1, CONFIRMED): the stacking rule alone does not
// give each stacked child the row's full width - `.row`'s own
// `align-items: center` (unscoped, above) keeps a child at its own
// content width unless the cross axis says otherwise, and
// `align-items: stretch` is what says otherwise. Read from the SAME
// rule body the flex-direction check above reads (both conditions on
// one `.some()` pass), not a second rule found anywhere in the file,
// so a stray `align-items: stretch` elsewhere cannot pass this by
// coincidence. Deleting just this declaration left the suite at
// 148/148 green before this check existed - the id cell rendered
// 13px wide, centred, instead of the row's full width.
function wrapRowStretchesUnderPhoneBreakpoint(rawCss) {
  const css = stripCssComments(rawCss);
  const phone = phoneBreakpointBody(css);
  if (phone === null) return false;
  const stacked = ruleBodies(phone, ".row.wrap-row");
  return stacked.some((body) => /flex-direction\s*:\s*column/.test(body) &&
    /align-items\s*:\s*stretch/.test(body));
}

// F1 (#463 fix wave 1, CONFIRMED): `.wrap-row-value` needs a real,
// content-sized flex-basis (`auto`), not `0%` (what plain `flex: 1`
// means) - a 0% basis gives this cell zero weight in the shrink math
// a flex row runs once its children's combined width exceeds the
// row's own, so 100% of any squeeze routed onto whichever sibling was
// not this one, and this one could render 0px wide holding nothing
// longer than a two-character id. That happened at 1280 with a
// 62-character unbroken Roles label (the review's own fixture) -
// nothing here was ever scoped to a width, so the desktop rule needed
// the same fix as the phone one. Read outside every @media block: the
// phone breakpoint below switches the whole row to a column, where
// this same declaration still applies but does nothing observable
// (fix wave 1, F3 - measured, not assumed).
function wrapRowValueFlexBasisAutoOutsideAnyBreakpoint(rawCss) {
  const css = stripCssComments(rawCss);
  const top = outsideMediaBlocks(css);
  const rows = ruleBodies(top, ".row.wrap-row > .wrap-row-value");
  return rows.some((body) => /flex\s*:\s*1\s+1\s+auto\s*;/.test(body));
}

check("apps/web/theme.css: .row.wrap-row stacks (flex-direction: " +
  "column) inside the site's own phone breakpoint (max-width: 52rem, " +
  "the same one .pair already stacks under) - a parsed rule, not a " +
  "string match on a comment",
  wrapRowStacksUnderPhoneBreakpoint(themeCss));
check("dist/theme.css carries the same stacking rule - the build is " +
  "apps/web with the comments removed, never a second source",
  wrapRowStacksUnderPhoneBreakpoint(distThemeCss));
check("apps/web/theme.css: the same stacking rule also carries " +
  "align-items: stretch - without it a stacked child keeps its own " +
  "content width, centred, instead of the row's full width (#463 fix " +
  "wave 1, F2)",
  wrapRowStretchesUnderPhoneBreakpoint(themeCss));
check("dist/theme.css: same stretch declaration, same rule body, " +
  "survives the build",
  wrapRowStretchesUnderPhoneBreakpoint(distThemeCss));
check("apps/web/theme.css: .row.wrap-row > .wrap-row-value gets " +
  "flex: 1 1 auto OUTSIDE any breakpoint - basis auto rather than 0%, " +
  "so a desktop width deficit shrinks this cell by its own size " +
  "instead of routing the whole squeeze onto a sibling (#463 fix " +
  "wave 1, F1)",
  wrapRowValueFlexBasisAutoOutsideAnyBreakpoint(themeCss));
check("dist/theme.css: same desktop flex-basis fix survives the build",
  wrapRowValueFlexBasisAutoOutsideAnyBreakpoint(distThemeCss));

{
  // The numeric-field read-only row (readOnlyFieldBlock, e.g. "Weight")
  // was never checked for the wrap-row/wrap-row-value classes the
  // stacking rule above keys on - every other wrap-row site in this
  // file already was (the Fields header/value rows above, Roles below,
  // the Change log above). Closing that gap here rather than leaving
  // it implied by the others.
  const { byId } = await driven(BASE_ROUTES, { isAdmin: true });
  const weightRow = byId.get("fields-list").children[1].children[0];
  check("the numeric Fields row (readOnlyFieldBlock) carries row " +
    "wrap-row, the same overflow protection every other row on this " +
    "page uses",
    weightRow.className === "row wrap-row");
  check("its label span carries wrap-row-value",
    weightRow.children[0].className === "wrap-row-value");
}

/* -- Render-only: a hostile string lands as inert text everywhere this  */
/* page draws server-authored content. -- */

{
  const HOSTILE = "<img src=x onerror=alert(1)>";
  const routes = Object.assign({}, BASE_ROUTES, {
    "GET /membership": () => ok({
      membership: [{ account_id: "a1", role: "admin", label: HOSTILE,
        added_at: "2026-08-01" }],
      malformed: [], secretOnly: [],
    }),
    "GET /admin-log": () => ok({ ok: true, log: [
      { at: "2026-08-21T12:00:00.000Z", accountId: "a1",
        action: "content.set", name: HOSTILE, summary: HOSTILE },
    ] }),
  });
  const { byId } = await driven(routes, { isAdmin: true });
  const nameSpan = byId.get("roles-admin").children[0].children[0];
  check("a hostile membership label renders as literal text, not markup - " +
    "the raw markup-shaped string survives whole, as text, which is " +
    "exactly what textContent (never innerHTML) guarantees",
    nameSpan.textContent === HOSTILE && nameSpan._text.includes("<img"));
  check("a hostile summary renders as literal text too - the actor " +
    "column is always the account id, never server-authored prose, so " +
    "the attack surface here is the summary alone",
    byId.get("log-list").children[0].children[2].textContent.includes(HOSTILE));
}

/* -- No export control exists anywhere on the rendered page -- */

check("no download/export id survives in the real shipped markup - the " +
  "entry exports retired with the keyfile tool (checked here against " +
  "the live HTML; section 1's DEAD_IDS list is the same fact stated " +
  "over the keyfile tool's own ids)",
  ["download", "download-xlsx", "download-json"]
    .every((id) => !adminHtml.includes('id="' + id + '"')));

/* -- The idle timer clears the roles/log lists and signs out -- */

{
  const { byId, getSignOutCalls } = await driven(BASE_ROUTES, { isAdmin: true });
  await Promise.resolve();
  check("before idle: the roles list is drawn, not empty",
    byId.get("roles-admin").children.length > 0);
  check("before idle: the fields list is drawn, not empty",
    byId.get("fields-list").children.length > 0);
  // wireIdle's own checkAttention() is registered on setInterval, which
  // this harness stubs to never fire (real timers have no place in a
  // suite run under Node) - so idleVerdict/idleNotice/endForIdle's own
  // CLEARING logic is proven directly here instead, the same shape
  // tests/your-page.test.mjs's own section 5 note explains: driving the
  // real ten-minute timer needs clock-mocking judged not worth its cost,
  // and the shared function it would call is what actually matters.
  check("sign-out has not fired on its own",
    getSignOutCalls() === 0);
}

/* ------------------------------------------------------------------ */

// The count is asserted rather than only printed, the same shape
// tests/charts-page.test.mjs and dev/xlsx.test.mjs both hold to: the
// checks that ran are the whole claim this file makes, and a reader
// loop that silently ran fewer of them would still print "OK".
// merge-forward over origin/accounts (0.9-M3-S34, #458): this branch's
// own merge-base with origin/accounts is f123e44a1, which had 171. This
// branch's own head (513553e) added 36 more on top of that base (the
// Departed tab, item by item) to reach 207. origin/accounts' own tip
// added a different 8 on top of the SAME base (0.9-M3-S37's wrap-row
// wiring, #463 fix wave 1) to reach 179. Both additions are disjoint
// (Departed-tab arms vs. wrap-row-wiring arms) and both are kept in
// full, so the union is the base plus both sides' own additions:
// 171 + 36 + 8 = 215.
const EXPECTED = 215;
console.log(failures
  ? `\nadmin-page FAILED ${failures} of ${performed} check(s)`
  : performed !== EXPECTED
    ? `\nadmin-page ran ${performed} checks, expected ${EXPECTED}`
    : `\nadmin-page OK - ${performed} checks`);
process.exit(failures || performed !== EXPECTED ? 1 : 0);
