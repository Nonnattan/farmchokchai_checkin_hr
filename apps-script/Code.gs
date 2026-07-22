const SPREADSHEET_ID = "1CqGpZZP9jofU5EcKC2G3J60tiO2cSw7flTn4ZAJH4X0";
const LOGS_SHEET_NAME = "Logs";
const TEST_SHEET_NAME = "Test";
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
  "lat",
  "lng",
  "accuracy",
  "userId",
  "status",
  "distantcenter", // ระยะห่างจากจุดศูนย์กลางพื้นที่ (เมตร) — เพิ่มตามคำขอ เพื่อดูย้อนหลังว่าตอนเช็กอินอยู่ห่างจากจุดศูนย์กลางเท่าไร
  "employeeId", // รหัสพนักงาน — เพิ่มตามคำขอสำหรับ Export TigerSoft (ค่า mirror มาจาก Sheet "user" ตอนเช็กอิน/enrich)
  "halfDayStatus", // "ครึ่งแรก"/"ครึ่งหลัง" — เพิ่มตามคำขอ เพื่อให้เห็นค่านี้ตรงใน Google Sheet เหมือนหน้าเว็บ Logs
];

// Schema สำหรับ Sheet "Test" — เหมือน Logs แต่เพิ่ม sampleIndex และ areaId เพื่อระบุว่าเป็นการอ่านครั้งที่เท่าไร
const TEST_LOG_HEADERS = [
  "displayName",
  "email",
  "phone",
  "lat",
  "lng",
  "createdAt",
  "site",
  "userId",
  "status",
  "accuracy",
  "distantcenter",
  "sampleIndex",
];

// ชีต Logs รุ่นเก่า (ก่อนระบบนี้) ใช้หัวคอลัมน์ชื่ออื่น — แมปชื่อเก่า -> ชื่อใหม่ที่โค้ดนี้ต้องใช้
// เพื่อให้ข้อมูลเก่าที่มีอยู่แล้วยังอ่านได้ถูกต้องหลัง migrate (ไม่ลบข้อมูลเดิม แค่เปลี่ยนชื่อหัวคอลัมน์/เพิ่มคอลัมน์ที่ขาด)
const LEGACY_LOG_HEADER_RENAME = {
  Name: "displayName",
  Email: "email",
  Phone: "phone",
  Lat: "lat",
  Lng: "lng",
  Time: "createdAt",
};

/**
 * ตรวจและแก้ไขหัวคอลัมน์ของชีต Logs ให้ตรงกับ LOG_HEADERS เสมอ
 * - ถ้าเจอหัวคอลัมน์เก่า (Name/Email/Phone/Lat/Lng/Time) จะเปลี่ยนชื่อหัวให้ตรง schema ใหม่ทันที (ข้อมูลแถวเดิมไม่เสีย เพราะคอลัมน์ตำแหน่งเดิม)
 * - คอลัมน์ใหม่ที่ขาดไปจาก schema ปัจจุบัน (เช่น createdAt, userId, site, status)
 *   จะถูกเพิ่มเป็นคอลัมน์ใหม่ต่อท้าย โดยไม่ลบหรือแก้ข้อมูลแถวที่มีอยู่แล้วเลย
 * - ฟังก์ชันนี้ปลอดภัยที่จะเรียกซ้ำได้ทุกครั้ง (idempotent)
 */
// บังคับคอลัมน์ createdAt ให้เป็น Plain Text (number format "@") เสมอ
// ต้นเหตุจริงของบั๊กเวลาเพี้ยน +7 ชั่วโมง: Google Sheets auto-convert ข้อความเวลาไทยที่เขียนเข้าไป
// (เช่น "2026/07/21 08:55:40") ให้กลายเป็นชนิด Date ให้เองถ้าคอลัมน์ไม่ได้ตั้ง format เป็น Plain Text
// ไว้ก่อน แล้วพอ Apps Script อ่านค่า Date นั้นกลับมาต้อง format กลับเป็นข้อความอีกที ก็ต้องเดา/พึ่ง
// timezone ที่อาจไม่ตรงกับตอนที่ Sheets ใช้ตีความตอน auto-convert ทำให้ตัวเลขเพี้ยนไป — วิธีตัดปัญหา
// ทั้งหมดคือบังคับให้คอลัมน์นี้เป็น Plain Text ตั้งแต่ต้น ค่าที่เขียนเข้าไปจะเป็น "text ตัวเดิมเป๊ะๆ"
// ตลอดไป ไม่มีการแปลงชนิดใดๆ เกิดขึ้นเลย ไม่ว่าจะตั้ง timezone ของสเปรดชีต/สคริปต์เป็นอะไรก็ตาม
function forceCreatedAtPlainText_(sheet, headers) {
  const createdAtColIndex = headers.indexOf("createdAt") + 1; // 1-based, 0 = ไม่เจอ
  if (createdAtColIndex <= 0) return;
  const numRows = Math.max(sheet.getMaxRows() - 1, 1);
  sheet.getRange(2, createdAtColIndex, numRows, 1).setNumberFormat("@");
}

