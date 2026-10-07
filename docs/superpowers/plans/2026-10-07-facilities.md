# Facilities (Einrichtungen) Step 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One installation serves several facilities. A Leitung works only in its own facility; the Träger works in a chosen "active" facility and can switch between all of them.

**Architecture:**
- A new `facilities` table. Facility-owned rows get a `facility_id`.
- `SessionUser.facilityId` is resolved freshly from the database on every request.
- Facility-bound services take `facilityId` explicitly, as the 2nd parameter after `db`, and routes pass `user.facilityId`.
- Rows addressed by id are ownership-checked: a row of another facility gives 404 `*_not_found`.
- During the migration `loadEmployees`/`loadEntries` get an optional facility filter. Task 8 makes the filter mandatory, so the compiler finds every caller that still forgets it.

**Tech Stack:** Nuxt 4 (Nitro), Drizzle ORM + better-sqlite3, zod, Vitest, Nuxt UI 4.

**Spec:** docs/superpowers/specs/2026-10-07-facilities-design.md

## Global Constraints

- UI German, code English. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- First facility: id 1, name `Kindergarten`. Existing data moves into it. With one facility the app behaves exactly as before, apart from the header switcher for the Träger.
- Global, not per facility:
  - `absence_codes`
  - holidays
  - the leave module on/off switch (`leave_requests_enabled`)
  - the contract visibility switch
  - personnel numbers, unique installation-wide
  - user names
- Per facility:
  - shift templates and coverage rules
  - closures, early closures, calendar events, day notes
  - month release (month_plans, release_snapshots, change_log)
  - week templates and their marks
  - `time_tracking_from` and `leave_max_concurrent` (columns on `facilities`)
- Error codes:
  - `no_facility` (403): manager or tablet without a facility
  - `facility_not_found` (404)
  - `facility_name_required` (400)
  - `facility_name_taken` (409)
- Rows of another facility answer with the existing `*_not_found` code (404). Never confirm that they exist.
- New routes are classified in `tests/api/permissions.test.ts`.
- Existing tests keep passing. They run in facility 1, which every test DB has from the migration.
- Every migration is generated with `npx drizzle-kit generate --name <name>` and then hand-edited for data moves. Keep generated table rebuilds intact.

## Review Focus

1. A Leitung of facility A sends a request with an id from facility B (employee, entry, closure, appointment, template, user, week template, early closure, leave request, time record). It must get 404, and nothing may change. Tests: each task's isolation test.
2. The Träger switches the active facility, then reloads a page. Every list and every calculation (plan, balances, warnings, coverage) shows only the new facility's people. Tests: Task 4 and Task 8.
3. The tablet of facility A must not list or stamp facility B's people, even with a correct PIN. Test: Task 5.
4. An existing install upgrades. The users, entries, releases, day notes, `time_tracking_from` and templates all land in facility 1, and the Leitung sees everything as before. Test: Task 1 migration test.
5. Deactivating or downgrading the last Leitung of facility B while facility A still has a Leitung. "At least one active manager" counts per facility for Leitung accounts. Test: Task 6.

---

### Task 1: Schema, migration, facility context and facility API

**Files:**
- Modify: `server/db/schema.ts`. Add the `facilities` table and the `facility_id` columns from the spec table, with `.notNull().default(1)` so existing insert paths keep working until later tasks pass the value explicitly. Change the per-facility primary keys and uniques (day_notes, month_plans, early_closures.date, week_templates.name, week_template_marks).
- Create: `server/db/migrations/0019_facilities.sql` (generated, plus hand-written data moves: insert facility 1 'Kindergarten'; copy `time_tracking_from` and `leave_max_concurrent` from app_settings, then delete those keys; set `users.facility_id` = 1 for admin, terminal and provider, null for observer).
- Create: `server/services/facilities.ts`
- Modify: `server/services/auth.ts` (`toSessionUser` gets `facilityId`), `shared/types/api.ts` (`SessionUser.facilityId`, `FacilityDto`, `FacilitiesDto`), `server/utils/auth.ts`, `server/plugins/sessionCheck.ts` (already copies the fresh user), `server/db/seed.ts`
- Create routes:
  - `server/api/facilities.get.ts` (requireAdmin)
  - `server/api/facilities.post.ts` (requireProvider)
  - `server/api/facilities/[id].put.ts` (requireProvider)
  - `server/api/facilities/active.put.ts` (requireProvider)
