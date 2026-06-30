const SPREADSHEET_ID = "1CqGpZZP9jofU5EcKC2G3J60tiO2cSw7flTn4ZAJH4X0";
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

// ชีต Logs รุ่นเก่า (ก่อนระบบนี้) ใช้หัวคอลัมน์ชื่ออื่น — แมปชื่อเก่า -> ชื่อใหม่ที่โค้ดนี้ต้องใช้
// เพื่อให้ข้อมูลเก่าที่มีอยู่แล้วยังอ่านได้ถูกต้องหลัง migrate (ไม่ลบข้อมูลเดิม แค่เปลี่ยนชื่อหัวคอลัมน์/เพิ่มคอลัมน์ที่ขาด)
const LEGACY_LOG_HEADER_RENAME = {
  "Name": "displayName",
  "Email": "email",
  "Phone": "phone",
  "Lat": "lat",
  "Lng": "lng",
  "Time": "createdAt",
};

/**
 * ตรวจและแก้ไขหัวคอลัมน์ของชีต Logs ให้ตรงกับ LOG_HEADERS เสมอ
 * - ถ้าเจอหัวคอลัมน์เก่า (Name/Email/Phone/Lat/Lng/Time) จะเปลี่ยนชื่อหัวให้ตรง schema ใหม่ทันที (ข้อมูลแถวเดิมไม่เสีย เพราะคอลัมน์ตำแหน่งเดิม)
 * - คอลัมน์ใหม่ที่ขาดไปจาก schema เดิม (เช่น createdAt ถ้าไม่เคยมี, userId, site, session, accuracy, pictureUrl, status)
 *   จะถูกเพิ่มเป็นคอลัมน์ใหม่ต่อท้าย โดยไม่ลบหรือแก้ข้อมูลแถวที่มีอยู่แล้วเลย
 * - ฟังก์ชันนี้ปลอดภัยที่จะเรียกซ้ำได้ทุกครั้ง (idempotent)
 */
function ensureLogsSheetSchema() {
  const sheet = getSheetByNameOrCreate(LOGS_SHEET_NAME);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow === 0) {
    // ชีตยังไม่มีอะไรเลย สร้าง header ใหม่ตาม schema ปัจจุบัน
    sheet.appendRow(LOG_HEADERS);
    return sheet;
  }

  const headerRange = sheet.getRange(1, 1, 1, Math.max(lastCol, 1));
  let headers = headerRange.getValues()[0].map((h) => String(h || "").trim());

  // 1) เปลี่ยนชื่อหัวคอลัมน์เก่า -> ชื่อใหม่ (ไม่ย้ายตำแหน่งคอลัมน์ ไม่กระทบข้อมูลแถวที่มีอยู่)
  let renamed = false;
  headers = headers.map((h) => {
    if (LEGACY_LOG_HEADER_RENAME[h]) {
      renamed = true;
      return LEGACY_LOG_HEADER_RENAME[h];
    }
    return h;
  });

  // 2) หาคอลัมน์ใหม่ใน schema ปัจจุบันที่ชีตยังไม่มี แล้วเพิ่มต่อท้าย
  const existing = new Set(headers.filter(Boolean));
  const missing = LOG_HEADERS.filter((h) => !existing.has(h));

  if (renamed) {
    headerRange.setValues([headers]);
  }

  if (missing.length > 0) {
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
  }

  return sheet;
}

// Schema ตรงกับ Google Sheet จริง
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

// ชีต user สำหรับคนเช็คอินผ่าน LINE (แยกจาก Firestore users ของ admin)
// userId = LINE userId ถาวร | name = ชื่อจาก LINE ตอนลงทะเบียนครั้งแรก | currentName = ชื่อที่ admin ตั้ง/แก้ไข
const LINE_CHECKIN_USER_SHEET = "user";
const LINE_CHECKIN_USER_HEADERS = [
  "userId",
  "name",
  "currentName",
  "email",
  "updatedAt",
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
  location: "",
  assign: "masteradmin,admin,user",
  email: "",
  active: true,
  updatedAt: "",
  updatedBy: "",
};

/**
 * =======================================================================
 * MAIN ENTRY POINTS (รับ Request จาก Frontend)
 * =======================================================================
 */

