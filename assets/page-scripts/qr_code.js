const { createApp, ref, computed, onMounted, nextTick, watch } = Vue;
const common = window.CheckinCommon;
createApp({
  setup() {
    const session = ref(null);
    const areas = ref([]);
    const selectedId = ref("default");
    const qrEl = ref(null);
    const qrUrl = ref("");
    const token = ref("");
    const statusType = ref("loading");
    const statusTitle = ref("กำลังโหลด...");
    const statusDesc = ref("กำลังอ่าน role และพื้นที่");
    const loading = ref(false);

    const selectedArea = computed(() => areas.value.find((a) => a.areaId === selectedId.value) || areas.value[0] || common.DEFAULT_AREA);
    const navItems = computed(() => common.getNavItems(session.value?.role, "qr_code"));
    const showLogout = computed(() => {
      const r = String(session.value?.role || "").toLowerCase();
      return r === "admin" || r === "masteradmin";
    });

    async function logout() {
      await FirebaseRole.signOut();
      location.replace("./index.html");
    }

    function nav(role) {
      const r = String(role || "user").toLowerCase();
      if (r === "user") return "./user/checkin.html";
      return "./qr_code.html";
    }

    function setStatus(type, title, desc) {
      statusType.value = type;
      statusTitle.value = title;
      statusDesc.value = desc || "";
    }

    function buildQR() {
      if (!qrEl.value || !window.QRCode) return;
      qrEl.value.innerHTML = "";
      const area = selectedArea.value;
      const url = `${location.origin}${location.pathname.replace(/[^/]*$/, "")}user/checkin.html?areaId=${encodeURIComponent(area.areaId)}&site=${encodeURIComponent(area.areaName)}`;
      const t = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())).replace(/-/g, "").slice(0, 10).toUpperCase();
      token.value = t;
      qrUrl.value = url;
      new QRCode(qrEl.value, {
        text: url,
        width: 240,
        height: 240,
        colorDark: "#172033",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M,
      });

      // อัปเดต URL ของหน้านี้ให้สะท้อน areaId ที่กำลังดูอยู่ (ไม่ reload หน้า)
      // เพื่อให้ลิงก์ที่แชร์/รีเฟรชแล้วยังกลับมาที่พื้นที่เดิม
      try {
        const newUrl = `${location.pathname}?areaId=${encodeURIComponent(area.areaId)}`;
        history.replaceState(null, "", newUrl);
      } catch (e) { /* เบราว์เซอร์บางตัวอาจไม่รองรับ ไม่เป็นไร */ }
    }

    // เมื่อผู้ใช้เปลี่ยน selectedId เอง (จาก dropdown) ให้สร้าง QR ใหม่ทันที
    watch(selectedId, () => {
      nextTick(() => buildQR());
    });

    async function reloadAreas(preserveSelection = false) {
      loading.value = true;
      try {
        const sessionInfo = await FirebaseRole.currentSession(false);
        if (!sessionInfo) {
          location.replace("./index.html");
          return;
        }
        session.value = sessionInfo;
        const raw = await common.getAreas();
        const visible = common.getVisibleAreas(raw, sessionInfo.role, sessionInfo.user.uid, sessionInfo.user.email);
        areas.value = visible.length ? visible : raw;
        if (!areas.value.length) areas.value = [common.DEFAULT_AREA];

        // กำหนดพื้นที่ที่จะแสดง: ตามลำดับความสำคัญดังนี้
        // 1) areaId จาก URL (เช่น มาจากปุ่ม "ดู QR" ของหน้า admin/setarea) — มีสิทธิ์สูงสุดเสมอ
        // 2) ถ้า preserveSelection และมี selectedId อยู่แล้ว (เช่นมาจากการกด "รีเฟรชพื้นที่") ให้คงไว้
        // 3) พื้นที่แรกในลิสต์
        const urlAreaId = new URLSearchParams(location.search).get("areaId");

        let nextSelectedId = "";
        if (urlAreaId) {
          const foundByUrl = areas.value.find(
            (a) =>
              String(a.areaId).trim() === String(urlAreaId).trim() ||
              String(a.qr_code).trim() === String(urlAreaId).trim()
          );
          if (foundByUrl) {
            nextSelectedId = foundByUrl.areaId;
          } else {
            setStatus("error", "ไม่พบพื้นที่ตามลิงก์ที่ระบุ", `areaId "${urlAreaId}" ไม่อยู่ในรายการที่คุณมีสิทธิ์เห็น ใช้พื้นที่แรกแทน`);
          }
        }

        if (!nextSelectedId && preserveSelection) {
          const stillExists = areas.value.find((a) => a.areaId === selectedId.value);
          if (stillExists) nextSelectedId = stillExists.areaId;
        }

        if (!nextSelectedId) {
          nextSelectedId = areas.value[0].areaId;
        }

        selectedId.value = nextSelectedId;

        await nextTick();
        buildQR();
        if (statusType.value !== "error") {
          setStatus("success", "QR พร้อมใช้งาน", "สแกนเพื่อเปิดหน้าผู้ใช้ตามพื้นที่ที่เลือก");
        }
      } catch (err) {
        setStatus("error", "โหลดไม่สำเร็จ", err?.message || "ลองใหม่อีกครั้ง");
      } finally {
        loading.value = false;
      }
    }

    onMounted(async () => {
      try {
        await reloadAreas(false);
      } catch (err) {
        setStatus("error", "Firebase ผิดพลาด", err?.message || "");
      }
    });

    return {
      session,
      areas,
      selectedId,
      selectedArea,
      navItems,
      qrEl,
      qrUrl,
      token,
      statusType,
      statusTitle,
      statusDesc,
      loading,
      buildQR,
      reloadAreas,
      logout,
      showLogout,
      nav,
      common,
    };
  },
  template: `
    <div class="container">
      <div class="topbar">
        <div class="brand">
          <div class="brand-badge">QR</div>
          <div>
            <h1>QR Code</h1>
            <p>สร้าง QR ให้พาไปหน้า user check-in ตามพื้นที่ที่เลือก</p>
          </div>
        </div>
        <app-tabs :items="navItems" :show-logout="showLogout" @logout="logout" />
      </div>

      <div class="qr-layout">
        <section class="card stack">
          <div class="status-bar" :class="statusType">
            <div>
              <p class="status-title">{{ statusTitle }}</p>
              <p class="status-sub">{{ statusDesc }}</p>
            </div>
            <div v-if="loading" class="spinner" style="border-top-color:#2563eb;border-color:#bfdbfe;border-top-color:#2563eb"></div>
          </div>

          <div>
            <h2>เลือกพื้นที่</h2>
            <p class="subhead">เลือก area แล้วสร้าง QR ใหม่ได้ทันที (หรือมาจากปุ่ม "ดู QR" ในหน้า Admin ได้โดยตรง)</p>
          </div>

          <div class="field">
            <label>Area</label>
            <select v-model="selectedId">
              <option v-for="a in areas" :key="a.areaId" :value="a.areaId">{{ a.areaName }} ({{ a.areaId }})</option>
            </select>
          </div>

          <div class="grid">
            <div class="span-6 field"><label>Center Lat</label><div class="code">{{ common.formatNumber(selectedArea.centerLat) }}</div></div>
            <div class="span-6 field"><label>Center Lng</label><div class="code">{{ common.formatNumber(selectedArea.centerLng) }}</div></div>
            <div class="span-3 field"><label>North</label><div class="code">{{ selectedArea.northMeters }}</div></div>
            <div class="span-3 field"><label>South</label><div class="code">{{ selectedArea.southMeters }}</div></div>
            <div class="span-3 field"><label>East</label><div class="code">{{ selectedArea.eastMeters }}</div></div>
            <div class="span-3 field"><label>West</label><div class="code">{{ selectedArea.westMeters }}</div></div>
          </div>

          <div class="actions">
            <button class="btn primary" @click="buildQR">สร้าง QR ใหม่</button>
            <button class="btn ghost" @click="reloadAreas(true)">รีเฟรชพื้นที่</button>
          </div>

          <div class="mini-note">QR นี้จะเปิดหน้า user/checkin.html พร้อม areaId ที่เลือก</div>
        </section>

        <aside class="card stack">
          <div>
            <h2>QR Preview</h2>
            <p class="subhead">สำหรับสแกนเข้าใช้งาน</p>
          </div>
          <div class="qr-box" ref="qrEl"></div>
          <div class="field">
            <label>Link</label>
            <div class="code">{{ qrUrl || '-' }}</div>
          </div>
          <div class="field">
            <label>Token</label>
            <div class="code">{{ token || '-' }}</div>
          </div>
        </aside>
      </div>
    </div>
  `
}).mount("#app");
