// ============================================================
// PTM SYSTEM — ADMIN (TEACHER) PANEL LOGIC (FIXED)
// ============================================================
// FIXES APPLIED:
// - All paths use room-specific structure (ptm/rooms/{roomId}/...)
// - Removed global session references
// - Fixed listener cleanup and deduplication
// - Fixed queue number generation with per-room transactions
// - Fixed admin data loading and authentication
// - Fixed multi-room room selection and state management
// - Added comprehensive error handling
// - Fixed DOM element access with null safety
// ============================================================

import { db, PATHS, sanitizeAdminId } from "./firebase.js";
import { Auth } from "./auth.js";
import {
  ref,
  get,
  set,
  update,
  remove,
  push,
  runTransaction,
  onValue,
  off,
  query,
  orderByKey,
  startAt,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js";

// ---------- DOM references (with null safety) ----------

function getDOMElement(id) {
  const el = document.getElementById(id);
  if (!el) console.warn(`DOM element not found: ${id}`);
  return el;
}

const screens = {
  login: getDOMElement("screen-login"),
  dashboard: getDOMElement("screen-dashboard"),
  adminJoins: getDOMElement("screen-admin-joins")
};

const banner = getDOMElement("banner");
const loginUsername = getDOMElement("login-username");
const loginPassword = getDOMElement("login-password");
const loginError = getDOMElement("login-error");
const loginUsernameError = getDOMElement("login-username-error");
const loginSubmit = getDOMElement("login-submit");
const logoutBtn = getDOMElement("logout-btn");

const adminSectionInfo = getDOMElement("admin-section-info");
const adminCurrentNumberEl = getDOMElement("admin-current-number");
const adminRoomInfo = getDOMElement("admin-room-info");
const nextStudentLabelEl = getDOMElement("next-student-label");
const nextBtn = getDOMElement("next-btn");
const undoBtn = getDOMElement("undo-btn");
const newSessionBtn = getDOMElement("new-session-btn");

const waitingCountEl = getDOMElement("waiting-count");
const waitingListEl = getDOMElement("waiting-list");

const archiveToggleEl = getDOMElement("archive-toggle");
const archiveCaretEl = getDOMElement("archive-caret");
const archiveCountEl = getDOMElement("archive-count");
const archiveListEl = getDOMElement("archive-list");
const exportActionsEl = getDOMElement("export-actions");
const archiveExportCsvBtn = getDOMElement("archive-export-csv-btn");
const archiveExportPdfBtn = getDOMElement("archive-export-pdf-btn");

const modalOverlay = getDOMElement("modal-overlay");
const modalCancel = getDOMElement("modal-cancel");
const modalConfirm = getDOMElement("modal-confirm");

const btnJoinAsAdmin = getDOMElement("btn-join-as-admin");
const adminJoinsBack = getDOMElement("admin-joins-back");
const adminJoinsAdd = getDOMElement("admin-joins-add");
const adminJoinsListEl = getDOMElement("admin-joins-list");
const addEntryModal = getDOMElement("add-entry-modal");
const aeCancel = getDOMElement("ae-cancel");
const aeSubmit = getDOMElement("ae-submit");
const aeType = getDOMElement("ae-type");
const aeThisFields = getDOMElement("ae-this-fields");
const aeOtherFields = getDOMElement("ae-other-fields");
const toastContainer = getDOMElement("toast-container");

// ---------- State ----------

const UNLOCK_KEY = "ptm_admin_unlocked";
const LS_ADMIN_NUMBERS = "ptm_admin_queue_numbers";

let currentStudent = 0;
let lastNumber = 0;
let listenersAttached = false;
let archiveRecords = [];
let archiveExpanded = false;
// DOWNLOAD SAVER state
let archiveLoadedAt = 0;        // 0 = history (archive) not downloaded yet; it is fetched only when opened or exported
let studentsWindowStart = null; // lowest queue number we listen to; students already served are never downloaded
let studentsAttachRun = 0;      // guards against overlapping attach calls
let adminNumbers = loadAdminNumbers();
let toastedFor = new Set();

// FIX: Track all active listeners for cleanup
let activeListeners = {
  currentStudent: null,
  lastNumber: null,
  students: null,
  archive: null
};

// Multi-room state
let adminData = null;
let assignedRooms = [];
let selectedRoomId = null;
let selectedRoomData = null;
let currentRoomStudentsCache = {};
let currentRoomArchiveCache = {};

function loadAdminDataFromAuth() {
  const ud = Auth.getUserData();
  if (!ud) return null;
  return {
    ...ud,
    adminId: Auth.getUserId(),
    roomId: ud.roomId || null,
    classId: ud.classId || null,
    sectionId: ud.sectionId || null
  };
}

// ---------- Helpers ----------

function showScreen(name) {
  Object.values(screens).forEach((s) => s && s.classList.remove("active"));
  if (screens[name]) screens[name].classList.add("active");
}

function showBanner(message, type = "error") {
  if (!banner) return;
  banner.textContent = message;
  banner.className = "banner visible" + (type === "info" ? " info" : "");
}

function hideBanner() {
  if (!banner) return;
  banner.className = "banner";
}

function formatDuration(seconds) {
  if (seconds == null || seconds === "" || isNaN(seconds)) return "—";
  const s = Math.max(0, Math.round(Number(seconds)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function formatClassLabel(cls) {
  if (!cls) return "";
  const n = Number(cls);
  if (isNaN(n)) return String(cls);
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return n + "th";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loadAdminNumbers() {
  try {
    const raw = localStorage.getItem(LS_ADMIN_NUMBERS);
    return raw ? JSON.parse(raw).map(Number) : [];
  } catch {
    return [];
  }
}

function saveAdminNumbers() {
  localStorage.setItem(LS_ADMIN_NUMBERS, JSON.stringify(adminNumbers));
}

function showToast(message, type = "info") {
  if (!toastContainer) return;

  const el = document.createElement("div");
  el.className =
    "pointer-events-auto px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white animate-slide-in " +
    (type === "success" ? "bg-emerald-600" : type === "warning" ? "bg-amber-500" : "bg-indigo-600");
  el.textContent = message;
  toastContainer.appendChild(el);

  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateX(12px)";
    el.style.transition = "all 0.3s ease";
    setTimeout(() => el.remove(), 300);
  }, 4500);
}

// FIX: Cleanup old listeners before attaching new ones
function cleanupRoomListeners() {
  Object.values(activeListeners).forEach(listener => {
    if (listener) off(listener);
  });
  activeListeners = {
    currentStudent: null,
    lastNumber: null,
    students: null,
    archive: null
  };
  currentRoomStudentsCache = {};
  currentRoomArchiveCache = {};
  archiveLoadedAt = 0;
  studentsWindowStart = null;
  studentsAttachRun++; // cancels any attach still waiting for its first read
}

// ---------- Auth-based access ----------

function initAuthAccess() {
  if (!Auth.isAuthenticated()) {
    if (window.location.pathname.includes("admin.html")) {
      window.location.href = "login.html";
    }
    return;
  }
  if (!Auth.isAdmin() && !Auth.isSuperAdmin()) {
    window.location.href = "login.html";
    return;
  }
  adminData = loadAdminDataFromAuth();
  if (!adminData || !adminData.roomId) {
    showBanner("Admin has no room assigned. Contact super admin.", "error");
    return;
  }
  enterDashboard();
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await Auth.logout();
    adminData = null;
    selectedRoomId = null;
    cleanupRoomListeners();
    window.location.href = "login.html";
  });
}

// Initialize when auth ready
Auth.init().then(() => {
  initAuthAccess();
});

// ---------- Load admin's assigned room ----------

async function loadAdminRooms() {
  try {
    if (!adminData || !adminData.roomId) {
      showBanner("Admin has no room assigned. Contact super admin.", "error");
      return;
    }

    let assignedRoom = null;

    // FIX (slow loading): this used to download the ENTIRE school config
    // (every class, every section, every room) on every single admin login,
    // just to find the one room this admin is assigned to. The admin's user
    // record already stores classId/sectionId/roomId (see create-user.html),
    // so we can read that one room directly — a small, fast, targeted fetch
    // instead of the whole tree. This gets slower every time a class/section/
    // room is added, even though the answer never depends on the other rooms.
    if (adminData.classId && adminData.sectionId) {
      const roomSnap = await get(
        ref(db, `${PATHS.CONFIG_ROOMS(adminData.classId, adminData.sectionId)}/${adminData.roomId}`)
      );
      if (roomSnap.exists()) {
        assignedRoom = {
          roomId: adminData.roomId,
          classId: adminData.classId,
          sectionId: adminData.sectionId,
          ...roomSnap.val()
        };
      }
    }

    // Fallback for older admin records saved before classId/sectionId were
    // stored: fall back to scanning the full config, but only in that case.
    if (!assignedRoom) {
      const snap = await get(ref(db, PATHS.CONFIG_CLASSES));
      if (!snap.exists()) {
        showBanner("No classes configured yet.", "error");
        return;
      }

      const classesData = snap.val() || {};

      Object.entries(classesData).forEach(([classId, classData]) => {
        Object.entries(classData.sections || {}).forEach(([sectionId, secData]) => {
          Object.entries(secData.rooms || {}).forEach(([roomId, roomData]) => {
            if (roomId === adminData.roomId) {
              assignedRoom = {
                roomId,
                classId,
                sectionId,
                ...roomData
              };
            }
          });
        });
      });
    }

    if (!assignedRoom) {
      showBanner("Assigned room not found. Contact super admin.", "error");
      return;
    }

    assignedRooms = [assignedRoom];
    selectRoom(assignedRoom.roomId, assignedRoom);
  } catch (err) {
    console.error("Failed to load room:", err);
    showBanner("Failed to load room", "error");
  }
}

function selectRoom(roomId, roomData) {
  // FIX: Cleanup old listeners when switching rooms
  cleanupRoomListeners();

  selectedRoomId = roomId;
  selectedRoomData = roomData;

  if (adminRoomInfo) {
    adminRoomInfo.textContent = `${formatClassLabel(roomData.classId)}-${roomData.sectionId} • Room ${roomData.room} • ${roomData.teacherName}`;
  }

  // Initialize room session if needed
  ensureRoomSessionExists();

  // Attach listeners for new room
  attachRoomListeners();
}


// ---------- Room-based Realtime Listeners (FIXED) ----------

async function ensureRoomSessionExists() {
  if (!selectedRoomId || !selectedRoomData) return;

  try {
    const sessionPath = PATHS.ROOM_SESSION(selectedRoomId);
    const snap = await get(ref(db, sessionPath));

    if (!snap.exists()) {
      await set(ref(db, sessionPath), {
        currentStudent: 0,
        lastNumber: 0,
        active: true,
        startedAt: serverTimestamp()
      });
      console.log("Initialized room session:", selectedRoomId);
    }
  } catch (err) {
    console.error("Failed to ensure room session:", err);
  }
}

function attachRoomListeners() {
  if (!selectedRoomId) return;

  const onError = (context) => (err) => {
    console.error(`Listener error (${context}):`, err);
    showBanner(`Database error: ${context}`, "error");
  };

  // FIX: Use room-specific paths for all listeners
  const sessionPath = PATHS.ROOM_SESSION(selectedRoomId);

  // Listen to currentStudent
  activeListeners.currentStudent = ref(db, `${sessionPath}/currentStudent`);
  onValue(
    activeListeners.currentStudent,
    (snap) => {
      currentStudent = snap.exists() ? snap.val() : 0;
      if (adminCurrentNumberEl) {
        adminCurrentNumberEl.textContent = currentStudent;
      }
      updateNextLabel();
      updateButtonStates();
      renderAdminJoinsList();
      checkAdminTurnToast();
      // Undo moved the queue back before our window: widen it so that student shows as waiting again
      if (studentsWindowStart !== null && currentStudent < studentsWindowStart) attachStudentsListener(currentStudent);
    },
    onError("room-currentStudent")
  );

  // Listen to lastNumber
  activeListeners.lastNumber = ref(db, `${sessionPath}/lastNumber`);
  onValue(
    activeListeners.lastNumber,
    (snap) => {
      lastNumber = snap.exists() ? snap.val() : 0;
      updateNextLabel();
      updateButtonStates();
    },
    onError("room-lastNumber")
  );

  // Students: only those still waiting (queue number >= now serving) are downloaded - see attachStudentsListener
  attachStudentsListener();
  // Archive (history): NOT live any more. It is downloaded only when the history is opened or exported - see loadArchive
}

// DOWNLOAD SAVER: listen only to students who are waiting or being served (keys are queue numbers, so a key query needs no index).
// Students already served are never downloaded, and each new join/update arrives as one small change.
async function attachStudentsListener(forceFrom) {
  const roomId = selectedRoomId;
  if (!roomId) return;
  const run = ++studentsAttachRun;
  if (activeListeners.students) { off(activeListeners.students); activeListeners.students = null; }

  let from = forceFrom;
  if (from == null) {
    try { from = Number((await get(ref(db, `${PATHS.ROOM_SESSION(roomId)}/currentStudent`))).val()) || 0; }
    catch (e) { from = 0; }
  }
  from = Math.max(0, from);

  // The admin's own entries that are already behind the window are still listed on the "Admin joins" screen - fetch just those few
  const extras = {};
  await Promise.all(adminNumbers.filter((n) => n < from).map(async (n) => {
    try {
      const s = (await get(ref(db, `${PATHS.ROOM_STUDENTS(roomId)}/${n}`))).val();
      if (s) extras[n] = s;
    } catch (e) {}
  }));
  if (run !== studentsAttachRun || roomId !== selectedRoomId) return; // room switched or a newer attach started

  studentsWindowStart = from;
  const q = query(ref(db, PATHS.ROOM_STUDENTS(roomId)), orderByKey(), startAt(String(from)));
  activeListeners.students = q;
  onValue(
    q,
    (snap) => {
      const live = {};
      snap.forEach((child) => { live[child.key] = child.val(); }); // braces: returning a value would stop forEach
      currentRoomStudentsCache = { ...extras, ...live };
      rebuildRecords();
      renderWaitingList(currentRoomStudentsCache);
      renderAdminJoinsList();

      // Prune adminNumbers that no longer exist
      const existing = new Set(Object.keys(currentRoomStudentsCache).map(Number));
      const pruned = adminNumbers.filter((n) => existing.has(n));
      if (pruned.length !== adminNumbers.length) {
        adminNumbers = pruned;
        saveAdminNumbers();
      }
    },
    (err) => {
      console.error("Listener error (room-students):", err);
      showBanner("Database error: room-students", "error");
    }
  );
}

// DOWNLOAD SAVER: the history is only shown when opened and used by the exports, so it is fetched on demand (once per 2 min unless forced)
async function loadArchive(force = false) {
  const roomId = selectedRoomId;
  if (!roomId) return;
  if (!force && archiveLoadedAt && Date.now() - archiveLoadedAt < 120000) return;
  try {
    const snap = await get(ref(db, PATHS.ROOM_ARCHIVE(roomId)));
    if (roomId !== selectedRoomId) return;
    currentRoomArchiveCache = snap.val() || {};
    archiveLoadedAt = Date.now();
    rebuildRecords();
  } catch (err) {
    console.error("Could not load records:", err);
    showBanner("Could not load records. Check your connection and try again.", "error");
  }
}

// ---------- Realtime Listeners (Initial) ----------

// FIX (data not loading): admin.js called enterDashboard() on login but never
// defined it anywhere in this file — it only existed in the unused teacher.js
// this was refactored from. That threw "enterDashboard is not defined" and
// crashed before the dashboard screen ever showed or any listener attached,
// which is why nothing loaded.
function enterDashboard() {
  showScreen("dashboard");
  hideBanner();
  if (!listenersAttached) {
    listenersAttached = true;
    attachRealtimeListeners();
  }
}

function attachRealtimeListeners() {
  if (adminData) {
    if (adminSectionInfo) {
      if (adminData.isSuperAdmin) {
        adminSectionInfo.textContent = "Role: Super Admin";
      } else {
        adminSectionInfo.textContent = `Class: ${formatClassLabel(adminData.classId)}-${adminData.sectionId}`;
      }
    }
  }

  loadAdminRooms();
}

function updateNextLabel() {
  const next = currentStudent + 1;
  if (nextStudentLabelEl) {
    nextStudentLabelEl.textContent = next <= lastNumber ? next : "—";
  }
}

function updateButtonStates() {
  if (nextBtn) nextBtn.disabled = currentStudent >= lastNumber;
  if (undoBtn) undoBtn.disabled = currentStudent <= 0;
}

function renderWaitingList(studentsObj) {
  if (!waitingListEl) return;

  const waiting = Object.values(studentsObj)
    .filter((s) => s.queueNumber > currentStudent)
    .sort((a, b) => a.queueNumber - b.queueNumber);

  if (waitingCountEl) {
    waitingCountEl.textContent = waiting.length;
  }

  if (waiting.length === 0) {
    waitingListEl.innerHTML = '<div class="empty-state text-sm text-slate-400 text-center py-6">No students waiting.</div>';
    return;
  }

  waitingListEl.innerHTML = waiting
    .map((s) => {
      const meta =
        s.type === "otherClass"
          ? `${escapeHtml(formatClassLabel(s.class))}-${escapeHtml(s.section || "")}`
          : `Roll ${escapeHtml(s.rollNo || "—")}`;
      const parentBit = s.parentName ? ` · ${escapeHtml(s.parentName)}` : "";
      const adminTag = s.isAdminEntry ? ' <span class="text-[10px] font-semibold text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">ADMIN</span>' : "";

      return `
        <div class="waiting-row flex items-center gap-3 px-4 py-3 border-b border-slate-50 last:border-0">
          <span class="wnum text-sm font-bold text-indigo-600 tabular-nums">#${s.queueNumber}</span>
          <span class="wname flex-1 text-sm font-medium text-slate-800 truncate">${escapeHtml(s.name || "")}${adminTag}</span>
          <span class="wmeta text-xs text-slate-400 truncate max-w-[40%]">${meta}${parentBit}</span>
        </div>`;
    })
    .join("");
}

// ---------- Admin Joins feature ----------

if (btnJoinAsAdmin) {
  btnJoinAsAdmin.addEventListener("click", () => {
    showScreen("adminJoins");
    renderAdminJoinsList();
  });
}

if (adminJoinsBack) {
  adminJoinsBack.addEventListener("click", () => {
    showScreen("dashboard");
  });
}

if (adminJoinsAdd) {
  adminJoinsAdd.addEventListener("click", () => {
    const nameInput = document.getElementById("ae-name");
    const rollInput = document.getElementById("ae-roll");
    const parentInput = document.getElementById("ae-parent");
    const relationInput = document.getElementById("ae-relation");

    if (nameInput) nameInput.value = "";
    if (rollInput) rollInput.value = "";
    if (parentInput) parentInput.value = "";
    if (relationInput) relationInput.value = "";

    if (aeType) aeType.value = "thisClass";
    if (aeThisFields) aeThisFields.classList.remove("hidden");
    if (aeOtherFields) aeOtherFields.classList.add("hidden");
    if (addEntryModal) addEntryModal.classList.add("visible");
  });
}

if (aeCancel) {
  aeCancel.addEventListener("click", () => {
    if (addEntryModal) addEntryModal.classList.remove("visible");
  });
}

if (aeType) {
  aeType.addEventListener("change", () => {
    if (aeType.value === "thisClass") {
      if (aeThisFields) aeThisFields.classList.remove("hidden");
      if (aeOtherFields) aeOtherFields.classList.add("hidden");
    } else {
      if (aeThisFields) aeThisFields.classList.add("hidden");
      if (aeOtherFields) aeOtherFields.classList.remove("hidden");
    }
  });
}

if (aeSubmit) {
  aeSubmit.addEventListener("click", handleAddEntry);
}

async function handleAddEntry() {
  const name = document.getElementById("ae-name")?.value.trim();
  const parent = document.getElementById("ae-parent")?.value.trim();
  const relation = document.getElementById("ae-relation")?.value.trim();

  if (!name) {
    showToast("Student name is required", "warning");
    return;
  }
  if (!parent) {
    showToast("Parent/Guardian name is required", "warning");
    return;
  }
  if (!relation) {
    showToast("Relation is required", "warning");
    return;
  }

  if (aeSubmit) {
    aeSubmit.disabled = true;
    aeSubmit.textContent = "Adding...";
  }

  try {
    if (!selectedRoomId || !selectedRoomData) {
      showToast("No room selected", "warning");
      return;
    }

    const sessionPath = PATHS.ROOM_SESSION(selectedRoomId);
    const lastNumberRef = ref(db, `${sessionPath}/lastNumber`);

    const result = await runTransaction(lastNumberRef, (current) => {
      return (current || 0) + 1;
    });

    if (!result.committed) {
      showToast("Could not assign number", "warning");
      return;
    }

    const assignedNumber = result.snapshot.val();
    const startedSnap = await get(ref(db, `${sessionPath}/startedAt`));
    const startedAt = startedSnap.val();

    const archiveRef = push(ref(db, PATHS.ROOM_ARCHIVE(selectedRoomId)));
    const archiveKey = archiveRef.key;

    const type = aeType?.value || "thisClass";
    const fields = {
      name,
      type,
      parentName: parent,
      relation,
      isAdminEntry: true,
      roomId: selectedRoomId,
      teacherName: selectedRoomData.teacherName,
      meetingType: selectedRoomData.meetingType,
      room: selectedRoomData.room || selectedRoomId,
      ownerUid: Auth.getUserId()
    };

    if (type === "thisClass") {
      fields.rollNo = document.getElementById("ae-roll")?.value.trim() || "—";
    } else {
      fields.class = document.getElementById("ae-class")?.value;
      fields.section = document.getElementById("ae-section")?.value;
    }

    await set(ref(db, `${PATHS.ROOM_STUDENTS(selectedRoomId)}/${assignedNumber}`), {
      ...fields,
      queueNumber: assignedNumber,
      createdAt: serverTimestamp(),
      archiveKey
    });

    try {
      await set(archiveRef, {
        ...fields,
        queueNumber: assignedNumber,
        sessionStartedAt: startedAt ?? null,
        createdAt: serverTimestamp()
      });
    } catch (e) {
      console.warn("Archive write failed (non-critical):", e);
    }

    adminNumbers.push(assignedNumber);
    saveAdminNumbers();
    toastedFor.delete(assignedNumber);

    if (addEntryModal) addEntryModal.classList.remove("visible");
    showToast(`Added #${assignedNumber} — ${name}`, "success");
    renderAdminJoinsList();
  } catch (err) {
    console.error("Failed to add entry:", err);
    showToast("Failed to add entry", "warning");
  } finally {
    if (aeSubmit) {
      aeSubmit.disabled = false;
      aeSubmit.textContent = "Add to Queue";
    }
  }
}

function getStatus(queueNum) {
  if (queueNum === currentStudent) return { label: "Your Turn", cls: "bg-emerald-100 text-emerald-700" };
  if (queueNum < currentStudent) return { label: "Passed", cls: "bg-amber-100 text-amber-700" };
  return { label: "Waiting", cls: "bg-slate-100 text-slate-600" };
}

function renderAdminJoinsList() {
  if (!adminJoinsListEl) return;

  const entries = adminNumbers
    .map((n) => {
      const s = currentRoomStudentsCache[n] || currentRoomStudentsCache[String(n)];
      return s ? { ...s, queueNumber: n } : { queueNumber: n, name: "(removed)", missing: true };
    })
    .sort((a, b) => a.queueNumber - b.queueNumber);

  if (entries.length === 0) {
    adminJoinsListEl.innerHTML =
      '<div class="empty-state text-sm text-slate-400 text-center py-8 bg-white/70 rounded-xl border border-slate-100">No admin entries yet.</div>';
    return;
  }

  adminJoinsListEl.innerHTML = entries
    .map((s) => {
      const status = getStatus(s.queueNumber);
      const meta =
        s.type === "thisClass"
          ? `Roll ${escapeHtml(s.rollNo || "")}`
          : s.type === "otherClass"
            ? `${escapeHtml(formatClassLabel(s.class))}-${escapeHtml(s.section || "")}`
            : "";

      return `
        <div class="flex items-center gap-3 bg-white/90 rounded-xl border border-slate-100 px-4 py-3 shadow-sm">
          <span class="text-sm font-bold text-indigo-600 tabular-nums w-10">#${s.queueNumber}</span>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold text-slate-800 truncate">${escapeHtml(s.name || "")}</div>
            <div class="text-xs text-slate-400 truncate">${meta}</div>
          </div>
          <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${status.cls}">${status.label}</span>
          <button data-delete-num="${s.queueNumber}" class="admin-delete-btn p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition" title="Delete">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>`;
    })
    .join("");

  adminJoinsListEl.querySelectorAll(".admin-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteAdminEntry(Number(btn.dataset.deleteNum)));
  });
}

