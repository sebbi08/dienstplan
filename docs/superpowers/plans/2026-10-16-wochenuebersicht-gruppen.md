# Wochenübersicht und Gruppenbücher – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A weekly overview per group (week theme + Mo–Fr "Was haben wir gemacht"), and group books: tablet staff with a group see only their own group's records and weekly overview (plus read-only groups the Leitung grants), while attendance stays visible to all with only stamping/pickup for foreign children.

**Architecture:** The child viewer gains a `groups` access (null = all groups; otherwise own group + readable groups), resolved at the tablet from the unlocking employee's home group and a new `group_read_access` table. One pure function decides `'write' | 'read' | 'none'` for a child's group; the child-record services, the attendance service and the new weekly-overview service all use it, so the server enforces every rule. The UI adds a "Wochenübersicht" tab, a print page and a read-access setting per group.

**Tech Stack:** Nuxt 4, Nitro, drizzle-orm + better-sqlite3, Nuxt UI 4, Vitest; existing PDF print route.

**Spec:** `docs/superpowers/specs/2026-10-16-wochenuebersicht-gruppen-design.md`

## Global Constraints

- UI German, informal "du"; code, identifiers, comments, commits English. No Docker/CI changes.
- Never run `npm install`/`npm ci`. Never kill processes by image name; stop only processes you started (by PID). Port 3000 is the controller's dev server — use `--port 3100` and a scratch database copy for own checks.
- Branch `claude/group-book`; newest migration is `0036_pickup_other_person`. The new migration is generated with `npx drizzle-kit generate --name group_book` as `0037_group_book`; its journal `when` must be later than 0036's.
- Group access applies only to tablet viewers whose unlocking employee is home staff of the tablet's facility AND has a group (`employees.groupId`). Everyone else (Leitung/Träger on any device, staff without group, helpers) has `groups: null` = all groups, write as before.
- A child's group: records/lists = `children.groupId` (current group); attendance = the group on that day (group history, as today); weekly overview = the selected group. A child without group is writable by everyone (within their existing rights).
- Read-only (granted) groups: read records and weekly overview; no writes at all (also not with "Kinder bearbeiten"); confidential documents only as the person's own rights allow.
- Foreign children in attendance (group of the day not own): only arrive, leave (pickup) and announce; note, absence, meal toggles, stay corrections/deletion, month remark → 403 `group_read_only`. Hidden records/weekly overviews of other groups → 404 (`child_not_found`, `document_not_found`, `group_not_found`).
- Weekly overview: Monday-based weeks (`weekStart`), Mo–Fr only; holidays (facility state) and closures labelled but writable; every change logged with the actor's name (also tablet persons without account); print only for Leitung/Träger, never at the tablet.
- Read access is set per group by Leitung/Träger (`requireAdmin(`), one-directional, default none; changes apply at once.
- Every new error code gets a German "du" text in `de.errors`: `group_read_only: 'Das Gruppenbuch dieser Gruppe kannst du nur lesen.'`, `group_not_found` (exists already? reuse if present).
- Tests: `npx vitest run <file>`; all: `npm test`; types: `npm run typecheck`; build: `npm run build`.

## Review Focus

1. A direct URL to another group's child, document file or weekly overview from a tablet person with a group — must be 404 even when that group is granted read-only for a write route (403) — every route path, not only the lists. → Task 2/3/4 tests.
2. A child changes group (or the employee changes group, or the grant is removed) while the tablet is unlocked — the next request uses the new state. → Task 2 test.
3. Attendance for a foreign child: stamping and pickup work end to end (incl. the pickup-person rules), but a stay correction through the stay id cannot be used to bypass the restriction. → Task 3 test.
4. A Leitung who is also an employee with a group unlocks the tablet — still sees everything (`groups: null`). → Task 1 test.
5. Deleting a group removes its weekly notes, history and grants; a grant pointing to a group of another facility is impossible. → Task 1/4 tests.

