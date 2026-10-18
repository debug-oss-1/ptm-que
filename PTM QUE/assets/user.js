import { db, PATHS } from "./firebase.js";
import {
  ref,
  get,
  set,
  push,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js";

/* ------------------------------------------------------------------
   DOWNLOAD-BUDGET NOTES (Firebase free plan = ~360 MB/day downloads)
   Every byte a phone READS from Firebase counts. For 2000 students the
   old code downloaded, on EVERY join:
     1) the whole classes + teachers config tree, and
     2) the whole student list of the room (to check duplicates).
   Now:
     1) the room list is cached on the phone (CFG_TTL) - one download per
        phone every few hours instead of one per QR scan,
     2) duplicates are checked with a tiny per-student "joinKeys" node
        (a few bytes) instead of reading the whole queue.
   A join now downloads roughly 0.3 KB instead of tens of KB.
------------------------------------------------------------------ */
const CFG_KEY = "ptm_rooms_cache_v1";
const CFG_TTL = 3 * 60 * 60 * 1000; // 3 hours; room setup rarely changes during a PTM

const $ = (id) => document.getElementById(id);
const roomSelect = $("student-room"),
  roomInfo = $("room-info"),
  joinBtn = $("join-queue-btn");
const errorBox = $("join-error"),
  statusBox = $("join-status"),
  roomBanner = $("qr-room-banner");
let rooms = [], // one entry per room: { roomId, room, teacherId, teacherName, meetingType }
  qrRoom =
    new URLSearchParams(location.search).get("room") ||
    new URLSearchParams(location.search).get("roomId") ||
    "";
let resolvedQrRoom = null;

const clean = (v) => String(v ?? "").trim();
const lc = (v) => clean(v).toLowerCase();
const safe = (v) => clean(v).replace(/[.#$[\]/]/g, "_"); // Firebase keys cannot contain . # $ [ ] /
function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
  statusBox.classList.add("hidden");
}
function showStatus(message) {
  statusBox.textContent = message;
  statusBox.classList.remove("hidden");
  errorBox.classList.add("hidden");
}
function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
}

/* ---------- Room list (cached) ---------- */
function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CFG_KEY) || "null");
    if (c && Array.isArray(c.rooms) && c.rooms.length) return c;
  } catch (e) {}
  return null;
}

// Downloads classes + teachers ONCE, boils them down to a small room list, and caches that list.
async function downloadRooms() {
  const [classSnap, teacherSnap] = await Promise.all([
    get(ref(db, PATHS.CONFIG_CLASSES)),
    get(ref(db, PATHS.CONFIG_TEACHERS)),
  ]);
  const classes = classSnap.val() || {};
  const teachers = teacherSnap.val() || {};
  const map = new Map(); // roomId -> room (a room appears under many class/sections; keep it once)
  for (const classData of Object.values(classes)) {
    for (const sectionData of Object.values(classData.sections || {})) {
      for (const [teacherId, roomData] of Object.entries(
        sectionData.rooms || {},
      )) {
        const teacher = teachers[teacherId] || {};
        const roomId = teacher.roomId || teacherId;
        if (map.has(roomId)) continue;
        map.set(roomId, {
          roomId,
          teacherId,
          room: roomData.room || teacher.room || "",
          teacherName: roomData.teacherName || teacher.name || "",
          meetingType: roomData.meetingType || teacher.meetingType || "ST",
        });
      }
    }
  }
  const list = [...map.values()].sort((a, b) =>
    String(a.room || a.roomId).localeCompare(
      String(b.room || b.roomId),
      undefined,
      { numeric: true },
    ),
  );
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify({ t: Date.now(), rooms: list }));
  } catch (e) {}
  return list;
}

// Returns the room list: fresh cache -> use it, otherwise download. If the download fails, fall back to an old cache.
async function getRooms(forceFresh = false) {
  const cached = readCache();
  if (!forceFresh && cached && Date.now() - cached.t < CFG_TTL)
    return { list: cached.rooms, fromCache: true };
  try {
    return { list: await downloadRooms(), fromCache: false };
  } catch (err) {
    if (cached) return { list: cached.rooms, fromCache: true };
    throw err;
  }
}
const findQrRoom = (list) =>
  list.find(
    (r) =>
      r.teacherId === qrRoom || r.roomId === qrRoom || String(r.room) === qrRoom,
  ) || null;

