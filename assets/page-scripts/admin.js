const { createApp, ref, computed, onMounted, nextTick, onBeforeUnmount } = Vue;

const common = window.CheckinCommon;

createApp({
  setup() {
    const session = ref(null);
    const areas = ref([]);
    const loading = ref(false);
    const statusType = ref("loading");
    const statusTitle = ref("กำลังโหลด...");
    const statusDesc = ref("กำลังอ่าน role และข้อมูลพื้นที่");
    const selectedId = ref("");
    const mapEl = ref(null);

    let map = null;
    let markers = [];
    let selectedMarker = null;
    let areaRect = null;

    const DEFAULT_CENTER = [13.7563, 100.5018];
    const DEFAULT_ZOOM = 13;

    const selectedArea = computed(
      () => areas.value.find((a) => a.areaId === selectedId.value) || areas.value[0] || null
    );

    const navItems = computed(() => common.getNavItems(session.value?.role, "admin"));

    function setStatus(type, title, desc) {
      statusType.value = type;
      statusTitle.value = title;
      statusDesc.value = desc || "";
    }

    function nav(role) {
      const r = String(role || "user").toLowerCase();
      if (r === "user") return "./user/checkin.html";
      return "./qr_code.html";
    }

    function initMap() {
      if (map || !mapEl.value || !window.L) return;

      map = L.map(mapEl.value, {
        zoomControl: true,
      }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      map.whenReady(() => {
        setTimeout(() => {
          try {
            map.invalidateSize();
          } catch (e) { }
        }, 50);
      });
    }

    function clearMarkers() {
      markers.forEach((m) => {
        try {
          m.remove();
        } catch (e) { }
      });
      markers = [];

      if (selectedMarker) {
        try {
          selectedMarker.remove();
        } catch (e) { }
        selectedMarker = null;
      }

      if (areaRect) {
        try {
          areaRect.remove();
        } catch (e) { }
        areaRect = null;
      }
    }

    function focusArea(area) {
      if (!map || !area || !window.L) return;

      const b = common.buildBoundary(area);
      if (!b) return;

      selectedId.value = area.areaId;
      clearMarkers();

      const bounds = [
        [b.minLat, b.minLng],
        [b.maxLat, b.maxLng],
      ];

      areaRect = L.rectangle(bounds, {
        color: "#2563eb",
        weight: 2,
        fillColor: "#2563eb",
        fillOpacity: 0.1,
      }).addTo(map);

      selectedMarker = L.marker([b.centerLat, b.centerLng])
        .addTo(map)
        .bindPopup(`<b>${area.areaName}</b><br/>${area.areaId}`);

      selectedMarker.openPopup();

      try {
        map.fitBounds(bounds, { padding: [30, 30] });
      } catch (e) {
        try {
          map.setView([b.centerLat, b.centerLng], 17);
        } catch (err) { }
      }
    }

    function renderTableFocus() {
      const area = selectedArea.value;
      if (area) focusArea(area);
    }

    async function loadData() {
      loading.value = true;

      try {
        const info = await FirebaseRole.currentSession(false);

        if (!info) {
          location.replace("./index.html");
          return;
        }

        session.value = info;

        if (info.role === "user") {
          location.replace("./user/checkin.html");
          return;
        }

        const raw = await common.getAreas();
        const visible = common.getVisibleAreas(raw, info.role, info.user.uid, info.user.email);

        areas.value = visible.length ? visible : raw;
        selectedId.value = areas.value[0]?.areaId || "";

        setStatus("success", "โหลดข้อมูลเรียบร้อย", `พบพื้นที่ ${areas.value.length} รายการ`);

        await nextTick();
        initMap();

        if (areas.value.length) {
          focusArea(areas.value[0]);
        }
      } catch (err) {
        console.error(err);
        setStatus("error", "โหลดไม่สำเร็จ", err?.message || "ลองใหม่อีกครั้ง");
      } finally {
        loading.value = false;
      }
    }

    async function logout() {
      await FirebaseRole.signOut();
      location.replace("./index.html");
    }

    function handleResize() {
      if (!map) return;
      try {
        map.invalidateSize();
      } catch (e) { }
    }

    onMounted(async () => {
      try {
        await loadData();

        if (!map) {
          await nextTick();
          initMap();

          if (selectedArea.value) {
            focusArea(selectedArea.value);
          }
        }

        window.addEventListener("resize", handleResize);
      } catch (err) {
        console.error(err);
        setStatus("error", "Firebase ผิดพลาด", err?.message || "");
      }
    });

    onBeforeUnmount(() => {
      window.removeEventListener("resize", handleResize);

      try {
        if (map) {
          map.remove();
        }
      } catch (e) { }

      map = null;
      markers = [];
      selectedMarker = null;
      areaRect = null;
    });

    return {
      session,
      areas,
      loading,
      statusType,
      statusTitle,
      statusDesc,
      selectedId,
      selectedArea,
      navItems,
      mapEl,
      focusArea,
      renderTableFocus,
      logout,
      nav,
      common,
    };
  },

  template: `
    <div class="container">
      <div class="topbar">
        <div class="brand">
          <div class="brand-badge">AD</div>
          <div>
            <h1>Admin Dashboard</h1>
            <p>ตารางพื้นที่ + แผนที่ + ปุ่มไปหน้า QR Code</p>
          </div>
        </div>
        <app-tabs :items="navItems" />
      </div>

      <div class="admin-grid">
        <section class="card stack">
          <div class="status-bar" :class="statusType">
            <div>
              <p class="status-title">{{ statusTitle }}</p>
              <p class="status-sub">{{ statusDesc }}</p>
            </div>
            <div
              v-if="loading"
              class="spinner"
              style="border-top-color:#2563eb;border-color:#bfdbfe;border-top-color:#2563eb"
            ></div>
          </div>

          <div class="toolbar">
            <div>
              <h2 style="margin:0">พื้นที่ทั้งหมด</h2>
              <p class="page-subtitle">คลิกแถวเพื่อให้แผนที่วิ่งไปที่จุดนั้น</p>
            </div>
            <div class="row">
              <span class="pill-sm">Role: {{ session?.role || '-' }}</span>
              <span class="pill-sm">UID: {{ session?.user?.uid || '-' }}</span>
            </div>
          </div>

          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>ชื่อพื้นที่</th>
                  <th>พิกัด</th>
                  <th>การมองเห็น</th>
                  <th>สถานะ</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="a in areas"
                  :key="a.areaId"
                  class="click-row"
                  @click="focusArea(a)"
                >
                  <td>
                    <b>{{ a.areaName }}</b><br/>
                    <span class="muted small">{{ a.areaId }}</span><br/>
                    <span class="muted small">{{ a.note }}</span>
                  </td>
                  <td class="small">
                    Lat {{ common.formatNumber(a.centerLat) }}<br/>
                    Lng {{ common.formatNumber(a.centerLng) }}
                  </td>
                  <td class="small">
                    Roles: {{ a.visibleRoles || '-' }}<br/>
                    UIDs: {{ a.visibleUsers || '-' }}
                  </td>
                  <td>
                    <span
                      class="pill-sm"
                      :style="{
                        background: a.active===false ? '#fef2f2' : '#ecfdf3',
                        color: a.active===false ? '#b91c1c' : '#047857'
                      }"
                    >
                      {{ a.active===false ? 'inactive' : 'active' }}
                    </span>
                  </td>
                  <td>
                    <div class="actions">
                      <a
                        v-if="!String(a.areaId || '').startsWith('__legacy-no-id-')"
                        class="btn ghost"
                        :href="'./qr_code.html?areaId=' + encodeURIComponent(a.areaId)"
                        @click.stop
                      >
                        ดู QR
                      </a>
                      <span
                        v-else
                        class="btn ghost"
                        style="opacity:.5;cursor:not-allowed"
                        title="พื้นที่นี้ยังไม่มีรหัส qr_code กรุณาบันทึกใหม่ในหน้า SetArea ก่อน"
                        @click.stop.prevent
                      >
                        ดู QR
                      </span>
                      <a
                        v-if="session?.role === 'masteradmin'"
                        class="btn primary"
                        href="./setarea.html"
                        @click.stop
                      >
                        SetArea
                      </a>
                    </div>
                  </td>
                </tr>

                <tr v-if="!areas.length">
                  <td colspan="5" class="text-center text-muted py-4">
                    ไม่มีข้อมูลพื้นที่
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="mini-note">
            Masteradmin เห็นทุกอย่างและเข้า SetArea/Users ได้ ส่วน admin เห็นหน้าตารางกับแผนที่เหมือนกัน แต่ปุ่ม SetArea จะไม่แสดง
          </div>
        </section>

        <aside class="card stack">
          <div>
            <h2>Map</h2>
            <p class="page-subtitle">กดแถวในตารางเพื่อ fly ไปที่ตำแหน่งนั้น</p>
          </div>

          <div class="map-wrap" ref="mapEl"></div>

          <div v-if="selectedArea" class="inline-note">
            <b>{{ selectedArea.areaName }}</b><br/>
            {{ selectedArea.note }}<br/>
            Center: {{ common.formatNumber(selectedArea.centerLat) }}, {{ common.formatNumber(selectedArea.centerLng) }}
          </div>
        </aside>
      </div>
    </div>
  `,
}).mount("#app");