- Modify: `tests/helpers/fixtures.ts`, `tests/api/permissions.test.ts`
- Test: `tests/services/facilities.test.ts`, `tests/services/db.test.ts`

**Interfaces:**
- Produces:
  - `facilities` drizzle table with `id, name (unique), sortOrder, timeTrackingFrom (text|null), leaveMaxConcurrent (int|null)`
  - `FacilityDto = { id: number; name: string }`
  - `FacilitiesDto = { facilities: FacilityDto[]; activeId: number | null }`
  - `SessionUser.facilityId: number | null`
  - `resolveFacilityId(db: Db, user: typeof users.$inferSelect): number | null`, used by `toSessionUser(db, row)`. The signature gains `db`; update `login` and `getActiveUser`.
  - `listFacilities(db: Db, viewer: SessionUser): FacilitiesDto` (Träger: all, sorted by sortOrder then id; others: only their own)
  - `createFacility(db: Db, name: string): FacilityDto` (copies the shift templates and coverage rules of the facility with the lowest sortOrder)
  - `renameFacility(db: Db, id: number, name: string): void`
  - `setActiveFacility(db: Db, user: SessionUser, facilityId: number): void` (Träger only; validates existence)
  - `requireFacility(user: SessionUser): number`, exported from `server/utils/auth.ts`. It returns `user.facilityId` or throws 403 `no_facility`.
  - `requireAdmin` and `requireTerminal` return a user whose `facilityId` is a number; they throw `no_facility` otherwise.
  - Fixtures:
    - `addFacility(db: Db, name: string): number` (via `createFacility`)
    - `addEmployee(db, name, options & { facilityId?: number })` (default 1)
    - `addUser(db, username, role, employeeId = null, facilityId?: number)` (default: 1 for admin, terminal and provider, otherwise derived), returning a `SessionUser` with `facilityId` set

- [ ] **Step 1: Write failing tests** in `tests/services/facilities.test.ts`:
  - `migrates existing data into "Kindergarten"`: `createTestDb()` has exactly facility `{ id: 1, name: 'Kindergarten' }`, and the seeded shift templates have facilityId 1.
  - `resolves the facility per role`:
    - admin and terminal get their `facility_id`;
    - a provider whose `facility_id` points to a missing facility gets the first facility;
    - an observer gets its employee's facility;
    - an observer without an employee gets null.
  - `creates facilities with a copy of shift templates and coverage rules`: `createFacility(db, ' Krippe ')` gives `{ name: 'Krippe' }`, the same template shortLabels as facility 1, and facility_id 2 on the copies. `createFacility(db, 'Krippe')` gives `facility_name_taken`; `''` gives `facility_name_required`.
  - `lists facilities per role`: the provider sees `[Kindergarten, Krippe]` and `activeId`; an admin of facility 2 sees only `[Krippe]`.
  - `switches the active facility for the Träger only`: `setActiveFacility` updates the provider's facilityId; an admin gets `forbidden` (403); 999 gives `facility_not_found`.
