const SPREADSHEET_ID = "1VxuvC0OwqQ_wlsQsjFq3y3XiTeh_CBCKXOf1iz_fGf4";
const LOGS_SHEET_NAME = "Logs";
const AREAS_SHEET_NAME = "location"; // legacy sheet name kept for compatibility
const AREA_ASSIGNMENTS_SHEET_NAME = "AreaAssignments";
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

// Legacy schema used by the existing spreadsheet screenshot.
// Keep this order so the sheet stays familiar.
const AREA_HEADERS = [
  "lat",
  "lng",
  "north",
  "south",
  "east",
  "west",
  "remark",
  "assign",
  "email",
  "qr_code",
];

const AREA_ASSIGNMENT_HEADERS = [
  "qr_code",
  "email",
  "uid",
  "role",
  "displayName",
  "active",
  "createdAt",
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
  areaId: "qr_code",
  areaName: "qr_code",
  lat: 13.968639,
  lng: 100.619861,
  north: 50,
  south: 50,
  east: 80,
  west: 50,
  remark: "พื้นที่เริ่มต้นสำหรับเช็กอิน",
  assign: "masteradmin,admin,user",
  email: "",
  active: true,
  updatedAt: "",
  updatedBy: "",
};

function doGet(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};
    const action = String(params.action || "areas").toLowerCase();

    if (action === "areas" || action === "location") {
      return jsonOutput(getAreasResponse());
    }

    if (action === "logs") {
      return jsonOutput(getLogsResponse(params));
    }

    if (action === "users") {
      return jsonOutput(getUsersResponse(params));
    }

    return jsonOutput({ ok: false, error: "unknown_action" });
  } catch (err) {
    return jsonOutput({ ok: false, error: err.message || String(err) });
  }
}

