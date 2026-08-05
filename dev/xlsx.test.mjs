/*
 * Checks for apps/web/xlsx.js.
 *
 *     node dev/xlsx.test.mjs
 *
 * A spreadsheet is the one export with a pass/fail that nobody can
 * squint at. A CSV with a quoting bug still opens and is quietly wrong;
 * an .xlsx with a bad checksum, a truncated central directory or an
 * unescapable character does not open at all, and the message a
 * keyholder gets is that the file is corrupt - which tells them nothing
 * about which of those it was.
 *
 * So the last section reads the archive back: it walks the central
 * directory, extracts each part, and re-checks every CRC. That is a ZIP
 * reader written to check a ZIP writer, which is worth it here because
 * the alternative is finding out in Excel, on a machine, by hand.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));

const load = async (path) => {
  const src = await readFile(HERE(path), "utf8");
  await import("data:text/javascript," + encodeURIComponent(src));
};

await load("../apps/web/xlsx.js");
await load("../apps/web/admin.js");

const { build, crc32, columnName, escapeXml, cellXml, sheetXml } =
  globalThis.BinderXlsx;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let failures = 0;
const results = [];

async function check(label, fn) {
  let ok = false;
  let note = "";
  try {
    ok = (await fn()) === true;
    if (!ok) note = "returned false";
  } catch (error) {
    note = "threw: " + (error && error.message ? error.message : error);
  }
  if (!ok) failures++;
  results.push([ok, label, note]);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/* ------------------------------------------------------------------ */
/* CRC32. The checksum a reader uses to decide the file is damaged.    */

/* The standard vector. If this is wrong every archive is rejected, and
 * the only symptom is "the file is corrupt". */
await check("CRC32 matches the known value for a known string", () =>
  crc32(encoder.encode("123456789")) === 0xcbf43926);

await check("CRC32 of nothing is zero", () =>
  crc32(new Uint8Array(0)) === 0);

await check("CRC32 changes when one byte does", () =>
  crc32(encoder.encode("hello")) !== crc32(encoder.encode("hellp")));

/* ------------------------------------------------------------------ */
/* Column names. Bijective base-26, which is where off-by-ones live.   */

await check("the first columns are A through Z", () =>
  columnName(0) === "A" && columnName(25) === "Z");

/* The boundary. Base-26 with no zero digit means 26 is AA, not BA -
 * and an export with eighteen columns is close enough to Z that this
 * is reachable rather than theoretical. */
await check("column 26 is AA, not BA", () =>
  columnName(26) === "AA" && columnName(27) === "AB");

await check("the second wrap is right too", () =>
  columnName(51) === "AZ" && columnName(52) === "BA" &&
  columnName(701) === "ZZ" && columnName(702) === "AAA");

/* ------------------------------------------------------------------ */
/* Escaping.                                                           */

await check("the five XML entities are escaped", () =>
  escapeXml("a&b<c>d\"e'f") === "a&amp;b&lt;c&gt;d&quot;e&apos;f");

/*
 * A control character cannot be represented in XML 1.0 at all - not as
 * an entity, not escaped. One in a cell does not corrupt that cell, it
 * makes the whole workbook unopenable, so they are dropped.
 */
await check("illegal control characters are dropped", () => {
  // Built from codes rather than typed literally - a test file
  // containing raw control bytes is a test file that does not survive
  // being edited, which is how this was found.
  const nul = String.fromCharCode(0);
  const bell = String.fromCharCode(7);
  const vtab = String.fromCharCode(11);
  return escapeXml("a" + nul + "b" + bell + "c" + vtab + "d") === "abcd";
});

await check("the three legal control characters survive", () =>
  escapeXml("a\tb\nc\rd") === "a\tb\nc\rd");

/* ------------------------------------------------------------------ */
/* Cells. The reason this file exists rather than only the CSV.        */

await check("a number becomes a numeric cell", () =>
  cellXml(90.7, "E2") === '<c r="E2"><v>90.7</v></c>');

await check("a string becomes an inline string cell", () =>
  cellXml("somehandle", "D2") ===
    '<c r="D2" t="inlineStr"><is><t xml:space="preserve">somehandle</t></is></c>');

