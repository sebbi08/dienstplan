# Falling ill during duty (Im Dienst erkrankt) — design

Agreed in chat on 2026-10-12.

## Goal

When an employee falls ill during their duty and goes home early:
- the day is **not** a sick day: the duty stays in the plan, no "Krank" entry is made, and the sick-day statistics are unchanged;
- the planned working time of the day is credited in full, even when the stamped time is shorter;
- the time-tracking page still shows that the person left early;
- the sick-days page ("Krankheit") gets a second list: when did who leave early because of illness.

Only Leitung and Träger enter and see this. Colleagues and the person's own plan show the duty unchanged. One exception: the time sheet the employee signs shows the fixed text "im Dienst erkrankt" in the Begründung column of a marked day (never the note or the time of leaving), so the credited time is explained.

## Data model

New table `early_sick_leaves`:
- `id`
- `employee_id` (references employees, cascade)
- `date` (ISO)
- `left_at` (minutes of the day, or null)
- `note` (optional, max 200)
- `created_at`
- `created_by` (references users, set null on delete)
- unique (`employee_id`, `date`)

Migration `0024_early_sick_leaves` only creates this table and its index.

## Rules

- **Who:** managers of the employee's **home** facility (`requireAdmin`, `assertEmployee`). Another facility's ids answer 404.
- **Conditions:**
  - the day must have planned working time for the person (shift, Sonderdienst, VZ or Büro, in the home plan or as a help-out elsewhere): 400 `no_duty_planned` otherwise;
  - the day must not carry a full-day absence (an entry with credit mode `daily_target`, e.g. Krank or Urlaub): 400 `no_duty_planned` as well;
  - the date must not be in the future: 400 `date_in_future`;
  - `left_at`, if given, must be a valid time: 400 `invalid_time`.
- **One marker per person and day.** Saving again replaces the time and note.
- **Credit:** on a marked day the credited time is the planned working time of the day (the same value as without time tracking), also when time tracking is active and the stamped time is shorter. When more was stamped than planned, the stamped time counts: the credit is the larger of the two. Balances, week totals and "Mein Dienstplan" totals follow, since they all use the same day computation.
- **Time warnings:** a marked day produces no time warnings (missing record, break and deviation hints), and the plan's "recorded time deviates" flag is off.
- **Effective time of leaving:** `left_at` if entered; otherwise the end of the last closed time record of that day; otherwise unknown.
- **Stale markers:** when a cell loses its working time (cleared, replaced by an absence, discarded back to empty), its marker is deleted in the same transaction. The paths are `applyToCells`, `deleteEntry` and `revertToRelease`.
- **Not part of releases:** snapshots, pending changes, notifications and "Mein Dienstplan" entries do not contain the marker.
- **Moving an employee** to another facility keeps their markers; they belong to the person.

## API (all `requireAdmin`)

- `GET /api/early-sick-leaves?year=YYYY` → the list for the active facility's staff:
  - `rows: { id, employeeId, employeeName, date, duty, leftAt, leftAtFromRecord, note }[]`, newest first. `duty` is the readable planned duty of the day. `leftAtFromRecord` is true when the time came from the time record.
  - `totals: { employeeId, employeeName, count }[]`
- `PUT /api/early-sick-leaves` `{ employeeId, date, leftAt: number | null, note?: string }`: create or replace.
- `DELETE /api/early-sick-leaves/:id`

## UI

- **Plan (managers):**
  - The cell menu and entry dialog of a duty get "Im Dienst erkrankt …", which opens a small dialog: "Gegangen um" (optional time), "Bemerkung", save, and "Markierung entfernen" when one exists.
  - A marked cell shows a small first-aid/thermometer icon with a tooltip "Im Dienst erkrankt, gegangen um 11:20". This is manager view only. It is not printed for staff and not in the released view.
  - The month plan DTO gets `admin.sickLeaves: Record<cellKey, { id, leftAt, note }>`.
- **Zeiterfassung (admin time page):** the day row keeps showing the stamped times, and adds a badge "Im Dienst erkrankt – gegangen um 11:20 · gutgeschrieben: geplante Zeit". The credited time is the planned time. The marker can be set and removed there too.
- **Krankheit (sick-days page):**
  - A second card "Vorzeitig gegangen wegen Krankheit" for the chosen year: the per-employee counts, then a table with Datum, Mitarbeiter, Dienst, Gegangen um ("laut Stempeluhr" hint when from the record), Bemerkung, and a delete button.
  - The print view of the sick-days page includes this list.
- The rights table gets a row. Texts live in `app/locales/de.ts`, plus the new error codes `no_duty_planned` and `invalid_time` (if not existing).

## Tests

- Credit: with time tracking active and a short stamped time, the marked day credits the planned time; unmarked days are unchanged; balances and week totals follow.
- Not a sick day: `getSickYear` is unchanged by a marker.
- Refusals: no duty, a full-day absence, a future date, a foreign employee, or a foreign marker id → 404/400 with nothing stored.
- Replace on second save; delete.
- Stale marker removed when the cell is cleared, replaced by "Krank" or discarded.
- `leftAt` falls back to the last record end.
- Time warnings and the deviation flag are off on a marked day.
- Isolation: another facility sees no rows and cannot delete.
- The migration keeps rows.
- The permissions test classifies the routes.
- Snapshots and the observer plan contain nothing of the marker.
