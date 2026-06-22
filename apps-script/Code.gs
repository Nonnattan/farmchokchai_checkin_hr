const SPREADSHEET_ID = "1VxuvC0OwqQ_wlsQsjFq3y3XiTeh_CBCKXOf1iz_fGf4";
const LOGS_SHEET_NAME = "Logs";
const LOCATION_SHEET_NAME = "location";
const BANGKOK_TZ = "Asia/Bangkok";

const LOG_HEADERS = [
  "createdAt",
  "displayName",
  "email",
  "phone",
  "site",
  "session",
  "lat",
  "lng",
  "accuracy",
  "userId",
  "pictureUrl",
  "status",
];

const LOCATION_HEADERS = [
  "lat",
  "lng",
  "north",
  "south",
  "east",
  "west",
  "remark",
];

const DEFAULT_LOCATION = {
  lat: 13.968639,
  lng: 100.619861,
  north: 50,
  south: 50,
  east: 80,
  west: 50,
  remark: "อยู่ในกรอบสี่เหลี่ยมนี้เท่านั้นจึงจะเช็กอินได้",
};

/* ---------------- Entrypoints ---------------- */
function doGet(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};
    const action = String(params.action || "logs").toLowerCase();
    if (action === "location") return jsonOutput(getLocationResponse());
    return jsonOutput(getLogsResponse(params));
  } catch (err) {
    return jsonOutput({ ok: false, error: err.message || String(err) });
  }
}

function doPost(e) {
  try {
    const payload = parsePayload(e);
    const action = String(payload.action || payload.type || "").toLowerCase();
    if (action === "location") return jsonOutput(saveLocation(payload));
    return jsonOutput(saveLog(payload));
  } catch (err) {
    return jsonOutput({ ok: false, error: err.message || String(err) });
  }
}

/* ---------------- Save functions ---------------- */
function saveLog(payload) {
  const ss = openSpreadsheet();
  const sheet = getOrCreateLogsSheet(ss);

  const createdAtRaw =
    payload.createdAt || payload.time || new Date().toISOString();
  const createdAt = parseToDate(createdAtRaw);
  if (!createdAt) throw new Error("time is invalid");

  const createdAtDisplay = formatBangkokDateTime(createdAt);

  const displayName =
    String(payload.displayName || payload.name || "-").trim() || "-";
  const email = String(payload.email || "").trim();
  const phone = ""; // no longer collected from user
  const site = String(
    payload.site || payload.siteName || "Check-in Zone",
  ).trim();
  const session = String(payload.session || "").trim();
  const userId = String(payload.userId || "").trim();
  const pictureUrl = String(payload.pictureUrl || "").trim();
  const status = String(payload.status || "checked_in").trim();

  const lat = Number(payload.lat);
  const lng = Number(payload.lng);
  const accuracy =
    payload.accuracy !== undefined ? Number(payload.accuracy) : "";

  if (!Number.isFinite(lat) || !Number.isFinite(lng))
    throw new Error("lat/lng is required");

  // เขียนแถวตาม header ที่มีอยู่ (รองรับ legacy)
  const headers = getHeaderRow(sheet);
  const row = buildLogWriteRow(headers, {
    createdAtDisplay,
    displayName,
    email,
    phone,
    site,
    session,
    lat,
    lng,
    accuracy,
    userId,
    pictureUrl,
    status,
  });

  sheet.appendRow(row);
  SpreadsheetApp.flush();

  return { ok: true, message: "บันทึกข้อมูลสำเร็จ", time: createdAtDisplay };
}

