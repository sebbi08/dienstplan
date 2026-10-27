# Löschfristen – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Personal data of employees who left is deleted automatically after the legal periods (immediately / 2 / 3 / 10 years after the end of the year of leaving), the immediate „Endgültig löschen“ is governed by a Träger setting, and cash boxes are archived and deletable only after their retention period.

**Architecture:** Pure due-date functions in `shared/domain/retention.ts`; per-facility settings in a new table; a nightly step `employeeRetention` in `server/services/dailyRun.ts` reusing the per-table deletion helpers of `server/services/employeeDeletion.ts`; cash archive/delete rules in the cash services; UI in settings (new section), the employees archive and the cash overview.

**Tech Stack:** Nuxt 4, Nitro, drizzle-orm + better-sqlite3, Nuxt UI 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-loeschfristen-design.md`

## Global Constraints

- UI German, informal „du“; code English. No new npm dependencies. Never `npm install`/npx downloads (drizzle-kit is local). Never kill processes by image name; only own PIDs. Port 3000 and `.data/app.db` untouched; own checks on 127.0.0.1:3100 with scratch copies. Never read the user's Nextcloud folder.
- Branch `claude/reset` (HEAD includes `931b538` employee deletion and `c1b170c`); newest migration is the last in `server/db/migrations` — add exactly one new migration `retention` (journal `when` larger than the previous).
- Settings table `retention_settings` per facility (row created lazily with defaults): `time_years` 2, `assessment_years` 3, `paid_overtime_years` 10, `pension_years` 30 (info only), `cash_years` 10, `employee_delete` `'off' | 'provider' | 'managers'` default `'managers'`. Years 1–40 (cash 1–30). Routes `GET /api/retention-settings` (requireAdmin), `PUT` (requireProvider); the settings facility override („Einstellungen für“) applies as for other settings.
- New column `balance_adjustments.paid_out` boolean default false; the balance-adjustment UI gets a checkbox „ausgezahlt“.
- Due dates: `end = 31.12. of the year of left_on`; a category is due on `end + N years + 1 day` (i.e. 1.1. of year(left_on)+N+1). „Immediately“ = the day after `left_on`. The nightly run deletes everything due on or before today.
- Categories (spec §2): immediate (birthday, PIN/lock, linked account — Leitung/Mitarbeiter deleted, Träger unlinked —, qualification/share, contract fields, employee_hours history, requirement assignments, leave requests, help-outs, notifications, form_editors, terminal unlocks, key-educator references → null); time (plan entries incl. release-snapshot cleanup, change logs, time records/changes/day notes, early sick leaves, balance adjustments without paid_out, leave entitlements, warning acks); assessment (staff talks + forms, employee trainings); paid overtime (balance adjustments with paid_out); finally the employee row when nothing with a running period is left. Reuse/extract the per-category deletion code from `server/services/employeeDeletion.ts` (one helper per category) so manual delete = all categories at once.
- „Endgültig löschen“ (manual, immediate): allowed by setting `employee_delete` (off → button hidden, route 403 `employee_delete_disabled`; provider → only Träger; managers → Leitung and Träger) plus the existing guards; the dialog warns „Dabei werden die gesetzlichen Aufbewahrungsfristen nicht beachtet – nur für Probe- und Fehleinträge.“
- Undo of leaving (left_on removed or moved into the future) stops further deletions; nothing is restored.
- Cash: „Stilllegen“ → „Archivieren“ (labels only, same field); archived boxes listed in a collapsed „Archiv“ section; `deletableFrom = 1.1. of (year of last entry date + cash_years + 1)`; a box without entries is deletable any time (existing rule); `DELETE /api/cash/boxes/[id]/purge` (requireAdmin) with `confirm` = box name, 409 `cash_box_retention` before the date, 409 `cash_box_not_archived` if active; deletes box, entries, receipts, closed months, log; counterpart transfer rows in other boxes stay with `transfer_id` cleared (their text stays). WAL checkpoint after blob deletes.
- Server log per nightly run: counts per category, no names.
- Tests: `npx vitest run <file>`; all `npm test`; types `npm run typecheck`; build `npm run build`.

## Review Focus

1. Left on 15.03.2026 with defaults: immediate data gone on 16.03.2026; time data still there on 31.12.2028 and gone on 01.01.2029; talks gone on 01.01.2030; a paid-out adjustment gone on 01.01.2037; the employee row gone on 01.01.2037 (last category). → Task 1 + Task 2 tests.
2. Changing a period in the settings applies to the next nightly run (no retroactive restore). → Task 2 test.
3. Leaving undone before a due date → nothing more deleted. → Task 2 test.
4. `employee_delete = off` → no button, route 403; `provider` → Leitung 403. → Task 3 test.
5. Cash box with last entry 2026-03-10 and cash_years 10 → purge 409 until 31.12.2036, ok on 01.01.2037; counterpart transfer in another box keeps its row and text. → Task 4 test.

---

### Task 1: Domain (due dates)

**Files:** Create `shared/domain/retention.ts`; Test `tests/domain/retention.test.ts`

**Interfaces:** `RetentionSettings`, `RETENTION_DEFAULTS`, `retentionDueDates(leftOn: IsoDate, s: RetentionSettings): { immediate: IsoDate; time: IsoDate; assessment: IsoDate; paidOvertime: IsoDate }`, `cashDeletableFrom(lastEntryDate: IsoDate | null, cashYears: number): IsoDate | null` (null = no entries → any time), `checkRetentionSettings(input): RetentionSettings` (ranges, enum).

- [ ] Failing tests incl. Review Focus 1 dates → implement → commit `feat: retention due dates`.

### Task 2: Settings, migration, nightly deletion

**Files:** schema + migration `retention`; `server/services/retentionSettings.ts` + routes; refactor `server/services/employeeDeletion.ts` into per-category helpers; Create `server/services/employeeRetention.ts` (`runEmployeeRetention(db, today): counts`); hook into `server/services/dailyRun.ts`; `balance_adjustments.paid_out` in schema, service and route of balance adjustments; permissions list; tests `tests/services/employeeRetention.test.ts`, `tests/services/retentionSettings.test.ts`, db test for the migration.

- [ ] Failing tests: Review Focus 1, 2, 3; categories leave other employees untouched; FK check empty; idempotent second run; paid_out keeps an adjustment past the time category → implement → commit `feat: nightly deletion of left employees' data after the retention periods`.

