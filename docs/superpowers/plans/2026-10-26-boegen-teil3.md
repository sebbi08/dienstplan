# Bögen Teil 3 (Teamsitzungen) – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Team meeting minutes built from the facility's `team` templates: every member of the facility (staff accounts, Leitung, Träger, the facility's tablet) can create a meeting and write its minutes while it is a draft; Leitung/Träger release it (then locked, readable for all) or reopen it with a reason; printable A4 portrait.

**Architecture:** Reuses Teil 1/2: a `forms` row (kind `team`) with snapshot and answers per meeting; new table `team_meetings` in migration `0057_team_meetings`; starter „Teamsitzung“ seeded per key; service `server/services/teamMeetings.ts`; routes `server/api/team-meetings/…`; pages `/team-meetings` and `/team-meetings/[id]` reusing the generalised form panel; print page.

**Tech Stack:** Nuxt 4, Nitro, drizzle-orm + better-sqlite3, Nuxt UI 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-boegen-design.md` §5, §6, §7 (Teamsitzung)

## Global Constraints

- UI German, informal „du“; code English. No new npm dependencies. Never `npm install`/npx downloads (drizzle-kit is local). Never kill processes by image name; only own PIDs. Port 3000 and `.data/app.db` untouched; own checks on 127.0.0.1:3100 with scratch copies. Never read the user's Nextcloud folder.
- Branch `claude/forms` (Teil 2 at `59f2c50`, newest migration `0056_child_forms` — do not edit earlier migrations). One new migration `0057_team_meetings`.
- Table `team_meetings`: id, facility_id (FK cascade), group_id (nullable FK groups, ON DELETE SET NULL), form_id (FK forms cascade, unique), date (ISO), start (minutes|null), participants (≤ 300), recorder (Protokollführung, ≤ 80), state `'draft' | 'released'`, released_at, released_by (name text), reopen_reason (≤ 200, last reopen), reopened_at, reopened_by, created_at, created_by (name text).
- Starter key `team_meeting` „Teamsitzung“ (kind `team`): sections „Tagesordnung“, „Themen und Ergebnisse“, „Vereinbarungen und Aufgaben (wer, was, bis wann)“, „Termine“, „Sonstiges“ — each one `text` item with the same question text as the section title. Seeded via `form_starter_seeds` like the other starters (existing facilities get it once; new facilities with all).
- **Who:** members of the facility = Leitung/Träger in their active facility, Mitarbeiter accounts whose employee belongs to the facility (`user.facilityId`), and the facility's tablet account (`terminal`, no unlock needed — no child data). Others → 404/403 as usual.
  - List/read: all members, drafts and released.
  - Create, edit header and answers: all members while `draft`; `released` → 409 `team_meeting_released`.
  - Release, reopen (reason 1–200 required), delete (confirm): Leitung/Träger only (403 for others).
- `updated_by` / `created_by`: user name text; at the tablet „Tablet“ (the tablet account's display name). Saves take `expectedUpdatedAt` → 409 `form_changed`; answers validated against the snapshot.
- Template choice: active `team` templates of the facility; the list route returns them (the tablet and staff cannot read `/api/form-templates`).
- Group: optional, a group of the facility; filter on the list page (Alle / Einrichtung / each group).
- Print: A4 portrait (`@page { size: A4 portrait !important; margin: 12mm !important; }`) via the shared `FormPrint` with a team header (Datum, Uhrzeit, Gruppe/Einrichtung, Teilnehmer, Protokollführung) and the footer „freigegeben am … von …“ or „Entwurf – noch nicht freigegeben“; available to managers and staff accounts (not the tablet, which cannot reach /print); PDF path allow-list.
- Menu: managers „Teamsitzungen“ under „Mehr“; Mitarbeiter: an entry „Teamsitzungen“ (check the header still fits at 375 px / 1024 px — if not, group „Meine Termine“, „Meine Gespräche“ under a „Meins“ dropdown for staff like managers have); tablet: a third entry „Teamsitzungen“ next to „Stempeln“ and „Dienstplan“.
- Tests: `npx vitest run <file>`; all `npm test`; types `npm run typecheck`; build `npm run build`.

## Review Focus

1. A Mitarbeiter writes in a draft, the Leitung releases; the Mitarbeiter's next save → 409 team_meeting_released, the text stays readable; Leitung reopens with reason → the Mitarbeiter can write again; the reason shows. → Task 1 test.
2. A Mitarbeiter of facility B or a tablet of facility B opens a meeting of facility A → 404. → Task 1 test.
3. A Mitarbeiter tries release/reopen/delete → 403. → Task 1 test.
4. Two people save the same draft → the second gets 409 form_changed. → Task 1 test.
5. The tablet creates a meeting and writes; created_by/updated_by „Tablet“. → Task 1 test.

---

### Task 1: Data, starter, service, routes

**Files:** schema + migration `0057_team_meetings`; `shared/domain/forms/starters.ts` (team starter); seeding in `server/services/formTemplates.ts`; Create `server/services/teamMeetings.ts`; routes `server/api/team-meetings/index.get.ts` (?year, ?groupId; returns meetings + templates + groups + `canManage`), `index.post.ts`, `[id].get.ts`, `[id].put.ts` (header + answers, expectedUpdatedAt), `[id].delete.ts`, `[id]/release.post.ts`, `[id]/reopen.post.ts` (reason); DTOs; German texts; `tests/api/permissions.test.ts` (routes for all members: `requireUser(` with `allowTerminal` — add a new allowed list in the permissions test if needed, e.g. MEMBER_ROUTES); Tests `tests/services/teamMeetings.test.ts`, seeding test, `db.test.ts` 0057.

- [ ] Failing tests: Review Focus 1–5; template must be active kind team of the facility; group of another facility rejected; validation limits → implement → `npm test`, typecheck → commit `feat: team meetings with release by Leitung/Träger`.

### Task 2: UI, menu, print, docs

**Files:** `app/pages/team-meetings/index.vue` (list per year, newest first, group filter, state badge Entwurf/Freigegeben, „Sitzung anlegen“ dialog: template, date via DateTextInput, start, participants, recorder, group), `app/pages/team-meetings/[id].vue` (header edit while draft, shared form panel edit/read by state, release / reopen-with-reason / delete for managers, „freigegeben am … von …“, last reopen reason, print link), `app/utils/navMenu.ts` (+ test), auth middleware for the new pages (members incl. tablet), print page `app/pages/print/team-meetings/[id].vue`, `app/locales/de.ts`, `docs/BETRIEB.md` (extend „## 25.“ with Teamsitzungen).

- [ ] Implement → `npm test`, typecheck, build; headless check: Mitarbeiter creates and writes, Leitung releases (Mitarbeiter read-only), reopens with reason; tablet creates/writes; 375 px and desktop; print → commit `feat: team meeting pages, menu and print`.

### Task 3: Controller check (no implementer)

- [ ] Scratch copy: Review Focus 1–5 in the browser; menus for Leitung, Mitarbeiter, tablet; print.