function saveLocation(payload) {
  const ss = openSpreadsheet();
  const sheet = getOrCreateLocationSheet(ss);

  const lat = Number(payload.lat ?? payload.centerLat ?? DEFAULT_LOCATION.lat);
  const lng = Number(payload.lng ?? payload.centerLng ?? DEFAULT_LOCATION.lng);
  const north = Math.max(
    0,
    Number(payload.north ?? payload.northMeters ?? DEFAULT_LOCATION.north),
  );
  const south = Math.max(
    0,
    Number(payload.south ?? payload.southMeters ?? DEFAULT_LOCATION.south),
  );
  const east = Math.max(
    0,
    Number(payload.east ?? payload.eastMeters ?? DEFAULT_LOCATION.east),
  );
  const west = Math.max(
    0,
    Number(payload.west ?? payload.westMeters ?? DEFAULT_LOCATION.west),
  );
  const remark = String(
    payload.remark ?? payload.note ?? DEFAULT_LOCATION.remark,
  ).trim();

  if (sheet.getLastRow() > 1)
    sheet
      .getRange(2, 1, sheet.getLastRow() - 1, LOCATION_HEADERS.length)
      .clearContent();
  sheet
    .getRange(2, 1, 1, LOCATION_HEADERS.length)
    .setValues([[lat, lng, north, south, east, west, remark]]);
  SpreadsheetApp.flush();

  return {
    ok: true,
    message: "บันทึก location สำเร็จ",
    data: { lat, lng, north, south, east, west, remark },
  };
}

/* ---------------- Read location ---------------- */
function getLocationResponse() {
  const ss = openSpreadsheet();
  const sheet = getOrCreateLocationSheet(ss);
  const values = sheet.getDataRange().getValues();
  const displayValues = sheet.getDataRange().getDisplayValues();

  if (!values || values.length < 2)
    return { ok: true, data: { ...DEFAULT_LOCATION } };

  const row = values[1] || [];
  const dispRow = displayValues[1] || [];
  // ใช้ raw/disp ตามลำดับ
  return {
    ok: true,
    data: {
      lat: row[0] ?? dispRow[0] ?? DEFAULT_LOCATION.lat,
      lng: row[1] ?? dispRow[1] ?? DEFAULT_LOCATION.lng,
      north: row[2] ?? dispRow[2] ?? DEFAULT_LOCATION.north,
      south: row[3] ?? dispRow[3] ?? DEFAULT_LOCATION.south,
      east: row[4] ?? dispRow[4] ?? DEFAULT_LOCATION.east,
      west: row[5] ?? dispRow[5] ?? DEFAULT_LOCATION.west,
      remark: String(row[6] ?? dispRow[6] ?? DEFAULT_LOCATION.remark),
    },
  };
}

/* ---------------- Logs read / response ---------------- */
function getLogsResponse(params) {
  const tab = String(params.tab || "")
    .toLowerCase()
    .trim();
  const from = String(params.from || "").trim();
  const to = String(params.to || "").trim();
  const offset = Math.max(0, parseInt(params.offset || 0, 10));
  const limit = Math.max(1, Math.min(parseInt(params.limit || 15, 10), 5000));
  const exportMode =
    String(params.export || "").toLowerCase() === "1" ||
    String(params.mode || "").toLowerCase() === "export";

  const rows = getAllLogRows();
  const filtered = filterRows(rows, { tab, from, to });

  const total = filtered.length;
  const selected = exportMode
    ? filtered.slice(0, 10000)
    : filtered.slice(offset, offset + limit);

  return {
    ok: true,
    data: selected,
    meta: {
      total: total,
      offset: offset,
      limit: selected.length,
      hasMore: !exportMode && offset + selected.length < total,
      tab: tab || (from && to ? "range" : "today"),
      from: from,
      to: to,
      export: exportMode,
    },
  };
}

