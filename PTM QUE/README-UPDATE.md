# PTM Queue — school-wide intake update

## What changed
- Replaced the multi-screen parent flow with one student intake form: Student Name, Class, Section, Roll No., and Meeting.
- Added QR deep-link support. A room QR link uses `index.html?room=<teacherId>` (or `?roomId=<teacherId>`). The room/class/section are resolved from Firebase and preselected; class and section are locked to that QR context.
- Meeting dropdown uses the existing room classification (`CT` = Class Teacher, `ST` = Subject Teacher) and routes to a configured teacher/room for the selected class and section.
- Queue records now include student name, class, section, roll number, meeting type, room, teacher and timestamps.
- Admin and super-admin CSV/PDF export columns were updated to include roll number, meeting type and room. Existing parent/guardian fields remain blank for new records and old records still export with blanks for the new fields.
- Teacher queue view now displays class, section, roll number and meeting type.
- Added `assets/user.js`, which was referenced by `index.html` but missing from the supplied ZIP.

## Room QR setup
1. Deploy the contents of the `PTM QUE` folder to the same static hosting location as the existing site.
2. In Super Admin, create each teacher/room and classify it as Class Teacher or Subject Teacher for the appropriate class/section.
3. For each room assignment, make a QR code containing the deployed public URL followed by `?room=<teacherId>`. The `<teacherId>` is the key used under `ptm/config/classes/<classId>/sections/<sectionId>/rooms/` (the existing teacher/admin setup uses this key). Do not use the displayed room number if multiple teachers could share a room number.
4. Test each QR on a phone before printing. It should open the intake page with class and section preselected. A user can select Class Teacher or Subject Teacher; the chosen type must have a configured room for that class/section.

## Important deployment checks
- This is a client-side Firebase app. Verify Realtime Database rules permit only the intended reads/writes and validate submitted fields; do not deploy broad public write access to the entire `ptm` tree.
- The intake currently uses the existing `ptm/rooms/<roomId>/session`, `students`, and `archive` data layout. Existing teacher accounts must point to the same teacher/room IDs used by room configuration.
- Test on a staging copy with one class teacher and one subject teacher before using it school-wide. Confirm token allocation, call-next/completion, archive, CSV, and PDF.
- Older records may not have `rollNo` or `meetingType`; exports intentionally leave those cells blank.
