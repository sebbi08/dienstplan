# Zeiterfassung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Employees clock in/out themselves (own login or shared tablet with PIN); only the admin corrects records; recorded time replaces planned time for past days in the overtime account and is shown while planning.

**Architecture:** New tables `time_records`, `time_record_changes`, `app_settings` and PIN columns on `employees`; a new role `terminal`. Pure rules live in `shared/domain/timeRecords.ts` and an optional `ActualTime` argument of the existing balance functions (no argument = old behaviour). Server services `appSettings.ts`, `timeTracking.ts`, `terminal.ts`; thin API handlers; Vue pages `/terminal`, `/admin/time`, a stamp card on “Mein Dienstplan”, “Ist” in plan cells.

**Tech Stack:** Nuxt 4.5, Nuxt UI 4, nuxt-auth-utils, Drizzle ORM 0.45 + better-sqlite3, zod 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-01-zeiterfassung-design.md` (extends `docs/superpowers/specs/2026-09-30-dienstplan-kindergarten-design.md`).

## Global Constraints

- UI German, all code (identifiers, comments, commits) English.
- Times are minutes since midnight (`Minutes`), dates ISO strings (`IsoDate`), timezone Europe/Berlin; date/time of a stamp always from the server (`nowInBerlin(new Date())`).
- Stamps are minute-precise; admin corrections minute-precise (no 5-minute grid).
- No automatic break deduction, no rounding.
- Days with a code whose credit mode is `daily_target` (Urlaub, Krank, Fortbildung, Schule, Feiertag, Schließtag) are credited with the daily target; records do not count there. These codes come from the plan only.
- Credit from records only for `timeTrackingFrom ≤ date < today`; today and later use the plan; open records count 0.
- “Stand heute” = balance until **yesterday** when time tracking is active (`timeTrackingFrom ≤ today`), otherwise unchanged (until today).
- PIN: exactly 4 digits, stored as hash (`hashPassword`/`verifyPassword`); 5 wrong attempts lock the person at the tablet for 15 minutes.
- Role `terminal`: no employee link, no forced password change, may only call `/api/terminal/*` and `GET /api/plan/:year/:month` (observer view).
- Services take `db` first and `now: Date = new Date()` where time matters; handlers use `defineServiceHandler`, `requireAdmin` / `requireUser` / `requireTerminal`.
- Every new API route is classified in `tests/api/permissions.test.ts`.
- Typed `$fetch` in Vue uses `$fetch<unknown>(...)` for mutations (TS2321 workaround); confirmations via `useConfirm()`, never `window.confirm`.
- Refresh PATH in every PowerShell call: `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`.
- Browser tests only in empty far-future months / with test employees; clean up afterwards; never touch the user's real data.

## Review Focus

1. Clock change (last Sunday of March/October): `nowInBerlin` must return the Berlin wall-clock time, not UTC — pinned in Task 2.
2. Double tap on “Einstempeln” (phone or tablet) must not create two open records — pinned in Task 5 (`already_clocked_in`).
3. A record left open yesterday must not block clocking in today and must not count — pinned in Tasks 3 and 5.
4. Admin correction with end before start, overlap with another record, or a future date must be rejected without changing data — pinned in Task 8.
5. Changing “Zeiterfassung ab” after records exist: records before the date are ignored for the account, nothing is deleted — pinned in Task 6.

---

### Task 1: Database schema, migration and the `terminal` role

**Files:**
- Modify: `server/db/schema.ts`
- Create: `server/db/migrations/0004_time_tracking.sql` (generated, then checked)
- Modify: `shared/types/api.ts` (`Role`)
- Modify: `server/services/users.ts`, `server/schemas.ts`
- Test: `tests/services/users.test.ts` (extend; create if missing — check with Glob first)

**Interfaces:**
- Produces: tables `timeRecords`, `timeRecordChanges`, `appSettings`; columns `employees.pinHash`, `employees.pinFailed`, `employees.pinLockedUntil`; `Role = 'admin' | 'observer' | 'terminal'`; error `terminal_no_employee`.

- [ ] **Step 1: Write the failing test** (`tests/services/users.test.ts` exists: append this `describe` block and merge the imports with the existing ones)

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { createUser, updateUser } from '../../server/services/users'
import { addEmployee, createTestDb, errorCode } from '../helpers/fixtures'

describe('terminal users', () => {
  let db: Db
  beforeEach(() => {
    db = createTestDb()
  })
  it('creates a terminal user without employee and without forced password change', () => {
    const user = createUser(db, { username: 'Tablet', password: 'tablet-password', role: 'terminal', employeeId: null })
    expect(user).toMatchObject({ username: 'tablet', role: 'terminal', employeeId: null, mustChangePassword: false })
  })
  it('rejects a terminal user linked to an employee', () => {
    const anna = addEmployee(db, 'Anna')
    expect(errorCode(() => createUser(db, { username: 'tablet', password: 'tablet-password', role: 'terminal', employeeId: anna })))
      .toBe('terminal_no_employee')
    const user = createUser(db, { username: 'tablet', password: 'tablet-password', role: 'terminal', employeeId: null })
    expect(errorCode(() => updateUser(db, user.id, { role: 'terminal', employeeId: anna, active: true }))).toBe('terminal_no_employee')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/users.test.ts`
Expected: FAIL (type error / role not allowed).

- [ ] **Step 3: Schema**

In `server/db/schema.ts` add to `employees`:

```ts
  /** Hash of the 4-digit stamp PIN for the shared tablet (null = no PIN). */
  pinHash: text('pin_hash'),
  pinFailed: integer('pin_failed').notNull().default(0),
  pinLockedUntil: text('pin_locked_until'),
```

Change `users.role` to `text('role', { enum: ['admin', 'observer', 'terminal'] }).notNull()`.

Append the new tables:

```ts
/** One clocked period of a day; end null = still clocked in. */
export const timeRecords = sqliteTable('time_records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  start: integer('start').notNull(),
  end: integer('end'),
  source: text('source', { enum: ['self', 'terminal', 'admin'] }).notNull(),
  editedBy: integer('edited_by').references(() => users.id, { onDelete: 'set null' }),
  editedAt: text('edited_at'),
  createdAt: text('created_at').notNull(),
}, table => [index('time_records_employee_date').on(table.employeeId, table.date)])

/** Audit trail of admin corrections of time records. */
export const timeRecordChanges = sqliteTable('time_record_changes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  recordId: integer('record_id'),
  before: text('before').notNull(),
  after: text('after').notNull(),
  actorId: integer('actor_id').references(() => users.id, { onDelete: 'set null' }),
  at: text('at').notNull(),
}, table => [index('time_record_changes_employee_date').on(table.employeeId, table.date)])

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
```

- [ ] **Step 4: Generate the migration**

Run: `npx drizzle-kit generate --name time_tracking`
Expected: `server/db/migrations/0004_time_tracking.sql`. Open it and check: SQLite cannot alter an enum, drizzle stores enums as plain `text`, so the role change produces **no** SQL (correct). The file must contain `ALTER TABLE employees ADD ...` ×3 and `CREATE TABLE` for the three tables plus both indexes. If drizzle generated a table rebuild for `users`, keep it only if it copies all rows (`INSERT INTO __new_users SELECT ...`).

- [ ] **Step 5: Role type and user service**

`shared/types/api.ts`: `export type Role = 'admin' | 'observer' | 'terminal'`.

`server/schemas.ts`: in `userCreateSchema` and `userUpdateSchema` use `role: z.enum(['admin', 'observer', 'terminal'])`.

`server/services/users.ts`, in `assertEmployeeLink` first line:

```ts
  if (role === 'terminal' && employeeId !== null) throw new ServiceError(400, 'terminal_no_employee')
```

and in `createUser` set `mustChangePassword: input.role !== 'terminal'`.

- [ ] **Step 6: Run tests**

Run: `npx vitest run`
Expected: all PASS (including the new tests).

- [ ] **Step 7: Commit**

```bash
git add server/db/schema.ts server/db/migrations shared/types/api.ts server/schemas.ts server/services/users.ts tests/services/users.test.ts
git commit -m "feat: schema for time tracking and terminal role"
```

---

### Task 2: Domain rules for time records

**Files:**
- Create: `shared/domain/timeRecords.ts`
- Test: `tests/domain/timeRecords.test.ts`

**Interfaces:**
- Produces:
  - `interface RecordSpan { start: Minutes; end: Minutes | null }`
  - `recordedMinutes(records: RecordSpan[]): number`
  - `BREAK_MIN_GAP = 15`, `breakMinutes(records: RecordSpan[]): number`
  - `breakRuleViolated(records: RecordSpan[]): boolean`
  - `nowInBerlin(now: Date): { date: IsoDate; minutes: Minutes }`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { breakMinutes, breakRuleViolated, nowInBerlin, recordedMinutes } from '../../shared/domain/timeRecords'

const span = (start: number, end: number | null) => ({ start, end })

describe('recordedMinutes', () => {
  it('sums closed records and ignores open ones', () => {
    expect(recordedMinutes([span(462, 700), span(730, 963)])).toBe(238 + 233)
    expect(recordedMinutes([span(462, 700), span(730, null)])).toBe(238)
    expect(recordedMinutes([])).toBe(0)
  })
})

describe('breaks', () => {
  it('counts only gaps of at least 15 minutes between closed records', () => {
    expect(breakMinutes([span(420, 700), span(730, 900)])).toBe(30)
    expect(breakMinutes([span(420, 700), span(710, 900)])).toBe(0)
    expect(breakMinutes([span(730, 900), span(420, 700)])).toBe(30)
  })
  it('flags more than 6 h without 30 min and more than 9 h without 45 min', () => {
    expect(breakRuleViolated([span(420, 780)])).toBe(false) // exactly 6 h
    expect(breakRuleViolated([span(420, 781)])).toBe(true)
    expect(breakRuleViolated([span(420, 700), span(730, 980)])).toBe(false) // 8:50 h, 30 min break
    expect(breakRuleViolated([span(420, 700), span(730, 1020)])).toBe(true) // 9:30 h, 30 min break
    expect(breakRuleViolated([span(420, 700), span(745, 1035)])).toBe(false) // 9:30 h, 45 min break
    expect(breakRuleViolated([span(420, 700), span(710, 1000)])).toBe(true) // 10 min gap does not count
  })
})

describe('nowInBerlin', () => {
  it('returns Berlin wall-clock date and minutes in summer and winter time', () => {
    expect(nowInBerlin(new Date('2026-07-01T05:42:00Z'))).toEqual({ date: '2026-07-01', minutes: 462 })
    expect(nowInBerlin(new Date('2026-12-01T06:42:00Z'))).toEqual({ date: '2026-12-01', minutes: 462 })
    expect(nowInBerlin(new Date('2026-10-25T00:30:00Z'))).toEqual({ date: '2026-10-25', minutes: 150 }) // still CEST
    expect(nowInBerlin(new Date('2026-10-25T01:30:00Z'))).toEqual({ date: '2026-10-25', minutes: 150 }) // CET again
    expect(nowInBerlin(new Date('2026-12-31T23:30:00Z'))).toEqual({ date: '2027-01-01', minutes: 30 })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/domain/timeRecords.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import type { IsoDate, Minutes } from './types'

/** A clocked period of one day; end null = still clocked in. */
export interface RecordSpan {
  start: Minutes
  end: Minutes | null
}

function closed(records: RecordSpan[]): { start: Minutes; end: Minutes }[] {
  return records
    .filter((record): record is { start: Minutes; end: Minutes } => record.end !== null)
    .sort((a, b) => a.start - b.start)
}

/** Worked minutes of one day: the sum of its closed records (gaps are breaks, open records count 0). */
export function recordedMinutes(records: RecordSpan[]): number {
  return closed(records).reduce((sum, record) => sum + (record.end - record.start), 0)
}

/** Only interruptions of at least 15 minutes count as legal break parts (§ 4 ArbZG). */
export const BREAK_MIN_GAP = 15

export function breakMinutes(records: RecordSpan[]): number {
  const sorted = closed(records)
  let total = 0
  for (let index = 1; index < sorted.length; index++) {
    const gap = sorted[index]!.start - sorted[index - 1]!.end
    if (gap >= BREAK_MIN_GAP) total += gap
  }
  return total
}

/** More than 6 h needs 30 min break, more than 9 h needs 45 min. Only a hint; nothing is deducted. */
export function breakRuleViolated(records: RecordSpan[]): boolean {
  const worked = recordedMinutes(records)
  const required = worked > 9 * 60 ? 45 : worked > 6 * 60 ? 30 : 0
  return breakMinutes(records) < required
}

const berlinClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/** Current date and minute of the day in Europe/Berlin (stamps never use the device clock). */
export function nowInBerlin(now: Date): { date: IsoDate; minutes: Minutes } {
  const parts = Object.fromEntries(berlinClock.formatToParts(now).map(part => [part.type, part.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/domain/timeRecords.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/domain/timeRecords.ts tests/domain/timeRecords.test.ts
git commit -m "feat: domain rules for time records"
```

---

### Task 3: Balance with recorded time (`ActualTime`)

**Files:**
- Modify: `shared/domain/balance.ts`
- Test: `tests/domain/balance.test.ts` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `interface ActualTime { from: IsoDate; today: IsoDate; minutesByDate: Map<IsoDate, number> }`
  - `usesRecords(actual: ActualTime | undefined, date: IsoDate): boolean`
  - `computeDay(info, date, entries, actual?: ActualTime): DayResult`
  - `computeRange(info, entries, from, to, actual?: ActualTime): DayResult[]`
  - `balanceUntil(info, entries, adjustments, until, actual?: ActualTime): number`

- [ ] **Step 1: Write the failing tests** (append to `tests/domain/balance.test.ts`; `info`, `day`, `M`, `shift`, `code` already exist there — check the file header and reuse its `info` constant; if its name differs, adapt the variable name only)

