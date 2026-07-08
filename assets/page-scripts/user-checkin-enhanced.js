const { createApp, computed, onMounted, ref, nextTick, watch } = Vue;
const common = window.CheckinCommon;
const utils = window.EnhancedUtils;

const LIFF_INIT_TIMEOUT_MS = 12000;
const PENDING_FLOW_KEY = "pending_checkin_flow";
const AREA_ID_STORAGE_KEY = "checkin_pending_area_id";
const AREA_ID_STORAGE_TTL_MS = 10 * 60 * 1000;

// ⚠️ ENHANCED: ปรับ GPS readings จาก 10 เป็น 5 ครั้ง และเพิ่ม Timeout
const MAX_GPS_READINGS = 5;
const READING_INTERVAL_MS = 1000;
const GPS_TIMEOUT_MS = 20000; // GPS Timeout 20 วินาที
const GENERAL_TIMEOUT_MS = 30000; // General Timeout 30 วินาที

const TEST_MAX_GPS_READINGS = 10;
const TEST_READING_INTERVAL_MS = 1000;

function rememberAreaId(id) {
  try {
    localStorage.setItem(AREA_ID_STORAGE_KEY, JSON.stringify({ id, ts: Date.now() }));
  } catch (e) { }
}

function recallAreaId() {
  try {
    const raw = localStorage.getItem(AREA_ID_STORAGE_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    const id = String(parsed?.id || "").trim();
    if (!id) return "";
    if (Date.now() - Number(parsed?.ts || 0) > AREA_ID_STORAGE_TTL_MS) return "";
    return id;
  } catch (e) {
    return "";
  }
}

function forgetAreaId() {
  try { localStorage.removeItem(AREA_ID_STORAGE_KEY); } catch (e) { }
}

function resolveAreaId(query) {
  const fromUrl = String(query.get("areaId") || query.get("qr_code") || query.get("site") || "").trim();
  if (fromUrl) {
    rememberAreaId(fromUrl);
    return fromUrl;
  }
  const remembered = recallAreaId();
  if (remembered) {
    console.warn("[UserCheckin] areaId หายไปจาก URL — ใช้ค่าที่จำไว้ก่อนหน้าแทน:", remembered);
    return remembered;
  }
  return "";
}

function setPendingFlow() {
  sessionStorage.setItem(PENDING_FLOW_KEY, "1");
}

function hasPendingFlow() {
  return sessionStorage.getItem(PENDING_FLOW_KEY) === "1";
}

function clearPendingFlow() {
  sessionStorage.removeItem(PENDING_FLOW_KEY);
}

function getReturnUrl(areaId) {
  const url = new URL(window.location.href);
  ["code", "state", "liff.state", "access_token", "token"].forEach((key) => {
    url.searchParams.delete(key);
  });
  if (areaId) url.searchParams.set("areaId", areaId);
  url.hash = "";
  return url.toString();
}

// ============================================
// ENHANCED: Timeout Wrapper (ใช้จาก utils-enhanced.js)
// ============================================
function withTimeout(promise, ms, message) {
  return utils.withTimeout(promise, ms, message);
}

// Prevent browser bfcache issues
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    window.location.reload();
  }
});