async function deleteAdminEntry(queueNum) {
  if (!confirm(`Remove #${queueNum} from the queue?`)) return;

  try {
    if (!selectedRoomId) return;

    try { await ensureArchived(selectedRoomId, queueNum); } catch (e) { console.warn("Not archived before removal:", e); }
    await remove(ref(db, `${PATHS.ROOM_STUDENTS(selectedRoomId)}/${queueNum}`));
    adminNumbers = adminNumbers.filter((n) => n !== queueNum);
    saveAdminNumbers();
    toastedFor.delete(queueNum);
    showToast(`Removed #${queueNum}`, "info");
    renderAdminJoinsList();
  } catch (err) {
    console.error("Delete failed:", err);
    showToast("Could not delete entry", "warning");
  }
}

function checkAdminTurnToast() {
  for (const n of adminNumbers) {
    if (n === currentStudent && !toastedFor.has(n)) {
      toastedFor.add(n);
      const s = currentRoomStudentsCache[n] || currentRoomStudentsCache[String(n)];
      const name = s ? s.name : `#${n}`;
      showToast(`🔔 Your turn! ${name} (#${n})`, "success");
    }
  }
  for (const n of [...toastedFor]) {
    if (n !== currentStudent) toastedFor.delete(n);
  }
}

// ---------- Archive ----------