function doGet(e) {
  try {
    const action = e.parameter.action;
    let result = {};

    if (action === "location" || action === "areas") {
      result = handleGetLocation();
    } else if (action === "users") {
      result = handleGetUsers(e.parameter);
    } else if (action === "logs") {
      result = handleGetLogs(e.parameter);
    } else {
      result = { ok: false, error: "ไม่พบ Action GET: " + action };
    }

    return responseJson(result);
  } catch (err) {
    return responseJson({ ok: false, error: err.message });
  }
}

function doPost(e) {
  try {
    // ตรวจสอบว่ามีข้อมูลส่งมาหรือไม่
    if (!e.postData || !e.postData.contents) {
      throw new Error("No payload provided");
    }

    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    let result = {};

    if (action === "location" || action === "areas") {
      if (payload.actionType === "delete") {
        result = deleteLocation(payload);
      } else {
        result = saveLocation(payload);
      }
    } else if (action === "users") {
      if (payload.actionType === "delete") {
        result = deleteUser(payload);
      } else {
        result = saveUser(payload);
      }
    } else if (action === "logs") {
      result = saveLog(payload);
    } else if (action === "saveLogName") {
      result = handleSaveLogName(payload);
    } else {
      result = { ok: false, error: "ไม่พบ Action POST: " + action };
    }

    return responseJson(result);
  } catch (err) {
    return responseJson({ ok: false, error: err.message });
  }
}

/**
 * =======================================================================
 * UTILITY FUNCTIONS (ฟังก์ชันช่วยเหลือ)
 * =======================================================================
 */

// ส่งออกเป็น JSON กลับไปยัง Frontend
function responseJson(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

// ค้นหา Sheet ถ้าไม่มีให้สร้างใหม่
function getSheetByNameOrCreate(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  return sheet;
}

// ดึงข้อมูลจาก Sheet ออกมาเป็น Array of Objects
function getSheetDataAsObjects(sheetName) {
  const sheet = getSheetByNameOrCreate(sheetName);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return []; // ไม่มีข้อมูล หรือมีแค่ Header

  const headers = data[0];
  const result = [];

  for (let i = 1; i < data.length; i++) {
    let obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = data[i][j];
    }
    result.push(obj);
  }
  return result;
}

/**
 * =======================================================================
 * LOCATION / SETAREA MODULE
 * =======================================================================
 */

function handleGetLocation() {
  const data = getSheetDataAsObjects("location");
  console.log("Debug - handleGetLocation returned " + data.length + " areas");
  return { ok: true, data: data };
}

// สร้างรหัส qr_code ใหม่ที่ไม่ซ้ำกับของเดิมในชีต (ตัวอักษร+เลขสุ่ม พร้อม timestamp)
function generateUniqueQrCode(existingIds) {
  const used = new Set((existingIds || []).map((v) => String(v || "").trim()).filter(Boolean));
  let candidate = "";
  let attempt = 0;
  do {
    const stamp = new Date();
    const stampText =
      stamp.getFullYear() +
      String(stamp.getMonth() + 1).padStart(2, "0") +
      String(stamp.getDate()).padStart(2, "0") +
      String(stamp.getHours()).padStart(2, "0") +
      String(stamp.getMinutes()).padStart(2, "0") +
      String(stamp.getSeconds()).padStart(2, "0");
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    candidate = "AREA-" + stampText + "-" + rand + (attempt > 0 ? "-" + attempt : "");
    attempt++;
  } while (used.has(candidate));
  return candidate;
}

