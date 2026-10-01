# Release Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Observers see only the last released state of a month; every release stores a snapshot; changes between releases stay marked permanently (solid orange), and admins additionally see unreleased draft changes (dashed orange).

**Architecture:** A new `release_snapshots` table stores the month's employees, entries, info fields and closure labels as JSON per release. Pure functions in `shared/domain/releaseDiff.ts` turn a snapshot into per-cell texts and diff consecutive snapshots into a change history. `getMonthPlan` serves observers from the newest snapshot and admins from live data plus a pending diff against the newest snapshot. "Freigabe zurückziehen" is removed.

**Tech Stack:** Nuxt 4, Nuxt UI 4, Drizzle ORM 0.45 + better-sqlite3, Vitest 5 (existing project).

**Spec:** `docs/superpowers/specs/2026-09-30-dienstplan-kindergarten-design.md` (§2 table, §3.7 revised 01.10.2026, §5 data model)

## Global Constraints

- UI text German in `app/locales/de.ts`; identifiers, comments, tests, commits English.
- Domain (`shared/domain`), services, db and tests use relative imports only.
- Observers must never receive draft data: no entries, info fields or closure labels that were changed after the newest release, and never `pendingChanges`.
- Released change markings persist across all releases since the first one (spec §3.7, option D).
- Cell comparison uses the detailed cell text: template short label, label, break `[h:mm–h:mm]`, note `· text`; empty cell `—`, empty info field `''`.
- "Mein Urlaub" keeps using live data (unchanged).
- Windows PowerShell 5.1; refresh PATH before node/npm/git: `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`.
- If a Nitro typed-route `$fetch` triggers TS2321 "Excessive stack depth", use `$fetch<unknown>(...)` (existing pattern).

## Review Focus

1. A closure created (or an info field edited) after a release must not appear for observers until the next release (test in Task 2).
2. A cell changed and later changed back across releases must show both steps in its history, not disappear (test in Task 1).
3. A month released before this feature existed (dev DB October 2026) must stay visible to observers after the update, without markings (backfill test in Task 2).
4. An admin viewing a never-released month must see no pending markers and no released changes (test in Task 3).
5. An employee who joins after a release must not appear as a column for observers until the next release (test in Task 3).

---

### Task 1: Snapshot diff domain logic

**Files:**
- Modify: `shared/domain/describe.ts` (add `DetailedEntryLike`, `describeCellDetailed`)
- Create: `shared/domain/releaseDiff.ts`
- Modify: `server/services/entries.ts` (replace local `describeCellForLog` with `describeCellDetailed`)
- Test: `tests/domain/describe.test.ts`, `tests/domain/releaseDiff.test.ts`

**Interfaces:**
- Produces:
  - `interface DetailedEntryLike { shortLabel: string | null; label: string; breakStart: Minutes | null; breakEnd: Minutes | null; note: string | null }`
  - `describeCellDetailed(entries: DetailedEntryLike[]): string` — `'—'` when empty
  - `interface SnapshotContent { entries: (DetailedEntryLike & { employeeId: number; date: IsoDate })[]; days: { date: IsoDate; info1: string; info2: string }[] }`
  - `snapshotCells(content: SnapshotContent): Map<string, string>` — keys `cellKey(employeeId, date)` for cells with entries, `noteKey(field, date)` for non-empty info fields
  - `interface CellDiff { key: string; before: string; after: string }`, `diffCells(before: Map<string, string>, after: Map<string, string>): CellDiff[]` (sorted by key)
  - `interface ReleasedState { releasedAt: string; releasedBy: string; cells: Map<string, string> }`, `interface ReleasedChange extends CellDiff { releasedAt: string; releasedBy: string }`, `changeHistory(releases: ReleasedState[]): Map<string, ReleasedChange[]>` (releases oldest first)

- [ ] **Step 1: Write the failing tests**

Append to `tests/domain/describe.test.ts` (and add `describeCellDetailed` to the existing import from `../../shared/domain/describe`):
```ts
describe('describeCellDetailed', () => {
  it('includes short label, break and note', () => {
    expect(describeCellDetailed([
      { shortLabel: 'S', label: '8:45–17:00', breakStart: 730, breakEnd: 760, note: null },
      { shortLabel: null, label: 'VZ 7:30–8:30', breakStart: null, breakEnd: null, note: 'Elterngespräch' },
    ])).toBe('S 8:45–17:00 [12:10–12:40] + VZ 7:30–8:30 · Elterngespräch')
    expect(describeCellDetailed([])).toBe('—')
  })
})
```

