# Mandatory Appointments and Trainings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Leitung and Träger record mandatory appointments or proofs and trainings per employee, set the intervals, and get a notice when something is due soon, overdue or missing. Employees see their own records.

**Architecture:**
- Three new tables: `requirement_types` (per facility, four built-in kinds seeded), `employee_requirements`, `employee_trainings`.
- A pure status function in `shared/domain/requirements.ts`.
- One service, `server/services/requirements.ts`, with facility-scoped functions.
- Thin routes, plus UI sections that follow the existing patterns (level-up notice, employee page sections, settings sections).

**Tech Stack:** Nuxt 4 (Nitro), Drizzle ORM + better-sqlite3, zod, Vitest, Nuxt UI 4.

**Spec:** docs/superpowers/specs/2026-10-12-requirements-design.md

## Global Constraints

- UI German, code English. Texts live in `app/locales/de.ts`. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Services take `db` first, then `facilityId`. Rows of another facility answer the `*_not_found` code (404) and are never confirmed.
- Built-in keys and defaults:
  - `company_doctor`: "Betriebsarzt", 24 months
  - `first_aid`: "Erste-Hilfe-Kurs", 24 months
  - `criminal_record`: "Erweitertes Führungszeugnis", 60 months
  - `measles`: "Masernimpfung (Nachweis)", null (once)
- Early warning window: 2 months. It is shown to managers only.
- Error codes:
  - `requirement_type_not_found` (404)
  - `requirement_name_required` (400)
  - `requirement_name_taken` (409)
  - `requirement_builtin` (409)
  - `requirement_not_found` (404)
  - `training_not_found` (404)
  - existing `title_required` (400), `invalid_date` (400), `employee_not_found` (404)
- Migration `0023_requirements`: generated with `npx drizzle-kit generate --name requirements`, with hand-added inserts of the built-in kinds for every existing facility. Only `CREATE TABLE`s; no rebuild of existing tables. It runs on real data.
- New routes are classified in `tests/api/permissions.test.ts` (managers: `requireAdmin`; own view: `requireUser`).
- Existing behaviour and tests stay unchanged.

## Review Focus

1. **Boundaries of the status.** Due today counts as overdue. Due exactly two months from today counts as soon; one day later is ok. A record dated 31 August with a 6-month interval is due on the last day of February. Test: Task 1 domain tests.
2. **Cross-facility ids.** A Leitung of facility A sends an employee id, kind id, record id or training id of facility B: 404, nothing changes. Test: Task 1.
3. **Who appears in the due list.** An employee who left, or has not started yet, must not appear. A new employee with no records appears as missing for every kind. Test: Task 1.
4. **Own view.** A Mitarbeiter calling the own-view route gets only their own records, and no manager route is open to them. Test: Task 1 and the permissions test.
5. **Deleting a kind.** Deleting an own kind removes its records and nothing else. Deleting a built-in kind is refused. Test: Task 1.

---

### Task 1: Data model, status rules, service and routes

**Files:**
- Create:
  - `shared/domain/requirements.ts`
  - `server/services/requirements.ts`
  - `server/db/migrations/0023_requirements.sql`
  - routes under `server/api/`:
    - `requirement-types.get.ts`, `requirement-types.post.ts`, `requirement-types/[id].put.ts`, `requirement-types/[id].delete.ts`
    - `requirements/due.get.ts`
    - `employees/[id]/requirements.get.ts`, `employees/[id]/requirements.post.ts`
    - `employee-requirements/[id].delete.ts`
    - `employees/[id]/trainings.post.ts`
    - `employee-trainings/[id].put.ts`, `employee-trainings/[id].delete.ts`
    - `my/requirements.get.ts`
- Modify:
  - `server/db/schema.ts`
  - `server/schemas.ts`
  - `shared/types/api.ts`
  - `server/services/facilities.ts`: `createFacility` seeds the built-in kinds.
  - `server/services/employees.ts`: `moveEmployeeToFacility` re-points records per the spec.
  - `server/db/seed.ts` or the test DB helper, if the first facility needs the built-in kinds outside the migration.
  - `tests/helpers/fixtures.ts`: `requirementTypeId(db, key, facilityId = 1)`.
- Test: `tests/domain/requirements.test.ts`, `tests/services/requirements.test.ts`, `tests/services/db.test.ts` (migration), `tests/api/permissions.test.ts`

**Interfaces:**
- Produces:
  - `addMonths(date: IsoDate, months: number): IsoDate` (clamping). Reuse an existing helper in `shared/domain/dates.ts` if there is one.
  - `requirementState(lastDate: IsoDate | null, intervalMonths: number | null, today: IsoDate): { state: 'missing' | 'overdue' | 'soon' | 'ok'; dueOn: IsoDate | null }`
  - `RequirementTypeDto { id; name; intervalMonths: number | null; builtinKey: string | null; sortOrder }`
  - `EmployeeRequirementsDto { kinds: { type: RequirementTypeDto; state; lastDate; dueOn; records: { id; date; note }[] }[]; trainings: { id; date; title; note }[] }`
  - `DueRequirementDto { employeeId; employeeName; typeId; typeName; state: 'missing' | 'overdue' | 'soon'; dueOn }`
  - Service functions:
    - `listRequirementTypes`, `createRequirementType`, `updateRequirementType`, `deleteRequirementType`
    - `getEmployeeRequirements(db, facilityId, employeeId, today)`
    - `addRequirementRecord`, `deleteRequirementRecord`
    - `addTraining`, `updateTraining`, `deleteTraining`
    - `listDueRequirements(db, facilityId, today)`
    - `getMyRequirements(db, viewer, today)`

- [ ] **Step 1:** Write the domain tests (Review Focus 1), then implement `shared/domain/requirements.ts`.
- [ ] **Step 2:** Write the service tests (Review Focus 2–5, built-in seeding, move, own view) and the migration test.
- [ ] **Step 3:** Implement the schema, migration, service, routes and the permissions classification.
- [ ] **Step 4:** Run `npx vitest run` and `npm run typecheck`, then commit `feat: mandatory appointments and trainings of employees`.

### Task 2: User interface

**Files:**
- Create:
  - `app/components/RequirementNotice.vue`: the yellow notice, grouped by state, with links to `/admin/employees/:id`.
  - `app/components/employees/RequirementsSection.vue`
  - `app/components/settings/RequirementTypesSection.vue`
  - `app/pages/my/requirements.vue`
- Modify:
  - `app/pages/admin/employees/[id].vue`: mount the section.
  - `app/pages/admin/employees/index.vue` and `app/pages/plan/[year]/[month].vue`: mount the notice next to `LevelUpNotice`, managers only.
  - `app/pages/admin/settings.vue`: mount the section.
  - `app/layouts/default.vue`: nav item "Meine Termine" for accounts with an employee.
  - `app/components/users/RightsTable.vue`
  - `app/locales/de.ts`: all texts, the state labels and the six new error codes.
- No new automated tests (typecheck). Check by hand on a database copy on port 3100, with temporary accounts:
  - settings: add an own kind, change an interval;
  - employee page: enter records, see the states change, add, edit and delete trainings;
  - the notice on the plan and the overview;
  - "Meine Termine" as a Mitarbeiter, with no warning colours.

  Clean up afterwards.
- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Run the typecheck, the test suite and the manual check.
- [ ] **Step 3:** Commit `feat: mandatory appointments in settings, employee pages and notices`.