// Everyone who joined = archive records + live queue entries that have no archive copy yet.
// (Exports used to read the archive only, so anyone missing from it was missing from the export.)
function mergeRecords(archiveObj, studentsObj) {
  const students = Object.values(studentsObj || {}).filter(Boolean);
  const liveByKey = new Map(students.filter((s) => s.archiveKey).map((s) => [s.archiveKey, s]));
  const archived = archiveObj || {};
  const out = Object.entries(archived).map(([key, rec]) => {
    const live = liveByKey.get(key) || {};
    return { ...rec, _key: key, durationSeconds: rec.durationSeconds ?? live.durationSeconds ?? null, calledAt: rec.calledAt ?? live.calledAt ?? null };
  });
  students.forEach((s) => { if (!(s.archiveKey && archived[s.archiveKey])) out.push({ ...s }); });
  return out;
}

const recordTime = (s) => Number(s.createdAt || s.joinedAt || 0);
function rebuildRecords() {
  archiveRecords = mergeRecords(currentRoomArchiveCache, currentRoomStudentsCache).sort((x, y) => recordTime(y) - recordTime(x));
  renderArchive();
}

// Copies queue entries that are not in the archive yet (e.g. students who joined from the parent page) into it,
// so they are kept for the exports before the queue is cleared or an entry is removed.
async function ensureArchived(roomId, onlyNum = null) {
  const [stSnap, arSnap, startSnap] = await Promise.all([
    get(ref(db, PATHS.ROOM_STUDENTS(roomId))),
    get(ref(db, PATHS.ROOM_ARCHIVE(roomId))),
    get(ref(db, `${PATHS.ROOM_SESSION(roomId)}/startedAt`))
  ]);
  const students = stSnap.val() || {}, archived = arSnap.val() || {}, sessionStartedAt = startSnap.val() ?? null;
  let failed = 0;
  for (const [num, st] of Object.entries(students)) {
    if (!st || (onlyNum != null && Number(num) !== Number(onlyNum))) continue;
    if (st.archiveKey && archived[st.archiveKey]) continue;                    // already saved
    try {
      const archiveRef = st.archiveKey ? ref(db, `${PATHS.ROOM_ARCHIVE(roomId)}/${st.archiveKey}`) : push(ref(db, PATHS.ROOM_ARCHIVE(roomId)));
      const { archiveKey, status, assignedNumber, ...data } = st;
      await set(archiveRef, { ...data, queueNumber: st.queueNumber ?? Number(num), sessionStartedAt, createdAt: st.createdAt ?? st.joinedAt ?? serverTimestamp() });
      if (!st.archiveKey) await update(ref(db, `${PATHS.ROOM_STUDENTS(roomId)}/${num}`), { archiveKey: archiveRef.key });
    } catch (e) {
      console.warn("Could not archive queue entry", num, e);
      failed++;
    }
  }
  if (failed) throw new Error(`${failed} record(s) could not be saved to the export archive.`);
}