```ts
describe('recorded time (Zeiterfassung)', () => {
  const actual = (minutes: Record<string, number>, from = '2026-10-01', today = '2026-10-08'): ActualTime =>
    ({ from, today, minutesByDate: new Map(Object.entries(minutes)) })
  const planned = [shift(1, '2026-10-06', ...M), shift(1, '2026-10-08', ...M)]

  it('uses records for days from the start date until yesterday', () => {
    expect(usesRecords(actual({}), '2026-10-07')).toBe(true)
    expect(usesRecords(actual({}), '2026-10-08')).toBe(false) // today: plan
    expect(usesRecords(actual({}), '2026-09-30')).toBe(false) // before the start date
    expect(usesRecords(undefined, '2026-10-07')).toBe(false)
  })
  it('credits recorded minutes instead of the plan for past days', () => {
    expect(computeDay(info, '2026-10-06', planned, actual({ '2026-10-06': 500 })).credit).toBe(500)
    expect(computeDay(info, '2026-10-07', [], actual({})).credit).toBe(0) // nothing recorded
    expect(computeDay(info, '2026-10-08', planned, actual({ '2026-10-08': 10 })).credit).toBe(465) // today: plan
  })
  it('keeps the daily target for absence codes even with records', () => {
    const sick = [code(1, '2026-10-06', 'sick', 'daily_target')]
    expect(computeDay(info, '2026-10-06', sick, actual({ '2026-10-06': 180 })).credit).toBe(468)
  })
  it('counts weekend records as plus', () => {
    expect(computeDay(info, '2026-10-04', [], actual({ '2026-10-04': 240 })).delta).toBe(240)
  })
  it('ignores records before the start date (start date moved later)', () => {
    expect(computeDay(info, '2026-10-06', planned, actual({ '2026-10-06': 500 }, '2026-10-07')).credit).toBe(465)
  })
  it('passes the records through computeRange and balanceUntil', () => {
    const records = actual({ '2026-10-06': 500 })
    expect(computeRange(info, planned, '2026-10-06', '2026-10-06', records)[0]!.credit).toBe(500)
    expect(balanceUntil(info, planned, [], '2026-10-06', records))
      .toBe(balanceUntil(info, planned, [], '2026-10-06') + (500 - 465))
  })
})
```

Add `ActualTime` and `usesRecords` to the import from `../../shared/domain/balance`. `info` must be an `EmploymentInfo` with 39 h valid from before 2026-10-01 (target 468); if the file's `info` starts later, define `const info: EmploymentInfo = { hours: [{ weeklyMinutes: 2340, validFrom: '2026-01-01' }], leftOn: null }` inside this `describe`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/domain/balance.test.ts`
Expected: FAIL (`usesRecords` not exported).

- [ ] **Step 3: Implement** — replace `computeDay`, `computeRange`, `balanceUntil` in `shared/domain/balance.ts`:

```ts
/** Recorded time replaces the plan for days in [from, today) (Zeiterfassung). */
export interface ActualTime {
  /** First day credited from time records ("Zeiterfassung ab"). */
  from: IsoDate
  /** Today: today and later days still use the plan as forecast. */
  today: IsoDate
  /** Recorded minutes (closed records only) per date of one employee. */
  minutesByDate: Map<IsoDate, number>
}

export function usesRecords(actual: ActualTime | undefined, date: IsoDate): boolean {
  return actual !== undefined && actual.from <= date && date < actual.today
}

export function computeDay(info: EmploymentInfo, date: IsoDate, entries: DomainEntry[], actual?: ActualTime): DayResult {
  const target = dailyTarget(info, date)
  let credit = 0
  if (isEmployedOn(info, date)) {
    credit = entries.some(entry => entry.creditMode === 'daily_target') || !usesRecords(actual, date)
      ? dayCredit(entries, target)
      : actual!.minutesByDate.get(date) ?? 0
  }
  return { date, target, credit, delta: credit - target }
}

export function computeRange(
  info: EmploymentInfo, entries: DomainEntry[], from: IsoDate, to: IsoDate, actual?: ActualTime,
): DayResult[] {
  const byDate = new Map<IsoDate, DomainEntry[]>()
  for (const entry of entries) {
    if (entry.date < from || entry.date > to) continue
    const list = byDate.get(entry.date) ?? []
    list.push(entry)
    byDate.set(entry.date, list)
  }
  return dateRange(from, to).map(date => computeDay(info, date, byDate.get(date) ?? [], actual))
}
```

and in `balanceUntil` add the parameter `actual?: ActualTime` and pass it: `summarize(computeRange(info, entries, start, until, actual)).delta`. Add `IsoDate` to the type import if missing.

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: all PASS (existing callers pass no `actual`, so behaviour is unchanged).

- [ ] **Step 5: Commit**

```bash
git add shared/domain/balance.ts tests/domain/balance.test.ts
git commit -m "feat: credit recorded time for past days in the balance"
```

---

### Task 4: App setting “Zeiterfassung ab”

**Files:**
- Create: `server/services/appSettings.ts`, `server/api/app-settings.get.ts`, `server/api/app-settings.put.ts`
- Modify: `server/schemas.ts`, `shared/types/api.ts`, `tests/api/permissions.test.ts` (nothing to add — both routes use `requireAdmin(`)
- Test: `tests/services/appSettings.test.ts`

**Interfaces:**
- Produces:
  - `AppSettingsDto { timeTrackingFrom: IsoDate | null }` (shared/types/api.ts)
  - `getTimeTrackingFrom(db: Db): IsoDate | null`
  - `setTimeTrackingFrom(db: Db, value: IsoDate | null): void`
  - `activeTrackingFrom(db: Db, today: IsoDate): IsoDate | null` — the start date if it is ≤ today, else null
  - `appSettingsSchema = z.object({ timeTrackingFrom: isoDate.nullable() })`

- [ ] **Step 1: Failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { activeTrackingFrom, getTimeTrackingFrom, setTimeTrackingFrom } from '../../server/services/appSettings'
import { createTestDb } from '../helpers/fixtures'

describe('app settings', () => {
  let db: Db
  beforeEach(() => {
    db = createTestDb()
  })
  it('stores, replaces and clears the time tracking start date', () => {
    expect(getTimeTrackingFrom(db)).toBeNull()
    setTimeTrackingFrom(db, '2026-11-01')
    setTimeTrackingFrom(db, '2026-10-15')
    expect(getTimeTrackingFrom(db)).toBe('2026-10-15')
    setTimeTrackingFrom(db, null)
    expect(getTimeTrackingFrom(db)).toBeNull()
  })
  it('is active only from the start date on', () => {
    setTimeTrackingFrom(db, '2026-11-01')
    expect(activeTrackingFrom(db, '2026-10-31')).toBeNull()
    expect(activeTrackingFrom(db, '2026-11-01')).toBe('2026-11-01')
  })
})
```

- [ ] **Step 2: Run** `npx vitest run tests/services/appSettings.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`server/services/appSettings.ts`:

```ts
import { eq } from 'drizzle-orm'
import type { IsoDate } from '../../shared/domain/types'
import type { AppSettingsDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { appSettings } from '../db/schema'

const TIME_TRACKING_FROM = 'time_tracking_from'

export function getTimeTrackingFrom(db: Db): IsoDate | null {
  return db.select().from(appSettings).where(eq(appSettings.key, TIME_TRACKING_FROM)).get()?.value ?? null
}

export function setTimeTrackingFrom(db: Db, value: IsoDate | null): void {
  if (value === null) {
    db.delete(appSettings).where(eq(appSettings.key, TIME_TRACKING_FROM)).run()
    return
  }
  db.insert(appSettings).values({ key: TIME_TRACKING_FROM, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } }).run()
}

/** The start date when time tracking already runs today, otherwise null (plan only). */
export function activeTrackingFrom(db: Db, today: IsoDate): IsoDate | null {
  const from = getTimeTrackingFrom(db)
  return from !== null && from <= today ? from : null
}

export function getAppSettings(db: Db): AppSettingsDto {
  return { timeTrackingFrom: getTimeTrackingFrom(db) }
}
```

`shared/types/api.ts`: `export interface AppSettingsDto { timeTrackingFrom: IsoDate | null }`.

`server/schemas.ts`: `export const appSettingsSchema = z.object({ timeTrackingFrom: isoDate.nullable() })`.

`server/api/app-settings.get.ts`:

```ts
import { getAppSettings } from '../services/appSettings'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  return getAppSettings(useDb())
})
```

`server/api/app-settings.put.ts`:

```ts
import { appSettingsSchema } from '../schemas'
import { getAppSettings, setTimeTrackingFrom } from '../services/appSettings'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { timeTrackingFrom } = await readValidatedBody(event, appSettingsSchema.parse)
  setTimeTrackingFrom(useDb(), timeTrackingFrom)
  return getAppSettings(useDb())
})
```

- [ ] **Step 4: Run** `npx vitest run` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/appSettings.ts server/api/app-settings.get.ts server/api/app-settings.put.ts server/schemas.ts shared/types/api.ts tests/services/appSettings.test.ts
git commit -m "feat: app setting for the time tracking start date"
```

---

### Task 5: Stamping service and recorded-time lookup

**Files:**
- Create: `server/services/timeTracking.ts`
- Modify: `shared/types/api.ts`
- Test: `tests/services/timeTracking.test.ts`

**Interfaces:**
- Consumes: `nowInBerlin`, `recordedMinutes` (Task 2), `ActualTime` (Task 3), `activeTrackingFrom` (Task 4).
- Produces:
  - `TimeRecordDto { id; employeeId; date: IsoDate; start: Minutes; end: Minutes | null; source: 'self' | 'terminal' | 'admin'; edited: boolean; editedBy: string | null; editedAt: string | null }`
  - `StampAction = 'in' | 'out'` (shared/types/api.ts)
  - `loadTimeRecords(db, filter: { employeeId?: number; from?: IsoDate; to?: IsoDate }): TimeRecordDto[]` ordered by date, start
  - `actualTimeFor(db: Db, today: IsoDate): ((employeeId: number) => ActualTime | undefined)` — undefined when tracking is not active
  - `stamp(db: Db, employeeId: number, action: StampAction, source: 'self' | 'terminal', now?: Date): TimeRecordDto`
  - errors `time_tracking_off`, `already_clocked_in`, `not_clocked_in`, `employee_not_found`

- [ ] **Step 1: Failing tests**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { actualTimeFor, loadTimeRecords, stamp } from '../../server/services/timeTracking'
import { addEmployee, createTestDb, errorCode } from '../helpers/fixtures'

const at = (iso: string) => new Date(iso) // UTC; October 2026 is CEST (UTC+2)

describe('stamping', () => {
  let db: Db
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    anna = addEmployee(db, 'Anna')
    setTimeTrackingFrom(db, '2026-10-01')
  })
  const records = () => loadTimeRecords(db, { employeeId: anna })

  it('clocks in and out with server time', () => {
    stamp(db, anna, 'in', 'self', at('2026-10-06T05:42:00Z'))
    stamp(db, anna, 'out', 'self', at('2026-10-06T09:40:00Z'))
    stamp(db, anna, 'in', 'terminal', at('2026-10-06T10:10:00Z'))
    expect(records().map(r => [r.date, r.start, r.end, r.source])).toEqual([
      ['2026-10-06', 462, 700, 'self'], ['2026-10-06', 730, null, 'terminal'],
    ])
  })
  it('rejects double clock-in and clock-out without clock-in', () => {
    stamp(db, anna, 'in', 'self', at('2026-10-06T05:42:00Z'))
    expect(errorCode(() => stamp(db, anna, 'in', 'terminal', at('2026-10-06T05:42:30Z')))).toBe('already_clocked_in')
    expect(records()).toHaveLength(1)
    stamp(db, anna, 'out', 'self', at('2026-10-06T09:40:00Z'))
    expect(errorCode(() => stamp(db, anna, 'out', 'self', at('2026-10-06T09:41:00Z')))).toBe('not_clocked_in')
  })
  it('lets a record left open yesterday stay open and clocks in today', () => {
    stamp(db, anna, 'in', 'self', at('2026-10-05T05:42:00Z'))
    stamp(db, anna, 'in', 'self', at('2026-10-06T05:45:00Z'))
    expect(errorCode(() => stamp(db, anna, 'out', 'self', at('2026-10-07T05:00:00Z')))).toBe('not_clocked_in')
    expect(records().map(r => [r.date, r.end])).toEqual([['2026-10-05', null], ['2026-10-06', null]])
  })
  it('allows a zero-minute record', () => {
    stamp(db, anna, 'in', 'self', at('2026-10-06T05:42:10Z'))
    stamp(db, anna, 'out', 'self', at('2026-10-06T05:42:50Z'))
    expect(records()[0]).toMatchObject({ start: 462, end: 462 })
  })
  it('refuses stamping before the start date or without tracking', () => {
    expect(errorCode(() => stamp(db, anna, 'in', 'self', at('2026-09-30T06:00:00Z')))).toBe('time_tracking_off')
    setTimeTrackingFrom(db, null)
    expect(errorCode(() => stamp(db, anna, 'in', 'self', at('2026-10-06T06:00:00Z')))).toBe('time_tracking_off')
  })
  it('provides recorded minutes per day for the balance (closed records only)', () => {
    stamp(db, anna, 'in', 'self', at('2026-10-06T05:42:00Z'))
    stamp(db, anna, 'out', 'self', at('2026-10-06T09:40:00Z'))
    stamp(db, anna, 'in', 'self', at('2026-10-06T10:10:00Z'))
    const actual = actualTimeFor(db, '2026-10-08')(anna)!
    expect(actual).toMatchObject({ from: '2026-10-01', today: '2026-10-08' })
    expect(actual.minutesByDate.get('2026-10-06')).toBe(238)
    expect(actualTimeFor(db, '2026-09-30')(anna)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run** `npx vitest run tests/services/timeTracking.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`shared/types/api.ts`:

