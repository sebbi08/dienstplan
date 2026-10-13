# Platzplanung (Vormerkungen, Belegung, Gruppenwechsel, Schulkinder) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place planning on top of the child records: admission status (Vormerkung/Vertrag) with its own overview, monthly occupancy per Kita year with capacities, planned group changes with "confirm again" markers, and school children (cutoff rule, automatic leaving, after-school groups).

**Architecture:** Pure domain modules compute school start, a child's stay and its group stays and the monthly cells; services only load rows and feed them in. A `child_group_changes` table is the group history (one start row per child plus dated changes); `children.group_id` stays the current group and is maintained when changes are applied. The existing daily job in the database plugin applies due group changes and then lets school children leave. Review markers are nullable dates on `children`.

**Tech Stack:** Nuxt 4, Nitro, drizzle-orm + better-sqlite3, drizzle-kit, zod, vitest, Nuxt UI 4.

**Spec:** [docs/superpowers/specs/2026-10-13-belegung-vormerkungen-gruppenwechsel-design.md](../specs/2026-10-13-belegung-vormerkungen-gruppenwechsel-design.md)

## Global Constraints

- UI German, informal "du"; code, identifiers, comments, commits English. No Docker/CI changes. `node_modules` is a junction — never `npm install`. Never kill processes by image name.
- Branch `claude/kinderakte`; newest migration is `0026_child_key_educator`. Every new migration is generated with `npx drizzle-kit generate --name <name>` as the next number; its journal `when` must be later than the previous entry (drizzle skips older ones). Hand-edit SQL only for data backfills and for `ON DELETE` clauses drizzle-kit omits on `ALTER TABLE ADD`.
- Kita year `Y` = 1 September `Y` to 31 August `Y+1`, shown as `2026/27`. Months in order Sep…Aug.
- Counting rule: a child counts for group G in month M when one of its group stays in G contains at least one day of M; it is "fresh" (bracket) when that stay starts in M. Only children with `admission_status = 'contract'` and a contract start (`entry_date ?? planned_entry_date`) count.
- Stay end: `left_on`; else the day before the school start; open when the child is in a group for school children on its school start date.
- School start: manual `school_start_date`, else computed: 1 September of the first year `J` in which the child has reached `school_age_years` on or before `J-<cutoff month>-<cutoff day>`. Defaults: month 6, day 30, age 6. A 29 February birthday is reached on 28 February in non-leap years.
- Red: group cell when capacity is set and `present + fresh >= capacity`; total row when every group has a capacity and total ≥ sum of capacities; "ohne Gruppe" never.
- Guards: occupancy, capacities, group changes → `requireAdmin(`; cutoff, auto-leave switch, group flag "für Schulkinder" → `requireProvider(`; confirming sections → `requireChildEditor(`; planned lists and "Offen" → `requireChildReader(`. Every route is classified in `tests/api/permissions.test.ts`. Other facilities' rows answer 404 with the object's `*_not_found` code.
- Every new error code gets a German "du" text in `de.errors`.
- Tests: `npx vitest run <file>`; all: `npm test`; types: `npm run typecheck`.

## Review Focus

1. **A child that enters and leaves within one month** is counted once, in the bracket of that month, and nowhere afterwards. Pinned in Task 3.
2. **Bad dates** (school start or leaving date before the contract start; contract without any entry date) never crash the table: the child is not counted and, without a start, appears in the "ohne Eintrittsdatum" hint. Pinned in Tasks 3 and 4.
3. **Lowering a capacity below the current occupancy** shows red with "+n über Plätze" instead of rejecting the save. Pinned in Task 4.
4. **Switching on automatic leaving while after-school groups are not flagged yet**: the preview names exactly the children the job would deregister that day. Pinned in Task 9.
5. **A planned group change of a child that is deregistered before the change date** is removed and never applied. Pinned in Task 6.

---

## Stage 1 — Vormerkung / Vertrag

### Task 1: Admission status and planned lists

**Files:**
- Modify: `server/db/schema.ts`; create migration `0027_child_admission`
- Modify: `shared/domain/children.ts`, `shared/types/api.ts`, `server/schemas.ts`, `server/services/children.ts`, `server/lib/childRecord.ts` (if status is derived there), `tests/helpers/fixtures.ts`
- Create: `server/api/children/planned.get.ts`
- Test: `tests/domain/children.test.ts`, `tests/services/childAdmission.test.ts`, `tests/services/db.test.ts` (migration), `tests/api/permissions.test.ts`