/* ---------------- Read all rows and parse ---------------- */
function getAllLogRows() {
  const ss = openSpreadsheet();
  const sheet = getOrCreateLogsSheet(ss);

  const values = sheet.getDataRange().getValues();
  const displayValues = sheet.getDataRange().getDisplayValues();
  if (!values || values.length === 0) return [];

  const firstDisplayRow = displayValues[0] || [];
  const looksLikeHeader = isHeaderRow(firstDisplayRow);
  const headers = looksLikeHeader ? firstDisplayRow.map(String) : [];
  const normalizedHeaders = headers.map(normalizeHeader);

  const startRow = looksLikeHeader ? 1 : 0;
  const result = [];

  for (let i = startRow; i < values.length; i++) {
    const rawRow = values[i] || [];
    const dispRow = displayValues[i] || [];

    if (!rawRow.some((c) => c !== "" && c !== null)) continue;

    const parsed = parseAnyLogRow(
      rawRow,
      dispRow,
      normalizedHeaders,
      looksLikeHeader,
    );

    // ถ้าไม่มี createdAtKey ให้พยายามเดาจาก display หรือ raw (แต่ไม่ข้ามแถว)
    if (!parsed.createdAtKey || String(parsed.createdAtKey).trim() === "") {
      const guessed = guessDateKeyFromRow(dispRow, rawRow);
      parsed.createdAtKey = guessed || formatBangkokDateKey(new Date(0));
      if (!parsed.createdAtDisplay) parsed.createdAtDisplay = "";
    }

    result.push({
      id: String(i + 1),
      _sortKey: parsed.createdAtKey || "",
      _rowIndex: i,
      createdAt: parsed.createdAtDisplay || "",
      time: parsed.createdAtDisplay || "",
      createdAtKey: parsed.createdAtKey || "",
      displayName: parsed.displayName || "-",
      name: parsed.displayName || "-",
      email: parsed.email || "",
      phone: parsed.phone || "",
      site: parsed.site || "",
      session: parsed.session || "",
      lat: parsed.lat,
      lng: parsed.lng,
      accuracy: parsed.accuracy,
      userId: parsed.userId || "",
      pictureUrl: parsed.pictureUrl || "",
      status: parsed.status || "checked_in",
    });
  }

  // เรียงจากใหม่ -> เก่า โดยใช้ _sortKey (yyyy-MM-dd) แล้ว fallback เป็น row index
  result.sort((a, b) => {
    if (b._sortKey !== a._sortKey) return b._sortKey.localeCompare(a._sortKey);
    return b._rowIndex - a._rowIndex;
  });

  return result;
}