```ts
export type StampAction = 'in' | 'out'
export type TimeRecordSource = 'self' | 'terminal' | 'admin'

export interface TimeRecordDto {
  id: number
  employeeId: number
  date: IsoDate
  start: Minutes
  end: Minutes | null
  source: TimeRecordSource
  /** Created or changed by the admin. */
  edited: boolean
  editedBy: string | null
  editedAt: string | null
}
```

`server/services/timeTracking.ts`:

```ts
import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm'
import type { ActualTime } from '../../shared/domain/balance'
import { nowInBerlin, recordedMinutes } from '../../shared/domain/timeRecords'
import type { IsoDate } from '../../shared/domain/types'
import type { StampAction, TimeRecordDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, timeRecords, users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { activeTrackingFrom } from './appSettings'

export interface TimeRecordFilter {
  employeeId?: number
  from?: IsoDate
  to?: IsoDate
}

export function loadTimeRecords(db: Db, filter: TimeRecordFilter = {}): TimeRecordDto[] {
  return db.select({ record: timeRecords, editor: users.username })
    .from(timeRecords)
    .leftJoin(users, eq(timeRecords.editedBy, users.id))
    .where(and(
      filter.employeeId !== undefined ? eq(timeRecords.employeeId, filter.employeeId) : undefined,
      filter.from ? gte(timeRecords.date, filter.from) : undefined,
      filter.to ? lte(timeRecords.date, filter.to) : undefined,
    ))
    .orderBy(asc(timeRecords.date), asc(timeRecords.start), asc(timeRecords.id))
    .all()
    .map(({ record, editor }) => ({
      id: record.id, employeeId: record.employeeId, date: record.date, start: record.start, end: record.end,
      source: record.source, edited: record.source === 'admin' || record.editedAt !== null,
      editedBy: editor ?? null, editedAt: record.editedAt,
    }))
}

/** Per employee: recorded minutes for the balance, or undefined while time tracking is not active. */
export function actualTimeFor(db: Db, today: IsoDate): (employeeId: number) => ActualTime | undefined {
  const from = activeTrackingFrom(db, today)
  if (from === null) return () => undefined
  const byEmployee = new Map<number, Map<IsoDate, TimeRecordDto[]>>()
  for (const record of loadTimeRecords(db, { from })) {
    const days = byEmployee.get(record.employeeId) ?? new Map<IsoDate, TimeRecordDto[]>()
    days.set(record.date, [...(days.get(record.date) ?? []), record])
    byEmployee.set(record.employeeId, days)
  }
  return (employeeId) => {
    const minutesByDate = new Map<IsoDate, number>()
    for (const [date, list] of byEmployee.get(employeeId) ?? []) minutesByDate.set(date, recordedMinutes(list))
    return { from, today, minutesByDate }
  }
}

/** Clocks the employee in or out now. Only today's open record can be closed; older ones are fixed by the admin. */
export function stamp(db: Db, employeeId: number, action: StampAction, source: 'self' | 'terminal', now: Date = new Date()): TimeRecordDto {
  const { date, minutes } = nowInBerlin(now)
  if (activeTrackingFrom(db, date) === null) throw new ServiceError(400, 'time_tracking_off')
  if (!db.select().from(employees).where(eq(employees.id, employeeId)).get()) throw new ServiceError(404, 'employee_not_found')

  return db.transaction((tx) => {
    const open = tx.select().from(timeRecords)
      .where(and(eq(timeRecords.employeeId, employeeId), eq(timeRecords.date, date), isNull(timeRecords.end))).get()
    let id: number
    if (action === 'in') {
      if (open) throw new ServiceError(409, 'already_clocked_in')
      id = tx.insert(timeRecords).values({
        employeeId, date, start: minutes, end: null, source, createdAt: now.toISOString(),
      }).returning().get().id
    }
    else {
      if (!open) throw new ServiceError(409, 'not_clocked_in')
      tx.update(timeRecords).set({ end: Math.max(minutes, open.start) }).where(eq(timeRecords.id, open.id)).run()
      id = open.id
    }
    return loadTimeRecords(tx, { employeeId, from: date, to: date }).find(record => record.id === id)!
  })
}
```

