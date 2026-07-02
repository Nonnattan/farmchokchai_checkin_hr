(() => {
  const common = window.CheckinCommon || {};
  const DEFAULT_AREA = common.DEFAULT_AREA || {
    areaId: "",
    areaName: "พื้นที่ทั่วไป",
    lat: 13.968639,
    lng: 100.619861,
    north: 50,
    south: 50,
    east: 50,
    west: 50,
    remark: "เช็กอินภายในพื้นที่ที่กำหนด",
    assign: "masteradmin,admin",
    email: "",
    maxAccuracy: 30,
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

  let __legacyIdCounter = 0;

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

    const areaId = areaIdText || (allowBlankAreaId ? "" : `__legacy-no-id-${Date.now()}-${__legacyIdCounter++}`);
    const areaName = areaNameText || (allowBlankAreaId ? "" : (DEFAULT_AREA.areaName === "qr_code" ? "" : DEFAULT_AREA.areaName));

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
      maxAccuracy: Math.max(5, toNum(source.maxAccuracy, DEFAULT_AREA.maxAccuracy)),
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
    const areaId = String(editing.areaId || "").trim();
    return {
      areaId,
      qr_code: areaId,
      areaName: String(editing.areaName || editing.remark || "").trim(),
      lat: Number(editing.lat),
      lng: Number(editing.lng),
      centerLat: Number(editing.lat),
      centerLng: Number(editing.lng),
      north: Number(editing.north),
      south: Number(editing.south),
      east: Number(editing.east),
      west: Number(editing.west),
      northMeters: Number(editing.north),
      southMeters: Number(editing.south),
      eastMeters: Number(editing.east),
      westMeters: Number(editing.west),
      remark: String(editing.remark || editing.areaName || "").trim(),
      assign: String(editing.assign || "").trim(),
      email: String(editing.email || "").trim(),
      maxAccuracy: Number(editing.maxAccuracy || 30),
      visibleRoles: String(editing.assign || "").trim(),
      visibleUsers: String(editing.email || "").trim(),
      active: editing.active !== false,
    };
  }

  const app = Vue.createApp({
    data() {
      const initial = normalizeArea(DEFAULT_AREA, { allowBlankAreaId: true });
      return {
        common,
        navItems: [],
        areas: [],
        selectedId: "",
        editing: { ...initial },
        assignableUsers: [],
        selectedAssigneeEmails: [],
        draftMode: true,
        assignSearch: "",
        areaSearch: "",
        loading: false,
        loadingUsers: false,
        saving: false,
        statusType: "loading",
        statusTitle: "กำลังโหลดข้อมูล",
        statusDesc: "กำลังดึงพื้นที่และรายชื่อ admin จาก Google Sheet / Firestore",
        map: null,
        marker: null,
        rectangle: null,
        suppressOverlayUpdate: false,
        session: null,
      };
    },
    computed: {
      totalAreas() {
        return this.areas.length;
      },
      statusClass() {
        return this.statusType;
      },
      isCreating() {
        return this.draftMode || !String(this.selectedId || "").trim();
      },
      modeLabel() {
        return this.isCreating ? "สร้างพื้นที่ใหม่" : "แก้ไขพื้นที่";
      },
      modeClass() {
        return this.isCreating ? "create" : "edit";
      },
      saveButtonLabel() {
        return this.saving
          ? "กำลังบันทึก..."
          : (this.isCreating ? "บันทึกพื้นที่ใหม่" : "อัปเดตพื้นที่");
      },
      canDelete() {
        const id = String(this.editing.areaId || this.selectedId || "").trim();
        return !this.isCreating && id && !id.startsWith("__legacy-no-id-");
      },
      selectedArea() {
        return this.areas.find((a) => a.areaId === this.selectedId) || null;
      },
      filteredAreas() {
        const q = this.areaSearch.trim().toLowerCase();
        const list = Array.isArray(this.areas) ? this.areas : [];
        if (!q) return list;
        return list.filter((a) => {
          const hay = [a.areaId, a.areaName, a.remark, a.email, a.assign].join(" ").toLowerCase();
          return hay.includes(q);
        });
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
        return filtered.slice().sort((a, b) => String(a.email).localeCompare(String(b.email)));
      },
      showLogout() {
        return true;
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
        .then(async (session) => {
          if (!session) return null;
          this.session = session;
          await Promise.all([
            this.loadAreas(null, { skipAutoSelect: true }),
            this.loadAssignableUsers(),
          ]);
          this.newArea();
        })
        .finally(() => {
          this.$nextTick(() => this.syncOverlay(true));
        });
    },
    methods: {
      async logout() {
        await FirebaseRole.signOut();
        location.replace("./index.html");
      },
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
            roleApi.redirectToLogin();
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
      async loadAreas(selectId = null, options = {}) {
        const skipAutoSelect = Boolean(options?.skipAutoSelect);
        this.loading = true;
        this.setStatus("loading", "กำลังโหลดพื้นที่", "ดึงข้อมูลพื้นที่จาก Google Sheet");
        try {
          const list = await common.getAreas(20000, true);
          this.areas = Array.isArray(list) ? list.map(normalizeArea) : [];

          const idToSelect = selectId || (skipAutoSelect ? "" : this.selectedId);
          if (idToSelect) {
            const found = this.areas.find((a) => a.areaId === idToSelect);
            if (found) {
              this.applyArea(found, false);
            }
          }

          this.setStatus("success", "โหลดพื้นที่แล้ว", `พบพื้นที่ ${this.areas.length} รายการ`);
        } catch (err) {
          console.error(err);
          this.areas = [];
          this.setStatus("error", "โหลดไม่สำเร็จ", err?.message || "ไม่พบข้อมูลพื้นที่");
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
            .filter((u) => u.email && u.role === "admin");
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
        const seed = this.areas[0] || normalizeArea(DEFAULT_AREA);
        const fresh = {
          lat: seed.lat,
          lng: seed.lng,
          north: seed.north,
          south: seed.south,
          east: seed.east,
          west: seed.west,
          assign: seed.assign || DEFAULT_AREA.assign,
          active: true,
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
        this.setStatus("success", "โหมดสร้างใหม่", "กรอกข้อมูลแล้วกดบันทึกพื้นที่ใหม่ — จะเพิ่มแถวใหม่ใน Sheet ไม่ทับของเดิม");
      },
      async restoreSelected() {
        if (!this.selectedId || this.isCreating) {
          this.setStatus("error", "ยังไม่ได้เลือกพื้นที่", "เลือกพื้นที่จากรายการด้านซ้ายก่อน");
          return;
        }
        this.loading = true;
        try {
          const list = await common.getAreas(20000, true);
          this.areas = Array.isArray(list) ? list.map(normalizeArea) : [];
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
        if (!String(this.editing.areaName || "").trim() && !String(this.editing.remark || "").trim()) {
          this.setStatus("error", "กรอกชื่อพื้นที่", "กรุณาระบุ areaName หรือ remark ก่อนบันทึก");
          return;
        }

        this.saving = true;
        const creating = this.isCreating;
        this.setStatus(
          "loading",
          creating ? "กำลังเพิ่มพื้นที่ใหม่" : "กำลังอัปเดตพื้นที่",
          creating
            ? "จะเพิ่มแถวใหม่ใน Google Sheet ไม่แก้ไขแถวเดิม"
            : "อัปเดตข้อมูลพื้นที่ที่เลือกอยู่",
        );
        try {
          const payload = toPayloadArea(this.editing);
          const selectedEmails = uniqueEmails(this.selectedAssigneeEmails);

          payload.originalAreaId = creating ? "" : String(this.selectedId || "").trim();

          if (creating) {
            const existingIds = new Set(this.areas.map((a) => String(a.areaId || "").trim()).filter(Boolean));
            let candidate = String(payload.areaId || "").trim();
            if (!candidate || existingIds.has(candidate)) {
              candidate = buildAreaId(this.editing);
              while (existingIds.has(candidate)) {
                candidate = buildAreaId(this.editing) + "-" + Math.random().toString(36).slice(2, 5);
              }
            }
            payload.areaId = candidate;
            payload.qr_code = candidate;
          } else {
            payload.areaId = String(payload.areaId || "").trim() || String(this.selectedId || "").trim();
            payload.qr_code = payload.areaId;
          }

          payload.email = selectedEmails.join(",");
          payload.visibleUsers = payload.email;
          payload.assignees = selectedEmails.map((email) => {
            const found = this.assignableUsers.find((u) => String(u.email || "").toLowerCase() === String(email || "").toLowerCase());
            return {
              email,
              uid: found?.uid || "",
              role: found?.role || "admin",
              displayName: found?.displayName || "",
              active: found?.active !== false,
            };
          });

          const res = await common.saveLocationEntry(payload, 30000);
          const saved = normalizeArea(res?.data?.[0] || payload);
          const savedId = String(saved.areaId || payload.areaId || "").trim();

          await this.loadAreas(savedId);
          await this.loadAssignableUsers();

          this.setStatus(
            "success",
            creating ? "เพิ่มพื้นที่สำเร็จ" : "อัปเดตสำเร็จ",
            creating
              ? `เพิ่มพื้นที่ ${savedId} แล้ว — admin ที่เลือกจะเห็นพื้นที่นี้ในหน้า Admin`
              : `อัปเดตพื้นที่ ${savedId} แล้ว`,
          );

          if (creating) {
            this.newArea();
          } else {
            this.draftMode = false;
            this.selectedId = savedId;
            this.applyArea(saved, true);
          }
        } catch (err) {
          console.error(err);
          this.setStatus(
            "error",
            "บันทึกไม่สำเร็จ",
            /permission|permission denied|requested document/i.test(String(err?.message || ""))
              ? "Google Sheet หรือ Web App ยังไม่มีสิทธิ์เข้าถึง ช่วยตรวจสอบการแชร์ Spreadsheet และการ Deploy Apps Script"
              : (err?.message || "เกิดข้อผิดพลาด"),
          );
        } finally {
          this.saving = false;
        }
      },
      async removeArea() {
        const id = String(this.editing.areaId || this.selectedId || "").trim();
        if (!id || this.isCreating) return;
        if (id.startsWith("__legacy-no-id-")) {
          this.setStatus("error", "ลบไม่ได้", "พื้นที่นี้ยังไม่มี qr_code ในชีต — กดบันทึกก่อนเพื่อสร้างรหัส");
          return;
        }
        if (!confirm(`ต้องการลบพื้นที่ "${this.editing.areaName || id}" ใช่ไหม?\n\nการลบจะลบจากชีต location และ AreaAssignments`)) return;

        this.saving = true;
        try {
          await common.deleteLocationEntry(id, 20000);
          await this.loadAreas(null, { skipAutoSelect: true });
          this.newArea();
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
          17,
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

        const area = normalizeArea(this.editing, { allowBlankAreaId: true });
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
          [boundary.maxLat, boundary.maxLng],
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
