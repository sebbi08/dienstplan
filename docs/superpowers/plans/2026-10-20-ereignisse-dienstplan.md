# Ereignisse im Dienstplan und Jahreskalender – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatic, anonymous day events (Eingewöhnung, Elterngespräch, Kindergeburtstag, Mitarbeiter-Geburtstag) shown in the plan's „Info“ area and the year calendar's appointments row, everywhere these views are visible, including the released plan staff see on their phones.

**Architecture:** A server function computes, for a facility and a date range, the events per day as plain texts without child ids or names. The plan DTO (draft and the released/snapshot views) and the year-calendar DTO get `autoEvents` per day, added at read time (never stored in releases, notes or snapshots). The UI renders them read-only before/after the own entries.

**Tech Stack:** Nuxt 4, Nitro, drizzle-orm + better-sqlite3, Nuxt UI 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-ereignisse-dienstplan-design.md`

## Global Constraints

- UI German, informal "du"; code, identifiers, comments, commits English. No migration.
- Never run `npm install`/`npm ci`. Never kill processes by image name; stop only processes you started (by PID). Port 3000 is the controller's dev server — own checks on 127.0.0.1:3100 with `DATABASE_PATH` on a scratch DB copy.
- Branch starts after the parent-meetings branch (meetings table exists).
- Texts exactly: „Eingewöhnung (‹Gruppe›)“, „Elterngespräch ‹h:mm› (‹Gruppe›)“, „Kindergeburtstag (‹Gruppe›)“, „Geburtstag ‹Name›“; without group the parenthesis is left out; several equal child events of a day and group: „‹n›× Kindergeburtstag (‹Gruppe›)“ / „‹n›× Eingewöhnung (‹Gruppe›)“; meetings one line per time and group („2× Elterngespräch 14:00 (Bären)“ when two at the same time).
- Group = the child's group on that day (group history), only groups of the facility.
- Eingewöhnung: the child's `entryDate` (not planned entry, not waitlist). Kindergeburtstag: children active on that day (29 Feb → 28 Feb in non-leap years). Elterngespräch: every meeting on that day (planned or past). Staff birthday: employees of the facility not left before that day, with `birthday` (MM-DD, 29 Feb rule).
- No child id, child name or meeting note in any DTO (assert on serialized DTOs, incl. the staff phone views).
- Releases, snapshot diffs, notifications and revert ignore the auto events (they are not part of `SnapshotData`).
- Order inside a day: own Info texts first, then auto events in the order Eingewöhnung, Elterngespräch (by time), Kindergeburtstag, Geburtstag (by name).
- Tests: `npx vitest run <file>`; all: `npm test`; types: `npm run typecheck`; build: `npm run build`.

## Review Focus

1. A staff member's phone view of a released month shows today's auto events (computed live), and the release diff/notification for that month is unchanged. → Task 1 test.
2. A child who changes group mid-month: its birthday shows the group of that day. → Task 1 test.
3. A child who left before its birthday: no event. → Task 1 test.
4. Serialized plan and calendar DTOs for an observer contain no child name or id. → Task 1 test.
5. Print of plan and year calendar shows the events. → Task 2 (headless check).

---

### Task 1: Events service and DTOs

**Files:**
- Create: `server/services/autoEvents.ts`
- Modify: `server/services/plan.ts` (draft plan and the views that serve released months/snapshots to observers — find where `SnapshotDayDto`/`DayRowDto` are produced for each view), `server/services/calendar.ts` (`getYearCalendar` and the staff variant), `shared/types/api.ts` (`DayRowDto.autoEvents: string[]`, `SnapshotDayDto` view type gains `autoEvents` at read time without changing stored snapshots; `YearCalendarDto.autoEvents: Record<IsoDate, string[]>`)
- Test: `tests/services/autoEvents.test.ts`, plus extensions of the plan/calendar tests

**Interfaces:**
- Produces: `autoEventsFor(db: Db, facilityId: number, from: IsoDate, to: IsoDate): Map<IsoDate, string[]>`.
- [ ] **Step 1: Failing tests:** each event kind and text, grouping/counting, group of the day, left child, staff left, 29 Feb, order; Review Focus 1–4.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** focused files, `npm test`, `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: automatic day events for plan and calendar (data)`.

### Task 2: UI, print and docs

**Files:**
- Modify: the plan grid's Info cells (`app/components/plan/PlanGrid.vue` and the staff plan view under `app/pages/my/plan`), the year calendar (`app/components/calendar/CalendarMonth.vue` appointments row), their print pages, `app/locales/de.ts` if needed, `docs/BETRIEB.md`
- [ ] **Step 1:** Render `autoEvents` read-only (small, grey-italic or with a small icon; not editable, not part of the Info input) after the own Info texts; in the calendar appointments row after the own appointments, using the existing lane layout.
- [ ] **Step 2:** Print pages the same.
- [ ] **Step 3:** Docs: BETRIEB.md — automatic events, no child names, visible everywhere incl. phones, staff birthdays with name.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run build`; headless check on 127.0.0.1:3100 — Expected: PASS.
- [ ] **Step 5: Commit** `feat: automatic day events in plan, calendar and print`.

### Task 3: Controller check (no implementer)

- [ ] Scratch copy: a child with entry date this month, a meeting, a child birthday, a staff birthday; check admin plan, staff phone plan (released month), year calendar, prints — no child names anywhere.
