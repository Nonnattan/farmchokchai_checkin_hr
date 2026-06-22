
const { createApp, ref, computed, onMounted, nextTick, watch } = Vue;
const common = window.CheckinCommon;

function createAreaDraft(source) {
  const area = common.normalizeArea(source || common.DEFAULT_AREA);
  return {
    ...area,
    areaName: String(source?.areaName || area.areaName || "Area").trim(),
    visibleRoles: String(source?.visibleRoles || area.visibleRoles || "masteradmin,admin,user").trim(),
    visibleUsers: String(source?.visibleUsers || area.visibleUsers || "").trim(),
  };
}

createApp({
  setup() {
    const session = ref(null);
    const areas = ref([]);
    const selectedId = ref("");
    const editing = ref(createAreaDraft(common.DEFAULT_AREA));
    const loading = ref(false);
    const saving = ref(false);
    const statusType = ref("loading");
    const statusTitle = ref("กำลังโหลด...");
    const statusDesc = ref("กำลังตรวจสอบสิทธิ์และอ่านพื้นที่");
    const mapEl = ref(null);

    const navItems = computed(() => common.getNavItems(session.value?.role || "masteradmin", "setarea"));
    const selectedArea = computed(() => areas.value.find((a) => a.areaId === selectedId.value) || areas.value[0] || null);
    const totalAreas = computed(() => areas.value.length);

    let map = null;
    let areaRect = null;
    let centerMarker = null;
    let dragUpdating = false;

    function setStatus(type, title, desc) {
      statusType.value = type;
      statusTitle.value = title;
      statusDesc.value = desc || "";
    }

    function cloneToEditing(area) {
      editing.value = createAreaDraft(area);
    }

    function ensureId() {
      const seed = Date.now().toString(36);
      return `area_${seed}`;
    }

    function pickArea(area) {
      if (!area) return;
      selectedId.value = area.areaId;
      cloneToEditing(area);
      refreshMap(true);
      setStatus("success", "เลือกพื้นที่แล้ว", `กำลังแก้ไข ${area.areaName}`);
    }

    function newArea() {
      const draft = createAreaDraft({
        ...common.DEFAULT_AREA,
        areaId: ensureId(),
        areaName: "New Area",
        visibleRoles: "masteradmin,admin,user",
        visibleUsers: "",
      });
      selectedId.value = draft.areaId;
      editing.value = draft;
      refreshMap(true);
      setStatus("loading", "สร้างพื้นที่ใหม่", "กรอกข้อมูลแล้วกดบันทึก");
    }

    async function loadSession() {
      const info = await FirebaseRole.currentSession(false);
      if (!info) {
        location.replace("./index.html");
        return false;
      }
      session.value = info;
      if (String(info.role || "").toLowerCase() !== "masteradmin") {
        location.replace(FirebaseRole.homeRoute(info.role));
        return false;
      }
      return true;
    }

    async function loadAreas() {
      loading.value = true;
      setStatus("loading", "กำลังโหลดพื้นที่", "อ่านข้อมูลจาก Apps Script");
      try {
        const list = await common.getAreas();
        areas.value = Array.isArray(list) && list.length ? list : [common.normalizeArea(common.DEFAULT_AREA)];
        const first = areas.value.find((a) => a.areaId === selectedId.value) || areas.value[0];
        selectedId.value = first?.areaId || "";
        if (first) cloneToEditing(first);
        setStatus("success", "โหลดสำเร็จ", `พบพื้นที่ทั้งหมด ${areas.value.length} รายการ`);
        await nextTick();
        initMap();
        refreshMap(true);
      } catch (err) {
        console.error(err);
        setStatus("error", "โหลดไม่สำเร็จ", err?.message || "อ่านข้อมูลพื้นที่ไม่ได้");
      } finally {
        loading.value = false;
      }
    }

    function escapeHtml(value) {
      return String(value || "").replace(/[&<>"']/g, (ch) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[ch]));
    }

    function initMap() {
      if (map || !mapEl.value || !window.L) return;
      map = L.map(mapEl.value, { zoomControl: true });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      map.on("click", (e) => {
        if (!editing.value) return;
        editing.value.centerLat = Number(e.latlng.lat.toFixed(6));
        editing.value.centerLng = Number(e.latlng.lng.toFixed(6));
        refreshMap(false);
        setStatus("loading", "ย้ายศูนย์กลางแล้ว", "กดบันทึกเพื่ออัปเดตลงชีต");
      });
    }

    function refreshMap(fit = false) {
      if (!map || !editing.value || !window.L) return;
      const b = common.buildBoundary(editing.value);
      const bounds = [
        [b.minLat, b.minLng],
        [b.maxLat, b.maxLng],
      ];

      if (!areaRect) {
        areaRect = L.rectangle(bounds, {
          color: "#2563eb",
          weight: 2,
          fillColor: "#2563eb",
          fillOpacity: 0.10,
        }).addTo(map);
      } else {
        areaRect.setBounds(bounds);
      }

      if (!centerMarker) {
        centerMarker = L.marker([b.centerLat, b.centerLng], { draggable: true }).addTo(map);
        centerMarker.bindPopup(`<b>${escapeHtml(editing.value.areaName)}</b><br/>${escapeHtml(editing.value.areaId)}`);

        centerMarker.on("dragstart", () => {
          dragUpdating = true;
        });

        centerMarker.on("dragend", () => {
          const latlng = centerMarker.getLatLng();
          editing.value.centerLat = Number(latlng.lat.toFixed(6));
          editing.value.centerLng = Number(latlng.lng.toFixed(6));
          dragUpdating = false;
          setStatus("loading", "ย้าย marker แล้ว", "กดบันทึกเพื่อเก็บค่าตำแหน่งใหม่");
        });
      } else {
        centerMarker.setLatLng([b.centerLat, b.centerLng]);
      }

      if (centerMarker) {
        const popup = centerMarker.getPopup();
        if (popup) {
          popup.setContent(`<b>${escapeHtml(editing.value.areaName)}</b><br/>${escapeHtml(editing.value.areaId)}`);
        }
      }

      if (fit) {
        map.fitBounds(bounds, { padding: [32, 32] });
      }
    }

    async function save() {
      try {
        if (!editing.value.areaId) throw new Error("กรุณาใส่ areaId");
        saving.value = true;
        setStatus("loading", "กำลังบันทึก...", "อัปเดตข้อมูลพื้นที่ไปยัง Google Sheet");
        await common.saveArea(editing.value);
        await loadAreas();
        const saved = areas.value.find((a) => a.areaId === editing.value.areaId);
        if (saved) {
          selectedId.value = saved.areaId;
          cloneToEditing(saved);
          await nextTick();
          refreshMap(true);
        }
        setStatus("success", "บันทึกเรียบร้อย", "พื้นที่ถูกอัปเดตแล้ว");
      } catch (err) {
        console.error(err);
        setStatus("error", "บันทึกไม่สำเร็จ", err?.message || "ลองใหม่อีกครั้ง");
      } finally {
        saving.value = false;
      }
    }

    async function removeArea() {
      const areaId = String(editing.value?.areaId || "").trim();
      if (!areaId) return;
      if (!confirm(`ต้องการลบพื้นที่ ${editing.value.areaName} ใช่ไหม?`)) return;
      try {
        saving.value = true;
        setStatus("loading", "กำลังลบ...", "ลบข้อมูลพื้นที่จากชีต");
        await common.deleteArea(areaId);
        await loadAreas();
        const next = areas.value[0] || common.normalizeArea(common.DEFAULT_AREA);
        selectedId.value = next.areaId;
        cloneToEditing(next);
        await nextTick();
        refreshMap(true);
        setStatus("success", "ลบแล้ว", "ลบพื้นที่เรียบร้อย");
      } catch (err) {
        console.error(err);
        setStatus("error", "ลบไม่สำเร็จ", err?.message || "ลองใหม่อีกครั้ง");
      } finally {
        saving.value = false;
      }
    }

    function restoreSelected() {
      const area = selectedArea.value || common.DEFAULT_AREA;
      selectedId.value = area.areaId;
      cloneToEditing(area);
      refreshMap(true);
      setStatus("success", "คืนค่าข้อมูล", "โหลดค่าจากรายการพื้นที่ที่เลือก");
    }

    watch(
      () => [
        editing.value.centerLat,
        editing.value.centerLng,
        editing.value.northMeters,
        editing.value.southMeters,
        editing.value.eastMeters,
        editing.value.westMeters,
        editing.value.areaName,
        editing.value.areaId,
      ],
      () => {
        if (dragUpdating) return;
        refreshMap(false);
      },
      { deep: false },
    );

    onMounted(async () => {
      const ok = await loadSession();
      if (!ok) return;
      await loadAreas();
    });

    return {
      session,
      areas,
      selectedId,
      editing,
      loading,
      saving,
      navItems,
      selectedArea,
      totalAreas,
      statusType,
      statusTitle,
      statusDesc,
      mapEl,
      pickArea,
      newArea,
      save,
      removeArea,
      restoreSelected,
      common,
    };
  },
}).mount("#app");
