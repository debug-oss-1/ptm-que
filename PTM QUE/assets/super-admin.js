// ============================================================
// PTM SYSTEM — SUPER ADMIN PANEL LOGIC (FIXED)
// ============================================================
// FIXES APPLIED:
// - All paths use PATHS object for consistency
// - Admin ID sanitization with proper dot replacement
// - Room initialization creates runtime structure
// - Session initialization for rooms
// - Proper error handling throughout
// - Fixed data structure consistency
// ============================================================

import { db, auth, PATHS } from "./firebase.js";
import { Auth } from "./auth.js";
import {
  ref,
  get,
  set,
  update,
  remove,
  push,
  onValue,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js";
// FIX: needed to actually create a Firebase Auth account for new admins —
// previously only a DB stub was written, so new admins could never log in.
import { getAuth, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
// Secondary app: lets us create a user WITHOUT replacing the super-admin's session
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { firebaseConfig } from "./firebase-config.js";

// ---------- DOM references (with null safety) ----------

function getDOMElement(id) {
  const el = document.getElementById(id);
  if (!el) console.warn(`DOM element not found: ${id}`);
  return el;
}

const screens = {
  dashboard: getDOMElement("screen-dashboard")
};

const banner = getDOMElement("banner");
const logoutBtn = getDOMElement("logout-btn");

const toastContainer = getDOMElement("toast-container");

// Tab navigation
const tabButtons = document.querySelectorAll(".tab-btn");
const tabContents = document.querySelectorAll(".tab-content");

// Classes tab
const btnAddClass = getDOMElement("btn-add-class");
const classList = getDOMElement("classes-list");
const addClassModal = getDOMElement("add-class-modal");
const acClassNumber = getDOMElement("ac-class-number");
const acClassName = getDOMElement("ac-class-name");
const acCancel = getDOMElement("ac-cancel");
const acSubmit = getDOMElement("ac-submit");

// Rooms & Teachers tab
const btnAddRoom = getDOMElement("btn-add-room");
const roomsList = getDOMElement("rooms-list");
const addRoomModal = getDOMElement("add-room-modal");
const arRoomNumber = getDOMElement("ar-room-number");
const arTeacherName = getDOMElement("ar-teacher-name");
const arClassesSections = getDOMElement("ar-classes-sections");
const arClassTeacherOf = getDOMElement("ar-class-teacher-of");
const arCancel = getDOMElement("ar-cancel");
const arSubmit = getDOMElement("ar-submit");

// Admins tab
const btnAddAdmin = getDOMElement("btn-add-admin");
const adminsList = getDOMElement("admins-list");
const addAdminModal = getDOMElement("add-admin-modal");
const aadEmail = getDOMElement("aad-email");
const aadName = getDOMElement("aad-name");
const aadRoom = getDOMElement("aad-room");
const aadPassword = getDOMElement("aad-password");
const aadCancel = getDOMElement("aad-cancel");
const aadSubmit = getDOMElement("aad-submit");

// Export tab
const exportCsvBtn = getDOMElement("export-csv-btn");
const exportPdfBtn = getDOMElement("export-pdf-btn");

// ---------- State ----------

const UNLOCK_KEY = "ptm_super_admin_unlocked";

let listenersAttached = false;
let configData = {};
let adminsList_data = {};
let teachersData = {};
// Derived from teachersData — one entry per teacher (not per class/section
// copy), used to populate the "Assign Room" dropdown and admin listing.
let allRooms = [];

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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

// ---------- Input validation helpers (class / section / room) ----------

// Trim and collapse runs of whitespace: "  Physics   Lab " -> "Physics Lab"
const squash = (v) => String(v ?? "").trim().replace(/\s+/g, " ");

// Letters/digits (any language) separated by single spaces.
// Excludes . # $ [ ] / (illegal in Firebase keys), "-" and "::" (both are
// used as separators elsewhere in this app, e.g. PDF grouping and combo values).
const KEY_PATTERN = /^[\p{L}\p{N}]+( [\p{L}\p{N}]+)*$/u;

// Returns { value } on success or { error } on failure.
function normalizeClassId(raw) {
  const v = squash(raw);
  if (!v) return { error: "Class number can't be blank" };

  // Looks like a number (digits, sign or dot only): must be a whole number 1-99
  if (/^[\d.+-]+$/.test(v)) {
    if (!/^\d+$/.test(v)) return { error: "Class number must be a whole number (no minus sign or decimals)" };
    const n = parseInt(v, 10);
    if (n < 1 || n > 99) return { error: "Class number must be between 1 and 99" };
    return { value: String(n) };            // "007" -> "7"
  }

  // Text class such as "Nursery" or "LKG"
  if (v.length > 20) return { error: "Class name can be at most 20 characters" };
  if (!KEY_PATTERN.test(v)) return { error: "Class can only use letters, numbers and single spaces" };
  return { value: v };
}

function normalizeSectionId(raw) {
  const v = squash(raw).toUpperCase();
  if (!v) return { error: "Section name can't be blank" };
  if (v.length > 20) return { error: "Section name can be at most 20 characters" };
  if (!KEY_PATTERN.test(v)) return { error: "Section can only use letters, numbers and single spaces" };
  return { value: v };
}

// Case-insensitive lookup of an existing key ("lkg" finds "LKG")
function findExistingKey(obj, id) {
  const target = String(id).toLowerCase();
  return Object.keys(obj || {}).find((k) => k.toLowerCase() === target);
}

// Room numbers compare case/space-insensitively: "lab 2" == "Lab  2"
const roomKey = (v) => squash(v).toLowerCase();

// ---------- Tab Navigation ----------

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const tabName = btn.dataset.tab;

    tabButtons.forEach((b) => {
      b.classList.remove("tab-active", "bg-indigo-600", "text-white");
      b.classList.add("bg-slate-100", "text-slate-700");
    });
    btn.classList.add("tab-active", "bg-indigo-600", "text-white");
    btn.classList.remove("bg-slate-100", "text-slate-700");

    tabContents.forEach((content) => content.classList.remove("active"));
    const tabContent = document.getElementById(`tab-${tabName}`);
    if (tabContent) tabContent.classList.add("active");
  });
});