`tests/domain/releaseDiff.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { changeHistory, diffCells, snapshotCells, type SnapshotContent } from '../../shared/domain/releaseDiff'

type SnapshotEntry = SnapshotContent['entries'][number]
const entry = (employeeId: number, date: string, label: string, extra: Partial<SnapshotEntry> = {}): SnapshotEntry => ({
  employeeId, date, label, shortLabel: null, breakStart: null, breakEnd: null, note: null, ...extra,
})

describe('snapshotCells', () => {
  it('describes each cell with entries and each non-empty info field', () => {
    const cells = snapshotCells({
      entries: [
        entry(1, '2026-10-05', '8:45–17:00', { shortLabel: 'S', breakStart: 730, breakEnd: 760 }),
        entry(1, '2026-10-06', 'Krank'),
      ],
      days: [
        { date: '2026-10-05', info1: 'Elternabend', info2: '' },
        { date: '2026-10-06', info1: '', info2: '' },
      ],
    })
    expect([...cells.entries()]).toEqual([
      ['1|2026-10-05', 'S 8:45–17:00 [12:10–12:40]'],
      ['1|2026-10-06', 'Krank'],
      ['info1|2026-10-05', 'Elternabend'],
    ])
  })
})

describe('diffCells', () => {
  it('reports changed, added and removed cells and info fields', () => {
    const before = new Map([['1|2026-10-05', 'Krank'], ['2|2026-10-05', 'Urlaub']])
    const after = new Map([['1|2026-10-05', 'S 8:45–17:00'], ['info1|2026-10-05', 'Fest']])
    expect(diffCells(before, after)).toEqual([
      { key: '1|2026-10-05', before: 'Krank', after: 'S 8:45–17:00' },
      { key: '2|2026-10-05', before: 'Urlaub', after: '—' },
      { key: 'info1|2026-10-05', before: '', after: 'Fest' },
    ])
  })
  it('returns nothing for identical states', () => {
    expect(diffCells(new Map([['1|a', 'X']]), new Map([['1|a', 'X']]))).toEqual([])
  })
})

describe('changeHistory', () => {
  const state = (releasedAt: string, cells: [string, string][]) => ({ releasedAt, releasedBy: 'leitung', cells: new Map(cells) })

  it('has no changes for a single release', () => {
    expect(changeHistory([state('t1', [['1|a', 'A']])]).size).toBe(0)
  })
  it('collects the changes of every later release, oldest first', () => {
    const history = changeHistory([
      state('t1', [['1|a', 'A']]),
      state('t2', [['1|a', 'B']]),
      state('t3', [['1|a', 'A'], ['info1|a', 'Fest']]),
    ])
    expect(history.get('1|a')).toEqual([
      { key: '1|a', before: 'A', after: 'B', releasedAt: 't2', releasedBy: 'leitung' },
      { key: '1|a', before: 'B', after: 'A', releasedAt: 't3', releasedBy: 'leitung' },
    ])
    expect(history.get('info1|a')).toEqual([
      { key: 'info1|a', before: '', after: 'Fest', releasedAt: 't3', releasedBy: 'leitung' },
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/domain/describe.test.ts tests/domain/releaseDiff.test.ts`
Expected: FAIL — `describeCellDetailed` is not exported; `releaseDiff` module not found.

- [ ] **Step 3: Write the implementation**

Append to `shared/domain/describe.ts` (add `formatTime` is already imported there; add `Minutes` to the type import if missing):
```ts
export interface DetailedEntryLike {
  shortLabel: string | null
  label: string
  breakStart: Minutes | null
  breakEnd: Minutes | null
  note: string | null
}

/** Full cell text used to detect and show changes (includes short label, break and note). */
export function describeCellDetailed(entries: DetailedEntryLike[]): string {
  if (entries.length === 0) return '—'
  return entries.map(entry => (entry.shortLabel ? `${entry.shortLabel} ` : '')
    + entry.label
    + (entry.breakStart !== null && entry.breakEnd !== null
      ? ` [${formatTime(entry.breakStart)}–${formatTime(entry.breakEnd)}]`
      : '')
    + (entry.note ? ` · ${entry.note}` : '')).join(' + ')
}
```