/* A digit string is not a number. Telegram handles are text, and a
 * handle of "12345" becoming the number 12345 loses its leading zeros
 * and its meaning. */
await check("a numeric-looking string stays a string", () =>
  cellXml("012345", "D2").includes('t="inlineStr"'));

await check("an empty value gets no cell at all", () =>
  cellXml("", "A1") === "" && cellXml(null, "A1") === "" &&
  cellXml(undefined, "A1") === "");

/*
 * The formula guard is deliberately absent here, and this is the check
 * that says so on purpose rather than by omission. A cell typed as an
 * inline string is a string: a formula lives in an <f> element and this
 * never writes one. The CSV needs its leading apostrophe; adding one
 * here would put a literal apostrophe in the cell.
 */
await check("a formula-looking value is a string, not defused", () => {
  const cell = cellXml('=HYPERLINK("http://evil.example/")', "D2");
  return cell.includes('t="inlineStr"') && !cell.includes("'=") &&
    !cell.includes("<f>") && cell.includes("=HYPERLINK");
});

/* Excel drops leading and trailing spaces without it. */
await check("whitespace is preserved", () =>
  cellXml(" padded ", "A1").includes('xml:space="preserve"'));

/* ------------------------------------------------------------------ */
/* The sheet.                                                          */

await check("the header is row 1 and data starts at row 2", () => {
  const xml = sheetXml(["id", "name"], [[1, "x"]]);
  return xml.includes('<row r="1">') && xml.includes('<c r="A1"') &&
    xml.includes('<row r="2">') && xml.includes('<c r="A2"><v>1</v></c>');
});

/* Eighteen columns of numbers are unreadable once their names scroll
 * off, which on this export happens immediately. */
await check("the header row is frozen", () => {
  const xml = sheetXml(["a"], []);
  return xml.includes('state="frozen"') && xml.includes('ySplit="1"');
});

await check("a sheet with no rows is still a sheet", () => {
  const xml = sheetXml(["a", "b"], []);
  return xml.includes("<sheetData>") && xml.includes("</sheetData>") &&
    xml.includes('<row r="1">');
});

/* ------------------------------------------------------------------ */
/* The archive, read back.                                             */

/*
 * A minimal ZIP reader. It walks the end-of-central-directory record to
 * the central directory, then each entry to its local header and data.
 * Stored entries only, which is all this writer produces.
 */