function doPost(e) {
  try {
    const payload = parsePayload(e);
    const action = String(payload.action || payload.type || "").toLowerCase();

    if (action === "areas" || action === "location") {
      return jsonOutput(saveArea(payload));
    }

    if (action === "logs") {
      return jsonOutput(saveLog(payload));
    }

    if (action === "users") {
      return jsonOutput(saveUser(payload));
    }

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

/* ---------------- Areas ---------------- */

function getAreasResponse() {
  const ss = openSpreadsheet();
  const sheet = getOrCreateAreasSheet(ss);
  const list = readObjectsFromSheet(sheet)
    .map(normalizeArea)
    .filter(Boolean);

  const assignments = readAreaAssignments(ss);
  const merged = mergeAssignmentsIntoAreas(list, assignments);

  if (!merged.length) {
    return { ok: true, data: [normalizeArea(DEFAULT_AREA)] };
  }

  return { ok: true, data: merged };
}

function buildAreaId(area) {
  const sourceText = String(
    area?.areaId || area?.areaName || area?.remark || DEFAULT_AREA.areaName,
  ).trim();
  const base = sourceText
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9ก-๙]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "area";
  const stamp = Utilities.formatDate(new Date(), BANGKOK_TZ, "yyyyMMddHHmmss");
  return `${base}-${stamp}`;
}

function saveArea(payload) {
  const ss = openSpreadsheet();
  const sheet = getOrCreateAreasSheet(ss);
  const all = readObjectsFromSheet(sheet)
    .map(normalizeArea)
    .filter(Boolean);

  const requestedAreaId = String(payload.areaId || "").trim();
  const originalId = String(
    payload.originalAreaId || payload.previousAreaId || requestedAreaId,
  ).trim();

  let incoming = normalizeArea(payload);
  const now = formatBangkokDateTime(new Date());
  const updatedBy = String(
    payload.updatedBy || payload.userId || payload.email || "",
  ).trim();

  const isCreate = !originalId;
  if (!requestedAreaId || (isCreate && requestedAreaId === DEFAULT_AREA.areaId)) {
    incoming.areaId = buildAreaId(incoming);
  }
  if (isCreate && (!String(payload.areaName || "").trim())) {
    incoming.areaName = incoming.areaId;
  } else if (!String(incoming.areaName || "").trim()) {
    incoming.areaName = incoming.remark || incoming.areaId || DEFAULT_AREA.areaName;
  }

  incoming.updatedAt = now;
  incoming.updatedBy = updatedBy;

  if (String(payload.actionType || "").toLowerCase() === "delete") {
    const idToDelete = String(
      payload.originalAreaId || payload.previousAreaId || incoming.areaId,
    ).trim();
    const idx = all.findIndex((a) => String(a.areaId) === idToDelete);
    if (idx >= 0) {
      all.splice(idx, 1);
      writeAreaObjects(sheet, all);
    }
    removeAreaAssignments(ss, idToDelete);
    SpreadsheetApp.flush();
    return { ok: true, message: "ลบพื้นที่แล้ว", data: mergeAssignmentsIntoAreas(all, readAreaAssignments(ss)) };
  }

  let idx = all.findIndex((a) => String(a.areaId) === originalId);
  if (idx < 0 && originalId !== String(incoming.areaId)) {
    idx = all.findIndex((a) => String(a.areaId) === String(incoming.areaId));
  }

  if (idx >= 0) all[idx] = incoming;
  else all.unshift(incoming);

  writeAreaObjects(sheet, all);
  syncAreaAssignments(ss, incoming, payload, originalId);

  SpreadsheetApp.flush();
  const assignments = readAreaAssignments(ss);
  return {
    ok: true,
    message: "บันทึกพื้นที่สำเร็จ",
    data: mergeAssignmentsIntoAreas(all, assignments),
  };
}

function normalizeArea(raw) {
  const source = raw || {};
  const areaId = String(
    source.areaId ||
      source.qr_code ||
      source.id ||
      source.code ||
      source.siteId ||
      source.site ||
      DEFAULT_AREA.areaId,
  ).trim() || DEFAULT_AREA.areaId;

  const areaName = String(
    source.areaName ||
      source.siteName ||
      source.site ||
      source.remark ||
      source.note ||
      source.qr_code ||
      "",
  ).trim();

  const remark = String(source.remark ?? source.note ?? source.areaName ?? source.siteName ?? source.site ?? source.qr_code ?? "").trim();
  const visibleRoles = String(
    source.visibleRoles ?? source.assign ?? DEFAULT_AREA.assign,
  ).trim() || DEFAULT_AREA.assign;
  const visibleUsers = String(
    source.visibleUsers ?? source.email ?? source.allowedUsers ?? "",
  ).trim();

  return {
    areaId,
    areaName: areaName || remark || areaId || DEFAULT_AREA.areaName,
    lat: toNumberOr(source.lat ?? source.centerLat, DEFAULT_AREA.lat),
    lng: toNumberOr(source.lng ?? source.centerLng, DEFAULT_AREA.lng),
    north: Math.max(
      0,
      toNumberOr(source.north ?? source.northMeters, DEFAULT_AREA.north),
    ),
    south: Math.max(
      0,
      toNumberOr(source.south ?? source.southMeters, DEFAULT_AREA.south),
    ),
    east: Math.max(
      0,
      toNumberOr(source.east ?? source.eastMeters, DEFAULT_AREA.east),
    ),
    west: Math.max(
      0,
      toNumberOr(source.west ?? source.westMeters, DEFAULT_AREA.west),
    ),
    remark,
    assign: visibleRoles,
    email: visibleUsers,
    visibleRoles,
    visibleUsers,
    active:
      source.active === false || String(source.active).toLowerCase() === "false"
        ? false
        : true,
    updatedAt: String(source.updatedAt || "").trim(),
    updatedBy: String(source.updatedBy || "").trim(),
  };
}

function writeAreaObjects(sheet, list) {
  const rows = [AREA_HEADERS];
  list.forEach((area) => {
    const n = normalizeArea(area);
    rows.push([
      n.lat,
      n.lng,
      n.north,
      n.south,
      n.east,
      n.west,
      n.remark || "",
      n.assign || "",
      n.email || "",
      n.areaId || "",
    ]);
  });

  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, AREA_HEADERS.length).setValues(rows);
}

