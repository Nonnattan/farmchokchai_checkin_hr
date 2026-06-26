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

  // หา ID เดิมเพื่อเทียบ (ใช้ qr_code แทน areaId)
  const targetId = payload.originalAreaId
    ? String(payload.originalAreaId).trim()
    : String(payload.qr_code || payload.areaId).trim();
  const newId = String(payload.qr_code || payload.areaId).trim() || targetId;

  let rowIndex = -1;
  const qrCodeColIndex = headers.indexOf("qr_code");

  // ค้นหาแถวที่ต้องการแก้ไขโดยใช้ qr_code
  if (qrCodeColIndex > -1 && data.length > 1) {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][qrCodeColIndex]).trim() === targetId) {
        rowIndex = i + 1; // +1 เพราะแถวใน Apps Script เริ่มที่ 1
        break;
      }
    }
  }

  const now = new Date().toISOString();
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
  const targetId = String(payload.qr_code || payload.areaId).trim();
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

  // ลบข้อมูลการ Assign ในชีต AreaAssignments ด้วย
  const asSheet = getSheetByNameOrCreate("AreaAssignments");
  const asData = asSheet.getDataRange().getValues();
  if (asData.length > 0) {
    const asAreaIdColIdx = asData[0].indexOf("areaId");
    if (asAreaIdColIdx > -1) {
      for (let j = asData.length - 1; j > 0; j--) {
        if (String(asData[j][asAreaIdColIdx]).trim() === targetId) {
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

function updateAreaAssignments(areaId, assignees) {
  const sheet = getSheetByNameOrCreate("AreaAssignments");
  let data = sheet.getDataRange().getValues();
  const headers =
    data.length > 0
      ? data[0]
      : [
          "areaId",
          "email",
          "uid",
          "role",
          "displayName",
          "active",
          "updatedAt",
        ];

  if (data.length === 0) {
    sheet.appendRow(headers);
    data = [headers];
  }

  const areaIdColIndex = headers.indexOf("areaId");

  // ลบข้อมูล Assign เก่าทั้งหมดของพื้นที่นี้ (ลบจากล่างขึ้นบน)
  if (areaIdColIndex > -1 && data.length > 1) {
    for (let i = data.length - 1; i > 0; i--) {
      if (String(data[i][areaIdColIndex]).trim() === String(areaId).trim()) {
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
      if (h === "areaId") {
        rowData.push(areaId);
      } else if (h === "updatedAt") {
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
 * LOGS MODULE
 * =======================================================================
 */

function handleGetLogs(params) {
  let data = getSheetDataAsObjects("logs");

  // รองรับ parameter limit ในการดึง log
  if (params.limit) {
    const limit = parseInt(params.limit, 10);
    if (!isNaN(limit) && limit > 0) {
      data = data.slice(-limit); // เอาเฉพาะจำนวนที่ขอ (ดึงจากท้ายสุด)
    }
  }

  return { ok: true, data: data };
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
 */
function validateGeofence(payload) {
  try {
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
    
    // คำนวณขอบเขตสี่เหลี่ยม (แบบเดียวกับ frontend)
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

    const isInside = lat >= (minLat - 0.00005) && lat <= (maxLat + 0.00005) && 
                     lng >= (minLng - 0.00005) && lng <= (maxLng + 0.00005);

    if (!isInside) {
      return { ok: false, err: "ขออภัย คุณอยู่นอกพื้นที่ทำงานที่กำหนดไว้ (" + area.areaName + ")" };
    }

    return { ok: true };
  } catch (e) {
    return { ok: true }; // ในกรณี error ให้ผ่านไปก่อนเพื่อไม่ให้ระบบล่ม
  }
}

function saveLog(payload) {
  // --- ส่วนที่แก้ไข: เพิ่มการตรวจสอบความปลอดภัย ---
  const validation = validateGeofence(payload);
  if (!validation.ok) {
    return { ok: false, err: validation.err };
  }
  // -------------------------------------------

  const sheet = getSheetByNameOrCreate("logs");
  const data = sheet.getDataRange().getValues();
  const headers =
    data.length > 0
      ? data[0]
      : ["Name", "Email", "Phone", "Lat", "Lng", "Time"];

  if (data.length === 0) {
    sheet.appendRow(headers);
  }

  const rowData = headers.map(function (h) {
    if (h === "Name") return payload.displayName || payload.name || "";
    if (h === "Email") return payload.email || "";
    if (h === "Phone") return payload.phone || "";
    if (h === "Lat") return payload.lat || "";
    if (h === "Lng") return payload.lng || "";
    if (h === "Time") return payload.time || new Date().toISOString();
    return payload[h] || "";
  });

  sheet.appendRow(rowData);
  return { ok: true, message: "Log saved successfully" };
}
