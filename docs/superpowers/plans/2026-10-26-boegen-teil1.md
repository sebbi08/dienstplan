# Bögen Teil 1 (Baukasten + Mitarbeitergespräche) – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-facility form-template builder (sections + items of six kinds) and staff talks: Leitung/Träger create talks with forms from templates, release a self-assessment to the employee to fill and submit, release an assessment to read, edit any time, print A4 portrait.

**Architecture:** Templates and filled forms store their structure as JSON (sections → items with stable string ids); a filled form keeps a snapshot of the template. Pure validation/editing in `shared/domain/forms.ts`; services `server/services/formTemplates.ts`, `server/services/staffTalks.ts`; routes under `server/api/form-templates/…`, `server/api/staff-talks/…`, `server/api/my/talks/…`; UI: settings area „Bögen“, employee tab „Gespräche“, page „Meine Gespräche“, a shared form-filler component, print page.

**Tech Stack:** Nuxt 4, Nitro, drizzle-orm + better-sqlite3, Nuxt UI 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-boegen-design.md` (this plan covers §2, §3, §6, §7 for the two staff templates; children = Teil 2, team meetings = Teil 3)

## Global Constraints

- UI German, informal „du“; code, identifiers, comments, commits English. No new npm dependencies. No Docker/CI changes.
- Never run `npm install`/`npm ci` or npx downloads (drizzle-kit is local). Never kill processes by image name; stop only own PIDs. Port 3000 and `.data/app.db` untouched; own checks on 127.0.0.1:3100 with scratch copies (`DATABASE_PATH`, `MIGRATIONS_DIR`). Never read the user's Nextcloud folder.
- Branch `claude/forms` (from `051f9b2`, newest migration `0054_cashbook`); one migration `0055_forms` (`npx drizzle-kit generate --name forms`, journal `when` > 0054's).
- Form kinds: `staff` („Mitarbeitergespräch“), `child` („Kind“), `team` („Teamsitzung“). Teil 1 seeds only `staff` templates but the builder handles all three kinds.
- Item kinds and limits: `note` (text 1–1000), `text` (question 1–300; answer ≤ 4000), `choices` (question 0–300; 1–40 options of 1–80 chars; answer = subset of option ids), `rating` (criterion 1–300; answer `'+' | '~' | '-' | null` + remark ≤ 500), `milestone` (text 1–300, ageLabel 1–20; answer reached boolean + remark ≤ 200), `date` (question 1–300; answer ISO date or null). Section title 1–120, optional hint ≤ 1000. Template name 1–80, unique per facility and kind (case-insensitive). Max 60 sections, 120 items per section.
- Ids: sections/items/options get stable ids `crypto.randomUUID()`-style strings created on the server; answers are keyed by item id; unknown ids or wrong shapes → 400 `form_answer_invalid`.
- Snapshot: creating a form copies the template content; template changes never change existing forms.
- Staff talk roles: a template with `selfAssessment = true` makes a **self** form (Startvorlage „Selbstbeurteilung“), otherwise an **assessment** form.
- Self form states: `draft` → (Leitung/Träger „Zum Ausfüllen freigeben“) `released` → (employee „Abgeben“) `submitted`; Leitung/Träger: withdraw release while `released` (→ `draft`), reopen `submitted` (→ `released`). Employee may write only in `released`. Assessment forms: `readReleased` boolean („Zum Lesen freigeben“ / zurücknehmen).
- Rights: templates and talks `requireAdmin(` (Leitung + Träger, active facility); employee routes `requireUser(` and only own employee (`user.employeeId`), never `terminal` (403); another employee's talk or an unreleased form → 404 (no existence leak).
- Every form shows „zuletzt geändert von … am …“ (user name text + ISO time).
- Print: A4 portrait via `@page { size: A4 portrait !important; margin: 12mm !important; }` (the app-wide print rule is landscape; see `app/pages/admin/print/cash/[id]/[year]/[month].vue`).
- Starter-template texts come from the extracted text files (not the .docx): `C:/Users/schad/AppData/Local/Temp/claude/C--Users-schad-Code-Dienstplan--claude-worktrees-superpowers-multiple-locations-8d7aa7/e91aa99e-53a2-4bc1-8cb2-ca1511b9cb0e/scratchpad/bogen/selbst.txt` and `…/bogen/beurteilung.txt` — copy the wording verbatim (fix only obvious typos like doubled spaces, keep „&amp;“ as „&“).
- Tests: `npx vitest run <file>`; all `npm test`; types `npm run typecheck`; build `npm run build`.

## Review Focus

1. Leitung deletes an item from a template after a talk was created → the talk's form still shows the item and its answer; saving that form still accepts the answer. → Task 1 + Task 3 tests.
2. Employee A opens `/api/my/talks/<id of B's talk>` or B's form id → 404; an assessment not released to read → 404 for A; a Träger account without employee → 404 on my routes. → Task 3 test.
3. Employee submits, then tries to save again → 409 `form_not_editable`; Leitung reopens → employee can save and submit again. → Task 3 test.
4. A choices answer with an option id from another item, a rating „x“, a text of 4001 chars → 400 `form_answer_invalid`; nothing saved. → Task 1 test.
5. A new facility created by the Träger gets both staff starter templates; the migration seeds them for existing facilities exactly once. → Task 2 test.

---

### Task 1: Domain (template model, edits, answers)

**Files:** Create `shared/domain/forms.ts`; Test `tests/domain/forms.test.ts`

**Interfaces (produces):**
- Types `FormKind`, `ItemKind`, `FormItem` (discriminated union by `kind` with the fields above + `id`), `FormSection { id; title; hint: string; items: FormItem[] }`, `FormContent { sections: FormSection[] }`, `FormAnswers = Record<string, unknown>` and typed answer shapes `TextAnswer`, `ChoicesAnswer`, `RatingAnswer`, `MilestoneAnswer`, `DateAnswer`.
- `checkContent(content: unknown): FormContent` (throws `FormError(code)` with codes `form_content_invalid`, limits per Global Constraints; ids must be unique).
- `checkAnswers(content: FormContent, answers: unknown): FormAnswers` (drops nothing silently: invalid → `FormError('form_answer_invalid')`; `note` items take no answer).
- Pure edit helpers used by the editor UI and the server: `addSection`, `updateSection`, `moveSection(content, id, 'up'|'down')`, `removeSection`, `addItem(content, sectionId, item)`, `updateItem` (kind cannot change → `form_item_kind_fixed`), `moveItem(content, itemId, direction)` (moves across section borders at the ends), `removeItem`. Id generation is injected (`newId: () => string`) so tests are deterministic.
- `emptyAnswer(item)`.

- [ ] Failing tests: each item kind valid/invalid at the limits; duplicate ids rejected; Review Focus 4; edit helpers incl. moving an item from the last position of section 1 to section 2; kind change refused → implement → pass → commit `feat: form template model`.

### Task 2: Templates – data, service, routes, starter templates

**Files:** schema + migration `0055_forms` (tables `form_templates` (id, facility_id, kind, name, self_assessment, archived, sort_order, content json text, created_at, updated_at, updated_by), `forms` (id, facility_id, template_id, kind, title, content json, answers json, state, read_released, updated_at, updated_by, created_at), `staff_talks` (id, facility_id, employee_id, date, start minutes, participants, period, created_at, created_by), `staff_talk_forms` (talk_id, form_id, role 'self'|'assessment', sort)); Create `shared/domain/forms/starters.ts` (the two staff starter templates built from the text files), `server/services/formTemplates.ts`, routes `server/api/form-templates/index.get.ts` (?kind), `index.post.ts`, `[id].put.ts` (name, archived, selfAssessment, content), `[id].delete.ts` (409 `form_template_in_use` when forms exist), `[id]/copy.post.ts`; seeding: in the migration's follow-up (a startup/data step the app already uses for seed data — find how existing defaults are created per facility, e.g. in `server/services/facilities.ts createFacility`) and in `createFacility`; `tests/api/permissions.test.ts`; Test `tests/services/formTemplates.test.ts`

- [ ] Failing tests: CRUD + unique name per kind; delete refused when in use; copy gets „(Kopie)“ suffix and fresh ids; Review Focus 5 (new facility gets both; existing facilities seeded once — idempotent by checking existing starter names); Mitarbeiter 403 → implement → pass → commit `feat: form templates with staff starter templates`.

### Task 3: Staff talks – service and routes

**Files:** Create `server/services/staffTalks.ts`; routes `server/api/staff-talks/index.get.ts` (?employeeId), `index.post.ts` (employeeId, date, start, participants, period, templateIds[]), `[id].put.ts` (header fields), `[id].delete.ts`, `[id]/forms.post.ts` (add a form from a template), `forms/[formId].put.ts` (answers), `forms/[formId].delete.ts`, `forms/[formId]/release.post.ts`, `…/withdraw.post.ts`, `…/reopen.post.ts`, `…/read-release.post.ts` (body { released: boolean }); employee routes `server/api/my/talks/index.get.ts`, `my/talks/forms/[formId].get.ts`, `my/talks/forms/[formId].put.ts` (answers, only `released`), `my/talks/forms/[formId]/submit.post.ts`; DTOs in `shared/types/api.ts`; `tests/api/permissions.test.ts` (USER_ROUTES for my/talks); Test `tests/services/staffTalks.test.ts`

**Interfaces:** `StaffTalkDto { id; employeeId; date; start; participants; period; forms: TalkFormDto[] }`, `TalkFormDto { id; role; title; content; answers; state; readReleased; updatedAt; updatedBy }`, `MyTalkDto` (only forms visible to the employee: self forms in released/submitted, assessments with readReleased).

- [ ] Failing tests: Review Focus 1, 2, 3; state machine (release only from draft, withdraw only from released, reopen only from submitted, employee save only in released, submit only from released); Leitung edits any time; employee of another facility; left employee: no release (409 `employee_inactive`); terminal 403 → implement → pass → commit `feat: staff talks with released self-assessments`.

### Task 4: UI, print, docs

**Files:** `app/utils/settingsAreas.ts` (new area `forms` „Bögen“ with section `form-templates`; update its test), `app/pages/admin/settings/[area].vue` wiring, Create `app/components/forms/TemplateEditor.vue` (list per kind, create/copy/rename/archive/delete; editor with sections and items, arrows, add item by kind, inline texts, choices options editor), `app/components/forms/FormFiller.vue` (renders a snapshot + answers; modes edit/read; rating as three toggle buttons + remark; milestones grouped by ageLabel; choices as checkbox chips; date via DateTextInput; autosave on blur or a „Speichern“ button — choose explicit „Speichern“ with unsaved-changes hint), employee detail tab „Gespräche“ in `app/pages/admin/employees/[id].vue` (list, create dialog with template multi-select preselecting starters, per form: state badge and the release/withdraw/reopen/read-release buttons, open/print), page `app/pages/my/talks/index.vue` and `[formId].vue` („Meine Gespräche“: fill + „Abgeben“ with confirm; read-only for submitted/assessments), `app/utils/navMenu.ts` („Meine Gespräche“ under „Meins“ for managers with employee, and in the staff menu; update its test), print page `app/pages/admin/print/forms/[formId].vue` and employee-readable print via the same page with a my-route fetch (PDF path allow-list in `server/utils/pdf.ts`), `app/locales/de.ts`, `docs/BETRIEB.md` „## 25. Bögen und Mitarbeitergespräche“.

- [ ] Implement → `npm test`, typecheck, build; headless check 375 px and desktop: edit a template (add/move/delete item), create a talk with both starters, release self-assessment, log in as the employee (PREVIEW_OBSERVER_* in .env is linked to an employee — check) and fill + submit, read-release the assessment, print both → commit `feat: forms builder and staff talks UI`.

### Task 5: Controller check (no implementer)

- [ ] Scratch copy: Review Focus 1–3 in the browser; prints A4 portrait match the .docx structure; another employee sees nothing.