function ensureLogsSheetSchema() {
  const sheet = getSheetByNameOrCreate(LOGS_SHEET_NAME);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow === 0) {
    // ชีตยังไม่มีอะไรเลย สร้าง header ใหม่ตาม schema ปัจจุบัน
    sheet.appendRow(LOG_HEADERS);
    forceCreatedAtPlainText_(sheet, LOG_HEADERS);
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
    sheet
      .getRange(1, headers.length + 1, 1, missing.length)
      .setValues([missing]);
    headers = headers.concat(missing);
  }

  forceCreatedAtPlainText_(sheet, headers);

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
  "maxAccuracy",
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
  "employeeId", // รหัสพนักงาน — เพิ่มตามคำขอสำหรับ Export TigerSoft, admin เป็นผู้กรอกให้ผ่านหน้า Logs
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
  // ตรวจสอบว่ามีข้อมูลส่งมาหรือไม่ (ย้ายมาก่อนล็อก เพราะแค่ parse JSON ไม่ต้องรอคิว
  // และต้อง parse ก่อน เพื่อเอา action/checkinRequestId ไปเช็ก cache ด้านล่าง)
  if (!e.postData || !e.postData.contents) {
    return responseJson({ ok: false, error: "ไม่พบข้อมูลที่ส่งมา" });
  }

  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return responseJson({ ok: false, error: "รูปแบบข้อมูลที่ส่งมาไม่ถูกต้อง" });
  }
  const action = payload.action;

  // =======================================================================
  // BUGFIX (Client เห็น Error "ระบบมีผู้ใช้งานพร้อมกันจำนวนมาก" ทั้งที่ Backend บันทึกสำเร็จแล้ว):
  // -----------------------------------------------------------------------
  // สาเหตุจริง: Client มี Timeout ฝั่งตัวเอง (AbortController + Promise.race hard-timeout ใน
  // common.js) ถ้า Apps Script execution ช้ากว่านั้น (เช่น Sheet โตขึ้นเรื่อยๆ ทำให้อ่านข้อมูลช้า —
  // ดูจุดแก้ใน saveLog()/saveTestLog() ด้านล่าง) Client จะ "ยกเลิกการรอ" แล้วขึ้น dialog ให้ผู้ใช้
  // กด "ลองใหม่" แต่การ abort() ฝั่ง Client ไม่ได้สั่งให้ Apps Script หยุดทำงานจริง (Google รัน
  // execution นั้นต่อจนจบอยู่ดี) พอผู้ใช้กด "ลองใหม่" มันคือการยิง POST เช็คอิน "ก้อนข้อมูลเดิม"
  // ซ้ำไปอีกรอบ ขณะที่ request แรกอาจกำลังจะเขียนเสร็จพอดี → request ที่สองต้องรอคิว lock แล้ว
  // อาจโดน timeout ของ lock (10 วิ) ขึ้น error ให้เห็น ทั้งที่ request แรกเขียนข้อมูลสำเร็จไปแล้ว
  //
  // วิธีแก้: ให้ Client แนบ checkinRequestId (สุ่มครั้งเดียวตอนสร้างข้อมูลเช็คอิน แล้วใช้ค่าเดิมซ้ำ
  // ทุกครั้งที่ "ลองใหม่" — ดู buildPayload() ใน user-checkin-enhanced.js) มาด้วยทุกครั้งที่บันทึก log
  // ถ้าเจอว่า checkinRequestId นี้เคยบันทึกสำเร็จไปแล้ว (เก็บไว้ใน CacheService สูงสุด 6 ชม.)
  // ให้ตอบผลลัพธ์เดิมกลับไปทันที ไม่ต้องเข้าคิว lock ซ้ำ ไม่เขียนแถวซ้ำ และไม่โยน error หลอกๆ
  // ให้ผู้ใช้เห็นทั้งที่ backend ทำสำเร็จแล้ว
  // =======================================================================
  if (action === "logs") {
    const requestId = String(payload.checkinRequestId || "").trim();
    if (requestId) {
      const cached = getCachedCheckinResult(requestId);
      if (cached) return responseJson(cached);
    }
  }

  // =======================================================================
  // ล็อกสคริปต์ก่อนเขียนข้อมูลลง Google Sheet ทุกครั้ง (จุดสำคัญที่แก้บั๊ก Logs มีแค่แถวเดียว)
  // -----------------------------------------------------------------------
  // สาเหตุเดิม: appendRow() ของ Apps Script ไม่ได้ atomic จริงๆ มันอ่าน "แถวล่าสุด" ก่อน
  // แล้วค่อยเขียนแถวถัดไป ถ้ามีคนกดเช็คอินพร้อมกันหลายคน (เช่น ทัวร์ทั้งกลุ่มสแกน QR
  // เวลาไล่เลี่ยกัน) แต่ละ request จะแย่งกันอ่าน/เขียนจังหวะเดียวกัน ทำให้บาง request
  // เขียนทับแถวของอีก request หนึ่งโดยไม่ตั้งใจ ผลคือเช็คอินเข้ามาหลายคนแต่ใน Sheet
  // เหลือแค่แถวเดียว (หรือไม่กี่แถว) ทั้งที่โค้ดส่วน saveLog() เขียนถูกต้องอยู่แล้ว
  // วิธีแก้คือบังคับให้ทุก request ที่จะเขียนข้อมูล เข้าคิวทีละ 1 request เท่านั้น
  // =======================================================================
  const lock = LockService.getScriptLock();
  try {
    const gotLock = lock.tryLock(10000); // รอคิวได้สูงสุด 10 วินาที
    if (!gotLock) {
      // เช็กอีกรอบก่อนโยน error: เผื่อ request ที่ถือ lock อยู่ (อาจเป็น request เดิมของเรา
      // ที่ Client เคย timeout ทิ้งไปแล้วลองใหม่) เพิ่งเขียนสำเร็จและ cache ผลลัพธ์ไปพอดีระหว่างที่เรารอคิว
      if (action === "logs") {
        const requestId = String(payload.checkinRequestId || "").trim();
        if (requestId) {
          const cachedAfterWait = getCachedCheckinResult(requestId);
          if (cachedAfterWait) return responseJson(cachedAfterWait);
        }
      }
      throw new Error(
        "ระบบมีผู้ใช้งานพร้อมกันจำนวนมาก กรุณาลองกดเช็คอินใหม่อีกครั้ง",
      );
    }

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
    } else if (action === "testLog") {
      // GPS Test Mode: บันทึกลง Sheet "Test" ทันที ไม่ตรวจ Geofence
      result = saveTestLog(payload);
    } else if (action === "saveLogName") {
      result = handleSaveLogName(payload);
    } else if (action === "saveLogEmployeeId") {
      result = handleSaveLogEmployeeId(payload);
    } else {
      result = { ok: false, error: "ไม่พบ Action POST: " + action };
    }

    return responseJson(result);
  } catch (err) {
    return responseJson({ ok: false, error: err.message });
  } finally {
    // ปล่อยล็อกเสมอไม่ว่าจะสำเร็จหรือ error เพื่อให้ request ถัดไปในคิวทำงานต่อได้
    lock.releaseLock();
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
// หมายเหตุ: ใช้ SPREADSHEET_ID เปิดไฟล์เป้าหมายแบบเจาะจงเสมอ (ไม่ใช้ getActiveSpreadsheet())
// เพราะ getActiveSpreadsheet() จะอ้างอิงถูกก็ต่อเมื่อสคริปต์ถูก "ผูก" กับ Google Sheet ไฟล์นั้นโดยตรง
// ถ้าโปรเจกต์ Apps Script ถูกสร้างแยกต่างหาก หรือถูกคัดลอกไปเป็นโปรเจกต์ใหม่ตอน deploy ซ้ำ
// (ซึ่งเกิดขึ้นได้ง่ายเวลาทำตามขั้นตอน "วางทับใน Apps Script Editor" ในเอกสาร)
// getActiveSpreadsheet() อาจหาไม่เจอหรือชี้ไปคนละไฟล์ ทำให้ข้อมูลเช็คอินไม่ถูกเขียนลง
// Google Sheet ที่ผู้ใช้เปิดดูอยู่จริง ใช้ openById(SPREADSHEET_ID) จึงชัดเจนและเชื่อถือได้กว่า

// ⚠️ BUGFIX: ฟังก์ชันช่วยแปลงค่าตัวเลขแบบปลอดภัย ใช้แทน `value || fallback` ทุกจุดที่อ่าน/เขียน
// lat, lng, north/south/east/west, maxAccuracy, accuracy — เพราะ `value || fallback` จะถือว่า 0
// เป็นค่า falsy แล้วเปลี่ยนไปใช้ fallback แทนโดยไม่ตั้งใจ (เช่น ถ้า Admin ตั้งขอบเขตทิศใดทิศหนึ่ง = 0
// เมตรพอดี ค่าจะถูกเขียนเป็นค่าว่างแล้วอ่านกลับมาเป็นค่า default แทน ทำให้ขอบเขตพื้นที่จริงคลาดเคลื่อน)
function numOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// ⚠️ BUGFIX: cache ผลลัพธ์การเช็คอิน (keyed ด้วย checkinRequestId ที่ Client สุ่มมาครั้งเดียว
// ต่อการเช็คอิน 1 ครั้ง) ใช้ตัดวงจร "Client timeout แล้วลองใหม่ ทั้งที่ backend เขียนสำเร็จแล้ว"
// CacheService เก็บได้สูงสุด 6 ชม. (21600 วิ) ต่อ key ซึ่งยาวนานพอเทียบกับเวลาที่ผู้ใช้จะกด "ลองใหม่"
const CHECKIN_CACHE_PREFIX = "checkin_result:";
const CHECKIN_CACHE_TTL_SEC = 21600;

function getCachedCheckinResult(requestId) {
  if (!requestId) return null;
  try {
    const raw = CacheService.getScriptCache().get(
      CHECKIN_CACHE_PREFIX + requestId,
    );
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null; // cache ใช้ไม่ได้ก็ไม่เป็นไร ให้ไปเขียนตามปกติ ไม่บล็อกการเช็คอิน
  }
}

function cacheCheckinResult(requestId, result) {
  if (!requestId) return;
  try {
    CacheService.getScriptCache().put(
      CHECKIN_CACHE_PREFIX + requestId,
      JSON.stringify(result),
      CHECKIN_CACHE_TTL_SEC,
    );
  } catch (e) {
    // เขียน cache ไม่สำเร็จก็ไม่ต้องทำให้การเช็คอินล้มเหลว
  }
}

function getSheetByNameOrCreate(sheetName) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
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
  // BUGFIX: เดิมฟังก์ชันนี้อ่านชีตตรงๆ โดยไม่เรียก ensureLocationSheetSchema() ก่อน
  // ถ้าพื้นที่แถวเก่าถูกสร้างไว้ก่อนที่ระบบจะมีคอลัมน์ maxAccuracy คอลัมน์นี้จะไม่มีอยู่เลย
  // (ไม่ใช่แค่ค่าว่าง) ทำให้ maxAccuracy เป็น undefined เสมอจนกว่าจะมีการกด "บันทึก" พื้นที่นั้นซ้ำ
  // เรียกฟังก์ชันนี้ก่อนอ่านทุกครั้งจะเพิ่มคอลัมน์ที่ขาดให้อัตโนมัติ (ปลอดภัย ไม่กระทบข้อมูลเดิม)
  ensureLocationSheetSchema();
  const rawData = getSheetDataAsObjects("location");
  // แมปข้อมูลให้มี areaId และ areaName เสมอ เพื่อให้ frontend ใช้งานง่าย
  const data = rawData.map((row) => {
    return {
      ...row,
      areaId: row.areaId || row.qr_code || "",
      areaName: row.areaName || row.remark || row.siteName || "",
    };
  });
  console.log("Debug - handleGetLocation returned " + data.length + " areas");
  return { ok: true, data: data };
}

