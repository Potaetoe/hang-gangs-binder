/*
 * A spreadsheet file, built by hand.
 *
 * An .xlsx is a ZIP of XML parts, and this writes both - about a
 * hundred and fifty lines of format rather than a dependency, for the
 * same reason crypto.js composes ECIES itself and dashboard.js draws
 * its own charts: admin.html runs under `default-src 'none'; script-src
 * 'self'` and is the one page where every submission exists in the
 * clear at once. A library loaded here would see the whole corpus, and
 * the CSP forbids the CDN it would come from anyway.
 *
 * Nothing here is compressed. ZIP's "stored" method is a length and a
 * checksum around the bytes, which removes the only part of the format
 * that would have been genuinely hard. An export of a few hundred rows
 * is a few hundred kilobytes; a keyholder downloading it once does not
 * care, and DEFLATE would have been the piece most likely to be subtly
 * wrong.
 *
 *   const bytes = BinderXlsx.build(COLUMNS, rows, "Submissions", now);
 *
 * Pure: bytes in, bytes out, no DOM and no clock beyond the one passed
 * in. dev/xlsx.test.mjs loads this exact file under Node and reads the
 * archive back out.
 *
 * Why this exists beside the CSV, rather than instead of it: the CSV is
 * text that anything can read and is the right default. What it cannot
 * carry is the difference between the number 90.7 and the characters
 * "90.7", so every consumer has to guess, and a spreadsheet guessing
 * about a column of Telegram handles is where "5e10" becomes a float.
 * Here a number is a number and a string is a string, because the
 * format has somewhere to say so.
 */
