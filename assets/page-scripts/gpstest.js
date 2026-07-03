const { createApp, computed, onMounted, ref, watch, nextTick } = Vue;
const common = window.CheckinCommon || {};

// ⚠️ UPDATE (เปลี่ยนตามคำขอ: ดึงตำแหน่งทุก 1 วินาที จำนวน 10 ครั้งตายตัว แทน Adaptive Sampling เดิม):
// เดิมเก็บอย่างน้อย MIN_GPS_READINGS (5) ครั้งแล้วเช็คความนิ่งก่อนตัดสินใจหยุด/เก็บต่อจนถึง MAX (10)
// ครั้ง ห่างกันครั้งละ 2 วิ ตอนนี้เปลี่ยนเป็นค่าคงที่ตายตัว: เก็บให้ครบ 10 ครั้งเสมอ ห่างกันครั้งละ 1 วิ
// (ตั้ง MIN = MAX = 10 ทำให้เงื่อนไข "ครบ MAX" ที่ทำงานอยู่แล้วเป็นตัวสั่งจบเสมอ ไม่ต้องพึ่งเช็คความนิ่งอีก
// ค่าคงที่ชุดนี้ตรงกับ logic การสุ่มตัวอย่าง/เลือกจุดที่ดีที่สุดของ user/checkin.html เพื่อให้หน้าทดสอบนี้
// สะท้อนพฤติกรรมของหน้าเช็คอินจริงต่อไป — ดูเหตุผลละเอียดในคอมเมนต์ของ user-checkin.js)
const MIN_GPS_READINGS = 10; // เก็บให้ครบเท่านี้เสมอก่อนตัดสินใจ (เท่ากับ MAX = ไม่มีการหยุดก่อนกำหนด)
const MAX_GPS_READINGS = 10; // เพดานสูงสุด — ตอนนี้เท่ากับ MIN คือเก็บ 10 ครั้งตายตัวทุกครั้ง
const READING_INTERVAL_MS = 1000; // ทุก 1 วินาที ตามที่ระบุ
const USABLE_ACCURACY_CEILING_M = 50;
const STABLE_MOVEMENT_M = 5;
const SAMPLING_TIME_BUDGET_MS = 15000; // 10 ครั้ง x 1 วิ ≈ 10 วิ + สำรองไว้อีกนิด
const CLUSTER_INLIER_RADIUS_M = 15;

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

    // ⚠️ ใหม่: โหมด Test — ถ้าติ๊กไว้ ทุกค่าที่ดึงได้จะถูกบันทึกลงชีต "Test" เสมอ (ไม่ว่าจะอยู่ในกรอบหรือไม่)
    // ถ้าไม่ติ๊ก จะบันทึกลงชีต "Logs" ตามปกติ (ฝั่งเซิร์ฟเวอร์จะปฏิเสธค่าที่อยู่นอกกรอบ/accuracy เกินกำหนด
    // เหมือน saveLog() ปกติทุกประการ — ดู saveReading() ด้านล่าง)
    const testMode = ref(false);
    const savedCount = ref(0);
    const failedCount = ref(0);
    const lastSaveError = ref("");

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

    // ⚠️ ใหม่: บันทึกค่าพิกัดที่ดึงได้ "ทันที" ทุกครั้ง (ไม่รอให้ครบ 10 ครั้งก่อน) ตามที่ระบุ
    // - ติ๊ก "Test": ยิงไป common.addTestLog() -> ฝั่งเซิร์ฟเวอร์บันทึกลงชีต "Test" เสมอ ไม่ว่าจะอยู่ใน
    //   กรอบพื้นที่หรือไม่ (validateGeofence ยังถูกเรียกฝั่งเซิร์ฟเวอร์เพื่อคำนวณ status inside/outside
    //   ไว้บันทึกเฉยๆ แต่ไม่ใช้ตัดสินใจปฏิเสธ)
    // - ไม่ติ๊ก: ยิงไป common.addLog() -> ฝั่งเซิร์ฟเวอร์บันทึกลงชีต "Logs" ตามปกติ (พฤติกรรมเดียวกับ
    //   การเช็คอินจริงทุกประการ รวมถึงการปฏิเสธหากอยู่นอกกรอบ/accuracy แย่เกินกำหนด)
    // ทำงานแบบ fire-and-forget (ไม่ await ใน caller) เพื่อไม่ให้การบันทึกแต่ละครั้งไปหน่วงจังหวะการดึง
    // ตำแหน่งครั้งถัดไป (ยังต้องดึงให้ตรงทุก 1 วินาทีตามที่ระบุ) แต่ยังคง track ผลลัพธ์ไว้แสดงในหน้าจอ
    async function saveReading(lat, lng, acc) {
      const area = areas.value.find((a) => a.areaId === selectedAreaId.value) || {};
      const distNow = common.calculateDistanceMeters(lat, lng, config.value.lat, config.value.lng);
      const insideNow = common.isInsideBoundary(lat, lng, boundary.value);

      const payload = {
        areaId: selectedAreaId.value,
        site: config.value.areaName || area.areaName || selectedAreaId.value,
        lat,
        lng,
        accuracy: acc,
        maxAccuracy: maxAccuracy.value,
        time: common.formatBangkokNow ? common.formatBangkokNow() : new Date().toISOString(),
        displayName: session.value?.user?.displayName || session.value?.user?.email || "GPS Test (masteradmin)",
        email: session.value?.user?.email || "",
        // หมายเหตุ: ไม่ส่ง userId เพราะผู้ทดสอบคือ masteradmin ที่ล็อกอินผ่าน Firebase ไม่ใช่ LINE userId
        // (การส่ง Firebase uid เข้าไปในช่อง userId จะไปปนกับตัวจับคู่ LINE userId ของชีต Logs/Test)
        userId: "",
        status: insideNow ? "inside_boundary" : "outside_boundary",
        distantcenter: Math.round(distNow * 100) / 100,
      };

      try {
        const res = testMode.value
          ? await common.addTestLog(payload, 20000)
          : await common.addLog(payload, 20000);

        if (res && res.ok === false) {
          throw new Error(res.err || res.error || res.message || "บันทึกไม่สำเร็จ");
        }
        savedCount.value += 1;
      } catch (err) {
        console.error("[GPSTest] saveReading error:", err);
        failedCount.value += 1;
        lastSaveError.value = err?.message || "บันทึกไม่สำเร็จ";
      }
    }

    // ⚠️ UPDATE: ใช้ logic เดียวกับ user/checkin.html เป๊ะๆ (Median-filtered Inverse-Variance Weighted
    // Average) แทนการเลือก "ค่าเดียวที่ accuracy ดีที่สุด" — ดูเหตุผลละเอียดในคอมเมนต์ของ user-checkin.js
    // (สรุปสั้นๆ: accuracy ที่ iOS รายงานไม่ได้แปลว่าตำแหน่งถูกต้องเสมอไป โดยเฉพาะตอนใช้ WiFi Positioning
    // อยู่ในอาคาร ต้องรวมหลายค่าด้วยน้ำหนักตาม accuracy แทนเชื่อค่าเดียว) หน้านี้ยังคงเป็นหน้าทดสอบเฉยๆ
    // ไม่บันทึก/ส่งข้อมูลเช็คอินใดๆ เหมือนเดิม เปลี่ยนแค่วิธี "เลือกจุดที่ดีที่สุด" ให้ตรงกับของจริง

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

    function weightedAverage(readings) {
      let sumW = 0;
      let sumLat = 0;
      let sumLng = 0;
      readings.forEach((r) => {
        const acc = Math.max(Number(r.accuracy) || 1, 1);
        const w = 1 / (acc * acc);
        sumW += w;
        sumLat += r.lat * w;
        sumLng += r.lng * w;
      });
      return {
        lat: sumLat / sumW,
        lng: sumLng / sumW,
        accuracy: Math.sqrt(1 / sumW),
      };
    }

    function selectBestGPS(readings) {
      if (readings.length === 0) return null;

      const usable = readings.filter((r) => Number(r.accuracy) <= USABLE_ACCURACY_CEILING_M);
      const pool = usable.length ? usable : readings;

      const med = medianPosition(pool);

      const bestAcc = Math.min(...pool.map((r) => Number(r.accuracy) || 999));
      const inlierRadius = Math.max(CLUSTER_INLIER_RADIUS_M, bestAcc * 1.5);
      let inliers = filterWithinRadius(pool, med, inlierRadius);
      if (!inliers.length) inliers = pool;

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

    // ⚠️ UPDATE: เปลี่ยนจาก Adaptive Sampling เดิมเป็นค่าคงที่ตายตัวตามที่ระบุ — ดึงตำแหน่งทุก 1 วินาที
    // จำนวน 10 ครั้งเสมอ (ไม่มีการหยุดก่อนกำหนดแม้สัญญาณจะนิ่งแล้วก็ตาม เพราะ MIN = MAX = 10) และ "ทุกครั้ง
    // ที่ดึงค่าได้" (ในฟังก์ชัน watchPosition callback ด้านล่าง) จะถูกส่งไปบันทึกลง Google Sheet ทันที
    // ผ่าน saveReading() — ไม่รอให้ครบ 10 ครั้งก่อนแล้วค่อยบันทึกทีเดียวเหมือนเดิมอีกต่อไป
    function startTest() {
      if (samplingInProgress.value) return;

      samplingInProgress.value = true;
      readingCount.value = 0;
      savedCount.value = 0;
      failedCount.value = 0;
      lastSaveError.value = "";
      const readings = [];        // ทุกค่าที่อ่านได้ (รวม accuracy แย่ๆ ไว้ debug)
      let usableReadings = [];    // เฉพาะค่าที่ accuracy ผ่านเกณฑ์ใช้งานได้ — ใช้ตัดสินใจจริง
      let centroidHistory = [];   // weighted-average ทุกครั้งที่มีค่าที่ใช้ได้เพิ่มเข้ามา ใช้เช็คความนิ่ง

      const samplingStartTime = Date.now();
      // เริ่มนับ lastAcceptedAt จากเวลาที่กดปุ่ม เพื่อให้ค่าแรกก็ต้องรอครบ 1 วิเหมือนค่าที่เหลือ
      let lastAcceptedAt = samplingStartTime;

      let watchId = null;
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

        const best = selectBestGPS(usableReadings.length ? usableReadings : readings);
        console.log("[GPSTest] finishSampling:", {
          reason,
          totalReadings: readings.length,
          usableReadings: usableReadings.length,
          best,
        });

        if (!best) {
          alert("ไม่สามารถอ่านตำแหน่ง GPS ได้ กรุณาลองใหม่อีกครั้ง");
          return;
        }

        // ค่าทุกครั้งถูกบันทึกลง Google Sheet ไปแล้วทันทีตั้งแต่ตอนดึงได้ (ดู saveReading() ที่เรียกใน
        // watchPosition callback ด้านล่าง) ตรงนี้แค่อัปเดตแผนที่/สรุปผลด้วยจุดที่ดีที่สุดให้ดูเฉยๆ
        updateCurrentPosition(best.lat, best.lng, best.accuracy);
        alert(
          `ทดสอบเสร็จสิ้น! (เหตุผลที่หยุด: ${reason})\n` +
          `จุดที่ดีที่สุด (weighted average): ${best.lat.toFixed(6)}, ${best.lng.toFixed(6)}\n` +
          `Combined accuracy: ${best.accuracy.toFixed(1)} เมตร\n` +
          `จำนวนตัวอย่างที่ใช้: ${best.sampleCount}/${best.totalReadings} (ตัด outlier ออก ${best.rejectedOutliers})\n` +
          `สถานะ: ${isInside.value ? "อยู่ในพื้นที่" : "อยู่นอกพื้นที่"}\n` +
          `บันทึกลงชีต "${testMode.value ? "Test" : "Logs"}" สำเร็จ ${savedCount.value}/${readings.length} ครั้ง` +
          (failedCount.value > 0 ? ` (ล้มเหลว ${failedCount.value} ครั้ง: ${lastSaveError.value})` : ""),
        );
      }

      budgetTimer = setTimeout(() => finishSampling("time_budget_exceeded"), SAMPLING_TIME_BUDGET_MS);

      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const acc = pos.coords.accuracy;

          // อัปเดตตำแหน่งบนแผนที่/ตัวเลขสดทุกครั้งที่มีสัญญาณใหม่เข้ามา ไม่ต้องรอครบ 1 วิ
          updateCurrentPosition(lat, lng, acc);

          const now = Date.now();
          if (now - lastAcceptedAt < READING_INTERVAL_MS) {
            // ยังไม่ครบ 1 วินาทีนับจากค่าก่อนหน้า (หรือจากตอนกดปุ่มสำหรับค่าแรก) ข้ามค่านี้ไปก่อน
            return;
          }
          lastAcceptedAt = now;

          readings.push({ lat, lng, accuracy: acc });
          readingCount.value = readings.length;

          // ⚠️ ใหม่: บันทึกทันทีทุกครั้งที่ดึงค่าได้ (ไม่รอให้ครบ 10 ครั้ง) — ตั้งใจไม่ await ตรงนี้
          // เพื่อไม่ให้การยิง request ไปหน่วงจังหวะการดึงตำแหน่งครั้งถัดไป (ยังต้องห่างกันแค่ 1 วิ)
          // โหมด Test บันทึกทุกค่าเสมอแม้อยู่นอกกรอบ (ผ่าน addTestLog ที่ไม่ reject); โหมดปกติบันทึกลง
          // Logs ด้วย logic เดียวกับการเช็คอินจริงทุกประการ (ฝั่งเซิร์ฟเวอร์จะปฏิเสธถ้าอยู่นอกกรอบ)
          saveReading(lat, lng, acc);

          if (Number(acc) <= USABLE_ACCURACY_CEILING_M) {
            usableReadings.push({ lat, lng, accuracy: acc });
            centroidHistory.push(weightedAverage(usableReadings));
          }

          const reachedMax = readings.length >= MAX_GPS_READINGS;

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
          console.error(err);
          if (usableReadings.length > 0) {
            finishSampling("geo_error_with_partial_data");
            return;
          }
          stopWatch();
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
      testMode, savedCount, failedCount, lastSaveError,
      maxGpsReadings: MAX_GPS_READINGS, // ใช้แสดงในตัวนับ "x/10" แทนเลข 5 ที่ตายตัวเดิม
      onAreaChange, startTest, logout
    };
  }
}).mount("#app");