/* ---------------- Parsing a row ----------------
   - ใช้ display (disp) เป็นแหล่งข้อมูลแรกสำหรับ createdAtDisplay และ createdAtKey
   - ถ้าไม่มี display จะ fallback ไป raw
*/
function parseAnyLogRow(rawRow, dispRow, normalizedHeaders, hasHeader) {
  const raw = Array.isArray(rawRow) ? rawRow : [];
  const disp = Array.isArray(dispRow) ? dispRow : [];

  function idx(aliases) {
    for (let i = 0; i < aliases.length; i++) {
      const found = normalizedHeaders.indexOf(normalizeHeader(aliases[i]));
      if (found >= 0) return found;
    }
    return -1;
  }

  // แก้ไขดึงข้อมูลให้ปลอดภัยยิ่งขึ้น ป้องกัน index เกินขนาดอาร์เรย์
  function getDisplay(index) {
    if (index < 0 || index >= disp.length) return "";
    const d = disp[index];
    return d !== undefined && d !== null && String(d).trim() !== ""
      ? String(d).trim()
      : "";
  }

  function getRaw(index) {
    if (index < 0 || index >= raw.length) return "";
    const r = raw[index];
    return r !== undefined && r !== null && String(r).trim() !== "" ? r : "";
  }

  function dateKeyFromIndexPreferDisplay(index) {
    const dispVal = getDisplay(index);
    if (dispVal) {
      const dt = parseToDate(dispVal);
      if (dt) return formatBangkokDateKey(dt);
    }
    const rawVal = getRaw(index);
    if (rawVal) {
      const dt2 = parseToDate(rawVal);
      if (dt2) return formatBangkokDateKey(dt2);
    }
    return "";
  }

  if (hasHeader) {
    const createdAtIdx = idx([
      "createdAt",
      "time",
      "timestamp",
      "date",
      "datetime",
      "เวลา",
    ]);
    const nameIdx = idx([
      "displayName",
      "name",
      "fullname",
      "user",
      "username",
      "ชื่อจากline",
      "ชื่อ",
    ]);
    const emailIdx = idx(["email", "อีเมล"]);
    const phoneIdx = idx(["phone", "tel", "telephone"]);
    const siteIdx = idx(["site", "sitename", "location", "ไซต์"]);
    const sessionIdx = idx(["session"]);
    const latIdx = idx(["lat", "latitude"]);
    const lngIdx = idx(["lng", "lon", "longitude"]);
    const accuracyIdx = idx(["accuracy"]);
    const userIdIdx = idx(["userId", "userid", "id"]);
    const pictureUrlIdx = idx(["pictureUrl", "picture", "photo", "avatar"]);
    const statusIdx = idx(["status", "สถานะ"]);

    const createdAtDisplay =
      getDisplay(createdAtIdx) || getRaw(createdAtIdx) || "";
    const createdAtKey =
      dateKeyFromIndexPreferDisplay(createdAtIdx) ||
      guessDateKeyFromRow(disp, raw);

    return {
      createdAtDisplay: createdAtDisplay,
      createdAtKey: createdAtKey,
      displayName: getDisplay(nameIdx) || getRaw(nameIdx) || "-",
      email: getDisplay(emailIdx) || getRaw(emailIdx) || "",
      phone: getDisplay(phoneIdx) || getRaw(phoneIdx) || "",
      site: getDisplay(siteIdx) || getRaw(siteIdx) || "",
      session: getDisplay(sessionIdx) || getRaw(sessionIdx) || "",
      lat: toMaybeNumber(getRaw(latIdx) || getDisplay(latIdx)),
      lng: toMaybeNumber(getRaw(lngIdx) || getDisplay(lngIdx)),
      accuracy: toMaybeNumber(getRaw(accuracyIdx) || getDisplay(accuracyIdx)),
      userId: getDisplay(userIdIdx) || getRaw(userIdIdx) || "",
      pictureUrl: getDisplay(pictureUrlIdx) || getRaw(pictureUrlIdx) || "",
      status: getDisplay(statusIdx) || getRaw(statusIdx) || "checked_in",
    };
  }

  // ถ้าไม่มี header ให้เดาจากรูปแบบแถว (fallbacks)
  const len = raw.length;
  if (len === 4) {
    const createdAtDisplay = getDisplay(3) || getRaw(3) || "";
    return {
      createdAtDisplay,
      createdAtKey:
        dateKeyFromIndexPreferDisplay(3) || guessDateKeyFromRow(disp, raw),
      displayName: getDisplay(0) || getRaw(0) || "-",
      email: "",
      phone: "",
      site: "",
      session: "",
      lat: toMaybeNumber(getRaw(1) || getDisplay(1)),
      lng: toMaybeNumber(getRaw(2) || getDisplay(2)),
      accuracy: "",
      userId: "",
      pictureUrl: "",
      status: "checked_in",
    };
  }

  if (len === 6) {
    const createdAtDisplay = getDisplay(5) || getRaw(5) || "";
    return {
      createdAtDisplay,
      createdAtKey:
        dateKeyFromIndexPreferDisplay(5) || guessDateKeyFromRow(disp, raw),
      displayName: getDisplay(0) || getRaw(0) || "-",
      email: getDisplay(1) || getRaw(1) || "",
      phone: getDisplay(2) || getRaw(2) || "",
      site: "",
      session: "",
      lat: toMaybeNumber(getRaw(3) || getDisplay(3)),
      lng: toMaybeNumber(getRaw(4) || getDisplay(4)),
      accuracy: "",
      userId: "",
      pictureUrl: "",
      status: "checked_in",
    };
  }

  if (len >= 12) {
    const createdAtDisplay = getDisplay(0) || getRaw(0) || "";
    return {
      createdAtDisplay,
      createdAtKey:
        dateKeyFromIndexPreferDisplay(0) || guessDateKeyFromRow(disp, raw),
      displayName: getDisplay(1) || getRaw(1) || "-",
      email: getDisplay(2) || getRaw(2) || "",
      phone: getDisplay(3) || getRaw(3) || "",
      site: getDisplay(4) || getRaw(4) || "",
      session: getDisplay(5) || getRaw(5) || "",
      lat: toMaybeNumber(getRaw(6) || getDisplay(6)),
      lng: toMaybeNumber(getRaw(7) || getDisplay(7)),
      accuracy: toMaybeNumber(getRaw(8) || getDisplay(8)),
      userId: getDisplay(9) || getRaw(9) || "",
      pictureUrl: getDisplay(10) || getRaw(10) || "",
      status: getDisplay(11) || getRaw(11) || "checked_in",
    };
  }

  // fallback: พยายามหา name/date/lat/lng ในแถว
  const guessedName = firstNonEmptyText(disp) || firstNonEmptyText(raw) || "-";
  const guessedDate = findDateLikeValue(disp, raw);
  return {
    createdAtDisplay: guessedDate.display || "",
    createdAtKey: guessedDate.key || guessDateKeyFromRow(disp, raw),
    displayName: guessedName,
    email: findEmailValue(disp, raw),
    phone: "",
    site: "",
    session: "",
    lat: findFirstNumberValue(disp, raw, true),
    lng: findFirstNumberValue(disp, raw, false),
    accuracy: "",
    userId: "",
    pictureUrl: "",
    status: "checked_in",
  };
}