---

### Task 1: Group access – data, viewer, setting

**Files:**
- Modify: `server/db/schema.ts`, Create: `server/db/migrations/0037_group_book.sql` (+ journal/snapshot, generated)
- Create: `shared/domain/groupAccess.ts`, `server/services/groupReadAccess.ts`, `server/api/groups/[id]/read-access.get.ts`, `server/api/groups/[id]/read-access.put.ts`
- Modify: `server/lib/childViewer.ts`, `server/services/tabletUnlock.ts` (`viewerFor`, `resolveChildViewer`), `shared/types/api.ts`, `server/schemas.ts`, `app/components/settings/FacilityGroups.vue`, `app/locales/de.ts`, `tests/helpers/fixtures.ts` (`asChildViewer` gets `groups: null`)
- Test: `tests/domain/groupAccess.test.ts`, `tests/services/groupReadAccess.test.ts`, `tests/services/db.test.ts`

**Interfaces:**
- Produces:
  - Schema (one migration, all tables of this plan): `groupReadAccess` (`group_read_access`: `groupId` → groups cascade, `readableGroupId` → groups cascade, PK both); `groupWeekNotes` (`group_week_notes`: `id`, `groupId` cascade, `weekStart` text, `text` not null default '', `updatedAt`, `updatedByName`, unique (`group_id`, `week_start`)); `groupDayNotes` (`group_day_notes`: `id`, `groupId` cascade, `date`, `text`, `updatedAt`, `updatedByName`, unique (`group_id`, `date`)); `groupBookChanges` (`group_book_changes`: `id`, `groupId` cascade, `field` (`'week' | 'day'`), `date` (week start or day), `before`, `after`, `changedAt`, `changedByUserId` null, `changedByEmployeeId` null, `changedByName`).
  - `shared/types/api.ts`: `interface GroupAccess { own: number; readable: number[] }`.
  - `shared/domain/groupAccess.ts`: `type GroupRight = 'write' | 'read' | 'none'`; `groupRight(groupId: number | null, access: GroupAccess | null): GroupRight` — `access === null` or `groupId === null` → `write`; `groupId === own` → `write`; in `readable` → `read`; else `none`.
  - `ChildViewer.groups: GroupAccess | null` — at the tablet: home staff of the facility with an `employees.groupId` and without manager role → `{ own, readable }` from `group_read_access`; everyone else `null`. Office viewers `null`.
  - `server/services/groupReadAccess.ts`: `getReadAccess(db, facilityId, groupId): number[]`; `setReadAccess(db, facilityId, groupId, readable: number[]): void` (404 `group_not_found` for a group of another facility on either side; drops `groupId` itself from the list).
  - Routes: `GET/PUT /api/groups/[id]/read-access` with `requireAdmin(`.
  - UI: in `FacilityGroups.vue` per group „Darf zusätzlich lesen:“ with a checkbox per other group, save as the section does today; hint „Nur lesen: keine Einträge, keine Änderungen an Kinderakten.“

