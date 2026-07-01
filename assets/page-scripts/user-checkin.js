const { createApp, computed, onMounted, ref, nextTick, watch } = Vue;
const common = window.CheckinCommon;
const LIFF_INIT_TIMEOUT_MS = 12000;
const PENDING_FLOW_KEY = "pending_checkin_flow";
// ⚠️ BUGFIX (เลือกพื้นที่ที่ 2 แต่พอ redirect ไป LINE Login กลับมาแล้วกลายเป็นพื้นที่แรก):
// เดิมโค้ดอ่าน areaId จาก query string ของ URL ปัจจุบันเท่านั้น ปัญหาคือระหว่างที่ liff.login()
// พาไปหน้า LINE Login แล้ว redirect กลับมา บางเบราว์เซอร์/เคส LIFF จะไม่คืนค่า query string
// (areaId=...) กลับมาครบตามที่ส่งไปเป๊ะๆ ทำให้พอกลับมาถึงหน้าเว็บ areaId ว่างเปล่า แล้วโค้ดฝั่ง
// common.getArea("") จะ fallback ไปใช้ "พื้นที่แรกสุดในชีต" แทนพื้นที่ที่ user เลือกไว้จริง (พื้นที่ 2)
// แก้โดย: จำ areaId ไว้ใน sessionStorage ตั้งแต่ตอนเปิดหน้านี้ครั้งแรก (ก่อนจะมีการ redirect ใดๆ)
// แล้วถ้ากลับมาแล้ว URL ไม่มี areaId ให้ดึงค่าที่จำไว้กลับมาใช้แทน (sessionStorage อยู่รอด
// ตลอด tab เดียวกันแม้จะมีการ redirect ไป-กลับหลายรอบ)
const AREA_ID_STORAGE_KEY = "checkin_pending_area_id";
// เปลี่ยนจำนวนครั้งการสุ่มอ่านค่า GPS ("retry") เพื่อเลือกพิกัดที่แม่นที่สุดจาก 10 ครั้ง เหลือ 5 ครั้ง
// (ลดเวลาที่ user ต้องรอตอนกดเช็คอิน โดยยังคง logic คัดเลือกพิกัดที่ดีที่สุดแบบเดิมไว้ทั้งหมด)
const MAX_GPS_READINGS = 5;
// เก็บระยะเวลาขั้นต่ำระหว่างการ "รับ" ค่าพิกัดแต่ละครั้ง (ดูรายละเอียดที่ startGPSSampling ด้านล่าง)
const READING_INTERVAL_MS = 2000;