function saveLocation(payload) {
  const sheet = getSheetByNameOrCreate("location");
  const data = sheet.getDataRange().getValues();

  // โครงสร้าง Header ของชีต location (ตรงกับ Google Sheet จริง)
  const headers =
    data.length > 0
      ? data[0]
      : AREA_HEADERS;

  if (data.length === 0) {
    sheet.appendRow(headers);
  }

  const qrCodeColIndex = headers.indexOf("qr_code");

  // รายการ qr_code ที่มีอยู่แล้วทั้งหมด (ใช้ตรวจสอบความซ้ำ และหาแถวเดิม)
  const existingIds = [];
  if (qrCodeColIndex > -1) {
    for (let i = 1; i < data.length; i++) {
      existingIds.push(String(data[i][qrCodeColIndex] || "").trim());
    }
  }

  // targetId = แถวเดิมที่ต้องการ "แก้ไข" (มาจาก originalAreaId ที่ frontend ส่งมาตอนกด save พื้นที่ที่เคยมีอยู่แล้ว)
  // ถ้าไม่มี originalAreaId แปลว่าเป็นการ "สร้างใหม่" -> ห้ามไปจับคู่ทับแถวเดิมโดยเด็ดขาด
  const originalId = String(payload.originalAreaId || "").trim();
  const requestedNewId = String(payload.qr_code || payload.areaId || "").trim();
  const isCreatingNew = !originalId;

  let newId;
  if (isCreatingNew) {
    // กรณีสร้างใหม่: ถ้า frontend ส่งรหัสมาแล้วและไม่ชนกับของเดิม ใช้รหัสนั้นได้
    // ถ้าไม่ส่งมา หรือรหัสไปชนกับแถวที่มีอยู่แล้ว (เช่นค่าว่าง "" ชนกับแถวว่างเดิม) ให้สร้างรหัสใหม่ที่ไม่ซ้ำเสมอ
    if (requestedNewId && existingIds.indexOf(requestedNewId) === -1) {
      newId = requestedNewId;
    } else {
      newId = generateUniqueQrCode(existingIds);
    }
  } else {
    // กรณีแก้ไขของเดิม: ใช้รหัสใหม่ที่ระบุมา (ถ้ามีการเปลี่ยนรหัส) มิฉะนั้นคงรหัสเดิมไว้
    newId = requestedNewId || originalId;
  }

  const targetId = isCreatingNew ? "" : originalId;

  let rowIndex = -1;

  // ค้นหาแถวที่ต้องการแก้ไขโดยใช้ qr_code (เฉพาะกรณีแก้ไขของเดิมเท่านั้น ห้ามค้นหาตอนสร้างใหม่)
  if (!isCreatingNew && qrCodeColIndex > -1 && data.length > 1) {
    for (let i = 1; i < data.length; i++) {
      if (targetId !== "" && String(data[i][qrCodeColIndex]).trim() === targetId) {
        rowIndex = i + 1; // +1 เพราะแถวใน Apps Script เริ่มที่ 1
        break;
      }
    }
  }

  const rowData = [];
  const savedObj = {};

  // แมปข้อมูลลง Column (ตรงกับ Google Sheet จริง)
  for (let j = 0; j < headers.length; j++) {
    const h = headers[j];
    let val = payload[h] !== undefined ? payload[h] : "";

    // Map ค่าจาก payload ไปยัง column ที่ตรงกับ Google Sheet
    if (h === "qr_code") val = newId;
    if (h === "lat") val = payload.lat || payload.centerLat || "";
    if (h === "lng") val = payload.lng || payload.centerLng || "";
    if (h === "north") val = payload.north || payload.northMeters || "";
    if (h === "south") val = payload.south || payload.southMeters || "";
    if (h === "east") val = payload.east || payload.eastMeters || "";
    if (h === "west") val = payload.west || payload.westMeters || "";
    if (h === "remark") val = payload.remark || payload.note || payload.areaName || "";
    if (h === "assign") val = payload.assign || payload.visibleRoles || "";
    if (h === "email") val = payload.email || payload.visibleUsers || "";

    rowData.push(val);
    savedObj[h] = val;
  }

  // อัปเดตหรือเพิ่มแถวใหม่
  if (rowIndex > -1) {
    sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }

  // อัปเดตรายชื่อคนที่ถูก Assign พื้นที่นี้ (ชีตแยก)
  if (payload.assignees && Array.isArray(payload.assignees)) {
    updateAreaAssignments(newId, payload.assignees);
  }

  return { ok: true, data: [savedObj] };
}

function deleteLocation(payload) {
  const targetId = String(payload.qr_code || payload.areaId || payload.originalAreaId || "").trim();
  if (!targetId) throw new Error("ไม่พบ qr_code ที่ต้องการลบ");

  const sheet = getSheetByNameOrCreate("location");
  const data = sheet.getDataRange().getValues();

  if (data.length > 0) {
    const qrCodeColIndex = data[0].indexOf("qr_code");
    if (qrCodeColIndex > -1) {
      // ไล่ลบจากล่างขึ้นบน ป้องกัน index คลาดเคลื่อน
      for (let i = data.length - 1; i > 0; i--) {
        if (String(data[i][qrCodeColIndex]).trim() === targetId) {
          sheet.deleteRow(i + 1);
        }
      }
    }
  }

  // ลบข้อมูลการ Assign ในชีต AreaAssignments ด้วย (ใช้คอลัมน์ qr_code ให้ตรงกับ AREA_ASSIGNMENT_HEADERS)
  const asSheet = getSheetByNameOrCreate("AreaAssignments");
  const asData = asSheet.getDataRange().getValues();
  if (asData.length > 0) {
    const asQrCodeColIdx = asData[0].indexOf("qr_code");
    if (asQrCodeColIdx > -1) {
      for (let j = asData.length - 1; j > 0; j--) {
        if (String(asData[j][asQrCodeColIdx]).trim() === targetId) {
          asSheet.deleteRow(j + 1);
        }
      }
    }
  }

  return { ok: true, message: "ลบพื้นที่สำเร็จ" };
}

