const { createApp, computed, onMounted, ref, watch, nextTick } = Vue;
const common = window.CheckinCommon || {};

createApp({
  template: "#gpstest-template",
  setup() {
    const authState = ref("checking");
    const session = ref(null);
    const areas = ref([]);
    const selectedAreaId = ref("");
    const config = ref({ ...common.DEFAULT_CONFIG });
    const maxAccuracy = ref(30);
    
    const samplingInProgress = ref(false);
    const readingCount = ref(0);
    const currentLat = ref(null);
    const currentLng = ref(null);
    const currentAccuracy = ref(null);
    const currentDistance = ref(null);
    const isInside = ref(false);

    const mapEl = ref(null);
    let map = null;
    let boundaryRect = null;
    let centerMarker = null;
    let currentMarker = null;
    let currentCircle = null;

    const boundary = computed(() => common.buildBoundary(config.value));
    
    const navItems = computed(() => common.getNavItems(session.value?.role || "masteradmin", "gpstest"));
    const showLogout = computed(() => {
      const r = String(session.value?.role || "").toLowerCase();
      return r === "admin" || r === "masteradmin";
    });

    async function initAuth() {
      try {
        const info = await FirebaseRole.currentSession(false);
        if (!info) {
          // ยังไม่ได้ login เลย -> ดีดไปหน้า login แล้วพากลับมาหน้านี้หลังล็อกอินสำเร็จ
          FirebaseRole.redirectToLogin();
          return;
        }
        if (info.role !== "masteradmin") {
          authState.value = "unauthorized";
          return;
        }
        session.value = info;
        authState.value = "logged_in";
        await loadAreas();
        await nextTick();
        initMap();
      } catch (err) {
        console.error(err);
        authState.value = "error";
      }
    }

    async function loadAreas() {
      try {
        const list = await common.getAreas();
        areas.value = list;
        if (list.length > 0) {
          selectedAreaId.value = list[0].areaId;
          onAreaChange();
        }
      } catch (err) {
        console.error("Load areas failed", err);
      }
    }

    function onAreaChange() {
      const found = areas.value.find(a => a.areaId === selectedAreaId.value);
      if (found) {
        config.value = common.normalizeConfig(found);
        maxAccuracy.value = config.value.maxAccuracy || 30;
        if (map) {
          map.setView([config.value.lat, config.value.lng], 18);
          drawBoundary();
        }
      }
    }

    function initMap() {
      if (!mapEl.value || map) return;
      
      map = L.map(mapEl.value).setView([config.value.lat, config.value.lng], 18);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
      }).addTo(map);

      drawBoundary();
    }

    function drawBoundary() {
      if (!map) return;
      
      if (boundaryRect) map.removeLayer(boundaryRect);
      if (centerMarker) map.removeLayer(centerMarker);

      const b = boundary.value;
      boundaryRect = L.rectangle(
        [[b.minLat, b.minLng], [b.maxLat, b.maxLng]], 
        { color: "#2563eb", weight: 2, fillOpacity: 0.1, dashArray: '5, 5' }
      ).addTo(map);

      centerMarker = L.circleMarker([config.value.lat, config.value.lng], {
        radius: 6, color: "#2563eb", fillColor: "#2563eb", fillOpacity: 1, weight: 2
      }).addTo(map).bindPopup("จุดศูนย์กลาง: " + config.value.areaName);
    }

    function updateCurrentPosition(lat, lng, acc) {
      currentLat.value = lat;
      currentLng.value = lng;
      currentAccuracy.value = acc;
      
      currentDistance.value = common.calculateDistanceMeters(
        lat, lng, config.value.lat, config.value.lng
      );
      
      isInside.value = common.isInsideBoundary(lat, lng, boundary.value);

      if (!map) return;

      if (currentMarker) map.removeLayer(currentMarker);
      if (currentCircle) map.removeLayer(currentCircle);

      currentMarker = L.marker([lat, lng]).addTo(map);
      currentCircle = L.circle([lat, lng], {
        radius: acc, color: isInside.value ? "#10b981" : "#ef4444", fillOpacity: 0.1, weight: 2
      }).addTo(map);
    }

    function selectBestGPS(readings) {
      if (readings.length === 0) return null;
      let bestReading = readings[0];
      readings.forEach(r => {
        if (r.accuracy < bestReading.accuracy) bestReading = r;
      });
      return bestReading;
    }

    function startTest() {
      if (samplingInProgress.value) return;

      samplingInProgress.value = true;
      readingCount.value = 0;
      const readings = [];

      const MAX_READINGS = 5;
      const READING_INTERVAL = 2000; // 2 วินาที — logic เดียวกับ user/checkin.html
      const samplingStartTime = Date.now();
      // เริ่มนับ lastAcceptedAt จากเวลาที่กดปุ่ม เพื่อให้ค่าแรก (1/5) ก็ต้องรอครบ 2 วิเหมือนค่าที่เหลือ
      // (ไม่ปล่อยให้ค่าแรกเข้าทันทีที่หาสัญญาณ GPS เจอ ซึ่งเวลาจะไม่แน่นอน)
      let lastAcceptedAt = samplingStartTime;
      let readingsCollected = 0;

      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const acc = pos.coords.accuracy;

          // อัปเดตตำแหน่งบนแผนที่/ตัวเลขสดทุกครั้งที่มีสัญญาณใหม่เข้ามา ไม่ต้องรอครบ 2 วิ
          updateCurrentPosition(lat, lng, acc);

          if (readingsCollected >= MAX_READINGS) return;

          const now = Date.now();
          if (now - lastAcceptedAt < READING_INTERVAL) {
            // ยังไม่ครบ 2 วินาทีนับจากค่าก่อนหน้า (หรือจากตอนกดปุ่มสำหรับค่าแรก) ข้ามค่านี้ไปก่อน
            return;
          }
          lastAcceptedAt = now;

          readings.push({ lat, lng, accuracy: acc });
          readingsCollected++;
          readingCount.value = readingsCollected;

          if (readingsCollected >= MAX_READINGS) {
            navigator.geolocation.clearWatch(watchId);
            samplingInProgress.value = false;

            // หน้านี้ไว้ทดสอบเฉยๆ ไม่บันทึก/ส่งข้อมูลเช็คอินใดๆ ทั้งสิ้น
            const best = selectBestGPS(readings);
            if (best) {
              updateCurrentPosition(best.lat, best.lng, best.accuracy);
              const dist = common.calculateDistanceMeters(best.lat, best.lng, config.value.lat, config.value.lng);
              alert(`ทดสอบเสร็จสิ้น!\nจุดที่ดีที่สุด: ${best.lat.toFixed(6)}, ${best.lng.toFixed(6)}\nความแม่นยำ: ${best.accuracy.toFixed(1)} เมตร\nระยะห่างจากศูนย์กลาง: ${dist.toFixed(1)} เมตร\nสถานะ: ${isInside.value ? 'อยู่ในพื้นที่' : 'อยู่นอกพื้นที่'}`);
            }
          }
        },
        (err) => {
          console.error(err);
          samplingInProgress.value = false;
          alert("GPS Error: " + err.message);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    }

    async function logout() {
      await FirebaseRole.signOut();
      location.replace("./index.html");
    }

    onMounted(async () => {
      await initAuth();
    });

    return {
      authState, session, areas, selectedAreaId, config, maxAccuracy,
      samplingInProgress, readingCount, currentLat, currentLng,
      currentAccuracy, currentDistance, isInside, mapEl,
      navItems, showLogout,
      onAreaChange, startTest, logout
    };
  }
}).mount("#app");
