const { createApp, computed, onMounted, ref, nextTick, watch } = Vue;
      const common = window.CheckinCommon;
      const FLOW_TIMEOUT_MS = 20000; // ปรับลดเป็น 20 วินาที เพื่อให้เช็กพิกัดได้กระชับขึ้น

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
      () => reject(new Error(message || "request_timeout")),
      ms,
    );
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timerId) clearTimeout(timerId);
  });
}

// ป้องกันเบราว์เซอร์ดึงหน้านี้จาก back/forward cache (bfcache) ตอนกดปุ่มย้อนกลับ/ไปข้างหน้า
// ถ้าเกิดเหตุการณ์นี้ ให้บังคับโหลดหน้าใหม่ทั้งหมดทันที เพื่อไม่ให้ state เก่า (พิกัด/สถานะ/โปรไฟล์เดิม) หลุดมาใช้ซ้ำ
// นี่คือสิ่งที่ผู้ใช้หมายถึงตอนพูดว่า "ห้ามจับ cache ตอนเช็คอิน"
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
          const subMessage = ref("กดปุ่มด้านล่างเพื่อเริ่มเช็กอิน");

          const query = new URLSearchParams(location.search);
          const areaId = query.get("areaId") || query.get("qr_code") || query.get("site") || "";
          const session = query.get("session") || "-";
          const site = computed(
            () => query.get("site") || config.value.siteName || config.value.areaName || "-",
          );
          const boundary = computed(() => common.buildBoundary(config.value));

          const mapEl = ref(null);
          const currentAccuracy = ref(null);
          const maxAccuracy = ref(30);
          let map = null;
          let boundaryRect = null;
          let centerMarker = null;
          let currentMarker = null;
          let currentCircle = null;

          // สร้าง Computed ข้อความบนปุ่มแบบ Dynamic เพื่อสื่อสารกับ User ชัดเจนป้องกันปุ่มค้างเงียบ
          const dynamicButtonText = computed(() => {
            if (loading.value) {
              if (authState.value === "logged_out")
                return "กำลังเชื่อมต่อ LINE...";
              if (
                statusType.value === "loading" &&
                message.value.includes("ตำแหน่ง")
              )
                return "กำลังดึงพิกัด GPS...";
              return "กำลังประมวลผลระบบ...";
            }
            return authState.value === "logged_out"
              ? "เข้าสู่ระบบ LINE เพื่อเช็กอิน"
              : "กดเช็กอินที่นี่";
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
                "โหลดค่าระบบไม่สำเร็จ",
                "ตรวจสอบการเชื่อมต่อกับ Google Sheet/Apps Script อีกครั้ง",
              );
            }
          }

          async function initLiff() {
            try {
              if (!window.liff)
                throw new Error("ไม่พบระบบพัฒนา LINE (LIFF SDK)");
              if (!common?.LIFF_ID)
                throw new Error("กรุณาตรวจสอบการตั้งค่า LIFF ID");

              await withTimeout(
                liff.init({
                  liffId: common.LIFF_ID,
                  withLoginOnExternalBrowser: true,
                }),
                LIFF_INIT_TIMEOUT_MS,
                "LIFF เริ่มทำงานช้าเกินไป",
              );

              liffReady.value = true;

              if (liff.isLoggedIn()) {
  authState.value = "logged_in";
  profile.value = await liff.getProfile();

  if (hasPendingFlow()) {
    clearPendingFlow();
    setTimeout(() => {
      startCheckInFlow();
    }, 250);
  }
} else {

                authState.value = "logged_out";
                setStatus(
                  "idle",
                  "กรุณาเข้าสู่ระบบ LINE",
                  "กดปุ่ม 'เข้าสู่ระบบ LINE เพื่อเช็กอิน' ด้านล่าง เพื่อยืนยันตัวตน",
                );
              }
            } catch (err) {
              console.error(err);
              authState.value = "logged_out";
              setStatus(
                "error",
                "ระบบเชื่อมต่อ LINE มีปัญหา",
                err?.message || "ไม่สามารถเปิดทำงานระบบระบุตัวตนของ LINE ได้",
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

          function updateCurrentPosition(lat, lng, accuracy) {
            if (!map || !window.L) return;

            currentAccuracy.value = Number(accuracy) || 0;
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

          // ปรับปรุงฟังก์ชันค้นหาพิกัดให้อยู่ในรูป Promise ปลอดภัยและคืนค่าความถูกต้องชัวร์ที่สุด
          // ใช้ Multi-Sample Averaging เพื่อให้ได้พิกัดที่นิ่งและแม่นยำขึ้น
          function performLocationLookup() {
            return new Promise((resolve) => {
              if (!navigator.geolocation) {
                setStatus(
                  "error",
                  "มือถือไม่รองรับตำแหน่ง",
                  "เครื่องนี้ไม่สามารถเรียกใช้ระบบระบุพิกัด Geolocation ได้",
                );
                return resolve(false);
              }

              const EXCELLENT_ACCURACY = 10; // ถ้า Accuracy ดีกว่า 10 เมตร ให้ผ่านทันที (ไม่ต้องรอครบ 3 ครั้ง)
              const MAX_ACCURACY = 15; // ยอมรับเฉพาะ Accuracy ที่ดีกว่า 15 เมตร
              const MAX_SAMPLES = 3;
              let samples = [];
              let sampleCount = 0;
              let watchId = null;
              let resolved = false;

              setStatus(
                "loading",
                "กำลังเช็กตำแหน่งพิกัด (ครั้งที่ 1 จาก 3)...",
                "ระบบกำลังเชื่อมต่อสัญญาณดาวเทียม GPS โปรดรอสักครู่",
              );

              // ตัวคุมเวลาจำกัดการค้นหาภายในฟังก์ชันตรงๆ ตัดปัญหา Timeout ค้าง
              const safetyTimer = setTimeout(() => {
                if (watchId !== null) {
                  navigator.geolocation.clearWatch(watchId);
                }
                if (!resolved) {
                  resolved = true;
                  setStatus(
                    "error",
                    "ค้นหาพิกัดใช้เวลานานเกินไป",
                    "สัญญาณระบุตำแหน่งล่าช้า กรุณาเปิด Wi-Fi หรือขยับไปที่โล่งแล้วกดลองใหม่อีกครั้ง",
                  );
                  resolve(false);
                }
              }, FLOW_TIMEOUT_MS);

              // ใช้ watchPosition แทน getCurrentPosition เพื่อให้ได้หลายตัวอย่างและเลือกตัวที่ดีที่สุด
              watchId = navigator.geolocation.watchPosition(
                (pos) => {
                  if (resolved) return;

                  const lat = pos.coords.latitude;
                  const lng = pos.coords.longitude;
                  const accuracy = pos.coords.accuracy;

                  // กรองเฉพาะพิกัดที่มี Accuracy ดีพอ (ไม่เกิน 15 เมตร)
                  if (accuracy <= MAX_ACCURACY) {
                    samples.push({ lat, lng, accuracy });
                    sampleCount++;
                    
                    setStatus(
                      "loading",
                      `กำลังเช็กตำแหน่งพิกัด (ครั้งที่ ${sampleCount} จาก ${MAX_SAMPLES})...`,
                      `ความแม่นยำ: ${accuracy.toFixed(1)} เมตร (ต้องน้อยกว่า 15 เมตร เพื่อความแม่นยำสูงสุด)`,
                    );

                    // ถ้า Accuracy ดีกว่า 10 เมตร ให้ผ่านทันที (ไม่ต้องรอครบ 3 ครั้ง)
                    if (accuracy <= EXCELLENT_ACCURACY) {
                      navigator.geolocation.clearWatch(watchId);
                      clearTimeout(safetyTimer);
                      resolved = true;
                      updateCurrentPosition(lat, lng, accuracy);
                      const inside = common.isInsideBoundary(lat, lng, boundary.value);
                      if (inside) {
                        setStatus("success", "📍 อยู่ในพื้นที่ทำงาน", "ตรวจสอบสำเร็จ! ระบบกำลังบันทึกข้อมูลและนำคุณไปยังหน้าถัดไป...");
                        clearPendingFlow();
                        common.clearPendingCheckin?.();
                        const payload = buildPayload(lat, lng, accuracy);
                        payload.clientVerified = true;
                        payload.areaId = areaId;
                        payload.sampleCount = 1;
                        common.setPendingCheckin(payload);
                        loading.value = true;
                        setTimeout(() => {
                          // แก้บั๊ก: เดิมพาไป ../success.html ตรงๆ ซึ่งข้าม processing.html ไปเลย
                          // ทำให้ไม่มีการเรียก common.addLog() (POST ไปยัง Apps Script) เกิดขึ้นจริง
                          // ผลคือหน้าจอแสดง "เช็กอินสำเร็จ" แต่ไม่มีแถวใหม่ถูกเขียนลงชีต Logs เลย
                          // (เคสนี้เกิดบ่อยเพราะ GPS แม่นยำ <=10 เมตรตั้งแต่ครั้งแรกได้ง่ายเมื่อสัญญาณดี)
                          // ต้องพาไป processing.html เหมือนอีก path หนึ่งเสมอ เพราะมีแค่ processing.html
                          // ที่เรียก common.addLog() จริงๆ แล้วค่อย redirect ไป success.html ต่อเมื่อบันทึกสำเร็จ
                          if (common.getPendingCheckin()) window.location.href = "../processing.html";
                        }, 300);
                      } else {
                        setStatus("error", "📍 อยู่นอกพื้นที่ทำงาน", "ตำแหน่งปัจจุบันไม่อยู่ในพื้นที่ที่ยอมรับ");
                        loading.value = false;
                      }
                      return resolve(true);
                    }

                    if (sampleCount >= MAX_SAMPLES) {
                      // หยุดการดูแลพิกัดและประมวลผลตัวอย่างที่เก็บได้
                      navigator.geolocation.clearWatch(watchId);
                      clearTimeout(safetyTimer);
                      resolved = true;

                      // คำนวณค่าเฉลี่ยของพิกัดทั้งหมด
                      const avgLat = samples.reduce((sum, s) => sum + s.lat, 0) / samples.length;
                      const avgLng = samples.reduce((sum, s) => sum + s.lng, 0) / samples.length;
                      const avgAccuracy = samples.reduce((sum, s) => sum + s.accuracy, 0) / samples.length;

                      updateCurrentPosition(avgLat, avgLng, avgAccuracy);

                      const inside = common.isInsideBoundary(
                        avgLat,
                        avgLng,
                        boundary.value,
                      );

                      if (inside) {
                        setStatus(
                          "success",
                          "📍 อยู่ในพื้นที่ทำงาน",
                          "ตรวจสอบสำเร็จ! ระบบกำลังบันทึกข้อมูลและนำคุณไปยังหน้าถัดไป...",
                        );
                        
                        // ป้องกันการกดย้ำๆ แล้วข้ามผ่าน: เคลียร์ค่าเก่าก่อนบันทึกใหม่
                        clearPendingFlow();
                        common.clearPendingCheckin?.();

                        const payload = buildPayload(avgLat, avgLng, avgAccuracy);
                        // เพิ่มข้อมูลเพื่อการตรวจสอบที่เข้มงวดขึ้น
                        payload.clientVerified = true;
                        payload.areaId = areaId;
                        payload.sampleCount = sampleCount; // บันทึกจำนวนตัวอย่างที่ใช้
                        
                        common.setPendingCheckin(payload);

                        // ล็อคปุ่มทันทีเพื่อป้องกันการกดย้ำในจังหวะเปลี่ยนหน้า
                        loading.value = true;

                        setTimeout(() => {
                          // ใช้ window.location.href แทน replace เพื่อความชัวร์ในบาง browser
                          // และตรวจสอบอีกครั้งว่า payload ยังอยู่
                          if (common.getPendingCheckin()) {
                             window.location.href = "../processing.html";
                          } else {
                             loading.value = false;
                             resolve(false);
                          }
                        }, 800);
                      } else {
                        clearPendingFlow();
                        common.clearPendingCheckin?.();
                        setStatus(
                          "error",
                          "❌ อยู่นอกพื้นที่ทำงาน",
                          "กรุณาเดินเข้ามาในเขตกรอบพื้นที่สีน้ำเงินที่กำหนดบนแผนที่ แล้วกดเช็กอินใหม่อีกครั้ง",
                        );
                        resolve(false);
                      }
                    }
                  } else {
                    // ถ้า Accuracy ไม่ดีพอ ให้ข้ามไปและรอตัวอย่างถัดไป
                    setStatus(
                      "loading",
                      `กำลังเช็กตำแหน่งพิกัด (รอสัญญาณที่ดีขึ้น)...`,
                      `ความแม่นยำปัจจุบัน: ${accuracy.toFixed(1)} เมตร (พื้นที่นี้กำหนดไว้ไม่เกิน ${maxAccuracy.value} เมตร)`,
                    );
                  }
                },
                (err) => {
                  if (watchId !== null) {
                    navigator.geolocation.clearWatch(watchId);
                  }
                  clearTimeout(safetyTimer);
                  if (!resolved) {
                    resolved = true;
                    clearPendingFlow();
                    console.error("Geolocation Error Logged:", err);

                    let detail =
                      "กรุณาเปิดบริการตำแหน่งที่ตั้ง (Location Services/GPS) บนอุปกรณ์ของท่านก่อนใช้งาน";
                    if (err?.code === 1) {
                      detail =
                        "สิทธิ์การเข้าถึงตำแหน่งถูกปฏิเสธ! กรุณาเข้าไปที่ตั้งค่ามือถือเพื่อเปิดอนุญาตตำแหน่งสำหรับแอป LINE/Safari";
                    } else if (err?.code === 2) {
                      detail =
                        "ไม่สามารถจับสัญญาณพิกัดพื้นที่ได้ชั่วคราว ลองเปิด Wi-Fi หรือปิด-เปิดตำแหน่งในเครื่องใหม่";
                    } else if (err?.code === 3) {
                      detail =
                        "เวลาการค้นหาตำแหน่งหมดเกลี่ยลง กรุณากดปุ่มเพื่อลองอีกครั้ง";
                    }

                    setStatus("error", "ไม่สามารถหาพิกัดตำแหน่งได้", detail);
                    resolve(false);
                  }
                },
                {
                  enableHighAccuracy: true,  // บังคับใช้ GPS แม่นยำสูง ไม่ใช้ WiFi/network location
                  timeout: 15000,
                  maximumAge: 0,  // ห้ามใช้ตำแหน่งที่แคชไว้ ต้องอ่านพิกัดปัจจุบันจากอุปกรณ์เท่านั้นทุกครั้ง
                },
              );
            });
          }

          async function startCheckInFlow() {
            if (loading.value) return;
            loading.value = true;

            try {
              const result = await performLocationLookup();
              if (!result) {
                loading.value = false;
              }
            } catch (err) {
              console.error("Check-in flow error:", err);
              setStatus(
                "error",
                "เกิดข้อผิดพลาดในระหว่างเช็กอิน",
                err?.message || "กรุณาลองใหม่อีกครั้ง",
              );
              loading.value = false;
            }
          }

          onMounted(async () => {
            try {
              await loadConfig();
              await initLiff();
              // Wait for DOM to be ready before initializing map
              await nextTick();
              initMap();
            } catch (err) {
              console.error("Mount error:", err);
              setStatus(
                "error",
                "ไม่สามารถเตรียมระบบได้",
                "กรุณารีเฟรชหน้าและลองใหม่อีกครั้ง",
              );
            }
          });

          // Re-initialize map when authState changes (after LIFF login)
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
            currentAccuracy,
            maxAccuracy,
            startCheckInFlow,
            performLocationLookup,
          };
        },
      }).mount("#app");