/**
 * =======================================================================
 * AREA ASSIGNMENTS MODULE (จัดการสิทธิ์การเข้าถึงพื้นที่)
 * =======================================================================
 */

function updateAreaAssignments(qrCode, assignees) {
  const sheet = getSheetByNameOrCreate("AreaAssignments");
  let data = sheet.getDataRange().getValues();
  const headers =
    data.length > 0
      ? data[0]
      : AREA_ASSIGNMENT_HEADERS;

  if (data.length === 0) {
    sheet.appendRow(headers);
    data = [headers];
  }

  const qrCodeColIndex = headers.indexOf("qr_code");

  // ลบข้อมูล Assign เก่าทั้งหมดของพื้นที่นี้ (ลบจากล่างขึ้นบน)
  if (qrCodeColIndex > -1 && data.length > 1) {
    for (let i = data.length - 1; i > 0; i--) {
      if (String(data[i][qrCodeColIndex]).trim() === String(qrCode).trim()) {
        sheet.deleteRow(i + 1);
      }
    }
  }

  // เขียนข้อมูล Assign ใหม่เข้าไป (Many-to-Many)
  const now = new Date().toISOString();
  for (let k = 0; k < assignees.length; k++) {
    const assignee = assignees[k];
    const rowData = [];

    for (let j = 0; j < headers.length; j++) {
      const h = headers[j];
      if (h === "qr_code") {
        rowData.push(qrCode);
      } else if (h === "updatedAt" || h === "createdAt") {
        rowData.push(now);
      } else {
        rowData.push(assignee[h] !== undefined ? assignee[h] : "");
      }
    }
    sheet.appendRow(rowData);
  }
}

/**
 * =======================================================================
 * USERS MODULE
 * =======================================================================
 */

function handleGetUsers(params) {
  let data = getSheetDataAsObjects("users");

  // รองรับการกรองด้วย Email
  if (params.email) {
    data = data.filter(
      (u) =>
        String(u.email).toLowerCase() === String(params.email).toLowerCase(),
    );
  }

  return { ok: true, data: data };
}

function saveUser(payload) {
  const sheet = getSheetByNameOrCreate("users");
  const data = sheet.getDataRange().getValues();

  const headers =
    data.length > 0
      ? data[0]
      : [
          "uid",
          "email",
          "displayName",
          "role",
          "active",
          "visibleAreas",
          "note",
          "updatedAt",
          "updatedBy",
        ];

  if (data.length === 0) {
    sheet.appendRow(headers);
  }

  const targetEmail = String(payload.email || "")
    .trim()
    .toLowerCase();
  const targetUid = String(payload.uid || "").trim();

  if (!targetEmail && !targetUid)
    throw new Error("Missing user identification (email/uid)");

  let rowIndex = -1;
  const emailColIdx = headers.indexOf("email");
  const uidColIdx = headers.indexOf("uid");

  // ค้นหา User เดิม
  for (let i = 1; i < data.length; i++) {
    const rowEmail =
      emailColIdx > -1 ? String(data[i][emailColIdx]).trim().toLowerCase() : "";
    const rowUid = uidColIdx > -1 ? String(data[i][uidColIdx]).trim() : "";

    if (
      (targetEmail && rowEmail === targetEmail) ||
      (targetUid && rowUid === targetUid)
    ) {
      rowIndex = i + 1;
      break;
    }
  }

  const now = new Date().toISOString();
  const rowData = [];
  const savedObj = {};

  for (let j = 0; j < headers.length; j++) {
    const h = headers[j];
    let val = payload[h] !== undefined ? payload[h] : "";
    if (h === "updatedAt") val = now;
    if (h === "active")
      val = val !== false && String(val).toLowerCase() !== "false";

    rowData.push(val);
    savedObj[h] = val;
  }

  if (rowIndex > -1) {
    sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }

  return { ok: true, data: [savedObj] };
}

