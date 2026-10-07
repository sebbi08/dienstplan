# Leave requests (Urlaubsanträge) — design

Approved in chat on 2026-10-07 ("Modul Urlaubsanträge so wie vorgeschlagen").

## Switches (Träger only)

- `leave_requests_enabled` (app setting, default off). While it is off, nobody sees anything of the module.
- **Planners** (`leave_planners`: user ids). These are Träger and/or Leitung accounts chosen by the Träger. A Träger may always decide, even when not chosen; chosen people get the requests (badge).

## Requesting

- Who: any account linked to an employee: Mitarbeiter, and Leitung/Träger with an employee.
- Where: "Mein Urlaub" → "Urlaub beantragen": from, to, note.
- Shown before sending:
  - the employee's working days in the range (holidays, closures and days off do not count);
  - the remaining leave of that year after the request;
  - the days on which the limit would be exceeded (a hint; sending stays allowed).
- Rules:
  - The first day must not be in the past.
  - The range must contain at least one working day outside closures.
  - It must not overlap an open or approved request of the same employee.
- The requester sees their requests with status: open, approved, rejected (with reason), withdrawn. They can withdraw an open one.

## Deciding (planners)

- New page `/admin/leave-planning` ("Urlaubsplanung"), for planners only.
  - Menu item with the number of open requests.
  - List of open requests with "Genehmigen" and "Ablehnen" (reason optional).
  - Nobody decides their own request.
- Approving writes the code "Urlaub" into the plan on every working day of the range outside closures. It replaces what is there. When duties are already planned on those days, the server refuses (`cells_occupied`, with the count) unless `overwrite: true` is sent; the UI asks first.
- Rejecting and withdrawing change nothing in the plan.

## Calendar and limit

- On the planning page there is a year calendar like the existing one.
  - Approved/planned leave is green.
  - Open requests are light green, striped.
  - A bottom row shows per day how many people are on leave. It turns red above the limit.
- `leave_max_concurrent` (app setting, empty = no limit) is set by the planners.
- Counting per day: distinct employees with a "Urlaub" entry that is not linked to a closure, plus employees with an open request covering that day on one of their working days. Closures do not count.
- Warnings ("über der Höchstzahl"):
  - on each open request: the days above the limit;
  - in the calendar;
  - for the requester before sending.

## Notification

- In the app only. Planners get the count in the menu. Requesters see the status on "Mein Urlaub".

## Data

- `leave_requests`:
  - `id`
  - `employee_id` (cascade)
  - `start_date`, `end_date`, `note`
  - `status`: `open` | `approved` | `rejected` | `withdrawn`
  - `created_at`, `created_by`
  - `decided_at`, `decided_by` (user)
  - `decision_note`
- `leave_planners`: `user_id` (pk, cascade).
- App settings: `leave_requests_enabled`, `leave_max_concurrent`.
