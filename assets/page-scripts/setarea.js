(() => {
  const common = window.CheckinCommon || {};
  const API_URL = common.API_URL || "https://script.google.com/macros/s/AKfycbwCwBWnkziOhlZANab2GJqAgWKO7lUIN8x3TDDFQ7FnzVDuNlFBS8A33DOlxEIzxt6k/exec";

  const DEFAULT_AREA = {
    areaId: "qr_code",
    areaName: "qr_code",
    lat: 13.968639,
    lng: 100.619861,
    north: 50,
    south: 50,
    east: 80,
    west: 50,
    remark: "พื้นที่เริ่มต้นสำหรับเช็กอิน",
    assign: "masteradmin,admin",
    email: "",
    active: true,
    updatedAt: "",
    updatedBy: "",
  };

  function toNum(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function splitList(value) {
    return String(value || "")
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function normalizeArea(raw = {}) {
    return {
      areaId: String(raw.areaId || raw.id || DEFAULT_AREA.areaId).trim() || DEFAULT_AREA.areaId,
      areaName: String(raw.areaName || raw.siteName || raw.site || DEFAULT_AREA.areaName).trim() || DEFAULT_AREA.areaName,
      lat: toNum(raw.lat ?? raw.centerLat, DEFAULT_AREA.lat),
      lng: toNum(raw.lng ?? raw.centerLng, DEFAULT_AREA.lng),
      north: Math.max(0, toNum(raw.north ?? raw.northMeters, DEFAULT_AREA.north)),
      south: Math.max(0, toNum(raw.south ?? raw.southMeters, DEFAULT_AREA.south)),
      east: Math.max(0, toNum(raw.east ?? raw.eastMeters, DEFAULT_AREA.east)),
      west: Math.max(0, toNum(raw.west ?? raw.westMeters, DEFAULT_AREA.west)),
      remark: String(raw.remark ?? raw.note ?? DEFAULT_AREA.remark).trim() || DEFAULT_AREA.remark,
      assign: String(raw.assign ?? raw.visibleRoles ?? DEFAULT_AREA.assign).trim(),
      email: String(raw.email ?? raw.visibleUsers ?? "").trim(),
      active: raw.active === false || String(raw.active).toLowerCase() === "false" ? false : true,
      updatedAt: String(raw.updatedAt || "").trim(),
      updatedBy: String(raw.updatedBy || "").trim(),
    };
  }

  function normalizeAreaList(payload) {
    const list = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data
        : [];
    return list.map(normalizeArea);
  }

  function buildBoundary(area) {
    const lat = Number(area.lat || 0);
    const lng = Number(area.lng || 0);
    const latDeltaNorth = Number(area.north || 0) / 111320;
    const latDeltaSouth = Number(area.south || 0) / 111320;
    const cosLat = Math.cos((lat * Math.PI) / 180) || 1;
    const lngDeltaEast = Number(area.east || 0) / (111320 * cosLat);
    const lngDeltaWest = Number(area.west || 0) / (111320 * cosLat);
    return {
      minLat: lat - latDeltaSouth,
      maxLat: lat + latDeltaNorth,
      minLng: lng - lngDeltaWest,
      maxLng: lng + lngDeltaEast,
    };
  }

  function formatNumber(value, digits = 6) {
    const n = Number(value);
    if (Number.isNaN(n)) return "-";
    return n.toFixed(digits);
  }

  async function requestJson(action, payload = null, method = "GET", timeoutMs = 20000) {
    const upper = String(method || "GET").toUpperCase();
    let url = API_URL;
    const options = {
      method: upper,
      cache: "no-store",
    };

    if (upper === "GET") {
      const params = new URLSearchParams();
      params.set("action", action);
      params.set("_ts", String(Date.now()));
      if (payload && typeof payload === "object") {
        Object.entries(payload).forEach(([key, value]) => {
          if (value === undefined || value === null || value === "") return;
          params.set(key, String(value));
        });
      }
      url = `${API_URL}?${params.toString()}`;
    } else {
      options.headers = { "Content-Type": "text/plain;charset=utf-8" };
      options.body = JSON.stringify({ action, ...(payload || {}) });
    }

    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    let timeoutId = null;

    if (controller) {
      options.signal = controller.signal;
      if (Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0) {
        timeoutId = setTimeout(() => controller.abort(), Number(timeoutMs));
      }
    }

    try {
      const response = await fetch(url, options);
      const text = await response.text();

      let data = {};
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error("Apps Script ตอบกลับไม่ใช่ JSON");
      }

      if (!response.ok || data.ok === false) {
        throw new Error(data.err || data.error || data.message || "API request failed");
      }

      return data;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  const app = Vue.createApp({
    data() {
      return {
        common,
        navItems: [],
        areas: [],
        selectedId: "",
        editing: normalizeArea(DEFAULT_AREA),
        loading: false,
        saving: false,
        statusType: "loading",
        statusTitle: "กำลังโหลดข้อมูล",
        statusDesc: "กำลังดึงพื้นที่จาก Google Sheet",
        map: null,
        marker: null,
        rectangle: null,
        suppressOverlayUpdate: false,
      };
    },
    computed: {
      totalAreas() {
        return this.areas.length;
      },
      statusClass() {
        return this.statusType;
      },
    },
    watch: {
      editing: {
        deep: true,
        handler() {
          if (this.suppressOverlayUpdate) return;
          this.syncOverlay(false);
        },
      },
    },
    mounted() {
      document.title = "SetArea";
      this.navItems = typeof common.getNavItems === "function"
        ? common.getNavItems("masteradmin", "setarea")
        : [];
      this.initMap();
      this.loadAreas().finally(() => {
        this.$nextTick(() => this.syncOverlay(true));
      });
    },
    methods: {
      formatNumber,
      setStatus(type, title, desc) {
        this.statusType = type;
        this.statusTitle = title;
        this.statusDesc = desc;
      },
      async loadAreas(selectId = null) {
        this.loading = true;
        this.setStatus("loading", "กำลังโหลดข้อมูล", "กำลังดึงพื้นที่จาก Google Sheet");
        try {
          const data = await requestJson("areas", null, "GET", 20000);
          const list = normalizeAreaList(data);
          this.areas = list.length ? list : [normalizeArea(DEFAULT_AREA)];

          const idToSelect =
            selectId ||
            this.selectedId ||
            this.editing.areaId ||
            this.areas[0]?.areaId ||
            DEFAULT_AREA.areaId;

          const found = this.areas.find((a) => a.areaId === idToSelect) || this.areas[0];
          if (found) this.pickArea(found, false);

          this.setStatus("success", "พร้อมใช้งาน", `โหลดพื้นที่แล้ว ${this.areas.length} รายการ`);
        } catch (err) {
          console.error(err);
          this.areas = [normalizeArea(DEFAULT_AREA)];
          this.pickArea(this.areas[0], false);
          this.setStatus("error", "โหลดไม่สำเร็จ", "ดึงข้อมูลจาก Apps Script ไม่ได้ ใช้ค่าเริ่มต้นแทน");
        } finally {
          this.loading = false;
          this.$nextTick(() => this.syncOverlay(true));
        }
      },
      newArea() {
        const fresh = normalizeArea(DEFAULT_AREA);
        this.selectedId = fresh.areaId;
        this.editing = { ...fresh };
        this.setStatus("success", "สร้างพื้นที่ใหม่", "เริ่มจากพื้นที่ qr_code");
        this.$nextTick(() => this.syncOverlay(true));
      },
      pickArea(area, focus = true) {
        const src = normalizeArea(area);
        this.selectedId = src.areaId;
        this.suppressOverlayUpdate = true;
        this.editing = { ...src };
        this.$nextTick(() => {
          this.suppressOverlayUpdate = false;
          this.syncOverlay(focus);
        });
      },
      async restoreSelected() {
        if (!this.selectedId) return;
        this.loading = true;
        try {
          const data = await requestJson("areas", null, "GET", 20000);
          const list = normalizeAreaList(data);
          this.areas = list.length ? list : [normalizeArea(DEFAULT_AREA)];
          const found = this.areas.find((a) => a.areaId === this.selectedId);
          if (found) this.pickArea(found, true);
          this.setStatus("success", "รีโหลดแล้ว", `พื้นที่ ${this.selectedId} ถูกดึงกลับจาก Sheet`);
        } catch (err) {
          console.error(err);
          this.setStatus("error", "รีโหลดไม่สำเร็จ", "ไม่สามารถดึงข้อมูลล่าสุดจาก Sheet ได้");
        } finally {
          this.loading = false;
        }
      },
      async save() {
        this.saving = true;
        this.setStatus("loading", "กำลังบันทึก", "กำลังส่งข้อมูลพื้นที่ไปยัง Google Sheet");
        try {
          const payload = {
            action: "areas",
            areaId: String(this.editing.areaId || DEFAULT_AREA.areaId).trim() || DEFAULT_AREA.areaId,
            areaName: String(this.editing.areaName || DEFAULT_AREA.areaName).trim() || DEFAULT_AREA.areaName,
            lat: Number(this.editing.lat),
            lng: Number(this.editing.lng),
            north: Number(this.editing.north),
            south: Number(this.editing.south),
            east: Number(this.editing.east),
            west: Number(this.editing.west),
            remark: String(this.editing.remark || "").trim(),
            assign: String(this.editing.assign || "").trim(),
            email: String(this.editing.email || "").trim(),
            active: this.editing.active !== false,
          };

          const res = await requestJson("areas", payload, "POST", 30000);
          const saved = normalizeArea(res?.data?.[0] || payload);
          await this.loadAreas(saved.areaId);
          this.setStatus("success", "บันทึกสำเร็จ", `พื้นที่ ${saved.areaId} ถูกเขียนลง Sheet แล้ว`);
        } catch (err) {
          console.error(err);
          this.setStatus("error", "บันทึกไม่สำเร็จ", err.message || "เกิดข้อผิดพลาด");
        } finally {
          this.saving = false;
        }
      },
      async removeArea() {
        const id = String(this.editing.areaId || "").trim();
        if (!id) return;
        if (!confirm(`ต้องการลบพื้นที่ "${id}" ใช่ไหม`)) return;

        this.saving = true;
        try {
          await requestJson("areas", { actionType: "delete", areaId: id }, "POST", 20000);
          await this.loadAreas();
          this.setStatus("success", "ลบแล้ว", `ลบพื้นที่ ${id} ออกจาก Sheet แล้ว`);
        } catch (err) {
          console.error(err);
          this.setStatus("error", "ลบไม่สำเร็จ", err.message || "เกิดข้อผิดพลาด");
        } finally {
          this.saving = false;
        }
      },
      initMap() {
        if (this.map) return;
        const el = this.$refs.mapEl;
        if (!el) return;

        this.map = L.map(el, { zoomControl: true }).setView(
          [this.editing.lat, this.editing.lng],
          17
        );

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 22,
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(this.map);

        this.map.on("click", (e) => {
          this.setCenter(e.latlng.lat, e.latlng.lng, true);
        });

        setTimeout(() => this.map && this.map.invalidateSize(), 100);
        this.syncOverlay(true);
      },
      setCenter(lat, lng, focus = false) {
        this.suppressOverlayUpdate = true;
        this.editing.lat = Number(lat);
        this.editing.lng = Number(lng);
        this.$nextTick(() => {
          this.suppressOverlayUpdate = false;
          this.syncOverlay(focus);
        });
      },
      syncOverlay(focus = false) {
        if (!this.map) return;

        const area = normalizeArea(this.editing);
        const boundary = buildBoundary(area);

        if (!this.marker) {
          this.marker = L.marker([area.lat, area.lng], {
            draggable: true,
            autoPan: true,
          }).addTo(this.map);

          this.marker.on("dragend", () => {
            const p = this.marker.getLatLng();
            this.setCenter(p.lat, p.lng, false);
          });
        } else {
          this.marker.setLatLng([area.lat, area.lng]);
        }

        const bounds = L.latLngBounds(
          [boundary.minLat, boundary.minLng],
          [boundary.maxLat, boundary.maxLng]
        );

        if (!this.rectangle) {
          this.rectangle = L.rectangle(bounds, {
            color: "#2563eb",
            weight: 2,
            fillColor: "#93c5fd",
            fillOpacity: 0.14,
          }).addTo(this.map);
        } else {
          this.rectangle.setBounds(bounds);
        }

        if (focus) {
          this.map.fitBounds(bounds, { padding: [40, 40] });
        }
      },
    },
  });

  app.mount("#app");
})();