# Dienstplan Kindergarten Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first draft of a German-language kindergarten duty-roster web app (monthly plan, shift buttons, hour/leave accounts, warnings, day overview, admin/observer roles) as a Nuxt 4 app on SQLite, packaged with a Dockerfile.

**Architecture:** One Nuxt 4 app: Vue pages in `app/`, a REST API in `server/api/` (thin handlers), use-case services in `server/services/` that take the database as a parameter, and all business rules as pure TypeScript in `shared/domain/`. Pure domain code and services are tested with Vitest against an in-memory SQLite database; the UI is verified manually in the browser.

**Tech Stack:** Node.js 24 LTS, Nuxt 4.5, Nuxt UI 4, Tailwind CSS 4, nuxt-auth-utils 0.5, Drizzle ORM 0.45 + drizzle-kit 0.31, better-sqlite3 13, zod 4, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-30-dienstplan-kindergarten-design.md`

## Global Constraints

- UI text is German and lives in `app/locales/de.ts` (seeded DB labels like "Krank" are data and may be German); every identifier, file name, comment, test name and commit message is English.
- Node.js 24 LTS (`node:24-bookworm-slim` in Docker).
- Times are integers = minutes since midnight; dates are `YYYY-MM-DD` strings; timestamps are ISO strings (`new Date().toISOString()`); the business time zone is `Europe/Berlin`.
- Daily target = weekly minutes valid on that day ÷ 5, rounded to whole minutes, Monday–Friday only; weekends and Baden-Württemberg public holidays have target 0.
- Time entries must be on a 5-minute grid; a break must lie completely inside its entry; either both break fields are set or neither.
- Every API route checks permissions server-side via `requireUser` / `requireAdmin`; observers never receive hour data, warnings, drafts, or other employees' leave accounts.
- Observers see a month only when it is released.
- Default shift templates: F1 Frühdienst 7:00–13:15 (no break), F2 Frühdienst 2 7:30–15:45 (break 11:40–12:10), M Mitteldienst 7:45–16:00 (break 11:40–12:10), S Spätdienst 8:45–17:00 (break 12:10–12:40), HK Haushaltskraft 11:00–16:00 (no break, does not count as staff).
- Default coverage rules per checked weekday: 2× start 8:45 and end 17:00, 1× start 7:00, 1× start 7:30.
- No GitHub Actions pipeline and no local Docker run in this plan (the Dockerfile is written, but only built later in CI).
- Environment variables: `NUXT_SESSION_PASSWORD` (≥ 32 chars), `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `DATABASE_PATH`, `MIGRATIONS_DIR`, `BACKUP_DIR`, `NUXT_SESSION_COOKIE_SECURE`, `TZ=Europe/Berlin`.
- The shell on the dev machine is Windows PowerShell 5.1. If `node`, `npm` or `git` are not found, refresh PATH first: `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`.

## Review Focus

1. A calendar week that spans a month or year boundary (e.g. Mo 28.12.2026 – So 03.01.2027 with Neujahr) must be summed as a whole week, with the holiday at target 0 (tests in Task 3 and Task 12).
2. Weekly hours that change in the middle of a week must be applied per day, not per week (test in Task 3).
3. An observer who calls the API directly for a draft month, for hour data, or without a linked employee must get 403 and no data (tests in Task 12).
4. Deleting a closure after the admin overrode single days must keep the overrides and remove only the untouched generated entries (test in Task 13).
5. Incomplete or inconsistent time input (only one break field, break outside the shift, end before start, off-grid minutes) must be rejected with a German message instead of being saved (tests in Task 1 and Task 10).

---

## File Structure

```
package.json, nuxt.config.ts, tsconfig.json, vitest.config.ts, drizzle.config.ts
.gitignore, .env.example, .dockerignore, Dockerfile, docker-compose.yml, README.md
deploy/Caddyfile
docs/BETRIEB.md                     German operating guide (install, update, backup)

shared/domain/                      pure TS, no Nuxt / DB imports, relative imports only
  types.ts                          Minutes, IsoDate, EntryKind, CreditMode, CodeKey, DomainEntry
  time.ts                           parse/format times and durations, net minutes, span validation
  dates.ts                          ISO date arithmetic, weeks, month days, today in Berlin
  holidays.ts                       Baden-Württemberg public holidays
  targets.ts                        weekly-hours history → employment + daily target
  balance.ts                        daily credit, ranges, totals, account balance
  leave.ts                          vacation account + date ranges
  warnings.ts                       missing entry, coverage rules, target gap
  dayOverview.ts                    15-minute presence timeline
  describe.ts                       entry/cell labels used in grid and change log
  cells.ts                          cell keys
shared/types/
  api.ts                            DTOs shared by server and app, COLOR_KEYS
  auth.d.ts                         nuxt-auth-utils User augmentation

server/db/schema.ts, client.ts, seed.ts, migrations/ (generated)
server/lib/errors.ts, password.ts
server/services/                    use cases; every function takes `db` first
  queries.ts (shared read queries), auth.ts, users.ts, changeLog.ts, entries.ts, release.ts,
  employees.ts, balances.ts, leave.ts, plan.ts, closures.ts, settings.ts, backup.ts
server/schemas.ts                   zod request schemas
server/utils/db.ts, auth.ts, serviceHandler.ts   (Nitro auto-imported)
server/plugins/database.ts          migrate + seed + initial admin + daily backup
server/api/**                       thin route handlers

app/app.vue, app/assets/css/main.css
app/locales/de.ts                   all German UI strings
app/utils/colors.ts, format.ts, errors.ts, warnings.ts
app/composables/useAction.ts, usePlanSelection.ts
app/middleware/auth.global.ts
app/layouts/default.vue
app/components/plan/PlanHeader.vue, PlanToolbar.vue, PlanGrid.vue, PlanEntryChip.vue,
                    PlanTimeEntryModal.vue, PlanDayOverviewPanel.vue, PlanSidebar.vue
app/components/MonthNav.vue, YearNav.vue
app/pages/login.vue, index.vue, account/password.vue
app/pages/plan/[year]/[month].vue, print/[year]/[month].vue
app/pages/my/plan/[year]/[month].vue, my/leave.vue
app/pages/admin/employees/index.vue, admin/employees/[id].vue,
          admin/balances.vue, admin/leave.vue, admin/closures.vue,
          admin/settings.vue, admin/users.vue

tests/helpers/fixtures.ts
tests/domain/*.test.ts, tests/services/*.test.ts
```

---

### Task 1: Project scaffold and time utilities

**Files:**
- Create: `package.json`, `nuxt.config.ts`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `app/app.vue`, `app/assets/css/main.css`
- Create: `shared/domain/types.ts`, `shared/domain/time.ts`
- Test: `tests/domain/time.test.ts`

**Interfaces:**
- Produces:
  - `type Minutes = number`, `type IsoDate = string`, `type EntryKind = 'shift' | 'special' | 'code'`, `type CreditMode = 'daily_target' | 'timed' | 'none'`, `type CodeKey = 'vacation' | 'sick' | 'training' | 'school' | 'other' | 'prep_time' | 'office' | 'holiday' | 'closure_day'`, `interface DomainEntry`
  - `parseTime(value: string): Minutes | null`, `parseDuration(value: string): number | null`, `formatTime(m: Minutes): string`, `toTimeInput(m: Minutes): string`, `formatDuration(m: number): string`, `formatSignedDuration(m: number): string`
  - `interface TimeSpan { start; end; breakStart; breakEnd }`, `netMinutes(span: TimeSpan): number`, `type SpanError`, `validateSpan(span: TimeSpan): SpanError | null`

- [ ] **Step 1: Create the project files**

`package.json`:
```json
{
  "name": "dienstplan",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "nuxt dev",
    "build": "nuxt build",
    "start": "node .output/server/index.mjs",
    "postinstall": "nuxt prepare",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "nuxt typecheck",
    "db:generate": "drizzle-kit generate"
  }
}
```

`nuxt.config.ts`:
```ts
export default defineNuxtConfig({
  compatibilityDate: '2026-09-30',
  modules: ['@nuxt/ui', 'nuxt-auth-utils'],
  css: ['~/assets/css/main.css'],
  ui: { fonts: false, colorMode: false },
  devtools: { enabled: false },
  app: {
    head: { htmlAttrs: { lang: 'de' }, title: 'Dienstplan' },
  },
  runtimeConfig: {
    session: {
      maxAge: 60 * 60 * 24 * 30,
      cookie: { secure: true },
    },
  },
})
```

`tsconfig.json`:
```json
{
  "files": [],
  "references": [
    { "path": "./.nuxt/tsconfig.app.json" },
    { "path": "./.nuxt/tsconfig.server.json" },
    { "path": "./.nuxt/tsconfig.shared.json" },
    { "path": "./.nuxt/tsconfig.node.json" }
  ]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
```

`.gitignore`:
```
node_modules
.nuxt
.output
.data
data
.env
*.db
*.db-wal
*.db-shm
coverage
```

`.env.example` (test values for local development only):
```
NUXT_SESSION_PASSWORD=dev-session-password-at-least-32-characters
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin-dev-1234
DATABASE_PATH=.data/app.db
```

`app/assets/css/main.css`:
```css
@import "tailwindcss";
@import "@nuxt/ui";
```

`app/app.vue`:
```vue
<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
```

- [ ] **Step 2: Install dependencies**

Run:
```
npm install nuxt@^4.5.2 @nuxt/ui@^4.11.2 nuxt-auth-utils@^0.5.30 drizzle-orm@^0.45.3 better-sqlite3@^13.0.3 zod@^4.6.5 tailwindcss@^4.3.3 @iconify-json/lucide
npm install -D vitest@^5.0.3 drizzle-kit@^0.31.11 @types/better-sqlite3 @types/node typescript vue-tsc
Copy-Item .env.example .env
```
Expected: install finishes, `nuxt prepare` runs in postinstall and creates `.nuxt/`.

- [ ] **Step 3: Write the failing test**

`tests/domain/time.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  formatDuration, formatSignedDuration, formatTime, netMinutes,
  parseDuration, parseTime, toTimeInput, validateSpan,
} from '../../shared/domain/time'

describe('parseTime', () => {
  it('parses h:mm and hh:mm', () => {
    expect(parseTime('7:45')).toBe(465)
    expect(parseTime('07:45')).toBe(465)
    expect(parseTime('17:00')).toBe(1020)
    expect(parseTime('24:00')).toBe(1440)
  })
  it('rejects invalid values', () => {
    expect(parseTime('7.45')).toBeNull()
    expect(parseTime('25:00')).toBeNull()
    expect(parseTime('24:05')).toBeNull()
    expect(parseTime('7:60')).toBeNull()
    expect(parseTime('')).toBeNull()
  })
})

describe('parseDuration', () => {
  it('parses hour:minute durations above 24 hours', () => {
    expect(parseDuration('12:30')).toBe(750)
    expect(parseDuration('120:00')).toBe(7200)
    expect(parseDuration('0:05')).toBe(5)
  })
  it('rejects invalid durations', () => {
    expect(parseDuration('12')).toBeNull()
    expect(parseDuration('1:75')).toBeNull()
  })
})

describe('formatting', () => {
  it('formats clock times', () => {
    expect(formatTime(465)).toBe('7:45')
    expect(formatTime(1020)).toBe('17:00')
    expect(toTimeInput(420)).toBe('07:00')
  })
  it('formats durations with sign', () => {
    expect(formatDuration(465)).toBe('7:45')
    expect(formatDuration(-150)).toBe('−2:30')
    expect(formatSignedDuration(75)).toBe('+1:15')
    expect(formatSignedDuration(0)).toBe('±0:00')
    expect(formatSignedDuration(-5)).toBe('−0:05')
  })
})

describe('netMinutes', () => {
  it('subtracts the break (M: 7:45–16:00, break 11:40–12:10 = 7:45 h)', () => {
    expect(netMinutes({ start: 465, end: 960, breakStart: 700, breakEnd: 730 })).toBe(465)
  })
  it('handles shifts without break (F1: 7:00–13:15 = 6:15 h)', () => {
    expect(netMinutes({ start: 420, end: 795, breakStart: null, breakEnd: null })).toBe(375)
  })
})

describe('validateSpan', () => {
  it('accepts a valid span with and without break', () => {
    expect(validateSpan({ start: 465, end: 960, breakStart: 700, breakEnd: 730 })).toBeNull()
    expect(validateSpan({ start: 420, end: 795, breakStart: null, breakEnd: null })).toBeNull()
  })
  it('rejects minutes off the 5-minute grid', () => {
    expect(validateSpan({ start: 421, end: 795, breakStart: null, breakEnd: null })).toBe('not_on_grid')
  })
  it('rejects end before or equal to start', () => {
    expect(validateSpan({ start: 600, end: 600, breakStart: null, breakEnd: null })).toBe('end_before_start')
    expect(validateSpan({ start: 600, end: 540, breakStart: null, breakEnd: null })).toBe('end_before_start')
  })
  it('rejects a break with only one side', () => {
    expect(validateSpan({ start: 465, end: 960, breakStart: 700, breakEnd: null })).toBe('incomplete_break')
    expect(validateSpan({ start: 465, end: 960, breakStart: null, breakEnd: 730 })).toBe('incomplete_break')
  })
  it('rejects a break outside the span or reversed', () => {
    expect(validateSpan({ start: 465, end: 960, breakStart: 450, breakEnd: 480 })).toBe('break_outside')
    expect(validateSpan({ start: 465, end: 960, breakStart: 950, breakEnd: 970 })).toBe('break_outside')
    expect(validateSpan({ start: 465, end: 960, breakStart: 730, breakEnd: 700 })).toBe('break_outside')
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/domain/time.test.ts`
Expected: FAIL — cannot resolve `../../shared/domain/time`.

- [ ] **Step 5: Write the implementation**

`shared/domain/types.ts`:
```ts
export type Minutes = number
export type IsoDate = string

export type EntryKind = 'shift' | 'special' | 'code'
export type CreditMode = 'daily_target' | 'timed' | 'none'
export type CodeKey =
  | 'vacation' | 'sick' | 'training' | 'school' | 'other'
  | 'prep_time' | 'office' | 'holiday' | 'closure_day'

/** Minimal entry shape used by all domain calculations. */
export interface DomainEntry {
  employeeId: number
  date: IsoDate
  kind: EntryKind
  codeKey: CodeKey | null
  /** 'timed' for shifts and special shifts; the code's mode for codes. */
  creditMode: CreditMode
  start: Minutes | null
  end: Minutes | null
  breakStart: Minutes | null
  breakEnd: Minutes | null
  countsAsStaff: boolean
}
```

`shared/domain/time.ts`:
```ts
import type { Minutes } from './types'

export interface TimeSpan {
  start: Minutes
  end: Minutes
  breakStart: Minutes | null
  breakEnd: Minutes | null
}

export type SpanError = 'not_on_grid' | 'end_before_start' | 'incomplete_break' | 'break_outside'

const pad = (value: number) => String(value).padStart(2, '0')

export function parseTime(value: string): Minutes | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (minutes > 59 || hours > 24 || (hours === 24 && minutes !== 0)) return null
  return hours * 60 + minutes
}

export function parseDuration(value: string): number | null {
  const match = /^(\d{1,4}):([0-5]\d)$/.exec(value.trim())
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

export function formatTime(minutes: Minutes): string {
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`
}

/** Value for <input type="time">, which needs a two-digit hour. */
export function toTimeInput(minutes: Minutes): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? '−' : ''
  const abs = Math.abs(minutes)
  return `${sign}${Math.floor(abs / 60)}:${pad(abs % 60)}`
}

export function formatSignedDuration(minutes: number): string {
  if (minutes === 0) return '±0:00'
  return minutes > 0 ? `+${formatDuration(minutes)}` : formatDuration(minutes)
}

export function netMinutes(span: TimeSpan): number {
  const pause = span.breakStart !== null && span.breakEnd !== null ? span.breakEnd - span.breakStart : 0
  return span.end - span.start - pause
}

export function validateSpan(span: TimeSpan): SpanError | null {
  const values = [span.start, span.end, span.breakStart, span.breakEnd]
    .filter((value): value is number => value !== null)
  if (values.some(value => value % 5 !== 0)) return 'not_on_grid'
  if (span.end <= span.start) return 'end_before_start'
  if ((span.breakStart === null) !== (span.breakEnd === null)) return 'incomplete_break'
  if (span.breakStart !== null && span.breakEnd !== null) {
    if (span.breakEnd <= span.breakStart || span.breakStart < span.start || span.breakEnd > span.end) {
      return 'break_outside'
    }
  }
  return null
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/domain/time.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 7: Commit**

```
git add -A
git commit -m "chore: scaffold nuxt app and add time utilities"
```

---

### Task 2: Dates and Baden-Württemberg holidays

**Files:**
- Create: `shared/domain/dates.ts`, `shared/domain/holidays.ts`
- Test: `tests/domain/dates.test.ts`, `tests/domain/holidays.test.ts`

**Interfaces:**
- Consumes: `IsoDate` from `types.ts`
- Produces:
  - `toIsoDate(year, month, day): IsoDate` (month 1–12), `parseIsoDate(iso): { year; month; day }`, `addDays(iso, n): IsoDate`, `daysBetween(a, b): number`, `weekday(iso): number` (0 = Monday … 6 = Sunday), `isWeekend(iso): boolean`, `daysInMonth(year, month): number`, `monthDates(year, month): IsoDate[]`, `dateRange(from, to): IsoDate[]` (inclusive), `weekStart(iso): IsoDate` (Monday), `isoWeekNumber(iso): number`, `todayIso(now?: Date): IsoDate`
  - `type HolidayKey`, `easterSunday(year): IsoDate`, `bwHolidays(year): Map<IsoDate, HolidayKey>`, `holidayOn(iso): HolidayKey | null`, `isHoliday(iso): boolean`

- [ ] **Step 1: Write the failing tests**

`tests/domain/dates.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  addDays, dateRange, daysBetween, daysInMonth, isoWeekNumber, isWeekend,
  monthDates, parseIsoDate, toIsoDate, todayIso, weekday, weekStart,
} from '../../shared/domain/dates'

describe('dates', () => {
  it('builds and parses ISO dates', () => {
    expect(toIsoDate(2026, 10, 5)).toBe('2026-10-05')
    expect(parseIsoDate('2026-10-05')).toEqual({ year: 2026, month: 10, day: 5 })
  })
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysBetween('2026-10-01', '2026-10-08')).toBe(7)
  })
  it('computes weekdays with Monday = 0', () => {
    expect(weekday('2026-10-05')).toBe(0)
    expect(weekday('2026-10-11')).toBe(6)
    expect(isWeekend('2026-10-10')).toBe(true)
    expect(isWeekend('2026-10-09')).toBe(false)
  })
  it('lists month dates', () => {
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(monthDates(2026, 2)).toHaveLength(28)
    expect(monthDates(2026, 10)[0]).toBe('2026-10-01')
    expect(dateRange('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
  })
  it('computes ISO weeks', () => {
    expect(weekStart('2026-10-08')).toBe('2026-10-05')
    expect(weekStart('2026-10-01')).toBe('2026-09-28')
    expect(isoWeekNumber('2026-10-05')).toBe(41)
    expect(isoWeekNumber('2027-01-01')).toBe(53)
    expect(isoWeekNumber('2027-01-04')).toBe(1)
  })
  it('returns today in Europe/Berlin', () => {
    expect(todayIso(new Date('2026-09-30T22:30:00Z'))).toBe('2026-10-01')
    expect(todayIso(new Date('2026-09-30T21:30:00Z'))).toBe('2026-09-30')
  })
})
```

`tests/domain/holidays.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { bwHolidays, easterSunday, holidayOn, isHoliday } from '../../shared/domain/holidays'

describe('holidays', () => {
  it('computes Easter Sunday', () => {
    expect(easterSunday(2025)).toBe('2025-04-20')
    expect(easterSunday(2026)).toBe('2026-04-05')
    expect(easterSunday(2027)).toBe('2027-03-28')
  })
  it('lists the 12 Baden-Württemberg holidays for 2026', () => {
    const holidays = bwHolidays(2026)
    expect(holidays.size).toBe(12)
    expect(holidays.get('2026-01-06')).toBe('epiphany')
    expect(holidays.get('2026-04-03')).toBe('good_friday')
    expect(holidays.get('2026-04-06')).toBe('easter_monday')
    expect(holidays.get('2026-05-14')).toBe('ascension_day')
    expect(holidays.get('2026-05-25')).toBe('whit_monday')
    expect(holidays.get('2026-06-04')).toBe('corpus_christi')
    expect(holidays.get('2026-10-03')).toBe('german_unity_day')
    expect(holidays.get('2026-11-01')).toBe('all_saints_day')
  })
  it('does not include holidays of other states', () => {
    expect(holidayOn('2026-10-31')).toBeNull()
    expect(holidayOn('2026-11-18')).toBeNull()
  })
  it('answers lookups for any year', () => {
    expect(isHoliday('2027-01-01')).toBe(true)
    expect(holidayOn('2027-05-06')).toBe('ascension_day')
    expect(isHoliday('2026-10-05')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/domain/dates.test.ts tests/domain/holidays.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

`shared/domain/dates.ts`:
```ts
import type { IsoDate } from './types'

const DAY_MS = 86_400_000
const pad = (value: number) => String(value).padStart(2, '0')

export function toIsoDate(year: number, month: number, day: number): IsoDate {
  return `${year}-${pad(month)}-${pad(day)}`
}

export function parseIsoDate(iso: IsoDate): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number)
  return { year: year!, month: month!, day: day! }
}

function toUtc(iso: IsoDate): number {
  const { year, month, day } = parseIsoDate(iso)
  return Date.UTC(year, month - 1, day)
}

function fromUtc(time: number): IsoDate {
  return new Date(time).toISOString().slice(0, 10)
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return fromUtc(toUtc(iso) + days * DAY_MS)
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS)
}

export function weekday(iso: IsoDate): number {
  return (new Date(toUtc(iso)).getUTCDay() + 6) % 7
}

export function isWeekend(iso: IsoDate): boolean {
  return weekday(iso) >= 5
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function monthDates(year: number, month: number): IsoDate[] {
  return Array.from({ length: daysInMonth(year, month) }, (_, index) => toIsoDate(year, month, index + 1))
}

export function dateRange(from: IsoDate, to: IsoDate): IsoDate[] {
  const count = daysBetween(from, to)
  return count < 0 ? [] : Array.from({ length: count + 1 }, (_, index) => addDays(from, index))
}

export function weekStart(iso: IsoDate): IsoDate {
  return addDays(iso, -weekday(iso))
}

export function isoWeekNumber(iso: IsoDate): number {
  const thursday = addDays(iso, 3 - weekday(iso))
  const { year } = parseIsoDate(thursday)
  return Math.floor(daysBetween(toIsoDate(year, 1, 1), thursday) / 7) + 1
}

export function todayIso(now: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}
```

`shared/domain/holidays.ts`:
```ts
import { addDays, parseIsoDate, toIsoDate } from './dates'
import type { IsoDate } from './types'

export type HolidayKey =
  | 'new_year' | 'epiphany' | 'good_friday' | 'easter_monday' | 'labour_day'
  | 'ascension_day' | 'whit_monday' | 'corpus_christi' | 'german_unity_day'
  | 'all_saints_day' | 'christmas_day' | 'boxing_day'

/** Anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
export function easterSunday(year: number): IsoDate {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return toIsoDate(year, month, day)
}

const cache = new Map<number, Map<IsoDate, HolidayKey>>()

export function bwHolidays(year: number): Map<IsoDate, HolidayKey> {
  const cached = cache.get(year)
  if (cached) return cached
  const easter = easterSunday(year)
  const holidays = new Map<IsoDate, HolidayKey>([
    [toIsoDate(year, 1, 1), 'new_year'],
    [toIsoDate(year, 1, 6), 'epiphany'],
    [addDays(easter, -2), 'good_friday'],
    [addDays(easter, 1), 'easter_monday'],
    [toIsoDate(year, 5, 1), 'labour_day'],
    [addDays(easter, 39), 'ascension_day'],
    [addDays(easter, 50), 'whit_monday'],
    [addDays(easter, 60), 'corpus_christi'],
    [toIsoDate(year, 10, 3), 'german_unity_day'],
    [toIsoDate(year, 11, 1), 'all_saints_day'],
    [toIsoDate(year, 12, 25), 'christmas_day'],
    [toIsoDate(year, 12, 26), 'boxing_day'],
  ])
  cache.set(year, holidays)
  return holidays
}

export function holidayOn(iso: IsoDate): HolidayKey | null {
  return bwHolidays(parseIsoDate(iso).year).get(iso) ?? null
}

export function isHoliday(iso: IsoDate): boolean {
  return holidayOn(iso) !== null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/domain`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "feat: add date helpers and Baden-Wuerttemberg holidays"
```

---

### Task 3: Daily targets and hour balance

**Files:**
- Create: `shared/domain/targets.ts`, `shared/domain/balance.ts`
- Test: `tests/domain/targets.test.ts`, `tests/domain/balance.test.ts`, `tests/helpers/entries.ts`

**Interfaces:**
- Consumes: `netMinutes` (Task 1), `isWeekend`, `dateRange` (Task 2), `isHoliday` (Task 2), `DomainEntry`
- Produces:
  - `interface HoursPeriod { weeklyMinutes: number; validFrom: IsoDate }`, `interface EmploymentInfo { hours: HoursPeriod[]; leftOn: IsoDate | null }`
  - `weeklyMinutesOn(info, date): number | null`, `employmentStart(info): IsoDate | null`, `isEmployedOn(info, date): boolean`, `isEmployedInRange(info, from, to): boolean`, `dailyTarget(info, date): number`
  - `interface DayResult { date; target; credit; delta }`, `interface Totals { target; credit; delta }`, `dayCredit(entries, target): number`, `computeDay(info, date, entries): DayResult`, `computeRange(info, entries, from, to): DayResult[]`, `summarize(days): Totals`, `interface Adjustment { date: IsoDate; minutes: number }`, `balanceUntil(info, entries, adjustments, until): number`
  - Test helper `tests/helpers/entries.ts`: `shift(employeeId, date, start, end, breakStart?, breakEnd?, extra?)`, `special(...)`, `code(employeeId, date, codeKey, creditMode, start?, end?)`

- [ ] **Step 1: Write the test helper and failing tests**

`tests/helpers/entries.ts`:
```ts
import type { CodeKey, CreditMode, DomainEntry, IsoDate } from '../../shared/domain/types'

export function shift(
  employeeId: number, date: IsoDate, start: number, end: number,
  breakStart: number | null = null, breakEnd: number | null = null,
  extra: Partial<DomainEntry> = {},
): DomainEntry {
  return {
    employeeId, date, kind: 'shift', codeKey: null, creditMode: 'timed',
    start, end, breakStart, breakEnd, countsAsStaff: true, ...extra,
  }
}

export function special(employeeId: number, date: IsoDate, start: number, end: number): DomainEntry {
  return shift(employeeId, date, start, end, null, null, { kind: 'special' })
}

export function code(
  employeeId: number, date: IsoDate, codeKey: CodeKey, creditMode: CreditMode,
  start: number | null = null, end: number | null = null,
): DomainEntry {
  return {
    employeeId, date, kind: 'code', codeKey, creditMode,
    start, end, breakStart: null, breakEnd: null, countsAsStaff: true,
  }
}

/** Standard shifts from the spec, in minutes. */
export const F1 = [420, 795, null, null] as const
export const F2 = [450, 945, 700, 730] as const
export const M = [465, 960, 700, 730] as const
export const S = [525, 1020, 730, 760] as const
```

`tests/domain/targets.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  dailyTarget, employmentStart, isEmployedInRange, isEmployedOn, weeklyMinutesOn,
  type EmploymentInfo,
} from '../../shared/domain/targets'

const fullTime: EmploymentInfo = { hours: [{ weeklyMinutes: 2340, validFrom: '2026-01-01' }], leftOn: null }

describe('targets', () => {
  it('derives the daily target from weekly hours (39 h → 7:48 h)', () => {
    expect(dailyTarget(fullTime, '2026-10-05')).toBe(468)
  })
  it('has no target on weekends, holidays and before employment', () => {
    expect(dailyTarget(fullTime, '2026-10-10')).toBe(0)
    expect(dailyTarget(fullTime, '2026-12-25')).toBe(0)
    expect(dailyTarget(fullTime, '2025-12-31')).toBe(0)
  })
  it('applies a change of weekly hours from its valid-from day, even mid-week', () => {
    const info: EmploymentInfo = {
      hours: [{ weeklyMinutes: 1800, validFrom: '2026-10-07' }, { weeklyMinutes: 2340, validFrom: '2026-01-01' }],
      leftOn: null,
    }
    expect(weeklyMinutesOn(info, '2026-10-06')).toBe(2340)
    expect(dailyTarget(info, '2026-10-06')).toBe(468)
    expect(dailyTarget(info, '2026-10-07')).toBe(360)
    expect(employmentStart(info)).toBe('2026-01-01')
  })
  it('ends employment after the leaving day', () => {
    const info: EmploymentInfo = { ...fullTime, leftOn: '2026-10-15' }
    expect(isEmployedOn(info, '2026-10-15')).toBe(true)
    expect(isEmployedOn(info, '2026-10-16')).toBe(false)
    expect(dailyTarget(info, '2026-10-16')).toBe(0)
    expect(isEmployedInRange(info, '2026-10-01', '2026-10-31')).toBe(true)
    expect(isEmployedInRange(info, '2026-11-01', '2026-11-30')).toBe(false)
  })
  it('treats employees without hours as not employed', () => {
    const info: EmploymentInfo = { hours: [], leftOn: null }
    expect(isEmployedOn(info, '2026-10-05')).toBe(false)
    expect(employmentStart(info)).toBeNull()
  })
})
```

`tests/domain/balance.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { balanceUntil, computeDay, computeRange, dayCredit, summarize } from '../../shared/domain/balance'
import type { EmploymentInfo } from '../../shared/domain/targets'
import { code, F1, M, shift, special } from '../helpers/entries'

const info: EmploymentInfo = { hours: [{ weeklyMinutes: 2340, validFrom: '2026-10-05' }], leftOn: null }
const day = '2026-10-06'

describe('dayCredit', () => {
  it('sums net minutes of timed entries', () => {
    expect(dayCredit([shift(1, day, ...M)], 468)).toBe(465)
    expect(dayCredit([shift(1, day, ...F1)], 468)).toBe(375)
  })
  it('adds up several entries of one day (VZ + special shift)', () => {
    const entries = [code(1, day, 'prep_time', 'timed', 450, 570), special(1, day, 570, 870)]
    expect(dayCredit(entries, 468)).toBe(120 + 300)
  })
  it('credits the daily target for sick, even if a shift is also entered', () => {
    expect(dayCredit([shift(1, day, ...M), code(1, day, 'sick', 'daily_target')], 468)).toBe(468)
  })
  it('credits nothing for "other" without times but counts it with times', () => {
    expect(dayCredit([code(1, day, 'other', 'none')], 468)).toBe(0)
    expect(dayCredit([code(1, day, 'other', 'none', 600, 660)], 468)).toBe(60)
  })
})

describe('computeDay / computeRange', () => {
  it('counts weekend work fully as plus', () => {
    const saturday = '2026-10-10'
    expect(computeDay(info, saturday, [special(1, saturday, 840, 1080)]))
      .toEqual({ date: saturday, target: 0, credit: 240, delta: 240 })
  })
  it('sums a full week of M shifts for 39 h (−0:15)', () => {
    const dates = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']
    const entries = dates.map(date => shift(1, date, ...M))
    expect(summarize(computeRange(info, entries, '2026-10-05', '2026-10-11')))
      .toEqual({ target: 2340, credit: 2325, delta: -15 })
  })
  it('sums a week across the year boundary with Neujahr at target 0', () => {
    const yearInfo: EmploymentInfo = { hours: [{ weeklyMinutes: 2340, validFrom: '2026-01-01' }], leftOn: null }
    const dates = ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31']
    const entries = dates.map(date => shift(1, date, ...M))
    const days = computeRange(yearInfo, entries, '2026-12-28', '2027-01-03')
    expect(days).toHaveLength(7)
    expect(days.find(d => d.date === '2027-01-01')?.target).toBe(0)
    expect(summarize(days)).toEqual({ target: 1872, credit: 1860, delta: -12 })
  })
})

