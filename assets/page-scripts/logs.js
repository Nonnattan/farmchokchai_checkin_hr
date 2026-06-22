const { createApp, computed, nextTick, onBeforeUnmount, onMounted, ref } =
        Vue;
      const common = window.CheckinCommon;
      const PAGE_SIZE = 15;
      const navItems = ref([
        { key: "index", href: "./index.html", label: "QR Login" },
        { key: "user", href: "./user/checkin.html", label: "User" },
        { key: "admin", href: "./auth.html", label: "Admin" },
        { key: "setarea", href: "./setarea.html", label: "SetArea" },
        { key: "logs", href: "./logs.html", label: "Logs", active: true },
      ]);

      createApp({
        setup() {
          const todayKey = getBangkokDateKey(new Date());
          const logs = ref([]);
          const loading = ref(false);
          const loadingMore = ref(false);
          const exporting = ref(false);
          const error = ref("");
          const activeTab = ref("today");
          const fromDate = ref(todayKey);
          const toDate = ref(todayKey);
          const totalCount = ref(0);
          const hasMore = ref(false);
          const sentinel = ref(null);

          const nameFilter = ref("");
          const nameSearch = ref("");
          const nameDropdownOpen = ref(false);
          const nameDropdownRef = ref(null);

          let observer = null;
          let requestSeq = 0;

          function getBangkokDateKey(date) {
            const parts = new Intl.DateTimeFormat("en-GB", {
              timeZone: "Asia/Bangkok",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).formatToParts(date);

            const get = (type) =>
              parts.find((item) => item.type === type)?.value || "";
            return `${get("year")}-${get("month")}-${get("day")}`;
          }

          function formatDisplayTime(value) {
            if (!value) return "-";
            // ป้องกันข้อผิดพลาดกรณีวันที่เป็น ISO string หรือ Date Object
            if (value instanceof Date) {
              return value.toLocaleString("en-GB", {
                timeZone: "Asia/Bangkok",
              });
            }
            return String(value);
          }

          function currentFilterParams() {
            return {
              tab: activeTab.value,
              from:
                activeTab.value === "range" || activeTab.value === "today"
                  ? fromDate.value
                  : "",
              to:
                activeTab.value === "range" || activeTab.value === "today"
                  ? toDate.value
                  : "",
            };
          }

          function rangeLabel() {
            if (activeTab.value === "today") return "วันนี้";
            if (activeTab.value === "7d") return "7 วันล่าสุด";
            if (activeTab.value === "1m") return "1 เดือนล่าสุด";
            if (activeTab.value === "1y") return "1 ปีล่าสุด";
            if (activeTab.value === "range") {
              if (fromDate.value && toDate.value) {
                return `${fromDate.value} ถึง ${toDate.value}`;
              }
              if (fromDate.value) return `${fromDate.value} เป็นต้นไป`;
              if (toDate.value) return `ถึง ${toDate.value}`;
              return "เลือกช่วงวัน";
            }
            return "วันนี้";
          }

          const nameOptions = computed(() => {
            const map = new Map();

            logs.value.forEach((log) => {
              const label = String(log.displayName || log.name || "").trim();
              if (!label) return;

              const key = label.toLowerCase();
              if (!map.has(key)) {
                map.set(key, {
                  label,
                  value: label,
                  count: 1,
                });
              } else {
                map.get(key).count += 1;
              }
            });

            return Array.from(map.values()).sort((a, b) =>
              a.label.localeCompare(b.label, "th"),
            );
          });

          const filteredNameOptions = computed(() => {
            const q = nameSearch.value.trim().toLowerCase();
            if (!q) return nameOptions.value;
            return nameOptions.value.filter((item) =>
              item.label.toLowerCase().includes(q),
            );
          });

          const filteredLogs = computed(() => {
            const q = nameFilter.value.trim().toLowerCase();
            if (!q) return logs.value;

            return logs.value.filter((log) => {
              const name = String(log.displayName || log.name || "")
                .trim()
                .toLowerCase();
              const email = String(log.email || "")
                .trim()
                .toLowerCase();
              return name.includes(q) || email.includes(q);
            });
          });

          const visibleCount = computed(() => filteredLogs.value.length);
          const latestLog = computed(() => filteredLogs.value[0] || null);
          const selectedNameLabel = computed(
            () => nameFilter.value || "ทั้งหมด",
          );
          const hasNameFilter = computed(() =>
            Boolean(nameFilter.value.trim()),
          );

          function openNameDropdown() {
            nameSearch.value = nameFilter.value;
            nameDropdownOpen.value = true;
            nextTick(() => {
              const input = nameDropdownRef.value?.querySelector("input");
              if (input) {
                input.focus();
                if (typeof input.select === "function") input.select();
              }
            });
          }

          function closeNameDropdown() {
            nameDropdownOpen.value = false;
          }

          function toggleNameDropdown() {
            if (nameDropdownOpen.value) closeNameDropdown();
            else openNameDropdown();
          }

          function applyNameFilter(value) {
            nameFilter.value = value;
            nameSearch.value = value;
            closeNameDropdown();
          }

          function clearNameFilter() {
            nameFilter.value = "";
            nameSearch.value = "";
            closeNameDropdown();
          }

          function handleDocumentClick(event) {
            if (
              nameDropdownRef.value &&
              !nameDropdownRef.value.contains(event.target)
            ) {
              closeNameDropdown();
            }
          }

          async function fetchLogs({ reset = false } = {}) {
            if (reset) {
              logs.value = [];
              totalCount.value = 0;
              hasMore.value = false;
            }

            if (!reset && (loading.value || loadingMore.value)) return;

            const seq = ++requestSeq;
            const isFirstLoad = reset || logs.value.length === 0;

            if (isFirstLoad) {
              loading.value = true;
            } else {
              loadingMore.value = true;
            }

            error.value = "";

            try {
              const response = await common.getLogs({
                ...currentFilterParams(),
                limit: PAGE_SIZE,
                offset: reset ? 0 : logs.value.length,
                raw: true,
              });

              if (seq !== requestSeq) return;

              const rows = Array.isArray(response?.data) ? response.data : [];
              const meta = response?.meta || {};

              totalCount.value = Number(meta.total || rows.length);
              hasMore.value = Boolean(meta.hasMore);

              if (reset) {
                logs.value = rows;
              } else if (rows.length) {
                // แก้ไขการเช็คข้อมูลซ้ำ: ใช้ id หรือใช้วันเวลา+อีเมลเป็นคีย์หลักกรณีที่ API ไม่คืน id กลับมา
                const seen = new Set(
                  logs.value.map(
                    (item) => item.id || item.createdAt + item.email,
                  ),
                );
                rows.forEach((row) => {
                  let uniqueKey = row.id || row.createdAt + row.email;
                  if (!seen.has(uniqueKey)) {
                    logs.value.push(row);
                    seen.add(uniqueKey);
                  }
                });
              }
            } catch (err) {
              console.error(err);
              error.value =
                err && err.message ? err.message : "โหลด logs ไม่สำเร็จ";
            } finally {
              if (seq === requestSeq) {
                loading.value = false;
                loadingMore.value = false;
              }
            }
          }

          async function loadMore() {
            if (!hasMore.value || loading.value || loadingMore.value) return;
            await fetchLogs({ reset: false });
          }

          async function applyCurrentTab() {
            if (activeTab.value === "range") {
              if (!fromDate.value) fromDate.value = todayKey;
              if (!toDate.value) toDate.value = todayKey;
              if (fromDate.value > toDate.value) {
                error.value = "วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด";
                return;
              }
            }

            await fetchLogs({ reset: true });
            await nextTick();
            setupObserver();
          }

          async function selectTab(tab) {
            activeTab.value = tab;
            error.value = "";

            if (tab === "today") {
              fromDate.value = todayKey;
              toDate.value = todayKey;
            } else if (tab === "7d") {
              let d = new Date();
              d.setDate(d.getDate() - 7);
              fromDate.value = getBangkokDateKey(d);
              toDate.value = todayKey;
            } else if (tab === "1m") {
              let d = new Date();
              d.setMonth(d.getMonth() - 1);
              fromDate.value = getBangkokDateKey(d);
              toDate.value = todayKey;
            } else if (tab === "1y") {
              let d = new Date();
              d.setFullYear(d.getFullYear() - 1);
              fromDate.value = getBangkokDateKey(d);
              toDate.value = todayKey;
            } else if (tab === "range") {
              if (!fromDate.value) fromDate.value = todayKey;
              if (!toDate.value) toDate.value = todayKey;
            }

            await applyCurrentTab();
          }

          async function applyRangeSearch() {
            activeTab.value = "range";
            error.value = "";

            if (!fromDate.value) fromDate.value = todayKey;
            if (!toDate.value) toDate.value = todayKey;

            if (fromDate.value > toDate.value) {
              error.value = "วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด";
              return;
            }

            await applyCurrentTab();
          }

          function csvEscape(value) {
            return `"${String(value ?? "").replace(/"/g, '""')}"`;
          }

          async function exportCsv() {
            exporting.value = true;
            error.value = "";

            try {
              const response = await common.getLogs({
                ...currentFilterParams(),
                limit: 10000,
                offset: 0,
                export: 1,
                raw: true,
              });

              const rows = Array.isArray(response?.data) ? response.data : [];
              const header = [
                "createdAt",
                "displayName",
                "email",
                "site",
                "session",
                "lat",
                "lng",
                "accuracy",
                "userId",
                "pictureUrl",
                "status",
              ];

              const csvRows = [header.join(",")];

              rows.forEach((row) => {
                csvRows.push(
                  [
                    csvEscape(row.createdAt || row.time || ""),
                    csvEscape(row.displayName || row.name || ""),
                    csvEscape(row.email || ""),
                    csvEscape(row.site || ""),
                    csvEscape(row.session || ""),
                    csvEscape(row.lat ?? ""),
                    csvEscape(row.lng ?? ""),
                    csvEscape(row.accuracy ?? ""),
                    csvEscape(row.userId || ""),
                    csvEscape(row.pictureUrl || ""),
                    csvEscape(row.status || "checked_in"),
                  ].join(","),
                );
              });

              const blob = new Blob([csvRows.join("\n")], {
                type: "text/csv;charset=utf-8;",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              const stamp = new Date()
                .toISOString()
                .replace(/[:.]/g, "-")
                .slice(0, 19);

              a.href = url;
              a.download = `checkin_logs_${activeTab.value}_${stamp}.csv`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
            } catch (err) {
              console.error(err);
              error.value =
                err && err.message ? err.message : "Export ไม่สำเร็จ";
            } finally {
              exporting.value = false;
            }
          }

          function setupObserver() {
            if (observer) observer.disconnect();
            if (!sentinel.value || !("IntersectionObserver" in window)) return;

            observer = new IntersectionObserver(
              (entries) => {
                const entry = entries[0];
                if (entry && entry.isIntersecting) {
                  loadMore();
                }
              },
              { root: null, rootMargin: "160px 0px" },
            );

            observer.observe(sentinel.value);
          }

          onMounted(async () => {
            document.addEventListener("click", handleDocumentClick);
            activeTab.value = "today";
            fromDate.value = todayKey;
            toDate.value = todayKey;
            await fetchLogs({ reset: true });
            await nextTick();
            setupObserver();

            // หน้า Logs จะโหลดเมื่อเข้าหน้าและเมื่อกดรีเฟรชเท่านั้น
          });

          onBeforeUnmount(() => {
            document.removeEventListener("click", handleDocumentClick);
            if (observer) observer.disconnect();
          });

          return {
            activeTab,
            applyRangeSearch,
            applyNameFilter,
            clearNameFilter,
            error,
            exportCsv,
            exporting,
            fetchLogs,
            filteredLogs,
            filteredNameOptions,
            fromDate,
            hasMore,
            hasNameFilter,
            latestLog,
            loadMore,
            loading,
            loadingMore,
            logs,
            nameDropdownOpen,
            nameDropdownRef,
            nameFilter,
            nameSearch,
            openNameDropdown,
            rangeLabel,
            selectTab,
            selectedNameLabel,
            sentinel,
            toggleNameDropdown,
            totalCount,
            todayKey,
            toDate,
            visibleCount,
            common,
            formatDisplayTime,
          };
        },
        template: `
        <div class="container">
          <div class="topbar">
            <div class="brand">
              <div class="brand-badge">LG</div>
              <div>
                <h1>Logs</h1>
                <p class="page-subtitle">เริ่มแสดงข้อมูล "วันนี้" เป็นค่าเริ่มต้น กดรีเฟรชเมื่ออยากอัปเดต และโหลดเพิ่มแบบทีละ 15 รายการ</p>
              </div>
            </div>
            <app-tabs :items="navItems" />
          </div>

          <div class="grid">
            <section class="card full">
              <div class="actions" style="justify-content:space-between;align-items:flex-start">
                <div>
                  <h2>Recent check-ins</h2>
                  <p class="muted" style="margin:4px 0 0">
                    เลือกแท็บเพื่อกรองข้อมูล หรือเลือกช่วงวันแบบ Date to Date แล้วกด Search
                  </p>
                </div>
                <div class="filter-actions">
                  <button class="btn ghost" @click="fetchLogs({ reset: true })" :disabled="loading || loadingMore || exporting">
                    {{ loading ? 'กำลังโหลด...' : 'รีเฟรช' }}
                  </button>
                  <button class="btn ghost" @click="exportCsv" :disabled="exporting">
                    {{ exporting ? 'กำลัง export...' : 'Export CSV' }}
                  </button>
                </div>
              </div>

              <div class="summary-grid">
                <div class="summary-card">
                  <p class="summary-label">ช่วงที่เลือก</p>
                  <p class="summary-value">{{ rangeLabel() }}</p>
                  <p class="summary-note">ค่าเริ่มต้นคือวันนี้</p>
                </div>
                <div class="summary-card">
                  <p class="summary-label">ทั้งหมดที่ตรงตัวกรอง</p>
                  <p class="summary-value">{{ totalCount }}</p>
                  <p class="summary-note">นับจากข้อมูลที่ server กรองแล้ว</p>
                </div>
                <div class="summary-card">
                  <p class="summary-label">แสดงแล้ว</p>
                  <p class="summary-value">{{ visibleCount }}</p>
                  <p class="summary-note">โหลดครั้งละ 15 รายการ</p>
                </div>
              </div>

              <p v-if="error" class="pill danger" style="margin-top:16px">{{ error }}</p>

              <div class="filter-panel" style="margin-top:16px">
                <div class="search-filter-grid">
                  <div class="field searchable-field" ref="nameDropdownRef">
                    <label>Filter ชื่อจาก LINE</label>
                    <button type="button" class="dropdown-trigger" @click.stop="toggleNameDropdown">
                      <span>{{ selectedNameLabel }}</span>
                      <span class="dropdown-caret">▾</span>
                    </button>

                    <div v-if="nameDropdownOpen" class="dropdown-panel" @click.stop>
                      <div class="dropdown-search">
                        <input
                          type="text"
                          v-model="nameSearch"
                          placeholder="พิมพ์ชื่อหรืออีเมลเพื่อค้นหา"
                          @keydown.esc.prevent="clearNameFilter"
                        />
                      </div>
                      <div class="dropdown-list">
                        <button
                          type="button"
                          class="dropdown-option"
                          :class="{ selected: !nameFilter }"
                          @click="clearNameFilter"
                        >
                          <span>ทั้งหมด</span>
                        </button>

                        <button
                          v-for="option in filteredNameOptions"
                          :key="option.value"
                          type="button"
                          class="dropdown-option"
                          :class="{ selected: nameFilter === option.value }"
                          @click="applyNameFilter(option.value)"
                        >
                          <span>{{ option.label }}</span>
                          
                        </button>

                        <div v-if="filteredNameOptions.length === 0" class="dropdown-empty">
                          ไม่พบชื่อที่ค้นหา
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="tab-row">
                  <button class="tab-btn" :class="{ active: activeTab === 'today' }" @click="selectTab('today')">วันนี้</button>
                  <button class="tab-btn" :class="{ active: activeTab === '7d' }" @click="selectTab('7d')">7 วัน</button>
                  <button class="tab-btn" :class="{ active: activeTab === '1m' }" @click="selectTab('1m')">1 เดือน</button>
                  <button class="tab-btn" :class="{ active: activeTab === '1y' }" @click="selectTab('1y')">1 ปี</button>
                  <button class="tab-btn" :class="{ active: activeTab === 'range' }" @click="selectTab('range')">เลือกช่วงวัน</button>
                </div>

                <div v-if="activeTab === 'range'" class="range-row">
                  <div class="field">
                    <label>From date</label>
                    <input type="date" v-model="fromDate">
                  </div>
                  <div class="field">
                    <label>To date</label>
                    <input type="date" v-model="toDate">
                  </div>
                  <div class="filter-actions">
                    <button class="btn primary" @click="applyRangeSearch">Search</button>
                  </div>
                </div>
              </div>

              <div class="table-wrap">
                <table class="table" v-if="filteredLogs.length">
                  <thead>
                    <tr>
                      <th>เวลา</th>
                      <th>ชื่อจาก LINE</th>
                      <th>พิกัด</th>
                      <th>สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(log, idx) in filteredLogs" :key="log.id || (log.createdAt + log.email) || idx">
                      <td>{{ formatDisplayTime(log.createdAt || log.time) }}</td>
                      <td>
                        <strong>{{ log.displayName || log.name || '-' }}</strong><br>
                        <span v-if="log.email" class="email-text">{{ log.email }}</span><br>
                      </td>
                      <td>
                        {{ common.formatNumber(log.lat) || '-' }}, {{ common.formatNumber(log.lng) || '-' }}
                      </td>
                      <td>
                        <span class="pill success">{{ log.status || 'checked_in' }}</span>
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div v-else class="empty-state">
                  <div style="font-size:18px;font-weight:800;color:#172033;margin-bottom:6px">
                    {{ loading ? 'กำลังโหลดข้อมูล...' : (hasNameFilter ? 'ไม่พบชื่อที่เลือกในช่วงนี้' : 'ยังไม่มีข้อมูลในช่วงที่เลือก') }}
                  </div>
                  <div>
                    ข้อมูลจะถูกดึงตามแท็บที่เลือก และจะโหลดเพิ่มอัตโนมัติเมื่อเลื่อนถึงด้านล่าง
                    <span v-if="hasNameFilter"> ลองพิมพ์ค้นหาหรือกด “ทั้งหมด” เพื่อเคลียร์ตัวกรองชื่อ</span>
                  </div>
                </div>

                <div class="load-more-shell" v-if="logs.length">
                  <div class="load-more-note" v-if="hasMore">
                    เลื่อนลงเพื่อโหลดเพิ่มอีก 15 รายการ
                  </div>
                  <div class="load-more-note" v-else>
                    แสดงครบแล้วทั้งหมด {{ totalCount }} รายการ
                  </div>
                  <div ref="sentinel" class="load-more-sentinel"></div>
                  <button v-if="hasMore" class="btn ghost" @click="loadMore" :disabled="loadingMore">
                    {{ loadingMore ? 'กำลังโหลดเพิ่ม...' : 'โหลดเพิ่ม' }}
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      `,
      }).mount("#app");