- [ ] **Step 2:** Add to `tests/services/db.test.ts` the migration test `moves app settings and users into facility 1`. Write `time_tracking_from` and `leave_max_concurrent` rows plus admin/observer users into a DB migrated only up to 0018, then run the 0019 statements. Take the approach from the existing migration test in that file, which reads statements from the SQL file. Expect the facility row to carry both values, the two keys to be gone from app_settings, admin `facility_id` 1, and observer null.
- [ ] **Step 3:** Run `npx vitest run tests/services/facilities.test.ts tests/services/db.test.ts`. Expect failures (missing table and functions).
- [ ] **Step 4:** Implement the schema, the migration (generate, then add the data moves at the end), the services, the guards and the routes as listed under Interfaces. Routes validate with zod in `server/schemas.ts`: `facilityNameSchema = z.object({ name: z.string().max(80) })` and `activeFacilitySchema = z.object({ facilityId: z.number().int().positive() })`. `seedDefaults` seeds templates and coverage rules for facility 1 when that facility has none.
- [ ] **Step 5:** Run `npx vitest run` and `npm run typecheck`. Everything should pass. Fix the call sites of `toSessionUser`.
- [ ] **Step 6:** Commit `feat: facilities table, migration into "Kindergarten", facility context in the session and facility API`.

### Task 2: Facility-bound settings and catalogues

**Files:**
- Modify:
  - `server/services/appSettings.ts`: `getTimeTrackingFrom(db, facilityId)`, `setTimeTrackingFrom(db, facilityId, value)`, `activeTrackingFrom(db, facilityId, today)` and `getAppSettings(db, facilityId)` read and write `facilities.time_tracking_from`.
  - `server/services/settings.ts`, `server/services/queries.ts` (`loadTemplates(db, facilityId)`, `loadCoverageRules(db, facilityId, onlyActive)`), `server/services/entries.ts` (`resolveEntry(db, facilityId, input)`: a template of another facility gives `template_not_found`)
  - `server/services/weekTemplates.ts`: only `adoptShiftTimesInTemplates`, limited to templates of that facility
  - routes: `settings.get`, `shift-templates/*`, `coverage-rules/*`, `app-settings.*`
  - every caller of the changed functions, passing `user.facilityId` or the facility of the data at hand
- Test: `tests/services/settings.test.ts`, plus new isolation tests

**Interfaces:**
- Consumes: Task 1 (`requireAdmin` returns a user with `facilityId: number`, fixtures `addFacility`).
- Produces:
  - `getSettings(db, facilityId)`
  - `createTemplate(db, facilityId, input)`
  - `updateTemplate(db, facilityId, id, input)`
  - `deleteTemplate(db, facilityId, id)`
  - `saveTemplateChange(db, actor, facilityId, id, input, applyFrom, now?)`
  - `createCoverageRule(db, facilityId, input)`
  - `updateCoverageRule(db, facilityId, id, input)`
  - `deleteCoverageRule(db, facilityId, id)`
  - `loadTemplates(db, facilityId)`
  - `loadCoverageRules(db, facilityId, onlyActive)`
  - `getTimeTrackingFrom(db, facilityId)`, `setTimeTrackingFrom(db, facilityId, value)`, `activeTrackingFrom(db, facilityId, today)`, `getAppSettings(db, facilityId)`
  - `resolveEntry(db, facilityId, input)`
  - Error codes for another facility's ids: templates → `template_not_found`, rules → `rule_not_found`.

- [ ] **Step 1: Failing tests:**
  - `keeps shift templates and coverage rules per facility`: with facility 2 from `addFacility`, `getSettings(db, 2).templates` are facility 2's copies. `updateTemplate(db, 1, <id of a facility 2 template>, …)` gives `template_not_found`. A coverage rule created in 2 is invisible in 1.
  - `time tracking starts per facility`: `setTimeTrackingFrom(db, 2, '2026-10-01')` leaves `getTimeTrackingFrom(db, 1)` null.
  - `entries only accept the facility's own templates`: `applyToCells` in facility 1 with a template id of facility 2 gives `template_not_found`. Use the Task 3 signature if Task 3 is already done; otherwise call `resolveEntry` directly.