**Interfaces:**
- Produces:
  - Columns `children.admission_status` (`'waitlist' | 'contract'`, NOT NULL default `'contract'`), `children.waitlisted_on` (nullable ISO)
  - `type AdmissionStatus = 'waitlist' | 'contract'`; `childStatus(child: { admissionStatus: AdmissionStatus; entryDate; leftOn }, today)` — `waitlist` → always `'planned'`
  - `ChildMasterInput` gains `admissionStatus: AdmissionStatus`, `waitlistedOn: IsoDate | null`
  - Validation: `admissionStatus === 'waitlist' && entryDate !== null` → 400 `waitlist_has_entry`; `waitlistedOn` is stored only for waitlist (else null; default today when omitted on create of a waitlist child)
  - `PlannedChildDto { id; lastName; firstName; birthDate; plannedStart: IsoDate | null /* entryDate ?? plannedEntryDate */; groupId: number | null; careTypeName: string | null; phone: string /* first contact by sort order: mobile, else home, else work, else '' */; note: string; waitlistedOn: IsoDate | null }`
  - `listPlanned(db, facilityId, today): { waitlist: PlannedChildDto[]; contracted: PlannedChildDto[] }` — waitlist sorted by `waitlistedOn` (null last) then name; contracted = contract children with status `planned`, sorted by `plannedStart` (null last) then name
  - `listChildren(…, 'planned', …)` is removed in favour of `listPlanned`; `GET /api/children?status=planned` is removed; `GET /api/children/planned` → `requireChildReader`
  - Leaving/archiving functions reject waitlist children: `leaveChild` → 400 `waitlist_cannot_leave`
  - Fixture `addChild` overrides gain `admissionStatus`, `waitlistedOn`

- [ ] **Step 1: Write failing tests**
  - domain: `childStatus({ admissionStatus: 'waitlist', entryDate: null, leftOn: null }, '2026-10-13')` → `'planned'`; a waitlist child with a past `plannedEntryDate` is still planned (service level: not in the active list, not in birthdays, not in the document overview).
  - service: `waitlist_has_entry`; switching waitlist → contract keeps the record and it moves to `contracted`; ordering of both lists (include null dates); `phone` picks mobile, then home, then work of the first contact; other facility's children absent; `waitlist_cannot_leave`; `deleteChild` by a manager removes a waitlist child.
  - migration: a database at `0026_child_key_educator` with a child → after migrating `admission_status = 'contract'`, `waitlisted_on` null.
- [ ] **Step 2: Run** the test files — Expected: FAIL
- [ ] **Step 3: Implement** schema, `npx drizzle-kit generate --name child_admission`, domain, services, route, permission list
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` — Expected: PASS / no errors (adapt the UI call of the removed `status=planned` minimally so typecheck passes; the real UI is Task 2)
- [ ] **Step 5: Commit** `feat: admission status and planned lists for children`

### Task 2: UI – "Vormerkungen & Verträge"

**Files:**
- Modify: `app/pages/children/index.vue` (tab replaces "Geplant"), `app/components/children/ChildMasterForm.vue`, `app/pages/children/new.vue`, `app/pages/children/[id].vue`, `app/locales/de.ts`
- Create: `app/components/children/PlannedTab.vue`, `app/pages/print/children/planned.vue`

**Interfaces:**
- Consumes: Task 1 API; `ageOn`; `useChildLookups`; `PrintActions`
- Produces (UI): tab with the two lists and the columns of spec §4 (age at planned start via `ageOn(birthDate, plannedStart)`), filters group and Kita year of the planned start, buttons "Vormerkung anlegen" (`/children/new?status=waitlist`) and "Kind anlegen"; master form field "Stand" (Vormerkung / Vertrag) and "Vorgemerkt am" (only for Vormerkung; `Eintritt` disabled for Vormerkung); record header badge "Vormerkung"; for managers on a waitlist record the button "Vormerkung löschen" (confirm); print page with both lists

Texts (use exactly):

```ts
children: { ..., tabs: { ..., planned: 'Vormerkungen & Verträge' },
  admission: { label: 'Stand', waitlist: 'Vormerkung', contract: 'Vertrag', waitlistedOn: 'Vorgemerkt am',
    waitlistTitle: 'Vormerkungen', contractedTitle: 'Künftige Kinder mit Vertrag', createWaitlist: 'Vormerkung anlegen',
    desiredStart: 'gewünschter Eintritt', contractStart: 'Vertragsbeginn', desiredGroup: 'gewünschte Gruppe', assignedGroup: 'zugesagte Gruppe',
    ageAtStart: 'Alter zum Eintritt', phone: 'Telefon', kitaYear: 'Kita-Jahr', allKitaYears: 'Alle Kita-Jahre',
    deleteWaitlist: 'Vormerkung löschen', confirmDeleteWaitlist: 'Vormerkung mit allen Angaben endgültig löschen?' },
},
errors: { ..., waitlist_has_entry: 'Eine Vormerkung hat noch keinen Eintritt. Trage den gewünschten Termin unter „geplanter Eintritt“ ein oder stelle den Stand auf „Vertrag“.',
  waitlist_cannot_leave: 'Eine Vormerkung kann nicht abgemeldet, nur gelöscht werden.' },