- [ ] **Step 1: Failing tests:** `groupRight` all branches; `setReadAccess` stores one direction, ignores self, refuses a foreign facility's group, cascades on group deletion; viewer: tablet person with group A and grant A→B → `{ own: A, readable: [B] }`; without group → `null`; helper → `null`; Leitung with an employee group → `null`; grant removed → next resolve has `readable: []`; db test for 0037 (tables exist, cascades).
- [ ] **Step 2: Run** the new test files — Expected: FAIL.
- [ ] **Step 3: Implement** schema/migration, domain, service, routes, viewer, fixture, UI, texts.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: group read access and group rights on the child viewer`.

### Task 2: Child records follow the group rights

**Files:**
- Modify: `server/services/children.ts` (`listChildren`, `listPlanned`, `getChild`, `listBirthdays`, `listOpenReviews`), `server/services/childDocuments.ts` (`documentOverview`, `listDocuments`, `readDocumentFile`), `server/lib/childRecord.ts` (`loadEditableChild`), any other child-record service that loads a child for a viewer (grep `hiddenFromViewer(`), `app/locales/de.ts`
- Test: `tests/services/childGroupAccess.test.ts`

**Interfaces:**
- Consumes: `groupRight`, `ChildViewer.groups` (Task 1).
- Produces: lists drop children with right `none` (by `children.groupId`); `getChild` → 404 `child_not_found` for `none`, and `canEdit: false` for `read`; `readDocumentFile` → 404 for `none`; `loadEditableChild` → 404 for `none`, 403 `group_read_only` for `read` (this covers every record write: master, health, consents, contacts, documents, confirmations, group changes for managers are unaffected because managers have `groups: null`).

- [ ] **Step 1: Failing tests** (tablet viewer with group A; children in A, B, C and one without group; grant A→B): list/birthdays/open/document overview show A, B and no-group, not C; `getChild` C → 404, B → ok with `canEdit: false` even for a person with „Kinder bearbeiten“; document file of C → 404; every write on B → 403 `group_read_only` (master, contact, document upload, confirm), on C → 404; child moved from A to C → hidden on the next request; viewer `null` sees all.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** with one helper (e.g. `assertGroupRight(viewer, groupId, need: 'read' | 'write')` next to `loadEditableChild`) used everywhere; add `group_read_only` to `de.errors`.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: child records only for the own and granted groups`.

### Task 3: Attendance for foreign children

**Files:**
- Modify: `server/services/childAttendance.ts`, `shared/types/api.ts` (`AttendanceChildDto.own: boolean`, `AttendanceChildDto.recordReadable: boolean`)
- Test: `tests/services/childAttendance.test.ts` (extend)

**Interfaces:**
- Consumes: `groupRight`, `ChildViewer.groups`.
- Produces: the day list still shows all children; per child `own` = `groupRight(groupOfDay, viewer.groups) === 'write'`, `recordReadable` = right of the CURRENT group (`children.groupId`) is not `none`. Writes on a foreign child (`own` false): `arrive`, `leave`, `announcePickup`, `removeAnnouncement` allowed; `updateDay` (note, meals, planned pickup, brought-by), `setAbsence`, `updateStay`, `deleteStay`, `setMonthRemark` → 403 `group_read_only`. The month view shows all children; remark editable only for own.

- [ ] **Step 1: Failing tests:** tablet person of group A on a child of group B on that day: arrive + leave with an allowed person + announce work; note/absence/meal/updateStay/deleteStay/month remark → `group_read_only`; for an own child everything as before; a child that moved from B to A on the day uses the day's group; viewer `null` unchanged; DTO flags `own`/`recordReadable`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: attendance of other groups' children limited to stamping and pickup`.

### Task 4: Weekly overview service and print page

**Files:**
- Create: `server/services/groupBook.ts`, routes `server/api/group-book/week.get.ts`, `server/api/group-book/week.put.ts`, `server/api/group-book/day.put.ts`, `server/api/group-book/history.get.ts`, print page `app/pages/print/children/week/[groupId]/[weekStart].vue`
- Modify: `server/schemas.ts`, `shared/types/api.ts`, `app/locales/de.ts` (incl. the group delete confirm text: „Ihre Pflichtdienste, Dienstplanvorlagen und Wochenübersichten werden mit gelöscht.“), `tests/api/permissions.test.ts`
- Test: `tests/services/groupBook.test.ts`

**Interfaces:**
- Consumes: `groupRight`, `ChildViewer` (incl. `name`, `employeeId`, `id`), facility holidays (`facilityHolidayRules`, `holidayIn`) and closures (`loadClosures`, `closureOn`), `weekStart`.
- Produces:
  - `GroupWeekDto { groupId; groupName; weekStart; weekNumber; theme: NoteDto; days: { date; label: string | null /* „Feiertag: …“ | „Schließtag: …“ */; note: NoteDto }[]; canWrite: boolean; groups: { id; name; right: 'write' | 'read' }[] }`, `NoteDto { text; updatedAt: string | null; updatedByName: string | null }`.
  - `getGroupWeek(db, viewer, groupId, anyDateInWeek)` (404 `group_not_found` for another facility or right `none`), `setWeekTheme(db, viewer, groupId, weekStart, text)`, `setDayNote(db, viewer, groupId, date, text)` (date must be Mo–Fr → 400 `invalid_date`; right `read` → 403 `group_read_only`), `groupBookHistory(db, viewer, groupId, field, date)`. Every change logged; no-op not logged.
  - Routes (all `requireChildReader(`; add to `CHILD_READER_ROUTES`): `GET /api/group-book/week?groupId&date`, `PUT /api/group-book/week`, `PUT /api/group-book/day`, `GET /api/group-book/history?groupId&field&date`.
  - Print page for managers (middleware keeps the tablet and Mitarbeiter accounts away from `/print/children/…`): A4 landscape, header facility/group/KW+dates, theme, five columns Mo–Fr with label and text.

- [ ] **Step 1: Failing tests:** theme and day note stored and logged with the tablet person's name (no account); no-op not logged; Saturday → `invalid_date`; holiday/closure labels (facility state); right `read` → `group_read_only`, `none`/foreign facility → `group_not_found`; viewer `null` writes everywhere; `groups` lists only visible groups with their right; deleting the group cascades notes and history.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** service, routes, print page, texts.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run build` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: weekly overview per group with history and print page`.

### Task 5: Weekly overview tab and group-aware UI

**Files:**
- Create: `app/components/children/WeekOverviewTab.vue`, `app/components/children/GroupBookHistoryDialog.vue`
- Modify: `app/pages/children/index.vue` (tab after „Anwesenheit“), `app/components/children/AttendanceTab.vue` (+ dialogs as needed: hide note/absence/meal/correction controls when `!own`; child name links to the record only when `recordReadable`), `docs/BETRIEB.md`, `app/locales/de.ts`

**Interfaces:**
- Consumes: Task 4 routes/DTOs, `AttendanceChildDto.own`/`recordReadable`, `useChildRights()` (`onTablet`, `rights.isManager`).

- [ ] **Step 1: Tab** „Wochenübersicht“: week navigation (Vor/Zurück/Diese Woche, „KW 43 · 19.–23.10.2026“), group select from `groups` (hidden when only one), theme field and Mo–Fr fields (large touch-friendly textareas, saved on blur/button as the attendance note does), labels for holidays/closures, „zuletzt geändert von …“ opening the history dialog, read-only display with a hint „Nur lesen“ when `!canWrite`; print button only for `rights.isManager && !onTablet`.
- [ ] **Step 2: Attendance UI:** for `!own` children hide/disable note editing, absence, meal toggles, stay correction; keep Kommt/Geht/Abholer ankündigen; the name is a link only when `recordReadable`.
- [ ] **Step 3: Docs:** BETRIEB.md section „Wochenübersicht und Gruppenbücher“ (who sees what, read grants in Einstellungen → Gruppen, foreign children in attendance, printing).
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run build`; headless check on port 3100 with a scratch DB — Expected: PASS; tab renders for a manager.
- [ ] **Step 5: Commit** `feat: weekly overview tab and group-aware attendance UI`.

### Task 6: Controller check (no implementer)

- [ ] On the controller's dev server (preview copy): give Berta group A and Marijke none; children in A and B; grant A→B; unlock as Berta → records of A writable, B read-only, C hidden (direct link 404); weekly overview A write, B read; attendance: B child stamp in/out works, note blocked; unlock as Marijke → all; as Leitung in the office → print week. Record results in the ledger.
