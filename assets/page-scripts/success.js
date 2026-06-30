const { createApp, ref, onMounted } = Vue;
      const common = window.CheckinCommon;

      // ป้องกัน bfcache เด้งกลับมาแสดงหน้า "สำเร็จ" เดิมตอนกดปุ่มย้อนกลับ
      window.addEventListener("pageshow", (event) => {
        if (event.persisted) {
          window.location.reload();
        }
      });

      createApp({
        setup() {
          const status = ref("กำลังโหลดข้อมูล...");
          const lastCheckin = ref(null);
          onMounted(() => {
            sessionStorage.removeItem("checkin_flow_running");
            try {
              const raw = localStorage.getItem("last_checkin");
              if (raw) lastCheckin.value = JSON.parse(raw);
              status.value = "เช็กอินสำเร็จ";
            } catch (err) {
              console.error(err);
              status.value = "เช็กอินสำเร็จ";
            }
          });
          return { status, lastCheckin, common };
        },
        template: `
          <div class="container">
            <div class="card">
              <div class="icon">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </div>
              <div class="tag">{{ status }}</div>
              <h1 style="margin:0 0 12px;font-size:22px;font-weight:800;color:#0f172a;">บันทึกข้อมูลเรียบร้อยแล้ว</h1>
              <p class="muted" style="margin:0 0 8px;font-size:14px;">ระบบเช็กอินเสร็จสมบูรณ์แล้ว</p>
              <div v-if="lastCheckin" class="row muted" style="font-size:14px;">
                <div>ชื่อ: {{ lastCheckin.name || '-' }}</div>
                <div v-if="lastCheckin.email">Email: {{ lastCheckin.email }}</div>
                <div>เวลา: {{ lastCheckin.timeText || common.formatDate(lastCheckin.time) }}</div>
              </div>
              <a class="btn" href="./user/checkin.html">เช็กอินอีกครั้ง</a>
            </div>
          </div>
        `,
      }).mount("#app");
