const { createApp, computed, onMounted, ref, nextTick, watch } = Vue;
const common = window.CheckinCommon;
// ⚠️ UPDATE: เพิ่มจาก 12 วิ เป็น 20 วิ — เดิมเจอเคสจริงบนมือถือสัญญาณ 4G อ่อนๆ ที่ liff.init() ใช้เวลา
// เกิน 12 วิเล็กน้อยแล้วโดน timeout ตัดจบก่อน ทั้งที่ถ้ารออีกไม่กี่วิก็เชื่อมต่อสำเร็จได้ปกติ (เชื่อมกับ
// การแก้ common.getAreas() ที่เพิ่ม retry อัตโนมัติ ทำให้ฝั่งโหลดพื้นที่ก็ใช้เวลารวมได้ถึง ~30 วิเช่นกัน
// ในเคสเน็ตแย่สุด — ปรับให้ทั้งสองฝั่งมีเวลาที่ใกล้เคียงกัน ไม่ให้ฝั่งใดฝั่งหนึ่ง timeout ก่อนอีกฝั่งโดยไม่จำเป็น)
const LIFF_INIT_TIMEOUT_MS = 20000;
const PENDING_FLOW_KEY = "pending_checkin_flow";
// ⚠️ BUGFIX (เลือกพื้นที่ที่ 2 แต่พอ redirect ไป LINE Login กลับมาแล้วกลายเป็นพื้นที่แรก — เกิดเฉพาะบางเครื่อง):
// เดิมโค้ดอ่าน areaId จาก query string ของ URL ปัจจุบันเท่านั้น ปัญหาคือระหว่างที่ liff.login()
// พาไปหน้า LINE Login แล้ว redirect กลับมา บางเบราว์เซอร์/เคส LIFF จะไม่คืนค่า query string
// (areaId=...) กลับมาครบตามที่ส่งไปเป๊ะๆ ทำให้พอกลับมาถึงหน้าเว็บ areaId ว่างเปล่า แล้วโค้ดฝั่ง
// common.getArea("") จะ fallback ไปใช้ "พื้นที่แรกสุดในชีต" แทนพื้นที่ที่ user เลือกไว้จริง (พื้นที่ 2)
// รอบแรกที่แก้ใช้ sessionStorage จำค่าไว้ ซึ่งช่วยได้ในเบราว์เซอร์ส่วนใหญ่ แต่ "บางเครื่อง" (เช่น
// LINE เปิดหน้า LINE Login ในอีก tab/webview instance หนึ่งที่แยกจาก tab เดิม หรือโหมดที่เบราว์เซอร์
// ล้าง session ระหว่าง redirect ข้าม origin) sessionStorage จะเป็นคนละก้อนกับ tab เดิม อ่านค่าที่จำไว้
// ไม่เจอ ทำให้ยังหลุดไปพื้นที่แรกอยู่ดี — เปลี่ยนไปใช้ localStorage แทน เพราะ localStorage ใช้ร่วมกัน
// ได้ทุก tab/webview ของ origin เดียวกัน (ไม่ผูกกับ tab ที่เปิดตอนแรก) พร้อมประทับเวลาไว้ด้วย เพื่อไม่ให้
// ค่าเก่าจากการสแกนพื้นที่อื่นเมื่อนานมาแล้ว (เช่น เมื่อวาน) ค้างมาปนกับรอบสแกนใหม่โดยไม่ตั้งใจ
const AREA_ID_STORAGE_KEY = "checkin_pending_area_id";
const AREA_ID_STORAGE_TTL_MS = 10 * 60 * 1000; // ใช้ค่าที่จำไว้ได้ไม่เกิน 10 นาที
// ⚠️ UPDATE (แก้ปัญหา iPhone offset 30-40m / GPS drift / False Negative):
// เดิมใช้จำนวนตัวอย่างคงที่ (คงที่ 5 ครั้ง) แล้วเลือก "ค่าเดียวที่ accuracy ดีที่สุดในกลุ่มก้อนใหญ่สุด"
// มาใช้ตัดสินใจตรงๆ ปัญหาคือ accuracy ที่ iOS Safari รายงาน ไม่ได้แปลว่าตำแหน่งถูกต้องเสมอไป — iOS มักให้
// fix แรกๆ จาก WiFi Positioning ซึ่ง "ดูแม่น" (accuracy 15-20m) แต่ตัวตำแหน่งจริงเพี้ยนไปได้ 30-40m
// เปลี่ยนเป็นสุ่มตัวอย่างแบบ Adaptive (ขั้นต่ำ/สูงสุด + เช็คความนิ่ง) แล้วรวมค่าด้วย Weighted Average
// แทนการเลือกค่าเดียว ดูรายละเอียดที่ selectBestGPS() และ startGPSSampling() ด้านล่าง
// ⚠️ UPDATE (เปลี่ยนตามคำขอ: เช็คทุก 1 วิ 10 ครั้งตายตัว แทน Adaptive Sampling เดิม):
// เดิมเก็บอย่างน้อย MIN_GPS_READINGS (5) ครั้งแล้วเช็คความนิ่งก่อนตัดสินใจหยุด/เก็บต่อจนถึง MAX (10)
// ครั้ง ห่างกันครั้งละ 2 วิ ตอนนี้เปลี่ยนเป็นค่าคงที่ตายตัว: เก็บให้ครบ 10 ครั้งเสมอ ห่างกันครั้งละ 1 วิ
// (ตั้ง MIN = MAX = 10 ทำให้เงื่อนไข "ครบ MAX" ที่ทำงานอยู่แล้วเป็นตัวสั่งจบเสมอ ไม่ต้องพึ่งเช็คความนิ่งอีก)
const MIN_GPS_READINGS = 10; // เก็บให้ครบเท่านี้เสมอก่อนตัดสินใจ (เท่ากับ MAX = ไม่มีการหยุดก่อนกำหนด)
const MAX_GPS_READINGS = 10; // เพดานสูงสุด — ตอนนี้เท่ากับ MIN คือเก็บ 10 ครั้งตายตัวทุกครั้ง
// เก็บระยะเวลาขั้นต่ำระหว่างการ "รับ" ค่าพิกัดแต่ละครั้ง (ดูรายละเอียดที่ startGPSSampling ด้านล่าง)
const READING_INTERVAL_MS = 1000;
// ค่า accuracy ที่แย่กว่านี้ถือว่า "ยังใช้ตัดสินใจไม่ได้" (มักเป็น WiFi/Cell fix หยาบๆ ตอนเริ่มค้นหาสัญญาณ)
// ไม่นับรวมในชุดตัวอย่างที่ใช้ตัดสินใจ แต่ยังอัปเดตแผนที่/ตัวเลขสดให้ user เห็นความเคลื่อนไหวตามปกติ
const USABLE_ACCURACY_CEILING_M = 50;
// ถ้า weighted-average เคลื่อนที่ไม่เกินนี้ใน 3 ค่าที่ใช้ได้ล่าสุด ถือว่า "นิ่งแล้ว" หยุดเก็บได้ก่อนถึง MAX
// (ปัจจุบัน MIN = MAX = 10 อยู่แล้ว เงื่อนไขนี้จึงไม่มีผลอะไรอีกต่อไป แต่คงไว้เผื่ออนาคตอยากกลับไปใช้ Adaptive)
const STABLE_MOVEMENT_M = 5;
// เพดานเวลารวมทั้งหมดของการเก็บตัวอย่าง กันไม่ให้ user รอไม่มีที่สิ้นสุดในเคสสัญญาณแย่มากๆ
// ปรับลดลงจาก 26 วิ เหลือ 15 วิ ให้สอดคล้องกับเวลาที่คาดไว้จริง (10 ครั้ง x 1 วิ ≈ 10 วิ + สำรองไว้อีกนิด)
const SAMPLING_TIME_BUDGET_MS = 15000;
// รัศมีขั้นต่ำสำหรับตัดค่าผิดปกติ (outlier) ออกก่อนคำนวณ weighted average — ถ้า accuracy ที่ดีที่สุดในชุด
// แคบกว่านี้มาก ใช้ 1.5 เท่าของ accuracy ที่ดีที่สุดแทน เพื่อไม่ตัดค่าที่ยังสมเหตุสมผลออกไปด้วย
const CLUSTER_INLIER_RADIUS_M = 15;

function rememberAreaId(id) {
  try {
    localStorage.setItem(AREA_ID_STORAGE_KEY, JSON.stringify({ id, ts: Date.now() }));
  } catch (e) { /* เบราว์เซอร์บางตัวอาจปิด storage ไว้ ไม่เป็นไร */ }
}