`shared/domain/releaseDiff.ts`:
```ts
import { cellKey, noteKey } from './cells'
import { describeCellDetailed, type DetailedEntryLike } from './describe'
import type { IsoDate } from './types'

export interface SnapshotContent {
  entries: (DetailedEntryLike & { employeeId: number; date: IsoDate })[]
  days: { date: IsoDate; info1: string; info2: string }[]
}

export interface CellDiff {
  key: string
  before: string
  after: string
}

export interface ReleasedState {
  releasedAt: string
  releasedBy: string
  cells: Map<string, string>
}

export interface ReleasedChange extends CellDiff {
  releasedAt: string
  releasedBy: string
}

/** Text per plan cell (employee × day) and per non-empty info field, as compared between releases. */
export function snapshotCells(content: SnapshotContent): Map<string, string> {
  const grouped = new Map<string, SnapshotContent['entries']>()
  for (const entry of content.entries) {
    const key = cellKey(entry.employeeId, entry.date)
    grouped.set(key, [...(grouped.get(key) ?? []), entry])
  }
  const cells = new Map<string, string>()
  for (const [key, list] of grouped) cells.set(key, describeCellDetailed(list))
  for (const day of content.days) {
    if (day.info1) cells.set(noteKey('info1', day.date), day.info1)
    if (day.info2) cells.set(noteKey('info2', day.date), day.info2)
  }
  return cells
}

function emptyValue(key: string): string {
  return key.startsWith('info') ? '' : describeCellDetailed([])
}

export function diffCells(before: Map<string, string>, after: Map<string, string>): CellDiff[] {
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort()
  return keys.flatMap((key) => {
    const was = before.get(key) ?? emptyValue(key)
    const now = after.get(key) ?? emptyValue(key)
    return was === now ? [] : [{ key, before: was, after: now }]
  })
}

/** Every change between consecutive releases (oldest first), grouped by cell or info-field key. */
export function changeHistory(releases: ReleasedState[]): Map<string, ReleasedChange[]> {
  const history = new Map<string, ReleasedChange[]>()
  for (let index = 1; index < releases.length; index++) {
    const { releasedAt, releasedBy, cells } = releases[index]!
    for (const diff of diffCells(releases[index - 1]!.cells, cells)) {
      history.set(diff.key, [...(history.get(diff.key) ?? []), { ...diff, releasedAt, releasedBy }])
    }
  }
  return history
}
```

In `server/services/entries.ts`: delete the local `describeCellForLog` function, import `describeCellDetailed` from `../../shared/domain/describe`, and make `describeCellAt` return `describeCellDetailed(loadEntries(...))`. Remove the now-unused `formatTime` import if nothing else uses it. If any test imports `describeCellForLog`, switch it to `describeCellDetailed`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run` — Expected: all PASS (entries tests unchanged in behavior).

- [ ] **Step 5: Commit**

```
git add shared/domain/describe.ts shared/domain/releaseDiff.ts server/services/entries.ts tests/domain/describe.test.ts tests/domain/releaseDiff.test.ts
git commit -m "feat: add release snapshot diff logic"
```

---

### Task 2: Snapshot storage and release service

**Files:**
- Modify: `server/db/schema.ts` (add `releaseSnapshots`)
- Generated: `server/db/migrations/0001_*.sql` + meta
- Modify: `shared/types/api.ts` (add `SnapshotDayDto`, `SnapshotData`)
- Modify: `server/services/release.ts` (add `buildSnapshot`, `loadReleases`, `backfillSnapshots`; snapshot in `releaseMonth`; remove `unreleaseMonth`)
- Modify: `server/plugins/database.ts` (call `backfillSnapshots`)
- Delete: `server/api/plan/[year]/[month]/release.delete.ts`
- Modify: `tests/services/entries.test.ts` (drop `unreleaseMonth` usage)
- Test: `tests/services/release.test.ts`

**Interfaces:**
- Consumes: `loadEmployees`, `loadEntries`, `loadClosures`, `closureOn` (queries.ts); `isEmployedInRange`; `monthDates`, `toIsoDate`, `daysInMonth`
- Produces:
  - `interface SnapshotDayDto { date: IsoDate; info1: string; info2: string; closureLabel: string | null }`
  - `interface SnapshotData { employees: EmployeeColumnDto[]; entries: EntryDto[]; days: SnapshotDayDto[] }`
  - `interface StoredRelease { releasedAt: string; releasedBy: string; data: SnapshotData }`
  - `buildSnapshot(db, year, month): SnapshotData`, `releaseMonth(db, actor, year, month, now?): void` (stores snapshot + updates month_plans), `loadReleases(db, year, month): StoredRelease[]` (oldest first), `backfillSnapshots(db): number`

- [ ] **Step 1: Add the table and types, generate the migration**

Append to `server/db/schema.ts`:
```ts
export const releaseSnapshots = sqliteTable('release_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  releasedAt: text('released_at').notNull(),
  releasedBy: integer('released_by').references(() => users.id, { onDelete: 'set null' }),
  /** JSON of SnapshotData */
  data: text('data').notNull(),
}, table => [index('release_snapshots_month').on(table.year, table.month)])
```

Add to `shared/types/api.ts` (after `EmployeeColumnDto`):
```ts
export interface SnapshotDayDto {
  date: IsoDate
  info1: string
  info2: string
  closureLabel: string | null
}