// ---------- Collapse/Expand System ----------
// Every section starts COLLAPSED. The person opens the ones they need; live database updates
// re-render the lists inside a section but never change whether it is open or closed.

// Sets a section up once (collapsed + click/keyboard handlers). Safe to call repeatedly.
function initializeCollapsibleSections() {
  document.querySelectorAll(".collapsible-header").forEach((header) => {
    const section = header.dataset.section;
    const content = document.querySelector(`.collapsible-content[data-section="${section}"]`);
    if (!content) return;

    // This runs more than once (page load, DOMContentLoaded, every enterDashboard()).
    // Only the first run collapses and binds, so later runs never undo what the person opened
    // and never stack extra click listeners (which made one click toggle 2-3 times).
    if (header.dataset.collapsibleBound === "1") return;
    header.dataset.collapsibleBound = "1";

    collapseSection(header, content);

    header.addEventListener("click", () => toggleSection(section));
    header.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target === header) {
        e.preventDefault();
        toggleSection(section);
      }
    });
  });
}

function toggleSection(section) {
  const header = document.querySelector(`.collapsible-header[data-section="${section}"]`);
  const content = document.querySelector(`.collapsible-content[data-section="${section}"]`);
  if (!header || !content) return;

  if (content.classList.contains("collapsed")) expandSection(header, content);
  else collapseSection(header, content);
}

function collapseSection(header, content) {
  content.classList.add("collapsed");
  header.querySelector(".collapse-icon")?.classList.add("collapsed");
  header.setAttribute("aria-expanded", "false");
}

function expandSection(header, content) {
  content.classList.remove("collapsed");
  header.querySelector(".collapse-icon")?.classList.remove("collapsed");
  header.setAttribute("aria-expanded", "true");
}

// Initialize on page load
if (sessionStorage.getItem(UNLOCK_KEY) === "1") {
  // Already logged in, initialize collapsibles after a delay
  setTimeout(() => initializeCollapsibleSections(), 500);
}

// ---------- Auth-based access ----------

function initSuperAdminAccess() {
  console.log("🔐 [AUTH] initSuperAdminAccess called");
  console.log("🔐 [AUTH] Is authenticated:", Auth.isAuthenticated());
  console.log("🔐 [AUTH] User data:", Auth.getUserData());
  console.log("🔐 [AUTH] User role:", Auth.getRole());

  if (!Auth.isAuthenticated()) {
    console.log("🔐 [AUTH] Not authenticated, redirecting to login.html");
    window.location.href = "login.html";
    return;
  }
  if (!Auth.isSuperAdmin()) {
    console.log("🔐 [AUTH] Not super-admin, redirecting to admin.html");
    window.location.href = "admin.html";
    return;
  }
  console.log("✅ [AUTH] Super-admin verified, entering dashboard");
  enterDashboard();
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await Auth.logout();
    window.location.href = "login.html";
  });
}

console.log("🚀 [INIT] Starting Auth initialization...");
Auth.init().then(() => {
  console.log("🚀 [INIT] Auth initialized, calling initSuperAdminAccess");
  initSuperAdminAccess();
}).catch(err => {
  console.error("🚀 [INIT] Auth initialization failed:", err);
});

// ---------- Initialize Searchable Dropdowns ----------

function initializeSearchableDropdowns() {
  // Initialize dropdowns with Choices.js for searchability
  // Store references so we can update them programmatically

  if (arClassesSections && !arClassesSections.classList.contains('choices__input')) {
    arClassesSectionsChoices = new Choices(arClassesSections, {
      searchEnabled: true,
      searchPlaceholderValue: "Search classes & sections...",
      shouldSort: false,
      removeItemButton: true,
      placeholderValue: "Select classes & sections taught",
      itemSelectText: "Press to select",
      // Force the option list to always open downward. Left on "auto",
      // Choices measures space against the browser window rather than
      // the modal's own (scrollable) boundary, so inside a modal it can
      // flip upward and render outside the modal card. "bottom" keeps it
      // anchored under the field, where the modal's own scroll can reach it.
      position: "bottom"
    });
    // Whenever the set of classes/sections taught changes, the "Class
    // Teacher Of" dropdown must be rebuilt to only offer those options.
    arClassesSections.addEventListener("addItem", updateClassTeacherOfOptions);
    arClassesSections.addEventListener("removeItem", updateClassTeacherOfOptions);
  }

  if (aadRoom && !aadRoom.classList.contains('choices__input')) {
    new Choices(aadRoom, {
      searchEnabled: true,
      searchPlaceholderValue: "Search rooms...",
      shouldSort: false,
      itemSelectText: "Press to select",
      position: "bottom"
    });
  }
}

// ---------- Realtime Listeners ----------

// FIX (data not loading): same missing-function bug as admin.js —
// super-admin.js called enterDashboard() but never defined it, so login
// threw "enterDashboard is not defined" and the dashboard/listeners never
// ran. The wrapper near the bottom of this file (which adds the
// collapsible-sections init) expects this name to already exist, so it must
// be declared with `function` (hoisted) before that wrapper runs.
function enterDashboard() {
  showScreen("dashboard");
  hideBanner();
  if (!listenersAttached) {
    listenersAttached = true;
    attachRealtimeListeners();
  }
}

function attachRealtimeListeners() {
  const onError = (context) => (err) => {
    console.error(`❌ [DATABASE ERROR] ${context}:`, err);
    console.error(`❌ [DATABASE ERROR] Error code: ${err.code}`);
    console.error(`❌ [DATABASE ERROR] Error message: ${err.message}`);
    showBanner(`Database error (${context}): ${err.code || err.message}.`);
  };

  console.log("🔄 [LISTENERS] Attaching realtime listeners...");
  console.log("🔐 [AUTH] Current user UID:", auth.currentUser?.uid);
  console.log("🔐 [AUTH] Current user email:", auth.currentUser?.email);

  onValue(ref(db, "ptm/config"), (snap) => {
    console.log("✅ [CONFIG] Data received from database");
    configData = snap.val() || {};
    // "ptm/config/teachers" is a child of the path we're already listening
    // to, so it arrives in the same snapshot — no extra listener needed.
    teachersData = configData.teachers || {};
    console.log("📊 [CONFIG] Raw data:", JSON.stringify(configData, null, 2));
    console.log("📊 [CONFIG] Classes found:", Object.keys(configData.classes || {}));
    renderClasses();
    renderRoomsTab();
    populateClassSelects();

    // Reinitialize searchable dropdowns after populating
    setTimeout(() => initializeSearchableDropdowns(), 100);
  }, onError("config"));

  // FIX: admins were being created at ptm/users/{uid} (see handleAddAdmin) but
  // listed from ptm/admins, a node nothing ever writes to — so the list here
  // was always empty. Read from ptm/users and filter to admin/super-admin roles.
  console.log("🔄 [USERS] Attempting to read from:", PATHS.USERS);
  onValue(ref(db, PATHS.USERS), (snap) => {
    console.log("✅ [USERS] Data received from database");
    const allUsers = snap.val() || {};
    console.log("👥 [USERS] All users data:", JSON.stringify(allUsers, null, 2));
    adminsList_data = Object.fromEntries(
      Object.entries(allUsers).filter(([, u]) => u.role === "admin" || u.role === "super-admin")
    );
    console.log("👤 [USERS] Filtered admins/super-admins:", JSON.stringify(adminsList_data, null, 2));
    renderAdmins();
  }, onError("users"));
}