function deleteUser(payload) {
  const targetEmail = String(payload.email || "")
    .trim()
    .toLowerCase();
  const targetUid = String(payload.uid || "").trim();

  if (!targetEmail && !targetUid)
    throw new Error("Missing user identification for deletion");

  const sheet = getSheetByNameOrCreate("users");
  const data = sheet.getDataRange().getValues();

  if (data.length > 1) {
    const emailColIdx = data[0].indexOf("email");
    const uidColIdx = data[0].indexOf("uid");

    for (let i = data.length - 1; i > 0; i--) {
      const rowEmail =
        emailColIdx > -1
          ? String(data[i][emailColIdx]).trim().toLowerCase()
          : "";
      const rowUid = uidColIdx > -1 ? String(data[i][uidColIdx]).trim() : "";

      if (
        (targetEmail && rowEmail === targetEmail) ||
        (targetUid && rowUid === targetUid)
      ) {
        sheet.deleteRow(i + 1);
      }
    }
  }

  return { ok: true, message: "User deleted successfully" };
}

/**
 * =======================================================================
 * LINE CHECK-IN USER REGISTRY (ชีต user)
 * =======================================================================
 */

function ensureLineCheckinUserSheet() {
  const sheet = getSheetByNameOrCreate(LINE_CHECKIN_USER_SHEET);
  const lastRow = sheet.getLastRow();

  if (lastRow === 0) {
    sheet.appendRow(LINE_CHECKIN_USER_HEADERS);
    return sheet;
  }

  const lastCol = sheet.getLastColumn();
  const headers = sheet
    .getRange(1, 1, 1, Math.max(lastCol, 1))
    .getValues()[0]
    .map(function (h) {
      return String(h || "").trim();
    });
  const existing = new Set(headers.filter(Boolean));
  const missing = LINE_CHECKIN_USER_HEADERS.filter(function (h) {
    return !existing.has(h);
  });

  if (missing.length > 0) {
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
  }

  return sheet;
}

function findLineCheckinUserRowIndex(sheet, userId) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return -1;

  const headers = data[0].map(function (h) {
    return String(h || "").trim();
  });
  const userIdColIdx = headers.indexOf("userId");
  if (userIdColIdx === -1) return -1;

  const target = String(userId || "").trim();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][userIdColIdx] || "").trim() === target) {
      return i + 1;
    }
  }
  return -1;
}

function getLineCheckinUserByUserId(userId) {
  const uid = String(userId || "").trim();
  if (!uid) return null;

  ensureLineCheckinUserSheet();
  const list = getSheetDataAsObjects(LINE_CHECKIN_USER_SHEET);
  return (
    list.find(function (u) {
      return String(u.userId || "").trim() === uid;
    }) || null
  );
}

function ensureLineCheckinUser(payload) {
  ensureLineCheckinUserSheet();

  const userId = String(payload.userId || "").trim();
  if (!userId) return null;

  const sheet = getSheetByNameOrCreate(LINE_CHECKIN_USER_SHEET);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(function (h) {
    return String(h || "").trim();
  });
  const now = new Date().toISOString();
  const lineName = String(payload.displayName || payload.name || "").trim();
  const email = String(payload.email || "").trim().toLowerCase();
  const rowIndex = findLineCheckinUserRowIndex(sheet, userId);

  if (rowIndex > 0) {
    const row = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
    const nameCol = headers.indexOf("name");
    const emailCol = headers.indexOf("email");
    const updatedCol = headers.indexOf("updatedAt");

    if (emailCol > -1 && email && !String(row[emailCol] || "").trim()) {
      row[emailCol] = email;
    }
    if (nameCol > -1 && lineName && !String(row[nameCol] || "").trim()) {
      row[nameCol] = lineName;
    }
    if (updatedCol > -1) row[updatedCol] = now;

    sheet.getRange(rowIndex, 1, 1, headers.length).setValues([row]);

    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = row[j];
    }
    return obj;
  }

  const rowData = headers.map(function (h) {
    if (h === "userId") return userId;
    if (h === "name") return lineName;
    if (h === "currentName") return "";
    if (h === "email") return email;
    if (h === "updatedAt") return now;
    return "";
  });
  sheet.appendRow(rowData);

  const saved = {};
  for (let k = 0; k < headers.length; k++) {
    saved[headers[k]] = rowData[k];
  }
  return saved;
}

