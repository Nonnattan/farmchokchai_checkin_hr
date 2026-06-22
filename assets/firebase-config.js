(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyAqGtwRWE1ijM5o0P1Fg3fhm4Q-dt3SzwA",
    authDomain: "checkin-hr-68582.firebaseapp.com",
    projectId: "checkin-hr-68582",
    storageBucket: "checkin-hr-68582.firebasestorage.app",
    messagingSenderId: "239208677365",
    appId: "1:239208677365:web:73b46191db1d05e0026abc",
    measurementId: "G-LWNRL00ZWS",
  };

  window.FIREBASE_CONFIG = firebaseConfig;

  if (!window.firebase || !firebase.initializeApp) {
    return;
  }

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  try {
    window.FIREBASE_APP = firebase.app();
  } catch (err) {}

  try {
    if (typeof firebase.auth === "function") {
      window.FIREBASE_AUTH = firebase.auth();
      window.FIREBASE_AUTH.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
    }
  } catch (err) {}

  try {
    if (typeof firebase.firestore === "function") {
      window.FIREBASE_DB = firebase.firestore();
    }
  } catch (err) {}
})();
