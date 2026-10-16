# Öffnungszeiten je Wochentag – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opening/closing times per weekday per facility (optionally per group), mandatory duties (Pflichtdienste) limited to chosen weekdays, and an edge warning when too few staff are planned at opening or until closing.

**Architecture:** Pure rules in `shared/domain/warnings.ts` (plus a small `shared/domain/openingHours.ts`) get the day's opening hours and check weekday-limited coverage rules and the new edge warnings. The server stores hours in a new table, extends coverage rules with a weekday mask, and passes everything into the existing `dayWarnings` call in `server/services/plan.ts`. Settings UI for hours and weekday ticks; the plan shows the day's hours.

**Tech Stack:** Nuxt 4, Nitro, drizzle-orm + better-sqlite3, Nuxt UI 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-16-oeffnungszeiten-design.md`

## Global Constraints

- UI German, informal "du"; code, identifiers, comments, commits English. No Docker/CI changes.
- Never run `npm install`/`npm ci`. Never kill processes by image name; stop only processes you started (by PID). Port 3000 is the controller's dev server — use `--port 3100` and a scratch database copy for own checks.
- Branch `claude/opening-hours`; newest migration is `0037_group_book`. The new migration is generated with `npx drizzle-kit generate --name opening_hours` as `0038_opening_hours`; its journal `when` must be later than 0037's.
- Weekdays Mo–Fr = 0–4 (`weekday()` in `shared/domain/dates.ts`, Monday = 0). Weekday mask bits: Mo = 1, Di = 2, Mi = 4, Do = 8, Fr = 16; all = 31 (existing rules get 31).
- Opening hours per weekday: `open`/`close` minutes or `closed`; both null and not closed = not entered (no edge warning, rules checked as before). Close must be after open (400 `opening_hours_invalid`: „Die Schließzeit muss nach der Öffnungszeit liegen.“). Minimum counts 1–20, default 1 (400 `opening_min_invalid`: „Die Mindestzahl muss zwischen 1 und 20 liegen.“).
- Edge coverage: at opening = duties (work entries that count as staff, same as coverage rules count) with `start <= open && end > open`; until closing = `start < close && end >= close`. Facility: all duties of the plan incl. helpers; a group with own hours: only duties whose effective group (entry group, else the employee's home group) is that group.
- Not checked: weekend, facility holidays, closure days, weekdays without entered hours, `closed` weekdays (a closed weekday also suppresses coverage rules: facility rules by facility hours, group rules by the group's hours if it has own hours, else the facility's).
- With nothing entered, every existing warning stays identical (existing tests stay green).
- Rights: Leitung and Träger (`requireAdmin(`), active facility; a group of another facility → 404 `group_not_found`.
- Tests: `npx vitest run <file>`; all: `npm test`; types: `npm run typecheck`; build: `npm run build`.

## Review Focus

1. A night or split duty (break entries, codes) — only work entries counting as staff count for the edge warnings, like coverage rules. → Task 1 test.
2. A group with own hours that are later than the facility's — the facility edge warning still counts that group's staff for the facility; the group warning only its own. → Task 1 test.
3. A weekday entered as closed while rules exist for that weekday — no warnings at all that day (rules and edges), staff missing-entry warnings unchanged. → Task 1 test.
4. Editing a coverage rule from an old client without `weekdays` keeps the stored mask (or all for new). → Task 2 test.
5. A facility deleted or a group deleted removes its hours (cascade). → Task 2 test.

---

### Task 1: Rules (domain)

**Files:**
- Create: `shared/domain/openingHours.ts`
- Modify: `shared/domain/warnings.ts`, `shared/types/api.ts` (if DTO types live there)
- Test: `tests/domain/openingHours.test.ts`, `tests/domain/warnings.test.ts` (extend)

**Interfaces:**
- Produces:
  - `shared/domain/openingHours.ts`: `interface DayHours { open: Minutes | null; close: Minutes | null; closed: boolean }`; `interface OpeningHours { days: DayHours[] /* length 5, Mo–Fr */; minAtOpening: number; minAtClosing: number }`; `WEEKDAY_BITS = [1, 2, 4, 8, 16]`, `ALL_WEEKDAYS = 31`; `hoursOn(hours: OpeningHours | null, date: IsoDate): DayHours | null` (null on weekend/no hours); `isEntered(day: DayHours | null): boolean` (open and close set, not closed); `ruleAppliesOn(weekdays: number, date: IsoDate): boolean`.
  - `CoverageRule` gains `weekdays: number` (mask).
  - `Warning` gains `| { type: 'edge'; date: IsoDate; edge: 'opening' | 'closing'; time: Minutes; found: number; required: number; groupName?: string }`.
  - `dayWarnings(date, employees, rules, isClosureDay, holidays, hours: { facility: OpeningHours | null; groups: { groupId: number; groupName: string; hours: OpeningHours }[] })` — the new last parameter; existing behaviour unchanged when `facility` is null and `groups` empty and every rule has `weekdays: 31`.
- [ ] **Step 1: Failing tests:** `ruleAppliesOn` for each bit; a rule with Mo–Do not checked on Friday; a closed facility weekday → no coverage warnings, missing-entry warnings unchanged; a group rule on a weekday closed only for its group (group has own hours) → not checked; edge opening 7:00: duty 7:00–12:00 counts, 7:15–… does not, 6:00–7:00 does not; closing 16:30: duty until 16:30 counts, until 16:00 does not, starting 16:30 does not; min 2 with one duty → warning found 1 required 2; group with own hours counts only its effective-group duties (entry group, else home group); helpers count for the facility edge; break/code entries never count; weekend/holiday/closure day/not entered → no edge warning; no hours + all rules mask 31 → identical to today (existing tests).
- [ ] **Step 2: Run** `npx vitest run tests/domain/openingHours.test.ts tests/domain/warnings.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** (reuse the coverage rule's "counts as staff work entry" predicate).
- [ ] **Step 4: Run** the files and `npm run typecheck` (callers of `dayWarnings` pass `{ facility: null, groups: [] }` for now; coverage rules from the DB get `weekdays: 31` until Task 2 adds the column — or Task 1 adds the field as optional defaulting to all; pick one and say so) — Expected: PASS.
- [ ] **Step 5: Commit** `feat: opening hours, weekday rules and edge warnings (domain)`.

### Task 2: Data, settings service and plan wiring

**Files:**
- Modify: `server/db/schema.ts`, Create: `server/db/migrations/0038_opening_hours.sql` (+ journal/snapshot, generated)
- Create: `server/services/openingHours.ts`, routes `server/api/opening-hours.get.ts`, `server/api/opening-hours.put.ts`, `server/api/groups/[id]/opening-hours.put.ts`
- Modify: `server/services/settings.ts` (coverage rule create/update with `weekdays`), `server/services/queries.ts` (`loadCoverageRules`), `server/schemas.ts` (`coverageRuleSchema.weekdays` optional, int 1–31), `server/services/plan.ts` (hours into `dayWarnings`; day DTO gets the facility's hours of the day and groups' own hours for the plan header), `shared/types/api.ts`, `app/locales/de.ts` (error texts)
- Test: `tests/services/openingHours.test.ts`, `tests/services/plan.test.ts` (or the existing plan warning tests), `tests/services/settings.test.ts`, `tests/services/db.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - Schema: `openingHours` (`opening_hours`: `id`, `facilityId` cascade, `groupId` → groups cascade null, `weekday` 0–4, `open` int null, `close` int null, `closed` bool default false; unique (`facility_id`, `group_id`, `weekday`) — note SQLite unique with null group: use a partial unique index or treat facility rows with `group_id IS NULL` via a separate unique index); `facilities.minAtOpening`/`minAtClosing` and `groups.minAtOpening`/`minAtClosing` (int not null default 1); `coverageRules.weekdays` (int not null default 31).
  - `OpeningHoursDto { facility: OpeningHours | null; groups: { groupId; groupName; hours: OpeningHours | null }[] }`.
  - Service: `getOpeningHours(db, facilityId): OpeningHoursDto`; `setFacilityOpeningHours(db, facilityId, input: OpeningHours | null)`; `setGroupOpeningHours(db, facilityId, groupId, input: OpeningHours | null)` (null = remove own hours); validation per Global Constraints.
  - Routes `requireAdmin(` (default rule in the permissions test).
  - Plan: `dayWarnings` receives the facility's and groups' hours; `PlanDayDto` gains `opening: DayHours | null` and `groupOpening: Record<number, DayHours>` (only groups with own entered hours).
- [ ] **Step 1: Failing tests:** store and read facility and group hours; invalid close ≤ open → `opening_hours_invalid`; min 0/21 → `opening_min_invalid`; group of another facility → `group_not_found`; group hours removed with null; cascade on group/facility deletion; coverage rule create/update with `weekdays` and update without it keeps the stored mask; plan warnings: Friday rule excluded by mask, edge warning appears with entered hours and not without; db test for 0038 (defaults: existing rules 31, mins 1, no hours).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: opening hours per facility and group, weekday mandatory duties`.

### Task 3: Settings UI, plan header, warning texts

**Files:**
- Create: `app/components/settings/OpeningHoursSection.vue`
- Modify: `app/pages/admin/settings.vue` (section after „Pflichtdienste“; Pflichtdienst form gets weekday checkboxes Mo–Fr, at least one), `app/utils/warnings.ts` (text for `edge`), `app/locales/de.ts`, the plan day header component (find where `holidayKey` is shown in `app/components/plan/PlanGrid.vue`), `docs/BETRIEB.md`

**Interfaces:**
- Consumes: Task 2 routes/DTOs.
- [ ] **Step 1: Section „Öffnungszeiten“** for managers: table Mo–Fr (Öffnung, Schließung, „geschlossen“), „Mindestens zur Öffnung“, „Mindestens bis zur Schließung“; below per group a collapsible „Eigene Öffnungszeiten“ with the same table (empty = use the facility's; button „Eigene Zeiten entfernen“). Save with the existing toast pattern; German errors from `de.errors`.
- [ ] **Step 2: Pflichtdienste:** weekday checkboxes Mo–Fr in the rule form (new rules all ticked; at least one), the rule list shows the weekdays when not all („Mo–Do“, „Fr“).
- [ ] **Step 3: Plan:** day header shows „7:00–16:30“ / „geschlossen“ small; groups with own hours show theirs in the group block header.
- [ ] **Step 4: Warnings:** `edge` text „‹hh:mm› Öffnung: niemand eingeplant“ / „‹n› von ‹N› eingeplant“ (and „Schließung“), with group name like coverage warnings.
- [ ] **Step 5: Docs:** BETRIEB.md section „Öffnungszeiten und Pflichtdienste“.
- [ ] **Step 6: Run** `npm test`, `npm run typecheck`, `npm run build`; headless check on port 3100 — Expected: PASS.
- [ ] **Step 7: Commit** `feat: opening hours settings, weekday ticks and plan header`.

### Task 4: Controller check (no implementer)

- [ ] On the controller's dev server (preview copy): enter Mo–Do 7:00–16:30, Fr 7:00–14:00 for the facility; a Pflichtdienst only Mo–Do; plan a week with a gap at Friday closing → edge warning; Friday rule not checked; a closed weekday suppresses warnings; group with own hours; BW facility without hours unchanged. Record results.