describe('balanceUntil', () => {
  const dates = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']
  const entries = dates.map(date => shift(1, date, ...M))
  it('adds the opening balance and all daily deltas', () => {
    expect(balanceUntil(info, entries, [{ date: '2026-10-05', minutes: 750 }], '2026-10-09')).toBe(735)
  })
  it('only includes adjustments and days up to the given date', () => {
    expect(balanceUntil(info, entries, [{ date: '2026-10-05', minutes: 750 }], '2026-10-01')).toBe(0)
    expect(balanceUntil(info, entries, [], '2026-10-05')).toBe(-3)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/domain/targets.test.ts tests/domain/balance.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

`shared/domain/targets.ts`:
```ts
import { isWeekend } from './dates'
import { isHoliday } from './holidays'
import type { IsoDate } from './types'

export interface HoursPeriod {
  weeklyMinutes: number
  validFrom: IsoDate
}

export interface EmploymentInfo {
  hours: HoursPeriod[]
  leftOn: IsoDate | null
}

export function weeklyMinutesOn(info: EmploymentInfo, date: IsoDate): number | null {
  let match: HoursPeriod | null = null
  for (const period of info.hours) {
    if (period.validFrom <= date && (!match || period.validFrom > match.validFrom)) match = period
  }
  return match ? match.weeklyMinutes : null
}

export function employmentStart(info: EmploymentInfo): IsoDate | null {
  if (info.hours.length === 0) return null
  return info.hours.reduce((min, period) => (period.validFrom < min ? period.validFrom : min), info.hours[0]!.validFrom)
}

export function isEmployedOn(info: EmploymentInfo, date: IsoDate): boolean {
  return weeklyMinutesOn(info, date) !== null && (info.leftOn === null || date <= info.leftOn)
}

export function isEmployedInRange(info: EmploymentInfo, from: IsoDate, to: IsoDate): boolean {
  const start = employmentStart(info)
  return start !== null && start <= to && (info.leftOn === null || info.leftOn >= from)
}

export function dailyTarget(info: EmploymentInfo, date: IsoDate): number {
  if (!isEmployedOn(info, date) || isWeekend(date) || isHoliday(date)) return 0
  return Math.round(weeklyMinutesOn(info, date)! / 5)
}
```

`shared/domain/balance.ts`:
```ts
import { dateRange } from './dates'
import { dailyTarget, employmentStart, isEmployedOn, type EmploymentInfo } from './targets'
import { netMinutes } from './time'
import type { DomainEntry, IsoDate } from './types'

export interface DayResult {
  date: IsoDate
  target: number
  credit: number
  delta: number
}

export interface Totals {
  target: number
  credit: number
  delta: number
}

export interface Adjustment {
  date: IsoDate
  minutes: number
}

export function dayCredit(entries: DomainEntry[], target: number): number {
  if (entries.some(entry => entry.creditMode === 'daily_target')) return target
  return entries.reduce((sum, entry) => {
    if (entry.start === null || entry.end === null) return sum
    return sum + netMinutes({ start: entry.start, end: entry.end, breakStart: entry.breakStart, breakEnd: entry.breakEnd })
  }, 0)
}

export function computeDay(info: EmploymentInfo, date: IsoDate, entries: DomainEntry[]): DayResult {
  const target = dailyTarget(info, date)
  const credit = isEmployedOn(info, date) ? dayCredit(entries, target) : 0
  return { date, target, credit, delta: credit - target }
}

export function computeRange(info: EmploymentInfo, entries: DomainEntry[], from: IsoDate, to: IsoDate): DayResult[] {
  const byDate = new Map<IsoDate, DomainEntry[]>()
  for (const entry of entries) {
    if (entry.date < from || entry.date > to) continue
    const list = byDate.get(entry.date) ?? []
    list.push(entry)
    byDate.set(entry.date, list)
  }
  return dateRange(from, to).map(date => computeDay(info, date, byDate.get(date) ?? []))
}

export function summarize(days: DayResult[]): Totals {
  return days.reduce(
    (totals, day) => ({
      target: totals.target + day.target,
      credit: totals.credit + day.credit,
      delta: totals.delta + day.delta,
    }),
    { target: 0, credit: 0, delta: 0 },
  )
}

export function balanceUntil(
  info: EmploymentInfo, entries: DomainEntry[], adjustments: Adjustment[], until: IsoDate,
): number {
  const adjusted = adjustments.filter(a => a.date <= until).reduce((sum, a) => sum + a.minutes, 0)
  const start = employmentStart(info)
  if (start === null || start > until) return adjusted
  return adjusted + summarize(computeRange(info, entries, start, until)).delta
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/domain`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "feat: add daily targets and hour balance calculation"
```

---

### Task 4: Vacation account

**Files:**
- Create: `shared/domain/leave.ts`
- Test: `tests/domain/leave.test.ts`

**Interfaces:**
- Consumes: `addDays`, `isWeekend` (Task 2), `isHoliday` (Task 2)
- Produces: `interface LeaveEntitlement { days: number; carriedOverDays: number }`, `interface LeaveAccount { entitlement; carriedOver; taken; planned; available }`, `interface LeaveRange { from: IsoDate; to: IsoDate; days: number }`, `countsAsLeaveDay(date): boolean`, `leaveAccount(entitlement: LeaveEntitlement | null, vacationDates: IsoDate[], year: number, today: IsoDate): LeaveAccount`, `groupLeaveRanges(dates: IsoDate[]): LeaveRange[]`

- [ ] **Step 1: Write the failing test**

`tests/domain/leave.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { groupLeaveRanges, leaveAccount } from '../../shared/domain/leave'

describe('leaveAccount', () => {
  const dates = [
    '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09',
    '2026-10-10', // Saturday – ignored
    '2026-12-24', '2026-12-25', // 25th is a holiday – ignored
    '2025-12-30', // other year – ignored
    '2026-10-05', // duplicate – ignored
  ]
  it('splits taken and planned days around today', () => {
    expect(leaveAccount({ days: 30, carriedOverDays: 3 }, dates, 2026, '2026-10-07')).toEqual({
      entitlement: 30, carriedOver: 3, taken: 2, planned: 4, available: 27,
    })
  })
  it('works without an entitlement record', () => {
    expect(leaveAccount(null, ['2026-10-05'], 2026, '2026-10-01')).toEqual({
      entitlement: 0, carriedOver: 0, taken: 0, planned: 1, available: -1,
    })
  })
})

describe('groupLeaveRanges', () => {
  it('bridges weekends between leave days', () => {
    expect(groupLeaveRanges(['2026-10-13', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-20'])).toEqual([
      { from: '2026-10-08', to: '2026-10-13', days: 4 },
      { from: '2026-10-20', to: '2026-10-20', days: 1 },
    ])
  })
  it('bridges holidays between leave days', () => {
    expect(groupLeaveRanges(['2026-12-23', '2026-12-24', '2026-12-28'])).toEqual([
      { from: '2026-12-23', to: '2026-12-28', days: 3 },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/leave.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`shared/domain/leave.ts`:
```ts
import { addDays, isWeekend } from './dates'
import { isHoliday } from './holidays'
import type { IsoDate } from './types'

export interface LeaveEntitlement {
  days: number
  carriedOverDays: number
}

export interface LeaveAccount {
  entitlement: number
  carriedOver: number
  taken: number
  planned: number
  available: number
}

export interface LeaveRange {
  from: IsoDate
  to: IsoDate
  days: number
}

export function countsAsLeaveDay(date: IsoDate): boolean {
  return !isWeekend(date) && !isHoliday(date)
}

function leaveDays(dates: IsoDate[]): IsoDate[] {
  return [...new Set(dates)].filter(countsAsLeaveDay).sort()
}

export function leaveAccount(
  entitlement: LeaveEntitlement | null, vacationDates: IsoDate[], year: number, today: IsoDate,
): LeaveAccount {
  const days = leaveDays(vacationDates).filter(date => date.startsWith(`${year}-`))
  const taken = days.filter(date => date < today).length
  const planned = days.length - taken
  const total = entitlement?.days ?? 0
  const carriedOver = entitlement?.carriedOverDays ?? 0
  return { entitlement: total, carriedOver, taken, planned, available: total + carriedOver - taken - planned }
}

function nextLeaveDay(date: IsoDate): IsoDate {
  let next = addDays(date, 1)
  while (!countsAsLeaveDay(next)) next = addDays(next, 1)
  return next
}

export function groupLeaveRanges(dates: IsoDate[]): LeaveRange[] {
  const ranges: LeaveRange[] = []
  for (const date of leaveDays(dates)) {
    const current = ranges.at(-1)
    if (current && nextLeaveDay(current.to) === date) {
      current.to = date
      current.days += 1
    }
    else {
      ranges.push({ from: date, to: date, days: 1 })
    }
  }
  return ranges
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/leave.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "feat: add vacation account calculation"
```

---

### Task 5: Warnings

**Files:**
- Create: `shared/domain/warnings.ts`
- Test: `tests/domain/warnings.test.ts`

**Interfaces:**
- Consumes: `isWeekend`, `isHoliday`, `isEmployedOn`, `dailyTarget`, `dayCredit`, `DomainEntry`, test helpers from Task 3
- Produces:
  - `interface CoverageRule { id: number; label: string; start: Minutes; end: Minutes | null; minCount: number }`
  - `type Warning = { type: 'missing_entry'; date; employeeId } | { type: 'coverage'; date; ruleId; label; found; required } | { type: 'target_gap'; date; employeeId; missingMinutes }`
  - `interface EmployeeDay { employeeId: number; info: EmploymentInfo; entries: DomainEntry[] }`
  - `TARGET_GAP_CODES: CodeKey[]`, `isCheckedDay(date, isClosureDay): boolean`, `dayWarnings(date, employees: EmployeeDay[], rules: CoverageRule[], isClosureDay: boolean): Warning[]`

- [ ] **Step 1: Write the failing test**

`tests/domain/warnings.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { EmploymentInfo } from '../../shared/domain/targets'
import type { DomainEntry } from '../../shared/domain/types'
import { dayWarnings, type CoverageRule, type EmployeeDay } from '../../shared/domain/warnings'
import { code, F1, F2, S, shift, special } from '../helpers/entries'

const date = '2026-10-06'
const info: EmploymentInfo = { hours: [{ weeklyMinutes: 2340, validFrom: '2026-01-01' }], leftOn: null }
const rules: CoverageRule[] = [
  { id: 1, label: 'Spätdienst 8:45–17:00', start: 525, end: 1020, minCount: 2 },
  { id: 2, label: 'Frühdienst ab 7:00', start: 420, end: null, minCount: 1 },
  { id: 3, label: 'Frühdienst 2 ab 7:30', start: 450, end: null, minCount: 1 },
]

function team(...entryLists: DomainEntry[][]): EmployeeDay[] {
  return entryLists.map((entries, index) => ({ employeeId: index + 1, info, entries }))
}

const fullCoverage = () => [
  [shift(1, date, ...F1)], [shift(2, date, ...F2)], [shift(3, date, ...S)], [shift(4, date, ...S)],
]

describe('dayWarnings', () => {
  it('returns nothing for a fully covered day', () => {
    expect(dayWarnings(date, team(...fullCoverage()), rules, false)).toEqual([])
  })
  it('reports a missing coverage shift with counts', () => {
    const lists = fullCoverage()
    lists[3] = [shift(4, date, 465, 960, 700, 730)]
    expect(dayWarnings(date, team(...lists), rules, false)).toEqual([
      { type: 'coverage', date, ruleId: 1, label: 'Spätdienst 8:45–17:00', found: 1, required: 2 },
    ])
  })
  it('counts special shifts but not codes for coverage', () => {
    const lists = fullCoverage()
    lists[3] = [special(4, date, 525, 1020)]
    lists[0] = [code(1, date, 'prep_time', 'timed', 420, 540)]
    expect(dayWarnings(date, team(...lists), rules, false)).toEqual([
      { type: 'coverage', date, ruleId: 2, label: 'Frühdienst ab 7:00', found: 0, required: 1 },
      { type: 'target_gap', date, employeeId: 1, missingMinutes: 348 },
    ])
  })
  it('reports employees without any entry, but not those who left', () => {
    const lists = [...fullCoverage(), []]
    const employees = team(...lists)
    employees.push({ employeeId: 9, info: { ...info, leftOn: '2026-09-30' }, entries: [] })
    expect(dayWarnings(date, employees, rules, false)).toEqual([
      { type: 'missing_entry', date, employeeId: 5 },
    ])
  })
  it('does not report sick employees', () => {
    const lists = [...fullCoverage(), [code(5, date, 'sick', 'daily_target')]]
    expect(dayWarnings(date, team(...lists), rules, false)).toEqual([])
  })
  it('reports the remaining time when VZ does not fill the day (5:48 h)', () => {
    const lists = [...fullCoverage(), [code(5, date, 'prep_time', 'timed', 450, 570)]]
    expect(dayWarnings(date, team(...lists), rules, false)).toEqual([
      { type: 'target_gap', date, employeeId: 5, missingMinutes: 348 },
    ])
  })
  it('skips weekends, holidays and closure days', () => {
    expect(dayWarnings('2026-10-10', team([]), rules, false)).toEqual([])
    expect(dayWarnings('2026-12-25', team([]), rules, false)).toEqual([])
    expect(dayWarnings(date, team([]), rules, true)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/warnings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`shared/domain/warnings.ts`:
```ts
import { dayCredit } from './balance'
import { isWeekend } from './dates'
import { isHoliday } from './holidays'
import { dailyTarget, isEmployedOn, type EmploymentInfo } from './targets'
import type { CodeKey, DomainEntry, IsoDate, Minutes } from './types'

export interface CoverageRule {
  id: number
  label: string
  start: Minutes
  end: Minutes | null
  minCount: number
}

export type Warning =
  | { type: 'missing_entry'; date: IsoDate; employeeId: number }
  | { type: 'coverage'; date: IsoDate; ruleId: number; label: string; found: number; required: number }
  | { type: 'target_gap'; date: IsoDate; employeeId: number; missingMinutes: number }

export interface EmployeeDay {
  employeeId: number
  info: EmploymentInfo
  entries: DomainEntry[]
}

export const TARGET_GAP_CODES: CodeKey[] = ['prep_time', 'office']

export function isCheckedDay(date: IsoDate, isClosureDay: boolean): boolean {
  return !isWeekend(date) && !isHoliday(date) && !isClosureDay
}

function matchesRule(entry: DomainEntry, rule: CoverageRule): boolean {
  return (entry.kind === 'shift' || entry.kind === 'special')
    && entry.start === rule.start
    && (rule.end === null || entry.end === rule.end)
}

export function dayWarnings(
  date: IsoDate, employees: EmployeeDay[], rules: CoverageRule[], isClosureDay: boolean,
): Warning[] {
  if (!isCheckedDay(date, isClosureDay)) return []
  const warnings: Warning[] = []
  const allEntries = employees.flatMap(employee => employee.entries)

  for (const rule of rules) {
    const found = allEntries.filter(entry => matchesRule(entry, rule)).length
    if (found < rule.minCount) {
      warnings.push({ type: 'coverage', date, ruleId: rule.id, label: rule.label, found, required: rule.minCount })
    }
  }

  for (const { employeeId, info, entries } of employees) {
    if (!isEmployedOn(info, date)) continue
    if (entries.length === 0) {
      warnings.push({ type: 'missing_entry', date, employeeId })
      continue
    }
    const hasGapCode = entries.some(entry => entry.codeKey !== null && TARGET_GAP_CODES.includes(entry.codeKey))
    if (!hasGapCode) continue
    const target = dailyTarget(info, date)
    const credit = dayCredit(entries, target)
    if (credit < target) warnings.push({ type: 'target_gap', date, employeeId, missingMinutes: target - credit })
  }

  return warnings
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/warnings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "feat: add missing-entry, coverage and target-gap warnings"
```

---

### Task 6: Day overview, labels and cell keys

**Files:**
- Create: `shared/domain/dayOverview.ts`, `shared/domain/describe.ts`, `shared/domain/cells.ts`
- Test: `tests/domain/dayOverview.test.ts`, `tests/domain/describe.test.ts`

**Interfaces:**
- Consumes: `formatTime` (Task 1), `DomainEntry`, `CodeKey`
- Produces:
  - `type SlotState = 'off' | 'work' | 'support' | 'break' | 'absent' | 'prep_time' | 'office' | 'holiday' | 'other'`, `SLOT_MINUTES = 15`, `interface OverviewInput { employeeId: number; entries: DomainEntry[] }`, `interface OverviewRow { employeeId: number; states: SlotState[] }`, `interface DayOverview { slotStarts: Minutes[]; rows: OverviewRow[]; present: number[] }`, `buildDayOverview(inputs: OverviewInput[], isHolidayDay: boolean): DayOverview`
  - `describeEntry(entry: { kind; start; end }, codeLabel: string | null): string`, `describeCell(entries: { label: string }[]): string` (returns `'—'` when empty)
  - `cellKey(employeeId, date): string` (`"3|2026-10-05"`), `parseCellKey(key): { employeeId; date }`, `noteKey(field: 'info1' | 'info2', date): string`

- [ ] **Step 1: Write the failing tests**

`tests/domain/dayOverview.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { buildDayOverview } from '../../shared/domain/dayOverview'
import { code, F1, M, shift, special } from '../helpers/entries'

const date = '2026-10-06'
const slot = (minutes: number) => (minutes - 420) / 15

describe('buildDayOverview', () => {
  it('uses 15-minute slots from 7:00 to 17:00 by default', () => {
    const overview = buildDayOverview([{ employeeId: 1, entries: [shift(1, date, ...M)] }], false)
    expect(overview.slotStarts[0]).toBe(420)
    expect(overview.slotStarts.at(-1)).toBe(1005)
    expect(overview.slotStarts).toHaveLength(40)
  })
  it('marks work and breaks by slot start', () => {
    const { rows } = buildDayOverview([{ employeeId: 1, entries: [shift(1, date, ...M)] }], false)
    const states = rows[0]!.states
    expect(states[slot(450)]).toBe('off')
    expect(states[slot(465)]).toBe('work')
    expect(states[slot(690)]).toBe('work')
    expect(states[slot(705)]).toBe('break')
    expect(states[slot(720)]).toBe('break')
    expect(states[slot(735)]).toBe('work')
    expect(states[slot(960)]).toBe('off')
  })
  it('counts present staff per slot, excluding housekeeping and breaks', () => {
    const overview = buildDayOverview([
      { employeeId: 1, entries: [shift(1, date, ...M)] },
      { employeeId: 2, entries: [shift(2, date, ...F1)] },
      { employeeId: 3, entries: [shift(3, date, 660, 960, null, null, { countsAsStaff: false })] },
      { employeeId: 4, entries: [code(4, date, 'prep_time', 'timed', 450, 570)] },
    ], false)
    expect(overview.rows[2]!.states[slot(660)]).toBe('support')
    expect(overview.rows[3]!.states[slot(450)]).toBe('prep_time')
    expect(overview.present[slot(420)]).toBe(1)
    expect(overview.present[slot(465)]).toBe(3)
    expect(overview.present[slot(705)]).toBe(1)
  })
  it('fills full-day codes and holidays across the row', () => {
    const overview = buildDayOverview([
      { employeeId: 1, entries: [code(1, date, 'sick', 'daily_target')] },
      { employeeId: 2, entries: [] },
    ], true)
    expect(new Set(overview.rows[0]!.states)).toEqual(new Set(['absent']))
    expect(new Set(overview.rows[1]!.states)).toEqual(new Set(['holiday']))
    expect(overview.present.every(count => count === 0)).toBe(true)
  })
  it('extends the range to entries outside 7:00–17:00', () => {
    const overview = buildDayOverview([{ employeeId: 1, entries: [special(1, date, 840, 1110)] }], false)
    expect(overview.slotStarts.at(-1)).toBe(1125)
    expect(overview.slotStarts).toHaveLength(48)
  })
})
```

`tests/domain/describe.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { cellKey, noteKey, parseCellKey } from '../../shared/domain/cells'
import { describeCell, describeEntry } from '../../shared/domain/describe'

describe('describeEntry', () => {
  it('shows times for shifts and special shifts', () => {
    expect(describeEntry({ kind: 'shift', start: 450, end: 945 }, null)).toBe('7:30–15:45')
    expect(describeEntry({ kind: 'special', start: 840, end: 1080 }, null)).toBe('14:00–18:00')
  })
  it('shows the code label, with times when present', () => {
    expect(describeEntry({ kind: 'code', start: null, end: null }, 'Krank')).toBe('Krank')
    expect(describeEntry({ kind: 'code', start: 450, end: 570 }, 'VZ')).toBe('VZ 7:30–9:30')
  })
  it('joins several entries of a cell', () => {
    expect(describeCell([{ label: 'VZ 7:30–9:30' }, { label: '9:30–15:45' }])).toBe('VZ 7:30–9:30 + 9:30–15:45')
    expect(describeCell([])).toBe('—')
  })
})

describe('cell keys', () => {
  it('round-trips cell keys', () => {
    expect(cellKey(3, '2026-10-05')).toBe('3|2026-10-05')
    expect(parseCellKey('3|2026-10-05')).toEqual({ employeeId: 3, date: '2026-10-05' })
    expect(noteKey('info1', '2026-10-05')).toBe('info1|2026-10-05')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/domain/dayOverview.test.ts tests/domain/describe.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

`shared/domain/dayOverview.ts`:
```ts
import type { CodeKey, DomainEntry, Minutes } from './types'

export type SlotState =
  | 'off' | 'work' | 'support' | 'break'
  | 'absent' | 'prep_time' | 'office' | 'holiday' | 'other'

export const SLOT_MINUTES = 15
const DEFAULT_START = 7 * 60
const DEFAULT_END = 17 * 60
const PRESENT_STATES: SlotState[] = ['work', 'prep_time', 'office']

export interface OverviewInput {
  employeeId: number
  entries: DomainEntry[]
}

export interface OverviewRow {
  employeeId: number
  states: SlotState[]
}

export interface DayOverview {
  slotStarts: Minutes[]
  rows: OverviewRow[]
  present: number[]
}

function codeState(codeKey: CodeKey | null): SlotState {
  switch (codeKey) {
    case 'vacation': case 'sick': case 'training': case 'school': return 'absent'
    case 'prep_time': return 'prep_time'
    case 'office': return 'office'
    case 'holiday': case 'closure_day': return 'holiday'
    default: return 'other'
  }
}

function stateAt(entries: DomainEntry[], time: Minutes): SlotState {
  let state: SlotState = 'off'
  for (const entry of entries) {
    if (entry.start === null || entry.end === null || time < entry.start || time >= entry.end) continue
    if (entry.breakStart !== null && entry.breakEnd !== null && time >= entry.breakStart && time < entry.breakEnd) {
      return 'break'
    }
    const entryState: SlotState = entry.kind === 'code'
      ? codeState(entry.codeKey)
      : entry.countsAsStaff ? 'work' : 'support'
    if (state === 'off' || state === 'work') state = entryState
  }
  return state
}

export function buildDayOverview(inputs: OverviewInput[], isHolidayDay: boolean): DayOverview {
  const timed = inputs.flatMap(input => input.entries).filter(entry => entry.start !== null && entry.end !== null)
  const earliest = Math.min(DEFAULT_START, ...timed.map(entry => Math.floor(entry.start! / 60) * 60))
  const latest = Math.max(DEFAULT_END, ...timed.map(entry => Math.ceil(entry.end! / 60) * 60))
  const slotStarts: Minutes[] = []
  for (let time = earliest; time < latest; time += SLOT_MINUTES) slotStarts.push(time)

  const rows = inputs.map(({ employeeId, entries }): OverviewRow => {
    const fullDay = entries.find(entry => entry.start === null)
    const fill: SlotState | null = fullDay
      ? codeState(fullDay.codeKey)
      : entries.length === 0 && isHolidayDay ? 'holiday' : null
    const states = slotStarts.map((time) => {
      const state = stateAt(entries, time)
      return state === 'off' && fill ? fill : state
    })
    return { employeeId, states }
  })

  const present = slotStarts.map((_, index) => rows.filter(row => PRESENT_STATES.includes(row.states[index]!)).length)
  return { slotStarts, rows, present }
}
```

`shared/domain/describe.ts`:
```ts
import { formatTime } from './time'
import type { EntryKind, Minutes } from './types'

export function describeEntry(
  entry: { kind: EntryKind; start: Minutes | null; end: Minutes | null }, codeLabel: string | null,
): string {
  const times = entry.start !== null && entry.end !== null ? `${formatTime(entry.start)}–${formatTime(entry.end)}` : ''
  if (entry.kind !== 'code') return times
  return times ? `${codeLabel ?? ''} ${times}`.trim() : (codeLabel ?? '')
}

export function describeCell(entries: { label: string }[]): string {
  return entries.length > 0 ? entries.map(entry => entry.label).join(' + ') : '—'
}
```

`shared/domain/cells.ts`:
```ts
import type { IsoDate } from './types'

export function cellKey(employeeId: number, date: IsoDate): string {
  return `${employeeId}|${date}`
}

export function parseCellKey(key: string): { employeeId: number; date: IsoDate } {
  const [employeeId, date] = key.split('|')
  return { employeeId: Number(employeeId), date: date! }
}

export function noteKey(field: 'info1' | 'info2', date: IsoDate): string {
  return `${field}|${date}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/domain`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "feat: add day overview timeline, entry labels and cell keys"
```

### Task 7: Database schema, migrations, seed and shared DTOs

**Files:**
- Create: `drizzle.config.ts`, `server/db/schema.ts`, `server/db/client.ts`, `server/db/seed.ts`, `server/lib/errors.ts`, `server/lib/password.ts`, `shared/types/api.ts`, `shared/types/auth.d.ts`
- Generated: `server/db/migrations/*`
- Test: `tests/helpers/fixtures.ts`, `tests/services/db.test.ts`, `tests/services/password.test.ts`

**Interfaces:**
- Consumes: domain types from Tasks 1–6
- Produces:
  - Drizzle tables: `employees`, `employeeHours`, `balanceAdjustments`, `leaveEntitlements`, `users`, `shiftTemplates`, `absenceCodes`, `closures`, `entries`, `dayNotes`, `monthPlans`, `changeLog`, `coverageRules`
  - `type Db` (accepts the root database and transactions), `createDb(filename): { db: Db; sqlite: Database.Database }`, `migrateDb(db, migrationsFolder): void`
  - `seedDefaults(db): void`, `ensureInitialAdmin(db, username?, password?): boolean`
  - `class ServiceError extends Error { statusCode: number; code: string }`
  - `hashPassword(pw): string`, `verifyPassword(pw, stored): boolean`, `MIN_PASSWORD_LENGTH = 8`
  - all DTO types in `shared/types/api.ts` (see code), `COLOR_KEYS`
  - fixtures: `createTestDb(): Db`, `addEmployee(db, name, options?): number`, `addUser(db, username, role, employeeId?): SessionUser`, `TEST_PASSWORD`, `templateId(db, shortLabel): number`, `codeId(db, key): number`, `errorCode(fn): string | null`

- [ ] **Step 1: Write the shared DTO types**

`shared/types/api.ts`:
```ts
import type { HolidayKey } from '../domain/holidays'
import type { LeaveAccount, LeaveRange } from '../domain/leave'
import type { CodeKey, CreditMode, DomainEntry, EntryKind, IsoDate, Minutes } from '../domain/types'
import type { Warning } from '../domain/warnings'

export const COLOR_KEYS = ['neutral', 'gray', 'green', 'yellow', 'blue', 'red', 'violet', 'orange'] as const
export type ColorKey = typeof COLOR_KEYS[number]

export type Role = 'admin' | 'observer'
export type ClosureMode = 'vacation' | 'closure_day'
export type NoteField = 'info1' | 'info2'
export type ChangeField = 'entry' | NoteField
export type ApplyMode = 'replace' | 'add' | 'clear'

export interface SessionUser {
  id: number
  username: string
  role: Role
  employeeId: number | null
  mustChangePassword: boolean
}

export interface CellRef {
  employeeId: number
  date: IsoDate
}

export interface EntryInput {
  kind: EntryKind
  templateId?: number | null
  codeId?: number | null
  start?: Minutes | null
  end?: Minutes | null
  breakStart?: Minutes | null
  breakEnd?: Minutes | null
  note?: string | null
}

export interface EntryDto extends DomainEntry {
  id: number
  templateId: number | null
  codeId: number | null
  note: string | null
  label: string
  shortLabel: string | null
  color: ColorKey
}

export interface TemplateDto {
  id: number
  shortLabel: string
  label: string
  start: Minutes
  end: Minutes
  breakStart: Minutes | null
  breakEnd: Minutes | null
  countsAsStaff: boolean
  sortOrder: number
}

export interface CodeDto {
  id: number
  key: CodeKey
  label: string
  color: ColorKey
  creditMode: CreditMode
  requiresTimes: boolean
  sortOrder: number
}

export interface CoverageRuleDto {
  id: number
  label: string
  start: Minutes
  end: Minutes | null
  minCount: number
  active: boolean
}

export interface DayRowDto {
  date: IsoDate
  weekday: number
  isWeekend: boolean
  holidayKey: HolidayKey | null
  closureLabel: string | null
  info1: string
  info2: string
}

export interface ChangeDto {
  field: ChangeField
  employeeId: number | null
  date: IsoDate
  before: string
  after: string
  changedAt: string
  changedBy: string
}

export interface ReleaseDto {
  releasedAt: string | null
  releasedBy: string | null
  changeCount: number
}

export interface EmployeeColumnDto {
  id: number
  name: string
  shortName: string
}

export interface WeekSummaryDto {
  weekStart: IsoDate
  weekEnd: IsoDate
  weekNumber: number
  totals: { employeeId: number; target: number; credit: number; delta: number }[]
}

export interface BalanceDto {
  employeeId: number
  name: string
  weeklyMinutes: number | null
  today: number
  monthEnd: number
}

export interface MonthPlanAdminDto {
  warnings: Warning[]
  weeks: WeekSummaryDto[]
  balances: BalanceDto[]
}

export interface MonthPlanDto {
  year: number
  month: number
  release: ReleaseDto
  days: DayRowDto[]
  employees: EmployeeColumnDto[]
  entries: EntryDto[]
  /** Keyed by cellKey(employeeId, date) or noteKey(field, date). */
  changes: Record<string, ChangeDto[]>
  templates: TemplateDto[]
  codes: CodeDto[]
  admin: MonthPlanAdminDto | null
}

export interface MyPlanDayDto extends DayRowDto {
  entries: EntryDto[]
  changes: ChangeDto[]
}

export interface MyPlanDto {
  year: number
  month: number
  employee: EmployeeColumnDto
  release: ReleaseDto
  days: MyPlanDayDto[]
}

export interface LeaveAccountDto {
  employeeId: number
  name: string
  year: number
  account: LeaveAccount
  ranges: LeaveRange[]
}

export interface EmployeeListItemDto {
  id: number
  name: string
  shortName: string
  sortOrder: number
  leftOn: IsoDate | null
  currentWeeklyMinutes: number | null
}

export interface EmployeeDetailDto extends EmployeeListItemDto {
  hours: { id: number; weeklyMinutes: number; validFrom: IsoDate }[]
  adjustments: { id: number; date: IsoDate; minutes: number; reason: string }[]
  entitlements: { id: number; year: number; days: number; carriedOverDays: number }[]
}

export interface UserDto {
  id: number
  username: string
  role: Role
  employeeId: number | null
  employeeName: string | null
  active: boolean
  mustChangePassword: boolean
  lockedUntil: string | null
}

export interface ClosureDto {
  id: number
  startDate: IsoDate
  endDate: IsoDate
  label: string
  mode: ClosureMode
}

export interface SettingsDto {
  templates: TemplateDto[]
  codes: CodeDto[]
  coverageRules: CoverageRuleDto[]
}
```

`shared/types/auth.d.ts`:
```ts
import type { SessionUser } from './api'

declare module '#auth-utils' {
  interface User extends SessionUser {}
}

export {}
```

- [ ] **Step 2: Write the schema, client, errors and password helpers**

`drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
})
```

`server/db/schema.ts`:
```ts
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const employees = sqliteTable('employees', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  shortName: text('short_name').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  leftOn: text('left_on'),
})

export const employeeHours = sqliteTable('employee_hours', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  weeklyMinutes: integer('weekly_minutes').notNull(),
  validFrom: text('valid_from').notNull(),
}, table => [uniqueIndex('employee_hours_employee_valid_from').on(table.employeeId, table.validFrom)])

export const balanceAdjustments = sqliteTable('balance_adjustments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  minutes: integer('minutes').notNull(),
  reason: text('reason').notNull(),
})

export const leaveEntitlements = sqliteTable('leave_entitlements', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  days: real('days').notNull(),
  carriedOverDays: real('carried_over_days').notNull().default(0),
}, table => [uniqueIndex('leave_entitlements_employee_year').on(table.employeeId, table.year)])

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'observer'] }).notNull(),
  employeeId: integer('employee_id').references(() => employees.id, { onDelete: 'set null' }).unique(),
  mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: text('locked_until'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
})

export const shiftTemplates = sqliteTable('shift_templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  shortLabel: text('short_label').notNull().default(''),
  label: text('label').notNull(),
  start: integer('start').notNull(),
  end: integer('end').notNull(),
  breakStart: integer('break_start'),
  breakEnd: integer('break_end'),
  countsAsStaff: integer('counts_as_staff', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const absenceCodes = sqliteTable('absence_codes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  label: text('label').notNull(),
  color: text('color').notNull(),
  creditMode: text('credit_mode', { enum: ['daily_target', 'timed', 'none'] }).notNull(),
  requiresTimes: integer('requires_times', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const closures = sqliteTable('closures', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  label: text('label').notNull(),
  mode: text('mode', { enum: ['vacation', 'closure_day'] }).notNull(),
})

export const entries = sqliteTable('entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  employeeId: integer('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  kind: text('kind', { enum: ['shift', 'special', 'code'] }).notNull(),
  shiftTemplateId: integer('shift_template_id').references(() => shiftTemplates.id, { onDelete: 'set null' }),
  absenceCodeId: integer('absence_code_id').references(() => absenceCodes.id),
  start: integer('start'),
  end: integer('end'),
  breakStart: integer('break_start'),
  breakEnd: integer('break_end'),
  countsAsStaff: integer('counts_as_staff', { mode: 'boolean' }).notNull().default(true),
  note: text('note'),
  closureId: integer('closure_id').references(() => closures.id, { onDelete: 'set null' }),
  updatedAt: text('updated_at').notNull(),
  updatedBy: integer('updated_by').references(() => users.id, { onDelete: 'set null' }),
}, table => [
  index('entries_date').on(table.date),
  index('entries_employee_date').on(table.employeeId, table.date),
])

export const dayNotes = sqliteTable('day_notes', {
  date: text('date').primaryKey(),
  info1: text('info1').notNull().default(''),
  info2: text('info2').notNull().default(''),
})

export const monthPlans = sqliteTable('month_plans', {
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  releasedAt: text('released_at'),
  releasedBy: integer('released_by').references(() => users.id, { onDelete: 'set null' }),
}, table => [primaryKey({ columns: [table.year, table.month] })])

export const changeLog = sqliteTable('change_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),
  employeeId: integer('employee_id').references(() => employees.id, { onDelete: 'cascade' }),
  field: text('field', { enum: ['entry', 'info1', 'info2'] }).notNull(),
  before: text('before').notNull(),
  after: text('after').notNull(),
  changedAt: text('changed_at').notNull(),
  changedBy: integer('changed_by').references(() => users.id, { onDelete: 'set null' }),
}, table => [index('change_log_date').on(table.date)])

export const coverageRules = sqliteTable('coverage_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  label: text('label').notNull(),
  start: integer('start').notNull(),
  end: integer('end'),
  minCount: integer('min_count').notNull().default(1),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
})
```

`server/db/client.ts`:
```ts
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import * as schema from './schema'

/** Accepts both the root database and a transaction. */
export type Db = BaseSQLiteDatabase<'sync', Database.RunResult, typeof schema>

export function createDb(filename: string): { db: Db; sqlite: Database.Database } {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true })
  const sqlite = new Database(filename)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  return { db: drizzle({ client: sqlite, schema }), sqlite }
}

export function migrateDb(db: Db, migrationsFolder: string): void {
  migrate(db as Parameters<typeof migrate>[0], { migrationsFolder })
}
```

`server/lib/errors.ts`:
```ts
/** Expected business error; handlers translate it into an HTTP error with `data.code`. */
export class ServiceError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string) {
    super(code)
    this.name = 'ServiceError'
  }
}
```

`server/lib/password.ts`:
```ts
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export const MIN_PASSWORD_LENGTH = 8
const KEY_LENGTH = 64

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, KEY_LENGTH)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, salt, hash] = stored.split('$')
  if (algorithm !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length)
  return timingSafeEqual(actual, expected)
}
```

`server/db/seed.ts`:
```ts
import { count } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { hashPassword } from '../lib/password'
import type { Db } from './client'
import { absenceCodes, coverageRules, shiftTemplates, users } from './schema'

export const DEFAULT_TEMPLATES: (typeof shiftTemplates.$inferInsert)[] = [
  { shortLabel: 'F1', label: 'Frühdienst', start: 420, end: 795, breakStart: null, breakEnd: null, countsAsStaff: true, sortOrder: 1 },
  { shortLabel: 'F2', label: 'Frühdienst 2', start: 450, end: 945, breakStart: 700, breakEnd: 730, countsAsStaff: true, sortOrder: 2 },
  { shortLabel: 'M', label: 'Mitteldienst', start: 465, end: 960, breakStart: 700, breakEnd: 730, countsAsStaff: true, sortOrder: 3 },
  { shortLabel: 'S', label: 'Spätdienst', start: 525, end: 1020, breakStart: 730, breakEnd: 760, countsAsStaff: true, sortOrder: 4 },
  { shortLabel: 'HK', label: 'Haushaltskraft', start: 660, end: 960, breakStart: null, breakEnd: null, countsAsStaff: false, sortOrder: 5 },
]

export const DEFAULT_CODES: (typeof absenceCodes.$inferInsert)[] = [
  { key: 'vacation', label: 'Urlaub', color: 'gray', creditMode: 'daily_target', requiresTimes: false, sortOrder: 1 },
  { key: 'sick', label: 'Krank', color: 'gray', creditMode: 'daily_target', requiresTimes: false, sortOrder: 2 },
  { key: 'training', label: 'Fortbildung', color: 'gray', creditMode: 'daily_target', requiresTimes: false, sortOrder: 3 },
  { key: 'school', label: 'Schule', color: 'gray', creditMode: 'daily_target', requiresTimes: false, sortOrder: 4 },
  { key: 'other', label: 'sonstiges', color: 'neutral', creditMode: 'none', requiresTimes: false, sortOrder: 5 },
  { key: 'prep_time', label: 'VZ', color: 'green', creditMode: 'timed', requiresTimes: true, sortOrder: 6 },
  { key: 'office', label: 'Büro', color: 'yellow', creditMode: 'timed', requiresTimes: true, sortOrder: 7 },
  { key: 'holiday', label: 'Feiertag', color: 'blue', creditMode: 'daily_target', requiresTimes: false, sortOrder: 8 },
  { key: 'closure_day', label: 'Schließtag', color: 'blue', creditMode: 'daily_target', requiresTimes: false, sortOrder: 9 },
]

export const DEFAULT_COVERAGE_RULES: (typeof coverageRules.$inferInsert)[] = [
  { label: 'Spätdienst 8:45–17:00', start: 525, end: 1020, minCount: 2, active: true },
  { label: 'Frühdienst ab 7:00', start: 420, end: null, minCount: 1, active: true },
  { label: 'Frühdienst 2 ab 7:30', start: 450, end: null, minCount: 1, active: true },
]

function isEmpty(db: Db, table: SQLiteTable): boolean {
  return db.select({ value: count() }).from(table).get()!.value === 0
}

export function seedDefaults(db: Db): void {
  if (isEmpty(db, shiftTemplates)) db.insert(shiftTemplates).values(DEFAULT_TEMPLATES).run()
  if (isEmpty(db, absenceCodes)) db.insert(absenceCodes).values(DEFAULT_CODES).run()
  if (isEmpty(db, coverageRules)) db.insert(coverageRules).values(DEFAULT_COVERAGE_RULES).run()
}

/** Creates the first admin from environment variables when no user exists yet. */
export function ensureInitialAdmin(db: Db, username: string | undefined, password: string | undefined): boolean {
  if (!username || !password || !isEmpty(db, users)) return false
  db.insert(users).values({
    username: username.trim(), passwordHash: hashPassword(password), role: 'admin', mustChangePassword: true,
  }).run()
  return true
}
```

- [ ] **Step 3: Generate the first migration**

Run: `npm run db:generate`
Expected: a new `server/db/migrations/0000_*.sql` file plus `meta/` folder; the SQL contains `CREATE TABLE \`entries\``.

- [ ] **Step 4: Write fixtures and failing tests**

`tests/helpers/fixtures.ts`:
```ts
import { eq } from 'drizzle-orm'
import { createDb, migrateDb, type Db } from '../../server/db/client'
import { absenceCodes, employeeHours, employees, shiftTemplates, users } from '../../server/db/schema'
import { seedDefaults } from '../../server/db/seed'
import { ServiceError } from '../../server/lib/errors'
import { hashPassword } from '../../server/lib/password'
import type { Role, SessionUser } from '../../shared/types/api'

export const TEST_PASSWORD = 'secret-password'

export function createTestDb(): Db {
  const { db } = createDb(':memory:')
  migrateDb(db, 'server/db/migrations')
  seedDefaults(db)
  return db
}

export function addEmployee(
  db: Db, name: string,
  options: { weeklyHours?: number; validFrom?: string; leftOn?: string | null } = {},
): number {
  const sortOrder = db.select().from(employees).all().length + 1
  const employee = db.insert(employees)
    .values({ name, shortName: name.slice(0, 2), sortOrder, leftOn: options.leftOn ?? null })
    .returning().get()
  db.insert(employeeHours).values({
    employeeId: employee.id,
    weeklyMinutes: Math.round((options.weeklyHours ?? 39) * 60),
    validFrom: options.validFrom ?? '2026-01-01',
  }).run()
  return employee.id
}

export function addUser(db: Db, username: string, role: Role, employeeId: number | null = null): SessionUser {
  const row = db.insert(users)
    .values({ username, passwordHash: hashPassword(TEST_PASSWORD), role, employeeId })
    .returning().get()
  return { id: row.id, username, role, employeeId, mustChangePassword: false }
}

export function templateId(db: Db, shortLabel: string): number {
  return db.select().from(shiftTemplates).where(eq(shiftTemplates.shortLabel, shortLabel)).get()!.id
}

export function codeId(db: Db, key: string): number {
  return db.select().from(absenceCodes).where(eq(absenceCodes.key, key)).get()!.id
}

/** Runs fn and returns the ServiceError code it throws, or null if it does not throw. */
export function errorCode(fn: () => unknown): string | null {
  try {
    fn()
    return null
  }
  catch (error) {
    if (error instanceof ServiceError) return error.code
    throw error
  }
}
```

`tests/services/db.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { absenceCodes, coverageRules, shiftTemplates, users } from '../../server/db/schema'
import { ensureInitialAdmin, seedDefaults } from '../../server/db/seed'
import { verifyPassword } from '../../server/lib/password'
import { createTestDb } from '../helpers/fixtures'

describe('database setup', () => {
  it('seeds templates, codes and coverage rules once', () => {
    const db = createTestDb()
    seedDefaults(db)
    expect(db.select().from(shiftTemplates).all().map(t => t.shortLabel)).toEqual(['F1', 'F2', 'M', 'S', 'HK'])
    expect(db.select().from(absenceCodes).all()).toHaveLength(9)
    expect(db.select().from(coverageRules).all()).toHaveLength(3)
  })
  it('creates the initial admin only when no user exists', () => {
    const db = createTestDb()
    expect(ensureInitialAdmin(db, undefined, undefined)).toBe(false)
    expect(ensureInitialAdmin(db, 'leitung', 'start-password')).toBe(true)
    expect(ensureInitialAdmin(db, 'other', 'start-password')).toBe(false)
    const [admin] = db.select().from(users).all()
    expect(admin).toMatchObject({ username: 'leitung', role: 'admin', mustChangePassword: true })
    expect(verifyPassword('start-password', admin!.passwordHash)).toBe(true)
  })
})
```

`tests/services/password.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../../server/lib/password'

describe('password hashing', () => {
  it('verifies the right password and rejects others', () => {
    const hash = hashPassword('correct horse')
    expect(hash.startsWith('scrypt$')).toBe(true)
    expect(verifyPassword('correct horse', hash)).toBe(true)
    expect(verifyPassword('wrong horse', hash)).toBe(false)
    expect(verifyPassword('correct horse', 'garbage')).toBe(false)
  })
  it('salts every hash', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'))
  })
})
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/services`
Expected: PASS. (If the migration step was skipped the tests fail with "Can't find meta/_journal.json" — run Step 3.)

- [ ] **Step 6: Commit**

```
git add -A
git commit -m "feat: add database schema, migrations, seed data and shared DTOs"
```

---

### Task 8: Authentication and user management services

**Files:**
- Create: `server/services/auth.ts`, `server/services/users.ts`
- Test: `tests/services/auth.test.ts`, `tests/services/users.test.ts`

**Interfaces:**
- Consumes: `Db`, `users`, `employees`, `ServiceError`, `hashPassword`, `verifyPassword`, `MIN_PASSWORD_LENGTH`, `SessionUser`, `UserDto`, `Role`
- Produces:
  - `MAX_FAILED_LOGINS = 5`, `LOCK_MINUTES = 15`, `type LoginResult`, `login(db, username, password, now?): LoginResult`, `toSessionUser(row): SessionUser`, `getActiveUser(db, id): SessionUser | null`, `assertPasswordStrength(password): void`, `changePassword(db, userId, currentPassword, newPassword): void`
  - `interface UserInput { username; password; role; employeeId }`, `interface UserUpdate { role; employeeId; active }`, `listUsers(db): UserDto[]`, `createUser(db, input): UserDto`, `updateUser(db, id, update): UserDto`, `resetPassword(db, id, password): void`

- [ ] **Step 1: Write the failing tests**

`tests/services/auth.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { changePassword, getActiveUser, login } from '../../server/services/auth'
import { updateUser } from '../../server/services/users'
import { addEmployee, addUser, createTestDb, errorCode, TEST_PASSWORD } from '../helpers/fixtures'

describe('auth service', () => {
  let db: Db
  beforeEach(() => {
    db = createTestDb()
  })

  it('logs in with the right password', () => {
    const user = addUser(db, 'leitung', 'admin')
    expect(login(db, ' leitung ', TEST_PASSWORD)).toEqual({ ok: true, user })
  })
  it('rejects wrong passwords and unknown users', () => {
    addUser(db, 'leitung', 'admin')
    expect(login(db, 'leitung', 'nope')).toEqual({ ok: false, reason: 'invalid' })
    expect(login(db, 'nobody', TEST_PASSWORD)).toEqual({ ok: false, reason: 'invalid' })
  })
  it('locks the account for 15 minutes after 5 failed attempts', () => {
    addUser(db, 'leitung', 'admin')
    const now = new Date('2026-10-05T08:00:00Z')
    for (let attempt = 1; attempt <= 4; attempt++) expect(login(db, 'leitung', 'nope', now).ok).toBe(false)
    expect(login(db, 'leitung', 'nope', now)).toEqual({ ok: false, reason: 'locked' })
    expect(login(db, 'leitung', TEST_PASSWORD, new Date('2026-10-05T08:14:00Z'))).toEqual({ ok: false, reason: 'locked' })
    expect(login(db, 'leitung', TEST_PASSWORD, new Date('2026-10-05T08:16:00Z')).ok).toBe(true)
  })
  it('rejects inactive users', () => {
    addUser(db, 'leitung', 'admin')
    const anna = addEmployee(db, 'Anna')
    const observer = addUser(db, 'anna', 'observer', anna)
    updateUser(db, observer.id, { role: 'observer', employeeId: anna, active: false })
    expect(login(db, 'anna', TEST_PASSWORD)).toEqual({ ok: false, reason: 'invalid' })
    expect(getActiveUser(db, observer.id)).toBeNull()
  })
  it('changes the password and clears the must-change flag', () => {
    const user = addUser(db, 'leitung', 'admin')
    expect(errorCode(() => changePassword(db, user.id, 'nope', 'new-password'))).toBe('wrong_password')
    expect(errorCode(() => changePassword(db, user.id, TEST_PASSWORD, 'short'))).toBe('password_too_short')
    changePassword(db, user.id, TEST_PASSWORD, 'new-password')
    expect(login(db, 'leitung', 'new-password')).toMatchObject({ ok: true, user: { mustChangePassword: false } })
  })
})
```

`tests/services/users.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { login } from '../../server/services/auth'
import { createUser, listUsers, resetPassword, updateUser } from '../../server/services/users'
import { addEmployee, addUser, createTestDb, errorCode } from '../helpers/fixtures'

describe('users service', () => {
  let db: Db
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    anna = addEmployee(db, 'Anna')
  })

  it('creates an observer linked to an employee who must change the password', () => {
    const user = createUser(db, { username: 'anna', password: 'start-1234', role: 'observer', employeeId: anna })
    expect(user).toMatchObject({ username: 'anna', role: 'observer', employeeId: anna, employeeName: 'Anna', mustChangePassword: true, active: true })
    expect(listUsers(db)).toHaveLength(1)
  })
  it('validates new users', () => {
    createUser(db, { username: 'anna', password: 'start-1234', role: 'observer', employeeId: anna })
    expect(errorCode(() => createUser(db, { username: 'anna', password: 'start-1234', role: 'admin', employeeId: null }))).toBe('username_taken')
    expect(errorCode(() => createUser(db, { username: 'x', password: 'start-1234', role: 'observer', employeeId: null }))).toBe('employee_required')
    expect(errorCode(() => createUser(db, { username: 'y', password: 'start-1234', role: 'observer', employeeId: anna }))).toBe('employee_taken')
    expect(errorCode(() => createUser(db, { username: 'z', password: 'kurz', role: 'admin', employeeId: null }))).toBe('password_too_short')
    expect(errorCode(() => createUser(db, { username: '  ', password: 'start-1234', role: 'admin', employeeId: null }))).toBe('username_required')
  })
  it('never removes the last active admin', () => {
    const admin = addUser(db, 'leitung', 'admin')
    expect(errorCode(() => updateUser(db, admin.id, { role: 'observer', employeeId: anna, active: true }))).toBe('last_admin')
    expect(errorCode(() => updateUser(db, admin.id, { role: 'admin', employeeId: null, active: false }))).toBe('last_admin')
    addUser(db, 'stellvertretung', 'admin')
    expect(updateUser(db, admin.id, { role: 'admin', employeeId: null, active: false }).active).toBe(false)
  })
  it('resets a password and forces a change', () => {
    const user = addUser(db, 'leitung', 'admin')
    resetPassword(db, user.id, 'reset-1234')
    expect(login(db, 'leitung', 'reset-1234')).toMatchObject({ ok: true, user: { mustChangePassword: true } })
    expect(errorCode(() => resetPassword(db, 999, 'reset-1234'))).toBe('user_not_found')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/services/auth.test.ts tests/services/users.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

`server/services/auth.ts`:
```ts
import { eq } from 'drizzle-orm'
import type { SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from '../lib/password'

export const MAX_FAILED_LOGINS = 5
export const LOCK_MINUTES = 15

export type LoginResult = { ok: true; user: SessionUser } | { ok: false; reason: 'invalid' | 'locked' }

export function toSessionUser(row: typeof users.$inferSelect): SessionUser {
  return {
    id: row.id, username: row.username, role: row.role,
    employeeId: row.employeeId, mustChangePassword: row.mustChangePassword,
  }
}

export function login(db: Db, username: string, password: string, now: Date = new Date()): LoginResult {
  const user = db.select().from(users).where(eq(users.username, username.trim())).get()
  if (!user || !user.active) return { ok: false, reason: 'invalid' }
  if (user.lockedUntil && user.lockedUntil > now.toISOString()) return { ok: false, reason: 'locked' }

  if (!verifyPassword(password, user.passwordHash)) {
    const failed = user.failedLogins + 1
    if (failed >= MAX_FAILED_LOGINS) {
      const lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString()
      db.update(users).set({ failedLogins: 0, lockedUntil }).where(eq(users.id, user.id)).run()
      return { ok: false, reason: 'locked' }
    }
    db.update(users).set({ failedLogins: failed }).where(eq(users.id, user.id)).run()
    return { ok: false, reason: 'invalid' }
  }

  db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id)).run()
  return { ok: true, user: toSessionUser(user) }
}

export function getActiveUser(db: Db, id: number): SessionUser | null {
  const row = db.select().from(users).where(eq(users.id, id)).get()
  return row && row.active ? toSessionUser(row) : null
}

export function assertPasswordStrength(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) throw new ServiceError(400, 'password_too_short')
}

export function changePassword(db: Db, userId: number, currentPassword: string, newPassword: string): void {
  const user = db.select().from(users).where(eq(users.id, userId)).get()
  if (!user) throw new ServiceError(404, 'user_not_found')
  if (!verifyPassword(currentPassword, user.passwordHash)) throw new ServiceError(400, 'wrong_password')
  assertPasswordStrength(newPassword)
  db.update(users)
    .set({ passwordHash: hashPassword(newPassword), mustChangePassword: false })
    .where(eq(users.id, userId)).run()
}
```

`server/services/users.ts`:
```ts
import { and, asc, count, eq } from 'drizzle-orm'
import type { Role, UserDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { hashPassword } from '../lib/password'
import { assertPasswordStrength } from './auth'

export interface UserInput {
  username: string
  password: string
  role: Role
  employeeId: number | null
}

export interface UserUpdate {
  role: Role
  employeeId: number | null
  active: boolean
}

export function listUsers(db: Db): UserDto[] {
  return db.select({ user: users, employeeName: employees.name })
    .from(users)
    .leftJoin(employees, eq(users.employeeId, employees.id))
    .orderBy(asc(users.username))
    .all()
    .map(({ user, employeeName }) => ({
      id: user.id, username: user.username, role: user.role, employeeId: user.employeeId,
      employeeName: employeeName ?? null, active: user.active,
      mustChangePassword: user.mustChangePassword, lockedUntil: user.lockedUntil,
    }))
}

function findUser(db: Db, id: number): UserDto {
  const user = listUsers(db).find(candidate => candidate.id === id)
  if (!user) throw new ServiceError(404, 'user_not_found')
  return user
}

function assertEmployeeLink(db: Db, role: Role, employeeId: number | null, userId: number | null): void {
  if (role === 'observer' && employeeId === null) throw new ServiceError(400, 'employee_required')
  if (employeeId === null) return
  if (!db.select().from(employees).where(eq(employees.id, employeeId)).get()) {
    throw new ServiceError(400, 'employee_not_found')
  }
  const linked = db.select().from(users).where(eq(users.employeeId, employeeId)).get()
  if (linked && linked.id !== userId) throw new ServiceError(409, 'employee_taken')
}

function activeAdminCount(db: Db): number {
  return db.select({ value: count() }).from(users)
    .where(and(eq(users.role, 'admin'), eq(users.active, true))).get()!.value
}

export function createUser(db: Db, input: UserInput): UserDto {
  const username = input.username.trim()
  if (!username) throw new ServiceError(400, 'username_required')
  if (db.select().from(users).where(eq(users.username, username)).get()) {
    throw new ServiceError(409, 'username_taken')
  }
  assertPasswordStrength(input.password)
  assertEmployeeLink(db, input.role, input.employeeId, null)
  const row = db.insert(users).values({
    username, passwordHash: hashPassword(input.password), role: input.role,
    employeeId: input.employeeId, mustChangePassword: true,
  }).returning().get()
  return findUser(db, row.id)
}

export function updateUser(db: Db, id: number, update: UserUpdate): UserDto {
  const user = findUser(db, id)
  assertEmployeeLink(db, update.role, update.employeeId, id)
  const losesAdmin = user.role === 'admin' && user.active && (update.role !== 'admin' || !update.active)
  if (losesAdmin && activeAdminCount(db) <= 1) throw new ServiceError(409, 'last_admin')
  db.update(users)
    .set({ role: update.role, employeeId: update.employeeId, active: update.active })
    .where(eq(users.id, id)).run()
  return findUser(db, id)
}

export function resetPassword(db: Db, id: number, password: string): void {
  findUser(db, id)
  assertPasswordStrength(password)
  db.update(users).set({
    passwordHash: hashPassword(password), mustChangePassword: true, failedLogins: 0, lockedUntil: null,
  }).where(eq(users.id, id)).run()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/services`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "feat: add login with lockout and user management services"
```

---

### Task 9: Server wiring and auth endpoints

**Files:**
- Create: `server/utils/db.ts`, `server/utils/auth.ts`, `server/utils/serviceHandler.ts`, `server/plugins/database.ts`, `server/schemas.ts`
- Create: `server/api/health.get.ts`, `server/api/auth/login.post.ts`, `server/api/auth/password.post.ts`
- Modify: `.env.example` (add cookie flag), `.env`

**Interfaces:**
- Consumes: `createDb`, `migrateDb`, `seedDefaults`, `ensureInitialAdmin`, `login`, `changePassword`, `getActiveUser`, `ServiceError`
- Produces (Nitro auto-imported in `server/`):
  - `useDb(): Db`, `useSqlite(): Database.Database`
  - `requireUser(event, options?: { allowPasswordChange?: boolean }): Promise<SessionUser>`, `requireAdmin(event): Promise<SessionUser>`
  - `defineServiceHandler(handler)` — like `defineEventHandler`, converts `ServiceError` to `createError({ statusCode, statusMessage: code, data: { code } })`
  - `server/schemas.ts`: `isoDate`, `minutes`, `loginSchema`, `passwordChangeSchema` (extended in Task 15)
  - HTTP: `GET /api/health` → `{ status: 'ok' }`; `POST /api/auth/login` `{ username, password }` → `SessionUser` (401 `login_invalid` / `login_locked`); `POST /api/auth/password` `{ currentPassword, newPassword }` → `SessionUser`. Logout uses nuxt-auth-utils' built-in `DELETE /api/_auth/session`.

- [ ] **Step 1: Write the server utilities and plugin**

`server/utils/db.ts`:
```ts
import type Database from 'better-sqlite3'
import { createDb, type Db } from '../db/client'

let connection: { db: Db; sqlite: Database.Database } | null = null

function open() {
  if (!connection) connection = createDb(process.env.DATABASE_PATH || '.data/app.db')
  return connection
}

export function useDb(): Db {
  return open().db
}

export function useSqlite(): Database.Database {
  return open().sqlite
}
```

`server/utils/serviceHandler.ts`:
```ts
import type { EventHandlerRequest, H3Event } from 'h3'
import { ServiceError } from '../lib/errors'

export function defineServiceHandler<T>(handler: (event: H3Event<EventHandlerRequest>) => T | Promise<T>) {
  return defineEventHandler(async (event) => {
    try {
      return await handler(event)
    }
    catch (error) {
      if (error instanceof ServiceError) {
        throw createError({ statusCode: error.statusCode, statusMessage: error.code, data: { code: error.code } })
      }
      throw error
    }
  })
}
```

`server/utils/auth.ts`:
```ts
import type { H3Event } from 'h3'
import type { SessionUser } from '../../shared/types/api'
import { getActiveUser } from '../services/auth'

function httpError(statusCode: number, code: string) {
  return createError({ statusCode, statusMessage: code, data: { code } })
}

/** Loads the current user fresh from the database, so role changes and deactivation apply immediately. */
export async function requireUser(event: H3Event, options: { allowPasswordChange?: boolean } = {}): Promise<SessionUser> {
  const session = await requireUserSession(event)
  const user = getActiveUser(useDb(), session.user.id)
  if (!user) {
    await clearUserSession(event)
    throw httpError(401, 'session_expired')
  }
  if (user.mustChangePassword && !options.allowPasswordChange) throw httpError(403, 'password_change_required')
  return user
}

export async function requireAdmin(event: H3Event): Promise<SessionUser> {
  const user = await requireUser(event)
  if (user.role !== 'admin') throw httpError(403, 'forbidden')
  return user
}
```

`server/plugins/database.ts`:
```ts
import { migrateDb } from '../db/client'
import { ensureInitialAdmin, seedDefaults } from '../db/seed'

export default defineNitroPlugin(() => {
  const db = useDb()
  migrateDb(db, process.env.MIGRATIONS_DIR || 'server/db/migrations')
  seedDefaults(db)
  if (ensureInitialAdmin(db, process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD)) {
    console.info(`Initial admin "${process.env.ADMIN_USERNAME}" created.`)
  }
})
```

`server/schemas.ts`:
```ts
import { z } from 'zod'

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const minutes = z.number().int().min(0).max(1440)

export const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
})

export const passwordChangeSchema = z.object({
  currentPassword: z.string().max(200),
  newPassword: z.string().max(200),
})
```

- [ ] **Step 2: Write the endpoints**

`server/api/health.get.ts`:
```ts
export default defineEventHandler(() => ({ status: 'ok' }))
```

`server/api/auth/login.post.ts`:
```ts
import { loginSchema } from '../../schemas'
import { login } from '../../services/auth'

export default defineServiceHandler(async (event) => {
  const body = await readValidatedBody(event, loginSchema.parse)
  const result = login(useDb(), body.username, body.password)
  if (!result.ok) {
    const code = result.reason === 'locked' ? 'login_locked' : 'login_invalid'
    throw createError({ statusCode: 401, statusMessage: code, data: { code } })
  }
  await setUserSession(event, { user: result.user })
  return result.user
})
```

`server/api/auth/password.post.ts`:
```ts
import { passwordChangeSchema } from '../../schemas'
import { changePassword } from '../../services/auth'

export default defineServiceHandler(async (event) => {
  const user = await requireUser(event, { allowPasswordChange: true })
  const body = await readValidatedBody(event, passwordChangeSchema.parse)
  changePassword(useDb(), user.id, body.currentPassword, body.newPassword)
  const updated = { ...user, mustChangePassword: false }
  await setUserSession(event, { user: updated })
  return updated
})
```

Append to `.env.example` and `.env` (plain HTTP on localhost needs a non-secure cookie):
```
NUXT_SESSION_COOKIE_SECURE=false
```

- [ ] **Step 3: Verify against the running dev server**

Run in one terminal (background): `npm run dev`
Then run:
```
Invoke-RestMethod http://localhost:3000/api/health
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/auth/login -ContentType 'application/json' -Body '{"username":"admin","password":"admin-dev-1234"}' -SessionVariable s
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/auth/password -ContentType 'application/json' -Body '{"currentPassword":"admin-dev-1234","newPassword":"admin-dev-5678"}' -WebSession $s
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/auth/login -ContentType 'application/json' -Body '{"username":"admin","password":"wrong"}'
```
Expected: `status ok`; login returns `username admin, role admin, mustChangePassword True`; password change returns `mustChangePassword False`; the wrong login fails with HTTP 401. The dev server log shows `Initial admin "admin" created.` and `.data/app.db` exists. Afterwards update `.env`/notes: the dev admin password is now `admin-dev-5678` (or delete `.data/` to start fresh). Stop the dev server.

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "feat: wire database, session auth and login endpoints into nitro"
```

---

### Task 10: Entries, change log and release

**Files:**
- Create: `server/services/queries.ts`, `server/services/changeLog.ts`, `server/services/entries.ts`, `server/services/release.ts`
- Test: `tests/services/entries.test.ts`

**Interfaces:**
- Consumes: schema tables, `ServiceError`, `validateSpan`, `describeEntry`, `describeCell`, `parseIsoDate`, DTO types
- Produces:
  - `queries.ts`: `interface EntryFilter { from?; to?; employeeId?; closureId?; codeKey? }`, `loadEntries(db, filter?): EntryDto[]` (ordered by date, start, id), `interface EmployeeRecord { id; name; shortName; sortOrder; leftOn; info: EmploymentInfo }`, `loadEmployees(db): EmployeeRecord[]` (ordered by sortOrder, name; hours ordered by validFrom), `loadClosures(db): ClosureDto[]`, `closureOn(closures, date): ClosureDto | null`, `loadTemplates(db): TemplateDto[]`, `loadCodes(db): CodeDto[]`, `loadCoverageRules(db, activeOnly = true): CoverageRuleDto[]`, `groupByEmployee(entries): Map<number, EntryDto[]>`
  - `changeLog.ts`: `isMonthReleased(db, date): boolean`, `logChange(db, change: { date; employeeId; field: ChangeField; before; after; actorId; now: string }): void`
  - `entries.ts`: `resolveEntry(db, input: EntryInput)`, `describeCellAt(db, cell: CellRef): string`, `applyToCells(db, actor, cells, mode: ApplyMode, input: EntryInput | null, options?: { now?: Date; closureId?: number | null }): void`, `deleteEntry(db, actor, id, now?): void`, `setDayNote(db, actor, date, field: NoteField, value, now?): void`
  - `release.ts`: `releaseMonth(db, actor, year, month, now?): void`, `unreleaseMonth(db, year, month): void`

- [ ] **Step 1: Write the failing test**

`tests/services/entries.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { changeLog } from '../../server/db/schema'
import { applyToCells, deleteEntry, setDayNote } from '../../server/services/entries'
import { loadEntries } from '../../server/services/queries'
import { releaseMonth } from '../../server/services/release'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const date = '2026-10-05'

describe('entries service', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  let ben: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
    ben = addEmployee(db, 'Ben')
  })
  const annaCell = () => ({ employeeId: anna, date })
  const cellEntries = () => loadEntries(db, { employeeId: anna, from: date, to: date })

  it('copies the template times into new entries', () => {
    applyToCells(db, admin, [annaCell(), { employeeId: ben, date }], 'replace', { kind: 'shift', templateId: templateId(db, 'S') })
    const rows = loadEntries(db, { from: date, to: date })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      kind: 'shift', start: 525, end: 1020, breakStart: 730, breakEnd: 760,
      label: '8:45–17:00', shortLabel: 'S', color: 'neutral', creditMode: 'timed', countsAsStaff: true,
    })
  })
  it('marks housekeeping shifts as not counting as staff', () => {
    applyToCells(db, admin, [annaCell()], 'replace', { kind: 'shift', templateId: templateId(db, 'HK') })
    expect(cellEntries()[0]).toMatchObject({ countsAsStaff: false, color: 'violet' })
  })
  it('replaces, adds and clears', () => {
    applyToCells(db, admin, [annaCell()], 'replace', { kind: 'code', codeId: codeId(db, 'prep_time'), start: 450, end: 570 })
    applyToCells(db, admin, [annaCell()], 'add', { kind: 'special', start: 570, end: 870 })
    expect(cellEntries().map(e => e.label)).toEqual(['VZ 7:30–9:30', '9:30–14:30'])
    applyToCells(db, admin, [annaCell()], 'replace', { kind: 'code', codeId: codeId(db, 'sick') })
    expect(cellEntries().map(e => e.label)).toEqual(['Krank'])
    expect(cellEntries()[0]).toMatchObject({ codeKey: 'sick', creditMode: 'daily_target', color: 'gray', start: null })
    applyToCells(db, admin, [annaCell()], 'clear', null)
    expect(cellEntries()).toEqual([])
  })
  it('rejects invalid input', () => {
    expect(errorCode(() => applyToCells(db, admin, [annaCell()], 'replace', { kind: 'code', codeId: codeId(db, 'prep_time') }))).toBe('times_required')
    expect(errorCode(() => applyToCells(db, admin, [annaCell()], 'replace', { kind: 'special', start: 465, end: 960, breakStart: 700 }))).toBe('span_incomplete_break')
    expect(errorCode(() => applyToCells(db, admin, [annaCell()], 'replace', { kind: 'special', start: 465, end: 960, breakStart: 450, breakEnd: 480 }))).toBe('span_break_outside')
    expect(errorCode(() => applyToCells(db, admin, [annaCell()], 'replace', { kind: 'special', start: 600 }))).toBe('span_incomplete')
    expect(errorCode(() => applyToCells(db, admin, [annaCell()], 'replace', { kind: 'shift', templateId: 999 }))).toBe('template_not_found')
    expect(errorCode(() => applyToCells(db, admin, [annaCell()], 'replace', null))).toBe('entry_required')
  })
  it('rolls back all cells when one cell is invalid', () => {
    const cells = [annaCell(), { employeeId: 999, date }]
    expect(errorCode(() => applyToCells(db, admin, cells, 'replace', { kind: 'shift', templateId: templateId(db, 'M') }))).toBe('employee_not_found')
    expect(cellEntries()).toEqual([])
  })
  it('logs changes only for released months', () => {
    applyToCells(db, admin, [annaCell()], 'replace', { kind: 'shift', templateId: templateId(db, 'F2') }, { now: new Date('2026-09-20T10:00:00Z') })
    expect(db.select().from(changeLog).all()).toHaveLength(0)
    releaseMonth(db, admin, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    applyToCells(db, admin, [annaCell()], 'replace', { kind: 'shift', templateId: templateId(db, 'F2') }, { now: new Date('2026-10-01T05:00:00Z') })
    expect(db.select().from(changeLog).all()).toHaveLength(0)
    applyToCells(db, admin, [annaCell()], 'replace', { kind: 'code', codeId: codeId(db, 'sick') }, { now: new Date('2026-10-01T06:00:00Z') })
    const log = db.select().from(changeLog).all()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      date, employeeId: anna, field: 'entry', before: '7:30–15:45', after: 'Krank',
      changedAt: '2026-10-01T06:00:00.000Z', changedBy: admin.id,
    })
  })
  it('deletes single entries and logs it', () => {
    releaseMonth(db, admin, 2026, 10)
    applyToCells(db, admin, [annaCell()], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    deleteEntry(db, admin, cellEntries()[0]!.id)
    expect(cellEntries()).toEqual([])
    expect(db.select().from(changeLog).all().at(-1)).toMatchObject({ before: '7:45–16:00', after: '—' })
    expect(errorCode(() => deleteEntry(db, admin, 999))).toBe('entry_not_found')
  })
  it('saves day notes and logs changes after release', () => {
    setDayNote(db, admin, date, 'info1', 'Elternabend')
    releaseMonth(db, admin, 2026, 10)
    setDayNote(db, admin, date, 'info1', 'Elternabend 19 Uhr')
    expect(db.select().from(changeLog).all()).toEqual([
      expect.objectContaining({ field: 'info1', employeeId: null, before: 'Elternabend', after: 'Elternabend 19 Uhr' }),
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/entries.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

`server/services/queries.ts`:
```ts
import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { describeEntry } from '../../shared/domain/describe'
import type { EmploymentInfo } from '../../shared/domain/targets'
import type { CodeKey, IsoDate } from '../../shared/domain/types'
import type { ClosureDto, CodeDto, ColorKey, CoverageRuleDto, EntryDto, TemplateDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { absenceCodes, closures, coverageRules, employeeHours, employees, entries, shiftTemplates } from '../db/schema'

export interface EntryFilter {
  from?: IsoDate
  to?: IsoDate
  employeeId?: number
  closureId?: number
  codeKey?: CodeKey
}

export interface EmployeeRecord {
  id: number
  name: string
  shortName: string
  sortOrder: number
  leftOn: IsoDate | null
  info: EmploymentInfo
}

export function loadEntries(db: Db, filter: EntryFilter = {}): EntryDto[] {
  const rows = db.select({ entry: entries, code: absenceCodes, template: shiftTemplates })
    .from(entries)
    .leftJoin(absenceCodes, eq(entries.absenceCodeId, absenceCodes.id))
    .leftJoin(shiftTemplates, eq(entries.shiftTemplateId, shiftTemplates.id))
    .where(and(
      filter.from ? gte(entries.date, filter.from) : undefined,
      filter.to ? lte(entries.date, filter.to) : undefined,
      filter.employeeId !== undefined ? eq(entries.employeeId, filter.employeeId) : undefined,
      filter.closureId !== undefined ? eq(entries.closureId, filter.closureId) : undefined,
      filter.codeKey ? eq(absenceCodes.key, filter.codeKey) : undefined,
    ))
    .orderBy(asc(entries.date), asc(entries.start), asc(entries.id))
    .all()

  return rows.map(({ entry, code, template }): EntryDto => ({
    id: entry.id,
    employeeId: entry.employeeId,
    date: entry.date,
    kind: entry.kind,
    templateId: entry.shiftTemplateId,
    codeId: entry.absenceCodeId,
    codeKey: (code?.key ?? null) as CodeKey | null,
    creditMode: entry.kind === 'code' ? (code?.creditMode ?? 'none') : 'timed',
    start: entry.start,
    end: entry.end,
    breakStart: entry.breakStart,
    breakEnd: entry.breakEnd,
    countsAsStaff: entry.countsAsStaff,
    note: entry.note,
    label: describeEntry(entry, code?.label ?? null),
    shortLabel: template?.shortLabel || null,
    color: entry.kind === 'code' ? (code?.color ?? 'neutral') as ColorKey : entry.countsAsStaff ? 'neutral' : 'violet',
  }))
}

export function groupByEmployee(list: EntryDto[]): Map<number, EntryDto[]> {
  const map = new Map<number, EntryDto[]>()
  for (const entry of list) {
    const bucket = map.get(entry.employeeId) ?? []
    bucket.push(entry)
    map.set(entry.employeeId, bucket)
  }
  return map
}

export function loadEmployees(db: Db): EmployeeRecord[] {
  const hours = db.select().from(employeeHours).orderBy(asc(employeeHours.validFrom)).all()
  return db.select().from(employees).orderBy(asc(employees.sortOrder), asc(employees.name)).all()
    .map(row => ({
      ...row,
      info: {
        hours: hours.filter(h => h.employeeId === row.id).map(h => ({ weeklyMinutes: h.weeklyMinutes, validFrom: h.validFrom })),
        leftOn: row.leftOn,
      },
    }))
}

export function loadClosures(db: Db): ClosureDto[] {
  return db.select().from(closures).orderBy(asc(closures.startDate)).all()
}

export function closureOn(list: ClosureDto[], date: IsoDate): ClosureDto | null {
  return list.find(closure => closure.startDate <= date && date <= closure.endDate) ?? null
}

export function loadTemplates(db: Db): TemplateDto[] {
  return db.select().from(shiftTemplates).orderBy(asc(shiftTemplates.sortOrder), asc(shiftTemplates.start)).all()
}

export function loadCodes(db: Db): CodeDto[] {
  return db.select().from(absenceCodes).orderBy(asc(absenceCodes.sortOrder)).all()
    .map(code => ({ ...code, key: code.key as CodeKey, color: code.color as ColorKey }))
}

export function loadCoverageRules(db: Db, activeOnly = true): CoverageRuleDto[] {
  return db.select().from(coverageRules)
    .where(activeOnly ? eq(coverageRules.active, true) : undefined)
    .orderBy(asc(coverageRules.start)).all()
}
```

`server/services/changeLog.ts`:
```ts
import { and, eq } from 'drizzle-orm'
import { parseIsoDate } from '../../shared/domain/dates'
import type { IsoDate } from '../../shared/domain/types'
import type { ChangeField } from '../../shared/types/api'
import type { Db } from '../db/client'
import { changeLog, monthPlans } from '../db/schema'

export function isMonthReleased(db: Db, date: IsoDate): boolean {
  const { year, month } = parseIsoDate(date)
  const plan = db.select().from(monthPlans).where(and(eq(monthPlans.year, year), eq(monthPlans.month, month))).get()
  return Boolean(plan?.releasedAt)
}

export function logChange(db: Db, change: {
  date: IsoDate; employeeId: number | null; field: ChangeField
  before: string; after: string; actorId: number; now: string
}): void {
  if (change.before === change.after || !isMonthReleased(db, change.date)) return
  db.insert(changeLog).values({
    date: change.date, employeeId: change.employeeId, field: change.field,
    before: change.before, after: change.after, changedAt: change.now, changedBy: change.actorId,
  }).run()
}
```

`server/services/entries.ts`:
```ts
import { and, eq } from 'drizzle-orm'
import { cellKey } from '../../shared/domain/cells'
import { describeCell } from '../../shared/domain/describe'
import { validateSpan } from '../../shared/domain/time'
import type { IsoDate } from '../../shared/domain/types'
import type { ApplyMode, CellRef, EntryInput, NoteField, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { absenceCodes, dayNotes, employees, entries, shiftTemplates } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { logChange } from './changeLog'
import { loadEntries } from './queries'

type ResolvedEntry = Omit<typeof entries.$inferInsert, 'employeeId' | 'date' | 'updatedAt' | 'updatedBy' | 'closureId'>

const NO_TIMES = { start: null, end: null, breakStart: null, breakEnd: null }
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function resolveEntry(db: Db, input: EntryInput): ResolvedEntry {
  const note = input.note?.trim() || null

  if (input.kind === 'shift') {
    const template = db.select().from(shiftTemplates).where(eq(shiftTemplates.id, input.templateId ?? -1)).get()
    if (!template) throw new ServiceError(400, 'template_not_found')
    return {
      kind: 'shift', shiftTemplateId: template.id, absenceCodeId: null,
      start: template.start, end: template.end, breakStart: template.breakStart, breakEnd: template.breakEnd,
      countsAsStaff: template.countsAsStaff, note,
    }
  }

  const span = {
    start: input.start ?? null, end: input.end ?? null,
    breakStart: input.breakStart ?? null, breakEnd: input.breakEnd ?? null,
  }
  const hasTimes = span.start !== null && span.end !== null
  if (!hasTimes && (span.start !== null || span.end !== null)) throw new ServiceError(400, 'span_incomplete')
  if (hasTimes) {
    const error = validateSpan({ start: span.start!, end: span.end!, breakStart: span.breakStart, breakEnd: span.breakEnd })
    if (error) throw new ServiceError(400, `span_${error}`)
  }

  if (input.kind === 'special') {
    if (!hasTimes) throw new ServiceError(400, 'times_required')
    return { kind: 'special', shiftTemplateId: null, absenceCodeId: null, ...span, countsAsStaff: true, note }
  }

  const code = db.select().from(absenceCodes).where(eq(absenceCodes.id, input.codeId ?? -1)).get()
  if (!code) throw new ServiceError(400, 'code_not_found')
  if (code.requiresTimes && !hasTimes) throw new ServiceError(400, 'times_required')
  return {
    kind: 'code', shiftTemplateId: null, absenceCodeId: code.id,
    ...(hasTimes ? span : NO_TIMES), countsAsStaff: true, note,
  }
}

export function describeCellAt(db: Db, cell: CellRef): string {
  return describeCell(loadEntries(db, { employeeId: cell.employeeId, from: cell.date, to: cell.date }))
}

export function applyToCells(
  db: Db, actor: SessionUser, cells: CellRef[], mode: ApplyMode, input: EntryInput | null,
  options: { now?: Date; closureId?: number | null } = {},
): void {
  if (mode !== 'clear' && !input) throw new ServiceError(400, 'entry_required')
  const values = mode === 'clear' ? null : resolveEntry(db, input!)
  const now = (options.now ?? new Date()).toISOString()
  const employeeIds = new Set(db.select({ id: employees.id }).from(employees).all().map(row => row.id))
  const unique = [...new Map(cells.map(cell => [cellKey(cell.employeeId, cell.date), cell])).values()]

  db.transaction((tx) => {
    for (const cell of unique) {
      if (!employeeIds.has(cell.employeeId)) throw new ServiceError(400, 'employee_not_found')
      if (!ISO_DATE.test(cell.date)) throw new ServiceError(400, 'invalid_date')
      const before = describeCellAt(tx, cell)
      if (mode !== 'add') {
        tx.delete(entries).where(and(eq(entries.employeeId, cell.employeeId), eq(entries.date, cell.date))).run()
      }
      if (values) {
        tx.insert(entries).values({
          ...values, employeeId: cell.employeeId, date: cell.date,
          closureId: options.closureId ?? null, updatedAt: now, updatedBy: actor.id,
        }).run()
      }
      logChange(tx, {
        date: cell.date, employeeId: cell.employeeId, field: 'entry',
        before, after: describeCellAt(tx, cell), actorId: actor.id, now,
      })
    }
  })
}

export function deleteEntry(db: Db, actor: SessionUser, id: number, now: Date = new Date()): void {
  const entry = db.select().from(entries).where(eq(entries.id, id)).get()
  if (!entry) throw new ServiceError(404, 'entry_not_found')
  const cell = { employeeId: entry.employeeId, date: entry.date }
  db.transaction((tx) => {
    const before = describeCellAt(tx, cell)
    tx.delete(entries).where(eq(entries.id, id)).run()
    logChange(tx, {
      ...cell, field: 'entry', before, after: describeCellAt(tx, cell), actorId: actor.id, now: now.toISOString(),
    })
  })
}

export function setDayNote(
  db: Db, actor: SessionUser, date: IsoDate, field: NoteField, value: string, now: Date = new Date(),
): void {
  const text = value.trim()
  const values = field === 'info1' ? { info1: text } : { info2: text }
  db.transaction((tx) => {
    const existing = tx.select().from(dayNotes).where(eq(dayNotes.date, date)).get()
    const before = existing?.[field] ?? ''
    tx.insert(dayNotes).values({ date, ...values })
      .onConflictDoUpdate({ target: dayNotes.date, set: values }).run()
    logChange(tx, { date, employeeId: null, field, before, after: text, actorId: actor.id, now: now.toISOString() })
  })
}
```

`server/services/release.ts`:
```ts
import { and, eq } from 'drizzle-orm'
import type { SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { monthPlans } from '../db/schema'

export function releaseMonth(db: Db, actor: SessionUser, year: number, month: number, now: Date = new Date()): void {
  const releasedAt = now.toISOString()
  db.insert(monthPlans).values({ year, month, releasedAt, releasedBy: actor.id })
    .onConflictDoUpdate({ target: [monthPlans.year, monthPlans.month], set: { releasedAt, releasedBy: actor.id } })
    .run()
}

export function unreleaseMonth(db: Db, year: number, month: number): void {
  db.update(monthPlans).set({ releasedAt: null, releasedBy: null })
    .where(and(eq(monthPlans.year, year), eq(monthPlans.month, month))).run()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/services/entries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "feat: add entry editing with change log and month release"
```

---

### Task 11: Employees, hour balances and leave accounts

**Files:**
- Create: `server/services/employees.ts`, `server/services/balances.ts`, `server/services/leave.ts`
- Test: `tests/services/employees.test.ts`, `tests/services/balances.test.ts`

**Interfaces:**
- Consumes: `loadEmployees`, `loadEntries`, `EmployeeRecord`, `weeklyMinutesOn`, `isEmployedInRange`, `balanceUntil`, `leaveAccount`, `groupLeaveRanges`, `toIsoDate`, `daysInMonth`
- Produces:
  - `employees.ts`: `interface EmployeeInput { name; shortName; weeklyMinutes; validFrom }`, `interface EmployeeUpdate { name; shortName; leftOn }`, `listEmployees(db, today): EmployeeListItemDto[]`, `getEmployee(db, id, today): EmployeeDetailDto`, `createEmployee(db, input): number`, `updateEmployee(db, id, update): void`, `moveEmployee(db, id, direction: 'up' | 'down'): void`, `addHours(db, employeeId, { weeklyMinutes, validFrom }): void`, `deleteHours(db, id): void`, `addAdjustment(db, employeeId, { date, minutes, reason }): void`, `deleteAdjustment(db, id): void`, `setEntitlement(db, employeeId, year, { days, carriedOverDays }): void`
  - `balances.ts`: `computeBalances(db, staff: EmployeeRecord[], monthEnd, today): BalanceDto[]`, `getBalanceOverview(db, year, month, today): BalanceDto[]`
  - `leave.ts`: `getLeaveAccount(db, employeeId, year, today): LeaveAccountDto`, `getLeaveOverview(db, year, today): LeaveAccountDto[]`

- [ ] **Step 1: Write the failing tests**

`tests/services/employees.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import {
  addAdjustment, addHours, createEmployee, deleteHours, getEmployee, listEmployees,
  moveEmployee, setEntitlement, updateEmployee,
} from '../../server/services/employees'
import { createTestDb, errorCode } from '../helpers/fixtures'

const today = '2026-10-05'

describe('employees service', () => {
  let db: Db
  beforeEach(() => {
    db = createTestDb()
  })

  it('creates employees with their first weekly hours', () => {
    const id = createEmployee(db, { name: 'Anna', shortName: 'AN', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    expect(listEmployees(db, today)).toEqual([
      { id, name: 'Anna', shortName: 'AN', sortOrder: 1, leftOn: null, currentWeeklyMinutes: 2340 },
    ])
    expect(errorCode(() => createEmployee(db, { name: ' ', shortName: '', weeklyMinutes: 0, validFrom: '2026-01-01' }))).toBe('name_required')
  })
  it('keeps an hours history and never deletes the last period', () => {
    const id = createEmployee(db, { name: 'Anna', shortName: 'AN', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    addHours(db, id, { weeklyMinutes: 1800, validFrom: '2026-10-01' })
    addHours(db, id, { weeklyMinutes: 1950, validFrom: '2026-10-01' })
    const detail = getEmployee(db, id, today)
    expect(detail.hours.map(h => [h.validFrom, h.weeklyMinutes])).toEqual([['2026-01-01', 2340], ['2026-10-01', 1950]])
    expect(detail.currentWeeklyMinutes).toBe(1950)
    deleteHours(db, detail.hours[1]!.id)
    expect(errorCode(() => deleteHours(db, detail.hours[0]!.id))).toBe('last_hours')
  })
  it('reorders employees', () => {
    const anna = createEmployee(db, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    createEmployee(db, { name: 'Ben', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    moveEmployee(db, anna, 'down')
    expect(listEmployees(db, today).map(e => e.name)).toEqual(['Ben', 'Anna'])
    moveEmployee(db, anna, 'down')
    expect(listEmployees(db, today).map(e => e.name)).toEqual(['Ben', 'Anna'])
  })
  it('updates master data, adjustments and entitlements', () => {
    const id = createEmployee(db, { name: 'Anna', shortName: '', weeklyMinutes: 2340, validFrom: '2026-01-01' })
    updateEmployee(db, id, { name: 'Anna B.', shortName: 'AB', leftOn: '2026-12-31' })
    addAdjustment(db, id, { date: '2026-01-01', minutes: 750, reason: 'Übertrag' })
    setEntitlement(db, id, 2026, { days: 30, carriedOverDays: 2 })
    setEntitlement(db, id, 2026, { days: 30, carriedOverDays: 3 })
    const detail = getEmployee(db, id, today)
    expect(detail).toMatchObject({ name: 'Anna B.', shortName: 'AB', leftOn: '2026-12-31' })
    expect(detail.adjustments).toMatchObject([{ date: '2026-01-01', minutes: 750, reason: 'Übertrag' }])
    expect(detail.entitlements).toMatchObject([{ year: 2026, days: 30, carriedOverDays: 3 }])
    expect(errorCode(() => getEmployee(db, 999, today))).toBe('employee_not_found')
  })
})
```

`tests/services/balances.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { getBalanceOverview } from '../../server/services/balances'
import { addAdjustment, setEntitlement } from '../../server/services/employees'
import { applyToCells } from '../../server/services/entries'
import { getLeaveAccount, getLeaveOverview } from '../../server/services/leave'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, codeId, createTestDb, templateId } from '../helpers/fixtures'

const week = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']

describe('balances and leave', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna', { validFrom: '2026-10-05' })
  })

  it('computes the balance today and at month end', () => {
    applyToCells(db, admin, week.map(date => ({ employeeId: anna, date })), 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    addAdjustment(db, anna, { date: '2026-10-05', minutes: 750, reason: 'Übertrag' })
    expect(getBalanceOverview(db, 2026, 10, '2026-10-09')).toEqual([
      { employeeId: anna, name: 'Anna', weeklyMinutes: 2340, today: 735, monthEnd: 735 - 15 * 468 },
    ])
  })
  it('excludes employees who are not employed in the month', () => {
    addEmployee(db, 'Carl', { validFrom: '2026-11-01' })
    expect(getBalanceOverview(db, 2026, 10, '2026-10-09').map(b => b.name)).toEqual(['Anna'])
  })
  it('computes the leave account with ranges', () => {
    applyToCells(db, admin, week.map(date => ({ employeeId: anna, date })), 'replace', { kind: 'code', codeId: codeId(db, 'vacation') })
    setEntitlement(db, anna, 2026, { days: 30, carriedOverDays: 3 })
    expect(getLeaveAccount(db, anna, 2026, '2026-10-07')).toEqual({
      employeeId: anna, name: 'Anna', year: 2026,
      account: { entitlement: 30, carriedOver: 3, taken: 2, planned: 3, available: 28 },
      ranges: [{ from: '2026-10-05', to: '2026-10-09', days: 5 }],
    })
    expect(getLeaveOverview(db, 2026, '2026-10-07')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/services/employees.test.ts tests/services/balances.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

`server/services/employees.ts`:
```ts
import { and, asc, eq } from 'drizzle-orm'
import { weeklyMinutesOn } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type { EmployeeDetailDto, EmployeeListItemDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { balanceAdjustments, employeeHours, employees, leaveEntitlements } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { loadEmployees, type EmployeeRecord } from './queries'

export interface EmployeeInput {
  name: string
  shortName: string
  weeklyMinutes: number
  validFrom: IsoDate
}

export interface EmployeeUpdate {
  name: string
  shortName: string
  leftOn: IsoDate | null
}

function toListItem(employee: EmployeeRecord, today: IsoDate): EmployeeListItemDto {
  return {
    id: employee.id, name: employee.name, shortName: employee.shortName,
    sortOrder: employee.sortOrder, leftOn: employee.leftOn,
    currentWeeklyMinutes: weeklyMinutesOn(employee.info, today) ?? employee.info.hours[0]?.weeklyMinutes ?? null,
  }
}

function requireName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new ServiceError(400, 'name_required')
  return trimmed
}

function assertEmployee(db: Db, id: number): void {
  if (!db.select().from(employees).where(eq(employees.id, id)).get()) throw new ServiceError(404, 'employee_not_found')
}

export function listEmployees(db: Db, today: IsoDate): EmployeeListItemDto[] {
  return loadEmployees(db).map(employee => toListItem(employee, today))
}

export function getEmployee(db: Db, id: number, today: IsoDate): EmployeeDetailDto {
  const employee = loadEmployees(db).find(candidate => candidate.id === id)
  if (!employee) throw new ServiceError(404, 'employee_not_found')
  return {
    ...toListItem(employee, today),
    hours: db.select().from(employeeHours).where(eq(employeeHours.employeeId, id)).orderBy(asc(employeeHours.validFrom)).all()
      .map(({ id: hoursId, weeklyMinutes, validFrom }) => ({ id: hoursId, weeklyMinutes, validFrom })),
    adjustments: db.select().from(balanceAdjustments).where(eq(balanceAdjustments.employeeId, id)).orderBy(asc(balanceAdjustments.date)).all()
      .map(({ id: adjustmentId, date, minutes, reason }) => ({ id: adjustmentId, date, minutes, reason })),
    entitlements: db.select().from(leaveEntitlements).where(eq(leaveEntitlements.employeeId, id)).orderBy(asc(leaveEntitlements.year)).all()
      .map(({ id: entitlementId, year, days, carriedOverDays }) => ({ id: entitlementId, year, days, carriedOverDays })),
  }
}

export function createEmployee(db: Db, input: EmployeeInput): number {
  const name = requireName(input.name)
  return db.transaction((tx) => {
    const sortOrder = Math.max(0, ...tx.select().from(employees).all().map(e => e.sortOrder)) + 1
    const employee = tx.insert(employees).values({ name, shortName: input.shortName.trim(), sortOrder }).returning().get()
    tx.insert(employeeHours).values({ employeeId: employee.id, weeklyMinutes: input.weeklyMinutes, validFrom: input.validFrom }).run()
    return employee.id
  })
}

export function updateEmployee(db: Db, id: number, update: EmployeeUpdate): void {
  assertEmployee(db, id)
  db.update(employees)
    .set({ name: requireName(update.name), shortName: update.shortName.trim(), leftOn: update.leftOn })
    .where(eq(employees.id, id)).run()
}

export function moveEmployee(db: Db, id: number, direction: 'up' | 'down'): void {
  const ordered = loadEmployees(db)
  const index = ordered.findIndex(employee => employee.id === id)
  if (index === -1) throw new ServiceError(404, 'employee_not_found')
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= ordered.length) return
  ;[ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!]
  db.transaction((tx) => {
    ordered.forEach((employee, position) => {
      tx.update(employees).set({ sortOrder: position + 1 }).where(eq(employees.id, employee.id)).run()
    })
  })
}

export function addHours(db: Db, employeeId: number, period: { weeklyMinutes: number; validFrom: IsoDate }): void {
  assertEmployee(db, employeeId)
  db.insert(employeeHours).values({ employeeId, ...period })
    .onConflictDoUpdate({ target: [employeeHours.employeeId, employeeHours.validFrom], set: { weeklyMinutes: period.weeklyMinutes } })
    .run()
}

export function deleteHours(db: Db, id: number): void {
  const period = db.select().from(employeeHours).where(eq(employeeHours.id, id)).get()
  if (!period) throw new ServiceError(404, 'hours_not_found')
  const count = db.select().from(employeeHours).where(eq(employeeHours.employeeId, period.employeeId)).all().length
  if (count <= 1) throw new ServiceError(409, 'last_hours')
  db.delete(employeeHours).where(eq(employeeHours.id, id)).run()
}

export function addAdjustment(db: Db, employeeId: number, adjustment: { date: IsoDate; minutes: number; reason: string }): void {
  assertEmployee(db, employeeId)
  const reason = adjustment.reason.trim()
  if (!reason) throw new ServiceError(400, 'reason_required')
  db.insert(balanceAdjustments).values({ employeeId, date: adjustment.date, minutes: adjustment.minutes, reason }).run()
}

export function deleteAdjustment(db: Db, id: number): void {
  db.delete(balanceAdjustments).where(eq(balanceAdjustments.id, id)).run()
}

export function setEntitlement(
  db: Db, employeeId: number, year: number, value: { days: number; carriedOverDays: number },
): void {
  assertEmployee(db, employeeId)
  const existing = db.select().from(leaveEntitlements)
    .where(and(eq(leaveEntitlements.employeeId, employeeId), eq(leaveEntitlements.year, year))).get()
  if (existing) {
    db.update(leaveEntitlements).set(value).where(eq(leaveEntitlements.id, existing.id)).run()
  }
  else {
    db.insert(leaveEntitlements).values({ employeeId, year, ...value }).run()
  }
}
```

`server/services/balances.ts`:
```ts
import { balanceUntil } from '../../shared/domain/balance'
import { daysInMonth, toIsoDate } from '../../shared/domain/dates'
import { isEmployedInRange, weeklyMinutesOn } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type { BalanceDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { balanceAdjustments } from '../db/schema'
import { groupByEmployee, loadEmployees, loadEntries, type EmployeeRecord } from './queries'

export function computeBalances(db: Db, staff: EmployeeRecord[], monthEnd: IsoDate, today: IsoDate): BalanceDto[] {
  const byEmployee = groupByEmployee(loadEntries(db))
  const adjustments = db.select().from(balanceAdjustments).all()
  return staff.map((employee) => {
    const own = byEmployee.get(employee.id) ?? []
    const ownAdjustments = adjustments.filter(a => a.employeeId === employee.id)
    return {
      employeeId: employee.id,
      name: employee.name,
      weeklyMinutes: weeklyMinutesOn(employee.info, today) ?? weeklyMinutesOn(employee.info, monthEnd),
      today: balanceUntil(employee.info, own, ownAdjustments, today),
      monthEnd: balanceUntil(employee.info, own, ownAdjustments, monthEnd),
    }
  })
}

export function getBalanceOverview(db: Db, year: number, month: number, today: IsoDate): BalanceDto[] {
  const monthStart = toIsoDate(year, month, 1)
  const monthEnd = toIsoDate(year, month, daysInMonth(year, month))
  const staff = loadEmployees(db).filter(employee => isEmployedInRange(employee.info, monthStart, monthEnd))
  return computeBalances(db, staff, monthEnd, today)
}
```

`server/services/leave.ts`:
```ts
import { and, eq } from 'drizzle-orm'
import { groupLeaveRanges, leaveAccount } from '../../shared/domain/leave'
import { isEmployedInRange } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type { LeaveAccountDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, leaveEntitlements } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { loadEmployees, loadEntries } from './queries'

export function getLeaveAccount(db: Db, employeeId: number, year: number, today: IsoDate): LeaveAccountDto {
  const employee = db.select().from(employees).where(eq(employees.id, employeeId)).get()
  if (!employee) throw new ServiceError(404, 'employee_not_found')
  const vacationDates = loadEntries(db, { employeeId, from: `${year}-01-01`, to: `${year}-12-31`, codeKey: 'vacation' })
    .map(entry => entry.date)
  const entitlement = db.select().from(leaveEntitlements)
    .where(and(eq(leaveEntitlements.employeeId, employeeId), eq(leaveEntitlements.year, year))).get()
  return {
    employeeId, name: employee.name, year,
    account: leaveAccount(entitlement ?? null, vacationDates, year, today),
    ranges: groupLeaveRanges(vacationDates),
  }
}

export function getLeaveOverview(db: Db, year: number, today: IsoDate): LeaveAccountDto[] {
  return loadEmployees(db)
    .filter(employee => isEmployedInRange(employee.info, `${year}-01-01`, `${year}-12-31`))
    .map(employee => getLeaveAccount(db, employee.id, year, today))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/services`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "feat: add employee management, hour balances and leave accounts"
```

---

### Task 12: Month plan and personal plan (with role filtering)

**Files:**
- Create: `server/services/plan.ts`
- Test: `tests/services/plan.test.ts`

**Interfaces:**
- Consumes: queries (Task 10), `computeBalances` (Task 11), `dayWarnings`, `computeRange`, `summarize`, date helpers, `holidayOn`, `cellKey`, `noteKey`
- Produces: `getMonthPlan(db, viewer: SessionUser, year, month, today): MonthPlanDto` (403 `month_not_released` for observers on drafts; `admin` is `null` for observers), `getMyPlan(db, viewer, year, month, today): MyPlanDto` (403 `no_employee` without linked employee)

- [ ] **Step 1: Write the failing test**

`tests/services/plan.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { applyToCells } from '../../server/services/entries'
import { getMonthPlan, getMyPlan } from '../../server/services/plan'
import { releaseMonth } from '../../server/services/release'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const today = '2026-10-01'

describe('month plan', () => {
  let db: Db
  let admin: SessionUser
  let observer: SessionUser
  let anna: number
  let ben: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
    ben = addEmployee(db, 'Ben')
    addEmployee(db, 'Carl', { validFrom: '2026-11-01' })
    observer = addUser(db, 'anna', 'observer', anna)
  })
  const shift = (employeeId: number, date: string, label = 'M', now?: Date) =>
    applyToCells(db, admin, [{ employeeId, date }], 'replace', { kind: 'shift', templateId: templateId(db, label) }, { now })

  it('gives admins the full draft plan with warnings, weeks and balances', () => {
    const plan = getMonthPlan(db, admin, 2026, 10, today)
    expect(plan.employees.map(e => e.name)).toEqual(['Anna', 'Ben'])
    expect(plan.days).toHaveLength(31)
    expect(plan.days[2]).toMatchObject({ date: '2026-10-03', holidayKey: 'german_unity_day', isWeekend: true })
    expect(plan.templates).toHaveLength(5)
    expect(plan.codes).toHaveLength(9)
    expect(plan.admin!.weeks.map(w => w.weekStart)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'])
    expect(plan.admin!.weeks[0]!.weekNumber).toBe(40)
    expect(plan.admin!.warnings.filter(w => w.date === '2026-10-05')).toHaveLength(5)
    expect(plan.admin!.balances.map(b => b.name)).toEqual(['Anna', 'Ben'])
  })
  it('sums weeks across the year boundary', () => {
    for (const date of ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31']) shift(anna, date)
    const lastWeek = getMonthPlan(db, admin, 2026, 12, today).admin!.weeks.at(-1)!
    expect(lastWeek).toMatchObject({ weekStart: '2026-12-28', weekEnd: '2027-01-03', weekNumber: 53 })
    expect(lastWeek.totals.find(t => t.employeeId === anna)).toEqual({ employeeId: anna, target: 1872, credit: 1860, delta: -12 })
  })
  it('hides drafts from observers', () => {
    expect(errorCode(() => getMonthPlan(db, observer, 2026, 10, today))).toBe('month_not_released')
    expect(errorCode(() => getMyPlan(db, observer, 2026, 10, today))).toBe('month_not_released')
  })
  it('gives observers released plans without hour data or warnings', () => {
    shift(anna, '2026-10-05')
    releaseMonth(db, admin, 2026, 10)
    const plan = getMonthPlan(db, observer, 2026, 10, today)
    expect(plan.admin).toBeNull()
    expect(plan.entries).toHaveLength(1)
  })
  it('tracks changes since the last release', () => {
    shift(anna, '2026-10-06', 'F2', new Date('2026-09-20T10:00:00Z'))
    releaseMonth(db, admin, 2026, 10, new Date('2026-09-25T10:00:00Z'))
    shift(anna, '2026-10-06', 'S', new Date('2026-10-01T06:00:00Z'))
    let plan = getMonthPlan(db, observer, 2026, 10, today)
    expect(plan.release).toMatchObject({ releasedBy: 'leitung', changeCount: 1 })
    expect(plan.changes[`${anna}|2026-10-06`]).toEqual([expect.objectContaining({ before: '7:30–15:45', after: '8:45–17:00', changedBy: 'leitung' })])
    releaseMonth(db, admin, 2026, 10, new Date('2026-10-01T07:00:00Z'))
    plan = getMonthPlan(db, observer, 2026, 10, today)
    expect(plan.release.changeCount).toBe(0)
    expect(plan.changes).toEqual({})
  })
  it('returns only the own entries in the personal plan', () => {
    shift(anna, '2026-10-05')
    shift(ben, '2026-10-05', 'S')
    releaseMonth(db, admin, 2026, 10)
    const mine = getMyPlan(db, observer, 2026, 10, today)
    expect(mine.employee.name).toBe('Anna')
    expect(mine.days.flatMap(d => d.entries).map(e => e.employeeId)).toEqual([anna])
    expect(errorCode(() => getMyPlan(db, { ...observer, employeeId: null }, 2026, 10, today))).toBe('no_employee')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/plan.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`server/services/plan.ts`:
```ts
import { and, asc, eq, gt, gte, lte } from 'drizzle-orm'
import { computeRange, summarize } from '../../shared/domain/balance'
import { cellKey, noteKey } from '../../shared/domain/cells'
import { addDays, daysInMonth, isoWeekNumber, isWeekend, monthDates, toIsoDate, weekday, weekStart } from '../../shared/domain/dates'
import { holidayOn } from '../../shared/domain/holidays'
import { isEmployedInRange } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import { dayWarnings } from '../../shared/domain/warnings'
import type {
  ChangeDto, ClosureDto, DayRowDto, MonthPlanAdminDto, MonthPlanDto, MyPlanDto, SessionUser, WeekSummaryDto,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { changeLog, dayNotes, employees, monthPlans, users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { computeBalances } from './balances'
import {
  closureOn, groupByEmployee, loadClosures, loadCodes, loadCoverageRules, loadEmployees, loadEntries,
  loadTemplates, type EmployeeRecord,
} from './queries'

function monthBounds(year: number, month: number): { monthStart: IsoDate; monthEnd: IsoDate } {
  return { monthStart: toIsoDate(year, month, 1), monthEnd: toIsoDate(year, month, daysInMonth(year, month)) }
}

function loadChanges(db: Db, from: IsoDate, to: IsoDate, releasedAt: string | null) {
  const changes: Record<string, ChangeDto[]> = {}
  if (!releasedAt) return { changes, changeCount: 0 }
  const rows = db.select({ log: changeLog, username: users.username })
    .from(changeLog)
    .leftJoin(users, eq(changeLog.changedBy, users.id))
    .where(and(gte(changeLog.date, from), lte(changeLog.date, to), gt(changeLog.changedAt, releasedAt)))
    .orderBy(asc(changeLog.changedAt))
    .all()
  for (const { log, username } of rows) {
    const key = log.field === 'entry' ? cellKey(log.employeeId!, log.date) : noteKey(log.field, log.date)
    ;(changes[key] ??= []).push({
      field: log.field, employeeId: log.employeeId, date: log.date,
      before: log.before, after: log.after, changedAt: log.changedAt, changedBy: username ?? '',
    })
  }
  return { changes, changeCount: Object.keys(changes).length }
}

function buildAdminData(
  db: Db, staff: EmployeeRecord[], closures: ClosureDto[], year: number, month: number, today: IsoDate,
): MonthPlanAdminDto {
  const { monthStart, monthEnd } = monthBounds(year, month)
  const rangeStart = weekStart(monthStart)
  const rangeEnd = addDays(weekStart(monthEnd), 6)
  const byEmployee = groupByEmployee(loadEntries(db, { from: rangeStart, to: rangeEnd }))
  const rules = loadCoverageRules(db)

  const warnings = monthDates(year, month).flatMap(date => dayWarnings(
    date,
    staff.map(employee => ({
      employeeId: employee.id,
      info: employee.info,
      entries: (byEmployee.get(employee.id) ?? []).filter(entry => entry.date === date),
    })),
    rules,
    closureOn(closures, date) !== null,
  ))

  const weeks: WeekSummaryDto[] = []
  for (let start = rangeStart; start <= monthEnd; start = addDays(start, 7)) {
    const end = addDays(start, 6)
    weeks.push({
      weekStart: start,
      weekEnd: end,
      weekNumber: isoWeekNumber(start),
      totals: staff.map(employee => ({
        employeeId: employee.id,
        ...summarize(computeRange(employee.info, byEmployee.get(employee.id) ?? [], start, end)),
      })),
    })
  }

  return { warnings, weeks, balances: computeBalances(db, staff, monthEnd, today) }
}

export function getMonthPlan(db: Db, viewer: SessionUser, year: number, month: number, today: IsoDate): MonthPlanDto {
  const { monthStart, monthEnd } = monthBounds(year, month)
  const plan = db.select().from(monthPlans).where(and(eq(monthPlans.year, year), eq(monthPlans.month, month))).get()
  const releasedAt = plan?.releasedAt ?? null
  const isAdmin = viewer.role === 'admin'
  if (!isAdmin && !releasedAt) throw new ServiceError(403, 'month_not_released')

  const staff = loadEmployees(db).filter(employee => isEmployedInRange(employee.info, monthStart, monthEnd))
  const staffIds = new Set(staff.map(employee => employee.id))
  const closures = loadClosures(db)
  const notes = new Map(
    db.select().from(dayNotes).where(and(gte(dayNotes.date, monthStart), lte(dayNotes.date, monthEnd))).all()
      .map(note => [note.date, note]),
  )

  const days: DayRowDto[] = monthDates(year, month).map(date => ({
    date,
    weekday: weekday(date),
    isWeekend: isWeekend(date),
    holidayKey: holidayOn(date),
    closureLabel: closureOn(closures, date)?.label ?? null,
    info1: notes.get(date)?.info1 ?? '',
    info2: notes.get(date)?.info2 ?? '',
  }))

  const { changes, changeCount } = loadChanges(db, monthStart, monthEnd, releasedAt)
  const releasedBy = releasedAt && plan?.releasedBy
    ? db.select().from(users).where(eq(users.id, plan.releasedBy)).get()?.username ?? null
    : null

  return {
    year,
    month,
    release: { releasedAt, releasedBy, changeCount },
    days,
    employees: staff.map(({ id, name, shortName }) => ({ id, name, shortName })),
    entries: loadEntries(db, { from: monthStart, to: monthEnd }).filter(entry => staffIds.has(entry.employeeId)),
    changes,
    templates: loadTemplates(db),
    codes: loadCodes(db),
    admin: isAdmin ? buildAdminData(db, staff, closures, year, month, today) : null,
  }
}

export function getMyPlan(db: Db, viewer: SessionUser, year: number, month: number, today: IsoDate): MyPlanDto {
  if (viewer.employeeId === null) throw new ServiceError(403, 'no_employee')
  const employee = db.select().from(employees).where(eq(employees.id, viewer.employeeId)).get()
  if (!employee) throw new ServiceError(403, 'no_employee')
  const plan = getMonthPlan(db, { ...viewer, role: 'observer' }, year, month, today)
  const days = plan.days.map(day => ({
    ...day,
    entries: plan.entries.filter(entry => entry.employeeId === employee.id && entry.date === day.date),
    changes: plan.changes[cellKey(employee.id, day.date)] ?? [],
  }))
  return {
    year,
    month,
    employee: { id: employee.id, name: employee.name, shortName: employee.shortName },
    release: { ...plan.release, changeCount: days.filter(day => day.changes.length > 0).length },
    days,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/services/plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "feat: add month plan and personal plan with observer filtering"
```

---

### Task 13: Closures

**Files:**
- Create: `server/services/closures.ts`
- Test: `tests/services/closures.test.ts`

**Interfaces:**
- Consumes: `applyToCells`, `describeCellAt` (Task 10), `logChange`, `loadEmployees`, `loadEntries`, `loadClosures`, `dateRange`, `daysBetween`, `isWeekend`, `isHoliday`, `isEmployedOn`
- Produces: `interface ClosureInput { startDate; endDate; label; mode: ClosureMode }`, `listClosures(db): ClosureDto[]`, `createClosure(db, actor, input, now?): ClosureDto`, `deleteClosure(db, actor, id, now?): void`

- [ ] **Step 1: Write the failing test**

`tests/services/closures.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { createClosure, deleteClosure, listClosures } from '../../server/services/closures'
import { applyToCells } from '../../server/services/entries'
import { getLeaveAccount } from '../../server/services/leave'
import { getMonthPlan } from '../../server/services/plan'
import { loadEntries } from '../../server/services/queries'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const summer = { startDate: '2026-08-07', endDate: '2026-08-17', label: 'Sommerschließzeit', mode: 'vacation' as const }
const inRange = (db: Db) => loadEntries(db, { from: summer.startDate, to: summer.endDate })

describe('closures service', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  let ben: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
    ben = addEmployee(db, 'Ben')
  })

  it('writes the chosen code for every employee on every working day', () => {
    applyToCells(db, admin, [{ employeeId: anna, date: '2026-08-10' }], 'replace', { kind: 'shift', templateId: templateId(db, 'M') })
    const closure = createClosure(db, admin, summer)
    const rows = inRange(db)
    expect(rows).toHaveLength(14)
    expect(rows.every(entry => entry.codeKey === 'vacation')).toBe(true)
    expect(rows.some(entry => entry.date === '2026-08-08')).toBe(false)
    expect(listClosures(db)).toEqual([closure])
    expect(getLeaveAccount(db, anna, 2026, '2026-08-01').account.planned).toBe(7)
  })
  it('uses the closure-day code in closure-day mode', () => {
    createClosure(db, admin, { ...summer, mode: 'closure_day' })
    expect(new Set(inRange(db).map(entry => entry.codeKey))).toEqual(new Set(['closure_day']))
  })
  it('keeps admin overrides when the closure is deleted', () => {
    const closure = createClosure(db, admin, summer)
    applyToCells(db, admin, [{ employeeId: anna, date: '2026-08-11' }], 'replace', { kind: 'shift', templateId: templateId(db, 'F2') })
    deleteClosure(db, admin, closure.id)
    expect(inRange(db).map(entry => [entry.employeeId, entry.date, entry.label])).toEqual([[anna, '2026-08-11', '7:30–15:45']])
    expect(listClosures(db)).toEqual([])
  })
  it('suppresses warnings on closure days', () => {
    createClosure(db, admin, summer)
    applyToCells(db, admin, [{ employeeId: ben, date: '2026-08-12' }], 'clear', null)
    const warnings = getMonthPlan(db, admin, 2026, 8, '2026-08-01').admin!.warnings
    expect(warnings.filter(w => w.date === '2026-08-12')).toEqual([])
  })
  it('validates the range and label', () => {
    expect(errorCode(() => createClosure(db, admin, { ...summer, endDate: '2026-08-01' }))).toBe('invalid_range')
    expect(errorCode(() => createClosure(db, admin, { ...summer, label: ' ' }))).toBe('label_required')
    expect(errorCode(() => deleteClosure(db, admin, 999))).toBe('closure_not_found')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/closures.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`server/services/closures.ts`:
```ts
import { eq } from 'drizzle-orm'
import { dateRange, daysBetween, isWeekend } from '../../shared/domain/dates'
import { isHoliday } from '../../shared/domain/holidays'
import { isEmployedOn } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type { ClosureDto, ClosureMode, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { absenceCodes, closures, entries } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { logChange } from './changeLog'
import { applyToCells, describeCellAt } from './entries'
import { loadClosures, loadEmployees, loadEntries } from './queries'

export interface ClosureInput {
  startDate: IsoDate
  endDate: IsoDate
  label: string
  mode: ClosureMode
}

export function listClosures(db: Db): ClosureDto[] {
  return loadClosures(db)
}

export function createClosure(db: Db, actor: SessionUser, input: ClosureInput, now: Date = new Date()): ClosureDto {
  const label = input.label.trim()
  if (!label) throw new ServiceError(400, 'label_required')
  const length = daysBetween(input.startDate, input.endDate)
  if (length < 0 || length > 366) throw new ServiceError(400, 'invalid_range')
  const code = db.select().from(absenceCodes)
    .where(eq(absenceCodes.key, input.mode === 'vacation' ? 'vacation' : 'closure_day')).get()
  if (!code) throw new ServiceError(500, 'code_not_found')

  return db.transaction((tx) => {
    const closure = tx.insert(closures)
      .values({ startDate: input.startDate, endDate: input.endDate, label, mode: input.mode })
      .returning().get()
    const staff = loadEmployees(tx)
    const cells = dateRange(input.startDate, input.endDate)
      .filter(date => !isWeekend(date) && !isHoliday(date))
      .flatMap(date => staff.filter(employee => isEmployedOn(employee.info, date)).map(employee => ({ employeeId: employee.id, date })))
    applyToCells(tx, actor, cells, 'replace', { kind: 'code', codeId: code.id }, { now, closureId: closure.id })
    return closure
  })
}

export function deleteClosure(db: Db, actor: SessionUser, id: number, now: Date = new Date()): void {
  if (!db.select().from(closures).where(eq(closures.id, id)).get()) throw new ServiceError(404, 'closure_not_found')
  db.transaction((tx) => {
    const cells = loadEntries(tx, { closureId: id }).map(entry => ({ employeeId: entry.employeeId, date: entry.date }))
    const before = cells.map(cell => describeCellAt(tx, cell))
    tx.delete(entries).where(eq(entries.closureId, id)).run()
    cells.forEach((cell, index) => logChange(tx, {
      ...cell, field: 'entry', before: before[index]!, after: describeCellAt(tx, cell),
      actorId: actor.id, now: now.toISOString(),
    }))
    tx.delete(closures).where(eq(closures.id, id)).run()
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/services/closures.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "feat: add closures that fill and clean up plan entries"
```

---

### Task 14: Settings (templates, codes, coverage rules)

**Files:**
- Create: `server/services/settings.ts`
- Test: `tests/services/settings.test.ts`

**Interfaces:**
- Consumes: `loadTemplates`, `loadCodes`, `loadCoverageRules`, `validateSpan`
- Produces: `interface TemplateInput { shortLabel; label; start; end; breakStart; breakEnd; countsAsStaff; sortOrder }`, `interface CodeUpdate { label; color: ColorKey; creditMode: CreditMode }`, `interface CoverageRuleInput { label; start; end; minCount; active }`, `getSettings(db): SettingsDto`, `createTemplate(db, input): TemplateDto`, `updateTemplate(db, id, input): TemplateDto`, `deleteTemplate(db, id): void`, `updateCode(db, id, update): CodeDto`, `createCoverageRule(db, input): CoverageRuleDto`, `updateCoverageRule(db, id, input): CoverageRuleDto`, `deleteCoverageRule(db, id): void`

- [ ] **Step 1: Write the failing test**

`tests/services/settings.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { applyToCells } from '../../server/services/entries'
import { loadEntries } from '../../server/services/queries'
import {
  createCoverageRule, createTemplate, deleteCoverageRule, deleteTemplate, getSettings,
  updateCode, updateCoverageRule, updateTemplate,
} from '../../server/services/settings'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const date = '2026-10-05'

describe('settings service', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
  })

  it('returns the seeded settings', () => {
    const settings = getSettings(db)
    expect(settings.templates.map(t => t.shortLabel)).toEqual(['F1', 'F2', 'M', 'S', 'HK'])
    expect(settings.codes.map(c => c.key)).toEqual(['vacation', 'sick', 'training', 'school', 'other', 'prep_time', 'office', 'holiday', 'closure_day'])
    expect(settings.coverageRules).toHaveLength(3)
  })
  it('does not change existing entries when a template changes or is deleted', () => {
    const m = templateId(db, 'M')
    applyToCells(db, admin, [{ employeeId: anna, date }], 'replace', { kind: 'shift', templateId: m })
    updateTemplate(db, m, { shortLabel: 'M', label: 'Mitteldienst', start: 480, end: 975, breakStart: 700, breakEnd: 730, countsAsStaff: true, sortOrder: 3 })
    expect(loadEntries(db)[0]).toMatchObject({ start: 465, end: 960 })
    deleteTemplate(db, m)
    expect(loadEntries(db)[0]).toMatchObject({ start: 465, end: 960, templateId: null })
  })
  it('validates templates', () => {
    const input = { shortLabel: 'X', label: 'Test', start: 465, end: 960, breakStart: 450, breakEnd: 480, countsAsStaff: true, sortOrder: 9 }
    expect(errorCode(() => createTemplate(db, input))).toBe('span_break_outside')
    expect(errorCode(() => createTemplate(db, { ...input, label: ' ', breakStart: null, breakEnd: null }))).toBe('label_required')
    expect(createTemplate(db, { ...input, breakStart: null, breakEnd: null })).toMatchObject({ label: 'Test' })
  })
  it('updates codes and applies the new credit mode to existing entries', () => {
    const sick = codeId(db, 'sick')
    applyToCells(db, admin, [{ employeeId: anna, date }], 'replace', { kind: 'code', codeId: sick })
    expect(updateCode(db, sick, { label: 'Krank', color: 'red', creditMode: 'none' })).toMatchObject({ color: 'red', creditMode: 'none' })
    expect(loadEntries(db)[0]).toMatchObject({ creditMode: 'none', color: 'red' })
    expect(errorCode(() => updateCode(db, 999, { label: 'X', color: 'red', creditMode: 'none' }))).toBe('code_not_found')
  })
  it('manages coverage rules', () => {
    const input = { label: 'Mitteldienst', start: 465, end: 960, minCount: 1, active: true }
    const rule = createCoverageRule(db, input)
    expect(updateCoverageRule(db, rule.id, { ...input, active: false }).active).toBe(false)
    deleteCoverageRule(db, rule.id)
    expect(getSettings(db).coverageRules).toHaveLength(3)
    expect(errorCode(() => createCoverageRule(db, { label: 'X', start: 463, end: null, minCount: 1, active: true }))).toBe('invalid_rule')
    expect(errorCode(() => createCoverageRule(db, { label: 'X', start: 600, end: 540, minCount: 1, active: true }))).toBe('invalid_rule')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/settings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`server/services/settings.ts`:
```ts
import { eq } from 'drizzle-orm'
import { validateSpan } from '../../shared/domain/time'
import type { CreditMode, Minutes } from '../../shared/domain/types'
import type { CodeDto, ColorKey, CoverageRuleDto, SettingsDto, TemplateDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { absenceCodes, coverageRules, shiftTemplates } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { loadCodes, loadCoverageRules, loadTemplates } from './queries'

export interface TemplateInput {
  shortLabel: string
  label: string
  start: Minutes
  end: Minutes
  breakStart: Minutes | null
  breakEnd: Minutes | null
  countsAsStaff: boolean
  sortOrder: number
}

export interface CodeUpdate {
  label: string
  color: ColorKey
  creditMode: CreditMode
}

export interface CoverageRuleInput {
  label: string
  start: Minutes
  end: Minutes | null
  minCount: number
  active: boolean
}

function requireLabel(label: string): string {
  const trimmed = label.trim()
  if (!trimmed) throw new ServiceError(400, 'label_required')
  return trimmed
}

function normalizeTemplate(input: TemplateInput) {
  const label = requireLabel(input.label)
  const error = validateSpan(input)
  if (error) throw new ServiceError(400, `span_${error}`)
  return { ...input, label, shortLabel: input.shortLabel.trim() }
}

function normalizeRule(input: CoverageRuleInput) {
  const label = requireLabel(input.label)
  const invalid = input.start % 5 !== 0 || input.minCount < 1
    || (input.end !== null && (input.end % 5 !== 0 || input.end <= input.start))
  if (invalid) throw new ServiceError(400, 'invalid_rule')
  return { ...input, label }
}

export function getSettings(db: Db): SettingsDto {
  return { templates: loadTemplates(db), codes: loadCodes(db), coverageRules: loadCoverageRules(db, false) }
}

export function createTemplate(db: Db, input: TemplateInput): TemplateDto {
  return db.insert(shiftTemplates).values(normalizeTemplate(input)).returning().get()
}

export function updateTemplate(db: Db, id: number, input: TemplateInput): TemplateDto {
  const row = db.update(shiftTemplates).set(normalizeTemplate(input)).where(eq(shiftTemplates.id, id)).returning().get()
  if (!row) throw new ServiceError(404, 'template_not_found')
  return row
}

export function deleteTemplate(db: Db, id: number): void {
  db.delete(shiftTemplates).where(eq(shiftTemplates.id, id)).run()
}

export function updateCode(db: Db, id: number, update: CodeUpdate): CodeDto {
  const row = db.update(absenceCodes)
    .set({ label: requireLabel(update.label), color: update.color, creditMode: update.creditMode })
    .where(eq(absenceCodes.id, id)).returning().get()
  if (!row) throw new ServiceError(404, 'code_not_found')
  return loadCodes(db).find(code => code.id === id)!
}

export function createCoverageRule(db: Db, input: CoverageRuleInput): CoverageRuleDto {
  return db.insert(coverageRules).values(normalizeRule(input)).returning().get()
}

export function updateCoverageRule(db: Db, id: number, input: CoverageRuleInput): CoverageRuleDto {
  const row = db.update(coverageRules).set(normalizeRule(input)).where(eq(coverageRules.id, id)).returning().get()
  if (!row) throw new ServiceError(404, 'rule_not_found')
  return row
}

export function deleteCoverageRule(db: Db, id: number): void {
  db.delete(coverageRules).where(eq(coverageRules.id, id)).run()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/services/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "feat: add settings for shift templates, codes and coverage rules"
```

---

### Task 15: REST API routes

**Files:**
- Modify: `server/schemas.ts` (append request schemas)
- Create: all route files listed in Step 2

**Interfaces:**
- Consumes: every service function from Tasks 8–14, `requireUser`, `requireAdmin`, `defineServiceHandler`, `useDb`, `todayIso`
- Produces (all JSON; errors carry `data.code`):

| Method | Path | Role | Body / query | Service |
|---|---|---|---|---|
| GET | `/api/plan/:year/:month` | any | – | `getMonthPlan` |
| POST / DELETE | `/api/plan/:year/:month/release` | admin | – | `releaseMonth` / `unreleaseMonth` |
| GET | `/api/my/plan/:year/:month` | any | – | `getMyPlan` |
| GET | `/api/my/leave` | any | `?year` | `getLeaveAccount` (own employee) |
| POST | `/api/entries` | admin | `{ cells, mode, entry }` | `applyToCells` |
| DELETE | `/api/entries/:id` | admin | – | `deleteEntry` |
| PUT | `/api/day-notes/:date` | admin | `{ field, value }` | `setDayNote` |
| GET / POST | `/api/employees` | admin | `EmployeeInput` | `listEmployees` / `createEmployee` |
| GET / PUT | `/api/employees/:id` | admin | `EmployeeUpdate` | `getEmployee` / `updateEmployee` |
| POST | `/api/employees/:id/move` | admin | `{ direction }` | `moveEmployee` |
| POST | `/api/employees/:id/hours` | admin | `{ weeklyMinutes, validFrom }` | `addHours` |
| POST | `/api/employees/:id/adjustments` | admin | `{ date, minutes, reason }` | `addAdjustment` |
| PUT | `/api/employees/:id/leave/:year` | admin | `{ days, carriedOverDays }` | `setEntitlement` |
| DELETE | `/api/employee-hours/:id` | admin | – | `deleteHours` |
| DELETE | `/api/balance-adjustments/:id` | admin | – | `deleteAdjustment` |
| GET | `/api/balances` | admin | `?year&month` | `getBalanceOverview` |
| GET | `/api/leave` | admin | `?year` | `getLeaveOverview` |
| GET / POST | `/api/closures` | admin | `ClosureInput` | `listClosures` / `createClosure` |
| DELETE | `/api/closures/:id` | admin | – | `deleteClosure` |
| GET | `/api/settings` | admin | – | `getSettings` |
| POST | `/api/shift-templates` | admin | `TemplateInput` | `createTemplate` |
| PUT / DELETE | `/api/shift-templates/:id` | admin | `TemplateInput` | `updateTemplate` / `deleteTemplate` |
| PUT | `/api/absence-codes/:id` | admin | `CodeUpdate` | `updateCode` |
| POST | `/api/coverage-rules` | admin | `CoverageRuleInput` | `createCoverageRule` |
| PUT / DELETE | `/api/coverage-rules/:id` | admin | `CoverageRuleInput` | `updateCoverageRule` / `deleteCoverageRule` |
| GET / POST | `/api/users` | admin | `UserInput` | `listUsers` / `createUser` |
| PUT | `/api/users/:id` | admin | `UserUpdate` | `updateUser` |
| POST | `/api/users/:id/reset-password` | admin | `{ password }` | `resetPassword` |

- [ ] **Step 1: Append the request schemas**

Append to `server/schemas.ts`:
```ts
import { COLOR_KEYS } from '../shared/types/api'

const nullableMinutes = minutes.nullable().optional()
const label = z.string().max(100)

export const idParams = z.object({ id: z.coerce.number().int().positive() })
export const dateParams = z.object({ date: isoDate })
export const monthParams = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
})
export const yearQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100) })
export const employeeYearParams = idParams.extend({ year: z.coerce.number().int().min(2000).max(2100) })

export const entryInputSchema = z.object({
  kind: z.enum(['shift', 'special', 'code']),
  templateId: z.number().int().nullable().optional(),
  codeId: z.number().int().nullable().optional(),
  start: nullableMinutes,
  end: nullableMinutes,
  breakStart: nullableMinutes,
  breakEnd: nullableMinutes,
  note: z.string().max(200).nullable().optional(),
})
export const applyEntriesSchema = z.object({
  cells: z.array(z.object({ employeeId: z.number().int(), date: isoDate })).min(1).max(1000),
  mode: z.enum(['replace', 'add', 'clear']),
  entry: entryInputSchema.nullable(),
})
export const dayNoteSchema = z.object({ field: z.enum(['info1', 'info2']), value: z.string().max(200) })

const weeklyMinutes = z.number().int().min(0).max(80 * 60)
export const employeeCreateSchema = z.object({ name: label, shortName: z.string().max(10), weeklyMinutes, validFrom: isoDate })
export const employeeUpdateSchema = z.object({ name: label, shortName: z.string().max(10), leftOn: isoDate.nullable() })
export const moveSchema = z.object({ direction: z.enum(['up', 'down']) })
export const hoursSchema = z.object({ weeklyMinutes, validFrom: isoDate })
export const adjustmentSchema = z.object({ date: isoDate, minutes: z.number().int().min(-200_000).max(200_000), reason: z.string().max(200) })
export const entitlementSchema = z.object({ days: z.number().min(0).max(100), carriedOverDays: z.number().min(0).max(100) })

export const closureSchema = z.object({ startDate: isoDate, endDate: isoDate, label, mode: z.enum(['vacation', 'closure_day']) })

export const templateSchema = z.object({
  shortLabel: z.string().max(10), label, start: minutes, end: minutes,
  breakStart: minutes.nullable(), breakEnd: minutes.nullable(), countsAsStaff: z.boolean(), sortOrder: z.number().int(),
})
export const codeUpdateSchema = z.object({ label, color: z.enum(COLOR_KEYS), creditMode: z.enum(['daily_target', 'timed', 'none']) })
export const coverageRuleSchema = z.object({
  label, start: minutes, end: minutes.nullable(), minCount: z.number().int().min(1).max(20), active: z.boolean(),
})

export const userCreateSchema = z.object({
  username: z.string().max(50), password: z.string().max(200),
  role: z.enum(['admin', 'observer']), employeeId: z.number().int().nullable(),
})
export const userUpdateSchema = z.object({
  role: z.enum(['admin', 'observer']), employeeId: z.number().int().nullable(), active: z.boolean(),
})
export const passwordResetSchema = z.object({ password: z.string().max(200) })
```
(Move the new `import` line to the top of the file next to `import { z } from 'zod'`.)

- [ ] **Step 2: Create the route handlers**

`server/api/plan/[year]/[month].get.ts`:
```ts
import { todayIso } from '../../../../shared/domain/dates'
import { monthParams } from '../../../schemas'
import { getMonthPlan } from '../../../services/plan'

export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const { year, month } = await getValidatedRouterParams(event, monthParams.parse)
  return getMonthPlan(useDb(), user, year, month, todayIso())
})
```

`server/api/plan/[year]/[month]/release.post.ts`:
```ts
import { monthParams } from '../../../../schemas'
import { releaseMonth } from '../../../../services/release'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { year, month } = await getValidatedRouterParams(event, monthParams.parse)
  releaseMonth(useDb(), admin, year, month)
  return { ok: true }
})
```

`server/api/plan/[year]/[month]/release.delete.ts`:
```ts
import { monthParams } from '../../../../schemas'
import { unreleaseMonth } from '../../../../services/release'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { year, month } = await getValidatedRouterParams(event, monthParams.parse)
  unreleaseMonth(useDb(), year, month)
  return { ok: true }
})
```

`server/api/my/plan/[year]/[month].get.ts`:
```ts
import { todayIso } from '../../../../../shared/domain/dates'
import { monthParams } from '../../../../schemas'
import { getMyPlan } from '../../../../services/plan'

export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const { year, month } = await getValidatedRouterParams(event, monthParams.parse)
  return getMyPlan(useDb(), user, year, month, todayIso())
})
```

`server/api/my/leave.get.ts`:
```ts
import { todayIso } from '../../../shared/domain/dates'
import { ServiceError } from '../../lib/errors'
import { yearQuery } from '../../schemas'
import { getLeaveAccount } from '../../services/leave'

export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  if (user.employeeId === null) throw new ServiceError(403, 'no_employee')
  const { year } = await getValidatedQuery(event, yearQuery.parse)
  return getLeaveAccount(useDb(), user.employeeId, year, todayIso())
})
```

`server/api/entries/index.post.ts`:
```ts
import { applyEntriesSchema } from '../../schemas'
import { applyToCells } from '../../services/entries'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const body = await readValidatedBody(event, applyEntriesSchema.parse)
  applyToCells(useDb(), admin, body.cells, body.mode, body.entry)
  return { ok: true }
})
```

`server/api/entries/[id].delete.ts`:
```ts
import { idParams } from '../../schemas'
import { deleteEntry } from '../../services/entries'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteEntry(useDb(), admin, id)
  return { ok: true }
})
```

`server/api/day-notes/[date].put.ts`:
```ts
import { dateParams, dayNoteSchema } from '../../schemas'
import { setDayNote } from '../../services/entries'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { date } = await getValidatedRouterParams(event, dateParams.parse)
  const body = await readValidatedBody(event, dayNoteSchema.parse)
  setDayNote(useDb(), admin, date, body.field, body.value)
  return { ok: true }
})
```

`server/api/employees/index.get.ts`:
```ts
import { todayIso } from '../../../shared/domain/dates'
import { listEmployees } from '../../services/employees'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  return listEmployees(useDb(), todayIso())
})
```

`server/api/employees/index.post.ts`:
```ts
import { employeeCreateSchema } from '../../schemas'
import { createEmployee } from '../../services/employees'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const body = await readValidatedBody(event, employeeCreateSchema.parse)
  return { id: createEmployee(useDb(), body) }
})
```

`server/api/employees/[id].get.ts`:
```ts
import { todayIso } from '../../../shared/domain/dates'
import { idParams } from '../../schemas'
import { getEmployee } from '../../services/employees'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return getEmployee(useDb(), id, todayIso())
})
```

`server/api/employees/[id].put.ts`:
```ts
import { employeeUpdateSchema, idParams } from '../../schemas'
import { updateEmployee } from '../../services/employees'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  updateEmployee(useDb(), id, await readValidatedBody(event, employeeUpdateSchema.parse))
  return { ok: true }
})
```

`server/api/employees/[id]/move.post.ts`:
```ts
import { idParams, moveSchema } from '../../../schemas'
import { moveEmployee } from '../../../services/employees'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { direction } = await readValidatedBody(event, moveSchema.parse)
  moveEmployee(useDb(), id, direction)
  return { ok: true }
})
```

`server/api/employees/[id]/hours.post.ts`:
```ts
import { hoursSchema, idParams } from '../../../schemas'
import { addHours } from '../../../services/employees'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  addHours(useDb(), id, await readValidatedBody(event, hoursSchema.parse))
  return { ok: true }
})
```

`server/api/employees/[id]/adjustments.post.ts`:
```ts
import { adjustmentSchema, idParams } from '../../../schemas'
import { addAdjustment } from '../../../services/employees'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  addAdjustment(useDb(), id, await readValidatedBody(event, adjustmentSchema.parse))
  return { ok: true }
})
```

`server/api/employees/[id]/leave/[year].put.ts`:
```ts
import { employeeYearParams, entitlementSchema } from '../../../../schemas'
import { setEntitlement } from '../../../../services/employees'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id, year } = await getValidatedRouterParams(event, employeeYearParams.parse)
  setEntitlement(useDb(), id, year, await readValidatedBody(event, entitlementSchema.parse))
  return { ok: true }
})
```

`server/api/employee-hours/[id].delete.ts`:
```ts
import { idParams } from '../../schemas'
import { deleteHours } from '../../services/employees'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteHours(useDb(), id)
  return { ok: true }
})
```

`server/api/balance-adjustments/[id].delete.ts`:
```ts
import { idParams } from '../../schemas'
import { deleteAdjustment } from '../../services/employees'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteAdjustment(useDb(), id)
  return { ok: true }
})
```

`server/api/balances.get.ts`:
```ts
import { todayIso } from '../../shared/domain/dates'
import { monthParams } from '../schemas'
import { getBalanceOverview } from '../services/balances'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { year, month } = await getValidatedQuery(event, monthParams.parse)
  return getBalanceOverview(useDb(), year, month, todayIso())
})
```

`server/api/leave.get.ts`:
```ts
import { todayIso } from '../../shared/domain/dates'
import { yearQuery } from '../schemas'
import { getLeaveOverview } from '../services/leave'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { year } = await getValidatedQuery(event, yearQuery.parse)
  return getLeaveOverview(useDb(), year, todayIso())
})
```

`server/api/closures/index.get.ts`:
```ts
import { listClosures } from '../../services/closures'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  return listClosures(useDb())
})
```

`server/api/closures/index.post.ts`:
```ts
import { closureSchema } from '../../schemas'
import { createClosure } from '../../services/closures'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  return createClosure(useDb(), admin, await readValidatedBody(event, closureSchema.parse))
})
```

`server/api/closures/[id].delete.ts`:
```ts
import { idParams } from '../../schemas'
import { deleteClosure } from '../../services/closures'