function renderArchive() {
  if (archiveCountEl) {
    archiveCountEl.textContent = archiveLoadedAt ? archiveRecords.length : "—"; // exact count appears once the history is opened
  }

  if (exportActionsEl) {
    exportActionsEl.style.display = (!archiveLoadedAt || archiveRecords.length > 0) ? "block" : "none";
  }

  if (!archiveExpanded || !archiveListEl) return;

  if (archiveRecords.length === 0) {
    archiveListEl.innerHTML = '<div class="empty-state text-sm text-slate-400 text-center py-6">No records yet.</div>';
    return;
  }

  archiveListEl.innerHTML = archiveRecords
    .map((s) => {
      const meta =
        s.type === "otherClass"
          ? `${escapeHtml(formatClassLabel(s.class))}-${escapeHtml(s.section || "")}`
          : `Roll ${escapeHtml(s.rollNo || "")}`;
      const when = (s.createdAt || s.joinedAt) ? new Date(s.createdAt || s.joinedAt).toLocaleString() : "";
      const dur = s.durationSeconds != null ? ` · ${formatDuration(s.durationSeconds)}` : "";

      return `
        <div class="waiting-row flex items-center gap-3 px-4 py-3 border-b border-slate-50 last:border-0">
          <span class="wnum text-sm font-bold text-indigo-600 tabular-nums">#${s.queueNumber ?? ""}</span>
          <span class="wname flex-1 text-sm font-medium text-slate-800 truncate">${escapeHtml(s.name || "")}</span>
          <span class="wmeta text-xs text-slate-400 truncate max-w-[45%]">${meta}${when ? " · " + escapeHtml(when) : ""}${dur}</span>
        </div>`;
    })
    .join("");
}