- [ ] **Step 4: Run** `npx vitest run` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/timeTracking.ts shared/types/api.ts tests/services/timeTracking.test.ts
git commit -m "feat: stamping service and recorded time per day"
```

---

### Task 6: Balances, plan weeks, time warnings and “Ist” per cell

**Files:**
- Modify: `shared/domain/warnings.ts`, `server/services/balances.ts`, `server/services/plan.ts`, `shared/types/api.ts`, `app/utils/warnings.ts`, `app/locales/de.ts`
- Test: `tests/services/balances.test.ts` (append), `tests/domain/warnings.test.ts` (append; create the describe block at the end)

**Interfaces:**
- Consumes: `actualTimeFor`, `loadTimeRecords` (Task 5), `activeTrackingFrom` (Task 4), `usesRecords` (Task 3), `RecordSpan`, `breakRuleViolated`, `recordedMinutes` (Task 2).
- Produces:
  - `Warning` additions: `{ type: 'open_record'; date; employeeId }`, `{ type: 'missing_record'; date; employeeId }`, `{ type: 'break_rule'; date; employeeId }`, `{ type: 'record_without_plan'; date; employeeId }`
  - `timeWarnings(date: IsoDate, employeeId: number, entries: DomainEntry[], records: RecordSpan[]): Warning[]` (caller only calls it for employed days with `from ≤ date < today`)
  - `ActualCellDto { minutes: number; open: boolean; deviates: boolean }`; `MonthPlanAdminDto.actuals: Record<string, ActualCellDto>` keyed by `cellKey`
  - `BalanceDto.today` = until yesterday when tracking is active

- [ ] **Step 1: Failing tests**

Append to `tests/domain/warnings.test.ts`:

```ts
describe('timeWarnings', () => {
  const date = '2026-10-06'
  const records = (...spans: [number, number | null][]) => spans.map(([start, end]) => ({ start, end }))
  it('reports open records, missing records, break rule and records without plan', () => {
    expect(timeWarnings(date, 1, [shift(1, date, ...M)], records([465, null])).map(w => w.type)).toEqual(['open_record'])
    expect(timeWarnings(date, 1, [shift(1, date, ...M)], []).map(w => w.type)).toEqual(['missing_record'])
    expect(timeWarnings(date, 1, [shift(1, date, ...M)], records([465, 960])).map(w => w.type)).toEqual(['break_rule'])
    expect(timeWarnings(date, 1, [], records([465, 700])).map(w => w.type)).toEqual(['record_without_plan'])
  })
  it('stays quiet for absences from the plan and for correct days', () => {
    expect(timeWarnings(date, 1, [code(1, date, 'sick', 'daily_target')], [])).toEqual([])
    expect(timeWarnings(date, 1, [shift(1, date, ...M)], records([465, 700], [730, 960]))).toEqual([])
    expect(timeWarnings(date, 1, [], [])).toEqual([])
  })
})
```

(import `timeWarnings` from `../../shared/domain/warnings` and `code`, `shift`, `M` from `../helpers/entries` if not already imported.)

Append to `tests/services/balances.test.ts` inside the existing `describe`:

```ts
  it('uses recorded time for past days and counts “today” until yesterday', () => {
    applyToCells(db, admin, week.map(date => ({ employeeId: anna, date })), 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    setTimeTrackingFrom(db, '2026-10-05')
    stamp(db, anna, 'in', 'self', new Date('2026-10-05T05:00:00Z')) // 7:00
    stamp(db, anna, 'out', 'self', new Date('2026-10-05T14:30:00Z')) // 16:30 → 570 min
    const [balance] = getBalanceOverview(db, 2026, 10, '2026-10-07')
    // 05.10.: 570 − 468; 06.10.: nothing recorded → −468; 07.10. (today) not included
    expect(balance!.today).toBe((570 - 468) - 468)
    // month end: 05./06. recorded, 07.–09. planned M (465 each), rest of October target only
    expect(balance!.monthEnd).toBe((570 - 468) - 468 + 3 * (465 - 468) - 15 * 468)
  })
  it('ignores records before the start date', () => {
    setTimeTrackingFrom(db, '2026-10-05')
    stamp(db, anna, 'in', 'self', new Date('2026-10-05T05:00:00Z'))
    stamp(db, anna, 'out', 'self', new Date('2026-10-05T14:30:00Z'))
    setTimeTrackingFrom(db, '2026-10-06')
    const [balance] = getBalanceOverview(db, 2026, 10, '2026-10-07')
    expect(balance!.today).toBe(-468 /* 05.10. plan: nothing planned */ - 468 /* 06.10. nothing recorded */)
  })
```

(imports: `setTimeTrackingFrom` from `../../server/services/appSettings`, `stamp` from `../../server/services/timeTracking`.)

- [ ] **Step 2: Run** `npx vitest run tests/domain/warnings.test.ts tests/services/balances.test.ts` → FAIL.

- [ ] **Step 3: Warnings** — in `shared/domain/warnings.ts` extend the union and add the function:

```ts
  | { type: 'open_record'; date: IsoDate; employeeId: number }
  | { type: 'missing_record'; date: IsoDate; employeeId: number }
  | { type: 'break_rule'; date: IsoDate; employeeId: number }
  | { type: 'record_without_plan'; date: IsoDate; employeeId: number }
```

```ts
/** Hints for one past day with time tracking (call only for employed days with start date ≤ date < today). */
export function timeWarnings(date: IsoDate, employeeId: number, entries: DomainEntry[], records: RecordSpan[]): Warning[] {
  if (entries.some(entry => entry.creditMode === 'daily_target')) return []
  const warnings: Warning[] = []
  if (records.some(record => record.end === null)) warnings.push({ type: 'open_record', date, employeeId })
  const plannedWork = entries.some(entry => entry.start !== null && entry.kind !== 'break'
    && (entry.kind !== 'code' || entry.creditMode === 'timed'))
  if (records.length === 0 && plannedWork) warnings.push({ type: 'missing_record', date, employeeId })
  if (records.length > 0 && entries.length === 0) warnings.push({ type: 'record_without_plan', date, employeeId })
  if (breakRuleViolated(records)) warnings.push({ type: 'break_rule', date, employeeId })
  return warnings
}
```

(import `breakRuleViolated`, `type RecordSpan` from `./timeRecords`.) Check the existing `dayWarnings` callers: they still compile because the union only grew.

- [ ] **Step 4: Balances** — `server/services/balances.ts`:

```ts
export function computeBalances(db: Db, staff: EmployeeRecord[], monthEnd: IsoDate, today: IsoDate): BalanceDto[] {
  const { year, month } = parseIsoDate(monthEnd)
  const previousMonthEnd = addDays(toIsoDate(year, month, 1), -1)
  const byEmployee = groupByEmployee(loadEntries(db))
  const adjustments = db.select().from(balanceAdjustments).all()
  const actualOf = actualTimeFor(db, today)
  // With time tracking, today is not finished yet: "Stand heute" ends yesterday.
  const todayUntil = activeTrackingFrom(db, today) !== null ? addDays(today, -1) : today
  return staff.map((employee) => {
    const own = byEmployee.get(employee.id) ?? []
    const ownAdjustments = adjustments.filter(a => a.employeeId === employee.id)
    const actual = actualOf(employee.id)
    return {
      employeeId: employee.id,
      name: employee.name,
      weeklyMinutes: weeklyMinutesOn(employee.info, today) ?? weeklyMinutesOn(employee.info, monthEnd),
      today: balanceUntil(employee.info, own, ownAdjustments, todayUntil, actual),
      monthEnd: balanceUntil(employee.info, own, ownAdjustments, monthEnd, actual),
      previousMonthEnd: balanceUntil(employee.info, own, ownAdjustments, previousMonthEnd, actual),
    }
  })
}
```

- [ ] **Step 5: Plan admin data** — `server/services/plan.ts` `buildAdminData`:

  - after `const rules = ...` add:

```ts
  const actualOf = actualTimeFor(db, today)
  const trackingFrom = activeTrackingFrom(db, today)
  const recordsByCell = new Map<string, TimeRecordDto[]>()
  if (trackingFrom !== null) {
    for (const record of loadTimeRecords(db, { from: monthStart, to: monthEnd })) {
      const key = cellKey(record.employeeId, record.date)
      recordsByCell.set(key, [...(recordsByCell.get(key) ?? []), record])
    }
  }
```

  - after the existing `warnings` computation add the time warnings and the per-cell actuals:

```ts
  const actuals: Record<string, ActualCellDto> = {}
  if (trackingFrom !== null) {
    for (const date of monthDates(year, month)) {
      if (date < trackingFrom || date >= today) continue
      for (const employee of staff) {
        if (!isEmployedOn(employee.info, date)) continue
        const key = cellKey(employee.id, date)
        const dayEntries = (byEmployee.get(employee.id) ?? []).filter(entry => entry.date === date)
        const records = recordsByCell.get(key) ?? []
        warnings.push(...timeWarnings(date, employee.id, dayEntries, records))
        if (records.length === 0) continue
        const minutes = recordedMinutes(records)
        const planned = computeDay(employee.info, date, dayEntries).credit
        actuals[key] = { minutes, open: records.some(record => record.end === null), deviates: Math.abs(minutes - planned) > 15 }
      }
    }
  }
```

  - in the weeks loop pass `actualOf(employee.id)` as 5th argument of `computeRange`.
  - return `{ warnings, weeks, balances: computeBalances(db, staff, monthEnd, today), actuals }`.
  - imports: `computeDay` from balance, `isEmployedOn` from targets, `recordedMinutes` from timeRecords, `timeWarnings` from warnings, `activeTrackingFrom` from `./appSettings`, `actualTimeFor`, `loadTimeRecords` from `./timeTracking`, types `ActualCellDto`, `TimeRecordDto`.
  - `warnings` must be declared with `const warnings: Warning[] = monthDates(...)...` so `push` type-checks (import `type Warning`).

  `shared/types/api.ts`:

```ts
export interface ActualCellDto {
  /** Recorded minutes of the day (closed records). */
  minutes: number
  open: boolean
  /** More than 15 minutes away from the planned credit. */
  deviates: boolean
}
```

  and in `MonthPlanAdminDto` add `actuals: Record<string, ActualCellDto>`.

- [ ] **Step 6: Warning texts** — `app/locales/de.ts` `warnings`:

```ts
    openRecord: (name: string) => `${name}: Ausstempeln vergessen`,
    missingRecord: (name: string) => `${name}: keine Stempelzeit`,
    breakRule: (name: string) => `${name}: gesetzliche Pause nicht eingehalten`,
    recordWithoutPlan: (name: string) => `${name}: gestempelt ohne Dienst`,
```

  `app/utils/warnings.ts` `warningText` switch:

```ts
    case 'open_record':
      return de.warnings.openRecord(names.get(warning.employeeId) ?? '?')
    case 'missing_record':
      return de.warnings.missingRecord(names.get(warning.employeeId) ?? '?')
    case 'break_rule':
      return de.warnings.breakRule(names.get(warning.employeeId) ?? '?')
    case 'record_without_plan':
      return de.warnings.recordWithoutPlan(names.get(warning.employeeId) ?? '?')
```

  `de.balances`: `today: 'Stand heute'`, `monthEnd: 'Voraussichtlich Monatsende'`, `hint: '„Stand heute“ zählt bis gestern die gestempelte Zeit (ab „Zeiterfassung ab“), „Voraussichtlich Monatsende“ zusätzlich den Plan bis Monatsende.'`

- [ ] **Step 7: Run** `npx vitest run` and `npm run typecheck` → all PASS / exit 0. Fix any test in `tests/services/plan*.test.ts` that compares the full admin DTO by adding `actuals: {}`.

- [ ] **Step 8: Commit**

```bash
git add shared/domain/warnings.ts server/services/balances.ts server/services/plan.ts shared/types/api.ts app/utils/warnings.ts app/locales/de.ts tests
git commit -m "feat: recorded time in balances, plan weeks and time warnings"
```

---

### Task 7: Guards, terminal service and PIN

**Files:**
- Modify: `server/utils/auth.ts`, `server/api/plan/[year]/[month].get.ts`, `tests/api/permissions.test.ts`
- Create: `server/services/terminal.ts`, `server/api/terminal/status.get.ts`, `server/api/terminal/stamp.post.ts`, `server/api/employees/[id]/pin.put.ts`, `server/api/employees/[id]/pin.delete.ts`
- Modify: `server/schemas.ts`, `shared/types/api.ts`, `server/services/employees.ts` (`hasPin` in detail DTO)
- Test: `tests/services/terminal.test.ts`

**Interfaces:**
- Consumes: `stamp` (Task 5), `nowInBerlin` (Task 2), `hashPassword`, `verifyPassword`, `isEmployedOn`.
- Produces:
  - `requireUser(event, { allowPasswordChange?, allowTerminal? })` — rejects role `terminal` with 403 `forbidden` unless `allowTerminal`
  - `requireTerminal(event): Promise<SessionUser>`
  - `MAX_PIN_ATTEMPTS = 5`, `PIN_LOCK_MINUTES = 15`
  - `setPin(db, employeeId, pin: string): void` (error `pin_format`), `clearPin(db, employeeId): void`
  - `TerminalPersonDto { employeeId: number; name: string; clockedIn: boolean }`
  - `terminalStatus(db: Db, now?: Date): TerminalPersonDto[]`
  - `terminalStamp(db: Db, employeeId: number, pin: string, action: StampAction, now?: Date): TimeRecordDto` (errors `pin_missing`, `pin_invalid`, `pin_locked`)
  - `EmployeeDetailDto.hasPin: boolean`
  - schemas `pinSchema = z.object({ pin: z.string().regex(/^\d{4}$/) })`, `terminalStampSchema = z.object({ employeeId: z.number().int(), pin: z.string().max(10), action: z.enum(['in', 'out']) })`

- [ ] **Step 1: Failing tests**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { clearPin, setPin, terminalStamp, terminalStatus } from '../../server/services/terminal'
import { loadTimeRecords } from '../../server/services/timeTracking'
import { addEmployee, createTestDb, errorCode } from '../helpers/fixtures'

const at = (iso: string) => new Date(iso)

describe('terminal', () => {
  let db: Db
  let anna: number
  let berta: number
  beforeEach(() => {
    db = createTestDb()
    anna = addEmployee(db, 'Anna')
    berta = addEmployee(db, 'Berta')
    addEmployee(db, 'Carl', { leftOn: '2026-09-30' })
    setTimeTrackingFrom(db, '2026-10-01')
    setPin(db, anna, '1234')
  })

  it('lists employed people with a PIN and whether they are clocked in', () => {
    expect(terminalStatus(db, at('2026-10-06T06:00:00Z'))).toEqual([{ employeeId: anna, name: 'Anna', clockedIn: false }])
    terminalStamp(db, anna, '1234', 'in', at('2026-10-06T06:00:00Z'))
    expect(terminalStatus(db, at('2026-10-06T06:01:00Z'))[0]!.clockedIn).toBe(true)
  })
  it('stamps with the right PIN as terminal source', () => {
    terminalStamp(db, anna, '1234', 'in', at('2026-10-06T06:00:00Z'))
    expect(loadTimeRecords(db, { employeeId: anna })[0]).toMatchObject({ source: 'terminal', start: 480 })
  })
  it('locks after 5 wrong PINs for 15 minutes and resets on success', () => {
    for (let attempt = 1; attempt <= 4; attempt++) {
      expect(errorCode(() => terminalStamp(db, anna, '0000', 'in', at('2026-10-06T06:00:00Z')))).toBe('pin_invalid')
    }
    expect(errorCode(() => terminalStamp(db, anna, '0000', 'in', at('2026-10-06T06:00:00Z')))).toBe('pin_locked')
    expect(errorCode(() => terminalStamp(db, anna, '1234', 'in', at('2026-10-06T06:14:00Z')))).toBe('pin_locked')
    terminalStamp(db, anna, '1234', 'in', at('2026-10-06T06:16:00Z'))
    expect(errorCode(() => terminalStamp(db, anna, '0000', 'out', at('2026-10-06T06:17:00Z')))).toBe('pin_invalid')
  })
  it('rejects people without PIN, bad PIN formats and cleared PINs', () => {
    expect(errorCode(() => terminalStamp(db, berta, '1234', 'in', at('2026-10-06T06:00:00Z')))).toBe('pin_missing')
    expect(errorCode(() => setPin(db, berta, '12a4'))).toBe('pin_format')
    clearPin(db, anna)
    expect(errorCode(() => terminalStamp(db, anna, '1234', 'in', at('2026-10-06T06:00:00Z')))).toBe('pin_missing')
  })
})
```

- [ ] **Step 2: Run** `npx vitest run tests/services/terminal.test.ts` → FAIL.

- [ ] **Step 3: Terminal service** `server/services/terminal.ts`:

```ts
import { and, eq, isNull } from 'drizzle-orm'
import { isEmployedOn } from '../../shared/domain/targets'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type { StampAction, TerminalPersonDto, TimeRecordDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, timeRecords } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { hashPassword, verifyPassword } from '../lib/password'
import { loadEmployees } from './queries'
import { stamp } from './timeTracking'

export const MAX_PIN_ATTEMPTS = 5
export const PIN_LOCK_MINUTES = 15

function findEmployee(db: Db, employeeId: number) {
  const employee = db.select().from(employees).where(eq(employees.id, employeeId)).get()
  if (!employee) throw new ServiceError(404, 'employee_not_found')
  return employee
}

export function setPin(db: Db, employeeId: number, pin: string): void {
  findEmployee(db, employeeId)
  if (!/^\d{4}$/.test(pin)) throw new ServiceError(400, 'pin_format')
  db.update(employees).set({ pinHash: hashPassword(pin), pinFailed: 0, pinLockedUntil: null }).where(eq(employees.id, employeeId)).run()
}

export function clearPin(db: Db, employeeId: number): void {
  findEmployee(db, employeeId)
  db.update(employees).set({ pinHash: null, pinFailed: 0, pinLockedUntil: null }).where(eq(employees.id, employeeId)).run()
}

/** People shown on the tablet: employed today and with a PIN; clockedIn = open record today. */
export function terminalStatus(db: Db, now: Date = new Date()): TerminalPersonDto[] {
  const { date } = nowInBerlin(now)
  const withPin = new Set(db.select().from(employees).all().filter(row => row.pinHash !== null).map(row => row.id))
  const open = new Set(db.select().from(timeRecords)
    .where(and(eq(timeRecords.date, date), isNull(timeRecords.end))).all().map(record => record.employeeId))
  return loadEmployees(db)
    .filter(employee => withPin.has(employee.id) && isEmployedOn(employee.info, date))
    .map(employee => ({ employeeId: employee.id, name: employee.name, clockedIn: open.has(employee.id) }))
}

/** Checks the PIN (5 wrong attempts lock the person for 15 minutes) and stamps as "terminal". */
export function terminalStamp(db: Db, employeeId: number, pin: string, action: StampAction, now: Date = new Date()): TimeRecordDto {
  const employee = findEmployee(db, employeeId)
  if (employee.pinHash === null) throw new ServiceError(400, 'pin_missing')
  if (employee.pinLockedUntil && employee.pinLockedUntil > now.toISOString()) throw new ServiceError(423, 'pin_locked')
  if (!verifyPassword(pin, employee.pinHash)) {
    const failed = employee.pinFailed + 1
    if (failed >= MAX_PIN_ATTEMPTS) {
      const pinLockedUntil = new Date(now.getTime() + PIN_LOCK_MINUTES * 60_000).toISOString()
      db.update(employees).set({ pinFailed: 0, pinLockedUntil }).where(eq(employees.id, employeeId)).run()
      throw new ServiceError(423, 'pin_locked')
    }
    db.update(employees).set({ pinFailed: failed }).where(eq(employees.id, employeeId)).run()
    throw new ServiceError(401, 'pin_invalid')
  }
  db.update(employees).set({ pinFailed: 0, pinLockedUntil: null }).where(eq(employees.id, employeeId)).run()
  return stamp(db, employeeId, action, 'terminal', now)
}
```

`shared/types/api.ts`: `export interface TerminalPersonDto { employeeId: number; name: string; clockedIn: boolean }` and `hasPin: boolean` in `EmployeeDetailDto`.

`server/services/employees.ts` `getEmployee`: add `hasPin: db.select().from(employees).where(eq(employees.id, id)).get()!.pinHash !== null,` to the returned object.

- [ ] **Step 4: Guards** — `server/utils/auth.ts`:

```ts
export async function requireUser(
  event: H3Event, options: { allowPasswordChange?: boolean; allowTerminal?: boolean } = {},
): Promise<SessionUser> {
  const session = await requireUserSession(event)
  const user = getActiveUser(useDb(), session.user.id)
  if (!user) {
    await clearUserSession(event)
    throw httpError(401, 'session_expired')
  }
  if (user.mustChangePassword && !options.allowPasswordChange) throw httpError(403, 'password_change_required')
  // The shared tablet may only stamp and see the general plan.
  if (user.role === 'terminal' && !options.allowTerminal) throw httpError(403, 'forbidden')
  return user
}

export async function requireTerminal(event: H3Event): Promise<SessionUser> {
  const user = await requireUser(event, { allowTerminal: true })
  if (user.role !== 'terminal') throw httpError(403, 'forbidden')
  return user
}
```

`server/api/plan/[year]/[month].get.ts`: `const user = await requireUser(event, { allowTerminal: true })`.

- [ ] **Step 5: APIs**

`server/schemas.ts`:

```ts
export const pinSchema = z.object({ pin: z.string().regex(/^\d{4}$/) })
export const terminalStampSchema = z.object({ employeeId: z.number().int(), pin: z.string().max(10), action: z.enum(['in', 'out']) })
```

`server/api/terminal/status.get.ts`:

```ts
import { terminalStatus } from '../../services/terminal'

export default defineServiceHandler(async (event) => {
  await requireTerminal(event)
  return terminalStatus(useDb())
})
```

`server/api/terminal/stamp.post.ts`:

```ts
import { terminalStampSchema } from '../../schemas'
import { terminalStamp } from '../../services/terminal'

export default defineServiceHandler(async (event) => {
  await requireTerminal(event)
  const { employeeId, pin, action } = await readValidatedBody(event, terminalStampSchema.parse)
  return terminalStamp(useDb(), employeeId, pin, action)
})
```

`server/api/employees/[id]/pin.put.ts`:

```ts
import { idParams, pinSchema } from '../../../schemas'
import { setPin } from '../../../services/terminal'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { pin } = await readValidatedBody(event, pinSchema.parse)
  setPin(useDb(), id, pin)
  return { ok: true }
})
```

`server/api/employees/[id]/pin.delete.ts`:

```ts
import { idParams } from '../../../schemas'
import { clearPin } from '../../../services/terminal'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  clearPin(useDb(), id)
  return { ok: true }
})
```

- [ ] **Step 6: Permission test** — `tests/api/permissions.test.ts`:

```ts
/** Routes only the shared stamp tablet may call; they must check with requireTerminal(. */
const TERMINAL_ROUTES = ['terminal/status.get.ts', 'terminal/stamp.post.ts']
```

add `...TERMINAL_ROUTES` to the existence loop, and in the classification before the `USER_ROUTES` branch:

```ts
    else if (TERMINAL_ROUTES.includes(route)) {
      expect(code).toContain('requireTerminal(')
    }
```

and change the public check to `expect(code).not.toMatch(/require(Admin|User|Terminal)\(/)`. Add a test that only the plan route lets the tablet in:

```ts
  it('lets the tablet into the general plan only', () => {
    const allowing = routes.filter(route => source(route).includes('allowTerminal: true'))
    expect(allowing).toEqual(['plan/[year]/[month].get.ts'])
  })
```

- [ ] **Step 7: Run** `npx vitest run` and `npm run typecheck` → PASS.

- [ ] **Step 8: Commit**

```bash
git add server shared tests
git commit -m "feat: tablet stamping with PIN and role guards"
```

---

### Task 8: Admin corrections, protocol and month view

**Files:**
- Modify: `server/services/timeTracking.ts`, `shared/types/api.ts`, `server/schemas.ts`
- Create: `server/api/time-records/index.get.ts`, `server/api/time-records/index.post.ts`, `server/api/time-records/[id].put.ts`, `server/api/time-records/[id].delete.ts`, `server/api/time-records/open.get.ts`
- Test: `tests/services/timeCorrections.test.ts`

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces:
  - `createRecord(db, actor: SessionUser, input: { employeeId: number; date: IsoDate; start: Minutes; end: Minutes }, now?: Date): void`
  - `updateRecord(db, actor, id: number, span: { start: Minutes; end: Minutes }, now?: Date): void`
  - `deleteRecord(db, actor, id: number, now?: Date): void`
  - errors `record_not_found`, `record_overlap`, `record_in_future`, `span_end_before_start`
  - `OpenRecordDto { id: number; employeeId: number; name: string; date: IsoDate; start: Minutes }`, `listOpenRecords(db, today: IsoDate): OpenRecordDto[]` (dates before today)
  - `TimeRecordChangeDto { before: string; after: string; actor: string | null; at: string }`
  - `TimeDayDto { date; weekday; isWeekend; holidayKey; plan: string; plannedMinutes: number; target: number; records: TimeRecordDto[]; recordedMinutes: number; counted: number; usesRecords: boolean; absence: boolean; warnings: Warning[]; changes: TimeRecordChangeDto[] }`
  - `TimeMonthDto { employee: { id: number; name: string }; trackingFrom: IsoDate | null; absenceCodes: CodeDto[]; days: TimeDayDto[] }`
  - `getTimeMonth(db, employeeId: number, year: number, month: number, today: IsoDate): TimeMonthDto`
  - schemas: `timeRecordCreateSchema`, `timeRecordUpdateSchema`, `timeMonthQuery`

- [ ] **Step 1: Failing tests**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { applyToCells } from '../../server/services/entries'
import {
  createRecord, deleteRecord, getTimeMonth, listOpenRecords, loadTimeRecords, stamp, updateRecord,
} from '../../server/services/timeTracking'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const NOW = new Date('2026-10-08T10:00:00Z') // 12:00 Berlin on 08.10.

describe('admin corrections', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
    setTimeTrackingFrom(db, '2026-10-01')
  })
  const records = () => loadTimeRecords(db, { employeeId: anna })

  it('adds, changes and deletes records with a protocol', () => {
    createRecord(db, admin, { employeeId: anna, date: '2026-10-06', start: 462, end: 700 }, NOW)
    const [record] = records()
    expect(record).toMatchObject({ source: 'admin', edited: true, editedBy: 'leitung' })
    updateRecord(db, admin, record!.id, { start: 465, end: 705 }, NOW)
    deleteRecord(db, admin, record!.id, NOW)
    expect(records()).toEqual([])
    const day = getTimeMonth(db, anna, 2026, 10, '2026-10-08').days.find(d => d.date === '2026-10-06')!
    expect(day.changes.map(c => [c.before, c.after, c.actor])).toEqual([
      ['—', '7:42–11:40', 'leitung'], ['7:42–11:40', '7:45–11:45', 'leitung'], ['7:45–11:45', '—', 'leitung'],
    ])
  })
  it('closes a forgotten clock-out and marks it as edited', () => {
    stamp(db, anna, 'in', 'self', new Date('2026-10-06T05:42:00Z'))
    const [open] = records()
    updateRecord(db, admin, open!.id, { start: open!.start, end: 960 }, NOW)
    expect(records()[0]).toMatchObject({ source: 'self', end: 960, edited: true })
  })
  it('rejects invalid corrections without changing anything', () => {
    createRecord(db, admin, { employeeId: anna, date: '2026-10-06', start: 462, end: 700 }, NOW)
    const input = { employeeId: anna, date: '2026-10-06' }
    expect(errorCode(() => createRecord(db, admin, { ...input, start: 690, end: 800 }, NOW))).toBe('record_overlap')
    expect(errorCode(() => createRecord(db, admin, { ...input, start: 800, end: 800 }, NOW))).toBe('span_end_before_start')
    expect(errorCode(() => createRecord(db, admin, { ...input, date: '2026-10-09', start: 400, end: 500 }, NOW))).toBe('record_in_future')
    expect(errorCode(() => updateRecord(db, admin, 999, { start: 1, end: 2 }, NOW))).toBe('record_not_found')
    expect(records()).toHaveLength(1)
  })
  it('lists open records of earlier days', () => {
    stamp(db, anna, 'in', 'self', new Date('2026-10-06T05:42:00Z'))
    stamp(db, anna, 'in', 'self', new Date('2026-10-08T05:42:00Z'))
    expect(listOpenRecords(db, '2026-10-08').map(r => [r.name, r.date, r.start])).toEqual([['Anna', '2026-10-06', 462]])
  })
  it('builds the month view with plan, records, credit and warnings', () => {
    applyToCells(db, admin, [{ employeeId: anna, date: '2026-10-06' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    applyToCells(db, admin, [{ employeeId: anna, date: '2026-10-07' }], 'replace', { kind: 'code', codeId: codeId(db, 'sick') })
    createRecord(db, admin, { employeeId: anna, date: '2026-10-06', start: 465, end: 700 }, NOW)
    createRecord(db, admin, { employeeId: anna, date: '2026-10-06', start: 730, end: 965 }, NOW)
    const month = getTimeMonth(db, anna, 2026, 10, '2026-10-08')
    expect(month.trackingFrom).toBe('2026-10-01')
    expect(month.absenceCodes.map(c => c.key)).toEqual(['vacation', 'sick', 'training', 'school'])
    const oct6 = month.days.find(d => d.date === '2026-10-06')!
    expect(oct6).toMatchObject({ plannedMinutes: 465, recordedMinutes: 470, counted: 470, usesRecords: true, absence: false, warnings: [] })
    expect(oct6.plan).toContain('7:45–16:00')
    expect(month.days.find(d => d.date === '2026-10-07')).toMatchObject({ counted: 468, absence: true, warnings: [] })
    expect(month.days.find(d => d.date === '2026-10-08')).toMatchObject({ usesRecords: false })
  })
})
```

- [ ] **Step 2: Run** `npx vitest run tests/services/timeCorrections.test.ts` → FAIL.

- [ ] **Step 3: Types** (`shared/types/api.ts`):

```ts
export interface OpenRecordDto {
  id: number
  employeeId: number
  name: string
  date: IsoDate
  start: Minutes
}

export interface TimeRecordChangeDto {
  before: string
  after: string
  actor: string | null
  at: string
}

export interface TimeDayDto {
  date: IsoDate
  weekday: number
  isWeekend: boolean
  holidayKey: HolidayKey | null
  /** Plan of the day as text (live draft). */
  plan: string
  /** Credit the plan alone would give. */
  plannedMinutes: number
  target: number
  records: TimeRecordDto[]
  recordedMinutes: number
  /** What the balance counts for this day. */
  counted: number
  usesRecords: boolean
  /** A daily-target code (Urlaub, Krank …) is planned. */
  absence: boolean
  warnings: Warning[]
  changes: TimeRecordChangeDto[]
}

export interface TimeMonthDto {
  employee: { id: number; name: string }
  trackingFrom: IsoDate | null
  /** Buttons for absences entered from the time page (written to the plan). */
  absenceCodes: CodeDto[]
  days: TimeDayDto[]
}
```

- [ ] **Step 4: Implement** — append to `server/services/timeTracking.ts`:

```ts
const describeSpan = (record: { start: Minutes; end: Minutes | null } | null) =>
  record === null ? '—' : `${formatTime(record.start)}–${record.end === null ? '…' : formatTime(record.end)}`

function findRecord(db: Db, id: number) {
  const record = db.select().from(timeRecords).where(eq(timeRecords.id, id)).get()
  if (!record) throw new ServiceError(404, 'record_not_found')
  return record
}

/** Admin corrections: end after start, not in the future, no overlap with other records of the day. */
function assertSpan(db: Db, employeeId: number, date: IsoDate, start: Minutes, end: Minutes, ignoreId: number | null, now: Date): void {
  if (end <= start) throw new ServiceError(400, 'span_end_before_start')
  const current = nowInBerlin(now)
  if (date > current.date || (date === current.date && end > current.minutes)) throw new ServiceError(400, 'record_in_future')
  const overlapping = db.select().from(timeRecords)
    .where(and(eq(timeRecords.employeeId, employeeId), eq(timeRecords.date, date))).all()
    .some(other => other.id !== ignoreId && start < (other.end ?? 24 * 60) && other.start < end)
  if (overlapping) throw new ServiceError(400, 'record_overlap')
}

function logRecordChange(db: Db, actor: SessionUser, record: { employeeId: number; date: IsoDate }, recordId: number | null, before: string, after: string, now: Date): void {
  db.insert(timeRecordChanges).values({
    employeeId: record.employeeId, date: record.date, recordId, before, after, actorId: actor.id, at: now.toISOString(),
  }).run()
}

export function createRecord(
  db: Db, actor: SessionUser, input: { employeeId: number; date: IsoDate; start: Minutes; end: Minutes }, now: Date = new Date(),
): void {
  if (!db.select().from(employees).where(eq(employees.id, input.employeeId)).get()) throw new ServiceError(404, 'employee_not_found')
  db.transaction((tx) => {
    assertSpan(tx, input.employeeId, input.date, input.start, input.end, null, now)
    const row = tx.insert(timeRecords).values({
      ...input, source: 'admin', editedBy: actor.id, editedAt: now.toISOString(), createdAt: now.toISOString(),
    }).returning().get()
    logRecordChange(tx, actor, input, row.id, '—', describeSpan(input), now)
  })
}

export function updateRecord(db: Db, actor: SessionUser, id: number, span: { start: Minutes; end: Minutes }, now: Date = new Date()): void {
  const record = findRecord(db, id)
  db.transaction((tx) => {
    assertSpan(tx, record.employeeId, record.date, span.start, span.end, id, now)
    tx.update(timeRecords).set({ ...span, editedBy: actor.id, editedAt: now.toISOString() }).where(eq(timeRecords.id, id)).run()
    logRecordChange(tx, actor, record, id, describeSpan(record), describeSpan(span), now)
  })
}

export function deleteRecord(db: Db, actor: SessionUser, id: number, now: Date = new Date()): void {
  const record = findRecord(db, id)
  db.transaction((tx) => {
    tx.delete(timeRecords).where(eq(timeRecords.id, id)).run()
    logRecordChange(tx, actor, record, null, describeSpan(record), '—', now)
  })
}

export function listOpenRecords(db: Db, today: IsoDate): OpenRecordDto[] {
  return db.select({ record: timeRecords, name: employees.name })
    .from(timeRecords).innerJoin(employees, eq(timeRecords.employeeId, employees.id))
    .where(and(isNull(timeRecords.end), lt(timeRecords.date, today)))
    .orderBy(asc(timeRecords.date), asc(employees.sortOrder)).all()
    .map(({ record, name }) => ({ id: record.id, employeeId: record.employeeId, name, date: record.date, start: record.start }))
}

export function getTimeMonth(db: Db, employeeId: number, year: number, month: number, today: IsoDate): TimeMonthDto {
  const employee = loadEmployees(db).find(candidate => candidate.id === employeeId)
  if (!employee) throw new ServiceError(404, 'employee_not_found')
  const monthStart = toIsoDate(year, month, 1)
  const monthEnd = toIsoDate(year, month, daysInMonth(year, month))
  const entriesByDate = Map.groupBy(loadEntries(db, { employeeId, from: monthStart, to: monthEnd }), entry => entry.date)
  const recordsByDate = Map.groupBy(loadTimeRecords(db, { employeeId, from: monthStart, to: monthEnd }), record => record.date)
  const changes = db.select({ change: timeRecordChanges, actor: users.username })
    .from(timeRecordChanges).leftJoin(users, eq(timeRecordChanges.actorId, users.id))
    .where(and(eq(timeRecordChanges.employeeId, employeeId), gte(timeRecordChanges.date, monthStart), lte(timeRecordChanges.date, monthEnd)))
    .orderBy(asc(timeRecordChanges.id)).all()
  const actual = actualTimeFor(db, today)(employeeId)
  const trackingFrom = getTimeTrackingFrom(db)

  return {
    employee: { id: employee.id, name: employee.name },
    trackingFrom,
    absenceCodes: loadCodes(db).filter(code => ['vacation', 'sick', 'training', 'school'].includes(code.key)),
    days: monthDates(year, month).map((date) => {
      const dayEntries = entriesByDate.get(date) ?? []
      const records = recordsByDate.get(date) ?? []
      const planned = computeDay(employee.info, date, dayEntries)
      const counted = computeDay(employee.info, date, dayEntries, actual)
      const absence = dayEntries.some(entry => entry.creditMode === 'daily_target')
      const inRange = actual !== undefined && usesRecords(actual, date) && isEmployedOn(employee.info, date)
      return {
        date, weekday: weekday(date), isWeekend: isWeekend(date), holidayKey: holidayOn(date),
        plan: describeCellDetailed(dayEntries),
        plannedMinutes: planned.credit, target: planned.target,
        records, recordedMinutes: recordedMinutes(records), counted: counted.credit,
        usesRecords: usesRecords(actual, date), absence,
        warnings: inRange ? timeWarnings(date, employeeId, dayEntries, records) : [],
        changes: changes.filter(({ change }) => change.date === date)
          .map(({ change, actor }) => ({ before: change.before, after: change.after, actor: actor ?? null, at: change.at })),
      }
    }),
  }
}
```

Extend the imports of `timeTracking.ts`: `lt` from drizzle-orm; `computeDay`, `usesRecords` from balance; `daysInMonth`, `isWeekend`, `monthDates`, `toIsoDate`, `weekday` from dates; `holidayOn` from holidays; `describeCellDetailed` from describe; `isEmployedOn` from targets; `formatTime` from time; `timeWarnings` from warnings; `Minutes` type; `OpenRecordDto`, `SessionUser`, `TimeMonthDto` types; `timeRecordChanges` from schema; `getTimeTrackingFrom` from `./appSettings`; `loadCodes`, `loadEmployees`, `loadEntries` from `./queries`. If `Map.groupBy` is not available in the TS lib target, replace each use with a small local `groupBy<T>(list: T[], key: (item: T) => string): Map<string, T[]>` helper.

- [ ] **Step 5: Schemas and APIs**

`server/schemas.ts`:

```ts
export const timeRecordCreateSchema = z.object({ employeeId: z.number().int(), date: isoDate, start: minutes, end: minutes })
export const timeRecordUpdateSchema = z.object({ start: minutes, end: minutes })
export const timeMonthQuery = monthParams.extend({ employeeId: z.coerce.number().int().positive() })
```

`server/api/time-records/index.get.ts`:

```ts
import { todayIso } from '../../../shared/domain/dates'
import { timeMonthQuery } from '../../schemas'
import { getTimeMonth } from '../../services/timeTracking'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { employeeId, year, month } = await getValidatedQuery(event, timeMonthQuery.parse)
  return getTimeMonth(useDb(), employeeId, year, month, todayIso())
})
```

`server/api/time-records/index.post.ts`:

```ts
import { timeRecordCreateSchema } from '../../schemas'
import { createRecord } from '../../services/timeTracking'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  createRecord(useDb(), admin, await readValidatedBody(event, timeRecordCreateSchema.parse))
  return { ok: true }
})
```

`server/api/time-records/[id].put.ts`:

```ts
import { idParams, timeRecordUpdateSchema } from '../../schemas'
import { updateRecord } from '../../services/timeTracking'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  updateRecord(useDb(), admin, id, await readValidatedBody(event, timeRecordUpdateSchema.parse))
  return { ok: true }
})
```

`server/api/time-records/[id].delete.ts`:

```ts
import { idParams } from '../../schemas'
import { deleteRecord } from '../../services/timeTracking'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteRecord(useDb(), admin, id)
  return { ok: true }
})
```

`server/api/time-records/open.get.ts`:

```ts
import { todayIso } from '../../../shared/domain/dates'
import { listOpenRecords } from '../../services/timeTracking'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  return listOpenRecords(useDb(), todayIso())
})
```

- [ ] **Step 6: Run** `npx vitest run` and `npm run typecheck` → PASS.

- [ ] **Step 7: Commit**

```bash
git add server shared tests
git commit -m "feat: admin corrections, protocol and month view for time records"
```

---

### Task 9: “Meine Zeiten” API

**Files:**
- Modify: `server/services/timeTracking.ts`, `shared/types/api.ts`, `server/schemas.ts`, `tests/api/permissions.test.ts`
- Create: `server/api/my/time.get.ts`, `server/api/my/time/stamp.post.ts`
- Test: `tests/services/myTime.test.ts`

**Interfaces:**
- Consumes: `stamp`, `loadTimeRecords`, `computeBalances`, `activeTrackingFrom`, `nowInBerlin`.
- Produces:
  - `MyTimeDto { enabled: boolean; today: IsoDate; clockedInSince: Minutes | null; todayRecords: TimeRecordDto[]; openEarlier: IsoDate[]; balanceToday: number; balanceMonthEnd: number; records: TimeRecordDto[] }`
  - `getMyTime(db: Db, viewer: SessionUser, year: number, month: number, now?: Date): MyTimeDto` (error `no_employee`)
  - `stampSchema = z.object({ action: z.enum(['in', 'out']) })`

- [ ] **Step 1: Failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { getMyTime, stamp } from '../../server/services/timeTracking'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, createTestDb, errorCode } from '../helpers/fixtures'

describe('my time', () => {
  let db: Db
  let anna: number
  let viewer: SessionUser
  beforeEach(() => {
    db = createTestDb()
    anna = addEmployee(db, 'Anna', { validFrom: '2026-10-01' })
    viewer = addUser(db, 'anna', 'observer', anna)
  })
  it('is disabled without time tracking', () => {
    expect(getMyTime(db, viewer, 2026, 10, new Date('2026-10-06T08:00:00Z')).enabled).toBe(false)
  })
  it('shows today, earlier open records and the own balance', () => {
    setTimeTrackingFrom(db, '2026-10-01')
    stamp(db, anna, 'in', 'self', new Date('2026-10-05T05:42:00Z'))
    stamp(db, anna, 'in', 'self', new Date('2026-10-06T05:45:00Z'))
    const mine = getMyTime(db, viewer, 2026, 10, new Date('2026-10-06T08:00:00Z'))
    expect(mine).toMatchObject({ enabled: true, today: '2026-10-06', clockedInSince: 465, openEarlier: ['2026-10-05'] })
    expect(mine.todayRecords).toHaveLength(1)
    expect(mine.records).toHaveLength(2)
    // 01.–05.10. nothing counted (05.10. open) → 3 workdays (01., 02., 05.) × −468
    expect(mine.balanceToday).toBe(-3 * 468)
  })
  it('requires a linked employee', () => {
    const admin = addUser(db, 'leitung', 'admin')
    expect(errorCode(() => getMyTime(db, admin, 2026, 10))).toBe('no_employee')
  })
})
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

`shared/types/api.ts`:

```ts
export interface MyTimeDto {
  enabled: boolean
  today: IsoDate
  /** Start of today's open record, null when clocked out. */
  clockedInSince: Minutes | null
  todayRecords: TimeRecordDto[]
  /** Earlier days with a forgotten clock-out. */
  openEarlier: IsoDate[]
  balanceToday: number
  balanceMonthEnd: number
  /** All own records of the requested month. */
  records: TimeRecordDto[]
}
```

Append to `server/services/timeTracking.ts`:

```ts
export function getMyTime(db: Db, viewer: SessionUser, year: number, month: number, now: Date = new Date()): MyTimeDto {
  if (viewer.employeeId === null) throw new ServiceError(403, 'no_employee')
  const employee = loadEmployees(db).find(candidate => candidate.id === viewer.employeeId)
  if (!employee) throw new ServiceError(403, 'no_employee')
  const { date: today } = nowInBerlin(now)
  const monthEnd = toIsoDate(year, month, daysInMonth(year, month))
  const [balance] = computeBalances(db, [employee], monthEnd, today)
  const own = loadTimeRecords(db, { employeeId: employee.id })
  const todayRecords = own.filter(record => record.date === today)
  return {
    enabled: activeTrackingFrom(db, today) !== null,
    today,
    clockedInSince: todayRecords.find(record => record.end === null)?.start ?? null,
    todayRecords,
    openEarlier: [...new Set(own.filter(record => record.end === null && record.date < today).map(record => record.date))],
    balanceToday: balance!.today,
    balanceMonthEnd: balance!.monthEnd,
    records: own.filter(record => record.date >= toIsoDate(year, month, 1) && record.date <= monthEnd),
  }
}
```

(import `computeBalances` from `./balances`; `MyTimeDto` type. Check for a circular import: `balances.ts` imports `timeTracking.ts` (Task 6) and `timeTracking.ts` now imports `balances.ts`. ES modules handle this because both only use each other inside functions; if Vitest reports `undefined is not a function`, move `getMyTime` to a new file `server/services/myTime.ts` and adjust the test import.)

`server/schemas.ts`: `export const stampSchema = z.object({ action: z.enum(['in', 'out']) })`, `export const monthQuery = monthParams` is not needed — reuse `monthParams` with `getValidatedQuery`.

`server/api/my/time.get.ts`:

```ts
import { monthParams } from '../../schemas'
import { getMyTime } from '../../services/timeTracking'

