# Erinnerungen am Tablet – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A „Erinnerungen“ box on the children page (tablet after unlocking; Leitung/Träger on every device) with development-documentation reminders configured per group (with „Erledigt“), child and staff birthdays, and children leaving.

**Architecture:** Pure rules in `shared/domain/reminders.ts` compute due dates and display windows. The server stores per-group documentation settings, facility lead times, an optional staff birthday and a log of „Erledigt“ entries; one reader endpoint assembles the viewer's reminders with the existing group rules; done/undo endpoints check the group write right. The client renders the box, the settings and a record section.

**Tech Stack:** Nuxt 4, Nitro, drizzle-orm + better-sqlite3, Nuxt UI 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-erinnerungen-design.md`

## Global Constraints

- UI German, informal "du"; code, identifiers, comments, commits English. No Docker/CI changes.
- Never run `npm install`/`npm ci`. Never kill processes by image name; stop only processes you started (by PID). Port 3000 is the controller's dev server — for own checks use 127.0.0.1:3100 with `DATABASE_PATH` on a scratch DB copy.
- Branch `claude/reminders`, started after `claude/archive-staff` (newest migration then `0043_group_color_brown`). New migration `0044_reminders` (`npx drizzle-kit generate --name reminders`), journal `when` later than 0043's.
- "Today" = Berlin date (`todayIso()` / `nowInBerlin(now).date`).
- Documentation settings per group and for children without group (facility): mode `'off' | 'interval' | 'birthday'` (default `'off'`), interval months 1–24 (default 12), lead weeks 0–12 (default 2). Facility: child birthday lead days 0–30 (default 7), staff birthday lead days 0–30 (default 7), leaving lead weeks 0–12 (default 4). Out of range → 400 `reminder_setting_invalid` („Bitte einen gültigen Zeitraum angeben.“).
- Due date — interval: last done + X months, without done: entry date (else planned entry date) + X months; no entry date at all → no reminder. Birthday: the next birthday strictly after the last done date; without done: the next birthday on or after today; a done date inside the lead window before a birthday counts for that birthday. 29 Feb → 28 Feb in non-leap years. Shown from due − lead until done; overdue (red) from the due day on. Settings of the child's group **today**; only active children.
- Done: stores date, user id / employee id / name (tablet person without account by name). Undo: staff only on the same day as the done date and only their write right on the child; Leitung/Träger any time. After undo the previous done counts. Done/undo on a child the viewer may only read or not see → 403 `group_read_only` / 404 `child_not_found` (existing rules).
- Visibility: staff with group: children of the **own** group only (not read-granted groups); staff without group and helpers: all; Leitung/Träger: all. Staff birthdays: all non-left employees of the facility with a birthday, for everyone who opens the box. Nothing of this on staff phones (`requireChildReader(` keeps the tablet lock).
- Staff birthday: `MM-DD` (valid day/month, 29 Feb allowed) or null; set by Leitung/Träger in the employee master data. Never shown with a year or age.
- Leaving: future `leftOn` of the child and the automatic school-child deregistration (`schoolLeavers` / the date the daily run will deregister); facility moves are immediate in the app and give no reminder. Shown from date − lead weeks until the date.
- Order in the box: overdue, today, then by date; ties by kind (doc, birthday, leaving) then name.
- Tests: `npx vitest run <file>`; all: `npm test`; types: `npm run typecheck`; build: `npm run build`.

## Review Focus

1. A child changes group while a reminder is shown: the new group's setting applies at once; a group set to „aus“ hides it. → Task 1 test (rules) and Task 3 (service).
2. Done inside the lead window before a birthday, then the birthday passes: no reminder again until next year's window. → Task 1 test.
3. Staff member with read access to another group: sees none of that group's reminders and cannot mark them done (403). → Task 3 test.
4. Undo by staff on a later day → refused; by Leitung on a later day → works and the previous done applies. → Task 3 test.
5. A child with neither entry nor planned entry date in interval mode: no reminder, no crash. → Task 1 test.

---

### Task 1: Reminder rules (domain)

**Files:**
- Create: `shared/domain/reminders.ts`
- Test: `tests/domain/reminders.test.ts`

**Interfaces:**
- Produces:
  - `type DocMode = 'off' | 'interval' | 'birthday'`; `interface DocSettings { mode: DocMode; intervalMonths: number; leadWeeks: number }`
  - `docDue(input: { birthDate: IsoDate; entryDate: IsoDate | null; plannedEntryDate: IsoDate | null; lastDone: IsoDate | null }, settings: DocSettings, today: IsoDate): IsoDate | null`
  - `inWindow(due: IsoDate, leadDays: number, today: IsoDate): 'before' | 'upcoming' | 'today' | 'overdue'` (overdue only meaningful for docs; birthdays/leaving end on the day)
  - `nextBirthday(monthDay: string /* MM-DD */, today: IsoDate): IsoDate` (29 Feb rule)
  - `ageOn(birthDate: IsoDate, date: IsoDate): number` (reuse an existing helper if there is one)
  - `type ReminderKind = 'doc' | 'birthday' | 'staffBirthday' | 'leaving'`; `sortReminders<T extends { kind: ReminderKind; date: IsoDate; state: 'upcoming' | 'today' | 'overdue'; name: string }>(items: T[]): T[]`
- [ ] **Step 1: Failing tests:** interval with/without done, entry vs planned entry, none → null; birthday before/inside/after the lead window incl. Review Focus 2; 29 Feb in 2027 and 2028; window states at lead boundary, on the day, after; sort order; Review Focus 5.
- [ ] **Step 2: Run** `npx vitest run tests/domain/reminders.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file and `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: reminder rules for documentation, birthdays and leaving (domain)`.

### Task 2: Data and settings

**Files:**
- Modify: `server/db/schema.ts`; Create: `server/db/migrations/0044_reminders.sql` (+ journal/snapshot, generated)
- Modify/Create: settings service + routes for group documentation settings (`PUT /api/groups/[id]/documentation`) and facility reminder settings (`GET/PUT /api/reminder-settings`), `requireAdmin(`; employee master update accepts `birthday` (`server/schemas.ts` employee update, `server/services/employees.ts`), `shared/types/api.ts`, `app/locales/de.ts` (error text), permissions route list
- Test: `tests/services/reminderSettings.test.ts`, `tests/services/employees.test.ts`, `tests/services/db.test.ts`, `tests/api/permissions.test.ts`

**Interfaces:**
- Consumes: Task 1 `DocSettings`.
- Produces:
  - Columns: `groups.doc_mode` text default 'off', `groups.doc_interval_months` int default 12, `groups.doc_lead_weeks` int default 2; the same three on `facilities` (children without group); `facilities.birthday_lead_days` int default 7, `facilities.staff_birthday_lead_days` int default 7, `facilities.leaving_lead_weeks` int default 4; `employees.birthday` text null.
  - Table `child_development_docs` (`id`, `child_id` → children cascade, `done_on` text, `done_by_user_id` → users set null, `done_by_employee_id` → employees set null, `done_by_name` text, `created_at` text); index on `child_id`.
  - `ReminderSettingsDto { noGroupDoc: DocSettings; birthdayLeadDays: number; staffBirthdayLeadDays: number; leavingLeadWeeks: number; groups: { groupId: number; name: string; doc: DocSettings }[] }`; services `getReminderSettings(db, facilityId)`, `setReminderSettings(db, facilityId, input)`, `setGroupDocSettings(db, facilityId, groupId, doc)`; validation per Global Constraints; other facility's group → 404 `group_not_found`.
  - `EmployeeDto`/list item gains `birthday: string | null`; invalid → 400 `employee_birthday_invalid` („Bitte einen gültigen Geburtstag (Tag und Monat) angeben.“).
- [ ] **Step 1: Failing tests:** defaults after migration (db test), set/get settings, invalid values, foreign group 404, employee birthday valid/invalid/cleared, permissions (admin routes).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** focused files, `npm test`, `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: reminder settings, staff birthday and documentation log`.

### Task 3: Reminders service, done and undo

**Files:**
- Create: `server/services/reminders.ts`, routes `server/api/children/reminders.get.ts` (`requireChildReader(`), `server/api/children/[id]/development-docs.post.ts` (done), `server/api/children/development-docs/[id].delete.ts` (undo)
- Modify: `server/services/children.ts` (`getChild` record gets `developmentDoc: { lastDone: { id; date; name } | null; nextDue: IsoDate | null; canUndo: boolean }`), `shared/types/api.ts`, permissions route list
- Test: `tests/services/reminders.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2; `groupRight`, `seesGroup`, `childStatus`, `schoolLeavers`.
- Produces:
  - `ReminderDto { kind: ReminderKind; date: IsoDate; state: 'upcoming' | 'today' | 'overdue'; name: string; childId: number | null; age: number | null /* child birthday: age turning */; ownChild: boolean /* key educator = viewer's employee */; canDone: boolean }`
  - `listReminders(db, viewer: ChildViewer, today: IsoDate): ReminderDto[]` (sorted with `sortReminders`)
  - `markDocDone(db, viewer, childId, now)`; `undoDocDone(db, viewer, docId, now)` per Global Constraints.
- [ ] **Step 1: Failing tests:** Review Focus 1, 3, 4; staff birthdays for everyone, none for left employees; leaving from `leftOn` and school deregistration with lead weeks; key educator flag; children of read-only groups absent; Leitung sees all; `getChild` developmentDoc fields.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** focused files, `npm test`, `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: reminders for the tablet with done and undo`.

### Task 4: UI and docs

**Files:**
- Create: `app/components/children/RemindersBox.vue`, `app/components/settings/RemindersSection.vue`, `app/components/children/ChildDevelopmentDocSection.vue`
- Modify: `app/pages/children/index.vue` (box above the tabs), `app/pages/admin/settings.vue` (section „Erinnerungen“: facility lead times, no-group documentation, per group documentation mode/interval/lead), `app/pages/admin/employees/[id].vue` (field „Geburtstag“ as day + month), `app/pages/children/[id].vue` (section), `app/locales/de.ts`, `docs/BETRIEB.md`

**Interfaces:**
- Consumes: Tasks 2–3 routes/DTOs.
- [ ] **Step 1: Box:** title „Erinnerungen“, collapsible (remembered per device, localStorage in try/catch); entries with icon per kind, texts exactly: doc „Entwicklungsdoku für ‹Name› fällig am ‹TT.MM.›“ / overdue „… überfällig seit ‹TT.MM.›“ (red) / today „… heute fällig“; child birthday „‹Name› wird am ‹TT.MM.› ‹n› Jahre“ / today „‹Name› hat heute Geburtstag (‹n›)“; staff „‹Name› hat am ‹TT.MM.› Geburtstag“ / today „‹Name› hat heute Geburtstag“; leaving „‹Name› verlässt uns am ‹TT.MM.›“; „dein Kind“ badge; „Erledigt“ button (≥ 44px) when `canDone`; child names link to the record; no entries → box hidden.
- [ ] **Step 2: Settings section and employee birthday field** (existing save/toast/error patterns; German errors from `de.errors`).
- [ ] **Step 3: Record section** „Entwicklungsdokumentation“: zuletzt erledigt am ‹Datum› von ‹Name› (oder „noch nie“), nächste Fälligkeit (oder „keine Erinnerung eingestellt“), „Erledigt“, and „Rückgängig“ when `canUndo`.
- [ ] **Step 4: Docs:** BETRIEB.md section „Erinnerungen“.
- [ ] **Step 5: Run** `npm test`, `npm run typecheck`, `npm run build`; headless check on 127.0.0.1:3100 — Expected: PASS.
- [ ] **Step 6: Commit** `feat: reminders box, settings and record section`.

### Task 5: Controller check (no implementer)

- [ ] On a scratch copy: set Bären to „um den Geburtstag“, Mäuse to „alle 6 Monate“; a child birthday in 3 days; a staff birthday; a child leaving in 2 weeks; as Berta at the tablet see only Bären's reminders and the staff birthday; mark done, undo same day; as Leitung undo an older done.