if (archiveToggleEl) {
  archiveToggleEl.addEventListener("click", async () => {
    archiveExpanded = !archiveExpanded;
    if (archiveListEl) {
      archiveListEl.style.display = archiveExpanded ? "block" : "none";
    }
    if (archiveCaretEl) {
      archiveCaretEl.textContent = archiveExpanded ? "▴" : "▾";
    }
    if (archiveExpanded) {
      if (archiveListEl && !archiveLoadedAt) archiveListEl.innerHTML = '<div class="empty-state text-sm text-slate-400 text-center py-6">Loading records…</div>';
      await loadArchive(); // downloads the history now (not before)
      renderArchive();
    }
  });
}

// ---------- Timers ----------

async function finalizeMeetingDuration(queueNum) {
  if (!queueNum || queueNum <= 0 || !selectedRoomId) return;

  try {
    const studentSnap = await get(ref(db, `${PATHS.ROOM_STUDENTS(selectedRoomId)}/${queueNum}`));
    if (!studentSnap.exists()) return;

    const student = studentSnap.val();
    if (!student.calledAt || student.durationSeconds != null) return;

    const now = Date.now();
    const calledAt = Number(student.calledAt);
    const durationSeconds = Math.max(0, Math.round((now - calledAt) / 1000));

    await update(ref(db, `${PATHS.ROOM_STUDENTS(selectedRoomId)}/${queueNum}`), {
      durationSeconds,
      endedAt: now
    });

    if (student.archiveKey) {
      try {
        await update(ref(db, `${PATHS.ROOM_ARCHIVE(selectedRoomId)}/${student.archiveKey}`), {
          durationSeconds,
          calledAt,
          endedAt: now
        });
      } catch (e) {
        console.warn("Archive update failed (non-critical):", e);
      }
    }
  } catch (err) {
    console.warn("finalizeMeetingDuration failed:", err);
  }
}