// สร้างรหัส qr_code ใหม่ที่ไม่ซ้ำกับของเดิมในชีต (ตัวอักษร+เลขสุ่ม พร้อม timestamp)
function generateUniqueQrCode(existingIds) {
  const used = new Set(
    (existingIds || []).map((v) => String(v || "").trim()).filter(Boolean),
  );
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
    candidate =
      "AREA-" + stampText + "-" + rand + (attempt > 0 ? "-" + attempt : "");
    attempt++;
  } while (used.has(candidate));
  return candidate;
}

/**
 * Ensure Location sheet has all required columns
 * Task 5: Automatically create the Accuracy column if it doesn't exist
 */
function ensureLocationSheetSchema() {
  const sheet = getSheetByNameOrCreate("location");
  const data = sheet.getDataRange().getValues();

  if (data.length === 0) {
    // Sheet is empty, create headers
    sheet.appendRow(AREA_HEADERS);
    return sheet;
  }

  const headers = data[0].map((h) => String(h || "").trim());

  // Find missing columns from AREA_HEADERS
  const existing = new Set(headers.filter(Boolean));
  const missing = AREA_HEADERS.filter((h) => !existing.has(h));

  // Add missing columns at the end
  if (missing.length > 0) {
    sheet
      .getRange(1, headers.length + 1, 1, missing.length)
      .setValues([missing]);
  }

  return sheet;
}

function saveLocation(payload) {
  // Task 5: Ensure Location sheet has all required columns (including maxAccuracy)
  const sheet = ensureLocationSheetSchema();
  const data = sheet.getDataRange().getValues();

  // โครงสร้าง Header ของชีต location (ตรงกับ Google Sheet จริง)
  const headers = data.length > 0 ? data[0] : AREA_HEADERS;

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
      if (
        targetId !== "" &&
        String(data[i][qrCodeColIndex]).trim() === targetId
      ) {
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
    if (h === "qr_code") val = newId || payload.qr_code || payload.areaId || "";
    if (h === "lat") val = numOr(payload.lat, numOr(payload.centerLat, ""));
    if (h === "lng") val = numOr(payload.lng, numOr(payload.centerLng, ""));
    if (h === "north")
      val = numOr(payload.north, numOr(payload.northMeters, ""));
    if (h === "south")
      val = numOr(payload.south, numOr(payload.southMeters, ""));
    if (h === "east") val = numOr(payload.east, numOr(payload.eastMeters, ""));
    if (h === "west") val = numOr(payload.west, numOr(payload.westMeters, ""));
    if (h === "remark")
      val = payload.areaName || payload.remark || payload.note || "";
    if (h === "assign") val = payload.assign || payload.visibleRoles || "";
    if (h === "email") val = payload.email || payload.visibleUsers || "";
    if (h === "maxAccuracy") val = numOr(payload.maxAccuracy, "");

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
  const targetId = String(
    payload.qr_code || payload.areaId || payload.originalAreaId || "",
  ).trim();
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
  const headers = data.length > 0 ? data[0] : AREA_ASSIGNMENT_HEADERS;

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

  if (!targetEmail && !targetUid) throw new Error("ไม่พบข้อมูลระบุตัวตนผู้ใช้");

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
    throw new Error("ไม่พบข้อมูลระบุตัวตนสำหรับการลบ");

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
    sheet
      .getRange(1, headers.length + 1, 1, missing.length)
      .setValues([missing]);
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
  const email = String(payload.email || "")
    .trim()
    .toLowerCase();
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
      if (h === "email")
        return String(email || "")
          .trim()
          .toLowerCase();
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
  if (nameCol > -1 && !String(row[nameCol] || "").trim())
    row[nameCol] = nextName;
  if (emailCol > -1 && email && !String(row[emailCol] || "").trim()) {
    row[emailCol] = String(email).trim().toLowerCase();
  }
  if (updatedCol > -1) row[updatedCol] = now;

  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
  return true;
}

/**
 * บันทึก/อัปเดต Employee ID ให้กับคนเช็คอิน (Sheet "user") — คู่กับ updateLineCheckinUserCurrentName
 * ใช้ userId (LINE userId) เป็นตัวจับคู่หลักเหมือนกัน เพราะ Employee ID เป็นข้อมูลที่ผูกกับ "คน" ไม่ใช่ "แถว Log"
 */
function updateLineCheckinUserEmployeeId(userId, employeeId) {
  ensureLineCheckinUserSheet();

  const uid = String(userId || "").trim();
  const nextEmployeeId = String(employeeId || "").trim();
  if (!uid || !nextEmployeeId) return false;

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
      if (h === "employeeId") return nextEmployeeId;
      if (h === "updatedAt") return now;
      return "";
    });
    sheet.appendRow(rowData);
    return true;
  }

  const row = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  const employeeIdCol = headers.indexOf("employeeId");
  const updatedCol = headers.indexOf("updatedAt");

  if (employeeIdCol > -1) row[employeeIdCol] = nextEmployeeId;
  if (updatedCol > -1) row[updatedCol] = now;

  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
  return true;
}

