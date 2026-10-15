# Anwesenheit der Kinder – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff stamp children in and out at the tablet (planned pickup time on arrival, authorised or announced pickup person on leaving), record absences, see meal counts, and Leitung/Träger print a day list and a month overview.

**Architecture:** Pure rules (status of a day, meal counting, overdue pickup, month cells) live in `shared/domain/attendance.ts`. One service `server/services/attendance.ts` owns all reads and writes on new attendance tables and logs every change with the acting person's name (also for tablet users without an account). Routes use the existing child viewer (`requireChildReader(`); the UI is a new first tab "Anwesenheit" under "Kinder" plus two print pages.

**Tech Stack:** Nuxt 4, Nitro, drizzle-orm + better-sqlite3, Nuxt UI 4, Vitest; existing PDF print route (`/api/pdf` + `/print/...` pages).

**Spec:** `docs/superpowers/specs/2026-10-15-anwesenheit-kinder-design.md`

## Global Constraints

- UI German, informal "du"; code, identifiers, comments, commits English. No Docker/CI changes.
- Never run `npm install`/`npm ci`. Never kill processes by image name; stop only processes you started (by PID). Port 3000 is the controller's dev server — use `--port 3100` and a scratch database copy for own checks.
- Branch `claude/child-attendance`; newest migration is `0033_facility_state`. The new migration is generated with `npx drizzle-kit generate --name child_attendance` as `0034_child_attendance`; its journal `when` must be later than 0033's.
- Times are minutes after midnight (`Minutes`), dates `IsoDate`, "now" via `nowInBerlin(now)` (`shared/domain/timeRecords.ts`).
- Defaults per facility: snack 09:30 (570), lunch 12:00 (720), record brought-by off. Overdue pickup: 15 minutes after the planned pickup time.
- Who: every child viewer (tablet unlocked person incl. without account and helpers on their days; Leitung/Träger on any device) may read and write attendance, also for past days. Settings and print pages: Leitung/Träger only. Mitarbeiter accounts: nothing (the child guards already answer 403 `children_tablet_only`). No print buttons at the tablet.
- Info column = allergies from the record + "Was ist heute passiert" (the day's note). Contact bans never in the info column; persons with a contact ban are never selectable as pickup person.
- Attendance data hangs on the child by cascade (deleted with the record).
- Service convention `fn(db, …)` with facility checks; errors `ServiceError(status, code)`; other facilities' or inactive children → 404 `child_not_found`; every new error code gets a German "du" text in `de.errors`.
- Tests: `npx vitest run <file>`; all: `npm test`; types: `npm run typecheck`; build: `npm run build`.

## Review Focus

1. Leaving is refused or allowed for the wrong person: a contact with `contactBan`, a contact without `mayPickUp`, an announcement of another day or another child — must be refused; announced person of today allowed. → Task 2 tests.
2. Times across midnight / a stay left open: "gestern nicht ausgestempelt" must show, the day still counts as present, and a second arrival the next day is not blocked by yesterday's open stay. → Task 2 tests.
3. Absence ranges that cross weekends, holidays, closures or an existing stay: only care days without a stay get the absence; arrival later replaces the absence of that day. → Task 2 test.
4. A child changes group mid-month or leaves/enters mid-month: the day list and the month overview show it only on its active days, in the group of each day. → Task 3 test.
5. A person without account at the tablet changes something: the change log names that person (employee name), not "null" or the tablet account. → Task 2 test.

---

### Task 1: Attendance rules (domain)

**Files:**
- Create: `shared/domain/attendance.ts`
- Modify: `shared/types/api.ts` (types below)
- Test: `tests/domain/attendance.test.ts`

**Interfaces:**
- Produces:
  - Types in `shared/types/api.ts`: `type AbsenceKind = 'sick' | 'vacation' | 'excused'`; `type AttendanceStatus = 'not_yet' | 'present' | 'gone' | 'sick' | 'vacation' | 'excused' | 'unexcused'`; `type MonthCell = 'present' | 'sick' | 'vacation' | 'excused' | 'unexcused' | 'none'`.
  - `shared/domain/attendance.ts`:
    - `interface StaySpan { arrived: Minutes; left: Minutes | null }`
    - `dayStatus(input: { stays: StaySpan[]; absence: AbsenceKind | null; date: IsoDate; today: IsoDate; isCareDay: boolean }): AttendanceStatus` — any open stay → `present`; stays all closed → `gone`; absence → that kind; `date < today && isCareDay` and no stay/absence → `unexcused`; else `not_yet`.
    - `countsForMeal(mealTime: Minutes, stays: StaySpan[], plannedPickup: Minutes | null, manual: boolean | null): boolean` — `manual` wins when not null; otherwise true iff some stay has `arrived <= mealTime` and (`left !== null` ? `left > mealTime` : (`plannedPickup === null || plannedPickup > mealTime`)).
    - `OVERDUE_MINUTES = 15`; `pickupOverdue(stays: StaySpan[], plannedPickup: Minutes | null, isToday: boolean, now: Minutes): boolean` — open stay, `isToday`, `plannedPickup !== null`, `now >= plannedPickup + 15`.
    - `monthCell(status: AttendanceStatus): MonthCell` (`present`/`gone` → `present`; `not_yet` → `none`); `monthSums(cells: MonthCell[]): Record<Exclude<MonthCell, 'none'>, number>`.

- [ ] **Step 1: Write failing tests** `tests/domain/attendance.test.ts`:
  - `dayStatus`: open stay → present; one closed + one open → present; all closed → gone; absence sick → sick; past care day nothing → unexcused; past non-care day nothing → not_yet; today nothing → not_yet; a stay beats an absence (stay + absence → present/gone).
  - `countsForMeal` (meal 570): arrived 570 open, planned 720 → true; arrived 571 → false; arrived 480 left 570 → false; arrived 480 left 571 → true; arrived 480 open planned 570 → false; planned null open → true; no stays → false; manual false overrides true case; manual true with no stays → true.
  - `pickupOverdue`: planned 900, now 914 → false; 915 → true; closed stay → false; not today → false; planned null → false.
  - `monthCell`/`monthSums` for a mixed list.
- [ ] **Step 2: Run** `npx vitest run tests/domain/attendance.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the types and functions.
- [ ] **Step 4: Run** the test and `npm run typecheck` — Expected: PASS, exit 0.
- [ ] **Step 5: Commit** `feat: attendance rules (status, meals, overdue pickup, month cells)`.

### Task 2: Attendance data and day service

**Files:**
- Modify: `server/db/schema.ts`, Create: `server/db/migrations/0034_child_attendance.sql` (+ journal/snapshot, generated)
- Modify: `server/lib/childViewer.ts` (actor identity), `server/services/tabletUnlock.ts` (`resolveChildViewer`/`tabletChildViewer` fill it), `server/schemas.ts`, `shared/types/api.ts`, `app/locales/de.ts`, `tests/api/permissions.test.ts`, `tests/helpers/fixtures.ts` (`asChildViewer` fills the new fields)
- Create: `server/services/attendance.ts`, routes under `server/api/attendance/`
- Test: `tests/services/attendance.test.ts`, `tests/services/db.test.ts`

**Interfaces:**
- Consumes: Task 1; `ChildViewer`; `groupHistories`/`groupOnDay` (Platzplanung) for the group of a day; `childStatus` (active on a date); `loadClosures`/`closureOn`; `facilityHolidayRules` + `isHolidayIn`, `isWeekend`.
- Produces:
  - Schema (spec §8.1): `childAttendanceDays` (`child_attendance_days`: `id`, `childId` cascade, `date`, `groupId` (→ groups, set null), `plannedPickup` int null, `broughtBy` text not null default '', `absence` text enum null, `note` text not null default '', `snack` boolean null, `lunch` boolean null; unique (`child_id`,`date`)), `childAttendanceStays` (`id`, `dayId` cascade, `arrived` int, `left` int null, `pickedUpBy` text null, `pickedUpContactId` → child_contacts set null), `childPickupAnnouncements` (`id`, `dayId` cascade, `name`, `announcedBy` default ''), `childAttendanceMonths` (`childId` cascade, `month` text, `remark` text; unique), `childAttendanceChanges` (`id`, `childId` cascade, `date`, `field`, `before`, `after`, `changedAt`, `changedByUserId` null, `changedByEmployeeId` null, `changedByName`); `facilities.snackTime` (`snack_time` int default 570), `facilities.lunchTime` (`lunch_time` int default 720), `facilities.recordBroughtBy` (`record_brought_by` bool default false).
  - `ChildViewer` gains `employeeId: number | null` and `name: string` (tablet: the unlocking employee; office: the account's linked employee, else the username).
  - `AttendanceDayDto` / `AttendanceChildDto` (spec §3; fields: `childId`, `name` „Nachname, Vorname“, `groupId`, `status`, `stays` (`id`, `arrived`, `left`, `pickedUpBy`), `plannedPickup`, `broughtBy`, `absence`, `note`, `allergies`, `snack`, `lunch`, `snackManual`, `lunchManual`, `announcements` (`id`, `name`, `announcedBy`), `pickupOptions` (`{ kind: 'contact' | 'announcement'; id: number; name: string }[]`), `hasContactBan`, `contactBanNotes: string[]`, `pickupOverdue`, `changed`); day: `date`, `isCareDay`, `snackTime`, `lunchTime`, `recordBroughtBy`, `counts` (`present`, `gone`, `absent`, `notYet`, `snack`, `lunch`), `groups` (`id | null`, `name`), `children`, `openStays` (earlier days within 14 days with an open stay: `date`, `childId`, `name`).
  - Service `server/services/attendance.ts` (all take `viewer: ChildViewer` and use `viewer.facilityId`; `now: Date = new Date()` last):
    - `getAttendanceDay(db, viewer, date, now?)` (children active on `date`; hidden-visibility rules do not apply — only active children are listed)
    - `arrive(db, viewer, { childId, date, time, plannedPickup, broughtBy? }, now?)` — 400 `planned_pickup_required`; 409 `already_present` (open stay that day); clears a same-day absence; stores the day's group on first creation.
    - `leave(db, viewer, { childId, date, time, pickup: { kind, id } }, now?)` — 409 `not_present`; 400 `leave_before_arrival`; 400 `pickup_person_invalid` (contact not of this child, without `mayPickUp`, with `contactBan`, or announcement of another day/child).
    - `announcePickup(db, viewer, { childId, date, name, announcedBy })`, `removeAnnouncement(db, viewer, id)`
    - `setAbsence(db, viewer, { childId, from, to, kind: AbsenceKind | null })` — applies to care days in the range without a stay; returns the number of days changed; `kind: null` clears.
    - `updateDay(db, viewer, { childId, date, plannedPickup?, broughtBy?, note?, snack?: boolean | null, lunch?: boolean | null })`
    - `updateStay(db, viewer, stayId, { arrived, left, pickup? })`, `deleteStay(db, viewer, stayId)`
    - `attendanceHistory(db, viewer, childId, date)` → change entries (newest first).
    - Every write logs one row per changed field into `child_attendance_changes` with `viewer.id`, `viewer.employeeId`, `viewer.name`.
  - Routes (all `requireChildReader(`; add them to `CHILD_READER_ROUTES`): `GET /api/attendance/day` (query `date`), `POST /api/attendance/arrive`, `POST /api/attendance/leave`, `POST /api/attendance/announcements`, `DELETE /api/attendance/announcements/[id]`, `PUT /api/attendance/absence`, `PUT /api/attendance/day`, `PUT /api/attendance/stays/[id]`, `DELETE /api/attendance/stays/[id]`, `GET /api/attendance/history` (query `childId`, `date`).
  - `de.errors`: `planned_pickup_required: 'Bitte trag ein, wann das Kind abgeholt wird.'`, `already_present: 'Das Kind ist schon eingestempelt.'`, `not_present: 'Das Kind ist gerade nicht eingestempelt.'`, `leave_before_arrival: 'Die Abholzeit liegt vor der Ankunft.'`, `pickup_person_invalid: 'Diese Person darf das Kind nicht abholen.'`.

- [ ] **Step 1: Write failing tests** `tests/services/attendance.test.ts` (fixtures: `addChild` with contacts via the contacts service; viewer via `asChildViewer` and a tablet viewer without account from `unlockChildren` as in `tests/services/childViewer.test.ts`):
  - arrive without planned pickup → `planned_pickup_required`; arrive twice → `already_present`; arrive after leave (second stay) works.
  - leave with a `mayPickUp` contact → ok, `pickedUpBy` = contact name; with a contact without `mayPickUp` → `pickup_person_invalid`; with a contact that has `contactBan` (even with `mayPickUp`) → invalid; with today's announcement → ok; with yesterday's announcement → invalid; leave before arrival → `leave_before_arrival`; leave when not present → `not_present`.
  - `pickupOptions` contains exactly the allowed contacts and today's announcements; never a banned contact.
  - absence range Mon–Sun over a public holiday and a closure day → only care days without a stay get it; later arrival on one of those days clears that day's absence.
  - an open stay from yesterday: today's `openStays` lists it, yesterday's status is `present`, today's arrival works.
  - meal counts and `snack`/`lunch` overrides; `counts` totals.
  - day group: child moved from group A to B mid-month (group change service) → day list shows B on and after the change day; the stored `groupId` of an earlier day stays A.
  - inactive child (not yet entered / left) and child of another facility → `child_not_found`.
  - change log: a tablet person without account changes the note → history entry `changedByName` = employee name, `changedByEmployeeId` set, `changedByUserId` null.
  - deleting the child record removes all attendance rows (cascade).
  - `tests/services/db.test.ts`: `0034 adds the attendance tables and the facility columns with defaults`.
- [ ] **Step 2: Run** `npx vitest run tests/services/attendance.test.ts tests/services/db.test.ts` — Expected: FAIL.
- [ ] **Step 3: Schema + migration** (generate, check number/when/defaults/cascades).
- [ ] **Step 4: Implement** viewer identity, service, schemas (zod: times 0–1439 ints, dates `isoDate`), routes, texts, permission list.
- [ ] **Step 5: Run** `npm test`, `npm run typecheck` — Expected: PASS, exit 0.
- [ ] **Step 6: Commit** `feat: child attendance – stamping, pickup, absences, change log`.

### Task 3: Month overview, settings, print pages

**Files:**
- Modify: `server/services/attendance.ts`, `server/schemas.ts`, `shared/types/api.ts`, `app/locales/de.ts`, `tests/api/permissions.test.ts`
- Create: routes `server/api/attendance/month.get.ts`, `server/api/attendance/month-remark.put.ts`, `server/api/attendance-settings.get.ts`, `server/api/attendance-settings.put.ts`; print pages `app/pages/print/children/attendance/[date].vue`, `app/pages/print/children/attendance-month/[year]/[month].vue`; settings section `app/components/settings/AttendanceSection.vue` in `app/pages/admin/settings.vue`
- Test: `tests/services/attendance.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1 (`monthCell`, `monthSums`, `dayStatus`), Task 2 (tables, `getAttendanceDay`).
- Produces:
  - `getAttendanceMonth(db, viewer, year, month, now?)` → `AttendanceMonthDto { year; month; days: { date; grey: boolean }[]; groups: { id: number | null; name: string; children: { childId; name; cells: Record<IsoDate, MonthCell>; sums; remark: string }[] }[] }` — a child appears in each group it belonged to that month, with cells only on its days in that group and on its active days.
  - `setMonthRemark(db, viewer, { childId, month: 'YYYY-MM', remark })` (logged like other changes).
  - `getAttendanceSettings(db, facilityId)` / `setAttendanceSettings(db, facilityId, { snackTime, lunchTime, recordBroughtBy })` — 400 `attendance_time_invalid` outside 0–1439.
  - Routes: month GET and remark PUT `requireChildReader(` (add to `CHILD_READER_ROUTES`); settings GET/PUT `requireAdmin(`.
  - Print pages (managers; the existing middleware already keeps Mitarbeiter accounts and the tablet away from `/print/children/…`): day list A4 landscape per group with the columns of spec §5 (brought-by column only when the facility records it), month overview per group with ✓/K/U/E/– and grey days, sums, remark. Use the existing print layout and `PrintActions` pattern of `app/pages/print/children/*.vue`.

- [ ] **Step 1: Write failing tests:** month cells for a child with present/sick/vacation/excused/unexcused days, weekends/holidays/closures grey; group change mid-month → two rows in two groups; entry mid-month → no cells before entry; sums; remark stored and logged; settings defaults 570/720/false, invalid time → `attendance_time_invalid`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** service, routes, print pages, settings section (Uhrzeit Snack, Uhrzeit Mittagessen, Schalter „Bringperson erfassen“; save with the toast pattern of `TabletSection.vue`).
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run build` — Expected: PASS, exit 0.
- [ ] **Step 5: Commit** `feat: attendance month overview, settings and print pages`.

### Task 4: The "Anwesenheit" tab

**Files:**
- Create: `app/components/children/AttendanceTab.vue`, `app/components/children/AttendanceArriveDialog.vue`, `AttendanceLeaveDialog.vue`, `AttendanceAbsenceDialog.vue`, `AttendanceAnnounceDialog.vue`, `AttendanceHistoryDialog.vue`, `AttendanceMonthTab.vue` (or a month view inside the tab — one component per dialog keeps files small)
- Modify: `app/pages/children/index.vue` (new first tab, default tab), `app/locales/de.ts`, `docs/BETRIEB.md`

**Interfaces:**
- Consumes: Task 2/3 routes and DTOs; `useChildRights()` (`onTablet`, `rights.isManager`) from the tablet project.

- [ ] **Step 1: Tab.** First tab „Anwesenheit“ (also the default tab) with date navigation (Vor/Zurück/Heute), counts line „Da · Abgeholt · Abwesend · Noch nicht da“ and „Snack ‹hh:mm›: n · Mittagessen ‹hh:mm›: n“, the `openStays` hint („gestern nicht ausgestempelt: …“ with jump to that day), rows grouped by group with: name, status text („da seit 7:45“, „abgeholt 15:10 · ‹Name›“, „krank“ …, „Abholer heute: ‹Name›“), planned pickup, snack/lunch toggles, info column (allergies, then the day's note „Was ist heute passiert“ editable inline), red row when `pickupOverdue`, a small marker when `changed` (click → history dialog), and large buttons „Kommt“ / „Geht“ / „Abwesend“ / „Abholer ankündigen“ by status. Month view switch („Monat“) showing the month grid with remark editing.
- [ ] **Step 2: Dialogs** per spec §3.2–3.5 (arrive: time default now, planned pickup required with the care type's end as suggestion, brought-by only when `recordBroughtBy`; leave: time default now, pickup person from `pickupOptions`, red contact-ban hint, message when no option exists; absence: kind + until date; announce: name + „angekündigt von“). Large touch targets at the tablet.
- [ ] **Step 3: Print buttons** (day list, month) only for managers off the tablet (`rights.isManager && !onTablet`), using the existing `PrintActions`/`/api/pdf` pattern.
- [ ] **Step 4: Docs.** `docs/BETRIEB.md`: section „Anwesenheit der Kinder“ (stamping at the tablet, planned pickup, announced pickers, absences, meals and their times, info column, printing in the office, change history).
- [ ] **Step 5: Run** `npm test`, `npm run typecheck`, `npm run build` — Expected: PASS, exit 0; headless check on port 3100 with a scratch DB: the tab renders for a manager, `/api/attendance/day` answers 403 `children_tablet_only` for a Mitarbeiter account.
- [ ] **Step 6: Commit** `feat: attendance tab with stamping dialogs and month view`.

### Task 5: Controller click-through (no implementer)

- [ ] Built-in browser at tablet size on the controller's dev server (preview copy): unlock as a person without account, „Kommt“ (planned pickup required), announce a picker, „Geht“ with the announced person, banned contact not offered, absence over several days, overdue marker (planned pickup in the past), meal counts and toggle, note in the info column, history entry with the person's name, month view; as Leitung in the office: print day list and month (PDF opens). Record results in the ledger.