async function startMeetingTimer(queueNum) {
  if (!queueNum || queueNum <= 0 || !selectedRoomId) return;

  try {
    const studentSnap = await get(ref(db, `${PATHS.ROOM_STUDENTS(selectedRoomId)}/${queueNum}`));
    if (!studentSnap.exists()) return;

    const student = studentSnap.val();
    if (student.calledAt) return;

    const now = Date.now();
    await update(ref(db, `${PATHS.ROOM_STUDENTS(selectedRoomId)}/${queueNum}`), { calledAt: now });

    if (student.archiveKey) {
      try {
        await update(ref(db, `${PATHS.ROOM_ARCHIVE(selectedRoomId)}/${student.archiveKey}`), { calledAt: now });
      } catch (e) {
        console.warn("Archive update failed (non-critical):", e);
      }
    }
  } catch (err) {
    console.warn("startMeetingTimer failed:", err);
  }
}

async function clearMeetingTimer(queueNum) {
  if (!queueNum || queueNum <= 0 || !selectedRoomId) return;

  try {
    const studentSnap = await get(ref(db, `${PATHS.ROOM_STUDENTS(selectedRoomId)}/${queueNum}`));
    if (!studentSnap.exists()) return;

    const student = studentSnap.val();
    await update(ref(db, `${PATHS.ROOM_STUDENTS(selectedRoomId)}/${queueNum}`), {
      calledAt: null,
      durationSeconds: null,
      endedAt: null
    });

    if (student.archiveKey) {
      try {
        await update(ref(db, `${PATHS.ROOM_ARCHIVE(selectedRoomId)}/${student.archiveKey}`), {
          calledAt: null,
          durationSeconds: null,
          endedAt: null
        });
      } catch (e) {
        // ignore
      }
    }
  } catch (err) {
    console.warn("clearMeetingTimer failed:", err);
  }
}