async function loadConfig() {
  let { list, fromCache } = await getRooms();
  // A QR for a room created after the cache was saved: refresh once before calling it invalid
  if (qrRoom && !findQrRoom(list) && fromCache)
    list = (await getRooms(true)).list;
  rooms = list;
  populateRoomSelect();
  if (!rooms.length) {
    joinBtn.disabled = true;
    showError("No rooms are set up yet. Please contact the school office.");
  }
  if (qrRoom) {
    resolvedQrRoom = findQrRoom(rooms);
    if (resolvedQrRoom) {
      populateRoomSelect();
      refreshRoomInfo();
      roomBanner.textContent = `Room ${resolvedQrRoom.room || qrRoom} selected from this QR code.`;
      roomBanner.classList.remove("hidden");
    } else {
      roomBanner.textContent =
        "This QR room could not be matched to the current room setup. Ask the school administrator to refresh the room QR code.";
      roomBanner.classList.remove("hidden");
      joinBtn.disabled = true;
      showError("Invalid room QR code. Please contact the school office.");
    }
  }
}

function roomLabel(g) {
  const base = g.room ? `Room ${g.room}` : g.teacherName || g.roomId;
  return g.room && g.teacherName ? `${base} · ${g.teacherName}` : base;
}
const meetingText = (r) =>
  r.meetingType === "CT" ? "Class Teacher" : "Subject Teacher";
const selectedRoom = () => rooms.find((g) => g.roomId === roomSelect.value) || null;

function populateRoomSelect() {
  roomSelect.innerHTML = rooms.length
    ? '<option value="">Select room</option>' +
      rooms
        .map(
          (g) =>
            `<option value="${escapeHtml(g.roomId)}">${escapeHtml(roomLabel(g))}</option>`,
        )
        .join("")
    : '<option value="">No rooms available</option>';
  roomSelect.disabled = !rooms.length || !!resolvedQrRoom; // a scanned QR locks the room
  if (resolvedQrRoom) roomSelect.value = resolvedQrRoom.roomId;
}
function refreshRoomInfo() {
  const g = selectedRoom();
  roomInfo.textContent = g
    ? `Selected: ${roomLabel(g)} · ${meetingText(g)} meeting`
    : "Choose the room of the teacher you want to meet.";
}
roomSelect.addEventListener("change", refreshRoomInfo);

/* ---------- Pre-fill the form from the last join on this phone ---------- */
(function prefill() {
  try {
    const u = JSON.parse(localStorage.getItem("ptm_user_info") || "null");
    if (!u) return;
    const set = (id, v) => {
      const el = $(id);
      if (el && !el.value && v) el.value = v;
    };
    set("student-name", u.name);
    set("student-roll", u.rollNo);
    set("student-class", u.classId);
    set("student-section", u.section);
    set("parent-name", u.parentName);
  } catch (e) {}
})();