function getOrCreateAreasSheet(ss) {
  let sheet = ss.getSheetByName(AREAS_SHEET_NAME);
  if (!sheet) sheet = ss.getSheetByName("Areas");
  if (!sheet) sheet = ss.insertSheet(AREAS_SHEET_NAME);
  ensureHeaderRow(sheet, AREA_HEADERS);
  return sheet;
}

function readAreaAssignments(ss) {
  const sheet = getOrCreateAreaAssignmentsSheet(ss);
  const rows = readObjectsFromSheet(sheet)
    .map((row) => ({
      areaId: String(row.qr_code || row.areaId || "").trim(),
      email: String(row.email || row.userEmail || "").trim().toLowerCase(),
      uid: String(row.uid || row.userId || "").trim(),
      role: String(row.role || "").trim().toLowerCase(),
      displayName: String(row.displayName || row.name || "").trim(),
      active:
        row.active === false || String(row.active).toLowerCase() === "false"
          ? false
          : true,
      createdAt: String(row.createdAt || "").trim(),
      updatedAt: String(row.updatedAt || "").trim(),
      updatedBy: String(row.updatedBy || "").trim(),
    }))
    .filter((row) => row.areaId && row.email);
  return rows;
}

function syncAreaAssignments(ss, area, payload, originalAreaId) {
  const sheet = getOrCreateAreaAssignmentsSheet(ss);
  const all = readAreaAssignments(ss);
  const areaId = String(area.areaId || "").trim();
  const now = formatBangkokDateTime(new Date());
  const updatedBy = String(
    payload.updatedBy || payload.userId || payload.email || "",
  ).trim();

  const assignees = normalizeAssigneeList(payload, area);
  const idsToRemove = uniqueList([originalAreaId, areaId].map((v) => String(v || "").trim()).filter(Boolean));
  const retained = all.filter((row) => !idsToRemove.includes(String(row.areaId)));
  const existingByKey = new Map();
  all.forEach((row) => {
    const key = `${String(row.areaId).trim()}||${String(row.email).trim().toLowerCase()}`;
    existingByKey.set(key, row);
  });

  const nextRows = assignees.map((user) => {
    const email = String(user.email || "").trim().toLowerCase();
    const key = `${areaId}||${email}`;
    const previous = existingByKey.get(key) || {};
    return {
      areaId,
      email,
      uid: String(user.uid || previous.uid || "").trim(),
      role: String(user.role || previous.role || "").trim().toLowerCase(),
      displayName: String(user.displayName || previous.displayName || "").trim(),
      active:
        user.active === false || String(user.active).toLowerCase() === "false"
          ? false
          : true,
      createdAt: String(previous.createdAt || now).trim(),
      updatedAt: now,
      updatedBy,
    };
  });

  writeAreaAssignmentObjects(sheet, [...retained, ...nextRows]);
}

function normalizeAssigneeList(payload, area) {
  const assignees = Array.isArray(payload?.assignees) ? payload.assignees : [];
  if (assignees.length) {
    return assignees
      .map((item) => ({
        email: String(item?.email || item?.userEmail || "").trim().toLowerCase(),
        uid: String(item?.uid || item?.userId || "").trim(),
        role: String(item?.role || "").trim().toLowerCase(),
        displayName: String(item?.displayName || item?.name || "").trim(),
        active:
          item?.active === false || String(item?.active).toLowerCase() === "false"
            ? false
            : true,
      }))
      .filter((item) => item.email);
  }

  const emails = splitList(
    payload.visibleUsers ||
      payload.email ||
      area.visibleUsers ||
      area.email ||
      "",
  ).map((email) => ({
    email: String(email || "").trim().toLowerCase(),
    uid: "",
    role: "",
    displayName: "",
    active: true,
  }));

  return emails.filter((item) => item.email);
}

