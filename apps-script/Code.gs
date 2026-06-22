const SPREADSHEET_ID = "1VxuvC0OwqQ_wlsQsjFq3y3XiTeh_CBCKXOf1iz_fGf4";
const LOGS_SHEET_NAME = "Logs";
const AREAS_SHEET_NAME = "location";
const USERS_SHEET_NAME = "Users";
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

const AREA_HEADERS = [
  "areaId",
  "areaName",
  "lat",
  "lng",
  "north",
  "south",
  "east",
  "west",
  "note",
  "active",
  "visibleRoles",
  "visibleUsers",
  "updatedAt",
  "updatedBy",
];

const USER_HEADERS = [
  "email",
  "uid",
  "displayName",
  "role",
  "active",
  "visibleAreas",
  "note",
  "updatedAt",
  "updatedBy",
];

const DEFAULT_AREA = {
  areaId: "default",
  areaName: "Check-in Zone",
  lat: 13.968639,
  lng: 100.619861,
  north: 50,
  south: 50,
  east: 80,
  west: 50,
  note: "อยู่ในกรอบสี่เหลี่ยมนี้เท่านั้นจึงจะเช็กอินได้",
  active: true,
  visibleRoles: "masteradmin,admin,user",
  visibleUsers: "",
};

function doGet(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};
    const action = String(params.action || "areas").toLowerCase();
    if (action === "areas" || action === "location") return jsonOutput(getAreasResponse());
    if (action === "logs") return jsonOutput(getLogsResponse(params));
    if (action === "users") return jsonOutput(getUsersResponse(params));
    return jsonOutput({ ok: false, error: "unknown_action" });
  } catch (err) {
    return jsonOutput({ ok: false, error: err.message || String(err) });
  }
}

function doPost(e) {
  try {
    const payload = parsePayload(e);
    const action = String(payload.action || payload.type || "").toLowerCase();
    if (action === "areas" || action === "location") return jsonOutput(saveArea(payload));
    if (action === "logs") return jsonOutput(saveLog(payload));
    if (action === "users") return jsonOutput(saveUser(payload));
    return jsonOutput({ ok: false, error: "unknown_action" });
  } catch (err) {
    return jsonOutput({ ok: false, error: err.message || String(err) });
  }
}

function parsePayload(e) {
  if (!e) return {};
  if (e.postData && e.postData.contents) {
    try {
      return JSON.parse(e.postData.contents);
    } catch (err) {
      return typeof e.parameter === "object" ? e.parameter : {};
    }
  }
  return typeof e.parameter === "object" ? e.parameter : {};
}

function saveLog(payload) {
  const ss = openSpreadsheet();
  const sheet = getOrCreateLogsSheet(ss);

  const createdAtRaw = payload.createdAt || payload.time || new Date().toISOString();
  const createdAt = parseToDate(createdAtRaw);
  if (!createdAt) throw new Error("time is invalid");

  const createdAtDisplay = formatBangkokDateTime(createdAt);
  const displayName = String(payload.displayName || payload.name || "-").trim() || "-";
  const email = String(payload.email || "").trim();
  const phone = "";
  const site = String(payload.site || payload.siteName || "Check-in Zone").trim();
  const session = String(payload.session || "").trim();
  const userId = String(payload.userId || "").trim();
  const pictureUrl = String(payload.pictureUrl || "").trim();
  const status = String(payload.status || "checked_in").trim();
  const lat = Number(payload.lat);
  const lng = Number(payload.lng);
  const accuracy = payload.accuracy !== undefined ? Number(payload.accuracy) : "";

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("lat/lng is required");

  const headers = getHeaderRow(sheet);
  const row = buildLogWriteRow(headers, {
    createdAtDisplay, displayName, email, phone, site, session, lat, lng, accuracy, userId, pictureUrl, status,
  });

  sheet.appendRow(row);
  SpreadsheetApp.flush();

  return { ok: true, message: "บันทึกข้อมูลสำเร็จ", time: createdAtDisplay };
}

function getAreasResponse() {
  const ss = openSpreadsheet();
  const sheet = getOrCreateAreasSheet(ss);
  const values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) {
    return { ok: true, data: [DEFAULT_AREA] };
  }

  const rows = values.slice(1).map((row) => {
    const obj = rowToObject(AREA_HEADERS, row);
    return normalizeArea(obj);
  }).filter(Boolean);

  return { ok: true, data: rows.length ? rows : [DEFAULT_AREA] };
}