function resolveLogDisplayName(payload, lineUser) {
  const fromCurrent = lineUser && String(lineUser.currentName || "").trim();
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

function formatBangkokDateTime(date) {
  const d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
  return Utilities.formatDate(d, BANGKOK_TZ, "yyyy/MM/dd HH:mm:ss");
}

// Cache timezone ของสเปรดชีตไว้ในตัวแปรระดับ execution เดียว (ต่อ 1 ครั้งที่ Apps Script รัน)
// เพราะ rawCreatedAtText() ถูกเรียกซ้ำนับร้อย/พันครั้งต่อ 1 request (ครั้งละ 1 แถว) ถ้าเปิด
// SpreadsheetApp.openById(...) ใหม่ทุกครั้งจะช้าและเสี่ยง error/quota โดยไม่จำเป็น — เปิดครั้งเดียวพอ
let _cachedSheetTz = null;
function getSpreadsheetTz_() {
  if (_cachedSheetTz) return _cachedSheetTz;
  try {
    const tz = SpreadsheetApp.openById(SPREADSHEET_ID).getSpreadsheetTimeZone();
    _cachedSheetTz = typeof tz === "string" && tz ? tz : BANGKOK_TZ;
  } catch (e) {
    // ถ้าอ่าน timezone ของสเปรดชีตไม่ได้ไม่ว่าเหตุผลใด ให้ fallback เป็น BANGKOK_TZ
    // (ดีกว่าปล่อยให้ Utilities.formatDate พังทั้ง request)
    _cachedSheetTz = BANGKOK_TZ;
  }
  return _cachedSheetTz;
}

// อ่านค่า createdAt ออกมาเป็น "text ตัวเลขเดิมเป๊ะๆ" โดยไม่มีการแปลง timezone ใดๆ ทั้งสิ้น
// เพราะเวลาที่เก็บไว้ในชีต (ไม่ว่าจะยังเป็น text หรือถูก Sheets auto-convert เป็นชนิด Date ให้เอง)
// คือเวลาไทยที่ถูกต้องอยู่แล้วเสมอ — ถ้าเป็น Date object ก็แค่ "อ่านตัวเลขที่เห็น" กลับมาด้วย
// timezone เดียวกับที่ "Google Sheet เอง" ใช้ตอนแปลง text -> Date ให้อัตโนมัติ (spreadsheet timezone
// ที่ตั้งไว้ใน File > Settings ของสเปรดชีตนี้) ไม่ใช่ timezone ของตัวโปรเจกต์ Apps Script
// (Session.getScriptTimeZone()) ซึ่งเป็นค่าคนละอันกัน และเป็นสาเหตุที่เวลาเพี้ยนไป 7 ชั่วโมง:
// ถ้าสเปรดชีตตั้ง timezone ไว้คนละค่ากับตัวโปรเจกต์ Apps Script การ format กลับด้วย
// Session.getScriptTimeZone() จะไม่ตรงกับ timezone ที่ Sheets ใช้ตีความ/แสดงผลค่าเดิมตั้งแต่แรก
// ใช้ spreadsheet timezone เสมอจึงการันตีว่าได้ตัวเลขเดิมเป๊ะๆ ไม่มีการบวก/ลบชั่วโมงใดๆ แอบแฝงอยู่เลย
function rawCreatedAtText(value) {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(
      value,
      getSpreadsheetTz_(),
      "yyyy/MM/dd HH:mm:ss",
    );
  }
  return String(value).trim();
}

/**
 * ===========================================================================
 * เรียกฟังก์ชันนี้ "ครั้งเดียว" ตรงๆ จาก Apps Script editor (เลือกฟังก์ชันนี้แล้วกด Run)
 * เพื่อซ่อมแถวเก่าที่คอลัมน์ createdAt ถูก Google Sheets auto-convert เป็นชนิด Date ไปแล้ว
 * (ต้นเหตุของบั๊กเวลาเพี้ยน +7 ชั่วโมง) ให้กลายเป็นข้อความ (text) ที่ถูกต้องแบบถาวร
 * - ต้อง deploy โค้ดเวอร์ชันล่าสุดนี้ก่อน (สร้าง New Deployment ไม่ใช่แค่ Save) การรันฟังก์ชันนี้
 *   จาก editor ไม่จำเป็นต้อง deploy ก็รันได้ทันที แต่ Web App (หน้าเว็บ) ต้อง deploy ใหม่ด้วย
 *   ไม่งั้นหน้าเว็บจะยังเรียกโค้ดเวอร์ชันเก่าอยู่ ทำให้ดูเหมือนแก้ไม่ได้ผลทั้งที่แก้ถูกจุดแล้ว
 * - ปลอดภัยที่จะรันซ้ำได้เรื่อยๆ (idempotent) แถวที่เป็น text ถูกต้องอยู่แล้วจะไม่ถูกแตะต้อง
 * - เพราะ ensureLogsSheetSchema() บังคับ format คอลัมน์นี้เป็น Plain Text ไว้แล้ว ค่าที่เขียนกลับ
 *   ในนี้จะไม่ถูก Sheets แปลงเป็น Date อีกต่อไป (ปัญหานี้จะไม่เกิดซ้ำกับแถวใหม่ที่บันทึกหลังจากนี้)
 * ===========================================================================
 */
function repairCorruptedCreatedAtDates() {
  const sheet = ensureLogsSheetSchema();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, repaired: 0 };

  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0]
    .map(function (h) {
      return String(h || "").trim();
    });
  const createdAtCol = headers.indexOf("createdAt") + 1; // 1-based
  if (createdAtCol <= 0) {
    throw new Error("ไม่พบคอลัมน์ createdAt ใน Sheet Logs");
  }

  const numRows = lastRow - 1;
  const range = sheet.getRange(2, createdAtCol, numRows, 1);
  const values = range.getValues();

  let repaired = 0;
  const fixedValues = values.map(function (row) {
    const cell = row[0];
    if (cell instanceof Date && !isNaN(cell.getTime())) {
      repaired++;
      return [rawCreatedAtText(cell)];
    }
    return [cell];
  });

  if (repaired > 0) {
    range.setValues(fixedValues);
  }

  return { ok: true, repaired: repaired, totalRows: numRows };
}

// ใช้สำหรับ "เทียบลำดับ/กรองช่วงวัน/คำนวณระยะห่าง" เท่านั้น — ไม่ใช้ค่านี้ไปแสดงผลโดยตรงเด็ดขาด
// สร้าง Date จากตัวเลขในข้อความตรงๆ (ไม่ใส่ +07:00 หรือ timezone ใดๆ) เพื่อไม่ให้เกิดการแปลงเวลาซ้ำอีกชั้น
// ใช้เทียบ/ลบกันเองระหว่าง Date ที่สร้างด้วยวิธีเดียวกันนี้เท่านั้น จึงปลอดภัยแม้ epoch จริงจะไม่ตรง UTC ก็ตาม
function parseLogDate(value) {
  const text = rawCreatedAtText(value);
  if (!text) return null;

  const match = text.match(
    /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/,
  );
  if (match) {
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    const hh = Number(match[4] || 0);
    const mm = Number(match[5] || 0);
    const ss = Number(match[6] || 0);
    return new Date(y, m - 1, d, hh, mm, ss);
  }

  const fallback = new Date(text);
  return isNaN(fallback.getTime()) ? null : fallback;
}