```

- [ ] **Step 1: Implement**
- [ ] **Step 2: Run** `npm run typecheck` and `npm test` — Expected: no errors / PASS
- [ ] **Step 3: Headless check** (dev server by own PID, scratch DB): create a waitlist child and a future contract child via the API; `/children` and `/print/children/planned` render both lists server-side. Report what was not checked.
- [ ] **Step 4: Commit** `feat: overview of waitlisted and contracted children`

---

## Stage 2 — School cutoff, capacities, occupancy

### Task 3: Domain – Kita year, school start, occupancy

**Files:**
- Create: `shared/domain/kitaYear.ts`, `shared/domain/schoolStart.ts`, `shared/domain/occupancy.ts`
- Test: `tests/domain/kitaYear.test.ts`, `tests/domain/schoolStart.test.ts`, `tests/domain/occupancy.test.ts`

**Interfaces:**
- Produces:
  - `kitaYearOf(date: IsoDate): number` (start year); `kitaYearLabel(startYear): string` (`'2026/27'`); `kitaYearMonths(startYear): { year: number; month: number }[]` (12 entries, Sep…Aug)
  - `interface SchoolCutoff { month: number; day: number; ageYears: number }`; `DEFAULT_SCHOOL_CUTOFF = { month: 6, day: 30, ageYears: 6 }`; `computedSchoolStart(birthDate: IsoDate, cutoff: SchoolCutoff): IsoDate`; `effectiveSchoolStart(manual: IsoDate | null, birthDate, cutoff): IsoDate`
  - `interface GroupEntry { from: IsoDate | null; groupId: number | null }` (history, any order; `from: null` = since the beginning)
  - `interface OccupancyChild { id: number; start: IsoDate | null; end: IsoDate | null; groups: GroupEntry[] }`
  - `interface GroupStay { groupId: number | null; from: IsoDate; to: IsoDate | null }`; `groupStays(child: OccupancyChild): GroupStay[]` — clipped to `[start, end]`, consecutive entries of the same group merged, empty when `start` is null or `end < start`
  - `interface CellEntry { childId: number; from: IsoDate; to: IsoDate | null }`; `groupCell(children: OccupancyChild[], groupId: number | null, year: number, month: number): { present: CellEntry[]; fresh: CellEntry[] }`
  - `facilityCell(children, year, month): { present: CellEntry[]; fresh: CellEntry[] }` — each child once; fresh = `start` in the month
  - `cellState(count: number, capacity: number | null): { red: boolean; over: number }` — `red = capacity !== null && count >= capacity`, `over = max(0, count - capacity)`

- [ ] **Step 1: Write failing tests**

```ts
// school start, cutoff 30 June / 6 years
expect(computedSchoolStart('2021-06-30', DEFAULT_SCHOOL_CUTOFF)).toBe('2027-09-01')
expect(computedSchoolStart('2021-07-01', DEFAULT_SCHOOL_CUTOFF)).toBe('2028-09-01')
expect(computedSchoolStart('2020-02-29', DEFAULT_SCHOOL_CUTOFF)).toBe('2026-09-01')
expect(computedSchoolStart('2021-09-30', { month: 9, day: 30, ageYears: 6 })).toBe('2027-09-01')
expect(effectiveSchoolStart('2028-09-01', '2021-06-30', DEFAULT_SCHOOL_CUTOFF)).toBe('2028-09-01')
// kita year
expect(kitaYearOf('2026-08-31')).toBe(2025); expect(kitaYearOf('2026-09-01')).toBe(2026)
expect(kitaYearLabel(2026)).toBe('2026/27')
expect(kitaYearMonths(2026)[0]).toEqual({ year: 2026, month: 9 }); expect(kitaYearMonths(2026)[11]).toEqual({ year: 2027, month: 8 })
// occupancy: one group (id 1) unless stated
const child = (id, start, end, groups = [{ from: null, groupId: 1 }]) => ({ id, start, end, groups })
const ids = (cell) => ({ present: cell.present.map(e => e.childId), fresh: cell.fresh.map(e => e.childId) })
// entry on 15 Oct: bracket in October, main from November
expect(ids(groupCell([child(1, '2026-10-15', null)], 1, 2026, 9))).toEqual({ present: [], fresh: [] })
expect(ids(groupCell([child(1, '2026-10-15', null)], 1, 2026, 10))).toEqual({ present: [], fresh: [1] })
expect(ids(groupCell([child(1, '2026-10-15', null)], 1, 2026, 11))).toEqual({ present: [1], fresh: [] })
// leaving on 15 March: counts in March, not in April
expect(ids(groupCell([child(1, '2025-09-01', '2027-03-15')], 1, 2027, 3)).present).toEqual([1])
expect(ids(groupCell([child(1, '2025-09-01', '2027-03-15')], 1, 2027, 4)).present).toEqual([])
// change on 15 March from group 1 to group 2
const mover = child(1, '2025-09-01', null, [{ from: null, groupId: 1 }, { from: '2027-03-15', groupId: 2 }])
expect(ids(groupCell([mover], 1, 2027, 3))).toEqual({ present: [1], fresh: [] })
expect(ids(groupCell([mover], 1, 2027, 4))).toEqual({ present: [], fresh: [] })
expect(ids(groupCell([mover], 2, 2027, 3))).toEqual({ present: [], fresh: [1] })
expect(ids(groupCell([mover], 2, 2027, 4))).toEqual({ present: [1], fresh: [] })
expect(ids(facilityCell([mover], 2027, 3))).toEqual({ present: [1], fresh: [] })
// Review Focus 1: enters and leaves within one month
expect(ids(groupCell([child(1, '2026-10-05', '2026-10-20')], 1, 2026, 10))).toEqual({ present: [], fresh: [1] })
expect(ids(groupCell([child(1, '2026-10-05', '2026-10-20')], 1, 2026, 11))).toEqual({ present: [], fresh: [] })
// Review Focus 2: no start, or end before start
expect(groupStays(child(1, null, null))).toEqual([])
expect(groupStays(child(1, '2026-10-05', '2026-09-30'))).toEqual([])
// month borders, change back to an earlier group, leap February
expect(ids(groupCell([child(1, '2026-10-31', null)], 1, 2026, 10)).fresh).toEqual([1])
expect(ids(groupCell([child(1, '2026-09-01', '2026-10-01')], 1, 2026, 10)).present).toEqual([1])
const back = child(1, '2025-09-01', null, [{ from: null, groupId: 1 }, { from: '2026-01-10', groupId: 2 }, { from: '2026-05-10', groupId: 1 }])
expect(ids(groupCell([back], 1, 2026, 5))).toEqual({ present: [], fresh: [1] })
expect(ids(groupCell([child(1, '2028-02-29', '2028-02-29')], 1, 2028, 2)).fresh).toEqual([1])
// red
expect(cellState(20, 20)).toEqual({ red: true, over: 0 }); expect(cellState(21, 20)).toEqual({ red: true, over: 1 })
expect(cellState(19, 20)).toEqual({ red: false, over: 0 }); expect(cellState(30, null)).toEqual({ red: false, over: 0 })
```

- [ ] **Step 2: Run** the three files — Expected: FAIL
- [ ] **Step 3: Implement** the three modules (no imports from `shared/types`)
- [ ] **Step 4: Run** `npm test` — Expected: PASS
- [ ] **Step 5: Commit** `feat: domain for Kita years, school start and occupancy`

### Task 4: Server – school cutoff, capacities, occupancy table

**Files:**
- Modify: `server/db/schema.ts`; create migration `0028_occupancy` (`groups.capacity`, `facilities.school_cutoff_month/day`, `facilities.school_age_years`)
- Modify: `server/services/groups.ts`, `server/services/children.ts`, `shared/types/api.ts`, `server/schemas.ts`
- Create: `server/services/schoolChildren.ts`, `server/services/occupancy.ts`, routes `server/api/children/occupancy.get.ts` (`?year=`), `server/api/groups/[id]/capacity.put.ts`, `server/api/school-settings.get.ts`, `server/api/school-settings.put.ts`
- Test: `tests/services/occupancy.test.ts`, `tests/services/schoolChildren.test.ts`, `tests/services/groups.test.ts`, `tests/services/db.test.ts`, `tests/api/permissions.test.ts`

**Interfaces:**
- Consumes: Task 3 domain; Task 1 `admissionStatus`
- Produces:
  - `GroupDto.capacity: number | null`; `setGroupCapacity(db, facilityId, groupId, capacity: number | null): void` — integer 1–200 or null, else 400 `invalid_capacity`; `PUT /api/groups/[id]/capacity` → `requireAdmin`
  - `SchoolSettingsDto { cutoffMonth: number; cutoffDay: number; ageYears: number }` (later tasks extend it); `getSchoolSettings(db, facilityId)`; `setSchoolCutoff(db, facilityId, input)` — a real calendar day (29 Feb allowed), `ageYears` 4–8, else 400 `invalid_school_cutoff`; `GET /api/school-settings` → `requireAdmin`; `PUT /api/school-settings` → `requireProvider` (facility via `requireFacility(event, user)`)
  - `ChildRecordDto.computedSchoolStart: IsoDate` (managers and Mitarbeiter alike)
  - `occupancyChildren(db, facilityId): { children: OccupancyChild[]; names: Record<number, string>; undated: { id: number; name: string }[] }` — contract children of the facility incl. archived ones; `end` = `leftOn ?? day before effectiveSchoolStart`; `groups` = `[{ from: null, groupId: child.groupId }]` (Task 6 replaces this with the history); `undated` = contract children without contract start
  - `OccupancyDto { year: number; label: string; months: { year: number; month: number }[]; rows: { groupId: number | null; name: string; capacity: number | null; cells: OccupancyCellDto[] }[]; total: { capacity: number | null; cells: OccupancyCellDto[] }; undated: { id: number; name: string }[] }` with `OccupancyCellDto { present: OccupancyNameDto[]; fresh: OccupancyNameDto[]; red: boolean; over: number }`, `OccupancyNameDto { id: number; name: string; from: IsoDate; to: IsoDate | null }`; the row with `groupId: null` ("ohne Gruppe") exists only when one of its cells is non-empty; `total.capacity` is null unless every group has one
  - `occupancyTable(db, facilityId, startYear: number): OccupancyDto` — year outside 2000–2100 → 400 `invalid_year`; `GET /api/children/occupancy` → `requireAdmin`

- [ ] **Step 1: Write failing tests**
  - occupancy: two groups with capacities 2 and null; children entering in different months → cells' counts, `fresh`, names with `from`/`to`; a waitlist child and a contract child without dates are not counted, the latter is in `undated`; end derives from the computed school start (child born 2021-06-30 counts through August 2027, not September 2027) and from a manual later school start; Review Focus 3: capacity 1 with two children → `red: true, over: 1`; total row counts a child once and is red only when all groups have capacities; other facility's children absent; `invalid_year`.
  - school settings: defaults 6/30/6; `invalid_school_cutoff` for 31 June, month 13, age 3; `getChild(...).computedSchoolStart` follows a changed cutoff.
  - groups: `invalid_capacity` for 0, 201, 2.5; other facility's group → `group_not_found`.
  - migration: database at `0027_child_admission` → groups keep rows with `capacity` null; facilities have 6/30/6.
- [ ] **Step 2: Run** the files — Expected: FAIL
- [ ] **Step 3: Implement**; `npx drizzle-kit generate --name occupancy`
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` — Expected: PASS / no errors
- [ ] **Step 5: Commit** `feat: school cutoff, group capacities and occupancy table`