// ---------- CLASSES & SECTIONS TAB ----------

function renderClasses() {
  if (!classList) return;

  const classes = Object.entries(configData.classes || {});
  console.log("🎨 [RENDER] renderClasses called");
  console.log("🎨 [RENDER] Classes array:", classes);
  console.log("🎨 [RENDER] classList element:", classList);

  if (classes.length === 0) {
    classList.innerHTML = '<div class="text-sm text-slate-400 text-center py-6 bg-slate-50 rounded-lg">No classes yet. Add one to get started.</div>';
    console.log("🎨 [RENDER] No classes found");
    return;
  }

  classList.innerHTML = classes
    .map(([classId, classData]) => {
      console.log(`🎨 [RENDER] Processing class ${classId}:`, classData);
      const sections = Object.entries(classData.sections || {});
      console.log(`🎨 [RENDER] Sections for class ${classId}:`, sections);

      const sectionsList = sections
        .map(([secId]) => {
          const secData = classData.sections[secId] || {};
          const roomsData = secData.rooms || {};
          const roomCount = Object.keys(roomsData).length;
          console.log(`🎨 [RENDER] Section ${secId} data:`, { secData, roomCount });
          return `<span class="inline-block px-3 py-1 rounded-full bg-violet-100 text-violet-700 text-xs font-medium">${escapeHtml(secId)} ${roomCount > 0 ? `<span class="ml-1 bg-violet-200 text-violet-800 px-1 rounded-full text-[10px]">${roomCount} room${roomCount > 1 ? 's' : ''}</span>` : ''}</span>`;
        })
        .join(" ");

      console.log(`🎨 [RENDER] Final sectionsList HTML for ${classId}:`, sectionsList);

      const hasRooms = sections.some(secId => {
        const secData = classData.sections[secId] || {};
        const roomsData = secData.rooms || {};
        return Object.keys(roomsData).length > 0;
      });

      return `
        <div class="bg-white/80 rounded-xl border border-slate-100 p-4">
          <div class="flex items-start justify-between mb-2">
            <div>
              <div class="text-sm font-bold text-indigo-600">${formatClassLabel(classId)}</div>
              <div class="text-xs text-slate-500">${escapeHtml(classData.name || "")}</div>
            </div>
            <button class="class-delete-btn p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition" data-class-id="${classId}" title="Delete">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
          <div class="text-xs text-slate-600 mb-2">Sections: ${sectionsList || '<span class="text-slate-400">None</span>'}</div>
          <button class="class-add-section-btn text-xs font-medium text-indigo-600 hover:text-indigo-700" data-class-id="${classId}">+ Add Section</button>
          ${!hasRooms ? '<div class="text-xs text-amber-600 mt-2 bg-amber-50 px-3 py-2 rounded border border-amber-200">No teachers assigned yet. Add a teacher for this class to start using the PTM system.</div>' : ''}
        </div>`;
    })
    .join("");

  console.log("🎨 [RENDER] Final HTML rendered");
  document.querySelectorAll(".class-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteClass(btn.dataset.classId));
  });

  document.querySelectorAll(".class-add-section-btn").forEach((btn) => {
    btn.addEventListener("click", () => addSectionDialog(btn.dataset.classId));
  });
}

function addSectionDialog(classId) {
  const raw = prompt("Enter section name (e.g., A, B, C, D):");
  if (raw === null) return;                       // cancelled

  const norm = normalizeSectionId(raw);           // trims, uppercases, rejects blank/illegal
  if (norm.error) { showToast(norm.error, "warning"); return; }

  // Block duplicates: set() on an existing section would erase its rooms
  const existing = configData.classes?.[classId]?.sections;
  if (findExistingKey(existing, norm.value)) {
    showToast(`Section ${norm.value} already exists in ${formatClassLabel(classId)}`, "warning");
    return;
  }
  addSection(classId, norm.value);
}

async function addSection(classId, sectionId) {
  try {
    await set(ref(db, `${PATHS.CONFIG_CLASSES}/${classId}/sections/${sectionId}`), {
      name: `Section ${sectionId}`
    });
    showToast(`Section ${sectionId} added to ${formatClassLabel(classId)}`, "success");
  } catch (err) {
    console.error("Add section failed:", err);
    showToast("Failed to add section", "warning");
  }
}

async function deleteClass(classId) {
  if (!confirm(`Delete ${formatClassLabel(classId)}? This cannot be undone.`)) return;

  try {
    await remove(ref(db, `${PATHS.CONFIG_CLASSES}/${classId}`));
    showToast(`Class ${formatClassLabel(classId)} deleted`, "info");
  } catch (err) {
    console.error("Delete class failed:", err);
    showToast("Failed to delete class", "warning");
  }
}

if (btnAddClass) {
  btnAddClass.addEventListener("click", () => {
    if (acClassNumber) acClassNumber.value = "";
    if (acClassName) acClassName.value = "";
    if (addClassModal) addClassModal.classList.add("visible");
  });
}

if (acCancel) {
  acCancel.addEventListener("click", () => {
    if (addClassModal) addClassModal.classList.remove("visible");
  });
}

if (acSubmit) {
  acSubmit.addEventListener("click", handleAddClass);
}