/** What observers see of a month, frozen at release time. */
export interface SnapshotData {
  employees: EmployeeColumnDto[]
  entries: EntryDto[]
  days: SnapshotDayDto[]
}
```

Run: `npm run db:generate`
Expected: new `server/db/migrations/0001_*.sql` containing `CREATE TABLE \`release_snapshots\``.

- [ ] **Step 2: Write the failing test**

`tests/services/release.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { monthPlans } from '../../server/db/schema'
import { createClosure } from '../../server/services/closures'
import { applyToCells, setDayNote } from '../../server/services/entries'
import { backfillSnapshots, loadReleases, releaseMonth } from '../../server/services/release'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, createTestDb, templateId } from '../helpers/fixtures'

describe('release snapshots', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
  })
  const shift = (date: string, label: string) =>
    applyToCells(db, admin, [{ employeeId: anna, date }], 'replace', { kind: 'shift', templateId: templateId(db, label) })

  it('stores one snapshot per release with entries, notes and closure labels', () => {
    shift('2026-10-06', 'F2')
    setDayNote(db, admin, '2026-10-07', 'info1', 'Elternabend')
    releaseMonth(db, admin, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    shift('2026-10-06', 'S')
    createClosure(db, admin, { startDate: '2026-10-12', endDate: '2026-10-12', label: 'Teamtag', mode: 'closure_day' })
    releaseMonth(db, admin, 2026, 10, new Date('2026-10-01T07:00:00Z'))

    const releases = loadReleases(db, 2026, 10)
    expect(releases.map(r => [r.releasedAt, r.releasedBy])).toEqual([
      ['2026-09-25T10:00:00.000Z', 'leitung'],
      ['2026-10-01T07:00:00.000Z', 'leitung'],
    ])
    const [first, second] = releases
    expect(first!.data.employees.map(e => e.name)).toEqual(['Anna'])
    expect(first!.data.entries.map(e => e.shortLabel)).toEqual(['F2'])
    expect(first!.data.days.find(d => d.date === '2026-10-07')?.info1).toBe('Elternabend')
    expect(first!.data.days.find(d => d.date === '2026-10-12')?.closureLabel).toBeNull()
    expect(second!.data.entries.map(e => e.shortLabel ?? e.label)).toEqual(['S', 'Schließtag'])
    expect(second!.data.days.find(d => d.date === '2026-10-12')?.closureLabel).toBe('Teamtag')
  })
  it('backfills a snapshot for months released before snapshots existed', () => {
    shift('2026-10-06', 'F2')
    db.insert(monthPlans).values({ year: 2026, month: 10, releasedAt: '2026-09-25T10:00:00.000Z', releasedBy: admin.id }).run()
    expect(backfillSnapshots(db)).toBe(1)
    expect(backfillSnapshots(db)).toBe(0)
    const [release] = loadReleases(db, 2026, 10)
    expect(release).toMatchObject({ releasedAt: '2026-09-25T10:00:00.000Z', releasedBy: 'leitung' })
    expect(release!.data.entries).toHaveLength(1)
  })
})
```

In `tests/services/entries.test.ts`: remove `unreleaseMonth` from the import and delete the line `expect(errorCode(() => unreleaseMonth(db, year, month))).toBe('invalid_month')`.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/services/release.test.ts`
Expected: FAIL — `loadReleases` / `backfillSnapshots` not exported.

- [ ] **Step 4: Write the implementation**

Replace `server/services/release.ts` with:
```ts
import { and, asc, eq, gte, isNotNull, lte } from 'drizzle-orm'
import { daysInMonth, monthDates, toIsoDate } from '../../shared/domain/dates'
import { isEmployedInRange } from '../../shared/domain/targets'
import type { SessionUser, SnapshotData } from '../../shared/types/api'
import type { Db } from '../db/client'
import { dayNotes, monthPlans, releaseSnapshots, users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { closureOn, loadClosures, loadEmployees, loadEntries } from './queries'

export interface StoredRelease {
  releasedAt: string
  releasedBy: string
  data: SnapshotData
}

function assertMonth(year: number, month: number): void {
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new ServiceError(400, 'invalid_month')
  }
}

/** The current (draft) state of a month in the shape observers get from a release. */
export function buildSnapshot(db: Db, year: number, month: number): SnapshotData {
  const monthStart = toIsoDate(year, month, 1)
  const monthEnd = toIsoDate(year, month, daysInMonth(year, month))
  const staff = loadEmployees(db).filter(employee => isEmployedInRange(employee.info, monthStart, monthEnd))
  const staffIds = new Set(staff.map(employee => employee.id))
  const closures = loadClosures(db)
  const notes = new Map(
    db.select().from(dayNotes).where(and(gte(dayNotes.date, monthStart), lte(dayNotes.date, monthEnd))).all()
      .map(note => [note.date, note]),
  )
  return {
    employees: staff.map(({ id, name, shortName }) => ({ id, name, shortName })),
    entries: loadEntries(db, { from: monthStart, to: monthEnd }).filter(entry => staffIds.has(entry.employeeId)),
    days: monthDates(year, month).map(date => ({
      date,
      info1: notes.get(date)?.info1 ?? '',
      info2: notes.get(date)?.info2 ?? '',
      closureLabel: closureOn(closures, date)?.label ?? null,
    })),
  }
}