- [ ] **Step 2:** Run the tests and see them fail.
- [ ] **Step 3:** Implement. Callers that cannot yet know the facility (services Task 3–5 will scope) pass the facility of the employee they handle; `employees.facility_id` is readable from the row.
- [ ] **Step 4:** Run `npx vitest run` and `npm run typecheck`. Everything should pass.
- [ ] **Step 5:** Commit `feat: shift templates, coverage rules and time tracking start per facility`.

### Task 3: Employees, plan entries, day notes, closures, early closures

**Files:**
- Modify:
  - `server/services/queries.ts`:
    - `loadEmployees(db, facilityId?: number)` filters by home facility when it is given;
    - `loadEntries` accepts `filter.facilityId` (a join on employees);
    - `loadClosures(db, facilityId)`.
  - `server/services/employees.ts`: every list function and `createEmployee` take facilityId. Id-based functions check that the employee belongs to the facility; they take `(db, facilityId, id, …)`.
  - `server/services/entries.ts`:
    - `applyToCells(db, actor, facilityId, cells, mode, input, options?)`: every cell's employee must belong to the facility, otherwise `employee_not_found`;
    - `deleteEntry(db, actor, facilityId, id)` and `updateEntryTimes(db, actor, facilityId, id, change, now?)` give `entry_not_found` for another facility;
    - `setDayNote(db, actor, facilityId, date, field, value, now?)`.
  - `server/services/changeLog.ts`: `isMonthReleased(db, facilityId, date)` and `logChange(db, { facilityId, … })`.
  - `server/services/closures.ts`: `listClosures`, `createClosure` and `deleteClosure` take facilityId, and closures are booked only for the facility's employees. `bookClosuresFor` uses the employee's facility.
  - `server/services/earlyClosures.ts`: all functions; the duplicate date check is per facility.
  - the matching routes under `employees/*`, `employee-hours`, `balance-adjustments`, `entries/*`, `day-notes`, `closures/*`, `early-closures/*`, and `contract.put`, `stamping.put` and `pin` (ownership)
  - all tests calling these functions
- Test: the existing service tests, plus `tests/services/facilityIsolation.test.ts` (new, shared by Tasks 3–6)

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `loadEmployees(db, facilityId?)` and `loadEntries(db, { …, facilityId? })`
  - `loadClosures(db, facilityId)`
  - the employees service signatures with facilityId as the 2nd parameter, e.g. `listEmployees(db, facilityId, today, viewer)`, `getEmployee(db, facilityId, id, today, viewer)` and `createEmployee(db, actor, facilityId, input, now?)`
  - `applyToCells(db, actor, facilityId, cells, mode, input, options?)`
  - `setDayNote(db, actor, facilityId, date, field, value, now?)`
  - `logChange(db, change & { facilityId: number })`

- [ ] **Step 1: Failing tests** in `facilityIsolation.test.ts`. Setup: facility 2 via `addFacility`, employee `anna` in 1, `kim` in 2, admin `leitungA` (facility 1).
  - `lists only the facility's employees`: `listEmployees(db, 1, …)` gives `['Anna']`; `getEmployee(db, 1, kim, …)` gives `employee_not_found`.
  - `refuses plan entries for another facility's employee`: `applyToCells(db, leitungA, 1, [{ employeeId: kim, date }], …)` gives `employee_not_found` and creates no entry.
  - `keeps day notes per facility`: setting `info1` on the same date in 1 and 2 keeps both texts.
  - `books closures only for the facility's staff`: `createClosure(db, admin, 1, …)` creates entries for Anna only; `listClosures(db, 2)` is empty.
  - `early closures may share a date across facilities`.
  - `creates employees in the given facility with their own sort order`: the first employee of facility 2 gets sortOrder 1.
- [ ] **Step 2:** Run the tests and see them fail.
- [ ] **Step 3:** Implement and update every caller and every existing test (mechanical: pass `1`).
- [ ] **Step 4:** Run `npx vitest run` and `npm run typecheck`. Everything should pass.
- [ ] **Step 5:** Commit `feat: employees, plan entries, day notes and closures per facility`.