async function handleAddClass() {
  const className = squash(acClassName?.value);

  // Validate + normalize the class number (7, 007 -> "7"; text like "LKG" is allowed)
  const norm = normalizeClassId(acClassNumber?.value);
  if (norm.error) { showToast(norm.error, "warning"); return; }
  const classNum = norm.value;

  if (!className) {
    showToast("Please fill in all fields", "warning");
    return;
  }

  // Block duplicates (case-insensitive): set() below would wipe the existing
  // class's sections and the rooms/teachers attached to them.
  if (findExistingKey(configData.classes, classNum)) {
    showToast(`${formatClassLabel(classNum)} already exists. Use "+ Add Section" to extend it.`, "warning");
    return;
  }

  if (acSubmit) {
    acSubmit.disabled = true;
    acSubmit.textContent = "Adding...";
  }

  try {
    const sections = {};
    ["A", "B", "C", "D"].forEach((sec) => {
      sections[sec] = { name: `Section ${sec}` };
    });

    await set(ref(db, `${PATHS.CONFIG_CLASSES}/${classNum}`), {
      name: className,
      sections
    });

    if (addClassModal) addClassModal.classList.remove("visible");
    showToast(`Class ${formatClassLabel(classNum)} added with sections A-D`, "success");
  } catch (err) {
    console.error("Add class failed:", err);
    showToast("Failed to add class", "warning");
  } finally {
    if (acSubmit) {
      acSubmit.disabled = false;
      acSubmit.textContent = "Add Class";
    }
  }
}

// ---------- ROOMS & TEACHERS TAB ----------

function renderRoomsTab() {
  if (!roomsList) {
    console.log("🎨 [ROOMS] roomsList element not found!");
    return;
  }

  console.log("🎨 [ROOMS] renderRoomsTab called");
  console.log("🎨 [ROOMS] teachersData:", JSON.stringify(teachersData, null, 2));

  // Each teacher is one row now, regardless of how many classes/sections
  // they teach (previously every class/section got its own duplicate row).
  const teacherRows = Object.entries(teachersData).map(([teacherId, t]) => ({
    roomId: teacherId,
    room: t.room,
    teacherName: t.name,
    classesTaught: t.classesTaught || [],
    classTeacherOf: t.classTeacherOf || null
  }));

  allRooms = teacherRows;

  if (teacherRows.length === 0) {
    const hasClasses = Object.keys(configData.classes || {}).length > 0;
    let emptyMessage = '<div class="text-sm text-slate-400 text-center py-6 bg-slate-50 rounded-lg">No teachers configured yet.</div>';
    if (hasClasses) {
      emptyMessage = '<div class="text-sm text-slate-600 text-center py-6 bg-slate-50 rounded-lg">Classes exist but have no teachers yet. <button class="text-indigo-600 hover:underline" onclick="document.querySelector(\'.tab-btn[data-tab="rooms"]\').click()">Add a teacher</button> to start using the PTM system.</div>';
    }
    roomsList.innerHTML = emptyMessage;
    console.log("🎨 [ROOMS] No teachers found, showing empty message");
    return;
  }

  console.log("🎨 [ROOMS] Rendering teachers:", teacherRows);
  roomsList.innerHTML = teacherRows
    .map((r) => {
      const classesBadges = r.classesTaught
        .map(({ classId, sectionId }) => `<span class="inline-block px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[11px] font-medium">${escapeHtml(comboLabel(classId, sectionId))}</span>`)
        .join(" ");
      const classTeacherLabel = r.classTeacherOf
        ? `Class Teacher of ${escapeHtml(comboLabel(r.classTeacherOf.classId, r.classTeacherOf.sectionId))}`
        : "Not a class teacher";
      return `
        <div class="bg-white/80 rounded-xl border border-slate-100 p-4 flex items-start justify-between gap-3">
          <div class="flex-1 min-w-0">
            <div class="text-sm font-bold text-indigo-600">${escapeHtml(r.teacherName || "")} <span class="font-normal text-slate-400">• Room ${escapeHtml(r.room || "")}</span></div>
            <div class="text-xs text-slate-500 mt-0.5">${classTeacherLabel}</div>
            <div class="flex flex-wrap gap-1 mt-1.5">${classesBadges}</div>
          </div>
          <button class="room-delete-btn p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition shrink-0" data-teacher-id="${escapeHtml(r.roomId)}" title="Delete">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>`;
    })
    .join("");

  console.log("🎨 [ROOMS] Teachers rendered successfully");

  document.querySelectorAll(".room-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteTeacher(btn.dataset.teacherId));
  });
}

function populateClassSelects() {
  // Populate the "Classes & Sections Taught" multi-select with every
  // available class-section combination.
  const combos = getAllClassSectionCombos();
  if (arClassesSections) {
    const choiceOptions = combos.map(({ classId, sectionId }) => ({
      value: comboValue(classId, sectionId),
      label: comboLabel(classId, sectionId),
      selected: false
    }));
    if (arClassesSectionsChoices) {
      const previouslySelected = new Set(arClassesSectionsChoices.getValue(true));
      arClassesSectionsChoices.setChoices(
        choiceOptions.map((c) => ({ ...c, selected: previouslySelected.has(c.value) })),
        'value', 'label', true
      );
    } else {
      arClassesSections.innerHTML = "";
      choiceOptions.forEach(({ value, label }) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        arClassesSections.appendChild(opt);
      });
    }
  }

  // Populate room/teacher selector for admin account creation — one entry
  // per teacher (allRooms is derived from teachersData; see renderRoomsTab).
  if (aadRoom) {
    const current = aadRoom.value;
    aadRoom.innerHTML = '<option value="">Select Room</option>';

    allRooms.forEach((room) => {
      const opt = document.createElement("option");
      opt.value = room.roomId;
      const classesLabel = (room.classesTaught || [])
        .map((c) => comboLabel(c.classId, c.sectionId))
        .join(", ");
      opt.textContent = `Room ${room.room} • ${room.teacherName} • ${classesLabel}`;
      aadRoom.appendChild(opt);
    });

    if (current && allRooms.find(r => r.roomId === current)) aadRoom.value = current;
  }
}

// Store reference to the Choices instance for the classes/sections multi-select
let arClassesSectionsChoices = null;

