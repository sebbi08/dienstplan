# Helping out in another facility (Aushelfen), step 2 — design

Step 2 of 3 after facilities (step 1, merged 2026-10-07). The user accepted the outline in chat on 2026-10-07 and asked to continue with it ("mach mit Teil 2 Aushelfen weiter"). Step 3 (groups inside a facility) is out of scope.

## Goal

An employee of facility A (home) can help out in facility B on single days.
- B's Leitung adds the person as a helper ("Aushilfe") to B's plan for one month. The person then has a column in B's plan for that month, marked "Aushilfe aus A". Duties go in as usual.
- On those days, A's plan shows "Aushilfe in B" with the times. Only B (and the Träger with B active) can change them.
- Hours go to the person's single account. Leave, contract, PIN and master data stay at home in A.
- A help-out duty counts for B's required duties and B's day overview, not A's. A shows no "kein Eintrag" warning for that day.
- B's Leitung sees only the helper's name and duties: no balances, no leave, no contract data, no time page.
- B's tablet lists the helper on the days they are planned in B. They stamp there with their usual PIN.

## Words

- **Home facility**: `employees.facility_id`, as in step 1.
- **Help facility**: the facility a help-out entry was planned in.
- **Plan of F**: the cells F plans and publishes. It contains:
  - the entries of F's own staff that are not help-outs elsewhere;
  - the help-out entries planned in F.
- **Help-elsewhere marker**: an entry of F's own staff that was planned in another facility. F shows it read-only. It is not part of F's own cells.

## Data model

New table `help_outs`. One row gives the person a column in F's plan for that month.

| Column | Rule |
|---|---|
| `id` | primary key |
| `employee_id` | references `employees`, on delete cascade |
| `facility_id` | references `facilities`; never the employee's home facility |
| `year`, `month` | the month |
| unique | (`employee_id`, `facility_id`, `year`, `month`) |

New nullable column `entries.help_facility_id`, referencing `facilities`.
- `null`: a normal entry of the home facility. All existing rows stay null.
- A facility id: the entry was planned in that facility's plan as a help-out. It is never the employee's current home facility.

**One day, one facility.** All entries of one person on one date share the same `help_facility_id`, so a day belongs to exactly one plan. The services enforce this (see "Writing cells").

Migration `0021_help_outs` creates the table and adds the column (`ALTER TABLE … ADD`). No rebuild, no data change.

## Reading: which entries a facility sees

`loadEntries`' facility filter is split in two. Every caller is assigned to one of them; Task 1 of the plan lists them.

| Filter | Meaning | Used for |
|---|---|---|
| `homeFacilityId` | every entry of the facility's home staff, help-outs elsewhere included | balances, week totals, leave, sick days, calendar, time tracking: everything about the person's account |
| `planFacilityId` | the plan of F: home staff entries with `help_facility_id` null, plus entries with `help_facility_id = F` | plan cells, snapshots, releases, coverage, day overview, week templates, notifications, revert, adopting service times |

`EntryDto` gains `helpFacilityId: number | null`.

## Plan of B (the helping-out facility)