### Task 4: Month plan, releases, notifications, week templates, balances, calendar, leave and sick-day overviews

**Files:**
- Modify:
  - `server/services/plan.ts`: `getMonthPlan(db, viewer, facilityId, year, month, today)`. Coverage and warnings cover the facility's staff only.
  - `server/services/release.ts`: `buildSnapshot(db, facilityId, year, month)`, `releaseMonth(db, actor, facilityId, year, month, now?)`, `loadReleases(db, facilityId, year, month)`, and `backfillSnapshots` per facility.
  - `server/services/revert.ts`
  - `server/services/notifications.ts`: `releaseNotificationStatus(db, facilityId, year, month)`; `notifyDutyChanges` limited to the facility's employees.
  - `server/services/weekTemplates.ts`: all functions take facilityId; template names are unique per facility; marks per facility.
  - `server/services/balances.ts`: `getBalanceOverview(db, facilityId, …)`; `computeBalances` loads entries and adjustments for the given staff only.
  - `server/services/calendar.ts`: `getYearCalendar(db, facilityId, year, options?)`, `getSickYear(db, facilityId, year)`, the calendar event CRUD (ownership), and `getStaffYearCalendar(db, facilityId, year, viewerEmployeeId)`.
  - `server/services/leave.ts`: `getLeaveOverview(db, facilityId, …)`; `getLeaveAccount` derives the facility from the employee.
  - `server/services/employees.ts`: `listLevelUps(db, facilityId, today, viewer)`.
  - routes: `plan/*`, `print` data routes, `balances`, `calendar*`, `sick-days`, `leave.get`, `level-ups`, `week-templates/*`, `my/plan` and `my/calendar` (the facility of the viewer's employee)
  - the tests
- Test: extend `facilityIsolation.test.ts`

**Interfaces:**
- Consumes: Task 3.
- Produces: the signatures above. `getMyPlan` and `my/calendar` use `viewer.facilityId` (the observer's employee facility, from Task 1).

- [ ] **Step 1: Failing tests:**
  - `month plan and warnings only show the facility's people`: facility 1's plan lists Anna only, and no `missing_entry` warning names Kim.
  - `releases are per facility`: releasing facility 1 leaves facility 2 unreleased, and a re-release of 1 only notifies facility 1's employees.
  - `week template names are unique per facility only`: the name "Woche A" is allowed in 1 and 2.
  - `balances, calendar, sick days, leave overview and level-ups list only the facility's people`.
  - `calendar events stay in their facility`: `updateCalendarEvent(db, 1, <id from 2>, …)` gives `event_not_found`.
- [ ] **Step 2:** Run the tests and see them fail.
- [ ] **Step 3:** Implement, and update callers and tests.
- [ ] **Step 4:** Run `npx vitest run` and `npm run typecheck`. Everything should pass.
- [ ] **Step 5:** Commit `feat: plans, releases, templates, balances and overviews per facility`.

### Task 5: Time tracking, tablet, own pages, leave requests

**Files:**
- Modify:
  - `server/services/timeTracking.ts`:
    - `actualTimeFor(db, facilityId, today)`;
    - `stamp` uses the employee's facility for `activeTrackingFrom`;
    - `listOpenRecords(db, facilityId)` and `getTimeMonth(db, facilityId, employeeId, year, month, today)`;
    - create, update and delete record, plus the day note, give `employee_not_found` or `record_not_found` for another facility.
  - `server/services/terminal.ts`: `terminalStatus(db, facilityId, now?)`; `terminalStamp(db, facilityId, employeeId, pin, action, now?)` gives `employee_not_found` for another facility, before the PIN check (so no lockout counting).
  - `server/services/myTime.ts`
  - `server/services/leaveRequests.ts`:
    - `maxConcurrent(db, facilityId)` and `setMaxConcurrent(db, user, facilityId, value)` use `facilities.leave_max_concurrent`;
    - the load calculation covers the facility's employees only;
    - `listOpenRequests`, `decideLeaveRequest` and `getLeavePlanning` take facilityId;
    - `isPlanner(db, user, facilityId)`: a Träger is always a planner; a Leitung only for its own facility and when listed in leave_planners;
    - `getLeaveSettings(db, viewer)` uses `viewer.facilityId`.
  - routes: `time-records/*`, `terminal/*`, `my/time*`, `my/leave-requests*`, `leave-planning`, `leave-requests/*`, `leave-settings*`
  - the tests
- Test: extend `facilityIsolation.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: the signatures above.

- [ ] **Step 1: Failing tests:**
  - `the tablet lists and stamps only its own facility`: the terminal of facility 2 does not list Anna; `terminalStamp(db, 2, anna, '1234', 'in')` gives `employee_not_found`, and Anna's `pinFailed` stays 0.
  - `time records stay in their facility`: `listOpenRecords(db, 2)` does not contain Anna's open record; `updateRecord` for facility 1 with a facility 2 record id gives `record_not_found`.
  - `stamping uses the employee's own tracking start`: facility 2 has tracking off, facility 1 has it on. Anna (in 1) can stamp; Kim (in 2) gets `time_tracking_off`.
  - `leave planning, limit and counting are per facility`: limits set separately; facility 2's requests are not in facility 1's open list; a Leitung of 2 is not a planner for 1.
- [ ] **Step 2:** Run the tests and see them fail.
- [ ] **Step 3:** Implement, and update callers and tests.
- [ ] **Step 4:** Run `npx vitest run` and `npm run typecheck`. Everything should pass.
- [ ] **Step 5:** Commit `feat: time tracking, tablet and leave requests per facility`.

### Task 6: Users and employee moves

**Files:**
- Modify: `server/services/users.ts`, the routes `users/*`, `server/schemas.ts`
- Create: `server/api/employees/[id]/facility.put.ts` (requireProvider), with `moveEmployeeToFacility` in `server/services/employees.ts`
- Test: `tests/services/users.test.ts`, `facilityIsolation.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces:
  - `listUsers(db, viewer)`:
    - Träger: users of the active facility plus all Träger accounts;
    - Leitung: its facility's Leitung and tablet accounts, the Mitarbeiter accounts of its employees, and the Träger accounts (read-only, as before).
  - `createUser(db, actor, input)` creates Leitung and tablet accounts in `actor.facilityId`.
  - `updateUser(db, actor, id, update)` and `resetPassword(db, actor, id, password)` give `user_not_found` for users outside what `listUsers` shows the actor.
  - Linking a Mitarbeiter account to an employee of another facility gives `employee_not_found`.
  - The `last_admin` check counts active Leitung accounts of the same facility plus all active Träger.
  - `moveEmployeeToFacility(db, employeeId, facilityId): void`: unknown ids give `employee_not_found` or `facility_not_found`. Hours, leave, balances and entries stay attached to the employee.

- [ ] **Step 1: Failing tests:**
  - `a Leitung only sees and manages its own facility's users`
  - `links Mitarbeiter accounts only to the facility's employees`
  - `counts the last Leitung per facility`: downgrading the only Leitung of facility 2 while facility 1 has one gives `last_admin`, as long as no Träger exists. With an active Träger it is allowed.
  - `the Träger moves an employee to another facility`: afterwards Kim is listed in 1; Kim's Mitarbeiter account resolves facility 1 via `getActiveUser`.
- [ ] **Step 2:** Run the tests and see them fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run` and `npm run typecheck`. Everything should pass.
- [ ] **Step 5:** Commit `feat: users per facility and moving employees between facilities`.

### Task 7: UI — facility switcher, facility management, users and employee move

**Files:**
- Modify:
  - `app/layouts/default.vue`: next to the app title, the active facility's name for every manager. For the Träger it is a `USelect` of all facilities from `GET /api/facilities`; on change, `PUT /api/facilities/active`, then `reloadNuxtApp()`.
  - `app/pages/admin/settings.vue`: new component `app/components/settings/FacilitiesSection.vue` (Träger only), listing facilities with rename and "Einrichtung anlegen".
  - `app/pages/admin/users.vue`: no UI change beyond what the server filters. A hint line shows which facility new Leitung and tablet accounts are created in.
  - `app/pages/admin/employees/[id].vue`: for the Träger, a "Einrichtung" select plus "Verschieben" (confirm dialog), calling `PUT /api/employees/:id/facility`.
  - `app/locales/de.ts`: a new `facilities` block with these keys:
    - `title`: "Einrichtungen"
    - `active`: "Einrichtung"
    - `add`: "Einrichtung anlegen"
    - `name`: "Name"
    - `rename`: "Umbenennen"
    - `hint`: "Neue Einrichtungen übernehmen die Dienste und Pflichtdienste der ersten Einrichtung; alles andere beginnt leer."
    - `createdIn: (name: string) => \`Neue Leitungs- und Tablet-Konten werden in „${name}“ angelegt.\``
    - `move`: "In andere Einrichtung verschieben"
    - `moveConfirm: (name: string) => \`Mitarbeiter in „${name}“ verschieben? Stunden, Urlaub und Dienste bleiben erhalten.\``
    - `switched`: "Einrichtung gewechselt"
  - It also adds the error texts for `no_facility`, `facility_not_found`, `facility_name_required` and `facility_name_taken`.
  - `app/components/users/RightsTable.vue`: add the row "Einrichtungen anlegen, umbenennen, zwischen ihnen wechseln, Mitarbeiter verschieben" (Träger ✓ only).
- Test: `npm run typecheck`, plus the manual browser check described in Step 2

**Interfaces:**
- Consumes: the routes from Tasks 1 and 6.

- [ ] **Step 1:** Implement the components and wire them in.
- [ ] **Step 2:** Verify in the running dev app with temporary accounts. Create them via a tsx script and delete them afterwards; never touch the real accounts. Check:
  - the Träger sees the dropdown, creates "Test-Einrichtung", switches, and sees an empty employee list and the copied Dienste;
  - switching back shows the old data;
  - the Leitung sees only the facility name, without a dropdown.
  - Then delete the test facility rows directly via a script, together with the copied templates and rules.
- [ ] **Step 3:** Run `npm run typecheck` and `npx vitest run`. Both should pass.
- [ ] **Step 4:** Commit `feat: facility switcher and facility management for the Träger`.

### Task 8: Make the facility filter mandatory, final isolation sweep

**Files:**
- Modify:
  - `server/services/queries.ts`: `loadEmployees(db, facilityId: number)` with the parameter required. `loadEntries` keeps the optional filter, because entries are always narrowed by employee or facility in callers.
  - Keep the DB defaults (`1`) on the facility columns. Removing them would rebuild 11 tables and change no behaviour. Instead, Step 2 adds a test that each create function writes the given facility.
  - Fix every compile error this surfaces by passing the right facility.
- Test: `facilityIsolation.test.ts`, `tests/api/permissions.test.ts`

- [ ] **Step 1:** Make the changes and run `npm run typecheck`. Every remaining caller shows up as an error; fix each one.
- [ ] **Step 2:** Add the isolation test `every admin list is empty in a fresh facility`. In a new facility 2, call each list function once with facilityId 2 and expect only facility 2 data, which is empty except the copied templates and rules: employees, closures, early closures, events, week templates, open records, open leave requests, sick-day overview, balances, calendar staff. Also add `create functions write the given facility`: create an employee, closure, early closure, calendar event, shift template, coverage rule, week template and day note in facility 2, and assert each stored row has `facility_id` 2 (read via drizzle).
- [ ] **Step 3:** Run `npx vitest run` and `npm run typecheck`. Both should pass.
- [ ] **Step 4:** Commit `refactor: facility is mandatory in every employee query`.
