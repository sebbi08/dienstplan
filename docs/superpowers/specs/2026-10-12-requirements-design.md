# Mandatory appointments and trainings of employees (Pflichttermine, Fortbildungen) — design

Agreed in chat on 2026-10-12.

## Goal

Leitung and Träger record per employee:
- mandatory appointments or proofs (Pflichttermine): Betriebsarzt, Erste-Hilfe-Kurs, erweitertes Führungszeugnis, Masernimpfung, plus own kinds;
- trainings (Fortbildungen), as a list.

Each kind is either recurring every N months or needed once. Leitung and Träger get a notice when one is due within two months, overdue or missing. Employees can see their own records, but get no warning.

## Data model

`requirement_types`, per facility:

| Column | Meaning |
|---|---|
| `id` | |
| `facility_id` | references facilities |
| `name` | not empty, unique per facility (compared with `toLocaleLowerCase('de')`) |
| `interval_months` | integer ≥ 1, or null = needed once |
| `builtin_key` | null for own kinds; `company_doctor`, `first_aid`, `criminal_record`, `measles` for the four built-in ones |
| `sort_order` | |

Built-in kinds exist in every facility. The migration inserts them for every existing facility, and `createFacility` inserts them for new ones.

| Key | German name | Default |
|---|---|---|
| `company_doctor` | Betriebsarzt | 24 months |
| `first_aid` | Erste-Hilfe-Kurs | 24 months |
| `criminal_record` | Erweitertes Führungszeugnis | 60 months |
| `measles` | Masernimpfung (Nachweis) | once |

- A built-in kind can be renamed and its interval changed (including to "once"), but not deleted.
- Own kinds can be deleted. Their records go with them, and the UI asks first.

`employee_requirements`: `id`, `employee_id` (cascade), `type_id` (cascade), `date` (ISO; the day of the appointment or the day the proof was shown), `note` (optional, max 200). Several rows per employee and kind form the history; the newest date counts.

`employee_trainings`: `id`, `employee_id` (cascade), `date`, `title` (not empty, max 200), `note` (optional, max 500).

Migration `0023_requirements`: three `CREATE TABLE`s plus the inserts of the built-in kinds for each existing facility. No table is rebuilt.

For measles only the date the proof was shown is stored (plus the optional note); no further health data.

## Status of a kind for an employee

With `last` = the newest record date and `today` = the Berlin date:

| State | Condition |
|---|---|
| `missing` | no record |
| `ok` | needed once and a record exists |
| `overdue` | recurring and `last + interval_months` ≤ today |
| `soon` | recurring and due within the next 2 months (`today` < due ≤ `today + 2 months`) |
| `ok` | otherwise |

`dueOn` = `last + interval_months` (null for once / missing). Month arithmetic clamps to the end of the month (31 Jan + 1 month = 28/29 Feb).

## Notice for Leitung and Träger

- `GET /api/requirements/due` (`requireAdmin`): for the active facility, one row per employee and kind in state `missing`, `overdue` or `soon`, ordered overdue, then missing, then soon, then by name. Row: `{ employeeId, employeeName, typeId, typeName, state, dueOn }`.
- Only employees who are employed today count: not before their first day, and not after `leftOn`.
- UI: a yellow notice like the existing level-up notice, on the plan page and the employee overview, for managers only. It groups by state ("Überfällig", "Noch kein Eintrag", "Bald fällig"), and each row links to the employee page.
- It disappears when a new record is entered.

## Employee page (Leitung and Träger)

New section "Pflichttermine und Fortbildungen":
- one row per kind: name, interval ("alle 24 Monate" / "einmalig"), last date, due date, and a state badge;
- "Eintragen" (date, default today, optional note);
- the history of a kind can be expanded, and a single record deleted;
- a list of trainings: add, edit, delete (date, title, note), newest first.

Routes (`requireAdmin`, the employee must belong to the active facility):
- `GET /api/employees/:id/requirements` → `{ kinds: [{ type, state, lastDate, dueOn, records }], trainings }`
- `POST /api/employees/:id/requirements` `{ typeId, date, note? }`
- `DELETE /api/employee-requirements/:id`
- `POST /api/employees/:id/trainings`
- `PUT /api/employee-trainings/:id`
- `DELETE /api/employee-trainings/:id`

## Settings (Leitung and Träger)

New section "Pflichttermine" in Einstellungen, per facility: the kinds with name and interval ("alle … Monate" or "einmalig"); add, rename, change the interval, delete own kinds.

Routes (`requireAdmin`):
- `GET /api/requirement-types`
- `POST /api/requirement-types`
- `PUT /api/requirement-types/:id`
- `DELETE /api/requirement-types/:id`

## Employee's own view

- A new menu item "Meine Termine" for accounts linked to an employee (Mitarbeiter, and managers with an employee).
- `GET /api/my/requirements` (`requireUser`): the viewer's own kinds with last date and next due date, and their trainings.
- Read-only. No warning colours or notices: the early warning is for Leitung and Träger only. The due date is shown as plain text.

## Other rules

- **Isolation:** a Leitung only reaches employees and kinds of its own facility; other ids answer `*_not_found` (404).
- **Help-outs:** the helping facility sees nothing of a helper's records.
- **Moving an employee to another facility:**
  - records of built-in kinds are re-pointed to the new facility's kind with the same key;
  - records of own kinds go to a kind of the same name in the new facility, which is created (same interval) if missing;
  - trainings stay with the employee.
- **Error codes:**
  - `requirement_type_not_found` (404)
  - `requirement_name_required` (400)
  - `requirement_name_taken` (409)
  - `requirement_builtin` (409, deleting a built-in kind)
  - `requirement_not_found` (404)
  - `training_not_found` (404)
  - `title_required` (400, existing code)
  - `invalid_date` (400, existing)
- The rights table gets rows for the new rights.

## Out of scope

- E-mail or push messages.
- Uploading certificates.
- Linking trainings to the "Fortbildung" entry in the plan.

## Tests

- Status rules, including month clamping and the boundaries (due today = overdue; exactly 2 months ahead = soon).
- Kinds: built-in ones seeded per facility and for new facilities; rename, interval, delete own / refuse built-in; name uniqueness.
- Records and trainings: add, list, delete; the newest counts.
- Due list: order, employed-today filter, facility filter.
- Isolation: another facility's employee, kind, record or training answers 404.
- Move re-points the records.
- Own view: only the viewer's data.
- The migration keeps rows and seeds the built-in kinds for every existing facility.
- The permissions test classifies the new routes.
