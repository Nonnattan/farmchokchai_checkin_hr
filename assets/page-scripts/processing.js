const { createApp, onMounted, ref } = Vue;
      const common = window.CheckinCommon;
      const utils = window.EnhancedUtils; // ⚠️ ENHANCED: อาจไม่มีถ้าโหลดสคริปต์ไม่สำเร็จ ต้อง guard ทุกจุดที่ใช้

      // ป้องกัน bfcache เด้งกลับมาแสดงสถานะ "กำลังประมวลผล" เดิมที่ค้างอยู่ตอนกดปุ่มย้อนกลับ
      window.addEventListener("pageshow", (event) => {
        if (event.persisted) {
          window.location.reload();
        }
      });

      // ⚠️ ENHANCED: ตรวจสอบว่า error เป็นประเภท timeout หรือไม่ (ใช้ตัดสินใจว่าจะเปิด Dialog หรือไม่)
      function isTimeoutLikeError(err, normalizedErr) {
        if (normalizedErr && (normalizedErr.type === 'timeout_error' || normalizedErr.type === 'gps_timeout')) return true;
        const msg = String(err?.message || '').toLowerCase();
        return msg.includes('timeout') || msg.includes('หมดเวลา');
      }

      createApp({
        setup() {
          const status = ref("กำลังบันทึกข้อมูล...");
          const detail = ref("กรุณารอสักครู่");
          const tagClass = ref("");
          const debug = ref("");
          const lastCheckin = ref(null);

          // ⚠️ ENHANCED: กันการกดปุ่ม "ลองใหม่" ซ้ำระหว่างที่ยังบันทึกข้อมูลอยู่
          const submitting = ref(false);

          // ⚠️ ENHANCED: Timeout/Error Dialog แบบ Modal พร้อมปุ่ม "ลองใหม่"
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

          async function run() {
            // ⚠️ ENHANCED: ป้องกันการกดปุ่ม "ลองใหม่" ซ้ำจนเรียก addLog ซ้อนกัน
            if (submitting.value) return;
            submitting.value = true;

            sessionStorage.removeItem("checkin_flow_running");
            status.value = "กำลังบันทึกข้อมูล...";
            detail.value = "กรุณารอสักครู่";
            tagClass.value = "";

            try {
              const payload = common.getPendingCheckin();
              if (!payload) throw new Error("ไม่พบข้อมูลเช็กอิน กรุณาเริ่มใหม่");
              debug.value = JSON.stringify(payload);
              lastCheckin.value = payload;

              // ⚠️ ENHANCED: ตรวจสอบ Internet ก่อนเริ่มบันทึกข้อมูล (ถ้ามี utils โหลดสำเร็จ)
              if (utils && typeof utils.checkInternetConnectivity === "function") {
                status.value = "กำลังตรวจสอบการเชื่อมต่อ...";
                const isOnline = await utils.checkInternetConnectivity(5000);
                if (!isOnline) {
                  throw new Error("ไม่มีการเชื่อมต่อ Internet กรุณาตรวจสอบ WiFi หรือ Mobile Data");
                }
              }

              status.value = "กำลังบันทึกข้อมูล...";
              const res = await common.addLog(payload, 30000); // ⚠️ Timeout 30 วินาที (คงค่าเดิม)

              if (res && res.ok === false) {
                throw new Error(res.err || res.error || res.message || "Server ปฏิเสธการบันทึกข้อมูล");
              }

              localStorage.setItem("last_checkin", JSON.stringify({
                ...payload,
                savedAt: new Date().toISOString(),
                response: res || null,
                timeText: common.formatDate(payload.time),
              }));
              common.clearPendingCheckin();
              status.value = "บันทึกข้อมูลสำเร็จ";
              detail.value = "ระบบกำลังพาคุณไปหน้าสำเร็จ";
              tagClass.value = "ok";
              submitting.value = false;
              setTimeout(() => { window.location.replace("./success.html"); }, 900);
            } catch (err) {
              console.error(err);
              submitting.value = false;

              const payload = common.getPendingCheckin();
              if (payload) {
                localStorage.setItem("last_failed_checkin", JSON.stringify({
                  ...payload,
                  failedAt: new Date().toISOString(),
                  error: err?.message || "เกิดข้อผิดพลาด",
                }));
              }

              // ⚠️ ENHANCED: รวม Error ทั้งหมดให้อยู่ในรูปแบบเดียวกัน (ถ้ามี utils)
              const normalizedErr = (utils && typeof utils.normalizeError === "function")
                ? utils.normalizeError(err, "processing")
                : { title: "บันทึกข้อมูลไม่สำเร็จ", message: err?.message || "เกิดข้อผิดพลาด" };

              status.value = normalizedErr.title || "บันทึกข้อมูลไม่สำเร็จ";
              detail.value = normalizedErr.message || err?.message || "เกิดข้อผิดพลาด";
              tagClass.value = "error";

              // ⚠️ ENHANCED: หมดเวลา → ยกเลิก Loading และแสดง Dialog พร้อมปุ่ม "ลองใหม่"
              if (isTimeoutLikeError(err, normalizedErr)) {
                openTimeoutDialog(normalizedErr.title, normalizedErr.message, () => {
                  run();
                });
              }
            }
          }

          function retry() {
            if (submitting.value) return;
            run();
          }

          onMounted(run);
          return {
            status, detail, tagClass, debug, lastCheckin, common,
            submitting, retry,
            timeoutDialog, handleTimeoutDialogRetry,
          };
        },
        template: `
          <div class="wrap">
            <!-- ⚠️ ENHANCED: Timeout/Error Dialog แบบ Modal พร้อมปุ่ม "ลองใหม่" -->
            <div v-if="timeoutDialog.visible" class="timeout-dialog-overlay">
              <div class="timeout-dialog">
                <div class="timeout-dialog-icon">⏱️</div>
                <h3>{{ timeoutDialog.title }}</h3>
                <p>{{ timeoutDialog.message }}</p>
                <div class="timeout-dialog-actions">
                  <button class="btn-retry" @click="handleTimeoutDialogRetry">🔄 ลองใหม่</button>
                </div>
              </div>
            </div>

            <div class="card">
              <div :class="['pill', tagClass]">{{ status }}</div>
              <div class="spinner" v-if="tagClass === ''"></div>
              <h1 class="title">{{ status }}</h1>
              <p class="muted">{{ detail }}</p>
              <div v-if="lastCheckin" class="detail-box small">
                <div><b>ชื่อ:</b> {{ lastCheckin.name || '-' }}</div>
                <div><b>อีเมล:</b> {{ lastCheckin.email || '-' }}</div>
                <div><b>เวลา:</b> {{ common.formatDate(lastCheckin.time) }}</div>
              </div>
              <!-- ⚠️ ENHANCED: ปุ่ม "ลองใหม่" เมื่อบันทึกข้อมูลไม่สำเร็จ (Disable ระหว่างกำลังส่งซ้ำ) -->
              <button
                v-if="tagClass === 'error'"
                class="btn"
                style="margin-right:8px;"
                :disabled="submitting"
                @click="retry"
              >{{ submitting ? 'กำลังลองใหม่...' : '🔄 ลองใหม่' }}</button>
              <a class="btn" href="./user/checkin.html">กลับไปหน้าเช็กอิน</a>
            </div>
          </div>
        `,
      }).mount("#app");