### Task 5: UI – Belegung and school cutoff

**Files:**
- Create: `app/components/children/OccupancyTab.vue`, `app/components/settings/SchoolChildrenSection.vue`, `app/pages/print/children/occupancy/[year].vue`
- Modify: `app/pages/children/index.vue` (tab "Belegung", managers only), `app/components/children/ChildMasterForm.vue` (school start hint), `app/pages/admin/settings.vue`, `app/locales/de.ts`

**Interfaces:**
- Consumes: Task 4 APIs; `YearNav`-like navigation for the Kita year; `useBusy`, `useAction`, `PrintActions`
- Produces (UI): table per spec §5 — cell text `present` or `present (+fresh)`, `–` for empty; red cell style; "+n über Plätze" under the number; inline editable "Plätze" per group (save on blur/enter); click on a cell lists "schon da" / "neu in diesem Monat" with dates and links to the record; hint with the undated children (collapsible); print page; settings section "Schulkinder" (Träger edits Stichtag and Alter, Leitung sees them read-only) with the hint text; master form shows `errechnet: <date>` under "voraussichtlicher Schulstart" and the badge "abweichend" when a manual date is set

Texts (use exactly):

```ts
occupancy: { tab: 'Belegung', capacity: 'Plätze', total: 'Summe', noGroup: 'ohne Gruppe', over: (n: number) => `+${n} über Plätze`,
  present: 'schon da', fresh: 'neu in diesem Monat', undated: (n: number) => `${n} Kinder mit Vertrag ohne Eintrittsdatum werden nicht gezählt.`,
  open: 'offen', print: 'Belegung drucken' },
schoolChildren: { title: 'Schulkinder', cutoff: 'Stichtag', age: 'Alter (Jahre)',
  hint: 'Wer bis einschließlich Stichtag das Alter erreicht hat, wird zum 1. September Schulkind. Die Stichtage unterscheiden sich je Bundesland und können sich ändern. Bitte den Wert prüfen.',
  computed: (date: string) => `errechnet: ${date}`, deviating: 'abweichend' },
```