function recallAreaId() {
  try {
    const raw = localStorage.getItem(AREA_ID_STORAGE_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    const id = String(parsed?.id || "").trim();
    if (!id) return "";
    if (Date.now() - Number(parsed?.ts || 0) > AREA_ID_STORAGE_TTL_MS) return ""; // ค่าเก่าเกินไป ไม่ใช้
    return id;
  } catch (e) {
    return "";
  }
}

function forgetAreaId() {
  try { localStorage.removeItem(AREA_ID_STORAGE_KEY); } catch (e) { /* no-op */ }
}

function resolveAreaId(query) {
  const fromUrl = String(query.get("areaId") || query.get("qr_code") || query.get("site") || "").trim();
  if (fromUrl) {
    rememberAreaId(fromUrl);
    return fromUrl;
  }
  const remembered = recallAreaId();
  if (remembered) {
    console.warn("[UserCheckin] areaId หายไปจาก URL (น่าจะระหว่าง redirect LINE Login) — ใช้ค่าที่จำไว้ก่อนหน้าแทน:", remembered);
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
  // การันตีว่า areaId ติดไปกับ URL ที่ขอให้ LINE Login redirect กลับมาเสมอ ป้องกันกรณี URL ปัจจุบัน
  // ทำ areaId หายไปแล้วตั้งแต่ก่อนเรียกฟังก์ชันนี้ (เช่น โดน strip ไปจากสาเหตุอื่น)
  if (areaId) url.searchParams.set("areaId", areaId);
  url.hash = "";
  return url.toString();
}

function withTimeout(promise, ms, message) {
  let timerId = null;
  const timeout = new Promise((_, reject) => {
    timerId = setTimeout(
      () => reject(new Error(message || "หมดเวลาการร้องขอ")),
      ms,
    );
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timerId) clearTimeout(timerId);
  });
}

// ⚠️ ใหม่ (แก้บั๊ก "ล็อกอิน LINE ครั้งแรกแล้วโปรไฟล์ไม่โหลด ต้องสแกน QR ใหม่"):
// ตัดพารามิเตอร์ของ LINE OAuth callback (code/state/liff.state) ออกจาก URL ปัจจุบันแบบ in-place
// (ใช้ history.replaceState ไม่ reload) เพื่อไม่ให้ liff.init() รอบถัดไปพยายามแลก authorization
// code เดิมซ้ำ — code เป็น one-time-use เสมอ ถ้าแลกซ้ำจะได้ error กลับมาแน่นอน (เช่น invalid_grant)
// ทำให้ initLiff() ตกไปที่ error/recovery path วนซ้ำแทนที่จะล็อกอินสำเร็จ ไม่ตัด areaId/site/session
// ออก เพราะยังต้องใช้ต่อ (และมี localStorage ผ่าน recallAreaId() สำรองไว้อยู่แล้วเผื่อหลุดหาย)
function stripLineCallbackParamsFromUrl() {
  try {
    const url = new URL(window.location.href);
    let changed = false;
    ["code", "state", "liff.state"].forEach((key) => {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    });
    if (changed) {
      window.history.replaceState({}, document.title, url.toString());
    }
  } catch (e) {
    /* กันเบราว์เซอร์เก่าที่ URL/history API บางส่วนอาจใช้งานไม่ได้ ไม่ critical ถ้าล้มเหลว */
  }
}

function hasLineCallbackParamsInUrl() {
  try {
    const url = new URL(window.location.href);
    return ["code", "state", "liff.state"].some((k) => url.searchParams.has(k));
  } catch (e) {
    return false;
  }
}

// ⚠️ FIX (Restore Session อัตโนมัติ): เดิม reload หน้าเดิมทันทีทุกครั้งที่ pageshow มาจาก bfcache
// (event.persisted) โดยไม่เช็คอะไรก่อน — ปัญหาคือตอนผู้ใช้เพิ่งถูก LINE redirect กลับมาจากหน้ายินยอม
// สิทธิ์ (โดยเฉพาะครั้งแรกที่ยังไม่เคย authorize LIFF นี้มาก่อน ซึ่งมีขั้นตอนเยอะกว่าปกติ) เบราว์เซอร์
// มือถือบางตัวจะยิง pageshow(persisted:true) ซ้อนเข้ามาขณะที่ initLiff()/liff.init() กำลังประมวลผล
// authorization code (ใช้ได้ครั้งเดียว) อยู่พอดี การ reload ทันทีตรงนี้จะไปแข่งกับกระบวนการแลก code
// ที่ยังไม่เสร็จ พอ reload รอบใหม่มาเจอ code เดิมที่ (อาจ) ถูกใช้ไปแล้ว/กำลังถูกใช้อยู่ ทำให้แลกไม่สำเร็จ
// โหลด Profile ไม่ได้ กลับมาหน้าเดิมเฉยๆ โดยไม่มีอะไรเกิดขึ้น ผู้ใช้จึงต้องออกไปสแกน QR ใหม่ (ได้ areaId/
// URL ใหม่ ไม่ใช่แก้ที่ต้นเหตุจริงๆ) — แก้โดยข้าม reload นี้ไปถ้า URL ยังมีพารามิเตอร์ callback ของ LINE
// ค้างอยู่ (ปล่อยให้ initLiff() ที่กำลังทำงานอยู่ในหน้านี้จัดการแลก code ให้เสร็จตามปกติแทน)
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  if (hasLineCallbackParamsInUrl()) return;
  window.location.reload();
});

