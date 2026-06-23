const { createApp, ref, computed, onMounted, onBeforeUnmount } = Vue;
const common = window.CheckinCommon || {};
const db = firebase.firestore();
const serverTimestamp = firebase.firestore.FieldValue.serverTimestamp;

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

function normalizeUser(docSnap) {
  const data = typeof docSnap?.data === "function" ? (docSnap.data() || {}) : (docSnap || {});
  const uid = String(data.uid || docSnap?.id || "").trim();
  return {
    uid,
    email: data.email || "",
    displayName: data.displayName || "",
    role: data.role || "user",
    active: data.active !== false,
    note: data.note || "",
    visibleAreas: data.visibleAreas || "",
    ...data,
    uid,
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
    const selectedUser = ref(null);
    const form = ref(createEmptyUser());
    const statusType = ref("loading");
    const statusTitle = ref("กำลังตรวจสอบสิทธิ์");
    const statusDesc = ref("โหลด session และข้อมูลจาก Firestore users");
    const navItems = computed(() => common.getNavItems(session.value?.role || "masteradmin", "users"));

    const rightMode = ref("edit");
    const createForm = ref(createEmptyCreateForm());
    let unsubscribeUsers = null;

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

    function resetFormFromUser(user) {
      form.value = {
        uid: user.uid || "",
        email: user.email || "",
        displayName: user.displayName || "",
        role: user.role || "user",
        active: user.active !== false,
        note: user.note || "",
        visibleAreas: user.visibleAreas || "",
      };
    }

    function clearSelection() {
      selectedKey.value = "";
      selectedUser.value = null;
      form.value = createEmptyUser();
    }

    function pickUser(user) {
      const normalized = normalizeUser(user);
      selectedKey.value = normalized.uid;
      selectedUser.value = normalized;
      resetFormFromUser(normalized);
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

    async function loadUsersOnce() {
      const snap = await db.collection("users").get();
      const list = snap.docs.map((d) => normalizeUser(d));
      list.sort((a, b) => String(a.email || a.uid || "").localeCompare(String(b.email || b.uid || "")));
      users.value = list;
      if (!selectedKey.value && list.length) {
        pickUser(list[0]);
      }
      setStatus("success", "โหลดสำเร็จ", `พบผู้ใช้ทั้งหมด ${list.length} รายการ`);
    }

    function startUsersListener() {
      if (unsubscribeUsers) unsubscribeUsers();

      loading.value = true;
      setStatus("loading", "กำลังโหลด users", "อ่านข้อมูลจาก Firestore collection users");

      unsubscribeUsers = db.collection("users").onSnapshot(
        (snap) => {
          const list = snap.docs.map((d) => normalizeUser(d));
          list.sort((a, b) => String(a.email || a.uid || "").localeCompare(String(b.email || b.uid || "")));
          users.value = list;

          if (selectedKey.value) {
            const matched = list.find((u) => rowKey(u) === selectedKey.value);
            if (matched) {
              selectedUser.value = matched;
              resetFormFromUser(matched);
            }
          } else if (!selectedUser.value && list.length) {
            pickUser(list[0]);
          }

          if (loading.value) {
            setStatus("success", "โหลดสำเร็จ", `พบผู้ใช้ทั้งหมด ${list.length} รายการ`);
          }
          loading.value = false;
        },
        (err) => {
          loading.value = false;
          setStatus("error", "โหลดไม่สำเร็จ", err?.message || "อ่าน users จาก Firestore ไม่ได้");
        }
      );
    }

    async function reload() {
      loading.value = true;
      setStatus("loading", "กำลังรีเฟรช", "ดึงข้อมูลล่าสุดจาก Firestore");
      try {
        await loadUsersOnce();
      } catch (err) {
        setStatus("error", "รีเฟรชไม่สำเร็จ", err?.message || "เกิดข้อผิดพลาด");
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

        const payload = {
          uid: s.user.uid,
          email: s.user.email || "",
          displayName: s.user.displayName || s.user.email || "",
          role: s.role || "user",
          active: true,
          note: form.value.note || "",
          visibleAreas: form.value.visibleAreas || "",
          updatedAt: serverTimestamp(),
        };

        await db.collection("users").doc(s.user.uid).set(payload, { merge: true });
        selectedKey.value = s.user.uid;
        await reload();
        const matched = users.value.find((u) => rowKey(u) === s.user.uid);
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

        const uid = String(selectedKey.value || form.value.uid || "").trim();
        if (!uid) throw new Error("กรุณาเลือก user จากตารางด้านซ้ายก่อน");

        saving.value = true;
        setStatus("loading", "กำลังบันทึก", "กำลังอัปเดต document ใน Firestore users");

        const payload = {
          uid,
          email: String(form.value.email || "").trim(),
          displayName: String(form.value.displayName || "").trim(),
          role: String(form.value.role || "user"),
          active: form.value.active !== false,
          note: String(form.value.note || ""),
          visibleAreas: String(form.value.visibleAreas || ""),
          updatedAt: serverTimestamp(),
        };

        await db.collection("users").doc(uid).set(payload, { merge: true });
        await reload();

        const found = users.value.find((u) => rowKey(u) === uid);
        if (found) pickUser(found);

        setStatus("success", "บันทึกเรียบร้อย", "role / active / email ถูกอัปเดตแล้ว");
      } catch (err) {
        setStatus("error", "บันทึกไม่สำเร็จ", err?.message || "เกิดข้อผิดพลาด");
      } finally {
        saving.value = false;
      }
    }

    async function remove() {
      try {
        if (session.value?.role !== "masteradmin") throw new Error("masteradmin เท่านั้นที่ลบได้");
        const uid = String(selectedKey.value || "").trim();
        if (!uid) throw new Error("ยังไม่ได้เลือก user");
        if (!confirm(`ลบ user นี้ใช่ไหม?\n${uid}`)) return;

        saving.value = true;
        setStatus("loading", "กำลังลบ", "กำลังลบเอกสารจาก Firestore users");
        await db.collection("users").doc(uid).delete();
        clearSelection();
        await reload();
        setStatus("success", "ลบแล้ว", "เอกสารถูกลบเรียบร้อย");
      } catch (err) {
        setStatus("error", "ลบไม่สำเร็จ", err?.message || "เกิดข้อผิดพลาด");
      } finally {
        saving.value = false;
      }
    }

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
        setStatus("loading", "กำลังสร้างบัญชี Firebase Auth", "ใช้ REST API สร้างบัญชี — masteradmin ยังคง login อยู่");

        const authUser = await CheckinCommon.createAuthUser(email, password, displayName);
        if (!authUser?.uid) throw new Error("สร้าง Firebase Auth ไม่สำเร็จ");

        setStatus("loading", "กำลังบันทึกลง Firestore", `กำลังสร้าง document users/${authUser.uid}`);

        const payload = {
          uid: authUser.uid,
          email: authUser.email || email,
          displayName: authUser.displayName || displayName || authUser.email || email,
          role,
          active: true,
          note: "",
          visibleAreas: "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        await db.collection("users").doc(authUser.uid).set(payload, { merge: true });

        createForm.value = createEmptyCreateForm();
        rightMode.value = "edit";
        selectedKey.value = authUser.uid;
        await reload();

        const found = users.value.find((u) => rowKey(u) === authUser.uid);
        if (found) pickUser(found);

        setStatus("success", "สร้าง User สำเร็จ ✅", `${payload.email} (${role}) ถูกบันทึกลง Auth + Firestore แล้ว`);
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
        startUsersListener();
      } catch (err) {
        setStatus("error", "ไม่สามารถเริ่มหน้า Users ได้", err?.message || "ตรวจสอบ Firebase ไม่สำเร็จ");
      }
    });

    onBeforeUnmount(() => {
      if (unsubscribeUsers) unsubscribeUsers();
    });

    return {
      session,
      users,
      loading,
      saving,
      creating,
      query,
      selectedKey,
      selectedUser,
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
      clearSelection,
      switchMode,
      save,
      remove,
      reload,
      syncCurrentUser,
      createNewUser,
      logout,
    };
  },
  template: "#users-template",
}).mount("#app");