/* ---------------- Helpers ---------------- */
function isHeaderRow(row) {
  if (!Array.isArray(row) || row.length === 0) return false;
  // คำค้นหาหลัก ๆ ที่มักจะระบุว่าเป็นส่วนหัวของตาราง
  const commonHeaders = [
    "createdat",
    "time",
    "timestamp",
    "date",
    "datetime",
    "เวลา",
    "displayname",
    "name",
    "fullname",
    "user",
    "username",
    "ชื่อจากline",
    "ชื่อ",
  ];
  return row.some((cell) => {
    const normalized = normalizeHeader(cell);
    return commonHeaders.indexOf(normalized) >= 0;
  });
}

function filterRows(rows, filters) {
  if (!Array.isArray(rows)) return [];
  const tab = String(filters.tab || "")
    .toLowerCase()
    .trim();
  const from = String(filters.from || "").trim();
  const to = String(filters.to || "").trim();

  const todayKey = formatBangkokDateKey(new Date());

  return rows.filter((row) => {
    const dateKey = row.createdAtKey || row._sortKey; // รูปแบบ yyyy-MM-dd

    // 1. ตรวจสอบการเลือกช่วงวันที่ (จากตัวกรอง From / To)
    if (from && to) {
      return dateKey >= from && dateKey <= to;
    } else if (from) {
      return dateKey >= from;
    } else if (to) {
      return dateKey <= to;
    }

    // 2. ตรวจสอบการฟิลเตอร์ตาม Tab ลัด
    if (tab === "today") {
      return dateKey === todayKey;
    }
    if (tab === "yesterday") {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      return dateKey === formatBangkokDateKey(yesterday);
    }

    return true; // กรณีแท็บ "all" หรือไม่มีเงื่อนไข ให้ผ่านหมด
  });
}

function guessDateKeyFromRow(disp, raw) {
  const all = [].concat(
    Array.isArray(disp) ? disp : [],
    Array.isArray(raw) ? raw : [],
  );
  for (let i = 0; i < all.length; i++) {
    const dt = parseToDate(all[i]);
    if (dt) return formatBangkokDateKey(dt);
  }
  return "";
}

function buildLogWriteRow(headers, ctx) {
  const normalized = (headers || []).map(normalizeHeader);
  const hasStandard =
    normalized.indexOf("createdat") >= 0 ||
    normalized.indexOf("displayname") >= 0;
  const hasLegacy4 =
    normalized.length <= 4 ||
    (normalized.indexOf("time") >= 0 &&
      normalized.indexOf("createdat") < 0 &&
      normalized.indexOf("displayname") < 0 &&
      normalized.indexOf("email") < 0);
  const hasLegacy6 = !hasStandard && !hasLegacy4 && normalized.length <= 6;

  if (hasLegacy4)
    return [ctx.displayName, ctx.lat, ctx.lng, ctx.createdAtDisplay];
  if (hasLegacy6)
    return [
      ctx.displayName,
      ctx.email,
      ctx.phone,
      ctx.lat,
      ctx.lng,
      ctx.createdAtDisplay,
    ];

  return [
    ctx.createdAtDisplay,
    ctx.displayName,
    ctx.email,
    ctx.phone,
    ctx.site,
    ctx.session,
    ctx.lat,
    ctx.lng,
    Number.isFinite(ctx.accuracy) ? ctx.accuracy : "",
    ctx.userId,
    ctx.pictureUrl,
    ctx.status,
  ];
}