- [ ] **Step 1: Implement**
- [ ] **Step 2: Run** `npm run typecheck` and `npm test` — Expected: no errors / PASS
- [ ] **Step 3: Headless check**: with seeded children, `/children` (as manager) and `/print/children/occupancy/2026` render the table server-side; a Mitarbeiter gets no "Belegung" tab and 403 from the API.
- [ ] **Step 4: Commit** `feat: occupancy view and school cutoff settings`

---

## Stage 3 — Group changes

### Task 6: Group history and planned changes

**Files:**
- Modify: `server/db/schema.ts`; create migration `0029_child_group_changes` (table + six `*_review_since` columns on `children` + backfill of one start row per child)
- Create: `server/services/childGroupChanges.ts`, routes `server/api/children/[id]/group-change.post.ts`, `server/api/child-group-changes/[id].put.ts`, `[id].delete.ts`
- Modify: `server/services/children.ts` (create, master update, leave, facility move, `getChild`), `server/services/occupancy.ts` (history), `server/services/groups.ts` (`deleteGroup`), `server/plugins/database.ts`, `shared/types/api.ts`, `server/schemas.ts`, `tests/helpers/fixtures.ts`
- Test: `tests/services/childGroupChanges.test.ts`, `tests/services/occupancy.test.ts`, `tests/services/groups.test.ts`, `tests/services/db.test.ts`, `tests/api/permissions.test.ts`

**Interfaces:**
- Consumes: Tasks 3–4
- Produces:
  - Table `child_group_changes` per spec §9.1 without `new_contract` (Task 9); backfill: `INSERT … SELECT id, group_id, NULL (from_date), keep flags 1, applied_at = created_at … FROM children`
  - `type ReviewSection = 'contacts' | 'health' | 'consents' | 'documents' | 'careType' | 'keyEducator'`; `GroupChangeInput { groupId: number; date: IsoDate; keep: Record<ReviewSection, boolean> }`
  - `GroupChangeDto { id: number; groupId: number; groupName: string; date: IsoDate; keep: Record<ReviewSection, boolean> }`; `ChildRecordDto.pendingGroupChange: GroupChangeDto | null`
  - `planGroupChange(db, actor, facilityId, childId, input, today, now?): void` — archived or waitlist child → 409 `child_archived` / 400 `waitlist_no_group_change`; group of the facility (`group_not_found`); same group as valid on that date → 400 `same_group`; date not after the last applied change → 400 `group_change_order`; an unapplied change exists → 409 `group_change_pending`; `date <= today` → applied at once
  - `updateGroupChange(db, actor, facilityId, changeId, input, today)`, `deleteGroupChange(db, facilityId, changeId)` — only unapplied (409 `group_change_applied`), 404 `group_change_not_found`
  - `applyDueGroupChanges(db, today): number` — applies every unapplied change with `from_date <= today` of children that have not left before that date: sets `children.group_id`, `applied_at`, and for each `keep.* === false` the matching `*_review_since = from_date`; idempotent
  - Direct change in `updateChildMaster` when `groupId` differs: child not started (waitlist, or contract start null/after today) and no applied dated change → update the start row; otherwise insert a change dated today with all `keep` true and apply it; a pending change to the same group on a later date stays untouched
  - `createChild` inserts the start row; `leaveChild` deletes an unapplied change dated after `leftOn`; `moveChildToFacility` deletes unapplied changes and inserts a change `groupId: null` dated today (applied)
  - `deleteGroup`: 409 `group_has_pending_changes` when an unapplied change targets the group
  - `occupancyChildren` feeds `groups` from the history incl. unapplied changes
  - Plugin: daily run calls `applyDueGroupChanges(useDb(), todayIso())` before the purge; logs `Applied <n> group change(s).` when n > 0
  - Routes → `requireAdmin`
  - Fixture `addChild` inserts the start row