export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const { year, month } = await getValidatedQuery(event, monthParams.parse)
  return getMyTime(useDb(), user, year, month)
})
```

`server/api/my/time/stamp.post.ts`:

```ts
import { stampSchema } from '../../../schemas'
import { stamp } from '../../../services/timeTracking'

export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  if (user.employeeId === null) throw createError({ statusCode: 403, statusMessage: 'no_employee', data: { code: 'no_employee' } })
  const { action } = await readValidatedBody(event, stampSchema.parse)
  return stamp(useDb(), user.employeeId, action, 'self')
})
```

`tests/api/permissions.test.ts`: add `'my/time.get.ts'` and `'my/time/stamp.post.ts'` to `USER_ROUTES`.

- [ ] **Step 4: Run** `npx vitest run` and `npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add server shared tests
git commit -m "feat: own time records, stamping and balance for employees"
```

---

### Task 10: Client routing, navigation and German texts

**Files:**
- Modify: `app/middleware/auth.global.ts`, `app/pages/index.vue`, `app/layouts/default.vue`, `app/locales/de.ts`, `app/components/TimeInput.vue`, `shared/domain/time.ts`, `tests/domain/time.test.ts`

**Interfaces:**
- Produces:
  - `isValidTimeInput(value: string, step = 5): boolean`
  - `TimeInput` prop `anyMinute?: boolean` (no 5-minute grid)
  - `de.nav.time`, `de.nav.stamp`, `de.time.*`, `de.terminal.*`, `de.errors` keys of the spec’s error table
  - routes: terminal → `/terminal`; observer → `/my/plan/Y/M`; admin → `/plan/Y/M`

- [ ] **Step 1: Failing test** — append to `tests/domain/time.test.ts` `describe('isValidTimeInput')`:

```ts
  it('accepts any minute with step 1', () => {
    expect(isValidTimeInput('7:42', 1)).toBe(true)
    expect(isValidTimeInput('7:42')).toBe(false)
  })
