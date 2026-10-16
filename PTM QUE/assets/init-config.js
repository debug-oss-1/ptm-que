// ============================================================
// FIREBASE CONFIG INITIALIZATION SCRIPT
// Run this once to set up the ptm/config structure with
// initial classes, sections, and rooms for Evergreen Public School
// ============================================================
//
// USAGE:
// 1. Open browser console on super-admin.html (logged in as super admin)
// 2. Paste this entire script and run it
// 3. Check Firebase console to verify structure was created
//
// ============================================================

import { db } from "./firebase.js";
import { ref, set } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js";

async function initializeConfigStructure() {
  console.log("🚀 Initializing PTM Config Structure...");

  try {
    const configData = {
      classes: {
        "8": {
          name: "Class 8",
          sections: {
            A: {
              name: "Section A",
              rooms: {
                "8-A-101": { room: "101", teacherName: "Mr. Sharma", meetingType: "CT" },
                "8-A-201": { room: "201", teacherName: "Ms. Verma", meetingType: "ST" },
                "8-A-202": { room: "202", teacherName: "Mr. Patel", meetingType: "ST" }
              }
            },
            B: {
              name: "Section B",
              rooms: {
                "8-B-102": { room: "102", teacherName: "Mrs. Gupta", meetingType: "CT" },
                "8-B-203": { room: "203", teacherName: "Mr. Kumar", meetingType: "ST" },
                "8-B-204": { room: "204", teacherName: "Ms. Singh", meetingType: "ST" }
              }
            },
            C: {
              name: "Section C",
              rooms: {
                "8-C-103": { room: "103", teacherName: "Mr. Desai", meetingType: "CT" },
                "8-C-205": { room: "205", teacherName: "Ms. Reddy", meetingType: "ST" },
                "8-C-206": { room: "206", teacherName: "Mr. Nair", meetingType: "ST" }
              }
            },
            D: {
              name: "Section D",
              rooms: {
                "8-D-104": { room: "104", teacherName: "Mrs. Khan", meetingType: "CT" },
                "8-D-207": { room: "207", teacherName: "Mr. Iyer", meetingType: "ST" },
                "8-D-208": { room: "208", teacherName: "Ms. Das", meetingType: "ST" }
              }
            }
          }
        },
        "9": {
          name: "Class 9",
          sections: {
            A: {
              name: "Section A",
              rooms: {
                "9-A-105": { room: "105", teacherName: "Mr. Choudhury", meetingType: "CT" },
                "9-A-209": { room: "209", teacherName: "Ms. Malhotra", meetingType: "ST" }
              }
            },
            B: {
              name: "Section B",
              rooms: {
                "9-B-106": { room: "106", teacherName: "Mrs. Bhat", meetingType: "CT" },
                "9-B-210": { room: "210", teacherName: "Mr. Ramasamy", meetingType: "ST" }
              }
            },
            C: {
              name: "Section C",
              rooms: {
                "9-C-107": { room: "107", teacherName: "Mr. Chopra", meetingType: "CT" },
                "9-C-211": { room: "211", teacherName: "Ms. Pillai", meetingType: "ST" }
              }
            },
            D: {
              name: "Section D",
              rooms: {
                "9-D-108": { room: "108", teacherName: "Mrs. Rao", meetingType: "CT" },
                "9-D-212": { room: "212", teacherName: "Mr. Reddy", meetingType: "ST" }
              }
            }
          }
        },
        "10": {
          name: "Class 10",
          sections: {
            A: {
              name: "Section A",
              rooms: {
                "10-A-109": { room: "109", teacherName: "Mr. Saha", meetingType: "CT" },
                "10-A-213": { room: "213", teacherName: "Ms. Joshi", meetingType: "ST" }
              }
            },
            B: {
              name: "Section B",
              rooms: {
                "10-B-110": { room: "110", teacherName: "Mrs. Mehta", meetingType: "CT" },
                "10-B-214": { room: "214", teacherName: "Mr. Bansal", meetingType: "ST" }
              }
            },
            C: {
              name: "Section C",
              rooms: {
                "10-C-111": { room: "111", teacherName: "Mr. Saxena", meetingType: "CT" },
                "10-C-215": { room: "215", teacherName: "Ms. Kapoor", meetingType: "ST" }
              }
            },
            D: {
              name: "Section D",
              rooms: {
                "10-D-112": { room: "112", teacherName: "Mrs. Srivastava", meetingType: "CT" },
                "10-D-216": { room: "216", teacherName: "Mr. Arora", meetingType: "ST" }
              }
            }
          }
        },
        "11": {
          name: "Class 11",
          sections: {
            A: {
              name: "Section A",
              rooms: {
                "11-A-113": { room: "113", teacherName: "Mr. Tiwari", meetingType: "CT" },
                "11-A-217": { room: "217", teacherName: "Ms. Mukherjee", meetingType: "ST" }
              }
            },
            B: {
              name: "Section B",
              rooms: {
                "11-B-114": { room: "114", teacherName: "Mrs. Sharma", meetingType: "CT" },
                "11-B-218": { room: "218", teacherName: "Mr. Pandey", meetingType: "ST" }
              }
            },
            C: {
              name: "Section C",
              rooms: {
                "11-C-115": { room: "115", teacherName: "Mr. Mishra", meetingType: "CT" },
                "11-C-219": { room: "219", teacherName: "Ms. Nair", meetingType: "ST" }
              }
            },
            D: {
              name: "Section D",
              rooms: {
                "11-D-116": { room: "116", teacherName: "Mrs. Verma", meetingType: "CT" },
                "11-D-220": { room: "220", teacherName: "Mr. Singh", meetingType: "ST" }
              }
            }
          }
        },
        "12": {
          name: "Class 12",
          sections: {
            A: {
              name: "Section A",
              rooms: {
                "12-A-117": { room: "117", teacherName: "Mr. Desai", meetingType: "CT" },
                "12-A-221": { room: "221", teacherName: "Ms. Kumar", meetingType: "ST" }
              }
            },
            B: {
              name: "Section B",
              rooms: {
                "12-B-118": { room: "118", teacherName: "Mrs. Rao", meetingType: "CT" },
                "12-B-222": { room: "222", teacherName: "Mr. Bhat", meetingType: "ST" }
              }
            },
            C: {
              name: "Section C",
              rooms: {
                "12-C-119": { room: "119", teacherName: "Mr. Iyer", meetingType: "CT" },
                "12-C-223": { room: "223", teacherName: "Ms. Reddy", meetingType: "ST" }
              }
            },
            D: {
              name: "Section D",
              rooms: {
                "12-D-120": { room: "120", teacherName: "Mrs. Das", meetingType: "CT" },
                "12-D-224": { room: "224", teacherName: "Mr. Pillai", meetingType: "ST" }
              }
            }
          }
        }
      }
    };

    await set(ref(db, "ptm/config"), configData);
    console.log("✅ Config structure created successfully!");
    console.log("Classes: 8, 9, 10, 11, 12");
    console.log("Each class has sections A, B, C, D");
    console.log("Each section has Class Teacher + 2 Subject Teacher rooms");
  } catch (error) {
    console.error("❌ Failed to initialize config:", error);
  }
}

// Run the initialization
await initializeConfigStructure();