(function (root) {
  "use strict";

  const encoder = new TextEncoder();

  /* ---------------------------------------------------------------- */
  /* XML.                                                              */

  /*
   * The five predefined entities, and control characters removed.
   *
   * XML 1.0 cannot represent most control characters at all - not as an
   * entity, not escaped, not anywhere - so a stray one does not produce
   * a mangled cell, it produces a file the spreadsheet refuses to open
   * with a message about the whole document being corrupt. Tab, newline
   * and carriage return are the three that are legal and are kept.
   *
   * Nothing the form accepts contains one. A record is whatever
   * arrived, which is the same reason admin.js defuses CSV formulas.
   */
  function stripControls(text) {
    let out = "";
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      // Tab, newline and carriage return are the only control
      // characters XML 1.0 can represent. Written as codes rather than
      // a character class because a source file containing literal
      // control bytes is a source file that does not survive being
      // edited.
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) continue;
      out += text.charAt(i);
    }
    return out;
  }

  function escapeXml(value) {
    return stripControls(String(value))
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  /* 0 -> A, 25 -> Z, 26 -> AA. Spreadsheet columns are bijective
   * base-26, which is not quite base-26: there is no zero digit. */
  function columnName(index) {
    let name = "";
    let n = index;
    while (n >= 0) {
      name = String.fromCharCode(65 + (n % 26)) + name;
      n = Math.floor(n / 26) - 1;
    }
    return name;
  }

  /*
   * One cell.
   *
   * A number becomes a numeric cell and everything else becomes an
   * inline string. That distinction is the entire reason this file
   * exists - see the header - and it is why the CSV's formula guard is
   * deliberately NOT applied here. A cell typed as a string is a
   * string: Excel shows `=1+1` rather than evaluating it, because a
   * formula lives in an <f> element and this never writes one. Adding
   * the CSV's leading apostrophe would put a literal apostrophe in the
   * cell, which is the bug that guard exists to avoid the appearance
   * of.
   *
   * An empty value gets no cell at all rather than an empty one. A
   * sheet is a sparse grid, so a missing cell is the format's own way
   * of saying "nothing here", and it keeps a blank from being a value
   * somebody can sort on.
   */
  function cellXml(value, reference) {
    if (value === null || value === undefined || value === "") return "";

    if (typeof value === "number" && Number.isFinite(value)) {
      return '<c r="' + reference + '"><v>' + value + "</v></c>";
    }

    return '<c r="' + reference + '" t="inlineStr"><is><t xml:space="preserve">' +
      escapeXml(value) + "</t></is></c>";
  }

  function sheetXml(columns, rows) {
    const parts = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
      // The header stays put while the rows scroll. Eighteen columns of
      // numbers are unreadable the moment their names leave the screen.
      '<sheetViews><sheetView workbookViewId="0">',
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>',
      "</sheetView></sheetViews>",
      "<sheetData>",
    ];

    parts.push('<row r="1">');
    columns.forEach(function (name, index) {
      parts.push(cellXml(String(name), columnName(index) + "1"));
    });
    parts.push("</row>");

    rows.forEach(function (row, rowIndex) {
      const r = rowIndex + 2;               // 1-based, and row 1 is the header
      parts.push('<row r="' + r + '">');
      row.forEach(function (value, index) {
        parts.push(cellXml(value, columnName(index) + r));
      });
      parts.push("</row>");
    });

    parts.push("</sheetData></worksheet>");
    return parts.join("");
  }

  /*
   * The four parts around the sheet. All fixed except the sheet's name,
   * which is why they are functions of almost nothing.
   *
   * A sheet name has its own rules, older than XML and stricter: at
   * most 31 characters, and none of : \ / ? * [ ]. Excel rejects the
   * workbook rather than trimming, so this trims.
   */
  function sheetName(name) {
    const cleaned = String(name || "Sheet1").replace(/[:\\/?*[\]]/g, " ");
    return escapeXml(cleaned.slice(0, 31) || "Sheet1");
  }

  const CONTENT_TYPES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    "</Types>";

  const ROOT_RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>";

  const WORKBOOK_RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    "</Relationships>";

  function workbookXml(name) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' + sheetName(name) + '" sheetId="1" r:id="rId1"/></sheets>' +
      "</workbook>";
  }

  /* ---------------------------------------------------------------- */
  /* ZIP.                                                              */

  const CRC_TABLE = (function () {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  /* A growable little-endian byte writer. ZIP is little-endian
   * throughout, which is the one thing about it that never varies. */
  function writer() {
    let bytes = [];
    return {
      u8: function (v) { bytes.push(v & 0xff); return this; },
      u16: function (v) {
        bytes.push(v & 0xff, (v >>> 8) & 0xff);
        return this;
      },
      u32: function (v) {
        bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff,
          (v >>> 24) & 0xff);
        return this;
      },
      raw: function (arr) {
        for (let i = 0; i < arr.length; i++) bytes.push(arr[i]);
        return this;
      },
      length: function () { return bytes.length; },
      done: function () { return new Uint8Array(bytes); },
    };
  }

  /*
   * MS-DOS date and time, which is what ZIP records and which is why
   * archives cannot describe anything before 1980 or resolve better
   * than two seconds. Clamped rather than allowed to underflow into a
   * date the format cannot express.
   */
  function dosDateTime(now) {
    const d = new Date(now);
    const year = Math.max(1980, d.getFullYear());
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) |
        (Math.floor(d.getSeconds() / 2) & 0x1f),
      date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }

  // Bit 11 of the general purpose flags: the filename is UTF-8. Every
  // name here is ASCII, so nothing depends on it - but a reader that
  // guesses an encoding for a name it was told nothing about is a
  // reader that can guess wrong, and saying so costs one bit.
  const UTF8_NAMES = 0x0800;

  function zip(files, now) {
    const stamp = dosDateTime(now);
    const out = writer();
    const central = [];

    files.forEach(function (file) {
      const name = encoder.encode(file.name);
      const data = typeof file.data === "string"
        ? encoder.encode(file.data) : file.data;
      const sum = crc32(data);
      const offset = out.length();

      out.u32(0x04034b50)      // local file header
        .u16(20)               // version needed: 2.0, which is "stored"
        .u16(UTF8_NAMES)
        .u16(0)                // method 0: stored, no compression
        .u16(stamp.time).u16(stamp.date)
        .u32(sum)
        .u32(data.length)      // compressed - the same, nothing was compressed
        .u32(data.length)
        .u16(name.length).u16(0)
        .raw(name).raw(data);

      central.push({ name: name, sum: sum, size: data.length, offset: offset });
    });

    const centralStart = out.length();
    central.forEach(function (entry) {
      out.u32(0x02014b50)      // central directory header
        .u16(20).u16(20)
        .u16(UTF8_NAMES)
        .u16(0)
        .u16(stamp.time).u16(stamp.date)
        .u32(entry.sum)
        .u32(entry.size).u32(entry.size)
        .u16(entry.name.length).u16(0).u16(0)
        .u16(0).u16(0)
        .u32(0)                // external attributes: none, this is not a file system
        .u32(entry.offset)
        .raw(entry.name);
    });

    // Measured before a single byte of the record is written. Taking
    // out.length() inline would count the twelve bytes of the record
    // already emitted by the time the argument is evaluated, and a
    // central directory that claims to be longer than it is runs a
    // strict reader off the end of the archive. The file still opens in
    // tolerant readers, which is what makes it worth a test.
    const centralSize = out.length() - centralStart;

    out.u32(0x06054b50)        // end of central directory
      .u16(0).u16(0)
      .u16(central.length).u16(central.length)
      .u32(centralSize)
      .u32(centralStart)
      .u16(0);

    return out.done();
  }

  /* ---------------------------------------------------------------- */

  /*
   * Column names, rows of values, and a name for the sheet. `now` is a
   * parameter rather than a call to Date.now() so a test can assert on
   * fixed bytes - the archive records a timestamp, and without this the
   * same input would produce a different file every second.
   */
  function build(columns, rows, name, now) {
    return zip([
      { name: "[Content_Types].xml", data: CONTENT_TYPES },
      { name: "_rels/.rels", data: ROOT_RELS },
      { name: "xl/workbook.xml", data: workbookXml(name) },
      { name: "xl/_rels/workbook.xml.rels", data: WORKBOOK_RELS },
      { name: "xl/worksheets/sheet1.xml", data: sheetXml(columns, rows) },
    ], now === undefined ? Date.now() : now);
  }

  root.BinderXlsx = {
    build: build,
    // Exported for the tests. Each is a place this can be wrong without
    // throwing: a bad checksum, a column past Z, an unescapable
    // character, or a number written as text.
    crc32: crc32,
    columnName: columnName,
    escapeXml: escapeXml,
    cellXml: cellXml,
    sheetXml: sheetXml,
  };
})(globalThis);