function updateLineCheckinUserCurrentName(userId, currentName, email) {
  ensureLineCheckinUserSheet();

  const uid = String(userId || "").trim();
  const nextName = String(currentName || "").trim();
  if (!uid || !nextName) return false;

  const sheet = getSheetByNameOrCreate(LINE_CHECKIN_USER_SHEET);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(function (h) {
    return String(h || "").trim();
  });
  const now = new Date().toISOString();
  let rowIndex = findLineCheckinUserRowIndex(sheet, uid);

  if (rowIndex === -1) {
    const rowData = headers.map(function (h) {
      if (h === "userId") return uid;
      if (h === "name") return nextName;
      if (h === "currentName") return nextName;
      if (h === "email") return String(email || "").trim().toLowerCase();
      if (h === "updatedAt") return now;
      return "";
    });
    sheet.appendRow(rowData);
    return true;
  }

  const row = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  const nameCol = headers.indexOf("name");
  const currentCol = headers.indexOf("currentName");
  const emailCol = headers.indexOf("email");
  const updatedCol = headers.indexOf("updatedAt");

  if (currentCol > -1) row[currentCol] = nextName;
  if (nameCol > -1 && !String(row[nameCol] || "").trim()) row[nameCol] = nextName;
  if (emailCol > -1 && email && !String(row[emailCol] || "").trim()) {
    row[emailCol] = String(email).trim().toLowerCase();
  }
  if (updatedCol > -1) row[updatedCol] = now;

  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
  return true;
}

function resolveLogDisplayName(payload, lineUser) {
  const fromCurrent =
    lineUser && String(lineUser.currentName || "").trim();
  if (fromCurrent) return fromCurrent;

  const fromLineName = lineUser && String(lineUser.name || "").trim();
  if (fromLineName) return fromLineName;

  return String(payload.displayName || payload.name || "").trim();
}

function logRowMatchesUser(rowUserId, rowEmail, targetUserId, targetEmail) {
  if (targetUserId && rowUserId && rowUserId === targetUserId) return true;
  if (targetEmail && rowEmail && rowEmail === targetEmail) return true;
  return false;
}

/**
 * =======================================================================
 * LOGS MODULE
 * =======================================================================
 */

function handleGetLogs(params) {
  ensureLogsSheetSchema();
  let data = getSheetDataAsObjects(LOGS_SHEET_NAME);

  // กรองตาม userId หรือ email สำหรับการค้นหาชื่อ
  if (params.userId) {
    const searchUserId = String(params.userId).trim();
    data = data.filter(log => String(log.userId || '').trim() === searchUserId);
  } else if (params.email) {
    const searchEmail = String(params.email).toLowerCase();
    data = data.filter(log => String(log.email || '').toLowerCase() === searchEmail);
  }

  // กรองตามชื่อ (displayName) ถ้ามี
  if (params.name) {
    const searchName = String(params.name).toLowerCase();
    data = data.filter(log => String(log.displayName || log.name || '').toLowerCase().includes(searchName));
  }

  // กรองตามช่วงวันที่ (ตีความ from/to เป็นวันที่ตามเขตเวลา Asia/Bangkok ไม่ใช่ UTC
  // เพราะ frontend ส่งวันที่แบบ Bangkok-local มา เช่น "วันนี้" ตาม timezone ไทย
  // Bangkok = UTC+7 ดังนั้นเที่ยงคืนของวันที่ Bangkok = เวลา -07:00 ของวันเดียวกันใน UTC)
  if (params.from || params.to) {
    const fromDate = params.from ? new Date(params.from + 'T00:00:00.000+07:00') : null;
    const toDate = params.to ? new Date(params.to + 'T23:59:59.999+07:00') : null;

    data = data.filter(log => {
      const logDate = new Date(log.createdAt);
      return (!fromDate || logDate >= fromDate) && (!toDate || logDate <= toDate);
    });
  }

  // เรียงลำดับจากใหม่ไปเก่า (descending by createdAt)
  data.sort((a, b) => {
    const timeA = new Date(a.createdAt || 0).getTime();
    const timeB = new Date(b.createdAt || 0).getTime();
    return timeB - timeA;
  });

  // สำหรับ Export ไม่ต้องแบ่งหน้า
  if (params.export) {
    return { ok: true, data: data };
  }

  const offset = parseInt(params.offset || 0, 10);
  const limit = parseInt(params.limit || 15, 10);
  const total = data.length;
  const hasMore = (offset + limit) < total;

  data = data.slice(offset, offset + limit);

  return { ok: true, data: data, meta: { total: total, hasMore: hasMore } };
}

