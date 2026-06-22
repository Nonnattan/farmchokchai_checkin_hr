const { createApp, ref, computed, onMounted } = Vue;
const common = window.CheckinCommon;

function createEmptyUser() {
  return {
    uid: "",
    email: "",
    displayName: "",
    role: "user",
    active: true,
    note: "",
    visibleAreas: "",
  };
}

function createEmptyCreateForm() {
  return {
    email: "",
    displayName: "",
    role: "user",
    password: "",
    confirmPw: "",
  };
}

createApp({
  setup() {
    const session = ref(null);
    const users = ref([]);
    const loading = ref(false);
    const saving = ref(false);
    const creating = ref(false);
    const query = ref("");
    const selectedKey = ref("");
    const form = ref(createEmptyUser());
    const statusType = ref("loading");
    const statusTitle = ref("กำลังตรวจสอบสิทธิ์");
    const statusDesc = ref("โหลด session และข้อมูลจาก Firestore users");
    const navItems = computed(() => common.getNavItems(session.value?.role || "masteradmin", "users"));

    // === Right Panel Mode ===
    const rightMode = ref("edit"); // "edit" | "create"
    const createForm = ref(createEmptyCreateForm());

    const filteredUsers = computed(() => {
      const q = query.value.trim().toLowerCase();
      const list = Array.isArray(users.value) ? users.value : [];
      if (!q) return list;
      return list.filter((u) => {
        const hay = [u.uid, u.email, u.displayName, u.role, u.note].join(" ").toLowerCase();
        return hay.includes(q);
      });
    });

    function rowKey(user) {
      return String(user?.uid || user?.email || "");
    }

    function roleClass(role) {
      const r = String(role || "user").toLowerCase();
      if (r === "masteradmin") return "good";
      if (r === "admin") return "warning";
      return "";
    }

    function setStatus(type, title, desc) {
      statusType.value = type;
      statusTitle.value = title;
      statusDesc.value = desc;
    }

    function newUser() {
      selectedKey.value = "";
      form.value = createEmptyUser();
    }

    function pickUser(user) {
      selectedKey.value = rowKey(user);
      form.value = {
        uid: user.uid || "",
        email: user.email || "",
        displayName: user.displayName || "",
        role: user.role || "user",
        active: user.active !== false,
        note: user.note || "",
        visibleAreas: user.visibleAreas || "",
      };
      rightMode.value = "edit";
    }

    function switchMode(mode) {
      rightMode.value = String(mode || "edit");
      if (rightMode.value === "create") {
        createForm.value = createEmptyCreateForm();
      }
    }

    async function logout() {
      await FirebaseRole.signOut();
      location.replace("./index.html");
    }

    async function loadSession() {
      const s = await FirebaseRole.currentSession(false);
      session.value = s;
      if (!s) {
        location.replace("./index.html");
        return false;
      }
      if (s.role !== "masteradmin") {
        setStatus("error", "ไม่มีสิทธิ์เข้าหน้านี้", "หน้านี้เปิดให้ masteradmin เท่านั้น");
        return false;
      }
      return true;
    }

    async function reload() {
      loading.value = true;
      setStatus("loading", "กำลังโหลด users", "ดึงข้อมูลจาก Firestore collection users");
      try {
        const list = await CheckinCommon.getUsers();
        users.value = Array.isArray(list)
          ? [...list].sort((a, b) => String(a.email || a.uid || "").localeCompare(String(b.email || b.uid || "")))
          : [];
        if (!selectedKey.value && users.value.length) {
          pickUser(users.value[0]);
        }
        setStatus("success", "โหลดสำเร็จ", `พบผู้ใช้ทั้งหมด ${users.value.length} รายการ`);
      } catch (err) {
        setStatus("error", "โหลดไม่สำเร็จ", err?.message || "อ่าน users จาก Firestore ไม่ได้");
      } finally {
        loading.value = false;
      }
    }

    async function syncCurrentUser() {
      try {
        saving.value = true;
        setStatus("loading", "กำลังซิงก์ผู้ใช้ปัจจุบัน", "ดึง session จาก Firebase Auth แล้วบันทึกลง Firestore users");
        const s = await FirebaseRole.currentSession(false);
        if (!s?.user) throw new Error("ไม่พบ session ปัจจุบัน");
        await CheckinCommon.saveUser({
          uid: s.user.uid,
          email: s.user.email || "",
          displayName: s.user.displayName || s.user.email || "",
          role: s.role || "user",
          active: true,
          note: form.value.note || "",
          visibleAreas: form.value.visibleAreas || "",
        });
        await reload();
        const matched = users.value.find((u) =>
          String(u.uid || "") === String(s.user.uid || "") ||
          String(u.email || "").toLowerCase() === String(s.user.email || "").toLowerCase()
        );
        if (matched) pickUser(matched);
        setStatus("success", "ซิงก์สำเร็จ", "บันทึกข้อมูลจากบัญชีที่ล็อกอินอยู่ลง Firestore แล้ว");
      } catch (err) {
        setStatus("error", "ซิงก์ไม่สำเร็จ", err?.message || "เกิดข้อผิดพลาด");
      } finally {
        saving.value = false;
      }
    }

    async function save() {
      try {
        if (session.value?.role !== "masteradmin") throw new Error("masteradmin เท่านั้นที่แก้ role ได้");
        if (!String(form.value.uid || form.value.email || "").trim()) throw new Error("กรุณาใส่ uid หรือ email อย่างน้อย 1 ค่า");
        saving.value = true;
        setStatus("loading", "กำลังบันทึก", "กำลังอัปเดตเอกสารใน Firestore users");
        await CheckinCommon.saveUser(form.value);
        await reload();
        const key = String(form.value.uid || form.value.email || "");
        const found = users.value.find((u) => rowKey(u) === key || String(u.email || "").toLowerCase() === String(form.value.email || "").toLowerCase());
        if (found) pickUser(found);
        setStatus("success", "บันทึกเรียบร้อย", "role ถูกอัปเดตแล้ว");
      } catch (err) {
        setStatus("error", "บันทึกไม่สำเร็จ", err?.message || "เกิดข้อผิดพลาด");
      } finally {
        saving.value = false;
      }
    }

    async function remove() {
      try {
        if (session.value?.role !== "masteradmin") throw new Error("masteradmin เท่านั้นที่ลบได้");
        const key = String(form.value.uid || form.value.email || "").trim();
        if (!key) throw new Error("ยังไม่ได้เลือก user");
        if (!confirm(`ลบ user นี้ใช่ไหม?\n${key}`)) return;
        saving.value = true;
        setStatus("loading", "กำลังลบ", "กำลังลบเอกสารจาก Firestore users");
        await CheckinCommon.deleteUser(form.value);
        newUser();
        await reload();
        setStatus("success", "ลบแล้ว", "เอกสารถูกลบเรียบร้อย");
      } catch (err) {
        setStatus("error", "ลบไม่สำเร็จ", err?.message || "เกิดข้อผิดพลาด");
      } finally {
        saving.value = false;
      }
    }

    // ✅ สร้าง Firebase Auth user + Firestore doc พร้อมกัน
    // Password ไม่ถูกเก็บที่ไหนเลย — ส่งไปแค่ Firebase Auth REST API
    async function createNewUser() {
      try {
        const f = createForm.value;
        const email = String(f.email || "").trim();
        const password = String(f.password || "");
        const confirmPw = String(f.confirmPw || "");
        const displayName = String(f.displayName || "").trim();
        const role = String(f.role || "user");

        if (!email) throw new Error("กรุณากรอก Email");
        if (!password) throw new Error("กรุณากรอก Password");
        if (password.length < 6) throw new Error("Password ต้องมีอย่างน้อย 6 ตัวอักษร");
        if (confirmPw && password !== confirmPw) throw new Error("Password ทั้งสองช่องไม่ตรงกัน");
        if (session.value?.role !== "masteradmin") throw new Error("masteradmin เท่านั้นที่สร้าง user ได้");

        creating.value = true;
        setStatus("loading", "กำลังสร้างบัญชี Firebase Auth", "ใช้ REST API สร้างบัญชี — masteradmin ยังคง login อยู่...");

        // Step 1: สร้าง Firebase Auth user ผ่าน REST API (ไม่กระทบ session ปัจจุบัน)
        const authUser = await CheckinCommon.createAuthUser(email, password, displayName);

        setStatus("loading", "กำลังบันทึก Role ลง Firestore", `สร้าง document สำหรับ ${authUser.email}...`);

        // Step 2: บันทึก role ลง Firestore (password ไม่ถูกเก็บ)
        await CheckinCommon.saveUser({
          uid: authUser.uid,
          email: authUser.email,
          displayName: authUser.displayName || displayName || authUser.email,
          role,
          active: true,
          note: "",
          visibleAreas: "",
        });

        // Step 3: Reload แล้ว select user ที่เพิ่งสร้าง
        await reload();
        const found = users.value.find((u) =>
          String(u.uid || "") === authUser.uid ||
          String(u.email || "").toLowerCase() === authUser.email.toLowerCase()
        );
        if (found) pickUser(found);

        // Reset form → กลับ edit mode
        createForm.value = createEmptyCreateForm();
        rightMode.value = "edit";

        setStatus("success", "สร้าง User สำเร็จ ✅", `${authUser.email} (${role}) ถูกสร้างใน Firebase Auth + Firestore แล้ว`);
      } catch (err) {
        setStatus("error", "สร้าง User ไม่สำเร็จ", err?.message || "เกิดข้อผิดพลาด");
      } finally {
        creating.value = false;
      }
    }

    onMounted(async () => {
      try {
        const ok = await loadSession();
        if (!ok) return;
        await reload();
      } catch (err) {
        setStatus("error", "ไม่สามารถเริ่มหน้า Users ได้", err?.message || "ตรวจสอบ Firebase ไม่สำเร็จ");
      }
    });

    return {
      session,
      users,
      loading,
      saving,
      creating,
      query,
      selectedKey,
      form,
      createForm,
      rightMode,
      filteredUsers,
      statusType,
      statusTitle,
      statusDesc,
      navItems,
      rowKey,
      roleClass,
      pickUser,
      newUser,
      switchMode,
      save,
      remove,
      reload,
      syncCurrentUser,
      createNewUser,
      logout,
    };
  },
  template: '#users-template'
}).mount('#app');
