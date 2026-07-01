const { createApp, computed, onMounted, ref, nextTick, watch } = Vue;
const common = window.CheckinCommon;
const LIFF_INIT_TIMEOUT_MS = 12000;
const PENDING_FLOW_KEY = "pending_checkin_flow";

function setPendingFlow() {
  sessionStorage.setItem(PENDING_FLOW_KEY, "1");
}

function hasPendingFlow() {
  return sessionStorage.getItem(PENDING_FLOW_KEY) === "1";
}

function clearPendingFlow() {
  sessionStorage.removeItem(PENDING_FLOW_KEY);
}

function getReturnUrl() {
  const url = new URL(window.location.href);
  ["code", "state", "liff.state", "access_token", "token"].forEach((key) => {
    url.searchParams.delete(key);
  });
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
    const areaId = query.get("areaId") || query.get("qr_code") || query.get("site") || "";
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
      if (samplingInProgress.value) return `กำลังเก็บข้อมูล GPS... (${readingCount.value}/10)`;
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
        config.value = common.normalizeConfig(area);
        maxAccuracy.value = Number(config.value.maxAccuracy || 30);
      } catch (err) {
        console.error(err);
        setStatus(
          "error",
          "โหลดการตั้งค่าไม่สำเร็จ",
          "กรุณาตรวจสอบการเชื่อมต่อกับ Google Sheet/Apps Script",
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
          liff.login({ redirectUri: getReturnUrl() });
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

      return {
        ...pending,
        site: site.value,
        session,
        displayName,
        name: displayName,
        email: decoded?.email || pending.email || "",
        lat,
        lng,
        accuracy,
        maxAccuracy: maxAccuracy.value,
        time: common.formatBangkokNow ? common.formatBangkokNow() : new Date().toISOString(),
        userId: profile.value?.userId || "",
      };
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
        "กำลังเก็บข้อมูล 10 ครั้ง ทุก 2 วินาที",
      );

      let readingsCollected = 0;
      const READING_INTERVAL = 2000; // 2 seconds
      const MAX_READINGS = 10;

      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const accuracy = pos.coords.accuracy;

          // Always update display
          updateCurrentPosition(lat, lng, accuracy);

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