createApp({
  setup() {
    const config = ref({ ...common.DEFAULT_CONFIG });
    const loading = ref(false);
    const profile = ref(null);
    const liffReady = ref(false);
    const authState = ref("checking");
    
    // ⚠️ ENHANCED: เพิ่ม state สำหรับ Browser check และ Internet check
    const browserCheckDone = ref(false);
    const browserWarning = ref(null);
    const internetConnected = ref(true);
    const gpsPermissionStatus = ref(null);

    const statusType = ref("idle");
    const message = ref("พร้อมใช้งาน");
    const subMessage = ref("กำลังโหลด...");
    
    // ⚠️ ENHANCED: เพิ่ม step-by-step loading indicator
    // ลำดับขั้นตอนตามที่กำหนด: โหลดข้อมูลผู้ใช้ → โหลดพื้นที่ → อ่าน GPS → ตรวจสอบระยะ → บันทึกข้อมูล
    // (browser/internet เป็น pre-check ก่อนเริ่ม flow หลัก)
    const loadingSteps = ref([
      { id: 'browser', label: 'ตรวจสอบ Browser', status: 'pending' },
      { id: 'internet', label: 'ตรวจสอบ Internet', status: 'pending' },
      { id: 'liff', label: 'โหลดข้อมูลผู้ใช้ (LINE)', status: 'pending' },
      { id: 'config', label: 'โหลดพื้นที่เช็คอิน', status: 'pending' },
      { id: 'gps', label: 'อ่านตำแหน่ง GPS', status: 'pending' },
      { id: 'distance', label: 'ตรวจสอบระยะห่าง', status: 'pending' },
      { id: 'save', label: 'บันทึกข้อมูล', status: 'pending' },
    ]);

    // ⚠️ ENHANCED: Timeout/Error Dialog แบบ Modal พร้อมปุ่ม "ลองใหม่" — ใช้ร่วมกันทุก step ที่มี Timeout
    const timeoutDialog = ref({ visible: false, title: '', message: '', action: null });

    function openTimeoutDialog(title, message, action) {
      timeoutDialog.value = { visible: true, title, message, action: typeof action === 'function' ? action : null };
    }

    function closeTimeoutDialog() {
      timeoutDialog.value = { visible: false, title: '', message: '', action: null };
    }

    function handleTimeoutDialogRetry() {
      const action = timeoutDialog.value.action;
      closeTimeoutDialog();
      if (typeof action === 'function') action();
    }

    // รีเซ็ต step ที่ระบุกลับเป็น pending ก่อนเริ่มลองใหม่
    function resetLoadingSteps(ids) {
      loadingSteps.value.forEach((step) => {
        if (!ids || ids.includes(step.id)) step.status = 'pending';
      });
    }

    function isTimeoutLikeError(err, normalizedErr) {
      if (normalizedErr && (normalizedErr.type === 'timeout_error' || normalizedErr.type === 'gps_timeout')) return true;
      const msg = String(err?.message || '').toLowerCase();
      return msg.includes('timeout') || msg.includes('หมดเวลา');
    }

    const samplingInProgress = ref(false);

    const query = new URLSearchParams(location.search);
    const areaId = resolveAreaId(query);
    const session = query.get("session") || "-";
    const testMode = query.get("test") === "1";
    const site = computed(
      () => query.get("site") || config.value.siteName || config.value.areaName || "-",
    );
    const boundary = computed(() => common.buildBoundary(config.value));

    const mapEl = ref(null);
    const currentLat = ref(null);
    const currentLng = ref(null);
    const currentAccuracy = ref(null);
    const currentDistance = ref(null);
    const readingCount = ref(0);
    const maxAccuracy = ref(30);
    
    let gpsReadings = [];
    let watchId = null;
    let samplingStartTime = null;

    let map = null;
    let boundaryRect = null;
    let centerMarker = null;
    let currentMarker = null;
    let currentCircle = null;

    const dynamicButtonText = computed(() => {
      if (authState.value === "checking") return "กำลังตรวจสอบ...";
      if (authState.value === "error") return "⟳ ลองเชื่อมต่อใหม่";
      if (authState.value === "logged_out") return "กำลังเปลี่ยนเส้นทางไปยัง LINE Login...";
      const maxReads = testMode ? TEST_MAX_GPS_READINGS : MAX_GPS_READINGS;
      if (samplingInProgress.value) return `กำลังเก็บข้อมูล GPS${testMode ? " [TEST]" : ""}... (${readingCount.value}/${maxReads})`;
      if (loading.value) return "กำลังบันทึกข้อมูล...";
      return testMode ? "เช็คอิน [TEST MODE]" : "เช็คอิน";
    });

    function setStatus(type, main, sub) {
      statusType.value = type;
      message.value = main;
      subMessage.value = sub || "";
    }
    
    // ⚠️ ENHANCED: อัปเดต step-by-step loading status
    function updateLoadingStep(stepId, status) {
      const step = loadingSteps.value.find(s => s.id === stepId);
      if (step) {
        step.status = status; // 'pending', 'loading', 'success', 'error'
      }
    }
    
    function getLoadingStepsText() {
      const steps = loadingSteps.value;
      const completed = steps.filter(s => s.status === 'success').length;
      const total = steps.length;
      const current = steps.find(s => s.status === 'loading');
      
      let text = `${completed}/${total} ขั้นตอน`;
      if (current) {
        text += ` • ${current.label}`;
      }
      return text;
    }

    function setStatusBrowser(type, main, sub) {
      setStatus(type, main, sub || getLoadingStepsText());
    }

    // ⚠️ ENHANCED: ตรวจสอบ Browser type ก่อนเริ่มเช็คอิน
    async function checkBrowserType() {
      try {
        updateLoadingStep('browser', 'loading');
        
        if (!utils.isAllowedBrowser()) {
          const warning = utils.getBrowserWarningMessage();
          browserWarning.value = warning;
          setStatusBrowser(
            "error",
            warning.title,
            warning.message + "\n\n" + warning.instruction,
          );
          updateLoadingStep('browser', 'error');
          authState.value = "browser_not_allowed";
          return false;
        }
        
        updateLoadingStep('browser', 'success');
        return true;
      } catch (err) {
        console.error("[Browser Check] Error:", err);
        updateLoadingStep('browser', 'error');
        return true; // ให้ผ่านไปถ้าตรวจสอบไม่ได้
      }
    }

    // ⚠️ ENHANCED: ตรวจสอบ Internet connectivity
    async function checkInternet() {
      try {
        updateLoadingStep('internet', 'loading');
        
        const isOnline = await utils.checkInternetConnectivity(5000);
        internetConnected.value = isOnline;
        
        if (!isOnline) {
          setStatusBrowser(
            "error",
            "ไม่มีการเชื่อมต่อ Internet",
            "กรุณาตรวจสอบการเชื่อมต่อ WiFi หรือ Mobile Data แล้วลองใหม่",
          );
          updateLoadingStep('internet', 'error');
          return false;
        }
        
        updateLoadingStep('internet', 'success');
        return true;
      } catch (err) {
        console.error("[Internet Check] Error:", err);
        updateLoadingStep('internet', 'error');
        return false;
      }
    }

    // ⚠️ ENHANCED: ตรวจสอบ GPS Permission
    async function checkGPSPermissionStatus() {
      try {
        const result = await utils.checkGPSPermission();
        gpsPermissionStatus.value = result;
        
        if (result.status === 'denied') {
          console.warn("[GPS Permission] ถูกปฏิเสธ:", result.instruction);
        }
        return result;
      } catch (err) {
        console.error("[GPS Permission Check] Error:", err);
        return null;
      }
    }

    async function loadConfig() {
      try {
        updateLoadingStep('config', 'loading');
        setStatusBrowser("loading", "โหลดการตั้งค่าพื้นที่...", "");
        
        const area = await withTimeout(
          common.getArea(areaId, GENERAL_TIMEOUT_MS),
          GENERAL_TIMEOUT_MS,
          "หมดเวลาการโหลดการตั้งค่าพื้นที่ (30 วินาที)",
        );

        if (areaId && String(area?.areaId || "").trim() !== String(areaId).trim()) {
          throw new Error(
            `ไม่พบพื้นที่ตามรหัส QR (${areaId}) ในระบบ กรุณาสแกน QR ใหม่ หรือแจ้งผู้ดูแลระบบ`,
          );
        }

        config.value = common.normalizeConfig(area);
        maxAccuracy.value = Number(config.value.maxAccuracy || 30);
        forgetAreaId();
        
        updateLoadingStep('config', 'success');

        console.log("[UserCheckin] loadConfig: โหลดพื้นที่สำเร็จ", {
          requestedAreaId: areaId || "(ไม่ระบุ ใช้พื้นที่แรก)",
          resolvedAreaId: config.value.areaId,
          areaName: config.value.areaName,
          centerLat: config.value.centerLat,
          centerLng: config.value.centerLng,
          maxAccuracy: maxAccuracy.value,
        });
      } catch (err) {
        console.error("[loadConfig] Error:", err);
        updateLoadingStep('config', 'error');
        
        const normalizedErr = utils.normalizeError(err, 'loadConfig');
        setStatusBrowser(
          "error",
          normalizedErr.title,
          normalizedErr.message,
        );

        // ⚠️ ENHANCED: หมดเวลา → ยกเลิก Loading และแสดง Dialog พร้อมปุ่ม "ลองใหม่"
        if (isTimeoutLikeError(err, normalizedErr)) {
          openTimeoutDialog(normalizedErr.title, normalizedErr.message, () => {
            resetLoadingSteps(['config']);
            retryInit();
          });
        }
      }
    }

    function isTokenRevokedError(err) {
      const msg = String(err?.message || "").toLowerCase();
      return (
        msg.includes("revoked") ||
        msg.includes("token") ||
        msg.includes("unauthorized") ||
        msg.includes("invalid") ||
        (err?.code && (err.code === 403 || err.code === 401))
      );
    }

    function clearLiffSession() {
      try {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k.startsWith("LIFF_STORE:") || k.startsWith("liff_") || k.includes("access_token"))) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach(function(k) { localStorage.removeItem(k); });
        console.log("[LIFF] ล้าง LIFF session แล้ว", keysToRemove.length, "keys");
      } catch (e) { }
    }

    async function initLiff() {
      try {
        updateLoadingStep('liff', 'loading');
        setStatusBrowser("loading", "เชื่อมต่อ LINE...", "");
        
        if (!window.liff)
          throw new Error("ไม่พบ LIFF SDK");
        if (!common?.LIFF_ID)
          throw new Error("กรุณาตรวจสอบการตั้งค่า LIFF ID");

        await withTimeout(
          liff.init({
            liffId: common.LIFF_ID,
            withLoginOnExternalBrowser: false,
          }),
          LIFF_INIT_TIMEOUT_MS,
          "หมดเวลาการเริ่มต้น LIFF (12 วินาที)",
        );

        liffReady.value = true;

        // ⚠️ ENHANCED: ตรวจสอบ Browser type ผ่าน LIFF
        if (liff.isInClient()) {
          setStatusBrowser(
            "idle",
            "กำลังเปิดใน Browser ภายนอก...",
            "กรุณารอสักครู่ ระบบกำลังเปลี่ยนไปเปิดหน้านี้ใน Chrome/Safari ของเครื่องคุณ",
          );
          liff.openWindow({
            url: getReturnUrl(areaId),
            external: true,
          });
          return;
        }

        if (liff.isLoggedIn()) {
          try {
            profile.value = await withTimeout(
              liff.getProfile(),
              8000,
              "getProfile timeout",
            );
            authState.value = "logged_in";
            updateLoadingStep('liff', 'success');
            setStatusBrowser("idle", "พร้อมเช็คอิน", "กดปุ่มด้านล่างเพื่อเริ่มเช็คอิน");
            console.log("[LIFF] โหลด Profile สำเร็จ:", profile.value?.displayName);
          } catch (profileErr) {
            console.warn("[LIFF] getProfile ล้มเหลว:", profileErr);
            if (isTokenRevokedError(profileErr)) {
              console.log("[LIFF] Token revoked — ล้าง session และ login ใหม่");
              clearLiffSession();
              authState.value = "logged_out";
              setStatusBrowser(
                "idle",
                "กำลังเปลี่ยนเส้นทางไปยัง LINE Login...",
                "ตรวจพบ Session หมดอายุ กำลังเชื่อมต่อ LINE ใหม่ กรุณารอสักครู่",
              );
              setTimeout(function() {
                liff.login({ redirectUri: getReturnUrl(areaId) });
              }, 800);
            } else {
              authState.value = "logged_in";
              updateLoadingStep('liff', 'success');
              setStatusBrowser("idle", "พร้อมเช็คอิน", "โหลดข้อมูลบางส่วนไม่สำเร็จ แต่ยังเช็คอินได้");
            }
          }
        } else {
          authState.value = "logged_out";
          setStatusBrowser(
            "idle",
            "กำลังเปลี่ยนเส้นทางไปยัง LINE Login...",
            "กรุณารอสักครู่ ระบบกำลังพาคุณไปยังหน้า LINE Authentication",
          );
          liff.login({ redirectUri: getReturnUrl(areaId) });
        }
      } catch (err) {
        console.error("[LIFF] initLiff error:", err);
        updateLoadingStep('liff', 'error');
        
        if (isTokenRevokedError(err)) {
          console.log("[LIFF] Token revoked ใน init — ล้าง session และ login ใหม่");
          clearLiffSession();
          authState.value = "logged_out";
          setStatusBrowser(
            "idle",
            "กำลังเปลี่ยนเส้นทางไปยัง LINE Login...",
            "ตรวจพบ Session หมดอายุ กำลังเชื่อมต่อ LINE ใหม่ กรุณารอสักครู่",
          );
          setTimeout(function() {
            liff.login({ redirectUri: getReturnUrl(areaId) });
          }, 800);
        } else {
          const normalizedErr = utils.normalizeError(err, 'initLiff');
          authState.value = "error";
          setStatusBrowser(
            "error",
            normalizedErr.title,
            normalizedErr.message,
          );

          // ⚠️ ENHANCED: หมดเวลา → ยกเลิก Loading และแสดง Dialog พร้อมปุ่ม "ลองใหม่"
          if (isTimeoutLikeError(err, normalizedErr)) {
            openTimeoutDialog(normalizedErr.title, normalizedErr.message, () => {
              resetLoadingSteps(['liff']);
              retryInit();
            });
          }
        }
      }
    }

    function buildPayload(lat, lng, accuracy) {
      const pending = common.getPendingCheckin() || {};
      const decoded = liff.getDecodedIDToken
        ? liff.getDecodedIDToken()
        : {};
      const displayName = profile.value?.displayName || "";

      const safeAccuracy = Number.isFinite(Number(accuracy)) ? Number(accuracy) : null;

      const payload = {
        ...pending,
        site: site.value,
        session,
        displayName,
        name: displayName,
        email: decoded?.email || pending.email || "",
        lat,
        lng,
        accuracy: safeAccuracy,
        maxAccuracy: maxAccuracy.value,
        time: common.formatBangkokNow ? common.formatBangkokNow() : new Date().toISOString(),
        userId: profile.value?.userId || "",
      };

      console.log("[UserCheckin] buildPayload:", {
        lat: payload.lat,
        lng: payload.lng,
        accuracy: payload.accuracy,
        maxAccuracy: payload.maxAccuracy,
        areaId: payload.areaId,
      });

      return payload;
    }

    function drawBoundary() {
      if (!map || !window.L || !boundary.value) return;

      const b = boundary.value;
      const bounds = [
        [b.minLat, b.minLng],
        [b.maxLat, b.maxLng],
      ];

      if (!boundaryRect) {
        boundaryRect = L.rectangle(bounds, {
          color: "#2563eb",
          weight: 2,
          fillColor: "#2563eb",
          fillOpacity: 0.12,
        }).addTo(map);
      } else {
        boundaryRect.setBounds(bounds);
      }

      if (!centerMarker) {
        centerMarker = L.marker([b.centerLat, b.centerLng]).addTo(map);
        centerMarker.bindPopup("จุดศูนย์กลางพื้นที่");
      } else {
        centerMarker.setLatLng([b.centerLat, b.centerLng]);
      }

      map.fitBounds(bounds, { padding: [20, 20] });
    }

    function initMap() {
      if (map || !mapEl.value || !window.L) return;

      map = L.map(mapEl.value, {
        zoomControl: true,
        scrollWheelZoom: false,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      drawBoundary();

      setTimeout(() => {
        if (map) map.invalidateSize();
      }, 200);
    }

    function calculateDistance(lat1, lng1, lat2, lng2) {
      return utils.calculateHaversineDistance(lat1, lng1, lat2, lng2);
    }

    function updateCurrentPosition(lat, lng, accuracy) {
      currentLat.value = Number(lat);
      currentLng.value = Number(lng);
      currentAccuracy.value = Number(accuracy) || 0;

      if (config.value && config.value.centerLat) {
        currentDistance.value = calculateDistance(
          lat,
          lng,
          config.value.centerLat,
          config.value.centerLng,
        );
      }

      console.log("[UserCheckin] GPS reading:", {
        lat: currentLat.value,
        lng: currentLng.value,
        accuracy: currentAccuracy.value,
        distanceToCenterMeters: currentDistance.value,
      });

      if (!map || !window.L) return;

      const ll = [lat, lng];
      const radius = Math.max(Number(accuracy) || 10, 10);

      if (!currentMarker) {
        currentMarker = L.marker(ll).addTo(map);
        currentMarker.bindPopup("ตำแหน่งปัจจุบัน");
      } else {
        currentMarker.setLatLng(ll);
      }

      if (!currentCircle) {
        currentCircle = L.circle(ll, {
          radius,
          weight: 2,
          fillOpacity: 0.12,
        }).addTo(map);
      } else {
        currentCircle.setLatLng(ll);
        currentCircle.setRadius(radius);
      }

      map.setView(ll, Math.max(map.getZoom(), 18), { animate: true });

      setTimeout(() => {
        if (map) map.invalidateSize();
      }, 100);
    }

    // ⚠️ ENHANCED: เลือกค่า GPS ที่ดีที่สุด (ใช้ utils)
    function selectBestGPS(readings) {
      return utils.selectBestGPSReading(
        readings,
        config.value.centerLat,
        config.value.centerLng,
      );
    }

    // ⚠️ ENHANCED: อ่าน GPS แบบ Multi-Read ที่ดีขึ้น
    async function startGPSSampling() {
      if (authState.value !== "logged_in" || samplingInProgress.value) return;

      samplingInProgress.value = true;
      gpsReadings = [];
      readingCount.value = 0;
      samplingStartTime = Date.now();
      resetLoadingSteps(['gps', 'distance', 'save']);
      updateLoadingStep('gps', 'loading');

      if (!navigator.geolocation) {
        setStatus(
          "error",
          "อุปกรณ์ไม่รองรับ GPS",
          "กรุณาเปิดใช้งานบริการระบุตำแหน่งบนอุปกรณ์ของคุณ",
        );
        updateLoadingStep('gps', 'error');
        samplingInProgress.value = false;
        return;
      }

      // ⚠️ ENHANCED: ตรวจสอบ GPS Permission ก่อนอ่าน
      const permStatus = await checkGPSPermissionStatus();
      if (permStatus?.status === 'denied') {
        setStatus(
          "error",
          "ไม่ได้รับสิทธิ์ GPS",
          permStatus.instruction || "กรุณาเปิดสิทธิ์ GPS ในการตั้งค่า",
        );
        updateLoadingStep('gps', 'error');
        samplingInProgress.value = false;
        return;
      }

      const MAX_READINGS = testMode ? TEST_MAX_GPS_READINGS : MAX_GPS_READINGS;
      const READING_INTERVAL = testMode ? TEST_READING_INTERVAL_MS : READING_INTERVAL_MS;
      const TIMEOUT = testMode ? GENERAL_TIMEOUT_MS : GPS_TIMEOUT_MS;

      setStatus(
        "loading",
        testMode ? `กำลังเริ่มเก็บข้อมูล GPS [TEST MODE]...` : "กำลังเริ่มเก็บข้อมูล GPS...",
        `กำลังเก็บข้อมูล ${MAX_READINGS} ครั้ง ทุก ${READING_INTERVAL / 1000} วินาที${testMode ? " (บันทึกทันทีทุกครั้ง)" : ""}`,
      );

      try {
        // ⚠️ ENHANCED: ใช้ readGPSMultiple จาก utils
        const readings = await utils.readGPSMultiple(
          MAX_READINGS,
          READING_INTERVAL,
          TIMEOUT,
          (progress) => {
            readingCount.value = progress.count;
            updateCurrentPosition(progress.lat, progress.lng, progress.accuracy);
            
            setStatus(
              "loading",
              `กำลังเก็บข้อมูล GPS${testMode ? " [TEST]" : ""} (${progress.count}/${MAX_READINGS})...`,
              `ล่าสุด: ละติจูด ${progress.lat.toFixed(6)}, ลองจิจูด ${progress.lng.toFixed(6)}, ความแม่นยำ ${progress.accuracy.toFixed(1)} เมตร`,
            );
          },
        );

        gpsReadings = readings;
        samplingInProgress.value = false;
        updateLoadingStep('gps', 'success');

        if (testMode) {
          // TEST MODE: บันทึกทันทีทุกครั้ง
          setStatus(
            "success",
            `✓ [TEST MODE] เก็บข้อมูลครบ ${MAX_READINGS} ครั้งแล้ว`,
            `บันทึกลง Sheet "Test" เรียบร้อยแล้ว สามารถกดเช็คอินใหม่ได้อีกครั้ง`,
          );
          readingCount.value = 0;
        } else {
          // โหมดปกติ: เลือกค่าที่ดีที่สุด
          updateLoadingStep('distance', 'loading');
          const bestGPS = selectBestGPS(readings);

          if (bestGPS) {
            updateCurrentPosition(bestGPS.lat, bestGPS.lng, bestGPS.accuracy);

            const inside = common.isInsideBoundary(
              bestGPS.lat,
              bestGPS.lng,
              boundary.value,
            );

            console.log("[UserCheckin] geofence decision:", {
              selectedLat: bestGPS.lat,
              selectedLng: bestGPS.lng,
              selectedAccuracy: bestGPS.accuracy,
              distanceToCenterMeters: bestGPS.distanceCenter,
              isInside: inside,
            });

            if (inside) {
              updateLoadingStep('distance', 'success');
              setStatus(
                "success",
                "✓ อยู่ในพื้นที่ที่กำหนด",
                "ตรวจสอบสำเร็จ! กำลังบันทึกข้อมูลเช็คอิน...",
              );

              loading.value = true;
              updateLoadingStep('save', 'loading');

              const payload = buildPayload(
                bestGPS.lat,
                bestGPS.lng,
                bestGPS.accuracy,
              );
              payload.clientVerified = true;
              payload.areaId = areaId;
              payload.sampleCount = gpsReadings.length;
              payload.samples = gpsReadings;

              common.setPendingCheckin(payload);
              clearPendingFlow();

              setTimeout(() => {
                window.location.href = "../processing.html";
              }, 1000);
            } else {
              updateLoadingStep('distance', 'error');
              setStatus(
                "error",
                "✗ อยู่นอกพื้นที่ที่กำหนด",
                `ระยะห่าง: ${currentDistance.value ? currentDistance.value.toFixed(1) : '?'} เมตร กรุณาเข้าไปในพื้นที่แล้วลองใหม่อีกครั้ง`,
              );
              readingCount.value = 0;
            }
          }
        }
      } catch (err) {
        console.error("[GPS Sampling] Error:", err);
        samplingInProgress.value = false;
        updateLoadingStep('gps', 'error');

        const normalizedErr = utils.normalizeError(err, 'GPS Sampling');
        setStatus(
          "error",
          normalizedErr.title,
          normalizedErr.message,
        );
        readingCount.value = 0;

        // ⚠️ ENHANCED: หมดเวลา (20 วิ) → ยกเลิก Loading และแสดง Dialog พร้อมปุ่ม "ลองใหม่"
        if (isTimeoutLikeError(err, normalizedErr)) {
          openTimeoutDialog(normalizedErr.title, normalizedErr.message, () => {
            startGPSSampling();
          });
        }
      }
    }

    async function retryInit() {
      authState.value = "checking";
      setStatus("idle", "กำลังลองเชื่อมต่อใหม่...", "กรุณารอสักครู่");
      resetLoadingSteps(['liff', 'config']);
      try {
        await Promise.all([loadConfig(), initLiff()]);
        await nextTick();
        initMap();
      } catch (err) {
        console.error("ข้อผิดพลาดการลองเชื่อมต่อใหม่:", err);
      }
    }

    // ⚠️ ENHANCED: ป้องกันการกดปุ่ม Check-in ซ้ำ
    function confirmCheckIn() {
      if (authState.value === "browser_not_allowed") {
        setStatusBrowser(
          "error",
          "⚠️ ต้องเปิดผ่าน Browser ภายนอก",
          "กรุณาคัดลอก URL นี้ แล้วเปิดใน Chrome หรือ Safari",
        );
        return;
      }
      if (authState.value === "error") { retryInit(); return; }
      if (loading.value) return;
      if (samplingInProgress.value) return;
      if (authState.value !== "logged_in") return;
      startGPSSampling();
    }

    onMounted(async () => {
      try {
        // ⚠️ ENHANCED: ตรวจสอบ Browser ก่อน
        const browserOk = await checkBrowserType();
        if (!browserOk) {
          return;
        }

        // ⚠️ ENHANCED: ตรวจสอบ Internet
        const internetOk = await checkInternet();
        if (!internetOk) {
          return;
        }

        // โหลด Config และ Init LIFF พร้อมกัน
        await Promise.all([loadConfig(), initLiff()]);
        await nextTick();
        initMap();
      } catch (err) {
        console.error("ข้อผิดพลาดการเริ่มต้น:", err);
        const normalizedErr = utils.normalizeError(err, 'onMounted');
        setStatus(
          "error",
          normalizedErr.title,
          normalizedErr.message,
        );
      }
    });

    watch(authState, async (newState) => {
      if (newState === "logged_in") {
        await nextTick();
        initMap();
      }
    });

    watch(boundary, () => {
      if (map && mapEl.value) {
        drawBoundary();
      }
    });

    return {
      config,
      loading,
      profile,
      liffReady,
      authState,
      statusType,
      message,
      subMessage,
      dynamicButtonText,
      mapEl,
      site,
      currentLat,
      currentLng,
      currentAccuracy,
      currentDistance,
      readingCount,
      maxAccuracy,
      maxGpsReadings: MAX_GPS_READINGS,
      startGPSSampling,
      confirmCheckIn,
      samplingInProgress,
      browserWarning,
      internetConnected,
      gpsPermissionStatus,
      loadingSteps,
      timeoutDialog,
      handleTimeoutDialogRetry,
    };
  },
}).mount("#app");
