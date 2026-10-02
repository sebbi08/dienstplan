# Week templates (Dienstplanvorlagen) — design

Approved in chat on 2026-10-02 ("ja, setze es so um"). The user chose single, freely chosen templates (no automatic rotation order).

## Behaviour

- **Save**: in the admin plan, every week row (KW) offers "Als Vorlage speichern". The admin enters a name. Saved are Monday–Friday of that ISO week for all employees: shifts, special shifts, breaks, VZ and Büro, with their exact times. One-off entries (Urlaub, Sonderurlaub, Krank, Fortbildung, Schule, sonstiges, Feiertag, Schließtag) and closure-linked entries are not saved. Saving under an existing name replaces that template, after a confirmation in the UI.
- **Apply**: every week row also offers "Vorlage einsetzen". The admin picks a template. For each employee and weekday in the template, the entries are copied into the plan only when the cell is empty and the day is a working day of that employee: employed, not left, a contract working day, no public holiday, and not inside a closure. Existing entries are never changed. The result says how many days were filled and how many were skipped.
- **Afterwards**: inserted entries are normal plan entries (draft until released), editable as usual, recorded in the change log.
- **Change a template**: apply it, adjust the week and save again under the same name.
- **Templates page** (`/admin/week-templates`, nav "Vorlagen"): a list of the templates, each with a preview (employees × Mo–Fr, short labels), rename and delete. Admin only.

## Data

- `week_templates`: id, name (unique), updated_at.
- `week_template_entries`: template_id (cascade), employee_id (cascade), weekday 0–4 (Monday = 0), and the entry fields kind, shift_template_id (set null), absence_code_id, start, end, break_start, break_end, counts_as_staff, note.

## API (all admin)

- `GET /api/week-templates` returns the list with a preview.
- `POST /api/week-templates` with `{ name, weekStart }` saves or replaces.
- `PUT /api/week-templates/:id` with `{ name }` renames.
- `DELETE /api/week-templates/:id` deletes.
- `POST /api/week-templates/:id/apply` with `{ weekStart }` returns `{ filled, skipped }`.

`weekStart` must be a Monday.

## Errors

- `name_required`
- `name_taken` (rename onto another template's name)
- `week_template_not_found`
- `not_a_monday`
- `empty_week` (nothing to save)

## Tests

Service tests cover:
- what is saved and what is excluded;
- replacing a template under the same name;
- apply skips filled cells, holidays, closures, days off, and employees who left;
- the change log is written;
- rename and delete.

The permission test classifies the new routes.