/* ---------- Join the queue ---------- */
joinBtn.addEventListener("click", async () => {
  errorBox.classList.add("hidden");
  statusBox.classList.add("hidden");
  const name = clean($("student-name").value),
    rollNo = clean($("student-roll").value),
    classId = clean($("student-class").value), // typed by the parent
    sectionId = clean($("student-section").value).toUpperCase(),
    parentName = clean($("parent-name").value);
  const target = selectedRoom();
  if (!name || !classId || !sectionId || !rollNo || !parentName || !target) {
    showError(
      "Please enter the student name, class, section, roll number, parent name and the room.",
    );
    return;
  }
  const meetingType = target.meetingType === "CT" ? "CT" : "ST"; // set by the room, not chosen by the parent
  joinBtn.disabled = true;
  joinBtn.textContent = "Joining queue…";
  try {
    const roomId = target.roomId || target.teacherId;
    const sessionRef = ref(db, PATHS.ROOM_SESSION(roomId));
    const sessionSnap = await get(sessionRef); // tiny: 4 small fields
    if (!sessionSnap.exists()) {
      await set(sessionRef, {
        active: true,
        currentStudent: 0,
        lastNumber: 0,
        startedAt: serverTimestamp(),
      });
      await set(ref(db, PATHS.ROOM_STUDENTS(roomId)), {});
      await set(ref(db, PATHS.ROOM_ARCHIVE(roomId)), {});
    }

    // ---- Duplicate check WITHOUT downloading the whole queue ----
    // joinKeys/<class>_<section>_<roll> remembers the token number of the last join for that student in this room.
    const currentNow = Number(sessionSnap.val()?.currentStudent) || 0;
    const dupKey = safe(`${lc(classId)}_${lc(sectionId)}_${lc(rollNo)}`);
    const dupRef = ref(db, `${PATHS.ROOMS_ROOT}/${roomId}/joinKeys/${dupKey}`);
    try {
      const prevNo = Number((await get(dupRef)).val()?.n) || 0;
      if (prevNo > currentNow) {
        // still waiting? confirm with that ONE student record (the admin may have removed it, or the room may have been reset)
        const rec = (
          await get(ref(db, `${PATHS.ROOM_STUDENTS(roomId)}/${prevNo}`))
        ).val();
        if (
          rec &&
          lc(rec.rollNo) === lc(rollNo) &&
          lc(rec.classId) === lc(classId) &&
          lc(rec.sectionId) === lc(sectionId)
        ) {
          showError(
            `Roll no. ${rollNo} (Class ${classId}-${sectionId}) is already in this queue with Token #${prevNo}.`,
          );
          joinBtn.disabled = false;
          joinBtn.textContent = "Join PTM Queue";
          return;
        }
      }
    } catch (e) {
      console.warn("Duplicate check skipped:", e); // e.g. database rules do not allow joinKeys yet; joining still works
    }

    const numberRef = ref(db, `${PATHS.ROOM_SESSION(roomId)}/lastNumber`);
    const tx = await runTransaction(
      numberRef,
      (current) => (Number(current) || 0) + 1,
    );
    if (!tx.committed)
      throw new Error("Could not allocate a queue number. Please try again.");
    const queueNumber = Number(tx.snapshot.val());
    const archiveRef = push(ref(db, PATHS.ROOM_ARCHIVE(roomId))); // exports read the archive, so every join needs a record there
    const record = {
      archiveKey: archiveRef.key,
      queueNumber,
      name,
      studentName: name,
      class: classId, // what the parent typed
      classId,
      section: sectionId,
      sectionId,
      rollNo,
      meetingType,
      meeting: meetingType === "CT" ? "Class Teacher" : "Subject Teacher",
      room: target.room,
      roomId,
      teacherId: target.teacherId,
      teacherName: target.teacherName,
      parentName,
      relation: "",
      joinedAt: Date.now(),
      timestamp: serverTimestamp(),
      status: "waiting",
      assignedNumber: queueNumber,
    };
    await set(ref(db, `${PATHS.ROOM_STUDENTS(roomId)}/${queueNumber}`), record);
    try {
      await set(dupRef, { n: queueNumber, t: Date.now() }); // remember this join for the duplicate check
    } catch (e) {}
    try {
      const { archiveKey, status, assignedNumber, ...archiveData } = record;
      await set(archiveRef, {
        ...archiveData,
        sessionStartedAt: sessionSnap.val()?.startedAt ?? null,
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn("Archive write failed (non-critical):", e); // joining still works; this student just won't appear in exports
    }
    showStatus(
      `You're in the queue! Token #${queueNumber} · Room ${target.room || "to be confirmed"} · ${record.meeting}. Please keep this screen open.`,
    );
    joinBtn.textContent = `Joined — Token #${queueNumber}`;

    // Store the joined queue for the home screen
    const joinedQueue = {
      roomId,
      room: target.room,
      teacherName: target.teacherName,
      meetingType,
      meeting: record.meeting,
      classId,
      section: sectionId,
      name,
      rollNo,
      parentName,
      queueNumber,
      joinedAt: record.joinedAt, // same value as the database record, so the home screen can verify the ticket
    };
    let queuesArray = [];
    try {
      queuesArray = JSON.parse(localStorage.getItem("ptm_joined_queues") || "[]");
    } catch (e) {}
    // This number was just allocated to us, so any saved ticket with the same room + number is left over from an old session
    const freshList = queuesArray.filter(
      (q) => !(q.roomId === roomId && Number(q.queueNumber) === queueNumber),
    );
    freshList.push(joinedQueue);
    localStorage.setItem("ptm_joined_queues", JSON.stringify(freshList));

    // Remember the details so the next join is pre-filled
    const userInfo = {
      name,
      rollNo,
      classId,
      section: sectionId,
      parentName,
      assignedNumber: queueNumber,
      roomId,
      room: target.room,
      meetingType,
    };
    try {
      localStorage.setItem("ptm_user_info", JSON.stringify(userInfo));
    } catch (e) {
      console.error("Failed to save user info:", e);
    }

    // Tell index.html (bell sound etc.)
    window.dispatchEvent(
      new CustomEvent("ptm_queue_joined", {
        detail: {
          roomId,
          queueNumber,
          name,
          rollNo,
          classId,
          section: sectionId,
          parentName,
          room: target.room,
          meetingType,
          assignedNumber: queueNumber,
        },
      }),
    );

    // Redirect to home page (no ?room= query) so the home screen lists all joined queues
    setTimeout(() => {
      window.location.replace(window.location.pathname);
    }, 800);
  } catch (error) {
    console.error("PTM queue join failed:", error);
    showError(
      error?.message ||
        "Unable to join the queue. Check your connection and try again.",
    );
    joinBtn.disabled = false;
    joinBtn.textContent = "Join PTM Queue";
  }
});
loadConfig().catch((err) => {
  console.error(err);
  showError(
    "Could not load school classes and rooms. Please refresh or contact the administrator.",
  );
});