function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The EOCD is last, and has no length field of its own to find it by.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("no end-of-central-directory record");

  const count = view.getUint16(eocd + 10, true);
  const size = view.getUint32(eocd + 12, true);
  let at = view.getUint32(eocd + 16, true);

  const entries = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) {
      throw new Error("central directory entry " + i + " has a bad signature");
    }
    const storedCrc = view.getUint32(at + 16, true);
    const compressed = view.getUint32(at + 20, true);
    const uncompressed = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen));

    if (view.getUint32(offset, true) !== 0x04034b50) {
      throw new Error(name + " has a bad local header signature");
    }
    const localNameLen = view.getUint16(offset + 26, true);
    const localExtraLen = view.getUint16(offset + 28, true);
    const start = offset + 30 + localNameLen + localExtraLen;
    const data = bytes.subarray(start, start + compressed);

    entries.push({
      name: name,
      data: data,
      storedCrc: storedCrc,
      declaredSize: uncompressed,
      method: view.getUint16(at + 10, true),
      flags: view.getUint16(at + 8, true),
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return { entries: entries, centralSize: size, centralCount: count };
}

const COLUMNS = globalThis.BinderAdmin.COLUMNS;
const ROWS = [
  [1, "2026-08-05T00:00:00.000Z", "2026-08-05T00:00:00.000Z", "somehandle",
   90.7, 200, 177.8, 70, 5, 10, "imperial", "200 lb", "5 ft 10 in",
   "male", "feedee;gainer", "US", "yes", 1],
  [2, "2026-08-05T00:00:00.000Z", "", '=cmd|calc', "", "", "", "", "", "",
   "", "", "", "", "", "", "", 1],
];
const FILE = build(COLUMNS, ROWS, "Submissions", Date.UTC(2026, 7, 5, 12, 0, 0));

await check("the archive holds the five parts an xlsx needs", () => {
  const names = unzip(FILE).entries.map((e) => e.name).sort();
  return same(names, [
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/_rels/workbook.xml.rels",
    "xl/workbook.xml",
    "xl/worksheets/sheet1.xml",
  ]);
});

/* The check a reader actually performs before showing anything. */
await check("every part's CRC matches its bytes", () =>
  unzip(FILE).entries.every((e) => crc32(e.data) === e.storedCrc));

await check("every part's declared length matches its bytes", () =>
  unzip(FILE).entries.every((e) => e.data.length === e.declaredSize));

await check("every part is stored rather than claiming compression", () =>
  unzip(FILE).entries.every((e) => e.method === 0));

await check("filenames are flagged UTF-8", () =>
  unzip(FILE).entries.every((e) => (e.flags & 0x0800) !== 0));

/* The central directory's own bookkeeping. A reader uses these to find
 * the entries at all, so being off by one byte is a file that does not
 * open rather than one that opens wrong. */
await check("the central directory's count and size are right", () => {
  const read = unzip(FILE);
  // 46 fixed bytes per header plus the name; no extra field and no
  // comment. A record that overstates this walks a strict reader off
  // the end of the archive, and this caught exactly that.
  const expected = read.entries.reduce(
    (n, e) => n + 46 + encoder.encode(e.name).length, 0);
  return read.centralCount === 5 && read.centralSize === expected;
});

await check("the sheet inside survives the round trip", () => {
  const sheet = unzip(FILE).entries
    .filter((e) => e.name === "xl/worksheets/sheet1.xml")[0];
  const xml = decoder.decode(sheet.data);
  return xml.includes("<v>90.7</v>") &&
    xml.includes(">somehandle<") &&
    xml.includes("&lt;") === false &&        // nothing here needed escaping
    xml.includes("=cmd|calc");
});

/* Same input, same bytes - which is what makes the timestamp a
 * parameter rather than a call to Date.now(). */
await check("the same input produces the same file", () => {
  const again = build(COLUMNS, ROWS, "Submissions",
    Date.UTC(2026, 7, 5, 12, 0, 0));
  return same(Array.from(FILE), Array.from(again));
});

/* A ZIP timestamp cannot express a date before 1980, and the underflow
 * would be silent. */
await check("a pre-1980 timestamp is clamped rather than wrapped", () => {
  const old = build(["a"], [["b"]], "S", Date.UTC(1970, 0, 1));
  return unzip(old).entries.length === 5;
});

/* Excel rejects a workbook whose sheet name breaks its rules; it does
 * not trim for you. */
await check("an illegal sheet name is cleaned rather than passed through",
  () => {
    const bytes = build(["a"], [], "a/b:c*d[e]f");
    const book = unzip(bytes).entries
      .filter((e) => e.name === "xl/workbook.xml")[0];
    const xml = decoder.decode(book.data);
    return !/name="[^"]*[:\\/?*[\]]/.test(xml);
  });

await check("a very long sheet name is cut to what Excel accepts", () => {
  const bytes = build(["a"], [], "x".repeat(60));
  const book = unzip(bytes).entries
    .filter((e) => e.name === "xl/workbook.xml")[0];
  const name = /name="([^"]*)"/.exec(decoder.decode(book.data))[1];
  return name.length === 31;
});

await check("an empty export is still a valid workbook", () => {
  const bytes = build(COLUMNS, [], "Submissions");
  const read = unzip(bytes);
  return read.entries.length === 5 &&
    read.entries.every((e) => crc32(e.data) === e.storedCrc);
});

/* ------------------------------------------------------------------ */

for (const [ok, label, note] of results) {
  console.log((ok ? "  ok   " : "  FAIL ") + label + (note ? " - " + note : ""));
}
console.log(
  failures === 0
    ? "\nxlsx.js OK - " + results.length + " checks"
    : "\nxlsx.js FAILED " + failures + " of " + results.length + " checks");

process.exit(failures === 0 ? 0 : 1);
