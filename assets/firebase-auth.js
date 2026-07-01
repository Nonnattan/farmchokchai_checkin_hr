(function () {
  const cfg = window.FIREBASE_CONFIG || {};
  const initialized = { value: false };
  let authInstance = null;
  let authReadyPromise = null;

  function ensureFirebase() {
    if (initialized.value && authInstance) return authInstance;
    if (!window.firebase || !firebase.initializeApp) {
      throw new Error("ไม่สามารถโหลด Firebase SDK ได้");
    }
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    authInstance = firebase.auth();
    authInstance.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
    initialized.value = true;
    return authInstance;
  }

  function getAuth() {
    return ensureFirebase();
  }

  function waitForAuthReady(timeoutMs = 6000) {
    const auth = ensureFirebase();
    if (auth.currentUser) return Promise.resolve(auth.currentUser);
    if (!authReadyPromise) {
      authReadyPromise = new Promise((resolve) => {
        const unsubscribe = auth.onAuthStateChanged((user) => {
          try { unsubscribe && unsubscribe(); } catch (e) {}
          resolve(user || null);
        });
      });
    }

    if (!timeoutMs) return authReadyPromise;

    return Promise.race([
      authReadyPromise,
      new Promise((resolve) => setTimeout(() => resolve(auth.currentUser || null), timeoutMs)),
    ]);
  }

  async function signIn(email, password) {
    const auth = ensureFirebase();
    const userCred = await auth.signInWithEmailAndPassword(email, password);
    return userCred.user;
  }

  async function signOut() {
    const auth = ensureFirebase();
    await auth.signOut();
  }

  function homeRoute(role) {
    const r = String(role || "user").toLowerCase();
    if (r === "user") return "./user/checkin.html";
    if (r === "masteradmin") return "./users.html";
    return "./qr_code.html";
  }

  function normalizeRole(role) {
    const r = String(role || "user").toLowerCase();
    return ({ masteradmin: "masteradmin", admin: "admin", user: "user" })[r] || "user";
  }

  async function readRoleFromSystem(user, forceRefresh = false) {
    const claims = {};
    let active = true;
    let profile = null;
    let firestoreRole = null;

    try {
      const token = await user.getIdTokenResult(!!forceRefresh);
      Object.assign(claims, token?.claims || {});
    } catch (err) {
      // If refresh/token read fails, continue using Firestore + bootstrap rules.
    }

    try {
      if (window.CheckinCommon && typeof window.CheckinCommon.resolveUserAccess === "function") {
        const access = await window.CheckinCommon.resolveUserAccess(user);
        profile = access?.user || null;
        firestoreRole = normalizeRole(access?.role || "user");
        active = access?.active !== false;
      }
    } catch (err) {}

    const bootstrapRole = window.CheckinCommon?.isBootstrapMasteradminEmail?.(String(user?.email || "").trim().toLowerCase())
      ? "masteradmin"
      : null;
    const claimRole = normalizeRole(claims.role);
    const role = normalizeRole(bootstrapRole || firestoreRole || claimRole);

    return { role, claims, profile, active };
  }

  async function currentSession(forceRefresh = false) {
    const auth = ensureFirebase();
    await waitForAuthReady();
    const user = auth.currentUser;
    if (!user) return null;

    try {
      const { role, claims, profile, active } = await readRoleFromSystem(user, forceRefresh);
      return { user, role, claims, profile, active };
    } catch (err) {
      // Never force a redirect loop because role resolution failed.
      return {
        user,
        role: normalizeRole(window.CheckinCommon?.isBootstrapMasteradminEmail?.(String(user.email || "").trim().toLowerCase()) ? "masteradmin" : "user"),
        claims: {},
        profile: null,
        active: true,
      };
    }
  }

  function onStateChanged(callback) {
    const auth = ensureFirebase();
    return auth.onAuthStateChanged(async (user) => {
      if (!user) {
        callback(null);
        return;
      }
      try {
        const { role, claims, profile, active } = await readRoleFromSystem(user, false);
        callback({ user, role, claims, profile, active });
      } catch (err) {
        callback({
          user,
          role: normalizeRole(window.CheckinCommon?.isBootstrapMasteradminEmail?.(String(user.email || "").trim().toLowerCase()) ? "masteradmin" : "user"),
          claims: {},
          profile: null,
          active: true,
        });
      }
    });
  }

  async function requireRole(allowedRoles, redirectTo = "./index.html") {
    const session = await currentSession(false);
    if (!session) {
      window.location.replace(redirectTo);
      return null;
    }
    if (session.active === false) {
      window.location.replace(redirectTo);
      return null;
    }
    const allowed = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    const ok = allowed.includes(session.role) || session.role === "masteradmin";
    if (!ok) {
      const target = session.role === "user" ? "./user/checkin.html" : "./qr_code.html";
      window.location.replace(target);
      return null;
    }
    return session;
  }

  window.FirebaseRole = {
    getAuth,
    waitForAuthReady,
    signIn,
    signOut,
    currentSession,
    onStateChanged,
    requireRole,
    homeRoute,
  };
})();