export function releaseMonth(db: Db, actor: SessionUser, year: number, month: number, now: Date = new Date()): void {
  assertMonth(year, month)
  const releasedAt = now.toISOString()
  const data = JSON.stringify(buildSnapshot(db, year, month))
  db.transaction((tx) => {
    tx.insert(releaseSnapshots).values({ year, month, releasedAt, releasedBy: actor.id, data }).run()
    tx.insert(monthPlans).values({ year, month, releasedAt, releasedBy: actor.id })
      .onConflictDoUpdate({ target: [monthPlans.year, monthPlans.month], set: { releasedAt, releasedBy: actor.id } })
      .run()
  })
}

export function loadReleases(db: Db, year: number, month: number): StoredRelease[] {
  return db.select({ snapshot: releaseSnapshots, username: users.username })
    .from(releaseSnapshots)
    .leftJoin(users, eq(releaseSnapshots.releasedBy, users.id))
    .where(and(eq(releaseSnapshots.year, year), eq(releaseSnapshots.month, month)))
    .orderBy(asc(releaseSnapshots.releasedAt), asc(releaseSnapshots.id))
    .all()
    .map(({ snapshot, username }) => ({
      releasedAt: snapshot.releasedAt,
      releasedBy: username ?? '',
      data: JSON.parse(snapshot.data) as SnapshotData,
    }))
}

/** Gives months released before snapshots existed a first snapshot built from their current state. */
export function backfillSnapshots(db: Db): number {
  let created = 0
  for (const plan of db.select().from(monthPlans).where(isNotNull(monthPlans.releasedAt)).all()) {
    const existing = db.select({ id: releaseSnapshots.id }).from(releaseSnapshots)
      .where(and(eq(releaseSnapshots.year, plan.year), eq(releaseSnapshots.month, plan.month))).get()
    if (existing) continue
    db.insert(releaseSnapshots).values({
      year: plan.year, month: plan.month, releasedAt: plan.releasedAt!, releasedBy: plan.releasedBy,
      data: JSON.stringify(buildSnapshot(db, plan.year, plan.month)),
    }).run()
    created++
  }
  return created
}
```

In `server/plugins/database.ts`: import `backfillSnapshots` from `../services/release` and, right after `seedDefaults(db)`, add:
```ts
  const backfilled = backfillSnapshots(db)
  if (backfilled > 0) console.info(`Created release snapshots for ${backfilled} previously released month(s).`)
```

Delete `server/api/plan/[year]/[month]/release.delete.ts`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run` — Expected: all PASS (the permission test still passes; it globs existing route files).

- [ ] **Step 6: Commit**

```
git add -A server shared tests
git commit -m "feat: store a snapshot per month release and drop unrelease"
```

---

### Task 3: Month plan served from snapshots

**Files:**
- Modify: `shared/types/api.ts` (`ReleaseDto.pendingCount`, `PendingChangeDto`, `MonthPlanAdminDto.pendingChanges`)
- Modify: `server/services/plan.ts`
- Test: `tests/services/plan.test.ts`

**Interfaces:**
- Consumes: `buildSnapshot`, `loadReleases` (Task 2); `snapshotCells`, `diffCells`, `changeHistory` (Task 1); `parseCellKey`
- Produces:
  - `interface PendingChangeDto { before: string; after: string }`
  - `ReleaseDto { releasedAt: string | null; releasedBy: string | null; changeCount: number; pendingCount: number }`
  - `MonthPlanAdminDto` gains `pendingChanges: Record<string, PendingChangeDto>` (keys: cellKey / noteKey)
  - `MonthPlanDto.changes`: released change history, `ChangeDto.changedAt` = release time, `changedBy` = releasing user
  - observers: `employees`, `entries`, `days[].info1/info2/closureLabel` come from the newest snapshot; admins: live

- [ ] **Step 1: Update the types**

In `shared/types/api.ts`:
```ts
export interface ReleaseDto {
  releasedAt: string | null
  releasedBy: string | null
  /** Cells/info fields changed between releases (released changes). */
  changeCount: number
  /** Admin only: cells/info fields whose draft differs from the newest release. */
  pendingCount: number
}

export interface PendingChangeDto {
  before: string
  after: string
}
```
and add `pendingChanges: Record<string, PendingChangeDto>` to `MonthPlanAdminDto`.

