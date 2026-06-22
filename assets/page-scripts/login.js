const { createApp, ref, onMounted } = Vue;

createApp({
  setup() {
    const email = ref("");
    const password = ref("");
    const loading = ref(false);
    const message = ref("กรุณาเข้าสู่ระบบด้วย Firebase");
    const state = ref("idle");
    const role = ref("");

    function goHome(session) {
      const target = FirebaseRole.homeRoute(session?.role);
      location.replace(target);
    }


    async function login() {
      try {
        loading.value = true;
        state.value = "idle";
        message.value = "กำลังตรวจสอบข้อมูลเข้าสู่ระบบ...";
        await FirebaseRole.signIn(email.value.trim(), password.value);
        const session = await FirebaseRole.currentSession(false);
        role.value = session?.role || "user";
        state.value = "success";
        message.value = `เข้าสู่ระบบสำเร็จ (${session?.user?.email || email.value.trim() || 'no email'})`;
        setTimeout(() => goHome(session), 250);
      } catch (err) {
        state.value = "error";
        message.value = err?.message || "เข้าสู่ระบบไม่สำเร็จ";
      } finally {
        loading.value = false;
      }
    }

    return { email, password, loading, message, state, role, login };
  },
  template: '#login-template'
}).mount('#app');