### Task 3: Manual delete setting, UI for settings and archive

**Files:** `server/services/employeeDeletion.ts` + route (setting check), settings section „Löschfristen“ in Einstellungen → Personal (`app/utils/settingsAreas.ts` + component, Träger edits, Leitung reads), employees archive shows the due dates per person and the button per setting with the warning, balance adjustment dialog checkbox „ausgezahlt“, `app/locales/de.ts`, `docs/BETRIEB.md` (Löschfristen), update the role overview `app/components/users/RightsTable.vue` (rows for Löschfristen and Endgültig löschen).

- [ ] Failing tests: Review Focus 4 → implement → `npm test`, typecheck, build, headless check → commit `feat: retention settings and deletion dates in the employees archive`.

### Task 4: Cash archive and purge after retention

**Files:** cash services/routes (`purge` route), `shared/types/api.ts` (`deletableFrom` on boxes), cash overview UI (Archiv section, „löschbar ab“, „Endgültig löschen“ with name), labels „Archivieren“, docs (Kasse), tests.

- [ ] Failing tests: Review Focus 5; not archived 409; name mismatch 400; Mitarbeiter 403 → implement → `npm test`, typecheck, build, headless check → commit `feat: cash boxes archived, deletable after the retention period`.

### Task 5: Controller check (no implementer)

- [ ] Scratch copy: an employee left in 2020 → after a manual nightly run the right data is gone; settings changes; archive dates; cash archive and purge with a faked old box.