// Composite value used for each "class-section" option, e.g. "8::A".
// "::" is used instead of "-" or "_" since class/section IDs are free text.
function comboValue(classId, sectionId) {
  return `${classId}::${sectionId}`;
}
function parseCombo(combo) {
  const idx = combo.indexOf("::");
  return { classId: combo.slice(0, idx), sectionId: combo.slice(idx + 2) };
}
function comboLabel(classId, sectionId) {
  return `${formatClassLabel(classId)} - ${sectionId}`;
}

function getAllClassSectionCombos() {
  const combos = [];
  Object.entries(configData.classes || {}).forEach(([classId, classData]) => {
    Object.keys(classData.sections || {}).sort().forEach((sectionId) => {
      combos.push({ classId, sectionId });
    });
  });
  return combos;
}

// Rebuilds the "Class Teacher Of" dropdown so it only ever offers the
// classes/sections currently selected in the multi-select, plus "None".
function updateClassTeacherOfOptions() {
  if (!arClassTeacherOf) return;
  const selected = arClassesSectionsChoices
    ? arClassesSectionsChoices.getValue(true)
    : Array.from(arClassesSections?.selectedOptions || []).map((o) => o.value);

  const previousValue = arClassTeacherOf.value;
  arClassTeacherOf.innerHTML = '<option value="">None</option>';
  selected.forEach((combo) => {
    const { classId, sectionId } = parseCombo(combo);
    const opt = document.createElement("option");
    opt.value = combo;
    opt.textContent = comboLabel(classId, sectionId);
    arClassTeacherOf.appendChild(opt);
  });
  // Keep the previous selection only if it's still a valid choice.
  arClassTeacherOf.value = selected.includes(previousValue) ? previousValue : "";
}

if (btnAddRoom) {
  btnAddRoom.addEventListener("click", () => {
    if (arRoomNumber) arRoomNumber.value = "";
    if (arTeacherName) arTeacherName.value = "";
    if (arClassesSectionsChoices) {
      arClassesSectionsChoices.removeActiveItems();
    } else if (arClassesSections) {
      Array.from(arClassesSections.options).forEach((o) => (o.selected = false));
    }
    if (arClassTeacherOf) arClassTeacherOf.innerHTML = '<option value="">None</option>';
    if (addRoomModal) addRoomModal.classList.add("visible");
    // Reinitialize dropdowns after modal opens
    setTimeout(() => initializeSearchableDropdowns(), 100);
  });
}

if (arCancel) {
  arCancel.addEventListener("click", () => {
    if (addRoomModal) addRoomModal.classList.remove("visible");
  });
}

if (arSubmit) {
  arSubmit.addEventListener("click", handleAddTeacher);
}

async function handleAddTeacher() {
  const teacherName = squash(arTeacherName?.value);
  const roomNum = squash(arRoomNumber?.value);
  const selectedCombos = arClassesSectionsChoices
    ? arClassesSectionsChoices.getValue(true)
    : Array.from(arClassesSections?.selectedOptions || []).map((o) => o.value);
  const classTeacherOfCombo = arClassTeacherOf?.value || "";

  if (!teacherName || !roomNum || selectedCombos.length === 0) {
    showToast("Please fill in teacher name, room number, and at least one class/section", "warning");
    return;
  }

  if (classTeacherOfCombo && !selectedCombos.includes(classTeacherOfCombo)) {
    showToast("Class Teacher Of must be one of the selected classes/sections", "warning");
    return;
  }

  // --- Duplicate room number (text allowed, e.g. "Library Front") ---
  const roomClash = Object.values(teachersData).find((t) => roomKey(t.room) === roomKey(roomNum));
  if (roomClash) {
    showToast(`Room "${roomClash.room}" is already used by ${roomClash.name}`, "warning");
    return;
  }

  // --- Only one class teacher per class/section ---
  if (classTeacherOfCombo) {
    const { classId, sectionId } = parseCombo(classTeacherOfCombo);
    const existingCT = Object.values(teachersData).find((t) =>
      t.classTeacherOf &&
      String(t.classTeacherOf.classId) === String(classId) &&
      String(t.classTeacherOf.sectionId) === String(sectionId)
    );
    if (existingCT) {
      showToast(`${comboLabel(classId, sectionId)} already has a class teacher: ${existingCT.name}`, "warning");
      return;
    }
  }

  if (arSubmit) {
    arSubmit.disabled = true;
    arSubmit.textContent = "Adding...";
  }

  try {
    const teacherId = push(ref(db, PATHS.CONFIG_TEACHERS)).key;
    const classesTaught = selectedCombos.map(parseCombo);

    const teacherRecord = {
      name: teacherName,
      room: roomNum,
      classesTaught,
      createdAt: serverTimestamp()
    };
    if (classTeacherOfCombo) {
      teacherRecord.classTeacherOf = parseCombo(classTeacherOfCombo);
    }

    // Write the canonical teacher record.
    await set(ref(db, PATHS.CONFIG_TEACHER(teacherId)), teacherRecord);

    // Write a room entry under every class/section this teacher teaches, so
    // index.html's existing per-class-section lookup (PATHS.CONFIG_ROOMS)
    // keeps working without any changes — it just now finds this teacher
    // listed under each class/section they teach.
    await Promise.all(
      selectedCombos.map((combo) => {
        const { classId, sectionId } = parseCombo(combo);
        const meetingType = combo === classTeacherOfCombo ? "CT" : "ST";
        return set(ref(db, `${PATHS.CONFIG_ROOMS(classId, sectionId)}/${teacherId}`), {
          room: roomNum,
          teacherName,
          meetingType
        });
      })
    );

    // FIX: Initialize runtime room structure (one shared queue/room for
    // this teacher, used no matter which class/section a parent came from)
    await initializeRoomStructure(teacherId);

    if (addRoomModal) addRoomModal.classList.remove("visible");
    showToast(`Teacher ${teacherName} added`, "success");
  } catch (err) {
    console.error("Add teacher failed:", err);
    showToast("Failed to add teacher", "warning");
  } finally {
    if (arSubmit) {
      arSubmit.disabled = false;
      arSubmit.textContent = "Add Teacher";
    }
  }
}

