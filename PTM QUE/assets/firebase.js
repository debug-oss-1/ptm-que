import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

export const PATHS = {
  CONFIG_CLASSES: "ptm/config/classes",
  CONFIG_ROOMS: (classId, sectionId) => `ptm/config/classes/${classId}/sections/${sectionId}/rooms`,
  // Teachers are now the source of truth for "who teaches what" — a teacher
  // can teach multiple class/section combinations and is optionally the
  // class teacher of exactly one of them. Each teacher still gets a copy of
  // their room written under every class/section they teach (see
  // CONFIG_ROOMS above) so index.html's existing per-class-section room
  // lookup keeps working unchanged.
  CONFIG_TEACHERS: "ptm/config/teachers",
  CONFIG_TEACHER: (teacherId) => `ptm/config/teachers/${teacherId}`,
  ROOMS_ROOT: "ptm/rooms",
  ROOM_SESSION: (roomId) => `ptm/rooms/${roomId}/session`,
  ROOM_STUDENTS: (roomId) => `ptm/rooms/${roomId}/students`,
  ROOM_ARCHIVE: (roomId) => `ptm/rooms/${roomId}/archive`,
  ADMINS: "ptm/admins",
  USERS: "ptm/users"
};

export function sanitizeAdminId(email) {
  return email
    .toLowerCase()
    .replace(/[^a-z0-9_-]/gi, "_")
    .replace(/\.+/g, "_")
    .replace(/_+/g, "_");
}
