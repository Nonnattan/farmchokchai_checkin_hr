(function () {
  const SITE_NAME_KEY = "checkin_prototype_site_name";
  const PENDING_KEY = "pending_checkin_payload";
  const LAST_CHECKIN_KEY = "last_checkin";
  const AREA_CACHE_KEY = "checkin_area_cache";
  const API_URL = "https://script.google.com/macros/s/AKfycbxi64mybj1BOUHx_IqZri9toPYRc1FOyaNNFURWLQ0rZ-oUybKkJGp1zq2cEUXLDAQ7/exec";
  const LIFF_ID = "2008594376-aBuTJTic";

  const DEFAULT_AREA = {
    areaId: "",
    areaName: "ยังไม่ได้เลือกพื้นที่",
    centerLat: 13.968639,
    centerLng: 100.619861,
    northMeters: 50,
    southMeters: 50,
    eastMeters: 50,
    westMeters: 50,
    note: "กรุณาสแกน QR Code ของพื้นที่ที่ต้องการเช็กอิน",
    active: true,
    visibleRoles: "masteradmin,admin,user",
    visibleUsers: "",
  };

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      if (parsed === null || parsed === undefined) return fallback;
      return typeof fallback === "object" && fallback !== null
        ? { ...fallback, ...parsed }
        : parsed;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function readSiteName() {
    try {
      return String(localStorage.getItem(SITE_NAME_KEY) || "").trim();
    } catch (e) {
      return "";
    }
  }

  function writeSiteName(name) {
    try {
      const text = String(name || "").trim();
      if (!text) localStorage.removeItem(SITE_NAME_KEY);
      else localStorage.setItem(SITE_NAME_KEY, text);
    } catch (e) { }
  }

  function toNumberOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function splitList(value) {
    return String(value || "")
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function normalizeArea(raw, fallbackIndex) {
    const source = raw || {};
    // ใช้ qr_code เป็นหลัก แต่รองรับ areaId เพื่อความเข้ากันได้
    // หมายเหตุ: ถ้าแถวข้อมูลไม่มี qr_code/areaId เลย (ข้อมูลเก่าที่ยังไม่เคยมีรหัส)
    // ห้าม fallback เป็นค่าคงที่ "qr_code" ทุกแถว เพราะจะทำให้หลายพื้นที่ชนกันเป็น id เดียว
    // ให้ใช้ index ที่ส่งมาสร้างรหัสชั่วคราวที่ไม่ซ้ำกันแทน (เฉพาะตอนแสดงผล ไม่ใช่ตอนบันทึก)
    const hasRealId = Boolean(
      String(source.qr_code || source.areaId || source.id || source.code || source.siteId || source.site || "").trim()
    );
    const areaId = hasRealId
      ? String(
        source.areaId ||
        source.qr_code ||
        source.id ||
        source.code ||
        source.siteId ||
        source.site ||
        "",
      ).trim()
      : `__legacy-no-id-${Number.isFinite(fallbackIndex) ? fallbackIndex : Math.random().toString(36).slice(2, 8)}`;

    // areaName อาจมากจาก remark, areaName, siteName, หรือ qr_code
    const areaName = String(
      source.remark ||
      source.areaName ||
      source.siteName ||
      source.site ||
      source.note ||
      source.qr_code ||
      readSiteName() ||
      DEFAULT_AREA.areaName,
    ).trim() || DEFAULT_AREA.areaName;

    return {
      areaId,
      qr_code: hasRealId ? areaId : "", // ไม่ยัด id ปลอมกลับเข้า qr_code เวลาบันทึกใหม่
      areaName,
      centerLat: toNumberOr(source.centerLat ?? source.lat, DEFAULT_AREA.centerLat),
      centerLng: toNumberOr(source.centerLng ?? source.lng, DEFAULT_AREA.centerLng),
      northMeters: Math.max(0, toNumberOr(source.northMeters ?? source.north, DEFAULT_AREA.northMeters)),
      southMeters: Math.max(0, toNumberOr(source.southMeters ?? source.south, DEFAULT_AREA.southMeters)),
      eastMeters: Math.max(0, toNumberOr(source.eastMeters ?? source.east, DEFAULT_AREA.eastMeters)),
      westMeters: Math.max(0, toNumberOr(source.westMeters ?? source.west, DEFAULT_AREA.westMeters)),
      note: String(source.remark ?? source.note ?? DEFAULT_AREA.note).trim() || DEFAULT_AREA.note,
      remark: String(source.remark ?? source.note ?? DEFAULT_AREA.note).trim() || DEFAULT_AREA.note,
      active: source.active === false ? false : true,
      visibleRoles: String(source.assign ?? source.visibleRoles ?? DEFAULT_AREA.visibleRoles).trim() || DEFAULT_AREA.visibleRoles,
      visibleUsers: String(source.email ?? source.visibleUsers ?? source.allowedUsers ?? "").trim(),
      assign: String(source.assign ?? source.visibleRoles ?? DEFAULT_AREA.visibleRoles).trim() || DEFAULT_AREA.visibleRoles,
      email: String(source.email ?? source.visibleUsers ?? source.allowedUsers ?? "").trim(),
      maxAccuracy: toNumberOr(source.maxAccuracy, DEFAULT_AREA.maxAccuracy || 30),
      updatedAt: String(source.updatedAt || "").trim(),
      updatedBy: String(source.updatedBy || "").trim(),
    };
  }

  function normalizeAreaList(payload) {
    const list = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
    return list.map((item, idx) => normalizeArea(item, idx));
  }

  function getAreaCacheKey() {
    return AREA_CACHE_KEY;
  }

  async function requestJson(action, payload = null, method = "GET", timeoutMs = 20000) {
    const upper = String(method || "GET").toUpperCase();
    let url = API_URL;
    const options = {
      method: upper,
      cache: "no-store",
    };

    if (upper === "GET") {
      const params = new URLSearchParams();
      params.set("action", action);
      params.set("_ts", String(Date.now()));
      if (payload && typeof payload === "object") {
        Object.entries(payload).forEach(([key, value]) => {
          if (value === undefined || value === null || value === "") return;
          params.set(key, String(value));
        });
      }
      url = `${API_URL}?${params.toString()}`;
    } else {
      options.headers = { "Content-Type": "text/plain;charset=utf-8" };
      options.body = JSON.stringify({ action, ...(payload || {}) });
    }

    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    let timeoutId = null;
    if (controller) {
      options.signal = controller.signal;
      if (Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0) {
        timeoutId = setTimeout(() => controller.abort(), Number(timeoutMs));
      }
    }

    try {
      const response = await fetch(url, options);
      const text = await response.text();
      let data = {};
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error("Apps Script ตอบกลับไม่ใช่ JSON: " + text);
      }
      if (!response.ok || data.ok === false) {
        throw new Error(data.err || data.error || data.message || "การร้องขอ API ล้มเหลว");
      }
      return data;
    } catch (err) {
      if (err && err.name === "AbortError") throw new Error("หมดเวลาการร้องขอ");
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function cacheAreas(list) {
    try { localStorage.setItem(getAreaCacheKey(), JSON.stringify(list || [])); } catch (e) { }
  }

  function readCachedAreas() {
    return readJSON(getAreaCacheKey(), []);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function getAreas(timeoutMs = 15000, bypassCache = false) {
    try {
      // ⚠️ BUGFIX (โหลดพื้นที่ timeout บ่อย โดยเฉพาะครั้งแรกที่เปิดหน้า):
      // Apps Script Web App มักมี "cold start" (เครื่องแม่ข่ายยังไม่ถูกปลุก/ถูกพักไว้)
      // ทำให้ request แรกช้ากว่าปกติมาก (บางครั้งเกิน 15 วิ) แล้วโดน AbortController ตัดก่อน
      // ทั้งที่ถ้ารอ/ลองใหม่อีกนิดก็จะตอบกลับปกติ เดิมโค้ดนี้ throw ทันทีตั้งแต่ครั้งแรกที่ timeout
      // แก้โดย: ลอง request ซ้ำอัตโนมัติ (GET เท่านั้น ปลอดภัยเพราะไม่ได้เขียนข้อมูล) พร้อมขยาย
      // เวลาคอยขึ้นทุกรอบ ก่อนจะยอม fallback ไปใช้แคช/throw error ให้ผู้ใช้เห็น
      const attempts = [timeoutMs, Math.round(timeoutMs * 1.5), timeoutMs * 2];
      let lastErr = null;
      for (let i = 0; i < attempts.length; i++) {
        try {
          if (i > 0) {
            console.warn(
              `[CheckinCommon] getAreas: ลองโหลดพื้นที่ใหม่ (ครั้งที่ ${i + 1}/${attempts.length}, timeout ${attempts[i]}ms)`,
            );
            await sleep(500);
          }
          // Changed Action from "areas" to "location"
          const data = await requestJson("location", null, "GET", attempts[i]);
          const list = normalizeAreaList(data);
          cacheAreas(list);
          return list;
        } catch (attemptErr) {
          lastErr = attemptErr;
          // มีแค่ error "หมดเวลาการร้องขอ" เท่านั้นที่ควรลองใหม่ — error อื่น (เช่น Apps Script
          // ตอบ ok:false เพราะ config ผิด) ลองซ้ำไปก็ไม่มีทางสำเร็จ ให้ throw ออกไปทันที
          if (!attemptErr || attemptErr.message !== "หมดเวลาการร้องขอ") {
            throw attemptErr;
          }
        }
      }
      throw lastErr;
    } catch (e) {
      // ⚠️ BUGFIX (check-in ไม่ผ่านทั้งที่อยู่ในพื้นที่จริง):
      // เดิมโค้ดตรงนี้ ถ้า bypassCache=true แล้วโหลดจากเซิร์ฟเวอร์ไม่สำเร็จ (เช่น เน็ตมือถือหลุด/
      // Apps Script ตอบช้า/timeout) จะคืนค่า [normalizeArea(DEFAULT_AREA)] ซึ่งเป็นพิกัด "ตัวอย่าง"
      // ที่ฝังไว้ใน common.js เอง (ไม่ใช่พิกัดพื้นที่จริงที่ Admin ตั้งค่าไว้) — คลาดกันได้เป็นร้อยเมตร
      // ผลคือ user มือถือที่ยืนอยู่ในพื้นที่จริงแท้ๆ จะถูกเช็คระยะทางกับพิกัด "หลอก" นี้แทน ทำให้
      // เช็คอินไม่ผ่านโดยไม่มีใครรู้สาเหตุ (ปัญหานี้ไม่ค่อยเกิดบนคอมของ Admin เพราะเน็ต/แคชเสถียรกว่า)
      // แก้โดย: ลองใช้ค่าที่แคชไว้ก่อนเสมอ (ไม่สนใจ bypassCache ตอน error) และถ้าไม่มีแคชเลยจริงๆ
      // ให้ throw error ต่อ เพื่อให้หน้าจอ (loadConfig ฝั่ง user-checkin.js) แสดงข้อความ "โหลดไม่สำเร็จ"
      // แทนที่จะเงียบๆ แล้วเอาพิกัดผิดไปคำนวณระยะทาง
      console.error("[CheckinCommon] getAreas: โหลดพื้นที่จากเซิร์ฟเวอร์ไม่สำเร็จ", e);
      const cached = normalizeAreaList(readCachedAreas());
      if (cached.length) {
        console.warn("[CheckinCommon] getAreas: ใช้ข้อมูลพื้นที่จากแคชแทน (" + cached.length + " รายการ)");
        return cached;
      }
      if (bypassCache) {
        throw e;
      }
      return cached; // []
    }
  }

  function invalidateAreaCache() {
    try {
      localStorage.removeItem(getAreaCacheKey());
    } catch (e) { }
  }

  async function saveLocationEntry(payload, timeoutMs = 30000) {
    const data = await requestJson("location", payload || {}, "POST", timeoutMs);
    invalidateAreaCache();
    await getAreas(timeoutMs, true);
    return data;
  }

  async function deleteLocationEntry(areaId, timeoutMs = 20000) {
    const id = String(areaId || "").trim();
    const data = await requestJson(
      "location",
      { actionType: "delete", areaId: id, qr_code: id, originalAreaId: id },
      "POST",
      timeoutMs,
    );
    invalidateAreaCache();
    await getAreas(timeoutMs, true);
    return data;
  }

  function findAreaById(list, areaId) {
    const id = String(areaId || "").trim();
    if (!id) return null;
    return (list || []).find(
      (a) =>
        String(a.areaId || "").trim() === id ||
        String(a.qr_code || "").trim() === id,
    ) || null;
  }

  function areaDisplayMetrics(area) {
    const src = area || {};
    return {
      centerLat: src.centerLat ?? src.lat,
      centerLng: src.centerLng ?? src.lng,
      northMeters: src.northMeters ?? src.north,
      southMeters: src.southMeters ?? src.south,
      eastMeters: src.eastMeters ?? src.east,
      westMeters: src.westMeters ?? src.west,
    };
  }

  async function getArea(areaId, timeoutMs = 15000) {
    const list = await getAreas(timeoutMs);
    const id = String(areaId || "").trim();
    if (!id) return list[0] || normalizeArea(DEFAULT_AREA);

    const found = findAreaById(list, id);
    return found || list[0] || normalizeArea(DEFAULT_AREA);
  }

  async function saveArea(area, timeoutMs = 20000) {
    const normalized = normalizeArea(area);
    const isCreatingNew = !String(area?.originalAreaId || area?.previousAreaId || "").trim();
    // Changed Action from "areas" to "location"
    const data = await requestJson("location", {
      ...normalized,
      originalAreaId: isCreatingNew ? "" : String(area?.originalAreaId || area?.previousAreaId || "").trim(),
    }, "POST", timeoutMs);
    cacheAreas(normalizeAreaList(data?.data || data?.areas || [normalized]));
    return normalized;
  }

  async function deleteArea(areaId, timeoutMs = 15000) {
    // Changed Action from "areas" to "location"
    const data = await requestJson("location", { areaId: String(areaId || ""), actionType: "delete" }, "POST", timeoutMs);
    return data;
  }

  function resetData() {
    localStorage.removeItem(getAreaCacheKey());
    localStorage.removeItem(SITE_NAME_KEY);
    localStorage.removeItem(PENDING_KEY);
    localStorage.removeItem(LAST_CHECKIN_KEY);
    localStorage.removeItem("last_failed_checkin");
    sessionStorage.removeItem("checkin_flow_running");
    localStorage.removeItem("pk_token");
    localStorage.removeItem("token");
    localStorage.removeItem("user_id");
    localStorage.removeItem("user_profile");
  }

  function setPendingCheckin(payload) { writeJSON(PENDING_KEY, payload); }
  function getPendingCheckin() { return readJSON(PENDING_KEY, null); }
  function clearPendingCheckin() { localStorage.removeItem(PENDING_KEY); }

  function parseBangkokDateTime(raw) {
    if (raw === null || raw === undefined || raw === "") return null;
    if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : new Date(raw.getTime());
    const text = String(raw).trim();
    if (!text) return null;
    if (/[zZ]$|[+-]\d{2}:?\d{2}$|T/.test(text)) {
      const nativeDate = new Date(text);
      if (!Number.isNaN(nativeDate.getTime())) return nativeDate;
    }
    const match = text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
    if (match) {
      const y = Number(match[1]);
      const m = Number(match[2]);
      const d = Number(match[3]);
      const hh = Number(match[4] || 0);
      const mm = Number(match[5] || 0);
      const ss = Number(match[6] || 0);
      return new Date(Date.UTC(y, m - 1, d, hh, mm, ss) - 7 * 60 * 60 * 1000);
    }
    const fallback = new Date(text);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  async function addLog(entry, timeoutMs = 30000) {
    const result = await requestJson("logs", entry || {}, "POST", timeoutMs);
    return result;
  }

  // GPS Test Mode: บันทึกทันทีลง Sheet "Test" ไม่ตรวจ Geofence เรียกได้หลายครั้งต่อ Check-in 1 ครั้ง
  async function addTestLog(entry, timeoutMs = 30000) {
    const result = await requestJson("testLog", entry || {}, "POST", timeoutMs);
    return result;
  }

  // บันทึกชื่อที่ admin ใส่ให้กับคนเช็คอินที่ LINE ไม่ได้ตั้งชื่อมา
  // จับคู่หลักด้วย LINE userId ถ้าไม่มีจึง fallback ไป email — จะอัปเดตให้ทุก log ของคนนั้นที่ตรงกัน
  async function saveLogName(entry, timeoutMs = 15000) {
    return await requestJson("saveLogName", entry || {}, "POST", timeoutMs);
  }

  async function getLogs(options = 200, timeoutMs = 15000) {
    const payload = {};
    if (typeof options === "number" || typeof options === "string") {
      payload.limit = String(options);
    } else if (options && typeof options === "object") {
      Object.entries(options).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") return;
        if (key === "raw") return;
        payload[key] = value;
      });
    }
    const data = await requestJson("logs", payload, "GET", timeoutMs);
    return options && typeof options === "object" && options.raw
      ? data
      : (Array.isArray(data.data) ? data.data : []);
  }

  // สูตร Haversine คำนวณระยะทางจริงระหว่าง 2 พิกัด (หน่วยเมตร)
  // ใช้ร่วมกันทั้งหน้า user-checkin (แสดงระยะห่างให้ user เห็น/debug) และที่อื่นๆ ที่ต้องการระยะทาง
  // เพื่อไม่ให้สูตรคำนวณระยะทางกระจัดกระจายหลายที่แล้วมีค่าไม่ตรงกัน (ต้นเหตุหนึ่งของบั๊กระยะทางคลาดเคลื่อน)
  function calculateDistanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = (deg) => (Number(deg) * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function metersToLatDelta(meters) { return meters / 111320; }
  function metersToLngDelta(meters, lat) {
    const safeLat = Number(lat) || 0;
    const cosLat = Math.cos((safeLat * Math.PI) / 180) || 1;
    return meters / (111320 * cosLat);
  }

  function buildBoundary(area) {
    const lat = Number(area.centerLat || 0);
    const lng = Number(area.centerLng || 0);
    const latDeltaNorth = metersToLatDelta(Number(area.northMeters || 0));
    const latDeltaSouth = metersToLatDelta(Number(area.southMeters || 0));
    const lngDeltaEast = metersToLngDelta(Number(area.eastMeters || 0), lat);
    const lngDeltaWest = metersToLngDelta(Number(area.westMeters || 0), lat);
    return {
      minLat: lat - latDeltaSouth,
      maxLat: lat + latDeltaNorth,
      minLng: lng - lngDeltaWest,
      maxLng: lng + lngDeltaEast,
      centerLat: lat,
      centerLng: lng,
    };
  }

  // ⚠️ ตรวจสอบขอบเขตแบบเข้มงวด ไม่มีการอนุโลมระยะทางใดๆ ทั้งสิ้น (ห้ามบวกเพิ่มบัฟเฟอร์ เช่น +5.5 เมตร หรือใช้ accuracy มาขยายขอบเขตเด็ดขาด)
  // ผู้ใช้ต้องอยู่ในกรอบสี่เหลี่ยมจริงเท่านั้นถึงจะเช็กอินผ่าน ฝั่ง server (Code.gs validateGeofence) ก็ใช้กฎเดียวกันนี้
  function isInsideBoundary(lat, lng, boundary) {
    if (!boundary || !lat || !lng) return false;

    // เอาค่าอนุโลมออกตามความต้องการของผู้ใช้ (เดิมมีการบวกเพิ่ม 2 เมตร)
    const isInside = lat >= boundary.minLat &&
      lat <= boundary.maxLat &&
      lng >= boundary.minLng &&
      lng <= boundary.maxLng;

    // Debug log: ไว้ตรวจสอบตอนมีปัญหาเช็คอินไม่ผ่านทั้งที่อยู่ในพื้นที่จริง
    // (แสดง lat/lng ที่อ่านได้, ขอบเขต/รัศมีของพื้นที่ และระยะห่างจากจุดศูนย์กลาง)
    try {
      const distanceFromCenter =
        Number.isFinite(Number(boundary.centerLat)) && Number.isFinite(Number(boundary.centerLng))
          ? calculateDistanceMeters(lat, lng, boundary.centerLat, boundary.centerLng)
          : null;
      console.log("[CheckinCommon] isInsideBoundary debug:", {
        lat, lng,
        boundary: {
          minLat: boundary.minLat, maxLat: boundary.maxLat,
          minLng: boundary.minLng, maxLng: boundary.maxLng,
          centerLat: boundary.centerLat, centerLng: boundary.centerLng,
        },
        distanceFromCenterMeters: distanceFromCenter,
        isInside,
      });
    } catch (e) { /* อย่าให้ log พัง flow การเช็คอินจริง */ }

    return isInside;
  }

  function formatNumber(value, digits = 6) {
    const n = Number(value);
    if (Number.isNaN(n)) return "-";
    return n.toFixed(digits);
  }

  function formatDate(value) {
    const date = parseBangkokDateTime(value);
    if (!date) return "-";
    const options = {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    };
    const parts = new Intl.DateTimeFormat("en-GB", options).formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value || "";
    return `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}:${get("second") || "00"}`;
  }

  function formatBangkokNow() {
    return formatDate(new Date());
  }

  function getVisibleAreas(areas, role, uid, email) {
    const r = String(role || "user").toLowerCase();
    const id = String(uid || "").trim().toLowerCase();
    const mail = String(email || "").trim().toLowerCase();
    if (r === "masteradmin") return areas.filter((a) => a.active !== false);
    return (areas || []).filter((a) => {
      if (a.active === false) return false;
      const roles = splitList(a.visibleRoles).map((x) => x.toLowerCase());
      const users = splitList(a.visibleUsers).map((x) => x.toLowerCase());
      return roles.includes("all") || roles.includes(r) || users.includes(id) || (mail && users.includes(mail));
    });
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

  function normalizeUserList(payload) {
    const list = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
    return list.map(normalizeUser).filter(Boolean);
  }

  function normalizeConfig(raw) {
    const area = normalizeArea(raw);
    return {
      ...area,
      siteName: String(raw?.siteName || raw?.areaName || area.areaName || "").trim() || area.areaName || "พื้นที่ทั่วไป",
      remark: String(raw?.remark || raw?.note || area.note || "").trim() || area.note || "เช็กอินภายในพื้นที่ที่กำหนด",
      id: area.areaId,
      lat: area.centerLat,
      lng: area.centerLng,
      north: area.northMeters,
      south: area.southMeters,
      east: area.eastMeters,
      west: area.westMeters,
    };
  }

  async function getConfig(areaId = "default", timeoutMs = 15000) {
    const area = await getArea(areaId, timeoutMs);
    return normalizeConfig(area);
  }

  async function saveConfig(config, timeoutMs = 20000) {
    const source = config || {};
    const area = normalizeArea({
      ...source,
      areaId: source.areaId || source.id || "default",
      areaName: source.areaName || source.siteName || source.site || DEFAULT_AREA.areaName,
      centerLat: source.centerLat ?? source.lat,
      centerLng: source.centerLng ?? source.lng,
      northMeters: source.northMeters ?? source.north,
      southMeters: source.southMeters ?? source.south,
      eastMeters: source.eastMeters ?? source.east,
      westMeters: source.westMeters ?? source.west,
      note: source.note || source.remark || DEFAULT_AREA.note,
    });
    return await saveArea(area, timeoutMs);
  }

  function getNavItems(role, currentPage) {
    const r = String(role || "user").toLowerCase();
    const current = String(currentPage || "").toLowerCase();

    const userNav = [
      { key: "user", href: "./user/checkin.html", label: "User" },
    ];

    const adminNav = [
      { key: "qr_code", href: "./qr_code.html", label: "QR Code" },
      { key: "admin", href: "./admin.html", label: "Admin" },
      { key: "logs", href: "./logs.html", label: "Logs" },

    ];

    const masterNav = [
      ...adminNav,
      { key: "users", href: "./users.html", label: "Users" },
      { key: "setarea", href: "./setarea.html", label: "SetArea" },
      { key: "gpstest", href: "./gpstest.html", label: "GPS Test" },
    ];

    const items =
      r === "masteradmin" ? masterNav :
        r === "admin" ? adminNav :
          userNav;

    return items.map((item) => ({
      ...item,
      active: item.key === current,
    }));
  }

  const DEFAULT_CONFIG = normalizeConfig(DEFAULT_AREA);

  function getFirestoreDb() {
    try {
      if (window.FIREBASE_DB) return window.FIREBASE_DB;
      if (window.firebase && typeof firebase.firestore === "function") return firebase.firestore();
    } catch (err) { }
    return null;
  }

  const BOOTSTRAP_MASTERADMIN_EMAILS = ["admin@gmail.com"];

  function isBootstrapMasteradminEmail(email) {
    const normalized = String(email || "").trim().toLowerCase();
    return BOOTSTRAP_MASTERADMIN_EMAILS.includes(normalized);
  }

  function firestoreDocToUser(doc) {
    const data = typeof doc?.data === "function" ? doc.data() : (doc?.data || {});
    return normalizeUser({
      ...data,
      uid: data.uid || doc?.id || "",
      email: data.email || "",
      displayName: data.displayName || "",
      role: data.role || "user",
      active: data.active,
      visibleAreas: data.visibleAreas || "",
      note: data.note || "",
      updatedAt: data.updatedAt || "",
      updatedBy: data.updatedBy || "",
    });
  }

  function filterUsers(list, options) {
    const filters = options && typeof options === "object" ? options : {};
    return list.filter((u) => {
      if (filters.uid && String(u.uid || "") !== String(filters.uid)) return false;
      if (filters.email && String(u.email || "").toLowerCase() !== String(filters.email).toLowerCase()) return false;
      if (filters.role && String(u.role || "").toLowerCase() !== String(filters.role).toLowerCase()) return false;
      if (filters.active !== undefined && filters.active !== null && filters.active !== "") {
        const expected = String(filters.active).toLowerCase();
        const actual = String(u.active).toLowerCase();
        if (expected === "true" && actual !== "true") return false;
        if (expected === "false" && actual !== "false") return false;
      }
      return true;
    });
  }

  async function getFirestoreUsers(options = null) {
    const db = getFirestoreDb();
    if (!db) return null;
    const snap = await db.collection("users").get();
    const list = snap.docs.map((doc) => firestoreDocToUser(doc));
    return filterUsers(list, typeof options === "string" ? { email: options } : options);
  }

  async function findFirestoreUserRef(userLike) {
    const db = getFirestoreDb();
    if (!db) return null;
    const uid = String(userLike?.uid || "").trim();
    const email = String(userLike?.email || "").trim().toLowerCase();

    if (uid) {
      const byId = await db.collection("users").doc(uid).get();
      if (byId.exists) return byId.ref;
    }

    if (email) {
      const snap = await db.collection("users").where("email", "==", email).limit(1).get();
      if (!snap.empty) return snap.docs[0].ref;
    }

    return null;
  }

  async function getFirestoreUserByIdentity(userLike) {
    const db = getFirestoreDb();
    if (!db) return null;

    const ref = await findFirestoreUserRef(userLike);
    if (!ref) return null;

    const snap = await ref.get();
    if (!snap.exists) return null;

    return firestoreDocToUser(snap);
  }

  async function getUsers(options = null, timeoutMs = 15000) {
    try {
      const list = await getFirestoreUsers(options);
      if (Array.isArray(list)) return list;
    } catch (err) {
      console.warn("Firestore users fallback:", err);
    }

    const payload = {};
    if (typeof options === "string") {
      payload.email = options;
    } else if (options && typeof options === "object") {
      Object.entries(options).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") return;
        payload[key] = value;
      });
    }
    const data = await requestJson("users", payload, "GET", timeoutMs);
    return normalizeUserList(data);
  }

  async function saveUser(user, timeoutMs = 20000) {
    const normalized = normalizeUser(user);
    const db = getFirestoreDb();

    if (db) {
      const docId = String(normalized.uid || normalized.email || "").trim();
      if (!docId) {
        throw new Error("ไม่พบรหัสผู้ใช้");
      }
      const payload = {
        ...normalized,
        uid: normalized.uid || docId,
        email: normalized.email || "",
        updatedAt: new Date().toISOString(),
      };
      await db.collection("users").doc(docId).set(payload, { merge: true });
      return { ok: true, data: payload };
    }

    const data = await requestJson("users", normalized, "POST", timeoutMs);
    return data;
  }

  async function deleteUser(user, timeoutMs = 15000) {
    const normalized = normalizeUser(user);
    const db = getFirestoreDb();

    if (db) {
      const ref = await findFirestoreUserRef(normalized);
      if (ref) {
        await ref.delete();
        return { ok: true };
      }

      const docId = String(normalized.uid || normalized.email || "").trim();
      if (docId) {
        await db.collection("users").doc(docId).delete().catch(() => { });
        return { ok: true };
      }
      throw new Error("ไม่พบรหัสผู้ใช้");
    }

    const payload = {
      uid: normalized.uid,
      email: normalized.email,
      actionType: "delete",
    };
    return await requestJson("users", payload, "POST", timeoutMs);
  }

  // สร้าง Firebase Auth user ผ่าน REST API
  // → ไม่ logout masteradmin ที่ login อยู่
  // → password ไม่ถูกเก็บใน Firestore เลย
  async function createAuthUser(email, password, displayName) {
    const cfg = window.FIREBASE_CONFIG || {};
    const apiKey = String(cfg.apiKey || "").trim();
    if (!apiKey) throw new Error("ไม่พบ Firebase API Key ใน FIREBASE_CONFIG");

    const url = "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + apiKey;
    const body = {
      email: String(email || "").trim(),
      password: String(password || ""),
      returnSecureToken: false,
    };
    if (displayName) body.displayName = String(displayName).trim();

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      const code = String(data && data.error && data.error.message || "").split(" : ")[0].trim();
      const thaiMsg = {
        "EMAIL_EXISTS": "อีเมลนี้มีบัญชีอยู่ใน Firebase Authentication แล้ว",
        "INVALID_EMAIL": "รูปแบบอีเมลไม่ถูกต้อง",
        "WEAK_PASSWORD": "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร",
        "MISSING_PASSWORD": "กรุณากรอกรหัสผ่าน",
        "MISSING_EMAIL": "กรุณากรอกอีเมล",
        "OPERATION_NOT_ALLOWED": "การสมัครด้วย email/password ถูกปิดอยู่ — เปิดใน Firebase Console → Authentication → Sign-in method",
        "TOO_MANY_ATTEMPTS_TRY_LATER": "ร้องขอมากเกินไป กรุณาลองใหม่ภายหลัง",
      };
      throw new Error(thaiMsg[code] || (data && data.error && data.error.message) || "สร้าง Firebase Auth user ไม่สำเร็จ");
    }

    return {
      uid: String(data.localId || ""),
      email: String(data.email || email || "").toLowerCase(),
      displayName: String(data.displayName || displayName || ""),
    };
  }

  async function resolveUserAccess(sessionLike, timeoutMs = 15000) {
    const user = sessionLike?.user || sessionLike || null;
    const uid = String(user?.uid || sessionLike?.uid || "").trim();
    const email = String(user?.email || sessionLike?.email || "").trim().toLowerCase();

    let matched = null;

    try {
      matched = await getFirestoreUserByIdentity({ uid, email });
    } catch (err) { }

    if (!matched) {
      const users = await getUsers({}, timeoutMs).catch(() => []);
      matched = users.find((u) => {
        if (uid && String(u.uid || "") === uid) return true;
        if (email && String(u.email || "").toLowerCase() === email) return true;
        return false;
      }) || null;
    }

    const bootstrapRole = isBootstrapMasteradminEmail(email) ? "masteradmin" : null;
    const role = bootstrapRole || matched?.role || "user";

    return {
      user: matched,
      uid,
      email,
      role,
      active: matched?.active === false ? false : true,
    };
  }

  function getRoleLabel(role) {
    const r = String(role || "user").toLowerCase();
    if (r === "masteradmin") return "masteradmin";
    if (r === "admin") return "admin";
    return "user";
  }

  window.CheckinCommon = {
    DEFAULT_AREA,
    DEFAULT_CONFIG,
    API_URL,
    LIFF_ID,
    getAreas,
    getConfig,
    saveConfig,
    getNavItems,
    getArea,
    saveArea,
    saveLocationEntry,
    deleteLocationEntry,
    invalidateAreaCache,
    findAreaById,
    areaDisplayMetrics,
    deleteArea,
    resetData,
    setPendingCheckin,
    getPendingCheckin,
    clearPendingCheckin,
    addLog,
    addTestLog,
    saveLogName,
    getLogs,
    getUsers,
    saveUser,
    deleteUser,
    createAuthUser,
    resolveUserAccess,
    isBootstrapMasteradminEmail,
    getRoleLabel,
    buildBoundary,
    isInsideBoundary,
    calculateDistanceMeters,
    formatDate,
    formatBangkokNow,
    formatNumber,
    parseBangkokDateTime,
    getVisibleAreas,
    normalizeArea,
    normalizeAreaList,
    normalizeConfig,
    normalizeUser,
  };
})();