function buildLineCheckinUserMap() {
  ensureLineCheckinUserSheet();
  const users = getSheetDataAsObjects(LINE_CHECKIN_USER_SHEET);
  const byUserId = {};
  for (let i = 0; i < users.length; i++) {
    const uid = String(users[i].userId || "").trim();
    if (uid) byUserId[uid] = users[i];
  }
  return byUserId;
}

// หมายเหตุ: ฟังก์ชันนี้เป็นจุด enrich ข้อมูล log ร่วมกัน (ใช้ทั้งหน้า Logs, Export Excel, Export TigerSoft
// เพราะทั้งหมดเรียกผ่าน handleGetLogs()) — เพิ่ม employeeId เข้ามาโดยไม่กระทบ field เดิมที่มีอยู่แล้ว
function enrichLogsWithUserNames(logs) {
  const byUserId = buildLineCheckinUserMap();
  return (logs || []).map(function (log) {
    const uid = String(log.userId || "").trim();
    if (uid && byUserId[uid]) {
      const resolved = resolveLogDisplayName(log, byUserId[uid]);
      if (resolved) log.displayName = resolved;

      // Employee ID: ใช้ค่าจาก Sheet "user" เสมอถ้ามี (เป็น source of truth ที่ admin กรอกไว้)
      // เพื่อให้แก้ไข Employee ID ทีเดียวที่ Sheet "user" แล้วสะท้อนไปทุกแถว Log ของคนนั้นอัตโนมัติ
      const empId = String(byUserId[uid].employeeId || "").trim();
      if (empId) log.employeeId = empId;
    }
    return log;
  });
}

/**
 * =======================================================================
 * HALF-DAY STATUS (ครึ่งแรก / ครึ่งหลัง) — sync ลง Google Sheet
 * =======================================================================
 * เหตุผลที่ไม่คำนวณสดตอน saveLog() ทุกครั้งที่มีคนเช็คอิน:
 * ต้องดูประวัติเช็คอินทั้งหมดของคนนั้นในวันนั้นเพื่อหา "ครั้งแรกของวัน" เป็นเวลาอ้างอิง
 * ซึ่งหมายถึงต้องอ่านทั้งชีต Logs ทุกครั้ง — ตรงกับปัญหา timeout ที่เคยแก้ไปแล้วใน saveLog()
 * (ดูคอมเมนต์ BUGFIX เรื่อง getDataRange() ด้านบน) จึงแยกออกมาเป็น batch job ที่รันแยกต่างหาก
 * (เรียกเองจาก Apps Script editor ได้ทันที หรือจะตั้ง Trigger แบบ time-driven ให้รันอัตโนมัติ
 * ทุกๆ 15-30 นาที ก็ได้ — ดูวิธีตั้งใน docs/ หรือ Apps Script > Triggers)
 * ใช้ logic เดียวกับ common.js (annotateHalfDayStatus) เป๊ะๆ เพื่อให้ค่าที่เห็นในชีตตรงกับหน้าเว็บ Logs เสมอ
 */
const HALF_DAY_FIRST_LABEL = "ครึ่งแรก";
const HALF_DAY_SECOND_LABEL = "ครึ่งหลัง";
const HALF_DAY_WINDOW_MS_SERVER = 2 * 60 * 60 * 1000; // 2 ชั่วโมง — ต้องตรงกับ HALF_DAY_WINDOW_MS ใน common.js

function bangkokDateKeyServer_(date) {
  // date มาจาก parseLogDate() ซึ่งสร้างจากตัวเลขในข้อความตรงๆ ไม่มี timezone offset ใดๆ แอบแฝง
  // จึงอ่านปี/เดือน/วันออกมาตรงๆ ได้เลย ห้ามใช้ Utilities.formatDate(...,"Asia/Bangkok") ตรงนี้เด็ดขาด
  // เพราะจะเป็นการแปลง timezone ซ้ำอีกชั้นทั้งที่ตัวเลขถูกต้องอยู่แล้ว
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

function halfDayGroupKeyServer_(row) {
  const uid = String(row.userId || "").trim();
  const mail = String(row.email || "")
    .trim()
    .toLowerCase();
  const name = String(row.displayName || row.name || "")
    .trim()
    .toLowerCase();
  const person = uid
    ? "uid:" + uid
    : mail
      ? "email:" + mail
      : name
        ? "name:" + name
        : "anon";
  const date = parseLogDate(row.createdAt);
  const dateKey = date ? bangkokDateKeyServer_(date) : "unknown";
  return person + "|" + dateKey;
}

/**
 * คำนวณ "ครึ่งแรก/ครึ่งหลัง" ให้ทุกแถวใน Sheet Logs แล้วเขียนกลับลงคอลัมน์ halfDayStatus ทีเดียว (batch)
 * เรียกฟังก์ชันนี้ตรงๆ จาก Apps Script editor เพื่อ backfill ข้อมูลเก่าทั้งหมดในครั้งแรก
 * และเรียกซ้ำได้เรื่อยๆ อย่างปลอดภัย (idempotent) — ใช้ตั้งเป็น time-driven trigger เพื่ออัปเดตอัตโนมัติได้เลย
 */
function syncHalfDayStatusColumn() {
  const sheet = ensureLogsSheetSchema();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, updated: 0 };

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const createdAtCol = headers.indexOf("createdAt");
  const statusCol = headers.indexOf("halfDayStatus");
  if (createdAtCol === -1 || statusCol === -1) {
    throw new Error("ไม่พบคอลัมน์ createdAt หรือ halfDayStatus ใน Sheet Logs");
  }

  const numRows = lastRow - 1;
  const values = sheet.getRange(2, 1, numRows, headers.length).getValues();

  const rows = values.map(function (rowArr) {
    const obj = {};
    headers.forEach(function (h, i) {
      obj[h] = rowArr[i];
    });
    return obj;
  });

  // จัดกลุ่มตามคน+วัน แล้วหาเวลาอ้างอิง (เช็คอินครั้งแรกสุดของวันนั้น) เหมือน common.js
  const groups = {};
  rows.forEach(function (row, idx) {
    const key = halfDayGroupKeyServer_(row);
    const time = parseLogDate(row.createdAt);
    if (!groups[key]) groups[key] = [];
    groups[key].push({ idx: idx, time: time });
  });

  const statusByIdx = new Array(rows.length).fill("");
  Object.keys(groups).forEach(function (key) {
    const entries = groups[key].filter(function (e) {
      return e.time instanceof Date;
    });
    if (!entries.length) return;
    const refMs = entries.reduce(function (min, e) {
      return Math.min(min, e.time.getTime());
    }, entries[0].time.getTime());
    entries.forEach(function (e) {
      const diff = e.time.getTime() - refMs;
      statusByIdx[e.idx] =
        diff <= HALF_DAY_WINDOW_MS_SERVER
          ? HALF_DAY_FIRST_LABEL
          : HALF_DAY_SECOND_LABEL;
    });
  });

  const statusColumnValues = statusByIdx.map(function (s) {
    return [s];
  });
  sheet.getRange(2, statusCol + 1, numRows, 1).setValues(statusColumnValues);

  return { ok: true, updated: numRows };
}