export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteClosure(useDb(), admin, id)
  return { ok: true }
})
```

`server/api/settings.get.ts`:
```ts
import { getSettings } from '../services/settings'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  return getSettings(useDb())
})
```

`server/api/shift-templates/index.post.ts`:
```ts
import { templateSchema } from '../../schemas'
import { createTemplate } from '../../services/settings'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  return createTemplate(useDb(), await readValidatedBody(event, templateSchema.parse))
})
```

`server/api/shift-templates/[id].put.ts`:
```ts
import { idParams, templateSchema } from '../../schemas'
import { updateTemplate } from '../../services/settings'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return updateTemplate(useDb(), id, await readValidatedBody(event, templateSchema.parse))
})
```

`server/api/shift-templates/[id].delete.ts`:
```ts
import { idParams } from '../../schemas'
import { deleteTemplate } from '../../services/settings'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteTemplate(useDb(), id)
  return { ok: true }
})
```

`server/api/absence-codes/[id].put.ts`:
```ts
import { codeUpdateSchema, idParams } from '../../schemas'
import { updateCode } from '../../services/settings'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return updateCode(useDb(), id, await readValidatedBody(event, codeUpdateSchema.parse))
})
```

`server/api/coverage-rules/index.post.ts`:
```ts
import { coverageRuleSchema } from '../../schemas'
import { createCoverageRule } from '../../services/settings'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  return createCoverageRule(useDb(), await readValidatedBody(event, coverageRuleSchema.parse))
})
```

`server/api/coverage-rules/[id].put.ts`:
```ts
import { coverageRuleSchema, idParams } from '../../schemas'
import { updateCoverageRule } from '../../services/settings'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return updateCoverageRule(useDb(), id, await readValidatedBody(event, coverageRuleSchema.parse))
})
```

`server/api/coverage-rules/[id].delete.ts`:
```ts
import { idParams } from '../../schemas'
import { deleteCoverageRule } from '../../services/settings'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteCoverageRule(useDb(), id)
  return { ok: true }
})
```

`server/api/users/index.get.ts`:
```ts
import { listUsers } from '../../services/users'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  return listUsers(useDb())
})
```

`server/api/users/index.post.ts`:
```ts
import { userCreateSchema } from '../../schemas'
import { createUser } from '../../services/users'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  return createUser(useDb(), await readValidatedBody(event, userCreateSchema.parse))
})
```

`server/api/users/[id].put.ts`:
```ts
import { idParams, userUpdateSchema } from '../../schemas'
import { updateUser } from '../../services/users'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return updateUser(useDb(), id, await readValidatedBody(event, userUpdateSchema.parse))
})
```

`server/api/users/[id]/reset-password.post.ts`:
```ts
import { idParams, passwordResetSchema } from '../../../schemas'
import { resetPassword } from '../../../services/users'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { password } = await readValidatedBody(event, passwordResetSchema.parse)
  resetPassword(useDb(), id, password)
  return { ok: true }
})
```

- [ ] **Step 3: Smoke-test the API against the dev server**

Start `npm run dev` (background). Then (use the dev admin password set in Task 9):
```
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/auth/login -ContentType 'application/json' -Body '{"username":"admin","password":"admin-dev-5678"}' -SessionVariable s
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/employees -ContentType 'application/json' -Body '{"name":"Anna","shortName":"AN","weeklyMinutes":2340,"validFrom":"2026-01-01"}' -WebSession $s
$plan = Invoke-RestMethod http://localhost:3000/api/plan/2026/10 -WebSession $s
$plan.employees; $plan.admin.warnings.Count
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/users -ContentType 'application/json' -Body '{"username":"anna","password":"anna-dev-1234","role":"observer","employeeId":1}' -WebSession $s
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/auth/login -ContentType 'application/json' -Body '{"username":"anna","password":"anna-dev-1234"}' -SessionVariable o
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/auth/password -ContentType 'application/json' -Body '{"currentPassword":"anna-dev-1234","newPassword":"anna-dev-5678"}' -WebSession $o
Invoke-RestMethod http://localhost:3000/api/plan/2026/10 -WebSession $o
Invoke-RestMethod http://localhost:3000/api/balances?year=2026`&month=10 -WebSession $o
```
Expected: employee `Anna` appears; admin plan has warnings (> 0); the observer's plan request fails with 403 (`month_not_released`); the observer's balances request fails with 403 (`forbidden`). Stop the dev server.

- [ ] **Step 4: Typecheck and run tests**

Run: `npm run typecheck` then `npm test`
Expected: no type errors; all tests PASS.

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "feat: expose services through REST API routes"
```

