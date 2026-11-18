import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { absenceCodes } from '../../server/db/schema'
import { setTimeTrackingFrom } from '../../server/services/appSettings'
import { applyToCells, updateEntryTimes } from '../../server/services/entries'
import { getMonthPlan } from '../../server/services/plan'
import { actualTimeFor, getTimeMonth } from '../../server/services/timeTracking'
import { loadEmployee, loadEmployees, loadEntries } from '../../server/services/queries'
import { hasWorkingTime } from '../../shared/domain/attendance'
import { computeDay } from '../../shared/domain/balance'
import { buildDayOverview } from '../../shared/domain/dayOverview'
import type { ApplyMode, EntryInput, SessionUser } from '../../shared/types/api'
import { addEmployee, addUser, codeId, createTestDb, errorCode, templateId } from '../helpers/fixtures'

const date = '2026-10-06' // a Tuesday
const sunday = '2026-10-04'

describe('Arzt (doctor appointment as working time, away from the house)', () => {
  let db: Db
  let admin: SessionUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    anna = addEmployee(db, 'Anna')
  })
  const write = (input: EntryInput, mode: ApplyMode = 'replace', day = date) =>
    applyToCells(db, admin, 1, [{ employeeId: anna, date: day }], mode, input)
  const doctor = (extra: Partial<EntryInput> = {}): EntryInput => ({ kind: 'code', codeId: codeId(db, 'doctor'), ...extra })
  const day = (d = date) => loadEntries(db, { employeeId: anna, from: d, to: d })

  it('exists as a timed code between VZ and Fortbildung', () => {
    const codes = db.select().from(absenceCodes).all().sort((a, b) => a.sortOrder - b.sortOrder)
    expect(codes.find(code => code.key === 'doctor')).toMatchObject({ label: 'Arzt', color: 'red', creditMode: 'timed', requiresTimes: true })
    const keys = codes.map(code => code.key)
    expect(keys.indexOf('doctor')).toBe(keys.indexOf('prep_time') + 1)
    expect(keys.indexOf('training')).toBe(keys.indexOf('doctor') + 1)
    expect(new Set(codes.map(code => code.sortOrder)).size).toBe(codes.length)
  })

  it('credits the typed minutes', () => {
    write(doctor({ start: 480, end: 570 }))
    const entries = day()
    expect(entries).toMatchObject([{ codeKey: 'doctor', start: 480, end: 570 }])
    const info = loadEmployee(db, anna)!.info
    expect(computeDay(info, date, entries).credit).toBe(90)
  })

  it('counts a whole day without times as the daily target', () => {
    write(doctor())
    const entries = day()
    expect(entries).toMatchObject([{ codeKey: 'doctor', start: null, end: null, label: 'Arzt (ganzer Tag)' }])
    const result = computeDay(loadEmployee(db, anna)!.info, date, entries)
    expect(result.credit).toBe(result.target)
    expect(result.target).toBeGreaterThan(0)
  })

  it('refuses a whole day on a day without a target', () => {
    expect(errorCode(() => write(doctor(), 'replace', sunday))).toBe('full_day_needs_target')
    expect(day(sunday)).toEqual([])
  })

  it('is no presence: not on a group attendance, not in the day overview', () => {
    write(doctor({ start: 480, end: 570 }))
    const [entry] = day()
    expect(hasWorkingTime(entry!)).toBe(false)
    const overview = buildDayOverview([{ employeeId: anna, entries: [entry!] }], false)
    const slot = overview.slotStarts.indexOf(510 - (510 % 15))
    expect(overview.rows[0]!.states[slot]).toBe('doctor')
    expect(overview.present.every(count => count === 0)).toBe(true)
  })

  it('sits beside a duty without overlap (8:00–9:30 Arzt, 9:30–15:00 duty), in both orders', () => {
    write(doctor({ start: 480, end: 570 }), 'add')
    write({ kind: 'special', start: 570, end: 900 }, 'add')
    expect(day().map(entry => [entry.codeKey, entry.start, entry.end])).toEqual([['doctor', 480, 570], [null, 570, 900]])
    const info = loadEmployee(db, anna)!.info
    expect(computeDay(info, date, day()).credit).toBe(90 + 330 - 0)
  })

  it('is refused when it overlaps a duty, and a duty overlapping it is refused', () => {
    write({ kind: 'shift', templateId: templateId(db, 'M') }, 'add')
    expect(errorCode(() => write(doctor({ start: 540, end: 600 }), 'add'))).toBe('entries_overlap')
    write({ kind: 'special', start: 1000, end: 1100 }, 'add')
    write(doctor({ start: 1100, end: 1130 }), 'add')
    expect(errorCode(() => write({ kind: 'special', start: 1120, end: 1200 }, 'add'))).toBe('entries_overlap')
    expect(day()).toHaveLength(3)
  })

  it('is refused when it overlaps Büro or VZ, adjacent is fine', () => {
    write({ kind: 'code', codeId: codeId(db, 'office'), start: 480, end: 720 }, 'add')
    expect(errorCode(() => write(doctor({ start: 540, end: 600 }), 'add'))).toBe('entries_overlap')
    write(doctor({ start: 720, end: 780 }), 'add')
    expect(errorCode(() => write({ kind: 'code', codeId: codeId(db, 'prep_time'), start: 700, end: 740 }, 'add'))).toBe('entries_overlap')
    expect(day()).toHaveLength(2)
  })

  it('a partial Arzt day prompts the target-gap hint', () => {
    write(doctor({ start: 480, end: 570 }))
    const warnings = getMonthPlan(db, admin, 1, 2026, 10, '2026-10-01').admin!.warnings
    expect(warnings.some(w => w.type === 'target_gap' && w.date === date)).toBe(true)
  })

  describe('with time tracking', () => {
    beforeEach(() => setTimeTrackingFrom(db, 1, '2026-10-01'))
    const actual = () => actualTimeFor(db, 1, '2026-10-08')(anna)
    const warningTypes = () => getMonthPlan(db, admin, 1, 2026, 10, '2026-10-08').admin!.warnings
      .filter(w => w.date === date && 'employeeId' in w && w.employeeId === anna).map(w => w.type)

    it('credits a planned Arzt without stamping and without a missing-record warning', () => {
      write(doctor({ start: 480, end: 570 }))
      expect(actual()!.minutesByDate.get(date)).toBe(90)
      const employee = loadEmployees(db, 1).find(candidate => candidate.id === anna)!
      expect(computeDay(employee.info, date, day(), actual()).credit).toBe(90)
      expect(warningTypes()).not.toContain('missing_record')
    })

    it('lists the Arzt span as an „Erfasst“ line on the time page, whole day as a full-day line', () => {
      write(doctor({ start: 480, end: 570 }))
      const month = () => getTimeMonth(db, 1, anna, 2026, 10, '2026-10-08', 600).days.find(candidate => candidate.date === date)!
      expect(month()).toMatchObject({ homeOffice: [{ start: 480, end: 570, away: true }], recordedMinutes: 90 })
      write(doctor())
      expect(month()).toMatchObject({ homeOffice: [], fullDay: { label: 'Arzt (ganzer Tag)', homeOffice: false } })
    })

    it('with a duty the duty still needs stamping, the Arzt part counts as planned', () => {
      write(doctor({ start: 480, end: 570 }), 'add')
      write({ kind: 'special', start: 570, end: 900 }, 'add')
      expect(warningTypes()).toContain('missing_record')
      const employee = loadEmployees(db, 1).find(candidate => candidate.id === anna)!
      expect(computeDay(employee.info, date, day(), actual()).credit).toBe(90)
    })
  })

  it('is never home office', () => {
    expect(errorCode(() => write(doctor({ start: 480, end: 570, homeOffice: true })))).toBe('home_office_not_allowed')
    expect(errorCode(() => write(doctor({ homeOffice: true })))).toBe('home_office_not_allowed')
    write(doctor({ start: 480, end: 570 }))
    const id = day()[0]!.id
    expect(errorCode(() => updateEntryTimes(db, admin, 1, id, { start: 480, end: 600, breakStart: null, breakEnd: null, homeOffice: true })))
      .toBe('home_office_not_allowed')
  })
})
