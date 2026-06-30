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
              // ดึงข้อมูลใหม่เสมอ ไม่ใช้ cache เก่า
              const area = await common.getArea(areaId, 15000);
              config.value = common.normalizeConfig(area);
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

              setStatus(
                "loading",
                "กำลังเช็กตำแหน่งพิกัด...",
                "ระบบกำลังเชื่อมต่อสัญญาณดาวเทียม GPS โปรดรอสักครู่",
              );

              // ตัวคุมเวลาจำกัดการค้นหาภายในฟังก์ชันตรงๆ ตัดปัญหา Timeout ค้าง
              const safetyTimer = setTimeout(() => {
                setStatus(
                  "error",
                  "ค้นหาพิกัดใช้เวลานานเกินไป",
                  "สัญญาณระบุตำแหน่งล่าช้า กรุณาเปิด Wi-Fi หรือขยับไปที่โล่งแล้วกดลองใหม่อีกครั้ง",
                );
                resolve(false);
              }, FLOW_TIMEOUT_MS);

              navigator.geolocation.getCurrentPosition(
                (pos) => {
                  clearTimeout(safetyTimer);
                  const lat = pos.coords.latitude;
                  const lng = pos.coords.longitude;
                  const accuracy = pos.coords.accuracy;

                  updateCurrentPosition(lat, lng, accuracy);

                  const inside = common.isInsideBoundary(
                    lat,
                    lng,
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

                    const payload = buildPayload(lat, lng, accuracy);
                    // เพิ่มข้อมูลเพื่อการตรวจสอบที่เข้มงวดขึ้น
                    payload.clientVerified = true;
                    payload.areaId = areaId;
                    
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
                },
                (err) => {
                  clearTimeout(safetyTimer);
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
            if (loading.value) return; // ป้องกันการกดซ้ำซ้อนซ่อนเงื่อนโดยเด็ดขาด

            loading.value = true;
            setStatus(
              "loading",
              "กำลังเริ่มตรวจสอบ...",
              "กำลังจัดเตรียมข้อมูลระบบเช็กอิน",
            );

            try {
              // 1. ถ้าหากระบบ LINE ยังไม่พร้อมใช้งานให้เริ่มต้นโหลดก่อน
              if (!liffReady.value) {
                await initLiff();
              }

              // 2. ตรวจสอบว่าล็อกอิน LINE หรือยัง
              if (!liff.isLoggedIn()) {
  setPendingFlow();
  setStatus(
    "loading",
    "กำลังเข้าสู่ระบบ LINE...",
    "แอปพลิเคชันกำลังพาคุณไปหน้าเข้าสู่ระบบ และจะพากลับมาทำงานต่ออัตโนมัติ",
  );

  try {
    liff.login({ redirectUri: getReturnUrl() });
  } catch (loginErr) {
    clearPendingFlow();
    throw loginErr;
  }

  return;
}


              // 3. ตั้งค่าผู้ใช้ที่ล็อกอินแล้ว
              authState.value = "logged_in";
              if (!profile.value) {
                profile.value = await liff.getProfile();
              }

              // 4. เริ่มประมวลผลพิกัด GPS
              await performLocationLookup();
            } catch (err) {
  console.error(err);
  clearPendingFlow();
  setStatus(
    "error",
    "เกิดข้อผิดพลาดในการประมวลผล",
    err?.message || "ระบบไม่สามารถทำงานต่อได้ กรุณาลองใหม่อีกครั้ง",
  );
} finally {

              loading.value = false; // คืนสิทธิ์เปิดให้ปุ่มกดได้เสมอ ไม่ว่าสำเร็จหรือผิดพลาดป้องกันการค้าง
            }
          }

          watch(
            boundary,
            () => {
              drawBoundary();
            },
            { deep: true },
          );

          onMounted(async () => {
            await loadConfig();
            await initLiff();
            await nextTick();
            initMap();
          });

          return {
            loading,
            profile,
            statusType,
            message,
            subMessage,
            mapEl,
            startCheckInFlow,
            authState,
            dynamicButtonText,
          };
        },

        template: `
          <div class="user-shell">
            <div class="user-card">
              <div class="user-logo">LI</div>
              <h1 class="user-title">ระบบเช็กอิน</h1>

              <div v-if="profile" class="profile-simple">
                <img v-if="profile.pictureUrl" :src="profile.pictureUrl" alt="profile" />
                <div v-else class="profile-avatar"></div>
                <p>{{ profile.displayName }}</p>
              </div>

              <div class="status-box" :class="statusType">
                <div class="status-row">
                  <p class="status-main">{{ message }}</p>
                  <span
                    class="small-pill"
                    :class="statusType === 'success' ? 'good' : (statusType === 'error' ? 'bad' : '')"
                  >
                    {{ statusType === 'success' ? 'พร้อมส่งข้อมูล' : (statusType === 'error' ? 'ตรวจสอบใหม่' : 'กำลังทำงาน') }}
                  </span>
                </div>
                <p v-if="subMessage" class="status-sub">{{ subMessage }}</p>
              </div>

              <button class="btn-massive" @click="startCheckInFlow" :disabled="loading">
                <span v-if="loading" class="mini-spinner"></span>
                {{ dynamicButtonText }}
              </button>

              <div class="hint">
                {{
                  authState === 'logged_out'
                    ? 'กดปุ่มหนึ่งครั้งเพื่อเข้าสู่ LINE แล้วระบบจะพากลับมาเช็กอินต่อให้เสร็จสิ้น'
                    : 'เมื่อเช็กอินเรียบร้อย ระบบจะนำส่งพิกัดบันทึกข้อมูลเข้า Google Sheet ทันที'
                }}
              </div>

              <div class="map-section">
                <div class="map-head">
                  <div>
                    <h2>แผนที่ตำแหน่งปัจจุบัน</h2>
                    <p>วงสีน้ำเงินคือพื้นที่ที่อนุญาต และจุด/วงกลมคือพิกัดตอนกดเช็กอิน</p>
                  </div>
                  <div class="map-badge">Live map</div>
                </div>

                <div class="map-wrap">
                  <div ref="mapEl" class="map"></div>
                </div>

                <div class="map-foot">
                  ถ้าหากแผนที่ขึ้นไม่เต็มกรอบพื้นที่ หรือพิกัดคลาดเคลื่อน กรุณากดปุ่มเพื่อเช็กอินใหม่อีกครั้ง
                </div>
              </div>
            </div>
          </div>
        `,
      }).mount("#app");