```

- [ ] **Step 2: Run** → FAIL. Then implement in `shared/domain/time.ts`:

```ts
/** A typed clock time that may be saved: parseable and on the given minute grid (default 5). */
export function isValidTimeInput(value: string, step = 5): boolean {
  const minutes = parseTime(value)
  return minutes !== null && minutes % step === 0
}
```

`app/components/TimeInput.vue`: `const props = defineProps<{ anyMinute?: boolean }>()` and `!isValidTimeInput(model.value, props.anyMinute ? 1 : 5)`.

- [ ] **Step 3: Routing**

`app/middleware/auth.global.ts`:

```ts
export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn, user } = useUserSession()
  if (to.path === '/login') return loggedIn.value ? navigateTo('/') : undefined
  if (!loggedIn.value) return navigateTo('/login')
  if (user.value?.role === 'terminal') {
    // The shared tablet only stamps and shows the general plan.
    return to.path === '/terminal' || to.path.startsWith('/plan/') ? undefined : navigateTo('/terminal')
  }
  if (user.value?.mustChangePassword && to.path !== '/account/password') return navigateTo('/account/password')
  if ((to.path.startsWith('/admin') || to.path === '/terminal') && user.value?.role !== 'admin') return navigateTo('/')
})
```

Note: an admin may open `/terminal` only to look at it; the page's API calls are refused for non-terminal users and the page shows the error.

`app/pages/index.vue`:

```vue
<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'

const { user } = useUserSession()
const { year, month } = parseIsoDate(todayIso())
const target = user.value?.role === 'terminal'
  ? '/terminal'
  : user.value?.role === 'observer' ? `/my/plan/${year}/${month}` : `/plan/${year}/${month}`
await navigateTo(target, { replace: true })
</script>

<template>
  <div />
</template>
```

`app/layouts/default.vue` `links`:

```ts
  if (user.value.role === 'terminal') return [{ label: de.nav.stamp, to: '/terminal' }, plan]
  const myPlan = { label: de.nav.myPlan, to: `/my/plan/${today.year}/${today.month}` }
  if (user.value.role === 'admin') {
    return [
      plan,
      // An admin linked to an employee stamps on "Mein Dienstplan" too.
      ...(user.value.employeeId !== null ? [myPlan] : []),
      { label: de.nav.time, to: '/admin/time' },
      { label: de.nav.employees, to: '/admin/employees' },
      { label: de.nav.balances, to: '/admin/balances' },
      { label: de.nav.leave, to: '/admin/leave' },
      { label: de.nav.closures, to: '/admin/closures' },
      { label: de.nav.users, to: '/admin/users' },
      { label: de.nav.settings, to: '/admin/settings' },
    ]
  }
  return [myPlan, plan, { label: de.nav.myLeave, to: '/my/leave' }]
```

and hide the password button for the tablet: `<UButton v-if="user?.role !== 'terminal'" ... to="/account/password" .../>`.

- [ ] **Step 4: Texts** — `app/locales/de.ts`:

  - `nav`: `time: 'Zeiterfassung', stamp: 'Stempeln'`
  - new block `time`:

```ts
  time: {
    title: 'Zeiterfassung', employee: 'Mitarbeiter:in', clockIn: 'Einstempeln', clockOut: 'Ausstempeln',
    clockedInSince: (time: string) => `Eingestempelt seit ${time}`, notClockedIn: 'Nicht eingestempelt',
    todayRecords: 'Heute', none: 'Noch keine Zeiten.',
    openEarlier: (date: string) => `Am ${date} nicht ausgestempelt – die Leitung trägt die Zeit nach.`,
    balanceToday: 'Stand heute', balanceMonthEnd: 'Voraussichtlich Monatsende',
    recorded: 'Ist', planned: 'Plan', difference: 'Differenz', records: 'Stempelzeiten', hints: 'Hinweise',
    edited: 'nachgetragen', addRecord: 'Zeitraum hinzufügen', openRecords: 'Offene Zeiträume',
    noOpenRecords: 'Keine offenen Zeiträume.', protocol: 'Protokoll', disabled: 'Die Zeiterfassung ist noch nicht aktiv (Einstellungen → „Zeiterfassung ab“).',
    beforeStart: 'vor „Zeiterfassung ab“ – zählt nach Plan', removeAbsence: 'Abwesenheit entfernen', open: 'offen',
    stamped: (action: 'in' | 'out', time: string) => (action === 'in' ? `Eingestempelt ${time}` : `Ausgestempelt ${time}`),
    deleteConfirm: 'Diesen Zeitraum löschen?',
  },
  terminal: {
    title: 'Stempeln', choose: 'Bitte deinen Namen antippen.', pin: 'PIN', back: 'Zurück', empty: 'Für niemanden ist eine PIN hinterlegt.',
  },
