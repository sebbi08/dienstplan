# Groups (Gruppen) inside a facility, step 3 — design

Step 3 of 3 after facilities (step 1) and helping out (step 2). Decided in chat on 2026-10-08:
- The Träger adds groups to a facility.
- No single Leitung is assigned to a group: the Leitung of the facility is responsible for all its groups.
- Required duties (Pflichtdienste) apply either to the whole facility or to one group. The Leitung chooses which.
- Every employee has a fixed home group (Stammgruppe), or none (Springer). Single duties can be assigned to another group.
- The plan is released for the whole facility at once, by the Leitung or the Träger, as today.
- The groups appear as blocks side by side in the plan, each with a count of present persons per day.
- Week templates (Vorlagen) can be made per group.

## Goal

A facility can be divided into groups. With no groups, the app looks and behaves exactly as before.

## Data model

New table `groups`:
- `id`
- `facility_id` (references facilities)
- `name` (not empty, unique per facility, compared with `toLocaleLowerCase('de')`)
- `sort_order`

New nullable columns, all added with `ALTER TABLE … ADD` and no table rebuild:

| Column | Meaning when null | Meaning when set |
|---|---|---|
| `employees.group_id` | Springer, or the facility has no groups | the home group |
| `entries.group_id` | the duty counts for the employee's home group | this single duty counts for that group |
| `coverage_rules.group_id` | rule for the whole facility (today's rules) | rule for that group only |
| `week_templates.group_id` | template for the whole facility (today's templates) | template for that group |

`week_template_marks` gets a `group_id` column (0 = whole facility) in its primary key, so each group's week can show its own template name. This is the one table that is rebuilt; it is small.

Effective group of an entry: `entries.group_id`, otherwise the employee's current `group_id`. Helpers from another facility (step 2) have no home group in the helping facility, so their duties count for a group only when one is set on the entry.

Moving an employee to another facility (step 1) sets `employees.group_id` to null and clears `group_id` on their entries from the move day on.

## Managing groups (Träger)

- In Einstellungen → Einrichtungen, each facility gets a list of its groups with add, rename and delete. Only the Träger sees this.
- Routes, all `requireProvider`:
  - `GET /api/facilities/:id/groups`
  - `POST /api/facilities/:id/groups`
  - `PUT /api/groups/:id`
  - `DELETE /api/groups/:id`
- Deleting a group:
  - is refused with 409 `group_has_members` while employees still have it as their home group;
  - otherwise also deletes the group's required duties and templates. The UI asks first;
  - sets `group_id` of entries assigned to it to null.
- Error codes:
  - `group_name_required` (400)
  - `group_name_taken` (409)
  - `group_not_found` (404; also for a group of another facility)
  - `group_has_members` (409)
- The groups of the active facility are listed for managers through `GET /api/groups`.

## Employees (Leitung)

- On the employee page and in "Mitarbeiter anlegen", a select "Gruppe": the facility's groups plus "Springer (keine feste Gruppe)". It is shown only when the facility has groups.
- The employee overview shows the group next to the name.
- Only the facility's own groups are accepted (`group_not_found` otherwise).

## Single duties in another group

- The entry edit dialog in the plan gets a select "Zählt für Gruppe": "Stammgruppe (…)" plus the other groups. It is shown only when the facility has groups.
- Writing the cell keeps the chosen group.
- Range entry via the toolbar uses the home group.
- The chip of such a duty shows a small group tag, e.g. "→ Mäuse".
- `group_id` belongs to the cell identity for releases, so a change of group is a change of the plan.

## Required duties (Leitung)

- In Einstellungen → Pflichtdienste, every rule gets a select "Gilt für": "ganze Einrichtung" (default, today's rules) or one group.
- Checking:
  - A facility rule counts all duties of the day, as today.
  - A group rule counts only duties whose effective group is that group.
  - Springer duties without an assigned group count only for facility rules.
- The warning names the group, e.g. "Mäuse: 1 von 2 Frühdiensten".

## Week templates per group (Leitung)

- Saving a template: the dialog gets "Für": "ganze Einrichtung" or one group.
  - A group template stores only the duties of that group's current members whose effective group is the group (duties moved to another group stay out).
  - A facility template stores everything, as today.
- Applying a group template fills only empty cells of the group's current members.
- The template list in Einstellungen shows the group of each template.
- The week row of the plan shows the template names per group block. The facility template's name stays in the KW column.

## Plan view

- Columns are ordered in blocks:
  1. each group, in `sort_order`, with its members ordered by the existing employee order;
  2. "Springer";
  3. "Aushilfen", the helpers from step 2.

  A header row above the name row shows each block's name over its columns.
- Under each group block, a row "anwesend" shows per day how many persons work in that group. This counts duties with working time whose effective group is the group, including Springer and helper duties assigned to it.
- A select "Gruppe: alle / <Gruppe>" above the plan shows only one block plus Springer and Aushilfen. It is remembered per browser.
- The day overview, week totals, balances, warnings and release work as before. The day overview follows the group select.
- The print view and the PDF show the blocks and their names, and respect the group select.
- Mitarbeiter see the same blocks in the released plan. Snapshots store each employee's group and each entry's `group_id`, plus the group names at release time. Old snapshots without groups show no blocks.
- With no groups in the facility, nothing of this appears.

## Rights

| Who | What |
|---|---|
| Träger | add, rename and delete groups (every facility); everything the Leitung can |
| Leitung | home group of employees; group of single duties; group required duties; group templates; release (whole facility) |
| Mitarbeiter | see the blocks in the released plan |

The rights table on the users page gets the new rows.

## Out of scope

- Separate releases per group.
- A Leitung responsible for only some groups.
- A history of group membership: a change of home group applies to all of the employee's duties that have no own group, including past ones.

## Tests

- Group service: add, rename and delete with every refusal, plus isolation (another facility's group answers 404).
- Employee group: set, refused for a foreign group, cleared on a move.
- Coverage: a facility rule and a group rule on the same day, a Springer duty, and a duty assigned to another group.
- Templates: save and apply per group; the facility template is unchanged.
- Release:
  - changing a duty's group is a pending change;
  - old snapshots read without groups.
- Plan DTO:
  - block order and counts per group;
  - nothing changes when the facility has no groups.
- The migration keeps every row, and its new columns are null.
- The permissions test classifies the new routes.