/**
 * =======================================================================
 * LOGS MODULE
 * =======================================================================
 */

function handleGetLogs(params) {
  ensureLogsSheetSchema();
  let data = enrichLogsWithUserNames(getSheetDataAsObjects(LOGS_SHEET_NAME));

  // กรองตาม userId หรือ email สำหรับการค้นหาชื่อ
  if (params.userId) {
    const searchUserId = String(params.userId).trim();
    data = data.filter(
      (log) => String(log.userId || "").trim() === searchUserId,
    );
  } else if (params.email) {
    const searchEmail = String(params.email).toLowerCase();
    data = data.filter(
      (log) => String(log.email || "").toLowerCase() === searchEmail,
    );
  }

  // กรองตามชื่อ (displayName) ถ้ามี
  if (params.name) {
    const searchName = String(params.name).toLowerCase();
    data = data.filter((log) =>
      String(log.displayName || log.name || "")
        .toLowerCase()
        .includes(searchName),
    );
  }

  // กรองตามช่วงวันที่ (from/to เป็นวันที่ปฏิทินแบบไทยอยู่แล้ว เช่น "2026-07-21" จาก frontend)
  // เทียบแบบตัวเลขตรงๆ ไม่ใส่ offset ใดๆ เพิ่ม เพื่อให้เป็นฐานเดียวกับ parseLogDate() ด้านบน
  // (ถ้าใส่ +07:00 ตรงนี้ทั้งที่ parseLogDate ไม่ใส่ จะเทียบกันคนละฐาน ผลกรอง/เรียงลำดับจะเพี้ยน)
  if (params.from || params.to) {
    const fromDate = params.from ? new Date(params.from + "T00:00:00") : null;
    const toDate = params.to ? new Date(params.to + "T23:59:59.999") : null;

    data = data.filter(function (log) {
      const logDate = parseLogDate(log.createdAt);
      if (!logDate) return false;
      return (
        (!fromDate || logDate >= fromDate) && (!toDate || logDate <= toDate)
      );
    });
  }

  // เรียงลำดับจากใหม่ไปเก่า (descending by createdAt)
  data.sort(function (a, b) {
    const timeA = (parseLogDate(a.createdAt) || new Date(0)).getTime();
    const timeB = (parseLogDate(b.createdAt) || new Date(0)).getTime();
    return timeB - timeA;
  });

  // ส่ง createdAt กลับไปเป็น "text ตัวเลขเดิมเป๊ะๆ" ไม่มีการแปลง timezone ใดๆ ทั้งสิ้น (ดู rawCreatedAtText ด้านบน)
  // กันไว้เฉพาะกรณีเซลล์ถูก Sheets auto-convert เป็นชนิด Date object ที่ JSON.stringify จะเรียก toISOString()
  // ให้เองถ้าปล่อยผ่านไปตรงๆ — ใช้ rawCreatedAtText อ่านตัวเลขเดิมกลับมาเป็น text ตรงๆ ไม่มีคำนวณใดๆ แทรกเลย
  data = data.map(function (log) {
    const text = rawCreatedAtText(log.createdAt);
    if (text) log.createdAt = text;
    return log;
  });

  // สำหรับ Export ไม่ต้องแบ่งหน้า
  if (params.export) {
    return { ok: true, data: data };
  }

  const offset = parseInt(params.offset || 0, 10);
  const limit = parseInt(params.limit || 15, 10);
  const total = data.length;
  const hasMore = offset + limit < total;

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

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
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
  const accuracy = numOr(payload.accuracy, 999); // รับค่าความคลาดเคลื่อนมาด้วย (0 คือค่าที่ถูกต้อง ไม่ใช่ค่าไม่มี)

  if (isNaN(lat) || isNaN(lng)) return { ok: false, err: "พิกัดไม่ถูกต้อง" };

  // BUGFIX: เรียก ensureLocationSheetSchema() ก่อนอ่านเสมอ เพื่อให้แถวพื้นที่เก่าที่ยังไม่มีคอลัมน์
  // maxAccuracy ได้รับการเพิ่มคอลัมน์อัตโนมัติ (ไม่กระทบข้อมูลเดิม) ก่อนจะนำไปตรวจสอบ
  ensureLocationSheetSchema();
  const areas = getSheetDataAsObjects("location");
  // ค้นหาพื้นที่โดยเน้นที่ areaId หรือ qr_code (รองรับ Legacy)
  let area = areas.find((a) => {
    const id = String(a.areaId || a.qr_code || "").trim();
    return id === String(areaId).trim();
  });

  // ถ้าไม่พบพื้นที่ ให้ใช้ค่า default
  if (!area) {
    area = DEFAULT_AREA;
  }

  // ปฏิเสธพิกัดที่คลาดเคลื่อนสูงเกินไป โดยใช้ค่า maxAccuracy จาก Config พื้นที่นั้นๆ (ถ้าไม่มีใช้ 30 เมตร)
  // เพื่อป้องกันการ "กระโดด" ของ GPS นอกพื้นที่
  const areaMaxAcc = numOr(area.maxAccuracy, numOr(payload.maxAccuracy, 30));

  const centerLat = numOr(area.lat, numOr(area.centerLat, NaN));
  const centerLng = numOr(area.lng, numOr(area.centerLng, NaN));

  // คำนวณขอบเขตสี่เหลี่ยม (แบบเดียวกับ frontend) — ไม่มีการบวกเพิ่มระยะอนุโลมใดๆ
  const north = numOr(area.north, numOr(area.northMeters, 50));
  const south = numOr(area.south, numOr(area.southMeters, 50));
  const east = numOr(area.east, numOr(area.eastMeters, 80));
  const west = numOr(area.west, numOr(area.westMeters, 50));

  // แปลงเมตรเป็นเดลต้าพิกัด (โดยประมาณ)
  const latDeltaNorth = north / 111320;
  const latDeltaSouth = south / 111320;
  const cosLat = Math.cos((centerLat * Math.PI) / 180) || 1;
  const lngDeltaEast = east / (111320 * cosLat);
  const lngDeltaWest = west / (111320 * cosLat);

  // เอาค่าอนุโลมออกตามความต้องการของผู้ใช้ (เดิมมีการบวกเพิ่ม 2 เมตร)
  const minLat = centerLat - latDeltaSouth;
  const maxLat = centerLat + latDeltaNorth;
  const minLng = centerLng - lngDeltaWest;
  const maxLng = centerLng + lngDeltaEast;

  const distanceFromCenter =
    !isNaN(centerLat) && !isNaN(centerLng)
      ? calculateDistance(lat, lng, centerLat, centerLng)
      : null;

  // Debug log: ไว้ดูใน Apps Script > Executions ตอน check-in มีปัญหา
  // แสดง lat/lng ที่ผู้ใช้ส่งมา, accuracy, รัศมี/ขอบเขตของพื้นที่ (north/south/east/west), และระยะทางที่คำนวณได้
  console.log(
    "[validateGeofence] debug: " +
      JSON.stringify({
        areaId: areaId,
        resolvedAreaId: String(area.areaId || area.qr_code || ""),
        lat: lat,
        lng: lng,
        accuracy: accuracy,
        areaMaxAccuracy: areaMaxAcc,
        centerLat: centerLat,
        centerLng: centerLng,
        radiusMeters: { north: north, south: south, east: east, west: west },
        boundary: {
          minLat: minLat,
          maxLat: maxLat,
          minLng: minLng,
          maxLng: maxLng,
        },
        distanceFromCenterMeters: distanceFromCenter,
      }),
  );

  if (accuracy > areaMaxAcc) {
    return {
      ok: false,
      err:
        "สัญญาณ GPS ไม่เสถียร (ความแม่นยำปัจจุบัน: " +
        accuracy.toFixed(1) +
        "m) " +
        "พื้นที่นี้กำหนดไว้ไม่เกิน " +
        areaMaxAcc +
        "m " +
        "กรุณายืนในที่โล่งหรือขยับห่างจากอาคารแล้วลองใหม่",
      distanceFromCenter: distanceFromCenter,
    };
  }

  if (isNaN(centerLat) || isNaN(centerLng)) {
    // ข้อมูลพื้นที่ผิดปกติ — ปฏิเสธการเช็กอินแทนการปล่อยผ่าน (fail-closed ไม่ใช่ fail-open)
    return {
      ok: false,
      err: "ไม่พบข้อมูลพื้นที่ที่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบ",
      distanceFromCenter: distanceFromCenter,
    };
  }

  // เช็คแบบเข้มงวด: ต้องอยู่ในกรอบเป๊ะๆ
  const isInside =
    lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;

  if (!isInside) {
    const areaLabel = area.areaName || area.remark || areaId;
    return {
      ok: false,
      err: "ขออภัย คุณอยู่นอกพื้นที่ทำงานที่กำหนดไว้ (" + areaLabel + ")",
      distanceFromCenter: distanceFromCenter,
    };
  }

  // ⚠️ เพิ่ม distanceFromCenter ใน return เพื่อให้ saveLog() เอาไปบันทึกลงคอลัมน์ "distantcenter"
  // ใน Sheet Logs ได้โดยไม่ต้องคำนวณซ้ำอีกรอบ (คำนวณจากพิกัด/พื้นที่ชุดเดียวกันที่ผ่านการตรวจสอบแล้ว)
  return { ok: true, distanceFromCenter: distanceFromCenter };
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

  const resolvedUserId = String(payload.userId || "").trim();
  if (resolvedUserId) {
    ensureLineCheckinUser(payload);
  }
  const lineUser = resolvedUserId
    ? getLineCheckinUserByUserId(resolvedUserId)
    : null;
  const resolvedDisplayName = resolveLogDisplayName(payload, lineUser);
  const createdAtBangkok = formatBangkokDateTime(
    payload.time ? parseLogDate(payload.time) || new Date() : new Date(),
  );

  const sheet = ensureLogsSheetSchema();
  // ⚠️ BUGFIX (สาเหตุหลักของ Client Timeout / "ระบบมีผู้ใช้งานพร้อมกันจำนวนมาก"):
  // เดิมใช้ sheet.getDataRange().getValues() เพื่อจะเอาแค่ "แถวหัวคอลัมน์" (data[0]) แถวเดียว
  // แต่ getDataRange() จะอ่านข้อมูล "ทุกแถว" ของ Sheet Logs ทั้งหมดกลับมาเสมอ ยิ่ง Sheet
  // มีประวัติเช็คอินสะสมมากขึ้นเรื่อยๆ (เป็นพันแถวขึ้นไป) การอ่านทั้งชีตทุกครั้งที่มีคนเช็คอิน 1 คน
  // (ขณะที่ยังถือ script lock ค้างอยู่ด้วย) ก็จะยิ่งช้าลงเรื่อยๆ จนวันหนึ่งช้าเกินเวลาที่ Client
  // รอไหว (30 วิ) → Client ตัดใจ timeout ทั้งที่ Apps Script ยังทำงานต่อจนเขียนสำเร็จอยู่ดี
  // (Client abort ไม่ได้สั่งให้ execution ฝั่ง Server หยุดจริง) แก้โดยอ่านเฉพาะแถวหัวคอลัมน์แถวเดียว
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  // BUGFIX (ไม่บันทึกค่า accuracy): เดิมใช้ `payload.accuracy || ""` ซึ่งถ้า accuracy ที่ส่งมาเป็น 0
  // (ค่าความแม่นยำที่ถูกต้อง ไม่ใช่ค่าไม่มี) จะถูกมองเป็น falsy แล้วเขียนเป็นค่าว่างแทน
  // ใช้ numOr() ตรวจสอบว่าเป็นตัวเลขจริงก่อน ถ้าไม่ใช่ตัวเลขเลยจึงเขียนเป็นค่าว่าง
  const safeAccuracy = numOr(payload.accuracy, "");

  // Debug log: ค่าที่กำลังจะบันทึกลง Google Sheet จริง (lat, lng, accuracy)
  console.log(
    "[saveLog] debug: " +
      JSON.stringify({
        areaId: payload.areaId,
        lat: payload.lat,
        lng: payload.lng,
        accuracy: safeAccuracy,
      }),
  );

  const rowData = headers.map(function (h) {
    if (h === "createdAt") return createdAtBangkok;
    if (h === "displayName") return resolvedDisplayName;
    if (h === "email") return payload.email || "";
    if (h === "phone") return payload.phone || "";
    if (h === "site") return payload.site || "";
    if (h === "lat") return numOr(payload.lat, "");
    if (h === "lng") return numOr(payload.lng, "");
    if (h === "accuracy") return safeAccuracy;
    if (h === "userId") return resolvedUserId;
    if (h === "status") return payload.status || "checked_in";
    // ระยะห่างจากจุดศูนย์กลางพื้นที่ (เมตร) ที่คำนวณไว้แล้วตอน validateGeofence — ปัดเป็นทศนิยม 1 ตำแหน่ง
    if (h === "distantcenter")
      return typeof validation.distanceFromCenter === "number" &&
        !isNaN(validation.distanceFromCenter)
        ? Math.round(validation.distanceFromCenter * 10) / 10
        : "";
    // Employee ID: ประทับค่าไว้ที่แถว Log ตอนเช็กอิน ถ้า Sheet "user" มีข้อมูลอยู่แล้ว (admin เคยกรอกไว้ก่อนหน้า)
    // ถ้ายังไม่มี จะปล่อยว่างไว้ก่อน แล้ว enrichLogsWithUserNames() จะเติมให้ทีหลังตอนอ่านข้อมูล (ถ้า admin มากรอกเพิ่มภายหลัง)
    if (h === "employeeId") return (lineUser && lineUser.employeeId) || "";
    return "";
  });

  sheet.appendRow(rowData);
  const result = {
    ok: true,
    message: "บันทึกข้อมูลสำเร็จ",
    userId: resolvedUserId,
    displayName: resolvedDisplayName,
  };

  // เก็บผลลัพธ์ไว้ผูกกับ checkinRequestId (ถ้า Client ส่งมา) ให้ request ที่ "ลองใหม่" ด้วย
  // ข้อมูลชุดเดียวกัน (checkinRequestId เดิม) ได้รับผลลัพธ์นี้กลับไปทันที แทนที่จะเขียนซ้ำอีกแถว
  const requestId = String(payload.checkinRequestId || "").trim();
  if (requestId) cacheCheckinResult(requestId, result);

  return result;
}