function removeAreaAssignments(ss, areaId) {
  const sheet = getOrCreateAreaAssignmentsSheet(ss);
  const all = readAreaAssignments(ss).filter((row) => String(row.areaId) !== String(areaId));
  writeAreaAssignmentObjects(sheet, all);
}

function mergeAssignmentsIntoAreas(areas, assignments) {
  const byArea = new Map();
  assignments.forEach((row) => {
    const id = String(row.areaId || "").trim();
    const email = String(row.email || "").trim().toLowerCase();
    if (!id || !email) return;
    if (!byArea.has(id)) byArea.set(id, []);
    byArea.get(id).push(row);
  });

  return areas.map((area) => {
    const normalized = normalizeArea(area);
    const fromSheet = splitList(normalized.visibleUsers || normalized.email || "");
    const fromAssignments = (byArea.get(String(normalized.areaId)) || []).map((row) => row.email);
    const mergedEmails = uniqueList([...fromSheet, ...fromAssignments]);

    const roleText = String(normalized.visibleRoles || normalized.assign || "").trim();
    return {
      ...normalized,
      assign: roleText,
      visibleRoles: roleText,
      email: mergedEmails.join(","),
      visibleUsers: mergedEmails.join(","),
    };
  });
}

function writeAreaAssignmentObjects(sheet, list) {
  const rows = [AREA_ASSIGNMENT_HEADERS];
  list.forEach((row) => {
    const areaId = String(row.areaId || "").trim();
    const email = String(row.email || "").trim().toLowerCase();
    if (!areaId || !email) return;
    rows.push([
      areaId,
      email,
      String(row.uid || "").trim(),
      String(row.role || "").trim().toLowerCase(),
      String(row.displayName || "").trim(),
      row.active !== false,
      String(row.createdAt || "").trim(),
      String(row.updatedAt || "").trim(),
      String(row.updatedBy || "").trim(),
    ]);
  });

  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, AREA_ASSIGNMENT_HEADERS.length).setValues(rows);
}

function getOrCreateAreaAssignmentsSheet(ss) {
  let sheet = ss.getSheetByName(AREA_ASSIGNMENTS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(AREA_ASSIGNMENTS_SHEET_NAME);
  ensureHeaderRow(sheet, AREA_ASSIGNMENT_HEADERS);
  return sheet;
}

/* ---------------- Logs ---------------- */

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
  const phone = "";
  const site = String(
    payload.site || payload.siteName || DEFAULT_AREA.areaName,
  ).trim();
  const session = String(payload.session || "").trim();
  const userId = String(payload.userId || "").trim();
  const pictureUrl = String(payload.pictureUrl || "").trim();
  const status = String(payload.status || "checked_in").trim();
  const lat = Number(payload.lat);
  const lng = Number(payload.lng);
  const accuracy =
    payload.accuracy !== undefined ? Number(payload.accuracy) : "";

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("lat/lng is required");
  }

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

function getLogsResponse(params) {
  const ss = openSpreadsheet();
  const sheet = getOrCreateLogsSheet(ss);
  const list = readObjectsFromSheet(sheet);

  const limit = Math.max(1, toInt(params.limit || 200, 200));
  return { ok: true, data: list.slice(-limit).reverse() };
}