/**
 * ฟังก์ชันคำนวณหาระยะทางระหว่างพิกัด (เมตร) เพื่อตรวจสอบความถูกต้องบน Server
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // รัศมีโลกเป็นเมตร
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * ตรวจสอบว่าพิกัดอยู่ในขอบเขตที่กำหนดหรือไม่ (Server-side Validation)
 *
 * ⚠️ ข้อกำหนดสำคัญ: ฟังก์ชันนี้ต้อง "ไม่มีการอนุโลม" ระยะทางใดๆ ทั้งสิ้น
 * ห้ามเพิ่มค่าบัฟเฟอร์/ระยะผ่อนปรน (เช่น +5.5 เมตร หรือใช้ accuracy มาขยายขอบเขต) เด็ดขาด
 * ผู้ใช้ต้องอยู่ในกรอบสี่เหลี่ยมที่ตั้งไว้จริงเท่านั้นจึงเช็กอินผ่าน — นี่คือเจตนาของระบบ ไม่ใช่บั๊ก
 */
function validateGeofence(payload) {
  const areaId = payload.areaId || "default";
  const lat = Number(payload.lat);
  const lng = Number(payload.lng);

  if (isNaN(lat) || isNaN(lng)) return { ok: false, err: "พิกัดไม่ถูกต้อง" };

  const areas = getSheetDataAsObjects("location");
  // ค้นหาพื้นที่โดยเน้นที่ areaId หรือ qr_code (รองรับ Legacy)
  let area = areas.find(a => {
    const id = String(a.areaId || a.qr_code || "").trim();
    return id === String(areaId).trim();
  });

  // ถ้าไม่พบพื้นที่ ให้ใช้ค่า default
  if (!area) {
    area = DEFAULT_AREA;
  }

  const centerLat = Number(area.lat || area.centerLat);
  const centerLng = Number(area.lng || area.centerLng);

  if (isNaN(centerLat) || isNaN(centerLng)) {
    // ข้อมูลพื้นที่ผิดปกติ — ปฏิเสธการเช็กอินแทนการปล่อยผ่าน (fail-closed ไม่ใช่ fail-open)
    return { ok: false, err: "ไม่พบข้อมูลพื้นที่ที่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบ" };
  }

  // คำนวณขอบเขตสี่เหลี่ยม (แบบเดียวกับ frontend) — ไม่มีการบวกเพิ่มระยะอนุโลมใดๆ
  const north = Number(area.north || area.northMeters || 50);
  const south = Number(area.south || area.southMeters || 50);
  const east = Number(area.east || area.eastMeters || 80);
  const west = Number(area.west || area.westMeters || 50);

  // แปลงเมตรเป็นเดลต้าพิกัด (โดยประมาณ)
  const latDeltaNorth = north / 111320;
  const latDeltaSouth = south / 111320;
  const cosLat = Math.cos((centerLat * Math.PI) / 180) || 1;
  const lngDeltaEast = east / (111320 * cosLat);
  const lngDeltaWest = west / (111320 * cosLat);

  const minLat = centerLat - latDeltaSouth;
  const maxLat = centerLat + latDeltaNorth;
  const minLng = centerLng - lngDeltaWest;
  const maxLng = centerLng + lngDeltaEast;

  // เช็คแบบเข้มงวด: ต้องอยู่ในกรอบพอดี ไม่มี <= / >= บวกเพิ่มระยะใดๆ ทั้งสิ้น
  const isInside = lat >= minLat && lat <= maxLat &&
                     lng >= minLng && lng <= maxLng;

  if (!isInside) {
    const areaLabel = area.areaName || area.remark || areaId;
    return { ok: false, err: "ขออภัย คุณอยู่นอกพื้นที่ทำงานที่กำหนดไว้ (" + areaLabel + ")" };
  }

  return { ok: true };
}