- **Columns**: B's own staff, then the month's helpers, ordered by name. A helper column carries `helpFrom` (the home facility's name). `EmployeeColumnDto` gains optional `helpFrom?: string | null`. Old snapshots have none, so it reads as null.
- **Cells**: a helper's column shows only the help-out entries planned in B. A day the helper has in another plan (at home, or helping elsewhere) shows as "belegt" with no details, and B cannot write it.
- **Admin data**:
  - Coverage warnings and the day overview count the helpers' B entries.
  - Helpers get no "kein Eintrag" or target-gap warnings, no week totals, no balances, no actuals.
  - Their header rows (overtime) stay empty.
- **Releases**:
  - B's snapshot contains the helper columns and their B entries.
  - Re-releasing notifies a helper whose B duties changed, through the existing notification module (`notifications` rows are per employee).
- **Pending changes and discard**:
  - A helper cell is B's own for the months the helper has a `help_outs` row in B.
  - Discard restores the released B entries of a helper cell. If the home facility has meanwhile entered an absence on that day, the cell is skipped. Nothing is ever deleted from another plan.
- **Print view and PDF**: they include helper columns, marked "(Aushilfe)", without overtime rows.
- **Week templates**: saving in B ignores helper columns. Applying in B writes only B's own staff.

## Plan of A (the home facility)

- **Marker**: a day on which an A employee helps in B shows as a read-only chip "Aushilfe in B" with the times, in grey.
  - It appears in A's snapshot, so A's staff see it in the released plan.
  - It is excluded from A's own cells, so it is never pending in A, never discarded by A, and never notified by A.
- **Warnings**: a help-elsewhere day counts as filled for "kein Eintrag" and the target gap. It does not count for A's coverage or day overview.
- **Hours**: A's week totals and balances include help-out hours, because there is one account.
- **Writing a help-out day**:
  - A's Leitung may only enter an absence code there: Urlaub, Sonderurlaub, Krank, Fortbildung, Schule, Feiertag, Schließtag, or any code without times.
  - That replaces the help-out. B's entries for that day are deleted and logged in both facilities' change logs, so the day then appears as a pending change in B.
  - Any other entry is refused with 409 `cell_helps_elsewhere`.
- **Closures**: booking a closure skips days on which the person helps out elsewhere. The leave count works as before for the remaining days.

## Writing cells (server rules)

`applyToCells(db, actor, facilityId, cells, …)` accepts a cell when one of these holds:
1. The employee is home staff of `facilityId`, and the day has no help-out entries. This is the existing behaviour.
2. The employee is home staff, the day has help-out entries, and the input is an absence code (see Plan of A). The help-out entries are removed.
3. The employee has a `help_outs` row in `facilityId` for that month, and the day has no entries outside this plan. The written entries get `help_facility_id = facilityId`. Allowed inputs: shifts, Sonderdienste and Pausen of B's services, and codes with times (VZ, Büro). Absence codes are refused with 400 `help_code_not_allowed`.

Otherwise the request is refused: 409 `cell_taken` (case 3, when the day belongs to another plan) or 400 `employee_not_found` (not staff and not a helper this month).

The same ownership applies to:
- `deleteEntry` and `updateEntryTimes`, by entry id: B may change entries with `help_facility_id = B`. A may not touch help-out entries, except replacing them as in rule 2.
- `adoptShiftTimes`: it changes the entries in the template's facility plan, so helpers' B entries are included.

## Adding and removing helpers

New routes, all `requireAdmin` on the active facility:
- `GET /api/help-outs/candidates?year&month`: active employees of other facilities who are employed in that month. Fields: id, name, shortName, facility name. Only names are shown.
- `GET` is not needed separately. The plan DTO already lists helper columns, with `helpOutId` on `EmployeeColumnDto` for removal (admin view only).
- `POST /api/help-outs` `{ employeeId, year, month }`:
  - adds the helper;
  - 400 `employee_not_found` for the facility's own staff or an unknown id;
  - 409 `help_out_exists` when the row already exists.
- `DELETE /api/help-outs/:id`:
  - removes the column;
  - refused with 409 `help_out_has_entries` while the helper still has entries in B that month;
  - another facility's row answers 404 `help_out_not_found`.

UI: in B's plan toolbar, a button "Aushilfe hinzufügen" opens a dialog with a searchable select showing "Name (Einrichtung)". The helper column header shows the name, "Aushilfe aus A", and a remove button when the column is empty.

## Tablet and time tracking

- `terminalStatus(db, B)` adds every helper who has a help-out entry in B today and has a PIN. `terminalStamp` accepts them on those days.
- Records belong to the employee and count in the home account, using the home facility's `time_tracking_from` and break mode. B's time page lists only B's staff.
- A's time page shows the helper's records as before. Planned breaks come from all the person's entries (`homeFacilityId`).

## Employee's own views

- **"Mein Dienstplan"**:
  - Days come from the home facility's latest release, without the help-elsewhere markers.
  - Help-out days come from the latest release of each facility the person helps in that month, marked "Aushilfe in B".
  - Change history per cell comes from the facility that owns the cell.
- **Year calendar and leave**: unchanged; help-outs are not absences.

## Moving an employee (interaction with step 1)

Moving to a new home facility N:
- deletes the employee's `help_outs` rows for N;
- sets `help_facility_id = null` on their entries with `help_facility_id = N`, which become home entries.

Help-outs in other facilities stay.

## Rights

- The Träger can do everything the Leitung of the active facility can.
- Mitarbeiter accounts are unchanged.
- The rights table gains one row: "Aushilfen aus anderen Einrichtungen einplanen" for Leitung and Träger.

## Out of scope

- Help-outs between facilities with different absence-code sets (codes are global).
- Helpers seeing other facilities' full plans.
- Groups (step 3).

## Tests

- Fixtures: `addHelpOut(db, employeeId, facilityId, year, month)`.
- Each rule in "Writing cells" has a test, including the refusals.
- Plan of B:
  - a helper column with `helpFrom`;
  - coverage counts the helper;
  - no "missing" warnings for the helper;
  - no balances for the helper.
- Plan of A:
  - the marker;
  - a filled day without coverage;
  - week totals include help-out hours;
  - not pending, not revertible, not notified.
- Release and discard in B: a helper notification, and a discard skipped after an absence override.
- Tablet: a helper is listed and can stamp on a B day, and is not listed on other days.
- My plan merges B's released help-out days.
- Moving an employee into the helping facility normalises the entries.
- Isolation: a third facility C sees nothing of the help-out, and C's Leitung cannot remove B's helper.
- The permissions test classifies the new routes.