- [ ] **Step 2: Write the failing tests**

In `tests/services/plan.test.ts`: add `setDayNote` to the import from `../../server/services/entries`, replace the test `'tracks changes since the last release'` with the following tests, and keep all other tests:
```ts
  it('shows observers only the released state, not later draft edits', () => {
    shift(anna, '2026-10-06', 'F2')
    releaseMonth(db, admin, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    shift(anna, '2026-10-06', 'S')
    shift(ben, '2026-10-07', 'M')
    setDayNote(db, admin, '2026-10-07', 'info1', 'Elternabend')
    const plan = getMonthPlan(db, observer, 2026, 10, today)
    expect(plan.entries.map(e => [e.employeeId, e.date, e.shortLabel])).toEqual([[anna, '2026-10-06', 'F2']])
    expect(plan.days[6]!.info1).toBe('')
    expect(plan.changes).toEqual({})
    expect(plan.release).toMatchObject({ releasedBy: 'leitung', changeCount: 0, pendingCount: 0 })
  })
  it('does not show employees who joined after the release to observers', () => {
    releaseMonth(db, admin, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    addEmployee(db, 'Dora', { validFrom: '2026-10-15' })
    expect(getMonthPlan(db, observer, 2026, 10, today).employees.map(e => e.name)).toEqual(['Anna', 'Ben'])
    expect(getMonthPlan(db, admin, 2026, 10, today).employees.map(e => e.name)).toEqual(['Anna', 'Ben', 'Dora'])
  })
  it('marks released changes and keeps them across later releases', () => {
    shift(anna, '2026-10-06', 'F2')
    releaseMonth(db, admin, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    shift(anna, '2026-10-06', 'S')
    releaseMonth(db, admin, 2026, 10, new Date('2026-10-01T07:00:00Z'))
    setDayNote(db, admin, '2026-10-07', 'info1', 'Elternabend')
    releaseMonth(db, admin, 2026, 10, new Date('2026-10-02T07:00:00Z'))
    const plan = getMonthPlan(db, observer, 2026, 10, today)
    expect(plan.changes[`${anna}|2026-10-06`]).toEqual([{
      field: 'entry', employeeId: anna, date: '2026-10-06',
      before: 'F2 7:30–15:45 [11:40–12:10]', after: 'S 8:45–17:00 [12:10–12:40]',
      changedAt: '2026-10-01T07:00:00.000Z', changedBy: 'leitung',
    }])
    expect(plan.changes['info1|2026-10-07']).toEqual([expect.objectContaining({
      field: 'info1', employeeId: null, date: '2026-10-07', before: '', after: 'Elternabend', changedAt: '2026-10-02T07:00:00.000Z',
    })])
    expect(plan.release.changeCount).toBe(2)
    expect(plan.days[6]!.info1).toBe('Elternabend')
    expect(getMyPlan(db, observer, 2026, 10, today).days[5]!.changes).toHaveLength(1)
  })
  it('shows admins pending draft changes separately from released ones', () => {
    shift(anna, '2026-10-06', 'F2')
    releaseMonth(db, admin, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    shift(anna, '2026-10-06', 'S')
    const plan = getMonthPlan(db, admin, 2026, 10, today)
    expect(plan.entries.find(e => e.date === '2026-10-06')?.shortLabel).toBe('S')
    expect(plan.changes).toEqual({})
    expect(plan.admin!.pendingChanges).toEqual({
      [`${anna}|2026-10-06`]: { before: 'F2 7:30–15:45 [11:40–12:10]', after: 'S 8:45–17:00 [12:10–12:40]' },
    })
    expect(plan.release).toMatchObject({ changeCount: 0, pendingCount: 1 })
  })
  it('has no pending or released changes for a never-released month', () => {
    shift(anna, '2026-10-06', 'F2')
    const plan = getMonthPlan(db, admin, 2026, 10, today)
    expect(plan.admin!.pendingChanges).toEqual({})
    expect(plan.release).toEqual({ releasedAt: null, releasedBy: null, changeCount: 0, pendingCount: 0 })
  })
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/services/plan.test.ts`
Expected: FAIL — observers still see live data / `pendingChanges` missing.

- [ ] **Step 4: Write the implementation**