### Task 16: Frontend foundation (texts, layout, login, password)

**Files:**
- Create: `app/locales/de.ts`, `app/utils/format.ts`, `app/utils/errors.ts`, `app/utils/colors.ts`, `app/utils/warnings.ts`, `app/composables/useAction.ts`, `app/middleware/auth.global.ts`, `app/layouts/default.vue`, `app/components/MonthNav.vue`, `app/components/YearNav.vue`, `app/pages/login.vue`, `app/pages/index.vue`, `app/pages/account/password.vue`

**Interfaces:**
- Consumes: `/api/auth/login`, `/api/auth/password`, nuxt-auth-utils `useUserSession()` (`loggedIn`, `user`, `fetch`, `clear`)
- Produces:
  - `de` (all German strings; later tasks only use keys defined here)
  - `formatDate(iso)`, `formatDayShort(iso, weekdayIndex)`, `formatDateTime(isoTimestamp)`, `formatHours(minutes | null)`, `formatNumber(value)`, `hoursToMinutes(hours)`, `monthTitle(year, month)`, `shiftMonth(year, month, delta)`
  - `errorMessage(error: unknown): string`
  - `chipClasses: Record<ColorKey, string>`, `slotClasses: Record<SlotState, string>`, `balanceClass(minutes): string`
  - `indexWarnings(warnings): { byCell; byDate }`, `warningText(warning, names: Map<number, string>): string`
  - `useAction(refresh?)` → `run(action, successMessage?) => Promise<boolean>` (shows toasts)
  - `<MonthNav :year :month @change="(year, month) => …">`, `<YearNav v-model="year">`