// FIX: Initialize room runtime structure when room is created
async function initializeRoomStructure(roomId) {
  try {
    const roomPath = PATHS.ROOM_SESSION(roomId);
    const snap = await get(ref(db, roomPath));

    if (!snap.exists()) {
      await set(ref(db, roomPath), {
        active: true,
        currentStudent: 0,
        lastNumber: 0,
        startedAt: serverTimestamp()
      });

      // Initialize students and archive nodes
      await set(ref(db, PATHS.ROOM_STUDENTS(roomId)), {});
      await set(ref(db, PATHS.ROOM_ARCHIVE(roomId)), {});

      console.log("Initialized runtime structure for room:", roomId);
    }
  } catch (err) {
    console.warn("Failed to initialize room structure (non-critical):", err);
  }
}

async function deleteTeacher(teacherId) {
  const teacher = teachersData[teacherId];
  const teacherName = teacher?.name || "this teacher";
  if (!confirm(`Delete ${teacherName}? This removes them from every class/section they teach.`)) return;

  try {
    const classesTaught = teacher?.classesTaught || [];

    // Delete the room entry under every class/section this teacher was
    // listed in, plus the canonical teacher record itself.
    await Promise.all(
      classesTaught.map(({ classId, sectionId }) =>
        remove(ref(db, `${PATHS.CONFIG_ROOMS(classId, sectionId)}/${teacherId}`))
      )
    );
    await remove(ref(db, PATHS.CONFIG_TEACHER(teacherId)));

    // Clean up runtime data (optional - can keep for archive)
    // await remove(ref(db, PATHS.ROOM_SESSION(teacherId)));

    showToast(`Teacher deleted`, "info");
  } catch (err) {
    console.error("Delete teacher failed:", err);
    showToast("Failed to delete teacher", "warning");
  }
}

// ---------- ADMIN ACCOUNTS TAB ----------

function renderAdmins() {
  if (!adminsList) return;

  const admins = Object.entries(adminsList_data || {});

  if (admins.length === 0) {
    adminsList.innerHTML = '<div class="text-sm text-slate-400 text-center py-6 bg-slate-50 rounded-lg">No admin accounts yet.</div>';
    return;
  }

  adminsList.innerHTML = admins
    .map(([adminId, admin]) => {
      // Find the teacher/room details from allRooms
      const roomDetails = allRooms.find(r => r.roomId === admin.roomId);
      const classesLabel = roomDetails
        ? (roomDetails.classesTaught || []).map((c) => comboLabel(c.classId, c.sectionId)).join(", ")
        : "";
      const assignment = admin.role === "super-admin"
        ? "Super Admin"
        : roomDetails
          ? `Room ${roomDetails.room} • ${classesLabel}`
          : "No room assigned";
      const isDisabled = admin.status === "disabled";
      const status = isDisabled ? "Disabled" : "Active";
      const statusClass = isDisabled ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700";

      return `
        <div class="bg-white/80 rounded-xl border border-slate-100 p-4 flex items-start justify-between">
          <div class="flex-1">
            <div class="text-sm font-bold text-indigo-600">${escapeHtml(admin.name || admin.email || adminId)}</div>
            <div class="text-xs text-slate-400">${escapeHtml(admin.email || "")}</div>
            <div class="text-xs text-slate-500">${assignment}</div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold px-2 py-1 rounded-full ${statusClass}">${status}</span>
            <button class="admin-delete-btn p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition" data-admin-id="${escapeHtml(adminId)}" title="Delete">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </div>`;
    })
    .join("");

  document.querySelectorAll(".admin-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteAdmin(btn.dataset.adminId));
  });
}

if (btnAddAdmin) {
  btnAddAdmin.addEventListener("click", () => {
    if (aadEmail) aadEmail.value = "";
    if (aadName) aadName.value = "";
    if (aadRoom) aadRoom.value = "";
    if (aadPassword) aadPassword.value = "";
    if (addAdminModal) addAdminModal.classList.add("visible");
    // Reinitialize dropdowns after modal opens
    setTimeout(() => initializeSearchableDropdowns(), 100);
  });
}

if (aadCancel) {
  aadCancel.addEventListener("click", () => {
    if (addAdminModal) addAdminModal.classList.remove("visible");
  });
}

if (aadSubmit) {
  aadSubmit.addEventListener("click", handleAddAdmin);
}

async function handleAddAdmin() {
  const email = aadEmail?.value.trim();
  const name = aadName?.value.trim();
  const roomId = aadRoom?.value;
  const password = aadPassword?.value;

  if (!email || !name || !roomId || !password) {
    showToast("Please fill in all fields", "warning");
    return;
  }

  if (aadSubmit) {
    aadSubmit.disabled = true;
    aadSubmit.textContent = "Creating...";
  }

  let secondaryApp = null; // declared outside try so we can clean up in finally
  try {
    const roomDetails = allRooms.find(r => r.roomId === roomId);
    if (!roomDetails) {
      showToast("Invalid room selected", "warning");
      return;
    }
    const primaryClassSection = roomDetails.classTeacherOf || roomDetails.classesTaught?.[0];
    if (!primaryClassSection) {
      showToast("Selected teacher has no class/section assigned", "warning");
      return;
    }

    // 1. Create the Auth account on a SECONDARY app instance so the
    //    super-admin's session on the main `auth` stays intact.
    secondaryApp = initializeApp(firebaseConfig, "secondary-" + Date.now());
    const secondaryAuth = getAuth(secondaryApp);
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const uid = cred.user.uid;
    await signOut(secondaryAuth); // signs out of the secondary app only

    // 2. Write the DB record with the MAIN db (still super-admin), as the rules require.
    await set(ref(db, `ptm/users/${uid}`), {
      name,
      email,
      role: "admin",
      status: "active",
      classId: primaryClassSection.classId,
      sectionId: primaryClassSection.sectionId,
      roomId,
      createdAt: serverTimestamp(),
      createdBy: Auth.getUserId() || auth.currentUser?.uid || "super-admin"
    });

    if (addAdminModal) addAdminModal.classList.remove("visible");
    showToast(`Admin account created for ${name}.`, "success");
    // No signOut/redirect needed — you stay logged in as super-admin.
  } catch (err) {
    console.error("Add admin failed:", err.code, err.message, err);
    const messages = {
      "auth/email-already-in-use": "That email is already in use.",
      "auth/weak-password": "Password must be at least 6 characters.",
      "auth/invalid-email": "Please enter a valid email address.",
      "PERMISSION_DENIED": "Permission denied: make sure you're logged in as an active super-admin."
    };
    const key = err.code?.startsWith?.("auth/")
      ? err.code
      : (String(err.message).includes("PERMISSION_DENIED") ? "PERMISSION_DENIED" : err.code);
    showToast(messages[key] || "Failed to create admin account", "warning");
  } finally {
    if (secondaryApp) { try { await deleteApp(secondaryApp); } catch (_) {} }
    if (aadSubmit) {
      aadSubmit.disabled = false;
      aadSubmit.textContent = "Create Admin";
    }
  }
}