function resolveAreaId(query) {
  const fromUrl = String(query.get("areaId") || query.get("qr_code") || query.get("site") || "").trim();
  if (fromUrl) {
    try { sessionStorage.setItem(AREA_ID_STORAGE_KEY, fromUrl); } catch (e) { /* เบราว์เซอร์บางตัวอาจปิด storage ไว้ ไม่เป็นไร */ }
    return fromUrl;
  }
  try {
    const remembered = String(sessionStorage.getItem(AREA_ID_STORAGE_KEY) || "").trim();
    if (remembered) {
      console.warn("[UserCheckin] areaId หายไปจาก URL (น่าจะระหว่าง redirect LINE Login) — ใช้ค่าที่จำไว้ก่อนหน้าแทน:", remembered);
      return remembered;
    }
  } catch (e) { /* no-op */ }
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

    // Map elements
    let map = null;
    let boundaryRect = null;
    let centerMarker = null;
    let currentMarker = null;
    let currentCircle = null;

    // FIX: แปลข้อความปุ่มเป็นภาษาไทยทั้งหมด และเพิ่ม state "checking"
    const dynamicButtonText = computed(() => {
      if (authState.value === "checking") return "กำลังตรวจสอบ...";
      if (authState.value === "logged_out") return "กำลังเปลี่ยนเส้นทางไปยัง LINE Login...";
      if (samplingInProgress.value) return `กำลังเก็บข้อมูล GPS... (${readingCount.value}/${MAX_GPS_READINGS})`;
      if (loading.value) return "กำลังบันทึกข้อมูล...";
      return "เช็คอิน";
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
        if (areaId && String(area?.areaId || "").trim() !== String(areaId).trim()) {
          throw new Error(
            `ไม่พบพื้นที่ตามรหัส QR (${areaId}) ในระบบ กรุณาสแกน QR ใหม่ หรือแจ้งผู้ดูแลระบบให้ตรวจสอบหน้า SetArea`,
          );
        }

        config.value = common.normalizeConfig(area);
        maxAccuracy.value = Number(config.value.maxAccuracy || 30);

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
          "โหลดการตั้งค่าไม่สำเร็จ",
          err?.message || "กรุณาตรวจสอบการเชื่อมต่อกับ Google Sheet/Apps Script",
        );
      }
    }

    async function initLiff() {
      try {
        if (!window.liff)
          throw new Error("ไม่พบ LIFF SDK");
        if (!common?.LIFF_ID)
          throw new Error("กรุณาตรวจสอบการตั้งค่า LIFF ID");

        await withTimeout(
          liff.init({
            liffId: common.LIFF_ID,
            withLoginOnExternalBrowser: true,
          }),
          LIFF_INIT_TIMEOUT_MS,
          "หมดเวลาการเริ่มต้น LIFF",
        );

        liffReady.value = true;

        if (liff.isLoggedIn()) {
          authState.value = "logged_in";
          profile.value = await liff.getProfile();
          setStatus("idle", "พร้อมเช็คอิน", "กดปุ่มด้านล่างเพื่อเริ่มเช็คอิน");
        } else {
          authState.value = "logged_out";
          setStatus(
            "idle",
            "กำลังเปลี่ยนเส้นทางไปยัง LINE Login...",
            "กรุณารอสักครู่ ระบบกำลังพาคุณไปยังหน้า LINE Authentication",
          );
          // Requirement 4: Automatic LINE Login redirect
          liff.login({ redirectUri: getReturnUrl(areaId) });
        }
      } catch (err) {
        console.error(err);
        // FIX: เมื่อ LIFF error ให้ set authState เป็น "error" แทน "logged_out"
        // เพื่อไม่ให้ปุ่ม disabled โดยไม่จำเป็น และแสดงข้อความที่ถูกต้อง
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

    // Clustering algorithm: Group nearby coordinates
    function clusterReadings(readings, clusterRadiusMeters = 10) {
      if (readings.length === 0) return [];

      const clusters = [];
      const used = new Set();

      readings.forEach((reading, idx) => {
        if (used.has(idx)) return;

        const cluster = [reading];
        used.add(idx);

        readings.forEach((other, otherIdx) => {
          if (used.has(otherIdx)) return;
          const dist = calculateDistance(
            reading.lat,
            reading.lng,
            other.lat,
            other.lng,
          );
          if (dist <= clusterRadiusMeters) {
            cluster.push(other);
            used.add(otherIdx);
          }
        });

        clusters.push(cluster);
      });

      return clusters;
    }

    // Select best GPS from all readings
    function selectBestGPS(readings) {
      if (readings.length === 0) return null;

      // Cluster readings
      const clusters = clusterReadings(readings, 10); // 10m cluster radius

      // Find the largest cluster
      let largestCluster = clusters[0];
      clusters.forEach((cluster) => {
        if (cluster.length > largestCluster.length) {
          largestCluster = cluster;
        }
      });

      // Within the largest cluster, select the reading with lowest accuracy
      let bestReading = largestCluster[0];
      largestCluster.forEach((reading) => {
        if (reading.accuracy < bestReading.accuracy) {
          bestReading = reading;
        }
      });

      return bestReading;
    }

    // Task 1: Automatic GPS Sampling
    async function startGPSSampling() {
      if (authState.value !== "logged_in" || samplingInProgress.value) return;

      samplingInProgress.value = true;
      gpsReadings = [];
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
        `กำลังเก็บข้อมูล ${MAX_GPS_READINGS} ครั้ง ทุก 2 วินาที`,
      );

      let readingsCollected = 0;
      const READING_INTERVAL = READING_INTERVAL_MS; // 2 seconds
      const MAX_READINGS = MAX_GPS_READINGS;
      // ⚠️ BUGFIX (กด 5 ครั้งแล้วเสร็จปุ๊บปั๊บ ไม่รอ 2 วิ/ครั้งจริง):
      // watchPosition() ของมือถือหลายรุ่นยิง callback ถี่กว่า 2 วินาทีมาก (บางเครื่อง <1 วิ/ครั้ง)
      // เดิมโค้ดรับทุก callback ที่เข้ามาทันทีโดยไม่เช็คเวลาจริง พอลดจาก 10 เหลือ 5 ครั้ง เลยดูเหมือน
      // เสร็จทันทีทั้งที่ข้อความแจ้งผู้ใช้บอกว่า "เก็บข้อมูลทุก 2 วินาที" ต้องบังคับเว้นระยะเวลาจริง
      // ระหว่างค่าที่ "นับ" แต่ละครั้งเอง (ค่าที่ยังไม่ถึงคิวจะยังอัปเดตแผนที่/ตำแหน่งสดให้เห็นตามปกติ)
      let lastAcceptedAt = 0;

      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const accuracy = pos.coords.accuracy;

          // อัปเดตตำแหน่งบนแผนที่/ตัวเลขสดทุกครั้งที่มีสัญญาณใหม่เข้ามา ไม่ต้องรอครบ 2 วิ
          updateCurrentPosition(lat, lng, accuracy);

          if (readingsCollected >= MAX_READINGS) return;

          const now = Date.now();
          if (readingsCollected > 0 && now - lastAcceptedAt < READING_INTERVAL) {
            // ยังไม่ครบ 2 วินาทีนับจากค่าก่อนหน้า ข้ามค่านี้ไปก่อน (รอ callback ครั้งถัดไป)
            return;
          }
          lastAcceptedAt = now;

          // Collect reading only if we haven't reached max
          if (readingsCollected < MAX_READINGS) {
            gpsReadings.push({ lat, lng, accuracy });
            readingsCollected++;
            readingCount.value = readingsCollected;

            setStatus(
              "loading",
              `กำลังเก็บข้อมูล GPS (${readingsCollected}/${MAX_READINGS})...`,
              `ล่าสุด: ละติจูด ${lat.toFixed(6)}, ลองจิจูด ${lng.toFixed(6)}, ความแม่นยำ ${accuracy.toFixed(1)} เมตร`,
            );

            // When all readings collected
            if (readingsCollected >= MAX_READINGS) {
              navigator.geolocation.clearWatch(watchId);
              watchId = null;
              samplingInProgress.value = false;

              // Task 2: Select the best GPS
              const bestGPS = selectBestGPS(gpsReadings);

              if (bestGPS) {
                updateCurrentPosition(bestGPS.lat, bestGPS.lng, bestGPS.accuracy);

                // Task 3: Check-in Flow - Validate geofence
                const inside = common.isInsideBoundary(
                  bestGPS.lat,
                  bestGPS.lng,
                  boundary.value,
                );

                // Debug log: สรุปพิกัดที่เลือกใช้จริง + ผลการตรวจสอบพื้นที่ (ไว้ตรวจตอน check-in ไม่ผ่าน)
                console.log("[UserCheckin] geofence decision:", {
                  selectedLat: bestGPS.lat,
                  selectedLng: bestGPS.lng,
                  selectedAccuracy: bestGPS.accuracy,
                  maxAccuracyAllowed: maxAccuracy.value,
                  distanceToCenterMeters: currentDistance.value,
                  boundary: boundary.value,
                  isInside: inside,
                });

                if (inside) {
                  setStatus(
                    "success",
                    "✓ อยู่ในพื้นที่ที่กำหนด",
                    "ตรวจสอบสำเร็จ! กำลังบันทึกข้อมูลเช็คอิน...",
                  );

                  loading.value = true;

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
                  setStatus(
                    "error",
                    "✗ อยู่นอกพื้นที่ที่กำหนด",
                    `ระยะห่าง: ${currentDistance.value ? currentDistance.value.toFixed(1) : '?'} เมตร กรุณาเข้าไปในพื้นที่แล้วลองใหม่อีกครั้ง`,
                  );
                  readingCount.value = 0;
                }
              }
            }
          }
        },
        (err) => {
          console.error("ข้อผิดพลาด GPS:", err);
          navigator.geolocation.clearWatch(watchId);
          watchId = null;
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

    // FIX: ฟังก์ชันจัดการการกดปุ่มเช็คอิน - ป้องกันการกดซ้ำหลายครั้ง
    function confirmCheckIn() {
      if (loading.value) return;           // ป้องกันกดซ้ำขณะบันทึก
      if (samplingInProgress.value) return; // ป้องกันกดซ้ำขณะเก็บ GPS
      if (authState.value !== "logged_in") return; // ต้อง login ก่อน
      startGPSSampling();
    }

    onMounted(async () => {
      try {
        await loadConfig();
        await initLiff();
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
      startGPSSampling,
      confirmCheckIn,
      samplingInProgress,
    };
  },
}).mount("#app");