function saveLog(payload) {
  // หมายเหตุสำคัญ: userId ในที่นี้คือ LINE userId (รหัสถาวรจาก LIFF) ซึ่งเป็นตัวจับคู่หลักของคนเช็คอิน
  // ห้าม fallback เป็น email เพราะจะทำให้ userId ปนกับ email และจับคู่ผิดพลาดตอนแก้ไขชื่อใน Logs
  // ถ้าไม่มี userId จริงๆ (เคสที่ไม่ผ่าน LIFF) ให้เก็บเป็นค่าว่างไว้ แล้วใช้ email เป็นตัวจับคู่สำรองแทน

  // --- ตรวจสอบพื้นที่ทำงาน (เข้มงวด ไม่มีการอนุโลมระยะทางใดๆ ทั้งสิ้น) ---
  const validation = validateGeofence(payload);
  if (!validation.ok) {
    return { ok: false, err: validation.err };
  }
  // -------------------------------------------

  const lineUser =
    ensureLineCheckinUser(payload) ||
    getLineCheckinUserByUserId(payload.userId);
  const resolvedDisplayName = resolveLogDisplayName(payload, lineUser);
  const resolvedUserId = String(payload.userId || "").trim();

  const sheet = ensureLogsSheetSchema();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const rowData = headers.map(function (h) {
    if (h === "createdAt") return payload.time || new Date().toISOString();
    if (h === "displayName") return resolvedDisplayName;
    if (h === "email") return payload.email || "";
    if (h === "site") return payload.site || "";
    if (h === "session") return payload.session || "";
    if (h === "lat") return payload.lat || "";
    if (h === "lng") return payload.lng || "";
    if (h === "accuracy") return payload.accuracy || "";
    if (h === "userId") return resolvedUserId;
    if (h === "pictureUrl") return payload.pictureUrl || "";
    if (h === "status") return payload.status || "checked_in";
    return payload[h] || "";
  });

  sheet.appendRow(rowData);
  return {
    ok: true,
    message: "Log saved successfully",
    userId: resolvedUserId,
    displayName: resolvedDisplayName,
  };
}

/**
 * บันทึกชื่อที่ admin ใส่ให้กับคนเช็คอินที่ LINE ไม่ได้ตั้งชื่อมา (หรือไม่มีชื่อในระบบ)
 * ตัวจับคู่หลักคือ LINE userId (รหัสถาวรจาก LIFF ที่ติดมากับทุกครั้งที่เช็คอิน)
 * ถ้าแถวนั้นไม่มี userId เลย จะ fallback ไปจับคู่ด้วย email แทน
 *
 * เมื่อบันทึกสำเร็จ ชื่อจะถูกใส่ให้กับ "ทุกแถว Log ของคนนั้น" ที่ยังไม่มีชื่อ (ไม่ใช่แค่แถวเดียว)
 * เพื่อให้ตรงกับเงื่อนไข: คนที่มีชื่ออยู่แล้วไม่ต้องให้กรอกซ้ำอีก
 */
function handleSaveLogName(payload) {
  const sheet = ensureLogsSheetSchema();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const userIdColIdx = headers.indexOf("userId");
  const emailColIdx = headers.indexOf("email");
  const displayNameColIdx = headers.indexOf("displayName");

  if (userIdColIdx === -1 && emailColIdx === -1) {
    return { ok: false, err: "ไม่พบ userId หรือ email ใน Logs Sheet" };
  }
  if (displayNameColIdx === -1) {
    return { ok: false, err: "ไม่พบ displayName ใน Logs Sheet" };
  }

  const targetUserId = String(payload.userId || "").trim();
  const targetEmail = String(payload.email || "").trim().toLowerCase();
  const newDisplayName = String(payload.displayName || "").trim();

  if (!targetUserId && !targetEmail) {
    return { ok: false, err: "ไม่พบ userId หรือ email ของรายการที่ต้องการตั้งชื่อ" };
  }
  if (!newDisplayName) {
    return { ok: false, err: "กรุณาระบุชื่อที่ต้องการบันทึก" };
  }

  if (targetUserId) {
    updateLineCheckinUserCurrentName(targetUserId, newDisplayName, targetEmail);
  }

  let updatedCount = 0;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowUserId = userIdColIdx !== -1 ? String(row[userIdColIdx] || "").trim() : "";
    const rowEmail = emailColIdx !== -1 ? String(row[emailColIdx] || "").trim().toLowerCase() : "";

    const isMatch = logRowMatchesUser(
      rowUserId,
      rowEmail,
      targetUserId,
      targetEmail,
    );

    if (isMatch) {
      row[displayNameColIdx] = newDisplayName;
      if (targetUserId && userIdColIdx !== -1 && !rowUserId) {
        row[userIdColIdx] = targetUserId;
      }
      sheet.getRange(i + 1, 1, 1, headers.length).setValues([row]);
      updatedCount++;
    }
  }

  if (updatedCount === 0) {
    return { ok: false, err: "ไม่พบรายการ Log ที่ตรงกันเพื่ออัปเดตชื่อ" };
  }

  return {
    ok: true,
    message: "อัปเดตชื่อ " + updatedCount + " รายการสำเร็จ",
    updatedCount: updatedCount,
    userId: targetUserId,
    displayName: newDisplayName,
  };
}
