# Facilities (Einrichtungen), step 1 — design

Approved in chat on 2026-10-07 ("ja, passt so, setze es gründlich um").

This is step 1 of 3: facilities. Step 2 is helping out in another facility (Aushelfen). Step 3 is groups inside a facility. Steps 2 and 3 are out of scope here, but this design must not block them.

## Goal

One installation serves several facilities.
- Each Leitung works in exactly one facility and sees only that facility.
- The Träger can do everything the Leitung can, in every facility. In the header the Träger picks the facility to work in ("active facility"), and the Träger keeps the provider-only rights.
- Everything the Träger enters in a facility is the same data the Leitung of that facility sees.
- The existing data becomes the first facility, named **"Kindergarten"**. With a single facility the app behaves exactly as before, apart from the switcher shown to the Träger.

## Data model

New table `facilities`:
- `id`
- `name` (unique, not empty)
- `sort_order`
- `time_tracking_from` (ISO date or null; moved from `app_settings`)
- `leave_max_concurrent` (int or null; moved from `app_settings`)

Facility-owned rows get `facility_id NOT NULL REFERENCES facilities(id)`:

| Table | Facility rule |
|---|---|
| employees | the **home** facility; every employee belongs to exactly one |
| users | Leitung and tablet accounts: their facility. Träger: the active facility selection (nullable, falls back to the first facility). Mitarbeiter accounts: null, since the facility comes from the linked employee |
| shift_templates, coverage_rules | per facility |
| closures, early_closures, calendar_events | per facility |
| day_notes | primary key becomes (facility_id, date) |
| month_plans | primary key becomes (facility_id, year, month) |
| release_snapshots, change_log | facility_id column plus index |
| week_templates | name unique per facility |
| week_template_marks | primary key becomes (facility_id, week_start) |
| early_closures | date unique per facility |

Rows that need no facility column, because they derive it from their employee, template or user:
- `entries`, `time_records`, `time_record_changes`, `time_day_notes`
- `employee_hours`, `balance_adjustments`, `leave_entitlements`
- `notifications`, `leave_requests`
- `week_template_entries`
- `leave_planners`, which follows the planner user's facility. A Träger in `leave_planners` plans for every facility.

Global, shared by all facilities:
- `absence_codes`
- public holidays (BW)
- the leave module on/off switch
- the contract visibility switch
- personnel numbers, which stay unique installation-wide
- user names

## Migration

- Create `facilities` with row id 1 "Kindergarten". Copy `time_tracking_from` and `leave_max_concurrent` from `app_settings` into it, then delete those two keys.
- Every new `facility_id` column is set to 1.
- `users.facility_id`: 1 for the roles admin, terminal and provider; null for observer.
- Tables whose primary key or unique constraints change are rebuilt, keeping their data.

## Facility context ("active facility")

`SessionUser` gets `facilityId: number | null`. `getActiveUser` computes it fresh from the database on every request:

| Role | Facility |
|---|---|
| admin (Leitung), terminal | `users.facility_id` |
| provider (Träger) | `users.facility_id` if that facility exists, else the first facility by sort_order |
| observer | the facility of the linked employee (null without one) |

- `requireAdmin` and `requireTerminal` refuse a user without a facility (403 `no_facility`).
- Services that work on facility data take `facilityId` explicitly, as the second parameter after `db`. Routes pass `user.facilityId`.
- Ownership: a service addressing a row by id (an employee, entry, closure, appointment, template, user …) checks that the row belongs to `facilityId`. Otherwise it throws 404 with the usual `*_not_found` code, so other facilities' ids are not even confirmed to exist.
- Lists only contain the facility's rows. Calculations such as balances, coverage and leave load only include the facility's employees.
- The per-employee `my/*` routes use the facility of the viewer's employee.
- The tablet uses its own facility. It lists and accepts only that facility's employees.

## Träger: facilities and switching

- `GET /api/facilities` (any manager):
  - for the Träger: all facilities;
  - for the Leitung: only their own;
  - includes the id of the active facility.
- `POST /api/facilities` and `PUT /api/facilities/:id` (Träger only): create a facility, rename it. Deleting a facility is out of scope.
- `PUT /api/facilities/active` `{ facilityId }` (Träger only): stores the selection in `users.facility_id`.
- `PUT /api/employees/:id/facility` `{ facilityId }` (Träger only): move an employee to another home facility.
  - The employee's entries stay where they are; they belong to the employee.
  - Mitarbeiter accounts follow automatically, since their facility comes from the employee.
- A new facility starts empty, except for:
  - a copy of the first facility's shift templates and coverage rules, so it can plan at once;
  - `time_tracking_from` = null.
- UI:
  - the header shows the active facility's name to every manager;
  - for the Träger it is a dropdown with all facilities. Switching reloads the page data;
  - Einstellungen gets a section "Einrichtungen" for the Träger: a list, rename and add.

## Users

- Leitung and tablet accounts are created in the active facility.
- The Leitung sees and manages the users of its own facility:
  - Leitung and tablet accounts with that facility_id;
  - Mitarbeiter accounts whose employee belongs to it.
  - Träger accounts are listed read-only, as before.
- The Träger sees the users of the active facility plus all Träger accounts.
- A Mitarbeiter account can only be linked to an employee of the same facility (`employee_not_found` otherwise).
- "At least one active manager" is checked per facility for Leitung accounts. The installation-wide "at least one active Träger" rule stays.

## Unchanged behaviour

- All existing features keep working inside the active facility with the existing tests. Existing tests run in facility 1, which the test DB helper creates.

## Tests

- Fixtures gain a second facility helper.
- Every service gets at least one isolation test: facility B's data is invisible to, and refused for, facility A.
- The permission test classifies the new routes.