- [ ] **Step 1: Write failing tests**
  - plan for a future date → `children.group_id` unchanged, `pendingGroupChange` set; `applyDueGroupChanges` the day before does nothing, on the day switches the group and returns 1, a second call returns 0; past-dated plan applies at once; all listed error codes; update/delete of a pending change; other facility → `group_change_not_found`.
  - direct change before the child started updates the start row (history has one row); after the start creates a dated change.
  - Review Focus 5: plan a change for 2027-09-01, `leaveChild` with `leftOn` 2027-07-31 → the change is gone and `applyDueGroupChanges('2027-09-01')` returns 0.
  - occupancy: with a planned mid-month change the child counts in the old group that month (present) and in the new one (fresh), and once in the total.
  - groups: `group_has_pending_changes`. Facility move: history ends with a null group, pending change removed.
  - migration: database at `0028_occupancy` with children in groups → one applied start row each with the current group.
- [ ] **Step 2: Run** the files — Expected: FAIL
- [ ] **Step 3: Implement**; `npx drizzle-kit generate --name child_group_changes` + backfill SQL
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` — Expected: PASS / no errors
- [ ] **Step 5: Commit** `feat: group history and planned group changes for children`

### Task 7: Review markers, confirmation, "Offen" list

**Files:**
- Modify: `server/services/children.ts`, `server/services/childContacts.ts`, `server/services/childDocuments.ts`, `server/lib/childRecord.ts`, `shared/types/api.ts`, `server/schemas.ts`
- Create: `server/api/children/[id]/confirm.post.ts`, `server/api/children/open.get.ts`
- Test: `tests/services/childReview.test.ts`, `tests/services/childDocuments.test.ts`, `tests/api/permissions.test.ts`

**Interfaces:**
- Consumes: Task 6 (`*_review_since` set by `applyDueGroupChanges`)
- Produces:
  - `ChildRecordDto.reviews: Partial<Record<ReviewSection, IsoDate>>` (only open ones)
  - Clearing: `updateChildHealth` clears `health`; `updateChildConsents` clears `consents`; every contact write clears `contacts`; `updateChildMaster` clears `careType` and `keyEducator`; `uploadDocument` clears `documents` when afterwards every required type of the facility has a document with `uploaded_at` date ≥ the marker date
  - `confirmSection(db, actor, facilityId, childId, section: ReviewSection, today, now?)` — clears the marker and stamps the section (`master` stamp for careType/keyEducator); archived rules as other writes; `POST /api/children/[id]/confirm` (`{ section }`) → `requireChildEditor`
  - Document overview: cell gains `stale: boolean` — true while `documents_review_since` is set and the type is required and its newest document was uploaded before the marker date; `missingRequired` is also true for stale cells
  - `OpenChildDto { id: number; name: string; groupId: number | null; sections: ReviewSection[] }`; `listOpenReviews(db, facilityId, today): OpenChildDto[]` (active children only, sorted like the list); `GET /api/children/open` → `requireChildReader`

- [ ] **Step 1: Write failing tests**: a change with `keep.health = false` and `keep.documents = false` applied on its date sets exactly those two markers; saving health clears it; `confirmSection('consents')` on an unmarked section is a no-op without error; documents: required type with an older document → `stale: true`, uploading a new one of every required type clears the marker and `stale`; `confirmSection('documents')` clears it at once; a Mitarbeiter without permission cannot confirm (route guard listed); `listOpenReviews` lists the child with its sections and drops it when all are cleared; other facility absent.
- [ ] **Step 2: Run** — Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` — Expected: PASS / no errors
- [ ] **Step 5: Commit** `feat: review markers after group changes`

### Task 8: UI – group change, markers, "Offen"

**Files:**
- Create: `app/components/children/GroupChangeDialog.vue`, `app/components/children/ReviewBanner.vue`, `app/components/children/OpenTab.vue`
- Modify: `app/pages/children/[id].vue`, section components (`ChildMasterForm.vue`, `ChildContactsSection.vue`, `ChildHealthForm.vue`, `ChildConsentsForm.vue`, `ChildDocumentsSection.vue`), `app/components/children/DocumentOverviewTab.vue`, `app/pages/children/index.vue` (tab "Offen"), `app/locales/de.ts`

