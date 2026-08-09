

(function (root) {
  "use strict";

  const encoder = new TextEncoder();

   
   

  

  function stripControls(text) {
    let out = "";
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
       
       
       
       
       
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

  

  function columnName(index) {
    let name = "";
    let n = index;
    while (n >= 0) {
      name = String.fromCharCode(65 + (n % 26)) + name;
      n = Math.floor(n / 26) - 1;
    }
    return name;
  }

  

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
      const r = rowIndex + 2;                
      parts.push('<row r="' + r + '">');
      row.forEach(function (value, index) {
        parts.push(cellXml(value, columnName(index) + r));
      });
      parts.push("</row>");
    });

    parts.push("</sheetData></worksheet>");
    return parts.join("");
  }

  

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

  

  function writer() {
    const bytes = [];
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

  

  function dosDateTime(now) {
    const d = new Date(now);
    const year = Math.max(1980, d.getFullYear());
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) |
        (Math.floor(d.getSeconds() / 2) & 0x1f),
      date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }

   
   
   
   
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

      out.u32(0x04034b50)       
        .u16(20)                
        .u16(UTF8_NAMES)
        .u16(0)                 
        .u16(stamp.time).u16(stamp.date)
        .u32(sum)
        .u32(data.length)       
        .u32(data.length)
        .u16(name.length).u16(0)
        .raw(name).raw(data);

      central.push({ name: name, sum: sum, size: data.length, offset: offset });
    });

    const centralStart = out.length();
    central.forEach(function (entry) {
      out.u32(0x02014b50)       
        .u16(20).u16(20)
        .u16(UTF8_NAMES)
        .u16(0)
        .u16(stamp.time).u16(stamp.date)
        .u32(entry.sum)
        .u32(entry.size).u32(entry.size)
        .u16(entry.name.length).u16(0).u16(0)
        .u16(0).u16(0)
        .u32(0)                 
        .u32(entry.offset)
        .raw(entry.name);
    });

     
     
     
     
     
     
    const centralSize = out.length() - centralStart;

    out.u32(0x06054b50)         
      .u16(0).u16(0)
      .u16(central.length).u16(central.length)
      .u32(centralSize)
      .u32(centralStart)
      .u16(0);

    return out.done();
  }

   

  

  function build(columns, rows, name, now) {
    return zip([
      { name: "[Content_Types].xml", data: CONTENT_TYPES },
      { name: "_rels/.rels", data: ROOT_RELS },
      { name: "xl/workbook.xml", data: workbookXml(name) },
      { name: "xl/_rels/workbook.xml.rels", data: WORKBOOK_RELS },
      { name: "xl/worksheets/sheet1.xml", data: sheetXml(columns, rows) },
    ], now === undefined ? Date.now() : now);
  }

  root.BinderXlsx = Object.freeze({
    build: build,
     
     
     
    crc32: crc32,
    columnName: columnName,
    escapeXml: escapeXml,
    cellXml: cellXml,
    sheetXml: sheetXml,
  });
})(globalThis);