async function deleteAdmin(adminId) {
  // FIX: was removing ptm/admins/{adminId} — a node handleAddAdmin never wrote
  // to, so this silently did nothing. Admin records live at ptm/users/{uid}.
  // We disable rather than delete: the Firebase Auth account itself can't be
  // removed from the client without the Admin SDK, so a hard DB delete would
  // leave a login-able Auth account with no matching record — auth.js treats
  // that as "no DB record" and blocks login anyway, but disabling is explicit
  // and reversible, and matches the disabled-account check already in auth.js.
  if (!confirm(`Disable this admin account? They will no longer be able to log in.`)) return;

  try {
    await update(ref(db, `${PATHS.USERS}/${adminId}`), { status: "disabled" });
    showToast(`Admin account disabled`, "info");
  } catch (err) {
    console.error("Disable admin failed:", err);
    showToast("Failed to disable admin", "warning");
  }
}

// ---------- EXPORT TAB ----------

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

// FIX (data never loads): these exports used to read "ptm/archive", a path
// nothing in the app ever writes to (archive records actually live under
// "ptm/rooms/{roomId}/archive" — see PATHS.ROOM_ARCHIVE). So every export
// silently came back empty, which looked like exports were stuck/broken
// rather than fast. This reads the real rooms tree in a single request and
// flattens every room's archive into one list.
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

async function fetchAllArchiveRecords() {
  const snap = await get(ref(db, PATHS.ROOMS_ROOT));
  const rooms = snap.val() || {};
  const records = [];
  Object.values(rooms).forEach((room) => {
    mergeRecords(room.archive, room.students).forEach((record) => records.push(record));
  });
  return records;
}

// ---- Shared by the CSV and PDF exports ----
const isCT = (s) => s.meetingType === "CT" || s.meeting === "Class Teacher";
const isST = (s) => s.meetingType === "ST" || s.meeting === "Subject Teacher";
const exportMeeting = (s) => s.meeting || (isCT(s) ? "Class Teacher" : isST(s) ? "Subject Teacher" : "");
const exportClass = (s) => { const c = s.classId || s.class; return c ? formatClassLabel(c) : ""; };   // classId first so every record prints the same style (7th, 8th…)
const exportSection = (s) => s.section || s.sectionId || "";
const meetingSummary = (records) => `Class Teacher: ${records.filter(isCT).length}  ·  Subject Teacher: ${records.filter(isST).length}`;

const classNumOf = (s) => parseInt(s.classId ?? s.class) || 999;
// Class (number), section, Class Teacher meetings first, room, then queue order
const sortedForExport = (records) => [...records].sort((x, y) =>
  (classNumOf(x) - classNumOf(y)) ||
  String(exportSection(x)).localeCompare(String(exportSection(y))) ||
  (isCT(y) - isCT(x)) ||
  String(x.room || "").localeCompare(String(y.room || ""), undefined, { numeric: true }) ||
  ((x.queueNumber ?? 0) - (y.queueNumber ?? 0)));

if (exportCsvBtn) {
  exportCsvBtn.addEventListener("click", handleExportCsv);
}