```

  - `employees`: `pin: 'Stempel-PIN', pinHint: '4 Ziffern für das Kita-Tablet.', pinSet: 'PIN ist gesetzt.', pinNotSet: 'Keine PIN gesetzt.', savePin: 'PIN speichern', removePin: 'PIN entfernen'`
  - `users.roles`: add `terminal: 'Stempel-Tablet'`
  - `settings`: `timeTracking: 'Zeiterfassung', timeTrackingFrom: 'Zeiterfassung ab', timeTrackingHint: 'Ab diesem Tag zählt für vergangene Tage die gestempelte Zeit. Leer = Zeiterfassung aus.'`
  - error texts (the existing error map used by `errorMessage` — find it with Grep for `entries_overlap:` in `de.ts` and add to that object):

```ts
    time_tracking_off: 'Die Zeiterfassung ist noch nicht aktiv.',
    already_clocked_in: 'Du bist bereits eingestempelt.',
    not_clocked_in: 'Du bist nicht eingestempelt.',
    pin_invalid: 'PIN falsch.',
    pin_locked: 'Zu viele Fehlversuche – bitte in 15 Minuten erneut versuchen.',
    pin_missing: 'Für diese Person ist keine PIN hinterlegt.',
    pin_format: 'Die PIN muss genau 4 Ziffern haben.',
    record_overlap: 'Der Zeitraum überschneidet sich mit einem anderen Zeitraum des Tages.',
    record_in_future: 'Zeiten in der Zukunft können nicht eingetragen werden.',
    record_not_found: 'Dieser Zeitraum existiert nicht mehr.',
    terminal_no_employee: 'Ein Stempel-Tablet wird mit keinem Mitarbeiter verknüpft.',
```

  (`no_employee` exists already — check with Grep; add `no_employee: 'Dein Zugang ist mit keiner Mitarbeiterin verknüpft.'` only if missing.)

- [ ] **Step 5: Run** `npx vitest run` and `npm run typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add app shared tests
git commit -m "feat: routing, navigation and texts for time tracking"
```

---

### Task 11: Settings, employee PIN and tablet user in the admin UI

**Files:**
- Modify: `app/pages/admin/settings.vue`, `app/pages/admin/employees/[id].vue`, `app/pages/admin/users.vue`

- [ ] **Step 1: Settings** — add a section above “Dienst-Buttons”:

```vue
    <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ de.settings.timeTracking }}</h2>
      <form class="flex flex-wrap items-end gap-3" @submit.prevent="saveTracking">
        <UFormField :label="de.settings.timeTrackingFrom"><UInput v-model="trackingFrom" type="date" /></UFormField>
        <UButton type="submit" :label="de.common.save" />
      </form>
      <p class="text-xs text-gray-500">{{ de.settings.timeTrackingHint }}</p>
    </section>
```

script:

```ts
const { data: appSettings, refresh: refreshApp } = await useFetch<AppSettingsDto>('/api/app-settings')
const trackingFrom = ref('')
watch(appSettings, value => (trackingFrom.value = value?.timeTrackingFrom ?? ''), { immediate: true })
const runApp = useAction(refreshApp)
function saveTracking() {
  runApp(() => $fetch<unknown>('/api/app-settings', { method: 'PUT', body: { timeTrackingFrom: trackingFrom.value || null } }), de.common.saved)
}
```

(import `AppSettingsDto`.)

- [ ] **Step 2: Employee PIN** — `app/pages/admin/employees/[id].vue`, new section after “Stammdaten”:

```vue
    <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ de.employees.pin }}</h2>
      <p class="text-sm text-gray-600">{{ employee.hasPin ? de.employees.pinSet : de.employees.pinNotSet }}</p>
      <form class="flex flex-wrap items-end gap-3" @submit.prevent="savePin">
        <UFormField :label="de.employees.pin">
          <UInput v-model="pin" inputmode="numeric" maxlength="4" pattern="\d{4}" autocomplete="off" required />
        </UFormField>
        <UButton type="submit" :label="de.employees.savePin" />
        <UButton v-if="employee.hasPin" color="error" variant="ghost" :label="de.employees.removePin" @click="removePin" />
      </form>
      <p class="text-xs text-gray-500">{{ de.employees.pinHint }}</p>
    </section>
