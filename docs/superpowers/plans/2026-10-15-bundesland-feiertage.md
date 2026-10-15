# Bundesland und Feiertage pro Einrichtung – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every facility has a German state; public holidays follow that state (staff: their home facility), and a new facility's school cutoff is prefilled from its state.

**Architecture:** A pure domain module computes the holidays of all 16 states from `HolidayRules { state, assumptionDay }` and holds the school-cutoff table. `EmploymentInfo` carries the home facility's rules, so every employee-based rule (targets, leave, closures, week templates) follows the home facility without new parameters; facility-based views (plan, warnings, calendars, holiday list) pass the facility's rules. The Träger sets the state in the facility settings.

**Tech Stack:** Nuxt 4, Nitro, drizzle-orm + better-sqlite3, Nuxt UI 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-15-bundesland-feiertage-design.md`

## Global Constraints

- UI German, informal "du"; code, identifiers, comments, commits English. No Docker/CI changes.
- Never run `npm install`/`npm ci`. Never kill processes by image name; stop only processes you started (by PID). Port 3000 is the controller's dev server — use `--port 3100` and a scratch database copy for own checks.
- Branch `claude/state-holidays`; newest migration is `0032_tablet_children`. The new migration is generated with `npx drizzle-kit generate --name facility_state` as `0033_facility_state`; its journal `when` must be later than 0032's.
- State codes exactly: `BW BY BE BB HB HH HE MV NI NW RP SL SN ST SH TH`; existing facilities become `BW`; `assumption_day` default `true` (only effective for `BY`).
- Holiday table and cutoff table: spec §3.1 and §4, values verbatim. Easter/Pentecost Sunday are not listed; local and one-off holidays are not computed.
- Changing a facility's state or the Bavaria flag: only `requireProvider(`; applies retroactively; the UI confirms with the spec §2.2 text verbatim. Changing the state never changes the stored school cutoff.
- Service convention `fn(db, facilityId, …)`; errors `ServiceError(status, code)`; every new error code gets a German "du" text in `de.errors`.
- With all facilities in `BW`, every existing result must stay identical: the existing test suite stays green (fixture updates that only add `holidays: BW_RULES` are fine).
- Tests: `npx vitest run <file>`; all: `npm test`; types: `npm run typecheck`; build: `npm run build`.

## Review Focus

1. A helper working in a facility of another state: target and leave count must follow the home facility, the plan of the helping facility shows its own holidays. → Task 2 test.
2. A client-side calendar computing working days (admin calendar "Arbeitstage", `CalendarMonth`) still using BW after the server switched — must use the rules the DTO sends. → Task 3 removes the old BW functions so any leftover call fails to compile.
3. Changing the state of a facility with existing time records: past balances change (accepted), but nothing else (stored cutoff, auto-leave switch) may change silently. → Task 4 test.
4. A new facility created without a state in the request (old client): defaults to `BW` with BW cutoff. → Task 4 test.
5. Repentance day in years where 22 November is itself a Wednesday (the day must be 16–22 Nov, strictly before the 23rd). → Task 1 test with 2028 (22.11.2028 is a Wednesday → 22.11.).

---

### Task 1: Holidays of all states and the cutoff table (domain)

**Files:**
- Modify: `shared/domain/holidays.ts`
- Create: `shared/domain/states.ts`
- Test: `tests/domain/holidays.test.ts` (new or extend), `tests/domain/states.test.ts`

**Interfaces:**
- Produces:
  - `shared/domain/states.ts`: `export const GERMAN_STATES = ['BW','BY','BE','BB','HB','HH','HE','MV','NI','NW','RP','SL','SN','ST','SH','TH'] as const`; `export type GermanState = typeof GERMAN_STATES[number]`; `isGermanState(value: string): value is GermanState`; `schoolCutoffOf(state: GermanState): SchoolCutoff` (type from `shared/domain/schoolStart.ts`; `ageYears` 6, month/day per spec §4: BW 6/30, BY 9/30, BE 9/30, BB 9/30, HB 6/30, HH 7/1, HE 6/30, MV 6/30, NI 9/30, NW 9/30, RP 8/31, SL 6/30, SN 6/30, ST 6/30, SH 6/30, TH 8/1).
  - `shared/domain/holidays.ts`: `export interface HolidayRules { state: GermanState; assumptionDay: boolean }`; `export const BW_RULES: HolidayRules = { state: 'BW', assumptionDay: true }`; `HolidayKey` extended by `'womens_day' | 'assumption_day' | 'childrens_day' | 'reformation_day' | 'repentance_day'`; `holidaysOf(rules: HolidayRules, year: number): Map<IsoDate, HolidayKey>` (cached per state+flag+year); `holidayIn(date: IsoDate, rules: HolidayRules): HolidayKey | null`; `isHolidayIn(date: IsoDate, rules: HolidayRules): boolean`. The existing `bwHolidays`, `holidayOn(date)`, `isHoliday(date)` stay for now, implemented via `BW_RULES` (Task 2/3 replace their callers; Task 3 deletes them).
  - German names in `app/locales/de.ts` `holidays`: `womens_day: 'Internationaler Frauentag'`, `assumption_day: 'Mariä Himmelfahrt'`, `childrens_day: 'Weltkindertag'`, `reformation_day: 'Reformationstag'`, `repentance_day: 'Buß- und Bettag'`; and `de.states`: full names (`BW: 'Baden-Württemberg'`, …, `TH: 'Thüringen'`).

- [ ] **Step 1: Write failing tests.**
  - `tests/domain/holidays.test.ts`:
    - `the nationwide holidays of 2026` → for every state, `holidaysOf` contains 2026-01-01, 2026-04-03, 2026-04-06, 2026-05-01, 2026-05-14, 2026-05-25, 2026-10-03, 2026-12-25, 2026-12-26.
    - `moveable feasts 2024–2027` → Good Friday/Easter Monday/Ascension/Whit Monday/Corpus Christi (BW): 2024: 03-29, 04-01, 05-09, 05-20, 05-30; 2025: 04-18, 04-21, 05-29, 06-09, 06-19; 2026: 04-03, 04-06, 05-14, 05-25, 06-04; 2027: 03-26, 03-29, 05-06, 05-17, 05-27.
    - `the number of holidays per state in 2026` → BW 12, BY 13 (12 with `assumptionDay: false`), BE 10, BB 10, HB 10, HH 10, HE 10, MV 11, NI 10, NW 11, RP 11, SL 12, SN 11, ST 11, SH 10, TH 11.
    - `state-specific days` → `holidayIn('2026-03-08', {BE})` = `'womens_day'`, BW → null; `'2026-09-20'` TH = `'childrens_day'`; `'2026-10-31'` NI = `'reformation_day'`, BY → null; `'2026-08-15'` SL = `'assumption_day'`, BY with flag = `'assumption_day'`, BY without → null, BW → null; `'2026-01-06'` ST = `'epiphany'`, BE → null; `'2026-11-01'` RP = `'all_saints_day'`, HE → null; `'2026-06-04'` HE = `'corpus_christi'`, SN → null.
    - `repentance day is the Wednesday before 23 November` → SN: 2024-11-20, 2025-11-19, 2026-11-18, 2027-11-17, 2028-11-22; never in BW.
    - `the old BW helpers are unchanged` → `bwHolidays(2026)` equals `holidaysOf(BW_RULES, 2026)`.
  - `tests/domain/states.test.ts`: 16 states; `isGermanState('BW')` true, `'XX'` false; `schoolCutoffOf` for all 16 per the table above.
- [ ] **Step 2: Run** `npx vitest run tests/domain/holidays.test.ts tests/domain/states.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `states.ts`, the holiday rules (spec §3.1 table), texts in `de.ts`. Repentance day: the Wednesday in 16–22 November.
- [ ] **Step 4: Run** the two files and `npm run typecheck` — Expected: PASS, exit 0.
- [ ] **Step 5: Commit** `feat: public holidays and school cutoffs of all German states`.

### Task 2: Facilities have a state; holidays follow the facility (server)

**Files:**
- Modify: `server/db/schema.ts` (`facilities`), Create: `server/db/migrations/0033_facility_state.sql` (+ journal/snapshot, generated)
- Modify: `shared/domain/targets.ts` (`EmploymentInfo.holidays`, `isWorkday`), `shared/domain/leave.ts` (`countsAsLeaveDay`, `groupLeaveRanges` default removed), `shared/domain/warnings.ts` (`isCheckedDay`, `dayWarnings`), `server/services/queries.ts` (`loadEmployeeRecords`), `server/services/plan.ts` (holidayKey of the facility, `dayWarnings` rules, the placeholder `info` at ~:98), `server/services/timeTracking.ts` (holidayKey of the employee's home facility), `server/services/calendar.ts` (:92 employee rules), `server/services/facilities.ts` (`FacilityDto`), `shared/types/api.ts`, plus every caller the compiler reports
- Create: `server/services/holidayRules.ts`
- Test: `tests/services/holidayRules.test.ts`, `tests/services/db.test.ts` (migration), existing domain/service tests (fixtures)

**Interfaces:**
- Consumes: Task 1 (`HolidayRules`, `holidayIn`, `isHolidayIn`, `GermanState`, `BW_RULES`).
- Produces:
  - Schema: `facilities.state` (`state`, text not null default `'BW'`, typed `GermanState`), `facilities.assumptionDay` (`assumption_day`, boolean not null default true).
  - `server/services/holidayRules.ts`: `facilityHolidayRules(db: Db, facilityId: number): HolidayRules` (404 `facility_not_found`).
  - `EmploymentInfo` gets required `holidays: HolidayRules` (the home facility's rules), filled in `loadEmployeeRecords` (join or one facilities query). `isWorkday(info, date)` uses `isHolidayIn(date, info.holidays)`; `countsAsLeaveDay(date, rules: HolidayRules)`; `groupLeaveRanges(dates, isLeaveDay)` without default; `isCheckedDay(date, isClosureDay, rules)`; `dayWarnings(...)` receives the facility's rules.
  - `FacilityDto` gets `state: GermanState` and `assumptionDay: boolean`.
  - Tests use `BW_RULES` in hand-built `EmploymentInfo` fixtures.

- [ ] **Step 1: Write failing tests** in `tests/services/holidayRules.test.ts` (fixtures: `addFacility`, set `state` via the schema in the test; `addEmployee` with `facilityId`):
  - `a facility defaults to Baden-Württemberg` → `facilityHolidayRules(db, 1)` = `{ state: 'BW', assumptionDay: true }`.
  - `targets follow the home facility` → facility 2 in `BE`; an employee of facility 2 has `dailyTarget(info, '2026-03-09')`… use a weekday holiday: 2027-03-08 is a Monday → target 0 in BE, > 0 for an equal employee of facility 1 (BW); 2026-01-06 (Tuesday) → 0 in BW, > 0 in BE.
  - `leave days follow the home facility` → a vacation 2027-03-08..2027-03-12 costs 4 days for the BE employee and 5 for the BW one (through the leave service used by "Mein Urlaub"/requests — use the existing service function the leave tests use).
  - `a helper keeps the home facility's holidays, the plan shows the helping facility's` → BW employee with a help-out in BE facility on 2027-03-08: the BE plan's day has `holidayKey: 'womens_day'`, the employee's target on that day is still > 0.
  - In `tests/services/db.test.ts`: `0033 gives every existing facility the state BW and the Bavaria flag` (pattern of the existing per-migration tests).
- [ ] **Step 2: Run** `npx vitest run tests/services/holidayRules.test.ts tests/services/db.test.ts` — Expected: FAIL.
- [ ] **Step 3: Schema + migration** (`npx drizzle-kit generate --name facility_state`; check number 0033, later `when`, defaults present).
- [ ] **Step 4: Implement** `holidayRules.ts`, the `EmploymentInfo.holidays` field and its loading, the domain signature changes, and every server caller (follow the compiler). Facility-based: `plan.ts` (`holidayKey` and warnings with the plan facility's rules). Employee-based: everything that goes through `employee.info`, `timeTracking.ts` `holidayKey` (employee's home rules), `calendar.ts:92` (employee rules). `weekTemplates.ts`/`closures.ts`/`closureBooking.ts`/`leaveRequests.ts` keep using `employee.info` (home facility). Update test fixtures that build `EmploymentInfo` by hand (`holidays: BW_RULES`).
- [ ] **Step 5: Run** `npm test`, `npm run typecheck` — Expected: all PASS, exit 0 (client code may still use the old BW helpers; they stay until Task 3).
- [ ] **Step 6: Commit** `feat: holidays follow the facility's state (home facility for staff)`.

### Task 3: Calendars and the holiday list in the client

**Files:**
- Modify: `shared/types/api.ts` (`YearCalendarDto.holidays`), `server/services/calendar.ts` (and the leave-planning service that builds a `YearCalendarDto`), `app/components/calendar/CalendarMonth.vue`, `app/pages/admin/calendar.vue`, `app/components/closures/HolidaysSection.vue`, `app/locales/de.ts`, `shared/domain/holidays.ts` (delete `bwHolidays`, `holidayOn(date)`, `isHoliday(date)`)
- Test: `tests/services/calendar.test.ts` (or the existing calendar test file)

**Interfaces:**
- Consumes: Task 2 (`facilityHolidayRules`, `FacilityDto.state/assumptionDay`, `EmploymentInfo.holidays`).
- Produces: `YearCalendarDto.holidays: HolidayRules` — the facility's rules for the facility calendar and leave planning, the employee's home facility rules for "Mein Kalender".

- [ ] **Step 1: Write failing test** `the calendar sends the rules it was computed with` → facility calendar of a `BE` facility has `holidays.state === 'BE'`; "Mein Kalender" of an employee whose home facility is `BE` has `'BE'`, even while the active facility of a Träger is another.
- [ ] **Step 2: Run** the test — Expected: FAIL.
- [ ] **Step 3: Implement** the DTO field; `CalendarMonth.vue` and `admin/calendar.vue` use `holidayIn`/`isHolidayIn` with `calendar.holidays`; `HolidaysSection.vue` lists `holidaysOf` of the active facility (from `useFacilities()`), heading „Feiertage in ‹Bundesland›“, hint text extended: „Örtliche Feiertage (z. B. Fronleichnam in einzelnen Gemeinden) und einmalige Sonderfeiertage bitte als Schließzeit eintragen.“ Delete the old BW helpers; fix every remaining compile error.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run build` — Expected: PASS, exit 0.
- [ ] **Step 5: Commit** `feat: calendars and the holiday list use the facility's state`.

### Task 4: Setting the state; cutoff prefill and „übernehmen“

**Files:**
- Modify: `server/services/facilities.ts` (`createFacility`, rename/update), `server/api/facilities.post.ts`, `server/api/facilities/[id].put.ts`, `server/schemas.ts`, `server/services/schoolChildren.ts` (`getSchoolSettings`), `shared/types/api.ts` (`SchoolSettingsDto.stateCutoff`), `app/components/settings/FacilitiesSection.vue`, `app/components/settings/SchoolChildrenSection.vue`, the employee home-facility change dialog (find the component calling `PUT /api/employees/:id/facility`), `app/locales/de.ts`, `docs/BETRIEB.md`
- Test: `tests/services/facilities.test.ts`, `tests/services/schoolChildren.test.ts`

**Interfaces:**
- Consumes: Task 1 (`schoolCutoffOf`, `isGermanState`, `GERMAN_STATES`), Task 2 (`FacilityDto.state/assumptionDay`).
- Produces:
  - `createFacility(db, name, state: GermanState = 'BW')` sets `state` and the school cutoff from `schoolCutoffOf(state)`.
  - `updateFacility(db, id, input: { name: string; state: GermanState; assumptionDay: boolean })` (extend the existing rename function/route; body fields `state` and `assumptionDay` optional in the schema, defaulting to the stored values); 400 `state_invalid` for an unknown code. Never touches the cutoff or the auto-leave switch.
  - `SchoolSettingsDto.stateCutoff: { cutoffMonth: number; cutoffDay: number; ageYears: number }` from `schoolCutoffOf(facility.state)`.
  - `de.errors.state_invalid: 'Bitte wähle ein Bundesland aus der Liste.'`

- [ ] **Step 1: Write failing tests:**
  - `a new facility takes the cutoff of its state` → `createFacility(db, 'Krippe Nord', 'TH')` → state `TH`, `getSchoolSettings` cutoff 8/1 age 6; without state → `BW`, 6/30.
  - `changing the state keeps the cutoff and the switch` → facility with auto-leave on and cutoff 6/30, update to `NW` → cutoff still 6/30, `autoLeave` still true, `stateCutoff` = 9/30.
  - `unknown state` → `state_invalid`, nothing stored.
  - `the Bavaria flag is stored` → update `BY` with `assumptionDay: false` → `facilityHolidayRules` = `{ state: 'BY', assumptionDay: false }`.
  - Permissions: the facility routes stay `requireProvider(` (existing permissions test must stay green).
- [ ] **Step 2: Run** the two test files — Expected: FAIL.
- [ ] **Step 3: Implement** services, schemas, routes.
- [ ] **Step 4: UI.**
  - Facilities section (Träger): per facility a select „Bundesland“ (full names, order of `GERMAN_STATES`), for `BY` a checkbox „Mariä Himmelfahrt ist hier Feiertag“; creating a facility asks for the state too (default Baden-Württemberg). Saving a changed state or flag first shows a confirm dialog with the spec §2.2 text verbatim.
  - School-children section: when the stored cutoff differs from `stateCutoff`, show „Stichtag laut Schulgesetz ‹Bundesland›: ‹TT.MM.› (Alter 6)“ with a button „übernehmen“ that saves it through the existing cutoff route (so the auto-leave switch turns off as today), and the hint „Vorschlag nach dem Schulgesetz des Bundeslands (Stand Oktober 2026). Bitte bei Änderungen des Schulgesetzes prüfen.“
  - Employee home-facility change: when old and new facility have different states, the dialog shows „Die neue Einrichtung liegt in ‹Bundesland›. Für diese Person gelten dann deren Feiertage, auch rückwirkend; Sollstunden und Urlaubstage können sich dadurch ändern.“
  - `docs/BETRIEB.md`: short section „Bundesland und Feiertage“ (who sets it, retroactive effect, local holidays as closures, cutoff „übernehmen“).
- [ ] **Step 5: Run** `npm test`, `npm run typecheck`, `npm run build` — Expected: PASS, exit 0.
- [ ] **Step 6: Commit** `feat: Träger sets the state of a facility; cutoff prefill and adopt`.

### Task 5: Controller click-through (no implementer)

- [ ] In the built-in browser on the controller's dev server: create a facility in Thüringen (cutoff 01.08. prefilled), switch it to Berlin (confirm dialog; cutoff stays, „übernehmen“ offered), Schließzeiten page lists Berlin holidays incl. Frauentag, the plan of that facility marks 8.3.2027, Bayern flag on/off changes 15.8.; BW facilities unchanged. Record results in the ledger.