- [ ] **Step 1: Write the German texts**

`app/locales/de.ts`:
```ts
import type { SlotState } from '#shared/domain/dayOverview'

const days = (count: number) => (count === 1 ? '1 Tag' : `${count.toLocaleString('de-DE')} Tage`)

export const de = {
  appName: 'Dienstplan',
  months: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
  weekdaysShort: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
  common: {
    save: 'Speichern', delete: 'Löschen', cancel: 'Abbrechen', add: 'Hinzufügen', close: 'Schließen', edit: 'Bearbeiten',
    saved: 'Gespeichert', deleted: 'Gelöscht', confirmDelete: 'Wirklich löschen?',
    previousMonth: 'Vorheriger Monat', nextMonth: 'Nächster Monat', previousYear: 'Vorheriges Jahr', nextYear: 'Nächstes Jahr',
  },
  nav: {
    plan: 'Dienstplan', myPlan: 'Mein Dienstplan', myLeave: 'Mein Urlaub', employees: 'Mitarbeiter',
    balances: 'Stundenkonten', leave: 'Urlaub', closures: 'Schließzeiten', users: 'Benutzer',
    settings: 'Einstellungen', password: 'Passwort ändern', logout: 'Abmelden',
  },
  login: { title: 'Anmelden', username: 'Benutzername', password: 'Passwort', submit: 'Anmelden' },
  password: {
    title: 'Passwort ändern',
    mustChange: 'Bitte vergib ein neues Passwort, bevor du weiterarbeitest.',
    current: 'Aktuelles Passwort', next: 'Neues Passwort (mindestens 8 Zeichen)', repeat: 'Neues Passwort wiederholen',
    mismatch: 'Die beiden neuen Passwörter stimmen nicht überein.', submit: 'Passwort speichern', saved: 'Passwort geändert',
  },
  plan: {
    date: 'Datum', info1: 'Info 1', info2: 'Info 2', draft: 'Entwurf',
    releasedAt: (date: string, by: string) => `Freigegeben am ${date} von ${by}`,
    changesSinceRelease: (count: number) => (count === 1 ? '1 Änderung seit Freigabe' : `${count} Änderungen seit Freigabe`),
    release: 'Freigeben', rerelease: 'Erneut freigeben', unrelease: 'Freigabe zurückziehen',
    unreleaseConfirm: 'Freigabe zurückziehen? Beobachter sehen diesen Monat dann nicht mehr.',
    releasedToast: 'Monat freigegeben', print: 'Drucken', printNow: 'Jetzt drucken',
    week: (number: number) => `KW ${number}`, weekHint: 'Soll/Ist-Differenz der Woche',
    weekTooltip: (target: string, credit: string) => `Soll ${target} · Ist ${credit}`,
    selected: (count: number) => (count === 1 ? '1 Zelle ausgewählt' : `${count} Zellen ausgewählt`),
    selectHint: 'Zelle anklicken · Umschalt+Klick: Bereich · Strg+Klick: mehrere Zellen',
    selectFirst: 'Bitte zuerst eine oder mehrere Zellen auswählen.',
    special: 'Sonderdienst…', clear: 'Leeren', addMode: 'Zum bestehenden Eintrag hinzufügen',
    fillGap: (range: string) => `Ergänzen: ${range}`,
    stillMissing: (duration: string) => `noch ${duration} h`,
    changedTooltip: (before: string, after: string, at: string, by: string) => `vorher: ${before} → jetzt: ${after} · geändert ${at} von ${by}`,
    empty: '(leer)', removeEntry: 'Eintrag entfernen', legend: 'Legende',
  },
  modal: {
    specialTitle: 'Sonderdienst eintragen', codeTitle: (label: string) => `${label} eintragen`,
    start: 'Von', end: 'Bis', breakStart: 'Pause von', breakEnd: 'Pause bis', note: 'Notiz (optional)', save: 'Eintragen',
  },
  spanErrors: {
    not_on_grid: 'Bitte Uhrzeiten im 5-Minuten-Raster angeben.',
    end_before_start: 'Das Ende muss nach dem Beginn liegen.',
    incomplete_break: 'Bitte „Pause von“ und „Pause bis“ angeben oder beide leer lassen.',
    break_outside: 'Die Pause muss innerhalb der Arbeitszeit liegen.',
    missing_times: 'Bitte „Von“ und „Bis“ angeben.',
  },
  overview: {
    title: (date: string) => `Tagesübersicht ${date}`,
    present: 'Anwesend',
    legend: {
      off: 'frei', work: 'Dienst', support: 'Haushaltskraft', break: 'Pause',
      absent: 'Urlaub / Krank / Fortbildung / Schule', prep_time: 'VZ', office: 'Büro',
      holiday: 'Feiertag / Schließtag', other: 'sonstiges',
    } satisfies Record<SlotState, string>,
  },
  warnings: {
    title: 'Warnungen', none: 'Keine Warnungen in diesem Monat.',
    missingEntry: (name: string) => `${name}: kein Eintrag`,
    coverage: (label: string, found: number, required: number) => `${label}: ${found}× eingetragen (${required} benötigt)`,
    targetGap: (name: string, duration: string) => `${name}: noch ${duration} h bis zum Tagessoll`,
  },
  balances: {
    title: 'Stundenkonten', name: 'Mitarbeiter', weekly: 'Wochenstunden',
    today: 'Saldo heute', monthEnd: 'Saldo Monatsende',
    hint: '„Saldo Monatsende“ enthält alle eingetragenen Dienste bis zum Ende des Monats.',
  },
  holidays: {
    new_year: 'Neujahr', epiphany: 'Heilige Drei Könige', good_friday: 'Karfreitag', easter_monday: 'Ostermontag',
    labour_day: 'Tag der Arbeit', ascension_day: 'Christi Himmelfahrt', whit_monday: 'Pfingstmontag',
    corpus_christi: 'Fronleichnam', german_unity_day: 'Tag der Deutschen Einheit', all_saints_day: 'Allerheiligen',
    christmas_day: '1. Weihnachtstag', boxing_day: '2. Weihnachtstag',
  },
  myPlan: { shift: 'Dienst' },
  leave: {
    title: 'Urlaub', myTitle: 'Mein Urlaub', name: 'Mitarbeiter',
    entitlement: 'Anspruch', carriedOver: 'Übertrag Vorjahr', taken: 'genommen', planned: 'verplant', available: 'frei verfügbar',
    days, ranges: 'Urlaubstage', noRanges: 'Keine Urlaubstage eingetragen.', rangeTaken: 'genommen', rangePlanned: 'geplant',
  },
  employees: {
    title: 'Mitarbeiter', name: 'Name', shortName: 'Kürzel', weeklyHours: 'Wochenstunden', validFrom: 'gültig ab',
    leftOn: 'ausgeschieden am', order: 'Reihenfolge', create: 'Mitarbeiter anlegen', moveUp: 'Nach oben', moveDown: 'Nach unten',
    masterData: 'Stammdaten', hoursHistory: 'Wochenstunden', addHours: 'Wochenstunden hinzufügen',
    adjustments: 'Stundenkonto-Buchungen', adjustmentsHint: 'Startsaldo, Übertrag, Auszahlung oder Korrektur.',
    date: 'Datum', amount: 'Stunden (h:mm)', sign: 'Art', plus: 'Plus', minus: 'Minus', reason: 'Grund',
    addAdjustment: 'Buchung hinzufügen', entitlements: 'Urlaubsanspruch', year: 'Jahr', days: 'Tage',
    carriedOver: 'Übertrag', saveEntitlement: 'Anspruch speichern',
    invalidDuration: 'Bitte die Stunden im Format h:mm angeben, z. B. 12:30.',
    back: 'Zurück zur Übersicht', noEntries: 'Noch keine Einträge.',
  },
  closures: {
    title: 'Schließzeiten', from: 'Von', to: 'Bis', label: 'Bezeichnung', mode: 'Eintragen als',
    modes: { vacation: 'Urlaub', closure_day: 'Schließtag' },
    create: 'Schließzeit anlegen',
    hint: 'Beim Anlegen erhält jeder Mitarbeiter an jedem Werktag im Zeitraum einen Eintrag. Einzelne Tage kannst du danach im Dienstplan ändern. Für einen einzelnen freien Tag (z. B. Brückentag) gib bei „Von“ und „Bis“ dasselbe Datum an.',
    confirmDelete: 'Schließzeit löschen? Die unveränderten Einträge werden aus dem Dienstplan entfernt.',
    empty: 'Keine Schließzeiten angelegt.',
  },
  settings: {
    title: 'Einstellungen', templates: 'Dienst-Buttons', shortLabel: 'Kürzel', label: 'Bezeichnung',
    start: 'Von', end: 'Bis', breakStart: 'Pause von', breakEnd: 'Pause bis', countsAsStaff: 'zählt als Betreuungskraft',
    sortOrder: 'Reihenfolge', addTemplate: 'Dienst hinzufügen', codes: 'Codes', color: 'Farbe', creditMode: 'Anrechnung',
    rules: 'Pflichtdienste', rulesHint: 'Die App warnt an jedem Werktag, an dem weniger Dienste mit diesem Beginn (und optional Ende) eingetragen sind.',
    ruleStart: 'Beginn', ruleEnd: 'Ende (optional)', minCount: 'Mindestanzahl', active: 'aktiv', addRule: 'Pflichtdienst hinzufügen',
    backup: 'Datensicherung', backupHint: 'Lädt eine vollständige Kopie der Datenbank herunter. Bewahre sie an einem sicheren Ort auf.',
    backupDownload: 'Datenbank herunterladen', invalidTime: 'Bitte gültige Uhrzeiten angeben.',
  },
  creditModes: { daily_target: 'Tagessoll', timed: 'tatsächliche Zeit', none: 'keine' },
  colors: { neutral: 'neutral', gray: 'grau', green: 'grün', yellow: 'gelb', blue: 'blau', red: 'rot', violet: 'violett', orange: 'orange' },
  users: {
    title: 'Benutzer', username: 'Benutzername', password: 'Startpasswort (mindestens 8 Zeichen)', role: 'Rolle',
    roles: { admin: 'Administrator', observer: 'Beobachter' }, employee: 'Mitarbeiter', noEmployee: '– keiner –',
    active: 'aktiv', status: 'Status', create: 'Benutzer anlegen', resetPassword: 'Passwort zurücksetzen',
    newPassword: 'Neues Passwort (mindestens 8 Zeichen)', resetHint: 'Die Person muss das Passwort bei der nächsten Anmeldung ändern.',
    locked: (until: string) => `gesperrt bis ${until}`, mustChange: 'muss Passwort ändern',
  },
  errors: {
    generic: 'Das hat nicht geklappt. Bitte versuche es noch einmal.',
    login_invalid: 'Benutzername oder Passwort ist falsch.',
    login_locked: 'Zu viele Fehlversuche. Das Konto ist für 15 Minuten gesperrt.',
    session_expired: 'Deine Sitzung ist abgelaufen. Bitte melde dich neu an.',
    forbidden: 'Dafür fehlt dir die Berechtigung.',
    password_change_required: 'Bitte ändere zuerst dein Passwort.',
    wrong_password: 'Das aktuelle Passwort ist falsch.',
    password_too_short: 'Das Passwort muss mindestens 8 Zeichen lang sein.',
    username_required: 'Bitte einen Benutzernamen angeben.',
    username_taken: 'Dieser Benutzername ist schon vergeben.',
    employee_required: 'Beobachter müssen mit einem Mitarbeiter verknüpft sein.',
    employee_taken: 'Dieser Mitarbeiter hat schon ein Benutzerkonto.',
    employee_not_found: 'Mitarbeiter nicht gefunden.',
    last_admin: 'Es muss mindestens ein aktiver Administrator bleiben.',
    user_not_found: 'Benutzer nicht gefunden.',
    month_not_released: 'Dieser Monat ist noch nicht freigegeben.',
    no_employee: 'Dein Konto ist mit keinem Mitarbeiter verknüpft.',
    template_not_found: 'Dieser Dienst existiert nicht mehr.',
    code_not_found: 'Dieser Code existiert nicht mehr.',
    entry_not_found: 'Dieser Eintrag existiert nicht mehr.',
    times_required: 'Für diesen Eintrag sind Uhrzeiten nötig.',
    span_incomplete: 'Bitte „Von“ und „Bis“ angeben.',
    span_not_on_grid: 'Bitte Uhrzeiten im 5-Minuten-Raster angeben.',
    span_end_before_start: 'Das Ende muss nach dem Beginn liegen.',
    span_incomplete_break: 'Bitte „Pause von“ und „Pause bis“ angeben oder beide leer lassen.',
    span_break_outside: 'Die Pause muss innerhalb der Arbeitszeit liegen.',
    entry_required: 'Bitte einen Dienst oder Code auswählen.',
    invalid_date: 'Ungültiges Datum.',
    name_required: 'Bitte einen Namen angeben.',
    reason_required: 'Bitte einen Grund angeben.',
    hours_not_found: 'Dieser Eintrag existiert nicht mehr.',
    last_hours: 'Der letzte Wochenstunden-Eintrag kann nicht gelöscht werden.',
    invalid_range: 'Bitte einen gültigen Zeitraum (höchstens ein Jahr) angeben.',
    label_required: 'Bitte eine Bezeichnung angeben.',
    closure_not_found: 'Diese Schließzeit existiert nicht mehr.',
    rule_not_found: 'Dieser Pflichtdienst existiert nicht mehr.',
    invalid_rule: 'Bitte gültige Uhrzeiten (5-Minuten-Raster, Ende nach Beginn) und eine Mindestanzahl ab 1 angeben.',
  },
}
```