// ---------- NEXT ----------

if (nextBtn) {
  nextBtn.addEventListener("click", handleNext);
}

async function handleNext() {
  hideBanner();
  if (nextBtn) nextBtn.disabled = true;
  if (!selectedRoomId) return;

  try {
    const prev = currentStudent;
    if (prev > 0) await finalizeMeetingDuration(prev);

    const sessionPath = PATHS.ROOM_SESSION(selectedRoomId);
    const currentRef = ref(db, `${sessionPath}/currentStudent`);

    const result = await runTransaction(currentRef, (current) => {
      const cur = current || 0;
      if (cur >= lastNumber) return cur;
      return cur + 1;
    });

    if (result.committed) {
      const newCurrent = result.snapshot.val();
      if (newCurrent > 0 && newCurrent !== prev) {
        await startMeetingTimer(newCurrent);
      }
    }
  } catch (err) {
    console.error("Next failed:", err);
    showBanner("Could not advance queue. Check your connection.", "error");
  } finally {
    updateButtonStates();
  }
}

// ---------- UNDO ----------

if (undoBtn) {
  undoBtn.addEventListener("click", handleUndo);
}

async function handleUndo() {
  hideBanner();
  if (undoBtn) undoBtn.disabled = true;
  if (!selectedRoomId) return;

  try {
    const prev = currentStudent;
    if (prev > 0) await clearMeetingTimer(prev);

    const sessionPath = PATHS.ROOM_SESSION(selectedRoomId);
    const currentRef = ref(db, `${sessionPath}/currentStudent`);

    const result = await runTransaction(currentRef, (current) => {
      const cur = current || 0;
      if (cur <= 0) return 0;
      return cur - 1;
    });

    if (result.committed) {
      const newCurrent = result.snapshot.val();
      if (newCurrent > 0) {
        await clearMeetingTimer(newCurrent);
        await startMeetingTimer(newCurrent);
      }
    }
  } catch (err) {
    console.error("Undo failed:", err);
    showBanner("Could not undo. Check your connection.", "error");
  } finally {
    updateButtonStates();
  }
}

// ---------- NEW SESSION ----------

if (newSessionBtn) {
  newSessionBtn.addEventListener("click", () => {
    if (modalOverlay) modalOverlay.classList.add("visible");
  });
}

if (modalCancel) {
  modalCancel.addEventListener("click", () => {
    if (modalOverlay) modalOverlay.classList.remove("visible");
  });
}

if (modalConfirm) {
  modalConfirm.addEventListener("click", handleNewSession);
}

async function handleNewSession() {
  if (modalConfirm) {
    modalConfirm.disabled = true;
    modalConfirm.innerHTML = '<span class="spinner"></span>Starting...';
  }

  if (!selectedRoomId) return;

  try {
    const prev = currentStudent;
    if (prev > 0) await finalizeMeetingDuration(prev);

    const sessionPath = PATHS.ROOM_SESSION(selectedRoomId);

    // Save everyone in the queue to the archive first, otherwise clearing the queue would erase them from the exports
    try {
      await ensureArchived(selectedRoomId);
    } catch (e) {
      if (!confirm(`${e.message}\n\nStart the new session anyway? Those records will be lost.`)) return;
    }

    await remove(ref(db, PATHS.ROOM_STUDENTS(selectedRoomId)));
    await set(ref(db, sessionPath), {
      currentStudent: 0,
      lastNumber: 0,
      active: true,
      startedAt: serverTimestamp()
    });

    adminNumbers = [];
    saveAdminNumbers();
    toastedFor.clear();

    if (modalOverlay) modalOverlay.classList.remove("visible");
    showBanner("New session started. Queue reset.", "info");
  } catch (err) {
    console.error("New session failed:", err);
    showBanner(`Failed to start session: ${err.message}`, "error");
  } finally {
    if (modalConfirm) {
      modalConfirm.disabled = false;
      modalConfirm.textContent = "Start New Session";
    }
  }
}