function saveArea(payload) {
  const ss = openSpreadsheet();
  const sheet = getOrCreateAreasSheet(ss);
  const areas = getAreasResponse().data || [];
  const incoming = normalizeArea(payload);
  const now = formatBangkokDateTime(new Date());
  incoming.updatedAt = now;
  incoming.updatedBy = String(payload.updatedBy || payload.userId || payload.email || "").trim();

  const all = readSheetAsObjects(sheet, AREA_HEADERS);
  const idx = all.findIndex((a) => String(a.areaId) === String(incoming.areaId));
  if (String(payload.actionType || "").toLowerCase() === "delete") {
    if (idx >= 0) {
      all.splice(idx, 1);
      writeAreaObjects(sheet, all);
    }
    return { ok: true, message: "ลบพื้นที่แล้ว", data: all };
  }

  if (idx >= 0) all[idx] = incoming;
  else all.unshift(incoming);

  writeAreaObjects(sheet, all);
  SpreadsheetApp.flush();
  return { ok: true, message: "บันทึกพื้นที่สำเร็จ", data: all };
}

function getUsersResponse(params) {
  const ss = openSpreadsheet();
  const sheet = getOrCreateUsersSheet(ss);
  const list = readObjectsFromSheet(sheet, USER_HEADERS).map(normalizeUser).filter(Boolean);

  const email = String(params && params.email || "").trim().toLowerCase();
  const uid = String(params && params.uid || "").trim();
  const role = String(params && params.role || "").trim().toLowerCase();
  const active = String(params && params.active || "").trim().toLowerCase();

  let filtered = list;
  if (email) filtered = filtered.filter((u) => String(u.email || "").toLowerCase() === email);
  if (uid) filtered = filtered.filter((u) => String(u.uid || "") === uid);
  if (role) filtered = filtered.filter((u) => String(u.role || "").toLowerCase() === role);
  if (active === "true") filtered = filtered.filter((u) => u.active !== false);
  if (active === "false") filtered = filtered.filter((u) => u.active === false);

  filtered.sort((a, b) => {
    const order = { masteradmin: 0, admin: 1, user: 2 };
    const ra = order[String(a.role || "user").toLowerCase()] ?? 9;
    const rb = order[String(b.role || "user").toLowerCase()] ?? 9;
    if (ra !== rb) return ra - rb;
    return String(a.displayName || a.email || "").localeCompare(String(b.displayName || b.email || ""));
  });

  return { ok: true, data: filtered };
}

function saveUser(payload) {
  const ss = openSpreadsheet();
  const sheet = getOrCreateUsersSheet(ss);
  const all = readObjectsFromSheet(sheet, USER_HEADERS).map(normalizeUser).filter(Boolean);
  const incoming = normalizeUser(payload);

  if (!incoming.email && !incoming.uid) {
    throw new Error("email or uid is required");
  }

  const now = formatBangkokDateTime(new Date());
  incoming.updatedAt = now;
  incoming.updatedBy = String(payload.updatedBy || payload.userId || payload.email || "").trim();

  const matchIndex = all.findIndex((u) => {
    if (incoming.uid && String(u.uid || "") === incoming.uid) return true;
    if (incoming.email && String(u.email || "").toLowerCase() === incoming.email.toLowerCase()) return true;
    return false;
  });

  if (String(payload.actionType || "").toLowerCase() === "delete") {
    if (matchIndex >= 0) {
      all.splice(matchIndex, 1);
      writeUserObjects(sheet, all);
      SpreadsheetApp.flush();
    }
    return { ok: true, message: "ลบสิทธิ์แล้ว", data: all };
  }

  if (matchIndex >= 0) all[matchIndex] = incoming;
  else all.unshift(incoming);

  writeUserObjects(sheet, all);
  SpreadsheetApp.flush();
  return { ok: true, message: "บันทึกสิทธิ์สำเร็จ", data: all };
}

/* ---------------- Spreadsheet helpers ---------------- */
function openSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getOrCreateLogsSheet(ss) {
  let sheet = ss.getSheetByName(LOGS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(LOGS_SHEET_NAME);
  ensureHeaderRow(sheet, LOG_HEADERS);
  return sheet;
}

function getOrCreateAreasSheet(ss) {
  let sheet = ss.getSheetByName(AREAS_SHEET_NAME);
  if (!sheet) sheet = ss.getSheetByName("Areas");
  if (!sheet) sheet = ss.insertSheet(AREAS_SHEET_NAME);
  ensureHeaderRow(sheet, AREA_HEADERS);
  return sheet;
}

function getOrCreateUsersSheet(ss) {
  let sheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(USERS_SHEET_NAME);
  ensureHeaderRow(sheet, USER_HEADERS);
  return sheet;
}

function ensureHeaderRow(sheet, headers) {
  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const hasAny = firstRow.some((v) => String(v || "").trim() !== "");
  if (!hasAny) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}

function getHeaderRow(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map((v) => String(v || "").trim());
}

function buildLogWriteRow(headers, obj) {
  const map = {
    createdAt: obj.createdAtDisplay,
    displayName: obj.displayName,
    email: obj.email,
    phone: obj.phone,
    site: obj.site,
    session: obj.session,
    lat: obj.lat,
    lng: obj.lng,
    accuracy: obj.accuracy,
    userId: obj.userId,
    pictureUrl: obj.pictureUrl,
    status: obj.status,
  };
  return headers.map((h) => map[h] !== undefined ? map[h] : "");
}

function readSheetAsObjects(sheet, headers) {
  const values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) return [];
  return values.slice(1).map((row) => rowToObject(headers, row)).filter((obj) => obj.areaId || obj.areaName);
}

