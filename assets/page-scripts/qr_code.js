const { createApp, ref, computed, onMounted, nextTick, watch } = Vue;
const common = window.CheckinCommon;
createApp({
  setup() {
    const session = ref(null);
    const areas = ref([]);
    const selectedId = ref("");
    const qrEl = ref(null);
    const qrUrl = ref("");
    const token = ref("");
    const statusType = ref("loading");
    const statusTitle = ref("กำลังโหลด...");
    const statusDesc = ref("กำลังอ่าน role และพื้นที่");
    const loading = ref(false);

    const selectedArea = computed(() => {
      const id = String(selectedId.value || "").trim();
      if (id) {
        const matched = common.findAreaById
          ? common.findAreaById(areas.value, id)
          : areas.value.find((a) => a.areaId === id || a.qr_code === id);
        if (matched) return matched;
      }
      
      // ถ้ามี areaId ใน URL แต่หาไม่เจอในลิสต์ (อาจจะเพราะเพิ่งบันทึกแล้ว cache ยังไม่อัปเดต)
      // ให้พยายามหาจากลิสต์ทั้งหมดอีกรอบก่อนจะ fallback
      const urlAreaId = new URLSearchParams(location.search).get("areaId");
      if (urlAreaId && !id) return null;

      return areas.value[0] || null;
    });

    const displayMetrics = computed(() => {
      const area = selectedArea.value;
      if (!area) return common.areaDisplayMetrics(common.DEFAULT_AREA);
      return common.areaDisplayMetrics
        ? common.areaDisplayMetrics(area)
        : {
            centerLat: area.centerLat ?? area.lat,
            centerLng: area.centerLng ?? area.lng,
            northMeters: area.northMeters ?? area.north,
            southMeters: area.southMeters ?? area.south,
            eastMeters: area.eastMeters ?? area.east,
            westMeters: area.westMeters ?? area.west,
          };
    });
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
      const area = selectedArea.value;
      if (!area) {
        setStatus("error", "ยังไม่มีพื้นที่", "กรุณาตั้งค่าพื้นที่ในหน้า SetArea ก่อน");
        return;
      }
      qrEl.value.innerHTML = "";
      const url = `${location.origin}${location.pathname.replace(/[^/]*$/, "")}user/checkin.html?areaId=${encodeURIComponent(area.areaId || area.qr_code || "")}&site=${encodeURIComponent(area.areaName || area.remark || "")}`;
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
          FirebaseRole.redirectToLogin();
          return;
        }
        session.value = sessionInfo;

        if (typeof common.invalidateAreaCache === "function") {
          common.invalidateAreaCache();
        }
        const raw = await common.getAreas(15000, true);
        const uid = sessionInfo.user?.uid || sessionInfo.uid || "";
        const email = sessionInfo.user?.email || sessionInfo.email || "";
        const visible = common.getVisibleAreas(raw, sessionInfo.role, uid, email);
        const urlAreaId = new URLSearchParams(location.search).get("areaId");
        const urlArea = urlAreaId && common.findAreaById
          ? common.findAreaById(raw, urlAreaId)
          : raw.find(
              (a) =>
                String(a.areaId || "").trim() === String(urlAreaId || "").trim() ||
                String(a.qr_code || "").trim() === String(urlAreaId || "").trim(),
            );

        let nextAreas = visible.length ? visible : raw;
        if (urlArea) {
          const alreadyListed = nextAreas.some(
            (a) => String(a.areaId || "").trim() === String(urlArea.areaId || "").trim(),
          );
          if (!alreadyListed) {
            nextAreas = [urlArea, ...nextAreas];
          }
        }
        areas.value = nextAreas;

        let nextSelectedId = "";
        if (urlArea) {
          nextSelectedId = urlArea.areaId || urlArea.qr_code || "";
        } else if (preserveSelection && selectedId.value) {
          const stillExists = common.findAreaById
            ? common.findAreaById(areas.value, selectedId.value)
            : areas.value.find((a) => a.areaId === selectedId.value);
          if (stillExists) nextSelectedId = stillExists.areaId;
        }

        if (!nextSelectedId && areas.value.length) {
          nextSelectedId = areas.value[0].areaId || areas.value[0].qr_code || "";
        }

        if (!areas.value.length) {
          setStatus("error", "ยังไม่มีพื้นที่", "กรุณาบันทึกพื้นที่ในหน้า SetArea ก่อน");
          selectedId.value = "";
          return;
        }

        if (urlAreaId && !urlArea) {
          setStatus(
            "error",
            "ไม่พบพื้นที่ตามลิงก์",
            `areaId "${urlAreaId}" ไม่มีใน Google Sheet — ลองรีเฟรชหรือบันทึกพื้นที่ใน SetArea อีกครั้ง`,
          );
        }

        selectedId.value = nextSelectedId;

        await nextTick();
        buildQR();
        if (statusType.value !== "error") {
          setStatus("success", "QR พร้อมใช้งาน", `พื้นที่: ${selectedArea.value?.areaName || selectedArea.value?.remark || nextSelectedId}`);
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
      displayMetrics,
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
            <div class="span-6 field"><label>Center Lat</label><div class="code">{{ common.formatNumber(displayMetrics.centerLat) }}</div></div>
            <div class="span-6 field"><label>Center Lng</label><div class="code">{{ common.formatNumber(displayMetrics.centerLng) }}</div></div>
            <div class="span-3 field"><label>North</label><div class="code">{{ displayMetrics.northMeters }}</div></div>
            <div class="span-3 field"><label>South</label><div class="code">{{ displayMetrics.southMeters }}</div></div>
            <div class="span-3 field"><label>East</label><div class="code">{{ displayMetrics.eastMeters }}</div></div>
            <div class="span-3 field"><label>West</label><div class="code">{{ displayMetrics.westMeters }}</div></div>
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