function getOrCreateLogsSheet(ss) {
  let sheet = ss.getSheetByName(LOGS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(LOGS_SHEET_NAME);
  ensureHeaderRow(sheet, LOG_HEADERS);
  return sheet;
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

  return headers.map((h) => (map[h] !== undefined ? map[h] : ""));
}

/* ---------------- Users ---------------- */

function getUsersResponse(params) {
  const ss = openSpreadsheet();
  const sheet = getOrCreateUsersSheet(ss);
  const list = readObjectsFromSheet(sheet)
    .map(normalizeUser)
    .filter(Boolean);

  const email = String((params && params.email) || "")
    .trim()
    .toLowerCase();
  const uid = String((params && params.uid) || "").trim();
  const role = String((params && params.role) || "")
    .trim()
    .toLowerCase();
  const active = String((params && params.active) || "")
    .trim()
    .toLowerCase();

  let filtered = list;
  if (email)
    filtered = filtered.filter(
      (u) => String(u.email || "").toLowerCase() === email,
    );
  if (uid) filtered = filtered.filter((u) => String(u.uid || "") === uid);
  if (role)
    filtered = filtered.filter(
      (u) => String(u.role || "").toLowerCase() === role,
    );
  if (active === "true") filtered = filtered.filter((u) => u.active !== false);
  if (active === "false") filtered = filtered.filter((u) => u.active === false);

  filtered.sort((a, b) => {
    const order = { masteradmin: 0, admin: 1, user: 2 };
    const ra = order[String(a.role || "user").toLowerCase()] ?? 9;
    const rb = order[String(b.role || "user").toLowerCase()] ?? 9;
    if (ra !== rb) return ra - rb;
    return String(a.displayName || a.email || "").localeCompare(
      String(b.displayName || b.email || ""),
    );
  });

  return { ok: true, data: filtered };
}

function saveUser(payload) {
  const ss = openSpreadsheet();
  const sheet = getOrCreateUsersSheet(ss);
  const all = readObjectsFromSheet(sheet)
    .map(normalizeUser)
    .filter(Boolean);
  const incoming = normalizeUser(payload);

  if (!incoming.email && !incoming.uid) {
    throw new Error("email or uid is required");
  }

  const now = formatBangkokDateTime(new Date());
  incoming.updatedAt = now;
  incoming.updatedBy = String(
    payload.updatedBy || payload.userId || payload.email || "",
  ).trim();

  const matchIndex = all.findIndex((u) => {
    if (incoming.uid && String(u.uid || "") === incoming.uid) return true;
    if (
      incoming.email &&
      String(u.email || "").toLowerCase() === incoming.email.toLowerCase()
    )
      return true;
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

function deleteUser(user) {
  return saveUser({ ...(user || {}), actionType: "delete" });
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

function getOrCreateUsersSheet(ss) {
  let sheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(USERS_SHEET_NAME);
  ensureHeaderRow(sheet, USER_HEADERS);
  return sheet;
}

function normalizeUser(raw) {
  const source = raw || {};
  const role = String(source.role || "user")
    .trim()
    .toLowerCase();
  const safeRole = ["masteradmin", "admin", "user"].includes(role)
    ? role
    : "user";

  return {
    email: String(source.email || source.username || "")
      .trim()
      .toLowerCase(),
    uid: String(source.uid || source.userId || "").trim(),
    displayName: String(
      source.displayName || source.name || source.fullName || "",
    ).trim(),
    role: safeRole,
    active:
      source.active === false || String(source.active).toLowerCase() === "false"
        ? false
        : true,
    visibleAreas: String(
      source.visibleAreas || source.allowedAreas || "",
    ).trim(),
    note: String(source.note || source.remark || "").trim(),
    updatedAt: String(source.updatedAt || "").trim(),
    updatedBy: String(source.updatedBy || "").trim(),
  };
}

/* ---------------- Helpers ---------------- */

function openSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function ensureHeaderRow(sheet, headers) {
  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const hasAny = firstRow.some((v) => String(v || "").trim() !== "");
  if (!hasAny) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

function getHeaderRow(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  return sheet
    .getRange(1, 1, 1, lastCol)
    .getValues()[0]
    .map((v) => String(v || "").trim());
}

function readObjectsFromSheet(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  if (lastRow < 2) return [];
  const headers = getHeaderRow(sheet);
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return values
    .map((row) => rowToObject(headers, row))
    .filter((obj) =>
      Object.values(obj).some((v) => String(v ?? "").trim() !== ""),
    );
}

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach((h, i) => {
    obj[h] = row[i];
  });
  return obj;
}

function splitList(value) {
  return String(value || "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function uniqueList(list) {
  const seen = new Set();
  const result = [];
  list.forEach((item) => {
    const key = String(item || "").trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(String(item || "").trim());
  });
  return result;
}

function toNumberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

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
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
