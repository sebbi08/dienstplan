# Personalakte – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The employee page becomes a personnel file: more master data, a Träger-only „Lohn und Steuer“ tab, a „Dokumente“ tab with folders, and „befristet bis“ — each part guarded by its own permission and covered by the retention overview.

**Architecture:** New employee columns plus two tables (`employee_payroll`, `employee_documents`); new keys in the permission catalog; services/routes with `requirePermission`; validators in `shared/domain/personnel.ts`; the retention categories of `server/services/employeeDeletion.ts` extended so the Löschfristen overview covers the new data; UI in `app/pages/admin/employees/[id].vue` (tabs) with section components.

**Tech Stack:** Nuxt 4, Nitro, drizzle-orm + better-sqlite3, Nuxt UI 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-28-personalakte-design.md`

## Global Constraints

- Runs after Rechte Teil 1 is complete (permission catalog, `requirePermission`, route-access fixture + `scripts/route-access-snapshot.mjs`, `tests/api/permissions.test.ts`). New routes: regenerate the fixture the way the script documents; the diff contains only the new routes; update the route count in `tests/domain/permissions.test.ts`.
- One migration `personnel_file` (journal `when` larger than the previous; local drizzle-kit only):
  - `employees`: `birth_year` int null (with existing `birthday` 'MM-DD' it forms the full date), `street`, `postal_code`, `city`, `phone`, `email`, `nationality` text null, `disability` bool default false, `disability_degree` int null (20–100 in steps of 10), `disability_equal` bool default false („gleichgestellt“), `disability_until` text null (ISO), `fixed_term_until` text null (ISO).
  - `employee_payroll` (`employee_id` PK FK cascade): `tax_id`, `tax_class` (1–6), `sv_number`, `health_insurer`, `iban`, `account_holder`, `denomination` — all null-able text/int.
  - `employee_documents`: like `child_documents` (blob `data`, `mime_type`, `size`, `title`, `document_date`, `note`, `uploaded_by` FK set null, `uploaded_at`), `employee_id` FK cascade, `folder` enum `contract | application | qualifications | correspondence | measures | salary`; index on employee.
- Permission keys (area Mitarbeiter, none providerOnly): `employees.personal` (Leitung default yes; requires employees.view), `employees.sensitive`, `employees.payroll`, `employees.docs.qualifications` (Leitung default yes), `employees.docs.contract`, `employees.docs.application`, `employees.docs.correspondence`, `employees.docs.measures`, `employees.docs.salary` (all require employees.view). „befristet bis“ follows today's contract-field visibility (`employees.contractView` / `employees.contractEdit`).
- Validation (`shared/domain/personnel.ts`): IBAN (country + mod-97 check), Steuer-ID 11 digits with the official check digit, SV-Nummer 12 characters (2 digits, 6 digits, 1 letter, 3 digits), tax class 1–6, e-mail basic shape, PLZ 5 digits; empty = allowed; errors 400 with German texts.
- Documents: PDF/JPEG/PNG, size limit and upload handling as the child documents (reuse their helpers), download with correct content type, deletion + WAL checkpoint.
- Visibility: Träger everything; Leitung `employees.personal` + `employees.docs.qualifications` (+ contract fields as today); Mitarbeiter/Tablet nothing — never in my/* or tablet payloads. Fields a viewer may not see are absent from DTOs (not just hidden in the UI).
- Retention (`employeeDeletion.ts` row lists, `categoryHasData` stays in sync): immediate = all new employee columns cleared (birth_year, address, phone, email, nationality, disability*, fixed_term_until) and the `employee_payroll` row; assessment (3 years) = documents in application, qualifications, correspondence, measures; paidOvertime (10 years) = documents in contract and salary. The overview label of the paidOvertime category becomes „ausgezahlte Überstunden, Verträge, Gehalt“.
- UI German, informal „du“; no new npm dependencies; never `npm install`/npx downloads; never read outside `C:\Users\schad\Code`.
- Tests: `npx vitest run <file>`; all `npm test`; `npm run typecheck`; `npm run build`; `node scripts/route-access-snapshot.mjs --check`.

## Review Focus

1. A Leitung requesting the payroll data, a non-qualifications document or the sensitive fields gets 403 / the fields are absent from the employee DTO; a Mitarbeiter gets nothing of it anywhere (Task 2 tests).
2. Invalid IBAN / Steuer-ID / SV-Nummer → 400 with the German text; empty values accepted (Task 1 domain tests, Task 2 service tests).
3. Retention: each new column/row/folder sits in the right category, `categoryHasData` true while data exists and false after deletion, FK check clean (Task 1 tests).
4. Documents of another facility's employee not reachable (404), download content type and size right (Task 2 tests).
5. Payroll values shown masked until „anzeigen“; no value in page source for viewers without `employees.payroll` (Task 3 + controller check).

---

### Task 1: Schema, catalog keys, validators, retention categories

**Files:** schema + migration `personnel_file` + db test; `shared/domain/permissions.ts` (keys, Leitung defaults) + its tests; Create `shared/domain/personnel.ts` + `tests/domain/personnel.test.ts`; `server/services/employeeDeletion.ts` (row lists) + `tests/helpers/employeeData.ts` + category tests; retention overview label.

- [ ] Failing tests (RF2 validators, RF3 categories, catalog defaults) → implement → commit `feat: personnel file data model, permissions and retention`.

### Task 2: Services and routes

**Files:** `server/services/employees.ts` (personal/sensitive/birth year/fixed-term fields in DTO and update, filtered by permission), Create `server/services/employeePayroll.ts`, `server/services/employeeDocuments.ts`; routes `employees/[id]/payroll.get|put`, `employees/[id]/documents.get|post`, `employee-documents/[id].get|delete` (download/delete), schemas, `shared/types/api.ts`; fixture + permission tests; service tests.

- [ ] Failing tests RF1, RF2 (service level), RF4 → implement → commit `feat: personnel file services and routes`.

### Task 3: UI, texts, docs

**Files:** `app/pages/admin/employees/[id].vue` (tabs „Lohn und Steuer“ and „Dokumente“ only when permitted — use the client `can()` from Rechte Teil 1), section components under `app/components/employees/` (personal data in Stammdaten, payroll with masked values and „anzeigen“, documents per folder with upload/view/download/delete, „befristet bis“ in ContractSection), `app/locales/de.ts`, `docs/BETRIEB.md` (Personalakte), `app/components/users/RightsTable.vue` rows.

- [ ] `npm test`, typecheck, build → commit `feat: personnel file pages`.

### Task 4: Controller check (no implementer)

- [ ] Scratch copy: as Träger fill everything, upload a document per folder; as Leitung see only the allowed parts (and nothing in the page data); masked values; Löschfristen overview shows the new data in the right rows for a left employee; phone width.