createApp({
  setup() {
    const config = ref({ ...common.DEFAULT_CONFIG });
    const loading = ref(false);
    const profile = ref(null);
    const liffReady = ref(false);
    const authState = ref("checking");

    const statusType = ref("idle");
    const message = ref("พร้อมใช้งาน");
    const subMessage = ref("กำลังโหลด...");

    // FIX: samplingInProgress ต้องถูก declare เป็น ref() ก่อนใช้งานใน computed และ template
    // ปัญหาเดิม: ตัวแปรนี้ถูกใช้ใน dynamicButtonText computed และ :disabled binding
    // แต่ไม่ได้ declare เป็น reactive ref() ทำให้ Vue ไม่ track การเปลี่ยนแปลง
    // ส่งผลให้ปุ่มยังคง disabled อยู่แม้ว่าจะ login สำเร็จแล้ว
    const samplingInProgress = ref(false);

    const query = new URLSearchParams(location.search);
    const areaId = resolveAreaId(query);
    const session = query.get("session") || "-";
    // โหมดทดสอบสัญญาณ GPS: เปิดใช้งานด้วย query param ?mode=test (สร้างลิงก์/QR ได้จากหน้า qr_code.html)
    // เมื่อเปิดโหมดนี้ ทุกครั้งที่กดเช็คอินจะถูกบันทึกลงชีต "Test" เสมอ ไม่ว่าจะอยู่ในกรอบพื้นที่หรือไม่
    // (ดูรายละเอียดที่ sendTestReading() ด้านล่าง) ใช้สำหรับเก็บข้อมูลดิบไปวิเคราะห์ความแม่นยำ GPS จริงในสนาม
    const testMode = ref(String(query.get("mode") || "").trim().toLowerCase() === "test");
    const testResult = ref(null); // ผลลัพธ์ล่าสุดของการทดสอบ (ไว้โชว์ในหน้า UI)
    // ⚠️ FIX (โหมดทดสอบต้องบันทึกทันทีทีละค่า ไม่ใช่บันทึกครั้งเดียวตอนจบด้วยค่าเฉลี่ย):
    // ตัวนับจำนวนครั้งที่บันทึกลงชีต "Test" สำเร็จ/ล้มเหลว ระหว่างที่กำลังเก็บตัวอย่าง GPS ทั้ง 10 ค่า
    // ดูรายละเอียดที่ sendTestReading() และ finishTestMode() ด้านล่าง (รูปแบบเดียวกับ gpstest.js)
    const testSavedCount = ref(0);
    const testFailedCount = ref(0);
    const testLastError = ref("");
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

    // GPS sampling state
    let gpsReadings = [];
    let watchId = null;
    let samplingStartTime = null;
    // ⚠️ FIX: ต้องประกาศไว้ scope นอกสุดเดียวกับ gpsReadings (ไม่ใช่ local ใน startGPSSampling())
    // เพราะ finishTestMode() ซึ่งเป็นฟังก์ชันแยกอยู่คนละ scope ต้องอ่านค่านี้ได้ด้วยตอน await ผลลัพธ์
    // การบันทึกที่ยังค้างอยู่ทั้งหมดก่อนสรุปผล (ดู sendTestReading()/finishTestMode() ด้านล่าง)
    let testSendPromises = [];

    // Map elements
    let map = null;
    let boundaryRect = null;
    let centerMarker = null;
    let currentMarker = null;
    let currentCircle = null;

    // FIX: แปลข้อความปุ่มเป็นภาษาไทยทั้งหมด และเพิ่ม state "checking"
    const dynamicButtonText = computed(() => {
      if (authState.value === "checking") return "กำลังตรวจสอบ...";
      if (authState.value === "error") return "⟳ ลองเชื่อมต่อใหม่";
      if (authState.value === "logged_out") return "กำลังเปลี่ยนเส้นทางไปยัง LINE Login...";
      if (samplingInProgress.value) return `กำลังเก็บข้อมูล GPS... (${readingCount.value}/${MAX_GPS_READINGS})`;
      if (loading.value) return "กำลังบันทึกข้อมูล...";
      return testMode.value ? "🧪 ทดสอบสัญญาณ GPS" : "เช็คอิน";
    });

    function setStatus(type, main, sub) {
      statusType.value = type;
      message.value = main;
      subMessage.value = sub || "";
    }

    async function loadConfig() {
      try {
        const area = await common.getArea(areaId, 15000);

        // ⚠️ BUGFIX (check-in ไม่ผ่านทั้งที่อยู่ในพื้นที่จริง):
        // เดิมถ้า areaId ที่ QR ส่งมาหาไม่เจอในชีต (เช่น พื้นที่ถูกลบ/สร้างรหัสใหม่แล้ว QR เก่ายังไม่ได้พิมพ์ใหม่
        // หรือแคชพื้นที่บนเครื่อง user ยังไม่อัปเดต) common.getArea() จะเงียบๆ ใช้พื้นที่แรกในลิสต์แทน (areas[0])
        // ซึ่งอาจเป็นพื้นที่คนละจุดกับที่ user ยืนอยู่จริง ทำให้เช็คระยะทาง/รัศมีผิดพื้นที่โดยไม่มีใครรู้
        // แก้โดย: ถ้า QR ระบุ areaId มาชัดเจน แต่พื้นที่ที่โหลดกลับมาไม่ตรงกับ areaId นั้น ให้ถือว่าโหลดไม่สำเร็จ
        // แล้วแจ้ง error ให้ user สแกน QR ใหม่ / แจ้งแอดมิน แทนที่จะปล่อยให้เช็คอินกับพิกัดผิดพื้นที่
        //
        // ⚠️ UPDATE เพิ่มเติม: จุดนี้เคยขึ้นข้อความ "ไม่พบพื้นที่ตามรหัส QR ในระบบ" ทั้งที่พื้นที่มีอยู่จริง —
        // สาเหตุคือตอนเน็ตมีปัญหา (เช่น มือถือ 4G สัญญาณอ่อน/Apps Script cold-start ตอบช้า) common.getAreas()
        // เวอร์ชันเดิมจะคืนลิสต์ว่างเงียบๆ แทนที่จะ throw error ทำให้โค้ดตรงนี้เข้าใจผิดว่า "โหลดสำเร็จแต่หา
        // พื้นที่ไม่เจอ" (แก้ที่ต้นตอแล้วใน common.js ให้ getAreas() throw error จริงเมื่อโหลดไม่สำเร็จและไม่มี
        // แคช) แต่เพื่อกันไม่ให้เกิดข้อความเข้าใจผิดแบบนี้ซ้ำอีกในอนาคต (เผื่อกรณีอื่นๆ ที่ยังทำให้ list ว่างได้)
        // เพิ่มการเช็คตรงนี้ไว้อีกชั้น: ถ้า common.getArea() คืนพื้นที่ที่ areaId เป็นค่าว่าง (นั่นคือ
        // DEFAULT_AREA ตัวอย่างที่ฝังในโค้ด ไม่ใช่พื้นที่จริงจากชีตเลย) ให้ถือว่าเป็น "โหลดข้อมูลไม่สำเร็จ"
        // (ปัญหาเครือข่าย) ไม่ใช่ "ไม่พบพื้นที่ในระบบ" (ปัญหาการตั้งค่า) เพราะสองเคสนี้ user ต้องแก้ต่างกัน
        // คนละทาง (เคสแรก: ลองใหม่ตอนสัญญาณดีขึ้น / เคสหลัง: ต้องแจ้งแอดมินให้ตรวจสอบ SetArea จริงๆ)
        if (!String(area?.areaId || "").trim()) {
          const err = new Error(
            "โหลดข้อมูลพื้นที่จากเซิร์ฟเวอร์ไม่สำเร็จ (อาจเป็นเพราะสัญญาณอินเทอร์เน็ตไม่เสถียร) กรุณาตรวจสอบสัญญาณแล้วลองใหม่อีกครั้ง",
          );
          err.isNetworkIssue = true;
          throw err;
        }

        if (areaId && String(area.areaId).trim() !== String(areaId).trim()) {
          throw new Error(
            `ไม่พบพื้นที่ตามรหัส QR (${areaId}) ในระบบ กรุณาสแกน QR ใหม่ หรือแจ้งผู้ดูแลระบบให้ตรวจสอบหน้า SetArea`,
          );
        }

        config.value = common.normalizeConfig(area);
        maxAccuracy.value = Number(config.value.maxAccuracy || 30);
        forgetAreaId(); // โหลด/ตรวจสอบพื้นที่สำเร็จแล้ว เลิกจำค่านี้ไว้ ป้องกันไม่ให้ไปปนกับรอบสแกนถัดไป

        // Debug log: ค่าพื้นที่/รัศมีที่โหลดมาใช้เช็คอินจริง (lat, lng, ขอบเขตแต่ละทิศ, maxAccuracy)
        console.log("[UserCheckin] loadConfig: โหลดพื้นที่สำเร็จ", {
          requestedAreaId: areaId || "(ไม่ระบุ ใช้พื้นที่แรก)",
          resolvedAreaId: config.value.areaId,
          areaName: config.value.areaName,
          centerLat: config.value.centerLat,
          centerLng: config.value.centerLng,
          northMeters: config.value.northMeters,
          southMeters: config.value.southMeters,
          eastMeters: config.value.eastMeters,
          westMeters: config.value.westMeters,
          maxAccuracy: maxAccuracy.value,
        });
      } catch (err) {
        console.error(err);
        setStatus(
          "error",
          err?.isNetworkIssue ? "เครือข่ายมีปัญหา" : "โหลดการตั้งค่าไม่สำเร็จ",
          err?.message || "กรุณาตรวจสอบการเชื่อมต่อกับ Google Sheet/Apps Script",
        );
      }
    }

    // ⚠️ ใหม่ (แก้บั๊ก "ล็อกอิน LINE ครั้งแรกแล้วโปรไฟล์ไม่โหลด"): ดึงโปรไฟล์พร้อม retry สั้นๆ กันเคส
    // liff.getProfile() ล้มเหลวชั่วคราว (เช่น เน็ตสะดุดจังหวะพอดีหลัง redirect กลับมา) ไม่ให้ profile
    // ค้างเป็น null ถาวรโดยไม่มีการลองใหม่ ซึ่งเดิมจะทำให้ authState เป็น "logged_in" (เพราะ set ไว้ก่อน
    // await getProfile() แล้ว) ทั้งที่ profile.value ยังไม่มีจริง เปิดให้กดเช็คอินได้ทั้งที่ยังไม่มีชื่อ/
    // userId ไปแนบกับข้อมูลที่จะบันทึก
    async function loadProfileWithRetry(retries = 2, delayMs = 800) {
      let lastErr = null;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const p = await liff.getProfile();
          if (p && p.userId) return p;
          lastErr = new Error("ไม่พบข้อมูลโปรไฟล์ LINE");
        } catch (err) {
          lastErr = err;
        }
        if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      throw lastErr || new Error("โหลดโปรไฟล์ LINE ไม่สำเร็จ");
    }

    // ⚠️ FIX (Root cause: "The access token revoked" ทำให้โปรไฟล์ไม่โหลด ต้องปิด Browser สแกน QR ใหม่):
    // เดิมโค้ดดักจับ error message ที่บ่งบอกว่า Access Token มีปัญหา (revoked/invalid/expired) แค่จุด
    // เดียวคือใน catch ของ initLiff() เอง (ครอบคลุมเฉพาะกรณี liff.init() ตัวเอง throw error ตรงๆ) แต่
    // "The access token revoked" ตัวจริงมักไม่ได้เกิดตอน liff.init() — มันเกิดตอนเรียก liff.getProfile()
    // ต่างหาก (ในฟังก์ชัน loadProfileWithRetry() ด้านบน) คือ liff.init() ผ่านแล้ว liff.isLoggedIn() คืน
    // true ด้วยซ้ำ (LIFF SDK เช็คแค่ว่ามี token เก็บไว้ในเครื่อง ไม่ได้ยืนยันกับเซิร์ฟเวอร์ LINE ว่า token
    // นั้นยังใช้ได้จริง) แต่พอเอา token นั้นไปเรียก API จริง (getProfile) เซิร์ฟเวอร์ LINE ปฏิเสธเพราะ token
    // ถูกเพิกถอนไปแล้ว (พบบ่อยบน Android ที่ระบบจัดการ WebView/Custom Tab อาจสร้าง session ซ้อนกันได้
    // ระหว่างขั้นตอนขอสิทธิ์ครั้งแรก) เดิม error นี้ถูกจับแค่ใน try/catch เฉพาะจุดของ loadProfileWithRetry()
    // (ในเงื่อนไข if (liff.isLoggedIn())) ซึ่งแค่โชว์ข้อความ error เฉยๆ ไม่ได้ล้าง session/login ใหม่ให้
    // ผู้ใช้กดปุ่ม "ลองเชื่อมต่อใหม่" (retryInit ก็แค่เรียก initLiff() ซ้ำ) แต่ liff.isLoggedIn() ฝั่ง client
    // ยังคืน true เหมือนเดิม (token เสียแค่ฝั่งเซิร์ฟเวอร์ ไม่ได้ถูกลบออกจากเครื่อง) จึงวนเข้า getProfile()
    // แล้วพังซ้ำด้วย error เดิมไปเรื่อยๆ — ทางเดียวที่ผู้ใช้เจอว่าใช้งานได้จริงคือปิด Browser แล้วสแกน QR
    // ใหม่ (ได้ LIFF session ใหม่ล้วนๆ) ซึ่งไม่ควรจำเป็นเลย
    //
    // แก้โดยดึงตรรกะ "ตรวจจับ + กู้คืน" ออกมาเป็นฟังก์ชันกลาง 2 ตัว แล้วเรียกใช้จากทั้ง 2 จุดที่ error นี้
    // อาจเกิดขึ้นได้จริง (catch ของ liff.init() เดิม และ catch ของ loadProfileWithRetry() ที่เพิ่งแก้ใหม่)
    // เพิ่มตัวนับจำนวนครั้งที่ auto-recover ไปแล้วด้วย (เก็บใน sessionStorage) กันกรณี token เสียถาวรจริงๆ
    // (ไม่ใช่ปัญหาชั่วคราว) ทำให้หน้าเว็บ reload วนไม่รู้จบ — ถ้าเกินจำนวนครั้งที่กำหนด จะเลิกลองอัตโนมัติ
    // แล้วโชว์ error พร้อมปุ่ม "ลองเชื่อมต่อใหม่" ให้ผู้ใช้กดเองแทน (ยังไม่ต้องสแกน QR ใหม่อยู่ดี)
    const TOKEN_RECOVERY_ATTEMPT_KEY = "liff_token_recovery_attempts";
    const MAX_TOKEN_RECOVERY_ATTEMPTS = 2;

    function isTokenErrorMessage(message) {
      const m = String(message || "").toLowerCase();
      return m.includes("revoked") || m.includes("invalid") || m.includes("expired");
    }

    function clearLiffTokenCache() {
      // เคลียร์แคชหลักของ LIFF
      if (window.liff && window.liff.logout) {
        try { window.liff.logout(); } catch (e) { /* ignore */ }
      }
      // เคลียร์ข้อมูล LocalStorage ที่เกี่ยวข้อง
      localStorage.removeItem('pk_token');
      localStorage.removeItem('token');
      localStorage.removeItem('user_id');
      localStorage.removeItem('user_profile');
    }

    function recoverFromInvalidToken(err, context) {
      console.warn(
        `[UserCheckin] ${context}: ตรวจพบ Access Token มีปัญหา กำลังเคลียร์แคชและลองล็อกอินใหม่...`,
        err,
      );

      let attempts = 0;
      try { attempts = Number(sessionStorage.getItem(TOKEN_RECOVERY_ATTEMPT_KEY) || 0); } catch (e) { /* ignore */ }

      if (attempts >= MAX_TOKEN_RECOVERY_ATTEMPTS) {
        // กันวนซ้ำไม่จบ: ลองอัตโนมัติไปครบจำนวนที่กำหนดแล้วแต่ยังไม่หาย น่าจะไม่ใช่ปัญหาชั่วคราวอีกต่อไป
        // หยุดลองอัตโนมัติ ให้ผู้ใช้กดปุ่ม "ลองเชื่อมต่อใหม่" เองแทน (ยังไม่ต้องสแกน QR ใหม่)
        authState.value = "error";
        setStatus(
          "error",
          "เข้าสู่ระบบ LINE ไม่สำเร็จ",
          "กรุณากดปุ่มด้านล่างเพื่อลองเชื่อมต่อใหม่อีกครั้ง หากยังไม่สำเร็จ กรุณาปิดหน้านี้แล้วสแกน QR ใหม่",
        );
        return;
      }

      try { sessionStorage.setItem(TOKEN_RECOVERY_ATTEMPT_KEY, String(attempts + 1)); } catch (e) { /* ignore */ }

      clearLiffTokenCache();

      // ⚠️ FIX (Restore Session อัตโนมัติ / ไม่ต้องสแกน QR ใหม่): เดิม reload หน้าเดิมตรงๆ ทั้งที่
      // URL ยังมี code/state/liff.state ของ LINE ค้างอยู่ (authorization code ใช้ได้ครั้งเดียว)
      // ทำให้รอบถัดไป liff.init() พยายามแลก code เดิมซ้ำ พังซ้ำด้วยเหตุผลเดิมวนไปเรื่อยๆ (ผู้ใช้
      // เห็นเป็นอาการ "กลับมาหน้าเดิมแต่ไม่โหลด Profile") แก้โดยตัด code/state/liff.state ออกจาก
      // URL ก่อน reload เพื่อให้รอบถัดไป liff.init() เห็นว่า "ยังไม่ได้ล็อกอิน" (สะอาด ไม่มี code
      // ค้าง) แล้วเรียก liff.login() ขอ code ใหม่ให้เองอัตโนมัติผ่านเงื่อนไข else ด้านล่าง โดยไม่ต้อง
      // ให้ผู้ใช้ไปสแกน QR ใหม่ (areaId ที่เคยได้จาก QR ยังอยู่ครบ เพราะ recallAreaId() ดึงจาก
      // localStorage กลับมาใช้ได้อยู่แล้วไม่ว่า query string จะเหลืออะไร)
      stripLineCallbackParamsFromUrl();
      window.location.reload();
    }

    async function initLiff() {
      try {
        if (!window.liff)
          throw new Error("ไม่พบ LIFF SDK");
        if (!common?.LIFF_ID)
          throw new Error("กรุณาตรวจสอบการตั้งค่า LIFF ID");

        await liff.init({
          liffId: common.LIFF_ID,
          withLoginOnExternalBrowser: false, // หรือ true ตามการตั้งค่าเดิมของคุณ
        });

        liffReady.value = true;

        if (liff.isLoggedIn()) {
          // ⚠️ FIX (โหลด Profile อัตโนมัติหลัง Login สำเร็จ / เปิดให้เช็คอินได้ก็ต่อเมื่อ Profile
          // โหลดเสร็จจริงแล้วเท่านั้น): เดิม set authState.value = "logged_in" ก่อนแล้วค่อย await
          // liff.getProfile() ทำให้มีช่วงเวลาสั้นๆ ที่ authState เป็น "logged_in" (ปุ่มเช็คอินกดได้แล้ว
          // ตาม :disabled ในหน้า checkin.html) แต่ profile.value ยังเป็น null อยู่ — ถ้าผู้ใช้กดเช็คอิน
          // พอดีจังหวะนั้น buildPayload() จะได้ displayName/userId ว่างเปล่าไปบันทึก ดูจากภายนอกเหมือน
          // "เช็คอินไม่ได้ ต้องสแกน QR ใหม่" ทั้งที่จริงๆ แค่ profile ยังโหลดไม่เสร็จ แก้โดยคง authState
          // เป็น "checking" (ปุ่มยัง disabled, ไม่แสดงแผนที่ ตาม v-if เดิมของหน้า) ไว้จนกว่าจะโหลด
          // Profile สำเร็จจริง แล้วค่อยเปลี่ยนเป็น "logged_in" ทีเดียว
          setStatus(
            "loading",
            "กำลังโหลดข้อมูลผู้ใช้ LINE...",
            "กรุณารอสักครู่ ระบบกำลังดึงข้อมูลโปรไฟล์ของคุณ",
          );
          try {
            profile.value = await loadProfileWithRetry();
          } catch (profileErr) {
            console.error("[UserCheckin] โหลด Profile ไม่สำเร็จ:", profileErr);

            // ⚠️ FIX (Root cause หลักของ "โปรไฟล์ไม่โหลด ต้องสแกน QR ใหม่" / "The access token revoked"):
            // liff.isLoggedIn() คืน true ได้ทั้งที่ token ใช้งานจริงไม่ได้แล้ว (ดูคำอธิบายเต็มที่
            // recoverFromInvalidToken() ด้านบน) — เดิมจุดนี้แค่โชว์ error เฉยๆ ทำให้ retryInit()/กดปุ่ม
            // ใหม่วนเข้ามาเจอ error เดิมซ้ำไม่จบ ต้องปิด Browser สแกน QR ใหม่เท่านั้นถึงจะใช้ได้ แก้โดย
            // เช็คว่า error message เข้าข่าย token มีปัญหาหรือไม่ ถ้าใช่ ให้เรียก recoverFromInvalidToken()
            // (ล้าง session + login ใหม่อัตโนมัติทันที ไม่ต้องรอผู้ใช้กดอะไร) แทนที่จะโชว์ error ค้างไว้
            if (isTokenErrorMessage(profileErr?.message)) {
              recoverFromInvalidToken(profileErr, "loadProfileWithRetry");
              return;
            }

            authState.value = "error";
            setStatus(
              "error",
              "โหลดข้อมูลผู้ใช้ LINE ไม่สำเร็จ",
              profileErr?.message || "กรุณาลองใหม่อีกครั้ง (กดปุ่มด้านล่าง)",
            );
            return;
          }
          // ล็อกอิน + โหลด Profile สำเร็จจริงแล้ว เคลียร์ตัวนับ auto-recover ทิ้ง ให้รอบถัดไป (ถ้ามี
          // ปัญหา token อีกในอนาคต) ได้โควตาลองใหม่เต็มจำนวนอีกครั้ง ไม่ถูกนับต่อจากรอบที่ผ่านมาแล้ว
          try { sessionStorage.removeItem(TOKEN_RECOVERY_ATTEMPT_KEY); } catch (e) { /* ignore */ }
          authState.value = "logged_in";
          setStatus("idle", "พร้อมเช็คอิน", "กดปุ่มด้านล่างเพื่อเริ่มเช็คอิน");
        } else {
          authState.value = "logged_out";
          setStatus(
            "idle",
            "กำลังเปลี่ยนเส้นทางไปยัง LINE Login...",
            "กรุณารอสักครู่ ระบบกำลังพาคุณไปยังหน้า LINE Authentication",
          );
          liff.login({ redirectUri: getReturnUrl(areaId) });
        }
      } catch (err) {
        console.error(err);

        // ⚠️ FIX: ดักจับกรณี Access Token มีปัญหา (เช่น หมดอายุ หรือถูกเพิกถอน) — ใช้ฟังก์ชันกลาง
        // เดียวกับที่ catch ของ loadProfileWithRetry() ด้านบนเรียกใช้ (ดูรายละเอียด root cause เต็มๆ
        // ที่คอมเมนต์ของ recoverFromInvalidToken() ด้านบนของฟังก์ชันนี้)
        if (isTokenErrorMessage(err?.message)) {
          recoverFromInvalidToken(err, "initLiff");
          return;
        }

        // หากเป็น Error อื่นๆ ให้แสดงผลตามปกติ
        authState.value = "error";
        setStatus(
          "error",
          "เกิดข้อผิดพลาดการเชื่อมต่อ LINE",
          err?.message || "ไม่สามารถเริ่มต้น LINE Authentication ได้",
        );
      }
    }

    function buildPayload(lat, lng, accuracy) {
      const pending = common.getPendingCheckin() || {};
      const decoded = liff.getDecodedIDToken
        ? liff.getDecodedIDToken()
        : {};
      const displayName = profile.value?.displayName || "";

      // BUGFIX (accuracy ไม่ถูกบันทึก): ต้องส่ง accuracy เป็นตัวเลขเสมอ (รวมถึงกรณี 0 ซึ่งเป็นค่าที่ถูกต้อง
      // ไม่ใช่ค่าว่าง) ห้ามใช้ `accuracy || 0` เพราะ 0 จะถูกมองเป็น falsy แล้วเปลี่ยนเป็นค่าอื่นโดยไม่ตั้งใจ
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

      // Debug log: payload สุดท้ายที่จะส่งไปบันทึก (lat, lng, accuracy ต้องไม่หายไประหว่างทาง)
      console.log("[UserCheckin] buildPayload:", {
        lat: payload.lat,
        lng: payload.lng,
        accuracy: payload.accuracy,
        maxAccuracy: payload.maxAccuracy,
        areaId: payload.areaId,
      });

      return payload;
    }

    // ⚠️ FIX (แก้ให้บันทึกลงชีต "Test" ทันทีทีละค่า ไม่ใช่บันทึกครั้งเดียวตอนจบด้วยค่าเฉลี่ย):
    // เดิมฟังก์ชันนี้ (เดิมชื่อ runTestLog) ถูกเรียกแค่ครั้งเดียวตอน finishSampling() ด้วยค่า "bestGPS"
    // (ค่าเฉลี่ยถ่วงน้ำหนักหลังตัด outlier ออกแล้ว) ทำให้ Google Sheet "Test" มีแค่ 1 แถวต่อการเช็คอิน
    // 1 ครั้งเท่านั้น ทั้งที่จุดประสงค์ของโหมดทดสอบสัญญาณคือเก็บค่าดิบทุกค่าที่ GPS อ่านได้จริง (10 ค่า/
    // ครั้ง ตามที่ระบุ) ไปวิเคราะห์ความแม่นยำ ไม่ใช่แค่ค่าเฉลี่ยสุดท้ายค่าเดียว
    //
    // แก้โดยแยกเป็น 2 ฟังก์ชัน (รูปแบบเดียวกับที่ใช้อยู่แล้วใน gpstest.js/gpstest.html):
    // 1) sendTestReading() — ยิงบันทึกทันทีทุกครั้งที่ดึงค่า GPS ได้ 1 ค่า (เรียกจาก watchPosition
    //    callback ใน startGPSSampling() ด้านล่าง แบบไม่ await/fire-and-forget เพื่อไม่ให้การรอผลบันทึก
    //    ไปหน่วงจังหวะการดึงตำแหน่งครั้งถัดไป ซึ่งต้องห่างกันตรงตาม READING_INTERVAL_MS (1 วินาที) เสมอ)
    //    บันทึกทุกค่าเสมอไม่ว่าจะอยู่ในกรอบพื้นที่ (geofence) หรือไม่ เพราะ common.addTestLog() ฝั่ง
    //    เซิร์ฟเวอร์ (saveTestLog() ใน Code.gs) ไม่ปฏิเสธค่านอกกรอบเหมือน addLog() ปกติอยู่แล้ว
    // 2) finishTestMode() — เรียกตอนเก็บครบ 10 ค่าแล้วเท่านั้น ทำหน้าที่แค่ "สรุปผล" ให้ user เห็น
    //    (จำนวนที่บันทึกสำเร็จ/ล้มเหลว) ไม่ยิงบันทึกซ้ำอีกครั้งด้วยค่าเฉลี่ย เพราะถ้ายิงซ้ำจะกลายเป็น
    //    11 แถวต่อการเช็คอิน 1 ครั้ง (10 ค่าดิบ + 1 ค่าเฉลี่ย) เกินจากที่ระบุไว้ว่าต้องมีข้อมูล "10 แถว
    //    ต่อการเช็คอิน 1 ครั้ง" พอดี
    async function sendTestReading(lat, lng, accuracy, index) {
      const payload = buildPayload(lat, lng, accuracy);
      payload.areaId = areaId;
      payload.status = common.isInsideBoundary(lat, lng, boundary.value)
        ? "inside_boundary"
        : "outside_boundary";
      payload.distantcenter = config.value?.centerLat
        ? calculateDistance(lat, lng, config.value.centerLat, config.value.centerLng)
        : null;
      // ลำดับที่ (1-10) ของค่านี้ในรอบทดสอบเดียวกัน ไว้อ้างอิง/debug เผื่อวิเคราะห์ย้อนหลังว่าค่าไหน
      // ดริฟท์ไปตอนไหนระหว่าง 10 วินาทีที่เก็บตัวอย่าง (ไม่กระทบ schema เดิมของชีต Test — ฝั่ง
      // เซิร์ฟเวอร์จะเก็บเฉพาะคอลัมน์ที่รู้จักตาม TEST_LOG_HEADERS เท่านั้น คีย์อื่นที่ส่งเกินมาจะถูกข้าม)
      payload.readingIndex = index;
      payload.totalReadings = MAX_GPS_READINGS;

      try {
        const res = await common.addTestLog(payload, 20000);
        if (res && res.ok === false) {
          throw new Error(res.err || res.error || res.message || "บันทึกข้อมูลทดสอบไม่สำเร็จ");
        }
        testSavedCount.value += 1;
      } catch (err) {
        console.error(
          `[UserCheckin] sendTestReading: บันทึกค่าที่ ${index}/${MAX_GPS_READINGS} ลงชีต Test ไม่สำเร็จ:`,
          err,
        );
        testFailedCount.value += 1;
        testLastError.value = err?.message || "บันทึกข้อมูลทดสอบไม่สำเร็จ";
      }
    }

    // โหมดทดสอบสัญญาณ GPS (?mode=test): เรียกหลังเก็บครบ 10 ค่าแล้ว (ทุกค่าถูกบันทึกลงชีต "Test" ไป
    // ทันทีทีละค่าแล้วผ่าน sendTestReading() ด้านบน) แค่สรุปผลให้ user เห็นในหน้าเดิม พร้อมให้กดทดสอบ
    // ซ้ำได้ทันที (ต่างจาก flow ปกติที่จะ redirect ไป processing.html แล้วบล็อกถ้าอยู่นอกกรอบ)
    async function finishTestMode(bestGPS, inside) {
      // รอให้ทุก request ที่ยังค้างอยู่ (บางค่าอาจยังส่งไม่เสร็จตอนที่เก็บครบ 10 ค่าพอดี) เสร็จก่อน
      // ให้ตัวเลขสรุปที่โชว์ผู้ใช้ถูกต้องครบตามจริง ไม่ใช่เลขที่ยังอัปเดตไม่ครบระหว่างทาง
      setStatus(
        "loading",
        "กำลังรอบันทึกข้อมูลทดสอบให้ครบ...",
        `บันทึกแล้ว ${testSavedCount.value}/${MAX_GPS_READINGS} ครั้ง กำลังรอที่เหลือ...`,
      );
      await Promise.allSettled(testSendPromises);

      testResult.value = {
        inside,
        distantcenter: currentDistance.value,
        savedCount: testSavedCount.value,
        failedCount: testFailedCount.value,
        totalReadings: MAX_GPS_READINGS,
        savedAt: new Date().toISOString(),
      };

      setStatus(
        testFailedCount.value === 0 ? "success" : "error",
        inside ? "✓ ทดสอบเสร็จสิ้น (อยู่ในกรอบ)" : "✓ ทดสอบเสร็จสิ้น (อยู่นอกกรอบ)",
        `บันทึกลงชีต "Test" สำเร็จ ${testSavedCount.value}/${MAX_GPS_READINGS} ครั้ง` +
          (testFailedCount.value > 0
            ? ` (ล้มเหลว ${testFailedCount.value} ครั้ง: ${testLastError.value})`
            : "") +
          ` — ระยะห่างจากจุดศูนย์กลางล่าสุด: ${currentDistance.value ? currentDistance.value.toFixed(1) : "?"} เมตร — กดปุ่มด้านล่างเพื่อทดสอบซ้ำได้ทันที`,
      );

      readingCount.value = 0; // เคลียร์ให้กดทดสอบซ้ำได้ทันที ไม่ต้อง reload หน้า
      testSavedCount.value = 0;
      testFailedCount.value = 0;
      testLastError.value = "";
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

    // ⚠️ UPDATE: Leaflet ไม่ได้ถูกโหลดไว้ล่วงหน้าจาก <head> อีกต่อไป (ย้ายออกจาก checkin.html เพื่อไม่ให้
    // บล็อกการเริ่ม liff.init() — ดูเหตุผลละเอียดในคอมเมนต์ที่ checkin.html) โหลด lazy ตรงนี้แทน เฉพาะตอนที่
    // จะสร้างแผนที่จริงๆ (initMap เรียกหลัง login สำเร็จเท่านั้น) แคช promise ไว้กันโหลดซ้ำถ้าเรียกหลายครั้ง
    let leafletLoadPromise = null;
    function ensureLeafletLoaded() {
      if (window.L) return Promise.resolve();
      if (leafletLoadPromise) return leafletLoadPromise;

      leafletLoadPromise = new Promise((resolve, reject) => {
        const cssHref = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        if (!document.querySelector(`link[href="${cssHref}"]`)) {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = cssHref;
          document.head.appendChild(link);
        }

        const jsSrc = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        const existingScript = document.querySelector(`script[src="${jsSrc}"]`);
        if (existingScript) {
          existingScript.addEventListener("load", () => resolve());
          existingScript.addEventListener("error", () =>
            reject(new Error("โหลดไลบรารีแผนที่ (Leaflet) ไม่สำเร็จ")),
          );
          return;
        }

        const script = document.createElement("script");
        script.src = jsSrc;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("โหลดไลบรารีแผนที่ (Leaflet) ไม่สำเร็จ"));
        document.head.appendChild(script);
      });

      return leafletLoadPromise;
    }

    async function initMap() {
      if (map || !mapEl.value) return;

      try {
        await ensureLeafletLoaded();
      } catch (err) {
        // แผนที่เป็นแค่ UI เสริมให้ดูตำแหน่งตัวเอง ไม่ใช่ส่วนที่ตัดสินใจเช็คอิน — ถ้าโหลดไม่สำเร็จ
        // (เช่นเน็ตหลุดจังหวะนั้นพอดี) ไม่ควรทำให้การเช็คอินหยุดทำงานไปด้วย แค่ไม่มีแผนที่ให้ดูเฉยๆ
        console.error("[UserCheckin] initMap: โหลด Leaflet ไม่สำเร็จ", err);
        return;
      }

      if (map || !mapEl.value || !window.L) return; // เผื่อสถานะเปลี่ยนไปแล้วระหว่างรอโหลด

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
      const R = 6371000;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLng = ((lng2 - lng1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }

    function updateCurrentPosition(lat, lng, accuracy) {
      currentLat.value = Number(lat);
      currentLng.value = Number(lng);
      currentAccuracy.value = Number(accuracy) || 0;

      // Calculate distance to geofence center
      if (config.value && config.value.centerLat) {
        currentDistance.value = calculateDistance(
          lat,
          lng,
          config.value.centerLat,
          config.value.centerLng,
        );
      }

      // Debug log: ค่าที่อ่านได้จาก GPS จริง ณ ขณะนี้ (lat, lng, accuracy) และระยะห่างจากจุดศูนย์กลางพื้นที่
      console.log("[UserCheckin] GPS reading:", {
        lat: currentLat.value,
        lng: currentLng.value,
        accuracy: currentAccuracy.value,
        distanceToCenterMeters: currentDistance.value,
        areaRadius: {
          north: config.value?.northMeters,
          south: config.value?.southMeters,
          east: config.value?.eastMeters,
          west: config.value?.westMeters,
        },
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

    // ⚠️ UPDATE: เดิม clusterReadings() จับกลุ่มโดยยึด "จุดแรกที่ยังไม่ถูกจับกลุ่ม" เป็นศูนย์กลาง (anchor)
    // แล้ววัดระยะจากทุกจุดไปยัง anchor นั้นจุดเดียว ถ้า anchor ดันเป็นตัวที่เพี้ยน (เช่น WiFi-offset ของ iOS)
    // กลุ่มที่ได้จะเบี้ยวไปตามจุดเพี้ยวนั้น แล้ว selectBestGPS() เดิมก็เลือก "ค่าเดียวที่ accuracy ดีที่สุด
    // ในกลุ่มใหญ่สุด" มาใช้ตรงๆ ซึ่งพึ่งพา accuracy ที่ iOS รายงานมากเกินไป (accuracy ดีไม่ได้แปลว่าตำแหน่ง
    // ถูก) และทิ้งข้อมูลจากตัวอย่างอื่นๆ ที่เก็บมาทั้งหมดไปโดยเปล่าประโยชน์
    //
    // แนวทางใหม่ (Median-filtered Inverse-Variance Weighted Average):
    //   1) ตัดตัวอย่างที่ accuracy แย่เกินใช้งาน (> USABLE_ACCURACY_CEILING_M) ออกก่อน
    //   2) หาตำแหน่งกลางแบบทนทานต่อค่าผิดปกติด้วย median (ไม่ถูกจุดเพี้ยนดึงเหมือนค่าเฉลี่ยธรรมดา)
    //   3) ตัดตัวอย่างที่ห่างจาก median เกินรัศมีที่สมเหตุสมผลออก (ดักจุด WiFi-offset ที่กระโดดไปไกล)
    //   4) รวมตัวอย่างที่เหลือด้วย Inverse-Variance Weighted Average — ตัวอย่างที่ accuracy ดีกว่ามีน้ำหนัก
    //      มากกว่า (weight = 1/accuracy²) นี่คือหลักการเดียวกับ static-state Kalman filter fusion แต่คำนวณ
    //      ตรงไปตรงมากว่า ไม่ต้องมี state/process model ซึ่งไม่เหมาะกับเคสนี้ที่ผู้ใช้ควรจะ "อยู่นิ่ง" อยู่แล้ว
    //   ผลลัพธ์ที่ได้จะมี "combined accuracy" ที่ดีกว่าตัวอย่างเดี่ยวๆ เสมอ เพราะเป็นการรวมค่าประมาณอิสระ
    //   หลายตัว (ลด GPS drift แบบสุ่มของ Android และลดผลกระทบจากจุด offset เดี่ยวๆ ของ iOS พร้อมกัน)

    function median(nums) {
      const arr = [...nums].sort((a, b) => a - b);
      const mid = Math.floor(arr.length / 2);
      return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    }

    function medianPosition(readings) {
      return {
        lat: median(readings.map((r) => r.lat)),
        lng: median(readings.map((r) => r.lng)),
      };
    }

    function filterWithinRadius(readings, center, radiusMeters) {
      return readings.filter(
        (r) => calculateDistance(r.lat, r.lng, center.lat, center.lng) <= radiusMeters,
      );
    }

    // Inverse-Variance Weighted Average: accuracy (เมตร) ตามสเปก W3C ถือเป็นค่าเบี่ยงเบนมาตรฐาน (1 std-dev)
    // ของตำแหน่งนั้น ความแปรปรวน (variance) จึงแปรผันตาม accuracy² — ตัวอย่างที่แปรปรวนต่ำ (accuracy ตัวเลข
    // น้อย = แม่นกว่า) ควรมีน้ำหนักในการเฉลี่ยมากกว่า สูตรมาตรฐานคือ weight = 1 / variance = 1 / accuracy²
    function weightedAverage(readings) {
      let sumW = 0;
      let sumLat = 0;
      let sumLng = 0;
      readings.forEach((r) => {
        const acc = Math.max(Number(r.accuracy) || 1, 1); // กัน accuracy=0/NaN ทำให้ weight เป็น Infinity
        const w = 1 / (acc * acc);
        sumW += w;
        sumLat += r.lat * w;
        sumLng += r.lng * w;
      });
      return {
        lat: sumLat / sumW,
        lng: sumLng / sumW,
        // ค่าเบี่ยงเบนมาตรฐานรวมของค่าเฉลี่ยถ่วงน้ำหนัก (การรวมค่าประมาณอิสระหลายตัวทำให้ accuracy ดีขึ้นเสมอ)
        accuracy: Math.sqrt(1 / sumW),
      };
    }

    // Select best GPS from all readings
    function selectBestGPS(readings) {
      if (readings.length === 0) return null;

      // (1) ตัดตัวอย่างที่ accuracy แย่เกินใช้งานออกก่อน — ถ้าตัดจนไม่เหลือเลย ใช้ชุดเดิมทั้งหมดแทน
      // (fail-safe กันเคสสัญญาณแย่ทั้งหมด ยังต้องมีค่าให้ตัดสินใจ ดีกว่าไม่มีค่าเลย)
      const usable = readings.filter((r) => Number(r.accuracy) <= USABLE_ACCURACY_CEILING_M);
      const pool = usable.length ? usable : readings;

      // (2) ตำแหน่งกลางแบบทนทานต่อค่าผิดปกติ
      const med = medianPosition(pool);

      // (3) ตัดตัวอย่างที่ห่างจาก median เกินไป (รัศมีปรับตาม accuracy ที่ดีที่สุดในชุด แต่ไม่แคบกว่าค่าฐาน)
      const bestAcc = Math.min(...pool.map((r) => Number(r.accuracy) || 999));
      const inlierRadius = Math.max(CLUSTER_INLIER_RADIUS_M, bestAcc * 1.5);
      let inliers = filterWithinRadius(pool, med, inlierRadius);
      if (!inliers.length) inliers = pool; // กัน filter เข้มไปจนไม่เหลือค่าเลย

      // (4) รวมค่าที่เหลือด้วย weighted average
      const avg = weightedAverage(inliers);

      return {
        lat: avg.lat,
        lng: avg.lng,
        accuracy: avg.accuracy,
        sampleCount: inliers.length,
        totalReadings: readings.length,
        rejectedOutliers: pool.length - inliers.length,
      };
    }

    // Task 1: Automatic GPS Sampling
    // ⚠️ UPDATE: เดิมเก็บค่าจำนวนคงที่ (5 ครั้ง) แล้วหยุดทันที ไม่ว่าค่าที่ได้จะนิ่งหรือยังกระโดดไปมาอยู่
    // เปลี่ยนเป็น Adaptive Sampling: เก็บอย่างน้อย MIN_GPS_READINGS ครั้ง แล้วเช็คว่า weighted-average
    // "นิ่ง" หรือยัง (ขยับไม่เกิน STABLE_MOVEMENT_M ใน 3 ค่าล่าสุด) — ถ้านิ่งแล้วหยุดได้เลย (เคสส่วนใหญ่จะ
    // จบไวเท่าเดิม ~10 วิ) แต่ถ้ายังไม่นิ่ง (เช่น iOS ที่ยังสลับ WiFi-fix/GPS-fix ไปมา) จะเก็บต่อจนถึง
    // MAX_GPS_READINGS หรือหมดเวลาเพดาน SAMPLING_TIME_BUDGET_MS เพื่อให้ Core Location ของ iOS มีเวลา
    // พอจะ converge ไปเป็น GPS fix จริง แทนที่จะตัดสินใจเร็วเกินไปด้วยค่าที่ยังไม่นิ่ง
    async function startGPSSampling() {
      if (authState.value !== "logged_in" || samplingInProgress.value) return;

      samplingInProgress.value = true;
      gpsReadings = [];            // ทุกค่าที่อ่านได้ (รวมค่า accuracy แย่ๆ ไว้ debug/บันทึกลง payload.samples)
      let usableReadings = [];     // เฉพาะค่าที่ accuracy ผ่านเกณฑ์ใช้งานได้ — ใช้ตัดสินใจจริง
      let centroidHistory = [];    // weighted-average ทุกครั้งที่มีค่าที่ใช้ได้เพิ่มเข้ามา ใช้เช็คความนิ่ง
      // โหมดทดสอบ: เคลียร์ promise ของรอบก่อนหน้าทิ้ง (ตัวแปร testSendPromises ประกาศไว้ scope นอกสุด
      // ร่วมกับ gpsReadings ด้านบน — ไม่ใช่ local ตรงนี้ เพราะ finishTestMode() ต้องอ่านค่านี้ได้ด้วย)
      // แต่ละครั้งที่ยิงบันทึกลงชีต "Test" สำเร็จ (ดู sendTestReading()) จะ push promise เข้ามาที่นี่
      testSendPromises = [];
      testSavedCount.value = 0;
      testFailedCount.value = 0;
      testLastError.value = "";
      readingCount.value = 0;
      samplingStartTime = Date.now();

      if (!navigator.geolocation) {
        setStatus(
          "error",
          "อุปกรณ์ไม่รองรับ GPS",
          "กรุณาเปิดใช้งานบริการระบุตำแหน่งบนอุปกรณ์ของคุณ",
        );
        samplingInProgress.value = false;
        return;
      }

      setStatus(
        "loading",
        "กำลังเริ่มเก็บข้อมูล GPS...",
        `กำลังเก็บข้อมูลอย่างน้อย ${MIN_GPS_READINGS} ครั้ง (สูงสุด ${MAX_GPS_READINGS} ครั้ง หากสัญญาณยังไม่นิ่ง)`,
      );

      // ⚠️ คงพฤติกรรมเดิมไว้: เริ่มนับ lastAcceptedAt จาก "เวลาที่กดปุ่ม" ไม่ใช่ 0 เพื่อให้ค่าแรกก็ต้องรอ
      // ครบ 2 วิเหมือนค่าอื่นๆ (ดูเหตุผลเดิมด้านบนของไฟล์นี้เรื่อง watchPosition ยิงถี่กว่าที่คาด)
      let lastAcceptedAt = samplingStartTime;
      let budgetTimer = null;
      let finished = false;

      function stopWatch() {
        if (watchId !== null) {
          navigator.geolocation.clearWatch(watchId);
          watchId = null;
        }
        if (budgetTimer) {
          clearTimeout(budgetTimer);
          budgetTimer = null;
        }
      }

      function finishSampling(reason) {
        if (finished) return;
        finished = true;
        stopWatch();
        samplingInProgress.value = false;

        // ถ้ามีค่าที่ผ่านเกณฑ์ใช้งานได้ ให้ใช้เฉพาะชุดนั้น ถ้าไม่มีเลย (สัญญาณแย่มากทั้งหมด) ยังต้องมีค่า
        // ให้ selectBestGPS() ตัดสินใจ ดีกว่าไม่มีค่าเลย (selectBestGPS มี fail-safe ของตัวเองอยู่แล้ว)
        const bestGPS = selectBestGPS(usableReadings.length ? usableReadings : gpsReadings);

        console.log("[UserCheckin] finishSampling:", {
          reason,
          totalReadings: gpsReadings.length,
          usableReadings: usableReadings.length,
          bestGPS,
        });

        if (!bestGPS) {
          setStatus(
            "error",
            "ไม่สามารถอ่านตำแหน่ง GPS ได้",
            "กรุณาออกไปยังที่โล่งหรือใกล้หน้าต่างแล้วลองใหม่อีกครั้ง",
          );
          readingCount.value = 0;
          return;
        }

        updateCurrentPosition(bestGPS.lat, bestGPS.lng, bestGPS.accuracy);

        // Task 3: Check-in Flow - Validate geofence
        const inside = common.isInsideBoundary(bestGPS.lat, bestGPS.lng, boundary.value);

        // Debug log: สรุปพิกัดที่เลือกใช้จริง + ผลการตรวจสอบพื้นที่ (ไว้ตรวจตอน check-in ไม่ผ่าน)
        console.log("[UserCheckin] geofence decision:", {
          selectedLat: bestGPS.lat,
          selectedLng: bestGPS.lng,
          combinedAccuracy: bestGPS.accuracy,
          sampleCountUsed: bestGPS.sampleCount,
          rejectedOutliers: bestGPS.rejectedOutliers,
          maxAccuracyAllowed: maxAccuracy.value,
          distanceToCenterMeters: currentDistance.value,
          boundary: boundary.value,
          isInside: inside,
        });

        // โหมดทดสอบสัญญาณ GPS (?mode=test): ทุกค่าที่ดึงได้ระหว่างทางถูกบันทึกลงชีต "Test" ไปทันที
        // ทีละค่าแล้ว (ดู sendTestReading() ที่เรียกจาก watchPosition callback ด้านบน) ตรงนี้แค่รอให้
        // ครบแล้วสรุปผลให้ user เห็น ไม่ไปต่อที่เงื่อนไข inside/outside ปกติด้านล่าง (ซึ่งจะปฏิเสธ/
        // redirect ไป processing.html)
        if (testMode.value) {
          finishTestMode(bestGPS, inside);
          return;
        }

        if (inside) {
          setStatus(
            "success",
            "✓ อยู่ในพื้นที่ที่กำหนด",
            "ตรวจสอบสำเร็จ! กำลังบันทึกข้อมูลเช็คอิน...",
          );

          loading.value = true;

          const payload = buildPayload(bestGPS.lat, bestGPS.lng, bestGPS.accuracy);
          payload.clientVerified = true;
          payload.areaId = areaId;
          payload.sampleCount = bestGPS.sampleCount; // จำนวนตัวอย่างที่ใช้จริงหลังตัด outlier ออก
          payload.totalReadings = gpsReadings.length; // จำนวนที่อ่านได้ทั้งหมด (รวมค่าที่ถูกตัดทิ้ง)
          payload.samples = gpsReadings;

          common.setPendingCheckin(payload);
          clearPendingFlow();

          setTimeout(() => {
            window.location.href = "../processing.html";
          }, 1000);
        } else {
          setStatus(
            "error",
            "✗ อยู่นอกพื้นที่ที่กำหนด",
            `ระยะห่าง: ${currentDistance.value ? currentDistance.value.toFixed(1) : "?"} เมตร กรุณาเข้าไปในพื้นที่แล้วลองใหม่อีกครั้ง`,
          );
          readingCount.value = 0;
        }
      }

      // เพดานเวลารวม กันไม่ให้ user รอไม่มีที่สิ้นสุดถ้าสัญญาณแย่มากจนไม่มีทางนิ่ง
      budgetTimer = setTimeout(() => finishSampling("time_budget_exceeded"), SAMPLING_TIME_BUDGET_MS);

      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const accuracy = pos.coords.accuracy;

          // อัปเดตตำแหน่งบนแผนที่/ตัวเลขสดทุกครั้งที่มีสัญญาณใหม่เข้ามา ไม่ต้องรอครบ 2 วิ
          updateCurrentPosition(lat, lng, accuracy);

          const now = Date.now();
          if (now - lastAcceptedAt < READING_INTERVAL_MS) {
            // ยังไม่ครบ 2 วินาทีนับจากค่าก่อนหน้า (หรือจากตอนกดปุ่มสำหรับค่าแรก) ข้ามค่านี้ไปก่อน
            return;
          }
          lastAcceptedAt = now;

          gpsReadings.push({ lat, lng, accuracy });
          readingCount.value = gpsReadings.length;

          // ⚠️ FIX (โหมดทดสอบต้องบันทึกทันทีทุกครั้งที่ดึงค่าได้ ไม่รอครบ 10 ครั้ง): ยิงบันทึกค่านี้ลง
          // ชีต "Test" ทันที ตั้งใจไม่ await ตรงนี้ (fire-and-forget) เพื่อไม่ให้การรอผลบันทึกไปหน่วง
          // จังหวะการดึงตำแหน่งครั้งถัดไป ซึ่งต้องห่างกันตรงตาม READING_INTERVAL_MS (1 วินาที) เสมอ —
          // เก็บ promise ไว้ใน testSendPromises ให้ finishTestMode() รอครบทุกคำขอก่อนสรุปผลอีกที
          if (testMode.value) {
            testSendPromises.push(sendTestReading(lat, lng, accuracy, gpsReadings.length));
          }

          // เฉพาะค่าที่ accuracy ผ่านเกณฑ์ใช้งานได้เท่านั้น ที่นับเข้าชุดตัดสินใจ + ใช้เช็คความนิ่ง
          if (Number(accuracy) <= USABLE_ACCURACY_CEILING_M) {
            usableReadings.push({ lat, lng, accuracy });
            centroidHistory.push(weightedAverage(usableReadings));
          }

          setStatus(
            "loading",
            `กำลังเก็บข้อมูล GPS (${gpsReadings.length}${usableReadings.length !== gpsReadings.length ? `, ใช้ได้ ${usableReadings.length}` : ""
            })...`,
            `ล่าสุด: ละติจูด ${lat.toFixed(6)}, ลองจิจูด ${lng.toFixed(6)}, ความแม่นยำ ${accuracy.toFixed(1)} เมตร`,
          );

          const reachedMax = gpsReadings.length >= MAX_GPS_READINGS;

          // เช็คความนิ่ง: ต้องมีค่าที่ใช้ได้อย่างน้อย MIN_GPS_READINGS ตัว และ weighted-average 3 ค่าล่าสุด
          // ต้องขยับกันไม่เกิน STABLE_MOVEMENT_M ถึงจะถือว่าสัญญาณนิ่งพอจะหยุดเก็บก่อนถึง MAX ได้
          let isStable = false;
          if (usableReadings.length >= MIN_GPS_READINGS && centroidHistory.length >= 3) {
            const last3 = centroidHistory.slice(-3);
            const move1 = calculateDistance(last3[0].lat, last3[0].lng, last3[2].lat, last3[2].lng);
            const move2 = calculateDistance(last3[1].lat, last3[1].lng, last3[2].lat, last3[2].lng);
            isStable = Math.max(move1, move2) <= STABLE_MOVEMENT_M;
          }

          if (reachedMax || isStable) {
            finishSampling(reachedMax ? "max_readings_reached" : "position_stable");
          }
        },
        (err) => {
          console.error("ข้อผิดพลาด GPS:", err);

          // ถ้ามีตัวอย่างที่ใช้ได้เก็บไว้แล้วบางส่วน ให้ปิดจบด้วยค่าที่มีแทนที่จะทิ้งทั้งหมด (ลด False
          // Negative ในเคสที่ GPS หลุดสัญญาณกลางคันแต่ก็ยังพอมีข้อมูลตัดสินใจได้อยู่)
          if (usableReadings.length > 0) {
            finishSampling("geo_error_with_partial_data");
            return;
          }

          stopWatch();
          samplingInProgress.value = false;

          let detail = "กรุณาเปิดใช้งานบริการระบุตำแหน่งบนอุปกรณ์ของคุณ";
          if (err?.code === 1) {
            detail = "ถูกปฏิเสธสิทธิ์การเข้าถึงตำแหน่ง กรุณาเปิดสิทธิ์ในการตั้งค่า";
          } else if (err?.code === 2) {
            detail = "ไม่สามารถระบุตำแหน่งได้ กรุณาลองใหม่อีกครั้ง";
          } else if (err?.code === 3) {
            detail = "หมดเวลาการขอตำแหน่ง กรุณาลองใหม่อีกครั้ง";
          }

          setStatus("error", "เกิดข้อผิดพลาด GPS", detail);
          readingCount.value = 0;
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        },
      );
    }

    // FIX: เมื่อ authState เป็น "error" (เช่น LIFF init ล้มเหลว/หมดเวลา) เดิมกดปุ่มแล้วไม่มีอะไรเกิดขึ้นเลย
    // (confirmCheckIn เช็คแค่ authState !== 'logged_in' แล้ว return เงียบๆ) ผู้ใช้จึงต้องออกไปสแกน QR ใหม่
    // ทั้งที่จริงๆ แค่ลองเชื่อมต่อ LIFF ใหม่ในหน้าเดิมก็พอ ฟังก์ชันนี้ reset สถานะแล้วลอง loadConfig+initLiff อีกครั้ง
    async function retryInit() {
      authState.value = "checking";
      setStatus("idle", "กำลังลองเชื่อมต่อใหม่...", "กรุณารอสักครู่");
      try {
        await Promise.all([loadConfig(), initLiff()]);
        await nextTick();
        initMap();
      } catch (err) {
        console.error("ข้อผิดพลาดการลองเชื่อมต่อใหม่:", err);
      }
    }

    // FIX: ฟังก์ชันจัดการการกดปุ่มเช็คอิน - ป้องกันการกดซ้ำหลายครั้ง
    function confirmCheckIn() {
      if (authState.value === "error") { retryInit(); return; } // ลองเชื่อมต่อ LIFF ใหม่แทนที่จะกดไม่ได้เลย
      if (loading.value) return;           // ป้องกันกดซ้ำขณะบันทึก
      if (samplingInProgress.value) return; // ป้องกันกดซ้ำขณะเก็บ GPS
      if (authState.value !== "logged_in") return; // ต้อง login ก่อน
      startGPSSampling();
    }

    // FIX (ตรวจสอบนานเกินไป): เดิมโหลดพื้นที่ (loadConfig, เรียก Google Apps Script) และเริ่มต้น LIFF
    // (initLiff) แบบ "ทีละขั้น" (await ต่อกัน) ทำให้เวลารอรวมกันได้สูงสุดถึง ~27 วิ (15s + 12s) ในเคสที่ช้าสุด
    // ทั้งที่จริงๆ สองงานนี้ไม่เกี่ยวข้องกัน ทำพร้อมกันได้เลย (Promise.all) ช่วยลดเวลารอลงเกือบครึ่งหนึ่ง
    onMounted(async () => {
      try {
        await Promise.all([loadConfig(), initLiff()]);
        await nextTick();
        initMap();
      } catch (err) {
        console.error("ข้อผิดพลาดการเริ่มต้น:", err);
        setStatus(
          "error",
          "เกิดข้อผิดพลาดในการเริ่มต้นระบบ",
          "กรุณารีเฟรชหน้าเว็บแล้วลองใหม่อีกครั้ง",
        );
      }
    });

    // Re-initialize map when authState changes
    watch(authState, async (newState) => {
      if (newState === "logged_in") {
        await nextTick();
        initMap();
      }
    });

    // Redraw boundary when it changes
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
      maxGpsReadings: MAX_GPS_READINGS, // FIX: template เดิมเขียนเลข "/10" ตายตัว ทั้งที่ตอนนี้สุ่ม GPS แค่ 5 ครั้ง
      startGPSSampling,
      confirmCheckIn,
      samplingInProgress,
      testMode,
      testResult,
    };
  },
}).mount("#app");