/**
 * ตรวจและสร้าง Schema ของ Sheet "Test" ให้ตรงกับ TEST_LOG_HEADERS
 */
function ensureTestSheetSchema() {
  const sheet = getSheetByNameOrCreate(TEST_SHEET_NAME);
  const lastRow = sheet.getLastRow();

  if (lastRow === 0) {
    sheet.appendRow(TEST_LOG_HEADERS);
    return sheet;
  }

  const lastCol = sheet.getLastColumn();
  const headerRange = sheet.getRange(1, 1, 1, Math.max(lastCol, 1));
  const headers = headerRange.getValues()[0].map(function (h) {
    return String(h || "").trim();
  });
  const existing = new Set(headers.filter(Boolean));
  const missing = TEST_LOG_HEADERS.filter(function (h) {
    return !existing.has(h);
  });

  if (missing.length > 0) {
    sheet
      .getRange(1, headers.length + 1, 1, missing.length)
      .setValues([missing]);
  }

  return sheet;
}

/**
 * บันทึกข้อมูล GPS Test Mode ลง Sheet "Test" ทันที ไม่ตรวจ Geofence
 * เรียกได้หลายครั้งต่อ Check-in 1 ครั้ง (10 ครั้ง ทุก 1 วินาที)
 */
function saveTestLog(payload) {
  const sheet = ensureTestSheetSchema();
  // ⚠️ BUGFIX: เหมือน saveLog() — อ่านเฉพาะแถวหัวคอลัมน์ ไม่อ่านทั้งชีต (ฟังก์ชันนี้ถูกเรียก
  // ซ้ำถึง 10 ครั้งต่อการเช็คอินทดสอบ 1 ครั้ง ยิ่งขยายผลกระทบของการอ่านทั้งชีตทุกครั้งมากขึ้นไปอีก
  // และเพราะทุก action ใน doPost ใช้ script lock ร่วมกัน ถ้าจุดนี้ช้าจะไปถ่วงคิวเช็คอินจริงของคนอื่นด้วย)
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  const resolvedUserId = String(payload.userId || "").trim();
  // ดึงชื่อผู้ใช้จาก LINE User Sheet ถ้ามี
  const lineUser = resolvedUserId
    ? getLineCheckinUserByUserId(resolvedUserId)
    : null;
  const resolvedDisplayName = resolveLogDisplayName(payload, lineUser);
  const createdAtBangkok = formatBangkokDateTime(
    payload.time ? parseLogDate(payload.time) || new Date() : new Date(),
  );
  const safeAccuracy = numOr(payload.accuracy, "");

  console.log(
    "[saveTestLog] debug: " +
      JSON.stringify({
        sampleIndex: payload.sampleIndex,
        areaId: payload.areaId,
        lat: payload.lat,
        lng: payload.lng,
        accuracy: safeAccuracy,
        isInsideBoundary: payload.isInsideBoundary,
      }),
  );

  const rowData = headers.map(function (h) {
    if (h === "createdAt") return createdAtBangkok;
    if (h === "displayName") return resolvedDisplayName;
    if (h === "email") return payload.email || "";
    if (h === "phone") return payload.phone || "";
    if (h === "site") return payload.site || "";
    if (h === "lat") return numOr(payload.lat, "");
    if (h === "lng") return numOr(payload.lng, "");
    if (h === "accuracy") return safeAccuracy;
    if (h === "userId") return resolvedUserId;
    if (h === "status") return payload.status || "test";
    if (h === "distantcenter") return numOr(payload.distantcenter, "");
    if (h === "sampleIndex") return numOr(payload.sampleIndex, "");
    return "";
  });

  sheet.appendRow(rowData);
  return {
    ok: true,
    message: "บันทึก Test Log สำเร็จ",
    sampleIndex: payload.sampleIndex,
    userId: resolvedUserId,
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
  const targetEmail = String(payload.email || "")
    .trim()
    .toLowerCase();
  const newDisplayName = String(payload.displayName || "").trim();

  if (!targetUserId && !targetEmail) {
    return {
      ok: false,
      err: "ไม่พบ userId หรือ email ของรายการที่ต้องการตั้งชื่อ",
    };
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
    const rowUserId =
      userIdColIdx !== -1 ? String(row[userIdColIdx] || "").trim() : "";
    const rowEmail =
      emailColIdx !== -1
        ? String(row[emailColIdx] || "")
            .trim()
            .toLowerCase()
        : "";

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

/**
 * บันทึก Employee ID ที่ admin ใส่ให้กับคนเช็คอิน — ใช้สำหรับ Export TigerSoft โดยเฉพาะ
 * (ระบบเช็คอินผ่าน LINE ไม่มี Employee ID มาด้วยเอง ต้องให้ admin กรอกเองที่หน้า Logs)
 * ตัวจับคู่หลักคือ LINE userId เท่านั้น (Employee ID ผูกกับ "คน" ไม่ใช่ผูกกับ email ที่อาจเปลี่ยนได้)
 *
 * เมื่อบันทึกสำเร็จ Employee ID จะถูกใส่ให้กับ "ทุกแถว Log ของคนนั้น" (ไม่ใช่แค่แถวเดียว)
 * เหมือนกับ handleSaveLogName() — เพื่อให้ export ย้อนหลังได้ครบทุกแถว ไม่ใช่แค่แถวที่กดแก้ไข
 */
function handleSaveLogEmployeeId(payload) {
  const sheet = ensureLogsSheetSchema();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const userIdColIdx = headers.indexOf("userId");
  const employeeIdColIdx = headers.indexOf("employeeId");

  if (userIdColIdx === -1) {
    return { ok: false, err: "ไม่พบ userId ใน Logs Sheet" };
  }
  if (employeeIdColIdx === -1) {
    return { ok: false, err: "ไม่พบ employeeId ใน Logs Sheet" };
  }

  const targetUserId = String(payload.userId || "").trim();
  const newEmployeeId = String(payload.employeeId || "").trim();

  if (!targetUserId) {
    return {
      ok: false,
      err: "ไม่พบ userId ของรายการที่ต้องการตั้ง Employee ID — ให้คนนี้เช็กอินใหม่อีกครั้งเพื่อบันทึก userId",
    };
  }
  if (!newEmployeeId) {
    return { ok: false, err: "กรุณาระบุ Employee ID ที่ต้องการบันทึก" };
  }

  updateLineCheckinUserEmployeeId(targetUserId, newEmployeeId);

  let updatedCount = 0;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowUserId = String(row[userIdColIdx] || "").trim();

    if (rowUserId === targetUserId) {
      row[employeeIdColIdx] = newEmployeeId;
      sheet.getRange(i + 1, 1, 1, headers.length).setValues([row]);
      updatedCount++;
    }
  }

  return {
    ok: true,
    message: "อัปเดต Employee ID " + updatedCount + " รายการสำเร็จ",
    updatedCount: updatedCount,
    userId: targetUserId,
    employeeId: newEmployeeId,
  };
}
