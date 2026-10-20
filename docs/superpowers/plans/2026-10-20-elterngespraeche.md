# Elterngespräche – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parent meetings per child (date, time, type, participants, confidential note) in the child record, an overview sub-tab with all children's meetings, and planned meetings in the reminders box on their day.

**Architecture:** A new table and a small service with the record-section rights (`requireChildEditor(` + group write right); the note is only delivered to and accepted from Leitung/Träger. The child record DTO and the children overview DTO carry the meetings; the reminders service gets a new kind `meeting`. UI: a record section, an overview sheet, a reminder text.

**Tech Stack:** Nuxt 4, Nitro, drizzle-orm + better-sqlite3, Nuxt UI 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-elterngespraeche-design.md`

## Global Constraints

- UI German, informal "du"; code, identifiers, comments, commits English. No Docker/CI changes.
- Never run `npm install`/`npm ci`. Never kill processes by image name; stop only processes you started (by PID). Port 3000 is the controller's dev server — own checks on 127.0.0.1:3100 with `DATABASE_PATH` on a scratch DB copy.
- Branch `claude/parent-meetings`, started from the branch with the facility capacity change; the migration is the next free number (`npx drizzle-kit generate --name parent_meetings`), journal `when` later than the previous one.
- Meeting: `date` IsoDate; `start` minutes 0–1439 (required); `end` minutes or null, > start (else 400 `meeting_end_invalid`: „Das Ende muss nach dem Beginn liegen.“); `kind` ∈ `development` „Entwicklungsgespräch“, `settling_in` „Eingewöhnung“, `final` „Abschlussgespräch“, `other` „Sonstiges“ (else 400 `meeting_kind_invalid`); `participants` trimmed ≤ 200 chars; `note` trimmed ≤ 2000 chars (else 400 `meeting_text_too_long`: „Der Text ist zu lang.“).
- Planned = `date` after today (Berlin), or today with `start` later than now (Berlin minutes).
- Rights: create/update/delete like the other record sections (`requireChildEditor(` and `loadEditableChild`: 403 `group_read_only`, 404 hidden, 409 archived); unknown or other facility's meeting → 404 `meeting_not_found` („Dieses Gespräch gibt es nicht.“).
- Note: delivered only to Leitung/Träger (`isManager`); for everyone else the field is absent in every DTO (record, overview). A note sent by a non-manager → 403 `meeting_note_managers_only` („Notizen zu Elterngesprächen können nur Leitung und Träger eintragen.“); a non-manager update without `note` keeps the stored note.
- Who entered/changed: user id / employee id / name (tablet person without account by name) and timestamp, like the other sections; changes go into the record's change history the way the other sections log.
- Overview sheet `meetings` („Elterngespräche“, after „Telefonnummern“): columns „Letztes Gespräch“ („‹TT.MM.JJJJ› ‹Art›“), „Nächstes geplant“ („‹TT.MM.JJJJ› ‹hh:mm› ‹Art›“), „Alle Gespräche“ (lines „‹TT.MM.JJ› ‹Art›“, newest first), „Anzahl“.
- Reminder kind `meeting`: only on the meeting's date, text „Elterngespräch ‹Name› heute ‹hh:mm› (‹Art›)“; visibility like the other child reminders (own group; Leitung/Träger all); no „Erledigt“.
- Tests: `npx vitest run <file>`; all: `npm test`; types: `npm run typecheck`; build: `npm run build`.

## Review Focus

1. A staff member at the tablet never receives a note — record, overview and any list — even for a meeting created by Leitung with a note. → Task 1 test (record) and Task 2 test (overview).
2. A staff member edits a meeting that has a note: the note stays unchanged. → Task 1 test.
3. A meeting today at 14:00 is „planned“ at 13:59 and not at 14:01; the reminder shows all day on that date. → Task 1/2 tests.
4. Read-only granted group: meetings visible in the record (without note), no create/update/delete (403). → Task 1 test.
5. Deleting a child (archive purge) removes its meetings (cascade). → Task 1 db test.

---

### Task 1: Data, service and record DTO

**Files:**
- Modify: `server/db/schema.ts`; Create: migration (generated)
- Create: `server/services/parentMeetings.ts`, routes `server/api/children/[id]/meetings.post.ts`, `server/api/children/meetings/[id].put.ts`, `server/api/children/meetings/[id].delete.ts`
- Modify: `server/services/children.ts` (`getChild` → `meetings`), `server/schemas.ts`, `shared/types/api.ts`, `app/locales/de.ts` (error texts), permissions route list
- Test: `tests/services/parentMeetings.test.ts`, `tests/services/db.test.ts`, `tests/api/permissions.test.ts`

**Interfaces:**
- Produces:
  - Table `child_parent_meetings` (`id`, `child_id` → children cascade, `date`, `start`, `end` null, `kind`, `participants` default '', `note` default '', `created_at`, `created_by_user_id` set null, `created_by_employee_id` set null, `created_by_name`, `updated_at` null, `updated_by_name` null); index on `child_id`.
  - `type MeetingKind = 'development' | 'settling_in' | 'final' | 'other'`; `ParentMeetingDto { id; date; start; end: Minutes | null; kind: MeetingKind; participants: string; note?: string /* managers only */; planned: boolean; createdByName; createdAt; updatedByName: string | null; updatedAt: string | null }`; `ParentMeetingInput { date; start; end: Minutes | null; kind; participants: string; note?: string }`.
  - `addMeeting(db, viewer, childId, input, now)`, `updateMeeting(db, viewer, meetingId, input, now)`, `deleteMeeting(db, viewer, meetingId, now)`, `meetingsOf(db, viewer, childId, now): ParentMeetingDto[]` (newest first by date, start).
  - `ChildRecordDto.meetings: ParentMeetingDto[]`, `ChildRecordDto.canEditMeetings: boolean`.
- [ ] **Step 1: Failing tests:** validation and error codes; rights incl. Review Focus 2, 4; note handling (Review Focus 1 for the record); planned flag (Review Focus 3); cascade (Review Focus 5); who entered/changed; permissions list.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** focused files, `npm test`, `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: parent meetings in the child record (data and service)`.

### Task 2: Overview sheet data and reminders

**Files:**
- Modify: `server/services/children.ts` (`childrenOverview` rows get `meetings` without note), `shared/types/api.ts`, `server/services/reminders.ts` (kind `meeting`), `shared/domain/reminders.ts` (sort: `meeting` after `doc`, before birthdays)
- Test: `tests/services/childrenOverview.test.ts`, `tests/services/reminders.test.ts`, `tests/domain/reminders.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `ChildrenOverviewRowDto.meetings: { date; start; kind; planned }[]` (newest first); `ReminderKind` gains `'meeting'`; `ReminderDto` gains `time: Minutes | null` and `meetingKind: MeetingKind | null`.
- [ ] **Step 1: Failing tests:** overview rows carry meetings and never a note (Review Focus 1); reminder only on the meeting's date, for own group, Leitung all, read-only group none; sort position.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** focused files, `npm test`, `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: parent meetings in the overview and the reminders`.

### Task 3: UI and docs

**Files:**
- Create: `app/components/children/ChildMeetingsSection.vue`
- Modify: `app/pages/children/[id].vue`, `app/utils/childrenOverview.ts` (sheet `meetings` with the four columns; unit tests in `tests/domain/childrenOverview.test.ts`), print page sheet list, `app/components/children/RemindersBox.vue` (meeting text), `app/locales/de.ts`, `docs/BETRIEB.md`
- [ ] **Step 1: Record section** „Elterngespräche“: list newest first with „geplant“ marker and „eingetragen von … am …“; form „Gespräch eintragen“ / „Ändern“ (date default today, time from/to, kind select, participants, note only when `isManager`); delete with confirm; buttons ≥ 44px; existing busy/toast/error patterns.
- [ ] **Step 2: Overview sheet** and print (failing helper tests first).
- [ ] **Step 3: Reminder text** in the box.
- [ ] **Step 4: Docs** BETRIEB.md: Elterngespräche (who enters, confidential note, overview, reminder).
- [ ] **Step 5: Run** `npm test`, `npm run typecheck`, `npm run build`; headless check on 127.0.0.1:3100 — Expected: PASS.
- [ ] **Step 6: Commit** `feat: parent meetings section, overview sheet and reminder`.

### Task 4: Controller check (no implementer)

- [ ] On a scratch copy: Leitung enters a past and a planned meeting with note; staff at the tablet sees both without note, edits participants, note unchanged; overview sheet; reminder on the meeting day.