function getOrCreateLogsSheet(ss) {
  let sheet = ss.getSheetByName(LOGS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(LOGS_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getOrCreateLocationSheet(ss) {
  let sheet = ss.getSheetByName(LOCATION_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(LOCATION_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet
      .getRange(1, 1, 1, LOCATION_HEADERS.length)
      .setValues([LOCATION_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function openSpreadsheet() {
  if (SPREADSHEET_ID && String(SPREADSHEET_ID).trim()) {
    try {
      return SpreadsheetApp.openById(SPREADSHEET_ID);
    } catch (e) {}
  }
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error("ไม่พบ Spreadsheet ที่ใช้งานได้");
}

function getHeaderRow(sheet) {
  const lastColumn = Math.max(1, sheet.getLastColumn());
  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
}

/* ---------------- Date / Time helpers ---------------- */
function parseToDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    if (value > 20000 && value < 90000) {
      const date = new Date((value - 25569) * 86400 * 1000);
      return isNaN(date.getTime()) ? null : date;
    }
    return Number.isFinite(value) ? new Date(value) : null;
  }
  const text = String(value).trim();
  if (!text) return null;

  const isoRegex =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+\-]\d{2}:?\d{2})?$/i;
  if (isoRegex.test(text)) {
    const d = new Date(text);
    return isNaN(d.getTime()) ? null : d;
  }

  const m = text.match(
    /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (m) {
    const y = Number(m[1]),
      mo = Number(m[2]) - 1,
      d = Number(m[3]);
    const hh = Number(m[4] || 0),
      mm = Number(m[5] || 0),
      ss = Number(m[6] || 0);
    return new Date(Date.UTC(y, mo, d, hh, mm, ss) - 7 * 60 * 60 * 1000);
  }

  const d2 = new Date(text);
  return isNaN(d2.getTime()) ? null : d2;
}

function formatBangkokDateTime(date) {
  return Utilities.formatDate(date, BANGKOK_TZ, "yyyy/MM/dd HH:mm:ss");
}

function formatBangkokDateKey(date) {
  return Utilities.formatDate(date, BANGKOK_TZ, "yyyy-MM-dd");
}

/* ---------------- Utilities ---------------- */
function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s_\-\/]+/g, "");
}

function toMaybeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : "";
}

function firstNonEmptyText(arr) {
  const list = Array.isArray(arr) ? arr : [];
  for (let i = 0; i < list.length; i++) {
    const s = String(list[i] || "").trim();
    if (s) return s;
  }
  return "";
}

function findEmailValue(disp, raw) {
  const all = [].concat(
    Array.isArray(disp) ? disp : [],
    Array.isArray(raw) ? raw : [],
  );
  for (let i = 0; i < all.length; i++) {
    const s = String(all[i] || "").trim();
    if (s.indexOf("@") >= 0) return s;
  }
  return "";
}

function findDateLikeValue(disp, raw) {
  const allDisp = Array.isArray(disp) ? disp : [];
  const allRaw = Array.isArray(raw) ? raw : [];
  const len = Math.max(allDisp.length, allRaw.length);
  for (let i = len - 1; i >= 0; i--) {
    const r = allRaw[i],
      d = allDisp[i];
    const dt = parseToDate(r) || parseToDate(d);
    if (dt)
      return {
        display: d ? String(d).trim() : formatBangkokDateTime(dt),
        key: formatBangkokDateKey(dt),
      };
  }
  return { display: "", key: "" };
}

function findFirstNumberValue(disp, raw, preferFirst) {
  const all = [].concat(
    Array.isArray(disp) ? disp : [],
    Array.isArray(raw) ? raw : [],
  );
  const nums = [];
  for (let i = 0; i < all.length; i++) {
    const n = Number(all[i]);
    if (Number.isFinite(n)) nums.push(n);
  }
  if (!nums.length) return "";
  return preferFirst ? nums[0] : (nums[1] ?? nums[0]);
}

function parsePayload(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    return {};
  }
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
