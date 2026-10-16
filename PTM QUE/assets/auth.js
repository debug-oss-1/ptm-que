import { auth, db } from "./firebase.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js";

export const Auth = {
  currentUser: null,
  authUnsubscribe: null,
  userData: null,
  isInitialized: false,
  _initPromise: null,

  // FIX (slow loading): this used to open a brand-new onAuthStateChanged
  // listener — and do a fresh network read of the user's DB record — on
  // every call. Every protected page called this twice (once automatically
  // below, once explicitly in login.html/admin.js/super-admin.js), so page
  // load was waiting on two sequential round trips to Firebase instead of
  // one. Caching the promise means the second call just reuses the first
  // call's in-flight/resolved result.
  init() {
    if (this._initPromise) return this._initPromise;
    let resolved = false;
    this._initPromise = new Promise((resolve) => {
      const settle = (value) => { if (!resolved) { resolved = true; resolve(value); } };
      this.authUnsubscribe = onAuthStateChanged(auth, async (user) => {
        this.currentUser = user;
        this.isInitialized = true;
        if (user) {
          try {
            const snap = await get(ref(db, `ptm/users/${user.uid}`));
            if (!snap.exists()) { console.error("Auth init: missing DB record for uid="+user.uid); this.userData = null; await signOut(auth); settle(null); return; }
            const ud = snap.val();
            if (ud.status === "disabled") { console.error("Auth init: disabled account uid="+user.uid); this.userData = null; await signOut(auth); settle(null); return; }
            this.userData = ud;
          } catch (e) { console.error("Auth role load error:", e); this.userData = null; }
        } else { this.userData = null; }
        settle(user);
      }, (error) => { console.error("Auth state error:", error); this.isInitialized = true; settle(null); });
    });
    return this._initPromise;
  },

  async login(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const user = cred.user;
    const snap = await get(ref(db, `ptm/users/${user.uid}`));
    if (!snap.exists()) throw new Error("Login blocked: no DB record at ptm/users/" + user.uid + ". Create record via Firebase Console Database or create-user.html.");
    const ud = snap.val();
    if (ud.status === "disabled") throw new Error("Account disabled. Contact admin.");
    if (!ud.role) throw new Error("Login blocked: DB record missing role field.");
    this.userData = ud; this.currentUser = user;
    return user;
  },

  async logout() { await signOut(auth); this.currentUser = null; this.userData = null; },

  isAuthenticated() { return !!this.currentUser && !!this.userData; },
  isSuperAdmin() { return this.userData?.role === "super-admin"; },
  isAdmin() { return this.userData?.role === "admin"; },
  getRole() { return this.userData?.role || null; },
  getName() { return this.userData?.name || null; },
  getUserId() { return this.currentUser?.uid || null; },
  getUserData() { return this.userData; }
};

// FIX: no DOM is touched here, so there's no need to wait for DOMContentLoaded
// or add an artificial delay — start authenticating the instant this loads.
Auth.init();
window.addEventListener("beforeunload", () => { if (Auth.authUnsubscribe) Auth.authUnsubscribe(); });

window.Auth = Auth;
