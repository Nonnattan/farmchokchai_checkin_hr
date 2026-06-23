(() => {
  const common = window.CheckinCommon || {};
  const API_URL = common.API_URL || "https://script.google.com/macros/s/AKfycbyU0MchhC88K1UXTDmzTleaHZITf8-2IVF3UNZmeBnRzkBkyUzEUjzkwI53H9Ttjgnf/exec";
  const DEFAULT_AREA = common.DEFAULT_AREA || {
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

  function uniqueEmails(list) {
    const seen = new Set();
    const out = [];
    (list || []).forEach((item) => {
      const email = String(item || "").trim().toLowerCase();
      if (!email || seen.has(email)) return;
      seen.add(email);
      out.push(email);
    });
    return out;
  }

  function upsertArea(list, area) {
    const next = Array.isArray(list) ? [...list] : [];
    const item = normalizeArea(area);
    const idx = next.findIndex((a) => String(a.areaId || "").trim() === String(item.areaId || "").trim());
    if (idx >= 0) next[idx] = item;
    else next.unshift(item);
    return next;
  }

  function normalizeArea(raw = {}, options = {}) {
    const allowBlankAreaId = Boolean(options?.allowBlankAreaId);
    const source = raw || {};

    const areaIdSource =
      source.areaId ??
      source.qr_code ??
      source.id ??
      source.code ??
      source.siteId ??
      source.site ??
      "";
    const areaNameSource =
      source.areaName ??
      source.siteName ??
      source.site ??
      source.remark ??
      source.note ??
      source.qr_code ??
      "";
    const remarkSource =
      source.remark ??
      source.note ??
      source.areaName ??
      source.siteName ??
      source.site ??
      source.qr_code ??
      "";

    const areaIdText = String(areaIdSource || "").trim();
    const areaNameText = String(areaNameSource || "").trim();
    const remarkText = String(remarkSource || "").trim();

    const areaId = areaIdText || (allowBlankAreaId ? "" : DEFAULT_AREA.areaId);
    const areaName = areaNameText || (allowBlankAreaId ? "" : DEFAULT_AREA.areaName);

    return {
      areaId,
      areaName: allowBlankAreaId ? (areaName || areaId || "") : (areaName || areaId || DEFAULT_AREA.areaName),
      lat: toNum(source.centerLat ?? source.lat, DEFAULT_AREA.lat),
      lng: toNum(source.centerLng ?? source.lng, DEFAULT_AREA.lng),
      north: Math.max(0, toNum(source.northMeters ?? source.north, DEFAULT_AREA.north)),
      south: Math.max(0, toNum(source.southMeters ?? source.south, DEFAULT_AREA.south)),
      east: Math.max(0, toNum(source.eastMeters ?? source.east, DEFAULT_AREA.east)),
      west: Math.max(0, toNum(source.westMeters ?? source.west, DEFAULT_AREA.west)),
      remark: remarkText,
      assign: String(source.visibleRoles ?? source.assign ?? DEFAULT_AREA.assign).trim() || DEFAULT_AREA.assign,
      email: String(source.visibleUsers ?? source.email ?? "").trim(),
      visibleRoles: String(source.visibleRoles ?? source.assign ?? DEFAULT_AREA.assign).trim() || DEFAULT_AREA.assign,
      visibleUsers: String(source.visibleUsers ?? source.email ?? "").trim(),
      active: source.active === false || String(source.active).toLowerCase() === "false" ? false : true,
      updatedAt: String(source.updatedAt || "").trim(),
      updatedBy: String(source.updatedBy || "").trim(),
    };
  }

  function formatNumber(value, digits = 6) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    return n.toFixed(digits);
  }

  function slugifyAreaId(value) {
    const base = String(value || "")
      .toLowerCase()
      .trim()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9ก-๙]+/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return base || "";
  }

  function buildAreaId(editing) {
    const stamp = new Date();
    const stampText = [
      stamp.getFullYear(),
      String(stamp.getMonth() + 1).padStart(2, "0"),
      String(stamp.getDate()).padStart(2, "0"),
      String(stamp.getHours()).padStart(2, "0"),
      String(stamp.getMinutes()).padStart(2, "0"),
      String(stamp.getSeconds()).padStart(2, "0"),
    ].join("");
    const seed = slugifyAreaId(
      editing?.areaId ||
      editing?.areaName ||
      editing?.remark ||
      DEFAULT_AREA.areaName,
    );
    const prefix = seed || "area";
    return `${prefix}-${stampText}`;
  }

  function toPayloadArea(editing) {
    return {
      areaId: String(editing.areaId || "").trim(),
      areaName: String(editing.areaName || editing.remark || "").trim(),
      lat: Number(editing.lat),
      lng: Number(editing.lng),
      north: Number(editing.north),
      south: Number(editing.south),
      east: Number(editing.east),
      west: Number(editing.west),
      remark: String(editing.remark || editing.areaName || "").trim(),
      assign: String(editing.assign || "").trim(),
      email: String(editing.email || "").trim(),
      visibleRoles: String(editing.assign || "").trim(),
      visibleUsers: String(editing.email || "").trim(),
      active: editing.active !== false,
    };
  }

  function requestJson(action, payload = null, method = "GET", timeoutMs = 20000) {
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

    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    let timeoutId = null;

    if (controller) {
      options.signal = controller.signal;
      if (Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0) {
        timeoutId = setTimeout(() => controller.abort(), Number(timeoutMs));
      }
    }

    return fetch(url, options)
      .then(async (response) => {
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
      })
      .finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
      });
  }

  const app = Vue.createApp({
    data() {
      const initial = normalizeArea(DEFAULT_AREA);
      return {
        common,
        navItems: [],
        areas: [],
        selectedId: initial.areaId,
        editing: { ...initial },
        assignableUsers: [],
        selectedAssigneeEmails: [],
        draftMode: false,
        assignSearch: "",
        loading: false,
        loadingUsers: false,
        saving: false,
        statusType: "loading",
        statusTitle: "กำลังโหลดข้อมูล",
        statusDesc: "กำลังดึงพื้นที่และรายชื่อผู้ใช้จาก Google Sheet / Firestore",
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
      selectedArea() {
        return this.areas.find((a) => a.areaId === this.selectedId) || this.areas[0] || null;
      },
      selectedEmailText() {
        return this.selectedAssigneeEmails.join(", ");
      },
      filteredAssignableUsers() {
        const q = this.assignSearch.trim().toLowerCase();
        const list = Array.isArray(this.assignableUsers) ? this.assignableUsers : [];
        const filtered = q
          ? list.filter((u) => {
              const hay = [u.email, u.displayName, u.uid, u.role].join(" ").toLowerCase();
              return hay.includes(q);
            })
          : list;
        return filtered.slice().sort((a, b) => {
          const ea = String(a.email || "").localeCompare(String(b.email || ""));
          if (ea !== 0) return ea;
          return String(a.role || "").localeCompare(String(b.role || ""));
        });
      },
      selectedAssignCount() {
        return this.selectedAssigneeEmails.length;
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
      selectedAssigneeEmails: {
        deep: true,
        handler() {
          const cleaned = uniqueEmails(this.selectedAssigneeEmails);
          if (cleaned.join(",") !== this.selectedAssigneeEmails.join(",")) {
            this.selectedAssigneeEmails = cleaned;
            return;
          }
          this.editing.email = cleaned.join(", ");
        },
      },
    },
    mounted() {
      document.title = "SetArea";
      this.navItems = typeof common.getNavItems === "function"
        ? common.getNavItems("masteradmin", "setarea")
        : [];
      this.initMap();
      this.loadSession()
        .then((session) => {
          if (!session) return null;
          this.session = session;
          return Promise.all([this.loadAreas(), this.loadAssignableUsers()]);
        })
        .finally(() => {
          this.$nextTick(() => this.syncOverlay(true));
        });
    },
    methods: {
      toNum,
      formatNumber,
      setStatus(type, title, desc) {
        this.statusType = type;
        this.statusTitle = title;
        this.statusDesc = desc || "";
      },
      pickArea(area) {
        this.draftMode = false;
        this.applyArea(area, true);
      },
      isAssigneeSelected(email) {
        const target = String(email || "").trim().toLowerCase();
        return this.selectedAssigneeEmails.some((item) => String(item || "").trim().toLowerCase() === target);
      },
      toggleAssignee(email, checked) {
        const target = String(email || "").trim().toLowerCase();
        const current = uniqueEmails(this.selectedAssigneeEmails);
        const next = checked
          ? uniqueEmails([...current, target])
          : current.filter((item) => String(item || "").trim().toLowerCase() !== target);
        this.selectedAssigneeEmails = next;
      },
      async loadSession() {
        try {
          const roleApi = window.FirebaseRole;
          if (!roleApi || typeof roleApi.currentSession !== "function") {
            throw new Error("ยังไม่ได้โหลด Firebase auth helpers");
          }
          const session = await roleApi.currentSession(false);
          if (!session) {
            location.replace("./index.html");
            return null;
          }
          if (session.role !== "masteradmin") {
            location.replace("./admin.html");
            return null;
          }
          return session;
        } catch (err) {
          this.setStatus("error", "ตรวจสอบสิทธิ์ไม่สำเร็จ", err?.message || "เกิดข้อผิดพลาด");
          return null;
        }
      },
      applyArea(area, focus = true, options = {}) {
        const src = normalizeArea(area, { allowBlankAreaId: Boolean(options?.allowBlankAreaId) });
        this.selectedId = src.areaId;
        this.draftMode = !String(src.areaId || "").trim();
        this.suppressOverlayUpdate = true;
        this.editing = {
          ...src,
          lat: Number(src.lat),
          lng: Number(src.lng),
          north: Number(src.north),
          south: Number(src.south),
          east: Number(src.east),
          west: Number(src.west),
        };
        this.selectedAssigneeEmails = uniqueEmails(splitList(src.visibleUsers || src.email || ""));
        this.$nextTick(() => {
          this.suppressOverlayUpdate = false;
          this.syncOverlay(focus);
        });
      },
      async loadAreas(selectId = null) {
        this.loading = true;
        this.setStatus("loading", "กำลังโหลดพื้นที่", "ดึงข้อมูลพื้นที่จาก Google Sheet");
        try {
          const data = await requestJson("areas", null, "GET", 20000);
          const list = Array.isArray(data?.data) ? data.data.map(normalizeArea) : [];
          this.areas = list.length ? list : [normalizeArea(DEFAULT_AREA)];

          const idToSelect = selectId || this.selectedId || this.editing.areaId || this.areas[0]?.areaId || DEFAULT_AREA.areaId;
          const found = this.areas.find((a) => a.areaId === idToSelect) || this.areas[0];
          if (found) this.applyArea(found, false);

          this.setStatus("success", "โหลดพื้นที่แล้ว", `พบพื้นที่ ${this.areas.length} รายการ`);
        } catch (err) {
          console.error(err);
          this.areas = [normalizeArea(DEFAULT_AREA)];
          this.applyArea(this.areas[0], false);
          this.setStatus("error", "โหลดไม่สำเร็จ", err?.message || "ใช้ค่าเริ่มต้นแทน");
        } finally {
          this.loading = false;
          this.$nextTick(() => this.syncOverlay(true));
        }
      },
      async loadAssignableUsers() {
        this.loadingUsers = true;
        try {
          const rawUsers = await common.getUsers({ active: true });
          const list = (Array.isArray(rawUsers) ? rawUsers : [])
            .map((u) => ({
              uid: String(u.uid || "").trim(),
              email: String(u.email || "").trim().toLowerCase(),
              displayName: String(u.displayName || "").trim(),
              role: String(u.role || "user").trim().toLowerCase(),
              active: u.active !== false,
            }))
            .filter((u) => u.email && ["admin", "masteradmin"].includes(u.role));
          this.assignableUsers = list.sort((a, b) => String(a.email).localeCompare(String(b.email)));
        } catch (err) {
          console.error(err);
          this.assignableUsers = [];
        } finally {
          this.loadingUsers = false;
        }
      },
      selectAllAssignableUsers() {
        this.selectedAssigneeEmails = this.filteredAssignableUsers.map((u) => u.email);
      },
      clearAssignees() {
        this.selectedAssigneeEmails = [];
      },
      newArea() {
        const seed = this.selectedArea || this.areas[0] || normalizeArea(DEFAULT_AREA);
        const fresh = {
          ...seed,
          areaId: "",
          areaName: "",
          remark: "",
          email: "",
          visibleUsers: "",
          updatedAt: "",
          updatedBy: "",
        };
        this.draftMode = true;
        this.selectedId = "";
        this.applyArea(fresh, true, { allowBlankAreaId: true });
        this.editing.areaName = "";
        this.editing.remark = "";
        this.selectedAssigneeEmails = [];
        this.setStatus("success", "สร้างพื้นที่ใหม่", "เริ่มจากพื้นที่เปล่า พร้อมแผนที่ตำแหน่งเดิม");
      },
      async restoreSelected() {
        if (!this.selectedId) return;
        this.loading = true;
        try {
          const data = await requestJson("areas", null, "GET", 20000);
          const list = Array.isArray(data?.data) ? data.data.map(normalizeArea) : [];
          this.areas = list.length ? list : [normalizeArea(DEFAULT_AREA)];
          const found = this.areas.find((a) => a.areaId === this.selectedId);
          if (found) {
            this.draftMode = false;
            this.applyArea(found, true);
          }
          this.setStatus("success", "รีโหลดแล้ว", `พื้นที่ ${this.selectedId} ถูกดึงกลับจาก Sheet`);
        } catch (err) {
          console.error(err);
          this.setStatus("error", "รีโหลดไม่สำเร็จ", err.message || "เกิดข้อผิดพลาด");
        } finally {
          this.loading = false;
        }
      },
      async save() {
        this.saving = true;
        this.setStatus("loading", "กำลังบันทึก", "ส่งข้อมูลพื้นที่ + รายชื่อที่ assign ไปยัง Google Sheet");
        try {
          const payload = toPayloadArea(this.editing);
          const selectedEmails = uniqueEmails(this.selectedAssigneeEmails);
          const isCreating = this.draftMode || !String(this.selectedId || "").trim();
          payload.originalAreaId = isCreating ? "" : String(this.selectedId || payload.areaId || "").trim();
          payload.areaId = String(payload.areaId || "").trim() || (isCreating ? buildAreaId(this.editing) : String(this.selectedId || "").trim());
          payload.email = selectedEmails.join(",");
          payload.visibleUsers = payload.email;
          payload.assignees = selectedEmails.map((email) => {
            const found = this.assignableUsers.find((u) => String(u.email || "").toLowerCase() === String(email || "").toLowerCase());
            return {
              email,
              uid: found?.uid || "",
              role: found?.role || "",
              displayName: found?.displayName || "",
              active: found?.active !== false,
            };
          });

          const res = await requestJson("areas", payload, "POST", 30000);
          const saved = normalizeArea(res?.data?.[0] || payload);
          const savedId = String(saved.areaId || payload.areaId || "").trim();
          this.draftMode = false;
          this.selectedId = savedId;
          this.areas = upsertArea(this.areas, saved);
          this.applyArea(saved, true);
          await this.loadAssignableUsers();

          try {
            const refreshData = await requestJson("areas", null, "GET", 20000);
            const refreshed = Array.isArray(refreshData?.data) ? refreshData.data.map(normalizeArea) : [];
            if (refreshed.length) {
              this.areas = refreshed;
              const found = refreshed.find((a) => String(a.areaId || "").trim() === savedId) || saved;
              this.applyArea(found, true);
            }
          } catch (refreshErr) {
            console.warn("refresh after save skipped:", refreshErr);
          }

          this.setStatus("success", "บันทึกสำเร็จ", `พื้นที่ ${savedId} ถูกเขียนลง Sheet แล้ว`);
        } catch (err) {
          console.error(err);
          this.setStatus(
            "error",
            "บันทึกไม่สำเร็จ",
            /permission|permission denied|requested document/i.test(String(err?.message || ""))
              ? "Google Sheet หรือ Web App ยังไม่มีสิทธิ์เข้าถึง ช่วยตรวจสอบการแชร์ Spreadsheet และการ Deploy Apps Script"
              : (err?.message || "เกิดข้อผิดพลาด")
          );
        } finally {
          this.saving = false;
        }
      },
      async removeArea() {
        const id = String(this.editing.areaId || this.selectedId || "").trim();
        if (!id) return;
        if (!confirm(`ต้องการลบพื้นที่ "${id}" ใช่ไหม`)) return;

        this.saving = true;
        try {
          await requestJson("areas", { actionType: "delete", areaId: id, originalAreaId: this.selectedId }, "POST", 20000);
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
        if (!el || !window.L) return;

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
        const boundary = typeof common.buildBoundary === "function"
          ? common.buildBoundary({
              centerLat: area.lat,
              centerLng: area.lng,
              northMeters: area.north,
              southMeters: area.south,
              eastMeters: area.east,
              westMeters: area.west,
            })
          : {
              minLat: area.lat - (area.south / 111320),
              maxLat: area.lat + (area.north / 111320),
              minLng: area.lng - (area.west / 111320),
              maxLng: area.lng + (area.east / 111320),
            };

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