- [ ] **Step 2: Write the utilities and composable**

`app/utils/format.ts`:
```ts
import { parseIsoDate } from '#shared/domain/dates'
import { de } from '~/locales/de'

const pad = (value: number) => String(value).padStart(2, '0')

export function formatDate(iso: string): string {
  const { year, month, day } = parseIsoDate(iso)
  return `${pad(day)}.${pad(month)}.${year}`
}

export function formatDayShort(iso: string, weekdayIndex: number): string {
  const { month, day } = parseIsoDate(iso)
  return `${de.weekdaysShort[weekdayIndex]} ${pad(day)}.${pad(month)}.`
}

export function formatDateTime(timestamp: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(timestamp))
}

export function formatNumber(value: number): string {
  return value.toLocaleString('de-DE', { maximumFractionDigits: 2 })
}

export function formatHours(minutes: number | null): string {
  return minutes === null ? '–' : formatNumber(minutes / 60)
}

export function hoursToMinutes(hours: number): number {
  return Math.round(hours * 60)
}

export function monthTitle(year: number, month: number): string {
  return `${de.months[month - 1]} ${year}`
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}
```

`app/utils/errors.ts`:
```ts
import { de } from '~/locales/de'

export function errorMessage(error: unknown): string {
  const code = (error as { data?: { data?: { code?: string } } } | null)?.data?.data?.code
  if (code && code in de.errors) return de.errors[code as keyof typeof de.errors]
  return de.errors.generic
}
```

`app/utils/colors.ts`:
```ts
import type { SlotState } from '#shared/domain/dayOverview'
import type { ColorKey } from '#shared/types/api'

export const chipClasses: Record<ColorKey, string> = {
  neutral: 'bg-white text-gray-900 ring-1 ring-gray-300',
  gray: 'bg-gray-300 text-gray-800',
  green: 'bg-green-200 text-green-900',
  yellow: 'bg-yellow-200 text-yellow-900',
  blue: 'bg-blue-200 text-blue-900',
  red: 'bg-red-200 text-red-900',
  violet: 'bg-violet-200 text-violet-900',
  orange: 'bg-orange-200 text-orange-900',
}

export const slotClasses: Record<SlotState, string> = {
  off: 'bg-gray-50',
  work: 'bg-teal-400',
  support: 'bg-violet-300',
  break: 'bg-red-500',
  absent: 'bg-gray-300',
  prep_time: 'bg-green-400',
  office: 'bg-yellow-300',
  holiday: 'bg-blue-300',
  other: 'bg-orange-200',
}

export function balanceClass(minutes: number): string {
  if (minutes > 0) return 'text-green-700'
  return minutes < 0 ? 'text-red-700' : 'text-gray-500'
}
```

`app/utils/warnings.ts`:
```ts
import { cellKey } from '#shared/domain/cells'
import { formatDuration } from '#shared/domain/time'
import type { Warning } from '#shared/domain/warnings'
import { de } from '~/locales/de'

export interface WarningIndex {
  byCell: Map<string, Warning[]>
  byDate: Map<string, Warning[]>
}

function push(map: Map<string, Warning[]>, key: string, warning: Warning) {
  map.set(key, [...(map.get(key) ?? []), warning])
}

export function indexWarnings(warnings: Warning[]): WarningIndex {
  const byCell = new Map<string, Warning[]>()
  const byDate = new Map<string, Warning[]>()
  for (const warning of warnings) {
    push(byDate, warning.date, warning)
    if (warning.type !== 'coverage') push(byCell, cellKey(warning.employeeId, warning.date), warning)
  }
  return { byCell, byDate }
}

export function warningText(warning: Warning, names: Map<number, string>): string {
  switch (warning.type) {
    case 'missing_entry':
      return de.warnings.missingEntry(names.get(warning.employeeId) ?? '?')
    case 'coverage':
      return de.warnings.coverage(warning.label, warning.found, warning.required)
    case 'target_gap':
      return de.warnings.targetGap(names.get(warning.employeeId) ?? '?', formatDuration(warning.missingMinutes))
  }
}
```

`app/composables/useAction.ts`:
```ts
import { errorMessage } from '~/utils/errors'

/** Runs an API call, refreshes data on success and reports errors as toasts. */
export function useAction(refresh?: () => Promise<unknown>) {
  const toast = useToast()
  return async function run(action: () => Promise<unknown>, successMessage?: string): Promise<boolean> {
    try {
      await action()
      if (refresh) await refresh()
      if (successMessage) toast.add({ title: successMessage, color: 'success' })
      return true
    }
    catch (error) {
      toast.add({ title: errorMessage(error), color: 'error' })
      return false
    }
  }
}
```

- [ ] **Step 3: Write middleware, layout and navigation components**

`app/middleware/auth.global.ts`:
```ts
export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn, user } = useUserSession()
  if (to.path === '/login') return loggedIn.value ? navigateTo('/') : undefined
  if (!loggedIn.value) return navigateTo('/login')
  if (user.value?.mustChangePassword && to.path !== '/account/password') return navigateTo('/account/password')
  if (to.path.startsWith('/admin') && user.value?.role !== 'admin') return navigateTo('/')
})
```

`app/layouts/default.vue`:
```vue
<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import { de } from '~/locales/de'

const { user, loggedIn, clear } = useUserSession()
const today = parseIsoDate(todayIso())

const links = computed(() => {
  if (!user.value) return []
  const plan = { label: de.nav.plan, to: `/plan/${today.year}/${today.month}` }
  if (user.value.role === 'admin') {
    return [
      plan,
      { label: de.nav.employees, to: '/admin/employees' },
      { label: de.nav.balances, to: '/admin/balances' },
      { label: de.nav.leave, to: '/admin/leave' },
      { label: de.nav.closures, to: '/admin/closures' },
      { label: de.nav.users, to: '/admin/users' },
      { label: de.nav.settings, to: '/admin/settings' },
    ]
  }
  return [
    plan,
    { label: de.nav.myPlan, to: `/my/plan/${today.year}/${today.month}` },
    { label: de.nav.myLeave, to: '/my/leave' },
  ]
})

async function logout() {
  await clear()
  await navigateTo('/login')
}
</script>

<template>
  <div class="min-h-screen bg-gray-50 text-gray-900">
    <header v-if="loggedIn" class="border-b border-gray-200 bg-white print:hidden">
      <div class="mx-auto flex max-w-[1800px] flex-wrap items-center gap-3 px-4 py-2">
        <NuxtLink to="/" class="font-semibold">{{ de.appName }}</NuxtLink>
        <nav class="flex flex-wrap gap-1">
          <NuxtLink
            v-for="link in links" :key="link.to" :to="link.to"
            class="rounded px-2 py-1 text-sm hover:bg-gray-100" active-class="bg-gray-100 font-medium"
          >
            {{ link.label }}
          </NuxtLink>
        </nav>
        <div class="ml-auto flex items-center gap-2 text-sm">
          <span class="text-gray-500">{{ user?.username }}</span>
          <UButton size="xs" color="neutral" variant="ghost" to="/account/password" :label="de.nav.password" />
          <UButton size="xs" color="neutral" variant="outline" :label="de.nav.logout" @click="logout" />
        </div>
      </div>
    </header>
    <main class="mx-auto max-w-[1800px] p-4">
      <slot />
    </main>
  </div>
</template>
```

`app/components/MonthNav.vue`:
```vue
<script setup lang="ts">
import { de } from '~/locales/de'
import { monthTitle, shiftMonth } from '~/utils/format'

const props = defineProps<{ year: number; month: number }>()
const emit = defineEmits<{ change: [year: number, month: number] }>()

function go(delta: number) {
  const next = shiftMonth(props.year, props.month, delta)
  emit('change', next.year, next.month)
}
</script>

<template>
  <div class="flex items-center gap-1">
    <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" class="print:hidden" :aria-label="de.common.previousMonth" @click="go(-1)" />
    <h1 class="min-w-48 text-center text-2xl font-semibold">{{ monthTitle(year, month) }}</h1>
    <UButton icon="i-lucide-chevron-right" color="neutral" variant="ghost" class="print:hidden" :aria-label="de.common.nextMonth" @click="go(1)" />
  </div>
</template>
```

`app/components/YearNav.vue`:
```vue
<script setup lang="ts">
import { de } from '~/locales/de'

const year = defineModel<number>({ required: true })
</script>

<template>
  <div class="flex items-center gap-1">
    <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" :aria-label="de.common.previousYear" @click="year--" />
    <span class="min-w-16 text-center text-lg font-semibold">{{ year }}</span>
    <UButton icon="i-lucide-chevron-right" color="neutral" variant="ghost" :aria-label="de.common.nextYear" @click="year++" />
  </div>
</template>
```

- [ ] **Step 4: Write the pages**

`app/pages/index.vue`:
```vue
<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'

const { year, month } = parseIsoDate(todayIso())
await navigateTo(`/plan/${year}/${month}`, { replace: true })
</script>

<template>
  <div />
</template>
```

`app/pages/login.vue`:
```vue
<script setup lang="ts">
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'

definePageMeta({ layout: false })

const { fetch: refreshSession } = useUserSession()
const form = reactive({ username: '', password: '' })
const error = ref('')
const loading = ref(false)

async function submit() {
  loading.value = true
  error.value = ''
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: form })
    await refreshSession()
    await navigateTo('/')
  }
  catch (caught) {
    error.value = errorMessage(caught)
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-gray-50 p-4">
    <form class="w-full max-w-sm space-y-4 rounded-lg bg-white p-6 ring-1 ring-gray-200" @submit.prevent="submit">
      <h1 class="text-xl font-semibold">{{ de.appName }} · {{ de.login.title }}</h1>
      <UFormField :label="de.login.username">
        <UInput v-model="form.username" autocomplete="username" class="w-full" required />
      </UFormField>
      <UFormField :label="de.login.password">
        <UInput v-model="form.password" type="password" autocomplete="current-password" class="w-full" required />
      </UFormField>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
      <UButton type="submit" block :loading="loading" :label="de.login.submit" />
    </form>
  </div>
</template>
```

`app/pages/account/password.vue`:
```vue
<script setup lang="ts">
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'

const { user, fetch: refreshSession } = useUserSession()
const toast = useToast()
const form = reactive({ currentPassword: '', newPassword: '', repeat: '' })
const error = ref('')

async function submit() {
  error.value = ''
  if (form.newPassword !== form.repeat) {
    error.value = de.password.mismatch
    return
  }
  try {
    await $fetch('/api/auth/password', {
      method: 'POST', body: { currentPassword: form.currentPassword, newPassword: form.newPassword },
    })
    await refreshSession()
    toast.add({ title: de.password.saved, color: 'success' })
    await navigateTo('/')
  }
  catch (caught) {
    error.value = errorMessage(caught)
  }
}
</script>

<template>
  <form class="mx-auto max-w-md space-y-4 rounded-lg bg-white p-6 ring-1 ring-gray-200" @submit.prevent="submit">
    <h1 class="text-xl font-semibold">{{ de.password.title }}</h1>
    <UAlert v-if="user?.mustChangePassword" color="warning" variant="soft" :title="de.password.mustChange" />
    <UFormField :label="de.password.current">
      <UInput v-model="form.currentPassword" type="password" autocomplete="current-password" class="w-full" required />
    </UFormField>
    <UFormField :label="de.password.next">
      <UInput v-model="form.newPassword" type="password" autocomplete="new-password" class="w-full" required />
    </UFormField>
    <UFormField :label="de.password.repeat">
      <UInput v-model="form.repeat" type="password" autocomplete="new-password" class="w-full" required />
    </UFormField>
    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    <UButton type="submit" :label="de.password.submit" />
  </form>
</template>
```

- [ ] **Step 5: Verify in the browser**

Run `npm run dev` (background), open `http://localhost:3000` in the browser pane.
Expected: redirect to `/login`; wrong password shows „Benutzername oder Passwort ist falsch.“; logging in as `admin` works (redirect to `/plan/…`, which shows a 404 until Task 17); the header shows the admin navigation; „Abmelden“ returns to `/login`. Delete `.data/` beforehand to check the forced password change: after the first login, every page redirects to „Passwort ändern“ until a new password is saved.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck` — Expected: no errors.
```
git add -A
git commit -m "feat: add german texts, layout, login and password pages"
```

---

### Task 17: Month plan page

**Files:**
- Create: `app/composables/usePlanSelection.ts`, `app/components/plan/PlanHeader.vue`, `app/components/plan/PlanToolbar.vue`, `app/components/plan/PlanGrid.vue`, `app/components/plan/PlanEntryChip.vue`, `app/components/plan/PlanTimeEntryModal.vue`, `app/pages/plan/[year]/[month].vue`

**Interfaces:**
- Consumes: `GET /api/plan/:y/:m`, `POST /api/entries`, `DELETE /api/entries/:id`, `PUT /api/day-notes/:date`, `POST|DELETE /api/plan/:y/:m/release`; `useAction`, `MonthNav`, utilities from Task 16
- Produces:
  - `usePlanSelection()` → `{ selected: Ref<Set<string>>, cells: ComputedRef<CellRef[]>, click(employeeId, date, event, dates), clear() }`
  - `<PlanGrid :plan :selected? :editable? :selected-date? @cell-click @date-click @note-save @remove-entry>` (reused read-only by the print page)
  - `<PlanEntryChip :entry :removable? @remove>` (reused by "Mein Dienstplan")

- [ ] **Step 1: Write the selection composable**

`app/composables/usePlanSelection.ts`:
```ts
import { cellKey, parseCellKey } from '#shared/domain/cells'
import type { CellRef } from '#shared/types/api'