function writeAreaObjects(sheet, list) {
  const rows = [AREA_HEADERS];
  list.forEach((area) => {
    const n = normalizeArea(area);
    rows.push([
      n.areaId || "",
      n.areaName || "",
      n.lat,
      n.lng,
      n.north,
      n.south,
      n.east,
      n.west,
      n.note || "",
      n.active !== false,
      n.visibleRoles || "",
      n.visibleUsers || "",
      n.updatedAt || "",
      n.updatedBy || "",
    ]);
  });
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, AREA_HEADERS.length).setValues(rows);
}

function readObjectsFromSheet(sheet, headers) {
  const values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) return [];
  return values.slice(1).map((row) => rowToObject(headers, row)).filter((obj) => {
    return Object.values(obj).some((v) => String(v ?? "").trim() !== "");
  });
}

function writeUserObjects(sheet, list) {
  const rows = [USER_HEADERS];
  list.forEach((user) => {
    const n = normalizeUser(user);
    rows.push([
      n.email || "",
      n.uid || "",
      n.displayName || "",
      n.role || "user",
      n.active !== false,
      n.visibleAreas || "",
      n.note || "",
      n.updatedAt || "",
      n.updatedBy || "",
    ]);
  });
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, USER_HEADERS.length).setValues(rows);
}

function normalizeUser(raw) {
  const source = raw || {};
  const role = String(source.role || "user").trim().toLowerCase();
  const safeRole = ["masteradmin", "admin", "user"].includes(role) ? role : "user";
  return {
    email: String(source.email || source.username || "").trim().toLowerCase(),
    uid: String(source.uid || source.userId || "").trim(),
    displayName: String(source.displayName || source.name || source.fullName || "").trim(),
    role: safeRole,
    active: source.active === false || String(source.active).toLowerCase() === "false" ? false : true,
    visibleAreas: String(source.visibleAreas || source.allowedAreas || "").trim(),
    note: String(source.note || source.remark || "").trim(),
    updatedAt: String(source.updatedAt || "").trim(),
    updatedBy: String(source.updatedBy || "").trim(),
  };
}

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach((h, i) => {
    obj[h] = row[i];
  });
  return obj;
}

function normalizeArea(raw) {
  const source = raw || {};
  return {
    areaId: String(source.areaId || source.id || "default").trim() || "default",
    areaName: String(source.areaName || source.siteName || source.site || DEFAULT_AREA.areaName).trim() || DEFAULT_AREA.areaName,
    lat: Number(source.lat ?? source.centerLat ?? DEFAULT_AREA.lat),
    lng: Number(source.lng ?? source.centerLng ?? DEFAULT_AREA.lng),
    north: Math.max(0, Number(source.north ?? source.northMeters ?? DEFAULT_AREA.north)),
    south: Math.max(0, Number(source.south ?? source.southMeters ?? DEFAULT_AREA.south)),
    east: Math.max(0, Number(source.east ?? source.eastMeters ?? DEFAULT_AREA.east)),
    west: Math.max(0, Number(source.west ?? source.westMeters ?? DEFAULT_AREA.west)),
    note: String(source.note ?? source.remark ?? DEFAULT_AREA.note).trim(),
    active: source.active === false || String(source.active).toLowerCase() === "false" ? false : true,
    visibleRoles: String(source.visibleRoles ?? DEFAULT_AREA.visibleRoles).trim(),
    visibleUsers: String(source.visibleUsers ?? source.allowedUsers ?? "").trim(),
    updatedAt: String(source.updatedAt || "").trim(),
    updatedBy: String(source.updatedBy || "").trim(),
  };
}

/* ---------------- Generic helpers ---------------- */
function parseToDate(raw) {
  if (raw instanceof Date) return raw;
  if (raw === null || raw === undefined || raw === "") return null;
  const text = String(raw).trim();
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatBangkokDateTime(date) {
  const dt = date instanceof Date ? date : parseToDate(date);
  if (!dt) return "";
  return Utilities.formatDate(dt, BANGKOK_TZ, "yyyy/MM/dd HH:mm");
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
