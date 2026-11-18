import { describe, expect, it } from 'vitest'
import { computeDay, creditsDailyTarget, dayCredit, isFullDayTimed, isOnSite, type ActualTime } from '../../shared/domain/balance'
import { buildDayOverview } from '../../shared/domain/dayOverview'
import { describeCellDetailed, describeEntry } from '../../shared/domain/describe'
import { BW_RULES } from '../../shared/domain/holidays'
import type { EmploymentInfo } from '../../shared/domain/targets'
import { dayMarks } from '../../shared/domain/timeMarks'
import type { DomainEntry } from '../../shared/domain/types'
import { timeWarnings } from '../../shared/domain/warnings'
import { code, M, shift } from '../helpers/entries'

const day = '2026-10-06'
const fullTime: EmploymentInfo = { hours: [{ weeklyMinutes: 2340, validFrom: '2026-01-01' }], leftOn: null, holidays: BW_RULES }
const partTime: EmploymentInfo = { hours: [{ weeklyMinutes: 1200, validFrom: '2026-01-01' }], leftOn: null, holidays: BW_RULES }
const office = (extra: Partial<DomainEntry> = {}): DomainEntry => ({ ...code(1, day, 'office', 'timed'), ...extra })
const record = (start: number, end: number | null) => ({ start, end })

describe('a full-day timed entry (Büro or VZ without times)', () => {
  it('is a timed code without start and end', () => {
    expect(isFullDayTimed(office())).toBe(true)
    expect(isFullDayTimed(code(1, day, 'prep_time', 'timed'))).toBe(true)
    expect(isFullDayTimed(code(1, day, 'office', 'timed', 480, 720))).toBe(false)
    expect(isFullDayTimed(code(1, day, 'sick', 'daily_target'))).toBe(false)
    expect(isFullDayTimed(code(1, day, 'other', 'none'))).toBe(false)
    expect(isFullDayTimed(shift(1, day, ...M))).toBe(false)
  })
  it('credits the daily target like a full-day absence', () => {
    expect(creditsDailyTarget([office()])).toBe(true)
    expect(creditsDailyTarget([code(1, day, 'sick', 'daily_target')])).toBe(true)
    expect(creditsDailyTarget([code(1, day, 'office', 'timed', 480, 720)])).toBe(false)
    expect(dayCredit([office()], 468)).toBe(468)
    expect(dayCredit([office({ homeOffice: true })], 468)).toBe(468)
  })
  it('credits the full daily target, also of a part-time person', () => {
    expect(computeDay(fullTime, day, [office()])).toMatchObject({ target: 468, credit: 468, delta: 0 })
    expect(computeDay(partTime, day, [office({ homeOffice: true })])).toMatchObject({ target: 240, credit: 240, delta: 0 })
  })
  it('ignores stamps on days of the tracking range', () => {
    const stamped: ActualTime = { from: '2026-10-01', today: '2026-10-08', minutesByDate: new Map([[day, 120]]) }
    expect(computeDay(fullTime, day, [office()], stamped).credit).toBe(468)
    const nothing: ActualTime = { from: '2026-10-01', today: '2026-10-08', minutesByDate: new Map() }
    expect(computeDay(fullTime, day, [office({ homeOffice: true })], nothing).credit).toBe(468)
  })
  it('needs no stamp and a stamp on it is no stamp on an absence', () => {
    expect(timeWarnings(day, 1, [office()], [])).toEqual([])
    expect(timeWarnings(day, 1, [office({ homeOffice: true })], [])).toEqual([])
    expect(timeWarnings(day, 1, [office()], [record(480, 720)])).toEqual([])
    // A full-day absence still is one.
    expect(timeWarnings(day, 1, [code(1, day, 'sick', 'daily_target')], [record(480, 720)]).map(w => w.type)).toEqual(['record_on_absence'])
  })
  it('gets no late or early marks', () => {
    expect(dayMarks([office()], [record(600, 700)], { tolerance: 0, markEarly: true })).toEqual({ lateMinutes: null, earlyMinutes: null })
  })
  it('is not on site when it is home office', () => {
    expect(isOnSite(office({ homeOffice: true }))).toBe(false)
    expect(isOnSite(office())).toBe(true)
  })
})

describe('the day overview of a full-day timed entry', () => {
  it('shows a full-day home office as home office the whole day, not present', () => {
    const overview = buildDayOverview([{ employeeId: 1, entries: [office({ homeOffice: true })] }], false)
    expect(new Set(overview.rows[0]!.states)).toEqual(new Set(['home_office']))
    expect(overview.present.every(count => count === 0)).toBe(true)
  })
  it('shows a full-day Büro or VZ as a whole office day, not present (it has no time window)', () => {
    const overview = buildDayOverview([
      { employeeId: 1, entries: [office()] },
      { employeeId: 2, entries: [code(2, day, 'prep_time', 'timed')] },
    ], false)
    expect(new Set(overview.rows[0]!.states)).toEqual(new Set(['office_day']))
    expect(new Set(overview.rows[1]!.states)).toEqual(new Set(['office_day']))
    expect(overview.present.every(count => count === 0)).toBe(true)
  })
  it('still counts timed Büro as present in its time window', () => {
    const overview = buildDayOverview([{ employeeId: 1, entries: [code(1, day, 'office', 'timed', 480, 720)] }], false)
    expect(overview.rows[0]!.states[(480 - 420) / 15]).toBe('office')
    expect(overview.present[(480 - 420) / 15]).toBe(1)
  })
})

describe('the text of a full-day timed entry', () => {
  it('names the code with „(ganzer Tag)“', () => {
    expect(describeEntry({ kind: 'code', start: null, end: null }, 'Büro', 'timed')).toBe('Büro (ganzer Tag)')
    expect(describeEntry({ kind: 'code', start: 480, end: 720 }, 'Büro', 'timed')).toBe('Büro 8:00–12:00')
    expect(describeEntry({ kind: 'code', start: null, end: null }, 'Krank', 'daily_target')).toBe('Krank')
    expect(describeEntry({ kind: 'code', start: null, end: null }, 'Krank', null)).toBe('Krank')
  })
  it('names a whole day „Dienst (ganzer Tag)“ where the code label is hidden (a help-out marker)', () => {
    expect(describeEntry({ kind: 'code', start: null, end: null }, null, 'timed')).toBe('Dienst (ganzer Tag)')
    expect(describeEntry({ kind: 'code', start: 480, end: 720 }, null, 'timed')).toBe('8:00–12:00')
  })
  it('ends in „(Homeoffice)“ in the cell description when worked from home', () => {
    const entry = { shortLabel: null, label: 'Büro (ganzer Tag)', breakStart: null, breakEnd: null, note: null, homeOffice: true }
    expect(describeCellDetailed([entry])).toBe('Büro (ganzer Tag) (Homeoffice)')
  })
})