/** Click: single cell · Shift+click: date range in the same column · Ctrl/Cmd+click: toggle a cell. */
export function usePlanSelection() {
  const selected = ref(new Set<string>())
  const anchor = ref<CellRef | null>(null)
  const cells = computed<CellRef[]>(() => [...selected.value].map(parseCellKey))

  function click(employeeId: number, date: string, event: MouseEvent, dates: string[]) {
    const key = cellKey(employeeId, date)
    if (event.shiftKey && anchor.value?.employeeId === employeeId) {
      const [from, to] = [anchor.value.date, date].sort() as [string, string]
      const next = new Set(selected.value)
      for (const day of dates) if (day >= from && day <= to) next.add(cellKey(employeeId, day))
      selected.value = next
      return
    }
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(selected.value)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      selected.value = next
    }
    else {
      selected.value = new Set([key])
    }
    anchor.value = { employeeId, date }
  }

  function clear() {
    selected.value = new Set()
    anchor.value = null
  }

  return { selected, cells, click, clear }
}
```

- [ ] **Step 2: Write the plan components**

`app/components/plan/PlanEntryChip.vue`:
```vue
<script setup lang="ts">
import type { EntryDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { chipClasses } from '~/utils/colors'

const props = defineProps<{ entry: EntryDto; removable?: boolean }>()
const emit = defineEmits<{ remove: [id: number] }>()
const title = computed(() => [props.entry.shortLabel, props.entry.note].filter(Boolean).join(' · ') || undefined)
</script>

<template>
  <span class="group inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs" :class="chipClasses[entry.color]" :title="title">
    {{ entry.label }}
    <button
      v-if="removable" type="button" class="hidden leading-none opacity-60 hover:opacity-100 group-hover:inline print:hidden"
      :aria-label="de.plan.removeEntry" @click.stop="emit('remove', entry.id)"
    >×</button>
  </span>
</template>
```

`app/components/plan/PlanHeader.vue`:
```vue
<script setup lang="ts">
import type { MonthPlanDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDateTime } from '~/utils/format'

defineProps<{ plan: MonthPlanDto; isAdmin: boolean }>()
const emit = defineEmits<{ navigate: [year: number, month: number]; release: []; unrelease: [] }>()
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <MonthNav :year="plan.year" :month="plan.month" @change="(year: number, month: number) => emit('navigate', year, month)" />
    <UBadge
      v-if="plan.release.releasedAt" color="success" variant="soft"
      :label="de.plan.releasedAt(formatDateTime(plan.release.releasedAt), plan.release.releasedBy ?? '')"
    />
    <UBadge v-else color="neutral" variant="soft" :label="de.plan.draft" />
    <UBadge v-if="plan.release.changeCount > 0" color="warning" variant="soft" :label="de.plan.changesSinceRelease(plan.release.changeCount)" />
    <div class="ml-auto flex flex-wrap gap-2 print:hidden">
      <template v-if="isAdmin">
        <UButton icon="i-lucide-check" :label="plan.release.releasedAt ? de.plan.rerelease : de.plan.release" @click="emit('release')" />
        <UButton v-if="plan.release.releasedAt" color="neutral" variant="outline" :label="de.plan.unrelease" @click="emit('unrelease')" />
      </template>
      <UButton color="neutral" variant="outline" icon="i-lucide-printer" :label="de.plan.print" :to="`/print/${plan.year}/${plan.month}`" target="_blank" />
    </div>
  </div>
</template>
```

`app/components/plan/PlanToolbar.vue`:
```vue
<script setup lang="ts">
import { formatTime } from '#shared/domain/time'
import type { CodeDto, TemplateDto } from '#shared/types/api'
import { de } from '~/locales/de'

defineProps<{
  templates: TemplateDto[]
  codes: CodeDto[]
  selectedCount: number
  gapSuggestion: { start: number; end: number } | null
}>()
const addMode = defineModel<boolean>('addMode', { default: false })
const emit = defineEmits<{ template: [template: TemplateDto]; code: [code: CodeDto]; special: []; clear: []; fillGap: [] }>()
</script>

<template>
  <div class="sticky top-0 z-30 space-y-2 rounded-lg bg-white p-2 ring-1 ring-gray-200 print:hidden">
    <div class="flex flex-wrap items-center gap-1">
      <span class="mr-2 text-xs text-gray-500">{{ selectedCount ? de.plan.selected(selectedCount) : de.plan.selectHint }}</span>
      <UButton
        v-for="template in templates" :key="template.id" size="xs" color="neutral" variant="outline"
        :title="`${template.shortLabel} · ${template.label}`"
        :label="`${formatTime(template.start)}–${formatTime(template.end)}`"
        @click="emit('template', template)"
      />
    </div>
    <div class="flex flex-wrap items-center gap-1">
      <UButton
        v-for="code in codes" :key="code.id" size="xs" color="neutral" variant="soft"
        :label="code.requiresTimes ? `${code.label}…` : code.label" @click="emit('code', code)"
      />
      <UButton size="xs" color="neutral" variant="soft" :label="de.plan.special" @click="emit('special')" />
      <UButton size="xs" color="error" variant="ghost" icon="i-lucide-eraser" :label="de.plan.clear" @click="emit('clear')" />
      <UButton
        v-if="gapSuggestion" size="xs" color="warning" variant="soft"
        :label="de.plan.fillGap(`${formatTime(gapSuggestion.start)}–${formatTime(gapSuggestion.end)}`)"
        @click="emit('fillGap')"
      />
      <UCheckbox v-model="addMode" :label="de.plan.addMode" class="ml-auto" />
    </div>
  </div>
</template>
```

`app/components/plan/PlanTimeEntryModal.vue`:
```vue
<script setup lang="ts">
import { parseTime, validateSpan } from '#shared/domain/time'
import type { CodeDto, EntryInput } from '#shared/types/api'
import { de } from '~/locales/de'

const props = defineProps<{ code: CodeDto | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ submit: [entry: EntryInput] }>()

const form = reactive({ start: '', end: '', breakStart: '', breakEnd: '', note: '' })
const error = ref('')
const title = computed(() => (props.code ? de.modal.codeTitle(props.code.label) : de.modal.specialTitle))

watch(open, (isOpen) => {
  if (!isOpen) return
  Object.assign(form, { start: '', end: '', breakStart: '', breakEnd: '', note: '' })
  error.value = ''
})

function submit() {
  const start = parseTime(form.start)
  const end = parseTime(form.end)
  if (start === null || end === null) {
    error.value = de.spanErrors.missing_times
    return
  }
  const breakStart = form.breakStart ? parseTime(form.breakStart) : null
  const breakEnd = form.breakEnd ? parseTime(form.breakEnd) : null
  const spanError = validateSpan({ start, end, breakStart, breakEnd })
  if (spanError) {
    error.value = de.spanErrors[spanError]
    return
  }
  const note = form.note.trim() || null
  emit('submit', props.code
    ? { kind: 'code', codeId: props.code.id, start, end, breakStart, breakEnd, note }
    : { kind: 'special', start, end, breakStart, breakEnd, note })
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="title">
    <template #body>
      <form class="grid grid-cols-2 gap-3" @submit.prevent="submit">
        <UFormField :label="de.modal.start"><UInput v-model="form.start" type="time" step="300" class="w-full" /></UFormField>
        <UFormField :label="de.modal.end"><UInput v-model="form.end" type="time" step="300" class="w-full" /></UFormField>
        <UFormField :label="de.modal.breakStart"><UInput v-model="form.breakStart" type="time" step="300" class="w-full" /></UFormField>
        <UFormField :label="de.modal.breakEnd"><UInput v-model="form.breakEnd" type="time" step="300" class="w-full" /></UFormField>
        <UFormField :label="de.modal.note" class="col-span-2"><UInput v-model="form.note" maxlength="200" class="w-full" /></UFormField>
        <p v-if="error" class="col-span-2 text-sm text-red-600">{{ error }}</p>
        <div class="col-span-2 flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton type="submit" :label="de.modal.save" />
        </div>
      </form>
    </template>
  </UModal>
</template>
```

`app/components/plan/PlanGrid.vue`:
```vue
<script setup lang="ts">
import { cellKey, noteKey } from '#shared/domain/cells'
import { formatDuration, formatSignedDuration } from '#shared/domain/time'
import type { DayRowDto, EntryDto, MonthPlanDto, NoteField, WeekSummaryDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { balanceClass } from '~/utils/colors'
import { formatDateTime, formatDayShort } from '~/utils/format'
import { indexWarnings, warningText } from '~/utils/warnings'

const props = defineProps<{
  plan: MonthPlanDto
  selected?: Set<string>
  editable?: boolean
  selectedDate?: string | null
}>()
const emit = defineEmits<{
  cellClick: [employeeId: number, date: string, event: MouseEvent]
  dateClick: [date: string]
  noteSave: [date: string, field: NoteField, value: string]
  removeEntry: [id: number]
}>()

const NOTE_FIELDS: NoteField[] = ['info1', 'info2']
const employeeNames = computed(() => new Map(props.plan.employees.map(employee => [employee.id, employee.name])))
const warnings = computed(() => indexWarnings(props.plan.admin?.warnings ?? []))

const entriesByCell = computed(() => {
  const map = new Map<string, EntryDto[]>()
  for (const entry of props.plan.entries) {
    const key = cellKey(entry.employeeId, entry.date)
    map.set(key, [...(map.get(key) ?? []), entry])
  }
  return map
})

const weekByLastDay = computed(() => {
  const map = new Map<string, WeekSummaryDto>()
  for (const week of props.plan.admin?.weeks ?? []) {
    const last = props.plan.days.filter(day => day.date >= week.weekStart && day.date <= week.weekEnd).at(-1)
    if (last) map.set(last.date, week)
  }
  return map
})

function changeText(key: string): string | undefined {
  const changes = props.plan.changes[key]
  if (!changes?.length) return undefined
  return changes
    .map(change => de.plan.changedTooltip(change.before || de.plan.empty, change.after || de.plan.empty, formatDateTime(change.changedAt), change.changedBy))
    .join('\n')
}

function joinLines(lines: (string | undefined)[]): string | undefined {
  return lines.filter(Boolean).join('\n') || undefined
}

function rowClass(day: DayRowDto): string {
  if (day.holidayKey || day.closureLabel) return 'bg-blue-50'
  return day.isWeekend ? 'bg-gray-100 text-gray-500' : 'bg-white'
}

const rows = computed(() => props.plan.days.map((day) => {
  const cells = props.plan.employees.map((employee) => {
    const key = cellKey(employee.id, day.date)
    const cellWarnings = warnings.value.byCell.get(key) ?? []
    const gap = cellWarnings.find(warning => warning.type === 'target_gap')
    return {
      key,
      employeeId: employee.id,
      entries: entriesByCell.value.get(key) ?? [],
      changed: Boolean(props.plan.changes[key]),
      missing: cellWarnings.some(warning => warning.type === 'missing_entry'),
      gapMinutes: gap?.type === 'target_gap' ? gap.missingMinutes : null,
      title: joinLines([changeText(key), ...cellWarnings.map(warning => warningText(warning, employeeNames.value))]),
    }
  })
  const notes = NOTE_FIELDS.map((field) => {
    const key = noteKey(field, day.date)
    return { field, value: day[field], changed: Boolean(props.plan.changes[key]), title: changeText(key) }
  })
  const dayWarnings = warnings.value.byDate.get(day.date) ?? []
  const week = weekByLastDay.value.get(day.date)
  return {
    day,
    cells,
    notes,
    hasWarnings: dayWarnings.length > 0,
    warningTitle: joinLines(dayWarnings.map(warning => warningText(warning, employeeNames.value))),
    week: week
      ? {
          number: week.weekNumber,
          totals: props.plan.employees.map(employee =>
            week.totals.find(total => total.employeeId === employee.id) ?? { employeeId: employee.id, target: 0, credit: 0, delta: 0 }),
        }
      : null,
  }
}))
</script>

<template>
  <div class="overflow-x-auto rounded-lg ring-1 ring-gray-200 print:overflow-visible print:ring-0">
    <table class="w-full border-collapse text-sm">
      <thead class="bg-gray-100 text-xs text-gray-600">
        <tr>
          <th class="sticky left-0 z-10 w-28 border border-gray-200 bg-gray-100 px-2 py-1 text-left">{{ de.plan.date }}</th>
          <th v-for="employee in plan.employees" :key="employee.id" class="min-w-28 border border-gray-200 px-2 py-1">{{ employee.name }}</th>
          <th class="min-w-32 border border-gray-200 px-2 py-1">{{ de.plan.info1 }}</th>
          <th class="min-w-32 border border-gray-200 px-2 py-1">{{ de.plan.info2 }}</th>
          <th v-if="plan.admin" class="w-8 border border-gray-200 px-1 py-1 print:hidden"><UIcon name="i-lucide-triangle-alert" /></th>
        </tr>
      </thead>
      <tbody>
        <template v-for="row in rows" :key="row.day.date">
          <tr :class="rowClass(row.day)">
            <td
              class="sticky left-0 z-10 border border-gray-200 px-2 py-1 align-top"
              :class="[rowClass(row.day), selectedDate === row.day.date ? 'ring-2 ring-inset ring-sky-500' : '']"
            >
              <button type="button" class="text-left font-medium hover:underline" @click="emit('dateClick', row.day.date)">
                {{ formatDayShort(row.day.date, row.day.weekday) }}
              </button>
              <div v-if="row.day.holidayKey" class="text-xs text-blue-700">{{ de.holidays[row.day.holidayKey] }}</div>
              <div v-else-if="row.day.closureLabel" class="text-xs text-blue-700">{{ row.day.closureLabel }}</div>
            </td>
            <td
              v-for="cell in row.cells" :key="cell.key"
              class="border border-gray-200 px-1 py-1 align-top"
              :class="[
                editable ? 'cursor-pointer hover:bg-sky-50' : '',
                selected?.has(cell.key) ? 'bg-sky-100' : cell.missing ? 'bg-red-50' : '',
                cell.changed ? 'outline-2 -outline-offset-2 outline-orange-400' : '',
              ]"
              :title="cell.title"
              @click="emit('cellClick', cell.employeeId, row.day.date, $event)"
            >
              <div class="flex flex-col items-start gap-0.5">
                <PlanEntryChip v-for="entry in cell.entries" :key="entry.id" :entry="entry" :removable="editable" @remove="emit('removeEntry', $event)" />
                <span v-if="cell.gapMinutes !== null" class="text-xs text-amber-700">{{ de.plan.stillMissing(formatDuration(cell.gapMinutes)) }}</span>
              </div>
            </td>
            <td
              v-for="note in row.notes" :key="note.field"
              class="border border-gray-200 px-1 py-1 align-top"
              :class="note.changed ? 'outline-2 -outline-offset-2 outline-orange-400' : ''"
              :title="note.title"
            >
              <input
                v-if="editable" :value="note.value" maxlength="200"
                class="w-full rounded border border-transparent bg-transparent px-1 text-xs hover:border-gray-300 focus:border-sky-500 focus:outline-none"
                @change="emit('noteSave', row.day.date, note.field, ($event.target as HTMLInputElement).value)"
              >
              <span v-else class="text-xs">{{ note.value }}</span>
            </td>
            <td v-if="plan.admin" class="border border-gray-200 px-1 py-1 text-center align-top print:hidden" :title="row.warningTitle">
              <UIcon v-if="row.hasWarnings" name="i-lucide-triangle-alert" class="text-red-600" />
            </td>
          </tr>
          <tr v-if="row.week" class="bg-gray-50 text-xs">
            <td class="sticky left-0 z-10 border border-gray-200 bg-gray-50 px-2 py-1 font-medium">{{ de.plan.week(row.week.number) }}</td>
            <td
              v-for="total in row.week.totals" :key="total.employeeId"
              class="border border-gray-200 px-2 py-1 text-center font-medium" :class="balanceClass(total.delta)"
              :title="de.plan.weekTooltip(formatDuration(total.target), formatDuration(total.credit))"
            >
              {{ formatSignedDuration(total.delta) }}
            </td>
            <td :colspan="plan.admin ? 3 : 2" class="border border-gray-200 px-2 py-1 text-gray-500">{{ de.plan.weekHint }}</td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>
```

- [ ] **Step 3: Write the page**

`app/pages/plan/[year]/[month].vue`:
```vue
<script setup lang="ts">
import type { ApplyMode, CodeDto, EntryInput, MonthPlanDto, NoteField, TemplateDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'

const route = useRoute()
const year = computed(() => Number(route.params.year))
const month = computed(() => Number(route.params.month))
const { user } = useUserSession()
const isAdmin = computed(() => user.value?.role === 'admin')
const toast = useToast()

const { data: plan, error, refresh } = await useFetch<MonthPlanDto>(() => `/api/plan/${year.value}/${month.value}`)
const run = useAction(refresh)
const selection = usePlanSelection()
const addMode = ref(false)
const selectedDate = ref<string | null>(null)
const modalOpen = ref(false)
const modalCode = ref<CodeDto | null>(null)

watch([year, month], () => {
  selection.clear()
  selectedDate.value = null
})

const dates = computed(() => plan.value?.days.map(day => day.date) ?? [])
const insertMode = (): ApplyMode => (addMode.value ? 'add' : 'replace')

/** One selected cell with a target gap: suggest a special shift right after its last entry (rounded up to 5 minutes). */
const gapSuggestion = computed(() => {
  const current = plan.value
  const cell = selection.cells.value.length === 1 ? selection.cells.value[0] : undefined
  if (!current?.admin || !cell) return null
  const gap = current.admin.warnings.find(w => w.type === 'target_gap' && w.employeeId === cell.employeeId && w.date === cell.date)
  if (gap?.type !== 'target_gap') return null
  const ends = current.entries
    .filter(entry => entry.employeeId === cell.employeeId && entry.date === cell.date && entry.end !== null)
    .map(entry => entry.end!)
  if (ends.length === 0) return null
  const start = Math.max(...ends)
  const end = Math.ceil((start + gap.missingMinutes) / 5) * 5
  return end <= 24 * 60 ? { start, end } : null
})

function hasSelection(): boolean {
  if (selection.cells.value.length > 0) return true
  toast.add({ title: de.plan.selectFirst, color: 'warning' })
  return false
}

function apply(mode: ApplyMode, entry: EntryInput | null) {
  if (!hasSelection()) return
  run(() => $fetch('/api/entries', { method: 'POST', body: { cells: selection.cells.value, mode, entry } }))
}

function onTemplate(template: TemplateDto) {
  apply(insertMode(), { kind: 'shift', templateId: template.id })
}

function openModal(code: CodeDto | null) {
  if (!hasSelection()) return
  modalCode.value = code
  modalOpen.value = true
}

function onCode(code: CodeDto) {
  if (code.requiresTimes) openModal(code)
  else apply(insertMode(), { kind: 'code', codeId: code.id })
}

function onFillGap() {
  const gap = gapSuggestion.value
  if (gap) apply('add', { kind: 'special', start: gap.start, end: gap.end })
}

function onCellClick(employeeId: number, date: string, event: MouseEvent) {
  if (isAdmin.value) selection.click(employeeId, date, event, dates.value)
}

function onNoteSave(date: string, field: NoteField, value: string) {
  run(() => $fetch(`/api/day-notes/${date}`, { method: 'PUT', body: { field, value } }))
}

function onRemoveEntry(id: number) {
  run(() => $fetch(`/api/entries/${id}`, { method: 'DELETE' }))
}

function release() {
  run(() => $fetch(`/api/plan/${year.value}/${month.value}/release`, { method: 'POST' }), de.plan.releasedToast)
}

function unrelease() {
  if (window.confirm(de.plan.unreleaseConfirm)) {
    run(() => $fetch(`/api/plan/${year.value}/${month.value}/release`, { method: 'DELETE' }))
  }
}

function navigate(nextYear: number, nextMonth: number) {
  return navigateTo(`/plan/${nextYear}/${nextMonth}`)
}
</script>

<template>
  <div class="space-y-3">
    <template v-if="plan">
      <PlanHeader :plan="plan" :is-admin="isAdmin" @navigate="navigate" @release="release" @unrelease="unrelease" />
      <PlanToolbar
        v-if="isAdmin" v-model:add-mode="addMode"
        :templates="plan.templates" :codes="plan.codes"
        :selected-count="selection.cells.value.length" :gap-suggestion="gapSuggestion"
        @template="onTemplate" @code="onCode" @special="openModal(null)" @clear="apply('clear', null)" @fill-gap="onFillGap"
      />
      <div class="flex flex-col gap-3 xl:flex-row xl:items-start">
        <div class="min-w-0 flex-1 space-y-3">
          <PlanGrid
            :plan="plan" :selected="selection.selected.value" :editable="isAdmin" :selected-date="selectedDate"
            @cell-click="onCellClick" @date-click="selectedDate = $event" @note-save="onNoteSave" @remove-entry="onRemoveEntry"
          />
        </div>
      </div>
      <PlanTimeEntryModal v-model:open="modalOpen" :code="modalCode" @submit="apply(insertMode(), $event)" />
    </template>
    <template v-else>
      <MonthNav :year="year" :month="month" @change="navigate" />
      <UAlert color="warning" variant="soft" :title="errorMessage(error)" />
    </template>
  </div>
</template>
```

- [ ] **Step 4: Verify in the browser**

With `npm run dev` running, log in as admin, create two employees via `/api/employees` (or wait for Task 20) and open `/plan/2026/10`.
Expected:
- „Oktober 2026“ at the top, arrows switch months; rows 01.–31., Sa/So grey, 03.10. blue with „Tag der Deutschen Einheit“.
- Click a cell → blue selection; Shift+click further down the same column selects the range; Ctrl+click toggles cells.
- „8:45–17:00“ fills the selection; „Krank“ replaces it (grey chip); with „Zum bestehenden Eintrag hinzufügen“ a second entry is added; hovering a chip shows × to delete it; „Leeren“ empties the cells.
- „VZ…“ opens the time dialog; a break outside the time shows „Die Pause muss innerhalb der Arbeitszeit liegen.“; after saving VZ 7:30–9:30 the cell shows „noch 5:48 h“ and, with that single cell selected, the toolbar offers „Ergänzen: 9:30–15:20“.
- Week rows „KW 41“ etc. show signed differences (red/green); the warning column shows a red triangle with tooltip text.
- Info 1/2: typing and leaving the field saves (survives reload).
- „Freigeben“ → green badge; changing a cell afterwards → orange outline + tooltip „vorher … → jetzt …“ and „1 Änderung seit Freigabe“; „Erneut freigeben“ clears the marks.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` — Expected: no errors.
```
git add -A
git commit -m "feat: add month plan page with shift buttons, selection and release"
```

---

### Task 18: Day overview and admin sidebar

**Files:**
- Create: `app/components/plan/PlanDayOverviewPanel.vue`, `app/components/plan/PlanSidebar.vue`
- Modify: `app/pages/plan/[year]/[month].vue` (template only)

**Interfaces:**
- Consumes: `buildDayOverview`, `MonthPlanDto`, `slotClasses`, `balanceClass`, `warningText`
- Produces: `<PlanDayOverviewPanel :plan :date @close>`, `<PlanSidebar :plan @select-date>`

- [ ] **Step 1: Write the components**

`app/components/plan/PlanDayOverviewPanel.vue`:
```vue
<script setup lang="ts">
import { buildDayOverview, type SlotState } from '#shared/domain/dayOverview'
import { formatTime } from '#shared/domain/time'
import type { MonthPlanDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { slotClasses } from '~/utils/colors'
import { formatDate } from '~/utils/format'

const props = defineProps<{ plan: MonthPlanDto; date: string }>()
const emit = defineEmits<{ close: [] }>()

const LEGEND: SlotState[] = ['work', 'support', 'break', 'absent', 'prep_time', 'office', 'holiday', 'other']
const names = computed(() => new Map(props.plan.employees.map(employee => [employee.id, employee.name])))
const day = computed(() => props.plan.days.find(candidate => candidate.date === props.date))
const overview = computed(() => buildDayOverview(
  props.plan.employees.map(employee => ({
    employeeId: employee.id,
    entries: props.plan.entries.filter(entry => entry.employeeId === employee.id && entry.date === props.date),
  })),
  Boolean(day.value?.holidayKey),
))
const gridStyle = computed(() => ({
  gridTemplateColumns: `9rem repeat(${overview.value.slotStarts.length}, minmax(0.9rem, 1fr))`,
}))
</script>

<template>
  <section class="rounded-lg bg-white p-3 ring-1 ring-gray-200">
    <div class="mb-2 flex items-center">
      <h2 class="font-semibold">{{ de.overview.title(formatDate(date)) }}</h2>
      <UButton class="ml-auto" size="xs" color="neutral" variant="ghost" icon="i-lucide-x" :aria-label="de.common.close" @click="emit('close')" />
    </div>
    <div class="overflow-x-auto">
      <div class="grid gap-px text-xs" :style="gridStyle">
        <div />
        <div v-for="start in overview.slotStarts" :key="start" class="whitespace-nowrap text-[10px] text-gray-500">
          {{ start % 60 === 0 ? formatTime(start) : '' }}
        </div>
        <template v-for="row in overview.rows" :key="row.employeeId">
          <div class="truncate pr-2">{{ names.get(row.employeeId) }}</div>
          <div
            v-for="(state, index) in row.states" :key="index" class="h-5"
            :class="slotClasses[state]" :title="`${formatTime(overview.slotStarts[index]!)} · ${de.overview.legend[state]}`"
          />
        </template>
        <div class="pr-2 font-semibold">{{ de.overview.present }}</div>
        <div v-for="(count, index) in overview.present" :key="`present-${index}`" class="text-center font-semibold">{{ count }}</div>
      </div>
    </div>
    <div class="mt-3 flex flex-wrap gap-3 text-xs text-gray-600">
      <span v-for="state in LEGEND" :key="state" class="flex items-center gap-1">
        <span class="inline-block h-3 w-3 rounded-sm" :class="slotClasses[state]" />
        {{ de.overview.legend[state] }}
      </span>
    </div>
  </section>
</template>
```

`app/components/plan/PlanSidebar.vue`:
```vue
<script setup lang="ts">
import { formatSignedDuration } from '#shared/domain/time'
import type { MonthPlanDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { balanceClass } from '~/utils/colors'
import { formatDate } from '~/utils/format'
import { warningText } from '~/utils/warnings'

const props = defineProps<{ plan: MonthPlanDto }>()
const emit = defineEmits<{ selectDate: [date: string] }>()
const names = computed(() => new Map(props.plan.employees.map(employee => [employee.id, employee.name])))
const warnings = computed(() => props.plan.admin?.warnings ?? [])
</script>

<template>
  <aside class="space-y-3 print:hidden">
    <section class="rounded-lg bg-white p-3 ring-1 ring-gray-200">
      <h2 class="mb-2 font-semibold">{{ de.warnings.title }} ({{ warnings.length }})</h2>
      <p v-if="warnings.length === 0" class="text-sm text-gray-500">{{ de.warnings.none }}</p>
      <ul v-else class="max-h-96 space-y-1 overflow-y-auto text-sm">
        <li v-for="(warning, index) in warnings" :key="index">
          <button type="button" class="text-left hover:underline" @click="emit('selectDate', warning.date)">
            <span class="font-medium">{{ formatDate(warning.date) }}</span> {{ warningText(warning, names) }}
          </button>
        </li>
      </ul>
    </section>
    <section class="rounded-lg bg-white p-3 ring-1 ring-gray-200">
      <h2 class="mb-2 font-semibold">{{ de.balances.title }}</h2>
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-gray-500">
          <tr><th>{{ de.balances.name }}</th><th class="text-right">{{ de.balances.today }}</th><th class="text-right">{{ de.balances.monthEnd }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="balance in plan.admin?.balances ?? []" :key="balance.employeeId" class="border-t border-gray-100">
            <td class="py-1">{{ balance.name }}</td>
            <td class="py-1 text-right font-medium" :class="balanceClass(balance.today)">{{ formatSignedDuration(balance.today) }}</td>
            <td class="py-1 text-right font-medium" :class="balanceClass(balance.monthEnd)">{{ formatSignedDuration(balance.monthEnd) }}</td>
          </tr>
        </tbody>
      </table>
      <p class="mt-2 text-xs text-gray-500">{{ de.balances.hint }}</p>
    </section>
  </aside>
</template>
```

- [ ] **Step 2: Add both components to the plan page**

In `app/pages/plan/[year]/[month].vue`, replace:
```vue
          <PlanGrid
            :plan="plan" :selected="selection.selected.value" :editable="isAdmin" :selected-date="selectedDate"
            @cell-click="onCellClick" @date-click="selectedDate = $event" @note-save="onNoteSave" @remove-entry="onRemoveEntry"
          />
        </div>
      </div>
```
with:
```vue
          <PlanGrid
            :plan="plan" :selected="selection.selected.value" :editable="isAdmin" :selected-date="selectedDate"
            @cell-click="onCellClick" @date-click="selectedDate = $event" @note-save="onNoteSave" @remove-entry="onRemoveEntry"
          />
          <PlanDayOverviewPanel v-if="selectedDate" :plan="plan" :date="selectedDate" @close="selectedDate = null" />
        </div>
        <PlanSidebar v-if="plan.admin" :plan="plan" class="xl:sticky xl:top-2 xl:w-80" @select-date="selectedDate = $event" />
      </div>
```

- [ ] **Step 3: Verify in the browser**

On `/plan/2026/10` as admin with some shifts entered:
Expected: clicking a date shows „Tagesübersicht dd.mm.yyyy“ with one bar per employee from 7:00 to 17:00; M shows red slots at 11:45 and 12:00; HK is violet and not counted; „Anwesend“ shows counts per 15 minutes; Krank/Urlaub rows are grey; a festival 14:00–18:30 on Saturday extends the range to 19:00. The sidebar lists warnings (click → opens that day's overview) and the balances „Saldo heute“/„Saldo Monatsende“.

- [ ] **Step 4: Typecheck and commit**

Run: `npm run typecheck` — Expected: no errors.
```
git add -A
git commit -m "feat: add day overview timeline and admin sidebar"
```

---

### Task 19: Observer pages ("Mein Dienstplan", "Mein Urlaub")

**Files:**
- Create: `app/pages/my/plan/[year]/[month].vue`, `app/pages/my/leave.vue`

**Interfaces:**
- Consumes: `GET /api/my/plan/:y/:m` → `MyPlanDto`, `GET /api/my/leave?year` → `LeaveAccountDto`, `MonthNav`, `YearNav`, `PlanEntryChip`

- [ ] **Step 1: Write the pages**

`app/pages/my/plan/[year]/[month].vue`:
```vue
<script setup lang="ts">
import type { MyPlanDayDto, MyPlanDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDateTime, formatDayShort } from '~/utils/format'

const route = useRoute()
const year = computed(() => Number(route.params.year))
const month = computed(() => Number(route.params.month))
const { data, error } = await useFetch<MyPlanDto>(() => `/api/my/plan/${year.value}/${month.value}`)

function navigate(nextYear: number, nextMonth: number) {
  return navigateTo(`/my/plan/${nextYear}/${nextMonth}`)
}

function changeTitle(day: MyPlanDayDto): string | undefined {
  return day.changes
    .map(change => de.plan.changedTooltip(change.before || de.plan.empty, change.after || de.plan.empty, formatDateTime(change.changedAt), change.changedBy))
    .join('\n') || undefined
}

function rowClass(day: MyPlanDayDto): string {
  if (day.changes.length > 0) return 'bg-orange-50'
  if (day.holidayKey || day.closureLabel) return 'bg-blue-50'
  return day.isWeekend ? 'bg-gray-50 text-gray-500' : 'bg-white'
}
</script>

<template>
  <div class="max-w-3xl space-y-3">
    <div class="flex flex-wrap items-center gap-3">
      <MonthNav :year="year" :month="month" @change="navigate" />
      <span v-if="data" class="text-gray-600">{{ data.employee.name }}</span>
      <UBadge v-if="data?.release.changeCount" color="warning" variant="soft" :label="de.plan.changesSinceRelease(data.release.changeCount)" />
    </div>
    <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />
    <table v-if="data" class="w-full overflow-hidden rounded-lg text-sm ring-1 ring-gray-200">
      <thead class="bg-gray-100 text-left text-xs text-gray-600">
        <tr>
          <th class="px-3 py-2">{{ de.plan.date }}</th>
          <th class="px-3 py-2">{{ de.myPlan.shift }}</th>
          <th class="px-3 py-2">{{ de.plan.info1 }}</th>
          <th class="px-3 py-2">{{ de.plan.info2 }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="day in data.days" :key="day.date" class="border-t border-gray-200" :class="rowClass(day)" :title="changeTitle(day)">
          <td class="px-3 py-1.5 font-medium" :class="day.changes.length ? 'border-l-4 border-orange-400' : ''">
            {{ formatDayShort(day.date, day.weekday) }}
            <div v-if="day.holidayKey" class="text-xs font-normal text-blue-700">{{ de.holidays[day.holidayKey] }}</div>
            <div v-else-if="day.closureLabel" class="text-xs font-normal text-blue-700">{{ day.closureLabel }}</div>
          </td>
          <td class="px-3 py-1.5">
            <div class="flex flex-wrap gap-1">
              <PlanEntryChip v-for="entry in day.entries" :key="entry.id" :entry="entry" />
            </div>
          </td>
          <td class="px-3 py-1.5 text-xs">{{ day.info1 }}</td>
          <td class="px-3 py-1.5 text-xs">{{ day.info2 }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
```

`app/pages/my/leave.vue`:
```vue
<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import type { LeaveAccountDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatNumber } from '~/utils/format'

const today = todayIso()
const year = ref(parseIsoDate(today).year)
const { data, error } = await useFetch<LeaveAccountDto>('/api/my/leave', { query: { year } })

const cards = computed(() => {
  const account = data.value?.account
  if (!account) return []
  return [
    { label: de.leave.entitlement, value: account.entitlement, highlight: false },
    { label: de.leave.carriedOver, value: account.carriedOver, highlight: false },
    { label: de.leave.taken, value: account.taken, highlight: false },
    { label: de.leave.planned, value: account.planned, highlight: false },
    { label: de.leave.available, value: account.available, highlight: true },
  ]
})
</script>

<template>
  <div class="max-w-3xl space-y-4">
    <div class="flex items-center gap-3">
      <h1 class="text-2xl font-semibold">{{ de.leave.myTitle }}</h1>
      <YearNav v-model="year" />
    </div>
    <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />
    <template v-if="data">
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div
          v-for="card in cards" :key="card.label" class="rounded-lg bg-white p-3"
          :class="card.highlight ? 'ring-2 ring-sky-500' : 'ring-1 ring-gray-200'"
        >
          <div class="text-xs text-gray-500">{{ card.label }}</div>
          <div class="text-2xl font-semibold">{{ formatNumber(card.value) }}</div>
        </div>
      </div>
      <section class="rounded-lg bg-white p-4 ring-1 ring-gray-200">
        <h2 class="mb-2 font-semibold">{{ de.leave.ranges }}</h2>
        <p v-if="data.ranges.length === 0" class="text-sm text-gray-500">{{ de.leave.noRanges }}</p>
        <ul v-else class="divide-y divide-gray-100 text-sm">
          <li v-for="range in data.ranges" :key="range.from" class="flex justify-between py-1.5">
            <span>{{ range.from === range.to ? formatDate(range.from) : `${formatDate(range.from)} – ${formatDate(range.to)}` }}</span>
            <span class="text-gray-500">{{ de.leave.days(range.days) }} · {{ range.to < today ? de.leave.rangeTaken : de.leave.rangePlanned }}</span>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
```

- [ ] **Step 2: Verify in the browser**

As admin: create an observer for an employee (via `/api/users` or wait for Task 22), enter vacation for that employee and release the month. Log in as the observer.
Expected: navigation shows only „Dienstplan“, „Mein Dienstplan“, „Mein Urlaub“; `/admin/employees` redirects to the plan; the general plan shows no toolbar, no week rows, no warnings column, no sidebar; an unreleased month shows „Dieser Monat ist noch nicht freigegeben.“; „Mein Dienstplan“ lists only the own entries, changed days are orange; „Mein Urlaub“ shows the five numbers and the grouped vacation ranges.

- [ ] **Step 3: Typecheck and commit**

Run: `npm run typecheck` — Expected: no errors.
```
git add -A
git commit -m "feat: add personal plan and leave pages for observers"
```

---

### Task 20: Admin employee pages

**Files:**
- Create: `app/pages/admin/employees/index.vue`, `app/pages/admin/employees/[id].vue`

**Interfaces:**
- Consumes: `/api/employees` (GET/POST), `/api/employees/:id` (GET/PUT), `/api/employees/:id/move|hours|adjustments`, `/api/employees/:id/leave/:year`, `/api/employee-hours/:id` (DELETE), `/api/balance-adjustments/:id` (DELETE); `parseDuration`, `formatSignedDuration`, format helpers, `useAction`

- [ ] **Step 1: Write the list page**

`app/pages/admin/employees/index.vue`:
```vue
<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { EmployeeListItemDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate, formatHours, hoursToMinutes } from '~/utils/format'

const { data: list, refresh } = await useFetch<EmployeeListItemDto[]>('/api/employees')
const run = useAction(refresh)
const form = reactive({ name: '', shortName: '', weeklyHours: 39, validFrom: todayIso() })

async function create() {
  const ok = await run(() => $fetch('/api/employees', {
    method: 'POST',
    body: { name: form.name, shortName: form.shortName, weeklyMinutes: hoursToMinutes(form.weeklyHours), validFrom: form.validFrom },
  }), de.common.saved)
  if (ok) Object.assign(form, { name: '', shortName: '' })
}

function move(id: number, direction: 'up' | 'down') {
  run(() => $fetch(`/api/employees/${id}/move`, { method: 'POST', body: { direction } }))
}
</script>

<template>
  <div class="max-w-4xl space-y-4">
    <h1 class="text-2xl font-semibold">{{ de.employees.title }}</h1>
    <table class="w-full overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
      <thead class="bg-gray-100 text-left text-xs text-gray-600">
        <tr>
          <th class="px-3 py-2">{{ de.employees.name }}</th>
          <th class="px-3 py-2">{{ de.employees.shortName }}</th>
          <th class="px-3 py-2">{{ de.employees.weeklyHours }}</th>
          <th class="px-3 py-2">{{ de.employees.leftOn }}</th>
          <th class="px-3 py-2 text-right">{{ de.employees.order }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(employee, index) in list ?? []" :key="employee.id" class="border-t border-gray-100">
          <td class="px-3 py-2">
            <NuxtLink :to="`/admin/employees/${employee.id}`" class="text-sky-700 hover:underline">{{ employee.name }}</NuxtLink>
          </td>
          <td class="px-3 py-2">{{ employee.shortName }}</td>
          <td class="px-3 py-2">{{ formatHours(employee.currentWeeklyMinutes) }}</td>
          <td class="px-3 py-2">{{ employee.leftOn ? formatDate(employee.leftOn) : '' }}</td>
          <td class="px-3 py-2 text-right">
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-up" :aria-label="de.employees.moveUp" :disabled="index === 0" @click="move(employee.id, 'up')" />
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-down" :aria-label="de.employees.moveDown" :disabled="index === (list?.length ?? 0) - 1" @click="move(employee.id, 'down')" />
          </td>
        </tr>
      </tbody>
    </table>
    <form class="grid gap-3 rounded-lg bg-white p-4 ring-1 ring-gray-200 sm:grid-cols-5 sm:items-end" @submit.prevent="create">
      <h2 class="font-semibold sm:col-span-5">{{ de.employees.create }}</h2>
      <UFormField :label="de.employees.name" class="sm:col-span-2"><UInput v-model="form.name" class="w-full" required /></UFormField>
      <UFormField :label="de.employees.shortName"><UInput v-model="form.shortName" maxlength="10" class="w-full" /></UFormField>
      <UFormField :label="de.employees.weeklyHours"><UInput v-model.number="form.weeklyHours" type="number" step="0.25" min="0" class="w-full" /></UFormField>
      <UFormField :label="de.employees.validFrom"><UInput v-model="form.validFrom" type="date" class="w-full" required /></UFormField>
      <div class="sm:col-span-5"><UButton type="submit" icon="i-lucide-plus" :label="de.common.add" /></div>
    </form>
  </div>
</template>
```

- [ ] **Step 2: Write the detail page**

`app/pages/admin/employees/[id].vue`:
```vue
<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import { formatSignedDuration, parseDuration } from '#shared/domain/time'
import type { EmployeeDetailDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { balanceClass } from '~/utils/colors'
import { formatDate, formatHours, formatNumber, hoursToMinutes } from '~/utils/format'

const route = useRoute()
const id = Number(route.params.id)
const { data: employee, refresh } = await useFetch<EmployeeDetailDto>(`/api/employees/${id}`)
const run = useAction(refresh)
const toast = useToast()

const master = reactive({ name: '', shortName: '', leftOn: '' })
watch(employee, (value) => {
  if (value) Object.assign(master, { name: value.name, shortName: value.shortName, leftOn: value.leftOn ?? '' })
}, { immediate: true })

const hoursForm = reactive({ weeklyHours: 39, validFrom: todayIso() })
const adjustmentForm = reactive({ date: todayIso(), sign: 1, amount: '', reason: '' })
const entitlementForm = reactive({ year: parseIsoDate(todayIso()).year, days: 30, carriedOverDays: 0 })

function saveMaster() {
  run(() => $fetch(`/api/employees/${id}`, {
    method: 'PUT', body: { name: master.name, shortName: master.shortName, leftOn: master.leftOn || null },
  }), de.common.saved)
}

function addHours() {
  run(() => $fetch(`/api/employees/${id}/hours`, {
    method: 'POST', body: { weeklyMinutes: hoursToMinutes(hoursForm.weeklyHours), validFrom: hoursForm.validFrom },
  }), de.common.saved)
}

function deleteHours(hoursId: number) {
  if (window.confirm(de.common.confirmDelete)) run(() => $fetch(`/api/employee-hours/${hoursId}`, { method: 'DELETE' }))
}

async function addAdjustment() {
  const minutes = parseDuration(adjustmentForm.amount)
  if (minutes === null) {
    toast.add({ title: de.employees.invalidDuration, color: 'error' })
    return
  }
  const ok = await run(() => $fetch(`/api/employees/${id}/adjustments`, {
    method: 'POST',
    body: { date: adjustmentForm.date, minutes: minutes * adjustmentForm.sign, reason: adjustmentForm.reason },
  }), de.common.saved)
  if (ok) Object.assign(adjustmentForm, { amount: '', reason: '' })
}

function deleteAdjustment(adjustmentId: number) {
  if (window.confirm(de.common.confirmDelete)) run(() => $fetch(`/api/balance-adjustments/${adjustmentId}`, { method: 'DELETE' }))
}

function saveEntitlement() {
  run(() => $fetch(`/api/employees/${id}/leave/${entitlementForm.year}`, {
    method: 'PUT', body: { days: entitlementForm.days, carriedOverDays: entitlementForm.carriedOverDays },
  }), de.common.saved)
}

function editEntitlement(entitlement: EmployeeDetailDto['entitlements'][number]) {
  Object.assign(entitlementForm, { year: entitlement.year, days: entitlement.days, carriedOverDays: entitlement.carriedOverDays })
}
</script>

<template>
  <div v-if="employee" class="max-w-4xl space-y-4">
    <NuxtLink to="/admin/employees" class="text-sm text-sky-700 hover:underline">← {{ de.employees.back }}</NuxtLink>
    <h1 class="text-2xl font-semibold">{{ employee.name }}</h1>

    <form class="grid gap-3 rounded-lg bg-white p-4 ring-1 ring-gray-200 sm:grid-cols-4 sm:items-end" @submit.prevent="saveMaster">
      <h2 class="font-semibold sm:col-span-4">{{ de.employees.masterData }}</h2>
      <UFormField :label="de.employees.name" class="sm:col-span-2"><UInput v-model="master.name" class="w-full" required /></UFormField>
      <UFormField :label="de.employees.shortName"><UInput v-model="master.shortName" maxlength="10" class="w-full" /></UFormField>
      <UFormField :label="de.employees.leftOn"><UInput v-model="master.leftOn" type="date" class="w-full" /></UFormField>
      <div class="sm:col-span-4"><UButton type="submit" :label="de.common.save" /></div>
    </form>

    <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ de.employees.hoursHistory }}</h2>
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-gray-500"><tr><th>{{ de.employees.validFrom }}</th><th>{{ de.employees.weeklyHours }}</th><th /></tr></thead>
        <tbody>
          <tr v-for="period in employee.hours" :key="period.id" class="border-t border-gray-100">
            <td class="py-1">{{ formatDate(period.validFrom) }}</td>
            <td class="py-1">{{ formatHours(period.weeklyMinutes) }}</td>
            <td class="py-1 text-right"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" @click="deleteHours(period.id)" /></td>
          </tr>
        </tbody>
      </table>
      <form class="flex flex-wrap items-end gap-3" @submit.prevent="addHours">
        <UFormField :label="de.employees.weeklyHours"><UInput v-model.number="hoursForm.weeklyHours" type="number" step="0.25" min="0" /></UFormField>
        <UFormField :label="de.employees.validFrom"><UInput v-model="hoursForm.validFrom" type="date" required /></UFormField>
        <UButton type="submit" icon="i-lucide-plus" :label="de.employees.addHours" />
      </form>
    </section>

    <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ de.employees.adjustments }}</h2>
      <p class="text-xs text-gray-500">{{ de.employees.adjustmentsHint }}</p>
      <p v-if="employee.adjustments.length === 0" class="text-sm text-gray-500">{{ de.employees.noEntries }}</p>
      <table v-else class="w-full text-sm">
        <tbody>
          <tr v-for="adjustment in employee.adjustments" :key="adjustment.id" class="border-t border-gray-100">
            <td class="py-1">{{ formatDate(adjustment.date) }}</td>
            <td class="py-1 font-medium" :class="balanceClass(adjustment.minutes)">{{ formatSignedDuration(adjustment.minutes) }}</td>
            <td class="py-1">{{ adjustment.reason }}</td>
            <td class="py-1 text-right"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" @click="deleteAdjustment(adjustment.id)" /></td>
          </tr>
        </tbody>
      </table>
      <form class="flex flex-wrap items-end gap-3" @submit.prevent="addAdjustment">
        <UFormField :label="de.employees.date"><UInput v-model="adjustmentForm.date" type="date" required /></UFormField>
        <UFormField :label="de.employees.sign">
          <select v-model.number="adjustmentForm.sign" class="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm">
            <option :value="1">{{ de.employees.plus }}</option>
            <option :value="-1">{{ de.employees.minus }}</option>
          </select>
        </UFormField>
        <UFormField :label="de.employees.amount"><UInput v-model="adjustmentForm.amount" placeholder="12:30" required /></UFormField>
        <UFormField :label="de.employees.reason"><UInput v-model="adjustmentForm.reason" maxlength="200" required /></UFormField>
        <UButton type="submit" icon="i-lucide-plus" :label="de.employees.addAdjustment" />
      </form>
    </section>

    <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ de.employees.entitlements }}</h2>
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-gray-500"><tr><th>{{ de.employees.year }}</th><th>{{ de.employees.days }}</th><th>{{ de.employees.carriedOver }}</th><th /></tr></thead>
        <tbody>
          <tr v-for="entitlement in employee.entitlements" :key="entitlement.id" class="border-t border-gray-100">
            <td class="py-1">{{ entitlement.year }}</td>
            <td class="py-1">{{ formatNumber(entitlement.days) }}</td>
            <td class="py-1">{{ formatNumber(entitlement.carriedOverDays) }}</td>
            <td class="py-1 text-right"><UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="de.common.edit" @click="editEntitlement(entitlement)" /></td>
          </tr>
        </tbody>
      </table>
      <form class="flex flex-wrap items-end gap-3" @submit.prevent="saveEntitlement">
        <UFormField :label="de.employees.year"><UInput v-model.number="entitlementForm.year" type="number" min="2000" max="2100" /></UFormField>
        <UFormField :label="de.employees.days"><UInput v-model.number="entitlementForm.days" type="number" step="0.5" min="0" /></UFormField>
        <UFormField :label="de.employees.carriedOver"><UInput v-model.number="entitlementForm.carriedOverDays" type="number" step="0.5" min="0" /></UFormField>
        <UButton type="submit" :label="de.employees.saveEntitlement" />
      </form>
    </section>
  </div>
</template>
```

- [ ] **Step 3: Verify in the browser**

Expected on `/admin/employees`: creating „Anna, AN, 39, 01.01.2026“ adds a row with „39“ Wochenstunden; arrows reorder rows and the plan columns follow. On the detail page: saving master data works; adding „30 ab 01.03.2027“ appears in the history; deleting the last remaining period shows „Der letzte Wochenstunden-Eintrag kann nicht gelöscht werden.“; a booking „Plus 12:30 Übertrag“ shows „+12:30“ in green and changes „Saldo heute“ in the plan sidebar by the same amount; „12,5“ in the amount field shows the h:mm hint; entitlement 30 / 3 for 2026 appears and is used on „Mein Urlaub“.

- [ ] **Step 4: Typecheck and commit**

Run: `npm run typecheck` — Expected: no errors.
```
git add -A
git commit -m "feat: add admin pages for employees, hours, bookings and leave entitlement"
```

---

### Task 21: Admin overviews (balances, leave, closures)

**Files:**
- Create: `app/pages/admin/balances.vue`, `app/pages/admin/leave.vue`, `app/pages/admin/closures.vue`

**Interfaces:**
- Consumes: `GET /api/balances?year&month`, `GET /api/leave?year`, `GET|POST /api/closures`, `DELETE /api/closures/:id`

- [ ] **Step 1: Write the pages**

`app/pages/admin/balances.vue`:
```vue
<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import { formatSignedDuration } from '#shared/domain/time'
import type { BalanceDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { balanceClass } from '~/utils/colors'
import { formatHours } from '~/utils/format'

const today = parseIsoDate(todayIso())
const year = ref(today.year)
const month = ref(today.month)
const { data } = await useFetch<BalanceDto[]>('/api/balances', { query: { year, month } })

function change(nextYear: number, nextMonth: number) {
  year.value = nextYear
  month.value = nextMonth
}
</script>

<template>
  <div class="max-w-3xl space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <span class="text-2xl font-semibold">{{ de.balances.title }}</span>
      <MonthNav :year="year" :month="month" @change="change" />
    </div>
    <table class="w-full overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
      <thead class="bg-gray-100 text-left text-xs text-gray-600">
        <tr>
          <th class="px-3 py-2">{{ de.balances.name }}</th>
          <th class="px-3 py-2">{{ de.balances.weekly }}</th>
          <th class="px-3 py-2 text-right">{{ de.balances.today }}</th>
          <th class="px-3 py-2 text-right">{{ de.balances.monthEnd }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="balance in data ?? []" :key="balance.employeeId" class="border-t border-gray-100">
          <td class="px-3 py-2">{{ balance.name }}</td>
          <td class="px-3 py-2">{{ formatHours(balance.weeklyMinutes) }}</td>
          <td class="px-3 py-2 text-right font-medium" :class="balanceClass(balance.today)">{{ formatSignedDuration(balance.today) }}</td>
          <td class="px-3 py-2 text-right font-medium" :class="balanceClass(balance.monthEnd)">{{ formatSignedDuration(balance.monthEnd) }}</td>
        </tr>
      </tbody>
    </table>
    <p class="text-xs text-gray-500">{{ de.balances.hint }}</p>
  </div>
</template>
```

`app/pages/admin/leave.vue`:
```vue
<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import type { LeaveAccountDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatNumber } from '~/utils/format'

const year = ref(parseIsoDate(todayIso()).year)
const { data } = await useFetch<LeaveAccountDto[]>('/api/leave', { query: { year } })
</script>

<template>
  <div class="max-w-4xl space-y-4">
    <div class="flex items-center gap-3">
      <h1 class="text-2xl font-semibold">{{ de.leave.title }}</h1>
      <YearNav v-model="year" />
    </div>
    <table class="w-full overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
      <thead class="bg-gray-100 text-left text-xs text-gray-600">
        <tr>
          <th class="px-3 py-2">{{ de.leave.name }}</th>
          <th class="px-3 py-2 text-right">{{ de.leave.entitlement }}</th>
          <th class="px-3 py-2 text-right">{{ de.leave.carriedOver }}</th>
          <th class="px-3 py-2 text-right">{{ de.leave.taken }}</th>
          <th class="px-3 py-2 text-right">{{ de.leave.planned }}</th>
          <th class="px-3 py-2 text-right">{{ de.leave.available }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in data ?? []" :key="row.employeeId" class="border-t border-gray-100">
          <td class="px-3 py-2">
            <NuxtLink :to="`/admin/employees/${row.employeeId}`" class="text-sky-700 hover:underline">{{ row.name }}</NuxtLink>
          </td>
          <td class="px-3 py-2 text-right">{{ formatNumber(row.account.entitlement) }}</td>
          <td class="px-3 py-2 text-right">{{ formatNumber(row.account.carriedOver) }}</td>
          <td class="px-3 py-2 text-right">{{ formatNumber(row.account.taken) }}</td>
          <td class="px-3 py-2 text-right">{{ formatNumber(row.account.planned) }}</td>
          <td class="px-3 py-2 text-right font-semibold" :class="row.account.available < 0 ? 'text-red-700' : ''">{{ formatNumber(row.account.available) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
```

`app/pages/admin/closures.vue`:
```vue
<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { ClosureDto, ClosureMode } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

const { data: list, refresh } = await useFetch<ClosureDto[]>('/api/closures')
const run = useAction(refresh)
const form = reactive<{ startDate: string; endDate: string; label: string; mode: ClosureMode }>({
  startDate: todayIso(), endDate: todayIso(), label: '', mode: 'vacation',
})
const modeItems = (['vacation', 'closure_day'] as const).map(mode => ({ label: de.closures.modes[mode], value: mode }))

async function create() {
  const ok = await run(() => $fetch('/api/closures', { method: 'POST', body: { ...form } }), de.common.saved)
  if (ok) form.label = ''
}

function remove(closure: ClosureDto) {
  if (window.confirm(de.closures.confirmDelete)) run(() => $fetch(`/api/closures/${closure.id}`, { method: 'DELETE' }), de.common.deleted)
}
</script>

<template>
  <div class="max-w-4xl space-y-4">
    <h1 class="text-2xl font-semibold">{{ de.closures.title }}</h1>
    <p v-if="!list?.length" class="text-sm text-gray-500">{{ de.closures.empty }}</p>
    <table v-else class="w-full overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
      <thead class="bg-gray-100 text-left text-xs text-gray-600">
        <tr><th class="px-3 py-2">{{ de.closures.from }}</th><th class="px-3 py-2">{{ de.closures.to }}</th><th class="px-3 py-2">{{ de.closures.label }}</th><th class="px-3 py-2">{{ de.closures.mode }}</th><th /></tr>
      </thead>
      <tbody>
        <tr v-for="closure in list" :key="closure.id" class="border-t border-gray-100">
          <td class="px-3 py-2">{{ formatDate(closure.startDate) }}</td>
          <td class="px-3 py-2">{{ formatDate(closure.endDate) }}</td>
          <td class="px-3 py-2">{{ closure.label }}</td>
          <td class="px-3 py-2">{{ de.closures.modes[closure.mode] }}</td>
          <td class="px-3 py-2 text-right"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" @click="remove(closure)" /></td>
        </tr>
      </tbody>
    </table>
    <form class="grid gap-3 rounded-lg bg-white p-4 ring-1 ring-gray-200 sm:grid-cols-4 sm:items-end" @submit.prevent="create">
      <h2 class="font-semibold sm:col-span-4">{{ de.closures.create }}</h2>
      <p class="text-xs text-gray-500 sm:col-span-4">{{ de.closures.hint }}</p>
      <UFormField :label="de.closures.from"><UInput v-model="form.startDate" type="date" class="w-full" required /></UFormField>
      <UFormField :label="de.closures.to"><UInput v-model="form.endDate" type="date" class="w-full" required /></UFormField>
      <UFormField :label="de.closures.label"><UInput v-model="form.label" maxlength="100" class="w-full" required /></UFormField>
      <UFormField :label="de.closures.mode"><USelect v-model="form.mode" :items="modeItems" class="w-full" /></UFormField>
      <div class="sm:col-span-4"><UButton type="submit" icon="i-lucide-plus" :label="de.common.add" /></div>
    </form>
  </div>
</template>
```

- [ ] **Step 2: Verify in the browser**

Expected: „Stundenkonten“ lists all employees of the month with signed, colored balances and follows the month arrows. „Urlaub“ lists the five numbers per employee, negative „frei verfügbar“ in red. Creating „Sommerschließzeit 10.08.–28.08.2026, Urlaub“ fills August in the plan with grey „Urlaub“ entries on weekdays, the date column shows the label, and the warnings for those days disappear; deleting it removes the untouched entries again.

- [ ] **Step 3: Typecheck and commit**

Run: `npm run typecheck` — Expected: no errors.
```
git add -A
git commit -m "feat: add admin overviews for balances, leave and closures"
```

---

### Task 22: Settings, users and backups

**Files:**
- Create: `server/services/backup.ts`, `server/api/backup.get.ts`, `app/pages/admin/settings.vue`, `app/pages/admin/users.vue`
- Modify: `server/plugins/database.ts`
- Test: `tests/services/backup.test.ts`

**Interfaces:**
- Consumes: settings and users endpoints (Task 15), `useSqlite()`
- Produces: `createBackup(sqlite, file): Promise<void>`, `runDailyBackup(sqlite, dir, today, keep = 14): Promise<string | null>`; `GET /api/backup` (admin) → SQLite file download

- [ ] **Step 1: Write the failing backup test**

`tests/services/backup.test.ts`:
```ts
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDb, migrateDb } from '../../server/db/client'
import { runDailyBackup } from '../../server/services/backup'

describe('runDailyBackup', () => {
  it('creates one backup per day and keeps the newest 14', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dienstplan-backup-'))
    const { db, sqlite } = createDb(join(dir, 'source', 'app.db'))
    migrateDb(db, 'server/db/migrations')
    const backups = join(dir, 'backups')

    const first = await runDailyBackup(sqlite, backups, '2026-10-05')
    expect(first).toBe(join(backups, 'app-2026-10-05.db'))
    expect(await runDailyBackup(sqlite, backups, '2026-10-05')).toBeNull()

    for (let day = 1; day <= 20; day++) writeFileSync(join(backups, `app-2026-09-${String(day).padStart(2, '0')}.db`), '')
    await runDailyBackup(sqlite, backups, '2026-10-06')
    const files = readdirSync(backups).sort()
    expect(files).toHaveLength(14)
    expect(files.at(-1)).toBe('app-2026-10-06.db')
    expect(files[0]).toBe('app-2026-09-09.db')
    sqlite.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/backup.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the backup service, endpoint and nightly job**

`server/services/backup.ts`:
```ts
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import type { IsoDate } from '../../shared/domain/types'

const BACKUP_NAME = /^app-\d{4}-\d{2}-\d{2}\.db$/

export async function createBackup(sqlite: Database.Database, file: string): Promise<void> {
  await sqlite.backup(file)
}

/** Writes `app-<today>.db` once per day into `dir` and deletes all but the newest `keep` backups. */
export async function runDailyBackup(
  sqlite: Database.Database, dir: string, today: IsoDate, keep = 14,
): Promise<string | null> {
  await mkdir(dir, { recursive: true })
  const name = `app-${today}.db`
  if ((await readdir(dir)).includes(name)) return null
  const file = join(dir, name)
  await createBackup(sqlite, file)
  const backups = (await readdir(dir)).filter(entry => BACKUP_NAME.test(entry)).sort()
  for (const old of backups.slice(0, Math.max(0, backups.length - keep))) await rm(join(dir, old))
  return file
}
```

`server/api/backup.get.ts`:
```ts
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { todayIso } from '../../shared/domain/dates'
import { createBackup } from '../services/backup'

export default defineServiceHandler(async (event) => {
  await requireAdmin(event)
  const file = join(tmpdir(), `dienstplan-${Date.now()}.db`)
  await createBackup(useSqlite(), file)
  const data = await readFile(file)
  await rm(file)
  setResponseHeaders(event, {
    'Content-Type': 'application/vnd.sqlite3',
    'Content-Disposition': `attachment; filename="dienstplan-${todayIso()}.db"`,
  })
  return data
})
```

Replace `server/plugins/database.ts` with:
```ts
import { todayIso } from '../../shared/domain/dates'
import { migrateDb } from '../db/client'
import { ensureInitialAdmin, seedDefaults } from '../db/seed'
import { runDailyBackup } from '../services/backup'

const HOUR_MS = 60 * 60 * 1000

export default defineNitroPlugin(() => {
  const db = useDb()
  migrateDb(db, process.env.MIGRATIONS_DIR || 'server/db/migrations')
  seedDefaults(db)
  if (ensureInitialAdmin(db, process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD)) {
    console.info(`Initial admin "${process.env.ADMIN_USERNAME}" created.`)
  }

  const backupDir = process.env.BACKUP_DIR
  if (backupDir) {
    const backup = () => runDailyBackup(useSqlite(), backupDir, todayIso())
      .then(file => file && console.info(`Backup written: ${file}`))
      .catch(error => console.error('Backup failed', error))
    void backup()
    setInterval(backup, HOUR_MS).unref()
  }
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/services/backup.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the settings page**

`app/pages/admin/settings.vue`:
```vue
<script setup lang="ts">
import { parseTime, toTimeInput } from '#shared/domain/time'
import type { CreditMode } from '#shared/domain/types'
import { COLOR_KEYS, type CodeDto, type CoverageRuleDto, type SettingsDto, type TemplateDto } from '#shared/types/api'
import { de } from '~/locales/de'

interface TemplateForm {
  id: number | null; shortLabel: string; label: string; start: string; end: string
  breakStart: string; breakEnd: string; countsAsStaff: boolean; sortOrder: number
}
interface RuleForm { id: number | null; label: string; start: string; end: string; minCount: number; active: boolean }

const { data: settings, refresh } = await useFetch<SettingsDto>('/api/settings')
const run = useAction(refresh)
const toast = useToast()

const timeText = (minutes: number | null) => (minutes === null ? '' : toTimeInput(minutes))
const optionalTime = (value: string) => (value ? parseTime(value) : null)

const emptyTemplate = (): TemplateForm => ({ id: null, shortLabel: '', label: '', start: '', end: '', breakStart: '', breakEnd: '', countsAsStaff: true, sortOrder: 99 })
const emptyRule = (): RuleForm => ({ id: null, label: '', start: '', end: '', minCount: 1, active: true })

const templates = ref<TemplateForm[]>([])
const codes = ref<CodeDto[]>([])
const rules = ref<RuleForm[]>([])
const newTemplate = ref(emptyTemplate())
const newRule = ref(emptyRule())

watch(settings, (value) => {
  templates.value = (value?.templates ?? []).map((t: TemplateDto) => ({
    id: t.id, shortLabel: t.shortLabel, label: t.label, start: timeText(t.start), end: timeText(t.end),
    breakStart: timeText(t.breakStart), breakEnd: timeText(t.breakEnd), countsAsStaff: t.countsAsStaff, sortOrder: t.sortOrder,
  }))
  codes.value = (value?.codes ?? []).map(code => ({ ...code }))
  rules.value = (value?.coverageRules ?? []).map((r: CoverageRuleDto) => ({
    id: r.id, label: r.label, start: timeText(r.start), end: timeText(r.end), minCount: r.minCount, active: r.active,
  }))
}, { immediate: true })

const colorItems = COLOR_KEYS.map(color => ({ label: de.colors[color], value: color }))
const creditItems = (['daily_target', 'timed', 'none'] as CreditMode[]).map(mode => ({ label: de.creditModes[mode], value: mode }))

function invalidTime() {
  toast.add({ title: de.settings.invalidTime, color: 'error' })
}

async function saveTemplate(form: TemplateForm) {
  const start = parseTime(form.start)
  const end = parseTime(form.end)
  if (start === null || end === null) return invalidTime()
  const body = {
    shortLabel: form.shortLabel, label: form.label, start, end,
    breakStart: optionalTime(form.breakStart), breakEnd: optionalTime(form.breakEnd),
    countsAsStaff: form.countsAsStaff, sortOrder: form.sortOrder,
  }
  const ok = await run(() => form.id
    ? $fetch(`/api/shift-templates/${form.id}`, { method: 'PUT', body })
    : $fetch('/api/shift-templates', { method: 'POST', body }), de.common.saved)
  if (ok && !form.id) newTemplate.value = emptyTemplate()
}

function deleteTemplate(form: TemplateForm) {
  if (form.id && window.confirm(de.common.confirmDelete)) run(() => $fetch(`/api/shift-templates/${form.id}`, { method: 'DELETE' }), de.common.deleted)
}

function saveCode(code: CodeDto) {
  run(() => $fetch(`/api/absence-codes/${code.id}`, {
    method: 'PUT', body: { label: code.label, color: code.color, creditMode: code.creditMode },
  }), de.common.saved)
}

async function saveRule(form: RuleForm) {
  const start = parseTime(form.start)
  if (start === null) return invalidTime()
  const body = { label: form.label, start, end: optionalTime(form.end), minCount: form.minCount, active: form.active }
  const ok = await run(() => form.id
    ? $fetch(`/api/coverage-rules/${form.id}`, { method: 'PUT', body })
    : $fetch('/api/coverage-rules', { method: 'POST', body }), de.common.saved)
  if (ok && !form.id) newRule.value = emptyRule()
}

function deleteRule(form: RuleForm) {
  if (form.id && window.confirm(de.common.confirmDelete)) run(() => $fetch(`/api/coverage-rules/${form.id}`, { method: 'DELETE' }), de.common.deleted)
}

const cell = 'px-1 py-1'
const timeInput = 'w-24 rounded border border-gray-300 px-1 py-0.5'
const textInput = 'w-full rounded border border-gray-300 px-1 py-0.5'
</script>

<template>
  <div class="max-w-6xl space-y-6">
    <h1 class="text-2xl font-semibold">{{ de.settings.title }}</h1>

    <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ de.settings.templates }}</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-left text-xs text-gray-500">
            <tr>
              <th :class="cell">{{ de.settings.shortLabel }}</th><th :class="cell">{{ de.settings.label }}</th>
              <th :class="cell">{{ de.settings.start }}</th><th :class="cell">{{ de.settings.end }}</th>
              <th :class="cell">{{ de.settings.breakStart }}</th><th :class="cell">{{ de.settings.breakEnd }}</th>
              <th :class="cell">{{ de.settings.countsAsStaff }}</th><th :class="cell">{{ de.settings.sortOrder }}</th><th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="form in [...templates, newTemplate]" :key="form.id ?? 'new'" class="border-t border-gray-100">
              <td :class="cell"><input v-model="form.shortLabel" maxlength="10" class="w-14 rounded border border-gray-300 px-1 py-0.5"></td>
              <td :class="cell"><input v-model="form.label" maxlength="50" :class="textInput"></td>
              <td :class="cell"><input v-model="form.start" type="time" step="300" :class="timeInput"></td>
              <td :class="cell"><input v-model="form.end" type="time" step="300" :class="timeInput"></td>
              <td :class="cell"><input v-model="form.breakStart" type="time" step="300" :class="timeInput"></td>
              <td :class="cell"><input v-model="form.breakEnd" type="time" step="300" :class="timeInput"></td>
              <td :class="cell" class="text-center"><input v-model="form.countsAsStaff" type="checkbox"></td>
              <td :class="cell"><input v-model.number="form.sortOrder" type="number" class="w-14 rounded border border-gray-300 px-1 py-0.5"></td>
              <td :class="cell" class="whitespace-nowrap text-right">
                <UButton size="xs" :label="form.id ? de.common.save : de.settings.addTemplate" @click="saveTemplate(form)" />
                <UButton v-if="form.id" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" @click="deleteTemplate(form)" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ de.settings.codes }}</h2>
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-gray-500">
          <tr><th :class="cell">{{ de.settings.label }}</th><th :class="cell">{{ de.settings.color }}</th><th :class="cell">{{ de.settings.creditMode }}</th><th /></tr>
        </thead>
        <tbody>
          <tr v-for="code in codes" :key="code.id" class="border-t border-gray-100">
            <td :class="cell"><input v-model="code.label" maxlength="50" :class="textInput"></td>
            <td :class="cell"><USelect v-model="code.color" :items="colorItems" class="w-32" /></td>
            <td :class="cell"><USelect v-model="code.creditMode" :items="creditItems" class="w-44" /></td>
            <td :class="cell" class="text-right"><UButton size="xs" :label="de.common.save" @click="saveCode(code)" /></td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ de.settings.rules }}</h2>
      <p class="text-xs text-gray-500">{{ de.settings.rulesHint }}</p>
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-gray-500">
          <tr>
            <th :class="cell">{{ de.settings.label }}</th><th :class="cell">{{ de.settings.ruleStart }}</th>
            <th :class="cell">{{ de.settings.ruleEnd }}</th><th :class="cell">{{ de.settings.minCount }}</th>
            <th :class="cell">{{ de.settings.active }}</th><th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="form in [...rules, newRule]" :key="form.id ?? 'new'" class="border-t border-gray-100">
            <td :class="cell"><input v-model="form.label" maxlength="100" :class="textInput"></td>
            <td :class="cell"><input v-model="form.start" type="time" step="300" :class="timeInput"></td>
            <td :class="cell"><input v-model="form.end" type="time" step="300" :class="timeInput"></td>
            <td :class="cell"><input v-model.number="form.minCount" type="number" min="1" max="20" class="w-16 rounded border border-gray-300 px-1 py-0.5"></td>
            <td :class="cell" class="text-center"><input v-model="form.active" type="checkbox"></td>
            <td :class="cell" class="whitespace-nowrap text-right">
              <UButton size="xs" :label="form.id ? de.common.save : de.settings.addRule" @click="saveRule(form)" />
              <UButton v-if="form.id" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" @click="deleteRule(form)" />
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ de.settings.backup }}</h2>
      <p class="text-sm text-gray-600">{{ de.settings.backupHint }}</p>
      <a href="/api/backup" download class="inline-flex items-center gap-1 rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
        <UIcon name="i-lucide-download" /> {{ de.settings.backupDownload }}
      </a>
    </section>
  </div>
</template>
```

- [ ] **Step 6: Write the users page**

`app/pages/admin/users.vue`:
```vue
<script setup lang="ts">
import type { EmployeeListItemDto, Role, UserDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDateTime } from '~/utils/format'

const { data: users, refresh } = await useFetch<UserDto[]>('/api/users')
const { data: employees } = await useFetch<EmployeeListItemDto[]>('/api/employees')
const run = useAction(refresh)

const rows = ref<UserDto[]>([])
watch(users, value => (rows.value = (value ?? []).map(user => ({ ...user }))), { immediate: true })

const roleItems = (['admin', 'observer'] as Role[]).map(role => ({ label: de.users.roles[role], value: role }))
const form = reactive<{ username: string; password: string; role: Role; employeeId: number | null }>({
  username: '', password: '', role: 'observer', employeeId: null,
})

const resetTarget = ref<UserDto | null>(null)
const resetValue = ref('')
const resetOpen = computed({
  get: () => resetTarget.value !== null,
  set: (open) => { if (!open) resetTarget.value = null },
})

async function create() {
  const ok = await run(() => $fetch('/api/users', { method: 'POST', body: { ...form } }), de.common.saved)
  if (ok) Object.assign(form, { username: '', password: '', employeeId: null })
}

function save(user: UserDto) {
  run(() => $fetch(`/api/users/${user.id}`, {
    method: 'PUT', body: { role: user.role, employeeId: user.employeeId, active: user.active },
  }), de.common.saved)
}

function openReset(user: UserDto) {
  resetValue.value = ''
  resetTarget.value = user
}

async function submitReset() {
  const target = resetTarget.value
  if (!target) return
  const ok = await run(() => $fetch(`/api/users/${target.id}/reset-password`, { method: 'POST', body: { password: resetValue.value } }), de.common.saved)
  if (ok) resetTarget.value = null
}

const selectClass = 'h-8 rounded-md border border-gray-300 bg-white px-2 text-sm'
</script>

<template>
  <div class="max-w-5xl space-y-4">
    <h1 class="text-2xl font-semibold">{{ de.users.title }}</h1>
    <table class="w-full overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
      <thead class="bg-gray-100 text-left text-xs text-gray-600">
        <tr>
          <th class="px-3 py-2">{{ de.users.username }}</th><th class="px-3 py-2">{{ de.users.role }}</th>
          <th class="px-3 py-2">{{ de.users.employee }}</th><th class="px-3 py-2">{{ de.users.active }}</th>
          <th class="px-3 py-2">{{ de.users.status }}</th><th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="user in rows" :key="user.id" class="border-t border-gray-100">
          <td class="px-3 py-2 font-medium">{{ user.username }}</td>
          <td class="px-3 py-2"><USelect v-model="user.role" :items="roleItems" class="w-40" /></td>
          <td class="px-3 py-2">
            <select v-model="user.employeeId" :class="selectClass">
              <option :value="null">{{ de.users.noEmployee }}</option>
              <option v-for="employee in employees ?? []" :key="employee.id" :value="employee.id">{{ employee.name }}</option>
            </select>
          </td>
          <td class="px-3 py-2 text-center"><input v-model="user.active" type="checkbox"></td>
          <td class="px-3 py-2 text-xs text-gray-500">
            <div v-if="user.mustChangePassword">{{ de.users.mustChange }}</div>
            <div v-if="user.lockedUntil && user.lockedUntil > new Date().toISOString()">{{ de.users.locked(formatDateTime(user.lockedUntil)) }}</div>
          </td>
          <td class="whitespace-nowrap px-3 py-2 text-right">
            <UButton size="xs" :label="de.common.save" @click="save(user)" />
            <UButton size="xs" color="neutral" variant="ghost" :label="de.users.resetPassword" @click="openReset(user)" />
          </td>
        </tr>
      </tbody>
    </table>

    <form class="grid gap-3 rounded-lg bg-white p-4 ring-1 ring-gray-200 sm:grid-cols-4 sm:items-end" @submit.prevent="create">
      <h2 class="font-semibold sm:col-span-4">{{ de.users.create }}</h2>
      <UFormField :label="de.users.username"><UInput v-model="form.username" autocomplete="off" class="w-full" required /></UFormField>
      <UFormField :label="de.users.password"><UInput v-model="form.password" type="password" autocomplete="new-password" class="w-full" required /></UFormField>
      <UFormField :label="de.users.role"><USelect v-model="form.role" :items="roleItems" class="w-full" /></UFormField>
      <UFormField :label="de.users.employee">
        <select v-model="form.employeeId" :class="[selectClass, 'w-full']">
          <option :value="null">{{ de.users.noEmployee }}</option>
          <option v-for="employee in employees ?? []" :key="employee.id" :value="employee.id">{{ employee.name }}</option>
        </select>
      </UFormField>
      <div class="sm:col-span-4"><UButton type="submit" icon="i-lucide-plus" :label="de.common.add" /></div>
    </form>

    <UModal v-model:open="resetOpen" :title="`${de.users.resetPassword}: ${resetTarget?.username ?? ''}`">
      <template #body>
        <form class="space-y-3" @submit.prevent="submitReset">
          <UFormField :label="de.users.newPassword"><UInput v-model="resetValue" type="password" autocomplete="new-password" class="w-full" required /></UFormField>
          <p class="text-xs text-gray-500">{{ de.users.resetHint }}</p>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="resetOpen = false" />
            <UButton type="submit" :label="de.common.save" />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
```

- [ ] **Step 7: Verify in the browser**

Expected: „Einstellungen“ lists the five dienst-buttons F1, F2, M, S, HK with their times (HK without „zählt als Betreuungskraft“); changing M to 8:00–16:15 updates the toolbar button but leaves existing M entries unchanged; a break outside the time shows „Die Pause muss innerhalb der Arbeitszeit liegen.“; codes can change color/Anrechnung (e.g. „Büro“ → orange shows orange chips); coverage rules can be added/deactivated and the plan warnings follow; „Datenbank herunterladen“ downloads `dienstplan-YYYY-MM-DD.db`. „Benutzer“: creating an observer without employee shows „Beobachter müssen mit einem Mitarbeiter verknüpft sein.“; demoting the only admin shows „Es muss mindestens ein aktiver Administrator bleiben.“; resetting a password forces a change on next login.

- [ ] **Step 8: Typecheck, test and commit**

Run: `npm run typecheck` then `npm test` — Expected: no type errors; all tests PASS.
```
git add -A
git commit -m "feat: add settings, user management and daily database backups"
```

---

### Task 23: Print view

**Files:**
- Create: `app/pages/print/[year]/[month].vue`
- Modify: `app/assets/css/main.css`

**Interfaces:**
- Consumes: `GET /api/plan/:y/:m`, `PlanGrid` (read-only), `monthTitle`

- [ ] **Step 1: Add print CSS**

Append to `app/assets/css/main.css`:
```css
@media print {
  @page {
    size: A4 landscape;
    margin: 8mm;
  }
  html {
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
    font-size: 11px;
  }
}
```

- [ ] **Step 2: Write the print page**

`app/pages/print/[year]/[month].vue`:
```vue
<script setup lang="ts">
import { formatTime } from '#shared/domain/time'
import type { MonthPlanDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { chipClasses } from '~/utils/colors'
import { errorMessage } from '~/utils/errors'
import { formatDateTime, monthTitle } from '~/utils/format'

definePageMeta({ layout: false })

const route = useRoute()
const year = Number(route.params.year)
const month = Number(route.params.month)
const { data: plan, error } = await useFetch<MonthPlanDto>(`/api/plan/${year}/${month}`)

function print() {
  window.print()
}
</script>

<template>
  <div class="bg-white p-4 text-gray-900">
    <div class="mb-3 flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-semibold">{{ monthTitle(year, month) }}</h1>
      <span v-if="plan?.release.releasedAt" class="text-sm text-gray-600">
        {{ de.plan.releasedAt(formatDateTime(plan.release.releasedAt), plan.release.releasedBy ?? '') }}
      </span>
      <UButton class="ml-auto print:hidden" icon="i-lucide-printer" :label="de.plan.printNow" @click="print" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <template v-if="plan">
      <PlanGrid :plan="plan" />
      <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span class="font-semibold">{{ de.plan.legend }}:</span>
        <span v-for="template in plan.templates" :key="template.id">
          {{ template.shortLabel }} = {{ template.label }} {{ formatTime(template.start) }}–{{ formatTime(template.end) }}
        </span>
        <span v-for="code in plan.codes" :key="code.id" class="inline-flex items-center gap-1">
          <span class="inline-block h-3 w-3 rounded-sm" :class="chipClasses[code.color]" /> {{ code.label }}
        </span>
      </div>
    </template>
  </div>
</template>
```

- [ ] **Step 3: Verify in the browser**

From `/plan/2026/10` click „Drucken“.
Expected: a new tab shows „Oktober 2026“, the full table with colors, the legend, no navigation, no toolbar, no warning column; „Jetzt drucken“ opens the print dialog with A4 landscape. As observer the print view has no week rows.

- [ ] **Step 4: Commit**

```
git add -A
git commit -m "feat: add printable month view"
```

---

### Task 24: Docker packaging and operating guide

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `deploy/Caddyfile`, `deploy/.env.example`, `docs/BETRIEB.md`, `README.md`

**Interfaces:**
- Consumes: `npm run build` output `.output/`, `server/db/migrations/`, env vars from Global Constraints
- Produces: an image that serves on port 3000, stores data in `/data`, writes nightly backups to `/data/backups`

- [ ] **Step 1: Write the Docker files**

`Dockerfile`:
```dockerfile
# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm ci && npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    TZ=Europe/Berlin \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/app.db \
    MIGRATIONS_DIR=/app/migrations \
    BACKUP_DIR=/data/backups
WORKDIR /app
COPY --from=build /app/.output ./.output
COPY --from=build /app/server/db/migrations ./migrations
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
```

`.dockerignore`:
```
node_modules
.nuxt
.output
.data
data
.git
.env
*.db
tests
docs
```

`docker-compose.yml`:
```yaml
services:
  dienstplan:
    build: .
    image: dienstplan:latest
    restart: unless-stopped
    environment:
      NUXT_SESSION_PASSWORD: ${NUXT_SESSION_PASSWORD:?NUXT_SESSION_PASSWORD fehlt in .env}
      ADMIN_USERNAME: ${ADMIN_USERNAME:-admin}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:?ADMIN_PASSWORD fehlt in .env}
      NUXT_SESSION_COOKIE_SECURE: ${NUXT_SESSION_COOKIE_SECURE:-true}
    volumes:
      - dienstplan-data:/data
    ports:
      - "127.0.0.1:3000:3000"

  caddy:
    image: caddy:2
    profiles: ["https"]
    restart: unless-stopped
    environment:
      DOMAIN: ${DOMAIN:?DOMAIN fehlt in .env}
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./deploy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      - dienstplan

volumes:
  dienstplan-data:
  caddy-data:
  caddy-config:
```

`deploy/Caddyfile`:
```
{$DOMAIN} {
	encode gzip
	reverse_proxy dienstplan:3000
}
```

`deploy/.env.example`:
```
# Copy to .env next to docker-compose.yml and fill in.
# At least 32 random characters, e.g. from a password manager.
NUXT_SESSION_PASSWORD=
ADMIN_USERNAME=admin
# Only used on the very first start; must be changed at first login.
ADMIN_PASSWORD=
# Domain for HTTPS via Caddy (docker compose --profile https up -d)
DOMAIN=dienstplan.example.org
# Set to false only if the app is reached without HTTPS (e.g. only inside the local network).
NUXT_SESSION_COOKIE_SECURE=true
```

- [ ] **Step 2: Write the operating guide (German, for non-technical readers)**

`docs/BETRIEB.md`:
````markdown
# Dienstplan – Betrieb auf dem Server

Diese Anleitung beschreibt, wie der Dienstplan auf einem eigenen Server läuft.
Du brauchst dafür einen Linux-Server mit installiertem **Docker** (inklusive „Docker Compose“).

## 1. Dateien auf den Server bringen

Kopiere den kompletten Projektordner auf den Server, z. B. nach `/opt/dienstplan`.

## 2. Einstellungen festlegen

1. Kopiere `deploy/.env.example` nach `/opt/dienstplan/.env`.
2. Trage ein:
   - `NUXT_SESSION_PASSWORD`: mindestens 32 zufällige Zeichen (z. B. aus einem Passwort-Manager).
   - `ADMIN_USERNAME` und `ADMIN_PASSWORD`: Zugang für die erste Anmeldung. Das Passwort muss beim ersten Login geändert werden.
   - `DOMAIN`: die Internetadresse, unter der der Dienstplan erreichbar sein soll.

## 3. Starten

```bash
cd /opt/dienstplan
docker compose --profile https up -d --build
```

Danach ist der Dienstplan unter `https://<DOMAIN>` erreichbar. Das HTTPS-Zertifikat holt Caddy automatisch.
Voraussetzung: Die Domain zeigt auf den Server, und die Ports 80 und 443 sind offen.

Ohne HTTPS nur im lokalen Netz: `NUXT_SESSION_COOKIE_SECURE=false` setzen, in `docker-compose.yml`
bei `ports` die Zeile auf `"3000:3000"` ändern und nur `docker compose up -d --build` starten.

## 4. Update auf eine neue Version

```bash
cd /opt/dienstplan
# neue Projektdateien hierher kopieren, dann:
docker compose --profile https up -d --build
```

Die Daten bleiben erhalten; die Datenbank wird beim Start automatisch auf die neue Version gebracht.

## 5. Datensicherung

- **Automatisch:** Die App legt jede Nacht eine Kopie der Datenbank im Datenbereich unter `backups/` ab
  und behält die letzten 14 Tage.
- **Von Hand:** In der App unter *Einstellungen → Datensicherung → Datenbank herunterladen*.
- **Sicherungen vom Server holen** (z. B. auf einen anderen Rechner kopieren):

  ```bash
  docker compose cp dienstplan:/data/backups ./backups
  ```

Bewahre Sicherungen immer auch außerhalb des Servers auf.

## 6. Wiederherstellen einer Sicherung

```bash
docker compose stop dienstplan
docker compose cp ./dienstplan-2026-10-05.db dienstplan:/data/app.db
docker compose start dienstplan
```

## 7. Passwort des einzigen Admins vergessen

Ein anderer Admin kann unter *Benutzer* das Passwort zurücksetzen. Gibt es keinen weiteren Admin,
spiele die letzte Sicherung ein oder wende dich an die Person, die die App betreut.
````

`README.md`:
````markdown
# Dienstplan Kindergarten

Duty-roster web app for a kindergarten (UI in German). Nuxt 4 + SQLite (better-sqlite3, Drizzle ORM).

- Spec: `docs/superpowers/specs/2026-09-30-dienstplan-kindergarten-design.md`
- Operating guide (German): `docs/BETRIEB.md`

## Development

```bash
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:3000 and log in with the admin from `.env`.

```bash
npm test           # unit and service tests
npm run typecheck  # vue-tsc
npm run db:generate  # after changing server/db/schema.ts
```

## Structure

- `shared/domain/` – pure business rules (times, targets, balances, leave, warnings, day overview)
- `server/services/` – use cases on the database, `server/api/` – thin HTTP handlers
- `app/` – pages and components; all German texts in `app/locales/de.ts`
````

- [ ] **Step 3: Commit**

```
git add -A
git commit -m "chore: add docker packaging, compose file and operating guide"
```

---

### Task 25: Final verification

**Files:** none (verification only; fix and commit anything that fails)

- [ ] **Step 1: Full test and type run**

Run: `npm test` and `npm run typecheck`
Expected: all tests PASS, no type errors.

- [ ] **Step 2: Production build runs outside Docker**

Run:
```
npm run build
$env:DATABASE_PATH = "$env:TEMP\dienstplan-check\app.db"; $env:MIGRATIONS_DIR = 'server/db/migrations'; $env:NUXT_SESSION_PASSWORD = 'check-session-password-at-least-32-chars'; $env:ADMIN_USERNAME = 'admin'; $env:ADMIN_PASSWORD = 'admin-check-1234'; $env:NUXT_SESSION_COOKIE_SECURE = 'false'; $env:PORT = '3100'; node .output/server/index.mjs
```
(run the second line in the background), then `Invoke-RestMethod http://localhost:3100/api/health`.
Expected: `status ok`, the log shows `Initial admin "admin" created.` — this proves better-sqlite3 was bundled into `.output`. Stop the process and delete `$env:TEMP\dienstplan-check`.

- [ ] **Step 3: End-to-end walkthrough in the browser (dev server)**

With a fresh `.data/` folder and `npm run dev`:
1. Log in as admin → forced password change.
2. Create 5 employees (39, 39, 30, 25, 20 h), one observer account for the 30-h employee.
3. October 2026: fill Oct 5–9 so that each day has F1, F2, 2× S → no coverage warnings; leave one cell empty → „kein Eintrag“ warning.
4. Enter VZ 7:30–9:30 for one person → „noch … h“ + „Ergänzen“ button fills the day.
5. Enter „Krank“ → week delta for that person unchanged compared to a normal day.
6. Create closure 26.10.–30.10. as Urlaub → entries appear; leave account of the observer shows them as „verplant“.
7. Release October; as observer see the plan, „Mein Dienstplan“, „Mein Urlaub“; no hours anywhere.
8. As admin change one of the observer's cells → orange mark visible to the observer, „1 Änderung seit Freigabe“.
9. Print view shows the month on one landscape page.
10. Settings → download backup.

Expected: every step behaves as described in the spec. Fix any deviation (with a test where the logic lives in `shared/` or `server/services/`) and commit.

- [ ] **Step 4: Final commit**

```
git add -A
git commit -m "chore: final verification of first draft"
```
(Skip if there is nothing to commit.)