In `server/services/plan.ts`:
- Remove `loadChanges` and the imports it alone used (`gt`, `changeLog`, `dayNotes` if unused, `monthPlans`).
- Add imports: `parseCellKey` from `../../shared/domain/cells`; `changeHistory`, `diffCells`, `snapshotCells`, `type ReleasedChange` from `../../shared/domain/releaseDiff`; `buildSnapshot`, `loadReleases` from `./release`; types `PendingChangeDto`, `SnapshotData`.
- Add helpers and replace `getMonthPlan`:
```ts
function changeFromKey(key: string): Pick<ChangeDto, 'field' | 'employeeId' | 'date'> {
  const [prefix, date] = key.split('|') as [string, string]
  if (prefix === 'info1' || prefix === 'info2') return { field: prefix, employeeId: null, date }
  const cell = parseCellKey(key)
  return { field: 'entry', employeeId: cell.employeeId, date: cell.date }
}

function toChangeDtos(history: Map<string, ReleasedChange[]>): Record<string, ChangeDto[]> {
  const changes: Record<string, ChangeDto[]> = {}
  for (const [key, list] of history) {
    changes[key] = list.map(change => ({
      ...changeFromKey(key), before: change.before, after: change.after,
      changedAt: change.releasedAt, changedBy: change.releasedBy,
    }))
  }
  return changes
}

export function getMonthPlan(db: Db, viewer: SessionUser, year: number, month: number, today: IsoDate): MonthPlanDto {
  const isAdmin = viewer.role === 'admin'
  const releases = loadReleases(db, year, month)
  const latest = releases.at(-1) ?? null
  if (!isAdmin && !latest) throw new ServiceError(403, 'month_not_released')

  const states = releases.map(release => ({
    releasedAt: release.releasedAt, releasedBy: release.releasedBy, cells: snapshotCells(release.data),
  }))
  const changes = toChangeDtos(changeHistory(states))
  const shown: SnapshotData = isAdmin ? buildSnapshot(db, year, month) : latest!.data

  const pendingChanges: Record<string, PendingChangeDto> = {}
  if (isAdmin && states.length > 0) {
    for (const diff of diffCells(states.at(-1)!.cells, snapshotCells(shown))) {
      pendingChanges[diff.key] = { before: diff.before, after: diff.after }
    }
  }

  const shownDays = new Map(shown.days.map(day => [day.date, day]))
  const days: DayRowDto[] = monthDates(year, month).map(date => ({
    date,
    weekday: weekday(date),
    isWeekend: isWeekend(date),
    holidayKey: holidayOn(date),
    closureLabel: shownDays.get(date)?.closureLabel ?? null,
    info1: shownDays.get(date)?.info1 ?? '',
    info2: shownDays.get(date)?.info2 ?? '',
  }))

  let admin: MonthPlanAdminDto | null = null
  if (isAdmin) {
    const { monthStart, monthEnd } = monthBounds(year, month)
    const staff = loadEmployees(db).filter(employee => isEmployedInRange(employee.info, monthStart, monthEnd))
    admin = { ...buildAdminData(db, staff, loadClosures(db), year, month, today), pendingChanges }
  }

  return {
    year,
    month,
    release: {
      releasedAt: latest?.releasedAt ?? null,
      releasedBy: latest?.releasedBy ?? null,
      changeCount: Object.keys(changes).length,
      pendingCount: Object.keys(pendingChanges).length,
    },
    days,
    employees: shown.employees,
    entries: shown.entries,
    changes,
    templates: loadTemplates(db),
    codes: loadCodes(db),
    admin,
  }
}
```
- `buildAdminData` keeps its signature and returns the three existing fields; its return type becomes `Omit<MonthPlanAdminDto, 'pendingChanges'>`.
- `getMyPlan` stays as it is (it already forces the observer view and counts own changed days); its `release` spread now also carries `pendingCount: 0`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run` then `npm run typecheck`
Expected: all PASS; typecheck exit 0 may still fail in UI files that read removed fields — that is fixed in Task 4; if so, record the errors in the report and continue to commit only after `npx vitest run` passes.

- [ ] **Step 6: Commit**

```
git add shared/types/api.ts server/services/plan.ts tests/services/plan.test.ts
git commit -m "feat: serve observers the released snapshot and admins pending changes"
```

---

### Task 4: UI for released and pending changes

**Files:**
- Modify: `app/locales/de.ts`
- Create: `app/utils/changes.ts`
- Modify: `app/components/plan/PlanHeader.vue`, `app/components/plan/PlanGrid.vue`, `app/pages/plan/[year]/[month].vue`, `app/pages/my/plan/[year]/[month].vue`

**Interfaces:**
- Consumes: `MonthPlanDto.changes`, `MonthPlanDto.admin.pendingChanges`, `ReleaseDto.pendingCount` (Task 3)
- Produces: `releasedChangeText(changes: ChangeDto[] | undefined): string | undefined`, `pendingChangeText(change: PendingChangeDto | undefined): string | undefined`

- [ ] **Step 1: Update texts**

In `app/locales/de.ts` inside `plan`: remove `changesSinceRelease`, `unrelease`, `unreleaseConfirm`, `changedTooltip`; add:
```ts
    changesCount: (count: number) => (count === 1 ? '1 Änderung' : `${count} Änderungen`),
    releasedChanges: (count: number) => (count === 1 ? '1 freigegebene Änderung' : `${count} freigegebene Änderungen`),
    pendingChanges: (count: number) => `${count} noch nicht freigegeben`,
    releasedChangeTooltip: (at: string, by: string, before: string, after: string) => `Freigabe ${at} (${by}): ${before} → ${after}`,
    pendingTooltip: (before: string, after: string) => `Noch nicht freigegeben: ${before} → ${after}`,
