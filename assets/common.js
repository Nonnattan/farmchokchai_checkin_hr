(function () {
  // คีย์สำหรับเก็บข้อมูลใน localStorage/sessionStorage
  const SITE_NAME_KEY = "checkin_prototype_site_name";
  
  // คีย์สำหรับเก็บข้อมูลการเช็กอินที่ยังไม่ส่งไปยังเซิร์ฟเวอร์ (เช่น กรณีออฟไลน์)
  // สำหรับใช้สแกนอีกครั้งและกลับมาหน้าเช็คอิน (กรณีที่ login line แล้วไม่ต้อง login อีกครั้ง)
  const PENDING_KEY = "pending_checkin_payload";
  
  // คีย์สำหรับเก็บข้อมูลการเช็กอินครั้งล่าสุด (lat lng และ timestamp)
  const LAST_CHECKIN_KEY = "last_checkin";

  // URL ของ Google Apps Script ที่ทำหน้าที่เป็น backend API
  const API_URL = "https://script.google.com/macros/s/AKfycbxYlFDyD4nPBttjY0z0PhqBBqefSZCSO52Q8UOatuAS_DN3AVxA1fA3ezY_CSFd1NLs/exec";
  
  //ทดสอบ
  // const API_URL = "https://script.google.com/macros/s/AKfycbx83L7wrOPYINgiH6QXX5yb4XVulVJRf8vzJ-QseHkbZp6m6inzQnUX0wFYx66ze0yXWw/exec";

  // LIFF ID สำหรับการใช้งาน LINE Front-end Framework 
  const LIFF_ID = "2008594376-hmZ7K2H2";
  
  //ทดสอบ
  // const LIFF_ID = "2008594376-MrQ7IGVX";


  const DEFAULT_CONFIG = {
    siteName: "Check-in Zone",
    centerLat: 13.968639,
    centerLng: 100.619861,
    northMeters: 50,
    southMeters: 50,
    eastMeters: 80,
    westMeters: 50,
    note: "อยู่ในกรอบสี่เหลี่ยมนี้เท่านั้นจึงจะเช็กอินได้",
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
      if (!text) {
        localStorage.removeItem(SITE_NAME_KEY);
      } else {
        localStorage.setItem(SITE_NAME_KEY, text);
      }
    } catch (e) { }
  }

  function toNumberOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeConfig(raw) {
    const source = raw || {};
    return {
      siteName: String(source.siteName || source.site || readSiteName() || DEFAULT_CONFIG.siteName).trim() || DEFAULT_CONFIG.siteName,
      centerLat: toNumberOr(source.centerLat ?? source.lat, DEFAULT_CONFIG.centerLat),
      centerLng: toNumberOr(source.centerLng ?? source.lng, DEFAULT_CONFIG.centerLng),
      northMeters: Math.max(0, toNumberOr(source.northMeters ?? source.north, DEFAULT_CONFIG.northMeters)),
      southMeters: Math.max(0, toNumberOr(source.southMeters ?? source.south, DEFAULT_CONFIG.southMeters)),
      eastMeters: Math.max(0, toNumberOr(source.eastMeters ?? source.east, DEFAULT_CONFIG.eastMeters)),
      westMeters: Math.max(0, toNumberOr(source.westMeters ?? source.west, DEFAULT_CONFIG.westMeters)),
      note: String(source.note ?? source.remark ?? DEFAULT_CONFIG.note).trim() || DEFAULT_CONFIG.note,
    };
  }

  function getConfigCacheKey() {
    return "checkin_prototype_config_cache";
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
      params.set("_ts", String(Date.now())); // กัน cache
      if (payload && typeof payload === "object") {
        Object.entries(payload).forEach(([key, value]) => {
          if (value === undefined || value === null || value === "") return;
          params.set(key, String(value));
        });
      }
      url = `${API_URL}?${params.toString()}`;
    } else {
      options.headers = {
        "Content-Type": "text/plain;charset=utf-8",
      };
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
        throw new Error(data.error || data.message || "API request failed");
      }

      return data;
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw new Error("request_timeout");
      }
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function cacheConfig(config) {
    try {
      localStorage.setItem(getConfigCacheKey(), JSON.stringify(config || {}));
    } catch (e) { }
  }

  function readCachedConfig() {
    return readJSON(getConfigCacheKey(), null);
  }

  async function getConfig() {
    const cached = readCachedConfig();
    const base = normalizeConfig(cached || DEFAULT_CONFIG);

    try {
      const data = await requestJson("location", null, "GET", 15000);
      const loaded = normalizeConfig(data.data || data.config || data);
      const merged = {
        ...base,
        ...loaded,
        siteName: loaded.siteName || base.siteName || DEFAULT_CONFIG.siteName,
      };
      cacheConfig(merged);
      return merged;
    } catch (e) {
      const fallback = normalizeConfig(base);
      cacheConfig(fallback);
      return fallback;
    }
  }

  async function saveConfig(config) {
    const normalized = normalizeConfig(config);
    writeSiteName(normalized.siteName);
    cacheConfig(normalized);

    await requestJson(
      "location",
      {
        lat: normalized.centerLat,
        lng: normalized.centerLng,
        north: normalized.northMeters,
        south: normalized.southMeters,
        east: normalized.eastMeters,
        west: normalized.westMeters,
        remark: normalized.note,
      },
      "POST",
      20000,
    );

    return normalized;
  }

  function resetData() {
    localStorage.removeItem(getConfigCacheKey());
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

  function setPendingCheckin(payload) {
    writeJSON(PENDING_KEY, payload);
  }

  function getPendingCheckin() {
    return readJSON(PENDING_KEY, null);
  }

  function clearPendingCheckin() {
    localStorage.removeItem(PENDING_KEY);
  }

  function parseBangkokDateTime(raw) {
    if (raw === null || raw === undefined || raw === "") return null;

    if (raw instanceof Date) {
      return Number.isNaN(raw.getTime()) ? null : new Date(raw.getTime());
    }

    const text = String(raw).trim();
    if (!text) return null;

    if (/[zZ]$|[+-]\d{2}:?\d{2}$|T/.test(text)) {
      const nativeDate = new Date(text);
      if (!Number.isNaN(nativeDate.getTime())) return nativeDate;
    }

    const match = text.match(
      /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/
    );
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
    const data = await requestJson("logs", entry || {}, "POST", timeoutMs);
    return data;
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

  function metersToLatDelta(meters) {
    return meters / 111320;
  }

  function metersToLngDelta(meters, lat) {
    const safeLat = Number(lat) || 0;
    const cosLat = Math.cos((safeLat * Math.PI) / 180) || 1;
    return meters / (111320 * cosLat);
  }

  function buildBoundary(config) {
    const lat = Number(config.centerLat || 0);
    const lng = Number(config.centerLng || 0);
    const latDeltaNorth = metersToLatDelta(Number(config.northMeters || 0));
    const latDeltaSouth = metersToLatDelta(Number(config.southMeters || 0));
    const lngDeltaEast = metersToLngDelta(Number(config.eastMeters || 0), lat);
    const lngDeltaWest = metersToLngDelta(Number(config.westMeters || 0), lat);

    return {
      minLat: lat - latDeltaSouth,
      maxLat: lat + latDeltaNorth,
      minLng: lng - lngDeltaWest,
      maxLng: lng + lngDeltaEast,
      centerLat: lat,
      centerLng: lng,
    };
  }

  function isInsideBoundary(lat, lng, boundary) {
    return (
      lat >= boundary.minLat &&
      lat <= boundary.maxLat &&
      lng >= boundary.minLng &&
      lng <= boundary.maxLng
    );
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
      hour12: false,
    };

    const parts = new Intl.DateTimeFormat("en-GB", options).formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value || "";

    const y = get("year");
    const m = get("month");
    const d = get("day");
    const hh = get("hour");
    const mm = get("minute");

    return `${y}/${m}/${d} ${hh}:${mm}`;
  }

  const formatDateTime = formatDate;

  window.CheckinCommon = {
    DEFAULT_CONFIG,
    API_URL,
    LIFF_ID,
    getConfig,
    saveConfig,
    resetData,
    setPendingCheckin,
    getPendingCheckin,
    clearPendingCheckin,
    addLog,
    getLogs,
    buildBoundary,
    isInsideBoundary,
    formatDate,
    formatDateTime,
    formatNumber,
    parseBangkokDateTime,
  };
})();