// ---------- Export helpers ----------

function csvEscape(val) {
  return `"${String(val ?? "").replace(/"/g, '""')}"`;
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---- Shared by the CSV and PDF exports ----
const isCT = (s) => s.meetingType === "CT" || s.meeting === "Class Teacher";
const isST = (s) => s.meetingType === "ST" || s.meeting === "Subject Teacher";
const exportMeeting = (s) => s.meeting || (isCT(s) ? "Class Teacher" : isST(s) ? "Subject Teacher" : "");
const exportClass = (s) => { const c = s.classId || s.class; return c ? formatClassLabel(c) : ""; };   // classId first so every record prints the same style (7th, 8th…)
const exportSection = (s) => s.section || s.sectionId || "";
const meetingSummary = (records) => `Class Teacher: ${records.filter(isCT).length}  ·  Subject Teacher: ${records.filter(isST).length}`;
// Class Teacher meetings first, then in queue order
const sortedForExport = (records) =>
  [...records].sort((x, y) => (isCT(y) - isCT(x)) || ((x.queueNumber ?? 0) - (y.queueNumber ?? 0)));

if (archiveExportCsvBtn) {
  archiveExportCsvBtn.addEventListener("click", async () => {
    await loadArchive(true); // fresh, complete history for the export
    if (!archiveLoadedAt) return; // download failed - never export a partial list
    if (archiveRecords.length === 0 || !selectedRoomData) return;
    const records = sortedForExport(archiveRecords);

    const lines = [];
    lines.push(`Evergreen Public School — PTM Records (${formatClassLabel(selectedRoomData.classId)}-${selectedRoomData.sectionId})`);
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push(`Total Records: ${records.length}`);
    lines.push(`Meetings — ${meetingSummary(records)}`);
    lines.push("");

    lines.push("S.No,Queue #,Student Name,Class,Section,Roll No,Meeting With,Room,Teacher,Parent / Guardian,Relation,Meeting Duration,Joined At");
    records.forEach((s, i) => {
      lines.push([
        i + 1,
        s.queueNumber ?? "",
        s.name || s.studentName || "",
        exportClass(s),
        exportSection(s),
        s.rollNo || "",
        exportMeeting(s),
        s.room || "",
        s.teacherName || "",
        s.parentName || "",
        s.relation || "",
        formatDuration(s.durationSeconds),
        (s.createdAt || s.joinedAt) ? new Date(s.createdAt || s.joinedAt).toLocaleString() : ""
      ].map(csvEscape).join(","));
    });

    downloadBlob(lines.join("\r\n"), `ptm-records-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8;");
  });
}

if (archiveExportPdfBtn) {
  archiveExportPdfBtn.addEventListener("click", async () => {
    await loadArchive(true); // fresh, complete history for the export
    if (!archiveLoadedAt) return; // download failed - never export a partial list
    if (archiveRecords.length === 0 || !selectedRoomData) return;
    const records = sortedForExport(archiveRecords);

    const { jsPDF } = window.jspdf;
    if (!jsPDF) {
      showBanner("PDF library not loaded. Please refresh.", "error");
      return;
    }

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();

    doc.setFillColor(79, 70, 229);
    doc.rect(0, 0, pageW, 28, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Evergreen Public School", pageW / 2, 12, { align: "center" });
    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text(`Parent–Teacher Meeting — ${formatClassLabel(selectedRoomData.classId)}-${selectedRoomData.sectionId}`, pageW / 2, 20, { align: "center" });

    doc.setTextColor(100, 116, 139);
    doc.setFontSize(9);
    doc.text(`Generated: ${new Date().toLocaleString()}  ·  Total: ${records.length} students  ·  ${meetingSummary(records)}`, pageW / 2, 34, { align: "center" });

    const head = [["S.No", "Queue #", "Student Name", "Class", "Section", "Roll No", "Meeting With", "Room", "Teacher", "Duration", "Joined At"]];
    const body = records.map((s, i) => [
      String(i + 1),
      String(s.queueNumber ?? ""),
      s.name || s.studentName || "",
      exportClass(s),
      exportSection(s),
      s.rollNo || "",
      exportMeeting(s),
      s.room || "",
      s.teacherName || "",
      formatDuration(s.durationSeconds),
      (s.createdAt || s.joinedAt) ? new Date(s.createdAt || s.joinedAt).toLocaleString() : ""
    ]);

    doc.autoTable({
      startY: 40,
      head,
      body,
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 2.5, overflow: "linebreak" },
      headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: "bold", halign: "center" },
      alternateRowStyles: { fillColor: [238, 242, 255] },
      margin: { left: 14, right: 14 }
    });

    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `Page ${i} of ${pageCount}  ·  Evergreen Public School PTM System`,
        pageW / 2,
        doc.internal.pageSize.getHeight() - 8,
        { align: "center" }
      );
    }

    doc.save(`ptm-records-${new Date().toISOString().slice(0, 10)}.pdf`);
  });
}