```

- [ ] **Step 2: Add the tooltip helpers**

`app/utils/changes.ts`:
```ts
import type { ChangeDto, PendingChangeDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDateTime } from '~/utils/format'

/** One line per release in which the cell changed, oldest first. */
export function releasedChangeText(changes: ChangeDto[] | undefined): string | undefined {
  if (!changes?.length) return undefined
  return changes
    .map(change => de.plan.releasedChangeTooltip(
      formatDateTime(change.changedAt), change.changedBy, change.before || de.plan.empty, change.after || de.plan.empty,
    ))
    .join('\n')
}

export function pendingChangeText(change: PendingChangeDto | undefined): string | undefined {
  return change ? de.plan.pendingTooltip(change.before || de.plan.empty, change.after || de.plan.empty) : undefined
}
```

- [ ] **Step 3: Update the header**

`app/components/plan/PlanHeader.vue`: remove the `unrelease` emit and the "Freigabe zurückziehen" button; replace the change badge with:
```vue
    <UBadge
      v-if="plan.release.changeCount > 0" color="warning" variant="soft"
      :label="isAdmin ? de.plan.releasedChanges(plan.release.changeCount) : de.plan.changesCount(plan.release.changeCount)"
    />
    <UBadge v-if="isAdmin && plan.release.pendingCount > 0" color="warning" variant="outline" :label="de.plan.pendingChanges(plan.release.pendingCount)" />
```

- [ ] **Step 4: Update the grid**

In `app/components/plan/PlanGrid.vue`:
- import `{ pendingChangeText, releasedChangeText } from '~/utils/changes'`; delete the local `changeText` function (and the now-unused `formatDateTime` import).
- in `rows`, per cell: `const pending = props.plan.admin?.pendingChanges[key]`, add `pending: Boolean(pending)`, and set `title: joinLines([pendingChangeText(pending), releasedChangeText(props.plan.changes[key]), ...cellWarnings.map(warning => warningText(warning, employeeNames.value))])`.
- per note: same with `noteKey`: `pending: Boolean(notePending)`, `title: joinLines([pendingChangeText(notePending), releasedChangeText(props.plan.changes[key])])`.
- add a helper and use it for both cell and note `:class` entries instead of the current `changed ? 'outline-2 …' : ''` expressions:
```ts
function markClass(item: { pending: boolean; changed: boolean }): string {
  if (item.pending) return 'outline-2 -outline-offset-2 outline-dashed outline-orange-500'
  return item.changed ? 'outline-2 -outline-offset-2 outline-orange-400' : ''
}
```

- [ ] **Step 5: Update the pages**

`app/pages/plan/[year]/[month].vue`: delete the `unrelease` function and the `@unrelease="unrelease"` listener.

`app/pages/my/plan/[year]/[month].vue`: replace the body of `changeTitle` with `return releasedChangeText(day.changes)` (import from `~/utils/changes`; drop the unused `formatDateTime` import) and change the badge label to `de.plan.changesCount(data.release.changeCount)`.

- [ ] **Step 6: Verify**

Run: `npx vitest run` and `npm run typecheck` — Expected: all PASS, exit 0.
Then with `npm run dev` (dev DB): the dev server log shows `Created release snapshots for 1 previously released month(s).` on first start (October 2026). Check in the browser as admin `admin` / `admin-dev-5678`:
1. `/plan/2026/10`: no "Freigabe zurückziehen"; change a cell → dashed orange outline, tooltip "Noch nicht freigegeben: … → …", badge "1 noch nicht freigegeben".
2. Log in as `berta` / `berta-dev-5678` in a second session (or log out/in): the change is NOT visible.
3. As admin "Erneut freigeben" → dashed becomes solid orange; badge "1 freigegebene Änderung"; observer now sees the new entry with solid orange outline and tooltip "Freigabe dd.mm.yyyy hh:mm (admin): … → …"; "Mein Dienstplan" shows the same.
4. Change and release once more → the cell's tooltip lists both releases.

- [ ] **Step 7: Commit**

```
git add app
git commit -m "feat: show released and pending changes, remove unrelease"
```
