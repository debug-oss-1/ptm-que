import { db, PATHS } from "./firebase.js";
import {
  ref,
  get,
  set,
  push,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js";

const $ = (id) => document.getElementById(id);
const roomSelect = $("student-room"),
  roomInfo = $("room-info"),
  joinBtn = $("join-queue-btn");
const classPickWrap = $("class-pick-wrap"),
  classPick = $("class-pick");
const errorBox = $("join-error"),
  statusBox = $("join-status"),
  roomBanner = $("qr-room-banner");
let classes = {},
  teachers = {},
  rooms = [],
  roomGroups = [],
  qrRoom =
    new URLSearchParams(location.search).get("room") ||
    new URLSearchParams(location.search).get("roomId") ||
    "";
let resolvedQrRoom = null;

const clean = (v) => String(v ?? "").trim();
const safe = (v) => clean(v).replace(/[.#$[\]/]/g, "_");
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
function labelClass(id, data) {
  return clean(data?.name || data?.label || id);
}

async function loadConfig() {
  const [classSnap, teacherSnap] = await Promise.all([
    get(ref(db, PATHS.CONFIG_CLASSES)),
    get(ref(db, PATHS.CONFIG_TEACHERS)),
  ]);
  classes = classSnap.val() || {};
  teachers = teacherSnap.val() || {};
  rooms = [];
  for (const [classId, classData] of Object.entries(classes)) {
    for (const [sectionId, sectionData] of Object.entries(
      classData.sections || {},
    )) {
      for (const [teacherId, roomData] of Object.entries(
        sectionData.rooms || {},
      )) {
        const teacher = teachers[teacherId] || {};
        rooms.push({
          classId,
          sectionId,
          teacherId,
          roomId: teacher.roomId || teacherId,
          room: roomData.room || teacher.room || "",
          teacherName: roomData.teacherName || teacher.name || "",
          meetingType: roomData.meetingType || teacher.meetingType || "ST",
        });
      }
    }
  }
  buildRoomGroups();
  populateRoomSelect();
  if (!roomGroups.length) {
    joinBtn.disabled = true;
    showError("No rooms are set up yet. Please contact the school office.");
  }
  if (qrRoom) {
    resolvedQrRoom =
      rooms.find(
        (r) =>
          r.teacherId === qrRoom ||
          r.roomId === qrRoom ||
          String(r.room) === qrRoom,
      ) || null;
    if (resolvedQrRoom) {
      populateRoomSelect();
      if (qrServesType()) roomSelect.value = resolvedQrRoom.roomId;
      refreshRoomInfo();
      updateQrBanner();
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
function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
}

// One entry per room. A room can serve several class/section combinations (e.g. a subject teacher), kept in `options`.
function buildRoomGroups() {
  const map = new Map();
  for (const r of rooms) {
    if (!map.has(r.roomId))
      map.set(r.roomId, {
        roomId: r.roomId,
        room: r.room,
        teacherName: r.teacherName,
        options: [],
      });
    map.get(r.roomId).options.push(r);
  }
  roomGroups = [...map.values()].sort((a, b) =>
    String(a.room || a.roomId).localeCompare(
      String(b.room || b.roomId),
      undefined,
      { numeric: true },
    ),
  );
}
function roomLabel(g) {
  const base = g.room ? `Room ${g.room}` : g.teacherName || g.roomId;
  return g.room && g.teacherName ? `${base} · ${g.teacherName}` : base;
}
// Every room is listed; the meeting type (Class / Subject Teacher) comes from the room itself.
const typeOptions = (g) => g.options;
const qrGroup = () =>
  resolvedQrRoom
    ? roomGroups.find((g) => g.roomId === resolvedQrRoom.roomId) || null
    : null;
const qrServesType = () => {
  const g = qrGroup();
  return !!g && typeOptions(g).length > 0;
};
function updateQrBanner() {
  if (!resolvedQrRoom) return;
  const room = resolvedQrRoom.room || qrRoom;
  roomBanner.textContent = qrServesType()
    ? `Room ${room} selected from this QR code.`
    : `Room ${room} does not hold this type of meeting. Please pick a room below.`;
  roomBanner.classList.remove("hidden");
}
function populateRoomSelect() {
  const list = roomGroups.filter((g) => typeOptions(g).length);
  roomSelect.innerHTML = list.length
    ? '<option value="">Select room</option>' +
      list
        .map(
          (g) =>
            `<option value="${escapeHtml(g.roomId)}">${escapeHtml(roomLabel(g))}</option>`,
        )
        .join("")
    : '<option value="">No rooms for this meeting</option>';
  roomSelect.disabled = !list.length || qrServesType(); // a QR room stays locked only while it serves the chosen meeting type
  if (qrServesType()) roomSelect.value = resolvedQrRoom.roomId; // the QR room is shown as the selected room
}
const sectionName = (r) =>
  clean(classes[r.classId]?.sections?.[r.sectionId]?.name || r.sectionId);
const meetingText = (r) =>
  r.meetingType === "CT" ? "Class Teacher" : "Subject Teacher";
const classText = (r) => `Class ${r.classId} · ${r.sectionId}`; // ids, not display names, so "Class 7" never becomes "Class Class 7"
const selectedGroup = () =>
  roomGroups.find(
    (g) => g.roomId === roomSelect.value && typeOptions(g).length,
  ) || null;

// Class and section come from the room. Only a room that meets several classes asks which one the student is in.
function refreshRoomInfo() {
  const g = selectedGroup();
  classPickWrap.classList.add("hidden");
  classPick.innerHTML = "";
  if (!g) {
    roomInfo.textContent = "Choose the room of the teacher you want to meet.";
    return;
  }
  const opts = typeOptions(g);
  if (opts.length === 1) {
    roomInfo.textContent = `Selected: ${roomLabel(g)} · ${meetingText(opts[0])} meeting · ${classText(opts[0])}`;
    return;
  }
  roomInfo.textContent = `Selected: ${roomLabel(g)} · This room meets more than one class. Select the student's class below.`;
  classPick.innerHTML =
    '<option value="">Select class</option>' +
    opts
      .map(
        (r, i) => `<option value="${i}">${escapeHtml(classText(r))}</option>`,
      )
      .join("");
  classPickWrap.classList.remove("hidden");
}
roomSelect.addEventListener("change", refreshRoomInfo);

joinBtn.addEventListener("click", async () => {
  errorBox.classList.add("hidden");
  statusBox.classList.add("hidden");
  const name = clean($("student-name").value),
    rollNo = clean($("student-roll").value);
  const group = selectedGroup();
  if (!name || !rollNo || !group) {
    showError("Please enter the student name, roll number, and the room.");
    return;
  }
  const opts = typeOptions(group);
  let target = null;
  if (opts.length === 1) target = opts[0];
  else if (classPick.value !== "")
    target = opts[Number(classPick.value)] || null;
  if (!target) {
    showError("Please select the student's class.");
    return;
  }
  const meetingType = target.meetingType === "CT" ? "CT" : "ST"; // set by the room, not chosen by the parent
  const classId = target.classId,
    sectionId = target.sectionId;
  joinBtn.disabled = true;
  joinBtn.textContent = "Joining queue…";
  try {
    const roomId = target.roomId || target.teacherId;
    const sessionRef = ref(db, PATHS.ROOM_SESSION(roomId));
    const sessionSnap = await get(sessionRef);
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
    // Block duplicates: same roll no. (same class/section) still waiting in this room
    const currentNow = Number(sessionSnap.val()?.currentStudent) || 0;
    const existing = Object.values(
      (await get(ref(db, PATHS.ROOM_STUDENTS(roomId)))).val() || {},
    ).find(
      (x) =>
        x &&
        String(x.rollNo).toLowerCase() === rollNo.toLowerCase() &&
        x.classId === classId &&
        x.sectionId === sectionId &&
        Number(x.queueNumber) > currentNow,
    );
    if (existing) {
      showError(
        `Roll no. ${rollNo} is already in this queue with Token #${existing.queueNumber}.`,
      );
      joinBtn.disabled = false;
      joinBtn.textContent = "Join PTM Queue";
      return;
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
      class: labelClass(classId, classes[classId]),
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
      parentName: "",
      relation: "",
      joinedAt: Date.now(),
      timestamp: serverTimestamp(),
      status: "waiting",
      assignedNumber: queueNumber, // Store token number for quick access
    };
    await set(ref(db, `${PATHS.ROOM_STUDENTS(roomId)}/${queueNumber}`), record);
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

    // Store the joined queue for home screen
    const joinedQueue = {
      roomId,
      room: target.room,
      teacherName: target.teacherName,
      meetingType,
      meeting: meetingType === "CT" ? "Class Teacher" : "Subject Teacher",
      classId,
      section: sectionId,
      name,
      rollNo,
      queueNumber,
      joinedAt: record.joinedAt, // same value as the database record, so the home screen can verify the ticket
    };

    // Save to localStorage
    const storedQueues = localStorage.getItem("ptm_joined_queues");
    const queuesArray = storedQueues ? JSON.parse(storedQueues) : [];

    // This number was just allocated to us, so any saved ticket with the same room + number is left over from an old session
    const freshList = queuesArray.filter(
      (q) => !(q.roomId === roomId && Number(q.queueNumber) === queueNumber),
    );
    freshList.push(joinedQueue);
    localStorage.setItem("ptm_joined_queues", JSON.stringify(freshList));

    // Store user info so they don't re-enter when joining next queue
    const userInfo = {
      name,
      rollNo,
      classId,
      section: sectionId,
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

    // Emit custom event for bell sound
    window.dispatchEvent(
      new CustomEvent("ptm_queue_joined", {
        detail: {
          roomId,
          queueNumber,
          name,
          rollNo,
          classId,
          section: sectionId,
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