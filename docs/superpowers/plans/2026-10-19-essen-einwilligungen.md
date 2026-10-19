# Essen je Einrichtung, Essensübersicht und neue Einwilligungen – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meals defined per facility with dated versions (past days never change), per-meal counting with a total and per-group overview in the attendance list and print, plus the consent changes (insect repellent, WhatsApp duplicate removed, Signal photos).

**Architecture:** A pure domain module resolves which meals (name, time) apply on a date from dated versions. The server stores meals, versions and per-day manual ticks in new tables (replacing `facilities.snack_time/lunch_time` and `child_attendance_days.snack/lunch`), a meal settings service with `requireAdmin(` routes, and `getAttendanceDay` returns the day's meals, per-child meal state and a group summary. Consents get two new columns and lose one by a data-preserving migration.

**Tech Stack:** Nuxt 4, Nitro, drizzle-orm + better-sqlite3, Nuxt UI 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-essen-einwilligungen-design.md`

## Global Constraints

- UI German, informal "du"; code, identifiers, comments, commits English. No Docker/CI changes.
- Never run `npm install`/`npm ci`. Never kill processes by image name; stop only processes you started (by PID). Port 3000 is the controller's dev server — use `--port 3100` and a scratch database copy for own checks.
- Branch `claude/meals` starts from the group-colours branch; newest migration at start is `0039_group_colors`. New migrations are generated with `npx drizzle-kit generate --name <name>`: `0040_meals` (Task 2: new tables + data copy, old columns kept), `0041_meals_cleanup` (Task 3: drops the old meal columns), `0042_consents` (Task 4); each journal `when` later than the previous one. Data-copy SQL is added by hand to the generated file BEFORE the generated table rebuilds/drops.
- "Today" is the Berlin date: `nowInBerlin(now).date` (`shared/domain/timeRecords`).
- Meal: name trimmed, 1–40 chars, unique per facility case-insensitively among meals not removed (409 `meal_name_taken`: „Dieses Essen gibt es schon.“); time 0–1439 (400 `attendance_time_invalid`, existing); at most 8 meals not removed (400 `meal_limit`: „Es sind höchstens 8 Essen möglich.“); `validFrom` ≥ today (400 `meal_valid_from_past`: „Änderungen gelten frühestens ab heute.“); unknown meal or other facility → 404 `meal_not_found` („Dieses Essen gibt es nicht.“).
- Versions: the meal on a date = its version with the greatest `validFrom ≤ date` (`validFrom` null = since always); a version with `removed` = no meal from then on; before the first version = no meal. A new version with the same meal and `validFrom` replaces that version.
- New facilities get Snack 9:30 (570) and Mittagessen 12:00 (720), `validFrom` null.
- Counting unchanged: `countsForMeal(time, stays, plannedPickup, manual)` from `shared/domain/childAttendance.ts`, with the meal's time valid on that day.
- Ticking a meal not valid on that day → 400 `meal_not_on_day` („Dieses Essen gibt es an dem Tag nicht.“).
- History field for a meal tick: `meal:<name valid on that day>`; values via the existing `flagText`. Old `snack`/`lunch` history rows stay readable with their existing labels.
- Consents: new keys `insectRepellent` („Darf mit Insektenschutz eingesprüht werden“, block „Gesundheit“) and `signalPhotos` („Fotos über Signal versenden“, block „Messenger (WhatsApp, Signal)“); key `photosWhatsapp` removed; migration: `whatsapp_photos = CASE WHEN whatsapp_photos IS NULL THEN photos_whatsapp WHEN photos_whatsapp IS NULL THEN whatsapp_photos WHEN whatsapp_photos = 0 OR photos_whatsapp = 0 THEN 0 ELSE 1 END`.
- Info column (tablet and print): insect repellent `false` → „kein Insektenschutz“.
- Rights: meal settings `requireAdmin(`; ticks as today (own group only, `group_read_only` otherwise).
- Tests: `npx vitest run <file>`; all: `npm test`; types: `npm run typecheck`; build: `npm run build`.

## Review Focus

1. A meal's time changed with `validFrom` today: yesterday still counts with the old time and keeps its manual ticks; today uses the new time. → Task 3 test.
2. A meal removed from today on with manual ticks yesterday: yesterday's list still shows the meal and the tick; today has no column for it and refuses a tick (`meal_not_on_day`). → Task 3 test.
3. Two changes of the same meal for the same `validFrom` (e.g. Leitung corrects a typo) → one version, not two; cancelling a planned version restores the previous one; cancelling the only version of a meal planned for the future deletes the meal. → Task 2 test.
4. A facility with no meals at all: day DTO has `meals: []`, summary rows without meal numbers, print and tab render without meal columns. → Task 3 test (DTO) and Task 5 (UI).
5. Migration on a database with days whose `snack`/`lunch` are null, true and false, and facilities with custom times: only non-null values become rows; times copied. → Task 2 db test.

---

### Task 1: Meal rules (domain)

**Files:**
- Create: `shared/domain/meals.ts`
- Test: `tests/domain/meals.test.ts`

**Interfaces:**
- Produces:
  - `interface MealVersion { id: number; mealId: number; validFrom: IsoDate | null; name: string; time: Minutes; removed: boolean }`
  - `interface DayMeal { mealId: number; name: string; time: Minutes }`
  - `mealsOn(versions: MealVersion[], date: IsoDate): DayMeal[]` — per meal the version with the greatest `validFrom ≤ date` (null lowest), skipped if none or `removed`; sorted by time, then name (`localeCompare 'de'`).
  - `currentAndPlanned(versions: MealVersion[], today: IsoDate): { current: DayMeal[]; planned: MealVersion[] }` — `current = mealsOn(versions, today)`; `planned` = versions with `validFrom > today`, sorted by date then time.
- [ ] **Step 1: Failing tests:** version since always applies on any date; a version from 2026-11-01 applies on 11-01 not 10-31; a `removed` version from 11-01 hides the meal on 11-01 and later but not 10-31; a meal whose first version starts 11-01 is absent on 10-31; sort by time then name; `currentAndPlanned` splits as described.
- [ ] **Step 2: Run** `npx vitest run tests/domain/meals.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file — Expected: PASS.
- [ ] **Step 5: Commit** `feat: meal versions by date (domain)`.

### Task 2: Data, migration and meal settings service

**Files:**
- Modify: `server/db/schema.ts`; Create: `server/db/migrations/0040_meals.sql` (+ journal/snapshot, generated, data copy added by hand)
- Create: `server/services/meals.ts`, routes `server/api/meals/index.get.ts`, `server/api/meals/index.post.ts`, `server/api/meals/[id].put.ts`, `server/api/meals/[id].delete.ts` (body or query `validFrom`), `server/api/meals/versions/[id].delete.ts`
- Modify: `server/services/facilities.ts` (default meals on create), `server/services/childAttendance.ts` (`getAttendanceSettings`/`setAttendanceSettings` without meal times), `server/schemas.ts`, `shared/types/api.ts`, `app/locales/de.ts` (error texts), permissions route test list
- Test: `tests/services/meals.test.ts`, `tests/services/db.test.ts`, `tests/services/facilities.test.ts`, `tests/api/permissions.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - Schema: `meals` (`id`, `facilityId` → facilities cascade); `mealVersions` (`meal_versions`: `id`, `mealId` → meals cascade, `validFrom` text null, `name` text, `time` int, `removed` bool default false; unique (`meal_id`, `valid_from`) — SQLite treats nulls as distinct, so enforce "one null version per meal" in the service); `childAttendanceMeals` (`child_attendance_meals`: `id`, `dayId` → child_attendance_days cascade, `mealId` → meals cascade, `value` bool not null; unique (`day_id`, `meal_id`)). The old columns `facilities.snack_time/lunch_time` and `child_attendance_days.snack/lunch` stay in this task (unused by new code; Task 3 drops them).
  - Migration data copy: per facility insert two meals and versions (`Snack` from `snack_time`, `Mittagessen` from `lunch_time`, `valid_from` NULL); insert `child_attendance_meals` from non-null `snack`/`lunch` of each day, joined to the day's child's facility's meals by name.
  - `AttendanceSettingsDto` loses `snackTime`/`lunchTime` (remove the two inputs from `app/components/settings/AttendanceSection.vue` here; Task 5 adds the meals section). Until Task 3, the day service may keep reading the old columns.
  - `MealSettingsDto { current: DayMeal[]; planned: { versionId: number; mealId: number; validFrom: IsoDate; name: string; time: Minutes; removed: boolean }[] }`
  - Service (all take `now: Date = new Date()` last): `listMeals(db, facilityId, now): MealSettingsDto`; `addMeal(db, facilityId, input: { name: string; time: Minutes; validFrom: IsoDate }, now): number`; `changeMeal(db, facilityId, mealId, input: { name: string; time: Minutes; validFrom: IsoDate }, now)`; `removeMeal(db, facilityId, mealId, validFrom: IsoDate, now)`; `cancelMealVersion(db, facilityId, versionId, now)` (only `validFrom ≥ today`, else 400 `meal_valid_from_past`; if it was the meal's only version, delete the meal); `mealVersionsOf(db, facilityId): MealVersion[]` (used by Task 3). Validation per Global Constraints; name uniqueness and the limit count meals whose latest version is not `removed`, excluding the meal being changed.
  - Routes `requireAdmin(` on the active facility.
- [ ] **Step 1: Failing tests:** add/change/remove/cancel with the Global Constraints errors (empty name, 41 chars, duplicate „snack“ vs „Snack“, 9th meal, past `validFrom`, time 1440, other facility's meal → 404); same `validFrom` twice → one version; cancel restores previous; cancelling a future-only meal deletes it; new facility has Snack 570 / Mittagessen 720; db test for 0040 on a seeded pre-migration DB (custom times copied, null/true/false ticks → rows only for non-null); permissions: meal routes admin-only.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** (compile errors in `childAttendance.ts` from the removed columns are fixed minimally here — Task 3 does the real wiring; keep `npm run typecheck` green by the end of this task).
- [ ] **Step 4: Run** focused files, `npm test`, `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: meals per facility with dated versions`.

### Task 3: Attendance day with meals and group summary

**Files:**
- Modify: `server/services/childAttendance.ts` (`getAttendanceDay`, `updateDay`), `server/schemas.ts` (day input), `shared/types/api.ts`, `server/db/schema.ts` (drop the old meal columns); Create: `server/db/migrations/0041_meals_cleanup.sql` (generated)
- Modify minimally (typecheck only; Task 5 does the real UI): `app/components/children/AttendanceTab.vue` (one tick per day meal from `meals`, counts line from `counts.meals`), `app/pages/print/children/attendance/[date].vue` (one ✓ column per meal)
- Test: `tests/services/childAttendance.test.ts`, `tests/services/db.test.ts` (old columns gone after 0041)

**Interfaces:**
- Consumes: Task 1 `mealsOn`, Task 2 `mealVersionsOf`, `childAttendanceMeals`.
- Produces:
  - `AttendanceDayDto` loses `snackTime`/`lunchTime` and `counts.snack/lunch`; gains `meals: DayMeal[]` (valid on that date), `counts.meals: Record<number, number>` (mealId → count), `summary: { groupId: number | null; name: string; here: number; meals: Record<number, number> }[]` (rows in the order of `groups`; `here` = status `present` or `gone`).
  - `AttendanceChildDto` loses `snack/lunch/snackManual/lunchManual`; gains `meals: Record<number, { counted: boolean; manual: boolean }>` (one entry per day meal) and `insectRepellent: boolean | null` (filled in Task 4; until then `null`).
  - `AttendanceDayInput` loses `snack/lunch`; gains `meals?: Record<number, boolean | null>` (null = back to automatic: delete the row). A meal not in `mealsOn(…, date)` → 400 `meal_not_on_day`. History per changed meal: field `meal:<name>`.
- [ ] **Step 1: Failing tests:** two meals counted by their times; manual tick and reset; Review Focus 1 and 2 (version change today vs yesterday, removed meal still on yesterday); `meal_not_on_day`; summary per group incl. „ohne Gruppe“ and counts equal to the sum of children; no meals → `meals: []`, summary `meals: {}`; history field `meal:Mittagessen`; foreign child tick → `group_read_only` (existing rule).
- [ ] **Step 2: Run** `npx vitest run tests/services/childAttendance.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file, `npm test`, `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: attendance counts per meal with group summary`.

### Task 4: Consents

**Files:**
- Modify: `server/db/schema.ts`; Create: `server/db/migrations/0042_consents.sql` (+ journal/snapshot; merge SQL by hand before the drop)
- Modify: `shared/types/api.ts` (`CONSENT_KEYS`), `server/services/children.ts` (`consentColumn` mapping if not generic), `server/services/childAttendance.ts` (`insectRepellent` in the child row), `app/locales/de.ts`, `app/components/children/ChildConsentsForm.vue` (blocks: Datenschutz without `photosWhatsapp`; „Messenger (WhatsApp, Signal)“ with `whatsappContact`, `whatsappPhotos`, `signalPhotos`, `whatsappParentGroup`; „Gesundheit“ with `insectRepellent`)
- Test: `tests/services/db.test.ts`, `tests/services/children.test.ts`, `tests/services/childAttendance.test.ts`

**Interfaces:**
- Produces: columns `consent_insect_repellent`, `consent_signal_photos` (bool null); `consent_photos_whatsapp` dropped after the merge (Global Constraints). `CONSENT_KEYS` without `photosWhatsapp`, with `signalPhotos` and `insectRepellent`. `AttendanceChildDto.insectRepellent` from the record.
- [ ] **Step 1: Failing tests:** db test for the merge rule (null/true, true/null, true/false → false, false/true → false, null/null → null, true/true → true); new keys stored and read; `insectRepellent` in the day DTO.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** (the „Offen“ review counts consents via `CONSENT_KEYS`; check it needs no extra change).
- [ ] **Step 4: Run** focused files, `npm test`, `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: insect repellent and Signal consents, WhatsApp photo duplicate merged`.

### Task 5: UI, print and docs

**Files:**
- Create: `app/components/settings/MealsSection.vue`
- Modify: `app/components/settings/AttendanceSection.vue` (meal times removed; `MealsSection` below), `app/components/children/AttendanceTab.vue`, `app/pages/print/children/attendance/[date].vue`, `app/utils/attendance.ts` (history label for `meal:<name>` → the name), `app/locales/de.ts`, `docs/BETRIEB.md`

**Interfaces:**
- Consumes: Task 2 routes/`MealSettingsDto`, Task 3 DTOs, Task 4 `insectRepellent`.
- [ ] **Step 1: Meals settings:** list of current meals (name, time) with „Ändern“ (name, time, „gilt ab“ date default today, min today) and „Entfernen“ (confirm „‹Name› ab ‹Datum› entfernen? Frühere Tage bleiben unverändert.“, date default today); „Essen hinzufügen“; below „Geplante Änderungen“ („ab 01.11.: Mittagessen 12:15“ / „ab 01.11.: Vesper entfällt“) each with „Zurücknehmen“. Existing toast/error pattern, `de.errors`.
- [ ] **Step 2: Attendance tab:** box „Essen heute“ („‹Name› ‹hh:mm›: ‹Zahl›“ joined by „ · “; hidden without meals) and a small table per group (Gruppe, Kinder da, one column per meal, last row „Gesamt“); per child one tick button per day meal (existing button style, „(von Hand)“, „Wieder automatisch zählen“), foreign children read-only as today; info column „kein Insektenschutz“ when `insectRepellent === false`.
- [ ] **Step 3: Print:** one ✓ column per meal; the same total and group table above the list; info column hint.
- [ ] **Step 4: Docs:** BETRIEB.md: meals with „gilt ab“ (past days unchanged), overview, new consents.
- [ ] **Step 5: Run** `npm test`, `npm run typecheck`, `npm run build`; headless check on port 3100 with a scratch DB — Expected: PASS.
- [ ] **Step 6: Commit** `feat: meal settings, meal overview and consents in the UI`.

### Task 6: Controller check (no implementer)

- [ ] On the preview copy: meals Frühstück 8:00, Snack, Mittagessen, Vesper 14:30; change Mittagessen to 12:15 from today and check yesterday unchanged; remove Vesper from tomorrow; ticks; group table sums; print; consents block and „kein Insektenschutz“ on the tablet list.