async function handleExportCsv() {
  try {
    const recordsArray = sortedForExport(await fetchAllArchiveRecords());

    if (recordsArray.length === 0) {
      showToast("No records to export", "warning");
      return;
    }

    const lines = [];
    lines.push("Evergreen Public School — PTM All-Time Records (Full School Export)");
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push(`Total Records: ${recordsArray.length}`);
    lines.push(`Meetings — ${meetingSummary(recordsArray)}`);
    lines.push("");

    lines.push("S.No,Queue #,Student Name,Class,Section,Roll No,Meeting With,Room,Teacher,Parent/Guardian,Relation,Meeting Duration,Joined At");
    recordsArray.forEach((record, i) => {
      lines.push([
        i + 1,
        record.queueNumber ?? "",
        record.name || record.studentName || "",
        exportClass(record),
        exportSection(record),
        record.rollNo || "",
        exportMeeting(record),
        record.room || "",
        record.teacherName || "",
        record.parentName || "",
        record.relation || "",
        record.durationSeconds ? `${Math.round(record.durationSeconds)}s` : "",
        (record.createdAt || record.joinedAt) ? new Date(record.createdAt || record.joinedAt).toLocaleString() : ""
      ].map(csvEscape).join(","));
    });

    downloadBlob(lines.join("\r\n"), `ptm-export-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8;");
    showToast("CSV exported successfully", "success");
  } catch (err) {
    console.error("CSV export failed:", err);
    // Surface the real reason (e.g. a Firebase permission error) in the
    // toast itself, since most users won't have the browser console open.
    const reason = err?.code || err?.message || "Unknown error";
    showToast(`Failed to export CSV: ${reason}`, "warning");
  }
}

if (exportPdfBtn) {
  exportPdfBtn.addEventListener("click", handleExportPdf);
}

async function handleExportPdf() {
  try {
    const records = sortedForExport(await fetchAllArchiveRecords());

    if (records.length === 0) {
      showToast("No records to export", "warning");
      return;
    }

    // Guard against window.jspdf itself being missing (e.g. the CDN script
    // was blocked by an ad-blocker/network filter, or hasn't finished
    // loading yet) — destructuring straight off it would throw a generic
    // TypeError and skip the friendly message below.
    if (!window.jspdf || !window.jspdf.jsPDF) {
      showToast("PDF library failed to load. Check your internet connection and refresh.", "warning");
      return;
    }
    const { jsPDF } = window.jspdf;

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

    // Guard against the autoTable plugin not being attached (same
    // failure mode as above, just for the second CDN script).
    if (typeof doc.autoTable !== "function") {
      showToast("PDF table plugin failed to load. Check your internet connection and refresh.", "warning");
      return;
    }

    // Group records by class and section
    const groupedRecords = {};
    records.forEach((record) => {
      const classId = record.classId || record.class || "Unknown";      // classId first: parent joins store a class label in `class`
      const sectionId = record.sectionId || record.section || "Unknown";
      const key = `${classId}-${sectionId}`;

      if (!groupedRecords[key]) {
        groupedRecords[key] = {
          classId,
          sectionId,
          records: []
        };
      }
      groupedRecords[key].records.push(record);
    });

    // Sort groups: by class number, then by section letter
    const sortedKeys = Object.keys(groupedRecords).sort((a, b) => {
      const [classA, secA] = a.split("-");
      const [classB, secB] = b.split("-");
      const classNumA = parseInt(classA) || 999;
      const classNumB = parseInt(classB) || 999;
      if (classNumA !== classNumB) return classNumA - classNumB;
      return secA.localeCompare(secB);
    });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = { left: 14, right: 14, top: 60, bottom: 15 };
    let isFirstPage = true;

    // Add main header on first page
    const addMainHeader = () => {
      doc.setFillColor(79, 70, 229);
      doc.rect(0, 0, pageW, 28, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.text("Evergreen Public School", pageW / 2, 12, { align: "center" });
      doc.setFontSize(12);
      doc.setFont("helvetica", "normal");
      doc.text("Parent–Teacher Meeting — All Records (Grouped by Class)", pageW / 2, 20, { align: "center" });

      doc.setTextColor(100, 116, 139);
      doc.setFontSize(9);
      doc.text(`Generated: ${new Date().toLocaleString()}  ·  Total: ${records.length} students  ·  ${meetingSummary(records)}`, pageW / 2, 34, { align: "center" });
    };

    // Add page header (for continuation pages)
    const addPageHeader = () => {
      if (!isFirstPage) {
        doc.setFillColor(243, 244, 246);
        doc.rect(0, 0, pageW, 12, "F");
        doc.setTextColor(79, 70, 229);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.text("PTM Records (continued)", margin.left, 8);
      }
    };

    // Add footer
    const addFooter = () => {
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      const pageNum = doc.internal.getNumberOfPages();
      const totalPages = doc.internal.getNumberOfPages();
      doc.text(
        `Page ${pageNum}  ·  Evergreen Public School PTM System`,
        pageW / 2,
        pageH - 8,
        { align: "center" }
      );
    };

    addMainHeader();
    isFirstPage = false;
    let currentY = margin.top;

    // Process each class-section group
    sortedKeys.forEach((key, groupIndex) => {
      const group = groupedRecords[key];
      const { classId, sectionId, records: groupRecords } = group;
      const classLabel = `Class ${formatClassLabel(classId)} ${sectionId}`;

      // Check if we need a new page for this class header
      if (currentY > pageH - 80) {
        doc.addPage();
        addPageHeader();
        currentY = margin.top + 5;
      }

      // Add spacing before class header (except for first class)
      if (groupIndex > 0) {
        currentY += 8;
      }

      // Class-Section Heading
      doc.setTextColor(79, 70, 229);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(classLabel, margin.left, currentY);
      currentY += 6;

      // Separator line
      doc.setDrawColor(79, 70, 229);
      doc.setLineWidth(0.8);
      doc.line(margin.left, currentY, pageW - margin.right, currentY);
      currentY += 6;

      // Records count
      doc.setTextColor(100, 116, 139);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(`Total Records: ${groupRecords.length}  ·  ${meetingSummary(groupRecords)}`, margin.left, currentY);
      currentY += 4;

      // Prepare table data
      const head = [["S.No", "Queue #", "Student Name", "Class", "Sec", "Roll No", "Meeting With", "Room", "Teacher", "Parent / Guardian", "Relation"]];
      const body = groupRecords.map((s, i) => [
        String(i + 1),
        String(s.queueNumber ?? ""),
        s.name || s.studentName || "",
        exportClass(s),
        exportSection(s),
        s.rollNo || "",
        exportMeeting(s),
        s.room || "",
        s.teacherName || "",
        s.parentName || "",
        s.relation || ""
      ]);

      // Add table with auto page handling
      doc.autoTable({
        startY: currentY,
        head,
        body,
        theme: "grid",
        styles: {
          fontSize: 8,
          cellPadding: 2,
          overflow: "linebreak",
          textColor: 30
        },
        headStyles: {
          fillColor: [129, 140, 248],
          textColor: 255,
          fontStyle: "bold",
          halign: "center",
          lineWidth: 0.5,
          lineColor: [79, 70, 229]
        },
        bodyStyles: {
          lineWidth: 0.3,
          lineColor: [200, 200, 200]
        },
        alternateRowStyles: {
          fillColor: [238, 242, 255]
        },
        margin: { left: margin.left, right: margin.right },
        didDrawPage: function(data) {
          // Add footer to each page
          addFooter();
        },
        willDrawPage: function(data) {
          // If page break occurred, add page header
          if (data.pageNumber > 1 && data.pageNumber > (doc.internal.getNumberOfPages() - 1)) {
            addPageHeader();
          }
        }
      });

      // Update current position after table
      currentY = doc.lastAutoTable.finalY + 10;
    });

    // Add footer to last page
    addFooter();

    doc.save(`ptm-export-${new Date().toISOString().slice(0, 10)}.pdf`);
    showToast("PDF exported successfully", "success");
  } catch (err) {
    console.error("PDF export failed:", err);
    const reason = err?.code || err?.message || "Unknown error";
    showToast(`Failed to export PDF: ${reason}`, "warning");
  }
}

// ---------- Initialize Collapsibles on DOM Ready ----------

document.addEventListener("DOMContentLoaded", () => {
  // Initialize collapsible sections after DOM is fully loaded
  setTimeout(() => {
    initializeCollapsibleSections();
  }, 100);
});

// Also initialize when dashboard is entered
const originalEnterDashboard = enterDashboard;
enterDashboard = function() {
  originalEnterDashboard.call(this);
  setTimeout(() => {
    initializeCollapsibleSections();
  }, 100);
};