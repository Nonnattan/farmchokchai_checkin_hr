const { createApp, computed, onMounted, onUnmounted, ref, nextTick, watch } = Vue;
const common = window.CheckinCommon;
const utils = window.EnhancedUtils;

const LIFF_INIT_TIMEOUT_MS = 12000;
const PENDING_FLOW_KEY = "pending_checkin_flow";
const AREA_ID_STORAGE_KEY = "checkin_pending_area_id";
const AREA_ID_STORAGE_TTL_MS = 10 * 60 * 1000;

// ⚠️ ENHANCED: ปรับ GPS readings จาก 10 เป็น 5 ครั้ง และเพิ่ม Timeout
const MAX_GPS_READINGS = 5;
const READING_INTERVAL_MS = 1000;
const GPS_TIMEOUT_MS = 20000; // ⚠️ ไม่ได้ใช้เป็น Deadline รวมของการอ่าน GPS แล้ว (ตัดออกตามที่ต้องการ — รอจนกว่าจะครบจำนวน) เก็บค่าคงที่ไว้เผื่ออ้างอิง/ปรับใช้ในอนาคต
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

    // 🟢 บอกว่ากำลังบังคับเปิด Browser ภายนอกอยู่ (ให้ onMounted รู้ว่าไม่ต้องทำขั้นตอนถัดไปในหน้านี้)
    const externalOpenTriggered = ref(false);

    // 🟢 Generation Counter (นำมาจาก Project ต้นแบบ farmchokchai_checkin): ป้องกัน Race Condition
    // เวลากด "ลองใหม่" ซ้อนกับ Request รอบเก่าที่ยังค้างอยู่ ไม่ให้ผลลัพธ์/ข้อความของรอบเก่า
    // (ที่เพิ่ง Resolve/Timeout ช้า) มาทับ State ของรอบใหม่ที่กำลังทำงานอยู่
    const bootGeneration = ref(0);

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
    // 🟢 TIMEOUT/POLLING MANAGEMENT (เหมือนระบบต้นแบบ farmchokchai_checkin):
    // cancelToken ใช้สั่งหยุด readGPSMultiple (watchPosition + timer ภายใน) ได้ทันทีจากภายนอก
    // เช่นตอนออกจากหน้า (onUnmounted) หรือเริ่มรอบใหม่ (retry) ไม่ให้ Polling รอบเก่าค้างอยู่เบื้องหลัง
    let gpsCancelToken = null;

    // 🟢 หยุด GPS Polling ที่กำลังทำงานอยู่ทันที (ถ้ามี) — จุดเดียวที่ใช้เคลียร์ Polling ของหน้านี้
    function stopGPSSampling() {
      if (gpsCancelToken && typeof gpsCancelToken.cancel === "function") {
        gpsCancelToken.cancel("ยกเลิกการอ่าน GPS");
      }
      gpsCancelToken = null;
    }

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

        const browserInfo = utils.detectBrowserType();

        // 🟢 บังคับเปิด Browser ภายนอก: ถ้าเปิดผ่าน LINE In-App Browser ห้ามหยุด Flow ที่นี่
        // ให้ปล่อยผ่านไปให้ initLiff() ใช้ liff.isInClient() (ทางการจาก LIFF SDK) ตรวจสอบและ
        // เรียก liff.openWindow({ external: true }) บังคับเปิด Chrome/Safari ให้อัตโนมัติ
        // (เหมือนพฤติกรรมของ Project ต้นแบบ farmchokchai_checkin)
        if (browserInfo.isLineApp) {
          updateLoadingStep('browser', 'success');
          return true;
        }

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
      const myGeneration = bootGeneration.value; // 🟢 จำรอบปัจจุบันไว้ก่อน await
      try {
        updateLoadingStep('internet', 'loading');
        
        const isOnline = await utils.checkInternetConnectivity(5000);
        if (myGeneration !== bootGeneration.value) return false; // 🟢 ถูกลองใหม่ไปแล้ว ข้ามผลลัพธ์รอบเก่า
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
      const myGeneration = bootGeneration.value; // 🟢 จำรอบปัจจุบันไว้ก่อน await
      try {
        updateLoadingStep('config', 'loading');
        setStatusBrowser("loading", "โหลดการตั้งค่าพื้นที่...", "");
        
        const area = await withTimeout(
          common.getArea(areaId, GENERAL_TIMEOUT_MS),
          GENERAL_TIMEOUT_MS,
          "หมดเวลาการโหลดการตั้งค่าพื้นที่ (30 วินาที)",
        );

        if (myGeneration !== bootGeneration.value) return; // 🟢 ถูกลองใหม่ไปแล้ว ข้ามผลลัพธ์รอบเก่า

        if (areaId && String(area?.areaId || "").trim() !== String(areaId).trim()) {
          throw new Error(
            `ไม่พบพื้นที่ตามรหัส QR (${areaId}) ในระบบ กรุณาสแกน QR ใหม่ หรือแจ้งผู้ดูแลระบบ`,
          );
        }

        config.value = common.normalizeConfig(area);
        maxAccuracy.value = Number(config.value.maxAccuracy || 30);
        // ⚠️ FIX: ห้ามลบ areaId ที่จำไว้ทิ้งตรงนี้ เพราะปุ่ม "เช็กอินอีกครั้ง" ในหน้า success
        // จะลิงก์กลับมาที่หน้านี้โดยไม่มี areaId แนบไปกับ URL — ถ้าลบทิ้งไปแล้ว ระบบจะหา
        // areaId ไม่เจอและ fallback ไปใช้ "พื้นที่แรกสุด" แทน ทำให้เอา GPS ตำแหน่งเดิมไปเทียบ
        // กับจุดศูนย์กลางของพื้นที่อื่น แล้วฟ้องว่าอยู่นอกเขตทั้งที่ยืนอยู่จุดเดิม
        rememberAreaId(config.value.areaId || areaId);
        
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
        if (myGeneration !== bootGeneration.value) return; // 🟢 ถูกลองใหม่ไปแล้ว ข้าม Error ของรอบเก่า
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
      const myGeneration = bootGeneration.value; // 🟢 จำรอบปัจจุบันไว้ก่อน await
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

        if (myGeneration !== bootGeneration.value) return; // 🟢 ถูกลองใหม่ไปแล้ว ข้ามผลลัพธ์รอบเก่า

        liffReady.value = true;

        // ⚠️ ENHANCED: ตรวจสอบ Browser type ผ่าน LIFF
        if (liff.isInClient()) {
          externalOpenTriggered.value = true;
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
            const tempProfile = await withTimeout(
              liff.getProfile(),
              8000,
              "getProfile timeout",
            );
            if (myGeneration !== bootGeneration.value) return; // 🟢 ถูกลองใหม่ไปแล้ว ข้ามผลลัพธ์รอบเก่า
            profile.value = tempProfile;
            authState.value = "logged_in";
            updateLoadingStep('liff', 'success');
            setStatusBrowser("idle", "พร้อมเช็คอิน", "กดปุ่มด้านล่างเพื่อเริ่มเช็คอิน");
            console.log("[LIFF] โหลด Profile สำเร็จ:", profile.value?.displayName);
          } catch (profileErr) {
            if (myGeneration !== bootGeneration.value) return; // 🟢 ถูกลองใหม่ไปแล้ว ข้าม Error ของรอบเก่า
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
        if (myGeneration !== bootGeneration.value) return; // 🟢 ถูกลองใหม่ไปแล้ว ข้าม Error ของรอบเก่า
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

    // ⚠️ BUGFIX: สร้างรหัสอ้างอิงการเช็คอินนี้ (ครั้งเดียวต่อ 1 รอบเช็คอิน) เพื่อแก้บั๊ก Client
    // เห็น Error "ระบบมีผู้ใช้งานพร้อมกันจำนวนมาก" ทั้งที่ Backend บันทึกสำเร็จแล้ว — รหัสนี้จะถูก
    // เก็บไว้ในข้อมูลที่ persist ผ่าน common.setPendingCheckin() และ processing.html จะอ่านค่า
    // เดิมกลับมาใช้ซ้ำทุกครั้งที่ "ลองใหม่" (ไม่สุ่มใหม่) ทำให้ Apps Script รู้ว่าเป็นการเช็คอินครั้ง
    // เดียวกัน ไม่ใช่การเช็คอินใหม่ซ้อนกัน (ดูฝั่ง saveLog()/getCachedCheckinResult() ใน Code.gs)
    function generateCheckinRequestId() {
      try {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
          return window.crypto.randomUUID();
        }
      } catch (e) { }
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
        // ใช้ค่าเดิมถ้า pending มีอยู่แล้ว (กันเผื่อ buildPayload ถูกเรียกซ้ำ) ไม่งั้นสุ่มใหม่ครั้งเดียว
        checkinRequestId: pending.checkinRequestId || generateCheckinRequestId(),
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

      // 🟢 กันไม่ให้ Polling รอบเก่า (ถ้ามีหลงเหลือ) ทำงานซ้อนกับรอบใหม่
      stopGPSSampling();

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
      // ⏱️ ไม่ตั้ง Deadline รวมให้การอ่าน GPS อีกต่อไป (ตามที่ต้องการ) — รอจนกว่าจะได้ครบ MAX_READINGS
      // (ยังยกเลิกได้ตามปกติผ่าน gpsCancelToken เช่น ตอนออกจากหน้า หรือกดลองใหม่)
      const TIMEOUT = 0;

      setStatus(
        "loading",
        testMode ? `กำลังเริ่มเก็บข้อมูล GPS [TEST MODE]...` : "กำลังเริ่มเก็บข้อมูล GPS...",
        `กำลังเก็บข้อมูล ${MAX_READINGS} ครั้ง ทุก ${READING_INTERVAL / 1000} วินาที${testMode ? " (บันทึกทันทีทุกครั้ง)" : ""}`,
      );

      try {
        // ⚠️ ENHANCED: ใช้ readGPSMultiple จาก utils
        gpsCancelToken = {};
        const readings = await utils.readGPSMultiple(
          MAX_READINGS,
          READING_INTERVAL,
          TIMEOUT,
          (progress) => {
            // ตรวจสอบว่ายังอยู่ในกระบวนการ sampling หรือไม่ (ป้องกันกรณีถูก cancel/retry ระหว่างทาง)
            if (!samplingInProgress.value) return;

            readingCount.value = progress.count;
            updateCurrentPosition(progress.lat, progress.lng, progress.accuracy);
            
            setStatus(
              "loading",
              `กำลังเก็บข้อมูล GPS${testMode ? " [TEST]" : ""} (${progress.count}/${MAX_READINGS})...`,
              `ล่าสุด: ละติจูด ${progress.lat.toFixed(6)}, ลองจิจูด ${progress.lng.toFixed(6)}, ความแม่นยำ ${progress.accuracy.toFixed(1)} เมตร`,
            );
          },
          gpsCancelToken,
        );
        gpsCancelToken = null; // 🟢 Polling จบแล้ว (สำเร็จ) ไม่ต้องเก็บ token ไว้อีก

        // ถ้า sampling ถูกยกเลิกไปแล้ว (เช่น กดลองใหม่) ไม่ต้องทำต่อ
        if (!samplingInProgress.value) return;

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

              // ⚠️ BUGFIX: มั่นใจว่า samplingInProgress เป็น false ก่อน redirect
              samplingInProgress.value = false;

              setTimeout(() => {
                window.location.href = "../processing.html";
              }, 1000);
            } else {
              samplingInProgress.value = false;
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
        gpsCancelToken = null;
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
      bootGeneration.value++; // 🟢 เริ่มรอบใหม่ — บล็อกผลลัพธ์/Error ของ Request รอบเก่าที่อาจค้างอยู่
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

        // 🟢 ถ้าเป็น LINE In-App Browser: รีบเชื่อมต่อ LIFF แล้วบังคับเปิด Browser ภายนอกทันที
        // โดยยังไม่ต้องรอเช็ค Internet/โหลด Config ก่อน (ย้ายไปเช็คหลังเปิด Browser นอกแล้วแทน)
        // เพื่อให้ผู้ใช้เด้งออกจาก LINE ไป Chrome/Safari ได้เร็วที่สุดทันทีที่สแกน QR
        const browserInfo = utils.detectBrowserType();
        if (browserInfo.isLineApp) {
          await initLiff();
          if (externalOpenTriggered.value) {
            return; // กำลังเปลี่ยนไปเปิดหน้านี้ใน Browser นอกแล้ว ไม่ต้องทำอย่างอื่นต่อในหน้านี้
          }
          // liff.init ไม่สำเร็จ หรือไม่เข้าเงื่อนไขบังคับเปิด Browser นอก (เช่น เกิด Error) ให้ทำงานต่อตาม Flow ปกติด้านล่าง
        }

        // ⚠️ ENHANCED: ตรวจสอบ Internet
        const internetOk = await checkInternet();
        if (!internetOk) {
          return;
        }

        // โหลด Config และ Init LIFF พร้อมกัน (initLiff จะรู้เองว่าทำไปแล้วรอบหนึ่งหรือยังผ่าน bootGeneration/liffReady)
        await Promise.all([
          loadConfig(),
          browserInfo.isLineApp && liffReady.value ? Promise.resolve() : initLiff(),
        ]);
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

    // 🟢 ป้องกัน Timer/Polling ค้างเบื้องหลังเมื่อออกจากหน้า (เหมือนระบบต้นแบบ farmchokchai_checkin)
    onUnmounted(() => {
      stopGPSSampling();
      closeTimeoutDialog();
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
