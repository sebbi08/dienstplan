# Löschübersicht – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nothing is deleted automatically any more; the Träger sees every item whose retention period runs out (left employees per category, archived child records, archived cash boxes) across all facilities on one page and deletes them by hand.

**Architecture:** The daily run stops calling the child purge and the employee retention. A new service `server/services/retentionOverview.ts` computes the items from the existing due-date functions and deletes one item with the existing deletion helpers (employee categories from `employeeDeletion.ts`, `deleteChild`, `purgeBox`). Provider-only routes; a page under Mehr; a reminder for the Träger.

**Tech Stack:** Nuxt 4, Nitro, drizzle-orm + better-sqlite3, Nuxt UI 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-loeschuebersicht-design.md` (builds on `2026-10-27-loeschfristen-design.md`)

## Global Constraints

- UI German, informal „du“; code English. No new npm dependencies. Never `npm install`/`npm ci`/npx downloads. Never kill processes by image name. Port 3000 and `.data/app.db` untouched. Never read outside `C:\Users\schad\Code`.
- No migration: no new table or column. App settings `children_purged_on` / `employee_retention_ran_on` may stay in the DB unused.
- Due dates unchanged: employees `retentionDueDates(leftOn, settings)` per facility (`shared/domain/retention.ts`), children `purgeDate(leftOn, getChildRetentionYears(db))` (`shared/domain/children.ts`), cash `deletableFrom` as computed in `server/services/cashBoxes.ts`. An item is due when `deletableFrom <= today`.
- Only the Träger (`requireProvider`) reads the overview and deletes after a period; Leitung 403. Unchanged: manual „Endgültig löschen“ of an employee (setting `employeeDelete`), deleting a cash box without entries and history (Leitung/Träger), deleting a child record by the existing route.
- Every deletion: one transaction per item, FK check (as `employeeDeletion.ts` does), WAL checkpoint after the request when anything was deleted. Due-ness is checked again on the server: 409 `retention_not_due`.
- Item key format (string, used by the client and the bulk route): `employee:<id>:<category>` with category `immediate | time | assessment | paidOvertime | record`, `child:<id>`, `cash:<id>`.
- Wording: „darf gelöscht werden ab ‹Datum›“ / „löschbar ab ‹Datum›“ instead of „wird gelöscht am“ everywhere (employees archive, children archive, settings texts, docs, RightsTable).
- Tests: `npx vitest run <file>`; all `npm test`; `npm run typecheck`; `npm run build`.

## Review Focus

1. Daily run on a DB with an employee left in 2020 and a child left 2010 → nothing deleted (Task 1 test).
2. Employee left 15.03.2026, defaults: items immediate (from 16.03.2026), time (01.01.2029), assessment (01.01.2030), paidOvertime only if a paid-out adjustment exists, record due only once every other category of the person holds no data; deleting `time` before 01.01.2029 → 409 (Task 2 test).
3. Bulk delete with a key that is not due or no longer exists → that key skipped and reported, the others deleted (Task 2 test).
4. Items of all facilities in one list with facility id and name; Leitung → 403 on every route (Task 2 test).
5. The reminder appears only for the Träger and only while a due item exists (Task 3 test).

---

### Task 1: Stop the automatic deletion

**Files:** `server/services/dailyRun.ts` (no `purgeExpiredChildren`, no `employeeRetentionOncePerDay`; `DailyRunResult` loses `deleted`/`employeeDataDeleted` or keeps them always 0 — remove them and adapt `server/plugins/database.ts`), `server/services/employeeRetention.ts` (delete `runEmployeeRetention`; keep `hasPaidOut`, move it if the file becomes empty), `server/services/children.ts` (`purgeExpiredChildren` removed; the "would be deleted at the next run" count, if only used for the retention-change warning, removed), `server/services/schoolChildren.ts` (drop the `deletedAtOnce` skip), `server/services/appSettings.ts` (`setChildRetentionYears` no longer switches auto-leave off; return type adapted, callers and UI message adapted), tests (`tests/services/dailyRun.test.ts`, `employeeRetention.test.ts` → keep only what still applies, children/schoolChildren/appSettings tests).

**Interfaces:** Produces: daily run without deletions; `hasPaidOut(db, employeeId): boolean` stays exported.

- [ ] Failing test: Review Focus 1 (`runDaily` on a DB with employee left 2020-06-30 and a child left 2010-07-31 → all rows still there; school child whose record would have been "deleted at once" is now deregistered normally) → implement → run touched tests, `npm test`, typecheck → commit `feat: no automatic deletion of children and left employees any more`.

### Task 2: Overview service and routes

**Files:** Create `server/services/retentionOverview.ts`, `server/api/retention/index.get.ts`, `server/api/retention/items.delete.ts` (body `{ key }`), `server/api/retention/due.post.ts` (body `{ keys: string[] }`, max 1000); `shared/types/api.ts` (`RetentionItemDto`, `RetentionDeleteResult`); `server/services/employeeDeletion.ts` (export `categoryHasData(db, employeeId): Record<RetentionCategory, boolean>`); `server/api/cash/boxes/[id]/purge.delete.ts` → `requireProvider` (or remove it and its client use in Task 3); permissions list `tests/api/permissions.test.ts`; tests `tests/services/retentionOverview.test.ts`.

**Interfaces:**
- `RetentionItemDto { key: string; kind: 'employee' | 'child' | 'cash'; category: 'immediate' | 'time' | 'assessment' | 'paidOvertime' | 'record' | null; facilityId: number; facilityName: string; name: string; deletableFrom: IsoDate | null; due: boolean }` — `deletableFrom` null only for an employee `record` (due when the person's other categories hold no data) and for a cash box without entries/history (due).
- `retentionOverview(db: Db, today: IsoDate): RetentionItemDto[]` — due items first (by facility name, then name), then not-due by `deletableFrom` ascending, `record` items without date last. Employees: only with `leftOn < today`; one item per category that holds data (`categoryHasData`), `paidOvertime` only with paid-out adjustments, `record` always for a left employee. Children: `leftOn` set (archived). Cash: archived boxes only.
- `deleteRetentionItem(db: Db, key: string, today: IsoDate): number` (rows deleted; 404 `retention_item_not_found`, 409 `retention_not_due`, 400 `retention_key_invalid`); `deleteDueItems(db, keys, today): { deleted: number; skipped: string[] }`.

- [ ] Failing tests: Review Focus 2, 3, 4; cash box purged through the overview keeps the counterpart transfer (reuse `purgeBox` behaviour); child record deleted through the overview; FK check clean → implement → run touched tests, `npm test`, typecheck → commit `feat: retention overview and manual deletion for the Träger`.

### Task 3: Page, reminder, texts

**Files:** Create `app/pages/admin/retention.vue`; `app/utils/navMenu.ts` (Mehr entry „Löschfristen“ for `provider` only), reminder for the Träger (`server/services/reminders.ts` + `ReminderKind` + the reminders box component: text „‹n› Einträge dürfen gelöscht werden“, link `/admin/retention`), cash page (`app/pages/cash/index.vue` and its row component: no „Endgültig löschen“ for archived boxes, „löschbar ab“ stays), texts in `app/locales/de.ts` (employees archive sentence, children archive/purgeOn, settings „Löschfristen“ intro/help, child retention setting help), `docs/BETRIEB.md` (Löschfristen, Kinder „Automatische Löschung“, Kasse), `app/components/users/RightsTable.vue` (new row „Löschfristen: Übersicht und Löschen nach Ablauf“ Träger only; cash purge row Träger only), tests for the reminder (Review Focus 5) and nav.

**Interfaces:** Consumes Task 2 routes and `RetentionItemDto`.

Page layout (spec §2): heading „Löschfristen“, short intro, filter „Einrichtung“ (alle / each facility from the items), section „Jetzt löschbar (‹n›)“ with rows (Einrichtung, Was = name + category label, löschbar ab, button „Löschen“) and button „Alle fälligen löschen“ (confirm lists counts per kind, sends exactly the shown due keys); section „Später löschbar“ (no buttons). Category labels: Persönliche Daten, Zeitdaten, Beurteilungen, ausgezahlte Überstunden, Mitarbeiter-Eintrag („sobald alles andere gelöscht ist“), Kinderakte, Kasse. Confirm text „… wird endgültig gelöscht. Lade vorher eine Datensicherung herunter.“; a cash item asks for the box name (as on the cash page today). Phone width usable.

- [ ] Failing tests: Review Focus 5 → implement → `npm test`, typecheck, build → commit `feat: Löschfristen page, reminder and wording`.

### Task 4: Controller check (no implementer)

- [ ] Scratch copy: daily run deletes nothing; page shows employee, child and cash items of two facilities; delete one item, bulk delete; Leitung sees no menu entry and gets 403; reminder; phone width.
