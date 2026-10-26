# Bögen Teil 2 (Beobachtungsbögen der Kinder) – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Observation/development forms per child, built from the facility's `child` templates (starter „Entwicklungsgespräch“), filled by Leitung/Träger, the child's Bezugserzieher and staff unlocked per form, only in the office (managers) or at the tablet, linked optionally to a parent meeting, editable any time, printable A4 portrait.

**Architecture:** Reuses Teil 1: `forms` rows (kind `child`) with a content snapshot and answers; new link columns/tables in migration `0056_child_forms`; pure right check in `shared/domain/childForms.ts`; service `server/services/childForms.ts`; routes under `server/api/children/[id]/forms/…` and `server/api/child-forms/…`; UI tab „Beobachtungen“ in the child record reusing `FormFiller`/`FormPanel`, button at the parent meeting, print page.

**Tech Stack:** Nuxt 4, Nitro, drizzle-orm + better-sqlite3, Nuxt UI 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-boegen-design.md` §4, §6, §7 (Entwicklungsgespräch)

## Global Constraints

- UI German, informal „du“; code English. No new npm dependencies. Never `npm install`/npx downloads (drizzle-kit is local). Never kill processes by image name; only own PIDs. Port 3000 and `.data/app.db` untouched; own checks on 127.0.0.1:3100 with scratch copies. Never read the user's Nextcloud folder.
- Branch `claude/forms` (Teil 1 at `1aef45c`, newest migration `0055_forms` — treat 0055 as possibly already in production: do not edit it). One new migration `0056_child_forms`.
- Child forms are `forms` rows with `kind = 'child'`; new nullable columns `forms.child_id` (FK children, ON DELETE CASCADE) and `forms.parent_meeting_id` (FK child_parent_meetings, ON DELETE SET NULL, unique where not null — a meeting has at most one form); header fields stored on the form: `form_date` (ISO), `form_start` (minutes|null), `form_participants` (≤ 300). New table `form_editors (form_id FK cascade, employee_id FK cascade, granted_at, granted_by text; pk form_id+employee_id)`.
- Starter seeding becomes per starter key: new table `form_starter_seeds (facility_id FK cascade, starter_key, seeded_at; pk facility_id+starter_key)`; the migration marks the two staff starters as seeded for facilities whose `form_starters_seeded` is true; the startup step and `createFacility` seed every starter key not yet in the table (staff starters + the new `child_development` starter „Entwicklungsgespräch“). `form_starters_seeded` stays but is no longer read.
- **Rights (pure function `childFormRight(viewer, child, form | null, editors)` → `'none' | 'read' | 'edit'`):** viewer must see the child under the existing child-record rules (`resolveChildViewer` visibility; Mitarbeiter accounts outside the tablet never reach child routes — existing `requireChildReader`). Leitung/Träger (managers): `edit` everywhere. At the tablet: `edit` when the unlocking employee (`viewer.employeeId`) is the child's `keyEducatorId` or is in `form_editors` of that form; creating a form: managers and the key educator only; otherwise `read` (any viewer who sees the child may read its forms). Granting/revoking editors, deleting a form: managers only. A viewer without employee at the tablet (`employeeId null`) can only read.
- `updated_by` = viewer name text; saves take `expectedUpdatedAt` → 409 `form_changed` (same as Teil 1); answers validated with `checkAnswers` against the snapshot.
- Creating from a parent meeting copies date, start and participants of the meeting; a second form for the same meeting → 409 `child_form_meeting_taken`; the meeting DTO gets `formId`.
- Print: A4 portrait as in Teil 1 (`FormPrint.vue`), header Kind (Name, Geburtsdatum, Gruppe), Datum, Uhrzeit, Teilnehmer; milestones as a table grouped by age label (columns 3;0/4;0/5;0/6;0 when the labels are those, else grouped rows); signature lines „Unterschrift Fachkraft / Datum“ and „Unterschrift Erziehungsberechtigte / Datum“. Printing only for viewers with at least `read`; at the tablet printing follows the existing child print rules.
- Archive/purge: forms are deleted with the child (cascade); archived children's forms stay readable for managers in the archive view.
- Starter „Entwicklungsgespräch“ content: verbatim from the docx — use the extracted text `C:/Users/schad/AppData/Local/Temp/claude/C--Users-schad-Code-Dienstplan--claude-worktrees-superpowers-multiple-locations-8d7aa7/e91aa99e-53a2-4bc1-8cb2-ca1511b9cb0e/scratchpad/bogen/entw.txt` and, for the milestone tables (which column a sentence belongs to), the table XML `…/scratchpad/bogen/entw/word/document.xml` (`w:tbl` → `w:tr` → `w:tc`; the header row gives the age labels per column). Structure per spec §7: checkbox groups → `choices`, „Besondere Stärken“/„Beobachtungen“/„Förderziel“ → `text`, „Angaben zum Kind“ header lines are header fields (not items), milestone tables → `milestone` items with ageLabel from the column header. Read only these two files outside the worktree.
- Tests: `npx vitest run <file>`; all `npm test`; types `npm run typecheck`; build `npm run build`.

## Review Focus

1. At the tablet, the key educator Anna creates and edits a form; Berta (not key educator) gets `read` until a manager unlocks her for that one form, then `edit` for that form only (not for other forms of the child). → Task 1 + 2 tests.
2. A Mitarbeiter account on the phone calls any child-form route → 403 (children_tablet_only); a tablet viewer who cannot see the child's group → 404. → Task 2 test.
3. Changing the key educator of the child moves the edit right immediately (no stale grants for the old one unless explicitly unlocked). → Task 1 test.
4. Deleting the parent meeting keeps the form (link set null); deleting the child (purge) deletes its forms and editor grants. → Task 2 test.
5. The milestone sentences of „Motorik“ land in the right age column (e.g. „Beidbeiniges Abhüpfen …“ → 3;0, „Sicheres Stehen auf dem linken und dem rechten Bein …“ → 5;0 — verify against the XML). → Task 2 test.

---

### Task 1: Rights (domain)

**Files:** Create `shared/domain/childForms.ts`; Test `tests/domain/childForms.test.ts`

**Interfaces:** `childFormRight(viewer: { role; onTablet: boolean; employeeId: number | null; canSeeChild: boolean }, child: { keyEducatorId: number | null }, form: { id: number } | null, editors: ReadonlySet<number> /* employee ids unlocked for this form */): 'none' | 'read' | 'edit'` and `canCreateChildForm(viewer, child): boolean`, `canManageChildForms(viewer): boolean` (grant/revoke/delete).

- [ ] Failing tests for every row of the rights rule (Review Focus 1, 3) → implement → commit `feat: child form rights`.

### Task 2: Data, starter, service, routes

**Files:** schema + migration `0056_child_forms`; `shared/domain/forms/starters.ts` (+ `child_development` starter); `server/services/formTemplates.ts` (seeding per starter key with `form_starter_seeds`); Create `server/services/childForms.ts`; routes `server/api/children/[id]/forms/index.get.ts`, `index.post.ts` (templateId, date, start, participants | parentMeetingId), `server/api/child-forms/[formId].get.ts`, `[formId].put.ts` (answers + header, expectedUpdatedAt), `[formId].delete.ts`, `[formId]/editors.get.ts`, `[formId]/editors.put.ts` (employeeIds[]); parent meeting DTO `formId` (server/services/parentMeetings or where meetings live); `tests/api/permissions.test.ts` (child routes use the existing child guards — `requireChildReader(` / `requireChildEditor(`-style; register them where the permissions test expects child routes); German texts; Tests `tests/services/childForms.test.ts`, seeding tests in `tests/services/formTemplates.test.ts`, migration test in `tests/services/db.test.ts`.

- [ ] Failing tests: Review Focus 1, 2, 4, 5; create from meeting copies header + second → 409; template must be kind child, active, same facility; save conflict 409; editors only managers; seeding: existing facility with flag → only the child starter added; new facility → all three; idempotent → implement → commit `feat: child observation forms with an Entwicklungsgespräch starter`.

### Task 3: UI, print, docs

**Files:** child record tab „Beobachtungen“ (find the child record tabs in `app/pages/children/[id].vue` / its components): list (newest first: date, template, „zuletzt geändert“), „Bogen anlegen“ (template select, date via DateTextInput, start, participants), open inline with `FormPanel`/`FormFiller` (edit/read by right from the API), „Mitarbeiter freischalten“ dialog (managers; multi-select of the facility's employees), delete (managers, confirm); parent meeting section (`app/components/children/ChildMeetingsSection.vue`): „Bogen ausfüllen“ when no form, „Bogen öffnen“ when linked; print page `app/pages/print/children/forms/[formId].vue` (A4 portrait via FormPrint with child header and signature lines; allowed by the PDF path allow-list — check `server/utils/pdf.ts`); `app/locales/de.ts`; `docs/BETRIEB.md` (extend „## 25.“ with Beobachtungsbögen).

- [ ] Implement → `npm test`, typecheck, build; headless check at the tablet (unlock as key educator → create/edit; as another employee → read only; manager unlocks → edit) and office, 375 px and tablet width, print → commit `feat: observation forms in the child record`.

### Task 4: Controller check (no implementer)

- [ ] Scratch copy: Review Focus 1–5 in the browser; the Entwicklungsgespräch print matches the docx structure (checkbox groups, milestone table by age).