**Interfaces:**
- Consumes: Tasks 6–7 APIs
- Produces (UI): button "Gruppenwechsel planen" (managers) opening the dialog (group, date, six "übernehmen" checkboxes, all ticked); pending change shown in the master section ("wechselt am … in …") with edit/delete; banner per marked section with the button "Angaben bestätigen" (for whoever may edit); overview cell "neu einzureichen" (red) for `stale`; tab "Offen" with the open sections per child

Texts (use exactly):

```ts
groupChange: { plan: 'Gruppenwechsel planen', pending: (date: string, group: string) => `wechselt am ${date} in ${group}`, group: 'Neue Gruppe', date: 'Wechseltag',
  keepTitle: 'Was wird übernommen?', keepHint: 'Nicht übernommene Bereiche bleiben sichtbar und werden als „nicht bestätigt“ markiert, bis sie durchgesehen sind.',
  sections: { contacts: 'Bezugspersonen', health: 'Gesundheit', consents: 'Einwilligungen', documents: 'Dokumente', careType: 'Betreuungsform', keyEducator: 'Bezugserzieher' },
  unconfirmed: (date: string) => `Seit dem Gruppenwechsel am ${date} nicht bestätigt`, confirm: 'Angaben bestätigen', resubmit: 'neu einzureichen',
  openTab: 'Offen', openEmpty: 'Keine offenen Bestätigungen.', confirmDelete: 'Geplanten Gruppenwechsel löschen?' },
```

- [ ] **Step 1: Implement**
- [ ] **Step 2: Run** `npm run typecheck` and `npm test` — Expected: no errors / PASS
- [ ] **Step 3: Headless check**: plan a change via the API for today with `keep.health = false`; the record page shows the banner server-side; `/children` lists the child under "Offen".
- [ ] **Step 4: Commit** `feat: group change dialog, review banners and open list`

---

## Stage 4 — School children

### Task 9: Server – after-school groups, automatic leaving

**Files:**
- Modify: `server/db/schema.ts`; create migration `0030_school_children` (`groups.for_school_children`, `facilities.auto_leave_school_children`, `document_types.care_contract` with backfill `= 1 WHERE name = 'Betreuungsvertrag'`, `child_group_changes.new_contract`, `children.contract_review_since`)
- Modify: `server/services/schoolChildren.ts`, `server/services/childGroupChanges.ts`, `server/services/occupancy.ts`, `server/services/children.ts` (`unleaveChild`), `server/services/documentTypes.ts`, `server/services/childDocuments.ts`, `server/services/groups.ts`, `server/plugins/database.ts`, `shared/types/api.ts`, `server/schemas.ts`
- Create: routes `server/api/groups/[id]/school-children.put.ts`, `server/api/school-settings/auto-leave.put.ts`, `server/api/school-settings/auto-leave-preview.get.ts`, `server/api/children/school-children.get.ts`
- Test: `tests/services/schoolChildren.test.ts`, `tests/services/childGroupChanges.test.ts`, `tests/services/occupancy.test.ts`, `tests/services/documentTypes.test.ts`, `tests/services/db.test.ts`, `tests/api/permissions.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 6, 7
- Produces:
  - `GroupDto.forSchoolChildren: boolean`; `setGroupForSchoolChildren(db, groupId, value)` via `PUT /api/groups/[id]/school-children` → `requireProvider` (facility via `facilityOfGroup`)
  - `DocumentTypeDto.careContract: boolean`; saving a type with `careContract: true` clears the flag on the facility's other types
  - `GroupChangeInput.newContract?: boolean`; planning a change into a group for school children without `newContract === true` → 400 `new_contract_required`; direct change in the master data into such a group → 400 `new_contract_required`; on apply of such a change `contract_review_since = from_date`; `ReviewSection` gains `'contract'`; overview: the `careContract` type's cell is `stale` while the marker is set and its newest document was uploaded before the marker date; uploading a newer document of that type or `confirmSection('contract')` clears it
  - Stay end (in `occupancyChildren` and below): open when the child's group on its school start date (history incl. unapplied changes) has `for_school_children`
  - `SchoolSettingsDto.autoLeave: boolean`; `schoolLeavers(db, facilityId, today): { id: number; name: string; schoolStart: IsoDate; leftOn: IsoDate }[]` — active contract children without `left_on` whose school start ≤ today and who are not in a school-children group on that date; `GET /api/school-settings/auto-leave-preview` → `requireProvider`; `setAutoLeave(db, facilityId, value)` via `PUT /api/school-settings/auto-leave` → `requireProvider`
  - `leaveSchoolChildren(db, today): number` — for every facility with the switch on, sets `left_on = day before school start` for exactly `schoolLeavers`; removes their unapplied group changes; idempotent; plugin calls it after `applyDueGroupChanges`; log `Deregistered <n> school child(ren).`
  - `upcomingSchoolChildren(db, facilityId, today): { id; name; groupId: number | null; schoolStart: IsoDate; pendingSchoolGroup: string | null }[]` — active contract children whose school start is the next 1 September (relative to today) or already reached without `left_on`; empty before 1 March of that year; `GET /api/children/school-children` → `requireAdmin`
  - `unleaveChild(db, facilityId, id, today, newSchoolStart?: IsoDate)` — when the child's school start ≤ today and it is not in a school-children group: `newSchoolStart` must be given and after today, stored as manual `school_start_date`; otherwise 400 `school_start_required`

- [ ] **Step 1: Write failing tests**
  - leaving: switch off → nothing; switch on, today 2027-08-31 → nothing; today 2027-09-01 → child born 2021-06-30 gets `left_on` 2027-08-31; child born 2021-07-01 untouched; manual school start 2028-09-01 untouched; second run returns 0; other facility with the switch off untouched.
  - Review Focus 4: an after-school group not flagged yet with an older child → `schoolLeavers` lists it and `leaveSchoolChildren` deregisters exactly the listed ids; after flagging the group the list is empty.
  - after-school: planning a change into a flagged group without `newContract` → `new_contract_required`; with it, on apply `contract` marker set; such a child is not deregistered on its school start and counts in the occupancy after September; uploading a newer contract document clears the marker.
  - unleave: `school_start_required` without a new date; with a future date the child is active again and the next run leaves it alone.
  - upcoming list: empty on 2027-02-28, lists the child on 2027-03-01 with `pendingSchoolGroup` when a change is planned.
  - document types: only one `careContract` type per facility. Migration: database at `0029_child_group_changes` → the type "Betreuungsvertrag" of every facility has `care_contract = 1`, switches off.
- [ ] **Step 2: Run** the files — Expected: FAIL
- [ ] **Step 3: Implement**; `npx drizzle-kit generate --name school_children` + backfill SQL
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` — Expected: PASS / no errors
- [ ] **Step 5: Commit** `feat: school children leave automatically, after-school groups`

