const { createApp, onMounted, ref } = Vue;
      const common = window.CheckinCommon;

      // ป้องกัน bfcache เด้งกลับมาแสดงสถานะ "กำลังประมวลผล" เดิมที่ค้างอยู่ตอนกดปุ่มย้อนกลับ
      window.addEventListener("pageshow", (event) => {
        if (event.persisted) {
          window.location.reload();
        }
      });

      createApp({
        setup() {
          const status = ref("กำลังบันทึกข้อมูล...");
          const detail = ref("กรุณารอสักครู่");
          const tagClass = ref("");
          const debug = ref("");
          const lastCheckin = ref(null);

          async function run() {
            sessionStorage.removeItem("checkin_flow_running");
            try {
              const payload = common.getPendingCheckin();
              if (!payload) throw new Error("ไม่พบข้อมูลเช็กอิน กรุณาเริ่มใหม่");
              debug.value = JSON.stringify(payload);
              lastCheckin.value = payload;
              const res = await common.addLog(payload, 30000);
              
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
              setTimeout(() => { window.location.replace("./success.html"); }, 900);
            } catch (err) {
              console.error(err);
              const payload = common.getPendingCheckin();
              if (payload) {
                localStorage.setItem("last_failed_checkin", JSON.stringify({
                  ...payload,
                  failedAt: new Date().toISOString(),
                  error: err?.message || "เกิดข้อผิดพลาด",
                }));
              }
              status.value = "บันทึกข้อมูลไม่สำเร็จ";
              detail.value = err?.message || "เกิดข้อผิดพลาด";
              tagClass.value = "error";
            }
          }
          onMounted(run);
          return { status, detail, tagClass, debug, lastCheckin, common };
        },
        template: `
          <div class="wrap">
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
              <a class="btn" href="./user/checkin.html">กลับไปหน้าเช็กอิน</a>
            </div>
          </div>
        `,
      }).mount("#app");