```

```ts
const pin = ref('')
async function savePin() {
  const ok = await run(() => $fetch<unknown>(`/api/employees/${id}/pin`, { method: 'PUT', body: { pin: pin.value } }), de.common.saved)
  if (ok) pin.value = ''
}
async function removePin() {
  if (await confirm(de.common.confirmDelete)) run(() => $fetch<unknown>(`/api/employees/${id}/pin`, { method: 'DELETE' }), de.common.deleted)
}
```

- [ ] **Step 3: Users** — `app/pages/admin/users.vue`: `roleItems` from `(['admin', 'observer', 'terminal'] as Role[])`; when the role is `terminal`, disable the employee select (`:disabled="user.role === 'terminal'"` on both selects) and set `employeeId` to null on change: `watch(() => form.role, role => { if (role === 'terminal') form.employeeId = null })`, and in `save(user)` send `employeeId: user.role === 'terminal' ? null : user.employeeId`.

- [ ] **Step 4: Verify** — `npm run typecheck` → exit 0. Browser (admin): set “Zeiterfassung ab” on the settings page and clear it again; set and remove a PIN on a test employee; open the users page and check the role list contains “Stempel-Tablet”. Do not create real users.

- [ ] **Step 5: Commit**

```bash
git add app
git commit -m "feat: admin UI for time tracking start, PIN and tablet user"
```

---

### Task 12: Stamp card and own records on “Mein Dienstplan”

**Files:**
- Create: `app/components/time/MyTimeCard.vue`
- Modify: `app/pages/my/plan/[year]/[month].vue`

- [ ] **Step 1: Card component**

```vue
<script setup lang="ts">
import { formatSignedDuration, formatTime } from '#shared/domain/time'
import type { MyTimeDto, StampAction, TimeRecordDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { balanceClass } from '~/utils/colors'
import { formatDate } from '~/utils/format'

/** Clock in/out for the signed-in employee, today's records and the own balance. */
const props = defineProps<{ time: MyTimeDto }>()
const emit = defineEmits<{ changed: [] }>()
const run = useAction()
const busy = ref(false)

const span = (record: TimeRecordDto) => `${formatTime(record.start)}–${record.end === null ? '…' : formatTime(record.end)}`
const action = computed<StampAction>(() => (props.time.clockedInSince === null ? 'in' : 'out'))

async function stampNow() {
  busy.value = true
  const ok = await run(() => $fetch<unknown>('/api/my/time/stamp', { method: 'POST', body: { action: action.value } }))
  busy.value = false
  if (ok) emit('changed')
}
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <div class="flex flex-wrap items-center gap-3">
      <UButton
        size="xl" :loading="busy" :color="action === 'in' ? 'success' : 'warning'"
        :icon="action === 'in' ? 'i-lucide-log-in' : 'i-lucide-log-out'"
        :label="action === 'in' ? de.time.clockIn : de.time.clockOut" @click="stampNow"
      />
      <span class="text-sm text-gray-600">
        {{ time.clockedInSince === null ? de.time.notClockedIn : de.time.clockedInSince(formatTime(time.clockedInSince)) }}
      </span>
    </div>
    <p class="text-sm">
      <span class="text-gray-500">{{ de.time.todayRecords }}:</span>
      {{ time.todayRecords.length ? time.todayRecords.map(span).join(' · ') : de.time.none }}
    </p>
    <UAlert v-for="date in time.openEarlier" :key="date" color="warning" variant="soft" :title="de.time.openEarlier(formatDate(date))" />
    <div class="flex flex-wrap gap-6 text-sm">
      <div>{{ de.time.balanceToday }}: <span class="font-semibold" :class="balanceClass(time.balanceToday)">{{ formatSignedDuration(time.balanceToday) }}</span></div>
      <div>{{ de.time.balanceMonthEnd }}: <span class="font-semibold" :class="balanceClass(time.balanceMonthEnd)">{{ formatSignedDuration(time.balanceMonthEnd) }}</span></div>
    </div>
  </section>
</template>
```

- [ ] **Step 2: Page** — in `app/pages/my/plan/[year]/[month].vue`:

```ts
const { data: time, refresh: refreshTime } = await useFetch<MyTimeDto>('/api/my/time', { query: { year, month } })
const recordsByDate = computed(() => {
  const map = new Map<string, TimeRecordDto[]>()
  for (const record of time.value?.records ?? []) map.set(record.date, [...(map.get(record.date) ?? []), record])
  return map
})
const span = (record: TimeRecordDto) => `${formatTime(record.start)}–${record.end === null ? '…' : formatTime(record.end)}`
```

  - above the table: `<TimeMyTimeCard v-if="time?.enabled" :time="time" @changed="refreshTime" />` (Nuxt prefixes components in `components/time/` with `Time`).
  - add a table column header `<th class="px-3 py-2">{{ de.time.records }}</th>` after “Dienst” and the cell:

```vue
          <td class="px-3 py-1.5 text-xs">
            <div v-for="record in recordsByDate.get(day.date) ?? []" :key="record.id">
              {{ span(record) }} <span v-if="record.edited" class="text-amber-700">({{ de.time.edited }})</span>
            </div>
          </td>
```

  - imports: `formatTime`, types `MyTimeDto`, `TimeRecordDto`.

- [ ] **Step 3: Verify** — `npm run typecheck` and `npx vitest run`. Do not change user accounts or links for a visual check: the stamp card is checked visually only if the admin account already has an employee link; otherwise the service tests of Task 9 cover it and the report says the card was not checked in the browser.

- [ ] **Step 4: Commit**

```bash
git add app
git commit -m "feat: stamp card and own records on Mein Dienstplan"
```

---

### Task 13: Tablet page

**Files:**
- Create: `app/pages/terminal.vue`

- [ ] **Step 1: Page**

```vue
<script setup lang="ts">
import { formatTime } from '#shared/domain/time'
import type { StampAction, TerminalPersonDto, TimeRecordDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'

const { data: people, refresh, error } = await useFetch<TerminalPersonDto[]>('/api/terminal/status')
const chosen = ref<TerminalPersonDto | null>(null)
const pin = ref('')
const message = ref('')
const failure = ref('')
let resetTimer: ReturnType<typeof setTimeout> | undefined

// Keep the green dots current when several people use the tablet.
const poll = setInterval(() => refresh(), 30_000)
onBeforeUnmount(() => {
  clearInterval(poll)
  clearTimeout(resetTimer)
})

function choose(person: TerminalPersonDto) {
  chosen.value = person
  pin.value = ''
  failure.value = ''
  message.value = ''
}

function backToList() {
  chosen.value = null
  pin.value = ''
  failure.value = ''
  message.value = ''
  refresh()
}

function press(digit: string) {
  if (pin.value.length < 4) pin.value += digit
}

async function submit(action: StampAction) {
  const person = chosen.value
  if (!person || pin.value.length !== 4) return
  try {
    const record = await $fetch<TimeRecordDto>('/api/terminal/stamp', { method: 'POST', body: { employeeId: person.employeeId, pin: pin.value, action } })
    message.value = de.time.stamped(action, formatTime(action === 'in' ? record.start : record.end ?? record.start))
    failure.value = ''
    resetTimer = setTimeout(backToList, 5000)
  }
  catch (caught) {
    failure.value = errorMessage(caught)
    pin.value = ''
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-4">
    <h1 class="text-2xl font-semibold">{{ de.terminal.title }}</h1>
    <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />

    <template v-else-if="!chosen">
      <p class="text-gray-600">{{ de.terminal.choose }}</p>
      <p v-if="!people?.length" class="text-gray-500">{{ de.terminal.empty }}</p>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <button
          v-for="person in people ?? []" :key="person.employeeId" type="button"
          class="flex items-center gap-2 rounded-xl bg-white p-5 text-left text-lg font-medium ring-1 ring-gray-200 hover:bg-sky-50"
          @click="choose(person)"
        >
          <span class="size-3 rounded-full" :class="person.clockedIn ? 'bg-green-500' : 'bg-gray-300'" />
          {{ person.name }}
        </button>
      </div>
    </template>

    <section v-else class="mx-auto max-w-sm space-y-4 rounded-xl bg-white p-5 text-center ring-1 ring-gray-200">
      <h2 class="text-xl font-semibold">{{ chosen.name }}</h2>
      <template v-if="message">
        <p class="text-2xl font-semibold text-green-700">{{ message }}</p>
        <UButton size="xl" color="neutral" variant="outline" :label="de.terminal.back" @click="backToList" />
      </template>
      <template v-else>
        <div class="text-3xl tracking-[0.5em]" :aria-label="de.terminal.pin">{{ '•'.repeat(pin.length).padEnd(4, '–') }}</div>
        <p v-if="failure" class="text-sm text-red-600">{{ failure }}</p>
        <div class="grid grid-cols-3 gap-2">
          <UButton v-for="digit in ['1', '2', '3', '4', '5', '6', '7', '8', '9']" :key="digit" size="xl" color="neutral" variant="outline" class="justify-center" :label="digit" @click="press(digit)" />
          <UButton size="xl" color="neutral" variant="ghost" class="justify-center" icon="i-lucide-delete" :aria-label="de.common.delete" @click="pin = pin.slice(0, -1)" />
          <UButton size="xl" color="neutral" variant="outline" class="justify-center" label="0" @click="press('0')" />
          <UButton size="xl" color="neutral" variant="ghost" class="justify-center" icon="i-lucide-x" :aria-label="de.terminal.back" @click="backToList" />
        </div>
        <UButton
          block size="xl" :disabled="pin.length !== 4" :color="chosen.clockedIn ? 'warning' : 'success'"
          :label="chosen.clockedIn ? de.time.clockOut : de.time.clockIn" @click="submit(chosen.clockedIn ? 'out' : 'in')"
        />
      </template>
    </section>
  </div>
</template>
```

- [ ] **Step 2: Verify** — `npm run typecheck`. Browser: as admin open `/terminal` → shows the “forbidden” error message (expected, admins cannot stamp for others). The full tablet flow is verified in Task 15 with a temporary test tablet user **only if the user agrees**; otherwise covered by service tests.

- [ ] **Step 3: Commit**

```bash
git add app/pages/terminal.vue
git commit -m "feat: tablet page with name tiles and PIN pad"
```

---

### Task 14: Admin page “Zeiterfassung” and “Ist” in the plan

**Files:**
- Create: `app/pages/admin/time.vue`, `app/components/time/TimeRecordModal.vue`
- Modify: `app/components/plan/PlanGrid.vue`, `app/components/plan/PlanSidebar.vue` (labels only via `de.balances`), `app/pages/admin/balances.vue` (labels only via `de.balances`)

- [ ] **Step 1: Record dialog** `app/components/time/TimeRecordModal.vue`:

```vue
<script setup lang="ts">
import { formatTime, parseTime } from '#shared/domain/time'
import { de } from '~/locales/de'

/** Adds or changes one time record (minute-precise; end required). */
const props = defineProps<{ title: string; initial: { start: number; end: number | null } | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ submit: [value: { start: number; end: number }] }>()
const form = reactive({ start: '', end: '' })
const error = ref('')

watch(open, (isOpen) => {
  if (!isOpen) return
  form.start = props.initial ? formatTime(props.initial.start) : ''
  form.end = props.initial?.end != null ? formatTime(props.initial.end) : ''
  error.value = ''
})

function submit() {
  const start = parseTime(form.start)
  const end = parseTime(form.end)
  if (start === null || end === null) {
    error.value = de.spanErrors.missing_times
    return
  }
  if (end <= start) {
    error.value = de.spanErrors.end_before_start
    return
  }
  emit('submit', { start, end })
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="title">
    <template #body>
      <form class="grid grid-cols-2 gap-3" @submit.prevent="submit">
        <UFormField :label="de.modal.start"><TimeInput v-model="form.start" any-minute autofocus /></UFormField>
        <UFormField :label="de.modal.end"><TimeInput v-model="form.end" any-minute /></UFormField>
        <p v-if="error" class="col-span-2 text-sm text-red-600">{{ error }}</p>
        <div class="col-span-2 flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton type="submit" :label="de.common.save" />
        </div>
      </form>
    </template>
  </UModal>
</template>
```

- [ ] **Step 2: Page** `app/pages/admin/time.vue`:

```vue
<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import { formatDuration, formatSignedDuration, formatTime } from '#shared/domain/time'
import type { CodeDto, EmployeeListItemDto, OpenRecordDto, TimeDayDto, TimeMonthDto, TimeRecordDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { balanceClass } from '~/utils/colors'
import { formatDate, formatDateTime, formatDayShort } from '~/utils/format'
import { warningText } from '~/utils/warnings'

const route = useRoute()
const router = useRouter()
const today = parseIsoDate(todayIso())
const year = ref(Number(route.query.year) || today.year)
const month = ref(Number(route.query.month) || today.month)
const employeeId = ref<number | null>(Number(route.query.employee) || null)
const focusDate = ref(typeof route.query.date === 'string' ? route.query.date : null)

const { data: employees } = await useFetch<EmployeeListItemDto[]>('/api/employees')
if (employeeId.value === null) employeeId.value = employees.value?.[0]?.id ?? null
const { data: openRecords, refresh: refreshOpen } = await useFetch<OpenRecordDto[]>('/api/time-records/open')
const { data, refresh } = await useFetch<TimeMonthDto>('/api/time-records', {
  query: { employeeId, year, month }, immediate: employeeId.value !== null, watch: [employeeId, year, month],
})
const run = useAction(async () => {
  await refresh()
  await refreshOpen()
})
const confirm = useConfirm()

watch([employeeId, year, month], () => router.replace({ query: { employee: employeeId.value ?? undefined, year: year.value, month: month.value } }))

const names = computed(() => new Map((employees.value ?? []).map(employee => [employee.id, employee.name])))
const span = (record: TimeRecordDto) => `${formatTime(record.start)}–${record.end === null ? '…' : formatTime(record.end)}`
const expanded = ref(new Set<string>())

function toggleProtocol(date: string) {
  const next = new Set(expanded.value)
  if (next.has(date)) next.delete(date)
  else next.add(date)
  expanded.value = next
}

const modal = reactive<{ open: boolean; date: string; record: TimeRecordDto | null }>({ open: false, date: '', record: null })
function addRecord(day: TimeDayDto) {
  Object.assign(modal, { open: true, date: day.date, record: null })
}
function editRecord(day: TimeDayDto, record: TimeRecordDto) {
  Object.assign(modal, { open: true, date: day.date, record })
}
function onSubmit(value: { start: number; end: number }) {
  if (modal.record) run(() => $fetch<unknown>(`/api/time-records/${modal.record!.id}`, { method: 'PUT', body: value }), de.common.saved)
  else run(() => $fetch<unknown>('/api/time-records', { method: 'POST', body: { employeeId: employeeId.value, date: modal.date, ...value } }), de.common.saved)
}
async function removeRecord(record: TimeRecordDto) {
  if (await confirm(de.time.deleteConfirm)) run(() => $fetch<unknown>(`/api/time-records/${record.id}`, { method: 'DELETE' }), de.common.deleted)
}

/** Absences are plan entries: they replace the day in the plan (shown there as unreleased change). */
function setAbsence(day: TimeDayDto, code: CodeDto | null) {
  const cells = [{ employeeId: employeeId.value, date: day.date }]
  const body = code ? { cells, mode: 'replace', entry: { kind: 'code', codeId: code.id } } : { cells, mode: 'clear', entry: null }
  run(() => $fetch<unknown>('/api/entries', { method: 'POST', body }), de.common.saved)
}

function openJump(record: OpenRecordDto) {
  const date = parseIsoDate(record.date)
  year.value = date.year
  month.value = date.month
  employeeId.value = record.employeeId
  focusDate.value = record.date
}

function change(nextYear: number, nextMonth: number) {
  year.value = nextYear
  month.value = nextMonth
}

onMounted(() => {
  if (focusDate.value) document.getElementById(`day-${focusDate.value}`)?.scrollIntoView({ block: 'center' })
})
</script>

<template>
  <div class="max-w-5xl space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <span class="text-2xl font-semibold">{{ de.time.title }}</span>
      <MonthNav :year="year" :month="month" @change="change" />
      <select v-model="employeeId" class="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm" :aria-label="de.time.employee">
        <option v-for="employee in employees ?? []" :key="employee.id" :value="employee.id">{{ employee.name }}</option>
      </select>
    </div>

    <UAlert v-if="data && !data.trackingFrom" color="neutral" variant="soft" :title="de.time.disabled" />

    <section class="rounded-lg bg-white p-3 ring-1 ring-gray-200">
      <h2 class="mb-2 font-semibold">{{ de.time.openRecords }}</h2>
      <p v-if="!openRecords?.length" class="text-sm text-gray-500">{{ de.time.noOpenRecords }}</p>
      <ul v-else class="space-y-1 text-sm">
        <li v-for="record in openRecords" :key="record.id">
          <button type="button" class="hover:underline" @click="openJump(record)">
            {{ formatDate(record.date) }} · {{ record.name }} · {{ formatTime(record.start) }}–…
          </button>
        </li>
      </ul>
    </section>

    <table v-if="data" class="w-full overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
      <thead class="bg-gray-100 text-left text-xs text-gray-600">
        <tr>
          <th class="px-2 py-2">{{ de.plan.date }}</th><th class="px-2 py-2">{{ de.time.planned }}</th>
          <th class="px-2 py-2">{{ de.time.records }}</th><th class="px-2 py-2 text-right">{{ de.time.recorded }}</th>
          <th class="px-2 py-2 text-right">{{ de.time.difference }}</th><th class="px-2 py-2">{{ de.time.hints }}</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="day in data.days" :key="day.date">
          <tr :id="`day-${day.date}`" class="border-t border-gray-100 align-top" :class="[day.isWeekend ? 'bg-gray-50 text-gray-500' : '', focusDate === day.date ? 'ring-2 ring-inset ring-sky-500' : '']">
            <td class="whitespace-nowrap px-2 py-1.5 font-medium">{{ formatDayShort(day.date, day.weekday) }}</td>
            <td class="px-2 py-1.5 text-xs">
              {{ day.plan }}
              <div class="mt-1 flex flex-wrap gap-1">
                <UButton v-for="code in data.absenceCodes" :key="code.id" size="xs" color="neutral" variant="soft" :label="code.label" @click="setAbsence(day, code)" />
                <UButton v-if="day.absence" size="xs" color="error" variant="ghost" :label="de.time.removeAbsence" @click="setAbsence(day, null)" />
              </div>
            </td>
            <td class="px-2 py-1.5">
              <div v-for="record in day.records" :key="record.id" class="flex items-center gap-1">
                <button type="button" class="hover:underline" @click="editRecord(day, record)">{{ span(record) }}</button>
                <span v-if="record.edited" class="text-xs text-amber-700" :title="record.editedAt ? `${record.editedBy ?? ''} ${formatDateTime(record.editedAt)}` : undefined">({{ de.time.edited }})</span>
                <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" @click="removeRecord(record)" />
              </div>
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-plus" :label="de.time.addRecord" @click="addRecord(day)" />
              <button v-if="day.changes.length" type="button" class="block text-xs text-gray-500 hover:underline" @click="toggleProtocol(day.date)">{{ de.time.protocol }} ({{ day.changes.length }})</button>
            </td>
            <td class="px-2 py-1.5 text-right">
              <span v-if="day.usesRecords">{{ formatDuration(day.recordedMinutes) }}</span>
              <span v-else class="text-xs text-gray-400" :title="de.time.beforeStart">–</span>
            </td>
            <td class="px-2 py-1.5 text-right font-medium" :class="balanceClass(day.counted - day.target)">{{ formatSignedDuration(day.counted - day.target) }}</td>
            <td class="px-2 py-1.5 text-xs text-amber-700">
              <div v-for="(warning, index) in day.warnings" :key="index">{{ warningText(warning, names) }}</div>
            </td>
          </tr>
          <tr v-if="expanded.has(day.date)" class="bg-gray-50 text-xs text-gray-600">
            <td />
            <td colspan="5" class="px-2 py-1.5">
              <div v-for="(change, index) in day.changes" :key="index">{{ formatDateTime(change.at) }} · {{ change.actor ?? '?' }}: {{ change.before }} → {{ change.after }}</div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <TimeTimeRecordModal
      v-model:open="modal.open" :title="`${de.time.addRecord} · ${formatDate(modal.date || todayIso())}`"
      :initial="modal.record" @submit="onSubmit"
    />
  </div>
</template>
```

Component name: Nuxt names `components/time/TimeRecordModal.vue` as `<TimeRecordModal>` when the file name already starts with the folder name — check the generated name in `.nuxt/components.d.ts` after `npm run typecheck` and use exactly that tag (either `TimeRecordModal` or `TimeTimeRecordModal`). Same check for `MyTimeCard` in Task 12 (`TimeMyTimeCard`).

- [ ] **Step 3: “Ist” in plan cells** — `app/components/plan/PlanGrid.vue`:
  - in the `cells` mapping add `actual: props.plan.admin?.actuals[key] ?? null,`
  - in the cell template after the `stillMissing` span:

```vue
                <NuxtLink
                  v-if="cell.actual" :to="`/admin/time?employee=${cell.employeeId}&year=${plan.year}&month=${plan.month}&date=${row.day.date}`"
                  class="text-xs hover:underline" :class="cell.actual.deviates || cell.actual.open ? 'font-medium text-orange-600' : 'text-gray-500'"
                  @click.stop
                >
                  {{ de.time.recorded }} {{ formatDuration(cell.actual.minutes) }}<template v-if="cell.actual.open"> ({{ de.time.open }})</template>
                </NuxtLink>
```

- [ ] **Step 4: Verify**
  - `npm run typecheck` → exit 0; `npx vitest run` → PASS.
  - Restart the dev server (new migration): `preview_stop` / `preview_start`.
  - Browser as admin. Records only count for past days, so the check cannot use a far-future month. Use a temporary employee “Test Zeit” (create on the employees page). There is no delete button for employees, so remove it at the end with a small node script in the scratchpad (better-sqlite3 on `.data/app.db`, `PRAGMA foreign_keys = ON`, then `DELETE FROM employees WHERE name = 'Test Zeit'` — entries, hours and time records cascade; also `DELETE FROM change_log WHERE employee_id IS NULL AND ...` is not needed because change_log rows cascade too). Note the current value of “Zeiterfassung ab”; if it is empty, set it temporarily to the first day of the current month and clear it again at the end. Add records through `/admin/time` for the test employee on a past day of the current month, check “Ist …” in the plan cell, the hint list, the protocol and the open-records list; then delete the test employee and restore “Zeiterfassung ab”.

- [ ] **Step 5: Commit**

```bash
git add app
git commit -m "feat: admin time tracking page and recorded time in the plan"
```

---

### Task 15: Final review and documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-09-30-dienstplan-kindergarten-design.md` (one paragraph in the roles section pointing to the time tracking spec)

- [ ] **Step 1:** Add to the main spec, roles section: “Rolle **Stempel-Tablet** und Zeiterfassung: siehe `2026-10-01-zeiterfassung-design.md`.”
- [ ] **Step 2:** `npx vitest run`, `npm run typecheck` → all green.
- [ ] **Step 3:** Whole-branch review against the spec (dispatch a reviewer on the most capable model with the diff since the commit before Task 1).
- [ ] **Step 4:** Commit:

```bash
git add docs
git commit -m "docs: link time tracking spec from the main spec"
```