### Task 10: UI – school children

**Files:**
- Modify: `app/components/children/OccupancyTab.vue` (list "Schulkinder zum 1.9."), `app/components/settings/SchoolChildrenSection.vue` (switch with preview confirm), `app/components/settings/FacilityGroups.vue` (flag "für Schulkinder"), `app/components/settings/DocumentTypesSection.vue` (flag "Betreuungsvertrag"), `app/components/children/GroupChangeDialog.vue` (checkbox for after-school groups), `app/components/children/ArchiveTab.vue` and `ChildLifecycleSection.vue` (unleave asks for a new school start when required), `app/components/children/ReviewBanner.vue` (contract), `app/components/users/RightsTable.vue`, `app/locales/de.ts`

**Interfaces:**
- Consumes: Task 9 APIs
- Produces (UI): list under the occupancy table (name, group, school start, planned after-school group; with the switch off a button "zum 31.8. abmelden" per child using the existing leave route); switch whose confirm dialog lists the preview names (or says nobody is affected today); the unleave dialog shows a date field when the server answers `school_start_required`; rights table rows for spec §8

Texts (use exactly):

```ts
schoolChildren: { ..., listTitle: (date: string) => `Schulkinder zum ${date}`, autoLeave: 'Schulkinder automatisch abmelden',
  autoLeaveHint: 'Am 1. September erhalten alle Schulkinder den Austritt 31. August. Kinder mit späterem Schulstart oder mit Wechsel in eine Gruppe für Schulkinder bleiben.',
  previewNone: 'Heute würde niemand abgemeldet. Einschalten?',
  preview: (n: number) => `Beim Einschalten werden diese ${n} Kinder sofort abgemeldet (ihr Schulstart ist schon erreicht):`,
  leaveNow: 'zum 31.8. abmelden', forSchoolChildren: 'für Schulkinder', careContract: 'ist der Betreuungsvertrag',
  newContract: 'Weiterer Betreuungsvertrag abgeschlossen', newSchoolStart: 'Neuer voraussichtlicher Schulstart' },
groupChange: { ..., sections: { ..., contract: 'Betreuungsvertrag' } },
errors: { ..., new_contract_required: 'Für den Wechsel in eine Gruppe für Schulkinder ist ein weiterer Betreuungsvertrag nötig. Bitte bestätige ihn im Dialog „Gruppenwechsel planen“.',
  school_start_required: 'Der Schulstart dieses Kindes ist schon erreicht. Bitte gib einen neuen voraussichtlichen Schulstart an.' },
```

- [ ] **Step 1: Implement**
- [ ] **Step 2: Run** `npm run typecheck` and `npm test` — Expected: no errors / PASS
- [ ] **Step 3: Headless check**: preview route lists a child past its school start; after switching on via the API and a server restart (daily run at start) the child is archived; settings page renders the section.
- [ ] **Step 4: Commit** `feat: school children list, automatic leaving switch and after-school groups in the UI`

### Task 11: Operating guide and final verification

**Files:**
- Modify: `docs/BETRIEB.md`

- [ ] **Step 1: Extend the section on child records** (plain German): Vormerkungen are not deleted automatically — look through them regularly; how the occupancy counts (one paragraph with the "17 (+2)" example); the school cutoff must be checked per Einrichtung; the automatic leaving is off by default and what the preview shows; after-school groups and the further contract.
- [ ] **Step 2: Run** `npm test`, `npm run typecheck`, `npm run build` — Expected: all pass (paste the summary lines into the report)
- [ ] **Step 3: Commit** `docs: place planning in the operating guide`
